#!/usr/bin/env python3
"""Заход 15 (e1.50): совмещение ответов Gemini/Veo с кадром, видео шоу A/B/C, старик в непогоду.
align <картинка> <кадр.webp> x0 y0 w h  — где в картинке Gemini лежит вырезка кадра (масштаб+сдвиг matchTemplate, затем ECC аффинно) → json
"""
import sys, json, subprocess
import numpy as np, cv2
from pathlib import Path
from PIL import Image
R = Path('.'); FR = R / 'tests/pogos-petros/frames'; REP = R / 'pogos-petros/build/report/s15'; REP.mkdir(parents=True, exist_ok=True)

def edges(a):
    g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY) if a.ndim == 3 else a
    return cv2.GaussianBlur(cv2.Canny(g, 50, 130).astype(np.float32), (0, 0), 2)

def frame_crop(frame_name, x0, y0, w, h, scale=1.0):
    B = np.array(Image.open(FR / frame_name).convert('RGB'))
    big = cv2.resize(B, (int(round(B.shape[1] * scale)), int(round(B.shape[0] * scale))), interpolation=cv2.INTER_CUBIC) if scale != 1 else B
    xa, ya = int(round(x0 * scale)), int(round(y0 * scale)); xb, yb = int(round((x0 + w) * scale)), int(round((y0 + h) * scale))
    return B, big[ya:yb, xa:xb], (xa, ya, xb, yb)

