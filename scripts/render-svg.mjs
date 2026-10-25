// Rend un SVG en PNG avec Chromium (Playwright pré-installé).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
const [, , input, output, w = '1600', h = '1060', bg = 'transparent'] = process.argv;
const svg = fs.readFileSync(input, 'utf8');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.setContent(`<html><body style="margin:0;background:${bg}">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</body></html>`);
await p.screenshot({ path: output, omitBackground: bg === 'transparent' });
await b.close();
console.log('PNG :', output);
