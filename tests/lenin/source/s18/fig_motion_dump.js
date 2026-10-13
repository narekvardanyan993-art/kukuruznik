// s18: движение фигур кадра — тот же код, что в engine/viewer.js (figInit/figMotion/figFill), шаг 60 Гц; для листа/GIF в Python.
// node fig_motion_dump.js <building.json> <номер кадра 0..> <T секунд> <кадров> [night 0..1] > motion.json
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const src = fs.readFileSync(path.join(ROOT, 'engine/viewer.js'), 'utf8');
const a = src.indexOf('// ---------- e1.22 FIGURES: движение фигур'), b = src.indexOf('  function figUpload');
const r0 = src.indexOf('  function rng(seed)'), r1 = src.indexOf('\n  }\n', r0) + 4;
const [bj, idxS, TS, NS, nightS] = process.argv.slice(2);
const B = JSON.parse(fs.readFileSync(bj, 'utf8')), idx = +idxS, T = +TS, N = +NS, night = +(nightS || 0);
global.CONFIG = { FIGURES: B.frames.map(f => f.figures) };
const out = eval(`var FIG_TYPES = ['sit','stand','chess','pigeon','balloon','leaf','grass']; var FIGS = CONFIG.FIGURES.map(q => q && q.items ? q.items : []);
  var FN = FIGS.reduce((m, a) => Math.max(m, a.length), 0), FIGB = true; var wx = {wind: 1}, tod = {night: ${night}}, fx = {figOn: true};` + src.slice(r0, r1) + src.slice(a, b) + `
  var f = {idx: ${idx}}, res = [], want = [], k = 0; for (let i = 0; i < ${N}; i++) want.push(${T} * i / Math.max(1, ${N} - 1));
  for (let t = 0; t <= ${T} + 1e-6 && k < want.length; t += 1 / 60) {
    figFill(f, 0, t);
    if (t + 1e-6 >= want[k]) { res.push({t: +t.toFixed(3), buf: Array.from(FIG_BUF[0].slice(0, 8 * FIGS[${idx}].length))}); k++; }
  }
  res`);
process.stdout.write(JSON.stringify({ items: global.CONFIG.FIGURES[idx].items, frames: out }));
