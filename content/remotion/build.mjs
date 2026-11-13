#!/usr/bin/env node
// Промо-ролик chka.am на Remotion — одна команда из папки репозитория:
//   node content/remotion/build.mjs content/scenes/pogos-02.json
// Флаги: --still 3.2 (один кадр + поля TikTok, без сборки) · --audio-only (пересвести звук к готовому видео)
//        --browser <путь к Chrome> · --concurrency N · --check (только проверки кадра и сюжета, без сборки)
//        --dry (сценарий → свойства и события, без рендера) · --stdin (сценарий из stdin: проверки без файла)
// Сюжет, подписи, голос, безопасный кадр TikTok — README.md, раздел «Ролик v2»; проверки — zone.mjs
// Результат: content/out/<имя>.mp4, <имя>-sfx.wav (если в content/sfx/ есть звуки), <имя>-sheet.jpg, <имя>-events.json,
//            <имя>-zoom10.jpg (10 кадров подряд на наезде) + проверка плавности в конце
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkStory, checkZone, words as storyWords, zoneOf } from './zone.mjs';

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
if (!scenePath && !flag('--stdin')) { console.error('нужен сценарий: node content/remotion/build.mjs content/scenes/<имя>.json'); process.exit(2); }
const S = JSON.parse(flag('--stdin') ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(scenePath), 'utf8'));
const CHECK = flag('--check');   // только проверки кадра и сюжета
const LIGHT = CHECK || flag('--audio-only');   // картинка не нужна: ролики не режутся на кадры, файлы в public/ не копируются
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
  if (LIGHT) return rel;
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
// twos — не дорисовывать кадры (src.interp: false): рисованный ролик идёт «на двойках» (кадр стоит два кадра ролика),
// чисто, без «плывущих» дорисованных кадров; движение карточки и подписи при этом остаётся в полной частоте.
const videoToSeq = (abs, segs, id, crop, twos = false) => {
  const key = crypto.createHash('sha1').update(`${abs}|${fs.statSync(abs).size}|${JSON.stringify(segs)}|${crop}|${fps}|v5${twos ? '|twos' : ''}`).digest('hex').slice(0, 10);
  const rel = `_vid/${id}-${key}`;
  const dir = path.join(PUB, rel);
  const total = segs.reduce((a, g) => a + g.len, 0);
  const need = Math.round(total * fps);
  if (fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length >= need) return rel;
  fs.mkdirSync(dir, { recursive: true });
  const pr = probe(abs);
  let t = 0, done = 0;
  const bounds = [];
  for (const g of segs) {
    t += g.len;
    const n = Math.round(t * fps) - done;          // кадров в куске (накопленное округление — без дрейфа)
    const vf = crop ? [`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`] : [];
    vf.push(`setpts=(PTS-STARTPTS)/${g.rate}`);
    const interp = !twos && pr.fps / g.rate < fps - 0.01;
    // шаг отбора: 60 к/с × скорость / 30 должен быть целым (×1 → 2, ×1,5 → 3, ×2 → 4), иначе кадры идут через 1-2-1-2 — дёргается
    const step = (pr.fps * g.rate) / fps;
    if (!interp && !twos && Math.abs(step - Math.round(step)) > 0.05) warn(`ролик ${id}: кусок с ${g.start} с ×${g.rate} — шаг ${step.toFixed(2)} кадра источника, неровный (дёргается); взять скорость с целым шагом`);
    vf.push(interp ? `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1` : `fps=${fps}`);
    log(`ролик ${id}: кусок ${g.start.toFixed(2)}–${(g.start + g.len * g.rate).toFixed(2)} с ×${g.rate} → ${n} кадров (${interp ? 'дорисовка' : 'отбор кадров, без повторов'})`);
    run('ffmpeg', ['-y', '-v', 'error', '-ss', String(g.start), '-t', String(g.len * g.rate + 0.25), '-i', abs, '-vf', vf.join(','),
      '-frames:v', String(n), '-q:v', '2', '-start_number', String(done), path.join(dir, '%04d.jpg')]);
    const got = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
    if (got < done + n) warn(`ролик ${id}: кусок с ${g.start} с дал ${got - done} кадров из ${n}`);
    done += n;
    bounds.push(done);
  }
  if (!twos) fixDups(dir, bounds);
  return rel;
};

