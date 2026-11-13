#!/usr/bin/env python3
"""Витрина надписей v2 (14.11.2026; был С1 11.11): /buy, /t, /i, /f, /pay, /thanks — ВСЕ из одного шаблона.

  python3 tools/build_sale_pages.py                      # собрать buy/ t/ i/ f/ pay/ thanks/ (index.html) + assets/spots/spots.json
  python3 tools/build_sale_pages.py --check              # ничего не писать: файлы на диске == шаблон? (код выхода 1, если нет)
  python3 tools/build_sale_pages.py --hy-lines FILE      # выгрузить армянские строки на вычитку (hy | ru)
  python3 tools/build_sale_pages.py --import-spots work/money/spots   # один раз: картинки assets/spots/ из мест (нужны cv2, PIL)
  python3 tools/build_sale_pages.py --out DIR --demo-sold B1          # пробная сборка в DIR (снимки), building.json не трогается

Путь покупателя — 4 шага на одной странице, один экран — одна мысль: ① что это (пример «до/после») → ② место прямо на рисунке
(листание: свайп, стрелки вне рисунка, клавиши ← →, мышь) → ③ имя (лимит max_len места) или две буквы + НАСТОЯЩИЙ пример художника
для типа места (картинка, не наложение кодом) → ④ цена, срок, кнопка оплаты.
Кнопка оплаты: /pay/?src=<канал>[&spot=<id>&text=<текст>] — адрес дописывает sale.js при выборе. /pay (1 с на счётчик Cloudflare) →
касса Polar: utm_source, reference_id, custom_field_data.spot / custom_field_data.inscription (поля кабинета Polar со слагами spot и
inscription — их включает советник; без них Polar берёт только utm и reference_id).
Места: assets/spots/spots.json (публичный список, без личных данных) — координаты, вырезки, max_len (длина имени; у «пары» — 1 буква), «продано». Продано = места, записанные в
tests/pogos-petros/building.json → inscriptions (поле spot или note «место B1» — так пишут deliver_inscription и stanok insert --spot).
Число проданных обязано совпасть с sale.total − sale.left, иначе стоп (рассинхрон — чинить building.json, не порог).
После каждой продажи — эта же команда и publish_hub. Статистика Cloudflare — build_pages.analytics_snippet() (как в С1).
Код движка и зданий не трогает."""
import argparse
import hashlib
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_pages as bp   # noqa: E402  analytics_snippet

BUILDING = ROOT / 'tests' / 'pogos-petros' / 'building.json'
POLAR_URL = 'https://buy.polar.sh/polar_cl_Kg0IsBOzBPrUe7rbPfv96KEalw8XRtfawRUrQ4UsmuJ'   # касса «надпись на Погос-Петросе» (Polar, org Chka)
POLAR_FIELDS = ('spot', 'inscription')   # слаги полей кабинета Polar (Settings → Custom Fields, Text) — custom_field_data.<слаг>
PRICE_USD = 15
DAYS = 7
SHARE_URL = 'https://chka.am/buy'
CHANNELS = {'buy': 'site', 't': 'tiktok', 'i': 'instagram', 'f': 'facebook'}   # папка витрины -> src кнопки
PAY_CHANNELS = ['site', 'tiktok', 'instagram', 'facebook']                   # допустимые src на /pay (остальное -> site)
PAGES = ['buy', 't', 'i', 'f', 'pay', 'thanks']
TYPES = ('name', 'couple')
NAME_MAX_LIMIT = 12   # верхняя граница max_len имени в spots.json
# длина имени на месте (пишет --import-spots; потом правда — в spots.json): стены 10, мелкие места 6; «пара» — по одной букве
SPOT_MAX = {'A1': 10, 'A2': 6, 'B1': 10, 'B2': 10, 'C1': 1, 'C2': 6, 'F1': 1, 'F2': 10}
SPOTS_DIR = 'assets/spots'
SPOTS_JSON = SPOTS_DIR + '/spots.json'
VIEW_Y0 = 1050                # окно кадра на витрине: высокий кадр 1536×2731, y от 880 до низа (места — в нижней трети)
FRAME_W = 1000                # ширина картинки кадра на витрине
CROP_W = 480                  # вырезка места (превью надписи), webp ≤ 40 КБ
# доля ширины вырезки без чёрной каймы справа (место у края кадра: A2, F2); остальные вырезки — на всю ширину. Если пересобрать вырезки (--import-spots) — перемерить.
CROP_VW = {'A2': 0.667, 'F2': 0.869}
EX_NAME, EX_COUPLE = 'ex-b1-1.webp', 'ex-c1-1.webp'   # настоящие примеры художника для типа места (шаг 3 и 4)
EXAMPLES = [('ex-b1-0.webp', 'B1_crop.png', None), ('ex-b1-1.webp', 'B1_crop.png', 'B1_NAREK_gemini.jpeg'), ('ex-c1-1.webp', 'C1_crop.png', 'C1_AL_gemini.jpeg')]
OG = 'og.jpg'
SNIP = re.compile(r'<!--chka-analytics-->(.*?)<!--/chka-analytics-->', re.S)
SOLD_NOTE = re.compile(r'место\s+([A-Z][0-9])\b')
LANGS = ('hy', 'ru', 'en')

# кадры витрины: id -> (hy, ru, en) короткое название места (подпись под кадром и «Место» в итоге)
FRAMES = {
    'A': ('Եկեղեցու բակը', 'Двор церкви', 'The churchyard'),
    'B': ('Եկեղեցու պատը', 'Стена церкви', 'The church wall'),
    'C': ('Ծառը փողոցում', 'Дерево на улице', 'The tree in the street'),
    'F': ('Շատրվանը', 'Фонтан', 'The fountain'),
}
SPOT_FRAME = {'A1': 'A', 'A2': 'A', 'B1': 'B', 'B2': 'B', 'C1': 'C', 'C2': 'C', 'F1': 'F', 'F2': 'F'}
WHERE = {k: FRAMES[v] for k, v in SPOT_FRAME.items()}   # место = название кадра (описаний «левая низкая стенка» больше нет)

