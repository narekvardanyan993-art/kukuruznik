#!/usr/bin/env python3
"""Тесты конвейера станка П4 (без браузера): вставка по матрице версий и гейт G3, гейты G2 и G9, гейт пакета, init, intake, layers.

  python3 tools/test_stanok_p4.py            # все тесты; код выхода 0 — зелёные
Тестовая правка — настоящая правка Gemini надписи на камне кадра B Погоса (tools/stanok_fixtures/insert_pogos_b_narek.png).
Всё идёт во временных копиях: файлы зданий и журналы в репозитории не трогаются."""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np                     # noqa: E402
from PIL import Image                  # noqa: E402
import stanok                          # noqa: E402
import stanok_insert as si             # noqa: E402
import stanok_layers as sl             # noqa: E402
import stanok_pack as sp               # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
B = 'tests/pogos-petros'
FRAME = 'pogos_b'
EDIT = ROOT / 'tools' / 'stanok_fixtures' / 'insert_pogos_b_narek.png'
BOX = [0.05208, 0.72161, 0.46875, 0.95604]


def fresh(**kw):
    tb, work = stanok.temp_building(B, FRAME), Path(tempfile.mkdtemp(prefix='p4-work-'))
    e = si.insert(str(tb), FRAME, EDIT, BOX, kind='inscription', iid='narek-test', text='NAREK', work=work, quiet=True, **kw)
    return tb, work, e


def shas(tb):
    return {p.name: si.sha(p.read_bytes()) for p in sorted((tb / 'frames').glob(FRAME + '*')) if not p.is_symlink()}


def test_insert_matrix():
    """Одна команда — все версии кадра: день, слой здания, закат, ночь изменились; подложка под зданием и маски — нет; G3 зелёный."""
    tb, work, e = fresh()
    v = e['versions']
    assert e['layer'] == 'building', e['layer']
    for k in ('day', 'building', 'sunset', 'night'):
        assert v[k]['changedPx'] > 500, (k, v[k])
    for k in ('bg', 'snow', 'depth', 'bg_depth', 'env', 'win'):
        assert v[k]['changedPx'] == 0 and v[k]['action'] == 'не трогает', (k, v[k])
    assert set(v) == {k for k, _ in si.MATRIX}, 'в журнале названы не все строки матрицы'
    probs, n = si.gate_g3_files(str(tb), work)
    assert n == 1 and not probs, probs
    assert not si.gate_g3_idem(str(tb), work)
    assert (work / 'inserts' / 'narek-test' / 'sheet.jpg').is_file()
    # файлы, которых вставка не касается, остались байт в байт
    for fn in (FRAME + '_bg.webp', FRAME + '_snow.webp', FRAME + '_depth.webp', FRAME + '_env.webp'):
        assert (tb / 'frames' / fn).read_bytes() == (ROOT / B / 'frames' / fn).read_bytes(), fn


def test_idempotent():
    """Повторная вставка с тем же id: одна запись в журнале, файлы те же байт в байт; переигрывание — тоже."""
    tb, work, _ = fresh()
    h1 = shas(tb)
    si.insert(str(tb), FRAME, EDIT, BOX, kind='inscription', iid='narek-test', text='NAREK', work=work, quiet=True)
    assert shas(tb) == h1, 'повторная вставка изменила файлы'
    assert len(si.load_journal(work)['inserts']) == 1
    si.replay(str(tb), work=work, quiet=True)
    assert shas(tb) == h1, 'переигрывание изменило файлы'
    os.environ['STANOK_BREAK'] = 'insert-dup'
    try:
        assert si.gate_g3_idem(str(tb), work), 'красный случай «двойная надпись» не покраснел'
    finally:
        del os.environ['STANOK_BREAK']


def test_only_day_red():
    """Урок pp-17: вставка есть в дне, нет на закате и ночью — G3 обязан покраснеть на обеих версиях."""
    tb, work, _ = fresh(only=('day',))
    probs = si.gate_g3_files(str(tb), work)[0]
    assert any('закат' in q for q in probs) and any('ночь' in q for q in probs), probs


