"""Станок: производные файлы кадра для движка e2 (docs/STANOK.md §3 «маски», §4.1, §4.2). Считаются при сборке страницы
(tools/stanok.py build) из рисунков Gemini; в репозитории их нет — как и manifest, они живут только в собранной странице.
Ничего не рисуют: только сравнивают и размечают готовые рисунки (жёсткое правило lessons.md: видимое рисует Gemini).

  lights(day, night)  → <кадр>_lights.png (вдвое мельче кадра): R — мягкая маска огня, G — номер огня (момент включения); + список огней
  wx(snow)            → <кадр>_wx.webp (серая, вдвое мельче кадра): порядок появления снега по маске зимнего рисунка Gemini — сверху вниз
  atlas(flakes, rain) → wx_atlas.png: лист снежинок и капель Gemini одной текстурой (П2, weather)

Результат одинаков при одинаковых входных файлах (без времени и случайности: порядок огней — от содержимого кадра).
"""
import hashlib
import io
import json
import os
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

VERSION = 'm6'          # меняется при правке алгоритмов: кэш производных файлов сбрасывается сам
MAX_LIGHTS = 64         # огней на кадр (docs/STANOK.md §4.1)
MAX_POOLS = 12          # из них пятен света (фонари и их свет на стенах и земле): только «дышат», не гаснут


def _box(a, r):
    """Размытие квадратом радиуса r по обеим осям (края — повтором)."""
    if r <= 0:
        return a
    for ax in (0, 1):
        pad = [(r + 1, r) if i == ax else (0, 0) for i in range(a.ndim)]
        c = np.cumsum(np.pad(a, pad, mode='edge'), axis=ax, dtype=np.float64)
        n = a.shape[ax]
        hi = [slice(None)] * a.ndim
        lo = [slice(None)] * a.ndim
        hi[ax] = slice(2 * r + 1, 2 * r + 1 + n)
        lo[ax] = slice(0, n)
        a = (c[tuple(hi)] - c[tuple(lo)]) / (2 * r + 1)
    return a


def _lum(x):
    return x[..., 0] * 0.299 + x[..., 1] * 0.587 + x[..., 2] * 0.114


