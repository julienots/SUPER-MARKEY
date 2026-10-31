/**
 * Le gérant (vous) : contrôleur de personnage Rapier (collisions, marches, gravité), vue 1ʳᵉ/3ᵉ personne,
 * objets portés (pile de cartons, article, caddie), mode caisse.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PRODUCT_BY_ID } from '../data/products';
import { clamp, damp } from '../core/math';
import { Rng } from '../core/rng';
import { R, G_PLAYER, G_STATIC, G_DYNAMIC, G_AGENT, G_CART, groups } from '../physics/physics';
import type { Carton } from '../sim/state';
import { F_INTERIOR } from '../sim/nav';
import { buildCharacter, randomAppearance, type CharacterRig } from '../entities/character';
import { Animator } from '../entities/animator';
import { cartonObject, CARTON_SIZE, type FreeCart } from '../entities/items';
import { productMesh } from '../world/productMeshes';
import { Input } from './input';
import { Interaction } from './interaction';
import type { Game } from '../game/game';
import type { Lane } from '../game/checkout';

export type Held =
  | { kind: 'cartons'; list: Carton[] }
  | { kind: 'item'; pid: string; exp: number }
  | { kind: 'cart'; cart: FreeCart }
  | null;

export type PlayerMode = 'walk' | 'cashier' | 'build' | 'ui';

export const MAX_CARTONS = 3;

export class Player {
  pos = new THREE.Vector3(0, 0, -7);
  yaw = Math.PI;
  pitch = 0;
  velY = 0;
  mode: PlayerMode = 'walk';
  held: Held = null;
  thirdPerson = false;
  input: Input;
  interaction: Interaction;
  lane: Lane | null = null;
  private body: RAPIER.RigidBody | null = null;
  private collider: RAPIER.Collider | null = null;
  private controller: RAPIER.KinematicCharacterController | null = null;
  private heldView = new THREE.Group();
  private carryIso = new THREE.Group();
  private rig: CharacterRig | null = null;
  private anim: Animator | null = null;
  private bob = 0;
  private grounded = true;
  private tpDist = 3.2;
  speedNow = 0;
  /** Vue 2.5D : personnage toujours visible, pas de caméra subjective, déplacement piloté (drive). */
  isoMode = false;
  /** Vitesse souhaitée (monde, m/s) en vue 2.5D, ou null à l'arrêt. */
  drive: { x: number; z: number; tx?: number; tz?: number } | null = null;
  /** Appelé quand le joueur passe en mode caisse/sort. */
  onModeChange: ((m: PlayerMode) => void) | null = null;

  constructor(private game: Game) {
    this.input = new Input(game.settings, typeof document !== 'undefined' ? (document.getElementById('game-canvas') as HTMLElement | undefined) : undefined);
    this.interaction = new Interaction(game, this);
    game.camera.add(this.heldView);
    game.scene.add(game.camera);
    this.thirdPerson = game.settings.thirdPerson;
  }

  reset(p: { x: number; y: number; z: number; yaw: number }) {
    this.pos.set(p.x, 0, p.z);
    this.yaw = p.yaw;
    this.pitch = 0;
    this.held = null;
    this.mode = 'walk';
    this.lane = null;
    this.refreshHeld();
    if (this.body) this.game.physics.removeBody(this.body);
    const world = this.game.physics.world;
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, 0.95, p.z));
    this.collider = world.createCollider(R.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(groups(G_PLAYER, G_STATIC | G_DYNAMIC | G_AGENT | G_CART)), this.body);
    this.game.physics.tag(this.collider, { kind: 'player' });
    if (!this.controller) {
      this.controller = world.createCharacterController(0.03);
      this.controller.enableAutostep(0.3, 0.2, false);
      this.controller.enableSnapToGround(0.3);
      this.controller.setApplyImpulsesToDynamicBodies(true);
      this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    }
    if (!this.game.headless && !this.rig) {
      const app = randomAppearance(new Rng(4242), { female: false, age: 38, uniform: this.game.st.store.uniform, role: 'manager' });
      app.hairStyle = 'court';
      this.rig = buildCharacter(app);
      this.anim = new Animator(this.rig);
      this.game.scene.add(this.rig.root);
    }
  }

  get inStore(): boolean {
    return (this.game.nav.flagsAt(this.pos.x, this.pos.z) & F_INTERIOR) !== 0;
  }

  get eye(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + 1.62 + Math.sin(this.bob) * 0.025, this.pos.z);
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  holdsCarton(uid: number) {
    return this.held?.kind === 'cartons' && this.held.list.some((c) => c.uid === uid);
  }

  cartonWeight(): number {
    if (this.held?.kind !== 'cartons') return 0;
    return this.held.list.reduce((a, c) => a + 1.5 + PRODUCT_BY_ID[c.pid].mass * c.q, 0);
  }

  /** Le joueur peut-il voir ce point (champ de vision + ligne de vue) ? */
  canSee(x: number, y: number, z: number, maxD: number): boolean {
    const e = this.eye;
    const d = Math.hypot(x - e.x, z - e.z);
    if (d > maxD) return false;
    const f = this.forward();
    const dir = new THREE.Vector3(x - e.x, y - e.y, z - e.z).normalize();
    if (f.dot(dir) < Math.cos((this.game.settings.fov * 0.6 * Math.PI) / 180)) return false;
    return this.game.security.lineOfSight(e.x, e.z, x, z, e.y, y);
  }

  teleport(x: number, z: number, yaw?: number) {
    this.pos.set(x, 0, z);
    if (yaw !== undefined) this.yaw = yaw;
    this.body?.setTranslation({ x, y: 0.95, z }, true);
  }

  /** Joue une action (bras, gestes) sur le personnage du patron. */
  act(a: Parameters<Animator['play']>[0]) {
    if (this.anim && (this.anim.action !== a || this.anim.actionT > 0.9)) this.anim.play(a);
  }

  setMode(m: PlayerMode) {
    if (this.mode === m) return;
    this.mode = m;
    this.onModeChange?.(m);
  }

  // ---------------------------------------------------------------- objets tenus
  refreshHeld() {
    this.heldView.clear();
    this.carryIso.clear();
    if (this.game.headless) return;
    const h = this.held;
    if (!h) return;
    if (this.isoMode) {
      // vue 2.5D : les cartons sont portés devant le patron (visibles de loin)
      if (this.rig && !this.carryIso.parent) this.rig.root.add(this.carryIso);
      this.carryIso.position.set(0, 1.05 * (this.rig?.scale ?? 1), 0.42);
      if (h.kind === 'cartons')
        h.list.forEach((c, i) => {
          // au-delà de 3 cartons : deux piles côte à côte (le diable du patron)
          const two = h.list.length > 3;
          const o = cartonObject(c.pid, c.opened);
          o.position.set(two ? (i % 2 ? 0.2 : -0.2) : 0, (two ? Math.floor(i / 2) : i) * CARTON_SIZE.h, 0);
          o.rotation.y = 0.06 * i;
          if (two) o.scale.setScalar(0.85);
          this.carryIso.add(o);
        });
      else if (h.kind === 'item') this.carryIso.add(productMesh(h.pid));
      return;
    }
    if (h.kind === 'cartons') {
      h.list.forEach((c, i) => {
        const o = cartonObject(c.pid, c.opened);
        o.scale.setScalar(0.8);
        o.position.set(0.05, -0.5 + i * CARTON_SIZE.h * 0.8, -0.85);
        o.rotation.y = 0.05 * i;
        this.heldView.add(o);
      });
    } else if (h.kind === 'item') {
      const m = productMesh(h.pid);
      m.position.set(0.28, -0.28, -0.5);
      m.rotation.set(0.2, -0.4, 0);
      this.heldView.add(m);
    }
    this.heldView.traverse((o) => ((o as THREE.Mesh).castShadow = false));
  }

  dropHeld(throwIt = false) {
    const h = this.held;
    if (!h) return;
    const f = this.forward();
    const e = this.eye;
    const vel = throwIt ? { x: f.x * 7, y: f.y * 7 + 2, z: f.z * 7 } : { x: f.x * 0.8, y: 0, z: f.z * 0.8 };
    if (h.kind === 'cartons') {
      h.list.forEach((c, i) => this.game.items.spawnCarton(c, { x: e.x + f.x * 0.7, y: e.y - 0.5 + i * 0.36, z: e.z + f.z * 0.7 }, vel));
      this.game.bus.emit('sfx', { name: 'thud' });
    } else if (h.kind === 'item') {
      this.game.items.spawnLoose(h.pid, h.exp, { x: e.x + f.x * 0.5, y: e.y - 0.3, z: e.z + f.z * 0.5 }, vel);
    } else if (h.kind === 'cart') {
      this.releaseCart(throwIt);
    }
    this.held = null;
    this.refreshHeld();
  }

  grabCart(c: FreeCart) {
    if (this.held) return;
    c.heldBy = 'player';
    c.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
    this.held = { kind: 'cart', cart: c };
  }

  private releaseCart(push: boolean) {
    if (this.held?.kind !== 'cart') return;
    const c = this.held.cart;
    c.heldBy = null;
    c.body.setBodyType(R.RigidBodyType.Dynamic, true);
    if (push) {
      const f = this.forward();
      c.body.setLinvel({ x: f.x * 5, y: 0, z: f.z * 5 }, true);
      this.game.bus.emit('sfx', { name: 'cart' });
    }
  }

  // ---------------------------------------------------------------- boucle
  update(dt: number) {
    const inp = this.input;
    const s = this.game.settings;
    if ((this.mode === 'walk' || this.mode === 'cashier') && !this.isoMode) {
      if (inp.looking || this.game.headless) {
        this.yaw -= inp.mouseDX * 0.0022 * s.sensitivity;
        this.pitch = clamp(this.pitch + inp.mouseDY * 0.0022 * s.sensitivity * (s.invertY ? -1 : 1), -1.45, 1.45);
      }
      if (inp.pressed('camera')) {
        this.thirdPerson = !this.thirdPerson;
        s.thirdPerson = this.thirdPerson;
      }
    }
    if (this.mode === 'walk') this.move(dt);
    else this.speedNow = 0;
    if (this.mode === 'cashier' && this.lane) {
      // reste à son poste
      const p = this.lane.pts.cashier;
      this.pos.x = damp(this.pos.x, p.x, 8, dt);
      this.pos.z = damp(this.pos.z, p.z, 8, dt);
      this.body?.setNextKinematicTranslation({ x: this.pos.x, y: 0.95, z: this.pos.z });
      if (inp.pressed('quitterCaisse') || inp.pressed('reculer')) this.interaction.leaveCashier();
    }
    if ((this.mode === 'walk' || this.mode === 'cashier') && !this.isoMode) this.interaction.update(dt);
    if (this.held?.kind === 'cart') {
      const c = this.held.cart;
      const fx = this.pos.x + Math.sin(this.yaw) * 0.95;
      const fz = this.pos.z + Math.cos(this.yaw) * 0.95;
      c.body.setNextKinematicTranslation({ x: fx, y: 0.52, z: fz });
      c.body.setNextKinematicRotation({ x: 0, y: Math.sin((this.yaw + Math.PI) / 2), z: 0, w: Math.cos((this.yaw + Math.PI) / 2) });
    }
    this.updateCamera(dt);
    inp.endFrame();
  }

  private move(dt: number) {
    const inp = this.input;
    let mx = 0;
    let mz = 0;
    if (inp.down('avancer')) mz += 1;
    if (inp.down('reculer')) mz -= 1;
    if (inp.down('gauche')) mx += 1;
    if (inp.down('droite')) mx -= 1;
    // joystick tactile : analogique, pousser à fond fait courir
    const stick = Math.hypot(inp.moveX, inp.moveY);
    if (stick > 0.12) {
      mx -= inp.moveX;
      mz += inp.moveY;
    }
    // vue 2.5D : vitesse imposée par les ordres du patron
    if (this.isoMode && this.drive) {
      const sp = Math.hypot(this.drive.x, this.drive.z);
      if (sp > 0.01) this.yaw = Math.atan2(this.drive.x, this.drive.z);
      mx = 0;
      mz = 0;
    }
    const len = Math.hypot(mx, mz);
    const weight = this.cartonWeight();
    const carrying = this.held?.kind === 'cart' ? 0.85 : 1 - Math.min(0.45, weight / 60);
    const run = (inp.down('courir') || stick > 0.92) && weight < 20;
    const sp = (run ? 6.2 : 3.6) * carrying * (stick > 0.12 && stick <= 0.92 ? Math.max(0.35, stick / 0.92) : 1);
    let vx = 0;
    let vz = 0;
    if (len > 0) {
      mx /= len;
      mz /= len;
      vx = (Math.sin(this.yaw) * mz + Math.cos(this.yaw) * mx) * sp;
      vz = (Math.cos(this.yaw) * mz - Math.sin(this.yaw) * mx) * sp;
    }
    if (this.isoMode && this.drive) {
      // suit le rythme du temps de jeu (plafonné), sans jamais dépasser le point visé
      const k = this.game.paused ? 0 : Math.min(8, this.game.st.speed);
      vx = this.drive.x * k;
      vz = this.drive.z * k;
      if (this.drive.tx !== undefined && this.drive.tz !== undefined) {
        const dist = Math.hypot(this.drive.tx - this.pos.x, this.drive.tz - this.pos.z);
        const step = Math.hypot(vx, vz) * dt;
        if (step > dist && step > 1e-6) {
          vx *= dist / step;
          vz *= dist / step;
        }
      }
    }
    if (this.grounded && inp.pressed('sauter') && weight < 10) this.velY = 4.2;
    this.velY -= 9.81 * dt;
    const desired = { x: vx * dt, y: this.velY * dt, z: vz * dt };
    if (this.controller && this.collider && this.body) {
      this.controller.computeColliderMovement(this.collider, desired, undefined, groups(G_PLAYER, G_STATIC | G_DYNAMIC | G_AGENT | G_CART));
      const m = this.controller.computedMovement();
      this.grounded = this.controller.computedGrounded();
      if (this.grounded && this.velY < 0) this.velY = 0;
      const t = this.body.translation();
      const nx = t.x + m.x;
      const ny = Math.max(0.95 - 0.0, t.y + m.y);
      const nz = t.z + m.z;
      this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
      this.speedNow = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
      this.pos.set(nx, ny - 0.95, nz);
    } else {
      this.pos.x += desired.x;
      this.pos.z += desired.z;
    }
    if (this.speedNow > 0.3) this.bob += dt * this.speedNow * 2.4;
    if (this.speedNow > 0.3 && Math.floor(this.bob / Math.PI) !== Math.floor((this.bob - dt * this.speedNow * 2.4) / Math.PI)) this.game.bus.emit('sfx', { name: 'step' });
  }

  private updateCamera(dt: number) {
    const cam = this.game.camera;
    if (this.isoMode) {
      if (this.rig && this.anim) {
        this.rig.root.visible = true;
        this.rig.root.position.set(this.pos.x, this.pos.y, this.pos.z);
        this.rig.root.rotation.y = this.yaw;
        this.anim.speed = this.speedNow;
        this.anim.hold = this.held?.kind === 'cartons' ? 'carry' : this.held?.kind === 'cart' ? 'push' : 'none';
        this.anim.update(dt, this.yaw, this.pos);
      }
      return;
    }
    if (this.mode === 'build') return;
    const e = this.eye;
    const tp = this.thirdPerson && this.mode !== 'cashier';
    if (this.rig && this.anim) {
      this.rig.root.visible = tp;
      this.rig.root.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.rig.root.rotation.y = this.yaw;
      this.anim.speed = this.speedNow;
      this.anim.hold = this.held?.kind === 'cartons' ? 'carry' : this.held?.kind === 'cart' ? 'push' : 'none';
      if (tp) this.anim.update(dt, this.yaw, this.pos);
    }
    cam.rotation.order = 'YXZ';
    if (tp) {
      const back = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch) + 0.15, -Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
      let dist = this.tpDist;
      const hit = this.game.physics.raycast({ x: e.x, y: e.y, z: e.z }, back, dist + 0.3, groups(0xffff, G_STATIC));
      if (hit) dist = Math.max(0.6, hit.toi - 0.3);
      cam.position.set(e.x + back.x * dist, e.y + back.y * dist, e.z + back.z * dist);
      cam.lookAt(e.x, e.y - 0.1, e.z);
      this.heldView.visible = false;
    } else {
      cam.position.copy(e);
      cam.rotation.set(-this.pitch, this.yaw + Math.PI, 0);
      this.heldView.visible = true;
    }
    if (this.game.settings.fov !== cam.fov) {
      cam.fov = this.game.settings.fov;
      cam.updateProjectionMatrix();
    }
  }
}
