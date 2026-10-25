/**
 * Grille de navigation monde (0,5 m) + A* avec tas binaire et lissage par ligne de vue.
 * Couches : coût statique (ville, murs), occupation des équipements, drapeaux (réserve, portes, route).
 */
export const NAV_X0 = -100;
export const NAV_Z0 = -70;
export const NAV_CELL = 0.5;
export const NAV_W = 400;
export const NAV_H = 280;

export const F_STAFF = 1; // réserve : interdite aux clients
export const F_INTERIOR = 2; // intérieur du magasin
export const F_DOOR = 4; // porte (fermée la nuit)
export const F_ROAD = 8;
export const F_CROSSWALK = 16;
export const F_DOCK = 32;

export interface PathOpts {
  staff?: boolean;
  /** Peut traverser les portes fermées (personnel avec clés, cambrioleurs...). */
  keys?: boolean;
  /** Limite d'expansion (sécurité perfs). */
  maxIter?: number;
}

export class NavGrid {
  readonly w = NAV_W;
  readonly h = NAV_H;
  readonly cost = new Uint8Array(NAV_W * NAV_H);
  readonly flags = new Uint8Array(NAV_W * NAV_H);
  readonly occ = new Uint8Array(NAV_W * NAV_H);
  doorsClosed = false;
  version = 1;

  private g = new Float32Array(NAV_W * NAV_H);
  private parent = new Int32Array(NAV_W * NAV_H);
  private stamp = new Uint32Array(NAV_W * NAV_H);
  private closed = new Uint32Array(NAV_W * NAV_H);
  private curStamp = 1;
  private heap = new Int32Array(NAV_W * NAV_H);
  private fs = new Float32Array(NAV_W * NAV_H);

  constructor() {
    this.cost.fill(2); // herbe / terrain par défaut
  }

  idx(cx: number, cz: number) {
    return cz * NAV_W + cx;
  }
  cellX(x: number) {
    return Math.floor((x - NAV_X0) / NAV_CELL);
  }
  cellZ(z: number) {
    return Math.floor((z - NAV_Z0) / NAV_CELL);
  }
  centerX(cx: number) {
    return NAV_X0 + (cx + 0.5) * NAV_CELL;
  }
  centerZ(cz: number) {
    return NAV_Z0 + (cz + 0.5) * NAV_CELL;
  }
  inBounds(cx: number, cz: number) {
    return cx >= 0 && cz >= 0 && cx < NAV_W && cz < NAV_H;
  }

  /** Applique une valeur de coût sur un rectangle monde. cost 0 = bloqué. */
  fillRect(x0: number, z0: number, x1: number, z1: number, cost: number, flags = 0, flagMode: 'set' | 'or' | 'clear' = 'or') {
    const a = Math.max(0, this.cellX(Math.min(x0, x1) + 1e-6));
    const b = Math.min(NAV_W - 1, this.cellX(Math.max(x0, x1) - 1e-6));
    const c = Math.max(0, this.cellZ(Math.min(z0, z1) + 1e-6));
    const d = Math.min(NAV_H - 1, this.cellZ(Math.max(z0, z1) - 1e-6));
    for (let cz = c; cz <= d; cz++)
      for (let cx = a; cx <= b; cx++) {
        const i = this.idx(cx, cz);
        if (cost >= 0) this.cost[i] = cost;
        if (flagMode === 'set') this.flags[i] = flags;
        else if (flagMode === 'or') this.flags[i] |= flags;
        else this.flags[i] &= ~flags;
      }
    this.version++;
  }

  setOccRect(x0: number, z0: number, x1: number, z1: number, v: number) {
    const a = Math.max(0, this.cellX(Math.min(x0, x1) + 1e-6));
    const b = Math.min(NAV_W - 1, this.cellX(Math.max(x0, x1) - 1e-6));
    const c = Math.max(0, this.cellZ(Math.min(z0, z1) + 1e-6));
    const d = Math.min(NAV_H - 1, this.cellZ(Math.max(z0, z1) - 1e-6));
    for (let cz = c; cz <= d; cz++) for (let cx = a; cx <= b; cx++) this.occ[this.idx(cx, cz)] = v;
    this.version++;
  }

  clearOcc() {
    this.occ.fill(0);
    this.version++;
  }

  passable(i: number, o: PathOpts): boolean {
    if (this.cost[i] === 0 || this.occ[i]) return false;
    const f = this.flags[i];
    if (f & F_STAFF && !o.staff) return false;
    if (f & F_DOOR && this.doorsClosed && !o.keys) return false;
    return true;
  }

  walkableAt(x: number, z: number, o: PathOpts = {}): boolean {
    const cx = this.cellX(x);
    const cz = this.cellZ(z);
    if (!this.inBounds(cx, cz)) return false;
    return this.passable(this.idx(cx, cz), o);
  }

  flagsAt(x: number, z: number) {
    const cx = this.cellX(x);
    const cz = this.cellZ(z);
    if (!this.inBounds(cx, cz)) return 0;
    return this.flags[this.idx(cx, cz)];
  }

