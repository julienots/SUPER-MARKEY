/** Passants du quartier : ils vont d'un point à un autre, traversent aux passages piétons et entrent parfois sur un coup de tête. */
import { BUILDINGS, EDGE_POINTS } from '../data/world';
import { ARCHETYPES } from '../data/archetypes';
import { Rng } from '../core/rng';
import { randomAppearance } from './character';
import { Agent } from './agent';
import type { Game } from '../game/game';

export class Pedestrian extends Agent {
  readonly kind = 'pedestrian' as const;
  private checked = false;
  private life = 0;
  forceVisit = false;

  constructor(game: Game, x: number, z: number, dest: { x: number; z: number }, public archetype: string) {
    super(game, !game.needsLook ? null : randomAppearance(new Rng(Math.floor(Math.random() * 1e9)), { female: Math.random() < 0.5, age: 14 + Math.floor(Math.random() * 65), archetype }), x, z);
    this.walkSpeed = 1.2 + Math.random() * 0.35;
    if (!this.setGoal(dest.x, dest.z)) this.dead = true;
    if (Math.random() < 0.1) this.play('phone');
  }

  update(dt: number) {
    this.life += dt;
    const r = this.moveAlong(dt);
    if (r !== 'moving' || this.life > 400) {
      this.dead = true;
      return;
    }
    // passage devant la vitrine : envie d'entrer ?
    if (!this.checked && this.pos.z > -16 && this.pos.z < -12 && Math.abs(this.pos.x - this.game.storeDoor().x) < 9) {
      this.checked = true;
      const p = this.forceVisit ? 0.85 : this.game.impulseChance();
      if (Math.random() < p) {
        this.dead = true;
        this.game.spawnCustomer(null, { archetype: this.archetype, from: { x: this.pos.x, z: this.pos.z }, exit: this.goal ?? undefined, boost: this.forceVisit ? { boissons: 2, snacks: 2 } : undefined });
      }
    }
  }
}

export function randomDestination(): { x: number; z: number } {
  if (Math.random() < 0.55) {
    const e = EDGE_POINTS[Math.floor(Math.random() * EDGE_POINTS.length)];
    return { x: e[0], z: e[1] };
  }
  const b = BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
  return { x: b.door[0], z: b.door[1] };
}

export function randomArchetype(): string {
  const r = Math.random() * ARCHETYPES.reduce((a, x) => a + x.weight, 0);
  let acc = 0;
  for (const a of ARCHETYPES) {
    acc += a.weight;
    if (r <= acc) return a.id;
  }
  return 'actif';
}
