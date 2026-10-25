/**
 * Personnages 3D procéduraux : un unique SkinnedMesh par personnage (couleurs par sommet, matériau partagé),
 * squelette articulé (hanches, colonne, bras, jambes, tête, sourcils, bouche) animé par entities/animator.ts.
 *
 * Architecture remplaçable : toute implémentation fournissant `CharacterRig` (par ex. un modèle glTF riggé)
 * peut être branchée à la place de `buildCharacter` sans toucher aux IA.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../core/rng';

export type HairStyle = 'court' | 'long' | 'chignon' | 'chauve' | 'afro' | 'queue' | 'meche' | 'tresses' | 'gris';
export type TopStyle = 'tshirt' | 'pull' | 'veste' | 'chemise' | 'robe' | 'hoodie' | 'doudoune';
export type BottomStyle = 'pantalon' | 'short' | 'jupe' | 'jogging';
export type Hat = null | 'casquette' | 'bonnet' | 'foulard' | 'beret' | 'casque';

export interface Appearance {
  female: boolean;
  age: number;
  height: number;
  width: number;
  belly: number;
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  top: number;
  topStyle: TopStyle;
  bottom: number;
  bottomStyle: BottomStyle;
  shoes: number;
  hat: Hat;
  hatColor: number;
  glasses: boolean;
  beard: boolean;
  apron: number | null;
  vest: number | null;
}

const SKINS = [0xf6d5b8, 0xeac4a0, 0xd9a77e, 0xc68a5f, 0xa86b45, 0x8a5434, 0x6b3f26, 0x4f2e1c];
const HAIRS = [0x1b1210, 0x2b1b12, 0x4a2f1d, 0x6d4a2b, 0xa57a4a, 0xd8b06a, 0x8f3b1f, 0x101010];
const CLOTHES = [0x2d3436, 0x0984e3, 0xd63031, 0x00b894, 0xfdcb6e, 0x6c5ce7, 0xe17055, 0xdfe6e9, 0x636e72, 0x2c3e50, 0x8e44ad, 0x16a085, 0xf8a5c2, 0x1e3799, 0x6ab04c, 0xb33939, 0xffffff, 0x000000];
const PANTS = [0x2d3436, 0x1e3799, 0x34495e, 0x4b6584, 0x7f8c8d, 0x5d4037, 0x2c2c54, 0x111111, 0xc8b28a];

export function randomAppearance(rng: Rng, o: { female: boolean; age: number; archetype?: string; uniform?: number | null; role?: string }): Appearance {
  const old = o.age >= 62;
  const young = o.age < 18;
  const female = o.female;
  const height = (female ? 1.64 : 1.77) + rng.gauss(0, 0.06) - (young ? 0.12 : 0) - (old ? 0.04 : 0);
  let hairStyle: HairStyle = female ? rng.pick(['long', 'chignon', 'queue', 'tresses', 'court', 'afro', 'meche'] as HairStyle[]) : rng.pick(['court', 'court', 'chauve', 'afro', 'meche', 'tresses', 'court'] as HairStyle[]);
  let hair = rng.pick(HAIRS);
  if (old) {
    hair = rng.pick([0xd0d0d0, 0xbdbdbd, 0xeeeeee, 0x9e9e9e]);
    if (!female && rng.chance(0.4)) hairStyle = 'chauve';
  }
  const topStyle: TopStyle = o.uniform !== undefined && o.uniform !== null ? 'chemise' : rng.pick(young ? (['hoodie', 'tshirt', 'hoodie', 'doudoune'] as TopStyle[]) : old ? (['pull', 'veste', 'chemise', 'pull'] as TopStyle[]) : female ? (['tshirt', 'pull', 'veste', 'robe', 'chemise', 'doudoune'] as TopStyle[]) : (['tshirt', 'pull', 'veste', 'chemise', 'hoodie', 'doudoune'] as TopStyle[]));
  const bottomStyle: BottomStyle = topStyle === 'robe' ? 'jupe' : female && rng.chance(0.15) ? 'jupe' : young && rng.chance(0.4) ? 'jogging' : rng.chance(0.08) ? 'short' : 'pantalon';
  let hat: Hat = null;
  if (o.role === 'logisticien' && rng.chance(0.5)) hat = 'casquette';
  else if (rng.chance(young ? 0.3 : 0.12)) hat = rng.pick(['casquette', 'bonnet', 'casquette'] as Hat[]);
  else if (female && rng.chance(0.12)) hat = 'foulard';
  else if (old && !female && rng.chance(0.2)) hat = 'beret';
  return {
    female,
    age: o.age,
    height,
    width: Math.max(0.82, Math.min(1.3, 1 + rng.gauss(0, 0.08) + (female ? -0.06 : 0))),
    belly: Math.max(0, Math.min(1, rng.gauss(old ? 0.45 : 0.2, 0.2))),
    skin: rng.pick(SKINS),
    hair,
    hairStyle,
    top: o.uniform ?? rng.pick(CLOTHES),
    topStyle,
    bottom: o.uniform !== undefined && o.uniform !== null ? 0x2d3436 : rng.pick(PANTS),
    bottomStyle,
    shoes: rng.pick([0x111111, 0xffffff, 0x5d4037, 0x2d3436, 0xe84118, 0x0984e3]),
    hat,
    hatColor: rng.pick(CLOTHES),
    glasses: rng.chance(old ? 0.55 : 0.18),
    beard: !female && !young && rng.chance(0.3),
    apron: o.uniform !== undefined && o.uniform !== null && o.role !== 'securite' && o.role !== 'manager' ? o.uniform : null,
    vest: o.role === 'securite' ? 0x1e272e : null,
  };
}

export const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'browL', 'browR', 'mouth', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR'] as const;
export type BoneName = (typeof BONES)[number];

export interface CharacterRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Hauteurs de référence (pour viser la tête, les mains...). */
  headY: number;
  scale: number;
  app: Appearance;
  dispose(): void;
}

