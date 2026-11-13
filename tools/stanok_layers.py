#!/usr/bin/env python3
"""Станок: приём рисунков кадра (intake), слои (layers) и гейты G2 (кайма вырезки) и G9 (совмещение версий) — docs/STANOK.md §1.2 S2–S4, §6.

  intake <здание> <кадр> <версия> <файл>   версия: day | bg | night | sunset | snow. Проверки: 9:16 ±1 %, нет белых краёв бумаги; версии
                                          (всё, кроме day) совмещаются с днём сдвигом и обязаны лечь не хуже 1 px (G9), в ночном небе
                                          нет чужой луны. Принятый рисунок → work/<slug>/masters/<кадр>/<версия>.png (прежний — в _prev/).
  layers <здание> [кадр]                   мастера → файлы сайта tests/<slug>/frames/: слои и глубина (tools/build_building_layers.py, нужны
                                          модели), закат и ночь в размере кадра, маска снега (зима − день), числа неба в building.e2.json.
                                          Каждый файл кладётся через stanok_insert.put_clean — вставки журнала накладываются заново.
Ничего не рисует: сравнивает, режет и размечает готовые рисунки Gemini.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import stanok_insert as si

ROOT = Path(__file__).resolve().parent.parent
F32 = np.float32
VERSIONS = ('day', 'bg', 'night', 'sunset', 'snow')
G9_MAX_SHIFT = 1            # версии кадра против дня: сдвиг контуров не больше 1 px (docs/STANOK.md §6)
G9_MIN_MATCH = 0.45         # совпадение контуров ниже — это другой рисунок, а не сдвинутый. Замер П4: версии Погоса 0,68–0,98; чужие кадры между собой 0,23–0,33
G9_SEARCH = 6               # ищем сдвиг в пределах ±6 px (в размере кадра сайта)
G2_PAPER_SHARE = 0.005      # кайма: в кольце 3 px у края вырезки «бумажно-светлых» точек не больше 0,5 %
G2_MAX_CUT = 0.90           # вырезка здания меньше 90 % кадра


class StanokError(SystemExit):
    def __init__(self, msg):
        super().__init__('ОШИБКА станка: ' + msg)


def _rgb(path, size=None):
    im = Image.open(path).convert('RGB')
    if size and im.size != tuple(size):
        im = im.resize(tuple(size), Image.LANCZOS)
    return np.array(im)


def _edge(a):
    g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    return cv2.GaussianBlur(cv2.Canny(g, 40, 110).astype(F32), (0, 0), 1.2)


def best_shift(day, ver, mask=None, search=G9_SEARCH):
    """Целый сдвиг (dx, dy), при котором контуры версии лучше всего ложатся на контуры дня, и совпадение контуров при нём (0..1).
    mask — где сравнивать (подложку — вне здания). Положительный dx: версия сдвинута вправо относительно дня."""
    ed, ev = _edge(day), _edge(ver)
    if mask is not None:
        ed, ev = ed * mask, ev * mask
    H, W = ed.shape
    m = search + 2
    a = ed[m:H - m, m:W - m]
    a = a - a.mean()                                              # совпадение — корреляция БЕЗ среднего: у двух разных рисунков с густым штрихом
    na = float(np.sqrt((a * a).sum())) + 1e-6                     # обычное произведение даёт 0,5; без среднего — около 0,1
    best = (-1.0, 0, 0)
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            b = ev[m + dy:H - m + dy, m + dx:W - m + dx]
            b = b - b.mean()
            c = float((a * b).sum()) / (na * (float(np.sqrt((b * b).sum())) + 1e-6))
            if c > best[0]:
                best = (c, dx, dy)
    return best[1], best[2], best[0]


def shift_img(a, dx, dy):
    """Выборка со сдвигом: точка (x, y) результата берётся из (x + dx, y + dy) — содержимое уезжает на (−dx, −dy). Края — повтором
    крайних пикселей (без чёрных полос). Версию, сдвинутую относительно дня на (dx, dy), возвращает на место."""
    H, W = a.shape[:2]
    ys = np.clip(np.arange(H) + dy, 0, H - 1)
    xs = np.clip(np.arange(W) + dx, 0, W - 1)
    return a[ys][:, xs]


def open_sky(day, env=None):
    """Открытое небо кадра: светлое на дневном рисунке, (по маске окружения — небо,) и связано с верхним краем кадра. Маска окружения
    одна не годится: у Погоса её «небо» захватывает двор и светлые стены — огни окон читались бы как луна."""
    m = day.astype(F32).mean(-1) > 170
    if env is not None:
        m &= env[..., 0] > 128
    m = cv2.erode(m.astype(np.uint8), np.ones((9, 9), np.uint8))
    n, lab = cv2.connectedComponents(m, connectivity=4)
    top = np.unique(lab[0][lab[0] > 0])
    return np.isin(lab, top) if len(top) else np.zeros(m.shape, bool)


def sky_blobs(night, sky):
    """Яркие пятна в ночном небе (чужая луна, нимб): связные области ярче неба на 70 и не темнее 120, площадью ≥ 0,02 % кадра,
    округлые (заполнение рамки ≥ 0,55, стороны рамки не больше 1 : 2) — полоса зари или облако луной не считаются."""
    l = night.astype(F32).mean(-1)
    if sky.sum() < 500:
        return []
    med = float(np.median(l[sky]))
    m = ((l > max(120.0, med + 70.0)) & sky).astype(np.uint8)
    n, lab, stt, cen = cv2.connectedComponentsWithStats(m, 8)
    H, W = l.shape
    out = []
    for j in range(1, n):
        x, y, w, h, area = stt[j]
        if area >= 0.0002 * H * W and area >= 0.55 * w * h and 0.5 <= w / max(1, h) <= 2.0:
            out.append((round(cen[j][0] / W, 3), round(cen[j][1] / H, 3), int(area)))
    return out


def frame_versions(fdir, name):
    """Версии кадра на сайте, которые сверяются с днём: {версия: путь}."""
    out = {}
    for v, suf in (('bg', '_bg'), ('sunset', '_sunset'), ('night', '_night')):
        p = Path(fdir) / ('%s%s.webp' % (name, suf))
        if p.is_file():
            out[v] = p
    return out


def g9_frame(fdir, name, masters=None):
    """G9 одного кадра: версии против дня. Возвращает (проблемы, числа)."""
    fdir = Path(fdir)
    probs, rows = [], []
    dp = fdir / (name + '.webp')
    if not dp.is_file():
        return ['кадр %s: нет дневного рисунка' % name], rows
    day = _rgb(dp)
    H, W = day.shape[:2]
    bl = fdir / (name + '_building.webp')
    out_b = None
    if bl.is_file():
        al = np.array(Image.open(bl).convert('RGBA'))[..., 3]
        out_b = (cv2.dilate((al > 8).astype(np.uint8), np.ones((49, 49), np.uint8)) == 0).astype(F32)     # вне здания + 24 px
    env = fdir / (name + '_env.webp')
    sky = open_sky(day, _rgb(env) if env.is_file() else None)
    vers = dict(frame_versions(fdir, name))
    if masters and (Path(masters) / 'snow.png').is_file():
        vers['snow (мастер зимы)'] = Path(masters) / 'snow.png'
    for v, p in vers.items():
        ver = _rgb(p, (W, H))
        mask = out_b if v == 'bg' else None
        if mask is not None and mask.mean() < 0.03:
            rows.append({'frame': name, 'version': v, 'skip': 'вне здания почти нет кадра'})
            continue
        dx, dy, c = best_shift(day, ver, mask)
        rows.append({'frame': name, 'version': v, 'dx': dx, 'dy': dy, 'match': round(c, 3)})
        ru = si.VERSION_RU.get(v, v)
        if c < G9_MIN_MATCH:
            probs.append('кадр %s, %s: контуры не совпадают с днём (%.2f) — это другой рисунок или кадр перекомпонован' % (name, ru, c))
        elif max(abs(dx), abs(dy)) > G9_MAX_SHIFT:
            probs.append('кадр %s, %s: сдвинута относительно дня на (%d, %d) px — больше %d px' % (name, ru, dx, dy, G9_MAX_SHIFT))
        if v == 'night':
            for u, vv, area in sky_blobs(ver, sky):
                probs.append('кадр %s, ночь: яркое пятно в небе у (%.2f, %.2f), %d px — чужая луна или нимб (луну рисует движок)' % (name, u, vv, area))
    return probs, rows


def gate_g9(bdir, frames=None):
    """Совмещение версий кадра с днём: ночь, закат, подложка (и мастер зимы, если есть) — сдвиг ≤ 1 px; в ночном небе нет чужой луны."""
    fdir = si.frames_dir(bdir)
    names = _frame_names(bdir, frames)
    probs, rows = [], []
    for n in names:
        p, r = g9_frame(fdir, n, si.work_dir(bdir) / 'masters' / n)
        probs += p
        rows += r
    return probs, rows


def _frame_names(bdir, frames=None):
    b = si.bpath(bdir)
    cfg = json.loads((b / 'building.e2.json').read_text(encoding='utf-8'))
    names = [f['name'] for f in cfg.get('frames', [])]
    if frames:
        want = set(str(frames).split(','))
        names = [n for i, n in enumerate(names) if str(i) in want or n in want]
    return names


def g2_layer(path):
    """G2 по файлу слоя здания: (а) в кольце 3 px у края вырезки нет бумажно-светлой каймы; (в) вырезка меньше 90 % кадра.
    Возвращает (проблемы, числа). Точки с альфой ≤ 8 не считаются: кайму гасят альфой (lessons §5)."""
    a = np.array(Image.open(path).convert('RGBA'))
    al, rgb = a[..., 3], a[..., :3].astype(np.int16)
    vis = (al > 8).astype(np.uint8)
    share = float(vis.mean())
    name = Path(path).name
    probs = []
    if share > G2_MAX_CUT:
        probs.append('%s: вырезка здания на %d %% кадра — это весь кадр, а не здание (урок grow: 0)' % (name, round(share * 100)))
        return probs, {'file': name, 'cut': round(share, 4)}
    if share == 0:
        return ['%s: слой здания пустой' % name], {'file': name, 'cut': 0}
    ring = (vis > 0) & (cv2.erode(vis, np.ones((7, 7), np.uint8)) == 0)                   # 3 px внутрь от края
    inner = cv2.erode(vis, np.ones((25, 25), np.uint8)) > 0                               # тело здания (12 px от края)
    paper = (rgb.min(-1) > 232) & ((rgb.max(-1) - rgb.min(-1)) < 14)
    pr = float((paper & ring).sum()) / max(1, int(ring.sum()))
    pi = float((paper & inner).sum()) / max(1, int(inner.sum()))
    # светлое здание (белёная стена) светлое и внутри: каймой считается то, чего у края заметно больше, чем в теле здания
    if pr > G2_PAPER_SHARE and pr > 2.0 * pi + G2_PAPER_SHARE:
        probs.append('%s: светлая кайма вырезки — в кольце 3 px у края %.1f %% бумажно-светлых точек (внутри здания %.1f %%)' % (name, pr * 100, pi * 100))
    return probs, {'file': name, 'cut': round(share, 4), 'paperRing': round(pr, 4), 'paperInner': round(pi, 4)}


def gate_g2(bdir, frames=None):
    """Кайма вырезки по файлам слоя здания всех кадров. Часть (б) — линия вдоль контура на рендере при наклоне — в Chrome (пока нет)."""
    fdir = si.frames_dir(bdir)
    probs, rows = [], []
    for n in _frame_names(bdir, frames):
        p = fdir / (n + '_building.webp')
        if p.is_file():
            pp, r = g2_layer(p)
            probs += pp
            rows.append(r)
    return probs, rows


# ---------------------------------------------------------------- красные случаи (самопроверка G2 и G9)
def selftest_g9(bdir):
    """Ночь, сдвинутая на 3 px, обязана покраснеть; ночь с ярким диском в небе (чужая луна) — тоже. Диск — тестовые данные, не рисунок сайта."""
    fdir = si.frames_dir(bdir)
    res = []
    name = next((n for n in _frame_names(bdir) if (fdir / (n + '_night.webp')).is_file()), None)
    if not name:
        return [('G9', 'у здания нет ночных рисунков — самопроверка ПРОПУЩЕНА', None)]
    tmp = Path(tempfile.mkdtemp(prefix='stanok-g9-'))
    for p in fdir.glob(name + '*.webp'):
        os.symlink(p, tmp / p.name) if p.name != name + '_night.webp' else None
    night = _rgb(fdir / (name + '_night.webp'))
    Image.fromarray(shift_img(night, 3, 0)).save(tmp / (name + '_night.webp'), lossless=True)
    res.append(('G9', 'ночь сдвинута на 3 px', any('сдвинута' in q for q in g9_frame(tmp, name)[0])))
    for sky_name in _frame_names(bdir):
        if not ((fdir / (sky_name + '_night.webp')).is_file() and (fdir / (sky_name + '_env.webp')).is_file()):
            continue
        sky = cv2.erode(open_sky(_rgb(fdir / (sky_name + '.webp')), _rgb(fdir / (sky_name + '_env.webp'))).astype(np.uint8), np.ones((41, 41), np.uint8))
        ys, xs = np.where(sky > 0)
        if not len(ys):
            continue
        tmp2 = Path(tempfile.mkdtemp(prefix='stanok-g9-'))
        for p in fdir.glob(sky_name + '*.webp'):
            os.symlink(p, tmp2 / p.name) if p.name != sky_name + '_night.webp' else None
        n2 = _rgb(fdir / (sky_name + '_night.webp')).copy()
        k = len(ys) // 2
        cv2.circle(n2, (int(xs[k]), int(ys[k])), 14, (250, 246, 225), -1)
        Image.fromarray(n2).save(tmp2 / (sky_name + '_night.webp'), lossless=True)
        res.append(('G9', 'в ночном небе чужая луна (яркий диск; тестовые данные)', any('чужая луна' in q for q in g9_frame(tmp2, sky_name)[0])))
        break
    return res


def selftest_g2(bdir):
    """Слой здания с белым кольцом 2 px обязан покраснеть; вырезка на весь кадр — тоже."""
    fdir = si.frames_dir(bdir)
    p = next((fdir / (n + '_building.webp') for n in _frame_names(bdir) if (fdir / (n + '_building.webp')).is_file()), None)
    if not p:
        return [('G2', 'у здания нет слоя здания — самопроверка ПРОПУЩЕНА', None)]
    a = np.array(Image.open(p).convert('RGBA'))
    vis = (a[..., 3] > 8).astype(np.uint8)
    ring = (vis > 0) & (cv2.erode(vis, np.ones((5, 5), np.uint8)) == 0)
    b = a.copy()
    b[ring, :3] = 255
    tmp = Path(tempfile.mkdtemp(prefix='stanok-g2-'))
    Image.fromarray(b).save(tmp / 'ring.webp', lossless=True, exact=True)
    c = a.copy()
    c[..., 3] = 255
    Image.fromarray(c).save(tmp / 'full.webp', lossless=True)
    return [('G2', 'слой здания с белым кольцом 2 px по краю', any('кайма' in q for q in g2_layer(tmp / 'ring.webp')[0])),
            ('G2', 'вырезка на весь кадр (grow: 0)', any('весь кадр' in q for q in g2_layer(tmp / 'full.webp')[0]))]


# ---------------------------------------------------------------- intake: приём рисунка
def frame_size(bdir):
    cfg = si.bpath(bdir) / 'building.e2.json'
    if cfg.is_file():
        return tuple(json.loads(cfg.read_text(encoding='utf-8')).get('look', {}).get('frameSize', [768, 1365]))
    return (768, 1365)


def journal_step(work, step):
    j = si.load_journal(work)
    j.setdefault('steps', []).append(step)
    si.save_journal(work, j)


def intake(bdir, name, version, src, work=None, quiet=False):
    """Приём рисунка Gemini в мастера кадра. Возвращает запись шага журнала. Красное — остановка, мастер не меняется."""
    import datetime
    if version not in VERSIONS:
        raise StanokError('intake: версия «%s» (есть: %s)' % (version, ', '.join(VERSIONS)))
    src = Path(src)
    if not src.is_file():
        raise StanokError('intake: нет файла %s' % src)
    work = si.work_dir(bdir, work)
    mdir = work / 'masters' / name
    im = Image.open(src).convert('RGB')
    a = np.array(im)
    H, W = a.shape[:2]
    if abs(W / H - 9 / 16) > 0.01 * 9 / 16:
        raise StanokError('intake %s/%s: рисунок %d×%d — не 9:16 (±1 %%). Gemini сменил формат: новый чат, в запросе «9:16 portrait»' % (name, version, W, H))
    step = {'step': 'intake', 'frame': name, 'version': version, 'source': src.name, 'sha256': si.sha(src.read_bytes()), 'size': [W, H], 'when': datetime.date.today().isoformat()}
    l = a.astype(F32).mean(-1)
    b = max(3, int(0.012 * W))
    for side, strip in (('сверху', l[:b]), ('снизу', l[-b:]), ('слева', l[:, :b]), ('справа', l[:, -b:])):
        if strip.mean() > 246 and strip.std() < 4 and version != 'snow':
            raise StanokError('intake %s/%s: белый край бумаги %s — рисунок не до края кадра (попросить «fill the whole frame, no paper border»)' % (name, version, side))
    if version != 'day':
        dp = mdir / 'day.png'
        if not dp.is_file():
            raise StanokError('intake %s/%s: сначала принять день (masters/%s/day.png)' % (name, version, name))
        fs = frame_size(bdir)
        day = _rgb(dp, fs)
        ver = np.array(im.resize(fs, Image.LANCZOS))
        dx, dy, c = best_shift(day, ver, search=12)
        if c < G9_MIN_MATCH:
            raise StanokError('intake %s/%s: контуры не совпадают с днём (%.2f) — Gemini перекомпоновал кадр. Правка — в НОВОМ чате с точным файлом дня' % (name, version, c))
        if max(abs(dx), abs(dy)) >= 12:
            raise StanokError('intake %s/%s: сдвиг относительно дня больше 12 px — кадр другой' % (name, version))
        if dx or dy:                                              # выравнивание: сдвиг обратно, в разрешении самого рисунка
            k = W / fs[0]
            a = shift_img(a, int(round(dx * k)), int(round(dy * k)))
            dx2, dy2, c2 = best_shift(day, np.array(Image.fromarray(a).resize(fs, Image.LANCZOS)))
            if max(abs(dx2), abs(dy2)) > G9_MAX_SHIFT:
                raise StanokError('intake %s/%s: после выравнивания остался сдвиг (%d, %d) px — рисунок искажён, не сдвинут' % (name, version, dx2, dy2))
        step.update({'shift': [dx, dy], 'match': round(c, 3)})
        if version == 'night':
            blobs = sky_blobs(np.array(Image.fromarray(a).resize(fs, Image.LANCZOS)), open_sky(day))     # маски окружения ещё нет — небо по рисунку дня
            if blobs:
                raise StanokError('intake %s/night: в небе яркое пятно у (%.2f, %.2f) — чужая луна или нимб. Запрос: «no moon, no halo» (луну рисует движок)' % (name, blobs[0][0], blobs[0][1]))
    mdir.mkdir(parents=True, exist_ok=True)
    dst = mdir / (version + '.png')
    if dst.is_file():                                             # прежний мастер не теряется
        prev = mdir / '_prev'
        prev.mkdir(exist_ok=True)
        n = len(list(prev.glob(version + '-*.png'))) + 1
        shutil.move(str(dst), str(prev / ('%s-%d.png' % (version, n))))
    Image.fromarray(a).save(dst)
    journal_step(work, step)
    if not quiet:
        print('принят: %s/%s ← %s (%d×%d%s)' % (name, version, src.name, W, H, '; сдвиг (%d, %d) выровнен, совпадение %.2f' % (step['shift'][0], step['shift'][1], step['match']) if 'shift' in step else ''))
    return step


# ---------------------------------------------------------------- layers: мастера → файлы сайта
def snow_mask(day, snow):
    """Маска снега кадра «что стало белым»: зимний рисунок светлее дня и сам почти белый. Серая, 0..255."""
    d, s = day.astype(F32), snow.astype(F32)
    gain = np.clip((s.min(-1) - d.min(-1) - 12) / 60.0, 0, 1)
    white = np.clip((s.min(-1) - 170) / 60.0, 0, 1) * np.clip(1 - (s.max(-1) - s.min(-1)) / 50.0, 0, 1)
    m = cv2.GaussianBlur(gain * white, (0, 0), 1.0)
    return np.clip(m * 255, 0, 255).astype(np.uint8)


def measure_sky(env, color):
    """Числа неба кадра (как tools/new_frame.py measure_sky): end — где небо кончается (доля высоты), ref — яркость неба на рисунке."""
    sky = env[..., 0] > 128
    H = sky.shape[0]
    rows = np.where(sky.mean(1) > 0.08)[0]
    end = round(float(rows.max() + 1) / H, 3) if len(rows) else 0.0
    ref = round(float(np.clip(color.astype(F32).mean(-1)[sky].mean() / 255.0, 0.3, 1.0)), 3) if sky.sum() > 200 else 0.87
    return end, ref


def models_dir(arg=None):
    for p in (arg, os.environ.get('CHKA_MODELS'), str(Path.home() / 'Documents/chka-kitchen/models')):
        if p and Path(p).is_dir():
            return Path(p)
    return None


def layers(bdir, name=None, work=None, models=None, quiet=False):
    """Мастера кадра → файлы сайта. Возвращает список отчётов по кадрам. Что нельзя сделать (нет моделей глубины) — пропускается с
    понятным текстом, остальное делается."""
    work = si.work_dir(bdir, work)
    fdir = si.frames_dir(bdir)
    fs = frame_size(bdir)
    names = [name] if name else sorted(p.name for p in (work / 'masters').iterdir() if (p / 'day.png').is_file()) if (work / 'masters').is_dir() else []
    if not names:
        raise StanokError('layers: нет принятых рисунков дня в %s (сначала stanok intake)' % (work / 'masters'))
    out = []
    for n in names:
        m = work / 'masters' / n
        rep = {'frame': n, 'done': [], 'skipped': []}
        if not (m / 'day.png').is_file():
            raise StanokError('layers %s: нет masters/%s/day.png' % (n, n))
        md = models_dir(models)
        need = ['pillow', 'numpy', 'scipy', 'onnxruntime']
        miss = [q for q in ('scipy', 'onnxruntime') if not _has(q)]
        if md is None or miss or not (m / 'bg.png').is_file():
            why = 'нет подложки masters/%s/bg.png' % n if not (m / 'bg.png').is_file() else 'нет папки моделей (CHKA_MODELS или ~/Documents/chka-kitchen/models)' if md is None else 'нет пакетов: ' + ', '.join(miss)
            rep['skipped'].append('слои и глубина (build_building_layers.py): ' + why)
        else:
            spec = m / 'layers.json'
            if not spec.is_file():                                # вырезка — по разнице «день − подложка» во всём кадре
                spec.write_text(json.dumps({'name': n, 'size': list(fs), 'cutout': {'region': [[0, 0], [1, 0], [1, 1], [0, 1]], 'thr': 28}, 'trees': True}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
            tmp = Path(tempfile.mkdtemp(prefix='stanok-layers-'))
            r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'build_building_layers.py'), '--src', str(m / 'day.png'), '--bg', str(m / 'bg.png'),
                                '--spec', str(spec), '--out', str(tmp), '--models', str(md)], capture_output=True, text=True)
            if r.returncode != 0:
                raise StanokError('layers %s: build_building_layers.py упал: %s' % (n, (r.stdout + r.stderr).strip()[-400:]))
            for p in sorted(tmp.iterdir()):
                si.put_clean(bdir, p.name, p.read_bytes(), work)
                rep['done'].append(p.name)
        if (fdir / (n + '.webp')).is_file():
            day = _rgb(m / 'day.png', fs)
            for v in ('sunset', 'night'):
                if (m / (v + '.png')).is_file():
                    fn = '%s_%s.webp' % (n, v)
                    si.put_clean(bdir, fn, _webp(_rgb(m / (v + '.png'), fs)), work)
                    rep['done'].append(fn)
            if (m / 'snow.png').is_file():
                fn = n + '_snow.webp'
                si.put_clean(bdir, fn, _webp(np.dstack([snow_mask(day, _rgb(m / 'snow.png', fs))] * 3)), work)
                rep['done'].append(fn)
            cfgp = si.bpath(bdir) / 'building.e2.json'
            if cfgp.is_file() and (fdir / (n + '_env.webp')).is_file():
                cfg = json.loads(cfgp.read_text(encoding='utf-8'))
                fr = next((f for f in cfg.get('frames', []) if f.get('name') == n), None)
                if fr is not None:
                    end, ref = measure_sky(_rgb(fdir / (n + '_env.webp')), day)
                    tod = fr.setdefault('effects', {}).setdefault('tod', {})
                    tod.setdefault('sky', {}).update({'end': end, 'ref': ref})
                    tod['sunsetPicture'] = (fdir / (n + '_sunset.webp')).is_file()
                    cfgp.write_text(json.dumps(cfg, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
                    rep['done'].append('building.e2.json: небо кадра end %.3f, ref %.3f' % (end, ref))
            rep['g9'], _ = g9_frame(fdir, n, m)
            bl = fdir / (n + '_building.webp')
            rep['g2'] = g2_layer(bl)[0] if bl.is_file() else ['нет слоя здания']
        else:
            rep['skipped'].append('закат, ночь, снег, числа неба: сначала нужны слои дня (%s.webp)' % n)
        import datetime
        journal_step(work, {'step': 'layers', 'frame': n, 'done': rep['done'], 'skipped': rep['skipped'], 'when': datetime.date.today().isoformat()})
        out.append(rep)
        if not quiet:
            print('кадр %s: записано %d файлов%s' % (n, len(rep['done']), ''.join('\n   ПРОПУЩЕНО: ' + q for q in rep['skipped'])))
            for g in ('g9', 'g2'):
                for q in rep.get(g, []):
                    print('   %s КРАСНЫЙ: %s' % (g.upper(), q))
    return out


def _has(mod):
    import importlib.util
    return importlib.util.find_spec(mod) is not None


def _webp(arr):
    import io
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, 'WEBP', quality=92, method=6)
    return buf.getvalue()
