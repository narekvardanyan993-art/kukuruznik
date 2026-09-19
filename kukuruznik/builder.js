import * as THREE from 'three';
import { toon, toonGrad3, addOutline, addEdges, seedRng } from '../engine3d/core.js';
import * as P from './params.js';

export function buildShaft() {
  const g = new THREE.Group();
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const { R, F, fh, N, shaftY0, yCenter, C, loggiaBot, loggiaTop, shaftY1, railY } = P;

  const shaftGeo = new THREE.CylinderGeometry(R, R, F * fh, N, F, false);
  const shaftPos = v3(0, shaftY0 + (F * fh) / 2 - yCenter, 0);
  g.add(new THREE.Mesh(shaftGeo, toon(C.shaft)));
  g.children[g.children.length - 1].position.copy(shaftPos);

  addOutline(g, shaftGeo, shaftPos, C.ink, 0.022);
  addEdges(g, shaftGeo, shaftPos, C.ink, 12);

  for (let f = 0; f < F - 1; f++) {
    const yb = shaftY0 + (f + 1) * fh - fh * loggiaTop;
    const yt = shaftY0 + (f + 1) * fh + fh * loggiaBot;
    const h = yt - yb;
    const beltGeo = new THREE.CylinderGeometry(R * 1.008, R * 1.008, h, N, 1, false);
    const pos = v3(0, (yb + yt) / 2 - yCenter, 0);
    const m = new THREE.Mesh(beltGeo, toon(C.belt));
    m.position.copy(pos);
    m.renderOrder = 1;
    g.add(m);
  }

  const pitch = (Math.PI * 2) / N;
  for (let f = 0; f < F; f++) {
    const yb = shaftY0 + f * fh + fh * loggiaBot;
    const yt = shaftY0 + (f + 1) * fh - fh * loggiaTop;
    const rb = R * 0.92;
    const cellH = yt - yb;

    for (let i = 0; i < N; i++) {
      const a0 = i * pitch + pitch * 0.10;
      const a1 = i * pitch + pitch * 0.90;
      const aMid = (a0 + a1) / 2;
      const arcSpan = (a1 - a0) * rb;

      const lg = new THREE.Group();

      const recessW = arcSpan * 0.88;
      const recessH = cellH * 0.80;
      const shape = new THREE.Shape();
      shape.moveTo(-recessW / 2, 0);
      shape.lineTo(-recessW / 2, recessH * 0.55);
      shape.quadraticCurveTo(-recessW / 2, recessH, 0, recessH);
      shape.quadraticCurveTo(recessW / 2, recessH, recessW / 2, recessH * 0.55);
      shape.lineTo(recessW / 2, 0);
      shape.lineTo(-recessW / 2, 0);

      const recessGeo = new THREE.ShapeGeometry(shape, 6);
      const recessMat = toon(C.cellDrk, { alpha: 0.78, grad: toonGrad3 });
      const recessMesh = new THREE.Mesh(recessGeo, recessMat);
      recessMesh.position.set(0, -cellH * 0.38, -0.025);
      lg.add(recessMesh);
      recessMesh.userData.cellRecess = true;

      const winW = recessW * 0.70;
      const winH = recessH * 0.60;
      const winGeo = new THREE.PlaneGeometry(winW, winH);
      const winMat = toon(C.winDrk, { alpha: 0.82, grad: toonGrad3 });
      const winMesh = new THREE.Mesh(winGeo, winMat);
      winMesh.position.set(0, -cellH * 0.15, -0.035);
      lg.add(winMesh);
      winMesh.userData.cellWindow = true;

      const balcW = recessW * 0.92;
      const balcH = cellH * 0.14;
      const balcGeo = new THREE.BoxGeometry(balcW, balcH, 0.035);
      const balcMat = toon(C.balcLit, { alpha: 0.95 });
      const balcMesh = new THREE.Mesh(balcGeo, balcMat);
      balcMesh.position.set(0, -cellH * 0.40, 0.012);
      lg.add(balcMesh);
      balcMesh.userData.cellBalcony = true;

      lg.position.set(
        Math.cos(aMid) * rb,
        (yb + yt) / 2 - yCenter,
        Math.sin(aMid) * rb
      );
      lg.rotation.y = -aMid + Math.PI / 2;
      g.add(lg);
    }
  }

  const deckGeo = new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.03, N, 1, false);
  const deckPos = v3(0, shaftY1 - yCenter + 0.015, 0);
  const deckM = new THREE.Mesh(deckGeo, toon(C.deck));
  deckM.position.copy(deckPos);
  g.add(deckM);

  const railGeo = new THREE.CylinderGeometry(R * 0.99, R, railY - shaftY1, N, 1, false);
  const railPos = v3(0, (shaftY1 + railY) / 2 - yCenter, 0);
  const railM = new THREE.Mesh(railGeo, toon(C.rail));
  railM.position.copy(railPos);
  g.add(railM);
  addEdges(g, railGeo, railPos, C.ink, 15);

  return g;
}

