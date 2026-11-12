# Шаблон промо-ролика chka.am

Одна команда из папки репозитория:

```
python3 content/template/build.py content/scenes/pogos-01.json
```

Результат — `content/out/<имя>.mp4` (1080×1920, 30 к/с, H.264 с пометкой цвета bt709), `<имя>-sfx.wav` (только звуки — под музыку в TikTok), `<имя>-sheet.jpg` (лист: кадр на каждую секунду), `<имя>-events.json` (где какой звук).
`content/out/` и `content/cache/` в git не идут.

Новый ролик = новый файл в `content/scenes/` (скопировать `pogos-01.json`, поменять сцены). Код не трогать.

## Что нужно на машине
- python3 + numpy, Pillow, fonttools, brotli (шрифт сайта из woff2), opencv — только для `"align": true`;
- ffmpeg; node + `puppeteer-core` (есть в `node_modules` репозитория) и Chrome — только для съёмки сайта.
- Кадры сайта снимаются один раз и лежат в `content/cache/cap/<id>/`. Нет их — `build.py` скажет; снять:
  `python3 content/template/build.py content/scenes/<имя>.json --capture --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
  (в VM Мака Chrome нет — съёмка в облаке или в Терминале Нарека). Сайт берётся из живого дерева: `git archive origin/main`.
- Пересобрать одну сцену: `--only stone`. Посмотреть один кадр без сборки: `--preview 12.5`.

## Сценарий
```jsonc
{
 "name": "pogos-01", "fps": 30, "size": [1080, 1920],
 "safe": [250, 600, 160],                 // поля TikTok: сверху, снизу, справа — надписи ставятся внутри
 "font": {"file": "repo:engine/fonts/NotoSerif-latin.woff2", "weight": 600},   // шрифт сайта
 "capture": {"page": "pogos-petros", "dpr": 2, "shots": [ ... ]},              // живые куски сайта (ниже)
 "scenes": [ {сцена}, ... ]
}
```
Пути: `repo:` — файл репозитория, `kitchen:` — `~/Documents/chka-kitchen`, `cap:<id>` — снятые кадры сайта.

### Сцена
| поле | что |
|---|---|
| `id`, `dur` | имя и длительность (с; без входящего перехода). Ритм 1–2 с. |
| `src` | `{"image": …}` · `{"video": …, "start": 1.2, "speed": 1}` (ролик Veo) · `{"seq": "cap:<id>"}` (кадры сайта) |
| `crop` | `[x0,y0,x1,y1]` доли источника — например, вырезать 9:16 из ролика 16:9 |
| `fit`, `bg`, `frame` | `cover` (по умолчанию) или `contain` на фоне `bg` (бумага сайта) с рамкой `frame` px |
| `cam` | `{"from":[cx,cy,z], "to":[cx,cy,z], "ease":"inout"|"out"|"linear"}` — точка источника в центре и приближение; камера движется всегда |
| `look` | `sepia` (архивное фото), `sharpen`, `blur` |
| `trans` | входящий переход: `develop` (проявление: тёмные штрихи первыми), `dissolve`, `zoom`, `slide` (как листание), `flash` («сохранено»); `dur` |
| `reveal` | второй слой внутри сцены: `{"from"|"image": …, "align": true, "at", "dur", "mode": "wipe"|"develop", "span": [x0,x1]}` |
| `text` | `[{"s":"1930", "at", "dur", "size", "y" (доля полосы между полями), "sfx_in", "sfx_out"}]` — только слова, понятные всем |
| `sfx`, `sfx_extra` | звук на входе сцены (по умолчанию — по типу перехода) и доп. звуки `[[сек, имя]]` |

### Звуки (`sfx.py`, синтез кодом)
`drop` капля · `pop` пузырёк · `tick` щелчок · `glass` стекло · `air` воздух · `air_low` низкий воздух · `pluck` мягкая струна · `shutter` затвор.
Звук ставится на каждый вход сцены, появление и уход надписи, проявление слоя; один и тот же звук подряд не повторяется (`tidy`), пик ≤ −3 dBFS, обычно −14.

### Съёмка сайта (`capture.mjs`)
`{"id", "frame", "tod", "precip", "dur", "fps", "settle", "tilt": [[t,x,y],…], "events": [{"at", "do": "tod"|"precip"|"click", "val"}], "speed", "step", "show": [t0,t1], "card": {"lang":"en"}}`
Виртуальное время (как `tools/stanok_look.mjs`), кадр собирается из холстов сцены без интерфейса (`immersive`). `speed` — ускорение (ночь, снег), `show` — шоу кадра «заморожено» по секундам, `card` — открытка движка (`window.__card.make`).
Время: ≈1 с на кадр 1080×1920 в облаке (снимок экрана был бы 50 с — поэтому холсты), шоу ≈2,5 с на кадр.

## Правила
Картинки — только рисунки Gemini, ролики Veo, архивные фото со свободной лицензией (`sources.md`), снимки сайта. Код двигает, режет, смешивает, пишет слова — фигур и предметов не рисует. Чужой музыки нет — музыку ставит Нарек в TikTok поверх `-sfx.wav`.
