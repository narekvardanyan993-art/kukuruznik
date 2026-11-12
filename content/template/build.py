#!/usr/bin/env python3
"""Сборка промо-ролика chka.am из сценария (content/scenes/<имя>.json) — одной командой.

    python3 content/template/build.py content/scenes/pogos-01.json            # ролик + дорожка звуков + лист кадров
    python3 content/template/build.py content/scenes/pogos-01.json --capture --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

Что делает:
  1. живые куски сайта (наклон, ночь, снег, шоу, открытка) — из кэша content/cache/cap/<id>/; нет кэша и есть --capture →
     снимает их capture.mjs (Chrome + виртуальное время, как tools/stanok_look.mjs) с живого дерева сайта (git archive origin/main);
  2. каждая сцена (+ её входящий переход) — отдельный файл content/cache/seg/<имя>/NN-<id>.mp4 (кэш по содержимому сцены);
  3. склейка concat -c copy, звуки — синтез кодом (sfx.py), без голоса и музыки;
  4. content/out/<имя>.mp4, <имя>-sfx.wav (только звуки — под музыку в TikTok), <имя>-sheet.jpg (по кадру на 1 с).
Рисует только движение, переходы и надписи: картинки — рисунки Gemini, ролики Veo, архивные фото, снимки сайта (CLAUDE.md §4).
Формат сценария — content/template/README.md.
"""
import sys, os, json, hashlib, subprocess, argparse, shutil, math, glob
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTENT = HERE.parent
REPO = CONTENT.parent
sys.path.insert(0, str(HERE))

try:
    import numpy as np
    from PIL import Image, ImageOps, ImageFilter, ImageDraw, ImageFont
except ImportError:
    sys.exit('нужны numpy и Pillow: pip3 install --user numpy pillow')
import sfx as SFX

CACHE = CONTENT / 'cache'
OUT = CONTENT / 'out'


# ---------------------------------------------------------------- пути источников
def kitchen_dir():
    for p in (Path.home() / 'Documents/chka-kitchen', Path.home() / 'mnt/chka-kitchen', REPO.parent / 'chka-kitchen'):
        if p.exists():
            return p
    return Path.home() / 'Documents/chka-kitchen'


def resolve(ref):
    """repo:<путь> — файл репозитория; kitchen:<путь> — chka-kitchen; site:<путь> — живое дерево сайта (кэш);
    cap:<id> — снятые кадры сайта; abs/относительный путь — как есть."""
    if ref.startswith('repo:'):
        return REPO / ref[5:]
    if ref.startswith('kitchen:'):
        return kitchen_dir() / ref[8:]
    if ref.startswith('site:'):
        return CACHE / 'site' / ref[5:]
    if ref.startswith('cap:'):
        return CACHE / 'cap' / ref[4:]
    return Path(os.path.expanduser(ref))


# ---------------------------------------------------------------- шрифт сайта (woff2 → ttf один раз)
_FONT = {}


def font(spec, size):
    key = (spec['file'], spec.get('weight', 600), size)
    if key in _FONT:
        return _FONT[key]
    src = resolve(spec['file'])
    ttf = CACHE / 'fonts' / (src.stem + '.ttf')
    if not ttf.exists():
        try:
            from fontTools.ttLib import TTFont
        except ImportError:
            sys.exit('нужен fonttools для шрифта сайта: pip3 install --user fonttools brotli')
        ttf.parent.mkdir(parents=True, exist_ok=True)
        f = TTFont(str(src)); f.flavor = None; f.save(str(ttf))
    f = ImageFont.truetype(str(ttf), size)
    try:
        f.set_variation_by_axes([spec.get('weight', 600)])
    except Exception:
        pass
    _FONT[key] = f
    return f


# ---------------------------------------------------------------- плавность
def ease(u, kind='inout'):
    u = min(1.0, max(0.0, u))
    if kind == 'linear':
        return u
    if kind == 'out':
        return 1 - (1 - u) ** 3
    if kind == 'in':
        return u ** 3
    return 0.5 - 0.5 * math.cos(math.pi * u)      # inout: синус, без рывка на краях


def lerp(a, b, u):
    return [x + (y - x) * u for x, y in zip(a, b)]


