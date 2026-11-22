/** Types de l'état du jeu : tout est sérialisable en JSON (sauvegarde et envoi réseau). */
import type { Role } from '../data/furniture';

export interface Furn {
  id: number;
  def: string;
  /** Case du coin (x min, z min) de l'emprise. */
  x: number;
  z: number;
  /** Quart de tour : 0 = devant vers +z, 1 = +x, 2 = -z, 3 = -x. */
  rot: number;
  /** Rayons : produit de chaque étage (du bas vers le haut). */
  prod: (string | null)[];
  /** Rayons : nombre d'articles sur chaque étage. */
  stock: number[];
}

export interface StaffInfo {
  id: number;
  role: Role;
  name: string;
  model: string;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: number;
  model: string;
  /** Le perso aide tout seul (encaisse, range, remplit) quand on ne le dirige pas. */
  auto: boolean;
}

export interface Delivery {
  id: number;
  items: Record<string, number>;
  /** Heure d'arrivée (secondes de simulation). */
  eta: number;
}

/** Carton posé devant le magasin par le livreur, à ranger dans la réserve. */
export interface DockCarton {
  pid: string;
  n: number;
}

export interface DayStats {
  day: number;
  revenue: number;
  purchases: number;
  wages: number;
  rent: number;
  customers: number;
  served: number;
  unhappy: number;
  items: number;
}

export interface World {
  v: 3;
  /** Incrémenté à chaque changement « structurel » (envoi réseau). */
  rev: number;
  name: string;
  /** Code de la partie à deux (réutilisé quand l'hôte relance la partie). */
  code: string;
  day: number;
  /** Minute de la journée (480 = 8 h). */
  min: number;
  clock: number;
  money: number;
  xp: number;
  level: number;
  sizeIdx: number;
  furn: Furn[];
  nextId: number;
  reserve: Record<string, number>;
  dock: DockCarton[];
  deliveries: Delivery[];
  staff: StaffInfo[];
  players: PlayerInfo[];
  autoOrder: boolean;
  speed: number;
  ratings: number[];
  today: DayStats;
  lastDay: DayStats | null;
}

export type Anim = 'idle' | 'walk' | 'interact' | 'wave' | 'drive';
export type AgentKind = 'customer' | 'staff' | 'player' | 'van';

/** Ce que l'écran a besoin de savoir d'un personnage (envoyé au 2e joueur). */
export interface AgentView {
  id: number;
  kind: AgentKind;
  model: string;
  x: number;
  z: number;
  rot: number;
  anim: Anim;
  /** Porté : id de produit (carton), « basket » (panier client) ou null. */
  carry: string | null;
  /** Bulle : « p:<produit> », « no:<produit> », « ui:<icône> ». */
  bubble: string | null;
  tag: string | null;
  color: number;
  /** Joueur propriétaire (avatar). */
  pid: string | null;
}

export type Action =
  | { t: 'build'; def: string; x: number; z: number; rot: number }
  | { t: 'move'; id: number; x: number; z: number; rot: number }
  | { t: 'sell'; id: number }
  | { t: 'product'; id: number; level: number; pid: string | null }
  | { t: 'fill'; id: number }
  | { t: 'cash'; id: number }
  | { t: 'haul' }
  | { t: 'goto'; x: number; z: number }
  | { t: 'steer'; dx: number; dz: number }
  | { t: 'use'; pid?: string }
  | { t: 'auto'; on: boolean }
  | { t: 'order'; items: Record<string, number> }
  | { t: 'autoOrder'; on: boolean }
  | { t: 'hire'; role: Role }
  | { t: 'fire'; id: number }
  | { t: 'expand' }
  | { t: 'speed'; v: number }
  | { t: 'rename'; name: string };

export type Fx =
  | { k: 'sfx'; n: string; x?: number; z?: number }
  | { k: 'toast'; text: string; kind?: 'info' | 'good' | 'bad'; to?: string; icon?: string }
  | { k: 'float'; text: string; x: number; z: number; color?: string }
  | { k: 'levelup'; level: number }
  | { k: 'day'; stats: DayStats; stars: number };
