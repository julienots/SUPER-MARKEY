/**
 * Catalogue des références. Ajouter un produit = ajouter une entrée ici :
 * les systèmes (stock, rendu instancié, clients, fournisseurs) le prennent en compte automatiquement.
 */
export type CategoryId =
  | 'fruits'
  | 'cremerie'
  | 'boucherie'
  | 'surgeles'
  | 'boissons'
  | 'petitdej'
  | 'confiserie'
  | 'snacks'
  | 'epicerie'
  | 'hygiene'
  | 'entretien'
  | 'boulangerie'
  | 'local'
  | 'saison';

export type StorageClass = 'ambient' | 'chilled' | 'frozen';
export type Shape = 'box' | 'can' | 'bottle' | 'carton' | 'jar' | 'bag' | 'tray' | 'fruit' | 'bread' | 'tube' | 'pack' | 'egg';
export type Tier = 'mdd' | 'standard' | 'premium' | 'local';
export type SeasonTag = 'noel' | 'ete' | 'rentree' | 'halloween' | 'hiver' | 'paques';

export interface CategoryDef {
  id: CategoryId;
  name: string;
  icon: string;
  /** Besoin moyen par foyer et par semaine (unités). */
  weeklyNeed: number;
  color: number;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'fruits', name: 'Fruits & légumes', icon: '🍎', weeklyNeed: 5, color: 0x6dbb3c },
  { id: 'cremerie', name: 'Crèmerie', icon: '🥛', weeklyNeed: 4, color: 0x9fd3f2 },
  { id: 'boucherie', name: 'Boucherie', icon: '🥩', weeklyNeed: 2, color: 0xc0392b },
  { id: 'surgeles', name: 'Surgelés', icon: '🧊', weeklyNeed: 1.5, color: 0x5dade2 },
  { id: 'boissons', name: 'Boissons', icon: '🥤', weeklyNeed: 5, color: 0xe67e22 },
  { id: 'petitdej', name: 'Petit-déjeuner', icon: '🥣', weeklyNeed: 1.5, color: 0xf4d03f },
  { id: 'confiserie', name: 'Confiserie', icon: '🍬', weeklyNeed: 1.5, color: 0xe84393 },
  { id: 'snacks', name: 'Snacks & apéro', icon: '🍿', weeklyNeed: 2, color: 0xf39c12 },
  { id: 'epicerie', name: 'Épicerie & conserves', icon: '🥫', weeklyNeed: 4, color: 0xa0522d },
  { id: 'hygiene', name: 'Hygiène', icon: '🧴', weeklyNeed: 1, color: 0x81ecec },
  { id: 'entretien', name: 'Produits ménagers', icon: '🧽', weeklyNeed: 0.8, color: 0x00b894 },
  { id: 'boulangerie', name: 'Boulangerie', icon: '🥖', weeklyNeed: 5, color: 0xd4a056 },
  { id: 'local', name: 'Produits locaux', icon: '🧺', weeklyNeed: 0.8, color: 0x8e6e53 },
  { id: 'saison', name: 'Saisonnier', icon: '🎁', weeklyNeed: 0.6, color: 0xd63031 },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryDef>;

export interface ProductDef {
  id: string;
  name: string;
  brand: string;
  category: CategoryId;
  shape: Shape;
  /** Dimensions [largeur, hauteur, profondeur] en mètres. */
  size: [number, number, number];
  color: number;
  color2: number;
  /** Prix d'achat fournisseur moyen (€ / unité). */
  cost: number;
  /** Prix de marché de référence (€ / unité). */
  price: number;
  cartonQty: number;
  /** Durée de conservation en jours (0 = non périssable). */
  shelfLife: number;
  storage: StorageClass;
  mass: number;
  quality: number;
  popularity: number;
  tier: Tier;
  fragile?: boolean;
  rolls?: boolean;
  stackable?: boolean;
  /** Article de valeur, cible privilégiée des voleurs. */
  theftAppeal?: number;
  seasonal?: SeasonTag;
  /** Palier de progression nécessaire pour être référencé chez les fournisseurs. */
  unlock?: number;
}

type P = Omit<ProductDef, 'stackable' | 'quality' | 'popularity' | 'tier' | 'mass'> & Partial<ProductDef>;

const p = (d: P): ProductDef => ({
  stackable: d.shape === 'box' || d.shape === 'can' || d.shape === 'tray' || d.shape === 'pack' || d.shape === 'egg',
  quality: 0.6,
  popularity: 0.5,
  tier: 'standard',
  mass: Math.max(0.05, d.size[0] * d.size[1] * d.size[2] * 600),
  ...d,
});