export function buildHead() {
  const g = new THREE.Group();
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const { rNeck, neckY, shaftY1, yCenter, C, NS, rRim, rimY, glassY, capY, mastY, rCap } = P;

  const neckGeo = new THREE.CylinderGeometry(rNeck, rNeck, neckY - shaftY1, NS, 1, false);
  const neckPos = v3(0, (shaftY1 + neckY) / 2 - yCenter, 0);
  g.add(new THREE.Mesh(neckGeo, toon(C.neck)));
  g.children[g.children.length - 1].position.copy(neckPos);

  const flarePts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const r = rNeck + (rRim - rNeck) * (1 - Math.pow(1 - t, 2.5));
    flarePts.push(new THREE.Vector2(r, neckY + (rimY - neckY) * t - yCenter));
  }
  const flareGeo = new THREE.LatheGeometry(flarePts, NS);
  g.add(new THREE.Mesh(flareGeo, toon(C.flare)));
  addOutline(g, flareGeo, v3(0,0,0), C.ink, 0.012);

  const glassGeo = new THREE.CylinderGeometry(rRim, rRim, glassY - rimY, NS, 1, false);
  const glassPos = v3(0, (rimY + glassY) / 2 - yCenter, 0);
  const glassM = new THREE.Mesh(glassGeo, toon(C.glass, { hatch: false }));
  glassM.position.copy(glassPos);
  glassM.userData.isGlass = true;
  g.add(glassM);
  addOutline(g, glassGeo, glassPos, C.ink, 0.016);
  addEdges(g, glassGeo, glassPos, C.ink, 8);

  for (let i = 0; i < NS; i += 2) {
    const ang = (i / NS) * Math.PI * 2;
    const x = Math.cos(ang) * rRim * 1.004;
    const z = Math.sin(ang) * rRim * 1.004;
    const pts = [v3(x, rimY - yCenter, z), v3(x, glassY - yCenter, z)];
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    const lm = new THREE.LineBasicMaterial({
      color: C.ink.clone(), transparent: true, opacity: 0.45
    });
    g.add(new THREE.Line(lg, lm));
  }

  const conePts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const r = rRim + (rCap - rRim) * t;
    conePts.push(new THREE.Vector2(r, glassY + (capY - glassY) * t - yCenter));
  }
  const coneGeo = new THREE.LatheGeometry(conePts, NS);
  g.add(new THREE.Mesh(coneGeo, toon(C.parapet)));
  addOutline(g, coneGeo, v3(0,0,0), C.ink, 0.014);
  addEdges(g, coneGeo, v3(0,0,0), C.ink, 20);

  const crestGeo = new THREE.CylinderGeometry(rCap * 0.94, rCap, mastY - capY, NS, 1, false);
  const crestPos = v3(0, (capY + mastY) / 2 - yCenter, 0);
  g.add(new THREE.Mesh(crestGeo, toon(C.rail)));
  g.children[g.children.length - 1].position.copy(crestPos);
  addEdges(g, crestGeo, crestPos, C.ink, 15);

  const roofGeo = new THREE.CircleGeometry(rCap * 0.94, NS);
  roofGeo.rotateX(-Math.PI / 2);
  const roofPos = v3(0, mastY - yCenter + 0.001, 0);
  g.add(new THREE.Mesh(roofGeo, toon(C.roof)));
  g.children[g.children.length - 1].position.copy(roofPos);

  const innerGeo = new THREE.RingGeometry(rCap * 0.48, rCap * 0.55, NS);
  innerGeo.rotateX(-Math.PI / 2);
  g.add(new THREE.Mesh(innerGeo, toon(C.deck)));
  g.children[g.children.length - 1].position.copy(v3(0, mastY - yCenter + 0.003, 0));

  return g;
}

