#!/usr/bin/env python3
"""Станок: вставка в рисунок по МАТРИЦЕ версий кадра (docs/STANOK.md §3), журнал вставок, переигрывание, гейт G3.

Кадр — не одна картинка, а набор: день, подложка, слой здания, закат, ночь, маска снега, глубина, маски. Вставка, сделанная только в одной
версии, пропадает на «Закате» или «Ночью» (урок pp-17). Поэтому вставка — это ЗАПИСЬ В ЖУРНАЛЕ, а файлы кадра станок каждый раз
собирает заново: «чистый файл + все вставки журнала по порядку». Отсюда три свойства:
  • вставка одной командой ложится во все версии кадра (таблица MATRIX ниже — та же, что в §3);
  • повторная вставка с тем же id ничего не дублирует: файлы те же байт в байт (идемпотентность);
  • пришёл новый мастер (новая ночь от Gemini) — `put_clean` кладёт его как чистый файл и вставки накладываются снова, ничего не теряется.

Где что лежит (work/ — вне git):
  work/<slug>/journal.json          журнал: вставки по порядку, sha файлов кадра после сборки
  work/<slug>/inserts/<id>/         edit.png (правка Gemini, совмещённая с вырезкой), alpha.png (мягкая маска), crop.png, sheet.jpg
  work/<slug>/base/<файл>           чистые файлы кадра (до вставок) — из них собирается всё
  tests/<slug>/frames/<файл>        то, что едет на сайт: пишет только станок

Команды — через tools/stanok.py: crop, insert, replay, inserts. Код ничего не рисует: только переносит пиксели правки Gemini.
"""
import datetime
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
F32 = np.float32

# Матрица версий кадра (docs/STANOK.md §3): версия → файл сайта. Порядок = порядок записи.
MATRIX = (('day', '{n}.webp'), ('bg', '{n}_bg.webp'), ('building', '{n}_building.webp'), ('sunset', '{n}_sunset.webp'),
          ('night', '{n}_night.webp'), ('snow', '{n}_snow.webp'), ('depth', '{n}_depth.webp'), ('bg_depth', '{n}_bg_depth.webp'),
          ('env', '{n}_env.webp'), ('win', '{n}_win2.webp'))
VERSION_RU = {'day': 'день', 'bg': 'подложка', 'building': 'слой здания', 'sunset': 'закат', 'night': 'ночь', 'snow': 'снег',
              'depth': 'глубина', 'bg_depth': 'глубина подложки', 'env': 'маска окружения', 'win': 'маска окон'}
KINDS = ('object', 'flat', 'inscription')      # предмет (стоит, со снегом и глубиной) · перекраска поверхности · надпись (бороздки: отношение яркостей)
LAYERS = ('ground', 'building')
ALIGNED_MIN = 0.9                             # совпадение штриха версии с днём: у Погоса B закат 0,6–0,8 (рисунок сдвинут на 1–2 px) — добавка даёт двойной штрих
TONE_SIGMA = 9.0                               # «вокруг»: тон версии относительно дня берётся размытым на 9 px (как рецепт ночи, lessons §6)


class InsertError(SystemExit):
    def __init__(self, msg):
        super().__init__('ОШИБКА insert: ' + msg)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bpath(bdir):
    p = Path(bdir)
    return p if p.is_absolute() else ROOT / p


def work_dir(bdir, work=None):
    if work:
        return Path(work)
    if os.environ.get('STANOK_WORK'):
        return Path(os.environ['STANOK_WORK'])
    return ROOT / 'work' / bpath(bdir).name


def frames_dir(bdir):
    b = bpath(bdir)
    for cfg in ('building.e2.json', 'building.json'):
        if (b / cfg).is_file():
            try:
                return b / json.loads((b / cfg).read_text(encoding='utf-8')).get('framesDir', 'frames/')
            except (json.JSONDecodeError, AttributeError):
                break
    return b / 'frames'


def load_journal(work):
    p = Path(work) / 'journal.json'
    if p.is_file():
        return json.loads(p.read_text(encoding='utf-8'))
    return {'schema': 1, 'inserts': [], 'removed': [], 'frames': {}, 'steps': []}


