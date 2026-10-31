/**
 * Orchestrateur du jeu : horloge, simulation (minute/heure/jour), monde 3D, agents, physique, véhicules.
 * Fonctionne aussi en mode « headless » (sans rendu) pour les tests automatisés.
 */
import * as THREE from 'three';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { clamp01, money } from '../core/math';
import { dayOfWeek } from '../core/time';
import { EQUIPMENT_BY_ID, UPGRADE_BY_ID } from '../data/equipment';
import { ARCHETYPE_BY_ID } from '../data/archetypes';
import { PRODUCT_BY_ID, type CategoryId } from '../data/products';
import { ANNOUNCEMENTS } from '../data/lines';
import { initPhysics, Physics } from '../physics/physics';
import { NavGrid } from '../sim/nav';
import { createNewGame, type NewGameOptions } from '../sim/newgame';
import { closeDay, spend, tryBuy, type DayCloseReport } from '../sim/economy';
import { dailySpoilage } from '../sim/inventory';
import { autoReorder, dueOrders, weeklyContracts } from '../sim/orders';
import { chooseStore, competitorDaily, competitorVisit, impulseVisitChance, isStoreOpen, marketShare, PLAYER, quartiersDaily, scheduleNextTrip, storeSnapshot, tripNeeds, type StoreSnapshot } from '../sim/market';
import { hourlyRecruitment, staffMorning } from '../sim/staff';
import { demandBoost, EVENT_BY_ID, hourlyEvents, isActive, activeData, resolveChoice, tickEvents, weatherDaily, type EventCtx, type WorldHooks } from '../sim/events';
import { checkObjectives } from '../sim/objectives';
import { doorCenters, LANDS, resizeFacade, STAGES, storeRect } from '../sim/layout';
import { relocateAfterExpansion } from '../sim/build';
import { dayOf, hourOf, minuteOfDay, type GameState, type PendingChoice, type Resident } from '../sim/state';
import { Sky } from '../world/sky';
import { City } from '../world/city';
import { StoreBuilding } from '../world/storeBuilding';
import { EquipmentView } from '../world/equipmentView';
import { AgentManager } from '../entities/agent';
import { ItemManager } from '../entities/items';
import { Customer } from '../entities/customer';
import { StaffManager } from '../entities/employee';
import { SpecialsManager } from '../entities/specials';
import { VehicleManager } from '../entities/vehicles';
import { Pedestrian, randomArchetype, randomDestination } from '../entities/pedestrian';
import { BurglaryRun } from '../entities/burglar';
import { burglaryRisk } from '../sim/security';
import { CheckoutManager } from './checkout';
import { TaskBoard } from './tasks';
import { SecurityRuntime } from './securityRuntime';
import { ShelfIndex } from './shelfIndex';
import { PhysicsFun } from './physicsFun';
import { Player } from '../player/player';
import { DEFAULT_SETTINGS, type Settings } from './settings';

/** Minutes de jeu écoulées par seconde réelle à vitesse x1 (une journée ≈ 48 min réelles). */
export const MIN_PER_SEC = 0.5;

export interface GameEvents {
  notify: { text: string; kind?: 'info' | 'good' | 'bad' | 'event'; key?: string; quiet?: boolean };
  sale: { amount: number; x: number; z: number; lane: number; player: boolean };
  sfx: { name: string; x?: number; z?: number };
  bark: { id: number; text: string; x: number; y: number; z: number };
  dayReport: DayCloseReport & { notes: string[] };
  choice: PendingChoice;
  objective: { name: string; reward: number };
  announce: { text: string };
  layout: {};
  stateLoaded: {};
  powerChanged: { on: boolean };
  bankrupt: {};
}

