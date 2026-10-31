/**
 * Agent de base : déplacement sur la grille de navigation (A* + lissage), évitement local,
 * détection de blocage, corps cinématique (pousse les objets), personnage animé et bulles.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { clamp, dampAngle } from '../core/math';
import type { PathOpts } from '../sim/nav';
import { buildCharacter, type Appearance, type CharacterRig } from './character';
import { Animator, type Action } from './animator';
import { emojiTexture } from '../world/textures';
import type { Game } from '../game/game';

export type AgentKind = 'customer' | 'employee' | 'pedestrian' | 'special';

let nextId = 1;

export abstract class Agent {
  readonly id = nextId++;
  abstract readonly kind: AgentKind;
  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  walkSpeed = 1.3;
  running = false;
  path: { x: number; z: number }[] | null = null;
  pathI = 0;
  goal: { x: number; z: number } | null = null;
  navOpts: PathOpts = {};
  rig: CharacterRig | null = null;
  anim: Animator | null = null;
  body: RAPIER.RigidBody | null = null;
  dead = false;
  name = '';
  private stuckT = 0;
  private lastD = Infinity;
  private bubble: THREE.Sprite | null = null;
  private bubbleT = 0;
  private repathT = 0;
  /** Objet tenu en main (produit, carton, téléphone...). */
  handProp: THREE.Object3D | null = null;
  carryProp: THREE.Object3D | null = null;
  hidden = false;
  /** Dernière action jouée et objet porté (rendu 2.5D, qui n'utilise pas l'animateur 3D). */
  act2d: { a: Action; t: number } | null = null;
  hold2d: 'none' | 'carry' | 'push' | 'basket' = 'none';

  constructor(public game: Game, public app: Appearance | null, x: number, z: number) {
    this.pos.set(x, 0, z);
    if (app && !game.headless) {
      this.rig = buildCharacter(app);
      this.anim = new Animator(this.rig);
      game.scene.add(this.rig.root);
      this.rig.root.position.copy(this.pos);
    }
    const cap = game.physics.addKinematicCapsule(x, z, 0.24, 0.55, { kind: 'agent', ref: this });
    this.body = cap.body;
  }

  /** Joue une action (animation 3D et/ou rendu 2.5D). */
  play(a: Action, opts?: { height?: number }) {
    this.act2d = { a, t: this.game.realTime };
    this.anim?.play(a, opts);
  }

  stopAct() {
    this.act2d = null;
    this.anim?.stop();
  }

  /** Calcule un chemin vers (x, z). Renvoie false si inaccessible. */
  setGoal(x: number, z: number, opts?: PathOpts): boolean {
    const o = opts ?? this.navOpts;
    const p = this.game.nav.findPath(this.pos.x, this.pos.z, x, z, o);
    this.goal = { x, z };
    if (!p) {
      this.path = null;
      return false;
    }
    this.path = p;
    this.pathI = p.length > 1 ? 1 : 0;
    this.stuckT = 0;
    this.lastD = Infinity;
    return true;
  }

  get arrived(): boolean {
    return !this.path;
  }

  stopMoving() {
    this.path = null;
    this.speed = 0;
  }

  /** Avance le long du chemin. */
  moveAlong(dt: number): 'moving' | 'arrived' | 'stuck' {
    if (!this.path) {
      this.speed = 0;
      return 'arrived';
    }
    const target = this.path[this.pathI];
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const last = this.pathI >= this.path.length - 1;
    if (d < (last ? 0.12 : 0.35)) {
      if (last) {
        this.path = null;
        this.speed = 0;
        return 'arrived';
      }
      this.pathI++;
      return 'moving';
    }
    const sp = this.walkSpeed * (this.running ? 2.1 : 1);
    let vx = (dx / d) * sp;
    let vz = (dz / d) * sp;
    // évitement local (séparation)
    const sep = this.game.agents.separation(this, 0.55);
    vx += sep.x * 1.4;
    vz += sep.z * 1.4;
    const vl = Math.hypot(vx, vz);
    if (vl > sp) {
      vx = (vx / vl) * sp;
      vz = (vz / vl) * sp;
    }
    const step = Math.min(dt, 0.1);
    let nx = this.pos.x + vx * step;
    let nz = this.pos.z + vz * step;
    const nav = this.game.nav;
    const o = this.navOpts;
    if (!nav.walkableAt(nx, nz, o)) {
      if (nav.walkableAt(nx, this.pos.z, o)) nz = this.pos.z;
      else if (nav.walkableAt(this.pos.x, nz, o)) nx = this.pos.x;
      else {
        // repli : avance directement vers la cible (le chemin est valide, c'est l'évitement qui gêne)
        nx = this.pos.x + (dx / d) * sp * step;
        nz = this.pos.z + (dz / d) * sp * step;
        if (!nav.walkableAt(nx, nz, o)) {
          nx = this.pos.x;
          nz = this.pos.z;
        }
      }
    }
    const moved = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    this.pos.x = nx;
    this.pos.z = nz;
    this.speed = moved / Math.max(1e-4, step);
    if (moved > 1e-4) this.yaw = dampAngle(this.yaw, Math.atan2(nx - (nx - vx), nz - (nz - vz)), 10, dt);
    // détection de blocage
    const remaining = d;
    if (remaining < this.lastD - 0.02) {
      this.lastD = remaining;
      this.stuckT = 0;
    } else this.stuckT += dt;
    this.repathT -= dt;
    if (this.stuckT > 2.5 && this.repathT <= 0 && this.goal) {
      this.repathT = 1.5;
      this.stuckT = 0;
      if (!this.setGoal(this.goal.x, this.goal.z)) return 'stuck';
      if (this.stuckT > 8) return 'stuck';
    }
    return 'moving';
  }

  faceTowards(x: number, z: number, dt: number, rate = 8) {
    this.yaw = dampAngle(this.yaw, Math.atan2(x - this.pos.x, z - this.pos.z), rate, dt);
  }

  distTo(x: number, z: number) {
    return Math.hypot(x - this.pos.x, z - this.pos.z);
  }

  /** Bulle emoji au-dessus de la tête (et réplique texte relayée à l'UI). */
  say(emoji: string | null, text?: string, dur = 3) {
    if (text) this.game.bus.emit('bark', { id: this.id, text, x: this.pos.x, y: (this.rig?.headY ?? 1.7) + 0.5, z: this.pos.z });
    if (!emoji || !this.rig) return;
    const tex = emojiTexture(emoji);
    if (!tex) return;
    if (!this.bubble) {
      this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      this.bubble.scale.set(0.45, 0.45, 1);
      this.bubble.renderOrder = 5;
      this.rig.root.add(this.bubble);
    }
    this.bubble.material.map = tex;
    this.bubble.material.needsUpdate = true;
    this.bubble.position.set(0, this.rig.headY + 0.42, 0);
    this.bubble.visible = true;
    this.bubbleT = dur;
  }

  attachHand(o: THREE.Object3D | null) {
    if (this.handProp && this.handProp.parent) this.handProp.parent.remove(this.handProp);
    this.handProp = o;
    if (o && this.rig) {
      o.position.set(0, -0.1 * this.rig.scale, 0.05);
      this.rig.bones.handR.add(o);
    }
  }

  attachCarry(o: THREE.Object3D | null) {
    if (this.carryProp && this.carryProp.parent) this.carryProp.parent.remove(this.carryProp);
    this.carryProp = o;
    if (o && this.rig) {
      o.position.set(0, 1.05 * this.rig.scale, 0.42);
      this.rig.root.add(o);
    }
    this.hold2d = o ? 'carry' : 'none';
    if (this.anim) this.anim.hold = o ? 'carry' : 'none';
  }

  /** Synchronise le corps physique et le modèle. */
  syncView(dt: number, camPos: THREE.Vector3 | null) {
    if (this.body) this.body.setNextKinematicTranslation({ x: this.pos.x, y: 0.79, z: this.pos.z });
    if (!this.rig || !this.anim) return;
    const r = this.rig.root;
    r.position.set(this.pos.x, this.pos.y, this.pos.z);
    r.rotation.y = this.yaw;
    const far = camPos ? Math.hypot(camPos.x - this.pos.x, camPos.z - this.pos.z) : 0;
    r.visible = !this.hidden && far < 140;
    if (r.visible && (far < 55 || Math.random() < 0.25)) {
      this.anim.speed = clamp(this.speed, 0, 6);
      this.anim.run = this.running;
      this.anim.update(far < 55 ? dt : dt * 4, this.yaw, this.pos);
    }
    if (this.bubble && this.bubble.visible) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) this.bubble.visible = false;
    }
  }

  abstract update(dt: number): void;

  dispose() {
    this.dead = true;
    if (this.rig) {
      this.game.scene.remove(this.rig.root);
      this.rig.dispose();
    }
    if (this.body) this.game.physics.removeBody(this.body);
    this.body = null;
  }
}

