  Engine.prototype.drawOneCity = function (bi) {
    this.fillShells('city', C_CITY, bi);

    /* Раньше окна ВСЕХ соседних домов грели одним и тем же глобальным
       цветом сразу — то же "один рубильник на весь квартал", что было
       у самой башни. Теперь у каждого дома свой порог включения
       (тот же приём, что у окон башни и у фонарей) и свой медленный
       пульс — квартал зажигается постепенно, дом за домом. */
    var bnd = C_CITY_BND;
    if (NIGHT > 0.08) {
      var cb = this.model.city[bi];
      var seed = (cb && typeof cb.lamp === 'number') ? cb.lamp : 0.5;
      var onset = 0.12 + seed * 0.34;
      var amt = Math.min(1, Math.max(0, (NIGHT - onset) / 0.16)) * 0.85;
      var pulse = amt > 0 ? (1 + 0.06 * Math.sin(this.time * 0.7 + seed * 22)) : 1;
      bnd = lamp(B.CITY_BND, Math.min(1, Math.max(0, amt * pulse)));
    }
    this.fillShells('cityBand', bnd, bi);

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
    this.fillShells('hall',      C_HALL);
    this.fillShells('hallGlass', C_WIN_DRK);
    this.fillShells('slab',      C_SLAB);
    this.hatch('hall');
    this.strokeBody(4);
    this.drawOutline(4);
  };

  /* Длинное низкое крыло с аркадой. Своя очередь, как и у корпуса:
     оно стоит сбоку от башни, а не над ней. */
  Engine.prototype.drawWing = function () {
    this.fillShells('wing',     C_HALL);
    this.drawCells(5);
    this.fillShells('wingCorn', C_SLAB);
    this.fillShells('wingSlab', C_SLAB);
    this.fillShells('wingTop',  C_DECK);
    this.fillShells('wingRail', C_SLAB);
    /* Задний этаж-уступ — ПОСЛЕ террасы и бортика (wingTop/wingRail),
       иначе плита террасы закрашивает его стены и оставляет один каркас! */
    this.fillShells('wingUp',     C_HALL);
    this.fillShells('wingUpCorn', C_SLAB);
    this.fillShells('wingUpTop',  C_DECK);
    this.hatch('wing');
    this.strokeBody(5);
    this.drawOutline(5);
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
