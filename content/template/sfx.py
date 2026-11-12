"""Звуки ролика — синтез кодом (numpy), без чужих сэмплов: мягкие «дорогие» щелчки в духе iPhone.

Восемь звуков: drop (капля), pop (пузырёк), tick (лёгкий щелчок), glass (стекло), air (воздух), air_low (низкий воздух),
pluck (мягкая струна), shutter (затвор — «сохранено»). Всё тихо (пик ≈ −14 dBFS до общей громкости), с короткой «комнатой».
render(events, длительность, путь) пишет WAV 48 кГц стерео; tidy() убирает повтор одного звука подряд и наложения ближе 0,12 с.
"""
import math
import wave
import numpy as np

SR = 48000
NAMES = ['drop', 'pop', 'tick', 'glass', 'air', 'air_low', 'pluck', 'shutter']
# переход сцены → звук по умолчанию
DEFAULT = {'develop': 'glass', 'dissolve': 'air', 'zoom': 'air', 'slide': 'drop', 'flash': 'shutter', 'cut': 'tick'}
# замена при повторе подряд: близкий по характеру
ALT = {'drop': 'pop', 'pop': 'drop', 'tick': 'pluck', 'pluck': 'tick', 'glass': 'pluck', 'air': 'air_low', 'air_low': 'air', 'shutter': 'tick'}
GAIN_DB = {'drop': -1, 'pop': 0, 'tick': -3, 'glass': -6, 'air': -4, 'air_low': -3, 'pluck': -5, 'shutter': -2}


def _t(d):
    return np.arange(int(SR * d)) / SR


def _band(x, lo, hi, rng=None):
    """полосовой фильтр через FFT (мягкие края)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    w = 1 / (1 + (lo / np.maximum(f, 1)) ** 4) / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * w, len(x))


def _env(t, a, d):
    return (1 - np.exp(-t / max(a, 1e-4))) * np.exp(-t / d)


def synth(name, rng):
    if name == 'drop':
        t = _t(0.22)
        f = 520 + 900 * np.exp(-t / 0.028)
        ph = 2 * np.pi * np.cumsum(f) / SR
        y = np.sin(ph) * _env(t, 0.0015, 0.055) + 0.25 * np.sin(2.4 * ph) * _env(t, 0.001, 0.025)
    elif name == 'pop':
        t = _t(0.18)
        f = 140 + 260 * np.exp(-t / 0.018)
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(t, 0.001, 0.045)
        n = _band(rng.standard_normal(len(t)), 800, 3000) * _env(t, 0.0003, 0.004)
        y = y + 0.4 * n / (np.abs(n).max() + 1e-9)
    elif name == 'tick':
        t = _t(0.09)
        n = _band(rng.standard_normal(len(t)), 2200, 6000) * _env(t, 0.0002, 0.0035)
        y = 0.8 * n / (np.abs(n).max() + 1e-9) + 0.5 * np.sin(2 * np.pi * 2650 * t) * _env(t, 0.0005, 0.012)
    elif name == 'glass':
        t = _t(0.9)
        y = sum(a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * _env(t, 0.002, d)
                for f, a, d in ((1568, 0.55, 0.32), (2349, 0.3, 0.22), (3136, 0.18, 0.14), (4699, 0.08, 0.08)))
    elif name in ('air', 'air_low'):
        d = 0.55 if name == 'air' else 0.65
        t = _t(d)
        lo, hi = (900, 5200) if name == 'air' else (250, 1500)
        n = _band(rng.standard_normal(len(t)), lo, hi)
        u = t / d
        env = np.where(u < 0.65, np.sin(np.pi / 2 * u / 0.65) ** 2, np.cos(np.pi / 2 * (u - 0.65) / 0.35) ** 2)
        y = n / (np.abs(n).max() + 1e-9) * env
    elif name == 'pluck':
        p = int(SR / 587)
        buf = rng.uniform(-1, 1, p)
        buf = np.convolve(buf, np.ones(6) / 6, mode='same')
        out = np.zeros(int(SR * 0.7))
        for i in range(len(out)):
            out[i] = buf[i % p]
            buf[i % p] = 0.4985 * (buf[i % p] + buf[(i + 1) % p])
        t = _t(0.7)[: len(out)]
        y = _band(out, 200, 4000) * _env(t, 0.001, 0.25)
    elif name == 'shutter':
        t = _t(0.16)
        y = np.zeros(len(t))
        for at, k, lo in ((0.0, 1.0, 1800), (0.065, 0.7, 1100)):
            i0 = int(at * SR)
            tt = t[: len(t) - i0]
            n = _band(rng.standard_normal(len(tt)), lo, 5000) * _env(tt, 0.0003, 0.006)
            y[i0:] += k * n / (np.abs(n).max() + 1e-9)
    else:
        raise ValueError('нет звука ' + name)
    y = y / (np.abs(y).max() + 1e-9)
    return y * 10 ** ((-14 + GAIN_DB.get(name, 0)) / 20)


def tidy(events, min_gap=0.12):
    """сортировка, слияние почти одновременных, без одного звука два раза подряд."""
    ev = sorted((max(0.0, t), n) for t, n in events if n and n != 'none')
    out = []
    for t, n in ev:
        if out and t - out[-1][0] < min_gap:
            continue
        if out and out[-1][1] == n:
            n = ALT.get(n, n)
            if out[-1][1] == n:
                n = NAMES[(NAMES.index(n) + 3) % len(NAMES)]
        out.append((t, n))
    return out


def _room(rng, d=0.7):
    t = _t(d)
    ir = rng.standard_normal((2, len(t))) * np.exp(-t / 0.18)
    ir = np.stack([_band(c, 300, 7000) for c in ir])
    ir[:, 0] = 0
    return ir / np.abs(ir).sum(axis=1, keepdims=True) * 18


def render(events, total, path, seed=7):
    rng = np.random.default_rng(seed)
    n = int(SR * (total + 0.05))
    dry = np.zeros(n + SR)
    bank = {}
    for t, name in events:
        if name not in bank:
            bank[name] = synth(name, np.random.default_rng(seed + NAMES.index(name)))
        y = bank[name]
        i0 = int(t * SR)
        dry[i0:i0 + len(y)] += y[: max(0, len(dry) - i0)]
    ir = _room(rng)
    L = len(dry) + ir.shape[1]
    nfft = 1 << (L - 1).bit_length()
    D = np.fft.rfft(dry, nfft)
    wet = np.stack([np.fft.irfft(D * np.fft.rfft(c, nfft), nfft)[: len(dry)] for c in ir])
    mix = np.stack([dry, dry]) * 0.86 + wet * 0.2
    mix = mix[:, :n]
    # мягкое затухание в конце и потолок −3 dBFS
    fade = int(0.04 * SR)
    mix[:, -fade:] *= np.linspace(1, 0, fade)
    peak = np.abs(mix).max()
    if peak > 0.708:
        mix *= 0.708 / peak
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
