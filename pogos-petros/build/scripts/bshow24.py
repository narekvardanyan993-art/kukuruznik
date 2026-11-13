#!/usr/bin/env python3
"""Заход 24 (s24, на основе bshow23): вход Veo in_dog_edge.png = вырезка 288,880 480×270 кадра B ×2 (прижата к правому краю), ролик dog_edge.mp4 (8,8 с из dog_edge_raw_bb304d63) — собака проходит мимо угла и выходит за правый край кадра к 8,5 с, без растворения; PRE 6,5 — уходит до трещин.
Заход 23 (на основе bshow22): шоу B — собака спокойно просыпается, нюхает и уходит по запаху (Veo dog_sniff.mp4),
в отмотке возвращается тем же роликом задом наперёд; ни одного «проявления» и «телепорта».
Ролик собаки: кухня zhivost-v2/veo/dog_sniff.mp4 (1280×720, 24 к/с; вход Veo in_dog_day.png = вырезка 186,880 480×270 кадра B ×2).
Хвост сырого ролика (dog_sniff_raw_44affb1a.mp4 после 8,7 с — собака снова посередине) не берётся.
Оригинал шоу: кухня zhivost-v2/orig/vid_b_show.orig.mp4 (768×1010, 28,54 с; старая собака выпрыгивает 0,6–2,2 с и обратно 27,6–28,5 с).
Ось ролика (o — кадр выхода, i = o − NP — кадр оригинала):
  • 0 … PRE (5,5 с) + 2,1 с: сцена стоит (стоп-кадр начала оригинала, старая собака стёрта «пустым местом» — медиана 0–2 с);
    собака Veo: 0–1 спит, 1–2,5 нюхает воздух, 2,5–4 встаёт, 4–7,5 идёт вправо по стене и уходит за край вырезки; к трещинам её нет;
  • оригинал: трещины → обрушение → «Москва» → пауза → отмотка ×2,5; старая собака в отмотке стёрта;
  • после 27,45 с оригинала: собака Veo задом наперёд ×2,5 (как отмотка) от края к месту сна, потом стоит спящей HOLD с.
Стык со сценой: в зоне собаки первый и последний кадры = сам рисунок кадра B (pogos_b.webp) — плавный переход в Veo за 0,3–0,9 с
(собака в это время спит, позы совпадают). Маска собаки — где кадр Veo отличается от своего пустого последнего кадра (тело, тень).
Запуск из корня репозитория: python3 pogos-petros/build/scripts/bshow23.py mp4|webm|sheet|check|strips  [--pre 5.5] [--hold 1.2]\n  кусками: … mp4 --range 0:300 --out /tmp/a.mp4 (потом ffmpeg -f concat -c copy) — в VM Мака вызов живёт ≤ 3 мин, фоновые процессы гибнут"""
import sys, json, subprocess, numpy as np, cv2
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); import fix15
FR = Path('tests/pogos-petros/frames'); REP = Path('pogos-petros/build/report/s24'); REP.mkdir(parents=True, exist_ok=True)
ZV = next(p for p in (Path.home() / 'Documents/chka-kitchen/zhivost-v2', Path.home() / 'mnt/chka-kitchen/zhivost-v2', Path.home() / 'mnt/zhivost-v2') if p.exists())
SRC = ZV / 'orig/vid_b_show.orig.mp4'; DOG = ZV / 'veo/dog_edge.mp4'
arg = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
PRE, HOLD, RS = arg('--pre', 6.5), arg('--hold', 1.2), 2.5          # RS — скорость отмотки оригинала
cap = cv2.VideoCapture(str(SRC)); fps = cap.get(5); n = int(cap.get(7)); W = int(cap.get(3)); H = int(cap.get(4))
head = [cap.read()[1] for _ in range(int(2.0 * fps) + 1)]
cap.set(cv2.CAP_PROP_POS_FRAMES, n - 1); olast = cap.read()[1].astype(np.float32); cap.release()
fw0 = head[0].astype(np.float32)
absent = np.median(np.stack(head), 0).astype(np.float32)          # пустое место: старая собака ни в одном пикселе не стоит дольше половины 0–2 с
d = np.max(np.stack([np.abs(x.astype(np.float32) - absent).max(-1) for x in head]), 0)
cap = cv2.VideoCapture(str(SRC)); cap.set(cv2.CAP_PROP_POS_FRAMES, int(27.5 * fps))
while True:                                                          # обратный прыжок старой собаки в отмотке — та же маска
    ok, x = cap.read()
    if not ok: break
    d = np.maximum(d, np.abs(x.astype(np.float32) - absent).max(-1))
