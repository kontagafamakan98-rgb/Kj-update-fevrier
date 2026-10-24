# -*- coding: utf-8 -*-
"""L'ÉQUIPE SUPPORT : le propriétaire ajoute des personnes au service clientèle.

Ce que ces tests verrouillent (24/10/2026)
------------------------------------------
1. L'ajout se fait par l'ADRESSE d'un compte Kojo EXISTANT : aucun mot de passe
   n'est créé ni envoyé, la personne garde ses identifiants. Une adresse inconnue
   est refusée en disant les deux étapes (créer son compte, puis l'ajout).
2. Ce qui est ACCORDÉ est étroit : lire les tickets et faire avancer leur
   statut. Aucun droit propriétaire ne suit le rôle — `/owner/*` reste fermé à
   l'agent, et un agent ne peut pas recruter d'agent.
3. Ce qui est RETIRÉ l'est immédiatement : `get_current_user` relit le compte à
   chaque requête, donc le jeton en cours de l'agent ne survit pas au retrait.
4. Un NOUVEAU TICKET prévient l'équipe comme le propriétaire : une demande qui
   n'arrive que dans une boîte n'est pas une demande traitée.
5. Les refus sont NOMMÉS (409 compte du propriétaire, 409 compte supprimé, 409
   pas membre) : un ajout rejoué n'est pas une erreur, un retrait d'un
   non-membre en est une.
"""
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from httpx import AsyncClient

from kojo_rate_limit import get_rate_limit_bucket
from tests.conftest import BASE_USER, auth_headers, db_find_one, db_insert

OWNER_EMAIL_TEST = "proprietaire-support@kojo.sn"
AGENT_EMAIL = "agent-support@kojo.sn"
AGENT_EMAIL_MAJUSCULES = "Agent-Support@Kojo.SN"

TICKET = {
    "full_name": "Zoya",
    "phone": "+221771234567",
    "email": "zoya@example.com",
    "reason": "Support WhatsApp",
    "message": "Bonjour, j'ai besoin de parler à une personne.",
    "channel": "direct",
}


@contextmanager
def _proprietaire(email: str = OWNER_EMAIL_TEST):
    """Le propriétaire est désigné par l'EMAIL (kojo_owner), la même règle
    qu'en production : rien de ce qui suit ne dépend d'un champ choisi par le
    client."""
    with patch("kojo_owner.OWNER_EMAIL", email):
        yield


async def _proprietaire_connecte(client: AsyncClient) -> dict:
    return await auth_headers(
        client,
        {**BASE_USER, "email": OWNER_EMAIL_TEST, "first_name": "Famakan", "last_name": "Master"},
    )


async def _agent_connecte(client: AsyncClient, email: str = AGENT_EMAIL) -> dict:
    return await auth_headers(
        client, {**BASE_USER, "email": email, "first_name": "Awa", "last_name": "Diallo"}
    )


