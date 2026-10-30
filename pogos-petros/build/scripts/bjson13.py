#!/usr/bin/env python3
"""Заход 13 (e1.48): building.json Погос-Петроса — цвет как в рисунках Gemini (look.noon мягче: без «подъёма» теней и без
обесцвечивания), ветер без качания крон (tuning.NO_SWAY, sway у кадров убран; листья leafFly остаются), погода как у Кукурузника
(tuning.WX_PARTICLES — частицы дождя/снега кодом; спрайты-снежинки snowFall/spriteSnow убраны; дождь без тумана и почти без затемнения),
E без погоды, D без снега на полу (frames[].wx), инфо-точки 2–3 на кадр (факты из pogos-petros/sources/sources.md, ссылки —
sources/hotspots.md; hy/en — [заглушка] до шага 5). Повторный запуск даёт тот же файл."""
import json
from pathlib import Path
P = Path('tests/pogos-petros/building.json')
b = json.loads(P.read_text(encoding='utf-8'))

b['look']['noon'] = {'wb': [0.97, 1.0, 1.03], 'sat': 1.0, 'lift': 0.0, 'bright': 1.04, 'sky': 0.9}
t = b['tuning']
t['NO_SWAY'] = True
t['SWAY_SOFT'] = False
t['WX_PARTICLES'] = True
t['RAIN_DROPS'] = 380   # движок 240 — дождь гуще, чтобы был хорошо виден
t['WEATHER'] = {'rain': [0.35, 0, 0.45, 0], 'snow': [0.35, 0, 0, 1]}
t.setdefault('LOOK', {})['weather'] = {'overcastGray': 0.2, 'overcastDim': 0.08, 'overcastShadow': 0.12, 'wetDim': 0.07,
                                       'rainDay': [46, 56, 80, 0.72], 'rainNight': [190, 200, 222, 0.6]}

H = lambda s: '[заглушка] ' + s
HY = '[заглушка] Տեքստը՝ 5-րդ քայլում։'
F = {
    'church':     ('Старейшая и крупнейшая церковь старого Еревана; основана в V–VI вв. (Википедия, Музей истории Еревана)',
                   'The oldest and largest church of old Yerevan, founded in the 5th–6th c.'),
    'belfry':     ('Трёхъярусную колокольню с ротондой на колоннах пристроили к западному входу позже — «не в стиле» самой базилики (Википедия, Музей истории Еревана)',
                   'The three-tier belfry with a columned rotunda was added to the west entrance later, unlike the basilica itself.'),
    'roof':       ('Бескупольная базилика с двускатной крышей; в XIX в. каменную кровлю перекрыли жестью (Википедия)',
                   'A domeless basilica with a gable roof; in the 19th c. the stone roof was covered with tin.'),
    'rebuilt':    ('Землетрясение 1679 г. разрушило церковь; её отстроили на уцелевшей восточной части — на хачкарах в стенах даты 1691 и 1692 (Википедия)',
                   'The 1679 earthquake ruined the church; it was rebuilt on the surviving east part — khachkars in the walls are dated 1691 and 1692.'),
    'repairs':    ('Надписи о ремонтах 1778 и 1820 гг.; в 1820-м — «на средства благословенного народа этой церкви», на деньги прихожан (Википедия)',
                   'Inscriptions record repairs in 1778 and 1820 — the latter paid for by the parishioners.'),
    'doors':      ('Входы — с юга, запада и севера; у северного, со стороны нынешней Абовяна, позже пристроили арочный притвор (Википедия, Музей истории Еревана)',
                   'Entrances faced south, west and north; an arched porch was later added to the north one.'),
    'shahar':     ('Церковь стояла в старом квартале Шаар, на углу нынешних улиц Абовяна и Туманяна (Википедия, Музей истории Еревана)',
                   'The church stood in the old Shahar quarter, at the corner of today’s Abovyan and Tumanyan streets.'),
    'mosque':     ('Рядом стояла мечеть Залхан (Шаарская): её минарет и колокольня церкви — на одном снимке 1923 г. (pastvu 1445782)',
                   'The Zalkhan (Shahar) mosque stood nearby: its minaret and the belfry appear in one 1923 photo.'),
    'door_bayazet': ('Двустворчатая железная южная дверь — из крепости Старый Баязет: в 1835 г. её купил и подарил церкви тер Вардан. Сейчас она в Музее истории Еревана (Википедия, Музей истории Еревана)',
                   'The double iron south door came from the Old Bayazet fortress, bought and donated by Ter Vardan in 1835; it is now in the History Museum of Yerevan.'),
    'chapels':    ('У алтаря — два придела, Св. Степаноса и Иоанна Крестителя, оба построены в 1831 г. (Музей истории Еревана)',
                   'Two side chapels by the altar — St. Stepanos and St. John the Baptist — both built in 1831.'),
    'frescoes':   ('При разборке алтаря нашли шесть слоёв росписи разных веков; снос приостановили, реставратор Б. Юкин снял 14,25 м² фресок (Музей истории Еревана)',
                   'Dismantling the altar revealed six layers of murals; demolition was paused and restorer B. Yukin removed 14.25 m² of frescoes.'),
    'frescoes_now': ('Нижний слой — растительный орнамент, выше — апостолы Пётр и Павел. Фрески — в Национальной галерее и Историческом музее Армении (Википедия, Музей истории Еревана)',
                   'The lowest layer is a plant ornament, above it the apostles Peter and Paul. The frescoes are in the National Gallery and History Museum of Armenia.'),
    'cinema':     ('На месте церкви — кинотеатр «Москва» (арх. Т. Ерканян и Г. Кочар), открыт 12 декабря 1936 г. фильмом «Пэпо» (Википедия)',
                   'The Moscow Cinema (architects T. Yerkanyan and G. Kochar) stands on the site; it opened on 12 December 1936 with the film “Pepo”.'),
    'tamanyan':   ('Против сноса выступал Александр Таманян (письмо 2 марта 1930 г.: «памятник очень значим, его надо сохранить»); перед сносом здание обмерили (Музей истории Еревана)',
                   'Alexander Tamanyan opposed the demolition (letter of 2 March 1930); the building was measured and documented before it was torn down.'),
    'open_hall':  ('В 2010 г. землю открытого зала «Москвы» решили отдать под новую церковь на месте старой; после протеста (~18 000 подписей) план отменили (Википедия)',
                   'In 2010 the cinema’s open-air hall was to be given for a new church on the old site; after a protest (~18,000 signatures) the plan was dropped.'),
}
b['facts'] = {k: {'hy': HY, 'ru': ru, 'en': H(en)} for k, (ru, en) in F.items()}
b['aboutFacts'] = ['church', 'cinema']

