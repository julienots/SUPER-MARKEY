/**
 * Plan du quartier (données pures) : routes, trottoirs, bâtiments, parkings.
 * Partagé par le rendu 3D (world/city.ts), la navigation et la simulation des habitants.
 */
import type { QuartierId } from '../sim/state';

export type Rect = [number, number, number, number]; // x0, z0, x1, z1

export interface RoadDef {
  rect: Rect;
  axis: 'x' | 'z';
  name: string;
}

export interface BuildingDef {
  id: string;
  kind: 'immeuble' | 'maison' | 'commerce' | 'stade' | 'garage' | 'gymnase';
  rect: Rect;
  floors: number;
  color: number;
  roof?: number;
  quartier: QuartierId;
  name?: string;
  /** Porte d'entrée (monde) : point de départ/retour des habitants. */
  door: [number, number];
  /** Façade côté porte : direction de la rue. */
  face: 'n' | 's' | 'e' | 'w';
  sign?: { text: string; bg: number; fg: number };
  households: number;
}

export const ROADS: RoadDef[] = [
  { rect: [-100, -24, 100, -16], axis: 'x', name: 'Avenue Jean-Jaurès' },
  { rect: [-44, -70, -36, 48], axis: 'z', name: 'Rue des Tilleuls' },
  { rect: [52, -70, 60, 48], axis: 'z', name: 'Allée des Coteaux' },
  { rect: [-44, 42, 60, 48], axis: 'x', name: 'Rue du Stade' },
];

export const SIDEWALKS: Rect[] = [
  [-100, -16, -44, -13.5], [-36, -16, 52, -13.5], [60, -16, 100, -13.5],
  [-100, -26.5, -44, -24], [-36, -26.5, 52, -24], [60, -26.5, 100, -24],
  [-46.5, -70, -44, -26.5], [-46.5, -13.5, -44, 50.5], [-36, -70, -33.5, -26.5], [-36, -13.5, -33.5, 42],
  [49.5, -70, 52, -26.5], [49.5, -13.5, 52, 42], [60, -70, 62.5, -26.5], [60, -13.5, 62.5, 50.5],
  [-33.5, 39.5, 49.5, 42], [-46.5, 48, 62.5, 50.5],
];

export const CROSSWALKS: Rect[] = [
  [20, -24, 23, -16], [-6, -24, -3, -16], [-33, -24, -30, -16], [46, -24, 49, -16],
  [-44, -29.5, -36, -26.5], [52, -29.5, 60, -26.5], [-44, -13.5, -36, -10.5], [52, -13.5, 60, -10.5],
  [8, 42, 11, 48],
];

/** Parcelle du joueur. */
export const PLAYER_LOT: Rect = [-12, -13.5, 36, 39.5];
export const PLAYER_PARKING: Rect = [-12, -13.5, 16, -2];
export const PARKING_EXT: Rect = [16, -13.5, 36, -2];
/** Zone de livraison derrière le magasin (accès par la rue du Stade). */
export const DOCK_YARD: Rect = [-12, 28, 16, 39.5];
export const BUS_STOP: [number, number] = [27, -14.6];

const B = (b: Omit<BuildingDef, 'households'> & { households?: number }): BuildingDef => ({ households: b.kind === 'immeuble' ? b.floors * 4 : b.kind === 'maison' ? 1 : 0, ...b });

