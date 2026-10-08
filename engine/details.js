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
  // e1.10–e1.11 СПРАЙТЫ библиотеки жизни (engine/sprites/life.webp + life.json; машины и люди — из Gemini (tools/sprites_intake.py), птицы — tools/make_life_sprites.py, docs/ENGINE-LIFE.md «Спрайты»).
  // Пока не загрузились или кадра нет — рисуется прежний векторный вариант. Ночью — затемнённая копия атласа (птицы не светятся на тёмном).
  var SPR = { ok: false, img: null, dark: null, meta: null };
  (function () {
    var src = (document.currentScript && document.currentScript.src) || '', base = src.replace(/details\.js.*$/, ''), q = src.indexOf('?') >= 0 ? src.slice(src.indexOf('?')) : '';
    if (!base || !root.fetch) return;
    root.fetch(base + 'sprites/life.json' + q).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m) return;
      var im = new Image(); im.onload = function () {
        var c = document.createElement('canvas'); c.width = im.width; c.height = im.height; var x = c.getContext('2d');
        x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(18,24,50,0.72)'; x.fillRect(0, 0, c.width, c.height);
        SPR.img = im; SPR.dark = c; SPR.meta = m; SPR.ok = true;
      };
      im.onerror = function () { if (!/png/.test(im.src)) im.src = base + 'sprites/life.png' + q; };
      im.src = base + 'sprites/life.webp' + q;
    }).catch(function () {});
  })();
  function spr(name, x, y, w, flip, rot, a) {   // кадр атласа шириной w px; якорь кадра — в точке (x, y)
    if (!SPR.ok) return false; var fr = SPR.meta.frames[name]; if (!fr) return false;
    var h = fr[3] * w / fr[2], n = NIGHT;
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); if (flip) ctx.scale(-1, 1);
    if (n < 0.98) { ctx.globalAlpha = a * (1 - n); ctx.drawImage(SPR.img, fr[0], fr[1], fr[2], fr[3], -fr[4] * w, -fr[5] * h, w, h); }
    if (n > 0.02) { ctx.globalAlpha = a * n; ctx.drawImage(SPR.dark, fr[0], fr[1], fr[2], fr[3], -fr[4] * w, -fr[5] * h, w, h); }
    ctx.restore(); return true;
  }
  function sprH(name, x, y, h, flip, a) {   // e1.11: кадр высотой h × (свой рост / рост группы) — все кадры группы в одном масштабе
    if (!SPR.ok) return false; var fr = SPR.meta.frames[name]; if (!fr) return false;
    var g = SPR.meta.groups && SPR.meta.groups[name.split('_').slice(0, 2).join('_')], hh = h * fr[3] / (g ? g[1] : fr[3]);
    return spr(name, x, y, hh * fr[2] / fr[3], flip, 0, a);
  }
  function pigeonFly(x, y, s, flap, head, a, land) {   // голубь в полёте: спрайт по фазе крыла; s — как у flyBird (размах)
    var nm = land ? 'pigeon_land' : flap > 0.6 ? 'pigeon_fly_0' : flap > 0.22 ? 'pigeon_fly_1' : flap > 0.08 ? 'pigeon_glide' : flap > -0.45 ? 'pigeon_fly_2' : 'pigeon_fly_3';
    var c = Math.cos(head);
    if (!spr(nm, x, y, s * 1.3, c < 0, (c < 0 ? -1 : 1) * Math.sin(head) * 0.35, a)) flyBird(x, y, s, flap, head, '108,114,128', a);
  }
  function SC(fr) { return (root.CONFIG && root.CONFIG.SCENE && root.CONFIG.SCENE[fr]) || {}; }
  // e1.5: showBand — своя полоса для парада (доли высоты), если у кадра задана; иначе парад идёт в полосе неба skyBand, как раньше
  function PB(fr) { var S = SC(fr); return S.showBand || S.skyBand; }

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
  // ---------- ФОНТАНЫ (e1.5; кадр с fountains в настройках здания, у остальных ничего не рисуется) ----------
  // jets: [[u основания, v основания, высота струи (доля высоты кадра), полуширина (доля ширины)], …]; glints: [[u, v], …] — блики на воде;
  // squash — сплюснутость кругов ряби (вид сверху). Всё на глубине площади под точкой (как точки-подсказки слоя «фон») — при наклоне на месте.
  // Стиль рисунка: бледная акварельная струя, тонкие карандашные штрихи бегут вверх, капли по дугам, круги ряби расходятся и тают, блики мерцают.
  function drawFountains(now, w, f, F) {
    var t = now / 1000, s0 = sf(), a0 = 1 - 0.6 * w.n, sq = F.squash || 0.38;
    ctx.save(); ctx.lineCap = 'round';
    if (F.pool) {   // e1.7: вода бассейна — акварельная синева поверх рисунка (умножением: карандаш остаётся), лёгкие волны-штрихи
      var pp = F.pool.map(function (q) { return P(q[0], q[1], depthAt(f, q[0], q[1])); });
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = (F.blue || 0.6) * (1 - 0.4 * w.n); ctx.fillStyle = 'rgb(105,165,225)';
      ctx.beginPath(); pp.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      var c0 = pp.reduce(function (s, q) { return [s[0] + q[0] / pp.length, s[1] + q[1] / pp.length]; }, [0, 0]), wx0 = Math.abs(pp[1][0] - pp[0][0]) * 0.4;
      ctx.strokeStyle = 'rgb(255,255,255)'; ctx.lineWidth = Math.max(0.8, 1.1 * s0);
      for (var wv = 0; wv < 7; wv++) { var ph2 = (t * 0.25 + wv / 7) % 1, wy = c0[1] + (wv - 3) * 4 * s0, wxs = c0[0] + Math.sin(wv * 2.1 + t * 0.4) * wx0; ctx.globalAlpha = a0 * 0.5 * Math.sin(Math.PI * ph2); ln(wxs - 6 * s0, wy, wxs + 6 * s0, wy); }
    }
    (F.jets || []).forEach(function (j, k) {
      var d = depthAt(f, j[0], j[1]), b = P(j[0], j[1], d), tp = P(j[0], j[1] - j[2], d), h = b[1] - tp[1], hw = Math.max(1.5, P(j[0] + j[3], j[1], d)[0] - b[0]);
      var hh = h * (0.93 + 0.06 * Math.sin(t * 2.3 + k * 1.7) + 0.025 * Math.sin(t * 7.1 + k));
      ctx.lineWidth = Math.max(0.6, 0.8 * s0);
      for (var r = 0; r < 3; r++) {   // рябь: три круга от струи
        var p = (t * 0.42 + r / 3 + k * 0.29) % 1, rx = hw * (1.3 + 3.4 * p);
        ctx.globalAlpha = a0 * 0.6 * (1 - p) * (1 - p); ctx.strokeStyle = 'rgb(62,88,112)';
        ctx.beginPath(); ctx.ellipse(b[0], b[1], rx, rx * sq, 0, 0, 6.283); ctx.stroke();
      }
      ctx.globalAlpha = a0 * (F.pool ? 0.92 : 0.7); ctx.fillStyle = F.pool ? 'rgb(225,240,255)' : 'rgb(238,247,252)';   // тело струи — бледная акварель
      ctx.beginPath(); ctx.moveTo(b[0] - hw * 0.5, b[1]);
      ctx.quadraticCurveTo(b[0] - hw * 0.22, b[1] - hh * 0.6, b[0] - hw * 0.14, b[1] - hh);
      ctx.quadraticCurveTo(b[0], b[1] - hh * 1.08, b[0] + hw * 0.14, b[1] - hh);
      ctx.quadraticCurveTo(b[0] + hw * 0.22, b[1] - hh * 0.6, b[0] + hw * 0.5, b[1]); ctx.closePath(); ctx.fill();
      ctx.setLineDash([3 * s0, 4 * s0]); ctx.lineDashOffset = -t * 26 * s0;   // штрихи бегут вверх
      ctx.globalAlpha = a0 * 0.45; ctx.strokeStyle = 'rgb(70,96,122)'; ctx.lineWidth = Math.max(0.5, 0.7 * s0);
      [-0.28, 0, 0.28].forEach(function (o) { ctx.beginPath(); ctx.moveTo(b[0] + hw * o * 1.4, b[1]); ctx.quadraticCurveTo(b[0] + hw * o, b[1] - hh * 0.6, b[0] + hw * o * 0.5, b[1] - hh * 0.98); ctx.stroke(); });
      ctx.setLineDash([]);
      for (var i = 0; i < 12; i++) {   // капли падают дугами наружу
        var ph = (t * 0.85 + i / 12 + k * 0.37) % 1, side = i % 2 ? 1 : -1, sp = hw * (0.7 + 0.9 * ((i * 7) % 5) / 5);
        var x = b[0] + side * sp * ph, y = b[1] - hh * (1 - 1.15 * ph * ph) + hh * 0.08 * ph;
        ctx.globalAlpha = a0 * 0.65 * (1 - ph); ctx.fillStyle = i % 3 ? 'rgb(84,112,140)' : 'rgb(255,255,255)';
        ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, 0.85 * s0), 0, 6.283); ctx.fill();
      }
    });
    (F.glints || []).forEach(function (g, i) {   // блики на воде: короткие белые штрихи мерцают
      var d = depthAt(f, g[0], g[1]), p = P(g[0], g[1], d), tw = 0.5 + 0.5 * Math.sin(t * (1.2 + (i % 3) * 0.45) + i * 2.1), l = (3 + (i % 3)) * s0;
      ctx.globalAlpha = a0 * 0.85 * tw * tw; ctx.strokeStyle = 'rgb(255,255,255)'; ctx.lineWidth = Math.max(0.8, 1.3 * s0);
      ctx.beginPath(); ctx.moveTo(p[0] - l, p[1]); ctx.lineTo(p[0] + l, p[1]); ctx.stroke();
      ctx.globalAlpha = a0 * 0.3 * tw; ctx.strokeStyle = 'rgb(62,88,112)'; ctx.lineWidth = Math.max(0.5, 0.6 * s0);
      ctx.beginPath(); ctx.moveTo(p[0] - l * 0.7, p[1] + 1.6 * s0); ctx.lineTo(p[0] + l * 0.9, p[1] + 1.6 * s0); ctx.stroke();
    });
    ctx.restore();
  }
  // ---------- БИБЛИОТЕКА ЖИЗНИ (e1.8; docs/ENGINE-LIFE.md). Кадр с ambient в настройках здания, у остальных ничего не рисуется ----------
  // Модули с пресетами (preset задаёт проверенные числа, поля объекта их переопределяют):
  //   walkers: [{preset: 'far-pedestrians', path, size: [s0, s1], n}]          — мелкие далёкие люди только по тротуарам
  //   cars:    [{preset: 'soviet-street' | 'trolley-line', path, size, n, loop}]— «Волги», «Москвичи», ЗАЗ, такси, троллейбус — по дорогам
  //   flocks:  [{preset: 'pigeons', at: [u, v], size, n}]                        — голуби на земле: клюют, взлетают стаей, кружат, садятся
  //            [{preset: 'sky', band: [v0, v1], size, n, every: [a, b]}]         — стая пролетает через небо, меняет форму
  //   occluders: [{poly: [[u, v]…], base: v, bld: true?}]                        — дом/дерево/статуя: всё, что дальше base, за ними прячется
  // Скорости — в ростах (длинах) в секунду, поэтому дальние идут медленнее сами. Всё — на глубине земли под точкой (при наклоне на месте).
  // Правила Нарека (07.10.2026): никаких крупных людей; на крупном плане людей нет; пути только по нарисованным дорогам и тротуарам;
  // ларьки и стоящие машины рисуются в саму картинку, не движком.
  var NIGHT = 0;   // e1.10: ночь для модулей жизни (голуби спят, стаи не летают)
  var LIFE_PRESETS = {
    walkers: { 'far-pedestrians': { bps: 0.62, n: 3, gap: [2, 9] } },
    cars: { 'soviet-street': { bps: 1.7, n: 2, gap: [1.5, 6], kinds: ['volga', 'moskvich', 'volga', 'zaz', 'taxi'] },
            'trolley-line': { bps: 1.1, n: 1, gap: [6, 14], kinds: ['trolley'], lane: 0.3 },
            'soviet-1950s': { bps: 1.5, n: 2, gap: [3, 9], kinds: ['pobeda', 'pobeda', 'pobeda', 'volga'], lane: 0.3 },   // e1.11: эпоха 1950–60-х, машин мало
            'watering': { bps: 0.8, n: 1, gap: [12, 30], kinds: ['water'], lane: 0.3 } },
    flocks: { pigeons: { n: 9, rest: [7, 18], fly: [4, 8], radius: 0.06 }, sky: { n: 11, every: [9, 22], size: 0.012 } }
  };
  function lp(kind, o) { if (o._p) return o._p; var b = (LIFE_PRESETS[kind] || {})[o.preset] || {}, r = {}, k; for (k in b) r[k] = b[k]; for (k in o) r[k] = o[k]; o._p = r; return r; }
  var STAND_SEQ = { manhat: [0, 1, 0, 1, 2, 3], reader: [0, 0, 1, 0, 2, 3], woman: [0, 1, 2, 3, 1] };   // e1.11: какие кадры стойки и как часто
  var WALKERS = ['mancoat', 'woman', 'mansuit'];   // e1.11: пешеходы-спрайты из Gemini (walk_<кто>_<фаза>)
  var COATS = ['105,115,128', '128,98,84', '96,108,90', '120,112,130', '146,128,96', '84,92,104', '130,86,80'];
  var CARS = { volga: ['214,206,184', '162,176,160', '146,160,178', '120,128,138', '190,168,150'], moskvich: ['176,64,56', '96,128,150', '200,190,150', '110,140,110'], zaz: ['226,214,170', '150,170,200', '196,96,70'], taxi: ['232,214,150'], trolley: ['224,204,140'], pobeda: ['176,190,176'], water: ['96,120,90'] };
  function aspect() { var FS = root.CONFIG.FRAME_SIZE || [768, 1365]; return FS[0] / FS[1]; }
  function chaikin(pts, loop) {   // e1.11: плавные повороты — путь сглаживается (2 прохода Чайкина); tools/check_roads.py проверяет тот же сглаженный путь
    for (var it = 0; it < 2; it++) {
      var out = [], n = pts.length, i;
      if (!loop) out.push(pts[0]);
      for (i = 0; i < (loop ? n : n - 1); i++) { var A = pts[i], B = pts[(i + 1) % n]; out.push([A[0] * 0.75 + B[0] * 0.25, A[1] * 0.75 + B[1] * 0.25], [A[0] * 0.25 + B[0] * 0.75, A[1] * 0.25 + B[1] * 0.75]); }
      if (!loop) out.push(pts[n - 1]);
      pts = out;
    }
    return pts;
  }
  function pathOf(o) {   // ломаная; длина — в долях высоты кадра (u переводится по пропорции кадра)
    if (o._L) return o._L;
    var P0 = o.smooth === false ? o.path.slice() : chaikin(o.path, o.loop), ar = aspect(); if (o.loop) P0.push(P0[0]);
    var L = [0]; for (var i = 1; i < P0.length; i++) L.push(L[i - 1] + Math.hypot((P0[i][0] - P0[i - 1][0]) * ar, P0[i][1] - P0[i - 1][1]));
    o._P = P0; o._L = L; return L;
  }
  function along(o, s) {
    var L = pathOf(o), P0 = o._P, tot = L[L.length - 1], x = clamp(s, 0, 1) * tot, i = 1;
    while (i < L.length - 1 && L[i] < x) i++;
    var k = (x - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]), a = P0[i - 1], b = P0[i];
    return { u: a[0] + (b[0] - a[0]) * k, v: a[1] + (b[1] - a[1]) * k, du: b[0] - a[0], dv: b[1] - a[1] };
  }
  function gd(f, u, v) { return depthAt(f, clamp(u, 0, 1), clamp(v, 0, 1)); }
  function ground(f, u, v) { return P(u, v, gd(f, u, v)); }
  function sizePx(f, u, v, s) { var d = gd(f, u, v), a = P(u, v, d), b = P(u, v - s, d); return Math.abs(a[1] - b[1]); }
  function ln(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  function occClip(f, A, v) {   // вырезать из рисования всё, что закрывают ближние дом/дерево/статуя (их base ниже точки предмета)
    var oc = (A.occluders || []).filter(function (o) { return o.base > v; }); if (!oc.length) return false;
    ctx.save(); ctx.beginPath(); ctx.rect(-10, -10, W + 20, H + 20);
    oc.forEach(function (o) {
      o.poly.forEach(function (q, i) { var p = o.bld && V.projectB ? V.projectB(f, q[0], q[1]) : ground(f, q[0], q[1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
    });
    ctx.clip('evenodd'); return true;
  }
  function tinyPerson(x, y, h, step, coat, col, a, dir) {   // далёкий человек: голова, пальто пятном, ноги — два штриха; без деталей
    if (SPR.ok && SPR.meta.coats) { var ci = Math.max(0, COATS.indexOf(coat)) % SPR.meta.coats.length, ph = ((Math.floor(step / 1.5708) % 4) + 4) % 4, fr = SPR.meta.frames['walk_' + SPR.meta.coats[ci] + '_' + ph];
      if (fr && spr('walk_' + SPR.meta.coats[ci] + '_' + ph, x, y, h * fr[2] / fr[3], dir < 0, 0, a)) return; }   // спрайт из Gemini, если он есть в атласе
    var lw = Math.max(0.55, h * 0.09), sw = Math.sin(step) * h * 0.1;
    ctx.globalAlpha = a * 0.8; ctx.fillStyle = 'rgb(' + coat + ')';
    ctx.beginPath(); ctx.ellipse(x, y - h * 0.58, h * 0.13, h * 0.24, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = a * 0.9; ctx.strokeStyle = 'rgb(' + col + ')'; ctx.fillStyle = 'rgb(' + col + ')'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(x, y - h * 0.9, h * 0.1, 0, 6.283); ctx.fill();
    ln(x - h * 0.04, y - h * 0.38, x - h * 0.04 + sw, y); ln(x + h * 0.04, y - h * 0.38, x + h * 0.04 - sw, y);
  }
  function car(x, y, len, ang, kind, body, col, a, lights, now, i) {   // машина эпохи сверху-сбоку: кузов акварелью, крыша, стёкла, контур карандашом
    var SM = { pobeda: 'pobeda', volga: 'volga', taxi: 'volga', trolley: 'trolley', water: 'water' }[kind], gr = SM && SPR.ok && SPR.meta.groups && SPR.meta.groups['car_' + SM];
    if (gr) {   // e1.11: спрайт из Gemini — вид по направлению на экране: бок / 3/4 спереди (едет к зрителю) / 3/4 сзади; машина стоит ровно, не крутится
      var cs = Math.cos(ang), sn0 = Math.sin(ang), view = Math.abs(sn0) < 0.42 ? 'side' : (sn0 > 0 ? 'front' : 'rear'), nm = 'car_' + SM + '_' + view + '_' + (cs >= 0 ? 'r' : 'l'), fr = SPR.meta.frames[nm];
      // e1.13: ракурс по касательной к дороге — спрайт доворачивается от своего «родного» направления (бок 0°, 3/4 ±40°) к направлению пути на экране;
      // лёгкое покачивание на ходу
      var nat = view === 'side' ? (cs >= 0 ? 0 : Math.PI) : (view === 'front' ? (cs >= 0 ? 0.7 : Math.PI - 0.7) : (cs >= 0 ? -0.7 : -Math.PI + 0.7));
      var dr = Math.atan2(Math.sin(ang - nat), Math.cos(ang - nat)), rot = clamp(dr, view === 'side' ? -0.45 : -0.3, view === 'side' ? 0.45 : 0.3);
      var bob = Math.sin(now * 0.013 + i * 1.7) * len * 0.012; rot += Math.sin(now * 0.0095 + i * 2.3) * 0.012;
      if (fr) {
        var sw = len * fr[2] / gr[0], sh = fr[3] * sw / fr[2];
        var sdx = (root.CONFIG.SUN_SIDE === 'left' ? 1 : -1) * sw * 0.07;   // тень от солнца в сторону
        ctx.save(); ctx.globalAlpha = a * 0.3 * (1 - 0.6 * lights); ctx.fillStyle = 'rgb(40,35,30)'; ctx.translate(x + sdx, y + sh * 0.02); ctx.rotate(rot); ctx.beginPath(); ctx.ellipse(0, 0, sw * 0.5, Math.max(1, sh * 0.16), 0, 0, 6.283); ctx.fill(); ctx.restore();
        spr(nm, x, y + bob, sw, false, rot, a);
        if (kind === 'water' && lights < 0.6) waterSpray(x, y - sh * 0.12, len, ang, a * (1 - lights), now, i);
        if (lights > 0.05) { ctx.save(); ctx.translate(x, y - sh * 0.3); ctx.rotate(ang); carLights(len * (view === 'side' ? 1 : 0.7), len * 0.43, kind, a, lights, true); ctx.restore(); }
        return;
      }
    }
    var shape = { volga: [0.43, 0.42, 0.34], moskvich: [0.44, 0.3, 0.36], zaz: [0.5, 0.5, 0.4], taxi: [0.43, 0.42, 0.34], trolley: [0.27, 0.1, 0.0] }[kind] || [0.43, 0.4, 0.34];
    var wd = len * shape[0], r = wd * shape[1];
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    var sn = SPR.ok && ('car_' + kind + '_' + Math.max(0, (CARS[kind] || []).indexOf(body))), sf2 = sn && SPR.meta.frames[sn];
    if (sf2) {   // спрайт из Gemini, если он есть в атласе: видимый борт всегда к зрителю (внизу)
      if (Math.cos(ang) < 0) ctx.scale(1, -1);
      var sh = sf2[3] * len / sf2[2], n = NIGHT;
      if (n < 0.98) { ctx.globalAlpha = a * (1 - n); ctx.drawImage(SPR.img, sf2[0], sf2[1], sf2[2], sf2[3], -sf2[4] * len, -sf2[5] * sh, len, sh); }
      if (n > 0.02) { ctx.globalAlpha = a * n; ctx.drawImage(SPR.dark, sf2[0], sf2[1], sf2[2], sf2[3], -sf2[4] * len, -sf2[5] * sh, len, sh); }
      if (kind === 'trolley') { ctx.globalAlpha = a * 0.8; ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = Math.max(0.5, len * 0.018); ln(-len * 0.1, -wd * 0.12, -len * 0.48, -wd * 1.6); ln(-len * 0.1, wd * 0.12, -len * 0.48, -wd * 1.2); }
      if (lights > 0.05) carLights(len, wd, kind, a, lights);
      ctx.restore(); return;
    }
    ctx.globalAlpha = a * 0.22; ctx.fillStyle = 'rgb(40,35,30)'; ctx.beginPath(); ctx.ellipse(len * 0.04, wd * 0.18, len * 0.52, wd * 0.62, 0, 0, 6.283); ctx.fill();   // тень
    ctx.globalAlpha = a * 0.92; ctx.fillStyle = 'rgb(' + body + ')';
    ctx.beginPath(); ctx.moveTo(-len / 2 + r, -wd / 2); ctx.lineTo(len / 2 - r, -wd / 2); ctx.quadraticCurveTo(len / 2, -wd / 2, len / 2, -wd / 2 + r); ctx.lineTo(len / 2, wd / 2 - r); ctx.quadraticCurveTo(len / 2, wd / 2, len / 2 - r, wd / 2); ctx.lineTo(-len / 2 + r, wd / 2); ctx.quadraticCurveTo(-len / 2, wd / 2, -len / 2, wd / 2 - r); ctx.lineTo(-len / 2, -wd / 2 + r); ctx.quadraticCurveTo(-len / 2, -wd / 2, -len / 2 + r, -wd / 2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = a * (1 - 0.7 * lights); ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = Math.max(0.5, len * 0.04); ctx.stroke();   // ночью светлый карандаш почти не виден — машина тёмная
    if (kind === 'trolley') {
      ctx.globalAlpha = a * 0.45; ctx.fillStyle = 'rgb(' + col + ')'; for (var k = 0; k < 6; k++) ctx.fillRect(-len * 0.44 + k * len * 0.15, -wd * 0.3, len * 0.09, wd * 0.6);
      ctx.globalAlpha = a * 0.8; ctx.lineWidth = Math.max(0.5, len * 0.018); ln(-len * 0.1, -wd * 0.12, -len * 0.48, -wd * 1.6); ln(-len * 0.1, wd * 0.12, -len * 0.48, -wd * 1.2);
      if (Math.sin(now * 0.0031 + i * 2.3) > 0.985) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a; ctx.fillStyle = 'rgb(170,205,255)'; ctx.beginPath(); ctx.arc(-len * 0.48, -wd * 1.6, wd * 0.3, 0, 6.283); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
    } else {
      ctx.globalAlpha = a * 0.55; ctx.fillStyle = 'rgb(70,84,100)'; ctx.fillRect(-len * 0.2, -wd * 0.34, len * 0.44, wd * 0.68);   // стёкла
      ctx.globalAlpha = a * 0.85; ctx.fillStyle = 'rgb(' + body + ')'; ctx.fillRect(-len * 0.12, -wd * 0.3, len * 0.26, wd * 0.6);       // крыша
      if (kind === 'taxi') { for (var q = 0; q < 4; q++) { ctx.fillStyle = q % 2 ? 'rgb(250,244,220)' : 'rgb(' + col + ')'; ctx.fillRect(-len * 0.24 + q * len * 0.1, wd * 0.38, len * 0.1, wd * 0.12); } }
    }
    if (lights > 0.05) carLights(len, wd, kind, a, lights);
    ctx.restore();
  }
  // e1.12 поливальная машина: веер воды в обе стороны от задней части, капли летят дугой и гаснут; поливает не всё время
  function waterSpray(x, y, len, ang, a, now, i) {
    var t = now * 0.001, on = Math.sin(t * 0.21 + i * 1.7) > -0.35;
    if (!on || a < 0.05) return;
    var cs = Math.cos(ang), sn = Math.sin(ang), rx = x - cs * len * 0.3, ry = y - sn * len * 0.3 * 0.6;
    ctx.save(); ctx.lineCap = 'round';
    [-1, 1].forEach(function (sd) {
      var nx = -sn * sd, ny = cs * sd * 0.55;                              // поперёк движения, сжато перспективой
      var ex = rx + nx * len * 0.95 - cs * len * 0.25, ey = ry + ny * len * 0.95 + len * 0.12;
      var g = ctx.createLinearGradient(rx, ry, ex, ey);
      g.addColorStop(0, 'rgba(226,238,246,' + 0.55 * a + ')'); g.addColorStop(1, 'rgba(226,238,246,0)');
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(rx, ry);
      ctx.quadraticCurveTo(rx + nx * len * 0.5, ry + ny * len * 0.5 - len * 0.18, ex - cs * len * 0.12, ey - len * 0.06);
      ctx.lineTo(ex + cs * len * 0.12, ey + len * 0.06); ctx.closePath(); ctx.fill();
      for (var k = 0; k < 9; k++) {                                         // капли: по дуге, каждая со своим временем
        var ph = ((t * 2.2 + k * 0.137 + i * 0.31) % 1), px = rx + nx * len * 0.95 * ph - cs * len * 0.25 * ph, py = ry + ny * len * 0.95 * ph - Math.sin(Math.PI * ph) * len * 0.16 + len * 0.12 * ph;
        ctx.globalAlpha = a * 0.75 * (1 - ph); ctx.fillStyle = 'rgb(236,244,250)';
        ctx.beginPath(); ctx.arc(px + Math.sin(k * 7.1) * len * 0.05, py, Math.max(0.5, len * 0.022), 0, 6.283); ctx.fill();
      }
    });
    ctx.globalAlpha = a * 0.16; ctx.fillStyle = 'rgb(70,80,92)';           // мокрый асфальт позади
    ctx.beginPath(); ctx.ellipse(rx - cs * len * 0.5, ry - sn * len * 0.3 + len * 0.06, len * 0.6, len * 0.16, Math.atan2(sn * 0.6, cs), 0, 6.283); ctx.fill();
    ctx.restore();
  }
  function carLights(len, wd, kind, a, L, noBody) {   // e1.10 ночь: кузов в темноте, лучи фар ложатся на дорогу, красные задние огни; троллейбус — тёплый салон
    if (!noBody) { ctx.globalAlpha = a * 0.6 * L; ctx.fillStyle = 'rgb(16,20,40)'; ctx.fillRect(-len / 2, -wd / 2, len, wd); }
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createLinearGradient(len / 2, 0, len / 2 + len * 2.4, 0);
    g.addColorStop(0, 'rgba(255,228,170,' + 0.34 * L * a + ')'); g.addColorStop(1, 'rgba(255,228,170,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(len / 2, -wd * 0.36); ctx.lineTo(len / 2 + len * 2.4, -wd * 1.25); ctx.lineTo(len / 2 + len * 2.4, wd * 1.25); ctx.lineTo(len / 2, wd * 0.36); ctx.closePath(); ctx.fill();
    var rg = ctx.createRadialGradient(len * 1.1, 0, 0, len * 1.1, 0, len * 0.9);   // e1.12: отблеск фар на асфальте — тёплое пятно перед машиной
    rg.addColorStop(0, 'rgba(255,214,150,' + 0.22 * L * a + ')'); rg.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = rg; ctx.save(); ctx.scale(1, 0.55); ctx.beginPath(); ctx.arc(len * 1.1, 0, len * 0.9, 0, 6.283); ctx.fill(); ctx.restore();
    var tg = ctx.createRadialGradient(-len * 0.75, 0, 0, -len * 0.75, 0, len * 0.4);   // и красный отблеск задних огней
    tg.addColorStop(0, 'rgba(255,40,30,' + 0.2 * L * a + ')'); tg.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = tg; ctx.save(); ctx.scale(1, 0.55); ctx.beginPath(); ctx.arc(-len * 0.75, 0, len * 0.4, 0, 6.283); ctx.fill(); ctx.restore();
    ctx.globalAlpha = a * L; ctx.fillStyle = 'rgb(255,244,210)'; ctx.beginPath(); ctx.arc(len / 2, -wd * 0.3, wd * 0.12, 0, 6.283); ctx.arc(len / 2, wd * 0.3, wd * 0.12, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgb(255,46,34)'; ctx.globalAlpha = a * 0.95 * L; ctx.beginPath(); ctx.arc(-len / 2, -wd * 0.32, wd * 0.11, 0, 6.283); ctx.arc(-len / 2, wd * 0.32, wd * 0.11, 0, 6.283); ctx.fill();
    ctx.globalAlpha = a * 0.3 * L; ctx.beginPath(); ctx.arc(-len / 2, -wd * 0.32, wd * 0.3, 0, 6.283); ctx.arc(-len / 2, wd * 0.32, wd * 0.3, 0, 6.283); ctx.fill();
    if (kind === 'trolley' && !noBody) { ctx.globalAlpha = a * 0.5 * L; ctx.fillStyle = 'rgb(255,214,140)'; for (var k = 0; k < 6; k++) ctx.fillRect(-len * 0.44 + k * len * 0.15, -wd * 0.3, len * 0.09, wd * 0.6); }
    ctx.globalCompositeOperation = 'source-over';
  }
  function flyBird(x, y, s, flap, head, col, a) {   // птица в полёте: тело, голова, хвост, крылья — заливкой с карандашным краем
    var c = Math.cos(head), sn = Math.sin(head), wy = -flap * s * 0.75, mid = -flap * s * 0.25 - s * 0.08;
    ctx.save(); ctx.translate(x, y); ctx.scale(c < 0 ? -1 : 1, 1);
    ctx.globalAlpha = a; ctx.fillStyle = 'rgb(' + col + ')'; ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = Math.max(0.5, s * 0.12); ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.42, s * 0.13, sn * 0.3, 0, 6.283); ctx.fill();                 // тело
    ctx.beginPath(); ctx.arc(s * 0.42, -s * 0.05, s * 0.1, 0, 6.283); ctx.fill();                            // голова
    ctx.beginPath(); ctx.moveTo(-s * 0.36, 0); ctx.lineTo(-s * 0.62, -s * 0.08); ctx.lineTo(-s * 0.6, s * 0.1); ctx.closePath(); ctx.fill();   // хвост
    ctx.globalAlpha = a * 0.85;
    ctx.beginPath(); ctx.moveTo(-s * 0.12, -s * 0.04); ctx.quadraticCurveTo(-s * 0.35, mid - s * 0.1, -s * 0.55, wy - s * 0.25); ctx.quadraticCurveTo(-s * 0.2, mid + s * 0.05, s * 0.12, -s * 0.02); ctx.closePath(); ctx.fill();   // дальнее крыло
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.moveTo(-s * 0.08, 0); ctx.quadraticCurveTo(s * 0.0, mid - s * 0.15, s * 0.15, wy - s * 0.35); ctx.quadraticCurveTo(s * 0.18, mid + s * 0.02, s * 0.2, -s * 0.02); ctx.closePath(); ctx.fill();   // ближнее крыло
    ctx.restore();
  }
  function pigeon(x, y, s, face, peck, col, a) {   // голубь на земле: сизое тело акварелью, тёмное крыло и голова, тонкий карандашный контур
    if (spr(peck ? 'pigeon_peck' : 'pigeon_sit', x, y, s * 10.6, face < 0, 0, a)) return;
    var hy = peck ? s * 0.9 : 0;
    ctx.save(); ctx.translate(x, y); ctx.scale(face, 1); ctx.lineWidth = Math.max(0.45, s * 0.35); ctx.strokeStyle = 'rgb(' + col + ')';
    ctx.globalAlpha = a * 0.9; ctx.fillStyle = 'rgb(150,156,168)';
    ctx.beginPath(); ctx.ellipse(-s * 0.4, -s * 2.0, s * 3.0, s * 1.75, -0.12, 0, 6.283); ctx.fill();
    ctx.globalAlpha = a * 0.55; ctx.stroke();
    ctx.globalAlpha = a * 0.75; ctx.fillStyle = 'rgb(108,114,128)';
    ctx.beginPath(); ctx.ellipse(-s * 1.0, -s * 2.3, s * 1.9, s * 0.9, -0.2, 0, 6.283); ctx.fill();   // крыло
    ctx.beginPath(); ctx.moveTo(-s * 3.2, -s * 2.1); ctx.lineTo(-s * 4.8, -s * 1.5); ctx.lineTo(-s * 3.1, -s * 1.3); ctx.closePath(); ctx.fill();   // хвост
    ctx.globalAlpha = a * 0.9; ctx.fillStyle = 'rgb(118,124,138)';
    ctx.beginPath(); ctx.arc(s * 2.6, -s * 3.4 + hy, s * 1.05, 0, 6.283); ctx.fill();   // голова
    ctx.fillStyle = 'rgb(205,170,120)'; ctx.beginPath(); ctx.moveTo(s * 3.5, -s * 3.4 + hy); ctx.lineTo(s * 4.4, -s * 3.0 + hy); ctx.lineTo(s * 3.4, -s * 2.95 + hy); ctx.fill();   // клюв
    ctx.globalAlpha = a * 0.7; ln(-s * 0.2, -s * 0.4, -s * 0.2, s * 0.2); ln(s * 0.7, -s * 0.4, s * 0.7, s * 0.2);   // лапки
    ctx.restore();
  }
  function wingOf(b, t) {   // свой ритм крыльев: взмахи сериями, между ними — планирование (крылья чуть подняты)
    var seg = Math.sin(t * b.gr + b.gp) + 0.35 * Math.sin(t * b.gr * 2.3 + b.gp * 1.7);
    if (seg < b.glide) return 0.15 + 0.05 * Math.sin(t * 2 + b.gp);
    return Math.sin(t * b.wf + b.gp);
  }
  function newBird(i) { return { wf: rnd(15, 21), gr: rnd(0.5, 1.1), gp: rnd(0, 6.28), glide: rnd(-0.6, 0.1), ox: rnd(-1, 1), oy: rnd(-1, 1), fx: rnd(0.3, 0.9), fy: rnd(0.3, 0.9), ph: rnd(0, 6.28), size: rnd(0.85, 1.15), gx: rnd(-1, 1), gy: rnd(-0.4, 0.4), delay: rnd(0, 0.8), face: Math.random() < 0.5 ? 1 : -1 }; }
  function drawPigeons(f, o, t, dt, col, a0, light) {   // голуби на земле: живая стая, без одинаковых циклов
    var S = o._st || (o._st = { mode: 'ground', t0: t, next: t + rnd(o.rest[0] * 0.4, o.rest[1] * 0.6), birds: [] });
    while (S.birds.length < o.n) S.birds.push(newBird(S.birds.length));
    var base = ground(f, o.at[0], o.at[1]), unit = Math.max(2.2, sizePx(f, o.at[0], o.at[1], o.size));
    if (NIGHT > 0.5 && S.mode === 'ground') S.next = Math.max(S.next, t + 2);   // ночью голуби спят на земле
    if (S.mode === 'ground' && t > S.next) { S.mode = 'fly'; S.t0 = t; S.dur = rnd(o.fly[0], o.fly[1]); S.cx = rnd(-1, 1); S.dir = Math.random() < 0.5 ? 1 : -1; S.birds.forEach(function (b) { b.delay = rnd(0, 0.7); }); }
    if (S.mode === 'fly' && t > S.t0 + S.dur + 1.6) { S.mode = 'ground'; S.next = t + rnd(o.rest[0], o.rest[1]); S.birds.forEach(function (b) { b.gx = rnd(-1, 1); b.gy = rnd(-0.4, 0.4); }); }
    var R = o.radius * W, inkA = light ? 0.55 : 0.62, bc = '92,98,112';   // голуби всегда сизые, не чёрные кляксы
    S.birds.forEach(function (b, i) {
      var gx = base[0] + b.gx * unit * 4.5, gy = base[1] + b.gy * unit * 2;
      if (S.mode === 'ground' || t < S.t0 + b.delay) {
        var awake = NIGHT < 0.5, peck = awake && Math.sin(t * (2.2 + b.fx) + b.ph) > 0.75 ? 1.4 : 0, walk = awake ? Math.sin(t * 0.35 * b.fx + b.ph) * unit * 0.6 : 0;
        pigeon(gx + walk, gy, unit / 9, b.face, peck, bc, (light ? 0.75 : 1) * a0);
        return;
      }
      var k = (t - S.t0 - b.delay) / S.dur, k2 = clamp(k, 0, 1.25), up = Math.sin(Math.PI * clamp(k2, 0, 1));
      var ang = S.dir * (k2 * 4.2 + b.ph * 0.15), spread = 0.55 + 0.45 * Math.sin(t * 0.9 + b.ph) * Math.sin(t * 0.37);   // стая то собирается, то расходится
      var cx = base[0] + Math.cos(ang) * R * up * (1 + 0.3 * S.cx), cy = base[1] - up * R * 0.9 + Math.sin(ang) * R * 0.3 * up;
      var x = cx + (b.ox * spread + 0.2 * Math.sin(t * b.fx + b.ph)) * unit * 6 * up, y = cy + (b.oy * spread + 0.2 * Math.cos(t * b.fy + b.ph)) * unit * 3.5 * up;
      if (k > 1) { var l = clamp((k - 1) / 0.25, 0, 1); x = x + (gx - x) * l; y = y + (gy - y) * l; }   // посадка на новое место
      var landing = k > 0.85, fl = landing ? 0.3 + 0.7 * Math.sin(t * 24 + b.ph) : wingOf(b, t);
      pigeonFly(x, y, unit * 0.9 * b.size, fl, S.dir * (ang + Math.PI / 2), inkA * a0 * 1.15, landing && k > 0.95);
    });
  }
  function drawSkyFlock(f, o, t, col, a0, light) {   // стая пролетает через небо: форма меняется, птицы машут каждая в своём ритме
    var S = o._st || (o._st = { next: t + rnd(2, o.every[0]), run: null, birds: [] });
    if (!S.run && t > S.next && NIGHT > 0.5) S.next = t + 3;   // ночью стаи не летают
    if (!S.run && t > S.next) { S.run = { t0: t, dur: rnd(9, 15), dir: Math.random() < 0.5 ? 1 : -1, v: o.band[0] + (o.band[1] - o.band[0]) * Math.random(), n: Math.round(o.n * rnd(0.6, 1.2)), wob: rnd(0.4, 1) }; S.birds = []; for (var i = 0; i < S.run.n; i++) S.birds.push(newBird(i)); }
    if (!S.run) return;
    var r = S.run, k = (t - r.t0) / r.dur; if (k > 1) { S.run = null; S.next = t + rnd(o.every[0], o.every[1]); return; }
    var s0 = o.size * H, cu = r.dir > 0 ? -0.12 + 1.24 * k : 1.12 - 1.24 * k, cv = r.v + 0.02 * Math.sin(k * 6 * r.wob);
    var stretch = 1 + 0.6 * Math.sin(k * 5 + r.wob), inkA = light ? 0.5 : 0.8, bc = light ? '92,98,112' : col;
    S.birds.forEach(function (b) {
      var u = cu - r.dir * (b.ox + 1) * 0.06 * stretch + 0.008 * Math.sin(t * b.fx + b.ph), v = cv + b.oy * 0.022 / stretch + 0.006 * Math.cos(t * b.fy + b.ph);
      var p = P(u, v, 0.3); flyBird(p[0], p[1], s0 * b.size, wingOf(b, t), r.dir > 0 ? 0 : Math.PI, bc, inkA * a0);
    });
  }
  // ---------- e1.10 МЕЛОЧИ ДЛЯ КРУПНЫХ ПЛАНОВ (ambient.details; docs/ENGINE-LIFE.md): голубь садится на статую, воробьи на карнизах,
  // листья срываются с крон, ласточки, блик солнца по бронзе. Ночью птиц нет (спят), листья тусклее. ----------
  function DP(f, q, bld) { return bld && V.projectB ? V.projectB(f, q[0], q[1]) : P(q[0], q[1], gd(f, q[0], q[1])); }
  function DS(f, q, sz, bld) { var a = DP(f, q, bld), b = DP(f, [q[0], q[1] - sz], bld); return Math.max(1, Math.abs(a[1] - b[1])); }
  function sparrow(x, y, s, face, peck, col, a) {   // воробей: бурое тело, светлое брюшко, тёмная шапочка, хвостик торчком
    if (spr(peck ? 'sparrow_peck' : 'sparrow_sit', x, y, s * 10.5, face < 0, 0, a)) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(face, 1); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgb(140,108,78)'; ctx.beginPath(); ctx.ellipse(0, -2.3 * s, 3.1 * s, 2.0 * s, -0.25, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgb(214,198,168)'; ctx.beginPath(); ctx.ellipse(0.6 * s, -1.6 * s, 2.0 * s, 1.1 * s, -0.2, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgb(96,74,56)'; ctx.beginPath(); ctx.ellipse(-0.8 * s, -2.9 * s, 1.9 * s, 0.9 * s, -0.35, 0, 6.283); ctx.fill();   // крыло
    ctx.beginPath(); ctx.moveTo(-2.6 * s, -2.6 * s); ctx.lineTo(-5.2 * s, -3.9 * s); ctx.lineTo(-4.6 * s, -2.7 * s); ctx.closePath(); ctx.fill();   // хвост
    ctx.fillStyle = 'rgb(120,94,70)'; ctx.beginPath(); ctx.arc(2.5 * s, -3.9 * s + peck * s, 1.35 * s, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgb(118,116,116)'; ctx.beginPath(); ctx.arc(2.4 * s, -4.5 * s + peck * s, 0.8 * s, 3.3, 6.1); ctx.fill();   // серая шапочка
    ctx.fillStyle = 'rgb(40,34,30)'; ctx.beginPath(); ctx.moveTo(3.7 * s, -4.0 * s + peck * s); ctx.lineTo(4.6 * s, -3.7 * s + peck * s); ctx.lineTo(3.6 * s, -3.5 * s + peck * s); ctx.fill();
    ctx.globalAlpha = a * 0.5; ctx.strokeStyle = 'rgb(' + col + ')'; ctx.lineWidth = Math.max(0.4, s * 0.3);
    ctx.beginPath(); ctx.ellipse(0, -2.3 * s, 3.1 * s, 2.0 * s, -0.25, 0, 6.283); ctx.stroke();
    ln(-0.3 * s, -0.4 * s, -0.4 * s, 0.2 * s); ln(0.8 * s, -0.4 * s, 0.8 * s, 0.2 * s);
    ctx.restore();
  }
  function swallow(x, y, s, flap, dir, a) {   // ласточка: тёмно-синяя птица с острыми крыльями и раздвоенным хвостом (крылья всегда раскрыты)
    flyBird(x, y, s, 0.35 + 0.65 * flap, dir > 0 ? 0 : Math.PI, '30,36,64', a);
    ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1); ctx.globalAlpha = a; ctx.strokeStyle = 'rgb(30,36,64)'; ctx.lineWidth = Math.max(0.6, s * 0.06);
    ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.02); ctx.lineTo(-s * 0.9, -s * 0.16); ctx.moveTo(-s * 0.5, s * 0.02); ctx.lineTo(-s * 0.88, s * 0.12); ctx.stroke();
    ctx.restore();
  }
  function leaf(x, y, s, rot, flip, green, a) {   // лист: заострённый, с жилкой; переворачивается в полёте (flip — сжатие по ширине)
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, Math.max(0.15, Math.abs(flip))); ctx.globalAlpha = a;
    ctx.fillStyle = green ? 'rgb(112,146,72)' : 'rgb(196,160,70)';
    ctx.beginPath(); ctx.moveTo(-s, 0); ctx.quadraticCurveTo(0, -s * 0.62, s, 0); ctx.quadraticCurveTo(0, s * 0.62, -s, 0); ctx.fill();
    ctx.globalAlpha = a * 0.55; ctx.strokeStyle = 'rgb(70,64,40)'; ctx.lineWidth = Math.max(0.4, s * 0.1); ln(-s, 0, s * 0.9, 0);
    ctx.restore();
  }
  function drawDetails(now, w, f, D) {
    var t = now / 1000, col = ink(), day = 1 - sstep(0.45, 0.8, w.n), S = D._st || (D._st = { birds: [], sp: [], lv: [], sw: null, swNext: t + rnd(2, 6), gl: null, glNext: t + rnd(2, 5), lvNext: t });
    ctx.save(); ctx.lineCap = 'round';
    // листья: раз в 1–3 с с кроны срывается лист, кружит по ветру и опускается
    (function () {
      var L = D.leaves; if (!L) return;
      var wind = wxNow().wind;
      if (t > S.lvNext && S.lv.length < (L.n || 6)) { var ar = L.areas[(Math.random() * L.areas.length) | 0]; S.lv.push({ u: rnd(ar[0], ar[2]), v: rnd(ar[1], ar[3]), t0: t, dur: rnd(4.5, 7.5), fall: (L.fall || 0.1) * rnd(0.7, 1.2), dx: rnd(0.02, 0.06) * (Math.random() < 0.3 ? -1 : 1), ph: rnd(0, 6.28), sp: rnd(2.2, 3.6), g: Math.random() < 0.65, sz: (L.size || 0.006) * rnd(0.8, 1.2) }); S.lvNext = t + rnd(0.8, 2.6) / Math.max(0.6, wind); }
      for (var i = S.lv.length - 1; i >= 0; i--) {
        var q = S.lv[i], k = (t - q.t0) / q.dur; if (k >= 1) { S.lv.splice(i, 1); continue; }
        var u = q.u + q.dx * k * wind + 0.012 * Math.sin(k * 7 + q.ph), v = q.v + q.fall * k;
        var p = P(u, v, gd(f, clamp(u, 0, 1), clamp(q.v, 0, 1))), sz = DS(f, [q.u, q.v], q.sz, false);
        leaf(p[0], p[1], sz, Math.sin(t * q.sp + q.ph) * 0.9 + q.ph, Math.cos(t * q.sp * 1.3 + q.ph), q.g, (0.4 + 0.5 * day) * Math.min(1, k * 6, (1 - k) * 4));
      }
    })();
    if (day < 0.03) { ctx.restore(); return; }
    // блик солнца скользит по бронзе (раз в 7–13 с), только днём
    // e1.13 пятна света сквозь листву (D.dapple {areas: [[u0, v0, u1, v1]], n, size}): тёплые мягкие пятна дрожат и плывут с ветром; только днём
    if (D.dapple && day > 0.05) {
      var DA = D.dapple;
      if (!S.dp) { S.dp = []; for (var di = 0; di < (DA.n || 14); di++) { var ar = DA.areas[di % DA.areas.length]; S.dp.push({ u: rnd(ar[0], ar[2]), v: rnd(ar[1], ar[3]), r: rnd(0.6, 1.4), ph: rnd(0, 6.28), sp: rnd(0.4, 1.1) }); } }
      var wd = wxNow().wind || 0.3;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      S.dp.forEach(function (q) {
        var sw = Math.sin(t * q.sp * (0.6 + wd) + q.ph), p = DP(f, [q.u + 0.004 * sw, q.v + 0.002 * Math.cos(t * q.sp + q.ph)], false), rr = Math.max(2, DS(f, [q.u, q.v], (DA.size || 0.012) * q.r, false));
        var al = (0.10 + 0.08 * Math.sin(t * q.sp * 2.1 + q.ph * 3)) * day;
        var gg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rr); gg.addColorStop(0, 'rgba(255,236,190,' + al.toFixed(3) + ')'); gg.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(p[0], p[1], rr, rr * 0.55, 0, 0, 6.283); ctx.fill();
      });
      ctx.restore();
    }
    // e1.13 пылинки в луче (D.motes {beam: [u верх, v верх, u низ, v низ], width, n}): едва видный наклонный луч и медленно плывущие искорки; только днём
    if (D.motes && day > 0.05) {
      var MO = D.motes, b0 = DP(f, [MO.beam[0], MO.beam[1]], false), b1 = DP(f, [MO.beam[2], MO.beam[3]], false), bw = Math.abs(DP(f, [MO.beam[0] + (MO.width || 0.1), MO.beam[1]], false)[0] - b0[0]);
      if (!S.mo) { S.mo = []; for (var mi = 0; mi < (MO.n || 26); mi++) S.mo.push({ k: Math.random(), o: rnd(-0.5, 0.5), ph: rnd(0, 6.28), sp: rnd(0.01, 0.03) }); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var bx = b1[0] - b0[0], by = b1[1] - b0[1], bl = Math.hypot(bx, by) || 1, nx = -by / bl, ny = bx / bl;
      var bg = ctx.createLinearGradient(b0[0], b0[1], b1[0], b1[1]); bg.addColorStop(0, 'rgba(255,240,205,' + (0.07 * day).toFixed(3) + ')'); bg.addColorStop(1, 'rgba(255,240,205,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(b0[0] - nx * bw * 0.4, b0[1] - ny * bw * 0.4); ctx.lineTo(b0[0] + nx * bw * 0.4, b0[1] + ny * bw * 0.4);
      ctx.lineTo(b1[0] + nx * bw * 0.6, b1[1] + ny * bw * 0.6); ctx.lineTo(b1[0] - nx * bw * 0.6, b1[1] - ny * bw * 0.6); ctx.closePath(); ctx.fill();
      S.mo.forEach(function (q) {
        q.k = (q.k + q.sp * 0.016) % 1; var kk = q.k, off = (q.o + 0.12 * Math.sin(t * 0.7 + q.ph)) * bw * (0.4 + 0.2 * kk);
        var x = b0[0] + bx * kk + nx * off, y = b0[1] + by * kk + ny * off, tw = 0.5 + 0.5 * Math.sin(t * 2.3 + q.ph * 5);
        ctx.globalAlpha = day * (0.25 + 0.55 * tw) * Math.sin(Math.PI * kk); ctx.fillStyle = 'rgb(255,246,220)';
        ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, bw * 0.012), 0, 6.283); ctx.fill();
      });
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (D.glint && w.n < 0.4) {
      var G = D.glint;
      if (!S.gl && t > S.glNext) S.gl = { t0: t, dur: rnd(1.6, 2.4) };
      if (S.gl) {
        var kg = (t - S.gl.t0) / S.gl.dur;
        if (kg >= 1) { S.gl = null; S.glNext = t + rnd((G.every || [7, 13])[0], (G.every || [7, 13])[1]); }
        else {
          var pts = G.poly.map(function (q) { return DP(f, q, G.bld !== false); }), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
          pts.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
          ctx.save(); ctx.beginPath(); pts.forEach(function (p, j) { if (j) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.clip();
          var cx = x0 - (x1 - x0) * 0.3 + (x1 - x0) * 1.6 * kg, bw = Math.max(6, (x1 - x0) * 0.13), e = Math.sin(Math.PI * kg), hh = (y1 - y0);
          ctx.translate(cx, (y0 + y1) / 2); ctx.rotate(0.38);   // наклонная полоса света
          var gg = ctx.createLinearGradient(-bw, 0, bw, 0); gg.addColorStop(0, 'rgba(255,240,200,0)'); gg.addColorStop(0.5, 'rgba(255,240,200,' + (G.k || 0.3) * e * day + ')'); gg.addColorStop(1, 'rgba(255,240,200,0)');
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gg; ctx.fillRect(-bw, -hh, 2 * bw, 2 * hh);
          ctx.restore();
        }
      }
    }
    // ласточки: 2–4 проносятся дугой с нырком, раз в 5–12 с
    if (D.swallows) {
      var SW = D.swallows;
      if (!S.sw && t > S.swNext && w.n < 0.4) { var n = Math.round(rnd(2, SW.n || 4)), dir = Math.random() < 0.5 ? 1 : -1, b0 = SW.band[0] + (SW.band[1] - SW.band[0]) * Math.random(); S.sw = { t0: t, dur: rnd(2.4, 3.6), dir: dir, v: b0, b: [] }; for (var j = 0; j < n; j++) S.sw.b.push({ d: rnd(0, 0.35), dv: rnd(-0.03, 0.03), ph: rnd(0, 6.28), dip: rnd(0.03, 0.08), wf: rnd(18, 26) }); }
      if (S.sw) {
        var r = S.sw, kk = (t - r.t0) / r.dur;
        if (kk > 1.4) { S.sw = null; S.swNext = t + rnd((SW.every || [5, 12])[0], (SW.every || [5, 12])[1]); }
        else r.b.forEach(function (b) {
          var k = kk - b.d; if (k < 0 || k > 1) return;
          var u = r.dir > 0 ? -0.1 + 1.2 * k : 1.1 - 1.2 * k, v = r.v + b.dv + b.dip * Math.sin(Math.PI * k) - 0.02 * Math.sin(k * 9 + b.ph);
          var p = P(u, v, 0.3), fl = Math.sin(t * b.wf + b.ph) * (Math.sin(t * 2 + b.ph) > 0.2 ? 1 : 0.15);
          swallow(p[0], p[1], (SW.size || 0.014) * H, fl, r.dir, 0.9 * day);
        });
      }
    }
    // воробьи прыгают по карнизу/постаменту, клюют, иногда перелетают
    if (D.sparrows) {
      var SP = D.sparrows, Lg = SP.ledges;
      while (S.sp.length < (SP.n || 4)) S.sp.push({ L: (Math.random() * Lg.length) | 0, k: Math.random(), face: Math.random() < 0.5 ? 1 : -1, hop: null, next: t + rnd(0.3, 2), peck: 0, fly: null });
      S.sp.forEach(function (b) {
        var g = Lg[b.L], lb = function (q) { return q.length > 4 ? !!q[4] : !!SP.bld; }, pos = function (L, k) { var q = Lg[L]; return DP(f, [q[0] + (q[2] - q[0]) * k, q[1] + (q[3] - q[1]) * k], lb(q)); };
        var sz = DS(f, [g[0], g[1]], SP.size || 0.008, lb(g)) / 5;
        if (b.fly) {   // перелёт на другой карниз
          var kf = (t - b.fly.t0) / b.fly.dur;
          if (kf >= 1) { b.L = b.fly.L; b.k = b.fly.k; b.fly = null; b.next = t + rnd(0.5, 2); }
          else { var A0 = pos(b.fly.L0, b.fly.k0), A1 = pos(b.fly.L, b.fly.k), e = kf * kf * (3 - 2 * kf); flyBird(A0[0] + (A1[0] - A0[0]) * e, A0[1] + (A1[1] - A0[1]) * e - Math.sin(Math.PI * kf) * sz * 14, sz * 7, Math.sin(t * 30), A1[0] > A0[0] ? 0 : Math.PI, '120,94,70', 0.9 * day); return; }
        }
        if (!b.hop && t > b.next) {
          if (Math.random() < 0.08 && Lg.length) { var L2 = (Math.random() * Lg.length) | 0; b.fly = { t0: t, dur: rnd(0.8, 1.4), L0: b.L, k0: b.k, L: L2, k: Math.random() }; return; }
          if (Math.random() < 0.55) { var nk = clamp(b.k + rnd(-0.08, 0.08), 0.02, 0.98); b.face = nk > b.k ? 1 : -1; b.hop = { t0: t, k0: b.k, k1: nk }; }
          else b.peck = t + rnd(0.4, 1.2);
          b.next = t + rnd(0.4, 1.8);
        }
        var p, lift = 0;
        if (b.hop) { var kh = (t - b.hop.t0) / 0.22; if (kh >= 1) { b.k = b.hop.k1; b.hop = null; } else { b.k = b.hop.k0 + (b.hop.k1 - b.hop.k0) * kh; lift = Math.sin(Math.PI * kh) * sz * 3; } }
        p = pos(b.L, b.k);
        sparrow(p[0], p[1] - lift, sz, b.face, t < b.peck && Math.sin(t * 18) > 0 ? 1.2 : 0, col, 0.95 * day);
      });
    }
    // голуби садятся на голову/плечо/руку статуи: прилёт, посадка с поднятыми крыльями, сидит (вертит головой), взлёт
    if (D.perches) {
      var PR = D.perches, spots = PR.spots;
      while (S.birds.length < (PR.n || 1)) S.birds.push({ st: 'wait', t0: t, wait: rnd(1, 5) + S.birds.length * 4 });
      S.birds.forEach(function (b) {
        if (b.st === 'wait') { if (t - b.t0 < b.wait) return; var used = S.birds.map(function (o) { return o.spot; }), sp; do { sp = (Math.random() * spots.length) | 0; } while (used.indexOf(sp) >= 0 && spots.length > S.birds.length); b.spot = sp; b.st = 'in'; b.t0 = t; b.dur = rnd(2.2, 3.0); b.left = Math.random() < 0.5; b.sit = rnd(6, 14); b.ph = rnd(0, 6.28); }
        var q = spots[b.spot], tgt = DP(f, q, PR.bld !== false), sz = DS(f, q, PR.size || 0.012, PR.bld !== false) / 4.6, k = (t - b.t0) / b.dur;
        if (b.st === 'in') {
          if (k >= 1) { b.st = 'sit'; b.t0 = t; }
          else {
            var from = DP(f, [b.left ? -0.15 : 1.15, q[1] - 0.18], PR.bld !== false), e = 1 - Math.pow(1 - k, 2.4);
            var x = from[0] + (tgt[0] - from[0]) * e, y = from[1] + (tgt[1] - from[1]) * e - Math.sin(Math.PI * k) * sz * 18;
            var landing = k > 0.82, fl = landing ? 0.9 + 0.1 * Math.sin(t * 30) : Math.sin(t * (14 + 6 * k) + b.ph);
            pigeonFly(x, y - (landing ? sz * 2 : 0), sz * 9, fl, b.left ? 0 : Math.PI, 0.95 * day, landing);
          }
        }
        if (b.st === 'sit') {
          var ks = t - b.t0;
          if (ks > b.sit) { b.st = 'out'; b.t0 = t; b.dur = rnd(1.8, 2.4); }
          else { var look = Math.sin(ks * 1.3 + b.ph) > 0.4 ? (b.left ? 1 : -1) : (b.left ? -1 : 1), bob = Math.sin(ks * 2.2 + b.ph) > 0.85 ? 0.8 : 0; pigeon(tgt[0], tgt[1], sz, look, bob, col, 0.95 * day); }
        }
        if (b.st === 'out') {
          if (k >= 1) { b.st = 'wait'; b.t0 = t; b.wait = rnd(3, 10); b.spot = -1; }
          else { var e2 = k * k, dx = (b.left ? 1 : -1) * 0.4 * e2; var pt = DP(f, [q[0] + dx, q[1] - 0.22 * e2], PR.bld !== false); pigeonFly(pt[0], pt[1], sz * 9, Math.sin(t * 26 + b.ph), b.left ? 0 : Math.PI, 0.95 * day * (1 - sstep(0.75, 1, k))); }
        }
      });
    }
    ctx.restore();
  }
  // e1.13 синемаграф (кадр: motionVideo {src, mask, depth, on, hideLife}; выключен, пока не on или ?cine=1): видео Veo, вклеенное в
  // резкий рисунок только там, где есть движение (tools/cinemagraph.py). Кладётся на глубине фона и двигается с наклоном; ночью гаснет.
  var MVS = {}; root.__MVS = MVS;   // для проверочных скриптов
  function drawMotionVideo(now, w, f, fr, M) {
    var S = MVS[fr];
    if (!S) {
      var base = ((root.CONFIG.FRAMES[fr] || {}).color || '').replace(/[^\/]*$/, '');
      S = MVS[fr] = { v: document.createElement('video'), m: new Image(), c: document.createElement('canvas') };
      S.v.muted = true; S.v.loop = true; S.v.playsInline = true; S.v.setAttribute('playsinline', ''); S.v.setAttribute('muted', ''); S.v.preload = 'auto';
      S.v.src = base + (S.v.canPlayType('video/mp4; codecs="avc1.42E01E"') ? M.src : M.src.replace(/\.mp4$/, '.webm')); S.m.src = base + M.mask;   // без H.264 — запасной VP9
      var pl = S.v.play(); if (pl && pl.catch) pl.catch(function () {});
    }
    var a = 1 - sstep(0.15, 0.5, w.n);
    Object.keys(MVS).forEach(function (k) { if (+k !== fr && !MVS[k].v.paused) MVS[k].v.pause(); });
    if (a < 0.02) { if (!S.v.paused) S.v.pause(); return; }
    if (S.v.paused) { var p2 = S.v.play(); if (p2 && p2.catch) p2.catch(function () {}); }
    if (S.v.readyState < 2 || !S.m.complete || !S.m.naturalWidth) return;
    var vw = S.v.videoWidth, vh = S.v.videoHeight;
    if (S.c.width !== vw) { S.c.width = vw; S.c.height = vh; }
    var x = S.c.getContext('2d');
    x.globalCompositeOperation = 'copy'; x.drawImage(S.v, 0, 0, vw, vh);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(S.m, 0, 0, vw, vh); x.globalCompositeOperation = 'source-over';
    if (!S.bands) {   // полосы по высоте кадра, у каждой своя глубина (медиана глубины фона там, где в маске есть движение) — видео едет с наклоном, как земля
      var mc = document.createElement('canvas'), NB = 28; mc.width = 96; mc.height = 168;
      var mx = mc.getContext('2d', { willReadFrequently: true }); mx.drawImage(S.m, 0, 0, 96, 168);
      var md = mx.getImageData(0, 0, 96, 168).data; S.bands = [];
      for (var bi = 0; bi < NB; bi++) {
        var ds = [], y0 = Math.floor(bi * 168 / NB), y1 = Math.floor((bi + 1) * 168 / NB);
        for (var yy = y0; yy < y1; yy++) for (var xx = 0; xx < 96; xx++) if (md[(yy * 96 + xx) * 4 + 3] > 100) ds.push(depthAt(f, (xx + 0.5) / 96, (yy + 0.5) / 168));
        if (ds.length) { ds.sort(function (p, q) { return p - q; }); S.bands.push([bi / NB, (bi + 1) / NB, ds[ds.length >> 1]]); }
      }
    }
    ctx.save(); ctx.globalAlpha = a;
    S.bands.forEach(function (b) {
      var q0 = P(0, b[0], b[2]), q1 = P(1, b[1], b[2]), sy = b[0] * vh, sh = (b[1] - b[0]) * vh;
      ctx.drawImage(S.c, 0, sy, vw, sh, q0[0], q0[1] - 0.5, q1[0] - q0[0], q1[1] - q0[1] + 1);   // +1 px — без щелей между полосами
    });
    ctx.restore();
  }
  function perspAt(P2, v) {   // ambient.persp [[v, длина машины], …] — длина машины по высоте кадра (перспектива рисунка)
    if (v <= P2[0][0]) return P2[0][1];
    for (var k = 1; k < P2.length; k++) if (v <= P2[k][0]) return P2[k - 1][1] + (P2[k][1] - P2[k - 1][1]) * (v - P2[k - 1][0]) / (P2[k][0] - P2[k - 1][0]);
    return P2[P2.length - 1][1];
  }
  function drawAmbientLife(now, w, f, A) {
    var t = now / 1000, col = ink(), night = w.n, a0 = 1 - 0.35 * night, ar = aspect(), Q = []; NIGHT = night;
    var dt = A._t != null ? clamp(t - A._t, 0, 0.1) : 0; A._t = t;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    (A.walkers || []).forEach(function (o0, gi) {   // мелкие люди: идут по пути с перерывами, скорость — в ростах в секунду
      var o = lp('walkers', o0), n = Math.round(o.n * (1 - 0.85 * night)), st = o0._st || (o0._st = []);   // ночью людей почти нет
      for (var i = 0; i < n; i++) {
        var m = st[i] || (st[i] = { s: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, wait: 0, sp: rnd(0.85, 1.15), coat: COATS[(i * 3 + gi) % COATS.length], who: WALKERS[(i + gi) % WALKERS.length] });
        if (m.wait > 0) { m.wait -= dt; continue; }
        var L = pathOf(o0), tot = L[L.length - 1], sz = o.size[0] + (o.size[1] - o.size[0]) * m.s;
        m.s += m.dir * o.bps * m.sp * sz * dt / Math.max(1e-6, tot);
        if (m.s > 1 || m.s < 0) { m.dir = Math.random() < 0.5 ? 1 : -1; m.s = m.dir > 0 ? 0 : 1; m.wait = rnd(o.gap[0], o.gap[1]); continue; }
        var q = along(o0, m.s), e = Math.min(1, m.s / 0.04, (1 - m.s) / 0.04);
        (function (q, sz, e, m) { Q.push({ v: q.v, d: function () { var h = sizePx(f, q.u, q.v, sz), p = ground(f, q.u, q.v); if (h < 1.5) return; var ph = Math.floor(t * 4.4 * m.sp + m.s * 30) % 4; if (!sprH('walk_' + m.who + '_' + ph, p[0], p[1], h, m.dir < 0, a0 * e)) tinyPerson(p[0], p[1], h, t * 7 * m.sp + m.s * 40, m.coat, col, a0 * e, m.dir); } }); })(q, sz, e, m);
      }
    });
    (A.cars || []).forEach(function (o0, gi) {   // машины: по дорогам, с перерывами; скорость — в длинах машины в секунду
      var o = lp('cars', o0), n = Math.max(1, Math.round(o.n * (1 - 0.4 * night))), st = o0._st || (o0._st = []);
      for (var i = 0; i < n; i++) {
        var kinds = o.kinds, m = st[i] || (st[i] = { s: o.loop ? i / n : Math.random(), dir: o.loop ? 1 : (i % 2 ? -1 : 1), wait: 0, sp: rnd(0.85, 1.2), kind: kinds[Math.floor(Math.random() * kinds.length)] });
        if (!m.body) m.body = CARS[m.kind][Math.floor(Math.random() * CARS[m.kind].length)];
        if (m.wait > 0) { m.wait -= dt; continue; }
        var L = pathOf(o0), tot = L[L.length - 1], sz = A.persp ? perspAt(A.persp, along(o0, m.s).v) : o.size[0] + (o.size[1] - o.size[0]) * m.s;   // e1.13: масштаб по глубине (ambient.persp)
        m.s += m.dir * o.bps * m.sp * sz * dt / Math.max(1e-6, tot);
        if (o.loop) m.s = (m.s % 1 + 1) % 1;
        else if (m.s > 1 || m.s < 0) { m.s = m.dir > 0 ? 0 : 1; m.wait = rnd(o.gap[0], o.gap[1]); m.kind = kinds[Math.floor(Math.random() * kinds.length)]; m.body = CARS[m.kind][Math.floor(Math.random() * CARS[m.kind].length)]; continue; }
        var q = along(o0, m.s), e = o.loop ? 1 : Math.min(1, m.s / 0.03, (1 - m.s) / 0.03);
        if (o.lane) {   // e1.11: правостороннее движение — машина держится своей полосы, справа от середины дороги
          var dxl = q.du * ar * m.dir, dyl = q.dv * m.dir, Ll = Math.hypot(dxl, dyl) || 1, off = o.lane * sz;
          q = { u: q.u - dyl / Ll * off / ar, v: q.v + dxl / Ll * off, du: q.du, dv: q.dv };
        }
        (function (q, sz, e, m, i) { Q.push({ v: q.v, d: function () {
          var d = gd(f, q.u, q.v), p = P(q.u, q.v, d), ah = P(q.u + q.du * 0.01 * m.dir, q.v + q.dv * 0.01 * m.dir, d), len = sizePx(f, q.u, q.v, sz) * (m.kind === 'trolley' ? 2.6 : m.kind === 'zaz' ? 0.8 : m.kind === 'water' ? 1.3 : 1);
          if (len < 2) return; car(p[0], p[1], len, Math.atan2(ah[1] - p[1], ah[0] - p[0]), m.kind, m.body, col, a0 * e, night, now, i);
        } }); })(q, sz, e, m, i);
      }
    });
    // e1.11 стоящие люди: живая стойка из 4 кадров (вес с ноги на ногу, поворот головы, жест, газета) — кадры меняются в своём ритме, не по кругу
    (A.standers && A.standers.spots || []).forEach(function (sp0, j) {
      var S = A.standers, st = S._st || (S._st = []), m = st[j] || (st[j] = { fr: 0, next: t + rnd(0.5, 3) });
      if (t > m.next) { var who = sp0[2] || 'manhat', seq = STAND_SEQ[who] || STAND_SEQ.manhat; m.fr = seq[(Math.random() * seq.length) | 0]; m.next = t + rnd(1.2, 4.5); }
      var q = { u: sp0[0], v: sp0[1] }, a1 = a0 * (1 - night);
      if (a1 < 0.03) return;
      Q.push({ v: q.v, d: function () { var h = sizePx(f, q.u, q.v, S.size || 0.012), p = ground(f, q.u, q.v); if (h >= 2) sprH('stand_' + (sp0[2] || 'manhat') + '_' + m.fr, p[0], p[1], h, (sp0[3] || 1) < 0, a1); } });
    });
    // e1.11 сценки: двое на скамье, чистильщик обуви, старик кормит голубей — два кадра, свой темп
    (A.scenes && A.scenes.items || []).forEach(function (it, j) {
      var S = A.scenes, st = S._st || (S._st = []), m = st[j] || (st[j] = { fr: 0, next: t + rnd(0.3, 2) }), kind = it[2] || 'bench2';
      if (t > m.next) { m.fr = 1 - m.fr; m.next = t + (kind === 'shine' ? rnd(0.3, 0.45) : kind === 'feeder' ? rnd(0.8, 1.8) : rnd(1.4, 3.5)); }
      var q = { u: it[0], v: it[1] }, a1 = a0 * (1 - night);
      if (a1 < 0.03) return;
      Q.push({ v: q.v, d: function () { var h = sizePx(f, q.u, q.v, S.size || 0.012), p = ground(f, q.u, q.v); if (h >= 2) sprH('sit_' + kind + '_' + m.fr, p[0], p[1], h, (it[3] || 1) < 0, a1); } });
    });
    Q.sort(function (x, y) { return x.v - y.v; });
    Q.forEach(function (q) { var c = occClip(f, A, q.v); q.d(); if (c) ctx.restore(); ctx.globalAlpha = 1; });
    var light = !!A.lightBirds;
    if (A.details) drawDetails(now, w, f, A.details);
    (A.flocks || []).forEach(function (o0) {
      var o = lp('flocks', o0);
      if (o.preset === 'sky' || o.band) drawSkyFlock(f, o0._p ? o : o, t, col, a0 * (1 - 0.8 * night), light);
      else { var c = occClip(f, A, o.at[1]); drawPigeons(f, o, t, dt, col, a0 * (1 - 0.8 * night), light); if (c) ctx.restore(); }
    });
    ctx.restore();
  }
  function drawCloseUp(now, w, f, c) { cu = c; var am = SC(V.frame()).ambient; if (c.glints) drawGlints(now, f, w); if (c.perch && !(am && am.details && am.details.perches)) drawPerch(now, f, w); if (c.mast) drawRoofFlag(now, w); }

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
    var band = PB(fr), vc = band[0] + (band[1] - band[0]) * 0.30, now = performance.now();
    style = style || 'planes';
    var behind = /:behind$/.test(style) || (!!SC(fr).closeUp && style !== 'banner'); style = style.replace(/:behind$/, '');
    var skyOnly = style === 'balloons' || style === 'fireworks';   // шары и ракеты поднимаются из-за города
    par = { t0: now, dur: ({ drones: 22000, heli: 26000, fireworks: 23500, balloons: 20000, banner: 22000 })[style] || 11000, total: style === 'planes' ? 26000 : 0, vc: vc, fr: fr, onEnd: onEnd, puffs: [], last: [-0.12, -0.12, -0.12], flying: true, abort: 0, dv: 0.0135, style: style, behind: behind, skyOnly: skyOnly };
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
      if (so && par.behind) occlude(fr);   // e1.5: салют/шары на кадре «за зданием» — ещё и за вырезкой (маска неба у Ленина по подложке, где здания нет)
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
    // (e1.5) цветного зарева-эллипсов за строем больше нет: светятся сами дроны, и каждый мягко подсвечивает воздух вокруг себя (ореол спрайта)
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
  // --- вертолёт с флагом (e1.5): медленно и без остановки идёт через весь кадр слева направо; под ним на тросе с грузом — ДЛИННЫЙ флаг.
  //     Набегающий поток держит полотнище почти горизонтально за вертолётом, трос отклонён назад и покачивается от порывов (маятник
  //     с затуханием), по ткани бежит волна от троса к свободному краю. Ткань — как у знамени на крупном плане (clothFlag) ---
  function heliPath(tt) {   // u, v по времени (с): ровный ход через кадр (от времени, не от номера кадра) с лёгким «дыханием» скорости и высоты
    var k = tt / 26, u = -0.16 + 1.3 * k + 0.01 * Math.sin(tt * 0.35), v = par.vc - 0.03 - 0.02 * k;
    v += 0.004 * Math.sin(tt * 0.9) + 0.002 * Math.sin(tt * 2.3);
    return [u, v];
  }
  // ткань в стиле знамени (stepBanner): плотная (альфа = a), ночью темнее цветом, а не прозрачностью; мягкие блики и тени складок по наклону
  // волны, редкие штрихи складок, чернильный контур. pt(i, j): i — вдоль полотнища 0..N, j — поперёк 0..3 (полосы по j).
  // Ночью ткань видна только в свете источников: холодный свет неба сверху, тёплый от города снизу и lamp = [x, y, R] — фонарь/прожектор
  function clothCol(col, nn) { var c = col.split(','), d = 0.58 * nn; return Math.round(c[0] * (1 - d) + 14 * d) + ',' + Math.round(c[1] * (1 - d) + 20 * d) + ',' + Math.round(c[2] * (1 - d) + 44 * d); }
  function clothPath(pt) { var N = pt.N, i, q; ctx.beginPath(); for (i = 0; i <= N; i++) { q = pt(i, 0); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } for (i = N; i >= 0; i--) { q = pt(i, 3); ctx.lineTo(q[0], q[1]); } ctx.closePath(); }
  function clothFlag(pt, nn, a, lamp, dk) {   // dk — насколько темнеет ткань ночью без света (у знамени 0.58; в ночном небе у вертолёта темнее)
    var N = pt.N, i, k, q, line = nn > 0.5 ? '84,92,122' : ink(), sh = [], dn = nn * (dk || 0.58);
    for (k = 0; k < 3; k++) {
      ctx.fillStyle = 'rgba(' + clothCol(WFLAG[k], dn / 0.58) + ',' + a.toFixed(3) + ')';
      ctx.beginPath();
      for (i = 0; i <= N; i++) { q = pt(i, k); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
      for (i = N; i >= 0; i--) { q = pt(i, k + 1); ctx.lineTo(q[0], q[1]); }
      ctx.closePath(); ctx.fill();
    }
    ctx.save(); clothPath(pt); ctx.clip();
    var y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9;
    for (i = 0; i < N; i++) {   // складки: где волна повёрнута к небу — светлый блик, где уходит вниз — тень (как у знамени: 0.16 / 0.2)
      var p0 = pt(i, 0), p1 = pt(i + 1, 0), p2 = pt(i + 1, 3), p3 = pt(i, 3), dx = Math.abs(p1[0] - p0[0]) || 1, fv = clamp(-(p1[1] - p0[1]) / dx * 1.8, -1, 1);
      sh.push(fv);
      ctx.fillStyle = fv > 0 ? 'rgba(255,250,235,' + (0.16 * fv * a).toFixed(3) + ')' : 'rgba(40,30,30,' + (-0.2 * fv * a).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath(); ctx.fill();
      y0 = Math.min(y0, p0[1], p1[1]); y1 = Math.max(y1, p2[1], p3[1]); x0 = Math.min(x0, p0[0], p1[0], p2[0], p3[0]); x1 = Math.max(x1, p0[0], p1[0], p2[0], p3[0]);
    }
    if (nn > 0.02) {
      var lg = ctx.createLinearGradient(0, y0, 0, y1);   // свет окрестности: сверху холодный от неба, снизу тёплый от города
      lg.addColorStop(0, 'rgba(120,150,230,' + (0.14 * nn * a).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,196,120,' + (0.12 * nn * a).toFixed(3) + ')');
      ctx.fillStyle = lg; ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
      if (lamp) {   // свет источника ложится на ткань пятном и гаснет с расстоянием
        var rg = ctx.createRadialGradient(lamp[0], lamp[1], 0, lamp[0], lamp[1], lamp[2]);
        var lk = root.CONFIG.SHOW_NIGHT === 'bright' ? 1.5 : 1;
        rg.addColorStop(0, 'rgba(255,232,190,' + (0.5 * lk * nn * a).toFixed(3) + ')'); rg.addColorStop(0.5, 'rgba(255,220,170,' + (0.2 * lk * nn * a).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(255,220,170,0)');
        ctx.fillStyle = rg; ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
      }
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(' + line + ',' + (0.25 * a).toFixed(3) + ')'; ctx.lineWidth = 0.6;   // складки — редкие штрихи поперёк ткани в ложбинах волны
    for (i = 1; i < N - 1; i++) if (sh[i] < sh[i - 1] && sh[i] <= sh[i + 1] && sh[i] < -0.15) { var a0 = pt(i, 0), a3 = pt(i, 3); ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.quadraticCurveTo((a0[0] + a3[0]) / 2 + 1, (a0[1] + a3[1]) / 2, a3[0], a3[1]); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(' + line + ',' + (0.85 * a).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.lineJoin = 'round';   // контур
    clothPath(pt); ctx.stroke();
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
    var BRN = root.CONFIG.SHOW_NIGHT === 'bright';   // e1.13: шоу ночью ярче и контрастнее (только у зданий с look.showNight; Кукурузник — как на сайте)
    var uv = heliPath(tt), p = P(uv[0], uv[1], 0), S = 5.4 * s0, col = nn > 0.5 ? (BRN ? '232,236,250' : '170,178,200') : ink();
    var a = (1 - kill) * clamp(tt / 0.8, 0, 1) * (1 - clamp((tt - 25) / 1, 0, 1));
    // трос отклонён назад набегающим потоком (~29°); порывы слегка качают — маятник с затуханием, от времени кадра
    var gust = 0.06 * Math.sin(tt * 0.35) + 0.025 * Math.sin(tt * 1.1 + 1), thT = -0.5 + gust;
    var h = par.hs || (par.hs = { th: thT, om: 0, last: now }), dt = clamp((now - h.last) / 1000, 0.001, 0.05); h.last = now;
    h.om += (7 * (thT - h.th) - 2.6 * h.om) * dt; h.th = clamp(h.th + h.om * dt, -1.1, 0.4);
    var tilt = 0.1 + 0.015 * Math.sin(tt * 1.3) + 0.2 * gust;   // идёт вперёд — нос чуть опущен
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // трос из-под брюха; к нему кромкой пришит флаг, внизу кромки — груз; полотнище тянется назад почти горизонтально
    var Lc = S * 2.4, fh = S * 3.1, fw = S * 15, N = 24, sx = Math.sin(h.th), cy = Math.cos(h.th);
    var ax0 = p[0] + S * 0.1, ay0 = p[1] + S * 0.55, A = [ax0 + sx * Lc, ay0 + cy * Lc], B = [A[0] + sx * fh, A[1] + cy * fh];
    var pt = function (i, j) {
      var f = i / N, hx = A[0] + (B[0] - A[0]) * j / 3, hy = A[1] + (B[1] - A[1]) * j / 3, ph = tt * 3.6 - i * 0.55;
      var wv = Math.sin(ph + j * 0.12) * S * (0.1 + 0.5 * f), fl = Math.sin(tt * 7.3 - i * 1.1 + j * 0.5) * S * 0.1 * f * f;   // волна от троса к краю + мелкая дрожь у свободного края
      return [hx - fw * f * (1 - 0.025 * Math.cos(ph)), hy + fw * f * 0.06 + S * 0.9 * f * f + wv + fl];
    };
    pt.N = N;
    if (nn > 0.3) {   // ночью прожектор из-под брюха: мягкий конус света в воздухе к флагу
      ctx.globalCompositeOperation = 'lighter'; var tip = pt(N * 0.45, 3), gl = ctx.createRadialGradient(ax0, ay0, 0, ax0, ay0, fw * 0.6);
      gl.addColorStop(0, 'rgba(255,240,210,' + ((BRN ? 0.34 : 0.16) * a * nn).toFixed(3) + ')'); gl.addColorStop(1, 'rgba(255,240,210,0)'); ctx.fillStyle = gl;
      ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(tip[0] - S * 2, tip[1] + S * 2); ctx.lineTo(B[0] + S * 2.5, B[1] + S * 2); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.75 * a).toFixed(3) + ')'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(ax0, ay0); ctx.lineTo(A[0], A[1]); ctx.stroke();
    clothFlag(pt, nn, a, nn > 0.3 ? [ax0, ay0 + S, fw * (BRN ? 0.9 : 0.6)] : null, BRN ? 0.3 : 0.82);   // e1.13 look.showNight 'bright': флаг ночью в луче — цвета флага, а не тёмная тряпка
    ctx.strokeStyle = 'rgba(' + col + ',' + (0.9 * a).toFixed(3) + ')'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();   // кромка на тросе
    ctx.fillStyle = 'rgba(' + col + ',' + (0.95 * a).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(B[0], B[1] + S * 0.25, S * 0.28, S * 0.36, -h.th, 0, 6.283); ctx.fill();   // груз
    ctx.translate(p[0], p[1]); ctx.rotate(tilt); heliBody(S, col, a, tt, nn);
    ctx.restore();
    if (tt * 1000 >= par.dur || kill >= 1) endParade();
  }
  // --- салют (e1.5): ракеты взлетают из-за города — яркая головка, огненный росчерк, искорки и ДЫМНЫЙ след (днём серые клубы держатся
  //     в воздухе, растут и сносятся ветром — взлёт виден и на светлом небе). Четыре вида залпов — шар, хризантема со шлейфами, золотая ива,
  //     мерцающий «треск» — в синих, золотых и белых тонах (красных шаров и колец больше нет). Искры тормозятся воздухом и оседают, у каждой
  //     короткий шлейф; ночью вспышка разрыва подсвечивает небо. Финал — флаг из самих залпов: три ряда по четыре ракеты рвутся
  //     вытянутыми по горизонтали залпами, искры ряда сливаются в полосу (красная, синяя, абрикосовая), полосы висят, мерцают и колышутся,
  //     потом искры осыпаются и гаснут ---
  var FWK = ['peony', 'chrys', 'willow', 'crackle'];
  var FWC = ['96,140,255', '255,198,90', '240,242,255', '130,206,255'];   // обычные залпы: синий, золото, белый, голубой
  var FFC = ['236,56,60', '70,110,240', '255,178,44'];
  var FFD = ['214,32,40', '36,74,200', '240,150,0'];                     // тот же флаг днём (насыщеннее — на светлом небе)                    // финальный флаг: красный, синий, абрикосовый
  var puffSpr = {};
  function puffS(col) {   // мягкий клуб дыма
    if (puffSpr[col]) return puffSpr[col];
    var s = document.createElement('canvas'); s.width = s.height = 48; var x = s.getContext('2d'), g = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, 'rgba(' + col + ',0.9)'); g.addColorStop(0.45, 'rgba(' + col + ',0.5)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, 48, 48); return (puffSpr[col] = s);
  }
  var dotSpr = {};
  function dotS(col) {   // дневная искра: насыщенный цвет в центре, мягкий край
    if (dotSpr[col]) return dotSpr[col];
    var s = document.createElement('canvas'); s.width = s.height = 32; var x = s.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(' + col + ',1)'); g.addColorStop(0.4, 'rgba(' + col + ',0.85)'); g.addColorStop(1, 'rgba(' + col + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); return (dotSpr[col] = s);
  }
  function fwPos(q, f, e) {   // положение искры через e с после разрыва (пиксели от центра)
    var d = f.V * q.s * (1 - Math.exp(-f.k * e)) / f.k;
    return [Math.cos(q.a) * d, Math.sin(q.a) * d + 0.5 * f.g * e * e];
  }
  function rocketAt(f, x, pH, pT, s0) {   // ракета через x с после старта: быстрый старт, торможение к вершине, лёгкое виляние
    var kk = clamp(x / f.rise, 0, 1), ke = 1 - (1 - kk) * (1 - kk);
    return [pH[0] + (pT[0] - pH[0]) * ke + Math.sin(kk * 14 + f.u * 50) * 1.2 * s0, pH[1] + (pT[1] - pH[1]) * ke];
  }
  function stepFireworks(now, w) {
    var t = (now - par.t0) / 1000, nn = wts().n, s0 = sf(), kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0, band = PB(par.fr);
    var night = nn > 0.5, bh = band[1] - band[0];
    if (!par.fw) {
      par.fw = [];
      var times = [0.2, 1.1, 1.9, 2.6, 2.8, 3.8, 4.6, 5.3, 5.5, 6.5, 7.3, 8.1, 8.3, 9.3, 10.1];
      times.forEach(function (tm, i) {
        var kind = FWK[(i * 3 + (i >> 2)) % 4], c = (i * 5 + 1) % 4, V = (kind === 'willow' ? 80 : 100) * s0 * (0.85 + Math.random() * 0.3);
        var f = { t: tm, rise: 1.3, u: 0.12 + Math.random() * 0.76, v: band[0] + bh * (0.12 + 0.45 * Math.random()), kind: kind, V: V,
          k: kind === 'willow' ? 2.6 : kind === 'chrys' ? 1.5 : 1.8, g: (kind === 'willow' ? 22 : 30) * s0,
          life: kind === 'willow' ? 4.6 : kind === 'chrys' ? 3.4 : kind === 'crackle' ? 2.8 : 3,
          col: kind === 'willow' ? '255,206,120' : kind === 'crackle' ? '255,244,220' : FWC[c], col2: FWC[(c + 1) % 4], sp: [] };
        var n = kind === 'willow' ? 44 : 58;
        for (var q = 0; q < n; q++) f.sp.push({ a: Math.random() * 6.283, s: 0.55 + 0.45 * Math.sqrt(Math.random()), p: Math.random() * 100, c2: kind === 'chrys' && q % 3 === 0 });
        par.fw.push(f);
      });
      // финал: 3 ряда × 4 ракеты; ряды снизу вверх с шагом 0,5 с; каждый залп раскрывается прямоугольником (полуширина ~0,13 ширины флага,
      // высота — полоса), соседние перекрываются — искры ряда сливаются в сплошную полосу. Все полосы висят до общего момента и осыпаются вместе
      par.flagT = 12.2;
      var fW = P(0.8, 0, 0)[0] - P(0.2, 0, 0)[0], sh = fW * 0.5 / 3, pxv = P(0.5, 1, 0)[1] - P(0.5, 0, 0)[1], tFall = par.flagT + 7.4;
      par.fx = { fW: fW, sh: sh };
      for (var r = 0; r < 3; r++) for (var c2 = 0; c2 < 4; c2++) {
        var fl = { t: par.flagT + (2 - r) * 0.5 + c2 * 0.09 + Math.random() * 0.05, rise: 1.5, u: 0.29 + c2 * 0.14 + (Math.random() - 0.5) * 0.01,
          v: band[0] + bh * 0.4 + (r - 1) * sh / pxv, flag: true, row: r, k: 2.4, g: 2.5 * s0, G: 34 * s0, col: FFC[r], colD: FFD[r], sp: [] };
        fl.fall = tFall - fl.t - fl.rise; fl.life = fl.fall + 2.6; fl.V = fW * 0.4;
        for (var q2 = 0; q2 < 72; q2++) fl.sp.push({ dx: (Math.random() * 2 - 1) * fW * 0.13, dy: (Math.random() * 2 - 1) * sh * 0.46, p: Math.random() * 100, j: Math.random() - 0.5 });
        par.fw.push(fl);
      }
    }
    var comp = night ? 'lighter' : 'source-over', horizon = band[1] + 0.25, flash = 0, fx0 = P(0.5, 0, 0)[0] - par.fx.fW / 2;
    ctx.save(); ctx.lineCap = 'round';
    par.fw.forEach(function (f) {
      var dt = t - f.t; if (dt < 0) return;
      var pT = P(f.u, f.v, 0), pH = P(f.u - 0.02, horizon, 0);
      if (dt < f.rise + 2.4) {   // дымный след: клубы стоят там, где прошла ракета, растут, сносятся ветром и тают за ~2,4 с
        ctx.globalCompositeOperation = 'source-over';
        for (var kq = Math.floor(Math.min(dt, f.rise) / 0.08); kq >= 0; kq--) {
          var ts = kq * 0.08, ag = dt - ts; if (ag > 2.4) break;
          var sp0 = rocketAt(f, ts, pH, pT, s0), ps = (2.2 + ag * 7) * s0 * (0.55 + 0.45 * ts / f.rise);
          ctx.globalAlpha = (1 - kill) * (night ? 0.08 : 0.3) * (1 - ag / 2.4) * clamp(ag / 0.15, 0, 1);
          ctx.drawImage(puffS(night ? '86,90,112' : '160,152,144'), sp0[0] + ag * 5 * s0 - ps / 2, sp0[1] - ag * 2.5 * s0 - ps / 2, ps, ps);
        }
      }
      if (dt < f.rise) {   // ракета: яркая головка, короткий огненный росчерк (размытие движения) и оседающие искорки
        var h0 = rocketAt(f, dt, pH, pT, s0), h1 = rocketAt(f, Math.max(0, dt - 0.07), pH, pT, s0);
        ctx.globalCompositeOperation = comp; ctx.globalAlpha = (1 - kill) * 0.9; ctx.strokeStyle = night ? 'rgba(255,214,160,1)' : 'rgba(226,122,44,1)'; ctx.lineWidth = 1.3 * s0;
        ctx.beginPath(); ctx.moveTo(h1[0], h1[1]); ctx.lineTo(h0[0], h0[1]); ctx.stroke();
        for (var s = 0; s < 7; s++) {
          var ts2 = dt - s * 0.05; if (ts2 <= 0) break;
          var hp = rocketAt(f, ts2, pH, pT, s0), gs = (s ? 3.2 - s * 0.35 : 5.5) * s0 * (night ? 1.4 : 1.1);
          ctx.globalAlpha = (1 - kill) * (1 - s / 7) * (night ? 1 : 0.85);
          ctx.drawImage(glowS(night ? '255,220,170' : '255,190,120'), hp[0] - gs / 2, hp[1] + s * s * 0.4 * s0 - gs / 2, gs, gs);
        }
        return;
      }
      var e = dt - f.rise; if (e > f.life) return;
      if (night && e < 0.4) {   // вспышка разрыва подсвечивает небо
        ctx.globalCompositeOperation = 'lighter'; var R0 = f.flag ? par.fx.fW * 0.25 : f.V * 1.5, g = ctx.createRadialGradient(pT[0], pT[1], 0, pT[0], pT[1], R0);
        g.addColorStop(0, 'rgba(' + f.col + ',' + ((f.flag ? 0.18 : 0.3) * (1 - e / 0.4) * (1 - kill)).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + f.col + ',0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(pT[0] - R0, pT[1] - R0, R0 * 2, R0 * 2);
      }
      if (f.flag) {   // искры полосы флага: разлетаются от центра к своей точке (тормозятся воздухом), висят, мерцают, колышутся волной, потом осыпаются
        if (night && e < 0.5) flash = Math.max(flash, 0.22 * (1 - e / 0.5));
        var fe = Math.max(0, e - f.fall), lk = fe / (f.life - f.fall), al = (1 - kill) * (1 - lk) * clamp(e / 0.08, 0, 1);
        var frac = 1 - Math.exp(-f.k * e), frac0 = 1 - Math.exp(-f.k * Math.max(0, e - 0.06)), ramp = clamp((e - 0.5) / 1.2, 0, 1), sh = par.fx.sh;
        ctx.globalCompositeOperation = comp; ctx.strokeStyle = 'rgba(' + f.col + ',1)'; ctx.lineWidth = 1.2 * s0;
        f.sp.forEach(function (q) {
          var gy = 0.5 * f.g * e * e + 0.5 * f.G * fe * fe, x = pT[0] + q.dx * frac + q.j * 12 * s0 * fe, xn = clamp((x - fx0) / par.fx.fW, 0, 1);
          var wave = sh * 0.2 * Math.sin(t * 2.1 - xn * 5.2) * (xn + 0.3) * ramp, y = pT[1] + q.dy * frac + gy + wave;
          if (e < 0.7) { ctx.globalAlpha = al * 0.5 * (1 - e / 0.7); ctx.beginPath(); ctx.moveTo(pT[0] + q.dx * frac0, pT[1] + q.dy * frac0 + gy + wave); ctx.lineTo(x, y); ctx.stroke(); }
          var tw = e < 1 ? 1 : 0.72 + 0.28 * Math.sin(e * 17 + q.p), hs = (night ? 6.5 : 4.6) * s0 * (1 - 0.35 * lk);
          ctx.globalAlpha = al * tw; ctx.drawImage(night ? glowS(f.col) : dotS(f.colD), x - hs / 2, y - hs / 2, hs, hs);   // днём — искры своего цвета без белого ядра (на светлом небе белое ядро выцветает)
        });
        return;
      }
      var lk2 = e / f.life, al2 = (1 - kill) * (1 - lk2 * lk2), tl = f.kind === 'willow' ? 0.9 : f.kind === 'chrys' ? 0.4 : 0.12;
      ctx.globalCompositeOperation = comp;
      f.sp.forEach(function (q) {
        var col = q.c2 ? f.col2 : f.col, a0 = fwPos(q, f, e), tw = 1;
        if (f.kind === 'crackle' && lk2 > 0.45) tw = Math.sin(e * 38 + q.p) > 0.1 ? 1 : 0.15;   // треск: искры мигают
        else if (lk2 > 0.7) tw = 0.75 + 0.25 * Math.sin(e * 24 + q.p);
        for (var seg = 0; seg < 3; seg++) {   // шлейф из трёх отрезков, к хвосту бледнее
          var e1 = Math.max(0, e - tl * seg / 3), e2 = Math.max(0, e - tl * (seg + 1) / 3); if (e1 <= 0) break;
          var b1 = seg ? fwPos(q, f, e1) : a0, b2 = fwPos(q, f, e2);
          ctx.globalAlpha = al2 * tw * (night ? 0.55 : 0.4) * (1 - seg / 3); ctx.strokeStyle = 'rgba(' + col + ',1)'; ctx.lineWidth = (1.4 - seg * 0.35) * s0;
          ctx.beginPath(); ctx.moveTo(pT[0] + b1[0], pT[1] + b1[1]); ctx.lineTo(pT[0] + b2[0], pT[1] + b2[1]); ctx.stroke();
        }
        var hs = (night ? 7 : 4.2) * s0 * (1 - lk2 * 0.5);
        ctx.globalAlpha = al2 * tw * (night ? 1 : 0.85); ctx.drawImage(glowS(col), pT[0] + a0[0] - hs / 2, pT[1] + a0[1] - hs / 2, hs, hs);
      });
    });
    if (flash > 0) {   // общее зарево неба в момент, когда рвутся залпы флага (свет от них, а не «само по себе»)
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash * 0.35 * (1 - kill); ctx.fillStyle = 'rgba(255,230,200,1)';
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.restore();
    if (t * 1000 > par.dur || kill >= 1) endParade();
  }
  // --- воздушные шары (e1.3): семь нарисованных шаров — полосы цветов флага, чернильный контур, клинья оболочки; поднимаются из-за города
  //     (видны только в небе), покачиваются на ветру, потом уходят вверх, уменьшаясь, и тают в облаках ---
  // ночью (dn → 1) дневная раскраска не видна: оболочка тёмная и сама не светится; светит горелка — вспышками (у каждого шара свой ритм,
  // пламя дрожит) — и два фонарика на корзине. Свет горелки подсвечивает оболочку изнутри-снизу: там проступают тёплые цвета полос
  // и гаснут к макушке. Днём (dn = 0) шар рисуется ровно как раньше
  function burner(tt, ph) { return sstep(0.5, 0.82, Math.sin(tt * 0.8 + ph * 3)) * (0.8 + 0.2 * Math.sin(tt * 21 + ph * 7)); }
  function balloon(x, y, r, bands, nn, a, sw, tt, ph) {
    var dn = clamp((nn - 0.3) / 0.5, 0, 1), line = nn > 0.5 ? '64,72,100' : ink(), L = function (k) { return 'rgba(' + line + ',' + (k * a * (1 - 0.35 * dn)).toFixed(3) + ')'; };
    var dark = function (col) { var c = col.split(','), d = 0.97 * dn; return Math.round(c[0] * (1 - d) + 12 * d) + ',' + Math.round(c[1] * (1 - d) + 16 * d) + ',' + Math.round(c[2] * (1 - d) + 32 * d); };
    var fire = dn > 0.01 ? burner(tt, ph || 0) : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(sw);
    function env() { ctx.beginPath(); ctx.moveTo(0, r * 1.2); ctx.bezierCurveTo(-r * 0.35, r * 0.98, -r * 1.02, r * 0.45, -r, -r * 0.1); ctx.bezierCurveTo(-r * 0.96, -r * 1.12, r * 0.96, -r * 1.12, r, -r * 0.1); ctx.bezierCurveTo(r * 1.02, r * 0.45, r * 0.35, r * 0.98, 0, r * 1.2); }
    ctx.save(); env(); ctx.clip();
    var yb = [-r * 1.1, -r * 0.28, r * 0.42, r * 1.25];
    for (var k = 0; k < 3; k++) { ctx.fillStyle = 'rgba(' + dark(bands[k]) + ',' + ((0.88 + 0.1 * dn) * a).toFixed(3) + ')'; ctx.fillRect(-r * 1.1, yb[k], r * 2.2, yb[k + 1] - yb[k] + 0.5); }
    var sg = ctx.createLinearGradient(-r, 0, r, 0); sg.addColorStop(0, 'rgba(0,0,0,' + 0.18 * a + ')'); sg.addColorStop(0.4, 'rgba(255,255,255,' + 0.14 * a * (1 - dn) + ')'); sg.addColorStop(1, 'rgba(0,0,0,' + 0.22 * a + ')');   // объём — мягко, акварелью
    ctx.fillStyle = sg; ctx.fillRect(-r * 1.1, -r * 1.2, r * 2.2, r * 2.5);
    if (dn > 0.01) {
      var lit = dn * a * (0.04 + 0.96 * fire);   // запальник светит чуть-чуть всегда, вспышка горелки — сильно
      for (k = 0; k < 3; k++) {   // свет изнутри-снизу: тёплые цвета полос проступают там, куда достаёт пламя
        var c = bands[k].split(','), wc = Math.round(c[0] * 0.65 + 255 * 0.35) + ',' + Math.round(c[1] * 0.65 + 180 * 0.35) + ',' + Math.round(c[2] * 0.65 + 100 * 0.35);
        var g = ctx.createRadialGradient(0, r * 1.25, 0, 0, r * 1.25, r * 2.05);   // к макушке свет гаснет — верх оболочки остаётся тёмным
        g.addColorStop(0, 'rgba(' + wc + ',' + (0.95 * lit).toFixed(3) + ')'); g.addColorStop(0.35, 'rgba(' + wc + ',' + (0.55 * lit).toFixed(3) + ')'); g.addColorStop(0.75, 'rgba(' + wc + ',' + (0.12 * lit).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + wc + ',0)');
        ctx.fillStyle = g; ctx.fillRect(-r * 1.1, yb[k], r * 2.2, yb[k + 1] - yb[k] + 0.5);
      }
      var lg = ctx.createRadialGradient(0, r * 1.6, 0, 0, r * 1.6, r * 0.9);   // фонарики на корзине чуть трогают низ оболочки
      lg.addColorStop(0, 'rgba(255,200,130,' + (0.25 * dn * a).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,200,130,0)');
      ctx.fillStyle = lg; ctx.fillRect(-r * 1.1, r * 0.5, r * 2.2, r * 0.8);
    }
    ctx.restore();
    ctx.strokeStyle = L(0.85); ctx.lineWidth = 0.9; env(); ctx.stroke();
    ctx.strokeStyle = L(0.35); ctx.lineWidth = 0.6;
    for (k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * r * 0.18, -r * 0.98 + Math.abs(k) * r * 0.06); ctx.quadraticCurveTo(k * r * 0.58, r * 0.1, k * r * 0.1, r * 1.16); ctx.stroke(); }
    ctx.strokeStyle = L(0.7); ctx.beginPath(); ctx.moveTo(-r * 0.16, r * 1.18); ctx.lineTo(-r * 0.13, r * 1.55); ctx.moveTo(r * 0.16, r * 1.18); ctx.lineTo(r * 0.13, r * 1.55); ctx.stroke();
    ctx.fillStyle = 'rgba(' + (nn > 0.5 ? '58,48,40' : '150,112,70') + ',' + a + ')'; ctx.fillRect(-r * 0.17, r * 1.55, r * 0.34, r * 0.26); ctx.strokeStyle = L(0.8); ctx.strokeRect(-r * 0.17, r * 1.55, r * 0.34, r * 0.26);
    if (dn < 0.99 && Math.sin(tt * 2.3 + x * 0.01) > 0.55) { ctx.globalAlpha = a * (nn > 0.5 ? 0.8 : 0.4) * (1 - dn); ctx.fillStyle = 'rgba(255,180,80,1)'; ctx.beginPath(); ctx.arc(0, r * 1.3, r * 0.16, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }   // вспышка горелки (день)
    if (dn > 0.01) {   // ночью: пламя горелки и два фонарика — единственные источники света
      ctx.globalCompositeOperation = 'lighter';
      var fs = r * (0.35 + 0.95 * fire); ctx.globalAlpha = a * dn * (0.35 + 0.65 * fire); ctx.drawImage(glowS('255,170,70'), -fs / 2, r * 1.3 - fs / 2, fs, fs);
      var ls = r * 0.42, fk = 0.9 + 0.1 * Math.sin(tt * 13 + (ph || 0) * 5); ctx.globalAlpha = a * dn * 0.85 * fk;
      ctx.drawImage(glowS('255,200,130'), -r * 0.2 - ls / 2, r * 1.6 - ls / 2, ls, ls); ctx.drawImage(glowS('255,200,130'), r * 0.2 - ls / 2, r * 1.6 - ls / 2, ls, ls);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  function stepBalloons(now, w) {
    var t = (now - par.t0) / 1000, nn = wts().n, s0 = sf(), kill = par.abort ? clamp((now - par.abort) / 700, 0, 1) : 0, band = PB(par.fr);
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
      if (a > 0.01) balloon(p[0], p[1], r, b.bands, nn, a, 0.06 * Math.sin(t * 0.9 + b.ph), t, b.ph);
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
    // ночью ткань остаётся ПЛОТНОЙ (альфа 1 — фон сквозь неё не просвечивает): её тёмный цвет получается смешиванием с ночным тоном, а свет
    // окрестности (небо сверху, фонари и окна снизу) ложится сверху мягким бликом — как на настоящей ткани, а не как на стекле
    var cloth = function (col) { var c = col.split(','), d = 0.58 * nn; return Math.round(c[0] * (1 - d) + 14 * d) + ',' + Math.round(c[1] * (1 - d) + 20 * d) + ',' + Math.round(c[2] * (1 - d) + 44 * d); };
    if (k > 0.002) {
      var N = 16, pt = function (i, j) {   // i — вниз по длине, j — поперёк (0..3 = слева направо)
        var yy = L[1] + len * i / N, sway = Math.sin(t * 1.3 - i * 0.35) * bw * 0.05 * Math.pow(i / N, 1.4) * k, rip = Math.sin(t * 2.6 + j * 1.7 + i * 0.9) * bw * 0.012 * (i / N);
        return [L[0] + bw * j / 3 + sway + rip, yy];
      };
      pt.N = N;
      ctx.save();
      for (var s2 = 0; s2 < 3; s2++) {   // полосы вертикально: для inkFlag i идёт по длине, полосы — по j
        ctx.fillStyle = 'rgba(' + cloth(WFLAG[s2]) + ',' + a.toFixed(3) + ')';   // ткань плотная (альфа 1, кроме ухода показа) — ни днём, ни ночью фон сквозь неё не виден
        ctx.beginPath();
        for (var i = 0; i <= N; i++) { var q = pt(i, s2); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
        for (i = N; i >= 0; i--) { q = pt(i, s2 + 1); ctx.lineTo(q[0], q[1]); }
        ctx.closePath(); ctx.fill();
      }
      ctx.save(); ctx.beginPath(); for (i = 0; i <= N; i++) { q = pt(i, 0); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } for (i = N; i >= 0; i--) { q = pt(i, 3); ctx.lineTo(q[0], q[1]); } ctx.closePath(); ctx.clip();
      var fg = ctx.createLinearGradient(L[0], 0, R[0], 0);   // складки ткани: мягкие тени и блики поперёк, медленно гуляют
      for (var fs = 0; fs <= 12; fs++) { var fv = Math.sin(fs * 1.9 + t * 0.7) * 0.5 + Math.sin(fs * 0.8 - t * 0.4) * 0.5; fg.addColorStop(fs / 12, fv > 0 ? 'rgba(255,250,235,' + (0.16 * fv * a).toFixed(3) + ')' : 'rgba(40,30,30,' + (-0.2 * fv * a).toFixed(3) + ')'); }
      ctx.fillStyle = fg; ctx.fillRect(L[0] - bw, L[1], bw * 3, len + 4);
      if (nn > 0.02) {   // ночной свет окрестности: сверху холодный от неба, снизу тёплый от фонарей и окон
        var lg = ctx.createLinearGradient(0, L[1], 0, L[1] + len);
        lg.addColorStop(0, 'rgba(120,150,230,' + (0.16 * nn * a).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,196,120,' + (0.26 * nn * a).toFixed(3) + ')');
        ctx.fillStyle = lg; ctx.fillRect(L[0] - bw, L[1], bw * 3, len + 4);
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(' + line + ',' + (0.25 * a) + ')'; ctx.lineWidth = 0.6;   // складки — редкие вертикальные штрихи
      for (var fz = 1; fz < 9; fz++) { var fu = fz / 9 * 3; ctx.beginPath(); for (i = 0; i <= N; i++) { var qq = pt(i, fu); if (i) ctx.lineTo(qq[0] + Math.sin(fz * 2.1 + i * 0.5) * 1.2, qq[1]); else ctx.moveTo(qq[0], qq[1]); } ctx.stroke(); }
      ctx.strokeStyle = 'rgba(' + line + ',' + (0.85 * a) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); for (i = 0; i <= N; i++) { q = pt(i, 0); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); } for (i = N; i >= 0; i--) { q = pt(i, 3); ctx.lineTo(q[0], q[1]); } ctx.closePath(); ctx.stroke();
      var e0 = pt(N, 0), e3 = pt(N, 3);
      if (down < 1 || up > 0) {   // рулон внизу, пока разворачивается: валик из тех же трёх полос с тенью и бликом; чем больше размотан, тем тоньше
        var rh = Math.max(3, bw * (0.16 - 0.1 * k)), rx0 = e0[0] - bw * 0.03, rw = e3[0] - e0[0] + bw * 0.06, ry = e0[1] - rh * 0.35;
        for (var rk = 0; rk < 3; rk++) { ctx.fillStyle = 'rgba(' + cloth(WFLAG[rk]) + ',' + a.toFixed(3) + ')'; ctx.fillRect(rx0 + rw * rk / 3, ry, rw / 3 + 0.5, rh); }
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
    if (SC(fr).skyBirds !== false) drawAmbientBirds(now, w);   // e1.8: кадр может выключить три одиночные птицы (свои стаи в ambient.flocks)
    if (SC(fr).closeUp) drawCloseUp(now, w, f, SC(fr).closeUp);
    if (SC(fr).fountains) drawFountains(now, w, f, SC(fr).fountains);
    var MV = SC(fr).motionVideo, mvOn = MV && (MV.on || /[?&]cine=1/.test(location.search));
    if (mvOn) drawMotionVideo(now, w, f, fr, MV);
    if (SC(fr).ambient) {   // синемаграф заменяет машины и прохожих (они уже в видео); сценки, стоящие люди и голуби остаются
      var AM = SC(fr).ambient;
      if (mvOn && MV.hideLife !== false) AM = MV._A || (MV._A = { flocks: AM.flocks, scenes: AM.scenes, standers: AM.standers, occluders: AM.occluders });
      drawAmbientLife(now, w, f, AM);
    }
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
