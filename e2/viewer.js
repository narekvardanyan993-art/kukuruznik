/* chka.am — движок e2 e2.0.1. СОБРАННЫЙ ФАЙЛ: не править. Исходники — e2/src/, сборка — tools/build_engine.py. */
(function () {
'use strict';
var E2 = { version: 'e2.0.1', fx: [], effect: function (e) { E2.fx.push(e); return e; } };
window.E2 = E2;

// ===== core/util.js =====
// core/util.js — мелкие общие функции (без времени и случайности: они только в core/clock.js)
E2.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
E2.sstep = function (a, b, x) { x = E2.clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
E2.glf = function (x) { return Number.isInteger(x) ? x.toFixed(1) : String(x); };              // число -> литерал GLSL
E2.v3 = function (a) { return 'vec3(' + a.map(E2.glf).join(', ') + ')'; };
E2.lerpK = function (k, dt) { return 1 - Math.pow(1 - k, dt / 16.667); };                       // сглаживание, не зависящее от частоты кадров
// Пружина как в iOS (response, damping): p 0..1 — доля времени оседания. Та же кривая, что у e1.62 (переходы кадров).
E2.spring = function (response, damping) {
  var w = 2 * Math.PI / response, z = damping, wd = w * Math.sqrt(1 - z * z);
  function x(t) { return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); }
  var T = 0, t, a = [], N = 256, i;
  for (t = 0; t < 3; t += 0.002) if (Math.abs(1 - x(t)) > 0.0015) T = t;
  for (i = 0; i <= N; i++) a.push(x(T * i / N));
  a[N] = 1;
  return function (p) { p = E2.clamp(p, 0, 1); var f = p * 256, k = f | 0; return k >= 256 ? 1 : a[k] + (a[k + 1] - a[k]) * (f - k); };
};
E2.EASE = E2.spring(0.65, 0.86);
E2.errors = [];
E2.err = function (where, e) { var m = where + ': ' + (e && e.message || e); if (E2.errors.length < 50) E2.errors.push(m); if (window.console) console.warn('[e2] ' + m); };
E2.safe = function (where, fn) { try { return fn(); } catch (e) { E2.err(where, e); } };
E2.query = function (name) { var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; };

// ===== core/clock.js =====
// core/clock.js — ЕДИНСТВЕННЫЙ источник времени и случайности движка (docs/STANOK.md §2.2, гейт G6).
// Всё, что движется, берёт время из Clock.now() и случайные числа из Clock.rng(seed). Настоящие часы, таймеры браузера,
// requestAnimationFrame и Math.random разрешены ТОЛЬКО в этом файле — гейт G6 ищет их по остальным модулям.
// Режим проверки ?vt=1: кадры не идут сами, время двигает window.__e2.advance(ms) ровными шагами — два прогона дают одинаковые пиксели.
E2.Clock = (function () {
  var virtual = /[?&]vt=1/.test(location.search);
  var now = 0, t0 = null, loop = null, timers = [], frames = 0;
  function fire(t) {
    now = t; frames++;
    if (timers.length) {
      var due = timers.filter(function (q) { return q.at <= now; });
      timers = timers.filter(function (q) { return q.at > now; });
      due.forEach(function (q) { try { q.fn(now); } catch (e) { E2.err('clock.after', e); } });
    }
    if (loop) loop(now);
  }
  function tick(ts) {
    if (t0 === null) t0 = ts;
    fire(ts - t0);
    window.requestAnimationFrame(tick);
  }
  return {
    virtual: virtual,
    now: function () { return now; },                       // мс от старта движка
    frames: function () { return frames; },
    start: function (fn) { loop = fn; if (!virtual) window.requestAnimationFrame(tick); },
    advance: function (ms, step) {                          // только ?vt=1: шаги по step мс (по умолчанию 32)
      if (!virtual) return false;
      step = step || 32;
      for (var n = Math.ceil(ms / step), i = 0; i < n; i++) fire(now + step);
      return true;
    },
    after: function (ms, fn) { timers.push({ at: now + ms, fn: fn }); },   // «через ms» по часам движка (не setTimeout)
    rng: function (seed) {                                  // mulberry32: одна и та же последовательность для одного seed
      return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    },
    real: function () { return performance.now(); },        // настоящие часы — ТОЛЬКО для замера fps (core/perf.js), на картинку не влияют
    pause: function () { return new Promise(function (r) { setTimeout(r, 0); }); }   // уступить поток при загрузке кадров (не движение)
  };
})();

// ===== core/gl.js =====
// core/gl.js — WebGL: контекст, текстуры, сборка шейдера из кусков эффектов (docs/STANOK.md §2.2).
//
// Эффект (E2.effect({...})) отдаёт куски GLSL в фиксированные крючки. Порядок крючков жёсткий:
//   uv      — куда смотреть в кадре (наклон, потом ветер)
//   base    — рисунок + подложка + здание (+ актёры)
//   tod     — время суток: день, полдень, закат, ночь, огни
//   weather — пасмурно, мокро, снег лёг
//   mix     — после смешения двух кадров (тени облаков)
//   post    — второй проход по готовой сцене (только когда эффект просит: длинные тени заката)
// Эффекта нет у здания — его кусков нет в шейдере вовсе (мёртвых веток нет).
//
// Договор о переменных внутри shadeFrame (их объявляют uv/base, остальные крючки читают и меняют):
//   vec2 uv   — точка кадра после обрезки (crop);  vec2 sc — точка экрана 0..1
//   vec2 p    — точка выборки земли после наклона; vec2 pc = clamp(p)
//   vec2 pb   — точка выборки слоя здания;         float bdL — глубина здания в точке
//   vec4 env  — карта окружения в p (r глубина, g небо, b дерево, a фаза)
//   vec4 b    — слой здания (цвет умножен на альфу); float inv = 1 - b.a
//   vec3 c    — цвет; float sky — доля неба в точке
// Кадров в шейдере два (A уходит, B приходит): у каждого эффекта свои текстуры и числа кадра (frameSamplers, frameUniforms).
E2.GL = (function () {
  var gl = null, canvas = null;
  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'varying vec2 vTc;',
    'void main() {',
    '  vTc = aPos * 0.5 + 0.5;',
    '  vUv = vec2(vTc.x, 1.0 - vTc.y);',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  function init(cv) {
    canvas = cv;
    gl = cv.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false }) || cv.getContext('experimental-webgl');
    return gl;
  }
  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('шейдер не собрался: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('программа не слинковалась: ' + gl.getProgramInfoLog(p));
    var U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), i;
    for (i = 0; i < n; i++) { var nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); U[nm] = gl.getUniformLocation(p, nm); }
    return { prg: p, U: U };
  }
  function texture(filter) {
    var t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    return t;
  }
  function texRGB(w, h, data) { var t = texture(); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, data); return t; }
  function texRGBA(w, h, data) { var t = texture(); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); return t; }

  // Собирает оба шейдера сцены из кусков включённых эффектов. Возвращает исходники и раскладку текстур по юнитам.
  function compose(effects, cfg) {
    var samplers = [], fUni = [], uni = [], funcs = [], hooks = { uv: [], base: [], tod: [], weather: [], mix: [], post: [] }, postUni = [];
    effects.forEach(function (e) {
      var g = e.glsl ? e.glsl(cfg) : null;
      if (!g) return;
      (e.frameSamplers || []).forEach(function (s) { samplers.push(s); });
      (e.frameUniforms || []).forEach(function (u) { fUni.push(u); });
      (g.uniforms || []).forEach(function (u) { uni.push(u); });
      if (g.funcs) funcs.push('// --- ' + e.name + ' ---\n' + g.funcs);
      Object.keys(hooks).forEach(function (h) { if (g[h]) hooks[h].push('  // --- ' + e.name + ' · ' + h + ' ---\n' + g[h]); });
      (g.postUniforms || []).forEach(function (u) { postUni.push(u); });
    });
    var units = gl ? gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) : 16;
    if (samplers.length * 2 > units) throw new Error('эффектам нужно ' + samplers.length * 2 + ' текстур на пиксель, устройство даёт ' + units);
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    var decl = [], sig = [], argsA = [], argsB = [];
    samplers.forEach(function (s) { decl.push('uniform sampler2D u' + cap(s) + 'A; uniform sampler2D u' + cap(s) + 'B;'); sig.push('sampler2D ' + s); argsA.push('u' + cap(s) + 'A'); argsB.push('u' + cap(s) + 'B'); });
    fUni.forEach(function (u) { decl.push('uniform ' + u[0] + ' u' + cap(u[1]) + 'A; uniform ' + u[0] + ' u' + cap(u[1]) + 'B;'); sig.push(u[0] + ' ' + u[1]); argsA.push('u' + cap(u[1]) + 'A'); argsB.push('u' + cap(u[1]) + 'B'); });
    var frag = [
      'precision highp float;',
      'varying vec2 vUv;',
      'uniform vec2 uCoverScale; uniform vec2 uCoverOffset; uniform float uScale; uniform vec2 uFadeZoom; uniform float uMix; uniform float uAspect;',
      decl.join('\n'),
      uni.join('\n'),
      funcs.join('\n'),
      'vec4 shadeFrame(' + sig.concat(['vec2 uv', 'vec2 sc']).join(', ') + ') {',
      hooks.uv.join('\n'), hooks.base.join('\n'), hooks.tod.join('\n'), hooks.weather.join('\n'),
      '  return vec4(c, sky);',
      '}',
      'void main() {',
      '  vec2 uv = vUv * uCoverScale + uCoverOffset;',
      '  uv = 0.5 + (uv - 0.5) / uScale;',
      '  vec2 uvA = 0.5 + (uv - 0.5) / uFadeZoom.x;',
      '  vec4 sa = shadeFrame(' + argsA.concat(['uvA', 'vUv']).join(', ') + ');',
      '  if (uMix > 0.0) {',
      '    vec2 uvB = 0.5 + (uv - 0.5) / uFadeZoom.y;',
      '    sa = mix(sa, shadeFrame(' + argsB.concat(['uvB', 'vUv']).join(', ') + '), uMix);',
      '  }',
      '  vec3 c = sa.rgb;',
      hooks.mix.join('\n'),
      '  gl_FragColor = vec4(c, 1.0);',
      '}'
    ].filter(function (l) { return l !== ''; }).join('\n');
    var post = hooks.post.length ? [
      'precision highp float;',
      'varying vec2 vTc;',
      'uniform sampler2D uScene; uniform float uAspect;',
      postUni.join('\n'),
      'float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
      'void main() {',
      '  vec3 c = texture2D(uScene, vTc).rgb;',
      hooks.post.join('\n'),
      '  gl_FragColor = vec4(c, 1.0);',
      '}'
    ].join('\n') : null;
    return { vert: VERT, frag: frag, post: post, samplers: samplers, frameUniforms: fUni,
      stats: { samplersPerFrame: samplers.length, units: samplers.length * 2, lookups: (frag.match(/texture2D\(/g) || []).length } };
  }

  var fbo = null, sceneTex = null, fboW = 0, fboH = 0;
  function ensureFbo(w, h) {
    if (fbo && fboW === w && fboH === h) return fbo;
    if (sceneTex) gl.deleteTexture(sceneTex);
    if (fbo) gl.deleteFramebuffer(fbo);
    sceneTex = texture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fboW = w; fboH = h;
    return fbo;
  }
  function quad() {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return b;
  }
  return {
    init: init, gl: function () { return gl; }, canvas: function () { return canvas; },
    program: program, compose: compose, texture: texture, texRGB: texRGB, texRGBA: texRGBA,
    ensureFbo: ensureFbo, sceneTex: function () { return sceneTex; }, quad: quad, VERT: VERT,
    reset: function () { fbo = null; sceneTex = null; fboW = fboH = 0; }
  };
})();

