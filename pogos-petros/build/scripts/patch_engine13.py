#!/usr/bin/env python3
"""Заход 13 (e1.48): погода у зданий «только рисунки» (DRAWN_ONLY) — частицы дождя и снега кодом, как у Кукурузника (tuning.WX_PARTICLES;
листья кодом, радуга и молния кодом — по-прежнему нет); погода по кадрам frames[].wx → CONFIG.WX_FRAME [пасмурно, туман, мокро, снег, частицы]
(интерьер без погоды, крупный план без снега на полу); tuning.NO_SWAY — качания крон в шейдере нет вовсе (ни поля sway, ни env.b).
Повторный запуск ничего не меняет. Ленин/Кукурузник: настроек нет — поведение прежнее."""
from pathlib import Path
V = Path('engine/viewer.js'); B = Path('tools/build_pages.py'); S = Path('tools/building_schema.py')
v = V.read_text(); b = B.read_text(); s = S.read_text()

def rep(t, old, new, tag):
    if new in t: return t
    assert t.count(old) == 1, ('нет/не один фрагмент', tag, t.count(old))
    return t.replace(old, new)

# --- NO_SWAY
v = rep(v, "  var SWAY = !!(GUSTS && GUSTS.swayMaxPx > 0 && FRAMES.some(function (f) { return f.sway; }));",
        "  // e1.48 NO_SWAY (tuning, Погос-Петрос заход 13): кроны не качаются совсем — сдвиг выборки размазывал фон (листья Gemini летят, это details.js)\n"
        "  var NO_SWAY = !!CONFIG.NO_SWAY;\n"
        "  var SWAY = !NO_SWAY && !!(GUSTS && GUSTS.swayMaxPx > 0 && FRAMES.some(function (f) { return f.sway; }));", 'NO_SWAY var')
v = rep(v, "    '  if (uWindOn > 0.5 && env.b > 0.004) {',",
        "    '  if (' + (NO_SWAY ? 'false && ' : '') + 'uWindOn > 0.5 && env.b > 0.004) {',   // e1.48 NO_SWAY", 'NO_SWAY shader')

# --- WX_FRAME: множители погоды кадра в шейдере (плавно при смене кадра)
v = rep(v, "    gl.uniform4f(US.uWeather, wx.cur[0], wx.cur[1], wx.cur[2], wx.cover);",
        "    var wq = wxFrameK(fa, fb, mix);   // e1.48 WX_FRAME: погода кадра (интерьер — без погоды, крупный план — без снега на полу)\n"
        "    gl.uniform4f(US.uWeather, wx.cur[0] * wq[0], wx.cur[1] * wq[1], wx.cur[2] * wq[2], wx.cover * wq[3]);", 'uWeather')
v = rep(v, "  function drawPrecip(now, dt, rm) {",
        "  // e1.48 WX_FRAME (frames[].wx, Погос-Петрос): [пасмурно, туман, мокро, снег на земле, частицы] — множители погоды кадра; без настройки — 1\n"
        "  var WX_ONE = [1, 1, 1, 1, 1];\n"
        "  function wxFrameK(fa, fb, m) {\n"
        "    var W = CONFIG.WX_FRAME; if (!W) return WX_ONE;\n"
        "    var a = W[fa.idx] || WX_ONE, b2 = fb ? (W[fb.idx] || WX_ONE) : a, k = fb ? m : 0;\n"
        "    return a.map(function (x, i) { return x + (b2[i] - x) * k; });\n"
        "  }\n"
        "  function drawPrecip(now, dt, rm) {", 'wxFrameK')
v = rep(v, "    if (CONFIG.DRAWN_ONLY) { leaves.length = 0;",
        "    if (CONFIG.DRAWN_ONLY && !CONFIG.WX_PARTICLES) { leaves.length = 0;", 'WX_PARTICLES gate')
v = rep(v, "    var rainK = wx.cur[2], snowK = wx.cur[3], leafK = clamp((wx.wind - 1.4) / 1.6, 0, 1) * (1 - snowK);",
        "    var pkT = CONFIG.WX_FRAME && CONFIG.WX_FRAME[frameIndex] ? CONFIG.WX_FRAME[frameIndex][4] : 1;   // e1.48: частицы кадра (интерьер — нет), плавно 0,4 с\n"
        "    wx.pK = wx.pK == null ? pkT : wx.pK + (pkT - wx.pK) * Math.min(1, (rm ? 400 : dt) / 400);\n"
        "    var rainK = wx.cur[2] * wx.pK, snowK = wx.cur[3] * wx.pK, leafK = CONFIG.DRAWN_ONLY ? 0 : clamp((wx.wind - 1.4) / 1.6, 0, 1) * (1 - snowK);   // e1.48: DRAWN_ONLY + WX_PARTICLES — только дождь и снег\n"
        "    if (CONFIG.DRAWN_ONLY) leaves.length = 0;", 'rainK')
v = rep(v, "    wx.flash = 0;\n    if (rainK < 0.01",
        "    if (CONFIG.DRAWN_ONLY) rbA = 0;   // e1.48: радуга кодом — нет\n    wx.flash = 0;\n    if (rainK < 0.01", 'rainbow off')
v = rep(v, "    var storm = rainK > 0.5 && windIdx === 2 && tod.night > 0.5 && !rm;",
        "    var storm = !CONFIG.DRAWN_ONLY && rainK > 0.5 && windIdx === 2 && tod.night > 0.5 && !rm;", 'storm off')

# --- build_pages: WX_FRAME
b = rep(b, "    if any(f.get('pix') for f in fr):   # e1.40",
        "    if any(f.get('wx') for f in fr):   # e1.48: погода кадра [пасмурно, туман, мокро, снег на земле, частицы] (только если задана у кадров)\n"
        "        C['WX_FRAME'] = [list((f.get('wx') or {}).get('k', [1, 1, 1, 1])) + [1 if (f.get('wx') or {}).get('particles', True) else 0] for f in fr]\n"
        "    if any(f.get('pix') for f in fr):   # e1.40", 'build WX_FRAME')

# --- schema: frames[].wx
s = rep(s, "'tiltK', 'noon', 'poses', 'snowFall', 'leafFly'))",
        "'tiltK', 'noon', 'poses', 'snowFall', 'leafFly', 'wx'))", 'schema optional wx')
s = rep(s, "        hs = fr['hotspots']\n",
        "        if 'wx' in fr:   # e1.48: погода кадра — k: [пасмурно, туман, мокро, снег на земле] множители 0..1, particles: частицы дождя/снега\n"
        "            wo = c.obj(fr['wx'], '%s: wx' % w, required=(), optional=('k', 'particles', 'note'))\n"
        "            if wo:\n"
        "                if 'k' in wo:\n"
        "                    c.numbers(wo['k'], '%s: wx.k' % w, 4, 0, 1)\n"
        "                if 'particles' in wo:\n"
        "                    c.boolean(wo['particles'], '%s: wx.particles' % w)\n"
        "        hs = fr['hotspots']\n", 'schema wx')
V.write_text(v); B.write_text(b); S.write_text(s)
print('ok')