let sharedMat: THREE.MeshStandardMaterial | null = null;
export function characterMaterial() {
  if (!sharedMat) sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  return sharedMat;
}

interface Piece {
  geo: THREE.BufferGeometry;
  bone: number;
  color: number;
}

const boneIdx = (b: BoneName) => BONES.indexOf(b);

function prep(p: Piece): THREE.BufferGeometry {
  let g = p.geo.index ? p.geo : p.geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(p.color).convertSRGBToLinear();
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    si[i * 4] = p.bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (!g.index) g = g.toNonIndexed();
  return g;
}

const geoCache = new Map<string, { geo: THREE.BufferGeometry; headY: number }>();
const HEAD_K = 1.13;
const appKey = (a: Appearance) => JSON.stringify(a);

function capsule(r: number, len: number, x: number, y0: number, y1: number, z = 0, sx = 1, sz = 1) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 8);
  g.scale(sx, 1, sz);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

/** Construit la géométrie fusionnée et les positions de bind des os pour une apparence. */
function buildGeometry(a: Appearance): { geo: THREE.BufferGeometry; headY: number } {
  const key = appKey(a);
  const c = geoCache.get(key);
  if (c) return c;
  const s = a.height / 1.75;
  const w = a.width;
  const P: Piece[] = [];
  const add = (geo: THREE.BufferGeometry, bone: BoneName, color: number) => P.push({ geo, bone: boneIdx(bone), color });
  const hipsY = 0.95 * s;
  const chestY = 1.27 * s;
  const neckY = 1.47 * s;
  const headY = 1.55 * s;
  const headC = headY + 0.115 * s;
  const shY = 1.44 * s;
  const shX = 0.175 * w * s;
  const elY = 1.15 * s;
  const haY = 0.89 * s;
  const thX = 0.09 * w * s;
  const knY = 0.49 * s;
  const ftY = 0.07 * s;
  const skin = a.skin;
  const top = a.top;
  const bottom = a.bottom;
  const longSleeves = a.topStyle !== 'tshirt' && a.topStyle !== 'robe';
  const torsoColor = a.vest ?? top;

  // Bassin / ventre / torse
  add(capsule(0.14 * w * s, 0.05 * s, 0, hipsY - 0.06 * s, hipsY + 0.06 * s, 0, 1.15, 0.85), 'hips', a.topStyle === 'robe' ? top : bottom);
  add(capsule((0.135 + a.belly * 0.05) * w * s, 0.1 * s, 0, hipsY + 0.06 * s, chestY - 0.02 * s, 0.01 + a.belly * 0.03, 1.1, 0.85 + a.belly * 0.25), 'spine', torsoColor);
  const chest = capsule(0.16 * w * s, 0.12 * s, 0, chestY - 0.06 * s, chestY + 0.15 * s, 0, 1.15, 0.72);
  add(chest, 'chest', torsoColor);
  if (a.female) {
    const b = new THREE.SphereGeometry(0.05 * s, 10, 8);
    b.scale(1.7, 0.85, 0.75);
    b.translate(0, chestY + 0.05 * s, 0.07 * s);
    add(b, 'chest', torsoColor);
  }
  if (a.topStyle === 'doudoune' || a.topStyle === 'hoodie') {
    const hood = new THREE.TorusGeometry(0.1 * s, 0.035 * s, 6, 12);
    hood.rotateX(Math.PI / 2);
    hood.translate(0, neckY - 0.02 * s, -0.03 * s);
    add(hood, 'chest', torsoColor);
  }
  if (a.apron !== null) {
    const ap = new THREE.BoxGeometry(0.3 * w * s, 0.55 * s, 0.02);
    ap.translate(0, hipsY + 0.08 * s, 0.13 * s + a.belly * 0.04);
    add(ap, 'spine', a.apron);
    const badge = new THREE.BoxGeometry(0.06 * s, 0.03 * s, 0.01);
    badge.translate(0.07 * s, chestY + 0.08 * s, 0.12 * s);
    add(badge, 'chest', 0xffffff);
  }
  if (a.vest !== null) {
    const band = new THREE.BoxGeometry(0.34 * w * s, 0.04 * s, 0.24 * s);
    band.translate(0, chestY + 0.02 * s, 0);
    add(band, 'chest', 0xf1c40f);
  }
  // Jupe / robe
  if (a.bottomStyle === 'jupe') {
    const sk = new THREE.CylinderGeometry(0.15 * w * s, 0.24 * w * s, 0.42 * s, 12, 1, true);
    sk.translate(0, hipsY - 0.2 * s, 0);
    add(sk, 'hips', a.topStyle === 'robe' ? top : bottom);
  }
  // Cou, tête
  add(capsule(0.05 * s, 0.06 * s, 0, neckY - 0.02 * s, headY + 0.02 * s), 'neck', skin);
  const head = new THREE.SphereGeometry(0.108 * s, 14, 10);
  head.scale(0.92, 1.08, 0.98);
  head.translate(0, headC, 0.005);
  add(head, 'head', skin);
  const nose = new THREE.SphereGeometry(0.018 * s, 6, 4);
  nose.scale(1, 1.2, 1.4);
  nose.translate(0, headC - 0.005 * s, 0.105 * s);
  add(nose, 'head', skin);
  for (const sx of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.022 * s, 6, 4);
    ear.scale(0.5, 1, 0.8);
    ear.translate(sx * 0.1 * s, headC, 0);
    add(ear, 'head', skin);
    const eye = new THREE.SphereGeometry(0.02 * s, 10, 8);
    eye.translate(sx * 0.038 * s, headC + 0.022 * s, 0.088 * s);
    add(eye, 'head', 0xffffff);
    const pupil = new THREE.SphereGeometry(0.0105 * s, 8, 6);
    pupil.translate(sx * 0.038 * s, headC + 0.022 * s, 0.106 * s);
    add(pupil, 'head', 0x1a1410);
  }
  // sourcils (os dédiés pour les expressions)
  for (const [sx, bn] of [[-1, 'browR'], [1, 'browL']] as const) {
    const br = new THREE.BoxGeometry(0.04 * s, 0.009 * s, 0.01 * s);
    br.translate(sx * 0.038 * s, headC + 0.052 * s, 0.098 * s);
    add(br, bn, a.hairStyle === 'chauve' ? 0x6d4c41 : a.hair);
  }
  // bouche : arc de tore (sourire/grimace par rotation de l'os)
  const mouth = new THREE.TorusGeometry(0.026 * s, 0.006 * s, 4, 10, Math.PI);
  mouth.rotateZ(Math.PI);
  mouth.translate(0, headC - 0.035 * s, 0.098 * s);
  add(mouth, 'mouth', 0x7a2e2e);
  if (a.beard) {
    const bd = new THREE.SphereGeometry(0.085 * s, 10, 6, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
    bd.translate(0, headC + 0.005 * s, 0.02 * s);
    add(bd, 'head', a.hair);
  }
  if (a.glasses) {
    for (const sx of [-1, 1]) {
      const l = new THREE.TorusGeometry(0.022 * s, 0.004 * s, 4, 10);
      l.translate(sx * 0.038 * s, headC + 0.022 * s, 0.108 * s);
      add(l, 'head', 0x1e1e1e);
    }
    const bar = new THREE.BoxGeometry(0.03 * s, 0.004 * s, 0.004 * s);
    bar.translate(0, headC + 0.026 * s, 0.11 * s);
    add(bar, 'head', 0x1e1e1e);
  }
  // Cheveux
  const hairCol = a.hair;
  const scalp = (phiLen: number) => {
    const g = new THREE.SphereGeometry(0.116 * s, 14, 8, 0, Math.PI * 2, 0, phiLen);
    g.scale(0.95, 1.08, 1.02);
    g.translate(0, headC + 0.008 * s, -0.004);
    return g;
  };
  switch (a.hairStyle) {
    case 'chauve':
      break;
    case 'afro': {
      const g = new THREE.SphereGeometry(0.155 * s, 12, 8);
      g.translate(0, headC + 0.05 * s, -0.02 * s);
      add(g, 'head', hairCol);
      break;
    }
    case 'long': {
      add(scalp(Math.PI * 0.5), 'head', hairCol);
      const back = new THREE.BoxGeometry(0.22 * s, 0.3 * s, 0.07 * s);
      back.translate(0, headC - 0.1 * s, -0.08 * s);
      add(back, 'head', hairCol);
      break;
    }
    case 'chignon': {
      add(scalp(Math.PI * 0.5), 'head', hairCol);
      const bun = new THREE.SphereGeometry(0.055 * s, 8, 6);
      bun.translate(0, headC + 0.1 * s, -0.08 * s);
      add(bun, 'head', hairCol);
      break;
    }
    case 'queue': {
      add(scalp(Math.PI * 0.5), 'head', hairCol);
      const tail = capsule(0.03 * s, 0.16 * s, 0, headC - 0.14 * s, headC + 0.02 * s, -0.12 * s);
      add(tail, 'head', hairCol);
      break;
    }
    case 'tresses': {
      add(scalp(Math.PI * 0.48), 'head', hairCol);
      for (let i = -2; i <= 2; i++) {
        const t = capsule(0.014 * s, 0.22 * s, i * 0.035 * s, headC - 0.2 * s, headC, -0.1 * s);
        add(t, 'head', hairCol);
      }
      break;
    }
    case 'meche': {
      add(scalp(Math.PI * 0.42), 'head', hairCol);
      const m = new THREE.BoxGeometry(0.12 * s, 0.04 * s, 0.08 * s);
      m.rotateZ(0.3);
      m.translate(0.03 * s, headC + 0.09 * s, 0.07 * s);
      add(m, 'head', hairCol);
      break;
    }
    default:
      add(scalp(Math.PI * 0.4), 'head', hairCol);
  }
  // Couvre-chefs
  if (a.hat === 'casquette') {
    const c1 = new THREE.SphereGeometry(0.12 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    c1.translate(0, headC + 0.02 * s, 0);
    add(c1, 'head', a.hatColor);
    const brim = new THREE.BoxGeometry(0.16 * s, 0.012 * s, 0.1 * s);
    brim.translate(0, headC + 0.03 * s, 0.13 * s);
    add(brim, 'head', a.hatColor);
  } else if (a.hat === 'bonnet') {
    const c1 = new THREE.SphereGeometry(0.125 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    c1.scale(1, 1.2, 1);
    c1.translate(0, headC + 0.01 * s, -0.005);
    add(c1, 'head', a.hatColor);
  } else if (a.hat === 'foulard') {
    const c1 = new THREE.SphereGeometry(0.128 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.72);
    c1.translate(0, headC + 0.005 * s, -0.012 * s);
    add(c1, 'head', a.hatColor);
    const nk = new THREE.CylinderGeometry(0.08 * s, 0.11 * s, 0.1 * s, 10);
    nk.translate(0, neckY + 0.02 * s, -0.01);
    add(nk, 'neck', a.hatColor);
  } else if (a.hat === 'beret') {
    const b = new THREE.CylinderGeometry(0.13 * s, 0.12 * s, 0.03 * s, 12);
    b.rotateX(-0.15);
    b.translate(0, headC + 0.1 * s, -0.01);
    add(b, 'head', 0x1e1e1e);
  } else if (a.hat === 'casque') {
    const c1 = new THREE.SphereGeometry(0.13 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    c1.translate(0, headC + 0.02 * s, 0);
    add(c1, 'head', 0xf1c40f);
  }
  // Bras
  for (const [sx, sh, el, ha] of [[1, 'shoulderL', 'elbowL', 'handL'], [-1, 'shoulderR', 'elbowR', 'handR']] as const) {
    const x = sx * shX;
    add(new THREE.SphereGeometry(0.062 * w * s, 8, 6).translate(x, shY, 0), sh, torsoColor);
    add(capsule(0.058 * w * s, 0.2 * s, x, elY + 0.02 * s, shY - 0.02 * s), sh, longSleeves || a.topStyle === 'tshirt' ? torsoColor : skin);
    add(capsule(0.05 * w * s, 0.18 * s, x, haY + 0.03 * s, elY - 0.01 * s), el, longSleeves ? torsoColor : skin);
    const hand = new THREE.SphereGeometry(0.045 * s, 8, 6);
    hand.scale(0.8, 1.2, 0.6);
    hand.translate(x, haY - 0.04 * s, 0);
    add(hand, ha, skin);
  }
  // Jambes
  const shinColor = a.bottomStyle === 'short' || a.bottomStyle === 'jupe' ? skin : bottom;
  for (const [sx, th, kn, ft] of [[1, 'thighL', 'kneeL', 'footL'], [-1, 'thighR', 'kneeR', 'footR']] as const) {
    const x = sx * thX;
    add(capsule(0.082 * w * s, 0.32 * s, x, knY + 0.02 * s, hipsY - 0.04 * s), th, a.bottomStyle === 'jupe' ? skin : bottom);
    add(capsule(0.064 * w * s, 0.33 * s, x, ftY + 0.06 * s, knY), kn, shinColor);
    const foot = new THREE.BoxGeometry(0.09 * s, 0.07 * s, 0.24 * s);
    foot.translate(x, ftY - 0.02 * s, 0.05 * s);
    add(foot, ft, a.shoes);
  }
  // tête légèrement agrandie (style cartoon expressif) autour du centre de la tête
  const headBones = new Set([boneIdx('head'), boneIdx('browL'), boneIdx('browR'), boneIdx('mouth')]);
  for (const piece of P)
    if (headBones.has(piece.bone)) {
      piece.geo.translate(0, -headC, 0);
      piece.geo.scale(HEAD_K, HEAD_K, HEAD_K);
      piece.geo.translate(0, headC, 0);
    }
  const geo = mergeGeometries(P.map(prep), false)!;
  geo.computeBoundingSphere();
  const res = { geo, headY: headC };
  geoCache.set(key, res);
  if (geoCache.size > 400) {
    const first = geoCache.keys().next().value!;
    geoCache.delete(first);
  }
  return res;
}

function bindPositions(a: Appearance): Record<BoneName, [number, number, number]> {
  const s = a.height / 1.75;
  const w = a.width;
  return {
    root: [0, 0, 0],
    hips: [0, 0.95 * s, 0],
    spine: [0, 0.12 * s, 0],
    chest: [0, 0.2 * s, 0],
    neck: [0, 0.2 * s, 0],
    head: [0, 0.08 * s, 0],
    browL: [0.038 * s * HEAD_K, (0.115 + 0.052 * HEAD_K) * s, 0.098 * s * HEAD_K],
    browR: [-0.038 * s * HEAD_K, (0.115 + 0.052 * HEAD_K) * s, 0.098 * s * HEAD_K],
    mouth: [0, (0.115 - 0.035 * HEAD_K) * s, 0.098 * s * HEAD_K],
    shoulderL: [0.175 * w * s, 0.17 * s, 0],
    elbowL: [0, -0.29 * s, 0],
    handL: [0, -0.26 * s, 0],
    shoulderR: [-0.175 * w * s, 0.17 * s, 0],
    elbowR: [0, -0.29 * s, 0],
    handR: [0, -0.26 * s, 0],
    thighL: [0.09 * w * s, -0.04 * s, 0],
    kneeL: [0, -0.42 * s, 0],
    footL: [0, -0.42 * s, 0],
    thighR: [-0.09 * w * s, -0.04 * s, 0],
    kneeR: [0, -0.42 * s, 0],
    footR: [0, -0.42 * s, 0],
  };
}

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', browL: 'head', browR: 'head', mouth: 'head',
  shoulderL: 'chest', elbowL: 'shoulderL', handL: 'elbowL', shoulderR: 'chest', elbowR: 'shoulderR', handR: 'elbowR',
  thighL: 'hips', kneeL: 'thighL', footL: 'kneeL', thighR: 'hips', kneeR: 'thighR', footR: 'kneeR',
};

export function buildCharacter(a: Appearance): CharacterRig {
  const { geo, headY } = buildGeometry(a);
  const pos = bindPositions(a);
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(...pos[n]);
    bones[n] = b;
  }
  for (const n of BONES) {
    const p = PARENT[n];
    if (p) bones[p].add(bones[n]);
  }
  // la bouche et les sourcils sont positionnés relativement à la tête : convertir (positions ci-dessus = relatives à la tête)
  const root = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(geo, characterMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.add(bones.root);
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));
  mesh.bind(skeleton);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);
  (mesh as any).frustumCulled = true;
  return {
    root,
    mesh,
    bones,
    headY,
    scale: a.height / 1.75,
    app: a,
    dispose() {
      skeleton.dispose();
    },
  };
}