# (hy, ru, en). {left} {total} {date} {n} подставляются шаблоном. Армянский — литературный восточноармянский, коротко; на вычитку — --hy-lines.
STR = {
    'title':    ('Քո անունը թանգարանում՝ ընդմիշտ', 'Твоё имя — в музее навсегда', 'Your name in the museum, forever'),
    'desc':     ('Նկարիչը քո անունը կփորագրի քանդված եկեղեցու նկարում՝ քարի վրա։ $15, մինչև 7 օր։',
                 'Художник вырежет твоё имя на камне в рисунке снесённой церкви. $15, до 7 дней.',
                 'An artist carves your name into a stone in the drawing of a demolished church. $15, within 7 days.'),
    'st1':      ('Ի՞նչ է սա', 'Что это', 'What it is'),
    'st2':      ('Տեղը', 'Место', 'Spot'),
    'st3':      ('Գրությունը', 'Надпись', 'Text'),
    'st4':      ('Վճարում', 'Оплата', 'Payment'),
    'step':     ('Քայլ', 'Шаг', 'Step'),
    'museum':   ('«Չկա» թանգարան · Պողոս-Պետրոս եկեղեցի', 'Музей «Չկա» · церковь Погос-Петрос', 'Չկա museum · Poghos-Petros church'),
    's1_p':     ('Նկարիչը քո անունը կփորագրի քանդված եկեղեցու կենդանի նկարում՝ քարի վրա։ Այն կերևա ցերեկը, մայրամուտին և գիշերը։',
                 'Художник вырежет твоё имя на камне в живом рисунке снесённой церкви. Его будет видно днём, на закате и ночью.',
                 'An artist carves your name into a stone in the living drawing of a demolished church. It shows by day, at sunset and at night.'),
    'how1':     ('Նկարում ընտրում ես տեղը', 'Выбираешь место на рисунке', 'Pick a spot in the drawing'),
    'how2':     ('Գրում ես անունը կամ երկու տառ', 'Пишешь имя или две буквы', 'Type a name or two letters'),
    'how3':     ('Նկարիչը փորագրում է այն յոթ օրվա ընթացքում', 'За 7 дней художник вырезает его', 'Within 7 days the artist carves it'),
    'before':   ('Առաջ', 'До', 'Before'),
    'after':    ('Հետո', 'После', 'After'),
    'next1':    ('Ընտրել տեղը', 'Выбрать место', 'Choose a spot'),
    's2_h':     ('Ընտրիր տեղը', 'Выбери место', 'Choose a spot'),
    's2_p':     ('Ազատ տեղում սեղմիր «Ընտրել»։', 'На свободном месте нажми «Выбрать».', 'On a free spot, tap “Pick”.'),
    's2_free':  ('Ազատ տեղեր՝ {left} / {total}', 'Свободно {left} из {total}', '{left} of {total} spots free'),
    's2_none':  ('Տեղը դեռ ընտրված չէ', 'Место ещё не выбрано', 'No spot chosen yet'),
    's2_sel':   ('Ընտրված է՝', 'Выбрано:', 'Chosen:'),
    'prev':     ('Նախորդ նկարը', 'Предыдущий рисунок', 'Previous drawing'),
    'next':     ('Հաջորդ նկարը', 'Следующий рисунок', 'Next drawing'),
    'pick':     ('Ընտրել', 'Выбрать', 'Pick'),
    'kind_name':   ('Անուն քարի վրա', 'Имя на камне', 'Name on a stone'),
    'kind_couple': ('Երկու տառ ծառի վրա', 'Две буквы на дереве', 'Two letters on a tree'),
    'sold':     ('Վաճառված', 'Продано', 'Sold'),
    'next2':    ('Շարունակել', 'Дальше', 'Next'),
    'back':     ('Հետ', 'Назад', 'Back'),
    's3_h':     ('Գրիր անունը', 'Напиши имя', 'Write the name'),
    's3_h2':    ('Գրիր երկու տառ', 'Напиши две буквы', 'Write two letters'),
    's3_l1':    ('Անուն', 'Имя', 'Name'),
    's3_la':    ('Տառ 1', 'Буква 1', 'Letter 1'),
    's3_lb':    ('Տառ 2', 'Буква 2', 'Letter 2'),
    'left':     ('Մնացել է {n}', 'осталось {n}', '{n} left'),
    'hint_couple': ('Յուրաքանչյուր դաշտում՝ մեկ տառ', 'В каждом поле — одна буква', 'One letter in each box'),
    's3_bad':   ('Միայն տառեր', 'Только буквы', 'Letters only'),
    's3_ex':    ('Այսպես է երևում պատրաստի աշխատանքը', 'Так выглядит готовая работа', 'This is what the finished work looks like'),
    's3_yours': ('Քո գրությունը՝', 'Ваша надпись:', 'Your text:'),
    'next3':    ('Դեպի վճարում', 'К оплате', 'To payment'),
    's4_h':     ('Ստուգիր և վճարիր', 'Проверь и оплати', 'Check and pay'),
    's4_spot':  ('Տեղը', 'Место', 'Spot'),
    's4_text':  ('Գրությունը', 'Надпись', 'Text'),
    's4_when':  ('Ժամկետը', 'Срок', 'Ready'),
    's4_when_v': ('մինչև 7 օր', 'до 7 дней', 'within 7 days'),
    's4_free':  ('Եթե դուր չգա՝ անվճար կվերանկարենք։', 'Если не понравится — переделаем бесплатно.', "If you don't like it — we'll redo it for free."),
    's4_mail':  ('Երբ պատրաստ լինի, հղումը կուղարկենք քո էլ. փոստին։', 'Когда будет готово, ссылка придёт на почту.', "When it's ready, the link arrives by email."),
    's4_card':  ('Վճարում քարտով՝ Polar-ի միջոցով', 'Оплата картой через Polar', 'Card payment via Polar'),
    'cta':      ('Վճարել $15', 'Оплатить $15', 'Pay $15'),
    'foot':     ('Երևանի քանդված շենքերի թանգարան', 'Музей снесённых зданий Еревана', "Museum of Yerevan's demolished buildings"),
    'pay_open': ('Բացվում է վճարման էջը…', 'Открываем оплату…', 'Opening checkout…'),
    'pay_hand': ('Չբացվե՞ց։ Սեղմիր այստեղ։', 'Не открылось — нажми сюда.', "Didn't open? Tap here."),
    'th_h':     ('Շնորհակալություն', 'Спасибо', 'Thank you'),
    'th_p':     ('Գրությունը պատրաստ կլինի մինչև {date}։ Հղումը կուղարկենք էլ. փոստով։',
                 'Надпись будет готова до {date}. Ссылка придёт письмом.',
                 'Your inscription will be ready by {date}. The link will arrive by email.'),
    'th_sel':   ('Քո ընտրությունը՝', 'Твой выбор:', 'Your choice:'),
    'share':    ('Ցույց տալ ընկերներին', 'Показать друзьям', 'Show your friends'),
    'copied':   ('Պատճենվեց', 'Скопировано', 'Copied'),
    'share_t':  ('Քո անունը թանգարանում՝ ընդմիշտ', 'Твоё имя — в музее навсегда', 'Your name in the museum, forever'),
    'share_x':  ('Չկա — Երևանի քանդված շենքերի թանգարան', 'Չկա — музей снесённых зданий Еревана', "Չկա — museum of Yerevan's demolished buildings"),
    'alt_ba':   ('Նկար՝ ցածր պատի վրա փորագրված NAREK անունը', 'Рисунок: низкая стена с вырезанным именем NAREK', 'Drawing: a low wall with the name NAREK carved in it'),
    'alt_pair': ('Նկար՝ ծառի բնին փորագրված սիրտ և A + L տառերը', 'Рисунок: сердце и буквы A + L на стволе дерева', 'Drawing: a heart and the letters A + L carved on a tree trunk'),
}


