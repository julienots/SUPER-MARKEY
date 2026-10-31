/**
 * Mobilier fabriqué avec Blender (public/models/equipment.glb) : un modèle par équipement, matériaux par rôle
 * (frame = couleur des rayons du magasin, accent = couleur d'enseigne, light/screen = lumières coupées en cas de panne).
 */
import * as THREE from 'three';
import { getKit } from '../models/kit';

const fixed: Record<string, { color: number; rough: number; metal?: number; opacity?: number; emissive?: number }> = {
  board: { color: 0xeef0f3, rough: 0.45, metal: 0.15 },
  plinth: { color: 0x40454d, rough: 0.6 },
  rail: { color: 0xfafafa, rough: 0.5 },
  wood: { color: 0xa0703f, rough: 0.8 },
  woodlight: { color: 0xd2a56c, rough: 0.8 },
  wicker: { color: 0xc89b5c, rough: 0.9 },
  white: { color: 0xf3f4f6, rough: 0.4 },
  interior: { color: 0xd4e2ee, rough: 0.5 },
  dark: { color: 0x24272c, rough: 0.5 },
  metal: { color: 0xbcc2c8, rough: 0.3, metal: 0.8 },
  rubber: { color: 0x17181a, rough: 0.9 },
  glass: { color: 0xc6e2ff, rough: 0.05, opacity: 0.22 },
  blue: { color: 0x0b74d9, rough: 0.5 },
  rack_blue: { color: 0x2a62cc, rough: 0.5, metal: 0.3 },
  rack_orange: { color: 0xf2801a, rough: 0.5, metal: 0.2 },
  red: { color: 0xd92626, rough: 0.5 },
  yellow: { color: 0xffd12a, rough: 0.5 },
  green: { color: 0x2e8c4d, rough: 0.8 },
  leaf: { color: 0x3f9e4d, rough: 0.7 },
  pot: { color: 0xb86b4d, rough: 0.8 },
  paper: { color: 0xffd933, rough: 0.8 },
  light: { color: 0xfff6e0, rough: 0.4, emissive: 1.4 },
  screen: { color: 0x33bfd9, rough: 0.2, emissive: 1.0 },
  pink: { color: 0xff4fd8, rough: 0.3, emissive: 1.6 },
};

const cache = new Map<string, THREE.MeshStandardMaterial>();

function roleMaterial(role: string, frame: number, accent: number, lit: boolean, lights: THREE.MeshStandardMaterial[]) {
  const emissiveRole = !!fixed[role]?.emissive;
  const key = role === 'frame' ? `frame:${frame}` : role === 'accent' ? `accent:${accent}` : emissiveRole ? `${role}:${lit}` : role;
  let m = cache.get(key);
  if (!m) {
    const f = fixed[role] ?? { color: 0xcccccc, rough: 0.6 };
    const color = role === 'frame' ? frame : role === 'accent' ? accent : f.color;
    m = new THREE.MeshStandardMaterial({ color, roughness: f.rough, metalness: f.metal ?? 0 });
    if (f.opacity !== undefined) {
      m.transparent = true;
      m.opacity = f.opacity;
      m.depthWrite = false;
    }
    if (f.emissive) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = lit ? f.emissive : 0;
    }
    cache.set(key, m);
  }
  if (emissiveRole && !lights.includes(m)) lights.push(m);
  return m;
}

/** Modèle Blender d'un équipement, ou null s'il n'existe pas dans le kit. */
export function kitEquipment(def: string, style: { shelfColor: number; accent: number }, lit: boolean, lights: THREE.MeshStandardMaterial[]): THREE.Group | null {
  const pieces = getKit('equipment')?.get(`equip__${def}`);
  if (!pieces) return null;
  const g = new THREE.Group();
  for (const p of pieces) {
    const m = new THREE.Mesh(p.geo, roleMaterial(p.role, style.shelfColor, style.accent, lit, lights));
    m.castShadow = p.role !== 'glass' && p.role !== 'light';
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
