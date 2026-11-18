"""Retouch sheet for the roam walker, second cut (build time only, never shipped).

Usage: python -I scripts/py/figure2_sheet.py <repo root>
Reads the two public domain plates in archive/raw/figure/, cuts the walker parts, lifts the paper inside each
garment to one flat tone (keeps the etched contour and the long fold lines, drops dense hatching and paper
mottling), closes every outline with a ruled stroke, and draws the small missing pieces in code (closed fists,
heels, the under-brim and nape masses filled with the hat's own crayon grain). Writes a transparent sheet
archive/raw/figure/fig-figure2-sheet.png and archive/raw/figure/fig-figure2-sheet.json (cell boxes, recipe crops,
pins in sheet px). The sheet goes through npm run assets like any plate.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
RAW = ROOT / "archive/raw/figure"
P42 = np.asarray(Image.open(RAW / "fig-rijks-jongen-rug-1842.jpg").convert("L"), dtype=np.float32)
P25 = np.asarray(Image.open(RAW / "fig-rijks-jardinier-1825-front.jpg").convert("L"), dtype=np.float32)

PAPER = 228.0  # flat paper tone of every garment before the tint (the tint maps it to the garment colour)
INK = 38.0


def poly_mask(shape, pts, ox=0, oy=0):
    im = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon([(x - ox, y - oy) for x, y in pts], fill=255)
    return np.asarray(im, dtype=np.float32) / 255.0


def capsule(pts_a, pts_b, r, n=10):
    """Polygon of a capsule from a to b with radius r (rounded both ends)."""
    (ax, ay), (bx, by) = pts_a, pts_b
    ang = math.atan2(by - ay, bx - ax)
    out = []
    for k in range(n + 1):
        t = ang + math.pi / 2 + math.pi * k / n
        out.append((ax + r * math.cos(t), ay + r * math.sin(t)))
    for k in range(n + 1):
        t = ang - math.pi / 2 + math.pi * k / n
        out.append((bx + r * math.cos(t), by + r * math.sin(t)))
    return out


def flatten(gray, mask, keep_band=7, hatch_cut=0.75):
    """Paper to one flat tone; ink kept as lines, dense hatching thinned, mottling dropped."""
    inside = mask > 0.5
    paper = float(np.percentile(gray[inside], 80)) if inside.any() else PAPER
    ink = np.clip((paper - gray) / max(1.0, paper - 120.0), 0, 1)
    ink = np.where(ink < 0.3, 0, np.clip((ink - 0.3) / 0.5, 0, 1))  # mottling, stains and faint foxing go
    dens = ndi.uniform_filter(ink, 13)
    edge = inside & ~ndi.binary_erosion(inside, iterations=keep_band)
    damp = np.clip((dens - 0.12) / 0.22, 0, 1) * hatch_cut
    damp[edge] = 0
    ink = ink * (1 - damp)
    ink = ndi.uniform_filter(ink, 2)
    return PAPER - ink * (PAPER - INK)


def stroke(mask, width):
    """Ruled outline just inside the mask edge."""
    inside = mask > 0.5
    ring = inside & ~ndi.binary_erosion(inside, iterations=width)
    return ndi.gaussian_filter(ring.astype(np.float32), 0.6)


def part_from(plate, box, poly, line=3, extra=None):
    x0, y0, x1, y1 = box
    g = plate[y0:y1, x0:x1].copy()
    m = poly_mask(g.shape, poly, x0, y0)
    tone = flatten(g, m)
    if extra is not None:
        tone = extra(tone, m, x0, y0)
    s = stroke(m, line)
    tone = tone * (1 - s) + INK * s
    return tone, m


def grain_patch(h, w):
    """Crayon grain of the 1825 hat crown, tiled: fill texture for the code-drawn dark masses."""
    rng = np.random.default_rng(1825)
    n = ndi.gaussian_filter(rng.normal(0, 1, (h, w)).astype(np.float32), 1.2)
    return 120 + n * 60 / max(1e-3, float(n.std()))


def rotate_part(tone, m, deg, pivot):
    """Rotates tone and mask about pivot (part px), clockwise on screen; returns new arrays and the map."""
    h, w = m.shape
    rgba = np.zeros((h, w, 2), np.float32)
    big = 2 * int(math.hypot(h, w)) + 40
    canvas_t = np.full((big, big), PAPER, np.float32)
    canvas_m = np.zeros((big, big), np.float32)
    ox, oy = big // 2 - int(pivot[0]), big // 2 - int(pivot[1])
    canvas_t[oy:oy + h, ox:ox + w] = tone
    canvas_m[oy:oy + h, ox:ox + w] = m
    c = (big // 2, big // 2)
    ti = Image.fromarray(canvas_t).rotate(-deg, resample=Image.BICUBIC, center=c, fillcolor=PAPER)
    mi = Image.fromarray(canvas_m).rotate(-deg, resample=Image.BICUBIC, center=c, fillcolor=0)
    a = math.radians(deg)

    def fwd(x, y):
        dx, dy = x + ox - c[0], y + oy - c[1]
        return (c[0] + dx * math.cos(a) - dy * math.sin(a), c[1] + dx * math.sin(a) + dy * math.cos(a))

    del rgba
    return np.asarray(ti, np.float32), np.asarray(mi, np.float32), fwd


parts = {}


def add(pid, tone, m, pins, size, tint):
    """pins: name -> (x, y) in this part's px."""
    parts[pid] = dict(tone=tone, m=m, pins=pins, size=size, tint=tint)


