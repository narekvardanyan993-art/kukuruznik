#!/usr/bin/env python3
"""Шаг 6 ч.2 (04.11.2026): building.json Погос-Петроса — новые Veo-ролики собаки B (ночь, день-2). Идемпотентно.
night (Veo f52cac43, fix18.py clip … night): hours [19,5) — живой сон; day2 (Veo 7487ec74, … day2): hours [11,19), чередуется с day и дремотой.
Дремота (vid_b_dog) остаётся в любое время; тап — vid_b_dog_tap (fix18.py tap)."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json'); FR = P.parent / 'frames'; RP = Path('pogos-petros/build/report/s18')
b = json.loads(P.read_text(encoding='utf-8')); fr = {f['name']: f for f in b['frames']}
po = fr['pogos_b']['poses']; acts = po['actors']
by = {a.get('video'): a for a in acts}
for f in ('vid_b_dog_night.mp4', 'vid_b_dog_night_mask.png', 'vid_b_dog_day2.mp4', 'vid_b_dog_day2_mask.png'): assert (FR / f).exists(), f
mk = lambda v, n, h, note: {'rect': [0.4, 0.68, 0.7, 0.84], 'video': v, 'mask': n, 'hours': h, 'note': note, 'set': 'dog'}
by['vid_b_dog_night.mp4'] = mk('vid_b_dog_night.mp4', 'vid_b_dog_night_mask.png', [19, 5],
    'ночь (19–5): дышит, лапы и уши дёргаются во сне, просыпается, чешется, засыпает — Veo f52cac43, петля 9 с; ночью — в тоне ночного рисунка')
by['vid_b_dog_day2.mp4'] = mk('vid_b_dog_day2.mp4', 'vid_b_dog_day2_mask.png', [11, 19],
    'день-2 (11–19): встаёт, берёт палку, грызёт её лёжа, виляет хвостом, бросает, ложится — Veo 7487ec74, петля 9 с; чередуется с day')
by['vid_b_dog.mp4']['note'] = 'дремота (в любое время): дышит, водит ушами, виляет хвостом, чешет за ухом — Veo 41c784d4; ночью и на закате — в тоне рисунка'
tap = by['vid_b_dog_tap.mp4']; kennel = [a for a in acts if a.get('wx')][0]
order = ['vid_b_dog_am.mp4', 'vid_b_dog_day.mp4', 'vid_b_dog_day2.mp4', 'vid_b_dog_night.mp4', 'vid_b_dog.mp4']
po['actors'] = [by[v] for v in order] + [tap, kennel]
if (RP / 'hit.json').exists(): po['tap']['hit'] = json.loads((RP / 'hit.json').read_text())['hit']
P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print([a.get('video') or a.get('srcs') for a in po['actors']], po['tap']['hit'])
