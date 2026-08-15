#!/usr/bin/env python3
"""Génère les icônes PWA Kojo en pur Python (stdlib uniquement, sans PIL).

Usage : python generate_icons.py [source.png]
Source par défaut : icon-512x512.png (le plus grand → meilleure qualité en
downscale). Produit les 8 tailles PWA dans le dossier courant.

Remplace l'ancienne version PIL (non installée) : les anciennes icônes
72/96/128/152/384 étaient des fichiers vides de 100 octets (zéros), ce qui
cassait le badge des notifications push et les apple-touch-icons.
"""
import struct
import sys
import zlib
from pathlib import Path

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

CHANNELS_BY_COLOR_TYPE = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path: Path):
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path} n'est pas un PNG valide"
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
    assert width and height and colortype is not None, "IHDR/IDAT/IEND manquant"
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


def write_png(path: Path, width, height, colortype, pixels):
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
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("icon-512x512.png")
    width, height, colortype, channels, pixels = read_png(source)
    print(f"Source : {source} ({width}x{height}, type couleur {colortype}, {channels} canaux)")
    for size in SIZES:
        scaled = scale_nearest(pixels, width, height, channels, size, size)
        out = Path(f"icon-{size}x{size}.png")
        write_png(out, size, size, colortype, scaled)
        print(f"  {out.name} écrit ({out.stat().st_size} octets)")


if __name__ == "__main__":
    main()
