#!/usr/bin/env python3
"""Контуры букв для анимации загрузки (компонент test-assets/welcome-loader.js) -> test-assets/welcome-letters.js.

  python3 tools/build_welcome_letters.py

Контуры берёт из Noto Serif Armenian (лицензия OFL) через tools/glyph_paths.swift (macOS, CoreText):
начало армянского алфавита Ա Բ Գ Դ Ե Զ Է Ը Թ Ժ Ի Լ. На странице буквы прорисовываются карандашной линией по одной.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LETTERS = 'ԱԲԳԴԵԶԷԸԹԺԻԼ'


def main():
    r = subprocess.run(['swift', str(ROOT / 'tools' / 'glyph_paths.swift'), LETTERS], capture_output=True, text=True, check=True)
    items = [{'ch': g['ch'], 'd': g['d']} for g in json.loads(r.stdout) if g['d']]
    js = ('/* Генерируется tools/build_welcome_letters.py (контуры Noto Sans Armenian, OFL) — руками не править. */\n'
          'window.WL_LETTERS = ' + json.dumps(items, ensure_ascii=False) + ';\n')
    (ROOT / 'test-assets' / 'welcome-letters.js').write_text(js, encoding='utf-8')
    print('welcome-letters.js', len(items), 'букв', len(js) // 1024, 'KB')


if __name__ == '__main__':
    main()
