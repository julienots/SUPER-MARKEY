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

/** Achète un meuble dans l'écran Construire et le pose (survol = aperçu, clic = pose). */
/** Achète un meuble dans l'écran Construire : il apparaît d'office à un emplacement libre ; on le tourne puis on le pose. */
const buyAndPlace = async (name) => {
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach((m) => m.remove()));
  await page.click('.hud-tools .tool:has-text("Construire")');
  await page.waitForSelector('.m-build');
  const n0 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  await page.click(`.m-card.equip:has-text("${name}") .m-btn`);
  await page.waitForSelector('#place-bar');
  await page.waitForTimeout(300);
  await shot('08a-apercu.png');
  await page.click('#place-bar .m-btn:has-text("Tourner")');
  await page.waitForTimeout(200);
  await page.click('#place-bar .m-btn.green');
  await page.waitForTimeout(300);
  const n1 = await page.evaluate(() => window.BAZAR.game.st.equipment.length);
  return { n0, n1, bar: await page.evaluate(() => !!document.getElementById('place-bar')) };
};
const shelfUnits = () => page.evaluate(() => window.BAZAR.game.st.equipment.reduce((a, e) => a + (e.slots ?? []).reduce((b, s) => b + s.lots.reduce((c, l) => c + l.q, 0), 0), 0));
const reserve = () => page.evaluate(() => window.BAZAR.game.st.equipment.reduce((a, e) => a + (e.cartons?.length ?? 0), 0));

