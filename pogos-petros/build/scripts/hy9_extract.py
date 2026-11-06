#!/usr/bin/env python3
"""Шаг 9: все hy-строки Погос-Петроса (building.json + about/history) с ru-смыслом -> sources/hy_gemini_in.md (вход для Gemini)."""
import json, re, sys
from pathlib import Path
R = Path(__file__).resolve().parents[3]
T = R / 'tests/pogos-petros'
items = []
def walk(o, p):
    if isinstance(o, dict):
        if isinstance(o.get('hy'), str) and isinstance(o.get('ru'), str):
            items.append(('bj:' + p, o['hy'], o['ru']))
        for k, v in o.items():
            if k in ('hy', 'ru', 'en'): continue
            walk(v, p + '.' + k if p else k)
    elif isinstance(o, list):
        for i, v in enumerate(o): walk(v, '%s[%d]' % (p, i))
walk(json.loads((T / 'building.json').read_text(encoding='utf-8')), '')
PAT = re.compile(r'<(span|p|li|div|h\d)([^>]*?)\blang="hy"([^>]*)>(.*?)</\1>\s*<\1[^>]*\blang="ru"[^>]*>(.*?)</\1>', re.S)
seen = {}
for f in ('about.html', 'history.html'):
    s = (T / f).read_text(encoding='utf-8')
    n = 0
    for m in PAT.finditer(s):
        hy, ru = m.group(4), m.group(5)
        if '<' in hy and re.search(r'lang="', hy): continue
        if hy in seen: continue
        n += 1; seen[hy] = 1
        items.append(('%s#%d' % (f.split('.')[0], n), hy, re.sub(r'<[^>]+>', '', ru)))
out = ['# hy-строки Погос-Петроса для вычитки (id | hy | ru-смысл)', '']
for i, (k, hy, ru) in enumerate(items, 1):
    out.append('%d. [%s]\nHY: %s\nRU: %s\n' % (i, k, hy, ru))
(R / 'pogos-petros/sources/hy_gemini_in.md').write_text('\n'.join(out), encoding='utf-8')
json.dump(items, open(R / 'pogos-petros/sources/hy_gemini_in.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(items), sum(len(h) for _, h, _ in items))
