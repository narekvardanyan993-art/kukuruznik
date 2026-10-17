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
            for suf in ('', '_depth', '_bg', '_bg_depth', '_building', '_env', '_win2', '_sunset', '_night'):
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


def page_config(html_text):
    """CONFIG из собранной страницы (JSON, вшитый в страницу)."""
    a = html_text.index('var CONFIG = ') + len('var CONFIG = ')
    return json.JSONDecoder().raw_decode(html_text[a:])[0]


def strings(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)
    elif isinstance(o, str):
        yield o


def check_stamps():
    """s24: адреса кадров и масок в собранных страницах — со ?v=<хэш содержимого файла> (кэш Safari), у ВСЕХ зданий. Возвращает (ok, строки отчёта)."""
    out, ok = [], True
    HEX = re.compile(r'\?v=[0-9a-f]{8}$')
    tmp = Path(tempfile.mkdtemp(prefix='chka-test-stamp-'))
    try:
        bdirs = ['kukuruznik', 'tests/lenin', 'tests/test-1']
        site = make_site(tmp, bdirs)
        bp.build_beta(site, bdirs)
        for bd in bdirs:
            cfg = page_config((site / 'beta' / bd / 'index.html').read_text(encoding='utf-8'))
            urls = [u for fr in cfg['FRAMES'] for u in strings(fr) if u.endswith(('.webp', '.png')) or '?v=' in u]
            masks = [s['motionVideo']['mask'] for s in cfg['SCENE'] if s.get('motionVideo')]
            clips = [c['src'] for s in cfg['SCENE'] if s.get('motionVideo') for c in s['motionVideo'].get('clips', [])]
            bad = [u for u in urls + masks if not HEX.search(u)]
            badc = [c for c in clips if not HEX.search(c)]   # s25: ролики тоже со ?v
            good = bool(urls) and not bad and not badc
            ok &= good
            out.append('%s  %s: адресов кадров %d, масок %d, роликов %d — все со ?v=<хэш>%s%s' % ('OK   ' if good else 'ОШИБКА', bd, len(urls), len(masks), len(clips), (', без: ' + ', '.join(bad[:3])) if bad else '', (', ролики без ?v: ' + ', '.join(badc[:2])) if badc else ''))
        # хэш = содержимое настоящего файла кадра Ленина, а живая страница Ленина (place_live_files + build_live) получает те же хэши
        cfg = page_config((site / 'beta' / 'tests/lenin' / 'index.html').read_text(encoding='utf-8'))
        fdir = ROOT / 'tests' / 'lenin' / 'frames'
        wrong = [u for u in strings(cfg['FRAMES']) if '?v=' in u and u.split('?v=')[1] != bp.file_hash(fdir / posixpath_name(u))]
        bp.place_live_files(site, 'lenin')
        bp.build_live(site, ['lenin'], engine_from=site / 'beta' / 'engine')
        live = page_config((site / 'lenin' / 'index.html').read_text(encoding='utf-8'))
        pair = lambda c: sorted((posixpath_name(u), u.split('?v=')[1]) for u in strings(c['FRAMES']) + strings(c['SCENE']) if '?v=' in u)
        strings_l = lambda o: list(strings(o))
        same = [(posixpath_name(u), u.split('?v=')[1]) for u in strings_l(live['FRAMES'])] == [(posixpath_name(u), u.split('?v=')[1]) for u in strings_l(cfg['FRAMES'])]
        good = not wrong and same
        # s25: ролик — ?v у mp4 и тот же в запасном webm; движок (mvSetClip из viewer.js) срезает ?v перед .mp4 → .webm и возвращает; файл webm находится
        vids = [c['src'] for s in cfg['SCENE'] if s.get('motionVideo') for c in s['motionVideo'].get('clips', [])]
        vids_ok = bool(vids) and all(HEX.search(v) and (fdir / posixpath_name(v).replace('.mp4', '.webm')).is_file() and (fdir / posixpath_name(v)).is_file() for v in vids)
        js = engine_js_check(vids[0]) if vids else 'нет роликов'
        good = good and vids_ok and js is None
        ok &= good
        out.append('%s  хэш = содержимое настоящего файла (tests/lenin/frames); живой Ленин получает ровно те же хэши, что бета%s' % ('OK   ' if good else 'ОШИБКА', (' — не совпали: ' + ', '.join(wrong[:3])) if wrong else ''))
        out.append('%s  ролики синемаграфа: %d клипов со ?v=<хэш mp4+webm>, mp4 и webm на месте, mvSetClip: с H.264 — .mp4?v, без — .webm?v%s' % ('OK   ' if vids_ok and js is None else 'ОШИБКА', len(vids), (' — ' + js) if js else ''))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # новый файл с прежним именем -> другой адрес (ради этого всё и делается); соседние файлы — прежние
    tmp = Path(tempfile.mkdtemp(prefix='chka-test-stamp-'))
    try:
        site = make_site(tmp, ['kukuruznik'])
        def urls_of():
            bp.build_beta(site, ['kukuruznik'])
            c = page_config((site / 'beta' / 'kukuruznik' / 'index.html').read_text(encoding='utf-8'))
            return {posixpath_name(u): u for u in strings(c['FRAMES']) if '?v=' in u}
        a = urls_of()
        (site / 'kukuruznik' / 'frames' / 'v_angle_0.webp').write_bytes(b'new picture')
        b2 = urls_of()
        changed = sorted(k for k in a if a[k] != b2[k])
        good = changed == ['v_angle_0.webp'] and len(a) > 5
        ok &= good
        out.append('%s  файл кадра изменился при том же имени -> другой ?v= только у него (изменились: %s)' % ('OK   ' if good else 'ОШИБКА', ', '.join(changed) or '—'))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return ok, out


