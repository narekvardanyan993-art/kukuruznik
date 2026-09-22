#!/usr/bin/env python3
"""Конвейер кадров для test-assets/depth.html (слои: фон + здание).

Одна команда: .venv-depth/bin/python tools/build_frames.py

Раскладка test-assets/frames/ для каждого кадра <имя>:
  <имя>.png        — цветной кадр со зданием (то, что даёт Gemini на первый запрос)
  <имя>_bg.png      — тот же кадр без здания (Gemini: "remove the building...")
Оба файла обязательны — иначе кадр пропускается с предупреждением.

Что делает скрипт:
  1. Карта глубины для <имя>.png -> <имя>_depth.png (тоже глубина слоя здания)
     и для <имя>_bg.png -> <имя>_bg_depth.png (глубина слоя фона).
     Depth Anything V2, локально, MPS на Apple Silicon. Пересчёт пропускается,
     если depth-файл уже новее исходника (см. --force).
  2. Маска здания — двухпроходный SAM (Segment Anything, facebook/sam-vit-base):
     сначала точка (её берём по разнице <имя>.png / <имя>_bg.png — где картинки
     отличаются, там и здание), затем уточняющий bbox с запасом сверху (под
     «шляпу» башни) для чистой маски целиком. Результат — <имя>_building.png,
     RGBA-вырезка (цвет от <имя>.png, альфа — маска с мягким краем).
  3. Переписывает CONFIG.FRAMES в test-assets/depth.html — только между метками
     FRAMES:START/FRAMES:END, остальной код не трогает. Формат записи —
     { bg: {color, depth}, building: {color, depth} } на кадр.

Правило проекта: логика depth.html (шейдер, обработчики ввода) меняется
только по прямому запросу — этот скрипт правит список кадров и генерирует
сами картинки в test-assets/frames/.
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


def find_base_names():
    names = []
    for p in sorted(FRAMES_DIR.glob('*.png'), key=natural_key):
        stem = p.stem
        if stem.endswith('_depth') or stem.endswith('_bg') or stem.endswith('_building'):
            continue
        bg = FRAMES_DIR / f'{stem}_bg.png'
        if not bg.exists():
            print('пропускаю', stem, '— нет пары', bg.name)
            continue
        names.append(stem)
    return names


def needs_recompute(src, dst, force):
    return force or not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime


def compute_depth_maps(names, force):
    todo = []
    for name in names:
        for suffix in ('', '_bg'):
            src = FRAMES_DIR / f'{name}{suffix}.png'
            dst = FRAMES_DIR / f'{name}{suffix}_depth.png'
            if needs_recompute(src, dst, force):
                todo.append((src, dst))
            else:
                print('skip depth (up to date):', dst.name)

    if not todo:
        return

    import numpy as np
    import torch
    from PIL import Image
    from transformers import pipeline

    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    print('depth device:', device)
    pipe = pipeline(task='depth-estimation', model='depth-anything/Depth-Anything-V2-Small-hf', device=device)

    for src, dst in todo:
        img = Image.open(src).convert('RGB')
        result = pipe(img)
        depth = np.array(result['depth']).astype(np.float32)
        depth -= depth.min()
        if depth.max() > 0:
            depth /= depth.max()
        depth_img = Image.fromarray((depth * 255).astype(np.uint8))
        depth_img = depth_img.resize(img.size, Image.BILINEAR)
        depth_img.save(dst)
        print('saved', dst.relative_to(ROOT))


_sam_model = None
_sam_processor = None


def _load_sam():
    global _sam_model, _sam_processor
    if _sam_model is None:
        from transformers import SamModel, SamProcessor
        print('loading SAM (facebook/sam-vit-base) on CPU...')
        _sam_model = SamModel.from_pretrained('facebook/sam-vit-base')
        _sam_processor = SamProcessor.from_pretrained('facebook/sam-vit-base')
    return _sam_model, _sam_processor


def _sam_mask_from_point(img, pt):
    import numpy as np
    import torch
    model, processor = _load_sam()
    inputs = processor(img, input_points=[[list(pt)]], return_tensors='pt')
    with torch.no_grad():
        out = model(**inputs)
    masks = processor.image_processor.post_process_masks(
        out.pred_masks, inputs['original_sizes'], inputs['reshaped_input_sizes'])[0][0]
    coverages = [masks[i].numpy().mean() for i in range(masks.shape[0])]
    return masks[int(np.argmax(coverages))].numpy()


def _sam_mask_from_box(img, box):
    import numpy as np
    import torch
    model, processor = _load_sam()
    inputs = processor(img, input_boxes=[[list(box)]], return_tensors='pt')
    with torch.no_grad():
        out = model(**inputs)
    masks = processor.image_processor.post_process_masks(
        out.pred_masks, inputs['original_sizes'], inputs['reshaped_input_sizes'])[0][0]
    scores = out.iou_scores[0][0]
    return masks[int(scores.argmax())].numpy()


def _seed_point(combined, bg):
    import numpy as np
    from PIL import Image
    from scipy import ndimage
    a = np.asarray(combined).astype(np.int16)
    b = np.asarray(bg.resize(combined.size, Image.LANCZOS)).astype(np.int16)
    diff = np.abs(a - b).sum(axis=2)
    mask = diff > 60
    mask = ndimage.binary_closing(mask, structure=np.ones((11, 11)))
    W, H = combined.size
    upper = mask.copy()
    upper[int(H * 0.65):, :] = False
    ys, xs = np.nonzero(upper)
    if len(xs) == 0:
        ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return W // 2, H // 2
    return int(xs.mean()), int(ys.mean())


def compute_building_cutout(name, force):
    import numpy as np
    from PIL import Image, ImageFilter
    from scipy import ndimage

    combined_path = FRAMES_DIR / f'{name}.png'
    bg_path = FRAMES_DIR / f'{name}_bg.png'
    out_path = FRAMES_DIR / f'{name}_building.png'

    if needs_recompute(combined_path, out_path, force):
        combined = Image.open(combined_path).convert('RGB')
        bg = Image.open(bg_path).convert('RGB')
        W, H = combined.size

        pt = _seed_point(combined, bg)
        m1 = _sam_mask_from_point(combined, pt)
        ys, xs = np.nonzero(m1)
        if len(xs) == 0:
            print('  ! пустая маска на первом проходе для', name, '- пропускаю вырезку')
            return
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        h = y1 - y0
        box = [max(0, int(x0 - 0.05 * (x1 - x0))), max(0, int(y0 - 0.5 * h)),
               min(W, int(x1 + 0.05 * (x1 - x0))), min(H, int(y1 + 0.05 * h))]
        mask = _sam_mask_from_box(combined, box)

        mask = ndimage.binary_closing(mask, structure=np.ones((5, 5)))
        mask = ndimage.binary_fill_holes(mask)

        alpha = Image.fromarray((mask.astype(np.uint8)) * 255)
        alpha = alpha.filter(ImageFilter.GaussianBlur(2.0))

        out = combined.convert('RGBA')
        out.putalpha(alpha)
        out.save(out_path)
        print('saved', out_path.relative_to(ROOT), 'coverage %.1f%%' % (mask.mean() * 100))
    else:
        print('skip building cutout (up to date):', out_path.name)


def update_config_frames(names):
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
    for name in names:
        lines.append(
            "    { bg: { color: %r, depth: %r }, building: { color: %r, depth: %r } },"
            % ('frames/%s_bg.png' % name, 'frames/%s_bg_depth.png' % name,
               'frames/%s_building.png' % name, 'frames/%s_depth.png' % name)
        )
    body = '\n'.join(lines) + '\n'
    new_html = html[:si_line_end] + body + html[ei_line_start:]
    DEPTH_HTML.write_text(new_html, encoding='utf-8')
    print('обновлён CONFIG.FRAMES в', DEPTH_HTML.relative_to(ROOT), '—', len(names), 'кадр(ов)')


def main():
    names = find_base_names()
    if not names:
        raise SystemExit('В test-assets/frames/ нет пар <имя>.png + <имя>_bg.png.')
    print('кадры:', names)
    compute_depth_maps(names, FORCE)
    for name in names:
        compute_building_cutout(name, FORCE)
    update_config_frames(names)
    print('готово.')


if __name__ == '__main__':
    main()
