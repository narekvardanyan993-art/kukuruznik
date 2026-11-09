#!/usr/bin/env python3
"""Заход 20: объёмный снег на будке B (отзыв: «снег слишком плоско лежит на домике»).
1) show_wx_b_kennel_snow.png (246×246, как show_wx_b_kennel.png) — будка со снежной шапкой из правки Gemini (kennel_snow_ig9g30.jpeg,
   вход in_kennel_base.png = B.png + show_wx_b_kennel.png, окно x372 y1760 960×540 высокого кадра); альфа = будка ∪ снежная шапка.
2) pogos_b_snow.webp: будка ЦЕЛИКОМ (с крышей) вырезана из маски снега — плоская белая крыша движка больше не рисуется.
Исходник маски до захода — pogos-petros/build/source/pre20/. Повторный запуск даёт тот же результат."""
import sys, shutil
from pathlib import Path
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent)); import fix15
FR = Path('tests/pogos-petros/frames'); PRE = Path('pogos-petros/build/source/pre20'); PRE.mkdir(parents=True, exist_ok=True)
KIT = next(p for p in (Path.home() / 'Documents/chka-kitchen', Path.home() / 'mnt/chka-kitchen') if p.exists()); K = KIT / 'zhivost-v2/veo'
if not (PRE / 'pogos_b_snow.webp').exists(): shutil.copy2(FR / 'pogos_b_snow.webp', PRE / 'pogos_b_snow.webp')
G = np.array(Image.open(K / 'kennel_snow_ig9g30.jpeg').convert('RGB')); I = np.array(Image.open(K / 'in_kennel_base.png').convert('RGB'))
tm, cc, W = fix15.locate(G, I); g = fix15.warp_to(G, W, I.shape[1], I.shape[0])   # правка Gemini в пикселях окна 960×540
k = Image.open(FR / 'show_wx_b_kennel.png').convert('RGBA'); kw, kh = k.size
x0h, y0h, x1h, y1h = 614, 1802, 1106, 2294   # rect 0.40,0.66,0.72,0.84 в кадре 1536×2731
reg = cv2.resize(g[y0h - 1760:y1h - 1760, x0h - 372:x1h - 372], (kw, kh), interpolation=cv2.INTER_AREA)
base = cv2.resize(I[y0h - 1760:y1h - 1760, x0h - 372:x1h - 372], (kw, kh), interpolation=cv2.INTER_AREA)
a0 = np.array(k)[..., 3].astype(np.float32) / 255
poly = np.array([[100, 133], [136, 94], [192, 95], [221, 133], [219, 191], [106, 189]], np.int32)   # контур будки (fix16)
pm = np.zeros((kh, kw), np.uint8); cv2.fillPoly(pm, [poly], 1)
near = cv2.dilate(pm, np.ones((19, 19), np.uint8)); near[150:] = cv2.dilate(pm, np.ones((5, 5), np.uint8))[150:]   # шапка свисает вверх/вбок, не по земле
diff = (np.abs(reg.astype(np.float32) - base.astype(np.float32)).max(-1) > 22).astype(np.uint8) & near
cap = cv2.morphologyEx(diff, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
alpha = np.maximum(a0, cv2.GaussianBlur(np.maximum(cap, pm).astype(np.float32), (0, 0), 1.2))
Image.fromarray(np.dstack([reg, (np.clip(alpha, 0, 1) * 255).astype(np.uint8)])).save(FR / 'show_wx_b_kennel_snow.png')
sn = np.array(Image.open(PRE / 'pogos_b_snow.webp').convert('RGB')).astype(np.float32)
X0, Y0 = int(round(0.40 * 768)), int(round(0.66 * 1365))
body = cv2.GaussianBlur(cv2.dilate(np.maximum(cap, pm), np.ones((3, 3), np.uint8)).astype(np.float32), (0, 0), 1.2)
sub = sn[Y0:Y0 + kh, X0:X0 + kw]; sub *= (1 - body[..., None]); sn[Y0:Y0 + kh, X0:X0 + kw] = sub
Image.fromarray(sn.astype(np.uint8)).save(FR / 'pogos_b_snow.webp', quality=92)
sheet = np.concatenate([base, reg, (np.dstack([alpha] * 3) * 255).astype(np.uint8)], 1)
Image.fromarray(sheet).save(Path('pogos-petros/build/report/s20/kennel_snow_check.jpg'), quality=85)
print('tm', round(tm, 3), 'ecc', round(cc, 3), 'cap px', int(cap.sum()))
