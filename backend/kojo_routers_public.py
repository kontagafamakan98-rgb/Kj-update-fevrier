# -*- coding: utf-8 -*-
"""Endpoints PUBLICS (sans authentification) — uniquement des données
agrégées non sensibles, destinées à la landing page (chiffres réels plutôt
que des valeurs génériques codées en dur).

Sécurité : ne renvoie JAMAIS de données utilisateur individuelles, uniquement
des compteurs. Les collections sont indexées sur les champs filtrés, donc les
count_documents restent bon marché même à volume.
"""

from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Response

from kojo_core import db
from kojo_settings import FRONTEND_APP_URL, logger

router = APIRouter()

# Labels français des catégories pour la carte OG (le champ stocké est la clé
# machine : "plumbing", "electrical"… — on affiche un libellé lisible).
_CATEGORY_LABELS = {
    "plumbing": "Plomberie",
    "electrical": "Électricité",
    "construction": "Construction",
    "cleaning": "Nettoyage",
    "gardening": "Jardinage",
    "tutoring": "Cours particuliers",
    "mechanics": "Mécanique",
    "general": "Services divers",
}


def _fmt_fcfa(value) -> str:
    """Formatte un montant FCFA avec séparateur de milliers (espace)."""
    try:
        return f"{float(value):,.0f}".replace(",", " ")
    except (TypeError, ValueError):
        return ""


def _load_og_font(size: int):
    """Charge une police pour la carte OG — DejaVu (Linux/Fly), Arial
    (Windows/dev), repli sur la police embarquée Pillow (Aileron)."""
    from PIL import ImageFont

    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _wrap_text(draw, text: str, font, max_width: int, max_lines: int) -> list:
    """Coupe le texte en lignes de largeur max_width (max_lines max).

    Si le texte dépasse max_lines, la dernière ligne se termine par "…"
    (la suite du titre est perdue mais l'utilisateur comprend la coupe).
    """
    words = text.split()
    if not words:
        return [""]
    lines: list = []
    current = ""
    truncated = False
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not current:
            current = trial
        else:
            if len(lines) == max_lines - 1:
                truncated = True
                break
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    if truncated:
        lines[-1] = lines[-1].rstrip() + "…"
    return lines


def _job_og_meta(job: dict):
    """Prépare les lignes de texte d'une carte OG (budget, catégorie, lieu)."""
    budget_min = _fmt_fcfa(job.get("budget_min"))
    budget_max = _fmt_fcfa(job.get("budget_max"))
    if budget_min and budget_max:
        budget_line = f"Budget : {budget_min} – {budget_max} FCFA"
    elif budget_max:
        budget_line = f"Budget : jusqu'à {budget_max} FCFA"
    elif budget_min:
        budget_line = f"Budget : dès {budget_min} FCFA"
    else:
        budget_line = "Budget : à discuter"
    category = _CATEGORY_LABELS.get((job.get("category") or "").lower().strip(), job.get("category") or "")
    location = (job.get("location_text") or "").strip()
    meta_parts = [p for p in [category, location] if p]
    return budget_line, " · ".join(meta_parts)


def _draw_og_background(W: int, H: int):
    """Dégradé orange→rouge + halos (identique aux cartes statiques)."""
    from PIL import Image, ImageDraw

    top, mid, bottom = (234, 88, 12), (194, 65, 12), (220, 38, 38)
    img = Image.new("RGB", (W, H))
    draw = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        if t < 0.55:
            f = t / 0.55
            c = tuple(int(top[i] + (mid[i] - top[i]) * f) for i in range(3))
        else:
            f = (t - 0.55) / 0.45
            c = tuple(int(mid[i] + (bottom[i] - mid[i]) * f) for i in range(3))
        draw.line([(0, y), (W, y)], fill=c)

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([-180, -180, 340, 340], fill=(255, 255, 255, 12))
    od.ellipse([W - 340, H - 280, W + 260, H + 520], fill=(255, 255, 255, 12))
    img = Image.alpha_composite(img.convert("RGBA"), overlay)
    return img, ImageDraw.Draw(img)


