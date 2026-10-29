# -*- coding: utf-8 -*-
"""Alertes emploi — le seul chemin de RETOUR du produit, et ce qu'il promet.

Ce qui est mesuré ici, et pourquoi chaque cas existe :

  • la VEILLE est unique par compte (deux activations ne font pas deux emails) et
    ne rend ni l'adresse ni le jeton — deux données qui servent l'envoi, pas la
    page ;
  • la CORRESPONDANCE est une fonction pure (`correspond`) : une catégorie, une
    ville, un pays, et rien de plus. Une veille « plomberie à Dakar » qui
    enverrait une électricité à Abidjan serait pire qu'aucune veille ;
  • le RÉSUMÉ est borné et ne renvoie PAS deux fois la même mission : la fenêtre
    est temporelle (`last_notified_at`), et un second passage ne doit rien
    envoyer ;
  • une veille sans correspondance n'écrit rien et n'avance pas sa fenêtre —
    sinon une mission publiée juste après serait sautée ;
  • une adresse RETENUE (le point de règle rend `None`) n'est pas comptée comme
    envoyée, et la veille n'est pas coupée pour autant : c'est le propriétaire
    qui lève une retenue (`PRIVACY.md`), pas un planificateur ;
  • le JETON de désinscription coupe la bonne veille, et un jeton inconnu ne
    coupe RIEN (404) — un lien périmé ne doit pas se confondre avec un succès.
  • une NOTIFICATION in-app (et son push) part au même passage, y compris quand
    l'email est retenu : c'est le canal qui atteint un travailleur qui n'ouvre
    pas sa boîte, et il renvoie vers la LISTE (`/jobs`) parce qu'il résume
    plusieurs missions ;
  • une mission ne prévient JAMAIS deux fois le même compte : le push de
    publication (`_notify_matching_workers`) se tait pour un travailleur dont
    une veille ACTIVE couvre déjà la mission (`comptes_couverts`), et c'est le
    résumé qui l'annonce — une seule fois, sur ses deux canaux.

Ce qui n'est pas mesuré : le rendu d'un email dans un client de messagerie, et
la livraison réelle chez le fournisseur (elle appartient à `/monitor/email` et
aux webhooks de `kojo_email_suppressions`).
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from kojo_job_alerts import passage_digest
from tests.conftest import WORKER_USER, auth_headers, db_find_one, db_insert

MAINTENANT = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)


def _mission(identifiant, **remplacements):
    """Une mission ouverte publiée à l'instant du test (posted_at récent)."""
    doc = {
        "id": identifiant,
        "client_id": "client-alertes",
        "title": f"Réfection {identifiant}",
        "description": "Une mission publiée pour éprouver les alertes emploi.",
        "category": "plumbing",
        "country": "senegal",
        "location": {"city": "Dakar"},
        "status": "open",
        "budget_min": 1000,
        "budget_max": 5000,
        "posted_at": MAINTENANT,
    }
    doc.update(remplacements)
    return doc


def _veille(user_id, **remplacements):
    doc = {
        "user_id": user_id,
        "email": "worker@kojo.sn",
        "category": None,
        "city": None,
        "country": "senegal",
        "active": True,
        "token": "jeton-de-test",
        "created_at": MAINTENANT - timedelta(days=1),
        "sent_count": 0,
        "last_notified_at": None,
        "last_checked_at": None,
    }
    doc.update(remplacements)
    return doc


