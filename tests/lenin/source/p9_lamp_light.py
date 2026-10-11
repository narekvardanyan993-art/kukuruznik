#!/usr/bin/env python3
"""Круг s13: свет фонарей Ленина — тем же способом, что у живого Кукурузника.

  python3 tests/lenin/source/p9_lamp_light.py [--report DIR]

Как у Кукурузника (разбор s13, report/s13/): свет фонаря НАРИСОВАН в ночной картинке — горящий плафон, мягкое свечение
вокруг него, тёплое вытянутое по перспективе пятно на земле с акварельным неровным краем, под которым виден карандаш;
движок сверху добавляет только маленький ореол у лампы (LOOK.lampHalo по умолчанию, nightLamps). У Ленина до s13 ночная
картинка была без света (фонари «гасила» карта Gemini), а пятно и ореол рисовал только движок — крупными ровными
гауссовыми кругами поверх картинки («наклейки»).

Что делает скрипт для кадров с фонарями (nightLamps в building.json): для каждого фонаря
  • пятно на земле — эллипс под основанием столба, ширина ~1,25 высоты столба, высота × FORESHORT кадра (вид сверху),
    край неровный (низкочастотный шум), мягкий спад; только на той же глубине, что основание (стены впереди не красит);
  • слабый свет вокруг лампы (столб, ближние кроны, стены) — широкий мягкий спад без порога;
  • плафон — маленькая тёплая светлая точка.
Свет = дневной рисунок × тёплый тон (карандаш и штриховка остаются, как в пятнах Кукурузника), смешанный с ночью по силе.
Источник — копия ночи до s13 (source/night/s12/), поэтому скрипт можно запускать повторно.
"""
import json, shutil, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
B = ROOT / 'tests/lenin'
LF, BK = B / 'frames', B / 'source/night/s12'
FORESHORT = {'lenin_2': 0.46, 'lenin_6': 0.5}    # вид сверху: пятно на земле сжато по вертикали (Кукурузник ~0,3 — камера ниже)
WARM = np.array([1.0, 0.83, 0.58], np.float32)      # тёплый свет ламп накаливания (тон пятен Кукурузника)
LIT_GAIN = 0.90                                     # яркость освещённого рисунка в центре пятна (Кукурузник: пятно ~0,75–0,8 бумаги)
POOL, GLOW, CORE = 0.9, 0.30, 0.95                 # сила: пятно на земле, свечение вокруг лампы, плафон


def noise(h, w, seed, sigma):
    r = np.random.default_rng(seed).standard_normal((h, w)).astype(np.float32)
    r = cv2.GaussianBlur(r, (0, 0), sigma)
    return r / (r.std() + 1e-6)