def esc(s):
    return html.escape(s, quote=True)


def tr(key, subs=None, table=None):
    """Три <span lang> с текстом; subs — {плейсхолдер: готовый HTML}. table — свой (hy, ru, en) вместо STR[key]."""
    vals = table if table is not None else STR[key]
    out = []
    for i, l in enumerate(LANGS):
        t = esc(vals[i])
        for k, v in (subs or {}).items():
            t = t.replace('{%s}' % k, v)
        out.append('<span class="i18n-inline" lang="%s">%s</span>' % (l, t))
    return ''.join(out)


def plain(key, lang):
    return STR[key][LANGS.index(lang)]


def asset_v(rel, root=ROOT):
    return hashlib.sha1((root / rel).read_bytes()).hexdigest()[:8]


def spot_files():
    return ['%s/frame-%s.webp' % (SPOTS_DIR, f.lower()) for f in FRAMES] + ['%s/%s.webp' % (SPOTS_DIR, s) for s in WHERE] + \
        ['%s/%s' % (SPOTS_DIR, n) for n, _, _ in EXAMPLES] + ['%s/%s' % (SPOTS_DIR, OG)]


ASSETS = ['assets/sale.css', 'assets/sale.js', SPOTS_JSON] + spot_files()


def sale_block(path=BUILDING):
    """sale из building.json: total, left (целые, 0 <= left <= total); иначе стоп с понятным текстом."""
    s = json.loads(Path(path).read_text(encoding='utf-8')).get('sale')
    if not isinstance(s, dict):
        raise SystemExit('СТОП: в %s нет блока sale' % path)
    t, l = s.get('total'), s.get('left')
    if not (isinstance(t, int) and isinstance(l, int) and not isinstance(t, bool) and not isinstance(l, bool) and 0 < t and 0 <= l <= t):
        raise SystemExit('СТОП: sale.total/left в %s должны быть целыми, 0 <= left <= total (сейчас %r / %r)' % (path, t, l))
    return {'total': t, 'left': l}


def sold_from_building(path=BUILDING):
    """Проданные места — из inscriptions building.json: поле spot или note «место B1» (deliver_inscription, stanok insert --spot)."""
    b = json.loads(Path(path).read_text(encoding='utf-8'))
    out = []
    for x in b.get('inscriptions') or []:
        sp = x.get('spot')
        if not sp:
            m = SOLD_NOTE.search(str(x.get('note', '')))
            sp = m.group(1) if m else None
        if sp:
            out.append(sp)
        else:
            raise SystemExit('СТОП: в %s надпись %r без места (нет spot / note «место XX») — витрина не знает, какое место продано' % (path, x.get('id')))
    return out


def load_spots(root=ROOT):
    """assets/spots/spots.json — геометрия мест (пишет --import-spots); проверка: те же места и кадры, что в WHERE / FRAMES."""
    f = root / SPOTS_JSON
    if not f.is_file():
        raise SystemExit('СТОП: нет %s — python3 tools/build_sale_pages.py --import-spots work/money/spots' % SPOTS_JSON)
    d = json.loads(f.read_text(encoding='utf-8'))
    ids = [s['id'] for s in d.get('spots', [])]
    frs = [x['id'] for x in d.get('frames', [])]
    if ids != list(WHERE) or frs != list(FRAMES):
        raise SystemExit('СТОП: %s: места %s / кадры %s не совпадают с WHERE / FRAMES в сборщике' % (SPOTS_JSON, ids, frs))
    for s in d['spots']:
        if s['frame'] not in FRAMES or s['type'] not in TYPES or not (0 <= s['x'] <= 100 and 0 <= s['y'] <= 100):
            raise SystemExit('СТОП: %s: плохое место %r' % (SPOTS_JSON, s))
        m = s.get('max_len')
        if not (isinstance(m, int) and not isinstance(m, bool) and (m == 1 if s['type'] == 'couple' else 1 <= m <= NAME_MAX_LIMIT)):
            raise SystemExit('СТОП: %s: место %s: max_len %r — у имени 1…%d, у пары ровно 1 (по букве в каждом поле)' % (SPOTS_JSON, s['id'], m, NAME_MAX_LIMIT))
    return d


