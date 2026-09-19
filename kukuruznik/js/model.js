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
    /* Ширина всего комплекса (от торца свода до края подиума) —
       3-4 диаметра ствола, как в задании. Было 4.8 при PODX1=3.90. */
    var PODX0 = -1.20, PODX1 = 2.20;
    var TIERS3 = [
      { z0: -3.10, z1: 1.30, y0: 0.00, y1: 0.13 },
      { z0: -2.05, z1: 1.30, y0: 0.13, y1: 0.30 },
      { z0: -1.15, z1: 1.30, y0: 0.30, y1: 0.50 }
    ];
    var shaftY0 = 0.46;
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

    /* Столбики галерей убраны — они читались как висящий в воздухе
       проволочный мусор. Террасы подиума чистые. */
    var galleryPosts = [];

    /* Кровля верхнего яруса чистая, без посторонних надстроек,
       в строгом соответствии с архивными фотографиями. */

    // ======== парадная лестница: дорога → ярус 0 → ярус 1 → ярус 2 ========
    /* Марш идёт строго вдоль единой композиционной оси входа к порталу.
       Марш формируется как сплошной монолитный блок: ступени сверху,
       глухие боковые щёки, глухая задняя стенка, сплошная подшивка
       снизу и заглублённый цоколь. Снизу сквозь ступени ничего не
       просвечивает. */
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
      var yPlinth = yBot - 0.16;
      var tL = addXYZ(xC - halfW, yTop, zTop), tR = addXYZ(xC + halfW, yTop, zTop);
      var oL = addXYZ(xC - halfW, yBot, zBot), oR = addXYZ(xC + halfW, yBot, zBot);
      var gL = addXYZ(xC - halfW, yBot, zTop), gR = addXYZ(xC + halfW, yBot, zTop);
      var pL = addXYZ(xC - halfW, yPlinth, zBot), pR = addXYZ(xC + halfW, yPlinth, zBot);
      var pgL = addXYZ(xC - halfW, yPlinth, zTop), pgR = addXYZ(xC + halfW, yPlinth, zTop);

      // Боковые щёки (монолитные стены марша до цоколя)
      var chL = face('podium', tL, oL, pL, pgL, -1, 0, 0);
      face('podium', tL, oL, gL, gL, -1, 0, 0);
      var chR = face('podium', oR, tR, pgR, pR, 1, 0, 0);
      face('podium', oR, tR, gR, gR, 1, 0, 0);
      line(tL, oL, MED, chL, chL);
      line(tR, oR, MED, chR, chR);

      // Задняя глухая стенка марша (к верхнему ярусу/подиуму)
      face('podium', tR, tL, pgL, pgR, 0, 0, 1);
      face('podium', tR, tL, gL, gR, 0, 0, 1);

      // Сплошная наклонная подшивка снизу (soffit) + горизонтальное дно цоколя
      face('podium', oL, oR, tR, tL, 0, -1, -0.6);
      face('podium', pL, pR, pgR, pgL, 0, -1, 0);

      // Цокольная подпорная стенка под нижней ступенью
      var fPlinth = face('podium', oL, pL, pR, oR, 0, 0, -1);
      line(oL, oR, MED, fPlinth, fPlinth);
    }

    // ======== трёхмерный арочный портал входа ========
    /* Стоит на парадной входной площадке подиума (по фото «Фасад» и
       «У входа»), опирается на подиум и землю, имеет полноценный объём
       (массивные пилоны с глубиной по Z, каменный архивольт с двух
       сторон, интрадос и экстрадос). Проём открыт насквозь. Виден со
       всех 360° ракурсов без исчезающих плоскостей. */
    var PORTAL_X = 0.85;                // по оси парадного входа
    var PORTAL_Z = TIERS3[0].z0;        // на кромке первого яруса подиума (= -3.10)
    var PORTAL_W = 0.90;                // ширина арочного проёма
    var PORTAL_PW = 0.18;               // толщина каменных пилонов
    var PORTAL_PD = 0.24;               // глубина пилонов и арки по Z
    var pz0 = PORTAL_Z - PORTAL_PD * 0.5, pz1 = PORTAL_Z + PORTAL_PD * 0.5;
    var pyBase = yGround;               // заглубление в основание
    var pyLanding = TIERS3[0].y1;       // отметка площадки подиума (= 0.13)
    var pySpring = pyLanding + 0.62;    // высота пят арки (= 0.75)
    var rArchIn = PORTAL_W * 0.5;       // внутренний радиус (= 0.45)
    var rArchOut = rArchIn + PORTAL_PW; // наружный радиус (= 0.63)

    // Лестничные марши между ярусами подиума по единой оси входа
    var STHW = 0.44;
    stairFlightZ(PORTAL_X, STHW, TIERS3[2].z0, TIERS3[1].z0 + 0.35, TIERS3[2].y1, TIERS3[1].y1, 4);
    stairFlightZ(PORTAL_X, STHW, TIERS3[1].z0, TIERS3[0].z0 + 0.35, TIERS3[1].y1, TIERS3[0].y1, 4);

    // Левый и правый каменные пилоны
    var lx0 = PORTAL_X - rArchOut, lx1 = PORTAL_X - rArchIn;
    var rx0 = PORTAL_X + rArchIn,  rx1 = PORTAL_X + rArchOut;
    rectBox('podium', lx0, lx1, pz0, pz1, pyBase, pySpring);
    rectBox('podium', rx0, rx1, pz0, pz1, pyBase, pySpring);

    // Каменная 3D арка над проёмом
    var AK = 8;
    var ptsArchFrontIn = [], ptsArchFrontOut = [];
    var ptsArchBackIn = [], ptsArchBackOut = [];
    for (var ak = 0; ak <= AK; ak++) {
      var aAng = Math.PI - Math.PI * (ak / AK);
      var cAng = Math.cos(aAng), sAng = Math.sin(aAng);
      ptsArchFrontIn.push(addXYZ(PORTAL_X + rArchIn * cAng, pySpring + rArchIn * sAng, pz0));
      ptsArchFrontOut.push(addXYZ(PORTAL_X + rArchOut * cAng, pySpring + rArchOut * sAng, pz0));
      ptsArchBackIn.push(addXYZ(PORTAL_X + rArchIn * cAng, pySpring + rArchIn * sAng, pz1));
      ptsArchBackOut.push(addXYZ(PORTAL_X + rArchOut * cAng, pySpring + rArchOut * sAng, pz1));
    }
    for (var ak = 0; ak < AK; ak++) {
      // Лицевая сторона архивольта (nx=0, nz=-1)
      var fArchF = face('podium', ptsArchFrontOut[ak], ptsArchFrontOut[ak + 1],
                                  ptsArchFrontIn[ak + 1], ptsArchFrontIn[ak], 0, 0, -1);
      line(ptsArchFrontOut[ak], ptsArchFrontOut[ak + 1], BOLD, fArchF, fArchF);
      line(ptsArchFrontIn[ak],  ptsArchFrontIn[ak + 1],  MED,  fArchF, fArchF);

      // Задняя сторона архивольта (nx=0, nz=1)
      var fArchB = face('podium', ptsArchBackIn[ak], ptsArchBackIn[ak + 1],
                                  ptsArchBackOut[ak + 1], ptsArchBackOut[ak], 0, 0, 1);
      line(ptsArchBackOut[ak], ptsArchBackOut[ak + 1], BOLD, fArchB, fArchB);
      line(ptsArchBackIn[ak],  ptsArchBackIn[ak + 1],  MED,  fArchB, fArchB);

      // Нижний свод (интрадос проёма)
      var fIntrados = face('podium', ptsArchFrontIn[ak], ptsArchFrontIn[ak + 1],
                                     ptsArchBackIn[ak + 1], ptsArchBackIn[ak],
                                     0, -Math.sin(Math.PI * (ak + 0.5) / AK), 0);
      if (ak === 0 || ak === AK - 1) {
        line(ptsArchFrontIn[ak], ptsArchBackIn[ak], THIN, fArchF, fIntrados);
      }

      // Верхний свод (экстрадос)
      var fExtrados = face('podium', ptsArchFrontOut[ak + 1], ptsArchFrontOut[ak],
                                     ptsArchBackOut[ak], ptsArchBackOut[ak + 1],
                                     0, Math.sin(Math.PI * (ak + 0.5) / AK), 0);
      if (ak === 0 || ak === AK - 1) {
        line(ptsArchFrontOut[ak], ptsArchBackOut[ak], THIN, fArchF, fExtrados);
      }
    }

    // ======== широкая парадная лестница снизу от дороги к порталу ========
    var zRoad = -6.60;
    var yRoad = groundY(Math.hypot(PORTAL_X, zRoad));
    stairFlightZ(PORTAL_X, 0.48, pz0, zRoad, pyLanding, yRoad, 12);
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

    // ======== длинное прямоугольное крыло с аркадой (слева от башни) ========
    /* По архивному фото «Фасад»:
       Один непрерывный прямоугольный объём строго постоянной высоты,
       согласованный по модулю ствола башни (D = 2.00, fh = 0.26).
       Высота стен WY = 1.04 (4 * fh), высота цоколя HYSocle = 0.26 (1 * fh).
       Ритмичный ряд из 8 одинаковых узких арок вдоль главного фасада.
       Никаких случайных ступенчатых надстроек и разнобоя высот. */
    curPart = 5;
    var WX0 = -1.00;                // примыкание к подиуму и стволу
    var WX1 = -3.20;                // стык с торцевым сводом (длина = 2.20 = 1.1 D)
    var WZ  = 0.80;                 // половина ширины корпуса (= 0.80, глубина 1.60)
    var WY  = 1.04;                 // верх стены (4 * fh)
    var WYT = 1.16;                 // верх выступающей плиты кровли (WY + 0.12)
    var WO  = 0.10;                 // вынос карниза за стену
    var HYSocle = 0.26;             // каменный цоколь внизу (1 * fh)

    // Точки стен крыла
    var wgN0 = addXYZ(WX0, yGround, -WZ), wgN1 = addXYZ(WX1, yGround, -WZ);
    var wgF0 = addXYZ(WX0, yGround,  WZ), wgF1 = addXYZ(WX1, yGround,  WZ);
    var wsN0 = addXYZ(WX0, HYSocle, -WZ), wsN1 = addXYZ(WX1, HYSocle, -WZ);
    var wsF0 = addXYZ(WX0, HYSocle,  WZ), wsF1 = addXYZ(WX1, HYSocle,  WZ);
    var wtN0 = addXYZ(WX0, WY,      -WZ), wtN1 = addXYZ(WX1, WY,      -WZ);
    var wtF0 = addXYZ(WX0, WY,       WZ), wtF1 = addXYZ(WX1, WY,       WZ);

    // Стены: цоколь и основной массив
    var wallSocN = face('wing', wgN0, wgN1, wsN1, wsN0, 0, 0, -1);
    var wallSocF = face('wing', wgF1, wgF0, wsF0, wsF1, 0, 0,  1);
    var wallN    = face('wing', wsN0, wsN1, wtN1, wtN0, 0, 0, -1);
    var wallF    = face('wing', wsF1, wsF0, wtF0, wtF1, 0, 0,  1);

    // Торцы: западный (к своду) и восточный (к башне/подиуму) — закрыты с обеих сторон
    var wallW = face('wing', wgN1, wgF1, wtF1, wtN1, -1, 0,  0);
    face('wing', wgF0, wgN0, wtN0, wtF0, 1, 0, 0);

    // Линии стен и цоколя
    line(wgN0, wgN1, MED, wallSocN, wallSocN);
    line(wgF0, wgF1, MED, wallSocF, wallSocF);
    line(wsN0, wsN1, MED, wallSocN, wallN);
    line(wsF0, wsF1, MED, wallSocF, wallF);
    // Продольный шов кладки посередине стены
    var wMidY = (HYSocle + WY) * 0.5;
    line(addXYZ(WX0, wMidY, -WZ), addXYZ(WX1, wMidY, -WZ), THIN, wallN, wallN);
    line(addXYZ(WX0, wMidY,  WZ), addXYZ(WX1, wMidY,  WZ), THIN, wallF, wallF);

    line(wgN1, wtN1, MED, wallN, wallW);
    line(wgF1, wtF1, MED, wallF, wallW);

    // Плита кровли с карнизным выносом
    var sbN0 = addXYZ(WX0,      WY,  -WZ - WO), sbN1 = addXYZ(WX1 - WO, WY,  -WZ - WO);
    var sbF0 = addXYZ(WX0,      WY,   WZ + WO), sbF1 = addXYZ(WX1 - WO, WY,   WZ + WO);
    var stN0 = addXYZ(WX0,      WYT, -WZ - WO), stN1 = addXYZ(WX1 - WO, WYT, -WZ - WO);
    var stF0 = addXYZ(WX0,      WYT,  WZ + WO), stF1 = addXYZ(WX1 - WO, WYT,  WZ + WO);

    var slabN = face('wingSlab', sbN0, sbN1, stN1, stN0,  0, 0, -1);
    var slabF = face('wingSlab', sbF1, sbF0, stF0, stF1,  0, 0,  1);
    var slabW = face('wingSlab', sbN1, sbF1, stF1, stN1, -1, 0,  0);
    var slabT = face('wingTop',  stN0, stN1, stF1, stF0,  0, 1,  0);
    face('wingSlab', sbF0, sbN0, stN0, stF0, 1, 0, 0);

    line(wtN0, wtN1, THIN, wallN, slabN);
    line(wtF0, wtF1, THIN, wallF, slabF);
    line(sbN0, sbN1, MED,  slabN, slabN);
    line(sbF0, sbF1, MED,  slabF, slabF);
    line(stN0, stN1, MED,  slabN, slabT);
    line(stF0, stF1, MED,  slabF, slabT);
    line(stN1, stF1, MED,  slabW, slabT);
    line(sbN1, stN1, MED,  slabN, slabW);
    line(sbF1, stF1, MED,  slabF, slabW);

    // Невысокий парапетный бортик по краю плоской кровли
    var PH = 0.08;
    var pN0 = addXYZ(WX0,      WYT + PH, -WZ - WO), pN1 = addXYZ(WX1 - WO, WYT + PH, -WZ - WO);
    var pF0 = addXYZ(WX0,      WYT + PH,  WZ + WO), pF1 = addXYZ(WX1 - WO, WYT + PH,  WZ + WO);
    var iN0 = addXYZ(WX0,      WYT + PH, -WZ - WO + 0.08), iN1 = addXYZ(WX1 - WO - 0.08, WYT + PH, -WZ - WO + 0.08);
    var iF0 = addXYZ(WX0,      WYT + PH,  WZ + WO - 0.08), iF1 = addXYZ(WX1 - WO - 0.08, WYT + PH,  WZ + WO - 0.08);
    var rlN = face('wingRail', stN0, stN1, pN1, pN0, 0, 0, -1);
    var rlF = face('wingRail', stF1, stF0, pF0, pF1, 0, 0,  1);
    var rlW = face('wingRail', stN1, stF1, pF1, pN1, -1, 0, 0);
    face('wingRail', stF0, stN0, pN0, pF0, 1, 0, 0);
    face('wingRail', pN0, pN1, iN1, iN0, 0, 1, 0);
    face('wingRail', pF0, pF1, iF1, iF0, 0, 1, 0);
    face('wingRail', pN1, pF1, iF1, iN1, 0, 1, 0);

    line(pN0, pN1, MED, rlN, rlN);
    line(pF0, pF1, MED, rlF, rlF);
    line(pN1, pF1, MED, rlW, rlW);

    // Швы плит покрытия на террасе
    for (var pj = 1; pj <= 7; pj++) {
      var pxj = WX0 + (WX1 - WX0) * (pj / 8);
      line(addXYZ(pxj, WYT, -WZ - WO + 0.08), addXYZ(pxj, WYT, WZ + WO - 0.08), THIN, slabT, slabT);
    }

    outline.push(wgN1, wtN1, wallN, wallW); outlineParts.push(curPart);
    outline.push(pN1, pF1, rlW, rlW); outlineParts.push(curPart);
    outline.push(wgF1, wtF1, wallF, wallW); outlineParts.push(curPart);

    // Ритмичная аркада вдоль главного фасада (8 одинаковых арок с шагом ~fh)
    var AN = 8;
    var aY0 = HYSocle + 0.06, aY1 = WY - 0.10;
    var aSpan = (WX1 - WX0) / AN;
    for (var ai = 0; ai < AN; ai++) {
      var axA = WX0 + aSpan * (ai + 0.22);
      var axB = WX0 + aSpan * (ai + 0.78);
      cells.push({
        grp: 5, arch: true,
        a: addXYZ(axA, aY0, -WZ), b: addXYZ(axB, aY0, -WZ),
        c: addXYZ(axB, aY1, -WZ), d: addXYZ(axA, aY1, -WZ),
        nx: 0, ny: 0, nz: -1, vis: false, lit: 0
      });
      // Вертикальные каменные пилястры между арками
      if (ai > 0) {
        var pX = WX0 + aSpan * ai;
        line(addXYZ(pX, HYSocle, -WZ), addXYZ(pX, WY, -WZ), THIN, wallN, wallN);
      }
    }

    var wingShadow = [
      addXYZ(WX1 - WO + 0.30, yGround, -WZ - WO - 0.14),
      addXYZ(WX0 + 0.30,      yGround, -WZ - WO - 0.14),
      addXYZ(WX0 + 0.30,      yGround,  WZ + WO - 0.14),
      addXYZ(WX1 - WO + 0.30, yGround,  WZ + WO - 0.14)
    ];

    curPart = 0;
    // ======== торцевой объём со сводом-полуцилиндром ========
    /* Стоит на левом конце длинного крыла (WX1 из 05-wing.js), продолжая
       его дальше наружу. По фото «Фасад»:
       — полукруглый свод с каменной ребристостью и карнизом;
       — каменный цоколь вдоль всей нижней части стен;
       — остеклённый арочный торец наружу: заглублённая в каменный портал
         тёмная стеклянная арка с чётким оконным переплётом;
       — объём полностью замкнут со всех сторон и изнутри, поэтому
         при облёте 360° здание не теряет непрозрачность ни под каким углом. */
    curPart = 4;
    var HX0 = WX1, HX1 = WX1 - 1.20;   // от края крыла — дальше наружу (длина 1.20 = 0.6 D)
    var HZ  = WZ;                        // половина ширины (= 0.80)
    var HWY = WY;                        // высота стен до пят свода (= 1.04 = 4 * fh)
    var HYSocle = 0.26;                  // высота каменного цоколя (= 0.26 = 1 * fh)
    var HN  = 8;                         // 8 равных шагов рёбер вдоль свода
    var HK  = 12;                        // граней полукруга свода

    var profiles = [];
    for (var hi = 0; hi <= HN; hi++) {
      var hu = hi / HN;
      var hx = HX0 + (HX1 - HX0) * hu;
      var prof = [];
      prof.push(addXYZ(hx, yGround, -HZ));               // 0: низ цоколя передней стены
      prof.push(addXYZ(hx, HYSocle, -HZ));               // 1: верх цоколя
      prof.push(addXYZ(hx, HWY, -HZ));                   // 2: пята свода (верх стены)
      for (var hk = 0; hk <= HK; hk++) {
        var hang = Math.PI - Math.PI * (hk / HK);         // π → 0
        prof.push(addXYZ(hx, HWY + HZ * Math.sin(hang), HZ * Math.cos(hang))); // 3 .. 3+HK
      }
      prof.push(addXYZ(hx, HWY, HZ));                    // 4+HK: пята задней стены
      prof.push(addXYZ(hx, HYSocle, HZ));                // 5+HK: верх заднего цоколя
      prof.push(addXYZ(hx, yGround, HZ));                // 6+HK: низ задней стены
      profiles.push(prof);
    }
    var PN = profiles[0].length;                          // = HK + 7

    var hallShellsAt = [];
    for (var hi = 0; hi < HN; hi++) {
      var p0 = profiles[hi], p1 = profiles[hi + 1];
      var rowShells = [];
      for (var pj = 0; pj < PN - 1; pj++) {
        var isSocle = (pj === 0 || pj === PN - 2);
        var isWall  = (pj === 1 || pj === PN - 3);
        var kind = isSocle ? 'hall' : (isWall ? 'hall' : 'slab');
        var nx0 = 0, ny0 = 0, nz0 = 0;
        if (isSocle || isWall) {
          nz0 = (pj < 2) ? -1 : 1;
        } else {
          var midK = pj - 2.5;
          var midAng = Math.PI - Math.PI * (midK / HK);
          ny0 = Math.sin(midAng); nz0 = Math.cos(midAng);
        }
        var sid = face(kind, p0[pj], p0[pj + 1], p1[pj + 1], p1[pj], nx0, ny0, nz0);
        rowShells.push(sid);
      }
      hallShellsAt.push(rowShells);
    }

    // Ребристость свода и членения стен
    for (var hi = 0; hi <= HN; hi++) {
      var pr = profiles[hi];
      // Линии цоколя
      line(pr[0], pr[1], THIN, hallShellsAt[Math.min(hi, HN - 1)][0], hallShellsAt[Math.min(hi, HN - 1)][0]);
      // Линии стены
      line(pr[1], pr[2], THIN, hallShellsAt[Math.min(hi, HN - 1)][1], hallShellsAt[Math.min(hi, HN - 1)][1]);
      // Поперечные рёбра свода (дуги поперёк корпуса — как на фото «Фасад»)
      for (var pj = 2; pj < PN - 3; pj++) {
        line(pr[pj], pr[pj + 1], (hi === 0 || hi === HN || hi % 2 === 0) ? MED : THIN,
             hallShellsAt[Math.min(hi, HN - 1)][pj], hallShellsAt[Math.min(hi, HN - 1)][pj]);
      }
      // Задняя стена
      line(pr[PN - 3], pr[PN - 2], THIN, hallShellsAt[Math.min(hi, HN - 1)][PN - 3], hallShellsAt[Math.min(hi, HN - 1)][PN - 3]);
      line(pr[PN - 2], pr[PN - 1], THIN, hallShellsAt[Math.min(hi, HN - 1)][PN - 2], hallShellsAt[Math.min(hi, HN - 1)][PN - 2]);
    }

    // Продольные тяги (карниз цоколя, пята свода, конёк свода)
    for (var hi2 = 0; hi2 < HN; hi2++) {
      // Горизонтальный карниз цоколя
      line(profiles[hi2][1], profiles[hi2 + 1][1], MED, hallShellsAt[hi2][0], hallShellsAt[hi2][1]);
      line(profiles[hi2][PN - 2], profiles[hi2 + 1][PN - 2], MED, hallShellsAt[hi2][PN - 3], hallShellsAt[hi2][PN - 2]);
      // Пята свода (переход стены в арку)
      line(profiles[hi2][2], profiles[hi2 + 1][2], BOLD, hallShellsAt[hi2][1], hallShellsAt[hi2][2]);
      line(profiles[hi2][PN - 3], profiles[hi2 + 1][PN - 3], BOLD, hallShellsAt[hi2][PN - 4], hallShellsAt[hi2][PN - 3]);
      // Продольные швы между каменными плитами свода
      for (var rk = 4; rk < PN - 4; rk += 2) {
        line(profiles[hi2][rk], profiles[hi2 + 1][rk], THIN, hallShellsAt[hi2][rk - 1], hallShellsAt[hi2][rk]);
      }
      // Оконные вертикальные членения на передней стене
      var hxM = HX0 + (HX1 - HX0) * ((hi2 + 0.5) / HN);
      var w0 = addXYZ(hxM, HYSocle + 0.08, -HZ);
      var w1 = addXYZ(hxM, HWY - 0.08, -HZ);
      line(w0, w1, THIN, hallShellsAt[hi2][1], hallShellsAt[hi2][1]);
    }

    // ======== остеклённый арочный торец на HX1 ========
    /* Наружный торец — монументальный арочный портал с глубоко
       заглублённым остеклением и чётким геометрическим переплётом (по фото).
       Двусторонняя геометрия (наружные nx=-1 и внутренние nx=+1 грани):
       при повороте на любые 360° объём замкнут и никогда не становится
       прозрачным. */
    var rArchIn = HZ * 0.78;             // внутренний радиус остекления арки (= 0.62)
    var hxRec = HX1 + 0.14;              // глубина ниши остекления

    var cRecCenter = addXYZ(hxRec, HWY, 0);

    // Точки наружного каменного портала и ниши
    var archOuter = [], archInner = [];
    var archRecOuter = [];
    for (var ak = 0; ak <= HK; ak++) {
      var aAng = Math.PI - Math.PI * (ak / HK);
      archOuter.push(addXYZ(HX1, HWY + HZ * Math.sin(aAng), HZ * Math.cos(aAng)));
      archInner.push(addXYZ(HX1, HWY + rArchIn * Math.sin(aAng), rArchIn * Math.cos(aAng)));
      archRecOuter.push(addXYZ(hxRec, HWY + rArchIn * Math.sin(aAng), rArchIn * Math.cos(aAng)));
    }

    // Каменная дуга портала (кольцо между HZ и rArchIn на HX1)
    for (var ak = 0; ak < HK; ak++) {
      var fPortal = face('hall', archOuter[ak], archOuter[ak + 1], archInner[ak + 1], archInner[ak], -1, 0, 0);
      line(archOuter[ak], archOuter[ak + 1], BOLD, fPortal, fPortal);
      line(archInner[ak], archInner[ak + 1], MED,  fPortal, fPortal);
      // Внутренний откос ниши портала (переход от HX1 к hxRec)
      var fJamb = face('hall', archInner[ak], archInner[ak + 1], archRecOuter[ak + 1], archRecOuter[ak], 0, Math.sin(Math.PI - Math.PI * (ak + 0.5) / HK), Math.cos(Math.PI - Math.PI * (ak + 0.5) / HK));
      line(archRecOuter[ak], archRecOuter[ak + 1], THIN, fJamb, fJamb);
    }

    // Боковые каменные пилоны портала (от yGround до HWY)
    var pLN_out = addXYZ(HX1, yGround, -HZ), pLN_in = addXYZ(HX1, yGround, -rArchIn);
    var pLT_out = addXYZ(HX1, HWY, -HZ),     pLT_in = addXYZ(HX1, HWY, -rArchIn);
    var fPylL = face('hall', pLN_out, pLT_out, pLT_in, pLN_in, -1, 0, 0);
    line(pLN_out, pLT_out, BOLD, fPylL, fPylL);
    line(pLN_in,  pLT_in,  MED,  fPylL, fPylL);

    var pRN_out = addXYZ(HX1, yGround, HZ), pRN_in = addXYZ(HX1, yGround, rArchIn);
    var pRT_out = addXYZ(HX1, HWY, HZ),     pRT_in = addXYZ(HX1, HWY, rArchIn);
    var fPylR = face('hall', pRN_in, pRT_in, pRT_out, pRN_out, -1, 0, 0);
    line(pRN_out, pRT_out, BOLD, fPylR, fPylR);
    line(pRN_in,  pRT_in,  MED,  fPylR, fPylR);

    // Каменный цоколь под окном (от yGround до HYSocle внутри ниши)
    var scL_rec = addXYZ(hxRec, HYSocle, -rArchIn), scR_rec = addXYZ(hxRec, HYSocle, rArchIn);
    var scBaseL_rec = addXYZ(hxRec, yGround, -rArchIn), scBaseR_rec = addXYZ(hxRec, yGround, rArchIn);
    var fSocRec = face('hall', scBaseL_rec, scL_rec, scR_rec, scBaseR_rec, -1, 0, 0);
    line(scL_rec, scR_rec, MED, fSocRec, fSocRec);

    // Заглублённое остекление арки (на hxRec)
    var gL_bot = scL_rec, gR_bot = scR_rec;
    var gL_top = archRecOuter[0], gR_top = archRecOuter[HK];
    var fGlassRect = face('hallGlass', gL_bot, gL_top, gR_top, gR_bot, -1, 0, 0);
    // Задняя непрозрачная грань (nx=+1), закрывающая окно изнутри навсегда
    face('hall', gL_top, gL_bot, gR_bot, gR_top, 1, 0, 0);

    // Полукруглая верхняя часть стекла (веер от центра к дуге на hxRec)
    for (var ak = 0; ak < HK; ak++) {
      var fGlassArch = face('hallGlass', cRecCenter, archRecOuter[ak], archRecOuter[ak + 1], archRecOuter[ak + 1], -1, 0, 0);
      // Задняя непрозрачная грань
      face('hall', archRecOuter[ak], cRecCenter, archRecOuter[ak + 1], archRecOuter[ak + 1], 1, 0, 0);
    }

    // Оконный переплёт
    // 3 вертикальных импоста
    for (var mi = 1; mi <= 3; mi++) {
      var mz = -rArchIn + (rArchIn * 2) * (mi / 4);
      var mAng = Math.acos(Math.max(-1, Math.min(1, mz / rArchIn)));
      var myTop = HWY + rArchIn * Math.sin(mAng);
      var mBot = addXYZ(hxRec, HYSocle, mz);
      var mTop = addXYZ(hxRec, myTop, mz);
      line(mBot, mTop, THIN, fGlassRect, fGlassRect);
    }
    // Горизонтальный импост на линии пят свода (HWY)
    line(gL_top, gR_top, MED, fGlassRect, fGlassRect);
    // Промежуточный горизонтальный импост
    var myMid = (HYSocle + HWY) * 0.5;
    line(addXYZ(hxRec, myMid, -rArchIn), addXYZ(hxRec, myMid, rArchIn), THIN, fGlassRect, fGlassRect);

    // Глухая торцевая стена на HX0 (примыкание к крылу)
    // Закрыта с обеих сторон (nx=+1 и nx=-1)
    for (var pj = 0; pj < PN - 1; pj++) {
      face('hall', profiles[0][0], profiles[0][pj], profiles[0][pj + 1], profiles[0][pj + 1], 1, 0, 0);
      face('hall', profiles[0][pj], profiles[0][0], profiles[0][pj + 1], profiles[0][pj + 1], -1, 0, 0);
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
       Деревья в скетч-стиле: силуэты с неровным контуром, разной формы,
       размером и лёгким наклоном.
       4 типа:
       0: пирамидальные кипарисы/тополя (узкий пламевидный силуэт),
       1: широкие раскидистые лиственные (облачная трёхлопастная крона),
       2: компактные округлые деревья (рубленый контур),
       3: стелющиеся низкие кустарники/сосны на склоне. */
    var trees = [];
    var trnd = seeded(9091);

    function freeSpot(x, z) {
      if (x > PODX0 - 0.35 && x < PODX1 + 0.35 && z > -3.40 && z < 1.45) return false; // подиум
      if (x > WX1 - 0.35 && x < WX0 + 0.35 && Math.abs(z) < WZ + 0.35) return false;   // крыло
      if (x > HX1 - 0.35 && x < HX0 + 0.35 && Math.abs(z) < HZ + 0.35) return false;   // свод
      if (Math.abs(x - PORTAL_X) < 0.85 && z < TIERS3[0].z0 + 0.1 && z > -7.0) return false; // лестничный створ
      return true;
    }

    for (var t2 = 0; t2 < 220 && trees.length < 52; t2++) {
      var ang = trnd() * Math.PI * 2;
      var rad = 3.5 + trnd() * 7.4;
      var tx = Math.cos(ang) * rad, tz = Math.sin(ang) * rad;
      if (!freeSpot(tx, tz)) continue;

      var kindPick = trnd();
      var kind = kindPick < 0.34 ? 0 : (kindPick < 0.64 ? 1 : (kindPick < 0.86 ? 2 : 3));

      var hh, ww;
      if (kind === 0) {
        // Кипарис/тополь
        hh = 1.60 + trnd() * 0.85;
        ww = 0.18 + trnd() * 0.07;
      } else if (kind === 1) {
        // Широкое лиственное
        hh = 1.15 + trnd() * 0.50;
        ww = 0.44 + trnd() * 0.18;
      } else if (kind === 2) {
        // Компактное округлое
        hh = 0.85 + trnd() * 0.40;
        ww = 0.32 + trnd() * 0.12;
      } else {
        // Низкий кустарник на склоне
        hh = 0.50 + trnd() * 0.25;
        ww = 0.38 + trnd() * 0.16;
      }

      var wob = new Float32Array(12);
      for (var w2 = 0; w2 < 12; w2++) wob[w2] = 0.80 + trnd() * 0.36;

      trees.push({
        p: addXYZ(tx, groundY(rad), tz),
        kind: kind,
        h: hh, w: ww, wob: wob,
        tone: trnd() < 0.52 ? 0 : 1,
        lean: (trnd() - 0.5) * 0.14
      });
    }

    /* Стройные кипарисы по бокам от парадного схода (по фото «У входа») */
    (function () {
      var sideX = [PORTAL_X - 0.85, PORTAL_X + 0.85];
      for (var si = 0; si < 2; si++) {
        for (var sj = 0; sj < 2; sj++) {
          var sx = sideX[si] + (si === 0 ? -0.15 : 0.15) * sj;
          var sz = -4.20 - sj * 1.30;
          var wob2 = new Float32Array(12);
          for (var w3 = 0; w3 < 12; w3++) wob2[w3] = 0.82 + trnd() * 0.30;
          trees.push({
            p: addXYZ(sx, groundY(Math.hypot(sx, sz)), sz),
            kind: 0,
            h: 1.80 + trnd() * 0.50, w: 0.20 + trnd() * 0.05, wob: wob2,
            tone: si, lean: (trnd() - 0.5) * 0.08
          });
        }
      }
    })();

    /* ======== мощение ========
       Трава прямо под зданием выглядела дачей. Перед подиумом и у
       портала — простая мощёная площадка (прямоугольная: подиум и сам
       не круглый). Дальше начинается склон — там уже трава. */
    curPart = 2;
    var pv0 = addXYZ(PODX0 - 0.25, yGround + 0.004, -5.00);
    var pv1 = addXYZ(PODX1 + 0.35, yGround + 0.004, -5.00);
    var pv2 = addXYZ(PODX1 + 0.35, yGround + 0.004, TIERS3[0].z0);
    var pv3 = addXYZ(PODX0 - 0.25, yGround + 0.004, TIERS3[0].z0);
    face('pave', pv0, pv1, pv2, pv3, 0, 1, 0);
    curPart = 0;
    /* ======== флаги ========
       На фотографиях у входа стоят флагштоки. Рядом из трёх
       справа от портала парадного входа. */
    var flags = [];
    for (var fi = 0; fi < 3; fi++) {
      var ffx = PORTAL_X + PORTAL_W * 0.5 + PORTAL_PW + 0.18 + fi * 0.18;
      var ffz = PORTAL_Z - 0.05;
      flags.push({
        b: addXYZ(ffx, TIERS3[0].y1, ffz),
        t: addXYZ(ffx, TIERS3[0].y1 + 0.65, ffz),
        ph: fi * 1.7
      });
    }

    /* ======== огни города внизу ======== */
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
       Два чётких ряда по сторонам от парадной лестницы к порталу (всего 8).
       Освещают парадный подход, не засоряя террасы подиума. */
    var lamps = [];
    var LAMP_H = 0.38;
    for (var side = -1; side <= 1; side += 2) {
      for (var step = 0; step < 4; step++) {
        var lz3 = PORTAL_Z - 0.50 - step * 0.65;
        var lx3 = PORTAL_X + side * (PORTAL_W * 0.5 + 0.38);
        lamps.push({
          b: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)), lz3),
          t: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)) + LAMP_H, lz3)
        });
      }
    }

    /* ======== скамейки в скетч-стиле ========
       Простые, узнаваемые силуэты (деревянные рейки сиденья/спинки
       и чугунные опоры). Расставлены у входа и на площадке. */
    var benches = [
      // 2 скамейки на входной террасе первого яруса подиума
      { p: addXYZ(PORTAL_X - 0.75, TIERS3[0].y1, PORTAL_Z + 0.20), w: 0.28, h: 0.12, ang: 0 },
      { p: addXYZ(PORTAL_X + 0.75, TIERS3[0].y1, PORTAL_Z + 0.20), w: 0.28, h: 0.12, ang: 0 },
      // 2 скамейки на мощёной площади перед подиумом
      { p: addXYZ(PORTAL_X - 0.85, groundY(Math.hypot(PORTAL_X - 0.85, -4.70)), -4.70), w: 0.30, h: 0.12, ang: 0 },
      { p: addXYZ(PORTAL_X + 0.85, groundY(Math.hypot(PORTAL_X + 0.85, -4.70)), -4.70), w: 0.30, h: 0.12, ang: 0 }
    ];

    /* ======== урны в скетч-стиле ========
       Простые каменные/металлические цилиндрические урны у скамеек и входа. */
    var urns = [
      { p: addXYZ(PORTAL_X - 0.98, TIERS3[0].y1, PORTAL_Z + 0.20), r: 0.045, h: 0.10 },
      { p: addXYZ(PORTAL_X + 0.98, TIERS3[0].y1, PORTAL_Z + 0.20), r: 0.045, h: 0.10 },
      { p: addXYZ(PORTAL_X - 1.08, groundY(Math.hypot(PORTAL_X - 1.08, -4.70)), -4.70), r: 0.045, h: 0.10 },
      { p: addXYZ(PORTAL_X + 1.08, groundY(Math.hypot(PORTAL_X + 1.08, -4.70)), -4.70), r: 0.045, h: 0.10 }
    ];

    /* ======== пара машин 1970-х на подъездной дороге ========
       По фото «Вид с холма»: внизу у подножия холма проходит дорога,
       по которой едут автобусы и советские автомобили 1970-х.
       Выполнены силуэтом в скетч-стиле с заливкой и колёсами. */
    var yCarRoad0 = groundY(Math.hypot(-0.70, -6.85));
    var yCarRoad1 = groundY(Math.hypot(2.10, -6.95));
    var cars = [
      // Седан 1970-х (ГАЗ-24 «Волга» / ВАЗ-2101 «Жигули»)
      {
        p: addXYZ(-0.70, yCarRoad0, -6.85),
        type: 'sedan',
        col: 'rgb(84, 118, 128)',    // винтажный бирюзово-серый
        len: 0.52, hgt: 0.16,
        dir: 1
      },
      // Микроавтобус / автобус 1970-х (РАФ-2203 / ПАЗ)
      {
        p: addXYZ(2.10, yCarRoad1, -6.95),
        type: 'van',
        col: 'rgb(222, 210, 180)',   // слоновая кость
        len: 0.60, hgt: 0.22,
        dir: -1
      }
    ];
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
      urns: urns,
      cars: cars,
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
      /* Круги, на которые ложится тень: тень подиума на земле,
         тень высокой башни на земле, тень башни на верхнем ярусе подиума
         и контактная тень у самого основания ствола. */
      shadows: [
        { layer: 0, r: 3.2, cx: (PODX0 + PODX1) * 0.5, cz: (TIERS3[0].z0 + TIERS3[0].z1) * 0.5,
          y: yGround - yCenter, alpha: 0.18 },
        { layer: 0, r: R * 1.35, isTower: true,
          y: yGround - yCenter, alpha: 0.16, off: 1.80 },
        { layer: 1, r: R * 1.35, isTower: true,
          y: TIERS3[2].y1 - yCenter, alpha: 0.16, off: 0.70 },
        { layer: 1, r: R * 1.08,
          y: TIERS3[2].y1 - yCenter, alpha: 0.22, off: 0.15 }
      ],
      height: capY - yGround,
      width: PODX1 - PODX0
    };
  }

  global.Model = { build: build, buildRotunda: build };

})(window);
