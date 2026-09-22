# Карта проекта (Map)

## Точки сохранения
- **Тег working-2026-09-22:** Сохранённое рабочее состояние (от 22 сентября 2026).
  - Как откатиться к этому состоянию одной командой (уничтожит все более новые незакомиченные изменения!):
    `git reset --hard working-2026-09-22`
- **Тег depth-photo-v1** (ветка `test/depth-photo`): рабочий просмотрщик «3D-фото» до конвейера кадров и стилизации.
  - Откат: `git reset --hard depth-photo-v1`

## Конвейер кадров для test-assets/depth.html (ветка test/depth-photo)
Одна команда пересчитывает карты глубины для всех картинок в
`test-assets/frames/` и переписывает список кадров в
`test-assets/depth.html` (только между метками `FRAMES:START`/`FRAMES:END`,
остальной код файла не трогает):

```
.venv-depth/bin/python tools/build_frames.py
```

- Кладёшь/меняешь цветные картинки в `test-assets/frames/*.png` (имя без
  суффикса `_depth`) — скрипт сам построит `<имя>_depth.png` рядом и
  обновит CONFIG.FRAMES.
- Если депth-карта уже новее исходника — пересчёт для неё пропускается;
  `--force` пересчитывает всё заново.
- Модель — Depth Anything V2 Small, работает локально через venv
  `.venv-depth` (не в git, поднимается один раз: `python3 -m venv .venv-depth`
  + `pip install torch torchvision transformers pillow numpy accelerate`).
