# -*- coding: utf-8 -*-
"""Routes des alertes emploi (`/job-alerts`).

Trois routes authentifiées (lire, régler, couper) et UNE route publique : le
lien de désinscription d'un email. Cette dernière est un GET parce que les
clients de messagerie ne savent faire que ça — le jeton de l'URL est donc la
seule preuve, et c'est une CAPACITÉ volontairement révocable : la veille peut
être réactivée d'un PUT, et le pire usage d'un lien intercepté est de couper un
email auquel la personne ne tenait pas.

Ce que la route de lecture ne rend PAS : l'adresse email (une préférence, pas un
annuaire) ni le jeton (il ne sert qu'au lien envoyé par email).
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from kojo_core import get_current_user
from kojo_job_alerts import (
    _base_publique,
    desabonner_par_jeton,
    desactiver,
    enregistrer,
    lire,
)
from kojo_models import User, UserType

router = APIRouter()

# Réponse de désinscription : un document LISIBLE, sans script (il doit
# s'afficher même si le reste du site ne charge pas), non indexable (son URL
# porte un jeton) et jamais mis en cache pour la même raison.
_PAGE_DESINSCRIPTION = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>{titre} — Kojo</title>
<meta name="robots" content="noindex, nofollow" />
</head>
<body>
<h1>{titre}</h1>
<p>{texte}</p>
<p><a href="{base}/jobs">Voir les missions sur Kojo</a></p>
</body>
</html>
"""


def _page(titre: str, texte: str, status_code: int = 200) -> HTMLResponse:
    return HTMLResponse(
        _PAGE_DESINSCRIPTION.format(titre=titre, texte=texte, base=_base_publique()),
        status_code=status_code,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/job-alerts")
async def lire_alerte_emploi(current_user: User = Depends(get_current_user)):
    """La veille du compte connecté — `active: false` s'il n'en a pas.

    Returns:
        dict: {active, category, city, country, sent_count, last_notified_at}.
    """
    return await lire(current_user.id)


@router.put("/job-alerts")
async def enregistrer_alerte_emploi(
    donnees: dict, current_user: User = Depends(get_current_user)
):
    """Crée ou règle la veille du compte (une seule par compte).

    Body: {category?, city?, country?, active?, origin?}. Une catégorie
    inconnue est refusée en 422 : la ramener à « general » (ce que fait la
    normalisation des missions) enverrait toutes les missions générales pour une
    faute de frappe.

    `origin` dit la page de DÉPART (`ville`, `metier`, `directe`) et n'est
    écrite qu'à la CRÉATION : régler une veille existante ne réécrit pas d'où
    elle vient. Une provenance hors vocabulaire est refusée en 422 — un client
    qui se trompe de colonne fausserait exactement la mesure que ce champ
    existe pour produire. Absent, le corps n'est pas une faute : la veille est
    enregistrée avec `inconnue`, parce qu'une version d'avant le champ ne dit
    rien et qu'on ne peut pas le lui faire dire.

    La veille est réservée aux TRAVAILLEURS : un client recevrait le catalogue
    qu'il publie lui-même.

    Returns:
        dict: la veille telle que `lire` la rend.
    """
    if current_user.user_type != UserType.WORKER:
        raise HTTPException(
            status_code=403, detail="Les alertes emploi sont réservées aux travailleurs"
        )
    try:
        return await enregistrer(current_user.id, current_user.email, donnees or {})
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/job-alerts")
async def couper_alerte_emploi(current_user: User = Depends(get_current_user)):
    """Coupe la veille en gardant ses critères (réactivable d'un PUT).

    Returns:
        dict: la veille coupée (`active: false`).
    """
    return await desactiver(current_user.id)


@router.get("/job-alerts/unsubscribe", include_in_schema=False)
async def desinscrire_alerte_emploi(token: str = ""):
    """Lien de désinscription d'un email — sans authentification.

    Le jeton EST la preuve : il n'est envoyé qu'à l'adresse de la veille, et il
    ne permet rien d'autre que couper cette veille-là.

    Returns:
        HTMLResponse: confirmation (200), ou page 404 si le jeton ne désigne
        rien — un lien périmé doit se voir, pas se confondre avec un succès.
    """
    if not await desabonner_par_jeton(token):
        return _page(
            "Lien inconnu",
            "Ce lien de désinscription n’existe plus. Votre alerte n’a pas été modifiée.",
            status_code=404,
        )
    return _page(
        "Alerte désactivée",
        "Vous ne recevrez plus d’email de missions pour cette alerte. "
        "Vous pouvez la réactiver à tout moment depuis la page des missions.",
    )
