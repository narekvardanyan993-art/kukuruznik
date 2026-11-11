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
    if t == 'object':
        if v is False and s.get('orFalse'):
            return False
        if not isinstance(v, dict):
            fail('%s — нужен блок { … }%s, а здесь %r' % (where, ' или false' if s.get('orFalse') else '', v))
        return _object(v, s['keys'], where, kind)
    fail('схема: неизвестный тип «%s» у %s (e2/effects.schema.json)' % (t, where))


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
        # --- файлы кадра ---
        g['files'] = {}
        for e in FX:
            for key, pat in FX[e].get('files', {}).items():
                g['files'][key] = pat.replace('{name}', g['name'])
            for q in FX[e].get('filesIf', []):
                v = g['effects'][e].get(q['key'])
                if v:      # 'sub' — имя файла записано в самих настройках (блок с ключом sub); иначе — по шаблону от имени кадра
                    g['files'][q['file']] = v[q['sub']] if q.get('sub') else q['pattern'].replace('{name}', g['name'])
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
                derived.append({'frame': len(frames), 'effect': e, 'key': q['file'], 'file': fn, 'maker': q['maker'], 'from': src})
        _frame_rules(g, tag)
        frames.append(g)
    out['frames'] = frames
    out['derived'] = derived     # сборка считает эти файлы и убирает ключ из настроек страницы
    return out, sorted(set(files))


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
    wx = g['effects'].get('weather')
    if wx is not None and g['kind'] == 'interior' and (wx['rain'] or wx['snow'] or wx['snowMask'] or wx['rainbow']):
        fail('%s, effects.weather — интерьер: ни дождя, ни снега, ни радуги (rain, snow, snowMask — false; kind: interior ставит это сам)' % tag)
    if wx is not None and wx['snowMask'] and not wx['snow']:
        fail('%s, effects.weather.snowMask — маска снега есть, а снег на кадре выключен (snow: false)' % tag)
    if g['kind'] in ('close', 'interior') and g['effects']['parallax']['tilt'] > 0.5:
        fail('%s, effects.parallax.tilt = %r — крупные планы и интерьеры почти плоские (≤ 0.5; обычно 0.2)' % (tag, g['effects']['parallax']['tilt']))