// ===== core/perf.js =====
// core/perf.js — ступени качества (docs/STANOK.md §5.1–5.2): full → lite → min. Кнопки в интерфейсе нет; проверка: ?tier=lite|min.
// Замер fps идёт по НАСТОЯЩИМ часам (E2.Clock.real) и на картинку не влияет; под виртуальным временем (?vt=1) ступень не меняется.
// П1: ступень задаёт плотность пикселей и «дыхание» камеры; порядок отключения эффектов (частицы, ветер, небо) — с их появлением (П2–П3, П6).
E2.Perf = (function () {
  var TIERS = { full: { dpr: 2 }, lite: { dpr: 1.5 }, min: { dpr: 1 } }, ORDER = ['full', 'lite', 'min'];
  var forced = E2.query('tier'), tier = TIERS[forced] ? forced : 'full', auto = !TIERS[forced] && E2.query('perf') !== '0' && !E2.Clock.virtual;
  var n = 0, t0 = 0, low = 0, best = 0, minFps = 45, onChange = null;
  return {
    tier: function () { return tier; },
    dpr: function () { return Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr); },
    onChange: function (fn) { onChange = fn; },
    frame: function () {                     // раз в кадр; окно 2,5 с; два медленных окна подряд — ступень вниз
      if (!auto) return;
      var t = E2.Clock.real();
      if (!t0) { t0 = t; n = 0; return; }
      n++;
      if (t - t0 < 2500) return;
      var fps = n * 1000 / (t - t0); t0 = t; n = 0;
      if (fps > best) best = fps;
      var floor = best < 35 ? 24 : minFps;   // iPhone в энергосбережении держит 30 — это норма, ступень не снижаем
      if (fps < floor) { if (++low >= 2 && tier !== 'min') { low = 0; tier = ORDER[ORDER.indexOf(tier) + 1]; if (onChange) onChange(tier); } } else low = 0;
    }
  };
})();