def _label(mask):
    """Связные области (4-связность): номера с 1, 0 — фон. Объединение отрезков строк; без scipy."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    prev = []
    for y in range(h):
        dx = np.diff(np.concatenate(([0], mask[y].astype(np.int8), [0])))
        cur = []
        for s, e in zip(np.where(dx == 1)[0], np.where(dx == -1)[0]):
            l = 0
            for ps, pe, pl in prev:
                if ps < e and pe > s:
                    r = find(pl)
                    if l == 0:
                        l = r
                    elif r != l:
                        a, b = min(r, l), max(r, l)
                        parent[b] = a
                        l = a
            if l == 0:
                l = len(parent)
                parent.append(l)
            lab[y, s:e] = l
            cur.append((s, e, l))
        prev = cur
    roots = np.array([find(i) for i in range(len(parent))], np.int32)
    return roots[lab]


def _rgb(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255


def _png(arr):
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format='PNG', optimize=False, compress_level=9)
    return buf.getvalue()


def _grow(lab, steps):
    """Расширить области номеров на steps пикселей (ближайший номер; при равенстве — больший)."""
    for _ in range(steps):
        p = np.pad(lab, 1)
        nb = np.maximum(np.maximum(p[:-2, 1:-1], p[2:, 1:-1]), np.maximum(p[1:-1, :-2], p[1:-1, 2:]))
        lab = np.where(lab > 0, lab, nb)
    return lab


def lights(day_path, night_path):
    """Маска огней кадра (docs/STANOK.md §4.1): где ночной рисунок заметно ярче и теплее «дня × затемнение».
    Два вида пятен:
      window — излучатель: ночью ярче, чем этот же пиксель ДНЁМ (окно, стекло фонаря, дверной проём). Гаснет и зажигается.
      lamp   — свет на поверхности (пятно фонаря на стене и земле): тёплое и яркое, но не ярче дня. Только «дышит».
    Возвращает (png, meta). PNG вдвое мельче кадра: R — мягкая маска, G — номер огня: (место в очереди + 0,5) / число огней;
    первые места — lamp. meta: n, lamps, tone (отношение ночь/день вокруг огней — «погашенное» окно = день × tone), list."""
    D, N = _rgb(day_path), _rgb(night_path)
    if D.shape != N.shape:
        raise SystemExit('ОШИБКА сборки: ночной рисунок %s другого размера, чем дневной (%s против %s)' % (Path(night_path).name, N.shape[1::-1], D.shape[1::-1]))
    H, W = D.shape[:2]
    lD, lN = _lum(D), _lum(N)
    paper = (lD > 0.90) & (lN > 0.85)                      # поля бумаги: белые и днём, и ночью — не свет
    med = float(np.median((lN / np.maximum(lD, 0.05))[~paper])) if (~paper).any() else 0.4
    warm = N[..., 0] - N[..., 2]
    glow = (lN > 0.40) & (warm > 0.15) & (lN - lD * med > 0.16) & ~paper
    emit = glow & (lN > 1.12 * lD)                         # ярче, чем днём, — излучатель
    emit = _box(emit.astype(np.float64), 1) > 0.45
    pool = (_box(glow.astype(np.float64), 1) > 0.45) & ~(_box(emit.astype(np.float64), 2) > 0.02)
    area = H * W

    def blobs(mask, amin, amax, top):
        lab = _label(mask)
        ids, cnt = np.unique(lab[lab > 0], return_counts=True)
        keep = sorted(((int(c), int(i)) for i, c in zip(ids, cnt) if amin <= c <= amax), reverse=True)[:top]
        out = []
        for c, i in keep:
            ys, xs = np.where(lab == i)
            out.append({'area': c, 'box': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], 'm': lab == i})
        return out
    pools = blobs(pool, 40, 0.03 * area, MAX_POOLS)
    wins = blobs(emit, 14, 0.012 * area, MAX_LIGHTS - len(pools))
    # очередь включения окон: «случайная», но одна и та же для одного кадра (от содержимого, не от часов)
    seed = int(hashlib.sha256(Path(day_path).name.encode()).hexdigest()[:8], 16)
    rs = np.random.RandomState(seed)
    wins.sort(key=lambda b: (b['box'][1], b['box'][0]))
    order = list(rs.permutation(len(wins)))
    wins = [wins[i] for i in order]
    items = [('lamp', b) for b in pools] + [('window', b) for b in wins]
    n = len(items)
    lab = np.zeros((H, W), np.int32)
    for k, (_, b) in enumerate(items):
        lab[b['m']] = k + 1
    core = lab > 0
    M = np.clip(_box(core.astype(np.float64), 3) * 2.2, 0, 1)
    # тон «погашенного»: ночь / день в кольце вокруг окон (сами огни не считаем)
    wm = np.zeros((H, W), bool)
    for _, b in items[len(pools):]:
        wm |= b['m']
    ring = (_box(wm.astype(np.float64), 9) > 0.02) & (_box(core.astype(np.float64), 4) < 0.01) & ~paper
    if ring.sum() > 50:
        tone = [float(np.median(N[..., c][ring] / np.maximum(D[..., c][ring], 0.03))) for c in range(3)]
    else:
        tone = [med * 0.9, med, med * 1.5]
    tone = [round(min(max(t, 0.05), 1.2), 4) for t in tone]
    # вдвое мельче (как карта окон движка): маска — средним, номер — от ближайшего огня
    hw, hh = (W + 1) // 2, (H + 1) // 2
    Mh = np.asarray(Image.fromarray((M * 255).astype(np.uint8)).resize((hw, hh), Image.BOX), dtype=np.float64) / 255
    labh = np.zeros((hh, hw), np.int32)
    sub = lab[::2, ::2]
    labh[:sub.shape[0], :sub.shape[1]] = sub
    sub = lab[1::2, 1::2]
    labh[:sub.shape[0], :sub.shape[1]] = np.maximum(labh[:sub.shape[0], :sub.shape[1]], sub)
    labh = _grow(labh, 6)
    # стык двух разных огней: маска в ноль (линейная выборка текстуры смешала бы номера — чужой момент включения)
    p = np.pad(labh, 1, mode='edge')
    seam = np.zeros(labh.shape, bool)
    for nb in (p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]):
        seam |= (nb != labh) & (nb > 0) & (labh > 0)
    Mh[seam] = 0
    Mh[labh == 0] = 0
    Mh = _box(Mh, 1) * (labh > 0)
    out = np.zeros((hh, hw, 3), np.uint8)
    out[..., 0] = np.round(np.clip(Mh, 0, 1) * 255)
    if n:
        out[..., 1] = np.where(labh > 0, np.round((labh - 0.5) / n * 255), 0)
    meta = {'n': n, 'lamps': len(pools), 'tone': tone,
            'list': [[t, round(b['box'][0] / W, 4), round(b['box'][1] / H, 4), round(b['box'][2] / W, 4), round(b['box'][3] / H, 4)] for t, b in items]}
    return _png(out), meta


def wx(snow_path):
    """Порядок появления снега на кадре (docs/STANOK.md §4.2). Вход — маска снега кадра (<кадр>_snow.webp: «что стало белым»
    в зимнем рисунке Gemini; сама маска идёт на сайт как есть). Выход — серая картинка вдвое мельче кадра (WebP), 0..255:
    снег проявляется сверху вниз — сначала кромки крыш и верх предметов (верх каждого пятна маски), потом плоскости (земля — от
    дальнего края к ближнему). Тает в обратном порядке. Движок кладёт маску в альфу ночной текстуры земли, порядок — в альфу
    ночной текстуры здания (отдельных текстур под маски у телефона нет)."""
    S = np.asarray(Image.open(snow_path).convert('RGB'), dtype=np.float64)[..., 0] / 255
    H, W = S.shape
    m = _box((S > 0.2).astype(np.float64), 4) > 0.3              # пятна без мелких дыр: иначе порядок рвётся полосами по столбцам
    # расстояние вниз от верха своего пятна (по столбцу): счётчик подряд идущих точек маски
    run = np.zeros((H, W), np.float64)
    cur = np.zeros(W, np.float64)
    for y in range(H):
        cur = np.where(m[y], cur + 1, 0)
        run[y] = cur
    depth_in = np.clip(run / (0.12 * H), 0, 1) ** 0.8            # 12 % высоты кадра вниз от кромки — уже «плоскость»
    # сгладить по соседям внутри пятна (среднее только по точкам маски): соседние столбцы идут вместе, без «гребёнки»
    mm = m.astype(np.float64)
    for r in (10, 6):
        depth_in = _box(depth_in * mm, r) / np.maximum(_box(mm, r), 1e-3)
    vv = np.linspace(0, 1, H)[:, None] * np.ones((1, W))
    O = np.clip(0.82 * depth_in + 0.18 * vv, 0, 1)
    im = Image.fromarray(np.round(O * 255).astype(np.uint8), 'L').resize(((W + 1) // 2, (H + 1) // 2), Image.BOX)
    buf = io.BytesIO()
    im.save(buf, format='WEBP', quality=84, method=4)
    return buf.getvalue(), {'cover': round(float((S > 0.2).mean()), 4)}


ATLAS = (512, 256)      # лист частиц: сверху 8 клеток 64×64 — снежинки, ниже 8 клеток 24×192 — капли


def atlas(flakes, rain):
    """Лист частиц осадков: снежинки и капли Gemini (show_flake_*.png, show_rain_*.png) одной текстурой 512×256.
    Код частицы только двигает и красит под время суток; здесь они лишь уменьшаются и раскладываются по клеткам с полями."""
    aw, ah = ATLAS
    sheet = Image.new('RGBA', (aw, ah), (0, 0, 0, 0))
    meta = {'flakes': [], 'rain': []}

    def put(path, x0, y0, cw, ch, pad):
        im = Image.open(path).convert('RGBA')
        k = min((cw - 2 * pad) / im.width, (ch - 2 * pad) / im.height)
        w, h = max(1, round(im.width * k)), max(1, round(im.height * k))
        im = im.resize((w, h), Image.LANCZOS)
        ox, oy = x0 + (cw - w) // 2, y0 + (ch - h) // 2
        sheet.paste(im, (ox, oy))
        return [round(ox / aw, 5), round(oy / ah, 5), round((ox + w) / aw, 5), round((oy + h) / ah, 5)]
    for i, pth in enumerate(list(flakes)[:8]):
        meta['flakes'].append(put(pth, i * 64, 0, 64, 64, 4))
    for i, pth in enumerate(list(rain)[:8]):
        meta['rain'].append(put(pth, i * 24, 64, 24, 192, 4))
    a = np.asarray(sheet).copy()
    a[a[..., 3] == 0] = 0
    return _png(a), meta


MAKERS = {'lights': lambda src: lights(src['color'], src['night']),
          'wx': lambda src: wx(src['snow']),
          'atlas': lambda src: atlas(src.get('flakes', []), src.get('rain', []))}


def make(kind, src, cache=None):
    """Производный файл с кэшем по содержимому входных файлов. src: {ключ: путь}. Возвращает (bytes, meta)."""
    h = hashlib.sha256((VERSION + '\0' + kind + '\0').encode())
    for k in sorted(src):
        v = src[k]
        for p in (v if isinstance(v, (list, tuple)) else [v]):
            h.update(k.encode() + b'\0' + Path(p).read_bytes() + b'\0')
    key = h.hexdigest()[:24]
    cdir = Path(cache or os.environ.get('STANOK_CACHE') or (Path(tempfile.gettempdir()) / 'stanok-derived'))
    fb, fm = cdir / (key + '.bin'), cdir / (key + '.json')
    if fb.is_file() and fm.is_file():
        return fb.read_bytes(), json.loads(fm.read_text(encoding='utf-8'))
    data, meta = MAKERS[kind](src)
    try:
        cdir.mkdir(parents=True, exist_ok=True)
        fb.write_bytes(data)
        fm.write_text(json.dumps(meta), encoding='utf-8')
    except OSError:
        pass
    return data, meta
