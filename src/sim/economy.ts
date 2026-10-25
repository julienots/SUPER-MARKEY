/**
 * Comptabilité : trésorerie, grand livre journalier, charges fixes, emprunts, impôts, faillite.
 */
import { EQUIPMENT_BY_ID, UPGRADE_BY_ID, CELL } from '../data/equipment';
import { STAGES, storeRect } from './layout';
import { dayOf, emptyDay, type ExpenseKind, type GameState, type IncomeKind } from './state';
import { dayOfWeek } from '../core/time';
import { stockValue } from './inventory';

export const KWH_PRICE = 0.23;

export function spend(st: GameState, kind: ExpenseKind, amount: number): void {
  if (amount <= 0) return;
  st.cash -= amount;
  st.today.expenses[kind] += amount;
}

/** Achat qui exige d'avoir la trésorerie (pas de découvert pour investir). */
export function tryBuy(st: GameState, kind: ExpenseKind, amount: number): boolean {
  if (st.cash < amount) return false;
  spend(st, kind, amount);
  return true;
}

export function earn(st: GameState, kind: IncomeKind, amount: number): void {
  if (amount <= 0) return;
  st.cash += amount;
  st.today.incomes[kind] += amount;
}

export function recordSale(st: GameState, total: number, cost: number, units: number): void {
  earn(st, 'ventes', total);
  st.today.revenue += total;
  st.today.cogs += cost;
  st.today.itemsSold += units;
  st.today.customers++;
  st.stats.customersServed++;
  st.stats.totalRevenue += total;
  st.stats.unitsSold += units;
}

export function openHours(st: GameState): number {
  const { openHour, closeHour } = st.store;
  return Math.max(0, closeHour - openHour);
}

/** Consommation électrique journalière estimée (kWh). */
export function dailyKwh(st: GameState): number {
  const h = openHours(st);
  const r = storeRect(st.store.stage);
  const area = (r.x1 - r.x0) * (r.z1 - r.z0);
  let kwh = area * 0.011 * h * st.store.lightLevel + 6; // éclairage + veille
  for (const e of st.equipment) {
    const d = EQUIPMENT_BY_ID[e.def];
    if (e.broken) continue;
    kwh += d.power * (d.alwaysOn ? 24 : h);
  }
  if (st.store.upgrades['climatisation']) kwh += 3.5 * h;
  if (st.store.upgrades['eclairage_ext']) kwh += 0.6 * 10;
  return kwh;
}

export function insuranceDaily(st: GameState): number {
  const base = [0, 11, 24][st.store.insurance];
  return base * (1 + Math.min(1.5, st.insuranceClaims * 0.15)) * (1 + st.store.stage * 0.35);
}

/** Taux de couverture et franchise de l'assurance. */
export function insuranceTerms(st: GameState): { rate: number; deductible: number } {
  return st.store.insurance === 2 ? { rate: 0.9, deductible: 100 } : st.store.insurance === 1 ? { rate: 0.6, deductible: 300 } : { rate: 0, deductible: 0 };
}

/** Indemnisation d'un sinistre. Renvoie le montant remboursé. */
export function insuranceClaim(st: GameState, loss: number): number {
  const t = insuranceTerms(st);
  if (t.rate <= 0 || loss <= t.deductible) return 0;
  const paid = Math.round((loss - t.deductible) * t.rate);
  st.insuranceClaims++;
  earn(st, 'assurance', paid);
  return paid;
}

export function fixedCostsPreview(st: GameState): { label: string; amount: number }[] {
  const out: { label: string; amount: number }[] = [];
  out.push({ label: 'Loyer', amount: STAGES[st.store.stage].rentPerDay });
  out.push({ label: 'Électricité', amount: dailyKwh(st) * KWH_PRICE });
  let maint = 0;
  for (const e of st.equipment) maint += EQUIPMENT_BY_ID[e.def].maintenance;
  out.push({ label: 'Entretien équipements', amount: maint });
  let subs = 0;
  for (const [id, on] of Object.entries(st.store.upgrades)) if (on) subs += UPGRADE_BY_ID[id]?.daily ?? 0;
  out.push({ label: 'Abonnements', amount: subs });
  out.push({ label: 'Assurance', amount: insuranceDaily(st) });
  if (st.loan) out.push({ label: 'Remboursement emprunt', amount: Math.min(st.loan.daily, st.loan.remaining) });
  return out;
}

export function estimatedDailyWages(st: GameState): number {
  return st.employees.reduce((a, e) => a + e.wage * Math.max(0, e.shiftEnd - e.shiftStart) * (5 / 7), 0);
}

export interface DayCloseReport {
  day: number;
  revenue: number;
  grossMargin: number;
  expenses: number;
  profit: number;
  customers: number;
  lost: number;
  satisfaction: number;
  taxes: number;
}

/**
 * Clôture comptable à minuit : charges fixes, impôts hebdomadaires, archivage du jour, contrôle d'endettement.
 */
