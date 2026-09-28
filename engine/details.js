/* ============================================================================
   ЖИВОЕ НЕБО И ДЕТАЛИ (v12) — всё нарисовано штрихами на 2D-холсте поверх картинки, в стиле рисунка: тонкие тёмные линии и мягкие
   заливки, ничего фотореалистичного. Один общий цикл анимации: этот модуль не крутит свой requestAnimationFrame — просмотрщик
   вызывает Details.frame(now) из своего единственного цикла; пока вкладка скрыта, цикла нет. Если fps ниже порога (45) —
   всё это отключается первым (Details.off()), потом ветер.

   Что здесь:
   1. СПОКОЙНОЕ НЕБО (всегда, на всех кадрах; день / закат / ночь плавно перетекают по времени суток):
      облака медленно плывут; солнце (закат — низкое красное, ночь — луна) с ореолом и лёгким мерцанием; одиночные птицы
      с машущими крыльями. Ночью ещё звёзды и падающие звёзды — они в шейдере.
   2. СОБЫТИЯ — случайные, не чаще одного раза в 8–15 с и не больше двух одновременно: самолёт, стайка птиц, воздушный шар,
      клин журавлей (армянский символ), бумажный змей, парящий орёл, небесный фонарик, бабочки, светлячки, мотыльки у фонаря,
      свет в окне главного здания.
   3. КРУПНЫЙ ПЛАН (кадр с closeUp в настройках здания): блики скользят по окнам, птицы садятся на кромку крыши и улетают,
      на крыше колышется флаг.
   4. ПАРАД (кнопка с флагом): три истребителя оставляют дымные следы красный / синий / абрикосовый — флаг Армении.

   Всё, что зависит от здания и кадра (что где летает, полоса неба, облака, солнце и луна, газон, крупный план), — в настройках
   здания: CONFIG.SCENE[номер кадра] (собирает tools/build_pages.py из <здание>/building.json, по кадрам). Здесь — только механизм.
   Флаги колышутся в шейдере (CONFIG.FLAGS), ветер в деревьях — там же.
   ============================================================================ */
