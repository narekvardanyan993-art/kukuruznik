#!/usr/bin/env python3
"""Заход 11 (e1.46): правки движка по iPhone-проверке Погос-Петроса. Запуск один раз из корня репо; повторный запуск ничего не меняет.
Всё новое — только у здания с настройкой (Ленин/Кукурузник: SWAY_SOFT нет, snowFall нет, kind letters нет, pix у них нет)."""
from pathlib import Path
V = Path('engine/viewer.js'); D = Path('engine/details.js')
v = V.read_text(); d = D.read_text()

def rep(s, old, new, tag):
    if new in s: return s
    assert s.count(old) == 1, ('нет/не один фрагмент', tag, s.count(old))
    return s.replace(old, new)

# 1) nglow / glow: фаза огня — плавный шум вместо клеток floor(qp/P.z) (ночью были «квадраты» 22 px)
v = rep(v, "'      float h = h21(floor(qp / P.z)), ph = h * 6.2832;',\n      '      float fl = 0.55 * sin(t * P.y * 6.1 + ph) + 0.30 * sin(t * P.y * 10.3 + ph * 2.3) + 0.15 * sin(t * P.y * 17.9 + ph * 4.1);',",
        "'      float ph = wxNoise(qp / (P.z * 3.0)) * 6.2832, ph2 = wxNoise(qp / (P.z * 2.0) + 31.7) * 6.2832;',   // e1.46: фаза — плавный шум, без клеток («квадраты» света ночью, iPhone e1.45)\n      '      float fl = 0.55 * sin(t * P.y * 6.1 + ph) + 0.30 * sin(t * P.y * 10.3 + ph2) + 0.15 * sin(t * P.y * 17.9 + ph + ph2);',", 'nglow')
v = rep(v, "'      float h = h21(floor(qp / P.z));',\n      '      gain *= 1.0 + m * (P.x",
        "'      float h = wxNoise(qp / (P.z * 2.0));',   // e1.46: плавно, без клеток\n      '      gain *= 1.0 + m * (P.x", 'glow')

# 2) SWAY_SOFT: крона качается сдвигом выборки внутри мягкой маски кроны (R поля), фон вне маски не двигается
v = rep(v, "  var SWAY = !!(GUSTS && GUSTS.swayMaxPx > 0 && FRAMES.some(function (f) { return f.sway; }));",
        "  var SWAY = !!(GUSTS && GUSTS.swayMaxPx > 0 && FRAMES.some(function (f) { return f.sway; }));\n"
        "  // e1.46 SWAY_SOFT (tuning, Погос-Петрос): поле качания = мягкая маска кроны (R) + высота (B) + фаза (A). Пиксель берёт цвет из p − A·маска:\n"
        "  // крона сдвигается целиком, край маски мягкий (сдвиг → 0), фон вне маски не двигается и не тянется. Без настройки — режим e1.26 (Ленин).\n"
        "  var SWAY_SOFT = SWAY && !!CONFIG.SWAY_SOFT;", 'swaysoft var')
old_sway = "    SWAY ? [   // e1.26: крона тянется по ветру, наветренный край стоит, фон не двигается (см. SWAY выше)\n"
new_sway = ("    SWAY_SOFT ? [   // e1.46: сдвиг только внутри мягкой маски кроны (см. SWAY_SOFT)\n"
            "      '  if (uWindOn > 0.5) {',\n"
            "      '    vec4 s0 = swayF(depth, p);',\n"
            "      '    if (s0.r > 0.004) { p.x -= swayA(s0, p.x) * s0.r; env = envT(depth, p); }',\n"
            "      '  }'\n"
            "    ].join('\\n') : SWAY ? [   // e1.26: крона тянется по ветру, наветренный край стоит, фон не двигается (см. SWAY выше)\n")
v = rep(v, old_sway, new_sway, 'sway shader')

# 3) позы: ночью выключены плавно (день → ночь), ночью — только ночной рисунок
v = rep(v, "    var t = now / 1000, still = reduced(), nk = tod.night > 0.5 ? 1 : 0, busy = false;",
        "    var t = now / 1000, still = reduced(), nk = Math.round(sstep(0.06, 0.4, tod.night) * 20) / 20, busy = false;   // e1.46: позы гаснут к ночи плавно (все актёры): ночью — только ночной рисунок", 'poses nk')
v = rep(v, "      var c = A.cfg, vis = c.night === false ? 1 - st.nightK : 1; if (vis <= 0) return;",
        "      var c = A.cfg, vis = 1 - st.nightK; if (vis <= 0) return;   // e1.46: и старик/пара — дневные пиксели поверх ночи давали шов", 'poses vis')

