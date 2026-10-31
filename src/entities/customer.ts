/**
 * Client autonome : arrive dans le quartier, entre, cherche ses produits, compare les prix, réagit aux promos,
 * prend physiquement les articles (le stock baisse), fait la queue, paie et repart avec un souvenir de sa visite.
 * Certains volent, s'énervent, glissent sur une flaque ou abandonnent leur panier.
 */
import * as THREE from 'three';
import { ARCHETYPE_BY_ID, type Archetype } from '../data/archetypes';
import { CATEGORY_BY_ID, PRODUCT_BY_ID, type CategoryId } from '../data/products';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { BARKS } from '../data/lines';
import { clamp01 } from '../core/math';
import { Rng } from '../core/rng';
import { slotInfo } from '../sim/layout';
import { slotQty, takeFromSlot, addToSlot } from '../sim/inventory';
import { promoAppeal, promosFor, shelfPrice, type Ticket } from '../sim/pricing';
import { acceptPrice, applyFeedback, type VisitFeedback } from '../sim/market';
import { dayOf, type PlacedEquip, type Resident } from '../sim/state';
import { randomAppearance } from './character';
import { Agent } from './agent';
import { basketMesh } from '../world/equipmentMeshes';
import { cartMesh } from '../world/equipmentMeshes';
import { productMesh } from '../world/productMeshes';
import type { Game } from '../game/game';
import type { Lane } from '../game/checkout';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface BasketItem {
  pid: string;
  exp: number;
  concealed?: boolean;
}

interface ListEntry {
  cat: CategoryId;
  pid: string | null;
  qty: number;
  tries: number;
  done: boolean;
}

type CState =
  | 'arriving'
  | 'entering'
  | 'deciding'
  | 'walking'
  | 'browsing'
  | 'searching'
  | 'toCheckout'
  | 'waitLane'
  | 'queue'
  | 'paying'
  | 'leaving'
  | 'slipped'
  | 'caught'
  | 'fleeing'
  | 'idleFun'
  | 'ranting';

const pickBark = (arr: string[], cat?: string) => arr[Math.floor(Math.random() * arr.length)].replace('{cat}', cat ?? '');

export class Customer extends Agent {
  readonly kind = 'customer' as const;
  arch: Archetype;
  state: CState = 'arriving';
  list: ListEntry[] = [];
  basket: BasketItem[] = [];
  budget: number;
  spent = 0;
  isThief = false;
  onCameraTheft = false;
  suspect = false;
  stolen: BasketItem[] = [];
  readyToPay = false;
  private t = 0;
  private target: { e: PlacedEquip; idx: number } | null = null;
  private lane: Lane | null = null;
  private queueT = 0;
  private laneRetryT = 0;
  private waitStart = 0;
  private enteredAt = 0;
  private fb = { found: 0, missed: 0, priceSum: 0, priceN: 0, messSeen: 0, incidents: 0 };
  private carryMode: 'hands' | 'basket' | 'cart' = 'hands';
  private cartBody: RAPIER.RigidBody | null = null;
  private cartMeshObj: THREE.Object3D | null = null;
  private exitPoint: { x: number; z: number };
  private searchVisits = 0;
  private funDone = false;
  private impulseCooldown = 0;
  private knowsStore: number;
  private boost: Partial<Record<CategoryId, number>>;
  carSpot: number | null = null;
  onLeave: (() => void) | null = null;
  special: 'influenceur' | 'furieux' | 'inspecteur' | null = null;
  calmed = false;

