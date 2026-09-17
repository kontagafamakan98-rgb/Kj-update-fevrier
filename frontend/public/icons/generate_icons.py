#!/usr/bin/env python3
"""Génère les icônes PWA Kojo en pur Python (stdlib uniquement, sans PIL).

Usage :
    python generate_icons.py [--source SRC] [--out-dir DIR] [--favicon FILE]
                             [--manifest FILE] [--skip-size-pngs]
    python generate_icons.py --digest FICHIER...

Source par défaut : icon-512x512.png (le plus grand → meilleure qualité en
downscale). Produit les tailles PWA déclarées par SIZES, le favicon CLAIR
(favicon.ico, images PNG embarquées aux tailles de FAVICON_ICO_SIZES) puis le
MANIFESTE de la famille (MANIFEST_NAME), qui la verrouille en CI via
scripts/check-generated-icons.js.

Remplace l'ancienne version PIL (non installée) : les anciennes icônes
72/96/128/152/384 étaient des fichiers vides de 100 octets (zéros), ce qui
cassait le badge des notifications push et les apple-touch-icons.

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
# Les variantes maskable NE sont plus ici : elles sont désormais produites par
# ce générateur (voir MASKABLE_SIZES), donc enregistrées comme sorties.
UNMANAGED_ASSETS = {
    "kojo-icon.svg": "icône vectorielle source (dessin, pas de génération)",
}

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


def make_maskable(pixels, width, height, channels, size, scale):
    """Fabrique une variante maskable : contenu réduit de `scale`, centré sur
    un fond OPAQUE (la couleur de fond du manifeste PWA).

    Le résultat est entièrement opaque : c'est une exigence des masques — une
    zone transparente laisserait voir le fond du système, qui n'est pas celui
    du logo.
    """
    inner = max(1, int(round(size * scale)))
    scaled = scale_nearest(pixels, width, height, channels, inner, inner)
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


def scale_nearest(pixels, width, height, channels, new_width, new_height):
    out = bytearray(new_width * new_height * channels)
    for y in range(new_height):
        sy = min(height - 1, y * height // new_height)
        for x in range(new_width):
            sx = min(width - 1, x * width // new_width)
            src = (sy * width + sx) * channels
            dst = (y * new_width + x) * channels
            out[dst:dst + channels] = pixels[src:src + channels]
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


def build_manifest(out_dir, source_path, size_entries, favicon_rel, favicon_entries, maskable):
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
        "source": {
            "file": source_path.name,
            "width": size_entries["width"],
            "height": size_entries["height"],
            "color_type": size_entries["color_type"],
            "pixel_sha256": size_entries["pixel_sha256"],
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
    parser.add_argument("--source", help="PNG source (défaut : icon-512x512.png, relatif au dossier courant)")
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
    source_path = Path(args.source) if args.source else Path("icon-512x512.png")
    width, height, colortype, channels, pixels = read_png(source_path)
    print(f"Source : {source_path} ({width}x{height}, type couleur {colortype}, {channels} canaux)")

    source_digest = pixels_sha256(pixels)

    outputs = []
    for size in SIZES:
        scaled = scale_nearest(pixels, width, height, channels, size, size)
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
        scaled = scale_nearest(pixels, width, height, channels, size, size)
        images.append((size, encode_png(size, size, colortype, scaled)))
        favicon_entries.append(
            {"width": size, "height": size, "color_type": colortype, "pixel_sha256": pixels_sha256(scaled)}
        )
    favicon_path.write_bytes(build_ico(images))
    print(f"  {favicon_path} écrit ({favicon_path.stat().st_size} octets, {len(images)} images PNG embarquées)")

    manifest_path = Path(args.manifest).resolve() if args.manifest else out_dir / MANIFEST_NAME
    manifest = build_manifest(
        out_dir,
        source_path,
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
