# -*- coding: utf-8 -*-
"""Endpoints PUBLICS (sans authentification) — uniquement des données
agrégées non sensibles, destinées à la landing page (chiffres réels plutôt
que des valeurs génériques codées en dur).

Sécurité : ne renvoie JAMAIS de données utilisateur individuelles, uniquement
des compteurs. Les collections sont indexées sur les champs filtrés, donc les
count_documents restent bon marché même à volume.
"""

from urllib.parse import urlparse

from fastapi import APIRouter, Response

from kojo_core import db
from kojo_settings import FRONTEND_APP_URL, logger

router = APIRouter()

# Base du site pour le sitemap/robots. En production, FRONTEND_APP_URL doit
# pointer vers le domaine public Vercel ; repli sur le domaine Fly du backend
# (utilisateur derrière le proxy /api, jamais pour le vrai crawl).
DEFAULT_SITE_BASE = "https://kj-update-fevrier.vercel.app"

def _site_base() -> str:
    base = (FRONTEND_APP_URL or DEFAULT_SITE_BASE).rstrip('/')
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return DEFAULT_SITE_BASE
    return base


@router.get("/public/stats")
async def get_public_stats():
    """Compteurs réels pour la landing : travailleurs, missions, avis, pays.

    Returns:
        dict: {workers, clients, open_jobs, completed_jobs, reviews, countries}.
    """
    workers = await db.users.count_documents({"user_type": "worker"})
    clients = await db.users.count_documents({"user_type": "client"})
    open_jobs = await db.jobs.count_documents(
        {"status": "open", "deleted": {"$ne": True}}
    )
    completed_jobs = await db.jobs.count_documents(
        {"status": "completed", "deleted": {"$ne": True}}
    )
    reviews = await db.reviews.count_documents({})
    return {
        "workers": workers,
        "clients": clients,
        "open_jobs": open_jobs,
        "completed_jobs": completed_jobs,
        "reviews": reviews,
        "countries": 4,
    }


def _xml_escape(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


@router.get("/sitemap.xml", include_in_schema=False)
async def get_sitemap_xml():
    """Sitemap dynamique : liste statique du site + toutes les fiches de
    mission PUBLIQUES (/jobs/:id) encore ouvertes ou en cours — les seules
    pages métier indexables (les autres statuts sont privés/terminés).

    Sert du XML réel (text/xml) pour que Google puisse crawler les fiches
    exactes, au lieu du sitemap statique Vercel qui n'énumérait que la home.
    Le Vercel rewrite /sitemap.xml → /api/sitemap.xml (vercel.json) achemine
    le crawler jusqu'ici.
    """
    base = _site_base()

    static_urls = [
        (base + "/", "daily", "1.0"),
        (base + "/how-it-works", "monthly", "0.7"),
        (base + "/login", "weekly", "0.8"),
        (base + "/register", "weekly", "0.8"),
        (base + "/jobs", "hourly", "0.9"),
    ]

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0">',
    ]
    for url, changefreq, priority in static_urls:
        lines.append(
            f"  <url><loc>{_xml_escape(url)}</loc>"
            f"<changefreq>{changefreq}</changefreq>"
            f"<priority>{priority}</priority><mobile:mobile/></url>"
        )

    # Fiches missions publiques (ouvertes/en cours). Limite raisonnable :
    # sitemap de 10k URLs max — on sert les plus récentes.
    cursor = db.jobs.find(
        {"status": {"$in": ["open", "in_progress"]}, "deleted": {"$ne": True}},
        {"id": 1, "updated_at": 1},
    ).sort("created_at", -1).limit(9000)
    async for job in cursor:
        lines.append(
            f"  <url><loc>{_xml_escape(base)}/jobs/{_xml_escape(job['id'])}</loc>"
            f"<lastmod>{str(job.get('updated_at') or job.get('created_at') or '')[:10]}</lastmod>"
            f"<changefreq>daily</changefreq><priority>0.8</priority><mobile:mobile/></url>"
        )

    lines.append("</urlset>")
    body = "\n".join(lines)
    # Cache court : les missions changent peu souvent, mais une fiche peut
    # être clôturée — on ne sert jamais une photo de plus de 1h.
    return Response(
        content=body,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600, s-maxage=3600"},
    )


@router.get("/robots.txt", include_in_schema=False)
async def get_robots_txt():
    """robots.txt servi par le BACKEND (source de vérité) au lieu du fichier
    statique Vercel : renvoie les mêmes directives que public/robots.txt mais
    pointe dynamiquement vers le bon domaine pour la balise Sitemap.

    Le rewrite Vercel /robots.txt → /api/robots.txt (transient.json) fait que
    les crawlers reçoivent cette version. Le fichier statique reste en place
    comme repli si le proxy /api est désactivé."""
    base = _site_base()
    body = (
        f"User-agent: *\n"
        f"Allow: /\n"
        f"Allow: /login\n"
        f"Allow: /register\n"
        f"Allow: /jobs\n"
        f"Allow: /how-it-works\n"
        f"Disallow: /dashboard\n"
        f"Disallow: /profile\n"
        f"Disallow: /messages\n"
        f"Disallow: /api/\n"
        f"Disallow: /photo-debug\n"
        f"\n"
        f"Sitemap: {base}/sitemap.xml\n"
    )
    return Response(content=body, media_type="text/plain")
