/**
 * Stock réel : facings de rayon (par lots avec date de péremption), cartons en réserve, pertes.
 * Chaque unité vendue/volée/cassée est retirée d'un lot précis — il n'y a pas de stock « magique ».
 */
import { EQUIPMENT_BY_ID, type EquipmentDef } from '../data/equipment';
import { PRODUCT_BY_ID, type ProductDef } from '../data/products';
import { fitsHeight, itemLayout, slotCount } from './layout';
import { allocUid, dayOf, type Carton, type GameState, type Lot, type PlacedEquip, type Slot } from './state';

export const slotQty = (s: Slot | undefined) => (s ? s.lots.reduce((a, l) => a + l.q, 0) : 0);

export function ensureSlots(e: PlacedEquip) {
  const def = EQUIPMENT_BY_ID[e.def];
  const n = slotCount(def);
  if (n && !e.slots) e.slots = Array.from({ length: n }, () => ({ pid: null, lots: [] }));
  if (def.cartons && !e.cartons) e.cartons = [];
}

/** Le produit peut-il être rangé dans ce facing (froid, catégorie, hauteur) ? */
export function canHold(def: EquipmentDef, idx: number, p: ProductDef): boolean {
  const sh = def.shelf;
  if (!sh) return false;
  if (sh.storage !== p.storage) return false;
  if (sh.categories && !sh.categories.includes(p.category)) return false;
  if (!sh.categories && (p.category === 'boulangerie' || p.category === 'fruits') && def.id !== 'tete_gondole') {
    // le pain et le frais végétal peuvent aussi aller en gondole classique, mais pas les fruits en vrac
    if (p.shape === 'fruit') return false;
  }
  return fitsHeight(def, idx, p);
}

export function capacityFor(e: PlacedEquip, idx: number, pid: string): number {
  return itemLayout(EQUIPMENT_BY_ID[e.def], idx, PRODUCT_BY_ID[pid]).capacity;
}

export function freeSpace(e: PlacedEquip, idx: number): number {
  const s = e.slots?.[idx];
  if (!s || !s.pid) return 0;
  return capacityFor(e, idx, s.pid) - slotQty(s);
}

/** Assigne un produit à un facing vide. */
export function assignSlot(e: PlacedEquip, idx: number, pid: string | null): boolean {
  ensureSlots(e);
  const s = e.slots![idx];
  if (!s) return false;
  if (slotQty(s) > 0 && s.pid !== pid) return false;
  if (pid && !canHold(EQUIPMENT_BY_ID[e.def], idx, PRODUCT_BY_ID[pid])) return false;
  s.pid = pid;
  if (!pid) s.lots = [];
  return true;
}

function addLot(lots: Lot[], q: number, exp: number) {
  const l = lots.find((x) => x.exp === exp);
  if (l) l.q += q;
  else lots.push({ q, exp });
  lots.sort((a, b) => (a.exp < 0 ? 1e9 : a.exp) - (b.exp < 0 ? 1e9 : b.exp));
}

/** Ajoute jusqu'à q unités au facing ; renvoie le nombre réellement ajouté. */
export function addToSlot(e: PlacedEquip, idx: number, pid: string, q: number, exp: number): number {
  ensureSlots(e);
  const s = e.slots![idx];
  if (!s) return 0;
  if (s.pid === null) {
    if (!assignSlot(e, idx, pid)) return 0;
  }
  if (s.pid !== pid) return 0;
  const n = Math.min(q, freeSpace(e, idx));
  if (n <= 0) return 0;
  addLot(s.lots, n, exp);
  return n;
}

/** Retire une unité (le lot qui périme le plus tôt, sauf `freshest`). Renvoie la date du lot retiré, ou null. */
export function takeFromSlot(e: PlacedEquip, idx: number, freshest = false): { pid: string; exp: number } | null {
  const s = e.slots?.[idx];
  if (!s || !s.pid || slotQty(s) <= 0) return null;
  const lot = freshest ? s.lots[s.lots.length - 1] : s.lots[0];
  lot.q--;
  const exp = lot.exp;
  if (lot.q <= 0) s.lots.splice(s.lots.indexOf(lot), 1);
  return { pid: s.pid, exp };
}

export function expiredInSlot(s: Slot, day: number) {
  return s.lots.filter((l) => l.exp >= 0 && l.exp < day).reduce((a, l) => a + l.q, 0);
}

/** Retire les unités périmées d'un facing ; renvoie le nombre retiré. */
export function removeExpired(s: Slot, day: number): number {
  const n = expiredInSlot(s, day);
  s.lots = s.lots.filter((l) => !(l.exp >= 0 && l.exp < day));
  return n;
}

// ---------------------------------------------------------------- Réserve (cartons)

export const newCarton = (st: GameState, pid: string, q?: number, expDay?: number): Carton => {
  const p = PRODUCT_BY_ID[pid];
  return {
    uid: allocUid(st),
    pid,
    q: q ?? p.cartonQty,
    exp: expDay ?? (p.shelfLife > 0 ? dayOf(st.time) + p.shelfLife : -1),
    opened: false,
  };
};

export const storageRacks = (st: GameState, cold?: boolean) =>
  st.equipment.filter((e) => {
    const d = EQUIPMENT_BY_ID[e.def];
    if (!d.cartons || e.broken && d.id === 'chambre_froide') return false;
    if (cold === undefined) return true;
    return cold ? d.id === 'chambre_froide' : d.id !== 'chambre_froide';
  });

export function rackFree(e: PlacedEquip): number {
  const d = EQUIPMENT_BY_ID[e.def];
  return (d.cartons ?? 0) - (e.cartons?.length ?? 0);
}