def check_sold(sale, sold, spots):
    sold = list(sold)
    ids = [s['id'] for s in spots['spots']]
    bad = [x for x in sold if x not in ids]
    if bad:
        raise SystemExit('СТОП: продано неизвестное место %s (места: %s)' % (', '.join(bad), ', '.join(ids)))
    if len(set(sold)) != len(sold):
        raise SystemExit('СТОП: одно место продано дважды: %s' % ', '.join(sorted(sold)))
    if sale['total'] != len(ids):
        raise SystemExit('СТОП: sale.total = %d, а мест на витрине %d' % (sale['total'], len(ids)))
    if len(sold) != sale['total'] - sale['left']:
        raise SystemExit('СТОП: рассинхрон — по inscriptions продано %d (%s), а sale.total − sale.left = %d' % (
            len(sold), ', '.join(sold) or '—', sale['total'] - sale['left']))
    return set(sold)


def public_json(spots, sold):
    """Публичный список мест: геометрия + sold. Без текстов надписей и личных данных."""
    d = {'note': 'Места надписей chka.am (Погос-Петрос). Собирает tools/build_sale_pages.py; sold — из building.json. Без личных данных.',
         'building': 'pogos-petros', 'price_usd': PRICE_USD, 'days': DAYS,
         'frames': spots['frames'],
         'spots': [dict({k: v for k, v in s.items() if k != 'sold'}, sold=s['id'] in sold) for s in spots['spots']]}
    return json.dumps(d, ensure_ascii=False, indent=1) + '\n'


def analytics(root=ROOT):
    """Сниппет Cloudflare: tools/analytics.json, а нет его — из уже собранной buy/index.html. Нет нигде — стоп."""
    snip = bp.analytics_snippet()
    if snip:
        return snip
    f = root / 'buy' / 'index.html'
    if f.is_file():
        m = SNIP.search(f.read_text(encoding='utf-8'))
        if m and m.group(1).strip():
            return m.group(1)
    raise SystemExit('СТОП: нет токена статистики (tools/analytics.json {"cloudflare_token": "32 hex"}) и в buy/index.html нет сниппета — страницы без счётчика не пишем')


def head(title, desc, snippet, v, robots=True):
    og = ('<meta property="og:type" content="website"><meta property="og:title" content="%s"><meta property="og:description" content="%s">'
          '<meta property="og:image" content="https://chka.am/%s/%s"><meta property="og:url" content="%s">') % (esc(title), esc(desc), SPOTS_DIR, OG, SHARE_URL)
    return (
        '<!DOCTYPE html>\n<html lang="hy" data-lang="hy">\n<head>\n<meta charset="utf-8">\n'
        '<script>(function(){var d=document.documentElement,l="hy",q=(location.search.match(/[?&]lang=(hy|ru|en)/)||[])[1];'
        'try{l=q||localStorage.getItem("chka-lang")||"hy"}catch(e){l=q||"hy"}'
        'if(["hy","ru","en"].indexOf(l)<0)l="hy";d.setAttribute("data-lang",l);d.setAttribute("lang",l);d.className+=" js"})();</script>\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<title>%s</title>\n<meta name="description" content="%s">\n<meta name="theme-color" content="#f1e6cf">\n%s\n'
        '<link rel="icon" href="../assets/favicon-32.png">\n<link rel="apple-touch-icon" href="../assets/icon-180.png">\n'
        '<link rel="stylesheet" href="../assets/sale.css?v=%s">\n'
        '<!--chka-analytics-->%s<!--/chka-analytics--></head>\n'
    ) % (esc(title), esc(desc), ('<meta name="robots" content="noindex">' if robots else '') + og, v['css'], snippet)


SPRITE = ('<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'
          '<symbol id="corner" viewBox="0 0 22 22"><g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">'
          '<path d="M2 20V8Q2 2 8 2h12M6 20V10Q6 6 10 6h10"/><circle cx="11" cy="11" r="1.6" fill="currentColor" stroke="none"/></g></symbol>'
          '<symbol id="arr" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></symbol>'
          '</defs></svg>\n')
CORNERS = ''.join('<svg class="corner %s" aria-hidden="true"><use href="#corner"/></svg>' % c for c in ('tl', 'tr', 'bl', 'br'))


def stamp_svg():
    """Штамп «продано» — как почтовый штемпель главной: hy сверху по дуге, ru снизу, en в середине."""
    return ('<svg class="stamp" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" fill="#fbf6ea" fill-opacity=".72"/>'
            '<g fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="60" cy="60" r="54" stroke-width="3"/>'
            '<circle cx="60" cy="60" r="47" stroke-width="1.2"/><path d="M20 48h80M20 72h80" stroke-width="1.6"/></g>'
            '<path id="st-top" d="M22 60a38 38 0 0 1 76 0" fill="none"/><path id="st-bot" d="M14 60a46 46 0 0 0 92 0" fill="none"/>'
            '<g fill="currentColor" font-family="Chka Serif, Georgia, serif" font-weight="700">'
            '<text font-size="12.5" letter-spacing="1.2"><textPath href="#st-top" startOffset="50%" text-anchor="middle">ՎԱՃԱՌՎԱԾ</textPath></text>'
            '<text font-size="11.5" letter-spacing="1.6"><textPath href="#st-bot" startOffset="50%" text-anchor="middle">ПРОДАНО</textPath></text>'
            '<text x="60" y="67" text-anchor="middle" font-size="19" letter-spacing="2">SOLD</text></g></svg>')


