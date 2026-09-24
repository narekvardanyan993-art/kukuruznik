#!/usr/bin/env python3
"""Маски окружения для ночи и ветра (v6). Запуск (после tools/build_frames.py):

  python3 tools/build_env_masks.py            # все кадры
  python3 tools/build_env_masks.py v_angle_2  # один кадр

Для каждого кадра <имя> в test-assets/frames/ пишет два файла:
  <имя>_env.png  — RGB: R = небо (там ставим звёзды, оно же темнее земли ночью),
                   G = «высота» дерева 0..255 (0 у корня, 255 на макушке — для ветра),
                   B = фаза дерева (у каждого дерева своя, 0 = не дерево).
  <имя>_win2.png — L: окна ДРУГИХ зданий (не башни) — их окна ночью светятся реже.

Как находим:
  небо   — гладкие светлые пиксели у верхнего края, далёкие по карте глубины (заливка от верха);
  деревья — то, что ближе «земли» по карте глубины (земля — 30-й перцентиль глубины в каждой строке),
            без башни и неба, без блоков с плоской крышей/заполненным прямоугольником (здания);
  окна    — тёмные пятна на фоне окружения внутри рамок WINDOW_BOXES (рамки — по глазам, в координатах кадра 768×1365).
Кадры без деревьев (или где маска захватывает статую) — в NO_WIND: ветер там отключён.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
FR = ROOT / 'test-assets' / 'frames'

# Кадры без ветра: на v_angle_4 «деревья» — сплошной лес и статуя, сегментация ненадёжна.
NO_WIND = {'v_angle_4'}

# Рамки (x0, y0, x1, y1) со зданиями, окна которых считаем. Подобраны по глазам.
WINDOW_BOXES = {
    'v_angle_0': [(0, 750, 260, 910)],
    'v_angle_2': [(490, 735, 768, 905)],
    'v_angle_4': [(300, 1270, 650, 1350), (420, 940, 700, 1050)],
    'v_angle_5': [(430, 1140, 768, 1240)],
}


def load(name):
    d = np.array(Image.open(FR / f'{name}_depth.png').convert('L')).astype(np.float32)
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    dn = np.clip((d - lo) / (hi - lo + 1e-6), 0, 1)
    col = np.array(Image.open(FR / f'{name}.png').convert('RGB')).astype(np.float32) / 255
    bld = np.array(Image.open(FR / f'{name}_building.png'))[..., 3] > 60
    return dn, col, bld


# Кадры, где небо с тёмной акварельной заливкой и контурами облаков (порог по текстуре 0.04 отрезал бы его
# на середине): порог мягче, а тонкие контуры облаков «склеиваем» закрытием. dn — порог по карте глубины.
SKY_PARAMS = {
    'v_angle_1': dict(std=0.05, dn=0.50, close=9),
    'v_angle_5': dict(std=0.05, dn=0.50, close=9),
}


def sky_mask(dn, col, name=''):
    prm = SKY_PARAMS.get(name, dict(std=0.04, dn=0.30, close=0))
    lum = col @ np.array([.299, .587, .114])
    m1 = ndimage.uniform_filter(lum, 7)
    m2 = ndimage.uniform_filter(lum * lum, 7)
    std = np.sqrt(np.maximum(m2 - m1 * m1, 0))
    cond = (std < prm['std']) & (lum > 0.5) & (dn < prm['dn'])
    if prm['close']:
        cond = ndimage.binary_closing(cond, structure=np.ones((prm['close'], prm['close'])), border_value=1)
    cond = ndimage.binary_opening(cond, iterations=1)
    lab, _ = ndimage.label(cond)
    top = set(np.unique(lab[0:4, :])) - {0}
    sky = np.isin(lab, list(top)) if top else np.zeros_like(cond)
    sky = ndimage.binary_fill_holes(sky)
    return ndimage.binary_opening(sky, structure=np.ones((5, 5)))


def tree_labels(dn, bld, sky, margin=0.07):
    dn = ndimage.gaussian_filter(dn, 1.5)
    g_row = ndimage.gaussian_filter1d(np.percentile(dn, 30, axis=1), 25)
    above = (dn - g_row[:, None]) > margin
    above &= ~ndimage.binary_dilation(bld, iterations=4)
    above &= ~ndimage.binary_dilation(sky, iterations=6)
    above = ndimage.binary_opening(above, structure=np.ones((3, 3)))
    above = ndimage.binary_closing(above, structure=np.ones((5, 5)))
    above = ndimage.binary_fill_holes(above)
    lab, k = ndimage.label(above)
    out = np.zeros(above.shape, np.int32)
    cnt = 0
    for i in range(1, k + 1):
        m = lab == i
        a = int(m.sum())
        if a < 350 or a > 45000:
            continue
        ys, xs = np.nonzero(m)
        w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        fill = a / (w * h)
        top = np.array([ys[xs == x].min() for x in range(xs.min(), xs.max() + 1) if (xs == x).any()])
        flat = (np.diff(top) == 0).mean() if len(top) > 3 else 0
        if fill < 0.84 and flat < 0.5:  # не здание: не прямоугольник и не плоская крыша
            cnt += 1
            out[m] = cnt
    return out


def other_windows(name, col, bld, sky):
    lum = (col @ np.array([.299, .587, .114]) * 255).astype(np.float32)
    big = ndimage.uniform_filter(lum, 19)
    small = ndimage.uniform_filter(lum, 5)
    dark = ((big - small) / 255 > 0.05)
    box = np.zeros(dark.shape, bool)
    for x0, y0, x1, y1 in WINDOW_BOXES.get(name, []):
        box[y0:y1, x0:x1] = True
    cand = dark & box & ~ndimage.binary_dilation(bld, iterations=3) & ~sky
    lab, k = ndimage.label(ndimage.binary_closing(cand, structure=np.ones((3, 3))))
    out = np.zeros(dark.shape, np.float32)
    n = 0
    for i in range(1, k + 1):
        m = lab == i
        a = int(m.sum())
        if a < 18 or a > 900:
            continue
        ys, xs = np.nonzero(m)
        w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        if not (0.3 < w / h < 4.0) or a / (w * h) < 0.5:
            continue
        out[m] = 1
        n += 1
    return ndimage.gaussian_filter(out, 0.8), n


def build(name):
    dn, col, bld = load(name)
    sky = sky_mask(dn, col, name)
    H, W = sky.shape
    env = np.zeros((H, W, 3), np.float32)
    env[..., 0] = ndimage.gaussian_filter(sky.astype(np.float32), 1.5)
    ntrees = 0
    if name not in NO_WIND:
        lab = tree_labels(dn, bld, sky)
        ntrees = int(lab.max())
        hgt = np.zeros((H, W), np.float32)
        ph = np.zeros((H, W), np.float32)
        for i in range(1, ntrees + 1):
            m = lab == i
            ys, xs = np.nonzero(m)
            y0, y1 = ys.min(), ys.max()
            yy = np.arange(H, dtype=np.float32)[:, None]
            hf = np.clip((y1 - yy) / max(1, (y1 - y0)), 0, 1) ** 1.2  # корень неподвижен, макушка — на максимуме
            hgt = np.where(m, hf, hgt)
            ph = np.where(m, 0.1 + 0.9 * ((i * 0.6180339) % 1.0), ph)  # своя фаза у каждого дерева
        env[..., 1] = ndimage.gaussian_filter(hgt, 1.5)
        env[..., 2] = ph
    win2, nwin = other_windows(name, col, bld, sky)
    Image.fromarray((np.clip(env, 0, 1) * 255).astype(np.uint8)).save(FR / f'{name}_env.png')
    Image.fromarray((np.clip(win2, 0, 1) * 255).astype(np.uint8)).save(FR / f'{name}_win2.png')
    print(f'{name}: небо {sky.mean() * 100:.0f}%, деревьев {ntrees}, окон чужих зданий {nwin}')


def main():
    names = sys.argv[1:] or sorted(p.name[:-4] for p in FR.glob('v_angle_?.png'))
    for n in names:
        build(n)


if __name__ == '__main__':
    main()
