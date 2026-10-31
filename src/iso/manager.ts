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
    return () => {
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
      }
      return this.follow() ? 'done' : 'continue';
    };
  }

  /** Avance le long du chemin ; vrai quand arrivé. */
  private follow(): boolean {
    const p = this.game.player;
    if (!this.path) return true;
    const t = this.path[this.pathI];
    const dx = t.x - p.pos.x;
    const dz = t.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const last = this.pathI >= this.path.length - 1;
    if (d < (last ? 0.18 : 0.35)) {
      if (last) {
        this.path = null;
        p.drive = null;
        return true;
      }
      this.pathI++;
      return false;
    }
    const sp = (p.held?.kind === 'cartons' ? 2.6 : 3.2) * Math.min(1, d / 0.4 + 0.4);
    p.drive = { x: (dx / d) * sp, z: (dz / d) * sp };
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

  /** Remplit les facings d'un meuble avec les cartons de la réserve. */
  restock(e: PlacedEquip, only?: number) {
    const g = this.game;
    const st = g.st;
    const p = g.player;
    if (p.held && p.held.kind !== 'cartons') p.dropHeld(false);
    const needs = () =>
      (e.slots ?? [])
        .map((s, idx) => ({ s, idx }))
        .filter(({ s, idx }) => s.pid && (only === undefined || only === idx) && freeSpace(e, idx) > 0);
    const pids = [...new Set(needs().map((n) => n.s.pid!))];
    if (!pids.length) {
      this.say('Ce meuble est déjà plein (ou n’a pas de produits assignés).');
      return;
    }
    const steps: Step[] = [];
    const findRack = (pid: string) => st.equipment.find((r) => (r.def === 'rack_reserve' || r.def === 'chambre_froide') && r.cartons?.some((c) => c.pid === pid));
    const available = pids.filter((pid) => findRack(pid) || (p.held?.kind === 'cartons' && p.held.list.some((c) => c.pid === pid)));
    if (!available.length) {
      this.say(`Réserve vide pour ce rayon (${pids.map((x) => PRODUCT_BY_ID[x].name).slice(0, 2).join(', ')}…). Commandez au grossiste !`, 'bad');
      return;
    }
    for (const pid of available) {
      let rack: PlacedEquip | undefined;
      steps.push(() => {
        if (p.held?.kind === 'cartons' && p.held.list.some((c) => c.pid === pid)) return 'done';
        rack = findRack(pid);
        return rack ? 'done' : 'fail';
      });
      steps.push(this.lazy(() => (p.held?.kind === 'cartons' && p.held.list.some((c) => c.pid === pid) ? null : rack ? this.walkTo(this.accessPoint(rack).x, this.accessPoint(rack).z) : null)));
      steps.push(() => {
        if (p.held?.kind === 'cartons' && p.held.list.some((c) => c.pid === pid)) return 'done';
        if (!rack) return 'fail';
        // jusqu'à 3 cartons du même produit
        for (let k = 0; k < 3; k++) {
          const i = rack.cartons?.findIndex((c) => c.pid === pid) ?? -1;
          if (i < 0) break;
          p.interaction.takeFromRack(rack, i);
        }
        return 'done';
      });
      // remplit chaque facing de ce produit
      for (const { idx } of needs().filter((n) => n.s.pid === pid)) {
        const info = slotInfo(e, idx);
        steps.push(this.lazy(() => (p.held?.kind === 'cartons' && p.held.list.some((c) => c.pid === pid) ? this.walkTo(info.access.x, info.access.z) : null)));
        steps.push(this.face(info.front.x, info.front.z));
        let acc = 0;
        steps.push((dt) => {
          const h = p.held;
          if (h?.kind !== 'cartons') return 'done';
          // le carton du dessus doit être le bon produit
          const top = h.list[h.list.length - 1];
          if (top.pid !== pid) {
            const j = h.list.findIndex((c) => c.pid === pid);
            if (j < 0) return 'done';
            h.list.push(h.list.splice(j, 1)[0]);
          }
          acc += dt;
          p.act('reach');
          while (acc >= 0.14) {
            acc -= 0.14;
            if (!p.interaction.fillOne(e, idx)) return 'done';
            if (p.held?.kind !== 'cartons' || !p.held.list.some((c) => c.pid === pid)) return 'done';
          }
          return 'continue';
        });
      }
    }
    // cartons restants : retour en réserve
    steps.push(this.lazy(() => (p.held?.kind === 'cartons' ? this.returnCartons() : null)));
    this.start(`Remplit « ${EQUIPMENT_BY_ID[e.def].name} »`, steps);
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

  /** Vide une palette dans la réserve. */
  putAwayPallet(uid: number) {
    const g = this.game;
    const p = g.player;
    if (p.held && p.held.kind !== 'cartons') p.dropHeld(false);
    const steps: Step[] = [];
    let loops = 0;
    const loop: Step = (dt) => {
      const pv = g.items.pallets.get(uid);
      if (!pv || !pv.data.cartons.length) {
        if (p.held?.kind === 'cartons') {
          sub = sub ?? this.returnCartons();
          const r = sub(dt);
          if (r === 'continue') return 'continue';
        }
        return 'done';
      }
      if (sub) {
        const r = sub(dt);
        if (r === 'continue') return 'continue';
        sub = null;
        return 'continue';
      }
      if (loops++ > 60) return 'fail';
      const t = pv.body.translation();
      if (Math.hypot(t.x - p.pos.x, t.z - p.pos.z) > 1.3) {
        sub = this.walkTo(t.x, t.z + (t.z > p.pos.z ? -1 : 1));
        return 'continue';
      }
      while (pv.data.cartons.length && (!p.held || (p.held.kind === 'cartons' && p.held.list.length < 3))) p.interaction.takeFromPallet(uid);
      sub = this.returnCartons();
      return 'continue';
    };
    let sub: Step | null = null;
    steps.push(loop);
    this.start('Range la livraison en réserve', steps);
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
