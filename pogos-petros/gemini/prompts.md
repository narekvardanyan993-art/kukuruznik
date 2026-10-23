# Погос-Петрос — рисунки кадров (Gemini, pro.gemini.one1)

Режим: Gemini → «Создание изображений», модель Pro, соотношение 9:16. Вложения: 1) стиль tests/lenin/frames/lenin_1 (jpg), 2–4) фото из sources/.
Результат Gemini: A_v1 — 1536×2752, B_v1 и A_v2 — 768×1376. Кадр = ресайз до 768×1376 и обрезка 11 px сверху → 768×1365 (`*_src.png` — исходник).

## A_v1 (24.10.2026) — refs: style_lenin, pv1958878, c_1930s_tall, pv1389644
Фронт с запада, звонница на всю высоту. Архитектура близко к фото; цвет бледнее Ленина (небо почти белое).
Промпт: «Vertical 9:16 illustration. STYLE: copy image 1 exactly — architectural pencil sketch with fine ink outlines, diagonal hatching in shadows, light transparent watercolor washes, warm cream paper texture… SUBJECT: … Surb Poghos-Petros … late 1920s, as in photos 2, 3 and 4. Reproduce its architecture EXACTLY from the photos, invent nothing: plain west gable end of a long domeless stone basilica …; square stone bell tower over the arched west entrance … open round belfry of slender columns with a pointed conical roof and a small cross … VIEW: from the street, low eye level, slightly from below … bell tower fills almost the whole height … empty sky band above the cross (~15%) … No people, no cars, no text …»

## B_v1 (24.10.2026) — refs: style_lenin, pv417372, pv1353860, pv1465889
3/4 длинного бока, звонница + малый барабан, двор, закат справа. Тот же промпт-каркас, VIEW: «three-quarter view of the long side wall and the end with the bell tower, from the courtyard, eye level … fills the full width and the lower two thirds; sky band ~20% … Golden sunset light from the right … No construction».

## A_v2 (24.10.2026) — refs: style_lenin, B_v1 (как эталон цвета), pv1958878, pv1389644
Тот же вид, что A, но цвет как у B/Ленина («saturated soft blue sky fading to warm cream … warm honey-brown stone … Image 2 is the same church from another side in the target style»). Здание чуть мельче, ракурс 3/4 с запада.

## Как файлы попадают в репозиторий (Загрузки агенту недоступны)
Картинка берётся со страницы Gemini (fetch ссылки gg-dl → blob), рисуется ×2 на холст поверх страницы кусками 1300×700, каждый кусок — снимок экрана Claude in Chrome (JPEG), склейка + цветовая калибровка (снимок экрана идёт через цветовой профиль дисплея: без поправки средние тона темнее на ~8) → уменьшение ×2. Проверка — средние цвета 12×22 клеток против посчитанных на странице: расхождение ≤ 2,5 уровня. Скрипты и матрица калибровки — transfer/.
