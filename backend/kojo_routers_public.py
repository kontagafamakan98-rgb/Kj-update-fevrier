# -*- coding: utf-8 -*-
"""Endpoints PUBLICS (sans authentification) — uniquement des données
agrégées non sensibles, destinées à la landing page (chiffres réels plutôt
que des valeurs génériques codées en dur).

Sécurité : ne renvoie JAMAIS de données utilisateur individuelles, uniquement
des compteurs. Les collections sont indexées sur les champs filtrés, donc les
count_documents restent bon marché même à volume.
"""

import asyncio
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Response

from pydantic import ValidationError

from kojo_core import db
from kojo_balises import DesequilibreHtml, exiger_balises_equilibrees
from kojo_job_og import escape_xml, job_og_html, job_og_html_404
# La vue PUBLIQUE d'une mission (allowlist `JobPublic`) a UN propriétaire :
# `_job_view` dans son routeur. Le pré-rendu la LIT au lieu d'en construire une
# seconde — deux constructions divergeraient au premier champ ajouté, et c'est
# exactement ce que l'allowlist existe pour empêcher.
from kojo_routers_jobs_listing import _job_view
# La vue PUBLIQUE d'un travailleur vit dans son routeur (allowlist) : le
# pré-rendu et la carte OG la LISENT au lieu d'en construire une seconde. Deux
# constructions divergeraient au premier champ ajouté, et c'est exactement ce
# que l'allowlist existe pour empêcher.
from kojo_routers_workers_public import profil_public
from kojo_settings import FRONTEND_APP_URL, logger
from kojo_identifiants import identifiant_job_query, identifiant_public
from kojo_worker_og import (
    nom_complet,
    worker_meta_lines,
    worker_og_html,
    worker_og_html_404,
)

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
    "carpentry": "Menuiserie",
    "computing": "Informatique",
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


def _render_og_card(*, title: str, primary_line: str, secondary_line: str, square: bool = False) -> bytes:
    """Génère une carte Open Graph : dégradé orange→rouge (cohérent avec les
    images OG statiques du frontend), logo K, titre réel (2 lignes max), une
    ligne principale (budget d'une mission, réputation d'un travailleur) et une
    ligne secondaire (catégorie · lieu).

    Format wide 1200x630 (défaut) pour les cartes de flux ; format carré
    1200x1200 (square=True) pour les réseaux qui recadrent en vignette 1:1
    (WhatsApp/Telegram/LinkedIn/aperçus Twitter) : composition CENTRÉE dans
    la zone sûre, un recadrage central conserve le contenu essentiel.

    SYNCHRONE ET COÛTEUX (95 à 130 ms mesurés sur ce poste, dessin + encodage
    PNG) : c'est du CPU, pas de l'attente. Appelé directement depuis une route
    `async def`, il gelait le worker entier — mesuré, 4 rendus simultanés
    faisaient monter `/api/health` à 305 ms, et 8 rendus « parallèles »
    n'étaient que ×1,27 plus rapides que 8 rendus séquentiels. Les routes
    l'appellent donc par `asyncio.to_thread` (`test_event_loop_non_blocage.py`
    le verrouille). Un crawler qui parcourt les fiches ne doit pas arrêter l'API.

    Retourne les octets PNG."""
    from io import BytesIO

    # Pas d'import de `PIL.Image` ici : `_draw_og_background` porte le dessin et
    # l'image revient déjà construite. Un import inutilisé faisait sortir ce
    # fichier en avertissement pyflakes sans rien dire de plus.
    W, H = (1200, 1200) if square else (1200, 630)
    img, draw = _draw_og_background(W, H)
    budget_line, meta_line = primary_line, secondary_line

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
    # `compress_level=6` plutôt que `optimize=True` : mesuré sur une 1200×630,
    # `optimize=True` coûte 34,8 ms pour 9,5 ms ici, POUR LA MÊME TAILLE de
    # fichier — il essaie des stratégies zlib supplémentaires qui ne gagnent
    # rien sur une image de ce genre. Le gain de poids ne se paierait qu'en
    # CPU sur la boucle d'un worker à 1 vCPU.
    img.convert("RGB").save(buf, "PNG", compress_level=6)
    return buf.getvalue()


