#!/usr/bin/env python3
"""Заход 19 (шаг 8): страницы about/history Погос-Петроса + витрина (gallery/*.webp) + card.webp.
Разметка — точно Ленина (tests/lenin/about.html, history.html: тот же редизайн 10в, подвал, hy/ru/en); меняются заголовки, витрина, хроника, главы.
Тексты — ТОЛЬКО из pogos-petros/sources/texts.md и sources.md (факты 1–14 + «противоречия»). Фото — только PD/«вероятно PD» из sources.md; фото с пометкой
«только референс» (Фридлянд, ГНИМА, «статус не проверен») НЕ ставятся. Нижняя плашка PastVu с фото срезается.
Повторный запуск даёт те же файлы (webp пишутся детерминированно)."""
import html, re
from pathlib import Path
from PIL import Image

R = Path('.')
SRC = R / 'pogos-petros/sources'
OUT = R / 'tests/pogos-petros'
LEN = R / 'tests/lenin'
L3 = ('hy', 'ru', 'en')


def inline(hy, ru, en, cls='i18n-inline'):
    return ''.join('<span class="%s" lang="%s">%s</span>' % (cls, l, html.escape(t, quote=False)) for l, t in zip(L3, (hy, ru, en)))


# ---------------------------------------------------------------- фото (только PD / «вероятно PD»; reference-only не берём)
PV = lambda n: 'https://pastvu.com/p/%s' % n
CM = lambda f: 'https://commons.wikimedia.org/wiki/File:%s' % f
# (имя, исходник, срез снизу доли высоты, квадрат миниатюры (x0, y0, сторона, в долях большей стороны), подпись hy/ru/en, alt ru, автор/источник hy/ru/en, ссылка, лицензия hy/ru/en)
UNK = ('հեղինակն անհայտ է', 'автор неизвестен', 'unknown author')
PROB = ('հավանաբար հանրային սեփականություն', 'вероятно общественное достояние', 'probably public domain')
PD = ('հանրային սեփականություն', 'общественное достояние', 'public domain')
PHOTOS = [
    dict(name='west-1927', src='pastvu/pv1958878_1927.jpg', crop=(0, 0.12), url=PV(1958878), org='PastVu', who=UNK, lic=PROB,
         cap=('Արևմտյան մուտքը և զանգակատունը, 1927', 'Западный вход и колокольня, 1927', 'The west entrance and the belfry, 1927'),
         alt='Западный фасад церкви Погос-Петрос с колокольней, 1927'),
    dict(name='side-1930', src='commons/c_1930s.png', crop=(0.12, 0), url=CM('St_peter_paul_yerevan_1930.png'), org='Wikimedia Commons', who=UNK, lic=PD,
         cap=('Երկար ճակատը և զանգակատունը, մոտ 1930', 'Длинный фасад и колокольня, около 1930', 'The long side and the belfry, around 1930'),
         alt='Длинный фасад церкви Погос-Петрос и колокольня, около 1930'),
    dict(name='yard-1929', src='pastvu/pv1465889_1929.jpg', crop=(0.35, 0), url=PV(1465889), org='PastVu (Երևանի պատմության թանգարանի ֆոնդերից)', who=UNK, lic=PROB,
         cap=('Եկեղեցու բակը և շինարարությունը շուրջը, 1929', 'Двор церкви и стройка вокруг, 1929', 'The churchyard and construction around it, 1929'),
         alt='Двор церкви Погос-Петрос и стройка вокруг, 1929', org3=('PastVu (Երևանի պատմության թանգարանի ֆոնդերից)', 'PastVu (из фондов Музея истории Еревана)', 'PastVu (from the History Museum of Yerevan collection)')),
    dict(name='portal-1915', src='pastvu/pv1389608_1915.jpg', crop=(0, 0.1), url=PV(1389608), org='PastVu', who=UNK, lic=PROB,
         cap=('Քանդակազարդ շքամուտքը և դուռը, 1915', 'Резной портал и дверь, 1915', 'The carved portal and door, 1915'),
         alt='Резной портал и дверь церкви Погос-Петрос, 1915'),
    dict(name='altar-1915', src='pastvu/pv1389610_1915.jpg', crop=(0, 0.1), url=PV(1389610), org='PastVu', who=UNK, lic=PROB,
         cap=('Խորանը, 1915', 'Алтарь, 1915', 'The altar, 1915'),
         alt='Алтарь церкви Погос-Петрос, 1915'),
    dict(name='demolition-1930s', src='commons/c_kalantar_facade.jpg', crop=(0.15, 0), url=CM('Saint_Paul_and_Peter_Church,_Yerevan.jpg'), org='Wikimedia Commons',
         who=('Ա. Կալանթար', 'А. Калантар', 'A. Kalantar'), lic=PD,
         cap=('Եկեղեցու քանդումը, 1930-ական թվականներ', 'Разборка церкви, 1930-е', 'The church being dismantled, 1930s'),
         alt='Разборка церкви Погос-Петрос, 1930-е'),
    dict(name='cinema-1936', src='pastvu/pv1367002_1936.jpg', crop=(0.17, 0), url=PV(1367002), org='PastVu', who=UNK, lic=PROB,
         cap=('«Մոսկվա» կինոթատրոնի շինարարությունը, 1936', 'Стройка кинотеатра «Москва», 1936', 'The Moscow Cinema under construction, 1936'),
         alt='Строительство кинотеатра «Москва» на месте церкви, 1936'),
]


