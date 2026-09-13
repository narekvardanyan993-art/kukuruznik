    /* ======== соседние дома ========
       Башня стояла одна посреди поля. В жизни она стоит в районе, и
       именно соседи объясняют глазу, что это город, а не памятник в
       чистом поле. Дома простые: коробка, плоская кровля, пояс окон.
       Вдали цвет светлее и холоднее — та же воздушная перспектива,
       что и у земли. */
    var city = [], cityCenters = [], cityParts = [];
    var crnd = seeded(31337);

    /* Раньше дома садились по чистому кругу — угол и радиус оба
       случайные. На экране это читалось как рулетка, а не район: одни
       торчали за неровным краем земли (радиус доходил до 12.0, а край
       на некоторых углах лежит ниже 12.3), другие стояли по одному
       посреди пустоты. Теперь у района четыре стороны — как кучки
       соседних дворов, а не забор из коробок по периметру — и радиус
       не подходит к краю ближе чем на разумный запас. */
    var CITY_CLUSTERS = [0.35, 2.10, 3.55, 5.15];

    for (var c2 = 0; c2 < 140 && city.length < 14; c2++) {
      var clusterA = CITY_CLUSTERS[c2 % CITY_CLUSTERS.length];
      var cang = clusterA + (crnd() - 0.5) * 0.9;
      var crad = 7.4 + crnd() * 3.4;
      var ccx = Math.cos(cang) * crad, ccz = Math.sin(cang) * crad;
      if (ccx > 0.5 && ccx < 6.4 && Math.abs(ccz) < 2.6) continue;   // за корпусом
      if (ccx < -0.5 && ccx > -6.2 && Math.abs(ccz) < 2.4) continue; // за крылом

      var bi = city.length;
      curPart = 20 + bi;

      var bw = 0.50 + crnd() * 0.70;      // половина длины
      var bd = 0.42 + crnd() * 0.45;      // половина ширины
      var bh = 0.55 + crnd() * 1.05;
      var brot = crnd() * Math.PI;
      var ca2 = Math.cos(brot), sa2 = Math.sin(brot);

      function bpt(lx, lz, y) {
        return addXYZ(ccx + lx * ca2 - lz * sa2, y, ccz + lx * sa2 + lz * ca2);
      }
      var lxs = [-bw, bw, bw, -bw], lzs = [-bd, -bd, bd, bd];
      var nrm = [[0, -1], [1, 0], [0, 1], [-1, 0]];

      /* Дома стоят на склоне, а не на уровне площадки: основание
         опущено по рельефу. Именно это и читается как «город внизу». */
      var cby = groundY(crad);
      var shellStart = shells.length;
      var bb = [], bt = [];
      for (var k = 0; k < 4; k++) {
        bb.push(bpt(lxs[k], lzs[k], cby));
        bt.push(bpt(lxs[k], lzs[k], cby + bh));
      }

      var wf = [];
      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4;
        var nx2 = nrm[k][0] * ca2 - nrm[k][1] * sa2;
        var nz2 = nrm[k][0] * sa2 + nrm[k][1] * ca2;
        wf.push(shellRaw('city', bb[k], bb[k1], bt[k1], bt[k], nx2, 0, nz2));
      }
      var rf = shellRaw('cityTop', bt[0], bt[1], bt[2], bt[3], 0, 1, 0);

      /* КРЫШИ. Сцену часто смотрят сверху, а плоский четырёхугольник
         сверху — это просто серое пятно. Поэтому у каждого дома есть
         парапет по краю и один служебный домик на кровле: выход с
         лестницы или бак. Два простых объёма, а крыша сразу читается
         как крыша. */
      /* ВНИМАНИЕ на высоту. Дома стоят на склоне, их основание опущено
         на cby. Стены строятся как (cby + bh), и парапет обязан считаться
         так же. В первом заходе я написал просто bh — и парапет повис
         на этаж выше крыши пустой рамой, будто футбольные ворота. */
      var PARA = 0.075, INS = 0.10;
      var yRoof = cby + bh;
      var pb = [], pt = [];
      for (var k2 = 0; k2 < 4; k2++) {
        pb.push(bpt(lxs[k2] * (1 - INS / bw), lzs[k2] * (1 - INS / bd), yRoof));
        pt.push(bpt(lxs[k2] * (1 - INS / bw), lzs[k2] * (1 - INS / bd), yRoof + PARA));
      }
      var tb = [], tt = [];
      for (var k3 = 0; k3 < 4; k3++) {
        tb.push(bpt(lxs[k3], lzs[k3], yRoof));
        tt.push(bpt(lxs[k3], lzs[k3], yRoof + PARA));
      }
      for (var k4 = 0; k4 < 4; k4++) {
        var k5 = (k4 + 1) % 4;
        var nxp = nrm[k4][0] * ca2 - nrm[k4][1] * sa2;
        var nzp = nrm[k4][0] * sa2 + nrm[k4][1] * ca2;
        shellRaw('cityPara', tb[k4], tb[k5], tt[k5], tt[k4], nxp, 0, nzp);   // наружная стенка
        shellRaw('cityPara', pt[k4], pt[k5], tt[k5], tt[k4], 0, 1, 0);       // верх парапета
        shellRaw('cityPara', pb[k4], pb[k5], pt[k5], pt[k4], -nxp, 0, -nzp); // изнанка
        line(tt[k4], tt[k5], THIN, rf, rf);
      }

      // служебный домик на кровле
      var hx0 = bw * (0.12 + crnd() * 0.30), hz0 = bd * (0.10 + crnd() * 0.30);
      var hw = bw * 0.26, hd = bd * 0.30, hh2 = 0.10 + crnd() * 0.09;
      var ub = [], ut = [];
      var uxs = [hx0 - hw, hx0 + hw, hx0 + hw, hx0 - hw];
      var uzs = [hz0 - hd, hz0 - hd, hz0 + hd, hz0 + hd];
      for (var k6 = 0; k6 < 4; k6++) {
        ub.push(bpt(uxs[k6], uzs[k6], yRoof));
        ut.push(bpt(uxs[k6], uzs[k6], yRoof + hh2));
      }
      for (var k7 = 0; k7 < 4; k7++) {
        var k8 = (k7 + 1) % 4;
        var nxu = nrm[k7][0] * ca2 - nrm[k7][1] * sa2;
        var nzu = nrm[k7][0] * sa2 + nrm[k7][1] * ca2;
        shellRaw('city', ub[k7], ub[k8], ut[k8], ut[k7], nxu, 0, nzu);
        line(ut[k7], ut[k8], THIN, rf, rf);
      }
      shellRaw('cityTop', ut[0], ut[1], ut[2], ut[3], 0, 1, 0);

      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4;
        line(bb[k], bb[k1], MED,  wf[k], wf[k]);
        line(bt[k], bt[k1], MED,  wf[k], rf);
        line(bb[k], bt[k], MED,   wf[(k + 3) % 4], wf[k]);
        /* Жирный контур силуэта дальним домам НЕ даём. Их заливка съедена
           воздухом и почти сливается со склоном, а тяжёлая обводка
           поверх превращала дом в пустой каркас — «недорисованное».
           Обычных линий рёбер им достаточно. */
      }

      // пояс окон: одна лента на стену, дальше глаз всё равно не читает
      var gy0 = cby + bh * 0.40, gy1 = cby + bh * 0.66;
      for (var k = 0; k < 4; k++) {
        var k1 = (k + 1) % 4;
        var ix0 = lxs[k] + (lxs[k1] - lxs[k]) * 0.14;
        var iz0 = lzs[k] + (lzs[k1] - lzs[k]) * 0.14;
        var ix1 = lxs[k] + (lxs[k1] - lxs[k]) * 0.86;
        var iz1 = lzs[k] + (lzs[k1] - lzs[k]) * 0.86;
        var nx2 = nrm[k][0] * ca2 - nrm[k][1] * sa2;
        var nz2 = nrm[k][0] * sa2 + nrm[k][1] * ca2;
        var bandId = shellRaw('cityBand',
                 bpt(ix0, iz0, gy0), bpt(ix1, iz1, gy0),
                 bpt(ix1, iz1, gy1), bpt(ix0, iz0, gy1), nx2, 0, nz2);
        var NW = 5;
        for (var w3 = 1; w3 < NW; w3++) {
          var tt = w3 / NW;
          line(bpt(ix0 + (ix1 - ix0) * tt, iz0 + (iz1 - iz0) * tt, gy0),
               bpt(ix0 + (ix1 - ix0) * tt, iz0 + (iz1 - iz0) * tt, gy1),
               THIN, bandId, bandId);
        }
      }

      // всем граням дома ставим его номер — по нему движок их и соберёт
      // номер дома ставим ВСЕМ его граням, сколько бы их ни стало
      for (var q2 = shellStart; q2 < shells.length; q2++) shells[q2].bld = bi;
      city.push0 = 0;

      city.push({ x: ccx, z: ccz, h: bh, lamp: crnd() });
      cityCenters.push(ccx, cby + bh * 0.5 - yCenter, ccz);
      cityParts.push(20 + bi);
    }
    curPart = 0;

