#!/usr/bin/env python3
"""Круг s11: ночные картинки Ленина — к тону ночи живого Кукурузника (эталон).

  python3 tests/lenin/source/p8_night_s11.py [--report DIR]

Отзыв: ночью «свет не такой». Снимок ночи Кукурузника и Ленина рядом (report/s11/night_kuk_vs_lenin_before.jpg) показал:
земля и небо Ленина светлее (земля L* 73–97 против ~72 у Кукурузника, небо 65–71 против ~48), площадь розовая/жёлтая
(насыщенность a* вдвое выше) — B и G ночью выглядят «серым днём», ореолы фонарей большие при маленьких лампах.
Что делает: для каждого кадра — перенос тона в Lab отдельно для неба (карта окружения кадра, канал r) и земли:
среднее и разброс яркости — как у ночи Кукурузника (среднее по его кадрам 0–4, разброс не больше чем ×1,15 и не меньше ×0,8
своего — штрих не теряется), цвет — к нейтральному сине-серому Кукурузника, своё отклонение цвета ×0,55 (a*) / ×0,7 (b*).
Шов неба/земли размыт. Источник — копия ночи до s11 (source/night/s10/), поэтому скрипт можно запускать повторно.
Окна и фонари в ночных картинках тёмные (их зажигает движок, nightWins/nightLamps) — свет фонарей на земле и размер ореола —
настройка здания tuning.LOOK.lampHalo (building.json), не картинка.
"""
import shutil, sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
LF, KF = ROOT / 'tests/lenin/frames', ROOT / 'test-assets/frames'
BK = ROOT / 'tests/lenin/source/night/s10'
FRAMES = ['lenin_1', 'lenin_2', 'lenin_3', 'lenin_4', 'lenin_6']


def stats(lab, m):
    return np.array([[lab[..., i][m].mean(), lab[..., i][m].std()] for i in range(3)])


def main():
    a = sys.argv[1:]
    rep = Path(a[a.index('--report') + 1]) if '--report' in a else None
    BK.mkdir(parents=True, exist_ok=True)
    ks, kg = [], []
    for k in range(5):                                       # эталон: ночь живого Кукурузника
        im = np.asarray(Image.open(KF / ('v_angle_%d_night.png' % k)).convert('RGB'))
        sky = np.asarray(Image.open(KF / ('v_angle_%d_env.png' % k)))[..., 0] > 127
        lab = cv2.cvtColor(im, cv2.COLOR_RGB2LAB).astype(np.float32)
        ks.append(stats(lab, sky)); kg.append(stats(lab, ~sky))
    tgt = {'sky': np.mean(ks, 0), 'gnd': np.mean(kg, 0)}
    print('эталон Кукурузника: небо L %.1f±%.1f, земля L %.1f±%.1f' % (tgt['sky'][0][0], tgt['sky'][0][1], tgt['gnd'][0][0], tgt['gnd'][0][1]))
    sheet = []
    for n in FRAMES:
        src = BK / (n + '_night.webp')
        if not src.exists():
            shutil.copy2(LF / (n + '_night.webp'), src)          # копия ночи до s11 — источник при повторных запусках
        im = np.asarray(Image.open(src).convert('RGB'))
        H, W = im.shape[:2]
        env = np.asarray(Image.open(LF / (n + '_env.webp')).convert('RGB'))
        sky = cv2.resize(env, (W, H))[..., 0] > 127
        lab = cv2.cvtColor(im, cv2.COLOR_RGB2LAB).astype(np.float32)
        outs = {}
        for key, m in (('sky', sky), ('gnd', ~sky)):
            if m.sum() < 500:
                outs[key] = lab.copy(); continue
            s, t = stats(lab, m), tgt[key]
            o = lab.copy()
            k = np.clip(t[0][1] / max(1e-3, s[0][1]), 0.8, 1.15)
            o[..., 0] = t[0][0] + (lab[..., 0] - s[0][0]) * k
            o[..., 1] = t[1][0] + (lab[..., 1] - s[1][0]) * 0.55
            o[..., 2] = t[2][0] + (lab[..., 2] - s[2][0]) * 0.7
            outs[key] = o
        w = cv2.GaussianBlur(sky.astype(np.float32), (0, 0), 6)[..., None]
        o = outs['sky'] * w + outs['gnd'] * (1 - w)
        rgb = cv2.cvtColor(np.clip(o, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
        before, after = stats(lab, ~sky)[0], stats(cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32), ~sky)[0]
        print('%s: земля L %.1f±%.1f → %.1f±%.1f' % (n, before[0], before[1], after[0], after[1]))
        Image.fromarray(rgb).save(LF / (n + '_night.webp'), quality=90, method=6)
        if rep:
            sheet.append(np.hstack([cv2.resize(im, (W // 3, H // 3), interpolation=cv2.INTER_AREA), cv2.resize(rgb, (W // 3, H // 3), interpolation=cv2.INTER_AREA)]))
    if rep:
        rep.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.hstack(sheet)).save(rep / 'night_images_before_after.jpg', quality=85)


if __name__ == '__main__':
    main()
