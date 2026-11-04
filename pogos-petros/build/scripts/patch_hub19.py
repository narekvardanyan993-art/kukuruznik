#!/usr/bin/env python3
"""Заход 19 (шаг 8): наклейка Погос-Петроса на главной — скрыта до live.
 • index.html: «скоро №003» обёрнута метками card:pogos-petros (живая главная не меняется: внутри меток та же заглушка);
 • build_pages: card_markup(base=…), pending_slugs(), render_pending_card(), hub_with_pending_cards() — наклейка на бете/в предпросмотре;
 • preview_site: бета-страницы + наклейка. Идемпотентно (guard-строки)."""
import re, sys
from pathlib import Path
R = Path('.')


def rep(t, old, new, tag, guard):
    if guard in t:
        return t
    if t.count(old) != 1:
        sys.exit('СТОП %s: якорь найден %d раз' % (tag, t.count(old)))
    return t.replace(old, new)


# --- index.html
p = R / 'index.html'; t = p.read_text(encoding='utf-8')
if 'card:pogos-petros' not in t:
    m = re.search(r'(      <li class="card soon reveal">\n(?:(?!</li>).)*?№ 003.*?</li>\n)', t, re.S)
    assert m and m.group(1).count('<li') == 1, 'нет заглушки №003'
    t = t.replace(m.group(1), '      <!-- card:pogos-petros -->\n' + m.group(1) + '      <!-- /card:pogos-petros -->\n', 1)
    p.write_text(t, encoding='utf-8')

# --- build_pages
p = R / 'tools/build_pages.py'; t = p.read_text(encoding='utf-8')
t = rep(t, "def card_markup(slug, image, eyebrow, title, meta, about, no=None, hall='I'):",
        "def card_markup(slug, image, eyebrow, title, meta, about, no=None, hall='I', base=None):", 'cm1', "hall='I', base=None")
t = rep(t, '    e = lambda t: html.escape(t, quote=True)\n    lines = [\n        \'      <li class="card reveal">\',',
        '    e = lambda t: html.escape(t, quote=True)\n    pre = base or slug   # адрес папки здания от главной: у живого — slug, у ещё не живого на бете — beta/tests/<имя>\n    lines = [\n        \'      <li class="card reveal">\',', 'cm2', 'pre = base or slug')
body_a = t.index("def card_markup(")
body_z = t.index("HALL_WORD = {")
seg = t[body_a:body_z]
seg2 = (seg.replace("""href="%s/about.html" aria-labelledby="t-%s">' % (e(slug), e(slug))""", """href="%s/about.html" aria-labelledby="t-%s">' % (e(pre), e(slug))""")
        .replace("""src="%s/%s" width="480" height="480" alt="" loading="lazy" decoding="async"></div>' % (e(slug), e(image))""", """src="%s/%s" width="480" height="480" alt="" loading="lazy" decoding="async"></div>' % (e(pre), e(image))""")
        .replace("""href="%s/" data-transition>%s<span>%s</span></a>' % (e(slug), CUBE_ICON""", """href="%s/" data-transition>%s<span>%s</span></a>' % (e(pre), CUBE_ICON""")
        .replace("""href="%s/about.html">%s<span>%s</span></a>' % (e(slug), PAGE_ICON""", """href="%s/about.html">%s<span>%s</span></a>' % (e(pre), PAGE_ICON"""))
t = t[:body_a] + seg2 + t[body_z:]
NEW = '''

def pending_slugs(root=None):
    """{адрес: папка} тестовых зданий с блоком card, у которых в index.html есть метки card:<адрес> и которые ещё НЕ живые (нет блока live).
    На живом сайте их метки хранят заглушку «скоро» (карточка скрыта); на бете и в предпросмотре (hub_with_pending_cards) — наклейка."""
    root = Path(root or ROOT)
    hub = (root / 'index.html').read_text(encoding='utf-8') if (root / 'index.html').is_file() else ''
    out = {}
    t = root / 'tests'
    if t.is_dir():
        for d in sorted(t.iterdir()):
            f = d / 'building.json'
            if d.name == 'local' or not f.exists():
                continue
            b = json.loads(f.read_text(encoding='utf-8'))
            if isinstance(b.get('card'), dict) and not isinstance(b.get('live'), dict) and _card_span(hub, d.name):
                out[d.name] = 'tests/' + d.name
    return out


def render_pending_card(slug, root=None):
    """Наклейка ещё не живого здания (бета/предпросмотр): те же метки и та же разметка, что у живой, но адреса — в бете (beta/tests/<имя>/)."""
    src = pending_slugs(root)[slug]
    b = load_building(src, root)
    cd = b['card']
    no = (b.get('postcard') or {}).get('no')
    lines = ['      <!-- card:%s — БЕТА: наклейка из %s/building.json, на живом сайте скрыта до блока live -->' % (slug, src)]
    lines += card_markup(slug, cd['image'], cd['eyebrow'], cd.get('title') or b['text']['title'], cd['meta'], _about_label(src, root), no, base='beta/' + src)
    lines.append('      <!-- /card:%s -->' % slug)
    return '\\n'.join(lines)


def hub_with_pending_cards(hub, root=None):
    """Главная с наклейками всех ещё не живых зданий (pending_slugs) на месте их меток. Для беты/предпросмотра; живая главная — index.html как есть."""
    for slug in pending_slugs(root):
        hub = hub_with_card(hub, slug, render_pending_card(slug, root))
    return hub
'''
t = rep(t, "\n\ndef hub_outside_diff(old, new, slug):", NEW + "\n\ndef hub_outside_diff(old, new, slug):", 'bp3', 'def pending_slugs')
p.write_text(t, encoding='utf-8')

# --- preview_site
p = R / 'tools/preview_site.py'; t = p.read_text(encoding='utf-8')
t = rep(t, "    (out / 'index.html').write_text(hub, encoding='utf-8')\n",
        "    hub = bp.hub_with_pending_cards(hub)   # шаг 8: наклейки ещё не живых зданий (скрыты на живом сайте до блока live) — здесь видны\n    (out / 'index.html').write_text(hub, encoding='utf-8')\n", 'pv1', 'hub_with_pending_cards')
t = rep(t, "    bp.build_live(out, slugs, engine_from=ROOT / 'engine')\n    return slugs\n",
        "    bp.build_live(out, slugs, engine_from=ROOT / 'engine')\n    bp.build_beta(out)   # шаг 8: бета ветки (beta/tests/<имя>/ — ещё не живые здания и страницы к наклейкам)\n"
        "    for slug, src in bp.pending_slugs().items():\n        shutil.copyfile(ROOT / src / 'card.webp', out / 'beta' / src / 'card.webp')   # картинка наклейки (в бету она не входит — только в предпросмотр)\n    return slugs\n", 'pv2', 'pending_slugs')
p.write_text(t, encoding='utf-8')
print('OK patch_hub19')
