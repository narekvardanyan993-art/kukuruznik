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
