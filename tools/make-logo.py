#!/usr/bin/env python3
"""Generates lwjgl-rundir/resources/title/heisenberg.png, a Minecraft-style title
logo built from the game's own font and stone texture. The output uses the same
atlas layout as mclogo.png: left half at (0,0), right half at (0,45), 155x44 each."""
import os
import sys
from PIL import Image

TEXT = sys.argv[1] if len(sys.argv) > 1 else "HEISENBERG"
RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lwjgl-rundir", "resources")
SCALE = 5      # screen pixels per font pixel
DEPTH = 5      # height of the dark extruded underside
W, H = 310, 44

font = Image.open(os.path.join(RES, "font", "default.png")).convert("RGBA")
stone = Image.open(os.path.join(RES, "textures", "blocks", "stone.png")).convert("RGBA")

def glyph(ch):
    c = ord(ch)
    gx, gy = (c % 16) * 8, (c // 16) * 8
    px = [[font.getpixel((gx + x, gy + y))[3] > 0 for x in range(8)] for y in range(8)]
    cols = [x for x in range(8) if any(px[y][x] for y in range(8))]
    width = (max(cols) + 1) if cols else 3
    return px, width

# 1 font pixel -> SCALE x SCALE block in a mask
glyphs = [glyph(c) for c in TEXT]
text_w = sum(w + 1 for _, w in glyphs) - 1
mw, mh = text_w * SCALE, 8 * SCALE
mask = [[False] * mw for _ in range(mh)]
cx = 0
for px, w in glyphs:
    for y in range(8):
        for x in range(w):
            if px[y][x]:
                for yy in range(SCALE):
                    for xx in range(SCALE):
                        mask[y * SCALE + yy][(cx + x) * SCALE + xx] = True
    cx += w + 1

# trim empty rows (font baseline padding)
rows = [y for y in range(mh) if any(mask[y])]
mask = mask[rows[0]:rows[-1] + 1]
mh = len(mask)

out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ox = (W - mw) // 2
oy = (H - (mh + DEPTH)) // 2

def inside(x, y):
    return 0 <= y < mh and 0 <= x < mw and mask[y][x]

def solid(x, y):  # face or extrusion
    return any(inside(x, y - d) for d in range(DEPTH + 1))

for y in range(-1, mh + DEPTH + 1):
    for x in range(-1, mw + 1):
        X, Y = ox + x, oy + y
        if not (0 <= X < W and 0 <= Y < H):
            continue
        if inside(x, y):
            # stone texture at 2 screen px per texel, lit from the top
            r, g, b, _ = stone.getpixel(((x // 2) % 16, (y // 2) % 16))
            light = 1.5 if (not inside(x, y - 1) or not inside(x, y - 2)) else 1.28
            out.putpixel((X, Y), (min(int(r * light), 255), min(int(g * light), 255), min(int(b * light), 255), 255))
        elif solid(x, y):
            d = next(d for d in range(1, DEPTH + 1) if inside(x, y - d))
            shade = 70 - d * 6
            out.putpixel((X, Y), (shade, shade, shade + 4, 255))
        elif any(solid(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            out.putpixel((X, Y), (0, 0, 0, 255))

atlas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
atlas.paste(out.crop((0, 0, 155, H)), (0, 0))
atlas.paste(out.crop((155, 0, 310, H)), (0, 45))
dest = os.path.join(RES, "title", "heisenberg.png")
atlas.save(dest)
print("wrote", dest, "text width", mw)
