import React from 'react';
import { Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { DROP_OUT, IN, INK, INOUT, IOS, OUT, clamp01, drop, lerp, seg, sh, soft, spr } from './ease';
import { Item, ItemP } from './Items';

export type Src = {
  kind: 'image' | 'seq' | 'video';
  path: string;          // в public/ (для seq — папка с 0000.jpg …)
  w: number; h: number;  // размер источника
  frames?: number; fps?: number; start?: number; rate?: number;
  reverse?: boolean;     // seq задом наперёд (шоу «назад»)
};
export type CardP = {
  id: string; at: number; dur: number;
  x: number; y: number; w: number; h: number; mat: number; radius: number;
  src: Src; fit: 'cover' | 'contain';
  cam: { from: [number, number, number]; to: [number, number, number]; ease: 'inout' | 'out' | 'linear'; keys?: (number | string)[][] };
  keys?: PoseKey[];        // ключи позы карточки (секунды от начала карточки): сдвиг, масштаб, поворот, наклон в 3D
  frame?: 'photo' | 'phone';
  float?: [number, number];  // парение (px по x, y): камера не замирает, даже когда запись стоит
  look: { sepia?: number; alive?: number };
  rot: number;
  enter: 'depth' | 'up' | 'left' | 'right' | 'soft';
  exit: 'left' | 'right' | 'down' | 'up' | 'depth' | 'into' | 'soft' | 'none';
  calm?: boolean;          // без покачивания: карточка лежит ровно («дорогой» спокойный кадр)
  enterDur: number; exitDur: number;
  // «до / после» шторкой: вторая картинка поверх первой, видна слева от ручки; ручка едет по ключам [t, доля x, кривая?]
  compare?: { path: string; w: number; h: number; cam: [number, number, number]; keys: (number | string)[][]; show: number;
    rect?: [number, number, number, number]; hide?: number };   // rect — доли экрана, где идёт шторка (внутри телефона — без адресной строки); hide — когда ручка уходит
};

export type PoseKey = { t: number; x?: number; y?: number; s?: number; r?: number; rx?: number; ry?: number; e?: string };
// кривая отрезка «предыдущий ключ → этот»: inout (по умолчанию), in — разгон до склейки (камера не замирает перед стыком),
// out — торможение после склейки, lin — ровно
const EASE: Record<string, (x: number) => number> = { inout: INOUT, in: IN, out: OUT, lin: (x) => x };

/** Значение по ключам [t, ...v]: между ключами — плавно (inout), до первого и после последнего — держится. */
export const keyed = <K extends { t: number; e?: string }>(keys: K[], t: number, get: (k: K) => number) => {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return get(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      return lerp(get(a), get(b), (EASE[b.e ?? 'inout'] ?? INOUT)(clamp01((t - a.t) / Math.max(1e-6, b.t - a.t))));
    }
  }
  return get(keys[keys.length - 1]);
};

/** Камера карточки в момент t → где лежит картинка источника внутри окна W×H (left, top, ширина, высота, приближение).
 *  Её же берут «приколотые» элементы (pin): точка источника (fx, fy) → окно: left + fx·dw, top + fy·dh. */
export const camMap = (c: CardP, t: number, W: number, H: number) => {
  let cx: number, cy: number, z: number;
  if (c.cam.keys?.length) {
    const K = c.cam.keys.map(([kt, a, b, zz, e]) => ({ t: +kt, a: +a, b: +b, zz: +zz, e: e as string | undefined }));
    cx = keyed(K, t, (k) => k.a); cy = keyed(K, t, (k) => k.b); z = keyed(K, t, (k) => k.zz);
  } else {
    const k = c.cam.ease === 'linear' ? clamp01(t / c.dur) : (c.cam.ease === 'out' ? OUT : INOUT)(clamp01(t / c.dur));
    cx = lerp(c.cam.from[0], c.cam.to[0], k);
    cy = lerp(c.cam.from[1], c.cam.to[1], k);
    z = lerp(c.cam.from[2], c.cam.to[2], k);
  }
  const s0 = c.fit === 'contain' ? Math.min(W / c.src.w, H / c.src.h) : Math.max(W / c.src.w, H / c.src.h);
  const dw = c.src.w * s0 * z;
  const dh = c.src.h * s0 * z;
  let left = W / 2 - cx * dw;
  let top = H / 2 - cy * dh;
  if (c.fit === 'cover') {
    left = Math.min(0, Math.max(W - dw, left));
    top = Math.min(0, Math.max(H - dh, top));
  }
  return { left, top, dw, dh, z };
};