export class Game {
  st!: GameState;
  rng = new Rng(1);
  bus = new EventBus<GameEvents>();
  scene = new THREE.Scene();
  /** Plan proche à 12 cm : bonne précision de profondeur sur mobile (pas de scintillement des surfaces). */
  camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.12, 900);
  physics!: Physics;
  nav = new NavGrid();
  sky: Sky | null = null;
  city!: City;
  storeBuilding!: StoreBuilding;
  equipView!: EquipmentView;
  agents!: AgentManager;
  items!: ItemManager;
  staff!: StaffManager;
  specials!: SpecialsManager;
  vehicles!: VehicleManager;
  checkouts!: CheckoutManager;
  tasks!: TaskBoard;
  security!: SecurityRuntime;
  shelfIndex!: ShelfIndex;
  physicsFun!: PhysicsFun;
  player!: Player;
  events!: { isActive: (id: string) => boolean; activeData: (id: string) => any };
  snapshot!: StoreSnapshot;
  settings: Settings;
  /** Temps de simulation écoulé (secondes de jeu « réelles »). */
  clock = 0;
  realTime = 0;
  powerOut = false;
  private powerOutStart = 0;
  private snapT = 0;
  private pedT = 0;
  private lastMinute = -1;
  private lastHour = -1;
  private lastDay = -1;
  private cityBuilt = false;
  private announceT = 120;
  paused = false;
  burglary: BurglaryRun | null = null;
  /** Avance accélérée en cours (nuit sautée). */
  skipping = false;

  /** Rendu 2.5D : simulation sans scène 3D, mais avec l'apparence des personnages. */
  render2d = false;

  /** Les personnages ont-ils besoin d'une apparence (rendu 3D ou 2.5D) ? */
  get needsLook() {
    return !this.headless || this.render2d;
  }

  constructor(public headless = false, settings?: Settings) {
    this.settings = settings ?? structuredClone(DEFAULT_SETTINGS);
    this.scene.name = 'monde';
  }

  async init() {
    await initPhysics();
    this.physics = new Physics();
    if (!this.headless) this.sky = new Sky(this.scene, this.settings.shadows);
    this.city = new City(this.scene, this.physics, this.nav);
    this.storeBuilding = new StoreBuilding(this.scene, this.physics, this.nav);
    this.equipView = new EquipmentView(this.scene, this.physics, this.nav);
    this.agents = new AgentManager(this);
    this.items = new ItemManager(this);
    this.staff = new StaffManager(this);
    this.specials = new SpecialsManager(this);
    this.vehicles = new VehicleManager(this);
    this.checkouts = new CheckoutManager(this);
    this.tasks = new TaskBoard(this);
    this.security = new SecurityRuntime(this);
    this.shelfIndex = new ShelfIndex(this);
    this.physicsFun = new PhysicsFun(this);
    this.player = new Player(this);
    this.events = { isActive: (id) => isActive(this.st, id), activeData: (id) => activeData(this.st, id) };
  }

  // ---------------------------------------------------------------- cycle de vie d'une partie
  newGame(opts: NewGameOptions = {}) {
    this.load(createNewGame(opts));
  }

  load(st: GameState) {
    this.agents?.clear();
    this.vehicles?.clear();
    this.staff?.clear();
    this.st = st;
    this.rng = new Rng((st.seed ^ Math.floor(st.time)) >>> 0 || 1);
    if (!this.cityBuilt) {
      this.city.build(st);
      this.cityBuilt = true;
    } else for (const c of st.competitors) this.city.refreshCompetitor(c.id, st);
    this.rebuildStore();
    this.items.rebuildFromState();
    this.snapshot = storeSnapshot(st, 0);
    this.lastMinute = Math.floor(st.time);
    this.lastHour = Math.floor(st.time / 60);
    this.lastDay = dayOf(st.time);
    this.powerOut = false;
    this.specials = new SpecialsManager(this);
    this.player.reset(st.player);
    this.bus.emit('stateLoaded', {});
  }

  /** Reconstruit bâtiment + équipements (après agrandissement, façade, style...). */
  rebuildStore() {
    this.storeBuilding.build(this.st);
    this.equipView.sync(this.st, true);
    this.checkouts.sync();
    this.shelfIndex.invalidate();
    this.security.refreshCameras();
    this.bus.emit('layout', {});
  }

  /** Appelé après toute modification d'équipement par le joueur. */
  layoutChanged() {
    this.equipView.sync(this.st);
    this.checkouts.sync();
    this.shelfIndex.invalidate();
    this.security.refreshCameras();
    this.bus.emit('layout', {});
  }

  // ---------------------------------------------------------------- accès utilitaires
  storeRect() {
    return storeRect(this.st.store.stage);
  }

  storeDoor(): { x: number; outsideZ: number } {
    const d = doorCenters(this.st.store.facade, this.st.store.stage);
    return { x: d[0] ?? 0, outsideZ: -2.2 };
  }

  isOpen() {
    return isStoreOpen(this.st);
  }

  checkoutWaitPoint() {
    const lanes = [...this.checkouts.lanes.values()];
    if (!lanes.length) {
      const d = this.storeDoor();
      return { x: d.x + 2, z: 3 };
    }
    const x = lanes.reduce((a, l) => a + l.pts.queue[1].x, 0) / lanes.length;
    const z = lanes.reduce((a, l) => a + l.pts.queue[1].z, 0) / lanes.length;
    const p = this.nav.nearestWalkable(x, z + 1.5) ?? { x, z };
    return p;
  }

  impulseChance() {
    return impulseVisitChance(this.st, this.snapshot);
  }

  serviceLevel() {
    const staff = this.staff.present().filter((a) => a.emp.role !== 'securite').length + (this.player.inStore ? 1 : 0);
    const cust = this.agents.count('customer');
    return clamp01(staff / (cust / 6 + 1));
  }

  ambianceLevel() {
    const st = this.st;
    let a = 0.3;
    for (const e of st.equipment) a += (EQUIPMENT_BY_ID[e.def].ambiance ?? 0) * 0.025;
    a += (st.store.lightLevel - 1) * 0.2;
    if (st.store.music !== 'aucune') a += 0.08;
    if (st.flags.cat) a += 0.08;
    if (st.store.construction) a -= 0.15;
    if (this.powerOut) a -= 0.4;
    if (st.store.upgrades['climatisation'] && st.weather.kind === 'canicule') a += 0.15;
    if (st.store.upgrades['portes_auto']) a += 0.05;
    if (st.equipment.some((e) => e.def === 'toilettes')) a += 0.06;
    return clamp01(a);
  }

  /** Perte de stock (casse, périmés) : charge comptable sans mouvement de trésorerie (déjà payé). */
  recordLoss(amount: number, _reason: string) {
    this.st.today.expenses.pertes += amount;
  }

  hooks(): WorldHooks {
    return {
      notify: (text, kind) => this.bus.emit('notify', { text, kind }),
      spawnCrowd: (n, from, boost) => {
        for (let i = 0; i < n; i++) {
          const d = this.storeDoor();
          const p = new Pedestrian(this, from[0] + (Math.random() - 0.5) * 4, from[1] + (Math.random() - 0.5) * 2, { x: d.x + (Math.random() - 0.5) * 6, z: -14.8 }, randomArchetype());
          p.forceVisit = Math.random() < 0.7;
          (p as any).boost = boost;
          this.agents.add(p);
        }
      },
      spawnSpecial: (kind) => this.specials.spawn(kind),
      setPowerOut: (on) => this.setPowerOut(on),
      addMess: (kind, x, z, amount) => void this.items.addMess(kind, x, z, amount),
      announce: (text) => this.bus.emit('announce', { text }),
      dropPallet: (pid, cartons) => {
        const r = this.storeRect();
        const cs = [];
        for (let i = 0; i < cartons; i++) cs.push({ uid: this.st.nextUid++, pid, q: PRODUCT_BY_ID[pid].cartonQty, exp: PRODUCT_BY_ID[pid].shelfLife ? dayOf(this.st.time) + Math.max(1, Math.round(PRODUCT_BY_ID[pid].shelfLife * 0.4)) : -1, opened: false });
        while (cs.length) this.items.spawnPallet(cs.splice(0, 12), r.dockDoorX + 2 + Math.random(), r.z1 + 2.5 + Math.random() * 2);
      },
    };
  }

  private ctx(): EventCtx {
    return { st: this.st, rng: this.rng, hooks: this.hooks() };
  }

  chooseOption(choice: PendingChoice, option: string) {
    resolveChoice(this.ctx(), choice, option);
  }

  setPowerOut(on: boolean) {
    const gen = !!this.st.store.upgrades['groupe_electrogene'];
    const out = on && !gen;
    if (on) this.powerOutStart = this.st.time;
    if (!on && this.powerOut && this.st.time - this.powerOutStart > 90) {
      // le froid a coupé trop longtemps : le frais en rayon est perdu dans la journée
      dailySpoilage(this.st, true);
      this.bus.emit('notify', { text: '🧊 La coupure a duré trop longtemps : les produits frais doivent être vendus aujourd’hui ou jetés.', kind: 'bad' });
    }
    this.powerOut = out;
    this.storeBuilding.setPower(!out, this.st.store.lightLevel);
    this.equipView.setPower(!out, this.st);
    this.bus.emit('powerChanged', { on: !out });
  }

  // ---------------------------------------------------------------- clients
  /** Fait apparaître un client (habitant connu ou passant). */
  spawnCustomer(resident: Resident | null, opts: { archetype?: string; from?: { x: number; z: number }; exit?: { x: number; z: number }; cats?: CategoryId[]; boost?: Partial<Record<CategoryId, number>> } = {}): Customer | null {
    if (this.agents.count('customer') >= this.settings.maxCustomers) return null;
    const st = this.st;
    const cats = opts.cats ?? (resident ? tripNeeds(st, resident, this.rng, { ...demandBoost(st), ...(opts.boost ?? {}) }) : this.passerByNeeds(opts.archetype ?? 'actif', opts.boost));
    let from = opts.from;
    if (!from) {
      const home = resident ? { x: resident.home[0], z: resident.home[1] } : { x: -40, z: -14.8 };
      const door = this.storeDoor();
      const d = Math.hypot(home.x - door.x, home.z - door.outsideZ);
      if (d < 40) from = home;
      else {
        const k = 38 / d;
        from = this.nav.nearestWalkable(door.x + (home.x - door.x) * k, door.outsideZ + (home.z - door.outsideZ) * k, {}, 20) ?? home;
      }
    }
    const c = new Customer(this, resident, from.x, from.z, cats, { archetype: opts.archetype, exit: opts.exit ?? from, boost: opts.boost });
    return this.agents.add(c);
  }

  private passerByNeeds(arch: string, boost?: Partial<Record<CategoryId, number>>): CategoryId[] {
    const a = ARCHETYPE_BY_ID[arch] ?? ARCHETYPE_BY_ID.actif;
    const n = Math.max(1, Math.min(4, this.rng.int(1, a.items[1])));
    const cats: CategoryId[] = [];
    const pool = boost ? (Object.keys(boost) as CategoryId[]) : a.favoriteCats;
    for (let i = 0; i < n; i++) cats.push(this.rng.pick(pool.length ? pool : a.favoriteCats));
    return cats;
  }

  private handleTrip(r: Resident) {
    const st = this.st;
    const needs = tripNeeds(st, r, this.rng, demandBoost(st));
    const choice = chooseStore(st, r, this.snapshot, this.rng, needs);
    scheduleNextTrip(st, r, this.rng);
    if (choice === PLAYER) {
      const arch = ARCHETYPE_BY_ID[r.archetype];
      if (this.agents.count('customer') >= this.settings.maxCustomers) {
        r.nextTrip = st.time + 25; // trop de monde : reviendra plus tard
        return;
      }
      if (this.rng.chance(arch.carChance * 0.8) && !this.headless) {
        const ok = this.vehicles.spawnClientCar((spot, x, z) => {
          const c = this.spawnCustomer(r, { cats: needs, from: { x, z }, exit: { x, z } });
          if (c) {
            c.carSpot = spot;
            c.onLeave = () => this.vehicles.leaveParking(spot);
          } else this.vehicles.leaveParking(spot);
        });
        if (ok) return;
      }
      this.spawnCustomer(r, { cats: needs });
    } else if (choice) {
      const c = st.competitors.find((x) => x.id === choice);
      if (c) competitorVisit(st, c, r, this.rng);
    }
  }

  busArrived() {
    if (!this.isOpen()) return;
    const n = this.rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const [bx] = [27];
      const p = new Pedestrian(this, bx + i * 0.6, -14.6, randomDestination(), randomArchetype());
      this.agents.add(p);
    }
  }

  // ---------------------------------------------------------------- horloge
  private minuteTick() {
    const st = this.st;
    for (const r of st.residents) if (r.nextTrip <= st.time) this.handleTrip(r);
    for (const o of dueOrders(st)) {
      if (this.headless || this.skipping) {
        this.vehicles.deliverNow(o);
      } else this.vehicles.spawnDelivery(o);
    }
    tickEvents(this.ctx());
    // travaux terminés ?
    const cons = st.store.construction;
    if (cons && st.time >= cons.until) this.finishExpansion();
    // portes : fermées la nuit (sauf clés), le magasin se vide
    const open = this.isOpen();
    this.nav.doorsClosed = !open && this.agents.count('customer') === 0;
    const mod = minuteOfDay(st.time);
    const close = st.store.closeHour * 60;
    if (Math.abs(mod - (close - 15)) < 1 && this.settings.announcements) this.bus.emit('announce', { text: ANNOUNCEMENTS[5] });
    if (Math.abs(mod - close) < 1) this.onClosing();
    if (Math.abs(mod - st.store.openHour * 60) < 1) this.bus.emit('notify', { text: `🔓 ${st.store.name} ouvre ses portes !`, kind: 'info' });
  }

  private onClosing() {
    const st = this.st;
    // dépôt de la recette au coffre (protégée des cambrioleurs)
    if (st.equipment.some((e) => e.def === 'coffre')) for (const e of st.equipment) if (e.till) e.till = 0;
    if (st.store.upgrades['alarme']) st.store.alarmArmed = true;
    this.bus.emit('notify', { text: `🔒 Fermeture. ${st.today.customers} clients aujourd’hui, ${money(st.today.revenue)} de chiffre d’affaires.`, kind: 'info' });
  }

  private hourTick() {
    const st = this.st;
    const h = Math.floor(hourOf(st.time));
    const ev = hourlyEvents(this.ctx());
    if (ev) this.bus.emit('notify', { text: `📌 Événement : ${EVENT_BY_ID[ev.id].name}`, kind: 'event', quiet: true });
    hourlyRecruitment(st, this.rng);
    weatherDaily(st, this.rng);
    if (h === 5) for (const m of staffMorning(st, this.rng)) this.bus.emit('notify', { text: m, kind: 'info' });
    if (h === st.store.openHour - 1) st.store.alarmArmed = false;
    if (h === 7 || h === 15) {
      const skill = Math.max(0.3, ...this.st.employees.filter((e) => e.role === 'logisticien' || e.role === 'manager').map((e) => e.skill));
      const placed = autoReorder(st, this.rng, skill);
      for (const o of placed) this.bus.emit('notify', { text: `🤖 Commande automatique #${o.id} passée (${money(o.cost)}).`, kind: 'info' });
    }
    if (h === 2) {
      // nuit sautée : résolution abstraite ; joueur présent : cambrioleurs incarnés
      if (this.skipping || this.headless) {
        const msg = this.security.resolveBurglaryAbstract();
        if (msg) this.bus.emit('notify', { text: msg, kind: 'bad' });
      } else {
        const nightGuard = st.employees.some((e) => e.role === 'securite' && (e.shiftEnd >= 24 || e.shiftStart <= 3));
        if (this.rng.chance(burglaryRisk(st, nightGuard))) {
          this.burglary = new BurglaryRun(this);
          this.burglary.start();
          for (const gd of this.staff.present('securite')) gd.chase(this.burglary.members[0] as any);
        } else if (st.flags.tagTonight) {
          st.flags.tagTonight = false;
          this.items.addMess('tag', this.storeDoor().x + 3, -0.3, 1);
          this.bus.emit('notify', { text: '🎨 Un tag vient d’apparaître sur votre façade.', kind: 'bad' });
        }
      }
    }
    for (const o of checkObjectives(st)) this.bus.emit('objective', { name: o.name, reward: o.reward });
    // usure des équipements
    for (const e of st.equipment) e.wear = Math.min(1, e.wear + (EQUIPMENT_BY_ID[e.def].alwaysOn ? 0.0012 : 0.0005));
    // salissure progressive (pluie, affluence, toilettes)
    const cust = this.agents.count('customer');
    const rain = st.weather.kind === 'pluie' || st.weather.kind === 'orage' || st.weather.kind === 'neige';
    const mats = st.equipment.some((e) => e.def === 'tapis');
    if (this.isOpen() && (rain || cust > 6) && this.rng.chance(rain ? (mats ? 0.25 : 0.7) : 0.2)) {
      const d = this.storeDoor();
      this.items.addMess(rain ? 'flaque' : 'salete', d.x + this.rng.range(-1.5, 1.5), this.rng.range(1, 4), 0.35);
    }
    const bins = st.equipment.filter((e) => e.def === 'poubelle').length;
    if (this.isOpen() && cust > 3 && this.rng.chance(0.25 / (1 + bins))) {
      const r = this.storeRect();
      this.items.addMess('detritus', this.rng.range(r.x0 + 1, r.x1 - 1), this.rng.range(1, r.backZ - 1), 0.3);
    }
    const wc = st.equipment.find((e) => e.def === 'toilettes');
    if (wc && this.isOpen() && this.rng.chance(0.2)) {
      const c = { x: (wc.gx + 1.5) * 0.5 - 8, z: (wc.gz + 1.5) * 0.5 };
      this.items.addMess('salete', c.x, c.z, 0.25);
    }
  }

  private newDay() {
    const st = this.st;
    const notes: string[] = [];
    const share = marketShare(st);
    const report = closeDay(st);
    const sp = dailySpoilage(st, false);
    if (sp.lostUnits) {
      notes.push(`🗑️ ${sp.lostUnits} unités périmées jetées en réserve (${money(sp.lostValue)}).`);
      this.recordLoss(sp.lostValue, 'périmés');
    }
    notes.push(...competitorDaily(st, this.rng, share));
    notes.push(...quartiersDaily(st, this.rng));
    if (dayOfWeek(dayOf(st.time)) === 0) notes.push(...weeklyContracts(st));
    for (const uid of st.flags.repairTomorrow ?? []) {
      const e = st.equipment.find((x) => x.uid === uid);
      if (e) {
        e.broken = false;
        e.wear = 0.1;
        notes.push(`🔧 ${EQUIPMENT_BY_ID[e.def].name} réparé ce matin.`);
      }
    }
    st.flags.repairTomorrow = [];
    // campagnes marketing : notoriété
    for (const c of st.campaigns) {
      if (dayOf(st.time) > c.end) continue;
      for (const r of st.residents) if (this.rng.chance(0.25 * c.strength)) r.awareness = clamp01(r.awareness + 0.1 * c.strength);
    }
    // accord douteux : risque de descente de police
    if (st.flags.dealAccepted && this.rng.chance(0.12)) {
      spend(st, 'amendes', 6000);
      st.flags.dealAccepted = false;
      st.flags.closedUntil = st.time + 24 * 60;
      st.reputation.overall = Math.max(0, st.reputation.overall - 25);
      notes.push('🚔 DESCENTE DE POLICE ! Les « colis » de la réserve sont saisis. Amende de 6 000 €, fermeture administrative 24 h, réputation en chute libre.');
    } else if (st.flags.dealAccepted) {
      st.cash += 85;
      st.today.incomes.divers += 85;
    }
    const changed = this.city.refreshProsperity(st);
    if (changed) notes.push(`🏙️ Le quartier change : ${changed} immeuble(s) ${st.quartiers.reduce((a, q) => a + q.prosperity, 0) / st.quartiers.length > 0.55 ? 'se refont une beauté' : 'se dégradent'}.`);
    for (const c of st.competitors) if (c.open && !this.cityBuilt) this.city.refreshCompetitor(c.id, st);
    if (st.competitors.some((c) => c.history.length === 1 || c.closedForever)) for (const c of st.competitors) this.city.refreshCompetitor(c.id, st);
    if (st.bankrupt) this.bus.emit('bankrupt', {});
    if (st.cash < 0 && !st.bankrupt) notes.push(`⚠️ Trésorerie négative depuis ${st.debtDays} jour(s). Au-delà de 7 jours, c’est la faillite !`);
    this.bus.emit('dayReport', { ...report, notes });
  }

  /** Fait avancer l'horloge de jeu et déclenche les ticks de minute/heure/jour. */
  private advanceClock(minutes: number) {
    const st = this.st;
    st.time += minutes;
    const m = Math.floor(st.time);
    // heure reculée (débogage, outils) : on se recale au lieu d'attendre de repasser l'ancienne heure
    if (m < this.lastMinute) {
      this.lastMinute = m;
      this.lastHour = Math.floor(m / 60);
    }
    while (this.lastMinute < m) {
      this.lastMinute++;
      const h = Math.floor(this.lastMinute / 60);
      const d = Math.floor(this.lastMinute / 1440);
      if (d !== this.lastDay) {
        this.lastDay = d;
        this.newDay();
      }
      if (h !== this.lastHour) {
        this.lastHour = h;
        this.hourTick();
      }
      this.minuteTick();
    }
  }

  // ---------------------------------------------------------------- boucle principale
  update(realDt: number) {
    const dt = Math.min(realDt, 0.1);
    this.realTime += dt;
    const speed = this.paused ? 0 : this.st.speed;
    const simDt = dt * speed;
    if (simDt > 0) {
      this.clock += simDt;
      this.advanceClock(simDt * MIN_PER_SEC);
      this.physics.step(simDt, Math.min(8, 2 + speed * 2));
      const steps = Math.ceil(simDt / 0.1);
      const sub = simDt / steps;
      const camPos = this.headless ? null : this.camera.position;
      for (let i = 0; i < steps; i++) {
        this.staff.update(sub, sub * MIN_PER_SEC);
        this.agents.update(sub, i === steps - 1 ? camPos : null);
        this.checkouts.update(sub);
        this.vehicles.update(sub, this.realTime);
      }
      this.tasks.update(simDt);
      if (this.burglary) {
        this.burglary.update(simDt);
        if (this.burglary.done) this.burglary = null;
      }
      this.shelfIndex.update(simDt);
      this.specials.update();
      this.items.update(simDt);
      this.snapT -= simDt;
      if (this.snapT <= 0) {
        this.snapT = 5;
        this.snapshot = storeSnapshot(this.st, this.agents.count('customer'));
      }
      this.pedT -= simDt;
      if (this.pedT <= 0) {
        this.pedT = 2.5;
        const h = hourOf(this.st.time);
        const target = h > 7 && h < 22 ? 14 : h > 6 && h < 24 ? 6 : 2;
        if (this.agents.count('pedestrian') < target) this.agents.add(new Pedestrian(this, ...this.edgeSpawn(), randomDestination(), randomArchetype()));
      }
      this.announceT -= simDt;
      if (this.announceT <= 0) {
        this.announceT = 240 + Math.random() * 240;
        if (this.isOpen() && this.settings.announcements && this.agents.count('customer') > 1) this.bus.emit('announce', { text: ANNOUNCEMENTS[Math.floor(Math.random() * 5)] });
      }
    } else {
      // en pause : la physique continue de dormir, rien ne bouge
    }
    this.player.update(dt);
    if (!this.headless) {
      const hour = hourOf(this.st.time);
      this.sky?.update(dt, hour, this.st.weather.kind, this.player.pos, this.camera);
      const night = this.sky ? this.sky.night : hour < 7 || hour > 21 ? 1 : 0;
      this.city.setNight(night, isActive(this.st, 'match') || (night > 0.5 && dayOfWeek(dayOf(this.st.time)) >= 5 && hour < 23));
      const people = this.agents.positions();
      people.push({ x: this.player.pos.x, z: this.player.pos.z });
      this.storeBuilding.update(dt, people, this.isOpen() || this.agents.count('customer') > 0, night > 0.5 || !this.isOpen(), this.vehicles.truckAtDock());
      this.equipView.update(dt, this.realTime, this.st);
    } else {
      this.equipView.update(dt, this.realTime, this.st);
    }
  }

  private edgeSpawn(): [number, number] {
    const e = randomDestination();
    return [e.x, e.z];
  }

  /** Avance rapide de la simulation (tests, nuit sautée). Pas de rendu. */
  simulate(seconds: number, step = 0.1) {
    let t = 0;
    while (t < seconds) {
      this.update(step);
      t += step;
    }
  }

  /** Saute la nuit : avance jusqu'à 1 h avant l'ouverture (les agents restants partent). */
  skipNight(): boolean {
    const st = this.st;
    if (this.isOpen() || this.agents.count('customer') > 0) return false;
    this.skipping = true;
    for (const a of this.agents.list) if (a.kind !== 'employee') a.dead = true;
    const day = minuteOfDay(st.time) > st.store.openHour * 60 ? dayOf(st.time) + 1 : dayOf(st.time);
    const target = day * 1440 + (st.store.openHour - 1) * 60;
    const prevSpeed = st.speed;
    while (st.time < target - 0.5) this.advanceClock(Math.min(5, target - st.time));
    st.speed = prevSpeed;
    this.skipping = false;
    this.clock += 60;
    return true;
  }

  /**
   * Copie de l'état prête à sauvegarder : positions physiques, objets tenus par le joueur,
   * paniers des clients présents (remis en rayon/réserve pour ne rien perdre).
   */
  exportState(): GameState {
    this.items.flushToState();
    const copy: GameState = structuredClone(this.st);
    const p = this.player;
    copy.player = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw };
    copy.worldCartons.push(...structuredClone(this.items.cartCargoForSave()));
    const h = p.held;
    if (h?.kind === 'cartons') for (const c of h.list) copy.worldCartons.push({ ...c, x: p.pos.x, y: 0.3, z: p.pos.z, ry: 0 });
    else if (h?.kind === 'item') copy.looseItems.push({ uid: copy.nextUid++, pid: h.pid, exp: h.exp, x: p.pos.x, y: 0.3, z: p.pos.z });
    for (const a of this.agents.list) {
      const c = a as Customer;
      if (a.kind !== 'customer') continue;
      for (const b of [...c.basket, ...c.stolen]) {
        const slot = copy.equipment.flatMap((e) => (e.slots ?? []).map((s, idx) => ({ e, s, idx }))).find((x) => x.s.pid === b.pid);
        if (slot) {
          const lot = slot.s.lots.find((l) => l.exp === b.exp);
          if (lot) lot.q++;
          else slot.s.lots.push({ q: 1, exp: b.exp });
        }
      }
    }
    for (const e of this.staff.agents) if (e.carton) copy.worldCartons.push({ ...e.carton, x: e.pos.x, y: 0.3, z: e.pos.z, ry: 0 });
    return copy;
  }

  // ---------------------------------------------------------------- agrandissement & terrains
  buyLand(id: string): string {
    const land = LANDS.find((l) => l.id === id);
    const st = this.st;
    if (!land || st.store.ownedLand.includes(id)) return 'Déjà acheté.';
    if (!tryBuy(st, 'travaux', land.price)) return 'Trésorerie insuffisante.';
    st.store.ownedLand.push(id);
    this.rebuildStore();
    if (id === 'parking') this.storeBuilding.parkingSpots.forEach((s) => (s.taken = false));
    return `Terrain « ${land.name} » acheté !`;
  }

  startExpansion(): string {
    const st = this.st;
    const next = st.store.stage + 1;
    if (next >= STAGES.length) return 'Votre magasin est déjà au maximum.';
    if (st.store.construction) return 'Des travaux sont déjà en cours.';
    const s = STAGES[next];
    if (s.land && !st.store.ownedLand.includes(s.land)) return `Il faut d’abord acheter le terrain « ${LANDS.find((l) => l.id === s.land)!.name} ».`;
    if (!tryBuy(st, 'travaux', s.cost)) return `Il faut ${money(s.cost)} pour ces travaux.`;
    st.store.construction = { toStage: next, until: st.time + s.days * 1440 };
    this.rebuildStore();
    return `🏗️ Travaux lancés : « ${s.name} » dans ${s.days} jour(s). Le magasin reste ouvert pendant le chantier.`;
  }

  private finishExpansion() {
    const st = this.st;
    const to = st.store.construction!.toStage;
    st.store.construction = null;
    st.store.stage = to;
    st.store.facade = resizeFacade(st.store.facade, to);
    const rel = relocateAfterExpansion(st);
    this.rebuildStore();
    for (const sp of this.storeBuilding.parkingSpots) sp.taken = false;
    this.bus.emit('notify', { text: `🎉 Agrandissement terminé : vous dirigez désormais un « ${STAGES[to].name} » !${rel.moved ? ` ${rel.moved} équipement(s) de réserve déplacé(s) au fond.` : ''}${rel.stuck.length ? ` À replacer : ${rel.stuck.join(', ')}.` : ''}`, kind: 'good' });
    for (const o of checkObjectives(st)) this.bus.emit('objective', { name: o.name, reward: o.reward });
  }

  /** Coût d'intervention d'un technicien (réparation immédiate). */
  repairCost(uid: number): number {
    const e = this.st.equipment.find((x) => x.uid === uid);
    return e ? Math.max(120, Math.round(EQUIPMENT_BY_ID[e.def].price * 0.15)) : 0;
  }

  repair(uid: number): string {
    const e = this.st.equipment.find((x) => x.uid === uid);
    if (!e || !e.broken) return 'Rien à réparer.';
    const cost = this.repairCost(uid);
    if (!tryBuy(this.st, 'entretien', cost)) return 'Trésorerie insuffisante pour le technicien.';
    e.broken = false;
    e.wear = 0.1;
    this.layoutChanged();
    return `🔧 ${EQUIPMENT_BY_ID[e.def].name} réparé par le technicien (${money(cost)}).`;
  }

  buyUpgrade(id: string): string {
    const u = UPGRADE_BY_ID[id];
    const st = this.st;
    if (!u || st.store.upgrades[id]) return 'Déjà installé.';
    if (!tryBuy(st, 'equipement', u.price)) return 'Trésorerie insuffisante.';
    st.store.upgrades[id] = true;
    if (id === 'eclairage_ext') this.rebuildStore();
    return `${u.name} installé !`;
  }
}
