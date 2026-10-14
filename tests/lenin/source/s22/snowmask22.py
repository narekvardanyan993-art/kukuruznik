"""s22: маска снега кадра из зимнего варианта Gemini.
Зимний вариант (refs/s22/<кадр>_winter_*.jpg) совмещается с рисунком (ECC, аффинно), затем «стало белым» в Lab:
свет вырос, цвет ушёл в белый -> мягкая маска 0..255 (frames/<кадр>_snow.webp, серая). Тонкие полоски от несовпадения
линий (1-2 px) выкидываются открытием, края смягчаются. Оверлей для проверки -> report/s22/mask_<кадр>.jpg.
Запуск: python3 source/s22/snowmask22.py lenin_1 refs/s22/lenin_1_winter_a.jpg
"""
import sys, json
import numpy as np, cv2
from PIL import Image
from skimage.color import rgb2lab

name, wpath = sys.argv[1], sys.argv[2]
# --statue-top R: на тёмной бронзе статуи снег только у верхнего края (голова, плечи) — Gemini на мелкой статуе белит её целиком (кадр 5)
ST = int(sys.argv[sys.argv.index('--statue-top') + 1]) if '--statue-top' in sys.argv else 0
o = np.asarray(Image.open('frames/%s.webp' % name).convert('RGB'))
H, W = o.shape[:2]
w = np.asarray(Image.open(wpath).convert('RGB').resize((W, H), Image.LANCZOS))

def edges(a):
    g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    g = cv2.GaussianBlur(g, (0, 0), 2.0)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1)
    return np.sqrt(gx * gx + gy * gy)

warp = np.eye(2, 3, dtype=np.float32)
crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
try:
    cc, warp = cv2.findTransformECC(edges(o), edges(w), warp, cv2.MOTION_AFFINE, crit, None, 5)
except cv2.error as e:
    cc = -1
wa = cv2.warpAffine(w, warp, (W, H), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)

lo = rgb2lab(o / 255.0); lw = rgb2lab(wa / 255.0)
dL = lw[..., 0] - lo[..., 0]
Cw = np.hypot(lw[..., 1], lw[..., 2]); Co = np.hypot(lo[..., 1], lo[..., 2])
ss = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1)
score = ss(dL, 5, 22) * ss(lw[..., 0], 68, 86) * (1 - ss(Cw, 9, 20))
# белое, которое было почти белым и раньше (облака, бумага) — не снег
score *= 1 - ss(lo[..., 0], 88, 95) * (1 - ss(dL, 4, 10))
if ST > 0:
    ba = np.asarray(Image.open('frames/%s_building.webp' % name).convert('RGBA'))[..., 3] > 128
    bronze = ba & (lo[..., 0] < 42)
    top = np.zeros_like(bronze)
    for k in range(1, ST + 1):
        top[k:] |= ~bronze[:-k]
    score = np.where(bronze & ~top, 0, score)
m = (np.power(score, 0.6) * 255).astype(np.uint8)   # круг 2: маска плотнее (на снимке Chrome снег на кронах и крышах был еле виден)
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
# мелкий мусор (капли < 6 px) прочь
n, lab, st, _ = cv2.connectedComponentsWithStats((m > 60).astype(np.uint8), 8)
small = np.isin(lab, np.where(st[:, cv2.CC_STAT_AREA] < 6)[0]) & (lab > 0)
m[small] = 0
m = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.2)
m = np.clip(m * 1.15, 0, 255).astype(np.uint8)
Image.fromarray(m).convert('RGB').save('frames/%s_snow.webp' % name, quality=90, method=6)   # webp q90: ~3× меньше без потерь (средняя ошибка ~0,3 уровня из 255) — маска мягкая
ov = (o * (1 - m[..., None] / 255.0 * 0.85) + np.array([30, 120, 255]) * (m[..., None] / 255.0 * 0.85)).astype(np.uint8)
side = np.concatenate([o, wa, ov], 1)
Image.fromarray(side).resize((side.shape[1] // 2, H // 2)).save('report/s22/mask_%s.jpg' % name, quality=85)
print(json.dumps({'frame': name, 'ecc': round(float(cc), 3), 'warp': np.round(warp, 4).tolist(), 'cover': round(float((m > 64).mean()), 4), 'meanmask': round(float(m.mean() / 255), 4)}))
