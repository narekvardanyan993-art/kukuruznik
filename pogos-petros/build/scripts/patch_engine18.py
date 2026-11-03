#!/usr/bin/env python3
"""Заход 18 (e1.53):
- viewer.js poses: actors[].set — НАБОР роликов (собака B): одновременно идёт один ролик (не по кругу), по концу — следующий случайный из подходящих
  по часам зрителя (другой, если есть); смена — кроссфейдом (ролики начинаются и кончаются одной позой). actors[].tap — ролик реакции на тап.
- poses.tap {set, hit:[u0,v0,u1,v1]}: тап/клик по собаке (только внутри hit, с учётом параллакса) → ролик tap, потом снова случайный.
  Курсор-рука только над собакой (мышь). Инфо-точки (свои кнопки) и поворот пальцем не задеты: тап = отпускание ≤ 10 px и ≤ 0,6 с.
- poses.tone {night, sunset, scale}: карты «рисунок ночи/заката ÷ день» (fix18.py tone) — видео набора пишется и в ночную/закатную
  картинку кадра: ночь = ночной рисунок + (видео − день) × карта. Собака живая днём, на закате и ночью.
- details.js letters.blaze {t0, rise, hold, out, k, halo}: после резьбы буквы разгораются огнём по карте времени письма (как фитиль),
  тёплое свечение изнутри желобка (по маске желобка), медленное мерцание и «текущий» шум пламени, мягкий ореол; потом гаснут.
  Код только высветляет пиксели камня (слой screen), своей краски нет.
- build_pages: копирует vid_*_tone.png; schema: set/tap/tone/blaze.
Повторный запуск ничего не меняет (метки-охраны)."""
from pathlib import Path
V = Path('engine/viewer.js'); D = Path('engine/details.js'); S = Path('tools/building_schema.py'); BP = Path('tools/build_pages.py')
v = V.read_text(); d = D.read_text(); s = S.read_text(); bp = BP.read_text()

def rep(t, old, new, tag, guard):
    if guard in t: return t
    assert t.count(old) == 1, ('нет/не один фрагмент', tag, t.count(old))
    return t.replace(old, new)

# ---------- viewer.js: init ----------
v = rep(v, "        A.vid = vd; A.vv = 0; A.vT = -1; A.vLast = 0; A.vdata = null;",
        "        A.vid = vd; A.vv = 0; A.vT = -1; A.vLast = 0; A.vdata = null;\n"
        "        if (a.set) { vd.loop = false; vd.preload = a.tap ? 'auto' : 'none'; vd.addEventListener('ended', function () { A.ended = true; }); }   // e1.53 НАБОР: ролик один раз, потом следующий",
        'init-set', 'e1.53 НАБОР: ролик один раз')
INIT = r"""    st.hasWx = all.some(function (a) { return a.wx; });
    // e1.53: наборы роликов (actors[].set), ролик тапа (actors[].tap)
    st.sets = null;
    st.actors.forEach(function (A) {
      var sn = A.cfg.set; if (!sn || !A.vid) return;
      st.sets = st.sets || {}; var SS = st.sets[sn] || (st.sets[sn] = { all: [], cur: null, prev: null, tap: null, k: 0, want: null });
      SS.all.push(A); if (A.cfg.tap) SS.tap = A; A.mx = 0; A.zi = 0; A.ended = false; A.vFresh = false;
    });
    // e1.53 ТОН: дневной кадр куска целиком (здание поверх земли) + карты «ночь/закат ÷ день» (fix18.py tone)
    if (P.tone) {
      var gsrc = r.ground4 || r.ground, gch = r.ground4 ? 4 : 3, pm = r.bldPm, df = new Uint8Array(w * h * 3);
      for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
        var oo = (y0 + yy) * W + x0 + xx, qq = (yy * w + xx) * 3, al = pm[oo * 4 + 3] / 255;
        for (var cc = 0; cc < 3; cc++) df[qq + cc] = Math.min(255, pm[oo * 4 + cc] + gsrc[oo * gch + cc] * (1 - al));
      }
      st.tone = { scale: P.tone.scale || 160, n: null, s: null, x0: x0, y0: y0 }; st.dfull = df;
      var tdir = String(FRAMES[i].color).split('?')[0].replace(/[^\/]*$/, '');
      [['n', P.tone.night], ['s', P.tone.sunset]].forEach(function (q) {
        if (!q[1]) return;
        var im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = function () {
          try { var c3 = document.createElement('canvas'); c3.width = w; c3.height = h; var x3 = c3.getContext('2d', { willReadFrequently: true }); x3.drawImage(im, 0, 0, w, h);
            var dd = x3.getImageData(0, 0, w, h).data, tm = new Uint8Array(w * h * 3); for (var k3 = 0; k3 < w * h; k3++) { tm[k3 * 3] = dd[k3 * 4]; tm[k3 * 3 + 1] = dd[k3 * 4 + 1]; tm[k3 * 3 + 2] = dd[k3 * 4 + 2]; }
            st.tone[q[0]] = tm; st.dirty = true; } catch (e) { logErr('pose tone', e); }
        };
        im.onerror = function () { logErr('pose tone', q[1] + ' не загрузилась'); };
        im.src = tdir + q[1];
      });
    }
    f.poses = st;"""
