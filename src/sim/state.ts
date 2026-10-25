/**
 * État logique complet d'une partie. C'est CE qui est sauvegardé : aucune référence à three.js ou à la physique.
 * La scène 3D est reconstruite à partir de cet état au chargement.
 */
import type { RoleId, TraitId } from '../data/roles';
import type { MusicStyle, LogoIcon } from '../data/styles';
import type { CompetitorStrategy } from '../data/competitors';
import type { CategoryId } from '../data/products';

export const SAVE_VERSION = 3;

export interface Lot {
  q: number;
  /** Jour absolu de péremption (dernier jour vendable). -1 = non périssable. */
  exp: number;
}

export interface Slot {
  pid: string | null;
  lots: Lot[];
}

export interface Carton {
  uid: number;
  pid: string;
  q: number;
  exp: number;
  opened: boolean;
}

export interface PlacedEquip {
  uid: number;
  def: string;
  gx: number;
  gz: number;
  rot: 0 | 1 | 2 | 3;
  slots?: Slot[];
  /** Cartons stockés (racks de réserve, chambre froide). */
  cartons?: Carton[];
  broken?: boolean;
  /** Usure 0..1 : augmente le risque de panne. */
  wear: number;
  /** Caisse ouverte (pour les caisses). */
  open?: boolean;
  /** Argent dans le tiroir-caisse. */
  till?: number;
}

