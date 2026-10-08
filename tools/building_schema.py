"""Проверка настроек здания (<здание>/building.json) перед сборкой страницы (docs/ENGINE-PLAN.md, п.3).

Ловит ошибки настроек ДО сборки и говорит по-русски, где именно: «кадр 3 (v_angle_2): нет ночной картинки …».
Проверяет: обязательные поля и их типы, неизвестные поля (опечатки), ссылки на кадры и файлы (существуют ли картинки на сайте),
не больше одного кадра с парадом, координаты в пределах 0–1, все видимые тексты на hy/ru/en, набор переопределяемых чисел (tuning).

  errors = validate(bdir, building_dict, site_root)   # список строк; пусто — всё хорошо

Допуски (всё остальное строго): координаты солнца и луны могут выходить за кадр на 0.05 (солнце у самого края рисунка);
описание и подпись превью (meta.description, meta.ogAlt) обязательны только на армянском — превью использует только его.
"""
import json

import posixpath
import re
from pathlib import Path

PARADE_KINDS = ('planes', 'drones', 'heli', 'fireworks', 'balloons', 'banner')   # виды парада (details.js): самолёты с дымом, дроны-флаг, вертолёт с флагом, салют, воздушные шары, знамя на фасаде (крупный план)

LANGS = ('hy', 'ru', 'en')
ENGINE = Path(__file__).resolve().parent.parent / 'engine'


def known_kinds():
    """События живых деталей — берём из details.js, чтобы список не разошёлся с движком."""
    src = (ENGINE / 'details.js').read_text(encoding='utf-8')
    a = src.index('var KINDS = {')
    return sorted(set(re.findall(r'^    (\w+): function \(fr\)', src[a:], re.M)))


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and abs(x) != float('inf')


class Checker:
    def __init__(self, bdir, site):
        self.bdir, self.site, self.errors = bdir, Path(site), []
        self.head = '%s/building.json' % bdir

    def err(self, where, msg):
        self.errors.append('%s: %s: %s' % (self.head, where, msg))

    def errors_since(self, n):
        return len(self.errors) > n

    # --- примитивы ---
    def obj(self, v, where, required=(), optional=()):
        if not isinstance(v, dict):
            self.err(where, 'должен быть объект { … }, а не %s' % type(v).__name__)
            return None
        ok = True
        for k in required:
            if k not in v:
                self.err(where, 'нет обязательного поля «%s»' % k)
                ok = False
        for k in v:
            if k not in required and k not in optional:
                self.err(where, 'неизвестное поле «%s» (опечатка? допустимы: %s)' % (k, ', '.join(list(required) + list(optional))))
                ok = False
        return v if ok else None

    def string(self, v, where, allow_none=False, nonempty=True):
        if v is None and allow_none:
            return True
        if not isinstance(v, str) or (nonempty and not v.strip()):
            self.err(where, 'должна быть непустая строка')
            return False
        return True

    def number(self, v, where, lo=None, hi=None):
        if not is_num(v):
            self.err(where, 'должно быть число, а не %r' % (v,))
            return False
        if (lo is not None and v < lo) or (hi is not None and v > hi):
            self.err(where, 'число %s вне допустимых пределов %s…%s' % (v, lo, hi))
            return False
        return True

    def numbers(self, v, where, n, lo=None, hi=None):
        if not isinstance(v, list) or len(v) != n:
            self.err(where, 'должен быть список из %d чисел, а не %r' % (n, v))
            return False
        return all([self.number(x, '%s[%d]' % (where, i + 1), lo, hi) for i, x in enumerate(v)])

    def boolean(self, v, where):
        if not isinstance(v, bool):
            self.err(where, 'должно быть true или false, а не %r' % (v,))
            return False
        return True

    def i18n(self, v, where, need=LANGS):
        if not isinstance(v, dict):
            self.err(where, 'должен быть объект с текстами %s' % '/'.join(need))
            return
        for l in need:
            if l not in v:
                self.err(where, 'нет текста на языке «%s»' % l)
            elif not isinstance(v[l], str) or not v[l].strip():
                self.err(where, 'текст на «%s» пустой или не строка' % l)
        for l in v:
            if l not in LANGS:
                self.err(where, 'неизвестный язык «%s» (допустимы hy, ru, en)' % l)

    def file(self, rel_path, where, what):
        if not isinstance(rel_path, str):
            return
        p = self.site / posixpath.normpath(posixpath.join(self.bdir, rel_path))
        if not p.exists():
            self.err(where, 'нет %s %s' % (what, posixpath.normpath(posixpath.join(self.bdir, rel_path))))