v = rep(v, "    st.hasWx = all.some(function (a) { return a.wx; });\n    f.poses = st;", INIT, 'init-tone', 'e1.53 ТОН: дневной кадр куска')

# ---------- viewer.js: posesBox + uploadState wrapper ----------
UPW = r"""  // e1.53 ТОН: кусок ночной/закатной картинки под позами — основа, в которую пишется видео набора (ночь = рисунок ночи + (видео − день) × карта)
  function posesBox(P, W, H) {
    var u0 = 1, v0 = 1, u1 = 0, v1 = 0;
    (P.actors || []).forEach(function (a) { u0 = Math.min(u0, a.rect[0]); v0 = Math.min(v0, a.rect[1]); u1 = Math.max(u1, a.rect[2]); v1 = Math.max(v1, a.rect[3]); });
    var x0 = Math.max(0, Math.floor(u0 * W)), y0 = Math.max(0, Math.floor(v0 * H)), x1 = Math.min(W, Math.ceil(u1 * W)), y1 = Math.min(H, Math.ceil(v1 * H));
    return { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0 };
  }
  function uploadState(f, kind, r) {
    safe('pose tone base', function () {
      var P = POSES && POSES[f.idx];
      if (P && P.tone && r && r.full) {
        var bx = posesBox(P, r.w, r.h), c = new Uint8Array(bx.w * bx.h * 3);
        for (var y = 0; y < bx.h; y++) c.set(r.full.subarray(((bx.y0 + y) * r.w + bx.x0) * 3, ((bx.y0 + y) * r.w + bx.x0 + bx.w) * 3), y * bx.w * 3);
        f['pz' + kind] = { d: c, x0: bx.x0, y0: bx.y0, w: bx.w, h: bx.h };
      }
    });
    return uploadState0(f, kind, r);
  }
  function uploadState0(f, kind, r) {   // kind:"""
v = rep(v, "  function uploadState(f, kind, r) {   // kind:", UPW, 'upload', 'e1.53 ТОН: кусок ночной/закатной')

