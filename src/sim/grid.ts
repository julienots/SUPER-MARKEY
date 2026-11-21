/**
 * Plan du magasin : grille d'un mètre, emprises des meubles, cases d'accès, chemins (A*).
 * Intérieur : x ∈ [0, W), z ∈ [-D, 0). La porte est dans la façade (z = 0), le trottoir devant (z ∈ [0, 3)).
 */
import { FURN_BY_ID, STORE_SIZES, type FurnDef } from '../data/furniture';
import type { Furn, World } from './types';

export const DOOR_X = 3; // cases x = 3 et 4
export const DOOR_W = 2;
export const SIDEWALK_Z0 = 0;
export const SIDEWALK_Z1 = 3;
export const GX0 = -14;
export const GX1 = 36;
export const GZ0 = -16;
export const GZ1 = SIDEWALK_Z1;
const GW = GX1 - GX0;
const GD = GZ1 - GZ0;

export const storeSize = (w: World) => STORE_SIZES[w.sizeIdx];

export interface Cell {
  x: number;
  z: number;
}

/** Vecteur « devant » d'un quart de tour. */
export function facing(rot: number): Cell {
  return [
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
  ][((rot % 4) + 4) % 4];
}

export function dims(def: FurnDef, rot: number) {
  return rot % 2 === 0 ? { w: def.w, d: def.d } : { w: def.d, d: def.w };
}

