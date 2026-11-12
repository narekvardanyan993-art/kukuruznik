import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

/** Лист бумаги в клетку: бумага сайта (engine/paper), тетрадная сетка, медленный дрейф, виньетка. */
export const Paper: React.FC<{ paper: string; grid: number }> = ({ paper, grid }) => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = f / fps;
  // дрейф от времени, не от номера кадра; без округления
  const dx = Math.sin(t * 0.21) * 14 + t * 3.2;
  const dy = Math.cos(t * 0.17) * 10 + t * 2.1;
  const rot = Math.sin(t * 0.11) * 0.35;
  const g = grid;
  const minor = 'rgba(45, 63, 94, 0.13)';
  const major = 'rgba(45, 63, 94, 0.22)';
  return (
    <AbsoluteFill style={{ background: '#efe2c6', overflow: 'hidden' }}>
      {paper ? (
        <Img
          src={staticFile(paper)}
          style={{
            position: 'absolute', left: -80, top: -80, width: width + 160, height: height + 160,
            objectFit: 'cover', opacity: 0.85,
            transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1.04) rotate(${rot}deg)`,
          }}
        />
      ) : null}
      {/* сетка: тонкая клетка + каждая пятая линия плотнее */}
      <div
        style={{
          position: 'absolute', left: -2 * g * 5, top: -2 * g * 5, width: width + 4 * g * 5, height: height + 4 * g * 5,
          transform: `translate(${dx % (g * 5)}px, ${dy % (g * 5)}px) rotate(${rot}deg)`,
          backgroundImage: [
            `linear-gradient(${major} 2px, transparent 2px)`,
            `linear-gradient(90deg, ${major} 2px, transparent 2px)`,
            `linear-gradient(${minor} 1.2px, transparent 1.2px)`,
            `linear-gradient(90deg, ${minor} 1.2px, transparent 1.2px)`,
          ].join(','),
          backgroundSize: `${g * 5}px ${g * 5}px, ${g * 5}px ${g * 5}px, ${g}px ${g}px, ${g}px ${g}px`,
          mixBlendMode: 'multiply',
        }}
      />
      {/* поля тетради: красная линия слева */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 96 + Math.sin(t * 0.21) * 3, width: 2, background: 'rgba(138, 44, 51, 0.22)' }} />
      {/* виньетка */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse 75% 62% at 50% 46%, rgba(0,0,0,0) 55%, rgba(60, 40, 22, 0.32) 100%)',
        }}
      />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(255,250,236,0.25), rgba(255,250,236,0) 30%, rgba(42,36,32,0.06) 100%)` }} />
    </AbsoluteFill>
  );
};