def lang_switch():
    return '<div class="lsw" role="group" aria-label="Language">%s</div>' % ''.join(
        '<button type="button" data-set-lang="%s" aria-pressed="%s">%s</button>' % (l, 'true' if l == 'hy' else 'false', l.upper()) for l in LANGS)


def bar(progress=''):
    return ('<header class="sbar"><div class="sbar-in"><a class="logo" href="/" aria-label="chka.am"><span>Չկա</span><i class="dot" aria-hidden="true"></i></a>'
            '%s%s</div></header>\n') % (progress, lang_switch())


def foot():
    return '<footer class="sfoot"><span class="sfoot-mark" aria-hidden="true">Չկա</span>%s</footer>\n' % tr('foot')


def script(v):
    return '<script src="../assets/sale.js?v=%s" defer></script>\n</body>\n</html>\n' % v['js']


def progress():
    return '<ol class="prog" aria-label="1–4">%s</ol>' % ''.join(
        '<li><button type="button" data-go="%d"%s><b>%d</b><span>%s</span></button></li>' % (
            n, ' aria-current="step"' if n == 1 else '', n, tr('st%d' % n)) for n in range(1, 5))


def eyebrow(n):
    return '<p class="eyebrow"><span class="no">%s %d/4</span><span class="what">%s</span></p>' % (tr('step'), n, tr('st%d' % n))


def nav(back, nxt_key, nxt_attr=''):
    b = '<button type="button" class="bk" data-back>%s</button>' % tr('back') if back else ''
    return ('<div class="snav">%s<button type="button" class="nx" data-next%s><span>%s</span><svg aria-hidden="true"><use href="#arr"/></svg></button></div>'
            % (b, nxt_attr, tr(nxt_key)))


def exfig(cls='', caption=True):
    """Настоящий пример художника для типа места (картинка; текст поверх рисунка кодом не рисуем). Какой показать — data-kind (ставит sale.js)."""
    return ('<figure class="ex%s"><div class="ex-in">'
            '<img class="ex-n" src="../%s/%s" width="640" height="640" alt="%s" decoding="async">'
            '<img class="ex-c" src="../%s/%s" width="640" height="640" alt="%s" decoding="async" loading="lazy"></div>%s</figure>') % (
        cls, SPOTS_DIR, EX_NAME, esc(plain('alt_ba', 'hy')), SPOTS_DIR, EX_COUPLE, esc(plain('alt_pair', 'hy')),
        ('<figcaption>%s</figcaption>' % tr('s3_ex')) if caption else '')


def cropfig(cls=''):
    """Вырезка ВЫБРАННОГО места (assets/spots/<id>.webp), без наложений. src подставляет sale.js при выборе места; до выбора — первое место."""
    return ('<figure class="crop%s"><div class="crop-in"><img class="crop-img" src="../%s/%s.webp" width="%d" height="%d" alt="" decoding="async"></div></figure>') % (
        cls, SPOTS_DIR, next(iter(WHERE)), CROP_W, CROP_W)


def step1():
    ba = ('<figure class="ba" data-ba><button type="button" class="ba-btn" aria-label="%s / %s">'
          '<img class="ba-0" src="../%s/ex-b1-0.webp" width="640" height="640" alt="">'
          '<img class="ba-1" src="../%s/%s" width="640" height="640" alt="%s">'
          '<span class="ba-chip"><span class="c0">%s</span><span class="c1">%s</span></span></button></figure>') % (
        esc(plain('before', 'hy')), esc(plain('after', 'hy')), SPOTS_DIR, SPOTS_DIR, EX_NAME, esc(plain('alt_ba', 'hy')), tr('before'), tr('after'))
    pair = ('<figure class="mini"><img src="../%s/%s" width="640" height="640" alt="%s" loading="lazy" decoding="async">'
            '<figcaption>%s</figcaption></figure>') % (SPOTS_DIR, EX_COUPLE, esc(plain('alt_pair', 'hy')), tr('kind_couple'))
    stage = '<div class="stage"><div class="card">%s%s<span class="pstamp" aria-hidden="true"><b>$%d</b><i>Չկա</i></span></div>%s</div>' % (
        CORNERS, ba, PRICE_USD, pair)
    how = '<ol class="how"><li>%s</li><li>%s</li><li>%s</li></ol>' % (tr('how1'), tr('how2'), tr('how3'))
    panel = '<div class="panel"><p class="museum">%s</p>%s<h1>%s</h1><p class="lead">%s</p>%s%s</div>' % (
        tr('museum'), eyebrow(1), tr('title'), tr('s1_p'), how, nav(False, 'next1'))
    return '<section class="step on" data-step="1">%s%s</section>\n' % (stage, panel)


