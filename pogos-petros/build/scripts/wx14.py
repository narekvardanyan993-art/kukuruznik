#!/usr/bin/env python3
"""Заход 14: погодная версия куска кадра (правка Gemini Pro по снимку вырезки) → show_wx_<имя>.png для актёра поз {wx: true}.
python3 pogos-petros/build/scripts/wx14.py <id Gemini> <кадр.webp> x0 y0 w u0 v0 u1 v1 <имя>
Совмещение — fix12.from_crop (ECC по контурам), вырезка — fix12.pose_png (цвет к кадру, альфа только по отличию, мягкий край)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
from PIL import Image
import fix12
a = sys.argv[1:]
gi, fname = a[0], a[1]; x0, y0, w = float(a[2]), float(a[3]), float(a[4]); rect = [float(x) for x in a[5:9]]; nm = a[9]
fr = np.array(Image.open(fix12.FR / fname).convert('RGB'))
full, cc = fix12.from_crop(np.array(Image.open(fix12.gid(gi)).convert('RGB')), fr, x0, y0, w)
print('ECC %.3f' % cc)
fix12.pose_png(full, fr, rect, fix12.FR / ('show_wx_%s.png' % nm))
im = np.array(Image.open(fix12.FR / ('show_wx_%s.png' % nm)))
print('show_wx_%s.png' % nm, im.shape, 'alpha>0.5: %.3f' % (im[..., 3] > 127).mean())
