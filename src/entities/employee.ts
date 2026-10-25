/**
 * Employés incarnés : ils arrivent pour leur service, se changent, travaillent physiquement
 * (cartons portés, rayons remplis un article à la fois, serpillière, caisse, ronde), prennent des pauses et repartent.
 */
import * as THREE from 'three';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { ROLE_BY_ID } from '../data/roles';
import { BARKS } from '../data/lines';
import { Rng } from '../core/rng';
import { clamp01 } from '../core/math';
import { slotInfo, storeRect, equipCenter, localToWorld } from '../sim/layout';
import { addToSlot, freeSpace, rackFree, removeExpired, storeCarton, slotsForProduct, slotQty } from '../sim/inventory';
import { accrueWages, efficiency, moodTick, onShift, restTick } from '../sim/staff';
import { dayOf, type Carton, type Employee, type PlacedEquip } from '../sim/state';
import { randomAppearance } from './character';
import { Agent } from './agent';
import { cartonObject } from './items';
import { ROLE_TASKS, type Task } from '../game/tasks';
import { MIN_PER_SEC, type Game } from '../game/game';
import type { Customer } from './customer';

type EState = 'arriving' | 'changing' | 'idle' | 'task' | 'cashier' | 'patrol' | 'monitor' | 'break' | 'leaving' | 'chase';

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class EmployeeAgent extends Agent {
  readonly kind = 'employee' as const;
  state: EState = 'arriving';
  task: Task | null = null;
  private step = 0;
  private t = 0;
  carton: Carton | null = null;
  private laneUid: number | null = null;
  chaseTarget: Customer | null = null;
  vigilance = 0.6;
  private praiseT = 20 + Math.random() * 30;
  private barkT = 30 + Math.random() * 60;

  constructor(game: Game, public emp: Employee, x: number, z: number) {
    super(game, game.headless ? null : randomAppearance(new Rng(emp.seed), { female: emp.female, age: 20 + (emp.seed % 35), uniform: game.st.store.uniform, role: emp.role }), x, z);
    this.name = emp.name;
    this.navOpts = { staff: true, keys: true };
    this.walkSpeed = 1.35 * emp.speed;
    this.vigilance = clamp01(0.4 + emp.skill * 0.4 + (emp.traits.includes('oeil') ? 0.25 : 0));
  }

  get eff() {
    return efficiency(this.emp);
  }

  private backroomPoint() {
    const r = storeRect(this.game.st.store.stage);
    return { x: r.staffDoorX + 1.5, z: r.backZ + 1.5 };
  }

  update(dt: number) {
    this.t += dt;
    const st = this.game.st;
    if (this.state !== 'leaving' && !onShift(st, this.emp)) {
      this.endShift();
      return;
    }
    // pause si épuisé
    const midScan = this.state === 'cashier' && this.laneUid !== null && !!this.game.checkouts.laneByUid(this.laneUid)?.scan;
    if (this.state !== 'break' && this.state !== 'leaving' && this.state !== 'chase' && this.emp.fatigue > 0.82 && !this.carton && !midScan) {
      this.goBreak();
    }
    this.barkT -= dt;
    if (this.barkT <= 0) {
      this.barkT = 60 + Math.random() * 90;
      if (this.emp.fatigue > 0.7) this.say('😮‍💨', pick(BARKS.employeeTired), 2.5);
      else if (this.emp.traits.includes('zele') && Math.random() < 0.5) this.say('🫡', pick(BARKS.employeeZeal), 2.5);
    }
    switch (this.state) {
      case 'arriving': {
        if (!this.path) {
          const b = this.backroomPoint();
          this.setGoal(b.x, b.z);
        }
        if (this.moveAlong(dt) !== 'moving') {
          this.state = 'changing';
          this.t = 0;
        }
        return;
      }
      case 'changing':
        if (this.t > 2) this.state = 'idle';
        return;
      case 'idle':
        return this.chooseWork();
      case 'task':
        return this.doTask(dt);
      case 'cashier':
        return this.doCashier(dt);
      case 'patrol':
        return this.doPatrol(dt);
      case 'monitor':
        return this.doMonitor(dt);
      case 'break':
        return this.doBreak(dt);
      case 'chase':
        return this.doChase(dt);
      case 'leaving':
        if (this.moveAlong(dt) !== 'moving') this.dead = true;
        return;
    }
  }

  private endShift() {
    this.dropWork();
    this.state = 'leaving';
    const r = storeRect(this.game.st.store.stage);
    this.setGoal(r.dockDoorX, r.z1 + 6);
  }

  dropWork() {
    if (this.task) this.game.tasks.release(this.task.id);
    this.task = null;
    if (this.carton) {
      const c = this.carton;
      this.carton = null;
      this.attachCarry(null);
      if (!storeCarton(this.game.st, c)) this.game.items.spawnCarton(c, { x: this.pos.x, y: 0.4, z: this.pos.z });
      this.game.equipView.markDirty();
    }
    if (this.laneUid !== null) {
      const l = this.game.checkouts.laneByUid(this.laneUid);
      if (l && l.operator === this) l.operator = null;
      this.laneUid = null;
    }
    this.anim?.stop();
  }

  private goBreak() {
    this.dropWork();
    const room = this.game.st.equipment.find((e) => e.def === 'salle_pause');
    const p = room ? localToWorld(room, 0.4, 0, 1.0) : this.backroomPoint();
    this.setGoal(p.x, p.z);
    this.state = 'break';
    this.t = 0;
    this.say('☕', 'Pause !', 2);
  }

  private doBreak(dt: number) {
    if (this.moveAlong(dt) === 'moving') return;
    const inRoom = this.game.st.equipment.some((e) => e.def === 'salle_pause');
    this.anim?.play(inRoom ? 'sit' : 'idle');
    restTick(this.emp, dt * MIN_PER_SEC, inRoom);
    if (this.emp.fatigue < 0.15) {
      this.anim?.stop();
      this.state = 'idle';
    }
  }

  private chooseWork() {
    const e = this.emp;
    const g = this.game;
    switch (e.role) {
      case 'caissier': {
        const lane = (e.zone && g.checkouts.laneByUid(Number(e.zone))) || g.checkouts.operatorNeeded();
        if (lane && (!lane.operator || lane.operator === this)) {
          lane.operator = this;
          this.laneUid = lane.uid;
          this.setGoal(lane.pts.cashier.x, lane.pts.cashier.z);
          this.state = 'cashier';
          return;
        }
        if (this.tryTask(['assist', 'pickup'])) return;
        return this.startPatrol();
      }
      case 'securite': {
        const desk = g.st.equipment.find((x) => x.def === 'ecran_secu');
        if ((e.zone === 'monitor' || (!e.zone && desk && !g.staff.agents.some((a) => a !== this && a.state === 'monitor'))) && desk) {
          const p = localToWorld(desk, 0, 0, 0.55);
          this.setGoal(p.x, p.z);
          this.state = 'monitor';
          return;
        }
        return this.startPatrol();
      }
      case 'manager': {
        if (this.tryTask(ROLE_TASKS.manager)) return;
        if (g.checkouts.pressure() > 1.2) {
          const lane = g.checkouts.operatorNeeded();
          if (lane) {
            lane.operator = this;
            this.laneUid = lane.uid;
            this.setGoal(lane.pts.cashier.x, lane.pts.cashier.z);
            this.state = 'cashier';
            this.say('💪', 'J’ouvre une caisse en renfort !', 2.5);
            return;
          }
        }
        return this.startPatrol();
      }
      default: {
        const kinds = ROLE_TASKS[e.role] ?? [];
        if (this.tryTask(kinds)) return;
        return this.startPatrol();
      }
    }
  }

  private tryTask(kinds: any[]): boolean {
    const t = this.game.tasks.claim(this.emp.id, kinds, this.pos.x, this.pos.z, this.emp.priority);
    if (!t) return false;
    this.task = t;
    this.step = 0;
    this.t = 0;
    this.state = 'task';
    return true;
  }

  private finishTask() {
    if (this.task) this.game.tasks.done(this.task.id);
    this.task = null;
    this.anim?.stop();
    this.state = 'idle';
  }

  private abortTask() {
    if (this.task) this.game.tasks.release(this.task.id);
    this.task = null;
    this.anim?.stop();
    if (this.carton) this.dropWork();
    this.state = 'idle';
  }

  private eq(uid: number): PlacedEquip | undefined {
    return this.game.st.equipment.find((e) => e.uid === uid);
  }

  /** Trouve un rack contenant le produit, ou ayant de la place. */
  private rackWith(pid: string): PlacedEquip | null {
    let best: PlacedEquip | null = null;
    let bd = Infinity;
    for (const e of this.game.st.equipment) {
      if (!e.cartons?.some((c) => c.pid === pid)) continue;
      const c = equipCenter(e);
      const d = this.distTo(c.x, c.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private rackAccess(e: PlacedEquip) {
    const def = EQUIPMENT_BY_ID[e.def];
    return localToWorld(e, 0, 0, (def.d * 0.5) / 2 + 0.5);
  }

  private doTask(dt: number) {
    const t = this.task!;
    const g = this.game;
    const st = g.st;
    const work = dt * this.eff;
    switch (t.kind) {
      case 'restock': {
        const e = this.eq(t.data.uid);
        if (!e || e.slots![t.data.idx].pid !== t.data.pid) return this.abortTask();
        if (this.step === 0) {
          const rack = this.rackWith(t.data.pid);
          if (!rack) return this.abortTask();
          const a = this.rackAccess(rack);
          this.setGoal(a.x, a.z);
          this.step = 1;
          this.t = 0;
        } else if (this.step === 1) {
          if (this.moveAlong(dt) === 'moving') return;
          const rack = this.rackWith(t.data.pid);
          if (!rack) return this.abortTask();
          const i = rack.cartons!.findIndex((c) => c.pid === t.data.pid);
          this.carton = rack.cartons!.splice(i, 1)[0];
          this.carton.opened = true;
          g.equipView.markDirty();
          if (!g.headless) this.attachCarry(cartonObject(this.carton.pid, true));
          const inf = slotInfo(e, t.data.idx);
          this.setGoal(inf.access.x, inf.access.z);
          this.step = 2;
        } else if (this.step === 2) {
          if (this.moveAlong(dt) === 'moving') return;
          this.step = 3;
          this.t = 0;
          this.anim?.play('reach', { height: slotInfo(e, t.data.idx).front.y });
        } else if (this.step === 3) {
          const inf = slotInfo(e, t.data.idx);
          this.faceTowards(inf.front.x, inf.front.z, dt);
          this.t += work;
          if (this.t < 0.55) return;
          this.t = 0;
          const c = this.carton!;
          if (c.q > 0 && freeSpace(e, t.data.idx) > 0) {
            // maladresse : un article tombe pendant le remplissage
            const clumsy = this.emp.traits.includes('maladroit') ? 0.03 : 0.006 * (1 - this.emp.skill);
            if (Math.random() < clumsy) {
              c.q--;
              const p = g.equipView.slotWorld(e, t.data.idx);
              g.items.spawnLoose(c.pid, c.exp, { x: p.x + inf.normal.x * 0.3, y: p.y + 0.1, z: p.z + inf.normal.z * 0.3 }, { x: inf.normal.x * 1.2, y: 0.5, z: inf.normal.z * 1.2 });
              this.say('😬', pick(BARKS.bump), 1.5);
            } else {
              const n = addToSlot(e, t.data.idx, c.pid, 1, c.exp);
              c.q -= n;
              g.equipView.markDirty();
            }
            return;
          }
          // carton vide ou facing plein
          if (c.q <= 0) {
            this.carton = null;
            this.attachCarry(null);
            this.emp.experience += 0.05;
            return this.finishTask();
          }
          // autre facing du même produit à compléter ?
          const other = slotsForProduct(st, c.pid).find((s) => (s.e !== e || s.idx !== t.data.idx) && freeSpace(s.e, s.idx) > 0 && slotQty(s.e.slots![s.idx]) < 0.7 * g.equipView.capacityOf(s.e, s.idx, c.pid));
          if (other) {
            g.tasks.done(t.id);
            this.task = { ...t, id: `restock:${other.e.uid}:${other.idx}`, data: { uid: other.e.uid, idx: other.idx, pid: c.pid } };
            const inf2 = slotInfo(other.e, other.idx);
            this.setGoal(inf2.access.x, inf2.access.z);
            this.step = 2;
            return;
          }
          // retour du carton entamé en réserve
          const rack = st.equipment.find((r) => r.cartons && rackFree(r) > 0 && (PRODUCT_BY_ID[c.pid].storage === 'ambient' || r.def === 'chambre_froide'));
          if (rack) {
            const a = this.rackAccess(rack);
            this.setGoal(a.x, a.z);
            this.step = 4;
          } else {
            g.items.spawnCarton(c, { x: this.pos.x, y: 0.4, z: this.pos.z });
            this.carton = null;
            this.attachCarry(null);
            this.finishTask();
          }
        } else if (this.step === 4) {
          if (this.moveAlong(dt) === 'moving') return;
          const c = this.carton!;
          this.carton = null;
          this.attachCarry(null);
          if (!storeCarton(st, c)) g.items.spawnCarton(c, { x: this.pos.x, y: 0.4, z: this.pos.z });
          g.equipView.markDirty();
          this.finishTask();
        }
        return;
      }
      case 'putaway': {
        if (this.step === 0) {
          this.setGoal(t.x, t.z);
          this.step = 1;
        } else if (this.step === 1) {
          if (this.moveAlong(dt) === 'moving') return;
          let c: Carton | null = null;
          if (t.data.pallet) c = g.items.takeFromPallet(t.data.pallet);
          else if (t.data.carton) c = g.items.removeCarton(t.data.carton);
          if (!c) return this.finishTask();
          this.carton = c;
          if (!g.headless) this.attachCarry(cartonObject(c.pid, c.opened));
          const needCold = PRODUCT_BY_ID[c.pid].storage !== 'ambient';
          const rack = st.equipment.filter((r) => r.cartons && rackFree(r) > 0 && (!needCold || r.def === 'chambre_froide')).sort((a, b) => {
            const ca = equipCenter(a);
            const cb = equipCenter(b);
            return this.distTo(ca.x, ca.z) - this.distTo(cb.x, cb.z);
          })[0];
          if (!rack) {
            g.items.spawnCarton(c, { x: this.pos.x + 0.5, y: 0.4, z: this.pos.z });
            this.carton = null;
            this.attachCarry(null);
            g.bus.emit('notify', { text: needCold ? '🧊 Plus de place en chambre froide pour ranger le frais !' : '📦 Réserve pleine : achetez des racks.', kind: 'bad', key: 'fullracks' });
            return this.finishTask();
          }
          const a = this.rackAccess(rack);
          this.setGoal(a.x, a.z);
          this.step = 2;
          this.t = 0;
        } else if (this.step === 2) {
          if (this.moveAlong(dt) === 'moving') return;
          this.t += work;
          if (this.t < 0.8) return;
          const c = this.carton!;
          this.carton = null;
          this.attachCarry(null);
          if (!storeCarton(st, c)) g.items.spawnCarton(c, { x: this.pos.x, y: 0.4, z: this.pos.z });
          g.equipView.markDirty();
          // continue avec la même palette si elle n'est pas vide
          if (t.data.pallet && st.pallets.some((p) => p.uid === t.data.pallet && p.cartons.length)) {
            const pos = g.items.palletPos(t.data.pallet)!;
            this.setGoal(pos.x, pos.z);
            this.step = 1;
            return;
          }
          this.finishTask();
        }
        return;
      }
      case 'pickup': {
        if (this.step === 0) {
          const pos = g.items.loosePos(t.data.uid);
          if (!pos) return this.finishTask();
          this.setGoal(pos.x, pos.z);
          this.step = 1;
          this.t = 0;
        } else if (this.step === 1) {
          if (this.moveAlong(dt) === 'moving') return;
          this.anim?.play('crouch');
          this.t += work;
          if (this.t < 0.8) return;
          const it = g.items.removeLoose(t.data.uid);
          this.anim?.stop();
          if (!it) return this.finishTask();
          const slot = slotsForProduct(st, it.pid).find((s) => freeSpace(s.e, s.idx) > 0);
          if (slot) {
            this.task = { ...t, data: { ...t.data, put: { uid: slot.e.uid, idx: slot.idx }, item: it } };
            const inf = slotInfo(slot.e, slot.idx);
            this.setGoal(inf.access.x, inf.access.z);
            this.step = 2;
          } else {
            storeCarton(st, { uid: it.uid, pid: it.pid, q: 1, exp: it.exp, opened: true });
            g.equipView.markDirty();
            this.finishTask();
          }
        } else if (this.step === 2) {
          if (this.moveAlong(dt) === 'moving') return;
          const { put, item } = this.task!.data;
          const e = this.eq(put.uid);
          if (!e || addToSlot(e, put.idx, item.pid, 1, item.exp) === 0) storeCarton(st, { uid: item.uid, pid: item.pid, q: 1, exp: item.exp, opened: true });
          this.anim?.play('reach');
          g.equipView.markDirty();
          this.finishTask();
        }
        return;
      }
      case 'clean': {
        if (this.step === 0) {
          this.setGoal(t.x + 0.4, t.z + 0.4);
          this.step = 1;
        } else {
          if (this.moveAlong(dt) === 'moving') return;
          this.anim?.play('mop');
          this.faceTowards(t.x, t.z, dt);
          if (g.items.clean(t.data.uid, work * 0.12)) this.finishTask();
        }
        return;
      }
      case 'expired': {
        const e = this.eq(t.data.uid);
        if (!e) return this.abortTask();
        if (this.step === 0) {
          this.setGoal(t.x, t.z);
          this.step = 1;
          this.t = 0;
        } else {
          if (this.moveAlong(dt) === 'moving') return;
          this.anim?.play('reach');
          this.t += work;
          if (this.t < 1.5) return;
          const s = e.slots![t.data.idx];
          const pid = s.pid;
          const n = removeExpired(s, dayOf(st.time));
          if (n && pid) g.recordLoss(n * PRODUCT_BY_ID[pid].cost, 'périmés');
          g.equipView.markDirty();
          this.finishTask();
        }
        return;
      }
      case 'assist': {
        const lane = g.checkouts.laneByUid(t.data.lane);
        if (!lane) return this.finishTask();
        if (this.step === 0) {
          this.setGoal(lane.pts.pay.x + 0.7, lane.pts.pay.z);
          this.step = 1;
        } else {
          if (this.moveAlong(dt) === 'moving') return;
          this.anim?.play('point');
          this.t += dt;
          if (this.t > 1.5) {
            g.checkouts.assist(lane);
            this.finishTask();
          }
        }
        return;
      }
      case 'calm': {
        const c = g.agents.list.find((a) => a.id === t.data.agent) as Customer | undefined;
        if (!c || c.dead) return this.finishTask();
        if (this.step === 0 || (this.step === 1 && this.t > 1)) {
          this.setGoal(c.pos.x + 0.8, c.pos.z);
          this.step = 1;
          this.t = 0;
        }
        if (this.step === 1) {
          this.t += dt;
          if (this.moveAlong(dt) !== 'moving' && this.distTo(c.pos.x, c.pos.z) < 1.6) {
            this.step = 2;
            this.t = 0;
          }
        } else if (this.step === 2) {
          this.faceTowards(c.pos.x, c.pos.z, dt);
          this.anim?.play('talk');
          this.t += dt;
          const calm = this.emp.traits.includes('calme') ? 2 : 4;
          if (this.t > calm) {
            g.specials.calm(c, this.emp.name);
            this.finishTask();
          }
        }
        return;
      }
    }
  }

  private doCashier(dt: number) {
    const lane = this.laneUid !== null ? this.game.checkouts.laneByUid(this.laneUid) : null;
    if (!lane || lane.operator !== this) {
      this.laneUid = null;
      this.state = 'idle';
      return;
    }
    if (this.moveAlong(dt) === 'moving') return;
    this.faceTowards(lane.pts.pay.x, lane.pts.pay.z, dt);
    if (!lane.scan) this.anim?.stop();
    // le manager rend la caisse quand la pression retombe
    if (this.emp.role === 'manager' && this.game.checkouts.pressure() < 0.3 && !lane.scan && lane.queue.length === 0) this.dropWork(), (this.state = 'idle');
  }

  private patrolPoint() {
    const r = storeRect(this.game.st.store.stage);
    for (let i = 0; i < 8; i++) {
      const x = r.x0 + 1 + Math.random() * (r.x1 - r.x0 - 2);
      const z = 1 + Math.random() * (r.backZ - 2);
      if (this.game.nav.walkableAt(x, z, this.navOpts)) return { x, z };
    }
    return { x: (r.x0 + r.x1) / 2, z: 2 };
  }

  private startPatrol() {
    const p = this.emp.role === 'securite' && this.emp.zone === 'entree' ? { x: this.game.storeDoor().x + 1.5, z: 1.5 } : this.patrolPoint();
    this.setGoal(p.x, p.z);
    this.state = 'patrol';
    this.t = 0;
  }

  private doPatrol(dt: number) {
    const r = this.moveAlong(dt);
    if (this.emp.role === 'manager') {
      this.praiseT -= dt;
      if (this.praiseT <= 0) {
        this.praiseT = 60 + Math.random() * 60;
        const near = this.game.staff.agents.filter((a) => a !== this && a.distTo(this.pos.x, this.pos.z) < 8);
        if (near.length) {
          this.anim?.play('celebrate');
          this.say('👏', pick(BARKS.managerPraise), 3);
          for (const a of near) a.emp.mood = clamp01(a.emp.mood + 0.04);
        }
      }
    }
    if (r !== 'moving') {
      this.t += dt;
      if (this.t > (this.emp.role === 'securite' ? 4 : 2)) this.state = 'idle';
    }
  }

  private doMonitor(dt: number) {
    if (this.moveAlong(dt) === 'moving') return;
    this.anim?.play('sit');
    const desk = this.game.st.equipment.find((x) => x.def === 'ecran_secu');
    if (!desk) return void (this.state = 'idle');
    const c = equipCenter(desk);
    this.faceTowards(c.x, c.z, dt, 4);
  }

  /** Poursuite d'un voleur repéré. */
  chase(c: Customer) {
    if (this.state === 'chase' || this.state === 'leaving') return;
    this.dropWork();
    this.chaseTarget = c;
    this.state = 'chase';
    this.running = true;
    this.say('🚨', 'Hé ! Vous, là !', 2);
  }

  private doChase(dt: number) {
    const c = this.chaseTarget;
    if (!c || c.dead || c.state === 'caught') {
      this.running = false;
      this.chaseTarget = null;
      this.state = 'idle';
      return;
    }
    if (!this.goal || Math.hypot(this.goal.x - c.pos.x, this.goal.z - c.pos.z) > 1) this.setGoal(c.pos.x, c.pos.z);
    this.moveAlong(dt);
    if (this.distTo(c.pos.x, c.pos.z) < 1.3) {
      // l'interpellation réussit selon la forme physique et la compétence
      if (Math.random() < 0.55 + this.emp.skill * 0.35 - this.emp.fatigue * 0.3) {
        c.getCaught(`l’agent ${this.emp.name}`);
        this.anim?.play('point');
      } else {
        this.say('😤', 'Il m’a échappé !', 2);
        this.chaseTarget = null;
      }
      this.running = false;
      this.state = 'idle';
    }
  }
}

/** Gère les présences : arrivée/départ selon les plannings, salaires à la minute, humeur. */
export class StaffManager {
  agents: EmployeeAgent[] = [];
  private acc = 0;

  constructor(private game: Game) {}

  spawnPoint() {
    const r = storeRect(this.game.st.store.stage);
    return { x: r.dockDoorX + 1, z: r.z1 + 7 };
  }

  clear() {
    for (const a of this.agents) a.dead = true;
    this.agents = [];
  }

  update(dt: number, gameMinutes: number) {
    const st = this.game.st;
    this.agents = this.agents.filter((a) => !a.dead);
    for (const emp of st.employees) {
      const present = this.agents.find((a) => a.emp.id === emp.id);
      if (!present && onShift(st, emp) && this.game.st.speed > 0) {
        const p = this.spawnPoint();
        const a = this.game.agents.add(new EmployeeAgent(this.game, emp, p.x + Math.random(), p.z));
        this.agents.push(a);
      }
    }
    // employés licenciés pendant leur service
    for (const a of this.agents) if (!st.employees.includes(a.emp)) a.dropWork(), (a.dead = true);
    this.acc += gameMinutes;
    if (this.acc >= 1) {
      const m = Math.floor(this.acc);
      this.acc -= m;
      const working = this.agents.filter((a) => a.state !== 'arriving' && a.state !== 'leaving').map((a) => a.emp);
      accrueWages(st, m, working);
      const ctx = {
        hasBreakRoom: st.equipment.some((e) => e.def === 'salle_pause'),
        hasLockers: st.equipment.some((e) => e.def === 'casiers'),
        managerPresent: this.agents.some((a) => a.emp.role === 'manager'),
        queuePressure: this.game.checkouts.pressure(),
      };
      for (const a of this.agents) if (a.state !== 'break') moodTick(st, a.emp, m, ctx);
    }
  }

  present(role?: string) {
    return this.agents.filter((a) => !a.dead && (!role || a.emp.role === role) && a.state !== 'leaving' && a.state !== 'arriving');
  }

  roleName(e: Employee) {
    return ROLE_BY_ID[e.role].name;
  }
}

export const _unused = THREE;
