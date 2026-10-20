# -*- coding: utf-8 -*-
"""L'IPN public ne fait pas appeler PayDunya par n'importe qui.

`POST /payments/ipn/paydunya` est anonyme par nature (c'est un webhook) : le
statut qu'elle reçoit n'est jamais cru — le serveur reconfirme toujours auprès
du fournisseur. Ce que ces cas verrouillent, c'est le COÛT de cette
reconfirmation, qui n'était borné par rien :

  • un paiement DÉJÀ confirmé ne rappelle pas le fournisseur (rejeu ou forge) ;
  • une rafale d'IPN pour le même paiement ne fait qu'un appel (cache 15 s) ;
  • un paiement encore `pending` en fait bien un, et le met en cache.

Sans ces bornes, 240 POST/min/IP épuisaient le quota PayDunya et — cinq échecs
consécutifs plus loin — ouvraient le disjoncteur GLOBAL 2 h, c'est-à-dire
refusaient tous les checkouts du site.

Le second cas de la classe suivante vise le rate-limiter : sur une panne Redis,
il « laissait passer » (fail-open) TOUTES les limites en annonçant un repli
mémoire qui n'existait pas, puisque `rate_limit_check` rappelait la voie Redis
à chaque requête. Le repli doit être réel, compté, et la mémoire doit
effectivement refuser au-delà du seuil.
"""
import pytest

import kojo_routers_payments as routeur
import kojo_rate_limit as limiteur


class _Requete:
    """Le minimum de `Request` que le handler lit : `await request.json()`."""

    def __init__(self, corps):
        self._corps = corps

    async def json(self):
        return self._corps


class _Collection:
    def __init__(self, document):
        self.document = document
        self.ecritures = []

    async def find_one(self, *args, **kwargs):
        return self.document

    async def update_one(self, *args, **kwargs):
        self.ecritures.append((args, kwargs))


class _Base:
    def __init__(self, document):
        self.payments = _Collection(document)


@pytest.fixture(autouse=True)
def _cache_vide():
    """Le cache du routeur est un état de MODULE : on le vide entre les cas."""
    routeur._payment_status_cache.clear()
    yield
    routeur._payment_status_cache.clear()


@pytest.mark.asyncio
async def test_un_paiement_deja_confirme_ne_rappelle_pas_le_fournisseur(monkeypatch):
    """Un rejeu — ou une IPN forgée — sur un paiement confirmé coûte ZÉRO appel."""
    appels = []

    async def faux_sync(record):
        appels.append(record["id"])
        return record

    monkeypatch.setattr(routeur, "db", _Base({"id": "p1", "status": "completed"}))
    monkeypatch.setattr(routeur, "sync_payment_status_with_paydunya", faux_sync)

    reponse = await routeur.paydunya_payment_ipn(_Requete({"payment_id": "p1"}))

    assert reponse["status"] == "ok"
    assert appels == [], (
        "un paiement déjà confirmé a déclenché un appel fournisseur : c'est "
        "exactement ce qu'un tiers peut provoquer en boucle, et cinq échecs "
        "consécutifs ouvrent le disjoncteur global (checkout refusé 2 h)"
    )


@pytest.mark.asyncio
async def test_une_rafale_d_ipn_pour_le_meme_paiement_ne_fait_qu_un_appel(monkeypatch):
    """Deux IPN dans la fenêtre du cache : un seul aller-retour fournisseur."""
    appels = []

    async def faux_sync(record):
        appels.append(record["id"])
        return {**record, "status": "pending", "provider_status": "pending"}

    base = _Base({"id": "p2", "status": "pending"})
    monkeypatch.setattr(routeur, "db", base)
    monkeypatch.setattr(routeur, "sync_payment_status_with_paydunya", faux_sync)

    premier = await routeur.paydunya_payment_ipn(_Requete({"payment_id": "p2"}))
    second = await routeur.paydunya_payment_ipn(_Requete({"payment_id": "p2"}))

    assert premier["status"] == "ok" and second["status"] == "ok"
    assert appels == ["p2"], (
        f"le fournisseur a été appelé {len(appels)} fois pour une rafale : le "
        "cache 15 s que les GET utilisent déjà n'est pas consulté par l'IPN"
    )


@pytest.mark.asyncio
async def test_la_confirmation_reussie_est_mise_en_cache(monkeypatch):
    """Le cache ne porte qu'un résultat RÉEL : il est écrit après le sync."""
    appels = []

    async def faux_sync(record):
        appels.append(record["id"])
        return {**record, "status": "completed", "provider_status": "completed"}

    monkeypatch.setattr(routeur, "db", _Base({"id": "p3", "status": "pending"}))
    monkeypatch.setattr(routeur, "sync_payment_status_with_paydunya", faux_sync)

    await routeur.paydunya_payment_ipn(_Requete({"payment_id": "p3"}))

    assert appels == ["p3"]
    assert routeur._get_cached_payment_status("p3") is not None, (
        "le résultat confirmé n'est pas mis en cache : l'IPN suivante rappellera "
        "le fournisseur"
    )


# ── Le repli du rate-limiter doit être RÉEL ────────────────────────────────


class _PipelineQuiTombe:
    def __getattr__(self, nom):
        def leve(*args, **kwargs):
            raise RuntimeError("redis injoignable")
        return leve


class _RedisQuiTombe:
    def pipeline(self):
        raise RuntimeError("redis injoignable")


@pytest.fixture(autouse=True)
def _etat_limiteur_propre():
    limiteur.request_counts.clear()
    limiteur._rate_limit_stats.update(
        {"replis": 0, "en_memoire": False, "derniere_panne": None, "alerte_envoyee_le": None}
    )
    yield
    limiteur.request_counts.clear()


@pytest.mark.asyncio
async def test_une_panne_redis_bascule_vraiment_sur_la_memoire(monkeypatch):
    """La panne ne supprime pas les limites : la mémoire reprend, et refuse."""
    monkeypatch.setattr(limiteur, "_redis_client", _RedisQuiTombe())
    monkeypatch.setattr(limiteur, "_using_redis", True)

    premiere = await limiteur.rate_limit_check("1.2.3.4:general", max_requests=1, window_minutes=1)
    seconde = await limiteur.rate_limit_check("1.2.3.4:general", max_requests=1, window_minutes=1)

    assert premiere is True, "la première requête doit passer (compteur à 1)"
    assert seconde is False, (
        "la seconde requête passe encore : la panne Redis a SUPPRIMÉ la limite "
        "au lieu de la déporter en mémoire"
    )
    assert limiteur._using_redis is False
    assert limiteur._redis_client is None, (
        "le client Redis est resté en place : `rate_limit_check` rappellera la "
        "voie Redis à chaque requête et le repli mémoire ne servira jamais"
    )
    assert limiteur.rate_limit_stats()["replis"] >= 1, (
        "la panne n'est pas comptée : un repli silencieux est indiscernable "
        "d'un rate-limit qui fonctionne"
    )
    assert limiteur.rate_limit_stats()["en_memoire"] is True
