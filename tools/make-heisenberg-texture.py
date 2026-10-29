#!/usr/bin/env python3
"""Writes the 16x16 Heisenberg block texture.

    python3 tools/make-heisenberg-texture.py               # built-in pixel art
    python3 tools/make-heisenberg-texture.py photo.jpg     # from any image

An image is center-cropped to a square and downscaled to 16x16. Rebuild the
assets afterwards with ./CompileEPK.sh (and ZipStableDownload.sh for the web build).
"""
import os
import sys
from PIL import Image

DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lwjgl-rundir", "resources", "textures", "blocks", "heisenberg.png")

# pork pie hat, glasses and goatee on the green Breaking Bad element tile
ART = [
    "GGGGGGGGGGGGGGGG",
    "GGGGGKKKKKKGGGGG",
    "GGGGGKKKKKKGGGGG",
    "GGGGGkkkkkkGGGGG",
    "GGGKKKKKKKKKKGGG",
    "GGGGSSSSSSSSGGGG",
    "GGGGSSSSSSSSGGGG",
    "GGGGOOOSSOOOGGGG",
    "GGGGOWOOOOWOGGGG",
    "GGGGSOOSSOOSGGGG",
    "GGGGSSSSSSSSGGGG",
    "GGGGSBBBBBBSGGGG",
    "GGGGSBSSSSBSGGGG",
    "GGGGGSBBBBSGGGGG",
    "GGGGGGSBBSGGGGGG",
    "GGGGGGGGGGGGGGGG",
]
COLORS = {
    "G": (32, 112, 58), "K": (24, 24, 24), "k": (60, 60, 60), "S": (224, 178, 140),
    "O": (20, 20, 20), "W": (130, 190, 230), "B": (88, 64, 44),
}

if len(sys.argv) > 1:
    src = Image.open(sys.argv[1]).convert("RGBA")
    side = min(src.size)
    left = (src.width - side) // 2
    top = (src.height - side) // 2
    img = src.crop((left, top, left + side, top + side)).resize((16, 16), Image.LANCZOS)
else:
    img = Image.new("RGBA", (16, 16))
    for y, row in enumerate(ART):
        for x, c in enumerate(row):
            r, g, b = COLORS[c]
            # light per pixel noise so the face reads as a block, not a flat sprite
            n = ((x * 7 + y * 13) % 5) - 2
            img.putpixel((x, y), (max(0, min(255, r + n * 4)), max(0, min(255, g + n * 4)), max(0, min(255, b + n * 4)), 255))
img.save(DEST)
print("wrote", DEST)