def step2(spots, sold):
    frames, thumbs = [], []
    nfr = len(spots['frames'])
    for i, fr in enumerate(spots['frames']):
        btns = []
        for s in spots['spots']:
            if s['frame'] != fr['id']:
                continue
            w = WHERE[s['id']]
            is_sold = s['id'] in sold
            lab = tr('sold') if is_sold else tr('pick')   # на метке — только «Выбрать»; тип места — после выбора (kinds)
            aria = '%s · %s%s' % (plain('kind_' + s['type'], 'hy'), w[0], (' · ' + plain('sold', 'hy')) if is_sold else '')
            btns.append(
                '<button type="button" class="spot%s" data-spot="%s" data-type="%s" data-max="%d"%s style="left:%s%%;top:%s%%" aria-label="%s"%s>'
                '<span class="tag">%s</span><i class="pin"></i>%s<span class="wh" hidden>%s</span></button>' % (
                    (' sold' if is_sold else '') + (' er' if s['x'] > 82 else ' el' if s['x'] < 18 else ''), s['id'], s['type'], s['max_len'], (' data-vw="%s"' % CROP_VW[s['id']]) if s['id'] in CROP_VW else '', s['x'], s['y'], esc(aria),
                    ' disabled' if is_sold else '', lab, stamp_svg() if is_sold else '', tr(None, table=w)))
        frames.append(
            '<figure class="fr" data-frame="%s" aria-label="%d/%d"><div class="frpic"><img src="../%s/%s" width="%d" height="%d" alt="%s"%s>%s</div>'
            '<figcaption><b>%d/%d</b> %s</figcaption></figure>' % (
                fr['id'], i + 1, nfr, SPOTS_DIR, fr['img'], fr['w'], fr['h'], esc(FRAMES[fr['id']][0]),
                '' if i == 0 else ' loading="lazy" decoding="async"', ''.join(btns), i + 1, nfr, tr(None, table=FRAMES[fr['id']])))
        thumbs.append('<button type="button" data-fr="%d" aria-label="%d/%d"%s><img src="../%s/%s" width="%d" height="%d" alt="" loading="lazy" decoding="async"></button>' % (
            i, i + 1, nfr, ' aria-current="true"' if i == 0 else '', SPOTS_DIR, fr['img'], fr['w'], fr['h']))
    left = len(spots['spots']) - len(sold)
    # стрелки — вне рисунка (по бокам на компьютере, под рисунком на телефоне): метка не может оказаться под кнопкой
    stage = ('<div class="stage"><div class="car">'
             '<button type="button" class="arr prev" data-dir="-1" aria-label="%s"><svg><use href="#arr"/></svg></button>'
             '<div class="track" tabindex="0" aria-label="%s">%s</div>'
             '<button type="button" class="arr next" data-dir="1" aria-label="%s"><svg><use href="#arr"/></svg></button>'
             '<div class="thumbs">%s</div></div></div>') % (
        esc(plain('prev', 'hy')), esc(plain('s2_h', 'hy')), ''.join(frames), esc(plain('next', 'hy')), ''.join(thumbs))
    sel = ('<div class="sel" aria-live="polite"><p class="sel-none">%s</p><p class="sel-on" hidden><span class="sel-k">%s</span> '
           '<b class="sel-t"></b></p></div>') % (tr('s2_none'), tr('s2_sel'))
    panel = '<div class="panel">%s<h2>%s</h2><p class="lead">%s</p><p class="free">%s</p>%s%s</div>' % (
        eyebrow(2), tr('s2_h'), tr('s2_p'),
        tr('s2_free', {'left': str(left), 'total': str(len(spots['spots']))}), sel, nav(True, 'next2', ' disabled'))
    kinds = '<span class="kinds" hidden><span data-k="name">%s</span><span data-k="couple">%s</span></span>' % (tr('kind_name'), tr('kind_couple'))
    return '<section class="step" data-step="2">%s%s%s</section>\n' % (stage, panel, kinds)


def step3():
    one = ('<div class="fld g-name"><label for="n1">%s</label><input id="n1" name="n1" type="text" maxlength="%d" autocomplete="off" '
           'autocapitalize="characters" spellcheck="false" enterkeyhint="next" placeholder="ANNA"><p class="hint">%s</p></div>') % (
        tr('s3_l1'), NAME_MAX_LIMIT, tr('left', {'n': '<b class="left-n">%d</b>' % NAME_MAX_LIMIT}))
    two = ('<div class="g-couple" hidden><div class="fld"><label for="na">%s</label><input id="na" name="na" type="text" maxlength="2" autocomplete="off" '
           'autocapitalize="characters" spellcheck="false" enterkeyhint="next" aria-describedby="hc"></div>'
           '<span class="plus" aria-hidden="true">+</span>'
           '<div class="fld"><label for="nb">%s</label><input id="nb" name="nb" type="text" maxlength="2" autocomplete="off" '
           'autocapitalize="characters" spellcheck="false" enterkeyhint="next" aria-describedby="hc"></div><p class="hint" id="hc">%s</p></div>') % (
        tr('s3_la'), tr('s3_lb'), tr('hint_couple'))
    yours = '<p class="yours"><span class="yk">%s</span><b class="yv" aria-live="polite">—</b></p>' % tr('s3_yours')
    pick = '<div class="pick">%s%s</div>' % (cropfig(), exfig(' exm'))   # крупно — выбранное место; в углу — маленький пример художника
    stage = '<div class="stage"><div class="card card-pv">%s%s%s</div></div>' % (CORNERS, pick, yours)
    panel = ('<div class="panel">%s<h2><span class="h-name">%s</span><span class="h-couple" hidden>%s</span></h2>'
             '<form class="names" novalidate>%s%s<p class="bad" hidden>%s</p></form>%s</div>') % (
        eyebrow(3), tr('s3_h'), tr('s3_h2'), one, two, tr('s3_bad'), nav(True, 'next3', ' disabled'))
    return '<section class="step" data-step="3">%s%s</section>\n' % (stage, panel)


def step4(src):
    dl = ('<dl class="sum"><div><dt>%s</dt><dd class="sum-spot">—</dd></div><div><dt>%s</dt><dd class="sum-text">—</dd></div>'
          '<div><dt>%s</dt><dd>%s</dd></div></dl>') % (tr('s4_spot'), tr('s4_text'), tr('s4_when'), tr('s4_when_v'))
    stage = '<div class="stage"><div class="card card-pv">%s%s%s</div></div>' % (CORNERS, cropfig(' crop-sum'), dl)
    panel = ('<div class="panel">%s<h2>%s</h2><div class="price"><b>$%d</b><span>%s</span></div>'
             '<ul class="promise"><li>%s</li><li>%s</li></ul>'
             '<div class="cta"><a class="btn" href="/pay/?src=%s">%s</a><button type="button" class="bk" data-back>%s</button></div>'
             '<p class="card-note">%s</p></div>') % (
        eyebrow(4), tr('s4_h'), PRICE_USD, tr('s4_when_v'), tr('s4_free'), tr('s4_mail'), src, tr('cta'), tr('back'), tr('s4_card'))
    return '<section class="step" data-step="4">%s%s</section>\n' % (stage, panel)


