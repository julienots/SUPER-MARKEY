/**
 * Définitions des équipements plaçables. La géométrie 3D est construite par world/equipmentMeshes.ts
 * à partir de `id`; tout le reste (coût, emprise, rayonnages, consommation...) est ici.
 */
import type { StorageClass } from './products';

export const CELL = 0.5; // taille d'une case de la grille de construction (m)

export type EquipCategory =
  | 'rayon'
  | 'froid'
  | 'caisse'
  | 'reserve'
  | 'securite'
  | 'personnel'
  | 'service'
  | 'deco'
  | 'eclairage';

export type Zone = 'sales' | 'backroom' | 'any';
export type Mount = 'floor' | 'wall' | 'ceiling';

export interface ShelfLayout {
  /** Hauteurs (m) des tablettes. */
  levels: number[];
  /** Hauteur libre au-dessus de chaque tablette (m). */
  clearance: number[];
  /** Nombre de facings par niveau et par face. */
  facings: number;
  sides: 1 | 2;
  /** Profondeur utile d'une face (m). */
  depth: number;
  storage: StorageClass;
  /** Produits autorisés (catégories) — undefined = toutes celles compatibles avec le stockage. */
  categories?: string[];
  /** Présentoir en pyramide physique (tête de gondole). */
  pile?: boolean;
}

export interface EquipmentDef {
  id: string;
  name: string;
  desc: string;
  category: EquipCategory;
  price: number;
  /** Emprise en cases (avant rotation). */
  w: number;
  d: number;
  /** Hauteur (m) — sert aux occlusions des caméras et à la vision des agents. */
  h: number;
  zone: Zone;
  mount: Mount;
  shelf?: ShelfLayout;
  /** Consommation électrique (kW) en fonctionnement. */
  power: number;
  /** Fonctionne 24 h/24 (froid). */
  alwaysOn?: boolean;
  maintenance: number;
  /** Capacité en cartons (réserve). */
  cartons?: number;
  ambiance?: number;
  security?: number;
  /** Palier d'agrandissement minimum pour débloquer. */
  stage?: number;
  /** Ne bloque pas la navigation (tapis, caméras...). */
  passable?: boolean;
  hotkey?: string;
}

const shelfLevels = (n: number, base: number, top: number) => {
  const lv: number[] = [];
  for (let i = 0; i < n; i++) lv.push(base + ((top - base) * i) / Math.max(1, n - 1));
  const cl = lv.map((v, i) => (i < n - 1 ? lv[i + 1] - v - 0.03 : 0.42));
  return { levels: lv, clearance: cl };
};

