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
