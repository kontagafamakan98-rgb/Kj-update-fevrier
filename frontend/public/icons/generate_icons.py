#!/usr/bin/env python3
"""Génère les icônes PWA Kojo en pur Python (stdlib uniquement, sans PIL).

Usage :
    python generate_icons.py [--out-dir DIR] [--favicon FILE] [--manifest FILE]
                             [--skip-size-pngs] [--skip-maskable]
    python generate_icons.py --digest FICHIER...

LA SOURCE EST DESSINÉE, et elle n'est plus un raster fourni : le poinçon — la
marque du site — est peint ici à partir de src/config/marque-kojo.json, le
MÊME fichier que la page et la coquille lisent (src/config/marque-kojo.js).
L'onglet du navigateur porte donc la marque du site, et pas un second dessin
qui lui ressemblerait. Produit les tailles PWA déclarées par SIZES, les
variantes maskable, le favicon CLAIR (favicon.ico, images PNG embarquées aux
tailles de FAVICON_ICO_SIZES) puis le MANIFESTE de la famille (MANIFEST_NAME),
qui la verrouille en CI via scripts/check-generated-icons.js.

Ce que la CI vérifie, et qui rend ce fichier un GÉNÉRATEUR et non un outil :
elle REJOUE ce script dans un dossier temporaire et compare les empreintes de
pixels des sorties à celles du manifeste. Éditer marque-kojo.json sans
régénérer fait donc rougir la CI (les pixels produits changent), tout comme
éditer ce script sans régénérer (l'empreinte du générateur change).

Remplace l'ancienne version PIL (non installée) : les anciennes icônes
72/96/128/152/384 étaient des fichiers vides de 100 octets (zéros), ce qui
cassait le badge des notifications push et les apple-touch-icons — et celle
d'avant réduisait un raster de l'ancien profil au plus proche voisin.

── Pourquoi le manifeste consigne des empreintes de PIXELS, pas d'octets ────

La compression zlib n'est pas identique d'une machine à l'autre (version et
niveau de la bibliothèque liée). Mesuré sur ce dépôt, MÊME code des deux côtés :

    icon-512x512.png committé : 101 592 octets de flux IDAT
    régénéré ici              : 101 049 octets de flux IDAT
    pixels décompressés       : IDENTIQUES (et filtre 0 partout)

Exiger l'égalité des OCTETS condamnerait donc le garde CI à rougir sur toute
machine dont la zlib diffère, pour un écart sans aucun effet visible. L'invariant
réel est l'empreinte des PIXELS — flux IDAT décompressé puis dé-filtré — que
`--digest` calcule pour n'importe quel PNG ou ICO du dépôt.

── Ce que le manifeste couvre ──────────────────────────────────────────────

  • outputs     : les 8 tailles PWA, empreinte de PIXELS ;
  • favicon     : le favicon clair, empreinte de PIXELS de chaque image ;
  • unmanaged   : actifs de la famille SANS générateur (maskable, SVG source),
                  empreinte d'OCTETS telle que committée — dérive détectable ;
  • foreign     : actifs de la famille produits par un AUTRE générateur
                  (icon-dark.png ← gen-og-images.py), verrouillés par SON
                  manifeste : déclarés ici pour n'être ni orphelins ni
                  revendiqués deux fois ;
  • maskable    : les variantes destinées aux masques des plateformes, dont le
                  contenu est FABRIQUÉ ici pour tenir dans le cercle de
                  sécurité (voir MASKABLE_SIZES). Mesuré avant ce correctif :
                  aucune des icônes présentes ne tenait dans ce cercle, et le
                  « maskable » 512 était un duplicata AU PIXEL PRÈS de l'icône
                  normale — déclarer « maskable » l'une ou l'autre revenait
                  donc à annoncer une propriété qu'aucune ne possédait.

Tous les chemins du manifeste sont relatifs au dossier du manifeste.
"""
import argparse
import hashlib
import json
import math
import os
import re
import struct
import sys
import zlib
from pathlib import Path

# La console Windows est en cp1252 et ne sait pas encoder ce qui sort de son
# répertoire : la moindre flèche « → » y fait planter un script qui ne fait que
# raconter ce qu'il écrit. Constaté deux fois sur ce dépôt — une fois sur « ⚠️ »,
# une fois sur « → » — d'où ce garde-fou global plutôt qu'un nettoyage au cas par
# cas : on force UTF-8 quand c'est possible, et on remplace sinon.
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        pass

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

# Tailles embarquées dans le favicon clair. 16/32/48 sont les trois tailles
# historiquement demandées aux navigateurs pour un .ico ; elles sont embarquées
# en PNG (supporté par tous les navigateurs cibles), ce qui évite d'écrire un
# encodeur BMP + masque AND et sa couche de transparence.
FAVICON_ICO_SIZES = [16, 32, 48]

FAVICON_ICO_NAME = "favicon.ico"

MANIFEST_NAME = "icons-assets.manifest.json"

# ── Variantes MASKABLE ───────────────────────────────────────────────────────
#
# Une icône « maskable » n'est PAS une icône comme les autres : les plateformes
# (Android, Chrome) appliquent un masque — cercle, goutte, écusson — et ne
# garantissent que la ZONE DE SÉCURITÉ : un cercle de rayon SAFE_ZONE_RADIUS fois
# la largeur, centré. Tout ce qui déborde peut être rogné, et une icône
# transparente laisse voir le fond du système.
#
# Mesuré avant ce correctif sur les fichiers présents :
#   • icon-512x512-maskable.png était un duplicata AU PIXEL PRÈS de
#     icon-512x512.png (même empreinte de pixels) : il n'apportait rien ;
#   • les quatre fichiers atteignaient un rayon de contenu de 0,495, très
#     au-dessus de la limite de 0,400 — donc aucun n'était maskable.
#
# Le générateur les FABRIQUE donc : contenu réduit pour tenir dans le cercle
# (rayon visé MASKABLE_CONTENT_RADIUS, avec une marge sous la limite) et centré
# sur un fond OPAQUE, la couleur du fond du manifeste PWA.
MASKABLE_SIZES = [192, 512]
SAFE_ZONE_RADIUS = 0.4
MASKABLE_CONTENT_RADIUS = 0.38
# Doit rester égal au « background_color » de public/manifest.json : le garde CI
# croise les deux et échoue si l'un des deux bouge sans l'autre.
MASKABLE_BACKGROUND = (15, 23, 42)  # #0f172a

