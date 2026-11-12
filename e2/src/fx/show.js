// fx/show.js — шоу кадра «до и после» (docs/STANOK.md §4.5): ролик Veo «было → снос → стало» по маске в куске слоя здания + камера
// (наезд на точку кадра) + время суток по ходу показа. Запуск — кнопкой, повторное нажатие — остановить (гаснет за stopMs).
// Ролик из самого рисунка (первый кадр = рисунок): пиксель ролика берётся только там, где он отличается от рисунка (diff), — небо куска
// не красится; keep — отличие ложится поверх здания (фаэтон C целиком); без keep ролик там, где он = подложке, стирает здание (снос B).
// Герои, чей прямоугольник под шоу, плавно гаснут (собака не «телепортируется»): шоу смешивает свой кусок поверх того, что сейчас
// показывают герои. Время показа — от часов движка; __e2.show(i, sec) в проверках ставит показ на секунду (ролик встаёт на свой кадр).
// Перенесено из e1.62 (showVideo e1.50–e1.57, камера e1.43, SHOW_TOD e1.45) без изменения формул — сверка: tools/stanok_show.mjs.
E2.effect({
  name: 'show',
  low: 'on',
  init: function (cfg) { this.B = cfg; this.C = cfg.effects.show; this.run = null; this.stod = { on: false, base: 0 }; this.cam = { k: 0, C: null, fr: -1 }; this.btnOn = null; },
  upload: function (G, entry, r) {
    var sh = entry.cfg.effects.show;
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
    var st = { cfg: S, sh: sh, x0: x0, y0: y0, w: w, h: h, base: base, ref: ref, gref: gref, dlo: S.diff ? S.diff[0] : 0, dk: S.diff ? 1 / Math.max(1, S.diff[1] - S.diff[0]) : 0,
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
  has: function (i) { var f = this.B.frames[i]; return !!(f && f.effects.show && f.effects.show.type !== 'none'); },
  pendingNow: function () { var f = E2.Frames.get(E2.Stage.frame()); return f && f.show && f.show.pending ? 1 : 0; },
  start: function (i) {
    if (this.run || E2.Stage.fading() || !E2.Frames.get(i) || !this.has(i)) return false;
    var sh = E2.Frames.get(i).cfg.effects.show;
    this.run = { fr: i, t0: E2.Clock.now(), abort: 0, fix: null, len: sh.dur };
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
    [S.fa, S.fb].forEach(function (f) { if (f && f.show) E2.safe('show.video', function () { self.video(f, ck, now); }); });
    // кнопка «Шоу» доступна только на кадре с шоу
    var on = this.has(E2.Stage.frame()) && !E2.Stage.fading();
    if (on !== this.btnOn) { this.btnOn = on; Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) { b.disabled = !on; }); }
    Array.prototype.forEach.call(document.querySelectorAll('[data-show]'), function (b) { var a = !!self.run; if (b.classList.contains('on') !== a) b.classList.toggle('on', a); });
  },
  stepTod: function (ck, S) {   // шоу ведёт время суток (show.tod [[с, p], …]: 0 день, 1 закат, 2.1667 ночь); после показа — плавно назад
    var tod = E2.fxGet('tod'), st = this.stod;
    if (!tod) return;
    var K = ck && ck.fr === E2.Stage.frame() && !E2.Stage.fading() ? (S.fa.cfg.effects.show || {}).tod : null;
    var T = S.cfg.effects.tod, toT = function (p) { return p <= 1 ? T.daySunsetS * p : T.daySunsetS + T.sunsetNightS * (p - 1); };
    if (K && K.length) {
      if (!st.on) { st.on = true; st.base = tod.state.anim ? tod.state.anim.p1 : tod.state.p; }
      if (tod.state.anim) { st.base = tod.state.anim.p1; tod.state.anim = null; }
      var w = E2.clamp(ck.t / 1.0, 0, 1) * (1 - ck.kill);
      tod.apply(st.base + (this.keyAt(K, ck.t) - st.base) * w);
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
    var was = st.active; st.active = vis > 0;
    if (was && !st.active && f.actors) f.actors.dirty = true;     // шоу кончилось: герои снова пишут свой кусок
  },
  debug: function (f) {
    var st = f && f.show, ck = this.clock(E2.Clock.now());
    return { has: !!st, run: ck, vis: st ? st.vis : 0, pending: st ? !!st.pending : false, cam: +this.cam.k.toFixed(4), vT: st ? st.vT : null };
  }
});
