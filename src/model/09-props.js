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
       На фотографии у входа стоят фонари на тонких мачтах.
       Два чётких ряда по сторонам от парадной лестницы к порталу (всего 8).
       Освещают парадный подход, не засоряя террасы подиума. */
    var lamps = [];
    var LAMP_H = 0.38;

    for (var side = -1; side <= 1; side += 2) {
      for (var step = 0; step < 4; step++) {
        var lz3 = PORTAL_Z - 0.40 - step * 0.52;
        var lx3 = PORTAL_X + side * (PORTAL_W * 0.5 + 0.38);
        lamps.push({
          b: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)), lz3),
          t: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)) + LAMP_H, lz3)
        });
      }
    }

    /* Проволочные скамейки убраны — они читались как мусорные рамки
       на земле. Земля и террасы вокруг здания чистые. */
    var benches = [];

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

