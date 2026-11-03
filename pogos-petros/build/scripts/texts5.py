#!/usr/bin/env python3
"""Шаг 5/10 Погос-Петроса: все тексты ru/hy/en в tests/pogos-petros/building.json.
Только факты из pogos-petros/sources/sources.md (номера фактов и ссылки — sources/texts.md).
Инфо-точки: «Заголовок. 1–3 предложения» одной строкой (движок показывает текст точки одной строкой).
Повторный запуск даёт тот же файл."""
import json
from pathlib import Path

P = Path(__file__).resolve().parents[3] / 'tests/pogos-petros/building.json'
b = json.loads(P.read_text(encoding='utf-8'))

def T(hy, ru, en):
    return {'hy': hy, 'ru': ru, 'en': en}

FACTS = {
  'church': T(
    'Պողոս-Պետրոս եկեղեցի։ Հին Երևանի ամենահին և ամենամեծ եկեղեցին։ Հիմնադրվել է V–VI դարերում։',
    'Церковь Погос-Петрос. Старейшая и крупнейшая церковь старого Еревана. Основана в V–VI вв.',
    'Poghos-Petros Church. The oldest and largest church of old Yerevan, founded in the 5th–6th centuries.'),
  'belfry': T(
    'Զանգակատուն։ Սյունազարդ ռոտոնդայով եռայարուս զանգակատունը արևմտյան մուտքին կցվել է ավելի ուշ և ոճով չի համապատասխանում բազիլիկին։',
    'Колокольня. Трёхъярусную колокольню с ротондой на колоннах пристроили к западному входу позже — она «не в стиле» самой базилики.',
    'Belfry. The three-tier belfry with a columned rotunda was added to the west entrance later, in a different style from the basilica.'),
  'roof': T(
    'Տանիք։ Անգմբեթ բազիլիկ՝ երկթեք տանիքով։ XIX դարում քարե ծածկը պատել են թիթեղով։',
    'Крыша. Бескупольная базилика с двускатной крышей. В XIX в. каменную кровлю перекрыли жестью.',
    'Roof. A domeless basilica with a gable roof. In the 19th century its stone roof was covered with tin.'),
  'rebuilt': T(
    'Վերակառուցում։ 1679 թվականի երկրաշարժը ավերել է եկեղեցին, և այն վերակառուցել են պահպանված արևելյան մասի վրա։ Պատերում ագուցված խաչքարերին փորագրված են 1691 և 1692 թվականները։',
    'Отстроена заново. Землетрясение 1679 г. разрушило церковь, её подняли на уцелевшей восточной части. На хачкарах в стенах — даты 1691 и 1692.',
    'Rebuilt. The 1679 earthquake ruined the church; it was rebuilt on the surviving east part. Khachkars in the walls bear the dates 1691 and 1692.'),
  'repairs': T(
    'Նորոգումներ։ Արձանագրությունները պատմում են 1778 և 1820 թվականների նորոգումների մասին։ 1820-ին եկեղեցին նորոգել են ծխականների միջոցներով, ինչն այն ժամանակ հազվադեպ էր։',
    'Ремонты. Надписи рассказывают о ремонтах 1778 и 1820 гг. В 1820-м церковь чинили «на средства благословенного народа этой церкви» — на деньги прихожан, что тогда было редкостью.',
    'Repairs. Inscriptions record repairs in 1778 and 1820. The 1820 work was paid for by the parishioners, which was rare at the time.'),
  'doors': T(
    'Երեք մուտք։ Եկեղեցին մուտքեր ուներ հարավից, արևմուտքից և հյուսիսից։ Հյուսիսային մուտքին՝ այժմյան Աբովյան փողոցի կողմից, հետագայում կցել են կամարակապ նախասրահ։',
    'Три входа. Входы были с юга, запада и севера. К северному, со стороны нынешней улицы Абовяна, позже пристроили арочный притвор.',
    'Three entrances. The church had doors on the south, west and north. An arched porch was later added to the north one, facing today’s Abovyan Street.'),
  'shahar': T(
    'Շահար թաղամաս։ Եկեղեցին գտնվում էր հին Շահար թաղամասում՝ այժմյան Աբովյան և Թումանյան փողոցների անկյունում։',
    'Квартал Шаар. Церковь стояла в старом квартале Шаар — на углу нынешних улиц Абовяна и Туманяна.',
    'Shahar quarter. The church stood in the old Shahar quarter, at the corner of today’s Abovyan and Tumanyan streets.'),
  'mosque': T(
    'Զալխանի մզկիթ։ Մոտակայքում էր Շահարի Զալխան մզկիթը։ Նրա մինարեթը և եկեղեցու զանգակատունը երևում են 1923 թվականի նույն լուսանկարում։',
    'Мечеть Залхан. Рядом стояла Шаарская мечеть Залхан. Её минарет и колокольня церкви попали на один снимок 1923 г.',
    'Zalkhan Mosque. The Zalkhan (Shahar) mosque stood nearby. Its minaret and the church belfry appear in the same 1923 photo.'),
  'door_bayazet': T(
    'Բայազետի դուռը։ Երկփեղկ երկաթե հարավային դուռը բերվել է Հին Բայազետի բերդից։ 1835-ին այն գնել և եկեղեցուն է նվիրել տեր Վարդանը։ Այժմ դուռը Երևանի պատմության թանգարանում է։',
    'Дверь из Баязета. Двустворчатая железная южная дверь — из крепости Старый Баязет: в 1835 г. её купил и подарил церкви тер Вардан. Сейчас она в Музее истории Еревана.',
    'Door from Bayazet. The double iron south door came from the Old Bayazet fortress: Ter Vardan bought it and gave it to the church in 1835. It is now in the History Museum of Yerevan.'),
  'chapels': T(
    'Երկու մատուռ։ Խորանի կողքին Սուրբ Ստեփանոս և Սուրբ Հովհաննես Մկրտիչ մատուռներն էին՝ երկուսն էլ կառուցված 1831-ին։',
    'Два придела. У алтаря — приделы Св. Степаноса и Иоанна Крестителя. Оба построены в 1831 г.',
    'Two chapels. Beside the altar were the chapels of St Stepanos and St John the Baptist, both built in 1831.'),
  'frescoes': T(
    'Որմնանկարների վեց շերտ։ Խորանը քանդելիս հայտնաբերվել են տարբեր դարերի որմնանկարների վեց շերտ։ Քանդումը դադարեցվել է, և կիևցի վերականգնող Բ. Յուկինը պատից հանել է 14,25 մ² որմնանկար։',
    'Шесть слоёв росписи. При разборке алтаря нашли шесть слоёв росписи разных веков. Снос приостановили, и киевский реставратор Б. Юкин снял 14,25 м² фресок.',
    'Six layers of murals. Dismantling the altar revealed six layers of paintings from different centuries. Demolition was paused, and the Kyiv restorer B. Yukin removed 14.25 m² of frescoes.'),
  'frescoes_now': T(
    'Որմնանկարներն այսօր։ Ստորին շերտը բուսական զարդանախշ է, մյուս շերտերում՝ Պետրոս և Պողոս առաքյալները։ Որմնանկարները պահվում են Հայաստանի ազգային պատկերասրահում և Հայաստանի պատմության թանգարանում, իսկ Երևանի պատմության թանգարանի տվյալներով՝ նաև այնտեղ։',
    'Фрески сегодня. Нижний слой — растительный орнамент, в других слоях — апостолы Пётр и Павел. Фрески хранятся в Национальной галерее и Историческом музее Армении, а по данным Музея истории Еревана — и в нём.',
    'The frescoes today. The lowest layer is a plant ornament; other layers show the apostles Peter and Paul. The frescoes are kept in the National Gallery and the History Museum of Armenia — and, according to the History Museum of Yerevan, there too.'),
  'cinema': T(
    '«Մոսկվա» կինոթատրոն։ Եկեղեցու տեղում «Մոսկվա» կինոթատրոնն է՝ ճարտարապետներ Տ. Երկանյանի և Գ. Քոչարի նախագծով։ Այն բացվել է 1936 թվականի դեկտեմբերի 12-ին «Պեպո» ֆիլմով։',
    'Кинотеатр «Москва». На месте церкви — кинотеатр «Москва» архитекторов Т. Ерканяна и Г. Кочара. Его открыли 12 декабря 1936 г. фильмом «Пэпо».',
    'Moscow Cinema. The Moscow Cinema by the architects T. Yerkanyan and G. Kochar stands on the church’s site. It opened on 12 December 1936 with the film “Pepo”.'),
  'tamanyan': T(
    'Թամանյանը՝ քանդման դեմ։ 1930 թվականի մարտի 2-ին Ալեքսանդր Թամանյանը գրել է, որ հուշարձանը շատ կարևոր է և պետք է պահպանել։ Քանդմանը դեմ էր նաև Գ. Չիրիկովը։ Քանդելուց առաջ շենքը չափագրել և փաստագրել են։',
    'Таманян против сноса. 2 марта 1930 г. Александр Таманян написал: «памятник очень значим, его надо сохранить». Против был и Г. Чириков. Перед сносом здание обмерили и задокументировали.',
    'Tamanyan against demolition. On 2 March 1930 Alexander Tamanyan wrote that the monument was very significant and had to be saved. G. Chirikov opposed it too. Before demolition the building was measured and documented.'),
  'open_hall': T(
    'Բացօթյա դահլիճ։ 2010-ին կառավարությունը որոշեց «Մոսկվա» կինոթատրոնի բացօթյա դահլիճի տարածքը տալ Էջմիածնին՝ հին եկեղեցու տեղում նորը կառուցելու համար։ Բողոքի ակցիան հավաքեց մոտ 18 000 ստորագրություն, և ծրագիրը չեղարկվեց։',
    'Открытый зал. В 2010 г. землю открытого зала «Москвы» решили отдать Эчмиадзину под новую церковь на месте старой. Протест «Спасём открытый зал» собрал около 18 000 подписей, и план отменили.',
    'Open-air hall. In 2010 the government decided to give the cinema’s open-air hall to Etchmiadzin for a new church on the old site. The “Save the Open-Air Hall” protest gathered about 18,000 signatures, and the plan was dropped.'),
  # для справки «о здании» (aboutFacts), без точки на кадре
  'demolished': T(
    'Քանդումը։ Եկեղեցին քանդվել է 1930–1931 թվականներին, իսկ 1936-ին նրա տեղում բացվել է «Մոսկվա» կինոթատրոնը։',
    'Снос. Церковь снесли в 1930–1931 гг., а в 1936 г. на её месте открыли кинотеатр «Москва».',
    'Demolition. The church was torn down in 1930–1931; in 1936 the Moscow Cinema opened on its site.'),
}

