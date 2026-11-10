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
