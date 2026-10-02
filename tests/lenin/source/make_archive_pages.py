#!/usr/bin/env python3
"""Ленин: страница «архив и хроника» (about.html) и «история» (history.html) — по образцу живого Кукурузника
(kukuruznik/about.html — архив + хроника, kukuruznik/history.html — главы с фото). Тексты ru/hy/en здесь, в одном месте;
факты и источники — tests/lenin/sources.md (раздел «Архив и история»); hy — на проверку носителю (report/lenin-texts-hy.md).

  python3 tests/lenin/source/make_archive_pages.py      # пишет tests/lenin/about.html и tests/lenin/history.html

Фото: tests/lenin/gallery-source/*.jpg (оригиналы с Wikimedia Commons) -> tests/lenin/gallery/ (python3 tools/images.py --gallery tests/lenin).
Адреса — от папки tests/lenin/ (../../ = корень сайта); при сборке беты tools/build_pages.py пересчитывает их для beta/tests/lenin/.
Страницы скрытые (noindex), как и сама бета.
"""
import html
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent.parent          # tests/lenin
GAL = HERE / 'gallery'
ROOT = '../../'                                         # корень сайта от tests/lenin/
e = lambda s: html.escape(s, quote=True)


def tri(hy, ru, en, cls='i18n-inline', extra=''):
    return ''.join('<span class="%s%s" lang="%s">%s</span>' % (cls, extra, l, t) for l, t in (('hy', hy), ('ru', ru), ('en', en)))


COMMONS = 'https://commons.wikimedia.org/wiki/File:'
BYSA2 = 'https://creativecommons.org/licenses/by-sa/2.0/'
MUSEUM = 'Armenian Museum of Photo and Video Materials / Wikimedia Commons'

# фото: имя в gallery/, файл Commons, подпись (hy, ru, en), alt (ru, как у Кукурузника), лицензия
PHOTOS = [
    dict(name='lenin-1940s', file='Lenin_Statue_in_Yerevan_Lenin_Square.jpg',
         cap=('Հուշարձանը, 1940-ականներ', 'Памятник, 1940-е', 'The monument, 1940s'),
         alt='Памятник Ленину в Ереване, 1940-е', pd=True, pos='50% 0%'),   # pos: кадрирование 4:3 в главе истории — по верху, иначе срезается статуя
    dict(name='removal-1991-square', file='Lenin_Statue_Removal_in_Yerevan_05.jpg',
         cap=('1991, ապրիլի 13. տեսարան հրապարակին', '13 апреля 1991: вид на площадь', '13 April 1991: view of the square'),
         alt='Площадь в день снятия памятника, 13 апреля 1991'),
    dict(name='removal-1991-pedestal', file='Lenin_Statue_Removal_in_Yerevan_06.jpg',
         cap=('1991, ապրիլի 13. արձանը պատվանդանին', '13 апреля 1991: статуя на постаменте', '13 April 1991: the statue on its pedestal'),
         alt='Статуя на постаменте в день снятия, 13 апреля 1991'),
    dict(name='removal-1991-crane', file='Lenin_Statue_Removal_in_Yerevan_02.jpg',
         cap=('1991, ապրիլի 13. արձանը բարձրացնում են կռունկով', '13 апреля 1991: статую поднимают краном', '13 April 1991: the statue lifted by crane'),
         alt='Статую поднимают краном с постамента, 13 апреля 1991'),
    dict(name='removal-1991-truck', file='Lenin_Statue_Removal_in_Yerevan_3.jpg',
         cap=('1991, ապրիլի 13. արձանը տեղափոխում են', '13 апреля 1991: статую увозят', '13 April 1991: the statue taken away'),
         alt='Статую увозят на грузовике, 13 апреля 1991'),
]
P = {p['name']: p for p in PHOTOS}


def credit(p, lang):
    """Подпись источника в окне просмотра — формат Кукурузника: «фото: <автор / Wikimedia Commons>, <лицензия> · сжато»."""
    lead = {'hy': 'լուսանկարը՝', 'ru': 'фото:', 'en': 'photo:'}[lang]
    done = {'hy': 'սեղմված', 'ru': 'сжато', 'en': 'compressed'}[lang]
    if p.get('pd'):
        who = {'hy': 'հեղինակն անհայտ է', 'ru': 'автор неизвестен', 'en': 'unknown author'}[lang] + ' / Wikimedia Commons'
        lic = {'hy': 'հանրային սեփականություն', 'ru': 'общественное достояние', 'en': 'public domain'}[lang]
        return "%s <a href='%s' target='_blank' rel='noopener'>%s</a>, %s · %s" % (lead, COMMONS + p['file'], who, lic, done)
    return "%s <a href='%s' target='_blank' rel='noopener'>%s</a>, <a href='%s' target='_blank' rel='noopener'>CC BY-SA 2.0</a> · %s" % (
        lead, COMMONS + p['file'], MUSEUM, BYSA2, done)


