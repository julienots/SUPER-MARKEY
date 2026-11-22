import { describe, expect, it } from 'vitest';
import { createWorld, Sim, levelCap, OPEN_MIN, CLOSE_MIN, cartonsUsed, reserveCapacity, contextFor, shelfStock, MIN_PER_SEC } from '../src/sim/sim';
import { canPlace, accessCells, NavGrid, zoneOf, DOCK, checkoutSpots } from '../src/sim/grid';
import { FURN_BY_ID } from '../src/data/furniture';
import { serialize, deserialize } from '../src/sim/save';

const run = (sim: Sim, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) sim.step(0.1);
};
const DAY = Math.ceil((CLOSE_MIN - OPEN_MIN + 100) / MIN_PER_SEC);

describe('simulation', () => {
  it('le magasin de départ est valide : réserve dans la pièce du fond, tout accessible', () => {
    const w = createWorld();
    const nav = new NavGrid();
    nav.build(w);
    const seen = nav.reachable();
    for (const f of w.furn) {
      expect(canPlace(w, f.def, f.x, f.z, f.rot, f.id).ok, f.def).toBe(true);
      const acc = accessCells(f);
      if (acc.length) expect(acc.some((c) => seen[nav.idx(c.x, c.z)]), f.def).toBe(true);
    }
    const rack = w.furn.find((f) => f.def === 'rack_reserve')!;
    expect(zoneOf(w, rack.x, rack.z)).toBe(2);
    // un rack ne se pose pas dans le magasin, un rayon pas dans la réserve
    expect(canPlace(w, 'rack_reserve', 0, -4, 1).ok).toBe(false);
    expect(canPlace(w, 'gondole_simple', 6, -11, 0).ok).toBe(false);
  });

  it('une journée calme : peu de monde au début, presque tout le monde servi', () => {
    const sim = new Sim(createWorld(), 7);
    sim.addPlayer('host', 'Patron');
    let maxInside = 0;
    for (let i = 0; i < DAY * 10 && sim.w.day === 1; i++) {
      sim.step(0.1);
      maxInside = Math.max(maxInside, sim.views().filter((a) => a.kind === 'customer').length);
    }
    const st = sim.w.lastDay!;
    expect(st, 'la journée se termine').toBeTruthy();
    expect(maxInside).toBeLessThanOrEqual(4);
    expect(st.customers).toBeGreaterThan(15);
    expect(st.customers).toBeLessThan(80);
    expect(st.served).toBeGreaterThan(st.customers * 0.7);
    expect(st.revenue).toBeGreaterThan(30);
  });

  it('commande → cartons devant la porte → rangés en réserve', () => {
    const sim = new Sim(createWorld(), 3);
    sim.addPlayer('host', 'Patron');
    sim.w.autoOrder = false;
    sim.w.min = OPEN_MIN - 200; // fermé : pas de clients
    const before = sim.w.reserve.eau ?? 0;
    expect(sim.apply('host', { t: 'order', items: { eau: 2 } })).toBe(true);
    run(sim, 35);
    expect(sim.w.deliveries.length).toBe(0);
    // le perso range les cartons tout seul
    run(sim, 60);
    expect(sim.w.dock.length).toBe(0);
    expect(sim.w.reserve.eau + sim.w.furn.reduce((n, f) => n + f.prod.reduce((m, p, i) => m + (p === 'eau' ? f.stock[i] : 0), 0), 0)).toBeGreaterThanOrEqual(before + 24);
  });

  it('les étages se remplissent depuis la réserve, article par article', () => {
    const sim = new Sim(createWorld(), 5);
    sim.addPlayer('host', 'Patron');
    sim.w.min = OPEN_MIN - 200;
    const f = sim.w.furn.find((g) => g.prod.includes('cola'))!;
    const lv = f.prod.indexOf('cola');
    f.stock[lv] = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      sim.step(0.1);
      seen.add(f.stock[lv]);
    }
    expect(f.stock[lv]).toBe(levelCap(FURN_BY_ID[f.def]));
    expect(seen.size).toBeGreaterThan(3); // on voit le rayon se remplir progressivement
  });

  it('chaque étage a son produit', () => {
    const sim = new Sim(createWorld(), 1);
    const f = sim.w.furn.find((g) => g.def === 'gondole_simple')!;
    expect(sim.apply('host', { t: 'product', id: f.id, level: 4, pid: 'chips' })).toBe(true);
    expect(f.prod[4]).toBe('chips');
    expect(f.stock[4]).toBe(0);
    expect(sim.apply('host', { t: 'product', id: f.id, level: 2, pid: 'lait' })).toBe(false); // frais : pas sur une étagère
  });

  it('construction : emprise, portes et accessibilité', () => {
    const sim = new Sim(createWorld(), 1);
    const w = sim.w;
    expect(canPlace(w, 'gondole_simple', 3, -1, 0).ok).toBe(false); // devant l'entrée
    expect(canPlace(w, 'gondole_simple', 1, -8, 0).ok).toBe(false); // devant la porte de la réserve
    expect(canPlace(w, 'gondole_simple', 9, -7, 0).ok).toBe(false); // déborde
    const money = w.money;
    expect(sim.apply('host', { t: 'build', def: 'gondole_double', x: 0, z: -4, rot: 1 })).toBe(true);
    expect(w.money).toBe(money - FURN_BY_ID.gondole_double.price);
    const nf = w.furn[w.furn.length - 1];
    expect(nf.prod.every(Boolean)).toBe(true);
    expect(sim.apply('host', { t: 'sell', id: nf.id })).toBe(true);
    const co = w.furn.find((g) => g.def === 'caisse')!;
    expect(sim.apply('host', { t: 'sell', id: co.id })).toBe(false);
    expect(sim.apply('host', { t: 'build', def: 'rack_reserve', x: 0, z: -11, rot: 0 })).toBe(true);
  });

  it('niveau supérieur et agrandissement : la réserve recule avec le fond', () => {
    const sim = new Sim(createWorld(), 2);
    sim.w.xp = 149;
    (sim as any).gainXp(5);
    expect(sim.w.level).toBe(2);
    sim.w.money = 10000;
    expect(sim.apply('host', { t: 'expand' })).toBe(true);
    expect(sim.w.sizeIdx).toBe(1);
    const rack = sim.w.furn.find((f) => f.def === 'rack_reserve')!;
    expect(zoneOf(sim.w, rack.x, rack.z)).toBe(2);
    for (const f of sim.w.furn) expect(canPlace(sim.w, f.def, f.x, f.z, f.rot, f.id).ok, f.def).toBe(true);
  });

  it('deux joueurs : chacun son perso, reconnexion sans doublon', () => {
    const sim = new Sim(createWorld(), 9);
    sim.addPlayer('host', 'Alice');
    sim.addPlayer('p-bob', 'Bob');
    sim.addPlayer('p-bob', 'Bob'); // reconnexion
    expect(sim.views().filter((a) => a.kind === 'player').length).toBe(2);
    expect(sim.w.players.length).toBe(2);
    sim.removePlayer('p-bob');
    sim.addPlayer('p-bob', 'Bob');
    expect(sim.views().filter((a) => a.kind === 'player').length).toBe(2);
  });

  it('on dirige son perso au joystick, il ne traverse pas les murs', () => {
    const sim = new Sim(createWorld(), 4);
    sim.addPlayer('host', 'Alice');
    sim.w.min = OPEN_MIN - 200;
    const me = () => sim.views().find((a) => a.pid === 'host')!;
    const x0 = me().x;
    for (let i = 0; i < 10; i++) {
      sim.apply('host', { t: 'steer', dx: -1, dz: 0 });
      sim.step(0.1);
    }
    expect(me().x).toBeLessThan(x0 - 1);
    // contre le mur de gauche pendant longtemps : il reste dans le magasin
    for (let i = 0; i < 60; i++) {
      sim.apply('host', { t: 'steer', dx: -1, dz: 0 });
      sim.step(0.1);
    }
    expect(me().x).toBeGreaterThanOrEqual(0);
    sim.apply('host', { t: 'steer', dx: 0, dz: 0 });
    sim.step(0.1);
    expect(me().anim).toBe('idle');
  });

  it('à la main : prendre un carton livré, le ranger, remplir un rayon, tenir la caisse', () => {
    const sim = new Sim(createWorld(), 6);
    sim.addPlayer('host', 'Alice');
    sim.apply('host', { t: 'auto', on: false });
    sim.w.min = OPEN_MIN - 200;
    const a = (sim as any).avatar('host');
    sim.w.dock.push({ pid: 'chips', n: 12 });
    a.x = DOCK.x;
    a.z = DOCK.z;
    expect(contextFor(sim.w, a.x, a.z, a.carry)?.k).toBe('dockTake');
    expect(sim.apply('host', { t: 'use' })).toBe(true);
    expect(a.carry).toBe('chips');
    // dans la réserve : ranger
    const rack = sim.w.furn.find((f) => f.def === 'rack_reserve')!;
    a.x = rack.x + 1;
    a.z = rack.z + 1.5;
    expect(contextFor(sim.w, a.x, a.z, a.carry)?.k).toBe('rackDrop');
    const r0 = sim.w.reserve.chips;
    sim.apply('host', { t: 'use' });
    expect(sim.w.reserve.chips).toBe(r0 + 12);
    // reprendre un carton et remplir le rayon de chips
    sim.apply('host', { t: 'use', pid: 'chips' });
    expect(a.carry).toBe('chips');
    const shelf = sim.w.furn.find((f) => f.def === 'gondole_simple' && f.prod.includes('chips'))!;
    const before = shelfStock(shelf);
    a.x = shelf.x + 1;
    a.z = shelf.z + 1.5;
    expect(contextFor(sim.w, a.x, a.z, a.carry)?.k).toBe('shelfFill');
    sim.apply('host', { t: 'use' });
    run(sim, 3);
    expect(shelfStock(shelf)).toBeGreaterThan(before);
    // derrière la caisse : on encaisse automatiquement
    const co = sim.w.furn.find((f) => f.def === 'caisse')!;
    const sp = checkoutSpots(co).cashier!;
    a.carry = null;
    a.x = sp.x;
    a.z = sp.z;
    sim.step(0.1);
    expect(sim.taskOf('host')).toBe('cash!');
  });

  it('embauche et plusieurs jours sans erreur', () => {
    const sim = new Sim(createWorld(), 11);
    sim.addPlayer('host', 'Patron');
    sim.w.money = 5000;
    sim.w.level = 3;
    expect(sim.apply('host', { t: 'hire', role: 'caissier' })).toBe(true);
    expect(sim.apply('host', { t: 'hire', role: 'rayon' })).toBe(true);
    run(sim, 3 * DAY);
    expect(sim.w.day).toBeGreaterThanOrEqual(3);
    expect(cartonsUsed(sim.w)).toBeLessThanOrEqual(reserveCapacity(sim.w) + 2);
    for (const f of sim.w.furn) f.stock.forEach((n) => expect(n).toBeLessThanOrEqual(levelCap(FURN_BY_ID[f.def])));
    expect(Number.isFinite(sim.w.money)).toBe(true);
  });

  it('sauvegarde → chargement, et reprise d’une ancienne sauvegarde (v2)', () => {
    const sim = new Sim(createWorld('Chez Nous'), 4);
    run(sim, 60);
    const w2 = deserialize(serialize(sim.w));
    expect(w2.name).toBe('Chez Nous');
    expect(w2.furn.length).toBe(sim.w.furn.length);
    expect(() => deserialize('{"v":1}')).toThrow();
    const old = {
      v: 2, rev: 1, name: 'Vieux', day: 3, min: 600, clock: 0, money: 900, xp: 10, level: 1, sizeIdx: 0, nextId: 9,
      furn: [
        { id: 1, def: 'rack_reserve', x: 0, z: -8, rot: 0, product: null, stock: 0 },
        { id: 2, def: 'gondole_simple', x: 3, z: -7, rot: 0, product: 'cola', stock: 18 },
        { id: 3, def: 'caisse', x: 7, z: -4, rot: 1, product: null, stock: 0 },
      ],
      reserve: { cola: 10 }, deliveries: [], staff: [], players: [], autoOrder: true, speed: 1, ratings: [], today: {}, lastDay: null,
    };
    const w3 = deserialize(JSON.stringify(old));
    expect(w3.v).toBe(3);
    const rack = w3.furn.find((f) => f.def === 'rack_reserve')!;
    expect(zoneOf(w3, rack.x, rack.z)).toBe(2);
    const g = w3.furn.find((f) => f.def === 'gondole_simple')!;
    expect(g.prod.every((p) => p === 'cola')).toBe(true);
    expect(shelfStock(g)).toBe(18);
    expect(() => new Sim(w3, 1).step(0.1)).not.toThrow();
  });
});