/** Cases occupées. */
export function cellsOf(def: FurnDef, x: number, z: number, rot: number): Cell[] {
  const { w, d } = dims(def, rot);
  const out: Cell[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push({ x: x + i, z: z + j });
  return out;
}

/** Centre monde de l'emprise. */
export function centerOf(f: { def: string; x: number; z: number; rot: number }) {
  const { w, d } = dims(FURN_BY_ID[f.def], f.rot);
  return { x: f.x + w / 2, z: f.z + d / 2 };
}

/** Repère local → monde (local x le long du meuble, local z vers l'avant). */
export function localToWorld(f: { def: string; x: number; z: number; rot: number }, lx: number, lz: number) {
  const c = centerOf(f);
  const a = (f.rot * Math.PI) / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // rotation autour de Y (sens three.js) : x' = x cos + z sin ; z' = -x sin + z cos
  return { x: c.x + lx * cos + lz * sin, z: c.z - lx * sin + lz * cos };
}

/** Cases d'accès devant (et derrière pour les meubles double face). */
export function accessCells(f: { def: string; x: number; z: number; rot: number }): Cell[] {
  const def = FURN_BY_ID[f.def];
  const cells = cellsOf(def, f.x, f.z, f.rot);
  const out: Cell[] = [];
  const add = (dir: Cell) => {
    for (const c of cells) {
      const n = { x: c.x + dir.x, z: c.z + dir.z };
      if (!cells.some((k) => k.x === n.x && k.z === n.z)) out.push(n);
    }
  };
  if (def.kind === 'deco') return [];
  const fwd = facing(f.rot);
  add(fwd);
  if (def.shelf?.sides === 2) add({ x: -fwd.x, z: -fwd.z });
  return out;
}

/** Caisse : où se tient le caissier et où paie le client (positions monde). */
export function checkoutSpots(f: Furn) {
  const def = FURN_BY_ID[f.def];
  if (def.self) {
    const pay = localToWorld(f, 0, 0.85);
    return { cashier: null, pay };
  }
  return { cashier: localToWorld(f, -0.45, -0.85), pay: localToWorld(f, -0.2, 0.85) };
}

export const cellOf = (x: number, z: number): Cell => ({ x: Math.floor(x), z: Math.floor(z) });

export function isInside(w: World, x: number, z: number) {
  const s = storeSize(w);
  return x >= 0 && x < s.w && z >= -s.d && z < 0;
}

const isSidewalk = (x: number, z: number) => z >= SIDEWALK_Z0 && z < SIDEWALK_Z1 && x >= GX0 && x < GX1;
export const isDoorCell = (x: number, z: number) => x >= DOOR_X && x < DOOR_X + DOOR_W && (z === -1 || z === 0);

/** Grille d'obstacles (1 = bloqué). */
export class NavGrid {
  blocked = new Uint8Array(GW * GD);
  inside = new Uint8Array(GW * GD);
  rev = -1;

  idx(x: number, z: number) {
    if (x < GX0 || x >= GX1 || z < GZ0 || z >= GZ1) return -1;
    return x - GX0 + (z - GZ0) * GW;
  }

  build(w: World, ignoreId = -1, extra?: Cell[]) {
    this.blocked.fill(1);
    this.inside.fill(0);
    const s = storeSize(w);
    for (let x = GX0; x < GX1; x++)
      for (let z = GZ0; z < GZ1; z++) {
        const i = this.idx(x, z);
        if (isInside(w, x, z)) {
          this.blocked[i] = 0;
          this.inside[i] = 1;
        } else if (isSidewalk(x, z)) this.blocked[i] = 0;
      }
    void s;
    for (const f of w.furn) {
      if (f.id === ignoreId) continue;
      const def = FURN_BY_ID[f.def];
      if (def.walkable) continue;
      for (const c of cellsOf(def, f.x, f.z, f.rot)) {
        const i = this.idx(c.x, c.z);
        if (i >= 0) this.blocked[i] = 1;
      }
    }
    if (extra)
      for (const c of extra) {
        const i = this.idx(c.x, c.z);
        if (i >= 0) this.blocked[i] = 1;
      }
    this.rev = w.rev;
  }

  free(x: number, z: number) {
    const i = this.idx(x, z);
    return i >= 0 && !this.blocked[i];
  }

  /** On peut passer de a à b (voisins) : les murs ne se franchissent que par la porte. */
  passable(ax: number, az: number, bx: number, bz: number) {
    if (!this.free(bx, bz)) return false;
    const ia = this.inside[this.idx(ax, az)];
    const ib = this.inside[this.idx(bx, bz)];
    if (ia === ib) return true;
    return ax === bx && isDoorCell(ax, az) && isDoorCell(bx, bz);
  }

  /** Case libre la plus proche (si on est coincé dans un meuble). */
  nearestFree(x: number, z: number, preferInside?: boolean): Cell | null {
    if (this.free(x, z)) return { x, z };
    for (let r = 1; r < 12; r++) {
      let best: Cell | null = null;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const c = { x: x + dx, z: z + dz };
          if (!this.free(c.x, c.z)) continue;
          if (preferInside !== undefined && !!this.inside[this.idx(c.x, c.z)] !== preferInside) continue;
          if (!best) best = c;
        }
      if (best) return best;
    }
    return null;
  }

  /** A* sur 8 voisins, sans couper les coins. Renvoie les centres de cases (départ exclu). */
  path(sx: number, sz: number, tx: number, tz: number): Cell[] | null {
    const start = this.nearestFree(sx, sz);
    const goal = this.free(tx, tz) ? { x: tx, z: tz } : this.nearestFree(tx, tz);
    if (!start || !goal) return null;
    const si = this.idx(start.x, start.z);
    const gi = this.idx(goal.x, goal.z);
    if (si === gi) return [goal];
    const n = GW * GD;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open: number[] = [si];
    const fScore = new Float32Array(n).fill(Infinity);
    g[si] = 0;
    const h = (i: number) => {
      const x = (i % GW) + GX0;
      const z = Math.floor(i / GW) + GZ0;
      const dx = Math.abs(x - goal.x);
      const dz = Math.abs(z - goal.z);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    fScore[si] = h(si);
    let guard = 0;
    while (open.length && guard++ < 20000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (fScore[open[k]] < fScore[open[bi]]) bi = k;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === gi) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = (cur % GW) + GX0;
      const cz = Math.floor(cur / GW) + GZ0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.passable(cx, cz, nx, nz)) continue;
          if (dx && dz && (!this.passable(cx, cz, nx, cz) || !this.passable(cx, cz, cx, nz))) continue;
          const ni = this.idx(nx, nz);
          if (closed[ni]) continue;
          const ng = g[cur] + (dx && dz ? 1.414 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            from[ni] = cur;
            fScore[ni] = ng + h(ni);
            open.push(ni);
          }
        }
    }
    if (from[gi] < 0) return null;
    const out: Cell[] = [];
    for (let i = gi; i !== si && i >= 0; i = from[i]) out.push({ x: (i % GW) + GX0, z: Math.floor(i / GW) + GZ0 });
    out.reverse();
    return out;
  }

  /** Cases atteignables depuis la porte (intérieur). */
  reachable(): Uint8Array {
    const seen = new Uint8Array(GW * GD);
    const q: number[] = [];
    for (let x = DOOR_X; x < DOOR_X + DOOR_W; x++) {
      const i = this.idx(x, -1);
      if (i >= 0 && !this.blocked[i]) {
        seen[i] = 1;
        q.push(i);
      }
    }
    while (q.length) {
      const cur = q.pop()!;
      const cx = (cur % GW) + GX0;
      const cz = Math.floor(cur / GW) + GZ0;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const nz = cz + dz;
        const ni = this.idx(nx, nz);
        if (ni < 0 || seen[ni] || !this.inside[ni] || this.blocked[ni]) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  }
}

