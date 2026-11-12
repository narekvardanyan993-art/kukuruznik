#!/usr/bin/env node
// Промо-ролик chka.am на Remotion — одна команда из папки репозитория:
//   node content/remotion/build.mjs content/scenes/pogos-02.json
// Флаги: --still 3.2 (один кадр + поля TikTok, без сборки) · --audio-only (пересвести звук к готовому видео)
//        --browser <путь к Chrome> · --concurrency N
// Результат: content/out/<имя>.mp4, <имя>-sfx.wav (если в content/sfx/ есть звуки), <имя>-sheet.jpg, <имя>-events.json,
//            <имя>-zoom10.jpg (10 кадров подряд на наезде) + проверка плавности в конце
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PUB = path.join(HERE, 'public');
const OUT = path.join(REPO, 'content/out');
const SFX = path.join(REPO, 'content/sfx');

// ---------- аргументы ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const scenePath = argv.find((a) => a.endsWith('.json'));
if (!scenePath) { console.error('нужен сценарий: node content/remotion/build.mjs content/scenes/<имя>.json'); process.exit(2); }
const S = JSON.parse(fs.readFileSync(path.resolve(scenePath), 'utf8'));
const fps = S.fps ?? 30;
const [W, H] = S.size ?? [1080, 1920];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)} с]`, ...a);

const run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { stdio: o.quiet ? 'pipe' : 'inherit', encoding: 'utf8', ...o });
  if (r.status !== 0) { console.error(`ошибка: ${cmd} ${args.join(' ')}\n${r.stderr ?? ''}`); process.exit(1); }
  return r.stdout ?? '';
};

// ---------- пути: repo:… (можно с * в имени файла), cap:<id> ----------
const resolveSrc = (p) => {
  let abs;
  if (p.startsWith('repo:')) abs = path.join(REPO, p.slice(5));
  else if (p.startsWith('cap:')) abs = path.join(REPO, 'content/cache/cap', p.slice(4));
  else abs = path.resolve(REPO, p);
  if (abs.includes('*')) {
    const dir = path.dirname(abs);
    const re = new RegExp('^' + path.basename(abs).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const hit = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort() : [];
    if (!hit.length) { console.error(`нет файла: ${p}`); process.exit(1); }
    abs = path.join(dir, hit[0]);
  }
  if (!fs.existsSync(abs)) {
    console.error(`нет источника: ${p}` + (p.startsWith('cap:') ? '\n  кадры сайта снимает content/template/build.py --capture (см. content/template/README.md)' : ''));
    process.exit(1);
  }
  return abs;
};

// копия в public/ (Remotion отдаёт браузеру только её); повторно не копирует
const publish = (abs) => {
  const rel = path.relative(REPO, abs).split(path.sep).join('/');
  const dst = path.join(PUB, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(abs)) if (/\.(jpg|png|webp)$/i.test(f)) {
      const a = path.join(abs, f), b = path.join(dst, f);
      if (!fs.existsSync(b) || fs.statSync(b).size !== fs.statSync(a).size) fs.copyFileSync(a, b);
    }
  } else if (!fs.existsSync(dst) || fs.statSync(dst).size !== st.size) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(abs, dst);
  }
  return rel;
};

const probe = (abs) => {
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', abs], { quiet: true }));
  const [a, b] = String(j.streams[0].r_frame_rate ?? '0/1').split('/').map(Number);
  return { w: j.streams[0].width, h: j.streams[0].height, dur: parseFloat(j.format?.duration ?? '0'), fps: b ? a / b : 0 };
};
const warns = [];
const warn = (m) => { warns.push(m); console.log('ВНИМАНИЕ:', m); };

// Ролик (Veo 24 к/с) → кадры 30 к/с «кадр в кадр»: обрезать нужный кусок, растянуть по времени (rate),
// дорисовать промежуточные кадры по движению (minterpolate). Без этого 24→30 даёт повтор каждого 4-го кадра,
// а замедление 0,5× — каждый кадр дважды («как 15–20 к/с»). Размер — родной, без увеличения. Кэш — public/_vid/.
// Куски (segs) — несколько отрезков одного ролика подряд в одной карточке (живая запись экрана: набор → прокрутка → …),
// у каждого своя скорость; склейки внутри карточки — мгновенные. crop [x, y, w, h] — срезать статус-бар и т. п.
// Если кадров у источника хватает (запись iPhone 60 к/с при скорости ≤ 2), кадры ОТБИРАЮТСЯ (fps), а не дорисовываются:
// дорисовка (minterpolate) на тексте интерфейса даёт «плывущие» буквы. Не хватает (Veo 24 к/с, замедление) — дорисовка.
const videoToSeq = (abs, segs, id, crop) => {
  const key = crypto.createHash('sha1').update(`${abs}|${fs.statSync(abs).size}|${JSON.stringify(segs)}|${crop}|${fps}|v3`).digest('hex').slice(0, 10);
  const rel = `_vid/${id}-${key}`;
  const dir = path.join(PUB, rel);
  const total = segs.reduce((a, g) => a + g.len, 0);
  const need = Math.round(total * fps);
  if (fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length >= need) return rel;
  fs.mkdirSync(dir, { recursive: true });
  const pr = probe(abs);
  let t = 0, done = 0;
  for (const g of segs) {
    t += g.len;
    const n = Math.round(t * fps) - done;          // кадров в куске (накопленное округление — без дрейфа)
    const vf = crop ? [`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`] : [];
    vf.push(`setpts=(PTS-STARTPTS)/${g.rate}`);
    const interp = pr.fps / g.rate < fps - 0.01;
    // шаг отбора: 60 к/с × скорость / 30 должен быть целым (×1 → 2, ×1,5 → 3, ×2 → 4), иначе кадры идут через 1-2-1-2 — дёргается
    const step = (pr.fps * g.rate) / fps;
    if (!interp && Math.abs(step - Math.round(step)) > 0.05) warn(`ролик ${id}: кусок с ${g.start} с ×${g.rate} — шаг ${step.toFixed(2)} кадра источника, неровный (дёргается); взять скорость с целым шагом`);
    vf.push(interp ? `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1` : `fps=${fps}`);
    log(`ролик ${id}: кусок ${g.start.toFixed(2)}–${(g.start + g.len * g.rate).toFixed(2)} с ×${g.rate} → ${n} кадров (${interp ? 'дорисовка' : 'отбор кадров, без повторов'})`);
    run('ffmpeg', ['-y', '-v', 'error', '-ss', String(g.start), '-t', String(g.len * g.rate + 0.25), '-i', abs, '-vf', vf.join(','),
      '-frames:v', String(n), '-q:v', '2', '-start_number', String(done), path.join(dir, '%04d.jpg')]);
    const got = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
    if (got < done + n) warn(`ролик ${id}: кусок с ${g.start} с дал ${got - done} кадров из ${n}`);
    done += n;
  }
  return rel;
};

// ---------- сценарий → свойства композиции ----------
const D = S.defaults ?? {};
const cards = (S.cards ?? []).map((c) => {
  const d = { ...D.card, ...c };
  const kind = c.src.image ? 'image' : c.src.seq ? 'seq' : 'video';
  const abs = resolveSrc(c.src.image ?? c.src.seq ?? c.src.video);
  let src = { kind, path: '', start: c.src.start ?? 0, rate: c.src.rate ?? 1, reverse: !!c.src.reverse };
  if (kind === 'video') {
    // ролик → кадры (см. videoToSeq); короче карточки → замедлить, но промежуточные кадры дорисовать, а не повторять
    const pr = probe(abs);
    const crop = c.src.crop;
    let segs;
    if (c.src.segs) {
      segs = c.src.segs.map((g) => ({ start: g.from, rate: g.rate ?? 1, len: (g.to - g.from) / (g.rate ?? 1) }));
      const tot = segs.reduce((a, g) => a + g.len, 0);
      if (Math.abs(tot - d.dur) > 0.04) warn(`карточка ${d.id}: куски дают ${tot.toFixed(2)} с, карточка ${d.dur} с — разница стоит последним кадром или режется`);
      const last = segs[segs.length - 1];
      if (d.dur > tot) last.len += d.dur - tot;
    } else {
      let rate = src.rate;
      if (src.start + d.dur * rate > pr.dur - 0.05) {
        rate = Math.max(0.2, (pr.dur - 0.05 - src.start) / d.dur);
        warn(`карточка ${d.id}: ролик короче карточки — скорость ${rate.toFixed(2)} (кадры дорисованы, рывка нет; лучше взять кусок длиннее)`);
      }
      segs = [{ start: src.start, rate, len: d.dur }];
    }
    const rel = videoToSeq(abs, segs, d.id, crop);
    const w = crop ? crop[2] : pr.w, h = crop ? crop[3] : pr.h;
    src = { kind: 'seq', path: rel, start: 0, rate: 1, reverse: src.reverse, w, h, frames: Math.round(d.dur * fps), fps };
  } else if (kind === 'seq') {
    src.path = publish(abs);
    const files = fs.readdirSync(abs).filter((f) => /^\d{4}\.jpg$/.test(f)).sort();
    Object.assign(src, probe(path.join(abs, files[0])), { frames: files.length, fps: c.src.fps ?? 30 });
    const need = (src.start + d.dur * src.rate) * src.fps;
    if (need > files.length + 1) warn(`карточка ${d.id}: кадров сайта ${files.length}, нужно ${Math.ceil(need)} — последний кадр стоит ${((need - files.length) / src.fps).toFixed(1)} с (снять длиннее)`);
    if (Math.abs(src.rate - 1) > 1e-3) warn(`карточка ${d.id}: кадры сайта со скоростью ${src.rate} — соседние кадры смешиваются; чище — снять с нужной скоростью (speed) и играть 1:1`);
  } else {
    src.path = publish(abs);
    const pr = probe(abs);
    Object.assign(src, { w: pr.w, h: pr.h });
  }
  // чёткость: сколько пикселей источника приходится на пиксель экрана при самом сильном приближении
  {
    const iw = (d.w ?? 800) - 2 * (d.mat ?? 18), ih = (d.h ?? 1140) - 2 * (d.mat ?? 18);
    const fit = (d.fit ?? 'cover') === 'contain' ? Math.min(iw / src.w, ih / src.h) : Math.max(iw / src.w, ih / src.h);
    const zmax = Math.max(d.cam?.from?.[2] ?? 1, d.cam?.to?.[2] ?? 1.06, ...(d.cam?.keys ?? []).map((k) => +k[3])) * 1.035 * Math.max(1, ...(d.keys ?? []).map((k) => k.s ?? 1));
    const up = fit * zmax;
    if (up > 1.15) warn(`карточка ${d.id}: источник ${src.w}×${src.h} растянут ×${up.toFixed(2)} — будет мыло (карточку меньше или приближение слабее)`);
  }
  return {
    id: d.id, at: d.at, dur: d.dur, x: d.x ?? W / 2, y: d.y ?? 880, w: d.w ?? 800, h: d.h ?? 1140,
    mat: d.mat ?? 18, radius: d.radius ?? 22, src, fit: d.fit ?? 'cover',
    cam: { from: d.cam?.from ?? [0.5, 0.5, 1], to: d.cam?.to ?? [0.5, 0.5, 1.06], ease: d.cam?.ease ?? 'inout', ...(d.cam?.keys ? { keys: d.cam.keys } : {}) },
    keys: d.keys, frame: d.frame ?? 'photo', float: d.float,
    look: d.look ?? {}, rot: d.rot ?? 0, enter: d.enter ?? 'depth', exit: d.exit ?? 'left',
    enterDur: d.enterDur ?? 0.55, exitDur: d.exitDur ?? 0.42,
    sfx_in: d.sfx_in ?? 'whoosh', sfx_out: d.sfx_out ?? 'whoosh',
  };
});

let n = 0;
// chain — цепочка мелочей (точки, фишки-годы, знаки, тап): входят друг за другом с шагом step,
// уходят вместе в конце (обратной лесенкой). На каждый вход — короткий pop/click.
const flat = [];
for (const it of S.items ?? []) {
  if (it.kind !== 'chain') { flat.push(it); continue; }
  const step = it.step ?? 0.12, list = it.items ?? [];
  if (list.length > 5 || step < 0.08) warn(`цепочка на ${it.at} с: ${list.length} элементов, шаг ${step} — мельтешит (3–5 элементов, шаг ≥ 0,08 с)`);
  list.forEach((m, k) => {
    const at = it.at + k * step;
    const end = it.dur ? it.at + it.dur - (list.length - 1 - k) * 0.05 : 0;
    flat.push({ ...m, on: m.on ?? it.on, at, dur: it.dur ? Math.max(0.3, end - at) : 0, chain: `${it.at}`, ci: k });
  });
}
const SIZE = { dot: 44, chip: 54, tap: 140, ruler: 34 };
const items = flat.map((it) => {
  const d = { ...D[it.kind], ...it };
  const o = { ...d, id: d.id ?? `${d.kind}${n++}`, rot: d.rot ?? 0, size: d.size ?? SIZE[d.kind] ?? 80, dur: d.dur ?? 0 };
  if (d.kind === 'tag') {
    // слово за словом: шаг 70 мс (docs/ANIMATION.md: лесенка 50–80 мс)
    const step = d.step ?? 0.07;
    o.words = String(d.text).split(/\s+/).filter(Boolean).map((s, i) => ({ s, at: d.at + 0.08 + i * step }));
  }
  if (d.kind === 'stamp') o.impact = d.impact ?? 0.14;
  return o;
});

const shakes = items.filter((i) => i.kind === 'stamp').map((i) => ({ t: i.at + i.impact, amp: i.shake ?? 16 }));
const dur = S.dur ?? Math.max(...cards.map((c) => c.at + c.dur));
const fontList = (S.fonts ?? []).map((f) => ({ family: 'Chka Serif', path: publish(resolveSrc(f.file)), range: f.range }));
const props = {
  fps, width: W, height: H, durationInFrames: Math.round(dur * fps), safe: S.safe ?? [250, 600, 160],
  bg: { paper: S.bg?.paper ? publish(resolveSrc(S.bg.paper)) : '', grid: S.bg?.grid ?? 60 },
  fonts: fontList, cards, items, shakes, showSafe: flag('--still') || flag('--safe'),
};

// ---------- события звука: каждое появление и уход ----------
const G = { whoosh: -19, pop: -17, click: -23, stamp: -11, out: -21, key: -21, tick: -22, scroll: -22 };
const MICRO = { pop: -24, click: -27, tick: -25 };   // мелочи цепочек и линеек — тише главных событий
const ev = [];
// type — тип звука (pop, out, whoosh, click, key, scroll, tick, stamp) или начало имени файла (key_enter)
const add = (t, type, what, gain = G[type] ?? G[String(type).split('_')[0]] ?? -20) => { if (type && type !== 'none' && t >= 0 && t < dur) ev.push({ t: +t.toFixed(3), type, what, gain_db: gain }); };
const DROP_OUT = 0.18;   // уход «капли» (ease.ts) — звук исчезновения в начале ухода
for (const c of cards) {
  add(c.at, c.sfx_in, `карточка ${c.id}: вход`);
  if (c.exit !== 'none') add(c.at + c.dur - c.exitDur, c.sfx_out, `карточка ${c.id}: уход`, G.whoosh - 3);
}
for (const i of items) {
  if (i.kind === 'sfx') { add(i.at, i.type, i.what ?? `звук ${i.type}`, i.gain ?? undefined); continue; }   // звук без картинки (прокрутка, листание в записи)
  if (i.sfx === 'none') continue;           // элемент без звука (когда рядом уже звучит другое)
  const out = i.at + i.dur - DROP_OUT;
  const outOk = i.sfx_out !== 'none';      // sfx_out: "none" — уход без звука; строка — свой тип звука ухода
  const outT = typeof i.sfx_out === 'string' && i.sfx_out !== 'none' ? i.sfx_out : 'out';
  const inT = (d) => (typeof i.sfx === 'string' ? i.sfx : d);   // sfx: "key" — свой тип звука входа
  if (i.kind === 'tag') {
    add(i.at, inT('pop'), `бирка «${i.text}»: появление`);
    i.words.forEach((w, k) => k > 0 && add(w.at, 'click', `слово «${w.s}»`, G.click - 2));
    if (i.dur && outOk) add(out, outT, `бирка «${i.text}»: исчезновение`);
  } else if (i.kind === 'icon') {
    add(i.at, inT('pop'), `значок ${i.name}: появление`);
    if (i.dur && outOk) add(out, outT, `значок ${i.name}: исчезновение`);
  } else if (i.kind === 'ruler') {
    const n = i.n ?? 5, step = i.step ?? 0.09;
    for (let k = 0; k < n; k++) add(i.at + k * step, inT('tick'), `линейка: кусок ${k + 1}/${n}`, MICRO.tick);
    if (i.dur && outOk) add(out - (n - 1) * 0.025, outT, 'линейка: исчезновение', G.out - 3);
  } else if (i.kind === 'tap') {
    const ty = inT('click');
    add(i.at, ty, 'тап', ty === 'click' ? G.click + 6 : undefined);
  } else if (i.kind === 'stamp') {
    add(i.at + i.impact, 'stamp', `штамп «${i.mid}»`);
  } else if (i.kind === 'counter') {
    add(i.at, 'pop', `счётчик ${i.from}: появление`);
    if (i.to) add(i.at + (i.tick ?? 1), 'click', `счётчик ${i.from} → ${i.to}`, G.click + 4);
    if (i.dur && outOk) add(out, 'whoosh', `счётчик: уход`, G.whoosh - 5);
  } else if (i.kind === 'dot' || i.kind === 'chip') {
    // в цепочке звуки чередуются: pop, click, pop… (один файл подряд не звучит)
    const type = inT(i.chain !== undefined ? (i.ci % 2 ? 'click' : 'pop') : 'pop');
    add(i.at, type, `${i.kind === 'dot' ? 'точка' : `фишка «${i.text}»`}: появление`, MICRO[type]);
    if (i.dur && outOk && (i.chain === undefined || i.ci === 0)) add(out + (i.chain !== undefined ? 0.05 : 0), outT, `${i.chain !== undefined ? `цепочка ${i.chain}` : i.kind}: исчезновение`, G.out - 3);
  }
}
ev.sort((a, b) => a.t - b.t);

// файлы по типу: content/sfx/<тип>*.wav|mp3; один и тот же файл подряд не повторять
// тип — начало имени файла: pop → pop_*.mp3; key_enter → только key_enter.mp3
const files = fs.existsSync(SFX) ? fs.readdirSync(SFX).filter((f) => /\.(wav|mp3)$/i.test(f)).sort() : [];
const poolOf = (type) => files.filter((f) => f.toLowerCase().startsWith(String(type).toLowerCase())).map((f) => path.join(SFX, f));
let seed = S.seed ?? 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const last = {};
for (const e of ev) {
  const list = poolOf(e.type);
  if (!list?.length) { e.file = null; continue; }
  let cand = list.length > 1 ? list.filter((f) => f !== last[e.type]) : list;
  e.file = path.relative(REPO, cand[Math.floor(rnd() * cand.length)]);
  // лёгкий разброс высоты ±4 %: у типа с одним файлом (out, key_enter) подряд звучит не «одно и то же»
  e.pitch = +(0.96 + 0.08 * rnd()).toFixed(3);
  last[e.type] = path.join(REPO, e.file);
}
// темп звука (отзыв Нарека: «темп держать звуками всё время»): событие хотя бы раз в 0,5 с, не больше двух разом
const density = (() => {
  const ts = ev.filter((e) => e.file || !files.length).map((e) => e.t).sort((a, b) => a - b);
  let maxGap = ts.length ? ts[0] : dur, gapAt = 0, maxSim = 0, simAt = 0;
  for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > maxGap) { maxGap = ts[k] - ts[k - 1]; gapAt = ts[k - 1]; }
  if (ts.length && dur - ts[ts.length - 1] > maxGap) { maxGap = dur - ts[ts.length - 1]; gapAt = ts[ts.length - 1]; }
  for (let k = 0; k < ts.length; k++) { const n = ts.filter((x) => x >= ts[k] && x < ts[k] + 0.04).length; if (n > maxSim) { maxSim = n; simAt = ts[k]; } }
  const gaps = [];
  for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 0.5) gaps.push(`${ts[k - 1].toFixed(2)}–${ts[k].toFixed(2)}`);
  return { per_sec: +(ts.length / dur).toFixed(2), max_gap: +maxGap.toFixed(2), max_gap_at: gapAt, max_together: maxSim, together_at: simAt, gaps_over_05: gaps };
})();
if (S.tempo !== false) {
  if (density.gaps_over_05.length) warn(`звук: тишина дольше 0,5 с — ${density.gaps_over_05.join(', ')}`);
  if (density.max_together > 2) warn(`звук: ${density.max_together} звука разом на ${density.together_at} с (не больше двух)`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(HERE, '.props'), { recursive: true });
const name = S.name;
const propsFile = path.join(HERE, '.props', `${name}.json`);
fs.writeFileSync(propsFile, JSON.stringify(props));
const evFile = path.join(OUT, `${name}-events.json`);
fs.writeFileSync(evFile, JSON.stringify({ name, dur, fps, sfx_dir: 'content/sfx', density, counts: Object.fromEntries(Object.keys(G).map((k) => [k, ev.filter((e) => String(e.type).startsWith(k)).length])), events: ev }, null, 1));
log(`сценарий: ${cards.length} карточек, ${items.length} элементов, ${ev.length} звуковых событий, ${dur} с · звук: ${density.per_sec}/с, самая длинная тишина ${density.max_gap} с, разом до ${density.max_together}`);

// ---------- Remotion ----------
const remotion = path.join(HERE, 'node_modules/.bin/remotion');
if (!fs.existsSync(remotion)) { console.error('нет Remotion: cd content/remotion && npm install'); process.exit(1); }
const browser = opt('--browser', process.env.REMOTION_CHROME);
const common = ['--props', propsFile, ...(browser ? ['--browser-executable', browser] : [])];

if (flag('--still')) {
  const sec = parseFloat(opt('--still', '1'));
  const png = path.join(OUT, `${name}-still-${sec}.png`);
  run(remotion, ['still', 'src/index.ts', 'promo', png, '--frame', String(Math.round(sec * fps)), ...common], { cwd: HERE });
  log(`кадр: ${path.relative(REPO, png)}`);
  process.exit(0);
}

const mp4 = path.join(OUT, `${name}.mp4`);
const silent = path.join(HERE, '.props', `${name}-video.mp4`);
if (!flag('--audio-only')) {
  run(remotion, ['render', 'src/index.ts', 'promo', silent, ...common,
    '--codec', 'h264', '--crf', '18', '--pixel-format', 'yuv420p', '--color-space', 'bt709',
    '--image-format', 'jpeg', '--jpeg-quality', '92', '--muted',
    '--concurrency', opt('--concurrency', '50%'), '--log', 'info', ...(opt('--frames') ? ['--frames', opt('--frames')] : [])], { cwd: HERE });
  log('видео собрано');
}

// ---------- звук: отдельная дорожка + в ролик ----------
const wav = path.join(OUT, `${name}-sfx.wav`);
const withFile = ev.filter((e) => e.file);
if (withFile.length) {
  const args = ['-y', '-v', 'error', '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=48000:cl=stereo'];
  const fl = [];
  withFile.forEach((e, k) => {
    args.push('-i', path.join(REPO, e.file));
    const ms = Math.round(e.t * 1000);
    // тишину в начале файла срезать (удар — точно в событие), хвост не длиннее 1,2 с
    const pt = e.pitch && Math.abs(e.pitch - 1) > 1e-3 ? `asetrate=${Math.round(48000 * e.pitch)},aresample=48000,` : '';
    fl.push(`[${k + 1}:a]aresample=48000,${pt}aformat=channel_layouts=stereo,silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:1.2,afade=t=out:st=0.9:d=0.3,volume=${e.gain_db}dB,adelay=${ms}|${ms}[a${k}]`);
  });
  fl.push(`[0:a]${withFile.map((_, k) => `[a${k}]`).join('')}amix=inputs=${withFile.length + 1}:normalize=0:duration=first,alimiter=limit=0.7[out]`);
  run('ffmpeg', [...args, '-filter_complex', fl.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', wav]);
  log(`звуки: ${withFile.length} из ${ev.length} событий → ${path.relative(REPO, wav)}`);
} else {
  log(`звуков нет (content/sfx/ пуст) — ролик без звука, разметка в ${path.relative(REPO, evFile)}`);
}
const mux = ['-y', '-v', 'error', '-i', silent];
if (withFile.length) mux.push('-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k');
else mux.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '64k');
// пометка цвета bt709 (iPhone иначе показывает мутно — lessons.md §7)
run('ffmpeg', [...mux, '-c:v', 'copy', '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-shortest', '-movflags', '+faststart', mp4]);

// ---------- лист: кадр на каждую секунду ----------
const sheet = path.join(OUT, `${name}-sheet.jpg`);
const cols = 7, rows = Math.ceil(dur / cols);
run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vf', `fps=1,scale=216:384,tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', '-q:v', '3', sheet]);
log(`готово: ${path.relative(REPO, mp4)} · ${path.relative(REPO, sheet)} · ${path.relative(REPO, evFile)}`);

