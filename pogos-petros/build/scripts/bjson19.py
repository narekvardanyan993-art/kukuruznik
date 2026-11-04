#!/usr/bin/env python3
"""Заход 19: building.json Погос-Петроса — look.captions (подписи кадров/шоу на экране, e1.54) и card (наклейка на главной).
card.image — card.webp рядом с building.json (pages8.py); eyebrow/meta — из pogos-petros/sources/texts.md (черновик card, шаг 5).
Блока live нет: пока здание не live, карточка на главной скрыта (build_pages.card_hidden), на бете/в предпросмотре видна.
Повторный запуск даёт тот же файл."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json')
b = json.loads(P.read_text(encoding='utf-8'))
b['look']['captions'] = True
b['card'] = {
    'eyebrow': {'hy': '3D · 1915–1929', 'ru': '3D · 1915–1929', 'en': '3D · 1915–1929'},
    'meta': {'hy': 'Շահար թաղամաս · Երևան', 'ru': 'Квартал Шаар · Ереван', 'en': 'Shahar quarter · Yerevan'},
    'image': 'card.webp',
    'history': 'history.html',
}
order = ['format', 'id', 'meta', 'app', 'links', 'framesDir', 'text', 'facts', 'aboutFacts', 'postcardFile', 'postcard', 'look', 'tuning', 'live', 'card', 'frames']
out = {k: b[k] for k in order if k in b}
assert set(out) == set(b), set(b) ^ set(out)
P.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('OK bjson19')
