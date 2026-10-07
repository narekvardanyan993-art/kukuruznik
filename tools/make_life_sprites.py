#!/usr/bin/env python3
"""Спрайты библиотеки жизни: engine/sprites/life.png + life.json (e1.10, docs/ENGINE-LIFE.md «Спрайты»).

  python3 tools/make_life_sprites.py                          # перерисовать атлас птиц (то, что идёт в движок)
  python3 tools/make_life_sprites.py --sheet лист.png         # + лист всех кадров крупно, для глаза
  python3 tools/make_life_sprites.py --all --sheet лист.png   # + машины и люди — ТОЛЬКО лист (кодом они игрушечные, в движок не идут)

Временная версия: рисунок кодом в стиле сайта (акварельная заливка с неровным пигментом и тёмным краем, карандашный контур
с дрожанием, штриховка тени, зерно бумаги), рисуется в 8× и уменьшается. Gemini (Nano Banana) в этот запуск был недоступен —
когда будет, листы на белом фоне режутся tools/sprites_intake.py в тот же атлас под теми же именами (движок не меняется).

Имена кадров (движок ищет их в life.json):
  (ждут Gemini) car_<вид>_<цвет>: volga / moskvich / zaz / taxi / trolley, сверху-сбоку, нос вправо; walk_<пальто>_<фаза 0..3>
  pigeon_sit, pigeon_peck            голубь сидит / клюёт, смотрит вправо
  pigeon_fly_<0..3>, pigeon_glide, pigeon_land    голубь в полёте сбоку (крылья вверх → вниз), планирует, садится
  sparrow_sit, sparrow_peck          воробей
Якорь (ax, ay) — доля ширины/высоты кадра: у машин — центр, у людей и птиц на земле — точка опоры, у летящих — центр тела.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'engine' / 'sprites'
SS = 8                       # суперсэмплинг
INK = np.array([52, 46, 42], np.float32) / 255
RNG = np.random.default_rng(11)


def noise(h, w, scale, seed):
    r = np.random.default_rng(seed).standard_normal((h // scale + 3, w // scale + 3)).astype(np.float32)
    r = ndimage.zoom(r, scale, order=3)[:h, :w]
    return (r - r.mean()) / (r.std() + 1e-6)


class Canvas:
    """Слои рисуются в большом размере; paint() — акварель, outline() — карандаш."""
    def __init__(self, w, h):
        self.w, self.h = w * SS, h * SS
        self.rgb = np.ones((self.h, self.w, 3), np.float32)
        self.a = np.zeros((self.h, self.w), np.float32)
        self.seed = int(RNG.integers(1 << 30))

    def mask(self, shapes):
        im = Image.new('L', (self.w, self.h), 0); d = ImageDraw.Draw(im)
        for kind, pts in shapes:
            if kind == 'poly':
                d.polygon([(x * SS, y * SS) for x, y in pts], fill=255)
            elif kind == 'ell':
                d.ellipse([pts[0] * SS, pts[1] * SS, pts[2] * SS, pts[3] * SS], fill=255)
            elif kind == 'rrect':
                x0, y0, x1, y1, r = pts
                d.rounded_rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], radius=r * SS, fill=255)
        return np.asarray(im, np.float32) / 255

    def paint(self, shapes, col, shade=0.0, sdir=(0, 1), edge=0.22, var=0.07, alpha=1.0, hatch=0.0):
        m = self.mask(shapes)
        if m.max() == 0:
            return m
        col = np.array(col, np.float32) / 255
        n = noise(self.h, self.w, 6 * SS, self.seed + int(col.sum() * 1000)) * var
        yy, xx = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        ys, xs = np.nonzero(m > 0.5)
        if len(ys):
            g = ((xx - xs.min()) / max(1, np.ptp(xs)) * sdir[0] + (yy - ys.min()) / max(1, np.ptp(ys)) * sdir[1])
            g = np.clip(g, 0, 1)
        else:
            g = 0
        dist = ndimage.distance_transform_edt(m > 0.5)
        rim = np.exp(-dist / (1.6 * SS))                                    # акварель темнеет к краю пятна
        c = col[None, None, :] * (1 + n[..., None]) * (1 - shade * g)[..., None] * (1 - edge * rim)[..., None]
        if hatch > 0:                                                       # штриховка в тени
            hl = ((xx + yy * 1.0) % (3.2 * SS) < 0.55 * SS).astype(np.float32) * np.clip(g - 0.45, 0, 1) * 2
            c = c * (1 - hatch * hl)[..., None]
        k = (m * alpha)[..., None]
        self.rgb = self.rgb * (1 - k) + np.clip(c, 0, 1) * k
        self.a = np.maximum(self.a, m * alpha)
        return m

    def outline(self, m, width=0.75, dark=0.85):
        hard = m > 0.5
        ring = hard & ~ndimage.binary_erosion(hard, iterations=max(1, int(width * SS)))
        jit = noise(self.h, self.w, 3 * SS, self.seed + 7)
        k = ring.astype(np.float32) * np.clip(0.75 + 0.35 * jit, 0.25, 1) * dark
        self.rgb = self.rgb * (1 - k[..., None]) + INK * k[..., None]

    def line(self, pts, width=0.6, dark=0.8, col=None):
        im = Image.new('L', (self.w, self.h), 0); d = ImageDraw.Draw(im)
        d.line([(x * SS, y * SS) for x, y in pts], fill=255, width=max(1, int(width * SS)), joint='curve')
        m = np.asarray(im, np.float32) / 255 * dark
        c = INK if col is None else np.array(col, np.float32) / 255
        self.rgb = self.rgb * (1 - m[..., None]) + c * m[..., None]
        self.a = np.maximum(self.a, m)

    def shadow(self, shapes, k=0.28):
        m = ndimage.gaussian_filter(self.mask(shapes), 1.2 * SS) * k
        self.rgb = self.rgb * (1 - m[..., None]) + np.array([0.32, 0.29, 0.27]) * m[..., None]
        self.a = np.maximum(self.a, m)

    def done(self):
        g = noise(self.h, self.w, 1 * SS, self.seed + 3) * 0.02             # зерно бумаги
        rgb = np.clip(self.rgb * (1 + g[..., None]), 0, 1)
        im = Image.fromarray((np.dstack([rgb, self.a]) * 255).astype(np.uint8), 'RGBA')
        return im.resize((self.w // SS, self.h // SS), Image.LANCZOS)


# ---------- машины: вид сверху-сбоку, нос вправо, видимый (южный) борт внизу; кадр 100×44 ----------
CAR_COL = {'volga': [(206, 198, 176), (150, 170, 158), (136, 152, 176), (112, 120, 132)], 'moskvich': [(170, 66, 58), (92, 124, 148), (196, 186, 146)],
           'zaz': [(222, 210, 164), (146, 168, 198), (190, 98, 72)], 'taxi': [(228, 206, 132)], 'trolley': [(214, 192, 120)]}


def car(kind, col):
    if kind == 'trolley':
        W, Hh = 200, 48
        c = Canvas(W, Hh)
        c.shadow([('rrect', (8, 14, 196, 44, 6))])
        side = c.paint([('rrect', (6, 22, 194, 40, 4))], [x * 0.78 for x in col], shade=0.2, sdir=(0, 1), hatch=0.35)
        body = c.paint([('rrect', (6, 8, 194, 30, 7))], col, shade=0.15, sdir=(0, 1))
        c.outline(np.maximum(body, side))
        for i in range(9):                                                   # окна салона по борту
            x0 = 22 + i * 18.5
            c.paint([('rrect', (x0, 25, x0 + 13, 33, 1.5))], (84, 98, 112), var=0.05)
        c.paint([('rrect', (186, 24, 193, 34, 1.5))], (84, 98, 112))
        c.paint([('rrect', (60, 12, 140, 20, 2))], [x * 0.85 for x in col])   # оборудование на крыше
        c.line([(70, 16), (130, 16)], 0.5, 0.5)
        for x in (40, 162):
            c.paint([('ell', (x - 7, 36, x + 7, 44))], (40, 38, 38), var=0.02)
        return c.done(), (0.5, 0.5)
    W, Hh = 100, 44
    L = {'volga': (6, 94, 0.5), 'taxi': (6, 94, 0.5), 'moskvich': (10, 90, 0.48), 'zaz': (16, 84, 0.52)}[kind]
    x0, x1, cab = L
    c = Canvas(W, Hh)
    c.shadow([('ell', (x0 - 2, 14, x1 + 4, 44))])
    side = c.paint([('rrect', (x0, 22, x1, 36, 6))], [v * 0.8 for v in col], shade=0.25, sdir=(0, 1), hatch=0.4)
    r = 10 if kind == 'zaz' else 7
    body = c.paint([('rrect', (x0, 7, x1, 30, r))], col, shade=0.12, sdir=(0, 1))
    c.outline(np.maximum(body, side))
    span = x1 - x0
    if kind == 'zaz':
        cx0, cx1 = x0 + span * 0.18, x0 + span * 0.78
    elif kind == 'moskvich':
        cx0, cx1 = x0 + span * 0.24, x0 + span * 0.72
    else:
        cx0, cx1 = x0 + span * 0.3, x0 + span * 0.72
    glass = (78, 94, 112)
    c.paint([('rrect', (cx0 - 4, 10, cx1 + 5, 27, 5))], glass, var=0.06, edge=0.1)           # стёкла кругом кабины
    roof = c.paint([('rrect', (cx0 + 2, 11.5, cx1 - 1, 25.5, 4))], [min(255, v * 1.05) for v in col], shade=0.1)
    c.outline(roof, 0.5, 0.6)
    c.line([(x0 + 4, 18.5), (cx0 - 6, 18.5)], 0.35, 0.35)                                     # линия капота
    c.paint([('rrect', (cx0 - 2, 28, cx1 + 2, 34, 1.5))], glass, var=0.05)                    # боковые окна
    for wx in (x0 + span * 0.2, x0 + span * 0.8):
        c.paint([('ell', (wx - 7, 30, wx + 7, 40))], (38, 36, 36), var=0.02)                 # колёса
        c.paint([('ell', (wx - 3, 33, wx + 3, 37))], (150, 150, 150), var=0.02)
    c.paint([('rrect', (x1 - 3, 11, x1, 26, 1))], (196, 196, 190))                           # хромированный нос
    c.paint([('ell', (x1 - 5, 23, x1 - 1, 28))], (250, 240, 200))                            # фара
    if kind == 'taxi':
        for i in range(6):
            c.paint([('rrect', (x0 + 14 + i * 4.5, 24.5, x0 + 18 + i * 4.5, 27, 0.3))], (40, 38, 36) if i % 2 == 0 else (240, 230, 200))
        c.paint([('ell', (cx0 - 3, 11, cx0 + 1, 14))], (90, 200, 110))                       # зелёный огонёк «свободен»
    return c.done(), (0.5, 0.42)


# ---------- пешеход сбоку, идёт вправо; кадр 24×64, опора внизу ----------
COATS = {'grey': (110, 116, 126), 'brown': (130, 100, 82), 'green': (98, 110, 90), 'blue': (88, 104, 136), 'beige': (176, 156, 120)}


def walker(coat, ph):
    W, Hh = 26, 64
    c = Canvas(W, Hh)
    sw = [-1, -0.35, 1, 0.35][ph]
    hip, ft = (13, 40), 62
    for s, dk in ((-sw, 0.75), (sw, 1.0)):                                   # ноги: дальняя темнее
        c.line([hip, (13 + 6 * s, 51), (13 + 8 * s, ft)], 2.6, 0.9, col=[int(60 * dk), int(56 * dk), int(54 * dk)])
    coatm = c.paint([('poly', [(8.5, 18), (17.5, 18), (19.5, 44), (6.5, 44)])], COATS[coat], shade=0.2, sdir=(1, 0), hatch=0.3)
    c.outline(coatm, 0.5, 0.7)
    c.line([(15, 21), (15 + 6 * sw, 33)], 2.0, 0.75, col=[int(v * 0.7) for v in COATS[coat]])   # рука
    head = c.paint([('ell', (9.5, 6.5, 17.5, 15.5))], (222, 190, 160), shade=0.15, sdir=(1, 0))
    c.outline(head, 0.4, 0.6)
    c.paint([('poly', [(9, 9), (18, 9), (17, 6), (10.5, 5)])], (70, 62, 58))   # кепка/волосы
    return c.done(), (0.5, 0.97)


# ---------- птицы ----------
PIG = (150, 156, 168); PIG_D = (104, 110, 124)


def pigeon_ground(peck):
    c = Canvas(56, 40)
    hy = 7 if peck else 0
    c.shadow([('ell', (8, 33, 46, 39))], 0.18)
    body = c.paint([('ell', (6, 12, 42, 34))], PIG, shade=0.2, sdir=(0, 1), hatch=0.2)
    wing = c.paint([('ell', (8, 14, 34, 27))], PIG_D, shade=0.15, sdir=(0, 1))
    c.paint([('poly', [(8, 22), (-1, 18), (1, 26), (10, 26)])], PIG_D)
    for i in range(3):
        c.line([(16 + i * 5, 20), (20 + i * 5, 25)], 0.4, 0.45)
    neck = c.paint([('ell', (33, 8 + hy, 46, 24 + hy))], (128, 138, 150))
    c.paint([('ell', (36, 15 + hy, 45, 22 + hy))], (120, 150, 130), alpha=0.5)     # переливы шеи
    head = c.paint([('ell', (38, 3 + hy, 50, 14 + hy))], (120, 126, 140))
    c.paint([('poly', [(49, 8 + hy), (55, 10 + hy), (49, 11 + hy)])], (206, 172, 120))
    c.paint([('ell', (44, 6 + hy, 46.5, 8.5 + hy))], (200, 90, 40))
    c.outline(np.maximum(np.maximum(body, head), neck), 0.45, 0.6)
    c.line([(22, 33), (21, 38)], 0.7, 0.8, col=(196, 100, 90)); c.line([(28, 33), (28.5, 38)], 0.7, 0.8, col=(196, 100, 90))
    return c.done(), (0.45, 0.95)


def pigeon_fly(wing, legs=False):
    """wing: 1 — крылья вверху, -1 — внизу, 0.3 — планирование."""
    c = Canvas(64, 52)
    cy = 30
    far = c.paint([('poly', [(30, cy - 2), (24, cy - 3 - 20 * wing), (12, cy - 4 - 24 * wing), (20, cy + 1)])], PIG_D, shade=0.1)
    body = c.paint([('ell', (14, cy - 6, 50, cy + 6))], PIG, shade=0.25, sdir=(0, 1))
    c.paint([('poly', [(16, cy - 2), (4, cy - 5), (4, cy + 4), (16, cy + 3)])], PIG_D)       # хвост веером
    head = c.paint([('ell', (44, cy - 9, 55, cy + 1))], (120, 126, 140))
    c.paint([('poly', [(54, cy - 5), (60, cy - 3), (54, cy - 2)])], (206, 172, 120))
    near = c.paint([('poly', [(36, cy - 1), (30, cy - 2 - 22 * wing), (14, cy - 4 - 26 * wing), (26, cy + 3)])], [v * 1.04 for v in PIG], shade=0.18, sdir=(1, 0), hatch=0.15)
    for i in range(4):
        tx = 14 + i * 4
        c.line([(tx + 4, cy - 2 - 24 * wing * (0.5 + i * 0.12)), (tx, cy - 4 - 26 * wing)], 0.35, 0.4)
    c.outline(np.maximum(np.maximum(body, near), np.maximum(far, head)), 0.45, 0.6)
    if legs:
        c.line([(30, cy + 5), (36, cy + 12)], 0.8, 0.8, col=(196, 100, 90)); c.line([(26, cy + 5), (31, cy + 12)], 0.8, 0.8, col=(196, 100, 90))
    return c.done(), (0.5, cy / 52)


def sparrow(peck):
    c = Canvas(40, 32)
    hy = 5 if peck else 0
    body = c.paint([('ell', (6, 11, 30, 27))], (142, 110, 80), shade=0.25, sdir=(0, 1), hatch=0.25)
    c.paint([('ell', (12, 18, 28, 27))], (216, 200, 170), alpha=0.85)
    c.paint([('ell', (8, 12, 24, 21))], (98, 74, 54))
    for i in range(3):
        c.line([(11 + i * 4, 14), (13 + i * 4, 19)], 0.4, 0.6, col=(60, 44, 32))
    c.paint([('poly', [(9, 18), (0, 12), (2, 19), (9, 22)])], (96, 74, 56))
    head = c.paint([('ell', (24, 6 + hy, 35, 17 + hy))], (128, 98, 70))
    c.paint([('poly', [(24, 9 + hy), (30, 5 + hy), (35, 9 + hy), (30, 10 + hy)])], (118, 116, 116))
    c.paint([('ell', (29, 11 + hy, 34, 15 + hy))], (230, 222, 206))
    c.paint([('poly', [(34, 10.5 + hy), (39, 12 + hy), (34, 13.5 + hy)])], (44, 38, 34))
    c.outline(np.maximum(body, head), 0.4, 0.6)
    c.line([(16, 26), (15, 31)], 0.5, 0.8); c.line([(20, 26), (20.5, 31)], 0.5, 0.8)
    return c.done(), (0.45, 0.96)


def swallow(ph):
    c = Canvas(56, 36)
    w = [0.9, -0.5][ph]
    navy = (34, 42, 74)
    c.paint([('poly', [(28, 17), (20, 15 - 12 * w), (2, 8 - 14 * w), (16, 19)])], [v * 0.9 for v in navy])
    body = c.paint([('ell', (16, 13, 44, 21))], navy, shade=0.2, sdir=(0, 1))
    c.paint([('ell', (38, 15, 44, 20))], (200, 110, 80))
    c.paint([('poly', [(18, 16), (2, 12), (12, 17), (2, 22), (18, 19)])], navy)
    c.paint([('poly', [(32, 17), (26, 15 - 14 * w), (6, 6 - 16 * w), (20, 19)])], navy, shade=0.15, sdir=(1, 0))
    c.outline(body, 0.4, 0.5)
    return c.done(), (0.55, 0.47)


def build(sheet=None, everything=False):
    frames = {}
    if everything:   # машины и люди кодом выглядят игрушечно (проверено 07.10.2026) — в движок не идут, только лист для сравнения
        for kind, cols in CAR_COL.items():
            for i, col in enumerate(cols):
                frames['car_%s_%d' % (kind, i)] = car(kind, col)
        for coat in COATS:
            for ph in range(4):
                frames['walk_%s_%d' % (coat, ph)] = walker(coat, ph)
    frames['pigeon_sit'] = pigeon_ground(False); frames['pigeon_peck'] = pigeon_ground(True)
    for i, wv in enumerate([1.0, 0.35, -0.4, -0.9]):
        frames['pigeon_fly_%d' % i] = pigeon_fly(wv)
    frames['pigeon_glide'] = pigeon_fly(0.25); frames['pigeon_land'] = pigeon_fly(1.1, legs=True)
    frames['sparrow_sit'] = sparrow(False); frames['sparrow_peck'] = sparrow(True)
    # упаковка полками
    pad, maxw = 2, 1024
    x = y = rowh = 0; place = {}
    for name, (im, anc) in sorted(frames.items(), key=lambda kv: -kv[1][0].size[1]):
        w, h = im.size
        if x + w + pad > maxw:
            x, y, rowh = 0, y + rowh + pad, 0
        place[name] = (x, y, w, h, anc); x += w + pad; rowh = max(rowh, h)
    atlas = Image.new('RGBA', (maxw, y + rowh), (0, 0, 0, 0))
    for name, (x, y, w, h, anc) in place.items():
        atlas.paste(frames[name][0], (x, y))
    if everything:
        out_png, out_json = None, None
    else:
        OUT.mkdir(parents=True, exist_ok=True); out_png, out_json = OUT / 'life.png', OUT / 'life.json'
        atlas.save(out_png, optimize=True)
    meta = {'size': atlas.size, 'frames': {k: [x, y, w, h, round(a[0], 3), round(a[1], 3)] for k, (x, y, w, h, a) in sorted(place.items())},
            'cars': {k: len(v) for k, v in CAR_COL.items()}, 'coats': list(COATS)}
    if out_json:
        out_json.write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')))
    print('атлас %dx%d, кадров %d' % (atlas.size[0], atlas.size[1], len(place)))
    if sheet:
        bg = Image.new('RGBA', atlas.size, (245, 236, 218, 255)); bg.alpha_composite(atlas)
        bg.convert('RGB').resize((atlas.size[0] * 2, atlas.size[1] * 2), Image.LANCZOS).save(sheet)


if __name__ == '__main__':
    sh = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    build(sh, '--all' in sys.argv)
