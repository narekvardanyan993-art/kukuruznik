# Погос-Петрос — слои кадров (шаг 4, как у Ленина)

Кадры pogos_a … pogos_f (= A … F0). Структура как tests/lenin: source/<кадр>/ (рисунок, подложка Gemini, layers.json), source/night/ (ночь Gemini), refs/s22/ (зима Gemini), frames/ (слои для движка).
Сборка (из корня репо, модели — depth_anything_v2_vits.onnx и isnet-general-use.onnx из GitHub releases):
- `python3 pogos-petros/build/scripts/prep.py` — раскладка исходников из gemini/in/, область вырезки по разнице «кадр − подложка».
- `python3 tools/build_building_layers.py --src … --bg … --spec …/layers.json --out pogos-petros/build/frames --models <папка моделей>` (D, E — без --bg: вырезка IS-Net в extra_box, фон — cv2.inpaint).
- ночь: `python3 tools/night_from_gemini.py pogos-petros/build pogos_<x> --night source/night/gemini_night_pogos_<x>.png --flood 0`
- снег: из папки build — `python3 ../../tests/lenin/source/s22/snowmask22.py pogos_<x> refs/s22/pogos_<x>_winter_a.png` (A, B, C, F; D нарисован зимой, E — интерьер).
- качание крон: s23 crowns23/sway23 (деревья нашлись только на C).
- F = F0 + призрак (scripts/ghost.py): церковь из A по слою здания, ~0,86 размера, звонница над серединой кинотеатра; слой призрака — pogos-petros/frames/F_ghost.png (RGBA).
