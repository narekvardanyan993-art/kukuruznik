#!/usr/bin/env python3
"""Станок chka.am — конвейер и гейты движка e2 (docs/STANOK.md). Прогон П1: сборка страницы e2, перенос настроек, гейты G5, G6, G8, G13, паритет.

  python3 tools/stanok.py migrate tests/pogos-petros            # building.json (v1) → building.e2.json (format 2; только эффекты, которые уже есть в e2)
  python3 tools/stanok.py build   tests/pogos-petros --site DIR # страница e2: DIR/beta/e2/<id>/ + движок DIR/e/<версия>/ + manifest + штамп
  python3 tools/stanok.py check   tests/pogos-petros [--gate G5,G8] [--selftest] [--chrome PATH]
  python3 tools/stanok.py parity  tests/pogos-petros --out DIR [--frames 0,1] [--states day,sunset] [--chrome PATH]
        паритет с e1.62: сцена e2 против сцены e1.62, собранной из тех же кадров БЕЗ ещё не перенесённых эффектов (актёры, pix, тени облаков, шоу)

Настройки здания для e2 — <здание>/building.e2.json (v1 building.json рядом не трогается: на нём живут бета и live на e1.62).
Ошибка настроек — «ОШИБКА building.json: …», код выхода 1, на диск ничего не пишется (гейт G8).
Гейты с браузером (G6б, паритет) идут только там, где есть Chrome; без него — «ПРОПУЩЕНО» (не зелёный и не красный).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_engine      # noqa: E402
import stanok_schema     # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
E2 = ROOT / 'e2'
CFG_NAME = 'building.e2.json'
# Слова, которые в исходниках e2 разрешены только в core/clock.js (гейт G6а). Исключения — с причиной.
TIME_WORDS = ('Date.now', 'new Date', 'performance.now', 'setTimeout', 'setInterval', 'Math.random', 'requestAnimationFrame')
TIME_ALLOW = {('core/clock.js', w): 'единственный источник времени' for w in TIME_WORDS}
TIME_ALLOW[('core/prep.js', 'setTimeout')] = 'пауза перед повторной загрузкой картинки (не движение; файл — копия prep.js e1.62)'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def chrome_path(arg=None):
    for p in (arg, os.environ.get('CHKA_CHROME'), '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'):
        if p and Path(p).exists():
            return p
    return None


# ---------------------------------------------------------------- сборка страницы
def read_building(bdir):
    p = ROOT / bdir / CFG_NAME if not Path(bdir).is_absolute() else Path(bdir) / CFG_NAME
    if not p.is_file():
        raise SystemExit('ОШИБКА building.json: нет файла %s' % p)
    raw = p.read_bytes()
    try:
        return json.loads(raw.decode('utf-8')), raw, p
    except json.JSONDecodeError as e:
        raise SystemExit('ОШИБКА building.json: %s не читается как JSON (строка %d, символ %d): %s' % (p.name, e.lineno, e.colno, e.msg))


def build(bdir, site, page=None, e2=E2, building=None, quiet=False):
    """Собирает страницу здания на e2. Возвращает папку страницы (от корня сайта). Сначала ВСЕ проверки, потом запись."""
    if building is None:
        b, raw, bpath = read_building(bdir)
    else:
        b, raw, bpath = building, json.dumps(building, ensure_ascii=False, sort_keys=True).encode('utf-8'), None
    src = (bpath.parent if bpath else (ROOT / bdir if not Path(bdir).is_absolute() else Path(bdir)))
    fdir_name = b.get('framesDir', 'frames/') if isinstance(b, dict) else 'frames/'
    cfg, files = stanok_schema.resolve(b, src / fdir_name)
    if not (e2 / 'viewer.js').is_file() or not (e2 / 'prep.js').is_file():
        raise SystemExit('ОШИБКА сборки: движок e2 не собран (python3 tools/build_engine.py)')
    ver = build_engine.version(e2)
    site = Path(site)
    page = (page or 'beta/e2/%s/' % cfg['id']).strip('/') + '/'
    eng_dir = site / 'e' / ver
    eng = {n: (e2 / n).read_bytes() for n in ('viewer.js', 'prep.js')}
    eng['VERSION'] = (ver + '\n').encode()
    for n, data in eng.items():                      # выпущенная версия неизменяема
        if (eng_dir / n).is_file() and (eng_dir / n).read_bytes() != data:
            raise SystemExit('ОШИБКА сборки: на сайте уже лежит другой движок версии %s (e/%s/%s). Версия неизменяема — смени e2/VERSION.' % (ver, ver, n))
    manifest = {'schema': 1, 'building': cfg['id'], 'engine': ver, 'files': {}}
    for fn in files:
        data = (src / fdir_name / fn).read_bytes()
        manifest['files'][fn] = {'sha256': sha(data), 'bytes': len(data)}
    for f in cfg['frames']:
        f['files'] = {k: 'frames/%s?v=%s' % (fn, manifest['files'][fn]['sha256'][:8]) for k, fn in f['files'].items()}
    depth = page.count('/')
    cfg['engine'] = {'base': '../' * depth + 'e/%s/' % ver, 'version': ver}
    man_text = json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=True) + '\n'
    stamp = {'building': sha(raw), 'schema': sha((e2 / 'effects.schema.json').read_bytes()), 'engine': ver,
             'engineSrc': build_engine.src_sha(e2), 'manifest': sha(man_text.encode('utf-8'))}
    title = ((b.get('text') or {}).get('title') or {}).get('ru') or cfg['id']
    html = (e2 / 'page.html').read_text(encoding='utf-8')
    for k, v in (('{{VERSION}}', ver), ('{{STAMP}}', stamp['building'][:16]), ('{{TITLE}}', title), ('{{ENGINE}}', cfg['engine']['base']),
                 ('{{CONFIG}}', json.dumps(cfg, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/'))):
        html = html.replace(k, v)
    # --- запись ---
    eng_dir.mkdir(parents=True, exist_ok=True)
    for n, data in eng.items():
        (eng_dir / n).write_bytes(data)
    out = site / page
    (out / 'frames').mkdir(parents=True, exist_ok=True)
    for fn in files:
        shutil.copyfile(src / fdir_name / fn, out / 'frames' / fn)
    (out / 'frames' / 'manifest.json').write_text(man_text, encoding='utf-8')
    (out / 'build.json').write_text(json.dumps(stamp, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    (out / 'index.html').write_text(html, encoding='utf-8')
    if not quiet:
        print('собрано: %s (e2 %s, кадров %d, файлов %d)' % (page, ver, len(cfg['frames']), len(files)))
    return page


def page_config(site, page):
    html = (Path(site) / page / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'window\.E2_BUILDING = (\{.*\});</script>', html)
    return json.loads(m.group(1).replace('<\\/', '</')), html


# ---------------------------------------------------------------- перенос настроек v1 → format 2 (П1: parallax + tod)
def migrate(bdir):
    """building.json (v1, e1.62) → building.e2.json. Переносит только то, что уже есть в e2/effects.schema.json;
    остальное перечисляет в notYet. Числа — те же, что видит e1.62 (tuning здания поверх engine/config.json)."""
    src = ROOT / bdir
    v1 = json.loads((src / 'building.json').read_text(encoding='utf-8'))
    base = json.loads((ROOT / 'engine' / 'config.json').read_text(encoding='utf-8'))
    tun, look = v1.get('tuning', {}), v1.get('look', {})
    get = lambda k: tun.get(k, base.get(k))
    lk = dict(base.get('LOOK', {}))
    for k, v in (tun.get('LOOK') or {}).items():
        lk[k] = dict(lk.get(k, {}), **v)
    S = stanok_schema.load_schema()
    FX = S['effects']

    def trim(obj, spec, kind=None):     # убрать значения, равные умолчанию схемы
        out = {}
        for k, v in obj.items():
            s = spec[k]
            if s['type'] == 'object' and isinstance(v, dict):
                t = trim(v, s['keys'], kind)
                if t:
                    out[k] = t
                continue
            ok, d = stanok_schema._default(s, kind)
            if not ok or d != v:
                out[k] = v
        return out

    par = {'shiftX': get('MAX_SHIFT_X'), 'shiftY': get('MAX_SHIFT_Y'), 'zoomNear': get('ZOOM_NEAR'), 'baseScale': get('BASE_SCALE'),
           'depthBlurPx': get('DEPTH_BLUR_PX'), 'smooth': get('SMOOTH'), 'returnMs': get('RETURN_MS'), 'crossfadeMs': get('FRAME_CROSSFADE_MS'),
           'maxTiltDeg': get('MAX_TILT_X_DEG'), 'breath': {'amp': get('BREATH_AMPLITUDE'), 'periodS': get('BREATH_PERIOD_S')}}
    sp, sm = lk['sunsetProc'], lk['sunsetSmear']
    tod = {'day': look['day'], 'noon': look.get('noon') or False, 'daySunsetS': get('DAY_SUNSET_S'), 'sunsetNightS': get('SUNSET_NIGHT_S'),
           'sunsetProc': {k: sp[k] for k in ('tint', 'skyLow', 'skyHigh', 'glowColor', 'glowStrength', 'windowColor', 'windowStrength')},
           'sunsetShade': {'length': sm['length'], 'strength': sm['strength'], 'dark': sm['dark']}}
    if not get('BUILDING_DEPTH_PIXEL'):
        raise SystemExit('перенос: у здания BUILDING_DEPTH_PIXEL = false, а в e2 глубина здания всегда по точкам — сначала пересобрать слои')
    frames, moved = [], {'name', 'caption', 'crop', 'sky', 'sun', 'tiltK', 'noon', 'sunset', 'hidden'}
    not_yet = set()
    for f in v1['frames']:
        tk, end = f.get('tiltK'), f['sky']['end']
        kind = 'wide' if tk is None or tk > 0.5 else ('interior' if end < 0.05 else 'close')
        has_sunset = bool(f.get('sunset', True)) and (src / v1.get('framesDir', 'frames/') / (f['name'] + '_sunset.webp')).is_file()
        fe = {'parallax': {'tilt': 1 if tk is None else tk, 'crop': f.get('crop', [0, 0, 1, 1])},
              'tod': {'sky': {'ref': f['sky']['ref'], 'end': end}, 'noonK': f.get('noon', 1) if look.get('noon') else 0,
                      'sunsetPicture': has_sunset, 'sun': f.get('sun') if end >= stanok_schema.SKY_MIN else None}}
        g = {'name': f['name'], 'kind': kind}
        if f.get('caption'):
            g['caption'] = f['caption']
        g['effects'] = {e: trim(fe[e], FX[e]['frame'], kind) for e in fe}
        g['effects']['tod'].setdefault('sun', fe['tod']['sun'])   # ключ обязателен (null — у кадра без неба)
        g['effects']['tod'].setdefault('sky', {})['end'] = end
        frames.append(g)
        not_yet |= {k for k, v in f.items() if k not in moved and v not in (None, [], {}, False, 0)}
    out = {'format': 2, 'id': v1['id'], 'source': '%s/building.json (v1, движок e1.62)' % bdir,
           'notYet': sorted('frames[].' + k for k in not_yet) + sorted('tuning.' + k for k in tun if k not in ('MAX_SHIFT_X', 'MAX_SHIFT_Y', 'ZOOM_NEAR', 'BREATH_AMPLITUDE', 'BUILDING_DEPTH_PIXEL')),
           'text': v1.get('text'), 'look': {'frameSize': look['frameSize'], 'sunSide': look.get('sunSide', 'left')},
           'effects': {'parallax': trim(par, FX['parallax']['building']), 'tod': trim(tod, FX['tod']['building'])}, 'frames': frames}
    stanok_schema.resolve(out, src / v1.get('framesDir', 'frames/'))     # перенесённое обязано проходить схему
    p = src / CFG_NAME
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('перенесено: %s (кадров %d; ещё не в e2: %d ключей — см. notYet)' % (p.relative_to(ROOT), len(frames), len(out['notYet'])))


# ---------------------------------------------------------------- эталон e1.62 без ещё не перенесённых эффектов (для паритета)
def build_ref(bdir, site):
    """Страница здания на e1.62 (engine/), где выключено всё, чего в e2 ещё нет: актёры, pix, шоу, листья, тени облаков, события неба.
    Остаются наклон и время суток — ровно то, что переносит П1. Кадры те же."""
    import build_pages
    v1 = json.loads((ROOT / bdir / 'building.json').read_text(encoding='utf-8'))
    for f in v1['frames']:
        for k in ('poses', 'leafFly', 'showVideo', 'fx', 'showCaption', 'wx'):
            f.pop(k, None)
        f.pop('pix', None)
        f['parade'] = False
        f['cloudShadow'] = 1e-9     # 0 движок e1.62 читает как «нет значения» и ставит 0,12
        f['life'] = {'day': [], 'sunset': [], 'night': []}
    (v1.get('postcard') or {}).pop('show', None)     # «праздник» на открытке — без шоу снимать нечего
    # Поле облаков e1.62 рисует сцену СЕТКОЙ (тень считается в вершинах): координаты кадра интерполируются по мелким треугольникам
    # и расходятся с обычным прямоугольником на доли пикселя — шум на штрихах (~2 % пикселей). Тени облаков — эффект sky (П2).
    v1.setdefault('tuning', {}).update({'CLOUD_FIELD': 0, 'CLOUD_FIELD_NIGHT': 0})
    site = Path(site)
    site.mkdir(parents=True, exist_ok=True)
    (site / 'CNAME').write_text('chka.am\n')
    if not (site / 'assets').exists():
        os.symlink(ROOT / 'assets', site / 'assets')
    root = Path(tempfile.mkdtemp(prefix='stanok-ref-root-'))
    (root / bdir).mkdir(parents=True)
    (root / bdir / 'building.json').write_text(json.dumps(v1, ensure_ascii=False), encoding='utf-8')
    for p in (ROOT / bdir).iterdir():
        if p.name != 'building.json':
            os.symlink(p, root / bdir / p.name)
    for p in ROOT.iterdir():
        if p.name not in ('tests', '.git') and not (root / p.name).exists():
            os.symlink(p, root / p.name)
    build_pages.build_beta(site, bdirs=[bdir], root=root)
    return 'beta/%s/' % bdir


# ---------------------------------------------------------------- гейты
def gate_g5(site, page, bdir, e2=E2, building_raw=None):
    """Кэш и версия: движок из папки своей версии и неизменён; у каждого файла кадра ?v=<sha>; штамп сборки = текущие настройки."""
    probs = list(build_engine.check(e2))
    site = Path(site)
    cfg, html = page_config(site, page)
    ver = build_engine.version(e2)
    if cfg['engine']['version'] != ver:
        probs.append('страница собрана на движке %s, а e2/VERSION = %s' % (cfg['engine']['version'], ver))
    m = re.search(r'<script src="([^"]*)viewer\.js\?v=([^"]+)"', html)
    if not m or not m.group(1).endswith('e/%s/' % ver) or m.group(2) != ver:
        probs.append('движок на странице подключён не из папки версии e/%s/' % ver)
    for n in ('viewer.js', 'prep.js'):
        p = site / 'e' / ver / n
        if not p.is_file() or p.read_bytes() != (e2 / n).read_bytes():
            probs.append('e/%s/%s на сайте не совпадает с e2/%s' % (ver, n, n))
    man = json.loads((site / page / 'frames' / 'manifest.json').read_text(encoding='utf-8'))['files']
    for f in cfg['frames']:
        for key, url in f['files'].items():
            mm = re.fullmatch(r'frames/([^?]+)\?v=([0-9a-f]{8})', url)
            if not mm:
                probs.append('кадр %s: у файла «%s» нет ?v=<sha> (%s)' % (f['name'], key, url))
                continue
            fn, v = mm.groups()
            p = site / page / 'frames' / fn
            real = sha(p.read_bytes())[:8] if p.is_file() else None
            if fn not in man or man[fn]['sha256'][:8] != v or real != v:
                probs.append('кадр %s: %s — ?v=%s, а файл на сайте %s (старая картинка останется в кэше)' % (f['name'], fn, v, real))
    stamp = json.loads((site / page / 'build.json').read_text(encoding='utf-8'))
    raw = building_raw if building_raw is not None else read_building(bdir)[1]
    if stamp['building'] != sha(raw):
        probs.append('штамп сборки не совпадает с текущим %s — страница собрана из старых настроек' % CFG_NAME)
    if stamp['engine'] != ver or stamp['engineSrc'] != build_engine.src_sha(e2):
        probs.append('штамп сборки: движок страницы не тот, что в e2/ сейчас')
    return probs


def gate_g13(site, page):
    """Файлы: всё, на что ссылаются настройки, есть в manifest с верным sha; лишних файлов в папке кадров нет."""
    probs = []
    site = Path(site)
    cfg, _ = page_config(site, page)
    fdir = site / page / 'frames'
    man = json.loads((fdir / 'manifest.json').read_text(encoding='utf-8'))['files']
    for f in cfg['frames']:
        for key, url in f['files'].items():
            fn = url.split('?')[0].split('/', 1)[1]
            if fn not in man:
                probs.append('кадр %s: файл %s (ключ «%s») не записан в manifest.json — на сайт не доедет' % (f['name'], fn, key))
    for fn, q in man.items():
        p = fdir / fn
        if not p.is_file():
            probs.append('%s есть в manifest.json, а файла на сайте нет' % fn)
        elif sha(p.read_bytes()) != q['sha256'] or p.stat().st_size != q['bytes']:
            probs.append('%s: файл на сайте не тот, что в manifest.json (sha или размер)' % fn)
    for p in sorted(fdir.iterdir()):
        if p.name != 'manifest.json' and p.name not in man:
            probs.append('%s лежит в папке кадров, но его нет в manifest.json' % p.name)
    return probs


def bad_configs(good):
    """Испорченные настройки для G8: (название, копия с одним дефектом, кусок ожидаемого сообщения)."""
    def mod(fn):
        b = json.loads(json.dumps(good))
        fn(b)
        return b
    f0 = lambda b: b['frames'][0]
    sky = next(i for i, f in enumerate(good['frames']) if f['effects']['tod'].get('sun'))
    return [
        ('неизвестный ключ эффекта здания', mod(lambda b: b['effects'].setdefault('parallax', {}).update({'shiftXX': 0.01})), 'shiftXX'),
        ('неизвестный ключ эффекта кадра', mod(lambda b: f0(b)['effects']['parallax'].update({'ampl': 1})), 'ampl'),
        ('неизвестный ключ кадра', mod(lambda b: f0(b).update({'wind': 1.2})), 'wind'),
        ('неизвестный ключ верхнего уровня (старый tuning)', mod(lambda b: b.update({'tuning': {'NO_SWAY': True}})), 'tuning'),
        ('неизвестный эффект', mod(lambda b: b['effects'].update({'fountain': {}})), 'fountain'),
        ('не тот тип', mod(lambda b: b['effects'].setdefault('parallax', {}).update({'shiftX': '0.02'})), 'нужно число'),
        ('число вне диапазона', mod(lambda b: b['effects'].setdefault('parallax', {}).update({'shiftX': 0.5})), 'вне диапазона'),
        ('нет обязательного ключа', mod(lambda b: f0(b)['effects']['tod']['sky'].pop('end')), 'обязательного ключа нет'),
        ('нет файла кадра', mod(lambda b: f0(b).update({'name': 'no_such_frame'})), 'нет файла'),
        ('закатной картинки нет, а настройка говорит «есть»', mod(lambda b: b['frames'][sky]['effects']['tod'].update({'sunsetPicture': True}) if not good['frames'][sky]['effects']['tod'].get('sunsetPicture') else b['frames'][sky].update({'name': 'no_such_frame'})), 'нет файла'),
        ('закатное солнце не в небе', mod(lambda b: b['frames'][sky]['effects']['tod']['sun'].update({'sunset': [0.5, 0.99]})), 'не в небе'),
        ('кадр не 9:16', mod(lambda b: b['look'].update({'frameSize': [1024, 1024]})), '9:16'),
        ('format не 2', mod(lambda b: b.update({'format': 1})), 'format'),
        ('имя кадра повторяется', mod(lambda b: b['frames'].append(json.loads(json.dumps(b['frames'][0])))), 'повторяется'),
        ('неизвестный kind', mod(lambda b: f0(b).update({'kind': 'panorama'})), 'panorama'),
        ('крупный план с полным наклоном', mod(lambda b: (f0(b).update({'kind': 'close'}), f0(b)['effects']['parallax'].update({'tilt': 1}))), 'почти плоские'),
    ]


def gate_g8(bdir):
    """Схема падает громко: каждая испорченная копия настроек обязана остановить сборку с русским текстом и ничего не записать."""
    probs = []
    good = read_building(bdir)[0]
    cases = bad_configs(good)
    for name, bad, expect in cases:
        site = Path(tempfile.mkdtemp(prefix='stanok-g8-'))
        try:
            build(bdir, site, building=bad, quiet=True)
            probs.append('«%s»: испорченные настройки СОБРАЛИСЬ' % name)
        except SystemExit as e:
            msg = str(e)
            if not msg.startswith('ОШИБКА building.json: '):
                probs.append('«%s»: сообщение не начинается с «ОШИБКА building.json: » (%s)' % (name, msg[:80]))
            elif expect not in msg:
                probs.append('«%s»: в сообщении нет «%s» (%s)' % (name, expect, msg[:120]))
        if any(site.rglob('*')):
            probs.append('«%s»: сборка остановилась, но на диск что-то записано' % name)
        shutil.rmtree(site, ignore_errors=True)
    # целые настройки собираются, а значение из настроек доходит до страницы (ключ-эхо)
    site = Path(tempfile.mkdtemp(prefix='stanok-g8-'))
    echo = json.loads(json.dumps(good))
    echo['effects'].setdefault('parallax', {})['depthBlurPx'] = 7.25
    try:
        page = build(bdir, site, building=echo, quiet=True)
        if page_config(site, page)[0]['effects']['parallax']['depthBlurPx'] != 7.25:
            probs.append('ключ-эхо: значение из настроек не дошло до страницы')
    except SystemExit as e:
        probs.append('целые настройки не собрались: %s' % str(e)[:160])
    shutil.rmtree(site, ignore_errors=True)
    return probs, len(cases)


def gate_g6a(e2=E2):
    """Время и случайность — только из core/clock.js: поиск запрещённых слов по исходникам e2."""
    probs = []
    for p in sorted((e2 / 'src').rglob('*.js')):
        rel = str(p.relative_to(e2 / 'src'))
        for n, line in enumerate(p.read_text(encoding='utf-8').split('\n'), 1):
            code = line.split('//')[0]
            for w in TIME_WORDS:
                if w in code and (rel, w) not in TIME_ALLOW:
                    probs.append('%s:%d — %s вне core/clock.js (движение мимо часов движка)' % (rel, n, w))
    return probs


def px(args, chrome):
    return subprocess.run(['node', str(ROOT / 'tools' / 'stanok_px.mjs')] + [str(a) for a in args] + ['--chrome', chrome], capture_output=True, text=True)


def gate_g6b(site, page, chrome, frames='0', work=None):
    """Два прогона с одинаковыми шагами времени обязаны дать одинаковые пиксели (день и закат) + ключ-эхо в prep."""
    work = Path(work or tempfile.mkdtemp(prefix='stanok-g6-'))
    for n in ('a', 'b'):
        r = px(['shoot', '--engine', 'e2', '--site', site, '--page', page, '--out', work / n, '--frames', frames, '--states', 'day,sunset', '--tilts', 'C,R', '--move', '1'], chrome)
        if r.returncode != 0:
            return ['прогон %s не прошёл: %s' % (n, (r.stdout + r.stderr).strip()[-300:])]
    r = px(['compare', work / 'a', work / 'b', '--delta', '0', '--share', '0'], chrome)
    probs = [] if r.returncode == 0 else ['два одинаковых прогона дали разные пиксели: ' + r.stdout.strip().split('\n')[-1]]
    info = json.loads((work / 'a' / 'index.json').read_text())
    cfg = page_config(site, page)[0]
    if info.get('prepCfg', {}).get('DEPTH_BLUR_PX') != cfg['effects']['parallax']['depthBlurPx']:
        probs.append('ключ-эхо: effects.parallax.depthBlurPx не дошёл до подготовки картинок (prep.js)')
    if info.get('errors'):
        probs.append('ошибки движка: ' + '; '.join(info['errors'][:3]))
    return probs


# ---------------------------------------------------------------- самопроверки (красные случаи)
BREAK_FX = '''// ТЕСТОВЫЙ эффект самопроверки G6: движение по настоящим часам и случайности (так делать нельзя).
E2.effect({ name: 'tod_break', glsl: function () { return null; },
  step: function (S) { S.shiftX += 0.004 * Math.random() + 0.000001 * (performance.now() % 1000); } });
'''


def copy_e2():
    tmp = Path(tempfile.mkdtemp(prefix='stanok-e2-')) / 'e2'
    shutil.copytree(E2, tmp)
    return tmp


def selftest(bdir, gates, chrome):
    """Каждый гейт обязан покраснеть на своей известной поломке. Возвращает список (гейт, случай, ок?)."""
    res = []
    site = Path(tempfile.mkdtemp(prefix='stanok-self-'))
    page = build(bdir, site, quiet=True)
    red = lambda probs: len(probs) > 0
    if 'G5' in gates:
        e2 = copy_e2()
        (e2 / 'src' / 'fx' / 'tod.js').write_text((e2 / 'src' / 'fx' / 'tod.js').read_text(encoding='utf-8') + '\n// правка без смены версии\n', encoding='utf-8')
        res.append(('G5', 'правка e2/src без смены VERSION', red(build_engine.check(e2))))
        s2 = Path(tempfile.mkdtemp(prefix='stanok-self-'))
        p2 = build(bdir, s2, quiet=True)
        fn = sorted((s2 / p2 / 'frames').glob('*.webp'))[0]
        fn.write_bytes(fn.read_bytes() + b'\0')
        res.append(('G5', 'подмена кадра без нового sha', red(gate_g5(s2, p2, bdir))))
        raw = read_building(bdir)[1] + b'\n '
        res.append(('G5', 'настройки изменились после сборки (штамп)', red(gate_g5(site, page, bdir, building_raw=raw))))
    if 'G13' in gates:
        s3 = Path(tempfile.mkdtemp(prefix='stanok-self-'))
        p3 = build(bdir, s3, quiet=True)
        mp = s3 / p3 / 'frames' / 'manifest.json'
        man = json.loads(mp.read_text(encoding='utf-8'))
        gone = sorted(man['files'])[0]
        del man['files'][gone]
        mp.write_text(json.dumps(man), encoding='utf-8')
        res.append(('G13', 'ссылка на файл вне manifest', any('не записан в manifest' in p for p in gate_g13(s3, p3))))
        s4 = Path(tempfile.mkdtemp(prefix='stanok-self-'))
        p4 = build(bdir, s4, quiet=True)
        os.remove(sorted((s4 / p4 / 'frames').glob('*.webp'))[0])
        res.append(('G13', 'файл из manifest не доехал', red(gate_g13(s4, p4))))
    if 'G8' in gates:
        os.environ['STANOK_BREAK'] = 'schema-unknown'
        try:
            res.append(('G8', 'схема пропускает неизвестные ключи', red(gate_g8(bdir)[0])))
        finally:
            del os.environ['STANOK_BREAK']
    if 'G6' in gates:
        e2 = copy_e2()
        (e2 / 'src' / 'fx' / 'tod_break.js').write_text(BREAK_FX, encoding='utf-8')
        res.append(('G6', '(а) эффект с настоящими часами и Math.random в исходниках', red(gate_g6a(e2))))
        if chrome:
            # (б) тот же эффект вшит в движок: два прогона обязаны разойтись. Как дождь e1.62 под виртуальным временем (находка П0).
            (e2 / 'VERSION').write_text('e2.0.0-break\n')
            (e2 / 'viewer.js').write_text(build_engine.build_text(e2, extra=['fx/tod_break.js']), encoding='utf-8')
            s5 = Path(tempfile.mkdtemp(prefix='stanok-self-'))
            p5 = build(bdir, s5, e2=e2, quiet=True)
            html = (s5 / p5 / 'index.html').read_text(encoding='utf-8').replace('"effectsOn":[', '"effectsOn":["tod_break",', 1)
            (s5 / p5 / 'index.html').write_text(html, encoding='utf-8')
            res.append(('G6', '(б) два прогона с эффектом мимо часов дают разные пиксели', red(gate_g6b(s5, p5, chrome))))
        else:
            res.append(('G6', '(б) ПРОПУЩЕНО: нет Chrome', None))
    return res


def check(bdir, gates, chrome, do_selftest):
    bad = 0
    site = Path(tempfile.mkdtemp(prefix='stanok-check-'))
    page = build(bdir, site, quiet=True)
    def show(g, probs, extra=''):
        nonlocal bad
        if probs:
            bad += 1
            print('%s КРАСНЫЙ%s' % (g, extra))
            for p in probs[:12]:
                print('   - ' + p)
        else:
            print('%s зелёный%s' % (g, extra))
    if 'G5' in gates:
        show('G5', gate_g5(site, page, bdir))
    if 'G6' in gates:
        probs = gate_g6a()
        if chrome:
            probs += gate_g6b(site, page, chrome)
            show('G6', probs)
        else:
            show('G6', probs, ' — только (а) поиск по исходникам; (б) два прогона ПРОПУЩЕНО: нет Chrome')
    if 'G8' in gates:
        probs, n = gate_g8(bdir)
        show('G8', probs, ' (%d испорченных настроек + целые)' % n)
    if 'G13' in gates:
        show('G13', gate_g13(site, page))
    if do_selftest:
        print('--- самопроверка: гейт обязан покраснеть на известной поломке ---')
        for g, case, ok in selftest(bdir, gates, chrome):
            if ok is None:
                print('%s самопроверка: %s' % (g, case))
            else:
                print('%s самопроверка %s: %s' % (g, 'ок (покраснел)' if ok else 'ПРОВАЛ (не покраснел)', case))
                bad += 0 if ok else 1
    print('ИТОГ: %s' % ('всё зелёное' if not bad else 'красных: %d' % bad))
    return 1 if bad else 0


def parity(bdir, out, chrome, frames=None, states='day,sunset', delta=3, share=0.0005):
    """Сцена e2 против сцены e1.62 (без ещё не перенесённых эффектов). Пиксель «другой», если канал отличается больше delta;
    снимок красный, если таких пикселей больше share (доля)."""
    if not chrome:
        print('ПРОПУЩЕНО: нет Chrome')
        return 2
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    s1, s2 = Path(tempfile.mkdtemp(prefix='stanok-par-e1-')), Path(tempfile.mkdtemp(prefix='stanok-par-e2-'))
    p1, p2 = build_ref(bdir, s1), build(bdir, s2, quiet=True)
    fa = ['--frames', frames] if frames else []
    for eng, site, page in (('e1', s1, p1), ('e2', s2, p2)):
        r = px(['shoot', '--engine', eng, '--site', site, '--page', page, '--out', out / eng, '--states', states, '--tilts', 'L,C,R', '--png', '1'] + fa, chrome)
        print(r.stdout.strip()[-400:])
        if r.returncode != 0:
            print(r.stderr.strip()[-600:])
            return 1
    r = px(['compare', out / 'e1', out / 'e2', '--delta', delta, '--share', share, '--report', out / 'parity.json'], chrome)
    print(r.stdout.strip())
    return r.returncode


def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    cmd, rest = argv[0], argv[1:]
    opt = {}
    pos = []
    i = 0
    while i < len(rest):
        if rest[i].startswith('--'):
            if rest[i] in ('--selftest',):
                opt[rest[i][2:]] = True
            else:
                opt[rest[i][2:]] = rest[i + 1]
                i += 1
        else:
            pos.append(rest[i])
        i += 1
    if not pos:
        raise SystemExit('нужна папка здания, например tests/pogos-petros')
    bdir = pos[0].strip('/')
    chrome = chrome_path(opt.get('chrome'))
    if cmd == 'migrate':
        migrate(bdir)
    elif cmd == 'build':
        if 'site' not in opt:
            raise SystemExit('нужен --site ПАПКА (копия сайта; в репозиторий страница e2 пока не собирается)')
        build(bdir, opt['site'], opt.get('page'))
    elif cmd == 'check':
        gates = opt.get('gate', 'G5,G6,G8,G13').split(',')
        return check(bdir, gates, chrome, bool(opt.get('selftest')))
    elif cmd == 'parity':
        return parity(bdir, opt.get('out', tempfile.mkdtemp(prefix='stanok-parity-')), chrome, opt.get('frames'), opt.get('states', 'day,sunset'),
                      float(opt.get('delta', 3)), float(opt.get('share', 0.0005)))
    elif cmd == 'ref':
        print(build_ref(bdir, opt['site']))
    else:
        raise SystemExit('неизвестная команда %s (есть: migrate, build, check, parity, ref)' % cmd)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
