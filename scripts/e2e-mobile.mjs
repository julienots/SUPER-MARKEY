/**
 * Test de bout en bout « téléphone » (version 2.5D) : Chromium en émulation Pixel 7 paysage (écran tactile).
 * Glisser pour déplacer la vue, pincer pour zoomer, toucher le sol pour envoyer le patron, toucher un rayon,
 * boutique du grossiste plein écran, achat + pose d'un meuble au doigt (aperçu puis validation).
 * Lancer après `npm run build` : `npm run e2e:mobile`.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'scripts/out/mobile');
fs.mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://localhost:4174/?nosplash&lowgfx');
  await page.waitForFunction(() => window.BAZAR && window.BAZAR.mode === 'menu', null, { timeout: 90000 });
  await page.screenshot({ path: path.join(out, '01-menu.png') });
  await page.evaluate(() => window.BAZAR.newGame({ storeName: 'BAZAR BAZAR' }));
  await page.waitForTimeout(1500);
  check('Mode tactile détecté', await page.evaluate(() => document.body.classList.contains('touch')));
  await page.screenshot({ path: path.join(out, '02-depart.png') });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y, id) => {
    await touch('touchStart', [{ x, y, id }]);
    await page.waitForTimeout(40);
    await touch('touchEnd', []);
    await page.waitForTimeout(250);
  };

  // glisser : la vue se déplace
  const t0 = await page.evaluate(() => ({ x: window.BAZAR.iso.target.x, z: window.BAZAR.iso.target.z }));
  await touch('touchStart', [{ x: 500, y: 250, id: 1 }]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: 500 - i * 20, y: 250 + i * 6, id: 1 }]);
    await page.waitForTimeout(30);
  }
  await touch('touchEnd', []);
  const t1 = await page.evaluate(() => ({ x: window.BAZAR.iso.target.x, z: window.BAZAR.iso.target.z }));
  check('Glisser le doigt déplace la vue', Math.hypot(t1.x - t0.x, t1.z - t0.z) > 1, `${Math.hypot(t1.x - t0.x, t1.z - t0.z).toFixed(2)} m`);

  // pincer : zoom
  const z0 = await page.evaluate(() => window.BAZAR.iso.zoom);
  await touch('touchStart', [{ x: 400, y: 200, id: 2 }, { x: 500, y: 200, id: 3 }]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ x: 400 - i * 15, y: 200, id: 2 }, { x: 500 + i * 15, y: 200, id: 3 }]);
    await page.waitForTimeout(30);
  }
  await touch('touchEnd', []);
  const z1 = await page.evaluate(() => window.BAZAR.iso.zoom);
  check('Pincer zoome', z1 > z0 * 1.3, `${z0.toFixed(2)} → ${z1.toFixed(2)}`);
  await page.evaluate(() => {
    window.BAZAR.iso.zoom = 1.6;
    window.BAZAR.iso.target.set(0, 0, 5);
    window.BAZAR.iso.update();
  });

  // toucher le sol : le patron s'y rend
  const p0 = await page.evaluate(() => ({ ...window.BAZAR.game.player.pos }));
  // un point de sol libre et praticable (allée devant les caisses)
  const dst = await page.evaluate(() => {
    const B = window.BAZAR;
    const g = B.game;
    for (const [x, z] of [[-1, 0.6], [1, 0.6], [-3, 0.6], [2, 2], [-1, -3]]) {
      if (!g.nav.walkableAt(x, z, { staff: true, keys: true })) continue;
      const p = B.project(x, 0, z);
      const r = B.iso.rayAt(p.x, p.y).ray;
      void r;
      return { ...p, x0: x, z0: z };
    }
    return B.project(-1, 0, -3);
  });
  await tap(dst.x, dst.y, 4);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.BAZAR.simulateBoss(0.5);
  });
  const p1 = await page.evaluate(() => ({ ...window.BAZAR.game.player.pos }));
  check('Toucher le sol envoie le patron', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);

  // toucher un rayon : panneau
  const c = await page.evaluate(() => {
    const e = window.BAZAR.game.st.equipment.find((x) => x.def === 'gondole_double');
    return window.BAZAR.center(e.uid);
  });
  const pc = await page.evaluate(([x, z]) => window.BAZAR.project(x, 1, z), [c.x, c.z]);
  await tap(pc.x, pc.y, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '03-rayon.png') });
  check('Toucher un rayon ouvre son panneau', await page.evaluate(() => window.BAZAR.panel.sel?.kind === 'equip' && document.getElementById('iso-panel').style.display !== 'none'));
  await page.tap('#iso-panel .x');

  // grossiste plein écran
  await page.tap('.hud-tools .tool:has-text("Grossiste")');
  await page.waitForTimeout(500);
  await page.tap('#shop button:has-text("Suggestion")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '04-grossiste.png') });
  const full = await page.evaluate(() => {
    const r = document.querySelector('.shop-win').getBoundingClientRect();
    return r.width >= innerWidth - 2;
  });
  check('Boutique plein écran au doigt, panier rempli', full && (await page.evaluate(() => document.querySelectorAll('.pcard.in').length)) > 3);

  // matériel : achat + pose au doigt
  await page.tap('.shop-tabs button:has-text("Matériel")');
  await page.waitForTimeout(200);
  const n0 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  await page.tap('.ecard:has-text("Gondole basse") button');
  await page.waitForTimeout(300);
  let id = 10;
  for (const [x, z] of [[2, 9], [4, 9], [-3, 9], [5, 4], [-5, 4], [2, 3]]) {
    const p = await page.evaluate(([a, b]) => window.BAZAR.project(a, 0, b), [x, z]);
    await tap(p.x, p.y, id++);
    await tap(p.x, p.y, id++);
    if ((await page.evaluate(() => window.BAZAR.game.st.equipment.length)) > n0) break;
  }
  await page.screenshot({ path: path.join(out, '05-construction.png') });
  const n1 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  check('Construction au doigt (aperçu puis pose)', n1 === n0 + 1, `${n0} → ${n1} équipements`);
} catch (e) {
  check('Exécution sans exception', false, String(e));
}
check('Aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
const ok = results.every(Boolean);
console.log(ok ? `\n${results.length}/${results.length} vérifications mobiles OK` : '\nÉCHECS');
process.exit(ok ? 0 : 1);