# 4) details: снегопад картинками Gemini при погоде «снег» (кадры со snowFall), снежинки входят сверху (не появляются посреди экрана), ветер сносит
d = rep(d, "  function flakesDraw(fr, f, it, now, dens, key) {\n    var ims = (it.srcs || []).map(function (s) { return spImg(fr, s); }).filter(Boolean); if (!ims.length) return;\n    var A = it.area || [0, 0, 1, 1], n = Math.round((it.n || 20) * clamp(dens, 0, 1)), hh = it.h || [0.006, 0.012], spd = it.speed || 0.06, t = now / 1000;",
        "  var flkSt = {};   // e1.46: какие снежинки идут в этом круге падения (решается наверху — снежинка не возникает посреди экрана)\n"
        "  function flakesDraw(fr, f, it, now, dens, key) {\n    var ims = (it.srcs || []).map(function (s) { return spImg(fr, s); }).filter(Boolean); if (!ims.length) return;\n"
        "    var A = it.area || [0, 0, 1, 1], n = it.n || 20, hh = it.h || [0.006, 0.012], spd = it.speed || 0.06, t = now / 1000;\n"
        "    var S = flkSt[key + fr] || (flkSt[key + fr] = { ci: [], on: [] }), wq = V.weather ? V.weather() : null, wd = (it.wind || 0) * (wq ? (wq.windEff || wq.wind || 1) : 1);", 'flakes head')
d = rep(d, "      var cyc = Hpx / (spd * fh * z) || 10, ph = ((t / cyc + r1) % 1);\n      var x = a0[0] + Wpx * ((r3 + 0.04 * Math.sin(t * (0.6 + r2) + i * 2.1)) % 1), y = a0[1] + Hpx * ph;",
        "      var cyc = Hpx / (spd * fh * z) || 10, ph = ((t / cyc + r1) % 1), ci = Math.floor(t / cyc + r1);\n"
        "      if (S.ci[i] !== ci) { S.ci[i] = ci; S.on[i] = fxR(i, 14) < clamp(dens, 0, 1) && (S.on[i] !== undefined || ph < 0.15 || dens >= 0.999); }\n"
        "      if (!S.on[i]) continue;\n"
        "      var x = a0[0] + Wpx * (((r3 + 0.04 * Math.sin(t * (0.6 + r2) + i * 2.1) + wd * ph * z) % 1 + 1) % 1), y = a0[1] + Hpx * ph;   // e1.46: ветер сносит вбок", 'flakes body')
d = rep(d, "    if (SC(fr).spriteSnow && !(par",
        "    if (SC(fr).snowFall && V.weather) { var wq0 = V.weather(), sk0 = wq0 && wq0.cur ? wq0.cur[3] : 0; if (sk0 > 0.005 || flkSt['fall' + fr]) flakesDraw(fr, f, SC(fr).snowFall, now, sk0, 'fall'); }   // e1.46: погода «снег» — падают снежинки Gemini (кадры со snowFall)\n"
        "    if (SC(fr).spriteSnow && !(par", 'snowfall call')

# 5) details: надпись по буквам — kind letters (атласы букв: желобок multiply, раскалённая буква и свечение камня screen)
d = rep(d, "      [it.src, it.mask].concat(it.frames || [], it.srcs || [], it.poses || [])",
        "      [it.src, it.mask, it.dark, it.fire, it.glow].concat(it.frames || [], it.srcs || [], it.poses || [])", 'preload')
d = rep(d, "      else if (it.kind === 'moon') fxMoon(it, tt, len, a);",
        "      else if (it.kind === 'moon') fxMoon(it, tt, len, a);\n      else if (it.kind === 'letters') fxLetters(it, tt, len, a);", 'dispatch')