# ---------------------------------------------------------------- источники кадров
class Source:
    """Отдаёт PIL RGB-кадр источника на секунду t сцены (до движения камеры)."""

    def __init__(self, sc, cfg):
        s = sc['src']
        self.kind = 'image' if 'image' in s else 'video' if 'video' in s else 'seq'
        self.look = sc.get('look', {})
        self.crop = sc.get('crop')
        self.speed = s.get('speed', 1.0)
        self.start = s.get('start', 0.0)
        if self.kind == 'image':
            im = Image.open(resolve(s['image']))
            self.still = self._prep(im, static=True)
        elif self.kind == 'video':
            self.frames, self.vfps = self._decode(resolve(s['video']), self.start, sc['dur'] * self.speed + 1.2)
        else:
            d = resolve(s['seq'])
            self.files = sorted(glob.glob(str(d / '*.jpg')))
            if not self.files:
                sys.exit(f'нет кадров сайта в {d}: снять их — флаг --capture (нужен Chrome)')
            self.sfps = cfg['fps']

    def _prep(self, im, static=False):
        if self.look.get('sepia') and im.mode in ('L', 'LA', 'P', 'RGB'):
            g = ImageOps.grayscale(im.convert('RGB'))
            g = ImageOps.autocontrast(g, cutoff=0.5)
            im = ImageOps.colorize(g, black='#241a12', white='#f2e8d4', mid='#8c7556')
        im = im.convert('RGB')
        if self.crop:
            w, h = im.size; x0, y0, x1, y1 = self.crop
            im = im.crop((round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h)))
        if self.look.get('blur'):
            im = im.filter(ImageFilter.GaussianBlur(self.look['blur']))
        if self.look.get('sharpen'):
            im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=int(80 * self.look['sharpen']), threshold=2))
        return im

    def _decode(self, path, t0, dur):
        pr = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height,r_frame_rate',
                             '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True).stdout.strip().split(',')
        w, h = int(pr[0]), int(pr[1]); num, den = pr[2].split('/'); fps = float(num) / float(den)
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t0:.3f}', '-t', f'{dur:.3f}', '-i', str(path), '-f', 'rawvideo',
                              '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
        n = len(raw) // (w * h * 3)
        arr = np.frombuffer(raw, np.uint8)[: n * w * h * 3].reshape(n, h, w, 3)
        return [self._prep(Image.fromarray(a)) for a in arr], fps

    def at(self, t):
        if self.kind == 'image':
            return self.still
        if self.kind == 'video':
            i = min(len(self.frames) - 1, max(0, int(round(t * self.speed * self.vfps))))
            return self.frames[i]
        i = min(len(self.files) - 1, max(0, int(round((self.start + t * self.speed) * self.sfps))))
        return self._prep(Image.open(self.files[i]))


# ---------------------------------------------------------------- камера
def place(im, size, cam, fit='cover', bg=None, frame=0):
    """im — кадр источника; cam = [cx, cy, z]: точка источника (доли) в центре экрана, z — приближение к «cover»/«contain»."""
    W, H = size
    w, h = im.size
    cx, cy, z = cam
    s0 = max(W / w, H / h) if fit == 'cover' else min(W / w, H / h)
    s = s0 * z
    # сначала уменьшить источник близко к нужному масштабу (качественно), потом аффинное преобразование с подпикселем
    pre = 1.0
    if s < 0.7:
        pre = min(1.0, s * 1.25)
        im = im.resize((max(1, round(w * pre)), max(1, round(h * pre))), Image.LANCZOS)
        w, h = im.size
        s = s / pre
    a = 1 / s
    c = cx * w - (W / 2) * a
    f = cy * h - (H / 2) * a
    if fit == 'cover' or bg is None:
        return im.transform((W, H), Image.AFFINE, (a, 0, c, 0, a, f), resample=Image.BICUBIC, fillcolor=(243, 234, 216))
    lay = im.convert('RGBA')
    if frame:
        bw = max(2, round(frame / s))
        lay = ImageOps.expand(lay, border=bw, fill=(246, 240, 228, 255))
        w2, h2 = lay.size
        c = cx * w2 - (W / 2) * a
        f = cy * h2 - (H / 2) * a
    out = bg.copy()
    top = lay.transform((W, H), Image.AFFINE, (a, 0, c, 0, a, f), resample=Image.BICUBIC, fillcolor=(0, 0, 0, 0))
    out.paste(top, (0, 0), top)
    return out


