/* chka.am — движок e2 e2.0.31. СОБРАННЫЙ ФАЙЛ: не править. Исходники — e2/src/, сборка — tools/build_engine.py. */
(function () {
'use strict';
var E2 = { version: 'e2.0.31', fx: [], effect: function (e) { E2.fx.push(e); return e; } };
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
// язык страницы: ?lang=hy|ru|en, иначе выбор зрителя на сайте (тот же ключ localStorage, что у e1.62), иначе язык браузера, иначе армянский
E2.lang = (function () {
  var l = null;
  var f = function () {
    if (l) return l;
    var q = E2.query('lang'), v = q;
    if (!v) { try { v = localStorage.getItem('chka-lang') || ((navigator.languages && navigator.languages[0]) || navigator.language || '').slice(0, 2).toLowerCase(); } catch (e) { v = 'hy'; } }
    l = ['hy', 'ru', 'en'].indexOf(v) >= 0 ? v : 'hy';
    return l;
  };
  f.set = function (v) {   // зритель выбрал язык в меню: запоминаем (тот же ключ, что у сайта и e1.62), все подписи читают E2.lang() заново
    if (['hy', 'ru', 'en'].indexOf(v) < 0) return l || f();
    l = v; try { localStorage.setItem('chka-lang', v); } catch (e) { /* без памяти язык живёт до закрытия страницы */ }
    return l;
  };
  return f;
})();

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
  // opts.fx — вариант с кодом шоу fx (D, E, F): у show.glsl без него null. Основная программа его не несёт — на кадрах и в минуты без шоу
  // пиксель не платит за ветки шоу (SwiftShader исполнял их и при выключенном шоу: G16 206 с против 150 с на кадр).
  function compose(effects, cfg, opts) {
    var samplers = [], fUni = [], uni = [], funcs = [], hooks = { uv: [], base: [], tod: [], lights: [], night: [], weather: [], mix: [], post: [] }, postUni = [];
    effects.forEach(function (e) {
      var g = e.glsl ? e.glsl(cfg, opts || {}) : null;
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
// e2.0.26 (отзыв Нарека 21.11 на e2.0.25: «полдень ужасный везде — размыто и ярко на всех кадрах»): fps окна считался СРЕДНИМ — разовые
// подвисания (загрузка кадров и ночных рисунков, сборка куска ночного шоу 200 мс) давали «медленное окно», два таких — ступень вниз, и НАВСЕГДА:
// на min холст в 1 точку на точку CSS (на iPhone ×3 — мыло) и без теней облаков (ярче). Теперь окно меряется МЕДИАНОЙ времени кадра
// (подвисание — выброс, его не видно; медленно — только когда медленный каждый второй кадр), «медленно» — ниже min(45, 0,8 × лучшей частоты
// этого устройства), и ступень возвращается вверх после WARM_UP быстрых окон подряд (≥ 0,85 лучшей частоты этого устройства; не чаще MAX_UP
// раз за заход — без качелей). Замер начинается, когда загружено всё (data-e2="all"), и первые GRACE окон — разгон без решений: подготовка
// шести кадров и их ночных рисунков — несколько секунд честно медленных кадров, и e2.0.25 уходил на min ещё до первого взгляда.
// ?break=perf-mean — e2.0.25. Логика — make(): одна и та же для страницы (настоящие часы) и для гейта G19 (E2.Perf.sim — синтетические
// времена кадров: живое время машины проверки гуляет 40–57 к/с и врёт в обе стороны).
E2.Perf = (function () {
  var TIERS = { full: { dpr: 2 }, lite: { dpr: 1.5 }, min: { dpr: 1 } }, ORDER = ['full', 'lite', 'min'];
  var forced = E2.query('tier'), auto = !TIERS[forced] && E2.query('perf') !== '0' && !E2.Clock.virtual;
  function make(old, tier0, onSet) {   // old — алгоритм e2.0.25; onSet(tier) — ступень сменилась
    var WARM_UP = 3, MAX_UP = 2, GRACE = 2, seen = 0, minFps = 45;
    var tier = tier0, n = 0, t0 = 0, tl = 0, low = 0, high = 0, ups = 0, best = 0, dts = [], hist = [];
    function set(t) { tier = t; low = 0; high = 0; if (onSet) onSet(tier); }
    return {
      tier: function () { return tier; },
      // раз в кадр: t — настоящее время (мс), loaded — всё загружено; окно 2,5 с; два медленных окна подряд — ступень вниз
      frame: function (t, loaded) {
        if (!old && !loaded) { t0 = 0; return; }     // ещё грузится — не мерить
        if (!t0) { t0 = t; tl = t; n = 0; dts.length = 0; return; }
        n++; dts.push(t - tl); tl = t;
        if (t - t0 < 2500) return;
        var fps;
        if (old) fps = n * 1000 / (t - t0);
        else { dts.sort(function (a, b) { return a - b; }); fps = 1000 / Math.max(1, dts[dts.length >> 1]); }
        t0 = t; n = 0; dts.length = 0;
        if (fps > best) best = fps;
        hist.push(Math.round(fps)); if (hist.length > 16) hist.shift();
        if (!old && ++seen <= GRACE) return;
        var floor = best < 35 ? 24 : (old ? minFps : Math.min(minFps, best * 0.8));   // iPhone в энергосбережении держит 30 — это норма
        if (fps < floor) { high = 0; if (++low >= 2 && tier !== 'min') set(ORDER[ORDER.indexOf(tier) + 1]); }
        else {
          low = 0;
          if (!old && tier !== 'full' && ups < MAX_UP && fps >= best * 0.85 && ++high >= WARM_UP) { ups++; set(ORDER[ORDER.indexOf(tier) - 1]); }
        }
      },
      debug: function () { return { tier: tier, best: +best.toFixed(1), ups: ups, hist: hist.slice() }; }
    };
  }
  var onChange = null, P = make(E2.brk('perf-mean'), TIERS[forced] ? forced : 'full', function (t) { if (onChange) onChange(t); });
  return {
    tier: function () { return P.tier(); },
    dpr: function () { return Math.min(window.devicePixelRatio || 1, TIERS[P.tier()].dpr); },
    onChange: function (fn) { onChange = fn; },
    frame: function () { if (auto) P.frame(E2.Clock.real(), document.documentElement.getAttribute('data-e2') === 'all'); },
    debug: function () { var d = P.debug(); d.auto = auto; return d; },
    // проверки (G19 «ступень»): прогнать ту же логику по синтетическим временам кадров. seq — [[мс на кадр, сколько кадров, загружено?], …];
    // ?break=perf-mean — алгоритм e2.0.25. Возвращает ступень в конце и её смены.
    sim: function (seq) {
      var ch = [], S = make(E2.brk('perf-mean'), 'full', function (t) { ch.push(t); }), t = 1000;
      seq.forEach(function (q) { for (var i = 0; i < q[1]; i++) { t += q[0]; S.frame(t, q[2] !== false); } });
      return { tier: S.tier(), changes: ch, debug: S.debug() };
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
  var cfg, fx, G, gl, canvas, stageEl, scene = null, sceneFx = null, post = null, quad = null, layout = null, lost = false;
  var S = { t: 0, dt: 16.667, tiltX: 0, tiltY: 0, shiftX: 0, shiftY: 0, zoom: 0, mix: 0, fa: null, fb: null, tier: 'full', still: false, cfg: null };
  var targetX = 0, targetY = 0, curX = 0, curY = 0, ret = null, pointer = false, dragId = null, dsx = 0, dsy = 0, dbx = 0, dby = 0;
  var gx = 0, gy = 0, b0 = null, g0 = null, gyroOn = false;
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
    sceneFx = null;
    post = src.post ? G.program(src.vert, src.post) : null;
    quad = G.quad();
    units(scene, src);
    if (post) { gl.useProgram(post.prg); gl.uniform1i(post.U.uScene, 0); }
  }
  function units(p, src) {
    gl.useProgram(p.prg);
    src.samplers.forEach(function (s, i) {
      var n = 'u' + s.charAt(0).toUpperCase() + s.slice(1);
      gl.uniform1i(p.U[n + 'A'], i); gl.uniform1i(p.U[n + 'B'], src.samplers.length + i);
    });
  }
  // вариант сцены с кодом шоу fx (fx/show.js): один раз, когда понадобился; текстуры — те же юниты, что у основной (у шоу fx своих нет)
  function buildFx() {
    if (sceneFx !== null) return;
    sceneFx = false;
    var src = G.compose(fx, cfg, { fx: true });
    if (src.frag === layout.frag || src.samplers.length !== layout.samplers.length) return;
    sceneFx = G.program(src.vert, src.frag);
    units(sceneFx, src);
  }
  function bindFrame(f, slot, unit0, U) {
    var u = unit0;
    fx.forEach(function (e) {
      var tex = e.textures ? e.textures(f) : (e.frameSamplers || []).map(function (s) { return f[s]; });
      tex.forEach(function (t) { gl.activeTexture(gl.TEXTURE0 + u++); gl.bindTexture(gl.TEXTURE_2D, t); });
      if (e.bind) e.bind(gl, U, f, slot);
    });
  }
  function draw() {
    var useFx = !!sceneFx && fx.some(function (e) { return e.needsFx && e.needsFx(S); }), prg = useFx ? sceneFx : scene;
    var fa = S.fa, fb = S.fb, U = prg.U, P = cfg.effects.parallax;
    var needPost = !!post && fx.some(function (e) { return e.needsPost && e.needsPost(S); });
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, needPost ? G.ensureFbo(canvas.width, canvas.height) : null);
    gl.useProgram(prg.prg);
    bindFrame(fa, 'A', 0, U);
    if (fb) bindFrame(fb, 'B', layout.samplers.length, U);
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
    if (sceneFx === null && !fade && fx.some(function (e) { return e.warmFx && e.warmFx(S); })) E2.safe('stage.fx', buildFx);
    camera();
    draw();
    fx.forEach(function (ef) { if (ef.after) E2.safe(ef.name + '.after', function () { ef.after(S, view); }); });   // интерфейс поверх сцены (точки) — после кадра и камеры
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
    // Наклон телефона (e2.0.23, отзыв Нарека 19.11: системное окно «разрешить» при первом касании пугает — люди закрывают сайт). По умолчанию
    // датчик НЕ слушается и разрешение НЕ спрашивается: параллакс — от пальца (протяжка) и мягкое «дыхание» камеры (fx/parallax.js).
    // Датчик включает только пункт меню «Наклон» (core/ui.js) — там же, по нажатию, единственный вызов запроса разрешения на iPhone.
    window.addEventListener('deviceorientation', function (e) {
      if (!gyroOn || e.beta === null || e.gamma === null || e.beta === undefined) return;
      if (b0 === null) { b0 = e.beta; g0 = e.gamma; }
      gx = E2.clamp((e.gamma - g0) / deg, -1, 1); gy = E2.clamp((e.beta - b0) / deg, -1, 1);
      if (!pointer) { targetX = gx; targetY = gy; }
    });
    window.addEventListener('resize', function () { resize(true); });
    deg = cfg.effects.parallax.maxTiltDeg;
  }
  var deg = 20;
  // датчик наклона вкл/выкл (только из пункта меню «Наклон»); выключили — сцена плавно возвращается к центру, ноль датчика берётся заново
  function gyro(on) {
    gyroOn = !!on; b0 = null; g0 = null; gx = 0; gy = 0;
    if (!gyroOn && !pointer) { targetX = 0; targetY = 0; ret = { t0: null, fx: curX, fy: curY }; }
    return gyroOn;
  }
  return {
    init: function (c, effects, el) {
      cfg = c; fx = effects; G = E2.GL; stageEl = el; S.cfg = cfg; S.still = E2.query('still') === '1';
      natW = cfg.look.frameSize[0]; natH = cfg.look.frameSize[1];
      // e2.0.26: ширина сцены — не больше кадра, вписанного по высоте экрана (page.html, --e2-ar). ?break=fit-cover — e2.0.25: на ПК «cover»
      // по ширине, кадр втрое выше экрана (красный случай G19 «экран»)
      document.documentElement.style.setProperty('--e2-ar', (natW / natH).toFixed(4));
      if (E2.brk('fit-cover')) document.body.classList.add('fit-old');
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
    go: function (i) {
      var n = E2.Frames.count(); i = ((i % n) + n) % n;
      if (fade || i === frameIndex || !E2.Frames.get(i)) return false;
      var from = frameIndex;
      fx.forEach(function (e) { if (e.leave) E2.safe(e.name + '.leave', function () { e.leave(from, i); }); });   // уходим с кадра: шоу гаснет сразу (fx/show.js)
      fade = { from: from, to: i, t0: null }; return true;
    },
    gyro: function (on) { return on === undefined ? gyroOn : gyro(on); },
    tilt: function (x, y) { ret = null; targetX = curX = x; targetY = curY = y; },   // для проверок: наклон сразу, без сглаживания
    frame: function () { return frameIndex; },
    fading: function () { return !!fade; },
    state: function () { return { frame: frameIndex, fading: !!fade, tier: S.tier, drawn: drawn, canvas: [canvas.width, canvas.height], shift: [S.shiftX, S.shiftY, S.zoom], lost: lost, stats: layout.stats }; },
    shaders: function () { return { frag: layout.frag, post: layout.post }; },
    project: function (u, v, d) { var q = project(u, v, d); return [q[0] * lastW, q[1] * lastH]; },   // точка кадра → пиксели экрана (CSS)
    view: function () { return view; },
    still: function (on) { S.still = !!on; return S.still; },   // стоп-кадр по ходу работы (проверки): без «дыхания» камеры и мерцания
    // снимок сцены для открытки (e1.62 captureView): та же сцена ещё раз крупнее (≥ PW по ширине) и сразу в 2D-холст PW×PH «cover» —
    // буфер WebGL читается только сразу после отрисовки. null — рисовать нечем (кадр ещё не готов или контекст потерян)
    snap: function (PW, PH) {
      if (!S.fa || lost) return null;
      var W0 = canvas.width, H0 = canvas.height, kq = E2.clamp(PW / W0, 1, 2.5);
      if (kq > 1) { canvas.width = Math.round(W0 * kq); canvas.height = Math.round(H0 * kq); }
      draw();
      var W = canvas.width, H = canvas.height, s = Math.max(PW / W, PH / H), sw = PW / s, sh = PH / s, out = document.createElement('canvas');
      out.width = PW; out.height = PH;
      var x = out.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(canvas, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, PW, PH);
      if (kq > 1) { canvas.width = W0; canvas.height = H0; draw(); }   // экран — снова в своём размере
      return out;
    },
    pixels: function () {   // пиксели холста сразу после кадра (для гейтов и паритета): RGBA, строки снизу вверх
      var w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w: w, h: h, data: px };
    }
  };
})();

// ===== core/ui.js =====
// core/ui.js — интерфейс страницы: нижний ряд (‹ меню ›), МЕНЮ (шторка снизу — вид и пункты e1.62), ПЛАШКА с названием и подписью кадра,
// стрелки кадров и доступ для проверок window.__e2. Точки, надписи и открытка — эффекты fx/hotspots.js, fx/inscriptions.js, fx/postcard.js.
// На экране только ‹ меню › (расположение e2.0.11); всё остальное — в меню: время суток, осадки, «до и после» (шоу), кадры, во весь экран, открытка,
// «Оставить надпись», размер текста, язык, о здании, история, на главную. Шоу — пункт меню: нажал → шторка закрывается → начинается показ.
// Меню (docs/STANOK.md §5.4): первая строка видна и нажимается ≤ 250 мс, вся анимация ≤ 450 мс, закрытие быстрее открытия; перо, лесенка пунктов,
// ожившие значки — украшения поверх, ничего не задерживают. Во время шоу бирка меню = «Стоп».
// Плашка (§5.5): при входе на кадр 3 с, гаснет за 300 мс, остаётся бирка (дата кадра); тап по бирке — снова на 3 с; место — верх или низ, где не лежит изюминка.
// Красные случаи гейтов: ?break=tod — кнопки времени суток ничего не делают; ?break=bar-cover — кнопки поверх героя; ?break=plate-cover — плашка на героя;
// ?break=panel-slow — панель открывается 1,2 с (G12).
E2.UI = {
  init: function (cfg, fx) {
    // ---------- язык подписей ----------
    var TX = {
      day: { hy: 'Ցերեկ', ru: 'День', en: 'Day' }, sunset: { hy: 'Մայրամուտ', ru: 'Закат', en: 'Sunset' }, night: { hy: 'Գիշեր', ru: 'Ночь', en: 'Night' },
      snow: { hy: 'Ձյուն', ru: 'Снег', en: 'Snow' }, rain: { hy: 'Անձրև', ru: 'Дождь', en: 'Rain' }, show: { hy: 'Կենդանացնել', ru: 'Ожить', en: 'Bring to life' },   // e2.0.20: было «До и после»; hy — e2.0.23 (Нарек 19.11)
      menu: { hy: 'Ընտրացանկ', ru: 'Меню', en: 'Menu' }, stop: { hy: 'Կանգնեցնել', ru: 'Остановить', en: 'Stop' },
      prev: { hy: 'Նախորդ կադր', ru: 'Предыдущий кадр', en: 'Previous frame' }, next: { hy: 'Հաջորդ կադր', ru: 'Следующий кадр', en: 'Next frame' },
      wMenu: { hy: 'Մենյու', ru: 'Меню', en: 'Menu' }, wStop: { hy: 'Կանգ', ru: 'Стоп', en: 'Stop' }, wClose: { hy: 'Փակել', ru: 'Закрыть', en: 'Close' },
      tod: { hy: 'Օրվա ժամը', ru: 'Время суток', en: 'Time of day' }, oneOf: { hy: 'մեկը', ru: 'одно из', en: 'pick one' },
      precip: { hy: 'Տեղումներ', ru: 'Осадки', en: 'Precipitation' }, precipNone: { hy: 'Չոր', ru: 'Сухо', en: 'Dry' },
      wxRain: { hy: 'Անձրև', ru: 'Дождь', en: 'Rain' }, wxSnow: { hy: 'Ձյուն', ru: 'Снег', en: 'Snow' },
      frames: { hy: 'Կադրեր', ru: 'Кадры', en: 'Views' }, fullscreen: { hy: 'Ամբողջ էկրան', ru: 'Во весь экран', en: 'Full screen' },
      textSize: { hy: 'Տառերի չափը', ru: 'Размер текста', en: 'Text size' }, sizeLarge: { hy: 'Մեծ', ru: 'Крупный', en: 'Large' }, sizeNormal: { hy: 'Սովորական', ru: 'Обычный', en: 'Normal' },
      language: { hy: 'Լեզու', ru: 'Язык', en: 'Language' }, about: { hy: 'Շենքի մասին', ru: 'О здании', en: 'About the building' },
      history: { hy: 'Շենքի պատմությունը ›', ru: 'История здания ›', en: 'Building history ›' }, home: { hy: 'Գլխավոր էջ', ru: 'На главную', en: 'Home' },
      exit: { hy: 'Դուրս գալ', ru: 'Выйти', en: 'Exit' },
      original: { hy: 'Բնօրինակը', ru: 'Оригинал', en: 'Original' },   // e2.0.29 (fx/original.js); hy — вычитать
      tilt: { hy: 'Թեքում', ru: 'Наклон', en: 'Tilt' }, tiltOff: { hy: 'Անջատված', ru: 'Выкл', en: 'Off' }, tiltOn: { hy: 'Միացված', ru: 'Вкл', en: 'On' }   // e2.0.23; hy — вычитать
    };
    function lg() { return E2.lang(); }
    function tx(k) { return TX[k][lg()] || TX[k].en; }
    function loc(v) { return v && typeof v === 'object' ? (v[lg()] || v.en || '') : (v || ''); }
    function $(id) { return document.getElementById(id); }
    function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* без памяти настройка живёт до закрытия страницы */ } }
    function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    var html = document.documentElement, body = document.body;
    var menu = $('menuBtn'), panel = $('panel'), scrim = $('panelScrim'), show0 = fx.filter(function (e) { return e.name === 'show'; })[0];
    each('[data-go]', function (b) { b.setAttribute('aria-label', tx(+b.getAttribute('data-go') < 0 ? 'prev' : 'next')); });
    menu.setAttribute('aria-label', tx('menu'));
    // ---------- меню: открытая карточка точки и открытка не должны оказаться под шторкой ----------
    var cardBtn = $('cardBtn');
    if (cardBtn) {      // кнопка открытки создана эффектом postcard — переезжает в меню, рядом с «Во весь экран», и получает значок e1.62
      var lbl = cardBtn.textContent;
      cardBtn.className = 'chip chip-act act-pair'; cardBtn.setAttribute('aria-haspopup', 'dialog');
      cardBtn.innerHTML = $('tplCardIc').innerHTML + '<span></span>'; cardBtn.querySelector('span').textContent = lbl;
      $('pnCard').appendChild(cardBtn);
    }
    if (E2.brk('panel-slow')) panel.style.transition = 'opacity 1200ms linear, transform 1200ms linear';   // с e2.0.17 непрозрачность без перехода — поломка тянет и её
    function panelOn() { return body.classList.contains('panel-open'); }
    // перо: контур рамки шторки по её размеру (как у e1.62: два штриха, внутренний — тонкий карандаш)
    function penPath(w, h, i) {
      var H = [22, 22, 12, 12], V = [18, 18, 12, 12];
      var r = H.map(function (x, k) { return [Math.max(0.5, x - i), Math.max(0.5, V[k] - i)]; }), x0 = i, y0 = i, x1 = w - i, y1 = h - i;
      return ['M', x0 + r[0][0], y0, 'L', x1 - r[1][0], y0, 'A', r[1][0], r[1][1], 0, 0, 1, x1, y0 + r[1][1], 'L', x1, y1 - r[2][1],
        'A', r[2][0], r[2][1], 0, 0, 1, x1 - r[2][0], y1, 'L', x0 + r[3][0], y1, 'A', r[3][0], r[3][1], 0, 0, 1, x0, y1 - r[3][1],
        'L', x0, y0 + r[0][1], 'A', r[0][0], r[0][1], 0, 0, 1, x0 + r[0][0], y0].join(' ');
    }
    function penFit() {
      var pen = $('penM'), w = panel.offsetWidth, h = panel.offsetHeight;
      if (!pen || !w || !h) return;
      pen.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      pen.querySelector('.pm1').setAttribute('d', penPath(w, h, 1)); pen.querySelector('.pm2').setAttribute('d', penPath(w, h, 6.5));
    }
    each('.panel-scroll > *', function (el, i) { el.style.setProperty('--n', Math.min(i, 10)); });          // лесенка пунктов: шаг 12 мс, всего ≤ 120 мс
    each('.chips', function (g) { Array.prototype.forEach.call(g.querySelectorAll('.chip'), function (c, j) { c.style.setProperty('--c', j); }); });
    // миниатюры кадров: картинки подставляются, когда кадры загружены (или при первом открытии меню) — не во время первого кадра
    var thumbsEl = $('thumbs'), thumbsSet = false;
    cfg.frames.forEach(function (f, i) {
      var b = document.createElement('button'), cv = document.createElement('canvas'), nm = document.createElement('span');
      b.type = 'button'; b.setAttribute('aria-label', (i + 1) + ' / ' + cfg.frames.length); b.style.setProperty('--c', i);
      cv.width = 4; cv.height = 5; b.appendChild(cv);
      nm.className = 'th-num'; nm.textContent = String(i + 1); b.appendChild(nm);
      b.addEventListener('click', function () { E2.Stage.go(i); });
      thumbsEl.appendChild(b);
    });
    // Миниатюра — маленькая копия кадра (180 px): картинка в полный размер в меню разбирала бы кадры в главном потоке и тормозила шторку. Берётся тот же файл (он уже в кэше
    // браузера), уменьшается на разборе (createImageBitmap) и рисуется на крошечный холст; нет createImageBitmap — обычная картинка.
    function thumbOne(i, u) {
      var cv = thumbsEl.children[i].firstChild;
      var fallback = function () { var im = new Image(); im.alt = ''; im.decoding = 'async'; im.onload = function () { cv.width = 180; cv.height = 225; cv.getContext('2d').drawImage(im, 0, 0, 180, 225); }; im.src = u; };
      if (!window.createImageBitmap || !window.fetch) return fallback();
      fetch(u).then(function (r) { return r.blob(); }).then(function (bl) { return createImageBitmap(bl, { resizeWidth: 180, resizeQuality: 'medium' }); })
        .then(function (bm) { cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0); if (bm.close) bm.close(); }).catch(fallback);
    }
    function fillThumbs() {
      if (thumbsSet) return; thumbsSet = true;
      cfg.frames.forEach(function (f, i) { var u = f.files && f.files.color; if (u) E2.Clock.after(80 * i, function () { thumbOne(i, new URL(u, location.href).href); }); });
    }
    var settleT = 0;
    function setPanel(on, instant) {
      if (instant) html.classList.add('no-anim');   // только проверки (__e2.panel(on, true)): без CSS-переходов
      on = !!on; if (on === panelOn()) return on;
      if (on) penFit();
      var k = ++settleT;
      body.classList.toggle('panel-open', on);
      if (!on) body.classList.remove('panel-settled');
      menu.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) {   // «живые» значки (бесконечные) включаются, когда шторка встала: на первом открытии они не должны отнимать кадры у самой шторки
        if (!thumbsSet) E2.Clock.after(450, fillThumbs);
        E2.Clock.after(700, function () { if (k === settleT && panelOn()) body.classList.add('panel-settled'); });
      }
      return on;
    }
    // Закрытие — на касании (pointerdown), а не на click: click приходит только после отпускания пальца и ждёт занятый кадр (ночь, ×4 —
    // 180 мс). Шторка уходит сразу под пальцем; click этого же касания пропускается, чтобы она не открылась снова. Открытие — по click, как было.
    var closedOnDown = false;
    menu.addEventListener('pointerdown', function (e) {
      closedOnDown = false;
      if (e.button > 0 || !panelOn() || (show0 && show0.run)) return;
      setPanel(false); closedOnDown = true;
    });
    menu.addEventListener('click', function () {
      if (closedOnDown) { closedOnDown = false; return; }
      if (E2.Orig && E2.Orig.on()) { E2.Orig.close(); return; }   // открыт «Оригинал»: бирка = «Закрыть»
      if (show0 && show0.run) { show0.stop(); return; } setPanel(!panelOn());
    });
    scrim.addEventListener('click', function () { setPanel(false); });
    $('sheetClose').addEventListener('click', function () { setPanel(false); });
    if (cardBtn) cardBtn.addEventListener('click', function () { setPanel(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setPanel(false); });
    // ---------- «Во весь экран»: iPhone — «только картинка» (Safari не даёт полный экран страницам), остальные — настоящий полный экран ----------
    var fsBtn = $('fsBtn'), immT = 0, isIPhone = /iPhone|iPod/.test(navigator.userAgent);
    var fsApi = !!(html.requestFullscreen || html.webkitRequestFullscreen) && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    function immersive(on) {
      body.classList.toggle('immersive', on); body.classList.remove('imm-idle'); immT++;
      if (on) { var k = immT; E2.Clock.after(2500, function () { if (k === immT) body.classList.add('imm-idle'); }); }
    }
    $('immExit').addEventListener('click', function () { immersive(false); });
    $('stage').addEventListener('pointerdown', function () { if (body.classList.contains('immersive')) immersive(true); });
    var fsHidden = !isIPhone && !fsApi;
    fsBtn.addEventListener('click', function () {
      if (isIPhone) { setPanel(false); E2.Clock.after(400, function () { immersive(true); }); return; }
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (html.requestFullscreen || html.webkitRequestFullscreen).call(html);
    });
    // ---------- размер текста и язык: текст гаснет 120 мс → меняется → проявляется снизу (textSwap); язык — «табло» (буквы перебираются и встают волной) ----------
    var txT = 0, txApply = null;
    function textSwap(kind, apply) {
      var k = ++txT;
      if (txApply) { var f0 = txApply; txApply = null; f0(); }
      html.classList.remove('tx-pre', 'tx-lang', 'tx-size'); html.classList.add('tx-run', 'tx-' + kind, 'tx-out');
      txApply = apply;
      E2.Clock.after(130, function () {
        if (k !== txT) return;
        var f = txApply; txApply = null; if (f) f();
        html.classList.add('tx-pre'); html.classList.remove('tx-out'); void html.offsetWidth; html.classList.remove('tx-pre');
        E2.Clock.after(700, function () { if (k === txT) html.classList.remove('tx-run', 'tx-lang', 'tx-size'); });
      });
    }
    var TB_UP = 'ԱԲԳԴԵԶԷԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՓՔՕՖАБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯABCDEFGHJKLMNPRSTUVWXYZ';
    var TB_LO = 'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆабвгдежзиклмнопрстуфхцчшэюяabcdefghkmnprstuvwxyz';
    var tablo = { items: [], t0: 0, on: false };
    function tbTargets() {
      var vw = window.innerWidth || 1, vh = window.innerHeight, out = [], total = 0;
      each('[data-i18n], #aboutText p, .pb-txt', function (el) {
        if (el.childElementCount || total > 1600) return;
        var t = el.textContent; if (!t || !t.trim()) return;
        var r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return;
        var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) return;
        var ch = Array.from(t), n = ch.length, j = Math.floor(E2.hash(out.length, n) * 40);
        total += n;
        out.push({ el: el, ch: ch, fin: t, last: t, at: ch.map(function (c, i) { return 90 + j + 380 * E2.clamp((r.left + r.width * (i + 0.5) / n) / vw, 0, 1); }) });
      });
      return out;
    }
    function tbRender() {
      var t = E2.Clock.now() - tablo.t0, live = false, tick = Math.floor(t / 45);
      tablo.items.forEach(function (it, k) {
        var s = '';
        for (var i = 0; i < it.ch.length; i++) {
          var c = it.ch[i];
          if (t >= it.at[i] || /[\s.,:;!?()«»\-–—№\d›]/.test(c)) { s += c; continue; }
          live = true;
          var pool = c !== c.toLowerCase() ? TB_UP : TB_LO;
          s += pool[Math.floor(E2.hash(k * 977 + i, tick) * pool.length)];
        }
        if (s !== it.last) { it.el.textContent = s; it.last = s; }
      });
      return live;
    }
    function tbStop(final) {
      if (final) tablo.items.forEach(function (it) { if (it.last !== it.fin) it.el.textContent = it.fin; });
      tablo.items = []; tablo.on = false;
    }
    function tbLoop() { if (!tablo.on) return; if (tbRender()) E2.Clock.after(16, tbLoop); else tbStop(true); }
    function tabloSwap(apply) {
      if (tablo.items.length) tbStop(true);
      apply();   // новые тексты — сразу (подписи, aria, заголовок вкладки); табло только «докручивает» видимое
      if (reduced() || E2.Clock.virtual) return;
      tablo.items = tbTargets(); tablo.t0 = E2.Clock.now();
      if (!tablo.items.length) return;
      tablo.on = true; tbRender(); E2.Clock.after(16, tbLoop);
    }
    function mark(segId, attr, value) {
      Array.prototype.forEach.call($(segId).querySelectorAll('button'), function (b) { var on = b.getAttribute(attr) === value; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    }
    function setTextSize(v) {
      v = v === 'normal' ? 'normal' : 'large';
      html.setAttribute('data-textsize', v); mark('sizeSeg', 'data-size', v); lsSet('chka-textsize', v);
    }
    each('#sizeSeg button', function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-size');
        if (html.getAttribute('data-textsize') === v) return;
        mark('sizeSeg', 'data-size', v);
        textSwap('size', function () { setTextSize(v); });
      });
    });
    setTextSize(lsGet('chka-textsize'));
    // ---------- «Наклон» (e2.0.23): датчик наклона — только по желанию человека. Системное окно «разрешить» на iPhone вызывается ТОЛЬКО здесь,
    // по нажатию «Вкл» (в e1.62 оно выскакивало при первом касании страницы — люди пугались и закрывали сайт). По умолчанию — палец и «дыхание».
    // Пункт есть только там, где датчик бывает (сенсорный экран + DeviceOrientationEvent); ?tiltui=1 — показать и на ПК (проверки).
    var DOE = window.DeviceOrientationEvent, coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var tiltSec = null, tiltAsk = !!DOE && typeof DOE.requestPermission === 'function';
    if ((DOE && coarse && window.isSecureContext !== false) || E2.query('tiltui') === '1') {
      tiltSec = document.createElement('section'); tiltSec.className = 'p-sec p-grp p-size'; tiltSec.id = 'pnTilt';
      tiltSec.innerHTML = '<div class="grp-h"><h3 data-i18n="tilt"></h3><div class="chips chips-one size-mini" id="tiltSeg" role="group" style="grid-auto-columns:auto">' +
        '<button type="button" class="chip on" data-tilt="off" style="padding:0 12px"><span data-i18n="tiltOff"></span></button>' +
        '<button type="button" class="chip" data-tilt="on" style="padding:0 12px"><span data-i18n="tiltOn"></span></button></div></div>';
      var sizeSec = $('sizeSeg').closest('section'); sizeSec.parentNode.insertBefore(tiltSec, sizeSec);
      var setTilt = function (on) { E2.Stage.gyro(on); mark('tiltSeg', 'data-tilt', on ? 'on' : 'off'); lsSet('chka-tilt', on ? 'on' : 'off'); };
      each('#tiltSeg button', function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-tilt') === 'off') { setTilt(false); return; }
          if (!tiltAsk) { setTilt(true); return; }
          DOE.requestPermission().then(function (s) { setTilt(s === 'granted'); }).catch(function () { setTilt(false); });   // отказ — остаётся палец
        });
      });
      if (lsGet('chka-tilt') === 'on' && !tiltAsk) setTilt(true);   // Android: разрешения нет — выбор человека помнится; iPhone — только новым нажатием
      each('.panel-scroll > *', function (el, i) { el.style.setProperty('--n', Math.min(i, 10)); });   // лесенка — с новым пунктом
    }
    // ---------- плашка ----------
    // e2.0.25 (отзыв Нарека 20.11 «верхний текст — один раз за заход и уходит чуть раньше»): плашка сама приходит ОДИН раз за заход (первый кадр),
    // держится PLATE_MS = 2,4 с (было 3 с и на каждой смене кадра). Дальше — бирка; тап по бирке показывает плашку снова (это просьба человека).
    // ?break=plate-old — старое: на каждом кадре по 3 с (красный случай G12).
    var plateOld = E2.brk('plate-old'), PLATE_MS = plateOld ? 3000 : 2400, plateOnce = false;
    var plate = $('plate'), tag = $('plateTag'), plateFr = -1, plateUntil = 0, plateOn = false;
    function meta() { var t = cfg.meta && cfg.meta.title; var s = loc(t); return s.split('|')[0].trim(); }
    function cap(i) { var c = cfg.frames[i] && cfg.frames[i].caption; return loc(c); }
    function tagText(i) { var d = cap(i).split(' · ')[0].trim(); return d || ((i + 1) + ' / ' + cfg.frames.length); }
    function heroBoxes() {     // где на экране изюминки кадра (CSS px): по фигуре, иначе по прямоугольнику ролика
      var a = E2.fxGet('actors'), f = E2.Frames.get(E2.Stage.frame()), out = [];
      if (!a || !a.debug || !f) return out;
      var d = E2.safe('plate.heroes', function () { return a.debug(f); });
      ((d && d.actors) || []).forEach(function (A) {
        var r = A.figure || A.rect; if (!r) return;
        var p = E2.Stage.project(r[0], r[1], 0.5), q = E2.Stage.project(r[2], r[3], 0.5);
        out.push([Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]);
      });
      return out;
    }
    function overlap(r, boxes) { var s = 0; boxes.forEach(function (b) { var w = Math.min(r.right, b[2]) - Math.max(r.left, b[0]), h = Math.min(r.bottom, b[3]) - Math.max(r.top, b[1]); if (w > 0 && h > 0) s += w * h; }); return s; }
    function place(el, base) {   // верх или низ — где изюминок меньше (при равенстве — верх)
      var boxes = heroBoxes(), best = null;
      el.style.top = ''; el.style.bottom = '';
      if (E2.brk('plate-cover') && boxes.length) { el.className = base + ' pos-top'; el.style.top = Math.max(0, boxes[0][1]) + 'px'; return; }   // красный случай G7
      ['top', 'bottom'].forEach(function (pos) {
        el.className = base + ' pos-' + pos;
        var o = overlap(el.getBoundingClientRect(), boxes);
        if (!best || o < best[0]) best = [o, pos];
      });
      el.className = base + ' pos-' + best[1];
    }
    function busy() {
      var pop = $('hsPopup');
      return !!((pop && pop.classList.contains('show')) || body.classList.contains('card-open') || body.classList.contains('orig-on') || (show0 && show0.run) || panelOn());
    }
    function showPlate(fr) {
      $('plateT').textContent = meta(); $('plateC').textContent = cap(fr);
      plate.querySelector('span').style.display = cap(fr) ? '' : 'none';
      place(plate, '');
      plateOn = true; plateUntil = E2.Clock.now() + PLATE_MS;
    }
    // ---------- время суток, погода, шоу ----------
    var tod = fx.filter(function (e) { return e.name === 'tod'; })[0];
    function markTod(name) { each('[data-tod]', function (b) { var on = b.getAttribute('data-tod') === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    function setTod(name) {
      if (!tod || E2.brk('tod') || !tod.set(name, { cfg: cfg })) return false;
      markTod(name);
      return true;
    }
    each('[data-tod]', function (b) { b.addEventListener('click', function () { setTod(b.getAttribute('data-tod')); }); });
    var wx = fx.filter(function (e) { return e.name === 'weather'; })[0];
    function markWx(name) {
      each('[data-wx]', function (b) { var on = b.getAttribute('data-wx') === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      each('[data-wxoff]', function (b) { var on = name === 'none' || !name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    }
    function setWx(name) {      // 'snow' | 'rain' | 'none'; повторное нажатие той же кнопки — выключить
      if (!wx || !wx.set(name)) return false;
      markWx(name);
      return true;
    }
    each('[data-wx]', function (b) {
      if (!wx) { b.style.display = 'none'; return; }
      b.addEventListener('click', function () { var n = b.getAttribute('data-wx'); setWx(wx.state.kind === n ? 'none' : n); });
    });
    each('[data-wxoff]', function (b) { if (!wx) { b.style.display = 'none'; return; } b.addEventListener('click', function () { setWx('none'); }); });
    if (E2.brk('bar-cover')) { var bar = $('bar'); if (bar) bar.style.bottom = '17%'; }   // красный случай G7: кнопки поверх героя (как плашка поверх старика 09.11)
    var show = fx.filter(function (e) { return e.name === 'show'; })[0], showWait = false;
    if (!show) $('pnShow').hidden = true;
    each('[data-show]', function (b) {     // «Шоу» — пункт меню: нажал → шторка закрывается → начинается показ; повторное нажатие (или «Стоп» на бирке) — остановить
      if (!show) { b.style.display = 'none'; return; }
      b.addEventListener('click', function () {
        if (show.run) { show.stop(); return; }
        if (showWait) return;
        showWait = true; setPanel(false);
        E2.Clock.after(260, function () { showWait = false; show.start(E2.Stage.frame()); });   // дать шторке красиво уйти (закрытие 180 мс), потом — показ
      });
    });
    each('[data-go]', function (b) { b.addEventListener('click', function () { E2.Stage.go(E2.Stage.frame() + (+b.getAttribute('data-go'))); }); });
    // «Оригинал» (e2.0.29, fx/original.js): пункт меню — как «Ожить»: шторка меню уходит, потом по рисунку идёт линия и проявляется фото. Пункт есть, если хоть у одного
    // кадра есть фото; на кадре без фото — неактивен
    var orig = E2.Orig && E2.Orig.any() ? E2.Orig : null, origWait = false;
    if (orig) $('pnOrig').hidden = false;
    each('[data-orig]', function (b) {
      b.addEventListener('click', function () {
        if (!orig || origWait) return;
        origWait = true; setPanel(false);
        E2.Clock.after(260, function () { origWait = false; orig.open(); });
      });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') E2.Stage.go(E2.Stage.frame() + 1); if (e.key === 'ArrowLeft') E2.Stage.go(E2.Stage.frame() - 1); });
    // ---------- подписи на языке страницы (и при смене языка в меню) ----------
    function applyLang() {
      var l = lg(), t = cfg.text || {};
      html.lang = l;
      each('[data-i18n]', function (el) { var k = el.getAttribute('data-i18n'); if (TX[k]) el.textContent = tx(k); });
      $('pnTitle').textContent = loc(t.panelTitle) || meta();
      var about = $('aboutText'); about.innerHTML = '';
      (cfg.aboutFacts || []).forEach(function (k) { var f = loc((cfg.facts || {})[k]); if (!f) return; var p = document.createElement('p'); p.textContent = f; about.appendChild(p); });
      $('sheetClose').setAttribute('aria-label', tx('wClose'));
      $('immExit').setAttribute('aria-label', tx('exit'));
      each('[data-size]', function (b) { b.setAttribute('aria-label', tx(b.getAttribute('data-size') === 'normal' ? 'sizeNormal' : 'sizeLarge')); });
      each('[data-go]', function (b) { b.setAttribute('aria-label', tx(+b.getAttribute('data-go') < 0 ? 'prev' : 'next')); });
      each('[data-lang]', function (b) { var on = b.getAttribute('data-lang') === l; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      if (loc(t.pageTitle)) document.title = loc(t.pageTitle) + ' · e2';
      if (E2.Sale && E2.Sale.relang) E2.Sale.relang();
      if (E2.Card && E2.Card.relang) E2.Card.relang();
      if (E2.Orig && E2.Orig.relang) E2.Orig.relang();
      if (plateFr >= 0) { tag.textContent = tagText(plateFr); $('plateT').textContent = meta(); $('plateC').textContent = cap(plateFr); plate.querySelector('span').style.display = cap(plateFr) ? '' : 'none'; }
      wordNow = '';
    }
    each('[data-lang]', function (b) {
      b.addEventListener('click', function () {
        var l = b.getAttribute('data-lang');
        if (l === lg()) return;
        each('[data-lang]', function (x) { x.classList.toggle('on', x === b); });
        tabloSwap(function () { E2.lang.set(l); applyLang(); });
      });
    });
    // ---------- история и «на главную» ----------
    var histHref = (function () {     // beta/tests/<здание>-e2/ → страница истории лежит рядом в бете e1.62 (beta/tests/<здание>/); живая страница — рядом с ней самой
      var h = cfg.links && cfg.links.history; if (!h) return '';
      var m = /\/beta\/tests\/([^\/]+)-e2\/$/.exec(location.pathname);
      return m ? '../' + m[1] + '/' + h : h;
    })();
    if (histHref) { $('historyLink').href = histHref; $('pHist').hidden = false; }
    // ---------- 10 раз в секунду: плашка, бирка меню, отметки кнопок, ночь ----------
    var showCapNow = '', wordNow = '', lastNight = null, lastFr = -1, lastWx = null, lastTod = null, warm = 0, warmAt = 0;
    function tick() {
      var st = html.getAttribute('data-e2'), ready = st === 'first' || st === 'all', fr = E2.Stage.frame(), fading = E2.Stage.fading();
      var wl = window.__wl && document.querySelector('.wl');   // e2.0.30: пока виден экран загрузки — плашка кадра ждёт (её 2,4 с начинаются после него)
      if (wl && !wl.hidden && !wl.classList.contains('out')) ready = false;
      if (ready && !fading) {
        if (fr !== plateFr) {
          plateFr = fr; tag.textContent = tagText(fr);
          if (!plateOnce || plateOld) { plateOnce = true; showPlate(fr); }
          else if (plateOn) { $('plateC').textContent = cap(fr); plate.querySelector('span').style.display = cap(fr) ? '' : 'none'; }   // плашка ещё видна — подпись нового кадра
        }
        if (plateOn && E2.Clock.now() >= plateUntil) plateOn = false;
      } else if (fading) plateOn = false;
      // подпись шоу (showCaption e1.54): на пике показа плашка говорит, что происходит; до и после — ничего (плашка кадра во время шоу молчит)
      var sc = ready && !fading && show0 && show0.run && show0.caption && !body.classList.contains('card-open') ? loc(show0.caption()) : '';
      if (sc !== showCapNow) {
        showCapNow = sc;
        if (sc) { $('plateT').textContent = meta(); $('plateC').textContent = sc; plate.querySelector('span').style.display = ''; place(plate, ''); }
        else if (plateFr >= 0) { $('plateC').textContent = cap(plateFr); plate.querySelector('span').style.display = cap(plateFr) ? '' : 'none'; }
      }
      var hide = !ready || fading || busy(), pOn = (plateOn && !hide) || !!sc, tOn = ready && !plateOn && !hide && !sc;
      if (pOn !== plate.classList.contains('on')) plate.classList.toggle('on', pOn);
      if (tOn !== tag.classList.contains('on')) { if (tOn) { place(tag, ''); tag.classList.add('on'); } else tag.classList.remove('on'); }
      if (ready && warm < 9 && !E2.Clock.virtual && !E2.brk('no-warm')) {   // прогрев шторки: через 1,2 с после первого кадра на 0,8 с она «открывается» почти прозрачной (см. body.panel-warm
        if (!warmAt) warmAt = E2.Clock.now() + 1200;                          // в page.html); в проверках по виртуальным часам (?vt=1) прогрева нет — снимки не должны ловить её
        if (E2.Clock.now() >= warmAt && !panelOn()) { warm++; body.classList.toggle('panel-warm', warm < 9); }
      }
      var sh = !!(show0 && show0.run);
      if (sh !== body.classList.contains('show-on')) body.classList.toggle('show-on', sh);
      if (sh && panelOn()) setPanel(false);
      var og = !!(orig && orig.on()), w = sh ? 'wStop' : (panelOn() || og ? 'wClose' : 'wMenu');
      if (w + lg() !== wordNow) { wordNow = w + lg(); menu.querySelector('.pb-txt').textContent = tx(w); menu.setAttribute('aria-label', tx(sh ? 'stop' : (panelOn() || og ? 'wClose' : 'menu'))); }
      var nt = !!(tod && tod.state && tod.state.p > 1.4);
      if (nt !== lastNight) { lastNight = nt; html.setAttribute('data-night', nt ? '1' : '0'); }
      if (fr !== lastFr) { lastFr = fr; each('#thumbs button', function (b, i) { b.classList.toggle('on', i === fr); }); }
      if (wx && wx.state && wx.state.kind !== lastWx) { lastWx = wx.state.kind; markWx(lastWx); }
      if (tod && tod.state && tod.state.name !== lastTod) { lastTod = tod.state.name; markTod(lastTod); }
      if (show) each('[data-show]', function (b) { var d = !show.has(fr) && !show.run; if (b.disabled !== d) b.disabled = d; });
      if (orig) each('[data-orig]', function (b) { var d = !orig.has(fr) || sh; if (b.disabled !== d) b.disabled = d; });
      if (st === 'all' && !thumbsSet) fillThumbs();
      var cardHidden = !cardBtn || cardBtn.hidden, acts = $('pnActs');
      if (fsHidden !== $('pnActs').querySelector('.act-fs').hidden) $('pnActs').querySelector('.act-fs').hidden = fsHidden;
      acts.classList.toggle('solo', fsHidden || cardHidden);
      acts.hidden = fsHidden && cardHidden;
      E2.Clock.after(100, tick);
    }
    tag.addEventListener('click', function () { if (plateFr < 0) return; tag.classList.remove('on'); showPlate(E2.Stage.frame()); });
    applyLang();
    E2.Clock.after(100, tick);
    window.__e2 = {
      version: cfg.engine.version,
      advance: function (ms, step) { return E2.Clock.advance(ms, step); },   // только ?vt=1
      now: function () { return E2.Clock.now(); }, redraw: function () { return E2.Clock.redraw(); },
      setWx: setWx, setTod: setTod, panel: function (on, instant) { return setPanel(on, instant); },   // проверки: открыть/закрыть меню (instant — без CSS-переходов)
      ui: function () { var r = function (e) { var b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };   // что видно: панель, плашка, бирка (G7, G12)
        return { panel: panelOn(), plate: plate.classList.contains('on'), tag: tag.classList.contains('on'), frame: plateFr, plateRect: r(plate), tagRect: r(tag), plateText: plate.textContent,
          pos: (plate.className.match(/pos-(\w+)/) || [])[1] || null, tagPos: (tag.className.match(/pos-(\w+)/) || [])[1] || null }; },
      tod: function () { return tod ? { name: tod.state.name, p: tod.state.p, busy: tod.busy() } : null; },
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
        if (i < 0) { if (!show.halt()) show.run = null; return true; }   // e2.0.23: гасить как настоящий уход с шоу (halt), а не обрывом run — иначе закат/ночь могли остаться с «чистым» куском без героев
        if (!show.run && !show.start(i)) return false;
        return show.freeze(sec === undefined ? null : sec);
      },
      spots: function () { return E2.Spots ? E2.Spots.state() : null; },   // точки текущего кадра и открытая карточка (П5)
      insc: function () { return E2.Insc ? E2.Insc.state() : null; },       // личная ссылка ?n=: какая надпись, открыта ли
      openSpot: function (key) { return E2.Spots ? E2.Spots.open(key) : false; },
      orig: function (cmd, x) {   // проверки «Оригинала» (G20): 'open' | 'close' | 'set' (линия, 0…1) | без cmd — состояние
        if (!E2.Orig) return null;
        if (cmd === 'open') return E2.Orig.open(); if (cmd === 'close') return E2.Orig.close(); if (cmd === 'set') return E2.Orig.set(x);
        return E2.Orig.state();
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
  // тушь полудня (e2.0.25): тёмное (яркость < inkLo) ×ink, к inkHi — без изменений; trim — общий множитель (снимает noon.bright 1,04)
  NOON: { ink: 0.72, inkLo: 0.22, inkHi: 0.58, trim: 0.96 },
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
      '    c = mix(cOrig, c, DAY_MIX * uDayK);',
      N ? [
        '    float nk = noonK * (1.0 - uSunset) * uDayK;',
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
        // тушь полудня (e2.0.25, отзыв Нарека 20.11 на e2.0.23: «полдень слишком ярко и размазано, глаз режет; тон — как у других времён»):
        // закат кладёт поверх рисунка углубление тёмного (второй проход, sunsetShade.dark), ночь — свой рисунок; день оставался голой светлой
        // акварелью ×1,04 — рядом с ними бледно и «мыльно». Теперь полдень тоже углубляет штрих (тёмное ×ink, плавно по яркости) и не светлее
        // рисунка (trim снимает подъём bright). ?break=noon-old — день e2.0.23 (красный случай G18).
        E2.brk('noon-old') ? '' : [
          '      float nl3 = dot(cw, vec3(0.299, 0.587, 0.114));',
          '      cw *= mix(' + glf(this.NOON.ink) + ', 1.0, smoothstep(' + glf(this.NOON.inkLo) + ', ' + glf(this.NOON.inkHi) + ', nl3)) * ' + glf(this.NOON.trim) + ';'
        ].join('\n'),
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
      uniforms: ['uniform float uSunset; uniform float uSunMix; uniform float uNightMix; uniform vec2 uNightGS; uniform float uDayK;'],     // uDayK: 0 — ?off=daylook (проверки G18: «день» = сам рисунок)     // uNightGS: ночь земли и неба 0..1 (для погоды и теней облаков)
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
  // __e2.off('tod', true) — только проверки (G17): шейдер показывает ДНЕВНЫЕ текстуры того же мига (тот же ролик героя и шоу, тот же его кадр),
  // а состояние времени суток (слот героя, версии) не меняется — так снимок «днём» и снимок «ночью» одного мига сравнимы по непрозрачности слоя
  look: function () { var st = this.state; return E2.off('tod') ? { s: 0, sun: 0, night: 0, gnd: 0, sky: 0 } : st; },
  uniforms: function (gl, U) { var st = this.look(); gl.uniform1f(U.uSunset, st.s); gl.uniform1f(U.uSunMix, st.sun); gl.uniform1f(U.uNightMix, st.night); gl.uniform2f(U.uNightGS, st.gnd, st.sky); gl.uniform1f(U.uDayK, E2.off('daylook') ? 0 : 1); },
  // второй проход нужен только на закате у кадров без закатного рисунка
  postAmount: function (S) { return (S.fa && S.fa.sg && (!S.fb || S.fb.sg)) ? 0 : this.look().s; },
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
  // линия неба в столбце частицы — v первой поверхности сверху] — посадка на ней же → частица погасла на линии крыши (силуэта), а не на земле.
  // u, v, z — БЕЗ округления (e2.0.11): z = 0,2814 округлялось до 0,281 и попадало в соседний слой карты посадки — G7 видел «сквозь крышу», которой у частицы нет
  // (кадр b, частица 145, 16.11)
  debug: function (f) {
    var st = this.state, t = E2.Clock.now(), self = this, parts = { snow: [], rain: [] }, view = E2.Stage.view();
    if (f && this.cfg && this.atlas) ['snow', 'rain'].forEach(function (k) {
      if (!f.wxOn || !f.wxOn[k] || st.spans[k].on === null) return;
      for (var i = 0, n = self.count(k, view), p; i < n; i++) if ((p = self.part(k, i, t, f)) && (p[3] > 0 || p[6] === 2)) { var q = E2.Stage.project(p[0], p[1], p[2]); parts[k].push([i, p[0], p[1], p[2], +p[3].toFixed(3), +p[5].toFixed(4), p[6], Math.round(q[0]), Math.round(q[1]), +self.landV(f, p[0], 0).toFixed(4)]); }
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
// Где ролик заметно отличается от рисунка (герой пришёл или ушёл) — сам пиксель ролика × (версия / день): герой непрозрачен и ночью (e2.0.20, compose).
// Условие (слот): дождь или снег (если на кадре есть погода) → ночь (ночной рисунок лёг больше чем наполовину) → день; закат берёт дневные
// ролики. Ночь без своего ночного ролика (нет media.night или "drawing") — тот же дневной ролик в ночном тоне (e2.0.25: герой ночью живёт,
// непрозрачно — compose); до e2.0.25 «drawing» значил «герой = ночной рисунок, неподвижен» (?break=actors-nightdrawing).
// Несколько роликов в слоте — по концу ролика следующий (случайный по часам движка, другой); один — по кругу. Смена — мягкая (fadeS).
// Время ролика — от часов движка: в проверках (?vt=1) ролик не играет сам, а ставится на свой момент (G6, G10); __e2.fx('actors').pending
// говорит, сколько роликов ещё не встали на нужный кадр.
// ?off=actors — героев нет (рисунок как есть); ?break=actors-sunset — герои гаснут на закате (старая ошибка e1: «актёр пропал на «Закате»»,
// красный случай G10); ?break=actors-wxfreeze — в дождь и снег ролики стоят (красный случай G10 «замер»); ?break=actors-version — герой
// не пишется в закатный и ночной рисунок (баг e1.62 «пропала будка», красный случай G16); ?break=actors-nightclip — тон в версии снова
// только «отличием» (баг e2.0.19: собака ночью прозрачная, тёмный след у головы — красный случай G16).
E2.effect({
  name: 'actors',
  low: 'on',            // изюминки отключаются последними (§5.1)
  RELIGHT: [24, 64],    // отличие ролика от дневного рисунка (0..255, наибольший канал): ниже — тон «отличием» (дождь, блики), выше — пиксель ролика в тоне версии (силуэт сдвинулся; e2.0.20)
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
    var L = this.lin(day, ver, w, h, this.C.toneBlurPx, bd, bv);
    st.versions[kind] = { base: base, ch: ch, R: R, Ga: L.a, Ga2: L.a2, Gb: L.b, out: new Uint8Array(n * ch), tex: kind === 'night' ? entry.nb : entry.sb };
    st.dirty = true;
  },
  // Местная линейная связь «дневной рисунок → рисунок версии» по каждому каналу (управляемый фильтр, окно rad): версия ≈ a·день + b.
  // e2.0.26, отзыв Нарека 21.11 на e2.0.25: «ночью пара двигается, но как мёртвые — цвет кожи и одежды застыл». Было: движущийся пиксель
  // героя = ролик × (размытая версия / размытый день) — одно отношение на окно, где мостовая перевешивает лицо и куртку: кожа и коричневая
  // куртка ночью уходили в общий серо-синий. Связь a·x + b переносит в ночь каждый тон так, как его перевёл художник в ночном рисунке
  // (кожа — в ночную кожу, мостовая — в мокрую ночную мостовую), а на неподвижном месте даёт сам ночной рисунок. EPS — шум штриха (0..255²).
  // Два наклона: a — чистая связь (неподвижное: «рисунок версии + a·(ролик − день)» — дрожь штриха Veo не серит ночной рисунок героя);
  // a2 (и b под него) — стянутая к отношению версия/день: на ровном окне чистая связь вырождается в константу, и сдвинувшееся (голова поверх
  // стены) теряло бы контраст — «прозрачный» (G17). Только для героя, который ночью живёт на ДНЕВНОМ ролике (fromDay): дождь, снег, свой
  // ночной ролик — прежний тон (с чистой связью будка и зонт в дождь гасли ночью, G16).
  LIN_EPS: 100,
  lin: function (I, P, w, h, rad, mI, mP) {
    var n3 = I.length, II = new Float32Array(n3), IP = new Float32Array(n3), i;
    for (i = 0; i < n3; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * P[i]; }
    var mII = this.blur(II, w, h, rad), mIP = this.blur(IP, w, h, rad), a = new Float32Array(n3), a2 = new Float32Array(n3), b = new Float32Array(n3);
    for (i = 0; i < n3; i++) {
      var va = mII[i] - mI[i] * mI[i], cv = mIP[i] - mI[i] * mP[i], r0 = E2.clamp(mP[i] / Math.max(mI[i], 8), 0, 1.6);
      var k = E2.clamp(cv / (va + this.LIN_EPS), 0, 1.6), k2 = E2.clamp((cv + this.LIN_EPS * r0) / (va + this.LIN_EPS), 0, 1.6);
      a[i] = k; a2[i] = k2; b[i] = mP[i] - k2 * mI[i];
    }
    return { a: this.blur(a, w, h, rad), a2: this.blur(a2, w, h, rad), b: this.blur(b, w, h, rad) };
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
    // Ночь без своего ночного ролика (media.night нет или "drawing"): e2.0.25, отзыв Нарека 20.11 «ночью замирают пара, фонтан, старик — днём живые».
    // До e2.0.25 слот «drawing» отдавал героя самому ночному рисунку — неподвижным (дневной ролик «отличием» давал призраков, lessons §4).
    // С e2.0.20 ролик пишется в ночной рисунок непрозрачно (пиксель ролика в тоне версии, compose) — призрака нет, и ночью идёт ТОТ ЖЕ дневной
    // ролик в ночном тоне. ?break=actors-nightdrawing — старое (герой ночью замер; красный случай G10).
    var fromDay = slot === 'night' && (p === undefined || p === 'drawing') && !E2.brk('actors-nightdrawing');
    A.fromDay = fromDay;
    if (slot === 'night' && (p === undefined || p === 'drawing')) p = fromDay ? m.day : 'drawing';
    if ((slot === 'rain' || slot === 'snow') && p === undefined) p = m.day;     // погоды у героя нет — живёт как днём
    if (p === 'drawing' || !p) return [];
    p = p.map(function (v) { return A.vars[v.name]; }).filter(function (V) { return V && !V.bad; });
    if (slot === 'day' || slot === 'sunset' || fromDay) {                         // часы зрителя: утренний и дневной ролик (?vt=1 — 12:00)
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
      if (A.prev && A.pw > 0.002) layers.push([A.prev, A.pw, A.fromDay]);
      if (A.cur && A.cw > 0.002) layers.push([A.cur, A.cw, A.fromDay]);
    });
    var vers = [];
    if (tod) { if (st.versions.sunset && tod.state.sun * (1 - tod.state.night) > 0.002 && f.sb) vers.push(st.versions.sunset); if (st.versions.night && tod.state.night > 0.002 && f.nb) vers.push(st.versions.night); }
    if (E2.brk('actors-version')) vers = [];     // красный случай G16 (баг e1.62, будка Погоса 16.11): герой не пишется в закатный и ночной рисунок
    vers.forEach(function (Q) { Q.out.set(Q.base); });
    var D = st.dfull, relight = !E2.brk('actors-nightclip'), ratio = E2.brk('actors-ratio'), RL = this.RELIGHT, rk = 1 / (RL[1] - RL[0]);
    // Тон в закатный и ночной рисунок (e2.0.20, отзыв Нарека 19.11 «собака ночью: чёрная тень у головы, местами прозрачная»). Было только
    // «версия + (ролик − день) × (версия / день)»: оно переносит лишь ОТЛИЧИЕ, а ночной рисунок держит собаку в позе рисунка. Голова поднялась
    // над стеной → отличие «голова − стена» почти 0 → ночью голова = стена («прозрачная»); где лежала голова рисунка → «стена − собака» < 0 →
    // тёмный след («чёрная тень»). Теперь, где ролик заметно отличается от дневного рисунка (герой пришёл или ушёл), берётся сам пиксель ролика
    // в тоне версии: ролик × (версия / день, размыто) — герой непрозрачен по силуэту, а ушедший — открывает стену в ночном свете; где ролик = рисунку,
    // остаётся прежняя формула (ошибка 0 — ровно рисунок версии). Доля — плавно по отличию RELIGHT. ?break=actors-nightclip — старая формула (красный случай G16).
    function lay(src, bx, bw, alpha, k, lin) {     // lin — тон местной связью (герой ночью на дневном ролике, e2.0.26)   // один слой героя: src — RGBA своего прямоугольника, alpha(p) — непрозрачность точки 0..1
      var ya = Math.max(0, bx[1]), yb = Math.min(st.h, bx[3]), xa = Math.max(0, bx[0]), xb = Math.min(w, bx[2]), rw = xb - xa, dm = null;
      if (vers.length && relight && rw > 0 && yb > ya) {
        // отличие «ролик − дневной рисунок» — наибольшее в окрестности 3×3: версия может стоять на 1 px в стороне от дня (G9 допускает 1 px),
        // и штрих ночного рисунка рядом со штрихом дня иначе проступал бы сквозь героя
        var rh = yb - ya, d0 = new Uint8Array(rw * rh), d1 = new Uint8Array(rw * rh), yy, xx, ii;
        for (yy = 0; yy < rh; yy++) for (xx = 0; xx < rw; xx++) {
          var pp = (yy + ya - bx[1]) * bw + (xx + xa - bx[0]), ss = pp * 4, qq = ((yy + ya) * w + xx + xa) * 3;
          d0[yy * rw + xx] = Math.max(Math.abs(src[ss] - D[qq]), Math.abs(src[ss + 1] - D[qq + 1]), Math.abs(src[ss + 2] - D[qq + 2]));
        }
        for (yy = 0; yy < rh; yy++) for (xx = 0; xx < rw; xx++) { ii = yy * rw + xx; d1[ii] = Math.max(d0[ii], xx > 0 ? d0[ii - 1] : 0, xx < rw - 1 ? d0[ii + 1] : 0); }
        for (yy = 0; yy < rh; yy++) for (xx = 0; xx < rw; xx++) { ii = yy * rw + xx; d0[ii] = Math.max(d1[ii], yy > 0 ? d1[ii - rw] : 0, yy < rh - 1 ? d1[ii + rw] : 0); }
        dm = d0;
      }
      for (var y = ya; y < yb; y++) for (var x = xa; x < xb; x++) {
        var p = (y - bx[1]) * bw + (x - bx[0]), a = alpha(p) * k;
        if (a <= 0.002) continue;
        var q = y * w + x, s4 = p * 4, b1 = 1 - a;
        o[q * 4] = src[s4] * a + o[q * 4] * b1; o[q * 4 + 1] = src[s4 + 1] * a + o[q * 4 + 1] * b1; o[q * 4 + 2] = src[s4 + 2] * a + o[q * 4 + 2] * b1;
        o[q * 4 + 3] = 255 * a + o[q * 4 + 3] * b1;       // слой здания: цвет умножен на альфу, герой непрозрачен
        if (!vers.length) continue;
        var kd = 0;
        if (dm) { kd = E2.clamp((dm[(y - ya) * rw + (x - xa)] - RL[0]) * rk, 0, 1); kd = kd * kd * (3 - 2 * kd); }
        for (var vi = 0; vi < vers.length; vi++) {
          var Q = vers[vi], ch = Q.ch, R = Q.R, B = Q.base, O = Q.out;
          for (c = 0; c < 3; c++) {
            // ?break=actors-ratio — e2.0.25 (ролик × размытое отношение: «мёртвый» серый цвет героя ночью, красный случай G19 «тон»)
            // ?break=actors-ratio — везде e2.0.25 (ролик × размытое отношение: «мёртвый» серый цвет пары ночью, красный случай G19 «тон»)
            var qc = q * 3 + c, L = lin && !ratio, rq = L ? Q.Ga[qc] : R[qc], tg = B[q * ch + c] + (src[s4 + c] - D[qc]) * rq;
            if (kd > 0) tg += ((L ? src[s4 + c] * Q.Ga2[qc] + Q.Gb[qc] : src[s4 + c] * R[qc]) - tg) * kd;
            O[q * ch + c] = Math.max(0, Math.min(255, tg * a + O[q * ch + c] * b1));
          }
        }
      }
    }
    layers.forEach(function (L) {   // картинка героя (погода, поза), поверх неё — ролик по маске
      var V = L[0], k = L[1], img = V.img, vd = V.vdata, m = V.mask;
      if (img) lay(img, V.ibox, V.iw, function (p) { return img[p * 4 + 3] / 255; }, k, L[2]);
      if (V.cfg.video && vd && m) lay(vd, V.box, V.bw, function (p) { return m[p] / 255; }, k, L[2]);
    });
    var gl = E2.GL.gl();
    gl.activeTexture(gl.TEXTURE0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var byShow = !!(f.show && f.show.vis > 0 && f.show.overlap);
    if (byShow) { f.show.dirty = true; if (Object.keys(f.show.versions || {}).length) return; }     // идёт шоу поверх героев: кусок слоя (и с e2.0.20 его закат/ночь) пишет шоу
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
          cur: A.cur ? A.cur.cfg.name : null, kind: A.cur ? (A.cur.cfg.video ? 'clip' : 'image') : (A.slot === 'night' && c.media.day && (c.media.night === undefined || c.media.night === 'drawing') && E2.brk('actors-nightdrawing') ? 'drawing' : 'none'),
          w: +(A.cw || 0).toFixed(3), vT: A.cur ? A.cur.vT : null, tap: !!A.tapOn, pool: A.pool.map(function (V) { return V.cfg.name; }) };
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
//
// Тип fx — шоу из самого рисунка (fx.items e1.37–e1.53, кадры D, E, F Погоса). Кодом ничего не рисуется:
//   grade — обработка пикселей сцены в шейдере (viewer.js showGrade e1.40–e1.43: candles, doorlight, cinema) + огни рисунка pix (flame,
//           halo — pixFx e1.40–e1.43: меняются яркость и выборка пикселей Gemini в рамке огня). Формулы — без изменений. Шейдер ветвится
//           по числу кадра shw.x: не идёт шоу — ни одной лишней выборки (кода нет и у зданий без шоу fx).
//   letters — резьба надписи из атласов Gemini (details.js fxWrite e1.52 + fxBlaze e1.53: те же операции холста — маска по карте времени,
//           шум огня с постоянным зерном, ореол — уменьшенная копия); у e1.62 слои клались CSS-смешиванием поверх WebGL, здесь — тем же
//           смешиванием в той же сцене (проход over, как радуга): groove — multiply, light / огонь / ореол — screen. Холсты слоёв — вдвое мельче атласа (атлас ×3 к кадру).
//   image — картинка Gemini во весь кадр (призрак F, fxImageDraw e1.42–e1.46) проявляется поверх сцены; glow — та же картинка «экраном»; ночью — в тон ночи.
// Время огней pix — время неба (sky.state.t: у e1.62 и облака рисунка, и огни шли от одних часов pixT; паритет ставит его снаружи).
E2.effect({
  name: 'show',
  low: 'on',
  frameUniforms: [['vec4', 'shw']],     // шоу fx кадра: вид обработки (2 candles, 4 doorlight, 5 cinema), секунда окна, длина окна, проявление
  KIND: { candles: 2, doorlight: 4, cinema: 5 },
  PIXK: { flame: 5, halo: 7 },
  // закат/ночь (e2.0.23): «ролик ≠ рисунку» — по картинкам, размытым на blur px (дрожь штриха Veo не в счёт), доля «пиксель ролика» — плавно по lim
  RELIGHT_LP: { blur: 3, lim: [14, 36] },
  // ночь (e2.0.25, отзыв Нарека 20.11 на e2.0.23 «в „Ожить“ ночью всё ещё тень»): новое из ролика ночью — без дневной светотени ролика.
  // blur — крупная яркость ролика (px кадра), по ней снимается солнце; k — сила (0 — как e2.0.23, 1 — ровный свет); cap — доля тона выше медианы
  // fill, fillLim — сплошность нового: размытие доли «нового» (px кадра) и порог её
  NIGHT_FLAT: { blur: 14, k: 1.0, lim: [0.5, 2.4], cap: 1.1, fill: 7, fillLim: [0.3, 0.6] },
  ORAD: 32,     // e2.0.26: тон нового из ролика — по окружению вне старого здания, растянутый на столько точек кадра (onState, Ro)
  KEYS: { all: 0, water: 1, white: 2, warm: 3, dark: 4 },
  // e2.0.26: размытие (как actors.blur: два прохода скользящего среднего) на сетке вдвое реже — ch каналов, радиус rad в точках кадра.
  // Для крупных карт (тон, доля «нового»): вчетверо меньше точек; читается ближайшей точкой сетки (p → (y>>1, x>>1)).
  // рамка маски шоу (+ поле BBM px кадра на размытия) и номер точки сетки lp2 внутри неё для каждой точки маски: ночные карты шоу считаются
  // только в рамке (маска шоу A — колокольня — малая часть куска: размытия по всему куску делали ночь ×9 дня). Один раз на кадр.
  BBM: 32,
  ib: function (st) {
    if (st.ibb && st.ibb.length === st.idx.length) return st.ibb;
    var w = st.w, x0 = w, y0 = st.h, x1 = 0, y1 = 0, k, p, x, y;
    for (k = 0; k < st.idx.length; k++) { p = st.idx[k]; x = p % w; y = p / w | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    var M = this.BBM; st.bb = [Math.max(0, x0 - M), Math.max(0, y0 - M), Math.min(w, x1 + 1 + M), Math.min(st.h, y1 + 1 + M)];
    var w2 = (st.bb[2] - st.bb[0] + 1) >> 1, r = new Int32Array(st.idx.length);
    for (k = 0; k < r.length; k++) { p = st.idx[k]; r[k] = (((p / w | 0) - st.bb[1]) >> 1) * w2 + (((p % w) - st.bb[0]) >> 1); }
    return (st.ibb = r);
  },
  i2: function (st) {   // для каждой точки маски шоу (st.idx) — номер точки сетки lp2 (вдвое реже); считается один раз
    if (st.i2 && st.i2.length === st.idx.length) return st.i2;
    var w = st.w, w2 = (w + 1) >> 1, r = new Int32Array(st.idx.length);
    for (var k = 0; k < r.length; k++) { var p = st.idx[k]; r[k] = ((p / w | 0) >> 1) * w2 + ((p % w) >> 1); }
    return (st.i2 = r);
  },
  lp2: function (a, W, H, ch, rad, bx) {     // bx — [x0, y0, x1, y1]: только эта рамка картинки W×H (нет — вся)
    var X0 = bx ? bx[0] : 0, Y0 = bx ? bx[1] : 0, w = bx ? bx[2] - bx[0] : W, h = bx ? bx[3] - bx[1] : H;
    var w2 = (w + 1) >> 1, h2 = (h + 1) >> 1, d = new Float32Array(w2 * h2 * ch), t = new Float32Array(w2 * h2 * ch), r = Math.max(1, Math.round(rad / 2)), x, y, c, k;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) for (c = 0; c < ch; c++) d[((y >> 1) * w2 + (x >> 1)) * ch + c] += a[((Y0 + y) * W + X0 + x) * ch + c] * 0.25;
    if (w & 1) for (y = 0; y < h2; y++) for (c = 0; c < ch; c++) d[(y * w2 + w2 - 1) * ch + c] *= 2;
    if (h & 1) for (x = 0; x < w2; x++) for (c = 0; c < ch; c++) d[((h2 - 1) * w2 + x) * ch + c] *= 2;
    for (var pass = 0; pass < 2; pass++) {
      for (y = 0; y < h2; y++) for (c = 0; c < ch; c++) { var s = 0, n = 0; for (k = 0; k <= r && k < w2; k++) { s += d[(y * w2 + k) * ch + c]; n++; }
        for (x = 0; x < w2; x++) { t[(y * w2 + x) * ch + c] = s / n; var ad = x + r + 1, rm = x - r; if (ad < w2) { s += d[(y * w2 + ad) * ch + c]; n++; } if (rm >= 0) { s -= d[(y * w2 + rm) * ch + c]; n--; } } }
      for (x = 0; x < w2; x++) for (c = 0; c < ch; c++) { s = 0; n = 0; for (k = 0; k <= r && k < h2; k++) { s += t[(k * w2 + x) * ch + c]; n++; }
        for (y = 0; y < h2; y++) { d[(y * w2 + x) * ch + c] = s / n; ad = y + r + 1; rm = y - r; if (ad < h2) { s += t[(ad * w2 + x) * ch + c]; n++; } if (rm >= 0) { s -= t[(rm * w2 + x) * ch + c]; n--; } } }
    }
    return { d: d, w: w2, h: h2 };
  },
  init: function (cfg) { this.B = cfg; this.C = cfg.effects.show; this.run = null; this.stod = { on: false, base: 0 }; this.cam = { k: 0, C: null, fr: -1 }; this.btnOn = null; this.shade = null; },
  // сколько огней pix держит шейдер (наибольшее у кадров с шоу fx); нет ни одной обработки — шейдер шоу не нужен вовсе
  pn: function (cfg) {
    var n = 0, any = false;
    cfg.frames.forEach(function (f) { var s = f.effects.show; if (s && s.type === 'fx' && s.grade) { any = true; n = Math.max(n, (s.pix || []).length); } });
    return any ? n : -1;
  },
  glsl: function (cfg, opts) {
    var N = this.pn(cfg), glf = E2.glf;
    if (N < 0 || !(opts && opts.fx)) return null;     // код шоу fx — только во второй программе сцены (core/stage.js, вариант fx)
    var FW = cfg.look.frameSize[0], FH = cfg.look.frameSize[1];
    var funcs = [];
    if (N > 0) funcs.push([
      'uniform vec4 uShPix[' + (3 * N) + '];',
      'uniform vec2 uShPixNT;',     // число огней кадра шоу, время огней (с)
      'float showKey(float kk, float lo, float hi, vec3 c) {',   // маска из цвета самого рисунка (pixKey e1.40)
      '  float lum = dot(c, vec3(0.299, 0.587, 0.114));',
      '  if (kk < 0.5) return 1.0;',
      '  if (kk < 1.5) return smoothstep(lo, hi, c.b - c.r) * smoothstep(0.30, 0.45, lum);',
      '  if (kk < 2.5) return smoothstep(lo, hi, lum) * (1.0 - smoothstep(0.10, 0.24, max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b)));',
      '  if (kk < 3.5) return smoothstep(lo, hi, lum) * smoothstep(0.08, 0.18, c.r - c.b);',
      '  return 1.0 - smoothstep(lo, hi, lum);',
      '}',
      // pixFx e1.40–e1.43, виды flame и halo: сдвиг выборки (px кадра), множитель яркости, тёплый свет вокруг огней; q — точка кадра, c — цвет рисунка в ней
      'vec4 showPix(vec2 q, vec3 c, vec4 show) {',
      '  vec2 off = vec2(0.0); float gain = 1.0, warm = 0.0, t = uShPixNT.y;',
      '  vec2 W = vec2(' + glf(FW) + ', ' + glf(FH) + '), qp = q * W;',
      '  for (int i = 0; i < ' + N + '; i++) {',
      '    if (float(i) >= uShPixNT.x) break;',
      '    vec4 G = uShPix[3 * i];',
      '    vec4 K = uShPix[3 * i + 1];',
      '    vec4 P = uShPix[3 * i + 2];',
      '    vec2 bs = (G.zw - G.xy) * W, bp = (qp - G.xy * W) / bs;',
      '    float inb = step(0.0, bp.x) * step(bp.x, 1.0) * step(0.0, bp.y) * step(bp.y, 1.0) * smoothstep(0.0, 4.0, min(min(bp.x, 1.0 - bp.x) * bs.x, min(bp.y, 1.0 - bp.y) * bs.y));',
      '    if (K.x > 4.5 && K.x < 5.5) {',   // flame: мерцание огня P.x, частота P.y; P.z — радиус тёплого света (px), P.w — очередь
      '      float on = 1.0, sk = 0.0;',
      '      float grow = 1.0; vec2 ell = vec2(1.0);',
      '      if (show.x > 1.5 && show.x < 2.5) { sk = show.w; on = smoothstep(1.4 + 0.85 * P.w, 2.1 + 0.85 * P.w, show.y); }',
      '      if (show.x > 3.5 && show.x < 4.5) { sk = show.w; on = smoothstep(0.8 + 0.6 * P.w, 2.0 + 0.6 * P.w, show.y); grow = mix(0.25, 1.0, smoothstep(0.08, 0.55, show.y / max(show.z, 0.1))); ell = vec2(1.0, 0.62); }',
      '      vec2 cc = (G.xy + G.zw) * 0.5 * W; vec2 dd = (qp - cc) * ell / (P.z * grow);',
      '      warm += sk * on * exp(-dot(dd, dd) * 1.6) * 0.75;',
      '      if (inb < 0.002) continue;',
      '      float m = inb * showKey(K.y, K.z, K.w, c), fi = float(i);',
      '      float fl = sin(t * P.y * 6.3 + fi * 1.7) * 0.6 + sin(t * P.y * 10.7 + fi * 3.1) * 0.4;',
      '      off.x += m * 0.6 * sin(t * P.y * 4.1 + fi + bp.y * 3.0) * (1.0 - bp.y);',
      '      gain *= 1.0 + m * (P.x * fl + sk * (mix(-0.55, 0.9, on)));',
      '      continue;',
      '    }',
      '    if (K.x > 6.5 && K.x < 7.5) {',   // halo: фреска мягко светится в шоу candles (P.x сила, P.y радиус свечения px, P.z с — когда загорается)
      '      float on = 0.0;',
      '      if (show.x > 1.5 && show.x < 2.5) on = show.w * smoothstep(P.z, P.z + 2.2, show.y) * (1.0 - smoothstep(show.z - 3.5, show.z - 1.0, show.y));',
      '      if (on < 0.002) continue;',
      '      vec2 dq = max(max(G.xy * W - qp, qp - G.zw * W), 0.0); float hl = exp(-dot(dq, dq) / (P.y * P.y));',
      '      float pul = 1.0 + 0.06 * sin(t * 1.3 + float(i) * 2.0);',
      '      gain *= 1.0 + on * P.x * pul * (0.45 * inb + 0.3 * hl);',
      '      warm += on * P.x * hl * 0.10;',
      '      continue;',
      '    }',
      '  }',
      '  return vec4(off / W, gain, warm);',
      '}'
    ].join('\n'));
    funcs.push([   // showGrade e1.40–e1.43 (виды 2 candles, 4 doorlight, 5 cinema); wl — тёплый свет огней в точке
      'vec3 showGrade(vec3 c, vec2 q, vec4 show, float wl) {',
      '  float k = show.y / max(show.z, 0.1), e = show.w, lum = dot(c, vec3(0.299, 0.587, 0.114));',
      '  if (show.x > 3.5 && show.x < 4.5) {',   // doorlight (D): чуть темнеет к вечеру, свет свечей из двери заливает снег
      '    c *= 1.0 - 0.32 * e * smoothstep(0.03, 0.35, k) * (1.0 - smoothstep(0.85, 1.0, k));',
      '    c *= 1.0 + vec3(1.05, 0.58, 0.18) * wl * 1.9;',
      '  } else if (show.x > 4.5 && show.x < 5.5) {',   // cinema (F): кадр темнеет и выцветает (виньетка как в кино); на выходе цвет возвращается
      '    c = mix(c, vec3(lum) * vec3(0.95, 1.0, 1.07), 0.85 * e);',
      '    vec2 vq = q - 0.5;',
      '    c *= (1.0 - 0.5 * e) * (1.0 - 0.55 * e * smoothstep(0.06, 0.42, dot(vq, vq)));',
      '  } else {',   // candles (E): сумрак и серость, свечи загораются, стены теплеют, фрески наливаются цветом; длинное шоу (> 20 с) — цвет раньше
      '    float lk = show.z > 20.0 ? 1.0 : 0.0;',
      '    float col = mix(smoothstep(0.42, 0.85, k), smoothstep(0.24, 0.46, k), lk), dark = e * (1.0 - mix(smoothstep(0.50, 0.90, k), smoothstep(0.28, 0.50, k), lk));',
      '    c = mix(c, vec3(lum) * vec3(1.03, 1.0, 0.95), e * (1.0 - col));',
      '    c *= 1.0 - 0.55 * dark;',
      '    c *= 1.0 + vec3(0.95, 0.55, 0.18) * wl;',
      '  }',
      '  return c;',
      '}'
    ].join('\n'));
    var g = { funcs: funcs.join('\n'), night: '  if (shw.x > 0.5) c = showGrade(c, uv, shw, ' + (N > 0 ? 'mix(spx.w, spxb.w, b.a)' : '0.0') + ');' };   // после ночного рисунка, до погоды — как у e1.62
    if (N > 0) {
      g.uv = [   // огни: сдвиг выборки земли и слоя здания (после наклона и ветра — как у e1.62)
        '  vec4 spx = vec4(0.0, 0.0, 1.0, 0.0), spxb = vec4(0.0, 0.0, 1.0, 0.0);',
        '  if (shw.x > 0.5) {',
        '    spx = showPix(pc, bgT(bg, atl, pc).rgb, shw); pc = clamp(pc + spx.xy, 0.0, 1.0);',
        '    vec4 shb0 = texture2D(bld, pb); if (shb0.a > 0.02) { spxb = showPix(pb, shb0.rgb / shb0.a, shw); pb += spxb.xy; }',
        '  }'
      ].join('\n');
      g.base = '  if (shw.x > 0.5) { c = b.rgb * spxb.z + (c - b.rgb) * spx.z; b.rgb *= spxb.z; }';   // = земля × яркость огней земли, здание × своих (e1.62: до смешения)
      g.tod = '  if (shw.x > 0.5 && nk > 0.001) cn = texture2D(nb, pb).rgb * spxb.z * bn + texture2D(ng, pc).rgb * spx.z * (1.0 - bn);';   // ночной рисунок — с той же яркостью огней
    }
    return g;
  },
  upload: function (G, entry, r) {
    var sh = entry.cfg.effects.show;
    if (sh && sh.type === 'fx') { this.uploadFx(entry, sh); return; }
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
    var D = new Uint8Array(w * h * 3), gd = new Uint8Array(w * h * 3);     // день в рамке (здание поверх земли) и земля — для тона в закатный и ночной рисунок (e2.0.20)
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { o = (y0 + y) * W + x0 + x; q = (y * w + x) * 3; ab = pm[o * 4 + 3] / 255; for (c = 0; c < 3; c++) { gd[q + c] = gs[o * gc + c]; D[q + c] = Math.min(255, pm[o * 4 + c] + gs[o * gc + c] * (1 - ab)); } }
    var st = { cfg: S, sh: sh, x0: x0, y0: y0, w: w, h: h, W: W, base: base, ref: ref, gref: gref, D: D, gd: gd, versions: {}, dlo: S.diff ? S.diff[0] : 0, dk: S.diff ? 1 / Math.max(1, S.diff[1] - S.diff[0]) : 0,
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
  // Шоу ночью и на закате (e2.0.20, отзыв Нарека 19.11: «шоу должно идти в текущем времени суток»). Ролик шоу снят из дневного рисунка и пишется
  // в дневной слой здания — в закатный и ночной рисунок он ложится ТОНОМ, как герои (fx/actors.js): версия + (день после ролика − день) × (версия / день,
  // размыто). Снос (стирание здания) ночью виден сам: альфа слоя здания падает, шейдер берёт ночную землю.
  onState: function (G, entry, kind, r) {
    var st = entry.show, A = E2.fxGet('actors');
    if (!st || !A || (kind !== 'sunset' && kind !== 'night')) return;
    var src = kind === 'night' ? (r.full4 || r.full) : r.full, ch = (kind === 'night' && r.full4) ? 4 : 3, w = st.w, h = st.h, n = w * h, W = st.W;
    if (!src) return;
    var base = new Uint8Array(n * ch), ver = new Float32Array(n * 3), day = new Float32Array(n * 3);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var o = ((st.y0 + y) * W + st.x0 + x) * ch, q = y * w + x;
      for (var c = 0; c < ch; c++) base[q * ch + c] = src[o + c];
      for (c = 0; c < 3; c++) { ver[q * 3 + c] = src[o + c]; day[q * 3 + c] = st.D[q * 3 + c]; }
    }
    var R = new Float32Array(n * 3), bv = A.blur(ver, w, h, A.C.toneBlurPx), bd = A.blur(day, w, h, A.C.toneBlurPx);
    for (var i = 0; i < n * 3; i++) R[i] = E2.clamp(bv[i] / Math.max(bd[i], 8), 0, 1.6);
    // общий тон версии по куску (медиана по каналам) — им ночью освещается НОВОЕ из ролика (e2.0.25, см. compose: NIGHT_FLAT)
    var Rg = [0, 1, 2].map(function (c) { var a = []; for (var j = c; j < n * 3; j += 3 * 7) a.push(R[j]); a.sort(function (u, v) { return u - v; }); return a.length ? a[a.length >> 1] : 1; });
    // e2.0.26 (отзыв Нарека 21.11 на e2.0.25: «после „разрушения“ в шоу остаётся тень здания»): НОВОЕ из ролика (небо на месте снесённой
    // церкви, новое здание) тонировалось местным R — отношением «версия / день» самой церкви (ночью она светлее неба: фонарь, подсветка),
    // и на ночном небе проступал силуэт башен. Тон нового — Ro: то же отношение, но только по точкам вне старого здания (альфа слоя здания
    // днём < 0,1), растянутое внутрь силуэта нормированным размытием (ORAD px кадра); где снаружи точек нет — общий тон Rg.
    // ?break=show-ghost — e2.0.25 (красный случай G19 «тень снесённого»).
    var m = new Float32Array(n), vm = new Float32Array(n * 3), dm = new Float32Array(n * 3);
    for (i = 0; i < n; i++) { var mo = st.base[i * 4 + 3] < 26 ? 1 : 0; m[i] = mo; for (c = 0; c < 3; c++) { vm[i * 3 + c] = ver[i * 3 + c] * mo; dm[i * 3 + c] = day[i * 3 + c] * mo; } }
    var hm = this.lp2(m, w, h, 1, this.ORAD), hv = this.lp2(vm, w, h, 3, this.ORAD), hdd = this.lp2(dm, w, h, 3, this.ORAD), Ro = new Float32Array(hm.w * hm.h * 3);
    for (i = 0; i < hm.w * hm.h; i++) for (c = 0; c < 3; c++) Ro[i * 3 + c] = hm.d[i] > 0.03 && hdd.d[i * 3 + c] > 1 ? E2.clamp(hv.d[i * 3 + c] / hdd.d[i * 3 + c], 0, 1.6) : Rg[c];
    // земля версии под куском (ночью у шейдера там, где шоу стёрло здание): дневная подложка, переведённая в версию одним тоном, — ночью
    // светлее настоящего ночного неба вокруг; днём это прячет дневная обработка неба, ночью — нет: «тень снесённого». Шоу пишет её само (compose).
    var gs = kind === 'night' ? (r.ground4 || r.ground) : r.ground, gch = (kind === 'night' && r.ground4) ? 4 : 3, gbase = null;
    if (gs) { gbase = new Uint8Array(n * gch); for (y = 0; y < h; y++) for (x = 0; x < w; x++) { var go = ((st.y0 + y) * W + st.x0 + x) * gch, gq = (y * w + x) * gch; for (c = 0; c < gch; c++) gbase[gq + c] = gs[go + c]; } }
    st.versions[kind] = { base: base, ch: ch, R: R, Rg: Rg, Ro: Ro, Rw: hm.w, out: new Uint8Array(n * ch), on: false, gbase: gbase, gch: gch, gout: gbase ? new Uint8ClampedArray(n * gch) : null, gon: false };
    st.dirty = true;
  },
  // вторая программа сцены (с кодом шоу fx): нужна, пока идёт обработка шоу; компилируется заранее, когда зритель встал на кадр с шоу fx
  needsFx: function () { return !!this.shade; },
  warmFx: function (S) { var sh = S.fa && S.fa.cfg.effects.show; return !!(sh && sh.type === 'fx' && sh.grade); },
  has: function (i) { var f = this.B.frames[i]; return !!(f && f.effects.show && f.effects.show.type !== 'none'); },
  pendingNow: function () {
    var f = E2.Frames.get(E2.Stage.frame()), X = f && f.showFx;
    if (X && this.run && this.run.fr === f.idx && !X.bad && X.got < X.need) return 1;     // картинки шоу fx ещё грузятся
    return f && f.show && f.show.pending ? 1 : 0;
  },
  // ---------- тип fx: подготовка кадра ----------
  uploadFx: function (entry, sh) {
    var self = this, PN = Math.max(0, this.pn(this.B)), X = { n: 0, pix: null, need: 0, got: 0, bad: false, L: null, img: null, tex: null };
    if (PN > 0) {     // огни: на огонь 3 vec4 — рамка, вид/маска (вид, ключ, порог от, до), числа вида (как PIX_BUF e1.62)
      X.pix = new Float32Array(12 * PN);
      (sh.pix || []).slice(0, PN).forEach(function (it, j) {
        var g = it.box, pp = (it.p || []).concat([0, 0, 0, 0]).slice(0, 4);
        X.pix.set([g[0], g[1], g[2], g[3], self.PIXK[it.kind] || 0, self.KEYS[it.key || 'all'] || 0, it.lo == null ? 0 : it.lo, it.hi == null ? 1 : it.hi, pp[0], pp[1], pp[2], pp[3]], 12 * j);
      });
      X.n = Math.min((sh.pix || []).length, PN);
    }
    var load = function (name, cb) {
      X.need++;
      var im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = function () { E2.safe('show ' + name, function () { cb(im); }); X.got++; };
      im.onerror = function () { E2.err('show', name + ' не загрузилась'); X.bad = true; };
      im.src = entry.cfg.files[name];
    };
    if (sh.letters) { X.L = { im: {}, S: null }; ['groove', 'light', 'time'].forEach(function (k) { load(sh.letters[k], function (im) { X.L.im[k] = im; }); }); }
    if (sh.image) load(sh.image.src, function (im) { X.img = im; });
    entry.showFx = X;
  },
  // окно детали внутри показа (как stepFx e1.62): t [с0, с1] (нет — весь показ), fade [вход, выход]; null — детали сейчас нет
  win: function (it, ck, dur) {
    var tw = it.t || [0, dur], tt = ck.t - tw[0], len = tw[1] - tw[0], fd = it.fade || [0.6, 0.9];
    if (tt < 0 || tt > len) return null;
    var a = E2.clamp(Math.min(tt / fd[0], (len - tt) / fd[1]), 0, 1) * (1 - ck.kill);
    return a > 0 ? { tt: tt, len: len, a: a } : null;
  },
  bind: function (gl, U, f, s) {
    var u = U['uShw' + s];
    if (!u) return;
    var v = this.shade && f && this.shade.fr === f.idx ? this.shade.v : null;
    gl.uniform4f(u, v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 1, v ? v[3] : 0);
  },
  uniforms: function (gl, U, S) {
    if (!U.uShPix) return;
    var f = this.shade ? E2.Frames.get(this.shade.fr) : null, X = f && f.showFx;
    if (X && X.pix) gl.uniform4fv(U.uShPix, X.pix);
    var sky = E2.fxGet('sky');
    gl.uniform2f(U.uShPixNT, X ? X.n : 0, sky ? sky.state.t : (S.still ? 0 : S.t / 1000));
  },
  start: function (i) {
    if (this.run || E2.Stage.fading() || !E2.Frames.get(i) || !this.has(i)) return false;
    var sh = E2.Frames.get(i).cfg.effects.show;
    this.run = { fr: i, t0: E2.Clock.now(), abort: 0, fix: null, len: sh.dur };
    return true;
  },
  // Смена кадра во время шоу (e2.0.20, отзыв Нарека 19.11: «при листании шоу продолжается где-то на фоне»): раньше шоу жило до конца смены кадра,
  // ролик старого кадра не ставился на паузу, а его кусок оставался в слое здания (вернёшься — шоу «застыло»). Теперь core/stage.js на go()
  // зовёт leave(): шоу гаснет сразу и целиком — ролик на паузе, кусок слоя и закат/ночь чистые, герои снова видны, внизу снова «‹ Меню ›».
  leave: function () { if (!E2.brk('show-leave')) this.halt(); },
  halt: function () {
    var R = this.run, self = this;
    if (!R) return false;
    this.run = null; this.shade = null; this.cam.k = 0;
    var f = E2.Frames.get(R.fr), st = f && f.show;
    if (st) E2.safe('show.halt', function () {
      if (st.vid && !st.vid.paused) { try { st.vid.pause(); } catch (e) {} }
      st.vdata = null; st.vT = -1; st.want = -1; st.vis = 0; st.pending = false;
      self.compose(f, st);
    });
    if (f && f.actors && f.actors.showMute) { f.actors.showMute = 0; f.actors.dirty = true; }
    Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) { b.classList.remove('on'); });
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
    this.shade = null;     // шоу fx: обработка пикселей сцены сейчас (вид, секунда окна, длина окна, проявление) — для шейдера
    var shf = ck && !E2.off('show') ? this.B.frames[ck.fr].effects.show : null;
    if (shf && shf.type === 'fx' && shf.grade) { var w = this.win(shf.grade, ck, shf.dur); if (w) this.shade = { fr: ck.fr, v: [this.KIND[shf.grade.kind], w.tt, w.len, w.a] }; }
    [S.fa, S.fb].forEach(function (f) { if (f && f.show) E2.safe('show.video', function () { self.video(f, ck, now); }); });
    // кнопка «Ожить» (шоу) доступна только на кадре с шоу
    var on = this.has(E2.Stage.frame()) && !E2.Stage.fading();
    if (on !== this.btnOn) { this.btnOn = on; Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) { b.disabled = !on; }); }
    Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) { var a = !!self.run; if (b.classList.contains('on') !== a) b.classList.toggle('on', a); });
  },
  stepTod: function (ck, S) {   // шоу ведёт время суток (show.tod [[с, p], …]: 0 день, 1 закат, 2.1667 ночь); после показа — плавно назад
    var tod = E2.fxGet('tod'), st = this.stod;
    if (!tod) return;
    var SH = ck && ck.fr === E2.Stage.frame() && !E2.Stage.fading() ? (S.fa.cfg.effects.show || {}) : null, K = SH ? SH.tod : null;
    var T = S.cfg.effects.tod, toT = function (p) { return p <= 1 ? T.daySunsetS * p : T.daySunsetS + T.sunsetNightS * (p - 1); };
    if (K && K.length) {
      if (!st.on) { st.on = true; st.base = tod.state.anim ? tod.state.anim.p1 : tod.state.p; }
      if (tod.state.anim) { st.base = tod.state.anim.p1; tod.state.anim = null; }
      var w = E2.clamp(ck.t / 1.0, 0, 1) * (1 - ck.kill);
      // e2.0.20: шоу идёт в текущем времени суток — ключ времени не отматывает назад (ночью A–C не включают день), только продвигает вперёд
      // (D: день → вечер; ночью D остаётся ночью). Ключ «как есть» — только с причиной needDay. ?break=show-day — старое (шоу делает день).
      var key = this.keyAt(K, ck.t);
      if (!SH.needDay && !E2.brk('show-day')) key = Math.max(key, st.base);
      tod.apply(st.base + (key - st.base) * w);
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
    // Закатный и ночной рисунок (e2.0.23, отзыв Нарека 19.11 на e2.0.20: «ночью жмёшь „Ожить“ — собака снова прозрачная и с тенью, объекты
    // будто прозрачные, не адаптировано на ночь»). В e2.0.20 ролик шоу клался в версию только ОТЛИЧИЕМ: версия + (день после ролика − день) ×
    // (версия / день). Версия держит рисунок в его позе: всё, что в ролике пришло или сдвинулось (собака, фаэтон, люди, новое здание), ночью
    // = ночной фон + разность — «прозрачное»; где ушло — разность < 0 — тёмный след («тень»). Теперь — как у героев (fx/actors.js, e2.0.20):
    // где день после ролика заметно отличается от дневного рисунка, берётся сам пиксель в тоне версии: (день после ролика) × (версия / день,
    // размыто) — слой непрозрачен ночью так же, как днём; где ролик = рисунку — прежняя формула (ошибка 0 — ровно рисунок версии: ночной штрих,
    // свет фонаря, БЕЗ дневных теней — они есть и в ролике, и в дневном рисунке и в разности сокращаются). «Отличается» — по РАЗМЫТЫМ картинкам
    // (RELIGHT_LP: размытие, порог; потом наибольшее в 3×3): ролик Veo «дрожит» штрихом по всему кадру, и попиксельное отличие (как у героев)
    // переосвещало всю стену — ночью на ней проступали дневные косые солнечные тени и пропадал свет фонаря (G17, «тёмный след» 7,5 %).
    // Новое (здание, собака, фаэтон) отличается и после размытия. Когда шоу погасло — один раз чистый кусок.
    // ?break=show-nightdiff — старое «отличие» e2.0.20 (красный случай G17: прозрачно); ?break=show-relight-px — попиксельное отличие (тени).
    var tod = E2.fxGet('tod'), D = st.D, G = st.gd, AC = E2.fxGet('actors'), px1 = E2.brk('show-relight-px'), self = this;
    var RL = px1 ? (AC ? AC.RELIGHT : [24, 64]) : this.RELIGHT_LP.lim, rk = 1 / (RL[1] - RL[0]), LPR = this.RELIGHT_LP.blur;
    var relight = !E2.brk('show-nightdiff'), dn3 = null, kd3 = null, slow = E2.brk('show-slow');
    ['sunset', 'night'].forEach(function (kv) {
      var Q = st.versions[kv], tex = kv === 'night' ? f.nb : f.sb;
      if (!Q || !tex) return;
      var seen = !!tod && (kv === 'night' ? tod.state.night : tod.state.sun * (slow ? 1 : 1 - tod.state.night)) > 0.002,     // e2.0.26: закат под полной ночью не виден — не считать
          on = vis > 0 && seen && !E2.brk('show-day-only');
      if (!on && !Q.on) return;
      var O = Q.out, B = Q.base, ch = Q.ch, R = Q.R, p, p3, c;
      O.set(B);
      // e2.0.26 (отзыв Нарека 21.11 на e2.0.25: «ночью „Ожить“ — у собаки падает FPS»): карты ниже (день после ролика, «ролик ≠ рисунку»,
      // крупная яркость, сплошность нового) зависят только от кадра ролика и доли показа — считаются раз на кадр ролика (ключ mk), а не на
      // каждый вызов (герои под шоу зовут сборку ~25 раз в секунду сами). Размытия — на сетке вдвое реже (lp2) и по одному каналу, где нужен
      // один: замер e2.0.25 — 207 мс на сборку ночью против 16 мс днём. ?break=show-slow — e2.0.25 (красный случай G19 «шоу ночью»).
      var mk = st.vT + '|' + vis + '|' + (PS ? PS.showMute : 0);
      if (on && !dn3 && !slow && st.mk === mk && st.dn3) { dn3 = st.dn3; kd3 = st.kd3; }
      if (on && !dn3) {     // день после ролика по маске шоу и доля «пиксель ролика» — один раз на обе версии
        st.mk = slow ? null : mk; st.flatK = null;
        var w = st.w, hh = st.h, nn = w * hh, dd = st.dd || (st.dd = new Uint8Array(nn)), dl = st.dl || (st.dl = new Uint8Array(nn));
        dn3 = st.dn3 || (st.dn3 = new Float32Array(nn * 3)); kd3 = st.kd3 || (st.kd3 = new Float32Array(nn));
        dd.fill(0); dl.fill(0);
        var lp = !px1 && !!AC;
        var BB = self.ib(st) && st.bb, IB = st.ibb;
        if (lp) dn3.set(slow ? D : D.subarray(BB[1] * w * 3, BB[3] * w * 3), slow ? 0 : BB[1] * w * 3);      // вне маски шоу день после ролика = дневной рисунок (размытие у края маски не тянет чужое); e2.0.26 — только строки рамки
        for (k = 0, n = idx.length; k < n; k++) {
          p = idx[k]; p3 = p * 3; var p4 = p * 4, ia = 1 - o[p4 + 3] / 255, mx = 0;
          for (c = 0; c < 3; c++) { var v = o[p4 + c] + G[p3 + c] * ia; dn3[p3 + c] = v; mx = Math.max(mx, Math.abs(v - D[p3 + c])); }
          dd[p] = Math.min(255, mx);
        }
        if (lp && slow) {
          var bD = st.Dlp || (st.Dlp = AC.blur(D, w, hh, LPR)), bN = AC.blur(dn3, w, hh, LPR);
          for (k = 0; k < n; k++) { p = idx[k]; p3 = p * 3; dd[p] = Math.min(255, Math.max(Math.abs(bN[p3] - bD[p3]), Math.abs(bN[p3 + 1] - bD[p3 + 1]), Math.abs(bN[p3 + 2] - bD[p3 + 2]))); }
        } else if (lp) {
          var hD = st.Dlp2 || (st.Dlp2 = self.lp2(D, w, hh, 3, LPR, BB)), hN = self.lp2(dn3, w, hh, 3, LPR, BB);
          for (k = 0; k < n; k++) {
            p = idx[k]; var j3 = IB[k] * 3;
            dd[p] = Math.min(255, Math.max(Math.abs(hN.d[j3] - hD.d[j3]), Math.abs(hN.d[j3 + 1] - hD.d[j3 + 1]), Math.abs(hN.d[j3 + 2] - hD.d[j3 + 2])));
          }
        }
        if (relight) {
          for (k = 0; k < n; k++) { p = idx[k]; var x = p % w, m1 = dd[p]; if (x > 0 && dd[p - 1] > m1) m1 = dd[p - 1]; if (x < w - 1 && dd[p + 1] > m1) m1 = dd[p + 1]; dl[p] = m1; }
          for (k = 0; k < n; k++) {
            p = idx[k]; var m2 = dl[p];
            if (p >= w && dl[p - w] > m2) m2 = dl[p - w];
            if (p + w < nn && dl[p + w] > m2) m2 = dl[p + w];
            var q = E2.clamp((m2 - RL[0]) * rk, 0, 1); kd3[p] = q * q * (3 - 2 * q);
          }
        } else for (k = 0; k < n; k++) kd3[idx[k]] = 0;
      }
      // Ночь (e2.0.25, отзыв Нарека 20.11 на e2.0.23: «в „Ожить“ ночью всё ещё тень»). Пиксель ролика в тоне версии — dv × R — нёс в ночь
      // ДНЕВНОЙ свет ролика: тень портика и колонн, тёмную сторону у башни (солнце Veo), а местный тон R — фонарь и окна снесённой церкви
      // жёлтыми пятнами на колоннах нового здания. Теперь ночью новое = деталь ролика без его крупной светотени: dv × (средняя / крупная
      // яркость ролика)^k (NIGHT_FLAT, размытие blur px кадра) × тон версии, не выше медианы тона куска × cap. Закат — с солнцем, как было.
      // ?break=show-nightsun — e2.0.23 (красный случай G17 «дневная тень ночью»).
      var flat = null, Rg = Q.Rg, NF = self.NIGHT_FLAT;
      if (on && kv === 'night' && relight && !px1 && AC && Rg && !E2.brk('show-nightsun') && !slow && st.flatK === mk && st.flat) flat = st.flat;
      else if (on && kv === 'night' && relight && !px1 && AC && Rg && !E2.brk('show-nightsun') && !slow) {   // e2.0.26: то же на сетке вдвое реже, яркость — один канал
        var nq = st.w * st.h, lu = st.lu || (st.lu = new Float32Array(nq)), W2 = st.w;
        var BX = st.bb;
        for (k = BX[1] * W2; k < BX[3] * W2; k++) lu[k] = 0.299 * dn3[k * 3] + 0.587 * dn3[k * 3 + 1] + 0.114 * dn3[k * 3 + 2];
        var hL = self.lp2(lu, st.w, st.h, 1, NF.blur, BX), sL2 = 0, cL2 = 0;
        flat = st.flat || (st.flat = new Float32Array(nq));
        var I2 = self.ib(st);     // номер точки редкой сетки (в рамке маски) для каждой точки маски (один раз на кадр)
        for (k = 0, n = idx.length; k < n; k++) { p = idx[k]; if (kd3[p] > 0.5) { sL2 += hL.d[I2[k]]; cL2++; } }
        var Lm2 = cL2 ? sL2 / cL2 : 0;
        var fl2 = hL.d, nh2 = fl2.length;     // «ровный свет» — на той же редкой сетке (степень k — вчетверо реже), потом ближайшей точкой
        for (k = 0; k < nh2; k++) { var qv = Lm2 > 0 ? Lm2 / Math.max(fl2[k], 4) : 1; fl2[k] = E2.clamp(NF.k === 1 ? qv : Math.pow(qv, NF.k), NF.lim[0], NF.lim[1]); }
        for (k = 0, n = idx.length; k < n; k++) { p = idx[k]; flat[p] = fl2[I2[k]]; }
        var kb1 = st.kb1 || (st.kb1 = new Float32Array(nq)); kb1.fill(0, BX[1] * W2, BX[3] * W2);
        for (k = 0, n = idx.length; k < n; k++) kb1[idx[k]] = kd3[idx[k]];
        var hK = self.lp2(kb1, st.w, st.h, 1, NF.fill, BX), kn2 = st.kn || (st.kn = new Float32Array(nq));
        for (k = 0, n = idx.length; k < n; k++) { p = idx[k]; var fq2 = (hK.d[I2[k]] - NF.fillLim[0]) / (NF.fillLim[1] - NF.fillLim[0]); fq2 = fq2 < 0 ? 0 : fq2 > 1 ? 1 : fq2; kn2[p] = Math.max(kd3[p], fq2 * fq2 * (3 - 2 * fq2)); }
        st.flatK = mk;
      } else if (on && kv === 'night' && relight && !px1 && AC && Rg && !E2.brk('show-nightsun')) {
        var nn2 = st.w * st.h, bL = AC.blur(dn3, st.w, st.h, NF.blur), sL = 0, cL = 0;
        flat = st.flat || (st.flat = new Float32Array(nn2));
        for (k = 0, n = idx.length; k < n; k++) { p = idx[k]; if (kd3[p] > 0.5) { p3 = p * 3; sL += 0.299 * bL[p3] + 0.587 * bL[p3 + 1] + 0.114 * bL[p3 + 2]; cL++; } }
        var Lm = cL ? sL / cL : 0;
        for (k = 0, n = idx.length; k < n; k++) { p = idx[k]; p3 = p * 3; var lb = 0.299 * bL[p3] + 0.587 * bL[p3 + 1] + 0.114 * bL[p3 + 2]; flat[p] = Lm > 0 ? E2.clamp(Math.pow(Lm / Math.max(lb, 4), NF.k), NF.lim[0], NF.lim[1]) : 1; }
        // новое ночью — сплошным куском: где ролик случайно похож на старый рисунок (kd ≈ 0 посреди нового здания), иначе проступала ночная
        // церковь лоскутами (контур её фонаря на колонне). Доля «нового» вокруг (размыто на fill px) ≥ fillLim — точка тоже новая.
        var kb = st.kb || (st.kb = new Float32Array(nn2 * 3)); kb.fill(0);
        for (k = 0, n = idx.length; k < n; k++) kb[idx[k] * 3] = kd3[idx[k]];
        var kbb = AC.blur(kb, st.w, st.h, NF.fill), kn = st.kn || (st.kn = new Float32Array(nn2));
        for (k = 0, n = idx.length; k < n; k++) { p = idx[k]; var fq = E2.clamp((kbb[p * 3] - NF.fillLim[0]) / (NF.fillLim[1] - NF.fillLim[0]), 0, 1); kn[p] = Math.max(kd3[p], fq * fq * (3 - 2 * fq)); }
      }
      var Ro = E2.brk('show-ghost') ? null : Q.Ro, I2o = Ro ? self.i2(st) : null;
      // запись версии: Oc — та же память, что O, с обрезкой 0..255 при записи (без Math.min/max на точку; e2.0.26)
      var Oc = Q.oc || (Q.oc = new Uint8ClampedArray(O.buffer, O.byteOffset, O.length)), KN = flat ? st.kn : kd3, cap0 = Rg[0] * NF.cap, cap1 = Rg[1] * NF.cap, cap2 = Rg[2] * NF.cap;
      if (on) for (k = 0, n = idx.length; k < n; k++) {
        p = idx[k]; p3 = p * 3; var kk = KN[p], pc = p * ch, o3 = Ro ? I2o[k] * 3 : 0;
        for (c = 0; c < 3; c++) {
          var dv = dn3[p3 + c], rq = R[p3 + c], tg = B[pc + c] + (dv - D[p3 + c]) * rq;
          if (kk > 0) {
            var rn = Ro ? Ro[o3 + c] : rq;     // rn — тон нового (e2.0.26)
            if (flat) { var cp = c === 0 ? cap0 : c === 1 ? cap1 : cap2; tg += (dv * flat[p] * (rn < cp ? rn : cp) - tg) * kk; }
            else tg += (dv * rn - tg) * kk;
          }
          Oc[pc + c] = tg;
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, st.w, st.h, ch === 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, O);
      // e2.0.26: земля версии там, где шоу стёрло здание (альфа слоя ниже рисунка) — день после ролика в тоне ОКРУЖЕНИЯ (Ro), а не дневная
      // подложка одним тоном (тень снесённого на ночном небе). Шоу погасло — один раз чистая земля. ?break=show-ghost — как e2.0.25.
      var gtex = kv === 'night' ? f.ng : f.sg;
      if (Q.gbase && gtex && ((on && Ro) || Q.gon)) {
        var GO = Q.gout, gc = Q.gch;
        // e2.0.27: копия через Uint8Array-вид той же памяти. GO.set(Uint8Array) в Uint8ClampedArray — РАЗНЫЕ типы: в WebKit (Safari, iPhone)
        // это поэлементный медленный путь — 30 мс на каждую ночную сборку против 4 в Chrome (замер Playwright WebKit 24.11), «Ожить» ночью ×8 дня
        // только в Safari; один тип — копия памяти (2,7 мс). Значения те же (байт в байт). ?break=show-wkset — как e2.0.26 (для замера).
        if (E2.brk('show-wkset')) GO.set(Q.gbase); else (Q.gu8 || (Q.gu8 = new Uint8Array(GO.buffer, GO.byteOffset, GO.length))).set(Q.gbase);
        if (on && Ro) for (k = 0, n = idx.length; k < n; k++) {
          p = idx[k]; var ba = st.base[p * 4 + 3], oa = o[p * 4 + 3];
          if (ba <= oa) continue;
          var ke2 = (ba - oa) / ba, g3 = I2o[k] * 3, pg = p * gc; p3 = p * 3;
          for (c = 0; c < 3; c++) GO[pg + c] = Q.gbase[pg + c] + (dn3[p3 + c] * Ro[g3 + c] - Q.gbase[pg + c]) * ke2;
        }
        gl.bindTexture(gl.TEXTURE_2D, gtex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, st.w, st.h, gc === 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, Q.gu8 || (Q.gu8 = new Uint8Array(GO.buffer, GO.byteOffset, GO.length)));
        Q.gon = !!(on && Ro);
      }
      Q.on = on;
    });
    var was = st.active; st.active = vis > 0;
    if (was && !st.active && f.actors) f.actors.dirty = true;     // шоу кончилось: герои снова пишут свой кусок
  },
  // подпись под шоу (showCaption e1.54): на пике показа (доли 0,3…0,8) — {hy, ru, en}, иначе null. Показывает интерфейс
  caption: function () {
    var ck = this.clock(E2.Clock.now());
    if (!ck || ck.fr !== E2.Stage.frame()) return null;
    var c = this.B.frames[ck.fr].effects.show.caption, p = ck.t / Math.max(0.01, ck.len);
    return c && p >= 0.3 && p <= 0.8 ? c : null;
  },
  // ---------- тип fx: слои поверх сцены (надпись, призрак) — смешиванием в той же сцене ----------
  VS: 'attribute vec2 aPos; attribute vec2 aTex; varying vec2 vT; void main() { vT = aTex; gl_Position = vec4(aPos, 0.0, 1.0); }',
  // uMA.x: 0 — картинка поверх (цвет умножен на альфу; uTint — тон ночи), 1 — «экран», 2 — multiply (белое — без изменений); uMA.y — сила слоя
  FS: 'precision mediump float; varying vec2 vT; uniform sampler2D uTex; uniform vec4 uTint; uniform vec2 uMA; void main() { vec4 t = texture2D(uTex, vT); if (uMA.x > 1.5) { float a = t.a * uMA.y; gl_FragColor = vec4(vec3(1.0 - a) + t.rgb * a, 1.0); } else gl_FragColor = vec4(mix(t.rgb, uTint.rgb * t.a, uTint.a), t.a) * uMA.y; }',
  cvs: function (w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return { c: c, x: c.getContext('2d', { willReadFrequently: true }) }; },
  tex: function (gl, src, premul, old) {
    var t = old || E2.GL.texture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premul);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return t;
  },
  layer: function (gl, tex, a, b, mode, A, tint) {   // a, b — углы на экране (доли 0..1, y вниз)
    if (!(A > 0.002)) return;
    var P = this.ogl, x0 = a[0] * 2 - 1, x1 = b[0] * 2 - 1, y0 = 1 - a[1] * 2, y1 = 1 - b[1] * 2;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y1, 1, 1]), gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform2f(P.U.uMA, mode, E2.clamp(A, 0, 1));
    gl.uniform4f(P.U.uTint, tint ? tint[0] : 0, tint ? tint[1] : 0, tint ? tint[2] : 0, tint ? tint[3] : 0);
    if (mode === 2) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    else if (mode === 1) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  },
  over: function (gl, S, view) {
    var ck = this.clock(S.t), f = S.fa, sh = f && f.cfg.effects.show, X = f && f.showFx;
    if (!ck || !X || S.fb || ck.fr !== f.idx || X.bad || E2.off('show')) return false;
    var L = sh.letters && X.L && X.L.im.time && X.L.im.groove && X.L.im.light ? this.win(sh.letters, ck, sh.dur) : null;
    var I = sh.image && X.img ? this.win(sh.image, ck, sh.dur) : null;
    if (!L && !I) return false;
    if (!this.ogl) { this.ogl = E2.GL.program(this.VS, this.FS); this.ogl.vbo = gl.createBuffer(); this.ogl.aTex = gl.getAttribLocation(this.ogl.prg, 'aTex'); }
    var P = this.ogl, self = this, drew = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(P.prg); gl.uniform1i(P.U.uTex, 0);
    gl.enable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.vbo);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(P.aTex); gl.vertexAttribPointer(P.aTex, 2, gl.FLOAT, false, 16, 8);
    if (I) E2.safe('show.image', function () { self.image(gl, f, sh.image, X, I, view); drew = true; });
    if (L) E2.safe('show.letters', function () { drew = self.letters(gl, f, sh.letters, X.L, L, view) || drew; });
    gl.disableVertexAttribArray(P.aTex);
    return true;
  },
  // призрак (fxImageDraw e1.42–e1.46): во весь кадр на дальнем плане, rise — уходит вверх; ночью — холоднее и темнее (source-atop rgba(28,38,72, 0.62·ночь))
  image: function (gl, f, it, X, w, view) {
    if (!X.tex) X.tex = this.tex(gl, X.img, true);
    var tod = E2.fxGet('tod'), nn = tod ? tod.state.night : 0, k = w.tt / w.len, dy = -(it.rise || 0) * k;
    var a0 = view.project(0, dy, 0), a1 = view.project(1, 1 + dy, 0), ae = it.ease ? w.a * w.a * (3 - 2 * w.a) : w.a;
    var tint = nn > 0.02 ? [28 / 255, 38 / 255, 72 / 255, 0.62 * nn] : null;
    this.layer(gl, X.tex, a0, a1, 0, ae * it.alpha * (it.steady ? 1 : 0.9 + 0.1 * Math.sin(w.tt * 2.1)) * (1 - 0.25 * nn), tint);
    if (it.glow) this.layer(gl, X.tex, a0, a1, 1, ae * it.glow, tint);
  },
  // надпись-резьба (fxWrite e1.52 + fxBlaze e1.53): холсты слоёв считаются на секунду показа; слои — на рамку надписи на плане здания
  letters: function (gl, f, it, L, w, view) {
    var S = L.S || (L.S = this.lettersInit(L.im)), Wr = it.write, tt = w.tt, a = w.a;
    var dur = Wr.dur, soft = Wr.soft, p = (tt - Wr.t0) / dur, pq = Math.round(p * 600) / 600;
    if (pq !== S.p && !(S.p > 1 + soft * 6 && p > 1 + soft * 6)) {   // карта открытия меняется только пока идёт письмо
      S.p = pq; var T2 = S.T, md = S.mi.data, fd = S.fi.data, sf = 1 / soft, ff = 1 / (soft * 5);
      for (var k = 0, n = T2.length; k < n; k++) {
        var tv = T2[k], r = 0, fq = 0;
        if (tv < 255) { var e = pq - tv / 254; r = e <= 0 ? 0 : (e >= soft ? 1 : e * sf); fq = e <= 0 ? 0 : Math.max(0, 1 - e * ff) * r; }
        md[k * 4 + 3] = r * 255; fd[k * 4 + 3] = fq * 255;
      }
      S.mk.x.putImageData(S.mi, 0, 0); S.fk.x.putImageData(S.fi, 0, 0);
      [[S.o1, S.gr, S.mk], [S.o2, S.li, S.mk], [S.o3, S.li, S.fk]].forEach(function (Q) {
        var o = Q[0].x; o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, S.hw, S.hh); o.drawImage(Q[1].c, 0, 0);
        o.globalCompositeOperation = 'destination-in'; o.imageSmoothingEnabled = true; o.drawImage(Q[2].c, 0, 0, S.hw, S.hh); o.globalCompositeOperation = 'source-over';
      });
      S.texM = this.tex(gl, S.o1.c, false, S.texM);
    }
    if (p <= 0) return false;
    var key = tt + ':' + a;
    if (key !== S.key) {     // слой «экран»: светлая кромка, свежий скол, огонь букв, ореол (операция lighter — как у e1.62)
      S.key = key;
      var o = S.sc.x;
      o.save(); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1; o.clearRect(0, 0, S.sc.c.width, S.sc.c.height);
      o.globalCompositeOperation = 'lighter';
      o.globalAlpha = E2.clamp(a * it.lightK, 0, 1); o.drawImage(S.o2.c, S.px, S.py);
      o.globalAlpha = E2.clamp(a * Wr.front, 0, 1); o.drawImage(S.o3.c, S.px, S.py);
      if (it.blaze) this.blaze(it.blaze, S, tt, a, o);
      o.restore();
      S.texS = this.tex(gl, S.sc.c, true, S.texS);
    }
    var R = it.rect, dB = f.kd[1], a0 = view.project(R[0], R[1], dB), a1 = view.project(R[2], R[3], dB);
    var ex = (a1[0] - a0[0]) / S.hw * S.px, ey = (a1[1] - a0[1]) / S.hh * S.py;
    this.layer(gl, S.texS, [a0[0] - ex, a0[1] - ey], [a1[0] + ex, a1[1] + ey], 1, 1);     // у e1.62 слой screen лежал под multiply
    this.layer(gl, S.texM, a0, a1, 2, a);
    return true;
  },
  lettersInit: function (im) {
    var tm = im.time, w = tm.width, h = tm.height, hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2)), q;
    var tc = this.cvs(hw, hh); tc.x.imageSmoothingEnabled = false; tc.x.drawImage(tm, 0, 0, hw, hh);   // без сглаживания: время у края буквы не смешивается с «пусто»
    var td = tc.x.getImageData(0, 0, hw, hh).data, T = new Uint8Array(hw * hh);
    for (q = 0; q < T.length; q++) T[q] = td[q * 4];
    var S = { T: T, w: w, h: h, hw: hw, hh: hh, mk: this.cvs(hw, hh), fk: this.cvs(hw, hh), o1: this.cvs(hw, hh), o2: this.cvs(hw, hh), o3: this.cvs(hw, hh), gr: this.cvs(hw, hh), li: this.cvs(hw, hh), p: -9, key: null };
    S.gr.x.imageSmoothingEnabled = true; S.gr.x.drawImage(im.groove, 0, 0, hw, hh);
    S.li.x.imageSmoothingEnabled = true; S.li.x.drawImage(im.light, 0, 0, hw, hh);
    S.mi = S.mk.x.createImageData(hw, hh); S.fi = S.fk.x.createImageData(hw, hh);
    for (q = 0; q < T.length; q++) { S.mi.data[q * 4] = S.mi.data[q * 4 + 1] = S.mi.data[q * 4 + 2] = 255; S.fi.data[q * 4] = S.fi.data[q * 4 + 1] = S.fi.data[q * 4 + 2] = 255; }
    // ореол огня (e1.53): уменьшенная копия свечения с полем вокруг — слой «экран» шире рамки надписи на это поле
    S.hcw = Math.max(2, Math.round(w / 8)); S.hch = Math.max(2, Math.round(h / 8)); S.hp = Math.round(S.hcw * 0.12) + 2;
    S.px = Math.ceil(S.hp * hw / S.hcw); S.py = Math.ceil(S.hp * hh / S.hch);
    S.sc = this.cvs(hw + 2 * S.px, hh + 2 * S.py);
    return S;
  },
  blaze: function (Z, S, tt, a, bs) {   // fxBlaze e1.53: буквы разгораются по карте времени письма (rise с), горят (hold), гаснут (out)
    var ri = Z.rise, ho = Z.hold, ou = Z.out, e = tt - Z.t0, q;
    if (e <= 0) return;
    var bz = function (x) { x = E2.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    var lv = e > ri + ho ? 1 - bz((e - ri - ho) / ou) : 1; if (lv <= 0.002) return;
    var w = S.hw, h = S.hh;
    if (!S.bz) {
      var gc = this.cvs(w, h); gc.x.drawImage(S.gr.c, 0, 0); var gd = gc.x.getImageData(0, 0, w, h), dd = gd.data;
      for (q = 0; q < w * h; q++) {
        var Lm = (dd[q * 4] * 0.3 + dd[q * 4 + 1] * 0.59 + dd[q * 4 + 2] * 0.11) / 255, m = E2.clamp((0.94 - Lm) * 2.2, 0, 1), m2 = m * m;
        dd[q * 4] = 255 * m; dd[q * 4 + 1] = (70 + 120 * m2 * m2) * m; dd[q * 4 + 2] = (12 + 45 * m2 * m2) * m; dd[q * 4 + 3] = 255;   // глубже — желтее, края — оранжевые
      }
      gc.x.putImageData(gd, 0, 0);
      var nw = 48, nh = 36, nc = this.cvs(nw, nh), nd = nc.x.createImageData(nw, nh), sd = 1234567;   // шум с постоянным зерном (урок s27) — тот же огонь, что у e1.62
      for (q = 0; q < nw * nh; q++) { sd = (sd * 1103515245 + 12345) % 2147483648; var nv = 115 + sd / 2147483648 * 140; nd.data[q * 4] = nd.data[q * 4 + 1] = nd.data[q * 4 + 2] = nv; nd.data[q * 4 + 3] = 255; }
      nc.x.putImageData(nd, 0, 0);
      var n2 = this.cvs(nw, nh * 2); n2.x.drawImage(nc.c, 0, 0); n2.x.drawImage(nc.c, 0, nh);   // по вертикали без шва: едет вверх по кругу
      var hs = this.cvs(Math.max(2, Math.round(S.w / 48)), Math.max(2, Math.round(S.h / 48))); hs.x.imageSmoothingEnabled = true; hs.x.drawImage(gc.c, 0, 0, hs.c.width, hs.c.height);
      var hc = this.cvs(S.hcw + 2 * S.hp, S.hch + 2 * S.hp); hc.x.imageSmoothingEnabled = true; hc.x.drawImage(hs.c, S.hp, S.hp, S.hcw, S.hch);
      S.bz = { fc: gc, n2: n2, hc: hc, ig: this.cvs(w, h), o4: this.cvs(w, h), p: -9 };
      S.bz.igd = S.bz.ig.x.createImageData(w, h);
      for (q = 0; q < w * h; q++) { S.bz.igd.data[q * 4] = S.bz.igd.data[q * 4 + 1] = S.bz.igd.data[q * 4 + 2] = 255; }
    }
    var B = S.bz, fp = e / ri, fq = Math.round(fp * 240) / 240;
    if (fq !== B.p && !(B.p > 1.2 && fq > 1.2)) {   // огонь бежит по надписи в том же порядке, в каком её резали
      B.p = fq; var T = S.T, g2 = B.igd.data, wd = 0.12;
      for (var k = 0, n = T.length; k < n; k++) { var tv = T[k], rr = 0; if (tv < 255) { var ee = (fq * (1 + wd) - tv / 254) / wd; rr = ee <= 0 ? 0 : (ee >= 1 ? 1 : ee * ee * (3 - 2 * ee)); } g2[k * 4 + 3] = rr * 255; }
      B.ig.x.putImageData(B.igd, 0, 0);
    }
    var o = B.o4.x, fl = 0.84 + 0.09 * Math.sin(tt * 2.3) + 0.07 * Math.sin(tt * 3.9 + 1.3), f1 = (tt * 0.22) % 1, f2 = (tt * 0.13 + 0.5) % 1;
    o.save(); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1; o.clearRect(0, 0, w, h); o.drawImage(B.fc.c, 0, 0);
    o.imageSmoothingEnabled = true; o.globalCompositeOperation = 'multiply';
    o.globalAlpha = 0.85; o.drawImage(B.n2.c, 0, -f1 * h, w, 2 * h);
    o.globalAlpha = 0.6; o.drawImage(B.n2.c, -0.15 * w, -f2 * h * 1.3, 1.3 * w, 2.6 * h);
    o.globalCompositeOperation = 'destination-in'; o.globalAlpha = 1; o.drawImage(B.ig.c, 0, 0, w, h); o.restore();
    var sx = w / S.hcw, sy = h / S.hch, kk = a * lv * fl * Z.k, kh = a * lv * fl * Z.halo * E2.clamp(fp, 0, 1);
    for (; kk > 0.002; kk -= 1) { bs.globalAlpha = Math.min(1, kk); bs.drawImage(B.o4.c, S.px, S.py, w, h); }   // k > 1 — ярче: слой ещё раз (lighter складывает)
    for (; kh > 0.002; kh -= 1) { bs.globalAlpha = Math.min(1, kh); bs.drawImage(B.hc.c, S.px - S.hp * sx, S.py - S.hp * sy, (S.hcw + 2 * S.hp) * sx, (S.hch + 2 * S.hp) * sy); }
  },
  debug: function (f) {
    var st = f && f.show, ck = this.clock(E2.Clock.now()), X = f && f.showFx;
    return { has: !!(st || X), run: ck, vis: st ? st.vis : 0, pending: st ? !!st.pending : false, cam: +this.cam.k.toFixed(4), vT: st ? st.vT : null,
      shade: this.shade ? this.shade.v.map(function (x) { return +x.toFixed(4); }) : null, fx: X ? { loaded: X.got + '/' + X.need, bad: X.bad, pix: X.n } : null, caption: this.caption() };
  }
});

// ===== fx/hotspots.js =====
// fx/hotspots.js — точки-подсказки (перенос e1.62, viewer.js «точки-подсказки»): маленькая точка на объекте, по тапу — карточка-бумага с текстом.
// Точка едет вместе с объектом при наклоне: глубина — та же, что у шейдера (слой здания — глубина по точкам, иначе средняя глубина здания;
// земля — размытая карта глубины кадра), экранное место — обратный ход крючка uv (E2.Stage.view().project), считается ПОСЛЕ кадра (крючок after),
// поэтому точка не отстаёт от камеры шоу. Текст — facts здания на языке страницы (E2.lang). Без шейдера, cost 0.
// Другие эффекты добавляют свои точки через E2.Spots.provide(fn(i) → [{key, layer, u, v, text, cls}]) — так надписи (fx/inscriptions.js).
E2.Spots = (function () {
  var providers = [], box = null, pop = null, txt = null, btn = null, safe = null, fit = '', active = [], built = -1, forDot = null, cfgRef = null;
  function el(tag, id, cls, parent) { var e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; (parent || document.body).appendChild(e); return e; }
  function text(h) {
    if (h.text) return h.text[E2.lang()] || h.text.en || '';
    var f = (cfgRef.facts || {})[h.key];
    return (f && (f[E2.lang()] || f.en)) || '';
  }
  function depth(entry, h) {   // та же глубина, что читает шейдер (e1.62: bldDepthAt / dB / depthAt)
    if (h.layer === 'building') {
      var bd = entry.bldD;
      if (!bd) return entry.kd ? entry.kd[1] : 0.5;
      return bd.d[E2.clamp(Math.round(h.v * (bd.h - 1)), 0, bd.h - 1) * bd.w + E2.clamp(Math.round(h.u * (bd.w - 1)), 0, bd.w - 1)] / 255;
    }
    var dm = entry.depthMap;
    if (!dm) return 0.5;
    return dm.d[E2.clamp(Math.round(h.v * (dm.h - 1)), 0, dm.h - 1) * dm.w + E2.clamp(Math.round(h.u * (dm.w - 1)), 0, dm.w - 1)] / 255;
  }
  function close() { if (!pop) return; pop.classList.remove('show'); document.getElementById('stage').classList.remove('reading'); forDot = null; }
  // Место для карточки по высоте: от выреза сверху (Dynamic Island / статус, env(safe-area-inset-top) через пробник #hsSafe; не выше прежних 56 px)
  // до верха нижнего ряда ‹ меню › (под ним — полоска iPhone). Карточка не выше этого места; лишний текст прокручивается внутри #hsText.
  function room() {
    var H = window.innerHeight, s = safe ? safe.getBoundingClientRect() : null, bar = document.getElementById('bar');
    var top = Math.max(56, (s ? s.top : 0) + 8), bot = H - (s ? H - s.bottom : 0) - 8;
    var br = bar && bar.getBoundingClientRect();
    if (br && br.height && br.top > top + 160) bot = Math.min(bot, br.top - 8);
    return [top, Math.max(top + 120, bot)];
  }
  function place(a) {   // карточка над точкой; мало места сверху — под точкой; не влезает ни туда, ни туда — по центру свободного места (без хвостика)
    var r = room(), cssW = window.innerWidth, gap = 11 + 16;
    var key = r[0] + ':' + r[1] + ':' + cssW + ':' + txt.textContent;
    if (key !== fit) {   // высоту текста пересчитывать только при новом тексте или размере экрана (place идёт каждый кадр)
      fit = key; txt.style.maxHeight = '';   // без ограничения: сколько окна занимает всё, кроме текста (поля, рамка, промежуток, кнопка)
      var rest = pop.offsetHeight - txt.offsetHeight;
      txt.style.maxHeight = Math.max(48, r[1] - r[0] - rest) + 'px';
    }
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var by = Math.max(a.y + 11, r[0] - 16);   // под точкой, но не в вырезе (точка сама может стоять под Dynamic Island)
    var above = a.y - gap - h >= r[0], below = !above && by + 16 + h <= r[1], center = !above && !below;
    var sx = document.getElementById('stage').getBoundingClientRect().left;   // e2.0.26: на ПК сцена — столбик по центру, точка — в её координатах
    var x = center ? cssW / 2 : a.x + sx, left = x - w / 2, cl = E2.clamp(left, 8, Math.max(8, cssW - 8 - w));
    pop.classList.toggle('below', below); pop.classList.toggle('center', center);
    pop.style.left = x + 'px'; pop.style.top = (center ? (r[0] + r[1]) / 2 : below ? by : a.y - 11) + 'px';     // сцена от верха экрана: y — тот же
    pop.style.setProperty('--shift', (cl - left) + 'px');
  }
  function open(a) {
    txt.textContent = text(a.hs); txt.scrollTop = 0;
    forDot = a; place(a); pop.classList.add('show');
    if (!a.hs.insc) document.getElementById('stage').classList.add('reading');   // у надписи фон не размывается — её же и смотрят
  }
  function build(i, entry) {
    box.innerHTML = ''; active = []; close(); built = i;
    var list = ((cfgRef.frames[i].effects.hotspots || {}).list || []).slice();
    providers.forEach(function (fn) { list = list.concat(fn(i) || []); });
    list.forEach(function (hs) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'hs-dot' + (hs.cls ? ' ' + hs.cls : '');
      b.setAttribute('aria-label', text(hs) || hs.key);
      var a = { el: b, hs: hs, d: depth(entry, hs), x: -99, y: -99 };
      b.addEventListener('click', function (e) { e.stopPropagation(); if (forDot === a && pop.classList.contains('show')) close(); else open(a); });
      box.appendChild(b); active.push(a);
    });
  }
  return {
    provide: function (fn) { providers.push(fn); },
    init: function (cfg) {
      cfgRef = cfg;
      box = el('div', 'hotspots', '', document.getElementById('stage'));
      safe = el('div', 'hsSafe');   // пробник вырезов экрана: top/bottom = env(safe-area-inset-*)
      pop = el('div', 'hsPopup'); txt = el('div', 'hsText', '', pop); btn = el('button', 'hsBack', '', pop); btn.type = 'button';
      btn.textContent = { hy: '× փակել', ru: '× закрыть', en: '× close' }[E2.lang()];
      btn.addEventListener('click', close);
      document.addEventListener('pointerdown', function (e) { if (forDot && pop.classList.contains('show') && !pop.contains(e.target) && e.target !== forDot.el) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    },
    // после каждого кадра: при смене кадра точки прячутся, на новом — строятся заново; иначе едут за наклоном
    after: function (S, view) {
      var i = E2.Stage.frame(), fading = E2.Stage.fading(), css = view.css();
      if (fading || !S.fa) { if (active.length && active[0].el.classList.contains('show')) { close(); active.forEach(function (a) { a.el.classList.remove('show'); }); } return; }
      if (built !== i) build(i, S.fa);
      active.forEach(function (a) {
        var q = view.project(a.hs.u, a.hs.v, a.d);
        a.x = q[0] * css[0]; a.y = q[1] * css[1];
        a.el.style.transform = 'translate(' + a.x.toFixed(1) + 'px,' + a.y.toFixed(1) + 'px)';
        if (!a.el.classList.contains('show')) a.el.classList.add('show');
      });
      if (forDot && pop.classList.contains('show')) place(forDot);   // карточка едет вместе с точкой
    },
    open: function (key) { var a = active.filter(function (x) { return x.hs.key === key; })[0]; if (!a) return false; open(a); return true; },
    mark: function (key, cls) { var a = active.filter(function (x) { return x.hs.key === key; })[0]; if (a) a.el.classList.add(cls); return !!a; },
    // для проверок (window.__e2.spots): точки текущего кадра — ключ, место на экране, видна ли; открытая карточка
    state: function () {
      return { frame: built, dots: active.map(function (a) { return { key: a.hs.key, x: +a.x.toFixed(1), y: +a.y.toFixed(1), d: +a.d.toFixed(3), shown: a.el.classList.contains('show'), cls: a.el.className }; }),
        open: forDot && pop.classList.contains('show') ? { key: forDot.hs.key, text: txt.textContent } : null };
    }
  };
})();
E2.effect({
  name: 'hotspots',
  low: 'on',            // точки — интерфейс, на слабой ступени остаются
  init: function (cfg) { E2.Spots.init(cfg); },
  upload: function (G, entry, r) { entry.bldD = r.bldD || null; },   // глубина здания по точкам (та же, что в альфе земли у шейдера)
  after: function (S, view) { E2.Spots.after(S, view); }
});

// ===== fx/inscriptions.js =====
// fx/inscriptions.js — купленные надписи (перенос e1.60–e1.62). Сама надпись уже в рисунке (stanok insert --inscription, во всех версиях кадра);
// здесь — её точка «Надпись: ТЕКСТ · год» (через E2.Spots) и личная ссылка покупателя ?n=<id>: страница сразу открывается на кадре надписи,
// точка пульсирует, через 0,9 с открывается карточка. Тексты карточки — как у e1.62 (build_pages.py: «Փորագրություն՝ … · …»). Без шейдера, cost 0.
E2.Insc = (function () {
  var list = [], want = null, done = false, t0 = null;
  var LBL = { hy: 'Փորագրություն՝ ', ru: 'Надпись: ', en: 'Carved: ' };
  function q() { var m = /^[a-z0-9-]{2,40}$/.exec(String(E2.query('n') || '').toLowerCase()); return m ? m[0] : null; }   // та же форма, что у e1.62
  return {
    init: function (cfg) {
      var names = cfg.frames.map(function (f) { return f.name; });
      list = (cfg.inscriptions || []).map(function (x) { return { id: x.id, fi: names.indexOf(x.frame), u: x.u, v: x.v, layer: x.layer, text: x.text, year: x.year }; })
        .filter(function (x) { return x.fi >= 0; });
      var id = q();
      want = id ? list.filter(function (x) { return x.id === id; })[0] || null : null;
      E2.Spots.provide(function (i) {
        return list.filter(function (x) { return x.fi === i; }).map(function (x) {
          var t = {}; Object.keys(LBL).forEach(function (l) { t[l] = LBL[l] + x.text + ' · ' + x.year; });
          return { key: 'insc:' + x.id, layer: x.layer, u: x.u, v: x.v, text: t, insc: true, cls: 'hs-insc' };
        });
      });
    },
    first: function () { return want ? want.fi : null; },   // core/boot.js: по личной ссылке первым грузится кадр надписи
    after: function (S) {
      if (!want || done) return;
      if (E2.Stage.frame() !== want.fi) { if (E2.Frames.get(want.fi)) E2.Stage.go(want.fi); else E2.Frames.loadDay(want.fi); return; }
      if (E2.Stage.fading()) return;
      if (t0 === null) { if (E2.Spots.mark('insc:' + want.id, 'insc-me')) t0 = S.t; return; }
      if (S.t - t0 >= 900) { done = E2.Spots.open('insc:' + want.id); }
    },
    state: function () { return { want: want ? want.id : null, frame: want ? want.fi : null, opened: done, count: list.length }; }
  };
})();
// «Оставить надпись» → витрина (sale.url, /buy/). С e2.0.13 — пункт меню (как у e1.62, секция #pSale в page.html), в углу экрана её больше нет (отзыв Нарека на e2.0.11):
// на экране только ‹ меню ›. С e2.0.20 — компактная бумажная бирка с пером, как кнопка B на главной (.p-tag в page.html, зона 44 px). Нет мест, личная ссылка ?n= (зритель
// уже купил) или нет настроек продажи — секция остаётся скрытой.
E2.Sale = (function () {
  var T = {
    go: { hy: 'Թողնել մակագրություն', ru: 'Оставить надпись', en: 'Leave an inscription' },
    left: { hy: 'մնացել է {n}-ը {t}-ից', ru: 'осталось {n} из {t}', en: '{n} of {t} left' }
  };
  var PEN = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5.4 25.6 Q9.6 21.2 13.8 16.9"/><path d="M12.2 15.3 L19.6 7.8 Q21.4 6.2 23.4 7.4 Q25.2 9.1 23.8 11 L16.4 18.6 Z"/><path d="M6.2 28.2 Q15.8 27.6 26.6 28.3"/></svg>';
  var S = null, sec = null, a = null;
  function fill() {   // подписи — на языке страницы (зритель мог сменить язык в меню)
    if (!a || !S) return;
    var l = E2.lang();
    // e2.0.20: компактная бирка как кнопка B на главной (без счётчика на самой бирке — он в подсказке title/aria)
    var left = (T.left[l] || T.left.en).replace('{n}', S.left).replace('{t}', S.total);
    a.innerHTML = PEN + '<span>' + (T.go[l] || T.go.en) + '</span>';
    a.title = left; a.setAttribute('aria-label', (T.go[l] || T.go.en) + ' · ' + left);
  }
  return {
    init: function (cfg, personal) {
      S = cfg.sale || null;
      sec = document.getElementById('pSale'); a = document.getElementById('saleBtn');
      if (!S || !(S.left > 0) || personal || !sec || !a) return;
      a.href = S.url || '/buy/';
      fill(); sec.hidden = false;
    },
    relang: fill,
    after: function () {}
  };
})();
E2.effect({
  name: 'inscriptions',
  low: 'on',
  init: function (cfg) { E2.Insc.init(cfg); E2.Sale.init(cfg, E2.Insc.first() !== null); },
  after: function (S) { E2.Insc.after(S); E2.Sale.after(); }
});

// ===== fx/postcard.js =====
// fx/postcard.js — открытка «в сторис» 1080×1920 (перенос e1.62: viewer.js «открытка», postcard.js). Рисует открытку библиотека
// e2/lib/postcard.js — копия postcard.js e1.62 байт в байт (табличка, штемпель «Երևան», старая бумага, оборот); она выходит рядом с движком
// (e/<версия>/postcard.js) и грузится в простое, когда все кадры загружены, вместе со шрифтами и бумагой. Здесь — только снимок сцены
// (E2.Stage.snap), карта слоя здания (табличка и штемпель обходят здание), окно и отдача файла.
// Поток — как у e1.62 (уроки §11): нажатие «Открытка» → снимок, обе стороны собраны и закодированы СРАЗУ (до нажатия «Сохранить»);
// «Сохранить» на телефоне — один share с двумя файлами (лицо, оборот) или с одним лицом; share с двумя отклонён → плашка «Открытка готова»
// → лицо, потом «Сохранить оборот». Компьютер — скачивание лица и через 0,4 с оборота. Время — только E2.Clock. Без шейдера, cost 0.
// «Во время праздника» (e1.31/e1.35, postcard.show): шоу ТЕКУЩЕГО кадра встаёт стоп-кадром на замеренной секунде (postcard.show.frames[<кадр>].t,
// ночью — .night), снимок, шоу обрывается; штемпель и табличка обходят то, что шоу изменило в кадре (карта keep — как showMaskOf e1.62).
// Ещё нет (как у e1.62): «Момент» (ползунок суток и погоды — на e2 открытка берёт время и погоду сцены из меню), «Мой год», своя строка и «Кому».
E2.Card = (function () {
  var cfg = null, P = null, lib = 'idle', fontsDone = false, paper = { front: null, back: null, p: null }, bld = {}, cur = null, step2 = false, toastF = null;
  var FONT = '"Chka Serif", "Noto Serif", serif', W = 1080, H = 1920;
  var SAMPLE = { hy: 'Երևան Պողոս-Պետրոս 0123', ru: 'Ереван Погос-Петрос 0123', en: 'Yerevan Poghos-Petros 0123' };
  var T = {
    btn: { hy: 'Բացիկ', ru: 'Открытка', en: 'Postcard' }, save: { hy: 'Պահպանել բացիկը', ru: 'Сохранить открытку', en: 'Save postcard' },
    saveBack: { hy: 'Պահպանել հետնակողմը', ru: 'Сохранить оборот', en: 'Save the back side' }, back: { hy: 'Ավելացնել հետնակողմը', ru: 'Добавить оборот', en: 'Add the back side' },
    ready: { hy: 'Բացիկը պատրաստ է․ սեղմեք՝ պահպանելու համար', ru: 'Открытка готова — нажмите, чтобы сохранить', en: 'Postcard ready — tap to save' },
    close: { hy: 'Փակել', ru: 'Закрыть', en: 'Close' }, exhibit: { hy: 'Ցուցանմուշ', ru: 'Экспонат', en: 'Exhibit' }, rare: { hy: 'Հազվագյուտ', ru: 'Редкая', en: 'Rare' },
    fest: { hy: 'Տոնի ժամանակ', ru: 'Во время праздника', en: 'During the celebration' }
  };
  var IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var TOUCH = IOS || /Android/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
  function $(id) { return document.getElementById(id); }
  function tr(k) { return T[k][E2.lang()] || T[k].en; }
  function tx(v) { return v && typeof v === 'object' ? (v[E2.lang()] || v.en || '') : (v || ''); }
  function base(name) { return cfg.engine.base + name + '?v=' + cfg.engine.version; }
  function free(c) { if (c) { c.width = 0; c.height = 0; } }
  function fontsReady() {
    if (fontsDone || !document.fonts || !document.fonts.check) return true;
    try { var s = SAMPLE[E2.lang()]; return document.fonts.check('700 40px ' + FONT, s) && document.fonts.check('400 40px ' + FONT, s); } catch (e) { return true; }
  }
  function loadAll() {   // в простое, когда кадры загружены: библиотека, шрифты трёх письменностей, бумага, слои зданий для карты
    lib = 'loading';
    var sc = document.createElement('script');
    sc.src = base('postcard.js');
    sc.onload = function () { lib = window.ChkaPostcard ? 'ok' : 'fail'; $('cardBtn').hidden = lib !== 'ok'; };
    sc.onerror = function () { lib = 'fail'; E2.err('postcard', 'postcard.js не загрузился'); };
    document.head.appendChild(sc);
    var all = [];
    if (document.fonts && document.fonts.load) {
      Object.keys(SAMPLE).forEach(function (l) { ['400', '700'].forEach(function (w) { all.push(document.fonts.load(w + ' 40px ' + FONT, SAMPLE[l]).catch(function () {})); }); all.push(document.fonts.load('italic 400 40px ' + FONT, SAMPLE[l]).catch(function () {})); });
    }
    Promise.all(all).then(function () { fontsDone = true; });   // document.fonts.check на iOS может и после загрузки отвечать false (e1.36)
    paper.p = Promise.all([['old-paper-1.webp', 'front'], ['old-paper-2.webp', 'back']].map(function (q) {
      return new Promise(function (res) {
        var im = new Image(); im.decoding = 'async';
        im.onload = function () { var d = function () { paper[q[1]] = im; res(); }; if (im.decode) im.decode().then(d, d); else d(); };
        im.onerror = function () { res(); }; im.src = base('paper/' + q[0]);
      });
    }));
    cfg.frames.forEach(function (f, i) { bldLoad(i); });
  }
  function bldLoad(i) {   // альфа слоя здания кадра, 144 px по ширине (тот же файл, что у движка — из кэша)
    var u = (cfg.frames[i].files || {}).building;
    if (i in bld || !u) return;
    bld[i] = 'loading';
    var im = new Image();
    im.onload = function () { try { var c = document.createElement('canvas'); c.width = 144; c.height = Math.max(1, Math.round(144 * im.naturalHeight / im.naturalWidth)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); bld[i] = c; } catch (e) { bld[i] = null; } };
    im.onerror = function () { bld[i] = null; };
    im.src = u;
  }
  function mask() {   // карта «здание» 108×192 в координатах открытки: тот же «cover»-вырез экрана, что у снимка (e1.62 cardBuildingMask)
    var i = E2.Stage.frame(), m = bld[i], f = E2.Frames.get(i), view = E2.Stage.view();
    bldLoad(i);
    if (!m || m === 'loading' || !f) return null;
    var css = view.css(), cw = css[0], ch = css[1], MW = 108, MH = 192, s = Math.max(W / cw, H / ch), sx = (cw - W / s) / 2, sy = (ch - H / s) / 2;
    var d = f.kd ? f.kd[1] : 0.5, p0 = view.project(0, 0, d), p1 = view.project(1, 1, d);
    var cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
    var x = cv.getContext('2d', { willReadFrequently: true }), out = new Uint8Array(MW * MH), any = false;
    x.drawImage(m, (p0[0] * cw - sx) * s * MW / W, (p0[1] * ch - sy) * s * MH / H, (p1[0] - p0[0]) * cw * s * MW / W, (p1[1] - p0[1]) * ch * s * MH / H);
    var a = x.getImageData(0, 0, MW, MH).data;
    for (var k = 0; k < out.length; k++) if (a[k * 4 + 3] > 0) { out[k] = a[k * 4 + 3]; any = true; }
    free(cv);
    return any ? out : null;
  }
  function moment() {   // время суток и погода сцены: часы на штемпеле (как «Момент» e1.62: день 13:00, закат 19:20, ночь 23:30) и «редкая»
    var td = E2.fxGet('tod'), wx = E2.fxGet('weather'), n = td && td.state ? td.state.name : 'day', k = wx && wx.state ? wx.state.kind : 'none';
    return { time: { day: '13:00', sunset: '19:20', night: '23:30' }[n] || '13:00', special: n !== 'day' && (k === 'snow' || k === 'rain') };
  }
  // секунда праздника для текущего кадра (как cardShowCfg e1.35) или null — у здания нет праздника, у кадра нет шоу, «уменьшить движение»
  var SHOW_T_DEFAULT = 15;
  function festT() {
    var S = P && P.show, sh = E2.fxGet('show'), i = E2.Stage.frame(), td = E2.fxGet('tod');
    if (!S || !sh || !sh.has(i) || E2.off('show') || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return null;
    var night = !!(td && td.state && td.state.p > 1.6), m = S.frames && S.frames[String(i)], t = null;
    if (m) t = night && m.night != null ? m.night : m.t;
    else if (S.frame === i) t = night && S.night && S.night.frame === i ? S.night.t : S.t;
    var dur = sh.B.frames[i].effects.show.dur;
    return Math.min(t != null ? t : SHOW_T_DEFAULT, dur - 0.5);
  }
  function festOn() { var b = $('cardFest'); return !!b && !b.hidden && b.getAttribute('aria-pressed') === 'true'; }
  function keepOf(a, b) {   // что шоу изменило в кадре (снимок с шоу минус без него), 108×192, края +1 ячейка — табличка и штемпель туда не ложатся
    var MW = 108, MH = 192, ca = document.createElement('canvas'), cb = document.createElement('canvas'); ca.width = cb.width = MW; ca.height = cb.height = MH;
    var xa = ca.getContext('2d', { willReadFrequently: true }), xb = cb.getContext('2d', { willReadFrequently: true });
    xa.drawImage(a, 0, 0, MW, MH); xb.drawImage(b, 0, 0, MW, MH);
    var A = xa.getImageData(0, 0, MW, MH).data, B = xb.getImageData(0, 0, MW, MH).data, m = new Uint8Array(MW * MH), out = new Uint8Array(MW * MH), i, x, y, dx, dy;
    for (i = 0; i < m.length; i++) if (Math.abs(A[i * 4] - B[i * 4]) + Math.abs(A[i * 4 + 1] - B[i * 4 + 1]) + Math.abs(A[i * 4 + 2] - B[i * 4 + 2]) > 45) m[i] = 1;
    for (y = 0; y < MH; y++) for (x = 0; x < MW; x++) {
      if (!m[y * MW + x]) continue;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < MW && yy < MH) out[yy * MW + xx] = 255; }
    }
    free(ca); free(cb);
    return out;
  }
  function fileOf(cv, back) {   // синхронно (toDataURL): между нажатием и share не должно быть ожиданий (iOS, уроки §11); цель ≤ ~1 МБ
    var q = 0.9, u = cv.toDataURL('image/jpeg', q);
    while (u.length * 0.75 > 1024 * 1024 && q > 0.6) { q -= 0.1; u = cv.toDataURL('image/jpeg', q); }
    var bin = atob(u.split(',')[1]), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    var nm = String(cfg.postcardFile || cfg.id + '.png').replace(/\.png$/i, '') + (back ? '-back' : '-front') + '.jpg';   // как e1.62 cardName: у каждой стороны своё имя (e1.36)
    return new File([b], nm, { type: 'image/jpeg' });
  }
  function make(src, keep) {   // снимок → лицо и оборот (холсты + файлы) — всё сразу; src, keep — снимок праздника и его карта (иначе — снимок сцены сейчас)
    if (lib !== 'ok') return null;
    var fest = !!src;
    src = src || E2.Stage.snap(W, H);
    if (!src) return null;
    var C = window.ChkaPostcard, lang = E2.lang(), seed = C.seed(), mo = moment(), no = Math.round(+P.no || 0);
    var o = { lang: lang, name: tx(P.name), years: tx(P.years), url: P.url || 'chka.am', line: '', to: '', film: false, paper: paper.front, paperBack: paper.back, font: FONT,
      mask: mask(), keep: keep || null, no: no > 0 ? (no < 10 ? '00' : no < 100 ? '0' : '') + no : '', noLabel: tr('exhibit'), rare: mo.special || fest || C.luck(seed), rareLabel: tr('rare'),
      year: null, seed: seed, code: C.code(seed), time: mo.time, fact: P.fact || null };
    var front = C.compose(src, o), back = C.composeBack(src, o);
    free(src);
    return { front: front, back: back, f: fileOf(front, false), b: fileOf(back, true) };
  }
  function preview(id, c) { var p = $(id), dp = Math.min(2, window.devicePixelRatio || 1); p.width = Math.round(180 * dp); p.height = Math.round(320 * dp); p.getContext('2d').drawImage(c, 0, 0, p.width, p.height); }
  function put(c) {
    if (cur) { free(cur.front); free(cur.back); }
    cur = c;
    preview('cardPrev', cur.front); preview('cardPrevB', cur.back);
    step2 = false; toastF = null; $('cardGo').classList.remove('cc-go2'); $('cardGo').textContent = tr('save'); $('cardToast').classList.remove('on');
  }
  // праздник: шоу кадра стоп-кадром на секунде t → ждём, пока ролик встанет на кадр и картинки шоу загрузятся (pending = 0, не меньше 4 тиков,
  // не дольше 6 с) → снимок → шоу обрывается (время суток плавно возвращается само). Пока снимается — «Сохранить» недоступна.
  var festBusy = false;
  function festMake(done) {
    var sh = E2.fxGet('show'), i = E2.Stage.frame(), t = festT(), go = $('cardGo');
    if (t == null || festBusy) { done(null); return; }
    var plain = E2.Stage.snap(W, H);
    if (!plain) { done(null); return; }
    festBusy = true; go.disabled = true;
    sh.run = null;
    if (!sh.start(i)) { festBusy = false; go.disabled = false; free(plain); done(null); return; }
    sh.freeze(t);
    var n = 0, U = window.__e2;
    (function wait() {
      n++;
      if (n < 4 || (n < 60 && U && U.pending && U.pending() > 0)) { E2.Clock.after(100, wait); return; }
      var src = sh.run && sh.run.fr === i && E2.Stage.frame() === i ? E2.Stage.snap(W, H) : null, c = null;
      if (src) c = make(src, keepOf(plain, src));
      sh.run = null; free(plain);
      festBusy = false; go.disabled = false;
      done(c);
    })();
  }
  function openCard() {
    var fb = $('cardFest'), can = festT() != null;
    fb.hidden = !can;
    if (can && festOn()) {
      document.body.classList.add('card-open');
      festMake(function (c) { c = c || make(); if (c) put(c); });
      return true;
    }
    var c = make();
    if (!c) return false;
    put(c);
    document.body.classList.add('card-open');
    return true;
  }
  function closeCard() { document.body.classList.remove('card-open'); $('cardToast').classList.remove('on'); }
  function withBack() { return $('cardBack').getAttribute('aria-pressed') === 'true'; }
  // компьютер — card-front.jpg / card-back.jpg, как e1.62
  function dl(f, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = name || f.name; document.body.appendChild(a); a.click(); a.remove(); }
  function go() {
    if (!cur) return;
    var share = !!(navigator.share && navigator.canShare) && TOUCH, gb = $('cardGo');
    if (!share) { dl(cur.f, 'card-front.jpg'); if (withBack()) { var b = cur.b; E2.Clock.after(400, function () { dl(b, 'card-back.jpg'); }); } return; }
    if (festBusy) return;
    if (step2) { step2 = false; gb.classList.remove('cc-go2'); gb.textContent = tr('save'); navigator.share({ files: [cur.b] }).catch(function () {}); return; }
    if (withBack()) {
      var f = cur.f;
      navigator.share({ files: [cur.f, cur.b] }).catch(function (e) {   // отменил сам — ничего; не умеет два файла — запасной путь
        if (e && e.name === 'AbortError') return;
        toastF = f; $('cardToast').classList.add('on');
      });
      return;
    }
    navigator.share({ files: [cur.f] }).catch(function () {});
  }
  function ui() {
    var b = document.createElement('button'); b.type = 'button'; b.id = 'cardBtn'; b.hidden = true; b.textContent = tr('btn');
    b.addEventListener('click', function (e) { e.stopPropagation(); openCard(); });
    document.body.appendChild(b);
    var s = document.createElement('div'); s.id = 'cardCfg';
    s.innerHTML = '<div class="cc-prev"><canvas id="cardPrev" width="1" height="1"></canvas><canvas id="cardPrevB" width="1" height="1"></canvas></div>' +
      '<button type="button" id="cardBack" aria-pressed="false"></button><button type="button" id="cardFest" aria-pressed="false" hidden></button><button type="button" id="cardGo"></button>' +
      '<button type="button" id="cardCfgClose"></button><div id="cardToast"><span></span></div>';
    document.body.appendChild(s);
    $('cardBack').textContent = tr('back'); $('cardFest').textContent = tr('fest'); $('cardGo').textContent = tr('save'); $('cardCfgClose').textContent = tr('close'); $('cardToast').firstChild.textContent = tr('ready');
    $('cardFest').addEventListener('click', function () {   // праздник вкл/выкл — открытка пересобирается сразу
      if (festBusy) return;
      var on = !festOn(); this.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) festMake(function (c) { if (c) put(c); }); else { var c = make(); if (c) put(c); }
    });
    $('cardBack').addEventListener('click', function () { this.setAttribute('aria-pressed', withBack() ? 'false' : 'true'); });
    $('cardGo').addEventListener('click', go);
    $('cardCfgClose').addEventListener('click', closeCard);
    $('cardToast').addEventListener('click', function () {
      if (!toastF) return;
      $('cardToast').classList.remove('on'); navigator.share({ files: [toastF] }).catch(function () {}); toastF = null;
      step2 = true; $('cardGo').classList.add('cc-go2'); $('cardGo').textContent = tr('saveBack');
    });
  }
  return {
    init: function (c) {
      cfg = c; P = c.postcard || null;
      if (!P) return;
      ui();
      window.__card = { fontsReady: function () { return fontsReady(); }, paperReady: function () { return !!(paper.front && paper.back); },
        bldLoad: function () {   // слои всех кадров для карты здания: дождаться, пока ни один не «грузится» (не дольше ~10 с по часам движка)
          cfg.frames.forEach(function (f, i) { bldLoad(i); });
          return new Promise(function (res) { (function w(n) { if (n > 100 || E2.Clock.virtual || !Object.keys(bld).some(function (k) { return bld[k] === 'loading'; })) res(); else E2.Clock.after(100, function () { w(n + 1); }); })(0); });
        },
        lib: function () { return lib; }, make: function () { return openCard(); }, mask: function () { return mask(); },
        festT: function () { return festT(); }, fest: function (on) { var b = $('cardFest'); if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false'); return !!b && !b.hidden; },   // проверки: праздник на открытке
        state: function () { return { open: document.body.classList.contains('card-open'), fest: festOn(), festHidden: !$('cardFest') || $('cardFest').hidden, busy: festBusy, ready: !!cur }; } };
    },
    label: function () { return P ? tr('btn') : ''; },   // подпись кнопки в меню (core/ui.js ставит её внутрь значка)
    relang: function () {   // зритель сменил язык в меню: подписи кнопки и окна открытки — на новом
      if (!P) return;
      var b = $('cardBtn'), sp = b && b.querySelector('span'); if (sp) sp.textContent = tr('btn'); else if (b) b.textContent = tr('btn');
      $('cardBack').textContent = tr('back'); $('cardFest').textContent = tr('fest'); $('cardCfgClose').textContent = tr('close'); $('cardToast').firstChild.textContent = tr('ready');
      $('cardGo').textContent = tr(step2 ? 'saveBack' : 'save');
    },
    after: function () { if (P && lib === 'idle' && document.documentElement.getAttribute('data-e2') === 'all') loadAll(); }
  };
})();
E2.effect({
  name: 'postcard',
  low: 'on',
  init: function (cfg) { E2.Card.init(cfg); },
  after: function () { E2.Card.after(); }
});

// ===== fx/original.js =====
// fx/original.js — «Оригинал» (e2.0.29): архивное фото, по которому сделан рисунок кадра. Пункт меню (не на первом кадре, ничего не висит на экране):
// нажал → шторка меню уходит → по рисунку справа налево проходит карандашная линия, за ней проявляется старое фото НА СВОЁМ МЕСТЕ
// (место — effects.original.photo.fit, совмещение по контуру делает станок: stanok.py original). Линию двигает палец или мышь (и ← → на ПК):
// слева живой рисунок, справа фото на бумаге. Сверху — музейная табличка: «Оригинал · 1927», автор / архив, ссылка «источник».
// Закрыть — бирка меню (на это время она «Закрыть»), Esc, смена кадра. Выбор подачи — report/source-photo/compare.jpg (вариант 1 «шторка-карандаш»).
// Фото — DOM поверх сцены (это не часть рисунка, а документ рядом с ним): стоит по центру экрана (не едет с камерой),
// грузится только по нажатию. Время — только E2.Clock (шторка идёт по часам движка: проверки с ?vt=1 видят тот же миг).
// e2.0.30 (отзыв Нарека на e2.0.29): шторка стартует ПО ЦЕНТРУ экрана, а фото стоит так, что его ТОЧКА ЦЕНТРА (effects.original.photo.center —
// то же место, что в середине рисунка) ровно под шторкой; фото не меньше, чем по контуру (fit), и закрывает экран по высоте и обе половины
// (не больше ×2,5 сверх этого — на ПК широкий экран), по вертикали точка — на высоте того же места рисунка. Раньше фото лежало строго по контуру
// и на части кадров уезжало к левому краю — увидеть его можно было, только утащив шторку до конца влево.
// Подпись авторства — мелко на самом фото (справа внизу, видна только на стороне фото), табличка — «Оригинал · год» и «источник».
// e2.0.31 (уточнение Нарека 26.11): шторка стартует на 60 % ширины (чуть правее центра); само фото — по центру и вписано в экран крупно (см. place);
// ссылка «источник» — в новой вкладке (target=_blank, rel=noopener). Красные случаи G20: ?break=orig-shift — фото сдвинуто на четверть экрана (не по центру),
// ?break=orig-small — фото вдвое меньше (мелкое посередине).
E2.Orig = (function () {
  var T = {
    title: { hy: 'Բնօրինակը', ru: 'Оригинал', en: 'Original' }, drawing: { hy: 'նկար', ru: 'рисунок', en: 'drawing' }, photo: { hy: 'լուսանկար', ru: 'фото', en: 'photo' },
    src: { hy: 'աղբյուրը ↗', ru: 'источник ↗', en: 'source ↗' }, approx: { hy: 'մոտ ', ru: 'около ', en: 'c. ' }, by: { hy: 'լուսանկարը՝ ', ru: 'фото: ', en: 'photo: ' },
    drag: { hy: 'Տեղաշարժեք գիծը', ru: 'Двигайте линию', en: 'Drag the line' }
  };
  var cfg = null, root = null, side = null, img = null, cred = null, line = null, knob = null, plate = null, pT = null, pC = null, pA = null, tagL = null, tagR = null;
  var on = false, fr = -1, cut = 1, target = 1, closing = false, drag = null, rect = null, t0 = 0, ready = false, OPEN_TO = 0.6;
  function tr(k) { return T[k][E2.lang()] || T[k].en; }
  function loc(v) { return v && typeof v === 'object' ? (v[E2.lang()] || v.en || '') : (v || ''); }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; parent.appendChild(e); return e; }
  function photo(i) { var f = cfg.frames[i], o = f && f.effects && f.effects.original; return o && o.photo && f.files && f.files.photo ? o.photo : null; }
  function text() {
    var p = photo(fr); if (!p) return;
    pT.textContent = tr('title') + ' · ' + (p.approx ? tr('approx') : '') + p.year;
    pC.textContent = ''; pC.hidden = true;   // e2.0.30: автор — подписью на самом фото (cred)
    cred.textContent = tr('by') + loc(p.credit) + (p.license ? ' · ' + p.license : '');
    pA.hidden = !p.url; if (p.url) { pA.href = p.url; pA.target = '_blank'; pA.rel = 'noopener'; pA.textContent = tr('src'); }
    tagL.textContent = tr('drawing'); tagR.textContent = tr('photo');
    knob.setAttribute('aria-label', tr('drag'));
  }
  function setCut(x) { target = E2.clamp(x, 0, 1); }
  function fromClient(cx) { var r = root.getBoundingClientRect(); return (cx - r.left) / (r.width || 1); }
  function open() {
    var i = E2.Stage.frame(), p = photo(i), sh = E2.fxGet('show');
    if (!p || E2.Stage.fading() || (sh && sh.run)) return false;
    fr = i; on = true; closing = false; ready = false; cut = 1.02; target = OPEN_TO; t0 = E2.Clock.now(); rect = null;
    text();
    img.classList.remove('in');
    img.onload = function () { ready = true; img.classList.add('in'); };
    img.onerror = function () { E2.err('original', 'фото не загрузилось: ' + img.src); close(true); };
    var u = new URL(cfg.frames[i].files.photo, location.href).href;
    if (img.src !== u) img.src = u; else if (img.complete && img.naturalWidth) img.onload();
    root.hidden = false; document.body.classList.add('orig-on');
    root.classList.remove('shut'); void root.offsetWidth; root.classList.add('open');
    return true;
  }
  function close(now) {
    if (!on) return false;
    if (now) { on = false; closing = false; root.classList.remove('open'); root.hidden = true; document.body.classList.remove('orig-on'); return true; }
    closing = true; target = 1.04; root.classList.add('shut');
    return true;
  }
  // e2.0.31: фото ВПИСАНО в экран целиком и стоит ПО ЦЕНТРУ (между табличкой сверху и биркой «Закрыть» снизу), без мелкой картинки посередине:
  // по ширине или по высоте оно занимает весь свободный экран. Шторка при этом стоит на 60 % ширины — справа от неё видно фото сразу.
  function place(S, view) {
    var p = photo(fr), css = view.css(), W = css[0], H = css[1];
    var asp = p.size ? p.size[0] / p.size[1] : (img.naturalWidth ? img.naturalWidth / img.naturalHeight : 1);
    var top = Math.ceil(plate.offsetTop + plate.offsetHeight + 6), bot = 70, aw = W, ah = Math.max(60, H - top - bot);
    var pw = Math.min(aw, ah * asp), ph = pw / asp;
    if (E2.brk('orig-small')) { pw *= 0.5; ph *= 0.5; }
    var x0 = (W - pw) / 2 + (E2.brk('orig-shift') ? W / 4 : 0), y0 = top + (ah - ph) / 2;
    rect = [x0, y0, x0 + pw, y0 + ph];
    img.style.left = x0.toFixed(1) + 'px'; img.style.top = y0.toFixed(1) + 'px';
    img.style.width = pw.toFixed(1) + 'px'; img.style.height = ph.toFixed(1) + 'px';
    // подпись — в правом нижнем углу фото, не шире видимой справа от шторки части
    var vis = Math.max(90, Math.min(300, x0 + pw - OPEN_TO * W - 12));
    cred.style.maxWidth = vis.toFixed(0) + 'px';
    cred.style.right = Math.max(8, W - Math.min(W, x0 + pw) + 8).toFixed(1) + 'px';
    cred.style.bottom = Math.max(bot + 4, H - Math.min(H, y0 + ph) + 8).toFixed(1) + 'px';
    return css;
  }
  function step(S, view) {
    if (!on) return;
    if (E2.Stage.frame() !== fr || E2.Stage.fading()) { close(true); return; }
    var css = place(S, view);
    // шторка: открытие — линия идёт от правого края к середине (пружина), дальше — за пальцем (мягко, без рывков); закрытие — уходит вправо
    var k = drag ? 0.45 : (E2.Clock.now() - t0 < 1400 && !closing ? 0.07 : 0.16);
    cut += (target - cut) * E2.lerpK(k, S.dt || 16.667);
    if (Math.abs(target - cut) < 0.0005) cut = target;
    if (closing && cut > 1.0) { close(true); return; }
    var x = cut * css[0];
    side.style.clipPath = side.style.webkitClipPath = 'inset(0 0 0 ' + x.toFixed(1) + 'px)';
    line.style.transform = knob.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
    root.classList.toggle('edge-l', cut < 0.2); root.classList.toggle('edge-r', cut > 0.8);
  }
  function init(c) {
    cfg = c;
    if (!cfg.frames.some(function (f, i) { return !!photo(i); })) return;
    var stage = document.getElementById('stage');
    root = el('div', '', stage); root.id = 'orig'; root.hidden = true;
    side = el('div', 'og-side', root); el('div', 'og-paper', side);
    img = el('img', 'og-img', side); img.alt = ''; img.decoding = 'async'; img.draggable = false;
    cred = el('small', 'og-credit', side);
    line = el('div', 'og-line', root);
    line.innerHTML = '<svg viewBox="0 0 12 100" preserveAspectRatio="none" aria-hidden="true"><path class="l1" d="M6 0 Q4.6 22 6.4 46 T5.6 100"/><path class="l2" d="M7.6 0 Q6.4 26 8 50 T7.2 100"/></svg>';
    knob = el('button', 'og-knob', root); knob.type = 'button';
    knob.innerHTML = '<span class="og-tag og-l"></span><span class="og-dot"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M12.5 10.5 Q9 13.4 6.6 16 Q9 18.7 12.5 21.5 M19.5 10.5 Q23 13.4 25.4 16 Q23 18.7 19.5 21.5"/></svg></span><span class="og-tag og-r"></span>';
    tagL = knob.querySelector('.og-l'); tagR = knob.querySelector('.og-r');
    plate = el('div', 'og-plate', root); pT = el('b', '', plate); pC = el('span', '', plate); pA = el('a', '', plate); pA.target = '_blank'; pA.rel = 'noopener';
    // палец и мышь: линия идёт туда, где касание (и за протяжкой); касание не наклоняет сцену под фото
    root.addEventListener('pointerdown', function (e) {
      if (plate.contains(e.target)) { e.stopPropagation(); return; }
      e.stopPropagation(); e.preventDefault(); drag = e.pointerId; setCut(fromClient(e.clientX));
      if (root.setPointerCapture) try { root.setPointerCapture(e.pointerId); } catch (err) { /* без захвата протяжка живёт, пока палец над фото */ }
    });
    root.addEventListener('pointermove', function (e) { e.stopPropagation(); if (drag === e.pointerId) setCut(fromClient(e.clientX)); });
    var up = function (e) { if (drag === e.pointerId) drag = null; };
    root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
    root.addEventListener('click', function (e) { e.stopPropagation(); });
    window.addEventListener('keydown', function (e) {     // раньше стрелок кадров (core/ui.js): пока открыт оригинал, ← → двигают линию
      if (!on) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); e.preventDefault(); setCut(target + (e.key === 'ArrowLeft' ? -0.1 : 0.1)); }
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }, true);
  }
  return {
    init: init, step: step, open: open, close: function () { return close(false); },
    on: function () { return on; },
    has: function (i) { return !!cfg && !!photo(i === undefined ? E2.Stage.frame() : i); },
    any: function () { return !!root; },
    relang: function () { if (on) text(); },
    leave: function () { close(true); },
    // проверки (window.__e2.orig): поставить линию сразу (cut 0…1), где фото на экране и где должно быть по fit
    set: function (x) { if (!on) return false; target = cut = E2.clamp(x, 0, 1); return true; },
    state: function () {
      var p = on ? photo(fr) : null;
      return { on: on, frame: fr, cut: +cut.toFixed(4), ready: ready && !!img.naturalWidth, rect: rect, fit: p ? p.fit : null, center: p ? p.center || null : null,
        credit: on ? cred.textContent : '', creditBox: on ? cred.getBoundingClientRect().toJSON() : null,
        img: on ? img.getBoundingClientRect().toJSON() : null, plate: on ? plate.getBoundingClientRect().toJSON() : null, text: on ? plate.textContent : '' };
    }
  };
})();
E2.effect({
  name: 'original',
  low: 'on',
  init: function (cfg) { E2.Orig.init(cfg); },
  leave: function () { E2.Orig.leave(); },
  after: function (S, view) { E2.Orig.step(S, view); }
});

// ===== core/boot.js =====
// core/boot.js — старт: настройки здания (уже проверенные схемой и с подставленными умолчаниями — tools/stanok.py build) → сцена.
// Честная плашка «страница не загрузилась» (page.html: E2_fail) — вместо пустого экрана, если сцена не поднялась или первый кадр не пришёл (e2.0.28).
function fail(why) { if (window.__wl) window.__wl.hide(); if (window.E2_fail) window.E2_fail(why); }
// e2.0.30: экран загрузки (page.html, window.__wl — компонент e1.62) уходит сам, когда пришёл первый кадр и прошло 3 с; при сбое — сразу, под ним плашка «не загрузилась».
E2.boot = function () {
  var cfg = window.E2_BUILDING, el = document.getElementById('stage');
  if (!cfg || !el) { E2.err('boot', 'нет настроек здания или #stage'); fail('config'); return; }
  var on = cfg.effectsOn, fx = E2.fx.filter(function (e) { return on.indexOf(e.name) >= 0; });
  try {
    fx.forEach(function (e) { if (e.init) e.init(cfg); });
    E2.Stage.init(cfg, fx, el);
    E2.Frames.init(cfg, fx);
    E2.UI.init(cfg, fx);
  } catch (e) { E2.err('boot', e); document.documentElement.setAttribute('data-e2', 'error'); fail('boot'); return; }
  var first = Math.min(Math.max(0, +(E2.query('f') || 0) | 0), cfg.frames.length - 1);
  if (E2.Insc && E2.Insc.first() !== null) first = E2.Insc.first();   // личная ссылка ?n=<id> — сразу кадр надписи
  E2.Frames.loadDay(first).then(function () { document.documentElement.setAttribute('data-e2', 'first'); if (window.E2_ok) window.E2_ok(); if (window.__wl) window.__wl.loaded(); if (first) E2.Stage.go(first); },
    function () { document.documentElement.setAttribute('data-e2', 'error'); fail('frame'); });
  E2.Frames.loadAll(first).then(function () { document.documentElement.setAttribute('data-e2', 'all'); });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', E2.boot); else E2.boot();
})();