def prep_photos():
    (OUT / 'gallery').mkdir(parents=True, exist_ok=True)
    info = {}
    for p in PHOTOS:
        im = Image.open(SRC / p['src']).convert('RGB')
        if p['src'].startswith('pastvu/'):   # нижняя плашка PastVu («pastvu.com/N uploaded by …») ≈ 2,3 % высоты
            im = im.crop((0, 0, im.width, im.height - round(im.height * 0.0235) - 2))
        W, H = im.size
        full = im if max(W, H) <= 1200 else im.resize((round(W * 1200 / max(W, H)), round(H * 1200 / max(W, H))), Image.LANCZOS)
        full.save(OUT / 'gallery' / (p['name'] + '.webp'), 'WEBP', quality=80, method=6)
        s = min(W, H); fx, fy = p['crop']
        x0 = round(fx * (W - s)) if W > s else 0
        y0 = round(fy * (H - s)) if H > s else 0
        th = im.crop((x0, y0, x0 + s, y0 + s)).resize((480, 480), Image.LANCZOS)
        th.save(OUT / 'gallery' / (p['name'] + '-thumb.webp'), 'WEBP', quality=80, method=6)
        info[p['name']] = full.size
    return info


def prep_card():
    a = Image.open(OUT / 'frames/pogos_a.webp').convert('RGB')   # здание крупно, как у Ленина: квадрат 480×480 из кадра A (шпиль → ступени)
    a.crop((0, 300, 768, 300 + 768)).resize((480, 480), Image.LANCZOS).save(OUT / 'card.webp', 'WEBP', quality=84, method=6)


def credit_html(p, lang_i):
    who = p['who'][lang_i]; org = (p.get('org3') or (None, None, None))[lang_i] or p['org']
    pre = ('լուսանկարը՝', 'фото:', 'photo:')[lang_i]
    return "%s <a href='%s' target='_blank' rel='noopener'>%s / %s</a>, %s · %s" % (pre, p['url'], who, org, p['lic'][lang_i], ('սեղմված', 'сжато', 'compressed')[lang_i])


def gallery_items(info):
    out = []
    for p in PHOTOS:
        w, h = info[p['name']]
        cr = ' '.join('data-credit-%s="%s"' % (l, html.escape(credit_html(p, i), quote=True)) for i, l in enumerate(L3))
        caps = ' '.join('data-cap-%s="%s"' % (l, html.escape(p['cap'][i], quote=True)) for i, l in enumerate(L3))
        org = [(p.get('org3') or (None,) * 3)[i] or p['org'] for i in range(3)]
        src = inline(*['%s / %s, %s' % (p['who'][i], org[i], p['lic'][i]) for i in range(3)])
        out.append('      <button class="g-item" type="button" data-full="gallery/%s.webp" data-w="%d" data-h="%d"\n              %s\n              %s>\n'
                   '        <div class="g-pic"><img src="gallery/%s-thumb.webp" width="480" height="480" alt="%s" loading="lazy" decoding="async"></div>\n'
                   '        <span class="g-label"><span class="g-cap">%s</span><span class="g-src">%s</span></span>\n      </button>'
                   % (p['name'], w, h, caps, cr, p['name'], html.escape(p['alt'], quote=True), inline(*p['cap']), src))
    return '\n'.join(out)


