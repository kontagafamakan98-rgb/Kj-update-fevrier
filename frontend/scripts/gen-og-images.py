#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère les images Open Graph spécifiques à chaque page clé de Kojo.

Deux formats par page :

  * 1200x630 (wide) — cartes de flux Facebook/LinkedIn/WhatsApp et
    twitter:image summary_large_image (ratio 2:1 recommandé par Twitter).
  * 1200x1200 (carré) — variante composée CENTRÉE (logo + accroche dans une
    zone sûre) pour les réseaux qui RECADRENT l'image en vignette carrée
    (WhatsApp, Telegram, iMessage, LinkedIn, aperçus Twitter) : un recadrage
    1:1 du centre conserve le contenu essentiel.

Génère aussi le favicon SOMBRE (fond graphite + K dégradé) pour les surfaces
sombres (onglets navigateur en mode sombre, cartes de partage sur fond foncé).

Usage (Pillow) :
    cd frontend && ../backend/.venv/Scripts/python scripts/gen-og-images.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
SQUARE = 1200
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')

# --- Palette : même dégradé que la hero (orange-600 → red-600) ---
TOP = (234, 88, 12)    # orange-600
MID = (194, 65, 12)    # orange-700
BOTTOM = (220, 38, 38)  # red-600


def make_gradient(width, height):
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / (height - 1)
        if t < 0.55:
            f = t / 0.55
            c = tuple(int(TOP[i] + (MID[i] - TOP[i]) * f) for i in range(3))
        else:
            f = (t - 0.55) / 0.45
            c = tuple(int(MID[i] + (BOTTOM[i] - MID[i]) * f) for i in range(3))
        draw.line([(0, y), (width, y)], fill=c)
    return img


def make_overlay(width, height):
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([-180, -180, 340, 340], fill=(255, 255, 255, 12))
    od.ellipse([width - 340, height - 280, width + 260, height + 520], fill=(255, 255, 255, 12))
    return overlay


