"""Заход 4: перенести правку рисунка (люди A/C/F, небо D) в готовые слои движка без полной пересборки.
Область правки = маска из people4.py (report/s4clean/people_<L>_mask.npy) или --all (весь кадр, для неба D).
- pogos_x.webp: новый рисунок (ресайз полного кадра);
- слой здания: если правка лежит на здании (старая альфа > 0,5 рядом) — фигура входит в слой здания, подложка не трогается;
  иначе — фигура вписывается и в подложку (её видно при сдвиге);
- ночь: ночь = день × карта Gemini; карта (сглаженное отношение ночь/день старого кадра) умножается на новый день;
- снег: в области фигуры снега нет.
python3 pogos-petros/build/scripts/apply4.py a A   |   d D --all
"""
import sys, shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
B = Path(__file__).resolve().parents[1]; R = B.parent; T = R.parent/'tests/pogos-petros/frames'
k, L = sys.argv[1], sys.argv[2]; ALL = '--all' in sys.argv
fid = 'pogos_' + k; F = B/'frames'; K = B/'report/s4clean/pre'; K.mkdir(parents=True, exist_ok=True)
def ld(n, mode='RGB'): return np.asarray(Image.open(F/n).convert(mode)).astype(np.float32)
def keep(n):
    if not (K/n).exists(): shutil.copyfile(F/n, K/n)
for n in [fid+s for s in ('.webp', '_bg.webp', '_building.webp', '_night.webp', '_snow.webp')]:
    if (F/n).exists(): keep(n)
old = np.asarray(Image.open(K/(fid+'.webp')).convert('RGB')).astype(np.float32); H, W = old.shape[:2]
new = np.asarray(Image.open(R/'frames'/(L+'.png')).convert('RGB').resize((W, H), Image.LANCZOS)).astype(np.float32)
if ALL: m = np.ones((H, W), np.float32)
else:
    mb = np.load(B/'report/s4clean'/('people_%s_mask.npy' % L))
    m = np.asarray(Image.fromarray((mb*255).astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32)/255
    m = ndimage.gaussian_filter(m, 1.5)
m3 = m[..., None]
day = old*(1-m3) + new*m3
def save(arr, n, mode='RGB'):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode).save(F/n, quality=92)
    shutil.copyfile(F/n, T/n)
save(day, fid+'.webp')
# здание / подложка
bl = np.asarray(Image.open(K/(fid+'_building.webp')).convert('RGBA')).astype(np.float32)
a = bl[..., 3]/255
if not ALL:
    onb = a[m > 0.5].mean() > 0.3   # фигура целиком в одном слое: стоит на здании — в слое здания, иначе в подложке
    near = np.full(a.shape, bool(onb))
    on_bld = (m > 0.5) & near
    print(fid, 'figure on building %.0f%%' % (100*on_bld.sum()/max(1, (m > 0.5).sum())))
    ab = np.maximum(a, m * (near.astype(np.float32)))
    nb = bl.copy(); nb[..., :3] = bl[..., :3]*(1-m3) + new*m3; nb[..., 3] = ab*255
    save(nb, fid+'_building.webp', 'RGBA')
    off = m * (1 - near.astype(np.float32))
    bg = np.asarray(Image.open(K/(fid+'_bg.webp')).convert('RGB')).astype(np.float32)
    save(bg*(1-off[..., None]) + new*off[..., None], fid+'_bg.webp')
else:
    nb = bl.copy(); nb[..., :3] = np.where(a[..., None] > 0, new, bl[..., :3]); save(nb, fid+'_building.webp', 'RGBA')
# ночь
no = np.asarray(Image.open(K/(fid+'_night.webp')).convert('RGB')).astype(np.float32)
ratio = (ndimage.gaussian_filter(no, (9, 9, 0)) + 2) / (ndimage.gaussian_filter(old, (9, 9, 0)) + 2)
nn = no*(1-m3) + np.clip(day*ratio, 0, 255)*m3
save(nn, fid+'_night.webp')
if (F/(fid+'_snow.webp')).exists() and not ALL:
    sn = np.asarray(Image.open(K/(fid+'_snow.webp')).convert('RGB')).astype(np.float32)
    save(sn*(1-m3), fid+'_snow.webp')
print(fid, 'ok')
