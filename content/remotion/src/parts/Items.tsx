import React from 'react';
import { ACCENT, DROP_OUT, IN, INDIGO, INK, OUT, SURFACE, clamp01, drop, lerp, mix, seg, sh, soft, softDrop, softText, spr } from './ease';

// Всё ниже — графика интерфейса (бирки, значки, штамп) в стиле сайта: бумага, тень, карандашный контур.
// Значки луны и снежинки — те же контуры, что на кнопках просмотрщика (engine/page.html),
// штамп — почтовый штемпель главной (index.html, .hero-postmark).

export type Word = { s: string; at: number };
export type ItemP = {
  kind: 'tag' | 'icon' | 'tap' | 'stamp' | 'counter' | 'dot' | 'chip' | 'ruler' | 'sfx';
  id: string; at: number; dur: number; x: number; y: number; rot: number; size: number;
  on?: string;               // id карточки: элемент едет вместе с ней (x, y — доли карточки)
  words?: Word[]; variant?: 'tag' | 'label' | 'big';
  name?: 'moon' | 'flake' | 'bulb' | 'sun' | 'sunset';
  top?: string; mid?: string; bottom?: string;
  from?: string; to?: string; tick?: number; label?: string;
  impact?: number; paper?: boolean;
  text?: string;             // chip: год, число или знак (→ ? × ✓)
  pin?: boolean;             // x, y (и x2, y2) — доли КАДРА ИСТОЧНИКА внутри карточки: точка едет с камерой карточки
  x2?: number; y2?: number; n?: number; step?: number;   // ruler: куда, сколько кусочков, шаг
};

const FONT = '"Chka Serif", "Noto Serif", Georgia, serif';

/** Общая огибающая «капля» (ease.ts → drop): вход 0,25 с с перелётом и сплющиванием, уход 0,18 с. */
const env = (it: ItemP, T: number, _fps?: number) => {
  const t = T - it.at;
  const out = it.dur > 0 ? t - (it.dur - DROP_OUT) : -1;
  const D = drop(t, out >= 0 ? out : -1);
  return { t, D, p: clamp01(t / 0.25), alive: D.alive };
};
const dropTf = (D: ReturnType<typeof drop>, rot: number) =>
  `translateY(${D.y}px) rotate(${rot}deg) scale(${D.sx}, ${D.sy})`;

/** Карандашный контур: два чуть смещённых дрожащих штриха. */
const PencilBox: React.FC<{ r: number; color?: string; w?: number }> = ({ r, color = INK, w = 2.4 }) => (
  <svg style={{ position: 'absolute', inset: 4, width: 'calc(100% - 8px)', height: 'calc(100% - 8px)', overflow: 'visible' }}>
    <rect x="0" y="0" width="100%" height="100%" rx={r} fill="none" stroke={color} strokeOpacity={0.78} strokeWidth={w} filter="url(#pencil)" />
    <rect x="1.5" y="-1" width="100%" height="100%" rx={r} fill="none" stroke={color} strokeOpacity={0.32} strokeWidth={w * 0.6} filter="url(#pencil2)" />
  </svg>
);

const paperBg = `linear-gradient(170deg, #fffdf6 0%, ${SURFACE} 55%, #f3e9d3 100%)`;
// единая мягкая тень — ease.ts (soft / softDrop / softText)
const paperShadow = (lift = 0) => `0 1px 0 rgba(255,255,255,0.75) inset, ${soft(lift)}`;
const textShadow = softText;

