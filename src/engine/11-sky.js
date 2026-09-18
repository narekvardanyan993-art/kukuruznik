  var SKY_K = 0.42;     // во сколько раз медленнее разворачивается дальний план

  /* МАТЬ АРМЕНИЯ.

     Была гора Арарат — теперь силуэт монумента «Мать Армения» (парк
     Победы), потому что именно он виден на фото «Вид с холма», а не
     Арарат (там его не разглядеть — дымка). Стоит по правую руку и
     чуть позади башни, как на этом фото. Тот же приём дальнего плана,
     что был у горы: сжатый разворот SKY_K, посадка на дальний край
     земли, угловой размер вместо честной геометрии — рисунок, а не
     топография. */
  Engine.prototype.drawMotherArmenia = function () {
    var ctx = this.ctx, w = this.w;
    var yaw = this._yaw || 0, pitch = this._pitch || 0;

    var AZ = -Math.PI / 2 + 1.15;        // тот же азимут, что был у горы
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
    /* Угловой размер. Монумент куда меньше Арарата и не должен спорить
       с башней за кадр — на фото «Вид с холма» это тонкий тёмный штрих
       вдалеке, а не доминанта. */
    var H = 0.052 * F / Math.cos(tt);                // высота над горизонтом

    if (hy < -H * 1.3 || hy > this.h + H) return;
    if (cx < -H * 5 || cx > w + H * 5) return;

    // цвет: днём — дальний тёмно-серый камень в дымке, ночью — силуэт
    function mix(a, b, k) {
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
    var body = mix([120, 122, 128], [30, 32, 46], NIGHT);
    body = mix(body, [150, 128, 126], DUSK * 0.5);
    function rgb(c, a) {
      return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
    }

    /* Силуэт по общей пропорции монумента: высокий гранёный пьедестал
       (около 0.6 общей высоты) и небольшая фигура на нём — плащ,
       плечи, голова, поднятая рука с мечом. Точная антропометрия на
       таком расстоянии и масштабе всё равно не читается — важен
       узнаваемый абрис, не портрет. */
    var gx = cx;
    function P(dx, dy) { return [gx + dx * H, hy - dy * H]; }

    ctx.fillStyle = rgb(body, 0.80);

    // пьедестал — гранёная трапеция
    var pBaseL = P(-0.115, 0), pBaseR = P(0.115, 0);
    var pTopL  = P(-0.072, 0.60), pTopR = P(0.072, 0.60);
    ctx.beginPath();
    ctx.moveTo(pBaseL[0], pBaseL[1]);
    ctx.lineTo(pBaseR[0], pBaseR[1]);
    ctx.lineTo(pTopR[0], pTopR[1]);
    ctx.lineTo(pTopL[0], pTopL[1]);
    ctx.closePath();
    ctx.fill();

    // фигура: плащ книзу чуть шире, плечи, поднятая рука с мечом вправо
    ctx.beginPath();
    ctx.moveTo(P(-0.050, 0.60)[0], P(-0.050, 0.60)[1]);
    ctx.quadraticCurveTo(P(-0.066, 0.76)[0], P(-0.066, 0.76)[1], P(-0.044, 0.84)[0], P(-0.044, 0.84)[1]);
    ctx.lineTo(P(-0.030, 0.905)[0], P(-0.030, 0.905)[1]);
    ctx.quadraticCurveTo(P(0, 0.945)[0], P(0, 0.945)[1], P(0.030, 0.905)[0], P(0.030, 0.905)[1]);
    ctx.lineTo(P(0.044, 0.84)[0], P(0.044, 0.84)[1]);
    ctx.lineTo(P(0.098, 0.875)[0], P(0.098, 0.875)[1]);
    ctx.lineTo(P(0.150, 1.00)[0], P(0.150, 1.00)[1]);
    ctx.lineTo(P(0.120, 1.00)[0], P(0.120, 1.00)[1]);
    ctx.lineTo(P(0.072, 0.855)[0], P(0.072, 0.855)[1]);
    ctx.quadraticCurveTo(P(0.066, 0.76)[0], P(0.066, 0.76)[1], P(0.050, 0.60)[0], P(0.050, 0.60)[1]);
    ctx.closePath();
    ctx.fill();

    var headC = P(0, 0.965);
    ctx.beginPath();
    ctx.arc(headC[0], headC[1], H * 0.026, 0, Math.PI * 2);
    ctx.fill();
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

    /* Дальний план (город и Мать-Армения) рисуется в render() после земли
       и до предметов, чтобы здания естественно закрывали его. */

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

    // 4. облака: медленно плывут по миру, ночью почти гаснут
    /* Тот же приём, что у звёзд и солнца: азимут в мире минус текущий
       yaw даёт угол относительно камеры, а дальше — то же сжатие
       SKY_K и тот же перевод в экранные координаты. Раньше облако
       двигалось по формуле, не знавшей о повороте камеры вовсе —
       отсюда и приклеенность к экрану при повороте. */
    var cl = this.clouds;
    var Fcl = FOCAL * this.S / Math.cos(pitch);
    for (var k = 0; k < cl.length; k++) {
      var c0 = cl[k];
      var thc = c0.th + t * c0.v - yaw + Math.PI / 2;
      while (thc > Math.PI) thc -= Math.PI * 2;
      while (thc < -Math.PI) thc += Math.PI * 2;
      if (Math.cos(thc) <= 0.03) continue;        // за спиной — не рисуем
      var cx = this.ox + Math.tan(thc * SKY_K) * Fcl;
      if (cx < -260 || cx > w + 260) continue;     // далеко за краем — не тратим кадр
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