CAPTIONS = [   # подписи кадров A–F: эпоха (по датам снимков-основ) · что видим
  T('1920-ականների վերջ · արևմտյան մուտքը և եռայարուս զանգակատունը',
    'Конец 1920-х · западный вход и трёхъярусная колокольня',
    'Late 1920s · the west entrance and the three-tier belfry'),
  T('Մոտ 1929 · եկեղեցու երկար ճակատը և բակը',
    'Около 1929 · длинный фасад церкви и двор',
    'Around 1929 · the long side of the church and the yard'),
  T('1923 · Շահար թաղամասի փողոցը, հեռվում՝ Զալխանի մզկիթի մինարեթը',
    '1923 · улица квартала Шаар, вдали — минарет мечети Залхан',
    '1923 · a street in the Shahar quarter, the Zalkhan minaret in the distance'),
  T('1915 · քանդակազարդ շքամուտքը և դուռը ձմռանը',
    '1915 · резной портал и дверь зимой',
    '1915 · the carved portal and door in winter'),
  T('1915–1927 · խորանը, սպիտակ քարե ամպհովանին և որմնանկարները',
    '1915–1927 · алтарь, белокаменная сень и фрески',
    '1915–1927 · the altar, the white-stone canopy and the frescoes'),
  T('Այսօր · եկեղեցու տեղում «Մոսկվա» կինոթատրոնն է',
    'Сегодня · на месте церкви — кинотеатр «Москва»',
    'Today · the Moscow Cinema stands where the church was'),
]
SHOW_E = T('Եկեղեցու որմնանկարները հանվել են քանդման ժամանակ, և այժմ դրանք Երևանի թանգարաններում են',
           'Фрески церкви сняли во время сноса — теперь они в музеях Еревана',
           'The church’s frescoes were removed during the demolition and are now in Yerevan museums')

