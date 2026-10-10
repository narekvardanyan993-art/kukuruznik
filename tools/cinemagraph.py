#!/usr/bin/env python3
"""Синемаграф из видео Veo поверх полного резкого рисунка (e1.15, docs/ENGINE-LIFE.md «Синемаграф»).

  python3 tools/cinemagraph.py tests/<здание> <кадр> veo1.mp4[,veo2.mp4…] [--fps 20] [--fade 1.0] [--period 30] [--thr 9]
          [--crf 30] [--exclude u0,v0,u1,v1;...] [--allow маска.png] [--car-area 700] [--ext-s 6] [--ext-deg 55] [--seed 1]
          [--cache DIR] [--report DIR]
  Кадр без машин (крупный план): --car-area 100000. Несколько клипов через запятую: проезды берутся из всех, фон чередуется.

e1.15 (круг s9): машины больше не исчезают посреди кадра и узор не повторяется раньше ~30 с.
1. Кадры каждого видео приводятся к размеру кадра и совмещаются с рисунком (сдвиг/масштаб по контурам).
2. Маска движения: разброс яркости по времени > --thr (без слоя здания, водяного знака и рамок --exclude) — или готовая --allow
   (альфа PNG, например прошлая маска кадра: так сохраняются исключения, подобранные раньше).
3. МАШИНЫ (капли движения ≥ --car-area px, ровная форма, не быстрее 7 px/кадр — не стая птиц): трекинг по кадрам видео.
   Проезд должен начинаться и кончаться у края маски (край кадра, здание, дерево, конец дороги — машина там видна не целиком).
   Чего не хватает (видео 10 с короче проезда: машина уже ехала в начале или ещё едет в конце) — достраивается: кадр машины из
   видео едет дальше по «полосе» (места, где ездили машины) той же скоростью, с масштабом по перспективе и поворотом с дорогой
   (до --ext-s 6 с, до --ext-deg 55°), пока не доедет до края. Не доехала — проезд не берётся. Капли, где две машины слились
   (ошибка Veo «сквозь друг друга»), и 8 кадров вокруг слияния не берутся.
   Расписание: проезды в случайные моменты по кругу ролика (у каждой полосы свой случайный узор, один проезд — не чаще раза в
   треть ролика), две машины никогда не перекрываются; плотность — как в исходном видео (сколько получится без перекрытий).
   Ролик закольцован по кругу: проезд, начавшийся в конце, продолжается в начале — шва нет, машина не пропадает посреди кадра.
   Места, где ездили машины, в фоновый слой не попадают: там рисуются только проезды.
4. ФОН (голуби, люди, листва, вода): петля длиной видео − --fade с кроссфейдом; несколько клипов чередуются по кругам.
   Длина ролика = целое число петель фона ≥ --period секунд — общий узор не повторяется раньше.
5. Вывод: frames/<кадр>_motion.mp4 (H.264 baseline, faststart, без звука — iPhone inline), _motion.webm (VP9),
   _motion_mask.png (альфа), _motion_cars.json — треки машин в ролике (для ночных фар движка):
   {"fps", "n" (кадров), "k" (шаг точек), "cars": [{"s": кадр начала, "p": [[u, v, dx, dy, длина, ширина], …]}]} (доли кадра).
   --report: маска, полосы, лента кадров, stats.
"""
import json, math, random, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_road_mask import align  # noqa: E402


def read_frames(path, W, H, fps):
    tmp = Path(tempfile.mkdtemp())
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-vf', 'fps=%g,scale=%d:%d:flags=lanczos' % (fps, W, H), str(tmp / 'f_%04d.png')], check=True)
    fr = [np.asarray(Image.open(p).convert('RGB')) for p in sorted(tmp.glob('f_*.png'))]
    for p in tmp.glob('*'):
        p.unlink()
    tmp.rmdir()
    return fr


def diff_maps(frames, bg):
    return np.stack([cv2.GaussianBlur(np.abs(f.astype(np.float32) - bg).max(-1), (0, 0), 1.5).astype(np.float16) for f in frames])


