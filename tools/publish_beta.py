#!/usr/bin/env python3
"""Собирает закрытую бета-страницу просмотрщика (chka.am/beta/) в рабочей папке ветки main.

  python3 tools/publish_beta.py ../kukuruznik-main

Что делает:
  • берёт test-assets/depth.html и кладёт в <main>/beta/index.html с двумя правками:
    метка noindex,nofollow (в поиск не пускаем) и ссылки на страницы сайта (../kukuruznik/…);
  • кадры конвертирует в WebP (цвет и здание — с потерями q90, маски и глубина — без потерь), чтобы
    beta весила ~10 МБ, а не ~35 МБ, и на iPhone грузилась быстрее;
  • больше НИЧЕГО в main не трогает (ни CNAME, ни корень, ни другие страницы) и не ставит ни одной
    ссылки на /beta/ с сайта.
Коммит и пуш main делает человек (или сессия) отдельно.
"""
import re
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'test-assets'


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Укажи папку worktree ветки main: python3 tools/publish_beta.py ../kukuruznik-main')
    main_dir = Path(sys.argv[1]).resolve()
    if not (main_dir / 'CNAME').exists():
        raise SystemExit('%s не похоже на корень сайта (нет CNAME)' % main_dir)
    beta = main_dir / 'beta'
    (beta / 'frames').mkdir(parents=True, exist_ok=True)

    html = (SRC / 'depth.html').read_text(encoding='utf-8')
    stamp = time.strftime('%Y-%m-%d %H:%M')
    html = html.replace('<meta charset="utf-8">',
                        '<meta charset="utf-8">\n<meta name="robots" content="noindex, nofollow, noarchive">\n'
                        '<meta name="googlebot" content="noindex, nofollow">', 1)
    html = html.replace('<title>3D-фото — тест параллакса глубины</title>', '<title>Кукурузник — beta</title>', 1)
    html = html.replace('../../kukuruznik/index.html', '../kukuruznik/index.html')
    html = re.sub(r'test/depth-photo · v\d+ · [0-9-]+', 'beta · v8 · ' + stamp, html)
    html = re.sub(r"(frames/v_angle_\d(?:_[a-z0-9]+)*)\.png", r"\1.webp", html)
    (beta / 'index.html').write_text(html, encoding='utf-8')
    (beta / 'oldtown-bg.svg').write_text((SRC / 'oldtown-bg.svg').read_text(encoding='utf-8'), encoding='utf-8')  # фон страницы на ПК

    used = sorted(set(re.findall(r"frames/(v_angle_\d(?:_[a-z0-9]+)*)\.webp", html)))
    total = 0
    for name in used:
        if name.endswith('_bg_depth'):
            continue  # в коде не загружается
        src = SRC / 'frames' / (name + '.png')
        dst = beta / 'frames' / (name + '.webp')
        im = Image.open(src)
        if name.endswith('_building'):
            im.convert('RGBA').save(dst, 'WEBP', quality=90, alpha_quality=100, method=6)
        elif name.endswith(('_depth', '_env', '_win2')):
            im.save(dst, 'WEBP', lossless=True, method=6)
        else:
            im.convert('RGB').save(dst, 'WEBP', quality=90, method=6)
        total += dst.stat().st_size
    print('beta/index.html + %d кадров, %.1f МБ' % (len(used), total / 1e6))


if __name__ == '__main__':
    main()
