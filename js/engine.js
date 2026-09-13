/* engine.js — движок.
   Математика 3D, проекция на экран и вся отрисовка на canvas 2D.
   Главный принцип производительности: за кадр не создаём объектов,
   не трогаем DOM и сводим всё к десятку вызовов stroke()/fill().
   Тысяча коротких stroke() убьёт айфон, десяток длинных — нет. */

(function (global) {
  'use strict';

  var BUILD = '39';     // видно на самой странице — чтобы не гадать, свежая ли версия

  var PAPER = '#f5ecda';
  var INK   = '#2f2a25';

  /* Краска поверх рисунка. Каждый цвет — один слой, одна заливка.
     Цвета взяты с фотографий: тёплый травертин стен, серый базальт
     стилобата, зеленоватое остекление ресторана, трава вокруг.

     Наружные поверхности намеренно НЕПРОЗРАЧНЫЕ. Полупрозрачные
     стены давали рентген: сквозь башню просвечивала её же изнанка,
     и сверху казалось, что здание пустое. */
  var C_TERR     = 'rgb(124, 122, 116)';   // камень подпорных стен
  var C_TERRTOP  = 'rgb(150, 176, 114)';   // трава на террасе
  var C_PAVE     = 'rgb(138, 136, 132)';   // асфальт площади
  var C_CITY     = 'rgb(176, 174, 168)';   // соседние дома: вдали цвет светлее
  var C_CITY_TOP = 'rgb(192, 190, 180)';
  var C_CITY_BND = 'rgb(126, 136, 138)';
  var C_TREE_A   = 'rgb(146, 166, 108)';   // крона на свету
  var C_TREE_B   = 'rgb(126, 150, 100)';   // второй оттенок, чтобы не было ковра
  var C_TREE_DRK = 'rgb(96, 116, 78)';     // теневая половина кроны
  var C_TRUNK    = 'rgb(104, 90, 72)';
  var C_GROUND     = 'rgb(163, 189, 122)';  // трава вблизи
  var C_GROUND_FAR = 'rgb(198, 208, 166)';  // она же вдали, съеденная воздухом
  var C_PODIUM  = 'rgb(152, 152, 157)';   // базальт стилобата
  var C_HALL    = 'rgb(126, 128, 132)';   // стены нижнего корпуса, тёмный туф
  var C_SLAB    = 'rgb(198, 191, 171)';   // торец волнистой плиты
  var C_SLABTOP = 'rgb(215, 208, 187)';   // её верх, смотрит в небо
  var C_DECK    = 'rgb(186, 184, 177)';   // площадки террас
  var C_SHAFT   = 'rgb(242, 227, 188)';   // травертин ствола
  var C_NECK    = 'rgb(193, 184, 162)';
  var C_GLASS   = 'rgb(74, 104, 100)';    // остекление ресторана
  var C_PARAPET = 'rgb(198, 190, 170)';   // колпак
  var C_RAIL    = 'rgb(180, 172, 152)';   // парапеты по краю кровель
  /* Крыша смотрит прямо в небо и потому самая светлая. Раньше колпак,
     бортик и крыша были почти одного тона, и кольца между ними читались
     как обручи, прочерченные по стеклянной голове. */
  var C_ROOF    = 'rgb(231, 224, 203)';

  /* Изнанка тарелки смотрит вниз, и света от неба туда не попадает —
     зато снизу бьёт отражённый от кровли тёплый. Поэтому она не серая,
     а тёпло-коричневая: так пишут отражённый свет живописцы. */
  var C_FLARE   = 'rgb(146, 128, 104)';

  // Лоджия в три слоя: тень проёма, окно в глубине, белая плита балкона
  var C_CELL_LIT = 'rgba(112, 97, 73, 0.62)';    // проём на свету
  var C_CELL_DRK = 'rgba(64, 65, 77, 0.74)';     // проём в тени
  var C_WIN_LIT  = 'rgba(74, 100, 102, 0.80)';   // окно на свету
  var C_WIN_DRK  = 'rgba(46, 61, 74, 0.85)';     // окно в тени
  var C_BALC_LIT = 'rgba(250, 243, 222, 0.97)';  // балкон на свету
  var C_BALC_DRK = 'rgba(187, 189, 199, 0.97)';  // балкон в тени

  /* ГЛАВНОЕ ПРАВИЛО ЦВЕТА: свет тёплый — тень холодная.
     Солнце жёлтое, а теневую сторону освещает синее небо. Поэтому
     тени здесь не серые и не коричневые, а сине-фиолетовые. Раньше
     они были тёплые, и от этого картинка выглядела грязной. */
  var C_SIDE_LIT = 'rgba(255, 240, 196, 0.30)';  // солнечная сторона ствола
  var C_SIDE_DRK = 'rgba(88, 96, 124, 0.14)';    // теневая сторона ствола
  var C_SHADOW   = 'rgba(78, 86, 124, 1)';       // тень на земле

  /* ==================== ВРЕМЯ СУТОК ====================
     Все цвета выше — дневные. Это база. При движении ползунка они
     пересчитываются ОДИН раз (а не каждый кадр): ночь — это затемнение
     и уход в синеву, закат — тёплый сдвиг. Кадр от этого не дорожает
     ни на грамм: рисование получает уже готовые строки цвета. */

  var TOD = 0.26;     // 0 — раннее утро, 1 — глубокая ночь
  var NIGHT = 0;      // насколько темно (0..1)
  var DUSK = 0;       // насколько «золотой час» (0..1)

  function parseCol(str) {
    var m = str.match(/[\d.]+/g);
    return [+m[0], +m[1], +m[2], m.length > 3 ? +m[3] : 1];
  }

  // Опорные цвета ночи: к ним всё и сходится
  var NTINT = [46, 52, 74];   // ночь не чернильно-синяя, а сумеречная

  function tint(b) {
    var r = b[0], g = b[1], bl = b[2];
    // закат: света становится меньше, но он теплеет
    r += 17 * DUSK; g += 2 * DUSK; bl -= 13 * DUSK;
    // ночь: гасим и уводим в синеву
    var k = 1 - 0.46 * NIGHT, m = 0.50 * NIGHT;
    r = r * k + (NTINT[0] - r * k) * m;
    g = g * k + (NTINT[1] - g * k) * m;
    bl = bl * k + (NTINT[2] - bl * k) * m;
    r = r < 0 ? 0 : r > 255 ? 255 : r;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    bl = bl < 0 ? 0 : bl > 255 ? 255 : bl;
    return b[3] < 1
      ? 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ',' + b[3] + ')'
      : 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (bl | 0) + ')';
  }

  // Тёплый свет в окнах: к нему уходят стёкла, когда стемнело
  function lamp(b, amount) {
    var w = [236, 196, 118];
    var c = parseCol(tint(b)), a = amount;
    return 'rgba(' + ((c[0] + (w[0] - c[0]) * a) | 0) + ',' +
                     ((c[1] + (w[1] - c[1]) * a) | 0) + ',' +
                     ((c[2] + (w[2] - c[2]) * a) | 0) + ',' +
                     (b[3] < 1 ? b[3] : 1) + ')';
  }

  var B = {};
  function grab(name, val) { B[name] = parseCol(val); }

  grab('PAVE', C_PAVE);
  grab('TERR', C_TERR);        grab('TERRTOP', C_TERRTOP);
  grab('CITY', C_CITY);        grab('CITY_TOP', C_CITY_TOP);
  grab('CITY_BND', C_CITY_BND);
  grab('TREE_A', C_TREE_A);    grab('TREE_B', C_TREE_B);
  grab('TREE_DRK', C_TREE_DRK); grab('TRUNK', C_TRUNK);
  grab('GROUND', C_GROUND);    grab('GROUND_FAR', C_GROUND_FAR);
  grab('PODIUM', C_PODIUM);    grab('HALL', C_HALL);
  grab('SLAB', C_SLAB);        grab('SLABTOP', C_SLABTOP);
  grab('DECK', C_DECK);        grab('SHAFT', C_SHAFT);
  grab('NECK', C_NECK);        grab('GLASS', C_GLASS);
  grab('PARAPET', C_PARAPET);  grab('RAIL', C_RAIL);
  grab('ROOF', C_ROOF);        grab('FLARE', C_FLARE);
  grab('CELL_LIT', C_CELL_LIT); grab('CELL_DRK', C_CELL_DRK);
  grab('WIN_LIT', C_WIN_LIT);  grab('WIN_DRK', C_WIN_DRK);
  grab('BALC_LIT', C_BALC_LIT); grab('BALC_DRK', C_BALC_DRK);
  grab('SIDE_LIT', C_SIDE_LIT); grab('SIDE_DRK', C_SIDE_DRK);
  grab('SHADOW', C_SHADOW);    grab('INK', 'rgb(47,42,37)');

  var C_LAMP = 'rgba(236, 196, 118, 0.95)';

  function applyTime(t) {
    TOD = t;
    NIGHT = t < 0.46 ? 0 : Math.min(1, (t - 0.46) / 0.40);
    var d = 1 - Math.abs(t - 0.50) / 0.22;
    DUSK = d > 0 ? d : 0;

    C_PAVE = tint(B.PAVE);
    C_TERR = tint(B.TERR);         C_TERRTOP = tint(B.TERRTOP);
    C_CITY = tint(B.CITY);         C_CITY_TOP = tint(B.CITY_TOP);
    C_CITY_BND = lamp(B.CITY_BND, NIGHT * 0.85);
    C_TREE_A = tint(B.TREE_A);     C_TREE_B = tint(B.TREE_B);
    C_TREE_DRK = tint(B.TREE_DRK); C_TRUNK = tint(B.TRUNK);
    C_GROUND = tint(B.GROUND);     C_GROUND_FAR = tint(B.GROUND_FAR);
    C_PODIUM = tint(B.PODIUM);     C_HALL = tint(B.HALL);
    C_SLAB = tint(B.SLAB);         C_SLABTOP = tint(B.SLABTOP);
    C_DECK = tint(B.DECK);         C_SHAFT = tint(B.SHAFT);
    C_NECK = tint(B.NECK);         C_PARAPET = tint(B.PARAPET);
    C_RAIL = tint(B.RAIL);         C_ROOF = tint(B.ROOF);
    C_FLARE = tint(B.FLARE);
    C_GLASS = lamp(B.GLASS, NIGHT * 0.9);          // ресторан вечером горит
    C_CELL_LIT = tint(B.CELL_LIT); C_CELL_DRK = tint(B.CELL_DRK);
    C_WIN_LIT = tint(B.WIN_LIT);   C_WIN_DRK = tint(B.WIN_DRK);
    C_BALC_LIT = tint(B.BALC_LIT); C_BALC_DRK = tint(B.BALC_DRK);
    C_SIDE_LIT = tint(B.SIDE_LIT); C_SIDE_DRK = tint(B.SIDE_DRK);
    C_SHADOW = tint(B.SHADOW);
    INK = tint(B.INK);
    // ночью тушь светлеет, иначе рисунок тонет в темноте
    if (NIGHT > 0) {
      var ic = parseCol(INK), a = 0.62 * NIGHT;
      INK = 'rgb(' + ((ic[0] + (168 - ic[0]) * a) | 0) + ',' +
                     ((ic[1] + (178 - ic[1]) * a) | 0) + ',' +
                     ((ic[2] + (202 - ic[2]) * a) | 0) + ')';
    }

    /* Солнце ходит по небу вместе с ползунком: к вечеру оно ниже и
       сбоку, и тени удлиняются сами. Это и делает картинку живой
       сильнее любой анимации. */
    var ang = Math.PI * (0.14 + t * 0.74);
    var ly = Math.sin(ang); if (ly < 0.20) ly = 0.20;
    var lx = Math.cos(ang) * 0.92, lz = 0.52;
    var ln = Math.sqrt(lx * lx + ly * ly + lz * lz);
    LX = lx / ln; LY = ly / ln; LZ = lz / ln;
  }

  var CAM_DIST = 14;    // камера стоит на этом расстоянии
  var FOCAL    = 10;    // «фокусное»: больше — меньше перспективы
  /* ПЛОТНОСТЬ ПИКСЕЛЕЙ.

     Раньше стояла жёсткая двойка «выше нет смысла». Смысл есть: у
     айфона плотность тройная, и при двойке тонкая линия туши ложится
     между пикселями — получается лесенка и грязь. Весь рисунок held на
     линиях, поэтому для него плотность важнее, чем для заливок.

     Берём тройку, но с подстраховкой: если устройство не тянет,
     движок сам опускается до двойки (см. setLod). */
  var MAX_DPR  = 3;

  // Свет. Задаётся временем суток (см. applyTime выше).
  var LX = -0.46, LY = 0.58, LZ = 0.67;

  // Дрожание линий должно быть у каждой линии своё, но ПОСТОЯННОЕ:
  // если пересчитывать его каждый кадр, рисунок будет мерцать.
  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function Engine(sceneCanvas, paperCanvas, model) {
    this.canvas = sceneCanvas;
    this.ctx = sceneCanvas.getContext('2d', { alpha: true });
    this.paper = paperCanvas;
    this.paperCtx = paperCanvas.getContext('2d', { alpha: false });
    this.model = model;

    var n = model.positions.length / 3;
    this.px = new Float32Array(n);   // экранные координаты
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);   // глубина: >0 — ближняя половина

    // Круг для теней, считается на лету
    this.cN = 18;
    this.cx = new Float32Array(this.cN);
    this.cy = new Float32Array(this.cN);

    // Постоянное дрожание: по 2 прохода на линию, у каждого свои сдвиги
    var lineCount = model.styles.length;
    var rnd = seeded(20260912);
    this.jit = new Float32Array(lineCount * 12);
    for (var i = 0; i < lineCount; i++) {
      var o = i * 12;
      for (var k = 0; k < 8; k++) this.jit[o + k] = (rnd() - 0.5) * 1.0;  // сдвиг концов
      this.jit[o + 8]  = (rnd() - 0.5) * 1.3;   // изгиб линии, проход 1
      this.jit[o + 9]  = (rnd() - 0.5) * 1.3;   // изгиб, проход 2
      this.jit[o + 10] = rnd() * 0.7;           // перелёт за угол, начало
      this.jit[o + 11] = rnd() * 0.7;           // перелёт, конец
    }

    /* Направление «наружу» для каждой линии приходит из модели: у
       круглых частей это направление от оси, у прямых стен нижнего
       корпуса — нормаль стены. По нему решаем, ближняя линия или
       дальняя. Сравнение глубины середины линии тут врёт. */
    this.ldir = model.ldir;

    // Отдельное дрожание для рёбер контура
    var outCount = model.outline.length / 4;
    this.outJit = new Float32Array(outCount);
    for (var i = 0; i < outCount; i++) this.outJit[i] = (rnd() - 0.5) * 1.2;

    this.w = 0; this.h = 0; this.dpr = 1;
    this.S = 1; this.ox = 0; this.oy = 0;
    this.rot = { cy: 1, sy: 0, cp: 1, sp: 0 };
    this.resize();
  }

  Engine.prototype.resize = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, this.maxDpr || MAX_DPR);
    var w = global.innerWidth;
    var h = global.innerHeight;
    this.w = w; this.h = h; this.dpr = dpr;

    var c1 = this.canvas, c2 = this.paper;
    c1.width = c2.width = Math.round(w * dpr);
    c1.height = c2.height = Math.round(h * dpr);

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = INK;

    this.paperCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawPaper();

    /* Облака и звёзды задаются один раз: если сыпать их заново каждый
       кадр, небо будет кипеть. */
    if (!this.clouds) {
      var rc2 = seeded(91);
      this.clouds = [];
      for (var ci = 0; ci < 7; ci++) {
        this.clouds.push({
          x: rc2() * 1200, y: 0.04 + rc2() * 0.26,
          s: 0.045 + rc2() * 0.045,
          v: 3 + rc2() * 8,                 // пикселей в секунду
          ph: rc2() * 6.28
        });
      }
      var rb = seeded(404);
      this.birds = [];
      for (var bi2 = 0; bi2 < 3; bi2++) {
        this.birds.push({ x: rb() * 900, y: 0.10 + rb() * 0.18,
                          s: 0.008 + rb() * 0.005, v: 16 + rb() * 14, p: rb() * 6.28 });
      }

      var rs = seeded(555);
      this.stars = [];
      for (var si = 0; si < 70; si++) this.stars.push(rs(), rs() * 0.92, rs() * 6.28);
    }
  };

  /* Текстура бумаги. Рисуется один раз на ресайз, лежит отдельным слоем
     под сценой. Каждый кадр её не трогаем — это и есть экономия. */
  // Цвет стопа неба: между дневным и ночным, по текущему NIGHT
  function st(day, nite, a0, a1) {
    var r = day[0] + (nite[0] - day[0]) * NIGHT;
    var g = day[1] + (nite[1] - day[1]) * NIGHT;
    var b = day[2] + (nite[2] - day[2]) * NIGHT;
    return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' +
           (a0 + (a1 - a0) * NIGHT).toFixed(3) + ')';
  }

  Engine.prototype.drawPaper = function () {
    var c = this.paperCtx, w = this.w, h = this.h;
    var TAU = Math.PI * 2;

    c.fillStyle = PAPER;
    c.fillRect(0, 0, w, h);

    /* Небо и облака отсюда УБРАНЫ: они теперь рисуются каждый кадр на
       верхнем холсте, потому что должны меняться со временем суток и
       двигаться. Здесь остаётся только бумага, зерно и виньетка —
       то, что не меняется никогда.

       Небо: акварельная заливка сверху, к горизонту сходит на нет.
       Оно зависит от времени суток, но НЕ от кадра, поэтому живёт
       здесь: ползунок двигают редко, а кадров шестьдесят в секунду.
    // Всё это рисуется один раз на ресайз и кадру не стоит ничего.
    /* Небо не однотонное: сверху густая синь, а у горизонта воздух
       теплеет и светлеет. Эта тёплая полоса внизу — то, из-за чего
       небо перестаёт выглядеть заливкой и начинает выглядеть небом. */
    /* Одна заливка на весь экран вместо двух. Небо и ночное затемнение
       земли сведены в общий градиент: ниже горизонта его дневные стопы
       полностью прозрачны, поэтому днём там не рисуется ничего, а ночью
       ложится синий тон. Заливка во весь экран — самая дорогая операция
       на телефоне, и делать её дважды было расточительством. */
    var horizon = h * 0.72;
    var g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, st([96, 142, 186], [10, 14, 40], 0.60, 0.94));
    g.addColorStop(0.30, st([142, 180, 206], [20, 26, 58], 0.34, 0.86));
    g.addColorStop(0.55, st([214, 200, 172], [46, 40, 70], 0.20, 0.66));
    g.addColorStop(0.72, st([226, 206, 168], [40, 36, 66], 0.00, 0.62));
    g.addColorStop(1.00, st([226, 206, 168], [16, 20, 44], 0.00, 0.78));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);

    // закатная полоса у горизонта
    if (DUSK > 0.01) {
      var gd = c.createLinearGradient(0, horizon * 0.55, 0, horizon);
      gd.addColorStop(0, 'rgba(236, 150, 88, 0)');
      gd.addColorStop(1, 'rgba(240, 146, 84, ' + (0.34 * DUSK).toFixed(3) + ')');
      c.fillStyle = gd;
      c.fillRect(0, horizon * 0.55, w, horizon * 0.45);
    }


    // Зерно бумаги — поверх неба, чтобы всё лежало на одном листе
    var rnd = seeded(7);
    var dots = Math.min(4200, Math.round(w * h / 260));
    c.fillStyle = 'rgba(120, 100, 74, 0.055)';
    for (var i = 0; i < dots; i++) {
      c.fillRect(rnd() * w, rnd() * h, rnd() * 1.6 + 0.4, rnd() * 1.6 + 0.4);
    }

    var g = c.createRadialGradient(w * 0.5, h * 0.44, Math.min(w, h) * 0.2,
                                   w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(92, 72, 46, 0.13)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };

  // Один комок облака. moveTo перед дугой — чтобы овалы не соединялись
  // между собой прямой линией.
  function puff(c, x, y, s, kx, ky, TAU) {
    c.moveTo(x + s * kx, y);
    c.ellipse(x, y, s * kx, s * ky, 0, 0, TAU);
  }

  /* ================== один кадр ================== */

  Engine.prototype.render = function (state) {
    var ctx = this.ctx, m = this.model;
    ctx.clearRect(0, 0, this.w, this.h);
    this.time = state.time || 0;
    this._yaw = state.yaw; this._pitch = state.pitch;
    /* Угол вращения кафе. Оборот примерно за семьдесят секунд: в жизни
       зал поворачивался куда медленнее, но на экране движение должно
       читаться за те несколько секунд, что человек смотрит. */
    this.spin = (state.time || 0) * 0.055;   // оборот примерно за две минуты
    this.drawSky();

    var r = this.rot;
    r.cy = Math.cos(state.yaw);  r.sy = Math.sin(state.yaw);
    r.cp = Math.cos(state.pitch); r.sp = Math.sin(state.pitch);

    // Масштаб подбираем и по ширине, и по высоте экрана: на узком
    // телефоне здание не должно упираться в края.
    /* Масштаб считается под всю композицию, а не под одну башню:
       сбоку появился корпус, и кадр стал шире. */
    this.S = Math.min(this.w * 0.255, this.h * 0.125) * state.zoom;
    this.ox = this.w * 0.5;
    this.oy = this.h * 0.50;

    this.project();
    this.classify();

    /* Сцена кладётся ярусами, снизу вверх: земля — стилобат — ствол —
       тарелка. Каждый ярус сначала заливается, сразу за ним идут его
       линии, и только потом сверху ложится следующий.

       Так линия физически не может вылезти поверх того, что её
       закрывает. Раньше все линии рисовались одним махом в самом
       конце, и сквозь тарелку проступали кольца ствола, а край земли
       чертил полосу поперёк башни. */

    /* ПОРЯДОК КАДРА.

       Земля и склон — это поверхность, на которой всё стоит, поэтому
       они идут первыми, ДО всех предметов. Раньше террасы рисовались
       после дальних деревьев и закрашивали их — дерево на склоне
       просто исчезало.

       Дальше очередь по глубине. Башня со стилобатом стоит в центре
       и делит её надвое: сначала всё, что дальше неё, потом она сама,
       потом всё, что ближе. Фонари, скамейки и флаги стоят вплотную к
       стилобату, поэтому идут вместе с ним. */

    // 1. поверхность: земля и склон — то, на чём всё стоит
    this.drawGround();
    this.drawShadows(0);
    this.fillShells('terrTop', C_TERRTOP);
    this.fillShells('terr',    C_TERR);
    this.fillShells('pave',    C_PAVE);
    this.strokeBody(2);
    this.drawOutline(2);

    this.drawCityGlow();   // огни города внизу — лежат на земле, до предметов

    // 2. все предметы — строго по глубине, от дальнего к ближнему
    this.buildQueue();
    this.drawQueue();

    this.drawSign();                              // название на крыле
    this.drawSign(m.cafeSign, false);             // табличка кафе на бортике
    this.drawAir();       // воздух поверх массы — он касается и линий
    ctx.globalAlpha = 1;
  };

  /* Соседние дома. Как и роща: сортируются по глубине и рисуются по
     одному от дальнего к ближнему, дальние до главного здания,
     ближние после. Каждый дом — свой слой линий (part 20 + номер). */
  /* Один соседний дом. */
  Engine.prototype.drawOneCity = function (bi) {
    this.fillShells('city',     C_CITY,     bi);
    this.fillShells('cityBand', C_CITY_BND, bi);
    this.fillShells('cityTop',  C_CITY_TOP, bi);
    this.fillShells('cityPara', C_CITY,     bi);
    this.strokeBody(this.model.cityParts[bi]);
  };

  /* Деревья. Два захода: дальние ложатся до здания, ближние — после.
     Всё сводится к пяти заливкам на всю рощу, а не к пяти на дерево. */
  /* Одно дерево: ствол, крона, теневая долька, обводка. */
  Engine.prototype.drawOneTree = function (f) {
    var ctx = this.ctx, pz = this.pz, px = this.px, py = this.py;
    var b = f.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * this.S;
    var x = px[b], y = py[b];

    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + f.lean * k * 0.5, y - f.h * k * 0.62);
    ctx.strokeStyle = C_TRUNK;
    ctx.lineWidth = Math.max(1, k * 0.020);
    ctx.stroke();

    ctx.beginPath(); this.crownPath(f, 1);
    ctx.fillStyle = f.tone ? C_TREE_B : C_TREE_A;
    ctx.fill();

    ctx.beginPath(); this.crownPath(f, 2);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = C_TREE_DRK;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath(); this.crownPath(f, 1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, k * 0.013);
    ctx.globalAlpha = 0.70;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* Контур кроны: десятиугольник с заранее заданной неровностью.
     mode 2 — теневая долька: та же форма, сдвинутая от света. */
  Engine.prototype.crownPath = function (f, mode) {
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var b = f.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * this.S;
    /* Лёгкое качание. Амплитуда крошечная — полпроцента ширины кроны:
       больше выглядит как шторм, а не как ветер. */
    var ph2 = f.wob[0] * 12.7 + f.wob[3] * 5.1;
    var sway = Math.sin(this.time * 0.62 + ph2) * k * 0.030
             + Math.sin(this.time * 1.35 + ph2 * 1.7) * k * 0.012;
    var cx = px[b] + f.lean * k + sway;
    var cy = py[b] - f.h * k * 0.74;
    var breath = 1 + Math.sin(this.time * 0.5 + f.wob[1] * 8.1) * 0.022;
    var rx = f.w * k * breath, ry = f.h * k * 0.40 * (2 - breath);
    if (mode === 2) { cx += rx * 0.30; cy += ry * 0.18; rx *= 0.80; ry *= 0.80; }

    /* Ведём кривую через середины отрезков: каждая вершина становится
       изгибом, и крона перестаёт быть десятиугольником. */
    var X = this.crX || (this.crX = new Float32Array(10));
    var Y = this.crY || (this.crY = new Float32Array(10));
    for (var i = 0; i < 10; i++) {
      var a = i / 10 * Math.PI * 2;
      var w = f.wob[i];
      X[i] = cx + Math.cos(a) * rx * w;
      Y[i] = cy + Math.sin(a) * ry * w;
    }
    ctx.moveTo((X[9] + X[0]) * 0.5, (Y[9] + Y[0]) * 0.5);
    for (var i = 0; i < 10; i++) {
      var j = (i + 1) % 10;
      ctx.quadraticCurveTo(X[i], Y[i], (X[i] + X[j]) * 0.5, (Y[i] + Y[j]) * 0.5);
    }
    ctx.closePath();
  };

  /* Нижний корпус. Рисуется целиком за один заход: он отдельный объём,
     а не ярус башни, и его очередь зависит от того, ближе он к нам
     или дальше. */
  Engine.prototype.drawHall = function () {
    this.fillShells('hall',    C_HALL);
    this.fillShells('hallGlass', C_GLASS);
    this.fillShells('slab',    C_SLAB);
    this.fillShells('slabTop', C_SLABTOP);
    this.strokeBody(4);
    this.drawOutline(4);
  };

  /* Длинное низкое крыло с аркадой. Своя очередь, как и у корпуса:
     оно стоит сбоку от башни, а не над ней. */
  Engine.prototype.drawWing = function () {
    this.fillShells('wing',     C_HALL);
    this.drawCells(5);
    this.fillShells('wingGlass', C_GLASS);
    this.fillShells('wingCorn', C_SLAB);
    this.fillShells('wingSlab', C_SLAB);
    this.fillShells('wingTop',  C_DECK);
    this.fillShells('wingRail', C_SLAB);
    this.strokeBody(5);
  };

  // Ближние линии одного этажа: два прохода — отсюда «двойная обводка»
  Engine.prototype.strokeBody = function (part) {
    var widths = [0.85, 1.35, 2.05];   // на плотном экране тонкая линия истончалась в волос
    for (var s = 0; s < 3; s++) {
      this.strokeGroup(s, 0, widths[s], 0.85, part);
      this.strokeGroup(s, 1, widths[s] * 0.8, 0.38, part);
    }
  };

  /* Все точки — в экранные координаты за один проход */
  Engine.prototype.project = function () {
    var m = this.model, r = this.rot;
    var pos = m.positions, px = this.px, py = this.py, pz = this.pz;
    var cy = r.cy, sy = r.sy, cp = r.cp, sp = r.sp;
    var S = this.S, ox = this.ox, oy = this.oy;
    var n = px.length;

    var sr = m.spinRange, s0 = sr ? sr[0] : -1, s1 = sr ? sr[1] : -1;
    var cs = Math.cos(this.spin || 0), ss = Math.sin(this.spin || 0);

    for (var i = 0; i < n; i++) {
      var j = i * 3;
      var x = pos[j], y = pos[j + 1], z = pos[j + 2];

      // вертушка кафе: свой поворот вокруг оси, до камеры
      if (i >= s0 && i < s1) {
        var xr = x * cs - z * ss;
        z = x * ss + z * cs;
        x = xr;
      }

      var x1 = x * cy + z * sy;
      var z1 = -x * sy + z * cy;
      var y2 = y * cp - z1 * sp;
      var z2 = y * sp + z1 * cp;

      var d = CAM_DIST - z2;
      if (d < 1) d = 1;
      var k = FOCAL / d * S;

      px[i] = ox + x1 * k;
      py[i] = oy - y2 * k;
      pz[i] = z2;
    }

    // Верх и низ здания на экране — по ним строится градиент воздуха.
    // Землю в расчёт не берём, она уходит далеко за здание.
    var top = 1e9, bot = -1e9, g0 = m.groundCount;
    for (var i = g0; i < n; i++) {
      if (py[i] < top) top = py[i];
      if (py[i] > bot) bot = py[i];
    }
    this.topPy = top;
    this.botPy = bot;

    // То же для земли — по ней пойдёт воздушная перспектива
    var gt = 1e9, gb = -1e9;
    for (var i = 0; i < g0; i++) {
      if (py[i] < gt) gt = py[i];
      if (py[i] > gb) gb = py[i];
    }
    this.groundTopPy = gt;
    this.groundBotPy = gb;
  };

  /* Воздух: один вертикальный градиент на всю массу здания.
     Сверху лёгкая холодная дымка — там больше неба; книзу мягкое
     затемнение, потому что к земле света доходит меньше и в стык
     с землёй он почти не попадает. Это самый дешёвый приём объёма:
     один путь и одна заливка на всё здание. */
  /* Воздух поверх массы.

     Раньше дымка заливалась ПО СИЛУЭТАМ: путь собирался из всех видимых
     граней сцены — под тысячу четырёхугольников — и заливался одним
     градиентом. Замер показал, что на это уходило 3.1 мс из 5.7, то есть
     больше половины кадра. Всё остальное вместе стоило меньше.

     Разницы на глаз почти нет: дымка полупрозрачная, и лечь она может
     просто на весь экран. Небо и земля от этого тоже чуть холодеют
     книзу — что для воздушной перспективы даже честнее. Одна заливка
     вместо тысячи фигур. */
  Engine.prototype.drawAir = function () {
    var ctx = this.ctx, h = this.h;
    if (h < 2) return;

    /* Заливка идёт на ВЕСЬ кадр и начинается с полной прозрачности.
       Раньше прямоугольник дымки начинался с верхней точки сцены и имел
       там ненулевую прозрачность — его кромка читалась чёткой
       горизонтальной полосой через всё небо: выше линии темнее, ниже
       светлее. Градиент, у которого на макушке ноль, шва не даёт. */
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, 'rgba(148, 178, 210, 0.00)');
    g.addColorStop(0.30, 'rgba(148, 178, 210, 0.045)');
    g.addColorStop(0.62, 'rgba(120, 150, 190, 0.02)');
    g.addColorStop(0.82, 'rgba(56, 66, 104, 0.05)');
    g.addColorStop(1.00, 'rgba(46, 55, 92, 0.11)');

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, h);
  };

  /* ОЧЕРЕДЬ ПО ГЛУБИНЕ.

     Движок рисует «маляром»: кто позже, тот поверх. Раньше деревья,
     корпуса и соседние дома лежали в ФИКСИРОВАННЫХ слоях — сначала все
     дальние деревья, потом корпус, потом ближние деревья. Из-за этого
     дерево, стоящее перед корпусом, но попавшее в «дальнюю» группу,
     закрашивалось этим корпусом и пропадало. Ровно это и выглядело как
     «объекты исчезают под разными углами».

     Теперь все отдельно стоящие предметы складываются в один список с
     глубиной своего центра, сортируются от дальнего к ближнему и
     рисуются в этом порядке. Башня стоит в центре сцены и делит список
     надвое: что дальше неё — до, что ближе — после. */
  /* ДЕТАЛИЗАЦИЯ ПО СИЛАМ УСТРОЙСТВА.

     Считать сцену дешевле, чем её рисовать: индексы граней и линий дали
     всего двенадцать процентов, потому что время уходит не на перебор,
     а на сами заливки. Значит, единственный честный рычаг — рисовать
     меньше предметов.

     Движок сам следит за кадрами: просело — прореживает рощу и дальние
     дома, отпустило — возвращает. Здание, стилобат и корпуса не трогаем
     никогда: это сам предмет, а не окружение. */
  Engine.prototype.setLod = function (fps) {
    /* Порог намеренно низкий. После того как дымка перестала заливаться
       по силуэтам, кадр стоит 1.4 мс вместо 5.7 — прореживать больше
       нечего. Вырезанная роща выглядит хуже, чем сорок кадров вместо
       шестидесяти, поэтому страховка включается только на совсем
       слабом устройстве. */
    /* Сначала снижаем плотность пикселей: это дешевле всего и почти не
       видно. Прореживание рощи — только если и это не помогло. */
    if (fps < 40 && (this.maxDpr || MAX_DPR) > 2) {
      this.maxDpr = 2;
      this.resize();
      return;
    }
    var want = this.lod === undefined ? 1 : this.lod;
    if (fps < 22) want = 0.6;
    else if (fps > 34) want = 1;
    this.lod = want;
  };

  Engine.prototype.buildQueue = function () {
    var m = this.model, r = this.rot, pz = this.pz;
    var lod = this.lod === undefined ? 1 : this.lod;
    var Q = this.queue || (this.queue = []);
    Q.length = 0;

    function depth(x, y, z) {
      var z1 = -x * r.sy + z * r.cy;
      return y * r.sp + z1 * r.cp;
    }
    function add(z, t, i) { Q.push({ z: z, t: t, i: i }); }

    /* Стилобат и башня стоят в центре сцены, их глубина нулевая.
       Башня всегда после стилобата — она на нём стоит. */
    add(0, 4);          // стилобат с лестницами и порталом
    add(0.0001, 5);     // ствол и тарелка

    var hc = m.hallCenter; add(depth(hc[0], hc[1], hc[2]), 0);
    var wc = m.wingCenter; add(depth(wc[0], wc[1], wc[2]), 1);

    var cc = m.cityCenters;
    var nCity = cc ? Math.max(4, Math.round(m.city.length * lod)) : 0;
    for (var i = 0; i < nCity; i++) {
      add(depth(cc[i * 3], cc[i * 3 + 1], cc[i * 3 + 2]), 2, i);
    }
    var T = m.trees;
    var nTree = T ? Math.max(10, Math.round(T.length * lod)) : 0;
    for (var j = 0; j < nTree; j++) add(pz[T[j].p], 3, j);

    var LP = m.lamps;
    var nLamp = LP ? (lod < 0.7 ? Math.round(LP.length * 0.6) : LP.length) : 0;
    for (var l = 0; l < nLamp; l++) add(pz[LP[l].b], 6, l);
    var BN = m.benches;
    if (BN) for (var n = 0; n < BN.length; n++) add(pz[BN[n].a], 7, n);
    var FL = m.flags;
    if (FL) for (var f = 0; f < FL.length; f++) add(pz[FL[f].b], 8, f);

    Q.sort(function (a, b) { return a.z - b.z; });
  };

  /* Рисует ВСЮ очередь от дальнего к ближнему.

     Чтобы добавить новый предмет, достаточно двух строк: положить его
     в buildQueue со своей глубиной и добавить сюда ветку. Никаких
     «слоёв» больше нет — порядок считается каждый кадр. */
  Engine.prototype.drawQueue = function () {
    var Q = this.queue, m = this.model;
    for (var q = 0; q < Q.length; q++) {
      var e = Q[q];
      switch (e.t) {
        case 0: this.drawHall(); break;
        case 1: this.drawWing(); break;
        case 2: this.drawOneCity(e.i); break;
        case 3: this.drawOneTree(m.trees[e.i]); break;
        case 4: this.drawPodium(); break;
        case 5: this.drawTower(); break;
        case 6: this.drawOneLamp(e.i); break;
        case 7: this.drawOneBench(e.i); break;
        case 8: this.drawOneFlag(e.i); break;
      }
    }
  };

  // Стилобат с лестницами, порталом и штриховкой
  Engine.prototype.drawPodium = function () {
    this.fillShells('podium', C_PODIUM);
    this.fillShells('deck',   C_DECK);
    this.drawCells(3);
    this.hatch();
    this.strokeBody(3);
    this.drawOutline(3);
    this.drawShadows(1);
  };

  // Ствол и тарелка
  Engine.prototype.drawTower = function () {
    this.fillShells('shaft',   C_SHAFT);
    this.fillShaftShade();
    this.drawCells();
    this.fillShells('rail',    C_RAIL);
    this.strokeBody(0);

    this.fillShells('neck',    C_NECK);
    this.fillShells('flare',   C_FLARE);
    this.drawGlassBand();
    /* Силуэты сидящих сняты по просьбе владельца: на телефоне головы
       читались пятнами, а не людьми. Сама функция drawCafe оставлена —
       вернуть её можно одной строкой, когда придумаем, как их рисовать.
       Вращение барабана от этого не зависит: его держит цветной узор
       панелей. */
    this.fillShells('parapet', C_PARAPET);
    this.fillShells('roof',    C_ROOF);
    this.strokeBody(1);
    this.drawOutline(0);
    this.drawOutline(1);
  };

  /* Проекция одной точки на лету. Нужна тем, кто двигается: массив
     positions считается один раз на всю модель, а люди ходят. */
  Engine.prototype.proj = function (x, y, z, o) {
    var r = this.rot;
    var x1 = x * r.cy + z * r.sy;
    var z1 = -x * r.sy + z * r.cy;
    var y2 = y * r.cp - z1 * r.sp;
    var z2 = y * r.sp + z1 * r.cp;
    var d = CAM_DIST - z2; if (d < 1) d = 1;
    var k = FOCAL / d * this.S;
    o.x = this.ox + x1 * k;
    o.y = this.oy - y2 * k;
    o.k = k; o.z = z2;
    return o;
  };

  /* Флаги. Полотнище — волна от времени: живое движение, которое не
     выглядит зациклённым, потому что у каждого флага своя фаза. */

  /* ОСТЕКЛЕНИЕ КАФЕ — ПАНЕЛЬ ЗА ПАНЕЛЬЮ.

     Однотонное кольцо стекла не даёт понять, что барабан вращается:
     глазу не за что зацепиться. Поэтому каждая панель красится своим
     оттенком — чередование тёмного и светлого плюс несколько «тёплых»,
     где горит свет. Узор едет вместе с барабаном, и вращение читается
     сразу, даже на неподвижном кадре в ленте.

     Днём это блики на стекле, ночью — залы с разным светом. */
  Engine.prototype.drawGlassBand = function () {
    var ctx = this.ctx, m = this.model;
    var idx = m.shellIndex && m.shellIndex['glass'];
    if (!idx) return;
    var px = this.px, py = this.py, shells = m.shells;
    var base = parseCol(C_GLASS);

    for (var q = 0; q < idx.length; q++) {
      var f = shells[idx[q]];
      if (!f.vis) continue;
      var i = f.idx || 0;

      /* Узор. Ночью весь барабан уходит в тёплый, и однотонное кольцо
         снова не даёт понять, что оно едет. Поэтому часть залов гасим:
         две панели из трёх горят, третья тёмная. Бегущая цепочка
         «свет-свет-темно» читается мгновенно. */
      var dark = (i % 3) === 1;
      var light = (i % 2) === 0 ? 1.13 : 0.89;
      var r = base[0] * light, g = base[1] * light, b = base[2] * light;

      if (dark) {
        var d = 0.34 + 0.42 * NIGHT;                 // ночью контраст резче
        r += (34 - r) * d; g += (40 - g) * d; b += (58 - b) * d;
      } else if ((i % 5) === 2) {
        var w = 0.30 + 0.30 * NIGHT;                 // особенно яркий зал
        r += (250 - r) * w; g += (222 - g) * w; b += (150 - b) * w;
      }
      // блик от солнца: панель, повёрнутая к свету, ярче
      var sh = 0.86 + 0.30 * Math.max(0, f.lit);
      ctx.beginPath();
      ctx.moveTo(px[f.a], py[f.a]);
      ctx.lineTo(px[f.b], py[f.b]);
      ctx.lineTo(px[f.c], py[f.c]);
      ctx.lineTo(px[f.d], py[f.d]);
      ctx.closePath();
      ctx.fillStyle = 'rgb(' + ((r * sh) | 0) + ',' + ((g * sh) | 0) + ',' + ((b * sh) | 0) + ')';
      ctx.fill();
    }
  };

  /* ВРАЩАЮЩЕЕСЯ КАФЕ.

     Наверху башни было вращающееся кафе — оно и делало здание тем, чем
     оно было: люди поднимались туда смотреть на Арарат, и зал медленно
     поворачивался. Значит, крутиться должен не колпак, а то, что внутри.

     Силуэты сидящих идут по кольцу за остеклением. Каждый виден ровно
     тогда, когда его место повёрнуто к нам — та же проверка, что и у
     граней. Оборот примерно за минуту: в жизни медленнее, но на экране
     нужно, чтобы движение читалось. */
  Engine.prototype.drawCafe = function () {
    var cf = this.model.cafe;
    if (!cf) return;
    var ctx = this.ctx, r = this.rot, t = this.time;
    var o = this._co || (this._co = {});
    var N = 18, spin = this.spin || 0;   // тот же угол, что и у самого барабана

    var shapes = 0;
    ctx.beginPath();
    for (var i = 0; i < N; i++) {
      var a = spin + (i / N) * Math.PI * 2;
      var nx = Math.cos(a), nz = Math.sin(a);
      // повёрнуто ли место к нам
      var nx1 = nx * r.cy + nz * r.sy;
      var nz1 = -nx * r.sy + nz * r.cy;
      var nz2 = nz1 * r.cp;
      /* Порог выше, чем у граней: у самого края барабана силуэт виден
         под таким углом, что в жизни его закрывает стойка остекления,
         а на экране он выглядел приклеенным сбоку. */
      if (nz2 < 0.34) continue;

      this.proj(nx * cf.r, cf.y, nz * cf.r, o);
      var k = o.k;
      var hh = k * 0.085;
      var wd = k * 0.040;

      // плечи
      ctx.moveTo(o.x - wd, o.y + hh * 0.30);
      ctx.quadraticCurveTo(o.x, o.y - hh * 0.20, o.x + wd, o.y + hh * 0.30);
      ctx.lineTo(o.x - wd, o.y + hh * 0.30);
      // голова
      ctx.moveTo(o.x + wd * 0.52, o.y - hh * 0.38);
      ctx.arc(o.x, o.y - hh * 0.38, wd * 0.52, 0, Math.PI * 2);
      shapes++;
    }
    if (!shapes) return;
    ctx.fillStyle = NIGHT > 0.35 ? 'rgba(74, 52, 30, 0.80)' : 'rgba(38, 42, 48, 0.55)';
    ctx.fill();
  };

  /* Надпись на фасаде. Текст раскладывается по четырём точкам плиты,
     поэтому он поворачивается вместе со зданием, а не висит наклейкой
     поверх экрана. */
  Engine.prototype.drawSign = function (sg, faceCheck) {
    sg = sg || this.model.sign;
    if (!sg) return;
    if (faceCheck !== false) {
      var sh = this.model.shells[sg.face];
      if (!sh || !sh.vis) return;
    } else if (sg.nx !== undefined) {
      // табличка на вертушке: показываем, только когда повёрнута к нам
      var r2 = this.rot, sx = sg.nx, sz = sg.nz;
      if (sg.spin) {
        var cs3 = Math.cos(this.spin || 0), ss3 = Math.sin(this.spin || 0);
        var tx = sx * cs3 - sz * ss3;
        sz = sx * ss3 + sz * cs3;
        sx = tx;
      }
      var z1s = -sx * r2.sy + sz * r2.cy;
      var face2 = z1s * r2.cp;
      if (face2 < 0.30) return;
      /* Гаснет плавно к краю барабана. Резкое отключение давало
         «сплющенную» надпись, которая исчезала скачком. */
      this._signFade = Math.min(1, (face2 - 0.30) / 0.30);
    }

    var ctx = this.ctx, px = this.px, py = this.py;
    var ax = px[sg.a], ay = py[sg.a];
    var ux = px[sg.b] - ax, uy = py[sg.b] - ay;     // вдоль строки
    var vx = px[sg.d] - ax, vy = py[sg.d] - ay;     // вверх по высоте
    var len = Math.sqrt(ux * ux + uy * uy);
    if (len < 22) return;                            // мелко — не мельтешим

    ctx.save();
    ctx.transform(ux / 100, uy / 100, vx / 100, vy / 100, ax, ay);
    ctx.scale(1, -1);                                // экранный Y смотрит вниз
    ctx.font = '600 62px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'alphabetic';
    var w = ctx.measureText(sg.text).width;
    ctx.scale(96 / w, 96 / w);
    var fade = (faceCheck === false && this._signFade !== undefined)
      ? this._signFade : 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = NIGHT > 0.35 ? 'rgba(250, 226, 170, 0.95)' : 'rgba(58, 52, 46, 0.85)';
    ctx.fillText(sg.text, 2, -18);
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  /* Огни города внизу. Ночью нижняя половина кадра проваливалась в
     черноту — светилась одна башня и висела в пустоте. Теперь под
     холмом лежит россыпь тёплых точек: дальние окна и уличный свет.
     Всё сводится к двум заливкам на весь город. */
  Engine.prototype.drawCityGlow = function () {
    if (NIGHT < 0.12) return;
    var G = this.model.glow;
    if (!G || !G.length) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz, t = this.time;
    var S = this.S, a = Math.min(1, (NIGHT - 0.12) / 0.3);

    // мягкое свечение
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (var i = 0; i < G.length; i++) {
      var b = G[i];
      var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * S;
      var r = k * 0.018;
      if (r < 0.4) continue;
      ctx.moveTo(px[b] + r * 2.4, py[b]);
      ctx.arc(px[b], py[b], r * 2.4, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(255, 186, 96, ' + (0.085 * a).toFixed(3) + ')';
    ctx.fill();

    // сами огоньки, с лёгким мерцанием
    ctx.beginPath();
    for (var j = 0; j < G.length; j++) {
      var b2 = G[j];
      var k2 = FOCAL / Math.max(1, CAM_DIST - pz[b2]) * S;
      var r2 = k2 * 0.0115 * (0.75 + 0.25 * Math.sin(t * 1.3 + j * 2.1));
      if (r2 < 0.25) continue;
      ctx.moveTo(px[b2] + r2, py[b2]);
      ctx.arc(px[b2], py[b2], r2, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(255, 214, 150, ' + (0.85 * a).toFixed(3) + ')';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  /* Скамейки. Сиденье и две ножки, все разом одним путём. */

  /* Фонари. Днём — тонкая мачта с головкой, ночью ещё и тёплое пятно
     света: без него площадка остаётся чёрной, сколько ни зажигай окон. */
  Engine.prototype.drawOneLamp = function (i) {
    var L = this.model.lamps[i];
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var tp = L.t;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[tp]) * this.S;

    // свет кладём ПОД мачту, иначе он ложится поверх неё молочным пятном
    if (NIGHT > 0.15) {
      var al = Math.min(1, (NIGHT - 0.15) / 0.35);
      var rr = k * 0.42 * (this.lod < 0.7 ? 0.7 : 1);
      var g = ctx.createRadialGradient(px[tp], py[tp], 0, px[tp], py[tp], rr);
      g.addColorStop(0, 'rgba(255, 214, 140, ' + (0.55 * al).toFixed(3) + ')');
      g.addColorStop(0.45, 'rgba(255, 200, 120, ' + (0.16 * al).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255, 190, 110, 0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px[tp], py[tp], rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.beginPath();
    ctx.moveTo(px[L.b], py[L.b]);
    ctx.lineTo(px[tp], py[tp]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.9, this.S * 0.010);
    ctx.globalAlpha = 0.78;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(px[tp], py[tp], k * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = NIGHT > 0.2 ? 'rgb(255, 226, 164)' : C_RAIL;
    ctx.fill();
  };

  Engine.prototype.drawOneBench = function (i) {
    var f = this.model.benches[i];
    var ctx = this.ctx, px = this.px, py = this.py;
    ctx.beginPath();
    ctx.moveTo(px[f.a], py[f.a]); ctx.lineTo(px[f.b], py[f.b]);
    ctx.moveTo(px[f.a], py[f.a]); ctx.lineTo(px[f.c], py[f.c]);
    ctx.moveTo(px[f.b], py[f.b]); ctx.lineTo(px[f.d], py[f.d]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.1, this.S * 0.013);
    ctx.globalAlpha = 0.72;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  Engine.prototype.drawOneFlag = function (i) {
    var f = this.model.flags[i];
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz, t = this.time;

    ctx.beginPath();
    ctx.moveTo(px[f.b], py[f.b]);
    ctx.lineTo(px[f.t], py[f.t]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, this.S * 0.008);
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;

    var k = FOCAL / Math.max(1, CAM_DIST - pz[f.t]) * this.S;
    var x0 = px[f.t], y0 = py[f.t];
    var wdt = k * 0.30, hgt = k * 0.16;

    /* Флаг армянский: красный, синий, абрикосовый. Полотнище идёт
       волной, поэтому каждая полоса рисуется своей кривой — иначе
       полосы разъедутся между собой. */
    var BAND = [['rgba(217, 0, 18, 0.94)', 0, 1 / 3],
                ['rgba(0, 51, 160, 0.94)', 1 / 3, 2 / 3],
                ['rgba(242, 168, 0, 0.94)', 2 / 3, 1]];
    for (var s3 = 0; s3 < 3; s3++) {
      var y1b = y0 + hgt * BAND[s3][1], y2b = y0 + hgt * BAND[s3][2];
      ctx.beginPath();
      for (var q3 = 0; q3 <= 6; q3++) {
        var u3 = q3 / 6;
        var wv = Math.sin(t * 2.4 + f.ph + u3 * 4.2) * hgt * 0.30 * u3;
        if (q3 === 0) ctx.moveTo(x0, y1b + wv);
        else ctx.lineTo(x0 + wdt * u3, y1b + wv);
      }
      for (var q4 = 6; q4 >= 0; q4--) {
        var u4 = q4 / 6;
        var wv2 = Math.sin(t * 2.4 + f.ph + u4 * 4.2) * hgt * 0.30 * u4;
        ctx.lineTo(x0 + wdt * u4, y2b + wv2);
      }
      ctx.closePath();
      ctx.fillStyle = BAND[s3][0];
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (var q = 1; q <= 6; q++) {
      var u = q / 6;
      ctx.lineTo(x0 + wdt * u, y0 + Math.sin(t * 2.4 + f.ph + u * 4.2) * hgt * 0.30 * u);
    }
    for (var q2 = 6; q2 >= 0; q2--) {
      var u2 = q2 / 6;
      ctx.lineTo(x0 + wdt * u2,
                 y0 + hgt + Math.sin(t * 2.4 + f.ph + u2 * 4.2) * hgt * 0.30 * u2);
    }
    ctx.closePath();
    /* Заливки тут нет: полотнище уже покрашено тремя полосами выше.
       Раньше здесь стояла одноцветная заливка, и она закрашивала
       триколор — флаги выходили просто синими. */
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };


  /* Надпись на фасаде. Текст раскладывается по четырём точкам плиты,
     поэтому он поворачивается вместе со зданием, а не висит наклейкой
     поверх экрана. */
  Engine.prototype.drawSign = function (sg, faceCheck) {
    sg = sg || this.model.sign;
    if (!sg) return;
    if (faceCheck !== false) {
      var sh = this.model.shells[sg.face];
      if (!sh || !sh.vis) return;
    }

    var ctx = this.ctx, px = this.px, py = this.py;
    var ax = px[sg.a], ay = py[sg.a];
    var ux = px[sg.b] - ax, uy = py[sg.b] - ay;     // вдоль строки
    var vx = px[sg.d] - ax, vy = py[sg.d] - ay;     // вверх по высоте
    var len = Math.sqrt(ux * ux + uy * uy);
    if (len < 22) return;                            // мелко — не мельтешим

    ctx.save();
    ctx.transform(ux / 100, uy / 100, vx / 100, vy / 100, ax, ay);
    ctx.scale(1, -1);                                // экранный Y смотрит вниз
    ctx.font = '600 62px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'alphabetic';
    var w = ctx.measureText(sg.text).width;
    ctx.scale(96 / w, 96 / w);
    ctx.fillStyle = NIGHT > 0.35 ? 'rgba(250, 226, 170, 0.95)' : 'rgba(58, 52, 46, 0.85)';
    ctx.fillText(sg.text, 2, -18);
    ctx.restore();
  };

  /* Огни города внизу. Ночью нижняя половина кадра проваливалась в
     черноту — светилась одна башня и висела в пустоте. Теперь под
     холмом лежит россыпь тёплых точек: дальние окна и уличный свет.
     Всё сводится к двум заливкам на весь город. */
  Engine.prototype.drawCityGlow = function () {
    if (NIGHT < 0.12) return;
    var G = this.model.glow;
    if (!G || !G.length) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz, t = this.time;
    var S = this.S, a = Math.min(1, (NIGHT - 0.12) / 0.3);

    // мягкое свечение
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    for (var i = 0; i < G.length; i++) {
      var b = G[i];
      var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * S;
      var r = k * 0.018;
      if (r < 0.4) continue;
      ctx.moveTo(px[b] + r * 2.4, py[b]);
      ctx.arc(px[b], py[b], r * 2.4, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(255, 186, 96, ' + (0.085 * a).toFixed(3) + ')';
    ctx.fill();

    // сами огоньки, с лёгким мерцанием
    ctx.beginPath();
    for (var j = 0; j < G.length; j++) {
      var b2 = G[j];
      var k2 = FOCAL / Math.max(1, CAM_DIST - pz[b2]) * S;
      var r2 = k2 * 0.0115 * (0.75 + 0.25 * Math.sin(t * 1.3 + j * 2.1));
      if (r2 < 0.25) continue;
      ctx.moveTo(px[b2] + r2, py[b2]);
      ctx.arc(px[b2], py[b2], r2, 0, Math.PI * 2);
    }
    ctx.fillStyle = 'rgba(255, 214, 150, ' + (0.85 * a).toFixed(3) + ')';
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  };

  /* Скамейки. Сиденье и две ножки, все разом одним путём. */
  Engine.prototype.drawBenches = function () {
    var Bc = this.model.benches;
    if (!Bc || !Bc.length) return;
    var ctx = this.ctx, px = this.px, py = this.py;
    ctx.beginPath();
    for (var i = 0; i < Bc.length; i++) {
      var f = Bc[i];
      ctx.moveTo(px[f.a], py[f.a]); ctx.lineTo(px[f.b], py[f.b]);
      ctx.moveTo(px[f.a], py[f.a]); ctx.lineTo(px[f.c], py[f.c]);
      ctx.moveTo(px[f.b], py[f.b]); ctx.lineTo(px[f.d], py[f.d]);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.1, this.S * 0.013);
    ctx.globalAlpha = 0.72;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* Фонари. Днём — тонкая мачта с головкой, ночью ещё и тёплое пятно
     света: без него площадка остаётся чёрной, сколько ни зажигай окон. */
  Engine.prototype.drawLamps = function () {
    var L = this.model.lamps;
    if (!L) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;

    // свет кладём ПОД мачты, иначе он ложится поверх них молочным пятном
    if (NIGHT > 0.15) {
      var al = Math.min(1, (NIGHT - 0.15) / 0.35);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < L.length; i++) {
        var tp = L[i].t;
        var k = FOCAL / Math.max(1, CAM_DIST - pz[tp]) * this.S;
        var rr = k * 0.42;
        var g = ctx.createRadialGradient(px[tp], py[tp], 0, px[tp], py[tp], rr);
        g.addColorStop(0, 'rgba(255, 214, 140, ' + (0.55 * al).toFixed(3) + ')');
        g.addColorStop(0.45, 'rgba(255, 200, 120, ' + (0.16 * al).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255, 190, 110, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px[tp], py[tp], rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.beginPath();
    for (var j = 0; j < L.length; j++) {
      ctx.moveTo(px[L[j].b], py[L[j].b]);
      ctx.lineTo(px[L[j].t], py[L[j].t]);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.9, this.S * 0.010);
    ctx.globalAlpha = 0.78;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    for (var j2 = 0; j2 < L.length; j2++) {
      var tp2 = L[j2].t;
      var k2 = FOCAL / Math.max(1, CAM_DIST - pz[tp2]) * this.S;
      ctx.moveTo(px[tp2] + k2 * 0.022, py[tp2]);
      ctx.arc(px[tp2], py[tp2], k2 * 0.022, 0, Math.PI * 2);
    }
    ctx.fillStyle = NIGHT > 0.2 ? 'rgb(255, 226, 164)' : C_RAIL;
    ctx.fill();
  };

  /* АРАРАТ.

     Гора бесконечно далека, поэтому её нельзя считать обычной точкой:
     при удалении в шестьдесят километров формула проекции вырождается.
     Считаем её как небо: положение зависит ТОЛЬКО от направления
     взгляда, а не от того, где стоит камера. Отсюда и правильное
     ощущение — при повороте гора уходит за край, при наклоне поднимается
     вместе с горизонтом, но не «объезжает» здание.

     Линия горизонта в нашей проекции: oy − tg(наклон) · FOCAL · S.
     Видимая высота горы — её угловой размер, то есть высота, делённая
     на расстояние. У Арарата это примерно 5 км на 60 — но с натуры он
     кажется больше, и мы берём крупнее: рисунок, а не топография. */
  var SKY_K = 0.42;     // во сколько раз медленнее разворачивается дальний план

  Engine.prototype.drawArarat = function () {
    var ctx = this.ctx, w = this.w;
    var st2 = this.state || {};
    var yaw = this._yaw || 0, pitch = this._pitch || 0;

    var AZ = -Math.PI / 2 + 1.15;        // куда смотрит гора от здания
    var th = AZ - yaw + Math.PI / 2;
    while (th > Math.PI) th -= Math.PI * 2;
    while (th < -Math.PI) th += Math.PI * 2;
    if (Math.cos(th) <= 0.08) return;    // за спиной

    /* СЖАТИЕ ДАЛЬНЕГО ПЛАНА.
       У нашей камеры узкий угол зрения — около двадцати градусов. При
       честной развёртке гора влезала в кадр лишь в узком окне поворота
       и мгновенно улетала за край. А из Еревана Арарат занимает полнеба
       и никуда не девается.

       Поэтому дальний план разворачивается вчетверо медленнее: угол до
       горы умножается на 0.42. Физически это враньё, на глаз —
       единственный способ получить правду ощущения. */
    var tt = th * SKY_K;

    var F = FOCAL * this.S;
    /* Подошву сажаем не на математический горизонт, а на дальний край
       земли: у нас земля — конечный диск, и её край на экране ниже
       горизонта. Иначе гора висела бы в небе с просветом над травой. */
    var hy = this.groundTopPy;
    if (hy === undefined) hy = this.oy - Math.tan(pitch) * F;
    var cx = this.ox + Math.tan(tt) * F / Math.cos(pitch);
    /* Угловой размер. По-честному 4385 м на 60 км — это 0.073 радиана.
       Берём 0.105: чуть крупнее правды, как его и рисуют, но так, чтобы
       оба брата помещались в кадр телефона. При 0.175 массив выходил
       шире экрана и Малый Арарат срезался. */
    var H = 0.150 * F / Math.cos(tt);                // высота над горизонтом

    if (hy < -H * 1.2 || hy > this.h + H) return;
    if (cx < -H * 5 || cx > w + H * 5) return;

    // цвет: днём выцветает в дымке, на закате розовеет, ночью силуэт
    function mix(a, b, k) {
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
    var body = mix([150, 166, 186], [38, 44, 74], NIGHT);
    body = mix(body, [176, 138, 140], DUSK * 0.7);
    var snow = mix([242, 244, 248], [150, 160, 196], NIGHT);
    snow = mix(snow, [246, 206, 198], DUSK * 0.7);
    function rgb(c, a) {
      return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
    }

    /* СИЛУЭТ ПО ЧИСЛАМ, а не на глаз.
       Большой Арарат поднимается над равниной на 4385 м — это наша H.
       Малый — 3127, то есть 0.71 H, а не половина: именно поэтому он
       узнаётся как «второй брат», а не как холмик.
       Между вершинами 11 км = 2.5 H. Основание массива огромное:
       полуширина большого конуса около 3.2 H.
       Седловина Сардар-Булак между ними остаётся высоко — 0.41 H.
       Постоянный снег лежит выше 4250 м, то есть только на верхних
       20 процентах Большого. На Малом постоянного снега нет — и это
       различие делает пару сразу узнаваемой. */
    var gx = cx, S1 = H;
    function P(dx, dy) { return [gx + dx * H, hy - dy * S1]; }

    var pBaseL = P(-3.20, 0),  pTop = P(0, 1.00);
    var pSad   = P(1.45, 0.41), pLit = P(2.50, 0.71), pBaseR = P(3.62, 0);

    var g = ctx.createLinearGradient(0, hy - H, 0, hy);
    g.addColorStop(0, rgb(body, 0.97));
    g.addColorStop(0.62, rgb(body, 0.80));
    g.addColorStop(1, rgb(body, 0.34));       // подошва тает в дымке
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(pBaseL[0], pBaseL[1]);
    // левый склон большого: сначала пологий, у вершины круче
    ctx.bezierCurveTo(gx - H * 1.90, hy - H * 0.30,
                      gx - H * 0.72, hy - H * 0.80,
                      pTop[0], pTop[1]);
    // правое плечо вниз к седловине
    ctx.bezierCurveTo(gx + H * 0.55, hy - H * 0.82,
                      gx + H * 1.05, hy - H * 0.52,
                      pSad[0], pSad[1]);
    // подъём на малый — он заметно острее
    ctx.quadraticCurveTo(gx + H * 2.10, hy - H * 0.56, pLit[0], pLit[1]);
    ctx.quadraticCurveTo(gx + H * 3.00, hy - H * 0.40, pBaseR[0], pBaseR[1]);
    ctx.closePath();
    ctx.fill();

    // снежная шапка — только верхние 20 процентов большого конуса
    var snowY = hy - H * 0.795;
    ctx.beginPath();
    ctx.moveTo(gx - H * 0.46, snowY);
    ctx.lineTo(gx - H * 0.30, snowY - H * 0.045);
    ctx.lineTo(gx - H * 0.16, snowY + H * 0.020);
    ctx.lineTo(gx - H * 0.02, snowY - H * 0.055);
    ctx.lineTo(gx + H * 0.14, snowY + H * 0.012);
    ctx.lineTo(gx + H * 0.30, snowY - H * 0.030);
    ctx.lineTo(gx + H * 0.44, snowY + H * 0.018);
    ctx.bezierCurveTo(gx + H * 0.30, hy - H * 0.90, gx + H * 0.12, hy - H * 0.98,
                      pTop[0], pTop[1]);
    ctx.bezierCurveTo(gx - H * 0.16, hy - H * 0.96, gx - H * 0.32, hy - H * 0.88,
                      gx - H * 0.46, snowY);
    ctx.closePath();
    ctx.fillStyle = rgb(snow, 0.92 - 0.25 * NIGHT);
    ctx.fill();

    // тонкая линия гребня — та же тушь, что и у здания
    ctx.beginPath();
    ctx.moveTo(pBaseL[0], pBaseL[1]);
    ctx.bezierCurveTo(gx - H * 1.90, hy - H * 0.30, gx - H * 0.72, hy - H * 0.80, pTop[0], pTop[1]);
    ctx.bezierCurveTo(gx + H * 0.55, hy - H * 0.82, gx + H * 1.05, hy - H * 0.52, pSad[0], pSad[1]);
    ctx.quadraticCurveTo(gx + H * 2.10, hy - H * 0.56, pLit[0], pLit[1]);
    ctx.quadraticCurveTo(gx + H * 3.00, hy - H * 0.40, pBaseR[0], pBaseR[1]);
    ctx.strokeStyle = rgb(mix(body, [40, 40, 52], 0.45), 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  /* ДАЛЬНИЙ ЕРЕВАН.

     Между краем холма и Араратом лежала пустота. На деле оттуда видно
     город: сплошная полоса плоских кровель, из которой кое-где торчат
     башни повыше. Полоса идёт по всему кругу, поэтому задаётся как
     функция от направления: у каждого квартала свой азимут, а на экран
     он попадает по тому же правилу, что и гора.

     Это не объёмы. С такого расстояния объём не читается — читается
     только зубчатый край и цвет, съеденный воздухом. */
  Engine.prototype.drawSkyline = function () {
    var ctx = this.ctx, w = this.w;
    var yaw = this._yaw || 0, pitch = this._pitch || 0;
    var F = FOCAL * this.S;
    var hy = this.groundTopPy;
    if (hy === undefined) return;

    if (!this.skyline) {
      var rs = seeded(777001);
      var N = 150, sl = [];
      for (var i = 0; i < N; i++) {
        var tall = rs() < 0.10;
        sl.push({
          az: (i / N) * Math.PI * 2 + rs() * 0.02,
          h: tall ? 0.034 + rs() * 0.034 : 0.011 + rs() * 0.015,
          wq: 0.6 + rs() * 0.9
        });
      }
      this.skyline = sl;
    }

    var base = [176, 184, 196];
    var c = [
      base[0] + (54 - base[0]) * NIGHT,
      base[1] + (60 - base[1]) * NIGHT,
      base[2] + (86 - base[2]) * NIGHT
    ];
    var col = 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' +
              (0.68 - 0.16 * NIGHT).toFixed(2) + ')';

    /* Два ряда вместо одного: дальний бледнее и ниже, ближний темнее и
       выше. Один ряд читался полоской тумана, два дают глубину. */
    var SL = this.skyline, dz = Math.PI * 2 / SL.length;
    for (var row = 0; row < 2; row++) {
    ctx.beginPath();
    var any = false;
    for (var k = row; k < SL.length; k += 1) {
      if ((k % 2) !== row) continue;
      var b = SL[k];
      var th = b.az - yaw + Math.PI / 2;
      while (th > Math.PI) th -= Math.PI * 2;
      while (th < -Math.PI) th += Math.PI * 2;
      if (Math.cos(th) <= 0.12) continue;

      var f = F / Math.cos(pitch);
      var x0 = this.ox + Math.tan((th - dz * b.wq * 0.5) * SKY_K) * f;
      var x1 = this.ox + Math.tan((th + dz * b.wq * 0.5) * SKY_K) * f;
      if (x1 < -40 || x0 > w + 40) continue;
      var hgt = b.h * F / Math.cos(th * SKY_K) * (row ? 1.35 : 0.8);
      ctx.rect(x0, hy - hgt, x1 - x0, hgt + 2);
      any = true;
    }
    if (any) {
      ctx.fillStyle = row
        ? 'rgba(' + ((c[0] * 0.86) | 0) + ',' + ((c[1] * 0.86) | 0) + ',' +
          ((c[2] * 0.9) | 0) + ',' + (0.72 - 0.18 * NIGHT).toFixed(2) + ')'
        : col;
      ctx.fill();
    }
    }
  };

  /* Небо. Рисуется каждый кадр — иначе не сменить время суток и не
     двинуть облака. Стоит дёшево: одна заливка с градиентом, четыре
     облака по восемь дуг и горсть звёзд. */
  Engine.prototype.drawSky = function () {
    var ctx = this.ctx, w = this.w, h = this.h, t = this.time;
    var horizon = h * 0.72;
    var yaw = this._yaw || 0, pitch = this._pitch || 0;

    /* Звёзды рисуем раньше горы: она должна их закрывать. */
    if (NIGHT > 0.12) {
      var stars0 = this.stars;
      ctx.fillStyle = 'rgba(255, 252, 236, ' + (0.85 * NIGHT).toFixed(3) + ')';
      for (var s0 = 0; s0 < stars0.length; s0 += 3) {
        var tw0 = 0.65 + 0.35 * Math.sin(t * 1.7 + stars0[s0 + 2]);
        var rr0 = stars0[s0 + 2] % 1 * 0.9 + 0.5;
        ctx.globalAlpha = tw0;
        ctx.fillRect(stars0[s0] * w, stars0[s0 + 1] * horizon, rr0, rr0);
      }
      ctx.globalAlpha = 1;
    }

    /* СВЕТИЛО.

       Раньше солнце ставилось в экранных координатах от времени суток —
       и висело в одной точке экрана, куда бы ты ни повернулся. Видно
       его было со всех сторон сразу.

       Теперь оно стоит В МИРЕ: его направление берётся из вектора
       света, того самого, по которому кладутся тени. Поэтому солнце
       всегда там, откуда светит, при повороте уходит за край, а со
       спины его не видно вовсе. По вертикали — по высоте света над
       горизонтом.

       Разворачивается оно тем же сжатым дальним планом, что гора: иначе
       при узком угле зрения проскакивало бы мимо экрана. */
    var sAz = Math.atan2(LZ, LX);
    var sTh = sAz - yaw + Math.PI / 2;
    while (sTh > Math.PI) sTh -= Math.PI * 2;
    while (sTh < -Math.PI) sTh += Math.PI * 2;

    if (Math.cos(sTh) > 0.06) {
      var Fs = FOCAL * this.S;
      var hyS = this.oy - Math.tan(pitch) * Fs;
      var sx = this.ox + Math.tan(sTh * SKY_K) * Fs / Math.cos(pitch);
      var sy = hyS - LY * h * 0.34;   // выше — уходит за верх кадра
      var sr = Math.min(w, h) * 0.042;

      if (sx > -sr * 4 && sx < w + sr * 4 && sy > -sr * 4 && sy < h + sr * 2) {
        var gs = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr * 3.4);
        if (NIGHT > 0.55) {
          gs.addColorStop(0, 'rgba(226, 232, 250, 0.90)');
          gs.addColorStop(0.14, 'rgba(210, 220, 245, 0.30)');
          gs.addColorStop(1, 'rgba(190, 205, 240, 0)');
        } else {
          gs.addColorStop(0, 'rgba(255, 244, 206, ' + (0.85 - 0.4 * NIGHT).toFixed(2) + ')');
          gs.addColorStop(0.13, 'rgba(255, 226, 160, 0.28)');
          gs.addColorStop(1, 'rgba(255, 210, 140, 0)');
        }
        ctx.fillStyle = gs;
        ctx.beginPath();
        ctx.arc(sx, sy, sr * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.drawArarat();
    this.drawSkyline();

    /* Птицы. Три галочки, скользящие поперёк неба; взмах — изменение
       угла галочки. Дёшево, а небо перестаёт быть неподвижным. */
    if (NIGHT < 0.6) {
      var brd = this.birds;
      ctx.beginPath();
      for (var bi = 0; bi < brd.length; bi++) {
        var bd = brd[bi];
        var bx = ((bd.x + t * bd.v) % (w + 160) + w + 160) % (w + 160) - 80;
        var by = bd.y * h + Math.sin(t * 0.5 + bd.p) * h * 0.012;
        var fl = 0.35 + 0.28 * Math.sin(t * 6.2 + bd.p);
        var sz = bd.s * Math.min(w, h);
        ctx.moveTo(bx - sz, by - sz * fl);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + sz, by - sz * fl);
      }
      ctx.strokeStyle = 'rgba(70, 66, 62, ' + (0.42 * (1 - NIGHT)).toFixed(2) + ')';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 4. облака: медленно плывут, ночью почти гаснут
    var cl = this.clouds, span = w + 400;
    for (var k = 0; k < cl.length; k++) {
      var c0 = cl[k];
      var cx = ((c0.x + t * c0.v) % span + span) % span - 200;
      var cy = c0.y * h;
      var sc = c0.s * Math.min(w, h) * (1 + Math.sin(t * 0.10 + c0.ph) * 0.09);
      for (var q = 0; q < 2; q++) {
        var e = q === 0 ? 1.28 : 1.0;
        var al = (q === 0 ? 0.22 : 0.42) * (1 - 0.72 * NIGHT);
        ctx.fillStyle = 'rgba(252, 252, 248, ' + al.toFixed(3) + ')';
        ctx.beginPath();
        puff(ctx, cx, cy, sc * e, 1.00, 0.38, Math.PI * 2);
        puff(ctx, cx - sc * 0.60, cy + sc * 0.13, sc * e, 0.50, 0.26, Math.PI * 2);
        puff(ctx, cx + sc * 0.64, cy + sc * 0.11, sc * e, 0.54, 0.28, Math.PI * 2);
        puff(ctx, cx + sc * 0.10, cy - sc * 0.19, sc * e, 0.44, 0.29, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  /* Для каждой грани и чешуйки: смотрит ли на камеру и насколько на свету */
  Engine.prototype.classify = function () {
    var r = this.rot;
    var cy = r.cy, sy = r.sy, cp = r.cp, sp = r.sp;

    /* thr — насколько грань должна повернуться к нам, чтобы её рисовать.
       Для стен хватает почти нуля. Для лоджий порог выше: у самого края
       башни они видны под таким углом, что в жизни их закрывает ребро,
       а на экране от них остаётся вытянутая клякса. */
    var cs2 = Math.cos(this.spin || 0), ss2 = Math.sin(this.spin || 0);

    function pass(list, thr) {
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        var fnx = f.nx, fnz = f.nz;
        if (f.spin) {                       // грань уехала вместе с барабаном
          var t2 = fnx * cs2 - fnz * ss2;
          fnz = fnx * ss2 + fnz * cs2;
          fnx = t2;
        }
        var nx1 = fnx * cy + fnz * sy;
        var nz1 = -fnx * sy + fnz * cy;
        var ny2 = f.ny * cp - nz1 * sp;
        var nz2 = f.ny * sp + nz1 * cp;
        f.vis = nz2 > thr;
        f.face = nz2;          // насколько повёрнута к нам: нужно для плавного гашения
        f.lit = nx1 * LX + ny2 * LY + nz2 * LZ;
      }
    }
    pass(this.model.shells, 0.015);
    pass(this.model.cells, 0.15);   /* Ниже этого лоджия у края ствола
       ложится почти плашмя, и башня начинает просвечивать решёткой.
       Пробовал 0.07 — стало хуже, вернул. */
  };

  /* Земля. Вдали она светлее и холоднее, вблизи — гуще и зеленее.
     Это воздушная перспектива: между глазом и далёким краем больше
     воздуха, и он подмешивает в цвет небо. Один градиент на кадр. */
  Engine.prototype.drawGround = function () {
    var ctx = this.ctx, idx = this.model.ground.ring;
    var px = this.px, py = this.py;
    var gt = this.groundTopPy, gb = this.groundBotPy;
    var n = idx.length;

    var fill = C_GROUND;
    if (gb > gt + 1) {
      var g = ctx.createLinearGradient(0, gt, 0, gb);
      g.addColorStop(0, C_GROUND_FAR);
      g.addColorStop(1, C_GROUND);
      fill = g;
    }

    /* Край ведём гладкой кривой через середины отрезков: каждая точка
       становится не углом, а изгибом. Ломаная из сорока отрезков на
       отдалении читалась угловатой кляксой. */
    ctx.beginPath();
    var ax = px[idx[n - 1]], ay = py[idx[n - 1]];
    var bx = px[idx[0]],     by = py[idx[0]];
    ctx.moveTo((ax + bx) * 0.5, (ay + by) * 0.5);
    for (var i = 0; i < n; i++) {
      var cx = px[idx[(i + 1) % n]], cy = py[idx[(i + 1) % n]];
      ctx.quadraticCurveTo(bx, by, (bx + cx) * 0.5, (by + cy) * 0.5);
      bx = cx; by = cy;
    }
    ctx.closePath();

    ctx.fillStyle = fill;
    ctx.fill();

    // Той же кривой — лёгкая обводка. Заливка и линия совпадают точно.
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* Заливка многоугольника по списку индексов */
  Engine.prototype.fillPoly = function (idx, color) {
    var ctx = this.ctx, px = this.px, py = this.py;
    ctx.beginPath();
    ctx.moveTo(px[idx[0]], py[idx[0]]);
    for (var i = 1; i < idx.length; i++) ctx.lineTo(px[idx[i]], py[idx[i]]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  /* Все ближние грани одного типа — в один путь и одна заливка:
     тогда прозрачность ложится ровно, без швов на стыках. */
  Engine.prototype.fillShells = function (kind, color, bld) {
    var ctx = this.ctx, m = this.model, shells = m.shells;
    var px = this.px, py = this.py;
    var any = false;

    // только грани своего сорта, а не вся сцена
    var idx = m.shellIndex && m.shellIndex[kind];
    if (!idx) return;
    var n = idx.length;

    ctx.beginPath();
    for (var q = 0; q < n; q++) {
      var i = idx[q];
      var f = shells[i];
      if (!f.vis) continue;
      if (bld !== undefined && f.bld !== bld) continue;
      ctx.moveTo(px[f.a], py[f.a]);
      ctx.lineTo(px[f.b], py[f.b]);
      ctx.lineTo(px[f.c], py[f.c]);
      ctx.lineTo(px[f.d], py[f.d]);
      ctx.closePath();
      any = true;
    }
    if (any) {
      ctx.fillStyle = color;
      ctx.fill();
      /* Шов между соседними гранями. На маке его не видно, на айфоне
         Safari оставляет между ними волосяную светлую полоску. Обводка
         тем же цветом закрывает шов и ничего не стоит. */
      var prevS = ctx.strokeStyle, prevW = ctx.lineWidth;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.strokeStyle = prevS;   // перо принадлежит рисунку, а не заливке
      ctx.lineWidth = prevW;
    }
  };

  /* Теневая половина ствола — ещё один полупрозрачный слой поверх */
  Engine.prototype.fillShaftShade = function () {
    var ctx = this.ctx, shells = this.model.shells;
    var px = this.px, py = this.py;

    /* Тень кладётся в два захода: сначала широкая и очень слабая,
       потом поуже и поплотнее. Один заход давал резкую вертикальную
       границу поперёк ствола — на круглом теле свет так не обрывается,
       он сходит на нет постепенно. */
    // Сначала тёплый подсвет туда, куда солнце бьёт в упор
    var any0 = false;
    ctx.beginPath();
    for (var i = 0; i < shells.length; i++) {
      var f = shells[i];
      if (f.kind !== 'shaft' || !f.vis || f.lit < 0.72) continue;
      ctx.moveTo(px[f.a], py[f.a]);
      ctx.lineTo(px[f.b], py[f.b]);
      ctx.lineTo(px[f.c], py[f.c]);
      ctx.lineTo(px[f.d], py[f.d]);
      ctx.closePath();
      any0 = true;
    }
    if (any0) { ctx.fillStyle = C_SIDE_LIT; ctx.fill(); }

    var steps = [0.16, -0.06];
    for (var s = 0; s < steps.length; s++) {
      var any = false;
      ctx.beginPath();
      for (var i = 0; i < shells.length; i++) {
        var f = shells[i];
        if (f.kind !== 'shaft' || !f.vis || f.lit > steps[s]) continue;
        ctx.moveTo(px[f.a], py[f.a]);
        ctx.lineTo(px[f.b], py[f.b]);
        ctx.lineTo(px[f.c], py[f.c]);
        ctx.lineTo(px[f.d], py[f.d]);
        ctx.closePath();
        any = true;
      }
      if (any) { ctx.fillStyle = C_SIDE_DRK; ctx.fill(); }
    }
  };

  /* Одна лоджия — это три слоя, как в жизни:
       1. арочный проём (тень внутри),
       2. окно в глубине проёма,
       3. белый балкон, выступающий вперёд, с обводкой.
     Слои копятся в общие пути и кладутся четырьмя заливками на всё
     здание разом — по одной на слой и по одной на теневую сторону. */

  // Кладёт в текущий путь арку ячейки: плоский низ, полуовальный верх.
  // inset < 1 — та же арка, ужатая к своему центру (это окно в глубине).
  Engine.prototype.archPath = function (f, inset) {
    var ctx = this.ctx, px = this.px, py = this.py;
    var ax = px[f.a], ay = py[f.a];
    var bx = px[f.b], by = py[f.b];
    var cx = px[f.c], cy = py[f.c];
    var dx = px[f.d], dy = py[f.d];

    if (inset < 1) {
      var mx = (ax + bx + cx + dx) * 0.25, my = (ay + by + cy + dy) * 0.25;
      ax = mx + (ax - mx) * inset; ay = my + (ay - my) * inset;
      bx = mx + (bx - mx) * inset; by = my + (by - my) * inset;
      cx = mx + (cx - mx) * inset; cy = my + (cy - my) * inset;
      dx = mx + (dx - mx) * inset; dy = my + (dy - my) * inset;
    }

    // Два опорных плеча вверх от нижних углов — так получается овал,
    // а не остриё, как выходит у простой дуги.
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.bezierCurveTo(bx + (cx - bx) * 1.32, by + (cy - by) * 1.32,
                      ax + (dx - ax) * 1.32, ay + (dy - ay) * 1.32, ax, ay);
  };

  // Балкон: плита, выступающая ниже проёма, с круглой передней кромкой
  Engine.prototype.balconyPath = function (f) {
    var ctx = this.ctx, px = this.px, py = this.py;
    var ax = px[f.a], ay = py[f.a];
    var bx = px[f.b], by = py[f.b];
    var tx = (px[f.c] + px[f.d]) * 0.5, ty = (py[f.c] + py[f.d]) * 0.5;
    var bxm = (ax + bx) * 0.5, bym = (ay + by) * 0.5;
    var vx = bxm - tx, vy = bym - ty;          // вектор «вниз» ростом в ячейку

    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.quadraticCurveTo(bxm + vx * 0.72, bym + vy * 0.72, ax, ay);
  };

  Engine.prototype.drawCells = function (grp) {
    var ctx = this.ctx, cells = this.model.cells;
    var n = cells.length;
    grp = grp || 0;

    // 1–2. проём и окно, каждый в двух тонах: на свету и в тени
    var layers = [
      { inset: 1.00, lit: C_CELL_LIT, drk: C_CELL_DRK },
      { inset: 0.66, lit: C_WIN_LIT,  drk: C_WIN_DRK  }
    ];
    for (var L = 0; L < layers.length; L++) {
      for (var pass = 0; pass < 2; pass++) {
        var any = false;
        ctx.beginPath();
        for (var i = 0; i < n; i++) {
          var f = cells[i];
          if (!f.vis || (f.grp || 0) !== grp) continue;
          if (f.arch && L > 0) continue;      // у арки нет окна в глубине
          /* У края ствола лоджия повёрнута почти ребром. Раньше её всё
             равно рисовали целиком — окно и балкон сминались в щепки и
             тёмные чёрточки вдоль силуэта. Теперь слои гаснут по
             очереди: сначала пропадает окно в глубине, потом балкон, и
             последним остаётся сам проём. Обрубать всю чешуйку разом
             нельзя — на её месте появлялась тёмная полоса. */
          if (L > 0 && f.face < 0.30) continue;
          if ((pass === 1) !== (f.lit <= 0.05)) continue;
          this.archPath(f, layers[L].inset);
          any = true;
        }
        if (any) {
          // Арка — это дыра в стене: внутри тень при любом свете.
          ctx.fillStyle = (pass === 1 || grp === 5) ? layers[L].drk : layers[L].lit;
          ctx.fill();
        }
      }
    }

    /* Свет в окнах. Ночью часть лоджий горит тёплым — это сильнее
       всего говорит «здание живое», и стоит одну заливку. */
    if (NIGHT > 0.2) {
      var anyL = false;
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var f = cells[i];
        if (!f.vis || (f.grp || 0) !== grp || f.arch) continue;
        if (f.lamp === undefined || f.lamp > 0.45) continue;
        if (f.face < 0.30) continue;
        this.archPath(f, 0.66);
        anyL = true;
      }
      if (anyL) {
        ctx.globalAlpha = Math.min(1, (NIGHT - 0.2) / 0.4);
        ctx.fillStyle = C_LAMP;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // 3. балконы — поверх проёмов, они и вправду выступают вперёд
    for (var pass = 0; pass < 2; pass++) {
      var any2 = false;
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var f = cells[i];
        if (!f.vis || (f.grp || 0) !== grp || f.arch) continue;
        if (f.face < 0.34) continue;          // балкон у края — белая щепка
        if ((pass === 1) !== (f.lit <= 0.05)) continue;
        this.balconyPath(f);
        any2 = true;
      }
      if (any2) {
        ctx.fillStyle = pass === 1 ? C_BALC_DRK : C_BALC_LIT;
        ctx.fill();
      }
    }

    // Обводка балконов — кромка плиты
    var any3 = false;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var f = cells[i];
      if (!f.vis || (f.grp || 0) !== grp || f.arch) continue;
      if (f.face < 0.34) continue;
      this.balconyPath(f);
      any3 = true;
    }
    if (any3) {
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = 0.75;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  /* Штрихи на той стороне, что отвернулась от света */
  Engine.prototype.hatch = function () {
    var ctx = this.ctx, shells = this.model.shells;
    var px = this.px, py = this.py;
    var any = false;

    ctx.beginPath();
    for (var i = 0; i < shells.length; i++) {
      var f = shells[i];
      if (!f.vis) continue;
      if (f.kind !== 'podium') continue;   // на колпаке штрихи читались как мусор
      if (f.lit > 0.08) continue;

      var strength = Math.min(1, (0.08 - f.lit) * 2.0);
      var count = strength > 0.5 ? 3 : 2;

      var ax = px[f.a], ay = py[f.a];
      var bx = px[f.b], by = py[f.b];
      var cx = px[f.c], cy = py[f.c];
      var dx = px[f.d], dy = py[f.d];

      for (var k = 1; k <= count; k++) {
        var t = k / (count + 1);
        var t2 = Math.min(1, t + 0.34);
        ctx.moveTo(ax + (bx - ax) * t, ay + (by - ay) * t);
        ctx.lineTo(dx + (cx - dx) * t2, dy + (cy - dy) * t2);
        any = true;
      }
    }
    if (any) {
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  /* Контур здания.
     Ребро оказывается на силуэте ровно тогда, когда одна из двух
     соседних граней смотрит на камеру, а вторая уже отвернулась.
     Проверка дешёвая, а край получается настоящий: он сам переезжает
     по зданию, пока оно крутится. */
  /* Жирный край силуэта. РИСУЕТСЯ ПО СЛОЮ, вместе со своим объектом.

     Раньше весь контур клался одним махом в самом конце кадра, поверх
     всего. Из-за этого обводка дома, который движок уже не рисовал,
     висела в воздухе чёрными палками, а контур башни ложился поверх
     ближних деревьев. Контур — часть предмета, а не наклейка сверху. */
  Engine.prototype.drawOutline = function (part) {
    var ctx = this.ctx, m = this.model;
    var o = m.outline, op = m.outlineParts, shells = m.shells;
    var px = this.px, py = this.py, jit = this.outJit;
    var n = o.length / 4, any = false;

    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var k = i * 4;
      if (part !== undefined && op && op[i] !== part) continue;
      if (shells[o[k + 2]].vis === shells[o[k + 3]].vis) continue;

      var a = o[k], b = o[k + 1];
      var x1 = px[a], y1 = py[a], x2 = px[b], y2 = py[b];
      var dx = x2 - x1, dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;

      var bow = jit[i];
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) * 0.5 - dy / len * bow,
                           (y1 + y2) * 0.5 + dx / len * bow, x2, y2);
      any = true;
    }
    if (!any) return;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = 2.1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* Мягкие тени на земле и на верхней террасе */
  Engine.prototype.drawShadows = function (layer) {
    var ctx = this.ctx, r = this.rot, list = this.model.shadows;
    var cy = r.cy, sy = r.sy, cp = r.cp, sp = r.sp;
    var S = this.S, ox = this.ox, oy = this.oy;
    var N = this.cN;

    /* Тень сдвинута в сторону, противоположную свету. Но не вся:
       у самого основания тень почти не уезжает и лежит плотным
       тёмным кольцом. Это и есть контактная тень — приём, который
       сильнее всего «прижимает» предмет к земле. Поэтому у каждой
       тени свой коэффициент сдвига. */
    /* Вбок тень уводим сильнее, чем вглубь. Физически честный сдвиг
       уносил её ровно за здание, и на экране её было не видно. */
    var offX = -LX * 1.30, offZ = -LZ * 0.40;

    // Тень нижнего корпуса — прямоугольник, её точки уже сдвинуты в модели
    if (layer === 0) {
      var hs = this.model.hallShadow, px = this.px, py = this.py;
      var ws = this.model.wingShadow;
      ctx.beginPath();
      ctx.moveTo(px[hs[0]], py[hs[0]]);
      for (var q = 1; q < hs.length; q++) ctx.lineTo(px[hs[q]], py[hs[q]]);
      ctx.closePath();
      ctx.moveTo(px[ws[0]], py[ws[0]]);
      for (var q2 = 1; q2 < ws.length; q2++) ctx.lineTo(px[ws[q2]], py[ws[q2]]);
      ctx.closePath();
      ctx.globalAlpha = 0.17;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (layer === 0 && this.model.city && this.model.city.length) {
      var CB = this.model.city, cc2 = this.model.cityCenters;
      var cy2 = r.cy, sy2 = r.sy, cp2 = r.cp, sp2 = r.sp;
      ctx.beginPath();
      for (var ci = 0; ci < CB.length; ci++) {
        var bx = cc2[ci * 3], bz = cc2[ci * 3 + 2];
        var byy = this.model.ground.y;
        var rr = 0.95;
        for (var q3 = 0; q3 <= 12; q3++) {
          var aa = q3 / 12 * Math.PI * 2;
          var sx = bx + Math.cos(aa) * rr * 1.15 + offX * 0.6;
          var sz = bz + Math.sin(aa) * rr * 0.95 + offZ * 0.6;
          var x1b = sx * cy2 + sz * sy2, z1b = -sx * sy2 + sz * cy2;
          var y2b = byy * cp2 - z1b * sp2, z2b = byy * sp2 + z1b * cp2;
          var db = CAM_DIST - z2b; if (db < 1) db = 1;
          var kb = FOCAL / db * S;
          var Xb = ox + x1b * kb, Yb = oy - y2b * kb;
          if (q3 === 0) ctx.moveTo(Xb, Yb); else ctx.lineTo(Xb, Yb);
        }
        ctx.closePath();
      }
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (layer === 0 && this.model.trees) {
      var TT = this.model.trees, pxx = this.px, pyy = this.py, pzz = this.pz;
      ctx.beginPath();
      for (var ti = 0; ti < TT.length; ti++) {
        var tf = TT[ti], tb = tf.p;
        var tk = FOCAL / Math.max(1, CAM_DIST - pzz[tb]) * this.S;
        var trx = tf.w * tk * 1.05;
        ctx.moveTo(pxx[tb] + trx, pyy[tb]);
        ctx.ellipse(pxx[tb] - trx * 0.35, pyy[tb] + trx * 0.10,
                    trx, trx * 0.34, 0, 0, Math.PI * 2);
      }
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (var s = 0; s < list.length; s++) {
      var sh = list[s];
      if (sh.layer !== layer) continue;
      var kOff = sh.off === undefined ? 1 : sh.off;
      ctx.beginPath();
      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2;
        var x = Math.cos(a) * sh.r + offX * kOff;
        var z = Math.sin(a) * sh.r + offZ * kOff;

        var x1 = x * cy + z * sy;
        var z1 = -x * sy + z * cy;
        var y2 = sh.y * cp - z1 * sp;
        var z2 = sh.y * sp + z1 * cp;
        var d = CAM_DIST - z2; if (d < 1) d = 1;
        var k = FOCAL / d * S;

        var sx = ox + x1 * k, sy2 = oy - y2 * k;
        if (i === 0) ctx.moveTo(sx, sy2); else ctx.lineTo(sx, sy2);
      }
      ctx.closePath();
      ctx.globalAlpha = sh.alpha;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* Обводка линий одним путём.
     front — ближняя половина или дальняя; style — толщина (-1 = любая);
     pass — какой набор дрожания взять. */
  /* Обводка линий одним путём.
     Ребро рисуется тогда, и только тогда, когда хотя бы одна из двух
     граней, сходящихся в нём, смотрит на камеру. Низ дальней стены не
     видит никто — он и не рисуется. Дальний край площадки видно —
     он рисуется. Раньше решали по направлению «наружу от оси», и
     дальние рёбра лезли поверх здания: картинка была прозрачной.

     ВАЖНО про имена переменных: угол поворота лежит в cosY/sinY, а не
     в cy/sy. Раньше здесь была локальная sy для экранной координаты,
     и она затирала синус угла — после первой же линии проверка
     видимости считала мусор. Ровно отсюда и росли полоски. */
  Engine.prototype.strokeGroup = function (style, pass, width, alpha, part) {
    var ctx = this.ctx, m = this.model;
    var lines = m.lines, styles = m.styles, jit = this.jit;
    var parts = m.parts, lfa = m.lfa, lfb = m.lfb, ldir = m.ldir;
    var shells = m.shells;
    var px = this.px, py = this.py;
    var cosY = this.rot.cy, sinY = this.rot.sy;
    var off = pass * 4;

    /* Идём только по линиям своего слоя, а не по всему списку. */
    var idx = (part >= 0 && m.partIndex) ? m.partIndex[part] : null;
    var count = idx ? idx.length : styles.length;

    ctx.beginPath();
    var any = false;
    for (var n = 0; n < count; n++) {
      var i = idx ? idx[n] : n;
      if (style >= 0 && styles[i] !== style) continue;
      if (!idx && part >= 0 && parts[i] !== part) continue;

      var fa = lfa[i], fb = lfb[i], vis;
      if (fa < 0 && fb < 0) {
        // у прямых стен корпуса граней не записано — идём по нормали
        var nx = ldir[i * 2], nz = ldir[i * 2 + 1];
        vis = (nx === 0 && nz === 0) || (-nx * sinY + nz * cosY) > -0.03;
      } else {
        vis = (fa >= 0 && shells[fa].vis) || (fb >= 0 && shells[fb].vis);
      }
      if (!vis) continue;

      var a = lines[i * 2], b = lines[i * 2 + 1];
      var o = i * 12;
      var x1 = px[a] + jit[o + off];
      var y1 = py[a] + jit[o + off + 1];
      var x2 = px[b] + jit[o + off + 2];
      var y2 = py[b] + jit[o + off + 3];

      var ddx = x2 - x1, ddy = y2 - y1;
      var len = Math.sqrt(ddx * ddx + ddy * ddy);
      if (len < 0.001) continue;
      var ux = ddx / len, uy = ddy / len;

      // Перелёт за угол — так рисует рука, а не плоттер
      var e1 = jit[o + 10], e2 = jit[o + 11];
      var ax = x1 - ux * e1, ay = y1 - uy * e1;
      var bx = x2 + ux * e2, by = y2 + uy * e2;

      // Лёгкий изгиб: середина сдвинута поперёк линии
      var bow = jit[o + 8 + pass];
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) * 0.5 - uy * bow, (ay + by) * 0.5 + ux * bow, bx, by);
      any = true;
    }
    if (!any) return;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // ================== запуск ==================

  function boot() {
    var sceneCanvas = document.getElementById('scene');
    var paperCanvas = document.getElementById('paper');
    var stage = document.getElementById('stage');
    var fpsEl = document.getElementById('fps');
    var autoBtn = document.getElementById('autoBtn');
    var resetBtn = document.getElementById('resetBtn');
    var hint = document.getElementById('hint');

    var model = global.Model.build({ ribs: 16, floors: 15 });
    var engine = new Engine(sceneCanvas, paperCanvas, model);

    /* ОТКРЫВАЮЩИЙ КАДР.

       Первое, что видит человек, должно быть готовым кадром, а не
       случайным ракурсом. Вечер, здание сбоку, площадка горит,
       Арарат в стороне — и камера сама медленно идёт вокруг, пока
       её не тронули. Достаточно нажать запись и не касаться экрана. */
    var state = { yaw: 1.42, pitch: 0.27, zoom: 1.02, idle: true };
    var controls = global.Controls.create(stage, state);
    controls.onFirstTouch(function () {
      hint.classList.add('gone');
      state.idle = false;          // человек взял управление — не мешаем
    });

    /* Дрон: медленный облёт с плавным подъёмом и наездом. Не «камера
       летит по маршруту», а спокойный круг — из такого кадра получается
       готовый ролик без единого касания. */
    var droneBtn = document.getElementById('droneBtn');
    var droneT = 0;
    droneBtn.addEventListener('click', function () {
      state.drone = !state.drone;
      droneBtn.setAttribute('aria-pressed', state.drone ? 'true' : 'false');
      toast(state.drone ? 'Облёт включён' : 'Облёт выключен');
      if (state.drone) {
        state.auto = false;
        autoBtn.setAttribute('aria-pressed', 'false');
      }
    });

    autoBtn.addEventListener('click', function () {
      state.auto = !state.auto;
      autoBtn.setAttribute('aria-pressed', state.auto ? 'true' : 'false');
      toast(state.auto ? 'Поворот включён' : 'Поворот выключен');
      if (state.auto) {
        state.drone = false;
        droneBtn.setAttribute('aria-pressed', 'false');
      }
    });
    resetBtn.addEventListener('click', function () {
      resetBtn.classList.remove('tapped');
      void resetBtn.offsetWidth;          // перезапуск анимации
      resetBtn.classList.add('tapped');
      controls.reset();
      toast('Вид сброшен');
      state.idle = false;
      state.auto = false;
      state.drone = false;
      autoBtn.setAttribute('aria-pressed', 'false');
      droneBtn.setAttribute('aria-pressed', 'false');
    });

    var resizeTimer = 0;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { engine.resize(); }, 120);
    }
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);

    // Счётчик кадров. Текст в DOM пишем 4 раза в секунду, а не 60 —
    // каждое обращение к DOM заставляет браузер пересчитывать страницу.
    var last = 0, fpsAvg = 60, fpsClock = 0;

    function frame(now) {
      global.requestAnimationFrame(frame);

      if (!last) { last = now; return; }
      var dt = now - last;
      last = now;
      if (dt > 100) dt = 100;        // вернулись во вкладку — не прыгаем
      if (dt <= 0) return;

      state.time = now * 0.001;
      controls.update(dt);

      if (Math.abs(TOD - todTarget) > 0.0008) {
        TOD += (todTarget - TOD) * Math.min(1, dt * 0.0028);
        refreshTime(false);
      }

      /* Пока экран не тронули, камера едет сама — очень медленно, чтобы
         это читалось как дыхание, а не как карусель. */
      if (state.idle && !state.auto && !state.drone) {
        state.yaw += 0.018 * dt * 0.001;
      }

      if (state.drone) {
        droneT += dt * 0.001;
        state.yaw += 0.085 * dt * 0.001;
        state.pitch = 0.34 + 0.21 * Math.sin(droneT * 0.17);
        state.zoom = 1.04 + 0.30 * Math.sin(droneT * 0.12 + 1.2);
      }
      engine.render(state);

      fpsAvg += (1000 / dt - fpsAvg) * 0.08;
      if (now - fpsClock > 250) {
        fpsClock = now;
        fpsEl.textContent = Math.round(fpsAvg) + ' fps';
        engine.setLod(fpsAvg);      // не тянет — рисуем меньше
      }
    }

    global.requestAnimationFrame(frame);
    var hintEl = global.document.getElementById('hint');
    if (hintEl) hintEl.textContent += ' · сборка ' + BUILD;

    /* Время суток не прыгает за пальцем, а ДОГОНЯЕТ его: солнце
       всходит и садится плавно, тени разворачиваются на глазах. Это
       самая заметная анимация во всей сцене, и стоит она почти ничего.

       Небо при этом пересобирается не каждый кадр, а когда время
       уехало заметно: в нижнем слое лежит зерно бумаги, и перерисовка
       его 60 раз в секунду была бы расточительством. */
    /* ПОЛНОЭКРАННЫЙ РЕЖИМ.

       Кнопка прячет всю панель — кадр остаётся чистым, можно снимать.
       Возврат: короткое касание экрана. Именно короткое: если считать
       любое касание, интерфейс будет выскакивать при каждом повороте
       здания пальцем. Поэтому смотрим, сдвинулся ли палец и сколько
       держали. */
    /* РАДИАЛЬНОЕ МЕНЮ.

       Три состояния, и всегда видно ровно одно: закрыто — кольцо —
       своя панель у пункта. Одна и та же кнопка ведёт назад на шаг:
       из панели в кольцо, из кольца в закрытое. Так на телефоне
       не нужно объяснять, как выйти, — выход всегда в одном месте,
       под большим пальцем.

       Касание сцены закрывает всё: меню не должно мешать смотреть. */
    var hud = document.getElementById('hud');
    var hudBtn = document.getElementById('hudBtn');
    var toastEl = document.getElementById('toast');
    var toastT = 0;
    var mode = '';                       // '' | 'ring' | 'sub'

    /* Пилюля вместо подписей под иконками: говорит, что именно
       включилось, и сама уходит через полторы секунды. */
    function toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastT);
      toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 1600);
    }

    function setMenu(m) {
      mode = m;
      if (m !== 'ring') { clearTimeout(toastT); toastEl.classList.remove('on'); }
      hud.classList.toggle('ring', m === 'ring');
      hud.classList.toggle('sub', m === 'sub');
      document.body.classList.toggle('menu', m !== '');
      hudBtn.setAttribute('aria-expanded', m === '' ? 'false' : 'true');
    }

    hudBtn.addEventListener('click', function () {
      setMenu(mode === 'sub' ? 'ring' : (mode === '' ? 'ring' : ''));
    });

    var weatherBtn = document.getElementById('weatherBtn');
    weatherBtn.addEventListener('click', function () {
      setMenu(mode === 'sub' ? 'ring' : 'sub');
    });

    var hideBtn = document.getElementById('hideBtn');
    var uiOff = false;

    function setUI(off) {
      uiOff = off;
      document.body.classList.toggle('ui-off', off);
      if (off && stage.requestFullscreen) {
        try { stage.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
      } else if (!off && document.fullscreenElement && document.exitFullscreen) {
        try { document.exitFullscreen(); } catch (e) {}
      }
    }
    hideBtn.addEventListener('click', function () { setMenu(''); setUI(true); });

    var tapX = 0, tapY = 0, tapT = 0;
    stage.addEventListener('pointerdown', function (e) {
      tapX = e.clientX; tapY = e.clientY; tapT = Date.now();
      if (mode !== '') setMenu('');
    });
    stage.addEventListener('pointerup', function (e) {
      if (!uiOff) return;
      var moved = Math.abs(e.clientX - tapX) + Math.abs(e.clientY - tapY);
      if (moved < 12 && Date.now() - tapT < 400) setUI(false);
    });

    var timeEl = document.getElementById('tod');
    var todTarget = TOD, lastBaked = -1;

    function refreshTime(force) {
      applyTime(TOD);
      if (force || Math.abs(TOD - lastBaked) > 0.018) {
        engine.drawPaper();
        lastBaked = TOD;
      }
      document.body.classList.toggle('night', NIGHT > 0.45);

      /* Шарик ползунка — само светило: тёплый днём, холодный ночью. */
      var w1 = [253, 226, 150], w2 = [214, 226, 250];
      var kk = Math.min(1, Math.max(0, (TOD - 0.25) / 0.55));
      document.documentElement.style.setProperty('--thumb',
        'rgb(' + ((w1[0] + (w2[0] - w1[0]) * kk) | 0) + ',' +
                 ((w1[1] + (w2[1] - w1[1]) * kk) | 0) + ',' +
                 ((w1[2] + (w2[2] - w1[2]) * kk) | 0) + ')');
      var me = document.getElementById('moon-edge');
      var se = document.getElementById('sun-edge');
      if (me) me.style.opacity = (0.32 + 0.55 * kk).toFixed(2);
      if (se) se.style.opacity = (0.92 - 0.55 * kk).toFixed(2);
    }

    /* Четыре готовых времени суток. Ползунок — для точной настройки,
       а кнопки — для показа: одно нажатие, и картинка уезжает из утра
       в ночь на глазах, потому что TOD догоняет цель плавно. */
    var chips = document.querySelectorAll('#sub .chip');

    function markChips(v) {
      for (var i = 0; i < chips.length; i++) {
        var d = Math.abs(+chips[i].getAttribute('data-v') - v);
        chips[i].setAttribute('aria-pressed', d < 3 ? 'true' : 'false');
      }
    }

    for (var ci = 0; ci < chips.length; ci++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var v = +btn.getAttribute('data-v');
          if (timeEl) timeEl.value = v;
          todTarget = v / 100;
          markChips(v);
        });
      })(chips[ci]);
    }

    if (timeEl) {
      todTarget = timeEl.value / 100;
      TOD = todTarget;
      markChips(+timeEl.value);
      timeEl.addEventListener('input', function () {
        todTarget = timeEl.value / 100;
        markChips(+timeEl.value);
      });
    }
    refreshTime(true);

    global.Kukuruznik = {
      engine: engine, state: state, controls: controls,
      build: BUILD, setTime: applyTime
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