def fill_holes(allow, small=4000):
    """Маленькие дырки маски (фонарь, киоск, столбик) — не край: машина за ними не «уезжает»."""
    n, lab, st, _ = cv2.connectedComponentsWithStats((~allow).astype(np.uint8))
    out = allow.copy()
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < small and x > 0 and y > 0 and x + w < allow.shape[1] and y + h < allow.shape[0]:
            out[lab == i] = True
    return out


def track_cars(D, allow, car_area, ct=14.0):
    """Капли движения → треки. Возвращает список треков: t0, end, pts [(cx, cy, area, x, y, w, h, crop)], флаги."""
    T, H, W = D.shape
    tracks, active = [], []
    for t in range(T):
        fg = ((D[t].astype(np.float32) > ct) & allow).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        n, lab, st, cen = cv2.connectedComponentsWithStats(fg)
        cs = [(i, st[i], cen[i]) for i in range(1, n) if st[i][4] >= max(40, car_area * 0.2)]
        used, nxt = {}, []
        for tr in active:
            p = np.array(tr['pts'][-1][:2]); v = tr['v']; pr = p + v
            best, bd = None, 1e9
            for j, (i, s, c) in enumerate(cs):
                d = math.hypot(*(c - pr)); r = 10 + 0.6 * math.hypot(*v) + 0.25 * math.sqrt(s[4])
                if d < r and d < bd:
                    bd, best = d, j
            if best is None:
                tr['end'] = t - 1; tracks.append(tr); continue
            used.setdefault(best, []).append(tr)
        for j, trs in used.items():
            i, s, c = cs[j]
            if len(trs) > 1:                                  # две капли слились: машины прошли друг сквозь друга / вплотную — оба проезда не берём
                for tr in trs:
                    tr['end'] = t - 1; tr['merged'] = True; tracks.append(tr)
                continue
            tr = trs[0]; a0 = tr['pts'][-1][2]
            if s[4] > 2.2 * a0 + 40 or s[4] < a0 / 2.2 - 40:  # капля резко выросла/сжалась — слияние/распад
                tr['end'] = t - 1; tr['jump'] = True; tracks.append(tr); continue
            tr['v'] = 0.6 * tr['v'] + 0.4 * (c - np.array(tr['pts'][-1][:2]))
            x, y, w, h = s[:4]
            tr['pts'].append((c[0], c[1], s[4], x, y, w, h, lab[y:y + h, x:x + w] == i))
            nxt.append(tr)
        for j, (i, s, c) in enumerate(cs):
            if j not in used:
                x, y, w, h = s[:4]
                nxt.append({'t0': t, 'v': np.zeros(2), 'pts': [(c[0], c[1], s[4], x, y, w, h, lab[y:y + h, x:x + w] == i)]})
        active = nxt
    for tr in active:
        tr['end'] = T - 1; tracks.append(tr)
    dist = cv2.distanceTransform(np.pad(fill_holes(allow), 1).astype(np.uint8), cv2.DIST_L2, 3)[1:-1, 1:-1]
    cars = []
    for tr in tracks:
        P = tr['pts']
        if len(P) < 8:
            continue
        med = float(np.median([p[2] for p in P]))
        disp = math.hypot(P[-1][0] - P[0][0], P[-1][1] - P[0][1])
        if med < car_area or disp < 25:
            continue
        A = np.array([p[2] for p in P], np.float32); C = np.array([p[:2] for p in P], np.float32)
        spd = np.hypot(*np.diff(C, axis=0).T)
        if A.std() / A.mean() > 0.4 or spd.mean() > 7 or np.mean([p[7].mean() for p in P]) < 0.5:
            continue                                                       # не машина: стая птиц (быстро, меняет форму), рябь, слипшиеся капли

        def edge(p):   # машина у края: касается края кадра, или видна не целиком (въезжает/уезжает) у края маски (здание, дерево, конец дороги)
            cx, cy, a, x, y, w, h, _ = p
            if x <= 1 or y <= 1 or x + w >= W - 1 or y + h >= H - 1:
                return True
            return a < 0.75 * med and dist[int(min(H - 1, cy)), int(min(W - 1, cx))] < 0.7 * math.sqrt(med) + 8
        tr['med'] = med
        tr['in'] = tr['t0'] > 0 and edge(P[0])
        tr['out'] = tr['end'] < T - 1 and edge(P[-1]) and not tr.get('merged') and not tr.get('jump')
        if tr.get('merged') or tr.get('jump'):
            tr['out'] = False
        cars.append(tr)
    return cars


