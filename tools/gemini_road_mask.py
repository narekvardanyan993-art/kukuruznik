#!/usr/bin/env python3
"""Маска проезжей части из Gemini → ambient.roads (e1.11, docs/ENGINE-LIFE.md «Рецепт»).

  python3 tools/gemini_road_mask.py tests/lenin lenin_2 картинка_gemini.jpg [--own] [--overlay DIR] [--write]

1. В Gemini (pro.gemini.one1) на копии кадра: «paint ONLY the roadway … in pure solid red #FF0000, keep everything else unchanged».
2. Картинка приводится к размеру кадра и совмещается с рисунком: сдвиг и масштаб по осям подбираются по контурам вне красного
   (Gemini слегка перерисовывает и сдвигает кадр).
3. Красное (R > 170, G < 95, B < 95) → маска; чистка мелочи. --own: пересечение с нынешними ambient.roads кадра (свои полигоны
   по путям, расширенные на --grow px, по умолчанию 14) — итог только там, где согласны оба; края дороги — от Gemini.
4. Контуры → многоугольники в долях кадра (кольцо — «замочной скважиной»: внешний контур + дыра обратным ходом).
   --write пишет их в ambient.roads кадра (одна строка ambient в building.json меняется, остальное файла — нет);
   сырая маска Gemini и итог — tests/<здание>/source/roads/<кадр>_gemini.png / _roads.png.
"""
import json, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from building_schema import in_poly  # noqa: E402


def edges(gray):
    g = cv2.GaussianBlur(gray, (0, 0), 1.2)
    mag = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))
    return cv2.GaussianBlur(mag, (0, 0), 2.0)


