/**
 * Vignettes des meubles pour la boutique : chaque modèle Blender est rendu une fois dans une petite scène
 * (fond transparent, éclairage studio, vue 3/4), puis mis en cache sous forme d'image.
 */
import * as THREE from 'three';
import { buildEquipment, type EquipStyle } from '../world/equipmentMeshes';

const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const SIZE = 192;

function setup(): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    renderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
  } catch {
    failed = true;
    renderer = null;
  }
  return renderer;
}

/** Image (data URL) d'un meuble, ou chaîne vide si le rendu est impossible. */
export function equipThumb(defId: string, style: EquipStyle): string {
  const hit = cache.get(defId);
  if (hit !== undefined) return hit;
  const r = setup();
  if (!r) return '';
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a70, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  let url = '';
  try {
    const v = buildEquipment({ uid: -1, def: defId, gx: 0, gz: 0, rot: 0, wear: 0 }, style);
    const g = v.root;
    g.position.set(0, 0, 0);
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.4, size.length() / 2);
    const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, 100);
    cam.position.copy(center).add(new THREE.Vector3(1, 0.85, 1.25).normalize().multiplyScalar(20));
    cam.lookAt(center);
    cam.zoom = 1.08;
    cam.updateProjectionMatrix();
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    url = (r.domElement as HTMLCanvasElement).toDataURL('image/png');
  } catch (e) {
    console.warn('[vignette]', defId, e);
  }
  cache.set(defId, url);
  return url;
}
