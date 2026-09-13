    /* ======== флаги ========
       На фотографиях у входа стоят флагштоки. Полотнище само по себе
       даёт движение — и это движение живое, а не зациклённое. */
    var flags = [];
    for (var fi = 0; fi < 3; fi++) {
      var fa2 = FRONT_A + (fi - 1) * 0.30;
      var fr2 = tiers[1].r + 0.20;
      var fx2 = Math.cos(fa2) * fr2, fz2 = Math.sin(fa2) * fr2;
      flags.push({
        b: addXYZ(fx2, tiers[1].y1, fz2),
        t: addXYZ(fx2, tiers[1].y1 + 0.62, fz2),
        ph: fi * 1.7
      });
    }

    /* ======== надпись на крыле ========
       Плита с названием на фасаде заднего этажа. Четыре точки — по ним
       движок и разложит текст в перспективе. */
    var sgz = WZB - 0.005;
    var sign = {
      a: addXYZ(-2.35, WY2 - 0.40, sgz),   // левый низ
      b: addXYZ(-4.05, WY2 - 0.40, sgz),   // правый низ
      d: addXYZ(-2.35, WY2 - 0.14, sgz),   // левый верх
      face: bFront,
      text: 'ԵՐԻՏԱՍԱՐԴՈՒԹՅԱՆ ՊԱԼԱՏ'
    };

    /* ======== огни города внизу ========
       Ночью нижняя половина кадра проваливалась в черноту: светилась
       только башня и висела в пустоте. Внизу под холмом должен лежать
       город — россыпь тёплых окон и цепочки уличных фонарей по склону.
       Это не объёмы, а просто точки на земле: объёмы там всё равно не
       разглядеть, а свет виден. */
    var glow = [];
    var grnd2 = seeded(20260913);
    for (var gi = 0; gi < 240; gi++) {
      var ga = grnd2() * Math.PI * 2;
      var gr = 5.4 + grnd2() * 7.4;
      var gx = Math.cos(ga) * gr, gz = Math.sin(ga) * gr;
      if (gx * gx + gz * gz < 5.2 * 5.2) continue;
      glow.push(addXYZ(gx, groundY(gr) + 0.02, gz));
    }

    /* ======== фонари ========
       На фотографии у входа стоят фонари на тонких мачтах. Ночью они
       единственное, что светит на площадку — без них терраса остаётся
       чёрным пятном, даже когда в окнах горит свет. */
    var lamps = [];
    var LAMP_H = 0.34;

    // мачта не должна вырастать посреди крыши корпуса
    function lampFree(x, z) {
      if (x > 0.9 && x < 5.0 && Math.abs(z) < 1.5) return false;   // корпус
      if (x < -1.0 && x > -4.7 && Math.abs(z) < 1.1) return false; // крыло
      return true;
    }

    for (var li = 0; li < 22; li++) {
      var la, lr;
      if (li < 14) { la = (li / 14) * Math.PI * 2 + 0.22; lr = tiers[0].r + 0.55; }
      else         { la = FRONT_A + (li - 17.5) * 0.26;   lr = tiers[0].r + 1.45; }
      var lx2 = Math.cos(la) * lr, lz2 = Math.sin(la) * lr;
      if (!lampFree(lx2, lz2)) continue;
      lamps.push({
        b: addXYZ(lx2, groundY(lr), lz2),
        t: addXYZ(lx2, groundY(lr) + LAMP_H, lz2)
      });
    }

    /* ======== скамейки ========
       Мелочь, которой не замечаешь, но без которой площадь не похожа
       на место, где бывают люди. */
    var benches = [];
    for (var bi3 = 0; bi3 < 10; bi3++) {
      var ba = (bi3 / 10) * Math.PI * 2 + 0.5;
      var br = tiers[0].r + 0.95;
      var bx3 = Math.cos(ba) * br, bz3 = Math.sin(ba) * br;
      if (!lampFree(bx3, bz3)) continue;
      var byy = groundY(br);
      var tx3 = -Math.sin(ba) * 0.17, tz3 = Math.cos(ba) * 0.17;
      benches.push({
        a: addXYZ(bx3 - tx3, byy + 0.075, bz3 - tz3),
        b: addXYZ(bx3 + tx3, byy + 0.075, bz3 + tz3),
        c: addXYZ(bx3 - tx3, byy, bz3 - tz3),
        d: addXYZ(bx3 + tx3, byy, bz3 + tz3)
      });
    }

    /* ======== кусты у подножия ======== */
    for (var bu = 0; bu < 14; bu++) {
      var ua = trnd() * Math.PI * 2;
      var ur = 3.0 + trnd() * 1.6;
      var ux = Math.cos(ua) * ur, uz = Math.sin(ua) * ur;
      if (!freeSpot(ux, uz)) continue;
      var uw = new Float32Array(10);
      for (var uk = 0; uk < 10; uk++) uw[uk] = 0.80 + trnd() * 0.34;
      trees.push({
        p: addXYZ(ux, groundY(ur), uz),
        h: 0.30 + trnd() * 0.14, w: 0.26 + trnd() * 0.10,
        wob: uw, tone: trnd() < 0.5 ? 0 : 1, lean: 0, bush: true
      });
    }