ROAD_MIN = 0.98   # доля точек пути машины внутри маски дорог (или за перекрытием)


def in_poly(u, v, poly):
    """Точка в многоугольнике (чёт-нечет): кольцо дороги задаётся «замочной скважиной» — внешний контур и внутренний обратным ходом."""
    ins = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > v) != (y2 > v) and u < x1 + (v - y1) * (x2 - x1) / (y2 - y1):
            ins = not ins
    return ins


def chaikin(pts, loop=False):
    """Как в details.js: 2 прохода сглаживания Чайкина (плавные повороты)."""
    pts = [list(p) for p in pts]
    for _ in range(2):
        n = len(pts); out = [] if loop else [pts[0]]
        for i in range(n if loop else n - 1):
            a, b = pts[i], pts[(i + 1) % n]
            out += [[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]]
        if not loop:
            out.append(pts[-1])
        pts = out
    return pts


def path_samples(path, loop=False, step=0.002, aspect=768 / 1365, smooth=True, lane=0.0, size=(0.0, 0.0)):
    """Точки пути через каждые step (в долях высоты кадра); lane — сдвиг вправо по ходу (правостороннее движение), в длинах машины."""
    src = chaikin(path, loop) if smooth else [list(p) for p in path]
    pts = src + ([src[0]] if loop else [])
    seg = []
    for (u1, v1), (u2, v2) in zip(pts, pts[1:]):
        L = ((u2 - u1) * aspect) ** 2 + (v2 - v1) ** 2
        k = max(1, int(L ** 0.5 / step))
        seg += [(u1 + (u2 - u1) * t / k, v1 + (v2 - v1) * t / k, u2 - u1, v2 - v1) for t in range(k)]
    out = []
    for n, (u, v, du, dv) in enumerate(seg):
        if lane:
            s = n / max(1, len(seg) - 1); sz = size[0] + (size[1] - size[0]) * s
            for d in ((1, -1) if not loop else (1,)):
                dx, dy = du * aspect * d, dv * d; L = (dx * dx + dy * dy) ** 0.5 or 1
                out.append((u - dy / L * lane * sz / aspect, v + dx / L * lane * sz))
        else:
            out.append((u, v))
    return out


def road_coverage(am, presets_lane=None):
    """[(доля точек в маске дорог, доля «не на дороге и не за перекрытием» внутри кадра, число точек)] по каждой машине кадра.
    Точки — по сглаженному пути, с полосами в обе стороны (правостороннее движение)."""
    roads, occ = am.get('roads', []), [o['poly'] for o in am.get('occluders', [])]
    lanes = {'soviet-1950s': 0.3, 'trolley-line': 0.3, 'watering': 0.3}
    res = []
    for o in am.get('cars', []):
        pts = path_samples(o['path'], o.get('loop', False), smooth=o.get('smooth', True), lane=o.get('lane', lanes.get(o['preset'], 0.0)), size=o['size'])
        inside = [0 <= u <= 1 and 0 <= v <= 1 for u, v in pts]
        on = [any(in_poly(u, v, r) for r in roads) for u, v in pts]
        hid = [any(in_poly(u, v, q) for q in occ) for u, v in pts]
        hid_off = sum(1 for i in range(len(pts)) if inside[i] and hid[i] and not on[i])   # за домом вне маски — не считаем (перекрытые участки допустимы)
        n_in = max(1, sum(inside) - hid_off)
        on_road = sum(1 for i in range(len(pts)) if inside[i] and on[i]) / n_in
        off = sum(1 for i in range(len(pts)) if inside[i] and not on[i] and not hid[i]) / n_in
        res.append((on_road, off, len(pts)))
    return res


