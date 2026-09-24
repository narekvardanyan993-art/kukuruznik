#!/usr/bin/env python3
"""Армянские заголовки карандашом (SVG, прозрачный фон) — для hy, где нет подходящего рукописного шрифта.

  python3 tools/build_hy_titles.py

Контуры букв берёт из Noto Sans Armenian (лицензия OFL) через tools/glyph_paths.swift (macOS, CoreText),
рисует их «карандашом»: зернистая графитовая заливка + двойной неровный контур. Пишет test-assets/hy/*.svg.
Тексты — те же, что в CONFIG.UI_I18N (hy). Изменил текст — перезапусти скрипт.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'test-assets' / 'hy'
INK = '#2f2a25'

# имя файла -> строки текста (каждая строка — отдельная линия по центру)
TITLES = {
    'title': ['Կուկուռուզնիկ'],
    'title-year': ['Կուկուռուզնիկ, 1979'],
    'welcome': ['Բարի գալուստ', 'ինտերակտիվ', '«Կուկուռուզնիկ»'],
    'welcome-tap': ['Հպիր՝ սկսելու համար'],
}
# В Noto Sans Armenian нет цифр и знаков препинания — рисуем их одной линией (осевая, штрих STEM), как карандашом.
STEM = 88
MONO = {   # символ: (advance, путь по осевой линии)
    ' ': (300, ''),
    ',': (250, 'M100 -30 L100 -26 C100 50 70 100 20 142'),
    '1': (430, 'M110 -560 L250 -672 L250 -44'),
    '7': (500, 'M70 -656 L430 -656 C350 -450 290 -230 250 -44'),
    '9': (540, 'M420 -470 C420 -585 355 -670 255 -670 C150 -670 90 -590 90 -470 C90 -350 150 -290 255 -290 C355 -290 420 -350 420 -470 C420 -250 350 -60 190 -44'),
    '«': (580, 'M300 -500 L130 -330 L300 -160 M450 -500 L280 -330 L450 -160'),
    '»': (580, 'M130 -500 L300 -330 L130 -160 M280 -500 L450 -330 L280 -160'),
}
TRACK = 14      # межбуквенный интервал, единицы em*1000
LINE = 1120     # шаг строк
TOP, BOT = -790, 270   # от верха заглавных до низа хвостов


def glyphs(text):
    r = subprocess.run(['swift', str(ROOT / 'tools' / 'glyph_paths.swift'), text], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def jit(k, a):
    """Детерминированный «дрожащий» сдвиг -a..a: буквы стоят не по линейке, как от руки."""
    x = (k * 2654435761) & 0xFFFFFFFF
    x ^= x >> 13
    x = (x * 1274126177) & 0xFFFFFFFF
    return ((x & 0xFFFF) / 65535 * 2 - 1) * a


def build(name, lines):
    layout = []          # (x, y, d) для каждой буквы
    widths = []
    for li, text in enumerate(lines):
        gl = glyphs(text)
        for g in gl:
            if g['ch'] in MONO:
                g['adv'], g['mono'] = MONO[g['ch']][0], MONO[g['ch']][1]
        adv = [g['adv'] + TRACK for g in gl]
        widths.append(sum(adv) - TRACK)
        layout.append((li, gl, adv))
    W = max(widths)
    paths, monos = [], []
    k = 0
    for li, gl, adv in layout:
        x = (W - widths[li]) / 2
        y = li * LINE
        for g, a in zip(gl, adv):
            k += 1
            tf = f'translate({x:.1f} {y + jit(k, 14):.1f}) rotate({jit(k + 99, 1.8):.2f} {a / 2:.0f} -300) scale({1 + jit(k + 7, 0.03):.3f})'
            if g.get('mono'):
                monos.append(f'<path transform="{tf}" d="{g["mono"]}"/>')
            elif g['d']:
                paths.append(f'<path transform="{tf}" d="{g["d"]}"/>')
            x += a
    pad = 30
    vx, vy = -pad, TOP - pad
    vw, vh = W + 2 * pad, (TOP * -1 + BOT + (len(lines) - 1) * LINE) + 2 * pad
    body = '\n    '.join(paths)
    mbody = '\n    '.join(monos)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{vw:.0f}" height="{vh:.0f}" viewBox="{vx} {vy} {vw:.0f} {vh:.0f}" role="img">
  <defs>
    <filter id="wob" filterUnits="userSpaceOnUse" x="{vx}" y="{vy}" width="{vw:.0f}" height="{vh:.0f}">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="5" result="w"/>
      <feDisplacementMap in="SourceGraphic" in2="w" scale="16" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="grain" filterUnits="userSpaceOnUse" x="{vx}" y="{vy}" width="{vw:.0f}" height="{vh:.0f}">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="5" result="w"/>
      <feDisplacementMap in="SourceGraphic" in2="w" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.16" numOctaves="2" seed="11" result="g"/>
      <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.8" result="ga"/>
      <feComposite in="d" in2="ga" operator="in"/>
    </filter>
    <g id="L">
    {body}
    </g>
    <g id="M" fill="none" stroke-linecap="round" stroke-linejoin="round">
    {mbody}
    </g>
  </defs>
  <use href="#L" fill="{INK}" filter="url(#grain)"/>
  <use href="#M" stroke="{INK}" stroke-width="{STEM}" filter="url(#grain)"/>
  <use href="#L" fill="none" stroke="{INK}" stroke-width="12" stroke-linejoin="round" filter="url(#wob)" opacity="0.9"/>
  <use href="#M" stroke="{INK}" stroke-width="{STEM + 8}" filter="url(#wob)" opacity="0.3"/>
  <use href="#L" fill="none" stroke="{INK}" stroke-width="5" stroke-linejoin="round" filter="url(#wob)" opacity="0.5" transform="translate(9 6)"/>
</svg>
'''
    (OUT / f'{name}.svg').write_text(svg, encoding='utf-8')
    print(name, f'{vw:.0f}x{vh:.0f}', f'{len(svg)//1024} KB')


LETTERS = 'ԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՈՒՓՔ'   # начало алфавита; в загрузке идут по кругу по одной
LETTERS = LETTERS[:12]                                   # Ա Բ Գ Դ Ե Զ Է Ը Թ Ժ Ի Լ


def build_letters():
    """Контуры букв для анимации загрузки (компонент test-assets/welcome-loader.js)."""
    gl = glyphs(LETTERS)
    items = [{'ch': g['ch'], 'd': g['d']} for g in gl if g['d']]
    js = ('/* Генерируется tools/build_hy_titles.py (контуры Noto Sans Armenian, OFL) — руками не править. */\n'
          'window.WL_LETTERS = ' + json.dumps(items, ensure_ascii=False) + ';\n')
    (ROOT / 'test-assets' / 'welcome-letters.js').write_text(js, encoding='utf-8')
    print('welcome-letters.js', len(items), 'букв', len(js) // 1024, 'KB')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, lines in TITLES.items():
        build(name, lines)
    build_letters()


if __name__ == '__main__':
    main()
