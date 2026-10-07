#!/bin/bash
# Атлас библиотеки жизни engine/sprites/life.webp + life.json (e1.11, docs/ENGINE-LIFE.md «Рецепт»).
# Птицы — рисунок кодом (tools/make_life_sprites.py); машины и люди — листы Gemini из library/sprites-src/ (на белом фоне).
# Новый лист: положить в library/sprites-src/, добавить строку intake ниже (сетка, масштаб, имена по рядам), запустить:  bash tools/build_life_atlas.sh
set -e
cd "$(dirname "$0")/.."
S=library/sprites-src
I="python3 tools/sprites_intake.py"
rm -f engine/sprites/life.webp
python3 tools/make_life_sprites.py                       # птицы → life.png + life.json (затем intake переводит в webp)
$I $S/pobeda.jpg  --grid 3x2 --scale 0.4  car_pobeda_side_r car_pobeda_side_l car_pobeda_front_r car_pobeda_front_l car_pobeda_rear_r car_pobeda_rear_l
$I $S/volga.jpg   --grid 3x2 --scale 0.19 car_volga_side_r car_volga_side_l car_volga_front_r car_volga_front_l car_volga_rear_r car_volga_rear_l
$I $S/water.jpg   --grid 3x2 --scale 0.45 car_water_side_r car_water_side_l car_water_front_r car_water_front_l car_water_rear_r car_water_rear_l
$I $S/trolley.jpg --grid 3x2 --scale 0.3  car_trolley_side_r car_trolley_side_l - - - -
$I $S/trolley34.jpg --grid 2x2 --scale 0.6 car_trolley_front_l car_trolley_front_r car_trolley_rear_l car_trolley_rear_r   # Gemini нарисовал ряды зеркально подписи
$I $S/walk.jpg  --grid 3x4 --scale 0.34 $(for w in mancoat woman mansuit; do for i in 0 1 2 3; do printf "walk_${w}_$i "; done; done)
$I $S/stand.jpg --grid 3x4 --scale 0.34 $(for w in manhat reader woman; do for i in 0 1 2 3; do printf "stand_${w}_$i "; done; done)
$I $S/sit.jpg   --grid 3x2 --scale 0.34 --holes sit_bench2_0 sit_bench2_1 sit_shine_0 sit_shine_1 sit_feeder_0 sit_feeder_1
