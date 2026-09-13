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

