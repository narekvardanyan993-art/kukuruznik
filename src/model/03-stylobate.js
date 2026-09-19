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

    /* Простые объёмы на кровле верхнего яруса — по фото «Вид с холма»
       там стоит пара служебных построек, а не голая плита. Обычные
       коробки с плоской крышей, без окон и лоджий. */
    var roofBoxes = [
      { x0: 1.30, x1: 2.05, z0: -0.85, z1: -0.10, h: 0.30 },
      { x0: 1.40, x1: 2.05, z0: 0.20,  z1: 0.60,  h: 0.20 }
    ];
    for (var rb2 = 0; rb2 < roofBoxes.length; rb2++) {
      var rB = roofBoxes[rb2];
      var box = rectBox('podium', rB.x0, rB.x1, rB.z0, rB.z1, TIERS3[2].y1, TIERS3[2].y1 + rB.h);
      var topId = face('deck', box.tt[0], box.tt[1], box.tt[2], box.tt[3], 0, 1, 0);
      for (var bk = 0; bk < 4; bk++) line(box.tt[bk], box.tt[(bk + 1) % 4], THIN, topId, topId);
    }

    // ======== лестницы-зигзаг: земля → ярус 0 → ярус 1 → ярус 2 ========
    /* Марш идёт вдоль Z (к дороге), а не по кругу, как раньше. Каждый
       следующий марш сдвинут по X в другую сторону от предыдущего.
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
    var STX0 = 1.10, STX1 = 1.85, STHW = 0.42;
    stairFlightZ(STX0, STHW, TIERS3[2].z0, TIERS3[1].z0 + 0.55, TIERS3[2].y1, TIERS3[1].y1, 4);
    stairFlightZ(STX1, STHW, TIERS3[1].z0, TIERS3[0].z0 + 0.55, TIERS3[1].y1, TIERS3[0].y1, 4);

    // ======== свободно стоящий портал ========
    /* Арка стоит посреди подхода к зданию — как ворота над широкой
       лестницей. Две тонкие опоры и плоская арочная перемычка. */
    var PORTAL_X = STX0, PORTAL_Z = -4.50;
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

    // Марш от портала прямо в подиум (без зазоров)
    stairFlightZ(STX0, 0.44, TIERS3[0].z0, PORTAL_Z, TIERS3[0].y1, pgY, 5);

    // ======== широкая прямая лестница снизу от дороги к порталу ========
    var LSTX = PORTAL_X, LSTHW = 0.46;
    var zRoad = -6.60;
    var yRoad = groundY(Math.hypot(LSTX, zRoad));
    stairFlightZ(LSTX, LSTHW, PORTAL_Z, zRoad, pgY, yRoad, 9);
