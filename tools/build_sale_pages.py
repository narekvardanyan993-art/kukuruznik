#!/usr/bin/env python3
"""Страницы продажи надписи (docs/SALES-MACHINE.md §5.1, прогон С1): /buy, /t, /i, /f, /pay, /thanks — ВСЕ из одного шаблона.

  python3 tools/build_sale_pages.py                      # собрать buy/, t/, i/, f/, pay/, thanks/ (index.html) из шаблона
  python3 tools/build_sale_pages.py --check              # ничего не писать: файлы на диске == шаблон? (код выхода 1, если нет)
  python3 tools/build_sale_pages.py --hy-lines FILE      # выгрузить все армянские строки на вычитку

Откуда что: места (свободно/занято) — блок sale в tests/pogos-petros/building.json (total, left; занятыми рисуются первые total-left);
цена, ссылка Polar и каналы — константы ниже; тексты hy/ru/en — таблица STR ниже (армянские — на вычитку Нареком).
После каждой продажи (sale.left уменьшился) страницы пересобираются этой же командой и уезжают на сайт через publish_hub.
/buy и /t /i /f — одна витрина, отличие только в src кнопки (site / tiktok / instagram / facebook): кнопка -> /pay/?src=<канал>.
/pay — страница-переход (1 с, чтобы счётчик Cloudflare успел) на Polar с utm_source=<src>; неизвестный src -> site.
Стили и скрипт — assets/sale.css, assets/sale.js (адреса со ?v=<хэш файла>), картинки — assets/sale-ex-1..3.webp.
Статистика Cloudflare — build_pages.analytics_snippet() (токен из tools/analytics.json); нет токена — берётся из уже собранной buy/index.html;
нет и там — стоп (страницы без счётчика не пишем). Код движка и зданий не трогает."""
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
POLAR_URL = 'https://buy.polar.sh/polar_cl_Kg0IsBOzBPrUe7rbPfv96KEalw8XRtfawRUrQ4UsmuJ'   # касса «надпись на Погос-Петросе» (Polar, org Chka) — та же, что стояла в buy/
PRICE_USD = 15
SHARE_URL = 'https://chka.am/buy'
CHANNELS = {'buy': 'site', 't': 'tiktok', 'i': 'instagram', 'f': 'facebook'}   # папка витрины -> src кнопки
PAY_CHANNELS = ['site', 'tiktok', 'instagram', 'facebook']                   # допустимые src на /pay (остальное -> site)
PAGES = ['buy', 't', 'i', 'f', 'pay', 'thanks']
EXAMPLES = [('sale-ex-1.webp', 'ex1'), ('sale-ex-2.webp', 'ex2'), ('sale-ex-3.webp', 'ex3')]
ASSETS = ['assets/sale.css', 'assets/sale.js'] + ['assets/' + n for n, _ in EXAMPLES]
SNIP = re.compile(r'<!--chka-analytics-->(.*?)<!--/chka-analytics-->', re.S)

