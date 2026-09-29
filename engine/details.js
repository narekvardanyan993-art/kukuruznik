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
  // closeUp (крупный план: glints — блики в окнах, perch — кромка, куда садятся птицы, mast — мачта флага [u низ, v низ, u верх, v верх]; banner — знамя [u середины, v карниза, v низа, полуширина])
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
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
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
  // Облака (e1.3): мягкая акварель — размытый край, светлый верх, тень снизу, лёгкое зерно бумаги и едва заметная карандашная линия.
  // Мягкий край скрывает субпиксельные рывки при медленном движении (у чёткого контура они были видны).
  var TINT = [
    { body: [255, 255, 255, 0.78], shade: [150, 164, 186, 0.42], rim: [255, 255, 255, 0.5], line: 'rgba(90,96,108,0.16)' },     // день
    { body: [255, 232, 214, 0.72], shade: [196, 128, 120, 0.42], rim: [255, 214, 170, 0.55], line: 'rgba(120,70,56,0.16)' },   // закат
    { body: [44, 50, 70, 0.72], shade: [22, 26, 40, 0.6], rim: [130, 142, 176, 0.38], line: 'rgba(150,160,190,0.12)' }         // ночь: тёмные, с холодной кромкой сверху
  ];
  var cloudSpr = null;
  function makeCloud(shape, tint) {
    var S = 3, sh = SHAPES[shape], T = TINT[tint], R = seeded(700 + shape * 13 + tint * 5);
    function cv2() { var c = document.createElement('canvas'); c.width = 160 * S; c.height = 70 * S; var x = c.getContext('2d'); x.scale(S, S); return [c, x]; }
    var bx = (sh.base[0] + sh.base[1]) / 2, bw = (sh.base[1] - sh.base[0]) / 2, by = (sh.base[2] + sh.base[3]) / 2, bh = (sh.base[3] - sh.base[2]) / 2 + 2;
    function union(g, k) { k = k || 1; g.beginPath(); sh.puffs.forEach(function (p) { g.moveTo(p[0] + p[2] * k, p[1]); g.arc(p[0], p[1], p[2] * k, 0, 6.283); }); g.moveTo(bx + bw * k, by); g.ellipse(bx, by, bw * k, bh * k, 0, 0, 6.283); }
    var top = Math.min.apply(null, sh.puffs.map(function (p) { return p[1] - p[2]; })), bot = by + bh;
    var rgba = function (a, m) { return 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',' + (a[3] * (m == null ? 1 : m)) + ')'; };
    // форма: заливка + затенённый низ + светлый верх
    var f = cv2(), fc = f[0], fx = f[1];
    fx.fillStyle = rgba(T.body); union(fx); fx.fill();
    fx.save(); union(fx); fx.clip();
    var g = fx.createLinearGradient(0, top, 0, bot); g.addColorStop(0, rgba(T.shade, 0)); g.addColorStop(0.55, rgba(T.shade, 0.35)); g.addColorStop(1, rgba(T.shade));
    fx.fillStyle = g; fx.fillRect(0, 0, 160, 70);
    sh.puffs.forEach(function (p) { var rg = fx.createRadialGradient(p[0] - p[2] * 0.3, p[1] - p[2] * 0.45, 0, p[0], p[1], p[2]); rg.addColorStop(0, rgba(T.rim)); rg.addColorStop(1, rgba(T.rim, 0)); fx.fillStyle = rg; fx.beginPath(); fx.arc(p[0], p[1], p[2], 0, 6.283); fx.fill(); });
    for (var i = 0; i < 260; i++) { fx.fillStyle = 'rgba(0,0,0,' + (0.03 * R()) + ')'; fx.fillRect(R() * 160, top + R() * (bot - top), 0.7, 0.7); }   // зерно бумаги
    fx.restore();
    // мягкий край: форма, «размытая» наложением со сдвигами по кругу
    var o = cv2(), oc = o[0], ox = o[1];
    for (var k = 0; k < 12; k++) { var an = k / 12 * 6.283, rr = 1.6; ox.globalAlpha = 0.11; ox.drawImage(fc, Math.cos(an) * rr, Math.sin(an) * rr, 160, 70); }
    ox.globalAlpha = 0.55; ox.drawImage(fc, 0, 0, 160, 70); ox.globalAlpha = 1;
    ox.strokeStyle = T.line; ox.lineWidth = 0.6; ox.lineJoin = 'round';   // едва заметная карандашная линия — связь с рисунком кадра
    sh.puffs.forEach(function (p, n) { if (n % 2) return; ox.beginPath(); ox.arc(p[0], p[1], p[2] * 0.98, 3.4, 5.6); ox.stroke(); });
    return oc;
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
  function drawRoofFlag(now, w) {   // мачта на крыше и триколор: закреплён у мачты, свободный край обвисает; на ветру вытягивается и полощет сильнее
    var a = 1 - 0.55 * w.n, s = sf(), f = V.entry(V.frame()), b = V.project(f, cu.mast[0], cu.mast[1], f.dB), t = V.project(f, cu.mast[2], cu.mast[3], f.dB);
    var col = ink(), fh = Math.min(9 * s, (b[1] - t[1]) * 0.42), fw = fh * 1.7, top = t[1] + 1.5, tt = now / 1000, wd = clamp((wxNow().wind - 1) / 3.5, 0, 1);
    ctx.save(); ctx.globalAlpha = 1; ctx.lineCap = 'round';
    var N = 8, pt = function (i, j) {
      var fr = i / N, ext = 0.8 + 0.2 * wd;
      var wv = Math.sin(tt * (2.4 + 2.5 * wd) - i * 0.85 + j * 0.2) * fh * (0.08 + 0.1 * wd) * fr;
      return [t[0] + fw * fr * ext, top + fh * j / 3 * (1 - 0.1 * fr * (1 - wd)) + wv + (1 - wd) * fh * 0.3 * fr * fr];
    };
    pt.N = N; inkFlag(pt, WFLAG, w.n, a);
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.9 * a).toFixed(3) + ')'; ctx.lineWidth = Math.max(1, 1.2 * s);   // мачта стоит на крыше, наверху — шарик
    ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(t[0], t[1] - 1); ctx.stroke();
    ctx.fillStyle = 'rgba(' + col + ',' + (0.9 * a).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(t[0], t[1] - 1.5, Math.max(1, 1.3 * s), 0, 6.283); ctx.fill();
    ctx.fillRect(b[0] - 2 * s, b[1] - 1, 4 * s, 1.5);
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
  function startParade(onEnd, style) {
    var fr = V.frame(); if (par || V.fading() || !V.entry(fr)) return false;
    var band = SC(fr).skyBand, vc = band[0] + (band[1] - band[0]) * 0.30, now = performance.now();
    style = style || 'planes';
    var behind = /:behind$/.test(style) || (!!SC(fr).closeUp && style !== 'banner'); style = style.replace(/:behind$/, '');
    var skyOnly = style === 'balloons' || style === 'fireworks';   // шары и ракеты поднимаются из-за города
    par = { t0: now, dur: ({ drones: 22000, heli: 26000, fireworks: 27500, balloons: 20000, banner: 22000 })[style] || 11000, total: style === 'planes' ? 26000 : 0, vc: vc, fr: fr, onEnd: onEnd, puffs: [], last: [-0.12, -0.12, -0.12], flying: true, abort: 0, dv: 0.0135, style: style, behind: behind, skyOnly: skyOnly };
    if (skyOnly) skyMaskD(fr);
    if (behind) bldSprite(fr);
    active = [];   // небо освобождаем: события на время парада не начинаем
    return true;
  }
  function endParade() { var f = par && par.onEnd; par = null; if (f) f(); }
  function abortParade() { if (par && !par.abort) par.abort = performance.now(); }
  // ---- варианты парада (e1.3): дроны складываются во флаг; вертолёт несёт флаг. На кадре с крупным планом — пролёт за зданием ----
  var FLAGC = ['217,0,18', '28,76,192', '242,168,0'];
  function bldSprite(fr) {
    var F = root.CONFIG.FRAMES[fr]; if (!F || !F.building) return null;
    var key = F.building.color; if (bldImg && bldImg.key === key) return bldImg.ok ? bldImg.im : null;
    var im = new Image(); bldImg = { key: key, im: im, ok: false }; im.onload = function () { bldImg.ok = true; }; im.src = key; return null;
  }
  var bldImg = null, lay = null;
  // пролёт «за зданием»: парад рисуется на отдельном слое, там стирается силуэт здания, потом слой ложится на холст (облака и солнце не трогаются)
  var skyM = {};
  function skyMaskD(fr) {   // маска неба кадра из карты окружения (R — небо): всё, что ниже линии города, прячется
    if (skyM[fr]) return skyM[fr] === 'loading' ? null : skyM[fr];
    skyM[fr] = 'loading';
    var F = root.CONFIG.FRAMES[fr], im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function () { try { var FS = root.CONFIG.FRAME_SIZE, mw = 192, mh = Math.round(mw * FS[1] / FS[0]), c = document.createElement('canvas'); c.width = mw; c.height = mh; var x = c.getContext('2d'); x.drawImage(im, 0, 0, mw, mh); var id = x.getImageData(0, 0, mw, mh), D = id.data; for (var k = 0; k < D.length; k += 4) { D[k + 3] = D[k]; } x.putImageData(id, 0, 0); skyM[fr] = c; } catch (e) { skyM[fr] = null; } };
    im.onerror = function () { skyM[fr] = null; }; im.src = F.env; return null;
  }
  function paradeLayer(now, w) {
    if (!par.behind && !par.skyOnly) { stepParade(now, w); return; }
    if (!lay) lay = document.createElement('canvas');
    if (lay.width !== cv.width || lay.height !== cv.height) { lay.width = cv.width; lay.height = cv.height; }
    var lc = lay.getContext('2d'), main = ctx, fr = par.fr;
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, lay.width, lay.height); lc.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx = lc;
    var so = par.skyOnly;
    try {
      stepParade(now, w);
      if (!so) occlude(fr);
      else { var m = skyMaskD(fr), f = V.entry(fr); if (m && f) { var a0 = V.project(f, 0, 0, 0), a1 = V.project(f, 1, 1, 0); ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(m, a0[0], a0[1], a1[0] - a0[0], a1[1] - a0[1]); ctx.restore(); } }
    } finally { ctx = main; }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lay, 0, 0); ctx.restore();
  }
  function occlude(fr) {   // стираем нарисованное там, где стоит здание (оно ближе), — самолёт/вертолёт/дроны уходят «за» него
    var im = bldSprite(fr), f = V.entry(fr); if (!im || !f || !V.projectB) return;
    var a = V.projectB(f, 0, 0), b = V.projectB(f, 1, 1);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(im, a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.restore();
  }
  // --- дроны (e1.4): светящиеся точки — спрайты с белым ядром и цветным ореолом (ночью складываются «лучи» — режим lighter);
  //     днём — чернильные квадрокоптеры: у каждого своя дуга подлёта, лёгкое зависание-покачивание, наклон по ходу движения ---
  var glowSpr = {};
  function glowS(col) {   // спрайт свечения: белое ядро → цвет → прозрачность (рисуется один раз на цвет)
    if (glowSpr[col]) return glowSpr[col];
    var s = document.createElement('canvas'); s.width = s.height = 64; var x = s.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.1, 'rgba(255,255,255,0.95)'); g.addColorStop(0.2, 'rgba(' + col + ',0.9)');
    g.addColorStop(0.45, 'rgba(' + col + ',0.28)'); g.addColorStop(0.75, 'rgba(' + col + ',0.07)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return (glowSpr[col] = s);
  }
  function drone(x, y, r, col, a, tilt) {   // квадрокоптер: корпус, 4 луча, размытые диски винтов; tilt — наклон по ходу
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(' + col + ',0.9)'; ctx.lineWidth = Math.max(0.7, r * 0.26);
    ctx.beginPath(); ctx.moveTo(-r, -r * 0.35); ctx.lineTo(r, r * 0.35); ctx.moveTo(-r, r * 0.35); ctx.lineTo(r, -r * 0.35); ctx.stroke();
    ctx.fillStyle = 'rgba(' + col + ',0.95)'; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.42, r * 0.3, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(' + col + ',0.22)'; ctx.strokeStyle = 'rgba(' + col + ',0.45)'; ctx.lineWidth = Math.max(0.5, r * 0.12);
    [[-1, -0.35], [1, 0.35], [-1, 0.35], [1, -0.35]].forEach(function (q) { ctx.beginPath(); ctx.ellipse(q[0] * r, q[1] * r - r * 0.18, r * 0.62, r * 0.16, 0, 0, 6.283); ctx.fill(); ctx.stroke(); });
    ctx.restore();
  }
  function stepDrones(now, w) {
    var t = (now - par.t0) / 1000, nn = wts().n, s0 = sf(), kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0;
    if (!par.dr) {   // 14×6 дронов: 2 ряда на цвет; влетают тремя стаями слева, каждый по своей дуге и в свой момент
      par.dr = [];
      for (var r = 0; r < 6; r++) for (var c = 0; c < 14; c++) {
        var lane = Math.floor(r / 2);
        par.dr.push({ r: r, c: c, su: -0.06 - c * 0.025 - Math.random() * 0.06, sv: par.vc - 0.06 + lane * 0.05 + (Math.random() - 0.5) * 0.04,
          cu: 0.15 + Math.random() * 0.3, cv: par.vc - 0.07 - Math.random() * 0.06, eu: 1.1 + Math.random() * 0.3, ev: par.vc - 0.08 + (Math.random() - 0.5) * 0.2,
          dl: lane * 0.7 + (13 - c) * 0.09 + Math.random() * 0.35, ph: Math.random() * 6.28, ph2: Math.random() * 6.28, sz: 0.85 + Math.random() * 0.3, px: null, py: null });
      }
    }
    var fw = 0.5, fh = 0.085, u0 = 0.5 - fw / 2, v0 = par.vc - fh / 2 + 0.02, body = nn > 0.5 ? '150,158,180' : ink();
    var fade = (1 - kill) * clamp(t / 0.6, 0, 1) * (1 - clamp((t - 20.5) / 1.5, 0, 1));
    var litAll = clamp((t - 8.5) / 1.2, 0, 1) * (1 - clamp((t - 16.5) / 1.2, 0, 1));
    ctx.save();
    if (litAll > 0.01 && nn > 0.3) {   // ночью флаг из огней подсвечивает небо вокруг — мягкое цветное зарево за строем
      ctx.globalCompositeOperation = 'lighter';
      for (var b = 0; b < 3; b++) {
        var pc = P(0.5, v0 + fh * (b * 2 + 0.5) / 5, 0), rw = P(u0 - 0.04, 0, 0)[0], g = ctx.createRadialGradient(pc[0], pc[1], 0, pc[0], pc[1], pc[0] - rw);
        g.addColorStop(0, 'rgba(' + FLAGC[b] + ',' + (0.16 * litAll * fade * nn).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + FLAGC[b] + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(pc[0], pc[1], pc[0] - rw, (pc[0] - rw) * 0.35, 0, 0, 6.283); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (var i = 0; i < par.dr.length; i++) {
      var q = par.dr[i], tu = u0 + fw * q.c / 13, tv = v0 + fh * q.r / 5;
      var kin = clamp((t - q.dl) / 5.2, 0, 1), kout = clamp((t - 17 - q.dl * 0.3) / 4.2, 0, 1);
      kin = 1 - Math.pow(1 - kin, 3);   // быстрый разгон, долгое мягкое торможение у своей точки
      kout = kout * kout * kout;
      var m = 1 - kin, u = m * m * q.su + 2 * m * kin * q.cu + kin * kin * tu, v = m * m * q.sv + 2 * m * kin * q.cv + kin * kin * tv;   // дуга подлёта
      var hov = 0.5 + 0.5 * kin;   // зависание: каждый чуть «плавает» в воздухе, ряд идёт мягкой волной
      u += hov * 0.0016 * Math.sin(t * 1.3 + q.ph) ; v += hov * (0.0014 * Math.sin(t * 1.7 + q.ph2) + 0.004 * Math.sin(t * 1.1 - q.c * 0.4) * clamp((t - 9) / 2, 0, 1));
      u += (q.eu - u) * kout; v += (q.ev - v) * kout - 0.04 * Math.sin(kout * Math.PI);
      var pp = P(u, v, 0), vx = q.px === null ? 0 : pp[0] - q.px; q.px = pp[0]; q.py = pp[1];
      var tilt = clamp(vx * 0.08, -0.35, 0.35), rr = 2.1 * s0 * q.sz, col = FLAGC[Math.floor(q.r / 2)];
      var lit = clamp((t - 8.5 - q.c * 0.06) / 0.5, 0, 1) * (1 - clamp((t - 16.5 + q.c * 0.03) / 0.9, 0, 1));   // огни загораются волной слева направо
      var tw = 0.88 + 0.12 * Math.sin(t * 9 + q.ph * 3);   // лёгкое мерцание
      if (nn <= 0.5 || lit < 0.95) drone(pp[0], pp[1], rr, body, fade * (nn > 0.5 ? 0.6 * (1 - lit) : 1 - lit * 0.55), tilt);
      ctx.globalCompositeOperation = nn > 0.5 ? 'lighter' : 'source-over';   // днём свет на светлом небе — обычным наложением, иначе цвет выгорает в белый
      if (lit > 0.01) { var gs = rr * (nn > 0.5 ? 7 : 4.2) * (0.9 + 0.1 * tw); ctx.globalAlpha = fade * lit * (nn > 0.5 ? 1 : 0.75) * tw; ctx.drawImage(glowS(col), pp[0] - gs / 2, pp[1] - gs / 2, gs, gs); }
      else if (Math.sin(t * 5 + q.ph * 2) > 0.7) { var ns = rr * (nn > 0.5 ? 3.2 : 1.8); ctx.globalAlpha = fade * (nn > 0.5 ? 0.9 : 0.6); ctx.drawImage(glowS('255,255,255'), pp[0] - ns / 2, pp[1] - ns / 2, ns, ns); }   // навигационный огонёк
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    if (t * 1000 > par.dur || kill >= 1) endParade();
  }
  var WFLAG = ['204,48,56', '52,86,168', '232,168,48'];   // флаг акварелью: чуть приглушённые красный, синий, абрикосовый
  function inkFlag(pt, cols, nn, a) {   // pt(i, j) -> [x, y]: сетка ткани (i — вдоль, 0..N; j — поперёк, 0..3); cols — 3 полосы по j
    var N = pt.N, k, i, line = nn > 0.5 ? '200,208,228' : ink();
    for (k = 0; k < 3; k++) {
      ctx.fillStyle = 'rgba(' + cols[k] + ',' + (0.9 * a).toFixed(3) + ')';
      ctx.beginPath();
      for (i = 0; i <= N; i++) { var q = pt(i, k); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
      for (i = N; i >= 0; i--) { q = pt(i, k + 1); ctx.lineTo(q[0], q[1]); }
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(' + line + ',' + (0.28 * a).toFixed(3) + ')'; ctx.lineWidth = 0.6;   // складки: штрихи поперёк ткани там, где волна уходит в тень
    for (i = 1; i < N; i++) {
      var q0 = pt(i, 0), q3 = pt(i, 3), p0 = pt(i - 1, 0), sh = (q0[1] - p0[1]);
      if (sh > 0.25) { ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q3[0], q3[1]); ctx.stroke(); }
    }
    ctx.strokeStyle = 'rgba(' + line + ',' + (0.8 * a).toFixed(3) + ')'; ctx.lineWidth = 0.9; ctx.lineJoin = 'round';   // контур
    ctx.beginPath();
    for (i = 0; i <= N; i++) { q = pt(i, 0); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
    for (i = N; i >= 0; i--) { q = pt(i, 3); ctx.lineTo(q[0], q[1]); }
    ctx.closePath(); ctx.stroke();
  }
  // --- вертолёт с флагом (e1.4): влетает и тормозит, зависает, потом с разгоном уходит, опустив нос. Флаг — на тросе с грузом:
  //     трос качается маятником (отстаёт при разгоне, догоняет при торможении), на скорости полотнище вытягивается назад, в зависании обвисает ---
  function heliPath(tt) {   // u, v по времени (с): подлёт с торможением 0–8 с, зависание 8–16.5 с, уход с разгоном 16.5–26 с
    var u, v = par.vc - 0.03;
    if (tt < 8) { var k = tt / 8; u = -0.14 + (0.41 + 0.14) * (1 - Math.pow(1 - k, 3)); }
    else if (tt < 16.5) { u = 0.41 + 0.06 * (tt - 8) / 8.5; }
    else { var k3 = (tt - 16.5) / 9.5; u = 0.47 + 0.9 * k3 * k3 + 0.06 * k3 * 0.9; v -= 0.035 * k3 * k3; }
    v += 0.004 * Math.sin(tt * 0.9) + 0.002 * Math.sin(tt * 2.3);   // зависание не бывает идеальным — лёгкое «дыхание»
    return [u, v];
  }
  function heliBody(S, col, a, tt, nn) {   // силуэт Ми-8 чернилами, нос вправо; начало координат — центр корпуса
    var C = function (k) { return 'rgba(' + col + ',' + (k * a).toFixed(3) + ')'; };
    ctx.fillStyle = C(0.9);
    ctx.beginPath(); ctx.moveTo(S * 1.55, S * 0.12);   // корпус: закруглённый нос, кабина, брюхо, хвостовая балка
    ctx.bezierCurveTo(S * 1.6, -S * 0.3, S * 1.25, -S * 0.55, S * 0.7, -S * 0.58); ctx.lineTo(-S * 0.9, -S * 0.55);
    ctx.bezierCurveTo(-S * 1.2, -S * 0.5, -S * 1.35, -S * 0.2, -S * 1.45, -S * 0.08); ctx.lineTo(-S * 3.4, -S * 0.2); ctx.lineTo(-S * 3.45, -S * 0.04); ctx.lineTo(-S * 1.4, S * 0.3);
    ctx.bezierCurveTo(-S * 0.8, S * 0.55, S * 0.6, S * 0.6, S * 1.1, S * 0.48); ctx.bezierCurveTo(S * 1.45, S * 0.4, S * 1.55, S * 0.3, S * 1.55, S * 0.12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-S * 0.5, -S * 0.55); ctx.lineTo(-S * 0.3, -S * 0.85); ctx.lineTo(S * 0.45, -S * 0.85); ctx.lineTo(S * 0.65, -S * 0.56); ctx.closePath(); ctx.fill();   // капот двигателей
    ctx.beginPath(); ctx.moveTo(-S * 3.25, -S * 0.15); ctx.lineTo(-S * 3.6, -S * 0.85); ctx.lineTo(-S * 3.4, -S * 0.88); ctx.lineTo(-S * 3.0, -S * 0.15); ctx.closePath(); ctx.fill();   // киль
    ctx.fillStyle = nn > 0.5 ? 'rgba(255,226,160,' + (0.75 * a).toFixed(3) + ')' : 'rgba(236,240,246,' + (0.8 * a).toFixed(3) + ')';   // остекление кабины и окна
    ctx.beginPath(); ctx.moveTo(S * 1.42, -S * 0.02); ctx.bezierCurveTo(S * 1.42, -S * 0.3, S * 1.18, -S * 0.45, S * 0.88, -S * 0.46); ctx.lineTo(S * 0.9, -S * 0.02); ctx.closePath(); ctx.fill();
    for (var w = 0; w < 4; w++) { ctx.beginPath(); ctx.arc(S * (0.45 - w * 0.36), -S * 0.2, S * 0.09, 0, 6.283); ctx.fill(); }
    ctx.strokeStyle = C(0.9); ctx.lineWidth = Math.max(0.7, S * 0.12); ctx.lineCap = 'round';   // шасси
    ctx.beginPath(); ctx.moveTo(S * 0.9, S * 0.45); ctx.lineTo(S * 0.95, S * 0.78); ctx.moveTo(-S * 0.55, S * 0.5); ctx.lineTo(-S * 0.6, S * 0.8); ctx.stroke();
    ctx.fillStyle = C(0.9); ctx.beginPath(); ctx.arc(S * 0.95, S * 0.82, S * 0.1, 0, 6.283); ctx.arc(-S * 0.6, S * 0.84, S * 0.1, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.moveTo(S * 0.1, -S * 0.85); ctx.lineTo(S * 0.1, -S * 1.02); ctx.stroke();   // вал винта
    var ry = -S * 1.05, R = S * 3.3, ph = tt * 26;   // несущий винт: размытый диск + две лопасти в проекции
    ctx.fillStyle = C(0.12); ctx.beginPath(); ctx.ellipse(S * 0.1, ry, R, S * 0.16, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = C(0.55); ctx.lineWidth = Math.max(0.6, S * 0.08);
    for (var b = 0; b < 2; b++) { var c = Math.cos(ph + b * 1.9); ctx.beginPath(); ctx.moveTo(S * 0.1 - R * c, ry + S * 0.05 * Math.sin(ph + b)); ctx.lineTo(S * 0.1 + R * c, ry - S * 0.05 * Math.sin(ph + b)); ctx.stroke(); }
    ctx.fillStyle = C(0.18); ctx.beginPath(); ctx.arc(-S * 3.45, -S * 0.52, S * 0.55, 0, 6.283); ctx.fill();   // хвостовой винт — размытый круг
    if (nn > 0.3) {   // ночью: красный маячок сверху и белый строб на хвосте
      ctx.globalCompositeOperation = 'lighter';
      if (Math.sin(tt * 5) > 0.2) { ctx.globalAlpha = a * nn; var g1 = S * 2.4; ctx.drawImage(glowS('255,70,60'), S * 0.1 - g1 / 2, -S * 0.9 - g1 / 2, g1, g1); }
      if ((tt * 1.3) % 1 < 0.08) { ctx.globalAlpha = a * nn; var g2 = S * 3.4; ctx.drawImage(glowS('255,255,255'), -S * 3.45 - g2 / 2, -S * 0.2 - g2 / 2, g2, g2); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  function stepHeli(now, w) {
    var tt = (now - par.t0) / 1000, nn = wts().n, s0 = sf(), kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0;
    var uv = heliPath(tt), p = P(uv[0], uv[1], 0), S = 5.4 * s0, col = nn > 0.5 ? '170,178,200' : ink();
    var a = (1 - kill) * clamp(tt / 0.8, 0, 1) * (1 - clamp((tt - 25) / 1, 0, 1));
    var h = par.hs || (par.hs = { th: 0, om: 0, x: p[0], vx: 0, last: now }), dt = clamp((now - h.last) / 1000, 0.001, 0.05);
    var vx = (p[0] - h.x) / dt, ax = (vx - h.vx) / dt; h.x = p[0]; h.last = now;
    if (tt < 0.1) { vx = 0; ax = 0; }
    h.vx += (vx - h.vx) * Math.min(1, dt * 8);   // сглаженная скорость (без рывков от неровных кадров)
    var sp = h.vx / (60 * s0);   // скорость в «корпусах в секунду»
    // маятник троса: тянется назад от встречного воздуха, отстаёт при разгоне; затухает
    var thT = -Math.atan(0.25 * sp * Math.abs(sp)) * 0.9, acc = clamp(ax / (60 * s0), -30, 30);
    h.om += (7 * (thT - h.th) - 2.6 * h.om - 0.035 * acc) * dt; h.th += h.om * dt; h.th = clamp(h.th, -1.1, 1.1);
    var tilt = clamp(0.09 * sp + 0.01 * clamp(acc, -8, 8), -0.3, 0.3) + 0.015 * Math.sin(tt * 1.3);   // нос вниз на скорости
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // трос: из-под брюха вниз под углом маятника; флаг прикреплён к тросу кромкой у древка, внизу — груз
    var Lc = S * 3.2, fh = S * 4.6, fw = S * 7.2, sx = Math.sin(h.th), cy = Math.cos(h.th);
    var ax0 = p[0] + S * 0.1, ay0 = p[1] + S * 0.55, A = [ax0 + sx * Lc, ay0 + cy * Lc], B = [A[0] + sx * fh, A[1] + cy * fh];
    var ext = clamp(Math.abs(sp) / 1.5, 0, 1), back = sp >= 0 ? -1 : 1, nx = cy * back, ny = -sx * back;   // полотнище — назад от движения
    var droop = 1 - ext;
    if (nn > 0.3) {   // ночью прожектор из-под брюха подсвечивает флаг
      ctx.globalCompositeOperation = 'lighter'; var gl = ctx.createRadialGradient(ax0, ay0, 0, ax0, ay0, Lc + fh);
      gl.addColorStop(0, 'rgba(255,240,210,' + (0.22 * a * nn).toFixed(3) + ')'); gl.addColorStop(1, 'rgba(255,240,210,0)'); ctx.fillStyle = gl;
      ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(B[0] + nx * fw * 0.9 - S, B[1] + ny * fw * 0.9 + S * 2); ctx.lineTo(B[0] + S * 2, B[1] + S * 2); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.75 * a).toFixed(3) + ')'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(A[0], A[1]); ctx.stroke();
    var N = 14, pt = function (i, j) {
      var f = i / N, hx = A[0] + (B[0] - A[0]) * j / 3, hy = A[1] + (B[1] - A[1]) * j / 3;
      var len = fw * f * (0.85 + 0.15 * ext);
      var wv = Math.sin(tt * (2.2 + 2.6 * ext) - i * 0.62 + j * 0.15) * S * (0.25 + 0.45 * ext) * f;   // волна бежит от древка к краю
      var dr = droop * fw * 0.28 * f * f;   // без ветра край обвисает вниз
      return [hx + nx * len - ny * wv * 0.3, hy + ny * len + wv + dr];
    };
    pt.N = N; inkFlag(pt, WFLAG, nn, a);
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.9 * a).toFixed(3) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();   // кромка на тросе
    ctx.fillStyle = 'rgba(' + col + ',' + (0.95 * a).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(B[0], B[1] + S * 0.25, S * 0.28, S * 0.36, -h.th, 0, 6.283); ctx.fill();   // груз
    ctx.translate(p[0], p[1]); ctx.rotate(tilt); heliBody(S, col, a, tt, nn);
    ctx.restore();
    if (tt * 1000 >= par.dur || kill >= 1) endParade();
  }
  // --- салют (e1.4): ракеты со светящимся следом; пять видов залпов (шар, хризантема со шлейфами, золотая ива, мерцающий «треск», кольцо);
  //     искры тормозятся воздухом и медленно оседают, у каждой — короткий шлейф (размытие движения, чтобы глаз видел плавность);
  //     ночью вспышка подсвечивает небо. Финал — флаг из огней: проявляется слева направо, колышется ~5 с и осыпается ---
  var FWK = ['peony', 'chrys', 'willow', 'crackle', 'ring'];
  function fwPos(q, f, e) {   // положение искры через e с после разрыва (пиксели от центра)
    var d = f.V * q.s * (1 - Math.exp(-f.k * e)) / f.k;
    return [Math.cos(q.a) * d, Math.sin(q.a) * d * (f.kind === 'ring' ? 0.55 : 1) + 0.5 * f.g * e * e];
  }
  function stepFireworks(now, w) {
    var t = (now - par.t0) / 1000, nn = wts().n, s0 = sf(), kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0, band = SC(par.fr).skyBand;
    var night = nn > 0.5, bh = band[1] - band[0];
    if (!par.fw) {
      par.fw = [];
      var times = [0.2, 1.1, 1.9, 2.6, 2.8, 3.8, 4.6, 5.3, 5.5, 6.5, 7.3, 8.1, 8.3, 9.3, 10.1, 10.9, 11.1, 12.1];
      times.forEach(function (tm, i) {
        var kind = FWK[(i * 3 + (i >> 2)) % 5], c = i % 3, V = (kind === 'willow' ? 80 : kind === 'ring' ? 90 : 100) * s0 * (0.85 + Math.random() * 0.3);
        var f = { t: tm, u: 0.12 + Math.random() * 0.76, v: band[0] + bh * (0.12 + 0.45 * Math.random()), kind: kind, V: V,
          k: kind === 'willow' ? 2.6 : kind === 'chrys' ? 1.5 : 1.8, g: (kind === 'willow' ? 22 : 30) * s0,
          life: kind === 'willow' ? 4.6 : kind === 'chrys' ? 3.4 : kind === 'crackle' ? 2.8 : 3,
          col: kind === 'willow' ? '255,206,120' : kind === 'crackle' ? '255,244,220' : FLAGC[c], col2: FLAGC[(c + 1) % 3], sp: [] };
        var n = kind === 'willow' ? 44 : kind === 'ring' ? 36 : 58;
        for (var q = 0; q < n; q++) f.sp.push({ a: kind === 'ring' ? q / n * 6.283 : Math.random() * 6.283, s: kind === 'ring' ? 1 : 0.55 + 0.45 * Math.sqrt(Math.random()), p: Math.random() * 100, c2: kind === 'chrys' && q % 3 === 0 });
        par.fw.push(f);
      });
      par.flagT = 13.6;   // финал: пять ракет, потом флаг из огней
      for (var r = 0; r < 5; r++) par.fw.push({ t: par.flagT + r * 0.12, u: 0.26 + r * 0.12, v: band[0] + bh * 0.4, kind: 'flagRocket', sp: [] });
      par.fg = [];
      for (var cc = 0; cc < 26; cc++) for (var rr = 0; rr < 9; rr++) par.fg.push({ c: cc, r: rr, p: Math.random() * 100, j: (Math.random() - 0.5) * 0.4 });
    }
    var comp = night ? 'lighter' : 'source-over', horizon = band[1] + 0.25, flash = 0;
    ctx.save();
    par.fw.forEach(function (f) {
      var dt = t - f.t; if (dt < 0) return;
      var rise = 1.3, pT = P(f.u, f.v, 0), pH = P(f.u - 0.02, horizon, 0);
      if (dt < rise) {   // ракета: тормозит к вершине, чуть виляет, за ней — оседающие искорки
        for (var s = 0; s < 7; s++) {
          var kk = clamp((dt - s * 0.05) / rise, 0, 1); if (kk <= 0) break;
          var ke = 1 - (1 - kk) * (1 - kk), x = pH[0] + (pT[0] - pH[0]) * ke + Math.sin(kk * 14 + f.u * 50) * 1.2 * s0, y = pH[1] + (pT[1] - pH[1]) * ke + s * s * 0.4 * s0;
          var gs = (s ? 3.2 - s * 0.35 : 5) * s0 * (night ? 1.4 : 1);
          ctx.globalCompositeOperation = comp; ctx.globalAlpha = (1 - kill) * (1 - s / 7) * (night ? 1 : 0.8);
          ctx.drawImage(glowS(night ? '255,220,170' : '255,190,120'), x - gs / 2, y - gs / 2, gs, gs);
        }
        return;
      }
      if (f.kind === 'flagRocket') { if (dt - rise < 0.4 && night) flash = Math.max(flash, 0.5 * (1 - (dt - rise) / 0.4)); return; }
      var e = dt - rise; if (e > f.life) return;
      if (night && e < 0.4) {   // вспышка разрыва подсвечивает небо
        ctx.globalCompositeOperation = 'lighter'; var R0 = f.V * 1.5, g = ctx.createRadialGradient(pT[0], pT[1], 0, pT[0], pT[1], R0);
        g.addColorStop(0, 'rgba(' + f.col + ',' + (0.3 * (1 - e / 0.4) * (1 - kill)).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + f.col + ',0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(pT[0] - R0, pT[1] - R0, R0 * 2, R0 * 2);
      }
      var lk = e / f.life, al = (1 - kill) * (1 - lk * lk), tl = f.kind === 'willow' ? 0.9 : f.kind === 'chrys' ? 0.4 : 0.12;
      ctx.globalCompositeOperation = comp; ctx.lineCap = 'round';
      f.sp.forEach(function (q) {
        var col = q.c2 ? f.col2 : f.col, a0 = fwPos(q, f, e), tw = 1;
        if (f.kind === 'crackle' && lk > 0.45) tw = Math.sin(e * 38 + q.p) > 0.1 ? 1 : 0.15;   // треск: искры мигают
        else if (lk > 0.7) tw = 0.75 + 0.25 * Math.sin(e * 24 + q.p);
        for (var seg = 0; seg < 3; seg++) {   // шлейф из трёх отрезков, к хвосту бледнее
          var e1 = Math.max(0, e - tl * seg / 3), e2 = Math.max(0, e - tl * (seg + 1) / 3); if (e1 <= 0) break;
          var b1 = seg ? fwPos(q, f, e1) : a0, b2 = fwPos(q, f, e2);
          ctx.globalAlpha = al * tw * (night ? 0.55 : 0.4) * (1 - seg / 3); ctx.strokeStyle = 'rgba(' + col + ',1)'; ctx.lineWidth = (1.4 - seg * 0.35) * s0;
          ctx.beginPath(); ctx.moveTo(pT[0] + b1[0], pT[1] + b1[1]); ctx.lineTo(pT[0] + b2[0], pT[1] + b2[1]); ctx.stroke();
        }
        var hs = (night ? 7 : 4.2) * s0 * (1 - lk * 0.5);
        ctx.globalAlpha = al * tw * (night ? 1 : 0.85); ctx.drawImage(glowS(col), pT[0] + a0[0] - hs / 2, pT[1] + a0[1] - hs / 2, hs, hs);
      });
    });
    // финал — флаг из огней: 26×9 огоньков, три полосы; проявляется волной слева направо, колышется, потом огни осыпаются и гаснут
    var ft = t - par.flagT - 1.5;
    if (ft > 0) {
      var pc = P(0.5, band[0] + bh * 0.4, 0), fW = P(0.8, 0, 0)[0] - P(0.2, 0, 0)[0], fH = fW * 0.5, hold = 7;
      if (night && ft < 0.5) flash = Math.max(flash, 0.6 * (1 - ft / 0.5));
      ctx.globalCompositeOperation = comp;
      par.fg.forEach(function (q) {
        var ap = clamp((ft - q.c * 0.04) / 0.35, 0, 1), fe = Math.max(0, ft - hold - q.c * 0.03 - q.j), fa = clamp(1 - fe / 2.6, 0, 1); if (ap <= 0 || fa <= 0) return;
        var x = pc[0] - fW / 2 + fW * q.c / 25, y = pc[1] - fH / 2 + fH * q.r / 8;
        y += fH * 0.07 * Math.sin(t * 2.1 - q.c * 0.42) * (q.c / 25 + 0.3); x += fH * 0.02 * Math.sin(t * 1.7 - q.c * 0.3);   // полотнище колышется от древка
        y += 0.5 * 26 * s0 * fe * fe; x += q.j * 10 * s0 * fe;   // осыпается
        var tw = 0.8 + 0.2 * Math.sin(t * 11 + q.p) * (fe > 0 ? 2 : 1), hs = fW / 25 * (night ? 1.9 : 1.3) * (1 - 0.4 * (1 - fa)) * (0.6 + 0.4 * ap);
        ctx.globalAlpha = (1 - kill) * ap * fa * clamp(tw, 0, 1); ctx.drawImage(glowS(FLAGC[Math.floor(q.r / 3)]), x - hs / 2, y - hs / 2, hs, hs);
      });
    }
    if (flash > 0) {   // общее зарево неба в момент финала
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash * 0.35 * (1 - kill); ctx.fillStyle = 'rgba(255,230,200,1)';
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.restore();
    if (t * 1000 > par.dur || kill >= 1) endParade();
  }
  // --- воздушные шары (e1.3): семь нарисованных шаров — полосы цветов флага, чернильный контур, клинья оболочки; поднимаются из-за города
  //     (видны только в небе), покачиваются на ветру, потом уходят вверх, уменьшаясь, и тают в облаках ---
  function balloon(x, y, r, bands, nn, a, sw, tt) {
    var line = nn > 0.5 ? '200,208,228' : ink(), L = function (k) { return 'rgba(' + line + ',' + (k * a).toFixed(3) + ')'; };
    ctx.save(); ctx.translate(x, y); ctx.rotate(sw);
    function env() { ctx.beginPath(); ctx.moveTo(0, r * 1.2); ctx.bezierCurveTo(-r * 0.35, r * 0.98, -r * 1.02, r * 0.45, -r, -r * 0.1); ctx.bezierCurveTo(-r * 0.96, -r * 1.12, r * 0.96, -r * 1.12, r, -r * 0.1); ctx.bezierCurveTo(r * 1.02, r * 0.45, r * 0.35, r * 0.98, 0, r * 1.2); }
    ctx.save(); env(); ctx.clip();
    var yb = [-r * 1.1, -r * 0.28, r * 0.42, r * 1.25];
    for (var k = 0; k < 3; k++) { ctx.fillStyle = 'rgba(' + bands[k] + ',' + (0.88 * a).toFixed(3) + ')'; ctx.fillRect(-r * 1.1, yb[k], r * 2.2, yb[k + 1] - yb[k] + 0.5); }
    var sg = ctx.createLinearGradient(-r, 0, r, 0); sg.addColorStop(0, 'rgba(0,0,0,' + 0.18 * a + ')'); sg.addColorStop(0.4, 'rgba(255,255,255,' + 0.14 * a + ')'); sg.addColorStop(1, 'rgba(0,0,0,' + 0.22 * a + ')');   // объём — мягко, акварелью
    ctx.fillStyle = sg; ctx.fillRect(-r * 1.1, -r * 1.2, r * 2.2, r * 2.5);
    ctx.restore();
    ctx.strokeStyle = L(0.85); ctx.lineWidth = 0.9; env(); ctx.stroke();
    ctx.strokeStyle = L(0.35); ctx.lineWidth = 0.6;
    for (k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * r * 0.18, -r * 0.98 + Math.abs(k) * r * 0.06); ctx.quadraticCurveTo(k * r * 0.58, r * 0.1, k * r * 0.1, r * 1.16); ctx.stroke(); }
    ctx.strokeStyle = L(0.7); ctx.beginPath(); ctx.moveTo(-r * 0.16, r * 1.18); ctx.lineTo(-r * 0.13, r * 1.55); ctx.moveTo(r * 0.16, r * 1.18); ctx.lineTo(r * 0.13, r * 1.55); ctx.stroke();
    ctx.fillStyle = 'rgba(' + (nn > 0.5 ? '120,100,80' : '150,112,70') + ',' + a + ')'; ctx.fillRect(-r * 0.17, r * 1.55, r * 0.34, r * 0.26); ctx.strokeStyle = L(0.8); ctx.strokeRect(-r * 0.17, r * 1.55, r * 0.34, r * 0.26);
    if (Math.sin(tt * 2.3 + x * 0.01) > 0.55) { ctx.globalAlpha = a * (nn > 0.5 ? 0.8 : 0.4); ctx.fillStyle = 'rgba(255,180,80,1)'; ctx.beginPath(); ctx.arc(0, r * 1.3, r * 0.16, 0, 6.283); ctx.fill(); }   // вспышка горелки
    ctx.restore();
  }
  function stepBalloons(now, w) {
    var t = (now - par.t0) / 1000, nn = wts().n, s0 = sf(), kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0, band = SC(par.fr).skyBand;
    if (!par.bl) {
      par.bl = [];
      var sets = [[0, 1, 2]];   // у всех шаров — флаг Армении сверху вниз: красный, синий, абрикосовый
      for (var i = 0; i < 7; i++) par.bl.push({ u: 0.1 + i * 0.13 + Math.random() * 0.05, st: [0, 1.2, 0.5, 2.0, 0.9, 2.6, 1.6][i], sz: 7 + Math.random() * 9, top: band[0] + (band[1] - band[0]) * (0.35 + 0.5 * Math.random()), ph: Math.random() * 6.28, bands: sets[0].map(function (k) { return WFLAG[k]; }) });
      par.bl.sort(function (x, y) { return x.sz - y.sz; });   // дальние (мелкие) — первыми
    }
    var hor = band[1] + 0.3;
    par.bl.forEach(function (b) {
      var up = clamp((t - b.st) / 7, 0, 1), upe = 1 - Math.pow(1 - up, 2.4), leave = clamp((t - 11 - b.st * 0.3) / 5, 0, 1), le = leave * leave;
      var u = b.u + 0.04 * Math.sin(t * 0.4 + b.ph) + 0.08 * t / 17, v = hor + (b.top - hor) * upe - 0.25 * le;
      var r = b.sz * s0 * (1 - 0.45 * le), a = (1 - kill) * clamp((t - b.st) / 1, 0, 1) * (1 - le), p = P(u, v, 0);
      if (a > 0.01) balloon(p[0], p[1], r, b.bands, nn, a, 0.06 * Math.sin(t * 0.9 + b.ph), t);
    });
    if (t * 1000 > par.dur || kill >= 1) endParade();
  }
  // --- знамя на фасаде (крупный план): длинный триколор висит с карниза крыши на перекладине. При вертикальной подвеске
  //     полосы идут слева направо: красная, синяя, абрикосовая. Разворачивается сверху вниз (рулон внизу), колышется, сворачивается ---
  function stepBanner(now, w) {
    var t = (now - par.t0) / 1000, nn = wts().n, kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0, f = V.entry(par.fr), c = SC(par.fr).closeUp;
    if (!f || !c || !(c.banner || c.perch) || !V.projectB) { endParade(); return; }
    var bn = c.banner || (function (m) { return [m[0], m[1] + 0.012, 0.82, 0.075]; })(c.perch[Math.floor(c.perch.length / 2)]);   // без banner в настройках — с кромки крыши
    var uC = bn[0], vTop = bn[1], half = bn[3];
    var down = clamp(t / 5, 0, 1), up = clamp((t - 17.5) / 4, 0, 1), k = (down * down * (3 - 2 * down)) * (1 - up * up * (3 - 2 * up));
    var L = V.projectB(f, uC - half, vTop), R = V.projectB(f, uC + half, vTop), B = V.projectB(f, uC, bn[2]);
    var bw = R[0] - L[0], len = (B[1] - L[1]) * k, line = nn > 0.5 ? '200,208,228' : ink(), a = 1 - kill;
    if (k > 0.002) {
      var N = 16, pt = function (i, j) {   // i — вниз по длине, j — поперёк (0..3 = слева направо)
        var yy = L[1] + len * i / N, sway = Math.sin(t * 1.3 - i * 0.35) * bw * 0.05 * Math.pow(i / N, 1.4) * k, rip = Math.sin(t * 2.6 + j * 1.7 + i * 0.9) * bw * 0.012 * (i / N);
        return [L[0] + bw * j / 3 + sway + rip, yy];
      };
      pt.N = N;
      ctx.save();
      for (var s2 = 0; s2 < 3; s2++) {   // полосы вертикально: для inkFlag i идёт по длине, полосы — по j
        ctx.fillStyle = 'rgba(' + WFLAG[s2] + ',' + (a * (nn > 0.5 ? 0.85 : 1)).toFixed(3) + ')';   // ткань плотная — окна сквозь неё не видны
        ctx.beginPath();
        for (var i = 0; i <= N; i++) { var q = pt(i, s2); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
        for (i = N; i >= 0; i--) { q = pt(i, s2 + 1); ctx.lineTo(q[0], q[1]); }
        ctx.closePath(); ctx.fill();
      }
      ctx.save(); ctx.beginPath(); for (i = 0; i <= N; i++) { q = pt(i, 0); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } for (i = N; i >= 0; i--) { q = pt(i, 3); ctx.lineTo(q[0], q[1]); } ctx.closePath(); ctx.clip();
      var fg = ctx.createLinearGradient(L[0], 0, R[0], 0);   // складки ткани: мягкие тени и блики поперёк, медленно гуляют
      for (var fs = 0; fs <= 12; fs++) { var fv = Math.sin(fs * 1.9 + t * 0.7) * 0.5 + Math.sin(fs * 0.8 - t * 0.4) * 0.5; fg.addColorStop(fs / 12, fv > 0 ? 'rgba(255,250,235,' + (0.16 * fv * a).toFixed(3) + ')' : 'rgba(40,30,30,' + (-0.2 * fv * a).toFixed(3) + ')'); }
      ctx.fillStyle = fg; ctx.fillRect(L[0] - bw, L[1], bw * 3, len + 4); ctx.restore();
      ctx.strokeStyle = 'rgba(' + line + ',' + (0.25 * a) + ')'; ctx.lineWidth = 0.6;   // складки — редкие вертикальные штрихи
      for (var fz = 1; fz < 9; fz++) { var fu = fz / 9 * 3; ctx.beginPath(); for (i = 0; i <= N; i++) { var qq = pt(i, fu); if (i) ctx.lineTo(qq[0] + Math.sin(fz * 2.1 + i * 0.5) * 1.2, qq[1]); else ctx.moveTo(qq[0], qq[1]); } ctx.stroke(); }
      ctx.strokeStyle = 'rgba(' + line + ',' + (0.85 * a) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); for (i = 0; i <= N; i++) { q = pt(i, 0); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } for (i = N; i >= 0; i--) { q = pt(i, 3); ctx.lineTo(q[0], q[1]); } ctx.closePath(); ctx.stroke();
      var e0 = pt(N, 0), e3 = pt(N, 3);
      if (down < 1 || up > 0) {   // рулон внизу, пока разворачивается: валик из тех же трёх полос с тенью и бликом; чем больше размотан, тем тоньше
        var rh = Math.max(3, bw * (0.16 - 0.1 * k)), rx0 = e0[0] - bw * 0.03, rw = e3[0] - e0[0] + bw * 0.06, ry = e0[1] - rh * 0.35;
        for (var rk = 0; rk < 3; rk++) { ctx.fillStyle = 'rgba(' + WFLAG[rk] + ',' + (0.96 * a).toFixed(3) + ')'; ctx.fillRect(rx0 + rw * rk / 3, ry, rw / 3 + 0.5, rh); }
        var rg = ctx.createLinearGradient(0, ry, 0, ry + rh); rg.addColorStop(0, 'rgba(40,30,30,' + 0.3 * a + ')'); rg.addColorStop(0.35, 'rgba(255,250,235,' + 0.35 * a + ')'); rg.addColorStop(1, 'rgba(40,30,30,' + 0.45 * a + ')');
        ctx.fillStyle = rg; ctx.fillRect(rx0, ry, rw, rh);
        ctx.strokeStyle = 'rgba(' + line + ',' + (0.8 * a) + ')'; ctx.lineWidth = 0.8; ctx.strokeRect(rx0, ry, rw, rh);
        ctx.beginPath(); ctx.ellipse(rx0 + rw, ry + rh / 2, rh * 0.22, rh / 2, 0, 0, 6.283); ctx.stroke();   // торец валика
      }
      ctx.restore();
    }
    ctx.save(); ctx.strokeStyle = 'rgba(' + line + ',' + (0.9 * a * Math.min(1, t / 0.6) * (1 - clamp((t - 21.5) / 0.5, 0, 1))) + ')'; ctx.lineWidth = 2; ctx.lineCap = 'round';   // перекладина и два крепления к карнизу
    ctx.beginPath(); ctx.moveTo(L[0] - 4, L[1]); ctx.lineTo(R[0] + 4, R[1]); ctx.stroke(); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(L[0] + 2, L[1]); ctx.lineTo(L[0] + 5, L[1] - 7); ctx.moveTo(R[0] - 2, R[1]); ctx.lineTo(R[0] - 5, R[1] - 7); ctx.stroke(); ctx.restore();
    if (t * 1000 > par.dur || kill >= 1) endParade();
  }
  function stepParade(now, w) {
    if (now - par.t0 > 50000) { endParade(); return; }   // страховка: показ не может длиться дольше 50 с (кнопка не зависнет)
    if (par.style === 'drones') { stepDrones(now, w); return; }
    if (par.style === 'heli') { stepHeli(now, w); return; }
    if (par.style === 'fireworks') { stepFireworks(now, w); return; }
    if (par.style === 'balloons') { stepBalloons(now, w); return; }
    if (par.style === 'banner') { stepBanner(now, w); return; }
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
    if (par) paradeLayer(now, w);
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
    paradeProgress: function (now) { return par ? clamp((now - par.t0) / (par.total || par.dur), 0, 1) : -1; },   // для кольца на кнопке флага
    // выключить всё (fps ниже порога или «уменьшение движения»): очистить холст, парад прервать
    off: function () { active = []; glints = []; perch = null; if (par) endParade(); clear(); showT0 = null; }
  };
})(window);
