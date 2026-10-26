/**
 * Test de bout en bout « téléphone » : Chromium en émulation Pixel 7 paysage (écran tactile),
 * joystick virtuel, vue au doigt, bouton Action, tablette, mode construction au doigt.
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
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach((m) => m.remove()));
  check('Mode tactile détecté', await page.evaluate(() => window.BAZAR.game.player.input.touch && !!document.getElementById('touch')));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });

  // joystick (moitié gauche) : pousser vers le haut = avancer
  const p0 = await page.evaluate(() => ({ ...window.BAZAR.game.player.pos }));
  await touch('touchStart', [{ x: 150, y: 300, id: 1 }]);
  for (let i = 1; i <= 6; i++) {
    await touch('touchMove', [{ x: 150, y: 300 - i * 10, id: 1 }]);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, '02-joystick.png') });
  await touch('touchEnd', []);
  const p1 = await page.evaluate(() => ({ ...window.BAZAR.game.player.pos }));
  check('Joystick : le gérant avance', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);

  // vue : glisser à droite de l'écran
  const y0 = await page.evaluate(() => window.BAZAR.game.player.yaw);
  await touch('touchStart', [{ x: 600, y: 200, id: 2 }]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: 600 - i * 15, y: 200, id: 2 }]);
    await page.waitForTimeout(40);
  }
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const y1 = await page.evaluate(() => window.BAZAR.game.player.yaw);
  check('Glisser le doigt tourne la vue', Math.abs(y1 - y0) > 0.2, `${y0.toFixed(2)} → ${y1.toFixed(2)} rad`);

  // bouton Action devant un rack de réserve
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    const rack = g.st.equipment.find((e) => e.def === 'rack_reserve' && e.cartons.length);
    g.player.teleport((rack.gx + 2) * 0.5 - 8, (rack.gz + 1) * 0.5 - 1.6, 0);
    g.player.yaw = 0;
    g.player.pitch = 0.45;
  });
  await page.waitForTimeout(800);
  const box = await (await page.$('.tbtn.big')).boundingBox();
  await touch('touchStart', [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 3 }]);
  await page.waitForTimeout(300);
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '03-carton.png') });
  check('Bouton Action : prendre un carton', (await page.evaluate(() => window.BAZAR.game.player.held?.kind ?? null)) === 'cartons');

  // tablette via la barre d'outils (tap)
  await page.tap('.hud-tools .tool');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, '04-tablette.png') });
  check('Tablette ouverte au doigt, contrôles masqués', await page.evaluate(() => !!document.getElementById('tablet') && document.getElementById('touch').style.display === 'none'));
  await page.tap('#tablet .head button');
  await page.waitForTimeout(300);

  // construction : choisir une gondole, taper deux fois au même endroit pour la poser
  await page.evaluate(() => window.BAZAR.game.player.dropHeld(false));
  await page.tap('.hud-tools .tool:nth-child(2)');
  await page.waitForTimeout(1000);
  const n0 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  const cardOk = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#build-ui button, #build-ui .card, #build-ui [data-def]')].find((x) => x.textContent.includes('Gondole basse'));
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(400);
  // vise plusieurs points du sol du magasin jusqu'à trouver une place libre (2 taps = aperçu puis pose)
  const vp = page.viewportSize();
  const spots = [[0.45, 0.52], [0.5, 0.52], [0.4, 0.45], [0.55, 0.45], [0.62, 0.5], [0.36, 0.52]];
  let id = 10;
  for (const [fx, fy] of spots) {
    for (let k = 0; k < 2; k++) {
      await touch('touchStart', [{ x: vp.width * fx, y: vp.height * fy, id: id++ }]);
      await touch('touchEnd', []);
      await page.waitForTimeout(400);
    }
    if ((await page.evaluate(() => window.BAZAR.game.st.equipment.length)) > n0) break;
  }
  await page.screenshot({ path: path.join(out, '05-construction.png') });
  const n1 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  check('Construction au doigt (aperçu puis pose)', cardOk && n1 === n0 + 1, `${n0} → ${n1} équipements`);
} catch (e) {
  check('Exécution sans exception', false, String(e));
}
check('Aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
const ok = results.every(Boolean);
console.log(ok ? `\n${results.length}/${results.length} vérifications mobiles OK` : '\nÉCHECS');
process.exit(ok ? 0 : 1);
