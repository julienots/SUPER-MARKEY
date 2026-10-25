/**
 * Marché local : habitants (population persistante), choix du magasin, concurrents simulés,
 * réputation, bouche-à-oreille et évolution des quartiers.
 */
import { ARCHETYPES, ARCHETYPE_BY_ID, type Archetype } from '../data/archetypes';
import { COMPETITORS } from '../data/competitors';
import { CATEGORIES, PRODUCT_BY_ID, PRODUCTS, type CategoryId } from '../data/products';
import { FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES } from '../data/names';
import { BUILDINGS, QUARTIER_INFO } from '../data/world';
import type { Rng } from '../core/rng';
import { clamp, clamp01, dist2 } from '../core/math';
import { dayOfWeek, season } from '../core/time';
import { priceIndex, promoAppeal, promosFor } from './pricing';
import { slotQty } from './inventory';
import { dayOf, hourOf, type Competitor, type GameState, type QuartierId, type Quartier, type Resident } from './state';
import { doorCenters } from './layout';

export const PLAYER = 'player';

export function makeQuartiers(): Quartier[] {
  return (Object.keys(QUARTIER_INFO) as QuartierId[]).map((id) => ({ id, name: QUARTIER_INFO[id].name, prosperity: QUARTIER_INFO[id].prosperity, safety: QUARTIER_INFO[id].safety, population: 0 }));
}

const archetypeWeightFor = (a: Archetype, q: QuartierId) => {
  let w = a.weight;
  if (q === 'coteaux') w *= a.id === 'gourmet' ? 4 : a.id === 'etudiant' || a.id === 'ado' ? 0.4 : 1;
  if (q === 'tilleuls') w *= a.id === 'gourmet' ? 0.05 : a.id === 'famille' || a.id === 'ado' || a.id === 'chasseur' ? 1.5 : 1;
  if (q === 'stade') w *= a.id === 'etudiant' || a.id === 'travailleur' ? 1.6 : 1;
  return w;
};

export function makeResident(st: GameState, rng: Rng, id: number, bIndex?: number): Resident {
  const homes = BUILDINGS.filter((b) => b.households > 0);
  const b = bIndex !== undefined ? homes[bIndex % homes.length] : rng.weighted(homes, (h) => h.households)!;
  const arch = rng.weighted(ARCHETYPES, (a) => archetypeWeightFor(a, b.quartier))!;
  const female = rng.chance(0.52);
  const first = rng.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
  const favCats = arch.favoriteCats;
  const favorites: string[] = [];
  for (const c of favCats) {
    const options = PRODUCTS.filter((p) => p.category === c && !p.seasonal);
    const pick = rng.weighted(options, (p) => p.popularity * (arch.qualityPref > 0.7 ? p.quality * 2 : 1) * (arch.priceSensitivity > 0.8 && p.tier === 'mdd' ? 2 : 1));
    if (pick) favorites.push(pick.id);
  }
  const loyalty: Record<string, number> = { [PLAYER]: 0 };
  for (const c of COMPETITORS) {
    const d = dist2(b.door[0], b.door[1], c.door[0], c.door[1]);
    loyalty[c.id] = clamp01(0.5 - d / 300 + rng.range(-0.15, 0.15));
  }
  const nextDay = rng.int(0, arch.visitInterval[1]);
  return {
    id,
    name: `${first} ${rng.pick(LAST_NAMES)}`,
    archetype: arch.id,
    quartier: b.quartier,
    home: [b.door[0], b.door[1]],
    age: rng.int(arch.ageRange[0], arch.ageRange[1]),
    female,
    seed: rng.int(1, 2 ** 30),
    honesty: clamp(arch.honesty + rng.gauss(0, 0.04) + (QUARTIER_INFO[b.quartier].prosperity - 0.5) * 0.04, 0.6, 1),
    priceSensitivity: clamp(arch.priceSensitivity + rng.gauss(0, 0.1), 0, 1),
    patience: clamp(arch.patience + rng.gauss(0, 0.12), 0.1, 1),
    favorites,
    loyalty,
    awareness: clamp01(0.6 - dist2(b.door[0], b.door[1], 0, -10) / 220 + rng.range(0, 0.3)),
    nextTrip: nextDay * 1440 + Math.round(tripHour(arch, rng) * 60),
    memory: { visits: 0, satisfaction: 0.6, lastVisit: -1, grievances: [] },
    friends: [],
  };
}

