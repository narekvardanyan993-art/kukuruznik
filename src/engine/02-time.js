  function applyTime(t) {
    TOD = t;
    NIGHT = t < 0.46 ? 0 : Math.min(1, (t - 0.46) / 0.40);
    var d = 1 - Math.abs(t - 0.50) / 0.22;
    DUSK = d > 0 ? d : 0;

    C_PAVE = tint(B.PAVE);
    C_TERR = tint(B.TERR);         C_TERRTOP = tint(B.TERRTOP);
    C_CITY = tint(B.CITY);         C_CITY_TOP = tint(B.CITY_TOP);
    C_CITY_BND = lamp(B.CITY_BND, NIGHT * 0.85);
    C_TREE_A = tint(B.TREE_A);     C_TREE_B = tint(B.TREE_B);
    C_TREE_DRK = tint(B.TREE_DRK); C_TRUNK = tint(B.TRUNK);
    C_GROUND = tint(B.GROUND);     C_GROUND_FAR = tint(B.GROUND_FAR);
    C_PODIUM = tint(B.PODIUM);     C_HALL = tint(B.HALL);
    C_SLAB = tint(B.SLAB);         C_SLABTOP = tint(B.SLABTOP);
    C_DECK = tint(B.DECK);         C_SHAFT = tint(B.SHAFT);
    C_NECK = tint(B.NECK);         C_PARAPET = tint(B.PARAPET);
    C_RAIL = tint(B.RAIL);         C_ROOF = tint(B.ROOF);
    C_FLARE = tint(B.FLARE);
    C_GLASS = lamp(B.GLASS, NIGHT * 0.9);          // ресторан вечером горит
    C_CELL_LIT = tint(B.CELL_LIT); C_CELL_DRK = tint(B.CELL_DRK);
    C_WIN_LIT = tint(B.WIN_LIT);   C_WIN_DRK = tint(B.WIN_DRK);
    C_BALC_LIT = tint(B.BALC_LIT); C_BALC_DRK = tint(B.BALC_DRK);
    C_SIDE_LIT = tint(B.SIDE_LIT); C_SIDE_DRK = tint(B.SIDE_DRK);
    C_SHADOW = tint(B.SHADOW);
    INK = tint(B.INK);
    // ночью тушь светлеет, иначе рисунок тонет в темноте
    if (NIGHT > 0) {
      var ic = parseCol(INK), a = 0.62 * NIGHT;
      INK = 'rgb(' + ((ic[0] + (168 - ic[0]) * a) | 0) + ',' +
                     ((ic[1] + (178 - ic[1]) * a) | 0) + ',' +
                     ((ic[2] + (202 - ic[2]) * a) | 0) + ')';
    }

    /* Солнце ходит по небу вместе с ползунком: к вечеру оно ниже и
       сбоку, и тени удлиняются сами. Это и делает картинку живой
       сильнее любой анимации. */
    var ang = Math.PI * (0.14 + t * 0.74);
    var ly = Math.sin(ang); if (ly < 0.20) ly = 0.20;
    var lx = Math.cos(ang) * 0.92, lz = 0.52;
    var ln = Math.sqrt(lx * lx + ly * ly + lz * lz);
    LX = lx / ln; LY = ly / ln; LZ = lz / ln;
  }

  var CAM_DIST = 14;    // камера стоит на этом расстоянии
  var FOCAL    = 10;    // «фокусное»: больше — меньше перспективы
  /* ПЛОТНОСТЬ ПИКСЕЛЕЙ.

     Раньше стояла жёсткая двойка «выше нет смысла». Смысл есть: у
     айфона плотность тройная, и при двойке тонкая линия туши ложится
     между пикселями — получается лесенка и грязь. Весь рисунок held на
     линиях, поэтому для него плотность важнее, чем для заливок.

     Берём тройку, но с подстраховкой: если устройство не тянет,
     движок сам опускается до двойки (см. setLod). */
  var MAX_DPR  = 3;

  // Свет. Задаётся временем суток (см. applyTime выше).
  var LX = -0.46, LY = 0.58, LZ = 0.67;

  // Дрожание линий должно быть у каждой линии своё, но ПОСТОЯННОЕ:
  // если пересчитывать его каждый кадр, рисунок будет мерцать.
  function seeded(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

