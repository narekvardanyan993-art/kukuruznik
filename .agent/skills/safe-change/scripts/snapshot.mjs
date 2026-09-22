import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const stage = process.argv[2] || 'before'; // 'before' or 'after'
const outDir = path.join(process.cwd(), `docs/snapshots/${stage}`);

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // 1. Снимаем 6 ракурсов вокруг здания
    await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 1 });
    await page.goto('http://localhost:8080/kukuruznik/scene3d.html', { waitUntil: 'load', timeout: 60000 });
    
    await page.evaluate(() => {
        document.body.classList.add('ui-off');
        const bv = document.getElementById('build-version');
        if (bv) bv.style.display = 'none';
        const loader = document.getElementById('loader');
        if (loader) loader.style.display = 'none';
    });
    
    await new Promise(r => setTimeout(r, 4000)); // wait for scene to load fully
    
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        await page.evaluate((a) => {
            if (window.engine && window.engine.camera) {
                const cam = window.engine.camera;
                const radius = window.radius || 45;
                cam.position.x = Math.sin(a) * radius;
                cam.position.z = Math.cos(a) * radius;
                cam.lookAt(0, 0, 0);
                cam.position.y = 8.5;
                if (window.engine.controls) window.engine.controls.update();
            }
        }, angle);
        
        await new Promise(r => setTimeout(r, 500));
        await page.screenshot({ path: path.join(outDir, `angle_${i}.webp`), type: 'webp', quality: 90 });
        console.log(`Captured angle ${i}`);
    }

    // 2. Снимаем вид страницы на ширине iPhone 390px
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
    // Let's capture the main turntable page which is what users see on mobile
    await page.goto('http://localhost:8080/kukuruznik/turntable.html', { waitUntil: 'load', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000)); // wait for turntable to init
    
    await page.screenshot({ path: path.join(outDir, 'iphone_view.webp'), type: 'webp', quality: 90 });
    console.log(`Captured iPhone view`);

    await browser.close();
})();
