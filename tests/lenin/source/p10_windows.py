#!/usr/bin/env python3
"""s14: окна ищутся НА РИСУНКЕ (а не маской Gemini) → frames/<кадр>_win2.webp (движок зажигает свет ровно в них, nightWins).

  python3 tests/lenin/source/p10_windows.py <кадр> [--report DIR] [--far v0,v1] [--far-p 0.5] [--nowin u0,v0,u1,v1;…] [--none] [--dry]

Окно на карандашном рисунке — маленький тёмный прямоугольник на фасаде, и окна стоят рядами. Поэтому:
1. «тёмное на месте» = закрытие (closing) яркости минус яркость: штрих/проём темнее своего окружения;
2. капли нужного размера (2–16 px по ширине, 3–22 по высоте), плотные (заполнение рамки ≥ 0,45), не нитки штриховки;
3. вне неба, листвы, воды, памятника (слой здания) и земли-площади (светлая ровная заливка);
4. ряд: у окна есть сосед того же размера на той же высоте (±3 px) не дальше 6 его ширин, или над/под ним — иначе это пятно штриха.
5. --far v0,v1 — дальние дома (полоса кадра): там окна почти не нарисованы — кроме найденных ставятся редкие «огоньки» 2×2 px
   по светлым ровным граням фасадов (сетка с шагом 7–9 px, только где грань ровная), чтобы дальний город ночью тоже жил.
Маска: окно = его рамка, сжатая на 1 px внутрь (свет не вылезает на стену). Отчёт — наложение найденных окон на день и ночь.
"""
import sys, json
from pathlib import Path
import numpy as np, cv2
from PIL import Image

B = Path(__file__).resolve().parents[1]
FD = B / 'frames'


