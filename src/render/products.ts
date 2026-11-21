/**
 * Produits en rayon : une forme 3D par produit (boîte, bouteille, canette, fruit…) avec une étiquette
 * qui reprend l'image du produit. Un seul maillage instancié par produit pour tout le magasin.
 */
import * as THREE from 'three';
import { PRODUCT_BY_ID, type ProductDef } from '../data/products';

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();
const imgCache = new Map<string, HTMLImageElement>();

export function productImage(pid: string): HTMLImageElement {
  let im = imgCache.get(pid);
  if (!im) {
    im = new Image();
    im.src = `./products/${pid}.webp`;
    imgCache.set(pid, im);
  }
  return im;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function labelTexture(p: ProductDef): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    g.fillStyle = hex(p.color);
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = hex(p.color2);
    g.fillRect(0, 96, 128, 32);
    g.fillRect(0, 0, 128, 10);
    const im = productImage(p.id);
    if (im.complete && im.naturalWidth) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.arc(64, 54, 40, 0, Math.PI * 2);
      g.fill();
      g.drawImage(im, 24, 14, 80, 80);
    }
    tex.needsUpdate = true;
  };
  draw();
  const im = productImage(p.id);
  if (!im.complete) im.addEventListener('load', draw, { once: true });
  return tex;
}

export function productGeometry(p: ProductDef): THREE.BufferGeometry {
  let g = geoCache.get(p.id);
  if (g) return g;
  const [w, h, d] = p.size;
  switch (p.shape) {
    case 'can':
    case 'tube':
      g = new THREE.CylinderGeometry(w / 2, w / 2, h, 14);
      break;
    case 'bottle': {
      const r = w / 2;
      const pts = [
        [0, -h / 2],
        [r * 0.9, -h / 2],
        [r, -h / 2 + h * 0.05],
        [r, h * 0.12],
        [r * 0.85, h * 0.25],
        [r * 0.38, h * 0.38],
        [r * 0.34, h / 2 - h * 0.03],
        [r * 0.38, h / 2],
        [0, h / 2],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      g = new THREE.LatheGeometry(pts, 12);
      break;
    }
    case 'jar': {
      const r = w / 2;
      const pts = [
        [0, -h / 2],
        [r, -h / 2],
        [r, h * 0.3],
        [r * 0.85, h * 0.36],
        [r * 0.85, h / 2],
        [0, h / 2],
      ].map(([x, y]) => new THREE.Vector2(x, y));
      g = new THREE.LatheGeometry(pts, 14);
      break;
    }
    case 'fruit':
      g = new THREE.SphereGeometry(0.5, 12, 9);
      g.scale(w, h * 1.4, d);
      break;
    case 'bread':
      g = new THREE.CapsuleGeometry(w / 2, Math.max(0.01, d - w), 4, 8);
      g.rotateX(Math.PI / 2);
      break;
    default: {
      g = new THREE.BoxGeometry(w, h, d);
      // faces ±x, ±y : couleur de fond de l'étiquette ; l'image est sur l'avant
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const per = uv.count / 6;
      for (let i = 0; i < per * 4; i++) uv.setXY(i, 0.03, 0.5);
    }
  }
  geoCache.set(p.id, g);
  return g;
}

export function productMaterial(p: ProductDef): THREE.Material {
  let m = matCache.get(p.id);
  if (m) return m;
  if (p.shape === 'fruit' || p.shape === 'bread') {
    m = new THREE.MeshStandardMaterial({ color: p.color, roughness: p.shape === 'bread' ? 0.9 : 0.5 });
  } else {
    const t = labelTexture(p);
    if (p.shape === 'can' || p.shape === 'tube' || p.shape === 'jar' || p.shape === 'bottle') {
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(2, 1);
    }
    m = new THREE.MeshStandardMaterial({ map: t, roughness: p.shape === 'can' ? 0.35 : 0.55, metalness: p.shape === 'can' ? 0.3 : 0 });
  }
  matCache.set(p.id, m);
  return m;
}

export function productMesh(pid: string) {
  const p = PRODUCT_BY_ID[pid];
  return new THREE.Mesh(productGeometry(p), productMaterial(p));
}
