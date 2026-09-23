#!/usr/bin/env python3
"""Рисует карандашный фон страницы для ПК: контуры старого города (домики с арочными окнами,
балконами, штриховкой, церковь с куполом, кипарисы, холмы, облака). Пишет test-assets/oldtown-bg.svg.
Линии «дрожат», как нарисованные от руки. Фон на странице показывается с прозрачностью ~7%.

  python3 tools/make_bg.py
"""
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'test-assets' / 'oldtown-bg.svg'
W, H = 1600, 1000
R = random.Random(7)
INK = '#2f2a25'
paths = []  # (d, width)


def j(a=1.1):
    return R.uniform(-a, a)


def line(x1, y1, x2, y2, w=1.1, jit=1.0):
    n = max(2, int(math.hypot(x2 - x1, y2 - y1) / 22))
    pts = [(x1 + (x2 - x1) * i / n + j(jit), y1 + (y2 - y1) * i / n + j(jit)) for i in range(n + 1)]
    d = 'M%.1f %.1f' % pts[0] + ''.join(' L%.1f %.1f' % p for p in pts[1:])
    paths.append((d, w))


def poly(points, w=1.1, close=False, jit=1.0):
    for a, b in zip(points, points[1:] + ([points[0]] if close else [])):
        line(a[0], a[1], b[0], b[1], w, jit)


def arc(cx, cy, rx, ry, a0, a1, w=1.0, steps=14):
    pts = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append((cx + rx * math.cos(a) + j(0.5), cy + ry * math.sin(a) + j(0.5)))
    paths.append(('M%.1f %.1f' % pts[0] + ''.join(' L%.1f %.1f' % p for p in pts[1:]), w))


def hatch(x0, y0, x1, y1, gap=6, slope=0.9, w=0.6):
    """Косая штриховка внутри прямоугольника (тень на боковой стене)."""
    x = x0 - (y1 - y0) * slope
    while x < x1:
        xa, ya, xb, yb = x, y1, x + (y1 - y0) * slope, y0
        # обрезка по прямоугольнику
        if xa < x0: ya -= (x0 - xa) / slope; xa = x0
        if xb > x1: yb += (xb - x1) / slope; xb = x1
        if ya > yb and xb > xa:
            line(xa, ya, xb, yb, w, 0.5)
        x += gap


def window(x, y, w, h, arched=True):
    if arched:
        line(x, y + h, x, y + w / 2, 1.0, 0.4)
        line(x + w, y + h, x + w, y + w / 2, 1.0, 0.4)
        arc(x + w / 2, y + w / 2, w / 2, w / 2, 180, 360, 1.0)
        line(x, y + h, x + w, y + h, 1.0, 0.4)
    else:
        poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], 1.0, True, 0.4)
    line(x + w / 2, y + w / 2 if arched else y, x + w / 2, y + h, 0.6, 0.3)


def house(x, base, w, h, s=1.0, style=None):
    style = style or R.choice(['gable', 'flat', 'hip'])
    top = base - h
    poly([(x, base), (x, top), (x + w, top), (x + w, base)], 1.2 * s)
    line(x - 3, base, x + w + 3, base, 1.2 * s)
    if style == 'gable':
        poly([(x - 4, top), (x + w / 2, top - w * 0.32), (x + w + 4, top)], 1.2 * s)
    elif style == 'hip':
        poly([(x - 5, top), (x + w * 0.22, top - w * 0.2), (x + w * 0.78, top - w * 0.2), (x + w + 5, top)], 1.2 * s)
        line(x + w * 0.22, top - w * 0.2, x + w * 0.22, top, 0.7)
    else:
        line(x - 3, top - 5 * s, x + w + 3, top - 5 * s, 1.0 * s)   # парапет плоской крыши
        line(x - 3, top - 5 * s, x - 3, top, 1.0 * s)
        line(x + w + 3, top - 5 * s, x + w + 3, top, 1.0 * s)
    cols = max(2, int(w / (26 * s)))
    rows = max(1, int((h - 30 * s) / (34 * s)))
    ww, wh = 11 * s, 18 * s
    for r in range(rows):
        for c in range(cols):
            wx = x + (c + 0.5) * w / cols - ww / 2
            wy = top + 10 * s + r * 34 * s
            if wy + wh < base - 22 * s:
                window(wx, wy, ww, wh, arched=(R.random() < 0.7))
        if R.random() < 0.5 and r:   # деревянный балкон
            by = top + 10 * s + r * 34 * s + wh + 2
            line(x + 3, by, x + w - 3, by, 1.1 * s, 0.6)
            for k in range(6):
                line(x + 6 + k * (w - 12) / 5, by, x + 6 + k * (w - 12) / 5, by + 5 * s, 0.6, 0.3)
    # дверь-арка
    dx = x + w * R.uniform(0.25, 0.65)
    line(dx, base, dx, base - 22 * s, 1.1 * s, 0.4)
    line(dx + 12 * s, base, dx + 12 * s, base - 22 * s, 1.1 * s, 0.4)
    arc(dx + 6 * s, base - 22 * s, 6 * s, 6 * s, 180, 360, 1.1 * s)
    hatch(x + w * 0.66, top + 4, x + w, base - 2, gap=6 * s + 1)