def test_new_master_replays():
    """Новая ночь положена руками — G3 красный («мимо станка»); та же ночь через put_clean — вставка наложена заново, G3 зелёный."""
    tb, work, _ = fresh()
    night = FRAME + '_night.webp'
    clean = (work / 'base' / night).read_bytes()
    (tb / 'frames' / night).write_bytes(clean)
    assert any('мимо станка' in q for q in si.gate_g3_files(str(tb), work)[0])
    a = si.decode(clean).astype(np.float32) * 0.97                      # «новый мастер ночи» — чуть темнее
    assert si.put_clean(str(tb), night, si.encode_like(a, clean), work) is True
    assert not si.gate_g3_files(str(tb), work)[0], si.gate_g3_files(str(tb), work)[0]
    assert (tb / 'frames' / night).read_bytes() != (work / 'base' / night).read_bytes(), 'вставка в новую ночь не легла'


def test_remove():
    tb, work, _ = fresh()
    si.remove(str(tb), 'narek-test', work)
    j = si.load_journal(work)
    assert not j['inserts'] and len(j['removed']) == 1
    for fn in shas(tb):
        assert (tb / 'frames' / fn).read_bytes() == (ROOT / B / 'frames' / fn).read_bytes(), 'после удаления вставки файл %s не вернулся к чистому' % fn


def test_stale_base():
    """Вставку убрали, потом кадр законно изменился мимо журнала (вставок нет) — следующая вставка берёт основу заново, а не старую."""
    tb, work, _ = fresh()
    si.remove(str(tb), 'narek-test', work)
    night = tb / 'frames' / (FRAME + '_night.webp')
    raw = night.read_bytes()
    new = si.encode_like(si.decode(raw).astype(np.float32) * 0.9, raw)
    night.write_bytes(new)
    si.insert(str(tb), FRAME, EDIT, BOX, kind='inscription', iid='narek-test', text='NAREK', work=work, quiet=True)
    assert (work / 'base' / night.name).read_bytes() == new, 'основа осталась старой — вставка легла бы на прежнюю ночь'
    assert not si.gate_g3_files(str(tb), work)[0]


