#!/usr/bin/env python3
"""Белые края бумаги/акварели: обрезка + заливка (каждый кадр, день / закат / ночь).

  python3 tools/find_edges.py            # печатает CROP для CONFIG (test-assets/depth.html), картинки не трогает
  python3 tools/find_edges.py --fix      # то же + закрашивает остатки белого края во всех картинках кадра

Как:
  1. На ночной и закатной картинках (там небо тёмное/цветное, бумага — светлая) ищем светлые нейтральные пиксели, связанные с
     краем кадра. Глубина такого края с каждой стороны (90-й перцентиль по строкам/столбцам, только в центральной части)
     + запас 8 px — это обрезка. Она берётся с теми же пропорциями, что и кадр (квадратный запас: наибольшая сторона), чтобы
     картинка не растягивалась; при отрисовке её ещё ужимает BASE_SCALE 1.05 и сдвиг, поэтому края не видны даже при наклоне.
  2. Остатки (рваные «зубцы» глубже обрезки) при --fix закрашиваются цветом ближайших живых пикселей (небо продолжается до края):
     во всех картинках кадра одинаково — день, закат, ночь, — чтобы при растворении друг в друга краёв не появлялось.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
FR = ROOT / 'test-assets' / 'frames'
MARGIN = 8  # px запаса (кадр 768×1365)
CAP = 0.075  # обрезка с одной стороны не больше 7.5%


def paper_mask(path):
    a = np.array(Image.open(path).convert('RGB')).astype(int)
    mn = a.min(axis=2); sat = a.max(axis=2) - mn
    paper = (mn > 205) & (sat < 45)
    lab, _ = ndimage.label(paper)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(border))


def runs(m):
    d = []
    for row in m:
        idx = np.nonzero(~row)[0]
        d.append(int(idx[0]) if len(idx) else len(row))
    return np.array(d)


def frame_masks(i):
    ms = [paper_mask(FR / f'v_angle_{i}_{st}.png') for st in ('night', 'sunset') if (FR / f'v_angle_{i}_{st}.png').exists()]
    return np.logical_or.reduce(ms) if ms else None


def crop_for(m):
    H, W = m.shape
    bh, bw = slice(int(H * 0.1), int(H * 0.9)), slice(int(W * 0.1), int(W * 0.9))   # без углов
    d = {
        'L': runs(m[bh, :]), 'R': runs(m[bh, ::-1]),
        'T': runs(m[:, bw].T), 'B': runs(m[:, bw].T[:, ::-1])
    }
    res = {}
    for k, v in d.items():
        dim = W if k in 'LR' else H
        x = float(np.percentile(v, 90))
        res[k] = min(CAP, (x + MARGIN) / dim if x > 0 else 0)
    l, r, t, b = res['L'], res['R'], res['T'], res['B']
    w, h = 1 - l - r, 1 - t - b
    f = min(w, h)
    x0 = l + (w - f) / 2; y0 = t + (h - f) / 2
    return [round(x0, 4), round(y0, 4), round(x0 + f, 4), round(y0 + f, 4)], res


def fill(img_path, m):
    a = np.array(Image.open(img_path).convert('RGB')).astype(np.float32)
    mm = ndimage.binary_dilation(m, iterations=4)
    idx = ndimage.distance_transform_edt(mm, return_distances=False, return_indices=True)
    f = a[idx[0], idx[1]]
    # мягко сглаживаем закрашенное, чтобы не было полос
    fb = np.stack([ndimage.gaussian_filter(f[..., c], 5) for c in range(3)], -1)
    out = np.where(mm[..., None], fb, a)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(img_path, optimize=True)


def main():
    fix = '--fix' in sys.argv
    crops = []
    for i in range(6):
        m = frame_masks(i)
        if m is None:
            crops.append([0.0, 0.0, 1.0, 1.0]); continue
        c, res = crop_for(m)
        crops.append(c)
        rest = m.copy()
        H, W = m.shape
        x0, y0, x1, y1 = int(c[0] * W), int(c[1] * H), int(c[2] * W), int(c[3] * H)
        inside = np.zeros_like(m); inside[y0:y1, x0:x1] = True
        left = (m & inside).sum() / inside.sum()
        print(f'кадр {i + 1}: края L{res["L"]*100:.1f}% R{res["R"]*100:.1f}% T{res["T"]*100:.1f}% B{res["B"]*100:.1f}% -> обрезка {c} '
              f'(масштаб ×{1 / (c[2] - c[0]):.3f}), остаток бумаги внутри обрезки {left*100:.2f}%')
        if fix:
            for st in ('', '_sunset', '_night', '_bg'):
                p = FR / f'v_angle_{i}{st}.png'
                if p.exists():
                    fill(p, m)
    print('CROP:', json.dumps(crops))


if __name__ == '__main__':
    main()