// ---------- бирка / ярлык со словами ----------
export const Tag: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T, fps }) => {
  const { t, D, p, alive } = env(it, T, fps);
  if (!alive) return null;
  const big = it.variant === 'big';
  const tag = it.variant !== 'label' && !big;
  const fs = it.size;
  const r = lerp(it.rot - 6, it.rot, OUT(p)) + Math.sin((T - it.at) * 2.1) * 0.6;
  const color = big ? ACCENT : INK;
  const under = big ? seg(t, 0.25 + 0.07 * (it.words?.length ?? 1), 0.5, OUT) : 0;
  return (
    <div style={{
      position: 'absolute', left: it.x, top: it.y,
      transform: `translate(-50%, -50%) ${dropTf(D, r)}`,
      opacity: D.o,
    }}>
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
        padding: big ? `${fs * 0.12}px ${fs * 0.34}px ${fs * 0.16}px` : `${fs * 0.34}px ${fs * 0.5}px ${fs * 0.38}px ${tag ? fs * 0.95 : fs * 0.5}px`,
        background: paperBg, borderRadius: big ? fs * 0.1 : fs * 0.16,
        boxShadow: paperShadow(1 - clamp01(p)),
        // у бирки срезанный «носик» слева
        clipPath: tag ? `polygon(${fs * 0.42}px 0, 100% 0, 100% 100%, ${fs * 0.42}px 100%, 0 50%)` : undefined,
      }}>
        <PencilBox r={big ? fs * 0.08 : fs * 0.12} />
        {tag ? (
          <svg width={fs * 0.4} height={fs * 0.4} style={{ position: 'absolute', left: fs * 0.36, top: '50%', marginTop: -fs * 0.2, overflow: 'visible' }}>
            <circle cx={fs * 0.2} cy={fs * 0.2} r={fs * 0.12} fill="#e2d4b6" stroke={INK} strokeOpacity={0.7} strokeWidth={2.2} filter="url(#pencil)" />
            <circle cx={fs * 0.2} cy={fs * 0.2} r={fs * 0.055} fill="#7d6f5c" />
          </svg>
        ) : null}
        {(it.words ?? []).map((w, i) => {
          const pw = clamp01(drop(T - w.at, -1, 0).s);
          return (
            <span key={i} style={{
              display: 'inline-block', marginRight: i < (it.words!.length - 1) ? fs * 0.26 : 0,
              font: `700 ${fs}px/1.12 ${FONT}`, color, letterSpacing: big ? '0.01em' : '-0.005em',
              textShadow, opacity: clamp01(pw * 2.5),
              transform: `translateY(${lerp(fs * 0.45, 0, pw)}px) scale(${lerp(0.6, 1, pw)}) rotate(${lerp(-6, 0, pw)}deg)`,
              transformOrigin: '50% 80%',
            }}>{w.s}</span>
          );
        })}
        {big ? (
          <svg style={{ position: 'absolute', left: fs * 0.3, right: fs * 0.3, bottom: fs * 0.12, height: fs * 0.16, width: `calc(100% - ${fs * 0.6}px)`, overflow: 'visible' }} viewBox="0 0 100 10" preserveAspectRatio="none">
            <path d="M1 6 C 25 3, 60 9, 99 4" fill="none" stroke={ACCENT} strokeWidth={5} strokeOpacity={0.85} strokeLinecap="round"
              pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - under} />
          </svg>
        ) : null}
      </div>
    </div>
  );
};

// ---------- значок в бумажном кружке ----------
const ICONS: Record<string, (k: number) => React.ReactNode> = {
  moon: () => (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.5 24.5a9 9 0 1 1-6.8-17 7.2 7.2 0 0 0 6.8 17z" fill="rgba(222, 182, 92, 0.45)" stroke={INK} strokeWidth={1.5} />
      <path d="M23.5 7.5v3M22 9h3" stroke={INK} strokeWidth={1.3} />
      <path d="M26 15v2.2M24.9 16.1h2.2" stroke={INK} strokeWidth={1.3} />
    </g>
  ),
  flake: () => (
    <g fill="none" stroke={INDIGO} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 5.5v21M6.9 10.75l18.2 10.5M6.9 21.25l18.2-10.5M13.2 7.3L16 9.6l2.8-2.3M13.2 24.7L16 22.4l2.8 2.3M7.6 14.6l3.5-.6-1.3-3.3M24.4 17.4l-3.5.6 1.3 3.3M7.6 17.4l3.5.6-1.3 3.3M24.4 14.6l-3.5-.6 1.3-3.3" />
    </g>
  ),
  sun: () => (
    <g fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="16" cy="16" r="5.6" fill="rgba(236, 186, 80, 0.55)" />
      <path d="M16 4.5v3M16 24.5v3M4.5 16h3M24.5 16h3M7.9 7.9l2.1 2.1M22 22l2.1 2.1M7.9 24.1l2.1-2.1M22 10l2.1-2.1" />
    </g>
  ),
  sunset: () => (
    <g fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 21a6.5 6.5 0 0 1 13 0z" fill="rgba(226, 132, 72, 0.55)" />
      <path d="M5 21h22M8.5 25h15M16 8.5v3M8.2 12.2l2 2M23.8 12.2l-2 2M4.8 17h2.6M24.6 17h2.6" />
    </g>
  ),
  bulb: () => (
    <g fill="none" stroke={INK} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20.5c-2.2-1.6-3.6-4-3.6-6.7a7.6 7.6 0 0 1 15.2 0c0 2.7-1.4 5.1-3.6 6.7v2.5h-8z" fill="rgba(240, 200, 100, 0.5)" />
      <path d="M12.5 25.5h7M13.5 28h5" />
    </g>
  ),
};

