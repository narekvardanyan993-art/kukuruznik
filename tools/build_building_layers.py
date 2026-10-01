#!/usr/bin/env python3
"""Слои кадра для движка из ОДНОЙ нарисованной картинки (здание без парных кадров «со зданием / без здания»).

  python3 tools/build_building_layers.py --src ИСХОДНИК.jpg --spec tests/lenin/layers.json --out tests/lenin/frames --models ПАПКА_С_МОДЕЛЯМИ

Что делает (для кадра <name> из spec):
  <name>.webp            цвет, размер кадра = spec.size (с потерями, q90)
  <name>_depth.webp      карта глубины (Depth Anything V2 Small, ONNX), без потерь
  <name>_building.webp   RGBA-вырезка главного объекта: полигон spec.polygon (геометрия постамента) + контур статуи из IS-Net
                         внутри spec.extra_box (координаты кадра), мягкий край
  <name>_bg.webp         тот же кадр с вырезанным объектом, дорисованным cv2.inpaint (то, что открывается при наклоне)
  <name>_bg_depth.webp   глубина фона (по дорисованной картинке)
  <name>_env.webp        R — небо, G/B — высота и фаза деревьев (tools/build_env_masks.py: sky_mask, tree_labels)
  <name>_win2.webp       окна других зданий в рамках spec.window_boxes (other_windows оттуда же)
Закатной и ночной картинок нет (в building.json: "sunset": false, "night": false) — движок рисует их сам.
Модели (скачиваются отдельно, в git не входят; GitHub releases, без Hugging Face):
  depth_anything_v2_vits.onnx  — fabio-sim/Depth-Anything-ONNX, v2.0.0
  isnet-general-use.onnx       — danielgatis/rembg, v0.0.0
Нужны: pillow, numpy, scipy, opencv-python-headless, onnxruntime.
spec (JSON): name, size [W,H], polygon [[x,y]…], extra_box [x0,y0,x1,y1], window_boxes [[x0,y0,x1,y1]…], tree_margin, sky {std,dn,close}.
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
    a = ap.parse_args()
    spec = json.loads(Path(a.spec).read_text(encoding='utf-8'))
    name, (W, H) = spec['name'], spec['size']
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    models = Path(a.models)

    im = Image.open(a.src).convert('RGB').resize((W, H), Image.LANCZOS)
    rgb = np.asarray(im).astype(np.float32) / 255
    save(im, out / (name + '.webp'), 'lossy')

    dsess = session(models / 'depth_anything_v2_vits.onnx')
    d = depth_map(dsess, rgb, W, H)
    save((d * 255).astype(np.uint8), out / (name + '_depth.webp'), 'lossless')

    # --- вырезка: полигон + статуя (IS-Net в рамке extra_box) ---
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
    rgba = np.dstack([(rgb * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    save(Image.fromarray(rgba, 'RGBA'), out / (name + '_building.webp'), 'rgba')

    # --- фон без объекта ---
    hole = ndimage.binary_dilation(bld, iterations=4).astype(np.uint8) * 255
    bg = cv2.inpaint(cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2BGR), hole, 7, cv2.INPAINT_TELEA)
    bg = cv2.cvtColor(bg, cv2.COLOR_BGR2RGB)
    save(bg, out / (name + '_bg.webp'), 'lossy')
    dbg = depth_map(dsess, bg.astype(np.float32) / 255, W, H)
    save((dbg * 255).astype(np.uint8), out / (name + '_bg_depth.webp'), 'lossless')

    # --- небо, деревья, окна (как tools/build_env_masks.py) ---
    lo, hi = np.percentile(d * 255, 2), np.percentile(d * 255, 98)
    dn = np.clip((d * 255 - lo) / (hi - lo + 1e-6), 0, 1)
    be.SKY_PARAMS[name] = spec.get('sky', dict(std=0.05, dn=0.5, close=9))
    sky = be.sky_mask(dn, rgb, name)
    env = np.zeros((H, W, 3), np.float32)
    env[..., 0] = ndimage.gaussian_filter(sky.astype(np.float32), 1.5)
    lab = be.tree_labels(dn, bld, sky, spec.get('tree_margin', 0.07)) if spec.get('trees', True) else np.zeros((H, W), np.int32)
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
    win2, nw = be.other_windows(name, rgb, bld, sky)
    save((np.clip(win2, 0, 1) * 255).astype(np.uint8), out / (name + '_win2.webp'), 'lossless')
    print('%s: кадр %dx%d, небо %.0f%%, объект %.1f%%, деревьев %d, окон %d' % (name, W, H, sky.mean() * 100, bld.mean() * 100, nt, nw))


if __name__ == '__main__':
    main()
