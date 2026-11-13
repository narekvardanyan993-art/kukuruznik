#!/usr/bin/env python3
"""Станок chka.am — конвейер и гейты движка e2 (docs/STANOK.md). Путь здания: пакет → init → intake → layers → insert → build → check → бета.
Гейты G1, G2, G3, G5, G6, G7, G8, G9, G10, G13 + гейт пакета, паритет, сверка шоу.

  python3 tools/stanok.py check   --story surb-nikolay [--selftest]   # гейт пакета buildings-next/<slug>/ (tools/stanok_pack.py)
  python3 tools/stanok.py init    surb-nikolay [--spare] [--force]    # пакет → tests/<slug>/building.e2.json (заготовка), zones.json, work/<slug>/
  python3 tools/stanok.py status  surb-nikolay                        # шаги здания с отметками по файлам и следующий шаг
  python3 tools/stanok.py intake  tests/<slug> <кадр> day|bg|night|sunset|snow <файл>   # приём рисунка Gemini в мастера (tools/stanok_layers.py)
  python3 tools/stanok.py layers  tests/<slug> [кадр] [--models ПАПКА]  # мастера → слои, глубина, закат, ночь, маска снега, числа неба; вставки журнала — заново
  python3 tools/stanok.py crop    tests/<slug> <кадр> --box u0,v0,u1,v1 --out вырезка.png [--version day|night|sunset]   # точный файл для правки Gemini
  python3 tools/stanok.py insert  tests/<slug> <кадр> <правка.png> --box u0,v0,u1,v1 [--kind object|flat|inscription] [--layer ground|building]
        [--id имя] [--night-edit ночная_правка.png] [--inscription "ТЕКСТ" [--spot B1]] [--dry-run]     # вставка во ВСЕ версии кадра (tools/stanok_insert.py)
  python3 tools/stanok.py insert  tests/<slug> --list | --remove <id>   # журнал вставок; убрать вставку (кадр собирается заново без неё)
  python3 tools/stanok.py replay  tests/<slug> [--frames a,b]           # пересобрать кадры из чистых файлов и журнала
  python3 tools/stanok.py sheet   tests/<slug> [--frames 0,1] [--out DIR]   # листы 5 кнопок по кадрам (Chrome)

  python3 tools/stanok.py migrate tests/pogos-petros            # building.json (v1) → building.e2.json (format 2; только эффекты, которые уже есть в e2)
  python3 tools/stanok.py build   tests/pogos-petros --site DIR # страница e2: DIR/beta/e2/<id>/ + движок DIR/e/<версия>/ + manifest + штамп
  python3 tools/stanok.py build   tests/pogos-petros --site DIR --beta   # страница беты: DIR/beta/tests/<slug>-e2/ + движок DIR/beta/e/<версия>/
  python3 tools/stanok.py beta    tests/pogos-petros [--dry-run]  # ТОЛЬКО советник: бета e2 в main (worktree от origin/main, коммит только этих папок, пуш)
  python3 tools/stanok.py check   tests/pogos-petros [--gate G1,G5,G7,G10] [--frames 0,1] [--selftest] [--out DIR] [--e1site DIR] [--chrome PATH]
        G7 (кнопки), G10 (живость и изюминки), G1 (ветер) и G6(б) идут в Chrome; --frames — только эти кадры (в облачной VM весь дом — дольше 20 мин); --out — куда положить листы G7;
        --e1site — копия сайта на e1.62 с Кукурузником (report/stanok-p0/site-before.tgz) для красного случая G6 «дождь e1.62»
  python3 tools/stanok.py parity  tests/pogos-petros --out DIR [--frames 0,1] [--states day,sunset,night,rain,snow] [--tilts L,C,R] [--sky 1] [--chrome PATH]
        паритет с e1.62: сцена e2 против сцены e1.62, собранной из тех же кадров БЕЗ ещё не перенесённых эффектов (актёры, pix, шоу) и без
        теней облаков у обоих — 0 отличий; --sky 1 — паритет теней облаков: с порогом (e1.62 рисует их сеткой) и красным случаем «небо сдвинуто»
        «Снег» — последним: тающий снег e2 идёт сверху вниз, а не разом (tests/<здание>/migration-allowed.json — разрешённые отличия)
  python3 tools/stanok.py showcmp tests/pogos-petros --out DIR [--frames 0,1,2] [--chrome PATH]
        шоу «до/после» на e2 против e1.62: стоп-кадры показа (секунды — SHOW_SECS), день, наклон C; отличия — только migration-allowed.json

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
import stanok_insert     # noqa: E402
import stanok_layers     # noqa: E402
import stanok_pack       # noqa: E402
import stanok_masks      # noqa: E402
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


BETA_PAGE = 'beta/tests/%s-e2/'     # страница e2 в бете (рядом с бетой e1.62 beta/tests/<slug>/, её не трогает); движок — beta/e/<версия>/


def build(bdir, site, page=None, e2=E2, building=None, quiet=False, eng_root=''):
    """Собирает страницу здания на e2. Возвращает папку страницы (от корня сайта). Сначала ВСЕ проверки, потом запись.
    eng_root — где на сайте лежат версии движка e/<версия>/ ('' — корень сайта; 'beta/' — внутри беты: публикация беты коммитит только beta/)."""
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
    eng_dir = site / eng_root / 'e' / ver
    eng = {n: (e2 / n).read_bytes() for n in ('viewer.js', 'prep.js')}
    eng['VERSION'] = (ver + '\n').encode()
    for n, data in eng.items():                      # выпущенная версия неизменяема
        if (eng_dir / n).is_file() and (eng_dir / n).read_bytes() != data:
            raise SystemExit('ОШИБКА сборки: на сайте уже лежит другой движок версии %s (%se/%s/%s). Версия неизменяема — смени e2/VERSION.' % (ver, eng_root, ver, n))
    manifest = {'schema': 1, 'building': cfg['id'], 'engine': ver, 'files': {}}
    for fn in files:
        data = (src / fdir_name / fn).read_bytes()
        manifest['files'][fn] = {'sha256': sha(data), 'bytes': len(data)}
    # производные файлы (маски огней, карты погоды): считает станок из файлов кадра, в репозитории их нет (tools/stanok_masks.py)
    made = {}
    for d in cfg.pop('derived', []):
        if d['file'] not in made:
            made[d['file']] = stanok_masks.make(d['maker'], {k: (str(src / fdir_name / v) if isinstance(v, str) else [str(src / fdir_name / x) for x in v]) for k, v in d['from'].items()}, params=d.get('params'))
        data, meta = made[d['file']]
        manifest['files'][d['file']] = {'sha256': sha(data), 'bytes': len(data), 'derived': d['maker']}
        tgt = cfg['frames'][d['frame']] if d['frame'] is not None else cfg
        tgt.setdefault('derived', {})[d['key']] = meta
    for f in cfg['frames'] + [cfg]:      # файлы кадров и файлы здания (лист частиц)
        f['files'] = {k: 'frames/%s?v=%s' % (fn, manifest['files'][fn]['sha256'][:8]) for k, fn in f.get('files', {}).items()}
    depth = page.count('/')
    cfg['engine'] = {'base': '../' * depth + eng_root + 'e/%s/' % ver, 'version': ver}
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
    for fn, (data, _) in made.items():
        (out / 'frames' / fn).write_bytes(data)
    (out / 'frames' / 'manifest.json').write_text(man_text, encoding='utf-8')
    (out / 'build.json').write_text(json.dumps(stamp, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    (out / 'index.html').write_text(html, encoding='utf-8')
    if not quiet:
        print('собрано: %s (e2 %s, кадров %d, файлов %d + производных %d)' % (page, ver, len(cfg['frames']), len(files), len(made)))
    return page


def page_config(site, page):
    html = (Path(site) / page / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'window\.E2_BUILDING = (\{.*\});</script>', html)
    return json.loads(m.group(1).replace('<\\/', '</')), html


# ---------------------------------------------------------------- перенос настроек v1 → format 2 (П1: parallax + tod)
# ключи tuning v1, которые уже перенесены в effects (или сознательно не переезжают: свет кодом — LAMP_BREATH → lights, NIGHT_MAIN_WINS)
TUNING_MOVED = ('MAX_SHIFT_X', 'MAX_SHIFT_Y', 'ZOOM_NEAR', 'BREATH_AMPLITUDE', 'BUILDING_DEPTH_PIXEL', 'LAMP_BREATH', 'NIGHT_MAIN_WINS')
TUNING_MOVED_FX = {'weather': ('WEATHER', 'WX_PARTICLES', 'RAIN_DROPS'),     # переезжают вместе со своим эффектом (пока его нет в схеме — notYet)
                   'sky': ('CLOUD_FIELD', 'CLOUD_FIELD_NIGHT', 'CLOUD_FIELD_SCALE', 'CLOUD_FIELD_SPEED')}
FRAME_MOVED_FX = {'weather': ('snowMask', 'wx'), 'sky': ('cloudShadow',), 'actors': ('poses',), 'show': ('showVideo', 'parade')}


def frame_sky(f, kind, cf):
    """Небо кадра v1 → effects.sky кадра: сила тени облаков (cloudShadow × CLOUD_FIELD; 0 в e1.62 читался как 0,12) и плывущие облака
    рисунка (первая деталь pix с kind: drift). Интерьер — без неба (в e1.62 тени облаков шли и под крышей — не переносится)."""
    if kind == 'interior':
        return {'shadow': 0, 'drift': False}
    s = {'shadow': round((f.get('cloudShadow') or 0.12) * (cf or 1), 4), 'drift': False}
    for p in f.get('pix') or []:
        if p.get('kind') == 'drift':
            s['drift'] = {'box': p['box'], 'px': p['p'][0], 'periodS': p['p'][1], 'phase': p['p'][2] if len(p['p']) > 2 else 0}
            break
    return s


def frame_weather(f, kind, fdir):
    """Погода кадра v1 → effects.weather кадра: frames[].wx (множители e1.48), snowMask, радуга из поз (wx: after)."""
    k = (f.get('wx') or {}).get('k', [1, 1, 1, 1])
    parts = (f.get('wx') or {}).get('particles', True)
    on = kind != 'interior' and bool(parts) and any(k[:3])
    w = {'rain': on, 'snow': on, 'snowMask': on and bool(f.get('snowMask')) and bool(k[3]) and (fdir / (f['name'] + '_snow.webp')).is_file()}
    for a in (f.get('poses') or {}).get('actors', []):
        if a.get('wx') == 'after' and a.get('srcs'):
            w['rainbow'] = {'file': a['srcs'][0], 'rect': [round(min(max(x, 0), 1), 5) for x in a['rect']]}
    return w


def _iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
    return ix * iy / u if u > 0 else 0


def frame_actors(f, kind, wx):
    """Позы и ролики v1 (frames[].poses, e1.44–e1.59) → effects.actors кадра (docs/STANOK.md §4.6). Записи с перекрывающимися
    прямоугольниками — один герой; ролики по часам зрителя: утро и день → media.day, вечер и ночь (19–5) → media.night; погода (wx) —
    картинка Gemini + ролик поверх неё в одном варианте; tap — ролик тапа (poses.tap.hit — место). Радуга (wx: after) — эффект weather.
    Карты тона (poses.tone) не переезжают: тон «версия / день» движок считает сам. emotion — у героя есть дневная петля и свои
    варианты на каждую погоду кадра (стандарт изюминки)."""
    P = f.get('poses') or {}
    groups = []
    for a in P.get('actors', []):
        if a.get('wx') == 'after':
            continue
        g = next((q for q in groups if _iou(q['rect'], a['rect']) >= 0.4), None)
        if g is None:
            g = {'rect': a['rect'], 'items': []}
            groups.append(g)
        g['items'].append(a)
    out = []
    for g in groups:
        first = next((a for a in g['items'] if a.get('video')), g['items'][0])
        stem = (first.get('video') or (first.get('srcs') or ['x'])[0]).rsplit('.', 1)[0]
        stem = re.sub(r'^(vid_|show_wx_|show_pose_)', '', stem)
        toks = stem.split('_')
        aid = '-'.join(toks[:2] if first.get('video') else toks)
        media, imgs = {}, {}
        var = lambda a: {k: v for k, v in (('name', a['video'].rsplit('.', 1)[0]), ('rect', [round(x, 5) for x in a['rect']]), ('video', a['video']),
                                            ('mask', a.get('mask')), ('hours', a.get('hours'))) if v is not None}
        for a in g['items']:
            w = a.get('wx')
            slots = ['rain', 'snow'] if w is True else ([w] if w else [])
            if not a.get('video'):
                for sl in slots:
                    imgs[sl] = a
                continue
            v = var(a)
            if a.get('tap'):
                media['tap'] = v
            elif slots:
                for sl in slots:
                    media.setdefault(sl, []).append(dict(v))
            else:
                h = a.get('hours')
                if h and h[0] > h[1]:
                    media.setdefault('night', []).append(v)
                else:
                    media.setdefault('day', []).append(v)
        for sl, im in imgs.items():      # картинка погоды (Gemini) — под роликом той же погоды; ролика нет — одна картинка
            src = im['srcs'][0]
            if media.get(sl):
                for v in media[sl]:
                    v['image'] = src
                    if [round(x, 5) for x in im['rect']] != v['rect']:
                        v['imageRect'] = [round(x, 5) for x in im['rect']]
            else:
                media[sl] = [{'name': src.rsplit('.', 1)[0], 'rect': [round(x, 5) for x in im['rect']], 'image': src}]
        if 'night' not in media and 'day' in media:
            media['night'] = 'drawing'
        ws = [k for k in ('rain', 'snow') if wx.get(k)]
        a = {'id': aid, 'emotion': bool(media.get('day')) and all(media.get(k) for k in ws), 'rect': [round(x, 5) for x in g['rect']], 'media': media}
        tp = P.get('tap')
        if tp and 'tap' in media:
            a['hit'] = [round(x, 5) for x in tp['hit']]
        out.append(a)
    return out


def frame_show(f):
    """Шоу кадра v1 (showVideo e1.50 + fx.cam e1.43 + fx.tod e1.45, кнопка парада со стилем fx) → effects.show кадра.
    Детали шоу кодом (fx.items: буквы, свечи, «кино», призрак) в e2 не переезжают этим шагом — они остаются в notYet."""
    sv, fx = f.get('showVideo'), f.get('fx') or {}
    if not sv:
        return {'type': 'none'}
    v = {k: sv[k] for k in ('rect', 'video', 'mask', 't', 'fade', 'diff', 'keep', 'eraseV') if sv.get(k) is not None}
    v['rect'] = [round(min(max(x, 0), 1), 6) for x in v['rect']]
    out = {'type': 'video', 'dur': fx.get('dur', sv['t'][1] + 1), 'video': v, 'tod': fx.get('tod')}
    if fx.get('cam'):
        out['cam'] = {k: fx['cam'][k] for k in ('at', 'zoom', 'to', 't') if k in fx['cam']}
    return out


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
           'sunsetShade': {'length': sm['length'], 'strength': sm['strength'], 'dark': sm['dark']},
           'night': {'dim': (look.get('night') or {}).get('dim', get('NIGHT_DIM'))}}
    # огни (П2): мерцание nglow и фонари кодом e1.62 не переезжают — их заменяет эффект lights; из старого берётся только «дыхание» фонаря
    lights = {'flicker': {'lamp': get('LAMP_BREATH') or 0.03}}
    # погода (П2): доли «пасмурно / мокро» и снег — как видит e1.62; частицы — другие намеренно (листы Gemini в сцене), их цвет не переносится
    fdir = src / v1.get('framesDir', 'frames/')
    lw, W1, sn = lk['weather'], get('WEATHER') or {}, look.get('snow') or {}
    weather = {'fadeMs': get('WEATHER_FADE_MS'), 'overcast': {'gray': lw['overcastGray'], 'dim': lw['overcastDim'], 'sky': lw['overcastSky']}, 'wetDim': lw['wetDim'],
               'rain': {'overcast': W1.get('rain', [0.35])[0], 'wet': W1.get('rain', [0, 0, 0.45])[2], 'drops': min(400, get('RAIN_DROPS') or 380)},
               'snow': {'overcast': W1.get('snow', [0.35])[0], 'accumS': sn.get('accumS', 12), 'meltS': sn.get('meltS', 30), 'tint': lw['snowTint'], 'k': lw['snowK']},
               'sprites': {'flakes': sorted(p.name for p in fdir.glob('show_flake_*.png'))[:8], 'rain': sorted(p.name for p in fdir.glob('show_rain_*.png'))[:8]}}
    # небо (П2): поле теней облаков — те же числа, что у e1.62 (CLOUD_FIELD*); тени туч в непогоду — LOOK.weather.overcastShadow.
    # Режим «два пятна» (CLOUD_FIELD = 0) в e2 не переехал: у эффекта один режим — поле
    sky = {'clouds': {'scale': get('CLOUD_FIELD_SCALE') or 2.4, 'speed': get('CLOUD_FIELD_SPEED') or 0.011, 'night': get('CLOUD_FIELD_NIGHT') or 0,
                      'overcast': lw.get('overcastShadow', 0.3)}}
    if not get('BUILDING_DEPTH_PIXEL'):
        raise SystemExit('перенос: у здания BUILDING_DEPTH_PIXEL = false, а в e2 глубина здания всегда по точкам — сначала пересобрать слои')
    old = json.loads((src / CFG_NAME).read_text(encoding='utf-8')) if (src / CFG_NAME).is_file() else {}
    oldf = {f['name']: f for f in old.get('frames', [])}
    frames, moved = [], {'name', 'caption', 'crop', 'sky', 'sun', 'tiltK', 'noon', 'sunset', 'hidden'}
    moved |= {'nightHalo', 'nightWins', 'nightLamps', 'lamps'}     # свет кодом e1.62 не переезжает (docs/STANOK.md §2.2): ночь — рисунок Gemini + lights
    tun_moved = set(TUNING_MOVED)
    for e in FX:                                                   # ключи эффекта считаются перенесёнными, только когда эффект есть в схеме
        moved |= set(FRAME_MOVED_FX.get(e, ()))
        tun_moved |= set(TUNING_MOVED_FX.get(e, ()))
    not_yet = set()
    for f in v1['frames']:
        tk, end = f.get('tiltK'), f['sky']['end']
        kind = 'wide' if tk is None or tk > 0.5 else ('interior' if end < 0.05 else 'close')
        has_sunset = bool(f.get('sunset', True)) and (src / v1.get('framesDir', 'frames/') / (f['name'] + '_sunset.webp')).is_file()
        fe = {'parallax': {'tilt': 1 if tk is None else tk, 'crop': f.get('crop', [0, 0, 1, 1])},
              'tod': {'sky': {'ref': f['sky']['ref'], 'end': end}, 'noonK': f.get('noon', 1) if look.get('noon') else 0,
                      'sunsetPicture': has_sunset, 'sun': f.get('sun') if end >= stanok_schema.SKY_MIN else None},
              'lights': {},
              'weather': frame_weather(f, kind, fdir),
              'sky': frame_sky(f, kind, get('CLOUD_FIELD'))}
        fe['actors'] = {'list': frame_actors(f, kind, fe['weather'] if kind != 'interior' else {})}
        fe['show'] = frame_show(f)
        g = {'name': f['name'], 'kind': kind}
        if f.get('caption'):
            g['caption'] = f['caption']
        g['effects'] = {e: trim(fe[e], FX[e]['frame'], kind) for e in fe if e in FX}
        for e, v in (oldf.get(f['name'], {}).get('effects') or {}).items():     # то, чего в v1 нет (ветер: box крон — рука станка П3), — из прежнего building.e2.json
            if e in FX and e not in fe:
                g['effects'][e] = v
        g['effects']['tod'].setdefault('sun', fe['tod']['sun'])   # ключ обязателен (null — у кадра без неба)
        g['effects']['tod'].setdefault('sky', {})['end'] = end
        frames.append(g)
        not_yet |= {k for k, v in f.items() if k not in moved and v not in (None, [], {}, False, 0)
                    and not (k == 'fx' and 'show' in FX and not (v or {}).get('items'))}     # fx без деталей кодом = камера и время суток шоу — перенесены
    out = {'format': 2, 'id': v1['id'], 'source': '%s/building.json (v1, движок e1.62)' % bdir,
           'notYet': sorted('frames[].' + k for k in not_yet) + sorted('tuning.' + k for k in tun if k not in tun_moved),
           'text': v1.get('text'), 'look': {'frameSize': look['frameSize'], 'sunSide': look.get('sunSide', 'left')},
           'effects': {e: trim(v, FX[e]['building']) for e, v in (('parallax', par), ('tod', tod), ('lights', lights), ('weather', weather), ('sky', sky)) if e in FX},
           'frames': frames}
    stanok_schema.resolve(out, src / v1.get('framesDir', 'frames/'))     # перенесённое обязано проходить схему
    p = src / CFG_NAME
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('перенесено: %s (кадров %d; ещё не в e2: %d ключей — см. notYet)' % (p.relative_to(ROOT), len(frames), len(out['notYet'])))


# ---------------------------------------------------------------- эталон e1.62 без ещё не перенесённых эффектов (для паритета)
def build_ref(bdir, site, sky=False, show=False):
    """Страница здания на e1.62 (engine/), где выключено всё, чего в e2 ещё нет: актёры, pix (кроме плывущих облаков), шоу, листья, события неба.
    Остаются наклон, время суток, погода, плывущие облака рисунка (pix drift → sky.drift). Кадры те же.
    sky=False — без теней облаков (точный паритет: 0 отличий); sky=True — с ними, как в building.json (паритет теней: с порогом)."""
    import build_pages
    v1 = json.loads((ROOT / bdir / 'building.json').read_text(encoding='utf-8'))
    for f in v1['frames']:
        keep = ('showVideo', 'fx') if show and f.get('showVideo') and not (f.get('fx') or {}).get('items') else ()     # сверка шоу: видео-шоу, камера, время суток остаются
        for k in ('poses', 'leafFly', 'showVideo', 'fx', 'showCaption'):
            if k not in keep:
                f.pop(k, None)
        drift = [q for q in f.pop('pix', None) or [] if q.get('kind') == 'drift'][:1]     # облака рисунка плывут — эффект sky (П2)
        if drift:
            f['pix'] = drift
        f['parade'] = 'fx' if keep else False
        if not sky:
            f['cloudShadow'] = 1e-9     # 0 движок e1.62 читает как «нет значения» и ставит 0,12
        f['life'] = {'day': [], 'sunset': [], 'night': []}
    (v1.get('postcard') or {}).pop('show', None)     # «праздник» на открытке — без шоу снимать нечего
    # Поле облаков e1.62 рисует сцену СЕТКОЙ (тень считается в вершинах): координаты кадра интерполируются по мелким треугольникам
    # и расходятся с обычным прямоугольником на доли пикселя — шум на штрихах (~2 % пикселей). Поэтому точный паритет идёт без теней
    # облаков (и у e2 — ?off=clouds), а тени сравниваются отдельно и с порогом (parity --sky 1).
    if not sky:
        v1.setdefault('tuning', {}).update({'CLOUD_FIELD': 0, 'CLOUD_FIELD_NIGHT': 0})
        v1['tuning'].setdefault('LOOK', {}).setdefault('weather', {})['overcastShadow'] = 0     # тени туч в непогоду — тоже облака (эффект sky)
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
    edir = Path(os.path.normpath(str(site / page / cfg['engine']['base'])))     # e/<версия>/ от корня сайта или внутри беты (beta/e/<версия>/)
    for n in ('viewer.js', 'prep.js'):
        p = edir / n
        if not p.is_file() or p.read_bytes() != (e2 / n).read_bytes():
            probs.append('%s/%s на сайте не совпадает с e2/%s' % (os.path.relpath(edir, site), n, n))
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
        ('тени облаков в интерьере', mod(lambda b: (f0(b).update({'kind': 'interior'}), f0(b)['effects']['parallax'].update({'tilt': 0.2}), f0(b)['effects']['tod'].update({'sun': None}), f0(b)['effects']['tod']['sky'].update({'end': 0.01}), f0(b)['effects'].update({'weather': {}, 'sky': {'shadow': 0.15}}))), 'неба нет'),
        ('прямоугольник плывущих облаков не от верха кадра', mod(lambda b: f0(b)['effects'].setdefault('sky', {}).update({'drift': {'box': [0, 0.3, 1, 0.5], 'px': 20, 'periodS': 80}})), 'от верха кадра'),
        ('героев с эмоцией меньше двух', mod(lambda b: [a.update({'emotion': False}) for f in b['frames'][1:] for a in (f['effects'].get('actors') or {}).get('list', [])]), 'не меньше двух'),
        ('у изюминки нет варианта в снег', mod(lambda b: next(a for f in b['frames'] for a in (f['effects'].get('actors') or {}).get('list', []) if a.get('emotion'))['media'].pop('snow')), 'снег'),
        ('ролик героя без маски', mod(lambda b: next(a for f in b['frames'] for a in (f['effects'].get('actors') or {}).get('list', []) if a.get('emotion'))['media']['day'][0].pop('mask')), 'маски'),
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
    # бюджет кадра (docs/STANOK.md §5.1): со схемой, где бюджет заведомо мал, настройки обязаны остановиться и назвать самый дорогой эффект
    S = stanok_schema.load_schema()
    if S.get('budget'):
        S['budget'] = dict(S['budget'], cost=1)
        try:
            stanok_schema.resolve(json.loads(json.dumps(good)), None, S)
            probs.append('бюджет: кадр дороже бюджета, а настройки прошли')
        except SystemExit as e:
            if 'бюджет кадра' not in str(e) or 'Самый дорогой' not in str(e):
                probs.append('бюджет: сообщение не называет бюджет и самый дорогой эффект (%s)' % str(e)[:120])
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


G6_STATES = 'day,sunset,night,snow,rain'     # все 5 состояний (docs/STANOK.md §6, G6): осадки e2 — строго от часов движка


def gate_g6b(site, page, chrome, frames='0', work=None, states=None):
    """Два прогона с одинаковыми шагами времени обязаны дать одинаковые пиксели (все состояния e2, движение включено:
    «дыхание» камеры, мерцание огней, осадки) + ключ-эхо в prep."""
    work = Path(work or tempfile.mkdtemp(prefix='stanok-g6-'))
    for n in ('a', 'b'):
        r = px(['shoot', '--engine', 'e2', '--site', site, '--page', page, '--out', work / n, '--frames', frames, '--states', states or G6_STATES, '--tilts', 'C,R', '--move', '1'], chrome)
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


def g7_run(site, page, chrome, out, frames=None, buttons=None, query=None):
    """Прогон tools/stanok_g7.mjs. Возвращает список проблем (пустой — зелёный)."""
    out = Path(out)
    args = ['node', str(ROOT / 'tools' / 'stanok_g7.mjs'), '--site', str(site), '--page', page, '--out', str(out), '--chrome', chrome]
    for k, v in (('frames', frames), ('buttons', buttons), ('query', query)):
        if v:
            args += ['--' + k, str(v)]
    r = subprocess.run(args, capture_output=True, text=True)
    jp = out / 'g7.json'
    if not jp.is_file():
        return ['прогон G7 не дал отчёта: ' + (r.stdout + r.stderr).strip()[-300:]]
    rep = json.loads(jp.read_text(encoding='utf-8'))
    try:                                    # листы: PNG → JPG (docs/STANOK.md §6: report/sheet_<кадр>.jpg)
        from PIL import Image
        for F in rep['frames']:
            if F.get('sheet'):
                im = Image.open(out / F['sheet']).convert('RGB')
                im.save(out / F['sheet'].replace('.png', '.jpg'), quality=82)
                os.remove(out / F['sheet'])
    except Exception:                       # нет PIL или нельзя удалить (VM) — остаются PNG
        pass
    return rep['problems']


def gate_g7(site, page, chrome, out, frames=None):
    """Кнопки: настоящий тап по каждой кнопке каждого кадра → виртуальное время → снимок и проверки (tools/stanok_g7.mjs).
    Плюс короткий прогон первого кадра на минимальной ступени (?tier=min): слабый телефон обязан остаться без теней облаков (§5.1)."""
    probs = g7_run(site, page, chrome, out, frames)
    first = (frames or '0').split(',')[0]
    return probs + ['?tier=min: ' + q for q in g7_run(site, page, chrome, Path(out) / 'tier-min', first, 'day', 'tier=min')]


def g1_run(site, page, chrome, out, frames=None, query=None, n=None):
    """Прогон tools/stanok_g1.mjs (ветер). Возвращает список проблем (пустой — зелёный)."""
    out = Path(out)
    args = ['node', str(ROOT / 'tools' / 'stanok_g1.mjs'), '--site', str(site), '--page', page, '--out', str(out), '--chrome', chrome]
    for k, v in (('frames', frames), ('query', query), ('n', n)):
        if v:
            args += ['--' + k, str(v)]
    r = subprocess.run(args, capture_output=True, text=True)
    jp = out / 'g1.json'
    if not jp.is_file():
        return ['прогон G1 не дал отчёта: ' + (r.stdout + r.stderr).strip()[-300:]]
    return json.loads(jp.read_text(encoding='utf-8'))['problems']


def gate_g1(site, page, chrome, out, frames=None):
    """Ветер (эффект wind): кроны качаются, фон за ними стоит, сдвиг не больше потолка, качание плавное (tools/stanok_g1.mjs)."""
    return g1_run(site, page, chrome, out, frames)


def g10_run(site, page, chrome, out, frames=None, query=None, states=None):
    """Прогон tools/stanok_g10.mjs (живость и изюминки). Возвращает список проблем (пустой — зелёный)."""
    out = Path(out)
    args = ['node', str(ROOT / 'tools' / 'stanok_g10.mjs'), '--site', str(site), '--page', page, '--out', str(out), '--chrome', chrome]
    for k, v in (('frames', frames), ('query', query), ('states', states)):
        if v:
            args += ['--' + k, str(v)]
    r = subprocess.run(args, capture_output=True, text=True)
    jp = out / 'g10.json'
    if not jp.is_file():
        return ['прогон G10 не дал отчёта: ' + (r.stdout + r.stderr).strip()[-300:]]
    return json.loads(jp.read_text(encoding='utf-8'))['problems']


def hero_frames(bdir):
    """Кадры с изюминками (emotion: true) — на них G10 по умолчанию."""
    b = read_building(bdir)[0]
    return [i for i, f in enumerate(b['frames']) if any(a.get('emotion') for a in (f.get('effects', {}).get('actors') or {}).get('list', []))]


def gate_g10(site, page, chrome, out, bdir, frames=None):
    """Живость: кадр меняется ≥ 2 % экрана за 5 с; изюминки живут во всех версиях кадра (день, закат, ночь, дождь, снег), не мельче
    minFigure высоты экрана, тап по герою с hit запускает ролик тапа (tools/stanok_g10.mjs). По умолчанию — кадры с изюминками."""
    return g10_run(site, page, chrome, out, frames or ','.join(map(str, hero_frames(bdir))))


# красные случаи G10: каждая поломка обязана дать свою проблему (кадр — первый с изюминкой)
G10_CASES = [('break=actors-sunset', 'day,sunset', 'пропала', '?break=actors-sunset — герой гаснет на закате (старая ошибка e1: «актёр пропал на «Закате»»)'),
             ('break=actors-wxfreeze', 'day,rain,snow', 'замерла', '?break=actors-wxfreeze — в дождь и снег ролик героя стоит'),
             ('off=actors,clouds,skymove,breath,wind,lights', 'day', 'мёртвый кадр', '?off=actors,… — кадр без героев и неба (мёртвый кадр)')]


def selftest_g10(bdir, site, page, chrome):
    if not chrome:
        return [('G10', 'поломки в браузере ПРОПУЩЕНЫ: нет Chrome', None)]
    hf = hero_frames(bdir)
    if not hf:
        return [('G10', 'у здания нет изюминок — самопроверка ПРОПУЩЕНА', None)]
    res = []
    for query, states, expect, title in G10_CASES:
        probs = g10_run(site, page, chrome, tempfile.mkdtemp(prefix='stanok-g10-self-'), str(hf[0]), query, states)
        res.append(('G10', title, any(expect in p for p in probs)))
    return res


# красные случаи ветра (на кадре с деревьями): каждая поломка обязана дать свою проблему
G1_CASES = [('break=wind-smear', 'вне кроны', '?break=wind-smear — фон тянется за кроной (сдвигается картинка, а не крона)'),
            ('break=wind-far', 'вне кроны', '?break=wind-far — крона уходит дальше потолка maxPx'),
            ('break=wind-dead', 'не качается', '?break=wind-dead — ветра нет совсем')]


def selftest_g1(bdir, site, page, chrome):
    if not chrome:
        return [('G1', 'поломки в браузере ПРОПУЩЕНЫ: нет Chrome', None)]
    res = []
    b = read_building(bdir)[0]
    idx = [i for i, f in enumerate(b['frames']) if (f.get('effects', {}).get('wind') or {}).get('on')]
    if not idx:
        return [('G1', 'у здания нет кадров с ветром — самопроверка ПРОПУЩЕНА', None)]
    frames = str(idx[0] if len(idx) == 1 else idx[1])      # кадр с густой кроной (у Погоса — b: кипарисы)
    for query, expect, title in G1_CASES:
        probs = g1_run(site, page, chrome, tempfile.mkdtemp(prefix='stanok-g1-self-'), frames, query, 24)
        res.append(('G1', title, any(expect in p for p in probs)))
    return res


# ---------------------------------------------------------------- вставки (docs/STANOK.md §3) и гейт G3
def frame_index(bdir):
    return {f['name']: i for i, f in enumerate(read_building(bdir)[0]['frames'])}


def g3_render(bdir, chrome, out=None, work=None, states=None, clean=None):
    """G3 по рендеру: страница со вставками против страницы без них (чистые файлы) — на каждой из 5 кнопок вставка обязана быть видна.
    Снимки сцены — tools/stanok_px.mjs; лист «со вставкой / без» — <out>/g3_<кадр>.jpg. clean — готовая папка снимков «без вставок»
    (самопроверка снимает её один раз). Возвращает (проблемы, таблица)."""
    si = stanok_insert
    work = si.work_dir(bdir, work)
    j = si.load_journal(work)
    names = sorted({e['frame'] for e in j['inserts']})
    if not names:
        return [], []
    states = tuple(states or si.G3_STATES)
    b = read_building(bdir)[0]
    idx = {f['name']: i for i, f in enumerate(b['frames']) if f['name'] in names}
    out = Path(out or tempfile.mkdtemp(prefix='stanok-g3-'))
    jobs = [(bdir, out / 'with')] + ([] if clean else [(str(si.clean_copy(bdir, work)), out / 'clean')])
    for src, dest in jobs:
        site = Path(tempfile.mkdtemp(prefix='stanok-g3-site-'))
        page = build(src, site, quiet=True)
        r = px(['shoot', '--engine', 'e2', '--site', site, '--page', page, '--out', dest, '--frames', ','.join(str(i) for i in sorted(idx.values())),
                '--states', ','.join(states), '--tilts', 'C', '--png', '1'], chrome)
        if r.returncode != 0:
            return ['снимки не получились: ' + (r.stdout + r.stderr).strip()[-300:]], []
    clean = Path(clean or out / 'clean')
    probs, rows = si.g3_render_compare(out / 'with', clean, idx, j['inserts'], b['look']['frameSize'], states=states)
    try:                                    # лист: кнопки в ряд, сверху со вставкой, снизу без
        from PIL import Image
        for name, i in idx.items():
            tiles = [[Image.open(d / ('f%d-%s-tC.png' % (i, st))).convert('RGB') for st in states] for d in (out / 'with', clean)]
            w, h = tiles[0][0].size
            sheet = Image.new('RGB', (w * len(states), h * 2), 'white')
            for r_, row in enumerate(tiles):
                for c, im in enumerate(row):
                    sheet.paste(im, (c * w, r_ * h))
            sheet.save(out / ('g3_%s.jpg' % name), quality=85)
    except Exception as e:                  # лист — удобство, не проверка
        print('   (лист G3 не собран: %s)' % str(e)[:120])
    (out / 'g3.json').write_text(json.dumps({'problems': probs, 'rows': rows}, ensure_ascii=False, indent=1), encoding='utf-8')
    return probs, rows


def gate_g3(bdir, chrome, out=None, work=None):
    """Вставка во всех версиях кадра: по файлам (журнал, каждая версия, вне вставок — только шум), идемпотентность (повторная сборка —
    те же байты) и, если есть Chrome, по рендеру 5 кнопок. Возвращает (проблемы, примечание)."""
    si = stanok_insert
    probs, n = si.gate_g3_files(bdir, work)
    probs += si.gate_g3_idem(bdir, work)
    note = ' (вставок в журнале: %d' % n
    if n and chrome:
        rp, rows = g3_render(bdir, chrome, out, work)
        probs += rp
        note += '; 5 кнопок: ' + ', '.join('%s %d px' % (q['button'], q['changedPx']) for q in rows)
    elif n:
        note += '; по рендеру 5 кнопок ПРОПУЩЕНО: нет Chrome'
    return probs, note + ')'


def temp_building(bdir, name):
    """Копия папки здания для опытов и самопроверок: файлы кадра name — настоящими копиями (в них пишет вставка), остальное — ссылками."""
    si = stanok_insert
    src, fdir = si.bpath(bdir), si.frames_dir(bdir)
    tmp = Path(tempfile.mkdtemp(prefix='stanok-tb-')) / src.name
    (tmp / 'frames').mkdir(parents=True)
    own = {fn for _, fn in si.frame_files(name)}
    for p in fdir.iterdir():
        if p.name in own:
            shutil.copyfile(p, tmp / 'frames' / p.name)
        else:
            os.symlink(p, tmp / 'frames' / p.name)
    for cfg in (CFG_NAME, 'migration-allowed.json'):
        if (src / cfg).is_file():
            c = json.loads((src / cfg).read_text(encoding='utf-8'))
            if cfg == CFG_NAME:
                c['framesDir'] = 'frames/'
            (tmp / cfg).write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding='utf-8')
    return tmp


def selftest_edit(bdir):
    """Тестовая «правка» для самопроверки G3 на любом здании: кусок самого рисунка с перевёрнутой серединой (пиксели того же рисунка,
    ничего не дорисовано; живёт только во временной копии). Возвращает (кадр, прямоугольник, файл правки) — место без героев."""
    import numpy as np
    from PIL import Image
    si = stanok_insert
    b = read_building(bdir)[0]
    fdir = si.frames_dir(bdir)
    order = sorted(b['frames'], key=lambda f: (not (fdir / (f['name'] + '_sunset.webp')).is_file(), not (fdir / (f['name'] + '_night.webp')).is_file()))
    for f in order:
        day = si.read_img(fdir / (f['name'] + '.webp'))[..., :3]
        H, W = day.shape[:2]
        rects = [a['rect'] for a in ((f.get('effects') or {}).get('actors') or {}).get('list', [])]
        for v0 in (0.62, 0.72, 0.5, 0.38):
            for u0 in (0.34, 0.12, 0.56):
                box = [u0, v0, u0 + 0.3, v0 + 0.17]
                if any(si._inter([box[0] - 0.05, box[1] - 0.05, box[2] + 0.05, box[3] + 0.05], r) > 0 for r in rects):
                    continue
                x0, y0, x1, y1 = si.box_px(box, W, H)
                c = day[y0:y1, x0:x1].copy()
                h, w = c.shape[:2]
                ya, yb, xa, xb = int(h * 0.3), int(h * 0.7), int(w * 0.3), int(w * 0.7)
                if c[ya:yb, xa:xb].std() < 14:
                    continue
                c[ya:yb, xa:xb] = c[ya:yb, xa:xb][::-1, ::-1]
                p = Path(tempfile.mkdtemp(prefix='stanok-edit-')) / 'selftest_edit.png'
                Image.fromarray(c).save(p)
                return f['name'], box, p
    return None


def selftest_g3(bdir, chrome):
    """Красные случаи G3 (во временной копии здания, журнал настоящего здания не трогается)."""
    si = stanok_insert
    t = selftest_edit(bdir)
    if not t:
        return [('G3', 'нет места для тестовой вставки без героев — самопроверка ПРОПУЩЕНА', None)]
    name, box, edit = t
    res = []

    def fresh(only=None):
        tb, work = temp_building(bdir, name), Path(tempfile.mkdtemp(prefix='stanok-work-'))
        si.insert(str(tb), name, edit, box, kind='flat', iid='selftest', work=work, only=only, quiet=True)
        return tb, work
    tb, work = fresh()
    ok_files = not si.gate_g3_files(str(tb), work)[0] and not si.gate_g3_idem(str(tb), work)
    res.append(('G3', 'контроль: обычная вставка во все версии — зелёный', ok_files))
    tb1, w1 = fresh(only=('day',))
    p1 = si.gate_g3_files(str(tb1), w1)[0]
    res.append(('G3', 'вставка только в день (--only day, урок pp-17): нет на закате и ночью', any('закат' in q or 'ночь' in q for q in p1)))
    os.environ['STANOK_BREAK'] = 'insert-dup'
    try:
        res.append(('G3', 'повторная вставка поверх уже собранных файлов (двойная надпись)', len(si.gate_g3_idem(str(tb), work)) > 0))
    finally:
        del os.environ['STANOK_BREAK']
    tb2, w2 = fresh()
    night = name + '_night.webp'
    (tb2 / 'frames' / night).write_bytes((w2 / 'base' / night).read_bytes())      # «новую ночь положили руками» — вставка в ней пропала
    res.append(('G3', 'версию перезаписали мимо станка (новая ночь положена руками)', any('мимо станка' in q for q in si.gate_g3_files(str(tb2), w2)[0])))
    si.replay(str(tb2), work=w2, quiet=True)
    res.append(('G3', 'контроль: replay возвращает вставку в перезаписанную версию', not si.gate_g3_files(str(tb2), w2)[0]))
    if chrome:
        g = Path(tempfile.mkdtemp(prefix='stanok-g3-self-'))
        rp, rows = g3_render(str(tb), chrome, g / 'ok', work)
        res.append(('G3', 'контроль по рендеру: обычная вставка видна на 5 кнопках', not rp and len(rows) == 5))
        # свои снимки «без вставки»: чистая страница перекодирует ровно те файлы, что перекодировала вставка, — чужие снимки дали бы шум WebP
        rp1, rows1 = g3_render(str(tb1), chrome, g / 'only-day', w1, states=('day', 'sunset', 'night'))
        res.append(('G3', 'по рендеру: вставка только в день не видна на «Закате» или «Ночью»', any('sunset' in q or 'night' in q for q in rp1)))
    else:
        res.append(('G3', 'по рендеру 5 кнопок ПРОПУЩЕНО: нет Chrome', None))
    return res


# ---------------------------------------------------------------- самопроверки (красные случаи)
BREAK_FX = '''// ТЕСТОВЫЙ эффект самопроверки G6: движение по настоящим часам и случайности (так делать нельзя).
E2.effect({ name: 'tod_break', glsl: function () { return null; },
  step: function (S) { S.shiftX += 0.004 * Math.random() + 0.000001 * (performance.now() % 1000); } });
'''


def copy_e2():
    tmp = Path(tempfile.mkdtemp(prefix='stanok-e2-')) / 'e2'
    shutil.copytree(E2, tmp)
    return tmp


def selftest(bdir, gates, chrome, e1site=None):
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
            res.append(('G6', '(б) два прогона с эффектом мимо часов дают разные пиксели', red(gate_g6b(s5, p5, chrome, states='day,sunset'))))
            res.append(selftest_e1_rain(e1site, chrome))
        else:
            res.append(('G6', '(б) ПРОПУЩЕНО: нет Chrome', None))
    if 'G7' in gates:
        res += selftest_g7(bdir, site, page, chrome)
    if 'G1' in gates:
        res += selftest_g1(bdir, site, page, chrome)
    if 'G10' in gates:
        res += selftest_g10(bdir, site, page, chrome)
    if 'G3' in gates:
        res += selftest_g3(bdir, chrome)
    if 'G2' in gates:
        res += stanok_layers.selftest_g2(bdir)
    if 'G9' in gates:
        res += stanok_layers.selftest_g9(bdir)
    return res


def selftest_e1_rain(e1site, chrome, page='kukuruznik', runs=3):
    """Красный случай G6(б) на старом движке (находка П0, docs/STANOK.md §4.2): дождь e1.62 под виртуальным временем и с зафиксированной
    случайностью даёт РАЗНЫЕ снимки в двух прогонах одной и той же страницы. Проверка «два прогона — одни пиксели» обязана это
    поймать. e1site — копия сайта на e1.62 с Кукурузником (эталон П0: report/stanok-p0/site-before.tgz, распаковать). Расхождение
    случается не в каждой паре прогонов (в П0 — в половине), поэтому прогонов до трёх: красный, как только два разошлись."""
    title = 'дождь e1.62 (Кукурузник): два прогона одной страницы расходятся'
    if not e1site:
        return ('G6', title + ' — ПРОПУЩЕНО: нужен --e1site ПАПКА (распакованный report/stanok-p0/site-before.tgz)', None)
    if not (Path(e1site) / page / 'index.html').is_file():
        return ('G6', title + ' — ПРОПУЩЕНО: в %s нет страницы %s' % (e1site, page), None)
    seen = []
    for n in range(runs):
        out = Path(tempfile.mkdtemp(prefix='stanok-e1rain-'))
        r = subprocess.run(['node', str(ROOT / 'tools' / 'stanok_look.mjs'), '--site', str(e1site), '--page', page, '--out', str(out), '--chrome', chrome,
                            '--frames', '0,1', '--states', 'day,snow,rain', '--tilts', 'C'], capture_output=True, text=True)
        shots = sorted((out / page).glob('f*-rain-tC.png'))
        if len(shots) < 2:
            return ('G6', title + ' — прогон не дал снимков: ' + (r.stdout + r.stderr).strip()[-200:], False)
        seen.append([sha(p.read_bytes()) for p in shots])
        if any(seen[-1] != q for q in seen[:-1]):
            return ('G6', title + ' (на %d-м прогоне)' % (n + 1), True)
    return ('G6', title + ' — за %d прогона не разошлись (в П0 расходились в половине пар)' % runs, False)


def selftest_g7(bdir, site, page, chrome):
    """Красные случаи G7 (на первом кадре): каждая известная поломка обязана дать свою проблему."""
    res = []
    # убрали ночной рисунок кадра — сборка обязана остановиться (ночи «фильтром» в e2 нет)
    src = (ROOT / bdir if not Path(bdir).is_absolute() else Path(bdir))
    b = read_building(bdir)[0]
    tmp = Path(tempfile.mkdtemp(prefix='stanok-g7-nonight-'))
    (tmp / 'frames').mkdir()
    gone = b['frames'][0]['name'] + '_night.webp'
    for p in (src / b.get('framesDir', 'frames/')).iterdir():
        if p.name != gone:
            os.symlink(p, tmp / 'frames' / p.name)
    (tmp / CFG_NAME).write_text(json.dumps(dict(b, framesDir='frames/'), ensure_ascii=False), encoding='utf-8')
    s0 = Path(tempfile.mkdtemp(prefix='stanok-self-'))
    try:
        build(str(tmp), s0, quiet=True)
        res.append(('G7', 'убрали <кадр>_night.webp — сборка обязана остановиться', False))
    except SystemExit as e:
        res.append(('G7', 'убрали <кадр>_night.webp — сборка обязана остановиться', gone in str(e) and not any(s0.rglob('*'))))
    if not chrome:
        res.append(('G7', 'поломки в браузере ПРОПУЩЕНЫ: нет Chrome', None))
        return res
    cases = [('break=tod', 'day,sunset,night', 'кнопка не работает', '?break=tod — кнопки времени суток ничего не делают'),
             ('break=lights-all', 'day,night', 'разом', '?break=lights-all — все окна зажигаются разом, а не по одному'),
             ('break=lights-cells', 'day,night', 'клетки', '?break=lights-cells — мерцание клетками, а не по огню целиком'),
             ('break=bar-cover', 'day', 'закрывают изюминку', '?break=bar-cover — кнопки поверх старика (как плашка 09.11)')] + G7_WX_CASES + G7_SKY_CASES
    for query, buttons, expect, title in cases:
        frames = '0'
        if isinstance(buttons, tuple):
            buttons, frames = buttons
            if frames == 'interior':
                idx = [i for i, f in enumerate(b['frames']) if f.get('kind') == 'interior']
                if not idx:
                    res.append(('G7', title + ' — ПРОПУЩЕНО: у здания нет интерьера', None))
                    continue
                frames = str(idx[0])
        probs = g7_run(site, page, chrome, tempfile.mkdtemp(prefix='stanok-g7-self-'), frames, buttons, query)
        res.append(('G7', title, any(expect in p for p in probs)))
    return res


# красные случаи погоды (эффект weather). Интерьер — кадр kind: interior здания (у Погоса — 5-й); нет такого кадра — случай пропускается.
G7_WX_CASES = [('break=precip-pop', 'day,snow,rain', 'из ниоткуда', '?break=precip-pop — частицы появляются посреди кадра разом («шарики из ниоткуда»)'),
               ('break=precip-noland', 'day,snow', 'сквозь', '?break=precip-noland — снежинки летят сквозь крыши и землю'),
               ('break=snow-flat', 'day,snow', 'не сверху вниз', '?break=snow-flat — снег проявляется везде разом, а не сверху вниз'),
               ('break=wx-interior', ('day,snow,rain', 'interior'), 'не должно', '?break=wx-interior — осадки в интерьере')]


# красные случаи неба (эффект sky); все — в «Дне»
G7_SKY_CASES = [('break=sky-still', 'day', 'стоят', '?break=sky-still — небо не идёт по часам: тени облаков стоят'),
                ('break=sky-hard', 'day', 'резкий', '?break=sky-hard — тень облаков с резким краем'),
                ('break=sky-thick', 'day', 'гуще', '?break=sky-thick — тень облаков втрое гуще заданной'),
                ('break=sky-all', 'day', 'на небе', '?break=sky-all — тень облаков лежит и на небе'),
                ('break=sky-interior', ('day', 'interior'), 'не должно', '?break=sky-interior — тени облаков в интерьере'),
                ('tier=min&break=sky-min', 'day', 'минимальной', '?tier=min&break=sky-min — на минимальной ступени тени облаков не выключились')]


def check(bdir, gates, chrome, do_selftest, frames=None, out=None, e1site=None):
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
    if 'G1' in gates:
        if chrome:
            g1out = (Path(out) / 'g1') if out else Path(tempfile.mkdtemp(prefix='stanok-g1-'))
            show('G1', gate_g1(site, page, chrome, g1out, frames), ' (кадры: %s; лист и числа: %s)' % (frames or 'все с ветром', g1out))
        else:
            print('G1 ПРОПУЩЕНО: нет Chrome (ветер проверяется только в браузере)')
    if 'G2' in gates:
        probs, rows = stanok_layers.gate_g2(bdir, frames)
        show('G2', probs, ' (кайма по файлам слоя здания: %d кадров; часть (б) — контур на рендере при наклоне — ещё не в станке)' % len(rows))
    if 'G3' in gates:
        probs, note = gate_g3(bdir, chrome, (Path(out) / 'g3') if out else None)
        show('G3', probs, note)
    if 'G9' in gates:
        probs, rows = stanok_layers.gate_g9(bdir, frames)
        show('G9', probs, ' (версий против дня: %d; наибольший сдвиг %d px)' % (len(rows), max([max(abs(q.get('dx', 0)), abs(q.get('dy', 0))) for q in rows] or [0])))
    if 'G5' in gates:
        show('G5', gate_g5(site, page, bdir))
    if 'G6' in gates:
        probs = gate_g6a()
        if chrome:
            probs += gate_g6b(site, page, chrome)
            show('G6', probs)
        else:
            show('G6', probs, ' — только (а) поиск по исходникам; (б) два прогона ПРОПУЩЕНО: нет Chrome')
    if 'G7' in gates:
        if chrome:
            g7out = Path(out) if out else Path(tempfile.mkdtemp(prefix='stanok-g7-'))
            show('G7', gate_g7(site, page, chrome, g7out, frames), ' (кадры: %s; листы и числа: %s)' % (frames or 'все', g7out))
        else:
            print('G7 ПРОПУЩЕНО: нет Chrome (кнопки проверяются только в браузере)')
    if 'G10' in gates:
        if chrome:
            g10out = (Path(out) / 'g10') if out else Path(tempfile.mkdtemp(prefix='stanok-g10-'))
            show('G10', gate_g10(site, page, chrome, g10out, bdir, frames), ' (кадры: %s; листы и числа: %s)' % (frames or 'с изюминками', g10out))
        else:
            print('G10 ПРОПУЩЕНО: нет Chrome (живость проверяется только в браузере)')
    if 'G8' in gates:
        probs, n = gate_g8(bdir)
        show('G8', probs, ' (%d испорченных настроек + целые)' % n)
    if 'G13' in gates:
        show('G13', gate_g13(site, page))
    if do_selftest:
        print('--- самопроверка: гейт обязан покраснеть на известной поломке ---')
        for g, case, ok in selftest(bdir, gates, chrome, e1site):
            if ok is None:
                print('%s самопроверка: %s' % (g, case))
            else:
                print('%s самопроверка %s: %s' % (g, 'ок (покраснел)' if ok else 'ПРОВАЛ (не покраснел)', case))
                bad += 0 if ok else 1
    print('ИТОГ: %s' % ('всё зелёное' if not bad else 'красных: %d' % bad))
    return 1 if bad else 0


SKY_NOISE = (3, 0.06)      # паритет теней облаков: канал > 3 не больше чем у 6 % пикселей снимка. Откуда: e1.62 с полем облаков рисует сцену
                           # сеткой — без единой ошибки переноса ≈ 2–3 % пикселей на штрихах расходятся больше чем на 3 (замер П1 и П2)
SKY_SHIFT_S = 25           # красный случай: небо e2 сдвинуто на столько секунд — тени лежат в других местах, паритет обязан покраснеть


def parity(bdir, out, chrome, frames=None, states='day,sunset,night,rain,snow', delta=None, share=None, tilts='L,C,R', sky=False, settle=None):
    """Сцена e2 против сцены e1.62 (без ещё не перенесённых эффектов). Пиксель «другой», если канал отличается больше delta;
    снимок красный, если таких пикселей больше share (доля).
    Обычный прогон — без теней облаков у обоих движков: порог 3 / 0,05 % (на деле 0 отличий). Облака рисунка плывут у обоих (время неба
    e2 ставится по часам e1.62 в момент каждого снимка).
    sky=True — паритет теней облаков: оба движка с тенями, порог SKY_NOISE (шум сетки e1.62), и обязательный красный случай: то же
    со сдвигом неба e2 на SKY_SHIFT_S секунд обязано покраснеть (иначе порог ничего не ловит)."""
    if not chrome:
        print('ПРОПУЩЕНО: нет Chrome')
        return 2
    delta = (SKY_NOISE[0] if sky else 3) if delta is None else delta
    share = (SKY_NOISE[1] if sky else 0.0005) if share is None else share
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    s1, s2 = Path(tempfile.mkdtemp(prefix='stanok-par-e1-')), Path(tempfile.mkdtemp(prefix='stanok-par-e2-'))
    p1, p2 = build_ref(bdir, s1, sky=sky), build(bdir, s2, quiet=True)
    fa = ['--frames', frames] if frames else []
    fa += ['--settle', settle] if settle else []
    allow = (ROOT / bdir if not Path(bdir).is_absolute() else Path(bdir)) / 'migration-allowed.json'      # разрешённые отличия здания (docs/STANOK.md §2.4 п.5)
    off = sorted({q['off'] for q in json.loads(allow.read_text(encoding='utf-8')).get('allowed', []) if q.get('off')}) if allow.is_file() else ['precip']
    off = sorted(set(off) | {'wind', 'actors'})        # ветер e2 — новое, в e1.62 так нет: сцена сравнивается без него (его проверяет G1)
    if not sky:
        off = sorted(set(off) | {'clouds'})

    def shoot(eng, site, page, dest, extra=()):
        # частицы осадков в e2 другие намеренно (migration-allowed.json, записи с ключом off): сравнивается сцена без них; у e1.62 они на отдельном холсте
        qa = (['--query', 'off=' + ','.join(off)] if off else []) + ['--times', out / 'e1' / 'index.json'] + list(extra) if eng == 'e2' else []
        r = px(['shoot', '--engine', eng, '--site', site, '--page', page, '--out', dest, '--states', states, '--tilts', tilts, '--png', '1'] + fa + qa, chrome)
        print(r.stdout.strip()[-400:])
        if r.returncode != 0:
            print(r.stderr.strip()[-600:])
        return r.returncode
    if shoot('e1', s1, p1, out / 'e1') or shoot('e2', s2, p2, out / 'e2'):
        return 1
    al = (['--allow', allow] if allow.is_file() else []) + (['--only', 'sky'] if sky else [])
    r = px(['compare', out / 'e1', out / 'e2', '--delta', delta, '--share', share, '--report', out / 'parity.json'] + al, chrome)
    print(r.stdout.strip())
    code = r.returncode
    if sky:
        if shoot('e2', s2, p2, out / 'e2-shift', ['--timeshift', SKY_SHIFT_S]):
            return 1
        r2 = px(['compare', out / 'e1', out / 'e2-shift', '--delta', delta, '--share', share, '--report', out / 'parity-shift.json'] + al, chrome)
        rows = [q for q in json.loads((out / 'parity-shift.json').read_text())['rows'] if 'red' in q]
        red = sum(1 for q in rows if q['red'])
        print('красный случай (небо e2 сдвинуто на %d с): красных %d из %d — %s' % (SKY_SHIFT_S, red, len(rows), 'ок (покраснел)' if r2.returncode else 'ПРОВАЛ (не покраснел: порог ничего не ловит)'))
        code = code or (0 if r2.returncode else 1)
    return code


def publish_beta_e2(bdir, dry=False):
    """Бета e2 на сайт (только советник; агент из промпта не запускает): временный worktree от origin/main → страница
    beta/tests/<slug>-e2/ + движок beta/e/<версия>/ → G5 и G13 на собранном → коммит ТОЛЬКО этих папок → обычный пуш в main.
    Бета e1.62 (beta/tests/<slug>/) и всё остальное в main не трогаются. Внимание: tools/publish_beta.py пересобирает beta/ целиком —
    после него страницу e2 нужно выложить заново этой командой (пока build_pages не умеет e2 — П5)."""
    import publish_beta as pb
    tag = '[dry-run] ' if dry else ''
    slug = bdir.split('/')[-1]
    page = BETA_PAGE % slug
    pb.git(ROOT, 'fetch', pb.REMOTE, pb.BRANCH)
    base = pb.git(ROOT, 'rev-parse', '%s/%s' % (pb.REMOTE, pb.BRANCH))
    tmp = Path(tempfile.mkdtemp(prefix='chka-beta-e2-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, pb.REMOTE, pb.BRANCH, base[:7]))
    try:
        pb.git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        build(bdir, tmp, page, eng_root='beta/')
        probs = gate_g5(tmp, page, bdir) + gate_g13(tmp, page)
        if probs:
            raise SystemExit('%sпубликация остановлена: %s' % (tag, '; '.join(probs[:5])))
        ver = build_engine.version(E2)
        pb.git(tmp, 'add', '-A', page.rstrip('/'), 'beta/e/%s' % ver)
        staged = pb.git(tmp, 'diff', '--cached', '--name-only').splitlines()
        outside = [p for p in staged if not (p.startswith(page) or p.startswith('beta/e/'))]
        if outside:
            raise SystemExit('%sв коммит попало что-то кроме %s и beta/e/: %s — стоп' % (tag, page, outside[:5]))
        if not staged:
            print('%sизменений нет — публиковать нечего' % tag)
            return 0
        print('%sфайлов в коммите: %d (%s + beta/e/%s)' % (tag, len(staged), page, ver))
        msg = 'beta e2: %s на %s' % (slug, ver)
        if dry:
            print('[dry-run] СДЕЛАЛ БЫ: git commit -m "%s" && git push %s HEAD:%s (обычный пуш)' % (msg, pb.REMOTE, pb.BRANCH))
            print('[dry-run] ссылка после публикации: https://chka.am/%s?v=%s' % (page, ver))
            return 0
        pb.git(tmp, 'commit', '-m', msg)
        head = pb.git(tmp, 'rev-parse', 'HEAD')
        pb.git(tmp, 'push', pb.REMOTE, 'HEAD:%s' % pb.BRANCH)
        print('запушено в %s/%s: %s — https://chka.am/%s?v=%s' % (pb.REMOTE, pb.BRANCH, head[:7], page, ver))
        return 0
    finally:
        pb.remove_worktree(tmp)
        print('%sвременный worktree удалён' % tag)


COMMANDS = 'init, status, intake, layers, crop, insert, replay, migrate, build, sheet, check, beta, parity, showcmp, ref'
SHOW_SECS = {0: [2, 5, 8, 10.5], 1: [3, 8, 14, 20, 26], 2: [2.5, 5, 8, 10.5]}     # секунды сверки шоу A, B, C Погоса: наезд, середина, развязка, угасание


def show_parity(bdir, out, chrome, frames=None):
    """Шоу «до/после» на e2 против e1.62 (эталон: та же страница e1.62 с видео-шоу, камерой и временем суток, без героев и деталей кодом):
    стоп-кадр показа на заданных секундах, день, наклон C, ролик встаёт на свою секунду в обоих движках. Отличия — только из
    migration-allowed.json (как у паритета). Без теней облаков у обоих (их сверяет parity --sky 1)."""
    if not chrome:
        print('ПРОПУЩЕНО: нет Chrome')
        return 2
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    b = read_building(bdir)[0]
    idx = [i for i, f in enumerate(b['frames']) if (f.get('effects', {}).get('show') or {}).get('type', 'none') != 'none']
    if frames:
        idx = [i for i in idx if str(i) in frames.split(',')]
    spec = ';'.join('%d:%s' % (i, ','.join(str(x) for x in SHOW_SECS.get(i, [2, 5, 8]))) for i in idx)
    s1, s2 = Path(tempfile.mkdtemp(prefix='stanok-show-e1-')), Path(tempfile.mkdtemp(prefix='stanok-show-e2-'))
    p1, p2 = build_ref(bdir, s1, show=True), build(bdir, s2, quiet=True)
    allow = (ROOT / bdir if not Path(bdir).is_absolute() else Path(bdir)) / 'migration-allowed.json'
    off = sorted({q['off'] for q in json.loads(allow.read_text(encoding='utf-8')).get('allowed', []) if q.get('off')} | {'clouds', 'wind', 'actors'})
    for eng, site, page, extra in (('e1', s1, p1, []), ('e2', s2, p2, ['--query', 'off=' + ','.join(off), '--times', out / 'e1' / 'index.json'])):
        r = px(['shoot', '--engine', eng, '--site', site, '--page', page, '--out', out / eng, '--show', spec, '--tilts', 'C', '--png', '1'] + extra, chrome)
        print(r.stdout.strip()[-400:])
        if r.returncode != 0:
            print(r.stderr.strip()[-600:])
            return 1
    r = px(['compare', out / 'e1', out / 'e2', '--delta', 3, '--share', 0.0005, '--report', out / 'show.json'] + (['--allow', allow] if allow.is_file() else []), chrome)
    print(r.stdout.strip())
    return r.returncode


def check_story(slug, do_selftest=False):
    """Гейт пакета здания buildings-next/<slug>/ (S1; RUNBOOK §8: пакет из четырёх файлов + чек-лист)."""
    probs = stanok_pack.gate_pack(slug)
    bad = 1 if probs else 0
    print('пакет %s %s' % (slug, 'КРАСНЫЙ' if probs else 'зелёный'))
    for q in probs[:20]:
        print('   - ' + q)
    if do_selftest:
        print('--- самопроверка: гейт обязан покраснеть на известной поломке ---')
        for g, case, ok in stanok_pack.selftest_pack(slug):
            if ok is None:
                print('%s самопроверка: %s' % (g, case))
            else:
                print('%s самопроверка %s: %s' % (g, 'ок (покраснел)' if ok else 'ПРОВАЛ (не покраснел)', case))
                bad += 0 if ok else 1
    print('ИТОГ: %s' % ('всё зелёное' if not bad else 'красных: %d' % bad))
    return 1 if bad else 0


def _of(opt):
    return tuple(int(x) for x in re.split(r'[x,]', opt['of'])) if opt.get('of') else None


def cmd_insert(bdir, pos, opt):
    """stanok.py insert <здание> <кадр> <правка.png> --box … [--layer ground|building] [--kind object|flat|inscription] [--id имя]
    [--night-edit ночная_правка.png] [--inscription "ТЕКСТ" [--spot B1]] [--note …] [--dry-run] · insert <здание> --list · insert <здание> --remove <id>"""
    si = stanok_insert
    work = opt.get('work')
    if opt.get('list'):
        j = si.load_journal(si.work_dir(bdir, work))
        for e in j['inserts']:
            print('%-24s кадр %-10s %-11s %-9s %s  %s' % (e['id'], e['frame'], e['kind'], e['layer'], e['when'], ' '.join('%s:%s' % (v, q['action']) for v, q in e.get('versions', {}).items() if q['action'] not in ('не трогает', 'нет файла'))))
        print('вставок: %d, убранных: %d (журнал: %s)' % (len(j['inserts']), len(j.get('removed', [])), si.work_dir(bdir, work) / 'journal.json'))
        return 0
    if opt.get('remove'):
        e = si.remove(bdir, opt['remove'], work)
        print('вставка «%s» убрана, кадр %s пересобран (запись — в removed журнала)' % (e['id'], e['frame']))
        return 0
    if len(pos) < 3 or 'box' not in opt:
        raise SystemExit(cmd_insert.__doc__)
    text = opt.get('inscription')
    kind = 'inscription' if text else opt.get('kind', 'object')
    if 'only' in opt and not os.environ.get('STANOK_TEST'):
        raise SystemExit('--only — тестовый ключ самопроверки G3 (STANOK_TEST=1); в работе вставка всегда идёт во все версии')
    e = si.insert(bdir, pos[1], pos[2], si.parse_box(opt['box'], _of(opt)), layer=opt.get('layer'), kind=kind, iid=opt.get('id'), night_edit=opt.get('night-edit'),
                  work=work, only=tuple(opt['only'].split(',')) if opt.get('only') else None, text=text, note=opt.get('note'), dry=bool(opt.get('dry-run')))
    if text:
        d = si.deliver(bdir, e, text, opt.get('spot'), dry=bool(opt.get('dry-run')))
        if d:
            print('%sнадпись в building.json: %s' % ('[dry-run] ' if opt.get('dry-run') else '', json.dumps(d, ensure_ascii=False)))
    return 0


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
            if rest[i] in ('--selftest', '--beta', '--dry-run', '--list', '--spare', '--force'):
                opt[rest[i][2:]] = True
            else:
                opt[rest[i][2:]] = rest[i + 1]
                i += 1
        else:
            pos.append(rest[i])
        i += 1
    if cmd == 'check' and opt.get('story'):                      # гейт пакета здания (S1): stanok.py check --story <slug> [--selftest]
        return check_story(opt['story'], bool(opt.get('selftest')))
    if not pos:
        raise SystemExit('нужна папка здания, например tests/pogos-petros')
    if cmd in ('init', 'status'):                                # здесь аргумент — slug пакета buildings-next/<slug>
        slug = pos[0].strip('/').split('/')[-1]
        if cmd == 'init':
            stanok_pack.init(slug, force=bool(opt.get('force')), spare=bool(opt.get('spare')))
        else:
            stanok_pack.status(slug)
        return 0
    bdir = pos[0].strip('/')
    chrome = chrome_path(opt.get('chrome'))
    if cmd == 'migrate':
        migrate(bdir)
    elif cmd == 'build':
        if 'site' not in opt:
            raise SystemExit('нужен --site ПАПКА (копия сайта; в репозиторий страница e2 пока не собирается)')
        if opt.get('beta'):
            build(bdir, opt['site'], BETA_PAGE % bdir.split('/')[-1], eng_root='beta/')
        else:
            build(bdir, opt['site'], opt.get('page'))
    elif cmd == 'beta':
        return publish_beta_e2(bdir, dry=bool(opt.get('dry-run')))
    elif cmd == 'check':
        gates = opt.get('gate', 'G1,G2,G3,G5,G6,G7,G8,G9,G10,G13').split(',')
        return check(bdir, gates, chrome, bool(opt.get('selftest')), opt.get('frames'), opt.get('out'), opt.get('e1site'))
    elif cmd == 'parity':
        return parity(bdir, opt.get('out', tempfile.mkdtemp(prefix='stanok-parity-')), chrome, opt.get('frames'), opt.get('states', 'day,sunset,night,rain,snow'),
                      float(opt['delta']) if 'delta' in opt else None, float(opt['share']) if 'share' in opt else None, opt.get('tilts', 'L,C,R'),
                      sky=opt.get('sky') == '1', settle=opt.get('settle'))
    elif cmd == 'showcmp':
        return show_parity(bdir, opt.get('out', tempfile.mkdtemp(prefix='stanok-show-')), chrome, opt.get('frames'))
    elif cmd == 'intake':
        if len(pos) < 4:
            raise SystemExit('intake: stanok.py intake <здание> <кадр> day|bg|night|sunset|snow <файл>')
        stanok_layers.intake(bdir, pos[1], pos[2], pos[3], opt.get('work'))
    elif cmd == 'layers':
        reps = stanok_layers.layers(bdir, pos[1] if len(pos) > 1 else None, opt.get('work'), opt.get('models'))
        return 1 if any(r.get('g9') or r.get('g2') for r in reps) else 0
    elif cmd == 'sheet':
        if not chrome:
            raise SystemExit('sheet: нужен Chrome (в VM Мака его нет — облако или Терминал Мака)')
        site = Path(tempfile.mkdtemp(prefix='stanok-sheet-'))
        out = Path(opt.get('out') or (ROOT / bdir / 'report'))
        probs = g7_run(site, build(bdir, site, quiet=True), chrome, out, opt.get('frames'))
        print('листы 5 кнопок: %s (sheet_<кадр>.jpg)%s' % (out, ''.join('\n   - ' + q for q in probs[:12])))
        return 1 if probs else 0
    elif cmd == 'crop':
        if len(pos) < 2 or 'box' not in opt or 'out' not in opt:
            raise SystemExit('crop: stanok.py crop <здание> <кадр> --box u0,v0,u1,v1 --out файл.png [--version day|night|sunset]')
        print(json.dumps(stanok_insert.crop(bdir, pos[1], stanok_insert.parse_box(opt['box'], _of(opt)), opt['out'], opt.get('version', 'day'), opt.get('work')), ensure_ascii=False))
    elif cmd == 'insert':
        return cmd_insert(bdir, pos, opt)
    elif cmd == 'replay':
        stanok_insert.replay(bdir, opt['frames'].split(',') if opt.get('frames') else None, opt.get('work'))
    elif cmd == 'ref':
        print(build_ref(bdir, opt['site']))
    else:
        raise SystemExit('неизвестная команда %s (есть: %s)' % (cmd, COMMANDS))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