def find(name, far=None, seed=7, nowin=(), far_p=0.5):
    day = np.asarray(Image.open(FD / (name + '.webp')).convert('RGB'))
    H, W = day.shape[:2]
    bj = json.load(open(B / 'building.json'))
    fr = next(f for f in bj['frames'] if f['name'] == name)
    sky_end = fr['sky']['end']
    L = cv2.cvtColor(day, cv2.COLOR_RGB2GRAY).astype(np.float32)
    hsv = cv2.cvtColor(day, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    # где окон не бывает
    leaf = (h >= 28) & (h <= 88) & (s >= 45)
    water = (h >= 92) & (h <= 128) & (s >= 70)
    bld = np.asarray(Image.open(FD / (name + '_building.webp')))[..., 3] > 40     # памятник (главный слой кадра)
    env = np.asarray(Image.open(FD / (name + '_env.webp')).convert('RGB'))
    sky = env[..., 0] > 127
    bad = leaf | water | bld
    near_leaf = cv2.dilate(leaf.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    bad = cv2.dilate(bad.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    bad[:int(H * sky_end)] = True   # небо кадра (выше нижней границы неба)
    bad |= sky & (np.arange(H)[:, None] < H * (sky_end + 0.05))
    # фасад: тёплый/серый тон стены, не светлая заливка площади (почти белое, ровное)
    loc_sd = cv2.GaussianBlur(np.abs(L - cv2.GaussianBlur(L, (0, 0), 3)), (0, 0), 4)
    plaza = (v > 228) & (s < 40) & (loc_sd < 4)
    bad |= cv2.dilate(plaza.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & False
    clo = cv2.morphologyEx(L, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (13, 13)))
    dark = clo - L
    boxes = []
    for thr in (24, 32, 42, 56, 16):   # несколько порогов: светлое окно на светлой стене и тёмное в штриховке
        cand = ((dark > thr) & ~bad).astype(np.uint8)
        # окно, нарисованное контуром (светлое внутри): дырки капель заливаем — рамка становится окном
        ff = np.pad(cand, 1).copy(); m2 = np.zeros((H + 4, W + 4), np.uint8)
        cv2.floodFill(ff, m2, (0, 0), 1)
        holes = (1 - ff[1:-1, 1:-1]).astype(np.uint8)
        nh, lh, sh_, _ = cv2.connectedComponentsWithStats(holes, 4)
        cand = cand | np.isin(lh, [i for i in range(1, nh) if sh_[i][4] <= 120]).astype(np.uint8)
        n, lab, st, cen = cv2.connectedComponentsWithStats(cand, 8)
        for i in range(1, n):
            x, y, w, hh, a = st[i]
            if not (1 <= w <= 18 and 4 <= hh <= 34 and a >= 4):
                continue
            fill = a / float(w * hh)
            asp = hh / float(w)
            if fill < 0.42 or asp < 0.7 or asp > 7:
                continue
            if dark[y:y + hh, x:x + w][lab[y:y + hh, x:x + w] == i].mean() < thr + 10:
                continue
            y0, x0 = max(0, y - 4), max(0, x - 4)
            li = lab[y0:y + hh + 4, x0:x + w + 4] == i
            ring = cv2.dilate(li.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool) & ~li
            sub = day[y0:y + hh + 4, x0:x + w + 4][ring]
            labc = cv2.cvtColor(sub[None].astype(np.uint8), cv2.COLOR_RGB2LAB)[0].astype(int)
            light = np.median(labc[:, 0]) > 232 and np.median(labc[:, 1]) - 128 < 6   # светлая заливка (светлый фасад или площадь с людьми)
            dup = False
            for q in boxes:   # то же окно на другом пороге — берём первое (более полное)
                ix = min(x + w, q[0] + q[2]) - max(x, q[0]); iy = min(y + hh, q[1] + q[3]) - max(y, q[1])
                if ix > 0 and iy > 0:
                    dup = True
                    break
            if not dup:
                boxes.append([int(x), int(y), int(w), int(hh), thr if not light else 0])
    # окна, нарисованные контуром и связанные с карнизами (арки фасада B): сами «дырки» в штрихе нужного размера и вида
    for thr in (24, 34):
        cand = ((dark > thr)).astype(np.uint8)
        ff = np.pad(cand, 1).copy(); m2 = np.zeros((H + 4, W + 4), np.uint8)
        cv2.floodFill(ff, m2, (0, 0), 1)
        holes = (1 - ff[1:-1, 1:-1]).astype(np.uint8)
        nh, lh, st, _ = cv2.connectedComponentsWithStats(holes, 4)
        for i in range(1, nh):
            x, y, w, hh, a_ = st[i]
            if not (2 <= w <= 16 and 4 <= hh <= 30 and a_ >= 6) or bad[y:y + hh, x:x + w].mean() > 0.2:
                continue
            if a_ / float(w * hh) < 0.5 or not (0.8 <= hh / float(w) <= 4.5):
                continue
            if np.median(L[y:y + hh, x:x + w][lh[y:y + hh, x:x + w] == i]) > 222:   # светлая плитка площади — не окно
                continue
            if any(min(x + w, q[0] + q[2]) - max(x, q[0]) > 0 and min(y + hh, q[1] + q[3]) - max(y, q[1]) > 0 for q in boxes):
                continue
            boxes.append([int(x), int(y), int(w), int(hh), 1])   # 1 — как у светлых: только в ряду из трёх
    # окна со штриховкой внутри на штрихованном фасаде (арки B): темнее стены «в среднем» — сравнение двух размытий
    Lb = cv2.GaussianBlur(L, (0, 0), 1.4)
    d2 = cv2.GaussianBlur(L, (0, 0), 7) - Lb
    for thr in (10, 16):
        cand = ((d2 > thr) & ~bad).astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(cand, 8)
        for i in range(1, n):
            x, y, w, hh, a_ = st[i]
            if not (3 <= w <= 16 and 5 <= hh <= 30 and a_ >= 12):
                continue
            if a_ / float(w * hh) < 0.55 or not (1.0 <= hh / float(w) <= 3.6):
                continue
            if any(min(x + w, q[0] + q[2]) - max(x, q[0]) > 0 and min(y + hh, q[1] + q[3]) - max(y, q[1]) > 0 for q in boxes):
                continue
            boxes.append([int(x), int(y), int(w), int(hh), 1])
    # ряды: сосед того же размера на той же высоте или в той же колонке
    keep = []
    for j, (x, y, w, hh, tj) in enumerate(boxes):
        ok = 0
        for k, (x2, y2, w2, h2, _) in enumerate(boxes):
            if k == j:
                continue
            sim = abs(w - w2) <= max(2, 0.45 * w) and abs(hh - h2) <= max(3, 0.45 * hh)
            if not sim:
                continue
            row = abs((y + hh / 2) - (y2 + h2 / 2)) <= 3 and abs((x + w / 2) - (x2 + w2 / 2)) <= max(6 * w, 30)
            col = abs((x + w / 2) - (x2 + w2 / 2)) <= 3 and abs((y + hh / 2) - (y2 + h2 / 2)) <= max(4 * hh, 34)
            if row or col:
                ok += 1
        if ok >= (2 if tj < 20 else 1):   # светлые окна (порог 16) и окна на светлой заливке — только в ряду из трёх (люди на площади рядами не стоят)
            keep.append([x, y, w, hh, tj])
    # повторы: окна фасада одинаковые — каждое найденное окно ищем по всему рисунку (нормированная корреляция),
    # совпадения > 0,78, темнее стены вокруг и не в запретных зонах — тоже окна (так находятся ряды арок, связанных с карнизами)
    seeds = [b for b in keep if b[2] >= 5 and b[3] >= 9]
    Lp = cv2.GaussianBlur(L, (0, 0), 0.8)
    found = []
    for x, y, w, hh, _ in seeds:
        if x < 2 or y < 2 or x + w + 2 >= W or y + hh + 2 >= H:
            continue
        tpl = Lp[y - 2:y + hh + 2, x - 2:x + w + 2]
        if tpl.std() < 8:
            continue
        r = cv2.matchTemplate(Lp, tpl, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(r > 0.84)
        for yy, xx in zip(ys, xs):
            bx, by = int(xx) + 2, int(yy) + 2
            if bad[by:by + hh, bx:bx + w].mean() > 0.2:
                continue
            inner = L[by:by + hh, bx:bx + w].mean()
            outer = L[max(0, by - 3):by + hh + 3, max(0, bx - 3):bx + w + 3].mean()
            if outer - inner < 9:
                continue
            found.append((float(r[yy, xx]), bx, by, w, hh))
    found.sort(reverse=True)
    allb = [b[:4] for b in keep]
    newb = []
    for sc, x, y, w, hh in found:
        if any(min(x + w, q[0] + q[2]) - max(x, q[0]) > 0 and min(y + hh, q[1] + q[3]) - max(y, q[1]) > 0 for q in allb + newb):
            continue
        newb.append([x, y, w, hh])
    for x, y, w, hh in newb:   # найденное повтором — только в ряду (сосед по ряду ≤ 3 ширин)
        if sum(1 for q in allb + newb if q is not None and (q[0], q[1]) != (x, y) and abs((y + hh / 2) - (q[1] + q[3] / 2)) <= 0.6 * hh
               and abs((x + w / 2) - (q[0] + q[2] / 2)) <= 3.2 * w) >= 1:
            allb.append([x, y, w, hh])
    keep = [b + [0] for b in allb]
    def crowded(b):   # плотная куча «окон» без простенков — это штриховка мостовой/крыши
        cx, cy = b[0] + b[2] / 2, b[1] + b[3] / 2
        return sum(1 for q in keep if q is not b and abs(q[0] + q[2] / 2 - cx) < 1.3 * max(b[2], q[2]) and abs(q[1] + q[3] / 2 - cy) < 1.15 * max(b[3], q[3])) >= 2
    keep = [b for b in keep if not crowded(b)]
    keep = [b for b in keep if near_leaf[b[1]:b[1] + b[3], b[0]:b[0] + b[2]].mean() < 0.5]   # тёмное в кронах и у крон — тень листвы, не окно
    # s14: не окна — всё, что стоит на дороге/площади (маска дорог кадра), и рамки --nowin (трибуна, штриховка мостовой)
    rdp = B / 'source/roads' / (name + '_roads.png')
    if rdp.exists():
        rd = np.asarray(Image.open(rdp).convert('L').resize((W, H), Image.NEAREST)) > 127
        rd = cv2.dilate(rd.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        keep = [b for b in keep if not rd[b[1] + b[3] // 2, b[0] + b[2] // 2]]
    for u0, v0, u1, v1 in nowin:
        keep = [b for b in keep if not (u0 * W <= b[0] + b[2] / 2 <= u1 * W and v0 * H <= b[1] + b[3] / 2 <= v1 * H)]
    mask = np.zeros((H, W), np.uint8)
    for x, y, w, hh, _ in keep:   # рамка окна, на 1 px внутрь у крупных
        sh = 1 if (w >= 5 and hh >= 6) else 0
        mask[y + sh:y + hh - sh, x + sh:x + w - sh] = 255
    lights = []
    if far:   # дальние дома: редкие огоньки на ровных гранях фасадов
        v0, v1 = far
        rng = np.random.default_rng(seed)
        flat = (loc_sd < 3.2) & (L > 150) & (L < 236) & ~bad & ~sky & (dark < 10)
        flat = cv2.erode(flat.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
        y = int(v0 * H)
        while y < int(v1 * H):
            x = int(W * 0.05) + int(rng.integers(0, 6))
            while x < W * 0.95:
                if flat[y, x] and flat[y + 1, x + 1] and not mask[max(0, y - 6):y + 8, max(0, x - 6):x + 8].any() and rng.random() < far_p:
                    mask[y:y + 2, x:x + 2] = 255
                    lights.append([x, y])
                x += int(rng.integers(7, 10))
            y += int(rng.integers(7, 10))
    return day, mask, keep, lights


def main():
    a = sys.argv[1:]
    name = a[0]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    far = [float(x) for x in opt('--far').split(',')] if opt('--far') else None
    nowin = [tuple(map(float, b.split(','))) for b in (opt('--nowin') or '').split(';') if b]
    day, mask, keep, lights = find(name, far, nowin=nowin, far_p=float(opt('--far-p', 0.5)))
    if '--none' in a:   # кадр без домов (крупный план памятника): окон нет — пустая маска, движок ничего не зажжёт
        mask[:] = 0; keep, lights = [], []
    H, W = mask.shape
    print('%s: окон на рисунке %d, огоньков дальних домов %d' % (name, len(keep), len(lights)))
    if '--dry' not in a:
        Image.fromarray(np.dstack([mask] * 3)).save(FD / (name + '_win2.webp'), lossless=True)
    rep = opt('--report')
    if rep:
        rp = Path(rep); rp.mkdir(parents=True, exist_ok=True)
        night = np.asarray(Image.open(FD / (name + '_night.webp')).convert('RGB')).astype(np.float32)
        out = []
        for base in (day.astype(np.float32), night):
            ov = base.copy()
            ed = cv2.dilate(mask, np.ones((3, 3), np.uint8)) - mask
            ov[ed > 0] = [0, 255, 255]
            ov[mask > 0] = ov[mask > 0] * 0.4 + np.array([255, 200, 60]) * 0.6
            out.append(ov.astype(np.uint8))
        Image.fromarray(np.hstack(out)).save(rp / ('windows_%s.png' % name))
        json.dump({'windows': keep, 'far_lights': lights}, open(rp / ('windows_%s.json' % name), 'w'))


if __name__ == '__main__':
    main()
