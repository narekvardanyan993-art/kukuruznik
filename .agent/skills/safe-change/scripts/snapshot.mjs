import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const stage = process.argv[2] || 'before'; // 'before' or 'after'
const outDir = path.join(process.cwd(), `docs/snapshots/${stage}`);

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

async function capture() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Заморозка времени
    await page.evaluateOnNewDocument(() => {
        const origPerfNow = performance.now.bind(performance);
        let frozenTime = 10000;
        performance.now = () => frozenTime;
        Date.now = () => 1700000000000;
        
        const origRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = function(cb) {
            return origRaf(function(t) {
                cb(frozenTime);
            });
        };
    });
    
    // 1. 3D сцена (6 ракурсов)
    await page.setViewport({ width: 1000, height: 1000, deviceScaleFactor: 1 });
    await page.goto('http://localhost:8080/kukuruznik/scene3d.html', { waitUntil: 'load', timeout: 60000 });
    
    await page.waitForFunction(() => {
        const loader = document.getElementById('loader');
        if (!loader) return true;
        return loader.style.display === 'none' || window.getComputedStyle(loader).opacity === '0';
    }, { timeout: 60000 });
    
    await page.evaluate(() => {
        document.body.classList.add('ui-off');
        const bv = document.getElementById('build-version');
        if (bv) bv.style.display = 'none';
    });
    
    await new Promise(r => setTimeout(r, 2000));
    
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
        
        await new Promise(r => setTimeout(r, 200));
        await page.screenshot({ path: path.join(outDir, `angle_${i}.png`) });
        console.log(`Captured angle ${i}`);
    }

    // 2. Мобильный вид (turntable)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto('http://localhost:8080/kukuruznik/turntable.html', { waitUntil: 'load', timeout: 60000 });
    
    await page.waitForFunction(() => {
        const loader = document.getElementById('loader');
        if (!loader) return true;
        return loader.style.display === 'none' || window.getComputedStyle(loader).opacity === '0';
    }, { timeout: 60000 });
    
    await new Promise(r => setTimeout(r, 2000)); // allow frames to render
    
    await page.screenshot({ path: path.join(outDir, 'iphone_view.png') });
    console.log(`Captured iPhone view`);

    await browser.close();
}

async function compare() {
    const beforeDir = path.join(process.cwd(), `docs/snapshots/before`);
    const afterDir = path.join(process.cwd(), `docs/snapshots/after`);
    const diffDir = path.join(process.cwd(), `docs/snapshots/diff`);
    if (!fs.existsSync(diffDir)) fs.mkdirSync(diffDir, { recursive: true });
    
    const files = fs.readdirSync(beforeDir).filter(f => f.endsWith('.png'));
    let ok = true;
    for (const f of files) {
        const beforeFile = path.join(beforeDir, f);
        const afterFile = path.join(afterDir, f);
        
        if (!fs.existsSync(afterFile)) {
            console.log(`[!] Missing after file for ${f}`);
            continue;
        }
        
        const img1 = PNG.sync.read(fs.readFileSync(beforeFile));
        const img2 = PNG.sync.read(fs.readFileSync(afterFile));
        const { width, height } = img1;
        
        const diff = new PNG({ width, height });
        const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
        
        const totalPixels = width * height;
        const diffPercent = (numDiffPixels / totalPixels) * 100;
        
        console.log(`${f}: ${diffPercent.toFixed(3)}% diff`);
        if (diffPercent > 0.5) {
            ok = false;
            fs.writeFileSync(path.join(diffDir, f), PNG.sync.write(diff));
            console.log(`    -> diff saved to docs/snapshots/diff/${f}`);
        }
    }
    
    if (!ok) {
        console.log(`\n[WARNING] Some snapshots exceeded the 0.5% difference threshold!`);
    } else {
        console.log(`\n[OK] All snapshots match within 0.5% threshold.`);
    }
}

if (stage === 'before') {
    capture().then(() => console.log('Before capture complete.'));
} else if (stage === 'after') {
    capture().then(() => {
        console.log('After capture complete. Comparing...');
        compare();
    });
} else if (stage === 'compare') {
    compare();
}
