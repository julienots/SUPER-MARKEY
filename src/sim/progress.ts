/**
 * Progression du commerçant : des points d'expérience gagnés en vendant (articles vendus, clients servis)
 * font monter de niveau, et chaque niveau débloque des familles de produits et des types de meubles.
 * Actif seulement pour les parties « progressives » (st.flags.progressive) ; sinon tout est disponible.
 */
import { PRODUCTS, CATEGORY_BY_ID, type CategoryId } from '../data/products';
import { EQUIPMENT, EQUIPMENT_BY_ID } from '../data/equipment';
import type { GameState } from './state';

export interface LevelDef {
  level: number;
  xp: number;
  cats: CategoryId[];
  equip: string[];
  /** Prime versée en passant ce niveau. */
  bonus: number;
}

/** Paliers : XP cumulée nécessaire, familles de produits et meubles débloqués. */
export const LEVELS: LevelDef[] = [
  { level: 1, xp: 0, cats: ['epicerie', 'boissons', 'snacks', 'confiserie'], equip: ['gondole_simple', 'gondole_double', 'gondole_basse', 'tete_gondole', 'caisse', 'rack_reserve', 'paniers', 'poubelle', 'extincteur', 'plante', 'affiche', 'ballons', 'tapis'], bonus: 0 },
  { level: 2, xp: 60, cats: ['petitdej', 'boulangerie'], equip: ['bac_pain', 'spot', 'panneau_rayon'], bonus: 150 },
  { level: 3, xp: 180, cats: ['fruits', 'hygiene'], equip: ['etal_fruits', 'caddies', 'neon'], bonus: 250 },
  { level: 4, xp: 400, cats: ['cremerie', 'entretien'], equip: ['frigo_vitre', 'chambre_froide', 'camera', 'casiers'], bonus: 400 },
  { level: 5, xp: 750, cats: ['surgeles'], equip: ['congelateur', 'ecran_secu', 'salle_pause'], bonus: 600 },
  { level: 6, xp: 1250, cats: ['boucherie'], equip: ['frigo_mural', 'portique', 'bureau', 'coffre'], bonus: 800 },
  { level: 7, xp: 1900, cats: ['local'], equip: ['cafe_client', 'detecteur', 'vitrine_secu', 'toilettes'], bonus: 1000 },
  { level: 8, xp: 2800, cats: ['saison'], equip: ['caisse_auto'], bonus: 1500 },
  { level: 9, xp: 4000, cats: [], equip: [], bonus: 2000 },
  { level: 10, xp: 5500, cats: [], equip: [], bonus: 3000 },
];
export const MAX_LEVEL = LEVELS[LEVELS.length - 1].level;

/** Points d'expérience : 1 par article vendu, 3 par client servi. */
export const xpOf = (st: GameState) => st.stats.unitsSold + st.stats.customersServed * 3;

export function levelOf(st: GameState): number {
  const xp = xpOf(st);
  let l = 1;
  for (const d of LEVELS) if (xp >= d.xp) l = d.level;
  return l;
}

export const isProgressive = (st: GameState) => !!st.flags.progressive;

/** Progression vers le niveau suivant (0..1) et XP restante. */
export function levelProgress(st: GameState): { level: number; xp: number; next: number | null; frac: number } {
  const level = levelOf(st);
  const xp = xpOf(st);
  const cur = LEVELS.find((d) => d.level === level)!;
  const nxt = LEVELS.find((d) => d.level === level + 1);
  if (!nxt) return { level, xp, next: null, frac: 1 };
  return { level, xp, next: nxt.xp, frac: (xp - cur.xp) / (nxt.xp - cur.xp) };
}

/** Niveau requis pour une famille de produits. */
export function catLevel(cat: CategoryId): number {
  return LEVELS.find((d) => d.cats.includes(cat))?.level ?? 1;
}

/** Niveau requis pour un meuble (non listé : disponible dès le début). */
export function equipLevel(def: string): number {
  return LEVELS.find((d) => d.equip.includes(def))?.level ?? 1;
}

export function catUnlocked(st: GameState, cat: CategoryId): boolean {
  return !isProgressive(st) || catLevel(cat) <= levelOf(st);
}

export function productUnlocked(st: GameState, pid: string): boolean {
  const p = PRODUCTS.find((x) => x.id === pid);
  return !!p && catUnlocked(st, p.category);
}

export function equipUnlocked(st: GameState, def: string): boolean {
  return !isProgressive(st) || equipLevel(def) <= levelOf(st);
}

export const unlockedCats = (st: GameState) => (Object.keys(CATEGORY_BY_ID) as CategoryId[]).filter((c) => catUnlocked(st, c));

/**
 * À appeler régulièrement : détecte le passage de niveau, verse la prime, ajoute les nouveaux produits
 * à l'assortiment. Renvoie la description du nouveau niveau (ou null).
 */
export function checkLevelUp(st: GameState): { level: number; cats: CategoryId[]; equip: string[]; bonus: number } | null {
  if (!isProgressive(st)) return null;
  const level = levelOf(st);
  const known = st.flags.level ?? 1;
  if (level <= known) return null;
  const cats: CategoryId[] = [];
  const equip: string[] = [];
  let bonus = 0;
  for (const d of LEVELS) {
    if (d.level <= known || d.level > level) continue;
    cats.push(...d.cats);
    equip.push(...d.equip);
    bonus += d.bonus;
  }
  st.flags.level = level;
  st.cash += bonus;
  for (const p of PRODUCTS) if (cats.includes(p.category) && !p.seasonal && !st.assortment.includes(p.id)) st.assortment.push(p.id);
  return { level, cats, equip: equip.filter((e) => EQUIPMENT_BY_ID[e]), bonus };
}

/** Meubles disponibles à l'achat (catalogue complet, triés par niveau). */
export const equipmentCatalog = () => [...EQUIPMENT].sort((a, b) => equipLevel(a.id) - equipLevel(b.id));
