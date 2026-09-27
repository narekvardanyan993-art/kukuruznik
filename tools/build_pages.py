#!/usr/bin/env python3
"""Сборка страниц зданий из движка (docs/ENGINE-PLAN.md, п.3–4).

Страница здания = шаблон движка (engine/page.html) + числа и тексты движка (engine/config.json)
                  + настройки здания (<здание>/building.json).
Настройки вшиваются в страницу (как раньше CONFIG): страница не скачивает json при открытии — нет лишнего запроса
до приветствия, а превью в соцсетях видит заголовок и картинку (соцсети JS не выполняют).

  python3 tools/build_pages.py --site DIR            # собрать бету в корне сайта DIR (например, временный worktree main)
  python3 tools/build_pages.py --site DIR --verify   # и сверить собранный CONFIG с живым (kukuruznik/index.html в DIR)

Что делает для беты (этап 2 плана, только бета; живой /kukuruznik/ и /engine/ не трогает):
  • beta/ очищается целиком (старая бета v12.1 с копией кадров больше не нужна);
  • beta/engine/            — копия engine/ (движок, шрифты); адреса скриптов с ?v=<версия движка> против старого кэша;
  • beta/kukuruznik/index.html — Кукурузник на бета-движке; кадры, значки, страница здания — с живого /kukuruznik/ (не копируются);
  • beta/index.html        — перенаправление на beta/kukuruznik/ (старая ссылка беты работает), со значком страницы.
Все адреса в настройках здания (кадры, значки, ссылки) — относительно папки здания; сборка пересчитывает их для места страницы.
"""
import argparse
import html
import json
import posixpath
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / 'engine'
LANGS = ('hy', 'ru', 'en')


def load_building(bid):
    b = json.loads((ROOT / bid / 'building.json').read_text(encoding='utf-8'))
    if b.get('format') != 1:
        raise SystemExit('%s/building.json: неизвестный формат %r' % (bid, b.get('format')))
    return b


def rel(from_dir, target):
    """Относительный адрес от папки страницы (например 'beta/kukuruznik/') до пути на сайте ('kukuruznik/frames/')."""
    r = posixpath.relpath('/' + target.strip('/'), '/' + from_dir.strip('/'))
    if target.endswith('/'):
        return './' if r == '.' else r + '/'
    return r


def site_path(bid, p):
    """Адрес из building.json (относительно папки здания) -> путь от корня сайта."""
    return posixpath.normpath(posixpath.join(bid, p)) + ('/' if p.endswith('/') else '')


def visible_frames(b):
    """Кадры здания без скрытых (hidden: true): все списки «по кадрам» в CONFIG строятся только из них — номер кадра везде один."""
    return [f for f in b['frames'] if not f.get('hidden')]


def make_config(b, frames_url):
    """CONFIG для просмотрщика: движок (engine/config.json) + здание (building.json). Всё про здание — отсюда, в коде движка его нет."""
    C = json.loads((ENGINE / 'config.json').read_text(encoding='utf-8'))
    fr = visible_frames(b)
    look = b['look']
    day = dict(look['day'])
    day['SKY_REF'] = [f['sky']['ref'] for f in fr]
    day['SKY_END'] = [f['sky']['end'] for f in fr]
    parade = [i for i, f in enumerate(fr) if f.get('parade')]
    if len(parade) > 1:
        raise SystemExit('%s: парад может быть только на одном кадре (сейчас: %s)' % (b['id'], parade))
    C.update({
        'NIGHT_MAIN_LIT': look['night']['mainLit'],
        'NIGHT_OTHER_LIT': look['night']['otherLit'],
        'NIGHT_DIM': look['night']['dim'],
        'MAIN_WINDOW_SHARE': look['night']['mainWindowShare'],
        'FRAME_SIZE': look['frameSize'],
        'SUN_SIDE': look['sunSide'],
        'DAY': day,
        'CLOUD_SHADOW': [f['cloudShadow'] for f in fr],
        'WIND_K': [f['wind'] for f in fr],
        'FRAMES': [frame_files(frames_url, f['name']) for f in fr],
        'HOTSPOTS': [f['hotspots'] for f in fr],
        'CROP': [f['crop'] for f in fr],
        'FLAGS': [f['flag'] or [0, 0, 0, 0] for f in fr],
        'NIGHT_HALO': [f['nightHalo'] for f in fr],
        'NIGHT_LAMPS': [f['nightLamps'] for f in fr],
        'LAMPS': [f['lamps'] for f in fr],
        'SCENE': [scene(f) for f in fr],
        'PARADE_FRAME': parade[0] if parade else -1,
        'ABOUT_FACTS': b['aboutFacts'],
        'POSTCARD_FILE': b['postcardFile'],
        'I18N': b['facts'],
    })
    ui = dict(C['UI_I18N'])
    ui.update(b['text'])
    C['UI_I18N'] = ui
    return C


