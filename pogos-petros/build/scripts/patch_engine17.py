#!/usr/bin/env python3
"""Заход 17 (e1.52):
- viewer.js showVideo.keep: у слоя здания без «стирания по подложке» — пиксель видео, отличный от рисунка, просто ложится ПОВЕРХ слоя здания
  (фаэтон C: был в слое земли — здание перекрывало всё, кроме низа у дороги).
- viewer.js poses: actors[].hours [ч0, ч1] — актёр живёт только в эти часы по часам зрителя (через полночь — ч0 > ч1); ?hour=8 — подмена для проверки.
  Собака B: утро — потягивается и ест из миски, день — сидит и смотрит по сторонам, вечер/ночь — спит. На «Закате» видео гаснет (закатный рисунок).
- details.js letters.carve.time (+ write {t0, dur, soft, front}): надпись D одной картинкой на слой (гомография по 4 углам поля, insc17.py),
  пишется штрихами слева направо по карте времени, без мерцания; на острие — светлый свежий скол, гаснет.
- schema: hours, keep, carve.time/write.
Повторный запуск ничего не меняет (метки-охраны)."""
from pathlib import Path
V = Path('engine/viewer.js'); D = Path('engine/details.js'); S = Path('tools/building_schema.py')
v = V.read_text(); d = D.read_text(); s = S.read_text()

def rep(t, old, new, tag, guard=None):
    if (guard and guard in t) or (not guard and new in t): return t
    assert t.count(old) == 1, ('нет/не один фрагмент', tag, t.count(old))
    return t.replace(old, new)

# ---------- viewer.js: showVideo.keep ----------
v = rep(v, "    if (S.diff && bld) { gref = new Uint8Array(w * h * 3);",
        "    if (S.diff && bld && !S.keep) { gref = new Uint8Array(w * h * 3);   // e1.52 keep: без стирания здания по подложке — видео только ПОВЕРХ слоя здания (фаэтон C)\n      ",
        'keep', guard='e1.52 keep')
v = rep(v, "  // Кадр: \"showVideo\": {rect:[u0,v0,u1,v1], video:\"vid_<имя>.mp4\", mask:\"vid_<имя>_mask.png\", layer:\"bld\"|\"bg\", t:[с0,с1], fade:[вход,выход]}.",
        "  // Кадр: \"showVideo\": {rect:[u0,v0,u1,v1], video:\"vid_<имя>.mp4\", mask:\"vid_<имя>_mask.png\", layer:\"bld\"|\"bg\", t:[с0,с1], fade:[вход,выход], diff:[lo,hi], keep}.\n  // e1.52 keep (с diff, слой здания): здание не стирается там, где видео = подложка — отличие видео ложится поверх здания (фаэтон C виден целиком).",
        'keepdoc', guard='e1.52 keep (с diff')

# ---------- viewer.js: poses hours ----------
HOURS = """  // e1.52 ЧАСЫ ЗРИТЕЛЯ для актёров поз: actors[].hours [ч0, ч1) по местному времени (ч0 > ч1 — через полночь). ?hour=8 — подмена (проверка, снимки).
  var HOUR_Q = (function () { try { var m = /[?&]hour=(\\d+(?:\\.\\d+)?)/.exec(location.search); return m ? +m[1] : null; } catch (e) { return null; } })();
  var hourNow = { t: -1e9, h: 12 };
  function clockHour(now) {
    if (HOUR_Q != null) return HOUR_Q;
    if (!(now - hourNow.t < 1000)) { var dt = new Date(); hourNow.h = dt.getHours() + dt.getMinutes() / 60; hourNow.t = now || 0; }
    return hourNow.h;
  }
  function hourIn(hr, now) { if (!hr) return true; var x = clockHour(now); return hr[0] <= hr[1] ? (x >= hr[0] && x < hr[1]) : (x >= hr[0] || x < hr[1]); }
  var POSES = CONFIG.POSES || null;"""