export const EQUIPMENT: EquipmentDef[] = [
  // ----- Rayons -----
  {
    id: 'gondole_simple', name: 'Gondole murale', desc: 'Rayonnage métallique 2 m, 5 tablettes, une face. Idéal contre un mur.',
    category: 'rayon', price: 420, w: 4, d: 1, h: 1.9, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.3,
    shelf: { ...shelfLevels(5, 0.12, 1.5), facings: 4, sides: 1, depth: 0.42, storage: 'ambient' },
  },
  {
    id: 'gondole_double', name: 'Gondole double face', desc: 'Îlot central 2 m, 4 tablettes par face. Le pilier du supermarché.',
    category: 'rayon', price: 690, w: 4, d: 2, h: 1.6, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.4,
    shelf: { ...shelfLevels(4, 0.12, 1.2), facings: 4, sides: 2, depth: 0.42, storage: 'ambient' },
  },
  {
    id: 'gondole_basse', name: 'Gondole basse', desc: 'Rayon bas (1,2 m) qui ne bloque pas la vue des caméras.',
    category: 'rayon', price: 380, w: 4, d: 2, h: 1.15, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.3,
    shelf: { ...shelfLevels(3, 0.12, 0.8), facings: 3, sides: 2, depth: 0.42, storage: 'ambient' },
  },
  {
    id: 'etal_fruits', name: 'Étal fruits & légumes', desc: 'Cagettes inclinées en bois. Les clients adorent tâter les avocats.',
    category: 'rayon', price: 520, w: 4, d: 2, h: 1.0, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.4,
    shelf: { levels: [0.55, 0.85], clearance: [0.25, 0.3], facings: 3, sides: 2, depth: 0.42, storage: 'ambient', categories: ['fruits', 'local'] },
  },
  {
    id: 'bac_pain', name: 'Corbeilles à pain', desc: 'Présentoir boulangerie en osier. Sent bon (en théorie).',
    category: 'rayon', price: 340, w: 3, d: 2, h: 1.4, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.2,
    shelf: { levels: [0.5, 0.95], clearance: [0.4, 0.45], facings: 2, sides: 1, depth: 0.7, storage: 'ambient', categories: ['boulangerie'] },
  },
  {
    id: 'tete_gondole', name: 'Présentoir promo (pyramide)', desc: 'Pyramide de produits en équilibre précaire. Attire l’œil… et les catastrophes.',
    category: 'rayon', price: 260, w: 2, d: 2, h: 1.0, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.1, ambiance: 1,
    shelf: { levels: [0.35], clearance: [0.6], facings: 1, sides: 1, depth: 0.8, storage: 'ambient', pile: true },
  },
  // ----- Froid -----
  {
    id: 'frigo_vitre', name: 'Armoire réfrigérée vitrée', desc: 'Froid positif 2-4 °C. Portes vitrées, éclairage LED. Consomme 24 h/24.',
    category: 'froid', price: 1650, w: 4, d: 2, h: 2.05, zone: 'sales', mount: 'floor', power: 1.4, alwaysOn: true, maintenance: 1.2,
    shelf: { ...shelfLevels(5, 0.2, 1.55), facings: 4, sides: 1, depth: 0.55, storage: 'chilled' },
  },
  {
    id: 'frigo_mural', name: 'Meuble froid ouvert', desc: 'Froid positif ouvert, accès direct. Plus de ventes, plus de consommation.',
    category: 'froid', price: 1350, w: 4, d: 2, h: 1.95, zone: 'sales', mount: 'floor', power: 2.0, alwaysOn: true, maintenance: 1.0,
    shelf: { ...shelfLevels(4, 0.35, 1.45), facings: 4, sides: 1, depth: 0.6, storage: 'chilled' },
  },
  {
    id: 'congelateur', name: 'Congélateur coffre', desc: 'Froid négatif −18 °C, couvercles coulissants.',
    category: 'froid', price: 1250, w: 4, d: 2, h: 0.9, zone: 'sales', mount: 'floor', power: 1.1, alwaysOn: true, maintenance: 1.0,
    shelf: { levels: [0.3, 0.55], clearance: [0.24, 0.3], facings: 3, sides: 1, depth: 0.75, storage: 'frozen' },
  },
  // ----- Caisses -----
  {
    id: 'caisse', name: 'Caisse avec tapis', desc: 'Tapis roulant, scanner et tiroir-caisse. Nécessite un caissier (ou vous).',
    category: 'caisse', price: 2400, w: 6, d: 2, h: 1.1, zone: 'sales', mount: 'floor', power: 0.3, maintenance: 0.8,
  },
  {
    id: 'caisse_auto', name: 'Caisse automatique', desc: 'Les clients scannent eux-mêmes. Rapide, mais « article inattendu dans la zone d’ensachage ».',
    category: 'caisse', price: 5200, w: 2, d: 2, h: 1.4, zone: 'sales', mount: 'floor', power: 0.25, maintenance: 1.5, stage: 1,
  },
  // ----- Réserve -----
  {
    id: 'rack_reserve', name: 'Rack de réserve', desc: 'Rayonnage lourd pour 24 cartons.',
    category: 'reserve', price: 350, w: 4, d: 2, h: 2.2, zone: 'backroom', mount: 'floor', power: 0, maintenance: 0.1, cartons: 24,
  },
  {
    id: 'chambre_froide', name: 'Chambre froide', desc: 'Stockage réfrigéré de 30 cartons. Indispensable pour le frais.',
    category: 'reserve', price: 3900, w: 4, d: 4, h: 2.4, zone: 'backroom', mount: 'floor', power: 1.8, alwaysOn: true, maintenance: 1.5, cartons: 30, stage: 0,
  },
  // ----- Sécurité -----
  {
    id: 'camera', name: 'Caméra de surveillance', desc: 'Dôme HD, 90° de champ, 14 m de portée. Les angles morts existent.',
    category: 'securite', price: 280, w: 1, d: 1, h: 0.2, zone: 'any', mount: 'ceiling', power: 0.02, alwaysOn: true, maintenance: 0.1, security: 2, passable: true,
  },
  {
    id: 'ecran_secu', name: 'Poste de surveillance', desc: 'Bureau avec moniteurs. Un agent posté ici repère les vols sur les caméras.',
    category: 'securite', price: 950, w: 3, d: 2, h: 1.3, zone: 'any', mount: 'floor', power: 0.2, maintenance: 0.3, security: 2,
  },
  {
    id: 'portique', name: 'Portique antivol', desc: 'Sonne quand un article étiqueté passe sans être payé (ou quand Gérard passe avec ses clés).',
    category: 'securite', price: 1300, w: 1, d: 1, h: 1.6, zone: 'sales', mount: 'floor', power: 0.05, alwaysOn: true, maintenance: 0.2, security: 3,
  },
  {
    id: 'detecteur', name: 'Détecteur de mouvement', desc: 'Relié à l’alarme : détecte les intrusions nocturnes.',
    category: 'securite', price: 180, w: 1, d: 1, h: 0.2, zone: 'any', mount: 'ceiling', power: 0.01, alwaysOn: true, maintenance: 0.05, security: 1, passable: true,
  },
  {
    id: 'vitrine_secu', name: 'Vitrine sécurisée', desc: 'Vitrine fermée à clé pour les articles de valeur. Vol quasi impossible.',
    category: 'securite', price: 900, w: 2, d: 2, h: 1.7, zone: 'sales', mount: 'floor', power: 0.05, maintenance: 0.2, security: 2,
    shelf: { ...shelfLevels(3, 0.4, 1.2), facings: 2, sides: 1, depth: 0.35, storage: 'ambient' },
  },
  {
    id: 'coffre', name: 'Coffre-fort', desc: 'La recette du jour y est déposée à la fermeture. Les cambrioleurs détestent.',
    category: 'securite', price: 1100, w: 1, d: 1, h: 1.0, zone: 'backroom', mount: 'floor', power: 0, maintenance: 0, security: 2,
  },
  // ----- Personnel -----
  {
    id: 'bureau', name: 'Bureau du gérant', desc: 'Permet l’embauche d’un manager et augmente l’efficacité administrative.',
    category: 'personnel', price: 600, w: 3, d: 2, h: 1.2, zone: 'backroom', mount: 'floor', power: 0.1, maintenance: 0.1,
  },
  {
    id: 'casiers', name: 'Vestiaire & casiers', desc: 'Le personnel se change ici. +moral.',
    category: 'personnel', price: 320, w: 3, d: 1, h: 1.9, zone: 'backroom', mount: 'floor', power: 0, maintenance: 0.05,
  },
  {
    id: 'salle_pause', name: 'Coin pause (table + machine à café)', desc: 'Les employés récupèrent leur fatigue ici. Sans ça, ils récupèrent… sur vos clients.',
    category: 'personnel', price: 540, w: 3, d: 3, h: 1.6, zone: 'backroom', mount: 'floor', power: 0.4, maintenance: 0.2,
  },
  // ----- Services -----
  {
    id: 'toilettes', name: 'Toilettes', desc: 'Cabine sanitaire. Améliore la satisfaction… et crée du nettoyage.',
    category: 'service', price: 1800, w: 3, d: 3, h: 2.3, zone: 'any', mount: 'floor', power: 0.1, maintenance: 0.5,
  },
  {
    id: 'paniers', name: 'Pile de paniers', desc: 'Sans panier, les clients achètent moins (ils n’ont que deux mains).',
    category: 'service', price: 90, w: 1, d: 1, h: 0.6, zone: 'sales', mount: 'floor', power: 0, maintenance: 0,
  },
  {
    id: 'caddies', name: 'Range-caddies', desc: 'Les familles prennent un chariot : paniers plus gros, collisions plus drôles.',
    category: 'service', price: 650, w: 4, d: 2, h: 1.1, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.2,
  },
  {
    id: 'poubelle', name: 'Poubelle', desc: 'Réduit les salissures dans le magasin.',
    category: 'service', price: 60, w: 1, d: 1, h: 0.9, zone: 'any', mount: 'floor', power: 0, maintenance: 0.05,
  },
  {
    id: 'extincteur', name: 'Extincteur', desc: 'Obligatoire lors des inspections de sécurité (1 pour 100 m²).',
    category: 'service', price: 75, w: 1, d: 1, h: 0.7, zone: 'any', mount: 'floor', power: 0, maintenance: 0.02, passable: false,
  },
  {
    id: 'panneau_rayon', name: 'Panneau de rayon suspendu', desc: 'Les clients trouvent les produits plus vite.',
    category: 'service', price: 45, w: 1, d: 1, h: 0.3, zone: 'sales', mount: 'ceiling', power: 0, maintenance: 0, passable: true, ambiance: 1,
  },
  {
    id: 'cafe_client', name: 'Machine à café clients', desc: 'Petit café à 1 €. Les habitués adorent.',
    category: 'service', price: 900, w: 1, d: 1, h: 1.7, zone: 'sales', mount: 'floor', power: 0.3, maintenance: 0.3, ambiance: 2, stage: 1,
  },
  // ----- Déco & éclairage -----
  {
    id: 'plante', name: 'Plante verte', desc: 'Un ficus. Il ne juge personne.',
    category: 'deco', price: 55, w: 1, d: 1, h: 1.4, zone: 'any', mount: 'floor', power: 0, maintenance: 0.05, ambiance: 1,
  },
  {
    id: 'affiche', name: 'Affiche promotionnelle', desc: 'Grande affiche murale. Booste l’envie d’acheter les produits en promo.',
    category: 'deco', price: 40, w: 2, d: 1, h: 1.6, zone: 'sales', mount: 'wall', power: 0, maintenance: 0, ambiance: 1, passable: true,
  },
  {
    id: 'ballons', name: 'Grappe de ballons', desc: 'Effet fête foraine garanti. Gonflés à l’hélium et à l’optimisme.',
    category: 'deco', price: 35, w: 1, d: 1, h: 2.2, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.2, ambiance: 2, passable: true,
  },
  {
    id: 'tapis', name: 'Tapis d’entrée', desc: 'Réduit la saleté apportée par les chaussures les jours de pluie.',
    category: 'deco', price: 80, w: 4, d: 2, h: 0.02, zone: 'sales', mount: 'floor', power: 0, maintenance: 0.05, passable: true,
  },
  {
    id: 'spot', name: 'Spot LED suspendu', desc: 'Éclairage d’accentuation. Un magasin lumineux est plus sûr et plus agréable.',
    category: 'eclairage', price: 120, w: 1, d: 1, h: 0.3, zone: 'any', mount: 'ceiling', power: 0.05, maintenance: 0.02, ambiance: 1, passable: true, security: 0.5,
  },
  {
    id: 'neon', name: 'Néon publicitaire', desc: 'Néon coloré « OUVERT ». Visible depuis la rue, il attire les passants.',
    category: 'eclairage', price: 300, w: 2, d: 1, h: 0.6, zone: 'sales', mount: 'wall', power: 0.08, maintenance: 0.1, ambiance: 2, passable: true,
  },
];