def _render_job_og_card(job: dict, square: bool = False) -> bytes:
    """Carte OG d'une fiche mission (titre, budget, catégorie · lieu).

    Enveloppe de `_render_og_card` : le dessin est PARTAGÉ avec la carte d'un
    profil travailleur — une seconde copie du gabarit divergerait de la première
    au premier changement de teinte, et deux cartes du même site ne se
    ressembleraient plus.
    """
    budget_line, meta_line = _job_og_meta(job)
    return _render_og_card(
        title=(job.get("title") or "Mission").strip(),
        primary_line=budget_line,
        secondary_line=meta_line,
        square=square,
    )


def _render_worker_og_card(worker: dict, square: bool = False) -> bytes:
    """Carte OG d'un profil travailleur : nom, réputation, lieu · compétences."""
    principale, secondaire = worker_meta_lines(worker)
    return _render_og_card(
        title=(nom_complet(worker) or "Travailleur"),
        primary_line=principale,
        secondary_line=secondaire,
        square=square,
    )


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
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        # Hors de la boucle : le rendu est du CPU (cf. docstring du rendu).
        png = await asyncio.to_thread(_render_job_og_card, job, square=True)
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
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        # Hors de la boucle : le rendu est du CPU (cf. docstring du rendu).
        png = await asyncio.to_thread(_render_job_og_card, job)
    except Exception as exc:  # Pillow absent ou erreur de rendu : 500 propre
        logger.error("OG image render failed for job %s: %s", job_id, exc)
        raise HTTPException(status_code=500, detail="OG image rendering failed") from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": _job_og_cache_control(job)},
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
    job = await db.jobs.find_one({**identifiant_job_query(job_id), "deleted": {"$ne": True}})
    base = _site_base()
    # Le HTML servi aux crawlers passe la MÊME règle d'équilibre que le frontend
    # (kojo_balises.py) : un document déséquilibré n'est pas servi — il est
    # journalisé avec la balise nommée, et la requête répond 500.
    try:
        if not job:
            return Response(
                content=exiger_balises_equilibrees(
                    f"la page 404 de la fiche {job_id}", job_og_html_404(), origine="kojo_job_og"
                ),
                media_type="text/html; charset=utf-8",
                status_code=404,
                headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"},
            )
        # Le bloc de données est la vue que `GET /jobs/:id` rend déjà à un
        # visiteur anonyme : coordonnées GPS, identités et champs internes
        # restent donc ABSENTS du document, par construction. Un document legacy
        # qui ne valide pas l'allowlist garde sa tête et son application, mais
        # pas de bloc (la page démarre par un chargement) — refuser la fiche
        # entière priverait la mission de sa carte de partage pour un défaut de
        # données qu'elle ne peut pas corriger.
        try:
            apercu = _job_view(job, None)
            vue_publique = (
                apercu.model_dump(mode="json") if hasattr(apercu, "model_dump") else apercu
            )
        except ValidationError as exc:
            logger.warning(
                "Pré-rendu de la fiche %s : vue publique indisponible (%s) — document "
                "servi SANS bloc de données, la fiche démarrera par un chargement.",
                job_id,
                exc,
            )
            vue_publique = None
        corps = exiger_balises_equilibrees(
            f"la fiche mission {job_id}",
            job_og_html(job, base, vue_publique=vue_publique),
            origine="kojo_job_og",
        )
    except DesequilibreHtml as exc:
        logger.error("Pré-rendu HTML de la fiche %s refusé : %s", job_id, exc)
        raise HTTPException(status_code=500, detail="Job HTML rendering failed") from exc
    return Response(
        content=corps,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": _job_og_cache_control(job)},
    )


# ── Profil public d'un travailleur (/workers/:id) ────────────────────────────
# Même famille que les trois routes ci-dessus, même discipline d'ordre : la
# variante « -square.png » AVANT le motif « {worker_id}.png », et le HTML APRÈS
# les images — sinon FastAPI lirait « awa-square.png » comme un identifiant.
#
# Ce que ces routes ne peuvent PAS publier : elles lisent `profil_public`, donc
# l'allowlist. Une carte de partage est publique et restera en cache : elle ne
# doit jamais graver un email, un téléphone ou une position.