def figure(name, pos=None):
    p = next(q for q in PHOTOS if q['name'] == name)
    org = [(p.get('org3') or (None,) * 3)[i] or p['org'] for i in range(3)]
    pre = inline('լուսանկարը՝', 'фото:', 'photo:')
    lnk = '<a href="%s" target="_blank" rel="noopener">%s</a>' % (p['url'], inline(*['%s / %s' % (p['who'][i], org[i]) for i in range(3)]))
    lic = inline(*p['lic'])
    cmp_ = inline('սեղմված', 'сжато', 'compressed')
    return ('    <figure class="ch-fig">\n      <img src="gallery/%s.webp" alt="%s"%s loading="lazy" decoding="async">\n      <figcaption>\n        %s\n        %s, %s ·\n        %s\n      </figcaption>\n    </figure>'
            % (name, html.escape(p['alt'], quote=True), (' style="object-position: %s"' % pos) if pos else '', pre, lnk, lic, cmp_))


# ---------------------------------------------------------------- тексты about (хроника): факты sources.md
def row_label(hy, ru, en, texts):
    return '      <li class="reveal">%s<div>%s</div></li>' % (inline(hy, ru, en, 'i18n-inline t-y'), inline(*texts, cls='i18n-block'))


def row_year(y, texts):
    return '      <li class="reveal"><span class="t-y">%s</span><div>%s</div></li>' % (y, inline(*texts, cls='i18n-block'))


def row_era(hy, ru, en, texts):
    return row_label(hy, ru, en, texts)


TIMELINE = '\n'.join([
    row_label('Վայրը', 'Место', 'Location', (
        'Շահար հին թաղամասը՝ այժմյան Աբովյան և Թումանյան փողոցների անկյունում',
        'Старый квартал Шаар, угол нынешних улиц Абовяна и Туманяна',
        'The old Shahar quarter, at the corner of today’s Abovyan and Tumanyan streets')),
    row_era('V–VI դդ.', 'V–VI вв.', '5th–6th c.', (
        'Եկեղեցու հիմնադրումը՝ հին Երևանի ամենահին և ամենամեծ եկեղեցին',
        'Основание церкви — старейшей и крупнейшей церкви старого Еревана',
        'The church is founded — the oldest and largest of old Yerevan')),
    row_year('1679', (
        'Երկրաշարժը ավերում է եկեղեցին. այն վերակառուցում են պահպանված արևելյան մասի վրա',
        'Землетрясение разрушает церковь; её отстраивают на уцелевшей восточной части',
        'An earthquake ruins the church; it is rebuilt on the surviving east part')),
    row_year('1778', (
        'Նորոգում, որի մասին պատմում է արձանագրությունը',
        'Ремонт, о котором рассказывает надпись',
        'A repair recorded in an inscription')),
    row_year('1820', (
        'Նորոգում ծխականների միջոցներով՝ ըստ արձանագրության, ինչը այն ժամանակ հազվադեպ էր',
        'Ремонт на деньги прихожан — по надписи; по тем временам редкость',
        'A repair paid for by the parishioners, according to an inscription — rare at the time')),
    row_year('1831', (
        'Կառուցվում են Սուրբ Ստեփանոս և Սուրբ Հովհաննես Մկրտիչ մատուռները',
        'Построены приделы Св. Степаноса и Иоанна Крестителя',
        'The chapels of St Stepanos and St John the Baptist are built')),
    row_year('1835', (
        'Տեր Վարդանը եկեղեցուն նվիրում է Հին Բայազետի բերդի երկաթե դուռը',
        'Тер Вардан дарит церкви железную дверь из крепости Старый Баязет',
        'Ter Vardan gives the church an iron door from the Old Bayazet fortress')),
    row_year('1923', (
        'Զալխանի մզկիթի մինարեթը և եկեղեցու զանգակատունը երևում են նույն լուսանկարում',
        'Минарет мечети Залхан и колокольня церкви попадают на один снимок',
        'The Zalkhan minaret and the church belfry appear in one photograph')),
    row_year('1930', (
        'Մարտի 2. Թամանյանը գրում է, որ հուշարձանը պետք է պահպանել',
        '2 марта: Таманян пишет, что памятник надо сохранить',
        '2 March: Tamanyan writes that the monument must be saved')),
    row_year('1930–1931', (
        'Եկեղեցու քանդումը. խորանում գտնում են որմնանկարների վեց շերտ, քանդումը դադարեցվում է',
        'Снос церкви; в алтаре находят шесть слоёв росписи, разборку приостанавливают',
        'The church is torn down; six layers of paintings are found in the altar and the work is paused')),
    row_year('1931', (
        'Որմնանկարների մասին զեկուցում են Բեռլինում',
        'О фресках делают доклад в Берлине',
        'A report on the frescoes is given in Berlin')),
    row_year('1936', (
        'Դեկտեմբերի 12. եկեղեցու տեղում բացվում է «Մոսկվա» կինոթատրոնը',
        '12 декабря: на месте церкви открывают кинотеатр «Москва»',
        '12 December: the Moscow Cinema opens on the church’s site')),
    row_year('2010', (
        'Կառավարությունը որոշում է բացօթյա դահլիճի տարածքը տալ Էջմիածնին. բողոքի ակցիան հավաքում է մոտ 18 000 ստորագրություն, ծրագիրը չեղարկվում է',
        'Землю открытого зала решают отдать Эчмиадзину; протест собирает около 18 000 подписей, план отменяют',
        'The open-air hall’s land is to go to Etchmiadzin; a protest gathers about 18,000 signatures and the plan is dropped')),
])

