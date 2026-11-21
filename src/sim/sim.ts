/**
 * Simulation du magasin (sans affichage) : clients, employés, avatars des joueurs, livraisons, journée, niveaux.
 * Elle tourne chez l'hôte ; le 2e joueur reçoit l'état et envoie ses actions (voir net/).
 * Toute modification passe par `apply(joueur, action)`.
 */
import { PRODUCT_BY_ID, PRODUCTS, type ProductDef } from '../data/products';
import { CAT_LEVEL, FURN_BY_ID, LEVEL_XP, MAX_LEVEL, ROLES, STORE_SIZES, type FurnDef, type Role } from '../data/furniture';
import { accessCells, canPlace, cellOf, centerOf, checkoutSpots, DOOR_X, findSpot, GX0, GX1, isInside, NavGrid, storeSize, type Cell } from './grid';
import { Rng } from './rng';
import type { Action, AgentView, DayStats, Furn, Fx, PlayerInfo, World } from './types';

/** Minutes de jeu par seconde (à vitesse ×1) : une journée de 8 h à 20 h dure 6 minutes. */
export const MIN_PER_SEC = 2;
export const OPEN_MIN = 8 * 60;
export const CLOSE_MIN = 20 * 60;
const STEP = 0.1;
export const ROAD_Z = 5.2;

export const PEOPLE = ['f_casual', 'f_formal', 'f_punk', 'f_suit', 'f_adventurer', 'm_casual_2', 'm_casual_hoodie', 'm_beach', 'm_farmer', 'm_punk', 'm_suit'];
export const PLAYER_COLORS = [0xffb300, 0x00b4ff, 0xff4f8b, 0x6ad04f];
const FIRST_NAMES = ['Inès', 'Karim', 'Léa', 'Moussa', 'Chloé', 'Yanis', 'Sofia', 'Hugo', 'Aïcha', 'Théo', 'Nina', 'Malik', 'Jade', 'Lucas', 'Fatou', 'Enzo'];

export const shelfCap = (def: FurnDef) => (def.shelf ? def.shelf.levels.length * def.shelf.facings * def.shelf.sides * def.shelf.rows : 0);

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

export function reserveCapacity(w: World) {
  return 8 + w.furn.reduce((s, f) => s + (FURN_BY_ID[f.def].cartons ?? 0), 0);
}

