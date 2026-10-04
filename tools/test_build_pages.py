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
        ('13. кадр не 9:16 (2:3)', K, set_(lambda b: b['look'].__setitem__('frameSize', [768, 1145])), 'вертикальные 9:16', None),
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
        live = bp.live_buildings(site=site)
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
        # publish_engine --expect-change: остальные страницы — побайтно (untouched_problems), без пикселей
        exempt = {'kukuruznik/index.html', 'beta/kukuruznik/index.html'}
        live_changed = {'engine/VERSION', 'engine/viewer.js', 'engine/details.js', 'kukuruznik/index.html'}
        n_ok = bp.untouched_problems(site, live_changed, exempt)
        n_beta = bp.untouched_problems(site, live_changed | {'beta/engine/viewer.js'}, exempt)   # бета-движок тронут — тестовые здания затронуты
        n_page = bp.untouched_problems(site, live_changed | {'beta/tests/test-1/index.html'}, exempt)   # страница тестового здания изменена
        (site / 'kukuruznik' / 'history.html').write_text('<link href="../assets/x.css"><script src="../engine/viewer.js"></script>', encoding='utf-8')
        n_dep = bp.untouched_problems(site, live_changed, exempt)   # страница about/history зависит от живого движка
        (site / 'kukuruznik' / 'history.html').unlink()
        good = (not n_ok and any('beta/tests/test-1' in x for x in n_beta) and any('beta/tests/test-1/index.html зависит' in x for x in n_page)
                and any(x.startswith('kukuruznik/history.html') for x in n_dep))
        print('%s  --expect-change: остальные страницы побайтно — нетронутые проходят, тронутая страница, её зависимость и beta/engine/ ловятся' % ('OK   ' if good else 'ОШИБКА'))
        ok_all &= bool(good)
        # publish_beta --expect-change (то же правило, что у publish_engine): пиксели только у целей, чьи файлы меняются, и у новых;
        # все остальные страницы — побайтно как на main, любое отличие вне beta/ = красная до check_site
        all_files = {str(f.relative_to(site)) for f in site.rglob('*') if f.is_file()}
        lenin = {f for f in all_files if f.startswith('beta/tests/lenin/')}
        ids1, new1, pr1 = bp.changed_targets(site, lenin, all_files - lenin)                       # новое здание: только оно
        ids2, new2, pr2 = bp.changed_targets(site, {'beta/engine/viewer.js'}, all_files)           # новый бета-движок: все бета-здания, живые нет
        ids3, new3, pr3 = bp.changed_targets(site, lenin | {'kukuruznik/index.html'}, all_files - lenin)   # лишнее: живая страница
        ids4, new4, pr4 = bp.changed_targets(site, lenin | {'engine/viewer.js'}, all_files - lenin)         # лишнее: живой движок (от него зависят живые страницы)
        import publish_beta as pb
        seen = []
        real_run = pb.subprocess.run
        pb.subprocess.run = lambda cmd, **kw: (seen.append(cmd), type('R', (), {'returncode': 0})())[1]
        try:
            pb.run_check('x', True, only=ids1, allow_only=ids1)
        finally:
            pb.subprocess.run = real_run
        cmd = seen[0] if seen else []
        exp1 = ['beta/tests/lenin'] + ['beta/tests/lenin/' + n[:-5] for n in bp.OWN_PAGES if (ROOT / 'tests' / 'lenin' / n).is_file()]   # Ленин + его архив/история (если есть)
        good = (ids1 == exp1 and new1 == exp1 and not pr1
                and 'beta/kukuruznik' not in ids1 and 'beta/tests/test-1' not in ids1
                and 'beta/kukuruznik' in ids2 and 'beta/tests/test-1' in ids2 and 'beta/tests/lenin' in ids2 and not new2 and not pr2
                and any(x.startswith('kukuruznik/index.html') for x in pr3) and any(x.startswith('kukuruznik/index.html') for x in pr4)
                and cmd[cmd.index('--only') + 1] == ','.join(exp1) and cmd[cmd.index('--allow-change') + 1] == ','.join(exp1))
        print('%s  publish_beta --expect-change: пиксели только у изменяемых и новых целей (Ленин и его страницы), нетронутые не снимаются, живая страница/движок в изменениях = красная, в check_site уходят точные --only/--allow-change' % ('OK   ' if good else 'ОШИБКА'))
        ok_all &= bool(good)
        # publish_building: пары «бета ⇄ живое» нет (twins=False), у publish_beta/publish_engine — есть (по умолчанию)
        seen2 = []
        pb.subprocess.run = lambda cmd, **kw: (seen2.append(cmd), type('R', (), {'returncode': 0})())[1]
        try:
            pb.run_check('x', strict=True, allow_extra=['hub', 'lenin'], only=['hub', 'kukuruznik', 'lenin'], twins=False)
            pb.run_check('x', strict=True)
        finally:
            pb.subprocess.run = real_run
        good = len(seen2) == 2 and '--compare-as' not in seen2[0] and '--compare-as' in seen2[1] and seen2[0][seen2[0].index('--only') + 1] == 'hub,kukuruznik,lenin'
        print('%s  publish_building: check_site без пары «бета ⇄ живое»; publish_beta/publish_engine — с парой' % ('OK   ' if good else 'ОШИБКА'))
        ok_all &= bool(good)
        # живое здание из tests/<имя> (publish_building): файлы на месте, без noindex и без tests/, адрес и превью живые;
        # карточка на главной в исходнике == собранная из building.json; до публикации на сайте publish_engine его не видит
        for slug in bp.test_live_slugs():
            pf = bp.place_live_files(site, slug)
            lf2 = bp.build_live(site, [slug])
            pg = (site / slug / 'index.html').read_text(encoding='utf-8')
            subs = [(site / slug / n).read_text(encoding='utf-8') for n in bp.OWN_PAGES if (site / slug / n).is_file()]
            b2 = bp.load_live(slug)[1]
            card_ok = bp.render_card(slug) in (ROOT / 'index.html').read_text(encoding='utf-8')
            good = ('noindex' not in pg and all('noindex' not in s for s in subs) and 'tests/' not in pg and all('tests/' not in s for s in subs)
                    and ('<link rel="canonical" href="%s">' % b2['meta']['url']) in pg
                    and (not b2['meta']['ogImage'] or ('og:image" content="%s%s"' % (b2['meta']['url'], b2['meta']['ogImage'])) in pg)
                    and '%s/index.html' % slug in lf2 and any(f.startswith(slug + '/frames/') for f in pf)
                    and slug in bp.live_buildings(site=site) and slug not in bp.live_buildings(site=tmp / 'нет-сайта'))
            print('%s  живое здание %s из tests/: файлы, адрес, превью, без noindex и tests/%s' % ('OK   ' if good else 'ОШИБКА', slug, '' if card_ok else ' — НО карточка на главной не совпадает с building.json (card)'))
            ok_all &= bool(good and card_ok)
            shutil.rmtree(site / slug)
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