describe('robustesse', () => {
  it('actions au hasard de deux joueurs pendant 4 jours : aucune erreur, état cohérent', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new Sim(createWorld(), seed);
      sim.addPlayer('host', 'A');
      sim.addPlayer('p-b', 'B');
      sim.w.money = 50000;
      sim.w.level = 8;
      let r = seed * 7919;
      const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
      const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
      const defs = Object.keys(FURN_BY_ID);
      for (let t = 0; t < 4 * DAY * 10; t++) {
        if (t % 20 === 0) {
          const who = rnd() < 0.5 ? 'host' : 'p-b';
          const f = sim.w.furn.length ? pick(sim.w.furn) : null;
          const k = Math.floor(rnd() * 16);
          const x = Math.floor(rnd() * 22) - 1;
          const z = -Math.floor(rnd() * 19);
          const rot = Math.floor(rnd() * 4);
          if (k === 0) sim.apply(who, { t: 'build', def: pick(defs), x, z, rot });
          else if (k === 1 && f) sim.apply(who, { t: 'move', id: f.id, x, z, rot });
          else if (k === 2 && f && rnd() < 0.3) sim.apply(who, { t: 'sell', id: f.id });
          else if (k === 3 && f) sim.apply(who, { t: 'product', id: f.id, level: Math.floor(rnd() * 5), pid: pick(['cola', 'chips', 'lait', 'pommes', 'baguette', 'glace', null as any]) });
          else if (k === 4 && f) sim.apply(who, { t: 'fill', id: f.id });
          else if (k === 5 && f) sim.apply(who, { t: 'cash', id: f.id });
          else if (k === 6) sim.apply(who, { t: 'goto', x: x + 0.5, z: z + 0.5 });
          else if (k === 7) sim.apply(who, { t: 'order', items: { [pick(['cola', 'eau', 'lait', 'pommes'])]: 1 + Math.floor(rnd() * 3) } });
          else if (k === 8) sim.apply(who, { t: 'hire', role: rnd() < 0.5 ? 'caissier' : 'rayon' });
          else if (k === 9 && sim.w.staff.length && rnd() < 0.3) sim.apply(who, { t: 'fire', id: pick(sim.w.staff).id });
          else if (k === 10 && rnd() < 0.05) sim.apply(who, { t: 'expand' });
          else if (k === 11 && rnd() < 0.05) sim.addPlayer('p-b', 'B');
          else if (k === 12) sim.apply(who, { t: 'steer', dx: rnd() * 2 - 1, dz: rnd() * 2 - 1 });
          else if (k === 13) sim.apply(who, { t: 'use', pid: pick(['cola', 'chips', 'eau']) });
          else if (k === 14) sim.apply(who, { t: 'haul' });
          else if (k === 15) sim.apply(who, { t: 'auto', on: rnd() < 0.5 });
        }
        sim.step(0.1);
      }
      sim.drainFx();
      expect(sim.w.day).toBeGreaterThanOrEqual(4);
      for (const f of sim.w.furn) {
        f.stock.forEach((n) => {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(levelCap(FURN_BY_ID[f.def]));
        });
        expect(canPlace(sim.w, f.def, f.x, f.z, f.rot, f.id).ok || FURN_BY_ID[f.def].walkable, `${f.def} toujours valide`).toBe(true);
      }
      for (const v of Object.values(sim.w.reserve)) expect(v).toBeGreaterThanOrEqual(0);
      for (const a of sim.views()) expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true);
      expect(sim.views().filter((a) => a.kind === 'player').length).toBe(2);
      expect(sim.views().filter((a) => a.kind === 'customer').length).toBeLessThanOrEqual(18);
      expect(sim.w.furn.some((f) => FURN_BY_ID[f.def].kind === 'checkout')).toBe(true);
      expect(Number.isFinite(sim.w.money)).toBe(true);
    }
  });

  it('le magasin se vide chaque soir', () => {
    const sim = new Sim(createWorld(), 21);
    sim.addPlayer('host', 'A');
    let steps = 0;
    while (sim.w.day < 4 && steps < 3 * DAY * 12) {
      sim.step(0.1);
      steps++;
    }
    expect(sim.w.day).toBe(4);
    expect(sim.w.lastDay!.served).toBeGreaterThan(sim.w.lastDay!.customers * 0.7);
  });
});
