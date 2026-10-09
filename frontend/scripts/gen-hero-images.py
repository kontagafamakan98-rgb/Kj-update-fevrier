#!/usr/bin/env python3
"""GÉNÈRE LES VARIANTES AVIF ET WEBP DES PHOTOS DU HÉROS.

Pourquoi ce script existe. Le héros de « / » sert six JPEG en 720 × 960
(574 211 octets à six, mesuré). Ces JPEG sont le REPLI : tout navigateur qui
comprend l'AVIF ou le WebP télécharge une variante deux à trois fois plus
légère, et c'est le même pixel à l'écran (PSNR ≥ 35,7 dB contre la source, voir
le tableau ci-dessous). Deux formats et non un seul : l'AVIF est le plus léger
des deux MAIS son décodeur est plus récent que celui du WebP, donc le WebP sert
les navigateurs qui ne connaissent pas l'AVIF, et le JPEG ceux qui ne
connaissent ni l'un ni l'autre (`<picture>` + `<img src=…>`, cf.
src/config/photos-heros.js).

Ce que le script écrit, et où :

  public/assets/<base>-480.avif   public/assets/<base>-480.webp
  public/assets/<base>.avif       public/assets/<base>.webp
  scripts/hero-variants.manifest.json

`<base>` est le nom du JPEG sans son extension (`kojo-hero`, `kojo-hero-2`…).
La largeur 480 est déclarée AVANT la 720 dans les `srcset` (le navigateur
choisit, pas nous) : c'est la largeur de la boîte du héros en desktop, et la
720 couvre les écrans à densité 2 et plus.

Le manifeste est un DOMICILE DE MESURE, pas une décoration : il enregistre, pour
chaque fichier, sa FORME RÉELLE (octets, largeur, hauteur, format, réglage), la
taille et l'empreinte SHA-256 de sa SOURCE, et l'encodeur employé. C'est ce qui
permet à `scripts/check-hero-images.js` de refuser une variante périmée (source
recodée sans régénération), une variante tronquée, ou un réglage qui ne serait
plus celui qui a été mesuré — sans quoi les chiffres du commentaire de
src/config/photos-heros.js mentiraient en silence.

DEUX PROPRIÉTÉS À NE PAS PERDRE :

  • LES VARIANTES NE SONT PAS RETÉLÉCHARGÉES AU BUILD. Ce sont des fichiers
    publiés, comme les JPEG qu'elles doublent (public/assets/ est copié tel quel
    par Vite) : le build ne fait que les recopier.
  • LE RÉGLAGE EST MESURÉ, PAS CHOISI. AVIF qualité 55 et WebP qualité 75 sont
    les deux points retenus par la campagne de compression (PSNR minimum sur les
    six photos) : AVIF q55 = 213 059 octets à six pour 36,69 dB, WebP q75 =
    264 938 pour 35,76 dB, contre 574 211 octets de JPEG. Rejouer la campagne :

      python -c "…"   # voir l'historique de la passe ; le script REFUSE un
                      # réglage hors de REGLAGES, il ne le devine pas.

Usage :
  python scripts/gen-hero-images.py            # écrit les 24 variantes
  python scripts/gen-hero-images.py --verifier # vérifie sans écrire
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

from PIL import Image

# La console Windows par défaut (cp1252) refuse les marques des messages de
# verdict : le script les écrit en UTF-8, comme les autres gardes Python du
# dépôt, sinon un écart ferait planter le script AU MOMENT DE LE DIRE.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Ce qui est publié, et comment ──────────────────────────────────────────
RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOSSIER_PUBLIC = os.path.join(RACINE, "public", "assets")
MANIFESTE = os.path.join(RACINE, "scripts", "hero-variants.manifest.json")

# Les six photos, dans l'ORDRE de la rotation : c'est celui de
# src/config/photos-heros.js (`PHOTOS_HEROS`), et le script REFUSE une liste qui
# ne correspondrait plus (une photo ajoutée côté page sans variante se
# téléchargerait en JPEG, en silence, sur tous les navigateurs).
PHOTOS = [
    "kojo-hero.jpg",
    "kojo-hero-2.jpg",
    "kojo-hero-3.jpg",
    "kojo-hero-4.jpg",
    "kojo-hero-5.jpg",
    "kojo-hero-6.jpg",
]

# Les dimensions des JPEG publiés : c'est aussi ce que `width`/`height`
# publient, donc ce que le navigateur réserve.
LARGEUR_SOURCE = 720
HAUTEUR_SOURCE = 960

# Les deux largeurs servies. 480 = la boîte du héros en desktop (mesurée
# 480 × 640 px sur « / » à 1350 × 940) ; 720 = la source entière, pour les
# écrans à densité 2 et plus (mesuré 380 × 506,66 px à 412 × 823, donc 1,9 ×).
LARGEURS = [480, 720]

# Les réglages RETENUS, avec leur mesure PAR LARGEUR : les totaux sont
# re-vérifiés à chaque exécution (le script compare ce qu'il vient d'encoder à
# ces chiffres) et publiés dans src/config/photos-heros.js. Un réglage qui
# dérive — libwebp/libavif qui change, qualité retouchée — rougit ici au lieu de
# laisser les commentaires mentir.
REGLAGES = {
    "avif": {
        "format": "AVIF",
        "qualite": 55,
        "psnr_min": 36.69,
        "octets": {480: 120313, 720: 213059},
    },
    "webp": {
        "format": "WEBP",
        "qualite": 75,
        "psnr_min": 35.76,
        "octets": {480: 147994, 720: 264938},
    },
}

# Les six JPEG publiés, tous deux largeurs comprises (mesuré : 574 211 octets).
JPEG_TOTAL = 574211


def empreinte(chemin: str) -> str:
    with open(chemin, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def nom_variante(base: str, largeur: int, extension: str) -> str:
    """`kojo-hero-3` + 480 + `avif` → `kojo-hero-3-480.avif`.

    La source entière (720) n'a PAS de suffixe de largeur : c'est le fichier que
    `<img src>` sert de repli, et deux noms pour un même rôle divergeraient.
    """
    suffixe = "" if largeur == LARGEUR_SOURCE else "-%d" % largeur
    return "%s%s.%s" % (base, suffixe, extension)


def encoder(image: Image.Image, cle: str) -> bytes:
    import io

    reglage = REGLAGES[cle]
    tampon = io.BytesIO()
    if cle == "avif":
        image.save(tampon, "AVIF", quality=reglage["qualite"])
    elif cle == "webp":
        image.save(tampon, "WEBP", quality=reglage["qualite"], method=6)
    else:  # pragma: no cover - le jeu de clés est fermé
        raise SystemExit("réglage inconnu : %s" % cle)
    return tampon.getvalue()


def main() -> int:
    parseur = argparse.ArgumentParser(description=__doc__)
    parseur.add_argument(
        "--verifier",
        action="store_true",
        help="vérifie que les fichiers sur disque sont ceux que ce script produirait, sans rien écrire",
    )
    options = parseur.parse_args()

    if not os.path.isdir(DOSSIER_PUBLIC):
        raise SystemExit("dossier introuvable : %s" % DOSSIER_PUBLIC)

    from PIL import __version__ as version_pillow

    manifeste = {
        "genere_par": "frontend/scripts/gen-hero-images.py",
        # L'encodeur est enregistré : une montée de version de Pillow (donc de
        # libwebp / libavif) change les octets produits, donc le manifeste.
        "encodeur": {"pillow": version_pillow},
        "largeur_source": LARGEUR_SOURCE,
        "hauteur_source": HAUTEUR_SOURCE,
        "largeurs": LARGEURS,
        "reglages": REGLAGES,
        "jpeg_total": JPEG_TOTAL,
        "photos": [],
    }

    total_par_cle = {cle: {largeur: 0 for largeur in LARGEURS} for cle in REGLAGES}
    ecarts = []
    for nom in PHOTOS:
        chemin_source = os.path.join(DOSSIER_PUBLIC, nom)
        if not os.path.isfile(chemin_source):
            raise SystemExit("photo source introuvable : %s" % chemin_source)
        base = os.path.splitext(nom)[0]
        with Image.open(chemin_source) as ouverte:
            if ouverte.size != (LARGEUR_SOURCE, HAUTEUR_SOURCE):
                raise SystemExit(
                    "photo source %s : %s × %s au lieu de %d × %d — les variantes "
                    "ne peuvent pas être générées sur une autre boîte (le rapport "
                    "commun est ce qui empêche l'alternance de déplacer la page)"
                    % (nom, ouverte.size[0], ouverte.size[1], LARGEUR_SOURCE, HAUTEUR_SOURCE)
                )
            source = ouverte.convert("RGB")

        entree = {
            "source": nom,
            "octets_source": os.path.getsize(chemin_source),
            "sha256_source": empreinte(chemin_source),
            "variantes": [],
        }
        for largeur in LARGEURS:
            grand = largeur == LARGEUR_SOURCE
            image = source if grand else source.resize(
                (largeur, round(largeur * HAUTEUR_SOURCE / LARGEUR_SOURCE)), Image.LANCZOS
            )
            for cle in REGLAGES:
                data = encoder(image, cle)
                extension = cle
                fichier = nom_variante(base, largeur, extension)
                chemin = os.path.join(DOSSIER_PUBLIC, fichier)
                existant = os.path.isfile(chemin)
                if options.verifier:
                    if not existant:
                        ecarts.append("%s : ABSENT" % fichier)
                    elif os.path.getsize(chemin) != len(data):
                        ecarts.append(
                            "%s : %d octets sur disque, %d attendus"
                            % (fichier, os.path.getsize(chemin), len(data))
                        )
                else:
                    with open(chemin, "wb") as f:
                        f.write(data)
                entree["variantes"].append(
                    {
                        "fichier": fichier,
                        "format": cle,
                        "largeur": image.size[0],
                        "hauteur": image.size[1],
                        "qualite": REGLAGES[cle]["qualite"],
                        "octets": len(data),
                    }
                )
                total_par_cle[cle][largeur] += len(data)
        manifeste["photos"].append(entree)

    # ── Chaque total est CONFRONTÉ à la mesure de la campagne ──────────────
    # Un réglage qui dérive (ou une libwebp qui change) ne doit pas passer
    # inaperçu : le manifeste et le commentaire de src/config/photos-heros.js
    # publient ces totaux.
    for cle, reglage in REGLAGES.items():
        for largeur in LARGEURS:
            mesure = reglage["octets"][largeur]
            obtenu = total_par_cle[cle][largeur]
            if mesure is not None and obtenu != mesure:
                ecarts.append(
                    "total %s %dw : %d octets générés, %s lors de la campagne — "
                    "SOIT l'encodeur a changé, SOIT le réglage n'est plus celui qui a "
                    "été mesuré ; re-mesurer (PSNR) puis mettre à jour REGLAGES et "
                    "src/config/photos-heros.js"
                    % (cle, largeur, obtenu, mesure)
                )

    manifeste["totaux"] = total_par_cle
    # Le gain publié est celui que le VISITEUR obtient : les deux largeurs
    # comparées à la même largeur de JPEG (seule la 720 existe en JPEG — la 480
    # est un sur-échantillonnage vers le bas, donc son gain se lit contre la 720).
    manifeste["jpeg_vs_variantes"] = {
        cle: {
            "largeur": 720,
            "octets": total_par_cle[cle][720],
            "gain_absolu": JPEG_TOTAL - total_par_cle[cle][720],
            "gain_pct": round(100.0 * (JPEG_TOTAL - total_par_cle[cle][720]) / JPEG_TOTAL, 1),
        }
        for cle in REGLAGES
    }

    if ecarts:
        print("❌ %d écart(s) :" % len(ecarts))
        for ecart in ecarts:
            print("   · %s" % ecart)
        return 1

    if options.verifier:
        print(
            "✅ variantes conformes au manifeste et au réglage mesuré (720w : AVIF %d o, WebP %d o, "
            "JPEG %d o)"
            % (total_par_cle["avif"][720], total_par_cle["webp"][720], JPEG_TOTAL)
        )
        return 0

    manifeste["genere_le"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(MANIFESTE, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifeste, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(
        "✅ %d variantes écrites — à 720w : AVIF %d o (−%.1f %%), WebP %d o (−%.1f %%) contre %d o de "
        "JPEG ; à 480w : AVIF %d o, WebP %d o ; manifeste : %s"
        % (
            2 * len(LARGEURS) * len(PHOTOS),
            total_par_cle["avif"][720],
            manifeste["jpeg_vs_variantes"]["avif"]["gain_pct"],
            total_par_cle["webp"][720],
            manifeste["jpeg_vs_variantes"]["webp"]["gain_pct"],
            JPEG_TOTAL,
            total_par_cle["avif"][480],
            total_par_cle["webp"][480],
            os.path.relpath(MANIFESTE, RACINE),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