(function (root) {
  'use strict';

  // настройки кадра из building.json: life (что летает днём/на закате/ночью), skyBand (полоса чистого неба, доли высоты),
  // clouds (сколько облаков), cloudScale (размер облаков, если задан — одинаковый), sunDay / sunSet / moon ([u, v] на кадре),
  // sunDayDrawn (солнце уже нарисовано на картинке — только ореол), lawn ([u0, v0, u1, v1] — бабочки и светлячки; нет — их нет),
  // closeUp (крупный план: glints — блики в окнах, perch — кромка, куда садятся птицы, mast — мачта флага [u низ, v низ, u верх, v верх])
  function SC(fr) { return (root.CONFIG && root.CONFIG.SCENE && root.CONFIG.SCENE[fr]) || {}; }

  var V = null, cv = null, ctx = null, dpr = 1, W = 0, H = 0;
  var active = [], nextAt = 0, lastKey = null, lastFrame = -1, lastKind = '';
  var amb = null, par = null, UNIT = 470, drawn = false;   // UNIT: пикселей на всю ширину кадра
  var cloudMul = 1, showT0 = null, showK = -1, cloudT = 0, lastT = 0, nextKite = 0, ocSlow = 0;   // ocSlow — тучи догоняют погоду медленно (~8 с), чтобы наползали, а не появлялись   // плавное появление слоя; «время облаков» (быстрее при ветре); змей при ветре (e1.3)
  function wxNow() { var x = V.weather && V.weather(); return x ? { oc: x.cur[0], fog: x.cur[1], wind: x.wind } : { oc: 0, fog: 0, wind: 1 }; }

  function rnd(a, b) { return a + (b - a) * Math.random(); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function sstep(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function env(t, up, down) { return Math.max(0, Math.min(1, t / up, (1 - t) / down)); }   // плавное появление и растворение (t: 0..1)
  function seeded(seed) {   // mulberry32: раскладка неба на кадре одна и та же при каждом заходе
    return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function sf() { return UNIT / 470; }
  function C(a) { return a[0] + ',' + a[1] + ',' + a[2]; }   // цвет [r, g, b] -> «r,g,b» для rgba(…)
  function SB() { return root.CONFIG.LOOK.skyBodies; }   // цвета солнца, заката и луны (LOOK.skyBodies в настройках движка; здание переопределяет через tuning)   // масштаб размеров в пикселях: 1 — на телефоне

  // время суток: day / sunset / night, между ними (идёт переход) — null, новых событий нет
  function todKey() {
    var p = V.tod.p;
    if (p < 0.28) return 'day';
    if (p > 0.82 && p < 1.22) return 'sunset';
    if (p > 2.05) return 'night';
    return null;
  }
  // веса дня, заката и ночи в текущий момент (сумма ≈ 1) — по ним спокойное небо плавно перетекает вместе с картинкой
  function wts() {
    var t = V.tod, p = t.p, n = t.night || 0;
    return { d: p <= 1 ? 1 - p : 0, s: p <= 1 ? p : Math.max(0, 1 - n), n: n };
  }
  function mix3(a, b, c, w) { return [a[0] * w.d + b[0] * w.s + c[0] * w.n, a[1] * w.d + b[1] * w.s + c[1] * w.n, a[2] * w.d + b[2] * w.s + c[2] * w.n]; }
  function rgb(a) { return Math.round(a[0]) + ',' + Math.round(a[1]) + ',' + Math.round(a[2]); }
  function ink() { var k = root.CONFIG.LOOK.ink; return rgb(mix3(k.day, k.sunset, k.night, wts())); }   // цвет карандаша по времени суток (LOOK.ink)

  function ensureCanvas() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.id = 'fxCanvas';
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none';
    V.stage.insertBefore(cv, document.getElementById('hotspots'));   // над картинкой, под точками-подсказками
    ctx = cv.getContext('2d');
  }
  function fit() {
    var w = V.stage.clientWidth, h = V.stage.clientHeight, d = Math.min(window.devicePixelRatio || 1, 1.5);
    if (w === W && h === H && d === dpr) return;
    W = w; H = h; dpr = d;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  function P(u, v, d) { return V.project(V.entry(V.frame()), u, v, d == null ? 0 : d); }   // точка кадра -> пиксели сцены
  function unit() {
    var f = V.entry(V.frame()), a = V.project(f, 0.5, 0.5, 0), b = V.project(f, 0.6, 0.5, 0);
    return Math.max(120, Math.abs(b[0] - a[0]) / 0.1);
  }

  function depthAt(f, u, v) {
    var dm = f.depth, x = Math.max(0, Math.min(dm.w - 1, Math.round(u * (dm.w - 1)))), y = Math.max(0, Math.min(dm.h - 1, Math.round(v * (dm.h - 1))));
    return dm.d[y * dm.w + x] / 255;
  }

  // ---------- спрайты (рисуем прямо на холсте) ----------
  // птичка: два крыла-дужки, взмах — по flap (-1 вверх … 1 вниз): кончики крыльев ходят вверх-вниз, изгиб меняется
  function bird(x, y, s, flap, col, a, lw) {
    ctx.strokeStyle = 'rgba(' + col + ',' + a + ')'; ctx.lineWidth = lw || 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var tip = s * 0.62 * flap, bend = s * (0.55 - 0.32 * flap);
    ctx.beginPath();
    ctx.moveTo(x - s, y + tip);
    ctx.quadraticCurveTo(x - s * 0.5, y - bend, x, y);
    ctx.quadraticCurveTo(x + s * 0.5, y - bend, x + s, y + tip);
    ctx.stroke();
  }
  function flapOf(now, sp, ph) { return Math.sin(now * 0.0105 * sp + ph); }

  // ---------- облака в стиле старой гравюры: контур пером (двойной, тоньше в тени), штриховка тени внизу справа, бумага просвечивает
  // (лёгкая подкраска вместо сплошной белой заливки). Рисуются один раз в спрайт, потом только сдвигаются. ----------
  var SHAPES = [
    { puffs: [[34, 46, 12], [56, 36, 17], [86, 32, 21], [114, 42, 14]], base: [22, 128, 46, 58] },
    { puffs: [[26, 47, 10], [46, 39, 15], [74, 29, 20], [104, 36, 16], [128, 46, 10]], base: [16, 138, 46, 58] },
    { puffs: [[36, 44, 14], [64, 33, 20], [94, 45, 12]], base: [22, 110, 46, 57] }
  ];
  var TINT = [
    { line: 'rgba(58,50,40,0.9)', hatch: 'rgba(68,58,46,0.55)', wash: 'rgba(255,250,236,0.20)' },      // день: сепия по голубому
    { line: 'rgba(104,54,40,0.9)', hatch: 'rgba(128,66,48,0.7)', wash: 'rgba(255,224,200,0.18)' },    // закат
    { line: 'rgba(214,222,242,0.9)', hatch: 'rgba(184,196,228,0.6)', wash: 'rgba(120,136,180,0.16)' } // ночь: светлое перо по тёмному
  ];
  var cloudSpr = null;
  function makeCloud(shape, tint) {
    var S = 3, sh = SHAPES[shape], T = TINT[tint], R = seeded(700 + shape * 13 + tint * 5), i, gx, gy;
    function cv2() { var c = document.createElement('canvas'); c.width = 160 * S; c.height = 70 * S; var x = c.getContext('2d'); x.scale(S, S); x.lineJoin = 'round'; x.lineCap = 'round'; return [c, x]; }
    var main = cv2(), c = main[0], x = main[1];
    var bx = (sh.base[0] + sh.base[1]) / 2, bw = (sh.base[1] - sh.base[0]) / 2, by = (sh.base[2] + sh.base[3]) / 2, bh = (sh.base[3] - sh.base[2]) / 2 + 2;
    function union(g) { g.beginPath(); sh.puffs.forEach(function (p) { g.moveTo(p[0] + p[2], p[1]); g.arc(p[0], p[1], p[2], 0, 6.283); }); g.moveTo(bx + bw, by); g.ellipse(bx, by, bw, bh, 0, 0, 6.283); }
    var x0 = bx - bw, x1 = bx + bw, top = Math.min.apply(null, sh.puffs.map(function (p) { return p[1] - p[2]; })), bot = by + bh;
    x.fillStyle = T.wash; union(x); x.fill();                                   // бумага просвечивает: только лёгкая подкраска
    x.save(); union(x); x.clip();                                               // штриховка тени: тем гуще, чем ниже и правее, внизу — перекрёстная
    x.strokeStyle = T.hatch; x.lineWidth = 0.85;
    for (gy = top; gy < bot; gy += 2.9) for (gx = x0; gx < x1; gx += 2.9) {
      var sd = Math.max(0, Math.min(1, (gy - top) / (bot - top) * 1.35 + (gx - x0) / (x1 - x0) * 0.4 - 0.48));
      if (R() > sd * 0.72) continue;
      var a = -0.95 + (R() - 0.5) * 0.25, L = 2.4 + sd * 3.2, jx = (R() - 0.5) * 1.6, jy = (R() - 0.5) * 1.6;
      x.beginPath(); x.moveTo(gx + jx, gy + jy); x.lineTo(gx + jx + Math.cos(a) * L, gy + jy + Math.sin(a) * L); x.stroke();
      if (sd > 0.72) { x.beginPath(); x.moveTo(gx + jx, gy + jy); x.lineTo(gx + jx + Math.cos(a + 1.6) * L * 0.7, gy + jy + Math.sin(a + 1.6) * L * 0.7); x.stroke(); }
    }
    x.restore();
    var ol = cv2(), ox = ol[1];                                                 // контур: обводим все круги и основание, потом стираем внутренность — остаётся внешняя линия
    ox.strokeStyle = T.line; ox.lineWidth = 2.4;
    sh.puffs.forEach(function (p) { ox.beginPath(); ox.arc(p[0], p[1], p[2], 0, 6.283); ox.stroke(); });
    ox.beginPath(); ox.ellipse(bx, by, bw, bh, 0, 0, 6.283); ox.stroke();
    ox.globalCompositeOperation = 'destination-out'; ox.fillStyle = '#000'; union(ox); ox.fill();
    ox.globalCompositeOperation = 'source-over';
    x.drawImage(ol[0], 0, 0, 160, 70); x.globalAlpha = 0.55; x.drawImage(ol[0], 0.9, 0.7, 160, 70); x.globalAlpha = 1;   // второй проход чуть в сторону — двойной контур
    x.strokeStyle = T.line; x.lineWidth = 0.7; x.globalAlpha = 0.7;             // завитки внутри: короткие дуги у верха каждого «барашка»
    sh.puffs.forEach(function (p, k) { if (k % 2) return; x.beginPath(); x.arc(p[0], p[1] + 1, p[2] * 0.6, 3.6, 4.7); x.stroke(); });
    x.globalAlpha = 1;
    return c;
  }
  function clouds() {
    if (cloudSpr) return cloudSpr;
    cloudSpr = [0, 1, 2].map(function (t) { return [0, 1, 2].map(function (sh) { return makeCloud(sh, t); }); });
    return cloudSpr;
  }

  // ---------- спокойное небо: раскладка на кадре (облака, одиночные птицы) ----------
  function buildAmbient(fr) {
    var S = SC(fr), R = seeded(4100 + fr * 37), band = S.skyBand, n = S.clouds || 0, cl = [], i;
    for (i = 0; i < n; i++) {
      var sc = S.cloudScale != null ? S.cloudScale : rnd0(R, 0.65, 1.05), hV = 0.066 * sc, lo = band[0] + hV * 0.55, hi = Math.max(lo, band[1] - hV * 0.55 - 0.03);
      cl.push({ v: lo + (hi - lo) * (n > 1 ? (i + R() * 0.6) / n : 0.3), sc: sc, sp: rnd0(R, 0.0045, 0.0095) * (R() < 0.15 ? -1 : 1), ph: R(), shape: (R() * 3) | 0, w: rnd0(R, 0.75, 1) });
    }
    var bd = [];
    for (i = 0; i < 3; i++) bd.push({ v: band[0] + (band[1] - band[0]) * (0.1 + 0.55 * R()), sp: rnd0(R, 0.016, 0.024), ph: R(), fp: R() * 6.28, s: rnd0(R, 3.6, 4.6), dir: i === 1 ? -1 : 1 });
    var ex = [];   // пасмурно: ещё 5 облаков, крупнее; при ясной погоде они за левым краем, с тучами «наползают» на небо
    for (i = 0; i < 5; i++) ex.push({ u: 0.08 + i * 0.21 + R() * 0.06, v: band[0] + (band[1] - band[0]) * (0.15 + 0.7 * R()), sc: rnd0(R, 0.6, 0.95), shape: (R() * 3) | 0, lag: R() * 0.4 });
    amb = { fr: fr, clouds: cl, birds: bd, extra: ex };
  }
  function rnd0(R, a, b) { return a + (b - a) * R(); }

  function drawClouds(now, w, wx) {
    var spr = clouds(), t = now / 1000 + cloudT;   // при тихой погоде cloudT = 0 — облака там же, где были до погоды
    if (wx.oc > 0.005) {   // тучи пасмурной погоды: выезжают слева по мере того, как небо затягивает
      for (var j = 0; j < amb.extra.length; j++) {
        var x = amb.extra[j], a = Math.max(0, Math.min(1, (wx.oc - x.lag) / (1 - x.lag)));
        if (a <= 0) continue;
        var ae = a * a * (3 - 2 * a), ue = ((x.u + 0.004 * t * (1 + j * 0.3)) % 1.3 + 1.3) % 1.3 - 0.15, pe = P(ue, x.v, 0), we = 0.31 * x.sc * UNIT * (0.65 + 0.35 * ae), he = we * 70 / 160;   // сгущаются на месте: растут и проявляются
        var wsE = [w.d, w.s, w.n];
        for (var q = 0; q < 3; q++) { if (wsE[q] < 0.01) continue; ctx.globalAlpha = cloudMul * 0.85 * wsE[q] * ae * (1 - 0.8 * wx.fog); ctx.drawImage(spr[q][x.shape], pe[0] - we / 2, pe[1] - he / 2, we, he); }
      }
    }
    for (var i = 0; i < amb.clouds.length; i++) {
      var c = amb.clouds[i], k = ((c.ph + c.sp * t) % 1.4 + 1.4) % 1.4, u = k - 0.2;   // от -0.2 до 1.2 кадра, потом снова слева
      var e = Math.min(1, (u + 0.2) / 0.14, (1.2 - u) / 0.14), p = P(u, c.v, 0), wd = 0.31 * c.sc * UNIT, ht = wd * 70 / 160;
      if (e <= 0) continue;
      var ws = [w.d, w.s, w.n], al = [0.95, 0.9, 0.8];
      for (var k2 = 0; k2 < 3; k2++) {
        if (ws[k2] < 0.01) continue;
        ctx.globalAlpha = cloudMul * al[k2] * ws[k2] * e * c.w * (1 - 0.8 * wx.fog);   // в тумане облака тонут
        ctx.drawImage(spr[k2][c.shape], p[0] - wd / 2, p[1] - ht / 2, wd, ht);
      }
    }
    ctx.globalAlpha = 1;
  }

  // солнце (день) с ореолом и мерцанием лучей; на закате — низкое красное; ночью — луна с ореолом
  function glow(x, y, r, col, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + col + ',' + a + ')'); g.addColorStop(0.45, 'rgba(' + col + ',' + a * 0.35 + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  }
  function drawSun(now, w0, fr) {
    var wq = wxNow(), dim = (1 - 0.9 * ocSlow) * (1 - 0.8 * wq.fog), w = { d: w0.d * dim, s: w0.s * dim, n: w0.n * dim };   // тучи закрывают солнце и луну
    var s = sf(), t = now * 0.001, sh = 0.5 + 0.5 * Math.sin(t * 1.1) * 0.6 + 0.2 * Math.sin(t * 2.7 + 1.3);
    var i, ang, p, r;
    if (w.d > 0.01) {   // день: диск карандашом, лучи, ореол
      var S = SC(fr), sd = S.sunDay, drawnSun = !!S.sunDayDrawn; p = P(sd[0], sd[1], 0); r = 0.026 * UNIT;
      glow(p[0], p[1], r * 4.6, C(SB().sunGlow), (drawnSun ? 0.30 : 0.26) * w.d * (0.88 + 0.12 * sh));
      if (!drawnSun) {
        ctx.fillStyle = 'rgba(' + C(SB().sunDisc) + ',' + 0.92 * w.d + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.fill();
        ctx.strokeStyle = 'rgba(' + C(SB().sunOutline) + ',' + 0.6 * w.d + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.stroke();
        ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(' + C(SB().sunOutline) + ',' + 0.32 * w.d + ')'; ctx.beginPath(); ctx.arc(p[0] + 0.6, p[1] + 0.4, r * 1.08, 0.3, 5.6); ctx.stroke();
        for (i = 0; i < 12; i++) {   // лучи: длина и яркость чуть мерцают, у каждого свой ритм
          ang = i * 0.5236 + 0.15; var lo = r * 1.35, len = r * (0.5 + 0.22 * (i % 2)) * (0.82 + 0.28 * Math.sin(t * 1.9 + i * 1.7));
          ctx.strokeStyle = 'rgba(120,88,40,' + (0.32 + 0.22 * Math.sin(t * 1.5 + i * 2.1)) * w.d + ')'; ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(p[0] + Math.cos(ang) * lo, p[1] + Math.sin(ang) * lo); ctx.lineTo(p[0] + Math.cos(ang) * (lo + len), p[1] + Math.sin(ang) * (lo + len)); ctx.stroke();
        }
      }
    }
    if (w.s > 0.01) {   // закат: низкое красное солнце, широкий тёплый ореол
      var ss = SC(fr).sunSet; p = P(ss[0], ss[1], 0); r = 0.033 * UNIT;
      glow(p[0], p[1], r * 5.4, C(SB().sunsetGlow), 0.36 * w.s * (0.9 + 0.1 * sh));
      ctx.fillStyle = 'rgba(' + C(SB().sunsetDisc) + ',' + 0.88 * w.s + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(' + C(SB().sunsetOutline) + ',' + 0.5 * w.s + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.stroke();
    }
    if (w.n > 0.01) {   // ночь: луна-серп с ореолом, лёгкое мерцание
      var mo = SC(fr).moon; p = P(mo[0], mo[1], 0); r = 0.022 * UNIT;
      glow(p[0], p[1], r * 5, C(SB().moonGlow), 0.28 * w.n * (0.9 + 0.1 * sh));
      ctx.save(); ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.clip();   // серп: диск минус сдвинутый круг (внутри диска)
      ctx.globalAlpha = 0.95 * w.n; ctx.fillStyle = '#f3efdc';
      ctx.beginPath(); ctx.rect(p[0] - r * 2, p[1] - r * 2, r * 4, r * 4); ctx.arc(p[0] + r * 0.52, p[1] - r * 0.14, r * 0.86, 0, 6.283); ctx.fill('evenodd');
      ctx.restore();
      ctx.strokeStyle = 'rgba(' + C(SB().moonOutline) + ',' + 0.45 * w.n + ')'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0.8, 5.5); ctx.stroke();
    }
  }

  // одиночные птицы: пересекают небо не спеша, машут крыльями (днём и на закате)
  function drawAmbientBirds(now, w) {
    var a0 = (w.d + w.s * 0.9) * 0.62; if (a0 < 0.02) return;
    var col = ink(), t = now / 1000, s0 = sf();
    for (var i = 0; i < amb.birds.length; i++) {
      var b = amb.birds[i], k = ((b.ph + b.sp * t) % 1.3 + 1.3) % 1.3, u = b.dir > 0 ? k - 0.15 : 1.15 - k;
      var e = Math.min(1, (k) / 0.12, (1.3 - k) / 0.12), p = P(u, b.v + 0.006 * Math.sin(t * 0.9 + b.fp), 0);
      bird(p[0], p[1], b.s * s0, flapOf(now, 1, b.fp), col, a0 * e, 1.15);
    }
  }

  // ---------- события ----------
  var KINDS = {
    birds: function (fr) {   // стайка пересекает небо; на закате — так же, но темнее и теплее
      var band = SC(fr).skyBand, v0 = rnd(band[0], band[1]), dir = Math.random() < 0.5 ? 1 : -1;
      var n = 5 + ((Math.random() * 3) | 0), fl = [];
      for (var i = 0; i < n; i++) fl.push({ du: -dir * (i * rnd(0.014, 0.03)), dv: (i % 2 ? 1 : -1) * i * rnd(0.004, 0.011), ph: rnd(0, 6.28), sp: rnd(0.9, 1.15) });
      return { dur: rnd(15, 22) * 1000, u0: dir > 0 ? -0.08 : 1.08, u1: dir > 0 ? 1.08 : -0.08, v0: v0, v1: v0 + rnd(-0.04, 0.03), fl: fl,
        draw: function (e, t, now) {
          var col = ink(), a = 0.66 * env(t, 0.08, 0.08);
          for (var i = 0; i < e.fl.length; i++) {
            var b = e.fl[i], p = P(lerp(e.u0, e.u1, t) + b.du, lerp(e.v0, e.v1, t) + b.dv + 0.004 * Math.sin(t * 9 + b.ph), 0);
            bird(p[0], p[1], 4.4 * b.sp * sf(), flapOf(now, b.sp, b.ph), col, a);
          }
        } };
    },
    cranes: function (fr) {   // клин журавлей — армянский символ: летят углом, крылья машут медленно и волной по клину
      var band = SC(fr).skyBand, v0 = rnd(band[0] + 0.01, band[0] + (band[1] - band[0]) * 0.45), dir = Math.random() < 0.5 ? 1 : -1;
      var n = 7 + ((Math.random() * 3) | 0), fl = [];
      for (var i = 0; i < n; i++) { var row = Math.ceil(i / 2), side = i === 0 ? 0 : (i % 2 ? 1 : -1); fl.push({ du: -dir * row * 0.024, dv: side * row * 0.0085, ph: row * 0.55 + rnd(0, 0.3) }); }
      return { dur: rnd(26, 34) * 1000, u0: dir > 0 ? -0.10 : 1.10, u1: dir > 0 ? 1.10 : -0.10, v0: v0, v1: v0 + rnd(-0.03, 0.02), fl: fl,
        draw: function (e, t, now) {
          var col = ink(), a = 0.78 * env(t, 0.07, 0.07);
          for (var i = 0; i < e.fl.length; i++) {
            var b = e.fl[i], p = P(lerp(e.u0, e.u1, t) + b.du, lerp(e.v0, e.v1, t) + b.dv + 0.0025 * Math.sin(now * 0.0008 + b.ph), 0);
            bird(p[0], p[1], 5.6 * sf(), Math.sin(now * 0.0052 - b.ph * 1.4), col, a, 1.35);
          }
        } };
    },
    plane: function (fr) {   // самолёт высоко в небе: днём и на закате — со следом, ночью — мигающий огонёк
      var band = SC(fr).skyBand, v0 = rnd(band[0], band[0] + (band[1] - band[0]) * 0.55), dir = Math.random() < 0.5 ? 1 : -1;
      return { dur: rnd(38, 54) * 1000, u0: dir > 0 ? -0.06 : 1.06, u1: dir > 0 ? 1.06 : -0.06, v0: v0, v1: v0 + rnd(0.03, 0.08), dir: dir,
        draw: function (e, t, now) {
          var k = todKey(), a = env(t, 0.06, 0.06), pos = function (tt) { return P(lerp(e.u0, e.u1, tt), lerp(e.v0, e.v1, tt), 0); };
          var p = pos(t);
          if (k === 'night') {   // огонёк: красный и белый вспышки
            var ph = (now / 1000) % 1.7, on = ph < 0.16 || (ph > 0.42 && ph < 0.52);
            var red = ph < 0.16;
            ctx.fillStyle = on ? (red ? 'rgba(255,120,110,' + 0.9 * a + ')' : 'rgba(255,250,240,' + 0.95 * a + ')') : 'rgba(255,255,255,' + 0.18 * a + ')';
            ctx.beginPath(); ctx.arc(p[0], p[1], on ? 1.7 : 0.9, 0, 6.283); ctx.fill();
            if (on) { ctx.fillStyle = red ? 'rgba(255,110,100,' + 0.16 * a + ')' : 'rgba(255,250,240,' + 0.16 * a + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 6.283); ctx.fill(); }
            return;
          }
          var trail = k === 'sunset' ? '255,224,205' : '255,255,255', N = 14;
          for (var i = 0; i < N; i++) {   // след: белая нить, тает к хвосту
            var t0 = t - (i / N) * 0.14, t1 = t - ((i + 1) / N) * 0.14;
            if (t1 < 0) break;
            var q0 = pos(t0), q1 = pos(t1);
            ctx.strokeStyle = 'rgba(' + trail + ',' + (0.6 * (1 - i / N) * a) + ')'; ctx.lineWidth = 1.3 * (1 - 0.5 * i / N);
            ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(' + ink() + ',' + 0.7 * a + ')'; ctx.lineWidth = 1.2;
          var dx = e.dir * 4.2;   // силуэт: фюзеляж и крылья
          ctx.beginPath(); ctx.moveTo(p[0] - dx, p[1] + 0.4); ctx.lineTo(p[0] + dx, p[1] - 0.4);
          ctx.moveTo(p[0] - dx * 0.1, p[1]); ctx.lineTo(p[0] - dx * 0.6, p[1] - 3.2); ctx.moveTo(p[0] - dx * 0.1, p[1]); ctx.lineTo(p[0] - dx * 0.6, p[1] + 3.2);
          ctx.stroke();
        } };
    },
    balloon: function (fr) {   // воздушный шар медленно проплывает вдали
      var band = SC(fr).skyBand, dir = Math.random() < 0.5 ? 1 : -1, v0 = rnd(band[0] + 0.05, Math.max(band[0] + 0.06, band[1] - 0.13));
      return { dur: rnd(70, 90) * 1000, u0: dir > 0 ? 0.04 : 0.98, u1: dir > 0 ? 0.98 : 0.04, v0: v0, v1: v0 - rnd(0.02, 0.04),
        draw: function (e, t, now) {
          var a = env(t, 0.08, 0.08), p = P(lerp(e.u0, e.u1, t), lerp(e.v0, e.v1, t) + 0.004 * Math.sin(now * 0.0007), 0), r = 8.5 * sf();
          var sun = todKey() === 'sunset';
          ctx.save(); ctx.translate(p[0], p[1]); ctx.globalAlpha = 0.9 * a;
          ctx.strokeStyle = 'rgba(58,51,42,0.75)'; ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.moveTo(-r * 0.55, r * 1.15); ctx.lineTo(-r * 0.22, r * 1.9); ctx.moveTo(r * 0.55, r * 1.15); ctx.lineTo(r * 0.22, r * 1.9); ctx.stroke();
          ctx.fillStyle = 'rgba(70,52,40,0.85)'; ctx.fillRect(-r * 0.3, r * 1.9, r * 0.6, r * 0.42);
          ctx.beginPath(); ctx.moveTo(0, r * 1.25); ctx.bezierCurveTo(-r * 1.25, r * 0.5, -r * 1.05, -r, 0, -r); ctx.bezierCurveTo(r * 1.05, -r, r * 1.25, r * 0.5, 0, r * 1.25);
          ctx.fillStyle = sun ? 'rgba(222,150,110,0.8)' : 'rgba(203,150,120,0.78)'; ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(-r * 0.5, 0, 0, r * 1.25); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.5, 0, 0, r * 1.25); ctx.stroke();
          ctx.restore();
        } };
    },
    kite: function (fr) {   // бумажный змей: ромб с хвостом из бантиков, качается и плывёт по ветру; нитка тает, не доходя до земли
      var band = SC(fr).skyBand, dir = Math.random() < 0.5 ? 1 : -1, v0 = rnd(band[0] + 0.035, Math.max(band[0] + 0.04, band[1] - 0.13)), ph = rnd(0, 6.28);
      var cols = [['214,88,72', '244,208,92'], ['84,128,196', '236,236,226'], ['92,160,110', '244,228,150']], cs = pick(cols);
      return { dur: rnd(30, 40) * 1000, u0: dir > 0 ? -0.05 : 1.05, u1: dir > 0 ? 1.05 : -0.05, v0: v0, v1: v0 + rnd(-0.025, 0.03),
        draw: function (e, t, now) {
          var a = env(t, 0.07, 0.07), sun = todKey() === 'sunset', s = sf();
          var p = P(lerp(e.u0, e.u1, t), lerp(e.v0, e.v1, t) + 0.006 * Math.sin(now * 0.0011 + ph), 0), rot = 0.22 * Math.sin(now * 0.0013 + ph), r = 9 * s;
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(rot); ctx.globalAlpha = a;
          var body = [[0, -r * 1.25], [r * 0.75, 0], [0, r * 1.05], [-r * 0.75, 0]];
          ctx.beginPath(); ctx.moveTo(body[0][0], body[0][1]); for (var i = 1; i < 4; i++) ctx.lineTo(body[i][0], body[i][1]); ctx.closePath();
          ctx.fillStyle = 'rgba(' + cs[0] + ',' + (sun ? 0.72 : 0.86) + ')'; ctx.fill();
          ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(' + cs[1] + ',0.9)'; ctx.fillRect(-r, -r * 1.3, r * 2, r * 1.3); ctx.restore();   // верхняя половина другого цвета
          ctx.strokeStyle = 'rgba(58,44,36,0.8)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -r * 1.25); ctx.lineTo(0, r * 1.05); ctx.moveTo(-r * 0.75, 0); ctx.lineTo(r * 0.75, 0); ctx.lineWidth = 0.6; ctx.stroke();   // рейки
          ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(58,44,36,0.7)';   // хвост: волнистая нить с бантиками
          ctx.beginPath(); ctx.moveTo(0, r * 1.05);
          for (var k = 1; k <= 12; k++) ctx.lineTo(Math.sin(now * 0.004 + k * 0.9 + ph) * r * 0.32 * (k / 6), r * 1.05 + k * r * 0.34);
          ctx.stroke();
          for (k = 3; k <= 12; k += 3) { var bx = Math.sin(now * 0.004 + k * 0.9 + ph) * r * 0.32 * (k / 6), by = r * 1.05 + k * r * 0.34; ctx.fillStyle = 'rgba(' + cs[0] + ',0.9)'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - r * 0.28, by - r * 0.14); ctx.lineTo(bx - r * 0.28, by + r * 0.14); ctx.closePath(); ctx.moveTo(bx, by); ctx.lineTo(bx + r * 0.28, by - r * 0.14); ctx.lineTo(bx + r * 0.28, by + r * 0.14); ctx.closePath(); ctx.fill(); }
          ctx.restore();
          var g = ctx.createLinearGradient(p[0], p[1] + r * 1.05, p[0] - dirOf(e) * 26 * s, p[1] + r * 1.05 + 60 * s);   // нитка от нижнего угла: тонкая, тает к концу
          g.addColorStop(0, 'rgba(58,44,36,' + 0.55 * a + ')'); g.addColorStop(1, 'rgba(58,44,36,0)');
          ctx.strokeStyle = g; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(p[0], p[1] + r * 1.05); ctx.quadraticCurveTo(p[0] - dirOf(e) * 12 * s, p[1] + r * 1.05 + 26 * s, p[0] - dirOf(e) * 26 * s, p[1] + r * 1.05 + 60 * s); ctx.stroke();
        } };
    },
    eagle: function (fr) {   // парящий орёл: кружит на расправленных крыльях, почти не машет
      var band = SC(fr).skyBand, cu = rnd(0.3, 0.7), cv2 = rnd(band[0] + 0.05, Math.max(band[0] + 0.06, band[1] - 0.14)), ph = rnd(0, 6.28), dir = Math.random() < 0.5 ? 1 : -1;
      return { dur: rnd(24, 32) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.1, 0.12), th = dir * (t * 2 * Math.PI * 1.15) + ph, s = sf();
          var u = cu + 0.16 * Math.cos(th) + 0.06 * (t - 0.5), v = cv2 + 0.022 * Math.sin(th), p = P(u, v, 0);
          var col = ink(), sp = 10 * s, fl = 0.16 * Math.sin(now * 0.0016 + ph), bank = 0.16 * Math.cos(th) * dir;
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(bank); ctx.strokeStyle = 'rgba(' + col + ',' + 0.8 * a + ')'; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath();   // крылья-«гребёнка» с пальцами на концах
          ctx.moveTo(-sp, sp * (0.18 + fl)); ctx.quadraticCurveTo(-sp * 0.5, -sp * 0.32, 0, -sp * 0.04); ctx.quadraticCurveTo(sp * 0.5, -sp * 0.32, sp, sp * (0.18 + fl)); ctx.stroke();
          ctx.lineWidth = 0.9;
          for (var i = -1; i <= 1; i += 2) for (var k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(i * sp * (0.86 + k * 0.05), sp * (0.16 + fl) - k * 0.3); ctx.lineTo(i * sp * (1.02 + k * 0.05), sp * (0.34 + fl + k * 0.06)); ctx.stroke(); }
          ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, -sp * 0.04); ctx.lineTo(0, sp * 0.3); ctx.stroke();   // туловище и хвост
          ctx.restore();
        } };
    },
    lantern: function (fr) {   // небесный фонарик: тёплый огонёк медленно поднимается и уплывает (закат, ночь)
      var band = SC(fr).skyBand, u0 = rnd(0.18, 0.82), dir = Math.random() < 0.5 ? 1 : -1, v0 = band[1] - 0.02, v1 = band[0] + 0.02, ph = rnd(0, 6.28);
      return { dur: rnd(30, 40) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.12, 0.2), k = wts(), night = 0.6 + 0.4 * k.n, s = sf();
          var p = P(u0 + dir * 0.09 * t + 0.008 * Math.sin(now * 0.0008 + ph), lerp(v0, v1, t) + 0.003 * Math.sin(now * 0.0011 + ph), 0), fl = 0.9 + 0.1 * Math.sin(now * 0.013 + ph);
          glow(p[0], p[1], 13 * s, '255,170,70', 0.5 * a * night * fl);
          ctx.fillStyle = 'rgba(255,190,90,' + 0.95 * a * fl + ')'; ctx.strokeStyle = 'rgba(120,60,20,' + 0.6 * a + ')'; ctx.lineWidth = 0.8;
          var w2 = 3.2 * s, h2 = 4.2 * s;
          ctx.beginPath(); ctx.moveTo(p[0] - w2 * 0.8, p[1] - h2); ctx.lineTo(p[0] + w2 * 0.8, p[1] - h2); ctx.lineTo(p[0] + w2, p[1] + h2 * 0.6); ctx.quadraticCurveTo(p[0], p[1] + h2, p[0] - w2, p[1] + h2 * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        } };
    },
    butterfly: function (fr) {   // бабочка порхает над газоном
      var L = SC(fr).lawn; if (!L) return null;   // у кадра нет газона — нет и бабочек
      var u0 = rnd(L[0], L[2]), v0 = rnd(L[1], L[3]), du = rnd(-0.32, 0.32), dv = rnd(-0.08, 0.05), ph = rnd(0, 6.28);
      return { dur: rnd(11, 16) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.12, 0.15), u = u0 + du * t + 0.02 * Math.sin(t * 14 + ph), v = v0 + dv * t + 0.012 * Math.sin(t * 19 + ph);
          var p = P(u, v, 0.55), w = Math.abs(Math.sin(now * 0.016 + ph)) * 3.6 + 0.6;
          ctx.fillStyle = 'rgba(232,214,150,' + 0.85 * a + ')'; ctx.strokeStyle = 'rgba(70,58,44,' + 0.6 * a + ')'; ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.ellipse(p[0] - w * 0.6, p[1] - 1, w, 2.4, -0.4, 0, 6.283); ctx.ellipse(p[0] + w * 0.6, p[1] - 1, w, 2.4, 0.4, 0, 6.283); ctx.fill(); ctx.stroke();
        } };
    },
    moths: function (fr) {   // мотыльки кружат у фонаря
      var f = V.entry(V.frame()), lamps = (f.lamps || []).filter(function (l) { return l.hv > 0.4; });
      if (!lamps.length) return null;
      var l = pick(lamps), ms = [];
      for (var i = 0; i < 3; i++) ms.push({ r: rnd(6, 13), w: rnd(2.2, 3.6), ph: rnd(0, 6.28), ry: rnd(0.55, 0.9) });
      return { dur: rnd(8, 12) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.15, 0.2), c = P(l.hu, l.hv, l.hd);
          for (var i = 0; i < ms.length; i++) {
            var m = ms[i], x = c[0] + Math.cos(now * 0.001 * m.w + m.ph) * m.r + Math.sin(now * 0.0031 + m.ph) * 2, y = c[1] + Math.sin(now * 0.0013 * m.w + m.ph) * m.r * m.ry;
            ctx.fillStyle = 'rgba(255,236,190,' + (0.55 + 0.35 * Math.sin(now * 0.02 + m.ph)) * a + ')';
            ctx.beginPath(); ctx.ellipse(x, y, 1.5, 0.9, Math.sin(now * 0.02 + m.ph), 0, 6.283); ctx.fill();
          }
        } };
    },
    fireflies: function (fr) {   // светлячки над газоном: медленно плывут и мягко мигают
      var L = SC(fr).lawn, fs = []; if (!L) return null;   // у кадра нет газона — нет и светлячков
      for (var i = 0; i < 6; i++) fs.push({ u: rnd(L[0], L[2]), v: rnd(L[1], L[3]), du: rnd(-0.06, 0.06), dv: rnd(-0.03, 0.03), ph: rnd(0, 6.28), sp: rnd(0.9, 1.7) });
      return { dur: rnd(12, 17) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.15, 0.2);
          for (var i = 0; i < fs.length; i++) {
            var f = fs[i], p = P(f.u + f.du * t, f.v + f.dv * t + 0.006 * Math.sin(now * 0.0009 * f.sp + f.ph), 0.5);
            var g = Math.max(0, Math.sin(now * 0.0018 * f.sp + f.ph)), al = g * g * 0.95 * a;
            ctx.fillStyle = 'rgba(214,236,150,' + al * 0.28 + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], 4.2, 0, 6.283); ctx.fill();
            ctx.fillStyle = 'rgba(236,246,180,' + al + ')'; ctx.beginPath(); ctx.arc(p[0], p[1], 1.3, 0, 6.283); ctx.fill();
          }
        } };
    },
    winlight: function (fr) {   // в окне главного здания зажигается и гаснет свет
      var f = V.entry(V.frame()), lit = f.nightLit, wl = f.winList;
      if (!wl || !wl.length) return null;
      var c = []; for (var i = 0; i < wl.length; i++) if (!lit || !lit[i]) c.push(wl[i]);
      if (!c.length) return null;
      var w = pick(c);
      return { dur: rnd(6, 10) * 1000,
        draw: function (e, t, now) {
          var a = env(t, 0.2, 0.25), fe = V.entry(V.frame()), p = V.project(fe, w.u, w.v, fe.dB), q = V.project(fe, w.u + w.w * 0.5, w.v + w.h * 0.5, fe.dB);
          var rx = Math.max(2, Math.abs(q[0] - p[0])), ry = Math.max(1.5, Math.abs(q[1] - p[1]));
          ctx.fillStyle = 'rgba(255,214,140,' + 0.9 * a + ')'; ctx.beginPath(); ctx.ellipse(p[0], p[1], rx, ry, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,214,140,' + 0.16 * a + ')'; ctx.beginPath(); ctx.ellipse(p[0], p[1], rx * 1.9, ry * 1.9, 0, 0, 6.283); ctx.fill();
        } };
    }
  };
  function dirOf(e) { return e.u1 > e.u0 ? 1 : -1; }

  function spawn(fr, key) {
    var life = SC(fr).life, list = life && life[key]; if (!list || !list.length) return;
    var choices = list.filter(function (k) { return k !== lastKind; });
    var kind = pick(choices.length ? choices : list), e = KINDS[kind](fr);
    if (!e) { return; }
    e.kind = kind; e.t0 = performance.now(); lastKind = kind;
    active.push(e);
  }

  // ---------- КРУПНЫЙ ПЛАН (кадр с closeUp): блики в окнах, птицы на крыше, флаг ----------
  // Вращать здание не стали: рисунок плоский, поворот выглядит как перекос. Жизнь — поверх картинки, тем же карандашом.
  var glints = [], nextGlint = 0, perch = null;
  var cu = null;   // крупный план текущего кадра (closeUp из настроек здания): perch — кромка, куда садятся птицы; mast — мачта флага

  function sitBird(x, y, s, face, head, col, a) {   // сидящая птичка: тело, голова, клюв, хвост, лапки — карандашом
    ctx.save(); ctx.translate(x, y); ctx.scale(face, 1);
    ctx.strokeStyle = 'rgba(' + col + ',' + a + ')'; ctx.fillStyle = 'rgba(' + col + ',' + 0.78 * a + ')'; ctx.lineWidth = 0.9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.ellipse(0, -2.6 * s, 3.4 * s, 2.3 * s, -0.15, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(3.1 * s, -4.6 * s + head * 0.6 * s, 1.55 * s, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4.5 * s, -4.7 * s + head * 0.6 * s); ctx.lineTo(6.1 * s, -4.3 * s + head * 0.6 * s); ctx.lineTo(4.6 * s, -4.0 * s + head * 0.6 * s); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-3.2 * s, -2.8 * s); ctx.lineTo(-6.6 * s, -1.6 * s + head * 0.5 * s); ctx.stroke();   // хвост
    ctx.beginPath(); ctx.moveTo(-0.6 * s, -0.5 * s); ctx.lineTo(-0.6 * s, 0.4 * s); ctx.moveTo(1.2 * s, -0.5 * s); ctx.lineTo(1.2 * s, 0.4 * s); ctx.stroke();
    ctx.restore();
  }
  function drawGlints(now, f, w) {
    if (w.n < 0.6 && now >= nextGlint && f.winList && f.winList.length && glints.length < 3) {
      var wn = f.winList[(Math.random() * f.winList.length) | 0];
      glints.push({ w: wn, t0: now, dur: rnd(1000, 1700) }); nextGlint = now + rnd(350, 1400);
    }
    for (var i = glints.length - 1; i >= 0; i--) {
      var g = glints[i], t = (now - g.t0) / g.dur; if (t >= 1) { glints.splice(i, 1); continue; }
      var p = V.project(f, g.w.u, g.w.v, f.dB), q = V.project(f, g.w.u + g.w.w * 0.5, g.w.v + g.w.h * 0.5, f.dB);
      var rx = Math.max(2.5, Math.abs(q[0] - p[0])), ry = Math.max(2, Math.abs(q[1] - p[1])), e = Math.sin(Math.PI * t);
      ctx.save(); ctx.beginPath(); ctx.ellipse(p[0], p[1], rx, ry, 0, 0, 6.283); ctx.clip();   // блик скользит по стеклу слева направо
      var cx = p[0] - rx * 1.2 + t * rx * 2.4;
      ctx.fillStyle = 'rgba(' + (w.s > 0.5 ? '255,226,170' : '255,252,235') + ',' + 0.62 * e + ')';
      ctx.beginPath(); ctx.moveTo(cx - rx * 0.35, p[1] + ry); ctx.lineTo(cx - rx * 0.05, p[1] + ry); ctx.lineTo(cx + rx * 0.35, p[1] - ry); ctx.lineTo(cx + rx * 0.05, p[1] - ry); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (e > 0.5) { ctx.strokeStyle = 'rgba(255,250,225,' + 0.7 * (e - 0.5) * 2 + ')'; ctx.lineWidth = 0.8; var sx = cx, sy = p[1] - ry * 0.3, L = Math.min(rx, 6) * 0.9; ctx.beginPath(); ctx.moveTo(sx - L, sy); ctx.lineTo(sx + L, sy); ctx.moveTo(sx, sy - L); ctx.lineTo(sx, sy + L); ctx.stroke(); }
    }
  }
  function newPerch(now) {   // цикл птицы: прилёт (~2.4 с) → сидит (5–10 с, поворачивает голову) → взлёт (~2.2 с) → пауза
    var spot = cu.perch[(Math.random() * cu.perch.length) | 0], fromLeft = Math.random() < 0.5;
    return { spot: spot, t0: now + rnd(1500, 6000), fly: rnd(2200, 2800), sit: rnd(5000, 10000), out: rnd(2000, 2500), left: fromLeft, ph: rnd(0, 6.28), face: fromLeft ? 1 : -1 };
  }
  function drawPerch(now, f, w) {
    if (!perch) perch = newPerch(now);
    var b = perch, t = now - b.t0, a0 = 1 - sstep(0.45, 0.8, w.n);
    if (t < 0 || a0 < 0.02) { if (t > b.fly + b.sit + b.out) perch = null; return; }
    var col = ink(), s = sf() * 1.5, d = f.dB, spot = P(b.spot[0], b.spot[1], d), ph = b.ph;
    if (t < b.fly) {   // прилёт: издалека по дуге, крылья машут, к концу — быстрее и садится
      var k = t / b.fly, e = 1 - Math.pow(1 - k, 2.2), sx = b.left ? -0.12 : 1.12, from = P(sx, b.spot[1] - 0.16, d);
      var x = from[0] + (spot[0] - from[0]) * e, y = from[1] + (spot[1] - from[1]) * e - Math.sin(Math.PI * k) * 12 * s;
      var fl = Math.sin(now * (0.011 + 0.01 * k) + ph);
      ctx.save(); if (b.face < 0) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.translate(-x, -y); } bird(x, y, 4.6 * s, fl, col, 0.85 * a0, 1.3); ctx.restore();
    } else if (t < b.fly + b.sit) {   // сидит: иногда поворачивает голову, дёргает хвостом
      var st = t - b.fly, head = Math.sin(st * 0.0012 + ph) > 0.6 ? Math.sin(st * 0.02) * 0.6 : 0;
      sitBird(spot[0], spot[1], s, b.face, head, col, 0.9 * a0);
    } else if (t < b.fly + b.sit + b.out) {   // взлёт: быстрые взмахи, вверх и в сторону
      var k2 = (t - b.fly - b.sit) / b.out, e2 = k2 * k2, dx = (b.face > 0 ? 1 : -1) * 0.35 * e2, up = -0.2 * e2;
      var pt = P(b.spot[0] + dx, b.spot[1] + up, d), fl2 = Math.sin(now * 0.02 + ph);
      ctx.save(); if (b.face < 0) { ctx.translate(pt[0], pt[1]); ctx.scale(-1, 1); ctx.translate(-pt[0], -pt[1]); } bird(pt[0], pt[1], 4.6 * s, fl2, col, 0.85 * a0 * (1 - sstep(0.7, 1, k2)), 1.3); ctx.restore();
    } else perch = newPerch(now + rnd(2000, 6000) - 1500);
  }
  function drawRoofFlag(now, w) {   // мачта на кромке крыши и колышущийся триколор
    var a = 1 - 0.55 * w.n, s = sf(), f = V.entry(V.frame()), b = V.project(f, cu.mast[0], cu.mast[1], f.dB), t = V.project(f, cu.mast[2], cu.mast[3], f.dB);
    var col = ink(), fw = 15 * s, fh = 9 * s, top = t[1] + 1;
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(' + col + ',0.85)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(t[0], t[1] - 1); ctx.stroke();
    var cols = ['217,32,48', '36,84,200', '244,170,10'], tt = now * 0.004;
    for (var k = 0; k < 3; k++) {   // три полосы, каждая — волна по ветру
      ctx.fillStyle = 'rgba(' + cols[k] + ',0.9)'; ctx.beginPath();
      var y0 = top + k * fh / 3, y1 = top + (k + 1) * fh / 3;
      ctx.moveTo(t[0], y0);
      for (var i = 1; i <= 6; i++) ctx.lineTo(t[0] + fw * i / 6, y0 + Math.sin(tt + i * 0.9) * fh * 0.13 * (i / 6));
      for (i = 6; i >= 0; i--) ctx.lineTo(t[0] + fw * i / 6, y1 + Math.sin(tt + i * 0.9) * fh * 0.13 * (i / 6));
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(' + col + ',0.7)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(t[0], top);
    for (i = 1; i <= 6; i++) ctx.lineTo(t[0] + fw * i / 6, top + Math.sin(tt + i * 0.9) * fh * 0.13 * (i / 6));
    ctx.lineTo(t[0] + fw, top + fh + Math.sin(tt + 5.4) * fh * 0.13); for (i = 6; i >= 0; i--) ctx.lineTo(t[0] + fw * i / 6, top + fh + Math.sin(tt + i * 0.9) * fh * 0.13 * (i / 6)); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  function drawCloseUp(now, w, f, c) { cu = c; if (c.glints) drawGlints(now, f, w); if (c.perch) drawPerch(now, f, w); if (c.mast) drawRoofFlag(now, w); }

  // ---------- ПАРАД: три истребителя плотным строем слева направо, дымные следы 15–20 с: красный, синий, абрикосовый — флаг Армении ----------
  var PC = [{ day: '214,20,36', night: '255,84,96' }, { day: '32,72,196', night: '104,150,255' }, { day: '242,168,0', night: '255,196,64' }];   // сверху вниз
  var smokeSpr = null;
  function smoke(i) {
    if (!smokeSpr) smokeSpr = PC.map(function (c) {
      return [c.day, c.night].map(function (col) {
        var s = document.createElement('canvas'); s.width = s.height = 64; var x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(' + col + ',1)'); g.addColorStop(0.5, 'rgba(' + col + ',0.55)'); g.addColorStop(1, 'rgba(' + col + ',0)');
        x.fillStyle = g; x.beginPath(); x.arc(32, 32, 32, 0, 6.283); x.fill(); return s;
      });
    });
    return smokeSpr[i];
  }
  function startParade(onEnd) {
    var fr = V.frame(); if (par || V.fading() || !V.entry(fr)) return false;
    var band = SC(fr).skyBand, vc = band[0] + (band[1] - band[0]) * 0.30, now = performance.now();
    par = { t0: now, dur: 11000, vc: vc, fr: fr, onEnd: onEnd, puffs: [], last: [-0.12, -0.12, -0.12], flying: true, abort: 0, dv: 0.0135 };
    active = [];   // небо освобождаем: события на время парада не начинаем
    return true;
  }
  function endParade() { var f = par && par.onEnd; par = null; if (f) f(); }
  function abortParade() { if (par && !par.abort) par.abort = performance.now(); }
  function stepParade(now, w) {
    if (now - par.t0 > 50000) { endParade(); return; }   // страховка: показ не может длиться дольше 50 с (кнопка не зависнет)
    var t = (now - par.t0) / par.dur, i;
    if (par.flying) {
      var u = lerp(-0.12, 1.12, clamp(t, 0, 1));   // все три идут строем, слева направо
      for (i = 0; i < 3; i++) {
        while (par.last[i] + 0.0085 <= u && par.last[i] < 1.12) { par.last[i] += 0.0085; par.puffs.push({ i: i, u: par.last[i], born: par.t0 + par.dur * ((par.last[i] + 0.12) / 1.24), life: rnd(15, 20) * 1000, jx: rnd(-1, 1), jy: rnd(-1, 1), rr: rnd(0.9, 1.12) }); }
      }
      if (t >= 1) par.flying = false;
    }
    var nn = wts().n, ai = nn > 0.5 ? 1 : 0, s0 = sf(), alive = 0;
    var kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0;
    ctx.save();
    if (nn > 0.5) ctx.globalCompositeOperation = 'lighter';
    for (i = par.puffs.length - 1; i >= 0; i--) {
      var q = par.puffs[i], age = now - q.born; if (age < 0) continue;
      if (age >= q.life || kill >= 1) { par.puffs.splice(i, 1); continue; }
      alive++;
      var k = age / q.life, r = (2.4 + 13.5 * Math.pow(k, 0.62)) * s0 * q.rr, drift = Math.sqrt(age / 1000);
      var vv = par.vc + (q.i - 1) * par.dv - 0.012 * clamp((q.u + 0.12) / 1.24, 0, 1);
      var p = P(q.u + 0.0011 * drift * q.jx, vv + 0.0009 * drift * q.jy + 0.00035 * drift, 0);
      var a = 0.62 * Math.min(1, age / 250) * Math.pow(1 - k, 1.5) * (1 - kill) * (nn > 0.5 ? 0.85 : 1);
      ctx.globalAlpha = a;
      ctx.drawImage(smoke(q.i)[ai], p[0] - r, p[1] - r, 2 * r, 2 * r);
    }
    ctx.restore();
    if (par.flying) {   // сами самолёты: маленькие силуэты дельтой
      var u2 = lerp(-0.12, 1.12, clamp(t, 0, 1)), col = ink(), s = 5.2 * s0;
      for (i = 0; i < 3; i++) {
        var pj = P(u2, par.vc + (i - 1) * par.dv - 0.012 * clamp(t, 0, 1), 0), ea = env(clamp(t, 0, 1), 0.04, 0.04) * (1 - kill);
        ctx.fillStyle = 'rgba(' + (nn > 0.5 ? '214,222,240' : col) + ',' + 0.92 * ea + ')';
        ctx.beginPath(); ctx.moveTo(pj[0] + s * 1.15, pj[1]); ctx.lineTo(pj[0] - s * 0.7, pj[1] - s * 0.62); ctx.lineTo(pj[0] - s * 0.3, pj[1]); ctx.lineTo(pj[0] - s * 0.7, pj[1] + s * 0.62); ctx.closePath(); ctx.fill();
        ctx.fillRect(pj[0] - s * 0.95, pj[1] - 0.5, s * 0.5, 1);
      }
    }
    if (!par.flying && alive === 0) endParade();
    if (kill >= 1) endParade();
  }

  function setShow(k) { if (cv && Math.abs(k - showK) > 0.004) { showK = k; cv.style.opacity = k >= 0.999 ? '' : k.toFixed(3); } }
  function clear() { if (ctx && drawn) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; } }

  function frame(now) {
    if (!V) return;
    ensureCanvas(); fit();
    var fr = V.frame(), key = todKey(), f = V.entry(fr);
    if (!f) return;
    // смена кадра: события растворяются, небо и машины раскладываются заново; парад прерывается
    if (fr !== lastFrame) { active = []; glints = []; perch = null; abortParade(); buildAmbient(fr); lastFrame = fr; lastKey = key; nextAt = now + rnd(2200, 4200); lastKind = ''; }
    else if (key !== lastKey) { active = []; lastKey = key; nextAt = now + rnd(2200, 4200); lastKind = ''; }
    if (V.fading()) { clear(); showT0 = null; setShow(0); return; }
    // слой (облака, солнце, птицы) проявляется плавно — и при первом показе, и после смены кадра, а не выскакивает поверх картинки
    if (showT0 === null) showT0 = now;
    var sk = Math.min(1, (now - showT0) / 1400); setShow(sk * sk * (3 - 2 * sk));
    var wx = wxNow(), dtc = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0; lastT = now;
    cloudT += dtc * (wx.wind - 1);   // при ветре облака бегут быстрее
    ocSlow += Math.max(-dtc / 4, Math.min(dtc / 8, wx.oc - ocSlow));
    wx.oc = ocSlow;
    if (wx.wind > 1.6 && key !== 'night' && !par && now >= nextKite && !active.some(function (a) { return a.kind === 'kite'; }) && KINDS.kite) {   // ветрено — в небе змей
      var ek = KINDS.kite(fr); if (ek) { ek.kind = 'kite'; ek.t0 = now; active.push(ek); }
      nextKite = now + rnd(14000, 22000);
    }
    UNIT = unit();
    if (key && !par && now >= nextAt && active.length < 2) { spawn(fr, key); nextAt = now + rnd(8000, 15000); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H); drawn = true;
    var w = wts();
    drawSun(now, w, fr);
    drawClouds(now, w, wx);
    var fz = V.weather && V.weather().flash;
    if (fz > 0.02) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; cloudMul = Math.min(1, fz * 1.4); drawClouds(now, w, wx); cloudMul = 1; ctx.restore(); }   // гроза: облака светятся изнутри
    drawAmbientBirds(now, w);
    if (SC(fr).closeUp) drawCloseUp(now, w, f, SC(fr).closeUp);
    for (var i = active.length - 1; i >= 0; i--) {
      var e = active[i], t = (now - e.t0) / e.dur;
      if (t >= 1) { active.splice(i, 1); continue; }
      ctx.save(); e.draw(e, t, now); ctx.restore();
    }
    if (par) stepParade(now, w);
  }

  root.Details = {
    init: function (api) { V = api; setTimeout(function () { clouds(); smoke(0); }, 300); },   // спрайты облаков и дыма рисуем заранее, не в первом кадре показа
    frame: frame,
    // для проверки: показать событие сразу (tFrac — с какой доли пути начать)
    test: function (kind, tFrac) {
      var e = KINDS[kind](V.frame()); if (!e) return false;
      e.kind = kind; e.t0 = performance.now() - e.dur * (tFrac || 0.4); active.push(e); return true;
    },
    parade: startParade,          // Details.parade(onEnd) -> true, если показ начался; onEnd — когда следы растаяли
    paradeAbort: abortParade,
    paradeBusy: function () { return !!par; },
    // выключить всё (fps ниже порога или «уменьшение движения»): очистить холст, парад прервать
    off: function () { active = []; glints = []; perch = null; if (par) endParade(); clear(); showT0 = null; }
  };
})(window);
