#!/usr/bin/env python3
"""Статистика посещений на статических страницах сайта (главная, 404, about/history зданий) — тот же сниппet, что build_pages ставит в страницы зданий.
  python3 tools/site_analytics.py            # поставить/обновить (токен из tools/analytics.json)
  python3 tools/site_analytics.py --remove   # убрать
Метка <!--chka-analytics--> — повторный запуск ничего не дублирует. Публикация — publish_hub.py."""
import sys, re, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools')); import build_pages as bp
MARK = re.compile(r'<!--chka-analytics-->.*?<!--/chka-analytics-->', re.S)
pages = [ROOT / 'index.html', ROOT / '404.html'] + sorted(ROOT.glob('tests/*/about.html')) + sorted(ROOT.glob('tests/*/history.html'))
snip = '' if '--remove' in sys.argv else bp.analytics_snippet()
if not snip and '--remove' not in sys.argv:
    sys.exit('нет токена в tools/analytics.json ({"cloudflare_token": "32 hex"})')
for p in pages:
    if not p.exists(): continue
    s = p.read_text(encoding='utf-8'); s2 = MARK.sub('', s)
    if snip: s2 = s2.replace('</head>', '<!--chka-analytics-->%s<!--/chka-analytics--></head>' % snip, 1)
    if s2 != s: p.write_text(s2, encoding='utf-8'); print('изменено:', p.relative_to(ROOT))