# ---------------------------------------------------------------- главы history (пять)
CH = [
    (('Երևանի ամենահին եկեղեցին', 'Старейшая церковь Еревана', 'The oldest church of Yerevan'), None, (
        'Պողոս-Պետրոս եկեղեցին գտնվում էր Շահար հին թաղամասում՝ այժմյան Աբովյան և Թումանյան փողոցների անկյունում։ Կ. Ղաֆադարյանը այն համարել է հին Երևանի ամենահին և ամենամեծ եկեղեցին. հիմնադրումը վերագրվում է V–VI դարերին, թեև տարբեր աղբյուրներում նշվում են նաև V դարը և VI–VII դարերը։ Դա անգմբեթ բազիլիկ էր երկթեք տանիքով. XIX դարում քարե ծածկը պատել են թիթեղով։ Մուտքերը հարավից, արևմուտքից և հյուսիսից էին. հետագայում հյուսիսայինին կցել են կամարակապ նախասրահ, իսկ արևմտյանին՝ սյունազարդ ռոտոնդայով եռայարուս զանգակատուն, որը ոճով չէր համապատասխանում բազիլիկին։',
        'Церковь Погос-Петрос стояла в старом квартале Шаар, на углу нынешних улиц Абовяна и Туманяна. По оценке К. Гафадаряна, это была старейшая и крупнейшая церковь старого Еревана; основание относят к V–VI векам, хотя в разных источниках называют и V век, и VI–VII века. Это была бескупольная базилика с двускатной крышей: в XIX веке каменную кровлю перекрыли жестью. Входы были с юга, запада и севера; позже к северному пристроили арочный притвор, а к западному — трёхъярусную колокольню с ротондой на колоннах, по стилю не совсем подходившую к самой базилике.',
        'The church stood in the old Shahar quarter, at the corner of today’s Abovyan and Tumanyan streets. K. Ghafadaryan called it the oldest and largest church of old Yerevan; its founding is dated to the 5th–6th centuries, though some sources give the 5th century or the 6th–7th. It was a domeless basilica with a gable roof; in the 19th century its stone roof was covered with tin. There were entrances on the south, west and north; later an arched porch was added to the north one, and to the west one a three-tier belfry with a columned rotunda, in a style that did not quite match the basilica itself.'),
     'west-1927', '50% 20%'),
    (('Երկրաշարժը և նորոգումները', 'Землетрясение и ремонты', 'The earthquake and the repairs'), None, (
        '1679 թվականի երկրաշարժը ավերել է եկեղեցին, և XVII դարի վերջին այն վերակառուցել են պահպանված արևելյան մասի վրա. պատերում ագուցված խաչքարերին փորագրված են 1691 և 1692 թվականները։ Արձանագրությունները պատմում են 1778 և 1820 թվականների նորոգումների մասին. 1820-ին եկեղեցին նորոգել են ծխականների միջոցներով, ինչն այն ժամանակ հազվադեպ էր։ Երևանի պատմության թանգարանը հիշատակում է նաև 1811 և 1893 թվականների նորոգումները։ 1831-ին խորանի կողքին կառուցել են Սուրբ Ստեփանոս և Սուրբ Հովհաննես Մկրտիչ մատուռները, իսկ 1835-ին տեր Վարդանը Հին Բայազետի բերդից գնել է երկփեղկ երկաթե դուռ և նվիրել եկեղեցուն. այն հարավային բացվածքում կանգնել է առանց վերափոխման։',
        'Землетрясение 1679 года разрушило церковь, и в конце XVII века её отстроили заново на уцелевшей восточной части: на хачкарах в стенах высечены даты 1691 и 1692. Надписи рассказывают о ремонтах 1778 и 1820 годов; в 1820-м церковь чинили «на средства благословенного народа этой церкви» — то есть на деньги прихожан, что по тем временам было редкостью. Музей истории Еревана называет и другие ремонты — 1811 и 1893 годов. В 1831 году у алтаря построили два придела — Св. Степаноса и Иоанна Крестителя, а в 1835-м тер Вардан купил в крепости Старый Баязет двустворчатую железную дверь и подарил её церкви: она встала в южный проём без переделок.',
        'The 1679 earthquake ruined the church, and in the late 17th century it was rebuilt on the surviving east part; khachkars in the walls bear the dates 1691 and 1692. Inscriptions record repairs in 1778 and 1820; the 1820 work was paid for by the parishioners — “from the means of the blessed people of this church” — which was rare at the time. The History Museum of Yerevan also mentions repairs in 1811 and 1893. In 1831 two chapels, of St Stepanos and St John the Baptist, were built beside the altar, and in 1835 Ter Vardan bought a double iron door from the Old Bayazet fortress and gave it to the church; it fit the south doorway without alteration.'),
     'portal-1915', '50% 15%'),
    (('Քանդումից առաջ', 'Перед сносом', 'Before the demolition'), None, (
        'Եկեղեցու մոտ կար Զալխանի (Շահարի) մզկիթը. նրա մինարեթը և եկեղեցու զանգակատունը երևում են 1923 թվականի նույն լուսանկարում, որ արել է Իտալական աշխարհագրական ընկերության արշավախումբը։ 1920-ականների վերջին եկեղեցու շուրջը շինարարություն էր ընթանում՝ դա երևում է 1929 թվականի լուսանկարում։ 1930 թվականի մարտի 2-ին Ալեքսանդր Թամանյանը գրեց, որ հուշարձանը շատ կարևոր է և պետք է պահպանել. քանդմանը դեմ էր նաև Գ. Չիրիկովը։ Քանդելուց առաջ շենքը չափագրել և փաստագրել են։',
        'Рядом с церковью стояла мечеть Залхан (Шаарская): её минарет и колокольня церкви попали на один снимок 1923 года, сделанный экспедицией Итальянского географического общества. В конце 1920-х вокруг церкви шла стройка — она видна на снимке 1929 года. 2 марта 1930 года Александр Таманян написал, что памятник очень значим и его надо сохранить; против сноса выступал и Г. Чириков. Перед сносом здание обмерили и задокументировали.',
        'Next to the church stood the Zalkhan (Shahar) mosque: its minaret and the church belfry appear in one 1923 photograph taken by an expedition of the Italian Geographical Society. In the late 1920s there was construction around the church — it shows in a 1929 photograph. On 2 March 1930 Alexander Tamanyan wrote that the monument was very significant and had to be saved; G. Chirikov opposed the demolition too. Before it was torn down, the building was measured and documented.'),
     'yard-1929', '70% 50%'),
    (('Քանդումը և որմնանկարները', 'Снос и фрески', 'Demolition and the frescoes'), None, (
        'Եկեղեցին քանդվել է 1930–1931 թվականներին. այսպես է թվագրում Երևանի պատմության թանգարանը, իսկ այլ աղբյուրներում նշվում են 1930 թվականի նոյեմբերը կամ 1931-ը։ Խորանը քանդելիս հայտնաբերվել են տարբեր դարերի որմնանկարների վեց շերտ։ Քանդումը դադարեցրել են, հավաքել են հանձնաժողով, իսկ կիևցի վերականգնող Բ. Յուկինը պատերից հանել է 14,25 մ² որմնանկար։ Ստորին շերտը բուսական զարդանախշ է, մյուս շերտերում՝ Պետրոս և Պողոս առաքյալները։ 1931-ին այդ որմնանկարների մասին զեկուցել են Բեռլինում։ Այսօր դրանք պահվում են Հայաստանի ազգային պատկերասրահում և Հայաստանի պատմության թանգարանում, իսկ Երևանի պատմության թանգարանի տվյալներով՝ նաև այնտեղ։',
        'Церковь снесли в 1930–1931 годах — так датирует снос Музей истории Еревана; в других источниках называют ноябрь 1930 года или 1931 год. При разборке алтаря нашли шесть слоёв росписи разных веков. Снос приостановили и собрали комиссию, а киевский реставратор Б. Юкин снял со стен 14,25 м² фресок. Нижний слой — растительный орнамент, в других слоях — апостолы Пётр и Павел. О находке в 1931 году делали доклад в Берлине. Сегодня фрески хранятся в Национальной галерее и Историческом музее Армении, а по данным Музея истории Еревана — и в нём.',
        'The church was torn down in 1930–1931 — that is the History Museum of Yerevan’s dating; other sources give November 1930 or 1931. Dismantling the altar revealed six layers of paintings from different centuries. The demolition was paused and a commission was convened, and the Kyiv restorer B. Yukin removed 14.25 m² of frescoes from the walls. The lowest layer is a plant ornament; the other layers show the apostles Peter and Paul. In 1931 a report on the find was given in Berlin. Today the frescoes are kept in the National Gallery and the History Museum of Armenia — and, according to the History Museum of Yerevan, there too.'),
     'demolition-1930s', '50% 50%'),
    (('Եկեղեցու տեղում', 'На месте церкви', 'Where the church stood'), None, (
        'Եկեղեցու տեղում կառուցվել է «Մոսկվա» կինոթատրոնը՝ ճարտարապետներ Տ. Երկանյանի և Գ. Քոչարի նախագծով. այն բացվել է 1936 թվականի դեկտեմբերի 12-ին «Պեպո» ֆիլմով։ 2010 թվականին կառավարությունը որոշեց «Մոսկվա» կինոթատրոնի բացօթյա դահլիճի տարածքը տալ Էջմիածնին՝ հին եկեղեցու տեղում նորը կառուցելու համար։ «Փրկենք բացօթյա դահլիճը» բողոքի ակցիան հավաքեց մոտ 18 000 ստորագրություն, մշակույթի 60-ից ավելի գործիչներ նամակ ստորագրեցին, և ծրագիրը չեղարկվեց։',
        'На месте церкви построили кинотеатр «Москва» архитекторов Т. Ерканяна и Г. Кочара; его открыли 12 декабря 1936 года фильмом «Пэпо». В 2010 году правительство решило отдать землю открытого зала «Москвы» Эчмиадзину под новую церковь на месте старой. Протест «Спасём открытый зал» собрал около 18 000 подписей, письмо подписали более 60 деятелей культуры; план отменили.',
        'The Moscow Cinema, by the architects T. Yerkanyan and G. Kochar, was built on the church’s site; it opened on 12 December 1936 with the film “Pepo”. In 2010 the government decided to give the cinema’s open-air hall to Etchmiadzin for a new church on the site of the old one. The “Save the Open-Air Hall” protest gathered about 18,000 signatures and a letter from more than 60 cultural figures, and the plan was dropped.'),
     'cinema-1936', '50% 50%'),
]

