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