# ---------- viewer.js: setsStep + tone write ----------
SETS = r"""  // e1.53 НАБОР роликов: один идёт, по концу — следующий случайный из подходящих по часам (другой, если есть). Смена — кроссфейд поверх
  // последнего кадра прежнего ролика (оба кончаются/начинаются одной позой); тап — S.want = ролик тапа. Ночью/на закате — только с тоном (poses.tone).
  function setSwitch(S, A, tap) {
    var vd = A.vid;
    if (S.cur === A) { A.ended = false; try { vd.currentTime = 0; } catch (e) {} var p0 = vd.play(); if (p0 && p0.catch) p0.catch(function () {}); return; }   // тот же ролик снова: конец = начало
    if (S.cur) { if (S.cur.vdata && S.cur.mx > 0.5) { if (S.prev && S.prev !== S.cur) { try { S.prev.vid.pause(); } catch (e) {} } S.prev = S.cur; } else { try { S.cur.vid.pause(); } catch (e) {} } }
    S.cur = A; A.ended = false; A.vFresh = false; A.vT = -1; A.mx = 0; A.xf = tap ? 0.35 : (S.prev ? 0.3 : 0.6);
    vd.preload = 'auto'; try { vd.currentTime = 0; } catch (e) {} var pr = vd.play(); if (pr && pr.catch) pr.catch(function () {});
  }
  function setsStep(st, now, dtS, wxRaw, still) {
    for (var nm in st.sets) {
      var S = st.sets[nm], bad = S.all.every(function (A) { return A.vbad; });
      var kT = bad || still ? 0 : (st.tone ? 1 : (1 - sstep(0.06, 0.4, tod.night)) * (1 - tod.sun)) * (1 - wxRaw);   // с тоном — и ночью, и на закате
      S.k = dtS > 0 ? S.k + (kT - S.k) * Math.min(1, dtS / 0.6) : kT; if (Math.abs(S.k - kT) < 0.01) S.k = kT;
      if (S.want) { var wA = S.want; S.want = null; if (!wA.vbad) setSwitch(S, wA, true); }
      var cur = S.cur;
      if (S.k > 0.005 && (!cur || cur.ended || cur.vbad || (cur.vFresh && cur.vid.paused && cur.vid.duration && cur.vid.currentTime >= cur.vid.duration - 0.06))) {
        var el = S.all.filter(function (A) { return !A.cfg.tap && !A.vbad && hourIn(A.cfg.hours, now); });
        var pool = el.length > 1 && cur ? el.filter(function (A) { return A !== cur; }) : el;
        if (pool.length) setSwitch(S, pool[Math.floor(Math.random() * pool.length)], false);
      }
      cur = S.cur;
      S.all.forEach(function (A) {
        var vd = A.vid, isC = A === cur;
        A.zi = isC ? 1 : 0;
        if (isC) { var mt = A.vFresh ? 1 : 0; A.mx = A.xf > 0 && dtS > 0 ? Math.min(mt, A.mx + dtS / A.xf) : mt; }
        if (isC && A.mx >= 1 && S.prev) { try { S.prev.vid.pause(); } catch (e) {} S.prev.mx = 0; S.prev = null; st.dirty = true; }
        var isP = A === S.prev, on = S.k > 0.005 && (isC || isP);
        if (isC && on) {
          if (vd.paused && !A.ended) { var pr = vd.play(); if (pr && pr.catch) pr.catch(function () {}); }
          if (vd.readyState >= 2 && vd.currentTime !== A.vT && now - A.vLast >= 40) {
            try { A.vcx.drawImage(vd, 0, 0, A.vcv.width, A.vcv.height); A.vdata = A.vcx.getImageData(0, 0, A.vcv.width, A.vcv.height).data; A.vT = vd.currentTime; A.vLast = now; A.vFresh = true; st.dirty = true; }
            catch (e) { logErr('video frame', e); A.vbad = true; }
          }
        } else if (!isP && !vd.paused) { try { vd.pause(); } catch (e) {} }
        var pv = A.vv; A.vv = on ? S.k * (isC ? A.mx : 1) : 0;
        if (Math.abs(A.vv - pv) > 0.004) st.dirty = true;
      });
    }
  }
  function poseToneWrite(f, st) {   // e1.53: видео набора — в ночную (nB) и закатную (sB) картинку кадра
    var T = st.tone;
    ['n', 's'].forEach(function (kd) {
      var on = kd === 'n' ? tod.night : tod.sun, B = f['pz' + kd], tex = f[kd + 'B'], R = T[kd];
      if (!(on > 0.002) || !B || !tex || !R || B.w !== st.w || B.h !== st.h || B.x0 !== st.x0 || B.y0 !== st.y0) return;
      var w = st.w, h = st.h, n = w * h * 3, base = B.d, Df = st.dfull, sc = 1 / T.scale, i;
      var acc = T.acc || (T.acc = new Float32Array(n)), out = T.out || (T.out = new Uint8Array(n));
      for (i = 0; i < n; i++) acc[i] = base[i];
      st.actors.filter(function (A) { return A.cfg.set && A.vid; }).sort(function (a, b) { return (a.zi || 0) - (b.zi || 0); }).forEach(function (A) {
        var vdd = A.vdata, vm = A.vmask, k2 = A.vv * (st.hasWx ? 1 - st.wxK : 1); if (!vdd || !vm || k2 <= 0.003) return;
        var vb = A.box, vw = vb[2] - vb[0];
        for (var y = Math.max(0, vb[1]); y < Math.min(h, vb[3]); y++) for (var x = Math.max(0, vb[0]); x < Math.min(w, vb[2]); x++) {
          var p2 = (y - vb[1]) * vw + (x - vb[0]), a2 = vm[p2] / 255 * k2; if (a2 <= 0.002) continue;
          var s2 = p2 * 4, q = (y * w + x) * 3;
          for (var c = 0; c < 3; c++) { var tg = base[q + c] + (vdd[s2 + c] - Df[q + c]) * R[q + c] * sc; acc[q + c] = tg * a2 + acc[q + c] * (1 - a2); }
        }
      });
      for (i = 0; i < n; i++) { var z = acc[i]; out[i] = z < 0 ? 0 : (z > 255 ? 255 : z); }
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, w, h, gl.RGB, gl.UNSIGNED_BYTE, out);
    });
  }
  function posesStep(f, now) {"""