def shop(folder, sale, snippet, v, spots, sold):
    src = CHANNELS[folder]
    title = 'Չկա · %s' % plain('title', 'hy')
    body = ('<body data-page="shop" data-src="%s">\n%s%s<main class="flow">\n%s%s%s%s</main>\n%s') % (
        src, SPRITE, bar(progress()), step1(), step2(spots, sold), step3(), step4(src), foot())
    return head(title, plain('desc', 'hy'), snippet, v) + body + script(v)


def pay(snippet, v, spots, sold):
    title = 'Չկա · %s' % plain('pay_open', 'hy')
    paras = ''.join('<p lang="%s">%s</p>' % (l, esc(plain('pay_open', l))) for l in LANGS)
    hand = ' · '.join('<span lang="%s">%s</span>' % (l, esc(plain('pay_hand', l))) for l in LANGS)
    nos = '<noscript><meta http-equiv="refresh" content="3; url=%s?utm_source=site"></noscript>\n' % POLAR_URL
    free = ','.join(s['id'] for s in spots['spots'] if s['id'] not in sold)
    body = (
        '<body data-page="pay">\n<main class="center"><div class="paybox" data-polar="%s" data-channels="%s" data-spots="%s" data-fields="%s" data-max="%d">%s'
        '<p class="small"><a data-pay-link href="%s?utm_source=site">%s</a></p></div></main>\n'
    ) % (POLAR_URL, ','.join(PAY_CHANNELS), free, ','.join(POLAR_FIELDS), max([5] + [s['max_len'] for s in spots['spots']]), paras, POLAR_URL, hand)
    h = head(title, plain('pay_open', 'hy'), snippet, v)
    return h.replace('<!--chka-analytics-->', nos + '<!--chka-analytics-->', 1) + body + script(v)


def thanks(snippet, v):
    title = 'Չկա · %s' % plain('th_h', 'hy')
    attrs = ' '.join('data-title-%s="%s" data-text-%s="%s"' % (l, esc(plain('share_t', l)), l, esc(plain('share_x', l))) for l in LANGS)
    body = (
        '<body data-page="thanks">\n%s%s<main class="center"><div class="card card-th">%s\n<h1>%s</h1>\n<p>%s</p>\n'
        '<p class="th-sel" hidden><span>%s</span> <b></b></p>\n'
        '<button type="button" class="nx" data-share data-url="%s" %s><span class="lbl">%s</span><span class="ok">%s</span></button>\n</div></main>\n%s'
    ) % (SPRITE, bar(), CORNERS, tr('th_h'), tr('th_p', {'date': '<b class="when" data-days="%d">…</b>' % DAYS}), tr('th_sel'),
         SHARE_URL, attrs, tr('share'), tr('copied'), foot())
    return head(title, plain('th_h', 'hy'), snippet, v) + body + script(v)


def build(sale, snippet, root=ROOT, sold=None, spots=None):
    """{папка: html} — все шесть страниц. sold — проданные места (по умолчанию из building.json), spots — из assets/spots/spots.json."""
    spots = spots or load_spots(root)
    sold = check_sold(sale, sold_from_building() if sold is None else sold, spots)
    v = {'css': asset_v('assets/sale.css', root), 'js': asset_v('assets/sale.js', root)}
    out = {f: shop(f, sale, snippet, v, spots, sold) for f in CHANNELS}
    out['pay'] = pay(snippet, v, spots, sold)
    out['thanks'] = thanks(snippet, v)
    return out


def hy_lines():
    rows = ['%-12s %s\n%-12s ↳ %s' % (k, val[0], '', val[1]) for k, val in STR.items()]
    rows += ['frame %-6s %s\n%-12s ↳ %s' % (k, val[0], '', val[1]) for k, val in FRAMES.items()]
    return '\n'.join(rows)


