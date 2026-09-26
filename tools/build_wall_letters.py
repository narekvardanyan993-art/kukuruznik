#!/usr/bin/env python3
"""Контуры заглавных армянских букв для фона-стены: tools/wall_letters.json.

  python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli
  /tmp/fontvenv/bin/python tools/build_wall_letters.py

Шрифт — Noto Serif Armenian (SIL Open Font License 1.1, https://openfontlicense.org), тот самый файл, что лежит в проекте:
test-assets/fonts/NotoSerifArmenian-armenian.woff2 (лицензия — test-assets/fonts/LICENSE.txt). Берётся стандартный вес (400).
Формат: [{"ch": "Ա", "adv": ширина, "d": контур SVG}] в единицах em·1000, ось y направлена вверх отрицательными числами (как у прежних файлов).
"""
import json
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
font = TTFont(ROOT / 'test-assets' / 'fonts' / 'NotoSerifArmenian-armenian.woff2')
gs, cmap = font.getGlyphSet(), font.getBestCmap()
out = []
for cp in range(0x531, 0x557):   # Ա … Ֆ, 38 заглавных
    name = cmap[cp]
    pen = SVGPathPen(gs, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.'))
    gs[name].draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    out.append({'ch': chr(cp), 'adv': gs[name].width, 'd': pen.getCommands()})
(ROOT / 'tools' / 'wall_letters.json').write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
print(len(out), 'букв, Noto Serif Armenian (OFL)')