// ===== core/frames.js =====
// core/frames.js — загрузка кадров: первый (день) сразу, остальное по одному в фоне. Тяжёлая подготовка картинок — core/prep.js
// (Web Worker, если есть; иначе в главном потоке). Какие файлы и текстуры нужны — говорит каждый эффект (frameFiles, upload, states).
E2.Frames = (function () {
  var store = [], dayP = [], stateP = [], cfg = null, fx = [], G = null, prep = null, prepCfg = null;
  function abs(u) { return new URL(u, location.href).href; }
  function absAll(o) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = typeof o[k] === 'string' ? abs(o[k]) : absAll(o[k]); }); return r; }
  function makePrep() {
    var FW = cfg.look.frameSize[0], FH = cfg.look.frameSize[1];
    var pc = { MAX_TEX_SIZE: 1600, STARS: 120, STAR_CELLS: [Math.max(1, Math.round(FW / 24)), Math.max(1, Math.round(FH / 24))], FRAME_SIZE: cfg.look.frameSize,
      // свет окон и ночь — эффект lights (П2); пока постоянные e1.62, на день и закат не влияют
      NIGHT_MAIN_LIT: [0, 0], NIGHT_OTHER_LIT: [0.4, 0.6], WINDOW_BRIGHT: [0.6, 1], NIGHT_WINS: cfg.frames.map(function () { return false; }), NIGHT_MAIN_WINS: false, NIGHT_EDGE: 'solid', FIG_ON: false };
    fx.forEach(function (e) { if (e.prepCfg) { var a = e.prepCfg(cfg); Object.keys(a).forEach(function (k) { pc[k] = a[k]; }); } });
    prepCfg = pc;
    var url = abs(cfg.engine.base + 'prep.js?v=' + cfg.engine.version), worker = null, pend = {}, seq = 0, mainP = null;
    function viaMain(method, args) {
      if (!mainP) mainP = new Promise(function (res, rej) {
        var sc = document.createElement('script');
        sc.src = url; sc.onload = function () { window.Prep.init(pc).then(res); }; sc.onerror = function () { rej(new Error('prep.js не загрузился')); };
        document.head.appendChild(sc);
      });
      return mainP.then(function () { return window.Prep[method].apply(null, args); });
    }
    if (window.Worker && window.OffscreenCanvas && window.createImageBitmap && E2.query('noworker') !== '1') {
      try {
        worker = new Worker(url);
        worker.onmessage = function (e) { var m = e.data, q = pend[m.id]; delete pend[m.id]; if (q) { if (m.ok) q.res(m.res); else q.rej(new Error(m.err)); } };
        worker.onerror = function () { worker = null; Object.keys(pend).forEach(function (id) { var q = pend[id]; delete pend[id]; viaMain(q.method, q.args).then(q.res, q.rej); }); };
        worker.postMessage({ id: ++seq, method: 'init', args: [pc] });
      } catch (err) { worker = null; }
    }
    return function (method, args) {
      if (!worker) return viaMain(method, args);
      return new Promise(function (res, rej) { var id = ++seq; pend[id] = { res: res, rej: rej, method: method, args: args }; worker.postMessage({ id: id, method: method, args: args }); });
    };
  }
  function loadDay(i) {
    if (dayP[i]) return dayP[i];
    var f = cfg.frames[i], files = {};
    fx.forEach(function (e) { if (e.frameFiles) { var a = absAll(e.frameFiles(f)); Object.keys(a).forEach(function (k) { files[k] = a[k]; }); } });
    dayP[i] = prep('day', [files, i]).then(function (r) {
      var entry = { idx: i, name: f.name, cfg: f, w: r.w, h: r.h, depthMap: r.depth };
      var chain = Promise.resolve();
      fx.forEach(function (e) { if (e.upload) chain = chain.then(function () { e.upload(G, entry, r); return E2.Clock.pause(); }); });
      return chain.then(function () { store[i] = entry; return entry; });
    });
    dayP[i].catch(function (err) { E2.err('кадр ' + (i + 1), err); dayP[i] = null; });
    return dayP[i];
  }
  function loadStates(i) {   // версии кадра (закат; ночь — П2): в фоне; пока их нет, кадр живёт без них
    if (stateP[i]) return stateP[i];
    stateP[i] = loadDay(i).then(function (entry) {
      var chain = Promise.resolve();
      fx.forEach(function (e) {
        (e.states ? e.states(cfg.frames[i]) : []).forEach(function (st) {
          chain = chain.then(function () { return prep('state', [i, st[0], abs(st[1])]); })
            .then(function (r) { e.uploadState(G, entry, st[0], r); return E2.Clock.pause(); })
            .catch(function (err) { E2.err('кадр ' + (i + 1) + ' ' + st[0], err); });
        });
      });
      return chain;
    });
    return stateP[i];
  }
  return {
    init: function (c, effects) { cfg = c; fx = effects; G = E2.GL; prep = makePrep(); },
    get: function (i) { return store[i]; },
    count: function () { return cfg.frames.length; },
    prepCfg: function () { return prepCfg; },   // что получила подготовка картинок (гейт G8: ключ-эхо)
    loadDay: loadDay, loadStates: loadStates,
    loadAll: function (first) {   // первый кадр, его версии, затем остальные по одному
      var order = [first]; for (var i = 0; i < cfg.frames.length; i++) if (i !== first) order.push(i);
      return order.reduce(function (p, i) { return p.then(function () { return loadDay(i); }).then(function () { return loadStates(i); }); }, Promise.resolve());
    },
    reset: function () { store.length = 0; dayP = []; stateP = []; }
  };
})();

