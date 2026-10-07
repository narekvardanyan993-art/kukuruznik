#!/usr/bin/env python3
"""Приёмка листа спрайтов из Gemini (Nano Banana) в атлас движка engine/sprites/life.png + life.json (e1.10).

  python3 tools/sprites_intake.py лист.png car_volga_0 car_volga_1 car_moskvich_0 ...   # имена — по порядку: ряды сверху вниз, в ряду слева направо
  python3 tools/sprites_intake.py лист.png --names-file имена.txt
  --dry   ничего не записывать, только показать, что нашлось (и лист разметки docs/_intake/sprites-<лист>.png)

Как готовить лист в Gemini (только pro.gemini.one1): «sprite sheet on plain white background, pencil sketch with hatching and light
watercolor, Soviet 1960–80s, <объекты> in a grid, each separate, no overlap, same scale, side/three-quarter view ...» — подсказки
по каждому виду в docs/ENGINE-LIFE.md «Спрайты». Белый фон убирается (и тени на белом — мягко), каждый объект — отдельный кадр,
приводится к размеру кадра своего вида (как в tools/make_life_sprites.py), якорь — по виду (машина — центр, пешеход/птица — опора).
Кадры с теми же именами заменяются, остальные в атласе остаются. Число найденных объектов должно совпасть с числом имён — иначе стоп.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'engine' / 'sprites'
# вид -> (ширина кадра, высота кадра или None — по пропорции, якорь)
KIND = {'car_trolley': (200, None, (0.5, 0.5)), 'car_': (100, None, (0.5, 0.45)), 'walk_': (None, 64, (0.5, 0.97)),
        'pigeon_sit': (56, None, (0.45, 0.95)), 'pigeon_peck': (56, None, (0.45, 0.95)), 'pigeon_': (64, None, (0.5, 0.55)),
        'sparrow_': (40, None, (0.45, 0.96)), 'swallow_': (56, None, (0.55, 0.47))}


def kind_of(name):
    for k in KIND:
        if name.startswith(k):
            return KIND[k]
    raise SystemExit('СТОП: неизвестный вид кадра %s (известны: %s)' % (name, ', '.join(KIND)))


def cut(sheet):
    a = np.asarray(Image.open(sheet).convert('RGB')).astype(np.float32)
    mn = a.min(-1)
    alpha = np.clip((250 - mn) / 40, 0, 1)                                 # белый фон → прозрачно, мягкий край
    bgc = ndimage.binary_dilation(alpha < 0.05, iterations=1)
    lab_bg, _ = ndimage.label(bgc)
    border = set(np.unique(np.concatenate([lab_bg[0], lab_bg[-1], lab_bg[:, 0], lab_bg[:, -1]]))) - {0}
    outside = np.isin(lab_bg, list(border))
    alpha = np.where(outside, 0, np.maximum(alpha, 0.0))                   # белое внутри предмета (стёкла, блики) остаётся
    obj = ndimage.binary_closing(alpha > 0.15, iterations=3)
    lab, n = ndimage.label(obj)
    boxes = [sl for sl in ndimage.find_objects(lab) if sl and (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start) > 400]
    rows = []
    for sl in sorted(boxes, key=lambda s: (s[0].start + s[0].stop) / 2):
        cy = (sl[0].start + sl[0].stop) / 2
        if rows and abs(rows[-1][0] - cy) < (sl[0].stop - sl[0].start) * 0.5:
            rows[-1][1].append(sl)
        else:
            rows.append([cy, [sl]])
    order = [sl for _, r in rows for sl in sorted(r, key=lambda s: s[1].start)]
    rgba = np.dstack([a / 255, alpha]).astype(np.float32)
    return [Image.fromarray((rgba[sl] * 255).astype(np.uint8), 'RGBA') for sl in order], order


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); return
    sheet = args[0]; dry = '--dry' in args
    names = Path(args[args.index('--names-file') + 1]).read_text().split() if '--names-file' in args else [x for x in args[1:] if not x.startswith('--')]
    parts, boxes = cut(sheet)
    print('на листе объектов: %d, имён: %d' % (len(parts), len(names)))
    if len(parts) != len(names):
        raise SystemExit('СТОП: число объектов не равно числу имён — проверь лист (объекты не должны касаться друг друга) или список имён')
    meta = json.loads((OUT / 'life.json').read_text()) if (OUT / 'life.json').exists() else {'frames': {}}
    atlas = Image.open(OUT / 'life.png').convert('RGBA') if (OUT / 'life.png').exists() else Image.new('RGBA', (1024, 1))
    frames = {k: (atlas.crop((v[0], v[1], v[0] + v[2], v[1] + v[3])), (v[4], v[5])) for k, v in meta['frames'].items()}
    for nm, im in zip(names, parts):
        w, h, anc = kind_of(nm)
        if w and not h:
            h = max(1, round(im.size[1] * w / im.size[0]))
        elif h and not w:
            w = max(1, round(im.size[0] * h / im.size[1]))
        frames[nm] = (im.resize((w, h), Image.LANCZOS), anc)
        print('  %-22s %4dx%-4d из %dx%d' % (nm, w, h, im.size[0], im.size[1]))
    if dry:
        return
    pad, maxw, x, y, rowh, place = 2, 1024, 0, 0, 0, {}
    for nm, (im, anc) in sorted(frames.items(), key=lambda kv: -kv[1][0].size[1]):
        if x + im.size[0] + pad > maxw:
            x, y, rowh = 0, y + rowh + pad, 0
        place[nm] = (x, y, im.size[0], im.size[1], anc); x += im.size[0] + pad; rowh = max(rowh, im.size[1])
    out = Image.new('RGBA', (maxw, y + rowh), (0, 0, 0, 0))
    for nm, (x, y, w, h, anc) in place.items():
        out.paste(frames[nm][0], (x, y))
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / 'life.png', optimize=True)
    meta['size'] = out.size
    meta['frames'] = {k: [x, y, w, h, round(a[0], 3), round(a[1], 3)] for k, (x, y, w, h, a) in sorted(place.items())}
    (OUT / 'life.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')))
    print('атлас %dx%d, кадров %d → engine/sprites/' % (out.size[0], out.size[1], len(place)))


if __name__ == '__main__':
    main()