// Запись iPhone сама теряет кадры: на тяжёлом месте (проявление, листание) телефон отдаёт один кадр дважды, потом скачок.
// После отбора такой кадр = «стоп-кадр» (детектор повторов). Внутри одного куска он заменяется смесью соседей 50/50
// (у растворения это точный промежуточный кадр). Через склейку не смешивать — там кусок подрезать в сценарии.
const fixDups = (dir, bounds) => {
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}\.jpg$/.test(f)).sort();
  if (files.length < 5) return;
  const w = 96, h = 196, sz = w * h;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-start_number', '0', '-i', path.join(dir, '%04d.jpg'), '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  const buf = r.stdout, N = Math.floor(buf.length / sz);
  const d = [0];
  for (let k = 1; k < N; k++) { let s2 = 0; for (let i = 0; i < sz; i++) s2 += Math.abs(buf[k * sz + i] - buf[(k - 1) * sz + i]); d.push(s2 / sz); }
  const segOf = (k) => bounds.findIndex((b) => k < b);
  let fixed = 0;
  for (let k = 2; k < N - 1; k++) {
    if (segOf(k - 1) !== segOf(k + 1)) continue;                  // склейка рядом — не трогать
    const nb = Math.min(d[k - 1], d[k + 1]);
    if (nb > 0.6 && d[k] < 0.55 * nb) {
      const tmp = path.join(dir, `_fix.jpg`);
      run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, files[k - 1]), '-i', path.join(dir, files[k + 1]), '-filter_complex', 'blend=all_mode=average', '-q:v', '2', tmp]);
      fs.renameSync(tmp, path.join(dir, files[k]));
      d[k + 1] = d[k] = (d[k] + d[k + 1]) / 2;   // дальше считать по уже смешанному
      fixed++;
    }
  }
  if (fixed) log(`ролик: ${fixed} потерянных кадров записи заменены смесью соседей`);
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
    const rel = LIGHT ? '_vid/none' : videoToSeq(abs, segs, d.id, crop, c.src.interp === false);
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
    sfx_in: d.sfx_in ?? 'whoosh', sfx_out: d.sfx_out ?? 'whoosh', ...(d.calm ? { calm: true } : {}),
    ...(d.compare ? { compare: (() => {
      // «до / после» шторкой: картинка compare.image поверх src, видна слева от ручки (ключи [t, доля x])
      const a = resolveSrc(d.compare.image), pr = probe(a);
      return { path: publish(a), w: pr.w, h: pr.h, cam: d.compare.cam ?? [0.5, 0.5, 1], keys: d.compare.keys, show: d.compare.show ?? +(d.compare.keys?.[0]?.[0] ?? 0) - 0.2, rect: d.compare.rect, hide: d.compare.hide };
    })() } : {}),
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
// подписи шагов сюжета (story.steps): одна на шаг, стоит весь шаг, вписана в прямоугольник story.caption.box
const Z = zoneOf(S);
const STEPS = S.story?.steps ?? [];
const CAP = { box: [120, 285, 960, 545], size: 96, lead: 0.08, tail: 0.1, ...(S.story?.caption ?? {}) };
STEPS.forEach((s, i) => flat.push({ kind: 'caption', id: `caption${i + 1}`, at: +(s.at + CAP.lead).toFixed(3), dur: +(s.dur - CAP.lead - CAP.tail).toFixed(3), text: s.caption, box: s.box ?? CAP.box, size: s.size ?? CAP.size, ...(s.underline ? { underline: true } : {}) }));
const SIZE = { dot: 44, chip: 54, tap: 140, ruler: 34, loupe: 300 };
const items = flat.map((it) => {
  const d = { ...D[it.kind], ...it };
  const o = { ...d, id: d.id ?? `${d.kind}${n++}`, rot: d.rot ?? 0, size: d.size ?? SIZE[d.kind] ?? 80, dur: d.dur ?? 0 };
  if (d.kind === 'tag') {
    // слово за словом: шаг 70 мс (docs/ANIMATION.md: лесенка 50–80 мс)
    const step = d.step ?? 0.07;
    o.words = String(d.text).split(/\s+/).filter(Boolean).map((s, i) => ({ s, at: d.at + (d.lead ?? 0.08) + i * step }));
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
  ...(Z ? { zone: Z } : {}),
};

// ---------- проверки сборки: безопасный кадр TikTok и метод сюжета (zone.mjs) ----------
// Ошибка = сборки нет (кроме --still: кадр с рамкой зоны нужен, чтобы увидеть, что не так).
if (Z || S.story) {
  const gate = [...(Z ? checkZone(props, Z) : []), ...(S.story ? checkStory(S.story, dur) : [])];
  if (gate.length) console.log('ОШИБКА СБОРКИ (кадр и сюжет):\n- ' + gate.join('\n- '));
  else log(`кадр и сюжет: зелёная${Z ? ` · зона ${typeof S.zone === 'string' ? S.zone : 'своя'}` : ''}${S.story ? ` · шагов ${STEPS.length}, слов в голосе ${STEPS.reduce((a, s) => a + storyWords(s.vo).length, 0)}` : ''}`);
  if (gate.length && !flag('--still')) process.exit(1);
}
if (CHECK) process.exit(0);

// ---------- события звука: каждое появление и уход ----------
const G = { whoosh: -19, pop: -17, click: -23, stamp: -11, out: -21, key: -21, tick: -22, scroll: -22 };
const MICRO = { pop: -24, click: -27, tick: -25 };   // мелочи цепочек и линеек — тише главных событий
const ev = [];
// type — тип звука (pop, out, whoosh, click, key, scroll, tick, stamp) или начало имени файла (key_enter)
// len — сколько секунд звучит (по умолчанию 1,2), fade — затухание в конце, offset — с какой секунды файла (после тишины)
let CUR = null;
const add = (t, type, what, gain = G[type] ?? G[String(type).split('_')[0]] ?? -20, ext = {}) => {
  if (CUR) gain = /исчезновение|уход/.test(what) ? (CUR.gain_out ?? gain) : (CUR.gain ?? gain);
  if (type && type !== 'none' && t >= 0 && t < dur) ev.push({ t: +t.toFixed(3), type, what, gain_db: gain, ...ext }); };
const DROP_OUT = 0.18;   // уход «капли» (ease.ts) — звук исчезновения в начале ухода
for (const c of cards) {
  add(c.at, c.sfx_in, `карточка ${c.id}: вход`);
  if (c.exit !== 'none') add(c.at + c.dur - c.exitDur, c.sfx_out, `карточка ${c.id}: уход`, G.whoosh - 3);
}
for (const i of items) {
  CUR = null;
  if (i.kind === 'sfx') { add(i.at, i.type, i.what ?? `звук ${i.type}`, i.gain ?? undefined, Object.fromEntries(['len', 'fade', 'offset'].filter((k) => i[k] !== undefined).map((k) => [k, i[k]]))); continue; }   // звук без картинки (прокрутка, листание в записи)
  if (i.sfx === 'none') continue;           // элемент без звука (когда рядом уже звучит другое)
  const out = i.at + i.dur - DROP_OUT;
  const outOk = i.sfx_out !== 'none';      // sfx_out: "none" — уход без звука; строка — свой тип звука ухода
  const outT = typeof i.sfx_out === 'string' && i.sfx_out !== 'none' ? i.sfx_out : 'out';
  const inT = (d) => (typeof i.sfx === 'string' ? i.sfx : d);   // sfx: "key" — свой тип звука входа
  CUR = i;   // gain у элемента — громкость его звука входа (dB), gain_out — ухода
  if (i.kind === 'tag') {
    add(i.at, inT('pop'), `бирка «${i.text}»: появление`);
    i.words.forEach((w, k) => k > 0 && add(w.at, 'click', `слово «${w.s}»`, G.click - 2));
    if (i.dur && outOk) add(out, outT, `бирка «${i.text}»: исчезновение`);
  } else if (i.kind === 'loupe') {
    add(i.at, inT('pop'), 'лупа: появление');
    if (i.dur && outOk) add(out, outT, 'лупа: исчезновение');
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
CUR = null;
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
// Ролик без музыки (tour-02): допустимая тишина — tempo.max_gap (по умолчанию 0,5 с); длинный звук (len) закрывает тишину,
// пока звучит (до начала затухания). moments — главные моменты: пауза (с) и сколько событий в ней (в паузе реже: 1 на 0,7–1 с).
const TEMPO = typeof S.tempo === 'object' ? S.tempo : {};
const GAP = TEMPO.max_gap ?? 0.5;
const density = (() => {
  const E = ev.filter((e) => e.file || !files.length).sort((a, b) => a.t - b.t);
  const ts = E.map((e) => e.t);
  let maxGap = ts.length ? ts[0] : dur, gapAt = 0, maxSim = 0, simAt = 0, cover = 0;
  const gaps = [];
  for (let k = 0; k < E.length; k++) {
    const g = k ? E[k].t - Math.max(cover, E[k - 1].t) : E[0].t;
    if (k && g > maxGap) { maxGap = g; gapAt = Math.max(cover, E[k - 1].t); }
    if (k && g > GAP) gaps.push(`${Math.max(cover, E[k - 1].t).toFixed(2)}–${E[k].t.toFixed(2)}`);
    cover = Math.max(cover, E[k].t + (E[k].len ? E[k].len - (E[k].fade ?? 0.3) : 0));
  }
  if (ts.length && dur - Math.max(cover, ts[ts.length - 1]) > maxGap) { maxGap = dur - Math.max(cover, ts[ts.length - 1]); gapAt = ts[ts.length - 1]; }
  for (let k = 0; k < ts.length; k++) { const n = ts.filter((x) => x >= ts[k] && x < ts[k] + 0.04).length; if (n > maxSim) { maxSim = n; simAt = ts[k]; } }
  return { per_sec: +(ts.length / dur).toFixed(2), max_gap: +maxGap.toFixed(2), max_gap_at: gapAt, max_together: maxSim, together_at: simAt, allowed_gap: GAP, [`gaps_over_${GAP}`]: gaps, gaps };
})();
const moments = (S.moments ?? []).map((m) => {
  const n = ev.filter((e) => e.t >= m.from && e.t < m.to).length;
  const len = m.to - m.from;
  return { name: m.name, from: m.from, to: m.to, pause_s: +len.toFixed(2), sounds: n, sec_per_sound: n ? +(len / n).toFixed(2) : null };
});
if (S.tempo !== false) {
  if (density.gaps.length) warn(`звук: тишина дольше ${GAP} с — ${density.gaps.join(', ')}`);
  if (density.max_together > 2) warn(`звук: ${density.max_together} звука разом на ${density.together_at} с (не больше двух)`);
  for (const m of moments) {
    if (m.pause_s < (TEMPO.min_pause ?? 0)) warn(`пауза «${m.name}» ${m.pause_s} с — короче ${TEMPO.min_pause} с`);
    if (m.sec_per_sound !== null && m.sec_per_sound < 0.6) warn(`пауза «${m.name}»: звук каждые ${m.sec_per_sound} с — в паузе реже (1 на 0,7–1 с)`);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(HERE, '.props'), { recursive: true });
const name = S.name;
const propsFile = path.join(HERE, '.props', `${name}.json`);
if (!flag('--audio-only')) fs.writeFileSync(propsFile, JSON.stringify(props));
const evFile = path.join(OUT, `${name}-events.json`);
fs.writeFileSync(evFile, JSON.stringify({ name, dur, fps, sfx_dir: 'content/sfx', density, moments, counts: Object.fromEntries(Object.keys(G).map((k) => [k, ev.filter((e) => String(e.type).startsWith(k)).length])), events: ev }, null, 1));
// сюжет → таблица шагов для отчёта и текст закадрового голоса (один источник — сценарий)
const VO_LEAD = S.vo?.lead ?? 0.25;
if (S.story) {
  const f2 = (x) => String(+(+x).toFixed(2)).replace('.', ',');
  const md = [`# ${name} — сюжет`, '', `Посыл: ${S.story.message}`, '',
    '| Шаг | Секунды | Мысль | Подпись (hy) | Перевод | Голос (hy) | Перевод |', '|---|---|---|---|---|---|---|',
    ...STEPS.map((s, i) => `| ${i + 1} | ${f2(s.at)}–${f2(s.at + s.dur)} | ${s.thought} | ${String(s.caption).replace(/\*/g, '')} | ${s.caption_ru ?? ''} | ${s.vo} | ${s.vo_ru ?? ''} |`),
    '', 'Что понял незнакомец:', ...['1', '3', '10'].map((k) => `- ${k}-я с: ${S.story.stranger?.[k] ?? ''}`), ''].join('\n');
  fs.writeFileSync(path.join(OUT, `${name}-story.md`), md);
  const SAY = STEPS.map((s) => String(s.vo_say ?? s.vo).trim()).map((v) => (/[։.!?…]$/.test(v) ? v : `${v}։`));
  const txt = [`# ${name} — текст закадрового голоса (восточноармянский, разговорно). Файл пишет сборщик из сценария:`,
    `# править content/scenes/${name}.json (story.steps[].vo), не здесь.`,
    `# Запись: одна фраза на шаг, между фразами пауза ≥ 0,5 с — тогда один файл content/vo/${name}.mp3 сборщик сам разрежет по шагам.`,
    `# Надёжнее — по файлу на шаг: content/vo/${name}/01.mp3, 02.mp3 … Потом: node content/remotion/build.mjs content/scenes/${name}.json --audio-only`,
    '# В скобках: когда фраза звучит в ролике и сколько секунд на неё есть.', '',
    ...STEPS.map((s, i) => `${i + 1}. [${f2(s.at + VO_LEAD)}–${f2(s.at + s.dur)} с · не длиннее ${f2(s.dur - VO_LEAD - 0.1)} с] ${s.vo}`), '',
    '# Чистый текст для генератора голоса (строка = фраза). Где фраза для генератора пишется иначе, чем в подписи',
    '# (адрес chka.am — «չկա ամ», как «լիստ ամ»), она берётся из vo_say шага.',
    ...SAY, '', '# То же одним куском для ElevenLabs v3 / v4: тег [pause] даёт паузу между фразами, по ней сборщик режет файл на шаги:', SAY.join(' [pause] '), ''].join('\n');
  const tf = path.join(REPO, 'content/vo', `${name}.txt`);
  fs.mkdirSync(path.dirname(tf), { recursive: true });
  if (!fs.existsSync(tf) || fs.readFileSync(tf, 'utf8') !== txt) fs.writeFileSync(tf, txt);
}
if (flag('--dry')) process.exit(0);
log(`сценарий: ${cards.length} карточек, ${items.length} элементов, ${ev.length} звуковых событий, ${dur} с · звук: ${density.per_sec}/с, самая длинная тишина ${density.max_gap} с, разом до ${density.max_together}`);

// ---------- Remotion ----------
const remotion = path.join(HERE, 'node_modules/.bin/remotion');
if (!fs.existsSync(remotion) && !flag('--audio-only')) { console.error('нет Remotion: cd content/remotion && npm install'); process.exit(1); }
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
// --audio-only на машине, где ролик не рендерили (Мак): картинка берётся из готового content/out/<имя>.mp4
if (flag('--audio-only') && !fs.existsSync(silent) && fs.existsSync(mp4)) fs.copyFileSync(mp4, silent);
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
    const L = e.len ?? 1.2, F = Math.min(e.fade ?? 0.3, L), O = e.offset ?? 0;
    // мягкий звук («как у iPhone»): "soft": {"lowpass": 4200} срезает резкий верх у всех звуков событий
    const LP = S.soft?.lowpass ? `lowpass=f=${S.soft.lowpass},` : '';
    fl.push(`[${k + 1}:a]aresample=48000,${pt}aformat=channel_layouts=stereo,silenceremove=start_periods=1:start_threshold=-45dB,atrim=${O}:${O + L},asetpts=PTS-STARTPTS,afade=t=out:st=${(L - F).toFixed(3)}:d=${F.toFixed(3)},${LP}volume=${e.gain_db}dB,adelay=${ms}|${ms}[a${k}]`);
  });
  // фон «комната» (ролик без музыки): тёмный шум, срезаны верх и низ, очень тихо; появляется и уходит плавно
  let mixIn = withFile.map((_, k) => `[a${k}]`).join('');
  if (S.room) {
    const R = typeof S.room === 'object' ? S.room : { db: S.room };
    fl.push(`anoisesrc=r=48000:c=brown:a=0.5:d=${dur}:seed=11,highpass=f=70,lowpass=f=${R.lowpass ?? 420},volume=${R.db ?? -30}dB,aformat=channel_layouts=stereo,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, dur - 1.2)}:d=1.2[room]`);
    mixIn += '[room]';
  }
  fl.push(`[0:a]${mixIn}amix=inputs=${withFile.length + 1 + (S.room ? 1 : 0)}:normalize=0:duration=first,alimiter=limit=0.7[out]`);
  run('ffmpeg', [...args, '-filter_complex', fl.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', wav]);
  log(`звуки: ${withFile.length} из ${ev.length} событий → ${path.relative(REPO, wav)}`);
} else {
  log(`звуков нет (content/sfx/ пуст) — ролик без звука, разметка в ${path.relative(REPO, evFile)}`);
}
// ---------- закадровый голос: content/vo/<имя>.mp3 (wav, m4a) или content/vo/<имя>/01.mp3, 02.mp3 … ----------
// Фраза k звучит с начала шага k (+ vo.lead, по умолчанию 0,25 с) — там же, где стоит подпись шага.
// Один файл сборщик режет сам: n − 1 самых длинных пауз = границы фраз (или vo.cuts: [[с, по], …] в секундах файла).
// Фраза длиннее шага — ускоряется до ×1,12 (vo.max_tempo) с предупреждением. Под голосом звуки событий тише.
// Нет файла — ролик собирается с подписями, без ошибки.
// Теги в квадратных скобках ([pause]) в тексте для генератора — паузы между фразами; в подписях их нет.
let mixWav = null;
if (STEPS.length) {
  const cfg = S.vo ?? {};
  const VOD = path.join(REPO, 'content/vo');
  const slots = STEPS.map((s, i) => ({ step: i + 1, at: +(s.at + VO_LEAD).toFixed(3), room: +(s.dur - VO_LEAD - 0.1).toFixed(3), text: s.vo }));
  const dirV = path.join(VOD, name);
  const inDir = fs.existsSync(dirV) ? fs.readdirSync(dirV).filter((f) => /\.(mp3|wav|m4a)$/i.test(f)).sort().map((f) => path.join(dirV, f)) : [];
  const many = inDir.filter((f) => /^\d/.test(path.basename(f)));
  // один файл: content/vo/<имя>.mp3 — или единственный файл с любым именем в папке content/vo/<имя>/ (скачали из ElevenLabs и перетащили, не переименовывая)
  const one = ['mp3', 'wav', 'm4a'].map((e) => path.join(VOD, `${name}.${e}`)).find((f) => fs.existsSync(f)) ?? (!many.length && inDir.length === 1 ? inDir[0] : undefined);
  const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args, '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? '';
  const adur = (f) => parseFloat(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { quiet: true }));
  let phrases = null;   // [{file, from, to}] — секунды файла
  if (many.length) {
    if (many.length !== slots.length) warn(`голос: в content/vo/${name}/ файлов ${many.length}, шагов ${slots.length} — лишние не взяты, недостающие шаги без голоса`);
    phrases = many.slice(0, slots.length).map((f) => ({ file: f, from: 0, to: adur(f) }));
  } else if (one && cfg.cuts) {
    phrases = cfg.cuts.slice(0, slots.length).map(([from, to]) => ({ file: one, from, to }));
  } else if (one) {
    const D = adur(one), err = ff(['-i', one, '-af', `silencedetect=noise=${cfg.noise ?? -35}dB:d=0.18`]);
    const st = [...err.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, +m[1]));
    const en = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
    const sil = st.map((a, k) => ({ a, b: en[k] ?? D }));
    const head = sil.find((q) => q.a < 0.05)?.b ?? 0, tail = sil.find((q) => q.b > D - 0.05)?.a ?? D;
    const inner = sil.filter((q) => q.a >= 0.05 && q.b <= D - 0.05).sort((p, q) => (q.b - q.a) - (p.b - p.a));
    if (inner.length < slots.length - 1) {
      warn(`голос: в файле пауз ${inner.length}, для ${slots.length} фраз нужно ${slots.length - 1} — голос поставлен одним куском с шага 1; записать с паузой ≥ 0,5 с между фразами, дать vo.cuts или файлы по шагам`);
      phrases = [{ file: one, from: head, to: tail }];
    } else {
      const cut = inner.slice(0, slots.length - 1).sort((p, q) => p.a - q.a);
      phrases = slots.map((_, k) => ({ file: one, from: k ? cut[k - 1].b : head, to: k < cut.length ? cut[k].a : tail }));
    }
  }
  const voFile = path.join(OUT, `${name}-vo.json`);
  if (!phrases) {
    log(`голоса нет (content/vo/${name}.mp3) — ролик с подписями; текст для озвучки — content/vo/${name}.txt`);
    fs.writeFileSync(voFile, JSON.stringify({ name, voice: null, slots }, null, 1));
  } else {
    const src = [...new Set(phrases.map((p) => p.file))];
    // громкость: пик каждого файла голоса → −3 dB (+ vo.db)
    const peak = Object.fromEntries(src.map((f) => [f, parseFloat(/max_volume: (-?[\d.]+) dB/.exec(ff(['-i', f, '-af', 'volumedetect']))?.[1] ?? '-3')]));
    const a = ['-y', '-v', 'error'];
    if (withFile.length) a.push('-i', wav); else a.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=48000:cl=stereo');
    const fl = [], rep = [];
    phrases.forEach((p, k) => {
      const sl = slots[k], len = p.to - p.from;
      let tempo = 1;
      if (phrases.length > 1 && len > sl.room) {
        tempo = Math.min(cfg.max_tempo ?? 1.12, len / sl.room);
        if (len / tempo > sl.room + 0.03) warn(`голос: фраза ${sl.step} длится ${len.toFixed(2)} с, в шаге места ${sl.room} с — не помещается даже с ускорением ×${tempo.toFixed(2)}: удлинить шаг или сократить фразу`);
        else warn(`голос: фраза ${sl.step} (${len.toFixed(2)} с) ускорена ×${tempo.toFixed(2)}, чтобы поместиться в шаг (${sl.room} с)`);
      }
      a.push('-i', p.file);
      const ms = Math.round(sl.at * 1000), g = (cfg.db ?? 0) - 3 - peak[p.file];
      fl.push(`[${k + 1}:a]atrim=${p.from.toFixed(3)}:${p.to.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,${tempo > 1 ? `atempo=${tempo.toFixed(4)},` : ''}afade=t=in:st=0:d=0.02,volume=${g.toFixed(2)}dB,adelay=${ms}|${ms}[v${k}]`);
      rep.push({ step: sl.step, at: sl.at, file_from: +p.from.toFixed(3), file_to: +p.to.toFixed(3), len: +len.toFixed(3), room: sl.room, tempo: +tempo.toFixed(3), text: sl.text });
    });
    fl.push(`${phrases.map((_, k) => `[v${k}]`).join('')}${phrases.length > 1 ? `amix=inputs=${phrases.length}:normalize=0:duration=longest,` : ''}apad=whole_dur=${dur},atrim=0:${dur},asplit=2[vo][key]`);
    // звуки событий под голосом тише: сжатие по голосу (замер: −6…−7 dB при голосе с пиком −3 dB), отпускает за 0,35 с
    fl.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo[bed];[bed][key]sidechaincompress=threshold=${cfg.duck_threshold ?? 0.1}:ratio=${cfg.duck_ratio ?? 3}:attack=25:release=350[duck]`);
    fl.push('[duck][vo]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.9[out]');
    mixWav = path.join(HERE, '.props', `${name}-mix.wav`);
    run('ffmpeg', [...a, '-filter_complex', fl.join(';'), '-map', '[out]', '-t', String(dur), '-c:a', 'pcm_s16le', mixWav]);
    const rel = src.map((f) => path.relative(REPO, f));
    fs.writeFileSync(voFile, JSON.stringify({ name, voice: rel, split: many.length ? 'files' : cfg.cuts ? 'cuts' : 'auto', phrases: rep }, null, 1));
    log(`голос: ${phrases.length} фраз (${rel.join(', ')}) → в звук ролика, события под голосом тише; тайминги — ${path.relative(REPO, voFile)}`);
  }
}
const mux = ['-y', '-v', 'error', '-i', silent];
if (mixWav || withFile.length) mux.push('-i', mixWav ?? wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k');
else mux.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '64k');
// пометка цвета bt709 (iPhone иначе показывает мутно — lessons.md §7)
run('ffmpeg', [...mux, '-c:v', 'copy', '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-shortest', '-movflags', '+faststart', mp4]);

// ---------- лист: кадр на каждую секунду ----------
const sheet = path.join(OUT, `${name}-sheet.jpg`);
const cols = 7, rows = Math.ceil(dur / cols);
run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-vf', `fps=1,scale=216:384,tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', '-q:v', '3', sheet]);
log(`готово: ${path.relative(REPO, mp4)} · ${path.relative(REPO, sheet)} · ${path.relative(REPO, evFile)}`);

// ---------- лист «как в TikTok»: кадр каждого шага ----------
// Верхний ряд — кадр, обрезанный как на высоком экране (видно crop), под макетом интерфейса TikTok (assets/tiktok-ui.png).
// Нижний ряд — тот же кадр целиком с рамкой зоны: красное срежет экран или закроет интерфейс.
if (Z) {
  const times = STEPS.length ? STEPS.map((s) => s.at + s.dur * 0.6) : Array.from({ length: 6 }, (_, k) => (dur * (k + 0.5)) / 6);
  const n = times.length, cw = Z.crop[1] - Z.crop[0], tw = 2 * Math.round((cw * 640) / H / 2);
  const a = ['-y', '-v', 'error'];
  times.forEach((t) => a.push('-ss', t.toFixed(3), '-i', mp4));
  a.push('-loop', '1', '-i', path.join(HERE, 'assets/tiktok-ui.png'));
  const L = (c) => times.map((_, k) => `[${c}${k}]`).join('');
  const fl = [`[${n}:v]scale=${cw}:${H},split=${n}${L('u')}`];
  times.forEach((_, k) => {
    fl.push(`[${k}:v]split=2[p${k}][q${k}]`);
    fl.push(`[p${k}]crop=${cw}:${H}:${Z.crop[0]}:0[c${k}];[c${k}][u${k}]overlay=0:0,scale=${tw}:640,pad=${tw + 8}:648:4:4:white[a${k}]`);
    fl.push(`[q${k}]drawbox=0:0:${Z.crop[0]}:${H}:red@0.45:fill,drawbox=${Z.crop[1]}:0:${W - Z.crop[1]}:${H}:red@0.45:fill,drawbox=${Z.crop[0]}:0:${cw}:${Z.top}:red@0.25:fill,drawbox=${Z.crop[0]}:${Z.bottom}:${cw}:${H - Z.bottom}:red@0.25:fill,drawbox=${Z.rail.x}:${Z.rail.y0}:${Z.crop[1] - Z.rail.x}:${Z.rail.y1 - Z.rail.y0}:red@0.25:fill,scale=-2:524,pad=${tw + 8}:648:(ow-iw)/2:62:white[b${k}]`);
  });
  fl.push(`${L('a')}hstack=inputs=${n}[r1];${L('b')}hstack=inputs=${n}[r2];[r1][r2]vstack=inputs=2[out]`);
  const tk = path.join(OUT, `${name}-tiktok.jpg`);
  run('ffmpeg', [...a, '-filter_complex', fl.join(';'), '-map', '[out]', '-frames:v', '1', '-q:v', '3', tk]);
  log(`лист «как в TikTok»: ${path.relative(REPO, tk)} (сверху — обрезка высокого экрана под интерфейсом, снизу — кадр с рамкой зоны)`);
}

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
    // ролик «на двойках» (src.interp: false): каждый кадр источника стоит два кадра — это задумано, в повторы не идёт
    const twos = (S.cards ?? []).find((q) => q.id === c.id)?.src?.interp === false;
    rows.push({ card: c.id, frames: seg2.length, median_diff: +med.toFixed(2), repeats: twos ? 0 : rep, ...(twos ? { on_twos: true } : {}) });
    const zch = Math.abs(c.cam.to[2] - c.cam.from[2]);
    if (!worst || zch > worst.z) worst = { z: zch, c };
  }
  const zt = S.check_zoom ?? (worst ? worst.c.at + worst.c.dur / 2 : dur / 2);
  const strip = path.join(OUT, `${name}-zoom10.jpg`);
  run('ffmpeg', ['-y', '-v', 'error', '-ss', String(zt), '-i', mp4, '-vf', `crop=640:640:220:560,tile=5x2:padding=4:color=white`, '-frames:v', '1', '-q:v', '2', strip]);
  const rep = rows.reduce((a, r) => a + r.repeats, 0);
  fs.writeFileSync(path.join(OUT, `${name}-smooth.json`), JSON.stringify({ zoom10_at: zt, repeats_total: rep, cards: rows, sound: density, moments, warnings: warns }, null, 1));
  console.table(rows);
  log(`плавность: повторов кадров ${rep} · 10 кадров подряд с ${zt.toFixed(2)} с → ${path.relative(REPO, strip)}`);
  if (warns.length) console.log('ВНИМАНИЕ:\n- ' + warns.join('\n- '));
}
