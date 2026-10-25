/**
 * Trafic : voitures qui circulent (et s'arrêtent pour les piétons), bus, camions de livraison qui viennent
 * réellement déposer des palettes au quai, voitures des clients qui se garent, police.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { SUPPLIER_BY_ID } from '../data/suppliers';
import { BUS_STOP } from '../data/world';
import { dampAngle } from '../core/math';
import { orderCartons } from '../sim/orders';
import type { Order } from '../sim/state';
import { carMesh, truckMesh, busMesh, policeMesh, CAR_COLORS } from '../world/vehicleMeshes';
import type { Game } from '../game/game';

type P = { x: number; z: number; stop?: number; tag?: string };

export interface Vehicle {
  id: number;
  kind: 'car' | 'truck' | 'bus' | 'police' | 'client';
  mesh: THREE.Group | null;
  body: RAPIER.RigidBody | null;
  route: P[];
  i: number;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  maxSpeed: number;
  wait: number;
  length: number;
  onStop?: (tag: string) => void;
  dead?: boolean;
  parked?: boolean;
  data?: any;
}

// voies (sens de circulation à droite)
const EAST = -18; // avenue, sens ouest → est
const WEST = -22;
const TIL_N = -38; // rue des Tilleuls, vers le nord (z croissant)
const TIL_S = -42;
const COT_N = 54;
const COT_S = 58;
const STADE_E = 44;
const STADE_W = 46;

let vid = 1;

export class VehicleManager {
  list: Vehicle[] = [];
  private trafficT = 2;
  private busT = 30;

  constructor(private game: Game) {}

  private create(kind: Vehicle['kind'], route: P[], mesh: THREE.Group | null, maxSpeed: number, length: number): Vehicle {
    const v: Vehicle = { id: vid++, kind, mesh, body: null, route, i: 1, x: route[0].x, z: route[0].z, yaw: 0, speed: maxSpeed * 0.6, maxSpeed, wait: 0, length };
    const d = Math.atan2(route[1].x - route[0].x, route[1].z - route[0].z);
    v.yaw = d;
    if (mesh) this.game.scene.add(mesh);
    const kb = this.game.physics.addKinematicBox(v.x, 0.8, v.z, kind === 'bus' || kind === 'truck' ? 1.2 : 0.9, 0.8, length / 2, { kind: 'vehicle', ref: v });
    v.body = kb.body;
    this.list.push(v);
    return v;
  }

  private randomTrafficRoute(): P[] {
    const r = Math.random();
    if (r < 0.35) return [{ x: -105, z: EAST }, { x: 105, z: EAST }];
    if (r < 0.7) return [{ x: 105, z: WEST }, { x: -105, z: WEST }];
    if (r < 0.8) return [{ x: TIL_N, z: -75 }, { x: TIL_N, z: EAST }, { x: 105, z: EAST }];
    if (r < 0.9) return [{ x: 105, z: WEST }, { x: COT_S + 0, z: WEST }, { x: COT_S, z: -75 }];
    return [{ x: TIL_N, z: -75 }, { x: TIL_N, z: STADE_E }, { x: COT_N, z: STADE_E }, { x: COT_N, z: EAST }, { x: 105, z: EAST }];
  }

  spawnTraffic() {
    if (this.list.filter((v) => v.kind === 'car').length > (this.game.events.isActive('travaux_rue') ? 3 : 9)) return;
    const route = this.randomTrafficRoute();
    const mesh = this.game.headless ? null : carMesh(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], Math.random() < 0.5 ? 'citadine' : 'berline');
    this.create('car', route, mesh, 8 + Math.random() * 3, 4.2);
  }

  /** Camion de livraison : rue du Stade → cour → quai → dépose les palettes → repart. */
  spawnDelivery(o: Order) {
    const r = this.game.storeRect();
    const dockX = r.dockDoorX;
    const yardZ = r.z1 + 9;
    const route: P[] = [
      { x: TIL_N, z: -75 },
      { x: TIL_N, z: STADE_E },
      { x: dockX + 6, z: STADE_E },
      { x: dockX + 6, z: Math.min(40, yardZ + 4) },
      { x: dockX, z: yardZ, stop: 6, tag: 'dock' },
      { x: dockX + 6, z: Math.min(40, yardZ + 4) },
      { x: dockX + 8, z: STADE_E },
      { x: COT_N, z: STADE_E },
      { x: COT_N, z: EAST },
      { x: 105, z: EAST },
    ];
    const sup = SUPPLIER_BY_ID[o.supplier];
    const mesh = this.game.headless ? null : truckMesh(sup.name.toUpperCase().slice(0, 22), sup.id === 'froid' ? 0x0984e3 : sup.id === 'primeur' ? 0x27ae60 : sup.id === 'discount' ? 0xfdcb6e : 0xe84118);
    const v = this.create('truck', route, mesh, 7, 7.2);
    v.data = { order: o };
    v.onStop = (tag) => {
      if (tag !== 'dock') return;
      this.unload(v);
    };
    o.status = 'livraison';
    this.game.bus.emit('notify', { text: `🚚 Le camion ${sup.name} arrive au quai (commande #${o.id}).`, kind: 'info' });
    return v;
  }

  private unload(v: Vehicle) {
    const g = this.game;
    const o: Order = v.data.order;
    const cartons = orderCartons(g.st, o, g.rng);
    const r = g.storeRect();
    let k = 0;
    while (cartons.length) {
      const batch = cartons.splice(0, 12);
      const x = r.dockDoorX - 1.6 + (k % 3) * 1.4;
      const z = r.z1 + 2.2 + Math.floor(k / 3) * 1.4;
      g.items.spawnPallet(batch, x, z);
      k++;
    }
    o.status = 'livree';
    g.bus.emit('sfx', { name: 'truck', x: v.x, z: v.z });
    g.bus.emit('notify', { text: `📦 Livraison #${o.id} déposée au quai : ${o.lines.reduce((a, l) => a + l.cartons, 0)} cartons sur ${k} palette(s). À ranger en réserve !`, kind: 'good' });
  }

  /** Livraison instantanée (nuit sautée) : palettes posées directement. */
  deliverNow(o: Order) {
    const v = { data: { order: o }, x: 0, z: 0 } as any;
    this.unload(v);
  }

  /** Voiture d'un client : se gare, le client descend ; repart quand il revient. */
  spawnClientCar(onParked: (spot: number, x: number, z: number) => void): boolean {
    const spots = this.game.storeBuilding.parkingSpots;
    const free = spots.map((s, i) => ({ s, i })).filter((x) => !x.s.taken);
    if (!free.length || this.game.events.isActive('travaux_rue')) return false;
    const { s, i } = free[Math.floor(Math.random() * free.length)];
    s.taken = true;
    const route: P[] = [
      { x: -105, z: EAST },
      { x: 13, z: EAST },
      { x: 13, z: -6 },
      { x: s.x, z: -6 },
      { x: s.x, z: s.z, stop: 1e9, tag: 'park' },
    ];
    const mesh = this.game.headless ? null : carMesh(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], Math.random() < 0.5 ? 'break' : 'berline');
    const v = this.create('client', route, mesh, 7, 4.4);
    v.data = { spot: i };
    v.onStop = (tag) => {
      if (tag === 'park') {
        v.parked = true;
        v.speed = 0;
        onParked(i, s.x + 1.2, s.z + 1.6);
      }
    };
    return true;
  }

  leaveParking(spot: number) {
    const v = this.list.find((x) => x.kind === 'client' && x.data?.spot === spot);
    const sp = this.game.storeBuilding.parkingSpots[spot];
    if (sp) sp.taken = false;
    if (!v) return;
    v.parked = false;
    v.route = [{ x: v.x, z: v.z }, { x: v.x, z: -6 }, { x: 13, z: -6 }, { x: 13, z: EAST }, { x: 105, z: EAST }];
    v.i = 1;
    v.wait = 1.5;
  }

  spawnBus() {
    const [bx] = BUS_STOP;
    const route: P[] = [{ x: -105, z: EAST }, { x: bx, z: EAST + 0.6, stop: 8, tag: 'bus' }, { x: 105, z: EAST }];
    const v = this.create('bus', route, this.game.headless ? null : busMesh(), 8, 11);
    v.onStop = () => this.game.busArrived();
  }

  spawnPolice() {
    const d = this.game.storeDoor();
    const route: P[] = [{ x: 105, z: WEST }, { x: 15, z: WEST }, { x: 13, z: EAST }, { x: d.x + 4, z: -6, stop: 20, tag: 'police' }, { x: 13, z: -6 }, { x: 13, z: EAST }, { x: 105, z: EAST }];
    const v = this.create('police', route, this.game.headless ? null : policeMesh(), 11, 4.5);
    this.game.bus.emit('sfx', { name: 'siren', x: v.x, z: v.z });
  }

  update(dt: number, t: number) {
    this.trafficT -= dt;
    if (this.trafficT <= 0) {
      this.trafficT = 3 + Math.random() * 5;
      this.spawnTraffic();
    }
    this.busT -= dt;
    if (this.busT <= 0) {
      this.busT = 90 + Math.random() * 60;
      this.spawnBus();
    }
    const agents = this.game.agents.list;
    for (const v of this.list) {
      if (v.parked) continue;
      if (v.wait > 0) {
        v.wait -= dt;
        if (v.wait <= 0 && v.onStop && v.route[v.i - 1]?.tag) {
          /* déjà traité */
        }
      } else {
        const tgt = v.route[v.i];
        if (!tgt) {
          v.dead = true;
          continue;
        }
        const dx = tgt.x - v.x;
        const dz = tgt.z - v.z;
        const d = Math.hypot(dx, dz);
        // obstacle devant : autre véhicule ou piéton sur la chaussée
        let blocked = false;
        const fx = Math.sin(v.yaw);
        const fz = Math.cos(v.yaw);
        for (const o of this.list) {
          if (o === v || o.dead) continue;
          const ox = o.x - v.x;
          const oz = o.z - v.z;
          const ahead = ox * fx + oz * fz;
          const side = Math.abs(-ox * fz + oz * fx);
          if (ahead > 0 && ahead < v.length / 2 + o.length / 2 + 3 && side < 1.6) {
            blocked = true;
            break;
          }
        }
        if (!blocked)
          for (const a of agents) {
            const ox = a.pos.x - v.x;
            const oz = a.pos.z - v.z;
            const ahead = ox * fx + oz * fz;
            const side = Math.abs(-ox * fz + oz * fx);
            if (ahead > 0 && ahead < v.length / 2 + 4 && side < 1.6) {
              blocked = true;
              break;
            }
          }
        const pp = this.game.player.pos;
        {
          const ox = pp.x - v.x;
          const oz = pp.z - v.z;
          const ahead = ox * fx + oz * fz;
          if (ahead > 0 && ahead < v.length / 2 + 4 && Math.abs(-ox * fz + oz * fx) < 1.6) {
            blocked = true;
            if (Math.random() < dt * 0.4) this.game.bus.emit('sfx', { name: 'horn', x: v.x, z: v.z });
          }
        }
        const slowForStop = tgt.stop !== undefined ? Math.min(1, d / 8) : 1;
        const corner = v.route[v.i + 1] ? Math.min(1, 0.45 + d / 14) : 1;
        const want = blocked ? 0 : v.maxSpeed * Math.max(0.15, Math.min(slowForStop, corner));
        v.speed += (want - v.speed) * Math.min(1, dt * (blocked ? 4 : 1.5));
        if (d < 0.6) {
          v.i++;
          if (tgt.stop !== undefined) {
            v.wait = tgt.stop;
            v.speed = 0;
            v.onStop?.(tgt.tag ?? '');
          }
        } else {
          const step = Math.min(d, v.speed * dt);
          v.x += (dx / d) * step;
          v.z += (dz / d) * step;
          v.yaw = dampAngle(v.yaw, Math.atan2(dx, dz), 3, dt);
        }
      }
      if (v.body) {
        v.body.setNextKinematicTranslation({ x: v.x, y: 0.8, z: v.z });
        v.body.setNextKinematicRotation({ x: 0, y: Math.sin(v.yaw / 2), z: 0, w: Math.cos(v.yaw / 2) });
      }
      if (v.mesh) {
        v.mesh.position.set(v.x, 0, v.z);
        v.mesh.rotation.y = v.yaw;
        const wheels = (v.mesh as any).wheels as THREE.Mesh[] | undefined;
        if (wheels) for (const w of wheels) w.rotation.x += (v.speed * dt) / 0.35;
        (v.mesh as any).flash?.(t);
      }
    }
    for (const v of this.list.filter((x) => x.dead)) {
      if (v.mesh) this.game.scene.remove(v.mesh);
      if (v.body) this.game.physics.removeBody(v.body);
    }
    this.list = this.list.filter((x) => !x.dead);
  }

  clear() {
    for (const v of this.list) {
      if (v.mesh) this.game.scene.remove(v.mesh);
      if (v.body) this.game.physics.removeBody(v.body);
    }
    this.list = [];
    for (const s of this.game.storeBuilding.parkingSpots) s.taken = false;
  }

  truckAtDock(): boolean {
    return this.list.some((v) => v.kind === 'truck' && v.wait > 0);
  }
}
