    /* ======== флаги ========
       На фотографиях у входа стоят флагштоки. Рядом из трёх
       справа от портала парадного входа. */
    var flags = [];
    for (var fi = 0; fi < 3; fi++) {
      var ffx = PORTAL_X + PORTAL_W * 0.5 + PORTAL_PW + 0.18 + fi * 0.18;
      var ffz = PORTAL_Z - 0.05;
      flags.push({
        b: addXYZ(ffx, TIERS3[0].y1, ffz),
        t: addXYZ(ffx, TIERS3[0].y1 + 0.65, ffz),
        ph: fi * 1.7
      });
    }

    /* ======== огни города внизу ======== */
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
       Два чётких ряда по сторонам от парадной лестницы к порталу (всего 8).
       Освещают парадный подход, не засоряя террасы подиума. */
    var lamps = [];
    var LAMP_H = 0.38;
    for (var side = -1; side <= 1; side += 2) {
      for (var step = 0; step < 4; step++) {
        var lz3 = PORTAL_Z - 0.50 - step * 0.65;
        var lx3 = PORTAL_X + side * (PORTAL_W * 0.5 + 0.38);
        lamps.push({
          b: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)), lz3),
          t: addXYZ(lx3, groundY(Math.hypot(lx3, lz3)) + LAMP_H, lz3)
        });
      }
    }

    /* ======== скамейки в скетч-стиле ========
       Простые, узнаваемые силуэты (деревянные рейки сиденья/спинки
       и чугунные опоры). Расставлены у входа и на площадке. */
    var benches = [
      // 2 скамейки на входной террасе первого яруса подиума
      { p: addXYZ(PORTAL_X - 0.75, TIERS3[0].y1, PORTAL_Z + 0.20), w: 0.28, h: 0.12, ang: 0 },
      { p: addXYZ(PORTAL_X + 0.75, TIERS3[0].y1, PORTAL_Z + 0.20), w: 0.28, h: 0.12, ang: 0 },
      // 2 скамейки на мощёной площади перед подиумом
      { p: addXYZ(PORTAL_X - 0.85, groundY(Math.hypot(PORTAL_X - 0.85, -4.70)), -4.70), w: 0.30, h: 0.12, ang: 0 },
      { p: addXYZ(PORTAL_X + 0.85, groundY(Math.hypot(PORTAL_X + 0.85, -4.70)), -4.70), w: 0.30, h: 0.12, ang: 0 }
    ];

    /* ======== урны в скетч-стиле ========
       Простые каменные/металлические цилиндрические урны у скамеек и входа. */
    var urns = [
      { p: addXYZ(PORTAL_X - 0.98, TIERS3[0].y1, PORTAL_Z + 0.20), r: 0.045, h: 0.10 },
      { p: addXYZ(PORTAL_X + 0.98, TIERS3[0].y1, PORTAL_Z + 0.20), r: 0.045, h: 0.10 },
      { p: addXYZ(PORTAL_X - 1.08, groundY(Math.hypot(PORTAL_X - 1.08, -4.70)), -4.70), r: 0.045, h: 0.10 },
      { p: addXYZ(PORTAL_X + 1.08, groundY(Math.hypot(PORTAL_X + 1.08, -4.70)), -4.70), r: 0.045, h: 0.10 }
    ];

    /* ======== пара машин 1970-х на подъездной дороге ========
       По фото «Вид с холма»: внизу у подножия холма проходит дорога,
       по которой едут автобусы и советские автомобили 1970-х.
       Выполнены силуэтом в скетч-стиле с заливкой и колёсами. */
    var yCarRoad0 = groundY(Math.hypot(-0.70, -6.85));
    var yCarRoad1 = groundY(Math.hypot(2.10, -6.95));
    var cars = [
      // Седан 1970-х (ГАЗ-24 «Волга» / ВАЗ-2101 «Жигули»)
      {
        p: addXYZ(-0.70, yCarRoad0, -6.85),
        type: 'sedan',
        col: 'rgb(84, 118, 128)',    // винтажный бирюзово-серый
        len: 0.52, hgt: 0.16,
        dir: 1
      },
      // Микроавтобус / автобус 1970-х (РАФ-2203 / ПАЗ)
      {
        p: addXYZ(2.10, yCarRoad1, -6.95),
        type: 'van',
        col: 'rgb(222, 210, 180)',   // слоновая кость
        len: 0.60, hgt: 0.22,
        dir: -1
      }
    ];