def align(day, gem, red):
    """Подбор sx, sy, dx, dy: gem (уже в размере кадра) → рисунок. Возвращает матрицу 2×3."""
    H, W = day.shape[:2]
    k = 0.5
    d = cv2.resize(cv2.cvtColor(day, cv2.COLOR_RGB2GRAY).astype(np.float32), None, fx=k, fy=k)
    g = cv2.resize(cv2.cvtColor(gem, cv2.COLOR_RGB2GRAY).astype(np.float32), None, fx=k, fy=k)
    keep = cv2.resize((~red).astype(np.uint8), None, fx=k, fy=k, interpolation=cv2.INTER_NEAREST).astype(bool)
    keep = cv2.erode(keep.astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    ed, eg = edges(d), edges(g)
    best = (-1, None)
    h, w = ed.shape
    def score(sx, sy, dx, dy):
        M = np.float32([[sx, 0, dx + (1 - sx) * w / 2], [0, sy, dy + (1 - sy) * h / 2]])
        wg = cv2.warpAffine(eg, M, (w, h)); wk = cv2.warpAffine(keep.astype(np.uint8), M, (w, h)).astype(bool)
        a, b = ed[wk], wg[wk]
        return float(((a - a.mean()) * (b - b.mean())).mean() / (a.std() * b.std() + 1e-6)) if a.size > 1000 else -1
    for sx in np.arange(0.94, 1.07, 0.02):          # грубо
        for sy in np.arange(0.94, 1.07, 0.02):
            for dx in range(-15, 16, 3):
                for dy in range(-15, 16, 3):
                    c = score(sx, sy, dx, dy)
                    if c > best[0]:
                        best = (c, (sx, sy, dx, dy))
    s0 = best[1]
    for sx in np.arange(s0[0] - 0.015, s0[0] + 0.016, 0.005):   # точно
        for sy in np.arange(s0[1] - 0.015, s0[1] + 0.016, 0.005):
            for dx in range(s0[2] - 2, s0[2] + 3):
                for dy in range(s0[3] - 2, s0[3] + 3):
                    c = score(sx, sy, dx, dy)
                    if c > best[0]:
                        best = (c, (sx, sy, dx, dy))
    sx, sy, dx, dy = best[1]
    M = np.float32([[sx, 0, dx / k + (1 - sx) * W / 2], [0, sy, dy / k + (1 - sy) * H / 2]])
    return M, best[0], best[1]


def polygons(mask, min_area=150):
    W, H = mask.shape[1], mask.shape[0]
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None:
        return out
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1 or cv2.contourArea(c) < min_area:
            continue
        poly = cv2.approxPolyDP(c, 1.6, True)[:, 0, :].tolist()
        ch = hier[i][2]
        while ch != -1:   # дыры: «замочная скважина»
            if cv2.contourArea(cs[ch]) >= min_area:
                hole = cv2.approxPolyDP(cs[ch], 1.6, True)[:, 0, :].tolist()
                poly = poly + [poly[0]] + hole + [hole[0]]
            ch = hier[ch][0]
        out.append([[round(x / W, 4), round(y / H, 4)] for x, y in poly])
    return out


def raster(polys, W, H):
    """Многоугольники (доли кадра) → маска по правилу чёт-нечет (как in_poly: «замочная скважина» даёт дыру)."""
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = (xs + 0.5) / W, (ys + 0.5) / H
    m = np.zeros((H, W), bool)
    for p in polys:
        ins = np.zeros((H, W), bool); n = len(p)
        for k in range(n):
            (x1, y1), (x2, y2) = p[k], p[(k + 1) % n]
            if y1 == y2:
                continue
            cond = ((y1 > v) != (y2 > v)) & (u < x1 + (v - y1) * (x2 - x1) / (y2 - y1))
            ins ^= cond
        m |= ins
    return m


def main():
    a = sys.argv[1:]
    bdir, name, src = Path(a[0]), a[1], a[2]
    out = Path(a[a.index('--overlay') + 1]) if '--overlay' in a else None
    day = np.asarray(Image.open(bdir / 'frames' / (name + '.webp')).convert('RGB'))
    H, W = day.shape[:2]
    gem = np.asarray(Image.open(src).convert('RGB').resize((W, H), Image.LANCZOS))
    R, G, B = [gem[..., i].astype(int) for i in range(3)]
    red = (R > 170) & (G < 95) & (B < 95)
    dR, dG, dB = [day[..., i].astype(int) for i in range(3)]
    red &= ~cv2.dilate(((dR > 140) & (dG < 110) & (dB < 110)).astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)   # красное в самом рисунке (венок, флаги) — не дорога
    M, score, par = align(day, gem, red)
    red_al = cv2.warpAffine(red.astype(np.uint8), M, (W, H), flags=cv2.INTER_NEAREST).astype(bool)
    red_al = cv2.morphologyEx(red_al.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    red_al = cv2.morphologyEx(red_al, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)
    b = json.load(open(bdir / 'building.json'))
    fr = [f for f in b['frames'] if f['name'] == name][0]
    am = fr.get('ambient') or {}
    final = red_al
    if '--own' in a and am.get('roads'):
        own = raster(am['roads'], W, H)
        grow = int(a[a.index('--grow') + 1]) if '--grow' in a else 14   # свои полигоны — грубые, по путям: расширяем, края берём у Gemini
        own = cv2.dilate(own.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1))).astype(bool)
        final = red_al & own
        print('%s: свои полигоны %.1f%% кадра, Gemini %.1f%%, пересечение %.1f%%' % (name, own.mean() * 100, red_al.mean() * 100, final.mean() * 100))
    final = cv2.morphologyEx(final.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))).astype(bool)   # дырки от нарисованных машин/люков на дороге — тоже дорога
    polys = polygons(final)
    print('%s: совмещение sx=%.2f sy=%.2f dx=%d dy=%d (corr %.3f), многоугольников %d, точек %d' % (name, *par, score, len(polys), sum(len(p) for p in polys)))
    sd = bdir / 'source' / 'roads'; sd.mkdir(parents=True, exist_ok=True)
    Image.fromarray((red_al * 255).astype(np.uint8)).save(sd / (name + '_gemini.png'))
    Image.fromarray((final * 255).astype(np.uint8)).save(sd / (name + '_roads.png'))
    if out:
        ov = day.astype(np.float32).copy()
        ov[red_al & ~final] = ov[red_al & ~final] * 0.5 + np.array([255, 60, 60]) * 0.5
        ov[final] = ov[final] * 0.55 + np.array([0, 140, 255]) * 0.45
        out.mkdir(parents=True, exist_ok=True)
        Image.fromarray(ov.astype(np.uint8)).save(out / ('mask_%s.jpg' % name), quality=85)
    if '--write' in a:
        txt = open(bdir / 'building.json').read()
        old = '"ambient": ' + json.dumps(am, ensure_ascii=False)
        if txt.count(old) != 1:
            raise SystemExit('СТОП: строка ambient кадра %s не найдена одной строкой' % name)
        am['roads'] = polys
        open(bdir / 'building.json', 'w').write(txt.replace(old, '"ambient": ' + json.dumps(am, ensure_ascii=False)))
        print('%s: ambient.roads записаны' % name)


if __name__ == '__main__':
    main()
