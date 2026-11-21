/**
 * Meubles qu'on peut acheter et poser. Grille d'un mètre : `w` × `d` cases (avant rotation).
 * Le devant du meuble regarde +z quand rot = 0.
 * Modèles : `equip` = mobilier de supérette fait sous Blender (public/models/equipment.glb),
 * `props` = mobilier KayKit (public/models/props.glb, CC0).
 */
import type { CategoryId, StorageClass } from './products';

export type FurnKind = 'shelf' | 'checkout' | 'storage' | 'deco';

export interface ShelfSpec {
  /** Hauteurs des tablettes (m). */
  levels: number[];
  /** Emplacements par tablette et par face. */
  facings: number;
  sides: 1 | 2;
  /** Profondeur utile d'une face (m). */
  depth: number;
  storage: StorageClass;
  /** Familles acceptées (sinon toutes celles du bon stockage). */
  cats?: CategoryId[];
  /** Largeur réelle du meuble (m). */
  width: number;
  /** Rangées d'articles en profondeur. */
  rows: number;
}

export interface FurnDef {
  id: string;
  name: string;
  kind: FurnKind;
  price: number;
  w: number;
  d: number;
  level: number;
  icon: string;
  model: { kit: 'equip' | 'props'; name: string; scale?: number; fit?: boolean; dz?: number; rotY?: number; y?: number };
  shelf?: ShelfSpec;
  /** Cartons rangés en plus (réserve). */
  cartons?: number;
  /** Agrément (déco) : attire plus de clients. */
  appeal?: number;
  /** On peut marcher dessus (tapis). */
  walkable?: boolean;
  /** Caisse automatique : pas besoin de caissier. */
  self?: boolean;
}

const lv = (a: number[]) => a;