export const Icon: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T, fps }) => {
  const { t, D, p, alive } = env(it, T, fps);
  if (!alive) return null;
  const d = it.size;
  const idle = it.name === 'flake' || it.name === 'sun' ? t * 28 : Math.sin(t * 2.4) * 7;
  const glow = it.name === 'moon' || it.name === 'bulb' || it.name === 'sun' || it.name === 'sunset' ? 0.35 + 0.25 * Math.sin(t * 3.1) : 0;
  return (
    <div style={{
      position: 'absolute', left: it.x - d / 2, top: it.y - d / 2, width: d, height: d,
      transform: dropTf(D, lerp(it.rot - 12, it.rot, OUT(p))),
      opacity: D.o,
    }}>
      {glow ? <div style={{ position: 'absolute', inset: -d * 0.35, borderRadius: '50%', background: `radial-gradient(circle, rgba(250, 214, 120, ${glow}) 0%, rgba(250,214,120,0) 65%)` }} /> : null}
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: paperBg, boxShadow: paperShadow(1 - clamp01(p)) }} />
      <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <circle cx="50" cy="50" r="45" fill="none" stroke={INK} strokeOpacity={0.75} strokeWidth={2} filter="url(#pencil)" />
        <circle cx="51" cy="49" r="41" fill="none" stroke={INK} strokeOpacity={0.25} strokeWidth={1.2} filter="url(#pencil2)" />
      </svg>
      <svg viewBox="0 0 32 32" style={{ position: 'absolute', left: d * 0.18, top: d * 0.18, width: d * 0.64, height: d * 0.64, transform: `rotate(${idle}deg)`, overflow: 'visible' }}>
        <g filter="url(#pencilS)">{ICONS[it.name ?? 'moon'](t)}</g>
      </svg>
    </div>
  );
};

// ---------- кружок «тап» ----------
export const Tap: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T }) => {
  const t = T - it.at;
  if (t < -0.25 || t > 0.95) return null;
  const d = it.size;
  const press = t < 0 ? mix(t, [-0.25, 0], [0, 1]) : 1;
  const down = t < 0 ? lerp(1.25, 1, OUT(press)) : mix(t, [0, 0.08, 0.3], [1, 0.82, 1]);
  const fade = mix(t, [0.55, 0.95], [1, 0]);
  const ring = (k: number) => {
    const u = clamp01((t - k) / 0.6);
    return { s: lerp(0.5, 1.9, OUT(u)), o: (t >= k ? 1 - u : 0) };
  };
  const r1 = ring(0);
  const r2 = ring(0.14);
  return (
    <div style={{ position: 'absolute', left: it.x - d / 2, top: it.y - d / 2, width: d, height: d, opacity: clamp01(press * 2) * fade, filter: softDrop(0.3, 0.8) }}>
      {[r1, r2].map((r, i) => (
        <svg key={i} viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, transform: `scale(${r.s})`, opacity: r.o, overflow: 'visible' }}>
          <circle cx="50" cy="50" r="40" fill="none" stroke="#fffdf6" strokeWidth={7} />
          <circle cx="50" cy="50" r="40" fill="none" stroke={ACCENT} strokeWidth={3} filter="url(#pencil)" />
        </svg>
      ))}
      <div style={{
        position: 'absolute', inset: d * 0.3, borderRadius: '50%', transform: `scale(${down})`,
        background: 'radial-gradient(circle at 40% 35%, rgba(255,253,246,0.6), rgba(251,246,234,0.35))',
        boxShadow: `0 0 0 3px ${ACCENT}, ${soft(0.4)}`,
      }} />
    </div>
  );
};

