import React, { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import { Paper } from './parts/Paper';
import { CardP, CardSeq } from './parts/Card';
import { Item, ItemP } from './parts/Items';

export type PromoProps = {
  fps: number; width: number; height: number; durationInFrames: number;
  safe: [number, number, number];
  bg: { paper: string; grid: number };
  fonts: { family: string; path: string; range: string }[];
  cards: CardP[];
  items: ItemP[];
  shakes: { t: number; amp: number }[];
  showSafe?: boolean;
};

/** Фильтры «карандаш» и «штемпельная краска» — один раз на весь кадр. */
const Defs: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }}>
    <defs>
      <filter id="pencil" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="3" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="pencil2" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="11" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="6" xChannelSelector="G" yChannelSelector="R" />
      </filter>
      <filter id="pencilS" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="1" seed="5" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="0.7" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="ink" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" result="g" />
        <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.55" result="m" />
        <feComposite in="SourceGraphic" in2="m" operator="in" result="s" />
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="9" result="w" />
        <feDisplacementMap in="s" in2="w" scale="3" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs>
  </svg>
);

const useFonts = (fonts: PromoProps['fonts']) => {
  const [h] = useState(() => delayRender('fonts'));
  useEffect(() => {
    Promise.all(fonts.map(async (f) => {
      const ff = new FontFace(f.family, `url(${staticFile(f.path)}) format("woff2")`, { weight: '100 900', unicodeRange: f.range });
      await ff.load();
      (document as any).fonts.add(ff);
    })).then(() => continueRender(h)).catch((e) => { console.error(e); continueRender(h); });
  }, [fonts, h]);
};

export const Promo: React.FC<PromoProps> = (P) => {
  useFonts(P.fonts);
  const g = useCurrentFrame();
  const T = g / P.fps;
  const shakeAt = (frame: number) => {
    const t = frame / P.fps;
    let x = 0, y = 0;
    for (const s of P.shakes) {
      const d = t - s.t;
      if (d < 0 || d > 0.5) continue;
      const e = s.amp * Math.exp(-d * 9);
      x += e * Math.sin(d * 2 * Math.PI * 17);
      y += e * 0.7 * Math.cos(d * 2 * Math.PI * 13);
    }
    return { x, y };
  };
  const sh = shakeAt(g);
  const free = P.items.filter((i) => !i.on);
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Defs />
      <Paper paper={P.bg.paper} grid={P.bg.grid} />
      {P.cards.map((c) => {
        const own = P.items.filter((i) => i.on === c.id).map((i) => ({ ...i, x: i.x * c.w, y: i.y * c.h }));
        return (
          <CardSeq key={c.id} c={c} shake={shakeAt}>
            {own.map((i) => <Item key={i.id} it={i} T={T} fps={P.fps} />)}
          </CardSeq>
        );
      })}
      <AbsoluteFill style={{ transform: `translate(${sh.x * 0.5}px, ${sh.y * 0.5}px)` }}>
        {free.map((i) => <Item key={i.id} it={i} T={T} fps={P.fps} />)}
      </AbsoluteFill>
      {P.showSafe ? (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: P.safe[0], background: 'rgba(255,0,0,0.22)' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: P.safe[1], background: 'rgba(255,0,0,0.22)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: P.safe[2], background: 'rgba(255,0,0,0.22)' }} />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