def validate(bdir, b, site):
    c = Checker(bdir, site)
    if not c.obj(b, 'файл', required=('format', 'id', 'meta', 'app', 'links', 'framesDir', 'text', 'facts', 'aboutFacts',
                                      'postcardFile', 'look', 'frames'), optional=('tuning', 'live', 'card')):
        return c.errors
    if b['format'] != 1:
        c.err('format', 'неизвестный формат %r (нужен 1)' % (b['format'],))
    c.string(b['id'], 'id')

    # --- meta ---
    m = c.obj(b['meta'], 'meta', required=('url', 'title', 'description', 'ogImage', 'ogAlt', 'themeColor', 'favicon', 'appleTouchIcon', 'viewerVersion'))
    if m:
        if c.string(m['url'], 'meta.url') and not m['url'].startswith('https://'):
            c.err('meta.url', 'адрес должен начинаться с https://')
        c.i18n(m['title'], 'meta.title')
        c.i18n(m['description'], 'meta.description', need=('hy',))
        c.i18n(m['ogAlt'], 'meta.ogAlt', need=('hy',))
        if c.string(m['themeColor'], 'meta.themeColor') and not re.fullmatch(r'#[0-9a-fA-F]{6}', m['themeColor']):
            c.err('meta.themeColor', 'цвет должен быть вида #f5ecda')
        c.string(m['viewerVersion'], 'meta.viewerVersion')
        if c.string(m['favicon'], 'meta.favicon'):
            c.file(m['favicon'], 'meta.favicon', 'значка страницы')
        if c.string(m['appleTouchIcon'], 'meta.appleTouchIcon'):
            c.file(m['appleTouchIcon'], 'meta.appleTouchIcon', 'значка «на экран Домой»')
        if c.string(m['ogImage'], 'meta.ogImage', allow_none=True) and m['ogImage']:
            c.file(m['ogImage'], 'meta.ogImage', 'картинки превью')
    app = c.obj(b['app'], 'app', required=('name', 'shortName'))
    if app:
        c.string(app['name'], 'app.name')
        c.string(app['shortName'], 'app.shortName')
    lk = c.obj(b['links'], 'links', required=('home', 'history'))
    if lk:
        c.string(lk['home'], 'links.home')
        c.string(lk['history'], 'links.history', allow_none=True)
    if c.string(b['framesDir'], 'framesDir'):
        fd = posixpath.normpath(posixpath.join(bdir, b['framesDir']))
        if not (Path(site) / fd).is_dir():
            c.err('framesDir', 'нет папки с кадрами %s' % fd)
    if c.string(b['postcardFile'], 'postcardFile') and not b['postcardFile'].endswith('.png'):
        c.err('postcardFile', 'имя файла открытки должно оканчиваться на .png')

    # --- тексты ---
    tx = c.obj(b['text'], 'text', required=('title', 'pageTitle', 'plaque', 'panelTitle', 'welcome'))
    if tx:
        for k in tx:
            c.i18n(tx[k], 'text.%s' % k)
    facts = b['facts']
    if not isinstance(facts, dict) or not facts:
        c.err('facts', 'нужен объект с фактами о здании (хотя бы один)')
        facts = {}
    for k, v in facts.items():
        c.i18n(v, 'facts.%s' % k)
    af = b['aboutFacts']
    if not isinstance(af, list) or not all(isinstance(x, str) for x in af):
        c.err('aboutFacts', 'должен быть список ключей фактов')
    else:
        for k in af:
            if k not in facts:
                c.err('aboutFacts', 'факта «%s» нет в facts' % k)

    # --- look ---
    look = c.obj(b['look'], 'look', required=('day', 'night', 'frameSize', 'sunSide'))
    if look:
        d = c.obj(look['day'], 'look.day', required=('skyTop', 'skyHor', 'mix', 'greenHue', 'greenPull', 'greenSat'))
        if d:
            c.numbers(d['skyTop'], 'look.day.skyTop', 3, 0, 1)
            c.numbers(d['skyHor'], 'look.day.skyHor', 3, 0, 1)
            for k in ('mix', 'greenHue', 'greenPull'):
                c.number(d[k], 'look.day.%s' % k, 0, 1)
            c.number(d['greenSat'], 'look.day.greenSat', 0, 10)
        n = c.obj(look['night'], 'look.night', required=('dim', 'mainLit', 'otherLit', 'mainWindowShare'))
        if n:
            c.number(n['dim'], 'look.night.dim', 0, 1)
            c.number(n['mainWindowShare'], 'look.night.mainWindowShare', 0, 1)
            for k in ('mainLit', 'otherLit'):
                if c.numbers(n[k], 'look.night.%s' % k, 2, 0, 1) and n[k][0] > n[k][1]:
                    c.err('look.night.%s' % k, 'первое число больше второго')
        fs = look['frameSize']
        if not (isinstance(fs, list) and len(fs) == 2 and all(isinstance(x, int) and not isinstance(x, bool) and 64 <= x <= 8192 for x in fs)):
            c.err('look.frameSize', 'должен быть [ширина, высота] целыми пикселями (64…8192), а не %r' % (fs,))
        elif abs(fs[0] * 16 / (fs[1] * 9) - 1) > 0.01:
            c.err('look.frameSize', 'кадры всех зданий — вертикальные 9:16, как у Кукурузника (768×1365); а у вас %d×%d' % (fs[0], fs[1]))
        if look['sunSide'] not in ('left', 'right'):
            c.err('look.sunSide', 'должно быть "left" или "right", а не %r' % (look['sunSide'],))

    # --- кадры ---
    frames = b['frames']
    if not isinstance(frames, list) or not frames:
        c.err('frames', 'нужен непустой список кадров')
        return c.errors
    kinds = set(known_kinds())
    parade, visible = [], 0
    names = set()
    for i, f in enumerate(frames):
        nm = f.get('name') if isinstance(f, dict) else None
        w = 'кадр %d%s' % (i + 1, ' (%s)' % nm if isinstance(nm, str) else '')
        fr = c.obj(f, w, required=('name', 'crop', 'flag', 'cloudShadow', 'wind', 'sky', 'sun', 'life', 'hotspots', 'nightLamps', 'nightHalo', 'lamps'),
                   optional=('hidden', 'parade', 'night', 'sunset', 'lawn', 'closeUp', 'bldDepth', 'showBand', 'fountains', 'depthRaw', 'ambient', 'skyBirds', 'nightWins'))
        if not fr:
            continue
        if not (isinstance(nm, str) and re.fullmatch(r'[A-Za-z0-9_\-]+', nm)):
            c.err(w, 'name — латиница, цифры, _ и - (например v_angle_2)')
            continue
        if nm in names:
            c.err(w, 'имя кадра %s уже есть в списке' % nm)
        names.add(nm)
        hidden = fr.get('hidden', False)
        for k in ('hidden', 'night', 'sunset'):
            if k in fr:
                c.boolean(fr[k], '%s: %s' % (w, k))
        has_night, has_sunset = fr.get('night', True) is not False, fr.get('sunset', True) is not False
        if not hidden:
            visible += 1
        pv = fr.get('parade')
        if 'parade' in fr and not (pv is True or pv is False or (isinstance(pv, str) and pv.split(':')[0] in PARADE_KINDS and pv.split(':')[1:] in ([], ['behind']))):
            c.err('%s: parade' % w, 'true/false или вид парада: %s (можно с «:behind» — пролёт за зданием)' % ', '.join(PARADE_KINDS))
        if pv:
            if hidden:
                c.err(w, 'парад на скрытом кадре')
            else:
                parade.append(i + 1)
        # координаты и числа
        cr = fr['crop']
        if c.numbers(cr, '%s: crop' % w, 4, 0, 1) and not (cr[0] < cr[2] and cr[1] < cr[3]):
            c.err('%s: crop' % w, 'обрезка [x0, y0, x1, y1]: x0 должен быть меньше x1, y0 — меньше y1')
        if fr['flag'] is not None:
            if c.numbers(fr['flag'], '%s: flag' % w, 4, 0, 1) and (fr['flag'][0] + fr['flag'][2] > 1.0001 or fr['flag'][1] + fr['flag'][3] > 1.0001):
                c.err('%s: flag' % w, 'флаг [x, y, ширина, высота] выходит за кадр')
        nerr0 = len(c.errors)
        if 'ambient' in fr:       # e1.8: библиотека жизни (details.js, docs/ENGINE-LIFE.md): walkers / cars / flocks / occluders
            am = c.obj(fr['ambient'], '%s: ambient' % w, optional=('walkers', 'cars', 'flocks', 'occluders', 'lightBirds', 'roads', 'details', 'standers', 'scenes'))
            if am:
                presets = {'walkers': ('far-pedestrians',), 'cars': ('soviet-street', 'trolley-line', 'soviet-1950s', 'watering'), 'flocks': ('pigeons', 'sky')}
                for kind in ('walkers', 'cars'):
                    for j, o in enumerate(am.get(kind, [])):
                        wo = '%s: ambient.%s[%d]' % (w, kind, j + 1)
                        oo = c.obj(o, wo, required=('preset', 'path', 'size'), optional=('n', 'bps', 'gap', 'loop', 'kinds', 'lane', 'smooth'))
                        if oo:
                            if oo['preset'] not in presets[kind]:
                                c.err(wo, 'preset: %s' % ' / '.join(presets[kind]))
                            if not isinstance(oo['path'], list) or len(oo['path']) < 2:
                                c.err(wo, 'path — список из 2+ точек [u, v] (по нарисованной дороге/тротуару)')
                            else:
                                for q in oo['path']:
                                    c.numbers(q, wo + '.path', 2, -0.2, 1.2)
                            c.numbers(oo['size'], wo + '.size', 2, 0.001, 0.08)
                            if kind == 'walkers' and max(oo['size']) > 0.03:
                                c.err(wo + '.size', 'люди только мелкие и далёкие (рост ≤ 0,03 высоты кадра) — правило Нарека 07.10.2026')
                            if 'n' in oo:
                                c.number(oo['n'], wo + '.n', 1, 8)
                for j, o in enumerate(am.get('flocks', [])):
                    wo = '%s: ambient.flocks[%d]' % (w, j + 1)
                    oo = c.obj(o, wo, required=('preset',), optional=('at', 'band', 'size', 'n', 'rest', 'fly', 'radius', 'every'))
                    if oo:
                        if oo['preset'] not in presets['flocks']:
                            c.err(wo, 'preset: pigeons / sky')
                        elif oo['preset'] == 'pigeons':
                            if 'at' not in oo or 'size' not in oo:
                                c.err(wo, 'pigeons: нужны at [u, v] и size')
                            else:
                                c.numbers(oo['at'], wo + '.at', 2, 0, 1)
                        elif 'band' not in oo:
                            c.err(wo, 'sky: нужна band [v0, v1]')
                        else:
                            c.numbers(oo['band'], wo + '.band', 2, 0, 1)
                        if 'n' in oo:
                            c.number(oo['n'], wo + '.n', 1, 30)
                for j, o in enumerate(am.get('occluders', [])):
                    wo = '%s: ambient.occluders[%d]' % (w, j + 1)
                    oo = c.obj(o, wo, required=('poly', 'base'), optional=('bld',))
                    if oo:
                        for q in oo['poly']:
                            c.numbers(q, wo + '.poly', 2, -0.2, 1.2)
                        c.number(oo['base'], wo + '.base', 0, 1.2)
                for j, q in enumerate(am.get('roads', [])):   # e1.10: маска проезжей части — многоугольники по нарисованной дороге
                    if not isinstance(q, list) or len(q) < 3:
                        c.err('%s: ambient.roads[%d]' % (w, j + 1), 'многоугольник [[u, v], …] из 3+ точек')
                    else:
                        for pt in q:
                            c.numbers(pt, '%s: ambient.roads[%d]' % (w, j + 1), 2, -0.3, 1.3)
                for key, sub in (('standers', 'spots'), ('scenes', 'items')):   # e1.11: стоящие люди и сценки (спрайты из Gemini)
                    if key in am:
                        o = c.obj(am[key], '%s: ambient.%s' % (w, key), required=(sub,), optional=('size',))
                        if o:
                            for q in o[sub]:
                                if not (isinstance(q, list) and len(q) >= 2 and is_num(q[0]) and is_num(q[1])):
                                    c.err('%s: ambient.%s.%s' % (w, key, sub), '[u, v, вид, ±1 — куда смотрит]')
                            if 'size' in o:
                                c.number(o['size'], '%s: ambient.%s.size' % (w, key), 0.001, 0.03)
                if 'details' in am:   # e1.10: мелочи для крупных планов (details.js drawDetails)
                    wd = '%s: ambient.details' % w
                    dd = c.obj(am['details'], wd, optional=('perches', 'sparrows', 'leaves', 'swallows', 'glint'))
                    if dd:
                        spec = {'perches': (('spots',), ('n', 'size', 'bld')), 'sparrows': (('ledges',), ('n', 'size', 'bld')),
                                'leaves': (('areas',), ('n', 'fall', 'size')), 'swallows': (('band',), ('n', 'size', 'every')), 'glint': (('poly',), ('every', 'k', 'bld'))}
                        for k, (req, opt) in spec.items():
                            if k in dd:
                                o = c.obj(dd[k], '%s.%s' % (wd, k), required=req, optional=opt)
                                if o:
                                    lst = o[req[0]]
                                    if not isinstance(lst, list) or not lst:
                                        c.err('%s.%s.%s' % (wd, k, req[0]), 'непустой список')
                        if 'perches' in dd and isinstance(dd['perches'], dict):
                            for q in dd['perches'].get('spots', []):
                                c.numbers(q, wd + '.perches.spots', 2, 0, 1)
                        if 'sparrows' in dd and isinstance(dd['sparrows'], dict):
                            for q in dd['sparrows'].get('ledges', []):
                                if not (isinstance(q, list) and len(q) in (4, 5) and all(is_num(x) for x in q)):
                                    c.err(wd + '.sparrows.ledges', 'карниз [u1, v1, u2, v2] или [u1, v1, u2, v2, 1] (1 — на слое здания)')
                if am.get('cars') and not c.errors_since(nerr0):
                    if not am.get('roads'):
                        c.err('%s: ambient.cars' % w, 'машины без маски дорог: нужна ambient.roads (нет честной дороги в кадре — машин нет; правило Нарека)')
                    else:
                        for j, (frac, off, n) in enumerate(road_coverage(am)):
                            if off > 0:
                                c.err('%s: ambient.cars[%d].path' % (w, j + 1), 'путь машины заходит на тротуар: %.1f%% точек вне дороги и не за перекрытием (нужно 0; tools/check_roads.py --overlay)' % (off * 100))
                            elif frac < ROAD_MIN:
                                c.err('%s: ambient.cars[%d].path' % (w, j + 1), 'путь машины вне дороги: внутри маски ambient.roads (или за перекрытием) %.1f%% точек, нужно ≥ %d%% (tools/check_roads.py рисует оверлей)' % (frac * 100, ROAD_MIN * 100))
        if 'skyBirds' in fr:      # e1.8: false — без трёх одиночных птиц движка (у кадра свои стаи)
            c.boolean(fr['skyBirds'], '%s: skyBirds' % w)
        if 'nightWins' in fr:     # e1.12: true — окна других зданий (win2 из маски Gemini) горят и ночью с ночной картинкой
            c.boolean(fr['nightWins'], '%s: nightWins' % w)
        if 'depthRaw' in fr:      # e1.5: карта глубины кадра без растяжки контраста (значения файла = глубина в шейдере)
            c.boolean(fr['depthRaw'], '%s: depthRaw' % w)
        if 'bldDepth' in fr:      # e1.5: здание кадра жёстко на этой глубине (0 — далеко, 1 — близко)
            c.number(fr['bldDepth'], '%s: bldDepth' % w, 0, 1)
        if 'showBand' in fr:      # e1.5: полоса парада [v верх, v низ] вместо sky.band
            sb = fr['showBand']
            if c.numbers(sb, '%s: showBand' % w, 2, 0, 1) and not sb[0] < sb[1]:
                c.err('%s: showBand' % w, '[верх, низ]: верх должен быть меньше низа')
        if 'fountains' in fr:     # e1.5: фонтаны (details.js): jets [[u, v, высота, полуширина]…], glints [[u, v]…], squash
            fo = c.obj(fr['fountains'], '%s: fountains' % w, required=('jets',), optional=('glints', 'squash', 'pool', 'blue'))
            if fo:
                if not isinstance(fo['jets'], list) or not fo['jets']:
                    c.err('%s: fountains.jets' % w, 'непустой список [u, v, высота, полуширина]')
                else:
                    for q in fo['jets']:
                        c.numbers(q, '%s: fountains.jets' % w, 4, 0, 1)
                for q in fo.get('glints', []):
                    c.numbers(q, '%s: fountains.glints' % w, 2, 0, 1)
                if 'squash' in fo:
                    c.number(fo['squash'], '%s: fountains.squash' % w, 0.05, 1)
        c.number(fr['cloudShadow'], '%s: cloudShadow' % w, 0, 1)
        c.number(fr['wind'], '%s: wind' % w, 0, 10)
        sk = c.obj(fr['sky'], '%s: sky' % w, required=('ref', 'end', 'band', 'clouds'), optional=('cloudScale',))
        if sk:
            c.number(sk['ref'], '%s: sky.ref' % w, 0, 2)
            c.number(sk['end'], '%s: sky.end' % w, 0, 1)
            if c.numbers(sk['band'], '%s: sky.band' % w, 2, 0, 1) and sk['band'][0] >= sk['band'][1]:
                c.err('%s: sky.band' % w, 'полоса неба [сверху, снизу]: первое число должно быть меньше второго')
            if not (isinstance(sk['clouds'], int) and not isinstance(sk['clouds'], bool) and 0 <= sk['clouds'] <= 10):
                c.err('%s: sky.clouds' % w, 'число облаков — целое 0…10')
            if 'cloudScale' in sk:
                c.number(sk['cloudScale'], '%s: sky.cloudScale' % w, 0.05, 3)
        sn = c.obj(fr['sun'], '%s: sun' % w, required=('day', 'sunset', 'moon'), optional=('dayDrawn',))
        if sn:
            for k in ('day', 'sunset', 'moon'):
                c.numbers(sn[k], '%s: sun.%s' % (w, k), 2, -0.05, 1.05)
            if 'dayDrawn' in sn:
                c.boolean(sn['dayDrawn'], '%s: sun.dayDrawn' % w)
        if 'lawn' in fr:
            lw = fr['lawn']
            if c.numbers(lw, '%s: lawn' % w, 4, 0, 1) and not (lw[0] < lw[2] and lw[1] < lw[3]):
                c.err('%s: lawn' % w, 'газон [u0, v0, u1, v1]: u0 < u1 и v0 < v1')
        life = c.obj(fr['life'], '%s: life' % w, required=('day', 'sunset', 'night'))
        if life:
            for t in ('day', 'sunset', 'night'):
                if not isinstance(life[t], list):
                    c.err('%s: life.%s' % (w, t), 'должен быть список событий')
                    continue
                for k in life[t]:
                    if k not in kinds:
                        c.err('%s: life.%s' % (w, t), 'неизвестное событие «%s» (есть: %s)' % (k, ', '.join(sorted(kinds))))
        if 'closeUp' in fr:
            cu = c.obj(fr['closeUp'], '%s: closeUp' % w, optional=('glints', 'perch', 'mast', 'banner'))
            if cu:
                if 'glints' in cu:
                    c.boolean(cu['glints'], '%s: closeUp.glints' % w)
                if 'perch' in cu:
                    if not isinstance(cu['perch'], list) or not cu['perch']:
                        c.err('%s: closeUp.perch' % w, 'кромка крыши — непустой список точек [u, v]')
                    else:
                        for j, p in enumerate(cu['perch']):
                            c.numbers(p, '%s: closeUp.perch[%d]' % (w, j + 1), 2, 0, 1)
                if 'mast' in cu:
                    c.numbers(cu['mast'], '%s: closeUp.mast' % w, 4, 0, 1)
                if 'banner' in cu:   # знамя на фасаде (показ banner): [u середины, v карниза, v низа, полуширина по u]
                    c.numbers(cu['banner'], '%s: closeUp.banner' % w, 4, 0, 1)
                    if isinstance(cu['banner'], list) and len(cu['banner']) == 4 and all(isinstance(x, (int, float)) for x in cu['banner']) and cu['banner'][2] <= cu['banner'][1]:
                        c.err('%s: closeUp.banner' % w, 'низ знамени должен быть ниже карниза (третье число больше второго)')
        hs = fr['hotspots']
        if not isinstance(hs, list):
            c.err('%s: hotspots' % w, 'должен быть список точек-подсказок')
        else:
            for j, h in enumerate(hs):
                hw = '%s: точка-подсказка %d' % (w, j + 1)
                h = c.obj(h, hw, required=('key', 'layer', 'u', 'v'), optional=('depth',))
                if not h:
                    continue
                if h['key'] not in facts:
                    c.err(hw, 'факта «%s» нет в facts' % h['key'])
                if h['layer'] not in ('building', 'bg'):
                    c.err(hw, 'layer должен быть "building" или "bg", а не %r' % (h['layer'],))
                c.number(h['u'], hw + ': u', 0, 1)
                c.number(h['v'], hw + ': v', 0, 1)
                if 'depth' in h:
                    c.number(h['depth'], hw + ': depth', 0, 1)
        for key in ('nightLamps', 'lamps'):
            lst = fr[key]
            if not isinstance(lst, list):
                c.err('%s: %s' % (w, key), 'должен быть список фонарей [u лампы, v лампы, u основания, v основания]')
                continue
            for j, l in enumerate(lst):
                c.numbers(l, '%s: %s[%d]' % (w, key, j + 1), 4, 0, 1)
        c.number(fr['nightHalo'], '%s: nightHalo' % w, 0, 3)
        if not has_night and fr['nightLamps']:
            c.err('%s: nightLamps' % w, 'фонари ночной картинки заданы, а ночной картинки у кадра нет (night: false) — они не используются, уберите их')
        # картинки: нужны только видимым кадрам
        if not hidden and isinstance(b.get('framesDir'), str):
            base = posixpath.normpath(posixpath.join(bdir, b['framesDir']))
            need = [('', 'дневной картинки'), ('_depth', 'карты глубины'), ('_bg', 'картинки фона'), ('_building', 'картинки здания'),
                    ('_env', 'карты окружения'), ('_win2', 'карты окон')]
            if has_sunset:
                need.append(('_sunset', 'картинки заката'))
            if has_night:
                need.append(('_night', 'ночной картинки'))
            for suf, what in need:
                p = '%s/%s%s.webp' % (base, nm, suf)
                if not (Path(site) / p).exists():
                    c.err(w, 'нет %s %s' % (what, p) + ('' if suf not in ('_sunset', '_night') else ' (если её нет намеренно — "%s": false у кадра)' % suf[1:]))
    if visible == 0:
        c.err('frames', 'все кадры скрыты — нечего показывать')

    # --- tuning: переопределение чисел движка ---
    if 'tuning' in b:
        check_tuning(c, b['tuning'])
    # --- live / card: тестовое здание, переведённое в живые (tools/publish_building.py) ---
    if 'live' in b:
        lv = b['live']
        if not isinstance(lv, dict):
            c.err('live', 'должен быть объект')
        else:
            if c.string(lv.get('slug'), 'live.slug') and not re.fullmatch(r'[a-z0-9][a-z0-9-]*', lv['slug']):
                c.err('live.slug', 'адрес здания — латиница, цифры и дефис (например lenin)')
            if not isinstance(lv.get('meta', {}), dict):
                c.err('live.meta', 'должен быть объект')
            elif 'url' in lv.get('meta', {}) and not str(lv['meta']['url']).startswith('https://'):
                c.err('live.meta.url', 'адрес должен начинаться с https://')
    if 'card' in b:
        cd = c.obj(b['card'], 'card', required=('eyebrow', 'meta', 'image'), optional=('title', 'history', 'stack'))
        if cd:
            c.i18n(cd['eyebrow'], 'card.eyebrow')
            c.i18n(cd['meta'], 'card.meta')
            if 'title' in cd:
                c.i18n(cd['title'], 'card.title')
            c.string(cd['image'], 'card.image')
            if 'history' in cd:
                c.string(cd['history'], 'card.history', allow_none=True)
            if 'stack' in cd and cd['stack'] not in ('a', 'b', 'c', 'd'):
                c.err('card.stack', 'место в стопке главной: a, b, c или d (sc-a … sc-d в hub.css)')
    return c.errors


