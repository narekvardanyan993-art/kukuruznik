    /* ======== деревья вокруг ========
       Здание стояло на голой лужайке, и от этого вся сцена читалась
       макетом. Деревья — не украшение: они дают масштаб (глаз меряет
       высоту башни деревьями) и глубину.

       Каждое дерево — не объём, а «билборд»: точка основания в мире,
       а крона рисуется на экране всегда лицом к нам. Настоящая крона
       из граней стоила бы дороже всего остального вместе взятого.
       Форма кроны задана один раз при старте, иначе она мерцает. */
    var trees = [];
    var trnd = seeded(9091);

    function freeSpot(x, z) {
      /* Сектор перед фасадом держим пустым: там портал, зигзаг лестниц
         и длинный подъём с дороги. Роща, посаженная сплошняком,
         закрывала именно то, ради чего здание и разворачивают к себе. */
      if (z < 0 && Math.abs(x - 1.4) < Math.abs(z) * 0.55 + 0.9) return false;
      if (x > PODX0 - 0.3 && x < PODX1 + 0.3 && z > -3.4 && z < 0.6) return false;   // подиум
      if (x > WX1 - 0.3 && x < WX0 + 0.3 && Math.abs(z) < WZ + 0.35) return false;   // крыло
      if (x > HX1 - 0.3 && x < HX0 + 0.3 && Math.abs(z) < HZ + 0.35) return false;   // свод
      return true;
    }

    for (var t2 = 0; t2 < 200 && trees.length < 46; t2++) {
      var ang = trnd() * Math.PI * 2;
      var rad = 3.4 + trnd() * 7.2;
      var tx = Math.cos(ang) * rad, tz = Math.sin(ang) * rad;
      if (!freeSpot(tx, tz)) continue;

      var poplar = trnd() < 0.42;                 // тополь — местная примета
      var hh = poplar ? 1.5 + trnd() * 0.9 : 0.85 + trnd() * 0.5;
      var ww = poplar ? 0.16 + trnd() * 0.06 : 0.34 + trnd() * 0.16;
      var wob = new Float32Array(10);
      for (var w2 = 0; w2 < 10; w2++) wob[w2] = 0.82 + trnd() * 0.30;

      trees.push({
        p: addXYZ(tx, groundY(rad), tz),
        h: hh, w: ww, wob: wob,
        tone: trnd() < 0.5 ? 0 : 1,               // два оттенка зелени
        lean: (trnd() - 0.5) * 0.16
      });
    }

    /* Пара деревьев прямо у длинной лестницы — по бокам подъёма,
       упрощённо (те же billboard-кроны, что и у остальной рощи). */
    (function () {
      var lstMidZ = (PORTAL_Z - 0.55 + (PORTAL_Z - 2.10)) * 0.5;
      var sideX = [LSTX - LSTHW - 0.45, LSTX + LSTHW + 0.45];
      for (var si = 0; si < 2; si++) {
        var sx = sideX[si], sz = lstMidZ + (si - 0.5) * 0.6;
        var wob2 = new Float32Array(10);
        for (var w3 = 0; w3 < 10; w3++) wob2[w3] = 0.82 + trnd() * 0.30;
        trees.push({
          p: addXYZ(sx, groundY(Math.hypot(sx, sz)), sz),
          h: 1.5 + trnd() * 0.6, w: 0.18 + trnd() * 0.05, wob: wob2,
          tone: si, lean: (trnd() - 0.5) * 0.12
        });
      }
    })();

    /* ======== мощение ========
       Трава прямо под зданием выглядела дачей. Перед подиумом и у
       портала — простая мощёная площадка (прямоугольная: подиум и сам
       не круглый). Дальше начинается склон — там уже трава. */
    curPart = 2;
    var pv0 = addXYZ(HX1 - 0.4, yGround + 0.004, -4.80);
    var pv1 = addXYZ(PODX1 + 0.6, yGround + 0.004, -4.80);
    var pv2 = addXYZ(PODX1 + 0.6, yGround + 0.004, 0.60);
    var pv3 = addXYZ(HX1 - 0.4, yGround + 0.004, 0.60);
    face('pave', pv0, pv1, pv2, pv3, 0, 1, 0);
    curPart = 0;

