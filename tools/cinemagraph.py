#!/usr/bin/env python3
"""Синемаграф из роликов Veo (Flow «Frames to Video»: первый кадр = последний = рисунок) поверх полного рисунка (e1.17).

  python3 tools/cinemagraph.py tests/<здание> <кадр> clip1.mp4[,clip2.mp4…] [--night] [--speed 0.6] [--fps 20] [--thr 9] [--crf 30]
          [--max-kb 700] [--exclude u0,v0,u1,v1;…] [--roads маска.png] [--allow маска.png] [--car-area 160] [--car-ref v:px,v:px]
          [--no-cars] [--water] [--shrink 0.6] [--check] [--first N] [--report DIR]

e1.16 (круг s10): каждый ролик сам начинается и кончается на рисунке → петля без шва; клипы не склеиваются и не дорисовываются,
каждый клип — свой файл, движок после каждого круга берёт случайный следующий.
e1.17 (круг s11, отзыв на e1.16: машины «бешеные» и крупные, едут сквозь друг друга, голуби дёргаются, ночью фары отдельно от машин):
  • --speed 0.6 — ролик медленнее (setpts + minterpolate mci, 20 к/с): движение спокойнее и остаётся плавным; скорость пишется
    в клип building.json ("speed"), движок её не пересчитывает (она уже в файле), "rate" у клипа — доп. множитель движку;
  • маска — только дороги (--roads), листва и вода (--water, по цвету рисунка): голуби/люди на площади, ступенях, постаменте
    в синемаграф не попадают; на дороге (вне листвы/воды) мелкие капли (< 0,35 машины) выкидываются — голуби на асфальте;
  • автобраковка: merge (две машины слились — едут сквозь друг друга), big (машина > 1,3× эталона кадра, --car-ref: длина
    машины в px кадра на высоте v, между точками — по прямой), pop (машина появилась/пропала не у края маски/кадра),
    offroad (машиноподобная капля едет не по дороге), drift (рисунок плывёт, > 3). Брак не выводится; если брак все —
    выводится лучший с пометкой forced (решать по листу/повтору);
  • --night: клип из ночной картинки (Flow, первый = последний = <кадр>_night.webp): кадр = ночная картинка + отличие клипа
    от медианы (фары и огни — из самого ролика), файлы <кадр>_motion_n<k>.mp4, в building.json — "time": "night".
    Маску берите дневную (--allow frames/<кадр>_motion_mask.png) — она общая у кадра;
  • --shrink K: машины на дороге (крупные капли движения вместе с тенью/фарами) уменьшаются в K раз вокруг своего центра,
    освободившееся место — рисунок; путь и скорость те же. Veo держит размер машины по ширине дороги, а не по «киоску» — так
    размер задаётся числом; проверка big считает длину уже с K;
  • треки машин (_cars.json) больше не пишутся: искусственные фары по трекам удалены из движка (e1.17), треки — только для проверок.
1. Кадры клипа (замедленные) → размер кадра, совмещение с картинкой (днём — рисунок, --night — ночная картинка) по контурам.
2. Маска (общая на клипы кадра): дороги целиком ∪ (движение ∩ (листва ∪ вода)), без слоя здания, водяного знака, рамок --exclude.
3. Кадр синемаграфа = картинка, а там, где кадр клипа заметно отличается от медианы клипа (то, что движется), — пиксель клипа.
   Первые/последние 3 кадра плавно сводятся к картинке (гарантия стыка).
4. Вывод: frames/<кадр>_motion_<k>.mp4 (H.264 baseline) + .webm (VP9), с пометкой цвета; маска frames/<кадр>_motion_mask.png
   (не при --night/--allow). Печатает motionVideo.clips для building.json и вердикт по каждому клипу. --check — только проверка.
"""
import json, math, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gemini_road_mask import align  # noqa: E402

DRIFT_MAX = 3.0
_SLOW = {}
BIG_K = 1.3


