#!/usr/bin/env python3
"""Пути машин — по середине проезжей части из маски ambient.roads (e1.11, docs/ENGINE-LIFE.md «Рецепт»).

  python3 tools/fit_paths_to_roads.py tests/lenin lenin_2 [--write]

Каждый путь машины кадра переразмечается через ~0,015 высоты кадра; каждая точка сдвигается поперёк пути на середину
дороги (отрезок маски по нормали, до 70 px в обе стороны). Точки за перекрытием или вне маски на всём отрезке остаются как были.
Кольцо (loop) остаётся кольцом. Потом — сглаживание; концы пути, торчащие с дороги, обрезаются. Сама линия — ось дороги; полосы (lane, правостороннее движение)
движок кладёт по обе стороны от неё. Итог проверяет tools/check_roads.py.
"""
import json, sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from building_schema import in_poly  # noqa: E402
from gemini_road_mask import raster  # noqa: E402

ASP = 768 / 1365


def resample(path, loop, step=0.015):
    pts = [list(p) for p in path] + ([list(path[0])] if loop else [])
    out = []
    for (u1, v1), (u2, v2) in zip(pts, pts[1:]):
        L = (((u2 - u1) * ASP) ** 2 + (v2 - v1) ** 2) ** 0.5
        k = max(1, int(L / step))
        out += [[u1 + (u2 - u1) * t / k, v1 + (v2 - v1) * t / k] for t in range(k)]
    if not loop:
        out.append(list(path[-1]))
    return out


def center(m, W, H, pts, loop, reach=70):
    res = []
    n = len(pts)
    for i, (u, v) in enumerate(pts):
        a, b = pts[max(0, i - 1)] if not loop else pts[(i - 1) % n], pts[min(n - 1, i + 1)] if not loop else pts[(i + 1) % n]
        dx, dy = (b[0] - a[0]) * W, (b[1] - a[1]) * H
        L = (dx * dx + dy * dy) ** 0.5 or 1
        nx, ny = -dy / L, dx / L
        x0, y0 = u * W, v * H
        ts = np.arange(-reach, reach + 1)
        xs, ys = np.clip((x0 + nx * ts).round().astype(int), 0, W - 1), np.clip((y0 + ny * ts).round().astype(int), 0, H - 1)
        inside = (x0 + nx * ts >= 0) & (x0 + nx * ts < W) & (y0 + ny * ts >= 0) & (y0 + ny * ts < H)
        on = m[ys, xs] & inside
        if not on.any():
            res.append([u, v]); continue
        idx = np.nonzero(on)[0]
        j = idx[np.argmin(np.abs(ts[idx]))]          # ближайший к точке участок дороги
        lo = j
        while lo > 0 and on[lo - 1]:
            lo -= 1
        hi = j
        while hi < len(ts) - 1 and on[hi + 1]:
            hi += 1
        if lo == 0 or hi == len(ts) - 1:             # край отрезка — дорога шире поиска, не трогаем поперёк
            res.append([u, v]); continue
        t = (ts[lo] + ts[hi]) / 2
        res.append([(x0 + nx * t) / W, (y0 + ny * t) / H])
    return res


def smooth1(pts, loop):
    n = len(pts); out = []
    for i in range(n):
        if not loop and i in (0, n - 1):
            out.append(pts[i]); continue
        a, b, c = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
        out.append([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4])
    return out


def main():
    bdir, name = Path(sys.argv[1]), sys.argv[2]
    txt = open(bdir / 'building.json').read(); b = json.loads(txt)
    fr = [f for f in b['frames'] if f['name'] == name][0]; am = fr['ambient']
    old = '"ambient": ' + json.dumps(am, ensure_ascii=False)
    W, H = 768, 1365
    m = raster(am['roads'], W, H)
    for j, o in enumerate(am.get('cars', [])):
        loop = o.get('loop', False)
        pts = resample(o['path'], loop)
        for _ in range(2):
            pts = smooth1(center(m, W, H, pts, loop), loop)
        if not loop:   # концы пути, торчащие с дороги (не за перекрытием и в кадре), обрезаются — машина появится/исчезнет на дороге
            occ = [q['poly'] for q in am.get('occluders', [])]
            ok = lambda u, v: (not (0 <= u <= 1 and 0 <= v <= 1)) and False or (0 <= u <= 1 and 0 <= v <= 1 and m[min(H - 1, int(v * H)), min(W - 1, int(u * W))]) or any(in_poly(u, v, q) for q in occ)
            lane = o.get('lane', 0.3) * (o['size'][0] + o['size'][1]) / 2
            onm = lambda u, v: 0 <= u <= 1 and 0 <= v <= 1 and m[min(H - 1, int(v * H)), min(W - 1, int(u * W))] or not (0 <= u <= 1 and 0 <= v <= 1)   # концы — только на дороге (или за краем кадра)
            def ok_l(i):   # точка и обе полосы по сторонам
                a, c = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
                dx, dy = (c[0] - a[0]) * ASP, c[1] - a[1]; L = (dx * dx + dy * dy) ** 0.5 or 1
                u, v = pts[i]
                return all(onm(u - sg * dy / L * lane / ASP, v + sg * dx / L * lane) for sg in (1, -1, 0))
            while len(pts) > 3 and not ok_l(0):
                pts = pts[1:]
            while len(pts) > 3 and not ok_l(len(pts) - 1):
                pts = pts[:-1]
        o['path'] = [[round(u, 4), round(v, 4)] for u, v in pts]
        print('%s: машина %d — %d точек по оси дороги' % (name, j + 1, len(pts)))
    if '--write' in sys.argv:
        if txt.count(old) != 1:
            raise SystemExit('СТОП: строка ambient не найдена')
        open(bdir / 'building.json', 'w').write(txt.replace(old, '"ambient": ' + json.dumps(am, ensure_ascii=False)))
        print('записано')


if __name__ == '__main__':
    main()
