export type RoleId = 'caissier' | 'rayon' | 'logisticien' | 'entretien' | 'securite' | 'manager';

export interface RoleDef {
  id: RoleId;
  name: string;
  icon: string;
  baseWage: number; // €/heure
  desc: string;
  requires?: string; // équipement requis
}

export const ROLES: RoleDef[] = [
  { id: 'caissier', name: 'Caissier·ère', icon: '🧾', baseWage: 12.5, desc: 'Tient une caisse, scanne les articles, gère les remboursements.' },
  { id: 'rayon', name: 'Employé·e de rayon', icon: '📦', baseWage: 12.2, desc: 'Remplit les rayons depuis la réserve, ramasse les produits tombés, retire les périmés.' },
  { id: 'logisticien', name: 'Logisticien·ne', icon: '🚚', baseWage: 13, desc: 'Décharge les livraisons et range la réserve. Gère les commandes automatiques.' },
  { id: 'entretien', name: 'Agent·e d’entretien', icon: '🧹', baseWage: 11.9, desc: 'Nettoie les salissures, les toilettes et les tags.' },
  { id: 'securite', name: 'Agent·e de sécurité', icon: '🛡️', baseWage: 14, desc: 'Surveille une zone ou le poste vidéo, interpelle les voleurs.' },
  { id: 'manager', name: 'Manager', icon: '👔', baseWage: 19, desc: 'Motive l’équipe, calme les clients, ouvre des caisses en renfort.', requires: 'bureau' },
];

export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, RoleDef>;

export const TRAITS = [
  { id: 'zele', name: 'Zélé', desc: 'Prend son travail BEAUCOUP trop au sérieux.' },
  { id: 'bavard', name: 'Bavard', desc: 'Discute avec tous les clients. Service +, vitesse −.' },
  { id: 'maladroit', name: 'Maladroit', desc: 'Fait tomber des produits plus souvent.' },
  { id: 'ponctuel', name: 'Ponctuel', desc: 'Jamais en retard, jamais absent.' },
  { id: 'rapide', name: 'Rapide', desc: 'Travaille vite, parfois trop.' },
  { id: 'calme', name: 'Calme olympien', desc: 'Les clients énervés se calment à son contact.' },
  { id: 'flemme', name: 'Économie d’énergie', desc: 'Pauses fréquentes, efficacité discutable.' },
  { id: 'oeil', name: 'Œil de lynx', desc: 'Repère les vols à 20 mètres.' },
] as const;
export type TraitId = (typeof TRAITS)[number]['id'];