v = rep(v, "  var POSES = CONFIG.POSES || null;", HOURS, 'hours', guard='e1.52 ЧАСЫ ЗРИТЕЛЯ')
v = rep(v, "        document.body.appendChild(vd); vd.src = dir + (vd.canPlayType('video/mp4; codecs=\"avc1.4d401f\"') ? a.video : a.video.replace(/\\.mp4$/, '.webm'));   // нет H.264 — запасной WebM",
        "        if (a.hours && !hourIn(a.hours, performance.now())) vd.preload = 'none';   // e1.52: не его часы — не грузить заранее\n        document.body.appendChild(vd); vd.src = dir + (vd.canPlayType('video/mp4; codecs=\"avc1.4d401f\"') ? a.video : a.video.replace(/\\.mp4$/, '.webm'));   // нет H.264 — запасной WebM",
        'preload', guard="e1.52: не его часы")
v = rep(v, "      var tgt = A.vbad ? 0 : (1 - sstep(0.06, 0.4, tod.night)) * (1 - wxRaw) * (still ? 0 : 1), pv = A.vv;",
        "      var tgt = A.vbad ? 0 : (1 - sstep(0.06, 0.4, tod.night)) * (1 - wxRaw) * (still ? 0 : 1) * (hourIn(A.cfg.hours, now) ? 1 : 0) * (1 - tod.sun), pv = A.vv;   // e1.52: часы зрителя; на закате — закатный рисунок",
        'tgt', guard='e1.52: часы зрителя; на закате')