# ---------------------------------------------------------------- надписи
def text_layer(cfg, tx):
    f = font(cfg['font'], tx.get('size', 160))
    s = tx['s']
    x0, y0, x1, y1 = f.getbbox(s)
    pad = int(tx.get('size', 160) * 0.35)
    w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
    ink = tx.get('color', '#2a1f16')
    halo = tx.get('halo', '#f6eedd')
    lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    # мягкое светлое облако под словом — чтобы читалось на любом рисунке
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).text((pad - x0, pad - y0), s, font=f, fill=255, stroke_width=max(2, int(tx.get('size', 160) * 0.06)), stroke_fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(tx.get('size', 160) * 0.12))
    hl = Image.new('RGBA', (w, h), halo); hl.putalpha(glow.point(lambda v: min(255, int(v * 1.6 * tx.get('halo_k', 0.85)))))
    lay = Image.alpha_composite(lay, hl)
    d = ImageDraw.Draw(lay)
    d.text((pad - x0, pad - y0), s, font=f, fill=ink)
    return lay


def text_pos(cfg, tx, lay_size):
    W, H = cfg['size']
    top, bottom, right = cfg['safe']
    band_h = H - top - bottom
    cx = (W - right) / 2 + tx.get('dx', 0)
    cy = top + band_h * tx.get('y', 0.5)
    return cx, cy


def draw_texts(frame, cfg, sc, t, cache):
    out = frame
    for k, tx in enumerate(sc.get('text', [])):
        at, du = tx.get('at', 0.0), tx.get('dur', sc['dur'] - tx.get('at', 0.0))
        fin, fout = tx.get('fade', [0.35, 0.3])
        if t < at or t > at + du:
            continue
        u_in = ease((t - at) / fin, 'out')
        u_out = ease((at + du - t) / fout, 'out') if fout > 0 else 1
        a = min(u_in, u_out)
        if a <= 0.003:
            continue
        key = (sc['id'], k)
        if key not in cache:
            cache[key] = text_layer(cfg, tx)
        lay = cache[key]
        sc_k = tx.get('scale', [1.12, 1.0])
        z = sc_k[0] + (sc_k[1] - sc_k[0]) * u_in
        z *= 1 + tx.get('drift', 0.03) * ((t - at) / max(du, 1e-3))      # слово не стоит: медленно растёт всё время
        w, h = lay.size
        L = lay.resize((max(1, round(w * z)), max(1, round(h * z))), Image.BICUBIC)
        if a < 1:
            al = L.getchannel('A').point(lambda v, a=a: int(v * a))
            L.putalpha(al)
        cx, cy = text_pos(cfg, tx, L.size)
        cy += tx.get('rise', 18) * (1 - u_in)
        out = out.copy() if out is frame else out
        out.paste(L, (round(cx - L.width / 2), round(cy - L.height / 2)), L)
    return out


# ---------------------------------------------------------------- переходы
def to_np(im):
    return np.asarray(im, dtype=np.float32) / 255.0


def zoom_frame(im, k):
    if abs(k - 1) < 1e-4:
        return im
    W, H = im.size
    a = 1 / k
    return im.transform((W, H), Image.AFFINE, (a, 0, W / 2 - W / 2 * a, 0, a, H / 2 - H / 2 * a), resample=Image.BICUBIC)


