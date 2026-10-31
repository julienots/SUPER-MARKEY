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
import { buildKitCharacter, kitReady } from './kitCharacter';
import { buildHuman, humanKitReady, mergeHumanExtras, type HumanBody, type HumanBuild } from './human';

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
  /** Morphologie réaliste (kit humain) ; absente → personnage procédural simple. */
  body?: HumanBody;
}

const CLOTHES = [0x0984e3, 0xd63031, 0x00b894, 0xfdcb6e, 0x6c5ce7, 0xe17055, 0xdfe6e9, 0x74b9ff, 0x55efc4, 0xfab1a0, 0x8e44ad, 0x16a085, 0xf8a5c2, 0x1e3799, 0x6ab04c, 0xb33939, 0xffffff, 0xe1b12c, 0x7f8fa6, 0xc7b299, 0x8b1e3f, 0x4b7bec, 0xff9f43, 0x2d3436, 0x636e72];
const PANTS = [0x2c4a7a, 0x3d5a80, 0x34495e, 0x4b6584, 0x7f8c8d, 0xc8b28a, 0x5d6d7e, 0x8395a7, 0x2f3542, 0x6b4f3a, 0x1e3799, 0xa4b0be];
/** Origines (mélanges) et teintes de peau associées : un quartier populaire très divers. */
type Origin = 'afrique' | 'maghreb' | 'asie' | 'europe' | 'metisse';
const SKIN_BY_ORIGIN: Record<Origin, number[]> = {
  afrique: [0x7a4c34, 0x86563b, 0x925f42, 0x9e6a4b, 0xa87452, 0x8c5a3e, 0xb07c58],
  maghreb: [0xd9a885, 0xcf9b76, 0xe3b893, 0xc89068, 0xdcae8a, 0xd4a07c],
  asie: [0xf0d0b0, 0xe8c4a0, 0xe2bc94, 0xf3d6b8, 0xdcb28a, 0xeccaa6],
  europe: [0xf6dccb, 0xf3d3bd, 0xeccaae, 0xfae4d6, 0xe6bd9e, 0xf0cfb5],
  metisse: [0xc4906a, 0xb98458, 0xcd9c74, 0xae7a54, 0xd4a680],
};
const DARK_HAIR = [0x0d0b0a, 0x1b1210, 0x1a1412, 0x2b1b12];
const EURO_HAIR = [0x2b1b12, 0x4a2f1d, 0x6d4a2b, 0xa57a4a, 0xd8b06a, 0x8f3b1f, 0xc9a25f, 0x3a2416];
const EYES = { brun: 0x4a2e1a, noisette: 0x7a5a2c, vert: 0x5b7a4a, bleu: 0x5a7fa8, gris: 0x7d8a93, noir: 0x24160e };

function pickOrigin(rng: Rng): { origin: Origin; african: number; asian: number; caucasian: number } {
  const r = rng.next();
  const j = () => rng.next();
  if (r < 0.3) {
    const af = 0.8 + j() * 0.2;
    return { origin: 'afrique', african: af, asian: 0, caucasian: 1 - af };
  }
  if (r < 0.52) {
    const ca = 0.72 + j() * 0.2;
    return { origin: 'maghreb', african: (1 - ca) * 0.8, asian: (1 - ca) * 0.2, caucasian: ca };
  }
  if (r < 0.62) {
    const as = 0.75 + j() * 0.25;
    return { origin: 'asie', african: 0, asian: as, caucasian: 1 - as };
  }
  if (r < 0.74) {
    const af = 0.35 + j() * 0.3;
    const as = j() * 0.15;
    return { origin: 'metisse', african: af, asian: as, caucasian: 1 - af - as };
  }
  const ca = 0.85 + j() * 0.15;
  return { origin: 'europe', african: (1 - ca) * j(), asian: (1 - ca) * 0.5, caucasian: ca };
}

