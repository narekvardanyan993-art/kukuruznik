#!/usr/bin/env python3
"""Заход 18 (e1.53): собака B всегда живая + тап.
tap [mp4 s0 s1 s2 s3] — ролик реакции на тап (vid_b_dog_tap.*): кусок дневного Veo c3fa979d (просыпается, поднимает голову, смотрит в камеру)
                        + кусок «наклоняет голову, ложится», склейка кроссфейдом 0,3 с; начинается и кончается позой сна. Запасной путь, пока нет Veo «c».
                        Свой Veo-ролик: fix18.py tap <mp4> 0 99 (весь ролик) — заменит файл.
clip <mp4> <имя>       — новый ролик собаки из точной вырезки 186 880 480 270 (Veo a/b) → vid_b_dog_<имя>.* (как fix17 dog, петля)
tone                   — карты тона ночь/закат для видео-собаки (vid_b_dog_night_tone.png, vid_b_dog_sunset_tone.png): отношение рисунка ночи/заката к дню,
                        размытое; движок умножает пиксель видео на карту и пишет его и в ночную/закатную картинку — собака живая и ночью, и на «Закате».
Повторный запуск даёт тот же результат."""
import sys, json
import numpy as np, cv2
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent)); import fix15, fix17
R = Path('.'); FR = R / 'tests/pogos-petros/frames'; IN = R / 'pogos-petros/gemini/in'
REP = R / 'pogos-petros/build/report/s18'; REP.mkdir(parents=True, exist_ok=True); fix17.REP = REP; fix15.REP = REP
X0, Y0, CW, CH = 186, 880, 480, 270; RECT = [0.40, 0.68, 0.70, 0.84]
TONE_RECT = [0.40, 0.66, 0.72, 0.84]; TONE_SCALE = 160.0

def dog_clip(mp4, segs, xf=0.3, scale=2.0):
    vf, fps = fix15.vframes(mp4); B, ref, box = fix15.frame_crop('pogos_b.webp', X0, Y0, CW, CH)
    tm, cc, W = fix15.locate(vf[0], ref)
    FW, FH = B.shape[1], B.shape[0]; u0, v0, u1, v1 = RECT
    px0, py0, px1, py1 = int(round(u0 * FW)), int(round(v0 * FH)), int(round(u1 * FW)), int(round(v1 * FH))
    ow, oh = int(round((px1 - px0) * scale / 2)) * 2, int(round((py1 - py0) * scale / 2)) * 2
    T = np.array([[(px1 - px0) / ow, 0, px0 - X0], [0, (py1 - py0) / oh, py0 - Y0], [0, 0, 1]], np.float64)
    M = (np.vstack([W, [0, 0, 1]]) @ T)[:2].astype(np.float32)
    clip = [cv2.warpAffine(f, M, (ow, oh), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE) for f in vf]
    rr = cv2.resize(B[py0:py1, px0:px1], (ow, oh), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    c0 = clip[0].astype(np.float32); bgm = np.abs(c0 - rr).max(-1) < 30
    gn = np.clip(np.array([rr[..., k][bgm].mean() / max(c0[..., k][bgm].mean(), 1) for k in range(3)]), 0.85, 1.15)
    clip = [np.clip(x.astype(np.float32) * gn, 0, 255).astype(np.uint8) for x in clip]
    parts = [clip[int(a * fps):min(len(clip), int(b * fps))] for a, b in segs]
    k = max(1, int(round(xf * fps))); out = parts[0]
    for p in parts[1:]:
        mix = [(out[len(out) - k + j].astype(np.float32) * (1 - (j + 0.5) / k) + p[j].astype(np.float32) * ((j + 0.5) / k)).astype(np.uint8) for j in range(k)]
        out = out[:len(out) - k] + mix + p[k:]
    return out, fps, rr, {'tm': round(tm, 3), 'ecc': round(cc, 3), 'gain': gn.round(3).tolist(), 'rect_px': [px0, py0, px1, py1], 'video_px': [ow, oh]}

def finish(loop, fps, rr, rep, nm, maxkb=450):
    st = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in loop[::2]]).std(0)
    dmax = np.max(np.stack([np.abs(x.astype(np.float32) - rr).max(-1) for x in loop[::3]]), 0)
    mm = ((st > 4) | (dmax > 26)).astype(np.uint8)
    ma = fix17.soft_mask(mm, e=10, dil=15, blur=7); Image.fromarray((ma * 255).astype(np.uint8)).save(FR / ('vid_%s_mask.png' % nm))
    crf, kb, wkb = fix17.encode(loop, fps, nm, maxkb, 23)
    ow, oh = rep['video_px']; idx = np.linspace(0, len(loop) - 1, 7).astype(int); th = 200; tw = int(ow * th / oh)
    tiles = [rr.astype(np.uint8)] + [(rr * (1 - ma[..., None]) + loop[i].astype(np.float32) * ma[..., None]).astype(np.uint8) for i in idx] + [np.dstack([(ma * 255).astype(np.uint8)] * 3)]
    Image.fromarray(np.concatenate([cv2.resize(t, (tw, th)) for t in tiles], 1)).save(REP / ('%s_check.jpg' % nm), quality=85)
    ys, xs = np.where(ma > 0.5); px0, py0, px1, py1 = rep['rect_px']; FW, FH = 768, 1365
    hit = [round((px0 + xs.min() / ow * (px1 - px0)) / FW, 4), round((py0 + ys.min() / oh * (py1 - py0)) / FH, 4),
           round((px0 + xs.max() / ow * (px1 - px0)) / FW, 4), round((py0 + ys.max() / oh * (py1 - py0)) / FH, 4)]
    rep.update({'frames': len(loop), 'sec': round(len(loop) / fps, 2), 'seam_start_end': round(float(np.abs(loop[-1].astype(np.float32) - loop[0].astype(np.float32)).mean()), 2),
                'crf': crf, 'mp4_kb': kb, 'webm_kb': wkb, 'mask_cover': round(float((ma > 0.5).mean()), 3), 'hit_uv': hit})
    json.dump(rep, open(REP / ('%s.json' % nm), 'w'), indent=1); print(json.dumps(rep))