function tripHour(a: Archetype, rng: Rng): number {
  const [h0, h1] = a.preferredHours;
  return clamp(rng.range(h0, h1) + rng.gauss(0, 0.8), 7, 22);
}

export function makeResidents(st: GameState, rng: Rng, n: number): Resident[] {
  const out: Resident[] = [];
  for (let i = 0; i < n; i++) out.push(makeResident(st, rng, i + 1));
  // petits réseaux sociaux : voisins + quelques amis ailleurs
  for (const r of out) {
    const neighbours = out.filter((o) => o !== r && o.quartier === r.quartier);
    for (let k = 0; k < 4 && neighbours.length; k++) r.friends.push(rng.pick(neighbours).id);
    if (rng.chance(0.5)) r.friends.push(rng.pick(out).id);
  }
  return out;
}

export function makeCompetitors(): Competitor[] {
  return COMPETITORS.map((c) => ({
    id: c.id,
    name: c.name,
    strategy: c.strategy,
    priceIndex: c.priceIndex,
    quality: c.quality,
    service: c.service,
    reputation: c.reputation,
    cash: c.cash,
    open: c.opensDay === undefined,
    staff: c.staff,
    promoCategory: null,
    promoUntil: -1,
    promoDepth: 0,
    todayCustomers: 0,
    todayRevenue: 0,
    history: [],
    stockLevel: 0.9,
    catalog: c.categories === 'all' ? CATEGORIES.map((x) => x.id) : [...c.categories],
  }));
}

// ---------------------------------------------------------------- Attractivité de notre magasin

export interface StoreSnapshot {
  open: boolean;
  priceIndex: number;
  /** Catégories disponibles en rayon (au moins un facing non vide). */
  cats: Set<CategoryId>;
  /** Taux de remplissage moyen des rayons. */
  fill: number;
  quality: number;
  promoStrength: number;
  advertisedPromos: number;
  crowd: number;
  cleanliness: number;
  door: { x: number; z: number };
  facadeAppeal: number;
}

export function storeSnapshot(st: GameState, crowd: number): StoreSnapshot {
  const cats = new Set<CategoryId>();
  let filled = 0;
  let cap = 0;
  let qual = 0;
  let qn = 0;
  for (const e of st.equipment) {
    if (!e.slots) continue;
    for (const s of e.slots) {
      if (!s.pid) continue;
      const q = slotQty(s);
      cap++;
      if (q > 0) {
        filled++;
        const p = PRODUCT_BY_ID[s.pid];
        cats.add(p.category);
        qual += p.quality;
        qn++;
      }
    }
  }
  let promo = 0;
  let adv = 0;
  for (const pid of st.assortment) promo = Math.max(promo, promoAppeal(st, pid));
  for (const p of st.promos) if (p.advertised && dayOf(st.time) >= p.start && dayOf(st.time) <= p.end) adv++;
  const h = hourOf(st.time);
  const open = isStoreOpen(st, h);
  const doors = doorCenters(st.store.facade, st.store.stage);
  const windows = st.store.facade.filter((f) => f === 'vitrine').length;
  const neon = st.equipment.filter((e) => e.def === 'neon').length;
  return {
    open,
    priceIndex: priceIndex(st),
    cats,
    fill: cap ? filled / cap : 0,
    quality: qn ? qual / qn : 0.5,
    promoStrength: promo,
    advertisedPromos: adv,
    crowd,
    cleanliness: clamp01(1 - st.messes.reduce((a, m) => a + m.amount, 0) / 12 - st.looseItems.length / 60),
    door: { x: doors[0] ?? 0, z: -0.5 },
    facadeAppeal: clamp01(0.25 + windows * 0.06 + neon * 0.12 + (st.store.upgrades['portes_auto'] ? 0.1 : 0)),
  };
}

/** Le magasin est ouvert (horaires, fermeture administrative ou exceptionnelle). */
export function isStoreOpen(st: GameState, hour = hourOf(st.time)): boolean {
  if (st.flags.closedUntil && st.time < st.flags.closedUntil) return false;
  return hour >= st.store.openHour && hour < st.store.closeHour;
}

const compDef = (id: string) => COMPETITORS.find((c) => c.id === id)!;

function competitorOpen(c: Competitor, hour: number): boolean {
  const d = compDef(c.id);
  return c.open && !c.closedForever && hour >= d.openHour && hour < d.closeHour;
}

