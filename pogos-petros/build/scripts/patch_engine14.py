#!/usr/bin/env python3
"""Заход 14 (e1.49): живые места из видео Veo и погодные версии в позах (frames[].poses.actors):
- актёр {rect, video: "vid_<имя>.mp4", mask: "vid_<имя>_mask.png"} — видео (muted playsinline loop, петля уже бесшовная) по мягкой маске
  смешивается с рисунком в куске текстуры слоя (как позы, texSubImage2D, ≤ 25 обновлений/с); ночью, в дождь/снег и при «Уменьшить движение» — плавно
  гаснет (видео на паузе, виден рисунок); не текущий кадр — пауза;
- актёр {rect, srcs:[картинка], wx: true} — погодная версия (правка Gemini «тот же кадр в непогоду»): проявляется вместе с дождём/снегом,
  остальные актёры кадра (позы, видео) в непогоду гаснут.
Повторный запуск ничего не меняет. Ленин/Кукурузник: поз нет — поведение прежнее."""
from pathlib import Path
V = Path('engine/viewer.js'); B = Path('tools/build_pages.py'); S = Path('tools/building_schema.py')
v = V.read_text(); b = B.read_text(); s = S.read_text()

def rep(t, old, new, tag):
    if new in t: return t
    assert t.count(old) == 1, ('нет/не один фрагмент', tag, t.count(old))
    return t.replace(old, new)

# --- posesInit: видео и маска у актёра
v = rep(v, "      st.actors.push(A);\n    });\n    f.poses = st;",
"""      if (a.video) {   // e1.49: живое место из видео Veo — <video> (без звука, по кругу), кадры видео смешиваются с рисунком по маске
        var dir = String(FRAMES[i].color).split('?')[0].replace(/[^\\/]*$/, ''), bw2 = A.box[2] - A.box[0], bh2 = A.box[3] - A.box[1];
        var vd = document.createElement('video'); vd.muted = true; vd.defaultMuted = true; vd.loop = true; vd.playsInline = true; vd.preload = 'auto'; vd.crossOrigin = 'anonymous';
        vd.setAttribute('muted', ''); vd.setAttribute('playsinline', ''); vd.setAttribute('webkit-playsinline', '');
        vd.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
        document.body.appendChild(vd); vd.src = dir + (vd.canPlayType('video/mp4; codecs="avc1.4d401f"') ? a.video : a.video.replace(/\\.mp4$/, '.webm'));   // нет H.264 — запасной WebM
        A.vid = vd; A.vv = 0; A.vT = -1; A.vLast = 0; A.vdata = null;
        A.vcv = document.createElement('canvas'); A.vcv.width = bw2; A.vcv.height = bh2; A.vcx = A.vcv.getContext('2d', { willReadFrequently: true });
        if (a.mask) {
          var mi = new Image(); mi.crossOrigin = 'anonymous';
          mi.onload = function () { try { var c2 = document.createElement('canvas'); c2.width = bw2; c2.height = bh2; var x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(mi, 0, 0, bw2, bh2); var dd = x2.getImageData(0, 0, bw2, bh2).data, mm = new Uint8Array(bw2 * bh2); for (var q2 = 0; q2 < mm.length; q2++) mm[q2] = dd[q2 * 4]; A.vmask = mm; } catch (e) { logErr('video mask', e); } };
          mi.onerror = function () { logErr('video mask', a.mask + ' не загрузилась'); };
          mi.src = dir + a.mask;
        }
        vd.addEventListener('error', function () { logErr('video', a.video + ' не загрузилось'); A.vbad = true; });
        VIDS.push(A);
      }
      st.actors.push(A);
    });
    st.hasWx = all.some(function (a) { return a.wx; });
    f.poses = st;""", 'posesInit video')

