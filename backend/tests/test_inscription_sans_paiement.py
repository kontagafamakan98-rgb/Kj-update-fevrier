# -*- coding: utf-8 -*-
"""Régression : un compte existe AVANT d'avoir des moyens de paiement.

Le défaut que ce test verrouille (22/10/2026)
---------------------------------------------
`UserWithPayment.payment_accounts` était OBLIGATOIRE, et
`validate_payment_accounts` levait un 400 sous 1 compte (client) ou 2 comptes
(travailleur). Comme `registerVerified` n'était appelé QUE depuis l'étape
« comptes de paiement », un travailleur devait saisir deux numéros mobile money
valides avant que son compte existe — au moment précis où le produit ne lui a
encore rien donné. C'était la barrière la plus chère du parcours, et la
première cause probable des deux travailleurs mesurés en production.

Ce qui est verrouillé ici
-------------------------
1. l'inscription réussit SANS aucun compte, et le DIT (`is_verified: False`) ;
2. la FORME reste jugée (numéro invalide, Wave hors canal opéré) : on ne
   troque pas une barrière contre un contrôle perdu ;
3. `is_verified` ne ment plus — vrai seulement quand le minimum du rôle est
   atteint (1 compte pour un client, 2 pour un travailleur) ;
4. l'AJOUT de comptes garde son minimum (`PUT /users/payment-accounts`) ;
5. la garantie qui protège l'argent reste là où elle vit : un décaissement
   sans compte n'a rien à débiter (`get_mobile_money_account` → `(None, None)`),
   et les appelants lèvent leur 400.

Ce que ce test ne prouve pas : que l'ÉCRAN enchaîne bien l'inscription sans
l'étape paiement (c'est le test de `EmailVerificationPage`, côté frontend).
"""
import pytest
from httpx import AsyncClient

from kojo_payments import get_mobile_money_account
from tests.conftest import (
    BASE_USER,
    WORKER_USER,
    issue_email_verification_token,
)


def _sans_comptes(base: dict, email: str) -> dict:
    """Le même compte, sans le champ `payment_accounts` du tout."""
    data = {cle: valeur for cle, valeur in base.items() if cle != "payment_accounts"}
    data["email"] = email
    return data


async def _inscrire(client: AsyncClient, data: dict):
    token = await issue_email_verification_token(client, data["email"])
    return await client.post(
        "/api/auth/register-verified",
        json={**data, "email_verification_token": token},
    )


@pytest.mark.asyncio
class TestInscriptionSansComptesDePaiement:
    async def test_un_client_sans_compte_est_cree_et_non_verifie(self, client: AsyncClient):
        reponse = await _inscrire(client, _sans_comptes(BASE_USER, "client-sans-compte@kojo.sn"))

        assert reponse.status_code == 200, reponse.text
        corps = reponse.json()
        assert "access_token" in corps, "le compte créé ouvre une session"
        assert "password_hash" not in corps["user"]
        assert corps["user"]["payment_accounts_count"] == 0
        assert corps["user"]["is_verified"] is False, (
            "un compte sans moyen de paiement ne peut pas être annoncé vérifié"
        )
        assert corps["payment_verification"]["linked_accounts"] == 0

    async def test_un_travailleur_sans_compte_est_cree(self, client: AsyncClient):
        reponse = await _inscrire(client, _sans_comptes(WORKER_USER, "worker-sans-compte@kojo.sn"))

        assert reponse.status_code == 200, reponse.text
        assert reponse.json()["user"]["user_type"] == "worker"
        assert reponse.json()["user"]["is_verified"] is False

    async def test_deux_comptes_valides_rendent_le_travailleur_verifie(self, client: AsyncClient):
        reponse = await _inscrire(
            client, {**WORKER_USER, "email": "worker-deux-comptes@kojo.sn"}
        )

        assert reponse.status_code == 200, reponse.text
        user = reponse.json()["user"]
        assert user["payment_accounts_count"] == 2
        assert user["is_verified"] is True, (
            "le minimum du rôle atteint doit être dit vrai — le sens inverse du défaut"
        )

    async def test_un_seul_compte_cree_le_compte_mais_ne_verifie_pas(self, client: AsyncClient):
        reponse = await _inscrire(client, {
            **WORKER_USER,
            "email": "worker-un-compte@kojo.sn",
            "payment_accounts": {"orange_money": "+221771234567"},
        })

        assert reponse.status_code == 200, reponse.text
        user = reponse.json()["user"]
        assert user["payment_accounts_count"] == 1
        assert user["is_verified"] is False

    async def test_un_numero_invalide_reste_refuse_a_l_inscription(self, client: AsyncClient):
        reponse = await _inscrire(client, {
            **BASE_USER,
            "email": "numero-invalide@kojo.sn",
            "payment_accounts": {"orange_money": "12"},
        })

        assert reponse.status_code == 400
        assert "Orange Money" in reponse.json()["detail"]

    async def test_wave_reste_refuse_hors_des_canaux_operes(self, client: AsyncClient):
        reponse = await _inscrire(client, {
            **WORKER_USER,
            "email": "worker-mali-wave@kojo.sn",
            "country": "mali",
            "payment_accounts": {
                "orange_money": "+22370123456",
                "wave": "+22370123457",
            },
        })

        assert reponse.status_code == 400
        assert "Wave" in reponse.json()["detail"]

    async def test_ajouter_un_seul_compte_a_un_travailleur_reste_refuse(self, client: AsyncClient):
        """Le minimum n'est pas supprimé, il est DÉPLACÉ : l'ajout le porte."""
        inscription = await _inscrire(client, _sans_comptes(WORKER_USER, "worker-ajout@kojo.sn"))
        assert inscription.status_code == 200, inscription.text
        entetes = {"Authorization": f"Bearer {inscription.json()['access_token']}"}

        maj = await client.put(
            "/api/users/payment-accounts",
            json={"orange_money": "+221771234567"},
            headers=entetes,
        )

        assert maj.status_code == 400
        assert "2 moyens" in maj.json()["detail"]


class TestLaGarantieQuiProtegeLArgent:
    def test_un_decaissement_sans_compte_n_a_rien_a_debiter(self):
        assert get_mobile_money_account(None) == (None, None)
        assert get_mobile_money_account({}) == (None, None)

    def test_un_compte_renseigne_reste_utilisable(self):
        assert get_mobile_money_account({"orange_money": "+221771234567"}) == (
            "orange_money",
            "+221771234567",
        )
        assert get_mobile_money_account({"wave": "+221771234568"}) == (
            "wave",
            "+221771234568",
        )
