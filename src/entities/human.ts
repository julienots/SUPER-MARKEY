/**
 * Personnages réalistes : chaque client/employé est fabriqué à la volée à partir du « kit humain »
 * (public/humans, généré depuis MakeHuman, CC0) — morphologie (sexe, âge, muscle, poids, origines africaine/
 * asiatique/européenne), traits du visage, peau, yeux, vêtements, cheveux et accessoires — puis skinné sur le
 * squelette à 21 os du jeu (animé par entities/animator.ts). Les expressions passent par des morph targets.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance, BoneName } from './character';

interface TargetInfo {
  name: string;
  kind: 'macro' | 'face' | 'expression';
  tokens: string[] | null;
  scale: number;
  joints: number[];
  dense?: number;
  sparse?: { index: number; delta: number; count: number };
}
interface KitJson {
  vertexCount: number;
  baseCount: number;
  bones: string[];
  parts: Record<string, number>;
  joints: string[];
  jointBase: number[];
  ranges: Record<string, { start: number; count: number }>;
  buffers: Record<string, { offset: number; type: string; count: number }>;
  targets: TargetInfo[];
  expressions: string[];
}
interface Target {
  info: TargetInfo;
  dense?: Int16Array;
  index?: Uint16Array;
  delta?: Int16Array;
}
export interface HumanKit {
  json: KitJson;
  index: Uint16Array | Uint32Array;
  position: Float32Array;
  skinIndex: Uint8Array;
  skinWeight: Uint8Array;
  part: Uint8Array;
  coord: Uint8Array;
  lips: Uint8Array;
  brows: Uint8Array;
  scalp: Uint8Array;
  beard: Uint8Array;
  cheek: Uint8Array;
  eyeColor: Uint8Array;
  targets: Map<string, Target>;
  macro: Target[];
}

let kit: HumanKit | null = null;

/** Charge le kit (une fois). Renvoie false si indisponible (les personnages procéduraux simples prennent le relais). */
export async function loadHumanKit(base = './humans/'): Promise<boolean> {
  if (kit) return true;
  try {
    const [jr, br] = await Promise.all([fetch(base + 'kit.json'), fetch(base + 'kit.bin')]);
    if (!jr.ok || !br.ok) return false;
    const json = (await jr.json()) as KitJson;
    const bin = await br.arrayBuffer();
    const view = (name: string): any => {
      const b = json.buffers[name];
      const C = b.type === 'f32' ? Float32Array : b.type === 'u16' ? Uint16Array : b.type === 'u32' ? Uint32Array : Uint8Array;
      return new C(bin, b.offset, b.count);
    };
    const targets = new Map<string, Target>();
    const macro: Target[] = [];
    const n = json.vertexCount;
    for (const info of json.targets) {
      const t: Target = { info };
      if (info.dense !== undefined) t.dense = new Int16Array(bin, info.dense, n * 3);
      else if (info.sparse) {
        t.index = new Uint16Array(bin, info.sparse.index, info.sparse.count);
        t.delta = new Int16Array(bin, info.sparse.delta, info.sparse.count * 3);
      }
      targets.set(info.name, t);
      if (info.kind === 'macro') macro.push(t);
    }
    kit = {
      json,
      index: view('index'),
      position: view('position'),
      skinIndex: view('skinIndex'),
      skinWeight: view('skinWeight'),
      part: view('part'),
      coord: view('coord'),
      lips: view('lips'),
      brows: view('brows'),
      scalp: view('scalp'),
      beard: view('beard'),
      cheek: view('cheek'),
      eyeColor: view('eyeColor'),
      targets,
      macro,
    };
    return true;
  } catch {
    return false;
  }
}

export const humanKitReady = () => kit !== null;

// ------------------------------------------------------------ morphologie
export interface HumanBody {
  african: number;
  asian: number;
  caucasian: number;
  /** 0 = frêle, 1 = très musclé. */
  muscle: number;
  /** 0 = mince, 1 = fort. */
  weight: number;
  /** Curseurs de visage (−1…1), dans l'ordre de FACE_SLIDERS. */
  face: number[];
  eyes: number;
}

