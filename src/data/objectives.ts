/** Objectifs facultatifs : ils guident sans enfermer. Chaque objectif est vérifié chaque jour et à la volée. */
export interface ObjectiveDef {
  id: string;
  name: string;
  desc: string;
  reward: number;
  /** Clé de statistique et seuil. */
  stat: string;
  target: number;
  tier: number;
}

export const OBJECTIVES: ObjectiveDef[] = [
  { id: 'first_sale', name: 'Premier ticket', desc: 'Encaisser votre tout premier client.', reward: 100, stat: 'customersServed', target: 1, tier: 0 },
  { id: 'stock_10', name: 'Mains dans les cartons', desc: 'Remplir 50 produits en rayon vous-même.', reward: 150, stat: 'unitsShelvedByPlayer', target: 50, tier: 0 },
  { id: 'first_order', name: 'Allô le grossiste ?', desc: 'Passer une commande fournisseur.', reward: 100, stat: 'ordersPlaced', target: 1, tier: 0 },
  { id: 'hire_1', name: 'Patron·ne', desc: 'Embaucher votre premier employé.', reward: 200, stat: 'hires', target: 1, tier: 0 },
  { id: 'customers_100', name: 'Habitués', desc: 'Servir 100 clients.', reward: 500, stat: 'customersServed', target: 100, tier: 1 },
  { id: 'revenue_5k', name: 'Ça tourne !', desc: 'Atteindre 5 000 € de chiffre d’affaires cumulé.', reward: 500, stat: 'totalRevenue', target: 5000, tier: 1 },
  { id: 'camera_1', name: 'Big Brother du quartier', desc: 'Installer une caméra de surveillance.', reward: 100, stat: 'cameras', target: 1, tier: 1 },
  { id: 'catch_thief', name: 'Pas vu, pas pris ? Raté.', desc: 'Interpeller un voleur.', reward: 300, stat: 'thievesCaught', target: 1, tier: 1 },
  { id: 'promo_1', name: 'PROMO DU SIÈCLE', desc: 'Lancer une promotion.', reward: 100, stat: 'promosLaunched', target: 1, tier: 1 },
  { id: 'rep_70', name: 'Commerce apprécié', desc: 'Atteindre 70 de réputation.', reward: 1000, stat: 'reputation', target: 70, tier: 2 },
  { id: 'expand_1', name: 'Pousser les murs', desc: 'Réaliser un premier agrandissement.', reward: 1500, stat: 'expansion', target: 1, tier: 2 },
  { id: 'staff_5', name: 'Une vraie équipe', desc: 'Avoir 5 employés.', reward: 800, stat: 'staff', target: 5, tier: 2 },
  { id: 'revenue_50k', name: 'Petit empire', desc: '50 000 € de chiffre d’affaires cumulé.', reward: 3000, stat: 'totalRevenue', target: 50000, tier: 3 },
  { id: 'share_35', name: 'Roi du quartier', desc: 'Atteindre 35 % de part de marché.', reward: 4000, stat: 'marketShare', target: 35, tier: 3 },
  { id: 'expand_3', name: 'Grande surface', desc: 'Atteindre le dernier palier d’agrandissement.', reward: 10000, stat: 'expansion', target: 3, tier: 4 },
  { id: 'customers_5000', name: 'Institution locale', desc: 'Servir 5 000 clients.', reward: 8000, stat: 'customersServed', target: 5000, tier: 4 },
];

/** Rangs du gérant selon le chiffre d'affaires cumulé. */
export const RANKS = [
  { min: 0, name: 'Épicier·e débutant·e' },
  { min: 3000, name: 'Commerçant·e de quartier' },
  { min: 15000, name: 'Gérant·e confirmé·e' },
  { min: 60000, name: 'Directeur·rice de supermarché' },
  { min: 200000, name: 'Magnat de la grande distribution' },
  { min: 600000, name: 'Légende de la banlieue' },
];
