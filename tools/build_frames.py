#!/usr/bin/env python3
"""Конвейер кадров для test-assets/depth.html.

Одна команда: .venv-depth/bin/python tools/build_frames.py

Что делает:
  1. Берёт все цветные картинки из test-assets/frames/ (любые *.png,
     кроме уже посчитанных *_depth.png).
  2. Для каждой строит карту глубины (Depth Anything V2, локально, MPS
     на Apple Silicon / CPU иначе) и кладёт рядом как <имя>_depth.png.
     Если depth-файл уже новее исходной картинки — пересчёт пропускается
     (см. --force, чтобы всегда пересчитывать).
  3. Переписывает список CONFIG.FRAMES внутри test-assets/depth.html —
     только между метками FRAMES:START/FRAMES:END, остальной код
     depth.html не трогает.

Правило проекта: логика depth.html (шейдер, обработчики ввода) меняется
только по прямому запросу — этот скрипт правит исключительно список
кадров, см. CLAUDE.md/AGENTS.md.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRAMES_DIR = ROOT / 'test-assets' / 'frames'
DEPTH_HTML = ROOT / 'test-assets' / 'depth.html'

FORCE = '--force' in sys.argv


def natural_key(p):
    return [int(t) if t.isdigit() else t for t in re.split(r'(\d+)', p.stem)]


def find_source_images():
    imgs = [p for p in FRAMES_DIR.glob('*.png') if not p.stem.endswith('_depth')]
    imgs.sort(key=natural_key)
    return imgs


def compute_depth_maps(images, force):
    todo = []
    for img in images:
        depth_path = img.with_name(img.stem + '_depth.png')
        if not force and depth_path.exists() and depth_path.stat().st_mtime >= img.stat().st_mtime:
            print('skip (up to date):', depth_path.name)
            continue
        todo.append((img, depth_path))

    if not todo:
        return

    import numpy as np
    import torch
    from PIL import Image
    from transformers import pipeline

    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    print('device:', device)
    pipe = pipeline(task='depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=device)

    for img_path, depth_path in todo:
        img = Image.open(img_path).convert('RGB')
        result = pipe(img)
        depth = np.array(result['depth']).astype(np.float32)
        depth -= depth.min()
        if depth.max() > 0:
            depth /= depth.max()
        depth_img = Image.fromarray((depth * 255).astype(np.uint8))
        depth_img = depth_img.resize(img.size, Image.BILINEAR)
        depth_img.save(depth_path)
        print('saved', depth_path.relative_to(ROOT))


def update_config_frames(images):
    html = DEPTH_HTML.read_text(encoding='utf-8')
    start_marker = '/* FRAMES:START'
    end_marker = '/* FRAMES:END'
    si = html.find(start_marker)
    ei = html.find(end_marker)
    if si == -1 or ei == -1:
        raise SystemExit('Не нашёл метки FRAMES:START/FRAMES:END в depth.html — не трогаю файл.')
    si_line_end = html.find('\n', si) + 1
    ei_line_start = html.rfind('\n', 0, ei) + 1
    lines = []
    for img in images:
        rel = 'frames/' + img.name
        rel_depth = 'frames/' + img.stem + '_depth.png'
        lines.append("    { color: %r, depth: %r }," % (rel, rel_depth))
    body = '\n'.join(lines) + '\n'
    new_html = html[:si_line_end] + body + html[ei_line_start:]
    DEPTH_HTML.write_text(new_html, encoding='utf-8')
    print('обновлён CONFIG.FRAMES в', DEPTH_HTML.relative_to(ROOT), '—', len(images), 'кадр(ов)')


def main():
    images = find_source_images()
    if not images:
        raise SystemExit('В test-assets/frames/ нет исходных картинок (*.png без _depth).')
    print('кадры:', [p.name for p in images])
    compute_depth_maps(images, FORCE)
    update_config_frames(images)
    print('готово.')


if __name__ == '__main__':
    main()
