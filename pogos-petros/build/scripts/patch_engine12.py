#!/usr/bin/env python3
"""Заход 12 (e1.47): листья на ветру из рисунков Gemini (frames[].leafFly), шоу C «гроза» (kind storm — шейдер: тон сцены и быстрый ручей;
картинки шоу — steady/hole; дождь — flakes с angle). Повторный запуск ничего не меняет. Ленин/Кукурузник: настроек нет — поведение прежнее."""
from pathlib import Path
V = Path('engine/viewer.js'); D = Path('engine/details.js')
v = V.read_text(); d = D.read_text()

def rep(s, old, new, tag):
    if new in s: return s
    assert s.count(old) == 1, ('нет/не один фрагмент', tag, s.count(old))
    return s.replace(old, new)

# --- viewer: шоу storm (вид 6): тон сцены к грозовому рисунку (видно в «окне» ручья), ручей бежит быстрее (show.y — интеграл проявления, с)
v = rep(v, "      '      float ph = s - P.z * t;',",
        "      '      float ph = s - P.z * (t + (show.x > 5.5 && show.x < 6.5 ? 1.6 * show.y : 0.0));',   // e1.47: в грозу ручей бежит быстрее", 'flow storm')
v = rep(v, "  } else if (show.x > 4.5 && show.x < 5.5) {',   // e1.43 cinema",
        "  } else if (show.x > 5.5 && show.x < 6.5) {',   // e1.47 storm (C): сцена в тон грозового рисунка Gemini (сам рисунок — картинкой шоу поверх, ручей виден в её «окне»)\n"
        "      '    c = mix(c, c * vec3(0.50, 0.56, 0.70), e);',\n"
        "      '  } else if (show.x > 4.5 && show.x < 5.5) {',   // e1.43 cinema", 'showGrade storm')

# --- details: storm в SHK; интеграл проявления для ручья
d = rep(d, "      var SHK = { sunset: 1, candles: 2, dusk: 3, doorlight: 4, cinema: 5 };",
        "      var SHK = { sunset: 1, candles: 2, dusk: 3, doorlight: 4, cinema: 5, storm: 6 };   // e1.47 storm (C): тон сцены + быстрый ручей", 'SHK')
d = rep(d, "      if (SHK[it.kind]) par.shade = { fr: par.fr, kind: SHK[it.kind], t: tt, len: len, a: a };",
        "      if (SHK[it.kind]) par.shade = { fr: par.fr, kind: SHK[it.kind], t: it.kind === 'storm' ? fxInteg(tt, len, fd) : tt, len: len, a: a };   // e1.47: storm — t = интеграл проявления (ручей ускоряется и замедляется без скачка)", 'shade t')
d = rep(d, "  function fxR(i, k) {",
        "  function fxInteg(tt, len, fd) {   // e1.47: ∫ проявления шоу (вход fd[0], выход fd[1]) от 0 до tt, с\n"
        "    var f0 = Math.max(fd[0], 1e-3), f1 = Math.max(fd[1], 1e-3);\n"
        "    if (tt < f0) return tt * tt / (2 * f0);\n"
        "    if (tt < len - f1) return tt - f0 / 2;\n"
        "    var r = Math.max(0, len - tt); return len - f0 / 2 - f1 / 2 - r * r / (2 * f1);\n"
        "  }\n"
        "  function fxR(i, k) {", 'fxInteg')
# картинки шоу: steady (без «дыхания» альфы), hole (маска-окно: где сцена видна сквозь картинку — ручей в грозу)
d = rep(d, "      [it.src, it.mask, it.dark, it.fire, it.glow]", "      [it.src, it.mask, it.dark, it.fire, it.glow, it.hole]", 'preload hole')
d = rep(d, "    var nn = wts().n;\n    if (nn > 0.02) {",
        "    var nn = wts().n, hl = it.hole ? spImg(par.fr, it.hole) : null; if (it.hole && !hl) return;\n    if (nn > 0.02 || hl) {", 'hole cond')
d = rep(d, "      nx.globalCompositeOperation = 'source-atop'; nx.fillStyle = 'rgba(28,38,72,' + (0.62 * nn).toFixed(3) + ')'; nx.fillRect(0, 0, tw, th); im = fxNightC;",
        "      if (nn > 0.02) { nx.globalCompositeOperation = 'source-atop'; nx.fillStyle = 'rgba(28,38,72,' + (0.62 * nn).toFixed(3) + ')'; nx.fillRect(0, 0, tw, th); }\n"
        "      if (hl) { nx.globalCompositeOperation = 'destination-out'; nx.drawImage(hl, 0, 0, tw, th); }   // e1.47 hole: окно в картинке шоу — там живая сцена\n"
        "      nx.globalCompositeOperation = 'source-over'; im = fxNightC;", 'hole draw')
d = rep(d, "    ctx.save(); ctx.globalAlpha = clamp(ae * (it.alpha || 0.8) * (0.9 + 0.1 * Math.sin(tt * 2.1)) * (1 - 0.25 * nn), 0, 1);",
        "    ctx.save(); ctx.globalAlpha = clamp(ae * (it.alpha || 0.8) * (it.steady ? 1 : 0.9 + 0.1 * Math.sin(tt * 2.1)) * (1 - 0.25 * nn), 0, 1);   // e1.47 steady — без «дыхания»", 'steady')
