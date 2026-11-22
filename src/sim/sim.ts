/**
 * Simulation du magasin (sans affichage) : clients, employés, persos des joueurs, livraisons, journée, niveaux.
 * Elle tourne chez l'hôte ; le 2e joueur reçoit l'état et envoie ses actions (voir net/).
 * Toute modification passe par `apply(joueur, action)`.
 *
 * Logique d'un magasin : le livreur pose les cartons devant la porte → on les range dans la réserve (pièce du fond)
 * → on remplit les étages des rayons, article par article → les clients se servent, les rayons se vident
 * → on encaisse à la caisse.
 */
import { PRODUCT_BY_ID, PRODUCTS, type ProductDef } from '../data/products';
import { CAT_LEVEL, FURN_BY_ID, LEVEL_XP, MAX_LEVEL, ROLES, STORE_SIZES, type FurnDef, type Role } from '../data/furniture';
import { accessCells, BACK_D, BDOOR_X, canPlace, cellOf, cellsOf, centerOf, checkoutSpots, DOCK, DOOR_X, findSpot, GX0, GX1, isInside, NavGrid, storeSize, zoneOf, type Cell } from './grid';
import { Rng } from './rng';
import type { Action, AgentView, DayStats, Furn, Fx, PlayerInfo, World } from './types';

/** Minutes de jeu par seconde (à vitesse ×1) : une journée de 8 h à 20 h dure 10 minutes. */
export const MIN_PER_SEC = 1.2;
export const OPEN_MIN = 8 * 60;
export const CLOSE_MIN = 20 * 60;
const STEP = 0.1;
export const ROAD_Z = 5.2;
/** Secondes de calme après un déplacement manuel avant que le perso reprenne l'aide automatique. */
const AUTO_DELAY = 12;

export const PEOPLE = ['f_casual', 'f_formal', 'f_punk', 'f_suit', 'f_adventurer', 'm_casual_2', 'm_casual_hoodie', 'm_beach', 'm_farmer', 'm_punk', 'm_suit'];
export const PLAYER_COLORS = [0xffb300, 0x00b4ff, 0xff4f8b, 0x6ad04f];
const FIRST_NAMES = ['Inès', 'Karim', 'Léa', 'Moussa', 'Chloé', 'Yanis', 'Sofia', 'Hugo', 'Aïcha', 'Théo', 'Nina', 'Malik', 'Jade', 'Lucas', 'Fatou', 'Enzo'];

/** Articles par étage d'un rayon. */
export const levelCap = (def: FurnDef) => (def.shelf ? def.shelf.facings * def.shelf.sides * def.shelf.rows : 0);
export const shelfCap = (def: FurnDef) => (def.shelf ? def.shelf.levels.length * levelCap(def) : 0);
export const shelfStock = (f: Furn) => f.stock.reduce((a, b) => a + b, 0);

export function unlockedProducts(level: number): ProductDef[] {
  return PRODUCTS.filter((p) => CAT_LEVEL[p.category] <= level);
}

export function compatible(def: FurnDef, pid: string) {
  const p = PRODUCT_BY_ID[pid];
  if (!p || !def.shelf) return false;
  if (def.shelf.cats) return def.shelf.cats.includes(p.category);
  if (p.category === 'fruits' || p.category === 'boulangerie') return def.shelf.storage === 'ambient';
  return def.shelf.storage === p.storage;
}

/** Cartons que la réserve peut contenir (8 au sol + les racks). */
export function reserveCapacity(w: World) {
  return 8 + w.furn.reduce((s, f) => s + (FURN_BY_ID[f.def].cartons ?? 0), 0);
}

export function reserveCartons(w: World) {
  let n = 0;
  for (const [pid, u] of Object.entries(w.reserve)) if (u > 0) n += Math.ceil(u / PRODUCT_BY_ID[pid].cartonQty);
  return n;
}

/** Cartons en réserve + devant la porte + en livraison. */
export function cartonsUsed(w: World) {
  let n = reserveCartons(w) + w.dock.length;
  for (const d of w.deliveries) for (const c of Object.values(d.items)) n += c;
  return n;
}

export function stars(w: World) {
  if (!w.ratings.length) return 3;
  const avg = w.ratings.reduce((a, b) => a + b, 0) / w.ratings.length;
  return Math.round((1 + avg * 4) * 2) / 2;
}

export const maxStaff = (w: World) => Math.min(8, 1 + w.level);
export const rent = (w: World) => 40 + 25 * w.sizeIdx;
export const maxCustomers = (w: World) => Math.min(18, 3 + w.level + w.sizeIdx * 2);

const newDay = (day: number): DayStats => ({ day, revenue: 0, purchases: 0, wages: 0, rent: 0, customers: 0, served: 0, unhappy: 0, items: 0 });

const shelfLevels = (f: Furn) => FURN_BY_ID[f.def].shelf?.levels.length ?? 0;

export function emptyFurn(id: number, def: string, x: number, z: number, rot: number): Furn {
  const n = FURN_BY_ID[def].shelf?.levels.length ?? 0;
  return { id, def, x, z, rot, prod: Array(n).fill(null), stock: Array(n).fill(0) };
}

/** Nouvelle partie : petit magasin avec sa réserve, une caisse, deux étagères, une gondole et un peu de stock. */
export function createWorld(name = 'BAZAR BAZAR'): World {
  const w: World = {
    v: 3,
    rev: 1,
    name,
    code: '',
    day: 1,
    min: OPEN_MIN - 20,
    clock: 0,
    money: 1500,
    xp: 0,
    level: 1,
    sizeIdx: 0,
    furn: [],
    nextId: 1,
    reserve: { cola: 24, chips: 24, pates: 20, bonbons: 24, eau: 12, biscuits: 12, canette: 24 },
    dock: [],
    deliveries: [],
    staff: [],
    players: [],
    autoOrder: true,
    speed: 1,
    ratings: [0.6, 0.6, 0.6],
    today: newDay(1),
    lastDay: null,
  };
  const D = STORE_SIZES[0].d;
  const add = (def: string, x: number, z: number, rot: number, prods: (string | null)[] = [], fill = 0.6) => {
    const f = emptyFurn(w.nextId++, def, x, z, rot);
    const cap = levelCap(FURN_BY_ID[def]);
    prods.forEach((p, i) => {
      f.prod[i] = p;
      f.stock[i] = p ? Math.round(cap * fill) : 0;
    });
    w.furn.push(f);
  };
  // réserve (pièce du fond)
  add('rack_reserve', 4, -D - BACK_D, 0);
  add('plante', 9, -D - BACK_D, 0);
  // surface de vente
  add('gondole_simple', 3, -D, 0, ['eau', 'eau', 'cola', 'cola', 'canette']);
  add('gondole_simple', 6, -D, 0, ['chips', 'chips', 'biscuits', 'bonbons', 'bonbons']);
  add('gondole_double', 2, -5, 0, ['pates', 'pates', 'chips', 'biscuits']);
  add('tete_gondole', 5, -5, 0, ['bonbons']);
  add('caisse', 7, -4, 1);
  add('plante', 0, -1, 0);
  add('tapis', 3, -2, 0);
  return w;
}

/** Ce que le perso peut faire là où il se trouve (bouton d'action). */
export interface Context {
  k: 'dockTake' | 'rackDrop' | 'rackTake' | 'shelfFill' | 'cash';
  id: number;
  label: string;
}

const distToFurn = (f: Furn, x: number, z: number) => {
  const def = FURN_BY_ID[f.def];
  const cells = cellsOf(def, f.x, f.z, f.rot);
  const x0 = Math.min(...cells.map((c) => c.x));
  const z0 = Math.min(...cells.map((c) => c.z));
  const x1 = Math.max(...cells.map((c) => c.x)) + 1;
  const z1 = Math.max(...cells.map((c) => c.z)) + 1;
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
};