def read_frames(path, W, H, fps, speed=1.0, first=0):
    """Кадры ролика в размере кадра. speed < 1 — замедление с досчётом промежуточных кадров (движение без рывков)."""
    tmp = Path(tempfile.mkdtemp())
    if speed < 0.999:   # досчёт кадров дорогой (минуты на ролик) — один раз, дальше читаем готовый замедленный ролик (почти без потерь)
        key = (str(Path(path).resolve()), speed, fps, W, H)
        if key not in _SLOW:   # кэш в системной временной папке: повторные запуски (--check, затем вывод) не считают заново
            st = Path(path).stat()
            _SLOW[key] = Path(tempfile.gettempdir()) / 'cinemagraph_cache' / ('%s_%d_%d_s%g_%gfps_%dx%d.mp4' % (Path(path).stem, st.st_size, int(st.st_mtime), speed, fps, W, H))
            _SLOW[key].parent.mkdir(exist_ok=True)
        if not _SLOW[key].exists():
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-vf',
                            'setpts=PTS/%g,minterpolate=fps=%g:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,scale=%d:%d:flags=lanczos' % (speed, fps, W, H),
                            '-an', '-c:v', 'libx264', '-crf', '8', '-preset', 'veryfast', '-pix_fmt', 'yuv444p', str(_SLOW[key])], check=True)
        path, vf = _SLOW[key], 'null'
    else:
        vf = 'fps=%g,scale=%d:%d:flags=lanczos' % (fps, W, H)
    cmd = ['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-vf', vf]
    if first:
        cmd += ['-frames:v', str(first)]
    subprocess.run(cmd + [str(tmp / 'f_%04d.png')], check=True)
    fr = [np.asarray(Image.open(p).convert('RGB')) for p in sorted(tmp.glob('f_*.png'))]
    for p in tmp.glob('*'):
        p.unlink()
    tmp.rmdir()
    return fr


def ref_len(refs, v):
    """Эталонная длина машины (px кадра) на высоте v: по точкам --car-ref, между ними и за краями — по прямой."""
    if not refs:
        return None
    if len(refs) == 1:
        return refs[0][1]
    (v0, l0), (v1, l1) = refs[0], refs[-1]
    for a, b in zip(refs, refs[1:]):
        if a[0] <= v <= b[0]:
            (v0, l0), (v1, l1) = a, b
            break
    else:
        (v0, l0), (v1, l1) = (refs[0], refs[1]) if v < refs[0][0] else (refs[-2], refs[-1])
    return max(4.0, l0 + (l1 - l0) * (v - v0) / ((v1 - v0) or 1))


