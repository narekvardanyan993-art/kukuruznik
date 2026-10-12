#!/usr/bin/env python3
"""s14: таблица «живости» 3×3 по снимкам life_grid.mjs. Ячейка «живая», если за 15 с в ней заметно (≥ 4 уровня из 255) меняется
≥ 0,3 % пикселей. Небо без облаков — исключение (по заданию): ячейка, где ≥ 70 % пикселей — небо (карта _env кадра), помечается «небо».
  python3 life_grid.py <dir со снимками> <out.md> [<out.jpg>]"""
import sys, glob, json
from pathlib import Path
import numpy as np, cv2
from PIL import Image
d, outmd = Path(sys.argv[1]), Path(sys.argv[2]); outjpg = sys.argv[3] if len(sys.argv) > 3 else None
FD = Path(__file__).resolve().parents[2] / 'frames'
NAMES = dict(zip('ABCDG', ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']))
rows, vis = [], []
for mode in ('day', 'night'):
    for n in 'ABCDG':
        fs = sorted(glob.glob(str(d / f'{mode}_{n}_*.png')))
        if not fs: continue
        st = np.stack([np.asarray(Image.open(f).convert('L')).astype(np.int16) for f in fs])
        rng = st.max(0) - st.min(0)
        H, W = rng.shape
        # небо: карта окружения кадра (r = небо), в координатах экрана по cover-подгонке
        env = np.asarray(Image.open(FD / (NAMES[n] + '_env.webp')).convert('RGBA'))[..., 0]
        eh, ew = env.shape; sc = max(W / ew, H / eh); cw, ch = int(ew * sc), int(eh * sc)
        envs = cv2.resize(env, (cw, ch))[(ch - H) // 2:(ch - H) // 2 + H, (cw - W) // 2:(cw - W) // 2 + W] > 127
        cells = []
        for i in range(3):
            for j in range(3):
                sl = (slice(i * H // 3, (i + 1) * H // 3), slice(j * W // 3, (j + 1) * W // 3))
                share = float((rng[sl] >= 4).mean() * 100); sky = float(envs[sl].mean())
                cells.append((share, sky))
        rows.append((mode, n, cells))
        if outjpg:
            hm = np.clip(rng * 12, 0, 255).astype(np.uint8)
            base = np.asarray(Image.open(fs[0]).convert('RGB')).astype(np.float32) * 0.55
            base[..., 0] += hm * 0.45; base[..., 1] += hm * 0.2
            im = np.clip(base, 0, 255).astype(np.uint8)
            for k in (1, 2): im[k * H // 3, :] = 255; im[:, k * W // 3] = 255
            for i in range(3):
                for j in range(3):
                    s, sk = cells[i * 3 + j]
                    cv2.putText(im, '%.1f' % s, (j * W // 3 + 8, i * H // 3 + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            cv2.putText(im, '%s %s' % (n, mode), (8, H - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2)
            vis.append(im)
L = ['# s14 — живость 3×3 (за 15 с игрового времени)', '',
     'Число в ячейке — % пикселей, что заметно меняются (≥ 4/255) за 15 с; «живая» ≥ 0,3 %. ☁ — ячейка почти целиком небо (≥ 70 %), по заданию может стоять.', '',
     '| кадр | режим | верх: лево · центр · право | середина | низ | мёртвых (не небо) |', '|---|---|---|---|---|---|']
dead_total = 0
for mode, n, cells in rows:
    def c(k):
        s, sk = cells[k]; mark = '✓' if s >= 0.3 else ('☁' if sk >= 0.7 else '✗')
        return '%s %.1f' % (mark, s)
    dead = sum(1 for s, sk in cells if s < 0.3 and sk < 0.7); dead_total += dead
    L.append('| %s | %s | %s | %s | %s | %d |' % (n, 'день' if mode == 'day' else 'ночь', ' · '.join(c(k) for k in (0, 1, 2)), ' · '.join(c(k) for k in (3, 4, 5)), ' · '.join(c(k) for k in (6, 7, 8)), dead))
L += ['', 'Мёртвых ячеек (не небо) всего: %d' % dead_total]
outmd.write_text('\n'.join(L) + '\n', encoding='utf-8'); print('\n'.join(L))
if outjpg and vis:
    half = len(vis) // 2 if len(vis) == 10 else len(vis)
    rws = [np.hstack(vis[:half])] + ([np.hstack(vis[half:])] if half < len(vis) else [])
    Image.fromarray(np.vstack(rws)).save(outjpg, quality=82)
