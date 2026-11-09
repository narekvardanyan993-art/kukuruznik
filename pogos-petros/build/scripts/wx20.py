#!/usr/bin/env python3
"""Заход 20 (e1.56): живые версии непогоды — видео Veo вместо картинок show_wx_*.png.
wx20.py <кадр a|b|f> <in.png> <clip.mp4> <u0,v0,u1,v1> <wx-картинка> <имя>  → tests/pogos-petros/frames/vid_<имя>.mp4/.webm/_mask.png
in.png — ТОЧНО та картинка, что ушла в Veo (окно кадра с вклеенной погодной правкой). Окно ищется в кадре (кадр + wx-картинка в rect),
видео совмещается с in.png (масштаб + ECC), кусок rect ×2, петля (кроссфейд конца с началом), маска «движется или отличается от погодной картинки».
Повторный запуск даёт тот же результат."""
import sys, json
import numpy as np, cv2
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent)); import fix15, fix17, fix18
R = Path('.'); FR = R / 'tests/pogos-petros/frames'
REP = R / 'pogos-petros/build/report/s20'; REP.mkdir(parents=True, exist_ok=True); fix17.REP = REP; fix15.REP = REP; fix18.REP = REP

def main(fr, inp, mp4, rect, wxpng, nm, scale=2.0, xfade=1.0):
    B = Image.open(FR / ('pogos_%s.webp' % fr)).convert('RGB'); FW, FH = B.size
    u0, v0, u1, v1 = rect; px0, py0, px1, py1 = int(round(u0 * FW)), int(round(v0 * FH)), int(round(u1 * FW)), int(round(v1 * FH))
    w = Image.open(FR / wxpng).convert('RGBA').resize((px1 - px0, py1 - py0), Image.LANCZOS); C = B.copy(); C.paste(w, (px0, py0), w); comp = np.array(C)
    I = np.array(Image.open(inp).convert('RGB')); ih, iw = I.shape[:2]
    best = (-2, None); g = cv2.cvtColor(comp, cv2.COLOR_RGB2GRAY)
    for sc in np.linspace(0.25, 1.0, 76):   # пикселей кадра на пиксель in.png
        tw, th = int(iw * sc), int(ih * sc)
        if tw > FW or th > FH: continue
        t = cv2.cvtColor(cv2.resize(I, (tw, th), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
        r = cv2.matchTemplate(g, t, cv2.TM_CCOEFF_NORMED); _, mv, _, ml = cv2.minMaxLoc(r)
        if mv > best[0]: best = (mv, (sc, ml[0], ml[1]))
    tmw, (sc, wx0, wy0) = best
    # rect ∩ окно
    ix0, iy0, ix1, iy1 = max(px0, wx0 + 2), max(py0, wy0 + 2), min(px1, wx0 + int(iw * sc) - 2), min(py1, wy0 + int(ih * sc) - 2)
    vf, fps = fix15.vframes(mp4); tm, cc, W = fix15.locate(vf[0], I)
    ow, oh = int(round((ix1 - ix0) * scale / 2)) * 2, int(round((iy1 - iy0) * scale / 2)) * 2
    T = np.array([[(ix1 - ix0) / ow / sc, 0, (ix0 - wx0) / sc], [0, (iy1 - iy0) / oh / sc, (iy0 - wy0) / sc], [0, 0, 1]], np.float64)
    M = (np.vstack([W, [0, 0, 1]]) @ T)[:2].astype(np.float32)
    clip = [cv2.warpAffine(f, M, (ow, oh), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE) for f in vf]
    rr = cv2.resize(comp[iy0:iy1, ix0:ix1], (ow, oh), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    c0 = clip[0].astype(np.float32); bgm = np.abs(c0 - rr).max(-1) < 30
    gn = np.clip(np.array([rr[..., k][bgm].mean() / max(c0[..., k][bgm].mean(), 1) for k in range(3)]), 0.85, 1.15) if bgm.any() else np.ones(3)
    clip = [np.clip(x.astype(np.float32) * gn, 0, 255).astype(np.uint8) for x in clip]
    n = len(clip); k = int(round(xfade * fps))
    loop = clip[k:n - k] + [(clip[n - k + j].astype(np.float32) * (1 - (j + 0.5) / k) + clip[j].astype(np.float32) * ((j + 0.5) / k)).astype(np.uint8) for j in range(k)]
    rect2 = [round(ix0 / FW, 5), round(iy0 / FH, 5), round(ix1 / FW, 5), round(iy1 / FH, 5)]
    rep = {'src': str(mp4), 'in': str(inp), 'win_tm': round(tmw, 3), 'win': [wx0, wy0, round(sc, 3)], 'tm': round(tm, 3), 'ecc': round(cc, 3), 'gain': gn.round(3).tolist(),
           'rect_px': [ix0, iy0, ix1, iy1], 'rect_uv': rect2, 'video_px': [ow, oh], 'bg_match': round(float(bgm.mean()), 3)}
    fix18.finish(loop, fps, rr, rep, nm, maxkb=600)

if __name__ == '__main__':
    a = sys.argv[1:]; main(a[0], a[1], a[2], list(map(float, a[3].split(','))), a[4], a[5])