export function randomAppearance(rng: Rng, o: { female: boolean; age: number; archetype?: string; uniform?: number | null; role?: string }): Appearance {
  const old = o.age >= 62;
  const young = o.age < 18;
  const female = o.female;
  const height = (female ? 1.64 : 1.77) + rng.gauss(0, 0.06) - (young ? 0.08 : 0) - (old ? 0.04 : 0);
  const og = pickOrigin(rng);
  const afroTexture = og.origin === 'afrique' || (og.origin === 'metisse' && rng.chance(0.6));
  let hairStyle: HairStyle = female
    ? rng.pick((afroTexture ? ['afro', 'tresses', 'chignon', 'queue', 'court', 'tresses'] : ['long', 'chignon', 'queue', 'court', 'meche', 'long']) as HairStyle[])
    : rng.pick((afroTexture ? ['court', 'court', 'chauve', 'afro', 'tresses', 'court'] : ['court', 'court', 'chauve', 'meche', 'court', 'long']) as HairStyle[]);
  let hair = og.origin === 'europe' ? rng.pick(EURO_HAIR) : og.origin === 'maghreb' ? rng.pick([...DARK_HAIR, 0x3a2416]) : rng.pick(DARK_HAIR);
  if (rng.chance(0.06) && !old) hair = rng.pick([0x8e44ad, 0xd63031, 0x0984e3, 0xf5e6a8, 0xe84393]);
  if (old || (o.age > 50 && rng.chance(0.5))) {
    hair = rng.pick([0xd0d0d0, 0xbdbdbd, 0xeeeeee, 0x9e9e9e, 0x8a8a8a]);
    if (!female && rng.chance(0.4)) hairStyle = 'chauve';
  }
  const topStyle: TopStyle = o.uniform !== undefined && o.uniform !== null ? 'chemise' : rng.pick(young ? (['hoodie', 'tshirt', 'hoodie', 'doudoune'] as TopStyle[]) : old ? (['pull', 'veste', 'chemise', 'pull'] as TopStyle[]) : female ? (['tshirt', 'pull', 'veste', 'robe', 'chemise', 'doudoune'] as TopStyle[]) : (['tshirt', 'pull', 'veste', 'chemise', 'hoodie', 'doudoune'] as TopStyle[]));
  const bottomStyle: BottomStyle = topStyle === 'robe' ? 'jupe' : female && rng.chance(0.15) ? 'jupe' : young && rng.chance(0.4) ? 'jogging' : rng.chance(0.08) ? 'short' : 'pantalon';
  let hat: Hat = null;
  if (o.role === 'logisticien' && rng.chance(0.5)) hat = 'casquette';
  else if (rng.chance(young ? 0.3 : 0.12)) hat = rng.pick(['casquette', 'bonnet', 'casquette'] as Hat[]);
  else if (female && rng.chance(og.origin === 'maghreb' || og.origin === 'afrique' ? 0.22 : 0.05)) hat = 'foulard';
  else if (old && !female && rng.chance(0.2)) hat = 'beret';
  const weight = Math.max(0.05, Math.min(0.98, rng.gauss(old ? 0.58 : young ? 0.42 : 0.5, 0.17)));
  const muscle = Math.max(0.05, Math.min(0.95, rng.gauss(female ? 0.42 : old ? 0.42 : 0.55, 0.14)));
  const eyes = og.origin === 'europe' ? rng.pick([EYES.brun, EYES.brun, EYES.noisette, EYES.vert, EYES.bleu, EYES.bleu, EYES.gris]) : og.origin === 'maghreb' ? rng.pick([EYES.brun, EYES.brun, EYES.noisette, EYES.vert]) : rng.pick([EYES.brun, EYES.noir, EYES.brun]);
  const face: number[] = [];
  for (let i = 0; i < 24; i++) face.push(Math.max(-1, Math.min(1, rng.gauss(0, 0.42))));
  return {
    female,
    age: o.age,
    height,
    width: Math.max(0.82, Math.min(1.3, 0.86 + weight * 0.3 + (female ? -0.04 : 0))),
    belly: Math.max(0, Math.min(1, (weight - 0.45) * 1.6 + (old ? 0.15 : 0) + rng.gauss(0, 0.1))),
    skin: rng.pick(SKIN_BY_ORIGIN[og.origin]),
    hair,
    hairStyle,
    top: o.uniform ?? rng.pick(CLOTHES),
    topStyle,
    bottom: o.uniform !== undefined && o.uniform !== null ? 0x2d3436 : rng.pick(PANTS),
    bottomStyle,
    shoes: rng.pick([0xffffff, 0xf5f6fa, 0x5d4037, 0x2d3436, 0xe84118, 0x0984e3, 0xdcdde1, 0x8c7ae6, 0x111111]),
    hat,
    hatColor: hat === 'foulard' ? rng.pick([0x2d3436, 0x6c5ce7, 0xb33939, 0x1e3799, 0xc7b299, 0x16a085, 0xf8a5c2, 0x4b5320]) : rng.pick(CLOTHES),
    glasses: rng.chance(old ? 0.55 : 0.18),
    beard: !female && !young && rng.chance(og.origin === 'maghreb' ? 0.45 : 0.3),
    apron: o.uniform !== undefined && o.uniform !== null && o.role !== 'securite' && o.role !== 'manager' ? o.uniform : null,
    vest: o.role === 'securite' ? 0x1e272e : null,
    body: { african: og.african, asian: og.asian, caucasian: og.caucasian, muscle, weight, face, eyes },
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
  /** Positions de repos des os (relatives au parent) : les animations s'y réfèrent. */
  rest?: Record<BoneName, THREE.Vector3>;
  /** Visage par morph targets (personnages réalistes). */
  face?: (expr: string, mouthOpen: number, blink: boolean) => void;
  dispose(): void;
}

/** Expressions faciales activées (désactivées en qualité basse : moins de mémoire GPU). */
export const humanOptions = { expressions: true };

let humanMat: THREE.MeshStandardMaterial | null = null;
export function humanMaterial() {
  if (!humanMat) {
    humanMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
    // l'alpha des couleurs par sommet porte la rugosité (yeux brillants, peau satinée, tissu mat) ;
    // une petite lumière propre évite les visages « bouchés » dans les zones sombres
    humanMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_COLOR_ALPHA\n  float vRough = vColor.a;\n  diffuseColor.a = 1.0;\n#endif')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n#ifdef USE_COLOR_ALPHA\n  roughnessFactor = vRough;\n#endif')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.12;');
    };
    humanMat.customProgramCacheKey = () => 'bazar-human-v2';
  }
  return humanMat;
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

export const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', browL: 'head', browR: 'head', mouth: 'head',
  shoulderL: 'chest', elbowL: 'shoulderL', handL: 'elbowL', shoulderR: 'chest', elbowR: 'shoulderR', handR: 'elbowR',
  thighL: 'hips', kneeL: 'thighL', footL: 'kneeL', thighR: 'hips', kneeR: 'thighR', footR: 'kneeR',
};

