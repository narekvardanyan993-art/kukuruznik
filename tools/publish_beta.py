#!/usr/bin/env python3
"""Публикует закрытую бету (chka.am/beta/) в ветку main: здания на СЛЕДУЮЩЕЙ версии движка (docs/ENGINE-PLAN.md, этапы 2–5).

  python3 tools/publish_beta.py --dry-run          # собрать во временной копии, проверить и показать изменения (без коммита и пуша)
  python3 tools/publish_beta.py                    # опубликовать: коммит в main + пуш
  python3 tools/publish_beta.py --expect-change    # бета НАМЕРЕННО отличается от живого сайта (новая фишка, новое здание): пиксели — только у целей, чьи файлы меняются публикацией
  python3 tools/publish_beta.py -m "beta: …"       # своё сообщение коммита

С --expect-change (как у publish_engine.py --expect-change): check_site снимает пиксели ТОЛЬКО у целей, чьи отдаваемые файлы эта публикация меняет
(страница или любой файл, от которого она зависит, — build_pages.changed_targets) и у новых целей; различия картинок у них допустимы, проблемы,
ошибки консоли, 404 и fps проваливают как обычно. У всех остальных страниц (хаб, живые здания, about/history, нетронутые бета-здания…) пикселей нет —
вместо них побайтно: файлы страницы и все её зависимости (включая engine/ и beta/engine/) должны совпасть с origin/main; любое отличие — КРАСНАЯ,
публикация останавливается до check_site. Без --expect-change проверка прежняя: все цели, строго.

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
                               # (тестовые здания tests/* — только в бете, живого двойника у них нет: для них работают проверки структуры)


def build_beta(main_dir):
    """Собирает бету в <main_dir>/beta из engine/ и <здание>/building.json (Кукурузник + тестовые). Возвращает список записанных файлов."""
    return build_pages.build_beta(main_dir)


def run_check(candidate, expect_change=False, strict=False, allow_extra=(), only=(), allow_only=None, twins=True):
    """Запускает tools/check_site.mjs: origin/main против собранного кандидата. True — зелёная проверка.
    strict — ни одна цель не может отличаться (publish_engine, publish_kukuruznik): даже бета обязана совпасть с сайтом;
    allow_extra — цели, у которых различия картинок намеренные (например здание с новыми кадрами);
    only — снимать только эти цели (по умолчанию — все);
    allow_only — точный список целей, у которых различия картинок допустимы (вместо «вся бета»): publish_beta --expect-change.
    Переменная окружения CHKA_CHECK_RENDERER — отрисовка WebGL для проверки там, где нет Metal (облако/Linux: swiftshader).
    twins=False — без пар «бета-здание ⇄ живое» (publish_building: бета этой публикацией не меняется — это доказано побайтно,
    а пара снимается с разным зерном случайности и строго не совпадает никогда).
    Ослабить проверку через окружение нельзя: другие параметры не передаются."""
    import os
    pairs = ','.join('beta/%s=%s' % (b, b) for b in LIVE_TWINS)   # бета-здание — строго против живого здания
    allow = [] if strict else ['beta'] + (['beta/%s' % b for b in LIVE_TWINS] if expect_change else [])
    if allow_only is not None:
        allow = list(allow_only)
    allow += list(allow_extra)
    cmd = ['node', str(ROOT / 'tools' / 'check_site.mjs'), '--candidate', str(candidate)] + (['--compare-as', pairs] if twins else [])
    if allow:
        cmd += ['--allow-change', ','.join(allow)]
    if only:   # снимать только эти цели (publish_engine --expect-change: остальные проверены побайтно)
        cmd += ['--only', ','.join(only)]
    if os.environ.get('CHKA_CHECK_RENDERER'):
        cmd += ['--renderer', os.environ['CHKA_CHECK_RENDERER']]
    print('проверка: ' + ' '.join(cmd[1:]))
    r = subprocess.run(cmd, cwd=str(ROOT))
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
        elif args.expect_change:
            # файлы, отличающиеся от origin/main (рабочая копия — ровно origin/main + сборка): изменённые и новые, включая неучтённые в индексе
            changed = set(git(tmp, 'diff', '--name-only', 'HEAD').splitlines()) | set(git(tmp, 'ls-files', '--others', '--exclude-standard').splitlines())
            extra = sorted(p for p in changed if not p.startswith('beta/'))
            tracked = set(git(tmp, 'ls-tree', '-r', '--name-only', 'HEAD').splitlines())
            ids, new_ids, problems = build_pages.changed_targets(tmp, changed, tracked)
            if extra or problems:
                raise SystemExit('%sпубликация остановлена: затронуто то, что должно остаться как на main:\n  • %s' % (tag, '\n  • '.join(['вне beta/: %s' % p for p in extra] + problems)))
            print('%sпиксели снимаются только у целей, чьи файлы меняются: %s%s' % (tag, ', '.join(ids) or '—', ('; новые: ' + ', '.join(new_ids)) if new_ids else ''))
            print('%sвсе остальные страницы и их файлы (в т.ч. engine/, beta/engine/) побайтно как на main' % tag)
            if ids and not run_check(tmp, True, only=ids, allow_only=ids):
                raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная (проблемы, ошибки консоли, fps). Открой отчёт (ссылка выше), исправь и повтори; обход — только явным --skip-check.' % tag)
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
