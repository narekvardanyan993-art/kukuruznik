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

export function buildEnvironment() {
  const g = new THREE.Group();
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const { yCenter, C, R, shaftY0, fh } = P;
  
  // Base dimensions
  const D = 2.00; // Tower diameter

  // 1. PODIUM
  // Podium: 3 tiers (0.5*fh, 1.15*fh, 1.92*fh). Width 1.5 D = 3.00.
  // Tower is at the back.
  const POD_W = 1.5 * D; // 3.00
  const POD_X0 = -POD_W / 2;
  const POD_X1 = POD_W / 2;
  // Let tower radius=1. Back edge = 1.1 to ensure intersection without gap
  const POD_Z1 = 1.1;
  const tiers = [
    { z0: -3.10, z1: POD_Z1, y0: -1.0, y1: 0.5 * fh },
    { z0: -2.15, z1: POD_Z1, y0: -1.0, y1: 1.15 * fh },
    { z0: -1.10, z1: POD_Z1, y0: -1.0, y1: 1.92 * fh },
  ];

  for (const t of tiers) {
    const w = POD_X1 - POD_X0, d = t.z1 - t.z0, h = t.y1 - t.y0;
    const geo = new THREE.BoxGeometry(w, h, d);
    const pos = v3((POD_X0+POD_X1)/2, (t.y0+t.y1)/2 - yCenter, (t.z0+t.z1)/2);
    const m = new THREE.Mesh(geo, toon(C.podium));
    m.position.copy(pos);
    g.add(m);
    addEdges(g, geo, pos, C.ink, 15);

    const dg = new THREE.PlaneGeometry(w, d);
    dg.rotateX(-Math.PI / 2);
    const dm = new THREE.Mesh(dg, toon(C.deck));
    dm.position.copy(v3((POD_X0+POD_X1)/2, t.y1 - yCenter + 0.002, (t.z0+t.z1)/2));
    g.add(dm);
  }

    // 2. SIDE BUILDING (WING + VAULT)
  const wingGroup = new THREE.Group();
  const WING_W = 0.8 * D; // 1.60
  const WING_L = 1.1 * D; // 2.20
  const WING_H = 4 * fh; // 1.04
  const WING_BASE = -1.0; // Extend deep underground to merge with podium
  const WING_TOTAL_H = WING_H - WING_BASE;
  const WING_X0 = -1.50 - WING_L; 
  const WING_X1 = -1.50;
  const WING_Z0 = -WING_W / 2;
  const WING_Z1 = WING_W / 2;

  // Main block
  const wGeo = new THREE.BoxGeometry(WING_L, WING_TOTAL_H, WING_W);
  const wPos = v3((WING_X0+WING_X1)/2, WING_BASE + WING_TOTAL_H/2 - yCenter, 0);
  const wMesh = new THREE.Mesh(wGeo, toon(C.hall)); 
  wMesh.position.copy(wPos);
  wingGroup.add(wMesh);
  addEdges(wingGroup, wGeo, wPos, C.ink, 15);

  // Roof of wing
  const wrGeo = new THREE.PlaneGeometry(WING_L, WING_W);
  wrGeo.rotateX(-Math.PI / 2);
  const wrMesh = new THREE.Mesh(wrGeo, toon(C.roof));
  wrMesh.position.copy(v3((WING_X0+WING_X1)/2, WING_H - yCenter + 0.002, 0));
  wingGroup.add(wrMesh);

  // Arcade (8 arches on front facade)
  const arches = 8;
  const archStep = WING_L / arches;
  const aw = archStep * 0.6;
  const ah = WING_H * 0.7;
  const ar = aw / 2;
  
  const aShape = new THREE.Shape();
  aShape.moveTo(-aw/2, 0);
  aShape.lineTo(-aw/2, ah - ar);
  aShape.absarc(0, ah - ar, ar, Math.PI, 0, true);
  aShape.lineTo(aw/2, 0);
  aShape.lineTo(-aw/2, 0);
  
  const aExt = { depth: 0.1, bevelEnabled: false };
  const aGeo = new THREE.ExtrudeGeometry(aShape, aExt);
  
  for (let i = 0; i < arches; i++) {
    const ax = WING_X1 - archStep/2 - i * archStep;
    const aMesh = new THREE.Mesh(aGeo, toon(C.cellDrk, { hatch: false }));
    // Arcade starts at Y=0
    aMesh.position.set(ax, -yCenter, WING_Z1);
    wingGroup.add(aMesh);
  }

  // Vault (semi-cylinder on the end)
  const V_RAD = 0.80;
  const V_LEN = 0.6 * D; // 1.20
  const V_X0 = WING_X0 - V_LEN; // -4.90
  
  const vGeo = new THREE.CylinderGeometry(V_RAD, V_RAD, V_LEN, 16, 1, false, 0, Math.PI);
  vGeo.rotateZ(Math.PI / 2);
  const vPos = v3(V_X0 + V_LEN/2, WING_H - yCenter, 0);
  const vMesh = new THREE.Mesh(vGeo, toon(C.hall)); // Roof
  vMesh.position.copy(vPos);
  wingGroup.add(vMesh);
  addEdges(wingGroup, vGeo, vPos, C.ink, 20);
  
  // Vault side walls
  const vwGeo = new THREE.BoxGeometry(V_LEN, WING_TOTAL_H, V_RAD * 2);
  const vwPos = v3(V_X0 + V_LEN/2, WING_BASE + WING_TOTAL_H/2 - yCenter, 0);
  const vwMesh = new THREE.Mesh(vwGeo, toon(C.hall));
  vwMesh.position.copy(vwPos);
  wingGroup.add(vwMesh);
  addEdges(wingGroup, vwGeo, vwPos, C.ink, 15);
  
  // Glazed arch at the end (X = V_X0)
  const gGeo = new THREE.CylinderGeometry(V_RAD*0.9, V_RAD*0.9, 0.1, 16, 1, false, 0, Math.PI);
  gGeo.rotateZ(Math.PI / 2);
  const gPos = v3(V_X0 + 0.05, WING_H - yCenter, 0);
  const gMesh = new THREE.Mesh(gGeo, toon(C.winDrk, { hatch: false }));
  gMesh.position.copy(gPos);
  wingGroup.add(gMesh);

  // Glazed window wall under the arch
  // Arcade starts at Y=0, so window wall should go from Y=0 to WING_H
  const gwGeo = new THREE.BoxGeometry(0.1, WING_H, V_RAD*1.8);
  const gwPos = v3(V_X0 + 0.05, WING_H/2 - yCenter, 0);
  const gwMesh = new THREE.Mesh(gwGeo, toon(C.winDrk, { hatch: false }));
  gwMesh.position.copy(gwPos);
  wingGroup.add(gwMesh);
  
  g.add(wingGroup);

      // 3. PORTAL
  const P_W = 1.4, P_H = 0.55, P_D = 0.3, P_T = 0.15; 
  // Portal is right in front of the podium (which starts at -3.10)
  // Let portal center be -3.25. Depth is 0.3, so it spans -3.40 to -3.10.
  const P_Z = -3.25; 
  const portalG = new THREE.Group();
  
  // Base of portal is exactly tier[0].y1 ? Or ground?
  // If stairs lead to portal, portal is AT the top of the stairs, so base is tier[0].y1
  const P_BASE = tiers[0].y1; // 0.13
  
  const pp1 = new THREE.BoxGeometry(P_T, P_H, P_D);
  const pm1 = new THREE.Mesh(pp1, toon(C.podium));
  pm1.position.set(-P_W/2 + P_T/2, P_BASE + P_H/2 - yCenter, P_Z);
  portalG.add(pm1);
  addEdges(portalG, pp1, pm1.position, C.ink, 15);
  
  const pm2 = new THREE.Mesh(pp1, toon(C.podium));
  pm2.position.set(P_W/2 - P_T/2, P_BASE + P_H/2 - yCenter, P_Z);
  portalG.add(pm2);
  addEdges(portalG, pp1, pm2.position, C.ink, 15);
  
  const pt = new THREE.BoxGeometry(P_W, P_T, P_D);
  const ptm = new THREE.Mesh(pt, toon(C.podium));
  ptm.position.set(0, P_BASE + P_H + P_T/2 - yCenter, P_Z);
  portalG.add(ptm);
  addEdges(portalG, pt, ptm.position, C.ink, 15);
  
  // A slab under the portal to connect stairs to podium
  const pSlabGeo = new THREE.BoxGeometry(P_W, 0.2, P_D);
  const pSlab = new THREE.Mesh(pSlabGeo, toon(C.podium));
  pSlab.position.set(0, P_BASE - 0.1 - yCenter, P_Z);
  portalG.add(pSlab);
  addEdges(portalG, pSlabGeo, pSlab.position, C.ink, 15);

  g.add(portalG);

        // 4. STAIRS
  const ST_Z0 = -5.0, ST_Z1 = -3.40; // Goes exactly to the front of the portal
  const ST_W = 1.4;
  const ST_Y0 = -0.6; // Road level
  const ST_Y1 = tiers[0].y1; // Podium level (top of stairs)
  
  const stepsG = new THREE.Group();
  const stepCount = 12;
  const stepD = (ST_Z1 - ST_Z0) / stepCount;
  const stepH = (ST_Y1 - ST_Y0) / stepCount;
  
  for(let i=0; i<stepCount; i++) {
    // Each step is a solid block from Y = -1.0 up to the step level
    const topY = ST_Y0 + stepH * (i + 1);
    const h = topY - (-1.0); // Solid down into the ground
    const sGeo = new THREE.BoxGeometry(ST_W, h, stepD);
    const sMesh = new THREE.Mesh(sGeo, toon(C.podium));
    sMesh.position.set(0, -1.0 + h/2 - yCenter, ST_Z0 + i * stepD + stepD/2);
    stepsG.add(sMesh);
    addEdges(stepsG, sGeo, sMesh.position, C.ink, 15);
  }
  g.add(stepsG);
  
  // 5. ENVIRONMENT (Hill, road, trees, benches, trash cans, lamps)
    // Hill
  const hGeo = new THREE.PlaneGeometry(30, 30, 32, 32);
  hGeo.rotateX(-Math.PI / 2);
  const hPos = hGeo.attributes.position.array;
  for(let i=0; i<hPos.length; i+=3) {
    const x = hPos[i], z = hPos[i+2];
    // Gentle slope up towards +Z. At z = -3, y = 0. At z = -5.5 (road), y = -0.5
    const y = (z + 3.2) * 0.2; 
    hPos[i+1] = y + Math.sin(x*2)*0.05 + Math.sin(z*2)*0.05;
  }
  hGeo.computeVertexNormals();
  const hMesh = new THREE.Mesh(hGeo, toon(C.ground));
  hMesh.position.set(0, -yCenter - 0.02, 0);
  g.add(hMesh);

  // Road
  const rdGeo = new THREE.PlaneGeometry(30, 3);
  rdGeo.rotateX(-Math.PI / 2);
  const rdMesh = new THREE.Mesh(rdGeo, toon(C.podium)); 
  rdMesh.position.set(0, -0.6 - yCenter, -5.5);
  g.add(rdMesh);
  
  // Trees
  const treeG = new THREE.Group();
  function addTree(type, x, z, s) {
    let geo;
    const green = toon(C.groundFar);
    if (type === 0) { // Cypress
      geo = new THREE.ConeGeometry(0.2*s, 1.2*s, 8);
      geo.translate(0, 0.6*s, 0);
    } else if (type === 1) { // Spreading
      geo = new THREE.DodecahedronGeometry(0.5*s, 1);
      geo.scale(1.5, 0.8, 1.2);
      geo.translate(0, 0.6*s, 0);
    } else if (type === 2) { // Round
      geo = new THREE.IcosahedronGeometry(0.4*s, 1);
      geo.translate(0, 0.5*s, 0);
    } else { // Bush
      geo = new THREE.SphereGeometry(0.2*s, 7, 7);
      geo.scale(1.5, 0.8, 1.0);
      geo.translate(0, 0.1*s, 0);
    }
    // Trunks
    if (type !== 3) {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.05*s, 0.05*s, 0.5*s), toon(C.cellDrk, {hatch:false}));
      tr.position.set(x, 0.25*s - yCenter, z);
      treeG.add(tr);
    }
    const yBase = (z > -3 ? (z + 3) * 0.15 : 0) - 0.2;
    const tm = new THREE.Mesh(geo, green);
    tm.position.set(x, yBase - yCenter + (type!==3?0.3*s:0), z);
    treeG.add(tm);
    addOutline(treeG, geo, tm.position, C.ink, 0.02);
  }
  // Add some trees
  addTree(0, -4, -2, 0.4);
  addTree(0, -4.5, -1, 0.5);
  addTree(1, 3.5, -2, 0.6);
  addTree(2, 4, 1, 0.5);
  addTree(3, -2.5, 2, 0.4);
  addTree(3, 2.5, 2, 0.35);
  g.add(treeG);

  // Lamps, Benches, Trash cans
  function addProp(type, x, y, z) {
    if (type === 'lamp') {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6), toon(C.podium));
      p.position.set(x, y + 0.3 - yCenter, z);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.06), toon(C.glassLit, {hatch:false}));
      h.position.set(x, y + 0.6 - yCenter, z);
      h.userData.isGlass = true;
      g.add(p, h);
    } else if (type === 'bench') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.2), toon(C.deck));
      b.position.set(x, y + 0.1 - yCenter, z);
      g.add(b);
    } else if (type === 'trash') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.15), toon(C.cellDrk, {hatch:false}));
      c.position.set(x, y + 0.075 - yCenter, z);
      g.add(c);
    }
  }
  addProp('lamp', -0.8, -0.15, -4.0);
  addProp('lamp', 0.8, -0.15, -4.0);
  addProp('lamp', -0.8, -0.45, -4.8);
  addProp('lamp', 0.8, -0.45, -4.8);
  
  addProp('bench', -2.0, tiers[1].y1, -2.0);
  addProp('trash', -2.3, tiers[1].y1, -2.0);

  // Shadows
  const shGeo = new THREE.CircleGeometry(R * 1.6, 32);
  shGeo.rotateX(-Math.PI / 2);
  const shM = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({
    color: C.shadow, transparent: true, opacity: 0.18, depthWrite: false
  }));
  shM.position.set(0.3, tiers[2].y1 - yCenter + 0.003, -0.2);
  shM.renderOrder = -1;
  g.add(shM);
  shM.userData.isShadow = true;

  const csGeo = new THREE.RingGeometry(R * 0.85, R * 1.15, 32);
  csGeo.rotateX(-Math.PI / 2);
  const csM = new THREE.Mesh(csGeo, new THREE.MeshBasicMaterial({
    color: C.shadow, transparent: true, opacity: 0.22, depthWrite: false
  }));
  csM.position.set(0, tiers[2].y1 - yCenter + 0.003, 0);
  csM.renderOrder = -1;
  g.add(csM);

  return g;
}

export function setupBuilding(engine) {
  const shaftGroup = buildShaft();
  const headGroup = buildHead();
  const groundGroup = buildEnvironment();
  
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