def figcaption(p):
    """Подпись под фото в главе истории (как в kukuruznik/history.html)."""
    lead = tri('լուսանկարը՝', 'фото:', 'photo:')
    done = tri('սեղմված', 'сжато', 'compressed')
    if p.get('pd'):
        who = tri('հեղինակն անհայտ է', 'автор неизвестен', 'unknown author')
        lic = tri('հանրային սեփականություն', 'общественное достояние', 'public domain')
        return '%s\n        <a href="%s" target="_blank" rel="noopener">%s / Wikimedia Commons</a>, %s ·\n        %s' % (lead, COMMONS + p['file'], who, lic, done)
    return '%s\n        <a href="%s" target="_blank" rel="noopener">%s</a>,\n        <a href="%s" target="_blank" rel="noopener">CC BY-SA 2.0</a> ·\n        %s' % (
        lead, COMMONS + p['file'], MUSEUM, BYSA2, done)


LANG_SCRIPT = '''<script>
(function () {
  try {
    var K = 'chka-lang', L = ['hy', 'ru', 'en'], l = localStorage.getItem(K);
    if (!l) {
      var n = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
      for (var i = 0; i < L.length; i++) { if (n.indexOf(L[i]) === 0) { l = L[i]; break; } }
    }
    if (L.indexOf(l) === -1) l = 'hy';
    document.documentElement.setAttribute('data-lang', l);
    document.documentElement.setAttribute('lang', l);
  } catch (e) { document.documentElement.setAttribute('data-lang', 'hy'); }
})();
</script>
<script>
/* крупный текст («А+») и появление главной — до отрисовки, без мигания */
(function () {
  var d = document.documentElement;
  try { if (localStorage.getItem('chka-fs') === 'big') d.classList.add('fs-big'); } catch (e) {}
})();
</script>'''

FONTS = '''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700&family=Noto+Sans+Armenian:wght@500;600;700&family=Caveat:wght@600&display=swap">'''

ARROW_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
ARROW_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>'
CUBE = '<svg class="cube-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12v9M4 7.5l8 4.5 8-4.5"/></svg>'

FOOT = '''  <footer class="foot reveal">
    <p class="brand"><span class="hy">Չկա</span> · <a href="%(root)s">%(home)s</a></p>
    <p class="photo-rights">%(rights)s</p>
    <p class="tiktok"><a class="btn" href="https://www.tiktok.com/@ht_product">%(tt)s</a></p>
  </footer>''' % dict(
    root=ROOT,
    home=tri('գլխավոր էջ', 'на главную альбома', 'back to the album'),
    rights=tri('Արխիվային լուսանկարները պատկանում են իրենց հեղինակներին և արխիվներին։ Օգտագործվում են ոչ առևտրային նախագծում՝ աղբյուրը նշելով։ Եթե դուք հեղինակն եք և ցանկանում եք ուղղել ստորագրությունը կամ հեռացնել լուսանկարը՝ <a href="https://www.tiktok.com/@ht_product">գրեք ինձ</a>։',
               'Архивные фото принадлежат их авторам и архивам. Используются в некоммерческом проекте с указанием источника. Если вы автор и хотите исправить подпись или убрать фото — <a href="https://www.tiktok.com/@ht_product">напишите мне</a>.',
               'Archival photos belong to their authors and archives. Used in a non-commercial project with the source credited. If you are the author and want to fix a caption or remove a photo — <a href="https://www.tiktok.com/@ht_product">message me</a>.', cls='i18n-block'),
    tt=tri('TikTok-ում', 'мой TikTok', 'my TikTok'))


def head(title, desc):
    return '''<!DOCTYPE html>
<html lang="hy">
<head>
<meta charset="utf-8">
%s
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="googlebot" content="noindex, nofollow">
<meta name="theme-color" content="#fbfaf7">
<title>%s</title>
<meta name="description" content="%s">
<link rel="icon" href="%sassets/favicon-32.png">
<link rel="apple-touch-icon" href="%sassets/icon-180.png">
%s
''' % (LANG_SCRIPT, e(title), e(desc), ROOT, ROOT, FONTS)


