import { describe, it, expect, beforeAll } from 'vitest';
import { Game } from '../src/game/game';
import { createNewGame } from '../src/sim/newgame';
import { catUnlocked, checkLevelUp, equipUnlocked, levelOf, productUnlocked } from '../src/sim/progress';
import { fire, fireCost, hire, makeCandidate, renewCdd, staffMorning, toCdi } from '../src/sim/staff';
import { placeSimpleOrder, simpleQuote } from '../src/sim/orders';
import { backroomUnits } from '../src/sim/inventory';
import { Rng } from '../src/core/rng';
import { dayOf } from '../src/sim/state';

describe('départ « commerçant » et niveaux', () => {
  it('local presque nu, un rayon garni à moitié et quelques cartons (pas illimité)', () => {
    const st = createNewGame({ seed: 7, emptyStart: true, residents: 50 });
    const shelves = st.equipment.filter((e) => e.slots);
    expect(shelves.length).toBe(1);
    const units = shelves[0].slots!.reduce((a, s) => a + s.lots.reduce((b, l) => b + l.q, 0), 0);
    expect(units).toBeGreaterThan(10);
    const cartons = st.equipment.reduce((a, e) => a + (e.cartons?.length ?? 0), 0);
    expect(cartons).toBeGreaterThan(0);
    expect(cartons).toBeLessThanOrEqual(8);
    expect(st.flags.progressive).toBe(true);
    expect(levelOf(st)).toBe(1);
  });

  it('les produits et meubles se débloquent en montant de niveau', () => {
    const st = createNewGame({ seed: 7, emptyStart: true, residents: 50 });
    expect(catUnlocked(st, 'epicerie')).toBe(true);
    expect(catUnlocked(st, 'cremerie')).toBe(false);
    expect(productUnlocked(st, 'lait')).toBe(false);
    expect(equipUnlocked(st, 'gondole_double')).toBe(true);
    expect(equipUnlocked(st, 'frigo_vitre')).toBe(false);
    expect(st.assortment.includes('lait')).toBe(false);
    const cash0 = st.cash;
    st.stats.unitsSold = 420; // assez pour le niveau 4
    const lv = checkLevelUp(st)!;
    expect(lv.level).toBe(4);
    expect(lv.cats).toContain('cremerie');
    expect(lv.equip).toContain('frigo_vitre');
    expect(st.cash).toBeGreaterThan(cash0);
    expect(catUnlocked(st, 'cremerie')).toBe(true);
    expect(equipUnlocked(st, 'frigo_vitre')).toBe(true);
    expect(st.assortment.includes('lait')).toBe(true);
    expect(checkLevelUp(st)).toBeNull();
  });

  it('une partie classique n’a pas de verrous', () => {
    const st = createNewGame({ seed: 7, residents: 50 });
    expect(catUnlocked(st, 'boucherie')).toBe(true);
    expect(equipUnlocked(st, 'caisse_auto')).toBe(true);
  });
});

describe('contrats CDI / CDD', () => {
  it('CDD : fin automatique avec prime de précarité, renouvellements limités, passage en CDI', () => {
    const st = createNewGame({ seed: 3, emptyStart: true, residents: 50 });
    const rng = new Rng(5);
    const c1 = makeCandidate(st, rng, 'caissier', 14);
    c1.wantsCdi = false;
    st.candidates.push(c1);
    const r = hire(st, c1.id, 14, { type: 'CDD', days: 7 });
    expect(r.ok).toBe(true);
    const e = r.emp!;
    expect(e.contract?.type).toBe('CDD');
    expect(e.contract?.end).toBe(dayOf(st.time) + 6);
    // rupture anticipée d'un CDD : coûte les salaires restants
    expect(fireCost(st, e)).toBeGreaterThan(0);
    expect(renewCdd(st, e.id, 7).ok).toBe(true);
    expect(renewCdd(st, e.id, 7).ok).toBe(true);
    expect(renewCdd(st, e.id, 7).ok).toBe(false); // 2 renouvellements maximum
    // fin du contrat : départ le lendemain du dernier jour, avec la prime
    e.contract!.paid = 1000;
    const cash = st.cash;
    st.time = (e.contract!.end! + 1) * 1440 + 5 * 60;
    const msgs = staffMorning(st, rng);
    expect(msgs.some((m) => m.includes('Fin du CDD'))).toBe(true);
    expect(st.employees.find((x) => x.id === e.id)).toBeUndefined();
    expect(cash - st.cash).toBeCloseTo(100, 0);

    // CDD → CDI
    const c2 = makeCandidate(st, rng, 'rayon', 14);
    c2.wantsCdi = false;
    st.candidates.push(c2);
    const e2 = hire(st, c2.id, 14, { type: 'CDD', days: 14 }).emp!;
    expect(toCdi(st, e2.id).ok).toBe(true);
    expect(e2.contract?.type).toBe('CDI');
  });

  it('CDI : période d’essai gratuite, puis indemnité ; certains candidats refusent le CDD', () => {
    const st = createNewGame({ seed: 4, emptyStart: true, residents: 50 });
    const rng = new Rng(9);
    const c = makeCandidate(st, rng, 'caissier', 14);
    c.wantsCdi = true;
    st.candidates.push(c);
    expect(hire(st, c.id, 14, { type: 'CDD', days: 7 }).ok).toBe(false);
    const e = hire(st, c.id, 14, { type: 'CDI' }).emp!;
    expect(fireCost(st, e)).toBe(0);
    st.time += 10 * 1440;
    expect(fireCost(st, e)).toBeGreaterThan(0);
    expect(fire(st, e.id)).toBeGreaterThan(0);
  });
});

describe('commande simple et livreur', () => {
  let g: Game;
  beforeAll(async () => {
    g = new Game(true);
    await g.init();
    g.newGame({ seed: 11, emptyStart: true, residents: 200 });
  });

  it('commande payée, livrée après le délai, rangée en réserve', () => {
    const st = g.st;
    const q = simpleQuote(st, [{ pid: 'eau', cartons: 2 }, { pid: 'chips', cartons: 1 }]);
    expect(q.cartons).toBe(3);
    expect(q.fee).toBe(15);
    const cash = st.cash;
    const eau0 = backroomUnits(st, 'eau');
    const r = placeSimpleOrder(st, [{ pid: 'eau', cartons: 2 }, { pid: 'chips', cartons: 1 }]);
    expect(r.ok).toBe(true);
    expect(st.cash).toBeCloseTo(cash - q.total, 2);
    expect(r.order!.eta - st.time).toBeLessThanOrEqual(60);
    g.st.speed = 4;
    for (let i = 0; i < 600 && r.order!.status !== 'livree'; i++) g.update(0.1);
    expect(r.order!.status).toBe('livree');
    expect(backroomUnits(st, 'eau')).toBeGreaterThan(eau0);
  });
});
