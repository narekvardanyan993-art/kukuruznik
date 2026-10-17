#!/usr/bin/env python3
# e1.32 (s32): текстуры «старой бумаги» для открытки — engine/paper/old-paper-1.webp (лицо), old-paper-2.webp (оборот).
# Процедурно (Gemini в Chrome в s32 был недоступен): пожелтение пятнами, фоксинг, волокна, потёртые края. Запуск: python3 tools/make_paper.py engine/paper
# Процедурная «старая бумага» (s32): пожелтение пятнами, фоксинг, волокна, потёртые края. Детерминированно (seed).
import numpy as np, sys
from PIL import Image, ImageFilter
from scipy.ndimage import gaussian_filter, zoom
def noise(h, w, scale, rng):
    sh, sw = max(2, h // scale), max(2, w // scale)
    n = rng.random((sh, sw))
    n = zoom(n, (h / sh, w / sw), order=3)[:h, :w]
    return (n - n.min()) / (n.max() - n.min() + 1e-9)
def fbm(h, w, rng, scales=(320, 160, 80, 40, 20, 8), amp=(1, .6, .4, .25, .15, .08)):
    s = sum(a * noise(h, w, sc, rng) for sc, a in zip(scales, amp))
    return (s - s.min()) / (s.max() - s.min())
def make(seed, W=1080, H=1920, stain=1.0, edge=1.0):
    rng = np.random.default_rng(seed)
    base = np.array([238, 226, 198], float)            # тёплая бумага
    yel = np.array([214, 186, 132], float)             # пожелтение
    img = np.ones((H, W, 3)) * base
    f = fbm(H, W, rng)
    y = np.clip((f - 0.45) * 1.6, 0, 1) ** 1.3 * 0.55 * stain
    img = img * (1 - y[..., None]) + yel * y[..., None]
    # мелкая зернистость бумаги
    g = gaussian_filter(rng.standard_normal((H, W)), 0.7) * 5
    img += g[..., None]
    # волокна
    fib = np.zeros((H, W))
    for _ in range(int(700 * W * H / (720 * 1280))):
        x0, y0 = rng.random() * W, rng.random() * H; a = rng.random() * np.pi; L = 6 + rng.random() * 30
        for t in np.linspace(0, 1, int(L)):
            xx, yy = int(x0 + np.cos(a) * L * t), int(y0 + np.sin(a) * L * t)
            if 0 <= xx < W and 0 <= yy < H: fib[yy, xx] += 1
    fib = gaussian_filter(fib, 0.8)
    img -= (fib[..., None] * np.array([12, 13, 17]))
    # фоксинг: рыжие пятнышки кучками
    fox = np.zeros((H, W))
    for _ in range(int(7 * stain)):
        cx, cy = rng.random() * W, rng.random() * H
        for _ in range(rng.integers(3, 18)):
            px, py = cx + rng.normal() * 40, cy + rng.normal() * 40
            r = 1 + rng.random() * 5
            yy, xx = np.ogrid[max(0, int(py - 3 * r)):min(H, int(py + 3 * r)), max(0, int(px - 3 * r)):min(W, int(px + 3 * r))]
            fox[yy, xx] = np.maximum(fox[yy, xx], np.exp(-((xx - px) ** 2 + (yy - py) ** 2) / (2 * r * r)) * (0.3 + rng.random() * 0.7))
    # 2–3 крупных бледных пятна (вода/чай)
    for _ in range(0):   # круги «от чашки» убраны — на лице открытки читаются как дефект
        cx, cy, R = rng.random() * W, rng.random() * H, 60 + rng.random() * 160
        yy, xx = np.ogrid[:H, :W]; d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / R
        ring = np.exp(-((d - 1) ** 2) / 0.006) * 0.5 + np.clip(1 - d, 0, 1) * 0.12
        fox = np.maximum(fox, ring * (0.3 + 0.3 * fbm(H, W, rng, (60, 20), (1, .5))))
    img = img * (1 - fox[..., None] * 0.55) + np.array([160, 110, 60]) * fox[..., None] * 0.55
    # края: потемнение и потёртость (неровная полоса)
    yy, xx = np.mgrid[:H, :W]
    dist = np.minimum.reduce([xx, W - 1 - xx, yy, H - 1 - yy]).astype(float)
    wob = (fbm(H, W, rng, (80, 30, 10), (1, .5, .3)) - 0.5) * 26
    e = np.clip(1 - (dist + wob) / (95 * edge), 0, 1) ** 1.8
    img = img * (1 - e[..., None] * 0.35) + np.array([150, 118, 74]) * e[..., None] * 0.35
    worn = np.clip(1 - (dist + wob * 0.6) / 13, 0, 1)   # совсем край — светлее (истёрто)
    img = img * (1 - worn[..., None] * 0.5) + np.array([246, 238, 220]) * worn[..., None] * 0.5
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
out = sys.argv[1]
for name, seed, st, ed in (('old-paper-1', 31, 1.0, 1.0), ('old-paper-2', 77, 1.3, 1.1)):
    im = make(seed, stain=st, edge=ed)
    for q in (82, 76, 70, 64, 58):
        im.save(f'{out}/{name}.webp', 'WEBP', quality=q, method=6)
        import os; sz = os.path.getsize(f'{out}/{name}.webp')
        if sz <= 200_000: break
    print(name, im.size, q, sz)
