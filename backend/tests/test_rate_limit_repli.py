# -*- coding: utf-8 -*-
"""Le repli du rate-limiter : une panne Redis ne doit pas lever les limites.

POURQUOI CE FICHIER

Quand Redis tombait pendant une vérification, `_rate_limit_check_redis`
répondait « laisse passer » (fail-open). Ce n'est pas un repli : c'est la
SUPPRESSION de toutes les limites (OTP, connexion, support, robot IA) pendant
toute la panne, sans un mot ni dans les journaux du produit ni sur l'écran du
propriétaire. Le repli mémoire existait déjà, mais il n'était atteint que si le
client Redis était oublié — ce que personne ne faisait.

Ces cas mesurent la correction, et ils échouent sur le code d'avant :

  1. une panne Redis applique le compteur MÉMOIRE **sur la requête même** : au
     delà du plafond, la requête est REFUSÉE (et non laissée passer) ;
  2. la panne est COMPTÉE (`rate_limit_stats`) et le propriétaire est prévenu
     UNE SEULE FOIS par heure — un repli silencieux serait indiscernable d'un
     rate-limit qui fonctionne ;
  3. l'alerte a un TEXTE : `notify_user_localized` lit `_NOTIF_MSG`, et une clé
     absente du dictionnaire français y lève un `KeyError` AVALÉ par le
     `except` de la notification — le propriétaire n'aurait rien reçu, et rien
     ne l'aurait dit.

Ce que ces cas ne jugent pas : le partage multi-workers (il appartient à Redis,
et une panne le retire par définition) ni le choix des plafonds.
"""
import asyncio
from collections import defaultdict

import kojo_rate_limit
import kojo_shared


class _PipelineQuiTombe:
    """Un pipeline Redis dont la CONNEXION tombe à l'exécution.

    Les commandes sont enfilées comme par le vrai client (`zremrangebyscore`,
    `zcard`, `zadd`, `expire` rendent le pipeline) : l'échec vient donc de
    l'aller-retour, pas d'une méthode manquante sur la doublure.
    """

    def enregistrer(self, *args, **kwargs):
        return self

    zremrangebyscore = enregistrer
    zcard = enregistrer
    zadd = enregistrer
    expire = enregistrer

    async def execute(self):
        raise ConnectionError("redis injoignable")


class _ClientQuiTombe:
    def pipeline(self):
        return _PipelineQuiTombe()


def _etat_neuf(monkeypatch):
    """Un état de repli neuf, et des compteurs mémoire vides pour ce cas.

    `REDIS_URL` est retiré de l'environnement : après la bascule, la ré-init
    paresseuse rend `None` (rien à joindre) et la voie mémoire est celle des
    requêtes suivantes — sans quoi le cas mesurerait un Redis de test.
    """
    monkeypatch.setattr(
        kojo_rate_limit,
        "_rate_limit_stats",
        {"replis": 0, "en_memoire": False, "derniere_panne": None, "alerte_envoyee_le": None},
    )
    monkeypatch.setattr(kojo_rate_limit, "request_counts", defaultdict(list))
    monkeypatch.setattr(kojo_rate_limit, "_redis_client", _ClientQuiTombe())
    monkeypatch.setattr(kojo_rate_limit, "_using_redis", True)
    monkeypatch.delenv("REDIS_URL", raising=False)


async def test_une_panne_redis_applique_vraiment_le_compteur_memoire(monkeypatch):
    """Le refus arrive : une panne ne transforme pas le plafond en passoire."""
    _etat_neuf(monkeypatch)

    # Par la voie PUBLIQUE (`rate_limit_check`) : c'est elle qu'un middleware
    # appelle, et c'est elle qui décide Redis OU mémoire requête par requête.
    verdicts = [await kojo_rate_limit.rate_limit_check("10.0.0.7", 3, 1) for _ in range(5)]

    assert verdicts[:3] == [True, True, True], (
        "les trois premières requêtes doivent passer : le repli mémoire compte "
        f"comme le compteur normal (relevé : {verdicts})"
    )
    assert verdicts[3:] == [False, False], (
        "au-delà du plafond, la requête doit être REFUSÉE par le compteur "
        f"mémoire — un « laisse passer » n'est pas un repli (relevé : {verdicts})"
    )
    assert kojo_rate_limit._redis_client is None, (
        "le client Redis mort doit être OUBLIÉ, sinon la voie Redis est "
        "rappelée à chaque requête et le repli mémoire n'est jamais atteint"
    )
    assert kojo_rate_limit.rate_limit_stats()["replis"] == 1


async def test_la_panne_est_comptee_et_le_proprietaire_prevenu_une_fois(monkeypatch):
    """Deux bascules d'affilée : deux pannes comptées, UNE alerte."""
    _etat_neuf(monkeypatch)
    alertes = []

    async def _alerte_comptee():
        alertes.append(1)

    monkeypatch.setattr(kojo_rate_limit, "_notifier_repli_rate_limit", _alerte_comptee)

    kojo_rate_limit._basculer_en_memoire(ConnectionError("première"))
    kojo_rate_limit._basculer_en_memoire(ConnectionError("deuxième"))
    # L'alerte est PLANIFIÉE (la requête qui découvre la panne ne l'attend pas) :
    # on laisse la boucle l'exécuter.
    await asyncio.sleep(0)

    stats = kojo_rate_limit.rate_limit_stats()
    assert stats["en_memoire"] is True
    assert stats["replis"] == 2, "chaque bascule est une panne : elle se compte"
    assert stats["derniere_panne"], "l'horodatage de la panne doit être lisible"
    assert alertes == [1], (
        f"(relevé : {alertes})" 
        "une SEULE alerte par heure : une alerte par requête en panne ferait du "
        f"bruit que personne ne lit (relevé : {alertes})"
    )


def test_l_alerte_du_repli_a_un_texte_dans_chaque_langue_servie():
    """La clé existe là où `_get_notif_msgs` la cherche — fr, et en.

    Les trois autres langues retombent sur le français (dictionnaire partiel
    assumé, comme `owner_email_provider_down`) : ce cas vérifie que le repli
    REND un texte au lieu de lever.
    """
    titre, corps = kojo_shared._get_notif_msgs(
        "fr", "owner_rate_limit_repli_memoire", replis=2
    )
    assert "repli" in titre.lower()
    assert "2" in corps, "le nombre de bascules doit être interpolé dans le corps"

    titre_en, corps_en = kojo_shared._get_notif_msgs(
        "en", "owner_rate_limit_repli_memoire", replis=3
    )
    assert titre_en != titre and corps_en != corps

    for langue in ("wo", "bm", "mos"):
        titre_replie, _ = kojo_shared._get_notif_msgs(
            langue, "owner_rate_limit_repli_memoire", replis=1
        )
        assert titre_replie == titre, (
            f"la langue « {langue} » doit retomber sur le texte français, "
            "pas lever un KeyError que la notification avalerait"
        )