def scene(f):
    """Живые детали кадра (details.js): что летает, небо, облака, солнце/луна, газон, крупный план."""
    sky, sun = f['sky'], f['sun']
    sc = {'life': f['life'], 'skyBand': sky['band'], 'clouds': sky['clouds'], 'sunDay': sun['day'], 'sunSet': sun['sunset'],
          'moon': sun['moon'], 'lawn': f.get('lawn'), 'closeUp': f.get('closeUp')}
    if 'cloudScale' in sky:
        sc['cloudScale'] = sky['cloudScale']
    if sun.get('dayDrawn'):
        sc['sunDayDrawn'] = True
    return sc


def frame_files(base, n):
    f = lambda s: base + n + s + '.webp'
    return {'color': f(''), 'depth': f('_depth'), 'bg': {'color': f('_bg'), 'depth': f('_bg_depth')},
            'building': {'color': f('_building'), 'depth': f('_depth')}, 'env': f('_env'), 'win2': f('_win2'),
            'sunset': f('_sunset'), 'night': f('_night')}


def make_head(b, page_dir, beta):
    m, bid = b['meta'], b['id']
    e = lambda s: html.escape(s, quote=True)
    title, desc, alt = m['title']['hy'], m['description']['hy'], m['ogAlt']['hy']
    lines = ['<meta charset="utf-8">']
    if beta:
        lines += ['<meta name="robots" content="noindex, nofollow, noarchive">', '<meta name="googlebot" content="noindex, nofollow">']
    lines += [
        '<meta name="description" content="%s">' % e(desc),
        '<link rel="canonical" href="%s">' % e(m['url']),
        '<link rel="icon" type="image/png" sizes="32x32" href="%s">' % e(rel(page_dir, site_path(bid, m['favicon']))),
        '<link rel="apple-touch-icon" href="%s">' % e(rel(page_dir, site_path(bid, m['appleTouchIcon']))),
        '<link rel="manifest" href="manifest.json">',
        '<meta name="theme-color" content="%s">' % e(m['themeColor']),
        '<meta name="viewer-version" content="%s">' % e(m['viewerVersion']),
        '<meta name="engine-version" content="%s">' % e(engine_version()),
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Չկա">',
        '<meta property="og:url" content="%s">' % e(m['url']),
        '<meta property="og:title" content="%s">' % e(title),
        '<meta property="og:description" content="%s">' % e(desc),
        '<meta property="og:image" content="%s">' % e(m['url'] + m['ogImage']),
        '<meta property="og:image:type" content="image/jpeg">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="%s">' % e(alt),
        '<meta property="og:locale" content="hy_AM">',
        '<meta property="og:locale:alternate" content="ru_RU">',
        '<meta property="og:locale:alternate" content="en_US">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="%s">' % e(title),
        '<meta name="twitter:description" content="%s">' % e(desc),
        '<meta name="twitter:image" content="%s">' % e(m['url'] + m['ogImage']),
        '<meta name="twitter:image:alt" content="%s">' % e(alt),
    ]
    return '\n'.join(lines)


def engine_version():
    return (ENGINE / 'VERSION').read_text(encoding='utf-8').strip()


def make_manifest(b, page_dir):
    """manifest.json страницы здания («на экран Домой»): цвет фона и темы — цвет бумаги (решение плана), значки — из папки здания."""
    m, bid, app = b['meta'], b['id'], b['app']
    icon = lambda p: rel(page_dir, site_path(bid, p))
    return json.dumps({
        'name': app['name'], 'short_name': app['shortName'], 'description': m['description']['hy'],
        'start_url': './', 'scope': './', 'display': 'standalone', 'orientation': 'portrait',
        'background_color': m['themeColor'], 'theme_color': m['themeColor'],
        'icons': [{'src': icon(m['appleTouchIcon']), 'sizes': '180x180', 'type': 'image/png', 'purpose': 'any'},
                  {'src': icon(m['appleTouchIcon']), 'sizes': '180x180', 'type': 'image/png', 'purpose': 'maskable'},
                  {'src': icon(m['favicon']), 'sizes': '32x32', 'type': 'image/png'}],
    }, ensure_ascii=False, indent=2) + '\n'