def persp_fit(cars, H):
    """Размер машины по перспективе рисунка: sqrt(площади) ≈ a + b·y (по всем трекам)."""
    ys = np.array([p[1] for c in cars for p in c['pts']]); ss = np.sqrt([p[2] for c in cars for p in c['pts']])
    if len(ys) < 10 or np.ptp(ys) < 20:
        return lambda y: 1.0
    b_, a_ = np.polyfit(ys, ss, 1)
    return lambda y: max(0.3, a_ + b_ * y)


def extend(tr, side, zone, allow_d, size_at, W, H, max_n, max_deg=55):
    """Достроить проезд до края маски: машина (её последний/первый кадр из видео) едет дальше по дороге той же скоростью,
    поворачивая вместе с дорогой (держится внутри «полос» — мест, где ездили машины), пока не дойдёт до края маски/кадра.
    side +1 — вперёд от конца трека, −1 — назад от начала. Возвращает [(x, y, масштаб, поворот°)] от трека к краю или None."""
    P = np.array([p[:2] for p in tr['pts']], np.float32)
    if len(P) < 12:
        return None
    if side < 0:
        P = P[::-1]
    v1 = (P[-1] - P[-7]) / 6; v0 = (P[-7] - P[-13]) / 6
    sp = float(np.hypot(*v1))
    if sp < 0.6:
        return None
    h = math.atan2(v1[1], v1[0]); om = math.atan2(v0[0] * v1[1] - v0[1] * v1[0], float(np.dot(v0, v1))) / 6
    om = max(-0.02, min(0.02, om))
    p = P[-1].astype(np.float64); s0 = size_at(p[1]); out = []; h0 = h
    rad = 0.35 * math.sqrt(tr['med'])
    for n in range(max_n):
        ok = None
        for dd in (0, 4, -4, 8, -8, 14, -14, 22, -22):
            hh = h + om + math.radians(dd)
            q = p + sp * np.array([math.cos(hh), math.sin(hh)])
            q4 = p + 5 * sp * np.array([math.cos(hh), math.sin(hh)])
            def inz(z):
                x, y = int(round(z[0])), int(round(z[1]))
                return not (0 <= x < W and 0 <= y < H) or zone[y, x] or allow_d[y, x] < rad
            if inz(q) and inz(q4):
                ok = (hh, q); break
        if ok is None:
            return None
        h, p = ok; om *= 0.97
        if abs(math.degrees(math.atan2(math.sin(h - h0), math.cos(h - h0)))) > max_deg:
            return None                                                        # дорога сильно поворачивает — застывший кадр машины не годится
        out.append((p[0], p[1], size_at(p[1]) / s0, math.degrees(math.atan2(math.sin(h - h0), math.cos(h - h0)))))
        x, y = int(round(p[0])), int(round(p[1]))
        if not (2 <= x < W - 2 and 2 <= y < H - 2) or allow_d[y, x] < rad:
            return out                                                         # доехала до края маски/кадра
    return None


def end_crop(tr, clips, mask, j, pad=8):
    """Кадр машины из видео (пиксели + вес) для достройки: машина и её тень, без фона видео."""
    C = clips[tr['clip']]; p = tr['pts'][j]; x, y, w, h = p[3:7]; H, W = mask.shape
    x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad)
    m = np.zeros((y1 - y0, x1 - x0), np.uint8); m[y - y0:y - y0 + h, x - x0:x - x0 + w] = p[7]
    ms = cv2.GaussianBlur(cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))).astype(np.float32), (0, 0), 1.5)
    fe = C['fr'][tr['t0'] + j, y0:y1, x0:x1].astype(np.float32)
    de = cv2.GaussianBlur(np.abs(fe - C['bg'][y0:y1, x0:x1]).max(-1), (0, 0), 1.5)
    return {'rgb': fe, 'w': np.clip((de - 10) / 18, 0, 1) * ms, 'c': (p[0] - x0, p[1] - y0)}


