# -*- coding: utf-8 -*-
"""Le repli de la révocation est ASSUMÉ — il n'est plus SILENCIEUX.

POURQUOI CE FICHIER

`is_token_revoked` lit la liste noire (`revoked_tokens`) à chaque requête
authentifiée. Si cette lecture échoue (base lente, coupure), la fonction rend
`False` — c'est-à-dire « ce jeton n'est pas révoqué » : un fail-open DÉLIBÉRÉ,
parce que refuser la lecture reviendrait à déconnecter tout le monde pendant
une panne, alors que `get_current_user` interroge la même base deux lignes plus
loin.

Le défaut que ces cas ferment n'est pas le fail-open : c'est son SILENCE. Un
jeton révoqué (déconnexion, réinitialisation de mot de passe) qui repasse
pendant une panne ne laissait aucune trace — ni compteur, ni horodatage, rien
qui permette de savoir, après coup, que la garantie avait cessé de tenir.

Ce que ces cas ne jugent pas : la politique (fail-open ou fail-closed) — elle
est écrite dans `kojo_auth_core`, et la changer est une décision de produit, pas
une correction de bug.
"""
import pytest

import kojo_auth_core
from kojo_auth_core import is_token_revoked, revocation_stats


class _CollectionQuiTombe:
    """Une collection dont la LECTURE échoue (Mongo injoignable)."""

    async def find_one(self, *args, **kwargs):
        raise RuntimeError("mongo injoignable")


@pytest.fixture(autouse=True)
def _compteurs_neufs(monkeypatch):
    monkeypatch.setattr(
        kojo_auth_core, "REVOCATION_STATS",
        {"verifications": 0, "echecs": 0, "dernier_echec": None},
    )


@pytest.mark.asyncio
async def test_une_panne_est_comptee_et_nommee(monkeypatch):
    """Lecture impossible : le jeton passe, mais la panne est COMPTÉE."""
    monkeypatch.setattr(kojo_auth_core.db, "revoked_tokens", _CollectionQuiTombe())

    revoque = await is_token_revoked("jti-pendant-la-panne")

    assert revoque is False, (
        "le repli reste fail-open (décision écrite dans le module) : c'est la "
        "TRACE qui manquait, pas le comportement"
    )
    stats = revocation_stats()
    assert stats["echecs"] == 1, (
        "un échec non compté rend le repli indiscernable d'une vérification "
        f"réussie (relevé : {stats})"
    )
    assert stats["dernier_echec"], "l'horodatage de la panne doit être lisible"
    assert stats["verifications"] == 0


@pytest.mark.asyncio
async def test_une_lecture_reussie_ne_ressemble_pas_a_une_panne():
    """Non-vacuité : le compteur de vérifications avance sur le chemin normal."""
    rejete = await is_token_revoked("jti-jamais-revoque")
    assert rejete is False

    stats = revocation_stats()
    assert stats["verifications"] == 1
    assert stats["echecs"] == 0, (
        "une lecture réussie ne doit pas être comptée comme une panne — sinon "
        "le relevé ne dirait plus quand la garantie a cessé de tenir"
    )


@pytest.mark.asyncio
async def test_les_deux_releves_sont_independants_du_dict_interne():
    """`revocation_stats` rend une COPIE : un appelant ne peut pas le fausser."""
    releve = revocation_stats()
    releve["echecs"] = 999
    assert revocation_stats()["echecs"] == 0
