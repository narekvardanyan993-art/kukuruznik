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
import copy
import html
import json
import posixpath
import re
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import building_schema   # noqa: E402  проверка настроек здания

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / 'engine'
LANGS = ('hy', 'ru', 'en')
LOCAL_DIR = '_test/local'   # здания только для Mac (в git не идут): _test/local/<имя>/building.json + frames/


def load_building(bdir, root=None):
    """building.json здания из папки bdir (например 'kukuruznik' или '_test/test-1'). Ошибка чтения — понятным текстом."""
    f = Path(root or ROOT) / bdir / 'building.json'
    try:
        b = json.loads(f.read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: нет файла настроек %s/building.json' % bdir)
    except json.JSONDecodeError as e:
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: %s/building.json не читается как JSON (строка %d, символ %d): %s' % (bdir, e.lineno, e.colno, e.msg))
    return b


def default_buildings(root=None, with_local=False):
    """Здания беты: Кукурузник + тестовые (_test/*/building.json в git) [+ локальные для Mac]. Первое — куда ведёт beta/."""
    root = Path(root or ROOT)
    out = ['kukuruznik']
    t = root / '_test'
    if t.is_dir():
        for d in sorted(t.iterdir()):
            if d.name != 'local' and (d / 'building.json').exists():
                out.append('_test/' + d.name)
        if with_local and (t / 'local').is_dir():
            for d in sorted((t / 'local').iterdir()):
                if (d / 'building.json').exists():
                    out.append('_test/local/' + d.name)
    return out


def rel(from_dir, target):
    """Относительный адрес от папки страницы (например 'beta/kukuruznik/') до пути на сайте ('kukuruznik/frames/')."""
    r = posixpath.relpath('/' + target.strip('/'), '/' + from_dir.strip('/'))
    if target.endswith('/'):
        return './' if r == '.' else r + '/'
    return r


def site_path(bdir, p):
    """Адрес из building.json (относительно папки здания) -> путь от корня сайта."""
    return posixpath.normpath(posixpath.join(bdir, p)) + ('/' if p.endswith('/') else '')


def visible_frames(b):
    """Кадры здания без скрытых (hidden: true): все списки «по кадрам» в CONFIG строятся только из них — номер кадра везде один."""
    return [f for f in b['frames'] if not f.get('hidden')]


def deep_merge(base, over):
    """Переопределение чисел движка настройками здания (tuning): вложенные объекты сливаются, числа и списки заменяются."""
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            deep_merge(base[k], v)
        else:
            base[k] = copy.deepcopy(v)
    return base


DAY_KEYS = {'skyTop': 'SKY_TOP', 'skyHor': 'SKY_HOR', 'mix': 'MIX', 'greenHue': 'GREEN_HUE', 'greenPull': 'GREEN_PULL', 'greenSat': 'GREEN_SAT'}


def make_config(b, frames_url):
    """CONFIG для просмотрщика: движок (engine/config.json) + здание (building.json). Всё про здание — отсюда, в коде движка его нет."""
    C = json.loads((ENGINE / 'config.json').read_text(encoding='utf-8'))
    fr = visible_frames(b)
    look = b['look']
    day = {DAY_KEYS[k]: v for k, v in look['day'].items()}
    day['SKY_REF'] = [f['sky']['ref'] for f in fr]
    day['SKY_END'] = [f['sky']['end'] for f in fr]
    parade = [i for i, f in enumerate(fr) if f.get('parade')]
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
        'FRAMES': [frame_files(frames_url, f['name'], f.get('night', True), f.get('sunset', True)) for f in fr],
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
    if b.get('tuning'):
        deep_merge(C, b['tuning'])   # здание переопределяет любые числа движка (в том числе LOOK — внешний вид)
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


def frame_files(base, n, night=True, sunset=True):
    f = lambda s: base + n + s + '.webp'
    d = {'color': f(''), 'depth': f('_depth'), 'bg': {'color': f('_bg'), 'depth': f('_bg_depth')},
         'building': {'color': f('_building'), 'depth': f('_depth')}, 'env': f('_env'), 'win2': f('_win2')}
    if sunset:
        d['sunset'] = f('_sunset')   # нет закатной картинки — закат рисуется процедурно
    if night:
        d['night'] = f('_night')     # нет ночной — ночь процедурная, без ночных фонарей
    return d


def make_head(b, bdir, page_dir, beta):
    m = b['meta']
    e = lambda s: html.escape(s, quote=True)
    title, desc, alt = m['title']['hy'], m['description']['hy'], m['ogAlt']['hy']
    lines = ['<meta charset="utf-8">']
    if beta:
        lines += ['<meta name="robots" content="noindex, nofollow, noarchive">', '<meta name="googlebot" content="noindex, nofollow">']
    lines += [
        '<meta name="description" content="%s">' % e(desc),
        '<link rel="canonical" href="%s">' % e(m['url']),
        '<link rel="icon" type="image/png" sizes="32x32" href="%s">' % e(rel(page_dir, site_path(bdir, m['favicon']))),
        '<link rel="apple-touch-icon" href="%s">' % e(rel(page_dir, site_path(bdir, m['appleTouchIcon']))),
        '<link rel="manifest" href="manifest.json">',
        '<meta name="theme-color" content="%s">' % e(m['themeColor']),
        '<meta name="viewer-version" content="%s">' % e(m['viewerVersion']),
        '<meta name="engine-version" content="%s">' % e(engine_version()),
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Չկա">',
        '<meta property="og:url" content="%s">' % e(m['url']),
        '<meta property="og:title" content="%s">' % e(title),
        '<meta property="og:description" content="%s">' % e(desc),
    ]
    if m['ogImage']:   # картинка превью для соцсетей (у тестовых зданий её нет)
        lines += ['<meta property="og:image" content="%s">' % e(m['url'] + m['ogImage']),
                  '<meta property="og:image:type" content="image/jpeg">',
                  '<meta property="og:image:width" content="1200">',
                  '<meta property="og:image:height" content="630">',
                  '<meta property="og:image:alt" content="%s">' % e(alt)]
    lines += ['<meta property="og:locale" content="hy_AM">',
              '<meta property="og:locale:alternate" content="ru_RU">',
              '<meta property="og:locale:alternate" content="en_US">',
              '<meta name="twitter:card" content="summary_large_image">',
              '<meta name="twitter:title" content="%s">' % e(title),
              '<meta name="twitter:description" content="%s">' % e(desc)]
    if m['ogImage']:
        lines += ['<meta name="twitter:image" content="%s">' % e(m['url'] + m['ogImage']),
                  '<meta name="twitter:image:alt" content="%s">' % e(alt)]
    return '\n'.join(lines)


def engine_version():
    return (ENGINE / 'VERSION').read_text(encoding='utf-8').strip()


def history_section(b, bdir, page_dir):
    h = b['links']['history']
    if not h:   # у здания нет страницы истории — кнопки в панели нет
        return ''
    return '    <section class="p-sec"><a class="p-btn p-history" id="historyLink" href="%s" data-i18n="history">История здания ›</a></section>' % html.escape(rel(page_dir, site_path(bdir, h)), quote=True)


def make_manifest(b, bdir, page_dir):
    """manifest.json страницы здания («на экран Домой»): цвет фона и темы — цвет бумаги (решение плана), значки — из папки здания."""
    m, bid, app = b['meta'], bdir, b['app']
    icon = lambda p: rel(page_dir, site_path(bid, p))
    return json.dumps({
        'name': app['name'], 'short_name': app['shortName'], 'description': m['description']['hy'],
        'start_url': './', 'scope': './', 'display': 'standalone', 'orientation': 'portrait',
        'background_color': m['themeColor'], 'theme_color': m['themeColor'],
        'icons': [{'src': icon(m['appleTouchIcon']), 'sizes': '180x180', 'type': 'image/png', 'purpose': 'any'},
                  {'src': icon(m['appleTouchIcon']), 'sizes': '180x180', 'type': 'image/png', 'purpose': 'maskable'},
                  {'src': icon(m['favicon']), 'sizes': '32x32', 'type': 'image/png'}],
    }, ensure_ascii=False, indent=2) + '\n'


def render(b, bdir, page_dir, engine_dir, beta):
    """HTML страницы здания. page_dir/engine_dir — пути от корня сайта ('beta/kukuruznik/', 'beta/engine/')."""
    bid = bdir
    t = (ENGINE / 'page.html').read_text(encoding='utf-8')
    cfg = make_config(b, rel(page_dir, site_path(bid, b['framesDir'])))
    js = json.dumps(cfg, ensure_ascii=False, indent=1).replace('</', '<\\/')
    esc = lambda s: html.escape(s, quote=True)
    rep = {
        '{{HEAD}}': make_head(b, bdir, page_dir, beta),
        '{{TITLE}}': esc(b['meta']['title']['hy']),
        '{{CONFIG}}': js,
        '{{E}}': rel(page_dir, engine_dir),
        '{{V}}': engine_version(),
        '{{HOME}}': esc(rel(page_dir, site_path(bid, b['links']['home']))),
        '{{HISTORY_SECTION}}': history_section(b, bdir, page_dir),
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


def check_buildings(bdirs, site, root=None):
    """Проверка настроек ВСЕХ зданий перед сборкой. Любая ошибка — сборка останавливается, все ошибки печатаются по-русски."""
    errors = []
    for bd in bdirs:
        errors += building_schema.validate(bd, load_building(bd, root), site)
    if errors:
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: ошибки в настройках зданий (%d):\n  • %s' % (len(errors), '\n  • '.join(errors)))


def build_beta(site, bdirs=None, root=None, with_local=False):
    """Собирает бету в корне сайта site. Возвращает список записанных файлов (пути от корня сайта).
    bdirs — папки зданий (по умолчанию Кукурузник + тестовые); root — откуда читать building.json (по умолчанию репозиторий)."""
    site = Path(site)
    if not (site / 'CNAME').exists():
        raise SystemExit('%s не похоже на корень сайта (нет CNAME)' % site)
    bdirs = list(bdirs or default_buildings(root, with_local))
    for bd in bdirs:   # здания только для Mac: кадры лежат рядом с настройками — кладём их во временную копию сайта (не в beta/, в git не идут)
        if bd.startswith(LOCAL_DIR + '/'):
            src = Path(root or ROOT) / bd / 'frames'
            if src.is_dir():
                shutil.copytree(src, site / bd / 'frames', dirs_exist_ok=True)
    check_buildings(bdirs, site, root)   # ошибки настроек — до любой записи
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
    for bd in bdirs:
        b = load_building(bd, root)
        page_dir = 'beta/%s/' % bd
        out = site / page_dir / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render(b, bd, page_dir, 'beta/engine/', beta=True), encoding='utf-8')
        written.append(str(out.relative_to(site)))
        (out.parent / 'manifest.json').write_text(make_manifest(b, bd, page_dir), encoding='utf-8')
        written.append(str((out.parent / 'manifest.json').relative_to(site)))
    first = load_building(bdirs[0], root)
    # beta/ перенаправляет на первое здание (Кукурузник); тестовые здания нигде не упоминаются и ни откуда не связаны
    (beta / 'index.html').write_text(BETA_INDEX % {'target': bdirs[0] + '/', 'icon': rel('beta/', site_path(bdirs[0], first['meta']['favicon']))}, encoding='utf-8')
    written.append('beta/index.html')
    return written


def verify(site, bid='kukuruznik'):
    """Сверка: CONFIG из building.json + engine/config.json (с адресами кадров как на живой странице) == CONFIG живой страницы.
    Ключ LOOK и STAR_CELLS появились в движке после живой страницы (этап 4) — их в живом CONFIG нет; остальное сравнивается."""
    import subprocess
    live = (Path(site) / bid / 'index.html').read_text(encoding='utf-8')
    a = live.index('var CONFIG = {')
    b = live.index('/* ====================================================', a)
    js = live[a:b] + '\nprocess.stdout.write(JSON.stringify(CONFIG));\n'
    r = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('node: ' + r.stderr)
    live_cfg = json.loads(r.stdout)
    bb = load_building(bid)
    built = make_config(bb, bb['framesDir'])
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
    ap.add_argument('--with-local', action='store_true', help='добавить здания только для Mac (_test/local/*): в git и в публикацию не идут')
    ap.add_argument('--check-only', action='store_true', help='только проверить настройки зданий, ничего не собирать')
    args = ap.parse_args()
    if args.check_only:
        check_buildings(default_buildings(with_local=args.with_local), args.site)
        print('настройки зданий в порядке: %s' % ', '.join(default_buildings(with_local=args.with_local)))
        return
    if args.verify:
        print('CONFIG совпадает с живым: %d ключей' % verify(args.site))
    for p in build_beta(args.site, with_local=args.with_local):
        print('  ', p)


if __name__ == '__main__':
    main()
