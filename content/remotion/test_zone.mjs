#!/usr/bin/env node
// Самопроверка проверок кадра и сюжета (zone.mjs): эталон зелёный, плохие случаи краснеют.
//   node content/remotion/test_zone.mjs
// Плохие сценарии делаются в памяти и уходят сборщику через stdin (--check --stdin): файлов не создаёт, ролики не режет.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '../..');
const load = (n) => JSON.parse(fs.readFileSync(path.join(REPO, 'content/scenes', `${n}.json`), 'utf8'));
const check = (S) => {
  const r = spawnSync('node', [path.join(HERE, 'build.mjs'), '--check', '--stdin'], { input: JSON.stringify(S), encoding: 'utf8', cwd: REPO });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const edit = (fn) => { const S = load('story-pogos-03'); fn(S); return S; };
const card = (S, id) => S.cards.find((c) => c.id === id);

// [что проверяем, сценарий, что должно быть в ошибке (null — ошибок быть не должно)]
const cases = [
  ['эталон story-pogos-03 как есть', load('story-pogos-03'), null],
  ['подпись вылезла вправо — срежет высокий экран', edit((S) => { S.story.caption.box = [120, 285, 1040, 545]; }), 'важное вне зоны'],
  ['подпись внизу — под подписью поста', edit((S) => { S.story.caption.box = [120, 1300, 960, 1560]; }), 'важное вне зоны'],
  ['бирка под колонкой кнопок', edit((S) => { S.items.push({ kind: 'tag', text: '1930', at: 10, dur: 2, x: 900, y: 1000, size: 88 }); }), 'важное вне зоны'],
  ['телефон шириной 868, как в story-pogos-02', edit((S) => { card(S, 'phone').w = 868; card(S, 'phone').h = 1740; }), 'фон виден у края'],
  ['карточка сдвинута к левому краю', edit((S) => { card(S, 'now').x = 420; }), 'фон виден у края'],
  ['в подписи 7 слов', edit((S) => { S.story.steps[1].caption = 'Այստեղ շատ դարեր առաջ եկեղեցի էր կանգնած'; }), 'в подписи 7 слов'],
  ['шаг длиной 5 с', edit((S) => { S.story.steps[6].dur = 5; S.dur = 26.6; }), 'шаг длится'],
  ['две фразы голоса в одном шаге', edit((S) => { S.story.steps[0].vo = 'Սա «Մոսկվա» կինոթատրոնն է։ Գիտե՞ս՝ ինչ կար այստեղ'; }), 'одна фраза на шаг'],
  ['голос длиннее 45 слов', edit((S) => { S.story.steps.forEach((s) => { s.vo += ' ու էլի մի երկու ավել բառ'; }); }), 'не больше 45'],
  ['не написано, что понял незнакомец на 3-й с', edit((S) => { delete S.story.stranger['3']; }), 'незнакомец на 3-й'],
  ['story-pogos-02 с включённой зоной — настоящий плохой случай', (() => { const S = load('story-pogos-02'); S.zone = 'tiktok-2026'; return S; })(), 'фон виден у края'],
  ['старый сценарий без зоны и сюжета — проверок нет, как раньше', load('story-pogos-02'), null],
];

let bad = 0;
for (const [what, S, want] of cases) {
  const r = check(S);
  const ok = want === null ? r.code === 0 && !r.out.includes('ОШИБКА СБОРКИ') : r.code === 1 && r.out.includes(want);
  if (!ok) bad++;
  const line = r.out.split('\n').find((l) => (want ? l.includes(want) : l.includes('зелёная'))) ?? '';
  console.log(`${ok ? 'да ' : 'НЕТ'} | ${want === null ? 'зелёная ' : 'краснеет'} | ${what}${line ? `\n      ${line.trim().slice(0, 230)}` : ''}`);
}
console.log(bad ? `\nПРОВАЛ: ${bad} из ${cases.length}` : `\nвсе ${cases.length} случаев как ожидалось`);
process.exit(bad ? 1 : 0);
