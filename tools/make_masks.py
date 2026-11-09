#!/usr/bin/env python3
"""Paint 20 original grass-tuft alpha masks into five 2x2 atlases.

    python3 tools/make_masks.py            # writes textures/grass4_mask_*.png
    python3 tools/make_masks.py --sheet    # also writes tools/mask_sheet.png

Each atlas is 2048x2048, 8-bit grayscale. Quadrant q of atlas a holds variant
a*4+q. GrassSystem samples quadrant (q % 2, q // 2) with UV origin at the
bottom-left, so q0 is the bottom-left quadrant of the image, q1 bottom-right,
q2 top-left, q3 top-right. Every quadrant keeps a 14 px empty gutter on all
four sides so linear filtering never bleeds between tufts. Roots sit on the
bottom of each quadrant, just inside the gutter.

Every shape is drawn from scratch by the functions below; no source image is
read. The generated textures are released as CC0.

Variants 0-5, 8, 9, 12, 13, 16 and 17 are the playground's default selection,
so they are the dense, even fillers. The rest are accents.
"""
import argparse
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ATLAS_FILES = [
    'grass4_mask_01.png', 'grass4_mask_01_02.png', 'grass4_mask_02.png',
    'grass4_mask_03.png', 'grass4_mask_04.png',
]
QUAD = 1024          # quadrant size in output pixels
GUTTER = 14          # empty border inside every quadrant
SS = 2               # supersampling factor while drawing
MARGIN = 26          # keep geometry this far from the quadrant edge (sides/top)
ROOT_Y = QUAD - GUTTER - 3            # root line in output pixels
H = ROOT_Y - GUTTER - MARGIN          # usable height; shapes grow toward -y


# ---------------------------------------------------------------- geometry

def bezier(c, t):
    p0, p1, p2, p3 = c
    u = 1 - t
    return u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3


def tangent(c, t):
    p0, p1, p2, p3 = c
    u = 1 - t
    d = 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2)
    return d / (np.linalg.norm(d) + 1e-9)


def curve(root, height, lean, droop=0.0, stiff=0.38, rng=None):
    """A stem rising from root. lean: tip x offset / height. droop: how far the
    tip falls back down (fraction of height), for arching blades."""
    j = (lambda a, b: rng.uniform(a, b)) if rng else (lambda a, b: (a + b) / 2)
    p0 = np.array(root, float)
    dx = lean * height
    p1 = p0 + [dx * 0.05, -height * stiff]
    p2 = p0 + [dx * j(0.45, 0.65), -height * j(0.85, 1.0)]
    p3 = p0 + [dx, -height * (1 - droop)]
    return (p0, p1, p2, p3)


def ribbon(c, width, t0=0.0, t1=1.0, samples=56, wobble=0.0, seed=0, offset=None):
    """Polygon around curve c. width(s) is the full width at s in [0, 1].
    offset(s) shifts the outline sideways (sickle-shaped blades). wobble adds
    a low-frequency hand-cut irregularity to both edges."""
    ph = seed * 1.7
    left, right = [], []
    for i in range(samples + 1):
        s = i / samples
        t = t0 + (t1 - t0) * s
        p, d = bezier(c, t), tangent(c, t)
        n = np.array([-d[1], d[0]])
        w = max(width(s), 0.0) * 0.5
        o = offset(s) if offset else 0.0
        wl = w * (1 + wobble * math.sin(s * 9.0 + ph))
        wr = w * (1 + wobble * math.sin(s * 7.0 + ph * 2.3 + 1.0))
        left.append(p + n * (wl + o))
        right.append(p - n * (wr - o))
    return left + right[::-1]


def saw(x):
    """Triangle wave in [0, 1] with period 1: sharp teeth for serrated leaves."""
    return abs((x % 1.0) * 2 - 1)


def taper(w0, power=0.9):
    return lambda s: w0 * (1 - s) ** power


def disc(center, r, spikes=0, depth=0.0, steps=64, squash=1.0):
    pts = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        rr = r * (1 - depth * abs(math.sin(a * spikes / 2))) if spikes else r
        pts.append(np.array(center) + [math.cos(a) * rr, math.sin(a) * rr * squash])
    return pts