/** Кадр источника seq в момент t: индексы двух соседних кадров и доля второго (для смешивания при rate ≠ 1). */
const seqAt = (c: CardP, t: number) => {
  const n = c.src.frames ?? 1;
  let fi = ((c.src.start ?? 0) + t * (c.src.rate ?? 1)) * (c.src.fps ?? 30);
  fi = Math.max(0, Math.min(n - 1, fi + 1e-6));
  if (c.src.reverse) fi = n - 1 - fi;
  const i0 = Math.floor(fi);
  return { i0, i1: Math.min(n - 1, i0 + 1), fr: fi - i0 };
};
const seqUrl = (c: CardP, i: number) => staticFile(`${c.src.path}/${String(i).padStart(4, '0')}.jpg`);

/** Шторка «до / после»: картинка compare поверх основной, обрезана по ручке; ручка — бумажная черта с кружком ‹ ›. */
const Compare: React.FC<{ c: CardP; t: number; W: number; H: number }> = ({ c, t, W: W0, H: H0 }) => {
  const k = c.compare!;
  const R = k.rect ?? [0, 0, 1, 1];
  const W = (R[2] - R[0]) * W0, H = (R[3] - R[1]) * H0;
  if (k.hide !== undefined && t > k.hide + 0.25) return null;
  const K = k.keys.map(([kt, hx, e]) => ({ t: +kt, v: +hx, e: e as string | undefined }));
  const hx = keyed(K, t, (q) => q.v);
  const fake = { ...c, src: { ...c.src, w: k.w, h: k.h }, fit: 'cover' as const, cam: { from: k.cam, to: k.cam, ease: 'inout' as const } };
  const { left, top, dw, dh } = camMap(fake as CardP, 0, W, H);
  const D = drop(t - k.show, k.hide !== undefined && t >= k.hide ? t - k.hide : -1);
  const knob = 76;
  return (
    <div style={{ position: 'absolute', left: R[0] * W0, top: R[1] * H0, width: W, height: H, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - hx) * 100}% 0 0)` }}>
        <Img src={staticFile(k.path)} style={{ position: 'absolute', left, top, width: dw, height: dh, maxWidth: 'none' }} />
      </div>
      {t >= k.show ? (
        <div style={{ position: 'absolute', left: hx * W, top: 0, height: H, width: 0, opacity: D.o }}>
          <div style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, background: '#fffdf6', boxShadow: soft(0.2, 0.8), transform: `scaleY(${clamp01(D.s)})` }} />
          <div style={{
            position: 'absolute', left: -knob / 2, top: H / 2 - knob / 2, width: knob, height: knob, borderRadius: '50%',
            background: 'linear-gradient(170deg, #fffdf6 0%, #fbf6ea 60%, #f3e9d3 100%)', boxShadow: soft(0.4),
            transform: `translateY(${D.y}px) scale(${D.sx}, ${D.sy})`,
          }}>
            <svg viewBox="0 0 76 76" style={{ position: 'absolute', inset: 0 }}>
              <circle cx="38" cy="38" r="34" fill="none" stroke={INK} strokeOpacity={0.7} strokeWidth={2.2} filter="url(#pencil)" />
              <path d="M30 27 L20 38 L30 49 M46 27 L56 38 L46 49" fill="none" stroke={INK} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** Лупа: круг поверх точки источника (pin), внутри — тот же кадр крупнее в mag раз. Входит и уходит каплей. */
const Loupe: React.FC<{ c: CardP; t: number; it: ItemP; W: number; H: number }> = ({ c, t, it, W, H }) => {
  const T = c.at + t;
  const ti = T - it.at;
  const out = it.dur > 0 ? ti - (it.dur - 0.2) : -1;
  // крупный предмет — без отскока (SKILL §4): растёт по easeOut 0,3 с, уходит по easeIn 0,2 с; монотонно, без «стоп-кадров» на развороте
  if (ti < 0 || (it.dur > 0 && ti > it.dur)) return null;
  const pin = OUT(clamp01(ti / 0.3)), pout = out >= 0 ? IN(clamp01(out / 0.2)) : 0;
  const sc = lerp(0.55, 1, pin) * lerp(1, 0.6, pout);
  const D = { o: clamp01(ti / 0.12) * (1 - pout), y: lerp(14, 0, pin), sx: sc, sy: sc };
  const m = camMap(c, t, W, H);
  const fx = it.x, fy = it.y;
  const d = it.size, mag = it.mag ?? 2;
  const X = c.mat + m.left + fx * m.dw, Y = c.mat + m.top + fy * m.dh;
  const iw = m.dw * mag, ih = m.dh * mag;
  const img = c.src.kind === 'seq' ? seqUrl(c, seqAt(c, t).i0) : staticFile(c.src.path);
  // лёгкое «дыхание» стекла, пока лупа лежит
  const br = 1 + 0.012 * Math.sin(ti * 3.2);
  return (
    <div style={{ position: 'absolute', left: X - d / 2, top: Y - d / 2, width: d, height: d, opacity: D.o,
      transform: `translateY(${D.y}px) scale(${D.sx * br}, ${D.sy * br})`, zIndex: 5 }}>
      {/* ручка лупы */}
      <div style={{ position: 'absolute', left: d * 0.8, top: d * 0.8, width: d * 0.16, height: d * 0.42, borderRadius: d * 0.06,
        background: 'linear-gradient(90deg, #4a3a2c, #2f251d)', transform: 'rotate(-45deg)', transformOrigin: '50% 0', boxShadow: soft(0.3) }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', background: '#e9dcc0',
        boxShadow: `0 0 0 ${d * 0.035}px #fbf6ea, 0 0 0 ${d * 0.05}px ${sh(0.55)}, ${soft(0.6, 1.2)}` }}>
        <Img src={img} style={{ position: 'absolute', left: d / 2 - fx * iw, top: d / 2 - fy * ih, width: iw, height: ih, maxWidth: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.28), rgba(255,255,255,0) 45%)', boxShadow: `inset 0 0 ${d * 0.08}px ${sh(0.35)}` }} />
      </div>
    </div>
  );
};

