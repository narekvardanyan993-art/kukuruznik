/* model.js — геометрия «Кукурузника» (Дом молодёжи, Ереван).
   Ничего не знает ни про экран, ни про камеру: только точки, линии,
   грани и «чешуйки» в своих локальных координатах.
   Ось Y смотрит вверх, начало координат — в середине здания по высоте,
   чтобы оно вращалось вокруг себя, а не улетало вбок.

   Как устроено настоящее здание (снято с фотографий в photos/):
   — низкий каменный стилобат двумя террасами, к нему ведут два марша;
   — ствол: широкие вертикальные рёбра по кругу, между ними на каждом
     этаже лоджия — тёмный арочный проём с круглым верхом и светлый
     балкон под ним. Отсюда и «початок»;
   — наверху ствола кровля с глухим парапетом;
   — над ней на узкой шее — «летающая тарелка»: лента остекления
     (там был ресторан), скошенный колпак и плоская макушка;
   — сбоку длинный корпус с волнистой плитой кровли.

   ГЛАВНОЕ ПРО ЛИНИИ. У каждой линии записаны две грани, которые в ней
   сходятся. Линия рисуется тогда, и только тогда, когда хотя бы одна
   из них смотрит на камеру. Это и есть честное правило видимого ребра:
   низ дальней стены никто не видит, а дальний край площадки — видит.
   Раньше решали по направлению «наружу от оси», и дальние рёбра лезли
   поверх здания — картинка выглядела прозрачной. */

