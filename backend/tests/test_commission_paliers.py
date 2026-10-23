# -*- coding: utf-8 -*-
"""Paliers de commission : ce que le travailleur paie, et ce qu'il LIT.

Trois choses sont mesurées ici, et aucune ne se déduit du code :

  1. la RÉSOLUTION — un travailleur sans mission terminée paie le tarif de
     lancement, un habitué paie le tarif de fidélité, et un palier désactivé
     laisse le taux de croisière intact. Les seuils sont comptés sur les
     missions TERMINÉES (une mission ouverte ou supprimée ne compte pas) ;
  2. le FIGEMENT — le taux et le palier retenus s'écrivent sur le paiement : un
     barème changé après coup ne réécrit pas une facture déjà émise ;
  3. la GARDE — une configuration illisible ou hors bornes ne casse jamais un
     devis : elle retombe sur le taux standard, et l'écriture refusée dit
     quel champ est faux.

Le taux standard lui-même n'est pas recopié : les cas le LISENT
(`get_effective_commission_rate`) au lieu de coder 14 %, sinon changer le
défaut ferait rougir des tests qui ne parlent pas de lui.
"""
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

import kojo_commission
from kojo_payments import get_effective_commission_rate
from tests.conftest import BASE_USER, WORKER_USER, db_find_one, db_insert, register_and_login

TRAVAILLEUR = "worker-palier-1"


async def _missions(worker_id: str, terminees: int, *, ouvertes: int = 0, supprimees: int = 0):
    for index in range(terminees):
        await db_insert("jobs", {
            "id": f"m-terminee-{index}",
            "assigned_worker_id": worker_id,
            "status": "completed",
        })
    for index in range(ouvertes):
        await db_insert("jobs", {
            "id": f"m-ouverte-{index}",
            "assigned_worker_id": worker_id,
            "status": "in_progress",
        })
    for index in range(supprimees):
        await db_insert("jobs", {
            "id": f"m-supprimee-{index}",
            "assigned_worker_id": worker_id,
            "status": "completed",
            "deleted": True,
        })


async def _paliers(**reglages):
    await db_insert("settings", {"type": kojo_commission.TYPE_CONFIG, **reglages})


@pytest.mark.asyncio
class TestResolution:
    async def test_paliers_desactives_laissent_le_taux_de_croisiere(self):
        """Le défaut de la livraison : aucune remise commerciale par effet de bord."""
        with patch("kojo_payments.PAYMENT_COMMISSION_RATE", 0.14):
            resultat = await kojo_commission.resoudre_taux(TRAVAILLEUR)
        assert resultat["taux"] == pytest.approx(0.14)
        assert resultat["palier"] == kojo_commission.PALIER_STANDARD
        assert resultat["motif"] == kojo_commission.MOTIF_DESACTIVES

    async def test_lancement_pour_les_premieres_missions_terminees(self):
        await _paliers(actif=True)
        await _missions(TRAVAILLEUR, terminees=2, ouvertes=3, supprimees=2)
        resultat = await kojo_commission.resoudre_taux(TRAVAILLEUR)
        assert resultat["taux"] == pytest.approx(0.0)
        assert resultat["palier"] == kojo_commission.PALIER_LANCEMENT
        # Les missions ouvertes et supprimées ne comptent pas : 2, pas 7.
        assert resultat["missions_terminees"] == 2

    async def test_standard_une_fois_le_lancement_consomme(self):
        await _paliers(actif=True)
        await _missions(TRAVAILLEUR, terminees=4)
        with patch("kojo_payments.PAYMENT_COMMISSION_RATE", 0.14):
            resultat = await kojo_commission.resoudre_taux(TRAVAILLEUR)
        assert resultat["taux"] == pytest.approx(0.14)
        assert resultat["palier"] == kojo_commission.PALIER_STANDARD
        assert resultat["motif"] == kojo_commission.MOTIF_STANDARD

    async def test_recurrent_au_dela_du_seuil(self):
        await _paliers(actif=True)
        await _missions(TRAVAILLEUR, terminees=12)
        resultat = await kojo_commission.resoudre_taux(TRAVAILLEUR)
        assert resultat["taux"] == pytest.approx(0.08)
        assert resultat["palier"] == kojo_commission.PALIER_RECURRENT
        assert resultat["missions_terminees"] == 12

    async def test_sans_travailleur_le_taux_standard_s_applique(self):
        """Un devis sans travailleur identifié ne peut pas porter un tarif de lancement."""
        await _paliers(actif=True)
        with patch("kojo_payments.PAYMENT_COMMISSION_RATE", 0.14):
            resultat = await kojo_commission.resoudre_taux(None)
        assert resultat["taux"] == pytest.approx(0.14)
        assert resultat["palier"] == kojo_commission.PALIER_STANDARD
        assert resultat["motif"] == kojo_commission.MOTIF_SANS_TRAVAILLEUR

    async def test_un_travailleur_neuf_avec_la_configuration_par_defaut_paie_zero(self):
        """Les valeurs par défaut, une fois ACTIVÉES, font bien ce qu'elles annoncent."""
        await kojo_commission.enregistrer({"actif": True})
        resultat = await kojo_commission.resoudre_taux(TRAVAILLEUR)
        assert resultat["taux"] == pytest.approx(0.0)
        assert resultat["palier"] == kojo_commission.PALIER_LANCEMENT