/**
 * Choix du magasin pour un trajet de courses (logit multinomial).
 * Renvoie 'player', l'id d'un concurrent, ou null (personne n'est ouvert).
 */
export function chooseStore(st: GameState, r: Resident, snap: StoreSnapshot, rng: Rng, needCats: CategoryId[]): string | null {
  const a = ARCHETYPE_BY_ID[r.archetype];
  const hour = hourOf(st.time);
  const options: { id: string; u: number }[] = [];
  const hasCar = a.carChance > 0.4;
  const distW = hasCar ? 1 / 400 : 1 / 140;

  if (snap.open && !r.memory.banned && r.awareness > 0.05) {
    const d = dist2(r.home[0], r.home[1], snap.door.x, snap.door.z);
    const coverage = needCats.length ? needCats.filter((c) => snap.cats.has(c)).length / needCats.length : snap.cats.size / CATEGORIES.length;
    const rep = st.reputation;
    let u = 0;
    u += (rep.overall / 100 - 0.5) * 1.6;
    u -= r.priceSensitivity * (snap.priceIndex - 1) * 4.5;
    u += coverage * 1.6 - 0.9 + snap.fill * 0.6;
    u += a.qualityPref * (snap.quality - 0.55) * 1.5;
    u += r.loyalty[PLAYER] * 1.4;
    u += (r.memory.satisfaction - 0.55) * (r.memory.visits > 0 ? 1.8 : 0.4);
    u += a.promoAffinity * (snap.promoStrength * 0.8 + Math.min(3, snap.advertisedPromos) * 0.12 * r.awareness);
    u -= d * distW;
    u -= Math.max(0, snap.crowd - 18) * 0.04;
    u += (r.awareness - 0.45) * 1.3;
    // effet nouveauté / curiosité les premières semaines
    u += Math.max(0, 0.6 - dayOf(st.time) * 0.03);
    u -= (1 - rep.attente / 100) * (1 - r.patience) * 0.8;
    options.push({ id: PLAYER, u });
  }
  for (const c of st.competitors) {
    if (!competitorOpen(c, hour)) continue;
    const def = compDef(c.id);
    const d = dist2(r.home[0], r.home[1], def.door[0], def.door[1]);
    const coverage = needCats.length ? needCats.filter((x) => c.catalog.includes(x)).length / needCats.length : c.catalog.length / CATEGORIES.length;
    let u = 0;
    u += (c.reputation / 100 - 0.5) * 1.6;
    const pi = c.priceIndex * (c.promoCategory && needCats.includes(c.promoCategory) ? 1 - c.promoDepth * 0.5 : 1);
    u -= r.priceSensitivity * (pi - 1) * 4.5;
    u += coverage * 1.6 - 0.9 + c.stockLevel * 0.6;
    u += a.qualityPref * (c.quality - 0.55) * 1.5;
    u += (r.loyalty[c.id] ?? 0) * 1.4;
    u += c.service * 0.5;
    u -= d * distW;
    if (c.strategy === 'hyper' && !hasCar) u -= 0.8;
    // habitude installée des concurrents (diminue si le joueur fidélise)
    u += 0.15;
    if (c.strategy === 'hyper' && needCats.length > 6) u += 0.6;
    options.push({ id: c.id, u });
  }
  if (!options.length) return null;
  const T = 0.7;
  const max = Math.max(...options.map((o) => o.u));
  return rng.weighted(options, (o) => Math.exp((o.u - max) / T))!.id;
}

/** Catégories nécessaires pour ce trajet (besoins, saison, événements). */
export function tripNeeds(st: GameState, r: Resident, rng: Rng, boost: Partial<Record<CategoryId, number>> = {}): CategoryId[] {
  const a = ARCHETYPE_BY_ID[r.archetype];
  const n = rng.int(a.items[0], a.items[1]);
  const se = season(dayOf(st.time));
  const cats: CategoryId[] = [];
  for (let i = 0; i < n; i++) {
    const c = rng.weighted(CATEGORIES, (cd) => {
      let w = cd.weeklyNeed;
      if (a.favoriteCats.includes(cd.id)) w *= 2.2;
      if (cd.id === 'saison') w *= seasonalActive(st) ? 2.5 : 0.05;
      if (cd.id === 'surgeles' && se === 'été') w *= 1.3;
      if (cd.id === 'boissons' && se === 'été') w *= 1.4;
      w *= 1 + (boost[cd.id] ?? 0);
      return w;
    })!;
    cats.push(c.id);
  }
  return cats;
}

