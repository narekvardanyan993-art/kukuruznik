#!/usr/bin/env python3
"""Заход 15 (e1.50): видео-шоу кадра — frames[].showVideo {rect, video, mask, layer, t:[с0,с1], fade:[вход,выход]}.
Видео Veo (колокол и голуби A, снос и «отмотка» B, фаэтон C) по мягкой маске смешивается с рисунком в куске текстуры слоя
(как видео-актёры e1.49, но своим куском и быстрым путём: базовые пиксели копией, смешивание только по пикселям маски).
Время видео = секунда шоу − с0 (Details.fxClock); при «заморозке» шоу (снимки) видео ставится на ту же секунду.
Видео грузится лениво (первый показ кадра). Пока шоу-видео видно и перекрывает позы кадра — позы не пишут в текстуру.
Повторный запуск ничего не меняет. Ленин/Кукурузник: showVideo нет — поведение прежнее."""
from pathlib import Path
V = Path('engine/viewer.js'); D = Path('engine/details.js'); B = Path('tools/build_pages.py'); S = Path('tools/building_schema.py')
v = V.read_text(); d = D.read_text(); b = B.read_text(); s = S.read_text()

def rep(t, old, new, tag, guard=None):
    if new in t or (guard and guard in t): return t   # уже применено (guard — метка, которая остаётся и после следующих правок того же места)
    assert t.count(old) == 1, ('нет/не один фрагмент', tag, t.count(old))
    return t.replace(old, new)

