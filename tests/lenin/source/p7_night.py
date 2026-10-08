#!/usr/bin/env python3
# s4 (08.10.2026): заменён tools/night_from_gemini.py (ночь Gemini как карта света поверх дня, окна и фонари зажигает движок); оставлен как запасной путь истории.
"""Ночные картинки Ленина (как у Кукурузника: отдельный <кадр>_night.webp того же размера, контуры дня на месте).

  python3 tests/lenin/source/p7_night.py [lenin_2 ...]     # пишет tests/lenin/frames/<кадр>_night.webp

Gemini (Nano Banana) был недоступен (07.10.2026, Chrome не подключён) — ночь собрана из дневного рисунка:
  1. небо (R-канал _env) — ночная синь сверху вниз, облака — серо-синими тенями того же рисунка;
  2. земля и дома — дневной рисунок под синим фильтром «лунный свет» (карандаш остаётся: умножение, не перерисовка);
  3. окна — тёмные прямоугольники на фасадах (поиск по рисунку в рамках WIN_BOX) зажигаются тёплым светом, ~45 %, с ореолом;
  4. фонари — карандашный столб с фонарём + тёплое световое пятно на земле (LAMPS: основание u, v и высота в долях кадра);
  5. памятник — подсветка снизу тёплым прожектором по маске слоя здания (FLOOD).
Повторный запуск даёт тот же результат (зерно и выбор окон — с фиксированным seed).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[3]
FR = ROOT / 'tests' / 'lenin' / 'frames'
# окна: рамки u0, v0, u1, v1, где искать окна на фасадах
WIN_BOX = {
    'lenin_1': [(0.0, 0.33, 0.30, 0.47)],
    'lenin_2': [(0.0, 0.0, 1.0, 0.36), (0.0, 0.33, 0.30, 0.95), (0.40, 0.33, 0.80, 0.38), (0.82, 0.30, 1.0, 0.56), (0.25, 0.87, 0.80, 1.0), (0.36, 0.64, 0.50, 0.82)],
    'lenin_3': [],
    'lenin_4': [],
    'lenin_6': [(0.0, 0.0, 0.48, 0.28), (0.52, 0.0, 1.0, 0.26), (0.85, 0.30, 1.0, 0.75)],
}
# фонари: основание (u, v), высота столба в долях высоты кадра
LAMPS = {
    'lenin_1': [(0.06, 0.66, 0.05), (0.17, 0.645, 0.032), (0.255, 0.635, 0.022)],
    'lenin_2': [(0.215, 0.865, 0.03), (0.40, 0.842, 0.03), (0.585, 0.81, 0.028), (0.68, 0.70, 0.026), (0.74, 0.79, 0.028), (0.82, 0.95, 0.032), (0.33, 0.47, 0.022), (0.60, 0.40, 0.02)],
    'lenin_3': [(0.07, 0.745, 0.06), (0.25, 0.745, 0.06), (0.75, 0.745, 0.06), (0.93, 0.745, 0.06)],
    'lenin_4': [],
    'lenin_6': [(0.12, 0.47, 0.03), (0.86, 0.47, 0.03), (0.30, 0.655, 0.035), (0.66, 0.655, 0.035), (0.47, 0.40, 0.025), (0.70, 0.395, 0.025)],
}
GROUND_L = 0.20   # средняя яркость ночной земли (как у кадра B)
FLOOD = {'lenin_1': 0.8, 'lenin_3': 0.8, 'lenin_4': 0.65, 'lenin_6': 0.7, 'lenin_2': 0.5}


def load(name):
    day = np.asarray(Image.open(FR / f'{name}.webp').convert('RGB')).astype(np.float32) / 255
    env = np.asarray(Image.open(FR / f'{name}_env.webp').convert('RGB')).astype(np.float32) / 255
    bld = np.asarray(Image.open(FR / f'{name}_building.webp'))[..., 3].astype(np.float32) / 255
    return day, env, bld


def lum(a):
    return a @ np.array([0.299, 0.587, 0.114], np.float32)


def windows(name, day, sky, bld, rng):
    H, W = sky.shape
    L = lum(day)
    loc = ndimage.uniform_filter(L, 15)
    dark = (L < loc - 0.07) & (L > 0.18) & (sky < 0.3) & (bld < 0.3)
    green = (day[..., 1] > day[..., 0] + 0.03) & (day[..., 1] > day[..., 2])
    dark &= ~green
    box = np.zeros_like(dark)
    for u0, v0, u1, v1 in WIN_BOX.get(name, []):
        box[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)] = True
    dark &= box
    dark = ndimage.binary_opening(dark, np.ones((2, 2)))
    lab, n = ndimage.label(dark)
    out = np.zeros((H, W), np.float32); lit = 0
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        m = lab[sl] == i; a = m.sum(); h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if not (6 <= a <= 160) or not (0.25 < w / h < 2.2) or a / (w * h) < 0.45 or h > 18:
            continue
        if rng.random() < 0.45:
            out[sl][m] = rng.uniform(0.65, 1.0); lit += 1
    return out, lit


def draw_lamp(img, add, u, v, hgt, xx, yy):
    H, W = img.shape[:2]
    x0, y0 = u * W, v * H; hp = hgt * H; yt = y0 - hp
    rx, ry = hp * 1.9, hp * 0.6
    pool = np.exp(-(((xx - x0) / rx) ** 2 + ((yy - y0) / ry) ** 2) * 2.2)          # световое пятно на земле
    add += pool[..., None] * np.array([1.0, 0.74, 0.40], np.float32) * 0.62
    halo = np.exp(-(((xx - x0) ** 2 + (yy - yt) ** 2) / (hp * 0.42) ** 2) * 2.0)    # ореол фонаря
    add += halo[..., None] * np.array([1.0, 0.82, 0.52], np.float32) * 0.7
    lw = max(1, int(round(hp * 0.035)))                                               # столб — тёмная карандашная линия
    xa = int(round(x0)); y_a, y_b = max(0, int(yt)), min(H, int(y0) + 1)
    img[y_a:y_b, max(0, xa - lw // 2):xa + lw // 2 + 1] = img[y_a:y_b, max(0, xa - lw // 2):xa + lw // 2 + 1] * 0.35 + np.array([0.08, 0.07, 0.08]) * 0.65
    core = np.exp(-(((xx - x0) / (hp * 0.07)) ** 2 + ((yy - yt) / (hp * 0.09)) ** 2))  # фонарь — тёплое ядро
    add += core[..., None] * np.array([1.0, 0.93, 0.75], np.float32) * 1.2


def night(name):
    rng = np.random.default_rng(7)
    day, env, bld = load(name)
    H, W = day.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    sky = ndimage.gaussian_filter(env[..., 0], 1.2)
    L = lum(day)
    g = np.power(day, 1.3) * np.array([0.30, 0.34, 0.52], np.float32) + np.array([0.015, 0.02, 0.04], np.float32)
    rows = np.nonzero(sky.mean(1) > 0.5)[0]
    sk_end = max(0.25, rows.max() / H) if len(rows) else 0.5
    t = np.clip(yy[:, :1] / H / sk_end, 0, 1)[..., None]
    skyc = np.array([0.07, 0.09, 0.19]) * (1 - t) + np.array([0.20, 0.24, 0.38]) * t
    cloud = np.clip((L - 0.80) / 0.15, 0, 1) * (1 - np.clip((day[..., 2] - day[..., 0] - 0.06) / 0.1, 0, 1))
    skyc = skyc + cloud[..., None] * np.array([0.10, 0.11, 0.14]) - (1 - L[..., None]) * 0.25 * np.array([0.3, 0.3, 0.35])
    water = np.clip((day[..., 2] - day[..., 0] - 0.18) / 0.12, 0, 1) * (sky < 0.3)   # вода в чаше ночью тёмная, не светится синим
    g = g * (1 - 0.5 * ndimage.gaussian_filter(water, 1.0)[..., None])
    gm = float((lum(g) * (sky < 0.3)).sum() / max(1, (sky < 0.3).sum()))
    g = g * min(1.0, GROUND_L / max(gm, 1e-3))   # светлые кадры (G) темнеют до общего ночного уровня
    sky = ndimage.gaussian_filter(sky, 3.0)          # без шва на линии неба
    out = g * (1 - sky[..., None]) + skyc * sky[..., None]
    add = np.zeros_like(out)
    win, lit = windows(name, day, sky, bld, rng)
    wl = ndimage.gaussian_filter(win, 0.6)
    out = out * (1 - wl[..., None]) + wl[..., None] * (np.array([1.0, 0.82, 0.50]) * (0.85 + 0.15 * L[..., None]))
    add += ndimage.gaussian_filter(win, 3.5)[..., None] * np.array([1.0, 0.7, 0.35]) * 0.8
    fl = FLOOD.get(name, 0)
    if fl and bld.max() > 0.5:                                                         # памятник: тёплая подсветка снизу
        ys = np.nonzero(bld.max(1) > 0.5)[0]; y0, y1 = ys.min(), ys.max()
        k = np.clip((yy[:, :1] - y0) / max(1, y1 - y0), 0, 1)
        lift = (0.6 + 0.4 * k) * fl
        m = (ndimage.gaussian_filter(bld, 1.0)[..., None] * lift[..., None] * 1.1).clip(0, 1)
        add += ndimage.gaussian_filter(bld, 22)[..., None] * k[..., None] * np.array([1.0, 0.72, 0.42]) * 0.18 * fl   # свет прожектора ложится вокруг
        lit_b = np.power(day, 1.05) * np.array([0.80, 0.64, 0.46]) * (0.55 + 0.5 * lift[..., None])
        out = out * (1 - m) + lit_b * m
    for u, v, h in LAMPS.get(name, []):
        draw_lamp(out, add, u, v, h, xx, yy)
    out = 1 - (1 - np.clip(out, 0, 1)) * (1 - np.clip(add, 0, 1))                     # «экран»: свет не выжигает карандаш
    out = out + rng.standard_normal((H, W, 1)).astype(np.float32) * 0.008            # бумага: лёгкое зерно
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(FR / f'{name}_night.webp', quality=88, method=6)
    print(f'{name}: окон зажжено {lit}, фонарей {len(LAMPS.get(name, []))}')


if __name__ == '__main__':
    for n in (sys.argv[1:] or list(WIN_BOX)):
        night(n)
