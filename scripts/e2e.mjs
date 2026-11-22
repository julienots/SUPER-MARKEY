// Test de bout en bout dans Chromium : partie seule, puis partie à deux sur deux navigateurs séparés
// (serveur de rendez-vous PeerJS local). Usage : npm run build && npm run e2e
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { PeerServer } from 'peer';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = 'scripts/out';
fs.mkdirSync(out, { recursive: true });
const PORT = 4177;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const peer = PeerServer({ port: 9123, path: '/', host: '127.0.0.1' });
await new Promise((r) => setTimeout(r, 2500));

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '✔' : '✘'} ${label}`);
  if (!cond) fails++;
};
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function page(name, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript((n) => localStorage.setItem('bazarbazar2.settings', JSON.stringify({ name: n, tutorial: false, music: 0, sfx: 0, quality: 'basse' })), name);
  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(`http://localhost:${PORT}/?peer=127.0.0.1:9123`);
  await p.waitForFunction(() => window.BAZAR?.ready(), null, { timeout: 120000 });
  return p;
}

try {
  // ------------------------------------------------------------ hôte
  const host = await page('Alice', { width: 1280, height: 720 });
  await host.screenshot({ path: `${out}/01-menu.png` });
  await host.click('text=JOUER À DEUX');
  await host.click('.duo-card button:has-text("Créer")');
  await host.waitForSelector('.code-big', { timeout: 25000 }).catch(async () => console.log('MODAL:', await host.textContent('.bigcard').catch(() => '?')));
  const code = (await host.textContent('.code-big')).trim();
  ok(/^[A-Z]{4}$/.test(code), `code de partie affiché (${code})`);
  await host.screenshot({ path: `${out}/02-code.png` });
  await host.click('.code-modal >> text=Jouer');

  // ------------------------------------------------------------ invité (téléphone vertical)
  const guest = await page('Bob', { width: 412, height: 860 });
  await guest.click('text=JOUER À DEUX');
  await guest.fill('.code-input', code.toLowerCase());
  await guest.click('.duo-card button:has-text("Rejoindre")');
  await guest.waitForFunction(() => window.BAZAR.session?.mode === 'guest', null, { timeout: 30000 });
  ok(true, 'l’invité a rejoint la partie');
  await host.waitForFunction(() => window.BAZAR.session.world.players.length === 2);
  ok(true, 'l’hôte voit deux joueurs');
  await guest.waitForFunction(() => window.BAZAR.session.agents.filter((a) => a.kind === 'player').length === 2);
  ok(true, 'l’invité voit les deux avatars');

  // l'invité construit une plante, l'hôte la voit
  const n0 = await host.evaluate(() => window.BAZAR.session.world.furn.length);
  await guest.click('.bottom [data-id=build]');
  await guest.click('.tab >> text=Déco');
  await guest.click('.card >> text=Plante verte');
  await guest.waitForSelector('.buildbar');
  await guest.screenshot({ path: `${out}/03-invite-construit.png` });
  await guest.click('.buildbar .ok');
  await host.waitForFunction((n) => window.BAZAR.session.world.furn.length === n + 1, n0, { timeout: 10000 });
  ok(true, 'meuble posé par l’invité visible chez l’hôte');
  await guest.waitForFunction((n) => window.BAZAR.session.world.furn.length === n + 1, n0, { timeout: 10000 });
  ok(true, 'et chez l’invité');

  // l'invité commande, l'argent baisse chez les deux
  const m0 = await host.evaluate(() => window.BAZAR.session.world.money);
  await guest.click('.bottom [data-id=order]');
  await guest.click('.card:has-text("Eau minérale") .qty button:last-child');
  await guest.screenshot({ path: `${out}/04-invite-commande.png` });
  await guest.click('.sheet-foot .cta');
  await host.waitForFunction((m) => window.BAZAR.session.world.money < m, m0, { timeout: 10000 });
  ok(true, 'commande de l’invité payée sur la caisse commune');
  await guest.waitForFunction(() => window.BAZAR.session.world.deliveries.length > 0 || window.BAZAR.session.agents.some((a) => a.kind === 'van'), null, { timeout: 15000 });
  ok(true, 'l’invité voit la livraison en route');

  // l'hôte accélère, les clients arrivent chez les deux
  await host.click('.speeds button[data-v="3"]');
  await host.waitForTimeout(12000);
  const hostCust = await host.evaluate(() => window.BAZAR.session.agents.filter((a) => a.kind === 'customer').length);
  const guestCust = await guest.evaluate(() => window.BAZAR.session.agents.filter((a) => a.kind === 'customer').length);
  ok(hostCust > 0 && Math.abs(hostCust - guestCust) <= 2, `clients synchronisés (hôte ${hostCust}, invité ${guestCust})`);
  ok((await guest.evaluate(() => window.BAZAR.session.world.speed)) === 3, 'vitesse partagée');
  await host.screenshot({ path: `${out}/05-hote.png` });
  await guest.screenshot({ path: `${out}/06-invite.png` });

  // l'invité touche un rayon à l'écran : panneau des étages
  await guest.click('.toast', { timeout: 1 }).catch(() => {});
  const pt = await guest.evaluate(() => {
    const s = window.BAZAR.session;
    const f = s.world.furn.find((g) => g.def === 'gondole_simple');
    return window.BAZAR.screenOf(f.x + 1, 1.0, f.z + 0.6);
  });
  await guest.mouse.click(pt.x, pt.y);
  await guest.waitForSelector('.panel');
  await guest.screenshot({ path: `${out}/07-invite-rayon.png` });
  ok(await guest.locator('.panel .lvl').count() === 5, 'panneau du rayon : 5 étages');
  await guest.click('.panel .act:has-text("Remplir")');
  await host.waitForFunction(() => {
    const s = window.BAZAR.session;
    const me = s.world.players.find((p) => p.id !== 'host');
    return me && s.sim.taskOf(me.id) !== '';
  }, null, { timeout: 5000 }).then(() => ok(true, 'l’avatar de l’invité part remplir le rayon'), () => ok(false, 'l’avatar de l’invité part remplir le rayon'));

  // l'invité dirige son perso au joystick : il bouge chez l'hôte
  await guest.click('.panel .x').catch(() => {});
  const pos0 = await host.evaluate(() => window.BAZAR.session.agents.find((a) => a.kind === 'player' && a.pid !== 'host'));
  const joy = await guest.locator('.joy').boundingBox();
  await guest.mouse.move(joy.x + joy.width / 2, joy.y + joy.height / 2);
  await guest.mouse.down();
  await guest.mouse.move(joy.x + joy.width / 2 + 40, joy.y + joy.height / 2, { steps: 4 });
  await guest.waitForTimeout(1500);
  await guest.mouse.up();
  const pos1 = await host.evaluate(() => window.BAZAR.session.agents.find((a) => a.kind === 'player' && a.pid !== 'host'));
  ok(Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) > 1, `l’invité dirige son perso au joystick (${Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z).toFixed(1)} m)`);
  await guest.screenshot({ path: `${out}/07b-joystick.png` });

  // l'invité recharge la page et revient : toujours un seul perso pour lui
  await guest.reload();
  await guest.waitForFunction(() => window.BAZAR?.ready(), null, { timeout: 120000 });
  await guest.click('text=JOUER À DEUX');
  await guest.fill('.code-input', code);
  await guest.click('.duo-card button:has-text("Rejoindre")');
  await guest.waitForFunction(() => window.BAZAR.session?.mode === 'guest', null, { timeout: 30000 });
  await host.waitForTimeout(1500);
  const counts = await host.evaluate(() => ({ players: window.BAZAR.session.world.players.length, avatars: window.BAZAR.session.agents.filter((a) => a.kind === 'player').length }));
  ok(counts.players === 2 && counts.avatars === 2, `reconnexion sans doublon (${counts.players} joueurs, ${counts.avatars} persos)`);
  await guest.waitForTimeout(800);
  const gAvatars = await guest.evaluate(() => window.BAZAR.session.agents.filter((a) => a.kind === 'player').length);
  ok(gAvatars === 2, `l’invité voit 2 persos après reconnexion (${gAvatars})`);

  // l'invité déplace la vue au doigt (glisser sur le décor)
  const cam0 = await guest.evaluate(() => ({ ...window.BAZAR.view.cam }));
  await guest.mouse.move(250, 300);
  await guest.mouse.down();
  await guest.mouse.move(150, 420, { steps: 8 });
  await guest.mouse.up();
  const cam1 = await guest.evaluate(() => ({ ...window.BAZAR.view.cam }));
  ok(Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z) > 1, 'l’invité déplace la caméra');
  // toucher le sol : le perso y va
  const target = await guest.evaluate(() => window.BAZAR.screenOf(8.5, 0, -2.5));
  await guest.mouse.click(target.x, target.y);
  await host.waitForFunction(() => {
    const a = window.BAZAR.session.agents.find((b) => b.kind === 'player' && b.pid !== 'host');
    return Math.hypot(a.x - 8.5, a.z + 2.5) < 1;
  }, null, { timeout: 15000 }).then(() => ok(true, 'toucher le sol envoie son perso'), () => ok(false, 'toucher le sol envoie son perso'));

  // l'hôte quitte : l'invité est prévenu
  await host.evaluate(() => window.BAZAR.session.close());
  await guest.waitForSelector('text=Partie terminée', { timeout: 15000 });
  ok(true, 'l’invité est prévenu quand l’hôte quitte');
  await guest.screenshot({ path: `${out}/08-fin.png` });

  // ------------------------------------------------------------ partie seule, avec écrans
  const solo = await page('Chloé', { width: 1280, height: 720 });
  await solo.click('.menu .cta.xl >> nth=0');
  await solo.waitForFunction(() => window.BAZAR.session?.mode === 'solo');
  ok(true, 'nouvelle partie seule');
  await solo.click('.bottom [data-id=build]');
  await solo.waitForTimeout(400);
  await solo.screenshot({ path: `${out}/09-construire.png` });
  await solo.click('.card >> text=Gondole double');
  await solo.waitForTimeout(400);
  await solo.screenshot({ path: `${out}/10-pose.png` });
  const before = await solo.evaluate(() => window.BAZAR.session.world.furn.length);
  await solo.click('.buildbar .ok');
  await solo.waitForTimeout(300);
  ok((await solo.evaluate(() => window.BAZAR.session.world.furn.length)) === before + 1, 'pose d’une gondole');
  await solo.click('.bottom [data-id=team]');
  await solo.click('.card:has-text("Caissier")');
  await solo.waitForTimeout(400);
  ok((await solo.evaluate(() => window.BAZAR.session.world.staff.length)) === 1, 'embauche');
  await solo.screenshot({ path: `${out}/11-equipe.png` });
  await solo.click('.sheet .x');
  await solo.click('.bottom [data-id=menu]');
  await solo.waitForTimeout(300);
  await solo.screenshot({ path: `${out}/12-menu.png` });
  await solo.click('text=Menu principal');
  await solo.waitForSelector('.menu');
  ok(true, 'retour au menu principal');
  await solo.click('text=CONTINUER');
  await solo.waitForFunction(() => window.BAZAR.session?.mode === 'solo' && window.BAZAR.session.world.staff.length === 1);
  ok(true, 'la partie sauvegardée reprend (avec l’employé)');
} catch (e) {
  console.error(e);
  fails++;
}
ok(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
await browser.close();
server.kill();
peer.close?.();
console.log(fails ? `${fails} échec(s)` : 'Tout est vert.');
process.exit(fails ? 1 : 0);