class TestReglages:
    async def test_une_veille_par_compte_et_aucune_donnee_d_envoi_rendue(
        self, client: AsyncClient
    ):
        entetes = await auth_headers(client, WORKER_USER)

        premiere = await client.put(
            "/api/job-alerts",
            json={"category": "plumbing", "city": "Dakar"},
            headers=entetes,
        )
        assert premiere.status_code == 200, premiere.text
        corps = premiere.json()
        assert corps["active"] is True
        assert corps["category"] == "plumbing"
        assert corps["city"] == "Dakar"
        # Ni l'adresse ni le jeton ne sortent de la route de lecture.
        assert "email" not in corps and "token" not in corps
        assert "worker@kojo.sn" not in premiere.text

        seconde = await client.put(
            "/api/job-alerts",
            json={"category": "electrical"},
            headers=entetes,
        )
        assert seconde.status_code == 200, seconde.text
        assert seconde.json()["category"] == "electrical"

        # UN seul document : deux activations ne doivent pas produire deux
        # emails pour les mêmes missions.
        depuis_la_base = await client.get("/api/job-alerts", headers=entetes)
        assert depuis_la_base.status_code == 200
        assert depuis_la_base.json()["category"] == "electrical"

        from kojo_core import db

        assert await db.job_alerts.count_documents({}) == 1

    async def test_sans_veille_la_lecture_repond_inactive(self, client: AsyncClient):
        entetes = await auth_headers(client, WORKER_USER)

        reponse = await client.get("/api/job-alerts", headers=entetes)

        assert reponse.status_code == 200
        assert reponse.json()["active"] is False

    async def test_la_veille_est_reservee_aux_travailleurs(self, client: AsyncClient):
        """Un client recevrait le catalogue qu'il publie lui-même."""
        entetes = await auth_headers(client)  # BASE_USER : client

        reponse = await client.put("/api/job-alerts", json={}, headers=entetes)

        assert reponse.status_code == 403

    async def test_une_categorie_inconnue_est_refusee(self, client: AsyncClient):
        """Sinon la normalisation en ferait « general », donc toute la liste."""
        entetes = await auth_headers(client, WORKER_USER)

        reponse = await client.put(
            "/api/job-alerts", json={"category": "astrologie"}, headers=entetes
        )

        assert reponse.status_code == 422
        assert "astrologie" in reponse.text

    async def test_la_coupure_garde_les_criteres(self, client: AsyncClient):
        """Le lien d'un email ne fait pas perdre un réglage."""
        entetes = await auth_headers(client, WORKER_USER)
        await client.put(
            "/api/job-alerts", json={"category": "plumbing"}, headers=entetes
        )

        coupee = await client.delete("/api/job-alerts", headers=entetes)

        assert coupee.status_code == 200
        assert coupee.json()["active"] is False
        assert coupee.json()["category"] == "plumbing"


class TestLaProvenance:
    """D'où vient une veille — le fait que ce champ existe pour produire.

    Une alerte se crée toujours depuis `/jobs` : la page d'ARRIVÉE ne dit donc
    rien de l'acquisition. C'est la page de DÉPART qu'on enregistre, déclarée
    par le lien (`&origine=ville|metier`, cf. `kojo_pages_metier.lien_alerte`),
    et une alerte n'a qu'une provenance : celle de sa CRÉATION.
    """

    async def test_la_provenance_est_ecrite_a_la_creation(self, client: AsyncClient):
        entetes = await auth_headers(client, WORKER_USER)

        reponse = await client.put(
            "/api/job-alerts",
            json={"city": "Bamako", "origin": "ville"},
            headers=entetes,
        )

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["origin"] == "ville"
        # Relu par la route de lecture, donc aussi écrite en base.
        assert (await client.get("/api/job-alerts", headers=entetes)).json()["origin"] == "ville"

    async def test_un_reglage_ulterieur_ne_reecrit_pas_la_provenance(
        self, client: AsyncClient
    ):
        """Sinon la mesure décrirait la dernière visite, pas l'acquisition."""
        entetes = await auth_headers(client, WORKER_USER)
        await client.put(
            "/api/job-alerts",
            json={"category": "plumbing", "origin": "metier"},
            headers=entetes,
        )

        seconde = await client.put(
            "/api/job-alerts",
            json={"category": "electrical", "city": "Dakar", "origin": "directe"},
            headers=entetes,
        )

        assert seconde.status_code == 200, seconde.text
        assert seconde.json()["category"] == "electrical"
        # Le réglage a changé, l'origine NON.
        assert seconde.json()["origin"] == "metier"

    async def test_une_provenance_inconnue_est_refusee(self, client: AsyncClient):
        """Un client qui ment ne doit pas être replié en silence sur « directe »."""
        entetes = await auth_headers(client, WORKER_USER)

        reponse = await client.put(
            "/api/job-alerts",
            json={"city": "Dakar", "origin": "facebook"},
            headers=entetes,
        )

        assert reponse.status_code == 422
        assert "facebook" in reponse.text
        # Le refus porte sur la REQUÊTE : aucun critère n'a été enregistré.
        assert (await client.get("/api/job-alerts", headers=entetes)).json()["active"] is False

    async def test_un_client_muet_n_est_pas_compte_comme_direct(self, client: AsyncClient):
        """Une version d'avant le champ ne sait pas d'où elle vient : on le dit."""
        entetes = await auth_headers(client, WORKER_USER)

        reponse = await client.put(
            "/api/job-alerts", json={"city": "Bamako"}, headers=entetes
        )

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["origin"] == "inconnue"
        # Et « inconnue » n'est pas une valeur qu'un client peut DÉCLARER.
        refus = await client.put(
            "/api/job-alerts",
            json={"city": "Bamako", "origin": "inconnue"},
            headers=entetes,
        )
        assert refus.status_code == 422

    def test_le_vocabulaire_est_celui_que_le_client_declare(self):
        """Deux applications déployées séparément : c'est ce cas qui les tient ensemble.

        Le client (`frontend/src/config/provenance-alerte.js`) tombe sur
        « directe » quand il ne reconnaît pas une valeur, et n'envoie donc
        jamais autre chose. Si les deux listes divergent, une origine légitime
        côté client serait refusée ici en 422 — la carte ne s'enregistrerait
        plus, sans que rien ne le dise.
        """
        import re
        from pathlib import Path

        from kojo_job_alerts import ORIGINE_ABSENTE, ORIGINES_ALERTE

        source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "config"
            / "provenance-alerte.js"
        ).read_text(encoding="utf-8")
        declaration = re.search(r"ORIGINES_ALERTE\s*=\s*\[([^\]]*)\]", source)
        assert declaration, (
            "provenance-alerte.js n'exporte plus ORIGINES_ALERTE : le client ne dit donc plus "
            "lequel des trois vocables il emploie, et ce garde ne mesure plus rien"
        )
        client = re.findall(r"'([a-z]+)'", declaration.group(1))

        assert client == list(ORIGINES_ALERTE), (
            f"le client déclare {client}, le serveur accepte {list(ORIGINES_ALERTE)}"
        )
        # « inconnue » est une valeur de DOCUMENT, jamais une valeur d'entrée :
        # aucun client ne doit pouvoir s'en réclamer.
        assert ORIGINE_ABSENTE not in ORIGINES_ALERTE