HS = {   # u, v — доли кадра 768×1365; на телефоне видно u ≈ 0,1–0,9; у стрелок (край, v ≈ 0,5) не ставить
    'pogos_a': [('belfry', 'building', 0.62, 0.34), ('church', 'building', 0.645, 0.66), ('roof', 'building', 0.30, 0.56)],
    'pogos_b': [('rebuilt', 'building', 0.55, 0.60), ('repairs', 'building', 0.70, 0.41), ('doors', 'building', 0.33, 0.69)],
    'pogos_c': [('mosque', 'bg', 0.36, 0.60), ('belfry', 'building', 0.75, 0.34), ('shahar', 'bg', 0.55, 0.80)],
    'pogos_d': [('door_bayazet', 'building', 0.36, 0.60), ('rebuilt', 'building', 0.80, 0.63), ('repairs', 'building', 0.38, 0.41)],
    'pogos_e': [('chapels', 'building', 0.50, 0.46), ('frescoes', 'building', 0.50, 0.27), ('frescoes_now', 'building', 0.17, 0.60)],
    'pogos_f': [('cinema', 'building', 0.50, 0.48), ('tamanyan', 'building', 0.25, 0.40), ('open_hall', 'bg', 0.78, 0.74)],
}
for f in b['frames']:
    f['hotspots'] = [{'key': k, 'layer': l, 'u': u, 'v': v} for k, l, u, v in HS[f['name']]]
    f.pop('sway', None); f.pop('snowFall', None); f.pop('spriteSnow', None)
    f.pop('wx', None)
    if f['name'] == 'pogos_e':
        f['wx'] = {'k': [0, 0, 0, 0], 'particles': False, 'note': 'интерьер: ни дождя, ни снега'}
    if f['name'] == 'pogos_d':
        f['wx'] = {'k': [1, 1, 1, 0], 'particles': True, 'note': 'снег уже нарисован зимой: на полу без «пыли» формулы, только падающие снежинки'}
P.write_text(json.dumps(b, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('ok', sum(len(f['hotspots']) for f in b['frames']), 'точек')
