# Фото -> «тушь + лёгкая акварель на бумаге». Черновой фильтр для теста (не Gemini).
import numpy as np, cv2
rng = np.random.default_rng(7)
g = cv2.imread('photo.png', 0).astype(np.float32) / 255
H, W = g.shape
sky = cv2.imread('sky.png', 0) > 127
m = cv2.imread('mask.png', 0).astype(np.float32) / 255
yy, xx = np.mgrid[0:H, 0:W]
statue = (m > 0.45) & (yy < 470) & ~sky
s = cv2.bilateralFilter((g * 255).astype(np.uint8), 7, 35, 7).astype(np.float32) / 255
# линии туши: тонкие (DoG) + контуры (Canny) — плотнее на здании, легче в небе
g1, g2 = cv2.GaussianBlur(s, (0, 0), 0.8), cv2.GaussianBlur(s, (0, 0), 1.5)
dog = g1 - g2
fine = np.clip(-dog / 0.035, 0, 1)
edges = cv2.Canny((cv2.GaussianBlur(s, (0, 0), 1.2) * 255).astype(np.uint8), 30, 80).astype(np.float32) / 255
edges = cv2.GaussianBlur(edges, (0, 0), 0.7) * 1.6
line = np.clip(np.maximum(fine * 0.9, edges), 0, 1)
line[sky] *= 0.45                                  # облака — тонким контуром, как у Кукурузника
# штриховка в тенях — неровная диагональ
wob = cv2.resize(rng.normal(0, 1, (H // 16, W // 16)).astype(np.float32), (W, H)) * 1.5
lines = (((yy + xx + wob) % 6) < 1.1).astype(np.float32)
shade = np.clip((0.40 - s) / 0.25, 0, 1) * (~sky)
line = np.maximum(line, lines * shade * 0.45)
# акварель: цвет по областям, светотень — из фото
paper = np.array([0.957, 0.925, 0.855])
tuff = np.array([0.88, 0.70, 0.58]); bronze = np.array([0.47, 0.50, 0.47]); skyc = np.array([0.78, 0.85, 0.89])
v = cv2.GaussianBlur(s, (0, 0), 2.5)[..., None]
base = np.where(statue[..., None], bronze, tuff)
light = np.clip(0.30 + 0.95 * v, 0.2, 1.15)
wash = paper * 0.45 + base * light * 0.55
cl = np.clip(0.75 + 0.45 * (v - 0.55), 0.6, 1.08)
skyw = paper * (1 - 0.45) + skyc * cl * 0.45
wash = np.where(sky[..., None], skyw, wash)
blot = cv2.resize(cv2.GaussianBlur(rng.normal(0, 1, (H // 10, W // 10)).astype(np.float32), (0, 0), 1.2), (W, H))[..., None] * 0.03
grain = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 0.8)[..., None] * 0.012
inkc = np.array([0.20, 0.18, 0.16])
out = (wash + blot) * (1 - line[..., None]) + inkc * line[..., None] + grain
cv2.imwrite('sketch.png', (np.clip(out, 0, 1)[..., ::-1] * 255).astype(np.uint8))
