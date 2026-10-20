# -*- coding: utf-8 -*-
"""L'envoi d'email ne doit pas s'exécuter sur la boucle d'événements.

Le banc de charge (`backend/scripts/charge`) a mesuré le défaut que ce test
verrouille : un envoi d'email de 2 s faisait passer le p99 des AUTRES requêtes
de 22 ms à 1 988 ms et coupait le débit de moitié (755 → 360 requêtes sur la
même fenêtre). En production, le timeout réel est de 15 à 30 s : un fournisseur
email lent n'aurait pas ralenti les emails, il aurait arrêté l'API.

Le point de règle `send_email_via_active_provider` est le passage obligé de tous
les envois produits (`test_email_send_points.py` le vérifie) : le corriger là
couvre OTP, alertes propriétaire et tickets. Ce test mesure la seule chose que
le correctif promet — le fournisseur est appelé depuis un autre thread que
celui de la boucle — sans comparer des millisecondes, qui dépendraient de la
charge de la machine.

Le même correctif (`asyncio.to_thread`) a été posé au checkout PayDunya
(`kojo_routers_payments`) et à l'échange de code Google
(`kojo_routers_auth`). Ces deux routes ne sont pas couvertes ici : elles
exigent un paiement / un code Google réels. Le dire vaut mieux que de laisser
croire qu'elles sont testées.

LES CARTES OPEN GRAPH (`kojo_routers_public`) sont le troisième cas, et d'une
autre nature : le rendu n'attend PERSONNE, il calcule (dessin Pillow + encodage
PNG, 95 à 130 ms mesurés). Appelé sur la boucle, il ne ralentit pas le rendu —
il arrête tout le reste : 4 rendus simultanés portaient `/api/health` à 305 ms,
mesuré au banc. Le second test verrouille donc la même promesse que le premier
(l'appel a lieu dans un AUTRE thread), pas des millisecondes.
"""
import threading

import pytest

import kojo_email
import kojo_payments
import kojo_routers_public


async def _aucune_adresse_retenue(_email):
    """Doublure du filtre : aucune adresse supprimée (on ne teste pas la base)."""
    return None


@pytest.mark.asyncio
async def test_l_envoi_email_ne_tourne_pas_sur_la_boucle(monkeypatch):
    """L'envoi part dans un thread : un timeout de 30 s ne gèle pas le worker."""
    threads = []

    def faux_envoi(*args, **kwargs):
        threads.append(threading.current_thread())
        return {"ok": True}

    monkeypatch.setattr(kojo_email, "adresse_supprimee", _aucune_adresse_retenue)
    monkeypatch.setattr(kojo_email, "active_email_provider", lambda: ("brevo", None))
    monkeypatch.setattr(kojo_email, "send_email_via_brevo_api", faux_envoi)

    await kojo_email.send_email_via_active_provider(
        "destinataire@kojo.sn", "Sujet", "corps"
    )

    assert len(threads) == 1, "l'envoi n'a pas eu lieu"
    assert threads[0] is not threading.main_thread(), (
        "l'envoi d'email tourne sur la boucle : un timeout de 30 s du "
        "fournisseur gèlerait TOUTES les requêtes du worker"
    )


@pytest.mark.asyncio
async def test_la_reconfirmation_paydunya_ne_tourne_pas_sur_la_boucle(monkeypatch):
    """Le troisième chemin synchrone, et le plus exposé : le paiement.

    `sync_payment_status_with_paydunya` est `async`, mais appelait
    `confirm_paydunya_invoice` — un `requests.get(..., timeout=30)` —
    DIRECTEMENT. Trois routes l'attendent : `/payments/status/{id}`,
    `/payments/status/token/{token}` et l'IPN public. Sur la boucle, un
    PayDunya lent arrêtait donc toutes les requêtes du worker (mono-worker en
    production). Le checkout, lui, passait déjà par `asyncio.to_thread` :
    c'était un oubli, pas un choix.
    """
    threads = []

    def faux_confirm(invoice_token):
        threads.append(threading.current_thread())
        return {"invoice": {"status": "pending"}}

    class _Collection:
        async def update_one(self, *args, **kwargs):
            return None

        async def find_one(self, *args, **kwargs):
            return {"id": "paiement-1", "status": "pending", "invoice_token": "tok"}

    class _Base:
        payments = _Collection()

    monkeypatch.setattr(kojo_payments, "is_paydunya_configured", lambda: True)
    monkeypatch.setattr(kojo_payments, "confirm_paydunya_invoice", faux_confirm)
    monkeypatch.setattr(kojo_payments, "db", _Base())

    await kojo_payments.sync_payment_status_with_paydunya(
        {"id": "paiement-1", "status": "pending", "invoice_token": "tok"}
    )

    assert len(threads) == 1, "la reconfirmation n'a pas eu lieu"
    assert threads[0] is not threading.main_thread(), (
        "la reconfirmation PayDunya tourne sur la boucle : un timeout de 30 s "
        "du fournisseur gèlerait TOUTES les requêtes, y compris la page "
        "d'accueil et l'IPN"
    )


@pytest.mark.asyncio
async def test_le_rendu_des_cartes_og_ne_tourne_pas_sur_la_boucle(monkeypatch):
    """Les deux variantes de carte (large et carrée) rendent hors de la boucle.

    Un rendu de carte coûte 95 à 130 ms de CPU : sur la boucle, un crawler qui
    parcourt les fiches gèle l'API entière, ce que le banc a mesuré
    (`/api/health` à 305 ms pendant 4 rendus).
    """
    threads = []

    def faux_rendu(job, square=False):
        threads.append((threading.current_thread(), square))
        return b"png"

    class _Collection:
        async def find_one(self, *args, **kwargs):
            return {"id": "job-1", "title": "Mission", "status": "open"}

    class _Base:
        jobs = _Collection()

    monkeypatch.setattr(kojo_routers_public, "db", _Base())
    monkeypatch.setattr(kojo_routers_public, "_render_job_og_card", faux_rendu)

    large = await kojo_routers_public.get_job_og_image("job-1")
    carree = await kojo_routers_public.get_job_og_image_square("job-1")

    assert large.body == b"png" and carree.body == b"png"
    assert [carre for _, carre in threads] == [False, True], (
        "les deux variantes de carte doivent être rendues"
    )
    assert all(t is not threading.main_thread() for t, _ in threads), (
        "le rendu d'une carte OG tourne sur la boucle : un crawler qui parcourt "
        "les fiches arrête toutes les autres requêtes du worker"
    )