def check_with_building():
    """s25: publish_engine --with-building — новый движок + УЖЕ живое здание (Ленин) в одной сборке. Копия «живого сайта»: старый движок e1.4, старый Ленин
    (одна заглушка кадра), главная со «старой» карточкой. Без здания сборка живых останавливается (так было до s25); с ним — проходит,
    ночь/sway/snow/видео попадают в живую папку, живое == бета. Возвращает (ok, строки отчёта)."""
    import publish_engine as pe
    out, ok = [], True
    def rec(name, good, extra=''):
        nonlocal ok
        ok &= bool(good)
        out.append('%s  %s%s' % ('OK   ' if good else 'ОШИБКА', name, (' — ' + extra) if extra else ''))
    tmp = Path(tempfile.mkdtemp(prefix='chka-test-withb-'))
    try:
        site = make_site(tmp, ['kukuruznik'])
        (site / 'engine').mkdir()
        (site / 'engine' / 'VERSION').write_text('e1.4\n')
        (site / 'engine' / 'viewer.js').write_text('// старый движок\n')
        (site / 'lenin' / 'frames').mkdir(parents=True)
        (site / 'lenin' / 'index.html').write_text('<html>старый Ленин</html>')
        (site / 'lenin' / 'frames' / 'lenin_1.webp').write_bytes(b'')
        hub0 = (ROOT / 'index.html').read_text(encoding='utf-8')
        old_hub = hub0.replace('Площадь Ленина · Ереван', 'Площадь СТАРАЯ · Ереван')
        (site / 'index.html').write_text(old_hub, encoding='utf-8')
        (site / '404.html').write_text((ROOT / '404.html').read_text(encoding='utf-8').replace("lenin: 'lenin/', ", ''), encoding='utf-8')
        bp.build_beta(site, ['kukuruznik', 'tests/lenin'])
        bd = bp.live_buildings(site=site)
        # 1. без здания: старая папка Ленина не годится новой сборке — стоп (то, из-за чего флаг понадобился)
        try:
            bp.build_live(site, bd, engine_from=site / 'beta' / 'engine')
            stop = 'сборка НЕ остановилась'
        except SystemExit as e:
            stop = None if 'lenin_1_night.webp' in str(e) else 'не тот текст: ' + str(e)[:150]
        rec('без --with-building: живой Ленин со старой папкой — сборка останавливается (недостающие кадры ночи/sway)', not stop, stop or '')
        # 2. с зданием: папка из исходника + карточка главной + 404, потом сборка живых на движке беты
        files = bp.place_live_files(site, 'lenin') + bp.place_hub_and_404(site, 'lenin')
        try:
            bp.build_live(site, bd, engine_from=site / 'beta' / 'engine')
            err = None
        except SystemExit as e:
            err = str(e)[:300]
        rec('с --with-building: сборка живых зданий проходит настройки без ошибок', err is None, err or '')
        if err is None:
            rec('движок в живых = %s' % bp.engine_version(), (site / 'engine' / 'VERSION').read_text().strip() == bp.engine_version() and bp.engine_files(site / 'engine') == bp.engine_files(bp.ENGINE))
            fr = site / 'lenin' / 'frames'
            need = ['lenin_1_night.webp', 'lenin_1_sway.png', 'lenin_1_snow.webp', 'lenin_1_motion_1.mp4', 'lenin_1_motion_1.webm', 'lenin_1_motion_mask.png', 'lenin_1_win2.webp']
            miss = [n for n in need if not (fr / n).is_file()] + [n for n in ('about.html', 'history.html', 'og.jpg', 'card.webp') if not (site / 'lenin' / n).is_file()]
            rec('в живой папке: ночь, sway, snow, видео mp4+webm, маска, about/history/og/card', not miss, ', '.join(miss))
            cfg = page_config((site / 'lenin' / 'index.html').read_text(encoding='utf-8'))
            f0 = cfg['FRAMES'][0]
            rec('живая страница Ленина ссылается на ночь/sway/snow со ?v', all(k in f0 and '?v=' in f0[k] for k in ('night', 'sway', 'snow')))
            rec('живое == проверенная бета (CONFIG страницы, файлы frames побайтно)', not bp.live_vs_beta_config(site, 'lenin'), '; '.join(bp.live_vs_beta_config(site, 'lenin')))
            (fr / 'lenin_1_sway.png').write_bytes(b'x')
            bad = bp.live_vs_beta_config(site, 'lenin')
            rec('порча файла живой папки ловится сверкой с бетой', bool(bad) and 'lenin_1_sway.png' in bad[0])
            rec('главная: карточка Ленина на месте, остальное как было; 404: lenin в known',
                (site / 'index.html').read_text(encoding='utf-8') == hub0 and "lenin: 'lenin/'" in (site / '404.html').read_text(encoding='utf-8') and files[-2:] == ['index.html', '404.html'])
        # 3. чужая правка главной вне карточки — стоп
        (site / 'index.html').write_text(old_hub.replace('<h1>', '<h1 class="x">', 1), encoding='utf-8')
        try:
            bp.place_hub_and_404(site, 'lenin')
            hub_stop = 'не остановилась'
        except SystemExit as e:
            hub_stop = None if 'не только карточкой' in str(e) else str(e)[:150]
        rec('главная на сайте с чужим отличием вне карточки — публикация останавливается', not hub_stop, hub_stop or '')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # что скрипт вправе менять в main: с флагом — ещё папка здания, главная, 404; без флага — как раньше
    a0, a1 = pe.allowed_paths(['kukuruznik']), pe.allowed_paths(['kukuruznik', 'lenin'], 'lenin')
    good = (a0('engine/viewer.js') and a0('beta/x') and a0('kukuruznik/index.html') and not a0('lenin/frames/a.webp') and not a0('index.html') and not a0('404.html')
            and a1('lenin/frames/a.webp') and a1('index.html') and a1('404.html') and a1('lenin/index.html') and not a1('kukuruznik/frames/a.webp') and not a1('tools/x.py') and not a1('assets/x.css'))
    rec('allowed_paths: без флага как раньше; с флагом + папка здания, главная, 404; остальное нельзя', good)
    # флаг с неизвестным адресом — стоп до любых действий с git
    old_argv = sys.argv
    sys.argv = ['publish_engine.py', '--with-building', 'nope', '--dry-run']
    try:
        pe.main()
        why = 'не остановился'
    except SystemExit as e:
        why = None if 'нет тестового здания' in str(e) else str(e)[:150]
    finally:
        sys.argv = old_argv
    rec('--with-building с неизвестным адресом — СТОП до git', not why, why or '')
    return ok, out


