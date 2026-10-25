/**
 * Test de bout en bout : lance le build (vite preview), ouvre le jeu dans Chromium (WebGL logiciel),
 * démarre une partie, joue quelques actions via l'API window.BAZAR et prend des captures d'écran.
 * Usage : npm run build && node scripts/e2e.mjs [--shots-only]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, process.argv.includes('--hq') ? 'scripts/out/hq' : 'scripts/out');
fs.mkdirSync(out, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => d.toString().includes('4173') && res());
  setTimeout(res, 8000);
});

const LOW = !process.argv.includes('--hq');
const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok, info });
  console.log(`${ok ? '✅' : '❌'} ${name}${info ? ' — ' + info : ''}`);
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
try {
  await page.goto(`http://localhost:4173/?nosplash${LOW ? '&lowgfx' : ''}`, { waitUntil: 'load' });
  page.setDefaultTimeout(90000);
  await page.waitForFunction(() => window.BAZAR && window.BAZAR.mode === 'menu', null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, '01-menu.png') });
  check('Menu principal affiché', true);

  await page.evaluate(() => window.BAZAR.newGame({ storeName: 'BAZAR BAZAR' }));
  await page.waitForTimeout(1500);
  check('Partie lancée', await page.evaluate(() => window.BAZAR.mode === 'play'));
  // vue extérieure : le joueur est sur le parking, face à la façade
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    g.player.teleport(-1, -9, 0);
    g.player.pitch = -0.05;
    g.st.time = 9 * 60;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, '02-facade.png') });

  // intérieur
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    g.player.teleport(-1, 1.5, 0);
    g.player.pitch = 0.1;
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, '03-interieur.png') });

  // simulation : des clients arrivent
  const s0 = await page.evaluate(() => window.BAZAR.stats());
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    g.st.speed = 4;
  });
  await page.waitForTimeout(15000);
  const s1 = await page.evaluate(() => window.BAZAR.stats());
  check('Le temps avance', s1.time > s0.time, `${(s0.time / 60).toFixed(2)}h → ${(s1.time / 60).toFixed(2)}h`);
  check('Des clients sont présents', s1.customers > 0, `${s1.customers} clients`);
  check('Produits rendus en rayon (instanciés)', s1.units > 200, `${s1.units} unités visibles`);
  console.log('Perf :', JSON.stringify({ fps: s1.fps.toFixed(1), drawCalls: s1.drawCalls, tris: s1.triangles }));
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    g.st.speed = 1;
    g.player.teleport(4, 7, Math.PI);
    g.player.pitch = 0.15;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, '04-clients.png') });

  // caisse tenue par le joueur
  const scanned = await page.evaluate(async () => {
    const g = window.BAZAR.game;
    const lane = [...g.checkouts.lanes.values()][0];
    g.player.interaction.enterCashier(lane);
    let n = 0;
    // un client arrive directement en caisse avec un panier
    const c = g.spawnCustomer(null, { archetype: 'actif', from: { x: lane.pts.queue[0].x, z: lane.pts.queue[0].z } });
    if (c) {
      c.basket.push({ pid: 'pates', exp: -1 }, { pid: 'cola', exp: -1 }, { pid: 'chips', exp: -1 });
      c.enteredAt = 1;
      c.goCheckout();
    }
    for (let i = 0; i < 3000 && n < 3; i++) {
      g.update(0.1);
      if (lane.scan && lane.scan.phase === 'scan' && lane.scan.errorT <= 0) {
        if (!g.checkouts.playerScan(lane)) n++;
      }
    }
    for (let i = 0; i < 100; i++) g.update(0.1);
    return { n, served: g.st.stats.customersServed };
  });
  check('Le joueur scanne en caisse', scanned.n > 0, `${scanned.n} articles scannés, ${scanned.served} clients servis`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '05-caisse.png') });
  await page.evaluate(() => window.BAZAR.game.player.interaction.leaveCashier());

  // tablette
  await page.evaluate(() => window.BAZAR.toggleTablet('dashboard'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, '06-tablette.png') });
  check('Tablette ouverte', await page.evaluate(() => !!document.getElementById('tablet')));
  await page.evaluate(() => window.BAZAR.toggleTablet('commandes'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '07-commandes.png') });
  await page.evaluate(() => window.BAZAR.toggleTablet());

  // mode construction + couverture caméra
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    window.BAZAR.toggleBuild();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, '08-construction.png') });
  await page.evaluate(() => window.BAZAR.toggleBuild());

  // nuit
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    g.st.time = Math.floor(g.st.time / 1440) * 1440 + 22 * 60;
    g.player.teleport(-1, -11, 0);
    g.player.pitch = -0.08;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, '09-nuit.png') });

  // sauvegarde / chargement
  const saved = await page.evaluate(() => window.BAZAR.save('slot3'));
  check('Sauvegarde locale', saved.ok, saved.error ?? '');
  const cashBefore = await page.evaluate(() => window.BAZAR.game.st.cash);
  await page.evaluate(() => window.BAZAR.load('slot3'));
  await page.waitForTimeout(1500);
  const cashAfter = await page.evaluate(() => window.BAZAR.game.st.cash);
  check('Rechargement identique', Math.abs(cashAfter - cashBefore) < 0.01, `${cashBefore.toFixed(2)} → ${cashAfter.toFixed(2)}`);
} catch (e) {
  check('Exécution sans exception', false, String(e));
}
check('Aucune erreur JavaScript', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
fs.writeFileSync(path.join(out, 'e2e-results.json'), JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