SHOWV = r"""  // ---------- e1.50 ВИДЕО-ШОУ КАДРА (Погос-Петрос, заход 15) ----------
  // Кадр: "showVideo": {rect:[u0,v0,u1,v1], video:"vid_<имя>.mp4", mask:"vid_<имя>_mask.png", layer:"bld"|"bg", t:[с0,с1], fade:[вход,выход]}.
  // Видео Veo из самого рисунка (первый кадр = рисунок) по маске смешивается с рисунком в куске текстуры слоя — те же параллакс и обработка.
  // Время видео = секунда шоу − с0; заморозка шоу (снимки) ставит видео на ту же секунду. Ленивая загрузка, без звука, не по кругу.
  var SHOWVID = CONFIG.SHOWVID || null;
  function showvInit(f, r, i) {
    var S = SHOWVID[i]; if (!S || !S.video) return;
    var W = r.w, H = r.h, x0 = Math.max(0, Math.floor(S.rect[0] * W)), y0 = Math.max(0, Math.floor(S.rect[1] * H)), x1 = Math.min(W, Math.ceil(S.rect[2] * W)), y1 = Math.min(H, Math.ceil(S.rect[3] * H));
    var w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
    var bld = S.layer !== 'bg', src = bld ? r.bldPm : (r.ground4 || r.ground), ch = bld || r.ground4 ? 4 : 3;
    var base = new Uint8Array(w * h * ch);
    for (var y = 0; y < h; y++) base.set(src.subarray(((y0 + y) * W + x0) * ch, ((y0 + y) * W + x0 + w) * ch), y * w * ch);
    var st = { cfg: S, x0: x0, y0: y0, w: w, h: h, bld: bld, ch: ch, base: base, out: new Uint8Array(w * h * ch), vis: 0, vT: -1, vLast: 0, vdata: null, idx: null, al: null, dirty: false, active: false };
    var P = POSES && POSES[i];   // перекрывает ли кусок шоу кусок поз кадра
    st.overlap = !!(P && (P.actors || []).some(function (a) { return a.rect[0] < S.rect[2] && a.rect[2] > S.rect[0] && a.rect[1] < S.rect[3] && a.rect[3] > S.rect[1]; }));
    var dir = String(FRAMES[i].color).split('?')[0].replace(/[^\/]*$/, '');
    var vd = document.createElement('video'); vd.muted = true; vd.defaultMuted = true; vd.loop = false; vd.playsInline = true; vd.preload = 'none'; vd.crossOrigin = 'anonymous';
    vd.setAttribute('muted', ''); vd.setAttribute('playsinline', ''); vd.setAttribute('webkit-playsinline', '');
    vd.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(vd); st.vsrc = dir + (vd.canPlayType('video/mp4; codecs="avc1.4d401f"') ? S.video : S.video.replace(/\.mp4$/, '.webm'));
    vd.addEventListener('error', function () { if (vd.getAttribute('src')) { logErr('show video', S.video + ' не загрузилось'); st.vbad = true; } });
    st.vid = vd; st.vcv = document.createElement('canvas'); st.vcv.width = w; st.vcv.height = h; st.vcx = st.vcv.getContext('2d', { willReadFrequently: true });
    var mi = new Image(); mi.crossOrigin = 'anonymous';
    mi.onload = function () {
      try {
        var c2 = document.createElement('canvas'); c2.width = w; c2.height = h; var x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(mi, 0, 0, w, h);
        var dd = x2.getImageData(0, 0, w, h).data, n = 0, q; for (q = 0; q < w * h; q++) if (dd[q * 4] > 2) n++;
        var idx = new Int32Array(n), al = new Float32Array(n), k = 0; for (q = 0; q < w * h; q++) if (dd[q * 4] > 2) { idx[k] = q; al[k] = dd[q * 4] / 255; k++; }
        st.idx = idx; st.al = al;
      } catch (e) { logErr('show video mask', e); }
    };
    mi.onerror = function () { logErr('show video mask', S.mask + ' не загрузилась'); st.vbad = true; };
    mi.src = dir + S.mask;
    f.showv = st;
  }
  function showvStep(f, now) {
    var st = f && f.showv; if (!st) return;
    var ck = null; try { ck = window.Details && window.Details.fxClock ? window.Details.fxClock(now) : null; } catch (e) { ck = null; }
    var C = st.cfg, T = C.t || [0, 600], fd = C.fade || [0.6, 0.8], vd = st.vid, on = !!(ck && ck.fr === f.idx), tgt = 0, want = 0;
    if (on && !st.vsrcSet) { st.vsrcSet = true; vd.preload = 'auto'; vd.src = st.vsrc; try { vd.load(); } catch (e) {} }   // ленивая загрузка: первый показ
    if (on) {
      var t1 = Math.min(T[1], ck.len), kin = clamp((ck.t - T[0]) / Math.max(0.01, fd[0]), 0, 1), kout = clamp((t1 - ck.t) / Math.max(0.01, fd[1]), 0, 1);
      tgt = sstep(0, 1, Math.min(kin, kout)) * (1 - ck.kill); want = ck.t - T[0];
    }
    if (st.vbad || reduced()) tgt = 0;
    if (tgt > 0.001 && st.vsrcSet) {
      var dur = vd.duration || 0, tw = clamp(want, 0, Math.max(0, dur - 0.05));
      if (vd.readyState >= 1) {
        if (ck.frozen) { if (!vd.paused) { try { vd.pause(); } catch (e) {} } if (!vd.seeking && Math.abs(vd.currentTime - tw) > 0.02) vd.currentTime = tw; }
        else {
          if (vd.paused && want < dur - 0.05) { var pr = vd.play(); if (pr && pr.catch) pr.catch(function () {}); }
          if (!vd.seeking && Math.abs(vd.currentTime - tw) > 0.35) vd.currentTime = tw;
        }
      }
      if (vd.readyState >= 2 && !vd.seeking && vd.currentTime !== st.vT && now - st.vLast >= 40) {
        try { st.vcx.drawImage(vd, 0, 0, st.w, st.h); st.vdata = st.vcx.getImageData(0, 0, st.w, st.h).data; st.vT = vd.currentTime; st.vLast = now; st.dirty = true; }
        catch (e) { logErr('show video frame', e); st.vbad = true; }
      }
    } else if (!vd.paused) { try { vd.pause(); } catch (e) {} }
    if (tgt <= 0.001 && !on) { st.vdata = st.vdata && st.vis > 0 ? st.vdata : null; st.vT = -1; }
    var vis = st.vdata && st.idx ? Math.round(tgt * 50) / 50 : 0;
    if (vis !== st.vis) { st.vis = vis; st.dirty = true; }
    if (!st.dirty) return;
    st.dirty = false;
    var o = st.out, ch = st.ch, vdd = st.vdata, idx = st.idx, al = st.al;
    o.set(st.base);
    if (vis > 0) for (var k = 0, n = idx.length; k < n; k++) {
      var p = idx[k], a = al[k] * vis, b1 = 1 - a, s4 = p * 4, q = p * ch;
      o[q] = vdd[s4] * a + o[q] * b1; o[q + 1] = vdd[s4 + 1] * a + o[q + 1] * b1; o[q + 2] = vdd[s4 + 2] * a + o[q + 2] * b1;
      if (st.bld) o[q + 3] = 255 * a + o[q + 3] * b1;   // текстура здания — цвет умножен на альфу (видео непрозрачно)
    }
    gl.bindTexture(gl.TEXTURE_2D, st.bld ? f.bldTex : f.bgTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, st.x0, st.y0, st.w, st.h, ch === 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, o);
    var was = st.active; st.active = vis > 0;
    if (was && !st.active && f.poses) f.poses.dirty = true;   // шоу кончилось: позы снова пишут свой кусок
  }
"""
v = rep(v, "  var VIDS = [];   // e1.49:", SHOWV + "  var VIDS = [];   // e1.49:", 'showv funcs', guard='e1.50 ВИДЕО-ШОУ КАДРА')
v = rep(v, "return up.then(function () { if (useGL && POSES && POSES[i]) safe('poses', function () { posesInit(entry, r, i); });",
        "return up.then(function () { if (useGL && POSES && POSES[i]) safe('poses', function () { posesInit(entry, r, i); }); if (useGL && SHOWVID && SHOWVID[i]) safe('showv', function () { showvInit(entry, r, i); });", 'init hook')
