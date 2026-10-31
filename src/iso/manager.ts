/**
 * Le patron en vue 2.5D : on lui donne des ordres d'un appui (aller quelque part, remplir un rayon depuis la
 * réserve, ranger une palette, tenir la caisse, nettoyer…), il les exécute physiquement (marche, cartons portés,
 * remplissage unité par unité) avec les mêmes règles que les employés.
 */
import { PRODUCT_BY_ID } from '../data/products';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { accessCells, cellCenter, slotInfo } from '../sim/layout';
import { freeSpace, rackFree, slotQty } from '../sim/inventory';
import type { PlacedEquip } from '../sim/state';
import type { Game } from '../game/game';
import type { Lane } from '../game/checkout';
import type { Agent } from '../entities/agent';

type Step = (dt: number) => 'continue' | 'done' | 'fail';

interface Job {
  label: string;
  steps: Step[];
  i: number;
}

export class Manager {
  private job: Job | null = null;
  private path: { x: number; z: number }[] | null = null;
  private pathI = 0;
  private waitT = 0;
  private stuckT = 0;
  private stuckD = Infinity;
  /** Texte d'état (affiché dans l'interface). */
  status = '';
  onMessage: ((text: string, kind?: string) => void) | null = null;

  constructor(private game: Game) {}

  get busy() {
    return !!this.job;
  }

  get label() {
    return this.job?.label ?? '';
  }

  cancel() {
    this.job = null;
    this.path = null;
    this.game.player.drive = null;
    this.status = '';
  }

  private say(t: string, kind = 'info') {
    this.onMessage?.(t, kind);
  }

  private start(label: string, steps: Step[]) {
    const p = this.game.player;
    if (p.mode === 'cashier' && !label.startsWith('Caisse')) p.interaction.leaveCashier();
    this.job = { label, steps, i: 0 };
    this.status = label;
  }

  // ---------------------------------------------------------------- déplacements
  private walkTo(x: number, z: number): Step {
    let planned = false;
    return (dt) => {
      const p = this.game.player;
      if (!planned) {
        planned = true;
        const path = this.game.nav.findPath(p.pos.x, p.pos.z, x, z, { staff: true, keys: true });
        if (!path) {
          this.say('Le patron ne trouve pas de chemin jusque-là.', 'bad');
          return 'fail';
        }
        this.path = path;
        this.pathI = path.length > 1 ? 1 : 0;
        this.stuckD = Infinity;
        this.stuckT = 0;
      }
      return this.follow(dt) ? 'done' : 'continue';
    };
  }

  /** Avance le long du chemin ; vrai quand arrivé. */
  private follow(dt = 0): boolean {
    const p = this.game.player;
    if (!this.path) return true;
    const t = this.path[this.pathI];
    const dx = t.x - p.pos.x;
    const dz = t.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    // coincé (porte, carton au sol, client immobile…) : on se dégage vers le point de passage
    if (d < this.stuckD - 0.05) {
      this.stuckD = d;
      this.stuckT = 0;
    } else if ((this.stuckT += dt) > 1.2) {
      this.stuckT = 0;
      this.stuckD = Infinity;
      p.teleport(t.x, t.z, p.yaw);
      return false;
    }
    const last = this.pathI >= this.path.length - 1;
    if (d < (last ? 0.18 : 0.35)) {
      if (last) {
        this.path = null;
        p.drive = null;
        return true;
      }
      this.pathI++;
      this.stuckD = Infinity;
      this.stuckT = 0;
      return false;
    }
    const sp = p.held?.kind === 'cartons' ? 2.7 : 3.3;
    p.drive = { x: (dx / d) * sp, z: (dz / d) * sp, tx: t.x, tz: t.z };
    return false;
  }

  private face(x: number, z: number): Step {
    return () => {
      const p = this.game.player;
      p.yaw = Math.atan2(x - p.pos.x, z - p.pos.z);
      return 'done';
    };
  }

  private wait(s: number): Step {
    let t = 0;
    return (dt) => ((t += dt) >= s ? 'done' : 'continue');
  }

