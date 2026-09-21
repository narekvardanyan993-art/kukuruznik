import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
    });
    
    // Create folders
    const modes = ['day', 'sunset', 'night'];
    for (const m of modes) {
        fs.mkdirSync(`kukuruznik/turntable/1x/${m}`, { recursive: true });
        fs.mkdirSync(`kukuruznik/turntable/2x/${m}`, { recursive: true });
    }

    const sets = [
        { name: 'day', tod: 0.35 },
        { name: 'sunset', tod: 0.65 },
        { name: 'night', tod: 0.95 }
    ];

    for (const res of [1, 2]) {
        const page = await browser.newPage();
        const w = 1600 * res;
        const h = 1000 * res;
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await page.goto('http://localhost:8080/kukuruznik/turntable_render.html', { waitUntil: 'load', timeout: 60000 });

        // Hide UI
        await page.evaluate(() => {
            document.body.classList.add('ui-off');
            const bv = document.getElementById('build-version');
            if (bv) bv.style.display = 'none';
            const loader = document.getElementById('loader');
            if (loader) loader.style.display = 'none';
        });
        
        await new Promise(r => setTimeout(r, 6000));

        for (const s of sets) {
            await page.evaluate((tod) => {
                if (window.engine) {
                    window.engine.applyTOD(tod);
                }
            }, s.tod);
            
            await new Promise(r => setTimeout(r, 3000)); // wait for transition

            for (let i = 0; i < 36; i++) {
                const angle = i * 10 * (Math.PI / 180);
                
                await page.evaluate((angle) => {
                    const cam = window.engine.camera;
                    const target = window.engine.controls.target;
                    
                    const dx = -9 - target.x;
                    const dz = -13 - target.z;
                    const origR = Math.sqrt(dx*dx + dz*dz);
                    const r = origR * 2.0; 
                    
                    const startAngle = Math.atan2(dz, dx);
                    const newAngle = startAngle + angle;
                    
                    cam.position.x = target.x + r * Math.cos(newAngle);
                    cam.position.z = target.z + r * Math.sin(newAngle);
                    cam.position.y = 8.5; 
                    
                    window.engine.controls.update();
                }, angle);

                await new Promise(r => setTimeout(r, 100)); // allow render frame
                
                const num = i.toString().padStart(2, '0');
                const outPath = `kukuruznik/turntable/${res}x/${s.name}/${num}.webp`;
                await page.screenshot({ path: outPath, type: 'webp', quality: 85 });
                console.log(`Rendered ${res}x ${s.name} frame ${num}`);
            }
        }
        await page.close();
    }

    await browser.close();
})();
