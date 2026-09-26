#!/usr/bin/env python3
"""Переносит просмотрщик из test-assets/ на постоянный адрес chka.am/kukuruznik/ (v12.1 и дальше).

  python3 tools/publish_kukuruznik.py --dry-run          # собрать во временной копии и показать изменения (без коммита и пуша)
  python3 tools/publish_kukuruznik.py --preview DIR      # собрать в новую папку DIR (git worktree от origin/main), без коммита — для локальной проверки
  python3 tools/publish_kukuruznik.py                    # опубликовать: коммит в main + пуш (обычный, без --force)
  python3 tools/publish_kukuruznik.py -m "сообщение"

Что делает (в отличие от tools/publish_beta.py — бету не трогает):
  1. kukuruznik/index.html (страница здания: слайдер, галерея, хроника, «угадай год») -> kukuruznik/about.html. Лежит в той же папке,
     поэтому все её относительные ссылки (../assets, scene.html, gallery/…) не ломаются; в scene.html и history.html ссылки «назад»
     (было ./) переставляются на about.html.
  2. kukuruznik/index.html = просмотрщик из test-assets/ (index.html, details.js, prep.js, viewer.js, welcome-*.js, wall*.js, fonts/, frames/ в WebP,
     og.jpg). Без метки «beta» и без видимой версии (версия — только в коде: <meta name="viewer-version">), без noindex; с og:/twitter: превью
     (заголовок и описание на армянском, картинка 1200×630), canonical и иконками. «Домой» ведёт на страницу здания (about.html).
  3. Старая 3D-сцена: scene.html -> страница-перенаправление на /kukuruznik/, все ссылки на неё с сайта убраны (about.html, manifest.json).
  4. Не трогает: главную, /beta/; старые адреса history.html, scene3d.html, webgl/ живут.
Как и publish_beta.py: временный worktree от origin/main, коммит только того, что положено, пуш HEAD в origin/main, worktree всегда удаляется.
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import publish_beta as pb   # git(), remove_worktree(), ROOT, SRC

ROOT, SRC = pb.ROOT, pb.SRC
VERSION = 'v12.1'
URL = 'https://chka.am/kukuruznik/'

TITLE = {'hy': 'Կուկուռուզնիկ — Երիտասարդական պալատ | Չկա', 'ru': 'Кукурузник — Дом молодёжи | Չկա', 'en': 'Kukuruznik — Youth Palace | Չկա'}
DESC_HY = 'Երևանի քանդված Երիտասարդական պալատը՝ վերակենդանացած գծանկարով։ Թեքեք նկարը, փոխեք օրվա ժամը և թերթեք կադրերը։'
ALT_HY = 'Կուկուռուզնիկը՝ Երիտասարդական պալատը Երևանում, 1979–2006, գծանկար'

HEAD = '''<meta charset="utf-8">
<meta name="description" content="%(desc)s">
<link rel="canonical" href="%(url)s">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="theme-color" content="#f5ecda">
<meta name="viewer-version" content="%(ver)s">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Չկա">
<meta property="og:url" content="%(url)s">
<meta property="og:title" content="%(title)s">
<meta property="og:description" content="%(desc)s">
<meta property="og:image" content="%(url)sog.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="%(alt)s">
<meta property="og:locale" content="hy_AM">
<meta property="og:locale:alternate" content="ru_RU">
<meta property="og:locale:alternate" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="%(title)s">
<meta name="twitter:description" content="%(desc)s">
<meta name="twitter:image" content="%(url)sog.jpg">
<meta name="twitter:image:alt" content="%(alt)s">''' % dict(desc=DESC_HY, url=URL, ver=VERSION, title=TITLE['hy'], alt=ALT_HY)


SCENE_REDIRECT = '''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=./">
<link rel="canonical" href="https://chka.am/kukuruznik/">
<title>Кукурузник — Չկա</title>
<script>location.replace('./' + location.hash);</script>
</head>
<body>
<!-- Старая 3D-сцена больше не показывается: её место занял просмотрщик «3D-фото» по адресу /kukuruznik/. -->
<p><a href="./">Кукурузник → chka.am/kukuruznik/</a></p>
</body>
</html>
'''


def viewer_html():
    html = (SRC / 'depth.html').read_text(encoding='utf-8')

    def sub(old, new, count=1):
        nonlocal html
        if html.count(old) != count:
            raise SystemExit('в depth.html ожидалось %d вхождение(й) «%s», найдено %d' % (count, old[:60], html.count(old)))
        html = html.replace(old, new)

    sub('<meta charset="utf-8">', HEAD)
    sub('<title>3D-фото — тест параллакса глубины</title>', '<title>%s</title>' % TITLE['hy'])
    # заголовок вкладки меняется вместе с языком страницы
    html, n = re.subn(r"pageTitle: \{[^}]*\},", "pageTitle: { ru: '%s', en: '%s', hy: '%s' }," % (TITLE['ru'], TITLE['en'], TITLE['hy']), html)
    if n != 1:
        raise SystemExit('не нашёл pageTitle')
    # «домой»: на страницу здания (кнопка в панели на ПК, «домой» на телефоне, «подробнее» в справке)
    sub('../../kukuruznik/about.html', 'about.html', count=html.count('../../kukuruznik/about.html'))
    # без метки «beta» и без видимой версии
    html, n1 = re.subn(r'\s*<div id="build-version">[^<]*</div>', '', html)
    html, n2 = re.subn(r'\s*<div class="p-build">[^<]*</div>', '', html)
    if n1 != 1 or n2 != 1:
        raise SystemExit('не нашёл метки версии (%d, %d)' % (n1, n2))
    if 'beta' in re.sub(r'<!--.*?-->', '', html, flags=re.S).lower().replace('robots', ''):
        print('  внимание: в html осталось слово «beta» — проверь:', [m.group(0) for m in re.finditer(r'.{30}beta.{30}', html)][:3])
    html = re.sub(r"(frames/v_angle_\d(?:_[a-z0-9]+)*)\.png", r"\1.webp", html)
    return html


def build(site):
    """Собирает просмотрщик в <site>/kukuruznik и переставляет страницу здания на about.html. Возвращает (кадров, байт кадров)."""
    from PIL import Image

    k = site / 'kukuruznik'
    if not (site / 'CNAME').exists() or not k.is_dir():
        raise SystemExit('%s не похоже на корень сайта (нет CNAME или kukuruznik/)' % site)
    # 1. страница здания: index.html -> about.html (если уже переставлена — не трогаем)
    if not (k / 'about.html').exists():
        if not (k / 'index.html').exists():
            raise SystemExit('нет kukuruznik/index.html')
        subprocess.run(['git', '-C', str(site), 'mv', 'kukuruznik/index.html', 'kukuruznik/about.html'], check=True)
    t = (k / 'history.html').read_text(encoding='utf-8')
    (k / 'history.html').write_text(t.replace('href="./"', 'href="about.html"'), encoding='utf-8')   # «назад» — на страницу здания
    # старая 3D-сцена: все ссылки на неё убираем, сама страница — перенаправление на просмотрщик (/kukuruznik/)
    a = (k / 'about.html').read_text(encoding='utf-8')
    a = a.replace('href="scene.html"', 'href="./"').replace("    scene: 'scene.html',\n", '')   # кнопки «Смотреть в 3D» ведут в просмотрщик; без cfg.scene окно-iframe не открывается
    if 'scene.html' in a:
        raise SystemExit('в about.html остались ссылки на scene.html')
    (k / 'about.html').write_text(a, encoding='utf-8')
    mf = (k / 'manifest.json').read_text(encoding='utf-8').replace('"start_url": "./scene.html"', '"start_url": "./"')
    (k / 'manifest.json').write_text(mf, encoding='utf-8')
    (k / 'scene.html').write_text(SCENE_REDIRECT, encoding='utf-8')
    # 2. просмотрщик
    (k / 'index.html').write_text(viewer_html(), encoding='utf-8')
    for name in ('details.js', 'prep.js', 'viewer.js', 'welcome-loader.js', 'welcome-letters.js', 'wall.js', 'wall-data.js'):
        (k / name).write_text((SRC / name).read_text(encoding='utf-8'), encoding='utf-8')
    (k / 'fonts').mkdir(exist_ok=True)
    for f in sorted((SRC / 'fonts').iterdir()):
        (k / 'fonts' / f.name).write_bytes(f.read_bytes())
    shutil.copyfile(SRC / 'og-kukuruznik.jpg', k / 'og.jpg')
    # кадры: цвет и здание — WebP с потерями q90, маски и глубина — без потерь (как в бете)
    html = (k / 'index.html').read_text(encoding='utf-8')
    (k / 'frames').mkdir(exist_ok=True)
    used = sorted(set(re.findall(r"frames/(v_angle_\d(?:_[a-z0-9]+)*)\.webp", html)))
    total = 0
    for name in used:
        if name.endswith('_bg_depth'):
            continue
        im = Image.open(SRC / 'frames' / (name + '.png'))
        dst = k / 'frames' / (name + '.webp')
        if name.endswith('_building'):
            im.convert('RGBA').save(dst, 'WEBP', quality=90, alpha_quality=100, method=6)
        elif name.endswith(('_depth', '_env', '_win2')):
            im.save(dst, 'WEBP', lossless=True, method=6)
        else:
            im.convert('RGB').save(dst, 'WEBP', quality=90, method=6)
        total += dst.stat().st_size
    return len(used), total


def main():
    ap = argparse.ArgumentParser(description='Просмотрщик -> chka.am/kukuruznik/ через временный worktree.')
    ap.add_argument('--dry-run', action='store_true', help='собрать и показать изменения; без коммита и пуша')
    ap.add_argument('--preview', metavar='DIR', help='собрать в новую папку DIR (worktree от origin/main), без коммита')
    ap.add_argument('-m', '--message', help='сообщение коммита')
    args = ap.parse_args()
    message = args.message or 'kukuruznik: просмотрщик %s на постоянном адресе; страница здания — about.html; превью для соцсетей — %s' % (VERSION, time.strftime('%Y-%m-%d %H:%M'))

    pb.git(ROOT, 'fetch', pb.REMOTE, pb.BRANCH)
    base = pb.git(ROOT, 'rev-parse', '%s/%s' % (pb.REMOTE, pb.BRANCH))
    if args.preview:
        d = Path(args.preview)
        pb.git(ROOT, 'worktree', 'add', '--detach', str(d), base)
        n, size = build(d)
        print('собрано в %s: %d кадров, %.1f МБ (worktree оставлен; убрать: git worktree remove --force %s)' % (d, n, size / 1e6, d))
        return
    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-kuk-'))
    print('временный worktree: %s (от %s/%s = %s)' % (tmp, pb.REMOTE, pb.BRANCH, base[:7]))
    try:
        pb.git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        n, size = build(tmp)
        pb.git(tmp, 'add', '-A', 'kukuruznik')
        staged = pb.git(tmp, 'diff', '--cached', '--name-only').splitlines()
        outside = [p for p in staged if not p.startswith('kukuruznik/')]
        if outside:
            raise SystemExit('в коммит попало что-то вне kukuruznik/: %s — стоп' % outside)
        if not staged:
            print('изменений нет — публиковать нечего')
            return
        print('изменено файлов в kukuruznik/: %d (кадров %d, %.1f МБ)' % (len(staged), n, size / 1e6))
        print(pb.git(tmp, 'diff', '--cached', '--stat', '--stat-width=110', '-M'))
        if args.dry_run:
            print('[dry-run] СДЕЛАЛ БЫ: git commit + git push %s HEAD:%s (обычный пуш, без --force); ничего не отправлено' % (pb.REMOTE, pb.BRANCH))
            return
        pb.git(tmp, 'commit', '-m', message)
        head = pb.git(tmp, 'rev-parse', 'HEAD')
        pb.git(tmp, 'push', pb.REMOTE, 'HEAD:%s' % pb.BRANCH)
        print('запушено в %s/%s: %s' % (pb.REMOTE, pb.BRANCH, head[:7]))
    finally:
        pb.remove_worktree(tmp)


if __name__ == '__main__':
    main()
