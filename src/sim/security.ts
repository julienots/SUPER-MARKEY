/**
 * Sécurité : couverture réelle des caméras (lancer de rayons sur la grille avec occlusion par les meubles hauts),
 * dissuasion, détection des vols, risque d'effraction nocturne.
 */
import { CELL, EQUIPMENT_BY_ID } from '../data/equipment';
import { clamp, clamp01 } from '../core/math';
import { cellsOf, equipCenter, GRID_D, GRID_W, GRID_X0, GRID_Z0, rotAngle, storeRect, WALL_H } from './layout';
import type { GameState, PlacedEquip } from './state';

export const CAM_RANGE = 14;
export const CAM_FOV = (100 * Math.PI) / 180;
export const CAM_HEIGHT = WALL_H - 0.35;

/** Hauteur d'obstacle par case de la grille du magasin (pour l'occlusion). */
export function heightGrid(st: GameState): Float32Array {
  const hg = new Float32Array(GRID_W * GRID_D);
  for (const e of st.equipment) {
    const d = EQUIPMENT_BY_ID[e.def];
    if (d.mount !== 'floor') continue;
    for (const [gx, gz] of cellsOf(e)) if (gx >= 0 && gz >= 0 && gx < GRID_W && gz < GRID_D) hg[gz * GRID_W + gx] = Math.max(hg[gz * GRID_W + gx], d.h);
  }
  // mur de la réserve (cloison)
  const r = storeRect(st.store.stage);
  const bz = Math.floor((r.backZ - GRID_Z0) / CELL);
  for (let gx = 0; gx < GRID_W; gx++) {
    const x = GRID_X0 + (gx + 0.5) * CELL;
    if (x < r.x0 || x > r.x1) continue;
    if (Math.abs(x - r.staffDoorX) < 0.8) continue;
    if (bz >= 0 && bz < GRID_D) hg[bz * GRID_W + gx] = WALL_H;
  }
  return hg;
}

export interface CameraView {
  uid: number;
  x: number;
  z: number;
  dir: number; // angle (rad) monde, 0 = +z
}

export function cameraViews(st: GameState): CameraView[] {
  return st.equipment
    .filter((e) => e.def === 'camera' && !e.broken)
    .map((e) => {
      const c = equipCenter(e);
      return { uid: e.uid, x: c.x, z: c.z, dir: rotAngle(e.rot) };
    });
}

/**
 * Vrai si le point (x, z) à hauteur `targetH` est visible depuis la caméra :
 * dans le cône, à portée, et sans meuble plus haut que le rayon entre les deux.
 */
export function cameraSees(cam: CameraView, x: number, z: number, hg: Float32Array, targetH = 1.0, rect?: { x0: number; x1: number; z0: number; z1: number }): boolean {
  const dx = x - cam.x;
  const dz = z - cam.z;
  const d = Math.hypot(dx, dz);
  if (d > CAM_RANGE) return false;
  if (d > 0.3) {
    const ang = Math.atan2(dx, dz);
    let diff = ang - cam.dir;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > CAM_FOV / 2) return false;
  }
  if (rect && (x < rect.x0 || x > rect.x1 || z < rect.z0 || z > rect.z1)) return false;
  const steps = Math.ceil(d / (CELL * 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = cam.x + dx * t;
    const pz = cam.z + dz * t;
    const gx = Math.floor((px - GRID_X0) / CELL);
    const gz = Math.floor((pz - GRID_Z0) / CELL);
    if (gx < 0 || gz < 0 || gx >= GRID_W || gz >= GRID_D) continue;
    const h = hg[gz * GRID_W + gx];
    if (h <= 0) continue;
    const rayH = CAM_HEIGHT + (targetH - CAM_HEIGHT) * t;
    if (h > rayH) return false;
  }
  return true;
}