class TestCorrespondance:
    def test_les_trois_criteres_filtrent_et_un_absent_ne_filtre_rien(self):
        from kojo_job_alerts import correspond

        mission = _mission("m-1")

        assert correspond({"country": "senegal"}, mission) is True
        assert correspond({"category": "plumbing", "city": "Dakar"}, mission) is True
        assert correspond({"category": "electrical"}, mission) is False
        assert correspond({"city": "Abidjan"}, mission) is False
        assert correspond({"country": "senegal", "city": "dakar"}, mission) is True

    def test_une_mission_fermee_ou_supprimee_ne_correspond_pas(self):
        from kojo_job_alerts import correspond

        assert correspond({"country": "senegal"}, _mission("m-2", status="completed")) is False
        assert correspond({"country": "senegal"}, _mission("m-3", deleted=True)) is False

    def test_une_categorie_absente_ne_matche_pas_une_veille_de_categorie(self):
        from kojo_job_alerts import correspond

        assert correspond({"category": "plumbing"}, {"category": "", "status": "open"}) is False


async def _veille_reelle(client, entetes=None):
    """La veille créée par la ROUTE, datée d'HIER.

    La route écrit `created_at = maintenant` (l'horloge réelle) ; la fenêtre
    du résumé part de là, donc une mission datée du début du test serait
    « antérieure à la veille » et ne partirait jamais. On recule la date :
    c'est l'état d'une veille qui existe depuis un jour, pas un contournement
    de la règle.

    La route authentifie le VRAI compte de `WORKER_USER` : c'est ce qui permet
    à `notify_user` de trouver un destinataire (compte supprimé = aucune
    notification). `entetes` sert au test qui a DÉJÀ ouvert la session :
    `auth_headers` INSCRIT le compte, donc l'appeler deux fois échoue sur
    « adresse déjà utilisée ».
    """
    entetes = entetes or await auth_headers(client, WORKER_USER)
    reponse = await client.put(
        "/api/job-alerts", json={"category": "plumbing"}, headers=entetes
    )
    assert reponse.status_code == 200, reponse.text
    from kojo_core import db

    await db.job_alerts.update_one(
        {"active": True}, {"$set": {"created_at": MAINTENANT - timedelta(days=1)}}
    )
    return await db.job_alerts.find_one({"active": True})


