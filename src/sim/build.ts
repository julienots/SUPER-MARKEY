/**
 * Règles de construction : validité d'un placement (murs, zones, collisions, dégagements, accessibilité),
 * achat, déplacement, revente. La disposition conditionne réellement la circulation des agents.
 */
import { CELL, EQUIPMENT_BY_ID, type EquipmentDef } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { accessCells, cellsOf, doorCenters, footprint, GRID_D, GRID_W, GRID_X0, GRID_Z0, storeRect, type StoreRect } from './layout';
import { ensureSlots, slotQty } from './inventory';
import { tryBuy } from './economy';
import { allocUid, type GameState, type PlacedEquip } from './state';

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
}

const inGrid = (gx: number, gz: number) => gx >= 0 && gz >= 0 && gx < GRID_W && gz < GRID_D;
const cellX = (gx: number) => GRID_X0 + (gx + 0.5) * CELL;
const cellZ = (gz: number) => GRID_Z0 + (gz + 0.5) * CELL;

export function cellZone(r: StoreRect, gx: number, gz: number): 'sales' | 'backroom' | 'out' {
  const x = cellX(gx);
  const z = cellZ(gz);
  if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return 'out';
  return z < r.backZ ? 'sales' : 'backroom';
}

/** Cases qui doivent rester libres : entrées, porte du personnel, quai. */
export function reservedCells(st: GameState): Set<number> {
  const r = storeRect(st.store.stage);
  const set = new Set<number>();
  const mark = (x0: number, z0: number, x1: number, z1: number) => {
    for (let gx = 0; gx < GRID_W; gx++)
      for (let gz = 0; gz < GRID_D; gz++) {
        const x = cellX(gx);
        const z = cellZ(gz);
        if (x > x0 && x < x1 && z > z0 && z < z1) set.add(gz * GRID_W + gx);
      }
  };
  for (const dx of doorCenters(st.store.facade, st.store.stage)) mark(dx - 1.2, r.z0, dx + 1.2, r.z0 + 1.6);
  mark(r.staffDoorX - 1, r.backZ - 1.2, r.staffDoorX + 1, r.backZ + 1.2);
  mark(r.dockDoorX - 1.4, r.z1 - 1.6, r.dockDoorX + 1.4, r.z1);
  return set;
}

export interface OccGrid {
  floor: Int32Array; // uid ou 0
  ceil: Int32Array;
  wall: Int32Array;
}

export function occupancy(st: GameState, ignoreUid = -1): OccGrid {
  const floor = new Int32Array(GRID_W * GRID_D);
  const ceil = new Int32Array(GRID_W * GRID_D);
  const wall = new Int32Array(GRID_W * GRID_D);
  for (const e of st.equipment) {
    if (e.uid === ignoreUid) continue;
    const d = EQUIPMENT_BY_ID[e.def];
    const g = d.mount === 'floor' ? floor : d.mount === 'ceiling' ? ceil : wall;
    for (const [gx, gz] of cellsOf(e)) if (inGrid(gx, gz)) g[gz * GRID_W + gx] = e.uid;
  }
  return { floor, ceil, wall };
}

function touchesWall(r: StoreRect, cells: [number, number][]): boolean {
  for (const [gx, gz] of cells) {
    const x0 = GRID_X0 + gx * CELL;
    const z0 = GRID_Z0 + gz * CELL;
    if (Math.abs(x0 - r.x0) < 0.01 || Math.abs(x0 + CELL - r.x1) < 0.01 || Math.abs(z0 + CELL - r.z1) < 0.01) return true;
    if (Math.abs(z0 + CELL - r.backZ) < 0.01 || Math.abs(z0 - r.backZ) < 0.01) return true;
  }
  return false;
}

