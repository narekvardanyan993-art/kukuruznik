#!/usr/bin/env python3
"""Синемаграф из видео Veo поверх полного резкого рисунка (e1.13, docs/ENGINE-LIFE.md «Синемаграф»).

  python3 tools/cinemagraph.py tests/<здание> <кадр> видео.mp4 [--fps 20] [--loop 6] [--fade 1.0] [--thr 9] [--crf 30]
          [--exclude u0,v0,u1,v1;...] [--report DIR]

1. Кадры видео приводятся к размеру кадра и совмещаются с рисунком (сдвиг/масштаб по контурам, как маска дорог).
2. Движение = разброс яркости пикселя по времени (после лёгкого размытия) > --thr; мелочь и шум сжатия убираются, маска
   расширяется и смягчается. Водяной знак Veo (правый нижний угол) и рамки --exclude в маску не попадают; слой здания — тоже
   (движение только на фоне: машины, люди, птицы, кроны).
3. Каждый кадр синемаграфа = полный резкий рисунок, а там, где кадр видео заметно отличается от своего неподвижного фона (медиана по
   времени) и есть в маске, — пиксели видео (мягкий переход): что Veo перерисовал по-своему, но не двигает (стоящие машины, оттенок
   дороги), не попадает. Вне движения — неподвижный рисунок, поэтому видео почти ничего не весит.
4. Петля без шва: последние --fade секунд растворяются в первые (кроссфейд), длина петли --loop секунд.
5. Вывод: frames/<кадр>_motion.mp4 (H.264 baseline, yuv420p, faststart, без звука — играет на iPhone inline), запасной
   frames/<кадр>_motion.webm (VP9 — браузеры без H.264) и
   frames/<кадр>_motion_mask.png (маска для движка: видео кладётся только в ней, на глубине фона, с наклоном).
   --report: сравнение рядом, кадры и маска.
"""
import json, subprocess, sys, tempfile
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