def blend(prev, cur, u, tr):
    """prev/cur — PIL кадры; u — доля перехода 0..1."""
    typ = tr.get('type', 'dissolve')
    e = ease(u, 'inout')
    if typ == 'zoom':   # старый кадр уезжает вперёд и тает, новый приходит из лёгкого приближения
        a = to_np(zoom_frame(prev, 1 + 0.22 * e)); b = to_np(zoom_frame(cur, 1.14 - 0.14 * e))
        m = e
    elif typ == 'slide':   # как пролистывание в телефоне: вверх, с плавным разгоном и торможением
        W, H = prev.size
        off = int(round(H * e))
        canvas = Image.new('RGB', (W, H))
        canvas.paste(prev, (0, -off)); canvas.paste(cur, (0, H - off))
        return canvas
    elif typ == 'develop':   # проявление: сначала тёмные штрихи нового кадра, потом светлые
        a = to_np(prev); b = to_np(cur)
        lum = (b[..., 0] * 0.3 + b[..., 1] * 0.59 + b[..., 2] * 0.11)
        soft = 0.45
        m = np.clip((e * (1 + soft) - lum) / soft, 0, 1)[..., None]
        m = m * 0.85 + e * 0.15
    elif typ == 'flash':   # мягкая вспышка «сохранено»
        a = to_np(prev); b = to_np(cur); m = e
        r = a * (1 - m) + b * m
        r = r + (1 - r) * (0.55 * math.sin(math.pi * u) ** 2)
        return Image.fromarray(np.clip(r * 255 + 0.5, 0, 255).astype(np.uint8))
    else:
        a = to_np(prev); b = to_np(cur); m = e
    r = a * (1 - m) + b * m
    return Image.fromarray(np.clip(r * 255 + 0.5, 0, 255).astype(np.uint8))


def reveal(base, top, u, rv):
    """второй слой внутри сцены (например, надпись на камне): мягкая шторка слева направо или проявление."""
    if u <= 0:
        return base
    if u >= 1:
        return top
    a = to_np(base); b = to_np(top)
    W = a.shape[1]
    if rv.get('mode', 'wipe') == 'wipe':
        x = np.linspace(0, 1, W, dtype=np.float32)[None, :, None]
        x0, x1 = rv.get('span', [0.0, 1.0])
        p = x0 + (x1 - x0) * ease(u, 'inout')
        m = np.clip((p - x) / 0.06 + 0.5, 0, 1)
    else:
        lum = (b[..., 0] * 0.3 + b[..., 1] * 0.59 + b[..., 2] * 0.11)
        m = np.clip((ease(u) * 1.45 - lum) / 0.45, 0, 1)[..., None]
    r = a * (1 - m) + b * m
    return Image.fromarray(np.clip(r * 255 + 0.5, 0, 255).astype(np.uint8))