SOURCES = [
    ('https://en.wikipedia.org/wiki/Saints_Peter_and_Paul_Church,_Yerevan', 'en.wikipedia.org', ' — «Saints Peter and Paul Church, Yerevan»'),
    ('https://hy.wikipedia.org/wiki/' + '%D5%8D%D5%B8%D6%82%D6%80%D5%A2_%D5%8A%D5%B8%D5%B2%D5%B8%D5%BD-%D5%8A%D5%A5%D5%BF%D6%80%D5%B8%D5%BD_%D5%A5%D5%AF%D5%A5%D5%B2%D5%A5%D6%81%D5%AB_(%D4%B5%D6%80%D6%87%D5%A1%D5%B6)', 'hy.wikipedia.org', ' — «Սուրբ Պողոս-Պետրոս եկեղեցի (Երևան)»'),
    ('https://ru.wikipedia.org/wiki/' + '%D0%A6%D0%B5%D1%80%D0%BA%D0%BE%D0%B2%D1%8C_%D0%A1%D0%B2%D1%8F%D1%82%D1%8B%D1%85_%D0%9F%D0%B0%D0%B2%D0%BB%D0%B0_%D0%B8_%D0%9F%D0%B5%D1%82%D1%80%D0%B0_(%D0%95%D1%80%D0%B5%D0%B2%D0%B0%D0%BD)', 'ru.wikipedia.org', ' — «Церковь Святых Павла и Петра (Ереван)»'),
    ('https://yhm.am/archives/634?lang=en', 'yhm.am', ' — Музей истории Еревана (Yerevan History Museum)'),
    ('https://en.wikipedia.org/wiki/Moscow_Cinema', 'en.wikipedia.org', ' — «Moscow Cinema»'),
    ('https://pastvu.com/p/1958878', 'pastvu.com', ' — архивные фото церкви (PastVu)'),
    ('https://commons.wikimedia.org/wiki/Category:Saints_Peter_and_Paul_Church,_Yerevan', 'commons.wikimedia.org', ' — Saints Peter and Paul Church, Yerevan'),
]