# (hy, ru, en). {left} {total} {date} подставляются шаблоном. Армянские строки — простые, на вычитку Нареком.
STR = {
    'title':    ('Քո անունը՝ հին Երևանի քարին', 'Твоё имя — на камне старого Еревана', 'Your name on a stone of old Yerevan'),
    'lead':     ('Քո անունը կփորագրվի կորած շենքի նկարի քարին՝ թանգարանում։',
                 'Твоё имя будет вырезано на камне в рисунке утраченного здания — в музее.',
                 'Your name will be carved into a stone in the drawing of a lost building, in the museum.'),
    'ex_h':     ('Օրինակներ', 'Примеры', 'Examples'),
    'ex1':      ('Անունը՝ պատի վրա', 'Имя на стене', 'A name on the wall'),
    'ex2':      ('Զույգը՝ ծառի վրա', 'Пара на дереве', 'A couple on the tree'),
    'ex3':      ('Հայերեն տառերով', 'Армянскими буквами', 'In Armenian letters'),
    'places_h': ('Տեղեր', 'Места', 'Spots'),
    'places_n': ('Մնացել է {left} տեղ՝ {total}-ից', 'Осталось {left} из {total}', '{left} of {total} left'),
    'free':     ('ազատ', 'свободно', 'free'),
    'taken':    ('զբաղված', 'занято', 'taken'),
    'ready':    ('պատրաստ կլինի 1–2 օրում', 'готово за 1–2 дня', 'ready in 1–2 days'),
    'who1':     ('Թանգարանը պատրաստում է Նարեկը՝ Երևանից։ Յուրաքանչյուր շենք վերականգնվում է հին լուսանկարներից։',
                 'Музей делает Нарек из Еревана. Каждое здание восстановлено по старым фотографиям.',
                 'The museum is made by Narek, in Yerevan. Every building is restored from old photographs.'),
    'who2':     ('Չհավանեցիք՝ անվճար նորից կանենք։', 'Не понравится — переделаем бесплатно.', "Don't like it — we'll redo it for free."),
    'cta':      ('Թողնել քո գրությունը', 'Оставить свою надпись', 'Leave your inscription'),
    'foot':     ('Երևանի քանդված շենքերի թանգարան', 'Музей снесённых зданий Еревана', "Museum of Yerevan's demolished buildings"),
    'pay_open': ('Բացվում է վճարման էջը…', 'Открываем оплату…', 'Opening checkout…'),
    'pay_hand': ('Չբացվեց՞ սեղմեք այստեղ։', 'Не открылось — нажмите сюда.', "Didn't open? Tap here."),
    'th_h':     ('Շնորհակալություն։', 'Спасибо.', 'Thank you.'),
    'th_p':     ('Արձանագրությունը պատրաստ կլինի մինչև {date}, հղումը կուղարկվի նամակով։',
                 'Надпись будет готова до {date}, ссылка придёт письмом.',
                 'Your inscription will be ready by {date}; the link will arrive by email.'),
    'share':    ('Ցույց տալ ընկերներին', 'Показать друзьям', 'Show your friends'),
    'copied':   ('Պատճենվեց', 'Скопировано', 'Copied'),
    'share_t':  ('Քո անունը՝ հին Երևանի քարին', 'Твоё имя — на камне старого Еревана', 'Your name on a stone of old Yerevan'),
    'share_x':  ('Չկա — Երևանի քանդված շենքերի թանգարան', 'Չկա — музей снесённых зданий Еревана', "Չկա — museum of Yerevan's demolished buildings"),
    'alt1':     ('Նկար՝ պատին փորագրված NAREK անունով', 'Рисунок: имя NAREK, вырезанное на стене', 'Drawing: the name NAREK carved on a wall'),
    'alt2':     ('Նկար՝ ծառի վրա փորագրված սիրտ՝ A + L', 'Рисунок: сердце A + L на стволе дерева', 'Drawing: a heart with A + L carved on a tree'),
    'alt3':     ('Նկար՝ պատերին հայերեն անուններ', 'Рисунок: армянские имена на стенах', 'Drawing: Armenian names on the walls'),
}
LANGS = ('hy', 'ru', 'en')


def esc(s):
    return html.escape(s, quote=True)


def tr(key, subs=None):
    """Три <span lang> с текстом key; subs — {плейсхолдер: готовый HTML} (подставляется после экранирования остального текста)."""
    out = []
    for i, l in enumerate(LANGS):
        t = esc(STR[key][i])
        for k, v in (subs or {}).items():
            t = t.replace('{%s}' % k, v)
        out.append('<span class="i18n-inline" lang="%s">%s</span>' % (l, t))
    return ''.join(out)


def plain(key, lang):
    return STR[key][LANGS.index(lang)]


def asset_v(rel, root=ROOT):
    return hashlib.sha1((root / rel).read_bytes()).hexdigest()[:8]