/** Curseurs de visage : [cible +, cible −]. */
export const FACE_SLIDERS: [string, string | null][] = [
  ['nose-scale-horiz-incr', 'nose-scale-horiz-decr'],
  ['nose-scale-vert-incr', 'nose-scale-vert-decr'],
  ['nose-point-width-incr', null],
  ['nose-hump-incr', null],
  ['nose-volume-incr', 'nose-volume-decr'],
  ['nose-flaring-incr', null],
  ['mouth-scale-horiz-incr', 'mouth-scale-horiz-decr'],
  ['mouth-lowerlip-volume-incr', 'mouth-lowerlip-volume-decr'],
  ['mouth-upperlip-volume-incr', 'mouth-upperlip-volume-decr'],
  ['chin-prominent-incr', 'chin-prominent-decr'],
  ['chin-width-incr', 'chin-width-decr'],
  ['chin-jaw-drop-incr', null],
  ['head-fat-incr', 'head-fat-decr'],
  ['head-round', 'head-oval'],
  ['head-square', 'head-triangular'],
  ['ear-scale-incr', 'ear-scale-decr'],
  ['ear-flap-incr', null],
  ['eye-scale-incr', 'eye-scale-decr'],
  ['cheek-bones-incr', null],
  ['cheek-volume-incr', null],
  ['eyebrows-trans-up', 'eyebrows-trans-down'],
  ['eyebrows-angle-up', 'eyebrows-angle-down'],
  ['forehead-nubian-incr', null],
  ['forehead-temple-incr', null],
];

/** Âge en années → valeur MakeHuman (0 = 1 an, 0,5 = 25 ans, 1 = 90 ans). */
function mhAge(years: number) {
  return years < 25 ? Math.max(0.19, (years - 1) / 48) : Math.min(1, 0.5 + ((years - 25) / 65) * 0.5);
}

function macroVals(a: Appearance, b: HumanBody): Record<string, number> {
  const g = a.female ? 0.02 : 0.98;
  const age = mhAge(a.age);
  let child = 0;
  let young = 0;
  let old = 0;
  if (age < 0.5) {
    young = Math.max(0, (age - 0.1875) * 3.2);
    child = Math.max(0, Math.min(1, 5.333 * age) - young);
  } else {
    old = Math.max(0, age * 2 - 1);
    young = 1 - old;
  }
  const tri = (x: number) => ({ min: Math.max(0, 1 - x * 2), max: Math.max(0, x * 2 - 1), avg: 1 - Math.max(0, 1 - x * 2) - Math.max(0, x * 2 - 1) });
  const m = tri(b.muscle);
  const w = tri(b.weight);
  const eth = b.african + b.asian + b.caucasian || 1;
  return {
    universal: 1,
    male: g,
    female: 1 - g,
    child,
    young,
    old,
    minmuscle: m.min,
    averagemuscle: m.avg,
    maxmuscle: m.max,
    minweight: w.min,
    averageweight: w.avg,
    maxweight: w.max,
    african: b.african / eth,
    asian: b.asian / eth,
    caucasian: b.caucasian / eth,
  };
}

function applyTarget(t: Target, w: number, pos: Float32Array, joints: Float32Array) {
  if (Math.abs(w) < 1e-4) return;
  const s = t.info.scale * w;
  if (t.dense) {
    const d = t.dense;
    for (let i = 0; i < d.length; i++) pos[i] += d[i] * s;
  } else if (t.index && t.delta) {
    const idx = t.index;
    const d = t.delta;
    for (let j = 0; j < idx.length; j++) {
      const o = idx[j] * 3;
      pos[o] += d[j * 3] * s;
      pos[o + 1] += d[j * 3 + 1] * s;
      pos[o + 2] += d[j * 3 + 2] * s;
    }
  }
  const jd = t.info.joints;
  for (let i = 0; i < jd.length; i++) joints[i] += jd[i] * w;
}

// ------------------------------------------------------------ couleurs
const lin = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

interface Dress {
  sleeve: number;
  waist: number;
  collar: number;
  pants: number;
  shoe: number;
  topInflate: number;
  pantsInflate: number;
}

