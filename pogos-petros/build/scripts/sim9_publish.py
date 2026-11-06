#!/usr/bin/env python3
"""Шаг 9: прогон publish_engine --with-building pogos-petros БЕЗ git и без check_site — в копии сайта (git archive origin/main
lenin kukuruznik assets beta/engine engine CNAME index.html 404.html -> <site>). Сначала build_beta (= сайт после publish_beta),
потом те же функции bp.*, что в publish_engine, и те же сверки. Пишет только в <site>.  python3 sim9_publish.py <site>"""
import json, sys
from pathlib import Path
R = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(R / 'tools'))
import build_pages as bp
S = Path(sys.argv[1]); wb = 'pogos-petros'
old = {p: (S / p).read_text(encoding='utf-8') for p in ('index.html', '404.html', 'lenin/index.html', 'kukuruznik/index.html')}
bp.build_beta(S)                                   # = сайт после publish_beta
snap = {str(f.relative_to(S)): f.read_bytes() for f in (S / 'beta').rglob('*') if f.is_file()}
bp.build_beta(S)                                   # publish_engine пересобирает бету — она обязана не измениться
again = {str(f.relative_to(S)): f.read_bytes() for f in (S / 'beta').rglob('*') if f.is_file()}
print('beta после пересборки та же:', snap == again)
bdirs = sorted(set(bp.live_buildings(site=S)) | {wb})
files = bp.place_live_files(S, wb) + bp.place_hub_and_404(S, wb)
files += bp.build_live(S, bdirs, engine_from=S / 'beta' / 'engine')
print('живые здания:', bdirs, '| файлов здания:', sum(1 for f in files if f.startswith(wb + '/')))
print('live_vs_beta:', bp.live_vs_beta(S, [b for b in bdirs]) or 'ok')
print('live_vs_beta_config:', bp.live_vs_beta_config(S, wb) or 'ok')
for b in ('lenin', 'kukuruznik'):
    print('шапка %s:' % b, bp.head_changes(old['%s/index.html' % b], (S / b / 'index.html').read_text(encoding='utf-8')) or 'прежняя')
    a = bp.page_config(old['%s/index.html' % b]); n = bp.page_config((S / b / 'index.html').read_text(encoding='utf-8'))
    print('  CONFIG %s изменилось:' % b, {k: (a.get(k), n.get(k)) for k in sorted(set(a) | set(n)) if json.dumps(a.get(k), sort_keys=True) != json.dumps(n.get(k), sort_keys=True)})
print('главная вне карточки/стопки/счётчика:', bp.hub_outside_diff(old['index.html'], (S / 'index.html').read_text(encoding='utf-8'), wb) or 'ok')
print('404 known:', "'pogos-petros': 'pogos-petros/'" in (S / '404.html').read_text(encoding='utf-8'))
pg = (S / wb / 'index.html').read_text(encoding='utf-8')
print('живая страница: canonical', 'https://chka.am/pogos-petros/' in pg, '| noindex', 'noindex' in pg, '| tests/', 'tests/' in pg, '| e1.54', "e1.54" in pg)
print('about/history без noindex:', all('noindex' not in (S / wb / n).read_text(encoding='utf-8') for n in ('about.html', 'history.html')))
print('frames:', len(list((S / wb / 'frames').iterdir())), '= beta', len(list((S / 'beta/tests' / wb / 'frames').iterdir())))
