/**
 * Chargement des modèles 3D :
 *  - equipment.glb : mobilier de supérette (Blender, matériaux recolorés par rôle) ;
 *  - city.glb / props.glb : packs KayKit (CC0), avec leur texture ;
 *  - people/*.glb : personnages animés Quaternius (CC0), animations partagées par sexe.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const base = './models/';

const equip = new Map<string, { role: string; geo: THREE.BufferGeometry }[]>();
const kits = new Map<string, Map<string, THREE.Object3D>>();
const people = new Map<string, GLTF>();
const clips: Record<'f' | 'm', Map<string, THREE.AnimationClip>> = { f: new Map(), m: new Map() };

const ROLE: Record<string, { color: number; rough: number; metal?: number; opacity?: number; emissive?: number }> = {
  frame: { color: 0xf4f1ea, rough: 0.5, metal: 0.1 },
  accent: { color: 0xff6a2b, rough: 0.5 },
  board: { color: 0xeef0f3, rough: 0.45, metal: 0.15 },
  plinth: { color: 0x40454d, rough: 0.6 },
  rail: { color: 0xfafafa, rough: 0.5 },
  wood: { color: 0xa0703f, rough: 0.8 },
  woodlight: { color: 0xd2a56c, rough: 0.8 },
  wicker: { color: 0xc89b5c, rough: 0.9 },
  white: { color: 0xf3f4f6, rough: 0.4 },
  interior: { color: 0xd4e2ee, rough: 0.5 },
  dark: { color: 0x2c3036, rough: 0.5 },
  metal: { color: 0xbcc2c8, rough: 0.3, metal: 0.7 },
  rubber: { color: 0x17181a, rough: 0.9 },
  glass: { color: 0xc6e2ff, rough: 0.05, opacity: 0.22 },
  blue: { color: 0x2f86e0, rough: 0.5 },
  rack_blue: { color: 0x2a62cc, rough: 0.5, metal: 0.3 },
  rack_orange: { color: 0xf2801a, rough: 0.5, metal: 0.2 },
  red: { color: 0xe23b3b, rough: 0.5 },
  yellow: { color: 0xffd12a, rough: 0.5 },
  green: { color: 0x2e8c4d, rough: 0.8 },
  leaf: { color: 0x48b058, rough: 0.7 },
  pot: { color: 0xc87a55, rough: 0.8 },
  paper: { color: 0xffd933, rough: 0.8 },
  light: { color: 0xfff6e0, rough: 0.4, emissive: 1.2 },
  screen: { color: 0x33bfd9, rough: 0.2, emissive: 0.9 },
  pink: { color: 0xff4fd8, rough: 0.3, emissive: 1.4 },
};
const roleMats = new Map<string, THREE.MeshStandardMaterial>();
function roleMat(role: string) {
  let m = roleMats.get(role);
  if (!m) {
    const r = ROLE[role] ?? { color: 0xcccccc, rough: 0.6 };
    m = new THREE.MeshStandardMaterial({ color: r.color, roughness: r.rough, metalness: r.metal ?? 0 });
    if (r.opacity !== undefined) {
      m.transparent = true;
      m.opacity = r.opacity;
      m.depthWrite = false;
    }
    if (r.emissive) {
      m.emissive = new THREE.Color(r.color);
      m.emissiveIntensity = r.emissive;
    }
    roleMats.set(role, m);
  }
  return m;
}

async function loadEquip() {
  const g = await loader.loadAsync(base + 'equipment.glb');
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const par = m.parent;
    const name = par && par !== g.scene && par.name && m.name.startsWith(par.name) ? par.name : m.name.replace(/_\d+$/, '');
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    const role = (Array.isArray(m.material) ? m.material[0] : m.material).name || 'default';
    const list = equip.get(name) ?? [];
    list.push({ role, geo });
    equip.set(name, list);
  });
}

async function loadKit(name: string) {
  const g = await loader.loadAsync(base + name + '.glb');
  const map = new Map<string, THREE.Object3D>();
  for (const c of g.scene.children) {
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.roughness = Math.max(0.6, mat.roughness);
        mat.metalness = 0;
      }
    });
    map.set(c.name, c);
  }
  kits.set(name, map);
}

export let PEOPLE_LIST: string[] = [];

async function loadPeople(onProgress?: () => void) {
  PEOPLE_LIST = await (await fetch(base + 'people/list.json')).json();
  await Promise.all(
    PEOPLE_LIST.map(async (n) => {
      const g = await loader.loadAsync(base + `people/${n}.glb`);
      g.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.frustumCulled = false;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mt of mats as THREE.MeshStandardMaterial[]) {
            mt.roughness = 0.75;
            mt.metalness = 0;
          }
        }
      });
      people.set(n, g);
      for (const c of g.animations) clips[n[0] as 'f' | 'm'].set(c.name, c);
      onProgress?.();
    }),
  );
}

export async function loadAssets(onProgress?: (k: number) => void) {
  let done = 0;
  const total = 3 + 13;
  const tick = () => onProgress?.(++done / total);
  await Promise.all([loadEquip().then(tick), loadKit('city').then(tick), loadKit('props').then(tick), loadPeople(tick)]);
}

/** Meuble Blender (groupe de maillages), ou null. */
export function equipModel(name: string): THREE.Group | null {
  const pieces = equip.get(`equip__${name}`);
  if (!pieces) return null;
  const g = new THREE.Group();
  for (const p of pieces) {
    const m = new THREE.Mesh(p.geo, roleMat(p.role));
    m.castShadow = p.role !== 'glass' && p.role !== 'light';
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/** Modèle KayKit (copie partageant géométrie et matériaux). */
export function kitModel(kit: 'city' | 'props', name: string): THREE.Object3D | null {
  const o = kits.get(kit)?.get(name);
  return o ? o.clone(true) : null;
}

/** Taille d'un modèle KayKit (boîte englobante). */
export function kitSize(kit: 'city' | 'props', name: string) {
  const o = kits.get(kit)?.get(name);
  if (!o) return new THREE.Vector3(1, 1, 1);
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}

export function personModel(name: string): { root: THREE.Object3D; clips: Map<string, THREE.AnimationClip> } {
  const g = people.get(name) ?? people.values().next().value!;
  const root = cloneSkinned(g.scene);
  return { root, clips: clips[(people.has(name) ? name : PEOPLE_LIST[0])[0] as 'f' | 'm'] };
}
