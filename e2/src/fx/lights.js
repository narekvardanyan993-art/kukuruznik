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
