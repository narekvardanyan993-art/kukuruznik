    // ======== длинное низкое крыло с аркадой (слева от башни) ========
    /* На фотографии это самый узнаваемый кусок комплекса после самой
       башни: длинный низкий объём, у которого весь фасад — сплошной ряд
       высоких узких арок, а сверху лежит плоская плита с выносом.
       Стоит по другую сторону от волнистого корпуса, вдоль той же оси. */
    curPart = 5;
    var WX0 = -1.52, WX1 = -4.35;   // от стилобата наружу
    var WZ  = 0.80;                 // половина ширины
    var WY  = 1.06;                 // верх стены
    var WYT = 1.18;                 // верх плиты кровли
    var WO  = 0.12;                 // вынос плиты за стену

    /* Грани крыла уходят под стилобат, чтобы между ним и крылом не было
       прогала. А вот ЛИНИИ обрезаем по краю террасы: иначе они начинались
       из-под стилобата и чертили полосу поперёк башни. */
    var WXL = -2.32;
    function wl(y, z) { return addXYZ(WXL, y, z); }

    var wgN0 = addXYZ(WX0, yGround, -WZ), wgN1 = addXYZ(WX1, yGround, -WZ);
    var wgF0 = addXYZ(WX0, yGround,  WZ), wgF1 = addXYZ(WX1, yGround,  WZ);
    var wtN0 = addXYZ(WX0, WY, -WZ),      wtN1 = addXYZ(WX1, WY, -WZ);
    var wtF0 = addXYZ(WX0, WY,  WZ),      wtF1 = addXYZ(WX1, WY,  WZ);

    var wallN = face('wing', wgN0, wgN1, wtN1, wtN0,  0, 0, -1);
    var wallF = face('wing', wgF1, wgF0, wtF0, wtF1,  0, 0,  1);
    var wallW = face('wing', wgN1, wgF1, wtF1, wtN1, -1, 0,  0);
    /* ПРАВИЛО: объём должен быть ЗАКРЫТ со всех сторон.
       Восточного торца у крыла не было — я считал, что он спрятан в
       стилобате. Но стилобат высотой 0.5, а крыло выше втрое, и с той
       стороны зритель смотрел ВНУТРЬ пустой коробки: стена отвёрнута,
       изнанки нет, сквозь объём видно небо и линии кровли. Это и есть
       «пустые полоски» при повороте. */
    face('wing', wgF0, wgN0, wtN0, wtF0, 1, 0, 0);

    // плита кровли: короб с выносом на три стороны
    var sbN0 = addXYZ(WX0, WY,  -WZ - WO), sbN1 = addXYZ(WX1 - WO, WY,  -WZ - WO);
    var sbF0 = addXYZ(WX0, WY,   WZ + WO), sbF1 = addXYZ(WX1 - WO, WY,   WZ + WO);
    var stN0 = addXYZ(WX0, WYT, -WZ - WO), stN1 = addXYZ(WX1 - WO, WYT, -WZ - WO);
    var stF0 = addXYZ(WX0, WYT,  WZ + WO), stF1 = addXYZ(WX1 - WO, WYT,  WZ + WO);

    var slabN = face('wingSlab', sbN0, sbN1, stN1, stN0,  0, 0, -1);
    var slabF = face('wingSlab', sbF1, sbF0, stF0, stF1,  0, 0,  1);
    var slabW = face('wingSlab', sbN1, sbF1, stF1, stN1, -1, 0,  0);
    var slabT = face('wingTop',  stN0, stN1, stF1, stF0,  0, 1,  0);
    face('wingSlab', sbF0, sbN0, stN0, stF0, 1, 0, 0);      // торец плиты

    line(wl(yGround, -WZ), wgN1, MED,  wallN, wallN);
    line(wl(yGround,  WZ), wgF1, MED,  wallF, wallF);
    line(wgN1, wtN1, MED,  wallN, wallW);
    line(wgF1, wtF1, MED,  wallF, wallW);
    line(wl(WY, -WZ), wtN1, THIN, wallN, slabN);
    line(wl(WY,  WZ), wtF1, THIN, wallF, slabF);
    line(wl(WY, -WZ - WO), sbN1, MED,  slabN, slabN);
    line(wl(WY,  WZ + WO), sbF1, MED,  slabF, slabF);
    line(wl(WYT, -WZ - WO), stN1, MED,  slabN, slabT);
    line(wl(WYT,  WZ + WO), stF1, MED,  slabF, slabT);
    line(stN1, stF1, MED,  slabW, slabT);
    line(sbN1, stN1, MED,  slabN, slabW);
    line(sbF1, stF1, MED,  slabF, slabW);

    /* Задний этаж крыла. Одна коробка с плоской крышей остаётся
       коробкой, сколько ни правь ей края: в жизни это не один объём,
       а несколько уровней уступами. Поднимаем заднюю половину
       отдельным этажом — у него свои окна, свой карниз, а перед ним
       остаётся терраса. Сразу появляется глубина. */
    var WY2  = WY + 0.52;           // верх стены заднего этажа
    var WZB  = -WZ + 0.46;          // насколько он отступил от фасада

    var bN0 = addXYZ(WX0, WYT, WZB), bN1 = addXYZ(WX1, WYT, WZB);
    var bT0 = addXYZ(WX0, WY2, WZB), bT1 = addXYZ(WX1, WY2, WZB);
    var bF0 = addXYZ(WX0, WYT,  WZ), bF1 = addXYZ(WX1, WYT,  WZ);
    var bG0 = addXYZ(WX0, WY2,  WZ), bG1 = addXYZ(WX1, WY2,  WZ);

    var bFront = face('wingUp', bN0, bN1, bT1, bT0, 0, 0, -1);
    var bBack  = face('wingUp', bF1, bF0, bG0, bG1, 0, 0,  1);
    var bWest  = face('wingUp', bN1, bF1, bG1, bT1, -1, 0, 0);
    face('wingUp', bF0, bN0, bT0, bG0, 1, 0, 0);            // торец этажа

    // окна заднего этажа — то же лекарство, что подействовало на корпус
    var wg0 = WY2 - 0.34, wg1 = WY2 - 0.08;
    var gN0 = addXYZ(WX0 + 0.12, wg0, WZB), gN1 = addXYZ(WX1 + 0.10, wg0, WZB);
    var gT0 = addXYZ(WX0 + 0.12, wg1, WZB), gT1 = addXYZ(WX1 + 0.10, wg1, WZB);
    var bGlass = face('wingGlass', gN0, gN1, gT1, gT0, 0, 0, -1);
    line(wl(wg0, WZB), gN1, THIN, bGlass, bGlass);
    line(wl(wg1, WZB), gT1, THIN, bGlass, bGlass);
    var MU = 9;
    for (var i = 1; i < MU; i++) {
      var mx = WXL + (WX1 - WXL) * (i / MU);
      line(addXYZ(mx, wg0, WZB), addXYZ(mx, wg1, WZB), THIN, bGlass, bGlass);
    }

    // карниз-плита поверх заднего этажа
    var kY = WY2 + 0.11, kO = 0.07;
    var kN0 = addXYZ(WX0, WY2, WZB - kO), kN1 = addXYZ(WX1 - kO, WY2, WZB - kO);
    var kF0 = addXYZ(WX0, WY2,  WZ + kO), kF1 = addXYZ(WX1 - kO, WY2,  WZ + kO);
    var kTN0 = addXYZ(WX0, kY, WZB - kO), kTN1 = addXYZ(WX1 - kO, kY, WZB - kO);
    var kTF0 = addXYZ(WX0, kY,  WZ + kO), kTF1 = addXYZ(WX1 - kO, kY,  WZ + kO);
    var kA = face('wingUpCorn', kN0, kN1, kTN1, kTN0, 0, 0, -1);
    var kB = face('wingUpCorn', kF1, kF0, kTF0, kTF1, 0, 0,  1);
    var kC = face('wingUpCorn', kN1, kF1, kTF1, kTN1, -1, 0, 0);
    var kT = face('wingUpTop', kTN0, kTN1, kTF1, kTF0, 0, 1,  0);
    face('wingUpCorn', kF0, kN0, kTN0, kTF0, 1, 0, 0);      // торец карниза

    line(wl(WYT, WZB), bN1, MED, bFront, bFront);
    line(bN1, bT1, MED, bFront, bWest);
    line(bF1, bG1, MED, bBack,  bWest);
    line(wl(WY2, WZB - kO), kN1, THIN, kA, kA);
    line(wl(kY, WZB - kO), kTN1, MED, kA, kT);
    line(wl(kY,  WZ + kO), kTF1, MED, kB, kT);
    line(kTN1, kTF1, MED, kC, kT);
    line(kN1, kTN1, MED, kA, kC);

    outline.push(bN1, bT1, bFront, bWest); outlineParts.push(curPart);
    outline.push(kN1, kTN1, kA, kC); outlineParts.push(curPart);

    /* Карниз над аркадой. Стена, у которой нет ни низа, ни верха,
       выглядит плоской покраской. */
    var CY0 = 0.94, CY1 = WY;
    var cnN0 = addXYZ(WX0, CY0, -WZ - 0.05), cnN1 = addXYZ(WX1, CY0, -WZ - 0.05);
    var cnF0 = addXYZ(WX0, CY0,  WZ + 0.05), cnF1 = addXYZ(WX1, CY0,  WZ + 0.05);
    var ctN0 = addXYZ(WX0, CY1, -WZ - 0.05), ctN1 = addXYZ(WX1, CY1, -WZ - 0.05);
    var ctF0 = addXYZ(WX0, CY1,  WZ + 0.05), ctF1 = addXYZ(WX1, CY1,  WZ + 0.05);
    var cnA = face('wingCorn', cnN0, cnN1, ctN1, ctN0, 0, 0, -1);
    var cnB = face('wingCorn', cnF1, cnF0, ctF0, ctF1, 0, 0,  1);
    var cnC = face('wingCorn', cnN1, cnF1, ctF1, ctN1, -1, 0, 0);
    face('wingCorn', cnF0, cnN0, ctN0, ctF0, 1, 0, 0);      // торец карниза аркады
    line(wl(CY0, -WZ - 0.05), cnN1, THIN, cnA, cnA);
    line(wl(CY0,  WZ + 0.05), cnF1, THIN, cnB, cnB);
    line(wl(CY1, -WZ - 0.05), ctN1, MED,  cnA, cnA);
    line(wl(CY1,  WZ + 0.05), ctF1, MED,  cnB, cnB);
    line(cnN1, ctN1, MED,  cnA, cnC);
    line(cnF1, ctF1, MED,  cnB, cnC);

    /* Бортик по краю кровли. Плоская плита без бортика читается как
       лист картона: у неё нет ни толщины, ни границы. */
    var PH = 0.085;
    var pN0 = addXYZ(WX0, WYT + PH, -WZ - WO), pN1 = addXYZ(WX1 - WO, WYT + PH, -WZ - WO);
    var pF0 = addXYZ(WX0, WYT + PH,  WZ + WO), pF1 = addXYZ(WX1 - WO, WYT + PH,  WZ + WO);
    var iN0 = addXYZ(WX0, WYT + PH, -WZ - WO + 0.09), iN1 = addXYZ(WX1 - WO - 0.09, WYT + PH, -WZ - WO + 0.09);
    var iF0 = addXYZ(WX0, WYT + PH,  WZ + WO - 0.09), iF1 = addXYZ(WX1 - WO - 0.09, WYT + PH,  WZ + WO - 0.09);
    var jN1 = addXYZ(WX1 - WO - 0.09, WYT, -WZ - WO + 0.09);
    var jF1 = addXYZ(WX1 - WO - 0.09, WYT,  WZ + WO - 0.09);

    var rlN = face('wingRail', stN0, stN1, pN1, pN0, 0, 0, -1);
    var rlF = face('wingRail', stF1, stF0, pF0, pF1, 0, 0,  1);
    var rlW = face('wingRail', stN1, stF1, pF1, pN1, -1, 0, 0);
    face('wingRail', stF0, stN0, pN0, pF0, 1, 0, 0);        // торец бортика
    var rtN = face('wingRail', pN0, pN1, iN1, iN0, 0, 1, 0);
    var rtF = face('wingRail', pF0, pF1, iF1, iF0, 0, 1, 0);
    var rtW = face('wingRail', pN1, pF1, iF1, iN1, 0, 1, 0);
    face('wingRail', iN1, iF1, jF1, jN1, 1, 0, 0);   // внутренняя сторона торца

    line(wl(WYT + PH, -WZ - WO), pN1, MED,  rlN, rtN);
    line(wl(WYT + PH,  WZ + WO), pF1, MED,  rlF, rtF);
    line(pN1, pF1, MED,  rlW, rtW);
    line(wl(WYT + PH, -WZ - WO + 0.09), iN1, THIN, rtN, rtN);
    line(wl(WYT + PH,  WZ + WO - 0.09), iF1, THIN, rtF, rtF);
    line(stN1, pN1, THIN, rlN, rlW);
    line(stF1, pF1, THIN, rlF, rlW);

    // швы мощения на террасе: большая ровная плоскость без них мертва
    var PJ = 5;
    for (var i = 1; i < PJ; i++) {
      var jx = WXL + (WX1 - WO - WXL) * (i / PJ);
      line(addXYZ(jx, WYT, -WZ - WO + 0.09), addXYZ(jx, WYT, WZ + WO - 0.09),
           THIN, slabT, slabT);
    }

    outline.push(wgN1, wtN1, wallN, wallW); outlineParts.push(curPart);
    outline.push(pN1, pF1, rlW, rlW); outlineParts.push(curPart);
    outline.push(wgF1, wtF1, wallF, wallW); outlineParts.push(curPart);

    /* Сами арки. Это те же «чешуйки», что и лоджии на стволе, только
       без балкона: узкий проём с полуовальным верхом, внутри тень. */
    var AN = 11;
    var aY0 = 0.10, aY1 = 0.88;
    var aSpan = (WX1 - WX0) / AN;
    for (var i = 0; i < AN; i++) {
      var axA = WX0 + aSpan * (i + 0.26);
      var axB = WX0 + aSpan * (i + 0.74);
      cells.push({
        grp: 5, arch: true,
        a: addXYZ(axA, aY0, -WZ), b: addXYZ(axB, aY0, -WZ),
        c: addXYZ(axB, aY1, -WZ), d: addXYZ(axA, aY1, -WZ),
        nx: 0, ny: 0, nz: -1, vis: false, lit: 0
      });
      cells.push({
        grp: 5, arch: true,
        a: addXYZ(axB, aY0, WZ), b: addXYZ(axA, aY0, WZ),
        c: addXYZ(axA, aY1, WZ), d: addXYZ(axB, aY1, WZ),
        nx: 0, ny: 0, nz: 1, vis: false, lit: 0
      });
    }

    var wingShadow = [
      addXYZ(WX1 - WO - 0.06 + 0.30, yGround, -WZ - WO - 0.06 + -0.14),
      addXYZ(WX0 + 0.30,             yGround, -WZ - WO - 0.06 + -0.14),
      addXYZ(WX0 + 0.30,             yGround,  WZ + WO + 0.06 + -0.14),
      addXYZ(WX1 - WO - 0.06 + 0.30, yGround,  WZ + WO + 0.06 + -0.14)
    ];

    curPart = 0;

    /* Тень нижнего корпуса на земле. Сдвиг вбит теми же числами, что
       и у круглых теней в движке: свет один на всю сцену. */
    var SHX = 0.30, SHZ = -0.14, gp = 0.10;
    var hallShadow = [
      addXYZ(HX0 - gp + SHX, yGround, -HZ - gp + SHZ),
      addXYZ(HX1 + gp + SHX, yGround, -HZ - gp + SHZ),
      addXYZ(HX1 + gp + SHX, yGround,  HZ + gp + SHZ),
      addXYZ(HX0 - gp + SHX, yGround,  HZ + gp + SHZ)
    ];