export function contextFor(w: World, x: number, z: number, carry: string | null): Context | null {
  const near = (kind: string, r: number) => {
    let best: Furn | null = null;
    let bd = r;
    for (const f of w.furn) {
      if (FURN_BY_ID[f.def].kind !== kind) continue;
      const d = distToFurn(f, x, z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  };
  if (!carry && w.dock.length && Math.hypot(x - DOCK.x, z - DOCK.z) < 1.9) return { k: 'dockTake', id: 0, label: 'Prendre un carton livré' };
  const rack = near('storage', 1.2);
  const inBack = zoneOf(w, Math.floor(x), Math.floor(z)) === 2;
  if (carry && (rack || inBack)) return { k: 'rackDrop', id: rack?.id ?? 0, label: 'Ranger en réserve' };
  if (!carry && (rack || inBack) && Object.values(w.reserve).some((v) => v > 0)) return { k: 'rackTake', id: rack?.id ?? 0, label: 'Prendre un carton' };
  if (carry) {
    const shelf = near('shelf', 1.3);
    if (shelf) return { k: 'shelfFill', id: shelf.id, label: 'Remplir ce rayon' };
  }
  for (const f of w.furn) {
    const sp = FURN_BY_ID[f.def].kind === 'checkout' ? checkoutSpots(f).cashier : null;
    if (sp && Math.hypot(sp.x - x, sp.z - z) < 1.1) return { k: 'cash', id: f.id, label: 'Tenir la caisse' };
  }
  return null;
}

type Task =
  | { t: 'cash'; id: number }
  | { t: 'fill'; id: number; level: number; pid: string; phase: 'toRack' | 'pick' | 'toShelf' | 'put' }
  | { t: 'put'; id: number }
  | { t: 'haul'; phase: 'toDock' | 'pick' | 'toRack' | 'drop' }
  | { t: 'drop'; phase: 'toRack' | 'drop' }
  | { t: 'goto'; until: number };

interface Agent extends AgentView {
  path: Cell[];
  dest: { x: number; z: number } | null;
  goal: { x: number; z: number; exact: boolean } | null;
  speed: number;
  state: string;
  t: number;
  face: number | null;
  bubbleT: number;
  // client
  wants: string[];
  basket: { pid: string; n: number }[];
  missing: number;
  wait: number;
  shelf: number;
  checkout: number;
  payT: number;
  exitX: number;
  retried: boolean;
  // employé / joueur
  carryN: number;
  task: Task | null;
  manual: boolean;
  staffId: number;
  role: Role | 'player' | null;
  think: number;
  idleT: number;
  steer: { dx: number; dz: number };
  steerT: number;
  lastSteer: number;
  // camionnette
  delivery: number;
}

export class Sim {
  w: World;
  agents: Agent[] = [];
  fx: Fx[] = [];
  nav = new NavGrid();
  rng = new Rng(Date.now() % 100000);
  private nextAgent = 1;
  private acc = 0;
  private spawnT = 4;
  private autoT = 0;
  private wishT = 0;
  private queues = new Map<number, number[]>();
  private queueCellsCache = new Map<number, Cell[]>();
  private navRev = -1;
  private emptyWarned = new Map<string, number>();

  constructor(w: World, seed?: number) {
    this.w = w;
    if (seed !== undefined) this.rng = new Rng(seed);
    this.rebuildNav();
    for (const s of w.staff) this.spawnStaff(s.id);
    for (const p of w.players) this.spawnPlayer(p);
  }

  // ------------------------------------------------------------------ utilitaires
  private touch() {
    this.w.rev++;
  }
  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', to?: string, icon?: string) {
    this.fx.push({ k: 'toast', text, kind, to, icon });
  }
  private sfx(n: string, x?: number, z?: number) {
    this.fx.push({ k: 'sfx', n, x, z });
  }
  private rebuildNav() {
    this.nav.build(this.w);
    this.navRev = this.w.rev;
    this.queueCellsCache.clear();
  }
  furn(id: number) {
    return this.w.furn.find((f) => f.id === id);
  }
  private shelves() {
    return this.w.furn.filter((f) => FURN_BY_ID[f.def].kind === 'shelf');
  }
  private checkouts() {
    return this.w.furn.filter((f) => FURN_BY_ID[f.def].kind === 'checkout');
  }
  private dist(a: { x: number; z: number }, b: { x: number; z: number }) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }
  assortment(): string[] {
    const s = new Set<string>();
    for (const f of this.shelves()) for (const p of f.prod) if (p) s.add(p);
    return [...s];
  }
  private addReserve(pid: string, n: number) {
    if (n > 0) this.w.reserve[pid] = (this.w.reserve[pid] ?? 0) + n;
  }

  private newAgent(kind: Agent['kind'], model: string, x: number, z: number): Agent {
    const a: Agent = {
      id: this.nextAgent++,
      kind,
      model,
      x,
      z,
      rot: 0,
      anim: 'idle',
      carry: null,
      bubble: null,
      tag: null,
      color: 0,
      pid: null,
      path: [],
      dest: null,
      goal: null,
      speed: 1.2,
      state: 'idle',
      t: 0,
      face: null,
      bubbleT: 0,
      wants: [],
      basket: [],
      missing: 0,
      wait: 0,
      shelf: -1,
      checkout: -1,
      payT: 0,
      exitX: 0,
      retried: false,
      carryN: 0,
      task: null,
      manual: false,
      staffId: -1,
      role: null,
      think: 0,
      idleT: 0,
      steer: { dx: 0, dz: 0 },
      steerT: 0,
      lastSteer: -1e9,
      delivery: -1,
    };
    this.agents.push(a);
    return a;
  }

  private bubble(a: Agent, b: string, t = 2.5) {
    a.bubble = b;
    a.bubbleT = t;
  }

  /** Envoie un agent vers un point. `exact` : s'arrête pile sur le point. */
  private goTo(a: Agent, x: number, z: number, exact = false): boolean {
    const s = cellOf(a.x, a.z);
    const g = cellOf(x, z);
    const p = this.nav.path(s.x, s.z, g.x, g.z);
    a.goal = { x, z, exact };
    if (!p) {
      a.path = [];
      a.dest = null;
      return false;
    }
    a.path = p;
    const last = p[p.length - 1];
    a.dest = exact && last.x === g.x && last.z === g.z ? { x, z } : { x: last.x + 0.5, z: last.z + 0.5 };
    return true;
  }

  /** Avance le long du chemin. Renvoie true une fois arrivé. */
  private walk(a: Agent, dt: number): boolean {
    if (!a.dest) return true;
    let step = a.speed * dt;
    while (step > 0) {
      const wp = a.path.length > 1 ? { x: a.path[0].x + 0.5, z: a.path[0].z + 0.5 } : a.dest;
      const dx = wp.x - a.x;
      const dz = wp.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) a.rot = Math.atan2(dx, dz);
      if (d <= step) {
        a.x = wp.x;
        a.z = wp.z;
        step -= d;
        if (a.path.length > 1) a.path.shift();
        else {
          a.path = [];
          a.dest = null;
          a.anim = 'idle';
          if (a.face !== null) a.rot = a.face;
          return true;
        }
      } else {
        a.x += (dx / d) * step;
        a.z += (dz / d) * step;
        step = 0;
      }
    }
    a.anim = 'walk';
    return false;
  }

  /** Case d'accès la plus proche d'un meuble, et l'angle pour le regarder. */
  private accessFor(a: Agent, f: Furn): { x: number; z: number; face: number } | null {
    const acc = accessCells(f).filter((c) => this.nav.free(c.x, c.z));
    if (!acc.length) return null;
    acc.sort((p, q) => this.dist(a, { x: p.x + 0.5, z: p.z + 0.5 }) - this.dist(a, { x: q.x + 0.5, z: q.z + 0.5 }));
    const c = acc[0];
    const ctr = centerOf(f);
    const fx = c.x + 0.5;
    const fz = c.z + 0.5;
    const along = f.rot % 2 === 0;
    const tx = along ? fx : ctr.x;
    const tz = along ? ctr.z : fz;
    return { x: fx, z: fz, face: Math.atan2(tx - fx, tz - fz) };
  }

  // ------------------------------------------------------------------ joueurs & personnel
  addPlayer(id: string, name: string): PlayerInfo {
    let p = this.w.players.find((q) => q.id === id);
    if (!p) {
      const used = new Set(this.w.players.map((q) => q.color));
      const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
      p = { id, name: name.slice(0, 14) || 'Joueur', color, model: this.w.players.length % 2 === 0 ? 'm_casual_hoodie' : 'f_casual', auto: true };
      this.w.players.push(p);
    } else p.name = name.slice(0, 14) || p.name;
    // jamais deux persos pour le même joueur (reconnexion)
    const mine = this.agents.filter((a) => a.pid === id);
    for (const extra of mine.slice(1)) this.agents.splice(this.agents.indexOf(extra), 1);
    if (!mine.length) this.spawnPlayer(p);
    else mine[0].tag = p.name;
    this.touch();
    return p;
  }

  removePlayer(id: string) {
    for (const a of this.agents.filter((b) => b.pid === id)) this.dropTask(a, true);
    this.w.players = this.w.players.filter((p) => p.id !== id);
    this.agents = this.agents.filter((a) => a.pid !== id);
    this.touch();
  }

  private spawnPlayer(p: PlayerInfo) {
    const a = this.newAgent('player', p.model, DOOR_X + 0.6 + (this.w.players.indexOf(p) % 2) * 0.8, -1.5);
    a.pid = p.id;
    a.tag = p.name;
    a.color = p.color;
    a.role = 'player';
    a.speed = 2.4;
  }

  private spawnStaff(staffId: number) {
    const s = this.w.staff.find((q) => q.id === staffId);
    if (!s) return;
    const a = this.newAgent('staff', s.model, DOOR_X + 0.5, 1.5);
    a.staffId = s.id;
    a.role = s.role;
    a.tag = s.name;
    a.speed = 1.6;
  }

  avatar(pid: string) {
    return this.agents.find((a) => a.pid === pid);
  }

  private playerInfo(a: Agent) {
    return a.pid ? this.w.players.find((p) => p.id === a.pid) : undefined;
  }

  // ------------------------------------------------------------------ boucle
  update(dtReal: number) {
    // les persos pilotés bougent même en pause
    if (this.w.speed <= 0) {
      for (const a of this.agents) if (a.steerT > 0) this.steerStep(a, Math.min(dtReal, 0.1));
      return;
    }
    this.acc += Math.min(dtReal, 0.25) * this.w.speed;
    let n = 0;
    while (this.acc >= STEP && n++ < 40) {
      this.acc -= STEP;
      this.step(STEP);
    }
  }

  step(dt: number) {
    const w = this.w;
    if (this.navRev !== w.rev) {
      const before = this.nav.blocked.slice();
      this.rebuildNav();
      // les meubles ont bougé : on recalcule les chemins en cours
      let changed = false;
      for (let i = 0; i < before.length; i++)
        if (before[i] !== this.nav.blocked[i]) {
          changed = true;
          break;
        }
      if (changed) for (const a of this.agents) if (a.goal && a.dest && a.kind !== 'van') this.goTo(a, a.goal.x, a.goal.z, a.goal.exact);
    }
    w.clock += dt;
    w.min += dt * MIN_PER_SEC;
    const open = w.min >= OPEN_MIN && w.min < CLOSE_MIN;

    if (open) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = this.spawnInterval();
        const inside = this.agents.filter((a) => a.kind === 'customer').length;
        if (inside < maxCustomers(w)) this.spawnCustomer();
      }
    }

    this.autoT -= dt;
    if (this.autoT <= 0) {
      this.autoT = 60 / MIN_PER_SEC;
      if (w.autoOrder) this.autoReorder();
    }
    this.wishT -= dt;

    this.updateDeliveries();

    for (const a of [...this.agents]) {
      if (a.bubbleT > 0) {
        a.bubbleT -= dt;
        if (a.bubbleT <= 0) a.bubble = null;
      }
      if (a.kind === 'customer') this.customer(a, dt);
      else if (a.kind === 'van') this.van(a, dt);
      else this.worker(a, dt);
    }

    if (w.min >= CLOSE_MIN) {
      const customers = this.agents.filter((a) => a.kind === 'customer');
      if (w.min >= CLOSE_MIN + 60) for (const c of customers) this.agents.splice(this.agents.indexOf(c), 1);
      if (!customers.length || w.min >= CLOSE_MIN + 60) this.endDay();
    }
  }

  /** Peu de monde au début ; l'affluence grandit avec les niveaux, l'assortiment, la déco et les étoiles. */
  private spawnInterval() {
    const w = this.w;
    const A = this.assortment().filter((p) => this.shelves().some((f) => f.prod.some((q, i) => q === p && f.stock[i] > 0))).length;
    const appeal = Math.min(20, w.furn.reduce((s, f) => s + (FURN_BY_ID[f.def].appeal ?? 0), 0));
    let rate = A > 0 ? 1.5 + A * 0.4 + appeal * 0.3 + (stars(w) - 3) + (w.level - 1) * 1 + Math.min(w.day, 10) * 0.2 : 0.8;
    const h = w.min / 60;
    if (h < 10) rate *= 0.7;
    else if ((h >= 12 && h < 14) || (h >= 17 && h < 19)) rate *= 1.3;
    rate = Math.max(0.8, Math.min(30, rate));
    return (60 / MIN_PER_SEC / rate) * this.rng.range(0.6, 1.4);
  }

  // ------------------------------------------------------------------ clients
  private spawnCustomer() {
    const left = this.rng.chance(0.5);
    const x = left ? GX0 + 1.5 : GX1 - 1.5;
    const a = this.newAgent('customer', this.rng.pick(PEOPLE), x, this.rng.range(1.4, 2.6));
    a.exitX = this.rng.chance(0.5) ? GX0 + 1.5 : GX1 - 1.5;
    a.speed = this.rng.range(1.1, 1.35);
    const assort = this.assortment();
    const n = Math.max(1, Math.min(assort.length, this.rng.int(1, 3)));
    const pool = [...assort];
    while (a.wants.length < n && pool.length) {
      const tot = pool.reduce((s, p) => s + PRODUCT_BY_ID[p].popularity, 0);
      let r = this.rng.next() * tot;
      let k = 0;
      for (; k < pool.length - 1; k++) {
        r -= PRODUCT_BY_ID[pool[k]].popularity;
        if (r <= 0) break;
      }
      a.wants.push(pool.splice(k, 1)[0]);
    }
    if (this.rng.chance(0.12)) {
      const missing = unlockedProducts(this.w.level).filter((p) => !assort.includes(p.id));
      if (missing.length) a.wants.push(this.rng.pick(missing).id);
    }
    this.w.today.customers++;
    a.state = 'next';
    this.sfx('door');
  }

  /** Étage d'un rayon qui propose ce produit (avec du stock si possible). */
  private levelWith(f: Furn, pid: string, needStock: boolean) {
    for (let i = 0; i < f.prod.length; i++) if (f.prod[i] === pid && (!needStock || f.stock[i] > 0)) return i;
    return -1;
  }

  private customer(a: Agent, dt: number) {
    switch (a.state) {
      case 'next': {
        const pid = a.wants.shift();
        if (!pid) return this.toCheckout(a);
        const cands = this.shelves().filter((f) => f.prod.includes(pid));
        if (!cands.length) {
          a.missing++;
          this.bubble(a, 'no:' + pid, 3);
          if (this.wishT <= 0) {
            this.wishT = 150;
            this.toast(`Un client cherche : ${PRODUCT_BY_ID[pid].name}`, 'info', undefined, 'p:' + pid);
          }
          a.state = 'think';
          a.t = 1.2;
          return;
        }
        const has = (f: Furn) => (this.levelWith(f, pid, true) >= 0 ? 1 : 0);
        cands.sort((f, g) => has(g) - has(f) || this.dist(a, centerOf(f)) - this.dist(a, centerOf(g)));
        const f = cands[0];
        const acc = this.accessFor(a, f);
        a.shelf = f.id;
        a.retried = false;
        if (!acc || !this.goTo(a, acc.x, acc.z)) {
          a.missing++;
          a.state = 'next';
          return;
        }
        a.face = acc.face;
        a.state = 'toShelf';
        a.wants.unshift(pid);
        return;
      }
      case 'think':
        a.anim = 'idle';
        a.t -= dt;
        if (a.t <= 0) a.state = 'next';
        return;
      case 'toShelf':
        if (this.walk(a, dt)) {
          a.state = 'pick';
          a.t = 1.4;
          a.anim = 'interact';
        }
        return;
      case 'pick': {
        a.t -= dt;
        a.anim = 'interact';
        if (a.t > 0) return;
        const pid = a.wants.shift()!;
        const f = this.furn(a.shelf);
        const lv = f ? this.levelWith(f, pid, true) : -1;
        if (f && lv >= 0) {
          const n = Math.min(f.stock[lv], this.rng.chance(0.3) ? 2 : 1);
          f.stock[lv] -= n;
          a.basket.push({ pid, n });
          a.carry = 'basket';
          this.bubble(a, 'p:' + pid, 1.6);
          this.touch();
        } else {
          const other = this.shelves().find((g) => g.id !== a.shelf && this.levelWith(g, pid, true) >= 0);
          if (other && !a.retried) {
            a.wants.unshift(pid);
            const acc = this.accessFor(a, other);
            if (acc && this.goTo(a, acc.x, acc.z)) {
              a.shelf = other.id;
              a.face = acc.face;
              a.retried = true;
              a.state = 'toShelf';
              return;
            }
            a.wants.shift();
          }
          a.missing++;
          this.bubble(a, 'no:' + pid, 3);
          this.warnEmpty(pid);
        }
        a.state = 'next';
        a.anim = 'idle';
        return;
      }
      case 'toQueue':
      case 'queue': {
        a.wait += dt;
        const arrived = this.walk(a, dt);
        if (arrived) a.state = 'queue';
        const q = this.queues.get(a.checkout);
        const f = this.furn(a.checkout);
        if (!q || !f) return this.toCheckout(a);
        if (q[0] === a.id && arrived && a.goal?.exact) {
          a.state = 'paying';
          a.payT = 0;
        }
        if (a.wait > 120) this.giveUp(a);
        return;
      }
      case 'paying': {
        a.wait += dt;
        a.anim = 'idle';
        const f = this.furn(a.checkout);
        if (!f) return this.toCheckout(a);
        const def = FURN_BY_ID[f.def];
        const cashier = def.self ? null : this.agents.find((b) => b.task?.t === 'cash' && b.task.id === f.id && b.state === 'atCash');
        if (!def.self && !cashier) {
          if (a.wait > 120) this.giveUp(a);
          return;
        }
        if (cashier) cashier.anim = 'interact';
        const items = a.basket.reduce((s, b) => s + b.n, 0);
        const need = def.self ? 1.5 + items * 0.7 : cashier!.kind === 'player' ? 0.8 + items * 0.35 : 1 + items * 0.5;
        a.payT += dt;
        if (a.payT >= need) {
          if (cashier) cashier.anim = 'idle';
          this.pay(a, f);
        }
        return;
      }
      case 'leave':
        if (this.walk(a, dt)) this.agents.splice(this.agents.indexOf(a), 1);
        return;
    }
  }

  /** Rayon vide et plus rien en réserve : on prévient (au plus toutes les 2 heures de jeu). */
  private warnEmpty(pid: string) {
    const w = this.w;
    if ((w.reserve[pid] ?? 0) > 0 || w.dock.some((c) => c.pid === pid) || w.deliveries.some((d) => d.items[pid])) return;
    if (w.clock - (this.emptyWarned.get(pid) ?? -1e9) < 120 / MIN_PER_SEC) return;
    this.emptyWarned.set(pid, w.clock);
    this.toast(`Plus de ${PRODUCT_BY_ID[pid].name} ! Commandez-en 🛒`, 'bad', undefined, 'p:' + pid);
  }

  private queueCells(f: Furn): Cell[] {
    let c = this.queueCellsCache.get(f.id);
    if (c) return c;
    const pay = checkoutSpots(f).pay;
    const start = cellOf(pay.x, pay.z);
    const dir = { x: Math.round(Math.sin((f.rot * Math.PI) / 2)), z: Math.round(Math.cos((f.rot * Math.PI) / 2)) };
    const seen = new Set<string>([`${start.x},${start.z}`]);
    const out: Cell[] = [start];
    let frontier: Cell[] = [start];
    while (out.length < 8 && frontier.length) {
      const next: Cell[] = [];
      for (const cur of frontier)
        for (const d of [dir, { x: -dir.z, z: dir.x }, { x: dir.z, z: -dir.x }]) {
          const n = { x: cur.x + d.x, z: cur.z + d.z };
          const k = `${n.x},${n.z}`;
          if (seen.has(k) || !isInside(this.w, n.x, n.z) || !this.nav.free(n.x, n.z)) continue;
          seen.add(k);
          next.push(n);
          out.push(n);
        }
      frontier = next;
    }
    this.queueCellsCache.set(f.id, out);
    return out;
  }

  private toCheckout(a: Agent) {
    if (!a.basket.length) return this.leave(a);
    const cos = this.checkouts();
    if (!cos.length) return this.giveUp(a);
    const score = (f: Furn) => {
      const def = FURN_BY_ID[f.def];
      const manned = def.self || this.agents.some((b) => b.task?.t === 'cash' && b.task.id === f.id);
      return (this.queues.get(f.id)?.length ?? 0) + (manned ? 0 : 3) + this.dist(a, centerOf(f)) * 0.05;
    };
    cos.sort((f, g) => score(f) - score(g));
    const f = cos[0];
    this.leaveQueue(a);
    const q = this.queues.get(f.id) ?? [];
    q.push(a.id);
    this.queues.set(f.id, q);
    a.checkout = f.id;
    a.state = 'toQueue';
    this.placeInQueue(f);
  }

  private placeInQueue(f: Furn) {
    const q = this.queues.get(f.id) ?? [];
    const cells = this.queueCells(f);
    const pay = checkoutSpots(f).pay;
    q.forEach((id, i) => {
      const a = this.agents.find((b) => b.id === id);
      if (!a || a.state === 'paying') return;
      const c = cells[Math.min(i, cells.length - 1)];
      const target = i === 0 ? pay : { x: c.x + 0.5 + (i >= cells.length ? (i - cells.length + 1) * 0.3 : 0), z: c.z + 0.5 };
      if (a.goal && Math.abs(a.goal.x - target.x) < 0.01 && Math.abs(a.goal.z - target.z) < 0.01) return;
      const ctr = centerOf(f);
      a.face = i === 0 ? Math.atan2(ctr.x - pay.x, ctr.z - pay.z) : null;
      this.goTo(a, target.x, target.z, i === 0);
      a.state = 'toQueue';
    });
  }

  private leaveQueue(a: Agent) {
    if (a.checkout < 0) return;
    const q = this.queues.get(a.checkout);
    if (q) {
      const i = q.indexOf(a.id);
      if (i >= 0) q.splice(i, 1);
      const f = this.furn(a.checkout);
      if (f) this.placeInQueue(f);
    }
    a.checkout = -1;
  }

  private pay(a: Agent, f: Furn) {
    const w = this.w;
    let total = 0;
    let items = 0;
    for (const b of a.basket) {
      total += PRODUCT_BY_ID[b.pid].price * b.n;
      items += b.n;
    }
    total = Math.round(total * 100) / 100;
    w.money = Math.round((w.money + total) * 100) / 100;
    w.today.revenue = Math.round((w.today.revenue + total) * 100) / 100;
    w.today.items += items;
    w.today.served++;
    const wanted = a.basket.length + a.missing;
    const sat = Math.max(0, Math.min(1, 1 - (0.35 * a.missing) / Math.max(1, wanted) - Math.max(0, a.wait - 30) / 90 + 0.1));
    this.rate(sat);
    const pay = checkoutSpots(f).pay;
    this.fx.push({ k: 'float', text: '+' + total.toFixed(2).replace('.', ',') + ' €', x: pay.x, z: pay.z, color: '#7CFF6B' });
    this.sfx('cash', pay.x, pay.z);
    this.gainXp(items + 2);
    a.basket = [];
    a.carry = null;
    this.bubble(a, sat > 0.7 ? 'ui:heart' : sat > 0.4 ? 'ui:ok' : 'ui:sad', 2.5);
    this.leaveQueue(a);
    this.leave(a);
    this.touch();
  }

  private rate(sat: number) {
    const w = this.w;
    w.ratings.push(sat);
    if (w.ratings.length > 40) w.ratings.shift();
    if (sat < 0.45) w.today.unhappy++;
  }

  private giveUp(a: Agent) {
    for (const b of a.basket) this.addReserve(b.pid, b.n);
    a.basket = [];
    a.carry = null;
    this.rate(0.1);
    this.bubble(a, 'ui:sad', 3);
    this.leaveQueue(a);
    this.leave(a);
    this.touch();
  }

  private leave(a: Agent) {
    a.state = 'leave';
    a.face = null;
    if (!this.goTo(a, a.exitX, this.rng.range(1.4, 2.6), true)) this.agents.splice(this.agents.indexOf(a), 1);
  }

  // ------------------------------------------------------------------ déplacement au joystick
  private tryMove(a: Agent, nx: number, nz: number): boolean {
    const c0 = cellOf(a.x, a.z);
    const c1 = cellOf(nx, nz);
    if (c0.x === c1.x && c0.z === c1.z) {
      a.x = nx;
      a.z = nz;
      return true;
    }
    if (!this.nav.free(c0.x, c0.z)) {
      // coincé dans un meuble (il vient d'être posé) : on le laisse sortir
      if (this.nav.free(c1.x, c1.z)) {
        a.x = nx;
        a.z = nz;
        return true;
      }
      return false;
    }
    const ok =
      Math.abs(c1.x - c0.x) + Math.abs(c1.z - c0.z) === 1
        ? this.nav.passable(c0.x, c0.z, c1.x, c1.z)
        : (this.nav.passable(c0.x, c0.z, c1.x, c0.z) && this.nav.passable(c1.x, c0.z, c1.x, c1.z)) || (this.nav.passable(c0.x, c0.z, c0.x, c1.z) && this.nav.passable(c0.x, c1.z, c1.x, c1.z));
    if (ok) {
      a.x = nx;
      a.z = nz;
    }
    return ok;
  }

  private steerStep(a: Agent, dt: number) {
    a.steerT -= dt;
    const m = Math.min(1, Math.hypot(a.steer.dx, a.steer.dz));
    if (a.steerT <= 0 || m < 0.05) {
      a.steerT = 0;
      a.anim = 'idle';
      return;
    }
    const sp = 2.8 * m * dt;
    const dx = (a.steer.dx / Math.max(m, 1e-6)) * sp * Math.min(1, m);
    const dz = (a.steer.dz / Math.max(m, 1e-6)) * sp * Math.min(1, m);
    a.rot = Math.atan2(dx, dz);
    if (!this.tryMove(a, a.x + dx, a.z + dz)) {
      // glisse le long des obstacles
      if (!this.tryMove(a, a.x + dx, a.z)) this.tryMove(a, a.x, a.z + dz);
    }
    a.anim = 'walk';
    a.lastSteer = this.w.clock;
  }

  // ------------------------------------------------------------------ employés et persos
  private worker(a: Agent, dt: number) {
    if (a.steerT > 0) {
      this.steerStep(a, dt);
      this.autoCash(a);
      return;
    }
    const t = a.task;
    if (!t) {
      if (a.anim === 'walk' && !a.dest) a.anim = 'idle';
      this.autoCash(a);
      if (a.task) return;
      a.think -= dt;
      if (a.think <= 0) {
        a.think = 0.8;
        this.decide(a);
      }
      if (!a.task && a.dest) this.walk(a, dt);
      return;
    }
    switch (t.t) {
      case 'goto':
        if (this.walk(a, dt)) {
          a.idleT += dt;
          if (a.idleT > t.until) {
            a.task = null;
            a.manual = false;
          }
        }
        return;
      case 'cash': {
        const f = this.furn(t.id);
        if (!f) {
          a.task = null;
          a.state = 'idle';
          return;
        }
        if (a.state === 'toCash') {
          if (this.walk(a, dt)) a.state = 'atCash';
          return;
        }
        const q = this.queues.get(f.id) ?? [];
        if (a.anim !== 'interact') a.anim = 'idle';
        if (q.length) a.idleT = 0;
        else a.idleT += dt;
        // un perso en pilote auto ou un employé de rayon rend la caisse quand il n'y a plus personne
        if (!a.manual && a.role !== 'caissier' && a.idleT > 8) {
          a.task = null;
          a.state = 'idle';
        }
        return;
      }
      case 'fill':
        return this.fillStep(a, t, dt);
      case 'put': {
        const f = this.furn(t.id);
        if (!f || !a.carry) {
          a.task = null;
          return;
        }
        if (a.dest) {
          this.walk(a, dt);
          return;
        }
        a.anim = 'interact';
        if (!this.putStep(a, f, dt)) {
          a.task = null;
          a.anim = 'idle';
        }
        return;
      }
      case 'haul':
        return this.haulStep(a, t, dt);
      case 'drop': {
        if (t.phase === 'toRack') {
          if (this.walk(a, dt)) {
            t.phase = 'drop';
            a.t = 0.6;
          }
        } else {
          a.anim = 'interact';
          a.t -= dt;
          if (a.t <= 0) {
            this.storeCarried(a);
            a.task = null;
            a.manual = false;
            a.anim = 'idle';
          }
        }
        return;
      }
    }
  }

  /** Debout derrière une caisse : on encaisse. */
  private autoCash(a: Agent) {
    if (a.kind !== 'player' || (a.task && a.task.t === 'cash')) return;
    if (a.task && a.steerT <= 0) return;
    // seulement quand on dirige soi-même son perso (sinon le pilote auto décide)
    const info = this.playerInfo(a);
    if (info?.auto && this.w.clock - a.lastSteer >= AUTO_DELAY) return;
    for (const f of this.checkouts()) {
      const sp = checkoutSpots(f).cashier;
      if (!sp || Math.hypot(sp.x - a.x, sp.z - a.z) > 0.6) continue;
      if (this.agents.some((b) => b !== a && b.task?.t === 'cash' && b.task.id === f.id && b.state === 'atCash')) continue;
      if (a.task) this.dropTask(a, false);
      a.task = { t: 'cash', id: f.id };
      a.manual = true;
      a.state = 'atCash';
      a.idleT = 0;
      return;
    }
  }

  /** Met les articles portés dans le rayon, un par un. Renvoie false quand c'est fini. */
  private putStep(a: Agent, f: Furn, dt: number): boolean {
    a.t -= dt;
    if (a.t > 0) return true;
    a.t = a.kind === 'player' ? 0.12 : 0.2;
    const pid = a.carry!;
    const def = FURN_BY_ID[f.def];
    const cap = levelCap(def);
    let lv = f.prod.findIndex((p, i) => p === pid && f.stock[i] < cap);
    if (lv < 0) {
      // étage libre (sans produit ou vide d'un autre produit choisi par personne) : on l'attribue
      lv = f.prod.findIndex((p) => p === null);
      if (lv >= 0 && compatible(def, pid)) f.prod[lv] = pid;
      else lv = -1;
    }
    if (lv < 0 || a.carryN <= 0) {
      if (a.carryN <= 0) {
        a.carry = null;
        a.carryN = 0;
      } else if (lv < 0 && a.kind === 'player' && a.manual) {
        const full = f.prod.includes(pid);
        this.toast(full ? 'Ce rayon est plein pour ce produit.' : `Pas d’étage pour ${PRODUCT_BY_ID[pid].name} ici : choisissez-le sur un étage du rayon.`, 'info', a.pid ?? undefined);
      }
      return false;
    }
    f.stock[lv]++;
    a.carryN--;
    this.touch();
    if (a.carryN <= 0) {
      a.carry = null;
      a.carryN = 0;
      this.sfx('fill', f.x, f.z);
      return false;
    }
    return true;
  }

  private fillStep(a: Agent, t: Extract<Task, { t: 'fill' }>, dt: number) {
    const f = this.furn(t.id);
    const abort = () => {
      a.task = null;
      a.manual = false;
      a.state = 'idle';
      // un carton entamé retourne en réserve
      if (a.carry && a.carryN > 0) this.startDrop(a);
    };
    if (!f || f.prod[t.level] !== t.pid) return abort();
    if (t.phase === 'toRack') {
      if (a.carry === t.pid) {
        // on a déjà le bon carton en main
        t.phase = 'toShelf';
        const acc = this.accessFor(a, f);
        if (!acc || !this.goTo(a, acc.x, acc.z)) return abort();
        a.face = acc.face;
        return;
      }
      if (this.walk(a, dt)) {
        t.phase = 'pick';
        a.t = 0.8;
      }
    } else if (t.phase === 'pick') {
      a.anim = 'interact';
      a.t -= dt;
      if (a.t > 0) return;
      const have = this.w.reserve[t.pid] ?? 0;
      const n = Math.min(have, PRODUCT_BY_ID[t.pid].cartonQty);
      if (n <= 0) return abort();
      this.w.reserve[t.pid] = have - n;
      a.carry = t.pid;
      a.carryN = n;
      t.phase = 'toShelf';
      const acc = this.accessFor(a, f);
      if (!acc || !this.goTo(a, acc.x, acc.z)) return abort();
      a.face = acc.face;
      this.touch();
    } else if (t.phase === 'toShelf') {
      if (this.walk(a, dt)) {
        t.phase = 'put';
        a.t = 0.3;
      }
    } else {
      a.anim = 'interact';
      if (!this.putStep(a, f, dt)) {
        a.anim = 'idle';
        a.task = null;
        a.manual = false;
        a.state = 'idle';
        if (a.carry && a.carryN > 0) this.startDrop(a);
      }
    }
  }

  private haulStep(a: Agent, t: Extract<Task, { t: 'haul' }>, dt: number) {
    if (t.phase === 'toDock') {
      if (!this.w.dock.length) {
        a.task = null;
        a.manual = false;
        return;
      }
      if (this.walk(a, dt)) {
        t.phase = 'pick';
        a.t = 0.6;
      }
    } else if (t.phase === 'pick') {
      a.anim = 'interact';
      a.t -= dt;
      if (a.t > 0) return;
      const c = this.w.dock.shift();
      if (!c) {
        a.task = null;
        a.manual = false;
        return;
      }
      a.carry = c.pid;
      a.carryN = c.n;
      this.touch();
      const r = this.rackSpot(a);
      a.face = r.face;
      t.phase = 'toRack';
      if (!this.goTo(a, r.x, r.z)) {
        this.storeCarried(a);
        a.task = null;
      }
    } else if (t.phase === 'toRack') {
      if (this.walk(a, dt)) {
        t.phase = 'drop';
        a.t = 0.6;
      }
    } else {
      a.anim = 'interact';
      a.t -= dt;
      if (a.t > 0) return;
      this.storeCarried(a);
      a.task = null;
      a.manual = false;
      a.anim = 'idle';
    }
  }

  private storeCarried(a: Agent) {
    if (a.carry && a.carry !== 'basket' && a.carryN > 0) this.addReserve(a.carry, a.carryN);
    if (a.carry) this.sfx('fill');
    a.carry = null;
    a.carryN = 0;
    this.touch();
  }

  /** Que faire maintenant ? (employés et persos en pilote automatique) */
  private decide(a: Agent) {
    if (a.manual) return;
    const role = a.role;
    if (role === 'player') {
      const info = this.playerInfo(a);
      if (!info?.auto || this.w.clock - a.lastSteer < AUTO_DELAY) return;
    }
    // un carton en main sans rien à en faire : on le range
    if (a.carry && a.carry !== 'basket') {
      const target = this.pickShelfToFill(a, 0.95, a.carry);
      if (target) return this.startFill(a, target.f, target.level, false);
      return this.startDrop(a);
    }
    const free = this.checkouts().filter((f) => !FURN_BY_ID[f.def].self && !this.agents.some((b) => b !== a && b.task?.t === 'cash' && b.task.id === f.id));
    if (role === 'caissier' && free.length) {
      free.sort((f, g) => (this.queues.get(g.id)?.length ?? 0) - (this.queues.get(f.id)?.length ?? 0));
      return this.startCash(a, free[0], false);
    }
    const waiting = free.filter((f) => (this.queues.get(f.id)?.length ?? 0) > 0);
    if (waiting.length && (role === 'player' || role === 'rayon')) return this.startCash(a, waiting[0], false);
    const urgent = this.pickShelfToFill(a, 0.25);
    if (urgent) return this.startFill(a, urgent.f, urgent.level, false);
    const haulers = this.agents.filter((b) => b.task?.t === 'haul').length;
    if (this.w.dock.length > haulers && reserveCartons(this.w) < reserveCapacity(this.w)) return this.startHaul(a, false);
    const shelf = this.pickShelfToFill(a, role === 'player' ? 0.5 : 0.75);
    if (shelf) return this.startFill(a, shelf.f, shelf.level, false);
    if (!a.dest && a.idleT <= 0) {
      a.idleT = 1;
      const s = storeSize(this.w);
      const spots = role === 'caissier' ? [{ x: 1, z: -s.d + 1 }] : [{ x: s.w - 1, z: -s.d }, { x: 1, z: -s.d + 1 }, { x: s.w - 2, z: -2 }];
      const sp = this.rng.pick(spots);
      const c = this.nav.nearestFree(sp.x, sp.z, 1);
      if (c && this.dist(a, { x: c.x + 0.5, z: c.z + 0.5 }) > 1.5) {
        a.face = null;
        this.goTo(a, c.x + 0.5, c.z + 0.5);
      }
    }
  }

  private pickShelfToFill(a: Agent, below: number, onlyPid?: string): { f: Furn; level: number } | null {
    let best: { f: Furn; level: number } | null = null;
    let bestScore = Infinity;
    for (const f of this.shelves()) {
      const cap = levelCap(FURN_BY_ID[f.def]);
      for (let i = 0; i < f.prod.length; i++) {
        const pid = f.prod[i];
        if (!pid || (onlyPid && pid !== onlyPid)) continue;
        if (!onlyPid && (this.w.reserve[pid] ?? 0) <= 0) continue;
        const ratio = f.stock[i] / cap;
        if (ratio >= below) continue;
        if (this.agents.some((b) => b !== a && b.task?.t === 'fill' && b.task.pid === pid && b.task.id === f.id)) continue;
        const s = ratio * 10 + this.dist(a, centerOf(f)) * 0.1;
        if (s < bestScore) {
          bestScore = s;
          best = { f, level: i };
        }
      }
    }
    return best;
  }

  private rackSpot(a: Agent): { x: number; z: number; face: number | null } {
    const racks = this.w.furn.filter((f) => FURN_BY_ID[f.def].kind === 'storage');
    let best: { x: number; z: number; face: number | null } | null = null;
    let bd = Infinity;
    for (const r of racks) {
      const acc = this.accessFor(a, r);
      if (!acc) continue;
      const d = this.dist(a, acc);
      if (d < bd) {
        bd = d;
        best = acc;
      }
    }
    if (best) return best;
    const s = storeSize(this.w);
    const c = this.nav.nearestFree(BDOOR_X + 3, -s.d - 2, 2) ?? { x: BDOOR_X, z: -s.d - 2 };
    return { x: c.x + 0.5, z: c.z + 0.5, face: null };
  }

  private startFill(a: Agent, f: Furn, level: number, manual: boolean) {
    const pid = f.prod[level];
    if (!pid) return;
    if (a.carry && a.carry !== pid) this.dropTask(a, true);
    else if (a.task) a.task = null;
    a.task = { t: 'fill', id: f.id, level, pid, phase: 'toRack' };
    a.manual = manual;
    a.state = 'fill';
    if (a.carry === pid) return;
    const r = this.rackSpot(a);
    a.face = r.face;
    if (!this.goTo(a, r.x, r.z)) {
      a.task = null;
      a.manual = false;
    }
  }

  private startHaul(a: Agent, manual: boolean) {
    if (a.carry) this.dropTask(a, true);
    a.task = { t: 'haul', phase: 'toDock' };
    a.manual = manual;
    a.face = null;
    if (!this.goTo(a, DOCK.x, DOCK.z)) {
      a.task = null;
      a.manual = false;
    }
  }

  private startDrop(a: Agent) {
    const r = this.rackSpot(a);
    a.task = { t: 'drop', phase: 'toRack' };
    a.face = r.face;
    if (!this.goTo(a, r.x, r.z)) {
      this.storeCarried(a);
      a.task = null;
    }
  }

  private startCash(a: Agent, f: Furn, manual: boolean) {
    const spot = checkoutSpots(f).cashier;
    if (!spot) return;
    this.dropTask(a, true);
    if (manual)
      for (const b of this.agents)
        if (b !== a && b.task?.t === 'cash' && b.task.id === f.id) {
          b.task = null;
          b.state = 'idle';
        }
    a.task = { t: 'cash', id: f.id };
    a.manual = manual;
    a.idleT = 0;
    a.state = 'toCash';
    const ctr = centerOf(f);
    a.face = Math.atan2(ctr.x - spot.x, ctr.z - spot.z);
    if (!this.goTo(a, spot.x, spot.z, true)) {
      a.task = null;
      a.manual = false;
    }
  }

  /** Abandonne la tâche ; `storeCarry` : le carton porté retourne directement en réserve. */
  private dropTask(a: Agent, storeCarry: boolean) {
    if (storeCarry && a.carry && a.carry !== 'basket') this.storeCarried(a);
    a.task = null;
    a.idleT = 0;
    a.state = 'idle';
  }

  // ------------------------------------------------------------------ livraisons
  private updateDeliveries() {
    const w = this.w;
    for (const d of w.deliveries) {
      if (w.clock >= d.eta - 9 && !this.agents.some((a) => a.kind === 'van' && a.delivery === d.id)) {
        const v = this.newAgent('van', 'car_stationwagon', -40, ROAD_Z);
        v.delivery = d.id;
        v.rot = Math.PI / 2;
        v.anim = 'drive';
        v.speed = 7;
        v.state = 'arrive';
        v.dest = { x: DOOR_X + 1, z: ROAD_Z };
      }
    }
  }

  private van(a: Agent, dt: number) {
    const w = this.w;
    if (a.state === 'arrive' || a.state === 'go') {
      const d = a.dest!.x - a.x;
      const s = Math.min(Math.abs(d), a.speed * dt * (a.state === 'arrive' ? Math.min(1, Math.abs(d) / 6 + 0.25) : 1));
      a.x += Math.sign(d) * s;
      a.anim = 'drive';
      if (Math.abs(d) < 0.05) {
        if (a.state === 'go') {
          this.agents.splice(this.agents.indexOf(a), 1);
          return;
        }
        a.state = 'park';
        a.anim = 'idle';
      }
      return;
    }
    if (a.state === 'park') {
      const d = w.deliveries.find((q) => q.id === a.delivery);
      if (!d) {
        a.state = 'go';
        a.dest = { x: 60, z: ROAD_Z };
        return;
      }
      if (w.clock >= d.eta) {
        let n = 0;
        for (const [pid, c] of Object.entries(d.items))
          for (let i = 0; i < c; i++) {
            w.dock.push({ pid, n: PRODUCT_BY_ID[pid].cartonQty });
            n++;
          }
        w.deliveries = w.deliveries.filter((q) => q !== d);
        this.sfx('honk', a.x, a.z);
        this.toast(`Livraison : ${n} carton${n > 1 ? 's' : ''} devant la porte, à ranger en réserve 📦`, 'good', undefined, 'ui:truck');
        this.bubble(a, 'ui:box', 2);
        a.t = 2.5;
        a.state = 'unload';
        this.touch();
      }
      return;
    }
    if (a.state === 'unload') {
      a.t -= dt;
      if (a.t <= 0) {
        a.state = 'go';
        a.dest = { x: 60, z: ROAD_Z };
      }
    }
  }

  private autoReorder() {
    const w = this.w;
    const items: Record<string, number> = {};
    const pending = new Set([...w.deliveries.flatMap((d) => Object.keys(d.items)), ...w.dock.map((c) => c.pid)]);
    for (const pid of this.assortment()) {
      if (pending.has(pid)) continue;
      if ((w.reserve[pid] ?? 0) < PRODUCT_BY_ID[pid].cartonQty) items[pid] = 1;
    }
    if (Object.keys(items).length) this.order(items, true);
  }

  orderCost(items: Record<string, number>) {
    let cost = 0;
    let cartons = 0;
    for (const [pid, c] of Object.entries(items)) {
      if (c <= 0) continue;
      const p = PRODUCT_BY_ID[pid];
      cost += p.cost * p.cartonQty * c;
      cartons += c;
    }
    return { cost: Math.round(cost * 100) / 100, cartons };
  }

  private order(items: Record<string, number>, auto = false, by?: string): { ok: boolean; reason?: string } {
    const w = this.w;
    const clean: Record<string, number> = {};
    for (const [pid, c] of Object.entries(items)) {
      const p = PRODUCT_BY_ID[pid];
      if (!p || CAT_LEVEL[p.category] > w.level || !(c > 0)) continue;
      clean[pid] = Math.min(20, Math.floor(c));
    }
    let { cost, cartons } = this.orderCost(clean);
    if (!cartons) return { ok: false };
    const room = reserveCapacity(w) - cartonsUsed(w);
    if (cartons > room) {
      if (!auto) return { ok: false, reason: 'La réserve est trop petite : achetez un rack de réserve.' };
      // réassort auto : on commande ce qui tient
      const keys = Object.keys(clean);
      while (cartons > room && keys.length) {
        delete clean[keys.pop()!];
        ({ cost, cartons } = this.orderCost(clean));
      }
      if (!cartons) return { ok: false };
    }
    if (cost > w.money - (auto ? 50 : 0)) return { ok: false, reason: 'Pas assez d’argent.' };
    w.money = Math.round((w.money - cost) * 100) / 100;
    w.today.purchases = Math.round((w.today.purchases + cost) * 100) / 100;
    w.deliveries.push({ id: w.nextId++, items: clean, eta: w.clock + 20 + this.rng.range(0, 10) });
    this.touch();
    if (!auto) this.toast('Commande passée ! La camionnette arrive.', 'info', by, 'ui:truck');
    return { ok: true };
  }

  // ------------------------------------------------------------------ progression et journée
  private gainXp(n: number) {
    const w = this.w;
    w.xp += n;
    while (w.level < MAX_LEVEL && w.xp >= LEVEL_XP[w.level + 1]) {
      w.level++;
      const bonus = 100 * w.level;
      w.money += bonus;
      this.fx.push({ k: 'levelup', level: w.level });
      this.sfx('level');
      this.touch();
    }
  }

  private endDay() {
    const w = this.w;
    const wages = w.staff.reduce((s, st) => s + ROLES[st.role].wage, 0);
    const r = rent(w);
    w.money = Math.round((w.money - wages - r) * 100) / 100;
    w.today.wages = wages;
    w.today.rent = r;
    w.lastDay = w.today;
    this.fx.push({ k: 'day', stats: w.today, stars: stars(w) });
    w.day++;
    w.min = OPEN_MIN - 25;
    w.today = newDay(w.day);
    this.queues.clear();
    this.touch();
  }

  // ------------------------------------------------------------------ actions des joueurs
  apply(pid: string, act: Action): boolean {
    const w = this.w;
    const err = (t: string) => {
      this.toast(t, 'bad', pid);
      this.sfx('nope');
      return false;
    };
    const me = this.avatar(pid);
    switch (act.t) {
      case 'build': {
        const def = FURN_BY_ID[act.def];
        if (!def) return false;
        if (def.level > w.level) return err(`Débloqué au niveau ${def.level}`);
        if (w.money < def.price) return err('Pas assez d’argent.');
        const ok = canPlace(w, act.def, act.x, act.z, act.rot);
        if (!ok.ok) return err(ok.reason ?? 'Impossible ici');
        const f = emptyFurn(w.nextId++, act.def, act.x, act.z, ((act.rot % 4) + 4) % 4);
        if (def.kind === 'shelf') this.suggestProducts(f);
        w.furn.push(f);
        w.money -= def.price;
        this.sfx('build', f.x, f.z);
        this.touch();
        return true;
      }
      case 'move': {
        const f = this.furn(act.id);
        if (!f) return false;
        const ok = canPlace(w, f.def, act.x, act.z, act.rot, f.id);
        if (!ok.ok) return err(ok.reason ?? 'Impossible ici');
        f.x = act.x;
        f.z = act.z;
        f.rot = ((act.rot % 4) + 4) % 4;
        this.queueCellsCache.delete(f.id);
        if (FURN_BY_ID[f.def].kind === 'checkout') {
          this.rebuildNav();
          for (const a of this.agents) {
            if (a.task?.t === 'cash' && a.task.id === f.id) this.startCash(a, f, a.manual);
            if (a.kind === 'customer' && a.checkout === f.id && a.state === 'paying') a.state = 'toQueue';
          }
          this.placeInQueue(f);
        }
        this.sfx('build', f.x, f.z);
        this.touch();
        return true;
      }
      case 'sell': {
        const f = this.furn(act.id);
        if (!f) return false;
        const def = FURN_BY_ID[f.def];
        if (def.kind === 'checkout' && this.checkouts().length <= 1) return err('Il faut garder au moins une caisse.');
        if (def.kind === 'storage' && reserveCartons(w) > reserveCapacity(w) - (def.cartons ?? 0)) return err('Ce rack est plein : videz la réserve d’abord.');
        f.prod.forEach((p, i) => p && this.addReserve(p, f.stock[i]));
        w.money += Math.round(def.price * 0.5);
        w.furn = w.furn.filter((g) => g !== f);
        for (const a of this.agents) {
          const t = a.task;
          if (t && (t.t === 'cash' || t.t === 'fill' || t.t === 'put') && t.id === f.id) {
            this.dropTask(a, false);
            a.manual = false;
            if (a.carry && a.carry !== 'basket') this.startDrop(a);
          }
          if (a.kind === 'customer' && a.checkout === f.id) {
            a.checkout = -1;
            this.toCheckout(a);
          }
        }
        this.queues.delete(f.id);
        this.sfx('sell');
        this.touch();
        return true;
      }
      case 'product': {
        const f = this.furn(act.id);
        if (!f || !(act.level >= 0 && act.level < shelfLevels(f))) return false;
        const def = FURN_BY_ID[f.def];
        if (act.pid && (!compatible(def, act.pid) || CAT_LEVEL[PRODUCT_BY_ID[act.pid].category] > w.level)) return err('Ce produit ne va pas dans ce meuble.');
        const old = f.prod[act.level];
        if (old === act.pid) return true;
        if (old && f.stock[act.level]) this.addReserve(old, f.stock[act.level]);
        f.prod[act.level] = act.pid;
        f.stock[act.level] = 0;
        this.touch();
        return true;
      }
      case 'fill': {
        const f = this.furn(act.id);
        if (!f || !me) return false;
        const def = FURN_BY_ID[f.def];
        const cap = levelCap(def);
        // l'étage le plus vide dont on a du stock en réserve (ou celui du carton porté)
        let best = -1;
        for (let i = 0; i < f.prod.length; i++) {
          const p = f.prod[i];
          if (!p || f.stock[i] >= cap) continue;
          if (me.carry !== p && (w.reserve[p] ?? 0) <= 0) continue;
          if (best < 0 || f.stock[i] < f.stock[best]) best = i;
        }
        if (best < 0) {
          if (!f.prod.some(Boolean)) return err('Choisissez d’abord les produits de ce rayon.');
          if (f.prod.every((p, i) => !p || f.stock[i] >= cap)) return err('Le rayon est déjà plein.');
          return err('Plus de stock en réserve pour ce rayon : commandez !');
        }
        me.steerT = 0;
        me.lastSteer = -1e9;
        this.startFill(me, f, best, true);
        return true;
      }
      case 'cash': {
        const f = this.furn(act.id);
        if (!f || !me) return false;
        if (FURN_BY_ID[f.def].self) return err('Cette caisse fonctionne toute seule.');
        me.steerT = 0;
        this.startCash(me, f, true);
        return true;
      }
      case 'haul': {
        if (!me) return false;
        if (!w.dock.length) return err('Aucun carton à ranger.');
        if (reserveCartons(w) >= reserveCapacity(w)) return err('La réserve est pleine.');
        me.steerT = 0;
        this.startHaul(me, true);
        return true;
      }
      case 'goto': {
        if (!me) return false;
        this.dropTask(me, false);
        me.task = { t: 'goto', until: 15 };
        me.manual = true;
        me.idleT = 0;
        me.face = null;
        me.steerT = 0;
        this.goTo(me, act.x, act.z, true);
        return true;
      }
      case 'steer': {
        if (!me) return false;
        const dx = Number(act.dx) || 0;
        const dz = Number(act.dz) || 0;
        const m = Math.hypot(dx, dz);
        me.steer = m > 1 ? { dx: dx / m, dz: dz / m } : { dx, dz };
        if (m > 0.05) {
          // on prend la main : la tâche en cours s'arrête, le carton reste dans les bras
          if (me.task && me.task.t !== 'cash') this.dropTask(me, false);
          if (me.task?.t === 'cash' && me.state === 'atCash') this.dropTask(me, false);
          me.manual = false;
          me.path = [];
          me.dest = null;
          me.goal = null;
          me.steerT = 0.5;
          me.lastSteer = w.clock;
        } else me.steerT = 0;
        return true;
      }
      case 'use': {
        if (!me) return false;
        const c = contextFor(w, me.x, me.z, me.carry);
        if (!c) return err('Rien à faire ici.');
        me.lastSteer = w.clock;
        if (c.k === 'dockTake') {
          const k = w.dock.shift();
          if (!k) return false;
          me.carry = k.pid;
          me.carryN = k.n;
          me.anim = 'interact';
        } else if (c.k === 'rackDrop') {
          this.storeCarried(me);
        } else if (c.k === 'rackTake') {
          const p = act.pid && (w.reserve[act.pid] ?? 0) > 0 ? act.pid : null;
          if (!p) return err('Choisissez un produit de la réserve.');
          const n = Math.min(w.reserve[p], PRODUCT_BY_ID[p].cartonQty);
          w.reserve[p] -= n;
          me.carry = p;
          me.carryN = n;
        } else if (c.k === 'shelfFill') {
          const f = this.furn(c.id)!;
          me.task = { t: 'put', id: f.id };
          me.manual = true;
          me.t = 0.2;
          me.face = Math.atan2(centerOf(f).x - me.x, centerOf(f).z - me.z);
          me.rot = me.face;
        } else if (c.k === 'cash') {
          const f = this.furn(c.id)!;
          this.startCash(me, f, true);
        }
        this.touch();
        return true;
      }
      case 'auto': {
        const p = w.players.find((q) => q.id === pid);
        if (!p) return false;
        p.auto = !!act.on;
        if (me && !p.auto && !me.manual) {
          if (me.task?.t !== 'cash') this.dropTask(me, false);
        }
        this.touch();
        return true;
      }
      case 'order': {
        const r = this.order(act.items, false, pid);
        if (!r.ok) return r.reason ? err(r.reason) : false;
        return true;
      }
      case 'autoOrder':
        w.autoOrder = !!act.on;
        this.touch();
        return true;
      case 'hire': {
        if (!ROLES[act.role]) return false;
        if (w.staff.length >= maxStaff(w)) return err(`Maximum ${maxStaff(w)} employés à ce niveau.`);
        const used = new Set(w.staff.map((s) => s.name));
        const name = FIRST_NAMES.find((n) => !used.has(n) && this.rng.chance(0.5)) ?? FIRST_NAMES.find((n) => !used.has(n)) ?? 'Alex';
        const s = { id: w.nextId++, role: act.role, name, model: this.rng.chance(0.5) ? 'm_worker' : 'f_worker' };
        w.staff.push(s);
        this.spawnStaff(s.id);
        this.toast(`${name} rejoint l’équipe !`, 'good', undefined, 'ui:handshake');
        this.touch();
        return true;
      }
      case 'fire': {
        const s = w.staff.find((q) => q.id === act.id);
        if (!s) return false;
        w.staff = w.staff.filter((q) => q !== s);
        const a = this.agents.find((b) => b.staffId === s.id);
        if (a) {
          this.dropTask(a, true);
          this.agents.splice(this.agents.indexOf(a), 1);
        }
        this.touch();
        return true;
      }
      case 'expand': {
        const next = STORE_SIZES[w.sizeIdx + 1];
        if (!next) return err('Le magasin est déjà à sa taille maximale.');
        if (next.level > w.level) return err(`Agrandissement débloqué au niveau ${next.level}`);
        if (w.money < next.price) return err('Pas assez d’argent.');
        w.money -= next.price;
        const oldD = STORE_SIZES[w.sizeIdx].d;
        w.sizeIdx++;
        // la réserve recule avec le fond du magasin : ses meubles aussi
        const dz = next.d - oldD;
        for (const f of w.furn) if (zoneOf({ ...w, sizeIdx: w.sizeIdx - 1 }, f.x, f.z) === 2) f.z -= dz;
        relocateInvalid(w, this.fx);
        for (const a of this.agents) if (a.z < -oldD && a.kind !== 'customer') a.z -= dz;
        this.rebuildNav();
        this.sfx('level');
        this.toast('Le magasin s’agrandit ! 🎉', 'good', undefined, 'ui:party');
        this.touch();
        return true;
      }
      case 'speed':
        w.speed = Math.max(0, Math.min(3, Math.round(act.v)));
        this.touch();
        return true;
      case 'rename':
        w.name = String(act.name).slice(0, 20) || w.name;
        this.touch();
        return true;
    }
    return false;
  }

  /** Produits proposés pour un nouveau rayon : ceux qui ne sont pas encore en rayon (en stock d'abord). */
  suggestProducts(f: Furn) {
    const def = FURN_BY_ID[f.def];
    const assort = new Set(this.assortment());
    const cands = unlockedProducts(this.w.level).filter((p) => compatible(def, p.id));
    const fresh = cands.filter((p) => !assort.has(p.id));
    fresh.sort((a, b) => ((this.w.reserve[b.id] ?? 0) > 0 ? 1 : 0) - ((this.w.reserve[a.id] ?? 0) > 0 ? 1 : 0) || b.popularity - a.popularity);
    const list = fresh.length ? fresh : cands;
    for (let i = 0; i < f.prod.length; i++) f.prod[i] = list.length ? list[Math.min(i, list.length - 1)].id : null;
  }

  /** Personnages visibles (pour l'écran et le réseau). */
  views(): AgentView[] {
    return this.agents.map((a) => ({
      id: a.id,
      kind: a.kind,
      model: a.model,
      x: Math.round(a.x * 100) / 100,
      z: Math.round(a.z * 100) / 100,
      rot: Math.round(a.rot * 100) / 100,
      anim: a.anim,
      carry: a.carry,
      bubble: a.bubble,
      tag: a.tag,
      color: a.color,
      pid: a.pid,
    }));
  }

  /** Ce que fait un perso (tests et interface). */
  taskOf(pid: string): string {
    const a = this.avatar(pid);
    if (!a?.task) return '';
    return a.task.t + (a.manual ? '!' : '');
  }

  drainFx(): Fx[] {
    const f = this.fx;
    this.fx = [];
    return f;
  }
}

/** Meubles mal placés (ancienne sauvegarde, agrandissement) : déplacés à une place libre, ou revendus. */
export function relocateInvalid(w: World, fx?: Fx[]) {
  for (const f of [...w.furn]) {
    if (canPlace(w, f.def, f.x, f.z, f.rot, f.id).ok) continue;
    const others = w.furn.filter((g) => g !== f);
    const tmp = { ...w, furn: others };
    const spot = findSpot(tmp, f.def, f.rot);
    if (spot) {
      f.x = spot.x;
      f.z = spot.z;
      f.rot = spot.rot;
    } else {
      w.furn = others;
      w.money += FURN_BY_ID[f.def].price;
      f.prod.forEach((p, i) => {
        if (p && f.stock[i]) w.reserve[p] = (w.reserve[p] ?? 0) + f.stock[i];
      });
      fx?.push({ k: 'toast', text: `${FURN_BY_ID[f.def].name} n’avait plus de place : remboursé.`, kind: 'info' });
    }
  }
}