v = rep(v, "  function posesStep(f, now) {", SETS, 'sets', 'e1.53 НАБОР роликов: один идёт')
v = rep(v, "    if (!st.gcT || now - st.gcT > 500) { st.gcT = now; vidsGc(now); }\n",
        "    if (!st.gcT || now - st.gcT > 500) { st.gcT = now; vidsGc(now); }\n    if (st.sets) { st.actors.forEach(function (A) { if (A.cfg.set) A.seen = now; }); setsStep(st, now, dtS, wxRaw, still); }   // e1.53 наборы\n",
        'call-sets', 'e1.53 наборы')
v = rep(v, "      if (!A.vid) return;\n      A.seen = now;\n", "      if (!A.vid) return;\n      A.seen = now;\n      if (A.cfg.set && st.sets) return;   // e1.53: набор — в setsStep\n", 'skip-set', 'e1.53: набор — в setsStep')
v = rep(v, "concat(st.actors.filter(function (A) { return A.vid; }), st.actors.filter(function (A) { return A.cfg.wx; }));   // e1.49",
        "concat(st.actors.filter(function (A) { return A.vid; }).sort(function (a, b) { return (a.zi || 0) - (b.zi || 0); }), st.actors.filter(function (A) { return A.cfg.wx; }));   // e1.49; e1.53: прежний ролик набора — под текущим",
        'order', 'e1.53: прежний ролик набора')
v = rep(v, "      var c = A.cfg, vis = (1 - st.nightK) * (c.wx ?", "      var c = A.cfg, vis = (c.set && st.tone ? 1 : 1 - st.nightK) * (c.wx ?   /* e1.53: с тоном набор и ночью (альфа слоя здания) */", 'vis', 'e1.53: с тоном набор и ночью')
v = rep(v, "    gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, w, h, oc === 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, o);\n  }\n  function uploadDay",
        "    gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, w, h, oc === 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, o);\n    if (st.tone) poseToneWrite(f, st);   // e1.53 ТОН\n  }\n  function uploadDay",
        'tone-call', 'if (st.tone) poseToneWrite(f, st);')

