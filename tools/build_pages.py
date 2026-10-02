#!/usr/bin/env python3
"""Сборка страниц зданий из движка (docs/ENGINE-PLAN.md, п.3–4).

Страница здания = шаблон движка (engine/page.html) + числа и тексты движка (engine/config.json)
                  + настройки здания (<здание>/building.json).
Настройки вшиваются в страницу (как раньше CONFIG): страница не скачивает json при открытии — нет лишнего запроса
до приветствия, а превью в соцсетях видит заголовок и картинку (соцсети JS не выполняют).

  python3 tools/build_pages.py --site DIR               # собрать всё в корне сайта DIR (например, временный worktree main): бету + живые здания
  python3 tools/build_pages.py --site DIR --beta-only   # только бету (живые здания и engine/ не трогает)
  python3 tools/build_pages.py --site DIR --live-only   # только живые здания на живом engine/ (движок на сайте не меняется)

Живые здания (этап 5): <здание>/index.html = шаблон + building.json на ЖИВОМ движке engine/ (адреса ../engine/…?v=<версия>),
плюс <здание>/manifest.json. Живой engine/ ставится только из проверенной беты (beta/engine/ → engine/; это делает
tools/publish_engine.py). Сборка живых зданий без смены движка требует, чтобы engine/ на сайте совпадал с исходником.

Что делает для беты (живой /kukuruznik/ и /engine/ не трогает):
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
LOCAL_DIR = 'tests/local'   # здания только для Mac (в git не идут): tests/local/<имя>/building.json + frames/


def load_building(bdir, root=None):
    """building.json здания из папки bdir (например 'kukuruznik' или 'tests/test-1'). Ошибка чтения — понятным текстом."""
    f = Path(root or ROOT) / bdir / 'building.json'
    try:
        b = json.loads(f.read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: нет файла настроек %s/building.json' % bdir)
    except json.JSONDecodeError as e:
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: %s/building.json не читается как JSON (строка %d, символ %d): %s' % (bdir, e.lineno, e.colno, e.msg))
    return b


def default_buildings(root=None, with_local=False):
    """Здания беты: Кукурузник + тестовые (tests/*/building.json в git) [+ локальные для Mac]. Первое — куда ведёт beta/."""
    root = Path(root or ROOT)
    out = ['kukuruznik']
    t = root / 'tests'
    if t.is_dir():
        for d in sorted(t.iterdir()):
            if d.name != 'local' and (d / 'building.json').exists():
                out.append('tests/' + d.name)
        if with_local and (t / 'local').is_dir():
            for d in sorted((t / 'local').iterdir()):
                if (d / 'building.json').exists():
                    out.append('tests/local/' + d.name)
    return out


def own_frames(bd, root=None):
    """У тестового здания в git лежат СВОИ кадры (tests/<имя>/frames/*.webp) — на сайт они идут в beta/<здание>/frames/ (чтобы попасть в коммит беты).
    Остальные здания берут кадры с живого сайта (Кукурузник, тесты 1–2) или лежат только на Mac (tests/local)."""
    if not bd.startswith('tests/') or bd.startswith(LOCAL_DIR + '/'):
        return False
    f = Path(root or ROOT) / bd / 'frames'
    return f.is_dir() and any(f.glob('*.webp'))


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
        'PARADE_STYLES': [('planes' if f.get('parade') is True else f['parade']) if f.get('parade') else None for f in fr],   # e1.3: свой парад на каждом кадре
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


def make_head(b, bdir, page_dir, beta, version=None):
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
        '<meta name="engine-version" content="%s">' % e(version or engine_version()),
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


def history_section(b, bdir, page_dir, own=False):
    h = b['links']['history']
    if not h:   # у здания нет страницы истории — кнопки в панели нет
        return ''
    # тестовое здание со своими файлами (own_frames): страница истории лежит рядом со страницей беты (copy_own_pages)
    target = posixpath.normpath(posixpath.join(page_dir, h)) if own else site_path(bdir, h)
    return '    <section class="p-sec"><a class="p-btn p-history" id="historyLink" href="%s" data-i18n="history">История здания ›</a></section>' % html.escape(rel(page_dir, target), quote=True)


OWN_PAGES = ('about.html', 'history.html')   # страницы «архив и хроника» и «история» тестового здания (tests/<имя>/), если есть


def copy_own_pages(bd, out_dir, page_dir, root=None):
    """Тестовое здание со своими файлами: about.html, history.html и gallery/*.webp из tests/<имя>/ — рядом со страницей беты
    (beta/tests/<имя>/). В страницах адреса от корня сайта написаны от папки здания (../../assets/…) — пересчитываются для беты.
    Возвращает список записанных файлов (пути от out_dir)."""
    src = Path(root or ROOT) / bd
    repo_root = posixpath.relpath('/', '/' + bd.strip('/')) + '/'          # tests/lenin -> ../../
    site_root = posixpath.relpath('/', '/' + page_dir.strip('/')) + '/'    # beta/tests/lenin/ -> ../../../
    out = []
    for name in OWN_PAGES:
        f = src / name
        if f.is_file():
            t = f.read_text(encoding='utf-8')
            t = re.sub(r'((?:href|src)=")' + re.escape(repo_root), lambda m: m.group(1) + site_root, t)
            (out_dir / name).write_text(t, encoding='utf-8')
            out.append(name)
    g = src / 'gallery'
    if g.is_dir():
        for f in sorted(g.glob('*.webp')):
            dst = out_dir / 'gallery' / f.name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, dst)
            out.append('gallery/' + f.name)
    return out


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


def render(b, bdir, page_dir, engine_dir, beta, version=None, own_frames=False):
    """HTML страницы здания. page_dir/engine_dir — пути от корня сайта ('beta/kukuruznik/', 'beta/engine/').
    version — версия движка для ?v= в адресах (по умолчанию engine/VERSION исходника)."""
    version = version or engine_version()
    bid = bdir
    t = (ENGINE / 'page.html').read_text(encoding='utf-8')
    frames_to = posixpath.normpath(posixpath.join(page_dir, b['framesDir'])) + '/' if own_frames else site_path(bid, b['framesDir'])   # свои кадры лежат рядом со страницей беты
    cfg = make_config(b, rel(page_dir, frames_to))
    js = json.dumps(cfg, ensure_ascii=False, indent=1).replace('</', '<\\/')
    esc = lambda s: html.escape(s, quote=True)
    rep = {
        '{{HEAD}}': make_head(b, bdir, page_dir, beta, version),
        '{{TITLE}}': esc(b['meta']['title']['hy']),
        '{{CONFIG}}': js,
        '{{E}}': rel(page_dir, engine_dir),
        '{{V}}': version,
        '{{HOME}}': esc(rel(page_dir, site_path(bid, b['links']['home']))),
        '{{HISTORY_SECTION}}': history_section(b, bdir, page_dir, own=own_frames),
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
    own = [bd for bd in bdirs if own_frames(bd, root)]
    same = lambda bd: (site / bd / 'frames').resolve() == (Path(root or ROOT) / bd / 'frames').resolve()   # site = сам репозиторий: ничего не копировать и не убирать
    for bd in own:
        if same(bd):
            continue
        # свои кадры тестового здания: временно на место, где их ждёт проверялщик настроек (после сборки уберём — коммитится только beta/)
        shutil.copytree(Path(root or ROOT) / bd / 'frames', site / bd / 'frames', dirs_exist_ok=True)
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
        out.write_text(render(b, bd, page_dir, 'beta/engine/', beta=True, own_frames=bd in own), encoding='utf-8')
        written.append(str(out.relative_to(site)))
        if bd in own:   # кадры здания — рядом со страницей: beta/tests/<имя>/frames/*.webp
            for src in sorted((Path(root or ROOT) / bd / 'frames').glob('*.webp')):
                dst = out.parent / 'frames' / src.name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
                written.append(str(dst.relative_to(site)))
            for name in copy_own_pages(bd, out.parent, page_dir, root):   # архив/история здания, если есть
                written.append(str((out.parent / name).relative_to(site)))
        (out.parent / 'manifest.json').write_text(make_manifest(b, bd, page_dir), encoding='utf-8')
        written.append(str((out.parent / 'manifest.json').relative_to(site)))
    for bd in own:   # временная копия кадров для проверялщика больше не нужна
        if not same(bd):
            shutil.rmtree(site / bd / 'frames', ignore_errors=True)
            for d in (site / bd, (site / bd).parent):   # пустые папки tests/<имя>/ и tests/ не оставляем
                try:
                    d.rmdir()
                except OSError:
                    pass
    first = load_building(bdirs[0], root)
    # beta/ перенаправляет на первое здание (Кукурузник); тестовые здания нигде не упоминаются и ни откуда не связаны
    (beta / 'index.html').write_text(BETA_INDEX % {'target': bdirs[0] + '/', 'icon': rel('beta/', site_path(bdirs[0], first['meta']['favicon']))}, encoding='utf-8')
    written.append('beta/index.html')
    return written


ENGINE_SKIP = ('page.html', 'config.json')   # шаблон и числа движка вшиваются в страницы — на сайт отдельно не кладутся


def engine_files(d):
    """Файлы движка в папке d (исходник engine/ или engine/ на сайте): {относительный путь: байты}, без шаблона и config.json."""
    d = Path(d)
    return {str(f.relative_to(d)): f.read_bytes() for f in sorted(d.rglob('*'))
            if f.is_file() and not f.name.startswith('.') and f.name not in ENGINE_SKIP}


def live_vs_beta(site, bdirs):
    """Живое здание == проверенная бета, побайтно после замены адресов (docs/ENGINE-PLAN.md, этап 5).
    Проверяет в собранной копии сайта: движок engine/ == beta/engine/; <здание>/index.html и manifest.json == beta/<здание>/… с тремя
    неизбежными отличиями беты — адреса ../../<здание>/ → ./, ../../ → ../ и два тега noindex (robots, googlebot). Возвращает список проблем (пусто — равны).
    Это замена пиксельному сравнению «живое ⇄ бета»: check_site снимает цели с разным зерном случайности (облака, птицы), поэтому
    строго, пиксель в пиксель, живое и бета в одном прогоне не совпадают, а байты страниц — совпадают или нет однозначно."""
    site = Path(site)
    bad = []
    if engine_files(site / 'engine') != engine_files(site / 'beta' / 'engine'):
        bad.append('engine/ не равен beta/engine/')
    for bd in bdirs:
        for name in ('index.html', 'manifest.json'):
            live = (site / bd / name).read_text(encoding='utf-8')
            beta = (site / 'beta' / bd / name).read_text(encoding='utf-8')
            beta = re.sub(r'^[ \t]*<meta name="(?:robots|googlebot)" content="noindex[^>]*>\n', '', beta, flags=re.M)
            beta = beta.replace('../../%s/' % bd, '').replace('../../', '../')
            if live != beta:
                la, lb = live.splitlines(), beta.splitlines()
                n = next((i for i in range(min(len(la), len(lb))) if la[i] != lb[i]), min(len(la), len(lb)))
                bad.append('%s/%s: живая страница не равна бете (первое отличие — строка %d)' % (bd, name, n + 1))
    return bad


_DEP_TOKEN = re.compile(r"[A-Za-z0-9_./~%@+-]+\.(?:html|js|mjs|css|json|webp|png|jpe?g|svg|gif|ico|woff2?|ttf|mp3|ogg|wav|m4a|mp4|webm|txt|webmanifest)\b")
_DEP_TEXT = ('.html', '.js', '.mjs', '.css', '.json', '.webmanifest')


def page_deps(site, page):
    """Все файлы сайта, от которых может зависеть страница page (путь от корня site): сама страница и всё, что на неё ссылается
    транзитивно (html, css, js, json). Консервативно: берутся ВСЕ строки, похожие на путь к файлу с известным расширением, и считаются
    относительно папки файла-владельца и папки страницы (так браузер разрешает адреса из скриптов); существующие файлы — зависимости."""
    site = Path(site).resolve()
    page = (site / page).resolve()
    seen, todo = set(), [page]
    while todo:
        f = todo.pop()
        if f in seen or not f.is_file():
            continue
        seen.add(f)
        if f.suffix.lower() not in _DEP_TEXT:
            continue
        text = f.read_text(encoding='utf-8', errors='ignore')
        for m in _DEP_TOKEN.finditer(text):
            tok = m.group(0)
            if re.search(r'https?://[^\s"\'()<>]*$', text[max(0, m.start() - 300):m.end()]):
                continue   # внешний адрес
            bases = [site] if tok.startswith('/') else [f.parent, page.parent]
            for base in bases:
                cand = (base / tok.lstrip('/').split('?')[0]).resolve()
                if site in cand.parents and cand.is_file():
                    todo.append(cand)
    return {str(x.relative_to(site)) for x in seen}


def site_pages(site):
    """Все html-страницы сайта (пути от корня site), кроме служебных папок (docs, tools, test-assets, …)."""
    site = Path(site)
    return sorted(str(f.relative_to(site)) for f in site.rglob('*.html')
                  if 'node_modules' not in f.parts and '.git' not in f.parts and f.relative_to(site).parts[0] not in ('docs', 'tools', 'test-assets', 'src', 'engine3d'))


def untouched_problems(site, changed, exempt_pages):
    """Режим publish_engine --expect-change: у каждой страницы сайта, КРОМЕ exempt_pages (их картинка меняется намеренно и сверяется
    проверкой check_site), ни сама страница, ни один файл, от которого она зависит (page_deps, включая engine/ и beta/engine/),
    не входит в changed — список файлов, которые эта публикация меняет относительно origin/main. Пиксели у таких страниц не снимаются:
    побайтное равенство файлов точнее и не зависит от шума растеризации. Возвращает список проблем (пусто — всё нетронуто)."""
    site, changed, bad = Path(site), set(changed), []
    for pg in site_pages(site):
        if pg in exempt_pages:
            continue
        hit = sorted(page_deps(site, pg) & changed)
        if hit:
            bad.append('%s зависит от файлов, которые эта публикация меняет: %s' % (pg, ', '.join(hit[:4]) + ('…' if len(hit) > 4 else '')))
    return bad


def check_id(page):
    """Страница сайта -> id цели в tools/check_site.mjs: 'beta/tests/lenin/index.html' -> 'beta/tests/lenin', 'kukuruznik/history.html' -> 'kukuruznik/history'."""
    if page == 'index.html':
        return ''
    return page[:-len('/index.html')] if page.endswith('/index.html') else page[:-len('.html')]


def changed_targets(site, changed, tracked, allowed_prefix='beta/'):
    """Режим publish_beta --expect-change: какие страницы эта публикация меняет — сама страница или любой файл, от которого она зависит (page_deps),
    входит в changed (файлы, отличающиеся от origin/main: изменённые, новые). Остальные страницы по определению побайтно как на main.
    tracked — файлы origin/main: страница, которой там нет, — новая цель. Возвращает (ids, new_ids, problems):
      ids      — id целей check_site, у которых пиксели снимаются (изменяемые и новые), только страницы под allowed_prefix;
      new_ids  — из них новые (их на сайте ещё нет);
      problems — страницы ВНЕ allowed_prefix, которые публикация меняет (хаб, живые здания, about/history, 404…): любое — КРАСНАЯ до check_site."""
    site, changed, tracked = Path(site), set(changed), set(tracked)
    ids, new_ids, problems = set(), set(), []
    for pg in site_pages(site):
        hit = sorted(({pg} & changed) | (page_deps(site, pg) & changed))
        if not hit:
            continue
        if not pg.startswith(allowed_prefix):
            problems.append('%s должна остаться как на main, но публикация меняет: %s' % (pg, ', '.join(hit[:4]) + ('…' if len(hit) > 4 else '')))
            continue
        ids.add(check_id(pg))
        if pg not in tracked:
            new_ids.add(check_id(pg))
    return sorted(ids), sorted(new_ids), problems


def head_changes(old_html, new_html):
    """Что в <head> страницы изменилось (превью в соцсетях, поисковики, иконки, адрес, язык). Версия движка (?v=…, engine-version) не считается.
    Возвращает список строк «было → стало»; пусто — шапка прежняя."""
    def tags(h):
        m = re.search(r'<head[^>]*>(.*?)</head>', h, re.S)
        found = re.findall(r'<(?:meta|link|title)\b[^>]*>(?:[^<]*</title>)?', m.group(1) if m else '')
        out = []
        for t in found:
            if 'name="engine-version"' in t:
                continue
            out.append(re.sub(r'\?v=[^"&\']*', '', t))
        lang = re.search(r'<html[^>]*\blang="([^"]*)"', h)
        return sorted(out) + ['<html lang=%s>' % (lang.group(1) if lang else '')]
    a, b = tags(old_html), tags(new_html)
    return ['было: %s' % t for t in a if t not in b] + ['стало: %s' % t for t in b if t not in a]


def live_buildings(root=None):
    """Живые здания: папки в корне репозитория с building.json (tests/ — только бета)."""
    root = Path(root or ROOT)
    return sorted(d.name for d in root.iterdir() if d.is_dir() and not d.name.startswith('.') and d.name != 'tests' and (d / 'building.json').exists())


def build_live(site, bdirs=None, engine_from=None, root=None):
    """Живые здания на живом движке (docs/ENGINE-PLAN.md, п.4, этап 5). Возвращает список записанных файлов.
    engine_from — папка, из которой ставится <site>/engine/ целиком (publish_engine: проверенный beta/engine/ с сайта).
    Без engine_from движок на сайте не трогается и ОБЯЗАН совпадать с исходником engine/ побайтно — иначе страница, собранная
    по новому шаблону, встретит старый движок (стоп с объяснением)."""
    site = Path(site)
    if not (site / 'CNAME').exists():
        raise SystemExit('%s не похоже на корень сайта (нет CNAME)' % site)
    bdirs = list(bdirs or live_buildings(root))
    check_buildings(bdirs, site, root)   # ошибки настроек — до любой записи
    live = site / 'engine'
    written = []
    if engine_from:
        src = engine_files(engine_from)
        if not src:
            raise SystemExit('СБОРКА ОСТАНОВЛЕНА: движок %s пуст' % engine_from)
        if live.exists():   # src уже прочитан в память: engine_from может лежать внутри site
            shutil.rmtree(live)
        for rp, data in src.items():
            dst = live / rp
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)
            written.append(str(dst.relative_to(site)))
    if not (live / 'VERSION').exists():
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: на сайте нет движка engine/ (сначала tools/publish_engine.py)')
    if engine_files(live) != engine_files(ENGINE):
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: движок на сайте (engine/, %s) не совпадает с исходником engine/ (%s). Новый движок идёт на живые '
                         'здания только через бету: tools/publish_beta.py → проверка на телефоне → tools/publish_engine.py.'
                         % ((live / 'VERSION').read_text(encoding='utf-8').strip(), engine_version()))
    version = (live / 'VERSION').read_text(encoding='utf-8').strip()
    for bd in bdirs:
        b = load_building(bd, root)
        page_dir = '%s/' % bd
        out = site / page_dir / 'index.html'
        out.write_text(render(b, bd, page_dir, 'engine/', beta=False, version=version), encoding='utf-8')
        written.append(str(out.relative_to(site)))
        (out.parent / 'manifest.json').write_text(make_manifest(b, bd, page_dir), encoding='utf-8')
        written.append(str((out.parent / 'manifest.json').relative_to(site)))
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
    ap = argparse.ArgumentParser(description='Сборка страниц зданий из движка: бета на beta/engine/, живые здания на engine/.')
    ap.add_argument('--site', required=True, help='корень сайта (папка с CNAME), куда собирать')
    ap.add_argument('--verify', action='store_true', help='сверить собранный CONFIG с живой страницей здания')
    ap.add_argument('--with-local', action='store_true', help='добавить здания только для Mac (tests/local/*): в git и в публикацию не идут')
    ap.add_argument('--check-only', action='store_true', help='только проверить настройки зданий, ничего не собирать')
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--beta-only', action='store_true', help='только бета (beta/)')
    g.add_argument('--live-only', action='store_true', help='только живые здания на уже стоящем engine/ (движок не меняется)')
    args = ap.parse_args()
    if args.check_only:
        check_buildings(default_buildings(with_local=args.with_local), args.site)
        print('настройки зданий в порядке: %s' % ', '.join(default_buildings(with_local=args.with_local)))
        return
    if args.verify:
        print('CONFIG совпадает с живым: %d ключей' % verify(args.site))
    files = []
    if not args.live_only:
        files += build_beta(args.site, with_local=args.with_local)
    if not args.beta_only:   # живой движок = только что собранный beta/engine/ (при --live-only — тот, что уже стоит на сайте)
        files += build_live(args.site, engine_from=None if args.live_only else Path(args.site) / 'beta' / 'engine')
    for p in files:
        print('  ', p)


if __name__ == '__main__':
    main()