// ---------- почтовый штемпель ----------
export const Stamp: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T }) => {
  const t = T - it.at;
  const hit = it.impact ?? 0.14;
  if (t < 0) return null;
  const a = clamp01(t / hit);
  const s = t < hit ? lerp(2.1, 1, IN(a)) : 1 + 0.035 * Math.exp(-(t - hit) * 18) * Math.sin((t - hit) * 60);
  const o = t < hit ? lerp(0, 0.6, a) : mix(t - hit, [0, 0.05], [0.95, 0.9]);
  const d = it.size;
  return (
    <div style={{
      position: 'absolute', left: it.x - d * 0.7, top: it.y - d / 2, width: d * 1.4, height: d,
      transform: `rotate(${it.rot + (t < hit ? -8 * (1 - a) : 0)}deg) scale(${s})`, opacity: o,
      mixBlendMode: it.paper ? 'normal' : 'multiply', filter: it.paper ? softDrop(0.5) : `drop-shadow(0 0 1px rgba(251,246,234,0.6)) ${softDrop(0, 0.45)}`,
    }}>
      <svg viewBox="0 0 168 120" style={{ width: '100%', height: '100%', overflow: 'visible', color: ACCENT }}>
        <defs>
          <path id={`pmt-${it.id}`} d="M18 60a42 42 0 0 1 84 0" fill="none" />
          <path id={`pmb-${it.id}`} d="M9 60a51 51 0 0 0 102 0" fill="none" />
        </defs>
        <g filter="url(#ink)">
          <circle cx="60" cy="60" r="54" fill={it.paper ? 'rgba(251,246,234,0.92)' : 'rgba(251,246,234,0.55)'} />
          <g fill="none" stroke="currentColor" strokeLinecap="round">
            <circle cx="60" cy="60" r="54" strokeWidth="4.2" />
            <circle cx="60" cy="60" r="48.5" strokeWidth="1.6" />
            <path d="M22 45h76M22 75h76" strokeWidth="2.4" />
            <path d="M118 43c15-7 31-7 48 0M119 60c15-7 31-7 47 0M118 77c15-7 31-7 48 0" strokeWidth="3" />
          </g>
          <g fill="currentColor" fontFamily="Chka Serif" fontWeight="700">
            <text fontSize="14" letterSpacing="2"><textPath href={`#pmt-${it.id}`} startOffset="50%" textAnchor="middle">{it.top}</textPath></text>
            <text fontSize="14.5" letterSpacing="2.4"><textPath href={`#pmb-${it.id}`} startOffset="50%" textAnchor="middle">{it.bottom}</textPath></text>
            <text x="60" y="70" textAnchor="middle" fontSize="27" letterSpacing="1.5">{it.mid}</text>
          </g>
        </g>
      </svg>
    </div>
  );
};

// ---------- счётчик «8 → 7» / «1930 → 1936» ----------
export const Counter: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T, fps }) => {
  const { t, D, p, alive } = env(it, T, fps);
  if (!alive) return null;
  const fs = it.size;
  // без `to` — счётчик стоит, цифра не щёлкает (места продаются по-настоящему — тогда и щелчок)
  const still = !it.to;
  const k = still ? 0 : spr(t - (it.tick ?? 1), fps, 'pop');      // смена цифры с пружиной
  const flash = still ? 0 : mix(t - (it.tick ?? 1), [0, 0.08, 0.5], [0, 1, 0]);
  const digit = (s: string, y: number, o: number) => (
    <span style={{
      position: 'absolute', left: 0, right: 0, textAlign: 'center',
      transform: `translateY(${y}px)`, opacity: o, font: `700 ${fs}px/1 ${FONT}`, color: ACCENT, textShadow,
    }}>{s}</span>
  );
  const wch = Math.max((it.from ?? '').length, (it.to ?? '').length) * 0.6 + 0.12;
  return (
    <div style={{
      position: 'absolute', left: it.x, top: it.y,
      transform: `translate(-50%, -50%) ${dropTf(D, it.rot)} scale(${1 + 0.06 * flash})`,
      opacity: D.o,
    }}>
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: fs * 0.16, whiteSpace: 'nowrap',
        padding: `${fs * 0.2}px ${fs * 0.36}px`, background: paperBg, borderRadius: fs * 0.14, boxShadow: paperShadow(1 - clamp01(p)),
      }}>
        <PencilBox r={fs * 0.1} />
        <div style={{ position: 'relative', width: fs * wch, height: fs * 1.08, overflow: 'hidden' }}>
          {digit(it.from ?? '', lerp(0, -fs * 1.1, clamp01(k)), 1 - clamp01(k))}
          {still ? null : digit(it.to ?? '', lerp(fs * 1.1, 0, k), clamp01(k * 1.5))}
        </div>
        {it.label ? <span style={{ font: `700 ${fs * 0.5}px/1 ${FONT}`, color: INK, textShadow, transform: `translateY(${fs * 0.04}px)` }}>{it.label}</span> : null}
      </div>
    </div>
  );
};


// ---------- мелочи для микро-ритма: точка и бирка-фишка ----------
// Короткий вход (≈8 кадров, пружина «pop»), короткий уход; идут цепочками (`chain` в сценарии).
const microEnv = env;   // мелочи — тоже каплей (вход 0,25 с, уход 0,18 с)