cap.release()
m = (d > 24).astype(np.uint8); m[:int(H * 0.45)] = 0
m = cv2.dilate(cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)), np.ones((25, 25), np.uint8))
m = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 9) * 1.3, 0, 1)[..., None]
I_HEAD, I_TAIL, I_REV = int(round(2.25 * fps)), int(round(27.5 * fps)), int(round(27.45 * fps))
# окно вырезки кадра B (186,880 480×270 в кадре 768×1365) в координатах ролика шоу (rect шоу 0…1 × 0,139934…0,879846 → 768×1010, сверху 191)
sx, sy = W / 768.0, H / (1365 * (0.879846 - 0.139934)); oy = 1365 * 0.139934
wx0, wy0, ww, wh = int(round(288 * sx)), int(round((880 - oy) * sy)), int(round(480 * sx)), int(round(270 * sy))
B = cv2.imread(str(FR / 'pogos_b.webp')).astype(np.float32)
drawing = cv2.resize(B[int(round(oy)):int(round(oy)) + int(round(H / sy)), :], (W, H), interpolation=cv2.INTER_AREA) if (sx, sy) != (1, 1) else B[int(round(oy)):int(round(oy)) + H]
dwin = drawing[wy0:wy0 + wh, wx0:wx0 + ww]
# собака Veo → окно ролика шоу (совмещение по рисунку: вход Veo вырезан из рисунка)
dc = cv2.VideoCapture(str(DOG)); dfr = []
while True:
    ok, f = dc.read()
    if not ok: break
    dfr.append(f)
