import { it } from 'vitest';
import { Game } from '../src/game/game';
import { makeCandidate, hire } from '../src/sim/staff';
import { Rng } from '../src/core/rng';
import { dayProfit } from '../src/sim/economy';
import { placeOrder, reorderNeeds } from '../src/sim/orders';
it.skipIf(!process.env.BALANCE)('équilibre économique sur 7 jours', async () => {
  const g = new Game(true);
  await g.init();
  g.newGame({ seed: 77 });
  const add = (role: any, s: number, e: number) => { const c = makeCandidate(g.st, new Rng(role.length + s), role, 13); g.st.candidates.push(c); const r = hire(g.st, c.id, c.expectedWage); r.emp!.shiftStart = s; r.emp!.shiftEnd = e; r.emp!.daysOff = []; };
  add('caissier', 8, 15); add('caissier', 14, 21); add('rayon', 7, 15); add('logisticien', 6, 13);
  const reasons: Record<string, number> = {};
  const { Customer } = await import('../src/entities/customer');
  const ab = (Customer.prototype as any).abandon;
  (Customer.prototype as any).abandon = function (r: string) { const l = [...g.checkouts.lanes.values()][0]; const k = r + '@' + this.state + (l.operator ? '' : ' (sans caissier)') + ' q' + l.queue.length; reasons[k] = (reasons[k] ?? 0) + 1; if (!l.operator && Math.random() < 0.3) console.log('    caissiers:', g.staff.agents.filter((a) => a.emp.role === 'caissier').map((a) => `${a.state}/${a.task?.kind ?? ''}/f${a.emp.fatigue.toFixed(2)}@${a.pos.x.toFixed(1)},${a.pos.z.toFixed(1)} path${a.path?.length ?? 0}`).join(' | '), 'h', (g.st.time % 1440 / 60).toFixed(2)); return ab.call(this, r); };
  const ar = (Customer.prototype as any).doArriving;
  let spawned = 0; const sc = g.spawnCustomer.bind(g); (g as any).spawnCustomer = (...a: any[]) => { const x = (sc as any)(...a); if (x) spawned++; else reasons['spawn-refusé'] = (reasons['spawn-refusé'] ?? 0) + 1; return x; };
  for (let d = 0; d < 3; d++) {
    const day = Math.floor(g.st.time / 1440);
    // réassort manuel chaque matin
    const needs = reorderNeeds(g.st, 2);
    if (needs.length) placeOrder(g.st, g.rng, 'grossiste', needs);
    for (const e of g.st.equipment) if (e.broken) g.repair(e.uid);
    while (Math.floor(g.st.time / 1440) === day) {
      g.simulate(60, 0.2);
      if (!g.isOpen() && g.agents.count('customer') === 0 && g.st.time % 1440 > 20 * 60) g.skipNight();
    }
    const r = g.st.ledger[g.st.ledger.length - 1];
    console.log('  raisons', JSON.stringify(reasons), 'spawned', spawned); for (const k in reasons) delete reasons[k]; spawned = 0;
    console.log('  pannes', g.st.equipment.filter((e) => e.broken).map((e) => e.def).join(','), 'absents', g.st.employees.filter((e) => e.absentToday).length, 'events', g.st.activeEvents.map((e) => e.id).join(','), 'closed', g.st.flags.closedUntil ? (g.st.flags.closedUntil - g.st.time) : 0, 'incomes', JSON.stringify(r.incomes), 'lanes', [...g.checkouts.lanes.values()].map((l) => `${l.e.open}/${!!l.operator}/${l.e.broken}`).join(' '));
    console.log(`J${r.day + 1}: clients ${r.customers} perdus ${r.lostCustomers} CA ${r.revenue.toFixed(0)} marge ${(r.revenue - r.cogs).toFixed(0)} salaires ${r.expenses.salaires.toFixed(0)} résultat ${dayProfit(r).toFixed(0)} cash ${g.st.cash.toFixed(0)} rep ${g.st.reputation.overall.toFixed(0)} sat ${(r.satisfaction / Math.max(1, r.satisfactionN)).toFixed(2)}`);
  }
}, 600000);