# дождь: flakes с angle — без вращения, под углом, сносит ветром (wind)
d = rep(d, "      spDraw(ims[i % ims.length], x, y, sz * fh, t * (0.6 + r3) * (r1 < 0.5 ? 1 : -1), false);",
        "      spDraw(ims[i % ims.length], x, y, sz * fh, it.angle != null ? it.angle : t * (0.6 + r3) * (r1 < 0.5 ? 1 : -1), false);   // e1.47 angle: струи дождя — косо, без вращения", 'angle')

# --- details: листья на ветру — frames[].leafFly
d = rep(d, "    if (SC(fr).snowFall && V.weather) {",
        "    if (SC(fr).leafFly) leafStep(fr, f, SC(fr).leafFly, now);   // e1.47: в порыв ветра листья (рисунки Gemini) срываются с крон и улетают\n"
        "    if (SC(fr).snowFall && V.weather) {", 'leaf call')
d = rep(d, "  var flkSt = {};",
        "  // e1.47 leafFly (Погос-Петрос A/B/C): {srcs — листья Gemini (show_leaf_*.png), from:[[u0,v0,u1,v1]…] кроны, n:[тихо, буря] листьев на порыв, h:[мин,макс] доля\n"
        "  //   высоты кадра, drift доля ширины/с в порыв, fall доля высоты/с}. Начало порыва (wx.gRise) — гроздь листьев срывается с крон, летит по ветру\n"
        "  //   (слева направо), кружится (поворот + «переворот» сжатием по ширине), уходит за край. Только днём, без снега и не во время шоу кадра.\n"
        "  var lfS = {};\n"
        "  function leafStep(fr, f, it, now) {\n"
        "    var wq = V.weather ? V.weather() : null, S = lfS[fr] || (lfS[fr] = { L: [], rise: 0, last: now }); if (!wq) return;\n"
        "    var dt = Math.min(0.1, Math.max(0, (now - S.last) / 1000)); S.last = now;\n"
        "    var ims = (it.srcs || []).map(function (s) { return spImg(fr, s); }); if (!ims.some(Boolean)) return;\n"
        "    var ok = wts().n < 0.35 && !(wq.cur && wq.cur[3] > 0.02) && !(par && par.fr === fr);\n"
        "    if (wq.gRise && wq.gRise !== S.rise) {\n"
        "      S.rise = wq.gRise;\n"
        "      if (ok) {\n"
        "        var nr = it.n || [2, 6], lv = clamp(((wq.gLevel || 0.6) - 0.6) / 0.4, 0, 1), k = Math.round(lerp(nr[0], nr[1], lv) * (0.7 + 0.6 * Math.random()));\n"
        "        for (var j = 0; j < k && S.L.length < 24; j++) {\n"
        "          var B = it.from[Math.floor(Math.random() * it.from.length)], hh = it.h || [0.012, 0.02];\n"
        "          S.L.push({ u: lerp(B[0], B[2], Math.random()), v: lerp(B[1], B[3], Math.random()), vu: 0, vv: 0, t0: now + j * (120 + Math.random() * 380),\n"
        "            im: Math.floor(Math.random() * ims.length), h: lerp(hh[0], hh[1], Math.random()), rot: Math.random() * 6.28, spin: (Math.random() < 0.5 ? -1 : 1) * (1.5 + 3 * Math.random()),\n"
        "            fl: 2.5 + 3 * Math.random(), ph: Math.random() * 6.28 });\n"
        "        }\n"
        "      }\n"
        "    }\n"
        "    if (!S.L.length) return;\n"
        "    var fh = Math.abs(P(0, 1, 0)[1] - P(0, 0, 0)[1]), wE = (wq.windEff || wq.wind || 1), g = wq.gust || 0;\n"
        "    ctx.save();\n"
        "    for (var i = S.L.length - 1; i >= 0; i--) {\n"
        "      var L = S.L[i]; if (now < L.t0) continue;\n"
        "      var t = (now - L.t0) / 1000;\n"
        "      L.vu += ((it.drift || 0.14) * (0.35 + 1.1 * g) * wE - L.vu) * Math.min(1, dt * 1.6);\n"
        "      L.vv += ((it.fall || 0.03) * (1 - 0.6 * g) - L.vv) * Math.min(1, dt * 0.9);\n"
        "      L.u += (L.vu + 0.025 * Math.sin(t * 2.3 + L.ph)) * dt; L.v += (L.vv + 0.02 * Math.cos(t * L.fl + L.ph)) * dt;\n"
        "      if (L.u > 1.08 || L.u < -0.08 || L.v > 1.04 || t > 14) { S.L.splice(i, 1); continue; }\n"
        "      var im = ims[L.im] || ims.find(Boolean); if (!im) continue;\n"
        "      var p = P(L.u, L.v, 0), hp = L.h * fh, a = clamp(t / 0.25, 0, 1) * (ok ? 1 : clamp(1 - (now - (S.off || now)) / 600, 0, 1)) * nightK();\n"
        "      ctx.globalAlpha = clamp(a, 0, 1);\n"
        "      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(L.rot + L.spin * t); ctx.scale(0.25 + 0.75 * Math.abs(Math.cos(t * L.fl * 0.7 + L.ph)), 1);\n"
        "      var wp = hp * im.width / im.height; ctx.drawImage(im, -wp / 2, -hp / 2, wp, hp); ctx.restore();\n"
        "    }\n"
        "    if (!ok && !S.off) S.off = now; if (ok) S.off = 0;\n"
        "    ctx.restore();\n"
        "  }\n"
        "  var flkSt = {};", 'leafStep')

V.write_text(v); D.write_text(d)
Path('engine/VERSION').write_text('e1.47\n')
print('ok')
