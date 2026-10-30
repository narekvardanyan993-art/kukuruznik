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
import hashlib
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


_HASH_CACHE = {}


def file_hash(path):
    """Короткий хэш содержимого файла (8 знаков sha1) для ?v= в адресах: Safari/iOS держит картинки и маски в кэше по адресу, а не по
    содержимому — новый файл с прежним именем без смены адреса остаётся старым (s24). Нет файла — None."""
    p = Path(path)
    try:
        st = p.stat()
    except OSError:
        return None
    if not p.is_file():
        return None
    key = (str(p), st.st_size, st.st_mtime_ns)
    if key not in _HASH_CACHE:
        _HASH_CACHE[key] = hashlib.sha1(p.read_bytes()).hexdigest()[:8]
    return _HASH_CACHE[key]


def video_hash(mp4):
    """Хэш ролика синемаграфа: mp4 и его запасной webm (движок без H.264 берёт .webm) — любое из двух изменилось, ?v другой."""
    h1 = file_hash(mp4)
    h2 = file_hash(Path(mp4).with_suffix('.webm')) if h1 else None
    return hashlib.sha1((h1 + h2).encode()).hexdigest()[:8] if h1 and h2 else h1


def make_stamper(page_dir, site=None, mounts=()):
    """stamp(url) -> url + '?v=<хэш файла>' для адреса относительно страницы page_dir (путь от корня сайта, например 'beta/tests/lenin/').
    Файл ищется: сначала в mounts [(префикс пути на сайте, папка с исходниками)] — свои кадры тестового здания в beta/ ещё не скопированы,
    они лежат в репозитории; потом в корне сайта site. Файла нет (бета без живых кадров, заглушки) — адрес без изменений. Адрес с ? или # не трогаем.
    Ролики .mp4 (s25) — хэш пары mp4+webm (video_hash); движок срезает ?v перед заменой .mp4 → .webm (viewer.js, mvSetClip)."""
    def stamp(url):
        if '?' in url or '#' in url:
            return url
        sp = posixpath.normpath(posixpath.join(page_dir, url))
        path = None
        for prefix, d in mounts:
            if sp.startswith(prefix):
                path = Path(d) / sp[len(prefix):]
                break
        else:
            path = Path(site) / sp if site else None
        if path is None:
            return url
        h = video_hash(path) if path.suffix == '.mp4' else file_hash(path)
        return url + '?v=' + h if h else url
    return stamp


def stamp_tree(o, stamp):
    """Все строки-адреса внутри вложенных словарей/списков (адреса кадров в CONFIG.FRAMES) -> со ?v=<хэш>."""
    if isinstance(o, dict):
        return {k: stamp_tree(v, stamp) for k, v in o.items()}
    if isinstance(o, list):
        return [stamp_tree(v, stamp) for v in o]
    return stamp(o) if isinstance(o, str) else o


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


