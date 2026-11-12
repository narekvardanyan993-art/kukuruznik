import { Easing, interpolate, spring } from 'remotion';

// Кривые сайта (engine/page.html :root, docs/ANIMATION.md)
export const IOS = Easing.bezier(0.32, 0.72, 0, 1);   // шторки, крупные сдвиги
export const OUT = Easing.bezier(0.16, 1, 0.3, 1);    // появление мелочей
export const IN = Easing.bezier(0.4, 0, 0.9, 0.3);    // уход (короткий разгон)
export const INOUT = Easing.bezier(0.45, 0.05, 0.25, 1);

export const INK = '#2a2420';
export const ACCENT = '#8a2c33';
export const INDIGO = '#2d3f5e';
export const SURFACE = '#fbf6ea';
export const SHADOW = 'rgba(42, 36, 32, %a)';
export const sh = (a: number) => SHADOW.replace('%a', String(a));

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0→1 по кривой на отрезке [t0, t0+d] (секунды) */
export const seg = (t: number, t0: number, d: number, ease = OUT) =>
  ease(clamp01((t - t0) / Math.max(d, 1e-6)));

/** пружина: время в секундах от старта, с лёгким перелётом */
export const spr = (t: number, fps: number, bounce: 'soft' | 'pop' | 'card' = 'pop') => {
  if (t <= 0) return 0;
  const cfg = bounce === 'card'
    ? { damping: 15, stiffness: 120, mass: 0.9 }
    : bounce === 'soft'
      ? { damping: 18, stiffness: 140, mass: 0.8 }
      : { damping: 11, stiffness: 190, mass: 0.7 };
  return spring({ frame: t * fps, fps, config: cfg });
};

export const mix = (t: number, a: number[], b: number[]) =>
  interpolate(t, a, b, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

/** Единая мягкая тень (отзыв Нарека: «мягкие тени везде — дорого»).
 *  lift 0 — лежит на бумаге, 1 — поднят над ней (во время входа). Три слоя: контакт, мягкая, дальняя. */
export const soft = (lift = 0, k = 1) => [
  `0 ${1 + 2 * lift}px ${2 + 3 * lift}px ${sh(0.16 * k)}`,
  `0 ${7 + 9 * lift}px ${20 + 18 * lift}px ${sh(0.24 * k)}`,
  `0 ${20 + 34 * lift}px ${54 + 46 * lift}px -${10}px ${sh(0.2 * k)}`,
].join(', ');
/** та же тень для svg и вырезок (filter: drop-shadow) */
export const softDrop = (lift = 0, k = 1) =>
  `drop-shadow(0 ${1 + 2 * lift}px ${1.5 + 2 * lift}px ${sh(0.18 * k)}) drop-shadow(0 ${6 + 8 * lift}px ${9 + 8 * lift}px ${sh(0.24 * k)})`;
/** тень букв: тонкий светлый край сверху + мягкая тень под строкой */
export const softText = `0 1px 0 rgba(255,253,246,0.85), 0 2px 3px ${sh(0.16)}, 0 8px 20px ${sh(0.24)}`;

/** «Капля» (отзыв Нарека на pogos-03): появление 0 → 1,12 → 0,96 → 1 за 0,25 с с лёгким вздрагиванием —
 *  пока растёт, капля чуть вытянута; на перелёте сплющена (шире и ниже), на отскоке снова вытянута.
 *  Уход так же быстрый: 0,18 с — короткий вдох (1 → 1,07), потом схлопывается в точку.
 *  t — секунды от начала появления; out — секунды от начала ухода (< 0 — ухода ещё нет). */
export const DROP_IN = 0.25;
export const DROP_OUT = 0.18;
const dropScale = (t: number) => {
  if (t <= 0) return 0;
  if (t < 0.11) return 1.12 * OUT(t / 0.11);
  if (t < 0.18) return lerp(1.12, 0.96, INOUT((t - 0.11) / 0.07));
  if (t < DROP_IN) return lerp(0.96, 1, INOUT((t - 0.18) / (DROP_IN - 0.18)));
  return 1;
};
export const drop = (t: number, out = -1, squash = 0.3) => {
  let s = dropScale(t);
  let o = clamp01(t / 0.05);
  let y = t < 0.11 ? lerp(-18, 0, OUT(clamp01(t / 0.11))) : 0;   // чуть «падает» на место
  if (out >= 0) {
    const u = clamp01(out / DROP_OUT);
    s *= u < 0.28 ? lerp(1, 1.07, OUT(u / 0.28)) : lerp(1.07, 0, IN((u - 0.28) / 0.72));
    o *= 1 - clamp01((u - 0.55) / 0.45);
    y -= 10 * u;
  }
  const k = out >= 0 ? 0 : squash * (s - 1);   // у ухода без сплющивания
  return { s, sx: s * (1 + k), sy: s * (1 - k), o, y, alive: t >= 0 && (out < 0 || out <= DROP_OUT + 0.01) };
};
