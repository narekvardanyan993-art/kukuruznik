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
    var ba = (S.still || S.tier !== 'full' || E2.off('breath')) ? 0 : P.breath.amp;
    var bx = ba * Math.sin(t * 2 * Math.PI / P.breath.periodS), by = ba * Math.cos(t * 2 * Math.PI / (P.breath.periodS * 0.7));
    var tkA = S.fa ? S.fa.tiltK : 1, tkB = S.fb ? S.fb.tiltK : tkA, tk = tkA + (tkB - tkA) * (S.fb ? S.mix : 0);
    S.shiftX = S.tiltX * P.shiftX * tk + bx;
    S.shiftY = S.tiltY * P.shiftY * tk + by;
    S.zoom = P.zoomNear * E2.clamp(S.tiltY, 0, 1) * tk;       // наклон к себе — ближнее чуть крупнее
  },
  uniforms: function (gl, U, S) { gl.uniform2f(U.uShift, S.shiftX, S.shiftY); gl.uniform1f(U.uZoom, S.zoom); }
});
