#!/usr/bin/env python3
"""Приёмка листа спрайтов из Gemini (Nano Banana) в атлас движка engine/sprites/life.webp + life.json (e1.11).

  python3 tools/sprites_intake.py лист.jpg --grid 3x2 --scale 0.3 car_pobeda_side_r car_pobeda_side_l car_pobeda_front_r ...
      лист режется на клетки сетки (ряды сверху вниз, в ряду слева направо), в каждой клетке — всё нарисованное вместе
      (группа «скамья + люди + голуби» остаётся одним кадром); «-» вместо имени — клетку пропустить
  --scale  во сколько раз уменьшить лист (один масштаб на весь лист: виды одной машины остаются в одном масштабе)
  --dry    ничего не записывать, только показать размеры
  --holes  белые просветы внутри рисунка (между рейками скамьи) тоже убрать — только для сценок, не для машин (блики кузова пропадут)
  без --grid — старый режим: каждый отдельный объект листа — кадр (объекты не должны касаться)

Имена (движок ищет их в life.json; docs/ENGINE-LIFE.md «Спрайты»):
  car_<модель>_<side|front|rear>_<r|l>   модель: pobeda / volga / trolley / water; side — бок, front — 3/4 спереди (едет к зрителю, вниз),
                                          rear — 3/4 сзади (от зрителя, вверх); r/l — капотом вправо/влево
  walk_<кто>_<0..3>   фазы шага, идёт вправо      stand_<кто>_<0..3>   живая стойка (вес, голова, жест, газета)
  sit_<сцена>_<0..1>  сценки со скамьёй/табуретом (bench2 — двое на скамье, shine — чистильщик обуви, feeder — старик кормит голубей)
Белый фон убирается заливкой от краёв клетки (белое внутри предмета — стёкла, блики — остаётся). В life.json у каждого кадра
[x, y, w, h, якорь x, якорь y]; groups — опорный размер группы (машина — длина бока, люди — рост), чтобы все виды одной группы
рисовались в одном масштабе.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
HOLES = '--holes' in sys.argv
OUT = ROOT / 'engine' / 'sprites'
ANCHOR = {'car': (0.5, 0.8), 'walk': (0.5, 0.97), 'stand': (0.5, 0.97), 'sit': (0.5, 0.95),
          'pigeon_sit': (0.45, 0.95), 'pigeon_peck': (0.45, 0.95), 'pigeon': (0.5, 0.55), 'sparrow': (0.45, 0.96)}


def anchor(name):
    for k in sorted(ANCHOR, key=len, reverse=True):
        if name.startswith(k):
            return ANCHOR[k]
    return (0.5, 0.5)


def group(name):
    p = name.split('_')
    return '_'.join(p[:2])


def cutout(rgb):
    """RGB (float 0..255) -> RGBA: белый фон, связанный с краем клетки, прозрачный; край мягкий."""
    mn = rgb.min(-1)
    alpha = np.clip((248 - mn) / 36, 0, 1)
    lab, _ = ndimage.label(alpha < 0.06)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(edge))
    sizes = ndimage.sum(np.ones_like(mn), lab, range(1, lab.max() + 1)) if lab.max() else []
    big = [i + 1 for i, s in enumerate(sizes) if s > 150 and (i + 1) not in edge]
    if HOLES:
        outside |= np.isin(lab, big) & (mn > 246)   # --holes: закрытые белые просветы (рейки скамьи) — тоже фон; у машин нельзя — блики кузова
    outside = ndimage.binary_dilation(outside, iterations=1)
    alpha = np.where(outside, 0, 1).astype(np.float32)   # внутри предмета — непрозрачно
    soft = np.clip((250 - mn) / 30, 0, 1)
    ring = ndimage.binary_dilation(alpha > 0.5, iterations=1) & ~ndimage.binary_erosion(alpha > 0.5, iterations=1)
    alpha = np.where(ring, soft, alpha)
    return np.dstack([rgb, alpha * 255]).astype(np.uint8)


def trim(rgba, pad=2):
    a = rgba[..., 3] > 25
    lab, n = ndimage.label(ndimage.binary_dilation(a, iterations=3))
    if n == 0:
        return None
    sizes = ndimage.sum(a, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > max(60, sizes.max() * 0.004)])   # мусор и крошки JPEG — прочь
    rgba = rgba.copy(); rgba[..., 3] = np.where(keep, rgba[..., 3], 0)
    ys, xs = np.nonzero(rgba[..., 3] > 25)
    y0, y1, x0, x1 = max(0, ys.min() - pad), ys.max() + pad + 1, max(0, xs.min() - pad), xs.max() + pad + 1
    return rgba[y0:y1, x0:x1]


def cut_grid(sheet, rows, cols):
    im = np.asarray(Image.open(sheet).convert('RGB')).astype(np.float32)
    H, W = im.shape[:2]
    # границы клеток — по пустым (белым) полосам рядом с равным делением
    def splits(axis, n, size):
        prof = (im.min(-1) < 235).sum(axis=axis).astype(np.float32)
        cuts = [0]
        for k in range(1, n):
            c = size * k / n; lo, hi = int(c - size / n * 0.3), int(c + size / n * 0.3)
            seg = ndimage.uniform_filter1d(prof[lo:hi], 9)
            cuts.append(lo + int(np.argmin(seg)))
        return cuts + [size]
    ry, cx = splits(1, rows, H), splits(0, cols, W)
    out = []
    for r in range(rows):
        for c in range(cols):
            cell = im[ry[r]:ry[r + 1], cx[c]:cx[c + 1]]
            out.append(trim(cutout(cell)))
    return out


def cut_objects(sheet):
    im = np.asarray(Image.open(sheet).convert('RGB')).astype(np.float32)
    rgba = cutout(im)
    lab, n = ndimage.label(ndimage.binary_closing(rgba[..., 3] > 40, iterations=3))
    boxes = [sl for sl in ndimage.find_objects(lab) if sl and (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start) > 400]
    rows = []
    for sl in sorted(boxes, key=lambda s: (s[0].start + s[0].stop) / 2):
        cy = (sl[0].start + sl[0].stop) / 2
        if rows and abs(rows[-1][0] - cy) < (sl[0].stop - sl[0].start) * 0.5:
            rows[-1][1].append(sl)
        else:
            rows.append([cy, [sl]])
    return [trim(rgba[sl]) for _, r in rows for sl in sorted(r, key=lambda s: s[1].start)]


def load_atlas():
    meta = json.loads((OUT / 'life.json').read_text()) if (OUT / 'life.json').exists() else {'frames': {}}
    src = OUT / 'life.webp' if (OUT / 'life.webp').exists() else OUT / 'life.png'
    atlas = Image.open(src).convert('RGBA') if src.exists() else None
    frames = {}
    for k, v in meta.get('frames', {}).items():
        frames[k] = (atlas.crop((v[0], v[1], v[0] + v[2], v[1] + v[3])), (v[4], v[5]))
    return meta, frames


def save_atlas(meta, frames):
    pad, maxw, x, y, rowh, place = 2, 2048, 0, 0, 0, {}
    for nm, (im, anc) in sorted(frames.items(), key=lambda kv: (-kv[1][0].size[1], kv[0])):
        if x + im.size[0] + pad > maxw:
            x, y, rowh = 0, y + rowh + pad, 0
        place[nm] = (x, y, im.size[0], im.size[1], anc); x += im.size[0] + pad; rowh = max(rowh, im.size[1])
    out = Image.new('RGBA', (maxw, y + rowh), (0, 0, 0, 0))
    for nm, (x, y, w, h, anc) in place.items():
        out.paste(frames[nm][0], (x, y))
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / 'life.webp', quality=88, method=6, alpha_quality=90)
    if (OUT / 'life.png').exists():
        (OUT / 'life.png').unlink()
    groups = {}
    for nm, (x, y, w, h, a) in place.items():
        g = group(nm); gw, gh = groups.get(g, (0, 0)); groups[g] = (max(gw, w), max(gh, h))
    meta['size'] = out.size
    meta['frames'] = {k: [x, y, w, h, round(a[0], 3), round(a[1], 3)] for k, (x, y, w, h, a) in sorted(place.items())}
    meta['groups'] = {k: list(v) for k, v in sorted(groups.items())}
    meta.pop('cars', None); meta.pop('coats', None)
    (OUT / 'life.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')))
    return out.size, len(place), (OUT / 'life.webp').stat().st_size


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); return
    sheet, dry = args[0], '--dry' in args
    grid = args[args.index('--grid') + 1] if '--grid' in args else None
    scale = float(args[args.index('--scale') + 1]) if '--scale' in args else 1.0
    skip = {args.index(o) + 1 for o in ('--grid', '--scale') if o in args}
    names = [x for i, x in enumerate(args[1:], 1) if not x.startswith('--') and i not in skip]
    parts = cut_grid(sheet, *map(int, grid.split('x'))) if grid else cut_objects(sheet)
    print('на листе кадров: %d, имён: %d' % (len(parts), len(names)))
    if len(parts) != len(names):
        raise SystemExit('СТОП: число кадров не равно числу имён (сетка %s)' % grid)
    meta, frames = load_atlas()
    for nm, p in zip(names, parts):
        if nm == '-' or p is None:
            continue
        im = Image.fromarray(p, 'RGBA')
        w, h = max(1, round(im.size[0] * scale)), max(1, round(im.size[1] * scale))
        frames[nm] = (im.resize((w, h), Image.LANCZOS), anchor(nm))
        print('  %-24s %4dx%-4d' % (nm, w, h))
    if dry:
        return
    size, n, b = save_atlas(meta, frames)
    print('атлас %dx%d, кадров %d, %d КБ → engine/sprites/life.webp' % (size[0], size[1], n, b // 1024))


if __name__ == '__main__':
    main()
