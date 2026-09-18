    /* ======== флаги ========
       На фотографиях у входа стоят флагштоки. Раньше — у входа в
       круглый стилобат; теперь у свободно стоящего портала, тем же
       рядом из трёх. Полотнище само по себе даёт движение — и это
       движение живое, а не зациклённое. */
    var flags = [];
    for (var fi = 0; fi < 3; fi++) {
      var ffx = PORTAL_X + PORTAL_W * 0.5 + 0.28 + fi * 0.20;
      var ffz = PORTAL_Z - 0.10;
      flags.push({
        b: addXYZ(ffx, pgY, ffz),
        t: addXYZ(ffx, pgY + 0.62, ffz),
        ph: fi * 1.7
      });
    }

    /* Надписи на крыле больше нет — название по фото не подтверждено
       (см. правило про выдуманные детали в docs/PRAVILA.md). */

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

    // мачта не должна вырастать посреди подиума, крыла, свода или лестницы
    function lampFree(x, z) {
      if (x > PODX0 - 0.2 && x < PODX1 + 0.2 && z > -3.3 && z < 1.45) return false;  // подиум
      if (x > WX1 - 0.2 && x < WX0 + 0.2 && Math.abs(z) < WZ + 0.2) return false;   // крыло
      if (x > HX1 - 0.2 && x < HX0 + 0.2 && Math.abs(z) < HZ + 0.2) return false;   // свод
      if (Math.abs(x - STX0) < 0.65 && z < TIERS3[0].z0 + 0.1 && z > -6.8) return false; // лестница
      return true;
    }

    // Ряд фонарей вдоль открытого паркета перед подиумом.
    for (var li = 0; li < 10; li++) {
      var lx2 = PODX0 + (PODX1 - PODX0) * (li / 9);
      var lz2 = TIERS3[0].z0 - 0.45;
      if (!lampFree(lx2, lz2)) continue;
      lamps.push({
        b: addXYZ(lx2, groundY(Math.hypot(lx2, lz2)), lz2),
        t: addXYZ(lx2, groundY(Math.hypot(lx2, lz2)) + LAMP_H, lz2)
      });
    }

    /* У портала и вдоль длинной лестницы — двумя чёткими рядами по
       сторонам от прохода, как и положено на парадном подходе. */
    for (var side = -1; side <= 1; side += 2) {
      for (var step = 0; step < 4; step++) {
        var lz3 = PORTAL_Z - 0.45 - step * 0.50;
        var lx3 = PORTAL_X + side * (PORTAL_W * 0.5 + 0.35);
        lamps.push({
          b: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)), lz3),
          t: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)) + LAMP_H, lz3)
        });
      }
    }

    /* ======== скамейки ========
       Мелочь, которой не замечаешь, но без которой площадь не похожа
       на место, где бывают люди. Стоят вдоль паркета перед подиумом. */
    var benches = [];
    for (var bi3 = 0; bi3 < 8; bi3++) {
      var bx3 = HX1 + 0.3 + (PODX1 - HX1 - 0.6) * (bi3 / 7);
      var bz3 = TIERS3[0].z0 - 0.85;
      if (!lampFree(bx3, bz3)) continue;
      var byy = groundY(Math.hypot(bx3, bz3));
      benches.push({
        a: addXYZ(bx3 - 0.17, byy + 0.075, bz3),
        b: addXYZ(bx3 + 0.17, byy + 0.075, bz3),
        c: addXYZ(bx3 - 0.17, byy, bz3),
        d: addXYZ(bx3 + 0.17, byy, bz3)
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