# ---------------- about.html: шапка, архив (галерея), хроника ----------------
def g_item(p):
    w, h = Image.open(GAL / (p['name'] + '.webp')).size
    caps = ' '.join('data-cap-%s="%s"' % (l, e(c)) for l, c in zip(('hy', 'ru', 'en'), p['cap']))
    creds = ' '.join('data-credit-%s="%s"' % (l, e(credit(p, l))) for l in ('hy', 'ru', 'en'))
    return '''      <button class="g-item" type="button" data-full="gallery/%s.webp" data-w="%d" data-h="%d"
              %s
              %s>
        <div class="g-pic"><img src="gallery/%s-thumb.webp" width="480" height="480" alt="%s" loading="lazy" decoding="async"></div>
      </button>''' % (p['name'], w, h, caps, creds, p['name'], e(p['alt']))


TIMELINE = [
    (tri('Հեղինակներ', 'Авторы', 'Authors', extra=' t-y'), tri('Ս. Մերկուրով (արձան), Ն. Պարեմուզովա, Լ. Վարդանով (պատվանդան)', 'С. Меркуров (статуя), Н. Паремузова, Л. Вартанов (постамент)', 'S. Merkurov (statue), N. Paremuzova, L. Vartanov (pedestal)', cls='i18n-block')),
    ('<span class="t-y">1924</span>', tri('Հրապարակը Ալեքսանդր Թամանյանի գլխավոր հատակագծում', 'Площадь в генеральном плане Александра Таманяна', 'The square in Alexander Tamanian\'s general plan', cls='i18n-block')),
    ('<span class="t-y">1938</span>', tri('Հուշարձանի նախագծի համամիութենական մրցույթ', 'Всесоюзный конкурс на проект памятника', 'All-Union design competition for the monument', cls='i18n-block')),
    ('<span class="t-y">1940</span>', tri('Հուշարձանի բացումը, նոյեմբերի 24', 'Открытие памятника, 24 ноября', 'Monument unveiled, 24 November', cls='i18n-block')),
    ('<span class="t-y">1990</span>', tri('Հրապարակը վերանվանվում է Հանրապետության հրապարակ', 'Площадь переименована в площадь Республики', 'The square is renamed Republic Square', cls='i18n-block')),
    ('<span class="t-y">1991</span>', tri('Արձանն ապամոնտաժվում է, ապրիլի 13', 'Статуя снята, 13 апреля', 'The statue is removed, 13 April', cls='i18n-block')),
    ('<span class="t-y">1996</span>', tri('Պատվանդանն ապամոնտաժվում է, հուլիս', 'Постамент разобран, июль', 'The pedestal is dismantled, July', cls='i18n-block')),
]


def about():
    t = head('Памятник Ленину — архив | Չկա', 'Памятник Ленину на главной площади Еревана (1940–1991): архивные фото и хроника. Скрытая бета.')
    t += '''<link rel="stylesheet" href="%sassets/hub.css?v=12">
<link rel="stylesheet" href="%sassets/story.css?v=13">
</head>
<body>
<nav class="nav"><div class="nav-in">
  <a class="logo" href="%s" aria-label="Все здания — назад в альбом Չկա">%s<span class="hy">Չկա</span></a>
  <div class="lang-switch-mount" data-lang-switch></div>
</div></nav>
<main class="page story-wrap">
  <header class="s-head reveal">
    <h1>%s</h1>
    <p class="meta">%s</p>
    <div class="s-actions">
    <a class="btn btn-3d" href="./">%s<span>%s</span></a>
    <a class="btn btn-ghost btn-history" href="history.html">%s%s</a>
    </div>
  </header>
  <section class="sec gallery-sec reveal" aria-labelledby="gal-h">
    <h2 id="gal-h">%s</h2>
    <div class="gallery" id="gallery">
%s
    </div>
    <p class="g-hint">%s</p>
  </section>
  <section class="sec timeline-sec reveal" aria-labelledby="tl-h">
    <h2 id="tl-h">%s</h2>
    <ol class="timeline">
%s
    </ol>
  </section>
%s
</main>
<script src="%sassets/i18n.js?v=2" defer></script>
<script src="%sassets/chka-common.js?v=2" defer></script>
<script src="%sassets/story.js?v=7" defer></script>
<script src="%sassets/gallery.js?v=1" defer></script>
</body>
</html>
''' % (ROOT, ROOT, ROOT, ARROW_L,
       tri('Լենինի արձանը', 'Памятник Ленину', 'Lenin Monument'),
       tri('Լենինի հրապարակ · Երևան · 1940–1991', 'Площадь Ленина · Ереван · 1940–1991', 'Lenin Square · Yerevan · 1940–1991'),
       CUBE, tri('Տեսնել 3D-ով', 'Смотреть в 3D', 'View in 3D'),
       tri('Կարդալ պատմությունը', 'Читать историю', 'Read the history'), ARROW_R,
       tri('Արխիվ', 'Архив', 'Archive'),
       '\n'.join(g_item(p) for p in PHOTOS),
       tri('սահեցրու՝ մյուսները տեսնելու համար · աղբյուրը՝ լուսանկարը մեծացնելիս', 'свайп по фото · подпись и источник — при открытии фото крупно', 'swipe through the photos · source shown when you open one'),
       tri('Ժամանակագրություն', 'Хроника', 'Timeline'),
       '\n'.join('      <li class="reveal">%s<div>%s</div></li>' % (y, d) for y, d in TIMELINE),
       FOOT, ROOT, ROOT, ROOT, ROOT)
    return t


