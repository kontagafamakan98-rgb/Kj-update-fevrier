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
    ):
        """Paiement resté incertain depuis `hours_ago` heures (alerte owner
        éventuellement déjà envoyée par le sweeper)."""
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
        return doc

    async def test_owner_lists_stuck_payouts_with_duration_and_alert(self, client: AsyncClient):
        """L'endpoint liste les décaissements releasing/refunding avec durée de
        blocage, dépassement du seuil et état de la dernière alerte — triés du
        plus bloqué au moins bloqué."""
        owner = await register_and_login(client, BASE_USER)
        headers = {"Authorization": f"Bearer {owner['access_token']}"}

        # 48 h, déjà alerté par le sweeper
        alerted_old = self._owner_payment_doc(owner["user"]["id"], payout_status="releasing", hours_ago=48, alerted=True)
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

        pb = by_id[recent["id"]]
        assert pb["payout_status"] == "refunding"
        assert pb["payout_kind"] == "refund"
        assert pb["blocked_hours"] == 10
        assert pb["exceeds_threshold"] is False
        assert pb["alerted"] is False
        assert pb["needs_alert"] is False  # sous le seuil : rien à signaler

        pc = by_id[old_unalerted["id"]]
        assert pc["blocked_hours"] == 30
        assert pc["exceeds_threshold"] is True
        assert pc["alerted"] is False
        assert pc["last_alert_at"] is None
        assert pc["needs_alert"] is True  # le sweeper alertera au prochain passage

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
