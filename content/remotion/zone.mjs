// Безопасный кадр TikTok / Reels (ноябрь 2026) и метод сюжета — проверки сборки.
// Включаются в сценарии полями "zone": "tiktok-2026" и "story": {…}; у старых сценариев этих полей нет — для них ничего не меняется.
//
// Откуда числа (кадр 1080×1920):
// - Экран 19,5:9 (iPhone 15 Pro, 393×852 pt): TikTok растягивает ролик 9:16 по высоте и срезает бока.
//   Во весь экран видно 1920 · 9 / 19,5 = 886 px ширины → по 97 px с каждого бока пропадает
//   (с нижней панелью вкладок — около 50 px). Берём худший случай: видно x 97…983.
// - Интерфейс поверх ролика: сверху вкладки и поиск (до ≈ 260 px), снизу имя, подпись, звук (≈ 420–480 px),
//   справа колонка кнопок (≈ 63 pt = 142–173 px от видимого края, примерно от середины кадра и ниже).
//   Источники чисел интерфейса — SKILL.md §9 (aicarousels 154 / 422 / 65 / 173, socialync 240 / 660 / 120 для рекламы).
export const ZONES = {
  'tiktok-2026': {
    crop: [97, 983],                       // видимая ширина на высоком экране
    top: 270, bottom: 1440,                // текст — только между ними
    rail: { x: 840, y0: 820, y1: 1440 },   // колонка кнопок: правее x на этих высотах текста нет
    pad: 13,                               // отступ текста от линии обрезки
    sliver: 48,                            // у карточки с каждого бока ≥ столько видимой бумаги — или карточка уходит за край кадра
  },
};

export const zoneOf = (S) => {
  if (!S.zone) return null;
  const Z = typeof S.zone === 'string' ? ZONES[S.zone] : { ...ZONES['tiktok-2026'], ...S.zone };
  if (!Z) throw new Error(`нет зоны «${S.zone}» (есть: ${Object.keys(ZONES).join(', ')})`);
  return Z;
};

