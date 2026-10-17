# -*- coding: utf-8 -*-
"""Webhooks email du fournisseur (Resend) : rebonds, plaintes, livraisons.

Ce routeur ne porte qu'une route, et c'est délibéré : la surface « email » est
l'endroit où un fait EXTÉRIEUR entre dans le produit. L'endpoint est public et
non authentifié — c'est un webhook, comme les IPN PayDunya
(`kojo_routers_payments`) —, donc sa seule preuve d'identité est la SIGNATURE
de la requête : sans elle, n'importe qui pourrait faire retenir les adresses
qu'il veut en annonçant « cette boîte a rebondi », ce qui ferait taire les
emails d'un tiers.

Ce que la route refuse, et comment :

  * secret non configuré → 503 : la signature ne peut pas être vérifiée, donc
    l'ingestion est DÉSACTIVÉE. Le backend démarre sans ce secret ; c'est ce
    refus qui rend la fonctionnalité « branchée mais inerte » plutôt que
    « branchée et permissive » ;
  * signature absente/invalide/périmée → 401, motif nommé ;
  * charge utile ininterprétable, ou qui devait nous concerner et ne se lit pas
    → 400, motif nommé.

Un type d'événement que nous ne suivons PAS est répondu 200 en le nommant :
Resend re-livre toute requête non-2xx, donc refuser ce qu'on ignore
produirait une tempête de re-livraisons pour un fait qui ne nous concerne pas.
Le 200 n'est pas un silence — le type annoncé est dans le corps de la réponse.
"""

import json
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request

from kojo_email import mask_email_address, send_email_via_active_provider
from kojo_email_suppressions import (
    WebhookRefuse,
    enregistrer_fait,
    lire_fait,
    verifier_signature,
)
from kojo_settings import OWNER_EMAIL, logger

router = APIRouter()

CHEMIN = "/email/resend-webhook"


def _refus(refus: WebhookRefuse) -> HTTPException:
    """Un refus de webhook, publié avec son MOTIF (jamais un code seul)."""
    logger.warning("⚠️ Webhook email refusé : %s", refus.motif)
    return HTTPException(status_code=refus.statut, detail={"status": "refuse", "motif": refus.motif})


async def _alerter_owner_sur_rebond(adresse: str, fait: Dict[str, Any], consecutifs: int) -> None:
    """Prévient le propriétaire d'une série de rebonds NON définitifs.

    Best-effort, comme les autres alertes propriétaire (ticket support, circuit
    breaker) : une alerte qui échoue ne doit pas faire échouer la réception du
    webhook, sinon Resend re-livrerait le fait et l'échec se répéterait.
    """
    if not OWNER_EMAIL:
        return
    try:
        await _envoyer_alerte_owner(adresse, fait, consecutifs)
    except Exception as exc:  # noqa: BLE001 - alerte best-effort, jamais bloquante
        logger.warning("⚠️ Alerte propriétaire (rebonds email) échouée : %s", exc)


async def _envoyer_alerte_owner(adresse: str, fait: Dict[str, Any], consecutifs: int) -> None:
    await send_email_via_active_provider(
        OWNER_EMAIL,
        "KOJO — Adresse email en échec répété (rebond transitoire)",
        (
            f"L'adresse {adresse} a accumulé {consecutifs} rebonds non définitifs "
            f"depuis sa dernière livraison réussie.\n\n"
            f"Dernier fait : {fait.get('type_evenement')} "
            f"({fait.get('type_rebond') or '?'} / {fait.get('sous_type') or '?'})\n"
            f"Message du fournisseur : {fait.get('message') or '(aucun)'}\n\n"
            "La boîte existe : elle est momentanément injoignable (pleine, serveur "
            "en panne). Aucune adresse n'a été retenue pour autant — la retenue "
            "n'arrive que sur un rebond DÉFINITIF ou une plainte."
        ),
    )


@router.post(CHEMIN)
async def resend_email_webhook(request: Request) -> Dict[str, Any]:
    """Reçoit les faits de livraison de Resend (rebonds, plaintes, retards).

    Returns:
        dict: {status: "ok" | "ignore", motif, supprime, rebonds_consecutifs} —
        le fait appliqué, ou le type ignoré. Un refus, lui, est un code HTTP
        nommé (401/400/503) : c'est ce que Resend lit pour décider de re-livrer.

    Raises:
        HTTPException: 503 (secret absent), 401 (signature), 400 (charge utile).
    """
    # Le corps est lu en OCTETS et la signature est vérifiée AVANT tout
    # parsing : la signature porte sur les octets reçus, donc re-sérialiser le
    # JSON la ferait échouer sur une requête légitime.
    corps = await request.body()

    try:
        id_evenement = verifier_signature(corps, request.headers)
    except WebhookRefuse as refus:
        raise _refus(refus)

    try:
        payload = json.loads(corps.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"status": "refuse", "motif": "corps illisible (JSON attendu) : %s" % exc},
        )

    try:
        fait = lire_fait(payload)
    except WebhookRefuse as refus:
        raise _refus(refus)

    if fait is None:
        type_annonce = str(payload.get("type") or "?")
        logger.info("ℹ️ Webhook email ignoré (type non suivi) : %s", type_annonce)
        return {"status": "ignore", "type": type_annonce}

    bilan = await enregistrer_fait(fait, id_evenement=id_evenement)

    if bilan["alerte_due"]:
        await _alerter_owner_sur_rebond(fait["email"], fait, bilan["rebonds_consecutifs"])

    if bilan["nouveau"]:
        logger.info(
            "📬 Fait de livraison %s (%s) pour %s%s",
            fait["type_evenement"],
            fait["motif"],
            mask_email_address(fait["email"]),
            " — adresse retenue" if bilan["supprime"] else "",
        )
    else:
        logger.info("↩️ Webhook email déjà traité (%s) : ignoré", id_evenement)

    # L'adresse n'est PAS recopiée dans la réponse : elle est déjà dans le fait
    # reçu, et le corps de réponse peut être journalisé côté fournisseur.
    return {
        "status": "ok",
        "motif": bilan["motif"],
        "nouveau": bilan["nouveau"],
        "supprime": bilan["supprime"],
        "rebonds_consecutifs": bilan["rebonds_consecutifs"],
    }
