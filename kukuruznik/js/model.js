/* ВНИМАНИЕ: этот файл СОБРАН автоматически из src/model/.
   Правки здесь пропадут при следующей сборке — правь куски в src/,
   потом запусти:  python3 build.py                                   */
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

   ГЛАВНОЕ ПРО ОБЪЁМЫ. Каждый объём должен быть ЗАКРЫТ: у коробки шесть
   граней, у кольца — верх, низ и обе стенки. Движок рисует только те
   грани, что повёрнуты к камере, и это честно ровно до тех пор, пока
   объём замкнут. Стоит забыть один торец — и с этой стороны зритель
   смотрит внутрь пустоты: сквозь здание видно небо и повисшие линии.
   Соблазн «эту грань всё равно не видно» почти всегда ошибка.

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
    var F = opt.floors || 14;      // этажей в стволе: башня была 14-этажной гостиницей
    var M = 32;                    // граней у стилобата
    var NS = 32;                   // граней у тарелки: она круглая, не гранёная

    var R  = 1.00;                 // радиус ствола по рёбрам
    var fh = 0.260;                // высота этажа

    // ---- ключевые высоты ----
    var yGround = 0.00;

    /* Подиум — большая ПЛОСКАЯ кровля, не круглый ярус: прямоугольная,
       вытянутая вдоль склона, башня стоит у её задней (верхней,
       уводящей в горку) кромки, а не в центре. К дороге (−Z) она
       спускается тремя уступами — прямоугольными ярусами меньше и
       ниже друг друга. PODX0/PODX1 — общая для всех трёх ширина,
       поэтому уступ виден только со стороны фасада (−Z), а по бокам
       и сзади ярусы идут вровень друг над другом. */
    var PODX0 = -1.35, PODX1 = 3.90;
    var TIERS3 = [
      { z0: -3.10, z1: 0.15, y0: 0.00, y1: 0.12 },
      { z0: -2.05, z1: 0.15, y0: 0.12, y1: 0.30 },
      { z0: -1.00, z1: 0.15, y0: 0.30, y1: 0.50 }
    ];
    var shaftY0 = 0.50;
    var shaftY1 = shaftY0 + F * fh;     // верх ствола

    var railY   = shaftY1 + 0.12;       // верх парапета кровли
    var neckY   = shaftY1 + 0.21;       // низ тарелки
    var rimY    = shaftY1 + 0.29;       // рант тарелки
    var glassY  = shaftY1 + 0.58;       // верх остекления
    var capY    = shaftY1 + 0.84;       // низ бортика макушки
    var mastY   = shaftY1 + 0.97;       // сама макушка

    /* «Гриб», не «летающая тарелка»: тонкая шейка, нависающий диск
       чуть уже ствола (~0.8R — по фото «Вид с холма» диск не шире
       самой башни), пологий колпак сверху. */
    var rNeck = 0.52, rRim = 0.80, rCap = 0.62;

    var yCenter = (yGround + capY) * 0.52;

    // Радиус ствола: ровный цилиндр по всей высоте, без поджатия
    // книзу — так на фото «Фасад» и «У входа».
    function shaftR(y) {
      return R;
    }

    var pos = [];
    var lines = [], styles = [], parts = [];
    var lfa = [], lfb = [];   // две грани, сходящиеся в линии (-1 — нет)
    var ldir = [];            // запасной признак: куда линия смотрит наружу
    var shells = [];          // четырёхугольники для заливки «краской»
    var cells = [];           // чешуйки-лоджии
    var outline = [];         // рёбра-кандидаты на контур
    var outlineParts = [];    // слой каждого ребра — чтобы контур шёл вместе со своим объектом

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
          outlineParts.push(curPart);
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

    /* Прямоугольный объём (не круглый — башне нужны и такие: подиум,
       крыло, соседние дома). Четыре стены между двумя прямоугольными
       контурами на разной высоте; каждая стена — со своей нормалью
       наружу, а не вычисленной по кругу, как в band(). Возвращает
       нижнее/верхнее кольцо точек и грани стен по сторонам
       (0:−Z, 1:+X, 2:+Z, 3:−X), плюс сама ставит рёбра и линии между
       ними и добавляет вертикальные стыки в контур силуэта. */
    var RECT_NRM = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    function rectBox(kind, x0, x1, z0, z1, y0, y1, skipOutline) {
      var xs = [x0, x1, x1, x0], zs = [z0, z0, z1, z1];
      var bb = new Array(4), tt = new Array(4);
      for (var k = 0; k < 4; k++) {
        bb[k] = addXYZ(xs[k], y0, zs[k]);
        tt[k] = addXYZ(xs[k], y1, zs[k]);
      }
      var faces = new Array(4);
      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4;
        faces[k] = face(kind, bb[k], bb[k1], tt[k1], tt[k],
                         RECT_NRM[k][0], 0, RECT_NRM[k][1]);
      }
      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4, kp = (k + 3) % 4;
        line(bb[k], bb[k1], MED, faces[k], faces[k]);
        line(tt[k], tt[k1], MED, faces[k], faces[k]);
        line(bb[k], tt[k], THIN, faces[kp], faces[k]);
        if (!skipOutline) { outline.push(bb[k], tt[k], faces[kp], faces[k]); outlineParts.push(curPart); }
      }
      return { bb: bb, tt: tt, faces: faces };
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

    /* Склон срезан ОДНОЙ каменной подпорной стеной вдоль дороги внизу —
       не лесенкой в четыре яруса, как раньше. Дальше, между стеной и
       краем участка, — просто травяной склон без ступеней: рельеф
       нужен, чтобы город лежал ниже здания, а не как самоцель. */
    /* Масштаб: башня высотой 5.2 единицы — это около 60 метров, значит
       единица примерно 11 метров. Подпорная стенка в жизни метра три,
       то есть 0.27 единицы. Первый заход дал стенки по 1.05 — вышли
       заборы в четыре этажа, накрывшие треть экрана. Радиус первой
       стены отодвинут за угол прямоугольного подиума и крыла с
       пристройкой, чтобы они не протыкали склон. */
    var TR = [
      { r: 6.30, y: yGround },
      { r: 8.20, y: yGround - 0.42 }
    ];
    var hFoot = yGround - 1.75;    // низ склона у края земли

    /* Высота земли на радиусе r. По ней сажается ВСЁ, что стоит
       снаружи площадки: деревья, соседние дома, тени. */
    function groundY(r) {
      if (r <= TR[0].r) return TR[0].y;
      for (var i = 1; i < TR.length; i++) if (r <= TR[i].r) return TR[i].y;
      var last = TR[TR.length - 1];
      var t = (r - last.r) / (rGround - last.r);
      if (t > 1) t = 1;
      return last.y + (hFoot - last.y) * t;
    }

    var groundRing = new Array(GN);
    for (var i = 0; i < GN; i++) {
      var rg = rGround * (0.94 + rnd() * 0.12);
      groundRing[i] = addPt((i / GN) * Math.PI * 2, rg, groundY(rg));
    }

    var FRONT_A = -Math.PI / 2;       // куда смотрит фасад: в сторону −Z

    /* ======== подпорные террасы склона ======== */
    curPart = 2;
    var TM = 28;
    for (var ti = 0; ti < TR.length; ti++) {
      var yTop2 = TR[ti].y;
      var yBot2 = (ti + 1 < TR.length) ? TR[ti + 1].y : hFoot;
      var rIn2  = TR[ti].r;
      var rOut2 = (ti + 1 < TR.length) ? TR[ti + 1].r : rGround * 0.97;

      /* Тут важно то, на чём я уже обжёгся: мало опустить КРАЙ земли.
         Если между площадкой и краем нет настоящей поверхности, то
         рельеф есть только в силуэте, а всё, что на нём стоит, висит
         или тонет. Поэтому у каждой ступени два пояса: отвесная
         каменная стенка и горизонтальная площадка под ней. Именно на
         эти площадки и садятся деревья с домами. */
      var stone = ti + 1 < TR.length;

      var wTop = ring(TM, rIn2, yTop2);
      var wBot = ring(TM, rIn2, yBot2);
      var apron = ring(TM, rOut2, yBot2);

      if (stone) {
        var wIds = band('terr', wBot, wTop, 0, true);
        var aIds = band('terrTop', apron, wBot, 6, true);
        ringLines(wTop, MED, wIds, null);
        ringLines(wBot, THIN, aIds, wIds);
      } else {
        // последняя ступень — не стенка, а трава, уходящая вниз склоном
        band('terrTop', apron, wTop, 2, true);
      }
    }
    curPart = 0;

    // ======== подиум: три прямоугольных уступа к дороге ========
    /* Большая плоская кровля вместо круглого стилобата. Все три яруса
       делят одну ширину (PODX0..PODX1) и одну заднюю кромку (z1) —
       поэтому уступ виден только со стороны фасада (−Z, к дороге), а
       по бокам и сзади ярусы стоят точно друг над другом, без щелей.
       Башня стоит на верхнем (третьем) ярусе, у его задней кромки. */
    curPart = 3;
    var tierBoxes = [];
    for (var t = 0; t < TIERS3.length; t++) {
      var tz = TIERS3[t];
      tierBoxes[t] = rectBox('podium', PODX0, PODX1, tz.z0, tz.z1, tz.y0, tz.y1);
    }

    /* Открытая площадка каждого яруса — только та полоса, что не
       накрыта следующим ярусом сверху (у верхнего яруса открыта вся
       кровля целиком). */
    function deckStrip(z0, z1, y) {
      var a = addXYZ(PODX0, y, z0), b = addXYZ(PODX1, y, z0);
      var c = addXYZ(PODX1, y, z1), d = addXYZ(PODX0, y, z1);
      var id = face('deck', a, b, c, d, 0, 1, 0);
      line(a, b, MED, id, id);
      line(d, c, MED, id, id);
      return { id: id, a: a, b: b, c: c, d: d };
    }
    var decks = [];
    for (var t = 0; t < TIERS3.length; t++) {
      var frontZ = TIERS3[t].z0;
      var backZ  = (t + 1 < TIERS3.length) ? TIERS3[t + 1].z0 : TIERS3[t].z1;
      decks[t] = deckStrip(frontZ, backZ, TIERS3[t].y1);
      // шов между открытой площадкой и стеной яруса
      line(decks[t].a, decks[t].d, THIN, decks[t].id, decks[t].id);
      line(decks[t].b, decks[t].c, THIN, decks[t].id, decks[t].id);
    }

    /* Галереи — лёгкие навесы вдоль открытого края каждого яруса.
       Дёшево: столбики и один поручень, без своей крыши. У прохода
       лестницы столбик пропускаем — иначе он стоит прямо в проёме. */
    var galleryPosts = [];
    var STAIR_GAP_X = [1.10, 1.85, 1.10];   // проход на каждом ярусе — см. STX0/STX1 ниже
    for (var t = 0; t < TIERS3.length; t++) {
      var gz = TIERS3[t].z0 + 0.03;
      var gy0 = TIERS3[t].y1, gy1 = gy0 + 0.16;
      var GP = 9;
      for (var gi = 0; gi <= GP; gi++) {
        var gx = PODX0 + (PODX1 - PODX0) * (gi / GP);
        if (Math.abs(gx - STAIR_GAP_X[t]) < 0.5) continue;
        galleryPosts.push({
          b: addXYZ(gx, gy0, gz),
          t: addXYZ(gx, gy1, gz)
        });
      }
    }

    /* Простые объёмы на кровле верхнего яруса — по фото «Вид с холма»
       там стоит пара служебных построек, а не голая плита. Обычные
       коробки с плоской крышей, без окон и лоджий. */
    var roofBoxes = [
      { x0: 2.35, x1: 3.55, z0: -0.85, z1: -0.10, h: 0.30 },
      { x0: 2.55, x1: 3.35, z0: 0.20,  z1: 0.60,  h: 0.20 }
    ];
    for (var rb2 = 0; rb2 < roofBoxes.length; rb2++) {
      var rB = roofBoxes[rb2];
      var box = rectBox('podium', rB.x0, rB.x1, rB.z0, rB.z1, TIERS3[2].y1, TIERS3[2].y1 + rB.h);
      var topId = face('deck', box.tt[0], box.tt[1], box.tt[2], box.tt[3], 0, 1, 0);
      for (var bk = 0; bk < 4; bk++) line(box.tt[bk], box.tt[(bk + 1) % 4], THIN, topId, topId);
    }

    // ======== лестницы-зигзаг: земля → ярус 0 → ярус 1 → ярус 2 ========
    /* Марш идёт вдоль Z (к дороге), а не по кругу, как раньше. Каждый
       следующий марш сдвинут по X в другую сторону от предыдущего —
       отсюда и «зигзаг», а не один прямой марш через все три яруса. */
    function stairFlightZ(xC, halfW, zTop, zBot, yTop, yBot, steps) {
      var rise = (yTop - yBot) / steps;
      var run  = (zBot - zTop) / steps;
      for (var i = 0; i < steps; i++) {
        var yH = yTop - rise * i;
        var zI = zTop + run * i, zO = zTop + run * (i + 1);
        var aL = addXYZ(xC - halfW, yH, zI), aR = addXYZ(xC + halfW, yH, zI);
        var bL = addXYZ(xC - halfW, yH, zO), bR = addXYZ(xC + halfW, yH, zO);
        var cL = addXYZ(xC - halfW, yH - rise, zO), cR = addXYZ(xC + halfW, yH - rise, zO);
        var tread = face('deck', aR, aL, bL, bR, 0, 1, 0);
        var riser = face('podium', bL, cL, cR, bR, 0, 0, -1);
        line(bL, bR, MED, tread, riser);
      }
      var tL = addXYZ(xC - halfW, yTop, zTop), tR = addXYZ(xC + halfW, yTop, zTop);
      var oL = addXYZ(xC - halfW, yBot, zBot), oR = addXYZ(xC + halfW, yBot, zBot);
      var gL = addXYZ(xC - halfW, yBot, zTop), gR = addXYZ(xC + halfW, yBot, zTop);
      var chL = face('podium', tL, oL, gL, gL, -1, 0, 0);
      var chR = face('podium', oR, tR, gR, gR, 1, 0, 0);
      line(tL, oL, MED, chL, chL);
      line(tR, oR, MED, chR, chR);
    }
    var STX0 = 1.10, STX1 = 1.85, STHW = 0.42;
    stairFlightZ(STX0, STHW, TIERS3[2].z0, TIERS3[1].z0 + 0.55, TIERS3[2].y1, TIERS3[1].y1, 4);
    stairFlightZ(STX1, STHW, TIERS3[1].z0, TIERS3[0].z0 + 0.55, TIERS3[1].y1, TIERS3[0].y1, 4);
    stairFlightZ(STX0, STHW, TIERS3[0].z0, TIERS3[0].z0 - 0.90, TIERS3[0].y1, yGround,     3);

    // ======== свободно стоящий портал ========
    /* Арка стоит отдельно от стены, посреди подхода к зданию — как
       ворота, а не врезанный в стилобат проём. Две тонкие опоры и
       плоская арочная перемычка между ними, видная с обеих сторон. */
    var PORTAL_X = STX0, PORTAL_Z = TIERS3[0].z0 - 1.55;
    var PORTAL_W = 0.95, PORTAL_PW = 0.14, PORTAL_H = 0.62, PORTAL_TOPH = 0.20;
    var pgY = groundY(Math.hypot(PORTAL_X, PORTAL_Z));
    for (var ps = -1; ps <= 1; ps += 2) {
      var pcx = PORTAL_X + ps * PORTAL_W * 0.5;
      rectBox('podium', pcx - PORTAL_PW * 0.5, pcx + PORTAL_PW * 0.5,
              PORTAL_Z - PORTAL_PW * 0.5, PORTAL_Z + PORTAL_PW * 0.5,
              pgY, pgY + PORTAL_H, true);
    }
    var lintelY0 = pgY + PORTAL_H - 0.02, lintelY1 = pgY + PORTAL_H + PORTAL_TOPH;
    var lintelX0 = PORTAL_X - PORTAL_W * 0.5 - PORTAL_PW * 0.5;
    var lintelX1 = PORTAL_X + PORTAL_W * 0.5 + PORTAL_PW * 0.5;
    cells.push({
      grp: 3, arch: true,
      a: addXYZ(lintelX1, lintelY0, PORTAL_Z), b: addXYZ(lintelX0, lintelY0, PORTAL_Z),
      c: addXYZ(lintelX0, lintelY1, PORTAL_Z), d: addXYZ(lintelX1, lintelY1, PORTAL_Z),
      nx: 0, ny: 0, nz: -1, vis: false, lit: 0
    });
    cells.push({
      grp: 3, arch: true,
      a: addXYZ(lintelX0, lintelY0, PORTAL_Z), b: addXYZ(lintelX1, lintelY0, PORTAL_Z),
      c: addXYZ(lintelX1, lintelY1, PORTAL_Z), d: addXYZ(lintelX0, lintelY1, PORTAL_Z),
      nx: 0, ny: 0, nz: 1, vis: false, lit: 0
    });

    // ======== длинная прямая лестница вверх по склону, к порталу ========
    var LSTX = PORTAL_X, LSTHW = 0.50;
    var lstZBot = PORTAL_Z - 2.10;
    var lstYBot = groundY(Math.hypot(LSTX, lstZBot));
    stairFlightZ(LSTX, LSTHW, PORTAL_Z - 0.55, lstZBot, pgY, lstYBot, 7);
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
    /* Приплюснутый овал вместо высокой арки: ячейка ниже (margin у пола
       и потолка заметно больше, чем раньше), а освободившийся зазор
       между этажами становится светлым поясом — эффект «початка».
       Движок (archPath, без f.arch) сам рисует внутри овал, а не арку. */
    var loggiaBot = 0.20, loggiaTop = 0.20;    // доля этажа под/над овалом
    for (var f = 0; f < F; f++) {
      var yb = shaftY0 + f * fh + fh * loggiaBot;
      var yt = shaftY0 + (f + 1) * fh - fh * loggiaTop;
      var rb = shaftR(yb) * 0.92;
      var rt = shaftR(yt) * 0.92;
      for (var i = 0; i < N; i++) {
        var a0 = i * pitch + pitch * 0.10;
        var a1 = i * pitch + pitch * 0.90;
        cells.push({
          a: addPt(a0, rb, yb), b: addPt(a1, rb, yb),
          c: addPt(a1, rt, yt), d: addPt(a0, rt, yt),
          nx: Math.cos((a0 + a1) * 0.5), ny: 0, nz: Math.sin((a0 + a1) * 0.5),
          vis: false, lit: 0,
          lamp: rnd()          // горит ли окно ночью
        });
      }
    }

    /* Светлые горизонтальные пояса между этажами — та самая ребристость
       «початка». Пояс кольцевой (не по чешуйкам), поэтому не пропадает
       на стыках лоджий и читается как непрерывная линия вокруг ствола.
       Раскраска — отдельным проходом в движке, ПОСЛЕ тени на стволе,
       иначе направленная светотень ствола перекрасит светлый пояс. */
    for (var f = 0; f < F - 1; f++) {
      var ybBelt = shaftY0 + (f + 1) * fh - fh * loggiaTop;
      var ytBelt = shaftY0 + (f + 1) * fh + fh * loggiaBot;
      var beltLo = ring(N, shaftR(ybBelt), ybBelt);
      var beltHi = ring(N, shaftR(ytBelt), ytBelt);
      var beltId = band('floorBelt', beltLo, beltHi, 0, true);
      ringLines(beltLo, THIN, shaftIds[f], beltId);
      ringLines(beltHi, THIN, beltId, shaftIds[f + 1]);
    }

    /* ======== тарелка ========
       ВРАЩАЕТСЯ. Наверху было вращающееся кафе, и крутился весь верхний
       объём целиком: барабан остекления, колпак, макушка. Люди внутри
       ехали вместе с ним.

       Поэтому все точки и грани этого куска помечаются как «вертушка»,
       а движок перед проекцией доворачивает их вокруг оси на угол,
       зависящий от времени. Пересчитывать саму модель каждый кадр не
       нужно — достаточно одного лишнего поворота на точку. */
    var spin0 = pos.length / 3;
    var spinShell0 = shells.length;

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
    /* Каждой панели остекления — свой номер. По нему движок красит их
       чуть по-разному: без этого барабан выглядит однотонным кольцом и
       понять, что он поворачивается, невозможно. */
    for (var gj = 0; gj < glassIds.length; gj++) shells[glassIds[gj]].idx = gj;
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

    /* Таблички «КАФЕ» на барабане больше нет — название по фото не
       подтверждено, а выдумывать подписи на здании было решено не
       делать (см. docs/PRAVILA.md). */

    var spin1 = pos.length / 3;
    for (var sp2 = spinShell0; sp2 < shells.length; sp2++) shells[sp2].spin = true;

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
    /* ПРАВИЛО: объём должен быть ЗАКРЫТ со всех сторон.
       Восточного торца у крыла не было — я считал, что он спрятан в
       стилобате. Но стилобат высотой 0.5, а крыло выше втрое, и с той
       стороны зритель смотрел ВНУТРЬ пустой коробки: стена отвёрнута,
       изнанки нет, сквозь объём видно небо и линии кровли. Это и есть
       «пустые полоски» при повороте. */
    face('wing', wgF0, wgN0, wtN0, wtF0, 1, 0, 0);

    // плита кровли: короб с выносом на три стороны
    var sbN0 = addXYZ(WX0, WY,  -WZ - WO), sbN1 = addXYZ(WX1 - WO, WY,  -WZ - WO);
    var sbF0 = addXYZ(WX0, WY,   WZ + WO), sbF1 = addXYZ(WX1 - WO, WY,   WZ + WO);
    var stN0 = addXYZ(WX0, WYT, -WZ - WO), stN1 = addXYZ(WX1 - WO, WYT, -WZ - WO);
    var stF0 = addXYZ(WX0, WYT,  WZ + WO), stF1 = addXYZ(WX1 - WO, WYT,  WZ + WO);

    var slabN = face('wingSlab', sbN0, sbN1, stN1, stN0,  0, 0, -1);
    var slabF = face('wingSlab', sbF1, sbF0, stF0, stF1,  0, 0,  1);
    var slabW = face('wingSlab', sbN1, sbF1, stF1, stN1, -1, 0,  0);
    var slabT = face('wingTop',  stN0, stN1, stF1, stF0,  0, 1,  0);
    face('wingSlab', sbF0, sbN0, stN0, stF0, 1, 0, 0);      // торец плиты

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
    face('wingUp', bF0, bN0, bT0, bG0, 1, 0, 0);            // торец этажа

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
    face('wingUpCorn', kF0, kN0, kTN0, kTF0, 1, 0, 0);      // торец карниза

    line(wl(WYT, WZB), bN1, MED, bFront, bFront);
    line(bN1, bT1, MED, bFront, bWest);
    line(bF1, bG1, MED, bBack,  bWest);
    line(wl(WY2, WZB - kO), kN1, THIN, kA, kA);
    line(wl(kY, WZB - kO), kTN1, MED, kA, kT);
    line(wl(kY,  WZ + kO), kTF1, MED, kB, kT);
    line(kTN1, kTF1, MED, kC, kT);
    line(kN1, kTN1, MED, kA, kC);

    outline.push(bN1, bT1, bFront, bWest); outlineParts.push(curPart);
    outline.push(kN1, kTN1, kA, kC); outlineParts.push(curPart);

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
    face('wingCorn', cnF0, cnN0, ctN0, ctF0, 1, 0, 0);      // торец карниза аркады
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
    face('wingRail', stF0, stN0, pN0, pF0, 1, 0, 0);        // торец бортика
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

    outline.push(wgN1, wtN1, wallN, wallW); outlineParts.push(curPart);
    outline.push(pN1, pF1, rlW, rlW); outlineParts.push(curPart);
    outline.push(wgF1, wtF1, wallF, wallW); outlineParts.push(curPart);

    /* Сами арки. Это те же «чешуйки», что и лоджии на стволе, только
       без балкона: узкий проём с полуовальным верхом, внутри тень. */
    var AN = 9;
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
    /* Тень свода на левом конце крыла (hallShadow) теперь считает сам
       свод — см. 06-lowblock.js. Он идёт следующим файлом и знает
       HX0/HX1/HZ, а этот файл про них ничего не знает первым: свод
       ставится ОТ края крыла (WX1), а не наоборот. */

    // ======== торцевой объём со сводом-полуцилиндром ========
    /* Стоит на левом конце длинного крыла (WX1 из 06-wing.js), продолжая
       его дальше наружу. Волнистой крыши больше нет: вместо неё —
       полукруглый свод, а торец, глядящий наружу, — большая остеклённая
       арка. Ближний торец, что смотрит на крыло, наглухо закрыт стеной:
       два объёма стоят впритык, а не срослись в один. */
    curPart = 4;
    var HX0 = WX1, HX1 = WX1 - 1.35;   // от края крыла — дальше наружу
    var HZ  = WZ;                        // та же ширина, что у крыла
    var HWY = WY;                        // высота стен до пят свода
    var HN  = 8;                         // сечений вдоль длины свода
    var HK  = 10;                        // граней полукруга свода — чем больше, тем глаже дуга

    var profiles = [];
    for (var hi = 0; hi <= HN; hi++) {
      var hu = hi / HN;
      var hx = HX0 + (HX1 - HX0) * hu;
      var prof = [];
      prof.push(addXYZ(hx, yGround, -HZ));               // 0: низ левой стены
      for (var hk = 0; hk <= HK; hk++) {
        var hang = Math.PI - Math.PI * (hk / HK);         // π → 0
        prof.push(addXYZ(hx, HWY + HZ * Math.sin(hang), HZ * Math.cos(hang)));
      }
      prof.push(addXYZ(hx, yGround, HZ));                // последний: низ правой стены
      profiles.push(prof);
    }
    var PN = profiles[0].length;                          // = HK + 3

    var hallShellsAt = [];                                 // грани по сечению i (для линий кромки)
    for (var hi = 0; hi < HN; hi++) {
      var p0 = profiles[hi], p1 = profiles[hi + 1];
      var rowShells = [];
      for (var pj = 0; pj < PN - 1; pj++) {
        var isWall = (pj === 0 || pj === PN - 2);
        var kind = isWall ? 'hall' : 'slab';
        var midAng = Math.PI - Math.PI * ((pj - 0.5) / HK);
        var nx0 = 0, ny0 = isWall ? 0 : Math.sin(midAng), nz0 = isWall ? (pj === 0 ? -1 : 1) : Math.cos(midAng);
        var sid = face(kind, p0[pj], p0[pj + 1], p1[pj + 1], p1[pj], nx0, ny0, nz0);
        rowShells.push(sid);
        line(p0[pj], p0[pj + 1], THIN, sid, sid);
      }
      hallShellsAt.push(rowShells);
      if (hi % 2 === 1) {
        for (var pj2 = 1; pj2 < PN - 1; pj2++) line(p0[pj2], p1[pj2], THIN, rowShells[pj2 - 1], rowShells[pj2]);
      }
    }
    // продольная кромка пят свода — там, где стена переходит в свод
    for (var hi2 = 0; hi2 < HN; hi2++) {
      line(profiles[hi2][1], profiles[hi2 + 1][1], MED, hallShellsAt[hi2][0], hallShellsAt[hi2][1]);
      line(profiles[hi2][PN - 2], profiles[hi2 + 1][PN - 2], MED, hallShellsAt[hi2][PN - 3], hallShellsAt[hi2][PN - 2]);
    }
    // веер-заглушка: fan-триангуляция выпуклого профиля от точки 0
    function fanCap(kind, prof, nx) {
      var ids = [];
      for (var i = 1; i < prof.length - 1; i++) {
        ids.push(face(kind, prof[0], prof[i], prof[i + 1], prof[i + 1], nx, 0, 0));
      }
      return ids;
    }
    // ближний торец (к крылу) — глухая стена
    var nearIds = fanCap('hall', profiles[0], 1);
    for (var ni = 0; ni < profiles[0].length - 1; ni++) {
      line(profiles[0][ni], profiles[0][ni + 1], THIN, nearIds[Math.max(0, ni - 1)], nearIds[Math.min(nearIds.length - 1, ni)]);
    }
    // дальний торец (наружу) — большая остеклённая арка
    var farIds = fanCap('hallGlass', profiles[HN], -1);
    for (var fi = 0; fi < profiles[HN].length - 1; fi++) {
      line(profiles[HN][fi], profiles[HN][fi + 1], THIN, farIds[Math.max(0, fi - 1)], farIds[Math.min(farIds.length - 1, fi)]);
    }

    var hallShadow = [
      addXYZ(HX0 + 0.30, yGround, -HZ - 0.10 - 0.14),
      addXYZ(HX1 - 0.10 + 0.30, yGround, -HZ - 0.10 - 0.14),
      addXYZ(HX1 - 0.10 + 0.30, yGround,  HZ + 0.10 - 0.14),
      addXYZ(HX0 + 0.30, yGround,  HZ + 0.10 - 0.14)
    ];
    curPart = 0;
    /* ======== соседние дома ========
       По прямому указанию в задании на финальный вид сцены — соседние
       дома НЕ делать (как и интерьеры, и склон ущелья). Раньше здесь
       стояли 14 случайных коробок вокруг участка; теперь массив пуст,
       а движок и без них корректно рисует пустые списки (проверено —
       буквально везде идёт `if (!list) return` / `for (...; i<0; ...)`
       по length). Дальний свет города внизу (см. 09-props.js, glow)
       остаётся: это не объёмы, а точки тёплого света на склоне. */
    var city = [], cityCenters = [], cityParts = [];
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
      /* Сектор перед фасадом держим пустым: там портал, зигзаг лестниц
         и длинный подъём с дороги. Роща, посаженная сплошняком,
         закрывала именно то, ради чего здание и разворачивают к себе. */
      if (z < 0 && Math.abs(x - 1.4) < Math.abs(z) * 0.55 + 0.9) return false;
      if (x > PODX0 - 0.3 && x < PODX1 + 0.3 && z > -3.4 && z < 0.6) return false;   // подиум
      if (x > WX1 - 0.3 && x < WX0 + 0.3 && Math.abs(z) < WZ + 0.35) return false;   // крыло
      if (x > HX1 - 0.3 && x < HX0 + 0.3 && Math.abs(z) < HZ + 0.35) return false;   // свод
      return true;
    }

    for (var t2 = 0; t2 < 200 && trees.length < 46; t2++) {
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

    /* Пара деревьев прямо у длинной лестницы — по бокам подъёма,
       упрощённо (те же billboard-кроны, что и у остальной рощи). */
    (function () {
      var lstMidZ = (PORTAL_Z - 0.55 + (PORTAL_Z - 2.10)) * 0.5;
      var sideX = [LSTX - LSTHW - 0.45, LSTX + LSTHW + 0.45];
      for (var si = 0; si < 2; si++) {
        var sx = sideX[si], sz = lstMidZ + (si - 0.5) * 0.6;
        var wob2 = new Float32Array(10);
        for (var w3 = 0; w3 < 10; w3++) wob2[w3] = 0.82 + trnd() * 0.30;
        trees.push({
          p: addXYZ(sx, groundY(Math.hypot(sx, sz)), sz),
          h: 1.5 + trnd() * 0.6, w: 0.18 + trnd() * 0.05, wob: wob2,
          tone: si, lean: (trnd() - 0.5) * 0.12
        });
      }
    })();

    /* ======== мощение ========
       Трава прямо под зданием выглядела дачей. Перед подиумом и у
       портала — простая мощёная площадка (прямоугольная: подиум и сам
       не круглый). Дальше начинается склон — там уже трава. */
    curPart = 2;
    var pv0 = addXYZ(HX1 - 0.4, yGround + 0.004, -4.80);
    var pv1 = addXYZ(PODX1 + 0.6, yGround + 0.004, -4.80);
    var pv2 = addXYZ(PODX1 + 0.6, yGround + 0.004, 0.60);
    var pv3 = addXYZ(HX1 - 0.4, yGround + 0.004, 0.60);
    face('pave', pv0, pv1, pv2, pv3, 0, 1, 0);
    curPart = 0;

    /* ======== флаги ========
       На фотографиях у входа стоят флагштоки. Раньше — у входа в
       круглый стилобат; теперь у свободно стоящего портала, тем же
       рядом из трёх. Полотнище само по себе даёт движение — и это
       движение живое, а не зациклённое. */
    var flags = [];
    for (var fi = 0; fi < 3; fi++) {
      var ffx = PORTAL_X + (fi - 1) * 0.34;
      var ffz = PORTAL_Z + 0.55;
      flags.push({
        b: addXYZ(ffx, pgY, ffz),
        t: addXYZ(ffx, pgY + 0.62, ffz),
        ph: fi * 1.7
      });
    }

    /* Надписи на крыле больше нет — название по фото не подтверждено
       (см. правило про выдуманные детали в docs/PRAVILA.md). */

    /* ======== огни города внизу ========
       Ночью нижняя половина кадра проваливалась в черноту: светилась
       только башня и висела в пустоте. Внизу под холмом должен лежать
       город — россыпь тёплых окон и цепочки уличных фонарей по склону.
       Это не объёмы, а просто точки на земле: объёмы там всё равно не
       разглядеть, а свет виден. */
    var glow = [];
    var grnd2 = seeded(20260913);
    for (var gi = 0; gi < 240; gi++) {
      var ga = grnd2() * Math.PI * 2;
      var gr = 5.4 + grnd2() * 7.4;
      var gx = Math.cos(ga) * gr, gz = Math.sin(ga) * gr;
      if (gx * gx + gz * gz < 5.2 * 5.2) continue;
      glow.push(addXYZ(gx, groundY(gr) + 0.02, gz));
    }

    /* ======== фонари ========
       На фотографии у входа стоят фонари на тонких мачтах. Ночью они
       единственное, что светит на площадку — без них терраса остаётся
       чёрным пятном, даже когда в окнах горит свет. */
    var lamps = [];
    var LAMP_H = 0.34;

    // мачта не должна вырастать посреди подиума, крыла или свода
    function lampFree(x, z) {
      if (x > PODX0 - 0.2 && x < PODX1 + 0.2 && z > -3.3 && z < 0.6) return false;  // подиум
      if (x > WX1 - 0.2 && x < WX0 + 0.2 && Math.abs(z) < WZ + 0.2) return false;   // крыло
      if (x > HX1 - 0.2 && x < HX0 + 0.2 && Math.abs(z) < HZ + 0.2) return false;   // свод
      return true;
    }

    // Ряд фонарей вдоль открытого паркета перед подиумом.
    for (var li = 0; li < 10; li++) {
      var lx2 = PODX0 + (PODX1 - PODX0) * (li / 9);
      var lz2 = TIERS3[0].z0 - 0.45;
      if (!lampFree(lx2, lz2)) continue;
      lamps.push({
        b: addXYZ(lx2, groundY(Math.hypot(lx2, lz2)), lz2),
        t: addXYZ(lx2, groundY(Math.hypot(lx2, lz2)) + LAMP_H, lz2)
      });
    }

    /* У портала и вдоль длинной лестницы — двумя чёткими рядами по
       сторонам от прохода, как и положено на парадном подходе. */
    for (var side = -1; side <= 1; side += 2) {
      for (var step = 0; step < 4; step++) {
        var lz3 = PORTAL_Z + 0.3 - step * 0.95;
        var lx3 = PORTAL_X + side * (PORTAL_W * 0.5 + 0.45);
        if (!lampFree(lx3, lz3)) continue;
        lamps.push({
          b: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)), lz3),
          t: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)) + LAMP_H, lz3)
        });
      }
    }

    /* ======== скамейки ========
       Мелочь, которой не замечаешь, но без которой площадь не похожа
       на место, где бывают люди. Стоят вдоль паркета перед подиумом. */
    var benches = [];
    for (var bi3 = 0; bi3 < 8; bi3++) {
      var bx3 = HX1 + 0.3 + (PODX1 - HX1 - 0.6) * (bi3 / 7);
      var bz3 = TIERS3[0].z0 - 0.85;
      if (!lampFree(bx3, bz3)) continue;
      var byy = groundY(Math.hypot(bx3, bz3));
      benches.push({
        a: addXYZ(bx3 - 0.17, byy + 0.075, bz3),
        b: addXYZ(bx3 + 0.17, byy + 0.075, bz3),
        c: addXYZ(bx3 - 0.17, byy, bz3),
        d: addXYZ(bx3 + 0.17, byy, bz3)
      });
    }

    /* ======== кусты у подножия ======== */
    for (var bu = 0; bu < 14; bu++) {
      var ua = trnd() * Math.PI * 2;
      var ur = 3.0 + trnd() * 1.6;
      var ux = Math.cos(ua) * ur, uz = Math.sin(ua) * ur;
      if (!freeSpot(ux, uz)) continue;
      var uw = new Float32Array(10);
      for (var uk = 0; uk < 10; uk++) uw[uk] = 0.80 + trnd() * 0.34;
      trees.push({
        p: addXYZ(ux, groundY(ur), uz),
        h: 0.30 + trnd() * 0.14, w: 0.26 + trnd() * 0.10,
        wob: uw, tone: trnd() < 0.5 ? 0 : 1, lean: 0, bush: true
      });
    }

    /* Указатель «какие линии принадлежат какому слою». Без него движок
       при рисовании каждого предмета пробегал ВЕСЬ список линий: у
       четырнадцати соседних домов это четырнадцать проходов по полутора
       тысячам линий на каждый из шести штрихов. Отсюда и просадка до
       тридцати кадров на телефоне. */
    /* То же самое для заливок: у каждого сорта поверхности свой список
       граней. Иначе каждая заливка (а их за кадр под сотню) пробегает
       все полторы тысячи граней сцены. */
    var shellIndex = {};
    for (var si2 = 0; si2 < shells.length; si2++) {
      var kk = shells[si2].kind;
      (shellIndex[kk] || (shellIndex[kk] = [])).push(si2);
    }
    for (var sk in shellIndex) shellIndex[sk] = new Uint32Array(shellIndex[sk]);

    var partIndex = {};
    for (var pi = 0; pi < parts.length; pi++) {
      (partIndex[parts[pi]] || (partIndex[parts[pi]] = [])).push(pi);
    }
    for (var pk in partIndex) partIndex[pk] = new Uint32Array(partIndex[pk]);

    return {
      /* Вращающееся кафе под колпаком: наружу отдаём только кольцо, по
         которому движок рассадит силуэты. Столики в модели не нужны —
         они живут на экране. */
      cafe: {
        r: rRim * 0.90,
        y: (rimY + glassY) * 0.5 - yCenter
      },
      spinRange: [spin0, spin1],
      glow: new Uint16Array(glow),
      shellIndex: shellIndex,
      partIndex: partIndex,
      flags: flags,
      benches: benches,
      lamps: lamps,
      galleryPosts: galleryPosts,
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
      outlineParts: new Int32Array(outlineParts),
      ground: { ring: new Uint16Array(groundRing), y: yGround - yCenter },
      groundCount: GN,
      hallCenter: [(HX0 + HX1) * 0.5, 0.6 - yCenter, 0],
      hallShadow: new Uint16Array(hallShadow),
      wingCenter: [(WX0 + WX1) * 0.5, 0.5 - yCenter, 0],
      wingShadow: new Uint16Array(wingShadow),
      /* Круги, на которые ложится тень: общая тень подиума на земле
         (круг лишь приближает прямоугольный след — центр сдвинут к
         середине подиума), тень башни на верхнем ярусе и контактная —
         узкое плотное кольцо у самого основания. Последняя почти не
         сдвинута вбок: у контакта тень не уезжает, и именно она
         «ставит» здание. */
      shadows: [
        { layer: 0, r: 3.3, cx: (PODX0 + PODX1) * 0.5, cz: (TIERS3[0].z0 + TIERS3[0].z1) * 0.5,
          y: yGround - yCenter, alpha: 0.20 },
        { layer: 1, r: R * 1.42,          y: TIERS3[2].y1 - yCenter, alpha: 0.16 },
        { layer: 1, r: R * 1.16,          y: TIERS3[2].y1 - yCenter, alpha: 0.22, off: 0.30 }
      ],
      height: capY - yGround,
      width: PODX1 - PODX0
    };
  }

  global.Model = { build: build, buildRotunda: build };

})(window);
