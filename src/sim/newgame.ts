/**
 * Création d'une nouvelle partie : petite supérette modeste, un peu de stock, budget serré.
 */
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID, psychologicalPrice } from '../data/products';
import { STYLE_PRESETS } from '../data/styles';
import { Rng } from '../core/rng';
import { canHold, ensureSlots, addToSlot, newCarton, storeCarton } from './inventory';
import { defaultFacade, slotCount, storeRect, itemLayout } from './layout';
import { makeCompetitors, makeQuartiers, makeResidents } from './market';
import { placeEquipment } from './build';
import { emptyDay, SAVE_VERSION, type GameState, type PlacedEquip } from './state';

export interface NewGameOptions {
  seed?: number;
  storeName?: string;
  difficulty?: GameState['difficulty'];
  residents?: number;
  style?: string;
}

export const STARTER_ASSORTMENT = [
  'pommes', 'bananes', 'carottes', 'tomates', 'lait', 'yaourts', 'beurre', 'oeufs', 'emmental', 'jambon', 'steaks', 'pizza_surg', 'frites_surg', 'glace',
  'eau', 'cola', 'canette', 'jus_orange', 'biere', 'cereales', 'cafe', 'pate_tartiner', 'chocolat', 'bonbons', 'biscuits', 'chips', 'cacahuetes',
  'pates', 'pates_mdd', 'riz', 'sauce_tomate', 'thon', 'haricots', 'huile', 'shampoing', 'dentifrice', 'pq', 'lessive', 'liquide_vaisselle', 'baguette', 'croissants', 'pain_mie', 'sandwich',
];

/** Plan de départ (palier 0 : 16 m × 14 m). */
const STARTER_LAYOUT: { def: string; gx: number; gz: number; rot: 0 | 1 | 2 | 3; fill?: string[] }[] = [
  { def: 'caisse', gx: 20, gz: 4, rot: 0 },
  { def: 'paniers', gx: 9, gz: 1, rot: 0 },
  { def: 'extincteur', gx: 31, gz: 0, rot: 0 },
  // gondoles murales à gauche (dos au mur ouest)
  { def: 'gondole_simple', gx: 0, gz: 6, rot: 1, fill: ['pates', 'pates_mdd', 'riz', 'sauce_tomate', 'thon', 'haricots', 'huile', 'riz'] },
  { def: 'gondole_simple', gx: 0, gz: 11, rot: 1, fill: ['eau', 'cola', 'jus_orange', 'canette', 'biere', 'eau', 'cola'] },
  { def: 'gondole_simple', gx: 0, gz: 15, rot: 1, fill: ['shampoing', 'dentifrice', 'pq', 'lessive', 'liquide_vaisselle'] },
  // îlots centraux
  { def: 'gondole_double', gx: 6, gz: 7, rot: 1, fill: ['cereales', 'cafe', 'pate_tartiner', 'biscuits', 'chocolat', 'bonbons'] },
  { def: 'gondole_double', gx: 12, gz: 7, rot: 1, fill: ['chips', 'cacahuetes', 'chocolat', 'bonbons', 'biscuits', 'cafe'] },
  { def: 'etal_fruits', gx: 18, gz: 9, rot: 1, fill: ['pommes', 'bananes', 'carottes', 'tomates'] },
  { def: 'bac_pain', gx: 25, gz: 9, rot: 3, fill: ['baguette', 'croissants', 'pain_mie'] },
  // froid contre la cloison de la réserve
  { def: 'frigo_vitre', gx: 9, gz: 18, rot: 2, fill: ['lait', 'yaourts', 'beurre', 'oeufs', 'emmental', 'jambon', 'steaks', 'sandwich'] },
  { def: 'congelateur', gx: 16, gz: 18, rot: 2, fill: ['pizza_surg', 'frites_surg', 'glace'] },
  { def: 'tete_gondole', gx: 23, gz: 14, rot: 0, fill: ['chips'] },
  // réserve
  { def: 'rack_reserve', gx: 9, gz: 26, rot: 2 },
  { def: 'rack_reserve', gx: 14, gz: 26, rot: 2 },
  { def: 'chambre_froide', gx: 22, gz: 24, rot: 2 },
];