try {
  await page.goto(`http://localhost:4173/?nosplash${HQ ? '' : '&lowgfx'}`, { waitUntil: 'load' });
  page.setDefaultTimeout(90000);
  await page.waitForFunction(() => window.BAZAR && window.BAZAR.mode === 'menu', null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await shot('01-menu.png');
  check('Menu principal (gros bouton JOUER) sur le magasin vivant', await page.evaluate(() => !!document.querySelector('#menu .mm-play') && window.BAZAR.game.agents.count('customer') > 0));

  // nouvelle partie par le menu
  await page.click('.mm-play', { force: true });
  await page.waitForSelector('.mm-diffs');
  await shot('02-nouvelle-partie.png');
  await page.click('.modal button:has-text("parti")');
  await page.waitForFunction(() => window.BAZAR.mode === 'play', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot('03-depart.png');
  const start = await page.evaluate(() => {
    const g = window.BAZAR.game;
    return { shelves: g.st.equipment.filter((e) => e.slots).length, furniture: g.st.equipment.length, level: g.st.flags.level, closed: !!g.st.flags.manualClosed };
  });
  const units0 = await shelfUnits();
  const res0 = await reserve();
  check('Départ : un rayon à moitié garni, quelques cartons, magasin fermé, niveau 1', start.shelves === 1 && units0 > 10 && res0 > 0 && res0 <= 8 && start.closed && start.level === 1, JSON.stringify({ ...start, units0, res0 }));

  // toucher le rayon → remplir depuis la réserve
  const gon = await page.evaluate(() => {
    const e = window.BAZAR.game.st.equipment.find((x) => x.slots);
    const c = window.BAZAR.center(e.uid);
    window.BAZAR.iso.target.set(c.x, 0, c.z);
    window.BAZAR.iso.update();
    return { ...c, uid: e.uid };
  });
  await page.waitForTimeout(300);
  await clickWorld(gon.x, 1.0, gon.z);
  await page.waitForTimeout(400);
  const selKind = await page.evaluate(() => window.BAZAR.panel.sel?.kind);
  if (selKind !== 'equip') await page.evaluate((uid) => window.BAZAR.panel.select({ kind: 'equip', e: window.BAZAR.game.st.equipment.find((x) => x.uid === uid) }), gon.uid);
  check('Toucher le rayon ouvre son panneau', selKind === 'equip', String(selKind));
  await shot('04-rayon.png');
  await page.click('#iso-panel button:has-text("Remplir")');
  await page.waitForTimeout(200);
  const units1 = await shelfUnits();
  check('« Remplir maintenant » : la réserve passe en rayon d’un appui', units1 > units0 && (await reserve()) < res0, `${units0} → ${units1} articles`);
  await page.evaluate(() => window.BAZAR.panel.close());

  // ouverture : le patron (non pilotable) tient seul la caisse, aucun bouton à marteler
  await page.click('.open-btn', { force: true });
  await page.waitForTimeout(300);
  check('Magasin ouvert', await page.evaluate(() => !window.BAZAR.game.st.flags.manualClosed));
  check('Pas de personnage à diriger ni de bouton SCANNER', await page.evaluate(() => !document.getElementById('scan-btn') && !!window.BAZAR.game.checkouts.bossLane()));
  const served = await page.evaluate(() => {
    const B = window.BAZAR;
    const g = B.game;
    g.st.speed = 2;
    if (g.st.time % 1440 < 9 * 60) g.st.time = Math.floor(g.st.time / 1440) * 1440 + 9 * 60;
    for (let i = 0; i < 1200 && g.st.stats.customersServed < 3; i++) B.simulate(0.5);
    const l = g.checkouts.bossLane();
    B.iso.target.set(l.pts.cashier.x, 0, l.pts.cashier.z);
    B.iso.update();
    return { served: g.st.stats.customersServed, rev: g.st.today.revenue, messes: g.st.messes.length };
  });
  check('La caisse encaisse toute seule, sans déchets au sol', served.served >= 3 && served.rev > 0 && served.messes === 0, JSON.stringify(served));
  await page.waitForTimeout(400);
  await shot('05-caisse.png');

  // Commander : panier en quelques appuis, livreur
  await page.evaluate(() => document.querySelectorAll('.modal-back, .m-levelup').forEach((m) => m.remove()));
  await page.click('.hud-tools .tool:has-text("Commander")');
  await page.waitForSelector('.m-order');
  check('Écran Commander : images des produits, familles verrouillées', await page.evaluate(() => document.querySelectorAll('.m-order .m-prod-img').length > 3 && document.querySelectorAll('.m-order .m-tab.locked').length > 3));
  for (let i = 0; i < 4; i++) await page.click(`.m-order .m-card.prod >> nth=${i} >> .m-btn:has-text("+")`);
  await shot('06-commander.png');
  const cash0 = await page.evaluate(() => window.BAZAR.game.st.cash);
  await page.click('.m-order .m-foot .m-btn.green');
  await page.waitForTimeout(300);
  const ord = await page.evaluate(() => window.BAZAR.game.st.orders.map((o) => ({ s: o.status, c: o.lines.reduce((a, l) => a + l.cartons, 0), wait: o.eta - o.placedAt })));
  check('Commande passée (payée, livraison en moins d’une heure)', ord.length === 1 && ord[0].c === 4 && ord[0].wait <= 60 && (await page.evaluate(() => window.BAZAR.game.st.cash)) < cash0, JSON.stringify(ord));
  await page.click('.m-order .m-x');
  const res1 = await reserve();
  const deliv = await page.evaluate(() => {
    const B = window.BAZAR;
    const g = B.game;
    let seen = false;
    for (let i = 0; i < 1200 && g.st.orders.some((o) => o.status !== 'livree'); i++) {
      B.simulateBoss(0.5);
      if (!seen && g.agents.list.some((a) => a.name === 'Livreur')) {
        seen = true;
        const c = g.agents.list.find((a) => a.name === 'Livreur');
        B.iso.target.set(c.pos.x, 0, c.pos.z);
        B.iso.update();
      }
    }
    return { seen, status: g.st.orders.map((o) => o.status) };
  });
  const res2 = await reserve();
  check('Le livreur apporte la commande en réserve', deliv.seen && deliv.status.every((x) => x === 'livree') && res2 >= res1 + 3, `${res1} → ${res2} cartons`);

  // Construire : acheter et poser un rayon
  await page.evaluate(() => document.querySelectorAll('.modal-back, .m-levelup').forEach((m) => m.remove()));
  await page.evaluate(() => { window.BAZAR.iso.target.set(0, 0, 6); window.BAZAR.iso.update(); });
  await page.click('.hud-tools .tool:has-text("Construire")');
  await page.waitForSelector('.m-build');
  await page.waitForTimeout(500);
  check('Écran Construire : vignettes des meubles et verrous de niveau', await page.evaluate(() => [...document.querySelectorAll('.m-build img.m-equip-img')].some((i) => i.src.startsWith('data:image')) && document.querySelectorAll('.m-build .m-card.locked').length > 0));
  await shot('07-construire.png');
  await page.click('.m-build .m-x');
  const pl = await buyAndPlace('Gondole double face');
  await shot('08-pose.png');
  check('Pose facile : emplacement libre proposé, Tourner, Poser (planogramme auto)', pl.n1 === pl.n0 + 1 && !pl.bar && (await page.evaluate(() => window.BAZAR.game.st.equipment.filter((e) => e.slots?.some((x) => x.pid)).length)) === 2, `${pl.n0} → ${pl.n1}`);

  // niveau supérieur
  await page.evaluate(() => (window.BAZAR.game.st.stats.unitsSold += 80));
  await page.waitForSelector('.m-levelup', { timeout: 15000 });
  await shot('09-niveau.png');
  check('Passage de niveau : écran des déblocages', await page.evaluate(() => document.querySelector('.m-lv-title')?.textContent.includes('NIVEAU')));
  await page.click('.m-levelup .m-btn');

  // Équipe : annonce, candidat, contrat CDD
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach((m) => m.remove()));
  await page.click('.hud-tools .tool:has-text("Équipe")');
  await page.waitForSelector('.m-team');
  await page.click('.m-team .m-btn:has-text("Publier")');
  await page.evaluate(() => {
    const B = window.BAZAR;
    for (let i = 0; i < 80 && !B.game.st.candidates.some((c) => !c.wantsCdi); i++) {
      document.querySelectorAll('.modal-back, .m-levelup').forEach((m) => m.remove());
      B.game.paused = false;
      B.simulate(10);
    }
    B.teamScr.render();
  });
  const cdd = await page.evaluate(() => window.BAZAR.game.st.candidates.findIndex((c) => !c.wantsCdi));
  if (cdd >= 0) {
    await page.click(`.m-team .m-card.emp:has-text("${await page.evaluate((i) => window.BAZAR.game.st.candidates[i].name, cdd)}") .m-btn`);
    await page.waitForSelector('.m-contracts');
    await shot('10-contrat.png');
    await page.click('.m-contract.cdd .m-btn:has-text("14 jours")');
  }
  await page.waitForTimeout(300);
  await shot('11-equipe.png');
  const emp = await page.evaluate(() => window.BAZAR.game.st.employees.map((e) => e.contract));
  check('Embauche en CDD de 14 jours', emp.length === 1 && emp[0].type === 'CDD' && emp[0].end - emp[0].start === 13, JSON.stringify(emp));
  await page.click('.m-team .m-x');

  // musiques enregistrées (instruments réels)
  const mus = await page.evaluate(async () => {
    const a = window.BAZAR.audio;
    a.unlock();
    a.setMusic('pop');
    for (let i = 0; i < 40 && !a.cur; i++) await new Promise((r) => setTimeout(r, 250));
    return { playing: !!a.cur, failed: a.filesFailed, ctx: a.ctx?.state };
  });
  check('Musique enregistrée chargée et jouée', mus.playing && !mus.failed, JSON.stringify(mus));

  // sauvegarde / chargement
  const saved = await page.evaluate(() => window.BAZAR.save('slot3'));
  check('Sauvegarde locale', saved.ok, saved.error ?? '');
  const before = await page.evaluate(() => ({ cash: window.BAZAR.game.st.cash, lv: window.BAZAR.game.st.flags.level, k: window.BAZAR.game.st.employees[0]?.contract?.type }));
  await page.evaluate(() => window.BAZAR.load('slot3'));
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ cash: window.BAZAR.game.st.cash, lv: window.BAZAR.game.st.flags.level, k: window.BAZAR.game.st.employees[0]?.contract?.type }));
  check('Rechargement identique (argent, niveau, contrat)', Math.abs(after.cash - before.cash) < 0.01 && after.lv === before.lv && after.k === before.k, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
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
