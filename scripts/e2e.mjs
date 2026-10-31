/**
 * Test de bout en bout (version 2.5D) : lance le build (vite preview), ouvre le jeu dans Chromium (WebGL
 * logiciel) et joue la boucle du commerçant avec de vrais clics : menu → nouvelle partie (rayons vides) →
 * grossiste (suggestion + commande) → livraison → ranger la palette → remplir un rayon → ouvrir →
 * tenir la caisse / scanner → tablette (embauche) → matériel (achat + pose) → sauvegarde / chargement.
 * Usage : npm run build && node scripts/e2e.mjs [--hq]
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HQ = process.argv.includes('--hq');
const out = path.join(root, HQ ? 'scripts/out/hq' : 'scripts/out');
fs.mkdirSync(out, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => d.toString().includes('4173') && res());
  setTimeout(res, 8000);
});

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
const shot = (n) => page.screenshot({ path: path.join(out, n) });
/** Clique à l'écran sur un point du monde (projection de la caméra 2.5D). */
const clickWorld = async (x, y, z) => {
  const p = await page.evaluate(([a, b, c]) => window.BAZAR.project(a, b, c), [x, y, z]);
  await page.mouse.click(p.x, p.y);
};
/** Fait avancer le jeu (patron compris) jusqu'à ce que le patron ait fini son ordre. */
const runBoss = (maxSec = 1500) =>
  page.evaluate((m) => {
    const B = window.BAZAR;
    let t = 0;
    for (; t < m && B.manager.busy; t += 0.5) B.simulateBoss(0.5);
    return t;
  }, maxSec);

