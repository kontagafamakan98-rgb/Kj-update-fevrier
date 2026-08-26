"""Tests du sweeper des décaissements bloqués (kojo_scheduler).

Couvre : re-vérification PayDunya des paiements restés en releasing/refunding,
résolution quand PayDunya confirme, alerte unique au propriétaire au-delà du
seuil (24 h), non-alerte sous le seuil, non-spam après la première alerte, et
escalade quand la re-vérification est indisponible.
"""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import BASE_USER, auth_headers, db_find_one, db_insert, register_and_login


def _make_payment(
    payer_id="some-payer-id",
    *,
    payout_status="releasing",
    payout_kind=None,
    hours_ago=30,
    disburse_token="sweep-token",
):
    """Paiement complété resté en statut incertain depuis `hours_ago` heures."""
    created = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    doc = {
        "id": str(uuid.uuid4()),
        "job_id": str(uuid.uuid4()),
        "payer_id": payer_id,
        "receiver_id": "worker-1",
        "amount": 25000,
        "status": "completed",
        "payout_status": payout_status,
        "disburse_token": disburse_token,
        "created_at": created.isoformat(),
        "updated_at": created.isoformat(),
    }
    if payout_kind:
        doc["payout_kind"] = payout_kind
    return doc


@pytest.mark.asyncio
class TestPayoutSweeper:
    async def _run_sweep(self):
        from kojo_scheduler import payout_stuck_sweep_once
        return await payout_stuck_sweep_once()

    async def test_resolves_releasing_payout_when_paydunya_confirms(self, client: AsyncClient):
        """L'IPN n'est jamais arrivée, mais PayDunya répond success au
        check-status → le paiement passe released, aucune alerte owner."""
        payment = _make_payment(payout_status="releasing")
        await db_insert("payments", payment)

        with patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "success", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock:
            summary = await self._run_sweep()

        assert summary == {"rechecked": 1, "resolved": 1, "stuck": 0, "alerted": 0}
        stored = await db_find_one("payments", {"id": payment["id"]})
        assert stored["payout_status"] == "released"
        assert stored.get("disburse_verified_payload") is not None
        alert_mock.assert_not_called()

    async def test_refund_resolved_when_paydunya_confirms(self, client: AsyncClient):
        """Mapping refund-aware : un remboursement confirmé passe refunded (pas
        released — bug réel historique de l'IPN)."""
        payment = _make_payment(payout_status="refunding", payout_kind="refund")
        await db_insert("payments", payment)

        with patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "success", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock:
            summary = await self._run_sweep()

        assert summary["resolved"] == 1
        stored = await db_find_one("payments", {"id": payment["id"]})
        assert stored["payout_status"] == "refunded"
        alert_mock.assert_not_called()

    async def test_alerts_owner_once_when_stuck_beyond_threshold(self, client: AsyncClient):
        """Statut toujours incertain après 24 h → alerte au propriétaire UNE
        seule fois (owner_payout_alerted_at posé, pas de spam au passage
        suivant)."""
        payment = _make_payment(payout_status="releasing", hours_ago=30)
        await db_insert("payments", payment)

        with patch("kojo_scheduler.OWNER_USER_ID", "famakan-test"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "pending", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock:
            summary1 = await self._run_sweep()
            summary2 = await self._run_sweep()

        assert summary1["alerted"] == 1
        assert summary2["alerted"] == 0  # pas de re-alerte
        assert alert_mock.call_count == 1
        stored = await db_find_one("payments", {"id": payment["id"]})
        assert stored.get("owner_payout_alerted_at")
        # Première alerte ≠ rappel : le compteur de rappels reste à 0.
        assert stored.get("owner_payout_reminders_sent", 0) == 0
        assert stored["payout_status"] == "releasing"  # toujours incertain

    async def test_no_alert_below_threshold(self, client: AsyncClient):
        """Un statut incertain depuis moins de 24 h ne déclenche pas d'alerte
        (le seuil est dépassé plus tard si l'IPN ne tranche toujours pas)."""
        payment = _make_payment(payout_status="releasing", hours_ago=1)
        await db_insert("payments", payment)

        with patch("kojo_scheduler.OWNER_USER_ID", "famakan-test"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "pending", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock:
            summary = await self._run_sweep()

        assert summary["stuck"] == 1
        assert summary["alerted"] == 0
        alert_mock.assert_not_called()
        stored = await db_find_one("payments", {"id": payment["id"]})
        assert not stored.get("owner_payout_alerted_at")

    async def test_alerts_when_check_status_unavailable(self, client: AsyncClient):
        """PayDunya injoignable → impossible de re-vérifier : le paiement reste
        incertain et l'escalade au propriétaire fonctionne quand même."""
        payment = _make_payment(payout_status="releasing", hours_ago=30)
        await db_insert("payments", payment)

        with patch("kojo_scheduler.OWNER_USER_ID", "famakan-test"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   side_effect=Exception("PayDunya down")), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock:
            summary = await self._run_sweep()

        assert summary["alerted"] == 1
        alert_mock.assert_called_once()
        stored = await db_find_one("payments", {"id": payment["id"]})
        assert stored["payout_status"] == "releasing"

    async def test_backoff_skips_recheck_when_paydunya_unreachable(self, client: AsyncClient):
        """PayDunya injoignable : après le premier échec, un passage IMMÉDIAT ne
        re-tente pas le même paiement (backoff 1 h) — pas de martèlement d'une
        API down (spam réseau/logs)."""
        payment = _make_payment(payout_status="refunding", payout_kind="refund", hours_ago=30)
        await db_insert("payments", payment)

        with patch("kojo_scheduler.OWNER_USER_ID", "famakan-test"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   side_effect=Exception("PayDunya down")) as check_mock, \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()):
            summary1 = await self._run_sweep()
            summary2 = await self._run_sweep()

        assert summary1["stuck"] == 1
        assert summary2["stuck"] == 1
        # Deux passages mais UN SEUL appel à PayDunya (backoff actif).
        assert check_mock.call_count == 1

    async def test_reminder_after_reminder_interval(self, client: AsyncClient):
        """Escalade : alerte déjà envoyée mais toujours bloquée au-delà de
        PAYOUT_ALERT_REMINDER_DAYS → rappel renvoyé et fenêtre décalée."""
        payment = _make_payment(payout_status="releasing", hours_ago=120)
        alerted = datetime.now(timezone.utc) - timedelta(days=4)
        payment["owner_payout_alerted_at"] = alerted.isoformat()
        await db_insert("payments", payment)

        with patch("kojo_scheduler.OWNER_USER_ID", "famakan-test"), \
             patch("kojo_scheduler.OWNER_EMAIL", "famakan@kojo.sn"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "pending", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock, \
             patch("kojo_scheduler.send_email_via_brevo_api") as email_mock:
            summary = await self._run_sweep()

        assert summary["alerted"] == 1
        alert_mock.assert_called_once()
        # Rappel décalé : la prochaine alerte ne repartira que dans 3 jours.
        stored = await db_find_one("payments", {"id": payment["id"]})
        assert stored["owner_payout_alerted_at"] != payment["owner_payout_alerted_at"]
        # Un rappel a été compté (exposé ensuite par /owner/stuck-payouts).
        assert stored.get("owner_payout_reminders_sent", 0) == 1
        assert email_mock.call_count == 1
        assert "rappel" in email_mock.call_args.args[1]

    async def test_no_respam_before_reminder_interval(self, client: AsyncClient):
        """Alerte envoyée il y a 1 jour (sous le délai de rappel) → aucun
        re-alerte au passage suivant (pas de spam)."""
        payment = _make_payment(payout_status="releasing", hours_ago=48)
        payment["owner_payout_alerted_at"] = (
            datetime.now(timezone.utc) - timedelta(days=1)
        ).isoformat()
        await db_insert("payments", payment)

        with patch("kojo_scheduler.OWNER_USER_ID", "famakan-test"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "pending", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock:
            summary = await self._run_sweep()

        assert summary["alerted"] == 0
        alert_mock.assert_not_called()

    async def test_loop_is_importable_and_wired(self, client: AsyncClient):
        """La boucle de fond est importable (câblage server.py) et la fonction
        de sweep est appelable sans erreur."""
        import kojo_scheduler
        assert callable(kojo_scheduler.payout_stuck_sweeper_loop)
        assert callable(kojo_scheduler.payout_stuck_sweep_once)
        # Un sweep à vide ne plante pas (aucun paiement en attente).
        summary = await self._run_sweep()
        assert summary == {"rechecked": 0, "resolved": 0, "stuck": 0, "alerted": 0}


# ---------------------------------------------------------------------------
# 🎛️ Endpoint owner : vue des décaissements bloqués
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestOwnerStuckPayouts:
    def _owner_payment_doc(
        self,
        payer_id,
        *,
        payout_status="releasing",
        payout_kind=None,
        hours_ago=30,
        alerted=False,
        reminders_sent=0,
    ):
        """Paiement resté incertain depuis `hours_ago` heures (alerte owner
        éventuellement déjà envoyée par le sweeper, rappels éventuels)."""
        created = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        doc = {
            "id": str(uuid.uuid4()),
            "job_id": str(uuid.uuid4()),
            "payer_id": payer_id,
            "receiver_id": "worker-1",
            "amount": 25000,
            "status": "completed",
            "payout_status": payout_status,
            "disburse_token": "sweep-token",
            "created_at": created.isoformat(),
            "updated_at": created.isoformat(),
        }
        if payout_kind:
            doc["payout_kind"] = payout_kind
        if alerted:
            doc["owner_payout_alerted_at"] = (created + timedelta(hours=1)).isoformat()
        if reminders_sent:
            doc["owner_payout_reminders_sent"] = reminders_sent
        return doc

    async def test_owner_lists_stuck_payouts_with_duration_and_alert(self, client: AsyncClient):
        """L'endpoint liste les décaissements releasing/refunding avec durée de
        blocage, dépassement du seuil et état de la dernière alerte — triés du
        plus bloqué au moins bloqué."""
        owner = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {owner['access_token']}"}

        # 48 h, déjà alerté par le sweeper + 2 rappels envoyés (escalade)
        alerted_old = self._owner_payment_doc(
            owner["user"]["id"],
            payout_status="releasing",
            hours_ago=48,
            alerted=True,
            reminders_sent=2,
        )
        # 10 h, sous le seuil, jamais alerté
        recent = self._owner_payment_doc(owner["user"]["id"], payout_status="refunding", payout_kind="refund", hours_ago=10)
        # 30 h, au-dessus du seuil, jamais alerté → needs_alert
        old_unalerted = self._owner_payment_doc(owner["user"]["id"], payout_status="releasing", hours_ago=30)
        for doc in (alerted_old, recent, old_unalerted):
            await db_insert("payments", doc)

        with patch("kojo_core.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_core.OWNER_USER_ID", owner["user"]["id"]):
            resp = await client.get("/api/owner/stuck-payouts", headers=headers)

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["count"] == 3
        assert data["threshold_hours"] == 24
        # Tri : le plus bloqué en premier.
        assert data["payouts"][0]["payment_id"] == alerted_old["id"]

        by_id = {p["payment_id"]: p for p in data["payouts"]}

        pa = by_id[alerted_old["id"]]
        assert pa["payout_status"] == "releasing"
        assert pa["blocked_hours"] == 48
        assert pa["exceeds_threshold"] is True
        assert pa["alerted"] is True
        assert pa["last_alert_at"] is not None
        assert pa["needs_alert"] is False
        assert pa["disburse_token_present"] is True
        # Nombre de rappels déjà envoyés par le sweeper (escalade).
        assert pa["reminders_sent"] == 2

        pb = by_id[recent["id"]]
        assert pb["payout_status"] == "refunding"
        assert pb["payout_kind"] == "refund"
        assert pb["blocked_hours"] == 10
        assert pb["exceeds_threshold"] is False
        assert pb["alerted"] is False
        assert pb["needs_alert"] is False  # sous le seuil : rien à signaler
        assert pb["reminders_sent"] == 0

        pc = by_id[old_unalerted["id"]]
        assert pc["blocked_hours"] == 30
        assert pc["exceeds_threshold"] is True
        assert pc["alerted"] is False
        assert pc["last_alert_at"] is None
        assert pc["needs_alert"] is True  # le sweeper alertera au prochain passage
        assert pc["reminders_sent"] == 0

    async def test_owner_stuck_payouts_requires_owner(self, client: AsyncClient):
        """Un utilisateur lambda reçoit 403 (accès propriétaire restreint)."""
        user = await register_and_login(client, {**BASE_USER, "email": "not-owner@kojo.sn"})
        headers = {"Authorization": f"Bearer {user['access_token']}"}
        resp = await client.get("/api/owner/stuck-payouts", headers=headers)
        assert resp.status_code == 403

    async def test_owner_stuck_payouts_empty(self, client: AsyncClient):
        """Aucun décaissement en attente → liste vide, pas d'erreur (le champ
        paydunya_circuit reste exposé : l'état du circuit breaker global)."""
        owner = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {owner['access_token']}"}
        with patch("kojo_core.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_core.OWNER_USER_ID", owner["user"]["id"]):
            resp = await client.get("/api/owner/stuck-payouts", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 0
        assert data["threshold_hours"] == 24
        assert data["payouts"] == []
        assert data["paydunya_circuit"]["state"] in ("closed", "open", "half_open")
        assert data["paydunya_circuit"]["consecutive_failures"] == 0


# ---------------------------------------------------------------------------
# 🚨 Circuit breaker GLOBAL PayDunya (kojo_payments)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestPaydunyaCircuitBreaker:
    """Circuit breaker global : après N échecs RÉSEAU consécutifs, tous les
    appels sortants PayDunya échouent IMMÉDIATEMENT (fail fast, ~0 ms) pendant
    le cooldown — protège checkout, IPN disburse, sweeper et polling. Un échec
    MÉTIER (response_code != '00') n'ouvre PAS le circuit : c'est un refus de
    la requête, pas une panne fournisseur. Un succès (y compris half-open)
    referme le circuit."""

    async def _run_sweep(self):
        from kojo_scheduler import payout_stuck_sweep_once
        return await payout_stuck_sweep_once()

    async def test_opens_after_threshold_and_fails_fast_without_network(self, client: AsyncClient):
        """5 échecs réseau consécutifs → circuit OUVERT ; l'appel suivant
        échoue en fail fast SANS toucher le réseau (aucun nouvel appel)."""
        import requests as _requests
        from kojo_payments import _paydunya_call, paydunya_circuit_state

        with patch.dict(
            "kojo_payments._paydunya_circuit",
            {"state": "closed", "consecutive_failures": 0, "opened_at": 0.0},
        ), \
             patch("kojo_payments.requests.request",
                   side_effect=_requests.ConnectionError("PayDunya down")) as req_mock:
            for _ in range(5):
                with pytest.raises(_requests.ConnectionError):
                    _paydunya_call("POST", "https://paydunya.test/check-status", json={})

            # Assertions DANS le contexte de patch (l'état est restauré à la
            # sortie du bloc).
            state = paydunya_circuit_state()
            assert state["state"] == "open"
            assert state["consecutive_failures"] >= 5
            assert req_mock.call_count == 5

            # Fail fast : l'appel suivant échoue immédiatement, zéro appel réseau.
            with pytest.raises(_requests.ConnectionError):
                _paydunya_call("POST", "https://paydunya.test/check-status", json={})
            assert req_mock.call_count == 5

    async def test_business_rejection_does_not_open_circuit(self, client: AsyncClient):
        """response_code != '00' (montant refusé…) = refus MÉTIER : PayDunya
        répond, le circuit reste fermé (failures == 0)."""
        import requests as _requests
        from kojo_payments import _paydunya_call, paydunya_circuit_state

        ok = _requests.Response()
        ok.status_code = 200
        ok._content = b'{"response_code": "XX", "response_text": "Minimum checkout amount"}'

        with patch.dict(
            "kojo_payments._paydunya_circuit",
            {"state": "closed", "consecutive_failures": 0, "opened_at": 0.0},
        ), \
             patch("kojo_payments.requests.request", return_value=ok) as req_mock:
            data = _paydunya_call("POST", "https://paydunya.test/create", json={})

        assert data["response_code"] == "XX"
        state = paydunya_circuit_state()
        assert state["state"] == "closed"
        assert state["consecutive_failures"] == 0
        assert req_mock.call_count == 1

    async def test_success_after_cooldown_closes_circuit_half_open(self, client: AsyncClient):
        """Cooldown écoulé → half_open : l'appel de sonde part, son succès
        referme le circuit (reset complet)."""
        import time as _time
        import requests as _requests
        from kojo_payments import _paydunya_call, paydunya_circuit_state

        ok = _requests.Response()
        ok.status_code = 200
        ok._content = b'{"response_code": "00"}'

        with patch.dict(
            "kojo_payments._paydunya_circuit",
            {"state": "open", "consecutive_failures": 5, "opened_at": _time.time()},
        ), \
             patch("kojo_payments.PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS", 0), \
             patch("kojo_payments.requests.request", return_value=ok):
            # Cooldown 0 → l'état EFFECTIF est half_open : la sonde est autorisée.
            assert paydunya_circuit_state()["state"] == "half_open"
            data = _paydunya_call("POST", "https://paydunya.test/check-status", json={})
            assert data["response_code"] == "00"
            assert paydunya_circuit_state()["state"] == "closed"

    async def test_half_open_probe_failure_reopens_circuit(self, client: AsyncClient):
        """La sonde half-open échoue → le circuit se ré-ouvre et le compteur
        continue (cooldown relancé, pas de rafale de sondes)."""
        import time as _time
        import requests as _requests
        from kojo_payments import _paydunya_call, paydunya_circuit_state

        with patch.dict(
            "kojo_payments._paydunya_circuit",
            {"state": "open", "consecutive_failures": 5, "opened_at": _time.time()},
        ), \
             patch("kojo_payments.PAYDUNYA_CIRCUIT_COOLDOWN_SECONDS", 0), \
             patch("kojo_payments.requests.request",
                   side_effect=_requests.ConnectionError("toujours down")) as req_mock:
            with pytest.raises(_requests.ConnectionError):
                _paydunya_call("POST", "https://paydunya.test/check-status", json={})

            # Assertions DANS le contexte de patch (état restauré à la sortie).
            assert paydunya_circuit_state()["consecutive_failures"] == 6
            # Cooldown 0 → l'état effectif redevient half_open (la sonde
            # suivante repartira) ; avec un cooldown réel de 2 h, le circuit
            # resterait OPEN.
            assert paydunya_circuit_state()["state"] == "half_open"
            assert req_mock.call_count == 1

    async def test_sweeper_suspends_rechecks_when_circuit_open_but_escalates(self, client: AsyncClient):
        """Circuit OUVERT → le sweeper ne lance AUCUNE re-vérification (zéro
        appel PayDunya, rechecked == 0) mais l'escalade au propriétaire reste
        active (le propriétaire sait que les décaissements sont incertains)."""
        import time as _time
        payment = _make_payment(payout_status="releasing", hours_ago=30)
        await db_insert("payments", payment)

        with patch.dict(
            "kojo_payments._paydunya_circuit",
            {"state": "open", "consecutive_failures": 5, "opened_at": _time.time()},
        ), \
             patch("kojo_scheduler.OWNER_USER_ID", "famakan-test"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "pending", "response_code": "00"}) as check_mock, \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock:
            summary = await self._run_sweep()

        assert summary["rechecked"] == 0   # re-vérifications suspendues
        assert summary["stuck"] == 1
        assert summary["alerted"] == 1     # escalade maintenue
        check_mock.assert_not_called()       # zéro appel réseau PayDunya
        alert_mock.assert_called_once()

    async def test_checkout_fails_fast_503_when_circuit_open(self, client: AsyncClient):
        """Flux métier protégé : circuit OUVERT → le checkout refuse avec un
        503 clair AVANT d'insérer un enregistrement pending (pas d'orphelin,
        pas de timeout de 30 s pour l'utilisateur)."""
        import time as _time
        headers = await auth_headers(client)

        with patch.dict(
            "kojo_payments._paydunya_circuit",
            {"state": "open", "consecutive_failures": 5, "opened_at": _time.time()},
        ), \
             patch("kojo_routers_payments.is_paydunya_configured", return_value=True):
            resp = await client.post("/api/payments/checkout", headers=headers, json={
                "job_id": "job-not-checked",
                "amount": 5000,
                "payment_method": "orange_money",
                "country": "senegal",
            })

        assert resp.status_code == 503
        assert "indisponible" in resp.json()["detail"]
        # La garde est AVANT l'insertion en base : aucun paiement pending créé.
        assert await db_find_one("payments", {"job_id": "job-not-checked"}) is None


class TestOwnerResolutionByEmail:
    """Scénario réel en prod : le compte owner existe par email mais son id ne
    correspond PAS au secret OWNER_USER_ID (aucun compte ne porte ce secret —
    id fantôme). La résolution par email doit restaurer l'accès /api/owner/*,
    l'alerte du sweeper (notification in-app au compte RÉEL) et le fallback
    email Brevo."""

    async def test_owner_access_and_resolution_with_phantom_secret_id(self, client: AsyncClient):
        """Avec un secret id fantôme, l'accès owner fonctionne pour le compte
        réel (résolu par email) et resolve_owner_id renvoie l'id réel."""
        owner = await register_and_login(client, BASE_USER)  # id = uuid réel
        real_id = owner["user"]["id"]
        phantom_id = "phantom-owner-id-2024"

        with patch("kojo_core.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_core.OWNER_USER_ID", phantom_id):
            from kojo_core import resolve_owner_id
            resolved = await resolve_owner_id()
            assert resolved == real_id

            headers = {"Authorization": f"Bearer {owner['access_token']}"}
            resp = await client.get("/api/owner/stuck-payouts", headers=headers)
            assert resp.status_code == 200, resp.text

    async def test_sweeper_alert_targets_real_owner_and_sends_email(self, client: AsyncClient):
        """Le sweeper alerte le compte RÉEL (résolu par email) même si le
        secret est un id fantôme, et envoie l'email Brevo en fallback (aucun
        push token owner en prod)."""
        from kojo_scheduler import payout_stuck_sweep_once

        owner = await register_and_login(client, BASE_USER)
        real_id = owner["user"]["id"]
        payment = _make_payment(payout_status="refunding", payout_kind="refund", hours_ago=30)
        await db_insert("payments", payment)

        with patch("kojo_core.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_scheduler.OWNER_EMAIL", owner["user"]["email"]), \
             patch("kojo_core.OWNER_USER_ID", "phantom-owner-id-2024"), \
             patch("kojo_routers_payments.check_paydunya_disburse_status",
                   return_value={"status": "pending", "response_code": "00"}), \
             patch("kojo_routers_payments.notify_user_localized", AsyncMock()), \
             patch("kojo_scheduler.notify_user_localized", AsyncMock()) as alert_mock, \
             patch("kojo_scheduler.send_email_via_brevo_api") as email_mock:
            summary = await payout_stuck_sweep_once()

        assert summary["alerted"] == 1
        assert alert_mock.call_args.kwargs["user_id"] == real_id
        email_mock.assert_called_once()
        assert email_mock.call_args.args[0] == owner["user"]["email"]


# ---------------------------------------------------------------------------
# 💾 Persistance MongoDB de l'état du circuit breaker (kojo_payments)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestPaydunyaCircuitPersistence:
    """L'état du circuit breaker (mémoire = chemin critique) est PERSISTÉ en
    MongoDB à chaque transition : il survit aux redéploiements (rechargé par
    init_paydunya_circuit au démarrage) et est partagé entre les workers
    (refresh_paydunya_circuit_from_db avant les points de lecture). Règle de
    fraîcheur : un circuit OUVERT en mémoire (échecs locaux récents) n'est
    jamais écrasé par un état fermé persisté par un autre worker."""

    async def _flush(self):
        """Laisse la tâche d'upsert (call_soon_threadsafe) s'exécuter."""
        import asyncio as _asyncio
        for _ in range(5):
            await _asyncio.sleep(0)

    async def test_persists_transitions_and_reloads_on_init(self, client: AsyncClient):
        """Chaque transition (échec compté, succès → reset) est écrite en base,
        et un redémarrage (nouveau worker) recharge l'état persisté : le
        circuit OUVERT survit au redéploiement."""
        import time as _time
        import kojo_payments
        from kojo_payments import (
            _circuit_record_failure,
            _circuit_record_success,
            init_paydunya_circuit,
            paydunya_circuit_state,
        )

        try:
            # Capture la boucle (comme le lifespan en prod) + mémoire propre.
            with patch.dict(
                "kojo_payments._paydunya_circuit",
                {"state": "closed", "consecutive_failures": 0, "opened_at": 0.0},
            ):
                await init_paydunya_circuit()

                # 2 échecs réseau → compteur 2, PERSISTÉ en base.
                _circuit_record_failure()
                _circuit_record_failure()
                await self._flush()

                stored = await db_find_one("paydunya_circuit", {"_id": "global"})
                assert stored is not None
                assert stored["state"] == "closed"
                assert stored["consecutive_failures"] == 2

                # Un succès referme et réécrit (compteur à 0).
                _circuit_record_success()
                await self._flush()
                stored = await db_find_one("paydunya_circuit", {"_id": "global"})
                assert stored["state"] == "closed"
                assert stored["consecutive_failures"] == 0

            # Redémarrage : un autre worker a persisté un circuit OUVERT.
            # update_one (upsert) remplace le doc existant — la FakeDB n'a pas
            # d'index unique sur _id, un insert créerait un doublon.
            from kojo_core import db as _db
            await _db["paydunya_circuit"].update_one(
                {"_id": "global"},
                {"$set": {
                    "state": "open",
                    "consecutive_failures": 5,
                    "opened_at": _time.time(),
                }},
                upsert=True,
            )
            with patch.dict(
                "kojo_payments._paydunya_circuit",
                {"state": "closed", "consecutive_failures": 0, "opened_at": 0.0},
            ):
                await init_paydunya_circuit()
                state = paydunya_circuit_state()
                assert state["state"] == "open"
                assert state["consecutive_failures"] == 5
        finally:
            kojo_payments._circuit_loop = None

    async def test_refresh_adopts_other_worker_open_circuit(self, client: AsyncClient):
        """Un worker en mémoire CLOSED adopte l'état OUVERT persisté par un
        autre worker (sweeper, checkout, owner) — il rejoint le circuit sans
        re-brûler le seuil d'échecs."""
        import time as _time
        import kojo_payments
        from kojo_payments import (
            paydunya_circuit_state,
            refresh_paydunya_circuit_from_db,
        )

        try:
            await db_insert("paydunya_circuit", {
                "_id": "global",
                "state": "open",
                "consecutive_failures": 4,
                "opened_at": _time.time(),
            })
            with patch.dict(
                "kojo_payments._paydunya_circuit",
                {"state": "closed", "consecutive_failures": 0, "opened_at": 0.0},
            ):
                await refresh_paydunya_circuit_from_db()
                state = paydunya_circuit_state()
                assert state["state"] == "open"
                assert state["consecutive_failures"] == 4
        finally:
            kojo_payments._circuit_loop = None

    async def test_memory_open_not_overwritten_by_stale_closed(self, client: AsyncClient):
        """Règle de fraîcheur : le circuit OUVERT en mémoire (échecs observés
        APRÈS la dernière écriture persistée) n'est jamais refermé par un
        refresh qui lirait un état closed périmé en base."""
        import time as _time
        import kojo_payments
        from kojo_payments import (
            paydunya_circuit_state,
            refresh_paydunya_circuit_from_db,
        )

        try:
            await db_insert("paydunya_circuit", {
                "_id": "global",
                "state": "closed",
                "consecutive_failures": 0,
                "opened_at": 0.0,
            })
            with patch.dict(
                "kojo_payments._paydunya_circuit",
                {"state": "open", "consecutive_failures": 5, "opened_at": _time.time()},
            ):
                await refresh_paydunya_circuit_from_db()
                state = paydunya_circuit_state()
                assert state["state"] == "open"
                assert state["consecutive_failures"] == 5
        finally:
            kojo_payments._circuit_loop = None


# ---------------------------------------------------------------------------
# 🚨 Alerte owner à l'ouverture du circuit + état dans /health
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestPaydunyaCircuitOwnerAlert:
    """Quand le circuit s'OUVRE, le propriétaire est alerté IMMÉDIATEMENT
    (notification in-app + email Brevo en fallback — même pattern que le
    sweeper) : une panne PayDunya est détectée sans attendre le dashboard.
    L'alerte part UNE fois par passage en open (pas de spam tant que le
    circuit reste ouvert). L'état du circuit est aussi exposé dans /health."""

    async def _flush(self):
        import asyncio as _asyncio
        for _ in range(5):
            await _asyncio.sleep(0)

    async def test_alert_fires_once_when_circuit_opens(self, client: AsyncClient):
        """5 échecs réseau → ouverture → UNE alerte (notif + email) ; les
        échecs suivants, circuit toujours ouvert, ne re-alertent pas."""
        import kojo_payments
        from kojo_payments import _circuit_record_failure, init_paydunya_circuit

        try:
            with patch.dict(
                "kojo_payments._paydunya_circuit",
                {"state": "closed", "consecutive_failures": 0, "opened_at": 0.0},
            ), \
                 patch("kojo_payments.OWNER_EMAIL", "famakan@kojo.sn"), \
                 patch("kojo_payments.notify_user_localized", AsyncMock()) as notify_mock, \
                 patch("kojo_payments.send_email_via_brevo_api") as email_mock:
                await init_paydunya_circuit()

                # 5 échecs → le circuit s'ouvre → UNE alerte (notif + email).
                for _ in range(5):
                    _circuit_record_failure()
                await self._flush()

                assert notify_mock.call_count == 1
                assert email_mock.call_count == 1
                assert "circuit breaker" in email_mock.call_args.args[1].lower()

                # Toujours ouvert : les échecs suivants ne re-alertent PAS
                # (l'alerte est liée à la TRANSITION, pas à chaque échec).
                for _ in range(3):
                    _circuit_record_failure()
                await self._flush()
                assert notify_mock.call_count == 1
                assert email_mock.call_count == 1
        finally:
            kojo_payments._circuit_loop = None

    async def test_health_exposes_circuit_state(self, client: AsyncClient):
        """/api/health expose l'état du circuit breaker PayDunya (state,
        échecs consécutifs, seuil, cooldown restant) — détectable par les
        moniteurs d'infra sans attendre le dashboard owner."""
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["paydunya_circuit"]["state"] in ("closed", "open", "half_open")
        assert data["paydunya_circuit"]["consecutive_failures"] == 0
        assert data["paydunya_circuit"]["failure_threshold"] >= 1
        assert "remaining_cooldown_seconds" in data["paydunya_circuit"]

    async def test_health_reflects_open_circuit(self, client: AsyncClient):
        """Circuit OUVERT (persisté en base par un autre worker) → /health le
        montre grâce au refresh préalable — pas seulement la vue locale."""
        import time as _time
        await db_insert("paydunya_circuit", {
            "_id": "global",
            "state": "open",
            "consecutive_failures": 5,
            "opened_at": _time.time(),
        })
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["paydunya_circuit"]["state"] == "open"
        assert data["paydunya_circuit"]["consecutive_failures"] == 5

    async def test_monitor_paydunya_ok_when_closed(self, client: AsyncClient):
        """Circuit fermé → /monitor/paydunya renvoie 200 : les moniteurs
        d'infra (UptimeRobot/Render) ne sont pas alertés."""
        resp = await client.get("/monitor/paydunya")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "paydunya"
        assert data["circuit"] == "ok"
        assert data["paydunya_circuit"]["state"] in ("closed", "half_open")
        assert data["paydunya_circuit"]["consecutive_failures"] == 0
        assert "remaining_cooldown_seconds" in data["paydunya_circuit"]

    async def test_monitor_paydunya_503_when_open(self, client: AsyncClient):
        """Circuit OUVERT (persisté en base par un autre worker) →
        /monitor/paydunya renvoie 503 : les moniteurs alertent immédiatement."""
        import time as _time
        await db_insert("paydunya_circuit", {
            "_id": "global",
            "state": "open",
            "consecutive_failures": 5,
            "opened_at": _time.time(),
        })
        resp = await client.get("/monitor/paydunya")
        assert resp.status_code == 503
        data = resp.json()
        assert data["circuit"] == "open"
        assert data["paydunya_circuit"]["state"] == "open"
        assert data["paydunya_circuit"]["consecutive_failures"] == 5
        assert data["paydunya_circuit"]["remaining_cooldown_seconds"] > 0

    async def test_monitor_paydunya_ok_when_half_open(self, client: AsyncClient):
        """half_open (cooldown écoulé, sonde autorisée) → 200 : plus de fail
        fast, PayDunya peut redevenir joignable — on n'alerte pas sur l'état
        de récupération."""
        import time as _time
        await db_insert("paydunya_circuit", {
            "_id": "global",
            "state": "open",
            "consecutive_failures": 5,
            "opened_at": _time.time() - 3 * 3600,  # cooldown (2h) écoulé
        })
        resp = await client.get("/monitor/paydunya")
        assert resp.status_code == 200
        data = resp.json()
        assert data["paydunya_circuit"]["state"] == "half_open"
        assert data["paydunya_circuit"]["remaining_cooldown_seconds"] == 0


# ---------------------------------------------------------------------------
# 🖥️ Moniteurs d'infra des fournisseurs externes (/monitor/brevo, /monitor/cloudinary)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestExternalProviderMonitors:
    """Contrat commun /monitor/<service> pour les fournisseurs externes
    (Brevo email, Cloudinary photos) : 200 quand le service répond, 503 sinon
    (config manquante, transport, HTTP erreur). Les sondes tournent dans un
    thread (asyncio.to_thread) et sont mises en cache TTL 60 s par la sonde
    elle-même."""

    async def _clear_caches(self):
        import kojo_core, kojo_email
        kojo_core._cloudinary_health_cache.clear()
        kojo_email._brevo_health_cache.clear()

    async def test_brevo_ok(self, client: AsyncClient):
        """Brevo configuré et API joignable → 200."""
        await self._clear_caches()
        with patch("kojo_email.brevo_is_configured", return_value=True), \
             patch("kojo_email.requests.get") as get_mock:
            get_mock.return_value.ok = True
            get_mock.return_value.status_code = 200
            resp = await client.get("/monitor/brevo")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "brevo"
        assert data["circuit"] == "ok"
        assert data["configured"] is True
        assert data["detail"] == "HTTP 200"

    async def test_brevo_transport_error_503(self, client: AsyncClient):
        """Brevo injoignable (RequestException) → 503 avec detail transport."""
        import requests as _requests
        await self._clear_caches()
        with patch("kojo_email.brevo_is_configured", return_value=True), \
             patch("kojo_email.requests.get",
                   side_effect=_requests.ConnectionError("Brevo down")):
            resp = await client.get("/monitor/brevo")
        assert resp.status_code == 503
        data = resp.json()
        assert data["circuit"] == "down"
        assert data["configured"] is True
        assert "Transport Brevo" in data["detail"]

    async def test_brevo_not_configured_503(self, client: AsyncClient):
        """BREVO_API_KEY / BREVO_SENDER_EMAIL absents → 503 config."""
        await self._clear_caches()
        with patch("kojo_email.brevo_is_configured", return_value=False):
            resp = await client.get("/monitor/brevo")
        assert resp.status_code == 503
        data = resp.json()
        assert data["configured"] is False
        assert "non configuré" in data["detail"]

    async def test_cloudinary_ok(self, client: AsyncClient):
        """Cloudinary configuré et ping officiel ok → 200."""
        await self._clear_caches()
        with patch("kojo_core.cloudinary.config") as cfg_mock, \
             patch("kojo_core.cloudinary.api.ping",
                   return_value={"status": "ok"}) as ping_mock:
            cfg_mock.return_value.cloud_name = "kojo"
            cfg_mock.return_value.api_key = "key"
            cfg_mock.return_value.api_secret = "secret"
            resp = await client.get("/monitor/cloudinary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service"] == "cloudinary"
        assert data["circuit"] == "ok"
        assert data["configured"] is True
        assert ping_mock.call_count == 1

    async def test_cloudinary_transport_error_503(self, client: AsyncClient):
        """Cloudinary injoignable (ping lève) → 503 avec detail transport."""
        await self._clear_caches()
        with patch("kojo_core.cloudinary.config") as cfg_mock, \
             patch("kojo_core.cloudinary.api.ping",
                   side_effect=Exception("Cloudinary down")):
            cfg_mock.return_value.cloud_name = "kojo"
            cfg_mock.return_value.api_key = "key"
            cfg_mock.return_value.api_secret = "secret"
            resp = await client.get("/monitor/cloudinary")
        assert resp.status_code == 503
        data = resp.json()
        assert data["circuit"] == "down"
        assert data["configured"] is True
        assert "Transport Cloudinary" in data["detail"]

    async def test_cloudinary_not_configured_503(self, client: AsyncClient):
        """CLOUDINARY_URL absent → 503 config, aucun ping réseau tenté."""
        await self._clear_caches()
        with patch("kojo_core.cloudinary.config") as cfg_mock, \
             patch("kojo_core.cloudinary.api.ping") as ping_mock:
            cfg_mock.return_value.cloud_name = None
            cfg_mock.return_value.api_key = None
            cfg_mock.return_value.api_secret = None
            resp = await client.get("/monitor/cloudinary")
        assert resp.status_code == 503
        data = resp.json()
        assert data["configured"] is False
        assert ping_mock.call_count == 0

    async def test_brevo_probe_uses_cache(self, client: AsyncClient):
        """Deux hits rapprochés → un seul appel réseau (cache TTL 60 s)."""
        await self._clear_caches()
        with patch("kojo_email.brevo_is_configured", return_value=True), \
             patch("kojo_email.requests.get") as get_mock:
            get_mock.return_value.ok = True
            get_mock.return_value.status_code = 200
            resp1 = await client.get("/monitor/brevo")
            resp2 = await client.get("/monitor/brevo")
        assert resp1.status_code == 200 and resp2.status_code == 200
        assert get_mock.call_count == 1
