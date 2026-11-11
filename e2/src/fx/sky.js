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
