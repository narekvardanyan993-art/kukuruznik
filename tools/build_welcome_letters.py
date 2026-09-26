#!/usr/bin/env python3
"""Контуры букв для анимации загрузки (компонент test-assets/welcome-loader.js) -> test-assets/welcome-letters.js.

  python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli skia-pathops
  /tmp/fontvenv/bin/python tools/build_welcome_letters.py

Шрифт — Noto Serif Armenian (SIL Open Font License 1.1, https://openfontlicense.org): тот самый файл, что лежит в проекте,
test-assets/fonts/NotoSerifArmenian-armenian.woff2 (лицензия — test-assets/fonts/LICENSE.txt), стандартный вес 400.
Системные шрифты macOS не используются (прежний tools/glyph_paths.swift, читавший /System/Library/Fonts, удалён).
Начало армянского алфавита Ա Բ Գ Դ Ե Զ Է Ը Թ Ժ Ի Լ; на странице буквы прорисовываются карандашной линией по одной.
Координаты — em·1000, ось y вверх отрицательными числами.
"""
import json
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
LETTERS = 'ԱԲԳԴԵԶԷԸԹԺԻԼ'


def main():
    font = TTFont(ROOT / 'test-assets' / 'fonts' / 'NotoSerifArmenian-armenian.woff2')
    font = instantiateVariableFont(font, {'wght': 400})   # переменный шрифт -> обычный вес 400
    removeOverlaps(font)                                   # склеить налегающие контуры (иначе внутри буквы видны лишние линии)
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    items = []
    for ch in LETTERS:
        pen = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
        gs[cmap[ord(ch)]].draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
        items.append({'ch': ch, 'd': pen.getCommands()})
    js = ('/* Генерируется tools/build_welcome_letters.py (контуры Noto Serif Armenian, SIL OFL 1.1) — руками не править. */\n'
          'window.WL_LETTERS = ' + json.dumps(items, ensure_ascii=False) + ';\n')
    (ROOT / 'test-assets' / 'welcome-letters.js').write_text(js, encoding='utf-8')
    print('welcome-letters.js', len(items), 'букв', len(js) // 1024, 'KB')


if __name__ == '__main__':
    main()
