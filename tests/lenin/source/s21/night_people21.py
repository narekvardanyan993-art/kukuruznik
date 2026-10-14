"""s21: ночью нарисованные люди кадра 3 (игроки в нарды со скамейкой, вписаны в s17) были полупрозрачными «призраками»: ночь s16–s20
собиралась как ночь × (новый день / старый день), а в старом дне (s15) на их месте была стена. Теперь в силуэте того, что вписано
в s17 (отличие дня от s15), ночь = день × местный тон ночи (отношение ночь/день на стене вокруг, размытое) — люди непрозрачные, тон тот же.
python3 night_people21.py BUILD_DIR -> BUILD_DIR/lenin_3_night.png, night_people_mask_lenin_3.png"""
import sys, numpy as np, cv2
from pathlib import Path
from PIL import Image
from scipy import ndimage
B = Path(__file__).resolve().parents[1].parent; OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
n = 'lenin_3'; BOX = (575, 885, 730, 1008)
rd = lambda p: np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
day, nt, s15 = rd(B / f'frames/{n}.webp'), rd(B / f'frames/{n}_night.webp'), rd(B / f'source/night/s15src/{n}.webp')
lab = lambda a: cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
dE = np.linalg.norm(lab(day) - lab(s15), axis=2)
box = np.zeros(dE.shape, bool); box[BOX[1]:BOX[3], BOX[0]:BOX[2]] = True
m = ndimage.binary_fill_holes(ndimage.binary_closing((dE > 8) & box, iterations=2))
lb, k = ndimage.label(m); sizes = ndimage.sum(m, lb, range(1, k + 1)); m = np.isin(lb, 1 + np.where(sizes >= 40)[0])
m = ndimage.binary_dilation(m, iterations=2)
w = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0) * 1.2, 0, 1) * box
ring = (ndimage.binary_dilation(m, iterations=12) & ~ndimage.binary_dilation(m, iterations=3)).astype(np.float32)[..., None]
# тон ночи вокруг (цвет стены ночью) × относительная яркость дня (день / стена днём), не ярче ночной стены — без «свечения» светлых
# досок скамейки и нардов (первая проба «день × отношение по каналам» дала тёплое светящееся пятно в середине)
nw = (cv2.GaussianBlur(nt * ring, (0, 0), 28) + 1e-3) / (cv2.GaussianBlur(ring, (0, 0), 28)[..., None] + 1e-3)
lum = lambda a: (a * np.array([0.299, 0.587, 0.114], np.float32)).sum(-1)
dw = (cv2.GaussianBlur(lum(day) * ring[..., 0], (0, 0), 28) + 1e-3) / (cv2.GaussianBlur(ring[..., 0], (0, 0), 28) + 1e-3)
rel = np.clip(lum(day) / np.maximum(dw, 1), 0, 1.0)
out = nt * (1 - w[..., None]) + nw * rel[..., None] * w[..., None]
R = rel
Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8)).save(OUT / f'{n}_night.png')
Image.fromarray((w * 255).astype(np.uint8)).save(OUT / f'night_people_mask_{n}.png')
print('px', int((w > 0.5).sum()), 'rel mean', round(float(R[w > 0.5].mean()), 3))