def flat_defaults():
    return json.loads((ENGINE / 'config.json').read_text(encoding='utf-8'))


def check_tuning(c, tuning, defaults=None, path='tuning'):
    """tuning: любое число из engine/config.json можно переопределить в настройках здания (тот же вид: число, список, вложенный объект)."""
    defaults = flat_defaults() if defaults is None else defaults
    if not isinstance(tuning, dict):
        c.err(path, 'должен быть объект')
        return
    for k, v in tuning.items():
        w = '%s.%s' % (path, k)
        if k not in defaults:
            c.err(w, 'такого числа нет в движке (engine/config.json); допустимы: %s' % ', '.join(sorted(defaults)))
            continue
        d = defaults[k]
        if isinstance(d, dict):
            check_tuning(c, v, d, w)
        elif isinstance(d, list):
            if not (isinstance(v, list) and len(v) == len(d) and all(is_num(x) == is_num(y) for x, y in zip(v, d))):
                c.err(w, 'должен быть список той же длины (%d) и того же вида, что у движка: %s' % (len(d), json.dumps(d)))
        elif isinstance(d, bool):
            c.boolean(v, w)
        elif is_num(d):
            c.number(v, w)
        elif isinstance(d, str):
            c.string(v, w)
        else:
            c.err(w, 'это значение нельзя переопределить')