def _render_job_og_card(job: dict, square: bool = False) -> bytes:
    """Génère la carte Open Graph de la fiche mission : dégradé orange→rouge
    (cohérent avec les images OG statiques du frontend), logo K, titre réel
    de la mission (2 lignes max), budget FCFA, catégorie et localisation.

    Format wide 1200x630 (défaut) pour les cartes de flux ; format carré
    1200x1200 (square=True) pour les réseaux qui recadrent en vignette 1:1
    (WhatsApp/Telegram/LinkedIn/aperçus Twitter) : composition CENTRÉE dans
    la zone sûre, un recadrage central conserve le contenu essentiel.

    Retourne les octets PNG."""
    from io import BytesIO

    from PIL import Image, ImageDraw

    W, H = (1200, 1200) if square else (1200, 630)
    img, draw = _draw_og_background(W, H)

    title = (job.get("title") or "Mission").strip()
    budget_line, meta_line = _job_og_meta(job)

    if square:
        # ── Composition carrée CENTRÉE (zone sûre ~940 px de large) ────────
        cx = W // 2
        safe_w = 940

        # Logo K centré en haut (carré arrondi semi-transparent + K blanc).
        logo_size = 210
        logo_x, logo_y = (W - logo_size) // 2, 120
        draw.rounded_rectangle([logo_x, logo_y, logo_x + logo_size, logo_y + logo_size],
                               radius=42, fill=(255, 255, 255, 40))
        font_k = _load_og_font(260)
        bbox = draw.textbbox((0, 0), "K", font=font_k)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((logo_x + (logo_size - tw) / 2 - bbox[0],
                   logo_y + (logo_size - th) / 2 - bbox[1]),
                  "K", fill=(255, 255, 255), font=font_k)

        # Kojo centré.
        font_name = _load_og_font(100)
        bbox = draw.textbbox((0, 0), "Kojo", font=font_name)
        draw.text((cx - (bbox[2] - bbox[0]) / 2 - bbox[0], 400 - bbox[1]),
                  "Kojo", fill=(255, 255, 255), font=font_name)

        # Titre : 2 lignes max centrées, police auto-réduite.
        lines: list = []
        for size in (52, 44, 38):
            font_title = _load_og_font(size)
            lines = _wrap_text(draw, title, font_title, max_width=safe_w, max_lines=2)
            if not any(line.endswith("…") for line in lines):
                break
        title_y = 530
        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=font_title)
            draw.text((cx - (bbox[2] - bbox[0]) / 2 - bbox[0], title_y - bbox[1]),
                      line, fill=(255, 255, 255), font=font_title)
            title_y += 64

        # Budget puis catégorie · lieu, centrés.
        font_meta = _load_og_font(40)
        bbox = draw.textbbox((0, 0), budget_line, font=font_meta)
        draw.text((cx - (bbox[2] - bbox[0]) / 2 - bbox[0], title_y + 40 - bbox[1]),
                  budget_line, fill=(255, 235, 215), font=font_meta)
        if meta_line:
            font_sub = _load_og_font(34)
            bbox = draw.textbbox((0, 0), meta_line, font=font_sub)
            draw.text((cx - (bbox[2] - bbox[0]) / 2 - bbox[0], title_y + 108 - bbox[1]),
                      meta_line, fill=(255, 255, 255), font=font_sub)
    else:
        # ── Composition wide (logo à gauche, texte à droite) ────────────────
        logo_size = 150
        logo_x, logo_y = 70, 70
        draw.rounded_rectangle([logo_x, logo_y, logo_x + logo_size, logo_y + logo_size],
                               radius=30, fill=(255, 255, 255, 40))
        font_k = _load_og_font(190)
        bbox = draw.textbbox((0, 0), "K", font=font_k)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((logo_x + (logo_size - tw) / 2 - bbox[0],
                   logo_y + (logo_size - th) / 2 - bbox[1]),
                  "K", fill=(255, 255, 255), font=font_k)

        text_x = logo_x + logo_size + 46
        draw.text((text_x, 108), "Kojo", fill=(255, 255, 255), font=_load_og_font(72))

        text_width = W - text_x - 70
        lines: list = []
        for size in (56, 46, 40):
            font_title = _load_og_font(size)
            lines = _wrap_text(draw, title, font_title, max_width=text_width, max_lines=2)
            if not any(line.endswith("…") for line in lines):
                break
        title_y = 200
        for line in lines:
            draw.text((text_x, title_y), line, fill=(255, 255, 255), font=font_title)
            title_y += 68

        font_meta = _load_og_font(36)
        draw.text((text_x, title_y + 30), budget_line, fill=(255, 235, 215), font=font_meta)
        if meta_line:
            draw.text((text_x, title_y + 80), meta_line, fill=(255, 255, 255), font=_load_og_font(32))

    # Bordure fine pour le contraste.
    draw.rectangle([0, 0, W - 1, H - 1], outline=(200, 70, 10), width=4)

    buf = BytesIO()
    img.convert("RGB").save(buf, "PNG", optimize=True)
    return buf.getvalue()