/** Accessibilité : toutes les cases d'accès doivent être joignables depuis l'entrée (BFS sur la grille du magasin). */
export function reachableFromEntrance(st: GameState, blocked: Uint8Array): Uint8Array {
  const r = storeRect(st.store.stage);
  const seen = new Uint8Array(GRID_W * GRID_D);
  const q: number[] = [];
  for (const dx of doorCenters(st.store.facade, st.store.stage)) {
    const gx = Math.floor((dx - GRID_X0) / CELL);
    const i = 0 * GRID_W + gx;
    if (!blocked[i]) {
      seen[i] = 1;
      q.push(i);
    }
  }
  while (q.length) {
    const i = q.pop()!;
    const gx = i % GRID_W;
    const gz = (i / GRID_W) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx;
      const nz = gz + dz;
      if (!inGrid(nx, nz)) continue;
      const ni = nz * GRID_W + nx;
      if (seen[ni] || blocked[ni]) continue;
      if (cellZone(r, nx, nz) === 'out') continue;
      // la cloison de la réserve n'est franchissable qu'à la porte du personnel
      const z = cellZ(nz);
      const zPrev = cellZ(gz);
      if ((zPrev < r.backZ) !== (z < r.backZ) && Math.abs(cellX(nx) - r.staffDoorX) > 0.75) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

export function canPlace(st: GameState, defId: string, gx: number, gz: number, rot: 0 | 1 | 2 | 3, ignoreUid = -1): PlaceCheck {
  const def: EquipmentDef = EQUIPMENT_BY_ID[defId];
  if (!def) return { ok: false, reason: 'Équipement inconnu' };
  if ((def.stage ?? 0) > st.store.stage) return { ok: false, reason: `Débloqué au palier « agrandissement ${def.stage} »` };
  const r = storeRect(st.store.stage);
  const probe = { def: defId, gx, gz, rot };
  const cells = cellsOf(probe);
  const res = reservedCells(st);
  const occ = occupancy(st, ignoreUid);
  for (const [cx, cz] of cells) {
    if (!inGrid(cx, cz)) return { ok: false, reason: 'Hors du magasin' };
    const zone = cellZone(r, cx, cz);
    if (zone === 'out') return { ok: false, reason: 'Hors du magasin' };
    if (def.zone !== 'any' && zone !== def.zone) return { ok: false, reason: def.zone === 'sales' ? 'Réservé à la surface de vente' : 'Réservé à la réserve' };
    if (def.mount === 'floor' && zone === 'backroom' && cellZ(cz) < r.backZ + CELL) return { ok: false, reason: 'Trop près de la cloison' };
    const i = cz * GRID_W + cx;
    if (def.mount === 'floor') {
      if (occ.floor[i]) return { ok: false, reason: 'Emplacement occupé' };
      if (res.has(i) && !def.passable) return { ok: false, reason: 'Passage à laisser libre (porte)' };
    } else if (def.mount === 'ceiling') {
      if (occ.ceil[i]) return { ok: false, reason: 'Déjà un équipement au plafond ici' };
    } else if (occ.wall[i]) return { ok: false, reason: 'Déjà un élément mural ici' };
  }
  // pas à cheval sur la cloison de la réserve
  const zones = new Set(cells.map(([cx, cz]) => cellZone(r, cx, cz)));
  if (zones.size > 1) return { ok: false, reason: 'À cheval sur la cloison de la réserve' };
  if (def.mount === 'wall' && !touchesWall(r, cells)) return { ok: false, reason: 'Doit être fixé contre un mur' };
  if (def.mount !== 'floor' || def.passable) return { ok: true };

  // dégagements d'accès (faces des rayons, caisses) et accessibilité globale
  const blocked = new Uint8Array(GRID_W * GRID_D);
  for (let i = 0; i < blocked.length; i++) if (occ.floor[i] && !EQUIPMENT_BY_ID[st.equipment.find((e) => e.uid === occ.floor[i])?.def ?? 'plante']?.passable) blocked[i] = 1;
  for (const [cx, cz] of cells) blocked[cz * GRID_W + cx] = 1;
  const newAccess = accessCells(probe);
  for (const [ax, az] of newAccess) {
    if (!inGrid(ax, az) || cellZone(r, ax, az) === 'out') return { ok: false, reason: 'Face d’accès contre un mur : tournez l’équipement (R)' };
    if (blocked[az * GRID_W + ax]) return { ok: false, reason: 'Accès bloqué par un autre équipement' };
  }
  const seen = reachableFromEntrance(st, blocked);
  for (const [ax, az] of newAccess) if (!seen[az * GRID_W + ax]) return { ok: false, reason: 'Inaccessible depuis l’entrée' };
  for (const e of st.equipment) {
    if (e.uid === ignoreUid) continue;
    const ed = EQUIPMENT_BY_ID[e.def];
    if (ed.mount !== 'floor') continue;
    const acc = accessCells(e);
    // un équipement existant ne doit pas perdre tous ses accès
    if (acc.length && acc.every(([ax, az]) => !inGrid(ax, az) || blocked[az * GRID_W + ax] || !seen[az * GRID_W + ax])) return { ok: false, reason: `Bloquerait l’accès à « ${ed.name} »` };
  }
  return { ok: true };
}

export function placeEquipment(st: GameState, defId: string, gx: number, gz: number, rot: 0 | 1 | 2 | 3, free = false): { ok: boolean; reason?: string; e?: PlacedEquip } {
  const chk = canPlace(st, defId, gx, gz, rot);
  if (!chk.ok) return chk;
  const def = EQUIPMENT_BY_ID[defId];
  if (!free && !tryBuy(st, 'equipement', def.price)) return { ok: false, reason: 'Trésorerie insuffisante' };
  const e: PlacedEquip = { uid: allocUid(st), def: defId, gx, gz, rot, wear: 0 };
  if (def.id.startsWith('caisse')) {
    e.open = true;
    e.till = 0;
  }
  ensureSlots(e);
  st.equipment.push(e);
  return { ok: true, e };
}

export function moveEquipment(st: GameState, uid: number, gx: number, gz: number, rot: 0 | 1 | 2 | 3): PlaceCheck {
  const e = st.equipment.find((x) => x.uid === uid);
  if (!e) return { ok: false, reason: 'Introuvable' };
  const chk = canPlace(st, e.def, gx, gz, rot, uid);
  if (!chk.ok) return chk;
  // la rotation change l'ordre des facings mais pas leur contenu : on garde le stock
  e.gx = gx;
  e.gz = gz;
  e.rot = rot;
  return { ok: true };
}

/** Revend un équipement (50 % de sa valeur, moins l'usure). Le stock qu'il contenait part en réserve sous forme de cartons. */
export function sellEquipment(st: GameState, uid: number): { ok: boolean; refund: number; returned: number } {
  const i = st.equipment.findIndex((x) => x.uid === uid);
  if (i < 0) return { ok: false, refund: 0, returned: 0 };
  const e = st.equipment[i];
  const def = EQUIPMENT_BY_ID[e.def];
  let returned = 0;
  const r = storeRect(st.store.stage);
  const drop = (pid: string, q: number, exp: number, opened: boolean) => {
    st.worldCartons.push({ uid: allocUid(st), pid, q, exp, opened, x: r.dockDoorX + 1.5 + Math.random() * 2, y: 0.3, z: r.z1 - 1.2 - Math.random(), ry: Math.random() * 3 });
  };
  e.slots?.forEach((s) => {
    if (!s.pid) return;
    for (const l of s.lots) {
      returned += l.q;
      // regroupe en cartons ouverts
      let q = l.q;
      const cq = PRODUCT_BY_ID[s.pid].cartonQty;
      while (q > 0) {
        const n = Math.min(cq, q);
        drop(s.pid, n, l.exp, true);
        q -= n;
      }
    }
  });
  e.cartons?.forEach((c) => {
    returned += c.q;
    drop(c.pid, c.q, c.exp, c.opened);
  });
  const refund = Math.round(def.price * 0.5 * (1 - e.wear * 0.5));
  st.cash += refund;
  st.today.expenses.equipement -= refund;
  st.equipment.splice(i, 1);
  return { ok: true, refund, returned };
}

export const shelfStockCount = (e: PlacedEquip) => (e.slots ?? []).reduce((a, s) => a + slotQty(s), 0);

export { footprint };

/**
 * Après un agrandissement, la cloison de la réserve recule : les équipements de réserve qui se retrouvent
 * en surface de vente sont déplacés automatiquement vers la nouvelle réserve (si la place le permet).
 */
export function relocateAfterExpansion(st: GameState): { moved: number; stuck: string[] } {
  const r = storeRect(st.store.stage);
  let moved = 0;
  const stuck: string[] = [];
  for (const e of [...st.equipment]) {
    const def = EQUIPMENT_BY_ID[e.def];
    if (def.zone === 'any') continue;
    const cells = cellsOf(e);
    const ok = cells.every(([gx, gz]) => cellZone(r, gx, gz) === def.zone) && canPlace(st, e.def, e.gx, e.gz, e.rot, e.uid).ok;
    if (ok) continue;
    let done = false;
    for (let gz = GRID_D - 1; gz >= 0 && !done; gz--)
      for (let gx = 0; gx < GRID_W && !done; gx++)
        for (const rot of [e.rot, ((e.rot + 2) % 4) as 0 | 1 | 2 | 3]) {
          if (canPlace(st, e.def, gx, gz, rot, e.uid).ok) {
            e.gx = gx;
            e.gz = gz;
            e.rot = rot;
            moved++;
            done = true;
            break;
          }
        }
    if (!done) stuck.push(def.name);
  }
  return { moved, stuck };
}