/** Accessoires rigides posés sur la vraie tête (cheveux longs, chapeaux, lunettes, capuche, badge). */
function humanExtras(a: Appearance, hb: HumanBuild): THREE.BufferGeometry[] {
  const P: Piece[] = [];
  const add = (geo: THREE.BufferGeometry, bone: BoneName, color: number) => P.push({ geo, bone: boneIdx(bone), color });
  const { center: c, radius: r, top } = hb.head;
  const S = r / 0.1;
  const hc = a.hair;
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(c.x + x, c.y + y, c.z + z);
  switch (a.hat === 'foulard' ? 'chauve' : a.hairStyle) {
    case 'afro': {
      const g = new THREE.SphereGeometry(r * 1.42, 14, 10);
      g.scale(1.05, 0.95, 1);
      add(at(g, 0, (top - c.y) * 0.62, -0.025 * S), 'head', hc);
      break;
    }
    case 'long': {
      // masse de cheveux derrière la tête, jusqu'aux épaules
      const g = new THREE.SphereGeometry(r * 1.04, 16, 12);
      g.scale(1.06, 1.75, 0.72);
      add(at(g, 0, -0.07 * S, -0.042 * S), 'head', hc);
      break;
    }
    case 'chignon':
      add(at(new THREE.SphereGeometry(0.048 * S, 10, 8), 0, (top - c.y) * 0.75, -r * 0.95), 'head', hc);
      break;
    case 'queue':
      add(at(capsule(0.026 * S, 0.17 * S, 0, -0.17 * S, 0.0, 0), 0, 0, -r * 1.02), 'head', hc);
      break;
    case 'tresses':
      for (let i = -2; i <= 2; i++) add(at(capsule(0.012 * S, 0.22 * S, i * 0.03 * S, -0.24 * S, -0.02 * S, 0), 0, 0, -r * 0.98), 'head', hc);
      break;
    default:
      break;
  }
  // couvre-chefs ajustés au crâne réel
  const { halfX, halfZ, browY } = hb.head;
  const domeH = top - browY;
  const dome = (k: number, theta: number, lift: number) => {
    const g = new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, theta);
    g.scale(halfX * k, domeH * k * 1.02, halfZ * k);
    g.translate(c.x, browY + lift, c.z);
    return g;
  };
  if (a.hat === 'casquette') {
    add(dome(1.1, Math.PI * 0.5, 0.004 * S), 'head', a.hatColor);
    const brim = new THREE.CylinderGeometry(halfX * 0.95, halfX * 0.95, 0.008 * S, 16, 1, false, -Math.PI / 2, Math.PI);
    brim.scale(1, 1, 0.75);
    brim.translate(c.x, browY + 0.008 * S, c.z + halfZ * 0.92);
    add(brim, 'head', a.hatColor);
  } else if (a.hat === 'bonnet') {
    add(dome(1.12, Math.PI * 0.5, -0.006 * S), 'head', a.hatColor);
    const rib = new THREE.TorusGeometry(1, 0.11, 6, 18);
    rib.rotateX(Math.PI / 2);
    rib.scale(halfX * 1.1, 0.12, halfZ * 1.1);
    rib.translate(c.x, browY - 0.002 * S, c.z);
    add(rib, 'head', a.hatColor);
  } else if (a.hat === 'foulard') {
    const g = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    g.scale(halfX * 1.16, (top - c.y + 0.03 * S) * 1.05, halfZ * 1.12);
    g.translate(c.x, c.y - 0.005 * S, c.z - 0.01 * S);
    add(g, 'head', a.hatColor);
    const nk = new THREE.CylinderGeometry(halfX * 0.95, halfX * 1.45, 0.13 * S, 16);
    const nw = hb.rest.neck.clone().add(hb.rest.chest).add(hb.rest.spine).add(hb.rest.hips);
    nk.translate(0, nw.y + 0.03 * S, nw.z - 0.01);
    add(nk, 'neck', a.hatColor);
  } else if (a.hat === 'beret') {
    const b = new THREE.CylinderGeometry(halfX * 1.15, halfX * 1.05, 0.025 * S, 16);
    b.scale(1, 1, halfZ / halfX);
    b.rotateX(-0.12);
    b.translate(c.x, top - 0.012 * S, c.z - 0.008 * S);
    add(b, 'head', 0x1e1e1e);
  } else if (a.hat === 'casque') {
    add(dome(1.16, Math.PI * 0.5, 0.006 * S), 'head', 0xf1c40f);
  }
  if (a.glasses) {
    for (const e of [hb.head.eyeL, hb.head.eyeR]) {
      const l = new THREE.TorusGeometry(0.019 * S, 0.0028 * S, 4, 12);
      l.translate(e.x, e.y, e.z + 0.022 * S);
      add(l, 'head', 0x1e1e1e);
    }
    const mid = hb.head.eyeL.clone().add(hb.head.eyeR).multiplyScalar(0.5);
    const bar = new THREE.BoxGeometry(Math.abs(hb.head.eyeL.x - hb.head.eyeR.x) - 0.036 * S, 0.003 * S, 0.003 * S);
    bar.translate(mid.x, mid.y + 0.004 * S, mid.z + 0.024 * S);
    add(bar, 'head', 0x1e1e1e);
    for (const e of [hb.head.eyeL, hb.head.eyeR]) {
      const arm = new THREE.BoxGeometry(0.003 * S, 0.003 * S, 0.1 * S);
      arm.translate(e.x + Math.sign(e.x) * 0.02 * S, e.y + 0.004 * S, e.z - 0.03 * S);
      add(arm, 'head', 0x1e1e1e);
    }
  }
  const chestW = hb.rest.chest.clone().add(hb.rest.spine).add(hb.rest.hips);
  const neckW = chestW.clone().add(hb.rest.neck);
  if (a.topStyle === 'doudoune' || a.topStyle === 'hoodie') {
    const hood = new THREE.TorusGeometry(0.075 * S, 0.03 * S, 6, 14);
    hood.rotateX(Math.PI / 2);
    hood.translate(0, neckW.y - 0.01 * S, neckW.z - 0.035 * S);
    add(hood, 'chest', a.top);
  }
  if (a.apron !== null) {
    const badge = new THREE.BoxGeometry(0.06, 0.03, 0.006);
    badge.translate(0.07, chestW.y + 0.1 * (a.height / 1.75), chestW.z + 0.11 * (0.8 + a.body!.weight * 0.5));
    add(badge, 'chest', 0xffffff);
  }
  // boutons (chemise) ou fermeture éclair (veste, doudoune, hoodie) le long de la couture avant
  const front = hb.front.filter((p) => p.y > chestW.y - 0.32 * (a.height / 1.75) && p.y < neckW.y - 0.02);
  if (front.length > 4 && a.apron === null && a.vest === null) {
    if (a.topStyle === 'chemise') {
      for (let y = front[front.length - 1].y - 0.03; y > front[0].y + 0.02; y -= 0.075) {
        const p = front.reduce((b, q) => (Math.abs(q.y - y) < Math.abs(b.y - y) ? q : b));
        add(new THREE.SphereGeometry(0.0055, 6, 4).translate(p.x, p.y, p.z + 0.002), 'chest', 0xeeeeee);
      }
    } else if (a.topStyle === 'veste' || a.topStyle === 'doudoune' || a.topStyle === 'hoodie') {
      // fermeture éclair : tube lissé le long de la couture avant
      const pts = front.map((p, i) => {
        const a0 = front[Math.max(0, i - 1)];
        const a1 = front[Math.min(front.length - 1, i + 1)];
        return new THREE.Vector3(0, p.y, (a0.z + p.z + a1.z) / 3 + 0.0015);
      });
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.0028, 4, false);
      add(tube, 'chest', a.topStyle === 'hoodie' ? 0x9a9a9a : 0x2a2a2a);
    }
  }
  return P.map(prep).map((g) => {
    // couleurs RGBA (A = rugosité) comme le corps
    const c3 = g.attributes.color.array as Float32Array;
    const c4 = new Float32Array((c3.length / 3) * 4);
    for (let i = 0; i < c3.length / 3; i++) {
      c4[i * 4] = c3[i * 3];
      c4[i * 4 + 1] = c3[i * 3 + 1];
      c4[i * 4 + 2] = c3[i * 3 + 2];
      c4[i * 4 + 3] = 0.65;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c4, 4));
    if (!g.index) {
      const idx: number[] = [];
      for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
      g.setIndex(idx);
    }
    return g;
  });
}