v = rep(v, "  function poseRnd(a, b) { return a + Math.random() * (b - a); }",
"""  var VIDS = [];   // e1.49: актёры-видео всех кадров (пауза, когда кадр не на экране)
  function vidsGc(now) {
    VIDS.forEach(function (A) { if (A.vid && !A.vid.paused && now - (A.seen || 0) > 400) { try { A.vid.pause(); } catch (e) {} } });
  }
  function poseRnd(a, b) { return a + Math.random() * (b - a); }""", 'VIDS')

# --- posesStep: непогода, видео
v = rep(v, "    if (nk !== st.nightK) { st.nightK = nk; st.dirty = true; }\n    st.actors.forEach(function (A) {\n      var c = A.cfg,",
"""    if (nk !== st.nightK) { st.nightK = nk; st.dirty = true; }
    var wxRaw = typeof wx !== 'undefined' ? sstep(0.04, 0.6, Math.max(wx.cur[2], wx.cur[3])) : 0, wk = Math.round(wxRaw * 20) / 20;   // e1.49: непогода (дождь/снег) 0..1
    if (wk !== st.wxK) { st.wxK = wk; st.dirty = true; }
    var dtS = st.lastT ? Math.min(0.25, t - st.lastT) : 0; st.lastT = t;
    if (!st.gcT || now - st.gcT > 500) { st.gcT = now; vidsGc(now); }
    st.actors.forEach(function (A) {
      if (!A.vid) return;
      A.seen = now;
      var tgt = A.vbad ? 0 : (1 - sstep(0.06, 0.4, tod.night)) * (1 - wxRaw) * (still ? 0 : 1), pv = A.vv;
      A.vv = dtS > 0 ? A.vv + (tgt - A.vv) * Math.min(1, dtS / 0.6) : tgt; if (Math.abs(A.vv - tgt) < 0.01) A.vv = tgt;
      if (Math.abs(A.vv - pv) > 0.004) st.dirty = true;
      var vd = A.vid;
      if (A.vv > 0.005) {
        if (vd.paused) { var pr = vd.play(); if (pr && pr.catch) pr.catch(function () {}); }
        if (vd.readyState >= 2 && vd.currentTime !== A.vT && now - A.vLast >= 40) {
          try { A.vcx.drawImage(vd, 0, 0, A.vcv.width, A.vcv.height); A.vdata = A.vcx.getImageData(0, 0, A.vcv.width, A.vcv.height).data; A.vT = vd.currentTime; A.vLast = now; st.dirty = true; }
          catch (e) { logErr('video frame', e); A.vbad = true; }
        }
      } else if (!vd.paused) { try { vd.pause(); } catch (e) {} }
    });
    st.actors.forEach(function (A) {
      if (A.vid) return;
      var c = A.cfg,""", 'posesStep video head')

v = rep(v, "    st.actors.forEach(function (A) {\n      var c = A.cfg, vis = 1 - st.nightK; if (vis <= 0) return;",
"""    st.actors.forEach(function (A) {
      var c = A.cfg, vis = (1 - st.nightK) * (c.wx ? st.wxK : (st.hasWx ? 1 - st.wxK : 1)); if (vis <= 0) return;   // e1.49: погодная версия — в непогоду, остальные актёры — в ясную
      if (A.vid) {   // e1.49: кадр видео по маске
        var vdd = A.vdata, vm = A.vmask, k2 = A.vv * (st.hasWx ? 1 - st.wxK : 1); if (!vdd || !vm || k2 <= 0.003) return;
        var vb = A.box, vw = vb[2] - vb[0];
        for (var y2 = Math.max(0, vb[1]); y2 < Math.min(h, vb[3]); y2++) for (var x2 = Math.max(0, vb[0]); x2 < Math.min(w, vb[2]); x2++) {
          var p2 = (y2 - vb[1]) * vw + (x2 - vb[0]), a2 = vm[p2] / 255 * k2; if (a2 <= 0.002) continue;
          var s2 = p2 * 4, q3 = (y2 * w + x2) * 4;
          acc[q3] = vdd[s2] * a2 + acc[q3] * (1 - a2); acc[q3 + 1] = vdd[s2 + 1] * a2 + acc[q3 + 1] * (1 - a2); acc[q3 + 2] = vdd[s2 + 2] * a2 + acc[q3 + 2] * (1 - a2);
          if (st.bld) acc[q3 + 3] = 255 * a2 + acc[q3 + 3] * (1 - a2);
        }
        return;
      }""", 'posesStep video blend')