# Actifs de la MÊME famille qui n'ont AUCUN générateur (fournis à la main ou
# produits par un outil externe) : on les déclare ici pour qu'ils entrent dans
# l'inventaire de la famille, et le manifeste consigne leur empreinte d'OCTETS
# telle qu'elle est committée. Toute modification silencieuse devient donc
# détectable, sans prétendre pour autant qu'ils sont reproductibles.
#
# VIDE depuis le 07/10/2026 : `kojo-icon.svg` y était seul — un carré orange à
# « K » Arial, c'est-à-dire l'ANCIENNE marque, que plus rien ne référençait
# (ni index.html, ni le manifeste PWA, ni le service worker). La marque vit
# maintenant dans marque-kojo.json, et ses icônes sont dessinées ici : garder ce
# fichier aurait laissé, dans le dossier des icônes, une copie de la marque que
# le site n'affiche plus. Un actif « sans générateur » qui n'existe plus n'a rien
# à déclarer ; le mécanisme, lui, reste (une entrée ici est encore possible).
UNMANAGED_ASSETS = {}

# Actifs de la famille produits par un AUTRE générateur : déclarés ici pour
# qu'ils ne soient ni orphelins dans cette famille ni revendiqués deux fois. Le
# garde de la famille qui les produit fait foi, et le check croise les deux
# manifestes pour que la déclaration ne puisse pas devenir un mensonge.
FOREIGN_ASSETS = {
    "icon-dark.png": "gen-og-images.py",
}

# NOTE : il existait ici une table COPIES, qui recopiait l'icône 512 vers
# public/favicon.png et public/icon-512x512.png, avec la vérification associée
# « ces duplicatas doivent rester identiques à leur source ». Ces deux fichiers
# n'étaient référencés par AUCUN code, aucun HTML, aucun manifeste ni aucun
# service worker — seulement par des règles d'en-têtes de cache de vercel.json,
# elles aussi retirées : le favicon clair est favicon.ico, et les icônes PWA sont
# sous /icons/. Les doublons ont donc été supprimés, et la mécanique de copie
# avec eux : une garde sans sujet est du code mort.

CHANNELS_BY_COLOR_TYPE = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# reserved=0, type=1 (« icône ») : les 4 premiers octets d'un .ico valide.
ICO_MAGIC = b"\x00\x00\x01\x00"

ICO_ENTRY_STRUCT = "<BBBBHHII"  # 16 octets par entrée du répertoire


def generator_sha256(path):
    """Empreinte du générateur : son contenu NORMALISÉ en LF, jamais ses octets bruts.

    Le fin de ligne d'une copie de travail n'est pas une propriété du code. Un
    poste Windows matérialise les fichiers texte en CRLF, la CI Linux en LF : le
    même commit produisait donc deux empreintes, et la CI — qui lit le blob LF —
    croyait le manifeste périmé et refusait. C'est mesuré, pas supposé :

        fichier en CRLF → b1ee7044…   (manifeste écrit sous Windows)
        fichier en LF   → d531db3f…   (ce que la CI calcule)

    Le .gitattributes du dépôt fige LF pour ce fichier, mais un éditeur ou un
    `core.autocrlf` mal réglé peut toujours en produire un localement : on
    normalise donc ICI pour que l'identité du générateur soit la même partout.
    """
    return hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def pixels_sha256(pixels):
    """Empreinte de l'invariant réel : les pixels dé-filtrés (voir le docstring)."""
    return hashlib.sha256(bytes(pixels)).hexdigest()


def read_png_bytes(data, label="<données>"):
    assert data[:8] == PNG_SIGNATURE, f"{label} n'est pas un PNG valide"
    pos = 8
    idat = b""
    width = height = bitdepth = colortype = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bitdepth, colortype, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
            assert bitdepth == 8, "seuls les PNG 8 bits sont supportés"
            assert interlace == 0, "PNG entrelacé non supporté"
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
    assert width and height and colortype is not None, f"{label} : IHDR/IDAT/IEND manquant"
    channels = CHANNELS_BY_COLOR_TYPE[colortype]
    raw = zlib.decompress(idat)
    stride = width * channels
    pixels = bytearray(width * height * channels)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        (filt,) = raw[pos:pos + 1]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if filt == 1:  # Sub
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filt == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:  # Average
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif filt == 4:  # Paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        pixels[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, colortype, channels, bytes(pixels)


def read_png(path):
    return read_png_bytes(path.read_bytes(), str(path))


def is_opaque(pixels, width, height, channels):
    """Vrai si aucun pixel n'est translucide — exigence des icônes maskable."""
    if channels not in (2, 4):
        return True
    alpha_index = channels - 1
    return all(pixels[i * channels + alpha_index] == 255 for i in range(width * height))


