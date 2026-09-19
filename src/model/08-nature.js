    /* ======== деревья вокруг ========
       Деревья в скетч-стиле: силуэты с неровным контуром, разной формы,
       размером и лёгким наклоном.
       4 типа:
       0: пирамидальные кипарисы/тополя (узкий пламевидный силуэт),
       1: широкие раскидистые лиственные (облачная трёхлопастная крона),
       2: компактные округлые деревья (рубленый контур),
       3: стелющиеся низкие кустарники/сосны на склоне. */
    var trees = [];
    var trnd = seeded(9091);

    function freeSpot(x, z) {
      if (x > PODX0 - 0.35 && x < PODX1 + 0.35 && z > -3.40 && z < 1.45) return false; // подиум
      if (x > WX1 - 0.35 && x < WX0 + 0.35 && Math.abs(z) < WZ + 0.35) return false;   // крыло
      if (x > HX1 - 0.35 && x < HX0 + 0.35 && Math.abs(z) < HZ + 0.35) return false;   // свод
      if (Math.abs(x - PORTAL_X) < 0.85 && z < TIERS3[0].z0 + 0.1 && z > -7.0) return false; // лестничный створ
      return true;
    }

    for (var t2 = 0; t2 < 220 && trees.length < 52; t2++) {
      var ang = trnd() * Math.PI * 2;
      var rad = 3.5 + trnd() * 7.4;
      var tx = Math.cos(ang) * rad, tz = Math.sin(ang) * rad;
      if (!freeSpot(tx, tz)) continue;

      var kindPick = trnd();
      var kind = kindPick < 0.34 ? 0 : (kindPick < 0.64 ? 1 : (kindPick < 0.86 ? 2 : 3));

      var hh, ww;
      if (kind === 0) {
        // Кипарис/тополь
        hh = 1.60 + trnd() * 0.85;
        ww = 0.18 + trnd() * 0.07;
      } else if (kind === 1) {
        // Широкое лиственное
        hh = 1.15 + trnd() * 0.50;
        ww = 0.44 + trnd() * 0.18;
      } else if (kind === 2) {
        // Компактное округлое
        hh = 0.85 + trnd() * 0.40;
        ww = 0.32 + trnd() * 0.12;
      } else {
        // Низкий кустарник на склоне
        hh = 0.50 + trnd() * 0.25;
        ww = 0.38 + trnd() * 0.16;
      }

      var wob = new Float32Array(12);
      for (var w2 = 0; w2 < 12; w2++) wob[w2] = 0.80 + trnd() * 0.36;

      trees.push({
        p: addXYZ(tx, groundY(rad), tz),
        kind: kind,
        h: hh, w: ww, wob: wob,
        tone: trnd() < 0.52 ? 0 : 1,
        lean: (trnd() - 0.5) * 0.14
      });
    }

    /* Стройные кипарисы по бокам от парадного схода (по фото «У входа») */
    (function () {
      var sideX = [PORTAL_X - 0.85, PORTAL_X + 0.85];
      for (var si = 0; si < 2; si++) {
        for (var sj = 0; sj < 2; sj++) {
          var sx = sideX[si] + (si === 0 ? -0.15 : 0.15) * sj;
          var sz = -4.20 - sj * 1.30;
          var wob2 = new Float32Array(12);
          for (var w3 = 0; w3 < 12; w3++) wob2[w3] = 0.82 + trnd() * 0.30;
          trees.push({
            p: addXYZ(sx, groundY(Math.hypot(sx, sz)), sz),
            kind: 0,
            h: 1.80 + trnd() * 0.50, w: 0.20 + trnd() * 0.05, wob: wob2,
            tone: si, lean: (trnd() - 0.5) * 0.08
          });
        }
      }
    })();

    /* ======== мощение ========
       Трава прямо под зданием выглядела дачей. Перед подиумом и у
       портала — простая мощёная площадка (прямоугольная: подиум и сам
       не круглый). Дальше начинается склон — там уже трава. */
    curPart = 2;
    var pv0 = addXYZ(PODX0 - 0.25, yGround + 0.004, -5.00);
    var pv1 = addXYZ(PODX1 + 0.35, yGround + 0.004, -5.00);
    var pv2 = addXYZ(PODX1 + 0.35, yGround + 0.004, TIERS3[0].z0);
    var pv3 = addXYZ(PODX0 - 0.25, yGround + 0.004, TIERS3[0].z0);
    face('pave', pv0, pv1, pv2, pv3, 0, 1, 0);
    curPart = 0;
