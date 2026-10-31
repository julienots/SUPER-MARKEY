/**
 * Modèles fabriqués avec Blender (scripts dans blender/, exportés en GLB dans public/models/).
 * Chargement unique ; chaque pièce est conservée comme liste de géométries par rôle de matériau
 * (le jeu recolore les rôles : peau, haut, cadre de rayon…).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface KitPiece {
  role: string;
  geo: THREE.BufferGeometry;
}

/** Nom de pièce → géométries par rôle. */
export type Kit = Map<string, KitPiece[]>;

const kits = new Map<string, Kit>();

async function loadKit(url: string): Promise<Kit> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const out: Kit = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // un objet Blender à plusieurs matériaux devient un groupe de maillages : le nom est celui du parent
    const par = m.parent;
    const name = par && par !== gltf.scene && par.name && m.name.startsWith(par.name) ? par.name : m.name.replace(/_\d+$/, (x) => (m.name.slice(0, -x.length).includes('__') ? '' : x));
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    const role = (Array.isArray(m.material) ? m.material[0] : m.material).name || 'default';
    const list = out.get(name) ?? [];
    list.push({ role, geo });
    out.set(name, list);
  });
  return out;
}

/** Charge les kits (personnages, mobilier, accessoires). Renvoie false si un fichier manque. */
export async function loadModels(base = './models/'): Promise<boolean> {
  try {
    const [chars] = await Promise.all([loadKit(base + 'characters.glb')]);
    kits.set('characters', chars);
    try {
      kits.set('equipment', await loadKit(base + 'equipment.glb'));
    } catch {
      /* mobilier facultatif */
    }
    try {
      kits.set('props', await loadKit(base + 'props.glb'));
    } catch {
      /* accessoires facultatifs */
    }
    return true;
  } catch (e) {
    console.warn('[modèles] chargement impossible', e);
    return false;
  }
}

export const getKit = (name: string): Kit | undefined => kits.get(name);
export const modelsReady = () => kits.has('characters');