dc.release()
tm, cc, Wm = fix15.locate(dfr[0], dwin.astype(np.uint8))      # пиксель окна → пиксель клипа
warp = lambda f: cv2.warpAffine(f, Wm, (ww, wh), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
WG = [warp(f) for f in dfr]; empty = WG[-1].astype(np.float32)
gn = np.clip(np.median(dwin.reshape(-1, 3), 0) / np.maximum(np.median(WG[0].reshape(-1, 3), 0), 1), 0.85, 1.15)
e = 18; rmp = np.linspace(0, 1, e); edge = np.ones((wh, ww), np.float32); edge[:, :e] *= rmp[None]; edge[:e] *= rmp[:, None]; edge[-e:] *= rmp[::-1][:, None]
# s24: окно прижато к правому краю кадра — собака уходит за край сама, правый край не гасим   # правый край вырезки: собака уходит за край мягко (Veo дальше не рисовал)
def dog_alpha(k):
    g = WG[k].astype(np.float32)
    dm = (np.abs(g - empty).max(-1) > 28).astype(np.uint8)
    dm = cv2.dilate(cv2.morphologyEx(dm, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), np.ones((7, 7), np.uint8))
    return np.clip(cv2.GaussianBlur(dm.astype(np.float32), (0, 0), 2.5) * 1.4, 0, 1) * edge
K_END = min(len(WG) - 1, int(round(8.6 * fps)))                     # после 7,5 с собаки в клипе нет
AL = [dog_alpha(k) for k in range(K_END + 1)]
Z0 = np.max(np.stack(AL[:int(1.0 * fps) + 1]), 0); Z = np.clip(cv2.GaussianBlur(cv2.dilate((Z0 > 0.05).astype(np.uint8), np.ones((25, 25), np.uint8)).astype(np.float32), (0, 0), 5) * 1.6, 0, 1)
NP = int(round(PRE * fps)); OR0 = NP + I_REV; NREV = int(np.ceil(K_END / RS)); OK0 = OR0 + NREV
N_OUT = max(NP + n, OK0 + 1) + int(round(HOLD * fps))
ss = lambda x: (lambda t: t * t * (3 - 2 * t))(min(1.0, max(0.0, x)))
def dog_k(o):
    if o <= K_END: return o
    if o >= OR0: return max(0, int(round(K_END - (o - OR0) * RS)))
    return None
def wdraw(o):   # доля самого рисунка в зоне собаки: 1 на первом и последнем кадре
    t = o / fps
    if o < OR0: return 1 - ss((t - 0.3) / 0.6)
    return ss((o - OK0) / fps / 0.6)
def mold(i):    # доля «пустого места» вместо старой собаки
    if i < I_HEAD: return 1.0
    if i < I_HEAD + 5: return 1 - ss((i - I_HEAD) / 5)
    if i >= I_TAIL: return ss((i - I_TAIL + 1) / 4)
    return 0.0
RA, RB = (int(v) for v in sys.argv[sys.argv.index('--range') + 1].split(':')) if '--range' in sys.argv else (0, None)   # кусок кадров [a, b) — кодировать частями (в VM Мака вызов ≤ 3 мин)
def frames(info=None, ra=0, rb=None):
    cap = cv2.VideoCapture(str(SRC)); read = 0
    for o in range(N_OUT if rb is None else min(rb, N_OUT)):
        i = o - NP
        if o < ra:
            if 0 <= i < n: cap.grab()
            continue
        if i < 0: f = fw0.copy()
        elif i < n:
            ok, x = cap.read(); read += 1
            f = x.astype(np.float32) if ok else olast.copy()
        else: f = olast.copy()
        k0 = mold(min(i, n - 1) if i >= 0 else 0) if i < n else 1.0
        if k0 > 0: f = f * (1 - m * k0) + absent * (m * k0)
        base = f[wy0:wy0 + wh, wx0:wx0 + ww].copy()
        k = dog_k(o); sub = base.copy()
        if k is not None:
            a = AL[k][..., None]; sub = sub * (1 - a) + np.clip(WG[k].astype(np.float32) * gn, 0, 255) * a
        z = (Z * wdraw(o))[..., None]
        if z.max() > 0: sub = sub * (1 - z) + dwin * z
        f[wy0:wy0 + wh, wx0:wx0 + ww] = sub
        if info is not None: info.append((o, k, base))
        yield np.clip(f, 0, 255).astype(np.uint8)
    cap.release()
def enc(args, out):
    p = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '%dx%d' % (W, H), '-r', str(fps), '-i', '-', '-an'] + args + [str(out)], stdin=subprocess.PIPE)
    for f in frames(ra=RA, rb=RB): p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
meta = {'fps': fps, 'n_out': N_OUT, 'len_s': round(N_OUT / fps, 3), 'pre_s': PRE, 'hold_s': HOLD, 'orig_frames': n, 'dog_exit_s': round(K_END / fps, 2),
        'rev_start_s': round(OR0 / fps, 2), 'rev_end_s': round(OK0 / fps, 2), 'cracks_s': round((NP + int(2.1 * fps)) / fps, 2), 'locate_tm': round(tm, 3), 'locate_ecc': round(cc, 3), 'gain': [round(float(v), 3) for v in gn]}