def track(D, allow, car_area, W, H, road=None, ct=14.0):
    """Капли движения (отличие от медианы) → треки. Машина: капля ≥ car_area px, ровная, ≥ 8 кадров, сдвиг ≥ 20 px, не быстрее 9 px/кадр,
    ≥ 80 % пути по дороге. Возвращает машины, pop, слияния машин (merge) и машиноподобные капли не по дороге (offroad)."""
    T = len(D)
    done, act, merges = [], [], []
    for t in range(T):
        fg = ((D[t].astype(np.float32) > ct) & allow).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        n, lab, st, cen = cv2.connectedComponentsWithStats(fg)
        cs = [(i, st[i], cen[i]) for i in range(1, n) if st[i][4] >= max(30, car_area * 0.2)]
        used, nxt = {}, []
        for tr in act:
            pr = np.array(tr['pts'][-1][:2]) + tr['v']
            best, bd = None, 1e9
            for j, (i, s, c) in enumerate(cs):
                d = math.hypot(*(c - pr)); r = 10 + 0.6 * math.hypot(*tr['v']) + 0.25 * math.sqrt(s[4])
                if d < r and d < bd:
                    bd, best = d, j
            if best is None:
                tr['end'] = t - 1; done.append(tr); continue
            used.setdefault(best, []).append(tr)
        for j, trs in used.items():
            i, s, c = cs[j]
            if len(trs) > 1:                 # слияние двух капель: обе машины «сквозь друг друга» — дальше не ведём
                big = [tr for tr in trs if len(tr['pts']) >= 4 and np.median([p[2] for p in tr['pts']]) >= car_area]
                if len(big) >= 2 and (road is None or road[int(min(H - 1, c[1])), int(min(W - 1, c[0]))]):
                    merges.append([int(t), round(float(c[0]) / W, 3), round(float(c[1]) / H, 3)])
                for tr in trs:
                    tr['end'] = t - 1; tr['merged'] = True; done.append(tr)
                continue
            tr = trs[0]
            tr['v'] = 0.6 * tr['v'] + 0.4 * (c - np.array(tr['pts'][-1][:2]))
            x, y, w, h = s[:4]
            tr['pts'].append((c[0], c[1], s[4], x, y, w, h, lab[y:y + h, x:x + w] == i))
            nxt.append(tr)
        for j, (i, s, c) in enumerate(cs):
            if j not in used:
                x, y, w, h = s[:4]
                nxt.append({'t0': t, 'v': np.zeros(2), 'pts': [(c[0], c[1], s[4], x, y, w, h, lab[y:y + h, x:x + w] == i)]})
        act = nxt
    for tr in act:
        tr['end'] = T - 1; done.append(tr)
    dist = cv2.distanceTransform(np.pad(allow, 1).astype(np.uint8), cv2.DIST_L2, 3)[1:-1, 1:-1]
    cars, pops, offroad = [], [], []
    for tr in done:
        P = tr['pts']
        if len(P) < 8:
            continue
        med = float(np.median([p[2] for p in P]))
        C = np.array([p[:2] for p in P], np.float32)
        spd = np.hypot(*np.diff(C, axis=0).T)
        A_ = np.array([p_[2] for p_ in P], np.float32)
        if med < car_area or math.hypot(*(C[-1] - C[0])) < 20 or spd.mean() > 9:
            continue
        if A_.std() / A_.mean() > 0.4 or np.mean([p_[7].mean() for p_ in P]) < 0.5:
            continue                       # стая голубей: капля меняет площадь и форму, «дырявая» — не машина
        on = 1.0 if road is None else float(np.mean([road[int(min(H - 1, p[1])), int(min(W - 1, p[0]))] for p in P]))
        if on < 0.8:
            if on >= 0.2:                  # ровная машиноподобная капля частью едет вне дороги — «странная траектория»
                offroad.append([int(tr['t0']), round(float(C[0][0]) / W, 3), round(float(C[0][1]) / H, 3), round(on, 2)])
            continue

        def edge(p):   # у края кадра или у края маски (дерево, здание, конец дороги), или видна не целиком
            cx, cy, a, x, y, w, h, _ = p
            return x <= 2 or y <= 2 or x + w >= W - 2 or y + h >= H - 2 or dist[int(min(H - 1, cy)), int(min(W - 1, cx))] < 0.9 * math.sqrt(med) + 10 or a < 0.5 * med
        tr['med'] = med
        if not tr.get('merged'):
            for p_, kind, tt in ((P[0], 'in', tr['t0']), (P[-1], 'out', tr['end'])):
                if not edge(p_):
                    pops.append([kind, int(tt), round(float(p_[0]) / W, 3), round(float(p_[1]) / H, 3)])
        cars.append(tr)
    return cars, pops, merges, offroad


def car_sizes(cars, W, H):
    """Длина каждой машины (px кадра, по ходу движения, медиана по треку) и высота v, где она едет."""
    out = []
    for tr in cars:
        P = tr['pts']; C = np.array([p[:2] for p in P], np.float32); ls = []
        for j in range(0, len(P), 2):
            j0, j1 = max(0, j - 3), min(len(P) - 1, j + 3)
            dv = C[j1] - C[j0]; nv = float(np.hypot(*dv)) or 1.0; ux, uy = dv / nv
            p = P[j]
            if p[3] <= 2 or p[4] <= 2 or p[3] + p[5] >= W - 2 or p[4] + p[6] >= H - 2:
                continue                   # машина у края кадра видна не целиком — не мерим
            ys, xs = np.nonzero(p[7]); xs = xs + p[3] - p[0]; ys = ys + p[4] - p[1]
            pr = xs * ux + ys * uy
            if len(pr) > 4:
                ls.append(float(np.percentile(pr, 95) - np.percentile(pr, 5)))
        if ls:
            out.append((float(np.median(ls)), float(np.median(C[:, 1])) / H, int(tr['t0'])))
    return out


