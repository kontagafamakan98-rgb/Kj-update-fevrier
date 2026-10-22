# -*- coding: utf-8 -*-
"""Plafond de dépense de l'assistant IA : ce qui empêche une facture ouverte.

La limite par IP (`kojo_rate_limit`, 20 POST / 5 min) borne le DÉBIT. Ce fichier
mesure l'autre moitié, celle qu'aucun test de débit ne verrait :

  * le plafond est GLOBAL (compté en base, partagé par les process) et il arrête
    l'appel AVANT le modèle — un refus qui facture quand même ne borne rien ;
  * les deux compteurs comptent : les appels, et les caractères de prompt (un
    tour de 2 000 caractères ne coûte pas un tour de vingt) ;
  * un compteur INJOIGNABLE refuse (503 nommé) au lieu de laisser passer : la
    fonctionnalité est facultative, son repli est le formulaire ;
  * le refus est DISTINCT d'un échec du gateway (429 + `Retry-After`, pas 502) ;
  * le compteur porte une vraie date pour sa règle de conservation — un `_id`
    textuel n'expirerait jamais, en silence (cf. kojo_retention).

Les plafonds sont ABAISSÉS dans ces tests plutôt que recopiés : la valeur de
production est un réglage, la règle est ce qui se mesure ici.
"""
from datetime import datetime, timedelta, timezone

import pytest

import kojo_ai_budget as budget
import kojo_routers_support as support
from kojo_retention import regle_de
from tests.conftest import db_find_one, db_insert

CHAT = "/api/support/robot/chat"
CORPS = {"messages": [{"role": "user", "content": "Comment payer une mission ?"}]}


def _configure(monkeypatch):
    """Assistant configuré, modèle doublé, appels retenus."""
    monkeypatch.setattr(support, "is_configured", lambda: True)
    appels = []

    def faux(messages, **kwargs):
        appels.append(messages)
        return "Réponse de test."

    monkeypatch.setattr(support, "chat_completion", faux)
    return appels