if 'mp4' in sys.argv: enc(['-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart'], Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else FR / 'vid_b_show.mp4')
if 'webm' in sys.argv: enc(['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'], Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else FR / 'vid_b_show.webm')
if 'sheet' in sys.argv or 'check' in sys.argv:
    # лист: стоп-кадр каждые 0,5 с всего шоу (низ кадра — путь собаки) + счётчик скачков собаки по кадрам
    info = []; tiles = []; area = []; cen = []; first = last = None
    T = set(int(round(t * fps)) for t in np.arange(0, N_OUT / fps, 0.5)) | {N_OUT - 1}
    for f in frames(info):
        o, k, base = info[-1]; info[-1] = None
        win = f[wy0:wy0 + wh, wx0:wx0 + ww].astype(np.float32)
        dm = np.abs(win - base).max(-1) > 28
        ys, xs = np.nonzero(dm); area.append(int(dm.sum())); cen.append((float(xs.mean()), float(ys.mean())) if len(xs) > 50 else None)
        if o == 0: first = f.copy()
        if o == N_OUT - 1: last = f.copy()
        if o in T:
            c = f[600:1010, 100:720].copy(); c = cv2.resize(c, (310, 205))
            cv2.putText(c, '%.1f' % (o / fps), (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1); tiles.append(c)
        if o == N_OUT - 1: break
    cols = 8
    while len(tiles) % cols: tiles.append(np.full_like(tiles[0], 255))
    cv2.imwrite(str(REP / 'sheet_show_b.jpg'), np.concatenate([np.concatenate(tiles[j:j + cols], 1) for j in range(0, len(tiles), cols)], 0), [cv2.IMWRITE_JPEG_QUALITY, 88])
    steps = [(o, ((cen[o][0] - cen[o - 1][0]) ** 2 + (cen[o][1] - cen[o - 1][1]) ** 2) ** 0.5) for o in range(1, len(cen)) if cen[o] and cen[o - 1]]
    darea = [(o, area[o] - area[o - 1]) for o in range(1, len(area))]
    # стык: первый/последний кадр ↔ рисунок в зоне собаки
    def seam(fr):   # ядро зоны собаки (Z ≥ 0,99 — там должен стоять сам рисунок) и вся зона с мягким краем (Z > 0,05)
        dd = np.abs(fr[wy0:wy0 + wh, wx0:wx0 + ww].astype(np.float32) - dwin).max(-1); r = {}
        for nm, zz in (('core', Z >= 0.99), ('zone', Z > 0.05)):
            r[nm] = {'mean': round(float(dd[zz].mean()), 2), 'p99': round(float(np.percentile(dd[zz], 99)), 1), 'max': round(float(dd[zz].max()), 1), 'px_over16': int((dd[zz] > 16).sum()), 'px': int(zz.sum())}
        return r, dd
    s0, d0 = seam(first); s1, d1 = seam(last)
    vis = lambda dd: cv2.applyColorMap(np.clip(dd * 4, 0, 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    row = lambda fr, dd: np.concatenate([dwin.astype(np.uint8), fr[wy0:wy0 + wh, wx0:wx0 + ww], vis(dd)], 1)
    cv2.imwrite(str(REP / 'seam_diff.jpg'), np.concatenate([row(first, d0), row(last, d1)], 0))
    meta.update({'seam_first': s0, 'seam_last': s1, 'max_centroid_step_px': round(max([s for _, s in steps] or [0]), 1),
                 'top_steps': sorted(steps, key=lambda x: -x[1])[:5], 'max_area_jump_px': max([abs(a) for _, a in darea] or [0]),
                 'top_area_jumps': sorted(darea, key=lambda x: -abs(x[1]))[:6], 'area_series_every_0.5s': [(round(o / fps, 1), area[o]) for o in range(0, len(area), 12)]})
    json.dump(meta, open(REP / 'bshow23_check.json', 'w'), ensure_ascii=False, indent=1, default=float)
print(json.dumps(meta, ensure_ascii=False, default=float)[:1500])
if 'strips' in sys.argv:   # стоп-кадры по 0,1 с в местах склеек нового ролика (уход за край, возврат, сон в конце)
    want = {'exit': np.arange(6.0, 7.8, 0.1), 'return': np.arange(OR0 / fps - 0.2, OR0 / fps + 1.6, 0.1), 'start': np.arange(0, 1.2, 0.1), 'end': np.arange(N_OUT / fps - 1.8, N_OUT / fps, 0.1)}
    idx = {nm: [int(round(t * fps)) for t in ts] for nm, ts in want.items()}; got = {nm: [] for nm in want}
    allw = set(sum(idx.values(), [])); mx = max(allw)
    for o, f in enumerate(frames()):
        if o in allw:
            c = cv2.resize(f[640:1000, 160:768], (304, 180))
            for nm in idx:
                if o in idx[nm]: t = c.copy(); cv2.putText(t, '%.1f' % (o / fps), (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1); got[nm].append(t)
        if o >= mx: break
    for nm, tl in got.items():
        while len(tl) % 6: tl.append(np.full_like(tl[0], 255))
        cv2.imwrite(str(REP / ('new_seam_%s.jpg' % nm)), np.concatenate([np.concatenate(tl[j:j + 6], 1) for j in range(0, len(tl), 6)], 0), [cv2.IMWRITE_JPEG_QUALITY, 88])