export function buildGround() {
  const g = new THREE.Group();
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const { yCenter, C, R, shaftY0 } = P;

  const groundGeo = new THREE.CircleGeometry(12, 48);
  groundGeo.rotateX(-Math.PI / 2);
  g.add(new THREE.Mesh(groundGeo, toon(C.ground)));
  g.children[g.children.length - 1].position.y = -yCenter - 0.01;

  const PODX0 = -1.35, PODX1 = 2.30;
  const tiers = [
    { z0: -3.10, z1: 0.15, y0: 0.00, y1: 0.12 },
    { z0: -2.05, z1: 0.15, y0: 0.12, y1: 0.30 },
    { z0: -1.00, z1: 0.15, y0: 0.30, y1: 0.50 },
  ];

  for (const t of tiers) {
    const w = PODX1 - PODX0, d = t.z1 - t.z0, h = t.y1 - t.y0;
    const geo = new THREE.BoxGeometry(w, h, d);
    const pos = v3((PODX0+PODX1)/2, (t.y0+t.y1)/2 - yCenter, (t.z0+t.z1)/2);
    const m = new THREE.Mesh(geo, toon(C.podium));
    m.position.copy(pos);
    g.add(m);
    addEdges(g, geo, pos, C.ink, 15);

    const dg = new THREE.PlaneGeometry(w, d);
    dg.rotateX(-Math.PI / 2);
    const dm = new THREE.Mesh(dg, toon(C.deck));
    dm.position.copy(v3((PODX0+PODX1)/2, t.y1 - yCenter + 0.002, (t.z0+t.z1)/2));
    g.add(dm);
  }

  const shGeo = new THREE.CircleGeometry(R * 1.6, 32);
  shGeo.rotateX(-Math.PI / 2);
  const shM = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({
    color: C.shadow, transparent: true, opacity: 0.18, depthWrite: false
  }));
  shM.position.set(0.3, -yCenter + 0.003, -0.2);
  shM.renderOrder = -1;
  g.add(shM);
  shM.userData.isShadow = true;

  const csGeo = new THREE.RingGeometry(R * 0.85, R * 1.15, 32);
  csGeo.rotateX(-Math.PI / 2);
  const csM = new THREE.Mesh(csGeo, new THREE.MeshBasicMaterial({
    color: C.shadow, transparent: true, opacity: 0.22, depthWrite: false
  }));
  csM.position.set(0, shaftY0 - yCenter + 0.003, 0);
  csM.renderOrder = -1;
  g.add(csM);

  return g;
}

export function setupBuilding(engine) {
  const shaftGroup = buildShaft();
  const headGroup = buildHead();
  const groundGroup = buildGround();
  
  engine.scene.add(shaftGroup, headGroup, groundGroup);

  // Register animation
  engine.onUpdate((time) => {
    headGroup.rotation.y = (time / 1000) * (Math.PI * 2 / 270);
  });

  // Register time-of-day changes specific to Kukuruznik
  engine.onTimeChange((t, night, dusk, lightDir) => {
    const { C } = P;
    const inkR = C.ink.r + (C.inkNight.r - C.ink.r) * night * 0.62;
    const inkG = C.ink.g + (C.inkNight.g - C.ink.g) * night * 0.62;
    const inkB = C.ink.b + (C.inkNight.b - C.ink.b) * night * 0.62;
    const inkC = new THREE.Color(inkR, inkG, inkB);

    engine.scene.traverse(obj => {
      if (obj.userData.outline && obj.material.uniforms) {
        obj.material.uniforms.color.value.copy(inkC);
      }
      if (obj.userData.isEdge && obj.material.color) {
        obj.material.color.copy(inkC);
      }
      if (obj.userData.isGlass && obj.material) {
        const glow = night * 0.9;
        obj.material.color.copy(C.glass.clone().lerp(C.glassLit, glow));
        obj.material.emissive = C.glassLit.clone().multiplyScalar(glow * 0.3);
      }
      if (obj.userData.cellWindow && obj.material && night > 0.15) {
        const rng = seedRng(obj.id);
        const lamp = rng() < 0.45;
        if (lamp) {
          const glow = Math.min(1, (night - 0.15) / 0.35);
          obj.material.color.copy(C.winDrk.clone().lerp(C.glassLit, glow * 0.7));
          obj.material.emissive = C.glassLit.clone().multiplyScalar(glow * 0.25);
        }
      }
      if (obj.userData.isShadow) {
        obj.position.x = -lightDir.lx/lightDir.ln * 1.3 * 0.3;
        obj.position.z = -lightDir.lz/lightDir.ln * 0.4 * 0.3;
        obj.material.opacity = 0.18 * (1 - night * 0.6);
      }
    });
  });
}
