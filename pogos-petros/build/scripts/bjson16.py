#!/usr/bin/env python3
"""Заход 16 (e1.51): building.json Погос-Петроса — надпись D резьбой (letters.carve, атласы ×8 из report/s16/insc16.json),
наезд камеры на звонницу в шоу A (fx.cam: колокол ≥ 70 px на экране 390×844). Повторный запуск даёт тот же файл."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json'); FR = P.parent / 'frames'
b = json.loads(P.read_text(encoding='utf-8')); fr = {f['name']: f for f in b['frames']}
J = json.loads(Path('pogos-petros/build/report/s16/insc16.json').read_text())
for it in fr['pogos_d']['fx']['items']:
    if it.get('kind') == 'letters':
        for k in ('dark', 'fire', 'glow', 'glowK'): it.pop(k, None)
        it.update({'size': J['size'], 'cells': J['cells'],
                   'carve': {'groove': 'show_insc_d_cgroove.webp', 'light': 'show_insc_d_clight.webp', 'ember1': 'show_insc_d_cember1.webp', 'ember2': 'show_insc_d_cember2.webp'},
                   'step': 0.32, 'rise': 0.8, 'ignite': 0.9, 'burn': 3.0, 'emberK': 1.6, 'lightK': 1.0, 'out': 3.2, 'outStep': 0.12,
                   'note': 'надпись ՍՈՒՐԲ ՊՈՂՈՍ ՊԵՏՐՈՍ резьбой в камне: буквы проступают по одной (желобок темнее, верхний край светлее), в желобке тлеют угли — атласы ×8 (fix16.py insc), код только модулирует пиксели камня'})
        assert all((FR / v).exists() for v in it['carve'].values())
# A: наезд на звонницу — колокол (центр кадра u 0,605 v 0,401, ≈ 50 px кадра) на экране ≥ 70 px; туда — пока голуби взлетают, обратно — до конца видео
fr['pogos_a']['fx']['cam'] = {'at': [0.605, 0.395], 'zoom': 2.6, 'to': [0.5, 0.42], 't': [1.0, 3.2, 9.4, 11.6],
                              'note': 'наезд на звонницу: колокол крупно (≈ 80 px на экране 390×844), плавно туда и обратно'}
P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print([ (k, it.get('carve') is not None) for k in ('pogos_d',) for it in fr[k]['fx']['items'] if it.get('kind') == 'letters'], fr['pogos_a']['fx']['cam'])