_OG_CACHE_CLOSED = "public, max-age=86400, s-maxage=86400, must-revalidate"
_OG_CACHE_ACTIVE = "public, max-age=3600, s-maxage=3600"


def _job_og_cache_control(job: dict) -> str:
    """Cache-Control de la carte OG selon l'état de la mission.

    Les états TERMINAUX (completed / cancelled — « mission clôturée ») ne
    peuvent plus jamais évoluer : le titre, le budget, la catégorie et la
    localisation gravés sur la carte sont immuables. On peut donc demander au
    CDN/crawlers un cache LONG (max-age=86400, soit 24 h, avec must-revalidate
    pour revalider à expiration) au lieu du cache court de 1 h : ça évite aux
    crawlers (Facebook, LinkedIn, WhatsApp) de re-fêter la carte à chaque
    partage d'une mission déjà clôturée.

    Les états non terminaux (open / in_progress) gardent un cache court de 1 h :
    la mission est encore éditable, et une carte moins fraîche risquerait de
    montrer un budget ou un titre périmé.
    """
    status = (job.get("status") or "").strip().lower()
    if status in ("completed", "cancelled"):
        return _OG_CACHE_CLOSED
    return _OG_CACHE_ACTIVE


# IMPORTANT : la route « -square.png » est déclarée AVANT la route générique
# « {job_id}.png » — sinon FastAPI matcherait « …-square.png » sur la première
# (job_id = "…-square") et renverrait un 404 pour les fiches existantes.
@router.get("/og/jobs/{job_id}-square.png", include_in_schema=False)
async def get_job_og_image_square(job_id: str):
    """Carte Open Graph CARRÉE 1200x1200 d'une fiche mission.

    Variante pour les réseaux qui RECADRENT la carte en vignette 1:1
    (WhatsApp, Telegram, iMessage, LinkedIn, aperçus Twitter) : composition
    centrée dans la zone sûre — un recadrage central conserve logo, titre et
    budget. Le frontend déclare cette URL en second og:image (dimensions
    1200x1200) ; les crawlers choisissent la variante adaptée à leur rendu.

    Returns:
        PNG (image/png) — 404 si la mission n'existe pas.
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        png = _render_job_og_card(job, square=True)
    except Exception as exc:  # Pillow absent ou erreur de rendu : 500 propre
        logger.error("OG square image render failed for job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="OG image rendering failed") from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": _job_og_cache_control(job)},
    )


@router.get("/og/jobs/{job_id}.png", include_in_schema=False)
async def get_job_og_image(job_id: str):
    """Carte Open Graph dynamique d'une fiche mission (/jobs/:id).

    Le frontend pointe og:image de JobDetails vers cette URL : les crawlers
    de partage (Facebook, LinkedIn, WhatsApp) récupèrent un PNG 1200x630 avec
    le TITRE RÉEL de la mission — impossible à pré-rendre statiquement (une
    fiche par job). Le rewrite Vercel /api/:path* → Fly achemine l'appel.

    Returns:
        PNG (image/png) — 404 si la mission n'existe pas.
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        png = _render_job_og_card(job)
    except Exception as exc:  # Pillow absent ou erreur de rendu : 500 propre
        logger.error("OG image render failed for job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="OG image rendering failed") from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": _job_og_cache_control(job)},
    )