# ---------------- history.html: главы ----------------
CHAPTERS = [
    dict(title=('Նախապես թողնված տեղը', 'Место, оставленное заранее', 'A place set aside in advance'), photo=None, text=(
        'Երևանի գլխավոր հրապարակը նախագծել է ճարտարապետ Ալեքսանդր Թամանյանը՝ քաղաքի 1924 թվականի գլխավոր հատակագծում։ Շինարարությունն սկսվել է 1926 թվականին՝ Կառավարության շենքից։ Լենինի արձանի համար Թամանյանը տեղ էր հատկացրել հրապարակի հարավային կողմում, որտեղ հրապարակը միանում է բուլվարին։ 1920-ական թվականների վերջին այնտեղ դրվել էր փոքր օբելիսկ՝ գրությամբ, որ այստեղ հուշարձան է կանգնեցվելու։',
        'Главную площадь Еревана спроектировал архитектор Александр Таманян в генеральном плане города 1924 года. Строить её начали в 1926 году — с Дома правительства. Место для памятника Ленину Таманян отвёл на южной стороне, там, где площадь переходит в бульвар. В конце 1920-х годов там поставили небольшой обелиск с надписью о том, что здесь будет установлен памятник.',
        'Yerevan\'s main square was designed by the architect Alexander Tamanian as part of the city\'s 1924 general plan. Construction began in 1926, starting with the Government House. Tamanian set aside a spot for a Lenin monument on the south side, where the square meets the boulevard. In the late 1920s a small obelisk was placed there, with an inscription saying that a monument would stand on this spot.')),
    dict(title=('Մրցույթն ու բացումը', 'Конкурс и открытие', 'Competition and unveiling'), photo='lenin-1940s', text=(
        '1938 թվականին հայտարարվեց հուշարձանի նախագծի համամիութենական մրցույթ։ Արձանը հանձնարարվեց քանդակագործ Սերգեյ Մերկուրովին, պատվանդանը՝ ճարտարապետներ Նատալյա Պարեմուզովային և Լևոն Վարդանովին։ Արձանը պատրաստվեց կռածո պղնձից, պատվանդանը՝ գրանիտից։ Հուշարձանը բացվեց 1940 թվականի նոյեմբերի 24-ին՝ Հայաստանում խորհրդային իշխանության 20-ամյակի առթիվ։',
        'В 1938 году объявили всесоюзный конкурс на проект памятника. Статую поручили скульптору Сергею Меркурову, постамент — архитекторам Наталье Паремузовой и Левону Вартанову. Статую выковали из меди, постамент сделали из гранита. Памятник открыли 24 ноября 1940 года, к 20-летию советской власти в Армении.',
        'In 1938 an all-Union competition for the monument\'s design was announced. The statue was entrusted to the sculptor Sergey Merkurov, the pedestal to the architects Natalia Paremuzova and Levon Vartanov. The statue was made of forged copper, the pedestal of granite. The monument was unveiled on 24 November 1940, for the 20th anniversary of Soviet rule in Armenia.')),
    dict(title=('Լենինի հրապարակը', 'Площадь Ленина', 'Lenin Square'), photo=None, text=(
        'Խորհրդային տարիներին հրապարակը կոչվում էր Լենինի հրապարակ։ Արձանի տակ ամբիոն կար. Մայիսի 1-ի և նոյեմբերի 7-ի տոնական ցույցերի և շքերթների ժամանակ դրա վրա կանգնում էին Խորհրդային Հայաստանի ղեկավարները։',
        'В советские годы площадь называлась площадью Ленина. Под статуей была трибуна: на праздничных демонстрациях и парадах 1 Мая и 7 Ноября на ней стояли руководители Советской Армении.',
        'In Soviet times it was called Lenin Square. Beneath the statue was a tribune: during the May Day and 7 November demonstrations and parades, the leaders of Soviet Armenia stood on it.')),
    dict(title=('1991-ի ապրիլը', 'Апрель 1991-го', 'April 1991'), photo='removal-1991-crane', text=(
        '1990 թվականին հրապարակը վերանվանվեց Հանրապետության հրապարակ։ 1991 թվականի մարտի 28-ին Երևանի քաղաքային խորհուրդը որոշեց ապամոնտաժել հուշարձանը։ 1991 թվականի ապրիլի 13-ին արձանը կռունկով բարձրացրին պատվանդանից և բեռնատարով տարան. այդ օրը հրապարակում շատ մարդիկ էին հավաքվել։',
        'В 1990 году площадь переименовали в площадь Республики. 28 марта 1991 года горсовет Еревана решил снять памятник. 13 апреля 1991 года статую подняли краном с постамента и увезли на грузовике; на площадь в этот день пришло много людей.',
        'In 1990 the square was renamed Republic Square. On 28 March 1991 the Yerevan City Council decided to remove the monument. On 13 April 1991 the statue was lifted off its pedestal by crane and taken away on a truck; many people came to the square that day.')),
    dict(title=('Ինչ մնաց', 'Что осталось', 'What remains'), photo='removal-1991-truck', text=(
        'Դատարկ պատվանդանը կանգուն մնաց ևս հինգ տարի և ապամոնտաժվեց 1996 թվականի հուլիսին։ Ապամոնտաժումից հետո արձանի մարմինը տեղափոխեցին Հայաստանի ազգային պատկերասրահի բակ, իսկ գլուխն առանձին պահեստ տարան։',
        'Пустой постамент простоял ещё пять лет и был разобран в июле 1996 года. Статую после снятия перевезли во двор Национальной галереи Армении, а голову отдельно отправили на склад.',
        'The empty pedestal stood for five more years and was dismantled in July 1996. After the removal the statue was taken to the courtyard of the National Gallery of Armenia, and its head was put into storage separately.')),
]