function dressFor(a: Appearance): Dress {
  const sleeve = a.topStyle === 'tshirt' ? 0.4 : a.topStyle === 'robe' ? 0.12 : a.topStyle === 'chemise' && a.apron === null && a.age < 40 ? 0.62 : 0.97;
  const pants = a.bottomStyle === 'short' ? 0.4 : a.bottomStyle === 'jupe' ? -1 : 0.95;
  const topInflate = { tshirt: 0.004, chemise: 0.005, pull: 0.009, hoodie: 0.013, veste: 0.012, doudoune: 0.032, robe: 0.004 }[a.topStyle];
  return {
    sleeve,
    waist: a.topStyle === 'robe' ? -0.5 : a.topStyle === 'doudoune' || a.topStyle === 'veste' ? 0.04 : 0.13,
    collar: a.topStyle === 'pull' || a.topStyle === 'hoodie' || a.topStyle === 'doudoune' ? 1.1 : 0.98,
    pants,
    shoe: 0.955,
    topInflate,
    pantsInflate: a.bottomStyle === 'jogging' ? 0.009 : 0.005,
  };
}

// ------------------------------------------------------------ fabrication
export interface HumanBuild {
  geo: THREE.BufferGeometry;
  rest: Record<BoneName, THREE.Vector3>;
  headY: number;
  head: { center: THREE.Vector3; radius: number; top: number; eyeL: THREE.Vector3; eyeR: THREE.Vector3; halfX: number; halfZ: number; browY: number };
  expressions: string[];
}

const BONE_PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', browL: 'head', browR: 'head', mouth: 'head',
  shoulderL: 'chest', elbowL: 'shoulderL', handL: 'elbowL', shoulderR: 'chest', elbowR: 'shoulderR', handR: 'elbowR',
  thighL: 'hips', kneeL: 'thighL', footL: 'kneeL', thighR: 'hips', kneeR: 'thighR', footR: 'kneeR',
};