export const PRODUCTS: ProductDef[] = [
  // ---------- Fruits & légumes ----------
  p({ id: 'pommes', name: 'Pommes Golden (1 kg)', brand: 'Vergers du Val', category: 'fruits', shape: 'bag', size: [0.18, 0.12, 0.12], color: 0xf1e05a, color2: 0x6ab04c, cost: 1.3, price: 2.4, cartonQty: 12, shelfLife: 12, storage: 'ambient', mass: 1, popularity: 0.8 }),
  p({ id: 'bananes', name: 'Bananes (1 kg)', brand: 'Tropic Bazar', category: 'fruits', shape: 'fruit', size: [0.2, 0.06, 0.1], color: 0xf9ca24, color2: 0x6ab04c, cost: 1.1, price: 1.99, cartonQty: 16, shelfLife: 6, storage: 'ambient', mass: 1, popularity: 0.85 }),
  p({ id: 'tomates', name: 'Tomates grappe (500 g)', brand: 'Soleil du Sud', category: 'fruits', shape: 'tray', size: [0.16, 0.08, 0.12], color: 0xe74c3c, color2: 0x27ae60, cost: 1.2, price: 2.3, cartonQty: 12, shelfLife: 7, storage: 'ambient', popularity: 0.7, fragile: true }),
  p({ id: 'carottes', name: 'Carottes (1 kg)', brand: 'Potager Gaulois', category: 'fruits', shape: 'bag', size: [0.16, 0.1, 0.24], color: 0xe67e22, color2: 0x27ae60, cost: 0.7, price: 1.49, cartonQty: 14, shelfLife: 14, storage: 'ambient', mass: 1, popularity: 0.6 }),
  p({ id: 'salade', name: 'Salade batavia', brand: 'Potager Gaulois', category: 'fruits', shape: 'fruit', size: [0.18, 0.14, 0.18], color: 0x7bed9f, color2: 0x2ed573, cost: 0.6, price: 1.2, cartonQty: 12, shelfLife: 4, storage: 'ambient', mass: 0.4, popularity: 0.55 }),
  p({ id: 'avocats', name: 'Avocats prêts à manger x2', brand: 'Tropic Bazar', category: 'fruits', shape: 'tray', size: [0.14, 0.08, 0.1], color: 0x2d5016, color2: 0xa3cb38, cost: 1.4, price: 2.99, cartonQty: 12, shelfLife: 5, storage: 'ambient', tier: 'premium', quality: 0.75, popularity: 0.45 }),
  p({ id: 'oranges', name: 'Oranges à jus (2 kg)', brand: 'Soleil du Sud', category: 'fruits', shape: 'bag', size: [0.22, 0.14, 0.16], color: 0xf39c12, color2: 0xe67e22, cost: 1.9, price: 3.49, cartonQty: 8, shelfLife: 14, storage: 'ambient', mass: 2, popularity: 0.5, rolls: true }),

  // ---------- Crèmerie ----------
  p({ id: 'lait', name: 'Lait demi-écrémé 1 L', brand: 'Meuh-Tropolitain', category: 'cremerie', shape: 'carton', size: [0.07, 0.2, 0.07], color: 0xffffff, color2: 0x2e86de, cost: 0.62, price: 1.09, cartonQty: 12, shelfLife: 30, storage: 'chilled', mass: 1.03, popularity: 0.95 }),
  p({ id: 'lait_mdd', name: 'Lait 1 L Marque Bazar', brand: 'BAZAR', category: 'cremerie', shape: 'carton', size: [0.07, 0.2, 0.07], color: 0xfff6d5, color2: 0xe84118, cost: 0.48, price: 0.85, cartonQty: 12, shelfLife: 30, storage: 'chilled', mass: 1.03, tier: 'mdd', quality: 0.5, popularity: 0.75 }),
  p({ id: 'yaourts', name: 'Yaourts nature x8', brand: 'Lacti-Bonheur', category: 'cremerie', shape: 'pack', size: [0.2, 0.08, 0.14], color: 0xffffff, color2: 0x74b9ff, cost: 1.2, price: 2.15, cartonQty: 8, shelfLife: 21, storage: 'chilled', mass: 1, popularity: 0.75 }),
  p({ id: 'beurre', name: 'Beurre doux 250 g', brand: 'Moulinette', category: 'cremerie', shape: 'box', size: [0.1, 0.04, 0.06], color: 0xffeaa7, color2: 0x0984e3, cost: 1.5, price: 2.49, cartonQty: 20, shelfLife: 45, storage: 'chilled', mass: 0.25, popularity: 0.65 }),
  p({ id: 'camembert', name: 'Camembert au lait cru', brand: 'Fromagerie Pouët', category: 'cremerie', shape: 'tube', size: [0.11, 0.04, 0.11], color: 0xfdf2e9, color2: 0xc0392b, cost: 1.6, price: 2.89, cartonQty: 12, shelfLife: 20, storage: 'chilled', mass: 0.25, quality: 0.75, popularity: 0.55 }),
  p({ id: 'oeufs', name: 'Œufs plein air x12', brand: 'Cocotte Libre', category: 'cremerie', shape: 'egg', size: [0.3, 0.07, 0.11], color: 0xd2b48c, color2: 0xf6e58d, cost: 2.1, price: 3.59, cartonQty: 10, shelfLife: 28, storage: 'chilled', mass: 0.75, fragile: true, popularity: 0.7 }),
  p({ id: 'emmental', name: 'Emmental râpé 200 g', brand: 'Moulinette', category: 'cremerie', shape: 'bag', size: [0.15, 0.2, 0.04], color: 0xf9e79f, color2: 0x2980b9, cost: 1.3, price: 2.25, cartonQty: 16, shelfLife: 30, storage: 'chilled', mass: 0.2, popularity: 0.6 }),

  // ---------- Boucherie ----------
  p({ id: 'steaks', name: 'Steaks hachés 5% x2', brand: 'Charcut\'Art', category: 'boucherie', shape: 'tray', size: [0.2, 0.04, 0.15], color: 0xb33939, color2: 0xffffff, cost: 2.4, price: 3.99, cartonQty: 10, shelfLife: 6, storage: 'chilled', mass: 0.25, popularity: 0.7, theftAppeal: 0.4 }),
  p({ id: 'poulet', name: 'Filets de poulet 500 g', brand: 'Volaille Joyeuse', category: 'boucherie', shape: 'tray', size: [0.22, 0.05, 0.16], color: 0xf8c291, color2: 0x78e08f, cost: 3.6, price: 5.99, cartonQty: 8, shelfLife: 6, storage: 'chilled', mass: 0.5, popularity: 0.7 }),
  p({ id: 'jambon', name: 'Jambon blanc x4 tranches', brand: 'Charcut\'Art', category: 'boucherie', shape: 'tray', size: [0.18, 0.02, 0.12], color: 0xf8a5c2, color2: 0x3c6382, cost: 1.5, price: 2.69, cartonQty: 16, shelfLife: 12, storage: 'chilled', mass: 0.16, popularity: 0.8 }),
  p({ id: 'entrecote', name: 'Entrecôte maturée 300 g', brand: 'Boucherie Prestige', category: 'boucherie', shape: 'tray', size: [0.2, 0.04, 0.14], color: 0x8e1b1b, color2: 0x2d3436, cost: 7.5, price: 12.9, cartonQty: 6, shelfLife: 5, storage: 'chilled', mass: 0.3, tier: 'premium', quality: 0.9, popularity: 0.3, theftAppeal: 0.9, unlock: 1 }),
  p({ id: 'saucisses', name: 'Saucisses de Toulouse x6', brand: 'Charcut\'Art', category: 'boucherie', shape: 'tray', size: [0.22, 0.04, 0.15], color: 0xc56a5a, color2: 0xf6b93b, cost: 2.6, price: 4.49, cartonQty: 8, shelfLife: 7, storage: 'chilled', mass: 0.45, popularity: 0.55 }),

  // ---------- Surgelés ----------
  p({ id: 'pizza_surg', name: 'Pizza 4 fromages surgelée', brand: 'Mamma Pazza', category: 'surgeles', shape: 'box', size: [0.3, 0.04, 0.3], color: 0xe58e26, color2: 0x079992, cost: 1.8, price: 3.29, cartonQty: 8, shelfLife: 0, storage: 'frozen', mass: 0.4, popularity: 0.75 }),
  p({ id: 'frites_surg', name: 'Frites allumettes 1 kg', brand: 'Patate Express', category: 'surgeles', shape: 'bag', size: [0.22, 0.3, 0.06], color: 0xfad390, color2: 0xe55039, cost: 1.1, price: 2.15, cartonQty: 10, shelfLife: 0, storage: 'frozen', mass: 1, popularity: 0.7 }),
  p({ id: 'glace', name: 'Glace vanille 1 L', brand: 'Brrr & Co', category: 'surgeles', shape: 'tube', size: [0.16, 0.1, 0.12], color: 0xfff3cd, color2: 0x8e44ad, cost: 1.9, price: 3.75, cartonQty: 8, shelfLife: 0, storage: 'frozen', mass: 0.6, popularity: 0.55 }),
  p({ id: 'poisson_pane', name: 'Poisson pané x10', brand: 'Capitaine Croustille', category: 'surgeles', shape: 'box', size: [0.2, 0.05, 0.14], color: 0x1e3799, color2: 0xf6b93b, cost: 2.0, price: 3.59, cartonQty: 12, shelfLife: 0, storage: 'frozen', mass: 0.5, popularity: 0.5 }),
  p({ id: 'legumes_surg', name: 'Poêlée de légumes 750 g', brand: 'Potager Gaulois', category: 'surgeles', shape: 'bag', size: [0.2, 0.28, 0.05], color: 0x38ada9, color2: 0xe55039, cost: 1.2, price: 2.29, cartonQty: 10, shelfLife: 0, storage: 'frozen', mass: 0.75, popularity: 0.45 }),

  // ---------- Boissons ----------
  p({ id: 'eau', name: 'Eau minérale 1,5 L', brand: 'Source du Quartier', category: 'boissons', shape: 'bottle', size: [0.09, 0.32, 0.09], color: 0xc7ecee, color2: 0x0abde3, cost: 0.18, price: 0.45, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 1.55, popularity: 0.9 }),
  p({ id: 'cola', name: 'Pschitt Cola 1,5 L', brand: 'Pschitt', category: 'boissons', shape: 'bottle', size: [0.09, 0.32, 0.09], color: 0x3d1e10, color2: 0xe84118, cost: 0.85, price: 1.79, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 1.6, popularity: 0.85, theftAppeal: 0.2 }),
  p({ id: 'canette', name: 'Canette Pschitt Cola 33 cl', brand: 'Pschitt', category: 'boissons', shape: 'can', size: [0.066, 0.12, 0.066], color: 0xe84118, color2: 0xffffff, cost: 0.32, price: 0.79, cartonQty: 24, shelfLife: 0, storage: 'ambient', mass: 0.35, popularity: 0.8, rolls: true, theftAppeal: 0.3 }),
  p({ id: 'jus_orange', name: 'Jus d\'orange 1 L', brand: 'Soleil du Sud', category: 'boissons', shape: 'carton', size: [0.08, 0.22, 0.06], color: 0xf39c12, color2: 0x27ae60, cost: 0.9, price: 1.85, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 1.05, popularity: 0.6 }),
  p({ id: 'biere', name: 'Bière blonde pack x6', brand: 'La Mousse du Coin', category: 'boissons', shape: 'pack', size: [0.2, 0.25, 0.14], color: 0xf6b93b, color2: 0x0c2461, cost: 3.2, price: 5.99, cartonQty: 4, shelfLife: 0, storage: 'ambient', mass: 2.2, popularity: 0.6, fragile: true, theftAppeal: 0.5 }),
  p({ id: 'vin', name: 'Vin rouge AOC Côtes-du-Bof', brand: 'Château Bof', category: 'boissons', shape: 'bottle', size: [0.08, 0.3, 0.08], color: 0x6f1e51, color2: 0xf8efba, cost: 3.1, price: 5.99, cartonQty: 6, shelfLife: 0, storage: 'ambient', mass: 1.3, fragile: true, popularity: 0.45, theftAppeal: 0.7 }),
  p({ id: 'champagne', name: 'Champagne brut', brand: 'Bulles de Prestige', category: 'boissons', shape: 'bottle', size: [0.09, 0.32, 0.09], color: 0x1e272e, color2: 0xf9ca24, cost: 14, price: 24.9, cartonQty: 6, shelfLife: 0, storage: 'ambient', mass: 1.6, fragile: true, tier: 'premium', quality: 0.9, popularity: 0.15, theftAppeal: 1, unlock: 1 }),
  p({ id: 'energy', name: 'Boisson énergisante 50 cl', brand: 'Taureau Furieux', category: 'boissons', shape: 'can', size: [0.066, 0.17, 0.066], color: 0x2c3e50, color2: 0x00d2d3, cost: 0.75, price: 1.69, cartonQty: 24, shelfLife: 0, storage: 'ambient', mass: 0.55, popularity: 0.55, rolls: true, theftAppeal: 0.4 }),

  // ---------- Petit-déjeuner ----------
  p({ id: 'cereales', name: 'Céréales Krispi-Boum', brand: 'Krispi', category: 'petitdej', shape: 'box', size: [0.2, 0.3, 0.07], color: 0xf1c40f, color2: 0xe74c3c, cost: 1.9, price: 3.49, cartonQty: 10, shelfLife: 0, storage: 'ambient', mass: 0.5, popularity: 0.7 }),
  p({ id: 'cafe', name: 'Café moulu 250 g', brand: 'Réveil Brutal', category: 'petitdej', shape: 'pack', size: [0.1, 0.16, 0.06], color: 0x4b2e1e, color2: 0xf39c12, cost: 2.0, price: 3.69, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.25, popularity: 0.8, theftAppeal: 0.5 }),
  p({ id: 'pate_tartiner', name: 'Pâte à tartiner 750 g', brand: 'Noisetta', category: 'petitdej', shape: 'jar', size: [0.1, 0.15, 0.1], color: 0x6d4c41, color2: 0xffffff, cost: 2.7, price: 4.59, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.85, fragile: true, popularity: 0.75, theftAppeal: 0.6 }),
  p({ id: 'confiture', name: 'Confiture de fraises', brand: 'Mamie Jojo', category: 'petitdej', shape: 'jar', size: [0.08, 0.11, 0.08], color: 0xc0392b, color2: 0xf5f6fa, cost: 1.4, price: 2.59, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.45, fragile: true, popularity: 0.45 }),
  p({ id: 'the', name: 'Thé vert x25 sachets', brand: 'Zénitude', category: 'petitdej', shape: 'box', size: [0.14, 0.07, 0.07], color: 0x78e08f, color2: 0x079992, cost: 1.3, price: 2.49, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.1, popularity: 0.35 }),

  // ---------- Confiserie ----------
  p({ id: 'chocolat', name: 'Tablette chocolat noir', brand: 'Cacao Furioso', category: 'confiserie', shape: 'box', size: [0.16, 0.015, 0.08], color: 0x3e2723, color2: 0xd4ac0d, cost: 0.95, price: 1.89, cartonQty: 20, shelfLife: 0, storage: 'ambient', mass: 0.1, popularity: 0.75, theftAppeal: 0.6 }),
  p({ id: 'bonbons', name: 'Bonbons Gélifolies', brand: 'Gélifolies', category: 'confiserie', shape: 'bag', size: [0.15, 0.2, 0.04], color: 0xff6b81, color2: 0x70a1ff, cost: 0.8, price: 1.75, cartonQty: 20, shelfLife: 0, storage: 'ambient', mass: 0.2, popularity: 0.6, theftAppeal: 0.5 }),
  p({ id: 'biscuits', name: 'Biscuits Petit Bazar', brand: 'BAZAR', category: 'confiserie', shape: 'box', size: [0.2, 0.05, 0.07], color: 0xf6e58d, color2: 0xe84118, cost: 0.6, price: 1.19, cartonQty: 20, shelfLife: 0, storage: 'ambient', mass: 0.2, tier: 'mdd', quality: 0.5, popularity: 0.6 }),
  p({ id: 'barres', name: 'Barres chocolatées x5', brand: 'Croquinette', category: 'confiserie', shape: 'pack', size: [0.16, 0.04, 0.1], color: 0x8e44ad, color2: 0xf1c40f, cost: 1.3, price: 2.39, cartonQty: 16, shelfLife: 0, storage: 'ambient', mass: 0.25, popularity: 0.6, theftAppeal: 0.55 }),

  // ---------- Snacks ----------
  p({ id: 'chips', name: 'Chips Krounch nature', brand: 'Krounch', category: 'snacks', shape: 'bag', size: [0.2, 0.28, 0.07], color: 0xfbc531, color2: 0xc23616, cost: 0.9, price: 1.99, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.15, popularity: 0.8 }),
  p({ id: 'cacahuetes', name: 'Cacahuètes grillées', brand: 'Apéro Royal', category: 'snacks', shape: 'can', size: [0.09, 0.12, 0.09], color: 0xa0522d, color2: 0xf1c40f, cost: 1.1, price: 2.29, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.3, popularity: 0.5, rolls: true }),
  p({ id: 'tuiles', name: 'Tuiles saveur paprika', brand: 'Krounch', category: 'snacks', shape: 'tube', size: [0.08, 0.24, 0.08], color: 0xe55039, color2: 0xf6b93b, cost: 1.0, price: 2.15, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.17, popularity: 0.55, rolls: true }),
  p({ id: 'sandwich', name: 'Sandwich jambon-beurre', brand: 'Le Dépanneur', category: 'snacks', shape: 'tray', size: [0.18, 0.06, 0.08], color: 0xf8efba, color2: 0xe58e26, cost: 1.5, price: 3.2, cartonQty: 10, shelfLife: 3, storage: 'chilled', mass: 0.2, popularity: 0.65 }),

  // ---------- Épicerie ----------
  p({ id: 'pates', name: 'Pâtes Ritournelle 500 g', brand: 'Ritournelle', category: 'epicerie', shape: 'bag', size: [0.12, 0.24, 0.05], color: 0xf9e79f, color2: 0x1e3799, cost: 0.55, price: 1.15, cartonQty: 20, shelfLife: 0, storage: 'ambient', mass: 0.5, popularity: 0.9 }),
  p({ id: 'pates_mdd', name: 'Pâtes Marque Bazar 500 g', brand: 'BAZAR', category: 'epicerie', shape: 'bag', size: [0.12, 0.24, 0.05], color: 0xfdf5e6, color2: 0xe84118, cost: 0.38, price: 0.79, cartonQty: 20, shelfLife: 0, storage: 'ambient', mass: 0.5, tier: 'mdd', quality: 0.45, popularity: 0.75 }),
  p({ id: 'riz', name: 'Riz long grain 1 kg', brand: 'Grain d\'Or', category: 'epicerie', shape: 'box', size: [0.14, 0.2, 0.06], color: 0xffffff, color2: 0xf39c12, cost: 1.1, price: 1.99, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 1, popularity: 0.7 }),
  p({ id: 'sauce_tomate', name: 'Sauce tomate basilic', brand: 'Mamma Pazza', category: 'epicerie', shape: 'jar', size: [0.08, 0.13, 0.08], color: 0xc0392b, color2: 0x27ae60, cost: 0.9, price: 1.79, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.5, fragile: true, popularity: 0.7 }),
  p({ id: 'thon', name: 'Thon au naturel', brand: 'Capitaine Croustille', category: 'epicerie', shape: 'can', size: [0.085, 0.04, 0.085], color: 0x0a3d62, color2: 0xe58e26, cost: 1.2, price: 2.29, cartonQty: 24, shelfLife: 0, storage: 'ambient', mass: 0.16, popularity: 0.65, theftAppeal: 0.3 }),
  p({ id: 'haricots', name: 'Haricots verts extra-fins', brand: 'Potager Gaulois', category: 'epicerie', shape: 'can', size: [0.075, 0.11, 0.075], color: 0x38ada9, color2: 0xf8efba, cost: 0.7, price: 1.39, cartonQty: 24, shelfLife: 0, storage: 'ambient', mass: 0.45, rolls: true, popularity: 0.5 }),
  p({ id: 'huile', name: 'Huile de tournesol 1 L', brand: 'Grain d\'Or', category: 'epicerie', shape: 'bottle', size: [0.08, 0.28, 0.08], color: 0xf6e58d, color2: 0xf0932b, cost: 1.3, price: 2.39, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.95, popularity: 0.55 }),
  p({ id: 'farine', name: 'Farine de blé T55 1 kg', brand: 'Moulin Moulu', category: 'epicerie', shape: 'pack', size: [0.12, 0.2, 0.07], color: 0xffffff, color2: 0x4a69bd, cost: 0.55, price: 1.05, cartonQty: 10, shelfLife: 0, storage: 'ambient', mass: 1, popularity: 0.45 }),
  p({ id: 'sucre', name: 'Sucre en poudre 1 kg', brand: 'Moulin Moulu', category: 'epicerie', shape: 'pack', size: [0.11, 0.17, 0.07], color: 0xffffff, color2: 0xe84393, cost: 0.75, price: 1.35, cartonQty: 10, shelfLife: 0, storage: 'ambient', mass: 1, popularity: 0.45 }),

  // ---------- Hygiène ----------
  p({ id: 'shampoing', name: 'Shampoing Crinière Folle', brand: 'Propr\'Ô', category: 'hygiene', shape: 'bottle', size: [0.08, 0.2, 0.05], color: 0x48dbfb, color2: 0xffffff, cost: 1.6, price: 3.29, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.3, popularity: 0.5, theftAppeal: 0.5 }),
  p({ id: 'dentifrice', name: 'Dentifrice Sourire Laser', brand: 'Propr\'Ô', category: 'hygiene', shape: 'box', size: [0.18, 0.04, 0.04], color: 0xffffff, color2: 0x0abde3, cost: 1.0, price: 2.19, cartonQty: 24, shelfLife: 0, storage: 'ambient', mass: 0.1, popularity: 0.55, theftAppeal: 0.4 }),
  p({ id: 'pq', name: 'Papier toilette x12', brand: 'Doux Nuage', category: 'hygiene', shape: 'pack', size: [0.3, 0.22, 0.2], color: 0xf5f6fa, color2: 0x74b9ff, cost: 2.6, price: 4.99, cartonQty: 4, shelfLife: 0, storage: 'ambient', mass: 1.2, popularity: 0.65 }),
  p({ id: 'gel_douche', name: 'Gel douche Fraîcheur Boréale', brand: 'Propr\'Ô', category: 'hygiene', shape: 'bottle', size: [0.07, 0.2, 0.04], color: 0x00d2d3, color2: 0x54a0ff, cost: 1.2, price: 2.49, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.3, popularity: 0.5 }),
  p({ id: 'rasoirs', name: 'Rasoirs 5 lames x4', brand: 'Tranchant+', category: 'hygiene', shape: 'box', size: [0.12, 0.18, 0.03], color: 0x2f3542, color2: 0xff4757, cost: 5.5, price: 10.9, cartonQty: 10, shelfLife: 0, storage: 'ambient', mass: 0.12, popularity: 0.3, theftAppeal: 1, unlock: 1 }),

  // ---------- Entretien ----------
  p({ id: 'lessive', name: 'Lessive Blanc-Bleu-Bof 2 L', brand: 'Blanc-Bleu-Bof', category: 'entretien', shape: 'bottle', size: [0.16, 0.26, 0.1], color: 0x1e90ff, color2: 0xffffff, cost: 4.0, price: 7.49, cartonQty: 6, shelfLife: 0, storage: 'ambient', mass: 2.1, popularity: 0.55, theftAppeal: 0.4 }),
  p({ id: 'liquide_vaisselle', name: 'Liquide vaisselle citron', brand: 'Propr\'Ô', category: 'entretien', shape: 'bottle', size: [0.07, 0.22, 0.04], color: 0xfff200, color2: 0x2ed573, cost: 0.8, price: 1.69, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.5, popularity: 0.5 }),
  p({ id: 'eponges', name: 'Éponges grattantes x4', brand: 'Frotte-Fort', category: 'entretien', shape: 'pack', size: [0.14, 0.04, 0.1], color: 0xfeca57, color2: 0x10ac84, cost: 0.6, price: 1.29, cartonQty: 20, shelfLife: 0, storage: 'ambient', mass: 0.05, popularity: 0.35 }),
  p({ id: 'sacs_poubelle', name: 'Sacs poubelle 30 L x20', brand: 'Frotte-Fort', category: 'entretien', shape: 'box', size: [0.12, 0.08, 0.08], color: 0x2d3436, color2: 0xfdcb6e, cost: 0.9, price: 1.99, cartonQty: 20, shelfLife: 0, storage: 'ambient', mass: 0.3, popularity: 0.4 }),

  // ---------- Boulangerie ----------
  p({ id: 'baguette', name: 'Baguette tradition', brand: 'Fournil du Quartier', category: 'boulangerie', shape: 'bread', size: [0.06, 0.06, 0.62], color: 0xd4a056, color2: 0xa0522d, cost: 0.32, price: 1.1, cartonQty: 20, shelfLife: 1, storage: 'ambient', mass: 0.25, popularity: 0.95 }),
  p({ id: 'croissants', name: 'Croissants pur beurre x4', brand: 'Fournil du Quartier', category: 'boulangerie', shape: 'tray', size: [0.2, 0.08, 0.14], color: 0xe1b12c, color2: 0xffffff, cost: 1.2, price: 2.9, cartonQty: 10, shelfLife: 2, storage: 'ambient', mass: 0.25, popularity: 0.6 }),
  p({ id: 'pain_mie', name: 'Pain de mie complet', brand: 'Moelleux & Fils', category: 'boulangerie', shape: 'bag', size: [0.12, 0.12, 0.26], color: 0xc8a165, color2: 0xe84118, cost: 0.9, price: 1.89, cartonQty: 10, shelfLife: 7, storage: 'ambient', mass: 0.5, popularity: 0.6 }),

  // ---------- Local ----------
  p({ id: 'miel', name: 'Miel des toits de la cité', brand: 'Ruche des Tilleuls', category: 'local', shape: 'jar', size: [0.08, 0.1, 0.08], color: 0xf9ca24, color2: 0x6ab04c, cost: 4.2, price: 7.9, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.5, fragile: true, tier: 'local', quality: 0.9, popularity: 0.3, theftAppeal: 0.6 }),
  p({ id: 'cidre', name: 'Cidre fermier brut', brand: 'Ferme du Talus', category: 'local', shape: 'bottle', size: [0.08, 0.3, 0.08], color: 0xd1a14a, color2: 0x2d5016, cost: 2.4, price: 4.5, cartonQty: 6, shelfLife: 0, storage: 'ambient', mass: 1.2, fragile: true, tier: 'local', quality: 0.85, popularity: 0.3 }),
  p({ id: 'fromage_chevre', name: 'Crottin de chèvre fermier', brand: 'Ferme du Talus', category: 'local', shape: 'tube', size: [0.07, 0.04, 0.07], color: 0xf7f1e3, color2: 0x6ab04c, cost: 1.6, price: 3.2, cartonQty: 12, shelfLife: 14, storage: 'chilled', mass: 0.1, tier: 'local', quality: 0.9, popularity: 0.3 }),
  p({ id: 'terrine', name: 'Terrine de campagne artisanale', brand: 'Charcuterie Dédé', category: 'local', shape: 'jar', size: [0.1, 0.07, 0.1], color: 0x8d6e63, color2: 0xffeaa7, cost: 2.8, price: 5.4, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.35, fragile: true, tier: 'local', quality: 0.85, popularity: 0.25, unlock: 1 }),

  // ---------- Saisonnier ----------
  p({ id: 'buche', name: 'Bûche glacée de Noël', brand: 'Brrr & Co', category: 'saison', shape: 'box', size: [0.3, 0.1, 0.12], color: 0xffffff, color2: 0xc0392b, cost: 4.5, price: 8.9, cartonQty: 6, shelfLife: 0, storage: 'frozen', mass: 0.8, seasonal: 'noel', popularity: 0.6 }),
  p({ id: 'chocolats_noel', name: 'Ballotin de chocolats', brand: 'Cacao Furioso', category: 'saison', shape: 'box', size: [0.18, 0.05, 0.12], color: 0xc0392b, color2: 0xf9ca24, cost: 4, price: 7.9, cartonQty: 10, shelfLife: 0, storage: 'ambient', mass: 0.3, seasonal: 'noel', popularity: 0.6, theftAppeal: 0.7 }),
  p({ id: 'charbon', name: 'Charbon de bois BBQ 5 kg', brand: 'Braise Party', category: 'saison', shape: 'pack', size: [0.3, 0.4, 0.12], color: 0x2d3436, color2: 0xe17055, cost: 3.5, price: 6.9, cartonQty: 4, shelfLife: 0, storage: 'ambient', mass: 5, seasonal: 'ete', popularity: 0.5 }),
  p({ id: 'cahiers', name: 'Cahiers grands carreaux x3', brand: 'Papeterie Plume', category: 'saison', shape: 'pack', size: [0.21, 0.03, 0.3], color: 0x0984e3, color2: 0xfdcb6e, cost: 1.6, price: 3.49, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.6, seasonal: 'rentree', popularity: 0.55 }),
  p({ id: 'bonbons_halloween', name: 'Bonbons d\'Halloween', brand: 'Gélifolies', category: 'saison', shape: 'bag', size: [0.2, 0.25, 0.05], color: 0xe17055, color2: 0x2d3436, cost: 1.4, price: 2.99, cartonQty: 12, shelfLife: 0, storage: 'ambient', mass: 0.4, seasonal: 'halloween', popularity: 0.6 }),
  p({ id: 'parapluie', name: 'Parapluie pliant', brand: 'Goutte-Stop', category: 'saison', shape: 'tube', size: [0.06, 0.3, 0.06], color: 0x2c3e50, color2: 0xf1c40f, cost: 3.2, price: 7.5, cartonQty: 8, shelfLife: 0, storage: 'ambient', mass: 0.35, seasonal: 'hiver', popularity: 0.25, theftAppeal: 0.5 }),
  p({ id: 'oeufs_choco', name: 'Œufs en chocolat', brand: 'Cacao Furioso', category: 'saison', shape: 'egg', size: [0.12, 0.1, 0.08], color: 0x6d4c41, color2: 0xf8a5c2, cost: 2.5, price: 4.9, cartonQty: 10, shelfLife: 0, storage: 'ambient', mass: 0.2, seasonal: 'paques', fragile: true, popularity: 0.5 }),
];

export const PRODUCT_BY_ID: Record<string, ProductDef> = Object.fromEntries(PRODUCTS.map((x) => [x.id, x]));

export const productsInCategory = (c: CategoryId) => PRODUCTS.filter((x) => x.category === c);

/** Prix final arrondi façon grande distribution (x,x9). */
export function psychologicalPrice(v: number): number {
  if (v < 1) return Math.max(0.05, Math.round(v * 20) / 20 - 0.01);
  return Math.max(0.09, Math.round(v * 10) / 10 - 0.01);
}
