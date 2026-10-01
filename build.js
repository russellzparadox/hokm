// Assembles the game from src/ into:
//   dist/hokm-artifact.html  — page body for the claude.ai artifact (Google Fonts)
//   dist/hokm.html           — standalone page for any browser (Google Fonts)
//   android/app/src/main/assets/index.html + fonts/  — offline copy for the Android app
// Run: node build.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };

const core = read('src/hokm-core.js');
const ui = read('src/ui.html');
if (!ui.includes('/*CORE*/') || !ui.includes('<!--FONTS-->')) throw new Error('template markers missing');

const google = '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lalezar&family=Vazirmatn:wght@400;500;700;800&display=swap">';

const ranges = { arabic: read('vendor/fonts/range-arabic.txt').trim(), latin: read('vendor/fonts/range-latin.txt').trim() };
const faces = [];
for (const w of [400, 500, 700, 800]) for (const sub of ['arabic', 'latin']) faces.push(['Vazirmatn', `vazirmatn-${sub}-${w}-normal.woff2`, w, ranges[sub]]);
for (const sub of ['arabic', 'latin']) faces.push(['Lalezar', `lalezar-${sub}-400-normal.woff2`, 400, ranges[sub]]);
const local = '<style>\n' + faces.map(([fam, file, w, r]) =>
  `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format("woff2");unicode-range:${r};}`).join('\n') + '\n</style>';

function assemble(fonts) {
  return ui.replace('<!--FONTS-->', fonts).replace('/*CORE*/', () => '\n' + core + '\n');
}
function fullDoc(body) {
  const cut = body.indexOf('<div class="app"');
  return '<!doctype html>\n<html lang="fa" dir="rtl">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n' +
    '<meta name="theme-color" content="#0E1A33">\n' +
    body.slice(0, cut) + '</head>\n<body>\n' + body.slice(cut) + '\n</body>\n</html>\n';
}

const artifact = assemble(google);
write('dist/hokm-artifact.html', artifact);
write('dist/hokm.html', fullDoc(artifact));
write('android/app/src/main/assets/index.html', fullDoc(assemble(local)));
for (const [, file] of faces) {
  fs.mkdirSync(path.join(root, 'android/app/src/main/assets/fonts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'vendor/fonts', file), path.join(root, 'android/app/src/main/assets/fonts', file));
}
for (const lic of ['LICENSE-Vazirmatn.txt', 'LICENSE-Lalezar.txt']) {
  fs.copyFileSync(path.join(root, 'vendor/fonts', lic), path.join(root, 'android/app/src/main/assets/fonts', lic));
}
console.log('built: dist/hokm-artifact.html, dist/hokm.html, android assets');
