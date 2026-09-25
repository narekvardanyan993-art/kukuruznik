#!/usr/bin/env python3
"""Фон-стена просмотрщика на ПК (v12): армянские узоры и знаки вместо нарисованных домиков.

  python3 tools/make_wall.py        # -> test-assets/wall-a.svg, wall-b.svg, wall-ararat.svg

Два варианта на выбор (на странице: ?wall=a или ?wall=b), v12.1 — «как страница старинной рукописи / гравюры»:
  A  «Рукопись» — страница Матенадарана: мелкий текст Месропа (алфавит строками), рамка-плетёнка, большая заглавная буква,
                  буквы из птиц (թռչնագիр), врезки: хачкар, капитель Звартноца, табличка клинописи Эребуни, Арарат, гранаты.
  B  «Гравюра»  — каменная кладка с гравюрной штриховкой; в нишах — фрагменты хачкаров, капители Звартноца, клинопись Эребуни,
                  знак вечности; вверху фриз из птичьих букв, внизу гравюра Арарата.

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

LETTERS = json.loads((ROOT / 'tools' / 'wall_letters.json').read_text(encoding='utf-8'))   # 38 заглавных букв, контуры Noto Serif Armenian (OFL): tools/glyph_paths.swift
LETTERS = [l for l in LETTERS if l['d']]
ALPHA = 'ԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖ'


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


# ---------------------------------------------------------------- буквы, птицы, капитель, клинопись
GL = {ch: l for ch, l in zip([l['ch'] for l in LETTERS], LETTERS)}


def defs_letters():
    """Все буквы один раз в <defs> (контур постоянной толщины, не зависит от масштаба), дальше — <use>."""
    return '<defs>' + ''.join('<path id="L%d" d="%s" vector-effect="non-scaling-stroke"/>' % (i, l['d']) for i, l in enumerate(LETTERS)) + '</defs>'


def L(i, size, x, y, rot=0, w=0.8, op=1.0):
    """Буква i высотой size, центр по x в точке x, низ — на y (базовая линия)."""
    l = LETTERS[i % len(LETTERS)]
    sc = size / 714.0
    t = 'translate(%s %s)' % (f(x), f(y))
    if rot:
        t += ' rotate(%s)' % f(rot)
    t += ' translate(%s 0) scale(%.5f)' % (f(-l['adv'] * sc / 2), sc)
    return '<use href="#L%d" transform="%s" stroke-width="%s"%s/>' % (i % len(LETTERS), t, f(w), (' opacity="%s"' % f(op)) if op != 1.0 else '')


def text_row(y, size, start, x0, x1, gap=0.28, w=0.7):
    """Строка мелкого текста Месропа: алфавит подряд, начиная с буквы start."""
    out, x, k = [], x0, start
    while True:
        l = LETTERS[k % len(LETTERS)]
        adv = l['adv'] * size / 714.0
        if x + adv > x1:
            break
        out.append(L(k, size, x + adv / 2, y, w=w))
        x += adv + size * gap
        k += 1
    return ''.join(out)


def bird(s=1.0):
    """Птица (вид сбоку, смотрит вправо, начало координат — между лапок): тело, шея с гребешком, клюв, крыло чешуйками, хвост веером."""
    o = [path('M-14 -12 C-15 -25 4 -28 11 -19 C13 -16 13 -11 8 -8 C2 -4 -8 -4 -14 -12 Z', 1.3),
         path('M9 -20 C10 -25 12 -28 15 -28 C19 -28 20 -24 18 -22', 1.1), circle(15.4, -25.6, 0.9, 0.9),
         path('M18.6 -25 L26 -23 L18.8 -22', 1.1), path('M13 -28.6 q1 -5 5 -4.6 M12 -28 q-1 -4 -4.6 -4', 0.9),
         path('M-8 -15 q4 -7 10 -4 M-6 -11 q4 -6 10 -3 M-11 -13 q2 -5 6 -5', 0.9, 0.9),
         path('M-14 -12 L-31 -19 M-14 -10 L-33 -13 M-13 -9 L-31 -6 M-13 -8 L-27 -1', 1.0),
         path('M-30 -19 q-2 3 1 5 M-32 -13 q-2 3 1 4', 0.7, 0.8),
         path('M-2 -5 L-3 3 L-6 3 M4 -6 L5 3 L2 3', 1.0)]
    return g(''.join(o), sc=s)


def bird_letter(i, size, x, y, flip=False):
    """Буква из птиц (թռչնագիր) — в духе рукописей Матенадарана: контур буквы, на её верхнем конце птица, у основания клюющая птичка,
    от концов штрихов — хвостовые перья-завитки."""
    l = LETTERS[i % len(LETTERS)]
    sc = size / 714.0
    o = [L(i, size, 0, 0, w=1.0)]
    top = -size
    o.append(g(bird(size / 60.0), tx=-size * 0.05, ty=top + size * 0.02))
    o.append(g(bird(size / 100.0), tx=size * 0.3, ty=size * 0.02, sc=-1.0 if False else 1.0))
    for k in range(3):   # перья-завитки вниз слева и справа
        o.append(path('M%s 0 q%s %s %s %s q%s %s %s %s' % (f(-l['adv'] * sc * 0.42), f(-size * 0.06), f(size * 0.12), f(-size * 0.04 - k * size * 0.04), f(size * 0.24), f(size * 0.03), f(size * 0.06), f(-size * 0.03), f(size * 0.1)), 0.8, 0.8))
    if flip:
        return g(''.join(o), tx=x, ty=y, sc=1.0)
    return g(''.join(o), tx=x, ty=y)


def capital(w):
    """Капитель Звартноца (начало — центр низа шейки): абака, две волюты, пальметта, орлиная голова, астрагал с жемчужинами."""
    h = w * 0.62
    o = [path('M%s %s L%s %s L%s %s L%s %s Z' % (f(-w / 2), f(-h), f(w / 2), f(-h), f(w / 2), f(-h + w * 0.13), f(-w / 2), f(-h + w * 0.13)), 1.4),   # абака
         path('M%s %s L%s %s' % (f(-w / 2 + 3), f(-h + w * 0.05), f(w / 2 - 3), f(-h + w * 0.05)), 0.7, 0.8)]
    for sx in (-1, 1):   # волюты
        cx, cy = sx * w * 0.36, -h + w * 0.33
        sp = []
        for i in range(0, 46):
            t = i / 45.0
            r = w * 0.15 * (1 - t) + 0.3
            th = t * 5.2 * math.pi * (1 if sx < 0 else -1) + (math.pi if sx < 0 else 0)
            sp.append((cx + r * math.cos(th), cy + r * math.sin(th)))
        o.append('<polyline points="%s" stroke-width="1.1"/>' % pts(sp))
        o.append(path('M%s %s C%s %s %s %s %s %s' % (f(sx * w * 0.5), f(-h + w * 0.13), f(sx * w * 0.5), f(-h + w * 0.3), f(sx * w * 0.5), f(-h + w * 0.42), f(sx * w * 0.3), f(-w * 0.13)), 1.1))
    for k in range(-3, 4):   # пальметта: веер листьев
        a = k * 0.34
        o.append(path('M0 %s Q%s %s %s %s Q%s %s 0 %s' % (f(-w * 0.14), f(w * 0.05 * math.sin(a) - w * 0.06), f(-w * 0.3), f(w * 0.2 * math.sin(a)), f(-w * 0.42 * math.cos(a) - w * 0.04), f(w * 0.05 * math.sin(a) + w * 0.06), f(-w * 0.3), f(-w * 0.14)), 0.9, 0.9))
    o.append(path('M%s %s Q0 %s %s %s' % (f(-w * 0.2), f(-w * 0.13), f(-w * 0.03), f(w * 0.2), f(-w * 0.13)), 0.9))
    # орёл: голова с крючковатым клювом
    e = w * 0.09
    o.append(circle(0, -w * 0.26, e, 1.0)); o.append(path('M%s %s q%s %s %s %s q%s %s %s %s' % (f(e * 0.6), f(-w * 0.26), f(e * 1.3), f(-e * 0.2), f(e * 1.2), f(e * 0.9), f(-e * 0.5), f(-e * 0.3), f(-e * 1.0), f(-e * 0.2)), 0.9))
    o.append(circle(-e * 0.15, -w * 0.28, e * 0.14, 0.8)); o.append(path('M%s %s q%s %s %s %s' % (f(-e * 0.9), f(-w * 0.34), f(-e * 0.3), f(-e * 0.7), f(-e * 0.9), f(-e * 0.7)), 0.8))
    for sx in (-1, 1):   # крылья по бокам
        o.append(path('M%s %s q%s %s %s %s M%s %s q%s %s %s %s' % (f(sx * e * 1.1), f(-w * 0.24), f(sx * e * 1.6), f(-e * 0.4), f(sx * e * 2.6), f(e * 0.9), f(sx * e * 1.1), f(-w * 0.2), f(sx * e * 1.6), f(-e * 0.1), f(sx * e * 2.4), f(e * 1.2)), 0.8, 0.9))
    for k in range(9):   # астрагал — ряд жемчужин
        o.append(circle(-w * 0.36 + w * 0.72 * k / 8.0, -w * 0.06, w * 0.02, 0.8))
    o.append(path('M%s %s L%s %s M%s %s L%s %s' % (f(-w * 0.38), f(-w * 0.11), f(w * 0.38), f(-w * 0.11), f(-w * 0.38), f(-w * 0.01), f(w * 0.38), f(-w * 0.01)), 0.9))
    o.append(path('M%s 0 L%s %s M%s 0 L%s %s' % (f(-w * 0.3), f(-w * 0.3), f(w * 0.22), f(w * 0.3), f(w * 0.3), f(w * 0.22)), 1.2))   # верх колонны
    return ''.join(o)


def wedge(x, y, ang, ln, wd=2.6):
    """Клин клинописи: треугольная головка и тонкий хвост."""
    ca, sa = math.cos(ang), math.sin(ang)
    hx, hy = x, y
    p1 = (hx - sa * wd, hy + ca * wd)
    p2 = (hx + sa * wd, hy - ca * wd)
    tip = (hx + ca * ln, hy + sa * ln)
    return '<polygon points="%s" stroke-width="0.9"/>' % pts([p1, p2, tip])


def cuneiform(w, h, seed=1):
    """Табличка урартской клинописи Эребуни: рамка, строки условных знаков из клиньев (вертикальные, горизонтальные, углом)."""
    R = seed * 9973
    def rnd():
        nonlocal R
        R = (R * 1103515245 + 12345) & 0x7fffffff
        return R / 0x7fffffff
    o = ['<path d="%s" fill="%s" stroke="none"/>' % ('M6 0 H%s q6 0 6 6 V%s q0 6 -6 6 H6 q-6 0 -6 -6 V6 q0 -6 6 -6 Z' % (f(w - 6), f(h - 6)), PAPER),
         path('M6 0 H%s q6 0 6 6 V%s q0 6 -6 6 H6 q-6 0 -6 -6 V6 q0 -6 6 -6 Z' % (f(w - 6), f(h - 6)), 1.5),
         path('M9 9 H%s V%s H9 Z' % (f(w - 9), f(h - 9)), 0.7, 0.8)]
    rows = max(2, int((h - 24) / 22))
    for r in range(rows):
        y = 16 + r * 22
        o.append(path('M12 %s H%s' % (f(y + 15), f(w - 12)), 0.5, 0.7))
        x = 14
        while x < w - 30:
            n = 1 + int(rnd() * 3)
            for k in range(n):
                kind = int(rnd() * 4)
                ang = (0.0, math.pi / 2, math.pi / 4, math.pi * 0.05)[kind] + (math.pi / 2 if kind == 0 else 0)
                wx, wy = x + k * 6.5, y + 6 + rnd() * 4
                o.append(wedge(wx, wy, (math.pi / 2) if kind in (0, 1) else (0.0 if kind == 2 else math.pi / 4), 8 + rnd() * 5, 2.2))
            x += n * 6.5 + 8
    return ''.join(o)


def vine(w, amp=10, k=6):
    """Лоза: волна с завитками и листьями вдоль линии (кайма для рамок)."""
    d = 'M0 0'
    o = []
    for i in range(k):
        x0 = w * i / k
        x1 = w * (i + 1) / k
        o.append(path('M%s 0 C%s %s %s %s %s 0' % (f(x0), f(x0 + (x1 - x0) * 0.3), f(-amp * 1.6), f(x0 + (x1 - x0) * 0.7), f(amp * 1.6), f(x1)), 1.1))
        cx = (x0 + x1) / 2
        o.append(path('M%s %s q%s %s %s %s' % (f(cx), f(0), f(amp * 0.6), f(-amp), f(amp * 1.4), f(-amp * 0.7)), 0.9))
        o.append(circle(cx + amp * 1.2, -amp * 0.5, amp * 0.28, 0.8))
    return ''.join(o)


def braid(w, h=14):
    """Плетёнка: две волны со сдвигом, между ними точки."""
    o = []
    n = max(2, int(w / (h * 2.2)))
    for sgn in (1, -1):
        d = 'M0 %s' % f(h / 2)
        for i in range(1, n * 8 + 1):
            d += ' L%s %s' % (f(w * i / (n * 8)), f(h / 2 + sgn * h * 0.42 * math.sin(math.pi * 2 * n * i / (n * 8))))
        o.append(path(d, 1.0))
    for i in range(n):
        o.append(circle(w * (i + 0.25) / n, h / 2, h * 0.09, 0.8))
    o.append(path('M0 0 H%s M0 %s H%s' % (f(w), f(h), f(w)), 0.7, 0.8))
    return ''.join(o)


def svg(w, h, body, op, extra_attrs=''):
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 %d %d" width="%d" height="%d" %s>\n%s\n'
            '<g fill="none" stroke="%s" stroke-opacity="%s" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g>\n</svg>\n') % (w, h, w, h, extra_attrs, defs_letters(), INK, op, body)


def paper_rect(x, y, w, h):
    """Непрозрачная бумага под врезкой: текст и узор за ней не просвечивают."""
    return '<rect x="%s" y="%s" width="%s" height="%s" fill="%s" stroke="none"/>' % (f(x), f(y), f(w), f(h), PAPER)


def framed(x, y, w, h, inner, pad=6):
    """Врезка в рамке: бумага, двойная рамка, содержимое внутри."""
    return (paper_rect(x - 8, y - 8, w + 16, h + 16) + path('M%s %s h%s v%s h%s Z' % (f(x - 5), f(y - 5), f(w + 10), f(h + 10), f(-w - 10)), 1.3)
            + path('M%s %s h%s v%s h%s Z' % (f(x - 2), f(y - 2), f(w + 4), f(h + 4), f(-w - 4)), 0.6, 0.8) + g(inner, tx=x, ty=y))


# ---------------------------------------------------------------- варианты
def wall_a():
    """A «Рукопись»: страница со строками мелкого текста Месропа, рамкой-плетёнкой, врезками и буквами из птиц."""
    W, H = 1600, 1000
    P = []
    # строки текста: три варианта строки повторяются (каждая — свой сдвиг алфавита)
    rows = ''.join('<g id="row%d">%s</g>' % (k, text_row(0, 13, k * 7, 40, W - 40, w=0.7)) for k in range(3))
    P.append('<defs>%s</defs>' % rows)
    y = 62
    n = 0
    while y < H - 60:
        P.append('<use href="#row%d" transform="translate(0 %d)" opacity="0.8"/>' % (n % 3, y))
        y += 25; n += 1
    # рамка: двойная линия и плетёнка по краю страницы
    P.append(paper_rect(0, 0, W, 40)); P.append(paper_rect(0, H - 44, W, 44)); P.append(paper_rect(0, 0, 32, H)); P.append(paper_rect(W - 32, 0, 32, H))
    P.append(path('M18 18 H%s V%s H18 Z' % (W - 18, H - 18), 1.4)); P.append(path('M26 26 H%s V%s H26 Z' % (W - 26, H - 26), 0.7, 0.8))
    P.append(g(braid(W - 90, 12), tx=45, ty=H - 40))
    # заглавная буква Ա (боковая полоса слева от экспоната): врезка с птицами и лозой
    P.append(framed(520, 90, 200, 250, g(bird_letter(0, 150, 100, 200), 0, 0) + g(vine(180, 8, 5), tx=10, ty=232) + g(vine(180, 8, 5), tx=10, ty=20)))
    # хачкар-фрагмент и капитель Звартноца слева
    P.append(framed(520, 400, 100, 250, g(khachkar(88, 236), tx=50, ty=244)))
    P.append(framed(640, 420, 100, 120, g(capital(88), tx=50, ty=108)))
    P.append(framed(640, 590, 100, 70, g(cross_lace(28), tx=50, ty=36)))
    # клинопись Эребуни и знак вечности справа
    P.append(framed(1300, 90, 250, 110, cuneiform(250, 110, 3)))
    P.append(framed(1300, 240, 110, 110, g(arevakhach(46), tx=55, ty=55)))
    P.append(framed(1440, 240, 110, 110, g(pomegranate(30), tx=55, ty=66)))
    # буквы из птиц — ряд справа
    for k, i in enumerate((3, 9, 1)):
        P.append(framed(1300 + k * 86, 400, 76, 110, bird_letter(i, 64, 38, 88)))
    P.append(framed(1300, 550, 250, 110, g(medallion(46), tx=125, ty=55)))
    # Арарат — гравюра внизу справа и слева, обрезается краем
    P.append(framed(520, 720, 250, 170, g(ararat(240, 160), tx=5, ty=5)))
    P.append(framed(1300, 720, 250, 170, g(ararat(240, 160, ), tx=5, ty=5)))
    return svg(W, H, '\n'.join(P), 0.16, 'preserveAspectRatio="xMidYMid slice"')


def wall_b():
    """B «Гравюра»: каменная кладка с гравюрной штриховкой; ниши с хачкарами, капителями, клинописью и знаком вечности; фриз птичьих букв; Арарат."""
    W, H = 1600, 1000
    P = []
    bw, bh = 130, 58
    seed = 7
    def rnd():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
    y = 0
    row = 0
    while y < H:
        x = -(bw // 2) * (row % 2)
        while x < W:
            P.append(path('M%s %s h%s v%s h%s Z' % (f(x), f(y), f(bw), f(bh), f(-bw)), 0.7, 0.9))
            for k in range(int(3 + rnd() * 5)):   # гравюрная штриховка на камне: короткие косые штрихи, гуще у нижнего края
                hx, hy = x + 8 + rnd() * (bw - 16), y + bh * (0.35 + rnd() * 0.6)
                P.append(path('M%s %s l%s %s' % (f(hx), f(hy), f(6 + rnd() * 8), f(-4 - rnd() * 4)), 0.5, 0.7))
            x += bw
        y += bh; row += 1
    # фриз птичьих букв вверху и плетёнка
    P.append(paper_rect(0, 0, W, 100))
    P.append(path('M0 92 H%s M0 98 H%s' % (W, W), 1.2)); P.append(g(braid(W, 12), ty=76))
    for k in range(0, 17):
        P.append(bird_letter((k * 5 + 1) % len(LETTERS), 44, 60 + k * 96, 60))
    # ниши слева: хачкар, капитель, клинопись
    P.append(framed(510, 150, 130, 330, g(khachkar(118, 316), tx=65, ty=322)))
    P.append(framed(670, 150, 110, 150, g(capital(96), tx=55, ty=136)))
    P.append(framed(670, 335, 110, 145, cuneiform(110, 145, 5)))
    # справа
    P.append(framed(1310, 150, 240, 170, cuneiform(240, 170, 11)))
    P.append(framed(1310, 350, 110, 130, g(arevakhach(48), tx=55, ty=65)))
    P.append(framed(1440, 350, 110, 130, g(capital(96), tx=55, ty=118)))
    P.append(framed(1310, 510, 240, 60, g(vine(220, 8, 6), tx=10, ty=30)))
    # Арарат: гравюра на нижнем поле, широкая; под ней фриз-плетёнка
    P.append(paper_rect(0, 640, W, 360))
    P.append(g(ararat(1500, 330), tx=50, ty=650))
    P.append(paper_rect(0, 970, W, 30)); P.append(g(braid(W, 12), ty=978))
    for k, i in enumerate((0, 1, 2, 4)):   # четыре буквы из птиц на переднем плане, слева и справа от экспоната
        P.append(bird_letter(i, 60, 530 + k * 66, 950))
        P.append(bird_letter(i + 8, 60, 1330 + k * 60, 950))
    return svg(W, H, '\n'.join(P), 0.15, 'preserveAspectRatio="xMidYMid slice"')


def main():
    for name, content in (('wall-a.svg', wall_a()), ('wall-b.svg', wall_b())):
        (OUT / name).write_text(content, encoding='utf-8')
        print(name, len(content) // 1024, 'KB')


if __name__ == '__main__':
    main()
