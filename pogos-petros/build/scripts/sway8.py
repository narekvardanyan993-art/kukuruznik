#!/usr/bin/env python3
"""Заход 8 (28.10.2026): ветер виден — поля качания A, B, C заново: кроны (как life3.py) + ТРАВА (пучки зелёного внизу кадра),
сдвиг до 40 px кадра (look.gusts.swayMaxPx). Трава: своя «высота» (href = высота пучка, не 260 px), иначе пучок не шевелится.
Крона/трава переносится из слоя здания в подложку (качается только подложка). Из корня репо:
  python3 pogos-petros/build/scripts/sway8.py  → pogos-petros/build/frames/pogos_{a,b,c}_sway.png (+ _bg/_bg_depth/_building) и копии в tests/pogos-petros/frames
Исходники слоёв до захода — pogos-petros/build/report/s8/pre/ (скрипт берёт их, если есть: повторный запуск даёт то же)."""
import sys, os, shutil
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
sys.path.insert(0, 'tests/lenin/source/s23')
import sway23
from sway23 import half

FD = 'pogos-petros/build/frames'; TD = 'tests/pogos-petros/frames'; PRE = 'pogos-petros/build/report/s8/pre'
MAXPX = 40
TREES = {
    'pogos_a': {'polys': [[(0.845, 0.555), (1.0, 0.555), (1.0, 0.70), (0.935, 0.765), (0.875, 0.765), (0.845, 0.70)]], 'kind': 'ink'},   # life3: с 0.79 — в «крону» попадал угол стены церкви
    'pogos_b': {'polys': [[(0.0, 0.43), (0.068, 0.43), (0.068, 0.70), (0.0, 0.70)], [(0.068, 0.46), (0.135, 0.46), (0.135, 0.70), (0.068, 0.70)]], 'kind': 'green'},
    'pogos_c': {'polys': [[(0.0, 0.47), (0.26, 0.47), (0.26, 0.70), (0.12, 0.725), (0.0, 0.725)]], 'kind': 'green'},
}
GRASS_V = {'pogos_a': 0.62, 'pogos_b': 0.62, 'pogos_c': 0.66}   # трава только ниже этой строки (выше — кроны, стены)

def green(hsv, s_min):
    h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    return (h > 40) & (h < 175) & (s > s_min) & (v > 0.08)

def fields_mixed(trees, grass_ids, max_px):
    """sway23.fields, но у пучков травы href = своя высота (качается вся, а не на долю от 260 px)."""
    old = sway23.HREF
    H, W = trees.shape
    out = None
    # деревья — как у Ленина; трава — отдельным проходом с маленьким HREF, потом склейка по маске
    tr = np.where(np.isin(trees, grass_ids), 0, trees)
    gr = np.where(np.isin(trees, grass_ids), trees, 0)
    sway23.HREF = 260; A = sway23.fields(tr, max_px)
    sway23.HREF = 18;  B = sway23.fields(gr, max_px, 0.6)   # трава: макушка пучка — 0,6 размаха кроны
    sway23.HREF = old
    insA, insB = A[4], B[4]
    u = np.where(insB, B[0], A[0]); v = np.where(insB, B[1], A[1])
    hh = np.where(insA, A[2], np.where(insB, B[2], np.maximum(A[2], B[2])))
    ph = np.where(insA, A[3], np.where(insB, B[3], np.maximum(A[3], B[3])))
    return u, v, hh, ph, insA | insB

os.makedirs(PRE, exist_ok=True)
for name, sp in TREES.items():
    for sfx in ('_bg', '_bg_depth', '_building'):
        if not os.path.exists(f'{PRE}/{name}{sfx}.webp'):
            shutil.copy(f'{FD}/{name}{sfx}.webp', f'{PRE}/{name}{sfx}.webp')
    rgb = np.asarray(Image.open(f'{FD}/{name}.webp').convert('RGB')).astype(int)
    H, W = rgb.shape[:2]
    hsv = np.asarray(Image.fromarray(rgb.astype(np.uint8)).convert('HSV')).astype(float)
    trees = np.zeros((H, W), np.int32)
    for k, poly in enumerate(sp['polys'], 1):
        im = Image.new('L', (W, H), 0); ImageDraw.Draw(im).polygon([(u * W, v * H) for u, v in poly], fill=255)
        pm = np.asarray(im) > 0
        if sp['kind'] == 'ink':
            m = (rgb.mean(-1) < 120) & pm; m = ndi.binary_dilation(m, iterations=2) & pm
        else:
            m = green(hsv, 0.14) & pm; m = ndi.binary_closing(m, iterations=3) & pm
        lab, n = ndi.label(m)
        if n:
            sizes = ndi.sum(m, lab, range(1, n + 1)); keep = np.isin(lab, 1 + np.nonzero(sizes >= 60)[0]); trees[keep] = k
    # трава: зелёное ниже GRASS_V, вне крон; пучки ≥ 25 px, каждый — свой «объект» (своя фаза)
    rows = (np.arange(H) / H)[:, None] >= GRASS_V[name]
    g = green(hsv, 0.20) & rows & (trees == 0)
    g = ndi.binary_closing(g, iterations=2) & rows & (trees == 0)
    lab, n = ndi.label(g)
    gid = []
    if n:
        sizes = ndi.sum(g, lab, range(1, n + 1))
        k0 = int(trees.max())
        for j in np.nonzero(sizes >= 25)[0]:
            k0 += 1; trees[lab == j + 1] = k0; gid.append(k0)
    u, v, hh, ph, inside = fields_mixed(trees, gid, MAXPX)
    cm = ndi.binary_dilation(inside, iterations=1)
    bg = np.asarray(Image.open(f'{PRE}/{name}_bg.webp').convert('RGB')).copy(); bg[cm] = rgb[cm]
    bd = np.asarray(Image.open(f'{PRE}/{name}_bg_depth.webp').convert('RGB')).copy(); dd = np.asarray(Image.open(f'{FD}/{name}_depth.webp').convert('RGB')); bd[cm] = dd[cm]
    bl = np.asarray(Image.open(f'{PRE}/{name}_building.webp').convert('RGBA')).copy(); bl[cm, 3] = 0
    Image.fromarray(bg.astype(np.uint8)).save(f'{FD}/{name}_bg.webp', quality=92)
    Image.fromarray(bd).save(f'{FD}/{name}_bg_depth.webp', quality=92)
    Image.fromarray(bl).save(f'{FD}/{name}_building.webp', quality=92)
    U, V, Hh, P = [np.clip(np.round(half(x) * 255), 0, 255).astype(np.uint8) for x in (u, v, hh, ph)]
    out = np.concatenate([np.dstack([U, V, Hh]), np.dstack([P, np.zeros_like(P), np.zeros_like(P)])], 0)
    Image.fromarray(out).save(f'{FD}/{name}_sway.png', optimize=True)
    for sfx in ('_bg.webp', '_bg_depth.webp', '_building.webp', '_sway.png'):
        shutil.copy(f'{FD}/{name}{sfx}', f'{TD}/{name}{sfx}')
    viz = (rgb * 0.6).astype(np.uint8); viz[inside & ~np.isin(trees, gid)] = [255, 60, 60]; viz[np.isin(trees, gid) & inside] = [60, 140, 255]
    Image.fromarray(viz).resize((W // 2, H // 2)).save(f'pogos-petros/build/report/s8/sway_{name}.jpg', quality=80)
    print(name, 'деревья', int(trees.max()) - len(gid), 'пучки травы', len(gid), 'px', int(inside.sum()), 'h max', round(float(hh.max()), 2))
