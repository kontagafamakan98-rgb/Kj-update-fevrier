"""Audit des documents legacy (kojo_legacy_audit) : lecture seule, rapport sans valeurs."""

import json

import pytest

from kojo_legacy_audit import auditer_base, auditer_documents
from kojo_models import JobPublic, User

UTILISATEUR_VALIDE = {
    "id": "u-valide",
    "email": "awa@kojo.sn",
    "first_name": "Awa",
    "last_name": "Diallo",
    "user_type": "client",
    "country": "senegal",
    "preferred_language": "fr",
}

JOB_VALIDE = {
    "id": "j-valide",
    "title": "Réparer un robinet",
    "description": "Fuite sous l'évier",
    "category": "plomberie",
    "location": {"address": "Dakar"},
}


def test_un_document_valide_n_est_pas_compte_comme_invalide():
    rapport = auditer_documents([UTILISATEUR_VALIDE], User, "users")
    assert rapport["total"] == 1
    assert rapport["invalides"] == 0
    assert rapport["exemples"] == []


def test_un_document_invalide_est_signale_par_identifiant_et_champ():
    legacy = {**UTILISATEUR_VALIDE, "id": "u-legacy", "first_name": "A"}  # min_length = 2
    rapport = auditer_documents([legacy], User, "users")
    assert rapport["invalides"] == 1
    assert rapport["exemples"] == [{"id": "u-legacy", "champs": ["first_name"]}]
    assert rapport["champs_en_erreur"] == {"first_name": 1}


def test_le_rapport_ne_contient_aucune_valeur_personnelle():
    """Une valeur invalide (e-mail, nom…) ne doit JAMAIS sortir dans le rapport."""
    marqueur = "fuite-marqueur-prive"
    legacy = {**UTILISATEUR_VALIDE, "id": "u-fuite", "email": marqueur}
    rapport = auditer_documents([legacy], User, "users")
    assert rapport["invalides"] == 1
    assert marqueur not in json.dumps(rapport, ensure_ascii=False)


def test_une_fiche_publique_sans_localisation_est_signalee():
    sans_lieu = {k: v for k, v in JOB_VALIDE.items() if k != "location"}
    sans_lieu["id"] = "j-legacy"
    rapport = auditer_documents([JOB_VALIDE, sans_lieu], JobPublic, "jobs")
    assert rapport["total"] == 2
    assert rapport["invalides"] == 1
    assert rapport["exemples"][0]["id"] == "j-legacy"
    assert "location" in rapport["exemples"][0]["champs"]


class _Curseur:
    def __init__(self, documents):
        self._documents = documents

    async def to_list(self, length=None):
        return list(self._documents)


class _CollectionLectureSeule:
    """Ne sait que lire : toute écriture lèverait AttributeError dans l'audit."""

    def __init__(self, documents):
        self._documents = documents

    def find(self, *_args, **_kwargs):
        return _Curseur(self._documents)


@pytest.mark.asyncio
async def test_l_audit_ne_fait_que_lire_la_base():
    """Garde de lecture seule : une collection qui n'expose que `find` suffit."""

    class _Base:
        users = _CollectionLectureSeule([UTILISATEUR_VALIDE])
        jobs = _CollectionLectureSeule([JOB_VALIDE])

    rapports = await auditer_base(_Base())

    assert [r["collection"] for r in rapports] == ["users", "jobs"]
    assert all(r["invalides"] == 0 for r in rapports)
