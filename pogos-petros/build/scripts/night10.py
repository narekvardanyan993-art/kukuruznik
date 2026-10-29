#!/usr/bin/env python3
"""Заход 10 (30.10.2026): ночь и закат = сам рисунок Gemini (правка кадра «тот же кадр ночью»), а не «день × размытая карта».
Картинка Gemini (полный размер, 1536×2752) совмещается с дневным слоем кадра по контурам (масштаб 0,9–1,1 по x и y, сдвиг —
cv2.matchTemplate на 1/4 и 1/2), переводится в его координаты на полном размере и уменьшается до 768×1365 (Lanczos).
Пиксели Gemini не дорисовываются: только сдвиг/масштаб (края — повтором крайних пикселей).
Проверка: сетка 4×6 клеток — остаточный сдвиг каждой клетки (px кадра 768) по контурам; печатается максимум.
Из корня репо:
  python3 pogos-petros/build/scripts/night10.py <кадр a..f> <картинка Gemini> night|sunset
  → tests/pogos-petros/frames/pogos_<кадр>_<night|sunset>.webp (+ копия pogos-petros/build/frames/)"""
import sys, shutil, numpy as np, cv2
from pathlib import Path
from PIL import Image

fr, src, kind = sys.argv[1], Path(sys.argv[2]), sys.argv[3]
T = Path('tests/pogos-petros/frames'); B = Path('pogos-petros/build/frames')
day = np.asarray(Image.open(T / ('pogos_%s.webp' % fr)).convert('RGB')); H, W = day.shape[:2]
full = Image.open(src).convert('RGB'); FW, FH = full.size
gem = np.asarray(full.resize((W, H), Image.LANCZOS))


def edges(a, k):
    g = cv2.resize(cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32), None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    g = cv2.GaussianBlur(g, (0, 0), 1.2); gx = cv2.Sobel(g, cv2.CV_32F, 1, 0); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1)
    m = np.sqrt(gx * gx + gy * gy)
    return m / (np.percentile(m, 99) + 1e-3)   # ночь темнее — контуры к одной шкале


def best_for(k, sxs, sys_, pad):
    ed = edges(day, k); h, w = ed.shape; eg0 = edges(gem, k); best = (-2, None)
    big = cv2.copyMakeBorder(ed, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
    for sx in sxs:
        for sy in sys_:
            eg = cv2.resize(eg0, (int(round(w * sx)), int(round(h * sy))))
            mh, mw = int(eg.shape[0] * 0.12), int(eg.shape[1] * 0.08)
            t = eg[mh:-mh, mw:-mw]
            r = cv2.matchTemplate(big, t, cv2.TM_CCOEFF_NORMED); _, mv, _, ml = cv2.minMaxLoc(r)
            if mv > best[0]:
                best = (mv, (sx, sy, (ml[0] - pad - mw) / k, (ml[1] - pad - mh) / k))
    return best


b1 = best_for(0.25, np.arange(0.90, 1.105, 0.01), np.arange(0.90, 1.105, 0.01), 60)
s0 = b1[1]
b2 = best_for(0.5, np.arange(s0[0] - 0.012, s0[0] + 0.013, 0.003), np.arange(s0[1] - 0.012, s0[1] + 0.013, 0.003), 90)
sx, sy, ox, oy = b2[1]
# тот же перенос на полном размере: кадр 2×, картинка Gemini — в своём размере
k2 = 2.0; fx, fy = W * k2 / FW, H * k2 / FH
M = np.float32([[sx * fx, 0, ox * k2], [0, sy * fy, oy * k2]])
big = cv2.warpAffine(np.asarray(full), M, (int(W * k2), int(H * k2)), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
out = Image.fromarray(big).resize((W, H), Image.LANCZOS)
# остаточный сдвиг по клеткам
oa = np.asarray(out); ed, eo = edges(day, 1.0), edges(oa, 1.0); worst = 0.0; cells = []
for j in range(6):
    for i in range(4):
        y0, y1, x0, x1 = j * H // 6, (j + 1) * H // 6, i * W // 4, (i + 1) * W // 4
        a, b = ed[y0:y1, x0:x1], eo[y0:y1, x0:x1]
        if a.std() < 0.02 or b.std() < 0.02: continue
        (dx, dy), resp = cv2.phaseCorrelate(a.astype(np.float64), b.astype(np.float64))
        if resp > 0.08: cells.append((i, j, round(dx, 1), round(dy, 1))); worst = max(worst, abs(dx), abs(dy))
name = 'pogos_%s_%s.webp' % (fr, kind)
out.save(T / name, quality=90, method=6)
if B.exists(): shutil.copyfile(T / name, B / name)
print('%s %s: match %.3f/%.3f scale %.3f/%.3f offset %.1f,%.1f px; cells %d, worst residual %.1f px' % (name, src.name, b1[0], b2[0], sx, sy, ox, oy, len(cells), worst))
print(' '.join('%d%d:%+.0f%+.0f' % c for c in cells))