def locate(G, ref):
    """G (картинка Gemini/кадр видео) → аффинная W: пиксель ref -> пиксель G. Перебор масштаба (matchTemplate центра ref), затем ECC."""
    h, w = ref.shape[:2]; m = 0.12; inner = ref[int(h * m):int(h * (1 - m)), int(w * m):int(w * (1 - m))]
    eI = edges(inner); best = (-2, None)
    gw = G.shape[1]
    for k in np.linspace(0.8, 1.25, 46):
        s = gw / w * k   # пикселей G на пиксель ref
        tw, th = int(inner.shape[1] * s), int(inner.shape[0] * s)
        if tw >= G.shape[1] or th >= G.shape[0]: continue
        t = cv2.resize(eI, (tw, th)); r = cv2.matchTemplate(edges(G), t, cv2.TM_CCOEFF_NORMED); _, mv, _, ml = cv2.minMaxLoc(r)
        if mv > best[0]: best = (mv, (s, ml[0] - int(w * m) * s, ml[1] - int(h * m) * s))
    s, ox, oy = best[1]
    W = np.array([[s, 0, ox], [0, s, oy]], np.float32)
    # ECC: G, сведённая к размеру ref обратной W, против ref
    try:
        Wi = cv2.invertAffineTransform(W)
        g2 = cv2.warpAffine(G, W, (w, h), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
        D = np.eye(2, 3, dtype=np.float32)
        cc, D = cv2.findTransformECC(edges(ref), edges(g2), D, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
        W3 = np.vstack([W, [0, 0, 1]]) @ np.vstack([D, [0, 0, 1]]); W = W3[:2].astype(np.float32)
    except cv2.error: cc = -1
    return float(best[0]), float(cc), W

def warp_to(G, W, w, h):
    return cv2.warpAffine(G, W, (w, h), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)

def cmd_align(img, frame_name, x0, y0, w, h):
    G = np.array(Image.open(img).convert('RGB')); B, ref, box = frame_crop(frame_name, x0, y0, w, h)
    tm, cc, W = locate(G, ref); g2 = warp_to(G, W, ref.shape[1], ref.shape[0])
    eA, eB = edges(ref), edges(g2); ec = float((eA * eB).sum() / np.sqrt((eA ** 2).sum() * (eB ** 2).sum()))
    rep = {'img': str(img), 'G': list(G.shape[:2]), 'tm': round(tm, 3), 'ecc': round(cc, 3), 'edge_corr': round(ec, 3), 'W': W.round(4).tolist()}
    th = 300; tw = int(ref.shape[1] * th / ref.shape[0])
    Image.fromarray(np.concatenate([cv2.resize(ref, (tw, th)), cv2.resize(g2, (tw, th)), cv2.resize(np.abs(ref.astype(int) - g2.astype(int)).astype(np.uint8) * 3, (tw, th))], 1)).save(REP / (Path(img).stem + '_align.jpg'), quality=85)
    print(json.dumps(rep)); return rep

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'align': cmd_align(a[1], a[2], *map(float, a[3:7]))

def cmd_inset(img, frame_name, x0, y0, w, h, bx0, by0, bx1, by1, name, thr=40, grow=6):
    """Вписать в рисунок только область отличия ответа Gemini внутри рамки bx (пиксели кадра) → RGBA-заплатка ×2 (report/s15/<name>_inset.png) + json с местом."""
    G = np.array(Image.open(img).convert('RGB')); B, ref, box = frame_crop(frame_name, x0, y0, w, h)
    tm, cc, W = locate(G, ref)
    S = 2.0; Wb = W.copy(); Wb[:, :2] /= S   # пиксель ×2 → пиксель G
    X0, Y0, X1, Y1 = int(bx0 * S), int(by0 * S), int(bx1 * S), int(by1 * S)
    T = np.array([[1, 0, X0 - x0 * S], [0, 1, Y0 - y0 * S]], np.float32)   # пиксель заплатки → пиксель «вырезки ×2»
    M = np.vstack([Wb, [0, 0, 1]]) @ np.vstack([T, [0, 0, 1]])
    g = cv2.warpAffine(G, M[:2].astype(np.float32), (X1 - X0, Y1 - Y0), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    B2 = cv2.resize(B, (B.shape[1] * 2, B.shape[0] * 2), interpolation=cv2.INTER_CUBIC)[Y0:Y1, X0:X1]
    d = np.sqrt(((cv2.cvtColor(g, cv2.COLOR_RGB2LAB).astype(np.float32) - cv2.cvtColor(B2, cv2.COLOR_RGB2LAB).astype(np.float32)) ** 2).sum(-1))
    m = (cv2.GaussianBlur(d, (0, 0), 2) > thr).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)); m = cv2.dilate(m, np.ones((grow, grow), np.uint8))
    a = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 2.5); e = 6
    a[:e] = 0; a[-e:] = 0; a[:, :e] = 0; a[:, -e:] = 0; a = np.clip(a * 1.5, 0, 1)
    out = np.dstack([g, (a * 255).astype(np.uint8)])
    Image.fromarray(out).save(REP / (name + '_inset.png'))
    comp = (B2 * (1 - a[..., None]) + g * a[..., None]).astype(np.uint8)
    Image.fromarray(np.concatenate([B2, comp, np.dstack([(a * 255).astype(np.uint8)] * 3)], 1)).save(REP / (name + '_inset_check.jpg'), quality=88)
    rep = {'tm': round(tm, 3), 'ecc': round(cc, 3), 'box_frame_px': [bx0, by0, bx1, by1], 'scale': S, 'cover': round(float((a > 0.5).mean()), 3)}
    json.dump(rep, open(REP / (name + '_inset.json'), 'w')); print(json.dumps(rep))

if __name__ == '__main__' and sys.argv[1] == 'inset':
    a = sys.argv[1:]; cmd_inset(a[1], a[2], *map(float, a[3:11]), a[11], *(map(float, a[12:14]) if len(a) > 12 else []))

def vframes(mp4):
    cap = cv2.VideoCapture(str(mp4)); out = []; fps = cap.get(cv2.CAP_PROP_FPS) or 24
    while True:
        ok, f = cap.read()
        if not ok: break
        out.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    return out, fps