def make_config(b, frames_url, stamp=None):
    """CONFIG для просмотрщика: движок (engine/config.json) + здание (building.json). Всё про здание — отсюда, в коде движка его нет.
    stamp — функция адрес -> адрес со ?v=<хэш файла> (s24): ею проходят адреса кадров, масок снега/качания/фигур и маски синемаграфа;
    без неё (verify, publish_kukuruznik) адреса прежние. Ролики (motionVideo.clips[].src, s25) — тоже со ?v=<хэш mp4+webm>: движок (viewer.js, mvSetClip) срезает запрос перед заменой .mp4 → .webm."""
    C = json.loads((ENGINE / 'config.json').read_text(encoding='utf-8'))
    fr = visible_frames(b)
    look = b['look']
    day = {DAY_KEYS[k]: v for k, v in look['day'].items()}
    day['SKY_REF'] = [f['sky']['ref'] for f in fr]
    day['SKY_END'] = [f['sky']['end'] for f in fr]
    parade = [i for i, f in enumerate(fr) if f.get('parade')]
    if look.get('showNight'):   # e1.13: шоу ночью ярче (только если задано у здания)
        C['SHOW_NIGHT'] = look['showNight']
    if look.get('nightEdge'):   # e1.14: край вырезки здания ночью (только если задан у здания)
        C['NIGHT_EDGE'] = look['nightEdge']
    if look.get('bronzeKeep'):   # e1.24 (s20): бронза статуи не тянется к зелени дневной обработкой (только если задано у здания)
        C['BRONZE_KEEP'] = True
    if look.get('snow'):   # e1.25 (s22): снег по маскам кадров, копится/тает плавно (только если задано у здания)
        C['SNOW'] = look['snow']
    if look.get('gusts'):   # e1.25 (s22): ветер порывами (только если задано у здания)
        C['GUSTS'] = look['gusts']
    if any(f.get('figures') for f in fr):   # e1.22: фигуры рисунка (только если заданы у кадров — у остальных зданий CONFIG тот же)
        C['FIGURES'] = [f.get('figures') for f in fr]
    if any(f.get('poses') for f in fr):   # e1.44: позы фигур рисунка (только если заданы у кадров — у остальных зданий CONFIG тот же)
        C['POSES'] = [f.get('poses') for f in fr]
    if any(f.get('tiltK') is not None for f in fr):   # e1.43: своя сила наклона кадра (только если задана — у остальных зданий CONFIG тот же)
        C['TILT_K'] = [f.get('tiltK', 1) for f in fr]
    if look.get('noon'):   # e1.43: нейтральный дневной свет (только если задан у здания)
        C['NOON'] = dict(look['noon'], K=[f.get('noon', 1) for f in fr])
    if any(f.get('wx') for f in fr):   # e1.48: погода кадра [пасмурно, туман, мокро, снег на земле, частицы] (только если задана у кадров)
        C['WX_FRAME'] = [list((f.get('wx') or {}).get('k', [1, 1, 1, 1])) + [1 if (f.get('wx') or {}).get('particles', True) else 0] for f in fr]
    if any(f.get('pix') for f in fr):   # e1.40: живость из самого рисунка (только если задана у кадров — у остальных зданий CONFIG тот же)
        C['PIX'] = [f.get('pix') or [] for f in fr]
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
        'FRAMES': [dict(stamp_tree(dict(frame_files(frames_url, f['name'], f.get('night', True), f.get('sunset', True)), **({'fig': frames_url + f['name'] + '_fig.png'} if f.get('figures') else {}), **({'snow': frames_url + f['name'] + '_snow.webp'} if f.get('snowMask') else {}), **({'sway': frames_url + f['name'] + '_sway.png'} if f.get('sway') else {})), stamp or (lambda u: u)), **({'depthRaw': True} if f.get('depthRaw') else {})) for f in fr],
        'HOTSPOTS': [f['hotspots'] for f in fr],
        'CROP': [f['crop'] for f in fr],
        'FLAGS': [f['flag'] or [0, 0, 0, 0] for f in fr],
        'NIGHT_HALO': [f['nightHalo'] for f in fr],
        'NIGHT_LAMPS': [f['nightLamps'] for f in fr],
        'LAMPS': [f['lamps'] for f in fr],
        'SCENE': [scene(f, (lambda n: n + stamp(frames_url + n)[len(frames_url + n):]) if stamp else None) for f in fr],
        'PARADE_FRAME': parade[0] if parade else -1,
        'PARADE_STYLES': [('planes' if f.get('parade') is True else f['parade']) if f.get('parade') else None for f in fr],   # e1.3: свой парад на каждом кадре
        'ABOUT_FACTS': b['aboutFacts'],
        'POSTCARD_FILE': b['postcardFile'],
        'POSTCARD': b.get('postcard'),   # e1.27: табличка открытки «в сторис» (название, годы, chka.am/<здание>)
        'I18N': b['facts'],
    })
    ui = dict(C['UI_I18N'])
    ui.update(b['text'])
    C['UI_I18N'] = ui
    if b.get('tuning'):
        deep_merge(C, b['tuning'])   # здание переопределяет любые числа движка (в том числе LOOK — внешний вид)
    return C


