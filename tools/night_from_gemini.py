#!/usr/bin/env python3
"""Ночь v2 из Gemini (e1.12, docs/ENGINE-LIFE.md «Рецепт ночи»): свет и цвет ночи Gemini поверх полного дневного рисунка.

  python3 tools/night_from_gemini.py tests/<здание> <кадр> (--night ночь.jpg | --like <кадр-образец>) [--wmask окна.jpg] [--mmask памятник.jpg] [--flood 0.8]
          [--relamp] [--mon-color] [--nowin u0,v0,u1,v1;...] [--overlay DIR] [--write]
  --write: у кадра в building.json — "nightLamps" из _lamps.json и "nightWins": true (меняются только эти строки кадра)

Gemini отдаёт только превью (~1024 px по длинной стороне), поэтому ночная картинка Gemini — не замена кадра, а КАРТА света и цвета:
  1. совмещается с дневным рисунком (сдвиг/масштаб по контурам, как маска дорог);
  2. ночь = дневной рисунок × (размытая ночь Gemini / размытый день) — карандашные линии дня остаются резкими, апскейла нет;
  3. памятник (слой здания) — музейная подсветка: тёплый свет снизу с мягким спадом вверх + блики на выпуклом металле,
     только внутри силуэта (без ореола вокруг и без перекраски всей статуи);
  4. --wmask: та же копия кадра, где Gemini закрасил окна чистым синим, фонари — чистым зелёным:
     окна → <кадр>_win2.webp (движок зажигает их по одному, ночью: "nightWins": true у кадра);
     фонари → source/night/<кадр>_lamps.json (голова, основание) — для nightLamps и столбов в рисунке (p6_static_props.py).
     памятник → source/night/<кадр>_monument.png (чистый пурпурный #FF00FF в той же маске или отдельной --mmask):
     подсветка ложится только на статую и постамент, а не на весь слой здания (слой шире — деревья, земля вокруг).
Окна и фонари в ночной картинке остаются тёмными — свет даёт движок, постепенно.
Фонари (_lamps.json) пишутся один раз: при повторном запуске берутся из файла (--relamp — пересчитать), потому что после
p6_static_props.py столбы уже нарисованы в дне и разница «маска Gemini − день» их больше не видит.
"""
import json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_road_mask import align  # noqa: E402


def load_fit(path, W, H):
    return np.asarray(Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS))


INK_T = 40   # порог


def win_stats(blue):
    """Сколько окон примет движок (prep.js labelWindows для win2 при nightWins: пол-размера, порог 100, вытянутость 0,25–4, заполнение ≥ 0,45)."""
    h2 = cv2.resize(blue.astype(np.float32), None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA) * 255 > 100
    n, lab, st, _ = cv2.connectedComponentsWithStats(h2.astype(np.uint8), connectivity=4)
    ok = 0
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a >= 2 and w * h <= 3000 and 0.25 <= w / h <= 4 and a / (w * h) >= 0.45:   # как prep.js при nightWins
            ok += 1
    return ok, n - 1


