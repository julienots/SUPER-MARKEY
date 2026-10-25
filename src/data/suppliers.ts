import type { CategoryId } from './products';

export interface SupplierDef {
  id: string;
  name: string;
  desc: string;
  categories: CategoryId[] | 'all';
  /** Multiplicateur appliqué au coût d'achat de référence. */
  priceFactor: number;
  /** Délai de livraison (heures de jeu). */
  leadHours: number;
  /** Probabilité de livrer à l'heure. */
  reliability: number;
  deliveryFee: number;
  minOrder: number;
  /** Remise sur volume : seuil en cartons → remise. */
  bulk: { cartons: number; discount: number }[];
  /** Fournisseur débloqué à partir de ce palier. */
  stage?: number;
  /** Qualité perçue (impacte la satisfaction sur le frais). */
  freshness: number;
}

export const SUPPLIERS: SupplierDef[] = [
  {
    id: 'grossiste', name: 'Grossiste Rapido Cash', desc: 'Généraliste fiable, prix moyens. Livre en 6 h.',
    categories: 'all', priceFactor: 1.0, leadHours: 6, reliability: 0.92, deliveryFee: 35, minOrder: 60,
    bulk: [{ cartons: 20, discount: 0.03 }, { cartons: 50, discount: 0.06 }], freshness: 0.6,
  },
  {
    id: 'discount', name: 'Destock’ Mania', desc: 'Prix cassés, mais retards fréquents et cartons cabossés.',
    categories: ['epicerie', 'boissons', 'confiserie', 'snacks', 'hygiene', 'entretien', 'petitdej', 'surgeles', 'saison'],
    priceFactor: 0.86, leadHours: 14, reliability: 0.7, deliveryFee: 20, minOrder: 120,
    bulk: [{ cartons: 30, discount: 0.04 }, { cartons: 80, discount: 0.08 }], freshness: 0.4,
  },
  {
    id: 'primeur', name: 'Primeurs du MIN', desc: 'Fruits, légumes et boulangerie ultra frais livrés à l’aube.',
    categories: ['fruits', 'boulangerie'], priceFactor: 0.95, leadHours: 4, reliability: 0.95, deliveryFee: 25, minOrder: 30,
    bulk: [{ cartons: 15, discount: 0.04 }], freshness: 0.9,
  },
  {
    id: 'froid', name: 'FrigoLogistique', desc: 'Spécialiste du frais et du surgelé, chaîne du froid irréprochable.',
    categories: ['cremerie', 'boucherie', 'surgeles', 'snacks'], priceFactor: 1.02, leadHours: 5, reliability: 0.96, deliveryFee: 40, minOrder: 50,
    bulk: [{ cartons: 20, discount: 0.04 }, { cartons: 40, discount: 0.07 }], freshness: 0.85,
  },
  {
    id: 'terroir', name: 'Coopérative Terroir & Talus', desc: 'Producteurs locaux. Plus cher, mais les clients adorent.',
    categories: ['local', 'fruits', 'cremerie'], priceFactor: 1.12, leadHours: 10, reliability: 0.88, deliveryFee: 15, minOrder: 25,
    bulk: [{ cartons: 10, discount: 0.03 }], stage: 0, freshness: 0.95,
  },
  {
    id: 'centrale', name: 'Centrale d’achat Hyper-Union', desc: 'Prix de grande surface pour les gros volumes. Réservé aux magasins agrandis.',
    categories: 'all', priceFactor: 0.82, leadHours: 18, reliability: 0.9, deliveryFee: 90, minOrder: 400,
    bulk: [{ cartons: 60, discount: 0.04 }, { cartons: 150, discount: 0.09 }], stage: 2, freshness: 0.7,
  },
];

export const SUPPLIER_BY_ID: Record<string, SupplierDef> = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s]));

export const supplierSells = (s: SupplierDef, cat: CategoryId) => s.categories === 'all' || s.categories.includes(cat);