SOURCES = [
    ('https://mediamax.am/ru/specialprojects/yerevan-XX-century/6339/', 'mediamax.am', '— «Памятник Ленину — (не)живая история» (по книге М. Григоряна «Площадь Ленина в Ереване», 1969)'),
    ('https://hy.wikipedia.org/wiki/%D4%BC%D5%A5%D5%B6%D5%AB%D5%B6%D5%AB_%D5%B0%D5%B8%D6%82%D5%B7%D5%A1%D6%80%D5%B1%D5%A1%D5%B6_(%D4%B5%D6%80%D6%87%D5%A1%D5%B6)', 'hy.wikipedia.org', '— «Լենինի հուշարձան (Երևան)»'),
    ('https://hy.wikipedia.org/wiki/%D5%80%D5%A1%D5%B6%D6%80%D5%A1%D5%BA%D5%A5%D5%BF%D5%B8%D6%82%D5%A9%D5%B5%D5%A1%D5%B6_%D5%B0%D6%80%D5%A1%D5%BA%D5%A1%D6%80%D5%A1%D5%AF_(%D4%B5%D6%80%D6%87%D5%A1%D5%B6)', 'hy.wikipedia.org', '— «Հանրապետության հրապարակ (Երևան)»'),
    ('https://en.wikipedia.org/wiki/Republic_Square,_Yerevan', 'en.wikipedia.org', '— «Republic Square, Yerevan»'),
    ('http://www.aniarc.am/2021/07/16/the-dismantling-of-lenins-statue-took-place-in-1991-16-20-2021/', 'aniarc.am', ''),
    ('https://commons.wikimedia.org/wiki/Category:Statue_of_Lenin_in_Yerevan', 'commons.wikimedia.org', '— Statue of Lenin in Yerevan'),
]