# ---------- torso (1842): smock only, hem trimmed straight, no flare ----------
TORSO = [(1075, 1078), (1140, 1066), (1200, 1072), (1232, 1100), (1240, 1150), (1222, 1200), (1215, 1260),
         (1222, 1330), (1236, 1375), (1238, 1404), (1170, 1410), (1085, 1412), (1000, 1408), (938, 1402),
         (936, 1360), (955, 1300), (960, 1220), (962, 1150), (985, 1112), (1030, 1092)]
box = (920, 1050, 1260, 1425)
t, m = part_from(P42, box, TORSO)
O = lambda p, b=box: (p[0] - b[0], p[1] - b[1])
add("fg/torso", t, m, {"pin": O((1085, 1392)), "neck": O((1162, 1096)), "shoulderL": O((989, 1147)),
                       "shoulderR": O((1218, 1168)), "hipL": O((1007, 1396)), "hipR": O((1162, 1396))}, None, "smock")

# ---------- head: small dark nape (hair under the hat), code-drawn, hat crayon grain ----------
nh, nw = 118, 120
nape = [(10, 30), (30, 8), (60, 2), (90, 8), (110, 30), (112, 62), (100, 86), (84, 100), (80, 116), (40, 116),
        (36, 100), (20, 86), (8, 62)]
m = poly_mask((nh, nw), nape)
g = grain_patch(nh, nw)
tone = np.clip(62 + (g - g.mean()) * 0.25, 35, 95)
s = stroke(m, 3)
tone = tone * (1 - s) + 25 * s
add("fg/head", tone, m, {"pin": (60, 100), "hatSeat": (60, 22)}, 44, "hair")

# ---------- hat (1825): crown and brim, under-brim filled dark so no head shows ----------
HB = (1040, 800, 1370, 990)
HAT = [(1062, 905), (1068, 885), (1100, 868), (1140, 860), (1150, 840), (1175, 826), (1205, 822), (1240, 826),
       (1262, 838), (1272, 858), (1300, 850), (1330, 848), (1350, 858), (1348, 880), (1325, 900), (1290, 915),
       (1270, 930), (1250, 960), (1205, 972), (1160, 960), (1140, 930), (1110, 920), (1080, 918)]


def hat_extra(tone, m, x0, y0):
    # the face below the brim and the spade blade are replaced by the dark back of the head in hat grain
    h, w = tone.shape
    yy, xx = np.mgrid[0:h, 0:w]
    under = ((((xx + x0 - 1203) / 62.0) ** 2 + ((yy + y0 - 906) / 44.0) ** 2) <= 1).astype(np.float32)
    under[yy + y0 < 890] = 0
    g = grain_patch(h, w)
    fill = np.clip(52 + (g - g.mean()) * 0.25, 30, 85)
    under = ndi.gaussian_filter(under, 1.5)
    out = tone * (1 - under) + fill * under
    # the litho hat itself: keep its crayon value, only clamp the paper showing through the stipple
    hat_only = (m > 0.5) & (under < 0.5)
    m[...] = np.maximum(m, (under > 0.5).astype(np.float32))
    src = P25[y0:y0 + h, x0:x0 + w]
    out[hat_only] = np.clip(src[hat_only] * 0.8, 20, 150)
    return out


_r = json.loads((ROOT / "archive/recipes/roam.json").read_text())
_hj = next(j for j in _r["pages"][0]["jobs"] if j["id"] == "fg/hat")
HAT = [(x * P25.shape[1], y * P25.shape[0]) for x, y in _hj["matte"]]
t, m = part_from(P25, HB, HAT, line=2, extra=hat_extra)
add("fg/hat", t, m, {"pin": (1205 - HB[0], 905 - HB[1])}, 118, "hat")