class Tuft:
    def __init__(self, rng):
        self.rng = rng
        self.polys = []

    def add(self, poly):
        self.polys.append(poly)

    def blade(self, x, h, lean, w, droop=0.0, power=0.9, wobble=0.12, sickle=0.0, stiff=0.38):
        c = curve((x, 0), h, lean, droop, stiff, self.rng)
        off = (lambda s: sickle * w * math.sin(math.pi * s)) if sickle else None
        self.add(ribbon(c, taper(w, power), wobble=wobble, seed=self.rng.random() * 9, offset=off))
        return c

    def stem(self, x, h, lean, w=14, droop=0.0):
        c = curve((x, 0), h, lean, droop, 0.4, self.rng)
        self.add(ribbon(c, lambda s: w * (1 - 0.4 * s), samples=60))
        return c


def spread(n, width, rng, jitter=0.3):
    """n root positions across width, centred on 0."""
    return [((i + rng.uniform(-jitter, jitter)) / max(1, n - 1) - 0.5) * width for i in range(n)]


# ---------------------------------------------------------------- shapes
# Each function receives a Tuft and draws into it. Heights are fractions of H.

def fan_clump(t):
    """Blades radiating evenly from one point, like an open hand of cards."""
    r = t.rng
    n = 12
    for i in range(n):
        f = i / (n - 1) - 0.5
        t.blade(f * 120, H * r.uniform(0.55, 0.8) * (1 - abs(f) * 0.5), f * 1.5,
                r.uniform(70, 90), droop=abs(f) * 0.1)


def windswept(t):
    """Sickle-shaped blades that all sweep the same way."""
    r = t.rng
    for x in spread(11, 340, r):
        t.blade(x, H * r.uniform(0.5, 0.85), r.uniform(0.45, 0.8), r.uniform(62, 84),
                droop=r.uniform(0.0, 0.12), sickle=0.35)


def hummock(t):
    """Many short blades whose tips trace a rounded mound."""
    r = t.rng
    n = 12
    for i, x in enumerate(spread(n, 520, r, 0.2)):
        f = x / 260
        h = H * 0.42 * math.sqrt(max(0.05, 1 - f * f)) * r.uniform(0.85, 1.1)
        t.blade(x, h, f * 0.7 + r.uniform(-0.15, 0.15), r.uniform(80, 100), power=0.7)


def crossed_sedge(t):
    """Stiff, nearly straight blades crossing in an X."""
    r = t.rng
    for i, x in enumerate(spread(10, 300, r)):
        lean = (-1 if x > 0 else 1) * r.uniform(0.35, 0.7)
        t.blade(x, H * r.uniform(0.6, 0.92), lean, r.uniform(54, 70), stiff=0.5, wobble=0.05)


def notched(t):
    """A clump whose blades end in two or three short points."""
    r = t.rng
    for x in spread(9, 320, r):
        h = H * r.uniform(0.5, 0.8)
        lean = x / 400 + r.uniform(-0.2, 0.2)
        w = r.uniform(70, 92)
        c = curve((x, 0), h, lean, 0, 0.38, r)
        t.add(ribbon(c, lambda s, w=w: w * (1 - s) ** 0.5 if s < 0.78 else w * 0.47 * (1 - (s - 0.78) / 0.22),
                     t1=0.86, wobble=0.08))
        top, d = bezier(c, 0.84), tangent(c, 0.84)
        n = np.array([-d[1], d[0]])
        prongs = 2
        for k in range(prongs):
            side = (k - 0.5) * 0.32
            dirv = d * math.cos(side) + n * math.sin(side)
            length = h * r.uniform(0.09, 0.14)
            pc = (top, top + dirv * length * 0.3, top + dirv * length * 0.7, top + dirv * length)
            t.add(ribbon(pc, taper(w * 0.26, 0.9), samples=16))


def fountain(t):
    """Long blades arching out to both sides from a narrow base."""
    r = t.rng
    for i in range(11):
        f = i / 10 - 0.5
        t.blade(f * 90, H * r.uniform(0.7, 0.95), f * 1.9, r.uniform(48, 62),
                droop=abs(f) * 0.9 * r.uniform(0.6, 1.0), stiff=0.5)