/** Внутренность карточки: картинка / кадры сайта / ролик + камера (точка в центре и приближение). */
const Content: React.FC<{ c: CardP; t: number; W: number; H: number }> = ({ c, t, W, H }) => {
  const { fps } = useVideoConfig();
  const { left, top, dw, dh, z } = camMap(c, t, W, H);
  const sep = c.look.sepia ?? 0;
  let filter = sep ? `sepia(${sep}) contrast(1.06) brightness(0.98)` : 'none';
  if (c.look.alive) {
    // «оживление»: карандашный серый → цвет
    const a = seg(t, 0.12, c.look.alive, INOUT);
    filter = `grayscale(${1 - a}) contrast(${lerp(1.25, 1, a)}) brightness(${lerp(1.08, 1, a)})`;
  }
  // Размер картинки постоянный (z = 1), приближение — только transform: scale. Если менять width каждый кадр,
  // Chrome пересэмплирует картинку в целый размер и сдвигает её ступеньками (0,25 → 0,05 → 0,2 px за кадр) —
  // на наезде это видно как «20 кадров в секунду».
  const style: React.CSSProperties = {
    position: 'absolute', left: 0, top: 0, width: dw / z, height: dh / z,
    transform: `translate(${left}px, ${top}px) scale(${z})`, transformOrigin: '0 0', filter, maxWidth: 'none',
  };
  if (c.src.kind === 'image') return <Img src={staticFile(c.src.path)} style={style} />;
  if (c.src.kind === 'seq') {
    // Кадр сайта = кадр ролика (30 к/с, rate 1). rate ≠ 1 — не повторять кадр (рывок «как 20 к/с»),
    // а смешивать два соседних: дробная часть индекса = прозрачность следующего.
    const { i0, i1, fr } = seqAt(c, t);
    const url = (i: number) => seqUrl(c, i);
    return (
      <>
        <Img src={url(i0)} style={style} />
        {fr > 0.02 && i1 !== i0 ? <Img src={url(i1)} style={{ ...style, opacity: fr }} /> : null}
      </>
    );
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
  if (c.enter === 'soft') {
    // «дорогой» вход (как появление окна в iOS): без вылета и отскока — проявляется на месте, чуть снизу,
    // из лёгкого размытия и 95,5 % размера; кривая iOS: быстрый старт, долгое мягкое торможение
    const q = IOS(pIn);
    x = 0; y = lerp(46, 0, q); s = lerp(0.955, 1, q); r = c.rot;
    o = clamp01(t / (c.enterDur * 0.55)); blur = lerp(14, 0, clamp01(t / (c.enterDur * 0.7))); lift = 1 - q;
  }
  // приближение и лёгкое покачивание, пока карточка лежит
  s *= 1 + 0.035 * INOUT(clamp01(t / c.dur));
  if (!c.calm) r += Math.sin(t * 1.3 + c.at) * 0.35;
  // уход
  const te = c.dur - c.exitDur;
  if (c.exit !== 'none' && t > te) {
    const q = IN(clamp01((t - te) / c.exitDur));
    if (c.exit === 'into') {                     // обратно в экран: уменьшается и растворяется (фото «проваливается» в телефон)
      s *= lerp(1, 0.58, q); o *= 1 - q * q; blur += 6 * q; y += 30 * q; lift += 0.2 * q;
    } else if (c.exit === 'soft') {              // «дорогой» уход: тает на месте — чуть вверх, чуть меньше, в лёгкое размытие (разгон и торможение)
      const e = INOUT(clamp01((t - te) / c.exitDur));
      s *= lerp(1, 0.97, e); o *= 1 - e; blur += 10 * e; y -= 26 * e;
    } else if (c.exit === 'depth') {             // к зрителю: растёт и растворяется
      s *= lerp(1, 1.5, q); o *= 1 - q; blur += 14 * q; lift += 0.6 * q;
    } else {
      const dx = c.exit === 'left' ? -1250 : c.exit === 'right' ? 1250 : 0;
      const dy = c.exit === 'down' ? 1500 : c.exit === 'up' ? -1500 : 120;
      x += dx * q; y += dy * q;
      r += (c.exit === 'left' ? -16 : c.exit === 'right' ? 16 : c.exit === 'down' ? 22 : -10) * q;
      lift += 0.5 * q;
    }
  }
  // парение: два синуса с разными периодами — движение не останавливается ни в один кадр
  if (c.float) {
    x += c.float[0] * Math.sin((2 * Math.PI * t) / 4.3 + 0.7);
    y += c.float[1] * Math.sin((2 * Math.PI * t) / 3.1);
    r += 0.25 * Math.sin((2 * Math.PI * t) / 5.7 + 1.3);
  }
  // ключи позы (финал: телефон наклоняется, отъезжает): поверх входа и ухода
  let rx = 0, ry = 0;
  if (c.keys?.length) {
    x += keyed(c.keys, t, (k) => k.x ?? 0); y += keyed(c.keys, t, (k) => k.y ?? 0);
    s *= keyed(c.keys, t, (k) => k.s ?? 1); r += keyed(c.keys, t, (k) => k.r ?? 0);
    rx = keyed(c.keys, t, (k) => k.rx ?? 0); ry = keyed(c.keys, t, (k) => k.ry ?? 0);
  }
  return { x, y, s, r, o, blur, lift, rx, ry };
};

export const Card: React.FC<{ c: CardP; shake: { x: number; y: number }; items?: ItemP[]; T0?: number; children?: React.ReactNode }> = ({ c, shake, items = [], children }) => {
  const f = useCurrentFrame();       // локальный кадр: карточка лежит внутри <Sequence>
  const { fps } = useVideoConfig();
  const t = f / fps;
  const P = cardPose(c, t, fps);
  const W = c.w - 2 * c.mat;
  const H = c.h - 2 * c.mat;
  const L = P.lift;
  const phone = c.frame === 'phone';
  const shadow = soft(L + (phone ? 0.25 : 0), phone ? 1.35 : 1.25);
  // элементы на карточке: x, y — доли карточки; pin — доли кадра источника (едут с камерой карточки)
  const m = camMap(c, t, W, H);
  const own = items.map((i) => {
    const X = (v: number) => (i.pin ? c.mat + m.left + v * m.dw : v * c.w);
    const Y = (v: number) => (i.pin ? c.mat + m.top + v * m.dh : v * c.h);
    return { ...i, x: X(i.x), y: Y(i.y), ...(i.x2 !== undefined ? { x2: X(i.x2), y2: Y(i.y2 ?? i.y) } : {}) };
  });
  const T = c.at + t;
  const tilt = P.rx || P.ry ? `perspective(2200px) rotateX(${P.rx}deg) rotateY(${P.ry}deg) ` : '';
  return (
    <div
      style={{
        position: 'absolute', left: c.x - c.w / 2, top: c.y - c.h / 2, width: c.w, height: c.h,
        transform: `translate(${P.x + shake.x}px, ${P.y + shake.y}px) ${tilt}rotate(${P.r}deg) scale(${P.s})`,
        opacity: P.o, filter: P.blur > 0.2 ? `blur(${P.blur}px)` : undefined,
        borderRadius: c.radius, background: phone ? 'linear-gradient(160deg, #3a332d 0%, #1f1b18 45%, #2b2520 100%)' : '#fffdf7', boxShadow: shadow,
        padding: c.mat, boxSizing: 'border-box',
        // без will-change: с ним Chrome растрирует карточку один раз в размере входа и растягивает — резкость ×0,45
      }}
    >
      {/* фотобумага: лёгкий тон и край; телефон — тонкий блик по краю рамки */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: c.radius, boxShadow: phone
        ? `inset 0 0 0 1.5px rgba(255,248,235,0.16), inset 0 2px 3px rgba(255,248,235,0.12)`
        : `inset 0 0 0 1px ${sh(0.12)}, inset 0 -10px 24px -18px ${sh(0.35)}` }} />
      <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden', borderRadius: phone ? c.radius - c.mat : Math.max(4, c.radius - c.mat * 0.6), background: '#e9dcc0' }}>
        <Content c={c} t={t} W={W} H={H} />
        {c.compare ? <Compare c={c} t={t} W={W} H={H} /> : null}
        <div style={{ position: 'absolute', inset: 0, boxShadow: phone ? `inset 0 0 0 1px rgba(0,0,0,0.35)` : `inset 0 0 0 1px ${sh(0.18)}, inset 0 0 40px ${sh(0.12)}`, borderRadius: 'inherit' }} />
      </div>
      {/* вложенные элементы (штамп, тап, точки, линейки) ездят вместе с карточкой */}
      {own.filter((i) => i.kind !== 'loupe').map((i) => <Item key={i.id} it={i} T={T} fps={fps} />)}
      {items.filter((i) => i.kind === 'loupe').map((i) => <Loupe key={i.id} c={c} t={t} it={i} W={W} H={H} />)}
      {children}
    </div>
  );
};

export const CardSeq: React.FC<{ c: CardP; shake: (frameGlobal: number) => { x: number; y: number }; items?: ItemP[]; children?: React.ReactNode }> = ({ c, shake, items, children }) => {
  const { fps } = useVideoConfig();
  const from = Math.round(c.at * fps);
  const g = useCurrentFrame();
  return (
    <Sequence from={from} durationInFrames={Math.round(c.dur * fps)} layout="none" name={`card ${c.id}`}>
      <Card c={c} shake={shake(g)} items={items}>{children}</Card>
    </Sequence>
  );
};

