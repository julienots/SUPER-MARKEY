/**
 * Prix, promotions et calcul exact des tickets de caisse.
 */
import { PRODUCT_BY_ID, psychologicalPrice } from '../data/products';
import { dayOf, type GameState, type Promo } from './state';

export const basePrice = (st: GameState, pid: string) => st.prices[pid] ?? PRODUCT_BY_ID[pid].price;

export const promoActive = (p: Promo, day: number) => day >= p.start && day <= p.end;

export function promosFor(st: GameState, pid: string): Promo[] {
  const day = dayOf(st.time);
  const cat = PRODUCT_BY_ID[pid].category;
  return st.promos.filter((p) => promoActive(p, day) && (p.pids.includes(pid) || (p.pids.length === 0 && p.category === cat)));
}

/** Prix unitaire affiché (après remise en pourcentage), hors lots et fidélité. */
export function shelfPrice(st: GameState, pid: string, exp = -1): number {
  let price = basePrice(st, pid);
  let pctOff = 0;
  for (const pr of promosFor(st, pid)) {
    if (pr.kind === 'percent' || pr.kind === 'flash') pctOff = Math.max(pctOff, pr.value);
  }
  const day = dayOf(st.time);
  if (exp >= 0 && exp - day <= 1) {
    const ag = st.promos.find((p) => p.kind === 'antigaspi' && promoActive(p, day));
    if (ag) pctOff = Math.max(pctOff, ag.value);
  }
  price *= 1 - pctOff;
  return Math.round(price * 100) / 100;
}

/** Remise « visible » d'un produit (pour l'attractivité et l'affichage). 0..1 */
export function promoAppeal(st: GameState, pid: string): number {
  let best = 0;
  for (const pr of promosFor(st, pid)) {
    if (pr.kind === 'percent' || pr.kind === 'flash') best = Math.max(best, pr.value);
    else if (pr.kind === 'lot3x2') best = Math.max(best, 0.33);
    else if (pr.kind === 'second50') best = Math.max(best, 0.25);
  }
  return best;
}

export function promoLabel(st: GameState, pid: string): string | null {
  const ps = promosFor(st, pid);
  if (!ps.length) return null;
  const p = ps[0];
  switch (p.kind) {
    case 'percent':
    case 'flash':
      return `-${Math.round(p.value * 100)}%`;
    case 'lot3x2':
      return '3 pour 2';
    case 'second50':
      return '2e à -50%';
    default:
      return 'PROMO';
  }
}

export interface TicketLine {
  pid: string;
  qty: number;
  unit: number;
  discount: number;
  total: number;
}

export interface Ticket {
  lines: TicketLine[];
  subtotal: number;
  promoDiscount: number;
  loyaltyDiscount: number;
  total: number;
  cost: number;
}

/** Calcule le ticket exact pour une liste d'articles (chaque article garde son lot pour l'anti-gaspi). */
export function computeTicket(st: GameState, items: { pid: string; exp: number }[], loyaltyMember: boolean): Ticket {
  const groups = new Map<string, { exp: number }[]>();
  for (const it of items) {
    if (!groups.has(it.pid)) groups.set(it.pid, []);
    groups.get(it.pid)!.push(it);
  }
  const lines: TicketLine[] = [];
  let subtotal = 0;
  let promoDiscount = 0;
  let cost = 0;
  for (const [pid, arr] of groups) {
    const base = basePrice(st, pid);
    const unitPrices = arr.map((a) => shelfPrice(st, pid, a.exp)).sort((a, b) => b - a);
    let total = unitPrices.reduce((a, b) => a + b, 0);
    const promos = promosFor(st, pid);
    if (promos.some((p) => p.kind === 'lot3x2')) {
      // une unité offerte par tranche de 3 (la moins chère)
      const free = Math.floor(arr.length / 3);
      const asc = [...unitPrices].sort((a, b) => a - b);
      for (let i = 0; i < free; i++) total -= asc[i];
    } else if (promos.some((p) => p.kind === 'second50')) {
      const pairs = Math.floor(arr.length / 2);
      const asc = [...unitPrices].sort((a, b) => a - b);
      for (let i = 0; i < pairs; i++) total -= asc[i] * 0.5;
    }
    total = Math.round(total * 100) / 100;
    const gross = base * arr.length;
    lines.push({ pid, qty: arr.length, unit: base, discount: Math.round((gross - total) * 100) / 100, total });
    subtotal += gross;
    promoDiscount += gross - total;
    cost += PRODUCT_BY_ID[pid].cost * arr.length;
  }
  const afterPromo = subtotal - promoDiscount;
  const loyaltyDiscount = loyaltyMember && st.store.upgrades['carte_fidelite'] ? Math.round(afterPromo * 0.05 * 100) / 100 : 0;
  const total = Math.round((afterPromo - loyaltyDiscount) * 100) / 100;
  return {
    lines,
    subtotal: Math.round(subtotal * 100) / 100,
    promoDiscount: Math.round(promoDiscount * 100) / 100,
    loyaltyDiscount,
    total,
    cost: Math.round(cost * 100) / 100,
  };
}

/** Indice de prix du magasin (moyenne pondérée prix / prix de marché sur l'assortiment en rayon). */
export function priceIndex(st: GameState): number {
  let num = 0;
  let den = 0;
  for (const pid of st.assortment) {
    const p = PRODUCT_BY_ID[pid];
    const w = p.popularity;
    num += (shelfPrice(st, pid) / p.price) * w;
    den += w;
  }
  return den ? num / den : 1;
}

export const suggestPrice = (pid: string, margin: number) => psychologicalPrice(PRODUCT_BY_ID[pid].cost * (1 + margin));