def content_radius(pixels, width, height, channels, background=None):
    """Rayon maximal du CONTENU, en fraction de la largeur (centre = 1/2).

    C'est la mesure qui dit si une icône est réellement maskable : le masque des
    plateformes ne garantit qu'un cercle de SAFE_ZONE_RADIUS fois la largeur,
    centré ; au-delà, le logo est rogné.

    Deux règles, selon l'image :
      • sans `background`, un pixel est du contenu s'il n'est pas transparent —
        c'est le cas des icônes normales (fond transparent) ;
      • avec `background`, un pixel est du contenu s'il est opaque ET diffère de
        cette couleur de fond — c'est le cas des variantes maskable, où la
        transparence a disparu (fond opaque) et où l'alpha ne distingue donc plus
        rien. Vérifié sur la source de ce dépôt : aucun pixel opaque n'a la
        couleur de fond, et les deux règles donnent le même rayon (0,4947
        contre 0,495).
    """
    has_alpha = channels in (2, 4)
    alpha_index = channels - 1
    cx = (width - 1) / 2.0
    cy = (height - 1) / 2.0
    worst = 0.0
    for y in range(height):
        row = y * width * channels
        for x in range(width):
            base = row + x * channels
            if has_alpha and pixels[base + alpha_index] == 0:
                continue
            if background is not None and (
                pixels[base] == background[0]
                and pixels[base + 1] == background[1]
                and pixels[base + 2] == background[2]
            ):
                continue
            distance = math.hypot(x - cx, y - cy) / width
            if distance > worst:
                worst = distance
    return worst


# ── LA MARQUE, DESSINÉE ICI ──────────────────────────────────────────────────
#
# Le favicon et les icônes PWA descendaient d'un RASTER fourni (l'ancien profil,
# 512 × 512, réduit au plus proche voisin). Ils descendent maintenant du
# POINÇON, dessiné par ce fichier à partir de la MÊME déclaration que la page et
# la coquille — src/config/marque-kojo.json, lu par src/config/marque-kojo.js :
# l'onglet du navigateur porte donc la marque du site, et pas un second dessin
# qui lui ressemblerait.
#
# Ce que ce dessin DOIT au SVG, et qui n'est pas négociable :
#
#   • les COUCHES sont peintes dans l'ORDRE du JSON (le disque, l'ombre, le
#     cerclage, le glacis, le collet, le plateau, la lettre) — c'est cet ordre,
#     et non un masque, qui garantit qu'aucun arc ne mord sur l'autre ;
#   • les PEINTURES NOMMÉES sont ré-échantillonnées comme le fait un navigateur :
#     les arrêts sont interpolés en sRGB, alpha compris, et la portée du dégradé
#     radial est celle de la BOÎTE DU DISQUE (unités `objectBoundingBox`), pas
#     celle de la grille — l'erreur d'un facteur 48 ;
#   • les BORDS sont anti-aliasés par une couverture ANALYTIQUE (distance signée
#     au bord, rampe d'un pixel) : sans elle, les trois filets concentriques du
#     poinçon (collet 1,2 / plateau 1,0 / glacis 0,55) se transforment en
#     escaliers dès 192 px ;
#   • les ÉCHANTILLONS sont pris au CENTRE du pixel, et le pixel n'est peint que
#     si le disque peut l'atteindre (les coins d'un disque inscrit sont un tiers
#     de l'image) : c'est la même image, calculée une seule fois.
#
# Ce qu'il ne fait PAS, et ne prétend pas faire : `currentColor` (une couleur
# héritée n'existe pas dans un raster — la peinture `inverse` de la marque ne
# sert qu'à la page, sur un fond coloré), les filtres, l'animation. La marque n'a
# ni les uns ni les autres : « rien ne brille » (§ IV de la philosophie d'atelier).
MARQUE_SOURCE_SIZE = 512
MARQUE_GEOMETRIE_PATH = Path(__file__).resolve().parents[2] / "src" / "config" / "marque-kojo.json"
MARQUE_PEINTURE = "marque"


def load_geometry(path=None):
    """La géométrie du poinçon, lue du fichier que la page et la coquille lisent.

    Une copie des nombres ici (un rayon retapé, une couleur recopiée) serait une
    seconde source : le favicon dériverait du dessin à la première retouche, et
    personne ne le verrait — un raster de 16 px ne se relit pas à l'œil.
    """
    chemin = Path(path) if path else MARQUE_GEOMETRIE_PATH
    if not chemin.exists():
        raise ValueError(
            f"{chemin} : la géométrie de la marque est absente — les icônes PWA et le "
            "favicon ne peuvent pas être dessinés"
        )
    return json.loads(chemin.read_text(encoding="utf-8"))


def couleur_css(valeur):
    """« #rrggbb » → (r, g, b). Une couleur héritée n'existe pas dans un raster."""
    if not isinstance(valeur, str) or not valeur.startswith("#") or len(valeur) != 7:
        raise ValueError(
            f"couleur « {valeur} » : ce générateur ne peint que des couleurs explicites "
            "(« currentColor » dépend de la feuille de style de la page, pas de l'icône)"
        )
    return tuple(int(valeur[i:i + 2], 16) for i in (1, 3, 5))