def shrink_cars(wv, wraw, src, mvp, road_only, car_area, k):
    """Каждая крупная капля движения на дороге (машина с тенью, ночью — с фарами) уменьшается в k раз вокруг своего центра;
    освободившееся место — рисунок (вес 0). Путь и скорость машины те же, меньше только сама машина."""
    H, W = wv.shape
    near = cv2.dilate(road_only.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))).astype(bool)
    n, lab, st, cen = cv2.connectedComponentsWithStats((mvp & near).astype(np.uint8))   # машина целиком, даже если заехала за край маски дорог
    wv2, src2 = wv.copy(), src.copy()
    lay_w, lay_c = np.zeros_like(wv), np.zeros_like(src)
    for i in range(1, n):
        if st[i][4] < car_area * 0.35:
            continue
        x, y, w, h = st[i][:4]
        if road_only[y:y + h, x:x + w][lab[y:y + h, x:x + w] == i].mean() < 0.5:
            continue                                            # не машина на дороге (листва у дороги и т. п.)
        x0, y0, x1, y1 = max(0, x - 6), max(0, y - 6), min(W, x + w + 6), min(H, y + h + 6)
        m = cv2.dilate((lab[y0:y1, x0:x1] == i).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(np.float32)
        pw, pc = wraw[y0:y1, x0:x1] * m, src[y0:y1, x0:x1]   # вес без маски: обрезанная маской машина не станет «половинкой»
        wv2[y0:y1, x0:x1] *= (1 - m)                            # сама большая машина уходит
        sw, sh = max(1, int(round((x1 - x0) * k))), max(1, int(round((y1 - y0) * k)))
        pw_s = cv2.resize(pw, (sw, sh), interpolation=cv2.INTER_AREA)
        pc_s = cv2.resize(pc, (sw, sh), interpolation=cv2.INTER_AREA)
        cx, cy = cen[i]
        nx0, ny0 = int(round(cx - (cx - x0) * k)), int(round(cy - (cy - y0) * k))
        ax0, ay0, ax1, ay1 = max(0, nx0), max(0, ny0), min(W, nx0 + sw), min(H, ny0 + sh)
        if ax1 <= ax0 or ay1 <= ay0:
            continue
        sub_w = pw_s[ay0 - ny0:ay1 - ny0, ax0 - nx0:ax1 - nx0]
        sub_c = pc_s[ay0 - ny0:ay1 - ny0, ax0 - nx0:ax1 - nx0]
        cur = lay_w[ay0:ay1, ax0:ax1]
        sel = sub_w > cur
        lay_w[ay0:ay1, ax0:ax1] = np.where(sel, sub_w, cur)
        lay_c[ay0:ay1, ax0:ax1] = np.where(sel[..., None], sub_c, lay_c[ay0:ay1, ax0:ax1])
    put = lay_w > wv2
    src2[put] = lay_c[put]
    return np.maximum(wv2, lay_w), src2


def zones(day, H, W, sky_end, water):
    """Листва (зелёное рисунка) и вода (синее ниже неба) — там видео может двигаться и вне дорог."""
    hsv = cv2.cvtColor(day, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    leaf = ((h >= 28) & (h <= 88) & (s >= 55) & (v >= 35)).astype(np.uint8)
    leaf = cv2.morphologyEx(leaf, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(leaf)
    leaf = np.isin(lab, [i for i in range(1, n) if st[i][4] >= 60]).astype(np.uint8)
    leaf = cv2.dilate(leaf, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    wat = np.zeros((H, W), np.uint8)
    if water:
        w = ((h >= 92) & (h <= 128) & (s >= 80)).astype(np.uint8)
        w[:int(H * (sky_end + 0.04))] = 0
        n, lab, st, _ = cv2.connectedComponentsWithStats(w)
        wat = np.isin(lab, [i for i in range(1, n) if st[i][4] >= 1500]).astype(np.uint8)
        wat = cv2.dilate(wat, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    return leaf.astype(bool), wat.astype(bool)


def encode(out, fps, path_mp4, crf, max_kb, W2, H2):
    tmp = Path(tempfile.mkdtemp()); raw = tmp / 'out.rgb'
    with open(raw, 'wb') as fh:
        for f in out:
            fh.write(f.tobytes())
    inp = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W2, H2), '-framerate', '%g' % fps, '-i', str(raw)]
    # s10 «G бледный»: видео без пометки цвета iPhone считает BT.709 с гаммой ~1.96 и при выводе на экран осветляет (Apple «washed out»)
    # относительно картинок кадра (sRGB). Матрица BT.709 явно + пометка «передаточная функция sRGB» — видео = рисунок по цвету и яркости.
    col = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'tv']
    while True:
        subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + col + ['-an', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-pix_fmt', 'yuv420p',
                        '-crf', str(crf), '-preset', 'slow', '-movflags', '+faststart', str(path_mp4)], check=True)
        if path_mp4.stat().st_size <= max_kb * 1024 or crf >= 40:
            break
        crf += 2
    wcrf = 40
    webm = path_mp4.with_suffix('.webm')
    while True:
        subprocess.run(['ffmpeg', '-v', 'error', '-y'] + inp + col + ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', str(wcrf), '-pix_fmt', 'yuv420p', '-row-mt', '1',
                        '-deadline', 'good', '-cpu-used', '4', str(webm)], check=True)
        if webm.stat().st_size <= max_kb * 1024 or wcrf >= 52:
            break
        wcrf += 3
    raw.unlink(); tmp.rmdir()
    return crf, wcrf


