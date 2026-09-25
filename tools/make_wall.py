#!/usr/bin/env python3
"""Фон-стена просмотрщика на ПК (v12): армянские узоры и знаки вместо нарисованных домиков.

  python3 tools/make_wall.py        # -> test-assets/wall-a.svg, wall-b.svg, wall-ararat.svg

Два варианта на выбор (на странице: ?wall=a или ?wall=b):
  A  «Обои»  — повторяющийся узор (плитка 480×480): орнамент ковра, знак вечности (Аревакхач), гранат, крест-хачкар с розеткой,
              армянские буквы; внизу — силуэт Арарата отдельным слоем (wall-ararat.svg).
  B  «Панно» — одна композиция на всю стену: фриз-орнамент ковра сверху, большие стелы-хачкары с кружевом по бокам,
              знак вечности как солнце над силуэтом Арарата, гранаты и буквы Месропа в поле.

Всё нарисовано линиями (без заливок), цвет — тёплый коричневый с прозрачностью 8–14%: тон в тон с бумагой (#f5ecda), как обои
в музее: узнаётся Армения, но экспонат остаётся главным. Буквы — контуры Noto Serif Armenian (OFL) из welcome-letters.js.
Ничего случайного: скрипт детерминирован (одинаковый результат при каждом запуске).
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-assets'
INK = '#5d4c31'
PAPER = '#f5ecda'   # цвет бумаги страницы

LETTERS = json.loads(re.search(r'\[.*\]', (OUT / 'welcome-letters.js').read_text(encoding='utf-8'), re.S).group(0))


def f(x):
    return ('%.1f' % x).rstrip('0').rstrip('.')


def pts(points):
    return ' '.join('%s,%s' % (f(x), f(y)) for x, y in points)


def path(d, w=1.2, op=1.0, extra=''):
    return '<path d="%s" stroke-width="%s" opacity="%s" %s/>' % (d, f(w), f(op) if op != 1.0 else '1', extra)


def circle(cx, cy, r, w=1.2, op=1.0, fill=False):
    return '<circle cx="%s" cy="%s" r="%s" stroke-width="%s"%s%s/>' % (
        f(cx), f(cy), f(r), f(w), (' opacity="%s"' % f(op)) if op != 1.0 else '', ' fill="%s" fill-opacity="0.9"' % INK if fill else '')


def g(inner, tx=0, ty=0, rot=0, sc=1.0):
    t = 'translate(%s %s)' % (f(tx), f(ty))
    if rot:
        t += ' rotate(%s)' % f(rot)
    if sc != 1.0:
        t += ' scale(%s)' % f(sc)
    return '<g transform="%s">%s</g>' % (t, inner)


# ---------------------------------------------------------------- знаки
def arevakhach(R):
    """Знак вечности: колесо с восемью изогнутыми лучами, два кольца и розетка в центре."""
    out = [circle(0, 0, R, 1.6), circle(0, 0, R * 0.86, 0.8, 0.7), circle(0, 0, R * 0.17, 1.2), circle(0, 0, R * 0.30, 0.8, 0.7)]
    for k in range(8):
        arm = ('M%s 0 C%s %s %s %s %s %s' % (f(R * 0.17), f(R * 0.42), f(-R * 0.02), f(R * 0.74), f(-R * 0.06), f(R * 0.84), f(-R * 0.38)))
        hook = 'M%s %s q%s %s %s %s' % (f(R * 0.84), f(-R * 0.38), f(R * 0.06), f(-R * 0.14), f(-R * 0.08), f(-R * 0.18))
        out.append(g(path(arm, 1.3) + path(hook, 1.0), rot=k * 45))
    return ''.join(out)


def medallion(R):
    """Ковровый медальон (гюль): восьмиконечная звезда, вложенная звезда, розетка и крючки на концах лучей."""
    def star(r1, r2, n=8, rot=0):
        p = []
        for i in range(2 * n):
            a = math.pi * i / n + rot
            r = r1 if i % 2 == 0 else r2
            p.append((r * math.cos(a), r * math.sin(a)))
        return '<polygon points="%s" stroke-width="1.4"/>' % pts(p)
    out = [star(R, R * 0.56), star(R * 0.66, R * 0.36, rot=math.pi / 8), circle(0, 0, R * 0.22, 1.1), circle(0, 0, R * 0.09, 1.0)]
    for k in range(8):
        a = math.pi * 2 * k / 8
        x, y = R * math.cos(a), R * math.sin(a)
        out.append(g(path('M0 0 q%s %s %s %s q%s %s %s %s' % (f(R * 0.10), f(-R * 0.02), f(R * 0.12), f(-R * 0.10), f(-R * 0.02), f(-R * 0.10), f(-R * 0.08), f(-R * 0.06)), 1.0), tx=x, ty=y, rot=math.degrees(a)))
        out.append(circle(R * 0.83 * math.cos(a + math.pi / 8), R * 0.83 * math.sin(a + math.pi / 8), R * 0.035, 0.9))
    return ''.join(out)


def pomegranate(R):
    """Гранат: слегка приплюснутый плод, корона-чашечка на макушке, дольки, зёрна, черешок и листок."""
    top = R * 0.1 - R * 0.92
    out = ['<ellipse cx="0" cy="%s" rx="%s" ry="%s" stroke-width="1.6"/>' % (f(R * 0.1), f(R), f(R * 0.92))]
    # корона: пять зубцов
    crown = [(-0.30, 0.10), (-0.34, -0.22), (-0.17, -0.04), (0, -0.30), (0.17, -0.04), (0.34, -0.22), (0.30, 0.10)]
    out.append('<polyline points="%s" stroke-width="1.3"/>' % pts([(R * x, top + R * y) for x, y in crown]))
    out.append(path('M%s %s Q0 %s %s %s' % (f(-R * 0.30), f(top + R * 0.10), f(top + R * 0.26), f(R * 0.30), f(top + R * 0.10)), 0.9, 0.8))
    # дольки: три дуги от короны вниз
    for k, (cx1, cx2) in enumerate([(-0.55, -0.62), (0.0, 0.0), (0.55, 0.62)]):
        out.append(path('M%s %s C%s %s %s %s %s %s' % (f(R * cx1 * 0.35), f(top + R * 0.28), f(R * cx1 * 1.5), f(-R * 0.2), f(R * cx2 * 1.25), f(R * 0.55), f(R * cx2 * 0.55), f(R * 0.94)), 0.9, 0.75))
    for (x, y) in [(-0.5, 0.05), (-0.25, 0.32), (0.0, 0.08), (0.25, 0.32), (0.5, 0.05), (-0.12, 0.62), (0.16, 0.62), (0.0, -0.3), (-0.55, 0.42), (0.55, 0.42), (-0.32, -0.12), (0.32, -0.12)]:
        out.append(circle(R * x, R * y, R * 0.05, 0.9))
    # черешок и листок
    out.append(path('M%s %s q%s %s %s %s' % (f(R * 0.06), f(top - R * 0.02), f(R * 0.05), f(-R * 0.22), f(R * 0.22), f(-R * 0.3)), 1.1))
    out.append(path('M%s %s C%s %s %s %s %s %s C%s %s %s %s %s %s' % (f(R * 0.28), f(top - R * 0.3), f(R * 0.6), f(top - R * 0.62), f(R * 1.15), f(top - R * 0.42), f(R * 1.3), f(top - R * 0.06), f(R * 0.95), f(top - R * 0.02), f(R * 0.5), f(top - R * 0.06), f(R * 0.28), f(top - R * 0.3)), 1.0))
    out.append(path('M%s %s L%s %s' % (f(R * 0.4), f(top - R * 0.22), f(R * 1.15), f(top - R * 0.16)), 0.7, 0.8))
    return ''.join(out)


def cross_lace(R):
    """Крест-хачкар: равноконечный крест с трилистниками на концах, розеткой посередине и завитками-кружевом по углам."""
    a, b = R * 0.16, R * 0.62   # полуширина руки и длина
    e = R * 0.30                # раскрыв конца руки
    p = [(-a, -b + e * 0.4), (-e, -b), (-e * 0.6, -b - e * 0.9), (0, -b - e * 1.2), (e * 0.6, -b - e * 0.9), (e, -b), (a, -b + e * 0.4)]
    out = []
    # четыре руки: повороты одного «конца» + перекладины
    arm = 'M%s %s L%s %s' % (f(-a), f(-a), f(-a), f(-b + e * 0.4))
    for k in range(4):
        out.append(g('<polyline points="%s" stroke-width="1.3"/>' % pts([(-a, -a * 1.0)] + p + [(a, -a * 1.0)]), rot=k * 90))
        out.append(g(circle(0, -b - e * 0.55, e * 0.24, 0.9), rot=k * 90))
    out.append(circle(0, 0, R * 0.22, 1.2))
    for k in range(8):
        ang = math.pi * 2 * k / 8
        out.append(path('M%s %s Q%s %s %s %s Q%s %s %s %s' % (f(R * 0.06 * math.cos(ang)), f(R * 0.06 * math.sin(ang)), f(R * 0.22 * math.cos(ang - 0.35)), f(R * 0.22 * math.sin(ang - 0.35)), f(R * 0.2 * math.cos(ang)), f(R * 0.2 * math.sin(ang)),
                                                             f(R * 0.18 * math.cos(ang + 0.4)), f(R * 0.18 * math.sin(ang + 0.4)), f(R * 0.06 * math.cos(ang)), f(R * 0.06 * math.sin(ang))), 0.7, 0.8))
    for sx in (-1, 1):
        for sy in (-1, 1):   # завитки в углах между руками
            cx, cy = sx * R * 0.5, sy * R * 0.5
            spiral = []
            for i in range(0, 41):
                t = i / 40.0
                r = R * 0.22 * (1 - t) + 0.01
                th = t * 5.0 * math.pi * (1 if sx * sy > 0 else -1) + (0 if sx > 0 else math.pi)
                spiral.append((cx + r * math.cos(th), cy + r * math.sin(th)))
            out.append('<polyline points="%s" stroke-width="1"/>' % pts(spiral))
    return ''.join(out)


def khachkar(w, h):
    """Стела-хачкар (начало координат — центр низа): арочная плита, внутренняя кайма, крест с розеткой, ниже — плетёное кружево."""
    x0, x1, top = -w / 2, w / 2, -h
    ar = w / 2
    frame = 'M%s 0 L%s %s A%s %s 0 0 1 %s %s L%s 0 Z' % (f(x0), f(x0), f(top + ar), f(ar), f(ar), f(x1), f(top + ar), f(x1))
    m = w * 0.07
    inner = 'M%s %s L%s %s A%s %s 0 0 1 %s %s L%s %s Z' % (f(x0 + m), f(-h * 0.03), f(x0 + m), f(top + ar), f(ar - m), f(ar - m), f(x1 - m), f(top + ar), f(x1 - m), f(-h * 0.03))
    out = ['<path d="%s" fill="%s" stroke="none"/>' % (frame, PAPER), path(frame, 1.8), path(inner, 0.9, 0.8)]   # плита непрозрачная: то, что за ней, не просвечивает
    out.append(g(cross_lace(w * 0.36), tx=0, ty=top + ar + w * 0.10))
    # ниже креста: плетёнка — две встречные волны и точки между ними
    y0 = top + ar + w * 0.62
    band = []
    n = 6
    for row in range(3):
        yy = y0 + row * w * 0.26
        for sgn, op in ((1, 1.0), (-1, 0.9)):
            d = 'M%s %s' % (f(x0 + m * 1.5), f(yy))
            steps = 24
            for i in range(1, steps + 1):
                xx = x0 + m * 1.5 + (w - 3 * m) * i / steps
                d += ' L%s %s' % (f(xx), f(yy + sgn * w * 0.07 * math.sin(math.pi * 2 * n * i / steps / 2 * 1.0)))
            band.append(path(d, 0.9, op))
        for i in range(n):
            band.append(circle(x0 + m * 1.5 + (w - 3 * m) * (i + 0.5) / n, yy, w * 0.018, 0.8))
    out.extend(band)
    # основание — ступени
    out.append(path('M%s 0 L%s %s L%s %s L%s 0' % (f(x0 - w * 0.12), f(x0 - w * 0.12), f(w * 0.06), f(x1 + w * 0.12), f(w * 0.06), f(x1 + w * 0.12)), 1.4))
    return ''.join(out)


def ararat(W, H, fill=True):
    """Силуэт Арарата: малый (слева) и большой (справа) со снежными шапками, седловина между ними, предгорья и штриховка склонов.
    Начало — левый нижний угол, ширина W, высота H."""
    sis = (W * 0.36, H * 0.30)
    masis = (W * 0.68, H * 0.02)
    d = ('M0 %s' + ' C%s %s %s %s %s %s' * 7) % (
        f(H * 0.92),
        f(W * 0.10), f(H * 0.88), f(W * 0.20), f(H * 0.78), f(W * 0.27), f(H * 0.60),           # предгорья и подъём к Сису
        f(W * 0.31), f(H * 0.44), f(W * 0.34), f(sis[1] + H * 0.02), f(sis[0]), f(sis[1]),        # Малый Арарат
        f(W * 0.38), f(sis[1] - H * 0.005), f(W * 0.41), f(H * 0.44), f(W * 0.47), f(H * 0.55),   # спуск в седловину
        f(W * 0.52), f(H * 0.60), f(W * 0.56), f(H * 0.44), f(W * 0.62), f(H * 0.20),             # подъём к Масису
        f(W * 0.65), f(H * 0.08), f(W * 0.66), f(masis[1] + H * 0.005), f(masis[0]), f(masis[1]), # Большой Арарат (плоская вершина)
        f(W * 0.71), f(masis[1] + H * 0.005), f(W * 0.75), f(H * 0.26), f(W * 0.82), f(H * 0.52),
        f(W * 0.90), f(H * 0.76), f(W * 0.96), f(H * 0.88), f(W), f(H * 0.94))
    body = '%s L%s %s L0 %s Z' % (d, f(W), f(H), f(H))
    out = ['<clipPath id="ar-clip"><path d="%s"/></clipPath>' % body]
    if fill:
        out.append('<path d="%s" fill="%s" stroke="none"/>' % (body, PAPER))   # силуэт непрозрачный: узор за ним не просвечивает
    out.append(path(d, 2.0))
    out.append(path(d, 0.8, 0.5, 'transform="translate(2 3)"'))   # лёгкий двойной контур, как у всех линий в рисунке
    # снежные шапки: зубчатая линия чуть ниже вершины
    def cap(cx, top, half, depth, teeth):
        p = []
        for i in range(teeth * 2 + 1):
            x = cx - half + 2 * half * i / (teeth * 2)
            y = top + depth + (depth * 0.7 if i % 2 else 0) + 0.25 * depth * math.sin(i * 1.7)
            p.append((x, y))
        return '<polyline points="%s" stroke-width="1.4"/>' % pts(p)
    out.append('<g clip-path="url(#ar-clip)">%s%s</g>' % (cap(masis[0], masis[1] + H * 0.012, W * 0.115, H * 0.17, 7), cap(sis[0], sis[1] + H * 0.01, W * 0.07, H * 0.12, 5)))
    # штриховка склонов: косые линии, обрезанные силуэтом
    hatch = []
    x = -H
    while x < W + H:
        hatch.append('M%s %s L%s %s' % (f(x), f(H), f(x + H * 0.62), f(0)))
        x += 15
    out.append('<g clip-path="url(#ar-clip)" opacity="0.5">%s</g>' % path(' '.join(hatch), 0.7))
    # хребты
    for (x0, y0, x1, y1) in [(0.60, 0.26, 0.55, 0.62), (0.74, 0.30, 0.80, 0.62), (0.34, 0.36, 0.30, 0.66), (0.40, 0.42, 0.45, 0.58)]:
        out.append(path('M%s %s Q%s %s %s %s' % (f(W * x0), f(H * y0), f((x0 + x1) / 2 * W + W * 0.01), f((y0 + y1) / 2 * H), f(W * x1), f(H * y1)), 0.9, 0.8))
    return ''.join(out)


def letter(i, size):
    """Армянская буква: контур из welcome-letters.js (единицы em·1000, вверх — отрицательные), центр по x, низ — на базовой линии."""
    L = LETTERS[i % len(LETTERS)]
    s = size / 714.0
    return '<path d="%s" transform="translate(%.2f 0) scale(%.5f)" stroke-width="%.1f"/>' % (L['d'], -400 * s, s, 1.1 / s)


def band(w, h):
    """Полоса-кайма ковра: ромбы с вложенными ромбами и «барашковыми рожками», сверху и снизу — узкие рядки."""
    out = [path('M0 0 L%s 0 M0 %s L%s %s' % (f(w), f(h), f(w), f(h)), 1.4), path('M0 %s L%s %s M0 %s L%s %s' % (f(h * 0.14), f(w), f(h * 0.14), f(h * 0.86), f(w), f(h * 0.86)), 0.7, 0.8)]
    step = h * 1.5
    x = step / 2
    while x < w + step:
        cy = h / 2
        r = h * 0.34
        out.append('<polygon points="%s" stroke-width="1.2"/>' % pts([(x, cy - r), (x + r, cy), (x, cy + r), (x - r, cy)]))
        out.append('<polygon points="%s" stroke-width="0.8" opacity="0.8"/>' % pts([(x, cy - r * 0.55), (x + r * 0.55, cy), (x, cy + r * 0.55), (x - r * 0.55, cy)]))
        out.append(circle(x, cy, r * 0.1, 0.8))
        for s in (-1, 1):   # рожки между ромбами
            hx = x + s * step / 2
            out.append(path('M%s %s q%s %s %s %s q%s %s %s %s' % (f(hx), f(cy - r * 0.55), f(s * r * 0.5), f(-r * 0.1), f(s * r * 0.2), f(r * 0.5), f(-s * r * 0.05), f(r * 0.45), f(-s * r * 0.35), f(r * 0.5)), 0.9))
            out.append(path('M%s %s q%s %s %s %s q%s %s %s %s' % (f(hx), f(cy + r * 0.55), f(s * r * 0.5), f(r * 0.1), f(s * r * 0.2), f(-r * 0.5), f(-s * r * 0.05), f(-r * 0.45), f(-s * r * 0.35), f(-r * 0.5)), 0.9))
        x += step
    return ''.join(out)


# ---------------------------------------------------------------- сборка
def svg(w, h, body, op, extra_attrs=''):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" %s>\n'
            '<g fill="none" stroke="%s" stroke-opacity="%s" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g>\n</svg>\n') % (w, h, w, h, extra_attrs, INK, op, body)


def wall_a():
    """Обои: плитка 480×480, бесшовная (элементы на краях нарисованы на обеих сторонах)."""
    T = 480
    parts = []
    # диагональная решётка тонкими линиями между медальонами и знаками вечности
    for (x0, y0, x1, y1) in [(0, 0, 240, 240), (480, 0, 240, 240), (0, 480, 240, 240), (480, 480, 240, 240)]:
        parts.append(path('M%s %s L%s %s' % (x0, y0, x1, y1), 0.7, 0.7, 'stroke-dasharray="2 7"'))
    # медальоны по углам плитки (в каждом из четырёх — общий, чтобы стык был бесшовным)
    for (x, y) in [(0, 0), (T, 0), (0, T), (T, T)]:
        parts.append(g(medallion(66), tx=x, ty=y))
    parts.append(g(arevakhach(58), tx=240, ty=240))
    # гранаты по серединам краёв
    for (x, y) in [(240, 0), (240, T), (0, 240), (T, 240)]:
        parts.append(g(pomegranate(30), tx=x, ty=y + 4))
    # кресты-хачкары в четвертях
    for (x, y) in [(120, 120), (360, 120), (120, 360), (360, 360)]:
        parts.append(g(cross_lace(46), tx=x, ty=y))
    # буквы между ними
    idx = 0
    for (x, y, s) in [(240, 122, 34), (240, 398, 34), (118, 240, 32), (362, 240, 32)]:
        parts.append(g(letter(idx, s), tx=x, ty=y + s * 0.5))
        idx += 3
    # ромбики и точки-«зёрна» по решётке
    for (x, y) in [(120, 0), (360, 0), (120, T), (360, T), (0, 120), (0, 360), (T, 120), (T, 360)]:
        parts.append('<polygon points="%s" stroke-width="1"/>' % pts([(x, y - 8), (x + 8, y), (x, y + 8), (x - 8, y)]))
        parts.append(circle(x, y, 1.6, 1))
    return svg(T, T, '\n'.join(parts), 0.13)


def wall_ararat():
    """Отдельный слой для варианта A: силуэт Арарата вдоль нижнего края (растягивается на всю ширину)."""
    W, H = 1600, 400
    return svg(W, H, g(ararat(W, H - 30), tx=0, ty=30), 0.11, 'preserveAspectRatio="xMidYMax meet"')


def wall_b():
    """Панно на всю стену 1600×1000 (на странице cover — по краям обрезается). Экспонат закрывает середину, поэтому главное —
    в боковых полосах: слева знак вечности, медальон и стела-хачкар, справа Масис со снежной шапкой, гранаты, буквы; сверху и снизу — фризы."""
    W, H = 1600, 1000
    parts = []
    parts.append(g(band(W, 64), tx=0, ty=14))                              # верхний фриз
    parts.append(g(ararat(900, 330), tx=800, ty=H - 84 - 330))             # Арарат: Масис — в правой полосе, Сис и седловина — за экспонатом
    parts.append(g(band(W, 64), tx=0, ty=H - 78))                          # нижний фриз
    parts.append(g(khachkar(150, 400), tx=620, ty=H - 84))                 # стела слева внизу
    parts.append(g(arevakhach(80), tx=630, ty=215))                        # знак вечности слева вверху
    parts.append(g(medallion(46), tx=630, ty=418))                         # ковровый медальон
    for i, x in enumerate((540, 630, 720)):                                # буквы слева под фризом
        parts.append(g(letter(i, 30), tx=x, ty=122))
    for i, x in enumerate((1360, 1450, 1540)):                             # и справа
        parts.append(g(letter(i + 3, 30), tx=x, ty=122))
    parts.append(g(arevakhach(46), tx=1440, ty=230))
    for (x, y, r) in [(1370, 400, 30), (1505, 350, 26), (1450, 480, 32)]:
        parts.append(g(pomegranate(r), tx=x, ty=y))
    return svg(W, H, '\n'.join(parts), 0.12, 'preserveAspectRatio="xMidYMax slice"')


def main():
    for name, content in (('wall-a.svg', wall_a()), ('wall-ararat.svg', wall_ararat()), ('wall-b.svg', wall_b())):
        (OUT / name).write_text(content, encoding='utf-8')
        print(name, len(content) // 1024, 'KB')


if __name__ == '__main__':
    main()
