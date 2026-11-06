#!/usr/bin/env python3
"""Шаг 9: правки hy от Gemini Pro (07.11.2026) с уверенностью «высокая» -> building.json, about.html, history.html.
Только точные замены внутри армянских строк; повторный запуск ничего не меняет (идемпотентно). Средняя/низкая — sources/hy_narek.md."""
from pathlib import Path
R = Path(__file__).resolve().parents[3]
T = R / 'tests/pogos-petros'
# (файл, старое, новое, сколько раз должно встретиться старое) — n из sources/hy_gemini.md
EDITS = [
    ('building.json', 'Մոտակայքում էր Շահարի Զալխան մզկիթը։', 'Մոտակայքում էր Շահարի Զալխանի մզկիթը։', 1),          # n16
    ('building.json', 'Խորանը քանդելիս հայտնաբերվել են տարբեր դարերի', 'Խորանը քանդելիս հայտնաբերվել է տարբեր դարերի', 1),  # n19
    ('about.html', '>Եկեղեցու հիմնադրումը՝ հին Երևանի ամենահին և ամենամեծ եկեղեցին<', '>Հին Երևանի ամենահին և ամենամեծ եկեղեցու հիմնադրումը<', 1),  # n63
    ('history.html', 'Խորանը քանդելիս հայտնաբերվել են տարբեր դարերի', 'Խորանը քանդելիս հայտնաբերվել է տարբեր դարերի', 1),    # n95
    ('history.html', 'Քանդումը դադարեցրել են, հավաքել են հանձնաժողով,', 'Քանդումը դադարեցրել են, կազմել են հանձնաժողով,', 1),  # n95
]
done = 0
for fn, old, new, n in EDITS:
    f = T / fn
    s = f.read_text(encoding='utf-8')
    c = s.count(old)
    if c == 0 and new in s:
        print('уже применено:', fn, new[:40]); continue
    if c != n:
        raise SystemExit('СТОП: %s — «%s» встречается %d раз (ждали %d)' % (fn, old[:40], c, n))
    f.write_text(s.replace(old, new), encoding='utf-8')
    done += 1
    print('применено:', fn, new[:50])
print('правок применено сейчас:', done)
