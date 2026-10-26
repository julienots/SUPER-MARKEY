/** Cache de matériaux et petits utilitaires de construction de meshes. */
import * as THREE from 'three';

const mats = new Map<string, THREE.Material>();

export interface MatOpts {
  rough?: number;
  metal?: number;
  map?: THREE.Texture | null;
  emissive?: number;
  emissiveIntensity?: number;
  emissiveMap?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  key?: string;
  flat?: boolean;
  /** Surface posée sur une autre (sol, marquage…) : priorité de profondeur, sans scintillement. */
  layer?: number;
}

export function mat(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = o.key ?? `${color}:${o.rough ?? 0.7}:${o.metal ?? 0}:${o.map?.uuid ?? ''}:${o.emissive ?? ''}:${o.emissiveIntensity ?? ''}:${o.emissiveMap?.uuid ?? ''}:${o.transparent ?? ''}:${o.opacity ?? ''}:${o.side ?? ''}:${o.flat ?? ''}:${o.layer ?? ''}`;
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.7,
      metalness: o.metal ?? 0,
      map: o.map ?? null,
      emissive: o.emissive !== undefined ? new THREE.Color(o.emissive) : new THREE.Color(0),
      emissiveIntensity: o.emissiveIntensity ?? 1,
      emissiveMap: o.emissiveMap ?? null,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
      flatShading: o.flat ?? false,
    });
    if (o.layer) decal(m, o.layer);
    mats.set(key, m);
  }
  return m;
}

/**
 * Décalage de profondeur pour les surfaces superposées (routes, marquages, sols, panneaux au plafond) :
 * évite le scintillement / les bandes en escalier sur les GPU mobiles à faible précision de profondeur.
 */
export function decal<T extends THREE.Material>(m: T, layer: number): T {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -layer;
  m.polygonOffsetUnits = -layer * 2;
  return m;
}

export const glassMat = () => mat(0xbfe3ff, { rough: 0.05, metal: 0.1, transparent: true, opacity: 0.22, key: 'glass' });
export const metalMat = (c = 0xb8bec6) => mat(c, { rough: 0.35, metal: 0.75 });

const geoCache = new Map<string, THREE.BufferGeometry>();
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const k = `b:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}
export function cylGeo(rt: number, rb: number, h: number, seg = 16): THREE.BufferGeometry {
  const k = `c:${rt}:${rb}:${h}:${seg}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.CylinderGeometry(rt, rb, h, seg)));
  return g;
}
export function sphereGeo(r: number, seg = 12): THREE.BufferGeometry {
  const k = `s:${r}:${seg}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.66))));
  return g;
}

/** Ajoute une boîte (coin bas centré en x,z) à un groupe. */
export function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, cast = true, receive = true): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

export function cyl(parent: THREE.Object3D, r: number, h: number, x: number, y: number, z: number, m: THREE.Material, seg = 16, cast = true): THREE.Mesh {
  const mesh = new THREE.Mesh(cylGeo(r, r, h, seg), m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function plane(parent: THREE.Object3D, w: number, h: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  parent.add(mesh);
  return mesh;
}

/** Libère récursivement les géométries non partagées d'un objet. */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry && !(m.geometry as any).__shared && !geoCacheHas(m.geometry)) m.geometry.dispose();
  });
}
const geoCacheHas = (g: THREE.BufferGeometry) => {
  for (const v of geoCache.values()) if (v === g) return true;
  return false;
};