def scene(f, stamp_name=None):
    """Живые детали кадра (details.js): что летает, небо, облака, солнце/луна, газон, крупный план."""
    sky, sun = f['sky'], f['sun']
    sc = {'life': f['life'], 'skyBand': sky['band'], 'clouds': sky['clouds'], 'sunDay': sun['day'], 'sunSet': sun['sunset'],
          'moon': sun['moon'], 'lawn': f.get('lawn'), 'closeUp': f.get('closeUp')}
    if 'cloudScale' in sky:
        sc['cloudScale'] = sky['cloudScale']
    for k in ('bldDepth', 'showBand', 'fountains', 'ambient', 'skyBirds', 'nightWins', 'motionVideo', 'fx', 'spriteSnow', 'snowFall', 'leafFly'):   # e1.46: snowFall — снегопад картинками Gemini при погоде «снег»
            # e1.41: spriteSnow — редкий снег картинками Gemini
          # e1.37: fx — шоу кадра из деталей (details.js stepFx)   # e1.5: только если заданы у кадра — у остальных зданий настройки страницы не меняются
        if k in f:
            sc[k] = f[k]
    if stamp_name and isinstance(sc.get('motionVideo'), dict) and sc['motionVideo'].get('mask'):   # s24: маска синемаграфа — со ?v=<хэш> (движок берёт base + mask)
        mv = dict(sc['motionVideo'], mask=stamp_name(sc['motionVideo']['mask']))
        if mv.get('src'):   # s25: ролики (clips[].src и старое src) — ?v=<хэш mp4+webm>; движок (mvSetClip) срезает запрос перед .mp4 → .webm и возвращает его
            mv['src'] = stamp_name(mv['src'])
        if mv.get('clips'):
            mv['clips'] = [dict(c, src=stamp_name(c['src'])) if c.get('src') else c for c in mv['clips']]
        sc['motionVideo'] = mv
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


def render(b, bdir, page_dir, engine_dir, beta, version=None, own_frames=False, site=None, root=None):
    """HTML страницы здания. page_dir/engine_dir — пути от корня сайта ('beta/kukuruznik/', 'beta/engine/').
    version — версия движка для ?v= в адресах (по умолчанию engine/VERSION исходника)."""
    version = version or engine_version()
    bid = bdir
    t = (ENGINE / 'page.html').read_text(encoding='utf-8')
    frames_to = posixpath.normpath(posixpath.join(page_dir, b['framesDir'])) + '/' if own_frames else site_path(bid, b['framesDir'])   # свои кадры лежат рядом со страницей беты
    mounts = [(posixpath.normpath(frames_to) + '/', Path(root or ROOT) / bdir / b['framesDir'])] if own_frames else []   # свои кадры беты ещё не скопированы — берём из репозитория
    cfg = make_config(b, rel(page_dir, frames_to), make_stamper(page_dir, site, mounts))   # s24: адреса кадров и масок со ?v=<хэш файла> (кэш Safari)
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
        out.write_text(render(b, bd, page_dir, 'beta/engine/', beta=True, own_frames=bd in own, site=site, root=root), encoding='utf-8')
        written.append(str(out.relative_to(site)))
        if bd in own:   # кадры здания — рядом со страницей: beta/tests/<имя>/frames/*.webp
            fdir = Path(root or ROOT) / bd / 'frames'   # + синемаграф (e1.13): <кадр>_motion.mp4 и маска
            for src in sorted(list(fdir.glob('*.webp')) + list(fdir.glob('*_motion*.mp4')) + list(fdir.glob('*_motion*.webm')) + list(fdir.glob('*_motion_mask.png')) + list(fdir.glob('*_fig.png')) + list(fdir.glob('*_motion*cars.json')) + list(fdir.glob('*_sway.png')) + list(fdir.glob('show_*.png'))):   # e1.15: + треки машин для ночных фар; e1.26: поля качания крон; e1.41: картинки шоу (Gemini, RGBA)
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
    tl = test_live_slugs()
    for bd in bdirs:
        if bd in tl:   # живое здание из tests/<имя>: бета лежит в beta/tests/<имя>/ с другими адресами и превью — побайтно не сравнить,
            continue   # его картинку сверяет check_site (publish_engine снимает пиксели у всех живых зданий)
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


def page_config(html_text):
    """CONFIG из собранной страницы здания (JSON, вшитый в страницу: var CONFIG = {...})."""
    a = html_text.index('var CONFIG = ') + len('var CONFIG = ')
    return json.JSONDecoder().raw_decode(html_text[a:])[0]