class TestPlafondDAttente:
    async def test_le_plafond_d_appels_arrete_avant_le_modele(self, client, monkeypatch):
        """Deux appels passent, le troisième est refusé — et n'est PAS facturé."""
        appels = _configure(monkeypatch)
        monkeypatch.setattr(budget, "PLAFOND_APPELS", 2)

        statuts = [
            (await client.post(CHAT, json=CORPS)).status_code for _ in range(3)
        ]

        assert statuts == [200, 200, 429], statuts
        assert len(appels) == 2, "un refus de plafond ne doit pas appeler le modèle"

    async def test_le_refus_nomme_le_plafond_et_le_formulaire(self, client, monkeypatch):
        _configure(monkeypatch)
        monkeypatch.setattr(budget, "PLAFOND_APPELS", 1)

        await client.post(CHAT, json=CORPS)
        refus = await client.post(CHAT, json=CORPS)

        assert refus.status_code == 429
        detail = refus.json()["detail"].lower()
        assert "plafond" in detail, detail
        assert "demande de support" in detail, (
            "le visiteur doit savoir où aller : le formulaire est le seul chemin garanti"
        )
        assert "Retry-After" in refus.headers, (
            "un 429 sans échéance oblige le client à réessayer au hasard"
        )
        assert refus.json().get("bucket") == "ai-budget", (
            "le client doit distinguer le plafond du jour d'une limite de débit "
            "(rate-limiter), qui se relâche seule en cinq minutes"
        )

    async def test_le_plafond_de_caracteres_borne_les_prompts_longs(self, client, monkeypatch):
        """Le compteur d'appels seul ne voit pas le coût d'un historique long :
        c'est le second compteur qui l'arrête, et il s'arrête à la même borne."""
        appels = _configure(monkeypatch)
        monkeypatch.setattr(budget, "PLAFOND_APPELS", 100)
        # Prompts d'environ 2 000 caractères (le maximum d'un tour) : le premier
        # franchit la borne d'un tour, le second la dépasse déjà.
        monkeypatch.setattr(budget, "PLAFOND_CARACTERES", 2_500)
        long = {"messages": [{"role": "user", "content": "x" * 2_000}]}

        premier = await client.post(CHAT, json=long)
        second = await client.post(CHAT, json=long)

        assert premier.status_code == 200, premier.text
        assert second.status_code == 429, second.text
        assert len(appels) == 1, "le second prompt ne doit pas partir"

    async def test_le_compteur_est_en_base_et_partage(self, client, monkeypatch):
        """Le compteur vit dans `ai_usage`, pas dans la mémoire du process :
        c'est ce qui le fait survivre à un redémarrage et le partage entre
        instances — la propriété qu'une limite par IP n'a pas."""
        _configure(monkeypatch)
        await client.post(CHAT, json=CORPS)

        document = await db_find_one("ai_usage", {"_id": budget.jour_utc()})
        assert document is not None, "aucun compteur écrit : le plafond ne survit pas au process"
        assert document["appels"] == 1
        assert document["caracteres"] > len(CORPS["messages"][0]["content"]), (
            "le prompt système part aussi, il doit être compté"
        )

    async def test_un_compteur_deja_plein_venu_d_ailleurs_bloque(self, client, monkeypatch):
        """Le plafond ne dépend pas de l'état de CE process : une journée déjà
        consommée (autre instance, redémarrage) refuse immédiatement."""
        appels = _configure(monkeypatch)
        monkeypatch.setattr(budget, "PLAFOND_APPELS", 2)
        await db_insert("ai_usage", {
            "_id": budget.jour_utc(),
            "jour_debut": budget.debut_du_jour(),
            "appels": 2,
            "caracteres": 900,
        })

        reponse = await client.post(CHAT, json=CORPS)

        assert reponse.status_code == 429, reponse.text
        assert appels == [], "un compteur déjà plein doit refuser sans appeler le modèle"

    async def test_le_jour_suivant_repart_a_zero(self, client, monkeypatch):
        """Le compteur d'hier ne doit pas fermer l'assistant aujourd'hui."""
        _configure(monkeypatch)
        monkeypatch.setattr(budget, "PLAFOND_APPELS", 1)
        hier = datetime.now(timezone.utc) - timedelta(days=1)
        await db_insert("ai_usage", {
            "_id": budget.jour_utc(hier),
            "jour_debut": budget.debut_du_jour(hier),
            "appels": 1,
            "caracteres": 10_000,
        })

        reponse = await client.post(CHAT, json=CORPS)

        assert reponse.status_code == 200, reponse.text

    async def test_un_seul_tour_peut_depasser_le_plafond_et_un_seul(self, client, monkeypatch):
        """Le dépassement est BORNÉ par un prompt, pas par la journée : le
        filtre compare l'état avant l'incrément. Deux dépassements
        successifs sont impossibles — après le premier, le compteur est
        au-dessus et tout est refusé."""
        _configure(monkeypatch)
        monkeypatch.setattr(budget, "PLAFOND_APPELS", 1)
        monkeypatch.setattr(budget, "PLAFOND_CARACTERES", 1)

        # Le premier tour passe forcément (compteur vide), le second non.
        assert (await client.post(CHAT, json=CORPS)).status_code == 200
        assert (await client.post(CHAT, json=CORPS)).status_code == 429
        assert (await client.post(CHAT, json=CORPS)).status_code == 429


