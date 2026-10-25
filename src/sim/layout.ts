/**
 * Géométrie du magasin : paliers d'agrandissement, grille de construction, transformations des équipements,
 * positions des facings de rayon et points d'accès. Mathématiques pures (testables sans rendu).
 */
import { CELL, EQUIPMENT_BY_ID, type EquipmentDef } from '../data/equipment';
import { PRODUCT_BY_ID, type ProductDef } from '../data/products';
import type { PlacedEquip, StoreConfig } from './state';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface StageDef {
  name: string;
  x0: number;
  x1: number;
  z1: number;
  /** Profondeur de la réserve (m) depuis le mur du fond. */
  back: number;
  cost: number;
  land: string | null;
  days: number;
  rentPerDay: number;
}

/** Façade avant à z = 0, le magasin s'étend vers +z. La route principale est à z ≈ -20. */
export const STAGES: StageDef[] = [
  { name: 'Supérette', x0: -8, x1: 8, z1: 14, back: 4, cost: 0, land: null, days: 0, rentPerDay: 55 },
  { name: 'Supérette agrandie', x0: -8, x1: 16, z1: 14, back: 4, cost: 16000, land: 'est', days: 2, rentPerDay: 85 },
  { name: 'Supermarché de quartier', x0: -8, x1: 16, z1: 22, back: 6, cost: 38000, land: null, days: 3, rentPerDay: 130 },
  { name: 'Grande surface', x0: -8, x1: 32, z1: 28, back: 7, cost: 95000, land: 'est2', days: 5, rentPerDay: 240 },
];

export interface LandDef {
  id: string;
  name: string;
  price: number;
  rect: [number, number, number, number];
  desc: string;
}
export const LANDS: LandDef[] = [
  { id: 'est', name: 'Terrain vague Est', price: 9000, rect: [8, 0, 16, 14], desc: 'Nécessaire pour agrandir la surface de vente vers l’est.' },
  { id: 'est2', name: 'Ancien garage Est', price: 32000, rect: [16, 0, 32, 28], desc: 'Grande parcelle pour la grande surface.' },
  { id: 'parking', name: 'Extension du parking', price: 7000, rect: [16, -13, 36, -2], desc: '+12 places : plus de clients motorisés (familles, gros paniers).' },
];

/** Origine de la grille de construction (coin x0,z0 du palier maximum). */
export const GRID_X0 = -8;
export const GRID_Z0 = 0;
export const GRID_W = (32 - -8) / CELL; // 80
export const GRID_D = 28 / CELL; // 56
export const WALL_H = 4.2;
export const FACADE_SEG = 2;

export interface StoreRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  backZ: number;
  stage: number;
  staffDoorX: number;
  dockDoorX: number;
}

export function storeRect(stage: number): StoreRect {
  const s = STAGES[Math.max(0, Math.min(STAGES.length - 1, stage))];
  return {
    x0: s.x0,
    x1: s.x1,
    z0: 0,
    z1: s.z1,
    backZ: s.z1 - s.back,
    stage,
    staffDoorX: s.x0 + 1.75,
    dockDoorX: s.x0 + 2.5,
  };
}

export const facadeSegments = (stage: number) => Math.round((STAGES[stage].x1 - STAGES[stage].x0) / FACADE_SEG);

export function defaultFacade(stage: number): StoreConfig['facade'] {
  const n = facadeSegments(stage);
  const arr: StoreConfig['facade'] = [];
  const door = Math.floor(n / 2) - 1;
  for (let i = 0; i < n; i++) arr.push(i === door ? 'porte' : i === 0 || i === n - 1 ? 'mur' : 'vitrine');
  return arr;
}

/** Ajuste la façade lors d'un agrandissement en conservant les choix du joueur. */
export function resizeFacade(old: StoreConfig['facade'], stage: number): StoreConfig['facade'] {
  const n = facadeSegments(stage);
  const out = old.slice(0, n);
  while (out.length < n) out.push(out.length === n - 1 ? 'mur' : 'vitrine');
  if (!out.includes('porte')) out[Math.floor(n / 2) - 1] = 'porte';
  return out;
}

