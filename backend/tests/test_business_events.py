"""Événements métier : journal append-only des jalons de mission.

Deux familles de tests :
- le helper `kojo_business_events.enregistrer_evenement`, sur une collection
  factice qui applique la même contrainte d'unicité que l'index `cle` ;
- le câblage des quatre jalons (création, acceptation, paiement confirmé, fin
  de mission) dans les modules qui les écrivent. Un jalon non branché ne fait
  rougir aucun test fonctionnel : le câblage est donc vérifié par le source.
"""

import re
from pathlib import Path

import pytest
from pymongo.errors import DuplicateKeyError

import kojo_business_events
from kojo_business_events import TYPES_EVENEMENTS, enregistrer_evenement

BACKEND_DIR = Path(__file__).resolve().parent.parent

CHAMPS_ATTENDUS = {"id", "type", "cle", "user_id", "job_id", "proposal_id", "payment_id", "created_at"}


class CollectionFactice:
    """Collection en mémoire : `cle` unique, comme l'index créé dans kojo_db."""

    def __init__(self):
        self.documents = []

    async def insert_one(self, document):
        if any(d["cle"] == document["cle"] for d in self.documents):
            raise DuplicateKeyError("E11000 duplicate key on cle")
        self.documents.append(dict(document))


class DbFactice:
    def __init__(self, collection):
        self.business_events = collection


@pytest.fixture
def journal(monkeypatch):
    collection = CollectionFactice()
    monkeypatch.setattr(kojo_business_events, "db", DbFactice(collection))
    return collection


@pytest.mark.asyncio
async def test_premier_evenement_est_enregistre_avec_les_seuls_identifiants(journal):
    nouveau = await enregistrer_evenement(
        "payment_confirmed", "payment_confirmed:p1", user_id="u1", job_id="j1", payment_id="p1"
    )
    assert nouveau is True
    assert len(journal.documents) == 1
    document = journal.documents[0]
    # Aucune donnée personnelle ni montant : seuls le type, la clé, la date et les identifiants.
    assert set(document) == CHAMPS_ATTENDUS
    assert document["type"] == "payment_confirmed"
    assert document["user_id"] == "u1"
    assert document["job_id"] == "j1"
    assert document["payment_id"] == "p1"
    assert document["proposal_id"] is None


@pytest.mark.asyncio
async def test_meme_jalon_compte_une_seule_fois(journal):
    premier = await enregistrer_evenement("mission_completed", "mission_completed:j1", user_id="u1", job_id="j1")
    second = await enregistrer_evenement("mission_completed", "mission_completed:j1", user_id="u1", job_id="j1")
    assert premier is True
    assert second is False
    assert len(journal.documents) == 1


@pytest.mark.asyncio
async def test_defaillance_d_ecriture_ne_leve_pas_et_est_journalisee(caplog, monkeypatch):
    class CollectionEnPanne:
        async def insert_one(self, document):
            raise ConnectionError("mongo indisponible")

    monkeypatch.setattr(kojo_business_events, "db", DbFactice(CollectionEnPanne()))
    with caplog.at_level("ERROR"):
        resultat = await enregistrer_evenement("mission_created", "mission_created:j1", user_id="u1", job_id="j1")
    # Le flux métier appelant doit continuer : l'événement est un constat, pas une condition.
    assert resultat is False
    assert "mission_created:j1" in caplog.text


@pytest.mark.asyncio
async def test_type_inconnu_est_une_erreur_de_programmation(journal):
    with pytest.raises(ValueError):
        await enregistrer_evenement("mission_supprimee", "x:1", user_id="u1", job_id="j1")
    assert journal.documents == []


def test_les_quatre_jalons_sont_declares():
    assert TYPES_EVENEMENTS == {
        "mission_created",
        "proposal_accepted",
        "payment_confirmed",
        "mission_completed",
    }


def _source(nom):
    return (BACKEND_DIR / nom).read_text(encoding="utf-8")