export interface WorldCarton extends Carton {
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface Pallet {
  uid: number;
  x: number;
  z: number;
  ry: number;
  cartons: Carton[];
}

export interface LooseItem {
  uid: number;
  pid: string;
  exp: number;
  x: number;
  y: number;
  z: number;
}

export type MessKind = 'flaque' | 'salete' | 'verre' | 'tag' | 'detritus';
export interface Mess {
  uid: number;
  kind: MessKind;
  x: number;
  z: number;
  /** 0..1 : quantité restante à nettoyer. */
  amount: number;
}

export type PromoKind = 'percent' | 'lot3x2' | 'second50' | 'antigaspi' | 'flash';
export interface Promo {
  id: number;
  kind: PromoKind;
  /** Produits concernés (vide = catégorie entière). */
  pids: string[];
  category?: CategoryId;
  value: number;
  start: number; // jour
  end: number; // jour inclus
  name: string;
  advertised: boolean;
}

export type CampaignKind = 'flyers' | 'affiches' | 'radio' | 'reseaux' | 'lancement' | 'influenceur';
export interface Campaign {
  id: number;
  kind: CampaignKind;
  start: number;
  end: number;
  strength: number;
}

export interface ResidentMemory {
  visits: number;
  satisfaction: number; // moyenne glissante 0..1
  lastVisit: number;
  grievances: string[];
  banned?: boolean;
  thefts?: number;
  loyaltyMember?: boolean;
}

export interface Resident {
  id: number;
  name: string;
  archetype: string;
  quartier: QuartierId;
  home: [number, number];
  age: number;
  female: boolean;
  seed: number;
  honesty: number;
  priceSensitivity: number;
  patience: number;
  favorites: string[];
  /** Préférence par magasin (id → 0..1). 'player' = notre magasin. */
  loyalty: Record<string, number>;
  /** Connaissance de notre magasin 0..1 (marketing, bouche-à-oreille). */
  awareness: number;
  nextTrip: number; // minute absolue
  memory: ResidentMemory;
  friends: number[];
}

export type QuartierId = 'tilleuls' | 'centre' | 'coteaux' | 'stade';
export interface Quartier {
  id: QuartierId;
  name: string;
  prosperity: number; // 0..1
  safety: number; // 0..1
  population: number;
}

export interface Competitor {
  id: string;
  name: string;
  strategy: CompetitorStrategy;
  priceIndex: number;
  quality: number;
  service: number;
  reputation: number;
  cash: number;
  open: boolean;
  closedForever?: boolean;
  staff: number;
  promoCategory: CategoryId | null;
  promoUntil: number;
  promoDepth: number;
  todayCustomers: number;
  todayRevenue: number;
  history: { day: number; customers: number; revenue: number; priceIndex: number }[];
  /** Niveau de stock abstrait 0..1 (ruptures). */
  stockLevel: number;
  catalog: CategoryId[];
}

export interface Employee {
  id: number;
  name: string;
  female: boolean;
  seed: number;
  role: RoleId;
  wage: number; // €/h
  skill: number; // 0..1
  speed: number; // 0.6..1.4
  reliability: number; // 0..1
  experience: number; // heures travaillées
  mood: number; // 0..1
  fatigue: number; // 0..1
  shiftStart: number; // heure
  shiftEnd: number;
  daysOff: number[]; // jours de la semaine
  traits: TraitId[];
  hiredDay: number;
  zone: string | null; // zone de patrouille / caisse affectée
  priority: string | null;
  trainingUntil: number; // jour
  absentToday: boolean;
  lowMoodDays: number;
  relations: Record<number, number>;
  sickUntil?: number;
}

export interface Candidate extends Omit<Employee, 'hiredDay' | 'zone' | 'priority' | 'trainingUntil' | 'absentToday' | 'lowMoodDays' | 'relations' | 'mood' | 'fatigue' | 'experience' | 'shiftStart' | 'shiftEnd' | 'daysOff'> {
  expectedWage: number;
  expires: number;
  experience: number;
  pitch: string;
}

export interface OrderLine {
  pid: string;
  cartons: number;
}
export interface Order {
  id: number;
  supplier: string;
  lines: OrderLine[];
  placedAt: number; // minute absolue
  eta: number; // minute absolue
  status: 'en_cours' | 'livraison' | 'livree' | 'annulee';
  cost: number;
  fee: number;
  auto?: boolean;
  delayed?: boolean;
}

export interface Contract {
  supplier: string;
  discount: number;
  weeklyCartons: number;
  until: number; // jour
  cartonsThisWeek: number;
}

export interface DayRecord {
  day: number;
  revenue: number;
  cogs: number;
  customers: number;
  lostCustomers: number;
  expenses: Record<ExpenseKind, number>;
  incomes: Record<IncomeKind, number>;
  satisfaction: number;
  satisfactionN: number;
  itemsSold: number;
  theftLoss: number;
}

export type ExpenseKind =
  | 'marchandises'
  | 'salaires'
  | 'loyer'
  | 'electricite'
  | 'entretien'
  | 'livraison'
  | 'travaux'
  | 'equipement'
  | 'marketing'
  | 'assurance'
  | 'emprunt'
  | 'impots'
  | 'amendes'
  | 'formation'
  | 'recrutement'
  | 'abonnements';
export type IncomeKind = 'ventes' | 'assurance' | 'divers' | 'recompenses' | 'emprunt';

export interface Loan {
  principal: number;
  remaining: number;
  rate: number; // annuel
  daily: number;
  startDay: number;
}

export interface Incident {
  id: number;
  day: number;
  minute: number;
  kind: 'vol' | 'vol_evite' | 'cambriolage' | 'degradation' | 'intrusion' | 'agression_verbale' | 'controle' | 'panne' | 'autre';
  text: string;
  loss: number;
  onCamera: boolean;
  resolved: boolean;
  x?: number;
  z?: number;
}

export interface ActiveEvent {
  id: string;
  uid: number;
  start: number; // minute absolue
  end: number;
  data: Record<string, any>;
  resolved?: boolean;
}

export interface PendingChoice {
  uid: number;
  eventId: string;
  title: string;
  text: string;
  options: { id: string; label: string; hint?: string }[];
  expires: number;
  data?: Record<string, any>;
}

export interface LogoConfig {
  icon: LogoIcon;
  bg: number;
  fg: number;
  accent: number;
  shape: 'rond' | 'carre' | 'etiquette' | 'blason';
}

export interface StoreConfig {
  name: string;
  slogan: string;
  style: string;
  floor: string;
  wall: string;
  shelfColor: number;
  lightColor: number;
  lightLevel: number; // 0.5..1.5
  uniform: number;
  signBg: number;
  signFg: number;
  logo: LogoConfig;
  music: MusicStyle;
  openHour: number;
  closeHour: number;
  /** Façade : un type par segment de 2 m. */
  facade: ('mur' | 'vitrine' | 'porte')[];
  stage: number;
  /** Travaux en cours. */
  construction: { toStage: number; until: number } | null;
  ownedLand: string[];
  upgrades: Record<string, boolean>;
  alarmArmed: boolean;
  autoOrder: { enabled: boolean; threshold: number; supplier: string };
  insurance: 0 | 1 | 2;
  savedLayouts: { name: string; stage: number; equip: Omit<PlacedEquip, 'uid' | 'slots' | 'cartons' | 'wear'>[] }[];
}

export interface Reputation {
  overall: number;
  prix: number;
  choix: number;
  proprete: number;
  service: number;
  attente: number;
  securite: number;
  ambiance: number;
}

export interface Stats {
  customersServed: number;
  totalRevenue: number;
  unitsSold: number;
  unitsShelvedByPlayer: number;
  ordersPlaced: number;
  hires: number;
  thievesCaught: number;
  promosLaunched: number;
  itemsBroken: number;
  burglaries: number;
  playerScans: number;
  [k: string]: number;
}

export interface GameState {
  version: number;
  seed: number;
  createdAt: number;
  /** Minute absolue depuis le début de la partie. */
  time: number;
  speed: number;
  cash: number;
  difficulty: 'facile' | 'normal' | 'enfer';
  store: StoreConfig;
  equipment: PlacedEquip[];
  prices: Record<string, number>;
  /** Produits référencés (assortiment). */
  assortment: string[];
  worldCartons: WorldCarton[];
  pallets: Pallet[];
  looseItems: LooseItem[];
  messes: Mess[];
  promos: Promo[];
  campaigns: Campaign[];
  residents: Resident[];
  quartiers: Quartier[];
  competitors: Competitor[];
  employees: Employee[];
  candidates: Candidate[];
  jobPostings: { role: RoleId; until: number; wage: number }[];
  orders: Order[];
  contracts: Contract[];
  ledger: DayRecord[];
  today: DayRecord;
  loan: Loan | null;
  debtDays: number;
  bankrupt: boolean;
  incidents: Incident[];
  activeEvents: ActiveEvent[];
  pendingChoices: PendingChoice[];
  eventCooldowns: Record<string, number>;
  weather: { kind: 'soleil' | 'nuageux' | 'pluie' | 'orage' | 'canicule' | 'neige'; until: number };
  reputation: Reputation;
  stats: Stats;
  objectivesDone: string[];
  tutorialStep: number;
  /** Ventes par produit sur les 7 derniers jours (prévisions). */
  salesHistory: Record<string, number[]>;
  todaySales: Record<string, number>;
  /** Demande non satisfaite aujourd'hui (ruptures / introuvable). */
  todayMissed: Record<string, number>;
  insuranceClaims: number;
  nextUid: number;
  player: { x: number; y: number; z: number; yaw: number };
  log: { t: number; text: string; kind: string }[];
  /** Notes d'objectifs et indices déjà affichés. */
  flags: Record<string, any>;
}

export const emptyDay = (day: number): DayRecord => ({
  day,
  revenue: 0,
  cogs: 0,
  customers: 0,
  lostCustomers: 0,
  expenses: {
    marchandises: 0, salaires: 0, loyer: 0, electricite: 0, entretien: 0, livraison: 0, travaux: 0, equipement: 0,
    marketing: 0, assurance: 0, emprunt: 0, impots: 0, amendes: 0, formation: 0, recrutement: 0, abonnements: 0,
  },
  incomes: { ventes: 0, assurance: 0, divers: 0, recompenses: 0, emprunt: 0 },
  satisfaction: 0,
  satisfactionN: 0,
  itemsSold: 0,
  theftLoss: 0,
});

export const dayOf = (t: number) => Math.floor(t / 1440);
export const minuteOfDay = (t: number) => t - dayOf(t) * 1440;
export const hourOf = (t: number) => minuteOfDay(t) / 60;

export function allocUid(s: GameState): number {
  return s.nextUid++;
}
