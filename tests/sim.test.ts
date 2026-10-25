import { describe, it, expect, beforeAll } from 'vitest';
import { createNewGame } from '../src/sim/newgame';
import { addToSlot, slotQty, takeFromSlot, shelfUnits, backroomUnits, storeCarton, newCarton } from '../src/sim/inventory';
import { computeTicket, shelfPrice } from '../src/sim/pricing';
import { canPlace, placeEquipment } from '../src/sim/build';
import { coverageGrid } from '../src/sim/security';
import { placeOrder, quote } from '../src/sim/orders';
import { closeDay } from '../src/sim/economy';
import { Rng } from '../src/core/rng';
import { NavGrid } from '../src/sim/nav';
import { serialize, deserialize } from '../src/save/save';
import { makeCandidate, hire } from '../src/sim/staff';

describe('nouvelle partie', () => {
  it('place tout le plan de départ et remplit les rayons', () => {
    const st = createNewGame({ seed: 42, residents: 50 });
    expect(st.equipment.length).toBe(16);
    const shelves = st.equipment.filter((e) => e.slots);
    const units = shelves.reduce((a, e) => a + e.slots!.reduce((b, s) => b + slotQty(s), 0), 0);
    expect(units).toBeGreaterThan(200);
    expect(st.residents.length).toBe(50);
    expect(st.cash).toBe(12000);
  });
});

describe('stock réel', () => {
  it('prendre un article fait baisser le stock du facing', () => {
    const st = createNewGame({ seed: 1, residents: 5 });
    const e = st.equipment.find((x) => x.slots?.some((s) => slotQty(s) > 2))!;
    const idx = e.slots!.findIndex((s) => slotQty(s) > 2);
    const before = slotQty(e.slots![idx]);
    const pid = e.slots![idx].pid!;
    const totalBefore = shelfUnits(st, pid);
    expect(takeFromSlot(e, idx)).not.toBeNull();
    expect(slotQty(e.slots![idx])).toBe(before - 1);
    expect(shelfUnits(st, pid)).toBe(totalBefore - 1);
    expect(addToSlot(e, idx, pid, 1, -1)).toBe(1);
  });

  it('la capacité d’un facing est respectée', () => {
    const st = createNewGame({ seed: 2, residents: 5 });
    const e = st.equipment.find((x) => x.def === 'gondole_simple')!;
    const idx = 0;
    const pid = e.slots![idx].pid!;
    const added = addToSlot(e, idx, pid, 10000, -1);
    expect(added).toBeGreaterThanOrEqual(0);
    expect(addToSlot(e, idx, pid, 1, -1)).toBe(0);
  });

  it('les cartons vont en réserve et sont comptés', () => {
    const st = createNewGame({ seed: 3, residents: 5 });
    const before = backroomUnits(st, 'pates');
    expect(storeCarton(st, newCarton(st, 'pates'))).not.toBeNull();
    expect(backroomUnits(st, 'pates')).toBe(before + 20);
  });
});

describe('caisse', () => {
  it('ticket exact avec promo 3 pour 2 et pourcentage', () => {
    const st = createNewGame({ seed: 4, residents: 5 });
    st.prices.pates = 1.0;
    st.prices.cola = 2.0;
    st.promos.push({ id: 1, kind: 'lot3x2', pids: ['pates'], value: 0, start: 0, end: 10, name: 't', advertised: false });
    st.promos.push({ id: 2, kind: 'percent', pids: ['cola'], value: 0.25, start: 0, end: 10, name: 't', advertised: false });
    const t = computeTicket(st, [{ pid: 'pates', exp: -1 }, { pid: 'pates', exp: -1 }, { pid: 'pates', exp: -1 }, { pid: 'cola', exp: -1 }], false);
    expect(t.total).toBeCloseTo(2 + 1.5, 2);
    expect(shelfPrice(st, 'cola')).toBeCloseTo(1.5, 2);
  });
});

describe('construction', () => {
  it('refuse un meuble qui chevauche, accepte un emplacement libre', () => {
    const st = createNewGame({ seed: 5, residents: 5 });
    const g = st.equipment.find((x) => x.def === 'gondole_double')!;
    expect(canPlace(st, 'gondole_double', g.gx, g.gz, g.rot).ok).toBe(false);
    const cam = placeEquipment(st, 'camera', 2, 2, 0);
    expect(cam.ok).toBe(true);
    expect(canPlace(st, 'rack_reserve', 2, 2, 0).ok).toBe(false); // zone réserve uniquement
  });

  it('une caméra couvre réellement une zone, avec des angles morts', () => {
    const st = createNewGame({ seed: 6, residents: 5 });
    expect(coverageGrid(st).covered).toBe(0);
    placeEquipment(st, 'camera', 2, 2, 0);
    const cov = coverageGrid(st);
    expect(cov.covered).toBeGreaterThan(20);
    expect(cov.covered).toBeLessThan(cov.total);
  });
});

describe('fournisseurs & compta', () => {
  it('commande payée et clôture de journée', () => {
    const st = createNewGame({ seed: 7, residents: 5 });
    const rng = new Rng(7);
    const q = quote(st, 'grossiste', [{ pid: 'pates', cartons: 6 }]);
    expect(q.ok).toBe(true);
    const cash = st.cash;
    const o = placeOrder(st, rng, 'grossiste', [{ pid: 'pates', cartons: 6 }]);
    expect(o).not.toBeNull();
    expect(st.cash).toBeCloseTo(cash - q.total, 2);
    const rep = closeDay(st);
    expect(rep.expenses).toBeGreaterThan(0);
    expect(st.ledger.length).toBe(1);
  });
});

describe('recrutement', () => {
  it('embauche avec un salaire suffisant', () => {
    const st = createNewGame({ seed: 8, residents: 5 });
    const c = makeCandidate(st, new Rng(1), 'caissier', 14);
    st.candidates.push(c);
    const r = hire(st, c.id, c.expectedWage);
    expect(r.ok).toBe(true);
    expect(st.employees.length).toBe(1);
  });
});

describe('navigation', () => {
  it('A* trouve un chemin autour d’un obstacle', () => {
    const n = new NavGrid();
    n.fillRect(-5, -5, 5, 5, 1, 0, 'set');
    n.fillRect(-1, -4, 1, 4, 0, 0, 'set');
    const p = n.findPath(-3, 0, 3, 0);
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThan(2);
  });
});

describe('sauvegarde', () => {
  it('aller-retour JSON sans perte', () => {
    const st = createNewGame({ seed: 9, residents: 20 });
    const back = deserialize(JSON.stringify(serialize(st)));
    expect(back.equipment.length).toBe(st.equipment.length);
    expect(back.cash).toBe(st.cash);
    expect(back.residents.length).toBe(20);
  });
  it('migre une sauvegarde v1', () => {
    const st: any = structuredClone(createNewGame({ seed: 10, residents: 5 }));
    st.version = 1;
    delete st.quartiers;
    delete st.today.expenses.pertes;
    const back = deserialize(JSON.stringify(st));
    expect(back.version).toBe(3);
    expect(back.quartiers.length).toBe(4);
  });
});
