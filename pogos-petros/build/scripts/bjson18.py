#!/usr/bin/env python3
"""Заход 18 (e1.53): building.json Погос-Петроса. Повторный запуск даёт тот же файл.
- B собака всегда живая: набор роликов "dog" (утро — миска, день — c17 + дремота, вечер/ночь — сон с ушами/хвостом/почёсыванием),
  в части суток ролики чередуются случайно; ночью и на «Закате» — те же ролики в тоне рисунка (poses.tone, fix18.py tone).
  Тап по собаке → ролик тапа (просыпается, смотрит в камеру, виляет, ложится), потом снова случайный (poses.tap, hit — report/s18/hit.json).
- D: после резьбы надпись разгорается огнём (letters.blaze), горит, гаснет; шоу 25 с."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json'); FR = P.parent / 'frames'; RP = Path('pogos-petros/build/report/s18')
b = json.loads(P.read_text(encoding='utf-8')); fr = {f['name']: f for f in b['frames']}
H = json.loads((RP / 'hit.json').read_text())['hit']
po = fr['pogos_b']['poses']; acts = po['actors']
by = {a.get('video'): a for a in acts}; kennel = [a for a in acts if a.get('wx')][0]
am, day, sleep = by['vid_b_dog_am.mp4'], by['vid_b_dog_day.mp4'], by['vid_b_dog.mp4']
for a in (am, day, sleep): a['set'] = 'dog'
am['hours'] = [5, 11]; day['hours'] = [11, 19]; sleep.pop('hours', None)
sleep['note'] = 'дремота (в любое время, ночью — единственный ролик, пока нет Veo «ночь»): дышит, водит ушами, виляет хвостом, чешет за ухом — Veo 41c784d4; ночью и на закате — в тоне рисунка'
day['note'] = 'день (11–19): садится, смотрит по сторонам, виляет хвостом, наклоняет голову, ложится — Veo c3fa979d; чередуется с дремотой'
tap = {'rect': [0.4, 0.68, 0.7, 0.84], 'video': 'vid_b_dog_tap.mp4', 'mask': 'vid_b_dog_tap_mask.png', 'set': 'dog', 'tap': True,
       'note': 'реакция на тап: просыпается, поднимает голову, смотрит в камеру, наклоняет голову, ложится (кусок Veo c3fa979d 1,2–3,6 + 6,5–9,9 с, fix18.py tap; свой Veo «c» — заменить файл)'}
for f in ('vid_b_dog_tap.mp4', 'vid_b_dog_tap_mask.png', 'vid_b_dog_night_tone.png', 'vid_b_dog_sunset_tone.png'): assert (FR / f).exists(), f
po['actors'] = [am, day, sleep, tap, kennel]
po['tone'] = {'night': 'vid_b_dog_night_tone.png', 'sunset': 'vid_b_dog_sunset_tone.png', 'scale': 160,
              'note': 'ночь/закат ÷ день (размыто), fix18.py tone: ночью и на закате видео-собака пишется в ночной/закатный рисунок — живая всегда'}
po['tap'] = {'set': 'dog', 'hit': H, 'note': 'тап/клик только по собаке (где она двигается во всех роликах, fix18.py hit)'}
# D
fx = fr['pogos_d']['fx']; fx['dur'] = 25.0
for it in fx['items']:
    if it.get('kind') == 'doorlight': it['t'] = [2, 24.5]
    if it.get('kind') == 'letters':
        it['t'] = [5.0, 24.5]; it['fade'] = [0.4, 1.5]
        it['blaze'] = {'t0': 8.0, 'rise': 2.2, 'hold': 6.0, 'out': 3.0, 'k': 1.7, 'halo': 1.1}
        it['note'] = 'надпись ՍՈՒՐԲ ՊՈՂՈՍ ՊԵՏՐՈՍ пишется штрихами (insc17.py), потом буквы разгораются огнём по порядку резьбы (blaze: тёплый свет изнутри желобка, медленное мерцание, ореол), горят и гаснут'
P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('B', [a.get('video') or a.get('srcs') for a in po['actors']], po['tap'], '| D dur', fx['dur'])
