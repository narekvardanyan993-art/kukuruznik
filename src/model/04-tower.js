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
          vis: false, lit: 0,
          lamp: rnd()          // горит ли окно ночью
        });
      }
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

    /* Табличка кафе висит на самом барабане, поэтому её точки создаются
       здесь же — чтобы уехать вместе с ним. */
    var cafeSign = {
      a: addPt(FRONT_A + 0.32, rRim * 1.01, glassY + 0.02),
      b: addPt(FRONT_A - 0.32, rRim * 1.01, glassY + 0.02),
      d: addPt(FRONT_A + 0.32, rRim * 1.01, glassY + 0.14),
      text: 'ԿԱՖԵ',
      /* Куда смотрит табличка. Без этого она рисовалась и тогда, когда
         уезжала на обратную сторону барабана — и читалась зеркально
         поверх стекла. */
      nx: Math.cos(FRONT_A), nz: Math.sin(FRONT_A), spin: true
    };

    var spin1 = pos.length / 3;
    for (var sp2 = spinShell0; sp2 < shells.length; sp2++) shells[sp2].spin = true;

