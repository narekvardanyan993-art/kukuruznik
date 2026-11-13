#!/usr/bin/env python3
"""Заход 22 (копия 21 с окном): собака уходит по запаху (Veo из вырезки 186,880 480×270 кадра B — та же, что у роликов живой собаки).
Заход 21: шоу B — собака пугается обрушения (отзыв: «собака резко выпрыгивает и резко уходит за сцену»).
Из оригинала шоу (кухня zhivost-v2/orig/vid_b_show.orig.mp4):
  • вперёд-часть 0–10 с: старая собака (выпрыгивала на 1–1,5 с) убрана — её путь заменён пустым местом (кадр 2,0 с);
    поверх — собака из Veo dog_scared_a9d6dd19 (in_dog_scared.png: спит → трещины и камешки → просыпается, смотрит
    вверх с испугом, пятится, убегает вправо за кадр к 8 с); маска — где ролик собаки отличается от своего пустого
    последнего кадра (тело, тень, пыль);
  • конец (отмотка): как bshow20 — собаки нет, последние 0,7 с проявляется спящей.
wx: python3 bshow21.py mp4|webm|sheet"""
import sys, subprocess, numpy as np, cv2
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent)); import fix15
FR = Path('tests/pogos-petros/frames')
KIT = next(p for p in (Path.home() / 'Documents/chka-kitchen', Path.home() / 'mnt/chka-kitchen') if p.exists())
SRC = KIT / 'zhivost-v2/orig/vid_b_show.orig.mp4'; DOG = Path(sys.argv[sys.argv.index('--dog') + 1]) if '--dog' in sys.argv else KIT / 'zhivost-v2/veo/dog_sniff.mp4'
cap = cv2.VideoCapture(str(SRC)); fps = cap.get(5); n = int(cap.get(7)); W = int(cap.get(3)); H = int(cap.get(4))
head = [cap.read()[1].astype(np.float32) for _ in range(int(2.0 * fps) + 1)]; cap.release()
absent = head[-1]; fw0 = head[0]
d = np.max(np.stack([np.abs(x - absent).max(-1) for x in head[:-int(0.2 * fps)]]), 0)
m = (d > 24).astype(np.uint8); m[:int(H * 0.45)] = 0
m = cv2.dilate(cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)), np.ones((25, 25), np.uint8))
m = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 9) * 1.3, 0, 1)[..., None]
# собака Veo → координаты ролика шоу
dc = cv2.VideoCapture(str(DOG)); dfr = []
while True:
    ok, f = dc.read()
    if not ok: break
    dfr.append(f)
# окно вырезки кадра B (186,880 480×270 в кадре 768×1365) в координатах ролика шоу (rect шоу 0…1 × 0,14…0,88 → 768×1010, сверху 191)
sx, sy = W / 768.0, H / (1365 * (0.879846 - 0.139934)); oy = 1365 * 0.139934
wx0, wy0, ww, wh = int(round(186 * sx)), int(round((880 - oy) * sy)), int(round(480 * sx)), int(round(270 * sy))
y0 = wy0; ref = fw0[wy0:wy0 + wh, wx0:wx0 + ww].astype(np.uint8)
tm, cc, Wm = fix15.locate(dfr[0], ref)      # пиксель ref → пиксель клипа
warp = lambda f: cv2.warpAffine(f, Wm, (ww, wh), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
empty = warp(dfr[-1]).astype(np.float32)
gn = np.clip(np.median(ref.reshape(-1, 3), 0) / np.maximum(np.median(warp(dfr[0]).reshape(-1, 3), 0), 1), 0.85, 1.15)
ND = len(dfr)
def dog_layer(i):
    if i >= ND: return None, None
    g = warp(dfr[i]).astype(np.float32)
    dm = (np.abs(g - empty).max(-1) > 28).astype(np.uint8)
    dm = cv2.dilate(cv2.morphologyEx(dm, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), np.ones((7, 7), np.uint8))
    a = np.clip(cv2.GaussianBlur(dm.astype(np.float32), (0, 0), 2.5) * 1.4, 0, 1)
    e = 18; ramp = np.linspace(0, 1, e); edge = np.ones_like(a); edge[:, :e] *= ramp[None]; edge[:, -e:] *= ramp[::-1][None]; edge[:e] *= ramp[:, None]
    a = (a * edge)[..., None]
    return np.clip(g * gn, 0, 255), a
ramp0, hold0 = n - int(round(0.7 * fps)), n - int(round(0.9 * fps))
PRE = float(sys.argv[sys.argv.index('--pre') + 1]) if '--pre' in sys.argv else 4.0   # с: собака успевает уйти до обрушения (видео длиннее на PRE)
NP = int(round(PRE * fps))
def frames():
    cap = cv2.VideoCapture(str(SRC)); o = 0
    while True:
        i = o - NP                                     # кадр оригинала (до 0 — стоп-кадр начала)
        if i < 0: f = fw0.copy()
        else:
            ok, f = cap.read()
            if not ok: break
            f = f.astype(np.float32)
        if i < int(2.2 * fps): f = f * (1 - m) + absent * m      # нарисованная/старая собака убрана — её ведёт ролик Veo
        if o < ND:
            g, a = dog_layer(o)
            sub = f[wy0:wy0 + wh, wx0:wx0 + ww]; f[wy0:wy0 + wh, wx0:wx0 + ww] = sub * (1 - a) + g * a
        if i >= hold0:
            k = 0.0 if i < ramp0 else min(1.0, (i - ramp0 + 1) / (n - ramp0)); k = k * k * (3 - 2 * k)
            f = f * (1 - m) + (absent * (1 - k) + fw0 * k) * m
        yield np.clip(f, 0, 255).astype(np.uint8); o += 1
def enc(args, out):
    p = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '%dx%d' % (W, H), '-r', str(fps), '-i', '-', '-an'] + args + [str(out)], stdin=subprocess.PIPE)
    for f in frames(): p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
if 'mp4' in sys.argv: enc(['-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart'], FR / 'vid_b_show.mp4')
if 'webm' in sys.argv: enc(['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'], FR / 'vid_b_show.webm')
if 'sheet' in sys.argv:
    out = []
    for k, f in enumerate(frames()):
        if k in [int(t * fps) for t in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13)]: out.append(cv2.resize(f[int(H * 0.5):], (256, int(256 * (H * 0.5) / W))))
        if k > 13.1 * fps: break
    cv2.imwrite(str(KIT / 'zhivost-v2/bshow22.jpg'), np.concatenate([np.concatenate(out[j:j + 4], 1) for j in range(0, 12, 4)], 0))
print('ok tm', round(tm, 3), 'ecc', round(cc, 3), 'dog frames', ND)
