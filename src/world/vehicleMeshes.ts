/** Véhicules : voitures, camion de livraison, bus, voiture de police (repère : avant = +z). */
import * as THREE from 'three';
import { box, mat, glassMat, cylGeo } from './materials';
import { signTexture } from './textures';

const tire = () => mat(0x1b1b1b, { rough: 0.9 });

function wheels(g: THREE.Group, w: number, l: number, r: number) {
  const wheelsArr: THREE.Mesh[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const wh = new THREE.Mesh(cylGeo(r, r, 0.22, 14), tire());
      wh.rotation.z = Math.PI / 2;
      wh.position.set(sx * (w / 2 - 0.08), r, sz * (l / 2 - r - 0.25));
      wh.castShadow = true;
      g.add(wh);
      wheelsArr.push(wh);
    }
  (g as any).wheels = wheelsArr;
}

export const CAR_COLORS = [0xd63031, 0x0984e3, 0xdfe6e9, 0x2d3436, 0x636e72, 0xfdcb6e, 0x00b894, 0x6c5ce7, 0xe17055, 0xb2bec3, 0x1e3799, 0xffffff];

export function carMesh(color: number, kind: 'citadine' | 'berline' | 'break' = 'citadine'): THREE.Group {
  const g = new THREE.Group();
  const L = kind === 'citadine' ? 3.8 : kind === 'berline' ? 4.5 : 4.6;
  const W = 1.75;
  const body = mat(color, { rough: 0.35, metal: 0.5 });
  box(g, W, 0.55, L, 0, 0.3, 0, body);
  const cabL = kind === 'break' ? L * 0.62 : L * 0.5;
  const cab = box(g, W - 0.12, 0.5, cabL, 0, 0.85, kind === 'break' ? -0.2 : -0.1, glassMat());
  cab.castShadow = false;
  box(g, W - 0.1, 0.06, cabL - 0.1, 0, 1.33, kind === 'break' ? -0.2 : -0.1, body);
  for (const sx of [-1, 1]) {
    box(g, 0.22, 0.12, 0.04, sx * 0.6, 0.55, L / 2, mat(0xfffbe6, { emissive: 0xfff3c4, emissiveIntensity: 0.3 }), false);
    box(g, 0.25, 0.1, 0.04, sx * 0.6, 0.55, -L / 2, mat(0xc0392b, { emissive: 0xff0000, emissiveIntensity: 0.4 }), false);
  }
  box(g, 0.5, 0.12, 0.03, 0, 0.42, -L / 2 - 0.01, mat(0xffffff), false);
  wheels(g, W, L, 0.32);
  (g as any).length = L;
  return g;
}

export function truckMesh(company = 'RAPIDO CASH', color = 0xe84118): THREE.Group {
  const g = new THREE.Group();
  const L = 7.2;
  const W = 2.4;
  box(g, W, 1.5, 2.0, 0, 0.5, L / 2 - 1.0, mat(0xf5f6fa, { rough: 0.4, metal: 0.3 }));
  box(g, W - 0.1, 0.7, 0.05, 0, 1.15, L / 2 + 0.01, glassMat());
  box(g, W, 2.7, L - 2.3, 0, 0.6, -1.1, mat(0xffffff, { rough: 0.6 }));
  const tex = signTexture(company, color, 0xffffff, 512, 128);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(L - 2.6, 1.0), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : color }));
    p.position.set(side * (W / 2 + 0.01), 2.0, -1.1);
    p.rotation.y = side * (Math.PI / 2);
    g.add(p);
  }
  box(g, W, 0.15, L, 0, 0.45, 0, mat(0x2d3436));
  wheels(g, W, L, 0.45);
  (g as any).length = L;
  return g;
}

export function busMesh(): THREE.Group {
  const g = new THREE.Group();
  const L = 11;
  const W = 2.5;
  box(g, W, 2.6, L, 0, 0.35, 0, mat(0x2e86de, { rough: 0.4, metal: 0.3 }));
  for (const side of [-1, 1]) box(g, 0.04, 1.0, L - 1.6, side * (W / 2 + 0.01), 1.55, 0.2, glassMat());
  box(g, W - 0.2, 1.2, 0.05, 0, 1.4, L / 2 + 0.01, glassMat());
  const s = signTexture('LIGNE 93 — STADE', 0x111111, 0xf9ca24, 256, 48);
  if (s) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.3), new THREE.MeshStandardMaterial({ map: s, emissive: 0xffffff, emissiveMap: s, emissiveIntensity: 0.6 }));
    p.position.set(0, 2.7, L / 2 + 0.02);
    g.add(p);
  }
  wheels(g, W, L, 0.5);
  (g as any).length = L;
  return g;
}

export function policeMesh(): THREE.Group {
  const g = carMesh(0xffffff, 'berline');
  box(g, 1.76, 0.12, 4.4, 0, 0.62, 0, mat(0x1e3799), false);
  const blue = new THREE.MeshStandardMaterial({ color: 0x0050ff, emissive: 0x0050ff, emissiveIntensity: 2 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 });
  const b = box(g, 0.35, 0.12, 0.2, -0.25, 1.4, -0.1, blue, false);
  const r = box(g, 0.35, 0.12, 0.2, 0.25, 1.4, -0.1, red, false);
  (g as any).flash = (t: number) => {
    const on = Math.sin(t * 12) > 0;
    blue.emissiveIntensity = on ? 3 : 0.2;
    red.emissiveIntensity = on ? 0.2 : 3;
    b.visible = true;
    r.visible = true;
  };
  return g;
}

export function palletMesh(): THREE.Group {
  const g = new THREE.Group();
  const w = mat(0xb08355, { rough: 0.9 });
  for (const x of [-0.5, 0, 0.5]) box(g, 0.1, 0.1, 1.2, x, 0, 0, w);
  for (const z of [-0.55, -0.2, 0.2, 0.55]) box(g, 1.2, 0.03, 0.12, 0, 0.1, z, w);
  return g;
}
