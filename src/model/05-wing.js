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
