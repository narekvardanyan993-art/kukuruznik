import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ======================== SEEDED RNG ========================
export function seedRng(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ======================== TOON GRADIENT MAP ========================
function makeToonGradient(steps) {
  const c = document.createElement('canvas');
  c.width = steps; c.height = 1;
  const ctx = c.getContext('2d');
  for (let i = 0; i < steps; i++) {
    const v = Math.round((i / (steps - 1)) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
export const toonGrad5 = makeToonGradient(5);
export const toonGrad3 = makeToonGradient(3);

export function toon(color, opts = {}) {
  const m = new THREE.MeshToonMaterial({
    color: color.clone(),
    gradientMap: opts.grad || toonGrad5,
    side: opts.side || THREE.FrontSide,
    transparent: !!opts.alpha,
    opacity: opts.alpha || 1.0,
    depthWrite: opts.depthWrite !== undefined ? opts.depthWrite : true,
  });
  
  m.onBeforeCompile = (shader) => {
    if (opts.hatch === false) return;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\n varying vec3 vLocalPos;'
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vLocalPos = position;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n varying vec3 vLocalPos;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
       if (luma < 0.55) { // Only in shadows and dark areas
           float scale = 40.0;
           float hatch = sin((vLocalPos.x + vLocalPos.y - vLocalPos.z) * scale);
           if (luma < 0.35) {
               hatch = min(hatch, sin((vLocalPos.x - vLocalPos.y + vLocalPos.z) * scale));
           }
           
           // Distance fade (gl_FragCoord.z / gl_FragCoord.w is distance in view space)
           float dist = gl_FragCoord.z / gl_FragCoord.w;
           float hatchIntensity = 1.0 - smoothstep(10.0, 30.0, dist);
           
           if (hatch < 0.2 && hatchIntensity > 0.0) {
               // Mix towards ink color instead of just multiplying
               vec3 ink = vec3(0.18, 0.16, 0.14);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, ink, 0.5 * hatchIntensity);
           }
       }`
    );
  };
  return m;
}

// ======================== OUTLINE & EDGES ========================
export function makeOutlineShader(color, thickness) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: color.clone() },
      thick: { value: thickness }, time: { value: 0 }
    },
    vertexShader: `
      uniform float thick;
      uniform float time;
      void main() {
        
        float j = sin(position.x * 20.0) * sin(position.y * 35.0) * sin(position.z * 15.0);
        float th = thick * (0.8 + 0.5 * j);
        vec3 p = position + normal * th;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      void main() {
        gl_FragColor = vec4(color, 0.85);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

export function addOutline(parent, geo, pos, color, thickness, rotation) {
  const m = new THREE.Mesh(geo, makeOutlineShader(color, thickness));
  m.position.copy(pos);
  if (rotation) m.rotation.copy(rotation);
  m.userData.outline = true;
  parent.add(m);
  return m;
}

export function addEdges(parent, geo, pos, color, threshold) {
  const eg = new THREE.EdgesGeometry(geo, threshold || 15);
  const posArr = eg.attributes.position.array;
  const newPositions = [];
  const rng = seedRng(12345);
  const segments = 4;
  for (let i = 0; i < posArr.length; i += 6) {
    const ax = posArr[i], ay = posArr[i+1], az = posArr[i+2];
    const bx = posArr[i+3], by = posArr[i+4], bz = posArr[i+5];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (len === 0) continue;
    
    const os = 0.03 + rng() * 0.04;
    const p0x = ax - dx * os, p0y = ay - dy * os, p0z = az - dz * os;
    const p1x = bx + dx * os, p1y = by + dy * os, p1z = bz + dz * os;
    
    let prevX = p0x, prevY = p0y, prevZ = p0z;
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      let nx = p0x + (p1x - p0x) * t;
      let ny = p0y + (p1y - p0y) * t;
      let nz = p0z + (p1z - p0z) * t;
      
      if (s < segments) {
        const j = 0.01 + rng() * 0.015;
        nx += (rng() - 0.5) * j;
        ny += (rng() - 0.5) * j;
        nz += (rng() - 0.5) * j;
      }
      newPositions.push(prevX, prevY, prevZ, nx, ny, nz);
      prevX = nx; prevY = ny; prevZ = nz;
    }
  }
  
  const sketchyGeo = new THREE.BufferGeometry();
  sketchyGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  
  const mat = new THREE.LineBasicMaterial({
    color: color.clone(), transparent: true, opacity: 0.65, linewidth: 1
  });
  const lines = new THREE.LineSegments(sketchyGeo, mat);
  lines.position.copy(pos);
  lines.userData.isEdge = true;
  parent.add(lines);
  return lines;
}

// ======================== ENGINE INIT ========================
export function initEngine(canvas, { targetY = 0, initialTOD = 0.3 } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    18, window.innerWidth / window.innerHeight, 0.1, 100
  );
  camera.position.set(-9, 4, -13);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, targetY, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 30;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minPolarAngle = 0;
  controls.update();

  const sunLight = new THREE.DirectionalLight(0xfff0c4, 1.3);
  sunLight.position.set(-4.6, 5.8, 6.7);
  scene.add(sunLight);

  const ambientLight = new THREE.HemisphereLight(
    new THREE.Color(160/255, 180/255, 220/255),
    new THREE.Color(120/255, 110/255, 90/255),
    0.55
  );
  scene.add(ambientLight);

  const fillLight = new THREE.DirectionalLight(0xe8d8b8, 0.15);
  fillLight.position.set(0, -3, 2);
  scene.add(fillLight);

  let currentTOD = initialTOD;
  const timeListeners = [];
  const updateListeners = [];

    function bakePaperOverlay(tod) {
    const cv = document.getElementById('paper-bg');
    if (!cv) return;
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    const night = tod < 0.46 ? 0 : Math.min(1, (tod - 0.46) / 0.40);

    // 1. Opaque paper base
    ctx.fillStyle = '#f5ecda';
    ctx.fillRect(0, 0, w, h);

    // 2. Sky gradient
    const dusk = Math.max(0, 1 - Math.abs(tod - 0.50) / 0.22);
    function blend(dR,dG,dB, nR,nG,nB, dA, nA) {
      const r = Math.round(dR + (nR - dR) * night);
      const g = Math.round(dG + (nG - dG) * night);
      const b = Math.round(dB + (nB - dB) * night);
      const a = dA + (nA - dA) * night;
      return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.00, blend(96,142,186, 10,14,40, 0.60, 0.94));
    grad.addColorStop(0.30, blend(142,180,206, 20,26,58, 0.34, 0.86));
    grad.addColorStop(0.55, blend(214,200,172, 46,40,70, 0.20, 0.66));
    grad.addColorStop(0.72, blend(226,206,168, 40,36,66, 0.00, 0.62));
    grad.addColorStop(1.00, blend(226,206,168, 16,20,44, 0.00, 0.78));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (dusk > 0.01) {
      const dg = ctx.createLinearGradient(0, h * 0.40, 0, h * 0.72);
      dg.addColorStop(0, 'rgba(236,150,88,0)');
      dg.addColorStop(1, `rgba(240,146,84,${(0.38 * dusk).toFixed(3)})`);
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, w, h);
    }

    // 3. Paper grain
    const rng = seedRng(7);
    const dots = Math.min(8000, Math.round(w * h / 150));
    ctx.fillStyle = 'rgba(120, 100, 74, 0.06)';
    for (let i = 0; i < dots; i++) {
      ctx.fillRect(rng()*w, rng()*h, rng()*1.5+0.5, rng()*1.5+0.5);
    }

    // Reset styles that might have been applied before
    cv.style.opacity = '1';
    cv.style.mixBlendMode = 'normal';
  }

  function makeSkyBg(tod) {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');

    const night = tod < 0.46 ? 0 : Math.min(1, (tod - 0.46) / 0.40);
    const dusk = Math.max(0, 1 - Math.abs(tod - 0.50) / 0.22);

    const pr = 255, pg = 255, pb = 255;
    ctx.fillStyle = `rgb(${pr|0},${pg|0},${pb|0})`;
    ctx.fillRect(0, 0, size, size);

    function blend(dR,dG,dB, nR,nG,nB, dA, nA) {
      const r = Math.round(dR + (nR - dR) * night);
      const g = Math.round(dG + (nG - dG) * night);
      const b = Math.round(dB + (nB - dB) * night);
      const a = dA + (nA - dA) * night;
      return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }

    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0.00, blend(96,142,186, 10,14,40, 0.60, 0.94));
    grad.addColorStop(0.30, blend(142,180,206, 20,26,58, 0.34, 0.86));
    grad.addColorStop(0.55, blend(214,200,172, 46,40,70, 0.20, 0.66));
    grad.addColorStop(0.72, blend(226,206,168, 40,36,66, 0.00, 0.62));
    grad.addColorStop(1.00, blend(226,206,168, 16,20,44, 0.00, 0.78));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    if (dusk > 0.01) {
      const dg = ctx.createLinearGradient(0, size * 0.40, 0, size * 0.72);
      dg.addColorStop(0, 'rgba(236,150,88,0)');
      dg.addColorStop(1, `rgba(240,146,84,${(0.38 * dusk).toFixed(3)})`);
      ctx.fillStyle = dg;
      ctx.fillRect(0, 0, size, size);
    }

    const rng = seedRng(42);
    ctx.fillStyle = 'rgba(120,100,74,0.04)';
    for (let i = 0; i < 1600; i++) {
      ctx.fillRect(rng()*size, rng()*size, rng()*1.4+0.3, rng()*1.4+0.3);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function applyTOD(t) {
    currentTOD = t;
    const night = t < 0.46 ? 0 : Math.min(1, (t - 0.46) / 0.40);
    const dusk = Math.max(0, 1 - Math.abs(t - 0.50) / 0.22);

    const ang = Math.PI * (0.14 + t * 0.74);
    const ly = Math.max(0.20, Math.sin(ang));
    const lx = Math.cos(ang) * 0.92, lz = 0.52;
    const ln = Math.sqrt(lx*lx + ly*ly + lz*lz);
    sunLight.position.set(lx/ln * 10, ly/ln * 10, lz/ln * 10);
    sunLight.intensity = Math.max(0.15, 1.3 * (1 - night * 0.85));

    if (dusk > 0) {
      sunLight.color.setRGB(1 + 0.06 * dusk, 0.94 - 0.06 * dusk, 0.77 - 0.16 * dusk);
    } else {
      sunLight.color.setRGB(1, 0.94, 0.77);
    }

    ambientLight.color.setRGB(
      (160 - 114 * night) / 255,
      (180 - 128 * night) / 255,
      (220 - 146 * night) / 255
    );
    ambientLight.intensity = 0.55 - 0.15 * night;
    fillLight.intensity = 0.15 * (1 - night * 0.8);

    scene.background = null; bakePaperOverlay(t);
    document.body.classList.toggle('night', night > 0.5);

    const lightDir = { lx, ly, lz, ln };
    for (const l of timeListeners) {
      l(t, night, dusk, lightDir);
    }
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    bakePaperOverlay(currentTOD);
  }
  window.addEventListener('resize', onResize);

  function start() {
    applyTOD(currentTOD);
    let lastTime = 0;
    function animate(time) {
      requestAnimationFrame(animate);
      const dt = time - lastTime;
      lastTime = time;
      
      for (const l of updateListeners) {
        l(time, dt);
      }
      
      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    applyTOD,
    start,
    onTimeChange: (l) => timeListeners.push(l),
    onUpdate: (l) => updateListeners.push(l)
  };
}
