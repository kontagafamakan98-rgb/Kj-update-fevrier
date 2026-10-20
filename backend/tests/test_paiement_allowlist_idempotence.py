# -*- coding: utf-8 -*-
"""La vue publique d'un paiement est une ALLOWLIST, et la clé d'idempotence sert.

Deux contrats qui étaient écrits sans être tenus :

  • `serialize_payment_record` retirait SEPT champs nommés. Une denylist échoue
    par défaut : le premier champ fournisseur ajouté demain sortait chez le
    client sans qu'aucun test ne bronche, sur la route qui porte des montants et
    des numéros de paiement ;
  • `idempotency_key` était acceptée, stockée… et jamais lue. Deux requêtes
    simultanées créaient donc deux factures, et un rejeu ne retrouvait pas sa
    facture.

Ces cas mesurent les deux promesses, pas l'implémentation : un champ INCONNU
doit être écarté, et un rejeu avec la même clé doit rendre la MÊME facture sans
insérer de document.
"""
from types import SimpleNamespace

import pytest

import kojo_payments
import kojo_routers_payments as routeur


# ── L'allowlist ────────────────────────────────────────────────────────────

def test_un_champ_inconnu_ne_sort_jamais():
    """Le futur champ fournisseur d'un autre jour est écarté par DÉFAUT."""
    document = {
        "id": "p1",
        "amount": 5000,
        "status": "pending",
        # Ce que le fournisseur nous envoie et qui ne doit jamais sortir :
        "provider_confirm_payload": {"customer": {"email": "client@kojo.sn", "phone": "221771234567"}},
        "provider_response_text": "trace interne",
        "disburse_token": "tok_secret",
        # Un champ qui n'existe pas encore dans le code, ajouté demain :
        "provider_webhook_secret": "whsec_futur",
        "nouveau_champ_inconnu": "valeur sensible",
    }

    vue = kojo_payments.serialize_payment_record(document)

    assert set(vue) == {"id", "amount", "status"}, (
        f"la vue a laissé sortir {sorted(set(vue) - {'id', 'amount', 'status'})} : "
        "ce n'est pas une allowlist, donc un champ ajouté demain fuira"
    )
    assert "client@kojo.sn" not in str(vue)


def test_LES_champs_metier_restent_servis():
    """L'allowlist ne doit pas casser l'écran : les champs lus sont tous là."""
    document = {
        clave: "x"
        for clave in (
            "id", "job_id", "payer_id", "receiver_id", "amount",
            "commission_amount", "worker_amount", "status", "payout_status",
            "payout_kind", "payment_method", "provider", "provider_channel",
            "country", "checkout_url", "invoice_token", "expires_at",
            "created_at", "updated_at", "completed_at", "idempotency_key",
        )
    }

    vue = kojo_payments.serialize_payment_record(document)

    assert set(vue) == set(document), (
        "un champ métier est tombé de la vue : l'écran de paiement le lit, "
        "et l'allowlist doit être complétée plutôt que de casser l'affichage"
    )


# ── La clé d'idempotence ───────────────────────────────────────────────────

class _Payments:
    def __init__(self, par_cle=None, par_pending=None):
        self.par_cle = par_cle
        self.par_pending = par_pending
        self.inseres = []

    async def find_one(self, filtre, *args, **kwargs):
        if "idempotency_key" in filtre:
            return self.par_cle
        if filtre.get("status") == "pending":
            return self.par_pending
        return None

    async def insert_one(self, document):
        self.inseres.append(document)


class _Jobs:
    async def find_one(self, *args, **kwargs):
        return {"id": "job-1", "client_id": "client-1", "budget_max": 5000}


class _Settings:
    async def find_one(self, *args, **kwargs):
        return None


class _Base:
    def __init__(self, payments):
        self.payments = payments
        self.jobs = _Jobs()
        self.settings = _Settings()


@pytest.mark.asyncio
async def test_un_rejeu_avec_la_meme_cle_rend_la_meme_facture(monkeypatch):
    """Rejouer un checkout ne crée pas une seconde facture."""
    facture = {
        "id": "paiement-existant",
        "amount": 5000,
        "idempotency_key": "clic-1",
        "checkout_url": "https://paydunya.example/checkout/1",
        "invoice_token": "inv-1",
        "provider_channel": "orange-money-senegal",
        "payment_method": "mobile_money",
    }
    base = _Base(_Payments(par_cle=facture))
    monkeypatch.setattr(routeur, "db", base)
    monkeypatch.setattr(routeur, "is_paydunya_configured", lambda: True)
    monkeypatch.setattr(routeur, "is_paydunya_circuit_open", lambda: False)

    async def _rien(*args, **kwargs):
        return None

    monkeypatch.setattr(routeur, "refresh_paydunya_circuit_from_db", _rien)

    utilisateur = SimpleNamespace(id="client-1", email="client@kojo.sn", country="SN")
    demande = SimpleNamespace(
        job_id="job-1",
        amount=5000,
        worker_id=None,
        payment_method=SimpleNamespace(value="mobile_money"),
        country="SN",
        idempotency_key="clic-1",
        return_url=None,
        cancel_url=None,
    )

    reponse = await routeur.create_real_payment_checkout(demande, current_user=utilisateur)

    assert reponse["reused"] is True
    assert reponse["payment_id"] == "paiement-existant"
    assert base.payments.inseres == [], (
        "un rejeu avec la même clé a créé une SECONDE facture : la clé "
        "d'idempotence n'est pas lue avant l'insertion"
    )