# ---------- viewer.js: tap ----------
TAP = r"""  stage.addEventListener('mouseleave', function () { targetX = 0; targetY = 0; });
  // e1.53 ТАП ПО СОБАКЕ (poses.tap {set, hit}): отпускание ≤ 10 px и ≤ 0,6 с внутри hit (с параллаксом слоя здания) → ролик тапа набора.
  // Кнопки (инфо-точки, панель) — свои обработчики, сюда не попадают; перетаскивание (поворот) — не тап. Курсор-рука только над собакой.
  function poseHitRect(i) {
    var P = POSES && POSES[i], f = store[i]; if (!P || !P.tap || !P.tap.hit || !f) return null;
    var h = P.tap.hit, ld = lastDraw || { shiftX: 0, shiftY: 0, zoom: 0 }, dd = f.dB, kk = f.kB;
    if (useGL && f.bldD) { dd = bldDepthAt(i, (h[0] + h[2]) / 2, (h[1] + h[3]) / 2); kk = dd * 2 - 1; }
    var a = projectImg(h[0], h[1], dd, kk, ld.shiftX, ld.shiftY, ld.zoom, f.crop), b = projectImg(h[2], h[3], dd, kk, ld.shiftX, ld.shiftY, ld.zoom, f.crop);
    return [a[0] * stage.clientWidth, a[1] * stage.clientHeight, b[0] * stage.clientWidth, b[1] * stage.clientHeight];
  }
  function poseTapSet(i) { var P = POSES && POSES[i], f = store[i], st = f && f.poses; return P && P.tap && st && st.sets ? st.sets[P.tap.set] : null; }
  function poseOver(cx, cy) {
    if (!POSES || fade) return false;
    var S = poseTapSet(frameIndex); if (!S || !S.tap || S.k < 0.5) return false;
    var R = poseHitRect(frameIndex), r = stage.getBoundingClientRect(); if (!R) return false;
    var x = cx - r.left, y = cy - r.top; return x >= R[0] && x <= R[2] && y >= R[1] && y <= R[3];
  }
  function poseTap(cx, cy) {
    if (!poseOver(cx, cy)) return false;
    var S = poseTapSet(frameIndex); if (S.cur === S.tap && !S.tap.ended) return true;   // уже реагирует
    S.want = S.tap; return true;
  }
  var tapDown = null, overDog = false;
  stage.addEventListener('pointerdown', function (e) { tapDown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
  stage.addEventListener('pointerup', function (e) {
    var dn = tapDown; tapDown = null; if (!dn || dn.id !== e.pointerId || !POSES) return;
    if (e.target && e.target.closest && e.target.closest('button, a, .hs-dot, #hsPopup')) return;
    if (Math.abs(e.clientX - dn.x) > 10 || Math.abs(e.clientY - dn.y) > 10 || performance.now() - dn.t > 600) return;
    safe('pose tap', function () { poseTap(e.clientX, e.clientY); });
  });
  stage.addEventListener('mousemove', function (e) {
    if (!POSES) return;
    var o = !!safe('pose over', function () { return poseOver(e.clientX, e.clientY); });
    if (o !== overDog) { overDog = o; stage.style.cursor = o ? 'pointer' : ''; }
  });"""
v = rep(v, "  stage.addEventListener('mouseleave', function () { targetX = 0; targetY = 0; });", TAP, 'tap', 'e1.53 ТАП ПО СОБАКЕ')
HOOK = r"""    dog: function (i) { var S = poseTapSet(i == null ? frameIndex : i), st = store[i == null ? frameIndex : i].poses; if (!S) return null; var nm = function (A) { return A ? A.cfg.video : null; };   // e1.53: для снимков — набор роликов кадра
      return { cur: nm(S.cur), prev: nm(S.prev), k: S.k, mx: S.cur ? S.cur.mx : 0, ct: S.cur ? S.cur.vid.currentTime : -1, rs: S.cur ? S.cur.vid.readyState : -1, fresh: S.cur ? !!S.cur.vFresh : false, hit: poseHitRect(i == null ? frameIndex : i), toneN: !!(st.tone && st.tone.n), toneS: !!(st.tone && st.tone.s) }; },
    dogPlay: function (i, k) { var st = store[i] && store[i].poses, A = st && st.actors[k], S = poseTapSet(i); if (S && A && A.cfg.set) { S.want = A; return true; } return false; },
    showv: function (i) {"""
