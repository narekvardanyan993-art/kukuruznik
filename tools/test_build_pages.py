#!/usr/bin/env python3
"""Самопроверка сборщика страниц (tools/build_pages.py): испорченные настройки должны ОСТАНАВЛИВАТЬ сборку с понятным текстом.

  python3 tools/test_build_pages.py

Берёт настоящие настройки Кукурузника и тестовых зданий, портит копию (один дефект за раз) и запускает настоящую сборку
во временной копии сайта (кадры — пустые файлы-заглушки). Для каждого дефекта проверяет: сборка остановилась (SystemExit),
в сообщении есть ожидаемый русский текст, на диск в beta/ ничего не записано. Целые настройки должны собираться.
Код выхода 0 — всё как ожидалось. publish_beta.py запускает это перед каждой публикацией.
"""
import copy
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp   # noqa: E402

ROOT = bp.ROOT


def make_site(tmp, bdirs):
    """Временная копия сайта: только имена файлов (пустые заглушки) — сборка проверяет их наличие, содержимое не читает."""
    site = tmp / 'site'
    site.mkdir()
    (site / 'CNAME').write_text('chka.am\n')
    for f in ('kukuruznik/icons/favicon.png', 'kukuruznik/icons/apple-touch-icon.png', 'kukuruznik/og.jpg', 'assets/favicon-32.png', 'assets/icon-180.png'):
        (site / f).parent.mkdir(parents=True, exist_ok=True)
        (site / f).write_bytes(b'')
    for bd in bdirs:
        b = bp.load_building(bd)
        base = site / bp.site_path(bd, b['framesDir'])
        base.mkdir(parents=True, exist_ok=True)
        for f in b['frames']:
            for suf in ('', '_depth', '_bg', '_building', '_env', '_win2', '_sunset', '_night'):
                (base / (f['name'] + suf + '.webp')).write_bytes(b'')
    return site


def make_root(tmp, bdir, building):
    root = tmp / 'root'
    (root / bdir).mkdir(parents=True, exist_ok=True)
    (root / bdir / 'building.json').write_text(building if isinstance(building, str) else json.dumps(building, ensure_ascii=False, indent=1), encoding='utf-8')
    return root


def run_case(name, bdir, mutate, expect, remove=None):
    tmp = Path(tempfile.mkdtemp(prefix='chka-test-build-'))
    try:
        site = make_site(tmp, [bdir])
        b = copy.deepcopy(bp.load_building(bdir))
        out = mutate(b)
        root = make_root(tmp, bdir, out if isinstance(out, str) else b)
        if remove:
            (site / remove).unlink()
        try:
            bp.build_beta(site, [bdir], root=root)
            return name, False, 'сборка НЕ остановилась'
        except SystemExit as e:
            msg = str(e)
        if expect not in msg:
            return name, False, 'сообщение без ожидаемого текста «%s»:\n%s' % (expect, msg)
        if (site / 'beta').exists():
            return name, False, 'сборка остановилась, но на диск в beta/ что-то записано'
        return name, True, msg.split('\n')[1].strip('• ') if '\n' in msg else msg
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def set_(path_fn):
    def f(b):
        path_fn(b)
        return b
    return f