def rush_comb(t):
    """Straight vertical spikes of uneven height, like rushes."""
    r = t.rng
    for x in spread(9, 420, r, 0.15):
        t.blade(x, H * r.uniform(0.35, 0.95), r.uniform(-0.05, 0.05), r.uniform(28, 38),
                power=1.2, stiff=0.5, wobble=0.0)


def toothed_rosette(t):
    """Saw-toothed leaves rising in a loose rosette, like a young dandelion."""
    r = t.rng
    for i in range(7):
        f = i / 6 - 0.5
        h = H * r.uniform(0.4, 0.55) * (1 - abs(f) * 0.35)
        c = curve((f * 50, 0), h, f * 1.6, abs(f) * 0.15, 0.4, r)
        w = r.uniform(84, 100)
        teeth = r.uniform(5, 7)
        t.add(ribbon(c, lambda s, w=w, k=teeth: w * math.sin(math.pi * min(1, 0.12 + s * 0.88)) ** 0.7
                     * (0.45 + 0.55 * saw(s * k)), samples=160))


def stubble(t):
    """A wide, low tuft of short spikes of mixed height."""
    r = t.rng
    for x in spread(12, 560, r):
        t.blade(x, H * r.uniform(0.2, 0.48), x / 700 + r.uniform(-0.25, 0.25),
                r.uniform(60, 82), power=1.0)


def twisted(t):
    """Blades that narrow and widen again, as if twisted along their length."""
    r = t.rng
    for x in spread(9, 300, r):
        h = H * r.uniform(0.55, 0.88)
        lean = x / 330 + r.uniform(-0.2, 0.2)
        w = r.uniform(80, 100)
        k = r.uniform(1.0, 1.6)
        ph = r.uniform(0, 1)
        c = curve((x, 0), h, lean, r.uniform(0, 0.1), 0.38, r)
        t.add(ribbon(c, lambda s, w=w, k=k, ph=ph: w * (1 - s) ** 0.8
                     * (0.3 + 0.7 * abs(math.cos(math.pi * (s * k + ph)))), samples=80))


def foxtail(t):
    """A nodding, bristly cylinder of seed above a few blades."""
    r = t.rng
    for x in spread(5, 220, r):
        t.blade(x, H * r.uniform(0.3, 0.5), x / 300 + r.uniform(-0.2, 0.2), r.uniform(44, 56))
    c = t.stem(10, H * 0.9, 0.45, 14, droop=0.12)
    t.add(ribbon(c, lambda s: (70 * math.sin(math.pi * s) ** 0.5 + 10)
                 * (0.7 + 0.3 * abs(math.sin(s * 60))), t0=0.62, t1=1.0, samples=140))


def feather_grass(t):
    """Hair-thin stems ending in long feathery wisps."""
    r = t.rng
    for x in spread(6, 200, r):
        lean = x / 260 + r.uniform(0.2, 0.5)
        c = t.stem(x, H * r.uniform(0.7, 0.95), lean, 10, droop=r.uniform(0.15, 0.35))
        t.add(ribbon(c, lambda s: (34 * math.sin(math.pi * s) + 4) * (0.6 + 0.4 * abs(math.sin(s * 45))),
                     t0=0.55, t1=1.0, samples=120))
    for x in spread(4, 160, r):
        t.blade(x, H * r.uniform(0.25, 0.4), x / 200, r.uniform(36, 46))


def twin_clumps(t):
    """Two small clumps side by side in one card."""
    r = t.rng
    for cx, scale in ((-190, 1.0), (200, 0.75)):
        for x in spread(7, 150, r):
            f = x / 150
            t.blade(cx + x, H * scale * r.uniform(0.45, 0.75), f * 1.1 + r.uniform(-0.1, 0.1),
                    r.uniform(62, 80))


def sprouts(t):
    """Several separate V-shaped sprouts scattered across the card."""
    r = t.rng
    for cx in spread(5, 700, r, 0.2):
        h = H * r.uniform(0.25, 0.5)
        for side in (-1, 1):
            t.blade(cx + side * 10, h * r.uniform(0.8, 1.0), side * r.uniform(0.3, 0.6), r.uniform(50, 64))
        t.blade(cx, h * r.uniform(1.0, 1.2), r.uniform(-0.1, 0.1), r.uniform(46, 56))


