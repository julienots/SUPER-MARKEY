/** Vignettes des meubles (rendu du vrai modèle 3D) pour le menu Construire. */
import * as THREE from 'three';
import { FURNITURE } from '../data/furniture';
import { equipModel, kitModel, kitSize } from './assets';

const cache = new Map<string, string>();

export function makeThumbs() {
  const size = 160;
  let r: THREE.WebGLRenderer;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return;
  }
  r.setSize(size, size, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2);
  d.position.set(3, 5, 4);
  scene.add(d);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  for (const def of FURNITURE) {
    let o: THREE.Object3D | null = def.model.kit === 'equip' ? equipModel(def.model.name) : kitModel('props', def.model.name);
    if (!o) continue;
    if (def.model.kit === 'props') {
      if (def.model.fit) {
        const s = kitSize('props', def.model.name);
        o.scale.setScalar(Math.min((def.w * 0.95) / s.x, (def.d * 0.95) / s.z));
      } else o.scale.setScalar(def.model.scale ?? 1);
    }
    const g = new THREE.Group();
    g.add(o);
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    const ext = box.getSize(new THREE.Vector3()).length() * 0.55;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.position.set(c.x + 4, c.y + 3.2, c.z + 5);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    cache.set(def.id, r.domElement.toDataURL('image/png'));
    scene.remove(g);
  }
  r.dispose();
}

export const thumb = (id: string) => cache.get(id) ?? '';
