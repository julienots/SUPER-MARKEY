import { describe, expect, it } from 'vitest';
import { createWorld, Sim, shelfCap, OPEN_MIN, cartonsUsed, reserveCapacity } from '../src/sim/sim';
import { canPlace, accessCells, NavGrid } from '../src/sim/grid';
import { FURN_BY_ID } from '../src/data/furniture';
import { serialize, deserialize } from '../src/sim/save';

const run = (sim: Sim, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) sim.step(0.1);
};

describe('simulation', () => {
  it('le magasin de départ est valide et accessible', () => {
    const w = createWorld();
    const nav = new NavGrid();
    nav.build(w);
    const seen = nav.reachable();
    for (const f of w.furn) {
      const acc = accessCells(f);
      if (!acc.length) continue;
      expect(acc.some((c) => seen[nav.idx(c.x, c.z)]), f.def).toBe(true);
    }
  });

  it('une journée : des clients achètent, le patron encaisse, rien ne bloque', () => {
    const sim = new Sim(createWorld(), 7);
    sim.addPlayer('host', 'Patron');
    const money0 = sim.w.money;
    run(sim, 6 * 60 + 40);
    const fx = sim.drainFx();
    const day = fx.find((f) => f.k === 'day');
    expect(day, 'la journée se termine').toBeTruthy();
    const st = sim.w.lastDay!;
    expect(st.customers).toBeGreaterThan(20);
    expect(st.served).toBeGreaterThan(st.customers * 0.6);
    expect(st.revenue).toBeGreaterThan(50);
    expect(sim.w.day).toBe(2);
    expect(sim.w.xp).toBeGreaterThan(20);
    void money0;
  });

  it('commande → livraison en réserve', () => {
    const sim = new Sim(createWorld(), 3);
    sim.w.autoOrder = false;
    const before = sim.w.reserve.eau ?? 0;
    expect(sim.apply('host', { t: 'order', items: { eau: 2 } })).toBe(true);
    expect(sim.w.deliveries.length).toBe(1);
    run(sim, 30);
    expect(sim.w.deliveries.length).toBe(0);
    expect(sim.w.reserve.eau).toBe(before + 2 * 12 * 1);
  });

  it('les rayons se remplissent depuis la réserve', () => {
    const sim = new Sim(createWorld(), 5);
    sim.addPlayer('host', 'Patron');
    sim.w.min = OPEN_MIN - 30; // magasin fermé : pas de clients
    const f = sim.w.furn.find((g) => g.product === 'cola')!;
    f.stock = 0;
    run(sim, 25);
    expect(f.stock).toBeGreaterThan(0);
  });

  it('construction : emprise, porte et accessibilité', () => {
    const sim = new Sim(createWorld(), 1);
    const w = sim.w;
    expect(canPlace(w, 'gondole_simple', 3, -1, 0).ok).toBe(false); // devant la porte
    expect(canPlace(w, 'gondole_simple', 9, -8, 0).ok).toBe(false); // déborde
    expect(canPlace(w, 'gondole_simple', 3, -8, 0).ok).toBe(false); // déjà occupé
    const money = w.money;
    expect(sim.apply('host', { t: 'build', def: 'gondole_double', x: 0, z: -4, rot: 1 })).toBe(true);
    expect(w.money).toBe(money - FURN_BY_ID.gondole_double.price);
    const nf = w.furn[w.furn.length - 1];
    expect(nf.product).toBeTruthy();
    expect(sim.apply('host', { t: 'sell', id: nf.id })).toBe(true);
    // on ne vend pas la dernière caisse
    const co = w.furn.find((g) => g.def === 'caisse')!;
    expect(sim.apply('host', { t: 'sell', id: co.id })).toBe(false);
  });

  it('niveau supérieur et agrandissement', () => {
    const sim = new Sim(createWorld(), 2);
    sim.w.xp = 149;
    (sim as any).gainXp(5);
    expect(sim.w.level).toBe(2);
    sim.w.money = 10000;
    expect(sim.apply('host', { t: 'expand' })).toBe(true);
    expect(sim.w.sizeIdx).toBe(1);
  });

  it('deux joueurs : chacun a son avatar et peut agir', () => {
    const sim = new Sim(createWorld(), 9);
    sim.addPlayer('host', 'Alice');
    sim.addPlayer('guest', 'Bob');
    expect(sim.views().filter((a) => a.kind === 'player').length).toBe(2);
    const shelf = sim.w.furn.find((g) => g.product === 'chips')!;
    shelf.stock = 2;
    expect(sim.apply('guest', { t: 'fill', id: shelf.id })).toBe(true);
    run(sim, 20);
    expect(shelf.stock).toBeGreaterThan(2);
    sim.removePlayer('guest');
    expect(sim.views().filter((a) => a.kind === 'player').length).toBe(1);
  });

  it('embauche et plusieurs jours sans erreur', () => {
    const sim = new Sim(createWorld(), 11);
    sim.addPlayer('host', 'Patron');
    sim.w.money = 5000;
    sim.w.level = 3;
    expect(sim.apply('host', { t: 'hire', role: 'caissier' })).toBe(true);
    expect(sim.apply('host', { t: 'hire', role: 'rayon' })).toBe(true);
    run(sim, 3 * 380);
    expect(sim.w.day).toBeGreaterThanOrEqual(3);
    expect(cartonsUsed(sim.w)).toBeLessThanOrEqual(reserveCapacity(sim.w) + 2);
    for (const f of sim.w.furn) if (f.product) expect(f.stock).toBeLessThanOrEqual(shelfCap(FURN_BY_ID[f.def]));
    expect(Number.isFinite(sim.w.money)).toBe(true);
  });

  it('sauvegarde → chargement', () => {
    const sim = new Sim(createWorld('Chez Nous'), 4);
    run(sim, 60);
    const json = serialize(sim.w);
    const w2 = deserialize(json);
    expect(w2.name).toBe('Chez Nous');
    expect(w2.furn.length).toBe(sim.w.furn.length);
    expect(() => deserialize('{"v":1}')).toThrow();
  });
});