def main():
    a = sys.argv[1:]
    bdir, name, srcs = Path(a[0]), a[1], [Path(s) for s in a[2].split(',') if s]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    fps, thr, crf, max_kb = float(opt('--fps', 20)), float(opt('--thr', 9)), int(opt('--crf', 30)), int(opt('--max-kb', 700))
    speed, night, check, first = float(opt('--speed', 1.0)), '--night' in a, '--check' in a, int(opt('--first', 0))
    shr = [float(x) for x in str(opt('--shrink', '1')).split(',')]   # одно число на все клипы или по числу на клип (как в списке клипов)
    car_area, no_cars = int(opt('--car-area', 160)), '--no-cars' in a or not opt('--roads')   # без маски дорог машин нет
    refs = sorted(tuple(map(float, p.split(':'))) for p in (opt('--car-ref') or '').split(',') if p)
    fd = bdir / 'frames'
    day = np.asarray(Image.open(fd / (name + '.webp')).convert('RGB'))
    base = np.asarray(Image.open(fd / (name + '_night.webp')).convert('RGB')) if night else day   # на что кладём движение
    H, W = day.shape[:2]
    H2, W2 = H - H % 2, W - W % 2
    d = base.astype(np.float32)
    try:
        bj = json.load(open(bdir / 'building.json'))
        sky_end = float(next(f for f in bj['frames'] if f['name'] == name).get('sky', {}).get('end', 0.25))
    except Exception:
        sky_end = 0.25
    bld = np.asarray(Image.open(fd / (name + '_building.webp')))[..., 3] > 60
    excl = np.zeros((H, W), bool)
    excl[int(H * 0.93):, int(W * 0.72):] = True                                        # водяной знак Veo
    for box in (opt('--exclude') or '').split(';'):
        if box:
            u0, v0, u1, v1 = map(float, box.split(','))
            excl[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)] = True
    off = excl | cv2.dilate(bld.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    leaf, wat = zones(day, H, W, sky_end, '--water' in a)
    rd = None
    if opt('--roads'):
        rd = np.asarray(Image.open(opt('--roads')).convert('L').resize((W, H), Image.NEAREST)) > 127
        rd = cv2.dilate(rd.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))).astype(bool)
    free = leaf | wat                                           # где движется всё (листва, вода); на дороге — только крупное (машины)
    clips = []
    for src in srcs:                                            # 1. кадры, совмещение, медиана, разброс
        fr = read_frames(src, W, H, fps, speed, first)
        M, score, par = align(base, fr[0], np.zeros((H, W), bool))
        fr = [cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REPLICATE) for f in fr]
        bg = np.median(np.stack(fr[::3]).astype(np.float32), 0)
        L = np.stack([cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (0, 0), 1.6) for f in fr]).astype(np.float32)
        sd = L.std(0); del L
        clips.append({'src': src, 'M': M, 'bg': bg, 'sd': sd, 'par': par, 'corr': score})   # кадры не держим (память) — второй проход читает заново
        print('%s: %s — %d кадров по %g к/с (скорость ×%g), совмещено sx=%.3f sy=%.3f dx=%d dy=%d (corr %.3f)' % (name, src.name, len(fr), fps, speed, *par, score))
        del fr
    if opt('--allow'):                                          # 2. маска
        mask = np.asarray(Image.open(opt('--allow')).convert('LA'))[..., 1].astype(np.float32) / 255
        mask = cv2.resize(mask, (W, H))
    else:
        mv = (np.max([c['sd'] for c in clips], 0) > thr).astype(np.uint8)
        mv[off | ~free] = 0                                     # e1.17: вне дорог двигаются только листва и вода — голуби, люди, площадь не берём
        mv = cv2.morphologyEx(mv, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(mv)
        mv = np.isin(lab, [i for i in range(1, n) if st[i][4] >= 12]).astype(np.uint8)
        mv = cv2.dilate(mv, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        mv[~(free | (rd if rd is not None else False))] = 0
        if rd is not None:                                      # дороги целиком: машина не уходит под рисунок посреди улицы
            mv = np.maximum(mv, rd.astype(np.uint8))
        mv[off] = 0
        mask = np.clip(cv2.GaussianBlur(mv.astype(np.float32), (0, 0), 4.0) * 1.5, 0, 1)
        mask[off] = 0
        mask = cv2.GaussianBlur(mask, (0, 0), 1.0)
    allow = mask > 0.5
    road_only = allow & ~free if rd is not None else np.zeros((H, W), bool)   # тут двигаются только машины (крупные капли)
    print('%s: маска — в движении %.1f %% кадра (дороги %.1f %%, листва/вода %.1f %%)' % (name, allow.mean() * 100, road_only.mean() * 100, (allow & free).mean() * 100))
    stats, conf = [], []
    for k, C in enumerate(clips, 1):                            # 3. композит, проверка, вывод
        shrink = C['shrink'] = shr[min(k - 1, len(shr) - 1)]
        fr = [cv2.warpAffine(f, C['M'], (W, H), borderMode=cv2.BORDER_REPLICATE) for f in read_frames(C['src'], W, H, fps, speed, first)]
        bg, T = C['bg'], len(fr)
        D = [cv2.GaussianBlur(np.abs(f.astype(np.float32) - bg).max(-1), (0, 0), 1.5).astype(np.float16) for f in fr]
        static = (~allow) & (~off)
        g0 = cv2.GaussianBlur(cv2.cvtColor(fr[0], cv2.COLOR_RGB2GRAY), (0, 0), 2).astype(np.float32)
        drift = max(float(np.abs(cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (0, 0), 2).astype(np.float32) - g0)[static].mean()) for f in fr[::5])
        newo = cv2.GaussianBlur(np.abs(bg - fr[0].astype(np.float32)).max(-1), (0, 0), 3) > 28
        newo &= ~off
        new_px = int(cv2.morphologyEx(newo.astype(np.uint8), cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)).sum())
        if no_cars:
            cars, pops, merges, offroad = [], [], [], []
        else:
            cars, pops, merges, offroad = track(D, allow, car_area, W, H, rd)
        sizes = car_sizes(cars, W, H)
        big = []
        for ln, v, t0 in sizes:
            r = ref_len(refs, v)
            if r and ln * shrink > BIG_K * r:                     # --shrink: машина в выводе меньше во столько раз
                big.append([t0, round(v, 3), round(ln * shrink, 1), round(r, 1)])
        why = (['merge'] if merges else []) + (['big'] if big else []) + (['pop'] if pops else []) + (['offroad'] if offroad else []) + (['drift'] if drift > DRIFT_MAX else [])
        s = {'clip': C['src'].name, 'frames': T, 'sec': round(T / fps, 2), 'speed': speed, 'cars': len(cars), 'pop': len(pops), 'pops': pops,
             'merge': merges, 'big': big, 'offroad': offroad, 'car_len': [[round(x, 1), round(v, 3)] for x, v, _ in sizes],
             'drift': round(drift, 2), 'new_px': new_px, 'align': [round(float(x), 3) for x in C['par']], 'corr': round(float(C['corr']), 3),
             'verdict': 'ok' if not why else 'reject', 'why': why}
        print('%s: %s — %s %s; машин %d (длина px: %s), merge %s, big %s, pop %s, offroad %s, drift %.2f, new %d px' % (
            name, C['src'].name, s['verdict'].upper(), ','.join(why), len(cars), [round(x) for x, _, _ in sizes], merges, big, pops, offroad, drift, new_px))
        C['stat'] = s; stats.append(s)
        if check:
            del fr, D; continue
        C['T'] = T
        del fr, D
    if check:
        print('CHECK:', json.dumps([{'clip': s['clip'], 'verdict': s['verdict'], 'why': s['why']} for s in stats], ensure_ascii=False))
        return
    good = [C for C in clips if C['stat']['verdict'] == 'ok']
    if not good:                                                # брак все — лучший (меньше причин, меньше дрейф) с пометкой forced
        best = min(clips, key=lambda C: (len(C['stat']['why']), C['stat']['drift']))
        best['stat']['verdict'] = 'forced'; good = [best]
        print('%s: годных клипов нет — выводится лучший из брака: %s (%s)' % (name, best['src'].name, ','.join(best['stat']['why'])))
    rep = opt('--report')
    pre = '%s_motion_n' % name if night else '%s_motion_' % name
    for k, C in enumerate(good, 1):
        shrink = C['shrink']
        fr = [cv2.warpAffine(f, C['M'], (W, H), borderMode=cv2.BORDER_REPLICATE) for f in read_frames(C['src'], W, H, fps, speed, first)]
        bg, T = C['bg'], len(fr)
        out = []
        for t in range(T):
            Dt = cv2.GaussianBlur(np.abs(fr[t].astype(np.float32) - bg).max(-1), (0, 0), 1.5)
            mvp = Dt > 14
            if road_only.any():                                 # на голой дороге — только крупные капли (машины), голуби на асфальте — нет
                n, lab, st, _ = cv2.connectedComponentsWithStats((mvp & road_only).astype(np.uint8))
                small = np.isin(lab, [i for i in range(1, n) if st[i][4] < car_area * 0.35])
                Dt[cv2.dilate(small.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & road_only] = 0
            wv = np.clip((Dt - 10) / 18, 0, 1) * mask
            src = fr[t].astype(np.float32)
            if shrink < 0.999 and road_only.any():              # --shrink: машины на дороге меньше (Veo рисует их ~2× крупнее нужного)
                wv, src = shrink_cars(wv, np.clip((Dt - 10) / 18, 0, 1), src, Dt > 14, road_only, car_area, shrink)
            ramp = min(1.0, t / 3, (T - 1 - t) / 3)                 # стык: первый и последний кадр — картинка
            wv = (wv * ramp)[..., None]
            out.append(np.clip(d * (1 - wv) + src * wv + 0.5, 0, 255).astype(np.uint8)[:H2, :W2])
        mp4 = fd / ('%s%d.mp4' % (pre, k))
        c1, c2 = encode(out, fps, mp4, crf, max_kb, W2, H2)
        s = C['stat']; s.update({'out': mp4.name, 'mp4_kb': mp4.stat().st_size // 1024, 'webm_kb': mp4.with_suffix('.webm').stat().st_size // 1024, 'crf': [c1, c2]})
        cc = {'src': mp4.name, 'speed': speed}
        if shrink < 0.999:
            s['shrink'] = shrink
        if night:
            cc['time'] = 'night'
        conf.append(cc)
        print('%s: %s → %s %d КБ (webm %d КБ), %.1f с' % (name, C['src'].name, mp4.name, s['mp4_kb'], s['webm_kb'], T / fps))
        if rep:
            rp = Path(rep); rp.mkdir(parents=True, exist_ok=True)
            idx = np.linspace(0, T - 1, 8).astype(int)
            sm = [cv2.resize(out[i], (W2 // 3, H2 // 3), interpolation=cv2.INTER_AREA) for i in idx]
            Image.fromarray(np.hstack(sm)).save(rp / ('sheet_%s_%s%d.jpg' % (name, 'n' if night else '', k)), quality=85)
        del fr, out
    if not opt('--allow') and not night:
        ma = (mask[:H2, :W2] * 255 + 0.5).astype(np.uint8)
        Image.fromarray(np.dstack([np.full_like(ma, 255), ma]), 'LA').save(fd / (name + '_motion_mask.png'), optimize=True)
    print('clips:', json.dumps(conf, ensure_ascii=False))
    if rep:
        m3 = mask[..., None]
        ov = d * (1 - 0.45 * m3) + np.array([255, 40, 160]) * 0.45 * m3
        Image.fromarray(ov.astype(np.uint8)).save(Path(rep) / ('mask_%s%s.jpg' % (name, '_n' if night else '')), quality=85)
        json.dump({'stats': stats, 'clips': conf, 'moving_pct': round(float(allow.mean() * 100), 2)},
                  open(Path(rep) / ('stats_%s%s.json' % (name, '_n' if night else '')), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