class TestResume:
    async def test_un_passage_envoie_les_missions_CORRESPONDANTES_une_seule_fois(
        self, client: AsyncClient
    ):
        veille = await _veille_reelle(client)
        await db_insert("jobs", _mission("mission-plomberie"))
        await db_insert("jobs", _mission("mission-electricite", category="electrical"))
        await db_insert(
            "jobs", _mission("mission-ancienne", posted_at=MAINTENANT - timedelta(days=3))
        )

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            email.return_value = {"ok": True}
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["envoyes"] == 1
        assert resume["missions"] == 1
        assert email.await_count == 1
        destinataire, sujet, corps = email.await_args.args
        assert destinataire == veille["email"]
        assert "1 nouvelle mission" in sujet
        # La bonne mission, et seulement elle : ni l'électricité ni l'ancienne.
        assert "Réfection mission-plomberie" in corps
        assert "mission-electricite" not in corps
        assert "mission-ancienne" not in corps
        # Le lien de désinscription porte le jeton de LA veille.
        assert f"unsubscribe?token={veille['token']}" in corps

        # SECOND passage : la même mission ne repart pas.
        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as encore:
            resume2 = await passage_digest(MAINTENANT + timedelta(hours=2))
        assert resume2["envoyes"] == 0
        assert resume2["vides"] == 1
        assert encore.await_count == 0

    async def test_sans_correspondance_rien_ne_part_et_la_fenetre_n_avance_pas(
        self, client: AsyncClient
    ):
        from kojo_core import db

        veille = await _veille_reelle(client)
        await db_insert("jobs", _mission("mission-electricite", category="electrical"))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["vides"] == 1 and resume["envoyes"] == 0
        assert email.await_count == 0
        apres = await db.job_alerts.find_one({"user_id": veille["user_id"]})
        assert apres.get("last_notified_at") is None
        assert apres.get("last_checked_at") is not None

    async def test_une_adresse_retenue_n_est_pas_un_envoi_et_ne_coupe_rien(
        self, client: AsyncClient
    ):
        from kojo_core import db

        veille = await _veille_reelle(client)
        await db_insert("jobs", _mission("mission-plomberie"))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            email.return_value = None  # point de règle : adresse retenue / envoi off
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["non_envoyes"] == 1 and resume["envoyes"] == 0
        apres = await db.job_alerts.find_one({"user_id": veille["user_id"]})
        assert apres.get("active") is True
        assert apres.get("sent_count") == 1

    async def test_une_erreur_d_envoi_n_arrete_pas_les_autres_veilles(
        self, client: AsyncClient
    ):
        await _veille_reelle(client)
        await db_insert("job_alerts", _veille("autre-compte", email="autre@kojo.sn"))
        await db_insert("jobs", _mission("mission-plomberie"))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            email.side_effect = [RuntimeError("fournisseur muet"), {"ok": True}]
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["erreurs"] == 1
        assert resume["envoyes"] == 1


