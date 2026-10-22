#!/usr/bin/env python3
"""Публикует ГЛАВНУЮ страницу chka.am и всё, что меняет её редизайн (s35–s39), из ветки в main — одним коммитом.

  python3 tools/publish_hub.py --dry-run               # собрать во временной копии main, проверить, показать изменения (без коммита и пуша)
  python3 tools/publish_hub.py --dry-run --skip-check  # только сборка и сверка файлов, без тяжёлой защитной проверки (быстро, для отладки)
  python3 tools/publish_hub.py                         # опубликовать: коммит в main + пуш (обычный, без --force)
  python3 tools/publish_hub.py -m "сообщение"

Зачем отдельный скрипт: publish_building / publish_kukuruznik намеренно останавливаются, если главная в ветке отличается от сайта
не только карточкой здания («чужие правки главной не уезжают»). Редизайн главной — как раз такая правка, поэтому у неё свой вход.

Что уходит на сайт (payload() ниже — больше ничего). s39: раньше ехали только index.html, hub-museum.css и card.webp — а редизайн 10а/10б
меняет и общие стили/скрипты, и подвал страниц зданий; главная уехала бы со старым hub.css. Теперь:
  • index.html                         — главная из ветки; карточки и стопки живых зданий (метки card:/stack:) обязаны совпасть с тем, что
                                         собирает build_pages из building.json (иначе стоп: сначала публикация здания);
  • assets/ — SHARED_ASSETS            — общие стили и скрипты главной и страниц about/history (hub.css, hub-museum.css, story.css,
                                         chka-common.js, hub.js) + всё из assets/, на что ссылаются эти страницы (src, href и srcset:
                                         s40 — hub-pages.css, history.css, картинки сравнения compare-kuk-*);
  • kukuruznik/card.webp               — картинка карточки Кукурузника;
  • about.html / history.html зданий   — у Кукурузника из kukuruznik/, у тестовых живых зданий (lenin) — из tests/<имя>/ так же, как их
                                         кладёт publish_building (адреса пересчитаны, без noindex), и их копии в бете beta/tests/<имя>/
                                         (если бета есть на сайте) — общий подвал и ?v= стилей на всех страницах одинаковые.
  Самопроверка payload_problems(): каждый файл assets/, на который ссылается любая страница из этого списка, едет вместе с ней
  (tools/test_build_pages.py ловит обратное: старый список из трёх файлов — красный).
Сверки перед пушем:
  1. test_build_pages зелёный; метки card:<slug>/stack:<slug> живых зданий на месте и карточки == build_pages;
  2. файлы, нужные главной (шрифты engine/fonts/…, картинки карточек), уже лежат на сайте (main) или едут этим коммитом;
  3. в коммит попадают только файлы payload; страницы, которые от них зависят, — только главная и about/history (иначе стоп);
     остальные страницы сайта и их файлы побайтно как на main (build_pages.untouched_problems);
  4. tools/check_site.mjs: главная и затронутые about/history снимаются (различия допустимы — намеренные), живые здания — строго 0
     отличий; ошибки, 404, fps и шапка/превью проверяются всегда. Красная — не пушит; обход только --skip-check.
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
SHARED_ASSETS = ['assets/hub.css', 'assets/hub-museum.css', 'assets/story.css', 'assets/chka-common.js', 'assets/hub.js', 'assets/pg-pencil-560.webp', 'assets/pg-pencil-920.webp', 'assets/pg-water-560.webp', 'assets/pg-water-920.webp', 'assets/pg-brush.webp', 'assets/pg-wash.webp']   # s43: гранат Gemini + маски (маски — только в CSS)
KUK_PAGES = ['kukuruznik/about.html', 'kukuruznik/history.html']
HUB_FILES = ['index.html'] + SHARED_ASSETS + ['kukuruznik/card.webp'] + KUK_PAGES   # постоянная часть; страницы тестовых живых зданий — payload()
_ASSET_REF = re.compile(r'(?:src|href)="((?:\.\./)*assets/[^"?#]+)')
_SRCSET = re.compile(r'srcset="([^"]+)"')   # s40: картинки сравнения «архив ⇄ рисунок» стоят только в srcset — их тоже везём


def payload(root=None, site=None):
    """{путь на сайте: байты} — всё, что публикует главная. site — корень сайта (временная копия main): страницы беты тестового здания
    добавляются, только если бета там есть. Страницы живых тестовых зданий — тем же преобразованием, что publish_building."""
    root = Path(root or ROOT)
    out = {f: (root / f).read_bytes() for f in HUB_FILES if (root / f).is_file()}
    tmp = Path(tempfile.mkdtemp(prefix='chka-hub-pages-'))
    try:
        for slug, src in bp.test_live_slugs(root).items():
            for prefix, page_dir, live in ((slug + '/', slug + '/', True), ('beta/%s/' % src, 'beta/%s/' % src, False)):
                if not live and (site is None or not (Path(site) / prefix / 'index.html').is_file()):
                    continue
                d = tmp / prefix
                d.mkdir(parents=True, exist_ok=True)
                for name in bp.copy_own_pages(src, d, page_dir, root):
                    if name.endswith('.html'):
                        t = (d / name).read_text(encoding='utf-8')
                        out[prefix + name] = (bp._NOINDEX.sub('', t) if live else t).encode('utf-8')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # каждая страница едет вместе со ВСЕМИ своими файлами assets/ (одинаковые с main в коммит не попадут — git их не увидит)
    for ref in asset_refs(out):
        if ref not in out and (root / ref).is_file():
            out[ref] = (root / ref).read_bytes()
    return out


def asset_refs(files):
    """{файл assets/: [страницы]} — на что ссылаются html-страницы из files (адреса приведены к корню сайта)."""
    refs = {}
    for path, data in sorted(files.items()):
        if not path.endswith('.html'):
            continue
        base = path.rsplit('/', 1)[0] + '/' if '/' in path else ''
        text = data.decode('utf-8', 'replace')
        found = _ASSET_REF.findall(text) + [u.strip().split()[0] for ss in _SRCSET.findall(text) for u in ss.split(',') if u.strip()]
        for ref in found:
            if 'assets/' not in ref:
                continue
            target = bp.posixpath.normpath(bp.posixpath.join(base, ref.split('?')[0]))
            if target.startswith('assets/'):
                refs.setdefault(target, []).append(path)
    return refs


def payload_problems(files):
    """Файлы assets/, на которые ссылаются страницы из files, но которых нет в files (страница уехала бы со старыми стилями/скриптами)."""
    return sorted('%s ссылается на %s, а он не едет' % (pg[0], ref) for ref, pg in asset_refs(files).items() if ref not in files)


def footer_of(html_text):
    m = re.search(r'<footer class="foot[^"]*">.*?</footer>', html_text, re.S)
    return m.group(0) if m else None


def footer_problems(files):
    """Страницы из files, у которых подвал не такой, как на главной (подвал один на весь сайт)."""
    feet = {p: footer_of(d.decode('utf-8')) for p, d in files.items() if p.endswith('.html')}
    return sorted(p for p, f in feet.items() if f is None or f != feet.get('index.html'))


def affected_pages(site, changed):
    """Страницы сайта site, которые меняются, если поменять файлы changed (сама страница или любая её зависимость). Ссылка на другую
    страницу (просмотрщик -> about.html) — не зависимость: изменённые html-страницы обходом не продолжаются."""
    changed = set(changed)
    stop = {'index.html'} | {f for f in changed if f.endswith('.html')}
    # s42: about/history зданий — отдельные страницы, просмотрщик на них только ССЫЛАЕТСЯ. Раньше обход останавливался на них,
    # лишь когда они сами менялись; после публикации s41 они на main такие же, как в ветке, обход шёл сквозь них к общим стилям
    # главной, и просмотрщик ложно считался задетым. Сами about/history по-прежнему проверяются как страницы (pg == page обходится).
    stop |= {pg for pg in bp.site_pages(site) if pg.rsplit('/', 1)[-1] in bp.OWN_PAGES}
    return sorted(pg for pg in bp.site_pages(site) if ({pg} | bp.page_deps(site, pg, stop=stop)) & changed)


def hub_needs(text):
    """Файлы сайта, на которые ссылается главная и её слой стилей (без внешних адресов и #якорей): относительно корня сайта."""
    refs = set(re.findall(r'(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"', text))
    css = ''.join((ROOT / f).read_text(encoding='utf-8') for f in ('assets/hub.css', 'assets/hub-museum.css'))   # s39: шрифты — в hub.css
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
    ap = argparse.ArgumentParser(description='Главная + общие стили/скрипты + about/history зданий из ветки -> main через временный worktree.')
    ap.add_argument('--dry-run', action='store_true', help='собрать, проверить и показать изменения; без коммита и пуша')
    ap.add_argument('--diff', metavar='FILE', help='записать полный diff того, что уйдёт в main, в файл')
    ap.add_argument('--skip-check', action='store_true', help='ОБХОД защитной проверки — только осознанно')
    ap.add_argument('-m', '--message', help='сообщение коммита')
    args = ap.parse_args()
    tag = '[dry-run] ' if args.dry_run else ''
    message = args.message or 'hub: главная и подвал страниц — редизайн 10а/10б — %s' % time.strftime('%Y-%m-%d %H:%M')

    missing = [f for f in ['index.html'] + SHARED_ASSETS + ['kukuruznik/card.webp'] if not (ROOT / f).is_file()]
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
        absent = [f for f in hub_needs(src_hub) if f not in HUB_FILES and not (tmp / f).exists()]   # HUB_FILES — постоянная часть payload
        if absent:
            raise SystemExit('СТОП: главная ссылается на файлы, которых нет на сайте и которые не едут этим коммитом: %s' % ', '.join(absent))
        print('%sвсе файлы, на которые ссылается главная, есть на сайте' % tag)

        # 3. копируем только payload (главная, общие стили/скрипты, about/history зданий)
        files = payload(ROOT, tmp)
        pp = payload_problems(files)
        if pp:
            raise SystemExit('СТОП: страницы уехали бы без своих стилей/скриптов:\n  • ' + '\n  • '.join(pp))
        odd = footer_problems(files)
        if odd:
            raise SystemExit('СТОП: подвал не такой, как на главной: %s' % ', '.join(odd))
        for f, data in files.items():
            dst = tmp / f
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)
        pb.git(tmp, 'add', '-A', *files)
        staged = pb.git(tmp, 'diff', '--cached', '--name-only').splitlines()
        outside = [p for p in staged if p not in files]
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
        own = {p for p in files if p.endswith('.html')}
        affected = affected_pages(tmp, staged)
        foreign = [pg for pg in affected if pg not in own]
        if foreign:
            raise SystemExit('%sСТОП: публикация меняет и чужие страницы (не главную и не about/history): %s' % (tag, ', '.join(foreign)))
        nt = bp.untouched_problems(tmp, set(staged), set(affected), stop={'index.html'} | own)
        if nt:
            raise SystemExit('%sСТОП: публикация задевает другие страницы:\n  • %s' % (tag, '\n  • '.join(nt)))
        ids = ['hub' if pg == 'index.html' else bp.check_id(pg) for pg in affected]
        print('%sменяются страницы: %s; остальные страницы и их файлы побайтно как на main' % (tag, ', '.join(affected)))

        # 5. защитная проверка
        if args.skip_check:
            print('%s!!! ЗАЩИТНАЯ ПРОВЕРКА ПРОПУЩЕНА (--skip-check) !!!' % tag)
        elif not pb.run_check(tmp, strict=True, allow_extra=ids, only=sorted({*ids, *bp.live_buildings(site=tmp)}), twins=False):
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
