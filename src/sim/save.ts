/** Sauvegarde : l'état du monde en JSON (les personnages sont recréés au chargement). */
import { FURN_BY_ID, STORE_SIZES } from '../data/furniture';
import { PRODUCT_BY_ID } from '../data/products';
import type { World } from './types';

const KEY = 'bazarbazar2.save';

export function serialize(w: World): string {
  return JSON.stringify(w);
}

export function deserialize(json: string): World {
  const w = JSON.parse(json) as World;
  if (!w || w.v !== 2 || !Array.isArray(w.furn)) throw new Error('Sauvegarde incompatible');
  // nettoyage défensif : rien d'inconnu ne doit faire planter la partie
  w.furn = w.furn.filter((f) => FURN_BY_ID[f.def]);
  for (const f of w.furn) {
    if (f.product && !PRODUCT_BY_ID[f.product]) f.product = null;
    f.stock = Math.max(0, f.stock | 0);
  }
  for (const k of Object.keys(w.reserve)) if (!PRODUCT_BY_ID[k]) delete w.reserve[k];
  w.sizeIdx = Math.max(0, Math.min(STORE_SIZES.length - 1, w.sizeIdx | 0));
  w.players = [];
  w.deliveries = (w.deliveries ?? []).filter((d) => Object.keys(d.items).every((k) => PRODUCT_BY_ID[k]));
  if (!Number.isFinite(w.money)) w.money = 0;
  if (!w.speed) w.speed = 1;
  return w;
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
