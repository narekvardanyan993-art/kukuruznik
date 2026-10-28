#!/usr/bin/env python3
"""Заход 8: убрать стоящую женщину из C (решение Нарека: статичных стоящих людей нет). Обратное apply4.py:
в области фигуры (report/s4clean/people_C_mask.npy, + 4 px) вернуть пиксели «до захода 4» (report/s4clean/pre/, frames/_rejected/C_pre4.png)
в кадр, слой здания (цвет и альфа), подложку, ночь и снег. Остальной кадр (чистка ореолов clean4, кроны sway8) не трогается.
python3 pogos-petros/build/scripts/unperson8.py    (из корня репо)"""
import shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
B = Path('pogos-petros/build'); F = B/'frames'; K = B/'report/s4clean/pre'; T = Path('tests/pogos-petros/frames'); S8 = B/'report/s8/pre'
fid = 'pogos_c'
mb = np.load(B/'report/s4clean/people_C_mask.npy')
mb = ndimage.binary_dilation(mb, iterations=8)                      # 8 px полного кадра ≈ 4 px слоя
def mask(W, H):
    m = np.asarray(Image.fromarray((mb*255).astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32)/255
    return ndimage.gaussian_filter(m, 1.5)[..., None]
def fix(cur_path, pre_path, mode):
    cur = Image.open(cur_path).convert(mode); pre = Image.open(pre_path).convert(mode)
    c = np.asarray(cur).astype(np.float32); p = np.asarray(pre).astype(np.float32); m = mask(cur.size[0], cur.size[1])
    out = c*(1-m) + p*m
    if mode == 'RGBA':   # альфа: где на «до» здания не было — прозрачно (фигура стояла в слое здания)
        out[..., 3] = c[..., 3]*(1-m[..., 0]) + p[..., 3]*m[..., 0]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode)
for sfx, mode in (('.webp', 'RGB'), ('_building.webp', 'RGBA'), ('_bg.webp', 'RGB'), ('_night.webp', 'RGB'), ('_snow.webp', 'RGB')):
    n = fid + sfx
    im = fix(F/n, K/n, mode); im.save(F/n, quality=92); shutil.copyfile(F/n, T/n)
    if (S8/n).exists(): fix(S8/n, K/n, mode).save(S8/n, quality=92)   # исходники sway8.py — тоже без фигуры
    print(n, 'ok')
src = Path('pogos-petros/frames/C.png'); old = Path('pogos-petros/frames/_rejected/C_pre4.png')
c = np.asarray(Image.open(src).convert('RGB')).astype(np.float32); p = np.asarray(Image.open(old).convert('RGB').resize(Image.open(src).size)).astype(np.float32)
m = ndimage.gaussian_filter(mb.astype(np.float32), 2)[..., None]
Image.fromarray(np.clip(c*(1-m) + p*m, 0, 255).astype(np.uint8)).save(src)
print('C.png ok')