class Peinture:
    """Un dégradé de la déclaration, et sa loi d'échantillonnage.

    `lineaire` projette le point sur l'axe (coordonnées de la grille, comme
    `gradientUnits="userSpaceOnUse"`) ; `radial` mesure sa distance au centre
    dans les unités de la BOÎTE de l'élément qui le référence (le défaut SVG,
    `objectBoundingBox`) — c'est pourquoi la boîte est un paramètre d'appel.
    Hors des bornes, un dégradé PROLONGE son dernier arrêt (spreadMethod par
    défaut) : ne pas le faire peindrait du noir.
    """

    def __init__(self, nom, declaration):
        self.nom = nom
        self.sorte = declaration["sorte"]
        self.centre = declaration.get("centre")
        self.portee = declaration.get("portee")
        self.axe = declaration.get("axe")
        self.arrets = [
            (
                float(arret[0]),
                couleur_css(arret[1]) + (float(arret[2]) if len(arret) > 2 else 1.0,),
            )
            for arret in declaration["arrets"]
        ]

    def _melange(self, decalage):
        if decalage <= self.arrets[0][0]:
            return self.arrets[0][1]
        if decalage >= self.arrets[-1][0]:
            return self.arrets[-1][1]
        for index in range(1, len(self.arrets)):
            gauche, droite = self.arrets[index - 1], self.arrets[index]
            if decalage <= droite[0]:
                part = (decalage - gauche[0]) / (droite[0] - gauche[0]) if droite[0] > gauche[0] else 0.0
                return tuple(
                    gauche[1][canal] + (droite[1][canal] - gauche[1][canal]) * part
                    for canal in range(4)
                )
        return self.arrets[-1][1]

    def couleur(self, x, y, boite):
        """La couleur (r, g, b, a) de ce dégradé au point (x, y) de la grille."""
        if self.sorte == "radial":
            gauche, haut, largeur, hauteur = boite
            decalage = math.hypot(
                (x - gauche) / largeur - self.centre[0],
                (y - haut) / hauteur - self.centre[1],
            ) / self.portee
        else:
            x1, y1, x2, y2 = self.axe
            dx, dy = x2 - x1, y2 - y1
            carre = dx * dx + dy * dy
            decalage = ((x - x1) * dx + (y - y1) * dy) / carre if carre else 0.0
        return self._melange(decalage)


def couverture(valeur, pas):
    """La couverture d'un bord : 1 dedans, 0 dehors, une rampe d'un pixel au bord.

    `valeur` est la distance SIGNÉE au bord, positive à l'extérieur : la rampe
    d'un pixel n'est qu'un lissage de cette distance, ce qui est la définition
    de l'anti-aliasing analytique (et ce qui le rend indépendant de la taille).
    """
    if valeur <= -0.5 * pas:
        return 1.0
    if valeur >= 0.5 * pas:
        return 0.0
    return 0.5 - valeur / pas


def _angle_sur_le_cercle(x, y, centre_x, centre_y):
    """L'angle d'un point de la grille, en degrés dans [0, 360), comme le tracé."""
    return math.degrees(math.atan2(y - centre_y, x - centre_x)) % 360.0


def _ecart_angulaire(angle, debut, fin):
    """L'écart (en degrés) d'un angle à l'INTERVALLE parcouru par un arc.

    Zéro quand l'angle tombe dedans — c'est ce qui fait la coupe franche des
    bouts (les arcs de la marque sont en `butt`), et non un arrondi.
    """
    if debut <= angle <= fin:
        return 0.0
    return min(abs(angle - debut), abs(angle - fin))


def _distance_au_segment(x, y, depart, arrivee, demi_trait):
    """La distance signée d'un point à un SEGMENT À BOUTS PLATS (rectangle).

    La version « capsule » (distance au segment) donnerait des bouts RONDS : le
    « K » du poinçon est un gras géométrique à coupes franches, ses trois traits
    ont donc une coupe perpendiculaire — un rectangle, et non un bâton arrondi.
    """
    x1, y1 = depart
    x2, y2 = arrivee
    dx, dy = x2 - x1, y2 - y1
    longueur = math.hypot(dx, dy)
    if longueur == 0:
        return math.hypot(x - x1, y - y1) - demi_trait
    axe = ((x - x1) * dx + (y - y1) * dy) / longueur
    perpendiculaire = abs((x - x1) * dy - (y - y1) * dx) / longueur
    debordement = max(0.0 - axe, axe - longueur)
    return max(perpendiculaire - demi_trait, debordement)


def lire_chemin(donnee):
    """Les SEGMENTS d'un chemin SVG minimal : « M x y », « L x y », « V y », « H x ».

    Les trois tracés de la lettre sont déclarés dans marque-kojo.json en syntaxe
    SVG — parce que le SVG est ce que peint la page. Les recopier ici en couples
    de points serait une SECONDE déclaration de la lettre, et c'est exactement
    elle qui doit rester identique entre l'onglet et le site.
    """
    jetons = re.findall(r"[A-Za-z]|-?\d*\.?\d+", donnee)
    segments = []
    courant = None
    commande = None
    index = 0
    while index < len(jetons):
        jeton = jetons[index]
        if jeton.isalpha():
            commande = jeton.upper()
            index += 1
            continue
        if commande in (None, "Z"):
            raise ValueError(f"chemin « {donnee} » : commande manquante avant « {jeton} »")
        if commande == "M":
            courant = (float(jetons[index]), float(jetons[index + 1]))
            index += 2
            commande = "L"  # les couples suivants sont des lignes IMPLICITES
            continue
        if commande == "L":
            suivant = (float(jetons[index]), float(jetons[index + 1]))
            index += 2
        elif commande == "V":
            suivant = (courant[0], float(jetons[index]))
            index += 1
        elif commande == "H":
            suivant = (float(jetons[index]), courant[1])
            index += 1
        else:
            raise ValueError(
                f"chemin « {donnee} » : la commande « {commande} » n'est pas supportée par "
                "le rasteriseur (seuls M, L, V et H sont nécessaires à la lettre)"
            )
        segments.append((courant, suivant))
        courant = suivant
    return segments