export function doorCenters(facade: StoreConfig['facade'], stage: number): number[] {
  const x0 = STAGES[stage].x0;
  const res: number[] = [];
  facade.forEach((t, i) => {
    if (t === 'porte') res.push(x0 + i * FACADE_SEG + FACADE_SEG / 2);
  });
  return res;
}

// ---------------------------------------------------------------- Équipements

export const footprint = (def: EquipmentDef, rot: number) => (rot % 2 === 0 ? { w: def.w, d: def.d } : { w: def.d, d: def.w });

export function equipCenter(e: Pick<PlacedEquip, 'def' | 'gx' | 'gz' | 'rot'>): { x: number; z: number } {
  const def = EQUIPMENT_BY_ID[e.def];
  const f = footprint(def, e.rot);
  return { x: GRID_X0 + (e.gx + f.w / 2) * CELL, z: GRID_Z0 + (e.gz + f.d / 2) * CELL };
}

/** Angle de rotation (rad) : la face avant locale (+z) est tournée de rot × 90°. */
export const rotAngle = (rot: number) => (rot * Math.PI) / 2;

/** Transforme un point local (x, y, z) de l'équipement en coordonnées monde. */
export function localToWorld(e: Pick<PlacedEquip, 'def' | 'gx' | 'gz' | 'rot'>, lx: number, ly: number, lz: number): V3 {
  const c = equipCenter(e);
  const a = rotAngle(e.rot);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: c.x + lx * cos + lz * sin, y: ly, z: c.z - lx * sin + lz * cos };
}

/** Direction monde d'un vecteur local horizontal. */
export function localDir(rot: number, lx: number, lz: number): { x: number; z: number } {
  const a = rotAngle(rot);
  return { x: lx * Math.cos(a) + lz * Math.sin(a), z: -lx * Math.sin(a) + lz * Math.cos(a) };
}

export function cellsOf(e: Pick<PlacedEquip, 'def' | 'gx' | 'gz' | 'rot'>): [number, number][] {
  const def = EQUIPMENT_BY_ID[e.def];
  const f = footprint(def, e.rot);
  const out: [number, number][] = [];
  for (let i = 0; i < f.w; i++) for (let j = 0; j < f.d; j++) out.push([e.gx + i, e.gz + j]);
  return out;
}

export const cellCenter = (gx: number, gz: number) => ({ x: GRID_X0 + (gx + 0.5) * CELL, z: GRID_Z0 + (gz + 0.5) * CELL });
export const worldToCell = (x: number, z: number) => ({ gx: Math.floor((x - GRID_X0) / CELL), gz: Math.floor((z - GRID_Z0) / CELL) });

// ---------------------------------------------------------------- Rayonnages

export const slotCount = (def: EquipmentDef) => (def.shelf ? def.shelf.levels.length * def.shelf.facings * def.shelf.sides : 0);

export interface SlotInfo {
  side: number;
  level: number;
  facing: number;
  /** Largeur du facing (m). */
  width: number;
  depth: number;
  clearance: number;
  /** Centre de la face avant (monde) au niveau de la tablette. */
  front: V3;
  /** Normale sortante (monde, horizontale). */
  normal: { x: number; z: number };
  /** Point où se tient un agent pour accéder au facing. */
  access: { x: number; z: number };
}

export function slotIndex(def: EquipmentDef, side: number, level: number, facing: number) {
  const s = def.shelf!;
  return (side * s.levels.length + level) * s.facings + facing;
}

export function slotLocal(def: EquipmentDef, idx: number) {
  const s = def.shelf!;
  const L = s.levels.length;
  const F = s.facings;
  const facing = idx % F;
  const level = Math.floor(idx / F) % L;
  const side = Math.floor(idx / (F * L));
  const W = def.w * CELL; // largeur locale (avant rotation)
  const D = def.d * CELL;
  const fw = W / F;
  // x local du centre du facing, de gauche à droite vu depuis la face concernée
  const lx = side === 0 ? -W / 2 + (facing + 0.5) * fw : W / 2 - (facing + 0.5) * fw;
  let frontZ: number;
  let backZ: number;
  if (s.sides === 2) {
    frontZ = side === 0 ? D / 2 - 0.02 : -D / 2 + 0.02;
    backZ = 0;
  } else {
    backZ = -D / 2 + 0.04;
    frontZ = Math.min(D / 2 - 0.01, backZ + s.depth);
  }
  const dir = side === 0 ? 1 : -1;
  return { side, level, facing, lx, frontZ, backZ, dir, fw, y: s.levels[level], clearance: s.clearance[level], depth: Math.abs(frontZ - backZ) };
}