class TestNotificationInApp:
    """Le canal qui ne dépend ni d'une adresse joignable ni du fournisseur email."""

    async def test_le_passage_depose_une_notification_qui_renvoie_a_la_liste(
        self, client: AsyncClient
    ):
        from kojo_core import db

        veille = await _veille_reelle(client)
        await db_insert("jobs", _mission("mission-plomberie"))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email, patch(
            "kojo_shared.send_web_push_to_user", new_callable=AsyncMock
        ) as push:
            email.return_value = {"ok": True}
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["notifies"] == 1

        notifications = await db.notifications.find(
            {"user_id": veille["user_id"]}
        ).to_list(None)
        assert len(notifications) == 1
        notification = notifications[0]
        assert notification["type"] == "job_alert"
        assert notification["related_type"] == "job_alert"
        # La mission est NOMMÉE, et le titre porte le compte.
        assert "Réfection mission-plomberie" in notification["body"]
        assert "1 nouvelle mission" in notification["title"]

        # Le push porte la CIBLE et l'identifiant SERVEUR : sans ce dernier, la
        # ligne affichée au premier plan ne peut être ni marquée lue ni
        # supprimée (elle porte un identifiant inventé côté client).
        assert push.await_count == 1
        charge = push.await_args.kwargs["data"]
        assert charge["url"] == "/jobs"
        assert charge["notification_id"] == notification["id"]

    async def test_une_adresse_retenue_recoit_quand_meme_la_notification(
        self, client: AsyncClient
    ):
        """Le point de la demande : l'email est retenu, la veille atteint quand même."""
        from kojo_core import db

        veille = await _veille_reelle(client)
        await db_insert("jobs", _mission("mission-plomberie"))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            email.return_value = None  # adresse retenue / EMAIL_PROVIDER=none
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["non_envoyes"] == 1
        assert resume["notifies"] == 1
        assert await db.notifications.count_documents({"user_id": veille["user_id"]}) == 1

    async def test_un_second_passage_ne_renvoie_pas_la_meme_notification(
        self, client: AsyncClient
    ):
        from kojo_core import db

        veille = await _veille_reelle(client)
        await db_insert("jobs", _mission("mission-plomberie"))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            email.return_value = {"ok": True}
            await passage_digest(MAINTENANT + timedelta(hours=1))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            email.return_value = {"ok": True}
            second = await passage_digest(MAINTENANT + timedelta(hours=2))

        assert second["notifies"] == 0
        assert await db.notifications.count_documents({"user_id": veille["user_id"]}) == 1

    async def test_sans_correspondance_aucune_notification_n_est_deposee(
        self, client: AsyncClient
    ):
        from kojo_core import db

        veille = await _veille_reelle(client)
        await db_insert("jobs", _mission("mission-electricite", category="electrical"))

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email:
            email.return_value = {"ok": True}
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["vides"] == 1 and resume["notifies"] == 0
        assert await db.notifications.count_documents({"user_id": veille["user_id"]}) == 0


class TestComptesCouverts:
    """Ce que la veille DIT couvrir — la règle de l'anti-doublon, seule."""

    async def test_seule_une_veille_active_qui_repond_aux_criteres_couvre(
        self, client: AsyncClient
    ):
        from kojo_job_alerts import comptes_couverts

        await db_insert("job_alerts", _veille("compte-actif"))
        # Coupée : elle ne recevra rien, donc elle ne doit pas faire taire le push.
        await db_insert("job_alerts", _veille("compte-coupe", active=False))
        # Active mais ailleurs : le résumé ne contiendra jamais cette mission.
        await db_insert("job_alerts", _veille("compte-ailleurs", country="cote_divoire"))

        couverts = await comptes_couverts(
            ["compte-actif", "compte-coupe", "compte-ailleurs", "sans-veille"],
            _mission("m-couvert"),
        )

        assert couverts == {"compte-actif"}

    async def test_une_liste_vide_n_interroge_meme_pas_la_base(self):
        from kojo_job_alerts import comptes_couverts

        assert await comptes_couverts([], _mission("m-1")) == set()
        assert await comptes_couverts(None, _mission("m-1")) == set()


