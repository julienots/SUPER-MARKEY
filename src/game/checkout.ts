/**
 * Caisses : files d'attente réelles, scan article par article (caissier, joueur ou client en caisse auto),
 * erreurs de scan, assistance, paiement et ticket exact (promotions + fidélité).
 */
import * as THREE from 'three';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { checkoutPoints, type CheckoutPoints } from '../sim/layout';
import { computeTicket, type Ticket } from '../sim/pricing';
import { recordSale } from '../sim/economy';
import { efficiency } from '../sim/staff';
import type { PlacedEquip } from '../sim/state';
import { productMesh } from '../world/productMeshes';
import type { Game } from './game';
import type { Customer, BasketItem } from '../entities/customer';
import type { EmployeeAgent } from '../entities/employee';

export interface Lane {
  uid: number;
  e: PlacedEquip;
  pts: CheckoutPoints;
  auto: boolean;
  queue: Customer[];
  operator: 'player' | EmployeeAgent | null;
  scan: {
    customer: Customer;
    items: BasketItem[];
    scanned: number;
    t: number;
    phase: 'scan' | 'pay';
    errorT: number;
    needAssist: boolean;
    skipped: number;
  } | null;
  belt: THREE.Object3D[];
  served: number;
}

export class CheckoutManager {
  lanes = new Map<number, Lane>();

  constructor(private game: Game) {}

  sync() {
    const st = this.game.st;
    const seen = new Set<number>();
    for (const e of st.equipment) {
      if (e.def !== 'caisse' && e.def !== 'caisse_auto') continue;
      seen.add(e.uid);
      const lane = this.lanes.get(e.uid);
      const pts = checkoutPoints(e);
      if (lane) {
        lane.e = e;
        lane.pts = pts;
      } else this.lanes.set(e.uid, { uid: e.uid, e, pts, auto: e.def === 'caisse_auto', queue: [], operator: null, scan: null, belt: [], served: 0 });
    }
    for (const [uid, lane] of this.lanes) {
      if (seen.has(uid)) continue;
      for (const c of lane.queue) c.laneClosed();
      this.clearBelt(lane);
      this.lanes.delete(uid);
    }
  }

  isOpen(l: Lane): boolean {
    if (l.e.broken || l.e.open === false) return false;
    if (this.game.powerOut && !this.game.st.store.upgrades['groupe_electrogene'] && l.auto) return false;
    return l.auto || l.operator !== null;
  }

  /** Une caisse « ouverte » mais sans opérateur : les clients y font la queue en espérant. */
  staffable(l: Lane) {
    return !l.e.broken && l.e.open !== false;
  }

  chooseLane(c: Customer): Lane | null {
    let best: Lane | null = null;
    let bestScore = Infinity;
    for (const l of this.lanes.values()) {
      if (!this.isOpen(l)) continue;
      if (l.queue.length >= l.pts.queue.length + 1) continue;
      const items = l.queue.reduce((a, q) => a + q.basket.length, 0) + (l.scan ? l.scan.items.length - l.scan.scanned : 0);
      const d = c.distTo(l.pts.pay.x, l.pts.pay.z);
      const score = items * (l.auto ? 3.2 : 2.2) + l.queue.length * 8 + d * 0.5 + (l.auto && c.basket.length > 12 ? 30 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = l;
      }
    }
    return best;
  }

  join(l: Lane, c: Customer) {
    if (!l.queue.includes(c)) l.queue.push(c);
  }

  leave(c: Customer) {
    for (const l of this.lanes.values()) {
      const i = l.queue.indexOf(c);
      if (i >= 0) l.queue.splice(i, 1);
      if (l.scan?.customer === c) {
        this.clearBelt(l);
        l.scan = null;
      }
    }
  }