def main():
    a = sys.argv[1:]
    bdir, name, srcs = Path(a[0]), a[1], a[2].split(',')
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    fps, fade, thr, crf = float(opt('--fps', 20)), float(opt('--fade', 1.0)), float(opt('--thr', 9)), int(opt('--crf', 30))
    period, car_area, seed = float(opt('--period', 30)), float(opt('--car-area', 700)), int(opt('--seed', 1))
    R = random.Random(seed)
    fd = bdir / 'frames'
    day = np.asarray(Image.open(fd / (name + '.webp')).convert('RGB'))
    H, W = day.shape[:2]
    H2, W2 = H - H % 2, W - W % 2                                                     # H.264 — чётные стороны
    bld = np.asarray(Image.open(fd / (name + '_building.webp')))[..., 3] > 60
    clips = []
    for src in srcs:
        cache = Path(opt('--cache')) / ('%s_%s_%g.npz' % (name, Path(src).stem, fps)) if opt('--cache') else None   # --cache DIR: совмещённые кадры (для повторных прогонов)
        if cache and cache.exists():
            z = np.load(cache); fr, par, score = z['fr'], tuple(z['par']), float(z['score'])
        else:
            fr = read_frames(src, W, H, fps)
            M, score, par = align(day, fr[0], np.zeros((H, W), bool))
            fr = np.stack([cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REPLICATE) for f in fr])
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True); np.savez(cache, fr=fr, par=np.array(par, np.float32), score=score)
        bg = np.median(fr[::4].astype(np.float32), 0)                                 # неподвижный фон видео (медиана по времени)
        clips.append({'src': src, 'fr': fr, 'bg': bg, 'D': diff_maps(fr, bg), 'par': par, 'corr': score})
        print('%s: %s — %d кадров по %g к/с, совмещено sx=%.3f sy=%.3f dx=%d dy=%d (corr %.3f)' % (name, Path(src).name, len(fr), fps, *par, score))
    # 2. маска движения
    excl = np.zeros((H, W), bool)
    excl[int(H * 0.93):, int(W * 0.72):] = True                                        # водяной знак Veo
    for box in (opt('--exclude') or '').split(';'):
        if box:
            u0, v0, u1, v1 = map(float, box.split(','))
            excl[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)] = True
    if opt('--allow'):
        al = np.asarray(Image.open(opt('--allow')).convert('LA'))[..., 1].astype(np.float32) / 255
        mask = np.zeros((H, W), np.float32); mask[:al.shape[0], :al.shape[1]] = al[:H, :W]
    else:
        L = np.stack([cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (0, 0), 1.6).astype(np.float32) for f in clips[0]['fr']])
        mv = (L.std(0) > thr).astype(np.uint8)
        mv[excl | cv2.dilate(bld.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)] = 0
        mv = cv2.morphologyEx(mv, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(mv)
        mv = np.isin(lab, [i for i in range(1, n) if st[i][4] >= 12]).astype(np.uint8)
        mv = cv2.dilate(mv, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
        mask = np.clip(cv2.GaussianBlur(mv.astype(np.float32), (0, 0), 3.0) * 1.6, 0, 1)
    mask[excl] = 0
    allow = mask > 0.3
    print('%s: в движении %.1f %% кадра' % (name, (mask > 0.5).mean() * 100))
    # 3. машины: треки → проезды от края до края (недостающее начало/конец достраивается движением кадра машины по дороге)
    cars, zone, n_merged = [], np.zeros((H, W), np.uint8), 0
    for ci, C in enumerate(clips):
        for tr in track_cars(C['D'], allow, car_area):
            tr['clip'] = ci
            for p in tr['pts']:
                x, y, w, h = p[3:7]
                zone[y:y + h, x:x + w] |= p[7].astype(np.uint8)
            if tr.get('merged') or tr.get('jump'):                                 # у слияния (машины сквозь друг друга) кадры не берём
                n_merged += 1; tr['pts'] = tr['pts'][:-8]
            if tr['t0'] > 0 and not tr['in']:                                      # родилась посреди дороги (после слияния/распада)
                tr['pts'] = tr['pts'][8:]; tr['t0'] += 8
            if len(tr['pts']) >= 12:
                cars.append(tr)
    lane_px = cv2.dilate(zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))).astype(bool)   # где ездят машины
    zone = cv2.dilate(zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)))
    zsoft = np.clip(cv2.GaussianBlur(zone.astype(np.float32), (0, 0), 3.0) * 1.5, 0, 1)
    allow_d = cv2.distanceTransform(np.pad(fill_holes(allow), 1).astype(np.uint8), cv2.DIST_L2, 3)[1:-1, 1:-1]
    size_at = persp_fit(cars, H)
    PRE, MAXX, MAXD = 3, int(float(opt('--ext-s', 6)) * fps), float(opt('--ext-deg', 55))   # достройка: до 6 с, поворот дороги до 55°
    passes, n_ext, n_drop = [], 0, 0
    for k_, X in enumerate(cars):
        L = len(X['pts'])
        head = None if X['in'] else extend(X, -1, lane_px, allow_d, size_at, W, H, MAXX, MAXD)
        tail = None if X['out'] else extend(X, +1, lane_px, allow_d, size_at, W, H, MAXX, MAXD)
        if (not X['in'] and head is None) or (not X['out'] and tail is None):
            n_drop += 1; continue
        tl = []                                                                    # по кадрам: ('r', трек, индекс, вес) или ('s', трек, кадр, x, y, масштаб, поворот, вес)
        if head:
            X['crop0'] = end_crop(X, clips, mask, 0)
            for q in head[::-1]:
                tl.append(('s', k_, 'crop0') + q + (1.0,))
        else:
            tl += [('r', k_, -q, 0.5) for q in range(PRE, 0, -1)]
        tl += [('r', k_, j, 1.0) for j in range(L)]
        if tail:
            X['crop1'] = end_crop(X, clips, mask, L - 1)
            for q in tail:
                tl.append(('s', k_, 'crop1') + q + (1.0,))
        else:
            tl += [('r', k_, L + q, 0.5) for q in range(PRE)]
        n_ext += bool(head) + bool(tail)
        passes.append({'k': k_, 'tl': tl, 'real': L})
    whole = sum(1 for c in cars if c['in'] and c['out'])
    print('%s: машин-треков %d (целых проездов %d, слияний вырезано %d), достроено концов %d, не годится %d, проездов %d' % (
        name, len(cars), whole, n_merged, n_ext, n_drop, len(passes)))
    # 4. длина ролика = k петель фона
    T_in = min(len(C['fr']) for C in clips)
    n_fade = int(round(fade * fps))
    n_loop = T_in - n_fade
    k = max(1, math.ceil(period * fps / n_loop))
    N = k * n_loop
    order = [R.randrange(len(clips)) for _ in range(k)] if len(clips) > 1 else [0] * k
    # расписание: случайные проезды в случайные моменты по кругу ролика (у каждой полосы свой случайный узор), без пересечений машин
    # (рамки, ужатые на 15 %); каждый проезд — не чаще, чем раз в ~треть ролика; плотность — как в исходном видео
    occ = [[] for _ in range(N)]

    def item_box(it):
        X = cars[it[1]]
        if it[0] == 'r':
            P = X['pts']; p = P[min(max(it[2], 0), len(P) - 1)]; x, y, w, h = p[3:7]
        else:
            P = X['pts']; p = P[0] if it[2] == 'crop0' else P[-1]; sc = it[5]
            w, h = p[5] * sc, p[6] * sc; x, y = it[3] - w / 2, it[4] - h / 2
        sx, sy = w * 0.15, h * 0.15
        return (x + sx, y + sy, x + w - sx, y + h - sy)

    def boxes(tl, s):
        return [((s + i) % N, item_box(it)) for i, it in enumerate(tl) if it[-1] >= 0.99]

    def free(bx):
        for t, (x0, y0, x1, y1) in bx:
            for (a0, b0, a1, b1) in occ[t]:
                if x0 < a1 and a0 < x1 and y0 < b1 and b0 < y1:
                    return False
        return True
    target = sum(len(c['pts']) for c in cars) / len(clips) * N / T_in
    events, placed, uses = [], 0, {}
    if passes:   # e1.15: старты распределены по ролику ровно (слоты ± дрожь), чтобы дорога не пустела надолго; в слоте — случайный проезд
        avg = sum(len(ps['tl']) for ps in passes) / len(passes)
        M = max(1, int(round(target / avg)))
        for sl in range(M * 3):
            if placed >= target:
                break
            base = int((sl % M + R.uniform(-0.35, 0.35)) * N / M) % N
            order_p = list(range(len(passes))); R.shuffle(order_p)
            done_ = False
            for sh in (0, 6, -6, 12, -12, 20, -20, 30, -30, 45, -45):
                s = (base + sh) % N
                for pi in order_p:
                    tl = passes[pi]['tl']
                    if any(min((s - s0) % N, (s0 - s) % N) < N / 3 for s0 in uses.get(pi, [])):
                        continue
                    bx = boxes(tl, s)
                    if free(bx):
                        for t, bb in bx:
                            occ[t].append(bb)
                        events.append({'tl': tl, 's': s, 'pass': pi}); placed += len(tl); uses.setdefault(pi, []).append(s); done_ = True
                        break
                if done_:
                    break
    print('%s: ролик %d кадров (%.1f с = %d петель фона по %.1f с), проездов в ролике %d, машино-кадров %d из %d (как в исходнике)' % (
        name, N, N / fps, k, n_loop / fps, len(events), placed, target))
    # 5. сборка кадров ролика
    d = day.astype(np.float32)
    ker, kerw = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    tmp = Path(tempfile.mkdtemp())
    raw = open(tmp / 'out.rgb', 'wb')
    strip = []

    def put(o, it):
        X = cars[it[1]]
        if it[0] == 's':                                                           # достроенный кусок: кадр машины, сдвиг/масштаб/поворот
            cr = X[it[2]]; x, y, sc, rot, wgt = it[3], it[4], it[5], it[6], it[7]
            ch, cw = cr['w'].shape
            Mx = cv2.getRotationMatrix2D(cr['c'], -rot, sc); Mx[0, 2] += x - cr['c'][0]; Mx[1, 2] += y - cr['c'][1]
            r_ = int(max(ch, cw) * sc) + 4
            x0, y0, x1, y1 = max(0, int(x) - r_), max(0, int(y) - r_), min(W, int(x) + r_), min(H, int(y) + r_)
            if x1 <= x0 or y1 <= y0:
                return
            Mx[0, 2] -= x0; Mx[1, 2] -= y0
            fe = cv2.warpAffine(cr['rgb'], Mx, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderValue=0)
            we = (cv2.warpAffine(cr['w'], Mx, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderValue=0) * mask[y0:y1, x0:x1] * wgt)[..., None]
            o[y0:y1, x0:x1] = o[y0:y1, x0:x1] * (1 - we) + fe * we
            return
        j, wgt = it[2], it[3]; P = X['pts']; L = len(P)
        jj = min(max(j, 0), L - 1); src = X['t0'] + j; Cc = clips[X['clip']]
        if src < 0 or src >= len(Cc['fr']):
            return
        p = P[jj]; x, y, w, h = p[3:7]
        g = 6 if j == jj else 18
        x0, y0, x1, y1 = max(0, x - g), max(0, y - g), min(W, x + w + g), min(H, y + h + g)
        m = np.zeros((y1 - y0, x1 - x0), np.uint8); m[y - y0:y - y0 + h, x - x0:x - x0 + w] = p[7]
        ms = cv2.GaussianBlur(cv2.dilate(m, ker if j == jj else kerw).astype(np.float32), (0, 0), 1.5)
        fe = Cc['fr'][src, y0:y1, x0:x1].astype(np.float32)
        de = cv2.GaussianBlur(np.abs(fe - Cc['bg'][y0:y1, x0:x1]).max(-1), (0, 0), 1.5)
        we = (np.clip((de - 10) / 18, 0, 1) * ms * mask[y0:y1, x0:x1] * wgt)[..., None]
        o[y0:y1, x0:x1] = o[y0:y1, x0:x1] * (1 - we) + fe * we
    for t in range(N):
        c, i = divmod(t, n_loop)
        C = clips[order[c]]
        f = C['fr'][i].astype(np.float32); bgf = C['bg']
        if i < n_fade:                                                               # шов фона: хвост прошлой петли растворяется в начало
            kk = (i + 1) / (n_fade + 1); P = clips[order[(c - 1) % k]]
            f = f * kk + P['fr'][n_loop + i].astype(np.float32) * (1 - kk)
            bgf = bgf * kk + P['bg'] * (1 - kk)
        dv = cv2.GaussianBlur(np.abs(f - bgf).max(-1), (0, 0), 1.5)
        wv = np.clip((dv - 10) / 18, 0, 1) * mask * (1 - zsoft)
        o = d * (1 - wv[..., None]) + f * wv[..., None]
        for e in sorted(events, key=lambda e: cars[passes[e['pass']]['k']]['pts'][0][1]):   # проезды поверх; дальние (выше) раньше
            j = (t - e['s']) % N
            if j < len(e['tl']):
                put(o, e['tl'][j])
        ob = np.clip(o + 0.5, 0, 255).astype(np.uint8)[:H2, :W2]
        raw.write(ob.tobytes())
        if t % 10 == 0 and t < 240:
            strip.append(ob)
    raw.close()
    mp4 = fd / (name + '_motion.mp4')
    inp = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W2, H2), '-framerate', '%g' % fps, '-i', str(tmp / 'out.rgb')]
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + ['-an', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
                    '-crf', str(crf), '-preset', 'slow', '-movflags', '+faststart', str(mp4)], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-pix_fmt', 'yuv420p', '-row-mt', '1',
                    '-deadline', 'good', '-cpu-used', '4', str(fd / (name + '_motion.webm'))], check=True)   # запасной для браузеров без H.264
    ma = (mask[:H2, :W2] * 255 + 0.5).astype(np.uint8)   # маска — в альфе (движок вырезает видео по альфе: destination-in)
    Image.fromarray(np.dstack([np.full_like(ma, 255), ma]), 'LA').save(fd / (name + '_motion_mask.png'), optimize=True)
    # треки машин в ролике — для ночных фар (каждый 2-й кадр; без краешков до/после трека)
    KS = 2
    cars_out = []
    for e in sorted(events, key=lambda e: e['s']):
        tl = [it for it in e['tl'] if it[-1] >= 0.99]
        off = next(i for i, it in enumerate(e['tl']) if it[-1] >= 0.99)
        X = cars[tl[0][1]]; P = X['pts']
        cxy, ref = [], []
        for it in tl:
            if it[0] == 'r':
                p = P[it[2]]; cxy.append((p[0], p[1])); ref.append((p, 1.0))
            else:
                cxy.append((it[3], it[4])); ref.append((P[0] if it[2] == 'crop0' else P[-1], it[5]))
        cxy = np.array(cxy, np.float32); pts = []
        for j in range(0, len(cxy), KS):
            j0, j1 = max(0, j - 3), min(len(cxy) - 1, j + 3)
            dvec = cxy[j1] - cxy[j0]; nv = float(np.hypot(*dvec)) or 1.0
            ux, uy = dvec / nv
            p, sc = ref[j]; ys, xs = np.nonzero(p[7]); xs = (xs + p[3] - p[0]) * sc; ys = (ys + p[4] - p[1]) * sc
            pr = xs * ux + ys * uy; qr = -xs * uy + ys * ux
            ln = float(np.percentile(pr, 95) - np.percentile(pr, 5)) if len(pr) > 4 else 10.0
            wd = float(np.percentile(qr, 95) - np.percentile(qr, 5)) if len(qr) > 4 else 6.0
            pts.append([round(float(cxy[j][0]) / W, 4), round(float(cxy[j][1]) / H, 4), round(float(ux), 3), round(float(uy), 3), round(ln / W, 4), round(wd / W, 4)])
        cars_out.append({'s': int((e['s'] + off) % N), 'p': pts})
    json.dump({'fps': fps, 'n': N, 'k': KS, 'ar': round(W / H, 5), 'cars': cars_out}, open(fd / (name + '_motion_cars.json'), 'w'), separators=(',', ':'))
    print('%s: %s — %d кадров, %g к/с, ролик %.1f с, %d КБ (webm %d КБ); маска %d КБ; треки фар: %d машин' % (
        name, mp4.name, N, fps, N / fps, mp4.stat().st_size // 1024, (fd / (name + '_motion.webm')).stat().st_size // 1024,
        (fd / (name + '_motion_mask.png')).stat().st_size // 1024, len(cars_out)))
    rep = opt('--report')
    if rep:
        rep = Path(rep); rep.mkdir(parents=True, exist_ok=True)
        m3 = mask[..., None]
        ov = d * (1 - 0.45 * m3) + np.array([255, 40, 160]) * 0.45 * m3
        ov[zone > 0] = ov[zone > 0] * 0.6 + np.array([40, 200, 255]) * 0.4
        cols = [(230, 30, 30), (30, 160, 30), (30, 60, 230), (220, 140, 0), (150, 0, 200), (0, 170, 170), (120, 80, 20), (240, 0, 140)]
        ov = np.ascontiguousarray(ov.astype(np.uint8))
        for pi, ps in enumerate(passes):
            col = cols[pi % len(cols)]; X = cars[ps['k']]
            pts = np.array([p[:2] for p in X['pts']], np.int32)
            cv2.polylines(ov, [pts], False, col, 2)
            for it in ps['tl']:
                if it[0] == 's':
                    cv2.circle(ov, (int(it[3]), int(it[4])), 1, col, -1)
        dropped = set(range(len(cars))) - set(ps['k'] for ps in passes)
        for k_ in dropped:
            cv2.polylines(ov, [np.array([p[:2] for p in cars[k_]['pts']], np.int32)], False, (70, 70, 70), 1)
        Image.fromarray(ov).save(rep / ('lanes_%s.jpg' % name), quality=85)
        Image.fromarray((lane_px * 255).astype(np.uint8)).save(rep / ('lanes_mask_%s.png' % name))
        if strip:
            sh = [cv2.resize(s, (W2 // 3, H2 // 3)) for s in strip[:24]]
            rows = [np.concatenate(sh[r:r + 8], 1) for r in range(0, len(sh), 8) if len(sh[r:r + 8]) == 8]
            if rows:
                Image.fromarray(np.concatenate(rows, 0)).save(rep / ('strip_%s.jpg' % name), quality=80)
        json.dump({'clips': [Path(C['src']).name for C in clips], 'frames': N, 'fps': fps, 'video_s': N / fps, 'bg_loop_s': n_loop / fps, 'bg_loops': k,
                   'car_tracks': len(cars), 'enter_at_edge': int(sum(bool(c['in']) for c in cars)), 'exit_at_edge': int(sum(bool(c['out']) for c in cars)), 'merges_cut': n_merged,
                   'ends_extended': n_ext, 'tracks_dropped': n_drop, 'passes': len(passes), 'whole_passes': whole, 'events': len(events), 'car_frames': int(placed), 'car_frames_target': int(round(target)), 'mp4_kb': mp4.stat().st_size // 1024,
                   'moving_pct': round(float((mask > 0.5).mean() * 100), 2)}, open(rep / ('stats_%s.json' % name), 'w'), ensure_ascii=False, indent=1)
    for p in tmp.glob('*'):
        p.unlink()
    tmp.rmdir()


if __name__ == '__main__':
    main()