def live_vs_beta_config(site, slug, root=None):
    """publish_engine --with-building: живое здание из tests/<имя> == проверенная бета. Побайтно страницы не сравнить (адрес, превью, плашка у живого
    свои — блок live), поэтому: (1) CONFIG живой и бета-страницы совпадает во всём, кроме ключей, которые блок live переопределяет намеренно
    (text -> UI_I18N, frames -> FRAMES/SCENE/…); (2) файлы <slug>/frames/* побайтно равны beta/tests/<имя>/frames/*. Возвращает список проблем."""
    site = Path(site)
    tl = test_live_slugs(root)
    if slug not in tl:
        return ['нет тестового здания с live.slug = %s' % slug]
    src = tl[slug]
    over = (load_building(src, root).get('live') or {})
    allowed = set()
    if 'text' in over:
        allowed.add('UI_I18N')
    if 'frames' in over or 'look' in over or 'tuning' in over:
        allowed |= {'FRAMES', 'SCENE', 'LOOK', 'DAY'}   # живое здание намеренно рисуется иначе — сверяет check_site
    bad = []
    try:
        live = page_config((site / slug / 'index.html').read_text(encoding='utf-8'))
        beta = page_config((site / 'beta' / src / 'index.html').read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        return ['%s: страницу не прочитать (%s)' % (slug, e)]
    diff = sorted(k for k in set(live) | set(beta) if json.dumps(live.get(k), sort_keys=True) != json.dumps(beta.get(k), sort_keys=True))
    extra = [k for k in diff if k not in allowed]
    if extra:
        bad.append('%s: CONFIG живой страницы не равен бете (ключи: %s)' % (slug, ', '.join(extra)))
    lf, bf = site / slug / 'frames', site / 'beta' / src / 'frames'
    ln = {f.name for f in lf.glob('*') if f.is_file()} if lf.is_dir() else set()
    bn = {f.name for f in bf.glob('*') if f.is_file()} if bf.is_dir() else set()
    if ln != bn:
        bad.append('%s/frames: набор файлов не равен бете (только в живом: %s; только в бете: %s)' % (slug, sorted(ln - bn)[:3], sorted(bn - ln)[:3]))
    for n in sorted(ln & bn):
        if (lf / n).read_bytes() != (bf / n).read_bytes():
            bad.append('%s/frames/%s не равен бете побайтно' % (slug, n))
            break
    return bad


def place_hub_and_404(site, slug, root=None):
    """Карточка здания на главной и slug в known у 404.html — как в publish_building: главная берётся из исходника, любое её отличие от главной
    на сайте вне карточки/стопки slug — СТОП (чужие правки главной не уезжают). Возвращает ['index.html', '404.html']."""
    root, site = Path(root or ROOT), Path(site)
    new_hub = hub_with_card((root / 'index.html').read_text(encoding='utf-8'), slug, render_card(slug, root), render_stack(slug, root))   # метки обязаны быть
    old_hub = (site / 'index.html').read_text(encoding='utf-8')
    problems = hub_outside_diff(old_hub, new_hub, slug)
    if problems:
        raise SystemExit('СТОП: главная в ветке отличается от сайта не только карточкой %s:\n  • %s' % (slug, '\n  • '.join(problems)))
    (site / 'index.html').write_text(new_hub, encoding='utf-8')
    nf = site / '404.html'
    nf.write_text(with_404_known(nf.read_text(encoding='utf-8'), slug), encoding='utf-8')
    return ['index.html', '404.html']


_DEP_TOKEN = re.compile(r"[A-Za-z0-9_./~%@+-]+\.(?:html|js|mjs|css|json|webp|png|jpe?g|svg|gif|ico|woff2?|ttf|mp3|ogg|wav|m4a|mp4|webm|txt|webmanifest)\b")
_DEP_TEXT = ('.html', '.js', '.mjs', '.css', '.json', '.webmanifest')


def page_deps(site, page, stop=()):
    """Все файлы сайта, от которых может зависеть страница page (путь от корня site): сама страница и всё, что на неё ссылается
    транзитивно (html, css, js, json). Консервативно: берутся ВСЕ строки, похожие на путь к файлу с известным расширением, и считаются
    относительно папки файла-владельца и папки страницы (так браузер разрешает адреса из скриптов); существующие файлы — зависимости."""
    site = Path(site).resolve()
    page = (site / page).resolve()
    stop = {(site / s).resolve() for s in stop}   # эти файлы не считаются зависимостью и не обходятся (publish_building: главная — ссылка, а не часть страницы)
    seen, todo = set(), [page]
    while todo:
        f = todo.pop()
        if f in seen or not f.is_file() or (f in stop and f != page):
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


def untouched_problems(site, changed, exempt_pages, stop=()):
    """Режим publish_engine --expect-change: у каждой страницы сайта, КРОМЕ exempt_pages (их картинка меняется намеренно и сверяется
    проверкой check_site), ни сама страница, ни один файл, от которого она зависит (page_deps, включая engine/ и beta/engine/),
    не входит в changed — список файлов, которые эта публикация меняет относительно origin/main. Пиксели у таких страниц не снимаются:
    побайтное равенство файлов точнее и не зависит от шума растеризации. Возвращает список проблем (пусто — всё нетронуто)."""
    site, changed, bad = Path(site), set(changed), []
    for pg in site_pages(site):
        if pg in exempt_pages:
            continue
        hit = sorted(page_deps(site, pg, stop) & changed)
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


def live_buildings(root=None, site=None):
    """Живые здания (их адреса на сайте): папки в корне репозитория с building.json, плюс тестовые здания tests/<имя>/ с блоком
    "live" в building.json (переведены в живые tools/publish_building.py). site — корень сайта: тестовое здание считается живым,
    только если оно там уже опубликовано (<slug>/index.html есть) — иначе publish_engine не пытается собрать то, чего на сайте нет."""
    root = Path(root or ROOT)
    out = [d.name for d in root.iterdir() if d.is_dir() and not d.name.startswith('.') and d.name != 'tests' and (d / 'building.json').exists()]
    for slug in test_live_slugs(root):
        if slug not in out and (site is None or (Path(site) / slug / 'index.html').exists()):
            out.append(slug)
    return sorted(out)


def test_live_slugs(root=None):
    """{адрес на сайте: папка исходника} для тестовых зданий с блоком "live" (tests/lenin -> lenin)."""
    root = Path(root or ROOT)
    out = {}
    t = root / 'tests'
    if t.is_dir():
        for d in sorted(t.iterdir()):
            f = d / 'building.json'
            if d.name != 'local' and f.exists():
                b = json.loads(f.read_text(encoding='utf-8'))
                if isinstance(b.get('live'), dict):
                    out[b['live'].get('slug') or d.name] = 'tests/' + d.name
    return out


LIVE_ONLY_KEYS = ('slug',)   # служебные ключи блока live — в настройки здания не сливаются


def load_live(slug, root=None):
    """Настройки ЖИВОГО здания по адресу slug: из папки slug/ в корне репозитория или из tests/<имя>/ с блоком live
    (тогда live поверх настроек: адрес, значки, превью — всё, что на сайте лежит иначе, чем в бете). Блоки live и card в
    результат не попадают. Возвращает (папка исходника, настройки)."""
    root = Path(root or ROOT)
    if (root / slug / 'building.json').exists():
        b = load_building(slug, root)
        src = slug
    else:
        tl = test_live_slugs(root)
        if slug not in tl:
            raise SystemExit('СБОРКА ОСТАНОВЛЕНА: нет живого здания %s (ни %s/building.json, ни tests/*/building.json с live.slug = %s)' % (slug, slug, slug))
        src = tl[slug]
        b = load_building(src, root)
        over = {k: v for k, v in b['live'].items() if k not in LIVE_ONLY_KEYS}
        deep_merge(b, over)
    b = {k: v for k, v in b.items() if k not in ('live', 'card')}
    return src, b


def build_live(site, bdirs=None, engine_from=None, root=None):
    """Живые здания на живом движке (docs/ENGINE-PLAN.md, п.4, этап 5). Возвращает список записанных файлов.
    engine_from — папка, из которой ставится <site>/engine/ целиком (publish_engine: проверенный beta/engine/ с сайта).
    Без engine_from движок на сайте не трогается и ОБЯЗАН совпадать с исходником engine/ побайтно — иначе страница, собранная
    по новому шаблону, встретит старый движок (стоп с объяснением)."""
    site = Path(site)
    if not (site / 'CNAME').exists():
        raise SystemExit('%s не похоже на корень сайта (нет CNAME)' % site)
    bdirs = list(bdirs or live_buildings(root, site))
    errors = []   # ошибки настроек — до любой записи (у тестового здания — с блоком live поверх)
    for bd in bdirs:
        errors += building_schema.validate(bd, load_live(bd, root)[1], site)
    if errors:
        raise SystemExit('СБОРКА ОСТАНОВЛЕНА: ошибки в настройках зданий (%d):\n  • %s' % (len(errors), '\n  • '.join(errors)))
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
        b = load_live(bd, root)[1]
        page_dir = '%s/' % bd
        out = site / page_dir / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render(b, bd, page_dir, 'engine/', beta=False, version=version, site=site, root=root), encoding='utf-8')
        written.append(str(out.relative_to(site)))
        (out.parent / 'manifest.json').write_text(make_manifest(b, bd, page_dir), encoding='utf-8')
        written.append(str((out.parent / 'manifest.json').relative_to(site)))
    return written