  /** Point où le client doit se tenir : 0 = caisse, 1.. = file. */
  spotFor(l: Lane, c: Customer): { x: number; z: number; atRegister: boolean } {
    const i = l.queue.indexOf(c);
    if (i <= 0) return { ...l.pts.pay, atRegister: true };
    const q = l.pts.queue[Math.min(i - 1, l.pts.queue.length - 1)];
    return { x: q.x, z: q.z, atRegister: false };
  }

  laneOf(c: Customer): Lane | null {
    for (const l of this.lanes.values()) if (l.queue.includes(c)) return l;
    return null;
  }

  private clearBelt(l: Lane) {
    for (const m of l.belt) this.game.scene.remove(m);
    l.belt = [];
  }

  private layBelt(l: Lane, items: BasketItem[]) {
    this.clearBelt(l);
    if (this.game.headless) return;
    items.slice(0, l.pts.belt.length).forEach((it, i) => {
      const m = productMesh(it.pid);
      const p = l.pts.belt[i];
      const pd = PRODUCT_BY_ID[it.pid];
      m.position.set(p.x, p.y + pd.size[1] / 2, p.z);
      m.rotation.y = Math.random() * 0.4;
      this.game.scene.add(m);
      l.belt.push(m);
    });
  }

  /** Temps de scan d'un article (secondes de jeu réelles). */
  private scanTime(l: Lane): number {
    const tpe = this.game.st.store.upgrades['tpe'] ? 0.85 : 1;
    if (l.auto) return 2.0;
    if (l.operator === 'player') return 999; // le joueur scanne à la main
    if (l.operator) return (1.4 / efficiency(l.operator.emp)) * tpe;
    return 999;
  }

  /** Le joueur scanne l'article suivant (touche E en mode caisse). */
  playerScan(l: Lane): string | null {
    const s = l.scan;
    if (!s || s.phase !== 'scan') return null;
    if (s.errorT > 0) return 'Le code-barres ne passe pas… réessayez !';
    if (Math.random() < 0.04) {
      s.errorT = 0.6;
      this.game.bus.emit('sfx', { name: 'error', x: l.pts.cashier.x, z: l.pts.cashier.z });
      return '« BIP-BOUP » : erreur de lecture. Re-scannez.';
    }
    this.scanOne(l);
    this.game.st.stats.playerScans++;
    return null;
  }

  private scanOne(l: Lane) {
    const s = l.scan!;
    s.scanned++;
    const m = l.belt.shift();
    if (m) this.game.scene.remove(m);
    this.game.bus.emit('sfx', { name: 'beep', x: l.pts.pay.x, z: l.pts.pay.z });
    if (s.scanned >= s.items.length) {
      s.phase = 'pay';
      s.t = this.game.st.store.upgrades['tpe'] ? 1.8 : 3.2;
      s.customer.play('pay');
    } else if (l.belt.length < l.pts.belt.length && s.items.length > s.scanned + l.belt.length) {
      // complète le tapis
      const next = s.items[s.scanned + l.belt.length];
      if (!this.game.headless && next) {
        const mm = productMesh(next.pid);
        const p = l.pts.belt[l.pts.belt.length - 1];
        mm.position.set(p.x, p.y + PRODUCT_BY_ID[next.pid].size[1] / 2, p.z);
        this.game.scene.add(mm);
        l.belt.push(mm);
      }
    }
  }

  /** Assistance sur caisse automatique (par le joueur ou un employé). */
  assist(l: Lane): boolean {
    if (!l.scan?.needAssist) return false;
    l.scan.needAssist = false;
    l.scan.errorT = 0;
    this.game.bus.emit('sfx', { name: 'beep', x: l.pts.pay.x, z: l.pts.pay.z });
    return true;
  }

