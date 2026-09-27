#!/usr/bin/env python3
"""Публикует закрытую бету (chka.am/beta/) в ветку main: здания на СЛЕДУЮЩЕЙ версии движка (docs/ENGINE-PLAN.md, этапы 2–5).

  python3 tools/publish_beta.py --dry-run          # собрать во временной копии, проверить и показать изменения (без коммита и пуша)
  python3 tools/publish_beta.py                    # опубликовать: коммит в main + пуш
  python3 tools/publish_beta.py --expect-change    # бета НАМЕРЕННО отличается от живого сайта (новая фишка): различия — в отчёт, не провал
  python3 tools/publish_beta.py -m "beta: …"       # своё сообщение коммита

Рабочая папка одна и остаётся на своей ветке. Скрипт сам:
  1. делает git fetch и создаёт ВРЕМЕННЫЙ worktree от origin/main во временной папке вне репозитория;
  2. собирает туда бету: tools/build_pages.py — beta/ очищается целиком, beta/engine/ = движок из engine/,
     beta/<здание>/index.html = шаблон движка + <здание>/building.json (кадры, значки, страница здания — с живого сайта, не копируются),
     beta/index.html = перенаправление на первое здание;
  3. запускает защитную проверку tools/check_site.mjs (docs/ENGINE-PLAN.md, п.7): все здания и страницы «до/после», прогулка по кликам,
     fps, ошибки и 404. Бета-Кукурузник сравнивается с ЖИВЫМ /kukuruznik/ строго (ноль различий), кроме запуска с --expect-change.
     Красная проверка останавливает публикацию; обход — только явным --skip-check (печатается предупреждение);
  4. коммитит ТОЛЬКО beta/ и пушит HEAD в origin/main (обычный пуш, без --force);
  5. в конце ВСЕГДА удаляет временный worktree — и при успехе, и при ошибке, и при Ctrl+C.
Больше ничего в main не трогает (ни живые здания, ни /engine/, ни корень) и не ставит ни одной ссылки на /beta/ с сайта.
Кухня (~/Documents/chka-kitchen) не затрагивается, кроме отчётов проверки (_проверки/).
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
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages   # noqa: E402  сборка страниц из движка
REMOTE = 'origin'
BRANCH = 'main'


def git(cwd, *args, check=True):
    """git в указанной папке; возвращает stdout (строкой)."""
    r = subprocess.run(['git', '-C', str(cwd), *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit('git %s — ошибка:\n%s%s' % (' '.join(args), r.stdout, r.stderr))
    return r.stdout.strip()


LIVE_TWINS = ('kukuruznik',)   # здания беты, у которых есть живой двойник на сайте: бета-версия строго равна живой
                               # (тестовые здания _test/* — только в бете, живого двойника у них нет: для них работают проверки структуры)


def build_beta(main_dir):
    """Собирает бету в <main_dir>/beta из engine/ и <здание>/building.json (Кукурузник + тестовые). Возвращает список записанных файлов."""
    return build_pages.build_beta(main_dir)


def run_check(candidate, expect_change=False):
    """Запускает tools/check_site.mjs: origin/main против собранного кандидата. True — зелёная проверка."""
    pairs = ','.join('beta/%s=%s' % (b, b) for b in LIVE_TWINS)   # бета-здание — строго против живого здания
    allow = 'beta' + (''.join(',beta/%s' % b for b in LIVE_TWINS) if expect_change else '')
    r = subprocess.run(['node', str(ROOT / 'tools' / 'check_site.mjs'), '--candidate', str(candidate), '--allow-change', allow, '--compare-as', pairs], cwd=str(ROOT))
    if r.returncode == 0:
        return True
    print('\nПРОВЕРКА %s (код %d).' % ('КРАСНАЯ' if r.returncode == 1 else 'НЕ СМОГЛА ОТРАБОТАТЬ', r.returncode))
    return False


def remove_worktree(tmp):
    """Удаляет временный worktree и папку. Не падает, чтобы не скрыть исходную ошибку."""
    subprocess.run(['git', '-C', str(ROOT), 'worktree', 'remove', '--force', str(tmp)], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
    subprocess.run(['git', '-C', str(ROOT), 'worktree', 'prune'], capture_output=True)


def main():
    ap = argparse.ArgumentParser(description='Публикация закрытой беты в main через временный worktree.')
    ap.add_argument('--dry-run', action='store_true', help='собрать во временной копии и показать изменения; без коммита и пуша')
    ap.add_argument('--expect-change', action='store_true', help='бета намеренно отличается от живых зданий: различия картинок не проваливают (ошибки, 404 и fps — проваливают)')
    ap.add_argument('--skip-check', action='store_true', help='ОБХОД защитной проверки (tools/check_site.mjs) — только осознанно')
    ap.add_argument('-m', '--message', help='сообщение коммита (по умолчанию «beta: <версия> — <дата>»)')
    args = ap.parse_args()
    dry = args.dry_run
    tag = '[dry-run] ' if dry else ''

    stamp = time.strftime('%Y-%m-%d %H:%M')
    message = args.message or 'beta: движок %s — %s' % (build_pages.engine_version(), stamp)

    print('%sfetch %s %s' % (tag, REMOTE, BRANCH))
    git(ROOT, 'fetch', REMOTE, BRANCH)
    base = git(ROOT, 'rev-parse', '%s/%s' % (REMOTE, BRANCH))

    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-beta-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, REMOTE, BRANCH, base[:7]))
    try:
        git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        st = subprocess.run([sys.executable, str(ROOT / 'tools' / 'test_build_pages.py')], capture_output=True, text=True)   # самопроверка сборщика: испорченные настройки должны останавливать сборку
        if st.returncode != 0:
            raise SystemExit('самопроверка сборщика (tools/test_build_pages.py) красная:\n' + st.stdout[-3000:])
        files = build_beta(tmp)
        print('%sсобрано в beta/: %d файлов (движок %s)' % (tag, len(files), build_pages.engine_version()))

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

        if args.skip_check:
            print('%s!!! ЗАЩИТНАЯ ПРОВЕРКА ПРОПУЩЕНА (--skip-check) !!!' % tag)
        elif not run_check(tmp, args.expect_change):
            raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная. Открой отчёт (ссылка выше), исправь и повтори; обход — только явным --skip-check.' % tag)

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
