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
    var HX0 = WX1, HX1 = WX1 - 1.45;   // от края крыла — дальше наружу
    var HZ  = WZ;                        // половина ширины (= 0.80)
    var HWY = WY;                        // высота стен до пят свода (= 1.06)
    var HYSocle = 0.28;                  // высота каменного цоколя
    var HN  = 8;                         // сечений вдоль длины свода (ребристость)
    var HK  = 10;                        // граней полукруга свода

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