def main():
    a = sys.argv[1:]
    bdir, name, src = Path(a[0]), a[1], a[2]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    fps, loop, fade, thr, crf = float(opt('--fps', 20)), float(opt('--loop', 6)), float(opt('--fade', 1.0)), float(opt('--thr', 9)), int(opt('--crf', 30))
    fd = bdir / 'frames'
    day = np.asarray(Image.open(fd / (name + '.webp')).convert('RGB'))
    H, W = day.shape[:2]
    H2, W2 = H - H % 2, W - W % 2                                                     # H.264 — чётные стороны
    bld = np.asarray(Image.open(fd / (name + '_building.webp')))[..., 3] > 60
    frames = read_frames(src, W, H, fps)
    M, score, par = align(day, frames[0], np.zeros((H, W), bool))
    frames = [cv2.warpAffine(f, M, (W, H), borderMode=cv2.BORDER_REPLICATE) for f in frames]
    print('%s: видео %d кадров по %g к/с, совмещено sx=%.3f sy=%.3f dx=%d dy=%d (corr %.3f)' % (name, len(frames), fps, *par, score))
    # 2. маска движения
    L = np.stack([cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (0, 0), 1.6).astype(np.float32) for f in frames])
    sd = L.std(0)
    mv = (sd > thr).astype(np.uint8)
    excl = np.zeros((H, W), bool)
    excl[int(H * 0.93):, int(W * 0.72):] = True                                        # водяной знак Veo
    for box in (opt('--exclude') or '').split(';'):
        if box:
            u0, v0, u1, v1 = map(float, box.split(','))
            excl[int(v0 * H):int(v1 * H), int(u0 * W):int(u1 * W)] = True
    mv[excl | cv2.dilate(bld.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)] = 0
    mv = cv2.morphologyEx(mv, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(mv)
    mv = np.isin(lab, [i for i in range(1, n) if st[i][4] >= 12]).astype(np.uint8)
    mv = cv2.dilate(mv, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    mask = cv2.GaussianBlur(mv.astype(np.float32), (0, 0), 3.0)
    mask = np.clip(mask * 1.6, 0, 1)
    mask[excl] = 0
    print('%s: в движении %.1f %% кадра' % (name, (mask > 0.5).mean() * 100))
    # 3–4. кадры поверх резкого рисунка + петля
    n_loop = min(len(frames), int(round(loop * fps)))
    n_fade = int(round(fade * fps))
    if n_loop + n_fade > len(frames):
        n_loop = len(frames) - n_fade
    m3, d = mask[..., None], day.astype(np.float32)
    bg = np.median(np.stack(frames[::4]).astype(np.float32), 0)                      # неподвижный фон видео (медиана по времени)
    out = []
    for t in range(n_loop):
        f = frames[t].astype(np.float32)
        if t < n_fade:                                                               # шов: хвост растворяется в начало
            k = (t + 1) / (n_fade + 1)
            f = f * k + frames[n_loop + t].astype(np.float32) * (1 - k)
        # только ОТЛИЧИЕ кадра видео от его неподвижного фона ложится на рисунок: цвет и насыщенность — от рисунка,
        # а то, что Veo нарисовал по-своему (стоящие машины, оттенок), не попадает
        dv = cv2.GaussianBlur(np.abs(f - bg).max(-1), (0, 0), 1.5)
        wv = (np.clip((dv - 10) / 18, 0, 1) * mask)[..., None]                           # где кадр заметно отличается от фона — пиксель видео целиком
        out.append(np.clip(d * (1 - wv) + f * wv + 0.5, 0, 255).astype(np.uint8)[:H2, :W2])
    tmp = Path(tempfile.mkdtemp())
    for i, f in enumerate(out):
        Image.fromarray(f).save(tmp / ('o_%04d.png' % i))
    mp4 = fd / (name + '_motion.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '%g' % fps, '-i', str(tmp / 'o_%04d.png'), '-an', '-c:v', 'libx264', '-profile:v', 'baseline',
                    '-level', '3.1', '-pix_fmt', 'yuv420p', '-crf', str(crf), '-preset', 'slow', '-movflags', '+faststart', str(mp4)], check=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', '%g' % fps, '-i', str(tmp / 'o_%04d.png'), '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40',
                    '-pix_fmt', 'yuv420p', '-row-mt', '1', str(fd / (name + '_motion.webm'))], check=True)   # запасной для браузеров без H.264
    ma = (mask[:H2, :W2] * 255 + 0.5).astype(np.uint8)   # маска — в альфе (движок вырезает видео по альфе: destination-in)
    Image.fromarray(np.dstack([np.full_like(ma, 255), ma]), 'LA').save(fd / (name + '_motion_mask.png'), optimize=True)
    print('%s: %s — %d кадров, %g к/с, петля %.1f с, %d КБ; маска %d КБ' % (name, mp4.name, len(out), fps, len(out) / fps, mp4.stat().st_size // 1024,
                                                                         (fd / (name + '_motion_mask.png')).stat().st_size // 1024))
    rep = opt('--report')
    if rep:
        rep = Path(rep); rep.mkdir(parents=True, exist_ok=True)
        ov = day.astype(np.float32).copy(); ov = ov * (1 - 0.5 * m3) + np.array([255, 40, 160]) * 0.5 * m3
        Image.fromarray(ov.astype(np.uint8)).save(rep / ('mask_%s.jpg' % name), quality=85)
        json.dump({'frames': len(out), 'fps': fps, 'loop_s': len(out) / fps, 'mp4_kb': mp4.stat().st_size // 1024, 'moving_pct': round(float((mask > 0.5).mean() * 100), 2),
                   'align': [round(float(x), 3) for x in par], 'corr': round(float(score), 3)}, open(rep / ('stats_%s.json' % name), 'w'))
    for p in tmp.glob('*'):
        p.unlink()
    tmp.rmdir()


if __name__ == '__main__':
    main()
