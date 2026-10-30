#!/usr/bin/env python3
# Заход 12: building.json Погос-Петроса — старик (3 позы), собака B, листья на ветру A/B/C, шоу C «гроза». Запуск из корня репо; повтор — то же.
import json, sys
from pathlib import Path
p = Path('tests/pogos-petros/building.json'); b = json.loads(p.read_text())
FR = Path('tests/pogos-petros/frames')
rains = sorted(x.name for x in FR.glob('show_rain_*.png'))
leaves = sorted(x.name for x in FR.glob('show_leaf_*.png'))
dogs = sorted(x.name for x in FR.glob('show_pose_b_dog*.png'))
olds = sorted(x.name for x in FR.glob('show_pose_a_old*.png'))
dog_rect = json.loads(Path('pogos-petros/build/source/pre11/dog_rect.json').read_text()) if Path('pogos-petros/build/source/pre11/dog_rect.json').exists() else None
LEAF = {'a': [[0.84, 0.56, 0.99, 0.74], [-0.06, 0.45, -0.01, 0.85]],
        'b': [[0.0, 0.47, 0.14, 0.70], [-0.06, 0.45, -0.01, 0.85]],
        'c': [[0.0, 0.49, 0.25, 0.70], [-0.06, 0.45, -0.01, 0.85]]}
for f in b['frames']:
    k = f['name'][-1]
    if k in LEAF and leaves:
        f['leafFly'] = {'srcs': leaves, 'from': LEAF[k], 'n': [2, 7], 'h': [0.015, 0.024], 'drift': 0.16, 'fall': 0.035,
                        'note': 'в порыв ветра листья (лист Gemini) срываются с кроны и из-за левого края, летят по ветру, кружатся, уходят за край; днём, без снега'}
    if k == 'a' and len(olds) >= 3:
        A = f['poses']['actors']
        A[0] = {'rect': [0.30, 0.69, 0.52, 0.80], 'srcs': olds[:3], 'every': [1.5, 3.0], 'fade': 0.35, 'order': 'cycle',
                'note': 'старик кормит голубей: рука у кармана → достаёт крошки → бросает, рука вытянута (Gemini Flash, заход 12)'}
    if k == 'b' and dogs and dog_rect:
        f['poses'] = {'layer': 'bld', 'actors': [{'rect': dog_rect, 'srcs': [None] + dogs, 'every': [1.8, 4.0], 'fade': 0.3,
                      'note': 'собака у стены: спит ↔ подняла голову ↔ виляет хвостом (Gemini Pro + Flash, заход 12); ночью спит — в ночном рисунке'}]}
    if k == 'c':
        items = [
            {'kind': 'storm', 't': [0.5, 21], 'fade': [3, 4], 'note': 'сцена в тон грозы, ручей бежит быстрее (виден в окне картинки)'},
            {'kind': 'image', 'src': 'show_storm_c.webp', 'alpha': 1.0, 'steady': True, 'ease': True, 'hole': 'show_storm_c_hole.png', 't': [0.5, 21], 'fade': [3, 4],
             'note': 'грозовой рисунок Gemini Pro (p0g34y), совмещён с кадром'},
            {'kind': 'image', 'src': 'show_flash_c.webp', 'alpha': 1.0, 'steady': True, 't': [6.0, 6.55], 'fade': [0.06, 0.4], 'note': 'вспышка молнии (Gemini Pro 9znfht)'},
            {'kind': 'image', 'src': 'show_flash_c.webp', 'alpha': 0.75, 'steady': True, 't': [6.75, 7.1], 'fade': [0.05, 0.28]},
            {'kind': 'image', 'src': 'show_flash_c.webp', 'alpha': 1.0, 'steady': True, 't': [11.2, 11.8], 'fade': [0.06, 0.45]},
            {'kind': 'image', 'src': 'show_flash_c.webp', 'alpha': 0.9, 'steady': True, 't': [15.6, 16.1], 'fade': [0.05, 0.35]}]
        if rains:
            items.append({'kind': 'flakes', 'srcs': rains, 'area': [0, 0, 1, 1], 'n': 70, 'h': [0.05, 0.09], 'speed': 0.9, 'angle': -0.27, 'wind': 0.5,
                          't': [3.5, 19.5], 'dens': [[0, 0], [0.15, 1], [0.85, 1], [1, 0]], 'note': 'дождь — струи Gemini, косо, ветер сносит'})
        f['fx'] = {'dur': 22, 'items': items}
p.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n')
print('leaves', len(leaves), 'rain', len(rains), 'dog', dogs, dog_rect, 'old', olds)