class TestCompteurEnPanne:
    async def test_un_compteur_injoignable_refuse_et_le_dit(self, client, monkeypatch):
        """Refuser plutôt que laisser passer : « laisser passer » signifierait
        dépenser sans plafond sur une fonctionnalité facultative."""
        appels = _configure(monkeypatch)

        class _CompteurMuet:
            async def update_one(self, *a, **k):
                raise RuntimeError("mongo injoignable")

            async def find_one(self, *a, **k):
                raise RuntimeError("mongo injoignable")

        class _BaseMuerte:
            ai_usage = _CompteurMuet()

        monkeypatch.setattr(budget, "db", _BaseMuerte())

        reponse = await client.post(CHAT, json=CORPS)

        assert reponse.status_code == 503, reponse.text
        assert "formulaire" in reponse.json()["detail"].lower()
        assert appels == [], "aucun appel modèle ne doit partir sur un compteur muet"

    async def test_une_panne_de_compteur_n_est_pas_un_plafond(self, client, monkeypatch):
        """Deux causes, deux réponses : confondre les deux ferait chercher un
        humain pour une limite de dépense, ou croire le budget respecté alors
        qu'il n'est plus compté."""
        _configure(monkeypatch)

        class _CompteurMuet:
            async def update_one(self, *a, **k):
                raise RuntimeError("mongo injoignable")

            async def find_one(self, *a, **k):
                raise RuntimeError("mongo injoignable")

        class _BaseMuerte:
            ai_usage = _CompteurMuet()

        monkeypatch.setattr(budget, "db", _BaseMuerte())

        reponse = await client.post(CHAT, json=CORPS)

        assert reponse.status_code != 429
        assert "plafond" not in reponse.json()["detail"].lower()


class TestLeCompteurEtSaConservation:
    def test_le_prompt_systeme_est_compte(self):
        messages = [
            {"role": "system", "content": "x" * 40},
            {"role": "user", "content": "abc"},
        ]

        assert budget.caracteres_de_prompt(messages) == 43

    def test_un_contenu_non_textuel_ne_fait_pas_echouer_le_comptage(self):
        assert budget.caracteres_de_prompt([{"role": "user"}, {"role": "user", "content": None}]) == 0
        assert budget.caracteres_de_prompt(None) == 0

    def test_le_jour_est_utc(self):
        moment = datetime(2026, 10, 21, 23, 30, tzinfo=timezone.utc)
        assert budget.jour_utc(moment) == "2026-10-21"

    def test_le_retry_after_bascule_au_jour_suivant(self):
        moment = datetime(2026, 10, 21, 23, 59, 30, tzinfo=timezone.utc)
        assert budget.secondes_avant_le_jour_suivant(moment) == 30

        debut = datetime(2026, 10, 21, 0, 0, 0, tzinfo=timezone.utc)
        assert budget.secondes_avant_le_jour_suivant(debut) == 86_400

    def test_un_plafond_nul_borne_au_lieu_d_eteindre_l_assistant(self):
        """Zéro fermerait l'assistant sans le dire : son interrupteur est
        l'absence de jeton, pas une valeur mal saisie."""
        assert budget._plancher(0) == 1
        assert budget._plancher(-12) == 1
        assert budget._plancher(7) == 7

    async def test_le_compteur_porte_une_date_que_la_base_peut_purger(self, client, monkeypatch):
        """Le piège de `kojo_retention` : un index TTL sur un champ TEXTE
        n'expire jamais, en silence. `_id` est le jour en texte (atomicité),
        donc la date de la règle est `jour_debut` — un vrai datetime."""
        _configure(monkeypatch)
        await client.post(CHAT, json=CORPS)

        regle = regle_de("ai_usage")
        document = await db_find_one("ai_usage", {"_id": budget.jour_utc()})

        assert regle.ttl_field == "jour_debut"
        assert isinstance(document[regle.ttl_field], datetime), (
            "un index TTL sur ce champ ne purgerait rien s'il était une chaîne"
        )
        assert regle.date_portee_par_le_document is False
        assert regle.query_de_purge(datetime(2026, 10, 21, tzinfo=timezone.utc))[
            "jour_debut"
        ]["$lte"] == datetime(2026, 10, 21, tzinfo=timezone.utc) - regle.lifetime
