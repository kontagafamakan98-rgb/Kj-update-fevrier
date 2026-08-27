#!/usr/bin/env python3
"""Génère l'image Open Graph 1200x630 de Kojo (frontend/public/og-image-1200x630.png).

Usage :
    python gen_og_image.py [chemin_de_sortie]

Le chemin de sortie par défaut est relatif à ce script
(../public/og-image-1200x630.png) — portable sur toute copie du dépôt.
Un argument optionnel permet de générer vers un autre chemin (test).

Dépendance : Pillow (backend/.venv/Scripts/python en local).
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630

# --- Dégradé vertical orange-600 -> red-600 (même esprit que la hero) ---
top = (234, 88, 12)      # orange-600
mid = (194, 65, 12)      # orange-700
bottom = (220, 38, 38)   # red-600

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

# --- Halos décoratifs subtils (comme les cercles de la landing) ---
overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
od = ImageDraw.Draw(overlay)
od.ellipse([-180, -180, 340, 340], fill=(255, 255, 255, 12))
od.ellipse([880, 380, 1460, 900], fill=(255, 255, 255, 12))
img = Image.alpha_composite(img.convert("RGBA"), overlay)
draw = ImageDraw.Draw(img)

# --- Polices (fiable sur Windows ; fallback générique sinon) ---
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

font_k = load_font(300, bold=True)
font_name = load_font(110, bold=True)
font_tag = load_font(38)  # 747px mesurés < 770px dispo (ne pas déborder)

# --- Logo "K" (carré arrondi orange clair, comme l'icône) ---
logo_size = 240
logo_x, logo_y = 90, (H - logo_size) // 2
# carré arrondi semi-transparent
od = ImageDraw.Draw(overlay)
od.rounded_rectangle([logo_x, logo_y, logo_x + logo_size, logo_y + logo_size],
                     radius=48, fill=(255, 255, 255, 40))
img = Image.alpha_composite(img, overlay)
draw = ImageDraw.Draw(img)
# Le K blanc dans le carré
bbox = draw.textbbox((0, 0), "K", font=font_k)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
draw.text((logo_x + (logo_size - tw) / 2 - bbox[0],
           logo_y + (logo_size - th) / 2 - bbox[1]),
          "K", fill=(255, 255, 255), font=font_k)

# --- Texte : nom + tagline, à droite du logo ---
text_x = logo_x + logo_size + 60
text_top = 175
draw.text((text_x, text_top), "Kojo", fill=(255, 255, 255), font=font_name)
draw.text((text_x, text_top + 130),
          "Services et travailleurs en Afrique de l'Ouest",
          fill=(255, 235, 215), font=font_tag)
draw.text((text_x, text_top + 130 + 56),
          "Mali · Sénégal · Burkina Faso · Côte d'Ivoire",
          fill=(255, 255, 255, 220), font=load_font(30))

# --- Bordure fine pour le contraste sur fonds sombres/clair ---
img = img.convert("RGB")
ImageDraw.Draw(img).rectangle([0, 0, W - 1, H - 1], outline=(200, 70, 10), width=4)

default_out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "og-image-1200x630.png")
out = sys.argv[1] if len(sys.argv) > 1 else default_out
img.save(out, "PNG", optimize=True)
print("OK ->", out, img.size)