v = rep(v, "      if (POSES && !glLost) safe('poses', function () { posesStep(fa, now); if (fb) posesStep(fb, now); });   // e1.44: позы фигур рисунка",
        "      if (SHOWVID && !glLost) safe('showv', function () { showvStep(fa, now); if (fb) showvStep(fb, now); });   // e1.50: видео-шоу кадра\n"
        "      if (POSES && !glLost) safe('poses', function () { [fa, fb].forEach(function (f) { if (f && !(f.showv && f.showv.active && f.showv.overlap)) posesStep(f, now); }); });   // e1.44: позы фигур рисунка (e1.50: не под видео-шоу)", 'step hook')
# снимки: __viewer.showv() — состояние видео-шоу текущего кадра
d = rep(d, "      return { fr: par.fr, t: (n - par.t0) / 1000, len: par.dur / 1000, kill: par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0 };",
        "      return { fr: par.fr, t: (n - par.t0) / 1000, len: par.dur / 1000, kill: par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0, frozen: par.fix != null };   // e1.50: frozen — видео-шоу ставится на ту же секунду", 'fxClock frozen')
b = rep(b, "    if any(f.get('poses') for f in fr):   # e1.44:",
        "    if any(f.get('showVideo') for f in fr):   # e1.50: видео-шоу кадра (только если задано у кадров)\n        C['SHOWVID'] = [f.get('showVideo') for f in fr]\n    if any(f.get('poses') for f in fr):   # e1.44:", 'build SHOWVID')
s = rep(s, "'poses', 'snowFall', 'leafFly', 'wx'))", "'poses', 'snowFall', 'leafFly', 'wx', 'showVideo'))", 'schema frame keys')
s = rep(s, "        if 'leafFly' in fr:       # e1.47:",
"""        if 'showVideo' in fr:     # e1.50: видео-шоу кадра {rect, video, mask, layer, t:[с0,с1], fade:[вход,выход]}
            sv = c.obj(fr['showVideo'], '%s: showVideo' % w, required=('rect', 'video', 'mask'), optional=('layer', 't', 'fade', 'note'))
            if sv:
                if c.numbers(sv['rect'], '%s: showVideo.rect' % w, 4, 0, 1) and not (sv['rect'][0] < sv['rect'][2] and sv['rect'][1] < sv['rect'][3]):
                    c.err('%s: showVideo.rect' % w, '[u0, v0, u1, v1]: u0 < u1, v0 < v1')
                for key, suf in (('video', '.mp4'), ('mask', '_mask.png')):
                    if not (isinstance(sv[key], str) and sv[key].startswith('vid_') and sv[key].endswith(suf)):
                        c.err('%s: showVideo.%s' % (w, key), 'файл vid_*' + suf)
                    elif isinstance(b.get('framesDir'), str):
                        c.file(posixpath.join(b['framesDir'], sv[key]), '%s: showVideo.%s' % (w, key), 'файл')
                if sv.get('layer', 'bld') not in ('bld', 'bg'):
                    c.err('%s: showVideo.layer' % w, 'bld или bg')
                if 't' in sv:
                    c.numbers(sv['t'], '%s: showVideo.t' % w, 2, 0, 600)
                if 'fade' in sv:
                    c.numbers(sv['fade'], '%s: showVideo.fade' % w, 2, 0, 10)
                if fr.get('parade') != 'fx':
                    c.err('%s: showVideo' % w, 'видео-шоу только у кадра с "parade": "fx"')
        if 'leafFly' in fr:       # e1.47:""", 'schema showVideo', guard="if 'showVideo' in fr:")
