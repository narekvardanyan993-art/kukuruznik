#!/usr/bin/env python3
"""Переводит живые здания на проверенный движок беты (docs/ENGINE-PLAN.md, п.4 и этап 5).

  python3 tools/publish_engine.py --dry-run              # собрать во временной копии main, проверить, показать изменения (без коммита и пуша)
  python3 tools/publish_engine.py --dry-run --diff F     # то же + полный diff того, что уйдёт в main, в файл F
  python3 tools/publish_engine.py                        # опубликовать: ОДИН коммит в main + пуш (обычный, без --force)
  python3 tools/publish_engine.py --expect-change        # движок НАМЕРЕННО меняет вид живых зданий (новая версия, проверенная на бете)
  python3 tools/publish_engine.py -m "engine: …"         # своё сообщение коммита

Порядок жизни движка: правка в engine/ → tools/publish_beta.py (бета на beta/engine/) → проверка беты на телефоне →
tools/publish_engine.py (beta/engine/ → engine/, пересборка страниц всех зданий). Откат = отмена одного коммита (git revert).

Скрипт сам:
  1. git fetch и ВРЕМЕННЫЙ worktree от origin/main во временной папке вне репозитория;
  2. самопроверка сборщика (tools/test_build_pages.py);
  3. требует, чтобы бета на сайте была собрана из ТЕКУЩЕГО исходника движка: файлы beta/engine/ в main == engine/ побайтно
     (иначе на живые здания ушёл бы движок, который на бете не проверяли) — стоп с объяснением;
  4. собирает: beta/ (tools/build_pages.build_beta), engine/ = beta/engine/ (проверенный), <здание>/index.html и manifest.json
     каждого живого здания (папки с building.json) на engine/ с ?v=<версия движка> во всех адресах движка;
  5. защитная проверка tools/check_site.mjs: кандидат против origin/main СТРОГО (ноль различий у всех целей, шапка/превью без
     изменений, ошибки/404/fps), бета-Кукурузник — строго против живого. Красная — не пушит; обход только --skip-check.
     С --expect-change (новый движок меняет картинку живых зданий, строгое «до/после» для них невозможно): различия картинок
     допускаются ТОЛЬКО у живых зданий и их беты-пары (ошибки, 404, fps проваливают как обычно); пиксели снимаются только у них
     (check_site --only). У всех остальных страниц (хаб, about/history, beta/tests/*, …) пикселей нет — вместо них побайтно: ни
     страница, ни файлы, от которых она зависит (engine/, beta/engine/, ассеты), не меняются публикацией (build_pages.untouched_problems);
     для самих живых зданий вместо пикселей проверяется то, что проверено на бете, — скриптом, точно:
       • beta/ после пересборки не изменилась ни в одном файле (бета на сайте — ровно та, что владелец смотрел на iPhone);
       • <здание>/index.html и manifest.json == beta/<здание>/… побайтно (после замены адресов и без двух тегов noindex), engine/ == beta/engine/;
       • шапка живого здания (title, description, canonical, og:*, twitter:*, иконки, viewport, lang) прежняя — меняется только версия движка;
       • в коммит идут только engine/, beta/ (пусто), <здание>/index.html, <здание>/manifest.json — about/history и всё остальное не тронуты;
  6. коммитит ТОЛЬКО beta/, engine/ и <здание>/index.html, <здание>/manifest.json живых зданий — одним коммитом;
  7. в конце ВСЕГДА удаляет временный worktree.
"""
import argparse
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp   # noqa: E402
import publish_beta as pb  # noqa: E402  git(), remove_worktree(), run_check()

ROOT = bp.ROOT


def allowed_paths(bdirs):
    """Что этот скрипт имеет право менять в main."""
    return lambda p: p.startswith('beta/') or p.startswith('engine/') or any(p in ('%s/index.html' % b, '%s/manifest.json' % b) for b in bdirs)


