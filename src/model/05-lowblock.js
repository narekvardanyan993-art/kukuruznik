    // ======== нижний корпус с волнистой крышей ========
    curPart = 4;
    var HX0 = 1.32, HX1 = 4.60;     // корпус вытянут вдоль оси X
    var HZ  = 1.16;                 // половина ширины
    var HT  = 0.17;                 // толщина плиты кровли
    var HK  = 26;                   // точек вдоль волны

    // Один плавный период на всю длину: полтора коротких читались
    // горной грядой, а не кровлей.
    function roofTopY(u) { return 1.18 + 0.27 * Math.sin(u * 6.6 - 0.8); }

    var hGndN = [], hGndF = [], hBotN = [], hBotF = [], hTopN = [], hTopF = [];
    var hCrsN = [], hCrsF = [];
    var hGtN = [], hGtF = [], hGbN = [], hGbF = [];   // лента остекления
    var hCourse = 0.42;             // ряд кладки по стене
    for (var i = 0; i <= HK; i++) {
      var u = i / HK;
      var hx = HX0 + (HX1 - HX0) * u;
      var yt = roofTopY(u), yb = yt - HT;
      hGndN.push(addXYZ(hx, yGround, -HZ));  hGndF.push(addXYZ(hx, yGround, HZ));
      hCrsN.push(addXYZ(hx, hCourse, -HZ));  hCrsF.push(addXYZ(hx, hCourse, HZ));
      hBotN.push(addXYZ(hx, yb, -HZ));       hBotF.push(addXYZ(hx, yb, HZ));
      hTopN.push(addXYZ(hx, yt, -HZ));       hTopF.push(addXYZ(hx, yt, HZ));

      /* Лента остекления идёт под самой кровлей и повторяет волну.
         Глухая стена без единого окна читается как забор, а не как
         здание — это и был главный источник «картонности». */
      var gt = yb - 0.06, gb = yb - 0.40;
      hGtN.push(addXYZ(hx, gt, -HZ));        hGtF.push(addXYZ(hx, gt, HZ));
      hGbN.push(addXYZ(hx, gb, -HZ));        hGbF.push(addXYZ(hx, gb, HZ));
    }

    for (var i = 0; i < HK; i++) {
      var wN = face('hall', hGndN[i], hGndN[i + 1], hBotN[i + 1], hBotN[i], 0, 0, -1);
      var wF = face('hall', hGndF[i + 1], hGndF[i], hBotF[i], hBotF[i + 1], 0, 0, 1);
      var sN = face('slab', hBotN[i], hBotN[i + 1], hTopN[i + 1], hTopN[i], 0, 0, -1);
      var sF = face('slab', hBotF[i + 1], hBotF[i], hTopF[i], hTopF[i + 1], 0, 0, 1);
      var rT = face('slabTop', hTopN[i], hTopN[i + 1], hTopF[i + 1], hTopF[i], 0, 1, 0);

      var gN = face('hallGlass', hGbN[i], hGbN[i + 1], hGtN[i + 1], hGtN[i], 0, 0, -1);
      var gF = face('hallGlass', hGbF[i + 1], hGbF[i], hGtF[i], hGtF[i + 1], 0, 0, 1);
      line(hGtN[i], hGtN[i + 1], THIN, gN, gN);
      line(hGbN[i], hGbN[i + 1], THIN, gN, gN);
      line(hGtF[i], hGtF[i + 1], THIN, gF, gF);
      line(hGbF[i], hGbF[i + 1], THIN, gF, gF);
      if (i % 2 === 0) {                       // импосты остекления
        line(hGbN[i], hGtN[i], THIN, gN, gN);
        line(hGbF[i], hGtF[i], THIN, gF, gF);
      }

      line(hTopN[i], hTopN[i + 1], MED,  sN, rT);   // волна, ближняя сторона
      line(hTopF[i], hTopF[i + 1], MED,  sF, rT);   // волна, дальняя сторона
      line(hBotN[i], hBotN[i + 1], THIN, wN, sN);
      line(hBotF[i], hBotF[i + 1], THIN, wF, sF);
      /* Поперечное ребро кровли. Без него плита — просто белое пятно
         размером с полздания, и весь корпус выглядит картонным. */
      if (i % 4 === 2) line(hTopN[i], hTopF[i], MED, rT, rT);
      line(hGndN[i], hGndN[i + 1], MED,  wN, wN);
      line(hGndF[i], hGndF[i + 1], MED,  wF, wF);
      line(hCrsN[i], hCrsN[i + 1], THIN, wN, wN);
      line(hCrsF[i], hCrsF[i + 1], THIN, wF, wF);
    }

    for (var e = 0; e < 2; e++) {
      var k = e === 0 ? 0 : HK;
      var nx = e === 0 ? -1 : 1;
      var n0 = e === 0 ? hGndF[0] : hGndN[HK], n1 = e === 0 ? hGndN[0] : hGndF[HK];
      var n2 = e === 0 ? hBotN[0] : hBotF[HK], n3 = e === 0 ? hBotF[0] : hBotN[HK];
      var eW = face('hall', n0, n1, n2, n3, nx, 0, 0);
      var eS = face('slab', hBotF[k], hBotN[k], hTopN[k], hTopF[k], nx, 0, 0);
      line(hGndN[k], hTopN[k], MED,  eW, eS);
      line(hGndF[k], hTopF[k], MED,  eW, eS);
      line(hTopN[k], hTopF[k], MED,  eS, eS);
      line(hBotN[k], hBotF[k], THIN, eW, eS);
    }

