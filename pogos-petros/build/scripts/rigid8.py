#!/usr/bin/env python3
"""НЕ ИСПОЛЬЗУЕТСЯ (заход 8, решение Нарека: E/F просто почти плоские — frames[].tiltK 0,2, карты глубины прежние). Оставлен как рецепт.
Заход 8: «резина» при повороте E и F. Причина: гладкая карта глубины (Depth Anything) даёт вертикальным предметам разную глубину
сверху и снизу — при наклоне свечи на столе (E) и люди на скамье (F) наклоняются/гнутся, пол «тянется».
Здесь: у предметов в карте глубины кадра — ОДНА глубина на предмет (жёсткое тело): стоящие (люди, скамья) — глубина пола у их основания,
стол со свечами и чаша фонтана — медиана своей глубины. Остальное (пол, стены) режет на ступени движок (frames[].depthSteps, e1.43),
сила наклона кадра — frames[].tiltK. Исходники — report/s8/pre/. python3 pogos-petros/build/scripts/rigid8.py  (из корня репо)"""
import shutil, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage as ndi
F = Path('pogos-petros/build/frames'); T = Path('tests/pogos-petros/frames'); P = Path('pogos-petros/build/report/s8/pre'); P.mkdir(parents=True, exist_ok=True)
SPEC = {   # предметы: рамка [u0, v0, u1, v1]; предмет = где кадр заметно отличается от подложки без предмета (альфа слоя здания здесь грубая —
           # захватывает пол вокруг); как брать глубину: base — у основания (стоит на полу), median — медиана предмета
    'pogos_e': [((0.58, 0.74, 1.0, 1.0), 'median')],          # стол со свечами
    'pogos_f': [((0.08, 0.755, 0.45, 0.92), 'base')],          # пара на скамье (фонтан — и так почти ровный по глубине)
}
for name, objs in SPEC.items():
    n = name + '_depth.webp'
    if not (P/n).exists(): shutil.copyfile(F/n, P/n)
    d = np.asarray(Image.open(P/n).convert('L')).astype(np.float32)
    a = np.asarray(Image.open(F/(name + '_building.webp')).convert('RGBA'))[..., 3] > 128
    H, W = d.shape; out = d.copy()
    for (u0, v0, u1, v1), how in objs:
        box = np.zeros_like(a); box[int(v0*H):int(v1*H), int(u0*W):int(u1*W)] = True
        fr = np.asarray(Image.open(F/(name + '.webp')).convert('RGB')).astype(np.float32)
        bgp = np.asarray(Image.open((P if (P/(name + '_bg.webp')).exists() else F)/(name + '_bg.webp')).convert('RGB')).astype(np.float32)
        diff = ndi.gaussian_filter(np.abs(fr - bgp).sum(-1), 1.5)
        m = ndi.binary_fill_holes(ndi.binary_closing((diff > 45) & box, iterations=3)) & box
        m = ndi.binary_opening(m, iterations=1)
        lab, k = ndi.label(m)
        if k > 1:   # только самый большой кусок (сам предмет)
            sz = ndi.sum(m, lab, range(1, k + 1)); lab = np.where(lab == 1 + int(np.argmax(sz)), 1, 0); k = 1
        for j in range(1, k + 1):
            mj = lab == j
            if mj.sum() < 150: continue
            ys = np.nonzero(mj.any(1))[0]
            if how == 'base':
                yb = ys.max(); band = mj & (np.arange(H)[:, None] >= yb - max(3, int(0.06*(yb - ys.min()))))
                val = float(np.median(d[band]))
            else:
                val = float(np.median(d[mj]))
            mm = ndi.binary_dilation(mj, iterations=2)
            out[mm] = val
            print(name, 'предмет', j, 'px', int(mj.sum()), how, round(val, 1))
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert('RGB').save(F/n, quality=92); shutil.copyfile(F/n, T/n)