def light_frame(name, lamps, rep):
    src = BK / (name + '_night.webp')
    if not src.exists():
        BK.mkdir(parents=True, exist_ok=True)
        shutil.copy2(LF / (name + '_night.webp'), src)   # копия ночи до s13 — источник при повторных запусках
    night = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    day = np.asarray(Image.open(LF / (name + '.webp')).convert('RGB')).astype(np.float32) / 255
    depth = np.asarray(Image.open(LF / (name + '_depth.webp')).convert('L')).astype(np.float32) / 255
    sky = np.asarray(Image.open(LF / (name + '_env.webp')).convert('RGB'))[..., 0] > 127
    h, w = depth.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nz = noise(h, w, 13, 10.0)                       # неровный «акварельный» край пятна
    pool_m = np.zeros((h, w), np.float32); glow_m = np.zeros_like(pool_m); core_m = np.zeros_like(pool_m)
    fk = FORESHORT.get(name, 0.5)
    for k, (hu, hv, bu, bv) in enumerate(lamps):
        hx, hy, bx, by = hu * w, hv * h, bu * w, bv * h
        H = max(by - hy, 10.0)
        a = 1.25 * H; b = a * fk
        cx, cy = bx, by + 0.12 * b
        rn = np.sqrt(((xx - cx) / a) ** 2 + ((yy - cy) / b) ** 2)
        rn = rn * (1 + 0.04 * nz)                   # край неровный
        y0, y1 = int(max(0, cy - 2 * b)), int(min(h, cy + 2 * b)); x0, x1 = int(max(0, cx - 2 * a)), int(min(w, cx + 2 * a))
        if y1 <= y0 or x1 <= x0:
            continue
        sl = (slice(y0, y1), slice(x0, x1))
        r = rn[sl]
        p = np.clip((1.0 - r) / 0.46, 0, 1); p = p * p * (3 - 2 * p)          # мягкий спад к краю
        p = p * (0.72 + 0.28 * np.exp(-r * r / 0.15))                             # чуть светлее у основания
        dB = float(np.median(depth[int(by) - 2:int(by) + 3, int(bx) - 2:int(bx) + 3]))
        gate = np.clip(1 - np.abs(depth[sl] - dB) / 0.07, 0, 1)                 # только земля на глубине основания
        gate = cv2.GaussianBlur(gate, (0, 0), 1.5)
        pool_m[sl] = 1 - (1 - pool_m[sl]) * (1 - p * gate)
        d2 = (xx - hx) ** 2 + (yy - (hy + 0.25 * H)) ** 2                    # свечение вокруг лампы и верха столба
        g = np.exp(-d2 / (2 * (0.85 * H) ** 2))
        glow_m = 1 - (1 - glow_m) * (1 - g)
        c = np.exp(-((xx - hx) ** 2 + (yy - hy) ** 2) / (2 * max(1.1, 0.075 * H) ** 2))
        core_m = np.maximum(core_m, c)
    m = 1 - (1 - POOL * pool_m) * (1 - GLOW * glow_m)
    m[sky] *= 0.0
    water = (day[..., 2] - day[..., 0] > 0.12) & (day[..., 2] > 0.45)          # вода фонтана: не «бумага», а тёмная гладь с отблеском
    water = cv2.GaussianBlur(water.astype(np.float32), (0, 0), 1.2)
    m = m * (1 - 0.7 * water)
    hsv = cv2.cvtColor((day * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    leaf = ((hsv[..., 0] > 25) & (hsv[..., 0] < 75) & (hsv[..., 1] > 70)).astype(np.float32)   # кроны и газоны
    leaf = cv2.GaussianBlur(leaf, (0, 0), 1.5)
    pm = POOL * pool_m * (1 - 0.6 * leaf)                                    # кроны выше земли — пятно на них слабее
    m = 1 - (1 - pm) * (1 - GLOW * glow_m)
    m[sky] = 0.0
    m = m * (1 - 0.7 * water)
    lit = day * WARM * LIT_GAIN
    out = night * (1 - m[..., None]) + lit * m[..., None]
    out = out + (np.array([1.0, 0.93, 0.76]) - out) * (CORE * core_m)[..., None]   # плафон: тёплая светлая точка
    rgb = (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(rgb).save(LF / (name + '_night.webp'), quality=90, method=6)
    if rep:
        before = (night * 255).astype(np.uint8)
        tiles = []
        for (hu, hv, bu, bv) in lamps[:6]:
            x, y = int(hu * w), int(hv * h)
            box = (max(0, x - 70), max(0, y - 50), min(w, x + 70), min(h, y + 90))
            for im in (before, rgb):
                t = Image.fromarray(im).crop(box).resize((280, 280), Image.LANCZOS)
                tiles.append(np.asarray(t))
        sheet = np.vstack([np.hstack(tiles[0::2]), np.hstack(tiles[1::2])])
        Image.fromarray(sheet).save(rep / ('lamps_image_%s_before_after.jpg' % name), quality=88)
    return float(m.mean())


def main():
    a = sys.argv[1:]
    rep = Path(a[a.index('--report') + 1]) if '--report' in a else None
    if rep:
        rep.mkdir(parents=True, exist_ok=True)
    bj = json.loads((B / 'building.json').read_text())
    for f in bj['frames']:
        L = f.get('nightLamps') or []
        if L:
            print(f['name'], len(L), 'фонарей, доля освещённого %.3f' % light_frame(f['name'], L, rep))


if __name__ == '__main__':
    main()
