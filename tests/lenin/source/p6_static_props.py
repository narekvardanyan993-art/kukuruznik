#!/usr/bin/env python3
"""Ленин, круг 3 (07.10.2026): стоящие машины эпохи и ларьки — прямо в картинку (цвет и подложка), а не движком.

Правило Нарека: ларьки/тележки движка выглядят приклеенными — статика рисуется в сам кадр, в стиле рисунка: карандашный контур,
лёгкая штриховка на теневой стороне, акварельная заливка, мягкая тень. Маленькие и немного: «Волга» ГАЗ-24, «Москвич»-412, ЗАЗ-968,
газетный киоск «Союзпечать», автомат газированной воды. Рисуется с запасом ×6 и уменьшается (ровные края).
Запуск после p4_saturate.py и p5_water_g.py. С круга s2 стоящие машины — спрайт «Победы» из атласа движка (PARKED), не рисунок кодом.
"""
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
F = Path(__file__).resolve().parent.parent / 'frames'
SS = 6
INK = (58, 51, 42)
CARC = {'volga': (214, 204, 178), 'volga2': (150, 166, 150), 'moskvich': (176, 72, 62), 'zaz': (222, 208, 160), 'moskvich2': (104, 132, 156)}
def rot(pts, a, cx, cy):
    c, s = math.cos(a), math.sin(a)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]
