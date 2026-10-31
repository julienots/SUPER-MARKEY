/**
 * Modèles 3D procéduraux des équipements. Repère local : centre de l'emprise au sol, face avant = +z.
 * Chaque constructeur renvoie aussi des boîtes de collision locales (physique + visée).
 */
import * as THREE from 'three';
import { CELL, EQUIPMENT_BY_ID, type EquipmentDef } from '../data/equipment';
import { WALL_H } from '../sim/layout';
import { box, cyl, decal, glassMat, mat, metalMat, boxGeo, sphereGeo, cylGeo } from './materials';
import { signTexture, emojiTexture, radialGlowTexture } from './textures';
import type { PlacedEquip } from '../sim/state';
import { mergeStatic } from './merge';
import { kitEquipment } from './kitEquipment';

export interface ColBox {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface EquipVisual {
  root: THREE.Group;
  colliders: ColBox[];
  /** Éléments animés (ballons, écrans...). */
  animate?: (t: number) => void;
  /** Lumière émissive à éteindre en cas de coupure. */
  lights?: THREE.MeshStandardMaterial[];
}

export interface EquipStyle {
  shelfColor: number;
  accent: number;
  uniform: number;
}

const wood = () => mat(0x9c6b3f, { rough: 0.85 });
const darkWood = () => mat(0x6d4c2f, { rough: 0.85 });
const white = () => mat(0xf5f6fa, { rough: 0.5 });
const dark = () => mat(0x2d3436, { rough: 0.6 });

function shelfUnit(g: THREE.Group, def: EquipmentDef, st: EquipStyle, W: number, D: number) {
  const sh = def.shelf!;
  const body = mat(st.shelfColor, { rough: 0.5, metal: 0.1 });
  const rail = mat(st.accent, { rough: 0.5 });
  const H = def.h;
  box(g, W, 0.12, D, 0, 0, 0, dark());
  if (sh.sides === 2) {
    box(g, W, H, 0.05, 0, 0, 0, body);
  } else {
    box(g, W, H, 0.04, 0, 0, -D / 2 + 0.02, body);
  }
  for (const sx of [-1, 1]) box(g, 0.04, H, D, sx * (W / 2 - 0.02), 0, 0, body);
  for (const y of sh.levels) {
    for (let side = 0; side < sh.sides; side++) {
      const dir = side === 0 ? 1 : -1;
      const zc = sh.sides === 2 ? (dir * sh.depth) / 2 : -D / 2 + 0.04 + sh.depth / 2;
      box(g, W - 0.06, 0.022, sh.depth, 0, y - 0.022, zc, body, false, true);
      const front = sh.sides === 2 ? dir * (D / 2 - 0.02) : -D / 2 + 0.04 + sh.depth;
      box(g, W - 0.06, 0.045, 0.012, 0, y - 0.05, front, rail, false, false);
    }
  }
  // fronton
  const top = new THREE.Mesh(boxGeo(W, 0.18, sh.sides === 2 ? 0.08 : 0.06), rail);
  top.position.set(0, H + 0.09, sh.sides === 2 ? 0 : -D / 2 + 0.05);
  g.add(top);
}

function cardboard(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number) {
  box(g, w, h, d, x, y, z, mat(0xc49a6c, { rough: 0.9 }));
}

export function buildEquipment(e: PlacedEquip, st: EquipStyle, powerOn = true): EquipVisual {
  const def = EQUIPMENT_BY_ID[e.def];
  const W = def.w * CELL;
  const D = def.d * CELL;
  const g = new THREE.Group();
  g.name = `equip:${e.uid}`;
  const cols: ColBox[] = [];
  const lights: THREE.MeshStandardMaterial[] = [];
  const full = (h = def.h, inset = 0) => cols.push({ cx: 0, cy: h / 2, cz: 0, hx: W / 2 - inset, hy: h / 2, hz: D / 2 - inset });
  let animate: ((t: number) => void) | undefined;
  const broken = !!e.broken;
  const lightMat = (c: number) => {
    const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: broken || !powerOn ? 0 : 1.2 });
    lights.push(m);
    return m;
  };

  switch (def.id) {
    case 'gondole_simple':
    case 'gondole_double':
    case 'gondole_basse':
      shelfUnit(g, def, st, W, D);
      full();
      break;
    case 'etal_fruits': {
      box(g, W, 0.5, D * 0.8, 0, 0, 0, darkWood());
      for (const side of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const crate = new THREE.Mesh(boxGeo(W / 3 - 0.04, 0.12, 0.42), wood());
          crate.position.set(-W / 3 + (i * W) / 3, 0.52, side * 0.24);
          crate.rotation.x = side * 0.12;
          crate.castShadow = true;
          g.add(crate);
          const crate2 = new THREE.Mesh(boxGeo(W / 3 - 0.04, 0.12, 0.3), wood());
          crate2.position.set(-W / 3 + (i * W) / 3, 0.82, side * 0.12);
          crate2.rotation.x = side * 0.18;
          g.add(crate2);
        }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, 0.25), new THREE.MeshStandardMaterial({ map: signTexture('PRIMEUR', 0x2e7d32, 0xffffff, 256, 64), roughness: 0.7 }));
      sign.position.set(0, 1.25, 0);
      g.add(sign);
      const sign2 = sign.clone();
      sign2.rotation.y = Math.PI;
      g.add(sign2);
      cyl(g, 0.02, 1.25, -W / 2 + 0.1, 0, 0, darkWood(), 6);
      cyl(g, 0.02, 1.25, W / 2 - 0.1, 0, 0, darkWood(), 6);
      full(0.95);
      break;
    }
    case 'bac_pain': {
      box(g, W, 0.42, D, 0, 0, 0, darkWood());
      box(g, W, 1.0, 0.04, 0, 0.42, -D / 2 + 0.02, darkWood());
      for (const [y, z] of [[0.45, 0.05], [0.9, -0.12]]) {
        box(g, W - 0.08, 0.04, D * 0.55, 0, y - 0.04, z, wood());
        box(g, W - 0.08, 0.1, 0.02, 0, y - 0.04, z + D * 0.27, mat(0xc8a165, { rough: 0.95 }));
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 0.22), new THREE.MeshStandardMaterial({ map: signTexture('BOULANGERIE', 0x8d5524, 0xffe7b3, 256, 64) }));
      sign.position.set(0, 1.3, -D / 2 + 0.05);
      g.add(sign);
      full(1.4);
      break;
    }
    case 'tete_gondole': {
      box(g, W * 0.95, 0.33, D * 0.95, 0, 0, 0, mat(st.accent, { rough: 0.5 }));
      cyl(g, 0.025, 1.6, -W / 2 + 0.1, 0.33, -D / 2 + 0.1, metalMat(), 6);
      const tex = signTexture('PROMO !', 0xffd32a, 0xe84118, 256, 128);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
      s.position.set(-W / 2 + 0.1, 1.95, -D / 2 + 0.1);
      s.rotation.y = Math.PI / 4;
      g.add(s);
      animate = (t) => (s.rotation.z = Math.sin(t * 2) * 0.05);
      cols.push({ cx: 0, cy: 0.165, cz: 0, hx: W * 0.47, hy: 0.165, hz: D * 0.47 });
      break;
    }
    case 'frigo_vitre':
    case 'frigo_mural': {
      const sh = def.shelf!;
      const body = mat(0xecf0f1, { rough: 0.35, metal: 0.3 });
      box(g, W, 0.15, D, 0, 0, 0, dark());
      box(g, W, def.h - 0.15, 0.06, 0, 0.15, -D / 2 + 0.03, body);
      for (const sx of [-1, 1]) box(g, 0.05, def.h - 0.15, D, sx * (W / 2 - 0.025), 0.15, 0, body);
      box(g, W, 0.22, D, 0, def.h - 0.22, 0, body);
      const strip = new THREE.Mesh(boxGeo(W - 0.1, 0.05, 0.02), lightMat(0xdff6ff));
      strip.position.set(0, def.h - 0.25, D / 2 - 0.05);
      g.add(strip);
      const inner = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, def.h - 0.4), lightMat(0x9fdcff));
      inner.material.emissiveIntensity = broken || !powerOn ? 0 : 0.25;
      inner.position.set(0, def.h / 2, -D / 2 + 0.065);
      g.add(inner);
      for (const y of sh.levels) box(g, W - 0.1, 0.02, sh.depth, 0, y - 0.02, -D / 2 + 0.06 + sh.depth / 2, mat(0xdfe6e9, { rough: 0.2, metal: 0.4 }), false);
      if (def.id === 'frigo_vitre') {
        for (let i = 0; i < 4; i++) {
          const door = new THREE.Mesh(boxGeo(W / 4 - 0.02, def.h - 0.42, 0.02), glassMat());
          door.position.set(-W / 2 + W / 8 + (i * W) / 4, (def.h - 0.42) / 2 + 0.17, D / 2 - 0.02);
          g.add(door);
          box(g, 0.02, 0.4, 0.04, -W / 2 + W / 4 + (i * W) / 4 - 0.05, 0.8, D / 2 + 0.01, metalMat());
        }
      } else {
        box(g, W, 0.35, 0.08, 0, 0.15, D / 2 - 0.04, body);
      }
      const label = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.6, 0.14), decal(new THREE.MeshStandardMaterial({ map: signTexture(broken ? '⚠ EN PANNE ⚠' : 'FRAIS 2-4°C', broken ? 0xc0392b : 0x0984e3, 0xffffff, 256, 48) }), 2));
      label.position.set(0, def.h - 0.11, D / 2 + 0.005);
      g.add(label);
      full();
      break;
    }
    case 'congelateur': {
      const body = mat(0xf5f6fa, { rough: 0.35, metal: 0.2 });
      box(g, W, def.h, 0.06, 0, 0, -D / 2 + 0.03, body);
      box(g, W, def.h, 0.06, 0, 0, D / 2 - 0.03, body);
      box(g, 0.06, def.h, D, -W / 2 + 0.03, 0, 0, body);
      box(g, 0.06, def.h, D, W / 2 - 0.03, 0, 0, body);
      box(g, W - 0.1, 0.25, D - 0.1, 0, 0, 0, mat(0xb2bec3));
      const bin = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.12, D - 0.12), lightMat(0xc7ecee));
      bin.material.emissiveIntensity = broken || !powerOn ? 0 : 0.35;
      bin.rotation.x = -Math.PI / 2;
      bin.position.y = 0.26;
      g.add(bin);
      for (let i = 0; i < 2; i++) {
        const lid = new THREE.Mesh(boxGeo(W / 2 - 0.04, 0.015, D - 0.1), glassMat());
        lid.position.set(-W / 4 + (i * W) / 2, def.h + 0.01, 0);
        g.add(lid);
      }
      box(g, W, 0.08, 0.02, 0, def.h - 0.15, D / 2 + 0.005, mat(broken ? 0xc0392b : 0x0984e3));
      full(def.h);
      break;
    }
    case 'caisse': {
      const body = mat(st.accent, { rough: 0.5 });
      box(g, W, 0.85, D * 0.75, 0, 0, -0.05, body);
      box(g, W, 0.04, D * 0.8, 0, 0.85, -0.05, mat(0xdfe6e9, { rough: 0.3, metal: 0.4 }));
      box(g, W * 0.6, 0.02, 0.38, 0.3, 0.89, 0.08, mat(0x1e1e1e, { rough: 0.9 }));
      // scanner
      box(g, 0.3, 0.03, 0.3, -0.35, 0.89, 0.08, mat(0x111111));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), lightMat(broken ? 0x000000 : 0xff3b3b));
      glass.material.emissiveIntensity = broken || !powerOn ? 0 : 0.6;
      glass.rotation.x = -Math.PI / 2;
      glass.position.set(-0.35, 0.925, 0.08);
      g.add(glass);
      // écran caisse
      cyl(g, 0.02, 0.35, -0.6, 0.89, -0.25, metalMat(), 6);
      const scr = new THREE.Mesh(boxGeo(0.3, 0.2, 0.03), dark());
      scr.position.set(-0.6, 1.33, -0.25);
      scr.rotation.x = -0.3;
      g.add(scr);
      const scrFace = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), lightMat(broken ? 0xc0392b : 0x2ecc71));
      scrFace.position.set(-0.6, 1.33, -0.233);
      scrFace.rotation.x = -0.3;
      g.add(scrFace);
      // zone d'ensachage
      box(g, 0.55, 0.05, 0.45, -1.15, 0.85, 0.1, mat(0xb2bec3));
      // numéro de caisse (lampe)
      cyl(g, 0.02, 1.2, 1.4, 0.85, -0.3, metalMat(), 6);
      const lamp = new THREE.Mesh(cylGeo(0.12, 0.12, 0.08, 16), lightMat(e.open !== false && !broken ? 0x2ecc71 : 0xe74c3c));
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(1.4, 2.1, -0.3);
      g.add(lamp);
      cols.push({ cx: 0, cy: 0.45, cz: -0.05, hx: W / 2, hy: 0.45, hz: D * 0.375 });
      break;
    }
    case 'caisse_auto': {
      box(g, 0.7, 0.85, 0.5, 0, 0, -0.15, mat(0xdfe6e9, { rough: 0.4, metal: 0.4 }));
      box(g, 0.7, 0.05, 0.6, 0, 0.85, -0.1, dark());
      const scr = new THREE.Mesh(boxGeo(0.45, 0.35, 0.04), dark());
      scr.position.set(0, 1.25, -0.3);
      scr.rotation.x = -0.25;
      g.add(scr);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), lightMat(broken ? 0xc0392b : 0x74b9ff));
      face.position.set(0, 1.25, -0.278);
      face.rotation.x = -0.25;
      g.add(face);
      box(g, 0.4, 0.4, 0.4, -0.65, 0.5, -0.05, mat(0xb2bec3));
      cols.push({ cx: 0, cy: 0.6, cz: -0.15, hx: 0.45, hy: 0.6, hz: 0.35 });
      break;
    }
    case 'rack_reserve': {
      const up = mat(0xe67e22, { rough: 0.5, metal: 0.4 });
      const beam = mat(0x2980b9, { rough: 0.5, metal: 0.4 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.07, def.h, 0.07, sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.04), up);
      for (const y of [0.1, 0.85, 1.6]) {
        box(g, W, 0.06, 0.06, 0, y, D / 2 - 0.04, beam);
        box(g, W, 0.06, 0.06, 0, y, -D / 2 + 0.04, beam);
        box(g, W - 0.08, 0.025, D - 0.08, 0, y + 0.04, 0, wood(), false);
      }
      full();
      break;
    }
    case 'chambre_froide': {
      const panel = mat(0xf1f2f6, { rough: 0.4, metal: 0.15 });
      box(g, W, def.h, D, 0, 0, 0, panel);
      box(g, 0.9, 2.0, 0.08, 0.3, 0, D / 2, mat(0xdfe4ea, { rough: 0.3, metal: 0.4 }));
      box(g, 0.06, 0.4, 0.06, 0.65, 0.9, D / 2 + 0.06, metalMat());
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.22), new THREE.MeshStandardMaterial({ map: signTexture(broken ? 'PANNE !' : 'CHAMBRE FROIDE', broken ? 0xc0392b : 0x0984e3, 0xffffff, 256, 64) }));
      s.position.set(0.3, 2.15, D / 2 + 0.01);
      g.add(s);
      full();
      break;
    }
    case 'camera': {
      const y = WALL_H - 0.02;
      box(g, 0.18, 0.04, 0.18, 0, y - 0.04, 0, white(), false);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x111111, { rough: 0.1, metal: 0.3, transparent: true, opacity: 0.85 }));
      dome.rotation.x = Math.PI;
      dome.position.y = y - 0.04;
      g.add(dome);
      const lens = new THREE.Mesh(cylGeo(0.02, 0.025, 0.05, 8), dark());
      lens.rotation.x = Math.PI / 2 + 0.6;
      lens.position.set(0, y - 0.09, 0.04);
      g.add(lens);
      const led = new THREE.Mesh(sphereGeo(0.012, 6), lightMat(broken ? 0x333333 : 0xff0000));
      led.position.set(0.06, y - 0.06, 0.05);
      g.add(led);
      animate = (t) => (led.visible = Math.sin(t * 4) > 0);
      break;
    }
    case 'detecteur': {
      const y = WALL_H - 0.02;
      box(g, 0.12, 0.08, 0.12, 0, y - 0.08, 0, white(), false);
      const led = new THREE.Mesh(sphereGeo(0.012, 6), lightMat(0xff4400));
      led.position.set(0, y - 0.09, 0.06);
      g.add(led);
      break;
    }
    case 'ecran_secu': {
      box(g, W, 0.75, D * 0.7, 0, 0, -0.1, darkWood());
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(boxGeo(0.45, 0.3, 0.04), dark());
        m.position.set(-0.55 + (i % 2) * 0.5 + (i >= 2 ? 0.5 : 0) * 0, 0.95 + Math.floor(i / 2) * 0.33, -0.35);
        m.position.x = -0.5 + (i % 2) * 0.5;
        g.add(m);
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.41, 0.26), lightMat(0x55efc4));
        f.material.emissiveIntensity = powerOn ? 0.5 : 0;
        f.position.set(m.position.x, m.position.y, -0.328);
        g.add(f);
      }
      // chaise
      box(g, 0.45, 0.45, 0.45, 0, 0, 0.55, dark());
      box(g, 0.45, 0.5, 0.06, 0, 0.45, 0.78, dark());
      cols.push({ cx: 0, cy: 0.4, cz: -0.1, hx: W / 2, hy: 0.4, hz: D * 0.35 });
      break;
    }
    case 'portique': {
      const m = mat(0xdfe6e9, { rough: 0.2, metal: 0.2, transparent: true, opacity: 0.7 });
      box(g, 0.12, 1.6, 0.4, 0, 0, 0, m);
      box(g, 0.16, 0.06, 0.44, 0, 0, 0, dark());
      const led = new THREE.Mesh(boxGeo(0.13, 0.05, 0.3), lightMat(0x2ecc71));
      led.position.y = 1.55;
      g.add(led);
      cols.push({ cx: 0, cy: 0.8, cz: 0, hx: 0.08, hy: 0.8, hz: 0.2 });
      break;
    }
    case 'vitrine_secu': {
      box(g, W, 0.35, D, 0, 0, 0, dark());
      const gl = new THREE.Mesh(boxGeo(W - 0.04, def.h - 0.35, D - 0.04), glassMat());
      gl.position.y = 0.35 + (def.h - 0.35) / 2;
      g.add(gl);
      for (const y of def.shelf!.levels) box(g, W - 0.08, 0.015, D - 0.1, 0, y - 0.015, 0, glassMat(), false);
      box(g, 0.06, 0.06, 0.02, W / 2 - 0.15, 0.28, D / 2, mat(0xd4af37, { metal: 0.8, rough: 0.3 }));
      full();
      break;
    }
    case 'coffre': {
      box(g, W * 0.9, def.h, D * 0.9, 0, 0, 0, mat(0x3d4b56, { rough: 0.4, metal: 0.7 }));
      const dial = new THREE.Mesh(cylGeo(0.06, 0.06, 0.03, 16), metalMat(0xd4af37));
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0, 0.6, D * 0.45 + 0.015);
      g.add(dial);
      full();
      break;
    }
    case 'bureau': {
      box(g, W * 0.85, 0.74, D * 0.55, 0, 0, -0.15, darkWood());
      const scr = new THREE.Mesh(boxGeo(0.5, 0.32, 0.03), dark());
      scr.position.set(0, 1.0, -0.35);
      g.add(scr);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.28), lightMat(0x74b9ff));
      f.material.emissiveIntensity = powerOn ? 0.5 : 0;
      f.position.set(0, 1.0, -0.333);
      g.add(f);
      box(g, 0.45, 0.45, 0.45, 0, 0, 0.45, dark());
      box(g, 0.45, 0.55, 0.06, 0, 0.45, 0.68, dark());
      box(g, 0.3, 0.05, 0.22, 0.45, 0.74, -0.2, white(), false);
      cols.push({ cx: 0, cy: 0.37, cz: -0.15, hx: W * 0.43, hy: 0.37, hz: D * 0.28 });
      break;
    }
    case 'casiers': {
      for (let i = 0; i < 4; i++) {
        box(g, W / 4 - 0.02, def.h, D * 0.9, -W / 2 + W / 8 + (i * W) / 4, 0, 0, mat([0x95a5a6, 0x7f8c8d][i % 2], { rough: 0.4, metal: 0.5 }));
        box(g, 0.02, 0.12, 0.02, -W / 2 + W / 8 + (i * W) / 4 + 0.1, 1.0, D * 0.45 + 0.01, dark());
      }
      full();
      break;
    }
    case 'salle_pause': {
      cyl(g, 0.5, 0.74, -0.2, 0, 0, white(), 20);
      for (const a of [0, 2.2, 4.2]) {
        box(g, 0.4, 0.45, 0.4, -0.2 + Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, mat(st.accent));
      }
      box(g, 0.45, 1.6, 0.45, W / 2 - 0.3, 0, -D / 2 + 0.3, dark());
      const cup = new THREE.Mesh(cylGeo(0.04, 0.03, 0.08, 8), white());
      cup.position.set(-0.2, 0.78, 0);
      g.add(cup);
      cols.push({ cx: -0.2, cy: 0.37, cz: 0, hx: 0.5, hy: 0.37, hz: 0.5 }, { cx: W / 2 - 0.3, cy: 0.8, cz: -D / 2 + 0.3, hx: 0.23, hy: 0.8, hz: 0.23 });
      break;
    }
    case 'toilettes': {
      const wall = mat(0xdfe6e9, { rough: 0.6 });
      box(g, W, def.h, 0.06, 0, 0, -D / 2 + 0.03, wall);
      box(g, 0.06, def.h, D, -W / 2 + 0.03, 0, 0, wall);
      box(g, 0.06, def.h, D, W / 2 - 0.03, 0, 0, wall);
      box(g, W * 0.45, def.h, 0.06, -W * 0.27, 0, D / 2 - 0.03, wall);
      box(g, W * 0.4, 2.0, 0.04, W * 0.24, 0, D / 2 - 0.03, mat(0x74b9ff, { rough: 0.5 }));
      box(g, 0.38, 0.42, 0.55, 0, 0, -D / 2 + 0.4, white());
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.2), new THREE.MeshStandardMaterial({ map: signTexture('WC', 0x0984e3, 0xffffff, 128, 64) }));
      s.position.set(W * 0.24, 2.15, D / 2 + 0.01);
      g.add(s);
      cols.push({ cx: 0, cy: def.h / 2, cz: -D / 2 + 0.03, hx: W / 2, hy: def.h / 2, hz: 0.03 }, { cx: -W / 2 + 0.03, cy: def.h / 2, cz: 0, hx: 0.03, hy: def.h / 2, hz: D / 2 }, { cx: W / 2 - 0.03, cy: def.h / 2, cz: 0, hx: 0.03, hy: def.h / 2, hz: D / 2 }, { cx: -W * 0.27, cy: def.h / 2, cz: D / 2 - 0.03, hx: W * 0.225, hy: def.h / 2, hz: 0.03 });
      break;
    }
    case 'paniers': {
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(boxGeo(0.4, 0.08, 0.3), mat(0xe84118, { rough: 0.5 }));
        b.position.y = 0.06 + i * 0.07;
        b.rotation.y = (i % 2) * 0.08;
        g.add(b);
      }
      cols.push({ cx: 0, cy: 0.25, cz: 0, hx: 0.21, hy: 0.25, hz: 0.16 });
      break;
    }
    case 'caddies': {
      for (let i = 0; i < 5; i++) {
        const c = cartMesh(st.accent);
        c.position.set(-W / 2 + 0.55, 0, -D / 2 + 0.5 + i * 0.12);
        c.rotation.y = Math.PI / 2;
        g.add(c);
      }
      box(g, W, 0.05, 0.05, 0, 1.0, -D / 2 + 0.05, metalMat());
      full(1.0, 0.05);
      break;
    }
    case 'poubelle':
      cyl(g, 0.2, 0.85, 0, 0, 0, mat(0x2d3436, { rough: 0.5, metal: 0.3 }), 14);
      cols.push({ cx: 0, cy: 0.42, cz: 0, hx: 0.2, hy: 0.42, hz: 0.2 });
      break;
    case 'extincteur':
      cyl(g, 0.08, 0.5, 0, 0.05, 0, mat(0xd63031, { rough: 0.35, metal: 0.2 }), 12);
      box(g, 0.24, 0.05, 0.24, 0, 0, 0, dark());
      cyl(g, 0.02, 0.08, 0, 0.55, 0, dark(), 6);
      cols.push({ cx: 0, cy: 0.3, cz: 0, hx: 0.12, hy: 0.3, hz: 0.12 });
      break;
    case 'panneau_rayon': {
      const tex = signTexture('➜ RAYONS', st.accent, 0xffffff, 256, 64);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
      s.position.y = 2.7;
      g.add(s);
      for (const sx of [-0.35, 0.35]) cyl(g, 0.004, WALL_H - 2.82, sx, 2.82, 0, dark(), 4, false);
      break;
    }
    case 'cafe_client': {
      box(g, 0.45, 1.6, 0.45, 0, 0, 0, mat(0x4b2e1e, { rough: 0.4, metal: 0.3 }));
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.MeshStandardMaterial({ map: signTexture('CAFÉ 1€', 0x4b2e1e, 0xffe7b3, 128, 128) }));
      f.position.set(0, 1.2, 0.231);
      g.add(f);
      cols.push({ cx: 0, cy: 0.8, cz: 0, hx: 0.23, hy: 0.8, hz: 0.23 });
      break;
    }
    case 'plante': {
      cyl(g, 0.17, 0.35, 0, 0, 0, mat(0xb85c38, { rough: 0.8 }), 12);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(sphereGeo(0.18 + (i % 3) * 0.04, 8), mat(0x3c8d2f, { rough: 0.8, flat: true }));
        leaf.position.set(Math.sin(i * 2.1) * 0.12, 0.6 + i * 0.13, Math.cos(i * 2.1) * 0.12);
        leaf.castShadow = true;
        g.add(leaf);
      }
      cols.push({ cx: 0, cy: 0.5, cz: 0, hx: 0.18, hy: 0.5, hz: 0.18 });
      break;
    }
    case 'affiche': {
      const tex = signTexture('PROMO DU SIÈCLE', 0xffd32a, 0xe84118, 256, 256);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 1.2), new THREE.MeshStandardMaterial({ map: tex }));
      p.position.set(0, 1.6, -D / 2 + 0.03);
      g.add(p);
      box(g, W * 0.94, 1.26, 0.02, 0, 1.0 - 0.03, -D / 2 + 0.01, mat(0x2d3436));
      break;
    }
    case 'ballons': {
      const cols3 = [0xe84118, 0xfbc531, 0x0097e6, 0x44bd32, 0x9c88ff];
      const balls: THREE.Mesh[] = [];
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(sphereGeo(0.17, 12), mat(cols3[i], { rough: 0.2, metal: 0.05 }));
        b.scale.y = 1.2;
        b.position.set(Math.sin(i * 1.3) * 0.18, 1.9 + (i % 3) * 0.15, Math.cos(i * 1.3) * 0.18);
        g.add(b);
        balls.push(b);
        const str = new THREE.Mesh(cylGeo(0.003, 0.003, 1.8, 3), white());
        str.position.set(b.position.x / 2, 0.9 + (i % 3) * 0.07, b.position.z / 2);
        g.add(str);
      }
      box(g, 0.12, 0.12, 0.12, 0, 0, 0, mat(0x2d3436));
      animate = (t) => balls.forEach((b, i) => (b.position.y = 1.9 + (i % 3) * 0.15 + Math.sin(t * 1.5 + i) * 0.04));
      break;
    }
    case 'tapis': {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.95, D * 0.95), mat(0x5d4037, { rough: 1 }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.006;
      m.receiveShadow = true;
      g.add(m);
      break;
    }
    case 'spot': {
      cyl(g, 0.004, 0.8, 0, WALL_H - 0.8, 0, dark(), 4, false);
      const shade = new THREE.Mesh(cylGeo(0.05, 0.16, 0.18, 14, ), mat(0x2d3436, { metal: 0.5, rough: 0.4 }));
      shade.position.y = WALL_H - 0.88;
      g.add(shade);
      const bulb = new THREE.Mesh(sphereGeo(0.07, 10), lightMat(0xfff2cc));
      bulb.position.y = WALL_H - 0.98;
      g.add(bulb);
      if (radialGlowTexture()) {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlowTexture(0xfff2cc), transparent: true, depthWrite: false, opacity: 0.6, blending: THREE.AdditiveBlending }));
        glow.scale.set(0.8, 0.8, 1);
        glow.position.y = WALL_H - 1.0;
        g.add(glow);
      }
      break;
    }
    case 'neon': {
      const tex = signTexture('OUVERT', 0x1e1e1e, 0xff4fd8, 256, 96);
      const m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: powerOn ? 1.6 : 0 });
      lights.push(m);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 0.4), m);
      p.position.set(0, 2.4, -D / 2 + 0.03);
      g.add(p);
      animate = (t) => (m.emissiveIntensity = powerOn ? 1.4 + Math.sin(t * 13) * (Math.sin(t * 0.7) > 0.95 ? 1 : 0.05) : 0);
      break;
    }
    default:
      box(g, W, def.h, D, 0, 0, 0, mat(0xff00ff));
      full();
  }
  // modèle Blender (si disponible) à la place de la géométrie procédurale ; collisions inchangées
  const kitLights: THREE.MeshStandardMaterial[] = [];
  const kit = kitEquipment(e.def, st, !broken && powerOn, kitLights);
  if (kit) {
    g.clear();
    lights.length = 0;
    lights.push(...kitLights);
    g.add(kit);
    animate = undefined;
  }
  if (broken) {
    const warn = emojiTexture('⚠️');
    if (warn) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: warn, depthTest: false, transparent: true }));
      sp.scale.set(0.45, 0.45, 1);
      sp.position.y = Math.min(def.h, WALL_H - 0.6) + 0.45;
      sp.renderOrder = 10;
      g.add(sp);
    }
  }
  if (!animate) mergeStatic(g);
  return { root: g, colliders: cols, animate, lights };
}

