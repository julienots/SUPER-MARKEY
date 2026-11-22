/** Sauvegarde : l'état du monde en JSON (les personnages sont recréés au chargement). */
import { FURN_BY_ID, STORE_SIZES } from '../data/furniture';
import { PRODUCT_BY_ID } from '../data/products';
import type { World } from './types';
import { relocateInvalid } from './sim';

const KEY = 'bazarbazar2.save';

export function serialize(w: World): string {
  return JSON.stringify(w);
}

export function deserialize(json: string): World {
  const w = JSON.parse(json) as any;
  if (!w || (w.v !== 2 && w.v !== 3) || !Array.isArray(w.furn)) throw new Error('Sauvegarde incompatible');
  // nettoyage défensif : rien d'inconnu ne doit faire planter la partie
  w.furn = w.furn.filter((f: any) => FURN_BY_ID[f.def]);
  for (const f of w.furn) {
    const n = FURN_BY_ID[f.def].shelf?.levels.length ?? 0;
    if (w.v === 2) {
      // v2 : un seul produit par rayon → réparti sur tous les étages
      const p = f.product && PRODUCT_BY_ID[f.product] ? f.product : null;
      const total = Math.max(0, f.stock | 0);
      f.prod = Array(n).fill(p);
      f.stock = Array.from({ length: n }, (_, i) => (p ? Math.floor(total / n) + (i < total % n ? 1 : 0) : 0));
      delete f.product;
    }
    if (!Array.isArray(f.prod) || f.prod.length !== n) f.prod = Array(n).fill(null);
    if (!Array.isArray(f.stock) || f.stock.length !== n) f.stock = Array(n).fill(0);
    f.prod = f.prod.map((p: any) => (p && PRODUCT_BY_ID[p] ? p : null));
    f.stock = f.stock.map((v: any, i: number) => (f.prod[i] ? Math.max(0, v | 0) : 0));
  }
  for (const k of Object.keys(w.reserve ?? {})) if (!PRODUCT_BY_ID[k]) delete w.reserve[k];
  w.reserve ??= {};
  w.sizeIdx = Math.max(0, Math.min(STORE_SIZES.length - 1, w.sizeIdx | 0));
  w.players = [];
  w.dock = Array.isArray(w.dock) ? w.dock.filter((c: any) => PRODUCT_BY_ID[c?.pid]) : [];
  w.code = typeof w.code === 'string' ? w.code : '';
  w.deliveries = (w.deliveries ?? []).filter((d: any) => Object.keys(d.items).every((k) => PRODUCT_BY_ID[k]));
  if (!Number.isFinite(w.money)) w.money = 0;
  if (!w.speed) w.speed = 1;
  w.v = 3;
  // anciens racks dans la surface de vente → déplacés dans la réserve
  relocateInvalid(w as World);
  return w as World;
}

export function saveLocal(w: World) {
  try {
    const copy = { ...w, players: [] };
    localStorage.setItem(KEY, serialize(copy as World));
    return true;
  } catch {
    return false;
  }
}

export function loadLocal(): World | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? deserialize(s) : null;
  } catch {
    return null;
  }
}

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function deleteSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* rien */
  }
}