  constructor(game: Game, public resident: Resident | null, x: number, z: number, cats: CategoryId[], opts: { archetype?: string; exit?: { x: number; z: number }; boost?: Partial<Record<CategoryId, number>> } = {}) {
    super(game, Customer.appearanceFor(game, resident, opts.archetype), x, z);
    const rng = game.rng;
    this.arch = ARCHETYPE_BY_ID[resident?.archetype ?? opts.archetype ?? 'actif'];
    this.name = resident?.name ?? 'Passant·e';
    this.walkSpeed = this.arch.walkSpeed * rng.range(0.9, 1.1);
    this.budget = rng.range(this.arch.budget[0], this.arch.budget[1]) * (resident ? 0.7 + game.st.quartiers.find((q) => q.id === resident.quartier)!.prosperity * 0.6 : 1);
    this.navOpts = {};
    this.exitPoint = opts.exit ?? { x, z };
    this.boost = opts.boost ?? {};
    this.knowsStore = clamp01((resident?.memory.visits ?? 0) * 0.25 + game.st.equipment.filter((e) => e.def === 'panneau_rayon').length * 0.12);
    // liste de courses : une entrée par catégorie (quantités regroupées)
    const map = new Map<CategoryId, number>();
    for (const c of cats) map.set(c, (map.get(c) ?? 0) + 1);
    for (const [cat, qty] of map) {
      const fav = resident?.favorites.find((f) => PRODUCT_BY_ID[f]?.category === cat) ?? null;
      this.list.push({ cat, pid: fav && game.st.assortment.includes(fav) ? fav : null, qty: Math.min(qty, 3), tries: 0, done: false });
    }
    // produit viral : tout le monde le veut
    const viral = game.events.activeData('viral');
    if (viral && rng.chance(0.55)) {
      const p = PRODUCT_BY_ID[viral.pid];
      this.list.unshift({ cat: p.category, pid: p.id, qty: 1, tries: 0, done: false });
    }
    // voleur potentiel ?
    const honesty = resident?.honesty ?? this.arch.honesty;
    const deter = game.security.deterrence();
    this.isThief = !resident?.memory.banned && rng.chance(Math.max(0, (1 - honesty) * 1.6 - deter * 0.25)) && game.st.difficulty !== 'facile' ? true : rng.chance(0.004);
    if (resident?.memory.banned) this.isThief = false;
    this.carryMode = this.basket.length > 8 ? 'cart' : 'hands';
    if (rng.chance(this.arch.cartChance) && game.st.equipment.some((e) => e.def === 'caddies')) this.carryMode = 'cart';
    else if (game.st.equipment.some((e) => e.def === 'paniers') && cats.length > 2) this.carryMode = 'basket';
    this.state = 'arriving';
  }

  /** Apparence stable d'un habitant (même graine = même personne à chaque visite). */
  static appearanceFor(game: Game, resident: Resident | null, archId?: string) {
    if (!game.needsLook) return null;
    const arch = ARCHETYPE_BY_ID[resident?.archetype ?? archId ?? 'actif'];
    const rng = new Rng(resident?.seed ?? game.rng.int(1, 1e9));
    const female = resident?.female ?? rng.chance(0.5);
    const age = resident?.age ?? rng.int(arch.ageRange[0], arch.ageRange[1]);
    return randomAppearance(rng, { female, age, archetype: arch.id });
  }

  get door() {
    return this.game.storeDoor();
  }

  private maxItems() {
    return this.carryMode === 'cart' ? 60 : this.carryMode === 'basket' ? 18 : 5;
  }

  update(dt: number) {
    this.t += dt;
    this.impulseCooldown -= dt;
    switch (this.state) {
      case 'arriving':
        return this.doArriving(dt);
      case 'entering':
        return this.doEntering(dt);
      case 'deciding':
        return this.doDeciding();
      case 'walking':
        return this.doWalking(dt);
      case 'browsing':
        return this.doBrowsing(dt);
      case 'searching':
        return this.doSearching(dt);
      case 'toCheckout':
        return this.doToCheckout(dt);
      case 'waitLane':
        return this.doWaitLane(dt);
      case 'queue':
        return this.doQueue(dt);
      case 'paying':
        return this.doPaying(dt);
      case 'leaving':
        return this.doLeaving(dt);
      case 'slipped':
        if (this.t > 2.6) {
          this.stopAct();
          this.state = this.prevState ?? 'deciding';
          this.t = 0;
        }
        return;
      case 'caught':
        if (this.t > 4) this.goLeave(false);
        return;
      case 'fleeing':
        return this.doFleeing(dt);
      case 'ranting':
        return this.game.specials.rant(this, dt);
      case 'idleFun':
        if (this.t > 4) {
          this.stopAct();
          this.state = 'deciding';
        }
        return;
    }
  }

