import type { CategoryId } from './products';

/** Profils de clients : chacun pondère différemment prix, qualité, temps et promotions. */
export interface Archetype {
  id: string;
  name: string;
  weight: number;
  ageRange: [number, number];
  /** Budget par visite (€) [min, max]. */
  budget: [number, number];
  items: [number, number];
  /** 0 = indifférent au prix, 1 = très sensible. */
  priceSensitivity: number;
  qualityPref: number;
  promoAffinity: number;
  patience: number;
  walkSpeed: number;
  /** Jours entre deux courses. */
  visitInterval: [number, number];
  favoriteCats: CategoryId[];
  preferredHours: [number, number];
  carChance: number;
  cartChance: number;
  honesty: number;
}

export const ARCHETYPES: Archetype[] = [
  { id: 'etudiant', name: 'Étudiant·e', weight: 1.1, ageRange: [18, 25], budget: [8, 25], items: [2, 6], priceSensitivity: 0.9, qualityPref: 0.2, promoAffinity: 0.9, patience: 0.5, walkSpeed: 1.45, visitInterval: [1, 3], favoriteCats: ['snacks', 'epicerie', 'boissons', 'surgeles'], preferredHours: [17, 22], carChance: 0.05, cartChance: 0.05, honesty: 0.88 },
  { id: 'famille', name: 'Parent de famille', weight: 1.3, ageRange: [28, 50], budget: [45, 140], items: [8, 20], priceSensitivity: 0.65, qualityPref: 0.5, promoAffinity: 0.7, patience: 0.55, walkSpeed: 1.25, visitInterval: [2, 5], favoriteCats: ['cremerie', 'fruits', 'epicerie', 'petitdej', 'boucherie', 'hygiene'], preferredHours: [9, 19], carChance: 0.55, cartChance: 0.85, honesty: 0.97 },
  { id: 'senior', name: 'Retraité·e', weight: 0.9, ageRange: [65, 88], budget: [15, 45], items: [3, 8], priceSensitivity: 0.7, qualityPref: 0.7, promoAffinity: 0.6, patience: 0.8, walkSpeed: 0.85, visitInterval: [1, 2], favoriteCats: ['boulangerie', 'cremerie', 'fruits', 'local', 'epicerie'], preferredHours: [8, 12], carChance: 0.15, cartChance: 0.3, honesty: 0.99 },
  { id: 'actif', name: 'Actif·ve pressé·e', weight: 1.2, ageRange: [25, 55], budget: [12, 45], items: [2, 6], priceSensitivity: 0.35, qualityPref: 0.6, promoAffinity: 0.3, patience: 0.25, walkSpeed: 1.6, visitInterval: [1, 3], favoriteCats: ['snacks', 'boissons', 'boulangerie', 'surgeles', 'cremerie'], preferredHours: [7, 9], carChance: 0.35, cartChance: 0.05, honesty: 0.97 },
  { id: 'chasseur', name: 'Chasseur·se de promos', weight: 0.6, ageRange: [30, 70], budget: [20, 70], items: [4, 12], priceSensitivity: 1, qualityPref: 0.3, promoAffinity: 1, patience: 0.65, walkSpeed: 1.2, visitInterval: [2, 4], favoriteCats: ['epicerie', 'hygiene', 'entretien', 'boissons', 'confiserie'], preferredHours: [10, 18], carChance: 0.4, cartChance: 0.6, honesty: 0.95 },
  { id: 'gourmet', name: 'Gourmet des Coteaux', weight: 0.45, ageRange: [35, 70], budget: [40, 120], items: [3, 9], priceSensitivity: 0.15, qualityPref: 1, promoAffinity: 0.2, patience: 0.45, walkSpeed: 1.2, visitInterval: [2, 5], favoriteCats: ['local', 'cremerie', 'boucherie', 'boissons', 'fruits'], preferredHours: [10, 19], carChance: 0.7, cartChance: 0.4, honesty: 0.98 },
  { id: 'ado', name: 'Ado du quartier', weight: 0.6, ageRange: [13, 17], budget: [3, 10], items: [1, 3], priceSensitivity: 0.95, qualityPref: 0.1, promoAffinity: 0.8, patience: 0.35, walkSpeed: 1.5, visitInterval: [1, 2], favoriteCats: ['confiserie', 'snacks', 'boissons'], preferredHours: [12, 19], carChance: 0, cartChance: 0, honesty: 0.82 },
  { id: 'travailleur', name: 'Artisan du chantier', weight: 0.6, ageRange: [22, 60], budget: [8, 20], items: [1, 4], priceSensitivity: 0.5, qualityPref: 0.4, promoAffinity: 0.4, patience: 0.3, walkSpeed: 1.4, visitInterval: [1, 2], favoriteCats: ['snacks', 'boissons', 'boulangerie'], preferredHours: [11, 14], carChance: 0.5, cartChance: 0, honesty: 0.96 },
];

export const ARCHETYPE_BY_ID: Record<string, Archetype> = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));
