#!/usr/bin/env python3
"""Заход 14: видео Veo (живое место кадра) → проверка стиля/фона и патч для движка.
check <mp4> <кадр> x0 y0 w [rect u0 v0 u1 v1]  — совмещение 1-го кадра с рисунком (ECC по контурам), цвет, контуры, «плывёт ли фон» → report/s14/<имя>_check.jpg + json
patch <mp4> <кадр> x0 y0 w u0 v0 u1 v1 <имя> [--xfade 1.0] [--seg с0 с1] [--pingpong] — вырезка прямоугольника патча (в пикселях кадра ×2), бесшовная петля (кроссфейд конца с началом), H.264 → tests/pogos-petros/frames/vid_<имя>.mp4
  + маска мягкого края vid_<имя>_mask.png (движение по времени, растушёвка, 0 у краёв рамки)"""
import sys, json, subprocess, os
import numpy as np, cv2
from pathlib import Path
from PIL import Image
R = Path('.'); FR = R / 'tests/pogos-petros/frames'; REP = R / 'pogos-petros/build/report/s14'; REP.mkdir(parents=True, exist_ok=True)
SW, SH = 1369, 765   # снимок вкладки, который получил Veo

def frames(mp4):
    cap = cv2.VideoCapture(str(mp4)); out = []
    while True:
        ok, f = cap.read()
        if not ok: break
        out.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    return out

def crop_box(x0, y0, w):
    return x0, y0, w, w * SH / SW

def edges(a):
    return cv2.GaussianBlur(cv2.Canny(cv2.cvtColor(a, cv2.COLOR_RGB2GRAY), 50, 130).astype(np.float32), (0, 0), 2)

def align(fr0, ref):
    W = np.eye(2, 3, dtype=np.float32)
    try: cc, W = cv2.findTransformECC(edges(ref), edges(fr0), W, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 400, 1e-6), None, 5)
    except cv2.error: cc = -1
    return cc, W

def load(frame_name, x0, y0, w, scale=2):
    B = np.array(Image.open(FR / frame_name).convert('RGB'))
    X0, Y0, Wc, Hc = crop_box(x0, y0, w)
    big = cv2.resize(B, (B.shape[1] * scale, B.shape[0] * scale), interpolation=cv2.INTER_CUBIC)
    xa, ya, xb, yb = int(round(X0 * scale)), int(round(Y0 * scale)), int(round((X0 + Wc) * scale)), int(round((Y0 + Hc) * scale))
    return B, big, (xa, ya, xb, yb)

def warped(vf, box, W):
    xa, ya, xb, yb = box
    g = [cv2.resize(f, (xb - xa, yb - ya), interpolation=cv2.INTER_AREA) for f in vf]
    return [cv2.warpAffine(x, W, (xb - xa, yb - ya), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE) for x in g]

def lab(a): return cv2.cvtColor(a, cv2.COLOR_RGB2LAB).astype(np.float32)