def test_creation_de_mission_emet_mission_created():
    assert re.search(r'enregistrer_evenement\(\s*"mission_created"', _source("kojo_routers_jobs_creation.py"))


def test_acceptation_de_proposition_emet_proposal_accepted():
    assert re.search(r'enregistrer_evenement\(\s*"proposal_accepted"', _source("kojo_routers_jobs_proposals.py"))


def test_confirmation_de_paiement_emet_payment_confirmed_a_la_transition():
    source = _source("kojo_payments.py")
    assert re.search(r"enregistrer_evenement\(\s*'payment_confirmed'", source)
    # Gardé par la transition : jamais sur une confirmation déjà enregistrée.
    assert re.search(r"if local_status == 'completed' and not payment_record\.get\('completed_at'\):", source)


def test_fin_de_mission_passe_par_un_seul_helper_qui_journalise():
    source = _source("kojo_routers_jobs_completion.py")
    assert re.search(r'enregistrer_evenement\(\s*"mission_completed"', source)
    # Les trois écritures `completed` passent par le helper : aucune n'écrit le statut à part.
    ecritures_brutes = re.findall(r'"\$set": \{"status": JobStatus\.COMPLETED\.value\}', source)
    assert len(ecritures_brutes) == 1, "seule la définition de _marquer_terminee écrit le statut"
    assert source.count('await _marquer_terminee(job_id, job.get("client_id"))') == 3


# ── Vue propriétaire : journal d'une mission (GET /owner/missions/{id}/evenements) ──

from datetime import datetime, timedelta, timezone  # noqa: E402
from unittest.mock import patch  # noqa: E402

from tests.conftest import BASE_USER, db_insert, register_and_login  # noqa: E402


def _evenement(job_id: str, type_evenement: str, decalage_min: int, **extra) -> dict:
    instant = datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=decalage_min)
    return {
        "id": f"evt-{job_id}-{type_evenement}",
        "type": type_evenement,
        "cle": f"{type_evenement}:{job_id}",
        "user_id": extra.pop("user_id", "client-1"),
        "job_id": job_id,
        "proposal_id": None,
        "payment_id": None,
        "created_at": instant.isoformat(),
        "secret_fournisseur": "ne-doit-pas-sortir",
        **extra,
    }


@pytest.mark.asyncio
async def test_owner_voit_le_journal_d_une_mission_dans_l_ordre(client):
    owner = await register_and_login(client, BASE_USER)
    headers = {"Authorization": f"Bearer {owner['access_token']}"}

    # Deux événements pour la mission visée, insérés dans le désordre, et un pour une autre mission.
    await db_insert("business_events", _evenement("job-vue", "proposal_accepted", 20))
    await db_insert("business_events", _evenement("job-vue", "mission_created", 0))
    await db_insert("business_events", _evenement("job-autre", "mission_created", 5))

    with patch("kojo_owner.OWNER_EMAIL", owner["user"]["email"]), \
         patch("kojo_owner.OWNER_USER_ID", owner["user"]["id"]):
        resp = await client.get("/api/owner/missions/job-vue/evenements", headers=headers)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["job_id"] == "job-vue"
    assert data["count"] == 2
    # Ordre chronologique, et seulement les événements de cette mission.
    assert [e["type"] for e in data["evenements"]] == ["mission_created", "proposal_accepted"]
    # Allowlist : aucun champ hors du journal, pas de _id Mongo.
    for evenement in data["evenements"]:
        assert set(evenement) == CHAMPS_ATTENDUS
        assert evenement["job_id"] == "job-vue"


@pytest.mark.asyncio
async def test_non_owner_ne_lit_pas_le_journal(client):
    user = await register_and_login(client, BASE_USER)
    headers = {"Authorization": f"Bearer {user['access_token']}"}
    await db_insert("business_events", _evenement("job-prive", "mission_created", 0))

    resp = await client.get("/api/owner/missions/job-prive/evenements", headers=headers)

    assert resp.status_code == 403, resp.text
