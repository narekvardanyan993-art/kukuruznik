#!/usr/bin/env python3
"""Публикует закрытую бета-страницу просмотрщика (chka.am/beta/) в ветку main.

  python3 tools/publish_beta.py --dry-run     # показать, что было бы сделано (без коммита и пуша)
  python3 tools/publish_beta.py               # опубликовать: коммит в main + пуш
  python3 tools/publish_beta.py -m "beta: …"  # своё сообщение коммита

Рабочая папка одна и остаётся на своей ветке. Скрипт сам:
  1. делает git fetch и создаёт ВРЕМЕННЫЙ worktree от origin/main во временной папке вне репозитория;
  2. собирает туда beta/ : test-assets/depth.html → beta/index.html с двумя правками (noindex,nofollow
     и ссылки на страницы сайта ../kukuruznik/…), кадры конвертирует в WebP (цвет и здание — с потерями
     q90, маски и глубина — без потерь: ~10 МБ вместо ~35 МБ);
  3. коммитит ТОЛЬКО beta/ и пушит HEAD в origin/main (обычный пуш, без --force);
  4. в конце ВСЕГДА удаляет временный worktree — и при успехе, и при ошибке, и при Ctrl+C.
Больше ничего в main не трогает (ни CNAME, ни корень, ни другие страницы) и не ставит ни одной ссылки
на /beta/ с сайта. Кухня (~/Documents/chka-kitchen) не затрагивается.
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'test-assets'
BETA_VERSION = 'v11'   # метка сборки в панели: «beta · v11 · <дата>»
REMOTE = 'origin'
BRANCH = 'main'


def git(cwd, *args, check=True):
    """git в указанной папке; возвращает stdout (строкой)."""
    r = subprocess.run(['git', '-C', str(cwd), *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit('git %s — ошибка:\n%s%s' % (' '.join(args), r.stdout, r.stderr))
    return r.stdout.strip()


def build_beta(main_dir):
    """Собирает <main_dir>/beta из test-assets. Возвращает (число кадров, размер в байтах)."""
    from PIL import Image

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
    html = re.sub(r'test/depth-photo · v\d+ · [0-9-]+', 'beta · ' + BETA_VERSION + ' · ' + stamp, html)
    html = re.sub(r"(frames/v_angle_\d(?:_[a-z0-9]+)*)\.png", r"\1.webp", html)
    (beta / 'index.html').write_text(html, encoding='utf-8')
    (beta / 'oldtown-bg.svg').write_text((SRC / 'oldtown-bg.svg').read_text(encoding='utf-8'), encoding='utf-8')  # фон страницы на ПК
    # компонент приветствия/загрузки (буквы — tools/build_welcome_letters.py) и шрифт Noto Serif (OFL)
    for name in ('welcome-loader.js', 'welcome-letters.js', 'prep.js', 'details.js', 'viewer.js'):
        (beta / name).write_text((SRC / name).read_text(encoding='utf-8'), encoding='utf-8')
    (beta / 'fonts').mkdir(exist_ok=True)
    for f in sorted((SRC / 'fonts').iterdir()):
        (beta / 'fonts' / f.name).write_bytes(f.read_bytes())

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
    return len(used), total


def remove_worktree(tmp):
    """Удаляет временный worktree и папку. Не падает, чтобы не скрыть исходную ошибку."""
    subprocess.run(['git', '-C', str(ROOT), 'worktree', 'remove', '--force', str(tmp)], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
    subprocess.run(['git', '-C', str(ROOT), 'worktree', 'prune'], capture_output=True)


def main():
    ap = argparse.ArgumentParser(description='Публикация закрытой беты в main через временный worktree.')
    ap.add_argument('--dry-run', action='store_true', help='собрать во временной копии и показать изменения; без коммита и пуша')
    ap.add_argument('-m', '--message', help='сообщение коммита (по умолчанию «beta: <версия> — <дата>»)')
    args = ap.parse_args()
    dry = args.dry_run
    tag = '[dry-run] ' if dry else ''

    stamp = time.strftime('%Y-%m-%d %H:%M')
    message = args.message or 'beta: %s — %s' % (BETA_VERSION, stamp)

    print('%sfetch %s %s' % (tag, REMOTE, BRANCH))
    git(ROOT, 'fetch', REMOTE, BRANCH)
    base = git(ROOT, 'rev-parse', '%s/%s' % (REMOTE, BRANCH))

    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-beta-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, REMOTE, BRANCH, base[:7]))
    try:
        git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        n, size = build_beta(tmp)
        print('%sbeta/index.html + %d кадров, %.1f МБ' % (tag, n, size / 1e6))

        git(tmp, 'add', '-A', 'beta')
        staged = git(tmp, 'diff', '--cached', '--name-only').splitlines()
        outside = [p for p in staged if not p.startswith('beta/')]
        if outside:
            raise SystemExit('в коммит попало что-то вне beta/: %s — стоп' % outside)
        if not staged:
            print('%sизменений в beta/ нет — публиковать нечего' % tag)
            return
        print('%sизменено файлов в beta/: %d' % (tag, len(staged)))
        print(git(tmp, 'diff', '--cached', '--stat', '--stat-width=100').splitlines()[-1])

        if dry:
            print('[dry-run] СДЕЛАЛ БЫ: git commit -m "%s"' % message)
            print('[dry-run] СДЕЛАЛ БЫ: git push %s HEAD:%s   (обычный пуш, без --force)' % (REMOTE, BRANCH))
            print('[dry-run] ничего не закоммичено и не отправлено')
            return

        git(tmp, 'commit', '-m', message)
        head = git(tmp, 'rev-parse', 'HEAD')
        git(tmp, 'push', REMOTE, 'HEAD:%s' % BRANCH)
        print('запушено в %s/%s: %s' % (REMOTE, BRANCH, head[:7]))
    finally:
        remove_worktree(tmp)
        print('%sвременный worktree удалён' % tag)


if __name__ == '__main__':
    main()
