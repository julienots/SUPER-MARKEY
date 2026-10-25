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
  // avance la simulation sans rendu jusqu'à l'arrivée de clients (le rendu logiciel est lent)
  await page.evaluate(() => {
    for (let i = 0; i < 40 && window.BAZAR.game.agents.count('customer') === 0; i++) window.BAZAR.simulate(15);
  });
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

  // vraies entrées clavier : marcher puis prendre un carton avec E
  const walk = await page.evaluate(() => {
    const g = window.BAZAR.game;
    g.st.time = Math.floor(g.st.time / 1440) * 1440 + 10 * 60;
    g.player.dropHeld(false);
    g.player.held = null;
    g.player.teleport(-1, 2.5, 0);
    return { x: g.player.pos.x, z: g.player.pos.z };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const walked = await page.evaluate(() => ({ x: window.BAZAR.game.player.pos.x, z: window.BAZAR.game.player.pos.z }));
  check('Déplacement au clavier (W)', walked.z - walk.z > 0.5, `z ${walk.z.toFixed(2)} → ${walked.z.toFixed(2)}`);
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    const rack = g.st.equipment.find((e) => e.def === 'rack_reserve' && e.cartons.length);
    const r = g.storeRect();
    // face au rack, dans la réserve
    const cx = (rack.gx + 2) * 0.5 - 8;
    const cz = (rack.gz + 1) * 0.5;
    g.player.teleport(cx, cz - 1.6, 0);
    g.player.yaw = 0;
    g.player.pitch = 0.45;
    void r;
  });
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  const held = await page.evaluate(() => window.BAZAR.game.player.held?.kind ?? null);
  check('Prendre un carton avec E (raycast + action contextuelle)', held === 'cartons', String(held));
  await page.screenshot({ path: path.join(out, '10-carton-en-main.png') });
  const cartOk = await page.evaluate(() => {
    const g = window.BAZAR.game;
    const cart = g.items.carts[0];
    const ok = g.player.interaction.perform({ kind: 'cart', cart }, 'Poser le carton');
    const n1 = cart.cargo.length;
    window.BAZAR.simulate(3);
    const kept = cart.cargo.length;
    const back = g.player.interaction.perform({ kind: 'cart', cart }, 'Prendre un carton');
    return { ok, n1, kept, back, held: g.player.held?.kind ?? null, left: cart.cargo.length };
  });
  check('Carton posé puis repris dans un chariot', cartOk.ok && cartOk.n1 === 1 && cartOk.kept === 1 && cartOk.back && cartOk.held === 'cartons' && cartOk.left === 0, JSON.stringify(cartOk));

  // embauche par l'interface (clics réels dans la tablette)
  await page.evaluate(() => {
    window.BAZAR.game.player.dropHeld(false);
    window.BAZAR.toggleTablet('personnel');
  });
  await page.waitForTimeout(500);
  await page.click('#tablet button.btn.small.primary:has-text("Publier")');
  await page.evaluate(() => {
    for (let i = 0; i < 60 && !window.BAZAR.game.st.candidates.length; i++) {
      document.querySelectorAll('.modal-back').forEach((m) => m.remove());
      window.BAZAR.game.paused = false;
      window.BAZAR.simulate(30);
    }
    window.BAZAR.toggleTablet('personnel');
    window.BAZAR.toggleTablet('personnel');
  });
  await page.waitForTimeout(600);
  console.log('  debug embauche', await page.evaluate(() => JSON.stringify({ posts: window.BAZAR.game.st.jobPostings.length, cands: window.BAZAR.game.st.candidates.length, tablet: !!document.getElementById('tablet'), btns: [...document.querySelectorAll('#tablet button')].map((b) => b.textContent).filter((t) => t.includes('Emb')).slice(0, 3) })));
  const hireBtn = page.locator('#tablet button:has-text("Embaucher")').first();
  if (await hireBtn.count()) await hireBtn.click();
  await page.waitForTimeout(400);
  const staff = await page.evaluate(() => window.BAZAR.game.st.employees.length);
  check('Embauche via la tablette (clics)', staff >= 1, `${staff} employé(s)`);
  await page.screenshot({ path: path.join(out, '11-personnel.png') });
  await page.evaluate(() => window.BAZAR.toggleTablet());

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
