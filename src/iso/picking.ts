/**
 * Sélection au doigt dans la vue 2.5D : un rayon depuis l'écran est testé contre des boîtes simples
 * (meubles, personnages, palettes, salissures). Le plus proche de la caméra gagne ; sinon on renvoie le sol.
 */
import * as THREE from 'three';
import { CELL, EQUIPMENT_BY_ID } from '../data/equipment';
import { equipCenter, footprint, WALL_H } from '../sim/layout';
import type { PlacedEquip } from '../sim/state';
import type { Agent } from '../entities/agent';
import type { Game } from '../game/game';

export type Pick =
  | { kind: 'equip'; e: PlacedEquip }
  | { kind: 'agent'; a: Agent }
  | { kind: 'player' }
  | { kind: 'pallet'; uid: number }
  | { kind: 'mess'; uid: number }
  | { kind: 'ground'; x: number; z: number };

const box = new THREE.Box3();
const hit = new THREE.Vector3();

export function pick(game: Game, ray: THREE.Ray): Pick | null {
  let best: Pick | null = null;
  let bestD = Infinity;
  const test = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, p: Pick, bias = 0) => {
    box.min.set(x0, y0, z0);
    box.max.set(x1, y1, z1);
    if (!ray.intersectBox(box, hit)) return;
    // les petits éléments (personnages) passent devant les meubles qu'ils chevauchent
    const d = hit.distanceTo(ray.origin) - bias;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  };
  const st = game.st;
  // personnages (prioritaires : on les vise plus facilement)
  const pl = game.player.pos;
  test(pl.x - 0.4, 0, pl.z - 0.4, pl.x + 0.4, 1.9, pl.z + 0.4, { kind: 'player' }, 1.2);
  for (const a of game.agents.list) {
    if (a.dead || a.kind === 'pedestrian') continue;
    test(a.pos.x - 0.38, 0, a.pos.z - 0.38, a.pos.x + 0.38, 1.85, a.pos.z + 0.38, { kind: 'agent', a }, 1.2);
  }
  for (const [uid, v] of game.items.pallets) {
    const t = v.body.translation();
    test(t.x - 0.65, 0, t.z - 0.65, t.x + 0.65, 1.4, t.z + 0.65, { kind: 'pallet', uid }, 0.4);
  }
  for (const m of st.messes) test(m.x - 0.55, 0, m.z - 0.55, m.x + 0.55, 0.25, m.z + 0.55, { kind: 'mess', uid: m.uid }, 0.6);
  // meubles (les éléments au plafond ne sont pas visibles en vue coupée)
  for (const e of st.equipment) {
    const d = EQUIPMENT_BY_ID[e.def];
    if (d.mount === 'ceiling') continue;
    const f = footprint(d, e.rot);
    const c = equipCenter(e);
    const hw = (f.w * CELL) / 2;
    const hd = (f.d * CELL) / 2;
    const y0 = d.mount === 'wall' ? Math.max(0, Math.min(WALL_H - 1, 1.2)) : 0;
    const y1 = Math.min(d.mount === 'wall' ? 2.6 : d.h || 1.2, 2.6);
    test(c.x - hw, y0, c.z - hd, c.x + hw, y1, c.z + hd, { kind: 'equip', e });
  }
  if (best) return best;
  const p = new THREE.Vector3();
  if (ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return { kind: 'ground', x: p.x, z: p.z };
  return null;
}
