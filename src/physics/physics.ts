/**
 * Enveloppe autour de Rapier : pas de simulation fixe, groupes de collision, lancer de rayons,
 * événements de choc (casse des objets fragiles). Les corps dynamiques s'endorment pour économiser le CPU.
 */
import RAPIER from '@dimforge/rapier3d-compat';

export type RAPIERType = typeof RAPIER;
export let R: RAPIERType;

let initPromise: Promise<void> | null = null;
export function initPhysics(): Promise<void> {
  if (!initPromise)
    initPromise = (async () => {
      // l'API d'init change selon les versions : on tolère les deux signatures
      await (RAPIER.init as any)({});
      R = RAPIER;
    })();
  return initPromise;
}

// Groupes : 16 bits d'appartenance << 16 | 16 bits de filtre
export const G_STATIC = 0x0001;
export const G_DYNAMIC = 0x0002;
export const G_PLAYER = 0x0004;
export const G_AGENT = 0x0008;
export const G_CART = 0x0010;
export const G_TRIGGER = 0x0020;

export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export interface PhysUser {
  kind: 'static' | 'item' | 'carton' | 'pallet' | 'cart' | 'agent' | 'player' | 'equip' | 'vehicle' | 'door';
  ref?: any;
  fragile?: boolean;
}

export interface Hit {
  collider: RAPIER.Collider;
  toi: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  user?: PhysUser;
}

export class Physics {
  world: RAPIER.World;
  private queue: RAPIER.EventQueue;
  private acc = 0;
  readonly dt = 1 / 60;
  users = new Map<number, PhysUser>();
  onImpact: ((u: PhysUser, force: number, collider: RAPIER.Collider) => void) | null = null;

  constructor() {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.dt;
    this.queue = new R.EventQueue(true);
    // sol infini (plan épais)
    const ground = R.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setFriction(0.8).setCollisionGroups(groups(G_STATIC, 0xffff));
    this.world.createCollider(ground);
  }

  tag(c: RAPIER.Collider, u: PhysUser) {
    this.users.set(c.handle, u);
  }

  userOf(c: RAPIER.Collider | null | undefined): PhysUser | undefined {
    return c ? this.users.get(c.handle) : undefined;
  }

  addStaticBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY = 0, user: PhysUser = { kind: 'static' }): RAPIER.Collider {
    const q = quatY(rotY);
    const d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setRotation(q).setFriction(0.7).setCollisionGroups(groups(G_STATIC, 0xffff));
    const c = this.world.createCollider(d);
    this.tag(c, user);
    return c;
  }

  removeCollider(c: RAPIER.Collider | null | undefined) {
    if (!c) return;
    this.users.delete(c.handle);
    try {
      this.world.removeCollider(c, true);
    } catch {
      /* déjà retiré */
    }
  }

  removeBody(b: RAPIER.RigidBody | null | undefined) {
    if (!b) return;
    for (let i = 0; i < b.numColliders(); i++) this.users.delete(b.collider(i).handle);
    try {
      this.world.removeRigidBody(b);
    } catch {
      /* déjà retiré */
    }
  }

  /** Corps dynamique simple (boîte, cylindre ou boule). */
  addDynamic(
    shape: { type: 'box'; hx: number; hy: number; hz: number } | { type: 'cyl'; r: number; hh: number } | { type: 'ball'; r: number },
    pos: { x: number; y: number; z: number },
    opts: { mass: number; friction?: number; restitution?: number; rotY?: number; user: PhysUser; ccd?: boolean; linDamp?: number; angDamp?: number; impactThreshold?: number; group?: number },
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bd = R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(quatY(opts.rotY ?? 0)).setLinearDamping(opts.linDamp ?? 0.1).setAngularDamping(opts.angDamp ?? 0.4).setCcdEnabled(!!opts.ccd);
    const body = this.world.createRigidBody(bd);
    let cd: RAPIER.ColliderDesc;
    if (shape.type === 'box') cd = R.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
    else if (shape.type === 'cyl') cd = R.ColliderDesc.cylinder(shape.hh, shape.r);
    else cd = R.ColliderDesc.ball(shape.r);
    const vol = shape.type === 'box' ? 8 * shape.hx * shape.hy * shape.hz : shape.type === 'cyl' ? Math.PI * shape.r * shape.r * shape.hh * 2 : (4 / 3) * Math.PI * shape.r ** 3;
    cd.setDensity(opts.mass / Math.max(1e-5, vol))
      .setFriction(opts.friction ?? 0.6)
      .setRestitution(opts.restitution ?? 0.15)
      .setCollisionGroups(groups(opts.group ?? G_DYNAMIC, 0xffff));
    if (opts.impactThreshold !== undefined) {
      cd.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
      cd.setContactForceEventThreshold(opts.impactThreshold);
    }
    const collider = this.world.createCollider(cd, body);
    this.tag(collider, opts.user);
    return { body, collider };
  }

  /** Capsule cinématique (agents) : pousse les objets dynamiques sans être poussée. */
  addKinematicCapsule(x: number, z: number, radius: number, halfHeight: number, user: PhysUser, group = G_AGENT): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, halfHeight + radius, z));
    const collider = this.world.createCollider(R.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(groups(group, G_DYNAMIC | G_CART | G_PLAYER)), body);
    this.tag(collider, user);
    return { body, collider };
  }

  /** Boîte cinématique (caddie poussé par un client) : bouscule les objets dynamiques. */
  addKinematicBox(x: number, y: number, z: number, hx: number, hy: number, hz: number, user: PhysUser): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    const collider = this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setCollisionGroups(groups(G_CART, G_DYNAMIC | G_PLAYER)), body);
    this.tag(collider, user);
    return { body, collider };
  }

  step(dt: number, maxSteps = 4) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.dt && n < maxSteps) {
      this.world.step(this.queue);
      this.acc -= this.dt;
      n++;
      this.queue.drainContactForceEvents((ev) => {
        const f = ev.maxForceMagnitude();
        for (const h of [ev.collider1(), ev.collider2()]) {
          const c = this.world.getCollider(h);
          const u = this.userOf(c);
          if (u?.fragile && this.onImpact) this.onImpact(u, f, c);
        }
      });
    }
    if (n >= maxSteps) this.acc = 0; // évite la spirale de la mort
  }

  raycast(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxDist: number, filterGroups = groups(0xffff, G_STATIC | G_DYNAMIC | G_AGENT | G_CART | G_TRIGGER), exclude?: RAPIER.Collider, excludeBody?: RAPIER.RigidBody): Hit | null {
    const ray = new R.Ray(o, d);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, filterGroups, exclude, excludeBody);
    if (!hit) return null;
    const toi = hit.timeOfImpact;
    return {
      collider: hit.collider,
      toi,
      point: { x: o.x + d.x * toi, y: o.y + d.y * toi, z: o.z + d.z * toi },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      user: this.userOf(hit.collider),
    };
  }

  /** Objets dynamiques dans une sphère (explosion de rire, chocs de chariot...). */
  bodiesNear(x: number, y: number, z: number, r: number): RAPIER.RigidBody[] {
    const out: RAPIER.RigidBody[] = [];
    const shape = new R.Ball(r);
    this.world.intersectionsWithShape({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
      const b = c.parent();
      if (b && b.isDynamic()) out.push(b);
      return true;
    });
    return out;
  }

  dynamicCount(): number {
    let n = 0;
    this.world.forEachRigidBody((b) => {
      if (b.isDynamic()) n++;
    });
    return n;
  }
}

export function quatY(a: number) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}

export function yawFromQuat(q: { x: number; y: number; z: number; w: number }) {
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
}