export function seasonalActive(st: GameState): string[] {
  const d = dayOf(st.time);
  const doy = (60 + d) % 365;
  const out: string[] = [];
  if (doy >= 330 && doy <= 359) out.push('noel');
  if (doy >= 160 && doy <= 240) out.push('ete');
  if (doy >= 235 && doy <= 258) out.push('rentree');
  if (doy >= 290 && doy <= 304) out.push('halloween');
  if (doy >= 330 || doy <= 75) out.push('hiver');
  if (doy >= 80 && doy <= 110) out.push('paques');
  if (st.weather.kind === 'pluie' || st.weather.kind === 'orage') out.push('hiver');
  return out;
}

/** Prochaine date de courses d'un habitant. */
export function scheduleNextTrip(st: GameState, r: Resident, rng: Rng) {
  const a = ARCHETYPE_BY_ID[r.archetype];
  const days = rng.int(a.visitInterval[0], a.visitInterval[1]);
  const day = dayOf(st.time) + Math.max(1, days);
  let h = tripHour(a, rng);
  if (dayOfWeek(day) >= 5) h = clamp(h + rng.range(-2, 2), 8, 20);
  r.nextTrip = day * 1440 + Math.round(h * 60);
}

/** Chance qu'un passant entre spontanément (vitrine, enseigne, néon, promos affichées). */
export function impulseVisitChance(st: GameState, snap: StoreSnapshot): number {
  if (!snap.open) return 0;
  return clamp(0.04 + snap.facadeAppeal * 0.12 + snap.advertisedPromos * 0.015 + (st.reputation.overall - 50) / 600, 0.01, 0.3);
}

// ---------------------------------------------------------------- Réputation & bouche-à-oreille

export interface VisitFeedback {
  found: number; // 0..1 produits trouvés
  price: number; // 0..1 perception prix (1 = très bien)
  wait: number; // 0..1 (1 = pas d'attente)
  clean: number;
  service: number;
  safety: number;
  ambiance: number;
  bought: boolean;
}

export function visitSatisfaction(f: VisitFeedback): number {
  return clamp01(f.found * 0.27 + f.price * 0.2 + f.wait * 0.18 + f.clean * 0.12 + f.service * 0.1 + f.safety * 0.06 + f.ambiance * 0.07 + (f.bought ? 0.05 : -0.1));
}

export function applyFeedback(st: GameState, r: Resident | null, f: VisitFeedback, rng: Rng): number {
  const s = visitSatisfaction(f);
  const k = 0.02;
  const rep = st.reputation;
  rep.choix += (f.found * 100 - rep.choix) * k;
  rep.prix += (f.price * 100 - rep.prix) * k;
  rep.attente += (f.wait * 100 - rep.attente) * k;
  rep.proprete += (f.clean * 100 - rep.proprete) * k;
  rep.service += (f.service * 100 - rep.service) * k;
  rep.securite += (f.safety * 100 - rep.securite) * k;
  rep.ambiance += (f.ambiance * 100 - rep.ambiance) * k;
  recomputeReputation(st);
  st.today.satisfaction += s;
  st.today.satisfactionN++;
  if (r) {
    const m = r.memory;
    m.visits++;
    m.lastVisit = dayOf(st.time);
    m.satisfaction = m.visits === 1 ? s : m.satisfaction * 0.7 + s * 0.3;
    if (m.grievances.length > 6) m.grievances.splice(0, m.grievances.length - 6);
    r.loyalty[PLAYER] = clamp01(r.loyalty[PLAYER] + (s - 0.55) * 0.25);
    r.awareness = clamp01(r.awareness + 0.2);
    // bouche-à-oreille
    if (s > 0.72 || s < 0.35) {
      for (const fid of r.friends) {
        if (!rng.chance(0.35)) continue;
        const fr = st.residents.find((x) => x.id === fid);
        if (!fr) continue;
        if (s > 0.72) fr.awareness = clamp01(fr.awareness + 0.12);
        else fr.loyalty[PLAYER] = clamp01(fr.loyalty[PLAYER] - 0.06);
      }
    }
  }
  return s;
}

export function recomputeReputation(st: GameState) {
  const r = st.reputation;
  r.overall = clamp(r.choix * 0.22 + r.prix * 0.2 + r.attente * 0.15 + r.proprete * 0.14 + r.service * 0.12 + r.securite * 0.08 + r.ambiance * 0.09, 0, 100);
}

