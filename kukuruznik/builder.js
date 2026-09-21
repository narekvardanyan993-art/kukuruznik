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
  // Podium: 3 tiers, asymmetrical. Tower is at the back.
  const POD_X0 = -1.35;
  const POD_X1 = 2.30;
  const POD_Z1 = 0.15;
  const tiers = [
    { z0: -3.10, z1: POD_Z1, y0: -1.00, y1: 0.12 },
    { z0: -2.05, z1: POD_Z1, y0: -1.00, y1: 0.30 },
    { z0: -1.00, z1: 1.10, y0: -1.00, y1: 0.50 },
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
  const WING_W = 1.60; // Total width (WZ = 0.80)
  const WING_X0 = -1.52;
  const WING_X1 = -4.35;
  const WING_L = 2.83; // Math.abs(WING_X1 - WING_X0)
  const WING_H = 1.06; // WY
  const WING_BASE = -1.0; // Extend deep underground to merge with podium
  const WING_TOTAL_H = WING_H - WING_BASE;
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

  // Arcade (9 arches on front and back facades)
  const arches = 9;
  const archStep = WING_L / arches;
  const aw = archStep * 0.6;
  const aY0 = 0.10;
  const aY1 = 0.88;
  const ah = aY1 - aY0;
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
    const ax = WING_X0 - archStep/2 - i * archStep; // From WX0 towards WX1
    // Front facade
    const aMeshF = new THREE.Mesh(aGeo, toon(C.cellDrk, { hatch: false }));
    aMeshF.position.set(ax, aY0 - yCenter, WING_Z1);
    wingGroup.add(aMeshF);
    
    // Back facade
    const aMeshB = new THREE.Mesh(aGeo, toon(C.cellDrk, { hatch: false }));
    aMeshB.rotation.y = Math.PI; // Face the other way
    aMeshB.position.set(ax, aY0 - yCenter, WING_Z0);
    wingGroup.add(aMeshB);
  }

  // Vault (semi-cylinder on the end)
  const V_RAD = 0.80; // HZ
  const V_LEN = 1.35; // Math.abs(-5.70 - -4.35)
  const V_X0 = -5.70; // HX1
  
  const vGeo = new THREE.CylinderGeometry(V_RAD, V_RAD, V_LEN, 16, 1, false, 0, Math.PI);
  vGeo.rotateZ(Math.PI / 2);
  const vPos = v3(V_X0 + V_LEN/2, WING_H - yCenter, 0);
  const vMesh = new THREE.Mesh(vGeo, toon(C.hall)); // Roof
  vMesh.position.copy(vPos);
  wingGroup.add(vMesh);
  addEdges(wingGroup, vGeo, vPos, C.ink, 20);
  
  // Vault side walls
  const vwGeo = new THREE.BoxGeometry(V_LEN, WING_H - (-0.30), V_RAD * 2);
  const vwPos = v3(V_X0 + V_LEN/2, -0.30 + (WING_H - (-0.30))/2 - yCenter, 0);
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
  const gwGeo = new THREE.BoxGeometry(0.1, WING_H - (-0.30), V_RAD*1.8);
  const gwPos = v3(V_X0 + 0.05, -0.30 + (WING_H - (-0.30))/2 - yCenter, 0);
  const gwMesh = new THREE.Mesh(gwGeo, toon(C.winDrk, { hatch: false }));
  gwMesh.position.copy(gwPos);
  wingGroup.add(gwMesh);
  
  g.add(wingGroup);

      // 3. PORTAL
  const PORTAL_X = 1.10;
  const PORTAL_Z = -4.65;
  const PORTAL_W = 0.95;
  const PORTAL_PW = 0.14;
  const PORTAL_H = 0.62;
  const PORTAL_TOPH = 0.20;
  const P_D = 0.30;
  const portalG = new THREE.Group();
  const P_BASE = 0.00; // pgY = 0.00 for r=4.78
  
  const ppGeo = new THREE.BoxGeometry(PORTAL_PW, PORTAL_H, P_D);
  const pm1 = new THREE.Mesh(ppGeo, toon(C.podium));
  pm1.position.set(PORTAL_X - PORTAL_W/2 + PORTAL_PW/2, P_BASE + PORTAL_H/2 - yCenter, PORTAL_Z);
  portalG.add(pm1);
  addEdges(portalG, ppGeo, pm1.position, C.ink, 15);
  
  const pm2 = new THREE.Mesh(ppGeo, toon(C.podium));
  pm2.position.set(PORTAL_X + PORTAL_W/2 - PORTAL_PW/2, P_BASE + PORTAL_H/2 - yCenter, PORTAL_Z);
  portalG.add(pm2);
  addEdges(portalG, ppGeo, pm2.position, C.ink, 15);
  
  const ptGeo = new THREE.BoxGeometry(PORTAL_W, PORTAL_TOPH, P_D);
  const ptm = new THREE.Mesh(ptGeo, toon(C.podium));
  ptm.position.set(PORTAL_X, P_BASE + PORTAL_H + PORTAL_TOPH/2 - yCenter, PORTAL_Z);
  portalG.add(ptm);
  addEdges(portalG, ptGeo, ptm.position, C.ink, 15);
  
  g.add(portalG);

  // 4. STAIRS
  const stepsG = new THREE.Group();
  
  const halfW = 0.42;
  const w = halfW * 2;
  
  function addStairMesh(x, z0, z1, y0, y1, steps, yBase) {
    const dz = Math.abs(z1 - z0) / steps;
    const dy = Math.abs(y1 - y0) / steps;
    
    const shape = new THREE.Shape();
    const lenZ = Math.abs(z1 - z0);
    const topY = Math.max(y0, y1);
    const botY = Math.min(y0, y1);
    
    shape.moveTo(0, yBase);
    shape.lineTo(lenZ, yBase);
    shape.lineTo(lenZ, topY);
    
    for (let i = 0; i < steps; i++) {
      const curZ = lenZ - (i + 1) * dz;
      const curY = topY - i * dy;
      shape.lineTo(curZ, curY);
      if (i < steps - 1) {
        shape.lineTo(curZ, curY - dy);
      }
    }
    
    shape.lineTo(0, yBase);
    
    const ext = { depth: w, bevelEnabled: false };
    const geo = new THREE.ExtrudeGeometry(shape, ext);
    geo.rotateY(-Math.PI / 2);
    
    const minZ = Math.min(z0, z1);
    const mesh = new THREE.Mesh(geo, toon(C.podium));
    mesh.position.set(x + w/2, -yCenter, minZ);
    stepsG.add(mesh);
    addEdges(stepsG, geo, mesh.position, C.ink, 15);
  }

  function addDeck(x0, x1, z0, z1, y, yBase) {
    const cx = (x0 + x1) / 2;
    const dx = Math.abs(x1 - x0) + w;
    const dz = Math.abs(z1 - z0);
    const cz = (z0 + z1) / 2;
    const h = y - yBase;
    const geo = new THREE.BoxGeometry(dx, h, dz);
    const mesh = new THREE.Mesh(geo, toon(C.podium));
    mesh.position.set(cx, yBase + h/2 - yCenter, cz);
    stepsG.add(mesh);
    addEdges(stepsG, geo, mesh.position, C.ink, 15);
  }

  // Y Bases for each part (from table 1)
  const ybLong = -2.00;
  const ybDeck = -2.00;
  
  // 1. Long Flight (Road to Portal)
  // X = 1.10, Z = -11.0 to -4.80, Y = groundY(-11) to 0.00
  addStairMesh(1.10, -11.00, -4.80, groundY(11.05), 0.00, 18, ybLong);

  // 2. Deck through portal and to Zigzag 1
  // X = 1.10, Z = -4.80 to -4.00, Y = 0.00
  addDeck(1.10, 1.10, -4.80, -4.00, 0.00, ybDeck);

  // 3. Zigzag 1 (1->ground)
  // X = 1.10, Z = -4.00 to -3.10, Y = 0.00 to 0.12
  addStairMesh(1.10, -4.00, -3.10, 0.00, 0.12, 3, ybDeck);

  // 4. Deck Tier 0 (Landing 1)
  // X from 1.10 to 1.85, Z = -3.10 to -2.55, Y = 0.12
  addDeck(1.10, 1.85, -3.10, -2.55, 0.12, ybDeck);

  // 5. Zigzag 2 (2->1)
  // X = 1.85, Z = -2.55 to -2.05, Y = 0.12 to 0.30
  addStairMesh(1.85, -2.55, -2.05, 0.12, 0.30, 4, ybDeck);

  // 6. Deck Tier 1 (Landing 2)
  // X from 1.85 to 1.10, Z = -2.05 to -1.50, Y = 0.30
  addDeck(1.85, 1.10, -2.05, -1.50, 0.30, ybDeck);

  // 7. Zigzag 3 (3->2)
  // X = 1.10, Z = -1.50 to -1.00, Y = 0.30 to 0.50
  addStairMesh(1.10, -1.50, -1.00, 0.30, 0.50, 4, ybDeck);

  // Long flight to road
  // Starts directly after portal
  const rz0 = PORTAL_Z - 0.55;
  const rz1 = -11.0;
  

  g.add(stepsG);
  
  // 5. ENVIRONMENT (Hill, road, trees, benches, trash cans, lamps)
  function groundY(r) {
    if (r <= 6.30) return 0.00;
    if (r <= 8.20) return -0.42;
    if (r >= 13.0) return -1.75;
    return -0.42 + (-1.75 - -0.42) * ((r - 8.20) / (13.0 - 8.20));
  }

  // Trees
  const treeG = new THREE.Group();
  const treePositions = []; // To use for ground shadows
  
  const trnd = seedRng(9091);
  const C_TREE = new THREE.Color('#7a855e'); // warm muted green
  
  function addTree(type, x, z, s) {
    let geo;
    
    // Vary tree color slightly
    const green = toon(C_TREE.clone().lerp(new THREE.Color('#8b9964'), trnd() * 0.6));
    
    if (type === 0) { // Poplar / Cypress (tall, narrow, jagged)
      geo = new THREE.CylinderGeometry(0.05*s, 0.2*s, 1.4*s, 7, 3);
      const pos = geo.attributes.position.array;
      for (let j = 0; j < pos.length; j += 3) {
        if (pos[j+1] > -0.6*s) { // don't deform the very bottom too much
          const bump = 0.85 + trnd() * 0.3;
          pos[j] *= bump; pos[j+2] *= bump;
        }
      }
      geo.translate(0, 0.7*s, 0);
    } else if (type === 1) { // Plane tree (Platanus) (wide, massive, bumpy)
      geo = new THREE.IcosahedronGeometry(0.55*s, 2);
      geo.scale(1.4, 0.9, 1.2);
      const pos = geo.attributes.position.array;
      for (let j = 0; j < pos.length; j += 3) {
        const bump = 0.8 + trnd() * 0.4;
        pos[j] *= bump; pos[j+1] *= bump; pos[j+2] *= bump;
      }
      geo.translate(0, 0.6*s, 0);
    } else if (type === 2) { // Apricot / Fruit (rounded, irregular)
      geo = new THREE.IcosahedronGeometry(0.4*s, 1);
      const pos = geo.attributes.position.array;
      for (let j = 0; j < pos.length; j += 3) {
        const bump = 0.85 + trnd() * 0.3;
        pos[j] *= bump; pos[j+1] *= bump; pos[j+2] *= bump;
      }
      geo.translate(0, 0.5*s, 0);
    } else { // Pine (umbrella top, tall trunk)
      geo = new THREE.ConeGeometry(0.4*s, 0.5*s, 7, 2);
      const pos = geo.attributes.position.array;
      for (let j = 0; j < pos.length; j += 3) {
        const bump = 0.9 + trnd() * 0.2;
        pos[j] *= bump; pos[j+1] *= bump; pos[j+2] *= bump;
      }
      geo.scale(1.2, 0.6, 1.1);
      geo.translate(0, 0.9*s, 0);
    }
    geo.computeVertexNormals();
    
    const baseR = Math.sqrt(x*x + z*z);
    const yBase = groundY(baseR);
    
    const tiltX = (trnd() - 0.5) * 0.15;
    const tiltZ = (trnd() - 0.5) * 0.15;
    const rotY = trnd() * Math.PI * 2;
    
    // Trunks (visible branching for types 1 and 2)
    const trunkMat = toon(new THREE.Color('#5c5346'), {hatch:false});
    if (type === 1 || type === 2) {
      // Y-shaped trunk
      const geo1 = new THREE.CylinderGeometry(0.04*s, 0.06*s, 0.6*s, 5);
      geo1.translate(0, 0.3*s, 0);
      const tr1 = new THREE.Mesh(geo1, trunkMat);
      tr1.position.set(x, yBase - yCenter, z);
      tr1.rotation.set(tiltX, rotY, tiltZ + 0.25);
      treeG.add(tr1);
      
      const geo2 = new THREE.CylinderGeometry(0.03*s, 0.05*s, 0.5*s, 5);
      geo2.translate(0, 0.25*s, 0);
      const tr2 = new THREE.Mesh(geo2, trunkMat);
      tr2.position.set(x, yBase - yCenter, z);
      tr2.rotation.set(tiltX, rotY + Math.PI, tiltZ + 0.35);
      treeG.add(tr2);
    } else {
      // Single straight trunk (Pine has longer trunk)
      const th = type === 3 ? 0.8*s : 0.5*s;
      const geo = new THREE.CylinderGeometry(0.04*s, 0.06*s, th, 5);
      geo.translate(0, th/2, 0);
      const tr = new THREE.Mesh(geo, trunkMat);
      tr.position.set(x, yBase - yCenter, z);
      tr.rotation.set(tiltX, rotY, tiltZ);
      treeG.add(tr);
    }
    
    const tm = new THREE.Mesh(geo, green);
    tm.position.set(x, yBase - yCenter, z);
    tm.rotation.set(tiltX, rotY, tiltZ);
    treeG.add(tm);
    addOutline(treeG, geo, tm.position, C.ink, 0.02);
    
    treePositions.push({ x, z, r: baseR, s, type });
  }



  // SOVIET PARK WITH CONFORMING GEOMETRY
  
  // Constants
  const alleyW = 1.2;
  const pathW = 0.6;
  const ring1R = 6.0;
  const ring2R = 9.5;
  const stoneMat = toon(new THREE.Color(0xdad8cd));
  const grassMat = toon(new THREE.Color(0x6a7d55));
  
  function conformToTerrain(geo, yOffset = 0.015) {
    const pos = geo.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const z = pos[i+2];
      const r = Math.sqrt(x*x + z*z);
      // yCenter is already subtracted when adding mesh to scene? No, yCenter is used in position.set(x, -yCenter, z)
      // So here we just set the local Y to groundY(r)
      pos[i+1] = groundY(r) + Math.sin(x*3)*0.01 + Math.sin(z*3)*0.01 + yOffset;
    }
    geo.computeVertexNormals();
  }

  // 1. Paths Geometry
  const pathGroup = new THREE.Group();
  pathGroup.position.set(0, -yCenter, 0); // Base height
  
  // Main Alley
  const alleyL = 11.0;
  const alleyZ = -8.6; 
  const alleyGeo = new THREE.PlaneGeometry(alleyW, alleyL, 4, 32); // high segment count to conform!
  alleyGeo.rotateX(-Math.PI/2);
  alleyGeo.translate(0, 0, alleyZ); // translate geo so vertices are in world space for conform
  conformToTerrain(alleyGeo);
  const alleyMesh = new THREE.Mesh(alleyGeo, stoneMat);
  alleyMesh.receiveShadow = true;
  pathGroup.add(alleyMesh);
  addEdges(pathGroup, alleyGeo, new THREE.Vector3(0,0,0), C.ink, 15);
  
  // Ring 1
  const r1Geo = new THREE.RingGeometry(ring1R - pathW/2, ring1R + pathW/2, 64, 2);
  r1Geo.rotateX(-Math.PI/2);
  conformToTerrain(r1Geo);
  const r1Mesh = new THREE.Mesh(r1Geo, stoneMat);
  r1Mesh.receiveShadow = true;
  pathGroup.add(r1Mesh);
  
  // Ring 2
  const r2Geo = new THREE.RingGeometry(ring2R - pathW/2, ring2R + pathW/2, 96, 2);
  r2Geo.rotateX(-Math.PI/2);
  conformToTerrain(r2Geo);
  const r2Mesh = new THREE.Mesh(r2Geo, stoneMat);
  r2Mesh.receiveShadow = true;
  pathGroup.add(r2Mesh);
  
  // Radial paths
  const radials = [ Math.PI/4, 3*Math.PI/4, 5*Math.PI/4, 7*Math.PI/4, Math.PI ]; 
  for (const ang of radials) {
    const rL = ring2R + 4;
    const pGeo = new THREE.PlaneGeometry(pathW, rL, 2, 32);
    pGeo.rotateX(-Math.PI/2);
    pGeo.translate(0, 0, rL/2); // translate so origin is at end
    pGeo.rotateY(ang);
    conformToTerrain(pGeo);
    const pMesh = new THREE.Mesh(pGeo, stoneMat);
    pMesh.receiveShadow = true;
    pathGroup.add(pMesh);
  }
  
  // Plazas at intersections
  const plazas = [];
  radials.push(0); 
  for (const ang of radials) {
    for (const R of [ring1R, ring2R]) {
      const px = Math.sin(ang) * R;
      const pz = Math.cos(ang) * R;
      if (ang === 0 && R === ring1R) continue;
      plazas.push({x: px, z: pz, r: 1.2});
    }
  }
  
  for (const pl of plazas) {
    const plGeo = new THREE.CircleGeometry(pl.r, 32);
    plGeo.rotateX(-Math.PI/2);
    plGeo.translate(pl.x, 0, pl.z);
    conformToTerrain(plGeo);
    const plMesh = new THREE.Mesh(plGeo, stoneMat);
    plMesh.receiveShadow = true;
    pathGroup.add(plMesh);
    addEdges(pathGroup, plGeo, new THREE.Vector3(0,0,0), C.ink, 15);
  }
  
  g.add(pathGroup);
  
  // 3. Props: Benches, Lamps, Flowerbeds, Pulpulaks
  const propGroup = new THREE.Group();
  propGroup.position.set(0, -yCenter, 0);
  const benchMat = toon(new THREE.Color(0x8b5a2b));
  const metalMat = toon(new THREE.Color(0x2a3d45));
  const lampLitMat = toon(C.glassLit);
  
  const treeRequests = []; // Store where trees should go
  
  function getGy(x, z) {
    const r = Math.sqrt(x*x + z*z);
    return groundY(r) + Math.sin(x*3)*0.01 + Math.sin(z*3)*0.01;
  }

  function addBench(x, z, rotY) {
    const gy = getGy(x, z);
    const bGeo = new THREE.BoxGeometry(0.5, 0.1, 0.2);
    const bMesh = new THREE.Mesh(bGeo, benchMat);
    bMesh.position.set(x, gy + 0.15, z);
    bMesh.rotation.y = rotY;
    bMesh.castShadow = true;
    propGroup.add(bMesh);
    
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.15), metalMat);
    l1.position.set(x - 0.2, gy + 0.075, z);
    l1.rotation.y = rotY;
    l1.castShadow = true;
    propGroup.add(l1);
    const l2 = l1.clone();
    l2.position.set(x + 0.2, gy + 0.075, z);
    propGroup.add(l2);
    
    // Request a tree behind the bench for shade
    const tx = x + Math.sin(rotY) * 0.8;
    const tz = z + Math.cos(rotY) * 0.8;
    treeRequests.push({x: tx, z: tz, type: 0, s: 0.6 + trnd()*0.3});
  }
  
  function addLamp(x, z) {
    const gy = getGy(x, z);
    const pGeo = new THREE.CylinderGeometry(0.02, 0.04, 0.8, 8);
    const pMesh = new THREE.Mesh(pGeo, metalMat);
    pMesh.position.set(x, gy + 0.4, z);
    pMesh.castShadow = true;
    propGroup.add(pMesh);
    
    const hGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const hMesh = new THREE.Mesh(hGeo, lampLitMat);
    hMesh.position.set(x, gy + 0.85, z);
    hMesh.userData.isGlass = true; 
    hMesh.userData.cellWindow = true; 
    propGroup.add(hMesh);
  }
  
  function addPulpul(x, z) {
    const gy = getGy(x, z);
    const geo = new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8);
    const mesh = new THREE.Mesh(geo, stoneMat);
    mesh.position.set(x, gy + 0.15, z);
    mesh.castShadow = true;
    propGroup.add(mesh);
  }

  const flowerColors = [0x9e4b6d, 0xcc883a, 0x855c8c]; // dark pink, ochre, lilac
  function addFlowerbed(x, z, r) {
    const gy = getGy(x, z);
    const cIdx = Math.floor(trnd() * flowerColors.length);
    const mat = toon(new THREE.Color(flowerColors[cIdx]));
    
    // Soil volume
    const geo = new THREE.CylinderGeometry(r, r, 0.08, 16);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, gy + 0.04, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    propGroup.add(mesh);
    
    // Hedge border
    const hGeo = new THREE.TorusGeometry(r+0.05, 0.06, 8, 24);
    hGeo.rotateX(Math.PI/2);
    const hMesh = new THREE.Mesh(hGeo, toon(new THREE.Color(0x3a5a25))); // dark shrub
    hMesh.position.set(x, gy + 0.04, z);
    hMesh.castShadow = true;
    propGroup.add(hMesh);
  }
  
  // Hedges along paths
  function addHedge(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx*dx + dz*dz);
    const ang = Math.atan2(dx, dz);
    const cx = (x0+x1)/2, cz = (z0+z1)/2;
    const gy = getGy(cx, cz);
    
    // A segmented box could conform better, but small hedges are fine
    const geo = new THREE.BoxGeometry(0.2, 0.3, len);
    const mesh = new THREE.Mesh(geo, toon(new THREE.Color(0x3a5a25)));
    mesh.position.set(cx, gy + 0.15, cz);
    mesh.rotation.y = ang;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    propGroup.add(mesh);
  }
  
  // Populate props
  // Main alley
  for (let z = -4.5; z >= -13.5; z -= 2.8) {
    addLamp(-alleyW/2 - 0.2, z);
    addLamp(alleyW/2 + 0.2, z);
    addBench(-alleyW/2 - 0.2, z - 1.4, Math.PI/2);
    addBench(alleyW/2 + 0.2, z - 1.4, -Math.PI/2);
    
    addHedge(-alleyW/2 - 0.5, z - 0.5, -alleyW/2 - 0.5, z + 0.5);
    addHedge(alleyW/2 + 0.5, z - 0.5, alleyW/2 + 0.5, z + 0.5);
  }
  
  // Plazas props
  for (const pl of plazas) {
    addPulpul(pl.x, pl.z);
    addLamp(pl.x + pl.r*0.6, pl.z + pl.r*0.6);
    addFlowerbed(pl.x - pl.r*1.5, pl.z - pl.r*1.5, 0.5);
    addFlowerbed(pl.x + pl.r*1.5, pl.z - pl.r*1.5, 0.5);
    
    // Plaza trees requested at corners
    treeRequests.push({x: pl.x + pl.r*1.8, z: pl.z + pl.r*1.8, type: 0, s: 0.6});
    treeRequests.push({x: pl.x - pl.r*1.8, z: pl.z + pl.r*1.8, type: 0, s: 0.6});
  }
  
  g.add(propGroup);
  
  // 2. Trees (Rows and Groups)
  // Process requests
  for (const req of treeRequests) {
    if (Math.sqrt(req.x*req.x + req.z*req.z) > 4) {
      addTree(req.type, req.x, req.z, req.s);
    }
  }

  // Main Alley rows
  const alleySpacing = 1.4;
  for (let z = -4.0; z >= -14.0; z -= alleySpacing) {
    addTree(3, -alleyW/2 - 0.8, z, 1.2); 
    addTree(3, alleyW/2 + 0.8, z, 1.2);
  }
  
  // Radial paths rows
  for (const ang of radials) {
    if (ang === 0 || ang === Math.PI) continue; // skip main alley
    for (let R = ring1R + 1.2; R < ring2R + 4; R += 1.8) {
      const tx1 = Math.sin(ang) * R + Math.cos(ang) * 0.8;
      const tz1 = Math.cos(ang) * R - Math.sin(ang) * 0.8;
      const tx2 = Math.sin(ang) * R - Math.cos(ang) * 0.8;
      const tz2 = Math.cos(ang) * R + Math.sin(ang) * 0.8;
      addTree(1, tx1, tz1, 0.8);
      addTree(1, tx2, tz2, 0.8);
    }
  }
  
  // Ring tree rows
  for (let a = 0; a < Math.PI*2; a += Math.PI/16) { // More dense!
    if (a > 11.5*Math.PI/6 || a < 0.5*Math.PI/6) continue; // avoid main alley
    if (Math.abs(Math.sin(a * 2)) < 0.15) continue; // avoid radials
    const r = ring2R + 1.2;
    addTree(0, Math.sin(a)*r, Math.cos(a)*r, 0.7); 
  }
  
  // Lawns: clusters of 3-5 trees
  for (let i = 0; i < 30; i++) {
    const ang = trnd() * Math.PI * 2;
    const r = 6.5 + trnd() * 2.5; // between ring 1 and 2
    if (ang > 11*Math.PI/6 || ang < 1*Math.PI/6) continue;
    if (Math.abs(Math.sin(ang * 2)) < 0.2) continue; // avoid paths
    const cx = Math.sin(ang)*r, cz = Math.cos(ang)*r;
    const count = 3 + Math.floor(trnd()*3);
    for(let j=0; j<count; j++) {
      const tx = cx + trnd()*1.5 - 0.75;
      const tz = cz + trnd()*1.5 - 0.75;
      if (Math.sqrt(tx*tx + tz*tz) > 4) addTree(0, tx, tz, 0.5 + trnd()*0.3);
    }
  }
  
  g.add(treeG);
  
  // Hill Base (Terrain)
  const hGeo = new THREE.PlaneGeometry(40, 40, 256, 256); // Even higher res
  hGeo.rotateX(-Math.PI / 2);
  const hPos = hGeo.attributes.position.array;
  const hColors = new Float32Array((hPos.length / 3) * 3);
  
  const cTop = C.ground.clone();
  const cSlope = C.groundFar.clone();
  const cShadow = C.shadow.clone();
  
  for(let i=0; i<hPos.length; i+=3) {
    const x = hPos[i], z = hPos[i+2];
    const r = Math.sqrt(x*x + z*z);
    
    hPos[i+1] = getGy(x, z);
    
    let col = cTop.clone();
    
    // Vary grass color based on sector to differentiate lawns
    const sectorAng = Math.atan2(z, x);
    const sector = Math.floor(((sectorAng + Math.PI) / (Math.PI*2)) * 8); // 8 slices
    if (sector % 2 === 0) {
      col.lerp(new THREE.Color(0x5a7045), 0.3); // darker grass
    } else {
      col.lerp(new THREE.Color(0x738a5d), 0.3); // lighter grass
    }
    
    if (r > 12.0) col.lerp(cSlope, Math.min(1.0, (r - 12.0) / 4.0));
    
    // Tree shadows
    let shadowStr = 0;
    for (const tr of treePositions) {
      const dx = x - (tr.x + tr.s * 0.4);
      const dz = z - (tr.z + tr.s * 0.4);
      const dist = Math.sqrt(dx*dx + dz*dz);
      const shadowR = tr.s * 1.5;
      if (dist < shadowR) {
        shadowStr = Math.max(shadowStr, 1.0 - (dist / shadowR));
      }
    }
    if (shadowStr > 0) col.lerp(cShadow, shadowStr * 0.4); // darker shadows
    
    hColors[i] = col.r; hColors[i+1] = col.g; hColors[i+2] = col.b;
  }
  
  hGeo.setAttribute('color', new THREE.BufferAttribute(hColors, 3));
  hGeo.computeVertexNormals();
  const hMat = toon(C.ground);
  hMat.vertexColors = true;
  const hMesh = new THREE.Mesh(hGeo, hMat);
  hMesh.position.set(0, -yCenter, 0);
  hMesh.receiveShadow = true;
  g.add(hMesh);

  g.add(hMesh);


  
  
  // Curved road matching terrain
  const rdGeo = new THREE.RingGeometry(11, 14, 64, 4, Math.PI/2 - 0.5, 1.0);
  rdGeo.rotateX(-Math.PI / 2);
  const rdPos = rdGeo.attributes.position.array;
  for(let i=0; i<rdPos.length; i+=3) {
    const x = rdPos[i], z = rdPos[i+2];
    const r = Math.sqrt(x*x + z*z);
    // Add a tiny offset so it sits just above the grass
    rdPos[i+1] = groundY(r) + 0.02;
  }
  rdGeo.computeVertexNormals();
  const rdMesh = new THREE.Mesh(rdGeo, toon(C.deck)); 
  rdMesh.position.set(0, -yCenter, 0);
  g.add(rdMesh);
  rdMesh.receiveShadow = true;


  
  

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
  
  addProp('bench', -2.0, 0.00, -2.0);
  addProp('trash', -2.3, 0.00, -2.0);

  
  // Enable real shadows
  

  return g;
}

export function setupBuilding(engine) {
  engine.renderer.shadowMap.enabled = true;
  engine.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const sunLight = engine.scene.children.find(c => c.isDirectionalLight && c.intensity > 1);
  if (sunLight) {
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 40;
    sunLight.shadow.camera.left = -15;
    sunLight.shadow.camera.right = 15;
    sunLight.shadow.camera.top = 15;
    sunLight.shadow.camera.bottom = -15;
    sunLight.shadow.bias = -0.001;
  }

  const shaftGroup = buildShaft();
  const headGroup = buildHead();
  const groundGroup = buildEnvironment();
  
  engine.scene.add(shaftGroup, headGroup, groundGroup);
  
  engine.scene.traverse(c => {
    if (c.isMesh && !c.userData.isShadow && !c.userData.isEdge && !c.userData.outline && !c.userData.isGlass) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });


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
          obj.material.color.copy(C.winDrk.clone().lerp(C.glassLit, glow * 0.95));
          obj.material.emissive = C.glassLit.clone().multiplyScalar(glow * 0.8);
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

// Additional trees