V.write_text(v); D.write_text(d); B.write_text(b); S.write_text(s)
Path('engine/VERSION').write_text('e1.50\n')
print('ok')
# --- e1.50: погодная версия может быть отдельной для дождя и снега (wx: "rain" | "snow"; true — любая непогода, как в e1.49)
v = V.read_text(); s = S.read_text()
v = rep(v, "    if (wk !== st.wxK) { st.wxK = wk; st.dirty = true; }",
        "    if (wk !== st.wxK) { st.wxK = wk; st.dirty = true; }\n"
        "    var wS = typeof wx !== 'undefined' ? Math.round(sstep(0.04, 0.6, wx.cur[3]) * 20) / 20 : 0, wR = typeof wx !== 'undefined' ? Math.round(sstep(0.04, 0.6, wx.cur[2]) * (1 - wS) * 20) / 20 : 0;   // e1.50: снег важнее дождя\n"
        "    if (wS !== st.wxS || wR !== st.wxR) { st.wxS = wS; st.wxR = wR; st.dirty = true; }", 'wxR wxS')
v = rep(v, "var c = A.cfg, vis = (1 - st.nightK) * (c.wx ? st.wxK : (st.hasWx ? 1 - st.wxK : 1)); if (vis <= 0) return;",
        "var c = A.cfg, vis = (1 - st.nightK) * (c.wx ? (c.wx === 'rain' ? st.wxR : (c.wx === 'snow' ? st.wxS : st.wxK)) : (st.hasWx ? 1 - st.wxK : 1)); if (vis <= 0) return;   // e1.50: wx \"rain\" / \"snow\" — своя версия", 'wx vis')
s = rep(s, "                        if 'wx' in ao:\n                            c.boolean(ao['wx'], wa + '.wx')",
        "                        if 'wx' in ao and ao['wx'] not in (True, False, 'rain', 'snow'):   # e1.50: своя версия для дождя / снега\n                            c.err(wa + '.wx', 'true, false, \"rain\" или \"snow\"')", 'schema wx')
V.write_text(v); S.write_text(s); print('ok2')
# --- для снимков: __viewer.showv(кадр) — состояние видео-шоу (видимость, readyState, время)
v = V.read_text()
v = rep(v, "    frame: function () { return frameIndex; }, fading:",
        "    showv: function (i) { var st = store[i] && store[i].showv; return st ? { vis: st.vis, active: st.active, rs: st.vid.readyState, ct: st.vid.currentTime, dur: st.vid.duration, src: st.vid.currentSrc, mask: st.idx ? st.idx.length : -1, vT: st.vT, bad: !!st.vbad } : null; },   // e1.50: для снимков — состояние видео-шоу кадра\n"
        "    frame: function () { return frameIndex; }, fading:", 'viewer showv')
V.write_text(v); print('ok3')
# --- diff: [lo, hi] — пиксель видео берётся, только если он отличается от рисунка (макс. разница каналов lo→hi плавно):
#     небо и стены, которые Veo «не тронул», остаются пикселями рисунка (полуденная обработка неба слоя земли, без «оранжевой полосы»)
v = V.read_text(); s = S.read_text()
v = rep(v, "    var st = { cfg: S, x0: x0, y0: y0, w: w, h: h, bld: bld, ch: ch, base: base, out: new Uint8Array(w * h * ch), vis: 0,",
        "    var ref = null;   // e1.50 diff: рисунок в рамке (здание поверх земли) — с ним сравнивается кадр видео\n"
        "    if (S.diff) { var gs = r.ground4 || r.ground, gc = r.ground4 ? 4 : 3; ref = new Uint8Array(w * h * 3); for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) { var oo = (y0 + yy) * W + x0 + xx, rq = (yy * w + xx) * 3, ab = bld ? r.bldPm[oo * 4 + 3] / 255 : 0; for (var cc = 0; cc < 3; cc++) ref[rq + cc] = (bld ? r.bldPm[oo * 4 + cc] : 0) + gs[oo * gc + cc] * (1 - ab); } }\n"
        "    var st = { cfg: S, x0: x0, y0: y0, w: w, h: h, bld: bld, ch: ch, base: base, ref: ref, dlo: S.diff ? S.diff[0] : 0, dk: S.diff ? 1 / Math.max(1, S.diff[1] - S.diff[0]) : 0, out: new Uint8Array(w * h * ch), vis: 0,", 'showv ref', guard='e1.50 diff: рисунок в рамке')
