  Engine.prototype.hatch = function () {
    var ctx = this.ctx, shells = this.model.shells;
    var px = this.px, py = this.py;
    var any = false;

    ctx.beginPath();
    for (var i = 0; i < shells.length; i++) {
      var f = shells[i];
      if (!f.vis) continue;
      if (f.kind !== 'podium') continue;   // на колпаке штрихи читались как мусор
      if (f.lit > 0.08) continue;

      var strength = Math.min(1, (0.08 - f.lit) * 2.0);
      var count = strength > 0.5 ? 3 : 2;

      var ax = px[f.a], ay = py[f.a];
      var bx = px[f.b], by = py[f.b];
      var cx = px[f.c], cy = py[f.c];
      var dx = px[f.d], dy = py[f.d];

      for (var k = 1; k <= count; k++) {
        var t = k / (count + 1);
        var t2 = Math.min(1, t + 0.34);
        ctx.moveTo(ax + (bx - ax) * t, ay + (by - ay) * t);
        ctx.lineTo(dx + (cx - dx) * t2, dy + (cy - dy) * t2);
        any = true;
      }
    }
    if (any) {
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  };

  /* Контур здания.
     Ребро оказывается на силуэте ровно тогда, когда одна из двух
     соседних граней смотрит на камеру, а вторая уже отвернулась.
     Проверка дешёвая, а край получается настоящий: он сам переезжает
     по зданию, пока оно крутится. */
  /* Жирный край силуэта. РИСУЕТСЯ ПО СЛОЮ, вместе со своим объектом.

     Раньше весь контур клался одним махом в самом конце кадра, поверх
     всего. Из-за этого обводка дома, который движок уже не рисовал,
     висела в воздухе чёрными палками, а контур башни ложился поверх
     ближних деревьев. Контур — часть предмета, а не наклейка сверху. */
  Engine.prototype.drawOutline = function (part) {
    var ctx = this.ctx, m = this.model;
    var o = m.outline, op = m.outlineParts, shells = m.shells;
    var px = this.px, py = this.py, jit = this.outJit;
    var n = o.length / 4, any = false;

    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var k = i * 4;
      if (part !== undefined && op && op[i] !== part) continue;
      if (shells[o[k + 2]].vis === shells[o[k + 3]].vis) continue;

      var a = o[k], b = o[k + 1];
      var x1 = px[a], y1 = py[a], x2 = px[b], y2 = py[b];
      var dx = x2 - x1, dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;

      var bow = jit[i];
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) * 0.5 - dy / len * bow,
                           (y1 + y2) * 0.5 + dx / len * bow, x2, y2);
      any = true;
    }
    if (!any) return;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = 2.1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* Мягкие тени на земле и на верхней террасе */
  Engine.prototype.drawShadows = function (layer) {
    var ctx = this.ctx, r = this.rot, list = this.model.shadows;
    var cy = r.cy, sy = r.sy, cp = r.cp, sp = r.sp;
    var S = this.S, ox = this.ox, oy = this.oy;
    var N = this.cN;

    /* Тень сдвинута в сторону, противоположную свету. Но не вся:
       у самого основания тень почти не уезжает и лежит плотным
       тёмным кольцом. Это и есть контактная тень — приём, который
       сильнее всего «прижимает» предмет к земле. Поэтому у каждой
       тени свой коэффициент сдвига. */
    /* Вбок тень уводим сильнее, чем вглубь. Физически честный сдвиг
       уносил её ровно за здание, и на экране её было не видно. */
    var offX = -LX * 1.30, offZ = -LZ * 0.40;

    // Тень нижнего корпуса — прямоугольник, её точки уже сдвинуты в модели
    if (layer === 0) {
      var hs = this.model.hallShadow, px = this.px, py = this.py;
      var ws = this.model.wingShadow;
      ctx.beginPath();
      ctx.moveTo(px[hs[0]], py[hs[0]]);
      for (var q = 1; q < hs.length; q++) ctx.lineTo(px[hs[q]], py[hs[q]]);
      ctx.closePath();
      ctx.moveTo(px[ws[0]], py[ws[0]]);
      for (var q2 = 1; q2 < ws.length; q2++) ctx.lineTo(px[ws[q2]], py[ws[q2]]);
      ctx.closePath();
      ctx.globalAlpha = 0.17;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (layer === 0 && this.model.city && this.model.city.length) {
      var CB = this.model.city, cc2 = this.model.cityCenters;
      var cy2 = r.cy, sy2 = r.sy, cp2 = r.cp, sp2 = r.sp;
      ctx.beginPath();
      for (var ci = 0; ci < CB.length; ci++) {
        var bx = cc2[ci * 3], bz = cc2[ci * 3 + 2];
        var byy = this.model.ground.y;
        var rr = 0.95;
        for (var q3 = 0; q3 <= 12; q3++) {
          var aa = q3 / 12 * Math.PI * 2;
          var sx = bx + Math.cos(aa) * rr * 1.15 + offX * 0.6;
          var sz = bz + Math.sin(aa) * rr * 0.95 + offZ * 0.6;
          var x1b = sx * cy2 + sz * sy2, z1b = -sx * sy2 + sz * cy2;
          var y2b = byy * cp2 - z1b * sp2, z2b = byy * sp2 + z1b * cp2;
          var db = CAM_DIST - z2b; if (db < 1) db = 1;
          var kb = FOCAL / db * S;
          var Xb = ox + x1b * kb, Yb = oy - y2b * kb;
          if (q3 === 0) ctx.moveTo(Xb, Yb); else ctx.lineTo(Xb, Yb);
        }
        ctx.closePath();
      }
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (layer === 0 && this.model.trees) {
      var TT = this.model.trees, pxx = this.px, pyy = this.py, pzz = this.pz;
      ctx.beginPath();
      for (var ti = 0; ti < TT.length; ti++) {
        var tf = TT[ti], tb = tf.p;
        var tk = FOCAL / Math.max(1, CAM_DIST - pzz[tb]) * this.S;
        var trx = tf.w * tk * 1.05;
        ctx.moveTo(pxx[tb] + trx, pyy[tb]);
        ctx.ellipse(pxx[tb] - trx * 0.35, pyy[tb] + trx * 0.10,
                    trx, trx * 0.34, 0, 0, Math.PI * 2);
      }
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    for (var s = 0; s < list.length; s++) {
      var sh = list[s];
      if (sh.layer !== layer) continue;
      var kOff = sh.off === undefined ? 1 : sh.off;
      var scx = sh.cx || 0, scz = sh.cz || 0;
      ctx.beginPath();
      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2;
        var x = scx + Math.cos(a) * sh.r + offX * kOff;
        var z = scz + Math.sin(a) * sh.r + offZ * kOff;

        var x1 = x * cy + z * sy;
        var z1 = -x * sy + z * cy;
        var y2 = sh.y * cp - z1 * sp;
        var z2 = sh.y * sp + z1 * cp;
        var d = CAM_DIST - z2; if (d < 1) d = 1;
        var k = FOCAL / d * S;

        var sx = ox + x1 * k, sy2 = oy - y2 * k;
        if (i === 0) ctx.moveTo(sx, sy2); else ctx.lineTo(sx, sy2);
      }
      ctx.closePath();
      ctx.globalAlpha = sh.alpha;
      ctx.fillStyle = C_SHADOW;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* Обводка линий одним путём.
     front — ближняя половина или дальняя; style — толщина (-1 = любая);
     pass — какой набор дрожания взять. */
  /* Обводка линий одним путём.
     Ребро рисуется тогда, и только тогда, когда хотя бы одна из двух
     граней, сходящихся в нём, смотрит на камеру. Низ дальней стены не
     видит никто — он и не рисуется. Дальний край площадки видно —
     он рисуется. Раньше решали по направлению «наружу от оси», и
     дальние рёбра лезли поверх здания: картинка была прозрачной.

     ВАЖНО про имена переменных: угол поворота лежит в cosY/sinY, а не
     в cy/sy. Раньше здесь была локальная sy для экранной координаты,
     и она затирала синус угла — после первой же линии проверка
     видимости считала мусор. Ровно отсюда и росли полоски. */
  Engine.prototype.strokeGroup = function (style, pass, width, alpha, part) {
    var ctx = this.ctx, m = this.model;
    var lines = m.lines, styles = m.styles, jit = this.jit;
    var parts = m.parts, lfa = m.lfa, lfb = m.lfb, ldir = m.ldir;
    var shells = m.shells;
    var px = this.px, py = this.py;
    var cosY = this.rot.cy, sinY = this.rot.sy;
    var off = pass * 4;

    /* Идём только по линиям своего слоя, а не по всему списку. */
    var idx = (part >= 0 && m.partIndex) ? m.partIndex[part] : null;
    var count = idx ? idx.length : styles.length;

    ctx.beginPath();
    var any = false;
    for (var n = 0; n < count; n++) {
      var i = idx ? idx[n] : n;
      if (style >= 0 && styles[i] !== style) continue;
      if (!idx && part >= 0 && parts[i] !== part) continue;

      var fa = lfa[i], fb = lfb[i], vis;
      if (fa < 0 && fb < 0) {
        // у прямых стен корпуса граней не записано — идём по нормали
        var nx = ldir[i * 2], nz = ldir[i * 2 + 1];
        vis = (nx === 0 && nz === 0) || (-nx * sinY + nz * cosY) > -0.03;
      } else {
        vis = (fa >= 0 && shells[fa].vis) || (fb >= 0 && shells[fb].vis);
      }
      if (!vis) continue;

      var a = lines[i * 2], b = lines[i * 2 + 1];
      var o = i * 12;
      var x1 = px[a] + jit[o + off];
      var y1 = py[a] + jit[o + off + 1];
      var x2 = px[b] + jit[o + off + 2];
      var y2 = py[b] + jit[o + off + 3];

      var ddx = x2 - x1, ddy = y2 - y1;
      var len = Math.sqrt(ddx * ddx + ddy * ddy);
      if (len < 0.001) continue;
      var ux = ddx / len, uy = ddy / len;

      // Перелёт за угол — так рисует рука, а не плоттер
      var e1 = jit[o + 10], e2 = jit[o + 11];
      var ax = x1 - ux * e1, ay = y1 - uy * e1;
      var bx = x2 + ux * e2, by = y2 + uy * e2;

      // Лёгкий изгиб: середина сдвинута поперёк линии
      var bow = jit[o + 8 + pass];
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) * 0.5 - uy * bow, (ay + by) * 0.5 + ux * bow, bx, by);
      any = true;
    }
    if (!any) return;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