const humanCache = new Map<string, { geo: THREE.BufferGeometry; hb: HumanBuild }>();

function buildHumanCharacter(a: Appearance): CharacterRig | null {
  const key = appKey(a) + humanOptions.expressions;
  let entry = humanCache.get(key);
  if (!entry) {
    const hb = buildHuman(a, humanOptions.expressions);
    if (!hb) return null;
    const geo = mergeHumanExtras(hb.geo, humanExtras(a, hb));
    geo.computeBoundingSphere();
    entry = { geo, hb };
    humanCache.set(key, entry);
    if (humanCache.size > 160) humanCache.delete(humanCache.keys().next().value!);
  }
  const { geo, hb } = entry;
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    const b = new THREE.Bone();
    b.name = n;
    b.position.copy(hb.rest[n]);
    bones[n] = b;
  }
  for (const n of BONES) {
    const p = PARENT[n];
    if (p) bones[p].add(bones[n]);
  }
  const root = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(geo, humanMaterial());
  mesh.castShadow = true;
  mesh.add(bones.root);
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));
  mesh.bind(skeleton);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3);
  const ex = hb.expressions;
  const id = (name: string) => ex.indexOf(name);
  const iSmile = id('smile');
  const iSad = id('sad');
  const iAngry = id('angry');
  const iSurp = id('surprised');
  const iOpen = id('open');
  const iBlink = id('blink');
  const infl = mesh.morphTargetInfluences;
  return {
    root,
    mesh,
    bones,
    headY: hb.headY,
    scale: a.height / 1.75,
    app: a,
    rest: hb.rest,
    face: infl && ex.length
      ? (expr, open, blink) => {
          infl[iSmile] = expr === 'happy' ? 0.85 : expr === 'neutral' ? 0.12 : 0;
          infl[iSad] = expr === 'sad' ? 0.9 : expr === 'bored' ? 0.35 : 0;
          infl[iAngry] = expr === 'angry' ? 1 : 0;
          infl[iSurp] = expr === 'surprised' ? 1 : 0;
          infl[iOpen] = Math.max(0, Math.min(1, (open - 0.25) * 0.45));
          infl[iBlink] = blink ? 1 : 0;
        }
      : undefined,
    dispose() {
      skeleton.dispose();
    },
  };
}

export function buildCharacter(a: Appearance): CharacterRig {
  // personnages du kit Blender (style figurine) en priorité
  if (kitReady()) {
    const k = buildKitCharacter(a);
    if (k) return k;
  }
  if (a.body && humanKitReady()) {
    const h = buildHumanCharacter(a);
    if (h) return h;
  }
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