# ---------- arms (1842 right sleeve): hanging straight and bent, shoulder cap and cuff lined ----------
SH, CU = (1218, 1160), (1372, 1385)
AB = (1150, 1090, 1440, 1470)
sleeve = capsule(SH, CU, 62)
cap = [(x, y) for x, y in sleeve]
t, m = part_from(P42, AB, cap, line=3)
ang = math.degrees(math.atan2(CU[1] - SH[1], CU[0] - SH[0]))  # about 55: turn it to 90 (hanging)
tr, mr, fwd = rotate_part(t, m, 90 - ang, O(SH, AB))
sh_r, cu_r = fwd(*O(SH, AB)), fwd(*O(CU, AB))
# tidy: drop the ballooning underside, keep a calm tapered sleeve
L = cu_r[1] - sh_r[1]
taper = capsule((sh_r[0], sh_r[1]), (sh_r[0], cu_r[1]), 1)
im = Image.new("L", (mr.shape[1], mr.shape[0]), 0)
ImageDraw.Draw(im).polygon([(sh_r[0] - 58, sh_r[1] - 10), (sh_r[0] - 30, sh_r[1] - 58), (sh_r[0] + 30, sh_r[1] - 58),
                            (sh_r[0] + 58, sh_r[1] - 10), (sh_r[0] + 56, cu_r[1] - 10), (sh_r[0] + 40, cu_r[1] + 22),
                            (sh_r[0] - 40, cu_r[1] + 22), (sh_r[0] - 54, cu_r[1] - 10)], fill=255)
trim = np.asarray(im, np.float32) / 255.0
mr2 = np.minimum(mr, trim)
s = stroke(mr2, 3)
tr2 = tr * (1 - s) + INK * s
add("fg/arm", tr2, mr2, {"pin": sh_r, "cuff": (cu_r[0], cu_r[1] + 6)}, None, "smock")
# bent: the forearm points forward (away from the camera), so the sleeve shows foreshortened to the elbow
el = (sh_r[0], sh_r[1] + L * 0.6)
im = Image.new("L", (mr.shape[1], mr.shape[0]), 0)
ImageDraw.Draw(im).polygon(capsule((sh_r[0], sh_r[1] - 10), el, 56), fill=255)
mb = np.minimum(mr, np.asarray(im, np.float32) / 255.0)
s = stroke(mb, 3)
tb = tr * (1 - s) + INK * s
add("fg/arm-bent", tb, mb, {"pin": sh_r, "cuff": (el[0], el[1] + 30)}, None, "smock")

# ---------- fist: closed hand, code-drawn, smock shade ----------
fh, fw = 96, 84
fist = poly_mask((fh, fw), [(22, 6), (62, 6), (74, 22), (78, 48), (72, 72), (58, 88), (30, 90), (14, 76), (8, 50),
                             (10, 24)])
tone = np.full((fh, fw), 150.0, np.float32)
tone += (np.linspace(18, -22, fh)[:, None])  # top lit, knuckles in shade
im = Image.new("L", (fw, fh), 0)
d = ImageDraw.Draw(im)
for y in (52, 64, 76):
    d.line([(22, y), (60, y + 2)], fill=150, width=3)  # curled fingers
d.line([(14, 34), (36, 46), (44, 62)], fill=210, width=4)  # thumb over the fingers
lines = ndi.gaussian_filter(np.asarray(im, np.float32) / 255.0, 0.6)
tone = tone * (1 - lines) + INK * lines
s = stroke(fist, 3)
tone = tone * (1 - s) + INK * s
add("fg/hand", tone, fist, {"pin": (42, 14), "grip": (42, 56)}, 30, "fist")

# ---------- legs (1842): tidy trouser legs, inner outlines closed, heels drawn ----------
THL = [(940, 1380), (1072, 1380), (1076, 1480), (1072, 1620), (1066, 1740), (1052, 1792), (1005, 1802),
       (958, 1792), (946, 1720), (942, 1560)]
THR = [(1070, 1380), (1238, 1386), (1240, 1480), (1232, 1620), (1218, 1740), (1196, 1800), (1150, 1810),
       (1104, 1798), (1086, 1730), (1074, 1560)]
SHL = [(946, 1740), (1066, 1740), (1068, 1820), (1062, 1900), (1058, 1952), (1004, 1958), (952, 1952), (948, 1880)]
SHR = [(1090, 1742), (1232, 1742), (1238, 1820), (1240, 1900), (1236, 1944), (1165, 1950), (1100, 1944), (1094, 1860)]


