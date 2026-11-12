# <Название> — запросы Gemini и Veo (prompts.md)

> Шаблон. Здесь лежит готовая очередь: исполнитель (советник в Chrome или агент) идёт сверху вниз и не думает.
> Почерк даёт блокнот «chka.am — рецепт детализации» (`_private/rules-v2/gemini-notebook.md`): в запросе остаются только здание, год, ракурс, свет, фото и две живые детали.
> Запросы — на английском. Вложения — файлы из `work/<slug>/ref/` по id из `sources.md`.

## Рецепт (не менять без строки в lessons.md)

1. **День** — новый рисунок: один кадр = один новый чат блокнота, 2–4 фото во вложении.
2. **Ночь, подложка, зима** — не новый рисунок, а **правка файла дня**: новый чат + точный файл `masters/<кадр>/day.png` во вложении (lessons §2: в длинном чате Gemini правит не ту картинку).
3. **Закат** красит станок из дня (решение Нарека 10.11). Запрос заката Gemini — запасной, только если на бете закат плох.
4. **Герой**: сначала он есть в дневном рисунке; состояния «дождь» и «снег» — Flash-правка квадратной вырезки вокруг героя; потом Veo из вырезки (первый кадр = последний = рисунок).
5. Скачивать только кнопкой «полный размер»; брать файл новее клика. Приёмка — `stanok intake`. Не прошёл — кадр не берём, кодом не подкрашиваем.

## Очередь по окнам (5–7 картинок Pro за окно на аккаунт; 3–4 ролика Veo)

| Окно | Аккаунт 1 | Аккаунт 2 |
|---|---|---|
| 1 | день: a, b, c, d, e | день: f; запас на переделку |
| — | **лист кадров Нареку (15 мин), его «ок» — до окна с героями** | |
| 2 | ночь: a–e | подложка: a–e |
| 3 | зима: все `wide` | вырезки героев ★: дождь, снег (Flash) |
| Veo | герой ★1: день, дождь, снег | герой ★2: день, дождь, снег; шоу |

> Порядок при нехватке лимита: оплаченная надпись → работы теста Т2 → это здание (ROADMAP §1). Что не успело — строка в журнал, не «потом вспомним».

## 1. День — по кадру

```
Generate an image.
<Building, what it is>, <city>, around <year>. <One sentence: what stood around>.
View: <where the camera stands, what direction it looks, eye level / from a balcony>. Vertical 9:16.
Composition: <top: calm sky 15–20 %; middle: …; bottom: …; left: …; right: …>.
Architecture: copy it exactly from the attached archive photos (<what to take from each photo>). Invent nothing; a part not visible in the photos stays plain.
Light: clear day, sun high and slightly from the <side>.
Living details: 1) <hero 1: who, where, what doing>; 2) <hero 2>. Both inside the middle 80 % of the width.
Not in the picture: <things younger than the epoch>. No text anywhere: signs are blank boards.
Paint to the very edges.
```
Вложения: Ф…, Ф… · Сохранить как `work/<slug>/masters/<кадр>/day.png`

> Хороший запрос: 8–12 строк, каждая — про то, чего нет в блокноте. Плохой: пересказ стиля («карандаш, акварель…» — это уже в блокноте), «красиво», «атмосферно», цифры этажей без фото.

## 2. Ночь — правка дня (новый чат, вложение: day.png этого кадра)

```
Generate an image. Edit the attached drawing: the same picture at night.
Keep everything identical — size, framing, every line and object in the same place. Change only the light.
Light sources of <year> only: <which windows glow, which lamps exist in THIS drawing>. Soft warm pools on the walls and ground under them.
No moon disc, no halo behind the building, no light where there is no lamp or window.
```

## 3. Подложка — правка дня (новый чат, вложение: day.png)

```
Generate an image. Edit the attached drawing: remove <the building> completely.
Fill its place with the plain continuation of the same sky and ground. Add no new building, tree, object or person. Everything else stays identical.
```

## 4. Зима — правка дня (новый чат, вложение: day.png)

```
Generate an image. Edit the attached drawing: the same picture in winter.
Fresh snow only where it would really settle: roofs, cornices, branches, the ground, the tops of objects. No falling snow. Everything else stays identical; people keep their places and get warm clothes of <year>.
```

## 5. Закат — ЗАПАСНОЙ (только по решению советника)

```
Generate an image. Edit the attached drawing: the same picture at sunset.
Keep everything identical. Low warm light from the <side>, long soft shadows, sky from warm orange at the horizon to violet above. No sun disc on or over buildings.
```

## 6. Герой: состояния (Flash, квадратная вырезка 1:1 вокруг героя, без увеличения)

```
Generate an image. Edit the attached crop: <rain state: what exactly changes — hood up, cloth over the goods>.
Change only <the named thing>. Face, clothes, background and everything else stay identical.
```

## 7. Veo — герой (вход: вырезка из рисунка; по ролику на состояние)

```
Animate this drawing. One continuous shot, no cuts, the camera does not move.
<Who> <does what, small natural motion>. <X stays on the left, Y on the right the whole clip.>
The first and the last frame are exactly this drawing. Nothing else moves or changes. Hand-drawn pencil and watercolor look stays.
```

## 8. Veo — шоу «до и после» (вход: весь кадр 9:16)

```
Animate this drawing. One continuous shot, no cuts, the camera does not move.
<What happens to the building, step by step, slowly>. The scene grows darker before <the main moment>.
Sky, ground and neighbours stay as they are. Hand-drawn pencil and watercolor look stays.
```
> Продолжение — из последнего кадра прошлого ролика. Слова «fountain» на пустой площади не писать (lessons §4).