export function slotInfo(e: PlacedEquip, idx: number): SlotInfo {
  const def = EQUIPMENT_BY_ID[e.def];
  const l = slotLocal(def, idx);
  const front = localToWorld(e, l.lx, l.y, l.frontZ);
  const n = localDir(e.rot, 0, l.dir);
  const reach = 0.55;
  return {
    side: l.side,
    level: l.level,
    facing: l.facing,
    width: l.fw,
    depth: l.depth,
    clearance: l.clearance,
    front,
    normal: n,
    access: { x: front.x + n.x * reach, z: front.z + n.z * reach },
  };
}

export interface ItemLayout {
  cols: number;
  rows: number;
  stacks: number;
  capacity: number;
  /** Dimensions effectives (rotation éventuelle pour coucher la baguette, etc.). */
  w: number;
  h: number;
  d: number;
}

const layoutCache = new Map<string, ItemLayout>();

/** Capacité d'un facing pour un produit donné, calculée à partir des dimensions réelles. */
export function itemLayout(def: EquipmentDef, idx: number, p: ProductDef): ItemLayout {
  const key = `${def.id}:${idx}:${p.id}`;
  const c = layoutCache.get(key);
  if (c) return c;
  const l = slotLocal(def, idx);
  let [w, h, d] = p.size;
  // les produits longs sont posés en profondeur
  if (w > d * 1.8 && w > l.fw * 0.6) [w, d] = [d, w];
  const gap = 0.008;
  const cols = Math.max(1, Math.floor((l.fw - 0.02) / (w + gap)));
  const rows = Math.max(1, Math.floor((l.depth - 0.02) / (d + gap)));
  let stacks = 1;
  if (def.shelf?.pile) stacks = 4;
  else if (p.stackable || def.shelf?.storage === 'frozen') stacks = Math.max(1, Math.min(4, Math.floor((l.clearance - 0.02) / (h + 0.004))));
  if (h > l.clearance) stacks = 1;
  let capacity = cols * rows * stacks;
  if (def.shelf?.pile) capacity = pyramidCapacity(cols, rows, stacks);
  const res = { cols, rows, stacks, capacity: Math.max(1, capacity), w, h, d };
  layoutCache.set(key, res);
  return res;
}

const pyramidCapacity = (c: number, r: number, s: number) => {
  let n = 0;
  for (let k = 0; k < s; k++) n += Math.max(1, c - k) * Math.max(1, r - k);
  return n;
};

export const fitsHeight = (def: EquipmentDef, idx: number, p: ProductDef) => p.size[1] <= slotLocal(def, idx).clearance + 0.01 || p.shape === 'bread';

export function slotCapacity(e: PlacedEquip, idx: number, pid?: string | null): number {
  const id = pid ?? e.slots?.[idx]?.pid;
  if (!id) return 0;
  return itemLayout(EQUIPMENT_BY_ID[e.def], idx, PRODUCT_BY_ID[id]).capacity;
}

/**
 * Positions locales (repère équipement) de chaque unité dans un facing, ordonnées du fond vers l'avant :
 * quand le stock baisse, ce sont les places avant qui se vident (comme en vrai, on se sert devant).
 */