export function closeDay(st: GameState): DayCloseReport {
  const day = st.today.day;
  for (const c of fixedCostsPreview(st)) {
    const kind: ExpenseKind =
      c.label === 'Loyer' ? 'loyer' : c.label === 'Électricité' ? 'electricite' : c.label === 'Assurance' ? 'assurance' : c.label.startsWith('Rembourse') ? 'emprunt' : c.label === 'Abonnements' ? 'abonnements' : 'entretien';
    spend(st, kind, Math.round(c.amount * 100) / 100);
  }
  if (st.loan) {
    st.loan.remaining -= Math.min(st.loan.daily, st.loan.remaining);
    if (st.loan.remaining <= 0.01) st.loan = null;
  }
  // impôts & charges sociales simplifiés : chaque dimanche, 22 % du bénéfice d'exploitation de la semaine
  let taxes = 0;
  if (dayOfWeek(day) === 6) {
    const week = [...st.ledger.slice(-6), st.today];
    const profit = week.reduce((a, d) => a + dayProfit(d), 0);
    if (profit > 0) {
      taxes = Math.round(profit * 0.22);
      spend(st, 'impots', taxes);
    }
  }
  const rec = st.today;
  const expenses = Object.values(rec.expenses).reduce((a, b) => a + b, 0);
  const report: DayCloseReport = {
    day,
    revenue: rec.revenue,
    grossMargin: rec.revenue - rec.cogs,
    expenses,
    profit: dayProfit(rec),
    customers: rec.customers,
    lost: rec.lostCustomers,
    satisfaction: rec.satisfactionN ? rec.satisfaction / rec.satisfactionN : 0,
    taxes,
  };
  st.ledger.push(rec);
  if (st.ledger.length > 120) st.ledger.splice(0, st.ledger.length - 120);
  st.today = emptyDay(day + 1);

  // historique des ventes par produit (7 jours glissants)
  for (const pid of Object.keys(st.salesHistory)) {
    st.salesHistory[pid].push(st.todaySales[pid] ?? 0);
    if (st.salesHistory[pid].length > 14) st.salesHistory[pid].shift();
  }
  for (const pid of Object.keys(st.todaySales)) if (!st.salesHistory[pid]) st.salesHistory[pid] = [st.todaySales[pid]];
  st.todaySales = {};
  st.todayMissed = {};

  // endettement
  if (st.cash < 0) st.debtDays++;
  else st.debtDays = 0;
  if (st.debtDays >= 7 && st.cash < -3000 * (1 + st.store.stage)) st.bankrupt = true;
  return report;
}

/** Résultat d'un jour : ventes − coût des ventes − charges (hors achats de marchandises, déjà dans le coût des ventes). */
export function dayProfit(d: { revenue: number; cogs: number; expenses: Record<string, number>; incomes: Record<string, number> }): number {
  let exp = 0;
  for (const [k, v] of Object.entries(d.expenses)) if (k !== 'marchandises' && k !== 'equipement' && k !== 'travaux') exp += v;
  const other = (d.incomes.assurance ?? 0) + (d.incomes.divers ?? 0) + (d.incomes.recompenses ?? 0);
  return d.revenue - d.cogs - exp + other;
}

export function maxLoan(st: GameState): number {
  const recent = st.ledger.slice(-14);
  const avgRev = recent.length ? recent.reduce((a, d) => a + d.revenue, 0) / recent.length : 300;
  return Math.round(Math.max(5000, avgRev * 30 + stockValue(st) * 0.5 + st.store.stage * 15000) / 500) * 500;
}

export function takeLoan(st: GameState, amount: number, days: number): boolean {
  if (st.loan || amount <= 0 || amount > maxLoan(st)) return false;
  const rate = 0.06 + (st.debtDays > 0 ? 0.04 : 0) + st.store.stage * 0.005;
  const total = amount * (1 + (rate * days) / 365) + 150; // frais de dossier
  st.loan = { principal: amount, remaining: Math.round(total), rate, daily: Math.round((total / days) * 100) / 100, startDay: dayOf(st.time) };
  earn(st, 'emprunt', amount);
  return true;
}

export function repayLoan(st: GameState): boolean {
  if (!st.loan || st.cash < st.loan.remaining) return false;
  spend(st, 'emprunt', st.loan.remaining);
  st.loan = null;
  return true;
}

/** Prévision simple : moyenne mobile 7 jours. */
export function forecast(st: GameState) {
  const last = st.ledger.slice(-7);
  const n = Math.max(1, last.length);
  const revenue = last.reduce((a, d) => a + d.revenue, 0) / n;
  const margin = last.reduce((a, d) => a + d.revenue - d.cogs, 0) / n;
  const fixed = fixedCostsPreview(st).reduce((a, c) => a + c.amount, 0) + estimatedDailyWages(st);
  const trend = last.length >= 4 ? (last[last.length - 1].revenue + last[last.length - 2].revenue - last[0].revenue - last[1].revenue) / 2 : 0;
  return { revenue, margin, fixed, profit: margin - fixed, trend, runwayDays: margin - fixed < 0 ? Math.floor(st.cash / Math.max(1, fixed - margin)) : Infinity };
}

export const storeArea = (stage: number) => {
  const r = storeRect(stage);
  return (r.x1 - r.x0) * (r.z1 - r.z0);
};

export const equipCellArea = (def: string) => EQUIPMENT_BY_ID[def].w * EQUIPMENT_BY_ID[def].d * CELL * CELL;