  /** Case praticable la plus proche (recherche en spirale). */
  nearestWalkable(x: number, z: number, o: PathOpts = {}, maxR = 12): { x: number; z: number } | null {
    const cx = this.cellX(x);
    const cz = this.cellZ(z);
    if (this.inBounds(cx, cz) && this.passable(this.idx(cx, cz), o)) return { x, z };
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inBounds(nx, nz) || !this.passable(this.idx(nx, nz), o)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = { x: this.centerX(nx), z: this.centerZ(nz) };
          }
        }
      if (best) return best;
    }
    return null;
  }

  private heapPush(n: number, size: number) {
    const h = this.heap;
    const f = this.fs;
    let i = size;
    h[i] = n;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[h[p]] <= f[h[i]]) break;
      const t = h[p];
      h[p] = h[i];
      h[i] = t;
      i = p;
    }
  }

  private heapPop(size: number): number {
    const h = this.heap;
    const f = this.fs;
    const top = h[0];
    h[0] = h[size - 1];
    let i = 0;
    const n = size - 1;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && f[h[l]] < f[h[m]]) m = l;
      if (r < n && f[h[r]] < f[h[m]]) m = r;
      if (m === i) break;
      const t = h[m];
      h[m] = h[i];
      h[i] = t;
      i = m;
    }
    return top;
  }

  /** A* 8-connexe sans coupe de coins. Renvoie une liste de points monde lissée, ou null. */
  findPath(sx: number, sz: number, tx: number, tz: number, o: PathOpts = {}): { x: number; z: number }[] | null {
    let start = { x: sx, z: sz };
    if (!this.walkableAt(sx, sz, o)) {
      const n = this.nearestWalkable(sx, sz, o, 6);
      if (!n) return null;
      start = n;
    }
    let target = { x: tx, z: tz };
    if (!this.walkableAt(tx, tz, o)) {
      const n = this.nearestWalkable(tx, tz, o, 10);
      if (!n) return null;
      target = n;
    }
    const scx = this.cellX(start.x);
    const scz = this.cellZ(start.z);
    const tcx = this.cellX(target.x);
    const tcz = this.cellZ(target.z);
    const si = this.idx(scx, scz);
    const ti = this.idx(tcx, tcz);
    if (si === ti) return [{ x: target.x, z: target.z }];

    const stamp = ++this.curStamp;
    const g = this.g;
    const par = this.parent;
    const st = this.stamp;
    const cl = this.closed;
    const fs = this.fs;
    const H = (i: number) => {
      const dx = Math.abs((i % NAV_W) - tcx);
      const dz = Math.abs(((i / NAV_W) | 0) - tcz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    g[si] = 0;
    st[si] = stamp;
    par[si] = -1;
    fs[si] = H(si);
    let size = 0;
    this.heapPush(si, size++);
    const maxIter = o.maxIter ?? 60000;
    let iter = 0;
    let found = false;
    while (size > 0) {
      const cur = this.heapPop(size--);
      if (cl[cur] === stamp) continue;
      cl[cur] = stamp;
      if (cur === ti) {
        found = true;
        break;
      }
      if (++iter > maxIter) break;
      const cx = cur % NAV_W;
      const cz = (cur / NAV_W) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= NAV_W || nz >= NAV_H) continue;
          const ni = nz * NAV_W + nx;
          if (cl[ni] === stamp || !this.passable(ni, o)) continue;
          if (dx && dz && (!this.passable(cz * NAV_W + nx, o) || !this.passable(nz * NAV_W + cx, o))) continue;
          const step = (dx && dz ? Math.SQRT2 : 1) * this.cost[ni];
          const ng = g[cur] + step;
          if (st[ni] === stamp && ng >= g[ni]) continue;
          st[ni] = stamp;
          g[ni] = ng;
          par[ni] = cur;
          fs[ni] = ng + H(ni) * 1.05;
          this.heapPush(ni, size++);
        }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = ti; c !== -1; c = par[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => ({ x: this.centerX(c % NAV_W), z: this.centerZ((c / NAV_W) | 0) }));
    pts[pts.length - 1] = { x: target.x, z: target.z };
    return this.smooth(pts, o);
  }

  /** Ligne de vue praticable entre deux points (même catégorie de coût, pas de traversée de route en diagonale). */
  lineWalkable(ax: number, az: number, bx: number, bz: number, o: PathOpts = {}): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.2);
    let firstCost = -1;
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      // échantillonne un petit rayon pour garder une marge avec les obstacles
      for (const [ox, oz] of [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]]) {
        const cx = this.cellX(x + ox);
        const cz = this.cellZ(z + oz);
        if (!this.inBounds(cx, cz)) return false;
        const i = this.idx(cx, cz);
        if (!this.passable(i, o)) return false;
        if (ox === 0 && oz === 0) {
          const c = this.cost[i];
          if (firstCost < 0) firstCost = c;
          else if ((c > 2) !== (firstCost > 2)) return false;
        }
      }
    }
    return true;
  }

  smooth(pts: { x: number; z: number }[], o: PathOpts): { x: number; z: number }[] {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 40);
      while (j > i + 1 && !this.lineWalkable(pts[i].x, pts[i].z, pts[j].x, pts[j].z, o)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}