def check_postcard():
    """s26 (e1.27): открытка «в сторис» — табличка из building.json у ОБОИХ настоящих зданий (название hy/ru/en, годы, chka.am/<здание>) вшита в
    страницу (CONFIG.POSTCARD); движок подключает postcard.js раньше viewer.js; у кнопок открытки и окна «Настроить» есть тексты на трёх языках;
    имя файла открытки прежнее (.png — скачивание на ПК, .jpg — «Поделиться» на телефоне). Возвращает (ok, строки отчёта)."""
    out, ok = [], True
    def rec(name, good, extra=''):
        nonlocal ok
        ok &= bool(good)
        out.append('%s  открытка: %s%s' % ('OK   ' if good else 'ОШИБКА', name, (' — ' + extra) if extra else ''))
    tmp = Path(tempfile.mkdtemp(prefix='chka-test-card-'))
    try:
        bdirs = ['kukuruznik', 'tests/lenin']
        site = make_site(tmp, bdirs)
        bp.build_beta(site, bdirs)
        for bd, url in (('kukuruznik', 'chka.am/kukuruznik'), ('tests/lenin', 'chka.am/lenin')):
            html_text = (site / 'beta' / bd / 'index.html').read_text(encoding='utf-8')
            cfg = page_config(html_text)
            pc = cfg.get('POSTCARD') or {}
            good = isinstance(pc.get('name'), dict) and all((pc['name'].get(l) or '').strip() for l in ('hy', 'ru', 'en')) and re.fullmatch(r'\d{4}–\d{4}', str(pc.get('years', ''))) and pc.get('url') == url
            rec('%s — табличка в странице (%s, %s, %s)' % (bd, pc.get('name', {}).get('hy'), pc.get('years'), pc.get('url')), good)
            a, b = html_text.find('postcard.js?v='), html_text.find('viewer.js?v=')
            rec('%s — postcard.js подключён раньше viewer.js' % bd, 0 <= a < b)
            rec('%s — файл открытки %s' % (bd, cfg.get('POSTCARD_FILE')), str(cfg.get('POSTCARD_FILE', '')).endswith('.png'))
            ui = cfg['UI_I18N']
            miss = [k for k in ('postcard', 'fullscreen', 'cardTitle', 'cardLang', 'cardLine', 'cardSave', 'cardReady', 'cardGrpDate', 'cardGrpSign', 'cardToday', 'cardMyYear', 'cardExhibit', 'cardRare', 'cardRareB', 'sizeNormal', 'sizeLarge', 'cardGrpMoment', 'cardGrpBack', 'cardDawn', 'cardBlue', 'cardBack', 'cardBackHint', 'cardCode', 'cardShow', 'cardTo', 'cardShowOn') if not all((ui.get(k) or {}).get(l) for l in ('hy', 'ru', 'en'))]
            rec('%s — тексты кнопок и окна на hy/ru/en' % bd, not miss, ', '.join(miss))
            ids = [i for i in ('cardBtn', 'fsBtn', 'pActs', 'cardCfg', 'cardPrev', 'cardLine', 'cardGo', 'cardToast', 'cardFlash', 'cardDateSeg', 'cardYear', 'cardNo', 'cardRareB', 'sizeSeg', 'cardTod', 'cardTime', 'cardWx', 'cardBack', 'cardPrevB', 'cardShow', 'cardTo', 'cardLine', 'cardShowOn') if 'id="%s"' % i not in html_text]
            rec('%s — пара кнопок, окно (превью, «Сохранить», дата, подпись) и плашка в странице' % bd, not ids, ', '.join(ids))
            rec('%s — отдельной кнопки «Настроить» нет (e1.28), «Свой ракурс» убран (e1.30)' % bd, 'id="cardCfgBtn"' not in html_text and 'cardHold' not in html_text and 'cardAim' not in html_text)
            rec('%s — e1.32: без «плёнки» и без подсказки под превью; «шоу» в интерфейсе нет — «Праздник»' % bd, 'id="cardFilm"' not in html_text and 'data-i18n="cardHint"' not in html_text and 'шоу' not in html_text.lower() and 'Во время праздника' in html_text
                and ui.get('cardShowOn', {}).get('ru') == 'Во время праздника' and ui.get('cardShowOn', {}).get('hy') == 'Տոնի ժամանակ' and ui.get('cardShowOn', {}).get('en') == 'During the celebration' and not any('шоу' in (v.get('ru') or '').lower() or 'show' in (v.get('en') or '').lower().split() for v in ui.values() if isinstance(v, dict)))
            cwx = re.findall(r'data-cwx="(\w+)"', html_text)
            rec('%s — в «Моменте» только заметные эффекты: снег, дождь, туман (замер s30)' % bd, cwx == ['snow', 'rain', 'fog'], str(cwx))
            rec('%s — своя строка и «Кому» — в группе «Оборот»' % bd, html_text.find('data-grp="back"') < html_text.find('id="cardLine"') and html_text.find('data-grp="back"') < html_text.find('id="cardTo"') and 'maxlength="30"' in html_text)
            grp = re.findall(r'<section class="cc-grp" data-grp="(\w+)"( hidden)?', html_text)
            rec('%s — группы окна (e1.29): Момент, Дата, Подпись, Оборот — все видны, по порядку' % bd, grp == [('moment', ''), ('date', ''), ('sign', ''), ('back', '')], str(grp))
            rec('%s — номер экспоната в странице (%s)' % (bd, pc.get('no')), isinstance(pc.get('no'), int) and pc['no'] >= 1)
        rec('postcard.js скопирован в beta/engine/', (site / 'beta' / 'engine' / 'postcard.js').is_file())
        nos = [page_config((site / 'beta' / bd / 'index.html').read_text(encoding='utf-8')).get('POSTCARD', {}).get('no') for bd in bdirs]
        rec('номера экспонатов разные у разных зданий (%s)' % nos, len(set(nos)) == len(nos))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return ok, out