def check(mp4, frame_name, x0, y0, w, rect=None):
    vf = frames(mp4); B, big, box = load(frame_name, x0, y0, w)
    xa, ya, xb, yb = box; ref = big[ya:yb, xa:xb]
    g0 = cv2.resize(vf[0], (xb - xa, yb - ya), interpolation=cv2.INTER_AREA)
    cc, W = align(g0, ref)
    ws = warped(vf, box, W)
    h, w2 = ref.shape[:2]
    m = np.zeros((h, w2), bool)
    if rect:   # область живого (собака) с запасом — вне неё фон должен стоять
        u0, v0, u1, v1 = rect; px = lambda u, X: (u * B.shape[1] * 2 - xa) if X else (u * B.shape[0] * 2 - ya)
        a0, b0, a1, b1 = int(px(u0, 1)) - 30, int(px(v0, 0)) - 30, int(px(u1, 1)) + 30, int(px(v1, 0)) + 30
        m[max(0, b0):b1, max(0, a0):a1] = True
    bgm = ~m; bgm[:12] = bgm[-12:] = False; bgm[:, :12] = bgm[:, -12:] = False
    bgm[int(h * 0.80):, int(w2 * 0.80):] = False   # водяной знак Veo в углу
    L0, Lr = lab(ws[0]), lab(ref)
    dE0 = np.sqrt(((L0 - Lr) ** 2).sum(-1))
    stack = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in ws])
    sd = stack.std(0)
    eA, eB = edges(ref), edges(ws[0]); ec = float((eA * eB).sum() / np.sqrt((eA ** 2).sum() * (eB ** 2).sum()))
    dlast = np.abs(stack[-1] - stack[0])
    rep = {'frames': len(vf), 'ecc': round(float(cc), 3), 'affine': W.round(4).tolist(),
           'dE_first_vs_drawing_bg_median': round(float(np.median(dE0[bgm])), 2), 'dE_bg_p90': round(float(np.percentile(dE0[bgm], 90)), 2),
           'mean_rgb_drawing': ref[bgm].mean(0).round(1).tolist(), 'mean_rgb_video': ws[0][bgm].mean(0).round(1).tolist(),
           'edge_corr_first_vs_drawing': round(ec, 3),
           'bg_temporal_std_median': round(float(np.median(sd[bgm])), 2), 'bg_temporal_std_p95': round(float(np.percentile(sd[bgm], 95)), 2),
           'bg_last_vs_first_abs_p95': round(float(np.percentile(dlast[bgm], 95)), 2),
           'live_temporal_std_p95': round(float(np.percentile(sd[m], 95)), 2) if m.any() else None}
    name = Path(mp4).stem
    json.dump(rep, open(REP / (name + '_check.json'), 'w'), indent=1)
    idx = [0, len(ws) // 4, len(ws) // 2, 3 * len(ws) // 4, len(ws) - 1]
    heat = cv2.applyColorMap(np.clip(sd * 8, 0, 255).astype(np.uint8), cv2.COLORMAP_JET)[..., ::-1]
    tiles = [ref] + [ws[i] for i in idx] + [heat]
    th = 360; tw = int(w2 * th / h)
    S = np.concatenate([np.concatenate([cv2.resize(t, (tw, th)) for t in tiles[:4]], 1), np.concatenate([cv2.resize(t, (tw, th)) for t in tiles[4:]] + [np.full((th, tw, 3), 240, np.uint8)], 1)], 0)
    Image.fromarray(S).save(REP / (name + '_check.jpg'), quality=85)
    print(json.dumps(rep, ensure_ascii=False))

def patch(mp4, frame_name, x0, y0, w, rect, nm, xfade=1.0, fps=24, seg=None, pingpong=False):
    vf = frames(mp4); B, big, box = load(frame_name, x0, y0, w)
    xa, ya, xb, yb = box; ref = big[ya:yb, xa:xb]
    g0 = cv2.resize(vf[0], (xb - xa, yb - ya), interpolation=cv2.INTER_AREA)   # совмещение — по 1-му кадру всего видео (он = рисунок)
    if seg: vf = vf[int(seg[0] * fps):int(seg[1] * fps)]   # кусок видео (с)
    cc, W = align(g0, ref); ws = warped(vf, box, W)
    u0, v0, u1, v1 = rect; FW, FH = B.shape[1], B.shape[0]
    px0, py0, px1, py1 = int(round(u0 * FW)), int(round(v0 * FH)), int(round(u1 * FW)), int(round(v1 * FH))   # рамка патча, пиксели кадра
    c0x, c0y = px0 * 2 - xa, py0 * 2 - ya; cw, chh = (px1 - px0) * 2, (py1 - py0) * 2
    clip = [x[c0y:c0y + chh, c0x:c0x + cw] for x in ws]
    # цвет видео — к рисунку (множитель по рамке патча, 1-й кадр против рисунка)
    rr = ref[c0y:c0y + chh, c0x:c0x + cw].astype(np.float32); c0 = clip[0].astype(np.float32)
    gn = np.clip(rr.reshape(-1, 3).mean(0) / np.maximum(c0.reshape(-1, 3).mean(0), 1), 0.85, 1.15)
    clip = [np.clip(x.astype(np.float32) * gn, 0, 255).astype(np.uint8) for x in clip]
    # бесшовная петля: последние xfade с плавно переходят в первые (выход короче на xfade)
    n = len(clip); k = int(round(xfade * fps))
    if pingpong:   # туда-обратно: шва нет вовсе (для сцен, где начало и конец разные — голуби пришли и клюют)
        loop = clip + clip[-2:0:-1]
    else:
      loop = [clip[i] for i in range(k, n - k)] + [(clip[n - k + j].astype(np.float32) * (1 - (j + 0.5) / k) + clip[j].astype(np.float32) * ((j + 0.5) / k)).astype(np.uint8) for j in range(k)]
    # маска: где видео движется или отличается от рисунка — 1, растушёвка, у краёв рамки — 0
    st = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in loop]).std(0)
    d = np.abs(np.stack([x.astype(np.float32) for x in loop]).mean(0) - rr).max(-1)
    mm = ((st > 4) | (d > 22)).astype(np.uint8)
    mm = cv2.morphologyEx(mm, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)); mm = cv2.dilate(mm, np.ones((15, 15), np.uint8))
    ma = cv2.GaussianBlur(mm.astype(np.float32), (0, 0), 7)
    edge = np.ones_like(ma); e = 10; ramp = np.linspace(0, 1, e)
    edge[:e] *= ramp[:, None]; edge[-e:] *= ramp[::-1][:, None]; edge[:, :e] *= ramp[None]; edge[:, -e:] *= ramp[::-1][None]
    ma = np.clip(ma * 1.4, 0, 1) * edge
    Image.fromarray((ma * 255).astype(np.uint8)).save(FR / ('vid_%s_mask.png' % nm))
    tmp = REP / ('%s_frames' % nm); tmp.mkdir(exist_ok=True)
    for i, x in enumerate(loop): Image.fromarray(x).save(tmp / ('%04d.png' % i))
    out = FR / ('vid_%s.mp4' % nm)
    for crf in (24, 27, 30, 33):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', str(tmp / '%04d.png'), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf),
                        '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart', str(out)], check=True)
        if out.stat().st_size <= 400 * 1024: break
    # запасной WebM (VP9) — для браузеров без H.264 (Chromium без проприетарных кодеков, снимки в облаке)
    wb = FR / ('vid_%s.webm' % nm)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', str(tmp / '%04d.png'), '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36',
                    '-row-mt', '1', '-pix_fmt', 'yuv420p', str(wb)], check=True)
    # первый кадр петли = неподвижная картинка патча (рисунок остаётся основой, видео — поверх по маске)
    rep = {'ecc': round(float(cc), 3), 'rect_px': [px0, py0, px1, py1], 'video_px': [cw, chh], 'frames': len(loop), 'sec': round(len(loop) / fps, 2),
           'gain': gn.round(3).tolist(), 'crf': crf, 'bytes': out.stat().st_size, 'mask_cover': round(float((ma > 0.5).mean()), 3)}
    json.dump(rep, open(REP / ('%s_patch.json' % nm), 'w'), indent=1); print(json.dumps(rep))

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'check':
        check(a[1], a[2], float(a[3]), float(a[4]), float(a[5]), [float(x) for x in a[6:10]] if len(a) >= 10 else None)
    elif a[0] == 'patch':
        xf = float(a[a.index('--xfade') + 1]) if '--xfade' in a else 1.0
        sg = [float(a[a.index('--seg') + 1]), float(a[a.index('--seg') + 2])] if '--seg' in a else None
        patch(a[1], a[2], float(a[3]), float(a[4]), float(a[5]), [float(x) for x in a[6:10]], a[10], xf, seg=sg, pingpong='--pingpong' in a)