  private prevState: CState | null = null;

  /** Glissade sur une flaque (si le sol est sale). */
  private checkSlip() {
    if (this.state === 'slipped' || this.speed < 0.6) return;
    const m = this.game.items.messAt(this.pos.x, this.pos.z, 0.45);
    if (!m) return;
    this.fb.messSeen++;
    if ((m.kind === 'flaque' || m.kind === 'verre') && Math.random() < 0.012) {
      this.prevState = this.state;
      this.state = 'slipped';
      this.t = 0;
      this.play('slip');
      this.say('😵', pickBark(BARKS.slip), 2.5);
      this.game.bus.emit('sfx', { name: 'slip', x: this.pos.x, z: this.pos.z });
      this.game.st.reputation.proprete = Math.max(0, this.game.st.reputation.proprete - 1.5);
    }
  }

  private doArriving(dt: number) {
    if (!this.path) {
      const d = this.door;
      if (!this.setGoal(d.x, d.outsideZ)) {
        this.dead = true;
        return;
      }
    }
    const r = this.moveAlong(dt);
    if (r === 'arrived') {
      if (!this.game.isOpen()) {
        this.say('🔒', 'Fermé ?! Sérieusement ?');
        this.goLeave(false);
        this.game.st.today.lostCustomers++;
        return;
      }
      this.state = 'entering';
      this.setGoal(this.door.x, 1.4);
    } else if (r === 'stuck') this.dead = true;
  }

  private doEntering(dt: number) {
    if (this.moveAlong(dt) === 'arrived' || this.arrived) {
      this.enteredAt = this.game.clock;
      this.waitStart = 0;
      if (this.carryMode === 'cart') this.takeCart();
      else if (this.carryMode === 'basket' && this.rig) {
        this.attachHand(null);
        const b = basketMesh();
        b.rotation.y = Math.PI / 2;
        this.attachHand(b);
        this.hold2d = 'basket';
        if (this.anim) this.anim.hold = 'basket';
      }
      if (this.special === 'furieux') {
        this.state = 'ranting';
        this.t = 0;
        return;
      }
      this.state = 'deciding';
    }
  }

  private takeCart() {
    const { body } = this.game.physics.addKinematicBox(this.pos.x, 0.55, this.pos.z, 0.27, 0.45, 0.4, { kind: 'cart', ref: this });
    this.cartBody = body;
    if (!this.game.headless) {
      this.cartMeshObj = cartMesh(this.game.st.store.signBg);
      this.game.scene.add(this.cartMeshObj);
    }
    this.hold2d = 'push';
    if (this.anim) this.anim.hold = 'push';
    this.walkSpeed *= 0.88;
  }

  private dropCart() {
    if (this.cartBody) this.game.physics.removeBody(this.cartBody);
    this.cartBody = null;
    if (this.cartMeshObj) this.game.scene.remove(this.cartMeshObj);
    this.cartMeshObj = null;
  }