try {
  await page.goto(`http://localhost:4173/?nosplash${HQ ? '' : '&lowgfx'}`, { waitUntil: 'load' });
  page.setDefaultTimeout(90000);
  await page.waitForFunction(() => window.BAZAR && window.BAZAR.mode === 'menu', null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot('01-menu.png');
  check('Menu principal sur le magasin vivant', await page.evaluate(() => !!document.getElementById('menu') && window.BAZAR.game.agents.count('customer') > 0));

  // nouvelle partie par le menu
  await page.click('#menu button:has-text("Nouvelle partie")');
  await page.click('.modal button:has-text("parti")');
  await page.waitForFunction(() => window.BAZAR.mode === 'play', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot('02-depart.png');
  const start = await page.evaluate(() => {
    const g = window.BAZAR.game;
    const units = g.st.equipment.reduce((a, e) => a + (e.slots ?? []).reduce((b, s) => b + s.lots.reduce((c, l) => c + l.q, 0), 0), 0);
    const cartons = g.st.equipment.reduce((a, e) => a + (e.cartons?.length ?? 0), 0);
    return { units, cartons, closed: !!g.st.flags.manualClosed, open: g.isOpen() };
  });
  check('Départ : rayons et réserve vides, magasin fermé', start.units === 0 && start.cartons === 0 && start.closed && !start.open, JSON.stringify(start));

  // grossiste : suggestion + commande (clics)
  await page.click('.hud-tools .tool:has-text("Grossiste")');
  await page.waitForSelector('#shop');
  await page.click('#shop button:has-text("Suggestion")');
  await page.waitForTimeout(300);
  await shot('03-grossiste.png');
  const cash0 = await page.evaluate(() => window.BAZAR.game.st.cash);
  await page.click('#shop .shop-bar button:has-text("Commander")');
  await page.waitForTimeout(300);
  await shot('04-commandes.png');
  const ord = await page.evaluate(() => window.BAZAR.game.st.orders.map((o) => ({ s: o.status, c: o.lines.reduce((a, l) => a + l.cartons, 0) })));
  const cash1 = await page.evaluate(() => window.BAZAR.game.st.cash);
  check('Commande passée chez le grossiste', ord.length === 1 && ord[0].c > 10 && cash1 < cash0, `${ord[0]?.c} cartons, ${(cash0 - cash1).toFixed(2)} €`);
  await page.click('#shop .shop-head button');

  // livraison
  const deliv = await page.evaluate(() => {
    const B = window.BAZAR;
    const g = B.game;
    g.st.speed = 4;
    for (let i = 0; i < 600 && g.items.pallets.size === 0; i++) B.simulate(1);
    B.simulate(4);
    return { pallets: g.items.pallets.size, h: (g.st.time / 60).toFixed(2) };
  });
  check('Le camion livre des palettes au quai', deliv.pallets > 0, `${deliv.pallets} palette(s) à ${deliv.h} h`);

  // toucher une palette → panneau → ranger
  const pal = await page.evaluate(() => {
    const [, v] = [...window.BAZAR.game.items.pallets][0];
    const t = v.body.translation();
    window.BAZAR.iso.target.set(t.x, 0, t.z);
    window.BAZAR.iso.update();
    return { x: t.x, z: t.z };
  });
  await page.waitForTimeout(300);
  await clickWorld(pal.x, 0.6, pal.z);
  await page.waitForTimeout(400);
  await shot('05-palette.png');
  check('Toucher la palette ouvre son panneau', await page.evaluate(() => window.BAZAR.panel.sel?.kind === 'pallet'));
  await page.click('#iso-panel button:has-text("Ranger en réserve")');
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.BAZAR.simulateBoss(0.5);
  });
  await page.waitForTimeout(300);
  await shot('06-rangement.png');
  const tPut = await runBoss(3000);
  const stocked = await page.evaluate(() => window.BAZAR.game.st.equipment.reduce((a, e) => a + (e.cartons?.length ?? 0), 0));
  check('Le patron range la livraison en réserve', stocked > 10, `${stocked} cartons en réserve (${tPut.toFixed(0)} s)`);

  // toucher un rayon → remplir
  const gon = await page.evaluate(() => {
    const B = window.BAZAR;
    const g = B.game;
    B.iso.target.set(0, 0, 6);
    B.iso.update();
    const e = g.st.equipment.find((x) => x.def === 'gondole_double');
    return { ...B.center(e.uid), uid: e.uid };
  });
  await page.waitForTimeout(300);
  await clickWorld(gon.x, 1.0, gon.z);
  await page.waitForTimeout(400);
  const selKind = await page.evaluate(() => window.BAZAR.panel.sel?.kind);
  if (selKind !== 'equip') await page.evaluate((uid) => window.BAZAR.panel.select({ kind: 'equip', e: window.BAZAR.game.st.equipment.find((x) => x.uid === uid) }), gon.uid);
  check('Toucher un rayon ouvre son panneau', selKind === 'equip', String(selKind));
  await page.waitForTimeout(300);
  await shot('07-rayon.png');
  await page.click('#iso-panel button:has-text("Remplir")');
  await runBoss(1500);
  // le reste du magasin, directement via le patron
  const filled = await page.evaluate(() => {
    const B = window.BAZAR;
    const g = B.game;
    for (const e of g.st.equipment.filter((x) => x.slots?.some((s) => s.pid))) {
      B.manager.restock(e);
      for (let t = 0; t < 1500 && B.manager.busy; t += 0.5) B.simulateBoss(0.5);
    }
    return g.st.equipment.reduce((a, e) => a + (e.slots ?? []).reduce((b, s) => b + s.lots.reduce((c, l) => c + l.q, 0), 0), 0);
  });
  check('Les rayons sont remplis depuis la réserve', filled > 300, `${filled} articles en rayon`);
  await page.evaluate(() => window.BAZAR.panel.close());

  // ouverture : le patron file en caisse, on scanne au bouton
  await page.click('.open-btn', { force: true });
  await page.waitForTimeout(300);
  check('Magasin ouvert', await page.evaluate(() => !window.BAZAR.game.st.flags.manualClosed));
  const at = await page.evaluate(() => {
    const B = window.BAZAR;
    const g = B.game;
    g.st.speed = 2;
    if (g.st.time % 1440 < 9 * 60) g.st.time = Math.floor(g.st.time / 1440) * 1440 + 9 * 60;
    for (let t = 0; t < 200 && g.player.mode !== 'cashier'; t += 0.5) B.simulateBoss(0.5);
    for (let t = 0; t < 400 && !g.player.lane?.scan; t += 0.5) B.simulateBoss(0.5);
    return { mode: g.player.mode, scan: !!g.player.lane?.scan };
  });
  check('Première ouverture : le patron tient la caisse', at.mode === 'cashier', JSON.stringify(at));
  const sc0 = await page.evaluate(() => window.BAZAR.game.st.stats.playerScans);
  for (let i = 0; i < 6; i++) {
    await page.click('#scan-btn');
    await page.waitForTimeout(120);
  }
  await shot('08-caisse.png');
  const served = await page.evaluate(() => {
    const B = window.BAZAR;
    for (let i = 0; i < 300 && B.game.st.stats.customersServed < 2; i++) B.simulateBoss(0.5);
    return { scans: B.game.st.stats.playerScans, served: B.game.st.stats.customersServed, rev: B.game.st.today.revenue };
  });
  check('Encaissement : clics sur SCANNER + clients servis', served.scans > sc0 && served.served > 0, JSON.stringify(served));
  await page.waitForTimeout(800);
  await shot('09-magasin-ouvert.png');

  // tablette : embauche
  await page.evaluate(() => {
    const g = window.BAZAR.game;
    for (let i = 0; i < 40 && !g.st.candidates.length; i++) window.BAZAR.simulate(20);
  });
  await page.click('.hud-tools .tool:has-text("Gestion")');
  await page.waitForSelector('#tablet');
  await page.evaluate(() => window.BAZAR.toggleTablet('personnel'));
  await page.evaluate(() => window.BAZAR.toggleTablet('personnel'));
  const hire = page.locator('#tablet button:has-text("Embaucher")').first();
  if (await hire.count()) {
    await page.evaluate(() => (window.BAZAR.game.paused = true));
    await hire.click({ timeout: 20000 }).catch(() => hire.click({ force: true }));
    await page.evaluate(() => (window.BAZAR.game.paused = false));
  }
  await page.waitForTimeout(300);
  await shot('10-tablette.png');
  check('Embauche via la tablette', (await page.evaluate(() => window.BAZAR.game.st.employees.length)) >= 1);
  await page.evaluate(() => window.BAZAR.toggleTablet());

  // matériel : acheter puis poser une gondole (aperçu puis clic)
  await page.click('.hud-tools .tool:has-text("Grossiste")');
  await page.click('.shop-tabs button:has-text("Matériel")');
  await page.waitForTimeout(200);
  await shot('11-materiel.png');
  const n0 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  await page.click('.ecard:has-text("Gondole basse") button');
  await page.waitForTimeout(300);
  const spots = [[2, 9], [4, 9], [-3, 9], [5, 4], [-5, 4], [2, 3]];
  for (const [x, z] of spots) {
    const p = await page.evaluate(([a, b]) => window.BAZAR.project(a, 0, b), [x, z]);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => window.BAZAR.game.st.equipment.length)) > n0) break;
  }
  await shot('12-pose.png');
  const n1 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  check('Achat et pose d’un meuble', n1 === n0 + 1, `${n0} → ${n1}`);
  await page.click('#build-ui button:has-text("Terminer")');

  // sauvegarde / chargement
  const saved = await page.evaluate(() => window.BAZAR.save('slot3'));
  check('Sauvegarde locale', saved.ok, saved.error ?? '');
  const cashBefore = await page.evaluate(() => window.BAZAR.game.st.cash);
  await page.evaluate(() => window.BAZAR.load('slot3'));
  await page.waitForTimeout(1500);
  const cashAfter = await page.evaluate(() => window.BAZAR.game.st.cash);
  check('Rechargement identique', Math.abs(cashAfter - cashBefore) < 0.01, `${cashBefore.toFixed(2)} → ${cashAfter.toFixed(2)}`);
  const perf = await page.evaluate(() => window.BAZAR.stats());
  console.log('Perf :', JSON.stringify({ fps: perf.fps.toFixed(1), drawCalls: perf.drawCalls, tris: perf.triangles }));
} catch (e) {
  check('Exécution sans exception', false, String(e));
  await shot('zz-erreur.png').catch(() => {});
}
check('Aucune erreur JavaScript', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.kill();
fs.writeFileSync(path.join(out, 'e2e-results.json'), JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