_NOINDEX = re.compile(r'^[ \t]*<meta name="(?:robots|googlebot)" content="noindex[^>]*>\n', re.M)


def place_live_files(site, slug, root=None):
    """Тестовое здание (tests/<имя>/ с блоком live) -> файлы живого здания <site>/<slug>/: кадры frames/*.webp, about.html,
    history.html, gallery/*.webp (адреса от корня сайта пересчитываются под новую папку, теги noindex убираются), картинка
    превью (live.meta.ogImage) и картинка карточки главной (card.image). Папка <slug>/ сначала очищается целиком —
    на сайте лежит ровно то, что в исходнике. Страницу index.html и manifest.json собирает build_live. Возвращает список файлов."""
    root = Path(root or ROOT)
    tl = test_live_slugs(root)
    if slug not in tl:
        raise SystemExit('СТОП: нет тестового здания с live.slug = %s (tests/*/building.json с блоком "live")' % slug)
    src = tl[slug]
    raw = load_building(src, root)
    b = load_live(slug, root)[1]
    out = Path(site) / slug
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    written = []
    fsrc = root / src / b['framesDir']
    for f in sorted(list(fsrc.glob('*.webp')) + list(fsrc.glob('*_motion*.mp4')) + list(fsrc.glob('*_motion*.webm')) + list(fsrc.glob('*_motion_mask.png')) + list(fsrc.glob('*_fig.png')) + list(fsrc.glob('*_motion*cars.json')) + list(fsrc.glob('*_sway.png'))):   # + синемаграф (e1.13), треки машин (e1.15), маски фигур (e1.22), поля качания крон (e1.26)
        dst = out / b['framesDir'] / f.name
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, dst)
        written.append(str(dst.relative_to(site)))
    for name in copy_own_pages(src, out, slug + '/', root):
        if name.endswith('.html'):
            pg = out / name
            pg.write_text(_NOINDEX.sub('', pg.read_text(encoding='utf-8')), encoding='utf-8')
        written.append('%s/%s' % (slug, name))
    for rp in (b['meta'].get('ogImage'), (raw.get('card') or {}).get('image')):
        if rp:
            f = root / src / rp
            if not f.is_file():
                raise SystemExit('СТОП: нет файла %s/%s' % (src, rp))
            dst = out / rp
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(f, dst)
            written.append(str(dst.relative_to(site)))
    return written