// ===== core/stage.js =====
// core/stage.js — сцена: холст, размер («cover»), ввод (мышь, палец, гироскоп), наклон, смена кадров, цикл рисования.
// Время — только из E2.Clock. Эффекты получают общее состояние S и сами считают свои числа (step → uniforms).
E2.Stage = (function () {
  var cfg, fx, G, gl, canvas, stageEl, scene = null, post = null, quad = null, layout = null, lost = false;
  var S = { t: 0, dt: 16.667, tiltX: 0, tiltY: 0, shiftX: 0, shiftY: 0, zoom: 0, mix: 0, fa: null, fb: null, tier: 'full', still: false, cfg: null };
  var targetX = 0, targetY = 0, curX = 0, curY = 0, ret = null, pointer = false, dragId = null, dsx = 0, dsy = 0, dbx = 0, dby = 0;
  var frameIndex = 0, fade = null, zoomA = 1, zoomB = 1, lastT = null, natW = 768, natH = 1365;
  var cover = { w: 1, h: 1, x: 0, y: 0 }, lastW = 0, lastH = 0, drawn = 0;

  function resize(force) {
    var cssW = stageEl.clientWidth, cssH = stageEl.clientHeight;
    if (!force && cssW === lastW && cssH === lastH) return;
    lastW = cssW; lastH = cssH;
    var d = E2.Perf.dpr(), w = Math.round(cssW * d), h = Math.round(cssH * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var k = Math.max(cssW / natW, cssH / natH);   // как CSS background-size: cover
    cover.w = cssW / (natW * k); cover.h = cssH / (natH * k); cover.x = (1 - cover.w) / 2; cover.y = (1 - cover.h) / 2;
  }
  function build() {   // шейдеры из кусков эффектов
    var src = G.compose(fx, cfg);
    layout = src;
    scene = G.program(src.vert, src.frag);
    post = src.post ? G.program(src.vert, src.post) : null;
    quad = G.quad();
    gl.useProgram(scene.prg);
    src.samplers.forEach(function (s, i) {
      var n = 'u' + s.charAt(0).toUpperCase() + s.slice(1);
      gl.uniform1i(scene.U[n + 'A'], i); gl.uniform1i(scene.U[n + 'B'], src.samplers.length + i);
    });
    if (post) { gl.useProgram(post.prg); gl.uniform1i(post.U.uScene, 0); }
  }
  function bindFrame(f, slot, unit0) {
    var u = unit0;
    fx.forEach(function (e) {
      var tex = e.textures ? e.textures(f) : (e.frameSamplers || []).map(function (s) { return f[s]; });
      tex.forEach(function (t) { gl.activeTexture(gl.TEXTURE0 + u++); gl.bindTexture(gl.TEXTURE_2D, t); });
      if (e.bind) e.bind(gl, scene.U, f, slot);
    });
  }
  function draw() {
    var fa = S.fa, fb = S.fb, U = scene.U, P = cfg.effects.parallax;
    var needPost = !!post && fx.some(function (e) { return e.needsPost && e.needsPost(S); });
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, needPost ? G.ensureFbo(canvas.width, canvas.height) : null);
    gl.useProgram(scene.prg);
    bindFrame(fa, 'A', 0);
    if (fb) bindFrame(fb, 'B', layout.samplers.length);
    gl.uniform2f(U.uCoverScale, cover.w, cover.h); gl.uniform2f(U.uCoverOffset, cover.x, cover.y);
    gl.uniform1f(U.uScale, P.baseScale); gl.uniform2f(U.uFadeZoom, zoomA, zoomB);
    gl.uniform1f(U.uMix, S.mix); gl.uniform1f(U.uAspect, canvas.width / canvas.height);
    fx.forEach(function (e) { if (e.uniforms) e.uniforms(gl, U, S); });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (needPost) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(post.prg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.sceneTex());
      gl.uniform1f(post.U.uAspect, canvas.width / canvas.height);
      fx.forEach(function (e) { if (e.postUniforms) e.postUniforms(gl, post.U, S); });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    drawn++;
  }
  function step(now) {
    var P = cfg.effects.parallax;
    S.dt = lastT === null ? 16.667 : E2.clamp(now - lastT, 1, 64); lastT = now; S.t = now;
    E2.Perf.frame(); S.tier = E2.Perf.tier();
    if (fade) {   // смена кадра: уходящий медленно приближается и растворяется, следующий проявляется из лёгкого отдаления
      if (fade.t0 === null) fade.t0 = now;
      var p = (now - fade.t0) / P.crossfadeMs;
      if (p >= 1) { frameIndex = fade.to; fade = null; S.mix = 0; zoomA = 1; zoomB = 1; }
      else { S.mix = E2.clamp(E2.EASE(p), 0, 1); zoomA = 1 + 0.06 * S.mix; zoomB = 1.04 - 0.04 * S.mix; }
    }
    if (ret) {
      if (ret.t0 === null) ret.t0 = now;
      var e = E2.EASE((now - ret.t0) / P.returnMs);
      curX = ret.fx + (targetX - ret.fx) * e; curY = ret.fy + (targetY - ret.fy) * e;
      if (now - ret.t0 >= P.returnMs) ret = null;
    } else {
      var k = E2.lerpK(pointer ? 0.35 : P.smooth, S.dt);
      curX += (targetX - curX) * k; curY += (targetY - curY) * k;
    }
    S.tiltX = E2.clamp(curX, -1, 1); S.tiltY = E2.clamp(curY, -1, 1);
    resize(false);
    S.fa = E2.Frames.get(fade ? fade.from : frameIndex);
    S.fb = fade ? E2.Frames.get(fade.to) : null;
    if (!S.fa || (fade && !S.fb) || lost) return;
    fx.forEach(function (ef) { if (ef.step) E2.safe(ef.name + '.step', function () { ef.step(S); }); });
    draw();
  }
  function input() {
    function fromClient(x, y) {
      var r = stageEl.getBoundingClientRect();
      targetX = E2.clamp((x - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
      targetY = E2.clamp((y - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
    }
    stageEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') { fromClient(e.clientX, e.clientY); return; }
      pointer = true; dragId = e.pointerId; ret = null; dsx = e.clientX; dsy = e.clientY; dbx = curX; dby = curY;
    });
    stageEl.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'mouse') { fromClient(e.clientX, e.clientY); return; }
      if (!pointer || e.pointerId !== dragId) return;
      var W = stageEl.clientWidth || 1;   // палец: протяжка на всю ширину экрана = полный наклон
      targetX = E2.clamp(dbx + 2 * (e.clientX - dsx) / W, -1, 1); targetY = E2.clamp(dby + 2 * (e.clientY - dsy) / W, -1, 1);
    });
    function up(e) { if (!pointer || e.pointerId !== dragId) return; pointer = false; targetX = gx; targetY = gy; ret = { t0: null, fx: curX, fy: curY }; }
    stageEl.addEventListener('pointerup', up); stageEl.addEventListener('pointercancel', up);
    var gx = 0, gy = 0, b0 = null, g0 = null, deg = cfg.effects.parallax.maxTiltDeg;
    window.addEventListener('deviceorientation', function (e) {   // на iPhone нужен жест и разрешение — запрос делает интерфейс (П5)
      if (e.beta === null || e.gamma === null || e.beta === undefined) return;
      if (b0 === null) { b0 = e.beta; g0 = e.gamma; }
      gx = E2.clamp((e.gamma - g0) / deg, -1, 1); gy = E2.clamp((e.beta - b0) / deg, -1, 1);
      if (!pointer) { targetX = gx; targetY = gy; }
    });
    window.addEventListener('resize', function () { resize(true); });
  }
  return {
    init: function (c, effects, el) {
      cfg = c; fx = effects; G = E2.GL; stageEl = el; S.cfg = cfg; S.still = E2.query('still') === '1';
      natW = cfg.look.frameSize[0]; natH = cfg.look.frameSize[1];
      canvas = document.createElement('canvas'); canvas.id = 'gl'; el.appendChild(canvas);
      gl = G.init(canvas);
      if (!gl) throw new Error('нет WebGL');
      build(); resize(true); input();
      canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; E2.err('webgl', 'контекст потерян'); });
      canvas.addEventListener('webglcontextrestored', function () {   // iPhone при нехватке памяти: всё заново с видимого кадра
        E2.safe('webgl restore', function () { G.reset(); build(); E2.Frames.reset(); E2.Frames.loadAll(frameIndex).then(function () { lost = false; }); E2.Frames.loadDay(frameIndex).then(function () { lost = false; }); });
      });
      E2.Perf.onChange(function () { resize(true); });
      E2.Clock.start(step);
    },
    go: function (i) { var n = E2.Frames.count(); i = ((i % n) + n) % n; if (fade || i === frameIndex || !E2.Frames.get(i)) return false; fade = { from: frameIndex, to: i, t0: null }; return true; },
    tilt: function (x, y) { ret = null; targetX = curX = x; targetY = curY = y; },   // для проверок: наклон сразу, без сглаживания
    frame: function () { return frameIndex; },
    fading: function () { return !!fade; },
    state: function () { return { frame: frameIndex, fading: !!fade, tier: S.tier, drawn: drawn, canvas: [canvas.width, canvas.height], shift: [S.shiftX, S.shiftY, S.zoom], lost: lost, stats: layout.stats }; },
    shaders: function () { return { frag: layout.frag, post: layout.post }; },
    pixels: function () {   // пиксели холста сразу после кадра (для гейтов и паритета): RGBA, строки снизу вверх
      var w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w: w, h: h, data: px };
    }
  };
})();

