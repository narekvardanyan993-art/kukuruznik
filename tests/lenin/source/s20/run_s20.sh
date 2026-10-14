#!/bin/sh
# s20 Ленин: полный повтор сборки кадров из ответов Gemini (refs/s20/out, в git не входят) и кадров s19 (refs/s20/s19src = git show 13dcbc2:...)
# Порядок важен: голуби -> статуя день -> ночь -> кадр 5 -> запись в frames/.
set -e
cd "$(dirname "$0")"
B=../../refs/s20/build
python3 pigeons20.py $B
python3 day20.py $B
python3 night20.py $B
python3 f5_20.py $B
python3 apply20.py $B
