#!/usr/bin/env python3
"""Ленин D (lenin_4), 06.10.2026: карта глубины для крупного плана без «плывущей» статуи.

Причина «плывёт»: фон рисуется по карте глубины КАДРА, где на месте статуи глубина статуи (0,5–0,9), а размытый край карты
(DEPTH_BLUR) даёт полосу промежуточной глубины вокруг силуэта — фон вокруг статуи растягивается и сжимается при наклоне,
статуя (жёстко на bldDepth) едет иначе, чем фон под своим краем. Плюс движок растягивает контраст карты (2–98 %), и
плоско её не сделать. Решение (движок e1.5, у кадра depthRaw: true — без растяжки):
  • фон: глубина подложки, сжатая в 0,33–0,37 (небо чуть дальше, кроны ближе — лёгкий объём, весь кадр едет почти одинаково);
  • статуя с постаментом: одна глубина BLD (= bldDepth кадра), только ВНУТРИ силуэта, сжатого на 14 px — переход размытия
    уходит под вырезку, снаружи силуэта фон ровный, без «дыхания».
Итог: статуя и постамент — один твёрдый предмет; относительно неба ≈ 6 px, относительно крон ≈ 3 px на крайнем наклоне
(было ≈ 21 px: огромная статуя «скользила» по небу как наклейка). Кадр почти плоский, но наклон всё ещё двигает его целиком.
Проверка 0,26 / 0,12–0,20 (06.10): статуя −16 px, небо −34 px — всё ещё «наклейка», поэтому ближе к 0,5.
"""
import numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage
S = Path(__file__).resolve().parent
BLD = 0.40
L = S / 'lenin_4' / 'layers'
a = np.asarray(Image.open(L / 'lenin_4_building.webp').convert('RGBA'))[..., 3] > 128
bd = np.asarray(Image.open(L / 'lenin_4_bg_depth.webp').convert('L')).astype(np.float32) / 255
lo, hi = np.percentile(bd, [2, 98]); n = np.clip((bd - lo) / (hi - lo + 1e-6), 0, 1)
d = 0.33 + 0.04 * ndimage.gaussian_filter(n, 6)
core = ndimage.binary_erosion(a, iterations=14)
d = np.where(core, BLD, d)
out = (np.clip(d, 0, 1) * 255 + 0.5).astype(np.uint8)
for p in (L / 'lenin_4_depth.webp', S.parent / 'frames' / 'lenin_4_depth.webp'):
    Image.fromarray(out).save(p, lossless=True)
print('depth: bg %.3f–%.3f, statue %.3f (core %.1f %% of frame)' % (d[~a].min(), d[~a].max(), BLD, 100 * core.mean()))
