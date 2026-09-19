
  /* Скамейки. Сиденье и две ножки, все разом одним путём. */

  /* Фонари. Днём — тонкая мачта с опорой и плафоном, ночью — тёплый свет. */
  Engine.prototype.drawOneLamp = function (i) {
    var L = this.model.lamps[i];
    if (!L) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var tp = L.t, bp = L.b;
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

    var headR = Math.max(2.0, k * 0.024);
    var baseW = Math.max(2.4, k * 0.026);

    // Опора/цоколь на земле
    ctx.beginPath();
    ctx.moveTo(px[bp] - baseW, py[bp]);
    ctx.lineTo(px[bp] + baseW, py[bp]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.4, this.S * 0.013);
    ctx.stroke();

    // Мачта
    ctx.beginPath();
    ctx.moveTo(px[bp], py[bp]);
    ctx.lineTo(px[tp], py[tp]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.0, this.S * 0.009);
    ctx.stroke();

    // Плафон светильника
    ctx.beginPath();
    ctx.arc(px[tp], py[tp] - headR * 0.3, headR, 0, Math.PI * 2);
    ctx.fillStyle = NIGHT > 0.2 ? 'rgb(255, 226, 164)' : '#dedad0';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, this.S * 0.006);
    ctx.stroke();

    // Колпак фонаря сверху
    ctx.beginPath();
    ctx.moveTo(px[tp] - headR * 1.3, py[tp] - headR * 0.8);
    ctx.lineTo(px[tp] + headR * 1.3, py[tp] - headR * 0.8);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.2, this.S * 0.009);
    ctx.stroke();
  };

  /* Скамейки в скетч-стиле: сиденье и спинка из деревянных реек, чугунные опоры. */
  Engine.prototype.drawOneBench = function (i) {
    var b = this.model.benches && this.model.benches[i];
    if (!b) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var p = b.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[p]) * this.S;
    if (k < 1.5) return;
    var x = px[p], y = py[p];
    var bw = b.w * k, bh = b.h * k;

    // Мягкая контактная тень на покрытии
    ctx.beginPath();
    ctx.ellipse(x, y + 0.6, bw * 0.52, bw * 0.14, 0, 0, Math.PI * 2);
    ctx.fillStyle = C_SHADOW;
    ctx.globalAlpha = 0.24;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Чугунные боковые ножки
    var legW = bw * 0.38;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.9, k * 0.011);
    ctx.beginPath();
    // Левая ножка со спинкой
    ctx.moveTo(x - legW, y);
    ctx.lineTo(x - legW, y - bh * 0.45);
    ctx.lineTo(x - legW - bw * 0.06, y - bh);
    ctx.moveTo(x - legW + bw * 0.08, y);
    ctx.lineTo(x - legW, y - bh * 0.45);
    // Правая ножка со спинкой
    ctx.moveTo(x + legW, y);
    ctx.lineTo(x + legW, y - bh * 0.45);
    ctx.lineTo(x + legW - bw * 0.06, y - bh);
    ctx.moveTo(x + legW + bw * 0.08, y);
    ctx.lineTo(x + legW, y - bh * 0.45);
    ctx.stroke();

    // Деревянные рейки сиденья
    var plankCol = NIGHT > 0.3 ? 'rgb(108, 92, 78)' : 'rgb(172, 138, 106)';
    ctx.fillStyle = plankCol;
    ctx.fillRect(x - bw * 0.46, y - bh * 0.50, bw * 0.92, bh * 0.15);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.7, k * 0.007);
    ctx.strokeRect(x - bw * 0.46, y - bh * 0.50, bw * 0.92, bh * 0.15);

    // Деревянные рейки спинки
    ctx.fillRect(x - bw * 0.46, y - bh * 0.95, bw * 0.92, bh * 0.20);
    ctx.strokeRect(x - bw * 0.46, y - bh * 0.95, bw * 0.92, bh * 0.20);
  };

  /* Урны в скетч-стиле: каменный/чугунный цилиндр. */
  Engine.prototype.drawOneUrn = function (i) {
    var u = this.model.urns && this.model.urns[i];
    if (!u) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var p = u.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[p]) * this.S;
    if (k < 1.5) return;
    var x = px[p], y = py[p];
    var ur = Math.max(1.8, u.r * k);
    var uh = Math.max(3.2, u.h * k);

    // Тень под урной
    ctx.beginPath();
    ctx.ellipse(x, y + 0.4, ur * 1.1, ur * 0.38, 0, 0, Math.PI * 2);
    ctx.fillStyle = C_SHADOW;
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Корпус урны
    ctx.fillStyle = C_PODIUM;
    ctx.fillRect(x - ur, y - uh, ur * 2, uh);

    // Контур корпуса тушью
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, k * 0.008);
    ctx.strokeRect(x - ur, y - uh, ur * 2, uh);

    // Верхнее отверстие урны
    ctx.beginPath();
    ctx.ellipse(x, y - uh, ur, ur * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.65;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  };

  /* Автомобили 1970-х на подъездной дороге в скетч-стиле:
     Седан («Волга» ГАЗ-24) и автобус/микроавтобус (РАФ-2203 / ПАЗ). */
  Engine.prototype.drawOneCar = function (i) {
    var c = this.model.cars && this.model.cars[i];
    if (!c) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;
    var p = c.p;
    var k = FOCAL / Math.max(1, CAM_DIST - pz[p]) * this.S;
    if (k < 1.2) return;
    var x = px[p], y = py[p];
    var len = c.len * k, hgt = c.hgt * k;
    var dir = c.dir || 1; // 1 = едет направо, -1 = налево

    // Тень под машиной
    ctx.beginPath();
    ctx.ellipse(x, y + 0.8, len * 0.52, len * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = C_SHADOW;
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.globalAlpha = 1;

    var inkW = Math.max(0.8, k * 0.009);
    var colBody = c.col;
    if (NIGHT > 0.2) {
      colBody = tintNight(c.type === 'sedan' ? [84, 118, 128, 1] : [222, 210, 180, 1], [30, 36, 42, 1]);
    }

    ctx.save();
    ctx.translate(x, y);
    if (dir < 0) ctx.scale(-1, 1);

    var wheelR = hgt * 0.23;
    var wFrontX = len * 0.30, wRearX = -len * 0.30;
    var wheelY = -wheelR * 0.7;

    if (c.type === 'sedan') {
      // Нижний пояс кузова
      var bH = hgt * 0.44;
      ctx.beginPath();
      ctx.moveTo(-len * 0.48, 0);
      ctx.lineTo(len * 0.48, 0);
      ctx.lineTo(len * 0.48, -bH);
      ctx.lineTo(-len * 0.48, -bH);
      ctx.closePath();
      ctx.fillStyle = colBody;
      ctx.fill();

      // Кабина («теплица») седана
      var cH = hgt * 0.52;
      ctx.beginPath();
      ctx.moveTo(-len * 0.24, -bH);
      ctx.lineTo(-len * 0.16, -bH - cH);
      ctx.lineTo(len * 0.14, -bH - cH);
      ctx.lineTo(len * 0.26, -bH);
      ctx.closePath();
      ctx.fillStyle = colBody;
      ctx.fill();

      // Окна кабины (тёмные стёкла)
      ctx.beginPath();
      ctx.moveTo(-len * 0.20, -bH - 1);
      ctx.lineTo(-len * 0.13, -bH - cH + 1.5);
      ctx.lineTo(len * 0.11, -bH - cH + 1.5);
      ctx.lineTo(len * 0.22, -bH - 1);
      ctx.closePath();
      ctx.fillStyle = NIGHT > 0.2 ? 'rgb(24, 28, 34)' : C_WIN_DRK;
      ctx.fill();

      // Стойка между окнами (B-pillar)
      ctx.strokeStyle = colBody;
      ctx.lineWidth = Math.max(1.1, k * 0.010);
      ctx.beginPath();
      ctx.moveTo(0, -bH);
      ctx.lineTo(0, -bH - cH + 1);
      ctx.stroke();

      // Контур кузова тушью
      ctx.strokeStyle = INK;
      ctx.lineWidth = inkW;
      ctx.beginPath();
      // Линия крыши и капота
      ctx.moveTo(-len * 0.48, -bH * 0.6);
      ctx.lineTo(-len * 0.48, -bH);
      ctx.lineTo(-len * 0.24, -bH);
      ctx.lineTo(-len * 0.16, -bH - cH);
      ctx.lineTo(len * 0.14, -bH - cH);
      ctx.lineTo(len * 0.26, -bH);
      ctx.lineTo(len * 0.48, -bH);
      ctx.lineTo(len * 0.48, -bH * 0.6);
      ctx.stroke();

      // Фары / фонари
      if (NIGHT > 0.2) {
        ctx.fillStyle = 'rgb(255, 238, 170)';
        ctx.fillRect(len * 0.47, -bH * 0.85, len * 0.03, bH * 0.4);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(len * 0.47, -bH * 0.85, len * 0.02, bH * 0.35);
      }
      ctx.fillStyle = '#d92626';
      ctx.fillRect(-len * 0.49, -bH * 0.85, len * 0.02, bH * 0.35);
    } else {
      // Фургон / автобус РАФ / ПАЗ
      var vH = hgt * 0.90;
      ctx.beginPath();
      ctx.moveTo(-len * 0.48, 0);
      ctx.lineTo(len * 0.44, 0);
      ctx.lineTo(len * 0.48, -vH * 0.4);
      ctx.lineTo(len * 0.42, -vH);
      ctx.lineTo(-len * 0.46, -vH);
      ctx.lineTo(-len * 0.48, -vH * 0.2);
      ctx.closePath();
      ctx.fillStyle = colBody;
      ctx.fill();

      // Ряд боковых окон автобуса
      var winY0 = -vH * 0.50, winY1 = -vH * 0.88;
      ctx.beginPath();
      ctx.moveTo(-len * 0.42, winY0);
      ctx.lineTo(-len * 0.42, winY1);
      ctx.lineTo(len * 0.38, winY1);
      ctx.lineTo(len * 0.44, winY0);
      ctx.closePath();
      ctx.fillStyle = NIGHT > 0.2 ? 'rgb(24, 28, 34)' : C_WIN_DRK;
      ctx.fill();

      // Переплёты окон (3 стойки)
      ctx.strokeStyle = colBody;
      ctx.lineWidth = Math.max(1.2, k * 0.012);
      ctx.beginPath();
      for (var sp = -1; sp <= 1; sp++) {
        var sx = sp * len * 0.18;
        ctx.moveTo(sx, winY0);
        ctx.lineTo(sx, winY1);
      }
      ctx.stroke();

      // Контур автобуса
      ctx.strokeStyle = INK;
      ctx.lineWidth = inkW;
      ctx.strokeRect(-len * 0.46, -vH, len * 0.88, vH);

      // Фара
      ctx.fillStyle = NIGHT > 0.2 ? 'rgb(255, 238, 170)' : '#ffffff';
      ctx.fillRect(len * 0.46, -vH * 0.35, len * 0.025, vH * 0.20);
    }

    // Колёса с хромированными колпаками
    function drawWheel(wx) {
      ctx.beginPath();
      ctx.arc(wx, wheelY, wheelR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(34, 34, 38)';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = inkW * 0.9;
      ctx.stroke();

      // Хромированный колпак в центре
      ctx.beginPath();
      ctx.arc(wx, wheelY, wheelR * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#dedad0';
      ctx.fill();
    }
    drawWheel(wRearX);
    drawWheel(wFrontX);

    ctx.restore();
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

  Engine.prototype.drawBenches = function () {};
  Engine.prototype.drawGalleryPosts = function () {};

  /* Фонари. Днём — тонкая мачта с головкой, ночью ещё и тёплое пятно
     света: без него площадка остаётся чёрной, сколько ни зажигай окон. */
  Engine.prototype.drawLamps = function () {
    var L = this.model.lamps;
    if (!L) return;
    var ctx = this.ctx, px = this.px, py = this.py, pz = this.pz;

    // свет кладём ПОД мачты, иначе он ложится поверх них молочным пятном.
    // У каждого фонаря свой медленный пульс (фаза от индекса) — иначе
    // ровный свет всей площадки выглядит одной застывшей фотографией.
    if (NIGHT > 0.15) {
      var al = Math.min(1, (NIGHT - 0.15) / 0.35);
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < L.length; i++) {
        var tp = L[i].t;
        var k = FOCAL / Math.max(1, CAM_DIST - pz[tp]) * this.S;
        var rr = k * 0.42;
        var alI = al * (1 + 0.08 * Math.sin(this.time * 0.85 + i * 2.1));
        var g = ctx.createRadialGradient(px[tp], py[tp], 0, px[tp], py[tp], rr);
        g.addColorStop(0, 'rgba(255, 214, 140, ' + (0.55 * alI).toFixed(3) + ')');
        g.addColorStop(0.45, 'rgba(255, 200, 120, ' + (0.16 * alI).toFixed(3) + ')');
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
