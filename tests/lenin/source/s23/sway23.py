#!/usr/bin/env python3
"""s23: поля качания крон для движка e1.26 (look.gusts.swayMaxPx + frames[].sway) -> frames/<кадр>_sway.png.
   python3 sway23.py <crowns_dir> <frames_dir> [--max-px 18] [--viz out_dir]
Крона больше не «сдвигает выборку» по маске (так фон — небо, дома, столбы — затягивало в крону и размазывало, s23/cause.md).
Каждая строка кроны каждого дерева — отрезок [x0, x1]. Порыв ВПРАВО: левый (наветренный) край отрезка стоит, правый уходит
на A и накрывает фон; ВЛЕВО — наоборот. Фон рядом с кроной не двигается никогда: он либо виден как есть, либо закрыт кроной.
Файл — PNG без потерь, вдвое мельче кадра (как карта окружения), высота ×2:
  верх  R = u = (x - x0)/W, G = v = (x1 - x)/W внутри отрезка; вне кроны u = v = 1;  B = высота h (0 корень .. 1 макушка),
        протянута по горизонтали на REACH px в промежутки (чтобы соседний отрезок «нашёл» своё дерево);
  низ   R = фаза дерева (протянута так же).
h = (низ кроны - y) / max(высота кроны, HREF): мелкие далёкие деревья качаются меньше. В узких строках (макушка) h ограничен,
чтобы растяжение не превышало ~60 % ширины строки (движок решает растяжение итерациями, при большем — не сходится)."""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

FR = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']
HREF = 260      # px кадра: дерево ниже — качается пропорционально меньше
REACH = 44      # px кадра: насколько далеко крона может накрыть фон (> максимального сдвига)
GAMMA = 1.0
K_FRAME = {'lenin_2': 0.55, 'lenin_6': 0.55}   # виды сверху: деревья видны сверху — качание меньше

def fields(trees, max_px, kf=1.0):
    H, W = trees.shape
    u = np.ones((H, W), np.float32); v = np.ones((H, W), np.float32)
    h = np.zeros((H, W), np.float32); ph = np.zeros((H, W), np.float32)
    rng = np.random.default_rng(23)
    phases = {}
    objs = ndi.find_objects(trees)
    for k, sl in enumerate(objs, start=1):
        if sl is None: continue
        mk = trees[sl] == k
        ys = np.nonzero(mk.any(1))[0]
        y_top, y_bot = sl[0].start + ys.min(), sl[0].start + ys.max()
        href = max(y_bot - y_top, HREF)
        phases[k] = 0.1 + 0.9 * rng.random()
        caps = {}
        for yy in range(mk.shape[0]):
            row = mk[yy]
            if not row.any(): continue
            y = sl[0].start + yy
            xs = np.nonzero(row)[0] + sl[1].start
            # отрезки строки (у вогнутой кроны их может быть несколько)
            br = np.nonzero(np.diff(xs) > 1)[0]
            starts = np.r_[xs[0], xs[br + 1]]; ends = np.r_[xs[br], xs[-1]]
            hy = kf * min(1.0, max(0.0, (y_bot - y) / href)) ** GAMMA
            for x0, x1 in zip(starts, ends):
                wd = x1 - x0 + 1
                xx = np.arange(x0, x1 + 1)
                u[y, x0:x1 + 1] = (xx - x0 + 0.5) / wd
                v[y, x0:x1 + 1] = (x1 - xx + 0.5) / wd
                cap = 0.6 * wd / max_px    # растяжение ≤ 60 % строки при полном сдвиге
                h[y, x0:x1 + 1] = min(hy, cap)
            ph[y, xs] = phases[k]
    # протянуть h и фазу в промежутки (только вне крон), ближайшее дерево по строке
    inside = (u + v) < 1.5
    idx = ndi.distance_transform_edt(~inside, return_distances=False, return_indices=True, sampling=[50.0, 1.0])
    dist = np.abs(idx[1] - np.arange(W)[None, :])
    hd = np.where(inside, h, np.where(dist <= REACH, h[idx[0], idx[1]], 0))
    pd = np.where(inside, ph, np.where(dist <= REACH, ph[idx[0], idx[1]], 0))
    return u, v, hd, pd, inside

def half(a):
    H, W = a.shape
    a = np.pad(a, ((0, H % 2), (0, W % 2)), mode='edge')
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('crowns'); ap.add_argument('frames'); ap.add_argument('--max-px', type=float, default=18); ap.add_argument('--viz')
    a = ap.parse_args()
    for name in FR:
        trees = np.load(f'{a.crowns}/trees_{name}.npy')
        u, v, h, ph, inside = fields(trees, a.max_px, K_FRAME.get(name, 1.0))
        U, V, Hh, P = [np.clip(np.round(half(x) * 255), 0, 255).astype(np.uint8) for x in (u, v, h, ph)]
        top = np.dstack([U, V, Hh]); bot = np.dstack([P, np.zeros_like(P), np.zeros_like(P)])
        Image.fromarray(np.concatenate([top, bot], 0)).save(f'{a.frames}/{name}_sway.png', optimize=True)
        if a.viz:
            vz = np.dstack([u * 255 * inside, v * 255 * inside, h * 255]).astype(np.uint8)
            Image.fromarray(vz).save(f'{a.viz}/sway_{name}.png')
        print(name, 'trees', int(trees.max()), 'crown px', int(inside.sum()), 'h max', round(float(h.max()), 2), 'size', top.shape)

if __name__ == "__main__":
    main()
