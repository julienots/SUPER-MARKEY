/**
 * Le livreur : arrive à pied par l'entrée avec son diable chargé de cartons, file à la réserve, range la
 * commande dans les racks (ce qui ne rentre pas est posé au sol à côté), puis repart.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Agent } from './agent';
import { randomAppearance } from './character';
import { cartonObject, CARTON_SIZE } from './items';
import { storeCarton } from '../sim/inventory';
import { orderCartons } from '../sim/orders';
import { accessCells, cellCenter } from '../sim/layout';
import type { Order, PlacedEquip } from '../sim/state';
import type { Game } from '../game/game';

/** Range les cartons d'une commande (réserve, sinon au sol près de (x, z)). Renvoie le nombre posé au sol. */
export function stockOrder(game: Game, o: Order, x: number, z: number): number {
  const st = game.st;
  let floor = 0;
  for (const c of orderCartons(st, o, game.rng)) {
    if (storeCarton(st, c)) continue;
    floor++;
    if (game.headless) st.worldCartons.push({ ...c, x: x + (Math.random() - 0.5), y: 0.2, z: z + (Math.random() - 0.5), ry: 0 });
    else game.items.spawnCarton(c, { x: x + (Math.random() - 0.5) * 1.2, y: 0.3 + floor * 0.05, z: z + (Math.random() - 0.5) * 1.2 });
  }
  o.status = 'livree';
  game.equipView.markDirty();
  return floor;
}

export class Courier extends Agent {
  readonly kind = 'special' as const;
  private phase: 'in' | 'drop' | 'out' = 'in';
  private t = 0;
  private start: { x: number; z: number };
  private target: { x: number; z: number };

  constructor(game: Game, public order: Order) {
    const door = game.storeDoor();
    const sx = door.x + 14;
    const sz = -9;
    super(game, Courier.look(game, order), sx, sz);
    this.start = { x: sx, z: sz };
    this.name = 'Livreur';
    this.walkSpeed = 1.55;
    this.navOpts = { staff: true, keys: true };
    this.target = this.dropPoint();
    if (!this.setGoal(this.target.x, this.target.z)) {
      // pas de chemin : livraison posée devant la porte
      this.target = { x: door.x, z: 0.8 };
      this.setGoal(this.target.x, this.target.z, {});
    }
    // le diable chargé (jusqu'à 5 cartons visibles)
    const n = Math.min(5, order.lines.reduce((a, l) => a + l.cartons, 0));
    const stack = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const c = cartonObject(order.lines[i % order.lines.length].pid, false);
      c.position.y = i * CARTON_SIZE.h * 0.9;
      c.scale.setScalar(0.9);
      stack.add(c);
    }
    this.attachCarry(stack);
    this.say('📦', undefined, 2);
  }

  /** Tenue orange de livreur, casquette. */
  static look(game: Game, order: Order) {
    if (!game.needsLook) return null;
    const a = randomAppearance(new Rng(order.id * 7919), { female: order.id % 3 === 0, age: 24 + (order.id % 20), uniform: 0xe67e22, role: 'logisticien' });
    a.hat = 'casquette';
    a.hatColor = 0xe67e22;
    return a;
  }

  /** Devant le rack de réserve le plus proche (sinon dans la réserve, sinon à l'entrée). */
  private dropPoint(): { x: number; z: number } {
    const g = this.game;
    const racks: PlacedEquip[] = g.st.equipment.filter((e) => e.def === 'rack_reserve' || e.def === 'chambre_froide');
    for (const r of racks)
      for (const [gx, gz] of accessCells(r)) {
        const c = cellCenter(gx, gz);
        if (g.nav.walkableAt(c.x, c.z, this.navOpts)) return c;
      }
    const rect = g.storeRect();
    return { x: (rect.x0 + rect.x1) / 2, z: rect.backZ + 1 };
  }

  update(dt: number) {
    this.t += dt;
    if (this.phase === 'in') {
      const r = this.moveAlong(dt);
      if (r === 'arrived' || r === 'stuck' || this.t > 240) {
        this.phase = 'drop';
        this.t = 0;
        this.stopMoving();
        this.play('reach');
      }
    } else if (this.phase === 'drop') {
      if (this.t > 2.2) {
        const floor = stockOrder(this.game, this.order, this.pos.x, this.pos.z);
        this.attachCarry(null);
        const n = this.order.lines.reduce((a, l) => a + l.cartons, 0);
        this.game.bus.emit('notify', { text: floor ? `📦 Livraison #${this.order.id} : ${n - floor} carton(s) rangés en réserve, ${floor} posé(s) au sol (réserve pleine).` : `📦 Livraison #${this.order.id} : ${n} carton(s) rangés dans la réserve. Bonne vente !`, kind: floor ? 'bad' : 'good' });
        this.game.bus.emit('sfx', { name: 'thud', x: this.pos.x, z: this.pos.z });
        this.say('👋', 'Bonne journée !', 2);
        this.phase = 'out';
        this.t = 0;
        this.setGoal(this.start.x, this.start.z);
      }
    } else {
      const r = this.moveAlong(dt);
      if (r !== 'moving' || this.t > 240) this.dead = true;
    }
  }
}
