"""Сборка движка e2 (docs/STANOK.md §2.2): модули e2/src/ → один файл e2/viewer.js (+ e2/prep.js для Web Worker). Без npm и сборщиков.
  python3 tools/build_engine.py            # собрать; если исходники изменились, а e2/VERSION прежняя — СТОП (гейт G5)
  python3 tools/build_engine.py --check    # ничего не писать: собранные файлы и e2/build.lock.json соответствуют исходникам?
  python3 tools/build_engine.py --dev      # черновая сборка без проверки версии (lock не трогает; G5 останется красным до смены версии)
Порядок модулей жёсткий: core/util, core/clock, core/gl, core/perf, core/frames, core/stage, core/ui, эффекты в порядке
e2/effects.schema.json (parallax раньше tod: крючки шейдера идут в этом порядке), core/boot.
e2/build.lock.json: версия, sha256 исходников и собранных файлов. Выпущенная версия неизменяема: правка исходников = новая e2/VERSION.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2 = ROOT / 'e2'
CORE = ['core/util.js', 'core/clock.js', 'core/gl.js', 'core/perf.js', 'core/frames.js', 'core/stage.js', 'core/ui.js']
HEAD = '''/* chka.am — движок e2 %(version)s. СОБРАННЫЙ ФАЙЛ: не править. Исходники — e2/src/, сборка — tools/build_engine.py. */
(function () {
'use strict';
var E2 = { version: '%(version)s', fx: [], effect: function (e) { E2.fx.push(e); return e; } };
window.E2 = E2;
'''
TAIL = '''
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', E2.boot); else E2.boot();
})();
'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def modules(e2=E2, extra=()):
    """Список модулей в порядке сборки. extra — добавочные файлы эффектов (только для самопроверки гейтов)."""
    schema = json.loads((e2 / 'effects.schema.json').read_text(encoding='utf-8'))
    fx = ['fx/%s.js' % n for n in schema['effects']]
    known = set(CORE + fx + ['core/boot.js', 'core/prep.js'])
    stray = sorted(str(p.relative_to(e2 / 'src')) for p in (e2 / 'src').rglob('*.js') if str(p.relative_to(e2 / 'src')) not in known)
    if stray and not extra:
        raise SystemExit('ОШИБКА сборки e2: модуль не в списке сборки и не в effects.schema.json: ' + ', '.join(stray))
    return CORE + fx + list(extra) + ['core/boot.js']


def version(e2=E2):
    return (e2 / 'VERSION').read_text(encoding='utf-8').strip()


def src_sha(e2=E2):
    h = hashlib.sha256()
    for p in sorted((e2 / 'src').rglob('*.js')) + [e2 / 'effects.schema.json', e2 / 'page.html']:
        h.update(str(p.relative_to(e2)).encode() + b'\0' + p.read_bytes() + b'\0')
    return h.hexdigest()


def build_text(e2=E2, extra=()):
    v = version(e2)
    parts = [HEAD % {'version': v}]
    for m in modules(e2, extra):
        parts.append('\n// ===== %s =====\n' % m + (e2 / 'src' / m).read_text(encoding='utf-8').rstrip('\n') + '\n')
    parts.append(TAIL)
    return ''.join(parts)


def state(e2=E2):
    """Что сейчас: версия, sha исходников, sha собранных файлов (None — файла нет)."""
    f = lambda n: sha((e2 / n).read_bytes()) if (e2 / n).is_file() else None
    return {'version': version(e2), 'src': src_sha(e2), 'viewer': f('viewer.js'), 'prep': f('prep.js')}


def check(e2=E2):
    """Список проблем (пустой — всё сходится). Используется гейтом G5."""
    probs = []
    lock_p = e2 / 'build.lock.json'
    if not lock_p.is_file():
        return ['нет e2/build.lock.json — движок не собран (python3 tools/build_engine.py)']
    lock, st = json.loads(lock_p.read_text(encoding='utf-8')), state(e2)
    if st['src'] != lock['src']:
        if st['version'] == lock['version']:
            probs.append('исходники e2 изменились, а e2/VERSION прежняя (%s): смени версию и пересобери' % st['version'])
        else:
            probs.append('e2/VERSION = %s, а собрано для %s: пересобери (python3 tools/build_engine.py)' % (st['version'], lock['version']))
    elif st['version'] != lock['version']:
        probs.append('e2/VERSION = %s, а в build.lock.json %s: пересобери' % (st['version'], lock['version']))
    if st['viewer'] != lock['viewer'] or st['prep'] != lock['prep']:
        probs.append('e2/viewer.js или e2/prep.js не совпадают с build.lock.json (правили собранный файл руками?)')
    if not probs and st['viewer'] != sha(build_text(e2).encode('utf-8')):
        probs.append('e2/viewer.js не совпадает со сборкой из исходников')
    return probs


def main(argv):
    if '--check' in argv:
        probs = check()
        for p in probs:
            print('ПРОБЛЕМА:', p)
        print('e2 %s: %s' % (version(), 'сборка соответствует исходникам' if not probs else 'НЕ соответствует'))
        return 1 if probs else 0
    dev = '--dev' in argv
    lock_p, v, s = E2 / 'build.lock.json', version(), src_sha()
    if lock_p.is_file() and not dev:
        lock = json.loads(lock_p.read_text(encoding='utf-8'))
        if lock['version'] == v and lock['src'] != s:
            raise SystemExit('ОШИБКА сборки e2: исходники изменились, а e2/VERSION прежняя (%s). Выпущенная версия неизменяема — '
                             'запиши новую версию в e2/VERSION и запусти сборку снова (черновик: --dev).' % v)
    text = build_text().encode('utf-8')
    (E2 / 'viewer.js').write_bytes(text)
    (E2 / 'prep.js').write_bytes((E2 / 'src' / 'core' / 'prep.js').read_bytes())
    if not dev:
        lock_p.write_text(json.dumps(state(), ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('e2 %s собран: viewer.js %d байт, модулей %d%s' % (v, len(text), len(modules()), ' (черновик, lock не тронут)' if dev else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
