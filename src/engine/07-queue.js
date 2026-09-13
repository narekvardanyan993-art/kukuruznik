  Engine.prototype.buildQueue = function () {
    var m = this.model, r = this.rot, pz = this.pz;
    var lod = this.lod === undefined ? 1 : this.lod;
    var Q = this.queue || (this.queue = []);
    Q.length = 0;

    function depth(x, y, z) {
      var z1 = -x * r.sy + z * r.cy;
      return y * r.sp + z1 * r.cp;
    }
    function add(z, t, i) { Q.push({ z: z, t: t, i: i }); }

    /* Стилобат и башня стоят в центре сцены, их глубина нулевая.
       Башня всегда после стилобата — она на нём стоит. */
    add(0, 4);          // стилобат с лестницами и порталом
    add(0.0001, 5);     // ствол и тарелка

    var hc = m.hallCenter; add(depth(hc[0], hc[1], hc[2]), 0);
    var wc = m.wingCenter; add(depth(wc[0], wc[1], wc[2]), 1);

    var cc = m.cityCenters;
    var nCity = cc ? Math.max(4, Math.round(m.city.length * lod)) : 0;
    for (var i = 0; i < nCity; i++) {
      add(depth(cc[i * 3], cc[i * 3 + 1], cc[i * 3 + 2]), 2, i);
    }
    var T = m.trees;
    var nTree = T ? Math.max(10, Math.round(T.length * lod)) : 0;
    for (var j = 0; j < nTree; j++) add(pz[T[j].p], 3, j);

    var LP = m.lamps;
    var nLamp = LP ? (lod < 0.7 ? Math.round(LP.length * 0.6) : LP.length) : 0;
    for (var l = 0; l < nLamp; l++) add(pz[LP[l].b], 6, l);
    var BN = m.benches;
    if (BN) for (var n = 0; n < BN.length; n++) add(pz[BN[n].a], 7, n);
    var FL = m.flags;
    if (FL) for (var f = 0; f < FL.length; f++) add(pz[FL[f].b], 8, f);

    Q.sort(function (a, b) { return a.z - b.z; });
  };

  /* Рисует ВСЮ очередь от дальнего к ближнему.

     Чтобы добавить новый предмет, достаточно двух строк: положить его
     в buildQueue со своей глубиной и добавить сюда ветку. Никаких
     «слоёв» больше нет — порядок считается каждый кадр. */
  Engine.prototype.drawQueue = function () {
    var Q = this.queue, m = this.model;
    for (var q = 0; q < Q.length; q++) {
      var e = Q[q];
      switch (e.t) {
        case 0: this.drawHall(); break;
        case 1: this.drawWing(); break;
        case 2: this.drawOneCity(e.i); break;
        case 3: this.drawOneTree(m.trees[e.i]); break;
        case 4: this.drawPodium(); break;
        case 5: this.drawTower(); break;
        case 6: this.drawOneLamp(e.i); break;
        case 7: this.drawOneBench(e.i); break;
        case 8: this.drawOneFlag(e.i); break;
      }
    }
  };

  // Стилобат с лестницами, порталом и штриховкой
