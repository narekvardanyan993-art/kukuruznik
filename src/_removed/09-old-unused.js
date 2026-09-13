/* УДАЛЕНО из сборки: старые drawSign и drawCityGlow.
   Ниже по файлу были ВТОРЫЕ определения этих же функций, они
   перекрывали эти. То есть этот код никогда не выполнялся.
   Лежит здесь на случай, если из него что-то понадобится. */

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
