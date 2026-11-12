import React from 'react';
import { Composition } from 'remotion';
import { Promo, PromoProps } from './Promo';

const empty: PromoProps = {
  fps: 30, width: 1080, height: 1920, durationInFrames: 30, safe: [250, 600, 160],
  bg: { paper: '', grid: 60 }, fonts: [], cards: [], items: [], shakes: [],
};

export const Root: React.FC = () => (
  <Composition
    id="promo"
    component={Promo as any}
    defaultProps={empty as any}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={30}
    calculateMetadata={({ props }: any) => ({
      durationInFrames: props.durationInFrames,
      fps: props.fps,
      width: props.width,
      height: props.height,
    })}
  />
);
