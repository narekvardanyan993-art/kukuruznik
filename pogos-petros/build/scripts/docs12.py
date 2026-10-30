#!/usr/bin/env python3
# Заход 12: урок, prompts.md, STATUS/PLAN/журнал chka-log.md, STATE.md. Из корня репо; повтор не дублирует.
import sys
from pathlib import Path
IDS = dict(a.split('=') for a in sys.argv[1:])   # storm=.. flash=.. leaves=.. rain=.. dog=.. dog1=.. dog2=.. old1=.. old2=.. old3=..
L = Path('lessons.md'); s = L.read_text()
lesson = ("- (pp-12, 30.10.2026) В Claude in Chrome может не быть file_upload — тогда вложение в Gemini: вкладка chka.am с кадром (картинка беты), "
          "CSS-рамкой показать нужную вырезку на весь экран (16:9, без чёрных полос), снимок вкладки в полном масштабе (computer screenshot scale 1 — "
          "upload_image берёт снимок в том масштабе, в каком он снят: scale 0,3 дал 10 КБ мусора) → upload_image в input, перехваченный через HTMLInputElement.click "
          "(+ → «Загрузить файлы» → find). Не нажимать Escape после «Загрузить файлы» — Gemini убирает input. Перед отправкой — снимок: вложение на месте "
          "(раз ушло без вложения — сразу ■). Ответ Gemini на вырезку совмещать ECC (аффинно, по контурам) — сдвиг 1–3 px. Pro ночью отвечает 3–13 мин или молча "
          "обрывается — ждать до 6 мин, потом ■ и новый чат; Flash — 1–2 мин. Позы — правками ответа в том же чате (Flash), совпадают лучше, чем новый чат.\n")
if '(pp-12, 30.10.2026)' not in s:
    L.write_text(s.rstrip('\n') + '\n' + lesson)

P = Path('pogos-petros/gemini/prompts.md'); s = P.read_text()
if '## Шаг 4, заход 12' not in s:
    s += f"""
## Шаг 4, заход 12 (30.10.2026) — гроза C, листья, дождь, собака B, старик (вложения — снимки вкладки chka.am, file_upload в этой сессии не было)
- C гроза (3.1 Pro, 9:16, чат a1de1438093a29b1; вложение — снимок вкладки с pogos_c.webp, кадр слева + чёрное поле): «… an edit of the drawing in the attached screenshot … output ONLY the drawing … Only change the weather: a heavy thunderstorm is coming … huge dark heavy storm clouds, slate-grey and deep blue-violet … dim grey-blue storm light … No lightning, no rain streaks» → {IDS.get('storm','p0g34y')} (ECC 0,86, масштаб 1,01).
- C вспышка (3.1 Pro, тот же чат, правка ответа): «… the very instant of a lightning strike. One jagged bright white-violet lightning bolt … the whole scene flooded with a brief cold blue-white flash light …» → {IDS.get('flash','9znfht')}.
- Листья (3.8 Flash, 16:9, без вложения): «a sprite sheet of 8 separate single autumn leaves … plane tree, mulberry, poplar and apricot … ochre yellow, golden, rust orange … Background: plain flat solid dark slate blue (#2B3A55)» → {IDS.get('leaves','qhmmve')} (cut6.py leaf).
- Дождь (3.8 Flash, 16:9): 1-я — ответ текстом «cannot generate … here is a prompt»; через 3 мин «Please try again: now draw the image itself … no text answer» → {IDS.get('rain','bra4cr')} (cut6.py rain, 8 струй).
- Собака B (3.1 Pro, 16:9; вложение — снимок вырезки B x110 y780 ширина 620): 1-я попытка — 13 мин «Creating your image» и пусто (■); 2-я (новый чат 47604470f09b4771, короче): «… Only add ONE small scruffy stray mongrel dog (short sandy-brown fur, lighter belly, floppy ears) lying asleep on the ground at the foot of the church wall … curled on its side, head resting on its front paws. Small - about as long as the small door is wide …» → {IDS.get('dog','datgg8')}.
- Собака позы (3.8 Flash, тот же чат, правки ответа): голова поднята (1-я — «encountering an error», через 15 мин «Please try again…») → {IDS.get('dog1','d2bpbb')}; виляет хвостом → {IDS.get('dog2','—')}.
- Старик (3.8 Flash, 16:9, новый чат на каждую позу; вложение — снимок вырезки A x140 y895 ширина 380): рука в кармане пальто → {IDS.get('old1','mpd4kx')}; горсть крошек в ладони у груди → {IDS.get('old2','slixn2')}; бросает — рука вытянута, крошки летят → {IDS.get('old3','bve1ek')}.
"""
    P.write_text(s)

