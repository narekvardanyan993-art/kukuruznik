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
      /* Сектор перед фасадом держим пустым: там вход, каскад лестниц и
         подъём с дороги. Роща, посаженная сплошняком, закрывала именно
         то, ради чего здание и разворачивают к себе. */
      if (z < 0 && Math.abs(x) < Math.abs(z) * 0.9 + 1.6) return false;
      if (x * x + z * z < 3.3 * 3.3) return false;              // стилобат
      if (x > 0.9 && x < 5.3 && Math.abs(z) < 1.9) return false;  // корпус
      if (x < -1.0 && x > -5.1 && Math.abs(z) < 1.5) return false; // крыло
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

    /* ======== мощение ========
       Трава прямо под зданием выглядела дачей. Вокруг стилобата всегда
       была асфальтовая площадь, а от лестницы вниз шла дорожка. */
    curPart = 2;
    var PAV = 36;
    var pavIn  = ring(PAV, tiers[0].r - 0.02, yGround + 0.004);
    var pavOut = ring(PAV, 3.05, yGround + 0.004);
    band('pave', pavOut, pavIn, 6, true);

    // дорожка от лестницы к краю площадки
    var pw = 0.34, pz0 = -(tiers[0].r + 0.36), pz1 = -4.60;
    var ppa = addXYZ(-pw, groundY(3.0) + 0.005, pz0);
    var ppb = addXYZ( pw, groundY(3.0) + 0.005, pz0);
    var ppc = addXYZ( pw * 1.15, groundY(4.7) + 0.005, pz1);
    var ppd = addXYZ(-pw * 1.15, groundY(4.7) + 0.005, pz1);
    face('pave', ppa, ppb, ppc, ppd, 0, 1, 0);
    curPart = 0;