  /** Choisit le prochain article de la liste et le facing correspondant. */
  private doDeciding() {
    const st = this.game.st;
    const entry = this.list.find((l) => !l.done);
    if (!entry || this.spent >= this.budget || this.basket.length >= this.maxItems()) {
      this.goCheckout();
      return;
    }
    // petit moment comique de temps en temps
    if (!this.funDone && Math.random() < 0.06) {
      this.funDone = true;
      this.state = 'idleFun';
      this.t = 0;
      if (Math.random() < 0.5) {
        this.play('phone');
        this.say('📱', pickBark(BARKS.phone), 3.5);
      } else {
        this.play('examine');
        this.say('🤔', pickBark(BARKS.pasta), 3.5);
      }
      return;
    }
    const slots = this.game.shelfIndex.slotsForCategory(entry.cat, entry.pid);
    if (!slots.length) {
      entry.tries++;
      if (entry.tries === 1 && this.knowsStore < 0.5 && st.equipment.some((e) => e.slots)) {
        // ne connaît pas le magasin : fait un tour pour chercher
        this.state = 'searching';
        this.searchVisits = 0;
        this.wanderTo();
        return;
      }
      entry.done = true;
      this.fb.missed++;
      st.todayMissed[entry.cat] = (st.todayMissed[entry.cat] ?? 0) + 1;
      if (Math.random() < 0.5) this.say('❓', pickBark(BARKS.notFound, CATEGORY_BY_ID[entry.cat].name.toLowerCase()));
      this.resident?.memory.grievances.push(`introuvable:${entry.cat}`);
      return;
    }
    // préfère un facing non vide, sinon un facing vide (rupture constatée sur place)
    const withStock = slots.filter((s) => slotQty(s.e.slots![s.idx]) > 0);
    const pool = withStock.length ? withStock : slots;
    pool.sort((a, b) => this.distTo(slotInfo(a.e, a.idx).access.x, slotInfo(a.e, a.idx).access.z) - this.distTo(slotInfo(b.e, b.idx).access.x, slotInfo(b.e, b.idx).access.z));
    const pick = pool[Math.min(pool.length - 1, Math.floor(Math.random() * Math.min(2, pool.length)))];
    this.target = pick;
    const inf = slotInfo(pick.e, pick.idx);
    if (!this.setGoal(inf.access.x, inf.access.z)) {
      entry.done = true;
      this.fb.missed++;
      return;
    }
    this.state = 'walking';
  }

  private wanderTo() {
    const shelves = this.game.st.equipment.filter((e) => e.slots && EQUIPMENT_BY_ID[e.def].zone === 'sales');
    if (!shelves.length) return;
    const e = shelves[Math.floor(Math.random() * shelves.length)];
    const inf = slotInfo(e, 0);
    this.setGoal(inf.access.x, inf.access.z);
  }

  private doSearching(dt: number) {
    const r = this.moveAlong(dt);
    if (r === 'moving') return this.checkSlip();
    this.searchVisits++;
    const entry = this.list.find((l) => !l.done);
    if (!entry) return void (this.state = 'deciding');
    this.knowsStore = Math.min(1, this.knowsStore + 0.2);
    if (this.searchVisits >= 3) {
      this.state = 'deciding';
      return;
    }
    if (this.searchVisits === 2 && Math.random() < 0.4) this.say('🧭', 'C’est un vrai labyrinthe ici…');
    this.wanderTo();
  }

  private doWalking(dt: number) {
    const r = this.moveAlong(dt);
    this.checkSlip();
    this.tryImpulse();
    this.syncCart();
    if (r === 'moving') return;
    if (r === 'stuck') {
      const entry = this.list.find((l) => !l.done);
      if (entry) entry.done = true;
      this.state = 'deciding';
      return;
    }
    this.state = 'browsing';
    this.t = 0;
    if (this.target) {
      const inf = slotInfo(this.target.e, this.target.idx);
      this.anim && (this.anim.look = new THREE.Vector3(inf.front.x, inf.front.y, inf.front.z));
    }
  }

  private syncCart() {
    if (!this.cartBody) return;
    const fx = this.pos.x + Math.sin(this.yaw) * 0.75;
    const fz = this.pos.z + Math.cos(this.yaw) * 0.75;
    this.cartBody.setNextKinematicTranslation({ x: fx, y: 0.55, z: fz });
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.cartBody.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    if (this.cartMeshObj) {
      this.cartMeshObj.position.set(fx, 0, fz);
      this.cartMeshObj.rotation.y = this.yaw + Math.PI;
    }
  }