C = Path('chka-log.md'); s = C.read_text()
old = "fix11_sheet.jpg ⬅ ТЕКУЩИЙ: шаг 4 ждёт iPhone;"
new = ("fix11_sheet.jpg; заход 12 сделан 30.10 (Gemini, e1.47): старик — 3 позы руки, собака на B (спит/голова/хвост, ночью спит), листья на ветру A/B/C, "
       "шоу C — гроза (тучи, 4 вспышки молнии, косой дождь, быстрый ручей), fix12_sheet.jpg ⬅ ТЕКУЩИЙ: шаг 4 ждёт iPhone;")
if old in s and 'заход 12 сделан' not in s: s = s.replace(old, new, 1)
lines = s.split('\n')
for i, l in enumerate(lines):
    if l.startswith('- Погос-Петрос — beta ('):
        lines[i] = ("- Погос-Петрос — beta (30.10.2026, заход 12: движок e1.47 в ветке — старик кормит голубей тремя позами руки (карман → крошки в ладони → бросает), "
                    "на B у стены собака (Gemini): спит ↔ подняла голову ↔ виляет хвостом, ночью спит; в порыв ветра листья (лист Gemini) срываются и летят по A/B/C; "
                    "шоу C — гроза вместо луны: грозовой рисунок Gemini, 4 вспышки молнии (рисунок-вспышка), косой дождь (струи Gemini), ручей бежит быстрее, потом проясняется. "
                    "До этого заход 11 — баги iPhone e1.45. Тексты — заглушки). Шаг 4 ждёт iPhone. Следующий шаг: Нарек — git push → python3 tools/publish_beta.py --expect-change → "
                    "iPhone https://chka.am/beta/tests/pogos-petros/?v=11; потом шаг 5 — тексты.")
s = '\n'.join(lines)
entry = f"""
## 2026-10-30 (Погос-Петрос, шаг 4/10, заход 12 — Gemini: старик, собака, листья, гроза C) — сделано
- Канал Gemini: file_upload в Claude in Chrome не было — вложения снимками вкладки chka.am (CSS-вырезка на весь экран), загрузки — кнопкой «Скачать» в просмотрщике (в gemini/in). 10 картинок: Pro 3 (гроза, вспышка, собака; 1 зависание 13 мин), Flash 7 (листья, дождь — 1 ответ текстом, собака ×2 — 1 ошибка, старик ×3). Промпты и id — gemini/prompts.md.
- Старик A: 3 позы (fix12.py man: ECC 0,95–0,96, ореол гасится как в fix11, цвет и альфа по отличию, фигура без дыр) → show_pose_a_old1..3.png, cycle 1,5–3 с, рамка шире (рука вытянута).
- Собака B: вставлена во все слои кадра B по области отличия (fix12.py dog), ночью — та же спящая собака в тон ночного рисунка; позы (Flash) → show_pose_b_dog*.png; ночью позы выключены (e1.46) — спит.
- Листья: frames[].leafFly (e1.47, details.js leafStep) — на начало порыва ветра (wx.gRise) 2–7 листьев Gemini срываются с кроны и из-за левого края, летят по ветру, кружатся (поворот + «переворот»), уходят за край; только днём, без снега, не в шоу.
- Шоу C (22 с): kind storm (шейдер: сцена в тон грозы, ручей ×2,6 по интегралу проявления) + грозовой рисунок поверх (image steady, hole — «окно» арыка, видно быстрый ручей) + 4 вспышки (рисунок-молния, 0,4–0,6 с) + косой дождь (flakes с angle, струи Gemini); луна и tod убраны.
- Проверки: building_schema pogos/lenin — 0 ошибок; test_build_pages — см. ниже. Снимки 390×844 (облако) → pogos-petros/frames/fix12_sheet.jpg.
- Слабые места: вложения — снимки экрана (не файл), Gemini видел кадр 1369×765 px вырезки; позы старика 1–2 тонкие (рука у пальто) — на телефоне смотреть; листья мелкие (≈ 15–20 css px).
- Следующий шаг: Нарек — git push → python3 tools/publish_beta.py --expect-change → iPhone https://chka.am/beta/tests/pogos-petros/?v=11; потом шаг 5 — тексты.
"""
if 'заход 12 — Gemini: старик' not in s: s = s.rstrip('\n') + '\n' + entry
C.write_text(s)

