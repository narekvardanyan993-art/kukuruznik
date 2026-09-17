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