def history_chapters():
    secs = []
    for i, (title, _, texts, fig, pos) in enumerate(CH, 1):
        f = figure(fig, pos) + '\n' if fig else ''
        secs.append('  <section class="chapter reveal" id="ch%d">\n    <p class="ch-num">%s <span class="n">%02d</span></p>\n    <h2>\n      %s\n    </h2>\n%s    <div class="ch-text">\n'
                    '      <p class="i18n-block hy" lang="hy">%s</p>\n      <p class="i18n-block" lang="ru">%s</p>\n      <p class="i18n-block" lang="en">%s</p>\n    </div>\n  </section>\n'
                    % (i, inline('Գլուխ', 'Глава', 'Chapter'), i, inline(*title), f, *[html.escape(t, quote=False) for t in texts]))
    src = ''.join('      <li><a href="%s" target="_blank" rel="noopener">%s</a>%s</li>\n' % (u, n, d) for u, n, d in SOURCES)
    secs.append('  <section class="h-sources reveal">\n    <p class="hall">%s</p>\n    <h2>\n      %s\n    </h2>\n    %s\n    <ul class="h-src-list">\n%s'
                '      <li>К. Гафадарян, «Ереван. Средневековые памятники и надписи», 1975, с. 159–160 — надписи, по пересказу Википедии (сам текст не видели)</li>\n    </ul>\n  </section>\n'
                % (inline('Կատալոգ', 'Каталог', 'Catalogue'), inline('Աղբյուրներ', 'Источники', 'Sources'),
                   inline('Փաստերը վերապատմված են սեփական բառերով՝ առանց հոդվածների տեքստը կրկնօրինակելու։', 'Факты пересказаны своими словами, без копирования текста статей.', 'Facts are retold in original wording, without copying the text of the articles.', 'i18n-block'),
                   src))
    return '\n'.join(secs)