def align_to(top_path, base_img, cache_key):
    """Совместить второй слой с первым (масштаб + сдвиг + поворот по точкам, cv2). Результат кэшируется."""
    outp = CACHE / 'align' / (cache_key + '.png')
    if outp.exists():
        return Image.open(outp).convert('RGB')
    try:
        import cv2
    except ImportError:
        sys.exit('для "align": true нужен opencv: pip3 install --user opencv-python-headless')
    A = cv2.cvtColor(np.asarray(base_img), cv2.COLOR_RGB2GRAY)
    Bc = np.asarray(Image.open(top_path).convert('RGB'))
    B = cv2.cvtColor(Bc, cv2.COLOR_RGB2GRAY)
    orb = cv2.ORB_create(6000)
    ka, da = orb.detectAndCompute(A, None); kb, db = orb.detectAndCompute(B, None)
    mt = sorted(cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(db, da), key=lambda m: m.distance)[:800]
    src = np.float32([kb[m.queryIdx].pt for m in mt]); dst = np.float32([ka[m.trainIdx].pt for m in mt])
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4)
    if M is None:
        sys.exit('align: не нашёл совпадений между слоями')
    warped = cv2.warpAffine(Bc, M, (A.shape[1], A.shape[0]), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    outp.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(warped).save(outp)
    print(f'  align: {int(inl.sum())} точек из {len(mt)}')
    return Image.fromarray(warped)


# ---------------------------------------------------------------- сцена → кадры
class Scene:
    def __init__(self, sc, cfg):
        self.sc = sc
        self.cfg = cfg
        self.src = Source(sc, cfg)
        self.fit = sc.get('fit', 'cover')
        self.bg = None
        if sc.get('bg'):
            b = Image.open(resolve(sc['bg'])).convert('RGB')
            self.bg = place(b, cfg['size'], [0.5, 0.5, 1.0], 'cover')
        cam = sc.get('cam', {})
        self.c0 = cam.get('from', [0.5, 0.5, 1.0])
        self.c1 = cam.get('to', [0.5, 0.5, 1.06])
        self.cease = cam.get('ease', 'inout')
        self.rv = sc.get('reveal')
        self.rv_img = None
        if self.rv:
            # второй слой: "image" — во что проявляется кадр; "from" — с чего начинается (кадр-источник — итог)
            base = self.src.at(0)
            other = self.rv.get('image') or self.rv.get('from')
            if self.rv.get('align'):
                key = hashlib.sha1((other + json.dumps(sc['src'])).encode()).hexdigest()[:12]
                self.rv_img = align_to(resolve(other), base, key)
            else:
                self.rv_img = Image.open(resolve(other)).convert('RGB').resize(base.size, Image.LANCZOS)
        self.tcache = {}
        self.pre = sc.get('trans', {}).get('dur', 0.0) if sc.get('_k', 0) else 0.0   # сцена уже движется под входящим переходом

    def frame(self, t):
        """t — секунды от начала сцены (может быть отрицательным во время входящего перехода)."""
        sc = self.sc
        D = sc['dur']
        span = D + self.pre
        u = (t + self.pre) / span if span > 0 else 0
        cam = lerp(self.c0, self.c1, ease(u, self.cease))
        src = self.src.at(max(0.0, t + self.pre))
        if self.rv:
            ru = (t - self.rv.get('at', 0.3)) / self.rv.get('dur', 0.8)
            src = reveal(self.rv_img, src, ru, self.rv) if self.rv.get('from') else reveal(src, self.rv_img, ru, self.rv)
        im = place(src, self.cfg['size'], cam, self.fit, self.bg, sc.get('frame', 0))
        if sc.get('vignette'):
            im = vignette(im, sc['vignette'])
        return draw_texts(im, self.cfg, sc, t, self.tcache)


_VIG = {}


def vignette(im, k):
    W, H = im.size
    if (W, H, k) not in _VIG:
        y, x = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
        _VIG[(W, H, k)] = (1 - k * np.clip(r - 0.55, 0, 1) ** 1.5)[..., None]
    return Image.fromarray(np.clip(to_np(im) * _VIG[(W, H, k)] * 255, 0, 255).astype(np.uint8))


# ---------------------------------------------------------------- кодирование
def enc_args(cfg):
    return ['-c:v', 'libx264', '-preset', cfg.get('preset', 'veryfast'), '-crf', str(cfg.get('crf', 17)), '-pix_fmt', 'yuv420p',
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
            '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709', '-movflags', '+faststart']


def render_segment(path, frames_iter, n, cfg):
    W, H = cfg['size']
    tmp = path.with_name(path.stem + '.part.mp4')
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(cfg['fps']), '-i', '-',
                          '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', *enc_args(cfg), str(tmp)], stdin=subprocess.PIPE)
    k = 0
    for im in frames_iter:
        p.stdin.write(im.tobytes()); k += 1
    p.stdin.close()
    if p.wait() != 0 or k != n:
        sys.exit(f'ffmpeg упал на {path.name} (кадров {k} из {n})')
    tmp.rename(path)


# ---------------------------------------------------------------- захват сайта
def ensure_capture(cfg, args):
    cap = cfg.get('capture')
    if not cap:
        return
    need = [s for s in cap['shots'] if not (CACHE / 'cap' / s['id'] / 'done.json').exists()]
    if not need:
        return
    if not args.capture:
        sys.exit('нет снимков сайта: ' + ', '.join(s['id'] for s in need) + '\n  → повторить с --capture --chrome <путь к Chrome>')
    site = CACHE / 'site'
    if not (site / cap['page'] / 'index.html').exists():
        site.mkdir(parents=True, exist_ok=True)
        print('живое дерево сайта: git archive origin/main →', site)
        subprocess.run(f'git -C "{REPO}" archive origin/main {cap["page"]} engine assets CNAME index.html | tar -x -C "{site}"', shell=True, check=True)
    shots = CACHE / 'cap' / 'shots.json'
    shots.parent.mkdir(parents=True, exist_ok=True)
    shots.write_text(json.dumps([dict(s, page=cap['page']) for s in cap['shots']], ensure_ascii=False))
    cmd = ['node', str(HERE / 'capture.mjs'), '--site', str(site), '--shots', str(shots), '--out', str(CACHE / 'cap'), '--dpr', str(cap.get('dpr', 2))]
    if args.chrome:
        cmd += ['--chrome', args.chrome]
    print('снимаю сайт:', ' '.join(s['id'] for s in need))
    subprocess.run(cmd, check=True, cwd=str(REPO))


