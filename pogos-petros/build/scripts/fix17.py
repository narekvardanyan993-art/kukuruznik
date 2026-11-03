#!/usr/bin/env python3
"""Заход 17 (e1.52): шоу B «снос → руины → кинотеатр → назад», собака B по времени суток, фаэтон C поверх здания, надпись D гомографией.
ruins                       — последний кадр видео сноса (cf332728), совмещённый с кадром B (весь кадр 768×1365) → gemini/up/b_ruins17.png (вход Veo)
crop <кадр.webp> x0 y0 w h s — точная вырезка кадра ×s → gemini/up/<кадр>_<x0>_<y0>.png (вложение Gemini/Veo)
"""
import sys, json, subprocess
import numpy as np, cv2
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent)); import fix15
R = Path('.'); FR = R / 'tests/pogos-petros/frames'; IN = R / 'pogos-petros/gemini/in'; UP = R / 'pogos-petros/gemini/up'
REP = R / 'pogos-petros/build/report/s17'; REP.mkdir(parents=True, exist_ok=True); fix15.REP = REP
DEMO = IN / 'gemini_generated_video_cf332728.mp4'

def full_warp(mp4, frame_name, idx=None):
    vf, fps = fix15.vframes(mp4); B = np.array(Image.open(FR / frame_name).convert('RGB'))
    tm, cc, W = fix15.locate(vf[0], B)
    ws = [fix15.warp_to(f, W, B.shape[1], B.shape[0]) for f in (vf if idx is None else [vf[i] for i in idx])]
    return B, ws, fps, (tm, cc, W), len(vf)

def cmd_ruins():
    B, ws, fps, (tm, cc, W), n = full_warp(DEMO, 'pogos_b.webp', idx=None)
    # руины стоят 9–10 с: берём последний кадр ролика
    last = ws[-1].astype(np.float32); gn = np.clip(np.median(B.reshape(-1, 3), 0) / np.maximum(np.median(ws[0].reshape(-1, 3).astype(np.float32), 0), 1), 0.85, 1.15)
    out = np.clip(last * gn, 0, 255).astype(np.uint8)
    Image.fromarray(out).save(UP / 'b_ruins17.png')
    print(json.dumps({'tm': round(tm, 3), 'ecc': round(cc, 3), 'frames': n, 'fps': fps, 'gain': gn.round(3).tolist(), 'out': str(UP / 'b_ruins17.png'), 'size': list(out.shape)}))

def cmd_crop(frame_name, x0, y0, w, h, s):
    B = np.array(Image.open(FR / frame_name).convert('RGB'))
    c = B[int(y0):int(y0 + h), int(x0):int(x0 + w)]
    c = cv2.resize(c, (int(w * s), int(h * s)), interpolation=cv2.INTER_CUBIC)
    p = UP / ('%s_%d_%d.png' % (Path(frame_name).stem, x0, y0)); Image.fromarray(c).save(p); print(p, c.shape)

def cmd_sunset():
    """Закат B: спящая собака (рисунок дня, маска fix12 dog_mask.npy) — в закатный рисунок Gemini в тон заката (отношение закат/день вокруг собаки).
    Исходник — source/pre17/pogos_b_sunset.webp (повтор даёт тот же результат). Без этого на «Закате» собака пропадала: закат нарисован до собаки (заход 10)."""
    import fix11 as F11
    Bf = np.array(Image.open(FR / 'pogos_b.webp').convert('RGB')).astype(np.float32)
    S = np.array(Image.open(R / 'pogos-petros/build/source/pre17/pogos_b_sunset.webp').convert('RGB')).astype(np.float32)
    A = np.load(R / 'pogos-petros/build/source/pre11/dog_mask.npy').astype(np.float32)
    ring = ((F11.gblur(A, 12) > 0.02) & (A < 0.02)).astype(np.float32)
    rs = F11.nblur(S, ring, 14); rd = F11.nblur(Bf, ring, 14)
    sd = np.clip(Bf * (rs / np.maximum(rd, 4)), 0, 255); A3 = A[..., None]
    out = S * (1 - A3) + sd * A3
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(FR / 'pogos_b_sunset.webp', 'WEBP', quality=93, method=6)
    ys, xs = np.where(A > 0.05); y0, y1, x0, x1 = ys.min() - 30, ys.max() + 30, xs.min() - 40, xs.max() + 40
    th = 200; c = [x[y0:y1, x0:x1] for x in (Bf, S, out)]; tw = int(c[0].shape[1] * th / c[0].shape[0])
    Image.fromarray(np.concatenate([cv2.resize(x.astype(np.uint8), (tw, th)) for x in c], 1)).save(REP / 'sunset_dog_check.jpg', quality=88)
    print(json.dumps({'dog_px': int((A > 0.5).sum()), 'ratio_mean': (rs[A > 0.5] / np.maximum(rd[A > 0.5], 4)).mean(0).round(3).tolist()}))