def check_card_check():
    """s27: проверка открытки на телефоне (check_site → «прогулка») и размещение по зданию. (1) Тексты кода: перехватчик share ставится на телефоне ДО
    загрузки, шаг проверяет JPEG 1080×1920 и один вызов; путь ПК (PNG-скачивание) на месте; Date.now для postcard.js подменяется (одинаковые открытки у
    двух копий сайта). (2) Настоящий Chrome на странице-подделке: зелёная и пять красных (нет файла / не тот размер / PNG / два вызова / без файла) —
    tools/test_card_check.mjs; нет Chrome — пропуск. (3) Размещение: viewer.js передаёт карту здания в postcard.js, у postcard.js три размера таблички
    и запасные места штемпеля. Возвращает (ok, строки отчёта)."""
    import subprocess
    out, ok = [], True
    def rec(name, good, extra=''):
        nonlocal ok
        ok &= bool(good)
        out.append('%s  открытка/проверка: %s%s' % ('OK   ' if good else 'ОШИБКА', name, (' — ' + extra) if extra else ''))
    T = ROOT / 'tools'
    cs, cc = (T / 'check_site.mjs').read_text(encoding='utf-8'), (T / 'card_check.mjs').read_text(encoding='utf-8')
    rec('check_site: share подменяется на телефоне до загрузки, шаг общий с быстрой проверкой',
        "from './card_check.mjs'" in cs and 'if (mobile) await page.evaluateOnNewDocument(SHARE_HOOK)' in cs and 'phoneCardStep(page' in cs and 'CARD_DETERMINISM' in cs)
    rec('check_site: путь ПК (скачивание PNG, blob + a.download) без изменений', "window.__lastImageBlob && window.__download ? true : null" in cs and "'walk-10-postcard.png'" in cs)
    rec('шаг «Открытка → окно → Сохранить» общий для телефона и ПК (e1.28), окно закрывается после шага',
        'export async function cardTapSave' in cc and 'await cardTapSave(page, { click, sleep })' in cs and 'cardTapSave(page, { click, sleep, back })' in cc and 'await cardSheetClose(page, sleep)' in cs)
    rec('шаг телефона: без оборота 1 файл, с оборотом 2 (e1.29); check_card_phone проверяет оба случая; Math.random для postcard.js подменяется',
        'back: true' in (T / 'check_card_phone.mjs').read_text(encoding='utf-8') and 'Math.random = function' in cc and "backCases" in (T / 'test_card_check.mjs').read_text(encoding='utf-8'))
    rec('шаг телефона: JPEG, 1080×1920, один вызов, файл за 20 с', "'image/jpeg'" in cc and 'f.w !== 1080 || f.h !== 1920' in cc and 'const need = back ? 2 : 1' in cc and 'r.n !== 1' in cc and 'shareMs = 20000' in cc)
    rec('check_card_phone.mjs — быстрая проверка одной страницы на том же шаге', "phoneCardStep" in (T / 'check_card_phone.mjs').read_text(encoding='utf-8'))
    for f in ('card_check.mjs', 'check_card_phone.mjs', 'test_card_check.mjs', 'check_site.mjs'):
        r = subprocess.run(['node', '--check', str(T / f)], capture_output=True, text=True)
        rec('node --check tools/%s' % f, r.returncode == 0, r.stderr.strip()[-150:])
    r = subprocess.run(['node', str(T / 'test_card_check.mjs')], capture_output=True, text=True, timeout=180)
    if r.returncode == 2:
        out.append('ПРОПУЩЕНО  открытка/проверка: нет Chrome для puppeteer — зелёная/красные случаи не прогнаны (%s)' % r.stdout.strip()[-100:])
    else:
        rec('настоящий Chrome: зелёная и красные случаи (test_card_check.mjs)', r.returncode == 0, '' if r.returncode == 0 else (r.stdout + r.stderr).strip()[-300:])
    vj, pj = (ROOT / 'engine' / 'viewer.js').read_text(encoding='utf-8'), (ROOT / 'engine' / 'postcard.js').read_text(encoding='utf-8')
    rec('viewer.js передаёт карту здания в открытку', 'function cardBuildingMask' in vj and 'cfg.mask = cardBuildingMask()' in vj and 'cfg.mask : cardBuildingMask()' in vj and "projectB(f, 0, 0)" in vj)
    rec('viewer.js: «табло» при смене языка; «Свой ракурс» убран из цикла кадра; «Показать» снимает сцену и возвращает её; лицо без своей строки (e1.30)',
        'function tabloSwap' in vj and 'tabloSwap(function () {' in vj and 'tiltHold' not in vj and 'function shoot(w)' in vj and 'sceneRestore(S)' in vj and "o.line = '';" in vj and "CWX = ['snow', 'rain', 'fog']" in vj)
    dj = (ROOT / 'engine' / 'details.js').read_text(encoding='utf-8')
    rec('«Во время праздника» (e1.31): шоу снимается на кадре и секунде из building.json, парад замораживается и обрывается, кадр и сцена возвращаются',
        all(k in vj for k in ('function shootRun', 'function cardShowCfg', 'function frameJump', 'paradeFreeze', 'paradeStop', 'w.show && !!cardShowCfg(w)', "cardSet.show")) and all(k in dj for k in ('paradeFreeze: freezeParade', 'paradeStop: stopParadeNow', 'par.fix')))
    rec('postcard.js (e1.32): оборот — бумага, «от руки», «Кому», марка + штемпель, одна строка выходных данных (без рамок, заголовка, «Куда», индекса); на табличке нет адреса — он в дуге штемпеля; старая бумага на лице',
        'function composeBack' in pj and 'o.to' in pj and 'o.time' in pj and 'function code(seed)' in pj and 'function topLine' not in pj and 'function agedPaper' in pj and 'o.paperBack' in pj
        and 'ПОЧТОВАЯ КАРТОЧКА' not in pj and 'Индекс предприятия' not in pj and 'x.fillText(o.url' not in pj and 'String(o.url).toUpperCase()' in pj)
    pp = sorted((ROOT / 'engine' / 'paper').glob('*.webp')) if (ROOT / 'engine' / 'paper').exists() else []
    rec('бумага открытки (e1.32): engine/paper — 1–2 webp, каждый ≤ 200 КБ; грузится только при открытии окна (cardPaperLoad)', 1 <= len(pp) <= 2 and all(q.stat().st_size <= 200 * 1024 for q in pp) and 'function cardPaperLoad' in vj and "engineUrl('paper/' + name)" in vj,
        ', '.join('%s %d КБ' % (q.name, q.stat().st_size // 1024) for q in pp))
    rec('окно (e1.32): 2D-настройки (язык, дата, оборот, строка, «Кому») перерисовываются сразу, «Показать» — только для сцены', 'function redraw2D' in vj and "wantKey(cfg.want) !== cfg.srcKey" in vj and vj.count('redraw2D(') >= 7)
    rec('postcard.js: карта здания, три размера таблички, запасные места штемпеля', 'function bldMap' in pj and all(k in pj for k in ('PQ.full', 'PQ.compact', 'PQ.mini')) and 'function stampPlace' in pj and 'waves: waves' in pj)
    return ok, out


def engine_js_check(clip_src):
    """Запускает настоящий mvSetClip из engine/viewer.js (node, заглушка видео): с H.264 адрес = base + mp4?v, без — base + webm?v;
    старый адрес без ?v ведёт себя как раньше. Возвращает None (всё верно) или текст ошибки."""
    import subprocess
    code = r"""
const src = require('fs').readFileSync(process.argv[1], 'utf8');
const a = src.indexOf('function mvSetClip(S, j) {'), b = src.indexOf('function mvOpen(', a);
if (a < 0 || b < 0) { console.log('нет mvSetClip в viewer.js'); process.exit(0); }
const mvSetClip = new Function('return (' + src.slice(a, b).trim().replace(/\}\s*$/, '}') + ')')();
const run = (s, h264) => { const S = { clips: [{ src: s }], base: 'B/', h264, v: { load() {} } }; mvSetClip(S, 0); return S.v.src; };
const q = process.argv[2], bad = [];
const base = q.split('?')[0], qs = q.slice(base.length), webm = base.replace(/\.mp4$/, '.webm');
if (run(q, true) !== 'B/' + q) bad.push('H.264: ' + run(q, true));
if (run(q, false) !== 'B/' + webm + qs) bad.push('без H.264: ' + run(q, false));
if (run(base, true) !== 'B/' + base) bad.push('старый адрес H.264: ' + run(base, true));
if (run(base, false) !== 'B/' + webm) bad.push('старый адрес без H.264: ' + run(base, false));
console.log(bad.join('; '));
"""
    r = subprocess.run(['node', '-e', code, str(bp.ENGINE / 'viewer.js'), clip_src], capture_output=True, text=True)
    return None if r.returncode == 0 and not r.stdout.strip() else (r.stdout.strip() or r.stderr.strip()[-200:])


def posixpath_name(u):
    return u.split('?')[0].rsplit('/', 1)[-1]


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
        ('14. снег без времени таяния (e1.25)', K, set_(lambda b: b['look'].__setitem__('snow', {'accumS': 35})), 'нет обязательного поля «meltS»', None),
        ('15. порывы: сила не тремя числами (e1.25)', K, set_(lambda b: b['look'].__setitem__('gusts', {'level': [1, 1], 'gap': [5, 11], 'attack': 1, 'hold': 1, 'decay': 3, 'calm': 0.5, 'boost': 1, 'flutter': 1, 'spring': 0.5, 'damp': 0.3, 'leanPx': 6, 'delay': 0.6})), 'look.gusts.level', None),
        ('16. маска снега кадра не да/нет (e1.25)', K, set_(lambda b: b['frames'][0].__setitem__('snowMask', 'yes')), 'snowMask', None),
        ('17. поля качания крон кадра не да/нет (e1.26)', K, set_(lambda b: b['frames'][0].__setitem__('sway', 1)), 'sway', None),
        ('18. сдвиг кроны вне 2..40 px (e1.26)', K, set_(lambda b: b['look'].__setitem__('gusts', {'level': [0.3, 0.8, 1], 'gap': [5, 11], 'attack': 1, 'hold': 1, 'decay': 3, 'calm': 0.5, 'boost': 1, 'flutter': 1, 'spring': 0.5, 'damp': 0.3, 'leanPx': 6, 'delay': 0.6, 'swayMaxPx': 90})), 'look.gusts.swayMaxPx', None),
        ('19. листья без размера (e1.26)', K, set_(lambda b: b['look'].__setitem__('gusts', {'level': [0.3, 0.8, 1], 'gap': [5, 11], 'attack': 1, 'hold': 1, 'decay': 3, 'calm': 0.5, 'boost': 1, 'flutter': 1, 'spring': 0.5, 'damp': 0.3, 'leanPx': 6, 'delay': 0.6, 'leaves': {'colors': [[60, 120, 30, 1]]}})), 'нет обязательного поля «size»', None),
        ('20. кадр с sway без файла полей (e1.26)', K, set_(lambda b: b['frames'][1].__setitem__('sway', True)), '_sway.png', None),
        ('21. открытка: нет названия на en (e1.27)', K, set_(lambda b: b['postcard']['name'].pop('en')), 'postcard.name: нет текста на языке «en»', None),
        ('22. открытка: адрес с https:// (e1.27)', K, set_(lambda b: b['postcard'].__setitem__('url', 'https://chka.am/kukuruznik/')), 'postcard.url', None),
        ('23. открытка: нет годов (e1.27)', K, set_(lambda b: b['postcard'].pop('years')), 'postcard: нет обязательного поля «years»', None),
        ('24. открытка: опечатка в поле (e1.27)', K, set_(lambda b: b['postcard'].__setitem__('yaers', '1979')), 'неизвестное поле «yaers»', None),
        ('25. открытка: номер экспоната строкой (e1.28)', K, set_(lambda b: b['postcard'].__setitem__('no', '1')), 'postcard.no', None),
        ('26. открытка: номер экспоната 0 (e1.28)', K, set_(lambda b: b['postcard'].__setitem__('no', 0)), 'postcard.no', None),
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
            hub_src = (ROOT / 'index.html').read_text(encoding='utf-8')
            st = bp.render_stack(slug)
            card_ok = bp.render_card(slug) in hub_src and (st is None or st in hub_src)   # карточка и (если задано card.stack) картинка в стопке — как из building.json
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
    ok_wb, lines_wb = check_with_building()
    for l in lines_wb:
        print(l)
    ok_all &= ok_wb
    ok_st, lines_st = check_stamps()
    for l in lines_st:
        print(l)
    ok_all &= ok_st
    ok_pc, lines_pc = check_postcard()
    for l in lines_pc:
        print(l)
    ok_all &= ok_pc
    ok_cc, lines_cc = check_card_check()
    for l in lines_cc:
        print(l)
    ok_all &= ok_cc
    # стопка главной: картинка здания встаёт на место силуэта, повтор ничего не меняет, чужое место и вне-диффы ловятся
    hub0 = (ROOT / 'index.html').read_text(encoding='utf-8')
    base = re.sub(r'\s*<!-- stack:lenin .*?<!-- /stack:lenin -->', '\n      <div class="stack-card sc-c"><div class="sc-pic"><svg class="ghost" viewBox="0 0 200 200"><use href="#ghost-statue"/></svg></div></div>', hub0, flags=re.S)
    cardh, stackh = bp.render_card('lenin'), bp.render_stack('lenin')
    h1 = bp.hub_with_card(base, 'lenin', cardh, stackh)
    h2 = bp.hub_with_card(h1, 'lenin', cardh, stackh)
    kuk = [l for l in hub0.splitlines() if 'stack-card sc-d' in l]
    try:
        bp.hub_with_card(h1.replace('<!-- stack:lenin', '<!-- x:lenin').replace('<!-- /stack:lenin', '<!-- /x:lenin'), 'lenin', cardh, stackh)
        busy = False
    except SystemExit:
        busy = True   # место sc-c уже занято картинкой, а не силуэтом, и меток нет — СТОП, чужую картинку не затираем
    ok_s = (h1 == hub0 and h2 == h1 and stackh and 'lenin/card.webp' in stackh and '#ghost-statue"/></svg></div></div>' not in h1.split('<main')[1]
            and not bp.hub_outside_diff(base, h1, 'lenin') and [l for l in h1.splitlines() if 'stack-card sc-d' in l] == kuk and busy
            and bp.hub_outside_diff(base, h1.replace('<h1>', '<h1 class="x">', 1), 'lenin'))
    print('%s  стопка главной: картинка Ленина из card.stack/card.image на месте силуэта, повтор без изменений, Кукурузник и остальное не тронуты, правка вне карточки/стопки ловится' % ('OK   ' if ok_s else 'ОШИБКА'))
    ok_all &= bool(ok_s)
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
