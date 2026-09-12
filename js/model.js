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
    var GN = 40, rGround = 7.0;
    var groundRing = new Array(GN);
    for (var i = 0; i < GN; i++) {
      groundRing[i] = addPt((i / GN) * Math.PI * 2, rGround * (0.94 + rnd() * 0.12), yGround);
    }

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
    stairFlight(-2.14, -2.92, tiers[0].y1, yGround,     1.05, 5);
    stairFlight(-1.62, -2.02, tiers[1].y1, tiers[0].y1, 0.70, 5);

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
    var HX0 = 1.70, HX1 = 4.60;     // корпус вытянут вдоль оси X
    var HZ  = 1.50;                 // половина ширины
    var HT  = 0.17;                 // толщина плиты кровли
    var HK  = 26;                   // точек вдоль волны

    // Один плавный период на всю длину: полтора коротких читались
    // горной грядой, а не кровлей.
    function roofTopY(u) { return 1.18 + 0.27 * Math.sin(u * 6.6 - 0.8); }

    var hGndN = [], hGndF = [], hBotN = [], hBotF = [], hTopN = [], hTopF = [];
    var hCrsN = [], hCrsF = [];
    var hCourse = 0.42;             // ряд кладки по стене
    for (var i = 0; i <= HK; i++) {
      var u = i / HK;
      var hx = HX0 + (HX1 - HX0) * u;
      var yt = roofTopY(u), yb = yt - HT;
      hGndN.push(addXYZ(hx, yGround, -HZ));  hGndF.push(addXYZ(hx, yGround, HZ));
      hCrsN.push(addXYZ(hx, hCourse, -HZ));  hCrsF.push(addXYZ(hx, hCourse, HZ));
      hBotN.push(addXYZ(hx, yb, -HZ));       hBotF.push(addXYZ(hx, yb, HZ));
      hTopN.push(addXYZ(hx, yt, -HZ));       hTopF.push(addXYZ(hx, yt, HZ));
    }

    for (var i = 0; i < HK; i++) {
      var wN = face('hall', hGndN[i], hGndN[i + 1], hBotN[i + 1], hBotN[i], 0, 0, -1);
      var wF = face('hall', hGndF[i + 1], hGndF[i], hBotF[i], hBotF[i + 1], 0, 0, 1);
      var sN = face('slab', hBotN[i], hBotN[i + 1], hTopN[i + 1], hTopN[i], 0, 0, -1);
      var sF = face('slab', hBotF[i + 1], hBotF[i], hTopF[i], hTopF[i + 1], 0, 0, 1);
      var rT = face('slabTop', hTopN[i], hTopN[i + 1], hTopF[i + 1], hTopF[i], 0, 1, 0);

      line(hTopN[i], hTopN[i + 1], MED,  sN, rT);   // волна, ближняя сторона
      line(hTopF[i], hTopF[i + 1], MED,  sF, rT);   // волна, дальняя сторона
      line(hBotN[i], hBotN[i + 1], THIN, wN, sN);
      line(hBotF[i], hBotF[i + 1], THIN, wF, sF);
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

    curPart = 0;

    /* Тень нижнего корпуса на земле. Сдвиг вбит теми же числами, что
       и у круглых теней в движке: свет один на всю сцену. */
    var SHX = 0.60, SHZ = -0.27, gp = 0.14;
    var hallShadow = [
      addXYZ(HX0 - gp + SHX, yGround, -HZ - gp + SHZ),
      addXYZ(HX1 + gp + SHX, yGround, -HZ - gp + SHZ),
      addXYZ(HX1 + gp + SHX, yGround,  HZ + gp + SHZ),
      addXYZ(HX0 - gp + SHX, yGround,  HZ + gp + SHZ)
    ];

    return {
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