def puffs(t):
    """Seed-head puffballs on slender stems."""
    r = t.rng
    for k, x in enumerate(spread(3, 300, r, 0.2)):
        h = H * (0.86 if k == 1 else r.uniform(0.55, 0.7))
        c = t.stem(x, h, x / 600 + r.uniform(-0.1, 0.1), 12)
        t.add(disc(bezier(c, 1.0), r.uniform(70, 90), spikes=26, depth=0.25))
    for x in spread(5, 260, r):
        t.blade(x, H * r.uniform(0.22, 0.36), x / 260, r.uniform(48, 60))


def panicle(t):
    """An open, branching seed head with beads at the branch tips."""
    r = t.rng
    c = t.stem(0, H * 0.95, -0.15, 14)
    for k in range(9):
        s = 0.5 + 0.48 * k / 8
        p, d = bezier(c, s), tangent(c, s)
        side = 1 if k % 2 else -1
        n = np.array([-d[1], d[0]]) * side
        length = 150 * (1 - k / 11)
        dirv = d * 0.55 + n * 0.85
        dirv /= np.linalg.norm(dirv)
        end = p + dirv * length + [0, length * 0.25]
        bc = (p, p + dirv * length * 0.4, end - [0, length * 0.1], end)
        t.add(ribbon(bc, lambda s: 9 * (1 - 0.4 * s), samples=20))
        for b in range(3):
            q = bezier(bc, 0.5 + 0.25 * b)
            t.add(disc(q, 14, steps=20, squash=1.5))
    for x in spread(6, 260, r):
        t.blade(x, H * r.uniform(0.3, 0.5), x / 300 + r.uniform(-0.15, 0.15), r.uniform(48, 62))


def clover_lobes(t, cx, h, size):
    r = t.rng
    c = t.stem(cx, h, r.uniform(-0.25, 0.25), 12)
    top = bezier(c, 1.0)
    for a in (-0.9, 0.0, 0.9):
        d = np.array([math.sin(a), -math.cos(a)])
        t.add(disc(top + d * size * 0.62, size * 0.42, steps=40))
        t.add(disc(top + d * size * 0.62 + np.array([d[1], -d[0]]) * size * 0.28, size * 0.36, steps=40))


def clover_patch(t):
    """Three-lobed leaves at mixed heights: a low, round ground cover."""
    r = t.rng
    for x in spread(5, 600, r, 0.2):
        clover_lobes(t, x, H * r.uniform(0.16, 0.4), r.uniform(70, 86))


def grass_and_clover(t):
    """A grass clump with clover leaves tucked in front."""
    r = t.rng
    for x in spread(9, 300, r):
        t.blade(x, H * r.uniform(0.45, 0.78), x / 330 + r.uniform(-0.15, 0.15), r.uniform(58, 74))
    for x in (-230, 210):
        clover_lobes(t, x + r.uniform(-30, 30), H * r.uniform(0.18, 0.28), r.uniform(62, 76))


def cattail(t):
    """Reeds with a solid cylindrical head and a thin spike above it."""
    r = t.rng
    for k, x in enumerate((-60, 70)):
        h = H * (0.95 if k == 0 else 0.72)
        c = t.stem(x, h, r.uniform(-0.12, 0.12), 16)
        t.add(ribbon(c, lambda s: 66 * math.sin(math.pi * min(1, 0.08 + s * 0.84)) ** 0.25,
                     t0=0.62, t1=0.88, samples=30))
    for x in spread(6, 300, r):
        t.blade(x, H * r.uniform(0.45, 0.8), x / 350 + r.uniform(-0.1, 0.1), r.uniform(40, 52),
                stiff=0.5, wobble=0.04)