def cmd_tap(mp4=None, segs=((1.2, 3.6), (6.5, 9.9))):
    loop, fps, rr, rep = dog_clip(mp4 or IN / 'gemini_generated_video_c3fa979d.mp4', segs)
    rep['src'] = str(mp4 or 'c3fa979d'); rep['segs'] = [list(s) for s in segs]; finish(loop, fps, rr, rep, 'b_dog_tap')

def cmd_clip(mp4, nm, xfade=1.0):
    loop, fps, rr, rep = dog_clip(mp4, [(0, 99)])
    n = len(loop); k = int(round(xfade * fps))
    loop = loop[k:n - k] + [(loop[n - k + j].astype(np.float32) * (1 - (j + 0.5) / k) + loop[j].astype(np.float32) * ((j + 0.5) / k)).astype(np.uint8) for j in range(k)]
    rep['src'] = str(mp4); finish(loop, fps, rr, rep, 'b_dog_' + nm)

def cmd_tone():
    D = np.array(Image.open(FR / 'pogos_b.webp').convert('RGB')).astype(np.float32); H, W = D.shape[:2]
    u0, v0, u1, v1 = TONE_RECT; x0, y0, x1, y1 = int(np.floor(u0 * W)), int(np.floor(v0 * H)), int(np.ceil(u1 * W)), int(np.ceil(v1 * H))
    rep = {'rect': TONE_RECT, 'box_px': [x0, y0, x1, y1], 'scale': TONE_SCALE}
    Bd = cv2.GaussianBlur(D, (0, 0), 9)
    for kind in ('night', 'sunset'):
        N = np.array(Image.open(FR / ('pogos_b_%s.webp' % kind)).convert('RGB')).astype(np.float32)
        r = cv2.GaussianBlur(N, (0, 0), 9) / np.maximum(Bd, 6)
        r = np.clip(r, 0, 255 / TONE_SCALE)[y0:y1, x0:x1]
        Image.fromarray(np.clip(np.round(r * TONE_SCALE), 0, 255).astype(np.uint8)).save(FR / ('vid_b_dog_%s_tone.png' % kind), optimize=True)
        # проверка: день × карта против самого рисунка ночи/заката (вне собаки должно совпасть)
        sim = np.clip(D[y0:y1, x0:x1] * (np.round(r * TONE_SCALE) / TONE_SCALE), 0, 255); real = N[y0:y1, x0:x1]
        rep[kind] = {'ratio_mean': r.reshape(-1, 3).mean(0).round(3).tolist(), 'abs_err_mean': round(float(np.abs(sim - real).mean()), 2)}
        th = 260; tw = int((x1 - x0) * th / (y1 - y0))
        Image.fromarray(np.concatenate([cv2.resize(x.astype(np.uint8), (tw, th)) for x in (D[y0:y1, x0:x1], real, sim)], 1)).save(REP / ('tone_%s_check.jpg' % kind), quality=88)
    json.dump(rep, open(REP / 'tone.json', 'w'), indent=1); print(json.dumps(rep))

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'tap':
        if len(a) > 1: cmd_tap(a[1], segs=[(float(a[i]), float(a[i + 1])) for i in range(2, len(a) - 1, 2)])
        else: cmd_tap()
    elif a[0] == 'clip': cmd_clip(a[1], a[2])
    elif a[0] == 'tone': cmd_tone()

def cmd_hit():
    """Область тапа — там, где собака двигается во ВСЕХ её роликах (σ яркости по времени > 10), рамкой + 8 px кадра. → report/s18/hit.json"""
    acts = {'b_dog': [0.43, 0.72, 0.68, 0.82], 'b_dog_am': RECT, 'b_dog_day': RECT, 'b_dog_tap': RECT}; FW, FH = 768, 1365; bb = [1, 1, 0, 0]; per = {}
    for nm, (u0, v0, u1, v1) in acts.items():
        vf, fps = fix15.vframes(FR / ('vid_%s.mp4' % nm)); g = np.stack([cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32) for x in vf[::3]])
        st = cv2.GaussianBlur(g.std(0), (0, 0), 3); m = (st > 10).astype(np.uint8)
        n, lab, sts, _ = cv2.connectedComponentsWithStats(m); k = 1 + int(np.argmax(sts[1:, 4])) if n > 1 else 0
        ys, xs = np.where(lab == k); h, w = g.shape[1:]
        b = [u0 + xs.min() / w * (u1 - u0), v0 + ys.min() / h * (v1 - v0), u0 + xs.max() / w * (u1 - u0), v0 + ys.max() / h * (v1 - v0)]
        per[nm] = [round(x, 4) for x in b]; bb = [min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3])]
    pad = [8 / FW, 8 / FH]; hit = [round(bb[0] - pad[0], 4), round(bb[1] - pad[1], 4), round(bb[2] + pad[0], 4), round(bb[3] + pad[1], 4)]
    rep = {'per_clip': per, 'hit': hit}; json.dump(rep, open(REP / 'hit.json', 'w'), indent=1); print(json.dumps(rep))

if __name__ == '__main__' and sys.argv[1] == 'hit': cmd_hit()