def _i18n_spans(d):
    return ''.join('<span class="i18n-inline" lang="%s">%s</span>' % (l, html.escape(d[l], quote=False)) for l in LANGS)


# s41 (10б-фикс): у карточки главной две кнопки — «Смотреть в 3D» (просмотрщик) и «О здании/О памятнике» (about.html);
# сама обложка (марка) ведёт на about.html. Вложенных ссылок нет: обложка, кнопка 3D и кнопка about — три отдельные <a>.
CUBE_ICON = ('<svg class="cube-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
             'stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/></svg>')
PAGE_ICON = ('<svg class="page-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
             'stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>')
VIEW_3D_WORD = {'hy': 'Տեսնել 3D-ով', 'ru': 'Смотреть в 3D', 'en': 'View in 3D'}   # те же слова, что на кнопке в шапке about.html
ABOUT_DEFAULT = {'hy': 'Շենքի մասին', 'ru': 'О здании', 'en': 'About the building'}


def _about_label(src, root=None):
    """Подпись кнопки «о здании/о памятнике» — первая вкладка x-tabs на about.html самого экспоната (так кнопка на главной
    и вкладка на странице всегда называются одинаково: «О здании» / «О памятнике»). Нет страницы или вкладки — «О здании»."""
    f = Path(root or ROOT) / src / 'about.html'
    if not f.is_file():
        return dict(ABOUT_DEFAULT)
    m = re.search(r'<nav class="x-tabs"[^>]*>\s*<a href="about\.html"[^>]*>(.*?)</a>', f.read_text(encoding='utf-8'), re.S)
    out = {}
    if m:
        for l, t in re.findall(r'<span class="i18n-inline" lang="(\w+)">(.*?)</span>', m.group(1), re.S):
            out[l] = html.unescape(t)
    return out if all(out.get(l) for l in LANGS) else dict(ABOUT_DEFAULT)