@pytest.mark.asyncio
class TestAjoutALEquipe:
    async def test_le_proprietaire_ajoute_un_compte_par_son_adresse(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        await _agent_connecte(client)

        with _proprietaire():
            reponse = await client.post(
                "/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL_MAJUSCULES}
            )
        assert reponse.status_code == 201, reponse.text
        corps = reponse.json()
        assert corps["deja_membre"] is False
        assert corps["agent"]["email"] == AGENT_EMAIL, (
            "l'adresse est normalisée : ajouter « Agent@Kojo.SN » puis se connecter "
            "avec « agent@kojo.sn » doit désigner le MÊME compte"
        )
        assert corps["agent"]["first_name"] == "Awa"

        compte = await db_find_one("users", {"email": AGENT_EMAIL})
        assert compte["support_role"] == "agent"

        with _proprietaire():
            liste = await client.get("/api/support/team", headers=owner_headers)
        assert liste.status_code == 200, liste.text
        assert [a["email"] for a in liste.json()["agents"]] == [AGENT_EMAIL]

    async def test_le_profil_de_session_publie_le_role(self, client: AsyncClient):
        """Le frontend n'ouvre l'écran que sur un FAIT publié par /auth/me :
        sans ce champ, la page devrait deviner le rôle."""
        owner_headers = await _proprietaire_connecte(client)
        agent_headers = await _agent_connecte(client)

        with _proprietaire():
            await client.post("/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL})

        profil = await client.get("/api/auth/me", headers=agent_headers)
        assert profil.status_code == 200, profil.text
        assert profil.json()["support_role"] == "agent"
        assert profil.json()["is_owner"] is False

    async def test_une_adresse_inconnue_dit_les_deux_etapes(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)

        with _proprietaire():
            reponse = await client.post(
                "/api/support/team", headers=owner_headers, json={"email": "inconnu@kojo.sn"}
            )
        assert reponse.status_code == 404, reponse.text
        detail = reponse.json()["detail"]
        assert "Aucun compte Kojo" in detail
        assert "créer son compte" in detail, (
            "un refus sans remède laisse le propriétaire sans prochaine action"
        )

    async def test_le_compte_du_proprietaire_ne_recoit_pas_le_role(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)

        with _proprietaire():
            reponse = await client.post(
                "/api/support/team", headers=owner_headers, json={"email": OWNER_EMAIL_TEST}
            )
        assert reponse.status_code == 409, reponse.text
        assert "propriétaire" in reponse.json()["detail"]

    async def test_un_compte_supprime_n_est_pas_ajoute(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        await db_insert(
            "users",
            {
                "id": "compte-supprime-support",
                "email": "parti@kojo.sn",
                "first_name": "Parti",
                "last_name": "Kojo",
                "user_type": "client",
                "deleted": True,
            },
        )

        with _proprietaire():
            reponse = await client.post(
                "/api/support/team", headers=owner_headers, json={"email": "parti@kojo.sn"}
            )
        assert reponse.status_code == 409, reponse.text
        assert "supprimé" in reponse.json()["detail"]

    async def test_une_adresse_mal_formee_est_dite_comme_telle(self, client: AsyncClient):
        """« awa@kojo » n'est pas un compte inconnu, c'est une FAUTE DE FRAPPE.

        La chercher en base rendrait « aucun compte avec cette adresse » et le
        proprietaire demanderait a la personne de creer un compte qui existe
        deja.
        """
        owner_headers = await _proprietaire_connecte(client)

        with _proprietaire():
            reponse = await client.post(
                "/api/support/team", headers=owner_headers, json={"email": "awa@kojo"}
            )
        assert reponse.status_code == 400, reponse.text
        assert "pas valide" in reponse.json()["detail"]

    async def test_un_ajout_rejoue_n_est_pas_une_erreur(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        await _agent_connecte(client)

        with _proprietaire():
            premier = await client.post(
                "/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL}
            )
            second = await client.post(
                "/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL}
            )
        assert premier.status_code == 201, premier.text
        assert second.status_code == 201, second.text
        assert second.json()["deja_membre"] is True
        assert "fait déjà partie" in second.json()["message"]


@pytest.mark.asyncio
class TestCeQueLOffreAccorde:
    async def test_l_agent_lit_les_tickets_et_fait_avancer_le_statut(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        agent_headers = await _agent_connecte(client)
        cree = await client.post("/api/support/tickets", json=TICKET)
        assert cree.status_code == 200, cree.text

        with _proprietaire():
            await client.post("/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL})

        liste = await client.get("/api/support/tickets", headers=agent_headers)
        assert liste.status_code == 200, liste.text
        tickets = liste.json()
        assert len(tickets) == 1
        assert tickets[0]["full_name"] == "Zoya", (
            "la route rendait cinq tickets en production : l'agent doit les VOIR, "
            "pas lire une liste vide"
        )

        maj = await client.patch(
            f"/api/support/tickets/{tickets[0]['id']}/status",
            headers=agent_headers,
            json={"status": "En cours"},
        )
        assert maj.status_code == 200, maj.text
        assert maj.json()["status"] == "En cours"

    async def test_un_client_ordinaire_n_ouvre_pas_le_service_clientele(self, client: AsyncClient):
        client_headers = await auth_headers(client, {**BASE_USER, "email": "client-ordinaire@kojo.sn"})

        with _proprietaire():
            reponse = await client.get("/api/support/tickets", headers=client_headers)
        assert reponse.status_code == 403, reponse.text
        assert "service clientèle" in reponse.json()["detail"]

    async def test_l_agent_n_ouvre_aucun_droit_proprietaire(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        agent_headers = await _agent_connecte(client)

        with _proprietaire():
            await client.post("/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL})
            gains = await client.get("/api/owner/commission-stats", headers=agent_headers)
            recrutement = await client.post(
                "/api/support/team", headers=agent_headers, json={"email": "autre@kojo.sn"}
            )

        assert gains.status_code == 403, gains.text
        assert recrutement.status_code == 403, (
            "un agent ne recrute pas d'agent : le droit de composer l'équipe "
            "reste au propriétaire"
        )

    async def test_un_nouveau_ticket_previent_les_membres_de_l_equipe(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        await _agent_connecte(client)

        with _proprietaire():
            await client.post("/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL})

        agent = await db_find_one("users", {"email": AGENT_EMAIL})
        cree = await client.post("/api/support/tickets", json=TICKET)
        assert cree.status_code == 200, cree.text

        # On relit la BOÎTE de l'agent : la notification est le seul canal qui
        # l'avertit qu'une demande est arrivée (personne ne surveille la page).
        from kojo_core import db as vraie_db

        boite = await vraie_db.notifications.find({"user_id": agent["id"]}).to_list(length=10)
        assert boite, "l'agent ajouté doit recevoir l'alerte de nouveau ticket"
        assert "Support WhatsApp" in (boite[0].get("body") or "")


@pytest.mark.asyncio
class TestRetraitDeLEquipe:
    async def test_retirer_l_acces_ferme_la_requete_suivante(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        agent_headers = await _agent_connecte(client)

        with _proprietaire():
            await client.post("/api/support/team", headers=owner_headers, json={"email": AGENT_EMAIL})
        agent = await db_find_one("users", {"email": AGENT_EMAIL})

        assert (await client.get("/api/support/tickets", headers=agent_headers)).status_code == 200

        with _proprietaire():
            retrait = await client.delete(f"/api/support/team/{agent['id']}", headers=owner_headers)
        assert retrait.status_code == 200, retrait.text
        assert "ne fait plus partie" in retrait.json()["message"]

        apres = await client.get("/api/support/tickets", headers=agent_headers)
        assert apres.status_code == 403, (
            "le retrait vaut dès la requête suivante : le jeton en cours de "
            "l'agent ne doit pas garder l'accès"
        )

        compte = await db_find_one("users", {"email": AGENT_EMAIL})
        assert compte is not None, "le compte reste intact : on retire un ACCÈS, pas une personne"
        assert compte.get("support_role") is None

    async def test_retirer_un_compte_qui_n_est_pas_membre_est_refuse(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)
        await _agent_connecte(client)
        compte = await db_find_one("users", {"email": AGENT_EMAIL})

        with _proprietaire():
            reponse = await client.delete(f"/api/support/team/{compte['id']}", headers=owner_headers)
        assert reponse.status_code == 409, reponse.text
        assert "ne fait pas partie" in reponse.json()["detail"]

    async def test_un_compte_inconnu_est_refuse(self, client: AsyncClient):
        owner_headers = await _proprietaire_connecte(client)

        with _proprietaire():
            reponse = await client.delete("/api/support/team/inconnu-123", headers=owner_headers)
        assert reponse.status_code == 404, reponse.text


@pytest.mark.asyncio
class TestPlafondsDuGuichet:
    """Le guichet a son PROPRE plafond, et la file se relit librement.

    ── Le défaut mesuré (24/10/2026) ────────────────────────────────────────
    Toutes les routes `/api/support` tombaient dans un bucket de 10 requêtes par
    5 minutes, GET compris. C'était le bon chiffre pour la CRÉATION publique
    d'un ticket ; c'est un plafond absurde pour un écran de travail où plusieurs
    agents partagent l'IP du bureau — dix changements de statut fermaient la
    file pour tout le monde, le jour même où l'équipe était créée pour la
    traiter à plusieurs.
    """

    def test_la_creation_publique_garde_sa_borne_serree(self):
        assert get_rate_limit_bucket("/api/support/tickets") == ("support", 10, 5), (
            "la création publique d'un ticket est le chemin qu'un tiers peut "
            "marteler : sa borne ne bouge pas"
        )
        assert get_rate_limit_bucket("/api/support/tickets/status") == ("support", 10, 5), (
            "la recherche publique de statut n'a pas de compte à faire dans le "
            "bucket du guichet"
        )

    def test_le_guichet_a_son_propre_bucket(self):
        assert get_rate_limit_bucket("/api/support/tickets/abc-123/status") == ("support-desk", 120, 1)
        assert get_rate_limit_bucket("/api/support/team") == ("support-desk", 120, 1)
        assert get_rate_limit_bucket("/api/support/team/abc-123") == ("support-desk", 120, 1)
        assert get_rate_limit_bucket("/api/support/tickets")[0] != "support-desk", (
            "créer un ticket reste borné à 10 : élargir le guichet ne doit pas "
            "ouvrir la porte publique"
        )

    async def test_la_file_se_relit_sans_429(self, client: AsyncClient):
        """Douze lectures d'affilée : la file doit rester lisible.

        Sans l'exemption des GET, la douzième rendait 429 alors qu'aucune
        demande n'avait été créée — un écran de travail qui se ferme tout seul.
        """
        owner_headers = await _proprietaire_connecte(client)

        with _proprietaire():
            for _ in range(12):
                reponse = await client.get("/api/support/tickets", headers=owner_headers)
                assert reponse.status_code == 200, (
                    "relire la file ne crée pas de demande et ne doit pas être plafonné : %s"
                    % reponse.text
                )
