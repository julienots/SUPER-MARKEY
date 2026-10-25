/** Styles de magasin et matériaux personnalisables. */
export interface FloorStyle { id: string; name: string; base: number; alt: number; pattern: 'tiles' | 'checker' | 'wood' | 'concrete' | 'terrazzo'; price: number }
export interface WallStyle { id: string; name: string; color: number; accent: number; price: number }

export const FLOORS: FloorStyle[] = [
  { id: 'carrelage', name: 'Carrelage blanc', base: 0xe8e6e1, alt: 0xd6d3cc, pattern: 'tiles', price: 0 },
  { id: 'damier', name: 'Damier rétro', base: 0xf2efe6, alt: 0x2d3436, pattern: 'checker', price: 900 },
  { id: 'parquet', name: 'Parquet chêne', base: 0xb08355, alt: 0x8b6239, pattern: 'wood', price: 1600 },
  { id: 'beton', name: 'Béton ciré', base: 0x9a9a96, alt: 0x8a8a86, pattern: 'concrete', price: 700 },
  { id: 'terrazzo', name: 'Terrazzo moucheté', base: 0xdcd6cc, alt: 0x9c8f80, pattern: 'terrazzo', price: 1400 },
];

export const WALLS: WallStyle[] = [
  { id: 'blanc', name: 'Blanc cassé', color: 0xf1ede4, accent: 0xe84118, price: 0 },
  { id: 'jaune', name: 'Jaune promo', color: 0xffe08a, accent: 0xe84118, price: 400 },
  { id: 'vert', name: 'Vert épicerie', color: 0xc8e6c9, accent: 0x2e7d32, price: 400 },
  { id: 'bleu', name: 'Bleu frais', color: 0xcfe3f5, accent: 0x1565c0, price: 400 },
  { id: 'brique', name: 'Brique loft', color: 0xb5654a, accent: 0x2d3436, price: 1200 },
  { id: 'noir', name: 'Noir chic', color: 0x2f2f33, accent: 0xffc72c, price: 900 },
];

export interface StylePreset { id: string; name: string; desc: string; floor: string; wall: string; shelfColor: number; light: number; uniform: number; signBg: number; signFg: number }
export const STYLE_PRESETS: StylePreset[] = [
  { id: 'superette', name: 'Supérette de quartier', desc: 'Simple, efficace, néons blafards.', floor: 'carrelage', wall: 'blanc', shelfColor: 0xdfe4ea, light: 0xf4f7ff, uniform: 0xe84118, signBg: 0xe84118, signFg: 0xffffff },
  { id: 'discount', name: 'Discount', desc: 'Béton, palettes et prix en gros.', floor: 'beton', wall: 'jaune', shelfColor: 0xb2bec3, light: 0xffffff, uniform: 0xfdcb6e, signBg: 0xffd32a, signFg: 0x1e272e },
  { id: 'moderne', name: 'Magasin moderne', desc: 'Lignes épurées et lumière chaude.', floor: 'terrazzo', wall: 'bleu', shelfColor: 0xf5f6fa, light: 0xfff4e0, uniform: 0x0984e3, signBg: 0x0c2461, signFg: 0xffffff },
  { id: 'epicerie_fine', name: 'Épicerie haut de gamme', desc: 'Parquet, noir mat et produits du terroir.', floor: 'parquet', wall: 'noir', shelfColor: 0x2d3436, light: 0xffe2b8, uniform: 0x2d3436, signBg: 0x1e1e1e, signFg: 0xffc72c },
  { id: 'familial', name: 'Supermarché familial', desc: 'Couleurs gaies, damier et bonne humeur.', floor: 'damier', wall: 'vert', shelfColor: 0xffffff, light: 0xfffaf0, uniform: 0x27ae60, signBg: 0x27ae60, signFg: 0xffffff },
  { id: 'grande_surface', name: 'Grande surface', desc: 'Volume, efficacité, bip bip.', floor: 'carrelage', wall: 'blanc', shelfColor: 0xc8d6e5, light: 0xffffff, uniform: 0x2e86de, signBg: 0x2e86de, signFg: 0xffffff },
];

export const MUSIC_STYLES = [
  { id: 'muzak', name: 'Muzak d’ascenseur' },
  { id: 'lofi', name: 'Lo-fi « courses studieuses »' },
  { id: 'accordeon', name: 'Accordéon de marché' },
  { id: 'disco', name: 'Disco promo' },
  { id: 'aucune', name: 'Silence monacal' },
] as const;
export type MusicStyle = (typeof MUSIC_STYLES)[number]['id'];

export const LOGO_ICONS = ['cart', 'flame', 'star', 'bag', 'basket', 'crown', 'bolt', 'heart', 'devil', 'leaf'] as const;
export type LogoIcon = (typeof LOGO_ICONS)[number];