export function buildHuman(a: Appearance, withExpressions: boolean): HumanBuild | null {
  if (!kit || !a.body) return null;
  const K = kit;
  const J = K.json;
  const n = J.vertexCount;
  const P = K.json.parts;
  const pos = new Float32Array(K.position);
  const joints = new Float32Array(J.jointBase);
  // morphologie globale
  const vals = macroVals(a, a.body);
  for (const t of K.macro) {
    let w = 1;
    for (const tok of t.info.tokens!) {
      const v = vals[tok];
      if (v === undefined) continue;
      w *= v;
      if (w === 0) break;
    }
    applyTarget(t, w, pos, joints);
  }
  // traits du visage
  FACE_SLIDERS.forEach(([plus, minus], i) => {
    const v = a.body!.face[i] ?? 0;
    if (v > 0) applyTarget(K.targets.get(plus)!, v, pos, joints);
    else if (v < 0 && minus) applyTarget(K.targets.get(minus)!, -v, pos, joints);
  });
  // vêtements : pas de relief de tétons sous le tissu
  applyTarget(K.targets.get('breast-point-decr')!, 1, pos, joints);
  if (a.belly > 0.35) applyTarget(K.targets.get('stomach-pregnant-incr')!, (a.belly - 0.35) * 0.9, pos, joints);
  if (a.age > 45 && a.belly > 0.2) applyTarget(K.targets.get('neck-double-incr')!, Math.min(0.8, a.belly), pos, joints);

  // repère du jeu : mètres, sol à y = 0, hanches à l'aplomb de l'origine, taille demandée
  const jIdx = (name: string) => J.joints.indexOf(name) * 3;
  let minY = Infinity;
  let maxY = -Infinity;
  const NB = J.baseCount;
  for (let i = 0; i < NB; i++) {
    const p = K.part[i];
    if (p === P.skirt || p === P.hair) continue;
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
  }
  /** dm MakeHuman → mètres, à la taille demandée. */
  const k = a.height / (maxY - minY);
  const ox = 0;
  const oz = joints[jIdx('hips') + 2];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (pos[i * 3] - ox) * k;
    pos[i * 3 + 1] = (pos[i * 3 + 1] - minY) * k;
    pos[i * 3 + 2] = (pos[i * 3 + 2] - oz) * k;
  }
  const jp = (name: string) => {
    const o = jIdx(name);
    return new THREE.Vector3((joints[o] - ox) * k, (joints[o + 1] - minY) * k, (joints[o + 2] - oz) * k);
  };

  // géométrie principale (corps + aides visibles + yeux)
  const R = J.ranges;
  const idx: number[] = [];
  const pushRange = (r: { start: number; count: number }) => {
    for (let i = r.start; i < r.start + r.count; i++) idx.push(K.index[i]);
  };
  pushRange(R.body);
  pushRange(R.eyes);
  pushRange(R.lashes);
  const skirt = a.bottomStyle === 'jupe' || a.topStyle === 'robe';
  if (skirt) pushRange(R.skirt);
  const scalpHair = a.hairStyle !== 'chauve' && a.hat !== 'foulard';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  // le tissu ne suit pas les petits reliefs du corps : lissage des sommets du torse couverts
  const cloth = new Uint8Array(n);
  for (let i = 0; i < NB; i++) if (K.part[i] === P.torso && decodeT(K.coord[i]) > dressFor(a).waist + 0.05) cloth[i] = 1;
  smoothPositions(geo, cloth, 4);
  geo.computeVertexNormals();
  const nrm = smoothNormals(geo, 3);

  // couleurs et épaisseurs des vêtements
  const col = new Float32Array(n * 3);
  const skin = lin(a.skin);
  const lip = mix(skin, lin(0x9c4a4a), 0.35).multiplyScalar(0.88);
  const hairC = lin(a.hair);
  const brow = mix(hairC, lin(0x2a1a12), a.hair > 0xb0b0b0 ? 0.3 : 0.1);
  const top = lin(a.vest ?? a.top);
  const bottom = lin(a.bottom);
  const shoes = lin(a.shoes);
  const apron = a.apron !== null ? lin(a.apron) : null;
  const blush = lin(0xc0504a);
  const d = dressFor(a);
  const irisC = lin(a.body.eyes);
  const hipsZ = jp('hips').z;
  const off = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = K.part[i];
    const t = decodeT(K.coord[i]);
    let c = skin;
    let o = 0;
    switch (p) {
      case P.head:
      case P.neck: {
        if (p === P.neck && t < d.collar) {
          c = top;
          o = d.topInflate * 0.6;
          break;
        }
        c = skin.clone();
        const ch = K.cheek[i] / 255;
        if (ch > 0) c = mix(c, blush, ch * 0.12);
        if (K.lips[i]) c = mix(c, lip, K.lips[i] / 255);
        if (K.brows[i]) c = mix(c, brow, (K.brows[i] / 255) * 0.85);
        if (a.beard && K.beard[i]) {
          c = mix(c, hairC, (K.beard[i] / 255) * 0.92);
          o = (K.beard[i] / 255) * 0.004;
        }
        if (K.scalp[i] && scalpHair) {
          const h = K.scalp[i] / 255;
          c = mix(c, hairC, Math.min(1, h * 1.15));
          o = Math.max(o, h * (a.hairStyle === 'court' || a.hairStyle === 'gris' ? 0.006 : 0.009));
        }
        break;
      }
      case P.torso: {
        // bas (pantalon) → haut (vêtement) avec une transition douce à la ceinture
        const k1 = a.topStyle === 'robe' ? 1 : band(t, d.waist, 0.035);
        c = mix(bottom, top, k1);
        o = d.pantsInflate + (d.topInflate - d.pantsInflate) * k1;
        if (apron && t > d.waist - 0.05 && t < 0.78 && pos[i * 3 + 2] > hipsZ + 0.02) {
          c = mix(c, apron, band(pos[i * 3 + 2] - hipsZ, 0.03, 0.012));
          o += 0.006;
        }
        if (a.vest !== null && t > 0.62 && t < 0.7) c = lin(0xf1c40f);
        break;
      }
      case P.arm: {
        const k1 = 1 - band(t, d.sleeve, 0.03);
        c = mix(skin, top, k1);
        o = d.topInflate * k1 * (a.topStyle === 'doudoune' ? 0.8 : 1);
        break;
      }
      case P.hand:
        break;
      case P.leg: {
        const kp = d.pants < 0 ? 0 : 1 - band(t, d.pants, 0.03);
        const ks = band(t, d.shoe, 0.015);
        c = mix(mix(skin, bottom, kp), shoes, ks);
        o = d.pantsInflate * kp * (1 - ks) + 0.006 * ks;
        break;
      }
      case P.foot:
        c = shoes;
        o = 0.008;
        break;
      case P.eye: {
        const e = (i - NB) * 3;
        const r = K.eyeColor[e];
        const g = K.eyeColor[e + 1];
        const b = K.eyeColor[e + 2];
        const lum = (r + g + b) / 765;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        c = sat < 45 && lum > 0.55 ? new THREE.Color(0.82, 0.8, 0.77) : lum < 0.12 ? new THREE.Color(0.01, 0.01, 0.01) : irisC.clone().multiplyScalar(Math.min(1.6, 0.5 + lum * 2.4));
        break;
      }
      case P.lashes:
        c = brow.clone().multiplyScalar(0.5);
        break;
      case P.hair:
        c = hairC;
        o = 0.004;
        break;
      case P.skirt:
        c = a.topStyle === 'robe' ? top : bottom;
        o = 0.006;
        break;
    }
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    off[i] = o;
  }
  for (let i = 0; i < n; i++)
    if (off[i]) {
      pos[i * 3] += nrm[i * 3] * off[i];
      pos[i * 3 + 1] += nrm[i * 3 + 1] * off[i];
      pos[i * 3 + 2] += nrm[i * 3 + 2] * off[i];
    }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const si = new Uint16Array(n * 4);
  si.set(K.skinIndex);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) sw[i] = K.skinWeight[i] / 255;
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.computeVertexNormals();

  // os : positions de repos
  const world: Record<string, THREE.Vector3> = {
    root: new THREE.Vector3(0, 0, 0),
    hips: jp('hips'),
    spine: jp('spine'),
    chest: jp('chest'),
    neck: jp('neck'),
    head: jp('head'),
    shoulderL: jp('shoulderL'),
    elbowL: jp('elbowL'),
    handL: jp('handL'),
    shoulderR: jp('shoulderR'),
    elbowR: jp('elbowR'),
    handR: jp('handR'),
    thighL: jp('thighL'),
    kneeL: jp('kneeL'),
    footL: jp('footL'),
    thighR: jp('thighR'),
    kneeR: jp('kneeR'),
    footR: jp('footR'),
  };
  const eyeL = jp('eyeL');
  const eyeR = jp('eyeR');
  world.browL = eyeL.clone().add(new THREE.Vector3(0, 0.025, 0.01));
  world.browR = eyeR.clone().add(new THREE.Vector3(0, 0.025, 0.01));
  world.mouth = eyeL.clone().add(eyeR).multiplyScalar(0.5).add(new THREE.Vector3(0, -0.07, 0.012));
  const rest = {} as Record<BoneName, THREE.Vector3>;
  for (const b of Object.keys(BONE_PARENT) as BoneName[]) {
    const p = BONE_PARENT[b];
    rest[b] = p ? world[b].clone().sub(world[p]) : world[b].clone();
  }
  // tête : centre du crâne et rayon (pour cheveux, chapeaux, lunettes)
  const skullBox = new THREE.Box3();
  const headBox = new THREE.Box3();
  const v = new THREE.Vector3();
  const eyeY = (eyeL.y + eyeR.y) / 2;
  for (let i = 0; i < NB; i++)
    if (K.part[i] === P.head) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      if (v.y > eyeY - 0.12 * (a.height / 1.75)) headBox.expandByPoint(v);
      if (v.y > eyeY) skullBox.expandByPoint(v);
    }
  const sc = skullBox.getCenter(new THREE.Vector3());
  const ss = skullBox.getSize(new THREE.Vector3());
  const center = new THREE.Vector3(sc.x, headBox.getCenter(v).y, sc.z);
  const head = { center, radius: (ss.x + ss.z) / 4, top: headBox.max.y, eyeL, eyeR, halfX: ss.x / 2, halfZ: ss.z / 2, browY: eyeY + 0.022 * (a.height / 1.75) };

  // expressions (morph targets relatifs)
  const expressions: string[] = [];
  if (withExpressions) {
    const morphs: THREE.BufferAttribute[] = [];
    for (const name of J.expressions) {
      const t = K.targets.get(name)!;
      const arr = new Float32Array(n * 3);
      const tmp = new Float32Array(J.joints.length * 3);
      applyTarget(t, 1, arr, tmp);
      for (let i = 0; i < arr.length; i++) arr[i] *= k;
      morphs.push(new THREE.BufferAttribute(arr, 3));
      expressions.push(name);
    }
    geo.morphAttributes.position = morphs;
    geo.morphTargetsRelative = true;
  }
  return { geo, rest, headY: eyeY, head, expressions };
}