b['facts'] = FACTS
b['aboutFacts'] = ['church', 'rebuilt', 'demolished']
b['meta']['description'] = T(
    'Սուրբ Պողոս-Պետրոս եկեղեցին (V–VI դդ. – 1930–1931) Երևանի հին Շահար թաղամասում՝ վերակենդանացած գծանկարով։ Թեքեք նկարը, փոխեք օրվա ժամը և թերթեք կադրերը։',
    'Церковь Погос-Петрос (V–VI вв. — 1930–1931) в старом ереванском квартале Шаар — ожившим рисунком. Наклоняйте картинку, меняйте время суток, листайте кадры.',
    'Poghos-Petros Church (5th–6th c. – 1930–1931) in old Yerevan’s Shahar quarter, brought back as a living drawing. Tilt the picture, change the time of day, flip through the frames.')
b['text']['plaque'] = T(
    'Սուրբ Պողոս-Պետրոս եկեղեցի (V–VI դդ. – 1930–1931) · Շահար թաղամաս, Երևան · գեղարվեստական վերակառուցում արխիվային լուսանկարներից',
    'Церковь Погос-Петрос (V–VI вв. — 1930–1931) · квартал Шаар, Ереван · художественная реконструкция по архивным фото',
    'Poghos-Petros Church (5th–6th c. – 1930–1931) · Shahar quarter, Yerevan · artistic reconstruction after archive photos')