// ===== core/ui.js =====
// core/ui.js — П1: только самое нужное, чтобы полигон можно было открыть и проверить: кнопки «День» / «Закат», стрелки кадров
// и доступ для проверок window.__e2. Панель, плашка, точки, язык, открытка, надписи переезжают в П5–П6 (docs/STANOK.md §7).
E2.UI = {
  init: function (cfg, fx) {
    var tod = fx.filter(function (e) { return e.name === 'tod'; })[0];
    function setTod(name) {
      if (!tod || !tod.set(name, { cfg: cfg })) return false;
      Array.prototype.forEach.call(document.querySelectorAll('[data-tod]'), function (b) { b.classList.toggle('on', b.getAttribute('data-tod') === name); });
      return true;
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-tod]'), function (b) { b.addEventListener('click', function () { setTod(b.getAttribute('data-tod')); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.addEventListener('click', function () { E2.Stage.go(E2.Stage.frame() + (+b.getAttribute('data-go'))); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') E2.Stage.go(E2.Stage.frame() + 1); if (e.key === 'ArrowLeft') E2.Stage.go(E2.Stage.frame() - 1); });
    window.__e2 = {
      version: cfg.engine.version,
      advance: function (ms, step) { return E2.Clock.advance(ms, step); },   // только ?vt=1
      now: function () { return E2.Clock.now(); },
      setTod: setTod, tod: function () { return tod ? { name: tod.state.name, p: tod.state.p, busy: tod.busy() } : null; },
      go: function (i) { return E2.Stage.go(i); }, tilt: function (x, y) { E2.Stage.tilt(x, y); },
      state: function () { return E2.Stage.state(); }, shaders: function () { return E2.Stage.shaders(); },
      pixels: function () { return E2.Stage.pixels(); }, errors: function () { return E2.errors.slice(); },
      loaded: function (i) { var f = E2.Frames.get(i); return !!f; },
      prepCfg: function () { return JSON.parse(JSON.stringify(E2.Frames.prepCfg())); }
    };
  }
};