def leg(pid, poly, pins, hem_y=None, heel_x=None):
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    b = (min(xs) - 16, min(ys) - 16, max(xs) + 16, max(ys) + 70)
    t, m = part_from(P42, b, poly, line=3)
    if hem_y is not None:
        # heel and sole edge of a plain shoe seen from behind, under the trouser hem
        h, w = m.shape
        cx, hy = heel_x - b[0], hem_y - b[1]
        yy, xx = np.mgrid[0:h, 0:w]
        heel = ((((xx - cx) / 28.0) ** 2 + ((yy - hy - 8) / 26.0) ** 2) <= 1).astype(np.float32)
        heel[yy < hy - 6] = 0
        sole = ((((xx - cx) / 31.0) ** 2 + ((yy - hy - 30) / 7.0) ** 2) <= 1).astype(np.float32)
        g = grain_patch(h, w)
        shoe = np.clip(58 + (g - g.mean()) * 0.25, 35, 85)
        t = np.where(heel > 0.5, shoe, t)
        t = np.where(sole > 0.5, 34, t)
        m2 = np.maximum(m, np.maximum(heel, sole))
        # hem line over the heel top so the trouser closes
        s = stroke(m, 3) * (m > 0.5)
        t = t * (1 - s) + INK * s
        m = m2
    add(pid, t, m, {k: (v[0] - b[0], v[1] - b[1]) for k, v in pins.items()}, None, "trousers")


leg("fg/thigh-l", THL, {"pin": (1010, 1392), "knee": (1003, 1771)})
leg("fg/thigh-r", THR, {"pin": (1160, 1392), "knee": (1166, 1772)})
leg("fg/shin-l", SHL, {"pin": (1005, 1765)}, hem_y=1952, heel_x=1004)
leg("fg/shin-r", SHR, {"pin": (1165, 1765)}, hem_y=1944, heel_x=1165)

# ---------- layout on one transparent sheet ----------
SCALE = 0.385  # sprite px per plate px, as the first cut
GUT = 40
cells, x, y, row_h, SW = {}, GUT, GUT, 0, 2200
for pid, p in parts.items():
    m = p["m"]
    ys, xs = np.nonzero(m > 0.02)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    p["bounds"] = (x0, y0, x1, y1)
    w, h = x1 - x0, y1 - y0
    if x + w + GUT > SW:
        x, y, row_h = GUT, y + row_h + GUT, 0
    cells[pid] = (x, y, w, h)
    x += w + GUT
    row_h = max(row_h, h)
SH_ = int(y + row_h + GUT)
sheet = np.zeros((SH_, SW, 4), np.uint8)
meta = {"sheet": [SW, SH_], "parts": {}}
for pid, p in parts.items():
    x0, y0, x1, y1 = p["bounds"]
    cx, cy, w, h = cells[pid]
    tone = np.clip(p["tone"][y0:y1, x0:x1], 0, 255)
    a = np.clip(p["m"][y0:y1, x0:x1], 0, 1)
    sheet[cy:cy + h, cx:cx + w, 0] = tone
    sheet[cy:cy + h, cx:cx + w, 1] = tone
    sheet[cy:cy + h, cx:cx + w, 2] = tone
    sheet[cy:cy + h, cx:cx + w, 3] = (a * 255).astype(np.uint8)
    long_side = max(w, h)
    size = p["size"] or int(round(long_side * SCALE)) + 8
    k = (size - 8) / long_side
    sw, shh = round(w * k) + 8, round(h * k) + 8
    pins = {n: [round((v[0] - x0) * k + 4, 1), round((v[1] - y0) * k + 4, 1)] for n, v in p["pins"].items()}
    m = 6  # crop margin in sheet px (transparent)
    meta["parts"][pid] = {
        "crop": [round((cx - m) / SW, 6), round((cy - m) / SH_, 6), round((cx + w + m) / SW, 6), round((cy + h + m) / SH_, 6)],
        "cell": [cx, cy, w, h], "size": size, "spritePx": [sw, shh], "pins": pins, "tint": p["tint"],
        "pinSheet": {n: [round(v[0] - x0 + cx, 1), round(v[1] - y0 + cy, 1)] for n, v in p["pins"].items()},
    }
Image.fromarray(sheet, "RGBA").save(RAW / "fig-figure2-sheet.png")
(RAW / "fig-figure2-sheet.json").write_text(json.dumps(meta, indent=1, default=float))
print(json.dumps({k: (v["spritePx"], v["pins"]) for k, v in meta["parts"].items()}))
