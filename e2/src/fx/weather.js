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
