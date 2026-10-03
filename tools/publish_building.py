#!/usr/bin/env python3
"""Переводит тестовое здание tests/<имя>/ в живое: chka.am/<slug>/ + карточка на главной — одним коммитом в main.

  python3 tools/publish_building.py lenin --dry-run            # собрать во временной копии main, проверить, показать изменения (без коммита и пуша)
  python3 tools/publish_building.py lenin --dry-run --diff F   # то же + полный diff того, что уйдёт в main, в файл F
  python3 tools/publish_building.py lenin                      # опубликовать: ОДИН коммит в main + пуш (обычный, без --force)
  python3 tools/publish_building.py lenin -m "…"               # своё сообщение коммита

Что нужно в исходнике: tests/<имя>/building.json с блоками
  "live": {"slug": "<slug>", "meta": {url, ogImage, favicon, appleTouchIcon, …}, "links": {"home": "../"}, …} — всё, что у живого
          здания иначе, чем в бете (сливается поверх настроек; адреса — от папки <slug>/ на сайте);
  "card": {"eyebrow", "meta", "image", "history"} — карточка на главной (заголовок — text.title);
и метки <!-- card:<slug> --> … <!-- /card:<slug> --> в index.html (там, где стоит карточка).

Скрипт сам:
  1. git fetch и ВРЕМЕННЫЙ worktree от origin/main во временной папке вне репозитория; самопроверка сборщика;
  2. <slug>/ на сайте собирается заново: кадры, about.html, history.html, gallery/, og-картинка, картинка карточки (без noindex);
     <slug>/index.html и manifest.json — на ЖИВОМ движке engine/ (движок не меняется; не совпадает с исходником — стоп);
  3. главная: карточка здания из building.json; любое другое отличие главной от сайта — стоп (чужие правки главной не уезжают);
  4. в коммит — только <slug>/ и index.html; остальные страницы сайта и их файлы побайтно как на main (build_pages.untouched_problems);
  5. check_site: новое здание и главная — снимаются (различия допустимы, ошибки/404/fps — нет), Кукурузник — строго 0 отличий;
  6. коммит + пуш; печатает команду отката. В конце ВСЕГДА удаляет временный worktree.
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


def main():
    ap = argparse.ArgumentParser(description='Тестовое здание tests/<имя>/ -> живое chka.am/<slug>/ + карточка на главной (одним коммитом в main).')
    ap.add_argument('slug', help='адрес здания на сайте (live.slug в building.json), например lenin')
    ap.add_argument('--dry-run', action='store_true', help='собрать, проверить и показать изменения; без коммита и пуша')
    ap.add_argument('--diff', metavar='FILE', help='записать полный diff того, что уйдёт в main, в файл')
    ap.add_argument('--skip-check', action='store_true', help='ОБХОД защитной проверки — только осознанно')
    ap.add_argument('-m', '--message', help='сообщение коммита')
    args = ap.parse_args()
    slug, tag = args.slug, '[dry-run] ' if args.dry_run else ''
    tl = bp.test_live_slugs()
    if slug not in tl:
        raise SystemExit('СТОП: нет тестового здания с live.slug = %s. Есть: %s' % (slug, ', '.join(tl) or '—'))
    if slug in ('beta', 'engine', 'assets', 'tests', 'docs', 'tools', 'kukuruznik'):
        raise SystemExit('СТОП: адрес %s занят' % slug)
    src_hub = (ROOT / 'index.html').read_text(encoding='utf-8')
    new_hub = bp.hub_with_card(src_hub, slug, bp.render_card(slug))   # метки обязаны быть — до любых действий с git
    message = args.message or '%s: живое здание из %s (движок %s) — %s' % (slug, tl[slug], bp.engine_version(), time.strftime('%Y-%m-%d %H:%M'))

    pb.git(ROOT, 'fetch', pb.REMOTE, pb.BRANCH)
    base = pb.git(ROOT, 'rev-parse', '%s/%s' % (pb.REMOTE, pb.BRANCH))
    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-building-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, pb.REMOTE, pb.BRANCH, base[:7]))
    try:
        pb.git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        st = subprocess.run([sys.executable, str(ROOT / 'tools' / 'test_build_pages.py')], capture_output=True, text=True)
        if st.returncode != 0:
            raise SystemExit('самопроверка сборщика (tools/test_build_pages.py) красная:\n' + st.stdout[-3000:])
        files = bp.place_live_files(tmp, slug)
        files += bp.build_live(tmp, [slug])   # живой движок не меняется; не совпадает с исходником — стоп внутри
        old_hub = (tmp / 'index.html').read_text(encoding='utf-8')
        problems = bp.hub_outside_diff(old_hub, new_hub, slug)
        if problems:
            raise SystemExit('СТОП: главная в ветке отличается от сайта не только карточкой %s:\n  • %s' % (slug, '\n  • '.join(problems)))
        (tmp / 'index.html').write_text(new_hub, encoding='utf-8')
        print('%sсобрано: %d файлов в %s/, карточка на главной' % (tag, len(files), slug))
        pb.git(tmp, 'add', '-A', slug, 'index.html')
        staged = pb.git(tmp, 'diff', '--cached', '--name-only').splitlines()
        outside = [p for p in staged if not (p == 'index.html' or p.startswith(slug + '/'))]
        dirty = [l[3:] for l in pb.git(tmp, 'status', '--porcelain', '-uall').splitlines() if not l.startswith(('A ', 'M ', 'D ', 'R '))]
        if outside or dirty:
            raise SystemExit('в коммит/рабочую копию попало лишнее: %s — стоп' % (outside + dirty))
        if not staged:
            print('%sизменений нет — публиковать нечего' % tag)
            return
        print('%sизменено файлов: %d' % (tag, len(staged)))
        print(pb.git(tmp, 'diff', '--cached', '--stat', '--stat-width=110'))
        if args.diff:
            Path(args.diff).write_text(pb.git(tmp, 'diff', '--cached', '--stat', '--stat-width=110') + '\n\n' + pb.git(tmp, 'diff', '--cached'), encoding='utf-8')
            print('%sполный diff: %s' % (tag, args.diff))
        own = {p for p in bp.site_pages(tmp) if p == 'index.html' or p.startswith(slug + '/')}
        nt = bp.untouched_problems(tmp, set(staged), own, stop={'index.html'})   # главная меняется намеренно (снимается check_site); ссылка на неё — не зависимость
        if nt:
            raise SystemExit('%sСТОП: публикация задевает другие страницы:\n  • %s' % (tag, '\n  • '.join(nt)))
        print('%sостальные страницы и их файлы побайтно как на main' % tag)
        if args.skip_check:
            print('%s!!! ЗАЩИТНАЯ ПРОВЕРКА ПРОПУЩЕНА (--skip-check) !!!' % tag)
        elif not pb.run_check(tmp, strict=True, allow_extra=['hub', slug], only=['hub', slug, 'kukuruznik']):
            raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная; обход — только явным --skip-check.' % tag)
        if args.dry_run:
            print('[dry-run] СДЕЛАЛ БЫ: git commit -m "%s" + git push %s HEAD:%s (без --force); ничего не отправлено' % (message, pb.REMOTE, pb.BRANCH))
            return
        pb.git(tmp, 'commit', '-m', message)
        head = pb.git(tmp, 'rev-parse', 'HEAD')
        pb.git(tmp, 'push', pb.REMOTE, 'HEAD:%s' % pb.BRANCH)
        print('запушено в %s/%s: %s — https://chka.am/%s/' % (pb.REMOTE, pb.BRANCH, head[:7], slug))
        print('ОТКАТ одним коммитом: git revert %s (из временного worktree main, затем пуш)' % head[:7])
    finally:
        pb.remove_worktree(tmp)
        print('%sвременный worktree удалён' % tag)


if __name__ == '__main__':
    main()