// ===== fx/parallax.js =====
// fx/parallax.js — наклон по глубине: земля и слой здания смещаются по своим картам глубины (docs/STANOK.md §2.2).
// Один режим: глубина здания — по точкам (в альфе текстуры земли). Крупные планы и интерьеры почти плоские (tilt кадра 0,2).
// Математика шейдера перенесена из e1.62 без изменений — доказательство: python3 tools/stanok.py parity (П1: 36 снимков Погоса, 0 отличий).
E2.effect({
  name: 'parallax',
  low: 'lite',          // на слабой ступени: без «дыхания» камеры
  cost: 3,
  frameSamplers: ['bg', 'depth', 'bld'],            // земля (rgb + глубина здания в a), карта окружения, слой здания
  frameUniforms: [['vec4', 'crop'], ['vec3', 'kd']],
  glsl: function () {
    return {
      uniforms: ['uniform vec2 uShift; uniform float uZoom;'],
      uv: [
        '  uv = crop.xy + uv * crop.zw;',
        '  vec2 p = uv;',
        '  for (int i = 0; i < 3; i++) {',
        '    float d = texture2D(depth, p).r;',
        '    float k = d * 2.0 - 1.0;',
        '    p = 0.5 + (uv - 0.5) / (1.0 + uZoom * d) - k * uShift;',
        '  }',
        '  vec4 env = texture2D(depth, p);',
        '  vec2 pc = clamp(p, 0.0, 1.0);',
        '  vec2 pb = 0.5 + (uv - 0.5) / (1.0 + uZoom * kd.y) - kd.x * uShift;',
        '  float bdL = kd.y;',
        '  if (kd.z > 0.5) {',
        '    for (int i = 0; i < 3; i++) {',
        '      bdL = texture2D(bg, clamp(pb, 0.0, 1.0)).a;',
        '      pb = 0.5 + (uv - 0.5) / (1.0 + uZoom * bdL) - (bdL * 2.0 - 1.0) * uShift;',
        '    }',
        '  }'
      ].join('\n'),
      base: [
        '  vec3 c = texture2D(bg, pc).rgb;',
        '  float sky = env.g;',
        '  vec4 b = texture2D(bld, pb);',
        '  c = b.rgb + c * (1.0 - b.a);',
        '  float inv = 1.0 - b.a;',
        '  sky *= inv;'
      ].join('\n')
    };
  },
  // что нужно подготовке картинок (core/prep.js) от этого эффекта
  prepCfg: function (cfg) { return { DEPTH_BLUR_PX: cfg.effects.parallax.depthBlurPx, BUILDING_DEPTH_PIXEL: true }; },
  frameFiles: function (f) { return { color: f.files.color, depth: f.files.depth, bg: { color: f.files.bg }, building: { color: f.files.building }, env: f.files.env, win2: f.files.win }; },
  upload: function (G, entry, r) {
    entry.bg = r.ground4 ? G.texRGBA(r.w, r.h, r.ground4) : G.texRGB(r.w, r.h, r.ground);
    entry.depth = G.texRGBA(r.ew, r.eh, r.gpuDepth);
    entry.bld = G.texRGBA(r.w, r.h, r.bldPm);
    entry.kd = [r.kB, r.dB, r.bldD ? 1 : 0];
    var c = entry.cfg.effects.parallax.crop;
    entry.crop = new Float32Array([c[0], c[1], c[2] - c[0], c[3] - c[1]]);
    entry.tiltK = entry.cfg.effects.parallax.tilt;
  },
  bind: function (gl, U, f, s) { gl.uniform4fv(U['uCrop' + s], f.crop); gl.uniform3f(U['uKd' + s], f.kd[0], f.kd[1], f.kd[2]); },
  step: function (S) {
    var P = S.cfg.effects.parallax, t = S.t / 1000;
    var ba = (S.still || S.tier !== 'full') ? 0 : P.breath.amp;
    var bx = ba * Math.sin(t * 2 * Math.PI / P.breath.periodS), by = ba * Math.cos(t * 2 * Math.PI / (P.breath.periodS * 0.7));
    var tkA = S.fa ? S.fa.tiltK : 1, tkB = S.fb ? S.fb.tiltK : tkA, tk = tkA + (tkB - tkA) * (S.fb ? S.mix : 0);
    S.shiftX = S.tiltX * P.shiftX * tk + bx;
    S.shiftY = S.tiltY * P.shiftY * tk + by;
    S.zoom = P.zoomNear * E2.clamp(S.tiltY, 0, 1) * tk;       // наклон к себе — ближнее чуть крупнее
  },
  uniforms: function (gl, U, S) { gl.uniform2f(U.uShift, S.shiftX, S.shiftY); gl.uniform1f(U.uZoom, S.zoom); }
});

