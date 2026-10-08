#!/usr/bin/env python3
"""Ленин, круг 2–3 (07.10.2026): акварель насыщеннее во всех кадрах — слои цвет / подложка / вырезка (tests/lenin/frames/).

Lab: цветность × K там, где цвет уже есть (C > 10), плавно до ×1 у серого (C < 3) — карандаш, штриховка и белая бумага
не трогаются; яркость L не меняется (у G — чуть темнее бумага, gamma 1.05: кадр был самым бледным, L 85 против 72–77).
Порядок сборки кадров: p4_saturate.py → p5_water_g.py → p6_static_props.py → tools/night_from_gemini.py (s4). Запускать от слоёв станка: слои берутся из tests/lenin/source/<кадр>/layers/ (для lenin_1 — из git: frames до 07.10),
так что повторный запуск не усиливает дважды.
"""
import io, subprocess, sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image
S = Path(__file__).resolve().parent; F = S.parent / 'frames'; ROOT = S.parents[2]
K = {'lenin_1': (1.7, 1.03), 'lenin_2': (1.65, 1.03), 'lenin_3': (1.7, 1.03), 'lenin_4': (1.6, 1.03), 'lenin_6': (1.75, 1.12)}   # s7 (09.10): ещё насыщеннее и плотнее (G был бледным); круг 3: 1,45–1,6
BASE_COMMIT = '43992c1'   # кадры до круга 2
def src(fid, suf):
    p = S / fid / 'layers' / (fid + suf + '.webp')
    if fid != 'lenin_1' and p.is_file() and suf != '_depth':
        return Image.open(p)
    raw = subprocess.run(['git', '-C', str(ROOT), 'show', '%s:tests/lenin/frames/%s%s.webp' % (BASE_COMMIT, fid, suf)], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(raw))
def boost(rgb, k, gamma):
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    a, b = lab[..., 1] - 128, lab[..., 2] - 128; C = np.hypot(a, b)
    w = np.clip((C - 3) / 7, 0, 1); w = w * w * (3 - 2 * w); m = 1 + (k - 1) * w
    lab[..., 1] = np.clip(128 + a * m, 0, 255); lab[..., 2] = np.clip(128 + b * m, 0, 255)
    if gamma != 1.0:
        L = lab[..., 0] / 255; lab[..., 0] = np.clip(255 * L ** gamma, 0, 255)
    return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2RGB)
for fid, (k, g) in K.items():
    for suf in ('', '_bg', '_building'):
        im = src(fid, suf)
        if suf == '_building':
            a = np.asarray(im.convert('RGBA')); rgb = boost(np.ascontiguousarray(a[..., :3]), k, g)
            Image.fromarray(np.dstack([rgb, a[..., 3]]), 'RGBA').save(F / (fid + suf + '.webp'), quality=90, method=6)
        else:
            Image.fromarray(boost(np.asarray(im.convert('RGB')), k, g)).save(F / (fid + suf + '.webp'), quality=90, method=6)
    print(fid, 'chroma x%.2f gamma %.2f' % (k, g))
