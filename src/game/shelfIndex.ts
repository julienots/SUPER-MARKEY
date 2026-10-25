/** Index des facings par catégorie/produit et des présentoirs promo (requêtes rapides pour les clients). */
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID, type CategoryId } from '../data/products';
import { slotInfo } from '../sim/layout';
import { promosFor } from '../sim/pricing';
import { slotQty } from '../sim/inventory';
import type { PlacedEquip } from '../sim/state';
import type { Game } from './game';

export interface SlotRef {
  e: PlacedEquip;
  idx: number;
}

export class ShelfIndex {
  private byCat = new Map<CategoryId, SlotRef[]>();
  private byPid = new Map<string, SlotRef[]>();
  private promo: { ref: SlotRef; x: number; z: number }[] = [];
  private sig = '';
  private t = 0;

  constructor(private game: Game) {}

  invalidate() {
    this.sig = '';
  }

  private signature(): string {
    let s = `${this.game.st.equipment.length}:${this.game.st.promos.length}:`;
    for (const e of this.game.st.equipment) if (e.slots) s += e.uid + ',' + e.gx + ',' + e.gz + ',' + e.rot + ':' + e.slots.map((x) => x.pid ?? '').join('|') + ';';
    return s;
  }

  rebuild() {
    this.byCat.clear();
    this.byPid.clear();
    this.promo = [];
    const st = this.game.st;
    for (const e of st.equipment) {
      if (!e.slots || EQUIPMENT_BY_ID[e.def].zone === 'backroom') continue;
      e.slots.forEach((s, idx) => {
        if (!s.pid) return;
        const ref = { e, idx };
        const cat = PRODUCT_BY_ID[s.pid].category;
        if (!this.byCat.has(cat)) this.byCat.set(cat, []);
        this.byCat.get(cat)!.push(ref);
        if (!this.byPid.has(s.pid)) this.byPid.set(s.pid, []);
        this.byPid.get(s.pid)!.push(ref);
        if (promosFor(st, s.pid).length || EQUIPMENT_BY_ID[e.def].shelf?.pile) {
          const inf = slotInfo(e, idx);
          this.promo.push({ ref, x: inf.access.x, z: inf.access.z });
        }
      });
    }
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0 && this.sig) return;
    this.t = 1;
    const s = this.signature();
    if (s !== this.sig) {
      this.sig = s;
      this.rebuild();
    }
  }

  slotsForCategory(cat: CategoryId, pid: string | null): SlotRef[] {
    if (!this.sig) this.update(0);
    if (pid) {
      const p = this.byPid.get(pid);
      if (p?.length) return p;
    }
    return this.byCat.get(cat) ?? [];
  }

  promoSlotsNear(x: number, z: number, r: number): SlotRef[] {
    const out: SlotRef[] = [];
    for (const p of this.promo) if (Math.hypot(p.x - x, p.z - z) < r && slotQty(p.ref.e.slots![p.ref.idx]) > 0) out.push(p.ref);
    return out;
  }
}
