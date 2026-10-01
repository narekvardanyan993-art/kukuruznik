#!/usr/bin/env python3
"""Слои кадра для движка из ОДНОЙ нарисованной картинки (здание без парных кадров «со зданием / без здания»).

  python3 tools/build_building_layers.py --src ИСХОДНИК.jpg --spec tests/lenin/layers.json --out tests/lenin/frames --models ПАПКА_С_МОДЕЛЯМИ [--bg ФОН.jpg]

Что делает (для кадра <name> из spec):
  <name>.webp            цвет, размер кадра = spec.size (с потерями, q90). С --bg: вне объекта (вырезка + 2 px) — пиксели ФОНА, не кадра (см. ниже)
  <name>_depth.webp      карта глубины (Depth Anything V2 Small, ONNX), без потерь
  <name>_building.webp   RGBA-вырезка главного объекта. Если в spec есть cutout и задан --bg — по РАЗНИЦЕ кадра и фона (внутри грубого
                         полигона cutout.region: порог cutout.thr, закрытие дыр, самая большая связная часть). Иначе — полигон spec.polygon
                         (геометрия постамента) + контур статуи из IS-Net внутри spec.extra_box (координаты кадра). Край мягкий
  <name>_bg.webp         тот же кадр БЕЗ объекта (то, что открывается при наклоне): картинка --bg (нарисованный фон, тот же ракурс; Gemini)
                         или, если --bg не задан, кадр с вырезанным объектом, дорисованным cv2.inpaint (грубо: размазанные полосы)
  <name>_bg_depth.webp   глубина фона (по дорисованной картинке)
  <name>_env.webp        R — небо, G/B — высота и фаза деревьев (tools/build_env_masks.py: sky_mask, tree_labels)
  <name>_win2.webp       окна других зданий в рамках spec.window_boxes (other_windows оттуда же)
Закатной и ночной картинок нет (в building.json: "sunset": false, "night": false) — движок рисует их сам.
Модели (скачиваются отдельно, в git не входят; GitHub releases, без Hugging Face):
  depth_anything_v2_vits.onnx  — fabio-sim/Depth-Anything-ONNX, v2.0.0
  isnet-general-use.onnx       — danielgatis/rembg, v0.0.0
Нужны: pillow, numpy, scipy, opencv-python-headless, onnxruntime.
Почему кадр вне объекта = фон (с --bg): движок кладёт «землю» из <name>.webp, а на месте объекта — фон; всё, что кадр содержит вокруг вырезки
  (ореол акварели, мазки вокруг фигуры), остаётся неподвижным и при наклоне смотрится как «копия» рядом с объектом. Поэтому вне вырезки кадр = фон.
  Маска неба/деревьев/окон при этом считается по ФОНУ: иначе на месте объекта неба «нет», и при наклоне там вылезает неокрашенное/тёмное пятно силуэта
  (день — бледный ореол, тучи/дождь — тёмный).
trees: false — без качания; true (по умолчанию) — группы по глубине (tools/build_env_masks.tree_labels, мелкие кроны); объект {a, close, grow, bottom, min_area, waves} — ВСЕ кроны по цвету фона (нужен --bg), одинаковая высота-амплитуда, фаза — бегущая волна.
spec (JSON): name, size [W,H], polygon [[x,y]…], extra_box [x0,y0,x1,y1], cutout {region [[x,y]…], thr, close, grow, tree_a, open, tree_erode, add [[полигон]…]} (вместо polygon/extra_box при --bg), window_boxes [[x0,y0,x1,y1]…], tree_margin, sky {std,dn,close},
  grade {chroma, gamma} — цветокоррекция слоёв «цвет / здание / фон» (в Lab: цветность ×chroma, яркость L^gamma; белая бумага остаётся белой),
  чтобы насыщенность и тон кадра были на уровне кадров Кукурузника (замер: средняя насыщенность 0,10–0,11, нижняя половина 0,14–0,16).
  Глубина, вырезка и маски считаются по исходному (неисправленному) цвету.
--bg: фон без объекта; при запуске печатается расхождение фона с кадром ВНЕ объекта (средняя абсолютная разница, 0–255): чем меньше, тем точнее
  совпал ракурс (при выборе из нескольких попыток Gemini брать наименьшее).
Тяжёлое (две модели + дорисовка) занимает ~1 минуту на CPU. Результат — в git (tests/<здание>/frames), исходник — рядом (tests/<здание>/source).
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_env_masks as be   # noqa: E402  sky_mask / tree_labels / other_windows

MEAN, STD = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])


def session(path):
    return ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])


def depth_map(sess, rgb01, W, H):
    x = ((cv2.resize(rgb01, (518, 518), interpolation=cv2.INTER_CUBIC) - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    d = np.squeeze(sess.run(None, {sess.get_inputs()[0].name: x})[0])
    d = (d - d.min()) / (d.max() - d.min() + 1e-9)
    return cv2.resize(d, (W, H), interpolation=cv2.INTER_LINEAR)


def isnet_mask(sess, rgb01, W, H):
    x = (cv2.resize(rgb01, (1024, 1024)) - 0.5).transpose(2, 0, 1)[None].astype(np.float32)
    m = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    m = (m - m.min()) / (m.max() - m.min() + 1e-9)
    return cv2.resize(m, (W, H))


def grade(rgb_u8, chroma, gamma):
    """Цветность ×chroma и яркость L^gamma в Lab (белая бумага L=1 остаётся белой)."""
    lab = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab[..., 0] = np.clip((lab[..., 0] / 255.0) ** gamma, 0, 1) * 255
    lab[..., 1] = 128 + (lab[..., 1] - 128) * chroma
    lab[..., 2] = 128 + (lab[..., 2] - 128) * chroma
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


def veg_tree_env(bg_rgb_u8, sky, cfg):
    """Деревья по ЦВЕТУ фона (листва зеленее бумаги), все кроны сразу — чтобы качались ВСЕ, а не одна группа.
    Возвращает (высота 0–1 от низа к верху кроны, фаза 0–1). Фаза плавно бежит вдоль кадра (бегущая волна),
    поэтому у соседних крон нет разрыва; амплитуду задаёт сам движок, одинаковую для всех."""
    H, W = bg_rgb_u8.shape[:2]
    lab = cv2.cvtColor(bg_rgb_u8, cv2.COLOR_RGB2LAB).astype(np.float32)
    g = (lab[..., 1] - 128) < cfg.get('a', -2.5)
    g = ndimage.binary_opening(g, structure=np.ones((3, 3)))
    c = cfg.get('close', 17)
    g = ndimage.binary_closing(np.pad(g, c), structure=np.ones((c, c)))[c:-c, c:-c]
    g = ndimage.binary_fill_holes(ndimage.binary_dilation(g, iterations=cfg.get('grow', 3)))
    g &= ~ndimage.binary_dilation(sky, iterations=3)
    g[int(H * cfg.get('bottom', 0.63)):] = False
    lab0, k = ndimage.label(g)
    keep = np.zeros_like(g)
    for i in range(1, k + 1):
        m = lab0 == i
        if m.sum() >= cfg.get('min_area', 1500):
            keep |= m
    hgt = np.zeros((H, W), np.float32)
    ph = np.zeros((H, W), np.float32)
    yy = np.arange(H, dtype=np.float32)[:, None]
    lab1, k1 = ndimage.label(keep)
    xx = np.arange(W, dtype=np.float32)[None, :]
    wave = 0.1 + 0.9 * ((xx / W * cfg.get('waves', 1.3)) % 1.0)
    for i in range(1, k1 + 1):
        m = lab1 == i
        ys, _ = np.nonzero(m)
        hf = np.clip((ys.max() - yy) / max(1, ys.max() - ys.min()), 0, 1) ** 1.2
        hgt = np.where(m, hf, hgt)
        ph = np.where(m, wave, ph)
    return hgt, ph, k1


def save(arr_or_im, path, kind):
    im = arr_or_im if isinstance(arr_or_im, Image.Image) else Image.fromarray(arr_or_im)
    if kind == 'lossless':
        im.save(path, 'WEBP', lossless=True, method=6)
    elif kind == 'rgba':
        im.convert('RGBA').save(path, 'WEBP', quality=90, alpha_quality=100, method=6)
    else:
        im.convert('RGB').save(path, 'WEBP', quality=90, method=6)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--spec', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--models', required=True)
    ap.add_argument('--bg', help='фон без объекта (тот же ракурс); без него — cv2.inpaint')
    a = ap.parse_args()
    spec = json.loads(Path(a.spec).read_text(encoding='utf-8'))
    name, (W, H) = spec['name'], spec['size']
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    models = Path(a.models)

    im = Image.open(a.src).convert('RGB').resize((W, H), Image.LANCZOS)
    rgb = np.asarray(im).astype(np.float32) / 255
    g = spec.get('grade')
    gr = (lambda a: grade(a, g['chroma'], g['gamma'])) if g else (lambda a: a)
    col8 = gr(np.asarray(im))   # исправленный цвет — для слоёв «цвет / здание / фон»; модели и маски идут по исходному
    save(Image.fromarray(col8), out / (name + '.webp'), 'lossy')

    dsess = session(models / 'depth_anything_v2_vits.onnx')
    d = depth_map(dsess, rgb, W, H)
    save((d * 255).astype(np.uint8), out / (name + '_depth.webp'), 'lossless')

    # --- фон без объекта (нужен раньше, если вырезка идёт по разнице кадра и фона) ---
    bg0 = np.asarray(Image.open(a.bg).convert('RGB').resize((W, H), Image.LANCZOS)) if a.bg else None

    # --- вырезка ---
    cut = spec.get('cutout')
    if cut and bg0 is not None:
        # объект = где кадр заметно отличается от фона, внутри грубой области; дыры закрываются, берётся самая большая часть
        diff = ndimage.gaussian_filter(np.abs(rgb * 255 - bg0.astype(np.float32)).mean(-1), 1.5)
        reg = np.zeros((H, W), np.uint8); cv2.fillPoly(reg, [np.array(cut['region'], np.int32)], 255)
        bld = (diff > cut.get('thr', 30)) & (reg > 0)
        if 'tree_a' in cut:    # листва у краёв объекта (зеленее порога по сглаженному цвету кадра) — не объект: убирает зелёные пятна
            af = ndimage.gaussian_filter(cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2LAB).astype(np.float32)[..., 1] - 128, cut.get('tree_sigma', 2.5))
            bld &= af > cut['tree_a']
        bld = ndimage.binary_opening(bld, structure=np.ones((3, 3)))
        c = cut.get('close', 15)
        bld = ndimage.binary_closing(np.pad(bld, c), structure=np.ones((c, c)))[c:-c, c:-c]
        bld = ndimage.binary_fill_holes(bld)
        if cut.get('open'):    # срезать тонкие обрывки туши, прилипшие к краю (кусочки веток)
            o = cut['open']
            bld = ndimage.binary_opening(np.pad(bld, o), structure=np.ones((o, o)))[o:-o, o:-o]
        if cut.get('tree_erode'):    # у листвы край объекта сжать на N пикселей (зелёная кайма)
            azone = ndimage.gaussian_filter(cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2LAB).astype(np.float32)[..., 1] - 128, 4) < cut.get('tree_zone', -1.5)
            azone = ndimage.binary_dilation(azone, iterations=6)
            bld = np.where(azone, ndimage.binary_erosion(bld, iterations=cut['tree_erode']), bld)
        lab0, k0 = ndimage.label(bld)
        if k0 > 1:
            bld = lab0 == (1 + int(np.argmax(ndimage.sum(bld, lab0, range(1, k0 + 1)))))
        for pl in cut.get('add', []):    # дорисовать вручную: полигоны, где разница слабая (бледная стена у края кадра)
            ad = np.zeros((H, W), np.uint8); cv2.fillPoly(ad, [np.array(pl, np.int32)], 255)
            bld |= ad > 0
        bld = ndimage.binary_dilation(bld, iterations=cut.get('grow', 2))
    else:
        poly = np.array(spec['polygon'], np.int32)
        mk = np.zeros((H, W), np.uint8); cv2.fillPoly(mk, [poly], 255)
        m = isnet_mask(session(models / 'isnet-general-use.onnx'), rgb, W, H)
        x0, y0, x1, y1 = spec['extra_box']
        box = np.zeros((H, W), bool); box[y0:y1, x0:x1] = True
        st = ndimage.binary_fill_holes(ndimage.binary_closing((m > 0.3) & box, structure=np.ones((5, 5))))
        lab, k = ndimage.label(st)
        if k > 1:
            st = lab == (1 + int(np.argmax(ndimage.sum(st, lab, range(1, k + 1)))))
        st = ndimage.binary_dilation(st, iterations=2)
        bld = ndimage.binary_closing((mk > 0) | st, structure=np.ones((5, 5)))
    alpha = np.clip(ndimage.gaussian_filter(bld.astype(np.float32), 0.8) * 1.15, 0, 1)
    if bg0 is not None and spec.get('ground_from_bg', True):   # кадр вне объекта = фон: никаких неподвижных остатков кадра рядом с вырезкой
        keep = ndimage.binary_dilation(bld, iterations=2)
        save(Image.fromarray(np.where(keep[..., None], col8, gr(bg0))), out / (name + '.webp'), 'lossy')
    rgba = np.dstack([col8, (alpha * 255).astype(np.uint8)])
    save(Image.fromarray(rgba, 'RGBA'), out / (name + '_building.webp'), 'rgba')

    # --- фон без объекта ---
    if a.bg:
        outside = ~ndimage.binary_dilation(bld, iterations=12)
        mis = float(np.abs(bg0.astype(np.float32) - np.asarray(im).astype(np.float32)).mean(-1)[outside].mean())
        print('фон %s: расхождение с кадром вне объекта %.2f из 255 (меньше — точнее ракурс)' % (a.bg, mis))
    else:
        hole = ndimage.binary_dilation(bld, iterations=4).astype(np.uint8) * 255
        bg0 = cv2.cvtColor(cv2.inpaint(cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR), hole, 7, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)
    save(gr(bg0), out / (name + '_bg.webp'), 'lossy')
    dbg = depth_map(dsess, bg0.astype(np.float32) / 255, W, H)
    save((dbg * 255).astype(np.uint8), out / (name + '_bg_depth.webp'), 'lossless')

    # --- небо, деревья, окна (как tools/build_env_masks.py) ---
    # с --bg маски считаются по ФОНУ (там на месте объекта небо/земля, а не силуэт), иначе по кадру
    bgm = bg0 is not None and spec.get('ground_from_bg', True)
    dsrc, rsrc = (dbg, bg0.astype(np.float32) / 255) if bgm else (d, rgb)
    lo, hi = np.percentile(dsrc * 255, 2), np.percentile(dsrc * 255, 98)
    dn = np.clip((dsrc * 255 - lo) / (hi - lo + 1e-6), 0, 1)
    be.SKY_PARAMS[name] = spec.get('sky', dict(std=0.05, dn=0.5, close=9))
    sky = be.sky_mask(dn, rsrc, name)
    env = np.zeros((H, W, 3), np.float32)
    env[..., 0] = ndimage.gaussian_filter(sky.astype(np.float32), 1.5)
    tr = spec.get('trees', True)
    if isinstance(tr, dict) and bg0 is not None:      # деревья по цвету фона: качаются все кроны одинаково
        hgt, ph, nt = veg_tree_env(bg0, sky, tr)
    else:
        lab = be.tree_labels(dn, bld, sky, spec.get('tree_margin', 0.07)) if tr else np.zeros((H, W), np.int32)
        nt = int(lab.max())
        hgt, ph = np.zeros((H, W), np.float32), np.zeros((H, W), np.float32)
        yy = np.arange(H, dtype=np.float32)[:, None]
        for i in range(1, nt + 1):
            mm = lab == i
            ys, _ = np.nonzero(mm)
            hf = np.clip((ys.max() - yy) / max(1, ys.max() - ys.min()), 0, 1) ** 1.2
            hgt = np.where(mm, hf, hgt)
            ph = np.where(mm, 0.1 + 0.9 * ((i * 0.6180339) % 1.0), ph)
    env[..., 1], env[..., 2] = ndimage.gaussian_filter(hgt, 1.5), ph
    save((np.clip(env, 0, 1) * 255).astype(np.uint8), out / (name + '_env.webp'), 'lossless')
    be.WINDOW_BOXES[name] = [tuple(b) for b in spec.get('window_boxes', [])]
    win2, nw = be.other_windows(name, rsrc, bld, sky)
    save((np.clip(win2, 0, 1) * 255).astype(np.uint8), out / (name + '_win2.webp'), 'lossless')
    print('%s: кадр %dx%d, небо %.0f%%, объект %.1f%%, деревьев %d, окон %d' % (name, W, H, sky.mean() * 100, bld.mean() * 100, nt, nw))


if __name__ == '__main__':
    main()
