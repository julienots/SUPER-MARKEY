/**
 * Fournisseurs, devis, commandes, retards, contrats et réapprovisionnement automatique.
 * La livraison physique (camion, palettes) est gérée par le monde ; ici on gère le cycle logique.
 */
import { PRODUCT_BY_ID } from '../data/products';
import { SUPPLIER_BY_ID, SUPPLIERS, supplierSells, type SupplierDef } from '../data/suppliers';
import type { Rng } from '../core/rng';
import { spend } from './economy';
import { backroomUnits, newCarton, shelfCapacity, shelfUnits } from './inventory';
import { allocUid, dayOf, type Carton, type GameState, type Order, type OrderLine } from './state';

export const availableSuppliers = (st: GameState) => SUPPLIERS.filter((s) => (s.stage ?? 0) <= st.store.stage);

export function unitCost(st: GameState, sup: SupplierDef, pid: string): number {
  const c = st.contracts.find((k) => k.supplier === sup.id && k.until >= dayOf(st.time));
  return PRODUCT_BY_ID[pid].cost * sup.priceFactor * (1 - (c?.discount ?? 0));
}

export interface Quote {
  goods: number;
  discount: number;
  fee: number;
  total: number;
  cartons: number;
  ok: boolean;
  reason?: string;
}

export function quote(st: GameState, supplierId: string, lines: OrderLine[]): Quote {
  const sup = SUPPLIER_BY_ID[supplierId];
  let goods = 0;
  let cartons = 0;
  for (const l of lines) {
    if (l.cartons <= 0) continue;
    const p = PRODUCT_BY_ID[l.pid];
    if (!supplierSells(sup, p.category)) return { goods: 0, discount: 0, fee: 0, total: 0, cartons: 0, ok: false, reason: `${sup.name} ne vend pas ${p.name}` };
    goods += unitCost(st, sup, l.pid) * p.cartonQty * l.cartons;
    cartons += l.cartons;
  }
  let disc = 0;
  for (const b of sup.bulk) if (cartons >= b.cartons) disc = b.discount;
  const discount = goods * disc;
  const fee = cartons > 0 ? sup.deliveryFee : 0;
  const total = Math.round((goods - discount + fee) * 100) / 100;
  if (cartons === 0) return { goods, discount, fee, total, cartons, ok: false, reason: 'Commande vide' };
  if (goods - discount < sup.minOrder) return { goods, discount, fee, total, cartons, ok: false, reason: `Minimum de commande : ${sup.minOrder} €` };
  if (total > st.cash) return { goods, discount, fee, total, cartons, ok: false, reason: 'Trésorerie insuffisante' };
  return { goods, discount, fee, total, cartons, ok: true };
}

export function placeOrder(st: GameState, rng: Rng, supplierId: string, lines: OrderLine[], auto = false): Order | null {
  const q = quote(st, supplierId, lines);
  if (!q.ok) return null;
  const sup = SUPPLIER_BY_ID[supplierId];
  spend(st, 'marchandises', q.total - q.fee);
  spend(st, 'livraison', q.fee);
  const delayed = !rng.chance(sup.reliability);
  const lead = sup.leadHours * 60 * (delayed ? rng.range(1.6, 3) : rng.range(0.9, 1.1));
  const order: Order = {
    id: allocUid(st),
    supplier: supplierId,
    lines: lines.filter((l) => l.cartons > 0).map((l) => ({ ...l })),
    placedAt: st.time,
    eta: Math.round(st.time + lead),
    status: 'en_cours',
    cost: q.total - q.fee,
    fee: q.fee,
    auto,
    delayed,
  };
  // les livraisons ne se font qu'entre 6 h et 20 h
  const mod = order.eta % 1440;
  if (mod < 6 * 60) order.eta += 6 * 60 - mod;
  else if (mod > 20 * 60) order.eta += 1440 - mod + 6 * 60;
  st.orders.push(order);
  st.stats.ordersPlaced++;
  const c = st.contracts.find((k) => k.supplier === supplierId);
  if (c) c.cartonsThisWeek += q.cartons;
  return order;
}

/** Commandes dont le camion doit partir maintenant. */
export function dueOrders(st: GameState): Order[] {
  return st.orders.filter((o) => o.status === 'en_cours' && st.time >= o.eta);
}

/** Construit les cartons d'une commande (le camion les déposera sur des palettes). */
export function orderCartons(st: GameState, o: Order, rng: Rng): Carton[] {
  const sup = SUPPLIER_BY_ID[o.supplier];
  const out: Carton[] = [];
  for (const l of o.lines) {
    const p = PRODUCT_BY_ID[l.pid];
    for (let i = 0; i < l.cartons; i++) {
      // fraîcheur : un fournisseur peu frais livre des produits déjà entamés en durée de vie
      const lifeLeft = p.shelfLife > 0 ? Math.max(1, Math.round(p.shelfLife * (0.55 + sup.freshness * 0.45) + rng.range(-1, 1))) : -1;
      out.push(newCarton(st, l.pid, p.cartonQty, lifeLeft < 0 ? -1 : dayOf(st.time) + lifeLeft));
    }
  }
  return out;
}