def sale_block(path=BUILDING):
    """sale из building.json: total, left (целые, 0 <= left <= total); иначе стоп с понятным текстом."""
    s = json.loads(Path(path).read_text(encoding='utf-8')).get('sale')
    if not isinstance(s, dict):
        raise SystemExit('СТОП: в %s нет блока sale' % path)
    t, l = s.get('total'), s.get('left')
    if not (isinstance(t, int) and isinstance(l, int) and not isinstance(t, bool) and not isinstance(l, bool) and 0 < t and 0 <= l <= t):
        raise SystemExit('СТОП: sale.total/left в %s должны быть целыми, 0 <= left <= total (сейчас %r / %r)' % (path, t, l))
    return {'total': t, 'left': l}


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
          '<meta property="og:image" content="https://chka.am/assets/sale-ex-1.webp"><meta property="og:url" content="%s">') % (esc(title), esc(desc), SHARE_URL)
    return (
        '<!DOCTYPE html>\n<html lang="hy" data-lang="hy">\n<head>\n<meta charset="utf-8">\n'
        '<script>(function(){var d=document.documentElement,l="hy",q=(location.search.match(/[?&]lang=(hy|ru|en)/)||[])[1];'
        'try{l=q||localStorage.getItem("chka-lang")||"hy"}catch(e){l=q||"hy"}'
        'if(["hy","ru","en"].indexOf(l)<0)l="hy";d.setAttribute("data-lang",l);d.setAttribute("lang",l)})();</script>\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<title>%s</title>\n<meta name="description" content="%s">\n<meta name="theme-color" content="#fbfaf7">\n%s\n'
        '<link rel="icon" href="../assets/favicon-32.png">\n<link rel="apple-touch-icon" href="../assets/icon-180.png">\n'
        '<link rel="stylesheet" href="../assets/sale.css?v=%s">\n'
        '<!--chka-analytics-->%s<!--/chka-analytics--></head>\n'
    ) % (esc(title), esc(desc), ('<meta name="robots" content="noindex">' if robots else '') + og, v['css'], snippet)


def lang_switch():
    return '<div class="lsw" role="group" aria-label="Language">%s</div>' % ''.join(
        '<button type="button" data-set-lang="%s" aria-pressed="%s">%s</button>' % (l, 'true' if l == 'hy' else 'false', l.upper()) for l in LANGS)


def bar():
    return '<header class="sbar"><a class="logo" href="/" aria-label="chka.am">Չկա</a>%s</header>\n' % lang_switch()


def foot():
    return '<footer class="sfoot">%s</footer>\n' % tr('foot')


def script(v):
    return '<script src="../assets/sale.js?v=%s" defer></script>\n</body>\n</html>\n' % v['js']


def shop(folder, sale, snippet, v):
    src = CHANNELS[folder]
    title = '%s · %s' % ('Չկա', plain('title', 'hy'))
    chips = ''.join('<li class="chip%s" aria-label="%s">%d</li>' % (
        ' taken' if i <= sale['total'] - sale['left'] else '', esc(plain('taken' if i <= sale['total'] - sale['left'] else 'free', 'hy')), i)
        for i in range(1, sale['total'] + 1))
    figs = ''.join(
        '<figure class="ex"><img src="../assets/%s" width="720" height="480" alt="%s"%s><figcaption>%s</figcaption></figure>' % (
            name, esc(plain('alt' + k[-1], 'hy')), '' if k == 'ex1' else ' loading="lazy" decoding="async"', tr(k))
        for name, k in EXAMPLES)
    n = tr('places_n', {'left': str(sale['left']), 'total': str(sale['total'])})
    body = (
        '<body data-page="shop" data-src="%s">\n%s<main class="wrap">\n'
        '<h1>%s</h1>\n<p class="lead">%s</p>\n'
        '<h2>%s</h2>\n<div class="exrow">%s</div>\n'
        '<h2>%s</h2>\n<p class="sum">%s</p>\n<ul class="chips">%s</ul>\n<p class="legend"><span>%s</span><span>%s</span></p>\n'
        '<div class="price"><b>$%d</b><span>%s</span></div>\n'
        '<div class="who"><p>%s</p><p>%s</p></div>\n'
        '<div class="cta"><a class="btn" href="/pay/?src=%s">%s</a></div>\n</main>\n%s'
    ) % (src, bar(), tr('title'), tr('lead'), tr('ex_h'), figs, tr('places_h'), n, chips, tr('free'), tr('taken'),
         PRICE_USD, tr('ready'), tr('who1'), tr('who2'), src, tr('cta'), foot())
    return head(title, plain('lead', 'hy'), snippet, v) + body + script(v)


