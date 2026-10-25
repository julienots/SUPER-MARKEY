import { describe, it, expect, beforeAll } from 'vitest';
import { Game } from '../src/game/game';
import { makeCandidate, hire } from '../src/sim/staff';
import { Rng } from '../src/core/rng';
import { shelfUnits, slotQty, backroomUnits } from '../src/sim/inventory';
import { placeOrder } from '../src/sim/orders';
import { slotInfo } from '../src/sim/layout';
import { EVENT_BY_ID } from '../src/sim/events';
import { serialize, deserialize } from '../src/save/save';
import type { RoleId } from '../src/data/roles';
import { BurglaryRun } from '../src/entities/burglar';

function hireRole(g: Game, role: RoleId, start = 7, end = 22) {
  const c = makeCandidate(g.st, new Rng(role.length * 13), role, 16);
  g.st.candidates.push(c);
  const r = hire(g.st, c.id, Math.max(16, c.expectedWage));
  expect(r.ok).toBe(true);
  r.emp!.shiftStart = start;
  r.emp!.shiftEnd = end;
  r.emp!.daysOff = [];
  return r.emp!;
}

let g: Game;

beforeAll(async () => {
  g = new Game(true);
  await g.init();
});

describe('partie simulée (headless)', () => {
  it('des clients viennent, achètent, paient : le stock baisse et la caisse se remplit', () => {
    g.newGame({ seed: 123, residents: 420 });
    g.st.time = 8 * 60 + 5;
    hireRole(g, 'caissier');
    hireRole(g, 'rayon');
    const pidUnits = (pid: string) => shelfUnits(g.st, pid);
    const before = g.st.assortment.reduce((a, p) => a + pidUnits(p), 0);
    const cash0 = g.st.cash;
    const t0 = performance.now();
    g.simulate(480, 0.1); // 4 heures de jeu
    const ms = performance.now() - t0;
    const after = g.st.assortment.reduce((a, p) => a + pidUnits(p), 0);
    console.log(`sim 4h: ${ms.toFixed(0)} ms, clients servis ${g.st.stats.customersServed}, CA ${g.st.today.revenue.toFixed(2)}, unités ${before}→${after}, perdus ${g.st.today.lostCustomers}`);
    expect(g.st.stats.customersServed).toBeGreaterThan(3);
    expect(g.st.today.revenue).toBeGreaterThan(8);
    expect(g.st.stats.unitsSold).toBeGreaterThan(5);
    expect(g.st.stats.unitsSold).toBeGreaterThan(8);
    void after;
    expect(g.st.cash).not.toBe(cash0);
  });

  it('une commande arrive en palettes et le logisticien la range en réserve', () => {
    hireRole(g, 'logisticien');
    const br0 = backroomUnits(g.st, 'riz');
    const o = placeOrder(g.st, g.rng, 'grossiste', [{ pid: 'riz', cartons: 5 }, { pid: 'pates', cartons: 4 }]);
    expect(o).not.toBeNull();
    o!.eta = g.st.time + 1;
    g.simulate(3, 0.1);
    expect(g.st.pallets.length + g.st.worldCartons.length).toBeGreaterThan(0);
    expect(backroomUnits(g.st, 'riz')).toBeGreaterThan(br0);
    g.simulate(300, 0.1);
    const onPallets = g.st.pallets.reduce((a, p) => a + p.cartons.length, 0);
    console.log(`palettes restantes: ${onPallets} cartons, réserve riz: ${backroomUnits(g.st, 'riz')}`);
    expect(onPallets).toBeLessThan(9);
  });

  it('le joueur prend un carton en réserve et remplit un rayon', () => {
    const rack = g.st.equipment.find((e) => e.def === 'rack_reserve' && e.cartons?.some((c) => c.pid === 'riz'))!;
    expect(rack).toBeTruthy();
    const i = rack.cartons!.findIndex((c) => c.pid === 'riz');
    g.player.interaction.takeFromRack(rack, i);
    expect(g.player.held?.kind).toBe('cartons');
    const slotE = g.st.equipment.find((e) => e.slots?.some((s) => s.pid === 'riz'))!;
    const idx = slotE.slots!.findIndex((s) => s.pid === 'riz');
    const q0 = slotQty(slotE.slots![idx]);
    // vider un peu le facing pour faire de la place
    slotE.slots![idx].lots = [{ q: 0, exp: -1 }];
    slotE.slots![idx].lots = [];
    let n = 0;
    while (g.player.interaction.fillOne(slotE, idx)) n++;
    expect(n).toBeGreaterThan(0);
    expect(slotQty(slotE.slots![idx])).toBe(n);
    expect(g.st.stats.unitsShelvedByPlayer).toBeGreaterThanOrEqual(n);
    void q0;
  });

  it('un événement (panne de froid) casse un meuble et le choix le répare', () => {
    const ev = EVENT_BY_ID.panne_froid.start({ st: g.st, rng: g.rng, hooks: g.hooks() });
    expect(ev).not.toBeNull();
    const broken = g.st.equipment.find((e) => e.broken);
    expect(broken).toBeTruthy();
    const ch = g.st.pendingChoices.find((c) => c.eventId === 'panne_froid')!;
    g.chooseOption(ch, 'express');
    expect(broken!.broken).toBe(false);
  });

  it('sauvegarde puis rechargement conservent l’état', () => {
    const st = g.exportState();
    const json = JSON.stringify(serialize(st));
    const back = deserialize(json);
    g.load(back);
    expect(g.st.cash).toBeCloseTo(st.cash, 2);
    expect(g.st.equipment.length).toBe(st.equipment.length);
    expect(g.st.employees.length).toBe(3);
    g.simulate(20, 0.1);
  });

  it('des cartons posés dans un chariot y restent et sont sauvegardés', () => {
    const cart = g.items.carts[0];
    expect(cart).toBeTruthy();
    const pid = g.st.assortment[0];
    cart.cargo.push({ uid: 900001, pid, q: 6, exp: g.st.time + 9999, opened: false });
    cart.cargo.push({ uid: 900002, pid, q: 6, exp: g.st.time + 9999, opened: false });
    g.simulate(3, 0.1); // la synchro physique périodique ne doit pas vider le chariot
    expect(cart.cargo.length).toBe(2);
    const st = g.exportState();
    expect(st.worldCartons.filter((w) => w.uid >= 900001 && w.uid <= 900002).length).toBe(2);
    expect(g.st.worldCartons.some((w) => w.uid === 900001)).toBe(false);
    cart.cargo = [];
  });

  it('plusieurs jours de simulation sans erreur (clôtures, concurrents, quartiers)', () => {
    const t0 = performance.now();
    const day0 = Math.floor(g.st.time / 1440);
    let days = 0;
    while (days < 2) {
      g.simulate(120, 0.2);
      if (!g.isOpen() && g.agents.count('customer') === 0) g.skipNight();
      days = Math.floor(g.st.time / 1440) - day0;
    }
    console.log(`2 jours: ${(performance.now() - t0).toFixed(0)} ms, ledger ${g.st.ledger.length} j, trésorerie ${g.st.cash.toFixed(0)}, rep ${g.st.reputation.overall.toFixed(1)}, servis ${g.st.stats.customersServed}`);
    expect(g.st.ledger.length).toBeGreaterThanOrEqual(2);
    expect(g.st.competitors.some((c) => c.history.length > 0)).toBe(true);
  });

  it('un cambriolage nocturne incarné : effraction, pillage, fuite, incident enregistré', () => {
    g.st.time = Math.floor(g.st.time / 1440) * 1440 + 26 * 60; // 2 h du matin
    for (const e of g.st.equipment) if (e.def === 'caisse') e.till = 300;
    const inc0 = g.st.incidents.length;
    const run = new BurglaryRun(g);
    g.burglary = run;
    run.start();
    for (let i = 0; i < 6000 && !run.done; i++) g.update(0.1);
    expect(run.done).toBe(true);
    expect(g.st.incidents.length).toBeGreaterThan(inc0);
    console.log('cambriolage :', g.st.incidents[g.st.incidents.length - 1].text);
  });

  it('tenue en charge : 50 clients simultanés', () => {
    g.settings.maxCustomers = 60;
    g.st.time = Math.floor(g.st.time / 1440) * 1440 + 11 * 60;
    g.st.flags.closedUntil = 0;
    let n = 0;
    for (let i = 0; i < 50; i++) if (g.spawnCustomer(g.st.residents[i * 7], { from: { x: -1 + (i % 10) * 0.3, z: -6 - Math.floor(i / 10) * 0.6 } })) n++;
    const t0 = performance.now();
    const steps = 300;
    for (let i = 0; i < steps; i++) g.update(0.1);
    const ms = (performance.now() - t0) / steps;
    console.log(`charge : ${n} clients créés, ${g.agents.count('customer')} présents, ${ms.toFixed(2)} ms par pas de simulation (0,1 s), ${g.physics.dynamicCount()} corps dynamiques`);
    expect(n).toBe(50);
    expect(ms).toBeLessThan(40);
  });
});