  private tryImpulse() {
    if (this.impulseCooldown > 0 || this.spent >= this.budget) return;
    this.impulseCooldown = 2;
    const near = this.game.shelfIndex.promoSlotsNear(this.pos.x, this.pos.z, 1.6);
    for (const s of near) {
      const pid = s.e.slots![s.idx].pid!;
      if (this.basket.some((b) => b.pid === pid)) continue;
      const appeal = promoAppeal(this.game.st, pid) + (EQUIPMENT_BY_ID[s.e.def].shelf?.pile ? 0.15 : 0);
      if (Math.random() < this.arch.promoAffinity * appeal * 0.6) {
        this.list.unshift({ cat: PRODUCT_BY_ID[pid].category, pid, qty: 1, tries: 0, done: false });
        this.say('🤩', Math.random() < 0.4 ? pickBark(BARKS.promoHappy) : undefined, 2);
        this.state = 'deciding';
        return;
      }
    }
  }

  private doBrowsing(dt: number) {
    const st = this.game.st;
    const tgt = this.target;
    const entry = this.list.find((l) => !l.done);
    if (!tgt || !entry) {
      this.state = 'deciding';
      return;
    }
    const inf = slotInfo(tgt.e, tgt.idx);
    this.faceTowards(inf.front.x, inf.front.z, dt);
    const lookTime = this.arch.id === 'senior' ? 2.4 : this.arch.id === 'actif' ? 0.8 : 1.5;
    if (this.t < lookTime) {
      if (this.t < dt * 1.5) this.play(Math.random() < 0.25 ? 'examine' : 'idle');
      return;
    }
    const slot = tgt.e.slots![tgt.idx];
    const pid = slot.pid;
    const day = dayOf(st.time);
    if (!pid || slotQty(slot) <= 0) {
      // rupture : cherche une alternative dans la même catégorie
      entry.tries++;
      if (entry.tries < 2 && this.game.shelfIndex.slotsForCategory(entry.cat, null).some((s) => slotQty(s.e.slots![s.idx]) > 0 && (s.e !== tgt.e || s.idx !== tgt.idx))) {
        entry.pid = null;
        this.state = 'deciding';
        return;
      }
      entry.done = true;
      this.fb.missed++;
      st.todayMissed[pid ?? entry.cat] = (st.todayMissed[pid ?? entry.cat] ?? 0) + 1;
      this.play('sigh');
      this.say('😤', pickBark(BARKS.outOfStock), 2.5);
      this.resident?.memory.grievances.push(`rupture:${pid}`);
      this.state = 'deciding';
      this.t = 0;
      return;
    }
    // périmés seulement ?
    const fresh = slot.lots.filter((l) => l.exp < 0 || l.exp >= day);
    if (!fresh.length) {
      entry.done = true;
      this.fb.missed++;
      this.fb.messSeen += 2;
      this.say('🤢', 'C’est PÉRIMÉ ! Vous vous moquez de qui ?', 3);
      st.reputation.proprete = Math.max(0, st.reputation.proprete - 2);
      this.state = 'deciding';
      return;
    }
    // vol ?
    const p = PRODUCT_BY_ID[pid];
    if (this.isThief && (p.theftAppeal ?? 0.1) > 0.25 && EQUIPMENT_BY_ID[tgt.e.def].id !== 'vitrine_secu' && this.stolen.length < 2) {
      if (this.game.security.attemptTheft(this, tgt.e, tgt.idx)) {
        entry.done = true;
        this.state = 'deciding';
        return;
      }
    }
    const price = shelfPrice(st, pid, fresh[0].exp);
    const knowsComp = Math.random() < this.arch.priceSensitivity * 0.7;
    const acc = acceptPrice(st, this.resident, pid, price, knowsComp, this.game.rng);
    this.fb.priceSum += Math.max(0, Math.min(1, 1.6 - acc.ratio));
    this.fb.priceN++;
    if (!acc.ok || this.spent + price > this.budget * 1.08) {
      entry.done = true;
      this.fb.missed += 0.5;
      this.play('shrug');
      if (Math.random() < 0.6) this.say('💸', pickBark(BARKS.priceTooHigh), 2.5);
      this.resident?.memory.grievances.push(`prix:${pid}`);
      this.state = 'deciding';
      this.t = 0;
      return;
    }
    // quantité (lots 3 pour 2 : les chasseurs de promo prennent 3)
    let q = entry.qty;
    if (promosFor(st, pid).some((pr) => pr.kind === 'lot3x2') && this.arch.promoAffinity > 0.5) q = 3;
    else if (promosFor(st, pid).some((pr) => pr.kind === 'second50') && this.arch.promoAffinity > 0.4) q = 2;
    q = Math.min(q, this.maxItems() - this.basket.length);
    let took = 0;
    for (let i = 0; i < q; i++) {
      if (this.spent + price > this.budget * 1.1) break;
      const it = takeFromSlot(tgt.e, tgt.idx, this.arch.qualityPref > 0.8);
      if (!it) break;
      if (it.exp >= 0 && it.exp < day) {
        // remet le périmé (il ne le prend pas)
        addToSlot(tgt.e, tgt.idx, it.pid, 1, it.exp);
        break;
      }
      this.basket.push({ pid: it.pid, exp: it.exp });
      this.spent += price;
      took++;
    }
    if (took) {
      this.fb.found++;
      entry.done = true;
      this.game.equipView.markDirty();
      this.play(inf.front.y < 0.5 ? 'reachLow' : 'reach', { height: inf.front.y });
      this.game.bus.emit('sfx', { name: 'pick', x: this.pos.x, z: this.pos.z });
      if (this.carryMode === 'hands' && this.rig && !this.handProp) this.attachHand(productMesh(pid));
      if (promosFor(st, pid).length && Math.random() < 0.3) this.say('🤩', pickBark(BARKS.promoHappy));
      // maladresse : une pile de présentoir peut s'effondrer
      this.game.physicsFun.maybeKnock(this, tgt.e, tgt.idx);
    } else {
      entry.done = true;
    }
    this.state = 'deciding';
    this.t = 0;
  }