// ---------------------------------------------------------------- Concurrents

export function competitorVisit(st: GameState, c: Competitor, r: Resident, rng: Rng) {
  const a = ARCHETYPE_BY_ID[r.archetype];
  const basket = rng.range(a.budget[0], a.budget[1]) * 0.75 * c.priceIndex;
  c.todayCustomers++;
  c.todayRevenue += basket;
  r.loyalty[c.id] = clamp01((r.loyalty[c.id] ?? 0) + 0.02);
  r.loyalty[PLAYER] = clamp01(r.loyalty[PLAYER] - 0.01);
}

/** Simulation quotidienne d'un concurrent : finances, stratégie, réaction au joueur. */
export function competitorDaily(st: GameState, rng: Rng, playerShare: number): string[] {
  const msgs: string[] = [];
  const day = dayOf(st.time);
  const pIndex = priceIndex(st);
  for (const c of st.competitors) {
    const def = compDef(c.id);
    if (!c.open) {
      if (def.opensDay !== undefined && day >= def.opensDay && !c.closedForever) {
        c.open = true;
        c.promoCategory = 'epicerie';
        c.promoDepth = 0.3;
        c.promoUntil = day + 7;
        msgs.push(`📣 GRANDE OUVERTURE : ${c.name} ouvre ses portes en périphérie ! Promotions massives pendant une semaine.`);
      }
      continue;
    }
    if (c.closedForever) continue;
    const margin = c.strategy === 'discount' ? 0.16 : c.strategy === 'premium' ? 0.32 : c.strategy === 'hyper' ? 0.2 : 0.26;
    const gross = c.todayRevenue * margin * (c.priceIndex / def.priceIndex);
    const costs = c.staff * 105 + (c.strategy === 'hyper' ? 2200 : c.strategy === 'discount' ? 380 : 140);
    c.cash += gross - costs;
    c.history.push({ day, customers: c.todayCustomers, revenue: Math.round(c.todayRevenue), priceIndex: c.priceIndex });
    if (c.history.length > 60) c.history.shift();
    // fréquentation en baisse ? → réaction
    const recent = c.history.slice(-7);
    const avg = recent.reduce((a, h) => a + h.customers, 0) / Math.max(1, recent.length);
    const older = c.history.slice(-14, -7);
    const avgOld = older.length ? older.reduce((a, h) => a + h.customers, 0) / older.length : avg;
    const losing = avg < avgOld * 0.92;
    if (losing && rng.chance(0.5)) {
      if (c.strategy === 'discount' || c.strategy === 'hyper') {
        c.priceIndex = Math.max(def.priceIndex - 0.08, c.priceIndex - 0.015);
        if (rng.chance(0.5) && c.promoUntil < day) {
          c.promoCategory = rng.pick(c.catalog);
          c.promoDepth = rng.range(0.15, 0.35);
          c.promoUntil = day + rng.int(3, 6);
          msgs.push(`💥 ${c.name} lance une promo agressive sur « ${CATEGORIES.find((x) => x.id === c.promoCategory)!.name} » (−${Math.round(c.promoDepth * 100)} %).`);
        }
      } else if (c.strategy === 'premium') {
        c.quality = Math.min(0.98, c.quality + 0.01);
      } else if (c.strategy === 'independant') {
        c.service = Math.min(0.95, c.service + 0.02);
        if (rng.chance(0.3)) msgs.push(`🤝 Gégé fait crédit à ses habitués et offre le café. Il se défend !`);
      } else {
        c.priceIndex = Math.max(def.priceIndex - 0.05, c.priceIndex - 0.01);
      }
    } else if (!losing && c.priceIndex < def.priceIndex) {
      c.priceIndex = Math.min(def.priceIndex, c.priceIndex + 0.005);
    }
    // si le joueur est nettement moins cher, les discounters s'alignent
    if ((c.strategy === 'discount' || c.strategy === 'hyper') && pIndex < c.priceIndex - 0.05 && playerShare > 0.2 && rng.chance(0.3)) {
      c.priceIndex = Math.max(0.78, c.priceIndex - 0.02);
      msgs.push(`📉 ${c.name} baisse ses prix pour contrer votre magasin.`);
    }
    if (c.promoUntil < day) c.promoCategory = null;
    // réputation : tend vers une cible liée à la qualité, au service et au prix
    const target = 35 + c.quality * 25 + c.service * 25 + (1.1 - c.priceIndex) * 40 + c.stockLevel * 10;
    c.reputation += (clamp(target, 10, 95) - c.reputation) * 0.05;
    c.stockLevel = clamp(c.stockLevel + rng.gauss(0.01, 0.06), 0.55, 1);
    // faillite
    if (c.cash < -20000 && c.strategy !== 'hyper') {
      c.closedForever = true;
      c.open = false;
      msgs.push(`🪦 ${c.name} a fait faillite et ferme définitivement. Ses clients cherchent un nouveau magasin…`);
      for (const r of st.residents) r.loyalty[c.id] = 0;
    }
    c.todayCustomers = 0;
    c.todayRevenue = 0;
  }
  return msgs;
}

