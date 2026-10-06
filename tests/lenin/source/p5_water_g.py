#!/usr/bin/env python3
"""Ленин G (lenin_6), 07.10.2026: вода в бассейне фонтана — ровная синяя акварель прямо в картинке (цвет и подложка).

Было: движок умножал синий поверх рисунка — штриховка воды проступала «узором» (отзыв Нарека). Теперь вода закрашивается в самом
кадре: маска — светлые серо-голубые пиксели внутри чаши (Lab b < 6, L > 150) с закрытыми дырами (штриховка внутри воды тоже закрашивается), карандашный край чаши в маску не входит; струи поверх рисует движок. Цвет — синий
с лёгким градиентом (светлее у дальнего края) и мягкой акварельной неровностью; 20 % исходной яркости оставлено, чтобы вода
не была плоской плашкой. Блики, рябь и струи рисует движок (fountains). Запуск после p4_saturate.py.
"""
from pathlib import Path
import numpy as np, cv2
from PIL import Image
from scipy import ndimage
F = Path(__file__).resolve().parent.parent / 'frames'
BOX = (0.50, 0.29, 0.89, 0.40)   # рамка поиска (u0, v0, u1, v1)
def water(rgb):
    H, W = rgb.shape[:2]; x0, y0, x1, y1 = int(BOX[0] * W), int(BOX[1] * H), int(BOX[2] * W), int(BOX[3] * H)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32); L, A, B = lab[..., 0], lab[..., 1] - 128, lab[..., 2] - 128
    m = np.zeros((H, W), bool); m[y0:y1, x0:x1] = True
    blue = m & (B < 6) & (L > 150)                         # вода на рисунке почти серо-голубая (b 1–3), бумага вокруг тёплая (b 11+)
    blue = ndimage.binary_opening(blue, iterations=1)
    lab_, k = ndimage.label(blue)
    if k > 1:
        sz = ndimage.sum(blue, lab_, range(1, k + 1)); blue = np.isin(lab_, 1 + np.nonzero(sz > 0.03 * sz.max())[0])
    blue = ndimage.binary_closing(blue, iterations=3)
    blue = ndimage.binary_fill_holes(blue)                # штриховка и рябь внутри воды — тоже вода (иначе «узор»)
    return blue   # струи рисует движок поверх (fountains.jets) — в картинке вода сплошная, без белых «окон»

def paint(rgb, mask):
    H, W = rgb.shape[:2]; ys, xs = np.nonzero(mask)
    y0, y1 = ys.min(), ys.max(); g = np.clip((np.arange(H) - y0) / max(1, y1 - y0), 0, 1)[:, None]
    top, bot = np.array([128, 182, 226], np.float32), np.array([86, 142, 200], np.float32)
    base = top + (bot - top) * g[..., None]
    rng = np.random.default_rng(7); nz = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 9); nz /= nz.std() + 1e-6
    base = base * (1 + 0.035 * nz[..., None])
    lum = rgb.astype(np.float32).mean(-1, keepdims=True); lm = ndimage.gaussian_filter(lum[..., 0], 6)[..., None]
    out = base + 0.2 * (lum - lm)
    a = ndimage.gaussian_filter(mask.astype(np.float32), 0.8)[..., None]
    return np.clip(rgb * (1 - a) + out * a, 0, 255).astype(np.uint8)
im = np.asarray(Image.open(F / 'lenin_6.webp').convert('RGB'))
mask = water(im)
for name in ('lenin_6.webp', 'lenin_6_bg.webp'):
    src = np.asarray(Image.open(F / name).convert('RGB'))
    Image.fromarray(paint(src, mask)).save(F / name, quality=90, method=6)
print('вода: %d px (%.2f %% кадра)' % (mask.sum(), 100 * mask.mean()))