export function cancelOrder(st: GameState, id: number): boolean {
  const o = st.orders.find((x) => x.id === id);
  if (!o || o.status !== 'en_cours') return false;
  // annulation tardive : 30 % de frais
  const refund = st.time - o.placedAt < 60 ? o.cost : o.cost * 0.7;
  st.cash += refund;
  st.today.expenses.marchandises -= refund;
  o.status = 'annulee';
  return true;
}

/** Négociation d'un contrat : engagement de volume hebdo contre remise. */
export function negotiateContract(st: GameState, rng: Rng, supplierId: string, weeklyCartons: number): { ok: boolean; discount: number; text: string } {
  const sup = SUPPLIER_BY_ID[supplierId];
  const history = st.orders.filter((o) => o.supplier === supplierId && o.status === 'livree').length;
  const rep = st.reputation.overall / 100;
  const base = Math.min(0.12, 0.01 + weeklyCartons * 0.0012 + history * 0.002 + rep * 0.02);
  const success = rng.chance(0.55 + rep * 0.3 + Math.min(0.15, history * 0.01));
  if (!success) return { ok: false, discount: 0, text: `${sup.name} refuse poliment : « Revenez quand vous serez plus connu. »` };
  const discount = Math.round(base * 1000) / 1000;
  const existing = st.contracts.findIndex((c) => c.supplier === supplierId);
  if (existing >= 0) st.contracts.splice(existing, 1);
  st.contracts.push({ supplier: supplierId, discount, weeklyCartons, until: dayOf(st.time) + 28, cartonsThisWeek: 0 });
  return { ok: true, discount, text: `Contrat signé : −${(discount * 100).toFixed(1)} % pendant 4 semaines, engagement ${weeklyCartons} cartons/semaine.` };
}

/** Pénalités de contrat le dimanche si l'engagement n'est pas tenu. */
export function weeklyContracts(st: GameState): string[] {
  const msgs: string[] = [];
  for (const c of st.contracts) {
    if (c.cartonsThisWeek < c.weeklyCartons) {
      const pen = (c.weeklyCartons - c.cartonsThisWeek) * 4;
      spend(st, 'amendes', pen);
      msgs.push(`Pénalité contrat ${SUPPLIER_BY_ID[c.supplier].name} : ${pen} €`);
    }
    c.cartonsThisWeek = 0;
  }
  st.contracts = st.contracts.filter((c) => c.until >= dayOf(st.time));
  return msgs;
}

/** Ventes moyennes journalières d'un produit (7 jours). */
export function avgDailySales(st: GameState, pid: string): number {
  const h = st.salesHistory[pid] ?? [];
  const last = h.slice(-7);
  const today = st.todaySales[pid] ?? 0;
  if (!last.length) return Math.max(today, 2);
  return Math.max(0.5, last.reduce((a, b) => a + b, 0) / last.length);
}

/** Calcule les besoins de réassort (cartons) d'après le seuil de couverture en jours. */
export function reorderNeeds(st: GameState, coverDays: number): { pid: string; cartons: number }[] {
  const out: { pid: string; cartons: number }[] = [];
  const pending = new Map<string, number>();
  for (const o of st.orders) if (o.status === 'en_cours' || o.status === 'livraison') for (const l of o.lines) pending.set(l.pid, (pending.get(l.pid) ?? 0) + l.cartons * PRODUCT_BY_ID[l.pid].cartonQty);
  for (const pid of st.assortment) {
    if (shelfCapacity(st, pid) <= 0) continue;
    const have = shelfUnits(st, pid) + backroomUnits(st, pid) + (pending.get(pid) ?? 0);
    const need = avgDailySales(st, pid) * coverDays + shelfCapacity(st, pid) * 0.5;
    if (have < need) {
      const q = PRODUCT_BY_ID[pid].cartonQty;
      out.push({ pid, cartons: Math.max(1, Math.ceil((need - have) / q)) });
    }
  }
  return out;
}

/** Réapprovisionnement automatique (logiciel de stock requis). Une commande par fournisseur et par jour max. */
export function autoReorder(st: GameState, rng: Rng, skill: number): Order[] {
  const placed: Order[] = [];
  if (!st.store.upgrades['logiciel_stock'] || !st.store.autoOrder.enabled) return placed;
  const needs = reorderNeeds(st, st.store.autoOrder.threshold);
  if (!needs.length) return placed;
  const bySup = new Map<string, OrderLine[]>();
  for (const n of needs) {
    const p = PRODUCT_BY_ID[n.pid];
    let sup = SUPPLIER_BY_ID[st.store.autoOrder.supplier];
    if (!sup || !supplierSells(sup, p.category)) sup = availableSuppliers(st).filter((s) => supplierSells(s, p.category)).sort((a, b) => a.priceFactor - b.priceFactor)[0];
    if (!sup) continue;
    // un logisticien peu compétent commande approximativement
    const err = 1 + rng.gauss(0, 0.25 * (1 - skill));
    const cartons = Math.max(1, Math.round(n.cartons * err));
    if (!bySup.has(sup.id)) bySup.set(sup.id, []);
    bySup.get(sup.id)!.push({ pid: n.pid, cartons });
  }
  for (const [sid, lines] of bySup) {
    const today = dayOf(st.time);
    if (st.orders.some((o) => o.auto && o.supplier === sid && dayOf(o.placedAt) === today)) continue;
    const o = placeOrder(st, rng, sid, lines, true);
    if (o) placed.push(o);
  }
  return placed;
}
