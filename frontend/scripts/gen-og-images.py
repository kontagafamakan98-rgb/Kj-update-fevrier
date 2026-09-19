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

Le TEXTE de chaque carte ne vit PAS ici : un fichier de données par carte
décrit, dans scripts/og-cards/, la route qu'elle sert, les CLÉS i18n du titre et
de la description de cette page, et ses deux fichiers de sortie. Ajouter une
carte est donc un AJOUT DE DONNÉES (un fichier JSON de plus, puis relancer ce
script) et jamais une édition de code — les cartes se lisent par découverte du
dossier, triées par nom de fichier.

Pourquoi des CLÉS et non du texte : la carte de /jobs et la page /jobs
annonçaient deux textes différents (l'accroche « Trouvez un travailleur qualifié
près de chez vous » ici, « Emplois disponibles — Kojo » dans le HTML servi), parce
que chacun écrivait le sien. La carte dessine maintenant le titre et la
description DE SA PAGE, résolus dans src/i18n/fr.json — la langue des coquilles
pré-rendues, donc celle que lit un crawler sans JavaScript. Les lignes réellement
dessinées sont consignées dans le manifeste, et le garde CI les recompose pour
exiger l'égalité avec le dictionnaire : un titre renommé sans régénération fait
échouer la CI au lieu de laisser un visuel qui annonce autre chose que sa page.

Le script écrit aussi un MANIFESTE (scripts/og-assets.manifest.json) :
dimensions, taille et empreinte SHA-256 de chaque PNG, empreinte de ce script,
empreinte des fichiers de données, la route de chaque carte avec les LIGNES
réellement dessinées, et polices réellement retenues. C'est ce manifeste que le
garde CI (scripts/check-og-assets.js) confronte aux fichiers versionnés : une
carte modifiée à la main, un texte changé sans régénération, ou des cartes
régénérées avec une AUTRE police (aspect différent) font échouer la CI sans qu'il
soit besoin de disposer des polices sur le runner.

