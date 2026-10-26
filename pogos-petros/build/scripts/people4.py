"""Заход 4: вписать людей из Gemini-правки кадра в полный рисунок (как урок: Gemini не правит кусок кадра — вписывает агент).
Берём только область, где правка Gemini отличается от исходника (люди + тень), в коробке box (доли кадра),
выравниваем цвет правки по исходнику вокруг (среднее в кольце), растушёвываем край. Пишем в frames/<L>.png
(старый — в frames/_rejected/<L>_pre4.png) и превью сравнения.
python3 pogos-petros/build/scripts/people4.py A <gemini_id> u0 v0 u1 v1
"""
import sys, shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
R = Path(__file__).resolve().parents[2]
L, gid = sys.argv[1], sys.argv[2]; u0, v0, u1, v1 = map(float, sys.argv[3:7])
src = R/'frames'/(L+'.png'); keep = R/'frames/_rejected'/(L+'_pre4.png')
if not keep.exists(): shutil.copyfile(src, keep)
o = np.asarray(Image.open(keep).convert('RGB')).astype(np.float32); H, W = o.shape[:2]
g = Image.open(R/'gemini/in'/('Gemini_Generated_Image_%s.jpeg' % gid)).convert('RGB')
gw, gh = g.size; h = round(gw * H / W)
if gh > h: g = g.crop((0, gh - h, gw, gh))
g = np.asarray(g.resize((W, H), Image.LANCZOS)).astype(np.float32)
x0, y0, x1, y1 = int(u0*W), int(v0*H), int(u1*W), int(v1*H)
box = np.zeros((H, W), bool); box[y0:y1, x0:x1] = True
d = ndimage.gaussian_filter(np.abs(g - o).mean(-1), 2.5)
m = (d > 22) & box
m = ndimage.binary_opening(m, iterations=2)
lab, n = ndimage.label(m)
if n:
    sz = ndimage.sum(m, lab, range(1, n+1)); m = np.isin(lab, 1 + np.nonzero(sz > 0.08 * sz.max())[0])
m = ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=6))
m = ndimage.binary_dilation(m, iterations=8)
ring = ndimage.binary_dilation(m, iterations=14) & ~m
gain = (o[ring].mean(0) + 1) / (g[ring].mean(0) + 1)   # цвет правки — к исходнику
gc = np.clip(g * gain, 0, 255)
a = ndimage.gaussian_filter(m.astype(np.float32), 4)[..., None]
out = o * (1 - a) + gc * a
Image.fromarray(out.astype(np.uint8)).save(src)
ys, xs = np.nonzero(m)
print(L, 'patch bbox u %.3f-%.3f v %.3f-%.3f' % (xs.min()/W, xs.max()/W, ys.min()/H, ys.max()/H), 'gain', np.round(gain, 3), 'px', int(m.sum()))
cx0, cy0, cx1, cy1 = max(0, xs.min()-200), max(0, ys.min()-200), min(W, xs.max()+200), min(H, ys.max()+200)
cmp = np.concatenate([o[cy0:cy1, cx0:cx1], np.full((cy1-cy0, 12, 3), 255), out[cy0:cy1, cx0:cx1]], 1)
(R/'build/report/s4clean').mkdir(parents=True, exist_ok=True)
Image.fromarray(cmp.astype(np.uint8)).save(R/'build/report/s4clean'/('people_%s.jpg' % L), quality=88)
np.save(R/'build/report/s4clean'/('people_%s_mask.npy' % L), m)
