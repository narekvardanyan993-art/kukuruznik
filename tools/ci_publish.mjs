#!/usr/bin/env node
// Публикация через GitHub Actions (.github/workflows/publish-check.yml).
// Запускается на сервере GitHub, когда tools/publish_*.py c CHKA_CI=1 пушит коммит-кандидат в ветку publish/<…>.
//   SITE — чекаут ветки test/depth-photo (здесь лежат проверка и node_modules), CAND — чекаут коммита-кандидата.
// Шаги: кандидат должен стоять ровно поверх текущего origin/main → tools/check_site.mjs с параметрами из строки
// «Check-Args:» сообщения коммита (только разрешённые ключи) + --renderer swiftshader --no-fps (на сервере нет GPU —
// fps проверяется только на Mac) → код выхода 0 = зелёная. Пуш в main делает workflow, а не этот скрипт.
// Режим --self: сайт против самого себя (origin/main ×2) — замер, сколько идёт проверка и не краснеет ли она зря.
import { spawnSync } from 'child_process';
import fs from 'fs';
const SITE = process.env.SITE, CAND = process.env.CAND;
const sh = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return r.stdout.trim(); };
const summary = (t) => { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, t + '\n'); console.log(t); };
const ALLOWED = new Set(['--allow-change', '--only', '--compare-as']);
const VALUE = /^[A-Za-z0-9_./=,-]+$/;

let args = [];
if (process.argv.includes('--self')) {
  summary('## Самопроверка: origin/main против самого себя');
} else {
  const main = sh(['rev-parse', 'origin/main'], SITE);
  const parent = sh(['rev-parse', 'HEAD^'], CAND);
  if (parent !== main) { summary(`### ❌ Кандидат собран не поверх текущего main (main ${main.slice(0, 7)}, родитель ${parent.slice(0, 7)}). Пересобрать публикацию.`); process.exit(1); }
  const msg = sh(['log', '-1', '--format=%B'], CAND);
  const m = msg.match(/^Check-Args: (.+)$/m);
  if (!m) { summary('### ❌ В сообщении коммита нет строки Check-Args'); process.exit(1); }
  const raw = JSON.parse(m[1]);
  for (let i = 0; i < raw.length; i++) {
    const k = raw[i];
    if (k === '--renderer') { i++; continue; }           // отрисовку выбирает сервер
    if (!ALLOWED.has(k)) { summary(`### ❌ Недопустимый параметр проверки: ${k}`); process.exit(1); }
    const v = raw[++i];
    if (typeof v !== 'string' || !VALUE.test(v)) { summary(`### ❌ Недопустимое значение для ${k}`); process.exit(1); }
    args.push(k, v);
  }
  args = ['--candidate', CAND, ...args];
  summary(`## Проверка кандидата ${sh(['rev-parse', '--short', 'HEAD'], CAND)}\n\`${msg.split('\n')[0]}\``);
}
const cmd = ['tools/check_site.mjs', ...args, '--renderer', 'swiftshader', '--no-fps'];
summary('`node ' + cmd.join(' ') + '`');
const t0 = Date.now();
const r = spawnSync('node', cmd, { cwd: SITE, stdio: 'inherit' });
summary(`### ${r.status === 0 ? '✅ зелёная' : r.status === 1 ? '❌ красная' : '⚠️ проверка не смогла отработать'} — ${Math.round((Date.now() - t0) / 60000)} мин`);
process.exit(r.status ?? 2);
