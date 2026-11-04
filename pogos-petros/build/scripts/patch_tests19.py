#!/usr/bin/env python3
"""Заход 19: тесты к подписям кадров (e1.54) и скрытой до live наклейке. Идемпотентно."""
import sys
from pathlib import Path
p = Path('tools/test_build_pages.py'); t = p.read_text(encoding='utf-8')
if 'e1.54' in t:
    print('уже'); sys.exit()
P = "'tests/pogos-petros'"
cases = '''        ('27. подписи кадров: look.captions строкой (e1.54)', %s, set_(lambda b: b['look'].__setitem__('captions', 'yes')), 'look.captions', None),
        ('28. подписи кадров включены, ни у одного кадра нет caption (e1.54)', %s, set_(lambda b: [f.pop('caption', None) for f in b['frames']]), 'ни у одного кадра нет подписи', None),
        ('29. подпись кадра без перевода на en (e1.54)', %s, set_(lambda b: b['frames'][0]['caption'].pop('en')), 'caption', None),
''' % (P, P, P)
anchor = "        ('20. кадр с sway без файла полей (e1.26)'"
i = t.index(anchor); j = t.index('\n', i) + 1
t = t[:j] + cases + t[j:]
# наклейка до live: скрыта на живой главной, видна на бете
chk = '''    # e1.54 / шаг 8: наклейка ещё не живого здания — на живой главной скрыта (метки хранят заглушку «скоро»), на бете/в предпросмотре видна
    pend = bp.pending_slugs()
    for slug, src in pend.items():
        sp = bp._card_span(hub, slug)
        inner = hub[sp[0]:sp[1]] if sp else ''
        hidden = bool(sp) and 'class="card soon reveal"' in inner and 'card-in sticker' not in inner and ('href="%s/' % slug) not in inner
        shown_h = bp.hub_with_pending_cards(hub)
        m = re.search(r'<li class="card reveal">(?:(?!</li>).)*?href="beta/%s/about\\.html".*?</li>' % re.escape(src), shown_h, re.S)
        vis = bool(m) and 'card-in sticker' in m.group(0) and ('beta/%s/card.webp' % src) in m.group(0) and 'class="card soon' not in shown_h[bp._card_span(shown_h, slug)[0]:bp._card_span(shown_h, slug)[1]]
        live_ok = slug not in bp.test_live_slugs() and 'href="%s/' % slug not in hub
        good = hidden and vis and live_ok and (ROOT / src / 'card.webp').is_file() and (ROOT / src / 'card.webp').stat().st_size < 80 * 1024
        lines.append('%s  наклейка %s: на живой главной скрыта (заглушка «скоро» в метках), на бете видна (ссылки в beta/%s/); card.webp ≤ 80 КБ' % ('OK   ' if good else 'ОШИБКА', slug, src))
        ok_all &= bool(good)
    red_p = bool(pend) and 'card-in sticker' in bp.hub_with_pending_cards(hub) and bp.hub_with_pending_cards(hub) != hub
    h2 = hub.replace('<!-- card:pogos-petros -->', '', 1)
    try:
        bp.hub_with_card(h2, 'pogos-petros', 'x'); red_m = False
    except SystemExit:
        red_m = True
    lines.append('%s  красные случаи наклейки: без меток карточка не ставится, пока не live — живая главная не меняется' % ('OK   ' if red_m and red_p else 'ОШИБКА'))
    ok_all &= bool(red_m and red_p)
'''
a = "    old = '<li class=\"card reveal\"><a class=\"card-in\" href=\"kukuruznik/\" data-transition>"
assert t.count(a) == 1
t = t.replace(a, chk + a)
p.write_text(t, encoding='utf-8')
print('OK patch_tests19')