def load_font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/DejaVuSans-Bold.ttf" if bold else "C:/Windows/Fonts/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _center_text(draw, cx, y, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text((cx - (bbox[2] - bbox[0]) / 2 - bbox[0], y - bbox[1]), text, fill=fill, font=font)


def draw_logo(img, overlay, logo_size, logo_x, logo_y):
    """Recompose le logo "K" (carré arrondi semi-transparent + K blanc)."""
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([logo_x, logo_y, logo_x + logo_size, logo_y + logo_size],
                         radius=int(logo_size * 0.2), fill=(255, 255, 255, 40))
    img = Image.alpha_composite(img.convert("RGBA"), overlay)
    draw = ImageDraw.Draw(img)
    font_k = load_font(int(logo_size * 1.25), bold=True)
    bbox = draw.textbbox((0, 0), "K", font=font_k)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((logo_x + (logo_size - tw) / 2 - bbox[0],
               logo_y + (logo_size - th) / 2 - bbox[1]),
              "K", fill=(255, 255, 255), font=font_k)
    return img


def render_wide(tagline_lines, sub_lines, accent_tag=None):
    """Carte 1200x630 (layout horizontal : logo à gauche, texte à droite)."""
    img = make_gradient(W, H)
    overlay = make_overlay(W, H)
    img = draw_logo(img, overlay, 240, 90, (H - 240) // 2)
    draw = ImageDraw.Draw(img)

    font_name = load_font(110, bold=True)
    font_tag = load_font(40)
    font_sub = load_font(30)
    font_accent = load_font(36, bold=True)

    text_x = 90 + 240 + 60
    draw.text((text_x, 168), "Kojo", fill=(255, 255, 255), font=font_name)

    y = 168 + 130
    for line in tagline_lines:
        draw.text((text_x, y), line, fill=(255, 235, 215), font=font_tag)
        y += 56

    if accent_tag:
        y += 6
        draw.text((text_x, y), accent_tag, fill=(255, 255, 255), font=font_accent)
        y += 52

    for line in sub_lines:
        draw.text((text_x, y), line, fill=(255, 255, 255), font=font_sub)
        y += 42

    img = img.convert("RGB")
    ImageDraw.Draw(img).rectangle([0, 0, W - 1, H - 1], outline=(200, 70, 10), width=4)
    return img


def render_square(tagline_lines, sub_lines, accent_tag=None):
    """Carte carrée 1200x1200 pour les réseaux qui recadrent en vignette 1:1.

    Composition CENTRÉE dans une zone sûre (~940 px de large) : un recadrage
    central (WhatsApp/Telegram/LinkedIn/Twitter en aperçu carré) conserve le
    logo, le nom et l'accroche — rien de critique n'est près des bords.
    """
    img = make_gradient(SQUARE, SQUARE)
    overlay = make_overlay(SQUARE, SQUARE)
    img = draw_logo(img, overlay, 250, (SQUARE - 250) // 2, 120)
    draw = ImageDraw.Draw(img)

    cx = SQUARE // 2
    safe_w = 940  # zone sûre : tout le contenu reste dans cette largeur

    font_name = load_font(120, bold=True)
    font_tag = load_font(44)
    font_sub = load_font(32)
    font_accent = load_font(38, bold=True)

    _center_text(draw, cx, 430, "Kojo", font_name, (255, 255, 255))

    y = 590
    for line in tagline_lines:
        _center_text(draw, cx, y, line, font_tag, (255, 235, 215))
        y += 62

    if accent_tag:
        y += 12
        _center_text(draw, cx, y, accent_tag, font_accent, (255, 255, 255))
        y += 56

    for line in sub_lines:
        _center_text(draw, cx, y, line, font_sub, (255, 255, 255))
        y += 44

    # Vérification (dev) : rien ne doit dépasser la zone sûre.
    for y0 in range(0, SQUARE, 40):
        draw.line([(0, y0), (SQUARE, y0)], fill=(255, 255, 255, 0))

    img = img.convert("RGB")
    ImageDraw.Draw(img).rectangle([0, 0, SQUARE - 1, SQUARE - 1], outline=(200, 70, 10), width=4)
    return img


def make_dark_favicon(size=512):
    """Favicon sombre : fond graphite + K dégradé orange→rouge.

    Destiné aux surfaces sombres (onglets en mode sombre, cartes de partage
    sur fond foncé) où l'icône claire actuelle disparaîtrait.
    """
    bg = (24, 24, 27)  # zinc-900
    img = Image.new("RGB", (size, size), bg)

    # Lueur centrale subtile pour détacher le K du fond.
    glow = Image.new("L", (size, size), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([size * 0.12, size * 0.12, size * 0.88, size * 0.88], fill=60)
    glow = glow.filter(__import__('PIL.ImageFilter', fromlist=['GaussianBlur']).GaussianBlur(radius=size * 0.12))
    dark = Image.new("RGB", (size, size), bg)
    img = Image.composite(Image.new("RGB", (size, size), (255, 255, 255)), dark, glow)
    img = Image.blend(img, Image.new("RGB", (size, size), bg), 0.35)

    # Dégradé vertical orange→rouge pour le K.
    grad = make_gradient(size, size)

    draw = ImageDraw.Draw(img)
    font_k = load_font(int(size * 0.62), bold=True)
    bbox = draw.textbbox((0, 0), "K", font=font_k)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x0 = (size - tw) / 2 - bbox[0]
    y0 = (size - th) / 2 - bbox[1]

    # Texte -> masque, puis le dégradé est poussé à travers le masque.
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.text((x0, y0), "K", fill=255, font=font_k)
    img = Image.composite(grad, img, mask)
    return img.convert("RGBA")


# Contenus identiques entre les formats wide et carré, par page.
VARIANTS = {
    # Home = défaut.
    "og-image-1200x630.png": {
        "tagline_lines": ["Services et travailleurs en Afrique de l'Ouest"],
        "sub_lines": ["Mali · Sénégal · Burkina Faso · Côte d'Ivoire"],
        "accent_tag": None,
    },
    # Page /jobs : vitrine des offres et talents.
    "og-jobs.png": {
        "tagline_lines": ["Trouvez un travailleur qualifié", "près de chez vous"],
        "sub_lines": ["Emplois · Missions · Talents dans toute l'Afrique de l'Ouest"],
        "accent_tag": "Parcourir les offres →",
    },
    # Page /login : accès compte client & travailleur.
    "og-login.png": {
        "tagline_lines": ["Accédez à votre compte"],
        "sub_lines": ["Clients & travailleurs · Suivez vos missions en un clic"],
        "accent_tag": "Se connecter ou créer un compte →",
    },
}

SQUARE_VARIANTS = {
    "og-square-1200x1200.png": "og-image-1200x630.png",
    "og-jobs-square.png": "og-jobs.png",
    "og-login-square.png": "og-login.png",
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for filename, opts in VARIANTS.items():
        img = render_wide(**opts)
        out = os.path.join(OUT_DIR, filename)
        img.save(out, "PNG", optimize=True)
        print("OK ->", out, img.size)
    for filename, wide_name in SQUARE_VARIANTS.items():
        opts = VARIANTS[wide_name]
        img = render_square(**opts)
        out = os.path.join(OUT_DIR, filename)
        img.save(out, "PNG", optimize=True)
        print("OK ->", out, img.size)
    favicon = make_dark_favicon(512)
    out = os.path.join(OUT_DIR, 'icons', 'icon-dark.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    favicon.save(out, "PNG", optimize=True)
    print("OK ->", out, favicon.size)


if __name__ == "__main__":
    main()