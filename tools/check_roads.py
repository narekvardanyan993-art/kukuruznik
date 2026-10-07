#!/usr/bin/env python3
"""Маски дорог и пути машин: проверка и оверлей (e1.10, правило Нарека 07.10.2026: машины только по нарисованным улицам).

  python3 tools/check_roads.py tests/lenin                 # доля точек каждого пути машины внутри ambient.roads (или за перекрытием)
  python3 tools/check_roads.py tests/lenin --overlay DIR   # + картинки roads_<кадр>.jpg: маска (голубым), пути машин, перекрытия

Порог — building_schema.ROAD_MIN (98 %). Ошибка (код 1), если хоть один путь ниже порога или у кадра машины без маски.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from building_schema import road_coverage, ROAD_MIN, path_samples, in_poly


def main():
    bdir = Path(sys.argv[1]); out = Path(sys.argv[sys.argv.index('--overlay') + 1]) if '--overlay' in sys.argv else None
    b = json.load(open(bdir / 'building.json')); bad = 0
    for fr in b['frames']:
        am = fr.get('ambient') or {}
        if am.get('cars') and not am.get('roads'):
            print('%s: МАШИНЫ БЕЗ МАСКИ ДОРОГ' % fr['name']); bad += 1
        cov = road_coverage(am) if am.get('roads') else []
        for j, (f, n) in enumerate(cov):
            ok = f >= ROAD_MIN; bad += not ok
            print('%s: машина %d (%s): %.1f%% из %d точек на дороге %s' % (fr['name'], j + 1, am['cars'][j]['preset'], f * 100, n, 'OK' if ok else '— МАЛО'))
        if not am.get('cars'):
            print('%s: машин нет%s' % (fr['name'], ' (маска есть)' if am.get('roads') else ''))
        if out:
            from PIL import Image, ImageDraw
            im = Image.open(bdir / 'frames' / (fr['name'] + '.webp')).convert('RGBA'); W, H = im.size
            ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
            P = lambda q: (q[0] * W, q[1] * H)
            for r in am.get('roads', []):
                d.polygon([P(q) for q in r], fill=(0, 150, 255, 70), outline=(0, 90, 220, 255))
            for o in am.get('occluders', []):
                d.polygon([P(q) for q in o['poly']], fill=(255, 0, 0, 45), outline=(200, 0, 0, 200))
            for o in am.get('cars', []):
                for u, v in path_samples(o['path'], o.get('loop', False), 0.004):
                    inside = any(in_poly(u, v, r) for r in am.get('roads', [])) or any(in_poly(u, v, q['poly']) for q in am.get('occluders', [])) or not (0 <= u <= 1 and 0 <= v <= 1)
                    x, y = P((u, v)); rr = 2.2
                    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 140, 0, 255) if inside else (255, 0, 0, 255))
            img = Image.alpha_composite(im, ov).convert('RGB'); dd = ImageDraw.Draw(img)
            dd.rectangle([0, 0, W, 22], fill=(255, 255, 255)); dd.text((6, 5), '%s  roads (blue) | car paths (orange = on road, red = off) | occluders (red)  %s' % (fr['name'], ' '.join('%.0f%%' % (f * 100) for f, n in cov)), fill=(0, 0, 0))
            out.mkdir(parents=True, exist_ok=True); img.save(out / ('roads_%s.jpg' % fr['name']), quality=85)
    print('ИТОГ: %s' % ('всё на дорогах' if not bad else 'ОШИБКА: %d путей вне дорог' % bad))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
