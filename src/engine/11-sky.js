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
      /* Те же азимутальные координаты и то же сжатие SKY_K, что у
         солнца и силуэта города: звёзды стоят в мире, а не приклеены
         к экрану, и разворачиваются вместе со всем дальним планом. */
      var stars0 = this.stars;
      var Fst = FOCAL * this.S / Math.cos(pitch);
      ctx.fillStyle = 'rgba(255, 252, 236, ' + (0.85 * NIGHT).toFixed(3) + ')';
      for (var s0 = 0; s0 < stars0.length; s0 += 3) {
        var th0 = stars0[s0] - yaw + Math.PI / 2;
        while (th0 > Math.PI) th0 -= Math.PI * 2;
        while (th0 < -Math.PI) th0 += Math.PI * 2;
        if (Math.cos(th0) <= 0.05) continue;      // за спиной
        var sxx = this.ox + Math.tan(th0 * SKY_K) * Fst;
        if (sxx < -8 || sxx > w + 8) continue;
        var tw0 = 0.65 + 0.35 * Math.sin(t * 1.7 + stars0[s0 + 2]);
        var rr0 = stars0[s0 + 2] % 1 * 0.9 + 0.5;
        ctx.globalAlpha = tw0;
        ctx.fillRect(sxx, stars0[s0 + 1] * horizon, rr0, rr0);
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