describe('robustesse', () => {
  it('actions au hasard pendant 4 jours : aucune erreur, état cohérent', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new Sim(createWorld(), seed);
      sim.addPlayer('host', 'A');
      sim.addPlayer('guest', 'B');
      sim.w.money = 50000;
      sim.w.level = 8;
      let r = seed * 7919;
      const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
      const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
      const defs = Object.keys(FURN_BY_ID);
      for (let t = 0; t < 4 * 3900; t++) {
        if (t % 25 === 0) {
          const who = rnd() < 0.5 ? 'host' : 'guest';
          const f = sim.w.furn.length ? pick(sim.w.furn) : null;
          const k = Math.floor(rnd() * 12);
          const x = Math.floor(rnd() * 22) - 1;
          const z = -Math.floor(rnd() * 15);
          const rot = Math.floor(rnd() * 4);
          if (k === 0) sim.apply(who, { t: 'build', def: pick(defs), x, z, rot });
          else if (k === 1 && f) sim.apply(who, { t: 'move', id: f.id, x, z, rot });
          else if (k === 2 && f && rnd() < 0.3) sim.apply(who, { t: 'sell', id: f.id });
          else if (k === 3 && f) sim.apply(who, { t: 'product', id: f.id, pid: pick(['cola', 'chips', 'lait', 'pommes', 'baguette', 'glace']) });
          else if (k === 4 && f) sim.apply(who, { t: 'fill', id: f.id });
          else if (k === 5 && f) sim.apply(who, { t: 'cash', id: f.id });
          else if (k === 6) sim.apply(who, { t: 'goto', x: x + 0.5, z: z + 0.5 });
          else if (k === 7) sim.apply(who, { t: 'order', items: { [pick(['cola', 'eau', 'lait', 'pommes'])]: 1 + Math.floor(rnd() * 3) } });
          else if (k === 8) sim.apply(who, { t: 'hire', role: rnd() < 0.5 ? 'caissier' : 'rayon' });
          else if (k === 9 && sim.w.staff.length && rnd() < 0.3) sim.apply(who, { t: 'fire', id: pick(sim.w.staff).id });
          else if (k === 10 && rnd() < 0.05) sim.apply(who, { t: 'expand' });
          else if (k === 11 && rnd() < 0.02) {
            sim.removePlayer('guest');
            sim.addPlayer('guest', 'B');
          }
        }
        sim.step(0.1);
      }
      sim.drainFx();
      expect(sim.w.day).toBeGreaterThanOrEqual(4);
      for (const f of sim.w.furn) {
        expect(f.stock).toBeGreaterThanOrEqual(0);
        expect(f.stock).toBeLessThanOrEqual(shelfCap(FURN_BY_ID[f.def]));
        expect(canPlace(sim.w, f.def, f.x, f.z, f.rot, f.id).ok || FURN_BY_ID[f.def].walkable, `${f.def} toujours valide`).toBe(true);
      }
      for (const v of Object.values(sim.w.reserve)) expect(v).toBeGreaterThanOrEqual(0);
      for (const a of sim.views()) {
        expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true);
      }
      expect(sim.views().filter((a) => a.kind === 'customer').length).toBeLessThan(40);
      expect(sim.w.furn.some((f) => FURN_BY_ID[f.def].kind === 'checkout')).toBe(true);
      expect(Number.isFinite(sim.w.money)).toBe(true);
    }
  });

  it('pas de client bloqué à jamais : le magasin se vide chaque soir', () => {
    const sim = new Sim(createWorld(), 21);
    sim.addPlayer('host', 'A');
    let steps = 0;
    while (sim.w.day < 4 && steps < 3 * 4600) {
      sim.step(0.1);
      steps++;
    }
    // une journée = 6 min 15 s de jeu à vitesse ×1, plus le temps que les derniers clients sortent
    expect(sim.w.day).toBe(4);
    expect(steps).toBeLessThan(3 * 4200);
    expect(sim.w.lastDay!.served).toBeGreaterThan(sim.w.lastDay!.customers * 0.7);
  });
});