def main():
    ap = argparse.ArgumentParser(description='Проверенный бета-движок -> живые здания (одним коммитом в main).')
    ap.add_argument('--dry-run', action='store_true', help='собрать, проверить и показать изменения; без коммита и пуша')
    ap.add_argument('--diff', metavar='FILE', help='записать полный diff того, что уйдёт в main, в файл')
    ap.add_argument('--expect-change', action='store_true', help='движок намеренно меняет вид живых зданий: картинки живых зданий не сравниваются с прежними, взамен — точная проверка «живое == проверенная бета»')
    ap.add_argument('--skip-check', action='store_true', help='ОБХОД защитной проверки — только осознанно')
    ap.add_argument('-m', '--message', help='сообщение коммита')
    args = ap.parse_args()
    tag = '[dry-run] ' if args.dry_run else ''
    bdirs = bp.live_buildings()
    message = args.message or 'engine: живые здания (%s) на движке %s — %s' % (', '.join(bdirs), bp.engine_version(), time.strftime('%Y-%m-%d %H:%M'))

    pb.git(ROOT, 'fetch', pb.REMOTE, pb.BRANCH)
    base = pb.git(ROOT, 'rev-parse', '%s/%s' % (pb.REMOTE, pb.BRANCH))
    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-engine-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, pb.REMOTE, pb.BRANCH, base[:7]))
    try:
        pb.git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        st = subprocess.run([sys.executable, str(ROOT / 'tools' / 'test_build_pages.py')], capture_output=True, text=True)
        if st.returncode != 0:
            raise SystemExit('самопроверка сборщика (tools/test_build_pages.py) красная:\n' + st.stdout[-3000:])
        # 3. движок, который пойдёт на живые здания, уже стоит на бете
        on_beta, src = bp.engine_files(tmp / 'beta' / 'engine'), bp.engine_files(bp.ENGINE)
        if on_beta != src:
            diff = sorted(k for k in set(on_beta) | set(src) if on_beta.get(k) != src.get(k))
            raise SystemExit('СТОП: бета на сайте собрана не из текущего движка (отличаются: %s).\n'
                             'Сначала tools/publish_beta.py, проверка беты на телефоне — потом этот скрипт.' % ', '.join(diff))
        # 4. сборка: бета (страницы по текущему шаблону), живой движок = проверенный beta/engine/, живые здания
        files = bp.build_beta(tmp)
        files += bp.build_live(tmp, bdirs, engine_from=tmp / 'beta' / 'engine')
        print('%sсобрано: %d файлов (движок %s, живые здания: %s)' % (tag, len(files), bp.engine_version(), ', '.join(bdirs)))
        pb.git(tmp, 'add', '-A', 'beta', 'engine', *['%s/index.html' % b for b in bdirs], *['%s/manifest.json' % b for b in bdirs])
        staged = pb.git(tmp, 'diff', '--cached', '--name-only').splitlines()
        ok = allowed_paths(bdirs)
        outside = [p for p in staged if not ok(p)]
        if outside:
            raise SystemExit('в коммит попало лишнее: %s — стоп' % outside)
        if not staged:
            print('%sизменений нет — публиковать нечего' % tag)
            return
        print('%sизменено файлов: %d' % (tag, len(staged)))
        print(pb.git(tmp, 'diff', '--cached', '--stat', '--stat-width=110'))
        if args.diff:
            Path(args.diff).write_text(pb.git(tmp, 'diff', '--cached', '--stat', '--stat-width=110') + '\n\n' + pb.git(tmp, 'diff', '--cached'), encoding='utf-8')
            print('%sполный diff: %s' % (tag, args.diff))
        # 5. проверка: всё строго (ни одна цель не может отличаться), бета-Кукурузник — строго против живого
        if args.skip_check:
            print('%s!!! ЗАЩИТНАЯ ПРОВЕРКА ПРОПУЩЕНА (--skip-check) !!!' % tag)
        elif args.expect_change:
            problems = []
            beta_changed = [p for p in staged if p.startswith('beta/')]
            if beta_changed:
                problems.append('beta/ изменилась при пересборке (%d файлов, например %s): бета на сайте — не та, что собирается сейчас' % (len(beta_changed), beta_changed[0]))
            problems += bp.live_vs_beta(tmp, bdirs)
            for b in bdirs:
                old = pb.git(ROOT, 'show', '%s:%s/index.html' % (base, b), check=False)
                new = (tmp / b / 'index.html').read_text(encoding='utf-8')
                problems += ['%s: шапка изменилась — %s' % (b, c) for c in (bp.head_changes(old, new) if old else ['на сайте не было страницы'])]
            if problems:
                raise SystemExit('%sпубликация остановлена: живое здание не равно проверенной бете:\n  • %s' % (tag, '\n  • '.join(problems)))
            print('%sживое == проверенная бета (страницы, манифест, движок), шапка прежняя, beta/ не менялась' % tag)
            # остальные цели (хаб, about/history, beta/tests/*, …): пиксели не снимаем — побайтно: ни страница, ни её зависимости
            # (в том числе engine/ и beta/engine/) не меняются этой публикацией; в рабочей копии нет других изменений, чем коммит
            dirty = [l[3:] for l in pb.git(tmp, 'status', '--porcelain', '-uall').splitlines()]
            twins = ['beta/%s' % b for b in pb.LIVE_TWINS]
            exempt = {'%s/index.html' % b for b in list(bdirs) + twins}
            extra = [p for p in dirty if not ok(p)]
            nt = bp.untouched_problems(tmp, set(staged) | set(dirty), exempt)
            if extra or nt:
                raise SystemExit('%sпубликация остановлена: затронуто то, что должно остаться как на main:\n  • %s' % (tag, '\n  • '.join(['вне разрешённых путей: %s' % p for p in extra] + nt)))
            print('%sостальные страницы и их файлы (в т.ч. beta/engine/) побайтно как на main; пиксели снимаются только у %s' % (tag, ', '.join(sorted(set(bdirs) | set(twins)))))
            allow = list(bdirs) + twins
            if not pb.run_check(tmp, strict=True, allow_extra=allow, only=list(bdirs) + twins):
                raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная (проблемы, ошибки консоли, fps); обход — только явным --skip-check.' % tag)
        elif not pb.run_check(tmp, strict=True):
            raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная; обход — только явным --skip-check.' % tag)
        if args.dry_run:
            print('[dry-run] СДЕЛАЛ БЫ: git commit -m "%s" + git push %s HEAD:%s (без --force); ничего не отправлено' % (message, pb.REMOTE, pb.BRANCH))
            return
        pb.git(tmp, 'commit', '-m', message)
        head = pb.git(tmp, 'rev-parse', 'HEAD')
        pb.git(tmp, 'push', pb.REMOTE, 'HEAD:%s' % pb.BRANCH)
        print('запушено в %s/%s: %s' % (pb.REMOTE, pb.BRANCH, head[:7]))
        print('откат одним коммитом: git revert %s (из временного worktree main, затем пуш)' % head[:7])
    finally:
        pb.remove_worktree(tmp)
        print('%sвременный worktree удалён' % tag)


if __name__ == '__main__':
    main()