def dessiner_la_marque(taille, geometrie, peinture=MARQUE_PEINTURE):
    """Le poinçon, en pixels RGBA (`taille` × `taille`), peint couche par couche.

    Les trois traits de la lettre sont UNE seule couche (leur union) : ils sont
    de la même couleur, opaque, donc peindre l'union ou les empiler donne la
    même image — mais l'union est deux fois plus rapide.
    """
    grille = float(geometrie["grille"])
    pas = grille / taille
    couches = geometrie["peintures"][peinture]["couches"]
    nommees = {
        nom: Peinture(nom, declaration)
        for nom, declaration in geometrie["gradients"].items()
    }
    lettre = geometrie["lettre"]

    # Le rayon du disque commande tout l'extérieur : hors de sa portée (+ 1 px),
    # le pixel est transparent et rien n'est évalué. C'est ce qui rend le dessin
    # de 512 px tenable (les coins d'un disque inscrit sont un tiers de l'image).
    disque = next((couche for couche in couches if couche["sorte"] == "disque"), None)
    if disque is None:
        raise ValueError("marque-kojo.json : la peinture n'a pas de disque — rien à dessiner")
    rayon_disque = float(disque["rayon"])
    boite_disque = (24.0 - rayon_disque, 24.0 - rayon_disque, 2 * rayon_disque, 2 * rayon_disque)

    segments_lettre = [
        (segment[0], segment[1], float(lettre["largeur"]))
        for trace in (lettre["tronc"], lettre["brasHaut"], lettre["brasBas"])
        for segment in lire_chemin(trace)
    ]

    def peinture_de(couche):
        if "peinture" in couche:
            return nommees[couche["peinture"]]
        return None

    pixels = bytearray(taille * taille * 4)
    for ligne in range(taille):
        y = (ligne + 0.5) * pas
        for colonne in range(taille):
            x = (colonne + 0.5) * pas
            distance = math.hypot(x - 24.0, y - 24.0)
            if distance > rayon_disque + pas:
                continue
            rouge = vert = bleu = alpha = 0.0
            for couche in couches:
                sorte = couche["sorte"]
                if sorte == "disque":
                    portee = couverture(distance - float(couche["rayon"]), pas)
                elif sorte == "arc":
                    rayon = float(couche["rayon"])
                    demi = float(couche["largeur"]) / 2.0
                    bord = abs(distance - rayon) - demi
                    if bord >= 0.5 * pas:
                        continue
                    angle = _angle_sur_le_cercle(x, y, 24.0, 24.0)
                    ecart = _ecart_angulaire(angle, float(couche["de"]), float(couche["a"]))
                    portee = couverture(max(bord, math.radians(ecart) * rayon), pas)
                elif sorte == "cercle":
                    rayon = float(couche["rayon"])
                    portee = couverture(
                        abs(distance - rayon) - float(couche["largeur"]) / 2.0, pas
                    )
                elif sorte == "lettre":
                    portee = 0.0
                    for depart, arrivee, largeur in segments_lettre:
                        portee = max(
                            portee,
                            couverture(
                                _distance_au_segment(x, y, depart, arrivee, largeur / 2.0),
                                pas,
                            ),
                        )
                else:
                    raise ValueError(f"marque-kojo.json : sorte de couche inconnue « {sorte} »")
                if portee <= 0.0:
                    continue
                degrade = peinture_de(couche)
                if degrade is not None:
                    couleur = degrade.couleur(x, y, boite_disque)
                    r, g, b = couleur[0], couleur[1], couleur[2]
                    opacite = portee * couleur[3]
                else:
                    r, g, b = couleur_css(couche["couleur"])
                    opacite = portee
                if "opacite" in couche:
                    opacite *= float(couche["opacite"])
                # Composition « source-over », en prémultiplié : c'est ce qui
                # permet à l'ombre et au glacis (semi-transparents) de se poser
                # sur la matière sans la remplacer.
                if opacite <= 0.0:
                    continue
                restant = 1.0 - opacite
                rouge = r * opacite + rouge * restant
                vert = g * opacite + vert * restant
                bleu = b * opacite + bleu * restant
                alpha = opacite + alpha * restant
            if alpha <= 0.0:
                continue
            # La couleur accumulée est déjà prémultipliée par l'alpha courant :
            # on la ramène en couleur droite pour l'écriture du PNG.
            index = (ligne * taille + colonne) * 4
            pixels[index] = min(255, int(rouge / alpha + 0.5))
            pixels[index + 1] = min(255, int(vert / alpha + 0.5))
            pixels[index + 2] = min(255, int(bleu / alpha + 0.5))
            pixels[index + 3] = min(255, int(alpha * 255.0 + 0.5))
    return bytes(pixels)


def make_maskable(pixels, width, height, channels, size, scale):
    """Fabrique une variante maskable : contenu réduit de `scale`, centré sur
    un fond OPAQUE (la couleur de fond du manifeste PWA).

    Le résultat est entièrement opaque : c'est une exigence des masques — une
    zone transparente laisserait voir le fond du système, qui n'est pas celui
    du logo.
    """
    inner = max(1, int(round(size * scale)))
    scaled = reduce_area(pixels, width, height, channels, inner, inner)
    red, green, blue = MASKABLE_BACKGROUND
    out = bytearray(bytes((red, green, blue, 255)) * (size * size))
    offset = (size - inner) // 2
    for y in range(inner):
        for x in range(inner):
            src = (y * inner + x) * channels
            dst = ((y + offset) * size + (x + offset)) * 4
            if channels == 4:
                alpha = scaled[src + 3]
                if alpha == 0:
                    continue
                if alpha == 255:
                    out[dst:dst + 4] = scaled[src:src + 4]
                    continue
                # Composition alpha sur le fond, canal par canal : le résultat
                # reste opaque même là où la source ne l'était pas.
                for channel in range(3):
                    out[dst + channel] = (
                        scaled[src + channel] * alpha
                        + MASKABLE_BACKGROUND[channel] * (255 - alpha)
                    ) // 255
                out[dst + 3] = 255
            else:
                # Sans canal alpha, la source est déjà opaque : recopie directe.
                for channel in range(3):
                    out[dst + channel] = scaled[src + channel]
    return bytes(out)