def rrect(L, Wd, r, n=6):
    pts = []
    for (qx, qy, a0) in ((L / 2 - r, Wd / 2 - r, 0), (-L / 2 + r, Wd / 2 - r, 90), (-L / 2 + r, -Wd / 2 + r, 180), (L / 2 - r, -Wd / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n); pts.append((qx + r * math.cos(a), qy + r * math.sin(a)))
    return pts
def shade(c, k): return tuple(int(max(0, min(255, v * k))) for v in c)
def car(dr, cx, cy, L, ang, kind):
    col = CARC[kind]; Wd = L * (0.5 if kind == 'zaz' else 0.42); r = Wd * (0.45 if kind == 'zaz' else 0.3)
    dr.polygon(rot(rrect(L * 1.05, Wd * 1.25, r), ang, cx + L * 0.06, cy + Wd * 0.28), fill=(60, 50, 40, 60))            # тень
    side = rot([(x, y + Wd * 0.18) for x, y in rrect(L, Wd, r)], ang, cx, cy)
    dr.polygon(side, fill=shade(col, 0.72) + (255,))                                                                 # бок (вид сверху-сбоку)
    body = rot(rrect(L, Wd, r), ang, cx, cy)
    dr.polygon(body, fill=col + (255,), outline=INK + (230,), width=max(1, int(SS * 0.6)))
    dr.polygon(rot(rrect(L * 0.46, Wd * 0.74, Wd * 0.18), ang, cx - L * 0.04, cy), fill=(84, 98, 112, 235))          # стёкла
    dr.polygon(rot(rrect(L * 0.3, Wd * 0.62, Wd * 0.14), ang, cx - L * 0.04, cy), fill=shade(col, 1.06) + (255,), outline=INK + (180,), width=max(1, SS // 2))   # крыша
    for k in range(3):   # штриховка тени на борту
        x0 = -L * 0.35 + k * L * 0.25
        dr.line(rot([(x0, Wd * 0.52), (x0 + L * 0.12, Wd * 0.62)], ang, cx, cy), fill=INK + (120,), width=max(1, SS // 3))
def kiosk(dr, cx, cy, h, kind):
    w = h * (0.95 if kind == 'news' else 0.45); d = w * 0.35
    body = (196, 64, 58) if kind == 'soda' else (120, 150, 172)
    dr.polygon([(cx - w / 2 - 2, cy + 2), (cx + w / 2 + d, cy + 2), (cx + w / 2 + d + h * 0.5, cy - h * 0.1), (cx - w / 2 + h * 0.4, cy - h * 0.1)], fill=(60, 50, 40, 55))   # тень
    dr.polygon([(cx + w / 2, cy), (cx + w / 2 + d, cy - d * 0.6), (cx + w / 2 + d, cy - h - d * 0.6), (cx + w / 2, cy - h)], fill=shade(body, 0.7) + (255,), outline=INK + (255,), width=max(1, int(SS * 0.7)))   # бок
    dr.rectangle([cx - w / 2, cy - h, cx + w / 2, cy], fill=body + (255,), outline=INK + (255,), width=max(1, int(SS * 0.75)))
    if kind == 'news':
        dr.rectangle([cx - w / 2 + w * 0.08, cy - h * 0.62, cx + w / 2 - w * 0.08, cy - h * 0.3], fill=(214, 226, 230, 255), outline=INK + (200,), width=max(1, SS // 2))   # витрина
        dr.rectangle([cx - w / 2, cy - h * 0.92, cx + w / 2, cy - h * 0.76], fill=(52, 92, 150, 255))   # вывеска
        dr.polygon([(cx - w / 2 - w * 0.08, cy - h), (cx + w / 2 + w * 0.08, cy - h), (cx + w / 2 + d + w * 0.06, cy - h - d * 0.6), (cx - w / 2 + d * 0.9, cy - h - d * 0.6)], fill=(230, 222, 200, 255), outline=INK + (255,), width=max(1, int(SS * 0.7)))   # крыша
    else:
        dr.rectangle([cx - w * 0.3, cy - h * 0.8, cx + w * 0.3, cy - h * 0.55], fill=(236, 230, 214, 255))
        dr.ellipse([cx - w * 0.1, cy - h * 0.45, cx + w * 0.1, cy - h * 0.35], outline=INK + (220,), width=max(1, SS // 2))
    for k in range(3):
        y = cy - h * (0.2 + 0.25 * k); dr.line([(cx + w / 2 + d * 0.2, y), (cx + w / 2 + d * 0.8, y - d * 0.45)], fill=INK + (110,), width=max(1, SS // 3))
PROPS = {   # (вид, u, v, размер в долях высоты кадра (длина машины / высота ларька), угол в градусах)
    'lenin_2': [('news', 0.655, 0.447, 0.013, 0), ('soda', 0.425, 0.652, 0.012, 0)],   # «Волга»/«Москвич» кодом выглядели приклеенными — убраны (круг s2)
    'lenin_6': [('news', 0.455, 0.392, 0.016, 0), ('soda', 0.865, 0.412, 0.014, 0)],   # стоящие машины на G не нашли честного места у бордюра — не рисуем
}
for fid, items in PROPS.items():
    base = Image.open(F / (fid + '.webp')).convert('RGB'); W, H = base.size
    layer = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0)); dr = ImageDraw.Draw(layer)
    for kind, u, v, s, ang in items:
        cx, cy, L = u * W * SS, v * H * SS, s * H * SS
        if kind in ('news', 'soda'): kiosk(dr, cx, cy, L, kind)
        else: car(dr, cx, cy, L, math.radians(ang), kind)
    small = np.asarray(layer.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
    rng = np.random.default_rng(11)
    grain = 1 + 0.07 * np.asarray(Image.fromarray((rng.random((H, W)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)[..., None] / 255 - 0.035
    lc, a = small[..., :3] * grain, small[..., 3:4] * 0.92
    for suf in ('', '_bg'):
        bg = np.asarray(Image.open(F / (fid + suf + '.webp')).convert('RGB')).astype(np.float32) / 255
        wash = 0.62 * lc + 0.38 * bg * lc          # акварель прозрачная: бумага и тон рисунка просвечивают сквозь заливку
        out = bg * (1 - a) + wash * a
        Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)).save(F / (fid + suf + '.webp'), quality=90, method=6)
    print(fid, len(items), 'предметов')

# s2 (08.10.2026): стоящие «Победы» — спрайт из Gemini (engine/sprites/life.webp, тот же рисунок, что у едущих машин) у бордюра.
# (кадр, имя кадра атласа, u, v опоры — середина колёс, длина машины в долях высоты кадра)
PARKED = {'lenin_2': [('car_pobeda_side_r', 0.298, 0.4262, 0.021), ('car_pobeda_side_l', 0.343, 0.4268, 0.021)]}
import json
SP = F.parent.parent.parent / 'engine' / 'sprites'
meta = json.loads((SP / 'life.json').read_text()); atlas = Image.open(SP / 'life.webp').convert('RGBA')
for fid, items in PARKED.items():
    for suf in ('', '_bg'):
        base = Image.open(F / (fid + suf + '.webp')).convert('RGBA'); W, H = base.size
        for nm, u, v, L in items:
            x, y, w, h, ax, ay = meta['frames'][nm]
            spr = atlas.crop((x, y, x + w, y + h)); g = meta['groups']['car_pobeda']
            sw = L * H * w / g[0]; sh = sw * h / w
            spr = spr.resize((max(1, round(sw)), max(1, round(sh))), Image.LANCZOS)
            import cv2   # цветность как у кадра после p4 (×1,5), иначе машина бледнее рисунка
            arr = np.asarray(spr).copy(); lab = cv2.cvtColor(np.ascontiguousarray(arr[..., :3]), cv2.COLOR_RGB2LAB).astype(np.float32)
            lab[..., 1:] = np.clip(128 + (lab[..., 1:] - 128) * 1.5, 0, 255); arr[..., :3] = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)
            spr = Image.fromarray(arr, 'RGBA')
            sd = Image.new('RGBA', base.size, (0, 0, 0, 0)); ImageDraw.Draw(sd).ellipse([u * W - sw * 0.5, v * H - sh * 0.1, u * W + sw * 0.5, v * H + sh * 0.12], fill=(50, 42, 34, 70))
            base = Image.alpha_composite(base, sd.filter(ImageFilter.GaussianBlur(1.2)))
            base.alpha_composite(spr, (round(u * W - ax * spr.size[0]), round(v * H - ay * spr.size[1])))
        base.convert('RGB').save(F / (fid + suf + '.webp'), quality=90, method=6)
    print(fid, len(items), 'стоящих «Побед» (спрайт)')