# ---------------------------------------------------------------- лист кадров
def contact_sheet(mp4, out, cfg, every=1.0):
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(mp4)], capture_output=True, text=True).stdout)
    n = int(dur // every) + (1 if dur % every > 0.25 else 0)
    tw, th = 216, 384
    cols = 6
    rows = math.ceil(n / cols)
    sheet = Image.new('RGB', (cols * tw, rows * (th + 30)), (250, 246, 238))
    f = font(cfg['font'], 20)
    d = ImageDraw.Draw(sheet)
    for i in range(n):
        t = i * every + every / 2
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{min(t, dur - 0.05):.3f}', '-i', str(mp4), '-frames:v', '1', '-f', 'rawvideo',
                              '-pix_fmt', 'rgb24', '-s', f'{tw}x{th}', '-'], capture_output=True, check=True).stdout
        im = Image.frombytes('RGB', (tw, th), raw[: tw * th * 3])
        x, y = (i % cols) * tw, (i // cols) * (th + 30)
        sheet.paste(im, (x, y + 30))
        d.text((x + 6, y + 4), f'{t:.1f} s', font=f, fill=(60, 45, 30))
    sheet.save(out, quality=88)


# ---------------------------------------------------------------- главное
def main():
    ap = argparse.ArgumentParser(description='сборка промо-ролика chka.am из сценария')
    ap.add_argument('scenario')
    ap.add_argument('--capture', action='store_true', help='снять недостающие куски сайта (нужен Chrome)')
    ap.add_argument('--chrome', help='путь к Chrome/Chromium для съёмки сайта')
    ap.add_argument('--only', help='пересобрать только эти сцены (id через запятую), остальное из кэша')
    ap.add_argument('--preview', type=float, help='не собирать ролик, а сохранить кадр на эту секунду в content/out/<имя>-t<сек>.jpg')
    args = ap.parse_args()

    cfg = json.loads(Path(args.scenario).read_text())
    cfg.setdefault('fps', 30); cfg.setdefault('size', [1080, 1920]); cfg.setdefault('safe', [250, 600, 160])
    name = cfg['name']
    if args.preview is None:
        ensure_capture(cfg, args)

    scenes = cfg['scenes']
    for k, sc in enumerate(scenes):
        sc['_k'] = k
    fps = cfg['fps']
    # раскладка по времени: входящий переход сцены k накрывает конец сцены k-1
    starts, t = [], 0.0
    for k, sc in enumerate(scenes):
        tr = sc.get('trans', {}).get('dur', 0.0) if k else 0.0
        t -= tr
        starts.append(t)
        t += tr + sc['dur'] if k else sc['dur']
    total = t
    print(f'{name}: {len(scenes)} сцен, {total:.2f} с')

    if args.preview is not None:
        tq = args.preview
        k = max(i for i, s in enumerate(starts) if s <= tq + 1e-9)
        cur = Scene(scenes[k], cfg)
        tr = scenes[k].get('trans', {}) if k else {}
        tin = tq - starts[k] - (tr.get('dur', 0) if k else 0)   # время внутри сцены (без перехода)
        im = cur.frame(tin)
        if k and tin < 0:
            prev = Scene(scenes[k - 1], cfg)
            ptr = scenes[k - 1].get('trans', {}).get('dur', 0) if k - 1 else 0
            im = blend(prev.frame(tq - starts[k - 1] - ptr), im, (tq - starts[k]) / tr['dur'], tr)
        OUT.mkdir(parents=True, exist_ok=True)
        p = OUT / f'{name}-t{tq:.2f}.jpg'
        im.save(p, quality=92); print(p)
        return

    segdir = CACHE / 'seg' / name
    segdir.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(',')) if args.only else None
    segs = []
    for k, sc in enumerate(scenes):
        tr = sc.get('trans', {}) if k else {}
        trd = tr.get('dur', 0.0)
        # кадров сегмента k: от начала его перехода до начала перехода следующей сцены
        nxt = scenes[k + 1].get('trans', {}).get('dur', 0.0) if k + 1 < len(scenes) else 0.0
        seg_len = (trd + sc['dur'] - nxt) if k else (sc['dur'] - nxt)
        n = int(round(seg_len * fps))
        key = hashlib.sha1(json.dumps([sc, scenes[k - 1] if k else None, nxt, cfg['size'], fps, cfg.get('font'), cfg['safe'], 3], sort_keys=True).encode()).hexdigest()[:10]
        path = segdir / f'{k:02d}-{sc["id"]}-{key}.mp4'
        segs.append(path)
        if path.exists() and not (only and sc['id'] in only):
            continue
        for old in segdir.glob(f'{k:02d}-*.mp4'):
            if old != path:
                old.rename(old.with_suffix('.old'))
        print(f'  сцена {k:02d} {sc["id"]}: {n} кадров')
        cur = Scene(sc, cfg)
        prev = Scene(scenes[k - 1], cfg) if k and trd > 0 else None

        def gen(cur=cur, prev=prev, trd=trd, tr=tr, n=n, k=k):
            for i in range(n):
                tl = i / fps                     # от начала сегмента
                tin = tl - trd                   # время внутри сцены
                im = cur.frame(tin)
                if prev is not None and tl < trd:
                    pd = scenes[k - 1]['dur']
                    im = blend(prev.frame(pd - trd + tl), im, tl / trd, tr)
                yield im
        render_segment(path, gen(), n, cfg)

    OUT.mkdir(parents=True, exist_ok=True)
    lst = segdir / 'list.txt'
    lst.write_text(''.join(f"file '{p.as_posix()}'\n" for p in segs))
    silent = segdir / 'video.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(silent)], check=True)

    # звуки: на каждом появлении/исчезновении
    events = []
    for k, sc in enumerate(scenes):
        t0 = starts[k]
        trd = sc.get('trans', {}).get('dur', 0.0) if k else 0.0
        if sc.get('sfx') != 'none':
            events.append((t0 + sc.get('sfx_at', 0.0), sc.get('sfx', SFX.DEFAULT.get(sc.get('trans', {}).get('type', 'dissolve'), 'air'))))
        tin0 = t0 + trd
        for tx in sc.get('text', []):
            at = tin0 + tx.get('at', 0.0)
            du = tx.get('dur', sc['dur'] - tx.get('at', 0.0))
            events.append((at, tx.get('sfx_in', 'tick')))
            if tx.get('sfx_out', 'air_low') != 'none' and at + du < total - 0.2:
                events.append((at + du - tx.get('fade', [0.35, 0.3])[1] * 0.6, tx.get('sfx_out', 'air_low')))
        if sc.get('reveal'):
            events.append((tin0 + sc['reveal'].get('at', 0.3), sc['reveal'].get('sfx', 'glass')))
        for ev in sc.get('sfx_extra', []):
            events.append((tin0 + ev[0], ev[1]))
    events = SFX.tidy(events)
    wav = OUT / f'{name}-sfx.wav'
    SFX.render(events, total, str(wav), seed=cfg.get('seed', 7))
    final = OUT / f'{name}.mp4'
    tmp = OUT / f'{name}.part.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(silent), '-i', str(wav), '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
                    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', str(tmp)], check=True)
    tmp.rename(final)
    (OUT / f'{name}-events.json').write_text(json.dumps([{'t': round(t, 3), 'sfx': s} for t, s in events], ensure_ascii=False, indent=1))
    contact_sheet(final, OUT / f'{name}-sheet.jpg', cfg)
    print('готово:', final)
    print('звуки :', wav, f'({len(events)} событий)')
    print('лист  :', OUT / f'{name}-sheet.jpg')


if __name__ == '__main__':
    main()
