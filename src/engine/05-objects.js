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
  /* Деревья. Скетч-стиль: 4 разных силуэта (кипарисы, лиственные, округлые, кусты),
     текстурный ствол с ветвлением, мягкая тень на траве, штриховка тушью в тени. */
  Engine.prototype.drawOneTree = function (f) {
    var ctx = this.ctx, pz = this.pz, px = this.px, py = this.py;
    var b = f.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * this.S;
    var x = px[b], y = py[b];

    // Мягкое пятно тени на земле под деревом
    ctx.beginPath();
    var gsw = f.w * k * 0.95, gsh = gsw * 0.32;
    ctx.ellipse(x - gsw * 0.20, y + 1.2, gsw, gsh, 0, 0, Math.PI * 2);
    ctx.fillStyle = C_SHADOW;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Ствол с лёгким ветвлением
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + f.lean * k * 0.5, y - f.h * k * 0.58);
    if (f.kind === 1 || f.kind === 2) {
      ctx.moveTo(x + f.lean * k * 0.25, y - f.h * k * 0.30);
      ctx.lineTo(x + f.lean * k * 0.50 + f.w * k * 0.22, y - f.h * k * 0.44);
    }
    ctx.strokeStyle = C_TRUNK;
    ctx.lineWidth = Math.max(1.1, k * 0.020);
    ctx.stroke();

    // Основная масса кроны
    ctx.beginPath();
    this.crownPath(f, 1);
    ctx.fillStyle = f.tone ? C_TREE_B : C_TREE_A;
    ctx.fill();

    // Теневая долька
    ctx.beginPath();
    this.crownPath(f, 2);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = C_TREE_DRK;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Архитектурная штриховка тушью в тени (карандашный скетч-стиль)
    var ph = f.wob[0] * 12.7;
    var cx = x + f.lean * k;
    var cy = y - f.h * k * 0.74;
    var rx = f.w * k, ry = f.h * k * 0.40;
    var hx0 = cx, hx1 = cx + rx * 0.85;
    var hy0 = cy - ry * 0.20, hy1 = cy + ry * 0.75;
    var nHatch = f.kind === 0 ? 5 : 4;
    ctx.beginPath();
    for (var hk = 0; hk < nHatch; hk++) {
      var hu = hk / (nHatch - 1);
      var sx = hx0 + (hx1 - hx0) * hu;
      var sy = hy0 + (hy1 - hy0) * hu;
      var hLen = rx * 0.40;
      ctx.moveTo(sx - hLen * 0.6, sy - hLen * 0.6);
      ctx.lineTo(sx + hLen * 0.6, sy + hLen * 0.6);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.7, k * 0.008);
    ctx.globalAlpha = 0.32;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Контур кроны тушью
    ctx.beginPath();
    this.crownPath(f, 1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.85, k * 0.013);
    ctx.globalAlpha = 0.72;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* Контур кроны по типам:
     0 — стройный пирамидальный кипарис/тополь
     1 — раскидистое лиственное дерево (облачная крона)
     2 — компактное округлое дерево
     3 — стелющийся низкий кустарник */
  Engine.prototype.crownPath = function (f, mode) {
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var b = f.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[b]) * this.S;

    var ph2 = f.wob[0] * 12.7 + f.wob[3] * 5.1;
    var sway = Math.sin(this.time * 0.62 + ph2) * k * 0.030
             + Math.sin(this.time * 1.35 + ph2 * 1.7) * k * 0.012;
    var cx = px[b] + f.lean * k + sway;
    var cy = py[b] - f.h * k * 0.74;
    var breath = 1 + Math.sin(this.time * 0.5 + f.wob[1] * 8.1) * 0.022;
    var rx = f.w * k * breath, ry = f.h * k * 0.40 * (2 - breath);
    if (mode === 2) { cx += rx * 0.28; cy += ry * 0.16; rx *= 0.78; ry *= 0.78; }

    var kind = f.kind || 0;
    if (kind === 0) {
      // Пирамидальный кипарис / тополь
      var topY = cy - ry * 1.25, botY = cy + ry * 1.15;
      var midY = cy + ry * 0.10;
      var wL = rx * 0.95 * f.wob[2], wR = rx * 0.95 * f.wob[5];
      ctx.moveTo(cx, topY);
      ctx.bezierCurveTo(cx + wR * 0.5, topY + ry * 0.5,
                        cx + wR, midY - ry * 0.3,
                        cx + wR, midY);
      ctx.bezierCurveTo(cx + wR * 0.9, midY + ry * 0.6,
                        cx + wR * 0.3, botY,
                        cx, botY);
      ctx.bezierCurveTo(cx - wL * 0.3, botY,
                        cx - wL * 0.9, midY + ry * 0.6,
                        cx - wL, midY);
      ctx.bezierCurveTo(cx - wL, midY - ry * 0.3,
                        cx - wL * 0.5, topY + ry * 0.5,
                        cx, topY);
      ctx.closePath();
      return;
    }

    if (kind === 1) {
      // Широкое лиственное дерево: трёхлопастной облачный контур
      var r0 = rx * 0.65, r1 = rx * 0.60, r2 = rx * 0.72;
      var c0x = cx,                  c0y = cy - ry * 0.35;
      var c1x = cx - rx * 0.45,      c1y = cy + ry * 0.25;
      var c2x = cx + rx * 0.45,      c2y = cy + ry * 0.22;
      ctx.moveTo(c0x, c0y - r0 * 1.05);
      ctx.bezierCurveTo(c0x + r0 * 1.1, c0y - r0 * 0.9, c2x + r2 * 0.6, c2y - r2 * 0.9, c2x + r2, c2y);
      ctx.bezierCurveTo(c2x + r2 * 1.1, c2y + r2 * 0.9, c0x + r0 * 0.4, cy + ry * 1.05, cx, cy + ry * 1.05);
      ctx.bezierCurveTo(c0x - r0 * 0.4, cy + ry * 1.05, c1x - r1 * 1.1, c1y + r1 * 0.9, c1x - r1, c1y);
      ctx.bezierCurveTo(c1x - r1 * 0.9, c1y - r1 * 0.9, c0x - r0 * 1.1, c0y - r0 * 0.9, c0x, c0y - r0 * 1.05);
      ctx.closePath();
      return;
    }

    // Округлая крона (kind 2 и 3): органический контур с дрожанием
    var ptsCount = 12;
    var X = this.crX || (this.crX = new Float32Array(12));
    var Y = this.crY || (this.crY = new Float32Array(12));
    for (var i = 0; i < ptsCount; i++) {
      var a = (i / ptsCount) * Math.PI * 2;
      var w = f.wob[i] || 1;
      X[i] = cx + Math.cos(a) * rx * w;
      Y[i] = cy + Math.sin(a) * ry * w * (kind === 3 ? 0.70 : 1.0);
    }
    ctx.moveTo((X[ptsCount - 1] + X[0]) * 0.5, (Y[ptsCount - 1] + Y[0]) * 0.5);
    for (var i = 0; i < ptsCount; i++) {
      var j = (i + 1) % ptsCount;
      ctx.quadraticCurveTo(X[i], Y[i], (X[i] + X[j]) * 0.5, (Y[i] + Y[j]) * 0.5);
    }
    ctx.closePath();
  };

  /* Нижний корпус. */
  Engine.prototype.drawHall = function () {
    this.fillShells('hall',      C_HALL);
    this.fillShells('hallGlass', C_WIN_DRK);
    this.fillShells('slab',      C_SLAB);
    this.hatch('hall');
    this.strokeBody(4);
    this.drawOutline(4);
  };

  /* Длинное прямоугольное крыло с аркадой. */
  Engine.prototype.drawWing = function () {
    this.fillShells('wing',     C_HALL);
    this.drawCells(5);
    this.fillShells('wingCorn', C_SLAB);
    this.fillShells('wingSlab', C_SLAB);
    this.fillShells('wingTop',  C_DECK);
    this.fillShells('wingRail', C_SLAB);
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
