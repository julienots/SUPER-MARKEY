/**
 * Objets physiques du monde : produits tombés, cartons, palettes, caddies libres, salissures.
 * L'état logique (GameState) reste la référence ; les corps Rapier sont recréés au chargement.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PRODUCT_BY_ID } from '../data/products';
import { G_CART, G_DYNAMIC, type Physics, type PhysUser } from '../physics/physics';
import { allocUid, type Carton, type GameState, type LooseItem, type Mess, type MessKind, type Pallet, type WorldCarton } from '../sim/state';
import { productCollider, productMesh } from '../world/productMeshes';
import { cardboardTexture, messTexture } from '../world/textures';
import { mat } from '../world/materials';
import { palletMesh } from '../world/vehicleMeshes';
import { cartMesh } from '../world/equipmentMeshes';
import type { Game } from '../game/game';

export const CARTON_SIZE = { w: 0.46, h: 0.34, d: 0.36 };
export const MAX_LOOSE = 160;

interface LooseView {
  data: LooseItem;
  mesh: THREE.Object3D | null;
  body: RAPIER.RigidBody;
  age: number;
}
interface CartonView {
  data: WorldCarton;
  mesh: THREE.Object3D | null;
  body: RAPIER.RigidBody;
}
interface PalletView {
  data: Pallet;
  group: THREE.Group | null;
  body: RAPIER.RigidBody;
  stack: THREE.Group | null;
}
export interface FreeCart {
  uid: number;
  mesh: THREE.Object3D | null;
  body: RAPIER.RigidBody;
  wobble: number;
  heldBy: 'player' | number | null;
}

const cartonMats = new Map<string, THREE.Material[]>();
function cartonMaterial(pid: string | null): THREE.Material | THREE.Material[] {
  const k = pid ?? '_';
  let m = cartonMats.get(k);
  if (!m) {
    const tex = cardboardTexture(pid);
    const side = new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xc49a6c, roughness: 0.9 });
    const plain = mat(0xc49a6c, { rough: 0.9 });
    m = [side, side, plain, plain, side, side];
    cartonMats.set(k, m);
  }
  return m;
}

export function cartonObject(pid: string | null, opened = false): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(CARTON_SIZE.w, CARTON_SIZE.h, CARTON_SIZE.d), cartonMaterial(pid));
  b.castShadow = true;
  b.receiveShadow = true;
  g.add(b);
  if (opened) {
    const flapM = mat(0xb88a5c, { rough: 0.9 });
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(CARTON_SIZE.w, 0.005, CARTON_SIZE.d / 2), flapM);
      f.position.set(0, CARTON_SIZE.h / 2, s * (CARTON_SIZE.d / 2 + 0.06));
      f.rotation.x = s * -0.9;
      g.add(f);
    }
  }
  return g;
}

export class ItemManager {
  loose = new Map<number, LooseView>();
  cartons = new Map<number, CartonView>();
  pallets = new Map<number, PalletView>();
  messes = new Map<number, { data: Mess; mesh: THREE.Mesh | null }>();
  carts: FreeCart[] = [];
  group = new THREE.Group();
  private syncT = 0;

  constructor(private game: Game) {
    this.group.name = 'items';
    game.scene.add(this.group);
    game.physics.onImpact = (u, force) => this.onImpact(u, force);
  }

  private get st(): GameState {
    return this.game.st;
  }
  private get physics(): Physics {
    return this.game.physics;
  }
  private get render() {
    return !this.game.headless;
  }

  clear() {
    for (const v of this.loose.values()) this.physics.removeBody(v.body);
    for (const v of this.cartons.values()) this.physics.removeBody(v.body);
    for (const v of this.pallets.values()) this.physics.removeBody(v.body);
    for (const c of this.carts) this.physics.removeBody(c.body);
    this.loose.clear();
    this.cartons.clear();
    this.pallets.clear();
    this.messes.clear();
    this.carts = [];
    this.group.clear();
  }

  /** Recrée tous les objets physiques à partir de l'état (chargement). */
  rebuildFromState() {
    this.clear();
    for (const l of this.st.looseItems) this.createLooseBody(l);
    for (const c of this.st.worldCartons) this.createCartonBody(c);
    for (const p of this.st.pallets) this.createPalletBody(p);
    for (const m of this.st.messes) this.createMessView(m);
    // quelques caddies dans le range-caddies du parking
    for (let i = 0; i < 3; i++) this.spawnCart(8.8 + i * 0.7, -2.6, Math.PI);
  }

  // ------------------------------------------------------------ produits tombés
  private createLooseBody(l: LooseItem, vel?: { x: number; y: number; z: number }) {
    const p = PRODUCT_BY_ID[l.pid];
    const shape = productCollider(p);
    const user: PhysUser = { kind: 'item', ref: l.uid, fragile: !!p.fragile };
    const { body } = this.physics.addDynamic(shape, { x: l.x, y: l.y, z: l.z }, { mass: p.mass, friction: p.rolls ? 0.4 : 0.7, restitution: p.fragile ? 0.05 : 0.2, user, rotY: Math.random() * 6, impactThreshold: p.fragile ? 25 : undefined, linDamp: 0.05, angDamp: p.rolls ? 0.05 : 0.5 });
    if (vel) body.setLinvel(vel, true);
    let mesh: THREE.Object3D | null = null;
    if (this.render) {
      mesh = productMesh(l.pid);
      this.group.add(mesh);
    }
    this.loose.set(l.uid, { data: l, mesh, body, age: 0 });
  }

  spawnLoose(pid: string, exp: number, pos: { x: number; y: number; z: number }, vel?: { x: number; y: number; z: number }): LooseItem | null {
    if (this.st.looseItems.length >= MAX_LOOSE) return null;
    const l: LooseItem = { uid: allocUid(this.st), pid, exp, x: pos.x, y: pos.y, z: pos.z };
    this.st.looseItems.push(l);
    this.createLooseBody(l, vel);
    return l;
  }

  removeLoose(uid: number): LooseItem | null {
    const v = this.loose.get(uid);
    if (!v) return null;
    this.physics.removeBody(v.body);
    if (v.mesh) this.group.remove(v.mesh);
    this.loose.delete(uid);
    this.st.looseItems = this.st.looseItems.filter((x) => x.uid !== uid);
    return v.data;
  }

  /** Casse d'un objet fragile sur choc violent : perte sèche + salissure à nettoyer. */
  private onImpact(u: PhysUser, force: number) {
    if (u.kind !== 'item') return;
    const v = this.loose.get(u.ref);
    if (!v || v.age < 0.05) return;
    const p = PRODUCT_BY_ID[v.data.pid];
    if (force < 30 + p.mass * 20) return;
    const pos = v.body.translation();
    this.removeLoose(u.ref);
    this.st.stats.itemsBroken++;
    this.st.today.expenses.amendes += 0; // la perte est déjà dans le coût du stock
    this.addMess(p.shape === 'bottle' || p.shape === 'jar' ? 'verre' : 'flaque', pos.x, pos.z, 0.6);
    this.game.bus.emit('sfx', { name: 'crash', x: pos.x, z: pos.z });
    this.game.bus.emit('notify', { text: `💥 ${p.name} s’est brisé au sol (${p.cost.toFixed(2)} € de perte).`, kind: 'bad', quiet: true });
    this.game.recordLoss(p.cost, 'casse');
  }

  // ------------------------------------------------------------ cartons
  private createCartonBody(c: WorldCarton, vel?: { x: number; y: number; z: number }) {
    const { body } = this.physics.addDynamic({ type: 'box', hx: CARTON_SIZE.w / 2, hy: CARTON_SIZE.h / 2, hz: CARTON_SIZE.d / 2 }, { x: c.x, y: c.y, z: c.z }, { mass: 2 + (PRODUCT_BY_ID[c.pid].mass * c.q) * 0.6, friction: 0.8, restitution: 0.05, rotY: c.ry, user: { kind: 'carton', ref: c.uid }, linDamp: 0.2, angDamp: 0.8 });
    if (vel) body.setLinvel(vel, true);
    let mesh: THREE.Object3D | null = null;
    if (this.render) {
      mesh = cartonObject(c.pid, c.opened);
      this.group.add(mesh);
    }
    this.cartons.set(c.uid, { data: c, mesh, body });
  }

  spawnCarton(c: Carton, pos: { x: number; y: number; z: number }, vel?: { x: number; y: number; z: number }): WorldCarton {
    const w: WorldCarton = { ...c, x: pos.x, y: pos.y, z: pos.z, ry: Math.random() * 0.4 };
    this.st.worldCartons.push(w);
    this.createCartonBody(w, vel);
    return w;
  }

  removeCarton(uid: number): Carton | null {
    const v = this.cartons.get(uid);
    if (!v) return null;
    this.physics.removeBody(v.body);
    if (v.mesh) this.group.remove(v.mesh);
    this.cartons.delete(uid);
    this.st.worldCartons = this.st.worldCartons.filter((x) => x.uid !== uid);
    const { x: _x, y: _y, z: _z, ry: _r, ...carton } = v.data;
    return carton;
  }

  refreshCartonVisual(uid: number) {
    const v = this.cartons.get(uid);
    if (!v || !v.mesh) return;
    this.group.remove(v.mesh);
    v.mesh = cartonObject(v.data.pid, v.data.opened);
    this.group.add(v.mesh);
  }

  // ------------------------------------------------------------ palettes
  private createPalletBody(p: Pallet) {
    const h = 0.14 + Math.ceil(p.cartons.length / 6) * CARTON_SIZE.h;
    const { body } = this.physics.addDynamic({ type: 'box', hx: 0.6, hy: h / 2, hz: 0.6 }, { x: p.x, y: h / 2 + 0.02, z: p.z }, { mass: 25 + p.cartons.length * 6, friction: 0.9, rotY: p.ry, user: { kind: 'pallet', ref: p.uid }, linDamp: 2, angDamp: 4 });
    let group: THREE.Group | null = null;
    if (this.render) {
      group = new THREE.Group();
      group.add(palletMesh());
      this.group.add(group);
    }
    const v: PalletView = { data: p, group, body, stack: null };
    this.pallets.set(p.uid, v);
    this.refreshPallet(p.uid);
  }

  spawnPallet(cartons: Carton[], x: number, z: number): Pallet {
    const p: Pallet = { uid: allocUid(this.st), x, z, ry: Math.random() * 0.3 - 0.15, cartons };
    this.st.pallets.push(p);
    this.createPalletBody(p);
    return p;
  }

  refreshPallet(uid: number) {
    const v = this.pallets.get(uid);
    if (!v) return;
    if (v.data.cartons.length === 0) {
      this.physics.removeBody(v.body);
      if (v.group) this.group.remove(v.group);
      this.pallets.delete(uid);
      this.st.pallets = this.st.pallets.filter((x) => x.uid !== uid);
      return;
    }
    // ajuste le collider à la hauteur de la pile
    const h = 0.14 + Math.ceil(v.data.cartons.length / 6) * CARTON_SIZE.h;
    const col = v.body.collider(0);
    const R = (this.physics as any).world;
    if (col && R) {
      const pos = v.body.translation();
      this.physics.removeBody(v.body);
      const { body } = this.physics.addDynamic({ type: 'box', hx: 0.6, hy: h / 2, hz: 0.6 }, { x: pos.x, y: h / 2 + 0.02, z: pos.z }, { mass: 25 + v.data.cartons.length * 6, friction: 0.9, rotY: v.data.ry, user: { kind: 'pallet', ref: uid }, linDamp: 2, angDamp: 4 });
      v.body = body;
    }
    if (!v.group) return;
    if (v.stack) v.group.remove(v.stack);
    const stack = new THREE.Group();
    v.data.cartons.forEach((c, i) => {
      const layer = Math.floor(i / 6);
      const k = i % 6;
      const m = cartonObject(c.pid, false);
      m.position.set(-0.38 + (k % 3) * 0.38 + 0.0, 0.14 + layer * CARTON_SIZE.h + CARTON_SIZE.h / 2, k < 3 ? -0.2 : 0.2);
      m.scale.set(0.8, 1, 1.05);
      stack.add(m);
    });
    stack.position.y = -h / 2;
    v.group.add(stack);
    v.stack = stack;
    (v.group.children[0] as THREE.Object3D).position.y = -h / 2;
  }

  takeFromPallet(uid: number): Carton | null {
    const v = this.pallets.get(uid);
    if (!v || !v.data.cartons.length) return null;
    const c = v.data.cartons.pop()!;
    this.refreshPallet(uid);
    return c;
  }

  palletPos(uid: number) {
    const v = this.pallets.get(uid);
    return v ? v.body.translation() : null;
  }

  // ------------------------------------------------------------ caddies libres
  spawnCart(x: number, z: number, ry = 0): FreeCart {
    const { body } = this.physics.addDynamic({ type: 'box', hx: 0.28, hy: 0.5, hz: 0.42 }, { x, y: 0.52, z }, { mass: 14, friction: 0.15, rotY: ry, user: { kind: 'cart', ref: null }, linDamp: 1.2, angDamp: 3, group: G_CART | G_DYNAMIC });
    body.lockRotations(true, true);
    body.setEnabledRotations(false, true, false, true);
    let mesh: THREE.Object3D | null = null;
    if (this.render) {
      mesh = cartMesh(this.st.store.signBg);
      this.group.add(mesh);
    }
    const c: FreeCart = { uid: allocUid(this.st), mesh, body, wobble: Math.random() < 0.2 ? (Math.random() < 0.5 ? -1 : 1) : 0, heldBy: null };
    const u = this.physics.userOf(body.collider(0));
    if (u) u.ref = c;
    this.carts.push(c);
    return c;
  }

  removeCart(c: FreeCart) {
    this.physics.removeBody(c.body);
    if (c.mesh) this.group.remove(c.mesh);
    this.carts = this.carts.filter((x) => x !== c);
  }

  // ------------------------------------------------------------ salissures
  private createMessView(m: Mess) {
    let mesh: THREE.Mesh | null = null;
    if (this.render) {
      const tex = messTexture(m.kind);
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: m.kind === 'flaque' ? 0.05 : 0.8, color: tex ? 0xffffff : 0x6d4c41 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * 6;
      mesh.position.set(m.x, 0.03, m.z);
      mesh.renderOrder = 1;
      if (m.kind === 'tag') {
        mesh.rotation.set(0, Math.PI, 0);
        mesh.position.set(m.x, 1.4, m.z);
        mesh.scale.setScalar(1.6);
      }
      this.group.add(mesh);
    }
    this.messes.set(m.uid, { data: m, mesh });
  }

  addMess(kind: MessKind, x: number, z: number, amount = 0.5): Mess {
    // fusionne avec une salissure proche
    for (const v of this.messes.values()) {
      if (v.data.kind === kind && Math.hypot(v.data.x - x, v.data.z - z) < 0.8) {
        v.data.amount = Math.min(1, v.data.amount + amount);
        return v.data;
      }
    }
    const m: Mess = { uid: allocUid(this.st), kind, x, z, amount };
    this.st.messes.push(m);
    this.createMessView(m);
    return m;
  }

  /** Nettoie une salissure (renvoie true si elle a disparu). */
  clean(uid: number, amount: number): boolean {
    const v = this.messes.get(uid);
    if (!v) return true;
    v.data.amount -= amount;
    if (v.mesh) (v.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0.15, v.data.amount);
    if (v.data.amount <= 0) {
      if (v.mesh) this.group.remove(v.mesh);
      this.messes.delete(uid);
      this.st.messes = this.st.messes.filter((m) => m.uid !== uid);
      return true;
    }
    return false;
  }

  messAt(x: number, z: number, r = 0.7): Mess | null {
    for (const v of this.messes.values()) if (v.data.kind !== 'tag' && Math.hypot(v.data.x - x, v.data.z - z) < r) return v.data;
    return null;
  }

  // ------------------------------------------------------------ boucle
  update(dt: number) {
    const tmpQ = new THREE.Quaternion();
    for (const v of this.loose.values()) {
      v.age += dt;
      const t = v.body.translation();
      if (t.y < -3) {
        v.body.setTranslation({ x: t.x, y: 1, z: t.z }, true);
        v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      if (v.mesh) {
        const r = v.body.rotation();
        v.mesh.position.set(t.x, t.y, t.z);
        v.mesh.quaternion.copy(tmpQ.set(r.x, r.y, r.z, r.w));
      }
    }
    for (const v of this.cartons.values()) {
      const t = v.body.translation();
      if (t.y < -3) v.body.setTranslation({ x: t.x, y: 1, z: t.z }, true);
      if (v.mesh) {
        const r = v.body.rotation();
        v.mesh.position.set(t.x, t.y, t.z);
        v.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    for (const v of this.pallets.values()) {
      if (!v.group) continue;
      const t = v.body.translation();
      const r = v.body.rotation();
      v.group.position.set(t.x, t.y, t.z);
      v.group.quaternion.set(r.x, r.y, r.z, r.w);
    }
    for (const c of this.carts) {
      // roue folle : le caddie tire d'un côté quand il roule
      if (c.wobble) {
        const lv = c.body.linvel();
        const sp = Math.hypot(lv.x, lv.z);
        if (sp > 0.3) c.body.applyImpulse({ x: -lv.z * 0.04 * c.wobble, y: 0, z: lv.x * 0.04 * c.wobble }, true);
      }
      if (!c.mesh) continue;
      const t = c.body.translation();
      const r = c.body.rotation();
      c.mesh.position.set(t.x, t.y - 0.52, t.z);
      c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this.syncT -= dt;
    if (this.syncT <= 0) {
      this.syncT = 1;
      this.flushToState();
    }
  }

  /** Recopie les positions physiques dans l'état (avant sauvegarde). */
  flushToState() {
    for (const v of this.loose.values()) {
      const t = v.body.translation();
      v.data.x = t.x;
      v.data.y = Math.max(0.1, t.y);
      v.data.z = t.z;
    }
    for (const v of this.cartons.values()) {
      const t = v.body.translation();
      v.data.x = t.x;
      v.data.y = Math.max(0.2, t.y);
      v.data.z = t.z;
    }
    for (const v of this.pallets.values()) {
      const t = v.body.translation();
      v.data.x = t.x;
      v.data.z = t.z;
    }
  }

  loosePos(uid: number) {
    return this.loose.get(uid)?.body.translation() ?? null;
  }
  cartonPos(uid: number) {
    return this.cartons.get(uid)?.body.translation() ?? null;
  }
}
