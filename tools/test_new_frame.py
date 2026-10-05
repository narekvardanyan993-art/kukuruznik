#!/usr/bin/env python3
"""Самопроверка станка tools/new_frame.py — на временной копии Ленина (репозиторий не трогается). Тяжёлые модели не запускаются:
сборка слоёв подменяется (проверяется команда), всё остальное — по-настоящему.

  python3 tools/test_new_frame.py      # ИТОГ: всё как ожидалось / ЕСТЬ ОШИБКИ
"""
import copy
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import new_frame as nf   # noqa: E402

ROOT = nf.ROOT
GOOD = {
    'frame': 'lenin_9', 'city': 'Ереван', 'era': [1977, 1991], 'target': [40.1772, 44.5119],
    'camera': {'where': 'с севера через площадь', 'bearing': 200, 'height': 'земля'},
    'left': 'Дом правительства (pastvu 1347167)', 'center': 'статуя (pastvu 1895624)', 'right': 'зелень (pastvu 1895624)',
    'not_in_frame': ['машины'],
    'sources': [{'url': 'https://pastvu.com/p/1895624', 'year': '1977', 'city': 'Ереван', 'city_checked': 'страница pastvu', 'camera_bearing': 225, 'use': 'трибуна'}],
    'approved': True,
}
results = []


def ok(cond, what):
    results.append(bool(cond))
    print('%s  %s' % ('OK   ' if cond else 'ОШИБКА', what))


def kinds(rep, stage=None):
    return [k for s, k, m in rep.items if stage is None or s == stage]


def msgs(rep):
    return ' | '.join(m for s, k, m in rep.items)


def tree_hash(d):
    h = hashlib.sha1()
    for f in sorted(Path(d).rglob('*')):
        if f.is_file():
            h.update(str(f.relative_to(d)).encode())
            h.update(f.read_bytes())
    return h.hexdigest()


def make_root():
    t = Path(tempfile.mkdtemp(prefix='chka-nf-test-'))
    shutil.copyfile(ROOT / 'CNAME', t / 'CNAME')
    (t / 'assets').mkdir()
    for n in ('favicon-32.png', 'icon-180.png'):
        shutil.copyfile(ROOT / 'assets' / n, t / 'assets' / n)
    shutil.copytree(ROOT / 'tests' / 'lenin', t / 'tests' / 'lenin', ignore=shutil.ignore_patterns('source', 'report', 'refs', 'gallery-source', 'gallery'))
    return t


def img(path, size, color=(200, 210, 230)):
    from PIL import Image
    Image.new('RGB', size, color).save(path)


def passport_rep(p, fetch=None):
    rep = nf.Report()
    nf.check_passport(p, 'lenin_9', rep, fetch=fetch)
    return rep


