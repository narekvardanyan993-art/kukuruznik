"""Схема building.json format 2 для движка e2 (docs/STANOK.md §2.3, гейт G8).
Единственный источник ключей — e2/effects.schema.json. Здесь: проверка, умолчания, список файлов кадра.
Ошибка настроек = ГРОМКАЯ остановка: SystemExit с первой строкой «ОШИБКА building.json: …» по-русски, на диск ничего не пишется.

  from stanok_schema import resolve
  cfg, files = resolve(building_dict, frames_dir)     # cfg — проверенные настройки с умолчаниями (уходят в страницу), files — имена файлов кадров
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / 'e2' / 'effects.schema.json'
LANGS = ('hy', 'ru', 'en')
SKY_MIN = 0.2          # кадр «с небом»: небо кончается ниже 20 % высоты (sky.end ≥ 0.2)


def load_schema(path=None):
    return json.loads(Path(path or SCHEMA_PATH).read_text(encoding='utf-8'))


def fail(msg):
    raise SystemExit('ОШИБКА building.json: ' + msg)


def _is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _known(keys):
    return 'Есть: ' + ', '.join(sorted(keys)) + '.'


def _check_keys(obj, spec, where):
    """Неизвестный ключ — ошибка (STANOK_BREAK=schema-unknown выключает проверку: это красный случай самопроверки G8)."""
    if os.environ.get('STANOK_BREAK') == 'schema-unknown':
        return
    for k in obj:
        if k not in spec:
            fail('%s — ключа «%s» нет в схеме. %s' % (where, k, _known(spec)))


def _value(v, s, where, kind=None):
    """Проверяет значение v по описанию s; возвращает значение с подставленными умолчаниями."""
    t = s['type']
    if t == 'any':
        return v
    if t == 'const':
        if v != s['value']:
            fail('%s должно быть %r, а здесь %r' % (where, s['value'], v))
        return v
    if t in ('string', 'slug', 'name'):
        if not isinstance(v, str) or not v:
            fail('%s — нужна непустая строка, а здесь %r' % (where, v))
        if t != 'string' and not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', v):
            fail('%s — только латиница, цифры, «-» и «_», а здесь %r' % (where, v))
        return v
    if t == 'strings':
        if not isinstance(v, list) or any(not isinstance(x, str) for x in v):
            fail('%s — нужен список строк' % where)
        return v
    if t == 'bool':
        if not isinstance(v, bool):
            fail('%s — нужно true или false, а здесь %r' % (where, v))
        return v
    if t == 'number':
        if not _is_num(v):
            fail('%s — нужно число, а здесь %r' % (where, v))
        if ('min' in s and v < s['min']) or ('max' in s and v > s['max']):
            fail('%s = %r вне диапазона %s…%s' % (where, v, s.get('min', '−∞'), s.get('max', '+∞')))
        return v
    if t == 'enum':
        if v not in s['values']:
            fail('%s = %r; можно: %s' % (where, v, ', '.join(s['values'])))
        return v
    if t == 'vec':
        if not isinstance(v, list) or len(v) != s['n'] or any(not _is_num(x) for x in v):
            fail('%s — нужен список из %d чисел, а здесь %r' % (where, s['n'], v))
        for x in v:
            if ('min' in s and x < s['min']) or ('max' in s and x > s['max']):
                fail('%s: число %r вне диапазона %s…%s' % (where, x, s.get('min'), s.get('max')))
        return v
    if t == 'rect':
        if not isinstance(v, list) or len(v) != 4 or any(not _is_num(x) for x in v) or not (0 <= v[0] < v[2] <= 1 and 0 <= v[1] < v[3] <= 1):
            fail('%s — нужен прямоугольник [x0, y0, x1, y1] в долях кадра (0…1), а здесь %r' % (where, v))
        return v
    if t == 'rects':
        if not isinstance(v, list):
            fail('%s — нужен список прямоугольников [[x0, y0, x1, y1], …], а здесь %r' % (where, v))
        return [_value(r, {'type': 'rect'}, '%s[%d]' % (where, i)) for i, r in enumerate(v)]
    if t == 'frameSize':
        if not isinstance(v, list) or len(v) != 2 or any(not isinstance(x, int) or isinstance(x, bool) or x < 64 for x in v):
            fail('%s — нужен размер кадра [ширина, высота] в пикселях, а здесь %r' % (where, v))
        if abs(v[0] / v[1] - 9 / 16) > 0.01 * 9 / 16:
            fail('%s = %r — кадры только вертикальные 9:16 (например [768, 1365])' % (where, v))
        return v
    if t == 'i18n':
        if not isinstance(v, dict) or any(not isinstance(v.get(l), str) or not v.get(l) for l in LANGS):
            fail('%s — нужны строки на трёх языках: hy, ru, en' % where)
        _check_keys(v, dict.fromkeys(LANGS), where)
        return v
    if t == 'sun':
        if v is None:
            return None
        if not isinstance(v, dict):
            fail('%s — нужно {"day": [u, v], "sunset": [u, v], "moon": [u, v]} или null' % where)
        _check_keys(v, dict.fromkeys(('day', 'sunset', 'moon')), where)
        for k in ('day', 'sunset', 'moon'):
            p = v.get(k)
            if not isinstance(p, list) or len(p) != 2 or any(not _is_num(x) or x < 0 or x > 1 for x in p):
                fail('%s.%s — нужна точка [u, v] в долях кадра, а здесь %r' % (where, k, p))
        return v
    if t == 'actors':
        return _actors(v, where)
    if t == 'object':
        if v is False and s.get('orFalse'):
            return False
        if not isinstance(v, dict):
            fail('%s — нужен блок { … }%s, а здесь %r' % (where, ' или false' if s.get('orFalse') else '', v))
        return _object(v, s['keys'], where, kind)
    fail('схема: неизвестный тип «%s» у %s (e2/effects.schema.json)' % (t, where))


ACTOR_KEYS = ('id', 'emotion', 'rect', 'hit', 'underShow', 'media')
ACTOR_SLOTS = ('day', 'sunset', 'night', 'rain', 'snow', 'tap')
VARIANT_KEYS = ('name', 'rect', 'video', 'webm', 'mask', 'image', 'imageRect', 'hours', 'note')


def _variant(v, where, rect):
    if not isinstance(v, dict):
        fail('%s — нужен вариант {name, video, mask} или {name, image}, а здесь %r' % (where, v))
    _check_keys(v, dict.fromkeys(VARIANT_KEYS), where)
    out = {'name': _value(v.get('name'), {'type': 'string'}, where + '.name'),
           'rect': _value(v.get('rect', rect), {'type': 'rect'}, where + '.rect')}
    for k in ('video', 'webm', 'mask', 'image'):
        out[k] = _value(v[k], {'type': 'string'}, where + '.' + k) if v.get(k) is not None else None
    out['imageRect'] = _value(v['imageRect'], {'type': 'rect'}, where + '.imageRect') if v.get('imageRect') is not None else None
    if out['imageRect'] and not out['image']:
        fail('%s.imageRect — прямоугольник картинки есть, а картинки (image) нет' % where)
    if not out['video'] and not out['image']:
        fail('%s — у варианта нет ни ролика (video), ни картинки (image)' % where)
    if out['video']:
        if not out['video'].endswith('.mp4'):
            fail('%s.video = %r — ролик героя — .mp4 (рядом .webm для браузеров без H.264)' % (where, out['video']))
        if not out['mask']:
            fail('%s.mask — у ролика нет маски: без неё ролик закрасил бы весь прямоугольник' % where)
        out['webm'] = out['webm'] or out['video'][:-4] + '.webm'
    h = v.get('hours')
    if h is not None and (not isinstance(h, list) or len(h) != 2 or any(not _is_num(x) or x < 0 or x > 24 for x in h)):
        fail('%s.hours — нужны часы [ч0, ч1) по местному времени (0…24), а здесь %r' % (where, h))
    out['hours'] = h
    return out


def _actors(v, where):
    """Герои кадра (эффект actors, docs/STANOK.md §4.6)."""
    if not isinstance(v, list):
        fail('%s — нужен список героев [{id, emotion, rect, media}, …], а здесь %r' % (where, v))
    out, ids = [], set()
    for i, a in enumerate(v):
        w = '%s[%d]' % (where, i)
        if not isinstance(a, dict):
            fail('%s — герой не блок { … }' % w)
        _check_keys(a, dict.fromkeys(ACTOR_KEYS), w)
        g = {'id': _value(a.get('id'), {'type': 'slug'}, w + '.id')}
        w = '%s (%s)' % (w, g['id'])
        if g['id'] in ids:
            fail('%s — id героя повторяется' % w)
        ids.add(g['id'])
        g['emotion'] = _value(a.get('emotion', False), {'type': 'bool'}, w + '.emotion')
        g['rect'] = _value(a.get('rect'), {'type': 'rect'}, w + '.rect')
        g['hit'] = _value(a['hit'], {'type': 'rect'}, w + '.hit') if a.get('hit') is not None else None
        g['underShow'] = _value(a.get('underShow', True), {'type': 'bool'}, w + '.underShow')
        m = a.get('media')
        if not isinstance(m, dict) or not m:
            fail('%s.media — нужен блок {day: […], rain: […], snow: […], …}' % w)
        _check_keys(m, dict.fromkeys(ACTOR_SLOTS), w + '.media')
        gm, names = {}, {}
        for sl, lst in m.items():
            ws = '%s.media.%s' % (w, sl)
            if sl == 'night' and lst == 'drawing':
                gm[sl] = 'drawing'
                continue
            if sl == 'tap':
                gm[sl] = _variant(lst, ws, g['rect'])
                vs = [gm[sl]]
            else:
                if not isinstance(lst, list) or not lst:
                    fail('%s — нужен непустой список вариантов%s' % (ws, ' или "drawing"' if sl == 'night' else ''))
                gm[sl] = vs = [_variant(x, '%s[%d]' % (ws, j), g['rect']) for j, x in enumerate(lst)]
            for x in vs:
                if x['name'] in names and names[x['name']] != x:
                    fail('%s — имя варианта «%s» уже занято другим вариантом этого героя' % (ws, x['name']))
                names[x['name']] = x
        if g['hit'] and 'tap' not in gm:
            fail('%s.hit — место тапа есть, а ролика тапа (media.tap) нет' % w)
        if 'tap' in gm and not g['hit']:
            fail('%s.media.tap — ролик тапа есть, а места тапа (hit) нет' % w)
        g['media'] = gm
        out.append(g)
    return out


def actor_files(lst):
    """Файлы героев кадра (для manifest и проверки «файл есть»)."""
    fs = []
    for a in lst or []:
        for sl, m in a['media'].items():
            for v in ([m] if isinstance(m, dict) else (m if isinstance(m, list) else [])):
                fs += [v[k] for k in ('video', 'webm', 'mask', 'image') if v.get(k)]
    return fs


def _default(s, kind):
    if kind and 'byKind' in s and kind in s['byKind']:
        return True, s['byKind'][kind]
    if 'default' in s:
        return True, json.loads(json.dumps(s['default']))
    if s['type'] == 'object':            # блок без своих значений — собрать из умолчаний ключей
        return True, {}
    return False, None


def _object(obj, spec, where, kind=None):
    _check_keys(obj, spec, where)
    out = {}
    for k, s in spec.items():
        w = where + '.' + k if where else k
        if k in obj:
            out[k] = _value(obj[k], s, w, kind)
        elif s.get('optional'):
            continue
        else:
            ok, d = _default(s, kind)
            if not ok:
                fail('%s — обязательного ключа нет' % w)
            out[k] = _value(d, s, w, kind) if s['type'] == 'object' else d
    return out


def effect_names(schema=None):
    return list((schema or load_schema())['effects'].keys())


def resolve(b, frames_dir=None, schema=None):
    """Проверяет настройки здания (format 2). Возвращает (cfg, files):
    cfg — настройки с умолчаниями: look, effectsOn, effects (здание), frames[] (name, kind, caption, effects, files — пока без адресов);
    files — список имён файлов кадров из папки кадров, которые нужны включённым эффектам (для manifest);
    cfg['derived'] — производные файлы (маски), которые сборка считает сама: {frame, effect, key, file, maker, from}.
    frames_dir — папка кадров: если задана, каждый нужный файл обязан существовать."""
    S = schema or load_schema()
    if not isinstance(b, dict):
        fail('настройки — не блок { … }')
    if b.get('format') != 2:
        fail('«format» должен быть 2 (это настройки для движка e2), а здесь %r' % (b.get('format'),))
    top = S['top']
    _check_keys(b, top, 'верхний уровень')
    FX = S['effects']
    out = {'format': 2}
    for k, s in top.items():
        if k in ('effects', 'frames', 'format'):
            continue
        if k in b:
            out[k] = _value(b[k], s, k)
        elif not s.get('optional'):
            ok, d = _default(s, None)
            if not ok:
                fail('%s — обязательного ключа нет' % k)
            out[k] = _value(d, s, k) if s['type'] == 'object' else d
    # --- эффекты здания ---
    be = b.get('effects', {})
    if not isinstance(be, dict):
        fail('effects — нужен блок { … }')
    for e in be:
        if e not in FX:
            fail('effects.%s — такого эффекта нет. %s' % (e, _known(FX)))
    out['effects'] = {e: _object(be.get(e, {}), FX[e].get('building', {}), 'effects.' + e) for e in FX}
    out['effectsOn'] = list(FX.keys())
    fdir = Path(frames_dir) if frames_dir else None
    # производные файлы здания (лист частиц): станок собирает их из списков файлов в настройках эффекта
    out['files'], bderived = {}, []
    for e in FX:
        for q in FX[e].get('derivedBuilding', []):
            src = {k: list(v) for k, v in out['effects'][e][q['fromLists']].items() if v}
            if not src:
                continue
            if fdir is not None:
                for k, lst in src.items():
                    for fn in lst:
                        if not (fdir / fn).is_file():
                            fail('effects.%s.%s.%s — нет файла %s; папка %s' % (e, q['fromLists'], k, fn, fdir))
            out['files'][q['file']] = q['pattern']
            bderived.append({'frame': None, 'effect': e, 'key': q['file'], 'file': q['pattern'], 'maker': q['maker'], 'from': src})
    # --- кадры ---
    fr = b.get('frames')
    if not isinstance(fr, list) or not fr:
        fail('frames — нужен непустой список кадров')
    seen, frames, files, derived = set(), [], [], bderived
    for i, f in enumerate(fr):
        if not isinstance(f, dict):
            fail('кадр %d — не блок { … }' % (i + 1))
        nm = f.get('name')
        tag = 'кадр %d (%s)' % (i + 1, nm if isinstance(nm, str) else '?')
        _check_keys(f, S['frame'], tag)
        g = {}
        for k, s in S['frame'].items():
            if k == 'effects':
                continue
            if k in f:
                g[k] = _value(f[k], s, tag + ', ' + k)
            elif not s.get('optional'):
                fail('%s, %s — обязательного ключа нет' % (tag, k))
        if g['name'] in seen:
            fail('%s — имя кадра повторяется' % tag)
        seen.add(g['name'])
        fe = f.get('effects', {})
        if not isinstance(fe, dict):
            fail('%s, effects — нужен блок { … }' % tag)
        for e in fe:
            if e not in FX:
                fail('%s, effects.%s — такого эффекта нет. %s' % (tag, e, _known(FX)))
        g['effects'] = {e: _object(fe.get(e, {}), FX[e].get('frame', {}), tag + ', effects.' + e, g['kind']) for e in FX}
        if g['kind'] == 'interior' and g['effects'].get('wind'):      # интерьер: ветра нет (kind: interior ставит on: false сам, как у неба и погоды)
            g['effects']['wind']['on'] = False
        # --- файлы кадра ---
        g['files'] = {}
        for e in FX:
            for key, pat in FX[e].get('files', {}).items():
                g['files'][key] = pat.replace('{name}', g['name'])
            for q in FX[e].get('filesIf', []):
                v = g['effects'][e].get(q['key'])
                if v:      # 'sub' — имя файла записано в самих настройках (блок с ключом sub); иначе — по шаблону от имени кадра
                    g['files'][q['file']] = v[q['sub']] if q.get('sub') else q['pattern'].replace('{name}', g['name'])
        for fn in actor_files((g['effects'].get('actors') or {}).get('list')):     # ролики, маски и картинки героев: ключ — само имя файла
            g['files'][fn] = fn
        shv = (g['effects'].get('show') or {}).get('video')
        if shv:
            if not shv['video'].endswith('.mp4'):
                fail('%s, effects.show.video.video = %r — ролик шоу — .mp4 (рядом .webm)' % (tag, shv['video']))
            shv['webm'] = shv.get('webm') or shv['video'][:-4] + '.webm'
            for fn in (shv['video'], shv['webm'], shv['mask']):
                g['files'][fn] = fn
        if fdir is not None:
            for key, fn in g['files'].items():
                if not (fdir / fn).is_file():
                    fail('%s — нет файла %s (нужен эффекту, ключ «%s»); папка %s' % (tag, fn, key, fdir))
        files.extend(g['files'].values())
        # производные файлы (маски): их считает станок при сборке из файлов кадра (tools/stanok_masks.py); в папке кадров их нет
        for e in FX:
            for q in FX[e].get('derived', []):
                if q.get('key') and not g['effects'][e].get(q['key']):
                    continue
                src = {k: pat.replace('{name}', g['name']) for k, pat in q['from'].items()}
                if fdir is not None:
                    for k, fn in src.items():
                        if not (fdir / fn).is_file():
                            fail('%s — нет файла %s (из него станок считает %s для эффекта %s); папка %s' % (tag, fn, q['pattern'].replace('{name}', g['name']), e, fdir))
                fn = q['pattern'].replace('{name}', g['name'])
                g['files'][q['file']] = fn
                dq = {'frame': len(frames), 'effect': e, 'key': q['file'], 'file': fn, 'maker': q['maker'], 'from': src}
                if q.get('params'):      # настройки для станка: «frame:<ключ>» — из кадра, «building:<ключ>» — из настроек эффекта здания
                    dq['params'] = {pk: (g['effects'][e] if pv.startswith('frame:') else out['effects'][e]).get(pv.split(':', 1)[1]) for pk, pv in q['params'].items()}
                derived.append(dq)
        _frame_rules(g, tag)
        _frame_budget(g, tag, S)
        frames.append(g)
    out['frames'] = frames
    if 'actors' in FX:     # «≥ 2 изюминки на здание» (docs/STANOK.md §4.6, G8)
        emo = [a['id'] for f in frames for a in (f['effects'].get('actors') or {}).get('list', []) if a['emotion']]
        if len(emo) < 2:
            fail('effects.actors — героев с эмоцией (emotion: true) на здание %d (%s), нужно не меньше двух: собака, старик с голубями, пара, кошка… (docs/STANOK.md §4.6)' % (len(emo), ', '.join(emo) or 'нет'))
    out['derived'] = derived     # сборка считает эти файлы и убирает ключ из настроек страницы
    if S.get('budget'):
        out['budget'] = {k: v for k, v in S['budget'].items() if k != 'about'}     # движок и гейт G7 сверяют с ним собранный шейдер и число частиц
    return out, sorted(set(files))


def _frame_budget(g, tag, S):
    """Бюджет кадра (docs/STANOK.md §5.1): сумма очков эффектов, которые на этом кадре работают. Выше бюджета — стоп, с самым дорогим."""
    B, FX = S.get('budget'), S['effects']
    if not B:
        return
    wx, lt, sk, wd = g['effects'].get('weather'), g['effects'].get('lights'), g['effects'].get('sky'), g['effects'].get('wind')
    idle = {'wind': wd is not None and not wd['on'], 'weather': wx is not None and not (wx['rain'] or wx['snow']), 'lights': lt is not None and not lt['on'],
            'sky': sk is not None and not (sk['shadow'] or sk['drift'])}
    cost = {e: FX[e].get('cost', 0) for e in FX if not idle.get(e)}
    total = sum(cost.values())
    if total > B['cost']:
        top = max(cost, key=lambda e: cost[e])
        fail('%s — эффекты кадра стоят %d очков, бюджет кадра %d (effects.schema.json, budget.cost). Самый дорогой: %s (%d). Выключи эффект на этом кадре или упрости его'
             % (tag, total, B['cost'], top, cost[top]))


def _frame_rules(g, tag):
    """Правила кадра поверх типов (docs/STANOK.md §2.3)."""
    tod = g['effects'].get('tod')
    if tod is not None:
        end, sun = tod['sky']['end'], tod.get('sun')
        if end >= SKY_MIN:
            if sun is None:
                fail('%s, effects.tod.sun — у кадра с небом солнце обязательно: {"day": [u, v], "sunset": [u, v], "moon": [u, v]}' % tag)
            for k in ('day', 'sunset', 'moon'):
                if sun[k][1] >= end:
                    fail('%s, effects.tod.sun.%s = %r — не в небе: небо кончается на %.2f высоты (sky.end), а точка на %.2f' % (tag, k, sun[k], end, sun[k][1]))
        elif sun is not None:
            fail('%s, effects.tod.sun — у кадра без неба (sky.end = %.2f < %.2f) солнца нет: поставь null' % (tag, end, SKY_MIN))
    wd = g['effects'].get('wind')
    if wd is not None and wd['on'] and not wd.get('box'):
        fail('%s, effects.wind.box — ветер включён, а где искать кроны не сказано: box [x0, y0, x1, y1] только вокруг деревьев (без травы, карнизов, минаретов)' % tag)
    wx = g['effects'].get('weather')
    if wx is not None and g['kind'] == 'interior' and (wx['rain'] or wx['snow'] or wx['snowMask'] or wx['rainbow']):
        fail('%s, effects.weather — интерьер: ни дождя, ни снега, ни радуги (rain, snow, snowMask — false; kind: interior ставит это сам)' % tag)
    if wx is not None and wx['snowMask'] and not wx['snow']:
        fail('%s, effects.weather.snowMask — маска снега есть, а снег на кадре выключен (snow: false)' % tag)
    ac = g['effects'].get('actors')
    if ac is not None:
        for a in ac['list']:
            w = '%s, effects.actors (%s)' % (tag, a['id'])
            if a['emotion'] and 'day' not in a['media']:
                fail('%s — у изюминки нет дневной петли (media.day)' % w)
            if a['emotion'] and wx is not None and (wx['rain'] or wx['snow']):
                for k in ('rain', 'snow'):
                    if wx[k] and k not in a['media']:
                        fail('%s — у изюминки нет своего варианта в %s (media.%s): в непогоду герой не замирает и не пропадает (docs/STANOK.md §4.6)' % (w, 'дождь' if k == 'rain' else 'снег', k))
    sh = g['effects'].get('show')
    if sh is not None and sh['type'] == 'video':
        if not sh['video']:
            fail('%s, effects.show — тип video, а ролика (video: {rect, video, mask, t}) нет' % tag)
        if not (sh['video']['t'][0] < sh['video']['t'][1] <= sh['dur'] + 1e-6):
            fail('%s, effects.show.video.t = %r — окно ролика [с0 < с1] внутри длины шоу dur = %r' % (tag, sh['video']['t'], sh['dur']))
        c = sh['cam']
        if c and not (c['t'][0] <= c['t'][1] <= c['t'][2] <= c['t'][3] <= sh['dur'] + 1e-6):
            fail('%s, effects.show.cam.t = %r — наезд и отъезд по порядку и внутри длины шоу %r' % (tag, c['t'], sh['dur']))
        if sh['tod'] is not None and (not isinstance(sh['tod'], list) or any(not isinstance(q, list) or len(q) != 2 or not all(_is_num(x) for x in q) or not 0 <= q[1] <= 2.1667 for q in sh['tod'])):
            fail('%s, effects.show.tod — нужен список [[секунда, p], …], p от 0 (день) до 2.1667 (ночь)' % tag)
    elif sh is not None and (sh['video'] or sh['cam']):
        fail('%s, effects.show — ролик или камера есть, а type: none' % tag)
    sk = g['effects'].get('sky')
    if sk is not None and g['kind'] == 'interior' and (sk['shadow'] or sk['drift']):
        fail('%s, effects.sky — интерьер: неба нет, ни теней облаков, ни плывущих облаков (shadow: 0, drift: false; kind: interior ставит это сам)' % tag)
    if sk is not None and sk['drift'] and sk['drift']['box'][1] > 0.02:
        fail('%s, effects.sky.drift.box = %r — прямоугольник неба начинается от верха кадра (y0 = 0), а здесь от %.2f' % (tag, sk['drift']['box'], sk['drift']['box'][1]))
    if g['kind'] in ('close', 'interior') and g['effects']['parallax']['tilt'] > 0.5:
        fail('%s, effects.parallax.tilt = %r — крупные планы и интерьеры почти плоские (≤ 0.5; обычно 0.2)' % (tag, g['effects']['parallax']['tilt']))