v = rep(v, "    showv: function (i) {", HOOK, 'hook', 'e1.53: для снимков — набор роликов')

# ---------- details.js: blaze ----------
BLAZE = r"""  // e1.53 blaze (D, заход 18): после резьбы буквы разгораются огнём — по карте времени письма, как фитиль (rise с), горят (hold с), гаснут (out с).
  //   Свечение изнутри желобка: маска желобка (тёмное в groove) → тёплый цвет, глубже — желтее; мерцание медленное (сумма синусов) +
  //   «текущий» шум пламени (две мягкие шумовые картинки едут вверх с разной скоростью); мягкий ореол — уменьшенная копия свечения.
  //   Рисуется в слой screen (высветляет пиксели камня), своей краски нет — читается и в темноте. {t0, rise, hold, out, k, halo} — секунды от начала надписи.
  function bzS(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function fxBlaze(it, S, gr, tt, a, bs, a0, dw, dh) {
    var Z = it.blaze, ri = Z.rise || 2, ho = Z.hold == null ? 5 : Z.hold, ou = Z.out || 2.5, e = tt - (Z.t0 || 0);
    if (e <= 0) return;
    var lv = e > ri + ho ? 1 - bzS((e - ri - ho) / ou) : 1; if (lv <= 0.002) return;
    var w = S.w, h = S.h, q;
    if (!S.bz) {
      var gc = wrCanvas(w, h); gc.x.drawImage(gr, 0, 0, w, h); var gd; try { gd = gc.x.getImageData(0, 0, w, h); } catch (er) { return; }
      var dd = gd.data;
      for (q = 0; q < w * h; q++) {
        var L = (dd[q * 4] * 0.3 + dd[q * 4 + 1] * 0.59 + dd[q * 4 + 2] * 0.11) / 255, m = clamp((0.94 - L) * 2.2, 0, 1), m2 = m * m;
        dd[q * 4] = 255 * m; dd[q * 4 + 1] = (70 + 120 * m2 * m2) * m; dd[q * 4 + 2] = (12 + 45 * m2 * m2) * m; dd[q * 4 + 3] = 255;   // глубже — желтее, края — оранжевые
      }
      gc.x.putImageData(gd, 0, 0);
      var nw = 48, nh = 36, nc = wrCanvas(nw, nh), nd = nc.x.createImageData(nw, nh);
      var sd = 1234567;   // шум с постоянным зерном: две копии сайта дают один и тот же огонь (урок s27)
      for (q = 0; q < nw * nh; q++) { sd = (sd * 1103515245 + 12345) % 2147483648; var nv = 115 + sd / 2147483648 * 140; nd.data[q * 4] = nd.data[q * 4 + 1] = nd.data[q * 4 + 2] = nv; nd.data[q * 4 + 3] = 255; }
      nc.x.putImageData(nd, 0, 0);
      var n2 = wrCanvas(nw, nh * 2); n2.x.drawImage(nc.c, 0, 0); n2.x.drawImage(nc.c, 0, nh);   // по вертикали без шва: едет вверх по кругу
      var hs = wrCanvas(Math.max(2, Math.round(w / 48)), Math.max(2, Math.round(h / 48))); hs.x.imageSmoothingEnabled = true; hs.x.drawImage(gc.c, 0, 0, hs.c.width, hs.c.height);
      var hcw = Math.max(2, Math.round(w / 8)), hch = Math.max(2, Math.round(h / 8)), hp = Math.round(hcw * 0.12) + 2, hc = wrCanvas(hcw + 2 * hp, hch + 2 * hp);
      hc.x.imageSmoothingEnabled = true; hc.x.drawImage(hs.c, hp, hp, hcw, hch);
      S.bz = { fc: gc, n2: n2, hc: hc, hp: hp, hcw: hcw, hch: hch, ig: wrCanvas(S.hw, S.hh), o4: wrCanvas(w, h), p: -9 };
      S.bz.igd = S.bz.ig.x.createImageData(S.hw, S.hh);
      for (q = 0; q < S.hw * S.hh; q++) { S.bz.igd.data[q * 4] = S.bz.igd.data[q * 4 + 1] = S.bz.igd.data[q * 4 + 2] = 255; }
    }
    var B = S.bz, fp = e / ri, fq = Math.round(fp * 240) / 240;
    if (fq !== B.p && !(B.p > 1.2 && fq > 1.2)) {   // огонь бежит по надписи в том же порядке, в каком её резали
      B.p = fq; var T = S.T, g2 = B.igd.data, wd = 0.12;
      for (var k = 0, n = T.length; k < n; k++) { var tv = T[k], rr = 0; if (tv < 255) { var ee = (fq * (1 + wd) - tv / 254) / wd; rr = ee <= 0 ? 0 : (ee >= 1 ? 1 : ee * ee * (3 - 2 * ee)); } g2[k * 4 + 3] = rr * 255; }
      B.ig.x.putImageData(B.igd, 0, 0);
    }
    var o = B.o4.x, fl = 0.84 + 0.09 * Math.sin(tt * 2.3) + 0.07 * Math.sin(tt * 3.9 + 1.3), f1 = (tt * 0.22) % 1, f2 = (tt * 0.13 + 0.5) % 1;
    o.save(); o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1; o.clearRect(0, 0, w, h); o.drawImage(B.fc.c, 0, 0);
    o.imageSmoothingEnabled = true; o.globalCompositeOperation = 'multiply';
    o.globalAlpha = 0.85; o.drawImage(B.n2.c, 0, -f1 * h, w, 2 * h);
    o.globalAlpha = 0.6; o.drawImage(B.n2.c, -0.15 * w, -f2 * h * 1.3, 1.3 * w, 2.6 * h);
    o.globalCompositeOperation = 'destination-in'; o.globalAlpha = 1; o.drawImage(B.ig.c, 0, 0, w, h); o.restore();
    var sx = dw / B.hcw, sy = dh / B.hch, kk = a * lv * fl * (Z.k == null ? 1 : Z.k), kh = a * lv * fl * (Z.halo == null ? 0.5 : Z.halo) * clamp(fp, 0, 1);
    for (; kk > 0.002; kk -= 1) { bs.globalAlpha = Math.min(1, kk); bs.drawImage(B.o4.c, a0[0], a0[1], dw, dh); }   // k > 1 — ярче: слой ещё раз (lighter складывает)
    for (; kh > 0.002; kh -= 1) { bs.globalAlpha = Math.min(1, kh); bs.drawImage(B.hc.c, a0[0] - B.hp * sx, a0[1] - B.hp * sy, (B.hcw + 2 * B.hp) * sx, (B.hch + 2 * B.hp) * sy); }
  }
  function fxCarve(it, tt, len, a) {"""