/** Точка — как «точка интереса» просмотрщика: бумажный кружок с красной сердцевиной и одним кольцом-импульсом. */
export const Dot: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T, fps }) => {
  const { t, D, p, alive } = microEnv(it, T, fps);
  if (!alive) return null;
  const d = it.size;
  const u = clamp01(t / 0.55);
  return (
    <div style={{
      position: 'absolute', left: it.x - d / 2, top: it.y - d / 2, width: d, height: d,
      transform: dropTf(D, 0), opacity: D.o,
    }}>
      <div style={{ position: 'absolute', inset: -d * 0.5, borderRadius: '50%', border: `${Math.max(2, d * 0.06)}px solid ${ACCENT}`,
        transform: `scale(${lerp(0.4, 1, OUT(u))})`, opacity: (1 - u) * 0.7 }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: paperBg, boxShadow: paperShadow(1 - clamp01(p)) }} />
      <div style={{ position: 'absolute', inset: d * 0.27, borderRadius: '50%', background: ACCENT, boxShadow: `inset 0 -2px 3px rgba(0,0,0,0.25)` }} />
    </div>
  );
};

/** Фишка — маленькая бирка из бумаги: год эпохи, число или знак (→ ? × ✓). Падает с поворотом и пружиной. */
export const Chip: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T, fps }) => {
  const { D, p, alive } = microEnv(it, T, fps);
  if (!alive) return null;
  const fs = it.size;
  return (
    <div style={{
      position: 'absolute', left: it.x, top: it.y,
      transform: `translate(-50%, -50%) ${dropTf(D, lerp(it.rot + 8, it.rot, OUT(p)))}`,
      opacity: D.o,
    }}>
      <div style={{
        position: 'relative', whiteSpace: 'nowrap', padding: `${fs * 0.16}px ${fs * 0.34}px ${fs * 0.2}px`,
        background: paperBg, borderRadius: fs * 0.18, boxShadow: paperShadow(1 - clamp01(p)),
        font: `700 ${fs}px/1 ${FONT}`, color: it.variant === 'big' ? ACCENT : INK, textShadow,
      }}>
        <PencilBox r={fs * 0.14} w={1.8} />
        {it.text}
      </div>
    </div>
  );
};

/** Линейка — пунктир из n кусочков от (x, y) к (x2, y2): кусочки падают каплей по одному (шаг step), на каждый — тихий tick;
 *  уходят все вместе быстрой обратной лесенкой. Красная черта с бумажной каймой — читается на любом кадре. */
export const Ruler: React.FC<{ it: ItemP; T: number; fps: number }> = ({ it, T }) => {
  const n = it.n ?? 5, step = it.step ?? 0.09;
  const x2 = it.x2 ?? it.x, y2 = it.y2 ?? it.y;
  const L = Math.hypot(x2 - it.x, y2 - it.y), ang = Math.atan2(y2 - it.y, x2 - it.x) * 180 / Math.PI;
  const th = it.size > 30 ? 10 : it.size * 0.3;     // толщина
  const len = (L / n) * 0.58;
  const t = T - it.at;
  if (t < 0 || (it.dur > 0 && t > it.dur + 0.02)) return null;
  return (
    <>
      {Array.from({ length: n }, (_, k) => {
        const tk = t - k * step;
        const outStart = it.dur > 0 ? it.dur - DROP_OUT - (n - 1 - k) * 0.025 : 1e9;
        const D = drop(tk, t >= outStart ? t - outStart : -1, 0.25);
        if (!D.alive || D.o <= 0) return null;
        const f = (k + 0.5) / n;
        const cx = lerp(it.x, x2, f), cy = lerp(it.y, y2, f);
        return (
          <div key={k} style={{
            position: 'absolute', left: cx - len / 2, top: cy - th / 2, width: len, height: th, borderRadius: th / 2,
            background: ACCENT, opacity: D.o,
            boxShadow: `0 0 0 ${Math.max(2, th * 0.28)}px #fffdf6, ${soft(0.15, 0.7)}`,
            transform: `rotate(${ang}deg) scale(${D.sx}, ${D.sy})`,
          }} />
        );
      })}
    </>
  );
};

export const Item: React.FC<{ it: ItemP; T: number; fps: number }> = (pr) => {
  switch (pr.it.kind) {
    case 'tag': return <Tag {...pr} />;
    case 'icon': return <Icon {...pr} />;
    case 'tap': return <Tap {...pr} />;
    case 'stamp': return <Stamp {...pr} />;
    case 'counter': return <Counter {...pr} />;
    case 'dot': return <Dot {...pr} />;
    case 'chip': return <Chip {...pr} />;
    case 'ruler': return <Ruler {...pr} />;
    default: return null;
  }
};