def import_spots(src, root=ROOT):
    """Один раз: из work/money/spots (spots.json, *_crop.png, правки Gemini) и высоких кадров pogos-petros/frames/<КАДР>.png —
    assets/spots/: кадры витрины (окно y ≥ VIEW_Y0), вырезки мест (webp ≤ 40 КБ), примеры «до/после», og.jpg и spots.json (геометрия)."""
    import numpy as np
    import cv2
    from PIL import Image
    src = Path(src)
    raw = {s['id']: s for s in json.loads((src / 'spots.json').read_text(encoding='utf-8'))}
    out = root / SPOTS_DIR
    out.mkdir(parents=True, exist_ok=True)

    def webp(img, path, limit=None, q=78):
        while True:
            img.save(path, 'WEBP', quality=q, method=6)
            if limit is None or path.stat().st_size <= limit or q <= 30:
                return q
            q -= 6

    frames = []
    for fid in FRAMES:
        im = Image.open(root / 'pogos-petros' / 'frames' / ('%s.png' % fid)).convert('RGB')
        W, H = im.size
        view = im.crop((0, VIEW_Y0, W, H))
        h = round(FRAME_W * view.height / view.width)
        webp(view.resize((FRAME_W, h), Image.LANCZOS), out / ('frame-%s.webp' % fid.lower()), 170 * 1024, 74)
        frames.append({'id': fid, 'img': 'frame-%s.webp' % fid.lower(), 'w': FRAME_W, 'h': h, 'src_size': [W, H], 'view_y0': VIEW_Y0})
    spots = []
    for sid in WHERE:
        s = raw[sid]
        W, H = s['frame_size']
        x0, y0, x1, y1 = s['crop_box']
        crop = Image.open(src / s['crop']).convert('RGB')
        webp(crop.resize((CROP_W, CROP_W), Image.LANCZOS), out / ('%s.webp' % sid), 40 * 1024, 72)
        spots.append({'id': sid, 'frame': s['frame'], 'type': s['type'],
                      'x': round(100 * s['x'] / W, 2), 'y': round(100 * (s['y'] - VIEW_Y0) / (H - VIEW_Y0), 2),
                      'cx': round((s['x'] - x0) / (x1 - x0), 3), 'cy': round((s['y'] - y0) / (y1 - y0), 3),
                      'max_len': SPOT_MAX[sid], 'crop': '%s.webp' % sid, 'sold': False})

    def composite(crop_name, edit_name):
        """Правка Gemini → совмещение с вырезкой (ECC) → только пятно надписи в мягком прямоугольнике (как deliver_inscription)."""
        c = np.array(Image.open(src / crop_name).convert('RGB'))
        h, w = c.shape[:2]
        if not edit_name:
            return c
        g = np.array(Image.open(src / edit_name).convert('RGB').resize((w, h), Image.LANCZOS))
        a = cv2.cvtColor(c, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
        b = cv2.cvtColor(g, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
        M = np.eye(2, 3, dtype=np.float32)
        _, M = cv2.findTransformECC(a, b, M, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
        gw = cv2.warpAffine(g, M, (w, h), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
        d = np.abs(gw.astype(np.float32) - c.astype(np.float32)).max(-1)
        circ = np.zeros((h, w), np.uint8)
        cv2.circle(circ, (w // 2, h // 2), int(0.45 * w), 1, -1)
        m0 = cv2.morphologyEx(((d > 30) & (circ > 0)).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, _, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(m0, np.ones((25, 25), np.uint8)), 8)
        j = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        x, y, w2, h2 = st[j, :4]
        m = np.zeros((h, w), np.float32)
        cv2.rectangle(m, (max(0, x - 12), max(0, y - 12)), (min(w - 1, x + w2 + 12), min(h - 1, y + h2 + 12)), 1, -1)
        al = np.clip(cv2.GaussianBlur(m, (0, 0), 8) * 1.2, 0, 1)[..., None]
        return (c * (1 - al) + gw * al).astype(np.uint8)

    for name, crop_name, edit_name in EXAMPLES:
        webp(Image.fromarray(composite(crop_name, edit_name)), out / name, 60 * 1024, 74)
    after = Image.open(out / 'ex-b1-1.webp').convert('RGB').resize((630, 630), Image.LANCZOS)
    og = Image.new('RGB', (1200, 630), (241, 230, 207))
    og.paste(after, (570, 0))
    fr = Image.open(out / 'frame-b.webp').convert('RGB')
    fr = fr.resize((560, round(560 * fr.height / fr.width)), Image.LANCZOS).crop((0, 0, 560, 630))
    og.paste(fr, (0, 0))
    og.save(out / OG, 'JPEG', quality=82, optimize=True)
    d = {'frames': frames, 'spots': spots}
    (out / 'spots.json').write_text(public_json(d, set()), encoding='utf-8')
    for f in sorted(out.iterdir()):
        print('%-28s %6.1f КБ' % (f.relative_to(root), f.stat().st_size / 1024))


def write_all(pages, spots_text, dest, check):
    bad = []
    for folder, text in list(pages.items()) + [(None, spots_text)]:
        f = (dest / SPOTS_JSON) if folder is None else (dest / folder / 'index.html')
        name = SPOTS_JSON if folder is None else '%s/index.html' % folder
        if check:
            if not f.is_file() or f.read_text(encoding='utf-8') != text:
                bad.append(name)
            continue
        f.parent.mkdir(parents=True, exist_ok=True)
        if f.is_file() and f.read_text(encoding='utf-8') == text:
            continue
        f.write_text(text, encoding='utf-8')
        print('записано: %s (%d Б)' % (name, len(text.encode('utf-8'))))
    return bad


def main():
    ap = argparse.ArgumentParser(description='buy/, t/, i/, f/, pay/, thanks/ + assets/spots/spots.json из одного шаблона')
    ap.add_argument('--check', action='store_true', help='не писать: файлы на диске == шаблон?')
    ap.add_argument('--hy-lines', metavar='FILE', help='выгрузить армянские строки на вычитку')
    ap.add_argument('--import-spots', metavar='DIR', help='картинки assets/spots/ из work/money/spots (один раз)')
    ap.add_argument('--out', metavar='DIR', help='пробная сборка в DIR (страницы + копия assets/ не делается — только html и spots.json)')
    ap.add_argument('--demo-sold', metavar='ID', action='append', default=[], help='с --out: отметить место проданным (только для снимков)')
    a = ap.parse_args()
    if a.hy_lines:
        Path(a.hy_lines).write_text(hy_lines() + '\n', encoding='utf-8')
        print('армянских строк: %d -> %s' % (len(STR) + len(FRAMES), a.hy_lines))
        return
    if a.import_spots:
        import_spots(a.import_spots)
        return
    if a.demo_sold and not a.out:
        raise SystemExit('СТОП: --demo-sold только вместе с --out (building.json не трогаем)')
    miss = [f for f in ASSETS if not (ROOT / f).is_file()]
    if miss:
        raise SystemExit('СТОП: нет файлов: %s' % ', '.join(miss))
    sale = sale_block()
    spots = load_spots()
    sold = sold_from_building()
    if a.demo_sold:
        sold = sold + a.demo_sold
        sale = dict(sale, left=sale['left'] - len(a.demo_sold))
    pages = build(sale, analytics(), sold=sold, spots=spots)
    spots_text = public_json(spots, set(sold))
    dest = Path(a.out) if a.out else ROOT
    bad = write_all(pages, spots_text, dest, a.check)
    if a.check:
        if bad:
            print('не совпадает с шаблоном: %s — python3 tools/build_sale_pages.py' % ', '.join(bad))
            sys.exit(1)
        print('OK: 6 страниц и %s == шаблон' % SPOTS_JSON)


if __name__ == '__main__':
    main()