  update(dt: number) {
    const st = this.game.st;
    for (const l of this.lanes.values()) {
      // opérateur parti ?
      if (l.operator && l.operator !== 'player' && l.operator.dead) l.operator = null;
      const front = l.queue[0];
      if (!l.scan && front && front.readyToPay && this.isOpen(l)) {
        const items = front.basket.filter((b) => !b.concealed);
        if (!items.length) {
          // finishPurchase → goLeave retire lui-même le client de la file
          front.finishPurchase(null);
          continue;
        }
        l.scan = { customer: front, items, scanned: 0, t: this.scanTime(l), phase: 'scan', errorT: 0, needAssist: false, skipped: 0 };
        this.layBelt(l, items);
      }
      const s = l.scan;
      if (!s) continue;
      if (s.customer.dead || !l.queue.includes(s.customer)) {
        this.clearBelt(l);
        l.scan = null;
        continue;
      }
      if (!this.isOpen(l) && !s.needAssist) continue;
      s.errorT = Math.max(0, s.errorT - dt);
      if (s.phase === 'scan') {
        if (l.operator === 'player') continue;
        if (s.needAssist) continue;
        s.t -= dt;
        if (s.t <= 0) {
          // erreurs de scan (caissier peu expérimenté) et « article inattendu » en caisse auto
          if (l.auto && Math.random() < 0.025) {
            s.needAssist = true;
            s.customer.say('🤖', '« Article inattendu dans la zone d’ensachage. »', 4);
            this.game.bus.emit('sfx', { name: 'error', x: l.pts.pay.x, z: l.pts.pay.z });
            continue;
          }
          if (l.operator && Math.random() < 0.06 * (1 - l.operator.emp.skill)) {
            s.t = 1.2;
            continue;
          }
          // un client malhonnête « oublie » de scanner en caisse auto
          if (l.auto && s.customer.isThief && Math.random() < 0.35) {
            const it = s.items[s.scanned];
            it.concealed = true;
            s.skipped++;
          }
          this.scanOne(l);
          s.t = this.scanTime(l);
          if (l.operator) l.operator.play('scan');
        }
      } else {
        s.t -= dt;
        if (s.t <= 0) {
          const paid = s.items.filter((i) => !i.concealed);
          const member = !!s.customer.resident?.memory.loyaltyMember;
          const ticket = computeTicket(st, paid, member);
          recordSale(st, ticket.total, ticket.cost, paid.length);
          l.e.till = (l.e.till ?? 0) + ticket.total;
          for (const it of paid) st.todaySales[it.pid] = (st.todaySales[it.pid] ?? 0) + 1;
          l.served++;
          this.game.bus.emit('sale', { amount: ticket.total, x: l.pts.pay.x, z: l.pts.pay.z, lane: l.uid, player: l.operator === 'player' });
          this.game.bus.emit('sfx', { name: 'till', x: l.pts.pay.x, z: l.pts.pay.z });
          this.clearBelt(l);
          l.scan = null;
          s.customer.finishPurchase(ticket as Ticket);
          const i = l.queue.indexOf(s.customer);
          if (i >= 0) l.queue.splice(i, 1);
        }
      }
    }
  }

  /** Pression sur les caisses (pour l'humeur du personnel et la réputation d'attente). */
  pressure(): number {
    let q = 0;
    let open = 0;
    for (const l of this.lanes.values()) {
      if (this.isOpen(l)) open++;
      q += l.queue.length;
    }
    return open ? q / open / 4 : q > 0 ? 1 : 0;
  }

  laneAt(x: number, z: number, r = 1.4): Lane | null {
    for (const l of this.lanes.values()) if (Math.hypot(l.pts.cashier.x - x, l.pts.cashier.z - z) < r) return l;
    return null;
  }

  laneByUid(uid: number) {
    return this.lanes.get(uid) ?? null;
  }

  operatorNeeded(): Lane | null {
    for (const l of this.lanes.values()) if (!l.auto && !l.operator && this.staffable(l)) return l;
    return null;
  }

  isCheckoutDef(id: string) {
    return EQUIPMENT_BY_ID[id]?.category === 'caisse';
  }
}
