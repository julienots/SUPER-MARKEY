/**
 * Modèles 3D des produits (géométrie par forme + étiquette générée), partagés entre
 * le rendu instancié des rayons, les objets physiques tombés et les articles tenus en main.
 */
import * as THREE from 'three';
import { PRODUCT_BY_ID, type ProductDef } from '../data/products';
import { labelTexture } from './textures';
import { mat } from './materials';

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material | THREE.Material[]>();

/** Géométrie centrée sur l'origine, dimensions = p.size. */
export function productGeometry(p: ProductDef): THREE.BufferGeometry {
  let g = geoCache.get(p.id);
  if (g) return g;
  const [w, h, d] = p.size;
  switch (p.shape) {
    case 'can':
    case 'tube': {
      g = new THREE.CylinderGeometry(w / 2, w / 2, h, 14);
      break;
    }
    case 'bottle': {
      const r = w / 2;
      const pts: THREE.Vector2[] = [
        new THREE.Vector2(0, -h / 2),
        new THREE.Vector2(r * 0.9, -h / 2),
        new THREE.Vector2(r, -h / 2 + h * 0.05),
        new THREE.Vector2(r, h * 0.12),
        new THREE.Vector2(r * 0.85, h * 0.25),
        new THREE.Vector2(r * 0.38, h * 0.38),
        new THREE.Vector2(r * 0.34, h / 2 - h * 0.03),
        new THREE.Vector2(r * 0.38, h / 2),
        new THREE.Vector2(0, h / 2),
      ];
      g = new THREE.LatheGeometry(pts, 12);
      break;
    }
    case 'jar': {
      const r = w / 2;
      const pts = [
        new THREE.Vector2(0, -h / 2),
        new THREE.Vector2(r, -h / 2),
        new THREE.Vector2(r, h * 0.3),
        new THREE.Vector2(r * 0.85, h * 0.36),
        new THREE.Vector2(r * 0.85, h / 2),
        new THREE.Vector2(0, h / 2),
      ];
      g = new THREE.LatheGeometry(pts, 14);
      break;
    }
    case 'fruit': {
      g = new THREE.SphereGeometry(0.5, 10, 8);
      g.scale(w, h * 1.4, d);
      break;
    }
    case 'bread': {
      g = new THREE.CapsuleGeometry(w / 2, d - w, 4, 8);
      g.rotateX(Math.PI / 2);
      break;
    }
    case 'bag': {
      g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const k = 1 - Math.abs(y / (h / 2)) * 0.25;
        pos.setZ(i, pos.getZ(i) * k);
      }
      g.computeVertexNormals();
      break;
    }
    case 'egg': {
      g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
      break;
    }
    default:
      g = new THREE.BoxGeometry(w, h, d);
  }
  geoCache.set(p.id, g);
  return g;
}

/** Matériau(x) : étiquette sur la face avant (+z) pour les boîtes, enveloppante pour les cylindres. */
export function productMaterial(p: ProductDef): THREE.Material | THREE.Material[] {
  let m = matCache.get(p.id);
  if (m) return m;
  const label = labelTexture(p);
  const side = mat(p.color, { rough: 0.6 });
  if (p.shape === 'box' || p.shape === 'pack' || p.shape === 'bag' || p.shape === 'egg' || p.shape === 'tray') {
    const front = label ? new THREE.MeshStandardMaterial({ map: label, roughness: p.shape === 'bag' ? 0.35 : 0.6 }) : mat(p.color2);
    const top = mat(p.shape === 'tray' ? 0xf5f6fa : p.color, { rough: p.shape === 'tray' ? 0.15 : 0.6 });
    m = [side, side, top, side, front, front];
  } else if (p.shape === 'can' || p.shape === 'tube' || p.shape === 'jar' || p.shape === 'bottle') {
    if (label) {
      const t = label.clone();
      t.needsUpdate = true;
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(2, 1);
      const transparent = p.shape === 'bottle' && (p.id === 'eau' || p.category === 'hygiene');
      m = new THREE.MeshStandardMaterial({ map: t, roughness: p.shape === 'can' ? 0.3 : 0.25, metalness: p.shape === 'can' ? 0.5 : 0.05, transparent, opacity: transparent ? 0.9 : 1 });
    } else m = mat(p.color);
  } else if (p.shape === 'bread') {
    m = mat(p.color, { rough: 0.9 });
  } else {
    m = mat(p.color, { rough: 0.55 });
  }
  matCache.set(p.id, m);
  return m;
}

export function productMesh(pid: string): THREE.Mesh {
  const p = PRODUCT_BY_ID[pid];
  const mesh = new THREE.Mesh(productGeometry(p), productMaterial(p));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Forme de collision physique adaptée à la géométrie. */
export function productCollider(p: ProductDef): { type: 'box'; hx: number; hy: number; hz: number } | { type: 'cyl'; r: number; hh: number } | { type: 'ball'; r: number } {
  const [w, h, d] = p.size;
  if (p.shape === 'can' || p.shape === 'bottle' || p.shape === 'jar' || p.shape === 'tube') return { type: 'cyl', r: w / 2, hh: h / 2 };
  if (p.shape === 'fruit' && p.rolls) return { type: 'ball', r: Math.min(w, d) / 2 };
  if (p.shape === 'bread') return { type: 'box', hx: w / 2, hy: h / 2, hz: d / 2 };
  return { type: 'box', hx: w / 2, hy: h / 2, hz: d / 2 };
}