export const BUILDINGS: BuildingDef[] = [
  // ---- Cité des Tilleuls (sud-ouest) ----
  B({ id: 'til1', kind: 'immeuble', rect: [-96, -66, -60, -56], floors: 9, color: 0xd9cbb5, quartier: 'tilleuls', door: [-78, -55.5], face: 'n', name: 'Bâtiment A' }),
  B({ id: 'til2', kind: 'immeuble', rect: [-96, -48, -78, -32], floors: 11, color: 0xc9b9a3, quartier: 'tilleuls', door: [-87, -31.5], face: 'n', name: 'Tour Jacques-Brel' }),
  B({ id: 'til3', kind: 'immeuble', rect: [-70, -48, -50, -36], floors: 7, color: 0xe2d3bf, quartier: 'tilleuls', door: [-60, -35.5], face: 'n', name: 'Bâtiment C' }),
  B({ id: 'til4', kind: 'immeuble', rect: [-30, -66, -4, -56], floors: 8, color: 0xd1c4b0, quartier: 'tilleuls', door: [-17, -55.5], face: 'n', name: 'Bâtiment D' }),
  B({ id: 'til5', kind: 'immeuble', rect: [-30, -46, -16, -32], floors: 10, color: 0xbfae98, quartier: 'tilleuls', door: [-23, -31.5], face: 'n', name: 'Tour Simone-Veil' }),
  B({ id: 'til6', kind: 'immeuble', rect: [36, -66, 46, -36], floors: 6, color: 0xd6c8b4, quartier: 'tilleuls', door: [35.5, -51], face: 'w', name: 'Résidence du Parc' }),
  // ---- Centre (commerces en rez-de-chaussée + logements) ----
  B({ id: 'c1', kind: 'commerce', rect: [-33, -11, -26, -1], floors: 4, color: 0xe8d9b0, quartier: 'centre', door: [-29.5, -11.5], face: 's', sign: { text: 'BOULANGERIE', bg: 0x8d5524, fg: 0xffe7b3 }, households: 6 }),
  B({ id: 'c2', kind: 'commerce', rect: [-25.5, -11, -19.5, -1], floors: 4, color: 0xf0e4c8, quartier: 'centre', door: [-22.5, -11.5], face: 's', sign: { text: 'PHARMACIE', bg: 0x27ae60, fg: 0xffffff }, households: 6 }),
  B({ id: 'c3', kind: 'commerce', rect: [-19, -11, -13, -1], floors: 3, color: 0xdcc7a1, quartier: 'centre', door: [-16, -11.5], face: 's', sign: { text: 'TABAC-PRESSE', bg: 0xc0392b, fg: 0xffffff }, households: 4 }),
  B({ id: 'c4', kind: 'immeuble', rect: [-33, 4, -15, 16], floors: 5, color: 0xe5d5c0, quartier: 'centre', door: [-24, 3.5], face: 's', name: 'Résidence Les Lilas' }),
  B({ id: 'c5', kind: 'immeuble', rect: [-33, 22, -15, 36], floors: 4, color: 0xd8c3a5, quartier: 'centre', door: [-24, 21.5], face: 's', name: 'Résidence Pasteur' }),
  B({ id: 'c6', kind: 'commerce', rect: [38, -11, 47, -1], floors: 4, color: 0xead6b8, quartier: 'centre', door: [42.5, -11.5], face: 's', sign: { text: 'LAVERIE', bg: 0x2980b9, fg: 0xffffff }, households: 6 }),
  B({ id: 'c7', kind: 'immeuble', rect: [38, 4, 48, 34], floors: 5, color: 0xcdb99c, quartier: 'centre', door: [37.5, 19], face: 'w', name: 'Les Terrasses' }),
  B({ id: 'c8', kind: 'commerce', rect: [-14, -46, -6, -36], floors: 2, color: 0xe0c9a6, quartier: 'tilleuls', door: [-10, -35.5], face: 'n', sign: { text: 'GRILL', bg: 0xe67e22, fg: 0xffffff }, households: 2 }),
  B({ id: 'c9', kind: 'commerce', rect: [-66, -11, -63, -3], floors: 3, color: 0xe3d1b5, quartier: 'centre', door: [-64.5, -11.5], face: 's', sign: { text: 'COIFFURE', bg: 0x8e44ad, fg: 0xffffff }, households: 3 }),
  B({ id: 'garage', kind: 'garage', rect: [17, 1, 31, 27], floors: 1, color: 0x9e9a92, quartier: 'centre', door: [24, 0.5], face: 's', name: 'Ancien garage', households: 0 }),
  // ---- Stade (nord) ----
  B({ id: 'stade', kind: 'stade', rect: [-30, 54, 12, 70], floors: 2, color: 0xbdc3c7, quartier: 'stade', door: [-9, 53.5], face: 's', name: 'Stade Municipal Raymond-Kopa', households: 0 }),
  B({ id: 'gym', kind: 'gymnase', rect: [16, 60, 40, 70], floors: 2, color: 0xa4b0be, quartier: 'stade', door: [28, 59.5], face: 's', name: 'Gymnase', households: 0 }),
  B({ id: 's1', kind: 'immeuble', rect: [-100, 52, -76, 62], floors: 6, color: 0xd7ccc8, quartier: 'stade', door: [-88, 51.5], face: 's' }),
  B({ id: 's2', kind: 'immeuble', rect: [-70, 52, -50, 64], floors: 5, color: 0xcfc2bd, quartier: 'stade', door: [-60, 51.5], face: 's' }),
  B({ id: 's3', kind: 'immeuble', rect: [44, 52, 50, 68], floors: 4, color: 0xd1c7b7, quartier: 'stade', door: [43.5, 60], face: 'w' }),
];