  goCheckout() {
    this.anim && (this.anim.look = null);
    if (!this.basket.length && !this.stolen.length) {
      this.goLeave(true);
      return;
    }
    if (!this.basket.length && this.stolen.length) {
      // voleur sans achat : file directement vers la sortie
      this.goLeave(true);
      return;
    }
    this.state = 'toCheckout';
    this.waitStart = this.game.clock;
    this.pickLane();
  }

  private pickLane() {
    const lane = this.game.checkouts.chooseLane(this);
    this.lane = lane;
    if (lane) {
      this.game.checkouts.join(lane, this);
      const s = this.game.checkouts.spotFor(lane, this);
      this.setGoal(s.x, s.z);
      this.state = 'queue';
    } else {
      // aucune caisse ouverte : attend près des caisses
      const z = this.game.checkoutWaitPoint();
      this.setGoal(z.x + (Math.random() - 0.5) * 2, z.z + (Math.random() - 0.5) * 1.5);
      this.state = 'waitLane';
      this.queueT = 0;
    }
  }

  private doToCheckout(dt: number) {
    this.moveAlong(dt);
  }

  private doWaitLane(dt: number) {
    this.moveAlong(dt);
    this.syncCart();
    this.queueT += dt;
    this.laneRetryT -= dt;
    if (this.laneRetryT <= 0) {
      this.laneRetryT = 1.5;
      const lane = this.game.checkouts.chooseLane(this);
      if (lane) {
        this.pickLane();
        return;
      }
    }
    if (this.queueT > 8 && this.queueT - dt <= 8) {
      this.play('angry');
      const full = [...this.game.checkouts.lanes.values()].some((l) => this.game.checkouts.isOpen(l));
      this.say('🙄', full ? 'Toutes les files sont pleines…' : 'Il y a quelqu’un pour encaisser ?!', 3);
      this.game.bus.emit('notify', full ? { text: '🧾 Files d’attente saturées ! Ouvrez une caisse supplémentaire (ou installez-en une).', kind: 'bad', key: 'fulllanes' } : { text: '🧾 Des clients attendent aux caisses : aucune caisse n’est tenue !', kind: 'bad', key: 'nolane' });
    }
    if (this.queueT > 30 + this.patience() * 60) this.abandon('Personne aux caisses');
  }

