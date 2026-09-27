#!/usr/bin/env python3
"""Проверка зданий ТОЛЬКО ДЛЯ MAC (tests/local/*: кадры другой пропорции) — во временной копии сайта, в git и в публикацию не идёт.

  python3 tools/make_prop45.py          # один раз: сделать кадры 4:5 и настройки
  python3 tools/check_local.py          # собрать бету со всеми зданиями + локальными, прогнать проверку по локальным
  python3 tools/check_local.py --keep   # не удалять временную копию (для разбора; путь печатается)

Что делает: распаковывает origin/main во временную папку, собирает туда бету (в том числе tests/local/*), запускает
tools/check_site.mjs по локальным зданиям: без ошибок и 404, структура (точки, парад, ночь без картинки), снимки. Отчёт — ссылка в выводе.
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp   # noqa: E402

ROOT = bp.ROOT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keep', action='store_true')
    ap.add_argument('--out', help='папка для отчёта (по умолчанию ~/Documents/chka-kitchen/_проверки/…)')
    args, rest = ap.parse_known_args()
    tmp = Path(tempfile.mkdtemp(prefix='chka-local-'))
    try:
        subprocess.run(['git', '-C', str(ROOT), 'fetch', '-q', 'origin', 'main'], check=True)
        ar = subprocess.run(['git', '-C', str(ROOT), 'archive', 'origin/main'], capture_output=True, check=True)
        subprocess.run(['tar', '-x', '-C', str(tmp)], input=ar.stdout, check=True)
        files = bp.build_beta(tmp, with_local=True)
        local = [b for b in bp.default_buildings(with_local=True) if b.startswith(bp.LOCAL_DIR + '/')]
        if not local:
            raise SystemExit('нет локальных зданий: запусти python3 tools/make_prop45.py')
        print('собрано: %d файлов; локальные здания: %s' % (len(files), ', '.join(local)))
        cmd = ['node', str(ROOT / 'tools' / 'check_site.mjs'), '--candidate', str(tmp), '--allow-change', 'beta', '--no-fps']
        for b in local:
            cmd += ['--only', 'beta/' + b]
        if args.out:
            cmd += ['--out', args.out]
        r = subprocess.run(cmd + rest, cwd=str(ROOT))
        sys.exit(r.returncode)
    finally:
        if args.keep:
            print('временная копия оставлена: %s' % tmp)
        else:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