def clip_from(mp4, ref_full, rect, seg, ow=None, oh=None):
    """Кусок rect (u,v) видео Veo, совмещённого с ref_full (весь кадр 768×1365), цвет к ref (медиана) → список кадров ow×oh."""
    vf, fps = fix15.vframes(mp4); tm, cc, W = fix15.locate(vf[0], ref_full)
    if seg: vf = vf[int(seg[0] * fps):int(seg[1] * fps)]
    FH, FW = ref_full.shape[:2]; u0, v0, u1, v1 = rect
    px0, py0, px1, py1 = int(round(u0 * FW)), int(round(v0 * FH)), int(round(u1 * FW)), int(round(v1 * FH))
    ow = ow or (px1 - px0) // 2 * 2; oh = oh or (py1 - py0) // 2 * 2
    T = np.array([[(px1 - px0) / ow, 0, px0], [0, (py1 - py0) / oh, py0], [0, 0, 1]], np.float64)
    M = (np.vstack([W, [0, 0, 1]]) @ T)[:2].astype(np.float32)
    clip = [cv2.warpAffine(f, M, (ow, oh), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE) for f in vf]
    rr = cv2.resize(ref_full[py0:py1, px0:px1], (ow, oh), interpolation=cv2.INTER_AREA).astype(np.float32)
    gn = np.clip(np.median(rr.reshape(-1, 3), 0) / np.maximum(np.median(clip[0].astype(np.float32).reshape(-1, 3), 0), 1), 0.85, 1.15)
    return [np.clip(x.astype(np.float32) * gn, 0, 255).astype(np.uint8) for x in clip], fps, {'tm': round(tm, 3), 'ecc': round(cc, 3), 'gain': gn.round(3).tolist()}, (px0, py0, px1, py1, ow, oh)

def encode(loop, fps, nm, maxkb, crf0=24):
    tmp = REP / ('%s_frames' % nm); tmp.mkdir(exist_ok=True)
    for i, x in enumerate(loop): Image.fromarray(x).save(tmp / ('%04d.png' % i), compress_level=1)
    n = len(loop); out = FR / ('vid_%s.mp4' % nm)
    for crf in (crf0, crf0 + 2, crf0 + 4, crf0 + 6, crf0 + 9):
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', str(tmp / '%04d.png'), '-frames:v', str(n), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf),
                        '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-movflags', '+faststart', str(out)], check=True)
        if out.stat().st_size <= maxkb * 1024: break
    wb = FR / ('vid_%s.webm' % nm)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', str(tmp / '%04d.png'), '-frames:v', str(n), '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38',
                    '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', str(wb)], check=True)
    return crf, out.stat().st_size // 1024, wb.stat().st_size // 1024

def soft_mask(mm, e=10, dil=13, blur=6, lr=True):
    mm = cv2.morphologyEx(mm, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)); mm = cv2.dilate(mm, np.ones((dil, dil), np.uint8))
    ma = cv2.GaussianBlur(mm.astype(np.float32), (0, 0), blur); ramp = np.linspace(0, 1, e); edge = np.ones_like(ma)
    edge[:e] *= ramp[:, None]; edge[-e:] *= ramp[::-1][:, None]
    if lr: edge[:, :e] *= ramp[None]; edge[:, -e:] *= ramp[::-1][None]   # рамка во всю ширину кадра (u 0..1) — у краёв кадра без спада, иначе остаётся полоска рисунка
    return np.clip(ma * 1.4, 0, 1) * edge