def render(b, page_dir, engine_dir, beta):
    """HTML страницы здания. page_dir/engine_dir — пути от корня сайта ('beta/kukuruznik/', 'beta/engine/')."""
    bid = b['id']
    t = (ENGINE / 'page.html').read_text(encoding='utf-8')
    cfg = make_config(b, rel(page_dir, site_path(bid, b['framesDir'])))
    js = json.dumps(cfg, ensure_ascii=False, indent=1).replace('</', '<\\/')
    esc = lambda s: html.escape(s, quote=True)
    rep = {
        '{{HEAD}}': make_head(b, page_dir, beta),
        '{{TITLE}}': esc(b['meta']['title']['hy']),
        '{{CONFIG}}': js,
        '{{E}}': rel(page_dir, engine_dir),
        '{{V}}': engine_version(),
        '{{HOME}}': esc(rel(page_dir, site_path(bid, b['links']['home']))),
        '{{HISTORY}}': esc(rel(page_dir, site_path(bid, b['links']['history']))),
        '{{TEXT:panelTitle}}': esc(b['text']['panelTitle']['ru']),
        '{{TEXT:title}}': esc(b['text']['title']['ru']),
        '{{FRAME_W}}': str(b['look']['frameSize'][0]),
        '{{FRAME_H}}': str(b['look']['frameSize'][1]),
    }
    for k, v in rep.items():
        if k not in t:
            raise SystemExit('в шаблоне нет метки %s' % k)
        t = t.replace(k, v)
    left = re.findall(r'\{\{[A-Z_:a-z]+\}\}', t)
    if left:
        raise SystemExit('в странице остались метки: %s' % sorted(set(left)))
    return t


BETA_INDEX = '''<!DOCTYPE html>
<html lang="hy">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="googlebot" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=%(target)s">
<link rel="icon" type="image/png" sizes="32x32" href="%(icon)s">
<title>beta — Չկա</title>
<script>location.replace('%(target)s' + location.search + location.hash);</script>
</head>
<body>
<!-- Бета: здания на следующей версии движка (beta/engine/). Собрано tools/build_pages.py — руками не править. -->
<p><a href="%(target)s">beta → %(target)s</a></p>
</body>
</html>
'''


def build_beta(site, bids=('kukuruznik',)):
    """Собирает бету в корне сайта site. Возвращает список записанных файлов (пути от корня сайта)."""
    site = Path(site)
    if not (site / 'CNAME').exists():
        raise SystemExit('%s не похоже на корень сайта (нет CNAME)' % site)
    beta = site / 'beta'
    if beta.exists():
        shutil.rmtree(beta)
    written = []
    # движок
    for src in sorted(ENGINE.rglob('*')):
        if src.is_dir() or src.name.startswith('.') or src.name in ('page.html', 'config.json'):
            continue   # шаблон и числа движка вшиваются в страницы — отдельно не нужны
        dst = beta / 'engine' / src.relative_to(ENGINE)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        written.append(str(dst.relative_to(site)))
    # здания
    for bid in bids:
        b = load_building(bid)
        if not (site / bid / b['framesDir']).is_dir():
            raise SystemExit('на сайте нет %s/%s — кадры берутся оттуда' % (bid, b['framesDir']))
        page_dir = 'beta/%s/' % bid
        out = site / page_dir / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render(b, page_dir, 'beta/engine/', beta=True), encoding='utf-8')
        written.append(str(out.relative_to(site)))
        (out.parent / 'manifest.json').write_text(make_manifest(b, page_dir), encoding='utf-8')
        written.append(str((out.parent / 'manifest.json').relative_to(site)))
    first = load_building(bids[0])
    (beta / 'index.html').write_text(BETA_INDEX % {'target': bids[0] + '/', 'icon': rel('beta/', site_path(first['id'], first['meta']['favicon']))}, encoding='utf-8')
    written.append('beta/index.html')
    return written


def verify(site, bid='kukuruznik'):
    """Сверка: CONFIG из building.json + engine/config.json (с адресами кадров как на живой странице) == CONFIG живой страницы."""
    import subprocess
    live = (Path(site) / bid / 'index.html').read_text(encoding='utf-8')
    a = live.index('var CONFIG = {')
    b = live.index('/* ====================================================', a)
    js = live[a:b] + '\nprocess.stdout.write(JSON.stringify(CONFIG));\n'
    r = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('node: ' + r.stderr)
    live_cfg = json.loads(r.stdout)
    built = make_config(load_building(bid), load_building(bid)['framesDir'])
    RENAMED = {'NIGHT_TOWER_LIT': 'NIGHT_MAIN_LIT'}   # этап 3: «башня» -> «главное здание»
    live_cfg.pop('hiddenFrames', None)                # этап 3: скрытые кадры убирает сборка, в CONFIG ключа нет
    diff = [k for k in live_cfg if json.dumps(live_cfg[k], sort_keys=True) != json.dumps(built.get(RENAMED.get(k, k)), sort_keys=True)]
    if diff:
        raise SystemExit('CONFIG НЕ совпадает с живым, ключи: %s' % sorted(diff))
    return len(live_cfg)


def main():
    ap = argparse.ArgumentParser(description='Сборка страниц зданий из движка (пока — только бета).')
    ap.add_argument('--site', required=True, help='корень сайта (папка с CNAME), куда собирать')
    ap.add_argument('--verify', action='store_true', help='сверить собранный CONFIG с живой страницей здания')
    args = ap.parse_args()
    if args.verify:
        print('CONFIG совпадает с живым: %d ключей' % verify(args.site))
    for p in build_beta(args.site):
        print('  ', p)


if __name__ == '__main__':
    main()