@pytest.mark.asyncio
class TestGarde:
    async def test_une_lecture_en_panne_retombe_sur_les_defauts(self, monkeypatch):
        async def _panne(*args, **kwargs):
            raise RuntimeError("mongo injoignable")

        monkeypatch.setattr(kojo_commission.db.settings, "find_one", _panne)
        configuration = await kojo_commission.configuration()
        assert configuration["actif"] is False
        # Et la résolution ne lève pas : un devis reste possible.
        with patch("kojo_payments.PAYMENT_COMMISSION_RATE", 0.14):
            resultat = await kojo_commission.resoudre_taux(TRAVAILLEUR)
        assert resultat["taux"] == pytest.approx(0.14)

    async def test_un_taux_hors_bornes_est_refuse_en_le_nommant(self):
        with pytest.raises(ValueError, match="lancement_taux_percent"):
            kojo_commission.normaliser({"lancement_taux_percent": 60})

    async def test_des_seuils_inverses_sont_refuses(self):
        with pytest.raises(ValueError, match="recurrent_missions"):
            kojo_commission.normaliser({"lancement_missions": 10, "recurrent_missions": 5})

    async def test_les_valeurs_absentes_gardent_les_defauts(self):
        configuration = kojo_commission.normaliser({"actif": True})
        assert configuration["lancement_missions"] == kojo_commission.DEFAUTS["lancement_missions"]
        assert configuration["recurrent_taux_percent"] == kojo_commission.DEFAUTS["recurrent_taux_percent"]