// ---- Les Coteaux : maisons individuelles (générées en grille) ----
let hid = 0;
const houseColors = [0xf5e6ca, 0xfaf3e0, 0xe8d8c4, 0xf0e0d0, 0xdfe6e9, 0xffeaa7, 0xfab1a0];
const roofColors = [0x8b3a2b, 0x6d4c41, 0x5d4037, 0x7f2b1f, 0x455a64];
for (let gx = 0; gx < 3; gx++)
  for (let gz = 0; gz < 5; gz++) {
    const x0 = 66 + gx * 11.5;
    const z0 = 4 + gz * 13;
    if (z0 + 9 > 41) continue;
    BUILDINGS.push(
      B({ id: `h${hid}`, kind: 'maison', rect: [x0, z0, x0 + 8, z0 + 8], floors: 2, color: houseColors[hid % houseColors.length], roof: roofColors[hid % roofColors.length], quartier: 'coteaux', door: [x0 - 0.6, z0 + 4], face: 'w', households: 1 }),
    );
    hid++;
  }
for (let gx = 0; gx < 3; gx++)
  for (let gz = 0; gz < 2; gz++) {
    const x0 = 66 + gx * 11.5;
    const z0 = -66 + gz * 13;
    BUILDINGS.push(
      B({ id: `h${hid}`, kind: 'maison', rect: [x0, z0, x0 + 8, z0 + 8], floors: 2, color: houseColors[hid % houseColors.length], roof: roofColors[hid % roofColors.length], quartier: 'coteaux', door: [x0 - 0.6, z0 + 4], face: 'w', households: 1 }),
    );
    hid++;
  }
// maisons plus modestes près du stade
for (let i = 0; i < 4; i++) {
  const x0 = 16 + i * 6.5;
  BUILDINGS.push(B({ id: `h${hid++}`, kind: 'maison', rect: [x0, 52, x0 + 5, 57], floors: 2, color: houseColors[i], roof: roofColors[i], quartier: 'stade', door: [x0 + 2.5, 51.5], face: 's', households: 1 }));
}

/** Points d'entrée/sortie de la carte pour les passants et les véhicules. */
export const EDGE_POINTS: [number, number][] = [
  [-99, -14.8], [99, -14.8], [-99, -25.2], [99, -25.2], [-45.2, -69], [-34.8, -69], [50.8, -69], [61.2, -69], [-45.2, 49], [61.2, 49],
];

export const QUARTIER_INFO: Record<QuartierId, { name: string; prosperity: number; safety: number }> = {
  tilleuls: { name: 'Cité des Tilleuls', prosperity: 0.3, safety: 0.45 },
  centre: { name: 'Centre-ville', prosperity: 0.5, safety: 0.65 },
  coteaux: { name: 'Les Coteaux', prosperity: 0.85, safety: 0.85 },
  stade: { name: 'Quartier du Stade', prosperity: 0.45, safety: 0.6 },
};

/** Zones « sensibles » où des rôdeurs peuvent traîner la nuit (fiction de gameplay). */
export const LOITER_SPOTS: [number, number][] = [
  [-10.5, -6], [34, -4], [-10.5, 32], [-40, -30], [-34, -34], [12, 36],
];

export const STREET_LAMPS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let x = -96; x <= 96; x += 16) {
    if (Math.abs(x + 40) < 6 || Math.abs(x - 56) < 6) continue;
    out.push([x, -13.9], [x + 8, -26.1]);
  }
  for (let z = -64; z <= 40; z += 16) {
    if (Math.abs(z + 20) < 8) continue;
    out.push([-46.1, z], [-33.9, z + 8], [49.9, z], [62.1, z + 8]);
  }
  return out;
})();