export function createNewGame(opts: NewGameOptions = {}): GameState {
  const seed = opts.seed ?? (Date.now() & 0x7fffffff);
  const rng = new Rng(seed);
  const preset = STYLE_PRESETS.find((p) => p.id === (opts.style ?? 'superette')) ?? STYLE_PRESETS[0];
  const difficulty = opts.difficulty ?? 'normal';
  const st: GameState = {
    version: SAVE_VERSION,
    seed,
    createdAt: Date.now(),
    time: 7 * 60 + 30, // lundi 7 h 30
    speed: 1,
    cash: difficulty === 'facile' ? 22000 : difficulty === 'enfer' ? 6500 : 12000,
    difficulty,
    store: {
      name: opts.storeName?.trim() || 'BAZAR BAZAR',
      slogan: 'La supérette de l’enfer',
      style: preset.id,
      floor: preset.floor,
      wall: preset.wall,
      shelfColor: preset.shelfColor,
      lightColor: preset.light,
      lightLevel: 1,
      uniform: preset.uniform,
      signBg: preset.signBg,
      signFg: preset.signFg,
      logo: { icon: 'devil', bg: 0xe84118, fg: 0xffffff, accent: 0xffc72c, shape: 'etiquette' },
      music: 'muzak',
      openHour: 8,
      closeHour: 21,
      facade: defaultFacade(0),
      stage: 0,
      construction: null,
      ownedLand: [],
      upgrades: {},
      alarmArmed: false,
      autoOrder: { enabled: false, threshold: 3, supplier: 'grossiste' },
      insurance: 1,
      savedLayouts: [],
    },
    equipment: [],
    prices: {},
    assortment: [...STARTER_ASSORTMENT],
    worldCartons: [],
    pallets: [],
    looseItems: [],
    messes: [],
    promos: [],
    campaigns: [],
    residents: [],
    quartiers: makeQuartiers(),
    competitors: makeCompetitors(),
    employees: [],
    candidates: [],
    jobPostings: [],
    orders: [],
    contracts: [],
    ledger: [],
    today: emptyDay(0),
    loan: null,
    debtDays: 0,
    bankrupt: false,
    incidents: [],
    activeEvents: [],
    pendingChoices: [],
    eventCooldowns: { coupure: 3, controle_sanitaire: 5, controle_securite: 7, offre_louche: 9, influenceur: 4 },
    weather: { kind: 'soleil', until: 12 * 60 },
    reputation: { overall: 50, prix: 55, choix: 50, proprete: 60, service: 50, attente: 60, securite: 55, ambiance: 45 },
    stats: { customersServed: 0, totalRevenue: 0, unitsSold: 0, unitsShelvedByPlayer: 0, ordersPlaced: 0, hires: 0, thievesCaught: 0, promosLaunched: 0, itemsBroken: 0, burglaries: 0, playerScans: 0 },
    objectivesDone: [],
    tutorialStep: 0,
    salesHistory: {},
    todaySales: {},
    todayMissed: {},
    insuranceClaims: 0,
    nextUid: 1000,
    player: { x: -1, y: 1, z: -6, yaw: Math.PI },
    log: [],
    flags: {},
  };
  for (const pid of Object.keys(PRODUCT_BY_ID)) st.prices[pid] = psychologicalPrice(PRODUCT_BY_ID[pid].price * 1.02);

  // Équipement de départ (offert : il fait partie du fonds de commerce)
  for (const l of STARTER_LAYOUT) {
    const r = placeEquipment(st, l.def, l.gx, l.gz, l.rot, true);
    if (!r.ok || !r.e) {
      // en cas de conflit de plan, on l'ignore plutôt que de planter
      console.warn('[newgame] placement de départ refusé', l.def, r.reason);
      continue;
    }
    if (l.fill) autoAssign(r.e, l.fill);
  }
  // Remplissage initial : rayons à ~60 %, quelques cartons en réserve
  for (const e of st.equipment) {
    if (!e.slots) continue;
    e.slots.forEach((s, i) => {
      if (!s.pid) return;
      const p = PRODUCT_BY_ID[s.pid];
      const cap = itemLayout(EQUIPMENT_BY_ID[e.def], i, p).capacity;
      const q = Math.max(1, Math.round(cap * rng.range(0.4, 0.8)));
      addToSlot(e, i, s.pid, q, p.shelfLife > 0 ? Math.round(p.shelfLife * rng.range(0.5, 1)) : -1);
    });
  }
  for (const pid of STARTER_ASSORTMENT) {
    const n = PRODUCT_BY_ID[pid].shelfLife > 0 && PRODUCT_BY_ID[pid].shelfLife < 5 ? 0 : rng.int(0, 2);
    for (let k = 0; k < n; k++) storeCarton(st, newCarton(st, pid));
  }
  st.residents = makeResidents(st, rng, opts.residents ?? 1000);
  const r = storeRect(0);
  st.player = { x: (r.x0 + r.x1) / 2 - 1, y: 1, z: -7, yaw: 0 };
  return st;
}

/** Assigne automatiquement des produits aux facings compatibles d'un meuble (planogramme rapide). */
export function autoAssign(e: PlacedEquip, pids: string[]): number {
  ensureSlots(e);
  const def = EQUIPMENT_BY_ID[e.def];
  const n = slotCount(def);
  let k = 0;
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    if (e.slots![i].pid) continue;
    for (let tries = 0; tries < pids.length; tries++) {
      const pid = pids[(k + tries) % pids.length];
      if (canHold(def, i, PRODUCT_BY_ID[pid])) {
        e.slots![i].pid = pid;
        k = (k + tries + 1) % pids.length;
        assigned++;
        break;
      }
    }
  }
  return assigned;
}