def regularize(blue):
    """Пятна Gemini → прямоугольники окон, которые примет движок: полоса из нескольких окон режется поперёк на клетки
    с шагом ~1,4 высоты (с зазором 1 px), рваное пятно → его прямоугольник. Свет движок всё равно кладёт овалом в рамку окна."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(blue.astype(np.uint8), connectivity=4)
    out = np.zeros_like(blue, dtype=np.uint8)
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < 5 or w < 2 or h < 2:
            continue
        if w >= h:
            k = max(1, int(round(w / h / 1.4))); cw = w / k
            for j in range(k):
                x0 = int(round(x + j * cw)); x1 = int(round(x + (j + 1) * cw)) - (1 if k > 1 else 0)
                out[y:y + h, x0:x1] = 1
        else:
            k = max(1, int(round(h / w / 1.9))); ch = h / k
            for j in range(k):
                y0 = int(round(y + j * ch)); y1 = int(round(y + (j + 1) * ch)) - (1 if k > 1 else 0)
                out[y0:y1, x:x + w] = 1
    return out


def gblur(a, s):
    return cv2.GaussianBlur(a, (0, 0), s)


def sky_gaps(day, bld):
    """Просветы неба внутри слоя здания (между ног, под локтем): светлая бумага/небо без штриховки, крупными пятнами.
    Слой здания их захватывает — ночью они не должны светиться как бронза (на D это была «дыра между ног»)."""
    lab = cv2.cvtColor(day, cv2.COLOR_RGB2LAB).astype(np.float32)
    L, C = lab[..., 0] / 255, np.hypot(lab[..., 1] - 128, lab[..., 2] - 128)
    pale = (L > 0.89) & (C < 22) & (lab[..., 1] - 128 < 9) & (bld > 0.5)            # розоватый светлый туф постамента — не просвет
    pale = cv2.morphologyEx(pale.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lb, st, _ = cv2.connectedComponentsWithStats(pale)
    keep = [i for i in range(1, n) if st[i][4] >= 300]
    return cv2.dilate(np.isin(lb, keep).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)


def monument_mask(day, bld, wmask, mmask, bdir, name, W, H):
    """Пурпур (#FF00FF) из маски Gemini → силуэт памятника (только внутри слоя здания, без просветов неба).
    Нет пурпура — слой здания без просветов неба."""
    nd = bdir / 'source' / 'night'; mf = nd / (name + '_monument.png')
    gaps = sky_gaps(day, bld)
    for src in (mmask, wmask):
        if not src:
            continue
        g = load_fit(src, W, H).astype(int)
        mg = (g[..., 0] > 160) & (g[..., 2] > 160) & (g[..., 1] < 100)
        if mg.mean() < 0.0005:
            continue
        M, sc, _ = align(day, g.astype(np.uint8), mg)
        mg = cv2.warpAffine(mg.astype(np.uint8), M, (W, H), flags=cv2.INTER_NEAREST)
        mg = cv2.morphologyEx(mg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))).astype(bool)   # Gemini красит фигуру пятнами — сомкнуть
        span = np.zeros_like(mg)                                                     # пропуски Gemini внутри памятника: строка — от края до края пурпура
        for y in np.nonzero(mg.any(1))[0]:
            xs = np.nonzero(mg[y])[0]; span[y, xs[0]:xs[-1] + 1] = True
        mg = span & cv2.dilate((bld > 0.3).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~gaps
        nd.mkdir(parents=True, exist_ok=True)
        Image.fromarray((mg * 255).astype(np.uint8)).save(mf)
        print('%s: памятник по маске Gemini (corr %.3f), %.2f %% кадра' % (name, sc, mg.mean() * 100))
        return mg.astype(np.float32)
    if mf.exists():
        return (np.asarray(Image.open(mf)) > 127).astype(np.float32)
    mg = (bld > 0.5) & ~gaps
    if '--mon-color' in sys.argv:                                                     # слой здания шире памятника (общий план B): по цвету — розовый туф и тёмная бронза, без крон и мостовой
        lab = cv2.cvtColor(day, cv2.COLOR_RGB2LAB).astype(np.float32)
        R_, G_, B_ = [day[..., c].astype(int) for c in range(3)]
        tree = (G_ > B_ + 40) & (G_ * 100 > R_ * 88)
        mg &= ~tree & ((lab[..., 1] - 128 > 9) | (lab[..., 0] < 0.45 * 255))
        mg = cv2.morphologyEx(mg.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        n, lb, st, _ = cv2.connectedComponentsWithStats(mg)
        mg = np.isin(lb, [i for i in range(1, n) if st[i][4] >= 40])
    nd.mkdir(parents=True, exist_ok=True)
    Image.fromarray((mg * 255).astype(np.uint8)).save(mf)
    print('%s: памятник = слой здания без просветов неба (%.2f %% кадра просветы)' % (name, gaps.mean() * 100))
    return mg.astype(np.float32)


def find_lamps(green, day, W, H):
    """Головы фонарей (зелёные пятна) → фонари [голова u, v, основание u, v, [головы...]].
    Соседние головы (многорожковый фонарь) — один фонарь. Кроны деревьев, которые Gemini закрасил «фонарём», — прочь.
    Столбы Gemini рисует как попало — длина столба считается от ширины головы."""
    n, lab, st, cen = cv2.connectedComponentsWithStats(green.astype(np.uint8))
    R_, G_, B_ = [day[..., c].astype(int) for c in range(3)]
    tree = (G_ > B_ + 40) & (G_ * 100 > R_ * 88)                                      # крона дерева в рисунке (оливковая/зелёная)
    heads = [(st[i][0] + st[i][2] / 2, st[i][1] + st[i][3] / 2, st[i][2], st[i][3]) for i in range(1, n)
             if st[i][4] >= 4 and tree[lab == i].mean() < 0.35]   # Gemini иногда красит кроны в «фонари» — прочь
    groups = []
    for h in sorted(heads, key=lambda q: q[1]):
        for g in groups:
            if any(abs(h[0] - q[0]) < max(10, 2.2 * q[2]) and abs(h[1] - q[1]) < max(8, 1.5 * q[3]) for q in g):
                g.append(h); break
        else:
            groups.append([h])
    out = []
    for g in groups:
        x = sum(q[0] for q in g) / len(g); y = sum(q[1] for q in g) / len(g)
        y0 = int(max(q[1] + q[3] / 2 for q in g)) + 1
        hw = max(q[2] for q in g)
        yb = y0 + float(np.clip(2.0 * hw, 24 * H / 1365, 40 * H / 1365))   # голова Gemini втрое крупнее фонаря; столб ≈ 2 её ширины (≈ 2,5–3 роста человека)
        out.append([round(x / W, 4), round(y / H, 4), round(x / W, 4), round(min(1.0, yb / H), 4),
                    [[round(q[0] / W, 4), round(q[1] / H, 4), round(q[2] / W, 4)] for q in g]])
    return out


def write_frame(path, name, lamps):
    """Строки "nightLamps" кадра → фонари из маски; после них — "nightWins": true. Остальной файл не трогается."""
    import re
    txt = open(path).read()
    i = txt.index('"name": "%s"' % name)
    j = txt.find('"name": ', i + 10); j = len(txt) if j < 0 else j
    blk = txt[i:j]
    blk2 = re.sub(r'"nightLamps": \[.*?\]\],?|"nightLamps": \[\],?', '"nightLamps": %s,' % json.dumps(lamps), blk, count=1, flags=re.S)
    if '"nightWins"' not in blk2:
        blk2 = re.sub(r'(\n(\s*)"nightLamps": [^\n]*\n)', lambda m: m.group(1) + m.group(2) + '"nightWins": true,\n', blk2, count=1)
    open(path, 'w').write(txt[:i] + blk2 + txt[j:])
    json.loads(open(path).read())
    print('%s: building.json — nightLamps %d, nightWins' % (name, len(lamps)))


def main():
    a = sys.argv[1:]
    bdir, name = Path(a[0]), a[1]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    fr = bdir / 'frames'
    day = np.asarray(Image.open(fr / (name + '.webp')).convert('RGB'))
    H, W = day.shape[:2]
    bld = np.asarray(Image.open(fr / (name + '_building.webp')))[..., 3].astype(np.float32) / 255
    d = day.astype(np.float32) / 255
    s = 2.2
    if opt('--night'):
        gem = load_fit(opt('--night'), W, H)
        M, score, par = align(day, gem, np.zeros((H, W), bool))
        gem = cv2.warpAffine(gem, M, (W, H), borderMode=cv2.BORDER_REPLICATE)
        print('%s: ночь Gemini совмещена sx=%.2f sy=%.2f dx=%d dy=%d (corr %.3f)' % (name, *par, score))
        g = gem.astype(np.float32) / 255
        R = (gblur(g, s) + 0.02) / (gblur(d, s) + 0.02)
    else:                                                                            # --like <кадр>: ночи Gemini нет — тон ночи соседнего кадра того же здания
        ref = opt('--like')
        rd = np.asarray(Image.open(fr / (ref + '.webp')).convert('RGB')).astype(np.float32) / 255
        rn = np.asarray(Image.open(fr / (ref + '_night.webp')).convert('RGB')).astype(np.float32) / 255
        Rr = (gblur(rn, 6) + 0.02) / (gblur(rd, 6) + 0.02)
        rsky = np.asarray(Image.open(fr / (ref + '_env.webp')).convert('RGB'))[..., 0] > 127
        R = np.empty_like(d); R[:] = np.median(Rr[~rsky], 0) if (~rsky).any() else 0.35
        print('%s: ночь по тону кадра %s' % (name, ref))
    R = np.clip(R, 0.03, 1.6)
    env = fr / (name + '_env.webp')                                                  # небо: только общий тон ночи Gemini — луну и звёзды рисует движок
    if env.exists():
        sky = gblur(np.asarray(Image.open(env).convert('RGB'))[..., 0].astype(np.float32) / 255, 3.0)[..., None]
        sm = sky[..., 0] > 0.5; Rs = np.empty_like(R)
        if not opt('--night'):                                                       # небо — строки неба кадра-образца
            num = (Rr * rsky[..., None]).sum(1); den = rsky.sum(1)[:, None]
            prof = np.where(den > 20, num / np.maximum(den, 1), np.nan)
            for c in range(3):
                ok = ~np.isnan(prof[:, c]); yk = np.nonzero(ok)[0]
                R[..., c] = np.where(sky[..., 0] > 0.02, np.interp(np.arange(H), yk, prof[ok, c])[:, None], R[..., c])
        for c in range(3):                                                           # по строкам: только вертикальный ход ночного неба, без ореолов и луны Gemini
            num = (R[..., c] * sm).sum(1); den = sm.sum(1)
            row = np.where(den > 20, num / np.maximum(den, 1), np.nan)
            ok = ~np.isnan(row); row = np.interp(np.arange(H), np.nonzero(ok)[0], row[ok]) if ok.any() else np.full(H, R[..., c].mean())
            Rs[..., c] = np.convolve(np.pad(row, 30, mode='edge'), np.ones(61) / 61, 'valid')[:, None]
        R = R * (1 - sky) + Rs * sky
    out = d * R
    # памятник: музейная подсветка снизу
    flood = float(opt('--flood', '0.8'))
    mon = monument_mask(day, bld, opt('--wmask'), opt('--mmask'), bdir, name, W, H)
    if flood > 0 and mon is not None and mon.max() > 0.5:
        bld = mon
        ys = np.nonzero(bld.max(1) > 0.5)[0]; y0, y1 = ys.min(), ys.max(); hgt = max(1, y1 - y0)
        yy = np.arange(H, dtype=np.float32)[:, None]
        k = np.exp(-np.clip(y1 - yy, 0, None) / (0.5 * hgt)) * 0.5 + 0.5      # свет снизу: постамент ярче, фигура — мягче (не в темноте)
        L = d @ np.array([0.299, 0.587, 0.114], np.float32)
        hi = np.clip(gblur(L, 1.2) - gblur(L, 5.0), 0, None) * 1.3                     # выпуклости, блики металла (крупные — не штриховка камня)
        warm = np.array([1.0, 0.86, 0.68], np.float32)
        mb = bld[..., None]
        Rm = (gblur(R * mb, 14) + 1e-4) / (gblur(bld, 14)[..., None] + 1e-4)                     # тени Gemini на памятнике — пятнами; свет музея ровный
        lit = d * (Rm * (1 - k[..., None] * flood) + (k * flood)[..., None] * warm * 0.95) + (hi * (0.6 + k) * flood * 1.8)[..., None] * warm
        m = gblur(cv2.erode(bld, np.ones((3, 3), np.uint8)), 0.8)[..., None]           # строго внутри силуэта, край мягкий
        out = out * (1 - m) + lit * m
    Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(fr / (name + '_night.webp'), quality=90, method=6)
    lamps = []
    if opt('--wmask'):
        wm = load_fit(opt('--wmask'), W, H).astype(int)
        Rr, Gg, Bb = wm[..., 0], wm[..., 1], wm[..., 2]
        blue = (Bb > 150) & (Rr < 100) & (Gg < 100)
        green = (Gg > 150) & (Rr < 120) & (Bb < 120)
        M2, sc2, par2 = align(day, wm.astype(np.uint8), blue | green)
        warp = lambda m: cv2.warpAffine(m.astype(np.uint8), M2, (W, H), flags=cv2.INTER_NEAREST).astype(bool)
        blue, green = warp(blue), warp(green)
        blue &= bld < 0.3                                                             # окна других зданий (у памятника окон нет)
        for box in (opt('--nowin') or '').split(';'):                                 # --nowin u0,v0,u1,v1[;...] — не окна (ниши стены у памятника)
            if box:
                u0, v0, u1, v1 = map(float, box.split(','))
                blue[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)] = False
        L0 = cv2.cvtColor(day, cv2.COLOR_RGB2GRAY).astype(np.float32)
        ink = cv2.morphologyEx(L0, cv2.MORPH_BLACKHAT, np.ones((3, 3), np.uint8)) > INK_T   # тонкие тёмные штрихи (≤ 2 px): переплёты, простенки
        blue &= ~ink                                                                  # режут сплошные полосы Gemini на отдельные окна
        blue = cv2.morphologyEx(blue.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        blue = regularize(blue)
        print('%s: окон для движка %d из %d пятен' % (name, *win_stats(blue)))
        Image.fromarray(np.dstack([blue * 255] * 3).astype(np.uint8)).save(fr / (name + '_win2.webp'), lossless=True)
        nd = bdir / 'source' / 'night'; nd.mkdir(parents=True, exist_ok=True)
        lf = nd / (name + '_lamps.json')
        if lf.exists() and '--relamp' not in a:
            lamps = json.loads(lf.read_text())
        else:
            lamps = find_lamps(green, day, W, H)
            lf.write_text(json.dumps(lamps))
        print('%s: маска окон/фонарей совмещена (corr %.3f): окна %.2f %% кадра, фонарей %d' % (name, sc2, blue.mean() * 100, len(lamps)))
    if '--write' in a and opt('--wmask'):
        write_frame(bdir / 'building.json', name, [l[:4] for l in lamps])
    if opt('--overlay'):
        o = Path(opt('--overlay')); o.mkdir(parents=True, exist_ok=True)
        sh = np.concatenate([d, np.clip(out, 0, 1)], 1)
        Image.fromarray((sh * 255).astype(np.uint8)).resize((W, H // 2)).save(o / ('night_%s.jpg' % name), quality=85)


if __name__ == '__main__':
    main()
