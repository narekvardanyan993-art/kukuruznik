#!/usr/bin/env python3
"""Шаг 9: блок live (chka.am/pogos-petros/) и место в стопке главной для Погос-Петроса — как у Ленина. Повтор — без изменений."""
import json
from pathlib import Path
R = Path(__file__).resolve().parents[3]
f = R / 'tests/pogos-petros/building.json'
b = json.loads(f.read_text(encoding='utf-8'))
live = {"slug": "pogos-petros",
        "meta": {"url": "https://chka.am/pogos-petros/", "ogImage": "og.jpg",
                 "favicon": "../assets/favicon-32.png", "appleTouchIcon": "../assets/icon-180.png",
                 "viewerVersion": "pogos-petros-1"},
        "links": {"home": "../"}}
out = {}
for k, v in b.items():
    if k == 'live':
        continue
    if k == 'card':
        out['live'] = live
        v = dict(v); v['stack'] = 'b'   # место sc-b в стопке шапки главной (силуэт ghost-slab), a — остаётся силуэтом
    out[k] = v
f.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('live:', out['live']['slug'], 'stack:', out['card']['stack'])
