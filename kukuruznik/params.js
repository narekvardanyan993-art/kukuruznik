import * as THREE from 'three';

// ======================== MODEL CONSTANTS ========================
export const R = 1.00, N = 16, F = 14, fh = 0.260, NS = 32;
export const shaftY0 = 0.50;
export const shaftY1 = shaftY0 + F * fh;
export const railY   = shaftY1 + 0.12;
export const neckY   = shaftY1 + 0.21;
export const rimY    = shaftY1 + 0.29;
export const glassY  = shaftY1 + 0.58;
export const capY    = shaftY1 + 0.84;
export const mastY   = shaftY1 + 0.97;
export const rNeck = 0.52, rRim = 0.80, rCap = 0.62;
export const yCenter = (0.0 + capY) * 0.52;
export const loggiaBot = 0.20, loggiaTop = 0.20;

// ======================== COLOR PALETTE ========================
export const C = {
  paper:    '#f5ecda',
  ink:      new THREE.Color(0x2f2a25),
  inkNight: new THREE.Color(0xa8b2ca),
  shaft:    new THREE.Color(242/255, 227/255, 188/255),
  belt:     new THREE.Color(250/255, 244/255, 222/255),
  neck:     new THREE.Color(193/255, 184/255, 162/255),
  glass:    new THREE.Color(74/255, 104/255, 100/255),
  glassLit: new THREE.Color(236/255, 196/255, 118/255),
  flare:    new THREE.Color(146/255, 128/255, 104/255),
  parapet:  new THREE.Color(198/255, 190/255, 170/255),
  rail:     new THREE.Color(180/255, 172/255, 152/255),
  roof:     new THREE.Color(231/255, 224/255, 203/255),
  podium:   new THREE.Color(152/255, 152/255, 157/255),
  deck:     new THREE.Color(186/255, 184/255, 177/255),
  ground:   new THREE.Color(163/255, 189/255, 122/255),
  groundFar:new THREE.Color(198/255, 208/255, 166/255),
  shadow:   new THREE.Color(78/255, 86/255, 124/255),
  cellLit:  new THREE.Color(112/255, 97/255, 73/255),
  cellDrk:  new THREE.Color(64/255, 65/255, 77/255),
  winLit:   new THREE.Color(74/255, 100/255, 102/255),
  winDrk:   new THREE.Color(46/255, 61/255, 74/255),
  balcLit:  new THREE.Color(250/255, 243/255, 222/255),
  balcDrk:  new THREE.Color(187/255, 189/255, 199/255),
};