def pay(snippet, v):
    title = 'Չկա · %s' % plain('pay_open', 'hy')
    paras = ''.join('<p lang="%s">%s</p>' % (l, esc(plain('pay_open', l))) for l in LANGS)
    hand = ' · '.join('<span lang="%s">%s</span>' % (l, esc(plain('pay_hand', l))) for l in LANGS)
    nos = '<noscript><meta http-equiv="refresh" content="3; url=%s?utm_source=site"></noscript>\n' % POLAR_URL
    body = (
        '<body data-page="pay">\n<main class="center"><div class="paybox" data-polar="%s" data-channels="%s">%s'
        '<p class="small"><a data-pay-link href="%s?utm_source=site">%s</a></p></div></main>\n'
    ) % (POLAR_URL, ','.join(PAY_CHANNELS), paras, POLAR_URL, hand)
    h = head(title, plain('pay_open', 'hy'), snippet, v)
    return h.replace('<!--chka-analytics-->', nos + '<!--chka-analytics-->', 1) + body + script(v)


def thanks(snippet, v):
    title = 'Չկա · %s' % plain('th_h', 'hy')
    attrs = ' '.join('data-title-%s="%s" data-text-%s="%s"' % (l, esc(plain('share_t', l)), l, esc(plain('share_x', l))) for l in LANGS)
    body = (
        '<body data-page="thanks">\n%s<main class="center">\n<h1>%s</h1>\n<p>%s</p>\n'
        '<button type="button" class="btn" data-share data-url="%s" %s><span class="lbl">%s</span><span class="ok">%s</span></button>\n</main>\n%s'
    ) % (bar(), tr('th_h'), tr('th_p', {'date': '<b class="when" data-days="2">…</b>'}), SHARE_URL, attrs, tr('share'), tr('copied'), foot())
    return head(title, plain('th_h', 'hy'), snippet, v) + body + script(v)


def build(sale, snippet, root=ROOT):
    """{папка: html} — все шесть страниц."""
    v = {'css': asset_v('assets/sale.css', root), 'js': asset_v('assets/sale.js', root)}
    out = {f: shop(f, sale, snippet, v) for f in CHANNELS}
    out['pay'] = pay(snippet, v)
    out['thanks'] = thanks(snippet, v)
    return out


def hy_lines():
    return '\n'.join('%-9s %s' % (k, val[0]) for k, val in STR.items())


def main():
    ap = argparse.ArgumentParser(description='buy/, t/, i/, f/, pay/, thanks/ из одного шаблона')
    ap.add_argument('--check', action='store_true', help='не писать: файлы на диске == шаблон?')
    ap.add_argument('--hy-lines', metavar='FILE', help='выгрузить армянские строки на вычитку')
    a = ap.parse_args()
    if a.hy_lines:
        Path(a.hy_lines).write_text(hy_lines() + '\n', encoding='utf-8')
        print('армянских строк: %d -> %s' % (len(STR), a.hy_lines))
        return
    miss = [f for f in ASSETS if not (ROOT / f).is_file()]
    if miss:
        raise SystemExit('СТОП: нет файлов: %s' % ', '.join(miss))
    pages = build(sale_block(), analytics())
    bad = []
    for folder, text in pages.items():
        f = ROOT / folder / 'index.html'
        if a.check:
            if not f.is_file() or f.read_text(encoding='utf-8') != text:
                bad.append('%s/index.html' % folder)
            continue
        f.parent.mkdir(exist_ok=True)
        f.write_text(text, encoding='utf-8')
        print('записано: %s/index.html (%d Б)' % (folder, len(text.encode('utf-8'))))
    if a.check:
        if bad:
            print('не совпадает с шаблоном: %s — python3 tools/build_sale_pages.py' % ', '.join(bad))
            sys.exit(1)
        print('OK: 6 страниц == шаблон')


if __name__ == '__main__':
    main()