class TestPasDeDoublon:
    """Une mission ne prévient JAMAIS deux fois le même travailleur.

    Deux producteurs annoncent une mission : le push de publication
    (`_notify_matching_workers`, spécialité ou pays) et la veille emploi (le
    résumé périodique). Ils se recouvraient — le même compte recevait le push,
    puis moins d'une heure après le résumé de la MÊME mission. La règle mesurée
    ici est celle qui les sépare : la veille ACTIVE qui couvre la mission PORTE
    l'annonce, et le push de publication se tait pour ce compte.

    Le PRIX de cette règle est mesuré aussi, pas seulement écrit : la veille
    coupe l'annonce à sa source, donc un travailleur qui coupe sa veille entre la
    publication et le résumé n'est prévenu par PERSONNE (test plus bas). C'est le
    prix assumé du silence sans état par couple, et il est DÉFINITIF pour cette
    mission : réactiver repart d'une fenêtre neuve.
    """

    async def _travailleur_plombier(self, client: AsyncClient):
        """Le compte, ses en-têtes et un profil que le push viserait forcément."""
        entetes = await auth_headers(client, WORKER_USER)
        reponse = await client.put(
            "/api/workers/profile",
            json={"user_id": "x", "specialties": ["plomberie"], "portfolio_images": []},
            headers=entetes,
        )
        assert reponse.status_code == 200, reponse.text
        compte = await db_find_one("users", {"email": WORKER_USER["email"]})
        return compte["id"], entetes

    def _mission_de_plomberie(self):
        from kojo_models import Job

        return Job(
            client_id="client-alertes",
            title="Fuite d'eau à Dakar",
            description="Réparer une fuite sous l'évier, intervention rapide.",
            category="plumbing",
            country="senegal",
            budget_min=10000,
            budget_max=30000,
            location={"address": "Dakar Plateau", "city": "Dakar"},
        )

    async def test_la_veille_qui_couvre_la_mission_prend_l_annonce_et_une_seule_fois(
        self, client: AsyncClient
    ):
        from kojo_core import db
        from kojo_routers_jobs_creation import _notify_matching_workers

        worker_id, entetes = await self._travailleur_plombier(client)
        # Veille « plumbing », active, datée d'hier : elle couvre la mission.
        veille = await _veille_reelle(client, entetes)
        assert veille["user_id"] == worker_id

        mission = self._mission_de_plomberie()

        # 1) Le push de publication ne parle PAS : la veille couvre la mission.
        with patch(
            "kojo_job_effects.notify_user_localized", new_callable=AsyncMock
        ) as push:
            await _notify_matching_workers(mission)

        assert push.await_count == 0

        # 2) La veille annonce la mission, une seule fois, sur ses deux canaux.
        await db_insert("jobs", _mission(mission.id, title="Fuite d'eau à Dakar"))
        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email, patch("kojo_shared.send_web_push_to_user", new_callable=AsyncMock):
            email.return_value = {"ok": True}
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["notifies"] == 1 and resume["envoyes"] == 1
        assert email.await_count == 1
        notifications = await db.notifications.find({"user_id": worker_id}).to_list(None)
        assert len(notifications) == 1
        assert notifications[0]["related_type"] == "job_alert"
        assert "Fuite d'eau à Dakar" in notifications[0]["body"]

        # 3) Et le passage SUIVANT ne répète rien : une mission, une annonce.
        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as encore:
            encore.return_value = {"ok": True}
            second = await passage_digest(MAINTENANT + timedelta(hours=2))

        assert second["notifies"] == 0 and second["envoyes"] == 0
        assert await db.notifications.count_documents({"user_id": worker_id}) == 1
        assert encore.await_count == 0

    async def test_une_veille_qui_ne_couvre_pas_la_mission_ne_mute_pas_le_push(
        self, client: AsyncClient
    ):
        """Le silence ne doit pas déborder sur les comptes que la veille ne sert pas."""
        from kojo_routers_jobs_creation import _notify_matching_workers

        worker_id, entetes = await self._travailleur_plombier(client)
        # Veille « électricité » : elle ne recevra jamais cette plomberie.
        await client.put(
            "/api/job-alerts", json={"category": "electrical"}, headers=entetes
        )

        with patch(
            "kojo_job_effects.notify_user_localized", new_callable=AsyncMock
        ) as push:
            await _notify_matching_workers(self._mission_de_plomberie())

        destinataires = {appel.kwargs.get("user_id") for appel in push.await_args_list}
        assert worker_id in destinataires

    async def test_sans_veille_le_push_de_publication_reste_seul(
        self, client: AsyncClient
    ):
        from kojo_routers_jobs_creation import _notify_matching_workers

        worker_id, _ = await self._travailleur_plombier(client)

        with patch(
            "kojo_job_effects.notify_user_localized", new_callable=AsyncMock
        ) as push:
            await _notify_matching_workers(self._mission_de_plomberie())

        destinataires = {appel.kwargs.get("user_id") for appel in push.await_args_list}
        assert worker_id in destinataires

    async def test_couper_la_veille_entre_la_publication_et_le_resume_perd_l_annonce(
        self, client: AsyncClient
    ):
        """Le prix de l'anti-doublon, MESURÉ : la mission ne prévient personne.

        Trois faits, dans l'ordre où ils arrivent en production :
          1. la veille active couvre la mission, donc le push de publication se
             tait (c'est la règle qu'on mesure ici) ;
          2. le travailleur coupe sa veille AVANT le résumé — geste ordinaire, il
             a trouvé du travail ou ne veut plus d'emails ;
          3. le résumé ne lit que les veilles ACTIVES : la mission n'est annoncée
             ni par le push (muselé), ni par le résumé (plus de veille).
        La perte est DÉFINITIVE pour cette mission : la réactivation repart de
        MAINTENANT, donc une mission plus ancienne que la nouvelle fenêtre ne
        revient pas. Ce test existe pour que ce prix soit un fait vérifié, pas
        une phrase dans un commentaire — si la règle change (au profit d'un état
        par couple), c'est cette mesure qui doit changer avec elle.
        """
        from kojo_core import db
        from kojo_routers_jobs_creation import _notify_matching_workers

        worker_id, entetes = await self._travailleur_plombier(client)
        veille = await _veille_reelle(client, entetes)
        assert veille["user_id"] == worker_id

        mission = self._mission_de_plomberie()

        # 1) La veille couvre la mission : le push de publication se tait.
        with patch(
            "kojo_job_effects.notify_user_localized", new_callable=AsyncMock
        ) as push:
            await _notify_matching_workers(mission)
        assert push.await_count == 0

        # 2) Le travailleur coupe sa veille avant le résumé — par la ROUTE, pas
        # par une écriture directe en base : c'est le geste de l'utilisateur.
        coupee = await client.delete("/api/job-alerts", headers=entetes)
        assert coupee.status_code == 200, coupee.text
        assert coupee.json()["active"] is False
        # La coupure garde les critères (elle est réversible) : ce n'est pas la
        # suppression de la veille, c'est sa mise en pause.
        assert coupee.json()["category"] == "plumbing"

        await db_insert("jobs", _mission(mission.id, title="Fuite d'eau à Dakar"))

        # 3) Aucune veille active à servir : la mission n'est annoncée par rien.
        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email, patch("kojo_shared.send_web_push_to_user", new_callable=AsyncMock):
            email.return_value = {"ok": True}
            resume = await passage_digest(MAINTENANT + timedelta(hours=1))

        assert resume["alertes"] == 0  # la veille coupée n'est même pas lue
        assert resume["notifies"] == 0 and resume["envoyes"] == 0
        assert email.await_count == 0
        assert await db.notifications.count_documents({"user_id": worker_id}) == 0
        # La fenêtre n'a pas bougé non plus : rien n'a été délivré, donc rien
        # n'est marqué comme tel.
        apres_coupure = await db.job_alerts.find_one({"user_id": worker_id})
        assert apres_coupure.get("last_notified_at") is None
        assert apres_coupure.get("sent_count") == 0

        # 4) La perte est DÉFINITIVE : réactiver repart de maintenant.
        reactivee = await client.put(
            "/api/job-alerts",
            json={"category": "plumbing", "active": True},
            headers=entetes,
        )
        assert reactivee.status_code == 200, reactivee.text
        assert reactivee.json()["active"] is True

        with patch(
            "kojo_job_alerts.send_email_via_active_provider", new_callable=AsyncMock
        ) as email_apres, patch(
            "kojo_shared.send_web_push_to_user", new_callable=AsyncMock
        ):
            email_apres.return_value = {"ok": True}
            apres = await passage_digest(MAINTENANT + timedelta(hours=2))

        assert apres["alertes"] == 1  # la veille revit…
        assert apres["vides"] == 1  # …mais la mission est hors de sa fenêtre
        assert apres["notifies"] == 0 and apres["envoyes"] == 0
        assert email_apres.await_count == 0
        assert await db.notifications.count_documents({"user_id": worker_id}) == 0


class TestDesinscription:
    async def test_le_jeton_coupe_la_veille_et_un_jeton_inconnu_ne_coupe_rien(
        self, client: AsyncClient
    ):
        from kojo_core import db

        await db_insert("job_alerts", _veille("compte-1", token="jeton-connu"))

        inconnu = await client.get("/api/job-alerts/unsubscribe?token=inconnu")

        assert inconnu.status_code == 404
        assert "noindex" in inconnu.text
        intacte = await db.job_alerts.find_one({"user_id": "compte-1"})
        assert intacte.get("active") is True

        valide = await client.get("/api/job-alerts/unsubscribe?token=jeton-connu")

        assert valide.status_code == 200
        assert "désactivée" in valide.text
        coupee = await db.job_alerts.find_one({"user_id": "compte-1"})
        assert coupee.get("active") is False