def test_guards():
    """Героя задевать нельзя (ролик снят с прежнего рисунка); запретная зона — стоп; чужая картинка — стоп."""
    tb, work = stanok.temp_building(B, FRAME), Path(tempfile.mkdtemp(prefix='p4-work-'))
    day = si.read_img(tb / 'frames' / (FRAME + '.webp'))[..., :3]
    box = [0.42, 0.70, 0.68, 0.83]                                       # прямоугольник собаки
    x0, y0, x1, y1 = si.box_px(box, day.shape[1], day.shape[0])
    c = day[y0:y1, x0:x1].copy()
    h, w = c.shape[:2]
    c[h // 4:3 * h // 4, w // 4:3 * w // 4] = c[h // 4:3 * h // 4, w // 4:3 * w // 4][::-1, ::-1]
    p = Path(tempfile.mkdtemp()) / 'e.png'
    Image.fromarray(c).save(p)
    for expect, kw, edit, bx in (('героя', {}, p, box), ('правка', {}, ROOT / B / 'frames' / 'show_leaf_1.png', BOX)):     # чужая картинка: «не совпала» или «перерисован весь кусок»
        try:
            si.insert(str(tb), FRAME, edit, bx, kind='flat', iid='g', work=work, quiet=True, **kw)
            raise AssertionError('вставка прошла, а должна была остановиться: ' + expect)
        except SystemExit as e:
            assert expect in str(e), str(e)
    (tb / 'zones.json').write_text(json.dumps({'forbidden': [{'frame': FRAME, 'rect': [0.1, 0.78, 0.4, 0.9], 'why': 'стена церкви'}]}), encoding='utf-8')
    try:
        si.insert(str(tb), FRAME, EDIT, BOX, kind='inscription', iid='z', work=work, quiet=True)
        raise AssertionError('надпись легла в запретную зону')
    except SystemExit as e:
        assert 'запретную зону' in str(e), str(e)
    assert not si.load_journal(work)['inserts'], 'остановленная вставка попала в журнал'


def test_object_kind():
    """Предмет (kind: object) на земле: кроме цветных версий меняются глубина и маска снега; G3 зелёный. «Предмет» — кусок того же
    рисунка, переставленный на пустое место двора (тестовые данные)."""
    name = 'pogos_a'
    tb, work = stanok.temp_building(B, name), Path(tempfile.mkdtemp(prefix='p4-work-'))
    day = si.read_img(tb / 'frames' / (name + '.webp'))[..., :3]
    al = si.read_img(tb / 'frames' / (name + '_building.webp'))[..., 3]
    H, W = day.shape[:2]
    cfg = json.loads((tb / 'building.e2.json').read_text(encoding='utf-8'))
    rects = [a['rect'] for f in cfg['frames'] if f['name'] == name for a in f['effects'].get('actors', {}).get('list', [])]
    for v0 in (0.86, 0.8, 0.74, 0.9):
        for u0 in (0.05, 0.35, 0.62, 0.2, 0.5):
            box = [u0, v0, u0 + 0.3, min(1.0, v0 + 0.1)]
            x0, y0, x1, y1 = si.box_px(box, W, H)
            if al[y0:y1, x0:x1].max() > 8 or any(si._inter(box, r) > 0 for r in rects):
                continue
            c = day[y0:y1, x0:x1].copy()
            h, w = c.shape[:2]
            ya, yb, xa, xb = h // 4, 3 * h // 4, w // 3, 2 * w // 3
            c[ya:yb, xa:xb] = 255 - c[ya:yb, xa:xb]                      # заметно другой кусок (тест, не рисунок сайта)
            p = Path(tempfile.mkdtemp()) / 'obj.png'
            Image.fromarray(c).save(p)
            e = si.insert(str(tb), name, p, box, kind='object', iid='obj', work=work, quiet=True)
            v = e['versions']
            assert e['layer'] == 'ground'
            assert v['bg']['changedPx'] > 100 and v['day']['changedPx'] > 100 and v['night']['changedPx'] > 100, v
            assert v['depth']['action'] == 'глубина' and v['snow']['action'] == 'маска пересчитана', v
            assert not si.gate_g3_files(str(tb), work)[0], si.gate_g3_files(str(tb), work)[0]
            return
    raise AssertionError('не нашлось пустого места на земле кадра A')


def test_g2_g9():
    assert not sl.gate_g2(B)[0], sl.gate_g2(B)[0]
    assert not sl.gate_g9(B)[0], sl.gate_g9(B)[0]
    for g, case, ok in sl.selftest_g2(B) + sl.selftest_g9(B):
        assert ok, '%s не покраснел: %s' % (g, case)


def test_pack_gate():
    assert not sp.gate_pack('surb-nikolay'), sp.gate_pack('surb-nikolay')
    for g, case, ok in sp.selftest_pack('surb-nikolay'):
        assert ok, 'гейт пакета не покраснел: %s' % case
    assert sp.gate_pack('no-such-building')


def test_init():
    """init: заготовка здания из пакета во временном «репозитории»; повторный запуск ничего не перезаписывает; красный пакет — стоп."""
    repo = Path(tempfile.mkdtemp(prefix='p4-repo-'))
    made = sp.init('surb-nikolay', repo=repo, quiet=True)
    cfg = json.loads((repo / 'tests/surb-nikolay/building.e2.json').read_text(encoding='utf-8'))
    assert cfg['format'] == 2 and cfg['id'] == 'surb-nikolay' and [f['name'] for f in cfg['frames']] == ['nikolay_' + k for k in 'abcde'], cfg['frames']
    assert [f['kind'] for f in cfg['frames']] == ['wide', 'wide', 'close', 'wide', 'wide']
    assert cfg['text']['title']['ru'] == 'Никольский собор'
    for sub in ('masters/nikolay_a', 'inserts', 'veo', 'ref'):
        assert (repo / 'work/surb-nikolay' / sub).is_dir(), sub
    assert (repo / 'work/surb-nikolay/story.md').is_file() and (repo / 'work/surb-nikolay/STEPS.md').is_file()
    z = json.loads((repo / 'tests/surb-nikolay/zones.json').read_text(encoding='utf-8'))
    assert len(z['forbidden']) >= 3
    before = (repo / 'tests/surb-nikolay/building.e2.json').read_bytes()
    assert sp.init('surb-nikolay', repo=repo, quiet=True) == [] and (repo / 'tests/surb-nikolay/building.e2.json').read_bytes() == before
    st = sp.status('surb-nikolay', repo=repo, quiet=True)
    assert st['next'].startswith('S2'), st['next']
    # заготовка честно НЕ собирается: рисунков ещё нет — сборка падает громко, по-русски
    try:
        stanok.build(str(repo / 'tests/surb-nikolay'), tempfile.mkdtemp(), quiet=True)
        raise AssertionError('заготовка без рисунков собралась')
    except SystemExit as e:
        assert str(e).startswith('ОШИБКА building.json'), str(e)
    bad = Path(tempfile.mkdtemp(prefix='p4-pack-'))
    shutil.copytree(ROOT / 'buildings-next' / 'surb-nikolay', bad / 'surb-nikolay')
    t = (bad / 'surb-nikolay/CHECKLIST.md').read_text(encoding='utf-8').replace('**ПРОХОДИТ**', '**НЕ ПРОХОДИТ**', 1)
    (bad / 'surb-nikolay/CHECKLIST.md').write_text(t, encoding='utf-8')
    repo2 = Path(tempfile.mkdtemp(prefix='p4-repo-'))
    try:
        sp.init('surb-nikolay', root=bad, repo=repo2, quiet=True)
        raise AssertionError('init прошёл с красным пакетом')
    except SystemExit as e:
        assert 'не проходит гейт' in str(e)
    assert not any(repo2.rglob('*')), 'красный пакет, а на диск что-то записано'


def test_intake_layers():
    """intake: день и ночь Погоса B как «рисунки Gemini» — приняты; ночь, сдвинутая на 5 px, выравнивается; не 9:16 и другой кадр — стоп.
    layers без моделей глубины: слои пропущены с понятным текстом, а новая ночь ложится через put_clean и вставка журнала остаётся."""
    tb, work, _ = fresh()
    src = Path(tempfile.mkdtemp(prefix='p4-src-'))
    day = Image.open(ROOT / 'pogos-petros/frames/B.png').convert('RGB')
    day.save(src / 'day.png')
    night = np.array(Image.open(ROOT / B / 'frames' / (FRAME + '_night.webp')).convert('RGB'))
    Image.fromarray(sl.shift_img(night, 5, -3)).save(src / 'night_shifted.png')
    sl.intake(str(tb), FRAME, 'day', src / 'day.png', work, quiet=True)
    st = sl.intake(str(tb), FRAME, 'night', src / 'night_shifted.png', work, quiet=True)
    assert st['shift'] == [-5, 3], st                                  # shift_img(…, 5, −3) уводит содержимое влево на 5 и вниз на 3
    got = np.array(Image.open(work / 'masters' / FRAME / 'night.png'))
    dx, dy, c = sl.best_shift(np.array(day.resize((768, 1365), Image.LANCZOS)), got)
    assert max(abs(dx), abs(dy)) <= 1, (dx, dy)
    day.crop((0, 0, 1536, 1536)).save(src / 'square.png')
    for bad, ver, expect in ((src / 'square.png', 'day', '9:16'), (ROOT / 'pogos-petros/frames/A.png', 'night', 'не совпадают')):
        try:
            sl.intake(str(tb), FRAME, ver, bad, work, quiet=True)
            raise AssertionError('intake принял негодный рисунок: ' + expect)
        except SystemExit as e:
            assert expect in str(e), str(e)
    rep = sl.layers(str(tb), FRAME, work, models='/no/such/dir', quiet=True)[0]
    assert any('слои и глубина' in q for q in rep['skipped']) and (FRAME + '_night.webp') in rep['done'], rep
    assert not si.gate_g3_files(str(tb), work)[0], 'после новой ночи вставка пропала: %s' % si.gate_g3_files(str(tb), work)[0]
    assert not rep['g9'], rep['g9']


if __name__ == '__main__':
    tests = [(k, v) for k, v in sorted(globals().items()) if k.startswith('test_') and callable(v)]
    only = sys.argv[1:]
    bad = 0
    for name, fn in tests:
        if only and name not in only:
            continue
        try:
            fn()
            print('ок      ' + name)
        except AssertionError as e:
            bad += 1
            print('ПРОВАЛ  %s: %s' % (name, e))
    print('ИТОГ: %s' % ('все тесты зелёные' if not bad else 'провалов: %d' % bad))
    sys.exit(1 if bad else 0)
