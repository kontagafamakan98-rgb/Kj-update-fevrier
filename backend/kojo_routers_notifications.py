
from fastapi import APIRouter, Depends, HTTPException, Query

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

router = APIRouter()

@router.get("/notifications/vapid-public-key")
async def get_vapid_public_key():
    """Retourne la clé VAPID publique pour que le frontend puisse s'abonner.

    Returns:
        dict: {vapid_public_key}.
    """
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Notifications push non configurées sur ce serveur")
    return {"vapid_public_key": VAPID_PUBLIC_KEY}

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

    return {
        "notifications": [Notification(**n).model_dump() for n in notifications],
        "unread_count": unread_count,
        "total": len(notifications),
    }

@router.get("/notifications/unread-count")
async def get_unread_count(current_user: User = Depends(get_current_user)):
    """Retourne uniquement le compteur de notifications non lues (polling léger).

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
        {"id": notification_id, "user_id": current_user.id},
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
    result = await db.notifications.delete_one({"id": notification_id, "user_id": current_user.id})
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