def thistle(t):
    """Spiny, lobed leaves in a low rosette under one spiky bud."""
    r = t.rng
    for i in range(5):
        f = i / 4 - 0.5
        c = curve((f * 60, 0), H * r.uniform(0.32, 0.42), f * 1.7, abs(f) * 0.2, 0.45, r)
        t.add(ribbon(c, lambda s: 120 * math.sin(math.pi * min(1, 0.1 + s * 0.9)) ** 0.8
                     * (0.3 + 0.7 * saw(s * 4.5 + 0.5) ** 1.5), samples=160))
    c = t.stem(10, H * 0.78, 0.05, 18)
    top = bezier(c, 1.0)
    t.add(disc(top + [0, 30], 44, steps=40, squash=1.1))
    t.add(disc(top - [0, 20], 48, spikes=22, depth=0.55))


SHAPES = [
    fan_clump, windswept, hummock, crossed_sedge,       # grass4_mask_01
    notched, fountain, rush_comb, toothed_rosette,      # grass4_mask_01_02
    stubble, twisted, foxtail, feather_grass,           # grass4_mask_02
    twin_clumps, sprouts, puffs, panicle,               # grass4_mask_03
    clover_patch, grass_and_clover, cattail, thistle,   # grass4_mask_04
]
assert len(SHAPES) == 20


# ---------------------------------------------------------------- raster

def render_quadrant(shape, seed):
    tuft = Tuft(random.Random(seed))
    shape(tuft)
    polys = tuft.polys
    pts = np.concatenate([np.array(p) for p in polys])
    lo, hi = pts.min(0), pts.max(0)
    max_w = QUAD - 2 * (GUTTER + MARGIN)
    scale = min(1.0, max_w / (hi[0] - lo[0]), H / max(1.0, -lo[1]))
    cx = (lo[0] + hi[0]) / 2
    canvas = Image.new('L', (QUAD * SS, QUAD * SS), 0)
    draw = ImageDraw.Draw(canvas)
    for p in polys:
        p = np.array(p)
        x = (p[:, 0] - cx) * scale + QUAD / 2
        # outline points at the root line drop a few px so roots are cut flat
        y = np.where(p[:, 1] >= -0.5, ROOT_Y + 8, np.minimum(p[:, 1], 0) * scale + ROOT_Y)
        draw.polygon([(float(a) * SS, float(b) * SS) for a, b in zip(x, y)], fill=255)
    img = canvas.resize((QUAD, QUAD), Image.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(0.8))       # 1-2 px soft edge
    a = np.array(img)
    a[:, :GUTTER] = 0
    a[:, QUAD - GUTTER:] = 0
    a[:GUTTER, :] = 0
    a[QUAD - GUTTER:, :] = 0
    return a


def build(out_dir):
    atlases = []
    for atlas, name in enumerate(ATLAS_FILES):
        img = np.zeros((2 * QUAD, 2 * QUAD), np.uint8)
        for q in range(4):
            v = atlas * 4 + q
            quad = render_quadrant(SHAPES[v], seed=2026 + v * 7919)
            r0 = (1 - q // 2) * QUAD
            img[r0:r0 + QUAD, (q % 2) * QUAD:(q % 2 + 1) * QUAD] = quad
        Image.fromarray(img).save(os.path.join(out_dir, name), optimize=True)
        atlases.append(img)
    return atlases


def contact_sheet(atlases, path):
    """Variants 1-20 in order, tinted on dark green, for a quick visual check."""
    cell = 256
    sheet = Image.new('RGB', (5 * cell, 4 * cell), (22, 33, 27))
    for v in range(20):
        atlas, q = divmod(v, 4)
        r0, c0 = (1 - q // 2) * QUAD, (q % 2) * QUAD
        quad = Image.fromarray(atlases[atlas][r0:r0 + QUAD, c0:c0 + QUAD]).resize((cell, cell), Image.LANCZOS)
        sheet.paste(Image.new('RGB', (cell, cell), (179, 191, 100)), ((v % 5) * cell, (v // 5) * cell), quad)
    sheet.save(path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'textures'))
    parser.add_argument('--sheet', action='store_true', help='also write tools/mask_sheet.png')
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    result = build(args.out)
    if args.sheet:
        contact_sheet(result, os.path.join(os.path.dirname(__file__), 'mask_sheet.png'))
    print('wrote', ', '.join(ATLAS_FILES), 'to', os.path.abspath(args.out))