Ce manifeste ne recopie AUCUNE déclaration : la route y sert de clé de jointure
avec le fichier de données, et les textes n'y figurent que sous la forme des
lignes MESURÉES au dessin. src/config/og-cards.js — le module qui sert le runtime
ET le build — lit les mêmes scripts/og-cards/*.json que ce script : la carte et
sa page sortent donc d'un seul document, par construction.

Options (pour régénérer ailleurs sans toucher à public/) :
    --out-dir <dossier>   dossier de sortie des PNG (défaut : public/)
    --manifest <fichier>  chemin du manifeste (défaut : scripts/og-assets.manifest.json)
"""
import argparse
import hashlib
import json
import os

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
SQUARE = 1200
FAVICON = 512
FAVICON_PATH = os.path.join('icons', 'icon-dark.png')
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public')
MANIFEST_NAME = 'og-assets.manifest.json'
MANIFEST_PATH = os.path.join(os.path.dirname(__file__), MANIFEST_NAME)
CARDS_DIR = os.path.join(os.path.dirname(__file__), 'og-cards')
# Le dictionnaire dont la carte tire le titre et la description de sa page :
# fr.json, la langue des coquilles pré-rendues (<html lang="fr">), donc le texte
# qu'un crawler sans JavaScript lit dans le HTML.
I18N_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'i18n', 'fr.json')
# Ce qu'une carte DOIT déclarer. `route` est la page servie, `title` et
# `description` les clés i18n de cette page : une carte sans page ou sans texte
# n'est pas une carte, donc le générateur refuse de dessiner.
REQUIRED_CARD_KEYS = ('route', 'title', 'description', 'wide', 'square')

# Polices réellement retenues, par graisse. Consignées dans le manifeste pour
# que la CI puisse refuser des cartes régénérées avec une autre police :
# l'image serait « à jour » du point de vue des fichiers, mais l'aspect des
# cartes de partage aurait changé en silence.

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


RESOLVED_FONTS = {}


def load_font(size, bold=False):
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/DejaVuSans-Bold.ttf" if bold else "C:/Windows/Fonts/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    weight = 'bold' if bold else 'regular'
    for p in candidates:
        try:
            font = ImageFont.truetype(p, size)
            RESOLVED_FONTS[weight] = os.path.basename(p)
            return font
        except Exception:
            continue
    RESOLVED_FONTS[weight] = 'PIL-default'
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


# Colonne de texte de la carte wide : le logo (90 px + 240 px) puis 60 px de
# gouttière. C'est cette largeur qui décide où le titre et la description se
# coupent — mesurée avec la police réelle, jamais devinée en caractères.
WIDE_TEXT_X = 90 + 240 + 60
WIDE_TEXT_W = W - WIDE_TEXT_X - 90
# Zone de texte de la carte carrée : sous le logo, dans la zone sûre (940 px)
# que conserve un recadrage 1:1.
SQUARE_SAFE_W = 940
SQUARE_TEXT_TOP = 440
SQUARE_TEXT_BOTTOM = SQUARE - 90

def wrap_text(draw, text, font, max_width, max_lines, label):
    """Coupe un texte en lignes qui TIENNENT dans `max_width`.

    Le mot est l'unité : aucune ligne ne coupe un mot, aucune ligne ne fait
    disparaître de texte. La carte rend donc le texte de sa page EN ENTIER — et
    comme les deux surfaces lisent la même clé, elles ne peuvent pas annoncer deux
    textes. Un texte que la carte ne peut pas porter (mot seul plus large que la
    colonne, ou trop de lignes) n'est pas tronqué : le générateur refuse de
    dessiner, parce qu'une carte tronquée annoncerait MOINS que sa page sans que
    rien ne le dise.

    @param max_lines Nombre de lignes que la mise en page réserve à ce champ.
    @returns {list[str]} Les lignes, dans l'ordre.
    """
    lines = []
    current = ''
    for word in text.split():
        candidate = ('%s %s' % (current, word)).strip()
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
        if draw.textlength(current, font=font) > max_width:
            raise SystemExit(
                '%s : le mot « %s » ne tient pas dans %d px, même seul sur sa ligne — '
                'raccourcir le texte de la page plutôt que de tronquer la carte'
                % (label, current, max_width)
            )
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        raise SystemExit(
            '%s : %d lignes nécessaires pour %d disponibles — le texte de la page ne '
            'tient pas sur la carte ; raccourcir le texte (ou élargir la mise en page '
            'EN CONNAISSANCE DE CAUSE : la carte doit dire le texte de sa page en entier)'
            % (label, len(lines), max_lines)
        )
    return lines


def render_wide(title_lines, description_lines, accent_tag=None):
    """Carte 1200x630 (layout horizontal : logo à gauche, texte à droite).

    Le bloc est CENTRÉ verticalement à partir de la hauteur réelle de ses lignes :
    une carte dont le titre tient en deux lignes et une dont il en tient trois ont
    donc le même air, sans constantes de position à ajuster à chaque texte.
    """
    img = make_gradient(W, H)
    overlay = make_overlay(W, H)
    img = draw_logo(img, overlay, 240, 90, (H - 240) // 2)
    draw = ImageDraw.Draw(img)

    fonts = fonts_for('wide')
    font_title, font_desc = fonts['title'], fonts['description']
    font_accent = load_font(32, bold=True)

    step_title, step_desc, step_accent, gap = 58, 36, 48, 22
    height = len(title_lines) * step_title
    if accent_tag:
        height += gap + step_accent
    height += gap + len(description_lines) * step_desc
    if height > H - 80:
        raise SystemExit(
            'carte wide : bloc de %d px dans %d disponibles — réduire le nombre de '
            'lignes plutôt que de laisser le texte déborder' % (height, H - 80)
        )

    y = (H - height) // 2
    for line in title_lines:
        draw.text((WIDE_TEXT_X, y), line, fill=(255, 255, 255), font=font_title)
        y += step_title

    if accent_tag:
        y += gap
        draw.text((WIDE_TEXT_X, y), accent_tag, fill=(255, 255, 255), font=font_accent)
        y += step_accent

    y += gap
    for line in description_lines:
        draw.text((WIDE_TEXT_X, y), line, fill=(255, 235, 215), font=font_desc)
        y += step_desc

    img = img.convert("RGB")
    ImageDraw.Draw(img).rectangle([0, 0, W - 1, H - 1], outline=(200, 70, 10), width=4)
    return img


def render_square(title_lines, description_lines, accent_tag=None):
    """Carte carrée 1200x1200 pour les réseaux qui recadrent en vignette 1:1.

    Composition CENTRÉE dans une zone sûre (940 px de large, sous le logo) : un
    recadrage central (WhatsApp/Telegram/LinkedIn/Twitter en aperçu carré)
    conserve le logo, le titre de la page et sa description — rien de critique
    n'est près des bords.
    """
    img = make_gradient(SQUARE, SQUARE)
    overlay = make_overlay(SQUARE, SQUARE)
    img = draw_logo(img, overlay, 250, (SQUARE - 250) // 2, 120)
    draw = ImageDraw.Draw(img)

    cx = SQUARE // 2

    fonts = fonts_for('square')
    font_title, font_desc = fonts['title'], fonts['description']
    font_accent = load_font(34, bold=True)

    step_title, step_desc, step_accent, gap = 62, 42, 50, 26
    height = len(title_lines) * step_title
    if accent_tag:
        height += gap + step_accent
    height += gap + len(description_lines) * step_desc
    available = SQUARE_TEXT_BOTTOM - SQUARE_TEXT_TOP
    if height > available:
        raise SystemExit(
            'carte carrée : bloc de %d px dans %d disponibles — réduire le nombre de '
            'lignes plutôt que de laisser le texte déborder' % (height, available)
        )

    y = SQUARE_TEXT_TOP + (available - height) // 2
    for line in title_lines:
        _center_text(draw, cx, y, line, font_title, (255, 255, 255))
        y += step_title

    if accent_tag:
        y += gap
        _center_text(draw, cx, y, accent_tag, font_accent, (255, 255, 255))
        y += step_accent

    y += gap
    for line in description_lines:
        _center_text(draw, cx, y, line, font_desc, (255, 235, 215))
        y += step_desc

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


def load_cards():
    """Les cartes à dessiner, lues une par une dans scripts/og-cards/*.json.

    Découverte du dossier, triée par nom de fichier : ajouter une carte, c'est
    déposer un fichier ici. Une carte déclare la ROUTE qu'elle sert, les CLÉS i18n
    du titre et de la description de cette page, et ses deux sorties (`wide`,
    `square`). C'est la route qui est la clé de la table — plus le nom du fichier :
    la carte générique (`og-image-1200x630.png`) suit le nom d'aucune page, et
    c'est la convention de nom qui l'obligeait à vivre hors de la table.

    Deux cartes pour une même route, ou un champ manquant, sont refusés ICI : sans
    cela, la seconde carte serait perdue sans bruit (une clé de dictionnaire),
    exactement l'oubli que la déduction doit rendre impossible.
    """
    cards = []
    by_route = {}
    for name in sorted(os.listdir(CARDS_DIR)):
        if not name.endswith('.json'):
            continue
        with open(os.path.join(CARDS_DIR, name), encoding='utf-8') as handle:
            card = json.load(handle)
        card['source'] = 'og-cards/%s' % name
        missing = [
            key
            for key in REQUIRED_CARD_KEYS
            if not isinstance(card.get(key), str) or not card[key].strip()
        ]
        if missing:
            raise SystemExit(
                '%s : champ(s) manquant(s) %s — une carte nomme la route qu\'elle sert, '
                'les clés i18n du titre et de la description de cette page, et ses deux '
                'sorties' % (card['source'], ', '.join(missing))
            )
        if not card['route'].startswith('/'):
            raise SystemExit(
                '%s : la route « %s » doit être un chemin absolu (« /jobs »)'
                % (card['source'], card['route'])
            )
        if card['route'] in by_route:
            raise SystemExit(
                '%s et %s servent tous les deux la route « %s » : la seconde serait '
                'ignorée en silence' % (by_route[card['route']], card['source'], card['route'])
            )
        by_route[card['route']] = card['source']
        cards.append(card)
    if not cards:
        raise SystemExit('aucune carte dans %s : rien à dessiner' % CARDS_DIR)
    return cards


def page_texts(card, dictionary):
    """Le titre et la description de la page de cette carte, résolus dans fr.json.

    Le texte n'est pas recopié dans le fichier de carte : la carte DESSINE ce que
    la page PUBLIE, donc elle lit les mêmes clés que le build (src/config/
    page-meta.js) et le runtime (src/utils/seo.js).

    @returns {{title: str, description: str}}
    """
    texts = {}
    for field in ('title', 'description'):
        key = card[field]
        value = dictionary.get(key)
        if not isinstance(value, str) or not value.strip():
            raise SystemExit(
                '%s : la clé « %s » (%s) est absente ou vide dans src/i18n/fr.json — '
                'la carte dessinerait autre chose que sa page' % (card['source'], key, field)
            )
        texts[field] = value
    return texts


# Polices et pas de ligne de chaque mise en page, par champ. Une seule table :
# la mesure qui décide du retour à la ligne et le dessin lisent les MÊMES
# valeurs — deux jeux de constantes finiraient par diverger, et la carte
# dessinerait des lignes qui ne sont pas celles qu'elle a mesurées.
LAYOUTS = {
    'wide': {
        'title': {'size': 46, 'bold': True, 'max_lines': 3},
        'description': {'size': 26, 'bold': False, 'max_lines': 4},
    },
    'square': {
        'title': {'size': 50, 'bold': True, 'max_lines': 3},
        'description': {'size': 30, 'bold': False, 'max_lines': 4},
    },
}


def measure_width(kind):
    """Largeur de la colonne de texte d'un format (zone sûre de la carte)."""
    return WIDE_TEXT_W if kind == 'wide' else SQUARE_SAFE_W


def fonts_for(kind):
    """Les polices du titre et de la description, prises dans LAYOUTS.

    Le DESSIN et la MESURE lisent donc la même déclaration : deux jeux de
    constantes finiraient par diverger, et la carte dessinerait des lignes
    mesurées avec une autre police que celle qui les écrit.
    """
    return {
        field: load_font(spec['size'], bold=spec['bold']) for field, spec in LAYOUTS[kind].items()
    }


def card_lines(card, texts):
    """Les lignes DESSINÉES pour chaque format : titre puis description.

    Calculées une seule fois, puis utilisées à la fois pour dessiner et pour le
    manifeste : la ligne que le garde CI recompose est littéralement celle qui est
    dans le PNG, jamais un second calcul qui pourrait en diverger.
    """
    scratch = ImageDraw.Draw(Image.new('RGB', (8, 8)))
    lines = {}
    for kind, fields in LAYOUTS.items():
        width = measure_width(kind)
        lines[kind] = {}
        for field in ('title', 'description'):
            spec = fields[field]
            font = load_font(spec['size'], bold=spec['bold'])
            lines[kind][field] = wrap_text(
                scratch,
                texts[field],
                font,
                width,
                spec['max_lines'],
                '%s (%s, %s)' % (card['source'], kind, field),
            )
    return lines


def manifest_entry(out_dir, rel_path, width, height, kind):
    """Une carte du manifeste : dimensions, taille et empreinte du PNG écrit."""
    with open(os.path.join(out_dir, rel_path), 'rb') as handle:
        data = handle.read()
    return {
        'file': rel_path.replace(os.sep, '/'),
        'width': width,
        'height': height,
        'format': kind,
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
    }


def cards_sha256():
    """Empreinte du CONTENU des cartes, sur leurs octets NORMALISÉS en LF.

    L'empreinte du générateur ne suffit plus à détecter une carte modifiée : le
    contenu vit dans les fichiers de données. Sans cette seconde empreinte,
    changer la route ou les clés d'une carte sans relancer le script laisserait
    le manifeste « frais » — les PNG seraient périmés et la CI dirait vert. (Le
    TEXTE des pages, lui, est couvert par l'égalité que le garde exige entre les
    lignes consignées ici et src/i18n/fr.json.)

    Le nom du fichier entre dans l'empreinte : renommer une carte change ce que
    la carte DIT au garde (`og-jobs.png` désigne la page /jobs), donc ce n'est pas
    la même recette. Les fichiers sont parcourus triés par nom pour que deux
    machines produisent la même empreinte.
    """
    digest = hashlib.sha256()
    for name in sorted(os.listdir(CARDS_DIR)):
        if not name.endswith('.json'):
            continue
        with open(os.path.join(CARDS_DIR, name), 'rb') as handle:
            data = handle.read().replace(b'\r\n', b'\n')
        digest.update(name.encode('utf-8') + b'\n' + data)
    return digest.hexdigest()


def generator_sha256(path):
    """Empreinte du générateur : son contenu NORMALISÉ en LF, jamais ses octets bruts.

    Le fin de ligne d'une copie de travail n'est pas une propriété du code : un
    poste Windows matérialise les fichiers texte en CRLF, la CI Linux en LF, donc
    hacher les octets bruts faisait dépendre le manifeste de la plateforme qui
    l'a produit — la CI, qui lit le blob LF, croyait alors le manifeste périmé.
    Ce script vit sous frontend/scripts/** (déjà figé en LF par .gitattributes),
    mais la règle est ici pour que l'identité du générateur soit la même partout,
    quel que soit le réglage `core.autocrlf` du poste qui régénère.
    """
    data = open(path, 'rb').read().replace(b'\r\n', b'\n')
    return hashlib.sha256(data).hexdigest()


def write_manifest(out_dir, manifest_path, cards):
    """Écrit le manifeste de reproductibilité que la CI confronte aux fichiers.

    Aucune donnée volatile (date, version de Pillow) n'y figure : deux
    exécutions dans le même environnement produisent le même fichier, donc le
    manifeste ne bouge que si les cartes, leur contenu ou les polices changent.
    L'ordre du tableau suit celui des cartes lues : il rend le diff lisible quand
    une carte s'ajoute, et aucun consommateur n'en dépend (le garde et
    src/config/og-cards.js indexent par route).

    `cards` porte ce que ce script a MESURÉ : la route de chaque carte (clé de
    jointure avec son fichier de données) et les LIGNES réellement dessinées, par
    format. Les textes ne sont PAS recopiés ici : le fichier de données fait
    autorité pour le runtime comme pour le dessin, et le garde CI recompose les
    lignes consignées pour exiger l'égalité avec le dictionnaire — c'est ce qui
    attrape un PNG périmé derrière un manifeste frais.
    """
    assets = [
        entry
        for card in cards
        for entry in (
            manifest_entry(out_dir, card['wide'], W, H, 'wide'),
            manifest_entry(out_dir, card['square'], SQUARE, SQUARE, 'carré'),
        )
    ]
    assets.append(manifest_entry(out_dir, FAVICON_PATH, FAVICON, FAVICON, 'favicon sombre'))
    manifest = {
        'generator': os.path.basename(__file__),
        'generator_sha256': generator_sha256(__file__),
        'cards_sha256': cards_sha256(),
        'fonts': {weight: RESOLVED_FONTS.get(weight) for weight in ('regular', 'bold')},
        'cards': [
            {
                'route': card['route'],
                'lines': card['lines'],
            }
            for card in cards
        ],
        'assets': assets,
    }
    with open(manifest_path, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True, ensure_ascii=False)
        handle.write('\n')
    return manifest


def main(out_dir=None, manifest_path=None):
    out_dir = out_dir or OUT_DIR
    manifest_path = manifest_path or MANIFEST_PATH
    os.makedirs(out_dir, exist_ok=True)
    cards = load_cards()
    with open(I18N_PATH, encoding='utf-8') as handle:
        dictionary = json.load(handle)
    for card in cards:
        texts = page_texts(card, dictionary)
        card['texts'] = texts
        card['lines'] = card_lines(card, texts)
        print(
            "%s -> %s « %s »" % (card['source'], card['route'], texts['title'])
        )
        img = render_wide(card['lines']['wide']['title'], card['lines']['wide']['description'], card.get('accent'))
        out = os.path.join(out_dir, card['wide'])
        img.save(out, "PNG", optimize=True)
        print("OK ->", out, img.size)
        img = render_square(card['lines']['square']['title'], card['lines']['square']['description'], card.get('accent'))
        out = os.path.join(out_dir, card['square'])
        img.save(out, "PNG", optimize=True)
        print("OK ->", out, img.size)
    favicon = make_dark_favicon(FAVICON)
    out = os.path.join(out_dir, FAVICON_PATH)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    favicon.save(out, "PNG", optimize=True)
    print("OK ->", out, favicon.size)

    manifest = write_manifest(out_dir, manifest_path, cards)
    print("MANIFESTE ->", manifest_path, "(%d cartes)" % len(manifest['assets']))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Génère les cartes Open Graph de Kojo et leur manifeste de reproductibilité."
    )
    parser.add_argument(
        "--out-dir", default=None,
        help="dossier de sortie des PNG (défaut : public/)",
    )
    parser.add_argument(
        "--manifest", default=None,
        help="chemin du manifeste (défaut : scripts/og-assets.manifest.json)",
    )
    arguments = parser.parse_args()
    main(out_dir=arguments.out_dir, manifest_path=arguments.manifest)