def cmd_bshow(cin_mp4, rect=(0, 0.14, 1, 0.88), sky_v=0.15, demo_seg=(0, 9.5), cin_seg=(0.5, 9.6), hold=2.5, revspeed=2.5, maxkb=3000):
    """Шоу B: снос (cf332728, к кадру B) → кинотеатр (Veo из руин, к b_ruins17.png) → пауза → всё назад (быстрее в revspeed) → vid_b_show.*"""
    B = np.array(Image.open(FR / 'pogos_b.webp').convert('RGB')); Rn = np.array(Image.open(UP / 'b_ruins17.png').convert('RGB'))
    c1, fps, r1, geo = clip_from(DEMO, B, rect, demo_seg)
    c2, _, r2, _ = clip_from(cin_mp4, Rn, rect, cin_seg, geo[4], geo[5])
    fw = c1 + c2; rv = fw[::-1]; rv = [rv[min(len(rv) - 1, int(round(i * revspeed)))] for i in range(int(len(rv) / revspeed))] + [fw[0]]
    loop = fw + [fw[-1]] * int(round(hold * fps)) + rv
    px0, py0, px1, py1, ow, oh = geo
    rr = cv2.resize(B[py0:py1, px0:px1], (ow, oh), interpolation=cv2.INTER_AREA).astype(np.float32)
    st = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in fw[::2]]).std(0)
    dmax = np.max(np.stack([np.abs(x.astype(np.float32) - rr).max(-1) for x in fw[::3]]), 0)
    mm = ((st > 5) | (dmax > 22)).astype(np.uint8)
    ys = int((sky_v - rect[1]) / (rect[3] - rect[1]) * oh)
    if ys > 0: mm[:ys] = 0
    mm[int((0.86 - rect[1]) / (rect[3] - rect[1]) * oh):] = 0   # передние стенки не трогаем
    ma = soft_mask(mm, lr=not (rect[0] <= 0 and rect[2] >= 1)); Image.fromarray((ma * 255).astype(np.uint8)).save(FR / 'vid_b_show_mask.png')
    crf, kb, wkb = encode(loop, fps, 'b_show', maxkb, 25)
    idx = [0, len(c1) // 2, len(c1) - 1, len(c1) + len(c2) // 2, len(fw) - 1, len(fw) + int(hold * fps) + len(rv) // 2]
    th = 300; tw = int(ow * th / oh)
    tiles = [(rr * (1 - ma[..., None]) + loop[i].astype(np.float32) * ma[..., None]).astype(np.uint8) for i in idx] + [np.dstack([(ma * 255).astype(np.uint8)] * 3)]
    Image.fromarray(np.concatenate([cv2.resize(t, (tw, th)) for t in tiles], 1)).save(REP / 'b_show_check.jpg', quality=85)
    rep = {'demo': r1, 'cinema': r2, 'rect_px': list(geo[:4]), 'video_px': [ow, oh], 'frames': len(loop), 'sec': round(len(loop) / fps, 2), 'forward_s': round(len(fw) / fps, 2),
           'cinema_from_s': round(len(c1) / fps, 2), 'hold_end_s': round((len(fw) + int(round(hold * fps))) / fps, 2), 'crf': crf, 'mp4_kb': kb, 'webm_kb': wkb, 'mask_cover': round(float((ma > 0.5).mean()), 3)}
    json.dump(rep, open(REP / 'b_show.json', 'w'), indent=1); print(json.dumps(rep))

def cmd_dog(mp4, x0, y0, w, h, rect, nm, xfade=1.0, scale=2.0, seg=None, maxkb=450):
    """Собака B: видео Veo из ТОЧНОЙ вырезки кадра (x0 y0 w h, файл через file_upload) → кусок rect ×scale, петля (кроссфейд конца с началом —
    ролик кончается той же позой, что в начале), маска «движется или отличается от рисунка» (миска утра — тоже) → vid_<nm>.mp4/.webm/_mask.png"""
    vf, fps = fix15.vframes(mp4); B, ref, box = fix15.frame_crop('pogos_b.webp', x0, y0, w, h)
    tm, cc, W = fix15.locate(vf[0], ref)
    if seg: vf = vf[int(seg[0] * fps):int(seg[1] * fps)]
    FW, FH = B.shape[1], B.shape[0]; u0, v0, u1, v1 = rect
    px0, py0, px1, py1 = int(round(u0 * FW)), int(round(v0 * FH)), int(round(u1 * FW)), int(round(v1 * FH))
    ow, oh = int(round((px1 - px0) * scale / 2)) * 2, int(round((py1 - py0) * scale / 2)) * 2
    T = np.array([[(px1 - px0) / ow, 0, px0 - x0], [0, (py1 - py0) / oh, py0 - y0], [0, 0, 1]], np.float64)
    M = (np.vstack([W, [0, 0, 1]]) @ T)[:2].astype(np.float32)
    clip = [cv2.warpAffine(f, M, (ow, oh), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE) for f in vf]
    rr = cv2.resize(B[py0:py1, px0:px1], (ow, oh), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    # цвет — к рисунку по «фону» (там, где первый кадр совпал с рисунком)
    c0 = clip[0].astype(np.float32); bgm = np.abs(c0 - rr).max(-1) < 30
    gn = np.clip(np.array([rr[..., k][bgm].mean() / max(c0[..., k][bgm].mean(), 1) for k in range(3)]), 0.85, 1.15)
    clip = [np.clip(x.astype(np.float32) * gn, 0, 255).astype(np.uint8) for x in clip]
    n = len(clip); k = int(round(xfade * fps))
    loop = clip[k:n - k] + [(clip[n - k + j].astype(np.float32) * (1 - (j + 0.5) / k) + clip[j].astype(np.float32) * ((j + 0.5) / k)).astype(np.uint8) for j in range(k)]
    st = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in loop[::2]]).std(0)
    dmax = np.max(np.stack([np.abs(x.astype(np.float32) - rr).max(-1) for x in loop[::3]]), 0)
    mm = ((st > 4) | (dmax > 26)).astype(np.uint8)
    ma = soft_mask(mm, e=10, dil=15, blur=7); Image.fromarray((ma * 255).astype(np.uint8)).save(FR / ('vid_%s_mask.png' % nm))
    crf, kb, wkb = encode(loop, fps, nm, maxkb, 23)
    seam = float(np.abs(loop[-1].astype(np.float32) - loop[0].astype(np.float32)).mean())
    idx = np.linspace(0, len(loop) - 1, 6).astype(int); th = 200; tw = int(ow * th / oh)
    tiles = [rr.astype(np.uint8)] + [(rr * (1 - ma[..., None]) + loop[i].astype(np.float32) * ma[..., None]).astype(np.uint8) for i in idx] + [np.dstack([(ma * 255).astype(np.uint8)] * 3)]
    Image.fromarray(np.concatenate([cv2.resize(t, (tw, th)) for t in tiles], 1)).save(REP / ('%s_check.jpg' % nm), quality=85)
    rep = {'tm': round(tm, 3), 'ecc': round(cc, 3), 'gain': gn.round(3).tolist(), 'rect_px': [px0, py0, px1, py1], 'video_px': [ow, oh], 'frames': len(loop), 'sec': round(len(loop) / fps, 2),
           'seam_mean_abs': round(seam, 2), 'crf': crf, 'mp4_kb': kb, 'webm_kb': wkb, 'mask_cover': round(float((ma > 0.5).mean()), 3)}
    json.dump(rep, open(REP / ('%s.json' % nm), 'w'), indent=1); print(json.dumps(rep))

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'dog': cmd_dog(a[1], *map(float, a[2:6]), list(map(float, a[6:10])), a[10], seg=[float(a[a.index('--seg') + 1]), float(a[a.index('--seg') + 2])] if '--seg' in a else None)
    if a[0] == 'bshow': cmd_bshow(a[1])
    if a[0] == 'ruins': cmd_ruins()
    elif a[0] == 'sunset': cmd_sunset()
    elif a[0] == 'crop': cmd_crop(a[1], *map(float, a[2:7]))
