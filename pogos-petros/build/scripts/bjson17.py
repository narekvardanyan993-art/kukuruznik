#!/usr/bin/env python3
"""Заход 17 (e1.52): building.json Погос-Петроса. Повторный запуск даёт тот же файл.
- C фаэтон: showVideo в слое здания с keep — отличие видео поверх здания (лошадь и фаэтон видны целиком).
- B шоу: снос → руины → кинотеатр «Москва» → пауза → всё назад (fix17.py bshow, report/s17/b_show.json).
- B собака по часам зрителя: утро 5–11 (потягивается, ест из миски), день 11–19 (сидит, смотрит, виляет), вечер/ночь 19–5 (спит).
- D надпись: одна картинка на слой, гомография по 4 углам поля над дверью, пишется штрихами (insc17.py, report/s17/insc17.json); без углей и мерцания.
- D инфо-точка «repairs» (люнет) — с надписи в сторону, к правому краю люнета."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json'); FR = P.parent / 'frames'; RP = Path('pogos-petros/build/report/s17')
b = json.loads(P.read_text(encoding='utf-8')); fr = {f['name']: f for f in b['frames']}
FH = 1365
# C
sv = fr['pogos_c']['showVideo']; sv['layer'] = 'bld'; sv['keep'] = True
sv['note'] = 'фаэтон с лошадью проезжает по улице от дальнего плана к ближнему и уходит за правый нижний угол — видео Veo; e1.52: в слое здания (keep) — пиксели, отличные от рисунка, поверх здания, фаэтон виден целиком'
# B show
J = json.loads((RP / 'b_show.json').read_text()); px = J['rect_px']; sec = J['sec']
sb = fr['pogos_b']['showVideo']
sb['rect'] = [1e-05, round((px[1] + 0.01) / FH, 6), 0.99999, round((px[3] - 0.01) / FH, 6)]
sb['t'] = [1.0, round(1.0 + sec, 2)]
sb['eraseV'] = 0.655   # горизонт подложки B: ниже — подложка помечена небом, стёртая стена синела
sb['note'] = 'снос: собака убегает, звонницы падают, стены оседают → руины → на их месте поднимается кинотеатр «Москва» (Veo из последнего кадра руин) → пауза → всё назад до церкви в %s раза быстрее — «время отматывается»' % 2.5
fxb = fr['pogos_b']['fx']; fxb['dur'] = round(sec + 2.0, 2); fxb['tod'] = [[0, 0], [fxb['dur'], 0]]
# B dog
acts = fr['pogos_b']['poses']['actors']
sleep = [a for a in acts if a.get('video') == 'vid_b_dog.mp4'][0]; kennel = [a for a in acts if a.get('wx')][0]
sleep['hours'] = [19, 5]; sleep['note'] = 'вечер и ночь (19–5 по часам зрителя): собака спит — видео Veo (дышит, водит ушами, виляет хвостом); ночью — ночной рисунок'
am = {'rect': [0.4, 0.68, 0.7, 0.84], 'video': 'vid_b_dog_am.mp4', 'mask': 'vid_b_dog_am_mask.png', 'hours': [5, 11],
      'note': 'утро (5–11): просыпается, потягивается, ест из миски, ложится обратно — Veo из правки Gemini Pro с миской (wzyav7), петля 9 с'}
day = {'rect': [0.4, 0.68, 0.7, 0.84], 'video': 'vid_b_dog_day.mp4', 'mask': 'vid_b_dog_day_mask.png', 'hours': [11, 19],
       'note': 'день (11–19): садится, смотрит по сторонам, виляет хвостом, наклоняет голову, ложится — Veo, петля 9 с'}
fr['pogos_b']['poses']['actors'] = [am, day, sleep, kennel]
# D
I = json.loads((RP / 'insc17.json').read_text())
for it in fr['pogos_d']['fx']['items']:
    if it.get('kind') == 'letters':
        for k in ('cells', 'step', 'rise', 'ignite', 'burn', 'emberK', 'out', 'outStep'): it.pop(k, None)
        it.update({'rect': I['rect'], 'size': I['size'], 'bld': True,
                   'carve': {'groove': 'show_insc_d_wgroove.webp', 'light': 'show_insc_d_wlight.webp', 'time': 'show_insc_d_wtime.webp'},
                   'write': {'t0': 0.3, 'dur': 7.5, 'soft': 0.025, 'front': 0.9}, 'lightK': 1.0, 't': [5.0, 15.5], 'fade': [0.4, 1.5],
                   'note': 'надпись ՍՈՒՐԲ ՊՈՂՈՍ ՊԵՏՐՈՍ на плоскости поля над дверью (гомография по 4 углам, insc17.py) пишется штрихами слева направо, как резьба: желобок темнее, верхний край светлее, на острие — свежий скол; без мерцания'})
        assert all((FR / v).exists() for v in it['carve'].values())
for h in fr['pogos_d']['hotspots']:
    if h['key'] == 'repairs': h['u'], h['v'] = 0.56, 0.41
for f in ('vid_b_dog_am.mp4', 'vid_b_dog_day.mp4', 'vid_b_show.mp4'): assert (FR / f).exists(), f
P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('B show', sb['rect'], sb['t'], fxb['dur'], '| actors', [a.get('video') or a.get('srcs') for a in fr['pogos_b']['poses']['actors']])