# ---------------------------------------------------------------- сборка страниц из страниц Ленина
H1 = ('Պողոս-Պետրոս եկեղեցի', 'Церковь Погос-Петрос', 'Poghos-Petros Church')
META = ('Շահար թաղամաս · Երևան · V–VI դդ. – 1930–1931', 'Квартал Шаар · Ереван · V–VI вв. — 1930–1931', 'Shahar quarter · Yerevan · 5th–6th c. – 1930–1931')
TAB = ('Շենքի մասին', 'О здании', 'About the building')


def common(t, hist):
    t = t.replace('Ցուցանմուշ № 002', 'Ցուցանմուշ № 003').replace('Экспонат № 002', 'Экспонат № 003').replace('Exhibit No. 002', 'Exhibit No. 003').replace('ՉԿԱ · 002', 'ՉԿԱ · 003')
    t = re.sub(r'<h1>.*?</h1>', lambda m: '<h1>%s</h1>' % inline(*H1), t, count=1, flags=re.S)
    t = re.sub(r'(<p class="meta">).*?(</p>)', lambda m: m.group(1) + inline(*META) + m.group(2), t, count=1, flags=re.S)
    t = re.sub(r'(<a href="about\.html"(?: aria-current="page")?>).*?(</a>)', lambda m: m.group(1) + inline(*TAB) + m.group(2), t, count=1, flags=re.S)
    return t