def read_ico(path):
    """Lit un ICO dont les images sont des PNG embarqués.

    Renvoie [(largeur, hauteur, pixels_de_filigrane)] dans l'ordre du
    répertoire. Lève une ValueError si le fichier n'est pas un ICO exploitable :
    c'est exactement le cas du favicon.ico de 100 octets de zéros qui avait été
    committé, et qu'aucun navigateur ne pouvait afficher.
    """
    data = path.read_bytes()
    if len(data) < 6:
        raise ValueError(f"{path} : {len(data)} octet(s), trop court pour un ICO")
    if data[:4] != ICO_MAGIC:
        raise ValueError(
            f"{path} : en-tête ICO invalide ({data[:4].hex()}), attendu "
            f"{ICO_MAGIC.hex()} (reserved=0, type=1)"
        )
    (count,) = struct.unpack("<H", data[4:6])
    if count == 0:
        raise ValueError(f"{path} : l'ICO ne contient aucune image (count=0)")
    entries = []
    for index in range(count):
        offset = 6 + index * 16
        if offset + 16 > len(data):
            raise ValueError(f"{path} : répertoire tronqué à l'entrée {index}")
        width = data[offset] or 256
        height = data[offset + 1] or 256
        (size,) = struct.unpack("<I", data[offset + 8:offset + 12])
        (start,) = struct.unpack("<I", data[offset + 12:offset + 16])
        blob = data[start:start + size]
        if blob[:8] != PNG_SIGNATURE:
            raise ValueError(
                f"{path} : entrée {index} ({width}x{height}) n'est pas un PNG "
                f"embarqué — ce générateur n'écrit que des entrées PNG"
            )
        _w, _h, _ct, _ch, pixels = read_png_bytes(blob, f"{path} entrée {index}")
        entries.append((width, height, pixels))
    return entries


def digest_file(path):
    """Empreinte PIXELS d'un PNG ou d'un ICO, au format du manifeste."""
    if path.suffix.lower() == ".ico":
        return {
            "kind": "ico",
            "entries": [
                {"width": width, "height": height, "pixel_sha256": pixels_sha256(pixels)}
                for width, height, pixels in read_ico(path)
            ],
        }
    width, height, colortype, channels, pixels = read_png(path)
    return {
        "kind": "png",
        "width": width,
        "height": height,
        "color_type": colortype,
        "pixel_sha256": pixels_sha256(pixels),
        # Rapport utile au garde du manifeste PWA : le rayon du contenu dit si
        # une icône déclarée « maskable » l'est vraiment.
        "content_radius": round(content_radius(pixels, width, height, channels), 4),
        # Mesure utilisée pour les variantes maskable : la transparence ayant
        # disparu (fond opaque), c'est la différence avec la couleur de fond qui
        # délimite le contenu.
        "content_radius_background": round(
            content_radius(pixels, width, height, channels, MASKABLE_BACKGROUND), 4
        ),
        "opaque": is_opaque(pixels, width, height, channels),
    }


