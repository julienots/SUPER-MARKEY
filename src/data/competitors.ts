import type { CategoryId } from './products';

export type CompetitorStrategy = 'proximite' | 'discount' | 'premium' | 'independant' | 'hyper';

export interface CompetitorDef {
  id: string;
  name: string;
  strategy: CompetitorStrategy;
  desc: string;
  /** Position de l'entrée (monde). */
  door: [number, number];
  /** Emprise du bâtiment [x0, z0, x1, z1]. */
  rect: [number, number, number, number];
  priceIndex: number;
  quality: number;
  service: number;
  reputation: number;
  categories: CategoryId[] | 'all';
  openHour: number;
  closeHour: number;
  cash: number;
  color: number;
  /** Ouvre plus tard dans la partie (jour). */
  opensDay?: number;
  staff: number;
}

export const COMPETITORS: CompetitorDef[] = [
  {
    id: 'proxi', name: 'Proxi-Mouette', strategy: 'proximite', desc: 'Enseigne de proximité franchisée, ouverte tard, chère mais pratique.',
    door: [-54, -10.5], rect: [-62, -10, -46, 2], priceIndex: 1.12, quality: 0.6, service: 0.55, reputation: 55,
    categories: ['cremerie', 'boissons', 'snacks', 'epicerie', 'boulangerie', 'confiserie', 'hygiene', 'surgeles', 'petitdej'],
    openHour: 7, closeHour: 23, cash: 40000, color: 0x00a8ff, staff: 4,
  },
  {
    id: 'discount', name: 'Dégriff’Prix', strategy: 'discount', desc: 'Supermarché discount : palettes, néons et prix planchers.',
    door: [16, -29.5], rect: [2, -50, 30, -30], priceIndex: 0.88, quality: 0.4, service: 0.35, reputation: 50,
    categories: 'all', openHour: 8.5, closeHour: 20, cash: 90000, color: 0xffd32a, staff: 9,
  },
  {
    id: 'gege', name: 'Épicerie Chez Gégé', strategy: 'independant', desc: 'Supérette indépendante historique. Gégé connaît tout le monde et fait crédit.',
    door: [70, -10.5], rect: [64, -10, 77, -1], priceIndex: 1.05, quality: 0.55, service: 0.85, reputation: 62,
    categories: ['epicerie', 'boissons', 'fruits', 'boulangerie', 'snacks', 'cremerie', 'confiserie'],
    openHour: 7, closeHour: 22, cash: 15000, color: 0x44bd32, staff: 2,
  },
  {
    id: 'bio', name: 'Bio & Délices', strategy: 'premium', desc: 'Commerce spécialisé bio et terroir. Clientèle aisée des Coteaux.',
    door: [72, -29.5], rect: [64, -42, 82, -30], priceIndex: 1.35, quality: 0.92, service: 0.75, reputation: 60,
    categories: ['fruits', 'local', 'cremerie', 'boucherie', 'boulangerie', 'petitdej', 'boissons'],
    openHour: 9, closeHour: 19.5, cash: 30000, color: 0x6ab04c, staff: 3,
  },
  {
    id: 'hyper', name: 'MégaHyper Galaxie', strategy: 'hyper', desc: 'Hypermarché géant en périphérie. Tout, tout le temps, en très grand.',
    door: [-78, 9.5], rect: [-96, 10, -60, 40], priceIndex: 0.92, quality: 0.6, service: 0.4, reputation: 58,
    categories: 'all', openHour: 8.5, closeHour: 21, cash: 400000, color: 0x8c7ae6, opensDay: 35, staff: 40,
  },
];