def save_journal(work, j):
    Path(work).mkdir(parents=True, exist_ok=True)
    (Path(work) / 'journal.json').write_text(json.dumps(j, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


# ---------------------------------------------------------------- картинки: чтение и запись «как было»
def read_img(path):
    im = Image.open(path)
    return np.array(im.convert('RGBA' if ('A' in im.mode or 'transparency' in im.info) else 'RGB'))


def decode(data):
    import io
    im = Image.open(io.BytesIO(data))
    return np.array(im.convert('RGBA' if ('A' in im.mode or 'transparency' in im.info) else 'RGB'))


def encode_like(arr, ref):
    """Кодирует картинку тем же способом, каким закодирован файл-образец ref (байты): WebP без потерь остаётся без потерь, с потерями — q92
    (как build_building_layers и deliver_inscription), PNG — PNG. Результат зависит только от входа (без времени и случайности)."""
    import io
    im = Image.fromarray(np.clip(np.rint(arr), 0, 255).astype(np.uint8), 'RGBA' if arr.shape[-1] == 4 else 'RGB')
    buf = io.BytesIO()
    if ref[:8] == b'\x89PNG\r\n\x1a\n':
        im.save(buf, 'PNG', optimize=True)
    elif ref[12:16] == b'VP8L':
        im.save(buf, 'WEBP', lossless=True, quality=90, method=6)
    else:
        im.save(buf, 'WEBP', quality=92, method=6, exact=True)
    return buf.getvalue()


def box_px(box, W, H):
    x0, y0, x1, y1 = int(round(box[0] * W)), int(round(box[1] * H)), int(round(box[2] * W)), int(round(box[3] * H))
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if x1 - x0 < 4 or y1 - y0 < 4:
        raise InsertError('прямоугольник вставки пустой: %s' % (box,))
    return x0, y0, x1, y1


def parse_box(text, size=None):
    """--box: доли кадра «u0,v0,u1,v1» (все ≤ 1) или пиксели «x,y,w,h» кадра размера size (W, H)."""
    v = [float(x) for x in re.split(r'[,; ]+', str(text).strip())]
    if len(v) != 4:
        raise InsertError('--box: нужно четыре числа (доли u0,v0,u1,v1 или пиксели x,y,w,h), получено «%s»' % text)
    if max(v) > 1.0:
        if not size:
            raise InsertError('--box в пикселях: нужен размер кадра (--of ШxВ)')
        W, H = size
        v = [v[0] / W, v[1] / H, (v[0] + v[2]) / W, (v[1] + v[3]) / H]
    if not (0 <= v[0] < v[2] <= 1.0001 and 0 <= v[1] < v[3] <= 1.0001):
        raise InsertError('--box вне кадра или перевёрнут: %s' % v)
    return [round(min(x, 1.0), 5) for x in v]


# ---------------------------------------------------------------- совмещение правки Gemini с вырезкой (из pogos-petros/build/scripts/fix15.py)
def _edges(a):
    g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY) if a.ndim == 3 else a
    return cv2.GaussianBlur(cv2.Canny(g, 50, 130).astype(F32), (0, 0), 2)


def locate(G, ref):
    """Картинка Gemini G → аффинное W: пиксель вырезки ref → пиксель G. Перебор масштаба (совпадение контуров середины ref), затем ECC.
    Возвращает (совпадение шаблона, совпадение ECC, W)."""
    h, w = ref.shape[:2]
    m = 0.12
    inner = ref[int(h * m):int(h * (1 - m)), int(w * m):int(w * (1 - m))]
    eI, eG, best = _edges(inner), _edges(G), (-2, None)
    for k in np.linspace(0.8, 1.25, 46):
        s = G.shape[1] / w * k
        tw, th = int(inner.shape[1] * s), int(inner.shape[0] * s)
        if tw >= G.shape[1] or th >= G.shape[0] or tw < 8 or th < 8:
            continue
        r = cv2.matchTemplate(eG, cv2.resize(eI, (tw, th)), cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(r)
        if mv > best[0]:
            best = (mv, (s, ml[0] - int(w * m) * s, ml[1] - int(h * m) * s))
    if best[1] is None:
        raise InsertError('правка меньше вырезки — совместить нельзя')
    s, ox, oy = best[1]
    W = np.array([[s, 0, ox], [0, s, oy]], F32)
    cc = -1.0
    try:
        g2 = cv2.warpAffine(G, W, (w, h), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
        D = np.eye(2, 3, dtype=F32)
        cc, D = cv2.findTransformECC(_edges(ref), _edges(g2), D, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
        W = (np.vstack([W, [0, 0, 1]]) @ np.vstack([D, [0, 0, 1]]))[:2].astype(F32)
    except cv2.error:
        pass
    return float(best[0]), float(cc), W


def warp_to(G, W, w, h):
    return cv2.warpAffine(G, W, (w, h), flags=cv2.INTER_AREA | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)


def make_alpha(crop, g, kind):
    """Мягкая маска вставки: где совмещённая правка g отличается от вырезки crop.
    Надпись — мягкий прямоугольник вокруг самого крупного пятна отличий (как deliver_inscription). Предмет и перекраска — силуэт по
    отличию цвета ΔE > 12 (lessons §2: не альфа патча), без мелких обрывков, дыры закрыты, край мягкий."""
    ch, cw = crop.shape[:2]
    s = max(cw, ch) / 640.0
    if kind == 'inscription':
        d = np.abs(g.astype(F32) - crop.astype(F32)).max(-1)
        circ = np.zeros((ch, cw), np.uint8)
        cv2.circle(circ, (cw // 2, ch // 2), int(0.45 * min(cw, ch)), 1, -1)
        m0 = cv2.morphologyEx(((d > 30) & (circ > 0)).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        k = max(3, int(round(25 * s)) | 1)
        n, lab, stt, _ = cv2.connectedComponentsWithStats(cv2.dilate(m0, np.ones((k, k), np.uint8)), 8)
        m = np.zeros_like(m0)
        if n > 1:
            j = 1 + int(np.argmax(stt[1:, cv2.CC_STAT_AREA]))
            x, y, w2, h2 = stt[j, :4]
            pad = int(round(12 * s))
            cv2.rectangle(m, (max(0, x - pad), max(0, y - pad)), (min(cw - 1, x + w2 + pad), min(ch - 1, y + h2 + pad)), 1, -1)
        al = np.clip(cv2.GaussianBlur(m.astype(F32), (0, 0), max(1.0, 8.0 * s)) * 1.2, 0, 1)
    else:
        lc, lg = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(F32), cv2.cvtColor(g, cv2.COLOR_RGB2LAB).astype(F32)
        dd = lg - lc
        dd[..., 0] *= 100.0 / 255.0
        d = cv2.GaussianBlur(np.sqrt((dd ** 2).sum(-1)), (0, 0), max(0.6, 1.0 * s))
        m0 = (d > 12).astype(np.uint8)
        b = max(2, int(0.02 * min(cw, ch)))                      # у самого края вырезки Gemini «плывёт» — край не берём
        m0[:b], m0[-b:], m0[:, :b], m0[:, -b:] = 0, 0, 0, 0
        m0 = cv2.morphologyEx(m0, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, lab, stt, _ = cv2.connectedComponentsWithStats(m0, 8)
        keep = np.zeros_like(m0)
        for j in range(1, n):
            if stt[j, cv2.CC_STAT_AREA] >= max(12, 30 * s * s):
                keep[lab == j] = 1
        k = max(3, int(round(9 * s)) | 1)
        keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
        cs, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        m = np.zeros_like(keep)
        cv2.drawContours(m, cs, -1, 1, -1)                       # дыры внутри силуэта закрыты
        k2 = max(3, int(round(2 * s)) * 2 + 1)
        m = cv2.dilate(m, np.ones((k2, k2), np.uint8))
        al = np.clip(cv2.GaussianBlur(m.astype(F32), (0, 0), max(1.0, 2.0 * s)) * 1.15, 0, 1)
    return al


# ---------------------------------------------------------------- одна вставка → все версии кадра (в памяти)
def _blur(a, s):
    return cv2.GaussianBlur(a, (0, 0), s)


def _pad_box(x0, y0, x1, y1, W, H, p):
    return max(0, x0 - p), max(0, y0 - p), min(W, x1 + p), min(H, y1 + p)


def _tone(ver, day, box, W, H):
    """Отношение «версия / день» вокруг прямоугольника (тон заката или ночи), по каналам, размыто на TONE_SIGMA."""
    x0, y0, x1, y1 = box
    p = int(TONE_SIGMA * 3)
    X0, Y0, X1, Y1 = _pad_box(x0, y0, x1, y1, W, H, p)
    r = (_blur(ver[Y0:Y1, X0:X1, :3], TONE_SIGMA) + 4.0) / (_blur(day[Y0:Y1, X0:X1, :3], TONE_SIGMA) + 4.0)
    return r[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0]


def _aligned(ver, day, box, W, H):
    """Версия совпадает с днём пиксель в пиксель (ночь как карта света поверх дня), а не отдельный рисунок Gemini?
    Мера — совпадение мелкого штриха (яркость минус размытая на 3 px) вокруг прямоугольника: > ALIGNED_MIN — тот же рисунок."""
    X0, Y0, X1, Y1 = _pad_box(box[0], box[1], box[2], box[3], W, H, 16)
    hp = []
    for im in (ver, day):
        l = im[Y0:Y1, X0:X1, :3].mean(-1)
        hp.append(l - _blur(l, 3.0))
    den = float(np.sqrt((hp[0] ** 2).sum() * (hp[1] ** 2).sum()))
    return den > 0 and float((hp[0] * hp[1]).sum()) / den > ALIGNED_MIN


def apply_entry(imgs, e, ed):
    """Накладывает одну вставку журнала на версии кадра imgs (версия → float32, меняются на месте). ed — данные вставки:
    edit (uint8, совмещённая правка в размере вырезки), alpha (float 0..1), night (uint8 или None — правка ночной вырезки от Gemini).
    Возвращает {версия: (действие, причина)}; правило каждой строки — docs/STANOK.md §3."""
    kind, layer, only = e['kind'], e['layer'], e.get('only')
    H, W = imgs['day'].shape[:2]
    x0, y0, x1, y1 = box_px(e['box'], W, H)
    size = (x1 - x0, y1 - y0)
    g = cv2.resize(ed['edit'], size, interpolation=cv2.INTER_AREA).astype(F32)
    a = cv2.resize(ed['alpha'], size, interpolation=cv2.INTER_AREA).astype(F32)[..., None]
    hard = a[..., 0] > 0.5
    sl = (slice(y0, y1), slice(x0, x1))
    day0_full = imgs['day'][..., :3].copy()                       # день ДО этой вставки: от него считается тон заката и ночи
    day0 = day0_full[sl]
    op = (imgs['building'][sl][..., 3:4] / 255.0) if 'building' in imgs else np.zeros(size[::-1] + (1,), F32)
    over = float((a * op).sum())                                  # сколько вставки лежит на непрозрачном слое здания
    act = {}

    def want(v):
        if v not in imgs:
            act[v] = ('нет файла', 'у кадра нет этой версии')
            return False
        if only and v not in only:
            act[v] = ('НЕ ЗАПИСАНО', 'тестовый ключ --only %s' % ','.join(only))
            return False
        return True

    if want('day'):
        imgs['day'][sl][..., :3] = day0 * (1 - a) + g * a
        act['day'] = ('пиксели', 'пиксели правки по мягкой маске')
    if want('bg'):
        if layer == 'ground':
            w = a if kind == 'object' else a * (1 - op)           # перекраска и надпись под непрозрачное здание не лезут
            s = imgs['bg'][sl]
            s[..., :3] = s[..., :3] * (1 - w) + g * w
            act['bg'] = ('пиксели', 'слой ground: те же пиксели')
        else:
            act['bg'] = ('не трогает', 'слой building: под зданием подложка остаётся')
    if want('building'):
        s = imgs['building'][sl]
        if layer == 'building' and kind == 'object':
            s[..., :3] = s[..., :3] * (1 - a) + g * a
            s[..., 3:4] = np.maximum(s[..., 3:4], a * 255.0)
            act['building'] = ('пиксели + альфа', 'предмет на здании: в слой вместе с альфой')
        elif layer == 'ground' and kind == 'object':
            if over > 0.5:
                s[..., 3:4] = s[..., 3:4] * (1 - a)
                act['building'] = ('вырезано', 'предмет на земле перекрывает здание — из слоя здания вырезан')
            else:
                act['building'] = ('не трогает', 'предмет не перекрывает здание')
        elif over > 0.5:
            w = a * op
            s[..., :3] = s[..., :3] * (1 - w) + g * w
            act['building'] = ('пиксели', 'только где слой непрозрачен; альфа прежняя')
        else:
            act['building'] = ('не трогает', 'вставка не лежит на слое здания')
    for v in ('sunset', 'night'):
        if not want(v):
            continue
        s = imgs[v][sl]
        if v == 'night' and ed.get('night') is not None:
            ng = cv2.resize(ed['night'], size, interpolation=cv2.INTER_AREA).astype(F32)
            s[..., :3] = s[..., :3] * (1 - a) + ng * a
            act[v] = ('пиксели ночной правки', 'свет на предмете — правкой Gemini ночной вырезки')
            continue
        R = _tone(imgs[v], day0_full, (x0, y0, x1, y1), W, H)
        if _aligned(imgs[v], day0_full, (x0, y0, x1, y1), W, H):   # версия — тот же рисунок пиксель в пиксель: добавка сохраняет её свет и детали
            s[..., :3] = np.clip(s[..., :3] + a * (g - day0) * np.clip(R, 0, 1.5), 0, 255)
            act[v] = ('тон, добавкой', '%s + (правка − день) × отношение «%s / день»' % (VERSION_RU[v], VERSION_RU[v]))
        else:                                                     # версия — отдельный рисунок Gemini (штрих лежит иначе): добавка дала бы двойной штрих
            s[..., :3] = s[..., :3] * (1 - a) + np.clip(g * R, 0, 255) * a
            act[v] = ('тон, заменой', 'правка × отношение «%s / день» вокруг (версия — отдельный рисунок)' % VERSION_RU[v])
    obj = kind == 'object' and hard.any()
    for v in ('snow', 'depth', 'bg_depth', 'env', 'win'):
        if v in imgs and not obj:
            act[v] = ('не трогает', 'плоская правка: снег, глубина и маски те же')
    if obj:
        ys, xs = np.where(hard)
        top = np.full(size[0], -1, np.int64)
        for cx in np.unique(xs):
            top[cx] = ys[xs == cx].min()
        hh = int(ys.max() - ys.min() + 1)
        if want('snow'):
            s = imgs['snow'][sl]
            X0, Y0, X1, Y1 = _pad_box(x0, y0, x1, y1, W, H, 24)
            ring = imgs['snow'][Y0:Y1, X0:X1, 0]
            val = float(np.percentile(ring, 90))                  # «сколько снега» лежит рядом — столько же на верх предмета
            band = np.zeros(size[::-1], F32)
            bh = max(2, int(round(0.12 * hh)))
            for cx in np.where(top >= 0)[0]:
                band[top[cx]:top[cx] + bh, cx] = 1.0
            band = np.clip(_blur(band, 1.0), 0, 1)[..., None] * (hard[..., None])
            new = (1 - band) * 0.0 + band * val                   # тело предмета — без снега, верх — снег
            s[..., :3] = s[..., :3] * (1 - a) + new * a
            act['snow'] = ('маска пересчитана', 'верх предмета — снег (%d), тело — без снега' % round(val))
        for v, need in (('depth', True), ('bg_depth', layer == 'ground')):
            if not want(v):
                continue
            if not need:
                act[v] = ('не трогает', 'слой building: глубина подложки та же')
                continue
            d = imgs[v]
            if layer == 'ground':                                 # глубина земли у нижней кромки предмета
                yb = min(H - 1, y0 + int(ys.max()) + 2)
                xa, xb = x0 + int(xs.min()), x0 + int(xs.max()) + 1
                val = float(np.median(d[yb:min(H, yb + 6), xa:xb, :3]))
                why = 'предмет стоит на глубине земли у нижней кромки (%d)' % round(val)
            else:                                                 # глубина здания вокруг предмета
                X0, Y0, X1, Y1 = _pad_box(x0, y0, x1, y1, W, H, 8)
                rb = imgs['building'][Y0:Y1, X0:X1, 3] > 128 if 'building' in imgs else np.ones((Y1 - Y0, X1 - X0), bool)
                vals = d[Y0:Y1, X0:X1, 0][rb]
                val = float(np.median(vals)) if vals.size else float(np.median(d[sl][..., 0]))
                why = 'предмет на здании — глубина здания рядом (%d)' % round(val)
            d[sl][..., :3] = d[sl][..., :3] * (1 - a) + val * a
            act[v] = ('глубина', why)
        for v in ('env', 'win'):
            if want(v):
                imgs[v][sl][..., :3] = imgs[v][sl][..., :3] * (1 - a)
                act[v] = ('маска пересчитана', 'предмет — не небо, не дерево и не окно')
    return act


# ---------------------------------------------------------------- сборка файлов кадра: чистые файлы + журнал
def frame_files(name):
    return [(v, pat.replace('{n}', name)) for v, pat in MATRIX]


def ensure_base(fdir, work, name, refresh=False):
    """Чистые файлы кадра (до вставок): при первой вставке копируются из frames/. refresh — у кадра вставок нет: основа берётся из frames/
    заново (пока вставок не было, frames/ мог законно измениться — новая ночь старым инструментом). Возвращает {версия: путь}."""
    base = Path(work) / 'base'
    base.mkdir(parents=True, exist_ok=True)
    out = {}
    for v, fn in frame_files(name):
        if (fdir / fn).is_file() and (refresh or not (base / fn).is_file()):
            if not (base / fn).is_file() or (base / fn).read_bytes() != (fdir / fn).read_bytes():
                shutil.copyfile(fdir / fn, base / fn)
        if (base / fn).is_file() and (fdir / fn).is_file():
            out[v] = base / fn
    return out


def load_edit(work, e):
    d = Path(work) / 'inserts' / e['id']
    ed = {'edit': np.array(Image.open(d / 'edit.png').convert('RGB')), 'alpha': np.array(Image.open(d / 'alpha.png').convert('L')).astype(F32) / 255.0, 'night': None}
    if (d / 'night.png').is_file():
        ed['night'] = np.array(Image.open(d / 'night.png').convert('RGB'))
    return ed


def render_frame(bdir, work, name, j, write=True, refresh=False):
    """Собирает файлы кадра заново: чистые файлы (work/base) + все вставки журнала этого кадра по порядку. Пишет в frames/ только то,
    что изменилось. Вне прямоугольников вставок пиксели до кодирования обязаны остаться прежними (проверяется). Возвращает {файл: байты}."""
    fdir = frames_dir(bdir)
    entries = [e for e in j['inserts'] if e['frame'] == name]
    base = ensure_base(fdir, work, name, refresh)
    if 'day' not in base:
        raise InsertError('у кадра %s нет дневного рисунка %s.webp в %s' % (name, name, fdir))
    raw = {v: p.read_bytes() for v, p in base.items()}
    src = {v: decode(b).astype(F32) for v, b in raw.items()}
    sizes = {a.shape[:2] for a in src.values()}
    if len(sizes) != 1:
        raise InsertError('версии кадра %s разного размера: %s' % (name, {v: a.shape[:2] for v, a in src.items()}))
    imgs = {v: a.copy() for v, a in src.items()}
    H, W = imgs['day'].shape[:2]
    outside = np.ones((H, W), bool)
    dup = os.environ.get('STANOK_BREAK') == 'insert-dup'          # красный случай: вставки кладутся поверх уже собранных файлов (двойная надпись)
    if dup:
        for v, fn in frame_files(name):
            if v in imgs and (fdir / fn).is_file():
                imgs[v] = read_img(fdir / fn).astype(F32)
    for e in entries:
        before = {v: a.copy() for v, a in imgs.items()}
        act = apply_entry(imgs, e, load_edit(work, e))
        x0, y0, x1, y1 = box_px(e['box'], W, H)
        outside[y0:y1, x0:x1] = False
        e['versions'] = {}
        for v, fn in frame_files(name):
            if v not in act:
                continue
            ch = int((np.abs(imgs[v] - before[v]).max(-1) > 3).sum()) if v in imgs else 0
            e['versions'][v] = {'file': fn, 'action': act[v][0], 'why': act[v][1], 'changedPx': ch}
    out = {}
    for v, fn in frame_files(name):
        if v not in imgs:
            continue
        if not dup and not np.array_equal(imgs[v][outside], src[v][outside]):
            raise InsertError('кадр %s, %s: изменились пиксели ВНЕ прямоугольников вставок — стоп, ничего не записано' % (name, VERSION_RU[v]))
        same = np.array_equal(imgs[v], src[v])
        out[fn] = raw[v] if same else encode_like(imgs[v], raw[v])
    if write:
        for fn, data in out.items():
            p = fdir / fn
            if not p.is_file() or p.read_bytes() != data:
                p.write_bytes(data)
        j.setdefault('frames', {})[name] = {fn: {'sha256': sha(out[fn]), 'base': sha(raw[v])} for v, fn in frame_files(name) if fn in out}
    return out


# ---------------------------------------------------------------- проверки перед вставкой: актёры, шоу, запретные зоны
def _inter(a, b):
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def frame_guards(bdir, name, box, kind):
    """Актёр в прямоугольнике — стоп (его ролик снят с прежнего рисунка: актёра нужно переснять). Шоу — предупреждение.
    Запретные зоны (tests/<slug>/zones.json, «не на святое») — стоп для надписей и предметов."""
    b, warns = bpath(bdir), []
    cfg = b / 'building.e2.json'
    if cfg.is_file():
        try:
            fr = next((f for f in json.loads(cfg.read_text(encoding='utf-8')).get('frames', []) if f.get('name') == name), None)
        except json.JSONDecodeError:
            fr = None
        if fr:
            fx = fr.get('effects') or {}
            for a in (fx.get('actors') or {}).get('list', []):
                rects = [a.get('rect')] + [q.get('rect') for m in (a.get('media') or {}).values() for q in (m if isinstance(m, list) else [m] if isinstance(m, dict) else [])]
                if any(r and _inter(box, r) > 0 for r in rects):
                    raise InsertError('прямоугольник задевает героя «%s» (кадр %s): его ролики сняты с прежнего рисунка — героя нужно переснять '
                                      '(stanok actor) или сдвинуть вставку' % (a.get('id'), name))
            sh = (fx.get('show') or {}).get('video') or {}
            if sh.get('rect') and _inter(box, sh['rect']) > 0:
                warns.append('вставка внутри прямоугольника шоу «до/после»: в ролике шоу её нет (пока идёт показ, вставка скрыта)')
    zp = b / 'zones.json'
    if zp.is_file():
        for z in json.loads(zp.read_text(encoding='utf-8')).get('forbidden', []):
            if z.get('frame') in (name, '*') and z.get('rect') and _inter(box, z['rect']) > 0 and kind in ('inscription', 'object'):
                raise InsertError('прямоугольник попадает в запретную зону «%s» (zones.json): надписи и предметы не кладутся на святое' % z.get('why', '?'))
    elif kind == 'inscription':
        warns.append('zones.json нет — запретные зоны («не на святое») не сверены')
    return warns


def day_source(bdir, work, name):
    """Откуда брать вырезку дня: мастер высокого разрешения work/<slug>/masters/<кадр>/day.png, если по нему уже прошли все вставки
    (вставок у кадра нет); иначе — текущий файл сайта (в нём все прежние вставки)."""
    m = Path(work) / 'masters' / name / 'day.png'
    j = load_journal(work)
    if m.is_file() and not any(e['frame'] == name for e in j['inserts']):
        return m
    return frames_dir(bdir) / (name + '.webp')


def crop(bdir, name, box, out, version='day', work=None):
    """Вырезка кадра для Gemini (точный файл для правки в новом чате — lessons §2). version: day | night | sunset."""
    work = work_dir(bdir, work)
    p = day_source(bdir, work, name) if version == 'day' else frames_dir(bdir) / ('%s_%s.webp' % (name, version))
    if not p.is_file():
        raise InsertError('нет файла %s' % p)
    a = read_img(p)[..., :3]
    x0, y0, x1, y1 = box_px(box, a.shape[1], a.shape[0])
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(a[y0:y1, x0:x1]).save(out)
    return {'file': str(out), 'from': str(p), 'px': [x0, y0, x1, y1], 'size': [x1 - x0, y1 - y0]}


def _slug(text):
    s = re.sub(r'[^a-z0-9]+', '-', str(text).lower()).strip('-')[:32]
    return s or 'insert'


def insert(bdir, name, edit_path, box, layer=None, kind='object', iid=None, night_edit=None, work=None, only=None, text=None,
           note=None, dry=False, quiet=False):
    """Вставка правки Gemini в кадр по матрице версий (docs/STANOK.md §3). Одна команда → все версии кадра + запись журнала.
    Тот же id повторно — запись заменяется, файлы собираются заново из чистых: дубля нет. Возвращает запись журнала."""
    if kind not in KINDS:
        raise InsertError('--kind: %s (есть: %s)' % (kind, ', '.join(KINDS)))
    if layer not in LAYERS + (None,):
        raise InsertError('--layer: %s (есть: ground, building)' % layer)
    work = work_dir(bdir, work)
    fdir = frames_dir(bdir)
    if not (fdir / (name + '.webp')).is_file():
        raise InsertError('нет кадра %s в %s' % (name, fdir))
    if not Path(edit_path).is_file():
        raise InsertError('нет файла правки %s' % edit_path)
    j = load_journal(work)
    iid = iid or _slug(text or Path(edit_path).stem)
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}', iid):
        raise InsertError('--id: только латиница, цифры и дефис (получено «%s»)' % iid)
    old = next((e for e in j['inserts'] if e['id'] == iid), None)
    if old and old['frame'] != name:
        raise InsertError('id «%s» уже занят вставкой кадра %s' % (iid, old['frame']))
    # вырезка дня — БЕЗ этой же вставки (повторный запуск обязан дать то же самое): собираем кадр из чистых файлов и прежних вставок
    jj = dict(j, inserts=[e for e in j['inserts'] if e['id'] != iid])
    prev = render_frame(bdir, work, name, jj, write=False, refresh=not any(q['frame'] == name for q in j['inserts']))
    day = decode(prev[name + '.webp'])[..., :3]
    H, W = day.shape[:2]
    x0, y0, x1, y1 = box_px(box, W, H)
    ref = day[y0:y1, x0:x1]
    G = np.array(Image.open(edit_path).convert('RGB'))
    tm, cc, Wm = locate(G, ref)
    if tm < 0.25:
        raise InsertError('правка не совпала с вырезкой кадра (совпадение контуров %.2f < 0,25): не тот файл, не тот прямоугольник '
                          'или Gemini перекомпоновал кусок — новый чат с точной вырезкой (stanok crop)' % tm)
    scale = max(1.0, min(4.0, G.shape[1] / max(1, ref.shape[1])))  # правка хранится в своём разрешении (до ×4 к кадру сайта) — запас под чёткость ×2
    cw, ch = int(round(ref.shape[1] * scale)), int(round(ref.shape[0] * scale))
    Ws = Wm.copy()
    Ws[:, :2] /= scale
    g = warp_to(G, Ws, cw, ch)
    ref_s = cv2.resize(ref, (cw, ch), interpolation=cv2.INTER_CUBIC) if scale != 1 else ref
    al = make_alpha(ref_s, g, kind)
    area = float((al > 0.5).mean())
    if (al > 0.5).sum() < 12:
        raise InsertError('правка не отличается от вырезки — вставлять нечего (совпадение %.2f)' % tm)
    if kind != 'inscription' and area > 0.6:
        raise InsertError('правка отличается от вырезки на %d %% площади: Gemini перерисовал весь кусок. Новый чат с точным файлом, '
                          'просьба «no other changes», или уже рамка' % round(area * 100))
    ys, xs = np.where(al > 0.02)                                  # сама вставка (маска) в долях кадра: по ней — актёры и запретные зоны
    bw, bh = box[2] - box[0], box[3] - box[1]
    mbox = [round(box[0] + bw * xs.min() / cw, 5), round(box[1] + bh * ys.min() / ch, 5), round(box[0] + bw * (xs.max() + 1) / cw, 5), round(box[1] + bh * (ys.max() + 1) / ch, 5)]
    warns = frame_guards(bdir, name, mbox, kind)
    if layer is None:                                             # слой — по тому, на чём лежит вставка
        bl = fdir / (name + '_building.webp')
        if bl.is_file():
            ba = decode(prev.get(name + '_building.webp', bl.read_bytes()))[y0:y1, x0:x1, 3].astype(F32) / 255.0
            a_s = cv2.resize(al, (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA)
            layer = 'building' if float((ba * a_s).sum()) > 0.5 * float(a_s.sum()) else 'ground'
        else:
            layer = 'ground'
    e = {'id': iid, 'frame': name, 'box': [round(x, 5) for x in box], 'maskBox': mbox, 'layer': layer, 'kind': kind,
         'edit': {'source': Path(edit_path).name, 'sha256': sha(Path(edit_path).read_bytes()), 'match': round(tm, 3), 'ecc': round(cc, 3), 'size': [cw, ch]},
         'maskShare': round(area, 4), 'when': datetime.date.today().isoformat(), 'warnings': warns}
    for k, v in (('text', text), ('note', note), ('only', list(only) if only else None)):
        if v:
            e[k] = v
    if dry:
        if not quiet:
            print('[dry-run] вставка «%s» в кадр %s: слой %s, вид %s, совпадение %.2f, маска %.1f %% вырезки — файлы не тронуты' % (iid, name, layer, kind, tm, area * 100))
        return e
    d = work / 'inserts' / iid
    d.mkdir(parents=True, exist_ok=True)
    Image.fromarray(g).save(d / 'edit.png')
    Image.fromarray(np.clip(np.rint(al * 255), 0, 255).astype(np.uint8)).save(d / 'alpha.png')
    Image.fromarray(ref).save(d / 'crop.png')
    if night_edit:
        N = np.array(Image.open(night_edit).convert('RGB'))
        nref = decode(prev[name + '_night.webp'])[y0:y1, x0:x1, :3]
        tn, _, Wn = locate(N, nref)
        if tn < 0.25:
            raise InsertError('ночная правка не совпала с ночной вырезкой (%.2f)' % tn)
        Wn[:, :2] /= scale
        Image.fromarray(warp_to(N, Wn, cw, ch)).save(d / 'night.png')
    if old:
        j['inserts'][j['inserts'].index(old)] = e                 # то же место в порядке — тот же результат
    else:
        j['inserts'].append(e)
    render_frame(bdir, work, name, j)
    save_journal(work, j)
    sheet(bdir, work, e)
    if not quiet:
        vs = e['versions']
        print('вставка «%s» → кадр %s (слой %s, вид %s, совпадение %.2f):' % (iid, name, layer, kind, tm))
        for v, _ in MATRIX:
            if v in vs:
                print('  %-17s %-22s %s' % (VERSION_RU[v], vs[v]['action'], vs[v]['why']))
        for w in warns:
            print('  ВНИМАНИЕ: ' + w)
    return e


def remove(bdir, iid, work=None):
    """Убрать вставку: запись уходит в removed журнала (ничего не теряется), кадр собирается заново без неё."""
    work = work_dir(bdir, work)
    j = load_journal(work)
    e = next((q for q in j['inserts'] if q['id'] == iid), None)
    if not e:
        raise InsertError('в журнале нет вставки «%s»' % iid)
    j['inserts'].remove(e)
    j.setdefault('removed', []).append(dict(e, removed=datetime.date.today().isoformat()))
    render_frame(bdir, work, e['frame'], j)
    save_journal(work, j)
    return e


def replay(bdir, frames=None, work=None, quiet=False):
    """Пересобрать кадры из чистых файлов и журнала (после нового мастера или ручной порчи frames/)."""
    work = work_dir(bdir, work)
    j = load_journal(work)
    names = sorted({e['frame'] for e in j['inserts']} | set(j.get('frames', {})))
    if frames:
        names = [n for n in names if n in frames]
    for n in names:
        render_frame(bdir, work, n, j)
        if not quiet:
            print('кадр %s пересобран: вставок %d' % (n, sum(1 for e in j['inserts'] if e['frame'] == n)))
    save_journal(work, j)
    return names


def put_clean(bdir, fn, data, work=None):
    """Новый ЧИСТЫЙ файл кадра (от intake / layers: новый мастер). Если у кадра есть вставки — файл становится чистой основой и все
    вставки журнала накладываются заново (вставка не теряется никогда); иначе просто пишется в frames/. Возвращает True, если переиграно."""
    work = work_dir(bdir, work)
    fdir = frames_dir(bdir)
    fdir.mkdir(parents=True, exist_ok=True)
    j = load_journal(work)
    name = next((n for n in sorted({e['frame'] for e in j['inserts']}, key=len, reverse=True) if fn in dict((f, v) for v, f in frame_files(n))), None)
    if name is None:
        (fdir / fn).write_bytes(data)
        if (work / 'base' / fn).is_file():                        # основа от прежних (убранных) вставок — тоже обновить
            (work / 'base' / fn).write_bytes(data)
        return False
    ensure_base(fdir, work, name)
    (work / 'base' / fn).write_bytes(data)
    render_frame(bdir, work, name, j)
    save_journal(work, j)
    return True


def sheet(bdir, work, e):
    """Лист вставки: вырезка | правка | маска | день | закат | ночь (после) — work/<slug>/inserts/<id>/sheet.jpg."""
    d = Path(work) / 'inserts' / e['id']
    fdir = frames_dir(bdir)
    crop_ = np.array(Image.open(d / 'crop.png').convert('RGB'))
    h, w = crop_.shape[:2]
    tiles = [crop_, cv2.resize(np.array(Image.open(d / 'edit.png').convert('RGB')), (w, h), interpolation=cv2.INTER_AREA),
             np.dstack([cv2.resize(np.array(Image.open(d / 'alpha.png').convert('L')), (w, h), interpolation=cv2.INTER_AREA)] * 3)]
    for suf in ('', '_sunset', '_night'):
        p = fdir / ('%s%s.webp' % (e['frame'], suf))
        if p.is_file():
            a = read_img(p)[..., :3]
            x0, y0, x1, y1 = box_px(e['box'], a.shape[1], a.shape[0])
            tiles.append(cv2.resize(a[y0:y1, x0:x1], (w, h)))
    Image.fromarray(np.concatenate(tiles, 1)).save(d / 'sheet.jpg', quality=88)
    return d / 'sheet.jpg'


# ---------------------------------------------------------------- гейт G3: вставка во всех версиях кадра
G3_MIN_MEAN = 1.2      # средняя разница «после − чистый» под маской вставки, уровни 0..255: меньше — вставки в этой версии нет
G3_RATIO = 2.5         # и она обязана быть в 2,5 раза больше шума перекодирования вне вставок


def must_change(e, have):
    """Версии, в которых вставка ОБЯЗАНА быть видна (цветные версии матрицы). Маски и глубина — по правилам вида, не обязательны."""
    need = ['day'] + [v for v in ('sunset', 'night') if v in have]
    vs = e.get('versions', {})
    if e['layer'] == 'ground' and 'bg' in have and vs.get('bg', {}).get('action') != 'не трогает':
        need.append('bg')
    if e['layer'] == 'building' and 'building' in have:
        need.append('building')
    return need


def gate_g3_files(bdir, work=None):
    """G3 по файлам: (1) файлы кадра те, что собрал станок (sha из журнала) — иначе кто-то перезаписал версию мимо станка и вставка
    могла пропасть; (2) в каждой обязательной версии под маской вставки картинка отличается от чистой заметно сильнее шума
    перекодирования; (3) вне прямоугольников вставок — только шум. Возвращает (проблемы, сколько вставок проверено)."""
    work = work_dir(bdir, work)
    j = load_journal(work)
    fdir = frames_dir(bdir)
    probs = []
    for name in sorted({e['frame'] for e in j['inserts']}):
        entries = [e for e in j['inserts'] if e['frame'] == name]
        rec = j.get('frames', {}).get(name, {})
        cur, base, have = {}, {}, set()
        for v, fn in frame_files(name):
            if (fdir / fn).is_file() and (work / 'base' / fn).is_file():
                have.add(v)
                data = (fdir / fn).read_bytes()
                if fn in rec and rec[fn]['sha256'] != sha(data):
                    probs.append('кадр %s, %s (%s): файл изменён мимо станка после вставок — вставки могли пропасть; запусти stanok replay' % (name, VERSION_RU[v], fn))
                if fn in rec and rec[fn].get('base') != sha((work / 'base' / fn).read_bytes()):
                    probs.append('кадр %s, %s: чистая основа изменилась, а кадр не пересобран — запусти stanok replay' % (name, VERSION_RU[v]))
                cur[v], base[v] = decode(data).astype(F32), read_img(work / 'base' / fn).astype(F32)
        if 'day' not in cur:
            probs.append('кадр %s: нет дневного рисунка или его чистой основы' % name)
            continue
        H, W = cur['day'].shape[:2]
        outside = np.ones((H, W), bool)
        for e in entries:
            x0, y0, x1, y1 = box_px(e['box'], W, H)
            outside[max(0, y0 - 8):y1 + 8, max(0, x0 - 8):x1 + 8] = False
        for e in entries:
            x0, y0, x1, y1 = box_px(e['box'], W, H)
            ap = work / 'inserts' / e['id'] / 'alpha.png'
            if not ap.is_file():
                probs.append('вставка «%s»: нет файлов вставки в %s' % (e['id'], ap.parent))
                continue
            a = cv2.resize(np.array(Image.open(ap).convert('L')), (x1 - x0, y1 - y0), interpolation=cv2.INTER_AREA).astype(F32) / 255.0
            vs = e.get('versions', {})
            for v, _ in MATRIX:                                   # журнал обязан назвать каждую версию, которая есть у кадра
                if v in have and v not in vs:
                    probs.append('вставка «%s»: в журнале нет строки версии «%s»' % (e['id'], VERSION_RU[v]))
            for v in must_change(e, have):
                d = np.abs(cur[v] - base[v])
                w = a * (base['building'][y0:y1, x0:x1, 3] > 8) if v == 'building' and e['kind'] != 'object' else a
                if v == 'building' and e['kind'] == 'object':
                    dd = d[y0:y1, x0:x1].max(-1)
                else:
                    dd = d[y0:y1, x0:x1, :3].max(-1)
                inside = float((dd * w).sum() / max(1.0, w.sum()))
                noise = float(d[..., :3].max(-1)[outside].mean()) if outside.any() else 0.0
                if inside < G3_MIN_MEAN or inside < G3_RATIO * noise:
                    probs.append('вставка «%s», кадр %s: в версии «%s» вставки НЕТ (разница под маской %.2f, шум вне вставок %.2f)' % (e['id'], name, VERSION_RU[v], inside, noise))
        for v in sorted(have):                                    # вне вставок — только шум перекодирования
            d = np.abs(cur[v] - base[v])[..., :3].max(-1)
            if outside.any() and float(d[outside].mean()) > 3.0:
                probs.append('кадр %s, %s: вне прямоугольников вставок картинка изменилась (средняя разница %.1f) — правка мимо станка' % (name, VERSION_RU[v], float(d[outside].mean())))
    return probs, len(j['inserts'])


def gate_g3_idem(bdir, work=None):
    """G3, идемпотентность: кадры, собранные заново из чистых файлов и журнала, обязаны совпасть с лежащими в frames/ байт в байт
    (повторная вставка и переигрывание ничего не дублируют). Проверка идёт в памяти, файлы не трогает."""
    work = work_dir(bdir, work)
    j = load_journal(work)
    fdir, probs = frames_dir(bdir), []
    for name in sorted({e['frame'] for e in j['inserts']}):
        out = render_frame(bdir, work, name, json.loads(json.dumps(j)), write=False)
        for fn, data in out.items():
            if (fdir / fn).is_file() and (fdir / fn).read_bytes() != data:
                probs.append('кадр %s, %s: повторная сборка даёт другой файл — вставка дублируется или кадр собран не из чистой основы' % (name, fn))
    return probs


def clean_copy(bdir, work=None, dest=None):
    """Копия папки здания БЕЗ вставок — для снимков «без вставки» (G3 по рендеру). На месте файлов кадра, которые станок перекодировал,
    — чистые основы, перекодированные тем же путём: тогда две страницы отличаются только самой вставкой, а не шумом WebP по всему кадру.
    Остальное — ссылками."""
    work = work_dir(bdir, work)
    b, fdir = bpath(bdir), frames_dir(bdir)
    dest = Path(dest or tempfile.mkdtemp(prefix='stanok-clean-'))
    (dest / 'frames').mkdir(parents=True, exist_ok=True)
    for p in fdir.iterdir():
        src = work / 'base' / p.name
        if src.is_file() and src.read_bytes() != p.read_bytes():
            raw = src.read_bytes()
            (dest / 'frames' / p.name).write_bytes(encode_like(decode(raw).astype(F32), raw))
        else:
            os.symlink(p, dest / 'frames' / p.name)
    for cfg in ('building.e2.json', 'migration-allowed.json'):
        if (b / cfg).is_file():
            c = json.loads((b / cfg).read_text(encoding='utf-8'))
            if cfg == 'building.e2.json':
                c['framesDir'] = 'frames/'
            (dest / cfg).write_text(json.dumps(c, ensure_ascii=False), encoding='utf-8')
    return dest


G3_STATES = ('day', 'sunset', 'night', 'rain', 'snow')     # 5 кнопок; «Снег» — последним (stanok_px: после него снег тает 30 с)
G3_RENDER_SHARE = 0.2                                       # на снимке кнопки под вставкой обязано измениться ≥ 20 % её площади на экране


def g3_render_compare(dir_with, dir_clean, frames_idx, entries, frame_size, delta=2, states=G3_STATES):
    """Снимки сцены (tools/stanok_px.mjs shoot, *.rgba) страницы со вставками против страницы без них: на каждой из 5 кнопок вставка
    обязана быть видна. frames_idx: {имя кадра: номер}. Возвращает (проблемы, таблица чисел)."""
    probs, rows = [], []
    ia = json.loads((Path(dir_with) / 'index.json').read_text())
    SW, SH = ia.get('size', [390, 844])
    FW, FH = frame_size
    k = max(SW / FW, SH / FH)                                   # кадр вписан «с обрезкой» (cover): пикселей экрана на пиксель кадра
    for name, idx in frames_idx.items():
        for st in states:
            shot = 'f%d-%s-tC' % (idx, st)
            pa, pb = Path(dir_with) / (shot + '.rgba'), Path(dir_clean) / (shot + '.rgba')
            if not pa.is_file() or not pb.is_file():
                probs.append('кадр %s, кнопка %s: нет снимка %s' % (name, st, shot))
                continue
            A = np.frombuffer(pa.read_bytes(), np.uint8).reshape(SH, SW, 4)[..., :3].astype(np.int16)
            B = np.frombuffer(pb.read_bytes(), np.uint8).reshape(SH, SW, 4)[..., :3].astype(np.int16)
            ch = int((np.abs(A - B).max(-1) > delta).sum())
            exp = sum(e['maskShare'] * (e['box'][2] - e['box'][0]) * FW * (e['box'][3] - e['box'][1]) * FH * k * k for e in entries if e['frame'] == name)
            ok = ch >= G3_RENDER_SHARE * exp
            rows.append({'frame': name, 'button': st, 'changedPx': ch, 'expectedPx': round(exp), 'ok': ok})
            if not ok:
                probs.append('кадр %s, кнопка «%s»: вставки не видно (изменилось %d px из ожидаемых ≈ %d)' % (name, st, ch, round(exp)))
    return probs, rows


def deliver(bdir, e, text, spot=None, dry=False):
    """Купленная надпись: запись в building.json (v1, на нём живёт e1.62): inscriptions += {…}, sale.left −= 1 — те же поля, что пишет
    tools/deliver_inscription.py. Сама надпись в кадрах — обычная вставка kind: inscription."""
    bj = bpath(bdir) / 'building.json'
    if not bj.is_file():
        return None
    b = json.loads(bj.read_text(encoding='utf-8'))
    ins = b.setdefault('inscriptions', [])
    u, v = round((e['box'][0] + e['box'][2]) / 2, 4), round((e['box'][1] + e['box'][3]) / 2, 4)
    rec = {'id': e['id'], 'frame': e['frame'], 'u': u, 'v': v, 'text': text[:24], 'year': str(datetime.date.today().year),
           'layer': 'building' if e['layer'] == 'building' else 'bg', 'note': 'место %s' % spot if spot else 'stanok insert'}
    if not any(x['id'] == e['id'] for x in ins):
        ins.append(rec)
        if 'sale' in b and b['sale'].get('left', 0) > 0:
            b['sale']['left'] -= 1
    if not dry:
        bj.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return dict(rec, left=b.get('sale', {}).get('left'), link='https://chka.am/%s/?n=%s' % (bpath(bdir).name, e['id']))
