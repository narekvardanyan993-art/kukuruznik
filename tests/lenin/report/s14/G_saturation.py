#!/usr/bin/env python3
"""s14: насыщенность G по снимкам sat.mjs (G_nocine/G_video/G_shifted_cal/G_shifted_nocal.png в DIR) → G_saturation.md + лист.
  python3 G_saturation.py DIR
S = насыщенность HSV (не зависит от общего затемнения тенями облаков). Сравнение «по неподвижному»: внутри маски видео, без пикселей,
где в этот момент движется вода/листва (отличие видео от ?cine=0 > 10) — именно там сдвиг цвета видео делал G бледным."""
import sys
from pathlib import Path
import numpy as np, cv2
from PIL import Image
D = Path(sys.argv[1]); OUT = Path(__file__).resolve().parent
m = np.asarray(Image.open(OUT.parents[1] / 'frames/lenin_6_motion_mask.png').convert('LA'))[..., 1].astype(np.float32) / 255
s = max(390 / 768, 844 / 1365) * 1.05; W2, H2 = int(round(768 * s)), int(round(1365 * s)); ox, oy = (W2 - 390) // 2, (H2 - 844) // 2
ms = cv2.resize(m, (W2, H2))[oy:oy + 844, ox:ox + 390] > 0.3
K = ['nocine', 'video', 'shifted_cal', 'shifted_nocal']
im = {k: np.asarray(Image.open(D / f'G_{k}.png').convert('RGB')) for k in K}
moving = np.abs(im['video'].astype(int) - im['nocine'].astype(int)).max(-1) > 10
st = ms & ~moving
def S(a, sel): h = cv2.cvtColor(a, cv2.COLOR_RGB2HSV).astype(np.float32); ok = sel & (h[..., 2] > 30); return h[..., 1][ok].mean(), h[..., 2][ok].mean()
names = {'nocine': '?cine=0 (только рисунок)', 'video': 'видео e1.18 (отличие от рисунка + калибровка)', 'shifted_cal': 'видео со сдвигом цвета «как на iPhone» + калибровка',
         'shifted_nocal': 'видео со сдвигом цвета, полоска стёрта (без калибровки)'}
b_all, b_st = S(im['nocine'], np.ones(ms.shape, bool))[0], S(im['nocine'], st)[0]
L = ['# s14 — насыщенность G: видео / ?cine=0 / видео со сдвигом цвета', '',
     'Облачный Chrome 390×844, интерфейс скрыт, кадр G, видео заморожено на 4 с. «Сдвиг как на iPhone» — ролик G, перекодированный с gamma 1,15,',
     'насыщенностью ×0,75 и +3 % яркости (весь кадр ролика вместе с калибровочной полоской). S — насыщенность HSV. «Неподвижное в маске» — пиксели',
     'маски видео, где вода/листва в этот момент не движется (%d px из %d) — там раньше и ложился сдвиг цвета ролика.' % (st.sum(), ms.sum()), '',
     '| вариант | S, весь кадр | Δ к ?cine=0 | S, неподвижное в маске | Δ к ?cine=0 |', '|---|---|---|---|---|']
for k in K:
    a, st_ = S(im[k], np.ones(ms.shape, bool))[0], S(im[k], st)[0]
    L.append('| %s | %.1f | %+.1f %% | %.1f | %+.1f %% |' % (names[k], a, (a / b_all - 1) * 100, st_, (st_ / b_st - 1) * 100))
L += ['', 'Ролики со сдвигом подменены через перехват запроса и не перематываются — стоят на начале (кадр = рисунок), то есть вся маска «неподвижна»: ровно тот случай, где сдвиг декодера раньше красил площадь.', 'Цель — разница ≤ 3 %. Без калибровки сдвиг декодера виден в маске; с калибровкой — выправлен. На самом iPhone — только глазами (G и G с ?cine=0).']
(OUT / 'G_saturation.md').write_text('\n'.join(L) + '\n', encoding='utf-8'); print('\n'.join(L))
Image.fromarray(np.hstack([im[k] for k in K])).save(OUT / 'G_video_vs_nocine_vs_shifted.jpg', quality=85)
