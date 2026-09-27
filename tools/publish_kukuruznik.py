#!/usr/bin/env python3
"""Публикует страницу Кукурузника (chka.am/kukuruznik/) из kukuruznik/building.json на ЖИВОМ движке engine/ (этап 5 и дальше).

  python3 tools/publish_kukuruznik.py --dry-run          # собрать во временной копии main, проверить, показать изменения (без коммита и пуша)
  python3 tools/publish_kukuruznik.py                    # опубликовать: коммит в main + пуш (обычный, без --force)
  python3 tools/publish_kukuruznik.py --frames           # ещё и перекодировать кадры из test-assets/frames/ (PNG -> WebP, как раньше)
  python3 tools/publish_kukuruznik.py -m "сообщение"

Для правок САМОГО здания (тексты, факты, точки-подсказки, фонари, кадры) — движок не меняется:
  • kukuruznik/index.html и kukuruznik/manifest.json собираются tools/build_pages.build_live (шаблон engine/page.html +
    engine/config.json + kukuruznik/building.json; адреса движка ../engine/…?v=<версия>). Руками страницу не править.
  • Движок на сайте (engine/) НЕ меняется и обязан совпадать с исходником engine/ — иначе стоп: новый движок идёт только через
    бету и tools/publish_engine.py.
  • Защитная проверка tools/check_site.mjs перед пушем: всё строго против origin/main. Здание, которое меняется намеренно,
    указывается --expect-change (тогда его различия — в отчёт, не провал; ошибки, 404, fps и шапка/превью проверяются всегда).
    Красная — не пушит; обход только --skip-check.
Коммитит только kukuruznik/index.html, kukuruznik/manifest.json (и kukuruznik/frames/ с --frames). Временный worktree удаляется всегда.
"""
import argparse
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp   # noqa: E402
import publish_beta as pb  # noqa: E402  git(), remove_worktree(), run_check(), SRC (test-assets — исходные PNG кадров)

ROOT, SRC = pb.ROOT, pb.SRC
BID = 'kukuruznik'


def encode_frames(site):
    """Кадры из test-assets/frames/*.png -> kukuruznik/frames/*.webp (только те, что есть в building.json): цвет и здание — WebP с потерями q90,
    маски и глубина — без потерь (как раньше). Возвращает (файлов, байт)."""
    from PIL import Image
    b = bp.load_building(BID)
    out = site / bp.site_path(BID, b['framesDir'])
    out.mkdir(parents=True, exist_ok=True)
    cfg = bp.make_config(b, '')
    used = sorted(set(re.findall(r'(v_angle_\d(?:_[a-z0-9]+)*)\.webp', repr(cfg['FRAMES']))))
    total = 0
    for name in used:
        if name.endswith('_bg_depth'):
            continue
        im = Image.open(SRC / 'frames' / (name + '.png'))
        dst = out / (name + '.webp')
        if name.endswith('_building'):
            im.convert('RGBA').save(dst, 'WEBP', quality=90, alpha_quality=100, method=6)
        elif name.endswith(('_depth', '_env', '_win2')):
            im.save(dst, 'WEBP', lossless=True, method=6)
        else:
            im.convert('RGB').save(dst, 'WEBP', quality=90, method=6)
        total += dst.stat().st_size
    return len(used), total


def main():
    ap = argparse.ArgumentParser(description='Кукурузник из building.json на живом движке -> chka.am/kukuruznik/ через временный worktree.')
    ap.add_argument('--dry-run', action='store_true', help='собрать, проверить и показать изменения; без коммита и пуша')
    ap.add_argument('--frames', action='store_true', help='перекодировать кадры из test-assets/frames/ в kukuruznik/frames/')
    ap.add_argument('--expect-change', action='store_true', help='Кукурузник намеренно меняется: различия картинок — в отчёт, не провал')
    ap.add_argument('--skip-check', action='store_true', help='ОБХОД защитной проверки — только осознанно')
    ap.add_argument('-m', '--message', help='сообщение коммита')
    args = ap.parse_args()
    tag = '[dry-run] ' if args.dry_run else ''
    message = args.message or 'kukuruznik: страница из building.json (движок %s) — %s' % (bp.engine_version(), time.strftime('%Y-%m-%d %H:%M'))

    pb.git(ROOT, 'fetch', pb.REMOTE, pb.BRANCH)
    base = pb.git(ROOT, 'rev-parse', '%s/%s' % (pb.REMOTE, pb.BRANCH))
    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-kuk-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, pb.REMOTE, pb.BRANCH, base[:7]))
    try:
        pb.git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        paths = ['%s/index.html' % BID, '%s/manifest.json' % BID]
        if args.frames:
            n, size = encode_frames(tmp)
            print('%sкадры: %d файлов, %.1f МБ' % (tag, n, size / 1e6))
            paths.append('%s/frames' % BID)
        bp.build_live(tmp, [BID])   # движок на сайте не меняется; не совпадает с исходником — стоп внутри
        pb.git(tmp, 'add', '-A', *paths)
        staged = pb.git(tmp, 'diff', '--cached', '--name-only').splitlines()
        outside = [p for p in staged if not (p in paths or (args.frames and p.startswith('%s/frames/' % BID)))]
        if outside:
            raise SystemExit('в коммит попало лишнее: %s — стоп' % outside)
        if not staged:
            print('%sизменений нет — публиковать нечего' % tag)
            return
        print(pb.git(tmp, 'diff', '--cached', '--stat', '--stat-width=110'))
        if args.skip_check:
            print('%s!!! ЗАЩИТНАЯ ПРОВЕРКА ПРОПУЩЕНА (--skip-check) !!!' % tag)
        elif not pb.run_check(tmp, strict=True, allow_extra=[BID, 'beta/' + BID] if args.expect_change else []):
            raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная; обход — только явным --skip-check.' % tag)
        if args.dry_run:
            print('[dry-run] СДЕЛАЛ БЫ: git commit + git push %s HEAD:%s (без --force); ничего не отправлено' % (pb.REMOTE, pb.BRANCH))
            return
        pb.git(tmp, 'commit', '-m', message)
        head = pb.git(tmp, 'rev-parse', 'HEAD')
        pb.git(tmp, 'push', pb.REMOTE, 'HEAD:%s' % pb.BRANCH)
        print('запушено в %s/%s: %s (откат: git revert %s)' % (pb.REMOTE, pb.BRANCH, head[:7], head[:7]))
    finally:
        pb.remove_worktree(tmp)
        print('%sвременный worktree удалён' % tag)


if __name__ == '__main__':
    main()
