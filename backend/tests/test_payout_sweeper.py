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

from tests.conftest import db_find_one, db_insert


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

    async def test_loop_is_importable_and_wired(self, client: AsyncClient):
        """La boucle de fond est importable (câblage server.py) et la fonction
        de sweep est appelable sans erreur."""
        import kojo_scheduler
        assert callable(kojo_scheduler.payout_stuck_sweeper_loop)
        assert callable(kojo_scheduler.payout_stuck_sweep_once)
        # Un sweep à vide ne plante pas (aucun paiement en attente).
        summary = await self._run_sweep()
        assert summary == {"rechecked": 0, "resolved": 0, "stuck": 0, "alerted": 0}
