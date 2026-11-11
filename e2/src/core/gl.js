// core/gl.js — WebGL: контекст, текстуры, сборка шейдера из кусков эффектов (docs/STANOK.md §2.2).
//
// Эффект (E2.effect({...})) отдаёт куски GLSL в фиксированные крючки. Порядок крючков жёсткий:
//   uv      — куда смотреть в кадре (наклон, потом ветер)
//   base    — рисунок + подложка + здание (+ актёры)
//   tod     — время суток: день, полдень, закат; ночной рисунок готовится (vec3 cn, float nk), но ещё не кладётся
//   lights  — огни ночного рисунка: гасят и зажигают окна, мерцание (меняют cn)
//   night   — ночной рисунок кладётся поверх: c = mix(c, cn * lk, nk)
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
