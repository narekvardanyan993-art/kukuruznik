#!/usr/bin/env python3
"""Шаг 4, заход 3: поля качания крон A (голое дерево у руин) и B (два тополя) — маска руками по рамке + рисунок,
дальше — те же поля, что у Ленина (tests/lenin/source/s23/sway23.py fields). Из корня репо:
  python3 pogos-petros/build/scripts/life3.py   → pogos-petros/build/frames/pogos_{a,b}_sway.png (+ копия в tests/pogos-petros/frames)
A: крона = тёмные штрихи веток внутри многоугольника (ветки соединены dilate 2); B: зелёное внутри рамок двух тополей."""
import sys, shutil
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
sys.path.insert(0, 'tests/lenin/source/s23')
from sway23 import fields, half

FD = 'pogos-petros/build/frames'
SPEC = {
    'pogos_a': {'polys': [[(0.79, 0.555), (1.0, 0.555), (1.0, 0.70), (0.935, 0.765), (0.875, 0.765), (0.79, 0.70)]], 'kind': 'ink'},
    'pogos_c': {'polys': [[(0.0, 0.47), (0.26, 0.47), (0.26, 0.70), (0.12, 0.725), (0.0, 0.725)]], 'kind': 'green'},
    'pogos_b': {'polys': [[(0.0, 0.43), (0.068, 0.43), (0.068, 0.70), (0.0, 0.70)], [(0.068, 0.46), (0.135, 0.46), (0.135, 0.70), (0.068, 0.70)]], 'kind': 'green'},
}
for name, sp in SPEC.items():
    rgb = np.asarray(Image.open(f'{FD}/{name}.webp').convert('RGB')).astype(int)
    H, W = rgb.shape[:2]
    bld = np.asarray(Image.open(f'{FD}/{name}_building.webp').convert('RGBA'))[..., 3] > 60
    hsv = np.asarray(Image.fromarray(rgb.astype(np.uint8)).convert('HSV')).astype(float)
    trees = np.zeros((H, W), np.int32)
    for k, poly in enumerate(sp['polys'], 1):
        im = Image.new('L', (W, H), 0); ImageDraw.Draw(im).polygon([(u * W, v * H) for u, v in poly], fill=255)
        pm = np.asarray(im) > 0
        if sp['kind'] == 'ink':
            L = rgb.mean(-1); m = (L < 120) & pm
            m = ndi.binary_dilation(m, iterations=2) & pm
        else:
            h, s, v = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
            m = (h > 40) & (h < 175) & (s > 0.14) & (v > 0.08) & pm
            m = ndi.binary_closing(m, iterations=3) & pm
        lab, n = ndi.label(m)
        if n:
            sizes = ndi.sum(m, lab, range(1, n + 1)); keep = np.isin(lab, 1 + np.nonzero(sizes >= 60)[0])
            trees[keep] = k
    u, v, hh, ph, inside = fields(trees, 28)
    # крона почти вся в слое здания (вырезка по «кадр − подложка» захватила дерево), а качается только подложка:
    # крону — в подложку (цвет и глубина рисунка), из слоя здания — прочь. Ночь — общая картинка кадра, её не трогаем.
    cm = ndi.binary_dilation(inside, iterations=1)
    bg = np.asarray(Image.open(f'{FD}/{name}_bg.webp').convert('RGB')).copy(); bg[cm] = rgb[cm]
    Image.fromarray(bg.astype(np.uint8)).save(f'{FD}/{name}_bg.webp', quality=92)
    bd = np.asarray(Image.open(f'{FD}/{name}_bg_depth.webp').convert('RGB')).copy(); dd = np.asarray(Image.open(f'{FD}/{name}_depth.webp').convert('RGB'))
    bd[cm] = dd[cm]; Image.fromarray(bd).save(f'{FD}/{name}_bg_depth.webp', quality=92)
    bl = np.asarray(Image.open(f'{FD}/{name}_building.webp').convert('RGBA')).copy(); bl[cm, 3] = 0
    Image.fromarray(bl).save(f'{FD}/{name}_building.webp', quality=92)
    for sfx in ('_bg', '_bg_depth', '_building'):
        shutil.copy(f'{FD}/{name}{sfx}.webp', f'tests/pogos-petros/frames/{name}{sfx}.webp')
    U, V, Hh, P = [np.clip(np.round(half(x) * 255), 0, 255).astype(np.uint8) for x in (u, v, hh, ph)]
    out = np.concatenate([np.dstack([U, V, Hh]), np.dstack([P, np.zeros_like(P), np.zeros_like(P)])], 0)
    Image.fromarray(out).save(f'{FD}/{name}_sway.png', optimize=True)
    shutil.copy(f'{FD}/{name}_sway.png', f'tests/pogos-petros/frames/{name}_sway.png')
    viz = (rgb * 0.6).astype(np.uint8); viz[inside] = [255, 60, 60]
    Image.fromarray(viz).resize((W // 2, H // 2)).save(f'pogos-petros/build/report/sway_{name}.jpg', quality=80)
    print(name, 'trees', int(trees.max()), 'crown px', int(inside.sum()), 'h max', round(float(hh.max()), 2))
