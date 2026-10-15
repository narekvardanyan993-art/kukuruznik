#!/bin/sh
# s23: поля качания крон и небо до силуэта кроны (из корня репозитория; нужны numpy, scipy, Pillow, opencv-python-headless).
# Промежуточные маски — во временную папку (в git не идут).
set -e
T=${TMPDIR:-/tmp}/s23crowns; mkdir -p "$T"
python3 tests/lenin/source/s23/crowns23.py tests/lenin/frames "$T" --viz        # маска крон + деревья
python3 tests/lenin/source/s23/sway23.py "$T" tests/lenin/frames --max-px 28     # frames/<кадр>_sway.png (swayMaxPx здания)
python3 tests/lenin/source/s23/skyedge23.py tests/lenin/frames "$T"              # env R: небо до силуэта кроны — ТОЛЬКО ОДИН РАЗ (повтор расширит небо ещё)
# проверка настоящим Chrome (облако/Мак с Chrome): сборка беты во временный сайт, затем
#   node tests/lenin/source/s23/snap23.mjs <site> <out> wind      — буря 10 с на 5 кадрах
#   node tests/lenin/source/s23/snap23.mjs <site> <out> snow      — таймлайн снега
#   python3 tests/lenin/source/s23/ana23.py <out> "$T" --json …   — соседи крон и сдвиг крон
#   python3 tests/lenin/source/s23/gif23.py <до> <после> "$T" <папка>