def church(x, base, s=1.0):
    w, h = 74 * s, 88 * s
    poly([(x, base), (x, base - h), (x + w, base - h), (x + w, base)], 1.3 * s)
    arc(x + w / 2, base - h, w / 2, 26 * s, 180, 360, 1.3 * s)             # барабан
    dome_y = base - h - 26 * s
    arc(x + w / 2, dome_y + 14 * s, 22 * s, 22 * s, 180, 360, 1.3 * s)       # купол
    line(x + w / 2, dome_y - 8 * s, x + w / 2, dome_y - 26 * s, 1.3 * s)
    line(x + w / 2 - 6 * s, dome_y - 19 * s, x + w / 2 + 6 * s, dome_y - 19 * s, 1.3 * s)
    for k in range(3):
        window(x + 12 * s + k * 21 * s, base - h + 14 * s, 9 * s, 24 * s)
    line(x + w / 2 - 9 * s, base, x + w / 2 - 9 * s, base - 30 * s, 1.2 * s)
    line(x + w / 2 + 9 * s, base, x + w / 2 + 9 * s, base - 30 * s, 1.2 * s)
    arc(x + w / 2, base - 30 * s, 9 * s, 9 * s, 180, 360, 1.2 * s)
    hatch(x + w * 0.6, base - h, x + w, base - 2, gap=7 * s)
    # колокольня
    bx = x + w + 10 * s
    poly([(bx, base), (bx, base - h * 1.25), (bx + 22 * s, base - h * 1.25), (bx + 22 * s, base)], 1.2 * s)
    poly([(bx - 3 * s, base - h * 1.25), (bx + 11 * s, base - h * 1.25 - 34 * s), (bx + 25 * s, base - h * 1.25)], 1.2 * s)
    window(bx + 6 * s, base - h * 1.25 + 10 * s, 10 * s, 20 * s)


def cypress(x, base, h, s=1.0):
    pts = [(x, base)]
    for i in range(1, 9):
        t = i / 8
        wid = (1 - abs(2 * t - 0.75)) * 9 * s + 2
        pts.append((x + wid * (1 if i % 2 else -1) * 0.5 + j(0.8), base - h * t))
    pts.append((x, base - h - 6 * s))
    poly(pts, 1.0 * s)
    for k in range(9):
        y = base - h * (0.1 + 0.09 * k)
        line(x - 4 * s, y, x + 3 * s, y - 6 * s, 0.6, 0.4)


def hills(y0, amp, w=0.9, seed=0):
    pts = []
    x = -20
    while x < W + 40:
        pts.append((x, y0 + amp * math.sin(x / 210 + seed) + amp * 0.5 * math.sin(x / 83 + seed * 2)))
        x += 24
    poly(pts, w, jit=0.6)
    for x, y in pts[::3]:  # редкая штриховка склона
        line(x, y + 4, x - 10, y + 22, 0.5, 0.5)


def cloud(cx, cy, s=1.0):
    for k, (dx, dy, r) in enumerate([(-40, 6, 20), (-10, -6, 26), (24, 0, 22), (52, 8, 16)]):
        arc(cx + dx * s, cy + dy * s, r * s, r * s * 0.8, 190, 350, 0.9)
    line(cx - 62 * s, cy + 22 * s, cx + 70 * s, cy + 22 * s, 0.9, 0.8)
    for k in range(6):
        line(cx - 50 * s + k * 20 * s, cy + 22 * s, cx - 44 * s + k * 20 * s, cy + 30 * s, 0.5, 0.4)


def main():
    hills(300, 26, 0.8, 0.3)
    hills(360, 20, 0.7, 1.7)
    for cx, cy, s in [(180, 110, 1.0), (620, 70, 0.8), (1010, 130, 1.1), (1420, 80, 0.9), (330, 220, 0.7), (1240, 240, 0.7)]:
        cloud(cx, cy, s)
    for bx, by in [(880, 60), (905, 78), (935, 52)]:
        arc(bx, by, 9, 5, 200, 340, 0.9, 6)
    # дальний ряд (мельче)
    x = -20
    while x < W:
        w = R.randint(48, 84)
        house(x, 520, w, R.randint(52, 92), 0.55)
        x += w + R.randint(6, 26)
    church(1180, 520, 0.6)
    line(-20, 520, W + 20, 520, 1.0)
    # ближний ряд
    x = -30
    church_at = 300
    while x < W:
        if abs(x - church_at) < 60:
            church(x, 860, 1.05)
            x += 74 * 1.05 * 1.7 + 24
            continue
        w = R.randint(96, 160)
        house(x, 860, w, R.randint(110, 210), 1.0)
        if R.random() < 0.6:
            cypress(x + w + 10, 860, R.randint(120, 200))
            x += 14
        x += w + R.randint(10, 40)
    line(-20, 860, W + 20, 860, 1.4)
    # мостовая и ступени
    for k in range(9):
        y = 872 + k * 13
        line(-20, y, W + 20, y + R.uniform(-2, 2), 0.6, 0.8)
    for k in range(60):
        x0 = R.uniform(0, W)
        y0 = R.uniform(880, 990)
        line(x0, y0, x0 + R.uniform(14, 40), y0 + R.uniform(-2, 2), 0.6, 0.5)
    body = '\n'.join('<path d="%s" stroke-width="%s"/>' % (d, w) for d, w in paths)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" preserveAspectRatio="xMidYMax slice">'
           '<g fill="none" stroke="%s" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g></svg>') % (W, H, INK, body)
    OUT.write_text(svg, encoding='utf-8')
    print('записан', OUT.relative_to(OUT.parent.parent), '%.0f КБ' % (len(svg) / 1024))


if __name__ == '__main__':
    main()
