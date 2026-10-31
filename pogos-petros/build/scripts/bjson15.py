#!/usr/bin/env python3
"""Заход 15 (e1.50): building.json Погос-Петроса — шоу A/B/C из видео Veo (frames[].showVideo), старые шоу убраны
(A — стая голубей кодом, B — день→закат→ночь, C — гроза); шоу держит день (fx.tod 0), иначе ночью видео не видно.
Старик A в непогоду: дождь — газета над головой, снег — поднятый воротник (wx "rain"/"snow") вместо пустой скамейки.
Рамки — из report/s15/<имя>_spatch.json (пиксели кадра 768×1365). Повторный запуск даёт тот же файл."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json'); FR = P.parent / 'frames'; REP = Path('pogos-petros/build/report/s15')
b = json.loads(P.read_text(encoding='utf-8'))
fr = {f['name']: f for f in b['frames']}
FW, FH = 768, 1365

def rect(nm):
    x0, y0, x1, y1 = json.loads((REP / ('%s_spatch.json' % nm)).read_text())['rect_px']
    return [round(x0 / FW + 1e-5, 6), round(y0 / FH + 1e-5, 6), round(x1 / FW - 1e-5, 6), round(y1 / FH - 1e-5, 6)]

def sec(nm): return json.loads((REP / ('%s_spatch.json' % nm)).read_text())['sec']

DIFF = {'pogos_a': [16, 40], 'pogos_b': [16, 40], 'pogos_c': [14, 36]}   # пиксель видео — только где он отличается от рисунка (небо и стены остаются рисунком)
SHOWS = {
    'pogos_a': ('a_show', 'bld', 1.0, [0.9, 1.3], 'колокол в арке качается всё сильнее, голуби с карниза взлетают по одному-два и улетают за кадр — видео Veo из правки Gemini (колокол + голуби на карнизе); проявляется и тает'),
    'pogos_b': ('b_show', 'bld', 1.0, [0.5, 0.8], 'снос: собака убегает, трещины, звонницы падают, стены оседают в пыли → руины (пауза 2 с) → тот же ролик назад в 1,5 раза быстрее — «время отматывается»'),
    'pogos_c': ('c_show', 'bg', 1.0, [0.6, 1.0], 'фаэтон с лошадью проезжает по улице от дальнего плана к ближнему и уходит за правый нижний угол — видео Veo'),
}
for name, (nm, layer, t0, fade, note) in SHOWS.items():
    if not ((FR / ('vid_%s.mp4' % nm)).exists() and (FR / ('vid_%s_mask.png' % nm)).exists()):
        print('нет видео', nm); continue
    f = fr[name]; s = sec(nm); dur = round(t0 + s + 1.0, 2)
    f['fx'] = {'dur': dur, 'tod': [[0, 0], [dur, 0]], 'items': [], 'note': 'шоу — видео Veo (showVideo); день на время шоу (ночью видео не видно)'}
    f['showVideo'] = {'rect': rect(nm), 'video': 'vid_%s.mp4' % nm, 'mask': 'vid_%s_mask.png' % nm, 'layer': layer,
                      't': [t0, round(t0 + s, 2)], 'fade': fade, 'diff': DIFF[name], 'note': note}
# старик A: дождь / снег — свои версии вместо пустой скамейки
f = fr['pogos_a']; acts = [a for a in f['poses']['actors'] if not a.get('wx')]
for k, src, note in (('rain', 'show_wx_a_rain.png', 'в дождь старик накрылся газетой, голубей нет (правка Gemini Pro gu7g0v)'),
                     ('snow', 'show_wx_a_snow.png', 'в снег старик поднял воротник, руки в карманах, голубей нет (правка Gemini Pro jex41d)')):
    if (FR / src).exists(): acts.append({'rect': [0.26, 0.66, 0.6, 0.86], 'srcs': [src], 'wx': k, 'fade': 0.6, 'note': note})
f['poses']['actors'] = acts
P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for n in SHOWS: print(n, fr[n]['fx']['dur'], fr[n].get('showVideo', {}).get('rect'), fr[n].get('showVideo', {}).get('t'))
print([(a.get('video') or a.get('srcs'), a.get('wx')) for a in fr['pogos_a']['poses']['actors']])