export const EQUIPMENT_BY_ID: Record<string, EquipmentDef> = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));

export const EQUIP_CATEGORY_NAMES: Record<EquipCategory, string> = {
  rayon: 'Rayons',
  froid: 'Froid',
  caisse: 'Caisses',
  reserve: 'Réserve',
  securite: 'Sécurité',
  personnel: 'Personnel',
  service: 'Services',
  deco: 'Déco',
  eclairage: 'Éclairage',
};

/** Améliorations non placées (achats ponctuels). */
export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  daily?: number;
  stage?: number;
  category: 'securite' | 'gestion' | 'paiement' | 'batiment';
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'portes_renforcees', name: 'Portes & serrures renforcées', desc: 'Les cambrioleurs mettent 3× plus de temps à forcer les accès.', price: 2200, category: 'securite' },
  { id: 'eclairage_ext', name: 'Éclairage extérieur', desc: 'Parking et arrière-cour éclairés la nuit : moins de rôdeurs, moins d’effractions.', price: 1400, daily: 1.5, category: 'securite' },
  { id: 'alarme', name: 'Centrale d’alarme', desc: 'Sirène + armement à la fermeture. Nécessite des détecteurs.', price: 1600, daily: 0.5, category: 'securite' },
  { id: 'telesurveillance', name: 'Télésurveillance 24/7', desc: 'Une société appelle la police dès que l’alarme sonne.', price: 300, daily: 6, category: 'securite' },
  { id: 'antivol_tags', name: 'Étiquettes antivol', desc: 'Les articles de valeur sont étiquetés : les portiques les détectent.', price: 600, daily: 1, category: 'securite' },
  { id: 'logiciel_stock', name: 'Logiciel de gestion de stock', desc: 'Active le réapprovisionnement automatique des commandes (seuils configurables).', price: 1800, daily: 3, category: 'gestion' },
  { id: 'tpe', name: 'Terminal de paiement sans contact', desc: 'Paiements plus rapides en caisse (-30 % de temps d’encaissement).', price: 450, daily: 0.8, category: 'paiement' },
  { id: 'carte_fidelite', name: 'Programme carte de fidélité', desc: 'Les clients inscrits reçoivent 5 % de remise et reviennent plus souvent.', price: 900, daily: 2, category: 'gestion' },
  { id: 'climatisation', name: 'Climatisation', desc: 'Confort l’été : clients plus patients, produits mieux conservés.', price: 3500, daily: 4, category: 'batiment' },
  { id: 'portes_auto', name: 'Portes automatiques premium', desc: 'Accueil fluide, image moderne (+ambiance).', price: 2800, category: 'batiment' },
  { id: 'groupe_electrogene', name: 'Groupe électrogène', desc: 'En cas de coupure de courant, le froid et les caisses continuent de fonctionner.', price: 4200, daily: 1, category: 'batiment' },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