def reduce_area(pixels, width, height, channels, new_width, new_height):
    """Réduction par MOYENNE DE SURFACE (filtre boîte), et non au plus proche voisin.

    C'est cette fonction qui décidait de l'aspect du favicon : à 16 px, chaque
    pixel de sortie vaut 32 px de la source, et « le pixel le plus proche » tombe
    régulièrement à côté du trait de la lettre (2 px à cette taille) — l'onglet
    montrait alors un K tronqué ou un bord en escalier. La moyenne de surface
    intègre TOUT ce que la case couvre, et rend la réduction insensible à la
    position du trait : c'est la propriété qu'on veut d'une marque réduite.

    Sur une image à canal alpha, la moyenne se fait en PRÉMULTIPLIÉ : moyenner la
    couleur et l'alpha séparément ferait tirer les bords vers le noir, les pixels
    transparents d'un logo ayant une couleur (voir l'en-tête de `dessiner_la_marque`).
    """
    if (new_width, new_height) == (width, height):
        return bytes(pixels)
    out = bytearray(new_width * new_height * channels)
    alpha_index = channels - 1 if channels == 4 else None
    for y in range(new_height):
        debut_y = y * height // new_height
        fin_y = max(debut_y + 1, (y + 1) * height // new_height)
        for x in range(new_width):
            debut_x = x * width // new_width
            fin_x = max(debut_x + 1, (x + 1) * width // new_width)
            total = [0] * channels
            compte = 0
            for ligne in range(debut_y, fin_y):
                base = ligne * width
                for colonne in range(debut_x, fin_x):
                    source = (base + colonne) * channels
                    if alpha_index is None:
                        for canal in range(channels):
                            total[canal] += pixels[source + canal]
                    else:
                        alpha = pixels[source + alpha_index]
                        total[alpha_index] += alpha
                        for canal in range(alpha_index):
                            total[canal] += pixels[source + canal] * alpha
                    compte += 1
            cible = (y * new_width + x) * channels
            if alpha_index is None:
                for canal in range(channels):
                    out[cible + canal] = (total[canal] + compte // 2) // compte
                continue
            alpha_moyen = (total[alpha_index] + compte // 2) // compte
            out[cible + alpha_index] = alpha_moyen
            for canal in range(alpha_index):
                # total[canal] est une somme de couleur × alpha : on la ramène à
                # une couleur droite en divisant par la somme des alphas.
                somme_alpha = total[alpha_index]
                out[cible + canal] = (
                    min(255, (total[canal] + somme_alpha // 2) // somme_alpha)
                    if somme_alpha > 0
                    else 0
                )
    return bytes(out)


def encode_png(width, height, colortype, pixels):
    # On conserve le type de couleur de la source (ex: 6 = RGBA) — convertir
    # 4 canaux RGBA en gray+alpha (type 4) rendrait l'image illisible.
    channels = CHANNELS_BY_COLOR_TYPE[colortype]
    stride = width * channels
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filtre None
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(ctype, payload):
        return (
            struct.pack(">I", len(payload))
            + ctype
            + payload
            + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, colortype, 0, 0, 0)
    return (
        PNG_SIGNATURE
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def write_png(path, width, height, colortype, pixels):
    path.write_bytes(encode_png(width, height, colortype, pixels))


def build_ico(images):
    """Assemble un ICO (images PNG embarquées) : [(taille, octets_png)]."""
    header = ICO_MAGIC + struct.pack("<H", len(images))
    directory = bytearray()
    payload = bytearray()
    offset = 6 + 16 * len(images)
    for size, blob in images:
        # Dans le format ICO, 0 signifie 256 (les dimensions sont sur 1 octet).
        dimension = 0 if size >= 256 else size
        directory += struct.pack(ICO_ENTRY_STRUCT, dimension, dimension, 0, 0, 1, 32, len(blob), offset)
        payload += blob
        offset += len(blob)
    return bytes(header + directory + payload)


def sha256_of(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_manifest(out_dir, geometrie_rel, size_entries, favicon_rel, favicon_entries, maskable):
    unmanaged = []
    for name in sorted(UNMANAGED_ASSETS):
        path = out_dir / name
        if not path.exists():
            # Tolérant : `--out-dir` peut viser un dossier temporaire (rejeu de
            # contrôle), où seules les sorties générées existent. Le garde CI,
            # lui, exige la présence de chaque entrée (il tourne sur le dépôt).
            unmanaged.append({"file": name, "missing": True, "why": UNMANAGED_ASSETS[name]})
            continue
        unmanaged.append(
            {
                "file": name,
                "bytes": path.stat().st_size,
                "sha256": sha256_of(path),
                "why": UNMANAGED_ASSETS[name],
            }
        )

    return {
        "generator": Path(__file__).name,
        "generator_sha256": generator_sha256(__file__),
        "paths_relative_to": "this manifest",
        "pixel_rule": (
            "Les empreintes « pixel_sha256 » couvrent le flux IDAT décompressé et "
            "dé-filtré : c'est l'invariant comparable entre machines, la compression "
            "zlib variant d'une installation à l'autre (101 592 octets committés "
            "contre 101 049 régénérés ici pour des pixels identiques)."
        ),
        # La SOURCE n'est plus un fichier fourni : c'est le DESSIN, à la plus
        # grande taille servie (voir main). On enregistre donc le fichier, ses
        # pixels, ET la déclaration dont ils descendent — de sorte qu'une
        # géométrie retouchée sans régénération soit NOMMÉE, et pas seulement
        # déduite d'un écart de pixels.
        "source": {
            "file": f"icon-{size_entries['width']}x{size_entries['height']}.png",
            "width": size_entries["width"],
            "height": size_entries["height"],
            "color_type": size_entries["color_type"],
            "pixel_sha256": size_entries["pixel_sha256"],
            "drawn_by": Path(__file__).name,
            "peinture": MARQUE_PEINTURE,
            "geometry": geometrie_rel,
            "geometry_sha256": generator_sha256(MARQUE_GEOMETRIE_PATH),
        },
        "sizes": SIZES,
        "favicon_sizes": FAVICON_ICO_SIZES,
        "outputs": size_entries["outputs"],
        "favicon": {"file": favicon_rel, "entries": favicon_entries},
        "maskable": maskable,
        "unmanaged": unmanaged,
        "foreign": [{"file": name, "generated_by": owner} for name, owner in sorted(FOREIGN_ASSETS.items())],
    }


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out-dir", default=".", help="dossier des icônes PWA (défaut : dossier courant)")
    parser.add_argument("--favicon", help=f"chemin du favicon clair (défaut : <out-dir>/../{FAVICON_ICO_NAME})")
    parser.add_argument("--manifest", help=f"chemin du manifeste (défaut : <out-dir>/{MANIFEST_NAME})")
    parser.add_argument(
        "--skip-size-pngs",
        action="store_true",
        help="n'écrit pas les PNG de SIZES (déjà conformes au pixel près) mais écrit "
        "quand même les variantes maskable, le favicon et le manifeste : évite de "
        "committer huit binaires réécrits à pixels identiques, dont seuls les octets "
        "zlib diffèrent",
    )
    parser.add_argument(
        "--skip-maskable",
        action="store_true",
        help="n'écrit pas les variantes maskable de MASKABLE_SIZES (déjà conformes)",
    )
    parser.add_argument(
        "--digest",
        nargs="+",
        metavar="FICHIER",
        help="n'écrit RIEN : imprime en JSON l'empreinte PIXELS de chaque PNG/ICO donné",
    )
    args = parser.parse_args()

    if args.digest:
        result = {}
        for name in args.digest:
            try:
                result[name] = digest_file(Path(name))
            except Exception as error:  # noqa: BLE001 — message exploitable, sortie 1
                result[name] = {"error": str(error)}
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
        if any("error" in entry for entry in result.values()):
            return 1
        return 0

    # Résolu une bonne fois : le favicon se déduit du PARENT du dossier des
    # icônes, et « . » donnerait sinon « ./favicon.ico » (donc DANS icons/).
    out_dir = Path(args.out_dir).resolve()
    # LA MARQUE EST DESSINÉE, et non plus réduite d'un raster fourni : les icônes
    # PWA et le favicon descendent du poinçon déclaré dans marque-kojo.json — le
    # même dessin que la page et la coquille.
    geometrie = load_geometry()
    if MARQUE_SOURCE_SIZE != max(SIZES):
        raise ValueError(
            f"MARQUE_SOURCE_SIZE ({MARQUE_SOURCE_SIZE}) doit être la plus grande taille servie "
            f"({max(SIZES)}) : c'est le dessin d'origine, toutes les autres en descendent"
        )
    width = height = MARQUE_SOURCE_SIZE
    colortype = 6  # RGBA : la marque est un disque, ses coins sont transparents
    channels = CHANNELS_BY_COLOR_TYPE[colortype]
    print(
        f"Marque dessinée : {width}x{height}, grille {geometrie['grille']}, peinture "
        f"« {MARQUE_PEINTURE} » — géométrie {MARQUE_GEOMETRIE_PATH}"
    )
    pixels = dessiner_la_marque(width, geometrie)

    source_digest = pixels_sha256(pixels)

    outputs = []
    for size in SIZES:
        scaled = reduce_area(pixels, width, height, channels, size, size)
        out = out_dir / f"icon-{size}x{size}.png"
        digest = pixels_sha256(scaled)
        if args.skip_size_pngs:
            if out.exists() and digest_file(out)["pixel_sha256"] == digest:
                print(f"  {out.name} conservé (pixels déjà conformes)")
            elif out.exists():
                print(f"  [!] {out.name} conservé mais ses PIXELS diffèrent de la régénération")
            else:
                print(f"  [!] {out.name} absent (--skip-size-pngs) : le garde CI le signalera")
        else:
            write_png(out, size, size, colortype, scaled)
            print(f"  {out.name} écrit ({out.stat().st_size} octets)")
        outputs.append(
            {"file": out.name, "width": size, "height": size, "color_type": colortype, "pixel_sha256": digest}
        )

    # Les variantes maskable sont FABRIQUÉES ici : le contenu est réduit pour
    # tenir dans le cercle de sécurité, puis centré sur un fond opaque. Le facteur
    # se déduit de la source (aucune constante magique à maintenir à la main).
    source_radius = content_radius(pixels, width, height, channels)
    maskable_scale = min(1.0, MASKABLE_CONTENT_RADIUS / source_radius) if source_radius else 1.0
    print(
        f"  contenu de la source : rayon {source_radius:.3f} pour une limite maskable de "
        f"{SAFE_ZONE_RADIUS:.3f} -> variantes réduites de {maskable_scale:.3f}"
    )
    maskable_outputs = []
    for size in MASKABLE_SIZES:
        out = out_dir / f"icon-{size}x{size}-maskable.png"
        derived = make_maskable(pixels, width, height, channels, size, maskable_scale)
        digest = pixels_sha256(derived)
        radius = content_radius(derived, size, size, 4, MASKABLE_BACKGROUND)
        if args.skip_maskable:
            if out.exists() and digest_file(out)["pixel_sha256"] == digest:
                print(f"  {out.name} conservé (pixels déjà conformes)")
            elif out.exists():
                print(f"  [!] {out.name} conservé mais ses PIXELS diffèrent de la régénération")
            else:
                print(f"  [!] {out.name} absent (--skip-maskable) : le garde CI le signalera")
        else:
            # Sortie RGBA : make_maskable compose toujours sur un fond opaque.
            write_png(out, size, size, 6, derived)
            print(f"  {out.name} écrit ({out.stat().st_size} octets, rayon {radius:.3f})")
        maskable_outputs.append(
            {
                "file": out.name,
                "width": size,
                "height": size,
                "color_type": 6,
                "pixel_sha256": digest,
                "content_radius": round(radius, 4),
                "opaque": is_opaque(derived, size, size, 4),
            }
        )

    favicon_path = Path(args.favicon).resolve() if args.favicon else out_dir.parent / FAVICON_ICO_NAME
    images = []
    favicon_entries = []
    for size in FAVICON_ICO_SIZES:
        scaled = reduce_area(pixels, width, height, channels, size, size)
        images.append((size, encode_png(size, size, colortype, scaled)))
        favicon_entries.append(
            {"width": size, "height": size, "color_type": colortype, "pixel_sha256": pixels_sha256(scaled)}
        )
    favicon_path.write_bytes(build_ico(images))
    print(f"  {favicon_path} écrit ({favicon_path.stat().st_size} octets, {len(images)} images PNG embarquées)")

    manifest_path = Path(args.manifest).resolve() if args.manifest else out_dir / MANIFEST_NAME
    manifest = build_manifest(
        out_dir,
        os.path.relpath(MARQUE_GEOMETRIE_PATH, manifest_path.parent).replace(os.sep, "/"),
        {
            "width": width,
            "height": height,
            "color_type": colortype,
            "pixel_sha256": source_digest,
            "outputs": outputs,
        },
        os.path.relpath(favicon_path, manifest_path.parent).replace(os.sep, "/"),
        favicon_entries,
        {
            "sizes": MASKABLE_SIZES,
            "background": "#%02x%02x%02x" % MASKABLE_BACKGROUND,
            "safe_zone_radius": SAFE_ZONE_RADIUS,
            "content_radius_target": MASKABLE_CONTENT_RADIUS,
            "source_content_radius": round(source_radius, 4),
            "scale": round(maskable_scale, 4),
            "outputs": maskable_outputs,
        },
    )
    # newline="\n" est INDISPENSABLE : sans lui, Python traduit sous Windows
    # chaque saut de ligne en CRLF, et le manifeste produit n'a plus les mêmes
    # octets que celui de la CI — exactement la divergence que .gitattributes
    # supprime pour les fichiers versionnés, mais que l'écriture d'un fichier
    # GÉNÉRÉ doit respecter elle aussi. Même règle que gen-og-images.py.
    with manifest_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"  {manifest_path} écrit ({manifest_path.stat().st_size} octets)")

    problems = [entry for entry in manifest["unmanaged"] if entry.get("missing")]
    for entry in problems:
        detail = "absent"
        # Marqueur ASCII : la console Windows en cp1252 ne peut pas encoder les
        # emoji, et un plantage d'affichage ne doit pas faire échouer le rejeu du
        # garde CI (mesuré : UnicodeEncodeError sur « ⚠️ »).
        print(f"  [!] {entry['file']} {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