/** Grille de couverture (nombre de caméras voyant chaque case) pour l'affichage des angles morts. */
export function coverageGrid(st: GameState): { grid: Uint8Array; covered: number; total: number } {
  const hg = heightGrid(st);
  const cams = cameraViews(st);
  const r = storeRect(st.store.stage);
  const grid = new Uint8Array(GRID_W * GRID_D);
  let covered = 0;
  let total = 0;
  for (let gz = 0; gz < GRID_D; gz++)
    for (let gx = 0; gx < GRID_W; gx++) {
      const x = GRID_X0 + (gx + 0.5) * CELL;
      const z = GRID_Z0 + (gz + 0.5) * CELL;
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      if (hg[gz * GRID_W + gx] > 1.2) continue; // case occupée par un meuble haut
      total++;
      let n = 0;
      for (const c of cams) if (cameraSees(c, x, z, hg, 1.0, r)) n++;
      grid[gz * GRID_W + gx] = Math.min(255, n);
      if (n) covered++;
    }
  return { grid, covered, total };
}

/** Une caméra filme-t-elle ce point ? (version rapide avec cache de la grille de hauteurs) */
export class CameraIndex {
  private hg: Float32Array;
  private cams: CameraView[];
  private rect: ReturnType<typeof storeRect>;
  constructor(st: GameState) {
    this.hg = heightGrid(st);
    this.cams = cameraViews(st);
    this.rect = storeRect(st.store.stage);
  }
  sees(x: number, z: number): boolean {
    for (const c of this.cams) if (cameraSees(c, x, z, this.hg, 1.0, this.rect)) return true;
    return false;
  }
  get count() {
    return this.cams.length;
  }
  get heights() {
    return this.hg;
  }
}

/** Le poste de surveillance est-il tenu par un agent ? (calculé par le runtime) */
export interface WatchContext {
  monitorStaffed: boolean;
  /** Vigilance de l'agent au poste (0..1). */
  monitorVigilance: number;
}

/** Probabilité qu'un vol filmé soit repéré en direct. */
export function liveDetectionChance(onCamera: boolean, w: WatchContext): number {
  if (!onCamera || !w.monitorStaffed) return 0;
  return clamp01(0.35 + w.monitorVigilance * 0.5);
}

/** Valeur de dissuasion perçue par un voleur potentiel (0..1). */
export function deterrence(st: GameState, guards: number, cams: number): number {
  const lights = st.equipment.filter((e) => e.def === 'spot').length;
  const gates = st.equipment.filter((e) => e.def === 'portique').length;
  return clamp01(cams * 0.06 + guards * 0.22 + gates * 0.1 + lights * 0.01 + (st.store.lightLevel - 1) * 0.15);
}

/** Risque d'effraction pour la nuit (0..1). */
export function burglaryRisk(st: GameState, nightGuard: boolean): number {
  const q = st.quartiers.find((x) => x.id === 'centre')!;
  const value = Math.min(1, (st.equipment.reduce((a, e) => a + (e.till ?? 0), 0) + 4000) / 20000);
  let risk = 0.05 + (1 - q.safety) * 0.12 + value * 0.06;
  if (st.store.upgrades['eclairage_ext']) risk *= 0.6;
  if (st.store.upgrades['portes_renforcees']) risk *= 0.55;
  if (st.store.upgrades['alarme'] && st.store.alarmArmed && st.equipment.some((e) => e.def === 'detecteur')) risk *= 0.6;
  if (st.store.upgrades['telesurveillance']) risk *= 0.8;
  if (cameraViews(st).length > 2) risk *= 0.85;
  if (nightGuard) risk *= 0.25;
  if (st.flags.refusedDeal) risk *= 1.3; // pression du « réseau » après un refus (fiction)
  if (st.difficulty === 'facile') risk *= 0.5;
  if (st.difficulty === 'enfer') risk *= 1.6;
  return clamp(risk, 0, 0.5);
}

/** Les détecteurs couvrent-ils la zone d'entrée des cambrioleurs ? */
export function detectorsCover(st: GameState, x: number, z: number): boolean {
  return st.equipment.some((e) => {
    if (e.def !== 'detecteur' || e.broken) return false;
    const c = equipCenter(e);
    return Math.hypot(c.x - x, c.z - z) < 11;
  });
}

export const isCash = (e: PlacedEquip) => e.def === 'caisse' || e.def === 'caisse_auto';
