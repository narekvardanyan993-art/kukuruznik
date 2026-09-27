#!/usr/bin/env python3
"""Уборка старья на сайте (docs/ENGINE-PLAN.md, п.5 и этап 6). Список утверждён владельцем 28.09.2026.

  python3 tools/publish_cleanup.py --dry-run      # собрать во временной копии main, проверить, показать изменения (без коммита и пуша)
  python3 tools/publish_cleanup.py                # опубликовать: ОДИН коммит в main + пуш (обычный, без --force)

Что делает:
  А. удаляет старый 3D-движок (до «3D-фото»): kukuruznik/builder.js, params.js, js/, css/, version.txt; в корне build.py, src/, engine3d/;
  Б. удаляет старую копию просмотрщика в kukuruznik/ (viewer.js, details.js, prep.js, welcome-*.js, wall*.js, fonts/) — с этапа 5
     страница берёт всё из engine/;
  В. kukuruznik/scene3d.html и kukuruznik/webgl/index.html — перенаправления на /kukuruznik/ (как scene.html), старые ссылки не ломаются.
Не трогает: gallery-source/, test-assets/, about/history/gallery/card/og/icons/scene.html/404, главную, бету, engine/.
Перед пушем: (1) ни один оставшийся файл сайта не ссылается на удалённое (src/href/url()/строки с именами файлов, адреса
разбираются относительно файла) — иначе стоп; (2) защитная проверка tools/check_site.mjs в строгом режиме (ноль различий везде).
Временный worktree удаляется всегда. Откат — отмена одного коммита.
"""
import argparse
import posixpath
import re
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish_beta as pb  # noqa: E402  git(), remove_worktree(), run_check()

ROOT = pb.ROOT
OLD_3D = ['kukuruznik/builder.js', 'kukuruznik/params.js', 'kukuruznik/js', 'kukuruznik/css', 'kukuruznik/version.txt',
          'build.py', 'src', 'engine3d']
OLD_VIEWER = ['kukuruznik/viewer.js', 'kukuruznik/details.js', 'kukuruznik/prep.js', 'kukuruznik/welcome-loader.js',
              'kukuruznik/welcome-letters.js', 'kukuruznik/wall.js', 'kukuruznik/wall-data.js', 'kukuruznik/fonts']
REDIRECTS = {'kukuruznik/scene3d.html': './', 'kukuruznik/webgl/index.html': '../'}   # файл -> куда (относительно файла)
NOT_SITE = ('docs/', 'tools/', 'test-assets/', 'node_modules/', '.agent/', '.claude/', 'tests/')   # не страницы сайта: их ссылки не считаются

REDIRECT = '''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=%(to)s">
<link rel="canonical" href="https://chka.am/kukuruznik/">
<title>Кукурузник — Չկա</title>
<script>location.replace('%(to)s' + location.hash);</script>
</head>
<body>
<!-- Старая 3D-сцена больше не показывается: её место занял просмотрщик по адресу /kukuruznik/. -->
<p><a href="%(to)s">Кукурузник → chka.am/kukuruznik/</a></p>
</body>
</html>
'''


def tracked(site, paths):
    """Файлы в git из списка путей (папки раскрываются)."""
    out = pb.git(site, 'ls-files', '--', *paths)
    return [p for p in out.splitlines() if p]


URL_RES = [re.compile(r'''(?:src|href)\s*=\s*["']([^"'#?]+)'''), re.compile(r'''url\(\s*["']?([^"')#?]+)'''),
           re.compile(r'''["']([^"'\s#?]+\.(?:js|css|json|woff2?|html))["'?]''')]


def dangling_refs(site, deleted):
    """Ссылки оставшихся файлов сайта на удалённые файлы: [(файл, адрес, куда ведёт)]."""
    deleted = set(deleted)
    bad = []
    for f in sorted(pb.git(site, 'ls-files').splitlines()):
        if f.startswith(NOT_SITE) or f in deleted or not f.endswith(('.html', '.js', '.css', '.json', '.webmanifest')) or f in ('package.json', 'package-lock.json'):
            continue
        p = site / f
        if not p.exists():
            continue
        text = p.read_text(encoding='utf-8', errors='replace')
        base = posixpath.dirname(f)
        for rx in URL_RES:
            for u in set(rx.findall(text)):
                if re.match(r'^[a-z]+:', u) or u.startswith('//'):
                    continue
                t = posixpath.normpath(u.lstrip('/') if u.startswith('/') else posixpath.join(base, u))
                if t in deleted or any(t.startswith(d.rstrip('/') + '/') for d in deleted):
                    bad.append((f, u, t))
    return bad