v = rep(v, "      var p = idx[k], a = al[k] * vis, b1 = 1 - a, s4 = p * 4, q = p * ch;\n",
        "      var p = idx[k], a = al[k] * vis, s4 = p * 4, q = p * ch;\n"
        "      if (rf) { var p3 = p * 3, dv = Math.max(Math.abs(vdd[s4] - rf[p3]), Math.abs(vdd[s4 + 1] - rf[p3 + 1]), Math.abs(vdd[s4 + 2] - rf[p3 + 2])), kd = (dv - st.dlo) * st.dk; if (kd <= 0) continue; if (kd < 1) a *= kd * kd * (3 - 2 * kd); }   // e1.50 diff\n"
        "      var b1 = 1 - a;\n", 'showv diff blend', guard='// e1.50 diff\n')
v = rep(v, "    var o = st.out, ch = st.ch, vdd = st.vdata, idx = st.idx, al = st.al;",
        "    var o = st.out, ch = st.ch, vdd = st.vdata, idx = st.idx, al = st.al, rf = st.ref;", 'showv rf var', guard='rf = st.ref')
s = rep(s, "optional=('layer', 't', 'fade', 'note'))", "optional=('layer', 't', 'fade', 'diff', 'note'))", 'schema diff key')
s = rep(s, "                if 'fade' in sv:\n                    c.numbers(sv['fade'], '%s: showVideo.fade' % w, 2, 0, 10)",
        "                if 'fade' in sv:\n                    c.numbers(sv['fade'], '%s: showVideo.fade' % w, 2, 0, 10)\n                if 'diff' in sv:   # e1.50: [lo, hi] — разница с рисунком (0..255), с которой берётся пиксель видео\n                    c.numbers(sv['diff'], '%s: showVideo.diff' % w, 2, 0, 255)", 'schema diff')
V.write_text(v); S.write_text(s); print('ok4')
# --- diff у слоя здания: где видео совпало с подложкой (земля/небо за зданием) — слой здания становится прозрачным, а не красится видео
#     (снос B: на месте церкви видна сама подложка с полуденной обработкой неба)
v = V.read_text()
v = rep(v, "    var ref = null;   // e1.50 diff: рисунок в рамке (здание поверх земли) — с ним сравнивается кадр видео\n",
        "    var ref = null, gref = null;   // e1.50 diff: рисунок в рамке (здание поверх земли) — с ним сравнивается кадр видео; gref — подложка (слой земли)\n", 'gref decl')
v = rep(v, "for (var cc = 0; cc < 3; cc++) ref[rq + cc] = (bld ? r.bldPm[oo * 4 + cc] : 0) + gs[oo * gc + cc] * (1 - ab); } }\n",
        "for (var cc = 0; cc < 3; cc++) ref[rq + cc] = (bld ? r.bldPm[oo * 4 + cc] : 0) + gs[oo * gc + cc] * (1 - ab); } }\n"
        "    if (S.diff && bld) { gref = new Uint8Array(w * h * 3); for (var y3 = 0; y3 < h; y3++) for (var x3 = 0; x3 < w; x3++) { var o3 = (y0 + y3) * W + x0 + x3, g3 = (y3 * w + x3) * 3; gref[g3] = gs[o3 * gc]; gref[g3 + 1] = gs[o3 * gc + 1]; gref[g3 + 2] = gs[o3 * gc + 2]; } }\n", 'gref fill')
v = rep(v, "base: base, ref: ref,", "base: base, ref: ref, gref: gref,", 'gref st')
v = rep(v, "      var b1 = 1 - a;\n      o[q] = vdd[s4] * a + o[q] * b1;",
        "      var b1 = 1 - a, ke = 1;\n"
        "      if (gr) { var dg = Math.max(Math.abs(vdd[s4] - gr[p * 3]), Math.abs(vdd[s4 + 1] - gr[p * 3 + 1]), Math.abs(vdd[s4 + 2] - gr[p * 3 + 2])), kg = (dg - st.dlo) * st.dk; ke = kg <= 0 ? 0 : (kg >= 1 ? 1 : kg * kg * (3 - 2 * kg)); }   // e1.50: видео = подложка → здание прозрачно\n"
        "      if (ke < 1) { o[q] = vdd[s4] * a * ke + o[q] * b1; o[q + 1] = vdd[s4 + 1] * a * ke + o[q + 1] * b1; o[q + 2] = vdd[s4 + 2] * a * ke + o[q + 2] * b1; o[q + 3] = 255 * a * ke + o[q + 3] * b1; continue; }\n"
        "      o[q] = vdd[s4] * a + o[q] * b1;", 'gref blend')
v = rep(v, "al = st.al, rf = st.ref;", "al = st.al, rf = st.ref, gr = st.gref;", 'gr var')
V.write_text(v); print('ok5')