def card_markup(slug, image, eyebrow, title, meta, about, no=None, hall='I'):
    """Разметка живой карточки главной (<li class="card">…</li>); одна на все здания, чтобы карточки не расходились.
    s43: вся карточка — ОДНА наклейка с вырубкой (.card-in.sticker, стили — assets/hub-museum.css, блок «наклейка»): внутри
    всё про здание — «Зал · Экспонат №» и инв. номер, обложка, годы, название, место, обе кнопки; снаружи ничего."""
    e = lambda t: html.escape(t, quote=True)
    lines = [
        '      <li class="card reveal">',
        '        <div class="card-in sticker">']
    if no:
        lbl = {l: '%s · %s' % (HALL_WORD[l] % hall, EXHIBIT_WORD[l] % no) for l in LANGS}
        lines.append('          <p class="st-top"><span class="lbl-no">%s</span><span class="inv" aria-hidden="true">ՉԿԱ · %03d</span></p>' % (_i18n_spans(lbl), no))
    lines += [
        '          <a class="cover" href="%s/about.html" aria-labelledby="t-%s">' % (e(slug), e(slug)),
        '            <div class="pic"><img src="%s/%s" width="480" height="480" alt="" loading="lazy" decoding="async"></div>' % (e(slug), e(image)),
        '          </a>',
        '          <div class="txt">',
        '            <span class="eyebrow">%s</span>' % _i18n_spans(eyebrow),
        '            <h3 id="t-%s"><span class="ttl">%s</span></h3>' % (e(slug), _i18n_spans(title)),
        '            <p class="meta">%s</p>' % _i18n_spans(meta),
        '            <div class="card-actions">',
        '              <a class="btn btn-3d" href="%s/" data-transition>%s<span>%s</span></a>' % (e(slug), CUBE_ICON, _i18n_spans(VIEW_3D_WORD)),
        '              <a class="btn btn-ghost btn-about" href="%s/about.html">%s<span>%s</span></a>' % (e(slug), PAGE_ICON, _i18n_spans(about)),
        '            </div>',
        '          </div>',
        '        </div>',
        '      </li>']
    return lines


HALL_WORD = {'hy': 'Սրահ %s', 'ru': 'Зал %s', 'en': 'Room %s'}   # s43: зал экспоната — на самой наклейке
EXHIBIT_WORD = {'hy': 'Ցուցանմուշ № %03d', 'ru': 'Экспонат № %03d', 'en': 'Exhibit No. %03d'}   # этикетка марки (s39): номер = postcard.no


def render_card(slug, root=None):
    """Карточка здания на главной (index.html) из блока card в building.json. Между метками
    <!-- card:<slug> --> и <!-- /card:<slug> -->; руками не править.
    s41: обложка (марка) ведёт на about.html здания; под этикеткой две кнопки — «Смотреть в 3D» (→ просмотрщик) и
    «О здании/О памятнике» (→ about.html, подпись берётся с самой страницы). Этикетка экспоната и инвентарный номер — из postcard.no."""
    src = test_live_slugs(root).get(slug, slug)
    b = load_building(src, root)
    cd = b.get('card')
    if not cd:
        raise SystemExit('СТОП: в %s/building.json нет блока card (карточка главной)' % src)
    no = (b.get('postcard') or {}).get('no')
    lines = ['      <!-- card:%s — собирается из %s/building.json (card, postcard.no), руками не править -->' % (slug, src)]
    lines += card_markup(slug, cd['image'], cd['eyebrow'], cd.get('title') or b['text']['title'], cd['meta'], _about_label(src, root), no)
    lines.append('      <!-- /card:%s -->' % slug)
    return '\n'.join(lines)


STACK_SLOTS = ('a', 'b', 'c', 'd')   # sc-a … sc-d в assets/hub.css: четыре места стопки в шапке главной


def render_stack(slug, root=None):
    """Картинка здания в верхней «стопке» главной — из card.stack (место a–d) и card.image в building.json.
    Между метками <!-- stack:<slug> --> и <!-- /stack:<slug> -->; руками не править. Нет card.stack — None."""
    src = test_live_slugs(root).get(slug, slug)
    cd = (load_building(src, root).get('card') or {})
    slot = cd.get('stack')
    if not slot:
        return None
    e = lambda s: html.escape(s, quote=True)
    return '\n'.join([
        '      <!-- stack:%s — собирается из %s/building.json (card.stack, card.image), руками не править -->' % (slug, src),
        '      <div class="stack-card sc-%s"><div class="sc-pic"><img src="%s/%s" width="480" height="480" alt="" decoding="async"></div></div>' % (slot, e(slug), e(cd['image'])),
        '      <!-- /stack:%s -->' % slug])