def main():
    ap = argparse.ArgumentParser(description='Уборка старья на сайте (этап 6) одним коммитом в main.')
    ap.add_argument('--dry-run', action='store_true', help='собрать, проверить и показать изменения; без коммита и пуша')
    ap.add_argument('--skip-check', action='store_true', help='ОБХОД защитной проверки — только осознанно')
    ap.add_argument('-m', '--message', help='сообщение коммита')
    args = ap.parse_args()
    tag = '[dry-run] ' if args.dry_run else ''
    message = args.message or 'cleanup: старый 3D-движок и старая копия просмотрщика удалены; scene3d.html и webgl/ — перенаправления на /kukuruznik/ — %s' % time.strftime('%Y-%m-%d %H:%M')

    pb.git(ROOT, 'fetch', pb.REMOTE, pb.BRANCH)
    base = pb.git(ROOT, 'rev-parse', '%s/%s' % (pb.REMOTE, pb.BRANCH))
    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-cleanup-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, pb.REMOTE, pb.BRANCH, base[:7]))
    try:
        pb.git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        if not (tmp / 'engine' / 'VERSION').exists():
            raise SystemExit('СТОП: на сайте нет engine/ — старую копию просмотрщика удалять нельзя (сначала этап 5)')
        doomed = tracked(tmp, OLD_3D + OLD_VIEWER)
        if doomed:
            pb.git(tmp, 'rm', '-r', '-q', '--', *[p for p in OLD_3D + OLD_VIEWER if tracked(tmp, [p])])
        for f, to in REDIRECTS.items():
            (tmp / f).parent.mkdir(parents=True, exist_ok=True)
            (tmp / f).write_text(REDIRECT % {'to': to}, encoding='utf-8')
            pb.git(tmp, 'add', f)
        bad = dangling_refs(tmp, doomed)
        if bad:
            raise SystemExit('СТОП: оставшиеся страницы ссылаются на удалённое:\n  ' + '\n  '.join('%s: «%s» → %s' % x for x in bad))
        print('%sссылок на удалённое нет (проверены все страницы, скрипты, стили и json сайта)' % tag)
        staged = pb.git(tmp, 'diff', '--cached', '--name-status').splitlines()
        allowed = set(doomed) | set(REDIRECTS)
        outside = [s for s in staged if s.split('\t')[-1] not in allowed]
        if outside:
            raise SystemExit('в коммит попало лишнее: %s — стоп' % outside)
        if not staged:
            print('%sизменений нет — уже убрано' % tag)
            return
        print('%sудаляется файлов: %d, перенаправлений: %d' % (tag, sum(s.startswith('D') for s in staged), len(REDIRECTS)))
        print(pb.git(tmp, 'diff', '--cached', '--stat', '--stat-width=110'))
        if args.skip_check:
            print('%s!!! ЗАЩИТНАЯ ПРОВЕРКА ПРОПУЩЕНА (--skip-check) !!!' % tag)
        elif not pb.run_check(tmp, strict=True):
            raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная; обход — только явным --skip-check.' % tag)
        if args.dry_run:
            print('[dry-run] СДЕЛАЛ БЫ: git commit + git push %s HEAD:%s (без --force); ничего не отправлено' % (pb.REMOTE, pb.BRANCH))
            return
        pb.git(tmp, 'commit', '-m', message)
        head = pb.git(tmp, 'rev-parse', 'HEAD')
        pb.git(tmp, 'push', pb.REMOTE, 'HEAD:%s' % pb.BRANCH)
        print('запушено в %s/%s: %s' % (pb.REMOTE, pb.BRANCH, head[:7]))
        print('откат одним коммитом: git revert %s' % head[:7])
    finally:
        pb.remove_worktree(tmp)
        print('%sвременный worktree удалён' % tag)


if __name__ == '__main__':
    main()