def main():
    K = 'kukuruznik'
    cases = [
        # --- пять обязательных дефектов ---
        ('1. нет ночной картинки кадра', K, lambda b: b, 'кадр 3 (v_angle_2): нет ночной картинки kukuruznik/frames/v_angle_2_night.webp', 'kukuruznik/frames/v_angle_2_night.webp'),
        ('2. неизвестный вид парада', K, set_(lambda b: b['frames'][3].__setitem__('parade', 'rockets')), 'вид парада', None),
        ('3. координата вне 0–1', K, set_(lambda b: b['frames'][1]['hotspots'][0].__setitem__('v', 1.4)), 'кадр 2 (v_angle_1): точка-подсказка 1: v: число 1.4 вне допустимых пределов 0…1', None),
        ('4. нет перевода на en', K, set_(lambda b: b['facts']['tower1'].pop('en')), 'facts.tower1: нет текста на языке «en»', None),
        ('5. неверный тип (обрезка строкой)', K, set_(lambda b: b['frames'][3].__setitem__('crop', '0,0,1,1')), 'кадр 4 (v_angle_3): crop: должен быть список из 4 чисел', None),
        # --- дополнительно ---
        ('6. опечатка в имени поля', K, set_(lambda b: b['frames'][0].__setitem__('hotspot', b['frames'][0].pop('hotspots'))), 'кадр 1 (v_angle_0): нет обязательного поля «hotspots»', None),
        ('7. файл — не JSON', K, lambda b: '{"format": 1, ', 'не читается как JSON', None),
        ('8. tuning: числа нет в движке', K, set_(lambda b: b.__setitem__('tuning', {'LOOK': {'lampHalo': {'brightness': 2}}})), 'tuning.LOOK.lampHalo.brightness: такого числа нет в движке', None),
        ('9. нет дневной картинки кадра', K, lambda b: b, 'кадр 5 (v_angle_4): нет дневной картинки kukuruznik/frames/v_angle_4.webp', 'kukuruznik/frames/v_angle_4.webp'),
        ('10. точка ссылается на несуществующий факт', K, set_(lambda b: b['frames'][0]['hotspots'][0].__setitem__('key', 'nope')), 'факта «nope» нет в facts', None),
        ('11. все кадры скрыты', K, set_(lambda b: [f.__setitem__('hidden', True) for f in b['frames']]), 'все кадры скрыты', None),
        ('12. фонари ночной картинки при night: false', K, set_(lambda b: b['frames'][0].__setitem__('night', False)), 'night: false', None),
    ]
    ok_all = True
    print('Испорченные настройки — сборка должна остановиться с понятным текстом:\n')
    for name, bd, mut, expect, rm in cases:
        n, ok, msg = run_case(name, bd, mut, expect, rm)
        ok_all &= ok
        print('%s  %s\n      → %s\n' % ('OK   ' if ok else 'ОШИБКА', n, msg))
    # целые настройки собираются
    tmp = Path(tempfile.mkdtemp(prefix='chka-test-build-'))
    try:
        bdirs = bp.default_buildings()
        site = make_site(tmp, bdirs)
        files = bp.build_beta(site, bdirs)
        good = any(f.endswith('beta/kukuruznik/index.html') or f == 'beta/kukuruznik/index.html' for f in files)
        print('%s  целые настройки (%s) собираются: %d файлов' % ('OK   ' if good else 'ОШИБКА', ', '.join(bdirs), len(files)))
        ok_all &= good
        # тестовые здания нигде не упоминаются: ни в перенаправлении беты, ни в страницах Кукурузника
        leak = [f for f in ('beta/index.html', 'beta/kukuruznik/index.html', 'beta/kukuruznik/manifest.json') if 'tests' in (site / f).read_text(encoding='utf-8')]
        print('%s  тестовые здания нигде не упоминаются%s' % ('OK   ' if not leak else 'ОШИБКА', (': ' + ', '.join(leak)) if leak else ''))
        ok_all &= not leak
        # живые здания (этап 5): только из проверенного движка; живой движок, не совпадающий с исходником, останавливает сборку
        live = bp.live_buildings()
        lf = bp.build_live(site, live, engine_from=site / 'beta' / 'engine')
        page = (site / 'kukuruznik' / 'index.html').read_text(encoding='utf-8')
        ver = bp.engine_version()
        refs = re.findall(r'(?:href|src)="(\.\./engine/[^"]*)"|url\((\.\./engine/[^)]*)\)', page)
        refs = [a or b for a, b in refs]
        good = (live == ['kukuruznik'] and 'engine/VERSION' in lf and 'kukuruznik/index.html' in lf and refs
                and all(r.endswith('?v=' + ver) for r in refs) and 'noindex' not in page and 'tests' not in page)
        print('%s  живые здания (%s) собираются на engine/: %d адресов движка, все с ?v=%s, без noindex' % ('OK   ' if good else 'ОШИБКА', ', '.join(live), len(refs), ver))
        ok_all &= bool(good)
        # живое здание == проверенная бета (publish_engine --expect-change): равны; порча живой страницы и шапки — ловится
        vb = bp.live_vs_beta(site, live)
        lp = site / 'kukuruznik' / 'index.html'
        orig = lp.read_text(encoding='utf-8')
        lp.write_text(orig.replace('<canvas', '<canvas data-x="1"', 1), encoding='utf-8')
        vb_bad = bp.live_vs_beta(site, live)
        lp.write_text(orig, encoding='utf-8')
        hc_same = bp.head_changes(orig.replace('?v=' + ver, '?v=e0.0'), orig)
        hc_bad = bp.head_changes(orig, orig.replace('og:title', 'og:titl', 1))
        good = not vb and vb_bad and not hc_same and hc_bad
        print('%s  живое == бета (страницы, манифест, движок) распознаётся, порча и смена шапки ловятся' % ('OK   ' if good else 'ОШИБКА'))
        ok_all &= bool(good)
        (site / 'engine' / 'viewer.js').write_text('// старый движок\n', encoding='utf-8')
        try:
            bp.build_live(site, live)
            stale = 'сборка НЕ остановилась'
        except SystemExit as e:
            stale = None if 'не совпадает с исходником' in str(e) else 'не тот текст: ' + str(e)[:200]
        print('%s  живой движок не совпадает с исходником — сборка живых зданий останавливается%s' % ('OK   ' if not stale else 'ОШИБКА', (': ' + stale) if stale else ''))
        ok_all &= not stale
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # переопределение чисел движка настройками здания (tuning): Тест-1 переопределяет два числа, остальное остаётся как у движка; Тест-2 не переопределяет
    e = json.loads((bp.ENGINE / 'config.json').read_text(encoding='utf-8'))
    c1, c2 = bp.make_config(bp.load_building('tests/test-1'), 'x/'), bp.make_config(bp.load_building('tests/test-2'), 'x/')
    ok_t = (c1['LOOK']['lampHalo']['core'] == 1.5 and c1['LOOK']['windowGlow']['strength'] == 1.8
            and c1['LOOK']['lampHalo']['coreSize'] == e['LOOK']['lampHalo']['coreSize'] and c1['LOOK']['stars'] == e['LOOK']['stars']
            and c2['LOOK'] == e['LOOK'])
    print('%s  tuning: Тест-1 переопределил 2 числа (lampHalo.core 1.5, windowGlow.strength 1.8), остальные — как у движка; Тест-2 без переопределений' % ('OK   ' if ok_t else 'ОШИБКА'))
    ok_all &= ok_t
    print('\nИТОГ: %s' % ('всё как ожидалось' if ok_all else 'ЕСТЬ ОШИБКИ'))
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