// ---------- плавность и чёткость: 10 кадров подряд на наезде + повторы кадров ----------
// Повтор = кадр почти не отличается от соседа, хотя камера идёт (признак «20 к/с»). Окно — середина каждой карточки.
{
  const cw = 360, chh = 480;   // центр кадра (там карточка), уменьшено ×3
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', `crop=${cw * 3}:${chh * 3}:0:220,scale=${cw}:${chh},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  const buf = raw.stdout, fsz = cw * chh, N = Math.floor(buf.length / fsz);
  const diff = [];
  for (let k = 1; k < N; k++) { let s2 = 0; const a = (k - 1) * fsz, b = k * fsz; for (let i = 0; i < fsz; i += 3) s2 += Math.abs(buf[a + i] - buf[b + i]); diff.push(s2 / (fsz / 3)); }
  const rows = [];
  let worst = null;
  for (const c of cards) {
    const i0 = Math.round((c.at + c.enterDur + 0.1) * fps), i1 = Math.round((c.at + c.dur - c.exitDur - 0.1) * fps);
    const seg2 = diff.slice(i0, i1); if (seg2.length < 6) continue;
    const med = [...seg2].sort((x, y) => x - y)[Math.floor(seg2.length / 2)];
    // повтор: кадр заметно «тише» обоих соседей (дубль картинки, меняется только камера) — пила 20/10/20/10
    let rep = 0;
    for (let k = 1; k < seg2.length - 1; k++) if (seg2[k] < 0.65 * Math.min(seg2[k - 1], seg2[k + 1]) && seg2[k - 1] > 0.8 && seg2[k + 1] > 0.8) rep++;
    rows.push({ card: c.id, frames: seg2.length, median_diff: +med.toFixed(2), repeats: rep });
    const zch = Math.abs(c.cam.to[2] - c.cam.from[2]);
    if (!worst || zch > worst.z) worst = { z: zch, c };
  }
  const zt = S.check_zoom ?? (worst ? worst.c.at + worst.c.dur / 2 : dur / 2);
  const strip = path.join(OUT, `${name}-zoom10.jpg`);
  run('ffmpeg', ['-y', '-v', 'error', '-ss', String(zt), '-i', mp4, '-vf', `crop=640:640:220:560,tile=5x2:padding=4:color=white`, '-frames:v', '1', '-q:v', '2', strip]);
  const rep = rows.reduce((a, r) => a + r.repeats, 0);
  fs.writeFileSync(path.join(OUT, `${name}-smooth.json`), JSON.stringify({ zoom10_at: zt, repeats_total: rep, cards: rows, sound: density, warnings: warns }, null, 1));
  console.table(rows);
  log(`плавность: повторов кадров ${rep} · 10 кадров подряд с ${zt.toFixed(2)} с → ${path.relative(REPO, strip)}`);
  if (warns.length) console.log('ВНИМАНИЕ:\n- ' + warns.join('\n- '));
}