  private patience() {
    const base = this.resident?.patience ?? this.arch.patience;
    const clim = this.game.st.store.upgrades['climatisation'] ? 0.1 : 0;
    const heat = this.game.st.weather.kind === 'canicule' && !this.game.st.store.upgrades['climatisation'] ? -0.2 : 0;
    return Math.max(0.1, base + clim + heat);
  }

  private doQueue(dt: number) {
    const lane = this.lane;
    if (!lane || !this.game.checkouts.lanes.has(lane.uid)) {
      this.pickLane();
      return;
    }
    const spot = this.game.checkouts.spotFor(lane, this);
    if (!this.goal || Math.hypot(this.goal.x - spot.x, this.goal.z - spot.z) > 0.3) this.setGoal(spot.x, spot.z);
    let r = this.moveAlong(dt);
    this.syncCart();
    this.queueT += dt;
    // bousculé par les autres clients : assez près de sa place suffit
    if (r === 'moving' && this.distTo(spot.x, spot.z) < 0.45) {
      this.stopMoving();
      r = 'arrived';
    }
    if (r === 'arrived') {
      this.faceTowards(lane.pts.pay.x + Math.sin(lane.pts.pay.face) * -2, lane.pts.pay.z, dt, 3);
      if (spot.atRegister) {
        this.readyToPay = true;
        this.state = 'paying';
      }
    }
    // impatience
    const waited = this.game.clock - this.waitStart;
    if (waited > 25 && Math.random() < dt * 0.05) {
      this.play('sigh');
      if (Math.random() < 0.4) this.say('⏳', pickBark(BARKS.queueLong));
    }
    if (!this.game.checkouts.isOpen(lane) && !(lane.scan && lane.scan.customer === this)) {
      // caisse fermée entre-temps : change de file
      this.game.checkouts.leave(this);
      this.pickLane();
      return;
    }
    if (waited > 50 + this.patience() * 140) this.abandon('File d’attente interminable');
  }

  private doPaying(dt: number) {
    this.syncCart();
    if (this.lane && !this.game.checkouts.lanes.has(this.lane.uid)) this.pickLane();
    const waited = this.game.clock - this.waitStart;
    if (waited > 120 + this.patience() * 200) this.abandon('Encaissement trop long');
  }

  laneClosed() {
    this.lane = null;
    if (this.state === 'queue' || this.state === 'paying') {
      this.readyToPay = false;
      this.pickLane();
    }
  }

  /** Appelé par la caisse une fois le paiement effectué. */
  finishPurchase(ticket: Ticket | null) {
    this.readyToPay = false;
    const wait = this.game.clock - this.waitStart;
    this.lastWait = wait;
    if (ticket && ticket.total > 0 && Math.random() < 0.25) this.say('🧾', ticket.promoDiscount > 0 ? `${ticket.promoDiscount.toFixed(2).replace('.', ',')} € d’économie !` : undefined, 2);
    // les voleurs en caisse auto ont pu « oublier » des articles
    const concealed = this.basket.filter((b) => b.concealed);
    if (concealed.length) this.stolen.push(...concealed);
    this.basket = [];
    this.attachHand(null);
    this.goLeave(true);
  }

  private lastWait = 0;

  /** Abandonne le panier (les articles restent par terre / sur un rayon : à ranger !). */
  abandon(reason: string) {
    const st = this.game.st;
    this.game.checkouts.leave(this);
    this.play('angry');
    this.say('😡', `${reason} ! Je m’en vais !`, 3);
    for (const b of this.basket) {
      this.game.items.spawnLoose(b.pid, b.exp, { x: this.pos.x + (Math.random() - 0.5) * 0.6, y: 0.4 + Math.random() * 0.3, z: this.pos.z + (Math.random() - 0.5) * 0.6 });
    }
    this.basket = [];
    this.fb.missed += 2;
    st.today.lostCustomers++;
    this.lastWait = 999;
    this.goLeave(true);
  }

