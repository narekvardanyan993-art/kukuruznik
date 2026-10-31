#!/usr/bin/env python3
"""Заход 14 (e1.49): building.json Погос-Петроса — живые места из видео Veo (poses.actors[].video/mask) вместо поз-картинок
и погодные версии (poses.actors[].wx — правки Gemini «тот же кусок кадра в непогоду»). Добавляет только то, чьи файлы есть
в tests/pogos-petros/frames. Повторный запуск даёт тот же файл."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json'); FR = P.parent / 'frames'
b = json.loads(P.read_text(encoding='utf-8'))
fr = {f['name']: f for f in b['frames']}
has = lambda n: (FR / n).exists()

def setp(name, video, wx):
    f = fr[name]; po = f.get('poses') or {'layer': 'bld', 'actors': []}
    acts = po['actors']
    if video and has(video[1]) and has(video[2]):
        keep = [a for a in acts if not video[3](a) and not a.get('video')]
        acts = keep + [{'rect': video[0], 'video': video[1], 'mask': video[2], 'note': video[4]}]
    if wx and has(wx[1]):
        acts = [a for a in acts if not a.get('wx')] + [{'rect': wx[0], 'srcs': [wx[1]], 'wx': True, 'fade': 0.6, 'note': wx[2]}]
    po['actors'] = acts; f['poses'] = po

setp('pogos_b', ([0.43, 0.72, 0.68, 0.82], 'vid_b_dog.mp4', 'vid_b_dog_mask.png', lambda a: 'dog' in json.dumps(a),
                 'собака у стены — видео Veo: дышит, водит ушами, виляет хвостом, чешется (петля 9 с, кроссфейд конца с началом); ночью и в непогоду — рисунок'),
     ([0.40, 0.66, 0.72, 0.84], 'show_wx_b_kennel.png', 'в дождь/снег собака в будке у стены (правка Gemini Pro)'))
setp('pogos_a', ([0.28, 0.68, 0.62, 0.855], 'vid_a_old.mp4', 'vid_a_old_mask.png', lambda a: any(k in json.dumps(a) for k in ('_old', '_pg')),
                 'старик кормит голубей, голуби клюют — видео Veo (кусок 4,5–10 с туда-обратно, 10,9 с); ночью и в непогоду — рисунок'),
     ([0.26, 0.66, 0.60, 0.86], 'show_wx_a_bench.png', 'в дождь/снег скамейка пустая — старик ушёл (правка Gemini Pro)'))
setp('pogos_f', ([0.06, 0.667, 0.42, 0.875], 'vid_f_pair.mp4', 'vid_f_pair_mask.png', lambda a: any(k in json.dumps(a) for k in ('_man', '_woman')),
                 'пара разговаривает, жесты — видео Veo; ночью и в непогоду — рисунок'),
     ([0.04, 0.668, 0.44, 0.877], 'show_wx_f_umbrella.png', 'в дождь/снег пара под зонтом (правка Gemini Pro)'))
P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for n in ('pogos_a', 'pogos_b', 'pogos_f'):
    print(n, [(a.get('video') or a.get('srcs')) for a in fr[n]['poses']['actors']])