def chapter(i, c):
    fig = ''
    if c['photo']:
        p = P[c['photo']]
        fig = '''    <figure class="ch-fig">
      <img src="gallery/%s.webp" alt="%s"%s loading="lazy" decoding="async">
      <figcaption>
        %s
      </figcaption>
    </figure>
''' % (p['name'], e(p['alt']), (' style="object-position: %s"' % p['pos']) if p.get('pos') else '', figcaption(p))
    paras = '\n'.join('      <p class="i18n-block%s" lang="%s">%s</p>' % (' hy' if l == 'hy' else '', l, t) for l, t in zip(('hy', 'ru', 'en'), c['text']))
    return '''  <section class="chapter reveal" id="ch%d">
    <p class="ch-num">%02d</p>
    <h2>
      %s
    </h2>
%s    <div class="ch-text">
%s
    </div>
  </section>

''' % (i, i, tri(*c['title']), fig, paras)


def history():
    t = head('История памятника Ленину | Չկա', 'Памятник Ленину на главной площади Еревана: от места в плане Таманяна до снятия в 1991 году. Пять глав. Скрытая бета.')
    t += '''<link rel="stylesheet" href="%sassets/hub.css?v=12">
<link rel="stylesheet" href="%sassets/story.css?v=13">
<link rel="stylesheet" href="%sassets/history.css?v=3">
</head>
<body>

<div class="progress" aria-hidden="true"><span id="progressBar"></span></div>

<nav class="nav"><div class="nav-in">
  <a class="logo" href="about.html" aria-label="Назад к архиву памятника">%s<span class="logo-sub">%s</span></a>
  <div class="lang-switch-mount" data-lang-switch></div>
</div></nav>

<main class="page history">

  <header class="h-head reveal">
    <p class="h-eyebrow">
      %s
    </p>
    <h1>
      %s
    </h1>
    <p class="h-sub">
      %s
    </p>
  </header>

%s  <section class="h-sources reveal">
    <h2>
      %s
    </h2>
    %s
    <ul class="h-src-list">
%s
    </ul>
  </section>

  <section class="next-sec reveal">
    <a class="btn btn-ghost" href="about.html">
      %s
    </a>
  </section>

%s

</main>

<script src="%sassets/i18n.js?v=2" defer></script>
<script src="%sassets/chka-common.js?v=2" defer></script>
<script src="%sassets/history.js?v=1" defer></script>
</body>
</html>
''' % (ROOT, ROOT, ROOT, ARROW_L,
       tri('Լենինի արձանը', 'Памятник Ленину', 'Lenin Monument'),
       tri('հինգ գլուխ', 'пять глав', 'five chapters'),
       tri('Հրապարակի և հուշարձանի պատմությունը', 'История площади и памятника', 'The Square and the Monument'),
       tri('Ինչպես Երևանի գլխավոր հրապարակում հայտնվեց Լենինի հուշարձանը և ինչ մնաց դրանից։',
           'Как на главной площади Еревана появился памятник Ленину и что от него осталось.',
           'How a Lenin monument came to stand on Yerevan\'s main square — and what is left of it.', cls='i18n-block'),
       ''.join(chapter(i + 1, c) for i, c in enumerate(CHAPTERS)),
       tri('Աղբյուրներ', 'Источники', 'Sources'),
       tri('Փաստերը վերապատմված են իմ իսկ բառերով՝ առանց հոդվածների տեքստը կրկնօրինակելու։', 'Факты пересказаны своими словами, без копирования текста статей.', 'Facts are retold in my own words, without copying the text of the articles.', cls='i18n-block'),
       '\n'.join('      <li><a href="%s" target="_blank" rel="noopener">%s</a>%s</li>' % (u, n, (' ' + d) if d else '') for u, n, d in SOURCES),
       tri('← հուշարձանի արխիվ', '← к архиву памятника', '← back to the monument archive'),
       FOOT, ROOT, ROOT, ROOT)
    return t


if __name__ == '__main__':
    (HERE / 'about.html').write_text(about(), encoding='utf-8')
    (HERE / 'history.html').write_text(history(), encoding='utf-8')
    print('написано: tests/lenin/about.html, tests/lenin/history.html')
