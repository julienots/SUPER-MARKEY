// Captures de contrôle visuel du gameplay (rendu allégé pour la vitesse).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = 'scripts/out/qa';
fs.mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort'], { cwd: process.cwd(), stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 3000));
const hq = process.argv.includes('--hq');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.setDefaultTimeout(120000);
p.on('pageerror', (e) => console.log('ERR', e));
await p.goto(`http://localhost:4176/?nosplash${hq ? '' : '&lowgfx'}`);
await p.waitForFunction(() => window.BAZAR && window.BAZAR.mode === 'menu', null, { timeout: 90000 });
await p.evaluate(() => window.BAZAR.newGame());
await p.waitForTimeout(800);
const shot = async (name, fn, wait = 900) => {
  await p.evaluate(fn);
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
};
// embauche + quelques heures pour voir le personnel au travail
await p.evaluate(() => {
  const g = window.BAZAR.game;
  const st = g.st;
  for (const role of ['caissier', 'rayon', 'logisticien']) {
    st.jobPostings.push({ role, until: 5, wage: 15 });
  }
  g.st.time = 9 * 60;
  for (let i = 0; i < 30; i++) window.BAZAR.simulate(10);
});
await p.evaluate(async () => {
  const g = window.BAZAR.game;
  const { hire } = await import('/src/sim/staff.ts').catch(() => ({}));
  void hire;
});
await shot('01-reserve-carton', () => {
  const g = window.BAZAR.game;
  const rack = g.st.equipment.find((e) => e.def === 'rack_reserve' && e.cartons.length);
  if (rack) g.player.interaction.takeFromRack(rack, 0);
  const r = g.storeRect();
  g.player.teleport(r.staffDoorX + 1, r.backZ + 1.6, Math.PI / 2 + 0.4);
  g.player.pitch = 0.25;
});
await shot('02-troisieme-personne', () => {
  const g = window.BAZAR.game;
  g.player.thirdPerson = true;
  g.player.teleport(-1, 2.5, 0.3);
  g.player.pitch = 0.2;
});
await shot('03-vue-ensemble-clients', () => {
  const g = window.BAZAR.game;
  g.player.thirdPerson = false;
  g.player.dropHeld(false);
  for (let i = 0; i < 20; i++) window.BAZAR.simulate(10);
  g.player.teleport(7, 1, -0.9);
  g.player.pitch = 0.3;
});
await shot('04-rue', () => {
  const g = window.BAZAR.game;
  g.player.teleport(18, -15, -1.9);
  g.player.pitch = 0.02;
});
await shot('05-pluie-soir', () => {
  const g = window.BAZAR.game;
  g.st.weather = { kind: 'pluie', until: g.st.time + 600 };
  g.st.time = Math.floor(g.st.time / 1440) * 1440 + 19.6 * 60;
  g.player.teleport(4, -10, -0.3);
  g.player.pitch = -0.05;
}, 2500);
await b.close();
server.kill();
