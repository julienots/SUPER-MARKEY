/** Petites catastrophes physiques déclenchées par les systèmes : pyramides qui s'effondrent, produits qui tombent. */
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { BARKS } from '../data/lines';
import { slotInfo } from '../sim/layout';
import { takeFromSlot } from '../sim/inventory';
import type { PlacedEquip } from '../sim/state';
import type { Agent } from '../entities/agent';
import type { Game } from './game';

export class PhysicsFun {
  constructor(private game: Game) {}

  /** Un client (ou son caddie) bouscule un rayon : 0 à n articles tombent réellement. */
  maybeKnock(a: Agent & { basket?: any[] }, e: PlacedEquip, idx: number) {
    const def = EQUIPMENT_BY_ID[e.def];
    const pile = !!def.shelf?.pile;
    const cart = (a as any).carryMode === 'cart';
    const p = pile ? (cart ? 0.06 : 0.025) : cart ? 0.008 : 0.003;
    if (Math.random() >= p) return;
    this.knock(e, idx, pile ? 3 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 2), a);
  }

  knock(e: PlacedEquip, idx: number, n: number, by?: Agent) {
    const g = this.game;
    const inf = slotInfo(e, idx);
    const base = g.equipView.slotWorld(e, idx);
    let fell = 0;
    for (let i = 0; i < n; i++) {
      const it = takeFromSlot(e, idx);
      if (!it) break;
      const sp = 1 + Math.random() * 1.5;
      const l = g.items.spawnLoose(
        it.pid,
        it.exp,
        { x: base.x + (Math.random() - 0.5) * 0.4, y: base.y + 0.15 + i * 0.08, z: base.z + (Math.random() - 0.5) * 0.4 },
        { x: inf.normal.x * sp + (Math.random() - 0.5), y: 1 + Math.random(), z: inf.normal.z * sp + (Math.random() - 0.5) },
      );
      if (l) fell++;
    }
    if (!fell) return;
    g.equipView.markDirty();
    g.bus.emit('sfx', { name: 'tumble', x: base.x, z: base.z });
    if (by) {
      by.play('slip');
      by.say('😱', BARKS.bump[Math.floor(Math.random() * BARKS.bump.length)], 2.5);
    }
    if (fell >= 3) g.bus.emit('notify', { text: `🫠 Effondrement de présentoir : ${fell} articles par terre !`, kind: 'bad', quiet: true });
  }
}
