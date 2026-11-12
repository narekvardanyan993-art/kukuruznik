import React from 'react';
import { Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { IN, INOUT, OUT, clamp01, lerp, seg, sh, spr } from './ease';

export type Src = {
  kind: 'image' | 'seq' | 'video';
  path: string;          // в public/ (для seq — папка с 0000.jpg …)
  w: number; h: number;  // размер источника
  frames?: number; fps?: number; start?: number; rate?: number;
};
export type CardP = {
  id: string; at: number; dur: number;
  x: number; y: number; w: number; h: number; mat: number; radius: number;
  src: Src; fit: 'cover' | 'contain';
  cam: { from: [number, number, number]; to: [number, number, number]; ease: 'inout' | 'out' | 'linear' };
  look: { sepia?: number; alive?: number };
  rot: number;
  enter: 'depth' | 'up' | 'left' | 'right';
  exit: 'left' | 'right' | 'down' | 'up' | 'depth' | 'none';
  enterDur: number; exitDur: number;
};

/** Внутренность карточки: картинка / кадры сайта / ролик + камера (точка в центре и приближение). */
const Content: React.FC<{ c: CardP; t: number; W: number; H: number }> = ({ c, t, W, H }) => {
  const { fps } = useVideoConfig();
  const k = c.cam.ease === 'linear' ? clamp01(t / c.dur) : (c.cam.ease === 'out' ? OUT : INOUT)(clamp01(t / c.dur));
  const cx = lerp(c.cam.from[0], c.cam.to[0], k);
  const cy = lerp(c.cam.from[1], c.cam.to[1], k);
  const z = lerp(c.cam.from[2], c.cam.to[2], k);
  const s0 = c.fit === 'contain' ? Math.min(W / c.src.w, H / c.src.h) : Math.max(W / c.src.w, H / c.src.h);
  const dw = c.src.w * s0 * z;
  const dh = c.src.h * s0 * z;
  let left = W / 2 - cx * dw;
  let top = H / 2 - cy * dh;
  if (c.fit === 'cover') {
    left = Math.min(0, Math.max(W - dw, left));
    top = Math.min(0, Math.max(H - dh, top));
  }
  const sep = c.look.sepia ?? 0;
  let filter = sep ? `sepia(${sep}) contrast(1.06) brightness(0.98)` : 'none';
  if (c.look.alive) {
    // «оживление»: карандашный серый → цвет
    const a = seg(t, 0.12, c.look.alive, INOUT);
    filter = `grayscale(${1 - a}) contrast(${lerp(1.25, 1, a)}) brightness(${lerp(1.08, 1, a)})`;
  }
  const style: React.CSSProperties = {
    position: 'absolute', left: 0, top: 0, width: dw, height: dh,
    transform: `translate(${left}px, ${top}px)`, filter, maxWidth: 'none',
  };
  if (c.src.kind === 'image') return <Img src={staticFile(c.src.path)} style={style} />;
  if (c.src.kind === 'seq') {
    const n = c.src.frames ?? 1;
    const idx = Math.max(0, Math.min(n - 1, Math.floor(((c.src.start ?? 0) + t * (c.src.rate ?? 1)) * (c.src.fps ?? 30) + 1e-6)));
    return <Img src={staticFile(`${c.src.path}/${String(idx).padStart(4, '0')}.jpg`)} style={style} />;
  }
  return (
    <OffthreadVideo
      src={staticFile(c.src.path)}
      muted
      startFrom={Math.round((c.src.start ?? 0) * fps)}
      playbackRate={c.src.rate ?? 1}
      style={style}
    />
  );
};

/** Положение карточки: вылет с пружиной из глубины → медленное приближение → уход. */
export const cardPose = (c: CardP, t: number, fps: number) => {
  const p = spr(t, fps, 'card');                 // 0→1 с перелётом
  const pIn = clamp01(t / c.enterDur);
  const tx0 = c.enter === 'left' ? -900 : c.enter === 'right' ? 900 : 0;
  const ty0 = c.enter === 'up' ? 700 : c.enter === 'depth' ? 220 : 60;
  const s0 = c.enter === 'depth' ? 0.42 : 0.85;
  const r0 = c.enter === 'left' ? -14 : c.enter === 'right' ? 14 : (c.rot >= 0 ? -9 : 9);
  let x = lerp(tx0, 0, p);
  let y = lerp(ty0, 0, p);
  let s = lerp(s0, 1, p);
  let r = lerp(r0, c.rot, p);
  let o = clamp01(pIn * 3.5);
  let blur = c.enter === 'depth' ? lerp(10, 0, clamp01(pIn * 1.6)) : 0;
  let lift = 1 - clamp01(p);                     // «высота» над столом → тень
  // приближение и лёгкое покачивание, пока карточка лежит
  s *= 1 + 0.035 * INOUT(clamp01(t / c.dur));
  r += Math.sin(t * 1.3 + c.at) * 0.35;
  // уход
  const te = c.dur - c.exitDur;
  if (c.exit !== 'none' && t > te) {
    const q = IN(clamp01((t - te) / c.exitDur));
    if (c.exit === 'depth') {                    // к зрителю: растёт и растворяется
      s *= lerp(1, 1.5, q); o *= 1 - q; blur += 14 * q; lift += 0.6 * q;
    } else {
      const dx = c.exit === 'left' ? -1250 : c.exit === 'right' ? 1250 : 0;
      const dy = c.exit === 'down' ? 1500 : c.exit === 'up' ? -1500 : 120;
      x += dx * q; y += dy * q;
      r += (c.exit === 'left' ? -16 : c.exit === 'right' ? 16 : c.exit === 'down' ? 22 : -10) * q;
      lift += 0.5 * q;
    }
  }
  return { x, y, s, r, o, blur, lift };
};

export const Card: React.FC<{ c: CardP; shake: { x: number; y: number }; children?: React.ReactNode }> = ({ c, shake, children }) => {
  const f = useCurrentFrame();       // локальный кадр: карточка лежит внутри <Sequence>
  const { fps } = useVideoConfig();
  const t = f / fps;
  const P = cardPose(c, t, fps);
  const W = c.w - 2 * c.mat;
  const H = c.h - 2 * c.mat;
  const L = P.lift;
  const shadow = [
    `0 ${2 + 6 * L}px ${4 + 10 * L}px ${sh(0.2)}`,
    `0 ${26 + 60 * L}px ${50 + 70 * L}px -${18 - 6 * L}px ${sh(0.5 - 0.15 * L)}`,
    `0 ${60 + 90 * L}px ${90 + 80 * L}px -40px ${sh(0.3 - 0.1 * L)}`,
  ].join(', ');
  return (
    <div
      style={{
        position: 'absolute', left: c.x - c.w / 2, top: c.y - c.h / 2, width: c.w, height: c.h,
        transform: `translate(${P.x + shake.x}px, ${P.y + shake.y}px) rotate(${P.r}deg) scale(${P.s})`,
        opacity: P.o, filter: P.blur > 0.2 ? `blur(${P.blur}px)` : undefined,
        borderRadius: c.radius, background: '#fffdf7', boxShadow: shadow,
        padding: c.mat, boxSizing: 'border-box', willChange: 'transform',
      }}
    >
      {/* фотобумага: лёгкий тон и край */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: c.radius, boxShadow: `inset 0 0 0 1px ${sh(0.12)}, inset 0 -10px 24px -18px ${sh(0.35)}` }} />
      <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden', borderRadius: Math.max(4, c.radius - c.mat * 0.6), background: '#e9dcc0' }}>
        <Content c={c} t={t} W={W} H={H} />
        <div style={{ position: 'absolute', inset: 0, boxShadow: `inset 0 0 0 1px ${sh(0.18)}, inset 0 0 40px ${sh(0.12)}`, borderRadius: 'inherit' }} />
      </div>
      {/* вложенные элементы (штамп, тап) ездят вместе с карточкой */}
      {children}
    </div>
  );
};

export const CardSeq: React.FC<{ c: CardP; shake: (frameGlobal: number) => { x: number; y: number }; children?: React.ReactNode }> = ({ c, shake, children }) => {
  const { fps } = useVideoConfig();
  const from = Math.round(c.at * fps);
  const g = useCurrentFrame();
  return (
    <Sequence from={from} durationInFrames={Math.round(c.dur * fps)} layout="none" name={`card ${c.id}`}>
      <Card c={c} shake={shake(g)}>{children}</Card>
    </Sequence>
  );
};