export function cartonsUsed(w: World) {
  let n = 0;
  for (const [pid, u] of Object.entries(w.reserve)) if (u > 0) n += Math.ceil(u / PRODUCT_BY_ID[pid].cartonQty);
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

const newDay = (day: number): DayStats => ({ day, revenue: 0, purchases: 0, wages: 0, rent: 0, customers: 0, served: 0, unhappy: 0, items: 0 });

/** Nouvelle partie : petit magasin avec une caisse, deux étagères, une gondole et un peu de stock. */
export function createWorld(name = 'BAZAR BAZAR'): World {
  const w: World = {
    v: 2,
    rev: 1,
    name,
    day: 1,
    min: OPEN_MIN - 20,
    clock: 0,
    money: 1500,
    xp: 0,
    level: 1,
    sizeIdx: 0,
    furn: [],
    nextId: 1,
    reserve: { cola: 30, chips: 24, pates: 20, bonbons: 24, eau: 18, biscuits: 12 },
    deliveries: [],
    staff: [],
    players: [],
    autoOrder: true,
    speed: 1,
    ratings: [0.6, 0.6, 0.6],
    today: newDay(1),
    lastDay: null,
  };
  const add = (def: string, x: number, z: number, rot: number, product: string | null = null, stock = 0) =>
    w.furn.push({ id: w.nextId++, def, x, z, rot, product, stock });
  add('rack_reserve', 0, -8, 0);
  add('gondole_simple', 3, -8, 0, 'cola', 18);
  add('gondole_simple', 6, -8, 0, 'chips', 16);
  add('gondole_double', 2, -5, 0, 'pates', 14);
  add('tete_gondole', 5, -5, 0, 'bonbons', 6);
  add('caisse', 7, -4, 1);
  add('plante', 0, -1, 0);
  add('tapis', 3, -2, 0);
  return w;
}

type Task =
  | { t: 'cash'; id: number }
  | { t: 'fill'; id: number; phase: 'toRack' | 'pick' | 'toShelf' | 'put'; pid: string; n: number }
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
  task: Task | null;
  manual: boolean;
  staffId: number;
  role: Role | 'player' | null;
  think: number;
  idleT: number;
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
  private spawnT = 2;
  private autoT = 0;
  private wishT = 0;
  private queues = new Map<number, number[]>();
  private queueCellsCache = new Map<number, Cell[]>();
  private navRev = -1;

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
    for (const f of this.shelves()) if (f.product) s.add(f.product);
    return [...s];
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
      speed: 1.3,
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
      task: null,
      manual: false,
      staffId: -1,
      role: null,
      think: 0,
      idleT: 0,
      delivery: -1,
    };
    this.agents.push(a);
    return a;
  }

  private bubble(a: Agent, b: string, t = 2.5) {
    a.bubble = b;
    a.bubbleT = t;
  }

  /** Envoie un agent vers un point (chemin calculé). `exact` : s'arrête pile sur le point. */
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

  private faceTo(a: Agent, x: number, z: number) {
    a.face = Math.atan2(x - a.x, z - a.z);
  }

  /** Case d'accès la plus proche d'un meuble, et l'angle pour le regarder. */
  private accessFor(a: Agent, f: Furn): { x: number; z: number; face: number } | null {
    const acc = accessCells(f).filter((c) => this.nav.free(c.x, c.z));
    if (!acc.length) return null;
    acc.sort((p, q) => this.dist(a, { x: p.x + 0.5, z: p.z + 0.5 }) - this.dist(a, { x: q.x + 0.5, z: q.z + 0.5 }));
    const c = acc[0];
    const ctr = centerOf(f);
    // regarder le meuble : direction perpendiculaire à sa face
    const fx = c.x + 0.5;
    const fz = c.z + 0.5;
    const def = FURN_BY_ID[f.def];
    const along = f.rot % 2 === 0;
    const tx = along ? fx : ctr.x;
    const tz = along ? ctr.z : fz;
    void def;
    return { x: fx, z: fz, face: Math.atan2(tx - fx, tz - fz) };
  }

  // ------------------------------------------------------------------ joueurs & personnel
  addPlayer(id: string, name: string): PlayerInfo {
    let p = this.w.players.find((q) => q.id === id);
    if (!p) {
      const used = new Set(this.w.players.map((q) => q.color));
      const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
      p = { id, name: name.slice(0, 14) || 'Joueur', color, model: this.w.players.length % 2 === 0 ? 'm_casual_hoodie' : 'f_casual' };
      this.w.players.push(p);
      this.touch();
    } else {
      p.name = name.slice(0, 14) || p.name;
    }
    if (!this.agents.some((a) => a.pid === id)) this.spawnPlayer(p);
    return p;
  }

  removePlayer(id: string) {
    this.w.players = this.w.players.filter((p) => p.id !== id);
    this.agents = this.agents.filter((a) => a.pid !== id);
    this.touch();
  }

  private spawnPlayer(p: PlayerInfo) {
    const a = this.newAgent('player', p.model, DOOR_X + 1 + this.w.players.indexOf(p) * 0.6, -1.5);
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
    a.speed = 1.7;
  }

  avatar(pid: string) {
    return this.agents.find((a) => a.pid === pid);
  }

  // ------------------------------------------------------------------ boucle
  update(dtReal: number) {
    if (this.w.speed <= 0) return;
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
      this.rebuildNav();
      // les meubles ont bougé : on recalcule les chemins en cours
      for (const a of this.agents) if (a.goal && a.dest && a.kind !== 'van') this.goTo(a, a.goal.x, a.goal.z, a.goal.exact);
    }
    w.clock += dt;
    w.min += dt * MIN_PER_SEC;
    const open = w.min >= OPEN_MIN && w.min < CLOSE_MIN;

    // clients
    if (open) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = this.spawnInterval();
        const inside = this.agents.filter((a) => a.kind === 'customer').length;
        if (inside < 8 + w.sizeIdx * 5) this.spawnCustomer();
      }
    }

    // réassort automatique, une fois par heure de jeu
    this.autoT -= dt;
    if (this.autoT <= 0) {
      this.autoT = 30;
      if (w.autoOrder) this.autoReorder();
    }
    this.wishT -= dt;

    this.updateDeliveries(dt);

    for (const a of [...this.agents]) {
      if (a.bubbleT > 0) {
        a.bubbleT -= dt;
        if (a.bubbleT <= 0) a.bubble = null;
      }
      if (a.kind === 'customer') this.customer(a, dt);
      else if (a.kind === 'van') this.van(a, dt);
      else this.worker(a, dt);
    }

    // fin de journée
    if (w.min >= CLOSE_MIN) {
      const customers = this.agents.filter((a) => a.kind === 'customer');
      if (w.min >= CLOSE_MIN + 60) for (const c of customers) this.agents.splice(this.agents.indexOf(c), 1);
      if (!customers.length || w.min >= CLOSE_MIN + 60) this.endDay();
    }
  }

  private spawnInterval() {
    const w = this.w;
    const A = this.assortment().filter((p) => this.shelves().some((f) => f.product === p && f.stock > 0)).length;
    const appeal = Math.min(20, w.furn.reduce((s, f) => s + (FURN_BY_ID[f.def].appeal ?? 0), 0));
    let rate = A > 0 ? 4 + A * 1.3 + appeal * 0.5 + (stars(w) - 3) * 2 + w.level * 0.6 : 1;
    const h = w.min / 60;
    if (h < 10) rate *= 0.7;
    else if ((h >= 12 && h < 14) || (h >= 17 && h < 19)) rate *= 1.4;
    rate = Math.max(1, Math.min(45, rate));
    return (60 / MIN_PER_SEC / rate) * this.rng.range(0.6, 1.4);
  }

  // ------------------------------------------------------------------ clients
  private spawnCustomer() {
    const left = this.rng.chance(0.5);
    const x = left ? GX0 + 1.5 : GX1 - 1.5;
    const a = this.newAgent('customer', this.rng.pick(PEOPLE), x, this.rng.range(0.6, 2.4));
    a.exitX = this.rng.chance(0.5) ? GX0 + 1.5 : GX1 - 1.5;
    a.speed = this.rng.range(1.15, 1.45);
    const assort = this.assortment();
    const n = Math.max(1, Math.min(assort.length, this.rng.int(1, 4)));
    const pool = [...assort];
    while (a.wants.length < n && pool.length) {
      // tirage pondéré par la popularité
      const tot = pool.reduce((s, p) => s + PRODUCT_BY_ID[p].popularity, 0);
      let r = this.rng.next() * tot;
      let k = 0;
      for (; k < pool.length - 1; k++) {
        r -= PRODUCT_BY_ID[pool[k]].popularity;
        if (r <= 0) break;
      }
      a.wants.push(pool.splice(k, 1)[0]);
    }
    // parfois, un client demande un produit qu'on ne vend pas encore
    if (this.rng.chance(0.15)) {
      const missing = unlockedProducts(this.w.level).filter((p) => !assort.includes(p.id));
      if (missing.length) {
        const p = this.rng.pick(missing);
        a.wants.push(p.id);
      }
    }
    this.w.today.customers++;
    a.state = 'next';
    this.sfx('door');
  }

  private customer(a: Agent, dt: number) {
    switch (a.state) {
      case 'next': {
        const pid = a.wants.shift();
        if (!pid) return this.toCheckout(a);
        const cands = this.shelves().filter((f) => f.product === pid);
        if (!cands.length) {
          a.missing++;
          this.bubble(a, 'no:' + pid, 3);
          if (this.wishT <= 0) {
            this.wishT = 90;
            this.toast(`Un client cherche : ${PRODUCT_BY_ID[pid].name}`, 'info', undefined, 'p:' + pid);
          }
          a.state = 'think';
          a.t = 1.2;
          return;
        }
        cands.sort((f, g) => (g.stock > 0 ? 1 : 0) - (f.stock > 0 ? 1 : 0) || this.dist(a, centerOf(f)) - this.dist(a, centerOf(g)));
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
          a.t = 1.3;
          a.anim = 'interact';
        }
        return;
      case 'pick': {
        a.t -= dt;
        a.anim = 'interact';
        if (a.t > 0) return;
        const pid = a.wants.shift()!;
        const f = this.furn(a.shelf);
        if (f && f.product === pid && f.stock > 0) {
          const n = Math.min(f.stock, this.rng.chance(0.3) ? 2 : 1);
          f.stock -= n;
          a.basket.push({ pid, n });
          this.bubble(a, 'p:' + pid, 1.6);
          this.touch();
        } else {
          // rayon vide : on essaie un autre rayon du même produit, une fois
          const other = this.shelves().find((g) => g.product === pid && g.stock > 0 && g.id !== a.shelf);
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
        if (a.wait > 90) {
          // trop d'attente : il repose ses articles et s'en va
          this.giveUp(a);
        }
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
          if (a.wait > 90) this.giveUp(a);
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

  private emptyWarned = new Map<string, number>();
  /** Rayon vide et plus rien en réserve : on prévient (au plus toutes les 2 heures de jeu). */
  private warnEmpty(pid: string) {
    const w = this.w;
    if ((w.reserve[pid] ?? 0) > 0 || w.deliveries.some((d) => d.items[pid])) return;
    if (w.clock - (this.emptyWarned.get(pid) ?? -1e9) < 120) return;
    this.emptyWarned.set(pid, w.clock);
    this.toast(`Plus de ${PRODUCT_BY_ID[pid].name} ! Commandez-en 🛒`, 'bad', undefined, 'p:' + pid);
  }

  private queueCells(f: Furn): Cell[] {
    let c = this.queueCellsCache.get(f.id);
    if (c) return c;
    const pay = checkoutSpots(f).pay;
    const start = cellOf(pay.x, pay.z);
    const fw = accessCells(f);
    void fw;
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

  /** Chaque client de la file va à sa place (le premier à la caisse). */
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
    w.today.revenue += total;
    w.today.items += items;
    w.today.served++;
    const wanted = a.basket.length + a.missing;
    const sat = Math.max(0, Math.min(1, 1 - (0.35 * a.missing) / Math.max(1, wanted) - Math.max(0, a.wait - 25) / 80 + 0.1));
    this.rate(sat);
    const pay = checkoutSpots(f).pay;
    this.fx.push({ k: 'float', text: '+' + total.toFixed(2).replace('.', ',') + ' €', x: pay.x, z: pay.z, color: '#7CFF6B' });
    this.sfx('cash', pay.x, pay.z);
    this.gainXp(items + 2);
    a.basket = [];
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
    // les articles retournent en réserve (rien ne se perd)
    for (const b of a.basket) this.w.reserve[b.pid] = (this.w.reserve[b.pid] ?? 0) + b.n;
    a.basket = [];
    this.rate(0.1);
    this.bubble(a, 'ui:sad', 3);
    this.leaveQueue(a);
    this.leave(a);
  }

  private leave(a: Agent) {
    a.state = 'leave';
    a.face = null;
    if (!this.goTo(a, a.exitX, this.rng.range(0.7, 2.3), true)) this.agents.splice(this.agents.indexOf(a), 1);
  }

  // ------------------------------------------------------------------ employés et avatars
  private worker(a: Agent, dt: number) {
    const t = a.task;
    if (!t) {
      a.anim = 'idle';
      a.think -= dt;
      if (a.think <= 0) {
        a.think = 0.8;
        this.decide(a);
      }
      if (!a.task && a.dest) this.walk(a, dt);
      return;
    }
    if (t.t === 'goto') {
      if (this.walk(a, dt)) {
        a.idleT += dt;
        if (a.idleT > t.until) {
          a.task = null;
          a.manual = false;
        }
      }
      return;
    }
    if (t.t === 'cash') {
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
      if (a.state === 'atCash') {
        const q = this.queues.get(f.id) ?? [];
        if (a.anim !== 'interact') a.anim = 'idle';
        if (q.length) a.idleT = 0;
        else a.idleT += dt;
        // un avatar ou un employé de rayon rend la caisse quand il n'y a plus personne
        if (!a.manual && a.role !== 'caissier' && a.idleT > 6) {
          a.task = null;
          a.state = 'idle';
        }
      }
      return;
    }
    if (t.t === 'fill') {
      const f = this.furn(t.id);
      const abort = () => {
        if (a.carry && t.n > 0) this.w.reserve[t.pid] = (this.w.reserve[t.pid] ?? 0) + t.n;
        a.carry = null;
        a.task = null;
        a.manual = false;
        a.state = 'idle';
        this.touch();
      };
      if (!f || f.product !== t.pid) return abort();
      if (t.phase === 'toRack') {
        if (this.walk(a, dt)) {
          t.phase = 'pick';
          a.t = 0.8;
        }
      } else if (t.phase === 'pick') {
        a.anim = 'interact';
        a.t -= dt;
        if (a.t <= 0) {
          const cap = shelfCap(FURN_BY_ID[f.def]);
          const have = this.w.reserve[t.pid] ?? 0;
          const n = Math.min(have, PRODUCT_BY_ID[t.pid].cartonQty * (a.kind === 'player' ? 2 : 1), cap - f.stock);
          if (n <= 0) return abort();
          this.w.reserve[t.pid] = have - n;
          t.n = n;
          a.carry = t.pid;
          t.phase = 'toShelf';
          const acc = this.accessFor(a, f);
          if (!acc || !this.goTo(a, acc.x, acc.z)) return abort();
          a.face = acc.face;
          this.touch();
        }
      } else if (t.phase === 'toShelf') {
        if (this.walk(a, dt)) {
          t.phase = 'put';
          a.t = a.kind === 'player' ? 1 : 1.5;
        }
      } else if (t.phase === 'put') {
        a.anim = 'interact';
        a.t -= dt;
        if (a.t <= 0) {
          const cap = shelfCap(FURN_BY_ID[f.def]);
          const put = Math.min(t.n, cap - f.stock);
          f.stock += put;
          t.n -= put;
          if (t.n > 0) this.w.reserve[t.pid] = (this.w.reserve[t.pid] ?? 0) + t.n;
          t.n = 0;
          a.carry = null;
          a.task = null;
          a.manual = false;
          a.state = 'idle';
          a.anim = 'idle';
          this.sfx('fill', f.x, f.z);
          this.touch();
        }
      }
    }
  }

  /** Que faire maintenant ? (employés et avatars en pilote automatique) */
  private decide(a: Agent) {
    if (a.manual) return;
    const role = a.role;
    // caisse
    const free = this.checkouts().filter((f) => !FURN_BY_ID[f.def].self && !this.agents.some((b) => b !== a && b.task?.t === 'cash' && b.task.id === f.id));
    if (role === 'caissier' && free.length) {
      free.sort((f, g) => (this.queues.get(g.id)?.length ?? 0) - (this.queues.get(f.id)?.length ?? 0));
      return this.startCash(a, free[0], false);
    }
    const waiting = free.filter((f) => (this.queues.get(f.id)?.length ?? 0) > 0);
    if (waiting.length && (role === 'player' || role === 'rayon')) {
      // un employé de rayon ne dépanne que si aucun avatar n'y va
      return this.startCash(a, waiting[0], false);
    }
    // réassort
    const shelf = this.pickShelfToFill(a, role === 'player' ? 0.5 : 0.8);
    if (shelf) return this.startFill(a, shelf, false);
    // rien à faire : on se range sur le côté
    if (!a.dest && a.idleT <= 0) {
      a.idleT = 1;
      const s = storeSize(this.w);
      const spots = role === 'caissier' ? [{ x: 1, z: -s.d + 1 }] : [{ x: s.w - 1, z: -s.d }, { x: 1, z: -s.d + 1 }, { x: s.w - 2, z: -2 }];
      const sp = this.rng.pick(spots);
      const c = this.nav.nearestFree(sp.x, sp.z, true);
      if (c && this.dist(a, { x: c.x + 0.5, z: c.z + 0.5 }) > 1.5) {
        a.face = null;
        this.goTo(a, c.x + 0.5, c.z + 0.5);
      }
    }
  }

  private pickShelfToFill(a: Agent, below: number): Furn | null {
    let best: Furn | null = null;
    let bestScore = Infinity;
    for (const f of this.shelves()) {
      if (!f.product || (this.w.reserve[f.product] ?? 0) <= 0) continue;
      const cap = shelfCap(FURN_BY_ID[f.def]);
      const ratio = f.stock / cap;
      if (ratio >= below) continue;
      if (this.agents.some((b) => b !== a && b.task?.t === 'fill' && b.task.id === f.id)) continue;
      const s = ratio * 10 + this.dist(a, centerOf(f)) * 0.1;
      if (s < bestScore) {
        bestScore = s;
        best = f;
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
    const c = this.nav.nearestFree(0, -s.d, true) ?? { x: 0, z: -s.d };
    return { x: c.x + 0.5, z: c.z + 0.5, face: null };
  }

  private startFill(a: Agent, f: Furn, manual: boolean) {
    if (!f.product) return;
    this.dropTask(a);
    const r = this.rackSpot(a);
    a.task = { t: 'fill', id: f.id, phase: 'toRack', pid: f.product, n: 0 };
    a.manual = manual;
    a.face = r.face;
    a.state = 'fill';
    if (!this.goTo(a, r.x, r.z)) {
      a.task = null;
      a.manual = false;
    }
  }

  private startCash(a: Agent, f: Furn, manual: boolean) {
    const spot = checkoutSpots(f).cashier;
    if (!spot) return;
    this.dropTask(a);
    // si quelqu'un d'autre tient déjà cette caisse, il la libère pour un ordre manuel
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

  private dropTask(a: Agent) {
    const t = a.task;
    if (t?.t === 'fill' && t.n > 0) {
      this.w.reserve[t.pid] = (this.w.reserve[t.pid] ?? 0) + t.n;
      t.n = 0;
      this.touch();
    }
    a.carry = null;
    a.task = null;
    a.idleT = 0;
  }

  // ------------------------------------------------------------------ livraisons
  private updateDeliveries(dt: number) {
    void dt;
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
      const tx = a.dest!.x;
      const d = tx - a.x;
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
        for (const [pid, c] of Object.entries(d.items)) w.reserve[pid] = (w.reserve[pid] ?? 0) + c * PRODUCT_BY_ID[pid].cartonQty;
        w.deliveries = w.deliveries.filter((q) => q !== d);
        this.sfx('honk', a.x, a.z);
        this.toast('Livraison rangée dans la réserve 📦', 'good', undefined, 'ui:truck');
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
    const pending = new Set(w.deliveries.flatMap((d) => Object.keys(d.items)));
    for (const pid of this.assortment()) {
      if (pending.has(pid)) continue;
      const p = PRODUCT_BY_ID[pid];
      if ((w.reserve[pid] ?? 0) < p.cartonQty) items[pid] = 2;
    }
    if (!Object.keys(items).length) return;
    const r = this.order(items, true);
    if (!r.ok && r.reason) {
      // pas assez de place ou d'argent : on réduit à un carton
      for (const k of Object.keys(items)) items[k] = 1;
      this.order(items, true);
    }
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
    const { cost, cartons } = this.orderCost(clean);
    if (!cartons) return { ok: false };
    if (cartonsUsed(w) + cartons > reserveCapacity(w)) return { ok: false, reason: 'La réserve est trop petite : achetez un rack de réserve.' };
    if (cost > w.money - (auto ? 50 : 0)) return { ok: false, reason: 'Pas assez d’argent.' };
    w.money = Math.round((w.money - cost) * 100) / 100;
    w.today.purchases += cost;
    w.deliveries.push({ id: w.nextId++, items: clean, eta: w.clock + 16 + this.rng.range(0, 8) });
    this.touch();
    this.toast(auto ? `Réassort auto : ${cartons} carton${cartons > 1 ? 's' : ''} commandé${cartons > 1 ? 's' : ''}` : 'Commande passée ! La camionnette arrive.', 'info', by, 'ui:truck');
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
      this.toast(`Niveau ${w.level} ! Prime de ${bonus} €`, 'good', undefined, 'ui:star');
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
    for (const a of this.agents) if (a.kind !== 'customer' && a.kind !== 'van') this.dropTask(a);
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
        const f: Furn = { id: w.nextId++, def: act.def, x: act.x, z: act.z, rot: ((act.rot % 4) + 4) % 4, product: null, stock: 0 };
        if (def.kind === 'shelf') f.product = this.suggestProduct(def);
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
          // la caisse a bougé : la file et le caissier suivent
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
        if (f.product && f.stock) w.reserve[f.product] = (w.reserve[f.product] ?? 0) + f.stock;
        w.money += Math.round(def.price * 0.5);
        w.furn = w.furn.filter((g) => g !== f);
        for (const a of this.agents) {
          if ((a.task?.t === 'cash' || a.task?.t === 'fill') && a.task.id === f.id) {
            this.dropTask(a);
            a.manual = false;
            a.state = 'idle';
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
        if (!f) return false;
        const def = FURN_BY_ID[f.def];
        if (act.pid && (!compatible(def, act.pid) || CAT_LEVEL[PRODUCT_BY_ID[act.pid].category] > w.level)) return err('Ce produit ne va pas dans ce meuble.');
        if (f.product && f.stock) w.reserve[f.product] = (w.reserve[f.product] ?? 0) + f.stock;
        f.product = act.pid;
        f.stock = 0;
        this.touch();
        return true;
      }
      case 'fill': {
        const f = this.furn(act.id);
        if (!f || !me) return false;
        if (!f.product) return err('Choisissez d’abord un produit pour ce rayon.');
        if ((w.reserve[f.product] ?? 0) <= 0) return err('Plus de stock en réserve : commandez-en !');
        if (f.stock >= shelfCap(FURN_BY_ID[f.def])) return err('Le rayon est déjà plein.');
        this.startFill(me, f, true);
        return true;
      }
      case 'cash': {
        const f = this.furn(act.id);
        if (!f || !me) return false;
        if (FURN_BY_ID[f.def].self) return err('Cette caisse fonctionne toute seule.');
        this.startCash(me, f, true);
        return true;
      }
      case 'goto': {
        if (!me) return false;
        this.dropTask(me);
        me.task = { t: 'goto', until: 12 };
        me.manual = true;
        me.idleT = 0;
        me.face = null;
        this.goTo(me, act.x, act.z, true);
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
          this.dropTask(a);
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
        w.sizeIdx++;
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

  /** Produit proposé pour un nouveau rayon : un produit débloqué qui n'est pas encore en rayon (en stock si possible). */
  suggestProduct(def: FurnDef): string | null {
    const assort = new Set(this.assortment());
    const cands = unlockedProducts(this.w.level).filter((p) => compatible(def, p.id));
    const fresh = cands.filter((p) => !assort.has(p.id));
    const inStock = fresh.filter((p) => (this.w.reserve[p.id] ?? 0) > 0);
    return (inStock[0] ?? fresh.sort((a, b) => b.popularity - a.popularity)[0] ?? cands[0])?.id ?? null;
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

  /** Ce que fait un avatar (pour l'interface). */
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