/** Chariot de supermarché (aussi utilisé pour les caddies des clients). */
export function cartMesh(accent = 0xe84118): THREE.Group {
  const g = new THREE.Group();
  const wire = mat(0xc8d6e5, { rough: 0.3, metal: 0.8 });
  const basket = new THREE.Mesh(boxGeo(0.5, 0.36, 0.8), mat(0xc8d6e5, { rough: 0.3, metal: 0.7, transparent: true, opacity: 0.55 }));
  basket.position.set(0, 0.72, 0);
  g.add(basket);
  box(g, 0.52, 0.03, 0.82, 0, 0.53, 0, wire);
  box(g, 0.5, 0.04, 0.04, 0, 0.98, -0.45, mat(accent));
  for (const sx of [-0.2, 0.2]) {
    box(g, 0.025, 0.5, 0.025, sx, 0.05, -0.38, wire, false);
    box(g, 0.025, 0.5, 0.025, sx, 0.05, 0.36, wire, false);
    for (const sz of [-0.38, 0.36]) {
      const wheel = new THREE.Mesh(cylGeo(0.05, 0.05, 0.03, 10), dark());
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, 0.05, sz);
      g.add(wheel);
    }
  }
  box(g, 0.48, 0.02, 0.5, 0, 0.2, 0, wire, false);
  return g;
}

export function basketMesh(): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(boxGeo(0.38, 0.18, 0.26), mat(0xe84118, { rough: 0.5 }));
  b.position.y = -0.12;
  g.add(b);
  const h = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 4, 10, Math.PI), dark());
  h.position.y = -0.03;
  g.add(h);
  return g;
}
