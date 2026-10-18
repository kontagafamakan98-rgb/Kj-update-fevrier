
from fastapi import APIRouter, Depends, HTTPException, Query

import kojo_live
from kojo_core import db
from kojo_models import (
    Notification, User,
)
from kojo_settings import (
    VAPID_PUBLIC_KEY,
)
from kojo_core import (
    get_current_user,
)
from kojo_identifiants import dump_stable, identifiant_query

router = APIRouter()

# Réponse d'un flux refusé : le client lit `Retry-After` et retombe sur son
# sondage dégradé au lieu de marteler la route. Un flux accepté puis muet
# serait indiscernable d'une absence d'événements (voir kojo_live).
STREAM_REFUSED = {"Retry-After": "60"}

@router.get("/notifications/vapid-public-key")
async def get_vapid_public_key():
    """Retourne la clé VAPID publique pour que le frontend puisse s'abonner.

    Returns:
        dict: {vapid_public_key}.
    """
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Notifications push non configurées sur ce serveur")
    return {"vapid_public_key": VAPID_PUBLIC_KEY}

@router.get("/notifications/stream")
async def stream_notifications(current_user: User = Depends(get_current_user)):
    """Flux SSE des notifications du compte connecté (remplace le sondage).

    Le premier événement `ready` porte le compteur NON LUS exact : un client qui
    vient d'ouvrir l'application n'a pas besoin d'appeler
    `/notifications/unread-count` pour se mettre à jour. Chaque notification
    créée ensuite est poussée (`notification`), et `resync` demande de relire la
    liste quand le flux a pris du retard.

    L'authentification est celle de toutes les routes (cookie de session ou
    Bearer) : le client lit le flux par `fetch`, pas par `EventSource`, donc le
    shell natif peut porter son `Authorization` sans mettre de jeton dans l'URL.

    Raises:
        HTTPException: 503 quand un des deux plafonds est atteint — celui du
            process, ou celui du COMPTE tous workers confondus — le client
            retombe sur le sondage dégradé.

    Returns:
        StreamingResponse: `text/event-stream`.
    """
    unread_count = await db.notifications.count_documents(
        {"user_id": current_user.id, "is_read": False}
    )
    try:
        return await kojo_live.sse_response(
            current_user.id,
            initial=(('ready', {"unread_count": unread_count}),),
        )
    except kojo_live.StreamCapacityExceeded as exc:
        raise HTTPException(
            status_code=503,
            detail="Flux temps réel momentanément indisponible : réessayez dans un instant.",
            headers=STREAM_REFUSED,
        ) from exc

@router.get("/notifications")
async def get_notifications(
    limit: int = Query(default=50, ge=1, le=100),
    unread_only: bool = Query(default=False),
    current_user: User = Depends(get_current_user)
):
    """Récupère les notifications de l'utilisateur connecté (les plus récentes en premier).

    Returns:
        dict: {notifications: [Notification.model_dump()], unread_count, total}.
    """
    query: dict = {"user_id": current_user.id}
    if unread_only:
        query["is_read"] = False

    notifications = await db.notifications.find(query).sort("created_at", -1).to_list(limit)
    unread_count = await db.notifications.count_documents({"user_id": current_user.id, "is_read": False})

    # L'identifiant rendu est celui du DOCUMENT (kojo_identifiants.dump_stable) :
    # un document antérieur au champ `id` recevrait sinon un nouvel uuid à chaque
    # lecture, et l'action de l'utilisateur (marquer lue, supprimer) viserait à côté.
    return {
        "notifications": [dump_stable(Notification, n) for n in notifications],
        "unread_count": unread_count,
        "total": len(notifications),
    }

@router.get("/notifications/unread-count")
async def get_unread_count(current_user: User = Depends(get_current_user)):
    """Retourne uniquement le compteur de notifications non lues.

    C'est le REPLI, plus le chemin principal : le temps réel passe par
    `/notifications/stream` (kojo_live). Cette route reste servie parce qu'un
    flux peut être refusé (503, plafond atteint) ou coupé (proxy, réseau), et
    qu'un client sans flux doit encore pouvoir lire son compteur — à basse
    fréquence (voir `NotificationContext`).

    Returns:
        dict: {unread_count}.
    """
    count = await db.notifications.count_documents({"user_id": current_user.id, "is_read": False})
    return {"unread_count": count}

@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user)
):
    """Marque une notification spécifique comme lue.

    Returns:
        dict: {message: "Notification marquée comme lue"}.
    """
    result = await db.notifications.update_one(
        {**identifiant_query(notification_id), "user_id": current_user.id},
        {"$set": {"is_read": True}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    return {"message": "Notification marquée comme lue"}

@router.put("/notifications/mark-all-read")
async def mark_all_notifications_read(current_user: User = Depends(get_current_user)):
    """Marque toutes les notifications de l'utilisateur comme lues.

    Returns:
        dict: {message, updated} (nombre de notifications modifiées).
    """
    result = await db.notifications.update_many(
        {"user_id": current_user.id, "is_read": False},
        {"$set": {"is_read": True}}
    )
    return {"message": f"{result.modified_count} notification(s) marquée(s) comme lue(s)", "updated": result.modified_count}

@router.delete("/notifications/{notification_id}")
async def delete_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user)
):
    """Supprime une notification de l'utilisateur.

    Returns:
        dict: {message: "Notification supprimée"}.
    """
    result = await db.notifications.delete_one(
        {**identifiant_query(notification_id), "user_id": current_user.id}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification introuvable")
    return {"message": "Notification supprimée"}

@router.delete("/notifications")
async def delete_all_notifications(current_user: User = Depends(get_current_user)):
    """Supprime toutes les notifications de l'utilisateur.

    Returns:
        dict: {message, deleted} (nombre de notifications supprimées).
    """
    result = await db.notifications.delete_many({"user_id": current_user.id})
    return {"message": f"{result.deleted_count} notification(s) supprimée(s)", "deleted": result.deleted_count}