def main():
    # --- имена
    for slug, frag in (('kukuruznik', 'старым конвейером'), ('Lenin!', 'латиница'), ('net-takogo', 'нет tests/')):
        try:
            nf.building_dir(slug)
            ok(False, 'здание %r не останавливает' % slug)
        except SystemExit as e:
            ok(frag in str(e), 'здание %r → СТОП (%s)' % (slug, str(e)[:60]))
    # --- паспорт
    r = passport_rep(GOOD)
    ok(kinds(r) == ['ok'], 'хороший паспорт → OK (%s)' % msgs(r))
    t = copy.deepcopy(nf.PASSPORT_TEMPLATE)
    t['frame'] = 'lenin_9'
    r = passport_rep(t)
    ok('todo' in kinds(r) and 'паспорт не заполнен' in msgs(r) and 'ок» Нарека' in msgs(r), 'шаблон паспорта → НЕТ: не заполнен, ждёт «ок»')
    p = copy.deepcopy(GOOD)
    p['sources'][0]['city'] = 'Батуми'
    ok('err' in kinds(passport_rep(p)), 'источник из другого города → ОШИБКА')
    p = copy.deepcopy(GOOD)
    p['sources'][0]['year'] = '1966'
    r = passport_rep(p)
    ok('err' in kinds(r) and 'ни одного источника эпохи' in msgs(r) and 'вне эпохи' in msgs(r), 'нет источника эпохи → ОШИБКА, год вне эпохи → ВНИМАНИЕ')
    p['sources'][0]['geometry_only'] = True
    p['sources'].append(dict(GOOD['sources'][0]))
    r = passport_rep(p)
    ok(kinds(r) == ['ok'], 'вне эпохи с geometry_only + источник эпохи → OK')
    p = copy.deepcopy(GOOD)
    p['camera']['bearing'] = 20
    r = passport_rep(p)
    ok('warn' in kinds(r) and 'нет снимка с этого ракурса' in msgs(r), 'ракурс камеры ≠ ракурсам снимков → ВНИМАНИЕ')
    p = copy.deepcopy(GOOD)
    p['sources'][0]['url'] = 'https://example.com/x.jpg'
    ok('err' in kinds(passport_rep(p)), 'ссылка не pastvu/Commons → ОШИБКА')
    p = copy.deepcopy(GOOD)
    p['sources'] = []
    ok('err' in kinds(passport_rep(p)), 'без источников → ОШИБКА')
    p = copy.deepcopy(GOOD)
    p['approved'] = False
    ok(kinds(passport_rep(p)) == ['todo'], 'не одобрен Нареком → НЕТ')
    batumi = passport_rep(GOOD, fetch=lambda pid: {'geo': [41.6417, 41.6339], 'year': 1974})
    ok('err' in kinds(batumi) and 'км от здания' in msgs(batumi), '--online: снимок в Батуми (≈ 300 км) → ОШИБКА')
    near = passport_rep(GOOD, fetch=lambda pid: {'geo': [40.1775, 44.5125], 'year': 1977})
    ok('err' not in kinds(near) and 'в 0.1 км' in msgs(near), '--online: снимок рядом → OK')
    off = passport_rep(GOOD, fetch=lambda pid: (_ for _ in ()).throw(OSError('нет сети')))
    ok('warn' in kinds(off) and 'err' not in kinds(off), '--online без сети → ВНИМАНИЕ, не ошибка')
    ok(nf.pastvu_id('https://pastvu.com/p/1312413') == 1312413 and nf.pastvu_id('https://pastvu.com/1747056') == 1747056, 'номер снимка из ссылки pastvu')

    root = make_root()
    try:
        bd = root / 'tests' / 'lenin'
        fd = bd / 'source' / 'lenin_9'
        before = tree_hash(root)
        r = nf.run('lenin', 'lenin_9', check=True, root=root)
        ok(tree_hash(root) == before and 'todo' in kinds(r), '--check без папки кадра: ничего не записано, НЕТ')
        bj0 = (bd / 'building.json').read_bytes()
        r = nf.run('lenin', 'lenin_9', root=root)
        ok((fd / 'passport.json').is_file() and (bd / 'building.json').read_bytes() == bj0 and not list((bd / 'frames').glob('lenin_9*')),
           'первый запуск: шаблон паспорта; building.json и frames/ не тронуты')
        (fd / 'passport.json').write_text(json.dumps(GOOD, ensure_ascii=False), encoding='utf-8')
        # основа
        img(fd / 'lenin_9.png', (800, 1200))
        r = nf.run('lenin', 'lenin_9', check=True, root=root)
        ok('err' in kinds(r, '1. основа') and 'не 9:16' in msgs(r), 'рисунок 2:3 → ОШИБКА «не 9:16»')
        img(fd / 'lenin_9.png', (720, 1280))
        r = nf.run('lenin', 'lenin_9', check=True, root=root)
        ok('меньше кадра' in msgs(r), 'рисунок 9:16 меньше 768×1365 → ОШИБКА')
        img(fd / 'lenin_9.png', (1536, 2730))
        img(fd / 'lenin_9_bg.png', (1536, 2700))
        r = nf.run('lenin', 'lenin_9', check=True, root=root)
        ok('размер должен совпадать' in msgs(r), 'подложка другого размера → ОШИБКА')
        img(fd / 'lenin_9_bg.png', (1536, 2730), (198, 208, 229))
        # слои: подменённая сборка
        calls = []

        def fake_run(cmd):
            calls.append(cmd)
            out = Path(cmd[cmd.index('--out') + 1])
            src = bd / 'frames'
            for suf in nf.LAYERS:
                shutil.copyfile(src / ('lenin_1%s.webp' % suf), out / ('lenin_9%s.webp' % suf))
            return type('R', (), {'returncode': 0})()
        models = root / 'models'
        models.mkdir()
        for m in nf.MODELS:
            (models / m).write_bytes(b'x')
        r = nf.run('lenin', 'lenin_9', root=root, models=str(models), runner=fake_run, shots=False)
        spec = json.loads((fd / 'layers.json').read_text(encoding='utf-8'))
        ok(spec['name'] == 'lenin_9' and spec['size'] == [768, 1365] and spec['cutout']['region'] == [] and not calls and 'обвести здание' in msgs(r),
           'шаблон layers.json: имя и размер кадра, пустая область — сборка не запускается, НЕТ «обвести здание»')
        spec['cutout']['region'] = [[100, 300], [600, 300], [600, 1200], [100, 1200]]
        (fd / 'layers.json').write_text(json.dumps(spec), encoding='utf-8')
        deps_ok = not [i for i in r.items if 'пакетов Python' in i[2]]
        r = nf.run('lenin', 'lenin_9', root=root, models=str(models), runner=fake_run, shots=False)
        if deps_ok:
            cmd = calls[-1] if calls else []
            ok(cmd and cmd[1].endswith('build_building_layers.py') and '--bg' in cmd and cmd[cmd.index('--spec') + 1].endswith('lenin_9/layers.json'),
               'сборка слоёв: общий build_building_layers.py с подложкой и layers.json кадра')
            fj = json.loads((fd / 'frame.json').read_text(encoding='utf-8'))
            b = json.loads((bd / 'building.json').read_text(encoding='utf-8'))
            ok(abs(fj['sky']['end'] - b['frames'][0]['sky']['end']) < 0.03 and fj['night'] is False and fj['sunset'] is False and fj['hotspots'] == [],
               'frame.json: небо по замеру (end %.3f, у lenin_1 в файле %.3f), закат/ночь false, точек нет' % (fj['sky']['end'], b['frames'][0]['sky']['end']))
            ok('todo' in kinds(r, '3. кадр') and 'точки: 0' in msgs(r), 'без точек → НЕТ «поставить 3–4»')
            fj['parade'] = 'confetti'
            fj['hotspots'] = [{'key': 'nosuch', 'layer': 'building', 'u': 0.5, 'v': 0.5}]
            (fd / 'frame.json').write_text(json.dumps(fj), encoding='utf-8')
            r = nf.run('lenin', 'lenin_9', check=True, root=root)
            ok('вид парада' in msgs(r) and 'факта «nosuch» нет' in msgs(r), 'frame.json: чужой вид парада и точка без факта → ОШИБКИ схемы по-русски')
            fj['parade'] = 'fireworks'
            fj['hotspots'] = b['frames'][0]['hotspots']
            (fd / 'frame.json').write_text(json.dumps(fj), encoding='utf-8')
            before = tree_hash(root)
            r = nf.run('lenin', 'lenin_9', check=True, root=root)
            ok(tree_hash(root) == before and not r.errors() and 'проходит проверку' in msgs(r), '--check готового кадра: ошибок нет, ничего не записано')
            old = (bd / 'building.json').read_text(encoding='utf-8')
            r = nf.run('lenin', 'lenin_9', root=root, models=str(models), runner=fake_run, shots=False, add=True)
            new = (bd / 'building.json').read_text(encoding='utf-8')
            nb = json.loads(new)
            cut = old.rstrip().rstrip('}').rstrip().rstrip(']').rstrip()
            last = nb['frames'][-1]
            ok(new.startswith(cut) and last['name'] == 'lenin_9' and last['hidden'] is True and 'parade' not in last
               and [f['name'] for f in nb['frames'] if not f.get('hidden')] == ['lenin_1'] and (bd / 'frames' / 'lenin_9_env.webp').is_file()
               and not nf.building_schema.validate('tests/lenin', nb, root),
               '--add: кадр в конце frames скрытым (без парада), начало файла байт-в-байт, видимые кадры прежние, слои в frames/, схема OK')
            r = nf.run('lenin', 'lenin_9', root=root)
            ok('уже в building.json' in msgs(r), 'повторный запуск после --add: «кадр уже в building.json»')
        else:
            ok(not calls and 'пакетов Python' in msgs(r), 'нет пакетов Python → НЕТ с командой pip3, сборка не запускается (дальше тесты слоёв пропущены)')
        try:
            nf.run('lenin', 'lenin_9', root=root, check=True, add=True)
            ok(False, '--check --add не останавливает')
        except SystemExit:
            ok(True, '--check вместе с --add → СТОП')
    finally:
        shutil.rmtree(root, ignore_errors=True)
    # замер неба на настоящих кадрах
    sky = nf.measure_sky(ROOT / 'tests/lenin/frames/lenin_1_env.webp', ROOT / 'tests/lenin/frames/lenin_1.webp')
    ok(abs(sky['end'] - 0.5) < 0.03 and 0.8 < sky['ref'] < 0.95, 'замер неба lenin_1: end %.3f (в файле 0.5), ref %.3f' % (sky['end'], sky['ref']))
    print('\nИТОГ: %s' % ('всё как ожидалось' if all(results) else 'ЕСТЬ ОШИБКИ'))
    return 0 if all(results) else 1


if __name__ == '__main__':
    sys.exit(main())