/** Peut-on poser ce meuble ici ? Vérifie l'emprise, la porte et que tout reste accessible. */
export function canPlace(w: World, defId: string, x: number, z: number, rot: number, ignoreId = -1): { ok: boolean; reason?: string } {
  const def = FURN_BY_ID[defId];
  if (!def) return { ok: false, reason: 'Meuble inconnu' };
  const cells = cellsOf(def, x, z, rot);
  for (const c of cells) {
    if (!isInside(w, c.x, c.z)) return { ok: false, reason: 'En dehors du magasin' };
    if (!def.walkable && isDoorCell(c.x, c.z)) return { ok: false, reason: 'Devant la porte' };
  }
  for (const f of w.furn) {
    if (f.id === ignoreId) continue;
    const od = FURN_BY_ID[f.def];
    // un tapis peut être sous rien d'autre qu'un passage ; deux meubles « durs » ne se chevauchent pas
    if (!!od.walkable !== !!def.walkable) continue;
    for (const c of cellsOf(od, f.x, f.z, f.rot)) if (cells.some((k) => k.x === c.x && k.z === c.z)) return { ok: false, reason: 'Il y a déjà un meuble' };
  }
  if (def.walkable) return { ok: true };
  // accessibilité : toutes les cases d'accès (de ce meuble et des autres) doivent rester joignables depuis la porte
  const nav = new NavGrid();
  nav.build(w, ignoreId, cells);
  const seen = nav.reachable();
  const me = { def: defId, x, z, rot };
  const check = (f: { def: string; x: number; z: number; rot: number }) => {
    const acc = accessCells(f);
    if (!acc.length) return true;
    return acc.some((c) => {
      const i = nav.idx(c.x, c.z);
      return i >= 0 && seen[i];
    });
  };
  if (!check(me)) return { ok: false, reason: 'L’avant du meuble doit rester accessible' };
  for (const f of w.furn) if (f.id !== ignoreId && !check(f)) return { ok: false, reason: 'Ça bloquerait un autre meuble' };
  return { ok: true };
}

/** Premier emplacement libre pour un meuble (achat direct). */
export function findSpot(w: World, defId: string, rot = 0, near?: Cell): { x: number; z: number; rot: number } | null {
  const s = storeSize(w);
  const cands: { x: number; z: number; rot: number; d: number }[] = [];
  for (const r of [rot, (rot + 2) % 4, (rot + 1) % 4, (rot + 3) % 4])
    for (let x = 0; x < s.w; x++)
      for (let z = -s.d; z < 0; z++) {
        const d = near ? Math.abs(x - near.x) + Math.abs(z - near.z) : -z * 0.2 + Math.abs(x - s.w / 2) * 0.1;
        cands.push({ x, z, rot: r, d: d + (r === rot ? 0 : 3) });
      }
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) if (canPlace(w, defId, c.x, c.z, c.rot).ok) return { x: c.x, z: c.z, rot: c.rot };
  return null;
}