# ---------- details.js: write ----------
WRITE = r"""  // e1.52 write (D, заход 17): надпись пишется штрихами слева направо, как резьба. Одна картинка на слой на всю надпись (pogos-petros/build/scripts/insc17.py:
  //   гомография по 4 углам поля над дверью, ×3 к кадру — без «лесенки» при уменьшении): groove — multiply, light — screen,
  //   time — когда пиксель «вырезан» (0..254 — доля времени письма: буква за буквой, внутри буквы — по штриху от её левой точки; 255 — пусто).
  //   Без мерцания: открытое стоит; на острие резца камень чуть светлее (свежий скол) и гаснет. write: {t0 с, dur с, soft доля, front}.
  var wrS = {};
  function wrCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return { c: c, x: c.getContext('2d') }; }
  function fxWrite(it, tt, len, a) {
    var C = it.carve, Wr = it.write || {}, fe = V.entry(par.fr), gr = spImg(par.fr, C.groove), li = spImg(par.fr, C.light), tm = spImg(par.fr, C.time);
    if (!fe || !gr || !li || !tm) return;
    var key = par.fr + ':' + C.time, S = wrS[key];
    if (!S) {
      var w = tm.width, h = tm.height, hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
      var tc = wrCanvas(hw, hh); tc.x.imageSmoothingEnabled = false; tc.x.drawImage(tm, 0, 0, hw, hh);   // без сглаживания: время у края буквы не смешивается с «пусто»
      var td; try { td = tc.x.getImageData(0, 0, hw, hh).data; } catch (e) { return; }
      var T = new Uint8Array(hw * hh); for (var q = 0; q < T.length; q++) T[q] = td[q * 4];
      S = wrS[key] = { T: T, w: w, h: h, hw: hw, hh: hh, mk: wrCanvas(hw, hh), fk: wrCanvas(hw, hh), o1: wrCanvas(w, h), o2: wrCanvas(w, h), o3: wrCanvas(w, h), p: -9 };
      S.mi = S.mk.x.createImageData(hw, hh); S.fi = S.fk.x.createImageData(hw, hh);
      for (q = 0; q < T.length; q++) { S.mi.data[q * 4] = S.mi.data[q * 4 + 1] = S.mi.data[q * 4 + 2] = 255; S.fi.data[q * 4] = S.fi.data[q * 4 + 1] = S.fi.data[q * 4 + 2] = 255; }
    }
    var dur = Wr.dur || 7, soft = Wr.soft || 0.025, p = (tt - (Wr.t0 || 0)) / dur, pq = Math.round(p * 600) / 600;
    if (pq !== S.p && !(S.p > 1 + soft * 6 && p > 1 + soft * 6)) {   // карта открытия меняется только пока идёт письмо
      S.p = pq; var T2 = S.T, md = S.mi.data, fd = S.fi.data, sf = 1 / soft, ff = 1 / (soft * 5);
      for (var k = 0, n = T2.length; k < n; k++) {
        var tv = T2[k], r = 0, f = 0;
        if (tv < 255) { var e = pq - tv / 254; r = e <= 0 ? 0 : (e >= soft ? 1 : e * sf); f = e <= 0 ? 0 : Math.max(0, 1 - e * ff) * r; }
        md[k * 4 + 3] = r * 255; fd[k * 4 + 3] = f * 255;
      }
      S.mk.x.putImageData(S.mi, 0, 0); S.fk.x.putImageData(S.fi, 0, 0);
      [[S.o1, gr, S.mk], [S.o2, li, S.mk], [S.o3, li, S.fk]].forEach(function (L) {
        var o = L[0].x; o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, S.w, S.h); o.drawImage(L[1], 0, 0, S.w, S.h);
        o.globalCompositeOperation = 'destination-in'; o.imageSmoothingEnabled = true; o.drawImage(L[2].c, 0, 0, S.w, S.h); o.globalCompositeOperation = 'source-over';
      });
    }
    if (p <= 0) return;
    var R = it.rect, a0 = spP(fe, R[0], R[1], it.bld), a1 = spP(fe, R[2], R[3], it.bld), dw = a1[0] - a0[0], dh = a1[1] - a0[1];
    var bd = blendLayer('multiply'), bs = blendLayer('screen'); bd.save(); bs.save();
    bd.globalCompositeOperation = 'multiply'; bs.globalCompositeOperation = 'lighter';
    bd.globalAlpha = clamp(a, 0, 1); bd.drawImage(S.o1.c, a0[0], a0[1], dw, dh);
    bs.globalAlpha = clamp(a * (it.lightK == null ? 1 : it.lightK), 0, 1); bs.drawImage(S.o2.c, a0[0], a0[1], dw, dh);
    bs.globalAlpha = clamp(a * (Wr.front == null ? 0.9 : Wr.front), 0, 1); bs.drawImage(S.o3.c, a0[0], a0[1], dw, dh);
    bd.restore(); bs.restore();
  }
"""
d = rep(d, "  function fxCarve(it, tt, len, a) {\n    var C = it.carve,", WRITE + "  function fxCarve(it, tt, len, a) {\n    if (it.carve.time) return fxWrite(it, tt, len, a);   // e1.52: пишется штрихами по карте времени\n    var C = it.carve,", 'write', guard='e1.52 write (D, заход 17)')
d = rep(d, "[it.src, it.mask, it.dark, it.fire, it.glow, it.hole].concat(it.carve ? [it.carve.groove, it.carve.light, it.carve.ember1, it.carve.ember2] : [],",
        "[it.src, it.mask, it.dark, it.fire, it.glow, it.hole].concat(it.carve ? [it.carve.groove, it.carve.light, it.carve.ember1, it.carve.ember2, it.carve.time] : [],", 'preload', guard='it.carve.ember2, it.carve.time')

# ---------- schema ----------
s = rep(s, "optional=('srcs', 'every', 'fade', 'night', 'order', 'note', 'video', 'mask', 'wx'))   # e1.49: video/mask — живое место Veo, wx — погодная версия",
        "optional=('srcs', 'every', 'fade', 'night', 'order', 'note', 'video', 'mask', 'wx', 'hours'))   # e1.49: video/mask — живое место Veo, wx — погодная версия; e1.52: hours\n                        if ao and 'hours' in ao:   # e1.52: часы зрителя [ч0, ч1) (через полночь — ч0 > ч1)\n                            c.numbers(ao['hours'], wa + '.hours', 2, 0, 24)",
        'hours', guard="e1.52: часы зрителя [ч0")
s = rep(s, "optional=('layer', 't', 'fade', 'diff', 'note'))", "optional=('layer', 't', 'fade', 'diff', 'note', 'keep'))", 'keep', guard="'diff', 'note', 'keep'")
s = rep(s, "                if 'diff' in sv:   # e1.50: [lo, hi] — разница с рисунком (0..255), с которой берётся пиксель видео\n",
        "                if 'keep' in sv:   # e1.52: здание не стирается по подложке (только с diff у слоя здания)\n                    c.boolean(sv['keep'], '%s: showVideo.keep' % w)\n                    if sv['keep'] and (sv.get('layer', 'bld') != 'bld' or 'diff' not in sv): c.err('%s: showVideo.keep' % w, 'keep — только у слоя здания с diff')\n                if 'diff' in sv:   # e1.50: [lo, hi] — разница с рисунком (0..255), с которой берётся пиксель видео\n",
        'keep2', guard="e1.52: здание не стирается по подложке")