const decodeT = (c: number) => (c / 255) * 2 - 0.5;

/** Lissage laplacien des sommets marqués (les autres servent d'appui). */
function smoothPositions(geo: THREE.BufferGeometry, mask: Uint8Array, iterations: number) {
  const pos = geo.attributes.position.array as Float32Array;
  const idx = geo.index!.array;
  const n = pos.length / 3;
  for (let it = 0; it < iterations; it++) {
    const acc = new Float32Array(n * 3);
    const cnt = new Uint16Array(n);
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      for (let e = 0; e < 3; e++) {
        const a = v[e];
        if (!mask[a]) continue;
        for (const b of [v[(e + 1) % 3], v[(e + 2) % 3]]) {
          acc[a * 3] += pos[b * 3];
          acc[a * 3 + 1] += pos[b * 3 + 1];
          acc[a * 3 + 2] += pos[b * 3 + 2];
          cnt[a] += 1;
        }
      }
    }
    for (let i = 0; i < n; i++)
      if (mask[i] && cnt[i]) {
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = pos[i * 3 + k] * 0.5 + (acc[i * 3 + k] / cnt[i]) * 0.5;
      }
  }
}

/** 0 sous le seuil, 1 au-dessus, transition douce de demi-largeur w. */
function band(x: number, edge: number, w: number) {
  const t = Math.max(0, Math.min(1, (x - edge + w) / (2 * w)));
  return t * t * (3 - 2 * t);
}

