"""Заход 7: маска колонн звонницы A — колокол шоу висит ЗА колоннами (details.js fxSwing: mask + maskRect).
Маска «впереди колокола» = слой здания минус проёмы арок; проём = тёмная штриховка внутри арки + просвет неба (светлый, не каменный цвет),
всё по цвету самого рисунка A. Колонны, капители, обрамление арок и кладка — впереди; колокол видно только в проёмах.
→ tests/pogos-petros/frames/show_bellmask_a.png (RGBA, альфа = «закрыто камнем», кроп по рамке) + печатает maskRect [u0,v0,u1,v1] для building.json.
python3 pogos-petros/build/scripts/bellmask7.py   (нужны numpy, opencv, pillow)
"""
import numpy as np, cv2
from pathlib import Path
from PIL import Image
R = Path(__file__).resolve().parents[2]; T = R.parent/'tests/pogos-petros/frames'
rgb = np.asarray(Image.open(T/'pogos_a.webp').convert('RGB')).astype(np.float32)
bld = np.asarray(Image.open(T/'pogos_a_building.webp'))[..., 3] > 127
H, W = rgb.shape[:2]
L = rgb.mean(-1); rb = rgb[..., 0] - rgb[..., 2]
x0, y0 = 384, 382   # рамка звонницы на кадре 768×1365; ниже координаты — в ×3-увеличении этой рамки (как на листе проверки)
def C(x, y): return (x0 + x // 3, y0 + y // 3)
def rect(a, b):
    (xa, ya), (xb, yb) = C(*a), C(*b); m = np.zeros((H, W), bool); m[ya:yb, xa:xb] = True; return m
dfrac = cv2.blur((L < 95).astype(np.float32), (7, 7))
hatch = (dfrac > 0.22) & (rect((282, 322), (392, 480)) | rect((120, 322), (232, 480)))   # штриховка внутри двух арок
hatch = cv2.morphologyEx(hatch.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
sky = (L > 200) & (rb < 78)   # просвет: светлее и бледнее камня (камень R−B ≈ 85–90, просвет ≈ 55)
def flood(seed, box):
    n, lab = cv2.connectedComponents((sky & box).astype(np.uint8), connectivity=4); sx, sy = C(*seed); return lab == lab[sy, sx]
bL, bR = rect((110, 440), (240, 665)), rect((272, 440), (395, 665))
op = hatch | flood((170, 560), bL) | flood((170, 495), bL) | flood((330, 560), bR) | flood((330, 495), bR)   # две точки на проём: канат делит просвет надвое
op = cv2.morphologyEx(op.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
cnt, _ = cv2.findContours(op, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
f = np.zeros((H, W), np.uint8); cv2.drawContours(f, cnt, -1, 1, -1); op = f > 0
xa, ya = C(120, 322); xb, yb = C(520, 640)
m = np.zeros((H, W), bool); m[ya:yb, xa:xb] = True
mask = (m & bld & ~op)[ya:yb, xa:xb].astype(np.float32)
mask = cv2.GaussianBlur(mask, (0, 0), 0.7)
out = np.zeros(mask.shape + (4,), np.uint8); out[..., 3] = np.clip(mask * 255, 0, 255).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(T/'show_bellmask_a.png', optimize=True)
print('maskRect', [round(xa / W, 5), round(ya / H, 5), round(xb / W, 5), round(yb / H, 5)], 'px', (xa, ya, xb, yb), 'covered %.0f%%' % (100 * mask.mean()))
# лист проверки: красным — что закрывает колокол
prev = rgb.copy(); sl = (slice(ya, yb), slice(xa, xb)); mm = np.zeros((H, W), np.float32); mm[sl] = mask
prev = prev * (1 - 0.55 * mm[..., None]) + np.array([255, 0, 0]) * 0.55 * mm[..., None]
(R/'gemini/prev').mkdir(parents=True, exist_ok=True)
Image.fromarray(prev.astype(np.uint8)).crop((x0, y0, x0 + 230, y0 + 245)).resize((690, 735), Image.NEAREST).save(R/'gemini/prev/bellmask_a.jpg', quality=88)
