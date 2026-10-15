# s24 — как выпустить Ленина и движок e1.26 на живой сайт (по коду tools/, 16.10.2026)

Проверено в копии main (git archive origin/main + build_pages из ветки), ничего не публиковалось.

## Что на сайте сейчас
- Живой движок e1.4, живой Ленин (lenin/) — старая сборка: кадры без `_night`, `_sway`, `_snow`, старый конфиг.
- Бета (beta/engine, beta/tests/lenin) — e1.26 + s23.

## Что работает уже сейчас (бета)
1. `cd ~/Documents/chka.am && git push` (после коммита s24).
2. `python3 tools/publish_beta.py --expect-change` — пиксели снимаются у 6 целей: beta/kukuruznik, beta/tests/lenin (+about, +history), beta/tests/test-1, beta/tests/test-2. Меняются только 7 файлов беты (страницы + manifest): в них чистые тексты Ленина и адреса кадров со ?v=<хэш>. ~25–35 мин.
   Без `--expect-change` проверка красная на паре beta/kukuruznik ⇄ kukuruznik (99/99, прогон 15.10) — пока движок беты ≠ живому.
3. iPhone: https://chka.am/beta/tests/lenin/?v=28 (закрыть вкладку, открыть заново).

## Что НЕ работает (блокер)
Выпустить «новый движок + уже живое здание с новыми кадрами» текущими скриптами нельзя — обе ветки останавливаются:
- `publish_engine.py` (сначала движок): build_live собирает и живой Ленин, проверка настроек не находит на сайте `lenin/frames/*_night.webp`, `*_sway.png` → «СБОРКА ОСТАНОВЛЕНА: ошибки в настройках зданий (10)».
- `publish_building.py lenin` (сначала здание): build_live → «движок на сайте (engine/, e1.4) не совпадает с исходником engine/ (e1.26)».
Для НОВОГО здания порядок «publish_beta → publish_engine → publish_building» работает (движок уже стоит, когда здание идёт). У Ленина живая копия уже есть, поэтому замкнуто.

## Что нужно (правка скриптов — мне запрещена в этом заходе)
Флаг `publish_engine.py --with-building lenin` (одним коммитом): после build_beta — `bp.place_live_files(tmp, slug)` (кадры, about, history, gallery, og, card) до `bp.build_live(...)`; в `allowed_paths` — `<slug>/`, index.html (карточка главной), 404.html; `hub_with_card` как в publish_building; в режиме --expect-change страницы <slug>/ входят в exempt (пиксели снимаются), остальные — побайтно как на main. Плюс тест в test_build_pages. Объём ~40 строк. После этого:
4. `python3 tools/publish_engine.py --expect-change --with-building lenin --dry-run` — «живое == проверенная бета», шапка прежняя, зелёная check_site — ~35 мин.
5. тот же без `--dry-run` — коммит в main + пуш, ~35 мин (check_site второй раз).
6. iPhone: https://chka.am/lenin/?v=28 и главная (карточка Ленина), https://chka.am/kukuruznik/ (новые кнопки телефона e1.9 — известное отличие).
Откат — `git revert <коммит>` во временном worktree (печатает скрипт).

## Что не сделано в s24 и почему
- Видео (motionVideo.clips[].src) без ?v=: движок меняет .mp4 → .webm регуляркой по концу строки; ?v= сломал бы запасной VP9 (облачный/Playwright Chromium без H.264, check_site на Mac тоже может быть без него). Нужна правка engine/ (срезать запрос перед replace) — запрещена.
- Значки шапки (favicon, apple-touch-icon) без ?v=: check_site строго сравнивает link:icon с главной.
- Картинка карточки на главной (card.webp) без ?v=: index.html вне прав; test_build_pages сверяет карточку в исходнике с render_card.
- Галерея about/history (gallery/*.webp) без ?v=: гладкие файлы-иконки, меняются редко.