(function (global) {
  'use strict';

  var THIN = 0, MED = 1, BOLD = 2;

  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function build(options) {
    var opt = options || {};
    var N = opt.ribs || 16;        // вертикальных рёбер по кругу
    var F = opt.floors || 15;      // этажей в стволе
    var M = 32;                    // граней у стилобата
    var NS = 32;                   // граней у тарелки: она круглая, не гранёная

    var R  = 1.00;                 // радиус ствола по рёбрам
    var fh = 0.260;                // высота этажа

    // ---- ключевые высоты ----
    var yGround = 0.00;
    var tiers = [
      { r: 2.10, y0: 0.00, y1: 0.22 },
      { r: 1.58, y0: 0.22, y1: 0.50 }
    ];
    var shaftY0 = 0.50;
    var shaftY1 = shaftY0 + F * fh;     // верх ствола

    var railY   = shaftY1 + 0.12;       // верх парапета кровли
    var neckY   = shaftY1 + 0.21;       // низ тарелки
    var rimY    = shaftY1 + 0.29;       // рант тарелки
    var glassY  = shaftY1 + 0.58;       // верх остекления
    var capY    = shaftY1 + 0.84;       // низ бортика макушки
    var mastY   = shaftY1 + 0.97;       // сама макушка

    var rNeck = 0.62, rRim = 1.00, rCap = 0.64;

    var yCenter = (yGround + capY) * 0.52;

    // Радиус ствола на высоте y: внизу заметно поджимается,
    // к середине чуть раздувается — початок, а не труба.
    function shaftR(y) {
      var t = (y - shaftY0) / (shaftY1 - shaftY0);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var k = t / 0.10; if (k > 1) k = 1;
      var taper = 0.85 + 0.15 * (k * k * (3 - 2 * k));
      var barrel = 1 + 0.03 * Math.sin(Math.PI * t);
      return R * taper * barrel;
    }

    var pos = [];
    var lines = [], styles = [], parts = [];
    var lfa = [], lfb = [];   // две грани, сходящиеся в линии (-1 — нет)
    var ldir = [];            // запасной признак: куда линия смотрит наружу
    var shells = [];          // четырёхугольники для заливки «краской»
    var cells = [];           // чешуйки-лоджии
    var outline = [];         // рёбра-кандидаты на контур

    function addPt(ang, r, y) {
      var i = pos.length / 3;
      pos.push(Math.cos(ang) * r, y - yCenter, Math.sin(ang) * r);
      return i;
    }
    function addXYZ(x, y, z) {
      var i = pos.length / 3;
      pos.push(x, y - yCenter, z);
      return i;
    }
    function addAxis(y) { return addXYZ(0, y, 0); }

    /* Линии делятся на слои отрисовки: 0 — ствол, 1 — тарелка,
       3 — стилобат с лестницами, 4 — нижний корпус. Каждый слой
       рисуется сразу за своими заливками, поэтому линия не может
       вылезти поверх того, что её закрывает. */
    var curPart = 0;
    function line(a, b, s, fa, fb, dx, dz) {
      lines.push(a, b); styles.push(s); parts.push(curPart);
      lfa.push(fa === undefined ? -1 : fa);
      lfb.push(fb === undefined ? -1 : fb);

      if (dx === undefined) {
        dx = (pos[a * 3] + pos[b * 3]) * 0.5;
        dz = (pos[a * 3 + 2] + pos[b * 3 + 2]) * 0.5;
      }
      var L = Math.sqrt(dx * dx + dz * dz);
      if (L < 1e-4) ldir.push(0, 0); else ldir.push(dx / L, dz / L);
    }

    function ring(count, r, y) {
      var idx = new Array(count);
      for (var i = 0; i < count; i++) idx[i] = addPt((i / count) * Math.PI * 2, r, y);
      return idx;
    }
    // Кольцо линий. below/above — грани под кольцом и над ним.
    function ringLines(idx, s, below, above) {
      var n = idx.length;
      for (var i = 0; i < n; i++) {
        line(idx[i], idx[(i + 1) % n], s,
             below ? below[i] : -1, above ? above[i] : -1);
      }
    }

    function shellRaw(kind, a, b, c, d, nx, ny, nz) {
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      shells.push({
        kind: kind, a: a, b: b, c: c, d: d,
        nx: nx / len, ny: ny / len, nz: nz / len,
        vis: false, lit: 0
      });
      return shells.length - 1;
    }
    // Грань кругового пояса: направление наружу задаётся углом
    function shell(kind, a, b, c, d, ang, ny) {
      return shellRaw(kind, a, b, c, d, Math.cos(ang), ny, Math.sin(ang));
    }
    // Грань прямой стены: нормаль задана руками
    var face = shellRaw;

    /* Пояс граней между двумя кольцами точек. Заодно запоминает
       вертикальные стыки как кандидатов на контур: ребро попадает на
       силуэт ровно тогда, когда одна соседняя грань смотрит на нас,
       а вторая уже отвернулась. */
    function band(kind, lo, hi, ny, skipOutline) {
      var n = lo.length, ids = new Array(n);
      for (var i = 0; i < n; i++) {
        ids[i] = shell(kind, lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i],
                       ((i + 0.5) / n) * Math.PI * 2, ny);
      }
      // В контур берём только отвесные объёмы: у наклонных «край»
      // вылезает посреди видимой поверхности и выглядит чёрточкой.
      if (!skipOutline && Math.abs(ny) < 0.3) {
        for (var i = 0; i < n; i++) {
          outline.push(lo[i], hi[i], ids[(i + n - 1) % n], ids[i]);
        }
      }
      return ids;
    }
    // Крышка: веер от кольца к точке на оси
    function cap(kind, idx, axis) {
      var n = idx.length, ids = new Array(n);
      for (var i = 0; i < n; i++) {
        ids[i] = shell(kind, idx[i], idx[(i + 1) % n], axis, axis,
                       ((i + 0.5) / n) * Math.PI * 2, 6);
      }
      return ids;
    }

    var rnd = seeded(4242);

    // ======== земля ========
    /* Край слегка неровный, но не рваный: движок обводит его гладкой
       кривой. Линии земли в общий список не идут — их рисует движок
       вместе с заливкой, тем же самым путём. */
    /* Здание стояло на вершине холма (Канакерская высота, конец улицы
       Абовяна) — место выбрали так, чтобы его было видно отовсюду.
       Плоская лужайка была враньём: вокруг площадки земля уходит вниз,
       и город лежит НИЖЕ здания, а не рядом с ним. */
    var GN = 48, rGround = 13.0;
    var rPlateau = 5.0, hDrop = 2.15;

    function groundY(r) {
      if (r <= rPlateau) return yGround;
      var t = (r - rPlateau) / (rGround - rPlateau);
      if (t > 1) t = 1;
      return yGround - hDrop * t * t * (3 - 2 * t);   // плавный перегиб
    }

    var groundRing = new Array(GN);
    for (var i = 0; i < GN; i++) {
      var rg = rGround * (0.94 + rnd() * 0.12);
      groundRing[i] = addPt((i / GN) * Math.PI * 2, rg, groundY(rg));
    }

    var FRONT_A = -Math.PI / 2;       // куда смотрит фасад: в сторону −Z

    // ======== стилобат ========
    curPart = 3;
    var botR = [], topR = [], midR = [], wallIds = [];
    for (var t = 0; t < tiers.length; t++) {
      botR[t] = ring(M, tiers[t].r, tiers[t].y0);
      topR[t] = ring(M, tiers[t].r, tiers[t].y1);
      midR[t] = ring(M, tiers[t].r, (tiers[t].y0 + tiers[t].y1) * 0.5);
    }
    for (var t = 0; t < tiers.length; t++) {
      // Стену стилобата в контур не берём: она низкая, и её «край»
      // на экране вырождается в одинокую точку.
      wallIds[t] = band('podium', botR[t], topR[t], 0, true);
    }
    var deck1Ids = band('deck', topR[0], botR[1], 6);          // площадка нижней террасы
    var deck2Ids = cap('deck', topR[1], addAxis(tiers[1].y1)); // верхняя площадка

    ringLines(botR[0], MED,  null,      wallIds[0]);
    ringLines(midR[0], THIN, wallIds[0], wallIds[0]);
    ringLines(topR[0], MED,  wallIds[0], deck1Ids);
    ringLines(botR[1], MED,  deck1Ids,  wallIds[1]);
    ringLines(midR[1], THIN, wallIds[1], wallIds[1]);
    ringLines(topR[1], MED,  wallIds[1], deck2Ids);

    /* Арочный портал. На фотографии это главный вход: большая арка,
       врезанная в каменную стену стилобата ровно под башней. */
    var portalA = FRONT_A - 0.19, portalB = FRONT_A + 0.19;
    cells.push({
      grp: 3, arch: true,
      a: addPt(portalB, tiers[0].r + 0.01, yGround + 0.01),
      b: addPt(portalA, tiers[0].r + 0.01, yGround + 0.01),
      c: addPt(portalA, tiers[0].r + 0.01, tiers[0].y1 - 0.01),
      d: addPt(portalB, tiers[0].r + 0.01, tiers[0].y1 - 0.01),
      nx: Math.cos(FRONT_A), ny: 0, nz: Math.sin(FRONT_A),
      vis: false, lit: 0
    });

    // ======== лестницы ========
    /* Два марша уступами. Каждый стоит СНАРУЖИ той террасы, на которую
       ведёт, и потому нигде не врезается в стилобат. */
    function stairFlight(xTop, xBot, yTop, yBot, halfW, steps) {
      var rise = (yTop - yBot) / steps;
      var run  = (xBot - xTop) / steps;
      for (var i = 0; i < steps; i++) {
        var yH = yTop - rise * i;
        var xI = xTop + run * i;
        var xO = xTop + run * (i + 1);

        var aN = addXYZ(xI, yH, -halfW), aF = addXYZ(xI, yH, halfW);
        var bN = addXYZ(xO, yH, -halfW), bF = addXYZ(xO, yH, halfW);
        var cN = addXYZ(xO, yH - rise, -halfW), cF = addXYZ(xO, yH - rise, halfW);

        var tread = face('deck',   aN, bN, bF, aF, 0, 1, 0);
        var riser = face('podium', bN, cN, cF, bF, -1, 0, 0);
        line(bN, bF, MED, tread, riser);       // светлый край ступени
      }
      var tN = addXYZ(xTop, yTop, -halfW), tF = addXYZ(xTop, yTop, halfW);
      var oN = addXYZ(xBot, yBot, -halfW), oF = addXYZ(xBot, yBot, halfW);
      var gN = addXYZ(xTop, yBot, -halfW), gF = addXYZ(xTop, yBot, halfW);
      var chN = face('podium', tN, oN, gN, gN, 0, 0, -1);
      var chF = face('podium', oF, tF, gF, gF, 0, 0, 1);
      line(tN, oN, MED, chN, chN);
      line(tF, oF, MED, chF, chF);
    }
    /* Лестницы. Террасы круглые, поэтому и марши круглые: прямой
       марш упирался в дугу и стыковался с ней только серединой, а по
       краям оставались щели — из-за них лестница выглядела решёткой,
       лежащей рядом со зданием.

       Теперь это ступени-дуги, разбегающиеся наружу по сектору фасада.
       Каждая ступень — проступь (горизонтальная) и подступёнок
       (вертикальный), плюс закрытые щёки по краям сектора. */
    var FRONT = FRONT_A;              // сторона фасада: туда смотрит −Z

    function stairArc(rIn, yTop, yBot, half, steps, depth) {
      var K = 12;
      var a0 = FRONT - half, a1 = FRONT + half;
      var rise = (yTop - yBot) / steps;
      var run  = depth / steps;

      for (var s2 = 0; s2 < steps; s2++) {
        var yT = yTop - rise * s2;
        var r0 = rIn + run * s2, r1 = rIn + run * (s2 + 1);
        var inner = [], outer = [], down = [];
        for (var i = 0; i <= K; i++) {
          var a = a0 + (a1 - a0) * (i / K);
          inner.push(addPt(a, r0, yT));
          outer.push(addPt(a, r1, yT));
          down.push(addPt(a, r1, yT - rise));
        }
        for (var i = 0; i < K; i++) {
          var am = a0 + (a1 - a0) * ((i + 0.5) / K);
          var tread = face('deck', inner[i], outer[i], outer[i + 1], inner[i + 1],
                           0, 1, 0);
          var riser = face('podium', outer[i], down[i], down[i + 1], outer[i + 1],
                           Math.cos(am), 0, Math.sin(am));
          /* Кромку ступени привязываем только к подступёнку. Проступь
             смотрит вверх и «видна» всегда, и из-за неё дальние ступени
             прочерчивались тёмными закорючками сбоку от башни. */
          line(outer[i], outer[i + 1], MED, riser, riser);
        }
      }

      // щёки по краям сектора — без них марш висит в воздухе
      for (var e = 0; e < 2; e++) {
        var ae = e === 0 ? a0 : a1;
        var sgn = e === 0 ? -1 : 1;
        var p1 = addPt(ae, rIn, yTop);
        var p2 = addPt(ae, rIn + depth, yBot);
        var p3 = addPt(ae, rIn + depth, yBot - 0.001);
        var p4 = addPt(ae, rIn, yBot);
        /* Щека только закрывает объём. Линий на ней нет: она стоит
           почти ребром к глазу, и любая линия на ней превращалась
           в тёмную закорючку сбоку от башни. */
        face('podium', p1, p2, p3, p4,
             -Math.sin(ae) * sgn, 0, Math.cos(ae) * sgn);
      }
    }

    stairArc(tiers[1].r, tiers[1].y1, tiers[0].y1, 0.46, 4, 0.34);
    stairArc(tiers[0].r, tiers[0].y1, yGround,     0.60, 4, 0.40);

    // ======== ствол ========
    curPart = 0;
    var pitch = (Math.PI * 2) / N;
    var levels = new Array(F + 1);
    for (var f = 0; f <= F; f++) {
      levels[f] = ring(N, shaftR(shaftY0 + f * fh), shaftY0 + f * fh);
    }
    var shaftIds = new Array(F);
    for (var f = 0; f < F; f++) shaftIds[f] = band('shaft', levels[f], levels[f + 1], 0);

    // кровля ствола: сплошной низкий парапет и глухая плита поверх
    var railRing = ring(N, shaftR(shaftY1), railY);
    var railIds  = band('rail', levels[F], railRing, 0);
    var roofDeck = cap('deck', railRing, addAxis(railY));

    ringLines(levels[0], MED,  null,             shaftIds[0]);
    ringLines(levels[F], BOLD, shaftIds[F - 1],  railIds);
    ringLines(railRing,  MED,  railIds,          roofDeck);

    /* Рёбра — по две линии на ребро. Коротким куском отрабатывается
       поджатие внизу, длинным — всё остальное. Резать ребро на много
       кусков нельзя: каждая рисуется с дрожанием, и на стыках выходят
       изломы, похожие на чёрточки поперёк фасада. */
    var fKnee = Math.min(F, 2), fMid = Math.min(F - 1, (F + fKnee) >> 1);
    for (var i = 0; i < N; i++) {
      var j = (i + N - 1) % N;
      line(levels[0][i], levels[fKnee][i], THIN, shaftIds[0][j], shaftIds[0][i]);
      line(levels[fKnee][i], levels[F][i], THIN, shaftIds[fMid][j], shaftIds[fMid][i]);
    }

    // ======== чешуйки: лоджии между рёбрами ========
    for (var f = 0; f < F; f++) {
      var yb = shaftY0 + f * fh + fh * 0.13;
      var yt = shaftY0 + (f + 1) * fh - fh * 0.02;
      var rb = shaftR(yb) * 0.90;
      var rt = shaftR(yt) * 0.90;
      for (var i = 0; i < N; i++) {
        var a0 = i * pitch + pitch * 0.12;
        var a1 = i * pitch + pitch * 0.88;
        cells.push({
          a: addPt(a0, rb, yb), b: addPt(a1, rb, yb),
          c: addPt(a1, rt, yt), d: addPt(a0, rt, yt),
          nx: Math.cos((a0 + a1) * 0.5), ny: 0, nz: Math.sin((a0 + a1) * 0.5),
          vis: false, lit: 0
        });
      }
    }

    // ======== тарелка ========
    curPart = 1;
    var neckBase  = ring(NS, rNeck, shaftY1);
    var neckRing  = ring(NS, rNeck, neckY);
    var rimRing   = ring(NS, rRim,  rimY);
    var glassRing = ring(NS, rRim,  glassY);
    var capRing   = ring(NS, rCap,  capY);
    var railTop   = ring(NS, rCap * 0.94, mastY);
    var innerTop  = ring(NS, rCap * 0.55, mastY);

    // Шея прячется за тарелкой, в контур её не берём
    band('neck', neckBase, neckRing, 0, true);
    var flareIds = band('flare', neckRing, rimRing, -1.2);
    var glassIds = band('glass', rimRing, glassRing, 0);
    var coneIds  = band('parapet', glassRing, capRing, 0.8);
    var crestIds = band('rail', capRing, railTop, 0, true);
    var roofIds  = cap('roof', railTop, addAxis(mastY));

    ringLines(rimRing,   MED,  flareIds, glassIds);
    ringLines(glassRing, MED,  glassIds, coneIds);
    ringLines(capRing,   MED,  coneIds,  crestIds);
    ringLines(railTop,   THIN, crestIds, roofIds);
    ringLines(innerTop,  THIN, roofIds,  roofIds);   // видно только сверху
    for (var i = 0; i < NS; i += 2) {
      var j = (i + NS - 1) % NS;
      line(rimRing[i], glassRing[i], THIN, glassIds[j], glassIds[i]);  // импосты
    }

    // ======== нижний корпус с волнистой крышей ========
    curPart = 4;
    var HX0 = 1.32, HX1 = 4.60;     // корпус вытянут вдоль оси X
    var HZ  = 1.16;                 // половина ширины
    var HT  = 0.17;                 // толщина плиты кровли
    var HK  = 26;                   // точек вдоль волны

    // Один плавный период на всю длину: полтора коротких читались
    // горной грядой, а не кровлей.
    function roofTopY(u) { return 1.18 + 0.27 * Math.sin(u * 6.6 - 0.8); }

    var hGndN = [], hGndF = [], hBotN = [], hBotF = [], hTopN = [], hTopF = [];
    var hCrsN = [], hCrsF = [];
    var hGtN = [], hGtF = [], hGbN = [], hGbF = [];   // лента остекления
    var hCourse = 0.42;             // ряд кладки по стене
    for (var i = 0; i <= HK; i++) {
      var u = i / HK;
      var hx = HX0 + (HX1 - HX0) * u;
      var yt = roofTopY(u), yb = yt - HT;
      hGndN.push(addXYZ(hx, yGround, -HZ));  hGndF.push(addXYZ(hx, yGround, HZ));
      hCrsN.push(addXYZ(hx, hCourse, -HZ));  hCrsF.push(addXYZ(hx, hCourse, HZ));
      hBotN.push(addXYZ(hx, yb, -HZ));       hBotF.push(addXYZ(hx, yb, HZ));
      hTopN.push(addXYZ(hx, yt, -HZ));       hTopF.push(addXYZ(hx, yt, HZ));

      /* Лента остекления идёт под самой кровлей и повторяет волну.
         Глухая стена без единого окна читается как забор, а не как
         здание — это и был главный источник «картонности». */
      var gt = yb - 0.06, gb = yb - 0.40;
      hGtN.push(addXYZ(hx, gt, -HZ));        hGtF.push(addXYZ(hx, gt, HZ));
      hGbN.push(addXYZ(hx, gb, -HZ));        hGbF.push(addXYZ(hx, gb, HZ));
    }

    for (var i = 0; i < HK; i++) {
      var wN = face('hall', hGndN[i], hGndN[i + 1], hBotN[i + 1], hBotN[i], 0, 0, -1);
      var wF = face('hall', hGndF[i + 1], hGndF[i], hBotF[i], hBotF[i + 1], 0, 0, 1);
      var sN = face('slab', hBotN[i], hBotN[i + 1], hTopN[i + 1], hTopN[i], 0, 0, -1);
      var sF = face('slab', hBotF[i + 1], hBotF[i], hTopF[i], hTopF[i + 1], 0, 0, 1);
      var rT = face('slabTop', hTopN[i], hTopN[i + 1], hTopF[i + 1], hTopF[i], 0, 1, 0);

      var gN = face('hallGlass', hGbN[i], hGbN[i + 1], hGtN[i + 1], hGtN[i], 0, 0, -1);
      var gF = face('hallGlass', hGbF[i + 1], hGbF[i], hGtF[i], hGtF[i + 1], 0, 0, 1);
      line(hGtN[i], hGtN[i + 1], THIN, gN, gN);
      line(hGbN[i], hGbN[i + 1], THIN, gN, gN);
      line(hGtF[i], hGtF[i + 1], THIN, gF, gF);
      line(hGbF[i], hGbF[i + 1], THIN, gF, gF);
      if (i % 2 === 0) {                       // импосты остекления
        line(hGbN[i], hGtN[i], THIN, gN, gN);
        line(hGbF[i], hGtF[i], THIN, gF, gF);
      }

      line(hTopN[i], hTopN[i + 1], MED,  sN, rT);   // волна, ближняя сторона
      line(hTopF[i], hTopF[i + 1], MED,  sF, rT);   // волна, дальняя сторона
      line(hBotN[i], hBotN[i + 1], THIN, wN, sN);
      line(hBotF[i], hBotF[i + 1], THIN, wF, sF);
      /* Поперечное ребро кровли. Без него плита — просто белое пятно
         размером с полздания, и весь корпус выглядит картонным. */
      if (i % 4 === 2) line(hTopN[i], hTopF[i], MED, rT, rT);
      line(hGndN[i], hGndN[i + 1], MED,  wN, wN);
      line(hGndF[i], hGndF[i + 1], MED,  wF, wF);
      line(hCrsN[i], hCrsN[i + 1], THIN, wN, wN);
      line(hCrsF[i], hCrsF[i + 1], THIN, wF, wF);
    }

    for (var e = 0; e < 2; e++) {
      var k = e === 0 ? 0 : HK;
      var nx = e === 0 ? -1 : 1;
      var n0 = e === 0 ? hGndF[0] : hGndN[HK], n1 = e === 0 ? hGndN[0] : hGndF[HK];
      var n2 = e === 0 ? hBotN[0] : hBotF[HK], n3 = e === 0 ? hBotF[0] : hBotN[HK];
      var eW = face('hall', n0, n1, n2, n3, nx, 0, 0);
      var eS = face('slab', hBotF[k], hBotN[k], hTopN[k], hTopF[k], nx, 0, 0);
      line(hGndN[k], hTopN[k], MED,  eW, eS);
      line(hGndF[k], hTopF[k], MED,  eW, eS);
      line(hTopN[k], hTopF[k], MED,  eS, eS);
      line(hBotN[k], hBotF[k], THIN, eW, eS);
    }

    // ======== длинное низкое крыло с аркадой (слева от башни) ========
    /* На фотографии это самый узнаваемый кусок комплекса после самой
       башни: длинный низкий объём, у которого весь фасад — сплошной ряд
       высоких узких арок, а сверху лежит плоская плита с выносом.
       Стоит по другую сторону от волнистого корпуса, вдоль той же оси. */
    curPart = 5;
    var WX0 = -1.52, WX1 = -4.35;   // от стилобата наружу
    var WZ  = 0.80;                 // половина ширины
    var WY  = 1.06;                 // верх стены
    var WYT = 1.18;                 // верх плиты кровли
    var WO  = 0.12;                 // вынос плиты за стену

    /* Грани крыла уходят под стилобат, чтобы между ним и крылом не было
       прогала. А вот ЛИНИИ обрезаем по краю террасы: иначе они начинались
       из-под стилобата и чертили полосу поперёк башни. */
    var WXL = -2.32;
    function wl(y, z) { return addXYZ(WXL, y, z); }

    var wgN0 = addXYZ(WX0, yGround, -WZ), wgN1 = addXYZ(WX1, yGround, -WZ);
    var wgF0 = addXYZ(WX0, yGround,  WZ), wgF1 = addXYZ(WX1, yGround,  WZ);
    var wtN0 = addXYZ(WX0, WY, -WZ),      wtN1 = addXYZ(WX1, WY, -WZ);
    var wtF0 = addXYZ(WX0, WY,  WZ),      wtF1 = addXYZ(WX1, WY,  WZ);

    var wallN = face('wing', wgN0, wgN1, wtN1, wtN0,  0, 0, -1);
    var wallF = face('wing', wgF1, wgF0, wtF0, wtF1,  0, 0,  1);
    var wallW = face('wing', wgN1, wgF1, wtF1, wtN1, -1, 0,  0);

    // плита кровли: короб с выносом на три стороны
    var sbN0 = addXYZ(WX0, WY,  -WZ - WO), sbN1 = addXYZ(WX1 - WO, WY,  -WZ - WO);
    var sbF0 = addXYZ(WX0, WY,   WZ + WO), sbF1 = addXYZ(WX1 - WO, WY,   WZ + WO);
    var stN0 = addXYZ(WX0, WYT, -WZ - WO), stN1 = addXYZ(WX1 - WO, WYT, -WZ - WO);
    var stF0 = addXYZ(WX0, WYT,  WZ + WO), stF1 = addXYZ(WX1 - WO, WYT,  WZ + WO);

    var slabN = face('wingSlab', sbN0, sbN1, stN1, stN0,  0, 0, -1);
    var slabF = face('wingSlab', sbF1, sbF0, stF0, stF1,  0, 0,  1);
    var slabW = face('wingSlab', sbN1, sbF1, stF1, stN1, -1, 0,  0);
    var slabT = face('wingTop',  stN0, stN1, stF1, stF0,  0, 1,  0);

    line(wl(yGround, -WZ), wgN1, MED,  wallN, wallN);
    line(wl(yGround,  WZ), wgF1, MED,  wallF, wallF);
    line(wgN1, wtN1, MED,  wallN, wallW);
    line(wgF1, wtF1, MED,  wallF, wallW);
    line(wl(WY, -WZ), wtN1, THIN, wallN, slabN);
    line(wl(WY,  WZ), wtF1, THIN, wallF, slabF);
    line(wl(WY, -WZ - WO), sbN1, MED,  slabN, slabN);
    line(wl(WY,  WZ + WO), sbF1, MED,  slabF, slabF);
    line(wl(WYT, -WZ - WO), stN1, MED,  slabN, slabT);
    line(wl(WYT,  WZ + WO), stF1, MED,  slabF, slabT);
    line(stN1, stF1, MED,  slabW, slabT);
    line(sbN1, stN1, MED,  slabN, slabW);
    line(sbF1, stF1, MED,  slabF, slabW);

    /* Задний этаж крыла. Одна коробка с плоской крышей остаётся
       коробкой, сколько ни правь ей края: в жизни это не один объём,
       а несколько уровней уступами. Поднимаем заднюю половину
       отдельным этажом — у него свои окна, свой карниз, а перед ним
       остаётся терраса. Сразу появляется глубина. */
    var WY2  = WY + 0.52;           // верх стены заднего этажа
    var WZB  = -WZ + 0.46;          // насколько он отступил от фасада

    var bN0 = addXYZ(WX0, WYT, WZB), bN1 = addXYZ(WX1, WYT, WZB);
    var bT0 = addXYZ(WX0, WY2, WZB), bT1 = addXYZ(WX1, WY2, WZB);
    var bF0 = addXYZ(WX0, WYT,  WZ), bF1 = addXYZ(WX1, WYT,  WZ);
    var bG0 = addXYZ(WX0, WY2,  WZ), bG1 = addXYZ(WX1, WY2,  WZ);

    var bFront = face('wingUp', bN0, bN1, bT1, bT0, 0, 0, -1);
    var bBack  = face('wingUp', bF1, bF0, bG0, bG1, 0, 0,  1);
    var bWest  = face('wingUp', bN1, bF1, bG1, bT1, -1, 0, 0);

    // окна заднего этажа — то же лекарство, что подействовало на корпус
    var wg0 = WY2 - 0.34, wg1 = WY2 - 0.08;
    var gN0 = addXYZ(WX0 + 0.12, wg0, WZB), gN1 = addXYZ(WX1 + 0.10, wg0, WZB);
    var gT0 = addXYZ(WX0 + 0.12, wg1, WZB), gT1 = addXYZ(WX1 + 0.10, wg1, WZB);
    var bGlass = face('wingGlass', gN0, gN1, gT1, gT0, 0, 0, -1);
    line(wl(wg0, WZB), gN1, THIN, bGlass, bGlass);
    line(wl(wg1, WZB), gT1, THIN, bGlass, bGlass);
    var MU = 9;
    for (var i = 1; i < MU; i++) {
      var mx = WXL + (WX1 - WXL) * (i / MU);
      line(addXYZ(mx, wg0, WZB), addXYZ(mx, wg1, WZB), THIN, bGlass, bGlass);
    }

    // карниз-плита поверх заднего этажа
    var kY = WY2 + 0.11, kO = 0.07;
    var kN0 = addXYZ(WX0, WY2, WZB - kO), kN1 = addXYZ(WX1 - kO, WY2, WZB - kO);
    var kF0 = addXYZ(WX0, WY2,  WZ + kO), kF1 = addXYZ(WX1 - kO, WY2,  WZ + kO);
    var kTN0 = addXYZ(WX0, kY, WZB - kO), kTN1 = addXYZ(WX1 - kO, kY, WZB - kO);
    var kTF0 = addXYZ(WX0, kY,  WZ + kO), kTF1 = addXYZ(WX1 - kO, kY,  WZ + kO);
    var kA = face('wingUpCorn', kN0, kN1, kTN1, kTN0, 0, 0, -1);
    var kB = face('wingUpCorn', kF1, kF0, kTF0, kTF1, 0, 0,  1);
    var kC = face('wingUpCorn', kN1, kF1, kTF1, kTN1, -1, 0, 0);
    var kT = face('wingUpTop', kTN0, kTN1, kTF1, kTF0, 0, 1,  0);

    line(wl(WYT, WZB), bN1, MED, bFront, bFront);
    line(bN1, bT1, MED, bFront, bWest);
    line(bF1, bG1, MED, bBack,  bWest);
    line(wl(WY2, WZB - kO), kN1, THIN, kA, kA);
    line(wl(kY, WZB - kO), kTN1, MED, kA, kT);
    line(wl(kY,  WZ + kO), kTF1, MED, kB, kT);
    line(kTN1, kTF1, MED, kC, kT);
    line(kN1, kTN1, MED, kA, kC);

    outline.push(bN1, bT1, bFront, bWest);
    outline.push(kN1, kTN1, kA, kC);

    /* Карниз над аркадой. Стена, у которой нет ни низа, ни верха,
       выглядит плоской покраской. */
    var CY0 = 0.94, CY1 = WY;
    var cnN0 = addXYZ(WX0, CY0, -WZ - 0.05), cnN1 = addXYZ(WX1, CY0, -WZ - 0.05);
    var cnF0 = addXYZ(WX0, CY0,  WZ + 0.05), cnF1 = addXYZ(WX1, CY0,  WZ + 0.05);
    var ctN0 = addXYZ(WX0, CY1, -WZ - 0.05), ctN1 = addXYZ(WX1, CY1, -WZ - 0.05);
    var ctF0 = addXYZ(WX0, CY1,  WZ + 0.05), ctF1 = addXYZ(WX1, CY1,  WZ + 0.05);
    var cnA = face('wingCorn', cnN0, cnN1, ctN1, ctN0, 0, 0, -1);
    var cnB = face('wingCorn', cnF1, cnF0, ctF0, ctF1, 0, 0,  1);
    var cnC = face('wingCorn', cnN1, cnF1, ctF1, ctN1, -1, 0, 0);
    line(wl(CY0, -WZ - 0.05), cnN1, THIN, cnA, cnA);
    line(wl(CY0,  WZ + 0.05), cnF1, THIN, cnB, cnB);
    line(wl(CY1, -WZ - 0.05), ctN1, MED,  cnA, cnA);
    line(wl(CY1,  WZ + 0.05), ctF1, MED,  cnB, cnB);
    line(cnN1, ctN1, MED,  cnA, cnC);
    line(cnF1, ctF1, MED,  cnB, cnC);

    /* Бортик по краю кровли. Плоская плита без бортика читается как
       лист картона: у неё нет ни толщины, ни границы. */
    var PH = 0.085;
    var pN0 = addXYZ(WX0, WYT + PH, -WZ - WO), pN1 = addXYZ(WX1 - WO, WYT + PH, -WZ - WO);
    var pF0 = addXYZ(WX0, WYT + PH,  WZ + WO), pF1 = addXYZ(WX1 - WO, WYT + PH,  WZ + WO);
    var iN0 = addXYZ(WX0, WYT + PH, -WZ - WO + 0.09), iN1 = addXYZ(WX1 - WO - 0.09, WYT + PH, -WZ - WO + 0.09);
    var iF0 = addXYZ(WX0, WYT + PH,  WZ + WO - 0.09), iF1 = addXYZ(WX1 - WO - 0.09, WYT + PH,  WZ + WO - 0.09);
    var jN1 = addXYZ(WX1 - WO - 0.09, WYT, -WZ - WO + 0.09);
    var jF1 = addXYZ(WX1 - WO - 0.09, WYT,  WZ + WO - 0.09);

    var rlN = face('wingRail', stN0, stN1, pN1, pN0, 0, 0, -1);
    var rlF = face('wingRail', stF1, stF0, pF0, pF1, 0, 0,  1);
    var rlW = face('wingRail', stN1, stF1, pF1, pN1, -1, 0, 0);
    var rtN = face('wingRail', pN0, pN1, iN1, iN0, 0, 1, 0);
    var rtF = face('wingRail', pF0, pF1, iF1, iF0, 0, 1, 0);
    var rtW = face('wingRail', pN1, pF1, iF1, iN1, 0, 1, 0);
    face('wingRail', iN1, iF1, jF1, jN1, 1, 0, 0);   // внутренняя сторона торца

    line(wl(WYT + PH, -WZ - WO), pN1, MED,  rlN, rtN);
    line(wl(WYT + PH,  WZ + WO), pF1, MED,  rlF, rtF);
    line(pN1, pF1, MED,  rlW, rtW);
    line(wl(WYT + PH, -WZ - WO + 0.09), iN1, THIN, rtN, rtN);
    line(wl(WYT + PH,  WZ + WO - 0.09), iF1, THIN, rtF, rtF);
    line(stN1, pN1, THIN, rlN, rlW);
    line(stF1, pF1, THIN, rlF, rlW);

    // швы мощения на террасе: большая ровная плоскость без них мертва
    var PJ = 5;
    for (var i = 1; i < PJ; i++) {
      var jx = WXL + (WX1 - WO - WXL) * (i / PJ);
      line(addXYZ(jx, WYT, -WZ - WO + 0.09), addXYZ(jx, WYT, WZ + WO - 0.09),
           THIN, slabT, slabT);
    }

    outline.push(wgN1, wtN1, wallN, wallW);
    outline.push(pN1, pF1, rlW, rlW);
    outline.push(wgF1, wtF1, wallF, wallW);

    /* Сами арки. Это те же «чешуйки», что и лоджии на стволе, только
       без балкона: узкий проём с полуовальным верхом, внутри тень. */
    var AN = 11;
    var aY0 = 0.10, aY1 = 0.88;
    var aSpan = (WX1 - WX0) / AN;
    for (var i = 0; i < AN; i++) {
      var axA = WX0 + aSpan * (i + 0.26);
      var axB = WX0 + aSpan * (i + 0.74);
      cells.push({
        grp: 5, arch: true,
        a: addXYZ(axA, aY0, -WZ), b: addXYZ(axB, aY0, -WZ),
        c: addXYZ(axB, aY1, -WZ), d: addXYZ(axA, aY1, -WZ),
        nx: 0, ny: 0, nz: -1, vis: false, lit: 0
      });
      cells.push({
        grp: 5, arch: true,
        a: addXYZ(axB, aY0, WZ), b: addXYZ(axA, aY0, WZ),
        c: addXYZ(axA, aY1, WZ), d: addXYZ(axB, aY1, WZ),
        nx: 0, ny: 0, nz: 1, vis: false, lit: 0
      });
    }

    var wingShadow = [
      addXYZ(WX1 - WO - 0.06 + 0.30, yGround, -WZ - WO - 0.06 + -0.14),
      addXYZ(WX0 + 0.30,             yGround, -WZ - WO - 0.06 + -0.14),
      addXYZ(WX0 + 0.30,             yGround,  WZ + WO + 0.06 + -0.14),
      addXYZ(WX1 - WO - 0.06 + 0.30, yGround,  WZ + WO + 0.06 + -0.14)
    ];

    curPart = 0;

    /* Тень нижнего корпуса на земле. Сдвиг вбит теми же числами, что
       и у круглых теней в движке: свет один на всю сцену. */
    var SHX = 0.30, SHZ = -0.14, gp = 0.10;
    var hallShadow = [
      addXYZ(HX0 - gp + SHX, yGround, -HZ - gp + SHZ),
      addXYZ(HX1 + gp + SHX, yGround, -HZ - gp + SHZ),
      addXYZ(HX1 + gp + SHX, yGround,  HZ + gp + SHZ),
      addXYZ(HX0 - gp + SHX, yGround,  HZ + gp + SHZ)
    ];

    /* ======== соседние дома ========
       Башня стояла одна посреди поля. В жизни она стоит в районе, и
       именно соседи объясняют глазу, что это город, а не памятник в
       чистом поле. Дома простые: коробка, плоская кровля, пояс окон.
       Вдали цвет светлее и холоднее — та же воздушная перспектива,
       что и у земли. */
    var city = [], cityCenters = [], cityParts = [];
    var crnd = seeded(31337);

    for (var c2 = 0; c2 < 140 && city.length < 18; c2++) {
      var cang = crnd() * Math.PI * 2;
      var crad = 7.4 + crnd() * 4.6;
      var ccx = Math.cos(cang) * crad, ccz = Math.sin(cang) * crad;
      if (ccx > 0.5 && ccx < 6.4 && Math.abs(ccz) < 2.6) continue;   // за корпусом
      if (ccx < -0.5 && ccx > -6.2 && Math.abs(ccz) < 2.4) continue; // за крылом

      var bi = city.length;
      curPart = 20 + bi;

      var bw = 0.50 + crnd() * 0.70;      // половина длины
      var bd = 0.42 + crnd() * 0.45;      // половина ширины
      var bh = 0.55 + crnd() * 1.05;
      var brot = crnd() * Math.PI;
      var ca2 = Math.cos(brot), sa2 = Math.sin(brot);

      function bpt(lx, lz, y) {
        return addXYZ(ccx + lx * ca2 - lz * sa2, y, ccz + lx * sa2 + lz * ca2);
      }
      var lxs = [-bw, bw, bw, -bw], lzs = [-bd, -bd, bd, bd];
      var nrm = [[0, -1], [1, 0], [0, 1], [-1, 0]];

      /* Дома стоят на склоне, а не на уровне площадки: основание
         опущено по рельефу. Именно это и читается как «город внизу». */
      var cby = groundY(crad);
      var bb = [], bt = [];
      for (var k = 0; k < 4; k++) {
        bb.push(bpt(lxs[k], lzs[k], cby));
        bt.push(bpt(lxs[k], lzs[k], cby + bh));
      }

      var wf = [];
      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4;
        var nx2 = nrm[k][0] * ca2 - nrm[k][1] * sa2;
        var nz2 = nrm[k][0] * sa2 + nrm[k][1] * ca2;
        wf.push(shellRaw('city', bb[k], bb[k1], bt[k1], bt[k], nx2, 0, nz2));
      }
      var rf = shellRaw('cityTop', bt[0], bt[1], bt[2], bt[3], 0, 1, 0);

      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4;
        line(bb[k], bb[k1], MED,  wf[k], wf[k]);
        line(bt[k], bt[k1], MED,  wf[k], rf);
        line(bb[k], bt[k], MED,   wf[(k + 3) % 4], wf[k]);
        outline.push(bb[k], bt[k], wf[(k + 3) % 4], wf[k]);
      }

      // пояс окон: одна лента на стену, дальше глаз всё равно не читает
      var gy0 = cby + bh * 0.40, gy1 = cby + bh * 0.66;
      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4;
        var ix0 = lxs[k] + (lxs[k1] - lxs[k]) * 0.14;
        var iz0 = lzs[k] + (lzs[k1] - lzs[k]) * 0.14;
        var ix1 = lxs[k] + (lxs[k1] - lxs[k]) * 0.86;
        var iz1 = lzs[k] + (lzs[k1] - lzs[k]) * 0.86;
        var nx2 = nrm[k][0] * ca2 - nrm[k][1] * sa2;
        var nz2 = nrm[k][0] * sa2 + nrm[k][1] * ca2;
        var bandId = shellRaw('cityBand',
                 bpt(ix0, iz0, gy0), bpt(ix1, iz1, gy0),
                 bpt(ix1, iz1, gy1), bpt(ix0, iz0, gy1), nx2, 0, nz2);
        var NW = 5;
        for (var w3 = 1; w3 < NW; w3++) {
          var tt = w3 / NW;
          line(bpt(ix0 + (ix1 - ix0) * tt, iz0 + (iz1 - iz0) * tt, gy0),
               bpt(ix0 + (ix1 - ix0) * tt, iz0 + (iz1 - iz0) * tt, gy1),
               THIN, bandId, bandId);
        }
      }

      // всем граням дома ставим его номер — по нему движок их и соберёт
      for (var q2 = shells.length - 9; q2 < shells.length; q2++) shells[q2].bld = bi;
      city.push0 = 0;

      city.push({ x: ccx, z: ccz, h: bh });
      cityCenters.push(ccx, cby + bh * 0.5 - yCenter, ccz);
      cityParts.push(20 + bi);
    }
    curPart = 0;

    /* ======== деревья вокруг ========
       Здание стояло на голой лужайке, и от этого вся сцена читалась
       макетом. Деревья — не украшение: они дают масштаб (глаз меряет
       высоту башни деревьями) и глубину.

       Каждое дерево — не объём, а «билборд»: точка основания в мире,
       а крона рисуется на экране всегда лицом к нам. Настоящая крона
       из граней стоила бы дороже всего остального вместе взятого.
       Форма кроны задана один раз при старте, иначе она мерцает. */
    var trees = [];
    var trnd = seeded(9091);

    function freeSpot(x, z) {
      /* Сектор перед фасадом держим пустым: там вход, каскад лестниц и
         подъём с дороги. Роща, посаженная сплошняком, закрывала именно
         то, ради чего здание и разворачивают к себе. */
      if (z < 0 && Math.abs(x) < Math.abs(z) * 0.9 + 1.6) return false;
      if (x * x + z * z < 3.3 * 3.3) return false;              // стилобат
      if (x > 0.9 && x < 5.3 && Math.abs(z) < 1.9) return false;  // корпус
      if (x < -1.0 && x > -5.1 && Math.abs(z) < 1.5) return false; // крыло
      return true;
    }

    for (var t2 = 0; t2 < 200 && trees.length < 60; t2++) {
      var ang = trnd() * Math.PI * 2;
      var rad = 3.4 + trnd() * 7.2;
      var tx = Math.cos(ang) * rad, tz = Math.sin(ang) * rad;
      if (!freeSpot(tx, tz)) continue;

      var poplar = trnd() < 0.42;                 // тополь — местная примета
      var hh = poplar ? 1.5 + trnd() * 0.9 : 0.85 + trnd() * 0.5;
      var ww = poplar ? 0.16 + trnd() * 0.06 : 0.34 + trnd() * 0.16;
      var wob = new Float32Array(10);
      for (var w2 = 0; w2 < 10; w2++) wob[w2] = 0.82 + trnd() * 0.30;

      trees.push({
        p: addXYZ(tx, groundY(rad), tz),
        h: hh, w: ww, wob: wob,
        tone: trnd() < 0.5 ? 0 : 1,               // два оттенка зелени
        lean: (trnd() - 0.5) * 0.16
      });
    }

    return {
      city: city,
      cityCenters: new Float32Array(cityCenters),
      cityParts: cityParts,
      trees: trees,
      ribs: N,
      floors: F,
      positions: new Float32Array(pos),
      lines: new Uint16Array(lines),
      styles: new Uint8Array(styles),
      parts: new Uint8Array(parts),
      lfa: new Int32Array(lfa),
      lfb: new Int32Array(lfb),
      ldir: new Float32Array(ldir),
      shells: shells,
      cells: cells,
      outline: new Int32Array(outline),
      ground: { ring: new Uint16Array(groundRing), y: yGround - yCenter },
      groundCount: GN,
      hallCenter: [(HX0 + HX1) * 0.5, 0.6 - yCenter, 0],
      hallShadow: new Uint16Array(hallShadow),
      wingCenter: [(WX0 + WX1) * 0.5, 0.5 - yCenter, 0],
      wingShadow: new Uint16Array(wingShadow),
      /* Круги, на которые ложится тень: общая тень здания на земле,
         тень башни на верхней террасе и контактная — узкое плотное
         кольцо у самого основания. Последняя почти не сдвинута вбок:
         у контакта тень не уезжает, и именно она «ставит» здание. */
      shadows: [
        { layer: 0, r: tiers[0].r * 1.16, y: yGround - yCenter,     alpha: 0.20 },
        { layer: 1, r: R * 1.42,          y: tiers[1].y1 - yCenter, alpha: 0.16 },
        { layer: 1, r: R * 1.16,          y: tiers[1].y1 - yCenter, alpha: 0.22, off: 0.30 }
      ],
      height: capY - yGround,
      width: tiers[0].r * 2
    };
  }

  global.Model = { build: build, buildRotunda: build };

})(window);