def _marks_span(text, kind, slug):
    a = text.find('      <!-- %s:%s ' % (kind, slug))
    if a < 0:
        a = text.find('<!-- %s:%s -->' % (kind, slug))
    endm = '<!-- /%s:%s -->' % (kind, slug)
    z = text.find(endm)
    if a < 0 or z < 0 or z < a:
        return None
    return a, z + len(endm)


def _card_span(text, slug):
    return _marks_span(text, 'card', slug)


def _stack_span(text, slug):
    return _marks_span(text, 'stack', slug)


def _stack_with(hub, slug, stack_html):
    """Стопка: метки stack:<slug> уже есть — заменить между ними. Нет — первая публикация: на место картинки-силуэта
    (<div class="stack-card sc-X"> с <svg class="ghost">) того же места, что в card.stack. Место занято чужой картинкой — СТОП."""
    sp = _stack_span(hub, slug)
    if sp:
        return hub[:sp[0]] + stack_html + hub[sp[1]:]
    slot = re.search(r'class="stack-card sc-(\w)"', stack_html).group(1)
    if slot not in STACK_SLOTS:
        raise SystemExit('СТОП: card.stack = %r — допустимо одно из %s' % (slot, ', '.join(STACK_SLOTS)))
    m = re.search(r'^[ \t]*<div class="stack-card sc-%s"><div class="sc-pic"><svg class="ghost"[^\n]*</svg></div></div>[ \t]*$' % slot, hub, re.M)
    if not m:
        raise SystemExit('СТОП: в index.html место стопки sc-%s занято не силуэтом (<svg class="ghost">) — выбери другое card.stack или освободи место' % slot)
    return hub[:m.start()] + stack_html + hub[m.end():]


def hub_with_card(hub, slug, card_html, stack_html=None):
    """Главная с карточкой здания slug на месте меток card:<slug> (метки обязаны быть в исходной главной) и, если есть
    stack_html, с его картинкой в стопке (метки stack:<slug> или силуэт того же места)."""
    sp = _card_span(hub, slug)
    if not sp:
        raise SystemExit('СТОП: в index.html нет меток <!-- card:%s --> … <!-- /card:%s --> — некуда ставить карточку' % (slug, slug))
    hub = hub[:sp[0]] + card_html + hub[sp[1]:]
    return _stack_with(hub, slug, stack_html) if stack_html else hub


def hub_outside_diff(old, new, slug):
    """Главная на сайте (old) -> новая (new): все отличия обязаны лежать внутри карточки slug или её картинки в стопке
    (между метками в new). Иначе публикация здания унесла бы на сайт чужие, непроверенные правки главной. Возвращает список проблем."""
    import difflib
    sp = _card_span(new, slug)
    if not sp:
        return ['в новой главной нет меток карточки %s' % slug]
    ranges = [(new[:sp[0]].count('\n'), new[:sp[1]].count('\n'))]
    st = _stack_span(new, slug)
    if st:
        ranges.append((new[:st[0]].count('\n'), new[:st[1]].count('\n')))
    nl = new.splitlines()
    bad = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old.splitlines(), nl, autojunk=False).get_opcodes():
        if op == 'equal':
            continue
        if not any(j1 >= first and j2 <= last + 1 and (j2 > j1 or first <= j1 <= last + 1) for first, last in ranges):
            bad.append('главная: отличие вне карточки %s — строки сайта %d–%d: %s' % (slug, i1 + 1, i2, (old.splitlines()[i1:i2] or nl[j1:j2] or [''])[0].strip()[:90]))
    return bad


def with_404_known(text, slug):
    """404.html: адрес здания в списке known (опечатка в адресе /<slug>/… ведёт на здание, а не на главную). Уже есть — без изменений."""
    m = re.search(r"var known = \{([^}]*)\};", text)
    if not m:
        raise SystemExit('СТОП: в 404.html нет списка known')
    if re.search(r"(?:^|[\s{,])'?%s'?\s*:" % re.escape(slug), m.group(1)):
        return text
    body = m.group(1).replace("'index.html'", "%s: '%s/', 'index.html'" % (slug if re.fullmatch(r'[a-z_][a-z0-9_]*', slug) else "'%s'" % slug, slug), 1)
    return text[:m.start(1)] + body + text[m.end(1):]


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
