/* engine.js — движок.
   Математика 3D, проекция на экран и вся отрисовка на canvas 2D.
   Главный принцип производительности: за кадр не создаём объектов,
   не трогаем DOM и сводим всё к десятку вызовов stroke()/fill().
   Тысяча коротких stroke() убьёт айфон, десяток длинных — нет. */

(function (global) {
  'use strict';

  var PAPER = '#f5ecda';
  var INK   = '#2f2a25';

  /* Краска поверх рисунка. Каждый цвет — один слой, одна заливка.
     Цвета взяты с фотографий: тёплый травертин стен, серый базальт
     стилобата, зеленоватое остекление ресторана, трава вокруг.

     Наружные поверхности намеренно НЕПРОЗРАЧНЫЕ. Полупрозрачные
     стены давали рентген: сквозь башню просвечивала её же изнанка,
     и сверху казалось, что здание пустое. */
  var C_TREE_A   = 'rgb(146, 166, 108)';   // крона на свету
  var C_TREE_B   = 'rgb(126, 150, 100)';   // второй оттенок, чтобы не было ковра
  var C_TREE_DRK = 'rgb(96, 116, 78)';     // теневая половина кроны
  var C_TRUNK    = 'rgb(104, 90, 72)';
  var C_GROUND     = 'rgb(190, 200, 148)';  // трава вблизи
  var C_GROUND_FAR = 'rgb(214, 214, 180)';  // она же вдали, съеденная воздухом
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

  var CAM_DIST = 14;    // камера стоит на этом расстоянии
  var FOCAL    = 10;    // «фокусное»: больше — меньше перспективы
  var MAX_DPR  = 2;     // выше 2 нет смысла, только жрёт пиксели

  // Свет: слева сверху и немного спереди
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
    var dpr = Math.min(global.devicePixelRatio || 1, MAX_DPR);
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
  };

  /* Текстура бумаги. Рисуется один раз на ресайз, лежит отдельным слоем
     под сценой. Каждый кадр её не трогаем — это и есть экономия. */
  Engine.prototype.drawPaper = function () {
    var c = this.paperCtx, w = this.w, h = this.h;
    var TAU = Math.PI * 2;

    c.fillStyle = PAPER;
    c.fillRect(0, 0, w, h);

    // Небо: акварельная заливка сверху, к горизонту сходит на нет.
    // Всё это рисуется один раз на ресайз и кадру не стоит ничего.
    /* Небо не однотонное: сверху густая синь, а у горизонта воздух
       теплеет и светлеет. Эта тёплая полоса внизу — то, из-за чего
       небо перестаёт выглядеть заливкой и начинает выглядеть небом. */
    var horizon = h * 0.72;
    var sky = c.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0.00, 'rgba(96, 142, 186, 0.60)');
    sky.addColorStop(0.42, 'rgba(142, 180, 206, 0.34)');
    sky.addColorStop(0.76, 'rgba(214, 200, 172, 0.20)');
    sky.addColorStop(1.00, 'rgba(226, 206, 168, 0.00)');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, horizon);

    // Облака. Все овалы одного облака — в одном пути и одна заливка,
    // иначе на перекрытиях полезут швы от прозрачности.
    var rc = seeded(91);
    for (var k = 0; k < 4; k++) {
      var cx = w * (0.06 + rc() * 0.88);
      var cy = h * (0.04 + rc() * 0.26);
      var sc = Math.min(w, h) * (0.045 + rc() * 0.045);
      // Два прохода: широкий и очень бледный снизу, поплотнее сверху.
      // От этого у облака мягкий край, а не наклейка.
      for (var q = 0; q < 2; q++) {
        var e = q === 0 ? 1.28 : 1.0;
        c.fillStyle = q === 0 ? 'rgba(252, 252, 248, 0.22)'
                              : 'rgba(255, 254, 250, 0.42)';
        c.beginPath();
        puff(c, cx, cy, sc * e, 1.00, 0.38, TAU);
        puff(c, cx - sc * 0.60, cy + sc * 0.13, sc * e, 0.50, 0.26, TAU);
        puff(c, cx + sc * 0.64, cy + sc * 0.11, sc * e, 0.54, 0.28, TAU);
        puff(c, cx + sc * 0.10, cy - sc * 0.19, sc * e, 0.44, 0.29, TAU);
        c.fill();
      }
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

    // земля
    this.drawGround();     // заливка и контур земли — одной гладкой кривой
    this.drawShadows(0);   // тень здания на земле
    this.drawTrees(false); // дальняя роща — за зданием

    // стилобат и лестница
    this.fillShells('podium',  C_PODIUM);
    this.fillShells('deck',    C_DECK);
    this.hatch();
    this.strokeBody(3);
    this.drawShadows(1);   // тень башни на террасе — уже поверх террасы

    /* Нижний корпус стоит сбоку, а не сверху, поэтому очередь у него
       плавающая: если он дальше башни — рисуем до неё, если ближе —
       после. Глубину берём по его центру. */
    var hc = m.hallCenter;
    var hz = (-hc[0] * r.sy + hc[2] * r.cy) * r.cp + hc[1] * r.sp;
    if (hz < 0) this.drawHall();

    var wc = m.wingCenter;
    var wz = (-wc[0] * r.sy + wc[2] * r.cy) * r.cp + wc[1] * r.sp;
    if (wz < 0) this.drawWing();

    /* У ствола дальних линий нет вовсе: стена непрозрачная, изнанку
       башни видеть неоткуда, а рисовались они как мусор на фасаде. */
    this.fillShells('shaft',   C_SHAFT);
    this.fillShaftShade();
    this.drawCells();
    this.fillShells('rail',    C_RAIL);
    this.strokeBody(0);

    // тарелка
    this.fillShells('neck',    C_NECK);
    this.fillShells('flare',   C_FLARE);
    this.fillShells('glass',   C_GLASS);
    this.fillShells('parapet', C_PARAPET);
    this.fillShells('roof',    C_ROOF);
    this.strokeBody(1);

    if (hz >= 0) this.drawHall();   // корпус ближе башни — ложится поверх
    if (wz >= 0) this.drawWing();

    this.drawTrees(true);  // ближняя роща — перед зданием
    this.drawAir();       // воздух поверх массы — он касается и линий
    this.drawOutline();   // жирный край — последним, поверх всего
    ctx.globalAlpha = 1;
  };

  /* Деревья. Два захода: дальние ложатся до здания, ближние — после.
     Всё сводится к пяти заливкам на всю рощу, а не к пяти на дерево. */
  Engine.prototype.drawTrees = function (near) {
    var ctx = this.ctx, T = this.model.trees;
    var px = this.px, py = this.py, pz = this.pz, S = this.S;
    if (!T || !T.length) return;

    var list = this.treeBuf || (this.treeBuf = []);
    list.length = 0;
    for (var i = 0; i < T.length; i++) {
      var f = T[i];
      if ((pz[f.p] > 0) !== !!near) continue;
      list.push(f);
    }
    if (!list.length) return;

    /* Кроны перекрывают друг друга, поэтому роща рисуется по одному
       дереву от дальнего к ближнему. Пакетная заливка была дешевле, но
       обводки дальних крон просвечивали сквозь ближние и роща
       превращалась в клубок линий. */
    list.sort(function (a, b) { return pz[a.p] - pz[b.p]; });

    ctx.lineJoin = 'round';
    for (var i = 0; i < list.length; i++) {
      var f = list[i], b = f.p;
      var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * S;
      var x = px[b], y = py[b];

      // ствол
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + f.lean * k * 0.5, y - f.h * k * 0.62);
      ctx.strokeStyle = C_TRUNK;
      ctx.lineWidth = Math.max(1, k * 0.020);
      ctx.stroke();

      // крона: заливка, теневая долька, обводка тушью
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
    }
  };

  /* Контур кроны: десятиугольник с заранее заданной неровностью.
     mode 2 — теневая долька: та же форма, сдвинутая от света. */
  Engine.prototype.crownPath = function (f, mode) {
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var b = f.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * this.S;
    var cx = px[b] + f.lean * k;
    var cy = py[b] - f.h * k * 0.74;
    var rx = f.w * k, ry = f.h * k * 0.40;
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
    var widths = [0.75, 1.25, 1.9];
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

    for (var i = 0; i < n; i++) {
      var j = i * 3;
      var x = pos[j], y = pos[j + 1], z = pos[j + 2];

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
  Engine.prototype.drawAir = function () {
    var ctx = this.ctx, shells = this.model.shells;
    var px = this.px, py = this.py;
    var top = this.topPy, bot = this.botPy;
    if (!(bot > top + 1)) return;

    var g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0.00, 'rgba(148, 178, 210, 0.08)');
    g.addColorStop(0.34, 'rgba(148, 178, 210, 0.00)');
    g.addColorStop(0.74, 'rgba(56, 66, 104, 0.05)');
    g.addColorStop(1.00, 'rgba(46, 55, 92, 0.13)');

    ctx.beginPath();
    var any = false;
    for (var i = 0; i < shells.length; i++) {
      var f = shells[i];
      if (!f.vis) continue;
      ctx.moveTo(px[f.a], py[f.a]);
      ctx.lineTo(px[f.b], py[f.b]);
      ctx.lineTo(px[f.c], py[f.c]);
      ctx.lineTo(px[f.d], py[f.d]);
      ctx.closePath();
      any = true;
    }
    if (any) { ctx.fillStyle = g; ctx.fill(); }
  };

  /* Для каждой грани и чешуйки: смотрит ли на камеру и насколько на свету */
  Engine.prototype.classify = function () {
    var r = this.rot;
    var cy = r.cy, sy = r.sy, cp = r.cp, sp = r.sp;

    /* thr — насколько грань должна повернуться к нам, чтобы её рисовать.
       Для стен хватает почти нуля. Для лоджий порог выше: у самого края
       башни они видны под таким углом, что в жизни их закрывает ребро,
       а на экране от них остаётся вытянутая клякса. */
    function pass(list, thr) {
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        var nx1 = f.nx * cy + f.nz * sy;
        var nz1 = -f.nx * sy + f.nz * cy;
        var ny2 = f.ny * cp - nz1 * sp;
        var nz2 = f.ny * sp + nz1 * cp;
        f.vis = nz2 > thr;
        f.lit = nx1 * LX + ny2 * LY + nz2 * LZ;
      }
    }
    pass(this.model.shells, 0.015);
    pass(this.model.cells, 0.13);
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
  Engine.prototype.fillShells = function (kind, color) {
    var ctx = this.ctx, shells = this.model.shells;
    var px = this.px, py = this.py;
    var any = false;

    ctx.beginPath();
    for (var i = 0; i < shells.length; i++) {
      var f = shells[i];
      if (f.kind !== kind || !f.vis) continue;
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

    // 3. балконы — поверх проёмов, они и вправду выступают вперёд
    for (var pass = 0; pass < 2; pass++) {
      var any2 = false;
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var f = cells[i];
        if (!f.vis || (f.grp || 0) !== grp || f.arch) continue;
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
  Engine.prototype.drawOutline = function () {
    var ctx = this.ctx, o = this.model.outline, shells = this.model.shells;
    var px = this.px, py = this.py, jit = this.outJit;
    var n = o.length / 4, any = false;

    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var k = i * 4;
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
    var count = styles.length;
    var off = pass * 4;

    ctx.beginPath();
    var any = false;
    for (var i = 0; i < count; i++) {
      if (style >= 0 && styles[i] !== style) continue;
      if (part >= 0 && parts[i] !== part) continue;

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

    var state = {};
    var controls = global.Controls.create(stage, state);
    controls.onFirstTouch(function () { hint.classList.add('gone'); });

    autoBtn.addEventListener('click', function () {
      state.auto = !state.auto;
      autoBtn.setAttribute('aria-pressed', state.auto ? 'true' : 'false');
    });
    resetBtn.addEventListener('click', function () {
      controls.reset();
      state.auto = false;
      autoBtn.setAttribute('aria-pressed', 'false');
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

      controls.update(dt);
      engine.render(state);

      fpsAvg += (1000 / dt - fpsAvg) * 0.08;
      if (now - fpsClock > 250) {
        fpsClock = now;
        fpsEl.textContent = Math.round(fpsAvg) + ' fps';
      }
    }

    global.requestAnimationFrame(frame);
    global.Kukuruznik = { engine: engine, state: state, controls: controls };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
