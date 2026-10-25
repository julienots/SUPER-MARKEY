/**
 * Tableau des tâches du personnel, généré à partir de l'état réel du magasin :
 * rayons à remplir, palettes à ranger, produits tombés, salissures, périmés, caisses auto bloquées, clients à calmer.
 */
import { PRODUCT_BY_ID } from '../data/products';
import { slotInfo } from '../sim/layout';
import { backroomUnits, capacityFor, expiredInSlot, slotQty } from '../sim/inventory';
import { dayOf } from '../sim/state';
import type { Game } from './game';

export type TaskKind = 'restock' | 'putaway' | 'pickup' | 'clean' | 'expired' | 'assist' | 'calm';

export interface Task {
  id: string;
  kind: TaskKind;
  prio: number;
  x: number;
  z: number;
  claimedBy: number | null;
  data: Record<string, any>;
}

export const ROLE_TASKS: Record<string, TaskKind[]> = {
  rayon: ['restock', 'expired', 'pickup'],
  logisticien: ['putaway', 'restock', 'pickup'],
  entretien: ['clean', 'pickup'],
  caissier: ['assist'],
  manager: ['calm', 'assist', 'pickup'],
  securite: [],
};

export const TASK_NAMES: Record<TaskKind, string> = {
  restock: 'Remplir les rayons',
  putaway: 'Ranger les livraisons',
  pickup: 'Ramasser les produits tombés',
  clean: 'Nettoyer',
  expired: 'Retirer les périmés',
  assist: 'Aider en caisse auto',
  calm: 'Calmer un client',
};

export class TaskBoard {
  tasks = new Map<string, Task>();
  private t = 0;
  /** Tâches temporairement ignorées (inaccessibles) : id → horloge de fin. */
  private banned = new Map<string, number>();

  ban(id: string, seconds: number) {
    this.banned.set(id, this.game.clock + seconds);
  }

  constructor(private game: Game) {}

  refresh() {
    const st = this.game.st;
    const next = new Map<string, Task>();
    const keep = (t: Omit<Task, 'claimedBy'>) => {
      const old = this.tasks.get(t.id);
      next.set(t.id, { ...t, claimedBy: old?.claimedBy ?? null });
    };
    const day = dayOf(st.time);
    const backroomCache = new Map<string, number>();
    const br = (pid: string) => {
      let v = backroomCache.get(pid);
      if (v === undefined) backroomCache.set(pid, (v = backroomUnits(st, pid) - st.pallets.reduce((a, p) => a + p.cartons.filter((c) => c.pid === pid).reduce((b, c) => b + c.q, 0), 0) - st.worldCartons.filter((c) => c.pid === pid).reduce((a, c) => a + c.q, 0)));
      return v;
    };
    for (const e of st.equipment) {
      if (!e.slots) continue;
      e.slots.forEach((s, idx) => {
        if (!s.pid) return;
        const q = slotQty(s);
        const cap = capacityFor(e, idx, s.pid);
        const inf = slotInfo(e, idx);
        if (q < cap * 0.55 && br(s.pid) > 0) {
          keep({ id: `restock:${e.uid}:${idx}`, kind: 'restock', prio: (1 - q / cap) * 2 + (q === 0 ? 2 : 0) + PRODUCT_BY_ID[s.pid].popularity, x: inf.access.x, z: inf.access.z, data: { uid: e.uid, idx, pid: s.pid } });
        }
        if (expiredInSlot(s, day) > 0) keep({ id: `expired:${e.uid}:${idx}`, kind: 'expired', prio: 3.5, x: inf.access.x, z: inf.access.z, data: { uid: e.uid, idx } });
      });
    }
    for (const p of st.pallets) {
      const pos = this.game.items.palletPos(p.uid);
      if (pos) keep({ id: `putaway:p:${p.uid}`, kind: 'putaway', prio: 2 + p.cartons.length * 0.05, x: pos.x, z: pos.z, data: { pallet: p.uid } });
    }
    for (const c of st.worldCartons) {
      if (this.game.player.holdsCarton(c.uid)) continue;
      const pos = this.game.items.cartonPos(c.uid);
      if (pos) keep({ id: `putaway:c:${c.uid}`, kind: 'putaway', prio: 1.5, x: pos.x, z: pos.z, data: { carton: c.uid } });
    }
    for (const l of st.looseItems) {
      const pos = this.game.items.loosePos(l.uid);
      if (pos && pos.y < 1.5) keep({ id: `pickup:${l.uid}`, kind: 'pickup', prio: 2.2, x: pos.x, z: pos.z, data: { uid: l.uid } });
    }
    for (const m of st.messes) keep({ id: `clean:${m.uid}`, kind: 'clean', prio: 1.5 + m.amount * 2 + (m.kind === 'verre' ? 2 : 0), x: m.x, z: m.z, data: { uid: m.uid } });
    for (const l of this.game.checkouts.lanes.values()) if (l.scan?.needAssist) keep({ id: `assist:${l.uid}`, kind: 'assist', prio: 5, x: l.pts.pay.x, z: l.pts.pay.z, data: { lane: l.uid } });
    for (const c of this.game.specials.angryCustomers()) keep({ id: `calm:${c.id}`, kind: 'calm', prio: 6, x: c.pos.x, z: c.pos.z, data: { agent: c.id } });
    // libère les réservations d'employés partis
    const present = new Set(this.game.staff.agents.map((a) => a.emp.id));
    for (const t of next.values()) if (t.claimedBy !== null && !present.has(t.claimedBy)) t.claimedBy = null;
    this.tasks = next;
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 1.2;
      this.refresh();
    }
  }

  claim(empId: number, kinds: TaskKind[], x: number, z: number, preferred: string | null): Task | null {
    let best: Task | null = null;
    let bestScore = -Infinity;
    for (const t of this.tasks.values()) {
      if (t.claimedBy !== null && t.claimedBy !== empId) continue;
      const b = this.banned.get(t.id);
      if (b !== undefined && b > this.game.clock) continue;
      if (!kinds.includes(t.kind)) continue;
      const pref = preferred && t.kind === preferred ? 3 : 0;
      const roleOrder = kinds.length - kinds.indexOf(t.kind);
      const score = t.prio + pref + roleOrder * 0.6 - Math.hypot(t.x - x, t.z - z) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) best.claimedBy = empId;
    return best;
  }

  release(id: string) {
    const t = this.tasks.get(id);
    if (t) t.claimedBy = null;
  }

  done(id: string) {
    this.tasks.delete(id);
  }

  count(kind?: TaskKind) {
    let n = 0;
    for (const t of this.tasks.values()) if (!kind || t.kind === kind) n++;
    return n;
  }
}
