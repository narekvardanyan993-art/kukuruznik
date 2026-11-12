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