# погодные версии — поверх всех (порядок актёров: обычные → видео → погода)
v = rep(v, "    var acc = new Float32Array(n * 4);\n    for (i = 0; i < n; i++) { acc[i * 4] = b[i * 4];",
"""    var acc = new Float32Array(n * 4), ordA = st.actors.filter(function (A) { return !A.cfg.wx && !A.vid; }).concat(st.actors.filter(function (A) { return A.vid; }), st.actors.filter(function (A) { return A.cfg.wx; }));   // e1.49
    for (i = 0; i < n; i++) { acc[i * 4] = b[i * 4];""", 'order')
v = rep(v, "    st.actors.forEach(function (A) {\n      var c = A.cfg, vis = (1 - st.nightK)", "    ordA.forEach(function (A) {\n      var c = A.cfg, vis = (1 - st.nightK)", 'order use')
# видео идёт — обновлять кусок ~25 раз в секунду
v = rep(v, "      if (A.mix < 1 && A.prev !== A.cur) busy = true;\n    });",
"      if (A.mix < 1 && A.prev !== A.cur) busy = true;\n    });\n    if (st.actors.some(function (A) { return A.vid && A.vv > 0.005; })) busy = true;   // e1.49: видео идёт", 'busy video')

# --- build_pages: копировать видео и маски
for ln in ("list(fdir.glob('show_*.png'))):", ):
    b = rep(b, "list(fdir.glob('show_*.png'))):", "list(fdir.glob('show_*.png')) + list(fdir.glob('vid_*.mp4')) + list(fdir.glob('vid_*.webm')) + list(fdir.glob('vid_*_mask.png'))):", 'build copy beta')

# --- schema: video/mask/wx у актёра
s = rep(s, "ao = c.obj(a, wa, required=('rect', 'srcs'), optional=('every', 'fade', 'night', 'order', 'note'))",
        "ao = c.obj(a, wa, required=('rect',), optional=('srcs', 'every', 'fade', 'night', 'order', 'note', 'video', 'mask', 'wx'))   # e1.49: video/mask — живое место Veo, wx — погодная версия", 'schema actor keys')
s = rep(s, "                        if not (isinstance(ao['srcs'], list) and ao['srcs'] and all(",
"""                        if 'video' in ao:   # e1.49
                            if not (isinstance(ao['video'], str) and ao['video'].startswith('vid_') and ao['video'].endswith('.mp4')):
                                c.err(wa + '.video', 'видео vid_*.mp4')
                            elif isinstance(b.get('framesDir'), str):
                                c.file(posixpath.join(b['framesDir'], ao['video']), wa + '.video', 'видео')
                            if not (isinstance(ao.get('mask'), str) and ao['mask'].startswith('vid_') and ao['mask'].endswith('_mask.png')):
                                c.err(wa + '.mask', 'у видео нужна маска vid_*_mask.png')
                            continue
                        if 'wx' in ao:
                            c.boolean(ao['wx'], wa + '.wx')
                        if not (isinstance(ao.get('srcs'), list) and ao['srcs'] and all(""", 'schema video check')
s = rep(s, "all(s is None or (isinstance(s, str) and s.startswith('show_') and s.endswith('.png')) for s in ao['srcs'])):",
        "all(s is None or (isinstance(s, str) and s.startswith('show_') and s.endswith('.png')) for s in ao.get('srcs') or [])):", 'schema srcs get')
V.write_text(v); B.write_text(b); S.write_text(s); print('ok')