  /** Point libre pour accéder à un meuble (case d'accès la plus proche du patron). */
  private accessPoint(e: PlacedEquip): { x: number; z: number } {
    const p = this.game.player;
    const cells = accessCells(e);
    let best = cells[0];
    let bd = Infinity;
    for (const c of cells) {
      const w = cellCenter(c[0], c[1]);
      if (!this.game.nav.walkableAt(w.x, w.z, { staff: true, keys: true })) continue;
      const d = Math.hypot(w.x - p.pos.x, w.z - p.pos.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return cellCenter(best[0], best[1]);
  }

  // ---------------------------------------------------------------- ordres
  goTo(x: number, z: number) {
    this.start('Se déplace', [this.walkTo(x, z)]);
  }

  /**
   * Remplit les facings d'un meuble avec les cartons de la réserve. Le patron charge son diable (jusqu'à
   * 6 cartons de produits différents), remplit facing par facing, recommence si besoin, puis range le reste.
   */
  restock(e: PlacedEquip, only?: number) {
    const g = this.game;
    const st = g.st;
    const p = g.player;
    if (p.held && p.held.kind !== 'cartons') p.dropHeld(false);
    const CAP = 6;
    const isRack = (r: PlacedEquip) => r.def === 'rack_reserve' || r.def === 'chambre_froide';
    const slots = () => (e.slots ?? []).map((s, idx) => ({ s, idx })).filter(({ s, idx }) => s.pid && (only === undefined || only === idx) && freeSpace(e, idx) > 0);
    const heldOf = (pid: string) => (p.held?.kind === 'cartons' ? p.held.list.filter((c) => c.pid === pid).reduce((a, c) => a + c.q, 0) : 0);
    const inRacks = (pid: string) => st.equipment.some((r) => isRack(r) && r.cartons?.some((c) => c.pid === pid));
    const pids0 = [...new Set(slots().map((n) => n.s.pid!))];
    if (!pids0.length) {
      this.say('Ce meuble est déjà plein (ou n’a pas de produits assignés).');
      return;
    }
    if (!pids0.some((pid) => inRacks(pid) || heldOf(pid) > 0)) {
      this.say(`Réserve vide pour ce rayon (${pids0.map((x) => PRODUCT_BY_ID[x].name).slice(0, 2).join(', ')}…). Commandez au grossiste !`, 'bad');
      return;
    }
    /** Unités manquantes par produit (place libre − ce qui est déjà porté). */
    const missing = () => {
      const m = new Map<string, number>();
      for (const { s, idx } of slots()) m.set(s.pid!, (m.get(s.pid!) ?? 0) + freeSpace(e, idx));
      for (const [pid, n] of m) m.set(pid, n - heldOf(pid));
      return m;
    };
    let phase: 'collect' | 'fill' | 'return' = 'collect';
    let sub: Step | null = null;
    let rounds = 0;
    let acc = 0;
    let target: { idx: number; pid: string } | null = null;
    const loop: Step = (dt) => {
      if (sub) {
        const r = sub(dt);
        if (r === 'continue') return 'continue';
        sub = null;
        if (r === 'fail') return 'fail';
        if (phase === 'return') return 'done';
        return 'continue';
      }
      const count = p.held?.kind === 'cartons' ? p.held.list.length : 0;
      if (phase === 'collect') {
        // rack le plus proche qui contient un produit encore manquant
        const need = [...missing()].filter(([, n]) => n > 0).map(([pid]) => pid);
        let best: PlacedEquip | null = null;
        let bd = Infinity;
        if (count < CAP)
          for (const r of st.equipment) {
            if (!isRack(r) || !r.cartons?.some((c) => need.includes(c.pid))) continue;
            const ap = this.accessPoint(r);
            const d = Math.hypot(ap.x - p.pos.x, ap.z - p.pos.z);
            if (d < bd) {
              bd = d;
              best = r;
            }
          }
        if (!best) {
          phase = 'fill';
          return 'continue';
        }
        const ap = this.accessPoint(best);
        if (bd > 0.6) {
          sub = this.walkTo(ap.x, ap.z);
          return 'continue';
        }
        // charge les cartons utiles de ce rack
        const rack = best;
        let took = false;
        for (let guard = 0; guard < 20; guard++) {
          const n = p.held?.kind === 'cartons' ? p.held.list.length : 0;
          if (n >= CAP) break;
          const miss = missing();
          const i = rack.cartons!.findIndex((c) => (miss.get(c.pid) ?? 0) > 0);
          if (i < 0) break;
          const c = rack.cartons!.splice(i, 1)[0];
          if (p.held?.kind === 'cartons') p.held.list.push(c);
          else p.held = { kind: 'cartons', list: [c] };
          took = true;
        }
        if (took) {
          p.refreshHeld();
          g.equipView.markDirty();
          g.bus.emit('sfx', { name: 'thud', x: p.pos.x, z: p.pos.z });
        } else phase = 'fill';
        return 'continue';
      }
      if (phase === 'fill') {
        if (!target) {
          // facing le plus proche dont on porte le produit
          let bd = Infinity;
          for (const { s, idx } of slots()) {
            if (heldOf(s.pid!) <= 0) continue;
            const info = slotInfo(e, idx);
            const d = Math.hypot(info.access.x - p.pos.x, info.access.z - p.pos.z);
            if (d < bd) {
              bd = d;
              target = { idx, pid: s.pid! };
            }
          }
          if (!target) {
            // plus rien d'utile en main : un autre voyage si la réserve peut encore aider
            const more = [...missing()].some(([pid, n]) => n > 0 && inRacks(pid));
            if (more && rounds++ < 8) {
              if (count >= CAP) {
                phase = 'return';
                sub = this.returnCartons();
                return 'continue';
              }
              phase = 'collect';
              return 'continue';
            }
            phase = 'return';
            sub = this.returnCartons();
            return 'continue';
          }
          const info = slotInfo(e, target.idx);
          if (Math.hypot(info.access.x - p.pos.x, info.access.z - p.pos.z) > 0.3) {
            sub = this.walkTo(info.access.x, info.access.z);
            return 'continue';
          }
          p.yaw = Math.atan2(info.front.x - p.pos.x, info.front.z - p.pos.z);
          acc = 0;
        }
        const h = p.held;
        if (h?.kind !== 'cartons') {
          target = null;
          return 'continue';
        }
        const top = h.list[h.list.length - 1];
        if (top.pid !== target.pid) {
          const j = h.list.findIndex((c) => c.pid === target!.pid);
          if (j < 0) {
            target = null;
            return 'continue';
          }
          h.list.push(h.list.splice(j, 1)[0]);
        }
        acc += dt;
        p.act('reach');
        while (acc >= 0.1) {
          acc -= 0.1;
          if (!p.interaction.fillOne(e, target.idx) || heldOf(target.pid) <= 0) {
            target = null;
            return 'continue';
          }
        }
        return 'continue';
      }
      return 'done';
    };
    this.start(`Remplit « ${EQUIPMENT_BY_ID[e.def].name} »`, [loop]);
  }

  /** Range les cartons tenus dans les racks (ou la chambre froide pour le frais). */
  private returnCartons(): Step {
    const g = this.game;
    const p = g.player;
    let target: PlacedEquip | null = null;
    let walking: Step | null = null;
    return (dt) => {
      const h = p.held;
      if (h?.kind !== 'cartons') return 'done';
      const c = h.list[h.list.length - 1];
      if (!target || rackFree(target) <= 0) {
        const fresh = PRODUCT_BY_ID[c.pid].storage !== 'ambient';
        const racks = g.st.equipment.filter((r) => (r.def === 'rack_reserve' || r.def === 'chambre_froide') && rackFree(r) > 0);
        target = racks.find((r) => (r.def === 'chambre_froide') === fresh) ?? racks[0] ?? null;
        if (!target) {
          p.dropHeld(false);
          this.say('Réserve pleine : cartons posés au sol.', 'bad');
          return 'done';
        }
        const ap = this.accessPoint(target);
        walking = this.walkTo(ap.x, ap.z);
      }
      if (walking) {
        const r = walking(dt);
        if (r === 'continue') return 'continue';
        walking = null;
        if (r === 'fail') return 'fail';
      }
      target.cartons = target.cartons ?? [];
      target.cartons.push(h.list.pop()!);
      if (!h.list.length) p.held = null;
      p.refreshHeld();
      g.equipView.markDirty();
      g.bus.emit('sfx', { name: 'thud', x: p.pos.x, z: p.pos.z });
      return p.held ? 'continue' : 'done';
    };
  }

  /** Vide une palette dans la réserve, puis enchaîne avec les autres palettes du quai (la plus proche d'abord). */
  putAwayPallet(uid: number) {
    const g = this.game;
    const p = g.player;
    if (p.held && p.held.kind !== 'cartons') p.dropHeld(false);
    let cur = uid;
    let sub: Step | null = null;
    let loops = 0;
    const next = (): number | null => {
      let best: number | null = null;
      let bd = Infinity;
      for (const [id, v] of g.items.pallets) {
        if (!v.data.cartons.length) continue;
        const t = v.body.translation();
        const d = Math.hypot(t.x - p.pos.x, t.z - p.pos.z);
        if (d < bd) {
          bd = d;
          best = id;
        }
      }
      return best;
    };
    const full = () => !g.st.equipment.some((r) => (r.def === 'rack_reserve' || r.def === 'chambre_froide') && rackFree(r) > 0);
    const loop: Step = (dt) => {
      if (sub) {
        const r = sub(dt);
        if (r === 'continue') return 'continue';
        sub = null;
        if (r === 'fail') return 'fail';
        return 'continue';
      }
      let pv = g.items.pallets.get(cur);
      if (!pv || !pv.data.cartons.length) {
        const n = next();
        if (n === null || full()) {
          if (p.held?.kind === 'cartons') {
            sub = this.returnCartons();
            return 'continue';
          }
          if (n !== null) this.say('La réserve est pleine : il reste des cartons au quai.', 'bad');
          return 'done';
        }
        cur = n;
        pv = g.items.pallets.get(cur)!;
      }
      if (loops++ > 200) return 'fail';
      if (full() && !p.held) {
        this.say('La réserve est pleine : il reste des cartons au quai.', 'bad');
        return 'done';
      }
      const t = pv.body.translation();
      if (Math.hypot(t.x - p.pos.x, t.z - p.pos.z) > 1.3) {
        sub = this.walkTo(t.x, t.z + (t.z > p.pos.z ? -1 : 1));
        return 'continue';
      }
      // le patron charge son diable : jusqu'à 6 cartons par voyage
      while (pv.data.cartons.length && (!p.held || (p.held.kind === 'cartons' && p.held.list.length < 6))) p.interaction.takeFromPallet(cur);
      sub = this.returnCartons();
      return 'continue';
    };
    this.start('Range la livraison en réserve', [loop]);
  }

  /** Va tenir une caisse. */
  manCheckout(l: Lane) {
    const g = this.game;
    const p = g.player;
    if (l.operator && l.operator !== 'player') {
      this.say('Un employé tient déjà cette caisse.');
      return;
    }
    this.start('Caisse : va prendre son poste', [
      this.walkTo(l.pts.cashier.x, l.pts.cashier.z),
      () => {
        p.interaction.enterCashier(l);
        this.status = 'Tient la caisse';
        return 'done';
      },
    ]);
  }

  /** Range ce que le patron porte. */
  returnHeld() {
    const p = this.game.player;
    if (p.held && p.held.kind !== 'cartons') {
      p.dropHeld(false);
      return;
    }
    this.start('Range les cartons', [this.returnCartons()]);
  }

  /** Rejoint un personnage (qui bouge) puis agit. */
  approach(a: Agent, then: () => void) {
    const p = this.game.player;
    let sub: Step | null = null;
    let tx = 0;
    let tz = 0;
    let tries = 0;
    this.start('Va voir quelqu’un', [
      (dt) => {
        if (a.dead) return 'fail';
        if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 1.5) {
          this.path = null;
          p.drive = null;
          p.yaw = Math.atan2(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
          then();
          return 'done';
        }
        if (!sub || Math.hypot(a.pos.x - tx, a.pos.z - tz) > 1.5) {
          if (tries++ > 40) return 'fail';
          tx = a.pos.x;
          tz = a.pos.z;
          sub = this.walkTo(tx, tz);
        }
        const r = sub(dt);
        if (r === 'fail') return 'fail';
        if (r === 'done') sub = null;
        return 'continue';
      },
    ]);
  }

  /** Nettoie une salissure. */
  clean(uid: number) {
    const g = this.game;
    const m = g.st.messes.find((x) => x.uid === uid);
    if (!m) return;
    let acc = 0;
    this.start('Nettoie', [
      this.walkTo(m.x, m.z + 0.6),
      (dt) => {
        acc += dt;
        g.player.act('mop');
        while (acc > 0.2) {
          acc -= 0.2;
          if (g.items.clean(uid, 0.08)) return 'done';
        }
        return g.st.messes.some((x) => x.uid === uid) ? 'continue' : 'done';
      },
    ]);
  }

  /** Étape construite au dernier moment (dépend de l'état à cet instant) ; null = rien à faire. */
  private lazy(make: () => Step | null): Step {
    let s: Step | null | undefined;
    return (dt) => {
      if (s === undefined) s = make();
      return s ? s(dt) : 'done';
    };
  }

  update(dt: number) {
    const p = this.game.player;
    if (!this.job) {
      p.drive = null;
      return;
    }
    const step = this.job.steps[this.job.i];
    if (!step) {
      this.job = null;
      this.status = '';
      p.drive = null;
      return;
    }
    const r = step(dt);
    if (r === 'done') this.job.i++;
    else if (r === 'fail') {
      this.job = null;
      this.status = '';
      p.drive = null;
    }
    void this.waitT;
    void slotQty;
  }
}
