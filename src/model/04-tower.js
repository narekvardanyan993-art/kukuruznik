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

