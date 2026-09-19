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