def cmd_vcheck(mp4, frame_name, x0, y0, w, h, live=None):
    """Видео против рисунка: совмещение 1-го кадра (масштаб+ECC), контуры, фон по времени, лист 12 кадров по времени → report/s15/<имя>_vcheck.jpg/json"""
    vf, fps = vframes(mp4); B, ref, box = frame_crop(frame_name, x0, y0, w, h)
    tm, cc, W = locate(vf[0], ref); ws = [warp_to(f, W, ref.shape[1], ref.shape[0]) for f in vf]
    eA, eB = edges(ref), edges(ws[0]); ec = float((eA * eB).sum() / np.sqrt((eA ** 2).sum() * (eB ** 2).sum()))
    hh, ww = ref.shape[:2]; m = np.zeros((hh, ww), bool)
    if live:
        for (u0, v0, u1, v1) in live: m[int((v0 * B.shape[0] - y0)):int((v1 * B.shape[0] - y0)), int((u0 * B.shape[1] - x0)):int((u1 * B.shape[1] - x0))] = True
    bgm = ~m; bgm[:8] = bgm[-8:] = False; bgm[:, :8] = bgm[:, -8:] = False; bgm[int(hh * 0.85):, int(ww * 0.8):] = False
    st = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in ws]).std(0)
    dE = np.sqrt(((cv2.cvtColor(ws[0], cv2.COLOR_RGB2LAB).astype(np.float32) - cv2.cvtColor(ref, cv2.COLOR_RGB2LAB).astype(np.float32)) ** 2).sum(-1))
    rep = {'frames': len(vf), 'fps': fps, 'size': list(vf[0].shape[:2]), 'tm': round(tm, 3), 'ecc': round(cc, 3), 'edge_corr': round(ec, 3), 'W': W.round(3).tolist(),
           'dE_bg_median': round(float(np.median(dE[bgm])), 2), 'bg_std_median': round(float(np.median(st[bgm])), 2), 'bg_std_p95': round(float(np.percentile(st[bgm], 95)), 2),
           'live_std_p95': round(float(np.percentile(st[m], 95)), 2) if m.any() else None}
    nm = Path(mp4).stem; json.dump(rep, open(REP / (nm + '_vcheck.json'), 'w'))
    idx = np.linspace(0, len(ws) - 1, 11).astype(int); th = 240; tw = int(ww * th / hh)
    tiles = [ref] + [ws[i] for i in idx]
    rows = [np.concatenate([cv2.resize(t, (tw, th)) for t in tiles[k:k + 4]], 1) for k in range(0, 12, 4)]
    S = np.concatenate(rows, 0)
    for k, i in enumerate([None] + list(idx)):
        cv2.putText(S, 'draw' if i is None else '%.1fs' % (i / fps), ((k % 4) * tw + 6, (k // 4) * th + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
    Image.fromarray(S).save(REP / (nm + '_vcheck.jpg'), quality=85); print(json.dumps(rep)); return rep

if __name__ == '__main__' and sys.argv[1] == 'vcheck':
    a = sys.argv[1:]; lv = None
    if '--live' in a: lv = [list(map(float, x.split(','))) for x in a[a.index('--live') + 1].split(';')]
    cmd_vcheck(a[1], a[2], *map(float, a[3:7]), live=lv)

def cmd_spatch(mp4, frame_name, x0, y0, w, h, rect, nm, seg=None, hold=None, scale=1.0, limit=None, exclude=None, thr_d=22, thr_s=5, maxkb=900, crf0=24, fps_out=None, revspeed=1.0):
    """Видео-шоу: кусок rect (u,v кадра) из видео Veo, совмещённый с рисунком; цвет к рисунку; [--hold с] — вперёд, пауза, назад;
    маска: где видео отличается от рисунка или движется (limit — только в этих рамках u,v; exclude — кроме этих), растушёвка, 0 у края → tests/…/vid_<nm>.mp4/.webm/_mask.png"""
    vf, fps = vframes(mp4); B, ref, box = frame_crop(frame_name, x0, y0, w, h)
    tm, cc, W = locate(vf[0], ref)
    if seg: vf = vf[int(seg[0] * fps):int(seg[1] * fps)]
    FW, FH = B.shape[1], B.shape[0]; u0, v0, u1, v1 = rect
    px0, py0, px1, py1 = int(round(u0 * FW)), int(round(v0 * FH)), int(round(u1 * FW)), int(round(v1 * FH))
    ow, oh = int(round((px1 - px0) * scale / 2)) * 2, int(round((py1 - py0) * scale / 2)) * 2
    # пиксель выхода → пиксель вырезки (ref) → пиксель видео
    T = np.array([[(px1 - px0) / ow, 0, px0 - x0], [0, (py1 - py0) / oh, py0 - y0], [0, 0, 1]], np.float64)
    M = (np.vstack([W, [0, 0, 1]]) @ T)[:2].astype(np.float32)
    clip = [cv2.warpAffine(f, M, (ow, oh), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE) for f in vf]
    rr = cv2.resize(B[py0:py1, px0:px1], (ow, oh), interpolation=cv2.INTER_AREA if scale <= 1 else cv2.INTER_CUBIC).astype(np.float32)
    c0 = clip[0].astype(np.float32)
    gn = np.clip(np.median(rr.reshape(-1, 3), 0) / np.maximum(np.median(c0.reshape(-1, 3), 0), 1), 0.85, 1.15)
    clip = [np.clip(x.astype(np.float32) * gn, 0, 255).astype(np.uint8) for x in clip]
    if hold:
        rv = clip[::-1]; rv = [rv[min(len(rv) - 1, int(round(i * revspeed)))] for i in range(int(len(rv) / revspeed))] + [clip[0]]   # назад — «время отматывается» (быстрее в revspeed раз)
        loop = clip + [clip[-1]] * int(round(hold * fps)) + rv
    else: loop = clip
    if fps_out and fps_out < fps:
        step = fps / fps_out; loop = [loop[int(i * step)] for i in range(int(len(loop) / step))]; fps = fps_out
    stk = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in clip[::2]])
    st = stk.std(0); dmax = np.max(np.stack([np.abs(x.astype(np.float32) - rr).max(-1) for x in clip[::3]]), 0)
    mm = ((st > thr_s) | (dmax > thr_d)).astype(np.uint8)
    uv = lambda U, V: (int((U * FW - px0) * ow / (px1 - px0)), int((V * FH - py0) * oh / (py1 - py0)))
    if limit:
        lm = np.zeros_like(mm)
        for (a0, b0, a1, b1) in limit: (xa, ya), (xb, yb) = uv(a0, b0), uv(a1, b1); lm[max(0, ya):yb, max(0, xa):xb] = 1
        mm &= lm
    if exclude:
        for (a0, b0, a1, b1) in exclude: (xa, ya), (xb, yb) = uv(a0, b0), uv(a1, b1); mm[max(0, ya):yb, max(0, xa):xb] = 0
    mm = cv2.morphologyEx(mm, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)); mm = cv2.dilate(mm, np.ones((13, 13), np.uint8))
    ma = cv2.GaussianBlur(mm.astype(np.float32), (0, 0), 6)
    e = 10; ramp = np.linspace(0, 1, e); edge = np.ones_like(ma)
    edge[:e] *= ramp[:, None]; edge[-e:] *= ramp[::-1][:, None]; edge[:, :e] *= ramp[None]; edge[:, -e:] *= ramp[::-1][None]
    ma = np.clip(ma * 1.4, 0, 1) * edge
    Image.fromarray((ma * 255).astype(np.uint8)).save(FR / ('vid_%s_mask.png' % nm))
    tmp = REP / ('%s_frames' % nm); tmp.mkdir(exist_ok=True)
    for i, x in enumerate(loop): Image.fromarray(x).save(tmp / ('%04d.png' % i))
    n = len(loop); out = FR / ('vid_%s.mp4' % nm)
    for crf in (crf0, crf0 + 3, crf0 + 6, crf0 + 9):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', str(tmp / '%04d.png'), '-frames:v', str(n), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf),
                        '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart', str(out)], check=True)
        if out.stat().st_size <= maxkb * 1024: break
    wb = FR / ('vid_%s.webm' % nm)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', str(tmp / '%04d.png'), '-frames:v', str(n), '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38',
                    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', str(wb)], check=True)
    comp = (rr * (1 - ma[..., None]) + loop[len(clip) // 2].astype(np.float32) * ma[..., None]).astype(np.uint8)
    th = 300; tw = int(ow * th / oh)
    Image.fromarray(np.concatenate([cv2.resize(rr.astype(np.uint8), (tw, th)), cv2.resize(comp, (tw, th)), cv2.resize(np.dstack([(ma * 255).astype(np.uint8)] * 3), (tw, th))], 1)).save(REP / ('%s_spatch.jpg' % nm), quality=85)
    rep = {'tm': round(tm, 3), 'ecc': round(cc, 3), 'rect_px': [px0, py0, px1, py1], 'video_px': [ow, oh], 'frames': n, 'sec': round(n / fps, 2), 'fps': fps,
           'gain': gn.round(3).tolist(), 'crf': crf, 'mp4_kb': out.stat().st_size // 1024, 'webm_kb': wb.stat().st_size // 1024, 'mask_cover': round(float((ma > 0.5).mean()), 3)}
    json.dump(rep, open(REP / ('%s_spatch.json' % nm), 'w'), indent=1); print(json.dumps(rep))

def _boxes(a, key):
    return [list(map(float, x.split(','))) for x in a[a.index(key) + 1].split(';')] if key in a else None

if __name__ == '__main__' and sys.argv[1] == 'spatch':
    a = sys.argv[1:]
    g = lambda k, d=None, f=float: f(a[a.index(k) + 1]) if k in a else d
    cmd_spatch(a[1], a[2], *map(float, a[3:7]), list(map(float, a[7:11])), a[11],
               seg=[g('--seg'), float(a[a.index('--seg') + 2])] if '--seg' in a else None, hold=g('--hold'), scale=g('--scale', 1.0),
               limit=_boxes(a, '--limit'), exclude=_boxes(a, '--exclude'), thr_d=g('--thr', 22), maxkb=g('--maxkb', 900), crf0=g('--crf', 24, int), fps_out=g('--fps'), revspeed=g('--revspeed', 1.0))

def cmd_wx(gi, frame_name, x0, y0, w, h, rect, nm):
    """Старик в непогоду: ответ Gemini на КВАДРАТНУЮ вырезку (x0, y0, w×h пикселей кадра, через буфер обмена) → show_wx_<nm>.png (fix12.pose_png)."""
    sys.path.insert(0, str(Path(__file__).parent)); import fix12
    fr = np.array(Image.open(FR / frame_name).convert('RGB'))
    g = np.array(Image.open(fix12.gid(gi)).convert('RGB'))
    xa, ya, xb, yb = int(round(x0)), int(round(y0)), int(round(x0 + w)), int(round(y0 + h)); ref = fr[ya:yb, xa:xb]
    tm, cc, W = locate(g, ref); ga = warp_to(g, W, xb - xa, yb - ya)
    out = fr.astype(np.float32).copy(); yy, xx = np.mgrid[0:yb - ya, 0:xb - xa]
    e = np.clip(np.minimum.reduce([xx, xb - xa - 1 - xx, yy, yb - ya - 1 - yy]) / 8.0, 0, 1)[..., None]
    out[ya:yb, xa:xb] = ga * e + out[ya:yb, xa:xb] * (1 - e)
    fix12.pose_png(out, fr, rect, FR / ('show_wx_%s.png' % nm))
    im = np.array(Image.open(FR / ('show_wx_%s.png' % nm)))
    x0r, y0r = int(round(rect[0] * fr.shape[1])), int(round(rect[1] * fr.shape[0])); bb = fr[y0r:y0r + im.shape[0], x0r:x0r + im.shape[1]].astype(np.float32)
    a = im[..., 3:4] / 255.0; comp = (im[..., :3] * a + bb * (1 - a)).astype(np.uint8)
    Image.fromarray(np.concatenate([bb.astype(np.uint8), comp, np.dstack([im[..., 3]] * 3)], 1)).resize((im.shape[1] * 3 * 2, im.shape[0] * 2)).save(REP / ('wx_%s_check.jpg' % nm), quality=88)
    print(json.dumps({'tm': round(tm, 3), 'ecc': round(cc, 3), 'png': 'show_wx_%s.png' % nm, 'size': list(im.shape), 'alpha_cover': round(float((im[..., 3] > 127).mean()), 3)}))

if __name__ == '__main__' and sys.argv[1] == 'wx':
    a = sys.argv[1:]; cmd_wx(a[1], a[2], *map(float, a[3:7]), list(map(float, a[7:11])), a[11])
