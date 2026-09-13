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

