#!/usr/bin/env python3
"""s23: замер по настоящим снимкам Chrome (snap23.mjs wind): двигается ли то, что рядом с кронами.
   python3 ana23.py <run_dir> <crowns_dir> [--json out.json]
Для кадра: маска крон (crown_<имя>.png, 768×1365) переводится в пиксели экрана (map.json), кольцо 2..25 css px вокруг крон —
«соседи» (здания, небо, столбы). На каждом снимке бури сравнение с ref.png (тихо): пиксель «изменился», если разница > 28 после
размытия 1 px. Изменение в кольце, где на снимке НЕ зелень и не тёмный контур, — артефакт (размазанные соседи); зелень/контур — крона накрыла фон (норма).
artifact_persistent_px — пиксели кольца, «испорченные» в ≥ 20 % снимков (птицы, голуби, листья пролетают и сюда не попадают).
Сдвиг кроны — оптический поток тихо -> буря внутри крон, 95-й перцентиль |dx| (css px)."""
import sys, json, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import cv2

NAMES = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']

def screen_mask(m, mp, W=390, H=844):
    (ax, ay), (bx, by) = mp['a0'], mp['a1']
    out = np.zeros((H, W), np.float32)
    ys, xs = np.mgrid[0:H, 0:W]
    fx = (xs + 0.5 - ax) / (bx - ax) * m.shape[1]; fy = (ys + 0.5 - ay) / (by - ay) * m.shape[0]
    ok = (fx >= 0) & (fx < m.shape[1]) & (fy >= 0) & (fy < m.shape[0])
    out[ok] = m[fy[ok].astype(int), fx[ok].astype(int)]
    return out > 0.5

def green(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(float)
    h, s, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    return ((h > 40) & (h < 175) & (s > 0.14) & (v > 0.08)) | (v < 0.33)   # зелень кроны или её карандашный контур

def top_profile(im):
    """верхний край зелени по столбцам (css px): где кроны встречают небо/фон"""
    g = green(im)
    g = ndi.binary_opening(g, iterations=1)
    has = g.any(0)
    top = np.where(has, g.argmax(0), -1).astype(float)
    return top

def profile_shift(a, b, cs):
    """наибольший сдвиг (css px) окна 50 px силуэта макушек между тихим и бурей; окна — только там, где над кронами фон"""
    best = 0.0
    W = len(a)
    for x0 in range(0, W - 50, 25):
        sa, sb = a[x0:x0 + 50], b
        if (sa < 0).any() or np.ptp(sa) < 4: continue
        errs = []
        for d in range(-24, 25):
            if x0 + d < 0 or x0 + d + 50 > W: errs.append(1e9); continue
            sbb = sb[x0 + d:x0 + d + 50]
            errs.append(np.abs(sa - sbb).mean() if (sbb >= 0).all() else 1e9)
        d = int(np.argmin(errs)) - 24
        if errs[d + 24] < 2.5 and abs(d) > abs(best): best = float(d)
    return best

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('run'); ap.add_argument('crowns'); ap.add_argument('--json'); a = ap.parse_args()
    res = {}
    for fi, name in enumerate(NAMES):
        d = f'{a.run}/f{fi + 1}'
        try: mp = json.load(open(f'{d}/map.json'))
        except FileNotFoundError: continue
        cm = np.array(Image.open(f'{a.crowns}/crown_{name}.png')) > 127
        cs = screen_mask(cm, mp)
        ring = ndi.binary_dilation(cs, iterations=25) & ~ndi.binary_dilation(cs, iterations=2)
        ref = np.array(Image.open(f'{d}/ref.png').convert('RGB'))
        rb = cv2.GaussianBlur(ref, (3, 3), 0).astype(int)
        ys = np.nonzero(cs.any(1))[0]
        band = (ys.min(), ys.min() + max(8, (ys.max() - ys.min()) // 2)) if len(ys) else None
        worst, worst_i, shifts, greens = 0, -1, [], 0
        freq = np.zeros(cs.shape, np.float32); nshot = 0
        pref = top_profile(ref)
        for i in range(100):
            try: im = np.array(Image.open(f'{d}/{i:03d}.png').convert('RGB'))
            except FileNotFoundError: break
            ch = (np.abs(cv2.GaussianBlur(im, (3, 3), 0).astype(int) - rb).max(-1) > 28)
            gi = green(im); ng = ch & ring & ~gi & ~ndi.binary_dilation(ch & gi, iterations=2); freq += ng; nshot += 1   # кайма у сдвинутого края кроны (смесь кроны и фона, 1–2 px) — не артефакт
            art = int(ng.sum()); gr = int((ch & ring & gi).sum())
            if art > worst: worst, worst_i = art, i
            greens = max(greens, gr)
            if i % 3 == 0:   # сдвиг кроны: плотный оптический поток тихо -> буря внутри крон (css px), 95-й перцентиль |dx|
                fl = cv2.calcOpticalFlowFarneback(cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY), cv2.cvtColor(im, cv2.COLOR_RGB2GRAY), None, 0.5, 4, 21, 5, 7, 1.5, 0)
                dx = fl[..., 0][ndi.binary_dilation(cs, iterations=6)]
                shifts.append(round(float(np.percentile(np.abs(dx), 95)), 1) if dx.size else 0.0)
        persist = int((freq >= 0.2 * max(1, nshot)).sum())   # меняется в ≥ 20 % снимков — размазня на месте; птицы, голуби, листья пролетают
        res[name] = {'ring_px': int(ring.sum()), 'artifact_persistent_px': persist, 'artifact_px_max': worst, 'artifact_frac_max': round(worst / max(1, ring.sum()), 4), 'worst_shot': worst_i,
                     'crown_cover_px_max': greens, 'crown_shift_css_px_maxabs': max([abs(s) for s in shifts] or [0]), 'crown_shift_series': shifts[::3]}
        print(name, res[name])
    if a.json: json.dump(res, open(a.json, 'w'), indent=1)

if __name__ == "__main__":
    main()
