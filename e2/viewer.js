/* chka.am — движок e2 e2.0.6. СОБРАННЫЙ ФАЙЛ: не править. Исходники — e2/src/, сборка — tools/build_engine.py. */
(function () {
'use strict';
var E2 = { version: 'e2.0.6', fx: [], effect: function (e) { E2.fx.push(e); return e; } };
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
// ?off=precip,lights,sky — выключить часть движка (замеры и паритет: docs/STANOK.md §5.3); ?break=имя — намеренная поломка для
// самопроверки гейтов (docs/STANOK.md §6: у каждого гейта есть красный случай).
E2.offNow = {};   // то же по ходу работы страницы: window.__e2.off(имя, true|false) — только для проверок
E2.off = function (name) { if (E2.offNow[name] !== undefined) return E2.offNow[name]; var q = E2.query('off'); return !!q && q.split(',').indexOf(name) >= 0; };
E2.brk = function (name) { var q = E2.query('break'); return !!q && q.split(',').indexOf(name) >= 0; };
E2.fxGet = function (name) { for (var i = 0; i < E2.fx.length; i++) if (E2.fx[i].name === name) return E2.fx[i]; return null; };
E2.hash = function (a, b) {   // одно и то же «случайное» число 0..1 для пары целых (без часов и Math.random)
  var h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

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
    redraw: function () { if (virtual) fire(now); return virtual; },   // только ?vt=1: перерисовать тот же момент (проверки сравнивают один момент с частью движка и без)
    after: function (ms, fn) { timers.push({ at: now + ms, fn: fn }); },   // «через ms» по часам движка (не setTimeout)
    rng: function (seed) {                                  // mulberry32: одна и та же последовательность для одного seed
      return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    },
    hour: function () {                                     // час зрителя 0..24 (актёры: утренний и дневной ролик собаки); ?hour=8 — подмена; ?vt=1 — всегда 12 (проверки воспроизводимы)
      var q = /[?&]hour=(\d+(?:\.\d+)?)/.exec(location.search);
      if (q) return +q[1];
      if (virtual) return 12;
      var d = new Date(); return d.getHours() + d.getMinutes() / 60;
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
//   tod     — время суток: день, полдень, закат; ночной рисунок готовится (vec3 cn, float nk), но ещё не кладётся
//   lights  — огни ночного рисунка: гасят и зажигают окна, мерцание (меняют cn)
//   night   — ночной рисунок кладётся поверх: c = mix(c, cn * lk, nk)
//   weather — пасмурно, мокро, снег лёг
//   mix     — после смешения двух кадров (тени облаков — fx/sky.js): vec3 c — цвет, vec4 sa — он же с долей неба в альфе, vec2 uv — точка кадра до обрезки
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
//   vec4 eg, eb — карта окон в p и в pb: r — маска огня, g — номер огня (lights); b, a — окна для заката без рисунка (tod)
//   vec3 cn   — цвет ночного рисунка в точке; float nk — доля ночи 0..1; float bn — доля слоя здания в ночном рисунке
//   float lk  — множитель яркости ночного рисунка в точке (мерцание огней): lights меняет, night кладёт после затемнения
//   Ночные текстуры ng (земля) и nb (здание) объявляет tod; их альфа — место для карт погоды: ng.a — маска снега, nb.a — порядок
//   появления снега (weather). Отдельных текстур под маски нет: у телефона 16 юнитов, 8 на кадр — и все заняты.
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
    var samplers = [], fUni = [], uni = [], funcs = [], hooks = { uv: [], base: [], tod: [], lights: [], night: [], weather: [], mix: [], post: [] }, postUni = [];
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
      hooks.uv.join('\n'), hooks.base.join('\n'), hooks.tod.join('\n'), hooks.lights.join('\n'), hooks.night.join('\n'), hooks.weather.join('\n'),
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
// Ступень задаёт плотность пикселей, «дыхание» камеры, число частиц осадков (fx/weather.js) и небо: на минимальной теней облаков нет (fx/sky.js).
// Ветер и актёры встанут в этот порядок с их появлением (П3, П6).
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
// Версия кадра, загруженная одним эффектом (закат, ночь — tod), видна и другим: onState(G, entry, kind, r, owner) — актёры пишут в неё свой тон.
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
          chain = chain.then(function () { return prep('state', [i, st[0], abs(st[1]), st[2] ? absAll(st[2]) : null]); })
            .then(function (r) { e.uploadState(G, entry, st[0], r); fx.forEach(function (o) { if (o.onState) E2.safe(o.name + '.onState', function () { o.onState(G, entry, st[0], r, e.name); }); }); return E2.Clock.pause(); })
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
    loadAll: function (first) {   // первый кадр, файлы здания (лист частиц), версии первого кадра, затем остальные кадры по одному
      var order = [first]; for (var i = 0; i < cfg.frames.length; i++) if (i !== first) order.push(i);
      var p0 = loadDay(first);
      fx.forEach(function (e) {
        (e.assets ? e.assets(cfg) : []).forEach(function (a) {
          p0 = p0.then(function () { return prep('raw', [abs(a[1])]); }).then(function (r) { e.uploadAsset(G, a[0], r); return E2.Clock.pause(); })
            .catch(function (err) { E2.err('файл здания ' + a[0], err); });
        });
      });
      return order.reduce(function (p, i) { return p.then(function () { return loadDay(i); }).then(function () { return loadStates(i); }); }, p0);
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
  var cover = { w: 1, h: 1, x: 0, y: 0 }, base = { w: 1, h: 1, x: 0, y: 0 }, lastW = 0, lastH = 0, drawn = 0;

  function resize(force) {
    var cssW = stageEl.clientWidth, cssH = stageEl.clientHeight;
    if (!force && cssW === lastW && cssH === lastH) return;
    lastW = cssW; lastH = cssH;
    var d = E2.Perf.dpr(), w = Math.round(cssW * d), h = Math.round(cssH * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var k = Math.max(cssW / natW, cssH / natH);   // как CSS background-size: cover
    cover.w = cssW / (natW * k); cover.h = cssH / (natH * k); cover.x = (1 - cover.w) / 2; cover.y = (1 - cover.h) / 2;
    base.w = cover.w; base.h = cover.h; base.x = cover.x; base.y = cover.y;     // без камеры шоу
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
    // частицы и картинки поверх готовой сцены (осадки, радуга): отдельный проход в ту же сцену, свои программы эффектов
    var over = false;
    fx.forEach(function (e) { if (e.over && e.over(gl, S, view)) over = true; });
    if (over) { gl.disable(gl.BLEND); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
    drawn++;
  }
  // Где на экране (доли 0..1, y вниз) видна точка кадра (u, v) с глубиной d (0 далеко … 1 близко) при текущем наклоне: обратный ход
  // крючка uv шейдера (fx/parallax.js). slot 'B' — приходящий кадр при смене. Этим же ходом живут частицы осадков — они в сцене.
  function project(u, v, d, slot) {
    var f = slot === 'B' ? S.fb : S.fa, c = f ? f.crop : [0, 0, 1, 1], P = cfg.effects.parallax, z = slot === 'B' ? zoomB : zoomA;
    var x = 0.5 + (u + (2 * d - 1) * S.shiftX - 0.5) * (1 + S.zoom * d), y = 0.5 + (v + (2 * d - 1) * S.shiftY - 0.5) * (1 + S.zoom * d);
    x = (x - c[0]) / c[2]; y = (y - c[1]) / c[3];
    x = 0.5 + (x - 0.5) * z * P.baseScale; y = 0.5 + (y - 0.5) * z * P.baseScale;
    return [(x - cover.x) / cover.w, (y - cover.y) / cover.h];
  }
  var view = { project: project, width: function () { return canvas.width; }, height: function () { return canvas.height; },
    css: function () { return [lastW, lastH]; }, cover: function () { return cover; }, frameSize: function () { return [natW, natH]; } };
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
    camera();
    draw();
  }
  // Камера шоу (fx/show.js, формулы e1.43): эффект говорит «точка кадра at приезжает в точку экрана to, крупнее в zoom раз, доля k» —
  // меняется только «cover» (какой кусок кадра на экране); наклон на время наезда слабее во столько же раз (параллакс на экране тот же).
  function camera() {
    cover.w = base.w; cover.h = base.h; cover.x = base.x; cover.y = base.y;
    var cam = null;
    fx.forEach(function (ef) { if (ef.camera && !cam) cam = E2.safe(ef.name + '.camera', function () { return ef.camera(S); }) || null; });
    S.cam = cam ? cam.k : 0;
    if (!cam) return;
    var cZ = 1 + (cam.zoom - 1) * cam.k, cS = cfg.effects.parallax.baseScale, cr = S.fa.crop, to = cam.to || [0.5, 0.45];
    var cU = 0.5 + ((cam.at[0] - cr[0]) / cr[2] - 0.5) * cS, cV = 0.5 + ((cam.at[1] - cr[1]) / cr[3] - 0.5) * cS;
    var sx = (cU - cover.x) / cover.w, sy = (cV - cover.y) / cover.h;
    cover.w /= cZ; cover.h /= cZ;
    cover.x = cU - (sx + (to[0] - sx) * cam.k) * cover.w; cover.y = cV - (sy + (to[1] - sy) * cam.k) * cover.h;
    S.shiftX /= cZ; S.shiftY /= cZ; S.zoom /= cZ;
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
    project: function (u, v, d) { var q = project(u, v, d); return [q[0] * lastW, q[1] * lastH]; },   // точка кадра → пиксели экрана (CSS)
    view: function () { return view; },
    still: function (on) { S.still = !!on; return S.still; },   // стоп-кадр по ходу работы (проверки): без «дыхания» камеры и мерцания
    pixels: function () {   // пиксели холста сразу после кадра (для гейтов и паритета): RGBA, строки снизу вверх
      var w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w: w, h: h, data: px };
    }
  };
})();

// ===== core/ui.js =====
// core/ui.js — полигон: только самое нужное, чтобы страницу можно было открыть и проверить: кнопки времени суток («День», «Закат»,
// «Ночь»), погоды («Снег», «Дождь»), стрелки кадров и доступ для проверок window.__e2. Панель, плашка, точки, язык, открытка, надписи переезжают в П5–П6
// (docs/STANOK.md §7). ?break=tod — кнопки времени суток ничего не делают; ?break=bar-cover — кнопки поверх героя (красные случаи гейта G7).
E2.UI = {
  init: function (cfg, fx) {
    var tod = fx.filter(function (e) { return e.name === 'tod'; })[0];
    function setTod(name) {
      if (!tod || E2.brk('tod') || !tod.set(name, { cfg: cfg })) return false;
      Array.prototype.forEach.call(document.querySelectorAll('[data-tod]'), function (b) { b.classList.toggle('on', b.getAttribute('data-tod') === name); });
      return true;
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-tod]'), function (b) { b.addEventListener('click', function () { setTod(b.getAttribute('data-tod')); }); });
    var wx = fx.filter(function (e) { return e.name === 'weather'; })[0];
    function setWx(name) {      // 'snow' | 'rain' | 'none'; повторное нажатие той же кнопки — выключить
      if (!wx || !wx.set(name)) return false;
      Array.prototype.forEach.call(document.querySelectorAll('[data-wx]'), function (b) { b.classList.toggle('on', b.getAttribute('data-wx') === name); });
      return true;
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-wx]'), function (b) {
      if (!wx) { b.style.display = 'none'; return; }
      b.addEventListener('click', function () { var n = b.getAttribute('data-wx'); setWx(wx.state.kind === n ? 'none' : n); });
    });
    if (E2.brk('bar-cover')) { var bar = document.getElementById('bar'); if (bar) bar.style.bottom = '17%'; }   // красный случай G7: кнопки поверх героя (как плашка поверх старика 09.11)
    var show = fx.filter(function (e) { return e.name === 'show'; })[0];
    Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) {     // «Шоу»: запуск; повторное нажатие — остановить
      if (!show) { b.style.display = 'none'; return; }
      b.addEventListener('click', function () { if (show.run) show.stop(); else show.start(E2.Stage.frame()); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.addEventListener('click', function () { E2.Stage.go(E2.Stage.frame() + (+b.getAttribute('data-go'))); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') E2.Stage.go(E2.Stage.frame() + 1); if (e.key === 'ArrowLeft') E2.Stage.go(E2.Stage.frame() - 1); });
    window.__e2 = {
      version: cfg.engine.version,
      advance: function (ms, step) { return E2.Clock.advance(ms, step); },   // только ?vt=1
      now: function () { return E2.Clock.now(); }, redraw: function () { return E2.Clock.redraw(); },
      setWx: setWx, setTod: setTod, tod: function () { return tod ? { name: tod.state.name, p: tod.state.p, busy: tod.busy() } : null; },
      go: function (i) { return E2.Stage.go(i); }, tilt: function (x, y) { E2.Stage.tilt(x, y); },
      state: function () { return E2.Stage.state(); }, shaders: function () { return E2.Stage.shaders(); },
      pixels: function () { return E2.Stage.pixels(); }, errors: function () { return E2.errors.slice(); },
      loaded: function (i) { var f = E2.Frames.get(i); return !!f; },
      prepCfg: function () { return JSON.parse(JSON.stringify(E2.Frames.prepCfg())); },
      fx: function (name) { var e = E2.fxGet(name); return e && e.debug ? JSON.parse(JSON.stringify(e.debug(E2.Frames.get(E2.Stage.frame())))) : null; },
      project: function (u, v, d) { return E2.Stage.project(u, v, d); },
      off: function (name, on) { E2.offNow[name] = !!on; return true; }, still: function (on) { return E2.Stage.still(on); },
      pending: function () { var n = 0; fx.forEach(function (e) { if (e.pendingNow) n += e.pendingNow(); }); return n; },   // ролики, которые ещё не встали на свой кадр (проверки ждут 0)
      show: function (i, sec) {   // проверки: шоу кадра i, стоп-кадр на секунде sec (null — идёт по часам); i = -1 — остановить
        if (!show) return false;
        if (i < 0) { show.run = null; return true; }
        if (!show.run && !show.start(i)) return false;
        return show.freeze(sec === undefined ? null : sec);
      },
      skyT: function (s) { var e = E2.fxGet('sky'); if (e) e.state.pin = (s === null || s === undefined) ? null : +s; return !!e; }   // время неба, с (null — снова по часам): паритет с e1.62
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
  frameSamplers: ['bg', 'depth', 'bld'],            // земля (rgb + глубина здания в a), карта окружения, слой здания
  frameUniforms: [['vec4', 'crop'], ['vec3', 'kd'], ['vec4', 'atl']],   // atl: этажи текстур (ветер): масштаб по y земли и окружения и полтексела — см. funcs
  glsl: function () {
    return {
      uniforms: ['uniform vec2 uShift; uniform float uZoom;'],
      // Земля и карта окружения у кадра с ветром — двухэтажные (второй этаж: крона / поле ветра, эффект wind). atl = (масштаб y земли, полтексела земли,
      // масштаб y окружения, полтексела окружения): 1 и 1 — этажа нет, выборка как была (край — как CLAMP_TO_EDGE).
      funcs: [
        'vec4 envT(sampler2D s, vec4 a, vec2 q) { return texture2D(s, vec2(q.x, a.z * min(q.y, 1.0 - a.w))); }',
        'vec4 bgT(sampler2D s, vec4 a, vec2 q) { return texture2D(s, vec2(q.x, a.x * min(q.y, 1.0 - a.y))); }'
      ].join('\n'),
      uv: [
        '  uv = crop.xy + uv * crop.zw;',
        '  vec2 p = uv;',
        '  for (int i = 0; i < 3; i++) {',
        '    float d = envT(depth, atl, p).r;',
        '    float k = d * 2.0 - 1.0;',
        '    p = 0.5 + (uv - 0.5) / (1.0 + uZoom * d) - k * uShift;',
        '  }',
        '  vec4 env = envT(depth, atl, p);',
        '  vec2 pc = clamp(p, 0.0, 1.0);',
        '  vec2 pb = 0.5 + (uv - 0.5) / (1.0 + uZoom * kd.y) - kd.x * uShift;',
        '  float bdL = kd.y;',
        '  if (kd.z > 0.5) {',
        '    for (int i = 0; i < 3; i++) {',
        '      bdL = bgT(bg, atl, clamp(pb, 0.0, 1.0)).a;',
        '      pb = 0.5 + (uv - 0.5) / (1.0 + uZoom * bdL) - (bdL * 2.0 - 1.0) * uShift;',
        '    }',
        '  }'
      ].join('\n'),
      base: [
        '  vec3 c = bgT(bg, atl, pc).rgb;',
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
    entry.bg = r.ground4 ? G.texRGBA(r.w, r.atlas ? r.h * 2 : r.h, r.ground4) : G.texRGB(r.w, r.h, r.ground);
    entry.depth = G.texRGBA(r.ew, r.windRows ? r.eh * 2 : r.eh, r.gpuDepth);
    entry.windOn = !!(r.atlas && r.windRows);   // у кадра есть крона и поле ветра (эффект wind)
    entry.atl = new Float32Array([r.atlas ? 0.5 : 1, 0.5 / r.h, r.windRows ? 0.5 : 1, 0.5 / r.eh]);
    entry.bld = G.texRGBA(r.w, r.h, r.bldPm);
    entry.kd = [r.kB, r.dB, r.bldD ? 1 : 0];
    var c = entry.cfg.effects.parallax.crop;
    entry.crop = new Float32Array([c[0], c[1], c[2] - c[0], c[3] - c[1]]);
    entry.tiltK = entry.cfg.effects.parallax.tilt;
  },
  bind: function (gl, U, f, s) { gl.uniform4fv(U['uCrop' + s], f.crop); gl.uniform3f(U['uKd' + s], f.kd[0], f.kd[1], f.kd[2]); gl.uniform4fv(U['uAtl' + s], f.atl); },
  step: function (S) {
    var P = S.cfg.effects.parallax, t = S.t / 1000;
    var ba = (S.still || S.tier !== 'full' || E2.off('breath')) ? 0 : P.breath.amp;
    var bx = ba * Math.sin(t * 2 * Math.PI / P.breath.periodS), by = ba * Math.cos(t * 2 * Math.PI / (P.breath.periodS * 0.7));
    var tkA = S.fa ? S.fa.tiltK : 1, tkB = S.fb ? S.fb.tiltK : tkA, tk = tkA + (tkB - tkA) * (S.fb ? S.mix : 0);
    S.shiftX = S.tiltX * P.shiftX * tk + bx;
    S.shiftY = S.tiltY * P.shiftY * tk + by;
    S.zoom = P.zoomNear * E2.clamp(S.tiltY, 0, 1) * tk;       // наклон к себе — ближнее чуть крупнее
  },
  uniforms: function (gl, U, S) { gl.uniform2f(U.uShift, S.shiftX, S.shiftY); gl.uniform1f(U.uZoom, S.zoom); }
});

// ===== fx/tod.js =====
// fx/tod.js — время суток: день (небо и зелень), полдень (снять «золотой час» рисунка), закат, ночь (docs/STANOK.md §2.2, §4.1).
// Ночь (П2) — только рисунком Gemini (<кадр>_night.webp, обязателен): день или закат растворяется в ночной рисунок за sunsetNightS с;
// тёмное рисунка ещё темнее (night.dim), свет — как нарисован. Ночи «фильтром», звёзд и фонарей кодом в e2 нет. Окна гаснут, зажигаются
// и мерцают в эффекте lights: tod готовит ночной цвет (cn) и долю ночи (nk), крючок lights меняет cn, крючок night кладёт его.
// Закат: если у кадра есть закатный рисунок (<кадр>_sunset.webp) — он проявляется поверх дня; нет — тёплый тон считает шейдер
// и второй проход кладёт тени. Оба пути перенесены из e1.62 для паритета; цель станка — закатный рисунок пишет шаг S3 (ответ Нарека 1Б).
// Математика шейдера — из e1.62 без изменений (проверка: python3 tools/stanok.py parity).
E2.effect({
  name: 'tod',
  low: 'on',
  frameSamplers: ['em', 'sg', 'sb', 'ng', 'nb'],     // окна (маски), закат: земля и вся картинка, ночь: земля и вся картинка
  frameUniforms: [['vec2', 'skyRef'], ['float', 'hasS'], ['float', 'noonK'], ['float', 'hasN']],
  P: { day: 0, sunset: 1, night: 2.1667 },
  state: { p: 0, s: 0, sun: 0, night: 0, sky: 0, gnd: 0, name: 'day', anim: null },
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
      '      float sn = max(max(envT(depth, atl, p + vec2(e1.x, 0.0)).g, envT(depth, atl, p - vec2(e1.x, 0.0)).g), max(envT(depth, atl, p + vec2(0.0, e1.y)).g, envT(depth, atl, p - vec2(0.0, e1.y)).g));',
      '      sn = max(sn, max(max(envT(depth, atl, p + vec2(e2.x, 0.0)).g, envT(depth, atl, p - vec2(e2.x, 0.0)).g), max(envT(depth, atl, p + vec2(0.0, e2.y)).g, envT(depth, atl, p - vec2(0.0, e2.y)).g)));',
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
      '  if (hasS > 0.5 && uSunMix > 0.001) c = mix(c, texture2D(sb, pb).rgb * b.a + texture2D(sg, pc).rgb * inv, uSunMix);',
      // ночной рисунок: земля — в координатах фона, главное здание — в своих; у мягкого края вырезки — сам ночной рисунок (как nightEdge solid e1.62)
      '  vec3 cn = c;',
      '  float nk = uNightMix * hasN;',
      '  float bn = 0.0;',
      '  float lk = 1.0;',     // множитель яркости ночного рисунка в точке (мерцание огней — эффект lights); кладётся ПОСЛЕ затемнения ночи
      '  if (nk > 0.001) {',
      '    bn = smoothstep(0.0, 0.3, b.a);',
      '    cn = texture2D(nb, pb).rgb * bn + texture2D(ng, pc).rgb * (1.0 - bn);',
      '  }'
    ].filter(function (l) { return l !== ''; }).join('\n');
    var night = [
      '  if (nk > 0.001) {',
      '    cn *= mix(' + glf(T.night.dim) + ', 1.0, smoothstep(0.30, 0.60, dot(cn, vec3(0.299, 0.587, 0.114))));',   // тёмное темнее, свет — как нарисован
      '    c = mix(c, cn * lk, nk);',
      '  }'
    ].join('\n');
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
      uniforms: ['uniform float uSunset; uniform float uSunMix; uniform float uNightMix; uniform vec2 uNightGS;'],     // uNightGS: ночь земли и неба 0..1 (для погоды и теней облаков)
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
      night: night,
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
    entry.sg = null; entry.sb = null; entry.ng = null; entry.nb = null; entry.nT = null;
  },
  // ночная картинка несёт в альфе карты погоды кадра (маска снега <кадр>_snow.webp и порядок <кадр>_wx.webp): см. договор в core/gl.js
  states: function (f) { return (f.files.sunset ? [['sunset', f.files.sunset]] : []).concat([['night', f.files.night, f.files.snow ? { alpha: f.files.snow, alpha2: f.files.wx } : null]]); },
  uploadState: function (G, entry, kind, r) {
    if (kind === 'sunset') { entry.sg = G.texRGB(r.w, r.h, r.ground); entry.sb = G.texRGB(r.w, r.h, r.full); }
    if (kind === 'night') {   // альфа ночных текстур — карты погоды кадра (их кладёт подготовка, если у кадра есть <кадр>_wx.webp): см. core/gl.js
      entry.ng = r.ground4 ? G.texRGBA(r.w, r.h, r.ground4) : G.texRGB(r.w, r.h, r.ground);
      entry.nb = r.full4 ? G.texRGBA(r.w, r.h, r.full4) : G.texRGB(r.w, r.h, r.full);
      entry.nT = E2.Clock.now();
    }
  },
  textures: function (f) { return [f.em, f.sg || f.bg, f.sb || f.bg, f.ng || f.bg, f.nb || f.bg]; },   // картинки ещё нет — заглушка (шейдер её не читает: hasS = 0, hasN = 0)
  bind: function (gl, U, f, s) {
    gl.uniform2f(U['uSkyRef' + s], f.skyRef[0], f.skyRef[1]);
    gl.uniform1f(U['uHasS' + s], f.sg ? 1 : 0);
    gl.uniform1f(U['uNoonK' + s], f.noonK);
    gl.uniform1f(U['uHasN' + s], this.hasN(f));
  },
  // ночной рисунок кадра догрузился позже нажатия «Ночь» — проявляется за 0,6 с, без скачка
  hasN: function (f) { return f.ng ? E2.sstep(0, 600, E2.Clock.now() - f.nT) : 0; },
  set: function (name, S) {          // «День» / «Закат» / «Ночь»: переход по часам движка
    var st = this.state, T = S.cfg.effects.tod, p1 = this.P[name];
    if (p1 === undefined) return false;
    var toT = function (p) { return p <= 1 ? T.daySunsetS * p : T.daySunsetS + T.sunsetNightS * (p - 1); };
    st.anim = { t0: null, T0: toT(st.p), T1: toT(p1), p1: p1 };
    st.name = name;
    return true;
  },
  apply: function (p) {
    var st = this.state, q = p - 1;
    st.p = p;
    st.s = p <= 1 ? p : 1 - E2.sstep(0.3, 0.9, q);            // тёплый тон заката держится, пока темнеет
    st.sun = E2.clamp(p, 0, 1);                               // закатный рисунок проявляется весь переход день → закат
    st.night = q > 0 ? E2.sstep(0.0, 1.1667, q) : 0;          // ночной рисунок проявляется весь переход закат → ночь
    st.sky = q > 0 ? E2.sstep(0.0, 0.55, q) : 0;              // небо темнеет первым, земля — потом: по ним погода гасит свой свет ночью
    st.gnd = q > 0 ? E2.sstep(0.3, 0.9, q) : 0;
  },
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
  uniforms: function (gl, U) { gl.uniform1f(U.uSunset, this.state.s); gl.uniform1f(U.uSunMix, this.state.sun); gl.uniform1f(U.uNightMix, this.state.night); gl.uniform2f(U.uNightGS, this.state.gnd, this.state.sky); },
  // второй проход нужен только на закате у кадров без закатного рисунка
  postAmount: function (S) { return (S.fa && S.fa.sg && (!S.fb || S.fb.sg)) ? 0 : this.state.s; },
  needsPost: function (S) { return this.postAmount(S) > 0.001; },
  postUniforms: function (gl, U, S) { gl.uniform1f(U.uSunsetPost, this.postAmount(S)); }
});

// ===== fx/wind.js =====
// fx/wind.js — ветер: качаются кроны деревьев, фон за ними стоит (docs/STANOK.md §4.3, П3).
// Как это устроено. Станок при сборке вынимает крону из подложки (tools/stanok_masks.py: маска кроны, подложка под ней достроена гладко) и
// кладёт две карты: «крона» — разность D = α·(кадр − подложка) со знаком (128 = нет разности), и «поле ветра» — оболочка кроны, высота
// внутри кроны (верхушка качается больше низа, как консоль) и фаза дерева. Карты лежат вторым этажом уже существующих текстур земли и
// окружения (core/prep.js; лишних сэмплеров нет — на iPhone их ровно 16). Шейдер: c += D(p − A) − D(p): крона уходит с места и приходит на
// новое, подложка под ней — как есть. Вне оболочки A = 0 и разность равна нулю ровно, трава, стены и небо стоят.
// Крючок tod эффекта wind идёт ПОСЛЕ крючка tod (порядок в effects.schema.json): окраска дня (небо, зелень) считается по неподвижным маскам
// окружения на месте, а сдвинутая крона кладётся поверх уже готового цвета — иначе светлый лист на чужом небе окрашивался бы как небо (искры на кромке, замер G1).
// Сдвиг A мягко упирается в maxPx пикселей кадра: A / sqrt(1 + (A / maxPx)²). Время — только E2.Clock (через S.t), порыв — от часов движка (G6).
// Ветра нет, когда на экране не дневная картинка: ночь, закатный рисунок (это неподвижные картинки) — доля ветра гаснет вместе с переходом.
// ?off=wind — ветер выключен (паритет сцены с e1.62 сравнивается без него); ?break=wind-smear / wind-far / wind-dead — красные случаи гейта G1.
E2.effect({
  name: 'wind',
  low: 'lite',                       // слабая ступень — как есть; минимальная — без ветра (см. step)
  frameUniforms: [['float', 'wind']],   // доля ветра кадра 0…1 (0 — кадр без крон, ночь, закатный рисунок, выключен)
  state: { t: 0, gust: 0, on: true, px: 0 },
  prepCfg: function (cfg) { return { WIND_ON: cfg.frames.some(function (f) { return f.effects.wind && f.effects.wind.on; }) }; },
  frameFiles: function (f) { return (f.effects.wind && f.effects.wind.on && f.files.crown && f.files.windfield) ? { crown: f.files.crown, windfield: f.files.windfield } : {}; },
  glsl: function (cfg) {
    var FW = cfg.look.frameSize[0], glf = E2.glf;
    var brk = E2.brk('wind-smear') ? 1 : 0;        // красный случай: фон тянется за кроной (подложка не вычитается: «сдвиг картинки», а не кроны)
    return {
      uniforms: ['uniform vec4 uWind; uniform vec3 uWindK;'],      // uWind: время, порыв, размах и наклон (доли ширины кадра); uWindK: период, 1 / потолок²
      funcs: [
        'vec3 windD(vec3 v) { return (v * 255.0 - 128.0) / 127.0; }',
        'vec4 windF(sampler2D s, vec4 a, vec2 q) { return texture2D(s, vec2(q.x, 0.5 + 0.5 * min(q.y, 1.0 - a.w))); }',
        'vec4 crownT(sampler2D s, vec4 a, vec2 q) { return texture2D(s, vec2(q.x, 0.5 + 0.5 * clamp(q.y, a.y, 1.0 - a.y))); }'
      ].join('\n'),
      tod: [
        '  if (wind > 0.0) {',
        '    vec4 wf = windF(depth, atl, pc);',
        '    if (wf.r > 0.004 && wf.b > 0.0) {',
        '      float tt = uWind.x;',
        '      float s1 = sin(6.2831853 * (tt / uWindK.x + wf.a));',
        '      float s2 = sin(6.2831853 * (tt / (uWindK.x * 0.43) + wf.a * 2.7 + 0.31));',
        '      float a = wf.b * wind * uWind.y * (uWind.z * (0.7 * s1 + 0.3 * s2) + uWind.w);',
        '      a = a / sqrt(1.0 + a * a * uWindK.y);',
        '      vec3 d0 = windD(crownT(bg, atl, pc).rgb);',
        '      vec3 d1 = windD(crownT(bg, atl, pc - vec2(a, 0.0)).rgb);',
        brk ? '      c = clamp(c + (bgT(bg, atl, pc - vec2(a, 0.0)).rgb - bgT(bg, atl, pc).rgb) * wf.r, 0.0, 1.0);' : '      c = clamp(c + d1 - d0, 0.0, 1.0);',
        '    }',
        '  }'
      ].join('\n')
    };
  },
  // доля ветра кадра: день и дождь со снегом — 1; ночной рисунок и закатный рисунок закрывают картинку — ветер уходит вместе с ними
  amount: function (f) {
    if (!f || !f.windOn || E2.off('wind') || this.state.off) return 0;
    var td = E2.fxGet('tod'), st = td ? td.state : null, k = 1;
    if (st) { k *= 1 - st.night * td.hasN(f); if (f.sg) k *= 1 - st.sun; }
    return Math.max(0, k);
  },
  init: function () { },
  step: function (S) {
    var W = S.cfg.effects.wind, st = this.state, t = S.t / 1000;
    var far = E2.brk('wind-far') ? 6 : 1;                      // красный случай: размах и потолок в 6 раз больше, порыв всегда полный (крона уходит дальше maxPx)
    st.off = S.tier === 'min' || E2.brk('wind-dead');           // wind-dead — красный случай: ветра нет совсем
    st.t = t;
    // порыв: два медленных колебания разной длины; 0,25 между порывами (кроны почти замирают), 1 — в самом порыве
    var g = 0.6 * Math.sin(2 * Math.PI * t / W.gustS + 1.3) + 0.4 * Math.sin(2 * Math.PI * t / (W.gustS * 0.37) + 0.9);
    st.gust = far > 1 ? 1 : 0.25 + 0.75 * E2.sstep(-0.35, 0.65, g);
    st.px = W.maxPx;
    st.far = far;
  },
  uniforms: function (gl, U, S) {
    var W = S.cfg.effects.wind, st = this.state, FW = S.cfg.look.frameSize[0], M = W.maxPx * (st.far || 1) / FW;   // wind-far: потолок и размах в 6 раз выше (красный случай G1)
    gl.uniform4f(U.uWind, st.t, st.gust, (W.swayPx / FW) * (st.far || 1), (W.leanPx / FW) * (st.far || 1));
    gl.uniform3f(U.uWindK, W.periodS, 1 / (M * M), 0);
  },
  bind: function (gl, U, f, s) { gl.uniform1f(U['uWind' + s], this.amount(f)); },
  debug: function (f) { var st = this.state; return { t: st.t, gust: st.gust, amount: this.amount(f), on: !!(f && f.windOn), maxPx: st.px }; }
});

// ===== fx/lights.js =====
// fx/lights.js — огни ночного рисунка (docs/STANOK.md §4.1, решение Нарека 1А): свет рисует Gemini, движок только гасит и зажигает.
// Маску огней считает станок при сборке (tools/stanok_masks.py → <кадр>_lights.png): пятна, где ночной рисунок заметно ярче и теплее
// «дня × затемнение». Она лежит в свободных каналах карты окон (em.r — мягкая маска, em.g — номер огня): лишней текстуры нет.
// Два вида пятен: окно (ночью ярче, чем этот же пиксель днём) — гаснет и зажигается; пятно фонаря на стене и земле — только «дышит».
// По кнопке «Ночь»: кадр темнеет с погашенными окнами (в пятне окна — дневной пиксель в ночном тоне), потом окна зажигаются ПО ОДНОМУ
// в порядке номеров, все за turnOnS с. Конечное состояние — ровно ночной рисунок. Дальше редкое мягкое мерцание: плавный шум по огню
// целиком (никаких клеток — фаза зависит только от номера огня), и раз в rareS с одно окно гаснет или зажигается.
// Всё — функция часов движка (E2.Clock) и номера огня: два прогона с одинаковыми шагами времени дают одинаковые пиксели (гейт G6).
E2.effect({
  name: 'lights',
  low: 'on',            // на слабой ступени работает как есть: это две строки шейдера в пятнах огней
  // lgt: x — доля очереди, занятая пятнами фонарей; y — число огней кадра; z — номер окна «редкого» события (−1 — нет); w — насколько оно погашено
  // lgtTone: rgb — тон погашенного окна (ночь / день вокруг огней); a — огни кадра включены
  frameUniforms: [['vec4', 'lgt'], ['vec4', 'lgtTone']],
  START_P: 2.0,         // окна начинают зажигаться, когда ночь почти легла (переход закат → ночь идёт до 2,1667)
  state: { t0: null, k: 0, doneT: null },
  glsl: function (cfg) {
    var L = cfg.effects.lights, glf = E2.glf;
    var rise = E2.clamp(L.riseS / L.turnOnS, 0.02, 1), span = E2.brk('lights-all') ? 0 : 1 - rise;     // ?break=lights-all — все окна разом (красный случай G7)
    // ?break=lights-cells — мерцание клетками 8 px вместо «по огню целиком» (красный случай G7; так мерцал nglow e1.45)
    var ph = E2.brk('lights-cells') ? 'floor(gl_FragCoord.x / 8.0) * 0.37 + floor(gl_FragCoord.y / 8.0) * 0.61' : 'lT';
    return {
      uniforms: ['uniform float uLights; uniform vec2 uLightT;'],     // uLights — очередь включения 0..1; uLightT: x — секунды, y — сила мерцания (0 — стоп-кадр)
      base: '  vec3 cRaw = c;',                                       // дневной пиксель рисунка — «погашенное окно» строится из него
      lights: [
        '  if (nk > 0.001 && lgtTone.a > 0.5) {',
        '    float lM = mix(eg.r, eb.r, bn);',
        '    if (lM > 0.004) {',
        '      float lT = bn > 0.5 ? eb.g : eg.g;',
        '      float lamp = step(lT, lgt.x);',
        '      float lq = clamp((lT - lgt.x) / max(1.0 - lgt.x, 0.001), 0.0, 1.0);',
        '      float on = max(lamp, smoothstep(lq * ' + glf(span) + ', lq * ' + glf(span) + ' + ' + glf(rise) + ', uLights));',
        '      on *= 1.0 - lgt.w * (1.0 - lamp) * step(abs(lT - lgt.z), 0.45 / max(lgt.y, 1.0));',
        '      float lp = ' + ph + ';',
        '      float h1 = fract(sin(lp * 157.31) * 43758.5453), h2 = fract(sin(lp * 311.7 + 1.3) * 24634.6345);',
        '      float amp = mix(step(h2, ' + glf(L.flicker.share) + ') * ' + glf(L.flicker.window) + ', ' + glf(L.flicker.lamp) + ', lamp) * uLightT.y;',
        '      float gate = mix(smoothstep(0.35, 0.9, sin(uLightT.x * 0.21 * (0.6 + h1) + 6.2832 * h2)), 1.0, lamp);',     // окно мерцает не всё время, а изредка
        '      float fl = amp * gate * (0.62 * sin(uLightT.x * (1.1 + 1.3 * h1) + 6.2832 * h2) + 0.38 * sin(uLightT.x * (2.3 + 1.9 * h2) + 6.2832 * h1));',
        '      cn = mix(cn, cRaw * lgtTone.rgb, lM * (1.0 - on));',
        '      lk = 1.0 + lM * on * fl;',     // после затемнения ночи (крючок night): иначе его кривая усиливает ±5 % до ±15 % в полутонах
        '    }',
        '  }'
      ].join('\n')
    };
  },
  frameFiles: function (f) { return f.files.lights ? { lights: f.files.lights } : {}; },
  upload: function (G, entry) {
    var D = (entry.cfg.derived || {}).lights, on = !!D && entry.cfg.effects.lights.on && D.n > 0;
    entry.lights = on ? D : null;
    entry.lgtTone = on ? [D.tone[0], D.tone[1], D.tone[2], 1] : [1, 1, 1, 0];
  },
  // «редкое» событие: раз в rareS секунд одно окно гаснет, следующим событием — зажигается. t — секунды с момента, когда зажглись все окна.
  // Расписание — от номера кадра и номера события (E2.Clock.rng), не от настоящих часов.
  rare: function (f, t, R) {
    var L = f.lights, nW = L ? L.n - L.lamps : 0;
    if (!nW || t <= 0) return [-1, 0];
    var sc = f.lgtRare || (f.lgtRare = { rng: E2.Clock.rng(7919 * (f.idx + 1) + 13), times: [], wins: [] });
    while (!sc.times.length || sc.times[sc.times.length - 1] <= t) {
      var k = sc.times.length, last = k ? sc.times[k - 1] : 0;
      sc.times.push(last + R[0] + (R[1] - R[0]) * sc.rng());
      if (k % 2 === 0) sc.wins.push(Math.floor(sc.rng() * nW) % nW);
    }
    var e = -1;
    for (var i = 0; i < sc.times.length && sc.times[i] <= t; i++) e = i;
    if (e < 0) return [-1, 0];
    var w = sc.wins[e >> 1], a = E2.sstep(0, 1.2, t - sc.times[e]);
    return [(L.lamps + w + 0.5) / L.n, e % 2 === 0 ? a : 1 - a];
  },
  bind: function (gl, U, f, s) {
    var L = E2.off('lights') ? null : f.lights, st = this.state, r = [-1, 0];
    if (L && st.doneT !== null && !st.still) r = this.rare(f, (E2.Clock.now() - st.doneT) / 1000, st.rareS);
    gl.uniform4f(U['uLgt' + s], L ? L.lamps / L.n : 0, L ? L.n : 0, r[0], r[1]);
    gl.uniform4f(U['uLgtTone' + s], f.lgtTone[0], f.lgtTone[1], f.lgtTone[2], L ? f.lgtTone[3] : 0);
  },
  step: function (S) {
    var st = this.state, tod = E2.fxGet('tod'), L = S.cfg.effects.lights;
    if (!tod) return;
    if (tod.state.p >= this.START_P && st.t0 === null) st.t0 = S.t;
    if (tod.state.night < 0.02) { st.t0 = null; st.doneT = null; }
    st.k = st.t0 === null ? 0 : E2.clamp((S.t - st.t0) / 1000 / L.turnOnS, 0, 1);
    if (st.k >= 1 && st.doneT === null) st.doneT = S.t;
    st.still = S.still; st.rareS = L.rareS;
  },
  uniforms: function (gl, U, S) { gl.uniform1f(U.uLights, this.state.k); gl.uniform2f(U.uLightT, S.t / 1000, S.still ? 0 : 1); },
  // для проверок (гейт G7): очередь, огни кадра
  debug: function (f) { return { k: this.state.k, t0: this.state.t0, doneT: this.state.doneT, frame: f && f.lights ? f.lights : null }; }
});

// ===== fx/weather.js =====
// fx/weather.js — погода: дождь и снег (docs/STANOK.md §4.2, жалоба Нарека «белые шарики из ниоткуда», ENGINE-BUGS §6).
// Два слоя:
//  1) крючок шейдера weather — пасмурно, мокрые стены и земля, снег ЛЁГ на поверхности по маске зимнего рисунка Gemini (альфа ночной
//     текстуры земли) и проявляется сверху вниз: сначала кромки крыш и верх предметов, потом плоскости (порядок — альфа ночной
//     текстуры здания: её считает станок, tools/stanok_masks.py → <кадр>_wx.webp). Формулы пасмурного, мокрого и снега по маске —
//     как у e1.62, поэтому установившаяся картинка совпадает с эталоном «до»; «снег по формуле» (без маски) в e2 не переехал.
//  2) частицы — отдельный проход в ту же сцену (не холст поверх): снежинки и капли — рисунки Gemini (лист wx_atlas.png), код их только
//     двигает и красит под время суток. Частица живёт В СЦЕНЕ: у неё есть глубина z, на экран она проецируется тем же ходом, что и
//     рисунок (наклон сдвигает её вместе с её планом), и садится на первую поверхность не дальше себя (карта посадки кадра из
//     core/prep.js): дальняя снежинка гаснет на линии крыши, ближняя пролетает перед зданием и ложится на землю.
// Время — только E2.Clock: положение каждой частицы — функция времени и её номера (ни настоящих часов, ни Math.random, ни накопленного
// состояния): два прогона с одинаковыми шагами дают одинаковые пиксели (гейт G6; дождь e1.62 этого не умел — находка П0).
// Начало погоды: частица рождается только над верхним краем (или за наветренным краем) и только после нажатия кнопки; густота растёт
// 2,5 с — середина экрана не «заселяется» из ниоткуда. Конец погоды: новые не рождаются, летящие долетают.
// Погода у каждого кадра своя (effects.weather кадра): интерьер — без погоды; кадр без маски снега — только снежинки.
// Радуга после дождя — рисунок Gemini кадра (rainbow.file), проявляется и тает; кадр без рисунка — без радуги.
// ?break=precip-pop, precip-noland, wx-interior, snow-flat — намеренные поломки для самопроверки гейта G7.
E2.effect({
  name: 'weather',
  low: 'lite',          // слабая ступень: частиц меньше (до 150; минимальная — до 60), шейдер тот же
  frameUniforms: [['vec4', 'wx']],     // x пасмурно; y — маска снега кадра (0 — нет или ещё грузится, до 1); z мокро; w — снег лёг (доля покрова)
  M: 0.06,              // запас над верхом и под низом кадра, доли высоты
  RAMP_S: 2.5,          // нарастание густоты в начале погоды
  LAND_FADE: { snow: 0.2, rain: 0.05 },      // снежинка гаснет на поверхности за 0,2 с
  SPLASH_S: 0.26,
  state: { kind: 'none', rain: { v0: 0, t0: -1e9, to: 0 }, snow: { v0: 0, t0: -1e9, to: 0 }, lin0: 0, linT: 0, cover: 0, lin: 0,
    spans: { rain: { on: null, off: null }, snow: { on: null, off: null } }, rainbowT: null, rainbowA: 0 },
  glsl: function (cfg) {
    var W = cfg.effects.weather, glf = E2.glf, v3 = E2.v3;
    return {
      weather: [
        '  if (wx.x + wx.z + wx.w > 0.0) {',
        '    float lw = dot(c, vec3(0.299, 0.587, 0.114));',
        '    vec3 oc = mix(c, vec3(lw), ' + glf(W.overcast.gray) + ') * (1.0 - ' + glf(W.overcast.dim) + ' * (1.0 - 0.7 * uNightGS.x));',      // пасмурно: цвета глуше, свет ровнее
        '    oc = mix(oc, ' + v3(W.overcast.sky) + ' * mix(1.0, 0.22, uNightGS.y) * clamp(lw / skyRef.x * 1.05, 0.7, 1.05), sky * 0.85);',     // небо серое
        '    c = mix(c, oc, wx.x);',
        '    c *= 1.0 - ' + glf(W.wetDim) + ' * wx.z * (1.0 - sky);',                                                                           // мокрые стены и земля темнее
        '    if (wx.w > 0.0) {',
        '      vec2 pbc = clamp(pb, 0.0, 1.0);',
        '      float sm = wx.y * mix(texture2D(ng, pc).a, texture2D(ng, pbc).a, b.a);',                                                         // маска снега кадра
        E2.brk('snow-flat') ? '      float so = 0.5;'                                                                                           // ?break=snow-flat — снег проявляется везде разом
          : '      float so = mix(texture2D(nb, pc).a, texture2D(nb, pbc).a, b.a);',                                                           // когда снег доходит до точки: сверху вниз
        '      float arr = smoothstep(so * 0.75, so * 0.75 + 0.25, wx.w);',
        '      c = mix(c, ' + v3(W.snow.tint) + ' * mix(1.0, 0.5, uNightGS.x) * (0.8 + 0.22 * smoothstep(0.12, 0.65, lw)), clamp(' + glf(W.snow.k) + ' * sm * arr, 0.0, 0.95));',
        '      float gn = clamp((c.g - max(c.r, c.b)) * 7.0, 0.0, 1.0) * (1.0 - sky);',                                                         // зелень зимой чуть седеет
        '      c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(0.98, 1.0, 1.04) * 1.12, wx.w * gn * 0.3);',
        '      c = mix(c, c * vec3(0.96, 0.98, 1.03), wx.w * 0.6);',                                                                            // холодный свет
        '    }',
        '  }'
      ].join('\n')
    };
  },
  // ---------- файлы ----------
  assets: function (cfg) { return cfg.files && cfg.files.wxAtlas ? [['wxAtlas', cfg.files.wxAtlas]] : []; },
  premul: function (r) { var p = r.px, i, a; for (i = 0; i < p.length; i += 4) { a = p[i + 3]; p[i] = (p[i] * a + 127) / 255 | 0; p[i + 1] = (p[i + 1] * a + 127) / 255 | 0; p[i + 2] = (p[i + 2] * a + 127) / 255 | 0; } return p; },
  uploadAsset: function (G, key, r) {
    if (key !== 'wxAtlas') return;
    var gl = G.gl();
    this.atlas = G.texRGBA(r.w, r.h, this.premul(r));
    gl.generateMipmap(gl.TEXTURE_2D);                       // лист 512×256: снежинка 64 px рисуется в 4–12 px — без уровней рябит
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this.cells = (this.cfg.derived || {}).wxAtlas || { flakes: [], rain: [] };
  },
  upload: function (G, entry, r) {
    var fw = entry.cfg.effects.weather, interior = E2.brk('wx-interior');     // ?break=wx-interior — погода и там, где её быть не должно
    entry.land = r.land || null;
    entry.wxOn = { rain: fw.rain || interior, snow: fw.snow || interior };
    entry.wxMask = !!entry.cfg.files.snow;
    entry.rainbow = fw.rainbow ? { rect: fw.rainbow.rect, tex: null } : null;
  },
  states: function (f) { return f.files.rainbow ? [['raw', f.files.rainbow]] : []; },
  uploadState: function (G, entry, kind, r) { if (kind === 'raw' && entry.rainbow) entry.rainbow.tex = G.texRGBA(r.w, r.h, this.premul(r)); },
  // ---------- состояние (всё от часов движка) ----------
  fade: function (q, t, ms) { return q.v0 + (q.to - q.v0) * E2.sstep(0, 1, (t - q.t0) / ms); },
  set: function (kind) {      // 'none' | 'rain' | 'snow'
    if (kind !== 'none' && kind !== 'rain' && kind !== 'snow') return false;
    var st = this.state, t = E2.Clock.now(), W = this.cfg.effects.weather, tod = E2.fxGet('tod'), self = this;
    if (kind === st.kind) return true;
    ['rain', 'snow'].forEach(function (k) {
      var q = st[k];
      q.v0 = self.fade(q, t, W.fadeMs); q.t0 = t; q.to = kind === k ? 1 : 0;
      if (kind === k) st.spans[k] = { on: t, off: null }; else if (st.kind === k) st.spans[k].off = t;
    });
    st.lin0 = this.linAt(t); st.linT = t;
    st.rainbowT = (st.kind === 'rain' && kind === 'none' && (!tod || tod.state.night < 0.5)) ? t : null;     // дождь кончился днём — радуга
    st.kind = kind;
    return true;
  },
  linAt: function (t) {       // покров снега: копится accumS секунд, тает meltS — прямая от момента последнего переключения
    var st = this.state, W = this.cfg.effects.weather.snow, dt = Math.max(0, t - st.linT) / 1000;
    return st.kind === 'snow' ? Math.min(1, st.lin0 + dt / W.accumS) : Math.max(0, st.lin0 - dt / W.meltS);
  },
  init: function (cfg) { this.cfg = cfg; this.memo = { rain: [], snow: [] }; },
  step: function (S) {
    var st = this.state, W = S.cfg.effects.weather, tod = E2.fxGet('tod'), night = tod ? tod.state.night : 0;
    if (!this.cfg) this.cfg = S.cfg;
    st.rainK = this.fade(st.rain, S.t, W.fadeMs); st.snowK = this.fade(st.snow, S.t, W.fadeMs);
    st.lin = this.linAt(S.t); st.cover = st.lin * st.lin * (3 - 2 * st.lin);
    st.rainbowA = 0;
    if (st.rainbowT !== null) {
      var ra = (S.t - st.rainbowT) / 1000;
      if (ra > W.rainbowS) st.rainbowT = null;
      else st.rainbowA = E2.clamp(ra / 5, 0, 1) * E2.clamp((W.rainbowS - ra) / 7, 0, 1) * (1 - night);
    }
    st.night = night; st.tier = S.tier;
  },
  // пасмурно на кадре f сейчас, 0..1 (кадр без погоды — 0); эту же долю берёт небо для теней туч (fx/sky.js)
  overcast: function (f) {
    var st = this.state, W = this.cfg.effects.weather, on = f.wxOn || { rain: false, snow: false };
    return Math.max(on.rain ? (st.rainK || 0) * W.rain.overcast : 0, on.snow ? (st.snowK || 0) * W.snow.overcast : 0);
  },
  bind: function (gl, U, f, s) {
    var st = this.state, W = this.cfg.effects.weather, on = f.wxOn || { rain: false, snow: false };
    var oc = this.overcast(f);
    var mask = f.wxMask && f.ng && on.snow ? E2.sstep(0, 1500, E2.Clock.now() - f.nT) : 0;      // маска догрузилась позже — проявляется без скачка
    gl.uniform4f(U['uWx' + s], oc, mask, on.rain ? (st.rainK || 0) * W.rain.wet : 0, mask > 0 ? (st.cover || 0) : 0);
  },
  // ---------- частицы ----------
  count: function (kind, view) {
    var W = this.cfg.effects.weather, n = kind === 'snow' ? W.snow.flakes : W.rain.drops, css = view.css();
    var area = E2.clamp(css[0] * css[1] / (390 * 844), 0.6, 1.6), tier = this.state.tier;
    n = Math.round(n * area);
    var cap = (this.cfg.budget || {}).particles || [400, 150, 60];      // потолок по ступеням — бюджет кадра (effects.schema.json, docs/STANOK.md §5.1)
    return Math.min(n, cap[tier === 'min' ? 2 : (tier === 'lite' ? 1 : 0)]);
  },
  landV: function (f, u, z) {       // где частица глубины z садится в столбце u (доля высоты кадра); 9 — нигде
    var L = f.land;
    if (!L || u < 0 || u >= 1) return 9;
    var d = L.d[Math.min(L.z - 1, Math.floor(z * L.z)) * L.w + Math.floor(u * L.w)];
    return d === 255 ? 9 : d / 255;
  },
  // Частица номер i в момент t (мс) на кадре f: null — её сейчас нет; иначе [u, v, z, альфа, поворот, посадка v, состояние, прогресс всплеска].
  // Период частицы постоянный (время пролёта всего кадра); села раньше — до конца периода её нет: под крышами осадков меньше, как в жизни.
  part: function (kind, i, t, f) {
    var st = this.state, span = st.spans[kind], M = this.M, snow = kind === 'snow', K = snow ? 0 : 1000003, H = E2.hash;
    if (!span || span.on === null) return null;
    var z = 0.06 + 0.94 * Math.pow(H(i, 11 + K), 1.6);                       // дальних больше, ближних меньше
    var vs = snow ? 0.05 + 0.10 * z : 0.95 + 0.75 * z;                       // скорость падения, высот кадра в секунду: ближние быстрее
    var P = (1 + 2 * M) / vs, tt = t / 1000 + H(i, 23 + K) * P, k = Math.floor(tt / P), tau = tt - k * P, born = (t / 1000 - tau) * 1000;
    if (E2.brk('precip-pop')) { if (t < span.on || (span.off !== null && t >= span.off)) return null; }     // поломка: вся толпа разом посреди кадра
    else {
      if (born < span.on || (span.off !== null && born >= span.off)) return null;
      if (H(i * 7919 + k, 31 + K) >= E2.sstep(0, this.RAMP_S * 1000, born - span.on)) return null;
    }
    var slant = snow ? 0.03 : 0.09, sr = slant * (1 + 2 * M) + 0.03;         // ветер несёт вправо: рождаются и левее кадра — входят из-за края
    var u0 = -sr + (1 + sr) * H(i * 7919 + k, 37 + K), A = snow ? 0.010 + 0.014 * z : 0, om = 0.9 + 0.8 * H(i, 41 + K), phi = 6.2832 * H(i, 43 + K);
    var mem = this.memo[kind], m = mem[i];
    if (!m || m.k !== k || m.f !== f.idx) {                                  // посадка: один раз на цикл — чистая функция (i, k, кадр)
      var tl = Infinity, ul = 0, vl = 9, DV = 1 / 96, v0 = -M, n = Math.ceil((1 + 2 * M) / DV), j, vv, uu, lv;
      if (!E2.brk('precip-noland')) for (j = 1; j <= n; j++) {
        vv = v0 + j * DV; uu = u0 + slant * (vv + M) + A * Math.sin(om * (vv + M) / vs + phi); lv = this.landV(f, uu, z);
        if (vv >= lv) { vl = Math.max(lv, vv - DV); tl = (vl + M) / vs; ul = u0 + slant * (vl + M) + A * Math.sin(om * tl + phi); break; }
      }
      m = mem[i] = { k: k, f: f.idx, tl: tl, ul: ul, vl: vl };
    }
    var rot = snow ? phi + tau * (0.5 + 0.9 * H(i, 47)) * (H(i, 53) < 0.5 ? -1 : 1) : 0;
    if (tau < m.tl) { var v = -M + vs * tau; return [u0 + slant * (v + M) + A * Math.sin(om * tau + phi), v, z, 1, rot, m.vl, 0, 0]; }
    var dl = tau - m.tl, fd = this.LAND_FADE[kind];
    if (dl < fd) return [m.ul, m.vl, z, 1 - dl / fd, rot, m.vl, 1, dl / this.SPLASH_S];
    if (!snow && dl < this.SPLASH_S) return [m.ul, m.vl, z, 0, rot, m.vl, 2, dl / this.SPLASH_S];
    return null;
  },
  memo: { rain: [], snow: [] },
  VS: 'attribute vec2 aPos; attribute vec2 aTex; attribute float aA; varying vec2 vT; varying float vA; void main() { vT = aTex; vA = aA; gl_Position = vec4(aPos, 0.0, 1.0); }',
  FS: 'precision mediump float; varying vec2 vT; varying float vA; uniform sampler2D uTex; uniform vec4 uTint; void main() { vec4 t = texture2D(uTex, vT); gl_FragColor = vec4(t.rgb * uTint.rgb, t.a) * (vA * uTint.a); }',
  quad: function (cx, cy, hw, hh, rot, cell, a, cw, ch) {      // прямоугольник с поворотом вокруг центра (пиксели холста) → вершины
    var B = this.buf, o = this.nq * 20, c = Math.cos(rot), s = Math.sin(rot), X = [-hw, hw, -hw, hw], Y = [-hh, -hh, hh, hh], T = [cell[0], cell[2], cell[0], cell[2]], V = [cell[1], cell[1], cell[3], cell[3]];
    for (var q = 0; q < 4; q++) {
      B[o + q * 5] = (cx + X[q] * c - Y[q] * s) / cw * 2 - 1; B[o + q * 5 + 1] = 1 - (cy + X[q] * s + Y[q] * c) / ch * 2;
      B[o + q * 5 + 2] = T[q]; B[o + q * 5 + 3] = V[q]; B[o + q * 5 + 4] = a;
    }
    this.nq++;
  },
  ensure: function (gl) {
    if (this.prg) return;
    this.prg = E2.GL.program(this.VS, this.FS);
    this.loc = { tex: gl.getAttribLocation(this.prg.prg, 'aTex'), a: gl.getAttribLocation(this.prg.prg, 'aA') };
    this.MAXQ = 1300; this.buf = new Float32Array(this.MAXQ * 20); this.vbo = gl.createBuffer(); this.ibo = gl.createBuffer();
    var idx = new Uint16Array(this.MAXQ * 6);
    for (var q = 0; q < this.MAXQ; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  },
  flush: function (gl, tex, tint) {
    if (!this.nq || !tex) { this.nq = 0; return; }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform4f(this.prg.U.uTint, tint[0], tint[1], tint[2], tint[3]);
    gl.bufferData(gl.ARRAY_BUFFER, this.buf.subarray(0, this.nq * 20), gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, this.nq * 6, gl.UNSIGNED_SHORT, 0);
    this.nq = 0;
  },
  over: function (gl, S, view) {
    var st = this.state, f = S.fb && S.mix >= 0.5 ? S.fb : S.fa, slot = f === S.fb ? 'B' : 'A';
    if (!f || !this.cfg) return false;
    var fm = S.fb ? Math.abs(1 - 2 * S.mix) : 1, W = this.cfg.effects.weather, cw = view.width(), ch = view.height(), css = view.css(), d = cw / Math.max(1, css[0]), sc = css[1] / 844;
    var kinds = [], self = this, t = S.t, night = st.night || 0;
    if (!E2.off('precip') && this.atlas) ['snow', 'rain'].forEach(function (k) { var sp = st.spans[k]; if (f.wxOn && f.wxOn[k] && sp.on !== null && (sp.off === null || t - sp.off < 30000)) kinds.push(k); });
    var rb = f.rainbow && f.rainbow.tex && st.rainbowA > 0.003 && f.wxOn.rain && !E2.off('rainbow') ? f.rainbow : null;
    if (!kinds.length && !rb) return false;
    this.ensure(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.prg.prg); gl.uniform1i(this.prg.U.uTex, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.loc.tex); gl.vertexAttribPointer(this.loc.tex, 2, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(this.loc.a); gl.vertexAttribPointer(this.loc.a, 1, gl.FLOAT, false, 20, 16);
    this.nq = 0;
    if (rb) {     // радуга: рисунок Gemini на плане главного здания (вырезана по его силуэту — едет вместе с ним)
      var dB = f.kd[1], a = view.project(rb.rect[0], rb.rect[1], dB, slot), b = view.project(rb.rect[2], rb.rect[3], dB, slot);
      this.quad((a[0] + b[0]) / 2 * cw, (a[1] + b[1]) / 2 * ch, (b[0] - a[0]) / 2 * cw, (b[1] - a[1]) / 2 * ch, 0, [0, 0, 1, 1], 1, cw, ch);
      this.flush(gl, rb.tex, [1, 1, 1, st.rainbowA * fm * (1 - 0.6 * Math.max(st.rainK || 0, st.snowK || 0))]);
    }
    kinds.forEach(function (kind) {
      var snow = kind === 'snow', cells = snow ? self.cells.flakes : self.cells.rain, n = self.count(kind, view), i, p, q, s, hw, hh, cell, ang;
      if (!cells.length) return;
      for (i = 0; i < n && self.nq < self.MAXQ - 3; i++) {
        p = self.part(kind, i, t, f);
        if (!p) continue;
        q = view.project(p[0], p[1], p[2], slot);
        if (q[0] < -0.05 || q[0] > 1.05 || q[1] < -0.08 || q[1] > 1.05) continue;
        cell = cells[Math.floor(E2.hash(i, 59) * cells.length) % cells.length];
        if (snow) {
          s = (1.7 + 4.4 * p[2]) * sc * d;
          if (p[3] > 0) self.quad(q[0] * cw, q[1] * ch, s, s, p[4], cell, p[3] * (0.6 + 0.4 * p[2]), cw, ch);
        } else {
          hh = (6 + 9 * p[2]) * sc * d; hw = Math.max(0.9 * d, hh / 8); ang = -Math.atan(0.09 * view.frameSize()[0] / view.frameSize()[1]);     // капля вытянута вдоль своего пути
          if (p[6] === 0) self.quad(q[0] * cw, q[1] * ch - hh, hw, hh, ang, cell, 0.5 + 0.5 * p[2], cw, ch);          // низ капли — в точке частицы
          else {      // всплеск: две короткие чёрточки той же капли расходятся «галочкой» и тают (рисунок Gemini, код только кладёт)
            var e = Math.min(1, p[7]), sh = hh * 0.22 * (0.6 + e), sa = (1 - e) * (0.45 + 0.4 * p[2]);
            if (sa > 0.01) { self.quad(q[0] * cw - sh * 0.8, q[1] * ch - sh * 0.7, hw * 0.8, sh, -0.9, cell, sa, cw, ch); self.quad(q[0] * cw + sh * 0.8, q[1] * ch - sh * 0.7, hw * 0.8, sh, 0.9, cell, sa, cw, ch); }
          }
        }
      }
      var td = snow ? W.snow.tintDay : W.rain.tintDay, tn = snow ? W.snow.tintNight : W.rain.tintNight;
      self.flush(gl, self.atlas, [0, 1, 2, 3].map(function (c) { return (td[c] + (tn[c] - td[c]) * night) * (c === 3 ? fm : 1); }));
    });
    gl.disableVertexAttribArray(this.loc.tex); gl.disableVertexAttribArray(this.loc.a);
    return true;
  },
  // для проверок (гейт G7): состояние и видимые частицы текущего кадра в текущий момент: [номер, u, v, z, альфа, посадка v, состояние, x, y экрана,
  // линия неба в столбце частицы — v первой поверхности сверху] — посадка на ней же → частица погасла на линии крыши (силуэта), а не на земле
  debug: function (f) {
    var st = this.state, t = E2.Clock.now(), self = this, parts = { snow: [], rain: [] }, view = E2.Stage.view();
    if (f && this.cfg && this.atlas) ['snow', 'rain'].forEach(function (k) {
      if (!f.wxOn || !f.wxOn[k] || st.spans[k].on === null) return;
      for (var i = 0, n = self.count(k, view), p; i < n; i++) if ((p = self.part(k, i, t, f)) && (p[3] > 0 || p[6] === 2)) { var q = E2.Stage.project(p[0], p[1], p[2]); parts[k].push([i, +p[0].toFixed(4), +p[1].toFixed(4), +p[2].toFixed(3), +p[3].toFixed(3), +p[5].toFixed(4), p[6], Math.round(q[0]), Math.round(q[1]), +self.landV(f, p[0], 0).toFixed(4)]); }
    });
    return { kind: st.kind, rainK: st.rainK || 0, snowK: st.snowK || 0, cover: st.cover || 0, spans: st.spans, rainbowA: st.rainbowA, hasRainbow: !!(f && f.rainbow && f.rainbow.tex),
      on: f ? f.wxOn : null, mask: !!(f && f.wxMask), t: t, M: this.M, parts: parts };
  }
});

// ===== fx/sky.js =====
// fx/sky.js — небо: тени облаков и плывущие облака рисунка (docs/STANOK.md §2.2, §4.7: кодом можно только небо, огни и осадки).
// Два слоя, оба — только про уже нарисованное (ничего не дорисовывается):
//  1) тени облаков — мягкое поле пятен плывёт по земле и фасадам и медленно меняет форму (крючок mix: после смешения двух кадров).
//     На небо тень не ложится. В непогоду теней больше и края рваные (тучи). Ночью — по настройке clouds.night. Формулы поля — как
//     у e1.62 (CLOUD_FIELD), но считаются в каждой точке, а не в узлах сетки: e1.62 ради поля рисовал всю сцену сеткой, и картинка
//     расходилась с обычным прямоугольником на доли пикселя (находка П1). Поэтому паритет теней с e1.62 — с порогом, не побайтно.
//  2) облака рисунка плывут (drift кадра): в прямоугольнике неба выборка рисунка медленно ходит влево-вправо (как pix drift e1.62).
//     Сдвигается только подложка (небо за зданием): слой здания, даже если он заходит в прямоугольник, стоит на месте.
// Время — только E2.Clock (S.t): два прогона с одинаковыми шагами дают одинаковые пиксели (гейт G6). Стоп-кадр (still) замораживает небо.
// Интерьер — без неба (схема не даёт включить). Минимальная ступень — эффект выключен (docs/STANOK.md §5.1), лёгкая — как полная.
// Для проверок: ?off=sky (всё), clouds (тени), drift (облака рисунка), skymove (время неба стоит); window.__e2.skyT(с) — задать время
// неба (паритет с e1.62 снимает тот же момент). ?break=sky-still, sky-hard, sky-thick, sky-all, sky-interior, sky-min — намеренные поломки (гейт G7).
E2.effect({
  name: 'sky',
  low: 'off',
  state: { t: 0, pin: null, stillT: null, k: 0, oc: 0, night: 1, on: true },
  glsl: function (cfg) {
    var C = cfg.effects.sky.clouds, glf = E2.glf, FW = cfg.look.frameSize[0], FH = cfg.look.frameSize[1];
    var drift = cfg.frames.some(function (f) { return !!f.effects.sky.drift; });
    this.frameUniforms = drift ? [['vec4', 'skyBox'], ['vec4', 'skyDrift']] : [];     // ни у одного кадра облака не плывут — этого куска в шейдере нет
    var hard = E2.brk('sky-hard'), thick = E2.brk('sky-thick');     // ?break=sky-hard — тень с резким краем; sky-thick — втрое гуще заданной (красные случаи G7)
    return {
      uniforms: ['uniform vec4 uSky;'],     // x — сила тени (смешана по двум кадрам); y — время неба, с; z — тучи 0..1 (непогода); w — множитель ночи
      funcs: [
        'float skyHash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }',
        'float skyNoise(vec2 q) { vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), f.x), mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0, 1.0)), f.x), f.y); }',
        'float skyField(vec2 uv, float t) {',
        '  vec2 q = vec2(uv.x * ' + glf(FW / FH) + ', uv.y) * ' + glf(C.scale) + ' + vec2(t, t * 0.23) * ' + glf(C.speed) + ';',
        '  float n = 0.55 * skyNoise(q) + 0.30 * skyNoise(q * 2.03 + vec2(5.2, 1.3) + t * 0.021) + 0.15 * skyNoise(q * 4.1 + vec2(1.7, 8.9) - t * 0.034);',
        '  return smoothstep(0.15, 0.82, n); }',
        'float skyBlob(vec2 uv, vec2 center, vec2 radius) {',
        '  vec2 d = (uv - center) / radius;',
        '  float wobble = 0.15 * sin(d.x * 6.0 + center.x * 9.0) * sin(d.y * 5.0 + center.y * 7.0);',
        '  return smoothstep(1.0, 0.15, length(d) + wobble); }',
        'float skyBlobs(vec2 uv, float t) {',     // две большие тени туч ползут слева направо: только в непогоду, поверх поля
        '  float b1 = skyBlob(uv, vec2(mix(-0.35, 1.35, fract(t / 40.0)), 0.58), vec2(0.30, 0.17));',
        '  float b2 = skyBlob(uv, vec2(mix(-0.35, 1.35, fract((t + 20.0) / 53.0)), 0.32), vec2(0.22, 0.13));',
        '  return clamp(b1 + b2, 0.0, 1.0); }'
      ].join('\n'),
      uv: drift ? [
        '  if (skyDrift.x != 0.0) {',
        '    vec2 sW = vec2(' + glf(FW) + ', ' + glf(FH) + '), sq = pc * sW, sbs = (skyBox.zw - skyBox.xy) * sW, sbp = (sq - skyBox.xy * sW) / sbs;',
        '    float sIn = step(0.0, sbp.x) * step(sbp.x, 1.0) * step(0.0, sbp.y) * step(sbp.y, 1.0) * smoothstep(0.0, 4.0, min(min(sbp.x, 1.0 - sbp.x) * sbs.x, min(sbp.y, 1.0 - sbp.y) * sbs.y));',
        '    pc = clamp(pc + vec2(skyDrift.x * sin(6.2832 * uSky.y / skyDrift.y + skyDrift.z) * sIn, 0.0) / sW, 0.0, 1.0);',
        '  }'
      ].join('\n') : null,
      mix: [
        '  if (uSky.x + uSky.z > 0.0) {',
        '    float skS = skyField(uv, uSky.y);',
        '    if (uSky.z > 0.0) skS = clamp(mix(skS, max(skS, skyBlobs(uv * 0.7 + 0.15, uSky.y * 1.3 + 17.0)), uSky.z) * (0.55 + 0.7 * skyNoise(uv * 3.5 + vec2(uSky.y * 0.02, 0.0))), 0.0, 1.0);',
        hard ? '    skS = step(0.5, skS);' : '',
        thick ? '    skS *= 3.0;' : '',
        '    c *= 1.0 - (uSky.x + uSky.z * ' + glf(C.overcast) + ') * skS * ' + (E2.brk('sky-all') ? '1.0' : '(1.0 - sa.a)') + ' * uSky.w;',     // ?break=sky-all — тень и на небе
        '  }'
      ].filter(function (l) { return l !== ''; }).join('\n')
    };
  },
  upload: function (G, entry, r) {
    var fs = entry.cfg.effects.sky;
    entry.skyK = fs.shadow;
    if (E2.brk('sky-interior') && entry.cfg.kind === 'interior') entry.skyK = 0.15;     // ?break=sky-interior — тени облаков под крышей
    entry.skyDrift = fs.drift || null;
    // маленькая карта неба кадра (доля неба 0..255 по клеткам; небо за главным зданием не в счёт): для проверок («тень не лежит на небе»)
    // и будущих событий неба
    var W = 32, H = Math.round(W * r.eh / r.ew), d = new Uint8Array(W * H), x, y, u, v;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      u = (x + 0.5) / W; v = (y + 0.5) / H;
      d[y * W + x] = Math.round(r.gpuDepth[(Math.min(r.eh - 1, Math.floor(v * r.eh)) * r.ew + Math.min(r.ew - 1, Math.floor(u * r.ew))) * 4 + 1] *
        (255 - r.bldPm[(Math.min(r.h - 1, Math.floor(v * r.h)) * r.w + Math.min(r.w - 1, Math.floor(u * r.w))) * 4 + 3]) / 255);
    }
    entry.skyMap = { w: W, h: H, d: d };
  },
  bind: function (gl, U, f, s) {
    if (!U['uSkyDrift' + s]) return;
    var d = this.state.on && !E2.off('drift') ? f.skyDrift : null;
    gl.uniform4f(U['uSkyBox' + s], d ? d.box[0] : 0, d ? d.box[1] : 0, d ? d.box[2] : 1, d ? d.box[3] : 1);
    gl.uniform4f(U['uSkyDrift' + s], d ? d.px : 0, d ? d.periodS : 1, d ? d.phase : 0, 0);
  },
  step: function (S) {
    var st = this.state, C = S.cfg.effects.sky.clouds, tod = E2.fxGet('tod'), wx = E2.fxGet('weather');
    st.on = !E2.off('sky') && (S.tier !== 'min' || E2.brk('sky-min'));     // ?break=sky-min — слабая ступень не выключает небо
    if (S.still || E2.off('skymove')) { if (st.stillT === null) st.stillT = S.t; } else st.stillT = null;
    st.t = st.pin !== null ? st.pin : (E2.brk('sky-still') ? 0 : (st.stillT !== null ? st.stillT : S.t) / 1000);     // ?break=sky-still — небо стоит
    var on = st.on && !E2.off('clouds'), kA = S.fa ? S.fa.skyK : 0, kB = S.fb ? S.fb.skyK : kA;
    var oA = wx && wx.overcast && S.fa ? wx.overcast(S.fa) : 0, oB = wx && wx.overcast && S.fb ? wx.overcast(S.fb) : oA;
    st.k = on ? kA + (kB - kA) * S.mix : 0;
    st.oc = on ? oA + (oB - oA) * S.mix : 0;
    st.night = 1 - (tod ? tod.state.gnd : 0) * (1 - C.night);
  },
  uniforms: function (gl, U) { var st = this.state; gl.uniform4f(U.uSky, st.k, st.t, st.oc, st.night); },
  // для проверок (гейт G7): состояние неба и настройки кадра
  debug: function (f) {
    var st = this.state;
    return { t: st.t, k: st.k, oc: st.oc, night: st.night, on: st.on, pin: st.pin, shadow: f ? f.skyK : null, drift: f ? f.skyDrift : null,
      map: f && f.skyMap ? { w: f.skyMap.w, h: f.skyMap.h, d: Array.prototype.slice.call(f.skyMap.d) } : null };
  }
});

// ===== fx/actors.js =====
// fx/actors.js — герои с эмоцией (docs/STANOK.md §4.6, матрица §3): ролик Veo или картинка Gemini по условию «время × погода» + тап.
// Код ничего не рисует: смешивает пиксели ролика (картинки) с пикселями рисунка в куске слоя здания (texSubImage2D) — поэтому наклон,
// день, полдень, закат шейдером, погода и снег на предметах те же, что у всего кадра. В версии кадра, которая лежит отдельной картинкой
// (закатный рисунок, ночной рисунок), герой пишется ТОНОМ: версия + (ролик − день) × (версия / день, размыто) — его видно во всех версиях.
// Условие (слот): дождь или снег (если на кадре есть погода) → ночь (ночной рисунок лёг больше чем наполовину) → день; закат берёт дневные
// ролики. Слот «drawing» — героя даёт сам рисунок версии (люди ночью неподвижны: дневной ролик через тон даёт призраков, lessons §4).
// Несколько роликов в слоте — по концу ролика следующий (случайный по часам движка, другой); один — по кругу. Смена — мягкая (fadeS).
// Время ролика — от часов движка: в проверках (?vt=1) ролик не играет сам, а ставится на свой момент (G6, G10); __e2.fx('actors').pending
// говорит, сколько роликов ещё не встали на нужный кадр.
// ?off=actors — героев нет (рисунок как есть); ?break=actors-sunset — герои гаснут на закате (старая ошибка e1: «актёр пропал на «Закате»»,
// красный случай G10); ?break=actors-wxfreeze — в дождь и снег ролики стоят (красный случай G10 «замер»).
E2.effect({
  name: 'actors',
  low: 'on',            // изюминки отключаются последними (§5.1)
  init: function (cfg) {
    this.C = cfg.effects.actors;
    this.all = [];        // все варианты всех кадров с роликом (пауза, когда кадр не на экране)
    var self = this;
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) && !E2.Clock.virtual;
    this.tapIn = null;
    var el = document.getElementById('stage');
    if (el) {
      el.addEventListener('pointerdown', function (e) { self.tapIn = { x: e.clientX, y: e.clientY, t: E2.Clock.now() }; });
      el.addEventListener('pointerup', function (e) {
        var q = self.tapIn; self.tapIn = null;
        if (!q) return;
        var C = self.C, dx = e.clientX - q.x, dy = e.clientY - q.y;
        if (dx * dx + dy * dy > C.tapMaxPx * C.tapMaxPx || E2.Clock.now() - q.t > C.tapMaxS * 1000) return;
        var r = el.getBoundingClientRect();
        E2.safe('actors.tap', function () { self.tap(e.clientX - r.left, e.clientY - r.top); });
      });
    }
  },
  // ---------- загрузка: кусок слоя здания под всеми героями кадра ----------
  upload: function (G, entry, r) {
    var L = (entry.cfg.effects.actors || {}).list || [];
    if (!L.length) return;
    var W = r.w, H = r.h, u0 = 1, v0 = 1, u1 = 0, v1 = 0;
    L.forEach(function (a) {
      var rs = [a.rect];
      Object.keys(a.media).forEach(function (k) { var m = a.media[k]; (Array.isArray(m) ? m : (m && m.rect ? [m] : [])).forEach(function (v) { rs.push(v.rect); }); });
      rs.forEach(function (q) { u0 = Math.min(u0, q[0]); v0 = Math.min(v0, q[1]); u1 = Math.max(u1, q[2]); v1 = Math.max(v1, q[3]); });
    });
    var x0 = Math.max(0, Math.floor(u0 * W)), y0 = Math.max(0, Math.floor(v0 * H)), x1 = Math.min(W, Math.ceil(u1 * W)), y1 = Math.min(H, Math.ceil(v1 * H));
    var w = x1 - x0, h = y1 - y0, n = w * h, base = new Uint8Array(n * 4), dfull = new Uint8Array(n * 3);
    var pm = r.bldPm, g = r.ground4 || r.ground, gc = r.ground4 ? 4 : 3;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var o = (y0 + y) * W + x0 + x, q = y * w + x, al = pm[o * 4 + 3] / 255;
      for (var c = 0; c < 4; c++) base[q * 4 + c] = pm[o * 4 + c];
      for (c = 0; c < 3; c++) dfull[q * 3 + c] = Math.min(255, pm[o * 4 + c] + g[o * gc + c] * (1 - al));
    }
    var st = { x0: x0, y0: y0, w: w, h: h, W: W, H: H, base: base, dfull: dfull, out: new Uint8Array(n * 4), versions: {}, actors: [], dirty: true, last: -1e9, off: null, idx: entry.idx };
    var self = this;
    L.forEach(function (a, k) {
      var A = { cfg: a, k: k, slot: null, pool: [], cur: null, prev: null, w: 0, want: null, n: 0 };
      A.vars = {};
      Object.keys(a.media).forEach(function (sl) {
        var m = a.media[sl];
        if (m === 'drawing' || !m) return;
        (Array.isArray(m) ? m : [m]).forEach(function (v) { if (!A.vars[v.name]) A.vars[v.name] = self.variant(entry, st, v); });
      });
      st.actors.push(A);
    });
    entry.actors = st;
  },
  variant: function (entry, st, v) {   // один ролик или картинка героя: свой прямоугольник, маска, кадр ролика — в доли куска
    var W = st.W, H = st.H, files = entry.cfg.files;
    var bx = [Math.round(v.rect[0] * W) - st.x0, Math.round(v.rect[1] * H) - st.y0, Math.round(v.rect[2] * W) - st.x0, Math.round(v.rect[3] * H) - st.y0];
    var bw = bx[2] - bx[0], bh = bx[3] - bx[1];
    var ir = v.imageRect || v.rect, ibx = [Math.round(ir[0] * W) - st.x0, Math.round(ir[1] * H) - st.y0, Math.round(ir[2] * W) - st.x0, Math.round(ir[3] * H) - st.y0];
    var V = { cfg: v, files: files, box: bx, bw: bw, bh: bh, ibox: ibx, iw: ibx[2] - ibx[0], ih: ibx[3] - ibx[1], img: null, mask: null, vid: null, vdata: null, vT: -1, t0: 0, ended: false, bad: false, seen: 0, want: -1 };
    function pixels(file, fn, ww, hh) {
      ww = ww || bw; hh = hh || bh;
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () { E2.safe('actors ' + file, function () { var cv = document.createElement('canvas'); cv.width = ww; cv.height = hh; var x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, ww, hh); fn(x.getImageData(0, 0, ww, hh).data); st.dirty = true; }); };
      im.onerror = function () { E2.err('actors', file + ' не загрузился'); V.bad = true; };
      im.src = files[file];
    }
    if (v.image) pixels(v.image, function (d) { V.img = d; }, V.iw, V.ih);
    if (v.mask) pixels(v.mask, function (d) { var m = new Uint8Array(bw * bh); for (var i = 0; i < m.length; i++) m[i] = d[i * 4]; V.mask = m; });
    if (v.video) { V.cv = document.createElement('canvas'); V.cv.width = bw; V.cv.height = bh; V.cx = V.cv.getContext('2d', { willReadFrequently: true }); this.all.push(V); }
    return V;
  },
  video: function (V) {   // ролик создаётся при первом показе (без звука, inline, в скрытом слое документа — так он стартует на iPhone)
    if (V.vid || !V.cfg.video) return V.vid;
    var vd = document.createElement('video'), f = V.files;
    vd.muted = true; vd.defaultMuted = true; vd.playsInline = true; vd.preload = 'auto'; vd.crossOrigin = 'anonymous';
    vd.setAttribute('muted', ''); vd.setAttribute('playsinline', ''); vd.setAttribute('webkit-playsinline', '');
    vd.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    vd.addEventListener('error', function () { E2.err('actors', V.cfg.video + ' не загрузился'); V.bad = true; });
    vd.addEventListener('seeked', function () { V.seekDone = true; });
    document.body.appendChild(vd);
    var mp4 = vd.canPlayType('video/mp4; codecs="avc1.4d401f"');
    vd.src = mp4 ? f[V.cfg.video] : f[V.cfg.webm];      // нет H.264 (облачный Chromium) — запасной WebM; у обоих свой ?v из manifest
    V.vid = vd;
    return vd;
  },
  onState: function (G, entry, kind, r) {   // закатный или ночной рисунок кадра лёг — кусок версии + тон «версия / день» (размыто)
    var st = entry.actors;
    if (!st || (kind !== 'sunset' && kind !== 'night')) return;
    var src = kind === 'night' ? (r.full4 || r.full) : r.full, ch = (kind === 'night' && r.full4) ? 4 : 3, w = st.w, h = st.h, n = w * h, W = st.W;
    if (!src) return;
    var base = new Uint8Array(n * ch), ver = new Float32Array(n * 3), day = new Float32Array(n * 3);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var o = ((st.y0 + y) * W + st.x0 + x) * ch, q = y * w + x;
      for (var c = 0; c < ch; c++) base[q * ch + c] = src[o + c];
      for (c = 0; c < 3; c++) { ver[q * 3 + c] = src[o + c]; day[q * 3 + c] = st.dfull[q * 3 + c]; }
    }
    var R = new Float32Array(n * 3), bv = this.blur(ver, w, h, this.C.toneBlurPx), bd = this.blur(day, w, h, this.C.toneBlurPx);
    for (var i = 0; i < n * 3; i++) R[i] = E2.clamp(bv[i] / Math.max(bd[i], 8), 0, 1.6);
    st.versions[kind] = { base: base, ch: ch, R: R, out: new Uint8Array(n * ch), tex: kind === 'night' ? entry.nb : entry.sb };
    st.dirty = true;
  },
  blur: function (a, w, h, rad) {   // два прохода скользящего среднего по строкам и столбцам (≈ гаусс), 3 канала
    var b = new Float32Array(a.length), t = new Float32Array(a.length), pass, x, y, c, k;
    for (pass = 0; pass < 2; pass++) {
      var src = pass ? b : a;
      for (y = 0; y < h; y++) for (c = 0; c < 3; c++) { var s = 0, cnt = 0; for (k = 0; k <= rad && k < w; k++) { s += src[(y * w + k) * 3 + c]; cnt++; }
        for (x = 0; x < w; x++) { t[(y * w + x) * 3 + c] = s / cnt; var ad = x + rad + 1, rm = x - rad; if (ad < w) { s += src[(y * w + ad) * 3 + c]; cnt++; } if (rm >= 0) { s -= src[(y * w + rm) * 3 + c]; cnt--; } } }
      for (x = 0; x < w; x++) for (c = 0; c < 3; c++) { s = 0; cnt = 0; for (k = 0; k <= rad && k < h; k++) { s += t[(k * w + x) * 3 + c]; cnt++; }
        for (y = 0; y < h; y++) { b[(y * w + x) * 3 + c] = s / cnt; ad = y + rad + 1; rm = y - rad; if (ad < h) { s += t[(ad * w + x) * 3 + c]; cnt++; } if (rm >= 0) { s -= t[(rm * w + x) * 3 + c]; cnt--; } } }
    }
    return b;
  },
  // ---------- условие: какой слот сейчас ----------
  slotNow: function (f) {
    var wx = E2.fxGet('weather'), tod = E2.fxGet('tod'), on = f.wxOn || { rain: false, snow: false };
    if (wx && (wx.state.kind === 'rain' || wx.state.kind === 'snow') && on[wx.state.kind]) return wx.state.kind;
    if (tod && tod.state.night > 0.5) return 'night';
    return 'day';
  },
  poolOf: function (A, slot) {
    var m = A.cfg.media, p = m[slot];
    if (slot === 'night' && p === undefined) p = 'drawing';
    if ((slot === 'rain' || slot === 'snow') && p === undefined) p = m.day;     // погоды у героя нет — живёт как днём
    if (p === 'drawing' || !p) return [];
    p = p.map(function (v) { return A.vars[v.name]; }).filter(function (V) { return V && !V.bad; });
    if (slot === 'day' || slot === 'sunset') {                                    // часы зрителя: утренний и дневной ролик (?vt=1 — 12:00)
      var hr = E2.Clock.hour(), inH = function (V) { var q = V.cfg.hours; return !q || (q[0] <= q[1] ? hr >= q[0] && hr < q[1] : hr >= q[0] || hr < q[1]); };
      var ok = p.filter(inH); if (ok.length) p = ok;
    }
    return p;
  },
  start: function (A, V, st) {
    if (A.cur === V) return;
    var now = E2.Clock.now();
    if (A.cur && A.cw > 0.01) { if (A.prev && A.prev !== A.cur) this.stopVid(A.prev); A.prev = A.cur; A.pw0 = A.cw; A.tp = now; } else if (A.cur) this.stopVid(A.cur);
    A.cur = V; A.cw = 0; A.tc = now; V.t0 = now; V.ended = false; V.vT = -1; V.want = -1;
    if (V.vid && !E2.Clock.virtual) { try { V.vid.currentTime = 0; } catch (e) {} }
    st.dirty = true;
  },
  stopVid: function (V) { if (V && V.vid && !V.vid.paused) { try { V.vid.pause(); } catch (e) {} } },
  pick: function (A, pool, st, avoid) {   // следующий ролик слота: случайный по часам движка, по возможности другой
    var c = pool.length > 1 && avoid ? pool.filter(function (V) { return V !== avoid; }) : pool;
    A.n++;
    return c[Math.floor(E2.hash(st.idx * 131 + A.k, A.n) * c.length) % c.length];
  },
  tap: function (x, y) {
    var f = E2.Frames.get(E2.Stage.frame()), st = f && f.actors;
    if (!st || E2.Stage.fading()) return false;
    var d = f.kd ? f.kd[1] : 0.5, hit = false;
    st.actors.forEach(function (A) {
      var c = A.cfg, h = c.hit;
      if (!h || !c.media.tap || hit) return;
      var p0 = E2.Stage.project(h[0], h[1], d), p1 = E2.Stage.project(h[2], h[3], d);
      if (x >= p0[0] && x <= p1[0] && y >= p0[1] && y <= p1[1]) { A.want = A.vars[c.media.tap.name]; hit = true; }
    });
    return hit;
  },
  // ---------- шаг: выбрать, сдвинуть ролики, смешать кусок ----------
  step: function (S) {
    var self = this, now = S.t;
    if (this.lastGc === undefined || now - this.lastGc > 500) {
      this.lastGc = now;
      this.all.forEach(function (V) { if (now - V.seen > 400) self.stopVid(V); });
    }
    [S.fa, S.fb].forEach(function (f) { if (f && f.actors) E2.safe('actors.frame', function () { self.frameStep(f, S); }); });
  },
  frameStep: function (f, S) {
    var st = f.actors, self = this, now = S.t, C = this.C;
    var off = E2.off('actors'), tod = E2.fxGet('tod');
    if (off !== st.off) { st.off = off; st.dirty = true; }
    var slot = this.slotNow(f), mute = st.showMute || 0;
    st.pending = 0;
    st.actors.forEach(function (A) {
      if (slot !== A.slot) {                       // условие сменилось — новый ролик слота (старый мягко гаснет)
        A.slot = slot; A.pool = self.poolOf(A, slot);
        if (A.pool.length) self.start(A, self.pick(A, A.pool, st, null), st);
        else if (A.cur) { A.prev = A.cur; A.pw0 = A.cw; A.tp = now; A.cur = null; A.cw = 0; }
      }
      if (A.want) { var wv = A.want; A.want = null; if (!wv.bad) { self.start(A, wv, st); A.tapOn = true; } }
      var V = A.cur;
      if (V && V.ended && (A.pool.length > 1 || A.tapOn)) { A.tapOn = false; if (A.pool.length) self.start(A, self.pick(A, A.pool, st, V), st); }
      var k = self.reduced ? 0 : 1;
      if (E2.brk('actors-sunset') && tod) k *= 1 - tod.state.sun;
      k *= 1 - mute * (A.cfg.underShow === false ? 0 : 1);
      // веса — от часов движка (сколько прошло с начала смены), а не накоплением шагов: перерисовка того же момента их не меняет (G6)
      var cw0 = A.cw, pw0 = A.pw || 0, fd = C.fadeS * 1000;
      A.cw = A.cur ? Math.min(k, E2.clamp((now - A.tc) / fd, 0, 1)) : 0;
      if (A.prev) { A.pw = A.pw0 * (1 - E2.clamp((now - A.tp) / fd, 0, 1)) * (k > 0 ? 1 : 0); if (A.pw <= 0.002) { self.stopVid(A.prev); A.prev = null; A.pw = 0; } }
      if (Math.abs(A.cw - cw0) > 0.004 || Math.abs((A.pw || 0) - pw0) > 0.004) st.dirty = true;
      [A.cur, A.prev].forEach(function (Q) { if (Q && Q.cfg.video) self.advance(Q, A, st, now, Q === A.cur ? A.cw : A.pw, slot); });
    });
    var busy = st.actors.some(function (A) { return (A.cur && A.cur.cfg.video && A.cw > 0.005) || A.prev; });
    if (!st.dirty) return;
    if (!E2.Clock.virtual && busy && now - st.last < C.updateMs) return;     // кусок обновляется ~25 раз в секунду, не каждый кадр
    st.last = now; st.dirty = false;
    this.compose(f, st, tod);
  },
  advance: function (V, A, st, now, w, slot) {   // ролик идёт по часам движка; в проверках — ставится на нужный момент
    var vd = this.video(V);
    V.seen = now;
    if (!vd) return;
    if (w <= 0.002 && V !== A.cur) { this.stopVid(V); return; }
    var dur = vd.duration, loop = A.pool.length <= 1 && !A.tapOn;
    var frozen = E2.brk('actors-wxfreeze') && (slot === 'rain' || slot === 'snow');
    if (E2.Clock.virtual) {
      if (!(vd.readyState >= 1) || !(dur > 0)) { st.pending++; return; }
      var tt = frozen ? 0 : (now - V.t0) / 1000;
      if (!loop && tt >= dur - 0.05) { V.ended = true; tt = dur - 0.05; }
      if (loop) tt = tt % Math.max(0.1, dur - 0.05);
      tt = Math.round(tt * 30) / 30;
      // новая перемотка — только когда прежняя закончилась: длинный advance() идёт без событий браузера, и перематывать на каждом шаге
      // бессмысленно (дорого и всё равно встанет на последнюю цель). Снимок ждёт pending = 0 — тогда кадр ролика ровно на своей секунде.
      if (tt !== V.want && !vd.seeking) { V.want = tt; V.seekDone = false; try { vd.currentTime = tt; } catch (e) {} }
      if (vd.seeking || !V.seekDone || V.want !== tt || vd.readyState < 2) { st.pending++; return; }
      if (V.vT !== tt) this.grab(V, st, tt);
      return;
    }
    vd.loop = loop;
    if (frozen) { this.stopVid(V); return; }
    if (vd.paused && !V.ended) { var pr = vd.play(); if (pr && pr.catch) pr.catch(function () {}); }
    if (!loop && (vd.ended || (dur > 0 && vd.currentTime >= dur - 0.06))) V.ended = true;
    if (vd.readyState >= 2 && !vd.seeking && vd.currentTime !== V.vT) this.grab(V, st, vd.currentTime);
  },
  grab: function (V, st, t) {
    try { V.cx.drawImage(V.vid, 0, 0, V.bw, V.bh); V.vdata = V.cx.getImageData(0, 0, V.bw, V.bh).data; V.vT = t; st.dirty = true; }
    catch (e) { E2.err('actors кадр ролика', e); V.bad = true; }
  },
  compose: function (f, st, tod) {   // кусок слоя здания (+ тон в закатный и ночной рисунок, когда они видны)
    var w = st.w, o = st.out, c;
    o.set(st.base);
    var layers = [];
    if (!st.off) st.actors.forEach(function (A) {     // ?off=actors — рисунок как есть (замеры сравнивают один момент с героями и без: веса не трогаем)
      if (A.prev && A.pw > 0.002) layers.push([A.prev, A.pw]);
      if (A.cur && A.cw > 0.002) layers.push([A.cur, A.cw]);
    });
    var vers = [];
    if (tod) { if (st.versions.sunset && tod.state.sun > 0.002 && f.sb) vers.push(st.versions.sunset); if (st.versions.night && tod.state.night > 0.002 && f.nb) vers.push(st.versions.night); }
    vers.forEach(function (Q) { Q.out.set(Q.base); });
    var D = st.dfull;
    function lay(src, bx, bw, alpha, k) {   // один слой героя: src — RGBA своего прямоугольника, alpha(p) — непрозрачность точки 0..1
      for (var y = Math.max(0, bx[1]); y < Math.min(st.h, bx[3]); y++) for (var x = Math.max(0, bx[0]); x < Math.min(w, bx[2]); x++) {
        var p = (y - bx[1]) * bw + (x - bx[0]), a = alpha(p) * k;
        if (a <= 0.002) continue;
        var q = y * w + x, s4 = p * 4, b1 = 1 - a;
        o[q * 4] = src[s4] * a + o[q * 4] * b1; o[q * 4 + 1] = src[s4 + 1] * a + o[q * 4 + 1] * b1; o[q * 4 + 2] = src[s4 + 2] * a + o[q * 4 + 2] * b1;
        o[q * 4 + 3] = 255 * a + o[q * 4 + 3] * b1;       // слой здания: цвет умножен на альфу, герой непрозрачен
        for (var vi = 0; vi < vers.length; vi++) {
          var Q = vers[vi], ch = Q.ch, R = Q.R, B = Q.base, O = Q.out;
          for (c = 0; c < 3; c++) { var tg = B[q * ch + c] + (src[s4 + c] - D[q * 3 + c]) * R[q * 3 + c]; O[q * ch + c] = Math.max(0, Math.min(255, tg * a + O[q * ch + c] * b1)); }
        }
      }
    }
    layers.forEach(function (L) {   // картинка героя (погода, поза), поверх неё — ролик по маске
      var V = L[0], k = L[1], img = V.img, vd = V.vdata, m = V.mask;
      if (img) lay(img, V.ibox, V.iw, function (p) { return img[p * 4 + 3] / 255; }, k);
      if (V.cfg.video && vd && m) lay(vd, V.box, V.bw, function (p) { return m[p] / 255; }, k);
    });
    var gl = E2.GL.gl();
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (f.show && f.show.vis > 0 && f.show.overlap) f.show.dirty = true;     // идёт шоу поверх героев: кусок слоя пишет шоу (с нашим кадром внутри)
    else { gl.bindTexture(gl.TEXTURE_2D, f.bld); gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, w, st.h, gl.RGBA, gl.UNSIGNED_BYTE, o); }
    // версии: пишем, пока видны, и один раз — «чистый» кусок, когда погасли (иначе там остался бы последний кадр ролика)
    ['sunset', 'night'].forEach(function (kd) {
      var Q = st.versions[kd]; if (!Q) return;
      var tex = kd === 'night' ? f.nb : f.sb, on = vers.indexOf(Q) >= 0;
      if (!tex || (!on && !Q.dirtyTex)) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, w, st.h, Q.ch === 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, on ? Q.out : Q.base);
      Q.dirtyTex = on;
    });
  },
  pendingNow: function () { var p = 0; [E2.Stage.frame()].forEach(function (i) { var f = E2.Frames.get(i); if (f && f.actors) p += f.actors.pending || 0; }); return p; },
  debug: function (f) {
    var st = f && f.actors;
    if (!st) return { actors: [], pending: 0 };
    return {
      pending: st.pending || 0, slot: this.slotNow(f), mute: st.showMute || 0,
      box: [st.x0, st.y0, st.w, st.h],
      actors: st.actors.map(function (A) {
        var c = A.cfg;
        function bb(V, mb) {    // где герой на самом деле (маска ролика, иначе альфа картинки) — доли кадра
          var L = V.mask ? [V.mask, V.box, V.bw, V.bh, 1, 0] : (V.img ? [V.img, V.ibox, V.iw, V.ih, 4, 3] : null);
          if (!L) return mb;
          for (var y = 0; y < L[3]; y++) for (var x = 0; x < L[2]; x++) {
            if (L[0][(y * L[2] + x) * L[4] + L[5]] < 128) continue;
            var u = (st.x0 + L[1][0] + x) / st.W, v = (st.y0 + L[1][1] + y) / st.H;
            if (!mb) mb = [u, v, u, v]; else { mb[0] = Math.min(mb[0], u); mb[1] = Math.min(mb[1], v); mb[2] = Math.max(mb[2], u); mb[3] = Math.max(mb[3], v); }
          }
          return mb;
        }
        var day = c.media.day ? A.vars[c.media.day[0].name] : null, fig = A.cur ? bb(A.cur, null) : (day ? bb(day, null) : null);
        var pts = [], PV = A.cur || day;      // точки героя (сетка 6 px по маске) — доли кадра: «сколько героя в экране» (G7)
        if (PV && (PV.mask || PV.img)) {
          var L2 = PV.mask ? [PV.mask, PV.box, PV.bw, PV.bh, 1, 0] : [PV.img, PV.ibox, PV.iw, PV.ih, 4, 3];
          for (var yy = 0; yy < L2[3]; yy += 6) for (var xx = 0; xx < L2[2]; xx += 6) if (L2[0][(yy * L2[2] + xx) * L2[4] + L2[5]] >= 128) pts.push([+((st.x0 + L2[1][0] + xx) / st.W).toFixed(4), +((st.y0 + L2[1][1] + yy) / st.H).toFixed(4)]);
        }
        return { id: c.id, emotion: c.emotion, rect: c.rect, hit: c.hit || null, figure: fig, pts: pts, slot: A.slot,
          cur: A.cur ? A.cur.cfg.name : null, kind: A.cur ? (A.cur.cfg.video ? 'clip' : 'image') : (A.slot === 'night' && c.media.day && (c.media.night === undefined || c.media.night === 'drawing') ? 'drawing' : 'none'),
          w: +A.cw.toFixed(3), vT: A.cur ? A.cur.vT : null, tap: !!A.tapOn, pool: A.pool.map(function (V) { return V.cfg.name; }) };
      })
    };
  }
});

// ===== fx/show.js =====
// fx/show.js — шоу кадра «до и после» (docs/STANOK.md §4.5): ролик Veo «было → снос → стало» по маске в куске слоя здания + камера
// (наезд на точку кадра) + время суток по ходу показа. Запуск — кнопкой, повторное нажатие — остановить (гаснет за stopMs).
// Ролик из самого рисунка (первый кадр = рисунок): пиксель ролика берётся только там, где он отличается от рисунка (diff), — небо куска
// не красится; keep — отличие ложится поверх здания (фаэтон C целиком); без keep ролик там, где он = подложке, стирает здание (снос B).
// Герои, чей прямоугольник под шоу, плавно гаснут (собака не «телепортируется»): шоу смешивает свой кусок поверх того, что сейчас
// показывают герои. Время показа — от часов движка; __e2.show(i, sec) в проверках ставит показ на секунду (ролик встаёт на свой кадр).
// Перенесено из e1.62 (showVideo e1.50–e1.57, камера e1.43, SHOW_TOD e1.45) без изменения формул — сверка: tools/stanok_show.mjs.
E2.effect({
  name: 'show',
  low: 'on',
  init: function (cfg) { this.B = cfg; this.C = cfg.effects.show; this.run = null; this.stod = { on: false, base: 0 }; this.cam = { k: 0, C: null, fr: -1 }; this.btnOn = null; },
  upload: function (G, entry, r) {
    var sh = entry.cfg.effects.show;
    if (!sh || sh.type !== 'video' || !sh.video) return;
    var S = sh.video, W = r.w, H = r.h;
    var x0 = Math.max(0, Math.floor(S.rect[0] * W)), y0 = Math.max(0, Math.floor(S.rect[1] * H)), x1 = Math.min(W, Math.ceil(S.rect[2] * W)), y1 = Math.min(H, Math.ceil(S.rect[3] * H));
    var w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) return;
    var pm = r.bldPm, gs = r.ground4 || r.ground, gc = r.ground4 ? 4 : 3, base = new Uint8Array(w * h * 4), ref = null, gref = null;
    for (var y = 0; y < h; y++) base.set(pm.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
    if (S.diff) {      // рисунок в рамке (здание поверх земли) — с ним сравнивается кадр ролика; gref — подложка
      ref = new Uint8Array(w * h * 3);
      for (y = 0; y < h; y++) for (var x = 0; x < w; x++) { var o = (y0 + y) * W + x0 + x, q = (y * w + x) * 3, ab = pm[o * 4 + 3] / 255; for (var c = 0; c < 3; c++) ref[q + c] = pm[o * 4 + c] + gs[o * gc + c] * (1 - ab); }
      if (!S.keep) { gref = new Uint8Array(w * h * 3); for (y = 0; y < h; y++) for (x = 0; x < w; x++) { o = (y0 + y) * W + x0 + x; q = (y * w + x) * 3; for (c = 0; c < 3; c++) gref[q + c] = gs[o * gc + c]; } }
    }
    var st = { cfg: S, sh: sh, x0: x0, y0: y0, w: w, h: h, base: base, ref: ref, gref: gref, dlo: S.diff ? S.diff[0] : 0, dk: S.diff ? 1 / Math.max(1, S.diff[1] - S.diff[0]) : 0,
      out: new Uint8Array(w * h * 4), vis: 0, vT: -1, vdata: null, idx: null, al: null, dirty: false, active: false, want: -1, pending: false,
      eraseRow: S.eraseV == null ? 1e9 : Math.round(S.eraseV * H) - y0 };
    var A = (entry.cfg.effects.actors || {}).list || [];
    st.overlap = A.some(function (a) { return a.underShow !== false && a.rect[0] < S.rect[2] && a.rect[2] > S.rect[0] && a.rect[1] < S.rect[3] && a.rect[3] > S.rect[1]; });
    var mi = new Image(); mi.crossOrigin = 'anonymous';
    mi.onload = function () {
      E2.safe('show mask', function () {
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h; var cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(mi, 0, 0, w, h);
        var d = cx.getImageData(0, 0, w, h).data, n = 0, k = 0, i;
        for (i = 0; i < w * h; i++) if (d[i * 4] > 2) n++;
        var idx = new Int32Array(n), al = new Float32Array(n);
        for (i = 0; i < w * h; i++) if (d[i * 4] > 2) { idx[k] = i; al[k] = d[i * 4] / 255; k++; }
        st.idx = idx; st.al = al;
      });
    };
    mi.onerror = function () { E2.err('show', S.mask + ' не загрузилась'); st.bad = true; };
    mi.src = entry.cfg.files[S.mask];
    st.files = entry.cfg.files;
    entry.show = st;
  },
  has: function (i) { var f = this.B.frames[i]; return !!(f && f.effects.show && f.effects.show.type !== 'none'); },
  pendingNow: function () { var f = E2.Frames.get(E2.Stage.frame()); return f && f.show && f.show.pending ? 1 : 0; },
  start: function (i) {
    if (this.run || E2.Stage.fading() || !E2.Frames.get(i) || !this.has(i)) return false;
    var sh = E2.Frames.get(i).cfg.effects.show;
    this.run = { fr: i, t0: E2.Clock.now(), abort: 0, fix: null, len: sh.dur };
    return true;
  },
  stop: function () { if (this.run && !this.run.abort) { this.run.abort = E2.Clock.now(); return true; } return false; },
  freeze: function (sec) { if (this.run) this.run.fix = sec == null ? null : sec * 1000; return !!this.run; },   // секунда показа; null — снова по часам
  clock: function (now) {
    var R = this.run;
    if (!R) return null;
    return { fr: R.fr, t: ((R.fix != null ? R.fix : now - R.t0)) / 1000, len: R.len, kill: R.abort ? E2.clamp((now - R.abort) / this.C.stopMs, 0, 1) : 0, frozen: R.fix != null };
  },
  step: function (S) {
    var self = this, now = S.t, ck = this.clock(now);
    if (ck && (ck.fr !== E2.Stage.frame() || (!ck.frozen && ck.t >= ck.len) || ck.kill >= 1)) { this.run = null; ck = null; }
    E2.safe('show.tod', function () { self.stepTod(ck, S); });
    [S.fa, S.fb].forEach(function (f) { if (f && f.show) E2.safe('show.video', function () { self.video(f, ck, now); }); });
    // кнопка «Шоу» доступна только на кадре с шоу
    var on = this.has(E2.Stage.frame()) && !E2.Stage.fading();
    if (on !== this.btnOn) { this.btnOn = on; Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) { b.disabled = !on; }); }
    Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) { var a = !!self.run; if (b.classList.contains('on') !== a) b.classList.toggle('on', a); });
  },
  stepTod: function (ck, S) {   // шоу ведёт время суток (show.tod [[с, p], …]: 0 день, 1 закат, 2.1667 ночь); после показа — плавно назад
    var tod = E2.fxGet('tod'), st = this.stod;
    if (!tod) return;
    var K = ck && ck.fr === E2.Stage.frame() && !E2.Stage.fading() ? (S.fa.cfg.effects.show || {}).tod : null;
    var T = S.cfg.effects.tod, toT = function (p) { return p <= 1 ? T.daySunsetS * p : T.daySunsetS + T.sunsetNightS * (p - 1); };
    if (K && K.length) {
      if (!st.on) { st.on = true; st.base = tod.state.anim ? tod.state.anim.p1 : tod.state.p; }
      if (tod.state.anim) { st.base = tod.state.anim.p1; tod.state.anim = null; }
      var w = E2.clamp(ck.t / 1.0, 0, 1) * (1 - ck.kill);
      tod.apply(st.base + (this.keyAt(K, ck.t) - st.base) * w);
    } else if (st.on) {
      st.on = false;
      if (Math.abs(tod.state.p - st.base) > 0.002) tod.state.anim = { t0: null, T0: toT(tod.state.p), T1: toT(st.base), p1: st.base };
    }
  },
  keyAt: function (K, t) {
    if (t <= K[0][0]) return K[0][1];
    for (var i = 1; i < K.length; i++) if (t <= K[i][0]) { var a = K[i - 1], b = K[i]; return a[1] + (b[1] - a[1]) * E2.sstep(a[0], b[0], t); }
    return K[K.length - 1][1];
  },
  // камера шоу (наезд): точка кадра at приезжает в точку экрана to, крупнее в zoom раз; t — [наезд от, до, отъезд от, до] с. Только «cover».
  camera: function (S) {
    var ck = this.clock(S.t), f = S.fa, cs = ck && f && ck.fr === f.idx && !S.fb ? (f.cfg.effects.show || {}).cam : null, C = this.cam;
    if (cs) { C.C = cs; C.fr = ck.fr; C.k = this.camCurve(cs.t, ck.t) * (1 - ck.kill); }
    else if (C.k > 0) C.k = (f && C.fr === f.idx && !S.fb && C.k > 0.003) ? C.k * (1 - E2.lerpK(0.05, S.dt)) : 0;
    return C.k > 0 && C.C ? { at: C.C.at, zoom: C.C.zoom, to: C.C.to, k: C.k } : null;
  },
  camCurve: function (T, t) { var e = function (a, b) { var x = E2.clamp((t - a) / Math.max(0.01, b - a), 0, 1); return x * x * (3 - 2 * x); }; return e(T[0], T[1]) * (1 - e(T[2], T[3])); },
  videoEl: function (st) {
    if (st.vid) return st.vid;
    var vd = document.createElement('video');
    vd.muted = true; vd.defaultMuted = true; vd.loop = false; vd.playsInline = true; vd.preload = 'auto'; vd.crossOrigin = 'anonymous';
    vd.setAttribute('muted', ''); vd.setAttribute('playsinline', ''); vd.setAttribute('webkit-playsinline', '');
    vd.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    vd.addEventListener('error', function () { E2.err('show', st.cfg.video + ' не загрузился'); st.bad = true; });
    vd.addEventListener('seeked', function () { st.seekDone = true; });
    document.body.appendChild(vd);
    vd.src = vd.canPlayType('video/mp4; codecs="avc1.4d401f"') ? st.files[st.cfg.video] : st.files[st.cfg.webm];
    st.cv = document.createElement('canvas'); st.cv.width = st.w; st.cv.height = st.h; st.cx = st.cv.getContext('2d', { willReadFrequently: true });
    st.vid = vd;
    return vd;
  },
  video: function (f, ck, now) {
    var st = f.show, C = st.cfg, T = C.t, fd = C.fade, on = !!(ck && ck.fr === f.idx), tgt = 0, want = 0;
    st.pending = false;
    if (on) {
      var t1 = Math.min(T[1], ck.len), kin = E2.clamp((ck.t - T[0]) / Math.max(0.01, fd[0]), 0, 1), kout = E2.clamp((t1 - ck.t) / Math.max(0.01, fd[1]), 0, 1);
      tgt = E2.sstep(0, 1, Math.min(kin, kout)) * (1 - ck.kill); want = ck.t - T[0];
    }
    if (st.bad || E2.off('show')) tgt = 0;
    var mute = f.actors && st.overlap ? tgt : 0;     // герои под шоу плавно гаснут
    if (f.actors && f.actors.showMute !== mute) { f.actors.showMute = mute; f.actors.dirty = true; }
    if (tgt > 0.001 || (on && ck.t >= T[0] - 0.5)) {
      var vd = this.videoEl(st), dur = vd.duration || 0, tw = E2.clamp(want, 0, Math.max(0, dur - 0.05));
      if (E2.Clock.virtual || ck.frozen) {
        if (!vd.paused) { try { vd.pause(); } catch (e) {} }
        if (vd.readyState < 1 || !(dur > 0)) st.pending = true;
        else {
          tw = Math.round(tw * 30) / 30;
          if (tw !== st.want && !vd.seeking) { st.want = tw; st.seekDone = false; try { vd.currentTime = tw; } catch (e) {} }   // перемотка — когда прежняя закончилась
          if (vd.seeking || !st.seekDone || st.want !== tw || vd.readyState < 2) st.pending = true;
          else if (st.vT !== tw) this.grab(st, tw);
        }
      } else if (vd.readyState >= 1) {
        if (vd.paused && want < dur - 0.05) { var pr = vd.play(); if (pr && pr.catch) pr.catch(function () {}); }
        if (!vd.seeking && Math.abs(vd.currentTime - tw) > 0.35) vd.currentTime = tw;
        if (vd.readyState >= 2 && !vd.seeking && vd.currentTime !== st.vT && now - (st.vLast || -1e9) >= 40) { this.grab(st, vd.currentTime); st.vLast = now; }
      }
    } else if (st.vid && !st.vid.paused) { try { st.vid.pause(); } catch (e) {} }
    if (tgt <= 0.001 && !on) { st.vdata = st.vdata && st.vis > 0 ? st.vdata : null; st.vT = -1; st.want = -1; }
    var vis = st.vdata && st.idx ? Math.round(tgt * 50) / 50 : 0;
    if (vis !== st.vis) { st.vis = vis; st.dirty = true; }
    if (!st.dirty) return;
    st.dirty = false;
    this.compose(f, st);
  },
  grab: function (st, t) {
    try { st.cx.drawImage(st.vid, 0, 0, st.w, st.h); st.vdata = st.cx.getImageData(0, 0, st.w, st.h).data; st.vT = t; st.dirty = true; }
    catch (e) { E2.err('show кадр ролика', e); st.bad = true; }
  },
  compose: function (f, st) {   // формулы e1.62 (showvStep): diff — доля «ролик ≠ рисунок», gref — «ролик = подложка» стирает здание
    var o = st.out, vdd = st.vdata, idx = st.idx, al = st.al, rf = st.ref, gr = st.gref, vis = st.vis, k, n;
    o.set(st.base);
    var PS = st.overlap && f.actors;      // под шоу — то, что сейчас показывают герои (собака плавно ложится), а не голый рисунок
    if (PS && PS.out) {
      var ox0 = Math.max(st.x0, PS.x0), ox1 = Math.min(st.x0 + st.w, PS.x0 + PS.w), oy0 = Math.max(st.y0, PS.y0), oy1 = Math.min(st.y0 + st.h, PS.y0 + PS.h);
      for (var yy = oy0; yy < oy1; yy++) for (var xx = ox0; xx < ox1; xx++) {
        var so = ((yy - PS.y0) * PS.w + (xx - PS.x0)) * 4, dso = ((yy - st.y0) * st.w + (xx - st.x0)) * 4;
        o[dso] = PS.out[so]; o[dso + 1] = PS.out[so + 1]; o[dso + 2] = PS.out[so + 2]; o[dso + 3] = PS.out[so + 3];
      }
    }
    if (vis > 0) for (k = 0, n = idx.length; k < n; k++) {
      var p = idx[k], a = al[k] * vis, s4 = p * 4, q = p * 4;
      if (rf) { var p3 = p * 3, dv = Math.max(Math.abs(vdd[s4] - rf[p3]), Math.abs(vdd[s4 + 1] - rf[p3 + 1]), Math.abs(vdd[s4 + 2] - rf[p3 + 2])), kd = (dv - st.dlo) * st.dk; if (kd <= 0 && !gr) continue; a *= kd <= 0 ? 0 : (kd < 1 ? kd * kd * (3 - 2 * kd) : 1); }
      var b1 = 1 - a, ke = 1;
      if (gr && p < st.eraseRow * st.w) { var dg = Math.max(Math.abs(vdd[s4] - gr[p * 3]), Math.abs(vdd[s4 + 1] - gr[p * 3 + 1]), Math.abs(vdd[s4 + 2] - gr[p * 3 + 2])), kg = (dg - st.dlo) * st.dk; ke = kg <= 0 ? 0 : (kg >= 1 ? 1 : kg * kg * (3 - 2 * kg)); }
      if (ke < 1) {   // ролик здесь = подложка → здание стирается на полную силу маски
        var ae = Math.max(a, al[k] * vis * (1 - ke)), be = 1 - ae;
        o[q] = vdd[s4] * ae * ke + o[q] * be; o[q + 1] = vdd[s4 + 1] * ae * ke + o[q + 1] * be; o[q + 2] = vdd[s4 + 2] * ae * ke + o[q + 2] * be; o[q + 3] = 255 * ae * ke + o[q + 3] * be; continue;
      }
      o[q] = vdd[s4] * a + o[q] * b1; o[q + 1] = vdd[s4 + 1] * a + o[q + 1] * b1; o[q + 2] = vdd[s4 + 2] * a + o[q + 2] * b1; o[q + 3] = 255 * a + o[q + 3] * b1;
    }
    var gl = E2.GL.gl();
    gl.activeTexture(gl.TEXTURE0); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, f.bld);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, st.w, st.h, gl.RGBA, gl.UNSIGNED_BYTE, o);
    var was = st.active; st.active = vis > 0;
    if (was && !st.active && f.actors) f.actors.dirty = true;     // шоу кончилось: герои снова пишут свой кусок
  },
  debug: function (f) {
    var st = f && f.show, ck = this.clock(E2.Clock.now());
    return { has: !!st, run: ck, vis: st ? st.vis : 0, pending: st ? !!st.pending : false, cam: +this.cam.k.toFixed(4), vT: st ? st.vT : null };
  }
});

// ===== core/boot.js =====
// core/boot.js — старт: настройки здания (уже проверенные схемой и с подставленными умолчаниями — tools/stanok.py build) → сцена.
E2.boot = function () {
  var cfg = window.E2_BUILDING, el = document.getElementById('stage');
  if (!cfg || !el) { E2.err('boot', 'нет настроек здания или #stage'); return; }
  var on = cfg.effectsOn, fx = E2.fx.filter(function (e) { return on.indexOf(e.name) >= 0; });
  try {
    fx.forEach(function (e) { if (e.init) e.init(cfg); });
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