/** Normales lissées (voisinage des triangles) : épaisseurs de vêtements sans pointes dans les creux. */
function smoothNormals(geo: THREE.BufferGeometry, iterations: number): Float32Array {
  let cur = new Float32Array(geo.attributes.normal.array as Float32Array);
  const idx = geo.index!.array;
  const n = cur.length / 3;
  for (let it = 0; it < iterations; it++) {
    const acc = new Float32Array(cur);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      for (let k = 0; k < 3; k++) {
        const s = cur[a + k] + cur[b + k] + cur[c + k];
        acc[a + k] += s;
        acc[b + k] += s;
        acc[c + k] += s;
      }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
      acc[i * 3] /= l;
      acc[i * 3 + 1] /= l;
      acc[i * 3 + 2] /= l;
    }
    cur = acc;
  }
  return cur;
}

/** Ajoute à la géométrie humaine des pièces rigides (cheveux, chapeaux, lunettes…) liées à un os. */
export function mergeHumanExtras(base: THREE.BufferGeometry, extras: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (!extras.length) return base;
  const morph = base.morphAttributes.position as THREE.BufferAttribute[] | undefined;
  const all = [base, ...extras];
  // les pièces ajoutées n'ont pas de morph : on fusionne puis on rallonge les morphs avec des zéros
  if (morph) {
    base.morphAttributes = {};
    base.morphTargetsRelative = false;
  }
  const merged = mergeGeometries(all.map((g) => (g.index ? g : g)), false)!;
  if (morph) {
    const total = merged.attributes.position.count;
    merged.morphAttributes.position = morph.map((m) => {
      const arr = new Float32Array(total * 3);
      arr.set(m.array as Float32Array);
      return new THREE.BufferAttribute(arr, 3);
    });
    merged.morphTargetsRelative = true;
  }
  return merged;
}
