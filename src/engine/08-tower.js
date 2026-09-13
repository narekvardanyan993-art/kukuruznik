  Engine.prototype.drawPodium = function () {
    this.fillShells('podium', C_PODIUM);
    this.fillShells('deck',   C_DECK);
    this.drawCells(3);
    this.hatch();
    this.strokeBody(3);
    this.drawOutline(3);
    this.drawShadows(1);
  };

  // Ствол и тарелка
  Engine.prototype.drawTower = function () {
    this.fillShells('shaft',   C_SHAFT);
    this.fillShaftShade();
    this.drawCells();
    this.fillShells('rail',    C_RAIL);
    this.strokeBody(0);

    this.fillShells('neck',    C_NECK);
    this.fillShells('flare',   C_FLARE);
    this.drawGlassBand();
    /* Силуэты сидящих сняты по просьбе владельца: на телефоне головы
       читались пятнами, а не людьми. Сама функция drawCafe оставлена —
       вернуть её можно одной строкой, когда придумаем, как их рисовать.
       Вращение барабана от этого не зависит: его держит цветной узор
       панелей. */
    this.fillShells('parapet', C_PARAPET);
    this.fillShells('roof',    C_ROOF);
    this.strokeBody(1);
    this.drawOutline(0);
    this.drawOutline(1);
  };

  /* Проекция одной точки на лету. Нужна тем, кто двигается: массив
     positions считается один раз на всю модель, а люди ходят. */
  Engine.prototype.proj = function (x, y, z, o) {
    var r = this.rot;
    var x1 = x * r.cy + z * r.sy;
    var z1 = -x * r.sy + z * r.cy;
    var y2 = y * r.cp - z1 * r.sp;
    var z2 = y * r.sp + z1 * r.cp;
    var d = CAM_DIST - z2; if (d < 1) d = 1;
    var k = FOCAL / d * this.S;
    o.x = this.ox + x1 * k;
    o.y = this.oy - y2 * k;
    o.k = k; o.z = z2;
    return o;
  };

  /* Флаги. Полотнище — волна от времени: живое движение, которое не
     выглядит зациклённым, потому что у каждого флага своя фаза. */

  /* ОСТЕКЛЕНИЕ КАФЕ — ПАНЕЛЬ ЗА ПАНЕЛЬЮ.

     Однотонное кольцо стекла не даёт понять, что барабан вращается:
     глазу не за что зацепиться. Поэтому каждая панель красится своим
     оттенком — чередование тёмного и светлого плюс несколько «тёплых»,
     где горит свет. Узор едет вместе с барабаном, и вращение читается
     сразу, даже на неподвижном кадре в ленте.

     Днём это блики на стекле, ночью — залы с разным светом. */
  Engine.prototype.drawGlassBand = function () {
    var ctx = this.ctx, m = this.model;
    var idx = m.shellIndex && m.shellIndex['glass'];
    if (!idx) return;
    var px = this.px, py = this.py, shells = m.shells;
    var base = parseCol(C_GLASS);

    for (var q = 0; q < idx.length; q++) {
      var f = shells[idx[q]];
      if (!f.vis) continue;
      var i = f.idx || 0;

      /* Узор. Ночью весь барабан уходит в тёплый, и однотонное кольцо
         снова не даёт понять, что оно едет. Поэтому часть залов гасим:
         две панели из трёх горят, третья тёмная. Бегущая цепочка
         «свет-свет-темно» читается мгновенно. */
      var dark = (i % 3) === 1;
      var light = (i % 2) === 0 ? 1.13 : 0.89;
      var r = base[0] * light, g = base[1] * light, b = base[2] * light;

      if (dark) {
        var d = 0.34 + 0.42 * NIGHT;                 // ночью контраст резче
        r += (34 - r) * d; g += (40 - g) * d; b += (58 - b) * d;
      } else if ((i % 5) === 2) {
        var w = 0.30 + 0.30 * NIGHT;                 // особенно яркий зал
        r += (250 - r) * w; g += (222 - g) * w; b += (150 - b) * w;
      }
      // блик от солнца: панель, повёрнутая к свету, ярче
      var sh = 0.86 + 0.30 * Math.max(0, f.lit);
      ctx.beginPath();
      ctx.moveTo(px[f.a], py[f.a]);
      ctx.lineTo(px[f.b], py[f.b]);
      ctx.lineTo(px[f.c], py[f.c]);
      ctx.lineTo(px[f.d], py[f.d]);
      ctx.closePath();
      ctx.fillStyle = 'rgb(' + ((r * sh) | 0) + ',' + ((g * sh) | 0) + ',' + ((b * sh) | 0) + ')';
      ctx.fill();
    }
  };

  /* ВРАЩАЮЩЕЕСЯ КАФЕ.

     Наверху башни было вращающееся кафе — оно и делало здание тем, чем
     оно было: люди поднимались туда смотреть на Арарат, и зал медленно
     поворачивался. Значит, крутиться должен не колпак, а то, что внутри.

     Силуэты сидящих идут по кольцу за остеклением. Каждый виден ровно
     тогда, когда его место повёрнуто к нам — та же проверка, что и у
     граней. Оборот примерно за минуту: в жизни медленнее, но на экране
     нужно, чтобы движение читалось. */
  Engine.prototype.drawCafe = function () {
    var cf = this.model.cafe;
    if (!cf) return;
    var ctx = this.ctx, r = this.rot, t = this.time;
    var o = this._co || (this._co = {});
    var N = 18, spin = this.spin || 0;   // тот же угол, что и у самого барабана

    var shapes = 0;
    ctx.beginPath();
    for (var i = 0; i < N; i++) {
      var a = spin + (i / N) * Math.PI * 2;
      var nx = Math.cos(a), nz = Math.sin(a);
      // повёрнуто ли место к нам
      var nx1 = nx * r.cy + nz * r.sy;
      var nz1 = -nx * r.sy + nz * r.cy;
      var nz2 = nz1 * r.cp;
      /* Порог выше, чем у граней: у самого края барабана силуэт виден
         под таким углом, что в жизни его закрывает стойка остекления,
         а на экране он выглядел приклеенным сбоку. */
      if (nz2 < 0.34) continue;

      this.proj(nx * cf.r, cf.y, nz * cf.r, o);
      var k = o.k;
      var hh = k * 0.085;
      var wd = k * 0.040;

      // плечи
      ctx.moveTo(o.x - wd, o.y + hh * 0.30);
      ctx.quadraticCurveTo(o.x, o.y - hh * 0.20, o.x + wd, o.y + hh * 0.30);
      ctx.lineTo(o.x - wd, o.y + hh * 0.30);
      // голова
      ctx.moveTo(o.x + wd * 0.52, o.y - hh * 0.38);
      ctx.arc(o.x, o.y - hh * 0.38, wd * 0.52, 0, Math.PI * 2);
      shapes++;
    }
    if (!shapes) return;
    ctx.fillStyle = NIGHT > 0.35 ? 'rgba(74, 52, 30, 0.80)' : 'rgba(38, 42, 48, 0.55)';
    ctx.fill();
  };

  /* Надпись на фасаде. Текст раскладывается по четырём точкам плиты,
     поэтому он поворачивается вместе со зданием, а не висит наклейкой
     поверх экрана. */