d = rep(d, "  function fxImageDraw(it, tt, len, a) {",
        "  // e1.46 letters (D): буквы проступают по одной и горят как огонь, потом гаснут по одной. {rect, bld, size:[w,h] px атласа-рамки, dark, fire, glow — атласы\n"
        "  //   (pogos-petros/build/scripts/fix11.py insc: буквы уже в перспективе люнета), cells:[[sx,sy,w,h,dx,dy]…], step с между буквами, rise, burn, out, outStep}.\n"
        "  //   Код не рисует: желобок затемняет камень (multiply), раскалённая буква и свечение высветляют пиксели камня (screen) и мерцают.\n"
        "  function fxLetters(it, tt, len, a) {\n"
        "    var fe = V.entry(par.fr), dk = spImg(par.fr, it.dark), fi = spImg(par.fr, it.fire), gl = spImg(par.fr, it.glow); if (!fe || !dk || !fi || !gl) return;\n"
        "    var R = it.rect, a0 = spP(fe, R[0], R[1], it.bld), a1 = spP(fe, R[2], R[3], it.bld), sz = it.size || [1, 1];\n"
        "    var kx = (a1[0] - a0[0]) / sz[0], ky = (a1[1] - a0[1]) / sz[1], st = it.step || 0.3, burn = it.burn || 2, off = len - (it.out || 3), cells = it.cells || [];\n"
        "    var bd = blendLayer('multiply'), bs = blendLayer('screen'); bd.save(); bs.save();\n"
        "    for (var i = 0; i < cells.length; i++) {\n"
        "      var c = cells[i], ti = tt - i * st; if (ti <= 0) continue;\n"
        "      var ign = sstep(0, it.rise || 0.5, ti), endK = 1 - sstep(0, 1.2, tt - off - i * (it.outStep || 0.1)); if (endK <= 0) continue;\n"
        "      var heat = ign * (0.55 + 0.45 * Math.exp(-ti / burn)) * endK;\n"
        "      var fl = 0.8 + 0.2 * (0.6 * Math.sin(tt * 13.1 + i * 1.7) + 0.4 * Math.sin(tt * 21.7 + i * 4.3)), fl2 = 0.75 + 0.25 * (0.5 * Math.sin(tt * 9.3 + i * 2.9) + 0.5 * Math.sin(tt * 17.3 + i * 0.7));\n"
        "      var dx = a0[0] + c[4] * kx, dy = a0[1] + c[5] * ky, dw = c[2] * kx, dh = c[3] * ky, j = 0.35 * Math.sin(tt * 23 + i);\n"
        "      bd.globalAlpha = clamp(a * ign * endK, 0, 1); bd.drawImage(dk, c[0], c[1], c[2], c[3], dx, dy, dw, dh);\n"
        "      bs.globalAlpha = clamp(a * heat * fl, 0, 1); bs.drawImage(fi, c[0], c[1], c[2], c[3], dx, dy, dw, dh);\n"
        "      bs.globalAlpha = clamp(a * heat * fl2 * (it.glowK || 1), 0, 1); bs.drawImage(gl, c[0], c[1], c[2], c[3], dx + j, dy - Math.abs(j) * 0.5, dw, dh);   // свечение камня дрожит на полпикселя — «мерцание»\n"
        "    }\n"
        "    bd.restore(); bs.restore();\n"
        "  }\n"
        "  function fxImageDraw(it, tt, len, a) {", 'letters fn')

# 6) details: дневная картинка шоу (призрак F) ночью — в тон ночи (холоднее и темнее), без «дневного пятна»
d = rep(d, "    ctx.save(); ctx.globalAlpha = clamp(ae * (it.alpha || 0.8) * (0.9 + 0.1 * Math.sin(tt * 2.1)), 0, 1);\n    ctx.drawImage(im, a0[0], a0[1], a1[0] - a0[0], a1[1] - a0[1]);",
        "    var nn = wts().n;\n"
        "    if (nn > 0.02) {   // e1.46: ночью картинка шоу (призрак) — в тон ночи: тот же рисунок, холоднее и темнее (source-atop на своём холсте)\n"
        "      var tw = Math.max(1, Math.round(a1[0] - a0[0])), th = Math.max(1, Math.round(a1[1] - a0[1]));\n"
        "      if (!fxNightC) fxNightC = document.createElement('canvas');\n"
        "      if (fxNightC.width !== tw || fxNightC.height !== th) { fxNightC.width = tw; fxNightC.height = th; }\n"
        "      var nx = fxNightC.getContext('2d'); nx.globalCompositeOperation = 'source-over'; nx.clearRect(0, 0, tw, th); nx.drawImage(im, 0, 0, tw, th);\n"
        "      nx.globalCompositeOperation = 'source-atop'; nx.fillStyle = 'rgba(28,38,72,' + (0.62 * nn).toFixed(3) + ')'; nx.fillRect(0, 0, tw, th); im = fxNightC;\n"
        "    }\n"
        "    ctx.save(); ctx.globalAlpha = clamp(ae * (it.alpha || 0.8) * (0.9 + 0.1 * Math.sin(tt * 2.1)) * (1 - 0.25 * nn), 0, 1);\n    ctx.drawImage(im, a0[0], a0[1], a1[0] - a0[0], a1[1] - a0[1]);", 'ghost night')
d = rep(d, "  var FX_DUR = 16000, fxImg = {};", "  var FX_DUR = 16000, fxImg = {}, fxNightC = null;", 'fxNightC')

V.write_text(v); D.write_text(d)
Path('engine/VERSION').write_text('e1.46\n')
print('ok')