def _job_og_html(job: dict, base: str) -> str:
    """HTML pré-rendu (crawlers sans JS) d'une fiche mission /jobs/:id.

    Les crawlers de partage (Facebook, LinkedIn, WhatsApp) ne lisent QUE le
    HTML servi, sans exécuter JavaScript : ce document porte les méta OG de
    la mission (titre, description, cartes wide + carrée pointées vers les
    endpoints Pillow du backend) + le shell h1 statique. Le rewrite Vercel
    /jobs/(.*) → /api/og/jobs/$1 achemine les fiches ici — plus de fonction
    serverless Vercel à déployer (Vercel ne collecte pas api/ en mode
    outputDirectory statique).
    """
    job_id = str(job.get("id") or "")
    raw_title = str(job.get("title") or "")
    title = f"{raw_title} — Kojo" if raw_title else "Mission — Kojo"
    raw_desc = str(job.get("description") or "")
    desc = raw_desc[:150] + ("…" if len(raw_desc) > 150 else "")
    url = f"{base}/jobs/{_xml_escape(job_id)}"
    wide = f"{base}/api/og/jobs/{_xml_escape(job_id)}.png"
    square = f"{base}/api/og/jobs/{_xml_escape(job_id)}-square.png"
    t = _xml_escape(title)
    d = _xml_escape(desc)
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        f"<title>{t}</title>\n"
        f"<meta name=\"description\" content=\"{d}\" />\n"
        "<meta name=\"robots\" content=\"index, follow\" />\n"
        f"<link rel=\"canonical\" href=\"{url}\" />\n"
        "<meta property=\"og:type\" content=\"article\" />\n"
        f"<meta property=\"og:url\" content=\"{url}\" />\n"
        f"<meta property=\"og:title\" content=\"{t}\" />\n"
        f"<meta property=\"og:description\" content=\"{d}\" />\n"
        f"<meta property=\"og:image\" content=\"{wide}\" />\n"
        "<meta property=\"og:image:width\" content=\"1200\" />\n"
        "<meta property=\"og:image:height\" content=\"630\" />\n"
        "<meta property=\"og:image:type\" content=\"image/png\" />\n"
        f"<meta property=\"og:image\" content=\"{square}\" />\n"
        "<meta property=\"og:image:width\" content=\"1200\" />\n"
        "<meta property=\"og:image:height\" content=\"1200\" />\n"
        "<meta property=\"og:image:type\" content=\"image/png\" />\n"
        "<meta property=\"og:locale\" content=\"fr_FR\" />\n"
        "<meta property=\"og:site_name\" content=\"Kojo\" />\n"
        "<meta name=\"twitter:card\" content=\"summary_large_image\" />\n"
        f"<meta name=\"twitter:url\" content=\"{url}\" />\n"
        f"<meta name=\"twitter:title\" content=\"{t}\" />\n"
        f"<meta name=\"twitter:description\" content=\"{d}\" />\n"
        f"<meta name=\"twitter:image\" content=\"{wide}\" />\n"
        "</head>\n<body>\n"
        "<div id=\"root\">\n"
        "<div class=\"h-16 bg-white border-b border-gray-200\"></div>\n"
        "<div class=\"max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8\">\n"
        f"<h1 class=\"text-3xl font-bold text-gray-900 mb-2\">{t}</h1>\n"
        "</div>\n</div>\n</body>\n</html>\n"
    )


def _job_og_html_404(base: str) -> str:
    """HTML neutre pour une fiche inconnue — explicite noindex."""
    return (
        "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n"
        "<meta charset=\"utf-8\" />\n"
        "<title>Mission introuvable — Kojo</title>\n"
        "<meta name=\"robots\" content=\"noindex, nofollow\" />\n"
        "</head>\n<body>\n<div id=\"root\"></div>\n</body>\n</html>\n"
    )


# IMPORTANT : déclaré APRÈS les routes « {job_id}-square.png » et
# « {job_id}.png » — sinon FastAPI matcherait « …-square.png » sur {job_id}
# (job_id = « …-square.png ») et casserait les cartes images.
@router.get("/og/jobs/{job_id}", include_in_schema=False)
async def get_job_og_html(job_id: str):
    """Page HTML pré-rendue d'une fiche mission (/jobs/:id) pour les crawlers.

    Remplace la fonction serverless Vercel api/og-jobs/[id].js (jamais
    déployée : Vercel ne collecte pas le dossier api/ en mode outputDirectory
    statique). Le rewrite Vercel /jobs/(.*) → /api/og/jobs/$1 achemine les
    fiches ici : 200 + méta OG de la mission si elle existe, 404 + noindex
    sinon — c'est ce que vérifie le check CI check-og-images.

    Returns:
        Response: HTML (text/html) — 404 noindex si la mission n'existe pas.
    """
    job = await db.jobs.find_one({"id": job_id, "deleted": {"$ne": True}})
    base = _site_base()
    if not job:
        return Response(
            content=_job_og_html_404(base),
            media_type="text/html; charset=utf-8",
            status_code=404,
            headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"},
        )
    return Response(
        content=_job_og_html(job, base),
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": _job_og_cache_control(job)},
    )

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

    Returns:
        Response: XML (text/xml) — le sitemap complet, pas un objet JSON.
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
    comme repli si le proxy /api est désactivé.

    Returns:
        Response: texte brut (text/plain) — les directives robots.txt.
    """
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