  goLeave(feedback: boolean) {
    this.game.checkouts.leave(this);
    if (feedback && this.enteredAt > 0) this.giveFeedback();
    this.enteredAt = -1;
    this.state = 'leaving';
    this.anim && (this.anim.look = null);
    const d = this.door;
    this.setGoal(d.x, d.outsideZ - 0.5);
    this.leavingStage = 0;
  }

  private leavingStage = 0;

  private doLeaving(dt: number) {
    const r = this.moveAlong(dt);
    this.syncCart();
    if (r === 'moving') return;
    if (this.leavingStage === 0) {
      this.leavingStage = 1;
      this.dropCart();
      // passage du portique antivol
      if (this.stolen.length) this.game.security.exitCheck(this);
      if (this.state !== 'leaving') return;
      if (this.carSpot !== null) {
        const sp = this.game.storeBuilding.parkingSpots[this.carSpot];
        if (sp) this.setGoal(sp.x + 1.2, sp.z + 1.5);
        return;
      }
      this.setGoal(this.exitPoint.x, this.exitPoint.z);
      return;
    }
    if (this.leavingStage === 1) {
      this.leavingStage = 2;
      if (this.stolen.length) this.game.security.theftSucceeded(this);
      this.onLeave?.();
    }
    this.dead = true;
  }

  private doFleeing(dt: number) {
    this.running = true;
    const r = this.moveAlong(dt);
    if (r !== 'moving') {
      this.game.security.theftSucceeded(this);
      this.dead = true;
    }
  }

  /** Interpellation par un vigile ou le joueur. */
  getCaught(by: string) {
    this.running = false;
    this.stopMoving();
    this.state = 'caught';
    this.t = 0;
    this.play('shrug');
    this.say('😰', pickBark(BARKS.theftCaught), 3.5);
    this.game.security.recoverStolen(this, by);
    if (this.resident) {
      this.resident.memory.banned = true;
      this.resident.memory.thefts = (this.resident.memory.thefts ?? 0) + 1;
    }
  }

  flee() {
    this.state = 'fleeing';
    this.running = true;
    this.dropCart();
    this.say('🏃', 'Tchao !', 2);
    this.setGoal(this.exitPoint.x, this.exitPoint.z);
  }

  private giveFeedback() {
    const st = this.game.st;
    const total = this.fb.found + this.fb.missed;
    const waitScore = clamp01(1 - Math.max(0, this.lastWait - 20) / (60 + this.patience() * 120));
    const clean = clamp01(this.game.snapshot.cleanliness - this.fb.messSeen * 0.08);
    const service = clamp01(0.45 + this.game.serviceLevel() * 0.5 + (this.calmed ? 0.2 : 0));
    const safety = clamp01(0.75 - this.fb.incidents * 0.2 + this.game.security.deterrence() * 0.25 - (this.game.events.isActive('rodeurs') ? 0.25 : 0));
    const ambiance = this.game.ambianceLevel();
    const f: VisitFeedback = {
      found: total ? this.fb.found / total : 0.5,
      price: this.fb.priceN ? clamp01(this.fb.priceSum / this.fb.priceN) : 0.6,
      wait: waitScore,
      clean,
      service,
      safety,
      ambiance,
      bought: this.fb.found > 0,
    };
    const s = applyFeedback(st, this.resident, f, this.game.rng);
    if (s > 0.8 && Math.random() < 0.3) this.say('😍', pickBark(BARKS.happy), 2.5);
    else if (s < 0.35 && Math.random() < 0.5) this.say('😒', undefined, 2);
    if (this.special === 'influenceur') this.game.specials.influencerVerdict(this, s);
  }

  override dispose() {
    this.dropCart();
    this.game.checkouts.leave(this);
    super.dispose();
  }
}
