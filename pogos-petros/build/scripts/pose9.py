#!/usr/bin/env python3
"""Заход 9: позы фигур из Gemini-правок вырезки кадра (Flash, «Создание изображений», 1:1).
Вырезка кадра (gemini/up/<name>_crop9.png, квадрат в координатах 1536-рисунка) → Gemini меняет позу → здесь:
  1) ответ Gemini → размер вырезки, совмещение со сдвигом ±40 px (фазовая корреляция по контурам) + выравнивание цвета по фону;
  2) маска позы = где ответ отличается от вырезки (в рамке актёра), закрыта, растушёвана; вне рамки — ничего;
  3) RGBA-кусок размера рамки актёра в масштабе кадра движка (768) → tests/pogos-petros/frames/show_pose_<имя>.png.
  python3 pogos-petros/build/scripts/pose9.py <кадр A|F0> <x0,y0,x1,y1 вырезки в 1536-px> <gemini_id> <рамка актёра u0,v0,u1,v1> <имя> [--thr 28]
Проверка: gemini/poses/<имя>_check.jpg (вырезка | ответ совмещённый | маска | кусок поверх кадра)."""
import sys, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
R = Path('pogos-petros'); T = Path('tests/pogos-petros/frames')
L, cr, gid, rect, name = sys.argv[1], [int(v) for v in sys.argv[2].split(',')], sys.argv[3], [float(v) for v in sys.argv[4].split(',')], sys.argv[5]
thr = float(sys.argv[sys.argv.index('--thr') + 1]) if '--thr' in sys.argv else 28.0
full = Image.open(R/'frames'/(L + '.png')).convert('RGB'); FW, FH = full.size
crop = np.asarray(full.crop(cr)).astype(np.float32); ch, cw = crop.shape[:2]
g = np.asarray(Image.open(R/'gemini/in'/('Gemini_Generated_Image_%s.jpeg' % gid)).convert('RGB').resize((cw, ch), Image.LANCZOS)).astype(np.float32)
def ed(a):
    x = cv2.GaussianBlur(cv2.cvtColor(a.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32), (0, 0), 1.5)
    return np.hypot(cv2.Sobel(x, cv2.CV_32F, 1, 0), cv2.Sobel(x, cv2.CV_32F, 0, 1))
win = np.outer(np.hanning(ch), np.hanning(cw)).astype(np.float32)
(dx, dy), resp = cv2.phaseCorrelate(ed(crop) * win, ed(g) * win)
M = np.float32([[1, 0, -dx], [0, 1, -dy]])
g = cv2.warpAffine(g, M, (cw, ch), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
# рамка актёра в координатах вырезки
ax0, ay0 = int(rect[0] * FW) - cr[0], int(rect[1] * FH) - cr[1]; ax1, ay1 = int(rect[2] * FW) - cr[0], int(rect[3] * FH) - cr[1]
box = np.zeros((ch, cw), bool); box[max(0, ay0):ay1, max(0, ax0):ax1] = True
# цвет: линейная поправка по каналам по пикселям вне рамки (там Gemini «ничего не менял»)
for c in range(3):
    A = np.stack([g[..., c][~box], np.ones((~box).sum())], 1); k = np.linalg.lstsq(A, crop[..., c][~box], rcond=None)[0]
    g[..., c] = g[..., c] * k[0] + k[1]
g = np.clip(g, 0, 255)
d = ndimage.gaussian_filter(np.abs(g - crop).mean(-1), 2.0)
m = (d > thr) & box
m = ndimage.binary_closing(m, iterations=6); m = ndimage.binary_fill_holes(m)
lab, n = ndimage.label(m)
if n > 1:
    sz = ndimage.sum(m, lab, range(1, n + 1)); m = np.isin(lab, 1 + np.nonzero(sz > 0.15 * sz.max())[0])
m = ndimage.binary_dilation(m, iterations=6) & box
a = ndimage.gaussian_filter(m.astype(np.float32), 3.0) * ndimage.gaussian_filter(box.astype(np.float32), 2.0)
out_bg = np.abs(g - crop).mean(-1)[~box].mean()
# кусок рамки актёра в масштабе кадра движка (768)
s = 768 / FW
patch = np.dstack([g, a * 255])[max(0, ay0):ay1, max(0, ax0):ax1].astype(np.uint8)
pw, ph = round((ax1 - max(0, ax0)) * s), round((ay1 - max(0, ay0)) * s)
P = Image.fromarray(patch, 'RGBA').resize((pw, ph), Image.LANCZOS); P.save(T/('show_pose_%s.png' % name), optimize=True)
(R/'gemini/poses').mkdir(exist_ok=True); P.save(R/'gemini/poses'/('%s.png' % name))
comp = crop * (1 - a[..., None]) + g * a[..., None]
mv = np.dstack([m * 255] * 3)
chk = np.concatenate([crop, g, mv, comp], 1).astype(np.uint8)
Image.fromarray(chk).resize((chk.shape[1] // 2, chk.shape[0] // 2)).save(R/'gemini/poses'/('%s_check.jpg' % name), quality=85)
print('%s: сдвиг %.1f,%.1f px (resp %.2f), фон вне рамки отличается на %.1f, маска %.1f%% рамки, кусок %dx%d' % (name, dx, dy, resp, out_bg, 100 * m.sum() / max(1, box.sum()), pw, ph))