@pytest.mark.asyncio
class TestSurfaces:
    async def test_le_devis_publie_le_palier_et_le_montant_qui_en_decoule(self, client: AsyncClient):
        await _paliers(actif=True)
        await _missions(TRAVAILLEUR, terminees=0)

        reponse = await client.post("/api/payments/quote", json={
            "amount": 25000,
            "payment_method": "orange_money",
            "country": "senegal",
            "worker_id": TRAVAILLEUR,
        })

        assert reponse.status_code == 200, reponse.text
        devis = reponse.json()
        assert devis["commission_tier"] == kojo_commission.PALIER_LANCEMENT
        assert devis["commission_amount"] == 0
        assert devis["worker_amount"] == 25000
        assert devis["missions_completed"] == 0

    async def test_le_devis_sans_palier_actif_ne_change_rien(self, client: AsyncClient):
        with patch("kojo_payments.PAYMENT_COMMISSION_RATE", 0.14):
            reponse = await client.post("/api/payments/quote", json={
                "amount": 25000,
                "payment_method": "orange_money",
                "country": "senegal",
                "worker_id": TRAVAILLEUR,
            })
        devis = reponse.json()
        assert devis["commission_amount"] == 3500
        assert devis["commission_tier"] == kojo_commission.PALIER_STANDARD

    async def test_le_checkout_fige_le_taux_et_le_palier_sur_le_paiement(self, client: AsyncClient):
        session = await register_and_login(
            client, {**BASE_USER, "email": "client-palier@kojo.sn"}
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _paliers(actif=True)
        await db_insert("users", {
            "id": TRAVAILLEUR, "email": "worker-palier@kojo.sn",
            "user_type": "worker", "first_name": "Awa",
        })
        await db_insert("jobs", {
            "id": "mission-palier",
            "client_id": session["user"]["id"],
            "assigned_worker_id": TRAVAILLEUR,
            "status": "in_progress",
            "accepted_proposal_id": "proposition-palier",
        })
        await db_insert("job_proposals", {
            "id": "proposition-palier",
            "job_id": "mission-palier",
            "worker_id": TRAVAILLEUR,
            "proposed_amount": 20000,
        })

        facture = {"token": "jeton-palier", "response_code": "00"}
        with patch("kojo_routers_payments.is_paydunya_configured", return_value=True), \
             patch("kojo_routers_payments.create_paydunya_invoice", return_value=facture), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()):
            reponse = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": "mission-palier",
                "amount": 1,
                "payment_method": "orange_money",
                "country": "senegal",
            })

        assert reponse.status_code == 200, reponse.text
        paiement = await db_find_one("payments", {"id": reponse.json()["payment_id"]})
        assert paiement["commission_amount"] == 0
        assert paiement["commission_rate"] == 0
        assert paiement["commission_tier"] == kojo_commission.PALIER_LANCEMENT
        assert paiement["worker_amount"] == 20000

    async def test_les_paliers_se_lisent_et_s_ecrivent_chez_le_proprietaire(self, client: AsyncClient):
        session = await register_and_login(
            client, {**BASE_USER, "email": "owner-palier@kojo.sn", "user_type": "owner"}
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        with patch("kojo_owner.OWNER_EMAIL", session["user"]["email"]), \
             patch("kojo_owner.OWNER_USER_ID", session["user"]["id"]):
            lecture = await client.get("/api/owner/commission-paliers", headers=headers)
            assert lecture.status_code == 200, lecture.text
            assert lecture.json()["paliers"]["actif"] is False
            assert lecture.json()["taux_standard_percent"] > 0

            ecriture = await client.post(
                "/api/owner/commission-paliers",
                headers=headers,
                json={"actif": True, "lancement_missions": 5, "recurrent_taux_percent": 9},
            )
            assert ecriture.status_code == 200, ecriture.text
            assert ecriture.json()["paliers"]["lancement_missions"] == 5

            relue = await client.get("/api/owner/commission-paliers", headers=headers)
            assert relue.json()["paliers"]["actif"] is True
            assert relue.json()["paliers"]["recurrent_taux_percent"] == 9

    async def test_un_reglage_faux_est_refuse_en_nommant_le_champ(self, client: AsyncClient):
        session = await register_and_login(
            client, {**BASE_USER, "email": "owner-palier-faux@kojo.sn", "user_type": "owner"}
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        with patch("kojo_owner.OWNER_EMAIL", session["user"]["email"]), \
             patch("kojo_owner.OWNER_USER_ID", session["user"]["id"]):
            reponse = await client.post(
                "/api/owner/commission-paliers",
                headers=headers,
                json={"recurrent_taux_percent": 90},
            )

        assert reponse.status_code == 400
        assert "recurrent_taux_percent" in reponse.json()["detail"]

    async def test_les_paliers_ne_sont_pas_lisibles_sans_etre_proprietaire(self, client: AsyncClient):
        session = await register_and_login(
            client, {**BASE_USER, "email": "pas-proprietaire@kojo.sn"}
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        reponse = await client.get("/api/owner/commission-paliers", headers=headers)
        assert reponse.status_code in (401, 403)