pc = b['postcard']
pc['years'] = T('V–VI դդ. – 1930–1931', 'V–VI вв. – 1930–1931', '5th–6th c. – 1930–1931')
pc['fact'] = T(
    'Հին Երևանի ամենահին և ամենամեծ եկեղեցին, հիմնադրված V–VI դարերում։ Այն քանդվեց 1930–1931-ին, և ներսում գտան որմնանկարների վեց շերտ։ Այժմ նրա տեղում «Մոսկվա» կինոթատրոնն է։',
    'Старейшая и крупнейшая церковь старого Еревана, основана в V–VI вв. Её снесли в 1930–1931 гг., внутри нашли шесть слоёв фресок. Сейчас на этом месте — кинотеатр «Москва».',
    'The oldest and largest church of old Yerevan, founded in the 5th–6th centuries. It was torn down in 1930–1931; six layers of frescoes were found inside. The Moscow Cinema stands there now.')

for f, cap in zip(b['frames'], CAPTIONS):
    f['caption'] = cap
b['frames'][4]['showCaption'] = SHOW_E

# порядок ключей кадра: caption / showCaption сразу после name
for i, f in enumerate(b['frames']):
    keys = ['name', 'caption'] + (['showCaption'] if 'showCaption' in f else [])
    b['frames'][i] = {**{k: f[k] for k in keys}, **{k: v for k, v in f.items() if k not in keys}}

P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
bad = [l for l in P.read_text(encoding='utf-8').splitlines() if 'заглушк' in l]
print('заглушек осталось:', len(bad))
for l, v in pc['fact'].items():
    print('postcard.fact', l, len(v))
for l, v in pc['years'].items():
    print('postcard.years', l, len(v))