/** Gestionnaire d'agents : mise à jour, hachage spatial pour l'évitement, requêtes de proximité. */
export class AgentManager {
  list: Agent[] = [];
  private grid = new Map<number, Agent[]>();

  constructor(private game: Game) {}

  add<T extends Agent>(a: T): T {
    this.list.push(a);
    return a;
  }

  of<T extends Agent>(kind: Agent['kind']): T[] {
    return this.list.filter((a) => a.kind === kind) as T[];
  }

  count(kind?: Agent['kind']) {
    return kind ? this.list.reduce((n, a) => n + (a.kind === kind ? 1 : 0), 0) : this.list.length;
  }

  private key(x: number, z: number) {
    return (Math.floor(x) + 512) * 4096 + (Math.floor(z) + 512);
  }

  private rebuildGrid() {
    this.grid.clear();
    for (const a of this.list) {
      const k = this.key(a.pos.x, a.pos.z);
      const arr = this.grid.get(k);
      if (arr) arr.push(a);
      else this.grid.set(k, [a]);
    }
  }

  near(x: number, z: number, r: number): Agent[] {
    const out: Agent[] = [];
    const r2 = r * r;
    for (let gx = Math.floor(x - r); gx <= Math.floor(x + r); gx++)
      for (let gz = Math.floor(z - r); gz <= Math.floor(z + r); gz++) {
        const arr = this.grid.get((gx + 512) * 4096 + (gz + 512));
        if (!arr) continue;
        for (const a of arr) if ((a.pos.x - x) ** 2 + (a.pos.z - z) ** 2 <= r2) out.push(a);
      }
    return out;
  }