@router.get("/og/workers/{worker_id}-square.png", include_in_schema=False)
async def get_worker_og_image_square(worker_id: str):
    """Carte Open Graph CARRÉE (1200x1200) d'un profil travailleur.

    Returns:
        Response: PNG 1200x1200, ou 404 si le profil n'est pas public.
    """
    worker = await profil_public(worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    try:
        # Hors de la boucle : le rendu est du CPU (cf. `_render_og_card`).
        png = await asyncio.to_thread(_render_worker_og_card, worker, square=True)
    except Exception as exc:  # Pillow absent ou erreur de rendu : 500 propre
        logger.error("OG square worker render failed for %s: %s", worker_id, exc)
        raise HTTPException(status_code=500, detail="OG image rendering failed") from exc
    return Response(
        content=png,
        media_type="image/png",
        # Un profil vit (avis, missions, ville) : pas d'état terminal, donc
        # jamais la politique de cache longue des missions clôturées.
        headers={"Cache-Control": _OG_CACHE_ACTIVE},
    )


@router.get("/og/workers/{worker_id}.png", include_in_schema=False)
async def get_worker_og_image(worker_id: str):
    """Carte Open Graph dynamique (1200x630) d'un profil travailleur.

    Le rewrite Vercel /api/:path* achemine l'appel ; le crawler reçoit un PNG
    avec le NOM RÉEL et la réputation de la personne, pas la carte générique du
    site.

    Returns:
        Response: PNG 1200x630, ou 404 si le profil n'est pas public.
    """
    worker = await profil_public(worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    try:
        png = await asyncio.to_thread(_render_worker_og_card, worker)
    except Exception as exc:
        logger.error("OG worker image render failed for %s: %s", worker_id, exc)
        raise HTTPException(status_code=500, detail="OG image rendering failed") from exc
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": _OG_CACHE_ACTIVE},
    )


@router.get("/og/workers/{worker_id}", include_in_schema=False)
async def get_worker_og_html(worker_id: str):
    """Page HTML pré-rendue d'un profil travailleur (/workers/:id).

    Sert ce qu'un crawler sans JavaScript doit lire : titre, description,
    canonical, cartes OG — et un `<h1>` statique. 200 si le profil est public,
    404 noindex sinon. C'est la même paire que la fiche mission, et le rewrite
    Vercel /workers/(.*) → /api/og/workers/$1 l'achemine ici.

    Returns:
        Response: HTML pré-rendu (200), ou HTML noindex (404) si le profil
        n'est pas publiable (inconnu, client, supprimé).
    """
    worker = await profil_public(worker_id)
    base = _site_base()
    try:
        if not worker:
            return Response(
                content=exiger_balises_equilibrees(
                    f"la page 404 du profil {worker_id}", worker_og_html_404(), origine="kojo_worker_og"
                ),
                media_type="text/html; charset=utf-8",
                status_code=404,
                headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"},
            )
        corps = exiger_balises_equilibrees(
            f"le profil travailleur {worker_id}",
            # L'identifiant de la ROUTE, quand la vue n'en rend aucun (document
            # importé sans `id` ni `_id`) : une URL canonique vide ne désignerait
            # plus la page ouverte.
            worker_og_html({**worker, "id": worker.get("id") or worker_id}, base),
            origine="kojo_worker_og",
        )
    except DesequilibreHtml as exc:
        logger.error("Pré-rendu HTML du profil %s refusé : %s", worker_id, exc)
        raise HTTPException(status_code=500, detail="Worker HTML rendering failed") from exc
    return Response(
        content=corps,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": _OG_CACHE_ACTIVE},
    )

# Base du site pour le SITEMAP (seul reste à être servi par le backend ; le
# robots.txt, lui, est un fichier du build). En production, FRONTEND_APP_URL doit
# pointer vers le domaine public (kojoforafrica.cc.cd, alias Vercel) ; repli sur
# le domaine Fly du backend (utilisateur derrière le proxy /api, jamais pour le
# vrai crawl).
DEFAULT_SITE_BASE = "https://kojoforafrica.cc.cd"

def _site_base() -> str:
    base = (FRONTEND_APP_URL or DEFAULT_SITE_BASE).rstrip('/')
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return DEFAULT_SITE_BASE
    return base


@router.get("/public/stats")
async def get_public_stats(response: Response):
    """Compteurs réels pour la landing : travailleurs, missions, avis, pays.

    Ces chiffres sont la PREUVE SOCIALE de l'accueil : ils sont MESURÉS, jamais
    décorés. Trois règles les tiennent :

      • un compte SUPPRIMÉ n'est pas un travailleur (`deleted: True` est posé par
        la suppression de compte, cf. `kojo_routers_users_account`) — le
        compter ferait grossir la preuve à mesure qu'on perd des gens ;
      • une mission SUPPRIMÉE n'est ni ouverte ni terminée (même règle que la
        liste publique et le sitemap) ;
      • aucun champ d'identité ne sort : la réponse est une liste FERMÉE de
        compteurs, pas une projection de documents (garde :
        `tests/test_public_stats.py`).

    `Cache-Control` : la donnée ne bouge qu'aux inscriptions et publications,
    donc la landing peut la garder une minute — un visiteur ne martèle pas
    MongoDB pour un chiffre qui ne change pas sous ses yeux.

    Returns:
        dict: {workers, clients, open_jobs, completed_jobs, reviews, countries}.
    """
    actifs = {"deleted": {"$ne": True}}
    workers = await db.users.count_documents({"user_type": "worker", **actifs})
    clients = await db.users.count_documents({"user_type": "client", **actifs})
    open_jobs = await db.jobs.count_documents(
        {"status": "open", "deleted": {"$ne": True}}
    )
    completed_jobs = await db.jobs.count_documents(
        {"status": "completed", "deleted": {"$ne": True}}
    )
    reviews = await db.reviews.count_documents({})
    response.headers["Cache-Control"] = "public, max-age=60, s-maxage=60"
    return {
        "workers": workers,
        "clients": clients,
        "open_jobs": open_jobs,
        "completed_jobs": completed_jobs,
        "reviews": reviews,
        "countries": 4,
    }


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
        # Les trois pages de confiance : un moteur (et une régie publicitaire)
        # cherche à savoir qui édite le site, comment le joindre et ce qu'il fait
        # des données. Elles existent en pages pré-rendues depuis le 19/09/2026 ;
        # les lister ici est ce qui les rend DÉCOUVRABLES sans lien entrant.
        (base + "/about", "monthly", "0.6"),
        (base + "/contact", "monthly", "0.6"),
        (base + "/privacy", "yearly", "0.4"),
    ]

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0">',
    ]
    for url, changefreq, priority in static_urls:
        lines.append(
            f"  <url><loc>{escape_xml(url)}</loc>"
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
            f"  <url><loc>{escape_xml(base)}/jobs/{escape_xml(job['id'])}</loc>"
            f"<lastmod>{str(job.get('updated_at') or job.get('created_at') or '')[:10]}</lastmod>"
            f"<changefreq>daily</changefreq><priority>0.8</priority><mobile:mobile/></url>"
        )

    # Profils TRAVAILLEURS publics. Depuis le 20/10/2026, /workers/:id est une
    # page pré-rendue par le backend (rewrite Vercel /workers/(.*)) : sans
    # entrée ici, elle ne serait découverte que par un lien entrant — c'est-à-
    # dire, en pratique, jamais. Seuls les profils qui publient un NOM sont
    # listés (une page sans nom n'a rien à indexer), les plus récents d'abord.
    # Limite : le sitemap reste sous les 50 000 URL du format, missions
    # comprises.
    curseur = db.users.find(
        {
            "user_type": "worker",
            "deleted": {"$ne": True},
            "first_name": {"$nin": [None, ""]},
        },
        {"id": 1, "_id": 1, "created_at": 1},
    ).sort("created_at", -1).limit(4000)
    async for worker in curseur:
        # `identifiant_public` : un compte importé peut ne porter que `_id`, et
        # un identifiant vide ne désignerait aucune page.
        identifiant = identifiant_public(worker)
        if not identifiant:
            continue
        lines.append(
            f"  <url><loc>{escape_xml(base)}/workers/{escape_xml(identifiant)}</loc>"
            f"<lastmod>{str(worker.get('created_at') or '')[:10]}</lastmod>"
            f"<changefreq>weekly</changefreq><priority>0.6</priority><mobile:mobile/></url>"
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


# robots.txt n'est PLUS servi ici : il est écrit au build par le FRONTEND, depuis
# la liste des routes privées DÉRIVÉE du routage (scripts/check-spa-routes.js).
# Cette route portait sa propre liste `Disallow`, écrite à la main, et les deux
# ne se parlaient pas : mesuré le 20/09/2026, elle interdisait 4 routes privées
# sur 9 — /create-job, /email-verification, /payment-verification,
# /commission-dashboard et /support-admin restaient crawlables. Le rewrite
# Vercel /robots.txt → /api/robots.txt a donc été retiré en même temps : il
# masquerait le fichier du build (la réécriture passe avant le fichier statique).
# Le SEUL fichier robots.txt publié est celui du build — voir
# vite-plugins/write-robots-txt.js et CI-COVERAGE.md.