d = rep(d, "  function fxCarve(it, tt, len, a) {", BLAZE, 'blaze', 'e1.53 blaze (D, заход 18)')
d = rep(d, "    bs.globalAlpha = clamp(a * (Wr.front == null ? 0.9 : Wr.front), 0, 1); bs.drawImage(S.o3.c, a0[0], a0[1], dw, dh);\n    bd.restore(); bs.restore();",
        "    bs.globalAlpha = clamp(a * (Wr.front == null ? 0.9 : Wr.front), 0, 1); bs.drawImage(S.o3.c, a0[0], a0[1], dw, dh);\n    if (it.blaze) fxBlaze(it, S, gr, tt, a, bs, a0, dw, dh);   // e1.53: огонь букв\n    bd.restore(); bs.restore();",
        'blaze-call', 'e1.53: огонь букв')

# ---------- schema ----------
s = rep(s, "optional=('srcs', 'every', 'fade', 'night', 'order', 'note', 'video', 'mask', 'wx', 'hours'))",
        "optional=('srcs', 'every', 'fade', 'night', 'order', 'note', 'video', 'mask', 'wx', 'hours', 'set', 'tap'))   # e1.53: set — набор роликов, tap — ролик тапа",
        'act-opt', "'hours', 'set', 'tap'))")
