/**
 * Test de bout en bout « téléphone » (version 2.5D) : Chromium en émulation Pixel 7 paysage (écran tactile).
 * Glisser pour déplacer la vue, pincer pour zoomer, boutons de zoom, pose facile d’un meuble, toucher un rayon,
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
  const g0 = await page.evaluate(() => window.BAZAR.iso.ground(500, 250));
  await touch('touchStart', [{ x: 500, y: 250, id: 1 }]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: 500 - i * 20, y: 250 + i * 6, id: 1 }]);
    await page.waitForTimeout(30);
  }
  await touch('touchEnd', []);
  const t1 = await page.evaluate(() => ({ x: window.BAZAR.iso.target.x, z: window.BAZAR.iso.target.z }));
  check('Glisser le doigt déplace la vue', Math.hypot(t1.x - t0.x, t1.z - t0.z) > 1, `${Math.hypot(t1.x - t0.x, t1.z - t0.z).toFixed(2)} m`);
  // le sol suit le doigt : le point touché au départ se retrouve sous le doigt à l'arrivée
  const under = await page.evaluate(([x0, z0]) => window.BAZAR.project(x0, 0, z0), [g0.x, g0.z]);
  check('Le sol suit le doigt (pas de déplacement inversé)', Math.hypot(under.x - 340, under.y - 298) < 25, `point touché maintenant en ${under.x.toFixed(0)},${under.y.toFixed(0)} (doigt en 340,298)`);

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


  // boutons de zoom à l'écran
  const zb0 = await page.evaluate(() => window.BAZAR.iso.zoom);
  await page.tap('#zoom-btns button[aria-label="Dézoomer"]');
  await page.tap('#zoom-btns button[aria-label="Dézoomer"]');
  const zb1 = await page.evaluate(() => window.BAZAR.iso.zoom);
  await page.tap('#zoom-btns button[aria-label="Zoomer"]');
  const zb2 = await page.evaluate(() => window.BAZAR.iso.zoom);
  check('Boutons de zoom ＋ / －', zb1 < zb0 && zb2 > zb1, `${zb0.toFixed(2)} → ${zb1.toFixed(2)} → ${zb2.toFixed(2)}`);
  await page.tap('#zoom-btns button[aria-label="Voir tout le magasin"]');

  // Construire (plein écran) : achat + pose au doigt
  await page.tap('.hud-tools .tool:has-text("Construire")');
  await page.waitForTimeout(600);
  const full = await page.evaluate(() => {
    const r = document.querySelector('.m-build .m-sheet').getBoundingClientRect();
    return r.width >= innerWidth - 2 && r.height >= innerHeight - 2;
  });
  check('Écran Construire plein écran sur téléphone', full);
  await page.screenshot({ path: path.join(out, '03-construire.png') });
  const n0 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  await page.tap('.m-card.equip:has-text("Gondole basse") .m-btn');
  await page.waitForSelector('#place-bar');
  await page.waitForTimeout(300);
  // toucher le sol déplace l'aperçu, puis gros bouton « Poser ici »
  const m0 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  const pt = await page.evaluate(() => window.BAZAR.project(-2, 0, 7));
  await tap(pt.x, pt.y, 10);
  await page.screenshot({ path: path.join(out, '04-pose.png') });
  await page.tap('#place-bar .m-btn.green');
  await page.waitForTimeout(300);
  const n1 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  check('Pose facile au doigt (aperçu d’office, toucher pour déplacer, « Poser ici »)', n1 === n0 + 1 && m0 === n0, `${n0} → ${n1} équipements`);
  // toucher le rayon posé : panneau
  const c = await page.evaluate(() => {
    const e = window.BAZAR.game.st.equipment.find((x) => x.def === 'gondole_basse');
    return window.BAZAR.center(e.uid);
  });
  const pc = await page.evaluate(([x, z]) => window.BAZAR.project(x, 0.6, z), [c.x, c.z]);
  await tap(pc.x, pc.y, 5);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '05-rayon.png') });
  check('Toucher un rayon ouvre son panneau', await page.evaluate(() => window.BAZAR.panel.sel?.kind === 'equip' && document.getElementById('iso-panel').style.display !== 'none'));
  // tourner un meuble déjà posé, depuis son panneau
  const rot0 = await page.evaluate(() => window.BAZAR.panel.sel.e.rot);
  await page.tap('#iso-panel .btn:has-text("Tourner")');
  await page.waitForTimeout(300);
  const rot1 = await page.evaluate(() => window.BAZAR.game.st.equipment.find((x) => x.def === 'gondole_basse').rot);
  check('Tourner un meuble posé (bouton ⟳ du panneau)', rot1 !== rot0, `${rot0} → ${rot1}`);
  await page.tap('#iso-panel .x');

  // Commander : quelques appuis sur +, total, bouton Commander
  await page.tap('.hud-tools .tool:has-text("Commander")');
  await page.waitForTimeout(400);
  await page.tap('.m-order .m-card.prod >> nth=0 >> .m-btn:has-text("+")');
  await page.tap('.m-order .m-card.prod >> nth=1 >> .m-btn:has-text("+")');
  await page.screenshot({ path: path.join(out, '06-commander.png') });
  await page.tap('.m-order .m-foot .m-btn.green');
  await page.waitForTimeout(300);
  check('Commande au doigt', (await page.evaluate(() => window.BAZAR.game.st.orders.length)) === 1);
  await page.tap('.m-order .m-x');

  // Équipe
  await page.tap('.hud-tools .tool:has-text("Équipe")');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '07-equipe.png') });
  check('Écran Équipe', await page.evaluate(() => document.querySelectorAll('.m-team .m-role').length === 6));
  await page.tap('.m-team .m-x');

  // écran vertical : le jeu s'adapte (barre du bas, panneau en bas d'écran, écrans plein écran)
  const ctxP = await browser.newContext({ ...devices['Pixel 7'] });
  const pp = await ctxP.newPage();
  pp.on('pageerror', (e) => errors.push(String(e)));
  await pp.goto('http://localhost:4174/?nosplash&lowgfx');
  await pp.waitForFunction(() => window.BAZAR && window.BAZAR.mode === 'menu', null, { timeout: 90000 });
  await pp.evaluate(() => window.BAZAR.newGame());
  await pp.waitForTimeout(1200);
  await pp.evaluate(() => window.BAZAR.panel.select({ kind: 'equip', e: window.BAZAR.game.st.equipment.find((x) => x.slots) }));
  await pp.waitForTimeout(400);
  await pp.screenshot({ path: path.join(out, '08-portrait.png') });
  const por = await pp.evaluate(() => {
    const vp = { w: innerWidth, h: innerHeight };
    const panel = document.getElementById('iso-panel').getBoundingClientRect();
    const top = document.querySelector('.hud-top').getBoundingClientRect();
    return { portrait: vp.h > vp.w, panelFull: panel.width >= vp.w - 2 && panel.bottom >= vp.h - 2, topFits: top.right <= vp.w + 1 };
  });
  check('Écran vertical : interface adaptée (panneau en bas, barre du haut contenue)', por.portrait && por.panelFull && por.topFits, JSON.stringify(por));
  await ctxP.close();
} catch (e) {
  check('Exécution sans exception', false, String(e));
}
check('Aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
const ok = results.every(Boolean);
console.log(ok ? `\n${results.length}/${results.length} vérifications mobiles OK` : '\nÉCHECS');
process.exit(ok ? 0 : 1);