/** Range un carton dans le premier rack compatible ; renvoie le rack ou null si plein. */
export function storeCarton(st: GameState, c: Carton): PlacedEquip | null {
  const p = PRODUCT_BY_ID[c.pid];
  const needCold = p.storage !== 'ambient';
  const racks = storageRacks(st).filter((r) => (needCold ? r.def === 'chambre_froide' : true));
  // privilégie un rack contenant déjà ce produit
  racks.sort((a, b) => Number(!!b.cartons?.some((x) => x.pid === c.pid)) - Number(!!a.cartons?.some((x) => x.pid === c.pid)));
  for (const r of racks) {
    ensureSlots(r);
    if (rackFree(r) > 0) {
      r.cartons!.push(c);
      return r;
    }
  }
  return null;
}

export function backroomUnits(st: GameState, pid: string): number {
  let n = 0;
  for (const e of st.equipment) if (e.cartons) for (const c of e.cartons) if (c.pid === pid) n += c.q;
  for (const pl of st.pallets) for (const c of pl.cartons) if (c.pid === pid) n += c.q;
  for (const c of st.worldCartons) if (c.pid === pid) n += c.q;
  return n;
}

export function shelfUnits(st: GameState, pid: string): number {
  let n = 0;
  for (const e of st.equipment) if (e.slots) for (const s of e.slots) if (s.pid === pid) n += slotQty(s);
  return n;
}

export function shelfCapacity(st: GameState, pid: string): number {
  let n = 0;
  for (const e of st.equipment)
    if (e.slots) e.slots.forEach((s, i) => {
      if (s.pid === pid) n += capacityFor(e, i, pid);
    });
  return n;
}

export const totalUnits = (st: GameState, pid: string) => backroomUnits(st, pid) + shelfUnits(st, pid) + st.looseItems.filter((l) => l.pid === pid).length;

/** Prend un carton du produit en réserve (le plus ancien). */
export function takeCartonFromRacks(st: GameState, pid: string): { carton: Carton; rack: PlacedEquip } | null {
  let best: { carton: Carton; rack: PlacedEquip } | null = null;
  for (const e of st.equipment) {
    if (!e.cartons) continue;
    for (const c of e.cartons) {
      if (c.pid !== pid || c.q <= 0) continue;
      const ce = c.exp < 0 ? 1e9 : c.exp;
      const be = best ? (best.carton.exp < 0 ? 1e9 : best.carton.exp) : Infinity;
      if (ce < be) best = { carton: c, rack: e };
    }
  }
  if (!best) return null;
  best.rack.cartons!.splice(best.rack.cartons!.indexOf(best.carton), 1);
  return best;
}

/** Liste des facings d'un produit (équipement + index). */
export function slotsForProduct(st: GameState, pid: string): { e: PlacedEquip; idx: number }[] {
  const out: { e: PlacedEquip; idx: number }[] = [];
  for (const e of st.equipment) if (e.slots) e.slots.forEach((s, idx) => s.pid === pid && out.push({ e, idx }));
  return out;
}

/** Valeur d'achat du stock (pour le bilan). */
export function stockValue(st: GameState): number {
  let v = 0;
  const add = (pid: string, q: number) => (v += PRODUCT_BY_ID[pid].cost * q);
  for (const e of st.equipment) {
    e.slots?.forEach((s) => s.pid && add(s.pid, slotQty(s)));
    e.cartons?.forEach((c) => add(c.pid, c.q));
  }
  st.pallets.forEach((p) => p.cartons.forEach((c) => add(c.pid, c.q)));
  st.worldCartons.forEach((c) => add(c.pid, c.q));
  return v;
}

/**
 * Passage du jour : retire les cartons périmés en réserve (pertes), dégrade le frais si le froid est en panne.
 * Les produits périmés en rayon restent visibles (à retirer !) — c'est au joueur/au personnel d'agir.
 */
export function dailySpoilage(st: GameState, coldOutage: boolean): { lostUnits: number; lostValue: number } {
  const day = dayOf(st.time);
  let lostUnits = 0;
  let lostValue = 0;
  for (const e of st.equipment) {
    if (e.cartons) {
      const keep: Carton[] = [];
      for (const c of e.cartons) {
        if (c.exp >= 0 && c.exp < day) {
          lostUnits += c.q;
          lostValue += c.q * PRODUCT_BY_ID[c.pid].cost;
        } else keep.push(c);
      }
      e.cartons = keep;
    }
    // panne de froid : les produits frais perdent des jours de conservation
    const def = EQUIPMENT_BY_ID[e.def];
    if (e.slots && def.shelf && def.shelf.storage !== 'ambient' && (e.broken || coldOutage)) {
      for (const s of e.slots) for (const l of s.lots) if (l.exp >= 0) l.exp = Math.min(l.exp, day);
      if (def.shelf.storage === 'frozen')
        for (const s of e.slots)
          for (const l of s.lots) {
            if (l.exp < 0) l.exp = day + 1; // le surgelé décongelé devient périssable
          }
    }
  }
  return { lostUnits, lostValue };
}

/** Prélève des unités directement dans les cartons de réserve (commandes spéciales). */
export function takeUnitsFromBackroom(st: GameState, pid: string, q: number): number {
  let got = 0;
  for (const e of st.equipment) {
    if (!e.cartons) continue;
    for (const c of e.cartons) {
      if (c.pid !== pid || got >= q) continue;
      const n = Math.min(c.q, q - got);
      c.q -= n;
      got += n;
    }
    e.cartons = e.cartons.filter((c) => c.q > 0);
  }
  return got;
}