/** Прямоугольник элемента в пикселях кадра [x0, y0, x1, y1] или null, если элемент — не «важное» (точка, тап, звук, приколотое к картинке). */
export const itemBox = (it, cards) => {
  if (it.kind === 'caption') return it.box;
  if (['sfx', 'tap', 'dot', 'ruler', 'loupe'].includes(it.kind) || it.pin) return null;
  let x = it.x, y = it.y;
  if (it.on) {
    const c = cards.find((q) => q.id === it.on);
    if (!c) return null;
    x = c.x - c.w / 2 + it.x * c.w; y = c.y - c.h / 2 + it.y * c.h;
  }
  const s = it.size ?? 80, n = String(it.text ?? '').length;
  let w = s, h = s;   // значок, штамп, счётчик — по размеру (оценка)
  if (it.kind === 'tag') { w = n * s * 0.6 + s * (it.variant === 'big' ? 0.7 : 1.5); h = s * (it.variant === 'big' ? 1.45 : 1.9); }
  else if (it.kind === 'chip') { w = Math.max(s * 1.5, n * s * 0.62 + s * 0.9); h = s * 1.7; }
  else if (it.kind === 'counter') { w = s * 4; h = s * 2; }
  else if (it.kind === 'stamp') { w = h = s * 3; }
  return [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
};

/** Проверка кадра. Возвращает список ошибок (пустой — зелёная). W — ширина кадра. */
export const checkZone = ({ cards, items, width: W = 1080 }, Z) => {
  const errors = [];
  const x0 = Z.crop[0] + Z.pad, x1 = Z.crop[1] - Z.pad;
  const r = (v) => Math.round(v);
  // 1. Важное (подписи, бирки, фишки, значки, счётчик, штамп) — целиком в зоне
  for (const it of items) {
    const b = itemBox(it, cards);
    if (!b) continue;
    const right = b[3] > Z.rail.y0 && b[1] < Z.rail.y1 ? Math.min(x1, Z.rail.x) : x1;
    const out = [];
    if (b[0] < x0) out.push(`слева x ${r(b[0])} < ${x0} — срежет высокий экран`);
    if (b[2] > right) out.push(right < x1 ? `справа x ${r(b[2])} > ${right} — под кнопками` : `справа x ${r(b[2])} > ${right} — срежет высокий экран`);
    if (b[1] < Z.top) out.push(`сверху y ${r(b[1])} < ${Z.top} — под вкладками`);
    if (b[3] > Z.bottom) out.push(`снизу y ${r(b[3])} > ${Z.bottom} — под подписью поста`);
    if (out.length) errors.push(`важное вне зоны: ${it.kind} «${String(it.text ?? it.name ?? it.id).replace(/\s+/g, ' ').slice(0, 28)}» на ${it.at} с — ${out.join('; ')}`);
  }
  // 2. Карточки: полоска фона у края. Бок карточки — либо за краем кадра, либо на ≥ sliver px внутри видимой ширины.
  //    Позы — исходная и все ключи (keys); запас на поворот, покачивание и парение.
  for (const c of cards) {
    const poses = [{ x: 0, y: 0, s: 1 }, ...(c.keys ?? []).map((k) => ({ x: k.x ?? 0, y: k.y ?? 0, s: k.s ?? 1 }))];
    const rot = (Math.abs(c.rot ?? 0) + 0.6) * Math.PI / 180;
    const fl = Math.abs(c.float?.[0] ?? 0);
    let bad = null, cx = 0, cy = 0;
    for (const p of poses) {
      const s = p.s * 1.035, hw = (c.w * s) / 2, d = ((c.h * s) / 2) * Math.sin(rot) + fl;
      const L = c.x + p.x - hw, R = c.x + p.x + hw;
      if (!(L + d <= 0 || L - d >= Z.crop[0] + Z.sliver)) bad = bad ?? `левый бок на x ${r(L - d)}…${r(L + d)} (нужно ≤ 0 или ≥ ${Z.crop[0] + Z.sliver})`;
      if (!(R - d >= W || R + d <= Z.crop[1] - Z.sliver)) bad = bad ?? `правый бок на x ${r(R - d)}…${r(R + d)} (нужно ≥ ${W} или ≤ ${Z.crop[1] - Z.sliver})`;
      cx = c.x + p.x; cy = c.y + p.y;
      if (cx < x0 || cx > x1 || cy < Z.top || cy > Z.bottom) bad = bad ?? `центр (${r(cx)}, ${r(cy)}) вне зоны`;
    }
    if (bad) errors.push(`фон виден у края: карточка ${c.id} — ${bad}: на высоком экране у края останется полоска фона или карточку срежет; уменьшить карточку либо вывести её за край кадра`);
  }
  return errors;
};

// ---------- метод сюжета ----------
// слова фразы: знаки по краям слова не считаются; «chka.am», «Պողոս-Պետրոս», «1930-ականներին» — по одному слову
export const words = (s) => String(s ?? '').split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
export const STORY = { steps: [5, 8], stepDur: [2, 4], captionWords: 6, voWords: 45 };

/** Проверка сюжета: посыл, 5–8 шагов по 2–4 с подряд без дыр, подпись ≤ 6 слов, голос ≤ 45 слов, «что понял незнакомец» на 1 / 3 / 10 с. */
export const checkStory = (st, dur) => {
  const e = [];
  if (!st.message || words(st.message).length < 3) e.push('сюжет: нет посыла одной фразой (story.message)');
  for (const k of ['1', '3', '10']) if (!st.stranger?.[k]) e.push(`сюжет: не написано, что понял незнакомец на ${k}-й с (story.stranger["${k}"])`);
  const steps = st.steps ?? [];
  if (steps.length < STORY.steps[0] || steps.length > STORY.steps[1]) e.push(`сюжет: шагов ${steps.length}, нужно ${STORY.steps[0]}–${STORY.steps[1]}`);
  let t = 0, vo = 0;
  steps.forEach((s, i) => {
    const n = i + 1;
    if (Math.abs(s.at - t) > 0.011) e.push(`шаг ${n}: начинается на ${s.at} с, прошлый кончился на ${+t.toFixed(2)} с — шаги идут подряд`);
    if (s.dur < STORY.stepDur[0] - 1e-6 || s.dur > STORY.stepDur[1] + 1e-6) e.push(`шаг ${n}: ${s.dur} с — шаг длится ${STORY.stepDur[0]}–${STORY.stepDur[1]} с`);
    if (!s.thought) e.push(`шаг ${n}: нет мысли шага (thought) — шаг = одна мысль`);
    const cw = words(s.caption).length;
    if (!cw) e.push(`шаг ${n}: нет подписи (caption)`);
    if (cw > STORY.captionWords) e.push(`шаг ${n}: в подписи ${cw} слов — не больше ${STORY.captionWords}`);
    if (!s.vo) e.push(`шаг ${n}: нет фразы голоса (vo)`);
    if (/[.!?։…]\s+\S/.test(String(s.vo ?? '').trim())) e.push(`шаг ${n}: в голосе больше одной фразы — одна фраза на шаг`);
    vo += words(s.vo).length;
    t = s.at + s.dur;
  });
  if (vo > STORY.voWords) e.push(`сюжет: в голосе ${vo} слов — не больше ${STORY.voWords}`);
  if (steps.length && Math.abs(t - dur) > 0.011) e.push(`сюжет: шаги кончаются на ${+t.toFixed(2)} с, ролик — ${dur} с`);
  return e;
};