/** Part de marché du joueur sur 7 jours. */
export function marketShare(st: GameState): number {
  const days = st.ledger.slice(-7);
  const mine = days.reduce((a, d) => a + d.customers, 0) + st.today.customers;
  let theirs = 0;
  for (const c of st.competitors) theirs += c.history.slice(-7).reduce((a, h) => a + h.customers, 0) + c.todayCustomers;
  return mine + theirs > 0 ? mine / (mine + theirs) : 0;
}

/** Évolution quotidienne des quartiers : prospérité, sécurité, population. */
export function quartiersDaily(st: GameState, rng: Rng): string[] {
  const msgs: string[] = [];
  const recentIncidents = st.incidents.filter((i) => i.day >= dayOf(st.time) - 7 && (i.kind === 'cambriolage' || i.kind === 'degradation' || i.kind === 'intrusion')).length;
  const staffLocal = st.employees.length;
  for (const q of st.quartiers) {
    const baseP = QUARTIER_INFO[q.id].prosperity;
    const storeEffect = (st.reputation.overall - 50) / 2500 + staffLocal * 0.0004;
    q.prosperity = clamp(q.prosperity + storeEffect + (baseP - q.prosperity) * 0.01 + rng.gauss(0, 0.003), 0.05, 0.98);
    const lights = st.store.upgrades['eclairage_ext'] ? 0.002 : 0;
    q.safety = clamp(q.safety - recentIncidents * 0.002 + lights + (QUARTIER_INFO[q.id].safety - q.safety) * 0.02 + (q.prosperity - 0.5) * 0.002, 0.1, 0.98);
    q.population = st.residents.filter((r) => r.quartier === q.id).length;
  }
  // croissance démographique (nouveaux habitants attirés par un quartier dynamique)
  const avgP = st.quartiers.reduce((a, q) => a + q.prosperity, 0) / st.quartiers.length;
  if (rng.chance(0.25 + avgP * 0.4) && st.residents.length < 900) {
    const n = rng.int(1, 3 + Math.round(avgP * 4));
    const maxId = st.residents.reduce((a, r) => Math.max(a, r.id), 0);
    for (let i = 0; i < n; i++) {
      const r = makeResident(st, rng, maxId + 1 + i);
      r.nextTrip = st.time + rng.int(60, 2880);
      st.residents.push(r);
    }
    if (n >= 4) msgs.push(`🏘️ ${n} nouveaux foyers emménagent dans le quartier.`);
  }
  return msgs;
}

export function productsForCategory(st: GameState, cat: CategoryId): string[] {
  return st.assortment.filter((pid) => PRODUCT_BY_ID[pid].category === cat);
}

/** Probabilité qu'un client accepte un prix (utilisée en rayon). */
export function acceptPrice(st: GameState, r: Resident | null, pid: string, price: number, knowsCompetitor: boolean, rng: Rng): { ok: boolean; ratio: number } {
  const p = PRODUCT_BY_ID[pid];
  let ref = p.price;
  if (knowsCompetitor) {
    const best = Math.min(...st.competitors.filter((c) => c.open && c.catalog.includes(p.category)).map((c) => c.priceIndex * (c.promoCategory === p.category ? 1 - c.promoDepth : 1)), 1.2);
    ref = p.price * (0.6 + 0.4 * best);
  }
  const sens = r ? r.priceSensitivity : 0.6;
  const tolerance = 0.12 + (1 - sens) * 0.55;
  const ratio = price / ref;
  const x = (1 + tolerance - ratio) / 0.08;
  const prob = 1 / (1 + Math.exp(-x));
  const promoBonus = promosFor(st, pid).length ? 0.1 : 0;
  return { ok: rng.chance(Math.min(0.995, prob + promoBonus)), ratio };
}