  separation(self: Agent, r: number): { x: number; z: number } {
    let sx = 0;
    let sz = 0;
    for (const o of this.near(self.pos.x, self.pos.z, r)) {
      if (o === self) continue;
      const dx = self.pos.x - o.pos.x;
      const dz = self.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz) || 0.01;
      const k = (r - d) / r;
      sx += (dx / d) * k;
      sz += (dz / d) * k;
    }
    // le joueur aussi
    const p = this.game.player?.pos;
    if (p) {
      const dx = self.pos.x - p.x;
      const dz = self.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 0.01) {
        sx += (dx / d) * (0.7 - d) * 2;
        sz += (dz / d) * (0.7 - d) * 2;
      }
    }
    return { x: sx, z: sz };
  }

  update(dt: number, camPos: THREE.Vector3 | null) {
    this.rebuildGrid();
    for (const a of this.list) if (!a.dead) a.update(dt);
    for (const a of this.list) if (!a.dead) a.syncView(dt, camPos);
    const dead = this.list.filter((a) => a.dead);
    if (dead.length) {
      this.list = this.list.filter((a) => !a.dead);
      for (const a of dead) if (a.rig || a.body) a.dispose();
    }
  }

  clear() {
    for (const a of this.list) a.dispose();
    this.list = [];
  }

  positions(): { x: number; z: number }[] {
    return this.list.map((a) => ({ x: a.pos.x, z: a.pos.z }));
  }
}
