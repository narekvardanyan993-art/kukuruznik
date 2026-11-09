#!/usr/bin/env python3
"""Заход 20: шоу B без «собаки задом наперёд». В конце ролика (отмотка времени ×2,5) собака бежала назад спиной вперёд.
Теперь: там, где она бежала, — пустое место (кадр вперёд-части 2,0 с, собака уже убежала), последние 0,7 с собака плавно
проявляется спящей (= первый кадр ролика = рисунок). Остальной ролик не меняется. Оригинал: chka-kitchen/zhivost-v2/orig/vid_b_show.orig.mp4/.webm."""
import subprocess, shutil, numpy as np, cv2
from pathlib import Path
FR = Path('tests/pogos-petros/frames'); SRC = next(p for p in (Path.home() / 'Documents/chka-kitchen', Path.home() / 'mnt/chka-kitchen') if p.exists()) / 'zhivost-v2/orig/vid_b_show.orig.mp4'   # оригинал (до захода 20) — на кухне, вне git
cap = cv2.VideoCapture(str(SRC)); fps = cap.get(5); n = int(cap.get(7)); W = int(cap.get(3)); H = int(cap.get(4))
head = []
for i in range(int(2.0 * fps) + 1):
    ok, f = cap.read(); head.append(f.astype(np.float32))
cap.release()
absent = head[-1]; fw0 = head[0]
d = np.max(np.stack([np.abs(x - absent).max(-1) for x in head[:-int(0.2 * fps)]]), 0)
m = (d > 24).astype(np.uint8); m[:int(H * 0.45)] = 0          # только низ: путь собаки, не стена с трещинами
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)); m = cv2.dilate(m, np.ones((25, 25), np.uint8))
m = np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 9) * 1.3, 0, 1)[..., None]
ramp0, hold0 = n - int(round(0.7 * fps)), n - int(round(0.9 * fps))
def frames():
    cap = cv2.VideoCapture(str(SRC)); i = 0
    while True:
        ok, f = cap.read()
        if not ok: break
        if i >= hold0:
            a = 0.0 if i < ramp0 else min(1.0, (i - ramp0 + 1) / (n - ramp0))
            a = a * a * (3 - 2 * a)
            tgt = absent * (1 - a) + fw0 * a
            f = np.clip(f * (1 - m) + tgt * m, 0, 255).astype(np.uint8)
        yield f; i += 1
def enc(args, out):
    p = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '%dx%d' % (W, H), '-r', str(fps), '-i', '-', '-an'] + args + [str(out)], stdin=subprocess.PIPE)
    for f in frames(): p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
import sys
if 'mp4' in sys.argv: enc(['-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart'], FR / 'vid_b_show.mp4')
if 'webm' in sys.argv: enc(['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'], FR / 'vid_b_show.webm')
if 'sheet' in sys.argv:
    cap = cv2.VideoCapture(str(FR / 'vid_b_show.mp4')); k = int(cap.get(7)); out = []
    for t in np.arange(5, -0.01, -0.25):
        cap.set(1, max(0, k - 1 - int(t * fps))); ok, f = cap.read(); out.append(cv2.resize(f[int(H * 0.68):int(H * 0.98), int(W * 0.3):int(W * 0.8)], (150, 90)))
    cv2.imwrite(str(Path.home() / 'mnt/chka-kitchen/zhivost-v2/bshow20.jpg'), np.concatenate([np.concatenate(out[:11], 1), np.concatenate(out[10:21], 1)], 0))
print('ok', n, fps, W, H, 'mask', round(float((m > 0.5).mean()), 3))
