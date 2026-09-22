import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const buildNumberFile = '.build_number';
let buildNumber = 77;
if (fs.existsSync(buildNumberFile)) {
    buildNumber = parseInt(fs.readFileSync(buildNumberFile, 'utf8'), 10) + 1;
} else {
    buildNumber = 78;
}
fs.writeFileSync(buildNumberFile, buildNumber.toString());

const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
const now = new Date();
const pad = (n) => n.toString().padStart(2, '0');
const timeStr = `${pad(now.getDate())}.${pad(now.getMonth()+1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const versionString = `${branch} · сборка ${buildNumber} · ${timeStr}`;
const versionHTML = `<div id="build-version" style="position:fixed; bottom: 8px; left: 8px; font-size: 10px; color: rgba(186,194,214,0.5); z-index: 100; pointer-events: none; font-family: monospace; white-space: nowrap;">${versionString}</div>`;

const files = ['kukuruznik/index.html', 'kukuruznik/history.html', 'kukuruznik/scene3d.html', 'kukuruznik/turntable.html'];

for (const file of files) {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        
        // Remove old build-version div if it exists
        content = content.replace(/<div id="build-version".*?<\/div>/g, '');
        
        // Insert new build-version div right before </body>
        content = content.replace('</body>', versionHTML + '\n</body>');
        
        fs.writeFileSync(file, content);
        console.log(`Updated ${file} with: ${versionString}`);
    }
}
