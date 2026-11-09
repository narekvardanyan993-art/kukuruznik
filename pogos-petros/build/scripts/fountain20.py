#!/usr/bin/env python3
"""Заход 20: фонтан F зимой выключен и замёрз (отзыв: «фонтаны мультяшные, особенно зимой»).
show_wx_f_fountain_snow.png — кусок кадра F (rect FOUNTAIN_UV) из правки Gemini fountain_winter.jpeg (вход in_fountain_f.png =
F.png x600 y1830 936×527): лёд вместо воды, струй нет, снег по краю чаши. Альфа — только чаша и бортик (эллипс), мостовая — снег движка.
Струи/рябь (pix jet, ripple) в снег гасит движок (pix[].snowOff, e1.62). Повторный запуск даёт тот же результат."""
import sys, json
from pathlib import Path
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent)); import fix15
FR = Path('tests/pogos-petros/frames')
KIT = next(p for p in (Path.home() / 'Documents/chka-kitchen', Path.home() / 'mnt/chka-kitchen') if p.exists()); K = KIT / 'zhivost-v2/fountain'
G = np.array(Image.open(K / 'fountain_winter.jpeg').convert('RGB')); I = np.array(Image.open(K / 'in_fountain_f.png').convert('RGB'))
tm, cc, W = fix15.locate(G, I); g = fix15.warp_to(G, W, I.shape[1], I.shape[0])
FW, FH = 768, 1365; X0, Y0, S = 300, 915, 0.5          # окно in.png в кадре 768×1365 (пикселей кадра на пиксель in.png = 0,5)
u0, v0, u1, v1 = 0.40, 0.70, 1.0, 0.86                 # rect актёра в кадре
px0, py0, px1, py1 = int(u0 * FW), int(v0 * FH), int(u1 * FW), int(v1 * FH)
cx0, cy0, cx1, cy1 = int((px0 - X0) / S), int((py0 - Y0) / S), int((px1 - X0) / S), int((py1 - Y0) / S)
reg = g[cy0:cy1, cx0:cx1]; base = I[cy0:cy1, cx0:cx1]; h, w = reg.shape[:2]
# эллипс чаши с бортиком (в пикселях in.png): центр ~ (620, 300), полуоси ~ (590, 205)
em = np.zeros(I.shape[:2], np.uint8); cv2.ellipse(em, (650, 312), (600, 200), 0, 0, 360, 1, -1); em = em[cy0:cy1, cx0:cx1]
a = np.clip(cv2.GaussianBlur(em.astype(np.float32), (0, 0), 6), 0, 1)   # вся чаша с бортиком целиком из правки (бортик там почти тот же), мягкий край
out_w, out_h = px1 - px0, py1 - py0
rgba = np.dstack([cv2.resize(reg, (out_w * 2, out_h * 2), interpolation=cv2.INTER_AREA), (cv2.resize(a, (out_w * 2, out_h * 2)) * 255).astype(np.uint8)])
Image.fromarray(rgba).save(FR / 'show_wx_f_fountain_snow.png')
Image.fromarray(np.concatenate([base, reg, (np.dstack([a] * 3) * 255).astype(np.uint8)], 1)).save(Path('pogos-petros/build/report/s20/fountain_snow_check.jpg'), quality=82)
print('tm', round(tm, 3), 'ecc', round(cc, 3), 'rect', [u0, v0, u1, v1], 'cover', round(float((a > 0.5).mean()), 3))