s = rep(s, "                        if ao and 'hours' in ao:   # e1.52",
        "                        if ao and ('set' in ao or 'tap' in ao):   # e1.53\n"
        "                            if not (isinstance(ao.get('set'), str) and ao['set'] and 'video' in ao): c.err(wa + '.set', 'set — имя набора, только у видео-актёра')\n"
        "                            if 'tap' in ao: c.boolean(ao['tap'], wa + '.tap')\n"
        "                        if ao and 'hours' in ao:   # e1.52",
        'act-set', "set — имя набора, только у видео-актёра")
s = rep(s, "            po = c.obj(fr['poses'], '%s: poses' % w, required=('actors',), optional=('layer',))\n            if po:\n",
        "            po = c.obj(fr['poses'], '%s: poses' % w, required=('actors',), optional=('layer', 'tone', 'tap'))   # e1.53: tone, tap\n            if po:\n"
        "                if 'tone' in po:   # e1.53: {night, sunset: vid_*_tone.png, scale}\n"
        "                    to = c.obj(po['tone'], '%s: poses.tone' % w, required=(), optional=('night', 'sunset', 'scale', 'note'))\n"
        "                    if to:\n"
        "                        for q in ('night', 'sunset'):\n"
        "                            if q in to:\n"
        "                                if not (isinstance(to[q], str) and to[q].startswith('vid_') and to[q].endswith('_tone.png')): c.err('%s: poses.tone.%s' % (w, q), 'карта vid_*_tone.png')\n"
        "                                elif isinstance(b.get('framesDir'), str): c.file(posixpath.join(b['framesDir'], to[q]), '%s: poses.tone.%s' % (w, q), 'карта')\n"
        "                        if 'scale' in to: c.number(to['scale'], '%s: poses.tone.scale' % w, 1, 255)\n"
        "                if 'tap' in po:   # e1.53: {set, hit:[u0,v0,u1,v1]}\n"
        "                    tp = c.obj(po['tap'], '%s: poses.tap' % w, required=('set', 'hit'), optional=('note',))\n"
        "                    if tp:\n"
        "                        if c.numbers(tp['hit'], '%s: poses.tap.hit' % w, 4, 0, 1) and not (tp['hit'][0] < tp['hit'][2] and tp['hit'][1] < tp['hit'][3]): c.err('%s: poses.tap.hit' % w, '[u0, v0, u1, v1]')\n"
        "                        if not any(isinstance(a, dict) and a.get('set') == tp['set'] and a.get('tap') for a in po.get('actors') or []): c.err('%s: poses.tap' % w, 'в наборе нет ролика с tap: true')\n",
        'poses-opt', "optional=('layer', 'tone', 'tap'))")
s = rep(s, "                        wr = c.obj(it.get('write', {}), wl + '.write', required=(), optional=('t0', 'dur', 'soft', 'front'))\n",
        "                        wr = c.obj(it.get('write', {}), wl + '.write', required=(), optional=('t0', 'dur', 'soft', 'front'))\n"
        "                        if 'blaze' in it:   # e1.53: огонь букв\n"
        "                            bz = c.obj(it['blaze'], wl + '.blaze', required=(), optional=('t0', 'rise', 'hold', 'out', 'k', 'halo'))\n"
        "                            if bz:\n"
        "                                for q, lo, hi in (('t0', 0, 60), ('rise', 0.1, 30), ('hold', 0, 60), ('out', 0.1, 30), ('k', 0, 3), ('halo', 0, 3)):\n"
        "                                    if q in bz: c.number(bz[q], '%s.blaze.%s' % (wl, q), lo, hi)\n",
        'blaze-schema', "e1.53: огонь букв")
# ---------- build_pages ----------
bp = rep(bp, "+ list(fdir.glob('vid_*_mask.png'))):", "+ list(fdir.glob('vid_*_mask.png')) + list(fdir.glob('vid_*_tone.png'))):   # e1.53: карты тона видео-собаки", 'bp', "vid_*_tone.png'))):")
V.write_text(v); D.write_text(d); S.write_text(s); BP.write_text(bp)
Path('engine/VERSION').write_text('e1.53\n')
print('ok')