export function itemLocalPositions(def: EquipmentDef, idx: number, p: ProductDef): { x: number; y: number; z: number; ry: number }[] {
  const l = slotLocal(def, idx);
  const lay = itemLayout(def, idx, p);
  const out: { x: number; y: number; z: number; ry: number }[] = [];
  const rotated = lay.w !== p.size[0];
  const usedW = lay.cols * (lay.w + 0.008);
  const pile = !!def.shelf?.pile;
  for (let s = 0; s < lay.stacks; s++) {
    const cols = pile ? Math.max(1, lay.cols - s) : lay.cols;
    const rows = pile ? Math.max(1, lay.rows - s) : lay.rows;
    for (let r = rows - 1; r >= 0; r--) {
      for (let c = 0; c < cols; c++) {
        const offX = pile ? (s * (lay.w + 0.008)) / 2 : 0;
        const offZ = pile ? (s * (lay.d + 0.008)) / 2 : 0;
        const x = l.lx - usedW / 2 + (c + 0.5) * (lay.w + 0.008) + offX;
        const zFromFront = 0.012 + (r + 0.5) * (lay.d + 0.008) + offZ;
        const z = l.frontZ - l.dir * zFromFront;
        out.push({ x, y: l.y + s * (lay.h + 0.003) + lay.h / 2, z, ry: rotated ? Math.PI / 2 : 0 });
      }
    }
  }
  // tri : stacks du bas d'abord, puis du fond vers l'avant
  return out.slice(0, lay.capacity);
}

// ---------------------------------------------------------------- Caisses

export interface CheckoutPoints {
  cashier: { x: number; z: number; face: number };
  pay: { x: number; z: number; face: number };
  queue: { x: number; z: number }[];
  belt: V3[];
  exit: { x: number; z: number };
}

export function checkoutPoints(e: PlacedEquip): CheckoutPoints {
  const toW = (lx: number, lz: number) => {
    const p = localToWorld(e, lx, 0, lz);
    return { x: p.x, z: p.z };
  };
  const a = rotAngle(e.rot);
  if (e.def === 'caisse_auto') {
    const pay = toW(0, 0.95);
    return {
      cashier: { ...toW(0, -0.9), face: a },
      pay: { ...pay, face: a + Math.PI },
      queue: [toW(0, 1.75), toW(0, 2.5), toW(0.7, 3.1), toW(0.7, 3.8)],
      belt: [localToWorld(e, -0.2, 0.95, 0.15), localToWorld(e, 0.2, 0.95, 0.15)],
      exit: toW(-1.3, 1.2),
    };
  }
  const belt: V3[] = [];
  for (let i = 0; i < 12; i++) belt.push(localToWorld(e, 1.25 - (i % 6) * 0.22, 0.95, 0.12 - Math.floor(i / 6) * 0.14));
  return {
    cashier: { ...toW(-0.35, -0.9), face: a },
    pay: { ...toW(-0.55, 0.85), face: a + Math.PI },
    queue: [toW(0.6, 0.85), toW(1.3, 0.85), toW(2.0, 0.85), toW(2.7, 0.85), toW(3.4, 0.85), toW(4.1, 0.85)],
    belt,
    exit: toW(-2.2, 0.85),
  };
}

/** Cases qui doivent rester libres autour d'un équipement (accès clients, opérateur). */
export function accessCells(e: Pick<PlacedEquip, 'def' | 'gx' | 'gz' | 'rot'>): [number, number][] {
  const def = EQUIPMENT_BY_ID[e.def];
  const pts: { x: number; z: number }[] = [];
  if (def.shelf) {
    const L = def.shelf.levels.length;
    const F = def.shelf.facings;
    for (let side = 0; side < def.shelf.sides; side++)
      for (let f = 0; f < F; f++) {
        const l = slotLocal(def, (side * L + 0) * F + f);
        const p = localToWorld(e, l.lx, 0, l.frontZ + l.dir * 0.35);
        pts.push(p);
      }
  }
  if (def.id === 'caisse') {
    for (const [lx, lz] of [[-0.35, -0.85], [-0.55, 0.85], [0.6, 0.85]]) pts.push(localToWorld(e, lx, 0, lz));
  }
  if (def.id === 'caisse_auto') pts.push(localToWorld(e, 0, 0, 0.95));
  if (def.id === 'rack_reserve' || def.id === 'chambre_froide') pts.push(localToWorld(e, 0, 0, (def.d * CELL) / 2 + 0.35));
  return pts.map((p) => {
    const c = { gx: Math.floor((p.x - GRID_X0) / CELL), gz: Math.floor((p.z - GRID_Z0) / CELL) };
    return [c.gx, c.gz] as [number, number];
  });
}
