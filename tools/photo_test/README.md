# Черновые скрипты теста «одно фото» (28.09.2026, облачная сессия)

Не часть сайта и не часть конвейера. Прототип: из одного архивного фото — слои кадра для движка в облаке, без Hugging Face
(модели — копии с GitHub: Depth Anything V2 Small ONNX `fabio-sim/Depth-Anything-ONNX` v2.0.0, вырезка IS-Net `danielgatis/rembg` v0.0.0).
Нужны: pillow, numpy, scipy, opencv-python-headless, onnxruntime (в отдельном venv вне репозитория).

- `lenin_prep.py SP ФОТО` — обрезка 9:16 (768×1365), очистка зерна, карта глубины, маска памятника, маска неба → photo/depth/mask/sky.png.
- `lenin_style_filter.py` — фото → «тушь + акварель на бумаге» (ЗАМЕНА рисунку Gemini только для теста; стиль сайта делается в Gemini).
- `photo_layers.py SP ФОТО OUT` — то же для горизонтального фото (первый тест, площадь).

Результат теста — закрытая ссылка https://claude.ai/artifact/7YsRGETeP3pzKm4Nt2ohSE (Ленин, archive_1.jpg из Drive-папки lenin/04_best,
по таблице Gemini — общественное достояние; не проверено на самом Викискладе).
Дальше: рисунок в Gemini (день + тот же кадр без памятника) → обобщить tools/build_frames.py под папку здания (docs/NOVOE-ZDANIE.md, «Что ещё не готово»).