export const FURNITURE: FurnDef[] = [
  // ------------------------------------------------------------- rayons
  {
    id: 'gondole_simple', name: 'Étagère murale', kind: 'shelf', price: 250, w: 2, d: 1, level: 1, icon: 'shop',
    model: { kit: 'equip', name: 'gondole_simple', dz: -0.25 },
    shelf: { levels: lv([0.12, 0.465, 0.81, 1.155, 1.5]), facings: 4, sides: 1, depth: 0.42, storage: 'ambient', width: 2, rows: 2 },
  },
  {
    id: 'gondole_double', name: 'Gondole double', kind: 'shelf', price: 420, w: 2, d: 1, level: 1, icon: 'shop',
    model: { kit: 'equip', name: 'gondole_double' },
    shelf: { levels: lv([0.12, 0.48, 0.84, 1.2]), facings: 4, sides: 2, depth: 0.42, storage: 'ambient', width: 2, rows: 1 },
  },
  {
    id: 'tete_gondole', name: 'Présentoir promo', kind: 'shelf', price: 150, w: 1, d: 1, level: 1, icon: 'gift',
    model: { kit: 'equip', name: 'tete_gondole' }, appeal: 1,
    shelf: { levels: lv([0.35]), facings: 2, sides: 1, depth: 0.8, storage: 'ambient', width: 1, rows: 3 },
  },
  {
    id: 'gondole_basse', name: 'Gondole basse', kind: 'shelf', price: 330, w: 2, d: 1, level: 2, icon: 'basket',
    model: { kit: 'equip', name: 'gondole_basse' },
    shelf: { levels: lv([0.12, 0.46, 0.8]), facings: 4, sides: 2, depth: 0.42, storage: 'ambient', width: 2, rows: 1 },
  },
  {
    id: 'bac_pain', name: 'Corbeilles à pain', kind: 'shelf', price: 280, w: 2, d: 1, level: 2, icon: 'bread',
    model: { kit: 'equip', name: 'bac_pain' },
    shelf: { levels: lv([0.5, 0.95]), facings: 2, sides: 1, depth: 0.7, storage: 'ambient', cats: ['boulangerie'], width: 1.5, rows: 2 },
  },
  {
    id: 'etal_fruits', name: 'Étal fruits & légumes', kind: 'shelf', price: 380, w: 2, d: 1, level: 3, icon: 'apple',
    model: { kit: 'equip', name: 'etal_fruits' },
    shelf: { levels: lv([0.55, 0.85]), facings: 3, sides: 2, depth: 0.42, storage: 'ambient', cats: ['fruits'], width: 2, rows: 1 },
  },
  {
    id: 'frigo_vitre', name: 'Frigo vitré', kind: 'shelf', price: 850, w: 2, d: 1, level: 4, icon: 'fridge',
    model: { kit: 'equip', name: 'frigo_vitre' },
    shelf: { levels: lv([0.2, 0.54, 0.88, 1.21, 1.55]), facings: 4, sides: 1, depth: 0.55, storage: 'chilled', width: 2, rows: 2 },
  },
  {
    id: 'congelateur', name: 'Congélateur', kind: 'shelf', price: 700, w: 2, d: 1, level: 5, icon: 'snow',
    model: { kit: 'equip', name: 'congelateur' },
    shelf: { levels: lv([0.3, 0.55]), facings: 3, sides: 1, depth: 0.75, storage: 'frozen', width: 2, rows: 2 },
  },
  {
    id: 'frigo_mural', name: 'Meuble froid ouvert', kind: 'shelf', price: 780, w: 2, d: 1, level: 6, icon: 'meat',
    model: { kit: 'equip', name: 'frigo_mural' },
    shelf: { levels: lv([0.35, 0.72, 1.08, 1.45]), facings: 4, sides: 1, depth: 0.6, storage: 'chilled', width: 2, rows: 2 },
  },
  // ------------------------------------------------------------- caisses & réserve
  { id: 'caisse', name: 'Caisse', kind: 'checkout', price: 600, w: 3, d: 1, level: 1, icon: 'cashier', model: { kit: 'equip', name: 'caisse' } },
  { id: 'caisse_auto', name: 'Caisse automatique', kind: 'checkout', price: 1400, w: 1, d: 1, level: 7, icon: 'rocket', self: true, model: { kit: 'equip', name: 'caisse_auto' } },
  { id: 'rack_reserve', name: 'Rack de réserve', kind: 'storage', price: 300, w: 2, d: 1, level: 1, icon: 'package', cartons: 12, model: { kit: 'equip', name: 'rack_reserve' } },
  // ------------------------------------------------------------- déco
  { id: 'plante', name: 'Plante verte', kind: 'deco', price: 60, w: 1, d: 1, level: 1, icon: 'sparkles', appeal: 1, model: { kit: 'equip', name: 'plante' } },
  { id: 'paniers', name: 'Paniers', kind: 'deco', price: 40, w: 1, d: 1, level: 1, icon: 'basket', appeal: 1, model: { kit: 'equip', name: 'paniers' } },
  { id: 'tapis', name: 'Tapis d’entrée', kind: 'deco', price: 50, w: 2, d: 1, level: 1, icon: 'home', appeal: 1, walkable: true, model: { kit: 'equip', name: 'tapis' } },
  { id: 'cactus', name: 'Cactus', kind: 'deco', price: 50, w: 1, d: 1, level: 1, icon: 'sparkles', appeal: 1, model: { kit: 'props', name: 'cactus_medium_A', scale: 0.75 } },
  { id: 'ballons', name: 'Ballons', kind: 'deco', price: 40, w: 1, d: 1, level: 2, icon: 'party', appeal: 1, model: { kit: 'equip', name: 'ballons' } },
  { id: 'lampadaire', name: 'Lampadaire', kind: 'deco', price: 90, w: 1, d: 1, level: 2, icon: 'light', appeal: 1, model: { kit: 'props', name: 'lamp_standing', scale: 0.7 } },
  { id: 'cagettes', name: 'Cagettes de légumes', kind: 'deco', price: 80, w: 1, d: 1, level: 2, icon: 'apple', appeal: 2, model: { kit: 'props', name: 'crate_carrots', scale: 0.42 } },
  { id: 'caddies', name: 'Chariots', kind: 'deco', price: 150, w: 2, d: 1, level: 3, icon: 'cart', appeal: 2, model: { kit: 'equip', name: 'caddies' } },
  { id: 'tapis_rayures', name: 'Grand tapis', kind: 'deco', price: 120, w: 2, d: 2, level: 3, icon: 'home', appeal: 2, walkable: true, model: { kit: 'props', name: 'rug_rectangle_stripes_A', fit: true } },
  { id: 'canape', name: 'Canapé', kind: 'deco', price: 320, w: 2, d: 1, level: 4, icon: 'home', appeal: 3, model: { kit: 'props', name: 'couch_pillows', scale: 0.62 } },
  { id: 'bibliotheque', name: 'Étagère déco', kind: 'deco', price: 260, w: 2, d: 1, level: 5, icon: 'news', appeal: 3, model: { kit: 'props', name: 'shelf_B_large_decorated', scale: 0.62 } },
  { id: 'cafe_client', name: 'Machine à café', kind: 'deco', price: 400, w: 1, d: 1, level: 6, icon: 'drink', appeal: 4, model: { kit: 'equip', name: 'cafe_client' } },
];

export const FURN_BY_ID: Record<string, FurnDef> = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));

/** Agrandissements du magasin (largeur × profondeur intérieures, en mètres). */
export const STORE_SIZES: { w: number; d: number; price: number; level: number }[] = [
  { w: 10, d: 8, price: 0, level: 1 },
  { w: 13, d: 10, price: 2500, level: 2 },
  { w: 16, d: 12, price: 6000, level: 4 },
  { w: 20, d: 14, price: 12000, level: 6 },
];

/** Famille → niveau de déblocage. */
export const CAT_LEVEL: Record<CategoryId, number> = {
  boissons: 1,
  snacks: 1,
  confiserie: 1,
  epicerie: 1,
  petitdej: 2,
  boulangerie: 2,
  fruits: 3,
  hygiene: 3,
  cremerie: 4,
  entretien: 4,
  surgeles: 5,
  boucherie: 6,
  local: 7,
  saison: 8,
};

/** Expérience totale nécessaire pour atteindre chaque niveau (index = niveau). */
export const LEVEL_XP = [0, 0, 150, 400, 800, 1400, 2200, 3200, 4500, 6000, 8000];
export const MAX_LEVEL = LEVEL_XP.length - 1;

export const ROLES = {
  caissier: { name: 'Caissier·ère', wage: 70, icon: 'cashier', desc: 'Tient une caisse toute la journée.' },
  rayon: { name: 'Employé·e de rayon', wage: 60, icon: 'box', desc: 'Remplit les rayons depuis la réserve.' },
} as const;
export type Role = keyof typeof ROLES;