// ===== fx/tod.js =====
// fx/tod.js — время суток: день (небо и зелень), полдень (снять «золотой час» рисунка), закат (docs/STANOK.md §2.2, §4.1).
// П1: день и закат. Ночь, огни и звёзды — эффект lights (П2).
// Закат: если у кадра есть закатный рисунок (<кадр>_sunset.webp) — он проявляется поверх дня; нет — тёплый тон считает шейдер
// и второй проход кладёт тени. Оба пути перенесены из e1.62 для паритета; цель станка — закатный рисунок пишет шаг S3 (ответ Нарека 1Б).
// Математика шейдера — из e1.62 без изменений (проверка: python3 tools/stanok.py parity).
E2.effect({
  name: 'tod',
  low: 'on',
  cost: 4,
  frameSamplers: ['em', 'sg', 'sb'],                 // окна (маски), закат: земля и вся картинка
  frameUniforms: [['vec2', 'skyRef'], ['float', 'hasS'], ['float', 'noonK']],
  P: { day: 0, sunset: 1, night: 2.1667 },
  state: { p: 0, s: 0, sun: 0, name: 'day', anim: null },
  glsl: function (cfg) {
    var T = cfg.effects.tod, D = T.day, N = T.noon, SP = T.sunsetProc, SH = T.sunsetShade, glf = E2.glf, v3 = E2.v3;
    var FW = cfg.look.frameSize[0], FH = cfg.look.frameSize[1], EW = (FW + 1) >> 1, EH = (FH + 1) >> 1;
    var right = cfg.look.sunSide !== 'left';
    var tod = [
      '  vec4 eg = texture2D(em, pc);',
      '  vec4 eb = texture2D(em, pb);',
      '  {',
      '    vec3 cOrig = c;',
      '    float lum0 = dot(c, vec3(0.299, 0.587, 0.114));',
      '    float rel = lum0 / skyRef.x;',
      '    vec3 skyCol = mix(DAY_SKY_TOP, DAY_SKY_HOR, smoothstep(0.02, 0.42, uv.y));',
      '    vec3 tinted = skyCol * clamp(rel, 0.0, 1.06);',
      '    tinted = mix(tinted, vec3(min(1.0, lum0 * 1.05 + 0.02)), smoothstep(1.03, 1.12, rel) * 0.75);',
      '    float haloW = 0.0;',
      '    if (b.a > 0.05 && b.a < 0.999 || (b.a >= 0.999 && rel > 0.90)) {',
      '      vec2 hd = vec2(4.5 / ' + FW.toFixed(1) + ', 4.5 / ' + FH.toFixed(1) + ');',
      '      float mn = min(min(texture2D(bld, pb + vec2(hd.x, 0.0)).a, texture2D(bld, pb - vec2(hd.x, 0.0)).a), min(texture2D(bld, pb + vec2(0.0, hd.y)).a, texture2D(bld, pb - vec2(0.0, hd.y)).a));',
      '      haloW = (1.0 - smoothstep(0.3, 0.95, mn)) * smoothstep(0.90, 1.02, rel);',
      '    }',
      '    float ringW = 0.0;',
      '    if (sky < 0.5 && rel > 0.92) {',
      '      vec2 e1 = vec2(2.0 / ' + EW.toFixed(1) + ', 2.0 / ' + EH.toFixed(1) + '), e2 = e1 * 2.0;',
      '      float sn = max(max(texture2D(depth, p + vec2(e1.x, 0.0)).g, texture2D(depth, p - vec2(e1.x, 0.0)).g), max(texture2D(depth, p + vec2(0.0, e1.y)).g, texture2D(depth, p - vec2(0.0, e1.y)).g));',
      '      sn = max(sn, max(max(texture2D(depth, p + vec2(e2.x, 0.0)).g, texture2D(depth, p - vec2(e2.x, 0.0)).g), max(texture2D(depth, p + vec2(0.0, e2.y)).g, texture2D(depth, p - vec2(0.0, e2.y)).g)));',
      '      ringW = smoothstep(0.3, 0.8, sn) * smoothstep(0.92, 1.0, rel);',
      '    }',
      '    float skyW = max(max(smoothstep(0.35, 0.85, sky), haloW), ringW);',
      '    skyW *= (1.0 - smoothstep(0.10, 0.19, c.r - c.b)) * (1.0 - smoothstep(skyRef.y - 0.03, skyRef.y + 0.01, uv.y)) * (1.0 - smoothstep(0.12, 0.28, env.r));',
      '    c = mix(c, mix(c, tinted, smoothstep(0.55, 0.85, rel)), skyW);',
      '    vec3 hv = rgb2hsv(c);',
      '    float gw = smoothstep(0.10, 0.16, hv.x) * (1.0 - smoothstep(0.36, 0.45, hv.x)) * smoothstep(0.06, 0.16, hv.y) * smoothstep(0.18, 0.40, hv.z) * (1.0 - skyW);',
      '    hv.x = mix(hv.x, GREEN_HUE, gw * GREEN_PULL);',
      '    hv.y = clamp(hv.y * (1.0 + gw * (GREEN_SAT - 1.0)) + gw * 0.05, 0.0, 1.0);',
      '    c = mix(c, hsv2rgb(hv), step(0.001, gw));',
      '    c = mix(cOrig, c, DAY_MIX);',
      N ? [
        '    float nk = noonK * (1.0 - uSunset);',
        '    if (nk > 0.001) {',
        '      float nl = dot(c, vec3(0.299, 0.587, 0.114));',
        '      vec3 cw = c * ' + v3(N.wb) + ';',
        '      cw *= nl / max(dot(cw, vec3(0.299, 0.587, 0.114)), 0.001);',
        '      vec3 nh = rgb2hsv(clamp(cw, 0.0, 1.0));',
        '      nh.y *= 1.0 - ' + glf(1 - N.sat) + ' * smoothstep(0.0, 0.025, nh.x) * (1.0 - smoothstep(0.12, 0.17, nh.x));',
        '      cw = hsv2rgb(nh);',
        '      float nl2 = dot(cw, vec3(0.299, 0.587, 0.114));',
        '      cw += ' + glf(N.lift) + ' * (1.0 - cw) * smoothstep(0.10, 0.28, nl2) * (1.0 - smoothstep(0.45, 0.80, nl2));',
        '      cw = clamp(cw * ' + glf(N.bright) + ', 0.0, 1.0);',
        '      float nsw = smoothstep(0.35, 0.85, sky) * smoothstep(0.55, 0.85, rel) * (1.0 - smoothstep(skyRef.y - 0.03, skyRef.y + 0.01, uv.y)) * ' + glf(N.sky) + ';',
        '      cw = mix(cw, skyCol * clamp(rel, 0.0, 1.06), nsw);',
        '      c = mix(c, cw, nk);',
        '    }'
      ].join('\n') : '',
      '  }',
      '  float winNight = eb.r * b.a + eg.g * inv;',
      '  float winBase = max(eb.b * b.a, eg.a * inv);',
      '  if (uSunset > 0.001 && hasS < 0.5) {',
      '    vec3 warm = c * ' + v3(SP.tint) + ';',
      '    vec3 skyTint = mix(' + v3(SP.skyLow) + ', ' + v3(SP.skyHigh) + ', smoothstep(0.10, 0.62, sc.y));',
      '    warm = mix(warm, c * skyTint * 1.02 + skyTint * 0.05, sky * 0.85);',
      '    vec2 gd = (sc - vec2(' + (right ? '1.08' : '-0.08') + ', 0.52)) * vec2(uAspect * 0.9, 1.0);',
      '    warm += ' + v3(SP.glowColor) + ' * exp(-dot(gd, gd) * 5.0) * ' + glf(SP.glowStrength) + ';',
      '    warm += ' + v3(SP.windowColor) + ' * winBase * ' + glf(SP.windowStrength) + ';',
      '    c = mix(c, warm, uSunset);',
      '  }',
      '  if (hasS > 0.5 && uSunMix > 0.001) c = mix(c, texture2D(sb, pb).rgb * b.a + texture2D(sg, pc).rgb * inv, uSunMix);'
    ].filter(function (l) { return l !== ''; }).join('\n');
    var post = [
      '  if (uSunsetPost > 0.001) {',
      SH.strength > 0 ? [
        '    vec2 dir = vec2(' + (right ? '1.0' : '-1.0') + ', -0.28) * ' + glf(SH.length) + ';',
        '    float smear = 0.0;',
        '    for (int i = 1; i <= 10; i++) {',
        '      vec3 tap = texture2D(uScene, vTc - dir * float(i)).rgb;',
        '      smear += smoothstep(0.62, 0.30, lum(tap)) * (1.0 - float(i) / 11.0);',
        '    }',
        '    smear = clamp(smear / 4.0, 0.0, 1.0);'
      ].join('\n') : '    float smear = 0.0;',
      '    float l = lum(c);',
      '    vec3 dk = c * (1.0 - ' + glf(SH.strength) + ' * smear) * mix(1.0, ' + glf(SH.dark) + ', smoothstep(0.50, 0.22, l));',
      '    c = mix(c, dk, uSunsetPost);',
      '  }'
    ].join('\n');
    return {
      uniforms: ['uniform float uSunset; uniform float uSunMix;'],
      funcs: [
        'const vec3 DAY_SKY_TOP = ' + v3(D.skyTop) + ';',
        'const vec3 DAY_SKY_HOR = ' + v3(D.skyHor) + ';',
        'const float GREEN_HUE = ' + glf(D.greenHue) + ';',
        'const float GREEN_PULL = ' + glf(D.greenPull) + ';',
        'const float GREEN_SAT = ' + glf(D.greenSat) + ';',
        'const float DAY_MIX = ' + glf(D.mix) + ';',
        'vec3 rgb2hsv(vec3 c) {',
        '  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);',
        '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
        '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));',
        '  float d = q.x - min(q.w, q.y);',
        '  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);',
        '}',
        'vec3 hsv2rgb(vec3 c) {',
        '  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);',
        '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);',
        '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);',
        '}'
      ].join('\n'),
      tod: tod,
      post: post,
      postUniforms: ['uniform float uSunsetPost;']
    };
  },
  prepCfg: function (cfg) {   // подготовка картинок ждёт старые имена настроек дня (миниатюры); свет окон — эффект lights (П2), пока постоянные e1.62
    var D = cfg.effects.tod.day;
    return { DAY: { SKY_TOP: D.skyTop, SKY_HOR: D.skyHor, MIX: D.mix, GREEN_HUE: D.greenHue, GREEN_PULL: D.greenPull, GREEN_SAT: D.greenSat,
      SKY_REF: cfg.frames.map(function (f) { return f.effects.tod.sky.ref; }), SKY_END: cfg.frames.map(function (f) { return f.effects.tod.sky.end; }) } };
  },
  upload: function (G, entry, r) {
    entry.em = G.texRGBA(r.ew, r.eh, r.emis);
    var sk = entry.cfg.effects.tod.sky;
    entry.skyRef = [sk.ref, sk.end];
    entry.noonK = entry.cfg.effects.tod.noonK;
    entry.sg = null; entry.sb = null;
  },
  states: function (f) { return f.files.sunset ? [['sunset', f.files.sunset]] : []; },
  uploadState: function (G, entry, kind, r) {
    if (kind !== 'sunset') return;
    entry.sg = G.texRGB(r.w, r.h, r.ground);
    entry.sb = G.texRGB(r.w, r.h, r.full);
  },
  textures: function (f) { return [f.em, f.sg || f.bg, f.sb || f.bg]; },   // картинки заката ещё нет — заглушка (шейдер её не читает: hasS = 0)
  bind: function (gl, U, f, s) {
    gl.uniform2f(U['uSkyRef' + s], f.skyRef[0], f.skyRef[1]);
    gl.uniform1f(U['uHasS' + s], f.sg ? 1 : 0);
    gl.uniform1f(U['uNoonK' + s], f.noonK);
  },
  set: function (name, S) {          // «День» / «Закат»: переход по часам движка
    var st = this.state, T = S.cfg.effects.tod, p1 = this.P[name];
    if (p1 === undefined || name === 'night') return false;   // ночь — П2
    var toT = function (p) { return p <= 1 ? T.daySunsetS * p : T.daySunsetS + T.sunsetNightS * (p - 1); };
    st.anim = { t0: null, T0: toT(st.p), T1: toT(p1), p1: p1 };
    st.name = name;
    return true;
  },
  apply: function (p) { var st = this.state; st.p = p; st.s = p <= 1 ? p : 1; st.sun = E2.clamp(p, 0, 1); },
  step: function (S) {
    var st = this.state, a = st.anim, T = S.cfg.effects.tod;
    if (!a) return;
    if (a.t0 === null) a.t0 = S.t;
    var dur = Math.max(1, Math.abs(a.T1 - a.T0) * 1000), tf = E2.clamp((S.t - a.t0) / dur, 0, 1), tfe = 0.5 * tf + 0.5 * tf * tf * (3 - 2 * tf);
    var Tn = a.T0 + (a.T1 - a.T0) * tfe;
    this.apply(Tn <= T.daySunsetS ? Tn / T.daySunsetS : 1 + (Tn - T.daySunsetS) / T.sunsetNightS);
    if (tf >= 1) { this.apply(a.p1); st.anim = null; }
  },
  busy: function () { return !!this.state.anim; },
  uniforms: function (gl, U) { gl.uniform1f(U.uSunset, this.state.s); gl.uniform1f(U.uSunMix, this.state.sun); },
  // второй проход нужен только на закате у кадров без закатного рисунка
  postAmount: function (S) { return (S.fa && S.fa.sg && (!S.fb || S.fb.sg)) ? 0 : this.state.s; },
  needsPost: function (S) { return this.postAmount(S) > 0.001; },
  postUniforms: function (gl, U, S) { gl.uniform1f(U.uSunsetPost, this.postAmount(S)); }
});

// ===== core/boot.js =====
// core/boot.js — старт: настройки здания (уже проверенные схемой и с подставленными умолчаниями — tools/stanok.py build) → сцена.
E2.boot = function () {
  var cfg = window.E2_BUILDING, el = document.getElementById('stage');
  if (!cfg || !el) { E2.err('boot', 'нет настроек здания или #stage'); return; }
  var on = cfg.effectsOn, fx = E2.fx.filter(function (e) { return on.indexOf(e.name) >= 0; });
  try {
    E2.Stage.init(cfg, fx, el);
    E2.Frames.init(cfg, fx);
    E2.UI.init(cfg, fx);
  } catch (e) { E2.err('boot', e); document.documentElement.setAttribute('data-e2', 'error'); return; }
  var first = Math.min(Math.max(0, +(E2.query('f') || 0) | 0), cfg.frames.length - 1);
  E2.Frames.loadDay(first).then(function () { document.documentElement.setAttribute('data-e2', 'first'); if (first) E2.Stage.go(first); });
  E2.Frames.loadAll(first).then(function () { document.documentElement.setAttribute('data-e2', 'all'); });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', E2.boot); else E2.boot();
})();