def about():
    t = (LEN / 'about.html').read_text(encoding='utf-8')
    t = common(t, False)
    t = re.sub(r'<title>.*?</title>', '<title>Церковь Погос-Петрос — архив | Չկա</title>', t, count=1)
    t = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="Церковь Погос-Петрос в старом Ереване (V–VI вв. — 1930–1931): архивные фото и хроника.">', t, count=1)
    a, z = t.index('<div class="gallery" id="gallery">\n') + len('<div class="gallery" id="gallery">\n'), t.index('\n    </div>\n    <p class="g-hint">')
    t = t[:a] + gallery_items(INFO) + t[z:]
    a, z = t.index('<ol class="timeline">\n') + len('<ol class="timeline">\n'), t.index('\n    </ol>')
    t = t[:a] + TIMELINE + t[z:]
    assert 'Ленин' not in t and 'Lenin' not in t and 'Լենին' not in t, 'остался Ленин'
    (OUT / 'about.html').write_text(t, encoding='utf-8')


def history():
    t = (LEN / 'history.html').read_text(encoding='utf-8')
    t = common(t, True)
    t = re.sub(r'<title>.*?</title>', '<title>История церкви Погос-Петрос | Չկա</title>', t, count=1)
    t = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="Церковь Погос-Петрос в старом Ереване: от основания в V–VI веках до сноса в 1930–1931 годах и кинотеатра «Москва». Пять глав.">', t, count=1)
    t = re.sub(r'(<h1>).*?(</h1>)', lambda m: m.group(1) + inline('Պողոս-Պետրոս եկեղեցու պատմությունը', 'История церкви Погос-Петрос', 'The Story of Poghos-Petros Church') + m.group(2), t, count=1, flags=re.S)
    t = re.sub(r'(<p class="h-sub">\s*).*?(\s*</p>)', lambda m: m.group(1) + inline('Ինչպես առաջացավ հին Երևանի ամենահին եկեղեցին, ինչպես այն քանդվեց և ինչ կա նրա տեղում։', 'Как возникла старейшая церковь старого Еревана, как её снесли и что стоит на её месте.',
                                                                              'How the oldest church of old Yerevan came to be, how it was torn down, and what stands in its place.', 'i18n-block') + m.group(2), t, count=1, flags=re.S)
    a, z = t.index('  <section class="chapter reveal" id="ch1">'), t.index('  <nav class="next-sec x-next reveal"')
    t = t[:a] + history_chapters() + '\n' + t[z:]
    t = t.replace(inline('Հուշարձանի մասին', 'О памятнике', 'About the monument'), inline(*TAB))
    assert 'Ленин' not in t and 'Lenin' not in t and 'Լենին' not in t, 'остался Ленин'
    (OUT / 'history.html').write_text(t, encoding='utf-8')


if __name__ == '__main__':
    INFO = prep_photos()
    prep_card()
    about()
    history()
    print('OK pages8', INFO)