Path('STATE.md').write_text("""# chka.am — состояние (30.10.2026, после «Погос-Петрос, шаг 4, заход 12 — Gemini: старик, собака, листья, гроза»)

## Где мы
- Большая задача: Погос-Петрос (PLAN в chka-log.md). Шаг 4 — заход 12 сделан, ждёт iPhone. Движок e1.47 (ветка test/depth-photo).
- Правило: всё видимое рисует только Gemini, код двигает/режет/смешивает (lessons.md, первая строка).
- Заход 12 (рисунки Gemini):
  1. Старик (кадр 1) кормит голубей: рука в кармане → горсть крошек у груди → бросает, рука вытянута (смена 1,5–3 с).
  2. Кадр 2: у стены лежит дворняга — спит, поднимает голову, виляет хвостом; ночью спит.
  3. Ветер: в порыв листья срываются с деревьев (кадры 1–3), летят, кружатся, улетают за край. Только днём, без снега.
  4. Шоу кадра 3 — гроза вместо луны: тучи, вспышки молнии, косой дождь, ручей бежит быстрее, потом проясняется.
- Заход 11 (код): ночь без квадратов, позы в тон, ветер только в кроне, снегопад, холодная ночь 5–6, надпись D по буквам.
- Лист проверки: pogos-petros/frames/fix12_sheet.jpg. Тексты — заглушки (шаг 5).

## Что сделать Нареку
1. Терминал: cd ~/Documents/chka.am && git push
2. python3 tools/publish_beta.py --expect-change
3. iPhone: https://chka.am/beta/tests/pogos-petros/?v=11 — кадр 1 (старик, рука видна?), кадр 2 (собака у стены), кнопка ветра на 1–3 (листья), палочка на 3 (гроза).

## Открытые хвосты
- В этой сессии Claude in Chrome без file_upload: вложения в Gemini — снимками вкладки (не файл). Если файлом нужно — проверить расширение.
- Листья мелкие (≈ 15–20 css px) — если не видно, крупнее (leafFly.h).
- Надпись D ≈ 15 px букв; облачные тени плывут всегда (если «размазня» — выключить CLOUD_FIELD).
- Ленин e1.36 и редизайн 10а–10в — в ветке, ждут публикаций.
- .git: stale-*lock*, tmp_obj_* — git gc --prune=now.
- Удалить руками: pogos-petros/build/report/fix11/*.tgz, report/s7, s8/u1, report/s5, s6; Claude outputs/s45, s47, s48; show_insc_d_dark/lit.png, show_moon_1.png, show_bell_*.png (не используются).
""")
print('docs ok')
