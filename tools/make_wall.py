#!/usr/bin/env python3
"""Данные для фона-стены просмотрщика на ПК: test-assets/wall-data.js (v12.2). Саму расстановку делает test-assets/wall.js в браузере —
под размер окна, чтобы ни одна буква и ни один символ не попадали под экспонат, панель и стрелки.

  python3 tools/make_wall.py        # -> test-assets/wall-data.js

Буквы — 38 заглавных армянского алфавита, контуры Noto Serif Armenian (SIL Open Font License 1.1; tools/build_wall_letters.py, файл
шрифта test-assets/fonts/NotoSerifArmenian-armenian.woff2). Символы: знак вечности, гранат, фрагмент орнамента хачкара, тонкий силуэт Арарата.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-assets'
INK = '#5d4c31'

LETTERS = [l for l in json.loads((ROOT / 'tools' / 'wall_letters.json').read_text(encoding='utf-8')) if l['d']]


def f(x):
    return ('%.1f' % x).rstrip('0').rstrip('.')


def pts(points):
    return ' '.join('%s,%s' % (f(x), f(y)) for x, y in points)


def path(d, w=1.2, op=1.0, extra=''):
    return '<path d="%s" stroke-width="%s" opacity="%s" %s/>' % (d, f(w), f(op) if op != 1.0 else '1', extra)


def circle(cx, cy, r, w=1.2, op=1.0):
    return '<circle cx="%s" cy="%s" r="%s" stroke-width="%s"%s/>' % (f(cx), f(cy), f(r), f(w), (' opacity="%s"' % f(op)) if op != 1.0 else '')


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




def ararat(W, H):
    """Тонкий силуэт Арарата: Сис слева, Масис справа, седловина; линия контура, короткая линия снежной шапки и два хребта."""
    d = ('M0 %s' + ' C%s %s %s %s %s %s' * 7) % (
        f(H * 0.92),
        f(W * 0.10), f(H * 0.88), f(W * 0.20), f(H * 0.78), f(W * 0.27), f(H * 0.60),
        f(W * 0.31), f(H * 0.44), f(W * 0.34), f(H * 0.32), f(W * 0.36), f(H * 0.30),
        f(W * 0.38), f(H * 0.295), f(W * 0.41), f(H * 0.44), f(W * 0.47), f(H * 0.55),
        f(W * 0.52), f(H * 0.60), f(W * 0.56), f(H * 0.44), f(W * 0.62), f(H * 0.20),
        f(W * 0.65), f(H * 0.08), f(W * 0.66), f(H * 0.025), f(W * 0.68), f(H * 0.02),
        f(W * 0.71), f(H * 0.025), f(W * 0.75), f(H * 0.26), f(W * 0.82), f(H * 0.52),
        f(W * 0.90), f(H * 0.76), f(W * 0.96), f(H * 0.88), f(W), f(H * 0.94))
    o = [path(d, 1.4)]
    # снежные шапки: одна плавная линия ниже вершины
    def cap(cx, top, half, depth):
        p = []
        for i in range(0, 13):
            x = cx - half + 2 * half * i / 12
            y = top + depth * (1.0 + 0.55 * math.sin(i * 2.1) * (1 if i % 2 else 0.35))
            p.append((x, y))
        return path('M' + ' L'.join('%s %s' % (f(x), f(y)) for x, y in p), 0.9, 0.9)
    o.append('<clipPath id="ar-clip"><path d="%s L%s %s L0 %s Z"/></clipPath>' % (d, f(W), f(H), f(H)))
    o.append('<g clip-path="url(#ar-clip)">%s%s</g>' % (cap(W * 0.68, H * 0.02, W * 0.11, H * 0.19), cap(W * 0.36, H * 0.30, W * 0.07, H * 0.11)))
    o.append(path('M%s %s Q%s %s %s %s' % (f(W * 0.60), f(H * 0.30), f(W * 0.56), f(H * 0.46), f(W * 0.54), f(H * 0.60)), 0.7, 0.8))
    o.append(path('M%s %s Q%s %s %s %s' % (f(W * 0.75), f(H * 0.30), f(W * 0.79), f(H * 0.46), f(W * 0.83), f(H * 0.62)), 0.7, 0.8))
    return ''.join(o)


# ---------------------------------------------------------------- данные
def main():
    data = {
        'letters': [[l['adv'], l['d']] for l in LETTERS],
        # символы в своих координатах: r — радиус охватывающего прямоугольника (полуширина, полувысота), для расстановки
        'sym': {
            'arevakhach': {'svg': arevakhach(50), 'w': 104, 'h': 104, 'ox': 0, 'oy': 0},
            'pomegranate': {'svg': pomegranate(30), 'w': 96, 'h': 92, 'ox': 0, 'oy': -6},
            'cross': {'svg': cross_lace(50), 'w': 100, 'h': 110, 'ox': 0, 'oy': 0},
            'ararat': {'svg': ararat(600, 150), 'w': 600, 'h': 150, 'ox': 300, 'oy': 75},
        },
    }
    js = ('/* Генерируется tools/make_wall.py — руками не править. Буквы: Noto Serif Armenian (OFL). */\n'
          'window.WALL_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    (OUT / 'wall-data.js').write_text(js, encoding='utf-8')
    print('wall-data.js', len(js) // 1024, 'KB')


if __name__ == '__main__':
    main()
