    /* Указатель «какие линии принадлежат какому слою». Без него движок
       при рисовании каждого предмета пробегал ВЕСЬ список линий: у
       четырнадцати соседних домов это четырнадцать проходов по полутора
       тысячам линий на каждый из шести штрихов. Отсюда и просадка до
       тридцати кадров на телефоне. */
    /* То же самое для заливок: у каждого сорта поверхности свой список
       граней. Иначе каждая заливка (а их за кадр под сотню) пробегает
       все полторы тысячи граней сцены. */
    var shellIndex = {};
    for (var si2 = 0; si2 < shells.length; si2++) {
      var kk = shells[si2].kind;
      (shellIndex[kk] || (shellIndex[kk] = [])).push(si2);
    }
    for (var sk in shellIndex) shellIndex[sk] = new Uint32Array(shellIndex[sk]);

    var partIndex = {};
    for (var pi = 0; pi < parts.length; pi++) {
      (partIndex[parts[pi]] || (partIndex[parts[pi]] = [])).push(pi);
    }
    for (var pk in partIndex) partIndex[pk] = new Uint32Array(partIndex[pk]);

    return {
      /* Вращающееся кафе под колпаком: наружу отдаём только кольцо, по
         которому движок рассадит силуэты. Столики в модели не нужны —
         они живут на экране. */
      cafe: {
        r: rRim * 0.90,
        y: (rimY + glassY) * 0.5 - yCenter
      },
      spinRange: [spin0, spin1],
      glow: new Uint16Array(glow),
      shellIndex: shellIndex,
      partIndex: partIndex,
      flags: flags,
      benches: benches,
      urns: urns,
      cars: cars,
      lamps: lamps,
      galleryPosts: galleryPosts,
      city: city,
      cityCenters: new Float32Array(cityCenters),
      cityParts: cityParts,
      trees: trees,
      ribs: N,
      floors: F,
      positions: new Float32Array(pos),
      lines: new Uint16Array(lines),
      styles: new Uint8Array(styles),
      parts: new Uint8Array(parts),
      lfa: new Int32Array(lfa),
      lfb: new Int32Array(lfb),
      ldir: new Float32Array(ldir),
      shells: shells,
      cells: cells,
      outline: new Int32Array(outline),
      outlineParts: new Int32Array(outlineParts),
      ground: { ring: new Uint16Array(groundRing), y: yGround - yCenter },
      groundCount: GN,
      hallCenter: [(HX0 + HX1) * 0.5, 0.6 - yCenter, 0],
      hallShadow: new Uint16Array(hallShadow),
      wingCenter: [(WX0 + WX1) * 0.5, 0.5 - yCenter, 0],
      wingShadow: new Uint16Array(wingShadow),
      /* Круги, на которые ложится тень: тень подиума на земле,
         тень высокой башни на земле, тень башни на верхнем ярусе подиума
         и контактная тень у самого основания ствола. */
      shadows: [
        { layer: 0, r: 3.2, cx: (PODX0 + PODX1) * 0.5, cz: (TIERS3[0].z0 + TIERS3[0].z1) * 0.5,
          y: yGround - yCenter, alpha: 0.18 },
        { layer: 0, r: R * 1.35, isTower: true,
          y: yGround - yCenter, alpha: 0.16, off: 1.80 },
        { layer: 1, r: R * 1.35, isTower: true,
          y: TIERS3[2].y1 - yCenter, alpha: 0.16, off: 0.70 },
        { layer: 1, r: R * 1.08,
          y: TIERS3[2].y1 - yCenter, alpha: 0.22, off: 0.15 }
      ],
      height: capY - yGround,
      width: PODX1 - PODX0
    };
  }

  global.Model = { build: build, buildRotunda: build };

