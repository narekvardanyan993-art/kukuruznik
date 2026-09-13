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
