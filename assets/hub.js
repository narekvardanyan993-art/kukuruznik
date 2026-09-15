/* Չկա — главная. Карандашные рамки и превращение фото в рисунок. */
(function () {
  document.documentElement.classList.add('js');

  var SVG = 'http://www.w3.org/2000/svg';

  function random(seed) {
    return function () {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
  }

  function f(n) { return Math.round(n * 10) / 10; }

  function stroke(r, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var j = function (a) { return (r() - 0.5) * 2 * a; };
    var s0 = 0.6 + r() * 1.8, s1 = 0.6 + r() * 1.8;
    var n0 = j(0.6), n1 = j(0.6), bow = j(0.9);
    var ax = x1 - ux * s0 + nx * n0, ay = y1 - uy * s0 + ny * n0;
    var bx = x2 + ux * s1 + nx * n1, by = y2 + uy * s1 + ny * n1;
    var cx = (ax + bx) / 2 + nx * bow, cy = (ay + by) / 2 + ny * bow;
    return 'M' + f(ax) + ' ' + f(ay) + 'Q' + f(cx) + ' ' + f(cy) + ' ' + f(bx) + ' ' + f(by);
  }

  function rect(r) {
    var p = [[0, 0], [100, 0], [100, 100], [0, 100]], d = '';
    for (var i = 0; i < 4; i++) d += stroke(r, p[i][0], p[i][1], p[(i + 1) % 4][0], p[(i + 1) % 4][1]);
    return d;
  }

  var boxes = document.querySelectorAll('[data-frame]');
  for (var i = 0; i < boxes.length; i++) {
    var r = random(97 + i * 131);
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'frame');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    for (var k = 0; k < 2; k++) {
      var path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', rect(r));
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('class', k ? 'p2' : 'p1');
      svg.appendChild(path);
    }
    boxes[i].appendChild(svg);
  }

  var plate = document.getElementById('plate');
  var swap = document.getElementById('swap');
  if (!plate || !swap) return;

  var imgs = plate.querySelectorAll('img');
  var touched = false;

  function loaded(img) {
    return new Promise(function (done) {
      if (img.complete && img.naturalWidth) return done();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  function set(drawn) {
    plate.classList.toggle('drawn', drawn);
    swap.setAttribute('aria-pressed', drawn ? 'true' : 'false');
    swap.textContent = drawn ? 'показать фото' : 'показать рисунок';
  }

  function toggle() {
    touched = true;
    set(!plate.classList.contains('drawn'));
  }

  function whenVisible(run) {
    if (!document.hidden) return run();
    document.addEventListener('visibilitychange', function once() {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', once);
      run();
    });
  }

  set(false);
  swap.addEventListener('click', toggle);
  plate.querySelector('.plate-in').addEventListener('click', toggle);

  Promise.all([loaded(imgs[0]), loaded(imgs[1])])
    .then(function () { return imgs[1].decode ? imgs[1].decode().catch(function () {}) : null; })
    .then(function () {
      plate.classList.add('ready');
      setTimeout(function () {
        whenVisible(function () { if (!touched) set(true); });
      }, 1400);
    });
})();