s = rep(s, """                    for kk in ('rect', 'size', 'cells') + (() if 'carve' in it else ('dark', 'fire', 'glow')):   # e1.51: carve — резьба (атласы fix16.py insc)
                        if kk not in it: c.err(wl, 'letters: нет %s' % kk)
                    if 'carve' in it:""",
"""                    wmode = isinstance(it.get('carve'), dict) and 'time' in it['carve']   # e1.52: пишется по карте времени (insc17.py) — без клеток
                    for kk in ('rect', 'size') + (() if wmode else ('cells',)) + (() if 'carve' in it else ('dark', 'fire', 'glow')):   # e1.51: carve — резьба (атласы fix16.py insc)
                        if kk not in it: c.err(wl, 'letters: нет %s' % kk)
                    if wmode:
                        cv = it['carve']
                        if not all(isinstance(cv.get(q), str) and cv[q].startswith('show_') for q in ('groove', 'light', 'time')):
                            c.err(wl + '.carve', '{groove, light, time} — картинки show_*')
                        elif isinstance(b.get('framesDir'), str):
                            for q in ('groove', 'light', 'time'): c.file(posixpath.join(b['framesDir'], cv[q]), '%s.carve.%s' % (wl, q), 'картинка')
                        wr = c.obj(it.get('write', {}), wl + '.write', required=(), optional=('t0', 'dur', 'soft', 'front'))
                        if wr:
                            for q, lo, hi in (('t0', 0, 60), ('dur', 0.5, 60), ('soft', 0.001, 0.5), ('front', 0, 2)):
                                if q in wr: c.number(wr[q], '%s.write.%s' % (wl, q), lo, hi)
                    elif 'carve' in it:""", 'schema-write', guard="e1.52: пишется по карте времени (insc17.py)")

# ---------- viewer.js: showVideo.eraseV ----------
# Стирание здания «по подложке» (e1.50/51) — только выше eraseV (доля кадра, горизонт подложки): ниже горизонта подложка помечена небом
# (карта окружения) — стёртая стена B синела пятнами в полуденной обработке. Ниже горизонта видео просто пишется поверх (там неба нет).
v = rep(v, "    st.overlap = !!(P && (P.actors || []).some(",
        "    st.eraseRow = S.eraseV == null ? 1e9 : Math.round(S.eraseV * H) - y0;   // e1.52 eraseV: стирать здание по подложке только выше этой строки кадра\n    st.overlap = !!(P && (P.actors || []).some(",
        'eraseRow', guard='e1.52 eraseV: стирать')
v = rep(v, "      if (gr) { var dg = Math.max(",
        "      if (gr && p < st.eraseRow * st.w) { var dg = Math.max(",
        'eraseUse', guard='if (gr && p < st.eraseRow * st.w)')
s = rep(s, "optional=('layer', 't', 'fade', 'diff', 'note', 'keep'))", "optional=('layer', 't', 'fade', 'diff', 'note', 'keep', 'eraseV'))", 'eraseV', guard="'keep', 'eraseV'")
s = rep(s, "                if 'keep' in sv:   # e1.52: здание не стирается по подложке (только с diff у слоя здания)\n",
        "                if 'eraseV' in sv:   # e1.52: стирание здания по подложке — только выше этой доли кадра (горизонт подложки)\n                    c.number(sv['eraseV'], '%s: showVideo.eraseV' % w, 0, 1)\n                if 'keep' in sv:   # e1.52: здание не стирается по подложке (только с diff у слоя здания)\n",
        'eraseV2', guard="e1.52: стирание здания по подложке — только выше")
V.write_text(v); D.write_text(d); S.write_text(s)
Path('engine/VERSION').write_text('e1.52\n')
print('ok')
