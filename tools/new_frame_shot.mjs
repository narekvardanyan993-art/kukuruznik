// Скриншот черновика кадра для станка (tools/new_frame.py): страница здания, где новый кадр — первый, телефон 390×844.
//   node tools/new_frame_shot.mjs <адрес страницы> <файл.png>
// Chrome: свой у puppeteer или PUPPETEER_EXECUTABLE_PATH. Видеокарта не нужна (swiftshader, как у check_site в облаке).
import puppeteer from 'puppeteer';

const [url, out] = process.argv.slice(2);
if (!url || !out) { console.error('нужно: node tools/new_frame_shot.mjs <адрес> <файл.png>'); process.exit(2); }
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
try {
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message || e)));
  p.on('requestfailed', (r) => errs.push('не загрузилось: ' + r.url()));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(url, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 9000));   // приветствие (≥3 с + уход) и загрузка первого кадра
  await p.screenshot({ path: out });
  if (errs.length) console.log('ошибки страницы: ' + errs.slice(0, 5).join(' | '));
  console.log('снято: ' + out);
} finally {
  await b.close();
}
