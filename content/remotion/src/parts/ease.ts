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
