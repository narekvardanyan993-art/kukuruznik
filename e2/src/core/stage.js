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
