#!/usr/bin/env python3
"""Публикует ГЛАВНУЮ страницу chka.am (редизайн «музейная открытка», s35) из ветки в main — только главную, ничего больше.

  python3 tools/publish_hub.py --dry-run               # собрать во временной копии main, проверить, показать изменения (без коммита и пуша)
  python3 tools/publish_hub.py --dry-run --skip-check  # только сборка и сверка файлов, без тяжёлой защитной проверки (быстро, для отладки)
  python3 tools/publish_hub.py                         # опубликовать: коммит в main + пуш (обычный, без --force)
  python3 tools/publish_hub.py -m "сообщение"

Зачем отдельный скрипт: publish_building / publish_kukuruznik намеренно останавливаются, если главная в ветке отличается от сайта
не только карточкой здания («чужие правки главной не уезжают»). Редизайн главной — как раз такая правка, поэтому у неё свой вход.

Что уходит на сайт (список HUB_FILES ниже — больше ничего):
  • index.html                  — главная из ветки; карточки и стопки живых зданий (метки card:/stack:) обязаны совпасть с тем, что
                                  собирает build_pages из building.json (иначе стоп: сначала публикация здания);
  • assets/hub-museum.css       — слой стилей редизайна поверх assets/hub.css (hub.css, hub.js, i18n.js, chka-common.js НЕ трогаются);
  • kukuruznik/card.webp        — картинка карточки Кукурузника (кадр нового стиля).
Сверки перед пушем:
  1. test_build_pages зелёный; метки card:<slug>/stack:<slug> живых зданий на месте и карточки == build_pages;
  2. файлы, нужные главной (шрифты engine/fonts/…, картинки карточек, скрипты), уже лежат на сайте (main);
  3. в коммит попадают только HUB_FILES; остальные страницы сайта и их файлы побайтно как на main
     (build_pages.untouched_problems: зависимость от kukuruznik/card.webp у других страниц — стоп);
  4. tools/check_site.mjs: главная снимается (различия допустимы — намеренные), остальные живые здания — строго 0 отличий; ошибки, 404, fps
     и шапка/превью проверяются всегда. Красная — не пушит; обход только --skip-check.
Откат: git revert <коммит> (печатается после пуша). Временный worktree удаляется всегда.
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
import build_pages as bp   # noqa: E402
import publish_beta as pb  # noqa: E402  git(), remove_worktree(), run_check()

ROOT = bp.ROOT
HUB_FILES = ['index.html', 'assets/hub-museum.css', 'kukuruznik/card.webp']


def hub_needs(text):
    """Файлы сайта, на которые ссылается главная и её слой стилей (без внешних адресов и #якорей): относительно корня сайта."""
    refs = set(re.findall(r'(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"', text))
    css = (ROOT / 'assets' / 'hub-museum.css').read_text(encoding='utf-8')
    refs |= {'assets/' + posix.split('?')[0] if not posix.startswith('../') else posix[3:].split('?')[0]
             for posix in re.findall(r'url\("([^"]+?)"\)', css) if not posix.startswith(('data:', 'http'))}
    # ссылки на страницы зданий (каталоги с / на конце) проверяются check_site, здесь — только файлы
    return sorted(r for r in refs if not r.endswith('/') and '.' in r.rsplit('/', 1)[-1])


def hub_cards_problems(hub, slugs, root):
    """Для каждого живого здания с карточкой из building.json: метки на месте и текст между ними == build_pages (иначе главная устарела)."""
    bad = []
    for slug in slugs:
        try:
            want = bp.hub_with_card(hub, slug, bp.render_card(slug, root), bp.render_stack(slug, root))
        except SystemExit as e:
            bad.append('%s: %s' % (slug, e))
            continue
        if want != hub:
            bad.append('карточка/стопка %s в index.html не совпадает с building.json — сначала tools/publish_building.py %s (или обнови метки)' % (slug, slug))
    return bad


def main():
    ap = argparse.ArgumentParser(description='Главная (index.html + assets/hub-museum.css + kukuruznik/card.webp) из ветки -> main через временный worktree.')
    ap.add_argument('--dry-run', action='store_true', help='собрать, проверить и показать изменения; без коммита и пуша')
    ap.add_argument('--diff', metavar='FILE', help='записать полный diff того, что уйдёт в main, в файл')
    ap.add_argument('--skip-check', action='store_true', help='ОБХОД защитной проверки — только осознанно')
    ap.add_argument('-m', '--message', help='сообщение коммита')
    args = ap.parse_args()
    tag = '[dry-run] ' if args.dry_run else ''
    message = args.message or 'hub: главная — редизайн «музейная открытка» — %s' % time.strftime('%Y-%m-%d %H:%M')

    missing = [f for f in HUB_FILES if not (ROOT / f).is_file()]
    if missing:
        raise SystemExit('СТОП: в ветке нет файлов главной: %s' % ', '.join(missing))
    src_hub = (ROOT / 'index.html').read_text(encoding='utf-8')

    pb.git(ROOT, 'fetch', pb.REMOTE, pb.BRANCH)
    base = pb.git(ROOT, 'rev-parse', '%s/%s' % (pb.REMOTE, pb.BRANCH))
    tmp = Path(tempfile.mkdtemp(prefix='chka-publish-hub-'))
    print('%sвременный worktree: %s (от %s/%s = %s)' % (tag, tmp, pb.REMOTE, pb.BRANCH, base[:7]))
    try:
        pb.git(ROOT, 'worktree', 'add', '--detach', str(tmp), base)
        st = subprocess.run([sys.executable, str(ROOT / 'tools' / 'test_build_pages.py')], capture_output=True, text=True)
        if st.returncode != 0:
            raise SystemExit('самопроверка сборщика (tools/test_build_pages.py) красная:\n' + st.stdout[-3000:])

        # 1. карточки живых тестовых зданий в главной == building.json
        live = bp.test_live_slugs()
        on_site = [s for s in live if (tmp / s / 'index.html').exists()]
        problems = hub_cards_problems(src_hub, on_site, ROOT)
        if problems:
            raise SystemExit('СТОП: главная в ветке устарела относительно зданий:\n  • ' + '\n  • '.join(problems))
        print('%sкарточки живых зданий (%s) совпадают с building.json' % (tag, ', '.join(on_site) or '—'))

        # 2. всё, что нужно главной, уже на сайте (или едет в этом же коммите)
        absent = [f for f in hub_needs(src_hub) if f not in HUB_FILES and not (tmp / f).exists()]
        if absent:
            raise SystemExit('СТОП: главная ссылается на файлы, которых нет на сайте и которые не едут этим коммитом: %s' % ', '.join(absent))
        print('%sвсе файлы, на которые ссылается главная, есть на сайте' % tag)

        # 3. копируем только HUB_FILES
        for f in HUB_FILES:
            dst = tmp / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / f, dst)
        pb.git(tmp, 'add', '-A', *HUB_FILES)
        staged = pb.git(tmp, 'diff', '--cached', '--name-only').splitlines()
        outside = [p for p in staged if p not in HUB_FILES]
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

        # 4. другие страницы побайтно как на main (главная меняется намеренно; ссылка на неё — не зависимость)
        nt = bp.untouched_problems(tmp, set(staged), {'index.html'}, stop={'index.html'})
        if nt:
            raise SystemExit('%sСТОП: публикация задевает другие страницы:\n  • %s' % (tag, '\n  • '.join(nt)))
        print('%sостальные страницы и их файлы побайтно как на main' % tag)

        # 5. защитная проверка
        if args.skip_check:
            print('%s!!! ЗАЩИТНАЯ ПРОВЕРКА ПРОПУЩЕНА (--skip-check) !!!' % tag)
        elif not pb.run_check(tmp, strict=True, allow_extra=['hub'], only=sorted({'hub', *bp.live_buildings(site=tmp)}), twins=False):
            raise SystemExit('%sпубликация остановлена: защитная проверка не зелёная; обход — только явным --skip-check.' % tag)
        if args.dry_run:
            print('[dry-run] СДЕЛАЛ БЫ: git commit -m "%s" + git push %s HEAD:%s (без --force); ничего не отправлено' % (message, pb.REMOTE, pb.BRANCH))
            return
        pb.git(tmp, 'commit', '-m', message)
        head = pb.git(tmp, 'rev-parse', 'HEAD')
        pb.git(tmp, 'push', pb.REMOTE, 'HEAD:%s' % pb.BRANCH)
        print('запушено в %s/%s: %s — https://chka.am/' % (pb.REMOTE, pb.BRANCH, head[:7]))
        print('ОТКАТ одним коммитом: git revert %s (из временного worktree main, затем пуш)' % head[:7])
    finally:
        pb.remove_worktree(tmp)
        print('%sвременный worktree удалён' % tag)


if __name__ == '__main__':
    main()
