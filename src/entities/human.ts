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
  /** Ligne avant du vêtement du haut (boutons, fermeture éclair). */
  front: THREE.Vector3[];
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

  // ---------------------------------------------------------------- corps (+ yeux, cils, jupe)
  const R = J.ranges;
  const bodyIdx: number[] = [];
  const otherIdx: number[] = [];
  const pushRange = (r: { start: number; count: number }, out: number[]) => {
    for (let i = r.start; i < r.start + r.count; i++) out.push(K.index[i]);
  };
  pushRange(R.body, bodyIdx);
  pushRange(R.eyes, otherIdx);
  pushRange(R.lashes, otherIdx);
  const skirt = a.bottomStyle === 'jupe' || a.topStyle === 'robe';
  if (skirt) pushRange(R.skirt, otherIdx);
  const scalpHair = a.hairStyle !== 'chauve' && a.hat !== 'foulard';
  const d = dressFor(a);
  const work = new THREE.BufferGeometry();
  work.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  work.setIndex([...bodyIdx, ...otherIdx]);
  // le tissu ne suit pas les petits reliefs du corps : lissage des sommets du torse couverts
  const cloth = new Uint8Array(n);
  for (let i = 0; i < NB; i++) if (K.part[i] === P.torso && decodeT(K.coord[i]) > d.waist + 0.05) cloth[i] = 1;
  smoothPositions(work, cloth, 4);
  work.computeVertexNormals();
  const nrm = smoothNormals(work, 3);

  // ---------------------------------------------------------------- couleurs de base (peau, visage, yeux)
  const col = new Float32Array(n * 4);
  const setC = (arr: Float32Array, i: number, c: THREE.Color, rough: number) => {
    arr[i * 4] = c.r;
    arr[i * 4 + 1] = c.g;
    arr[i * 4 + 2] = c.b;
    arr[i * 4 + 3] = rough;
  };
  const skin = lin(a.skin);
  const lip = mix(skin, lin(0xa8505a), 0.42).multiplyScalar(0.9);
  const hairC = lin(a.hair);
  const brow = mix(hairC, lin(0x2a1a12), a.hair > 0xb0b0b0 ? 0.3 : 0.1);
  const irisC = lin(a.body.eyes);
  const blush = lin(0xd0605a);
  for (let i = 0; i < n; i++) {
    const p = K.part[i];
    let c = skin;
    let rough = 0.58;
    if (p === P.head || p === P.neck) {
      c = skin.clone();
      const ch = K.cheek[i] / 255;
      if (ch > 0) c = mix(c, blush, ch * 0.14);
      if (K.lips[i]) {
        c = mix(c, lip, K.lips[i] / 255);
        rough = 0.45;
      }
      if (K.brows[i]) c = mix(c, brow, (K.brows[i] / 255) * 0.62);
      if (a.beard && K.beard[i]) {
        c = mix(c, hairC, (K.beard[i] / 255) * 0.88);
        rough = 0.8;
      }
      // sous les cheveux : teinte des cheveux (pas de peau visible à la lisière)
      if (K.scalp[i] && scalpHair) c = mix(c, hairC, Math.min(1, (K.scalp[i] / 255) * 1.4));
    } else if (p === P.eye) {
      const e = (i - NB) * 3;
      const r = K.eyeColor[e];
      const g = K.eyeColor[e + 1];
      const b = K.eyeColor[e + 2];
      const lum = (r + g + b) / 765;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      c = sat < 45 && lum > 0.55 ? new THREE.Color(0.62, 0.6, 0.57) : lum < 0.12 ? new THREE.Color(0.01, 0.01, 0.01) : irisC.clone().multiplyScalar(Math.min(1.6, 0.5 + lum * 2.4));
      rough = 0.12;
    } else if (p === P.lashes) {
      c = brow.clone().multiplyScalar(0.5);
      rough = 0.9;
    } else if (p === P.skirt) {
      c = lin(a.topStyle === 'robe' ? a.top : a.bottom);
      rough = 0.85;
    }
    setC(col, i, c, rough);
  }
  if (a.beard)
    for (let i = 0; i < NB; i++) {
      const o = (K.beard[i] / 255) * 0.004;
      if (o > 0) for (let q = 0; q < 3; q++) pos[i * 3 + q] += nrm[i * 3 + q] * o;
    }

  // ---------------------------------------------------------------- vêtements : pièces séparées aux bords nets
  const hipsZ = jp('hips').z;
  const bt = a.topStyle;
  const G = [
    { color: lin(a.vest ?? a.top), thick: Math.max(0.005, d.topInflate), rough: bt === 'doudoune' ? 0.55 : 0.88, quilt: bt === 'doudoune' },
    { color: lin(a.bottom), thick: d.pantsInflate, rough: 0.9, quilt: false },
    { color: lin(a.shoes), thick: 0.01, rough: 0.5, quilt: false },
    { color: lin(a.shoes === 0xffffff || a.shoes === 0xdcdde1 || a.shoes === 0xf5f6fa ? 0x3a3a3a : 0xf2f2ee), thick: 0.0125, rough: 0.7, quilt: false },
    { color: lin(a.apron ?? 0xffffff), thick: Math.max(0.005, d.topInflate) + 0.005, rough: 0.85, quilt: false },
    { color: lin(0xf1c40f), thick: Math.max(0.005, d.topInflate) + 0.002, rough: 0.6, quilt: false },
    { color: hairC, thick: a.hairStyle === 'court' || a.hairStyle === 'gris' ? 0.005 : 0.009, rough: 0.72, quilt: false },
  ];
  const TOP = 0;
  const PANTS = 1;
  const SHOES = 2;
  const SOLE = 3;
  const APRON = 4;
  const BAND = 5;
  const HAIR = 6;
  const soleY = 0.018 * (a.height / 1.75);
  /** Marge (> 0 = couvert) de chaque pièce pour un sommet : sert à l'étiquetage et à couper l'ourlet net. */
  const margin = (g: number, i: number): number => {
    const p = K.part[i];
    const t = decodeT(K.coord[i]);
    const y = pos[i * 3 + 1];
    switch (g) {
      case TOP:
        if (p === P.torso) return bt === 'robe' ? 1 : t - d.waist;
        if (p === P.arm) return d.sleeve - t;
        if (p === P.neck) return d.collar - t;
        return -1;
      case PANTS:
        if (p === P.torso) return bt === 'robe' ? -1 : d.waist - t;
        if (p === P.leg) return d.pants < 0 ? -1 : d.pants - t;
        return -1;
      case SHOES:
        if (p === P.foot) return 1;
        if (p === P.leg) return t - d.shoe;
        return -1;
      case SOLE:
        if (p === P.foot || (p === P.leg && t > d.shoe)) return (soleY - y) * 20;
        return -1;
      case APRON:
        if (a.apron === null || p !== P.torso) return -1;
        return Math.min(t - (d.waist - 0.06), 0.8 - t, (pos[i * 3 + 2] - hipsZ - 0.03) * 10, (0.17 - Math.abs(pos[i * 3])) * 10);
      case BAND:
        if (a.vest === null || p !== P.torso) return -1;
        return Math.min(t - 0.6, 0.68 - t);
      case HAIR:
        return p === P.head && scalpHair ? K.scalp[i] / 255 - 0.55 : -1;
    }
    return -1;
  };
  const PRIORITY = [SOLE, SHOES, APRON, BAND, TOP, PANTS, HAIR];
  const M = G.map((_, g) => {
    const m = new Float32Array(NB);
    for (let i = 0; i < NB; i++) m[i] = margin(g, i);
    return m;
  });
  /** Point sur le corps : sommet d'origine (a = b) ou point d'une arête (interpolation f). */
  interface Pt {
    key: string;
    a: number;
    b: number;
    f: number;
  }
  const mOf = (g: number, p: Pt) => M[g][p.a] * (1 - p.f) + M[g][p.b] * p.f;
  /** Coupe un polygone par la frontière « marge = 0 » de la pièce g (Sutherland–Hodgman). */
  const clip = (poly: Pt[], g: number): [Pt[], Pt[]] => {
    const ins: Pt[] = [];
    const outs: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      // un point déjà sur une ligne de coupe (marge ≈ 0) compte comme couvert : coutures partagées sans éclats
      const inside = (x: Pt, m: number) => m > 1e-6 || (x.a !== x.b && m > -1e-4);
      const mp = mOf(g, p);
      const mq = mOf(g, q);
      const ip = inside(p, mp);
      const iq = inside(q, mq);
      if (ip) ins.push(p);
      else outs.push(p);
      if (ip !== iq) {
        // point de coupe : interpolation entre les deux extrémités (ramenée aux sommets du corps)
        const f = mp / (mp - mq);
        const k1 = p.key < q.key ? p.key : q.key;
        const k2 = p.key < q.key ? q.key : p.key;
        let cut: Pt;
        if (p.a === p.b && q.a === q.b) cut = { key: `(${k1}|${k2})${g}`, a: p.a, b: q.a, f };
        else {
          // l'une des extrémités est déjà un point de coupe : approximation sur le sommet le plus proche de chaque côté
          const pv = p.f < 0.5 ? p.a : p.b;
          const qv = q.f < 0.5 ? q.a : q.b;
          cut = { key: `(${k1}|${k2})${g}`, a: pv, b: qv, f };
        }
        ins.push(cut);
        outs.push(cut);
      }
    }
    return [ins.length >= 3 ? ins : [], outs.length >= 3 ? outs : []];
  };
  const skinPolys: Pt[][] = [];
  const garmentPolys: Pt[][][] = G.map(() => []);
  const V = (i: number): Pt => ({ key: 'v' + i, a: i, b: i, f: 0 });
  for (let t = 0; t < bodyIdx.length; t += 3) {
    let rest: Pt[] = [V(bodyIdx[t]), V(bodyIdx[t + 1]), V(bodyIdx[t + 2])];
    for (const g of PRIORITY) {
      if (!rest.length) break;
      if (!rest.some((p) => mOf(g, p) > 1e-6)) continue;
      const [ins, outs] = clip(rest, g);
      if (ins.length) garmentPolys[g].push(ins);
      rest = outs;
    }
    if (rest.length) skinPolys.push(rest);
  }

  // ---------------------------------------------------------------- sommets finaux
  const refA: number[] = [];
  const refB: number[] = [];
  const refF: number[] = [];
  const outPos: number[] = [];
  const outCol: number[] = [];
  for (let i = 0; i < n; i++) {
    refA.push(i);
    refB.push(i);
    refF.push(0);
    outPos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    outCol.push(col[i * 4], col[i * 4 + 1], col[i * 4 + 2], col[i * 4 + 3]);
  }
  const lerp3 = (arr: Float32Array, p: Pt, k: number) => arr[p.a * 3 + k] * (1 - p.f) + arr[p.b * 3 + k] * p.f;
  const addVert = (p: Pt, x: number, y: number, z: number, c: [number, number, number, number]) => {
    refA.push(p.a);
    refB.push(p.b);
    refF.push(p.f);
    outPos.push(x, y, z);
    outCol.push(...c);
    return refA.length - 1;
  };
  const outIdx: number[] = [...otherIdx];
  // peau
  const skinMap = new Map<string, number>();
  const skinVert = (p: Pt) => {
    if (p.a === p.b) return p.a;
    let v = skinMap.get(p.key);
    if (v === undefined) {
      const c: [number, number, number, number] = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) c[k] = col[p.a * 4 + k] * (1 - p.f) + col[p.b * 4 + k] * p.f;
      v = addVert(p, lerp3(pos, p, 0), lerp3(pos, p, 1), lerp3(pos, p, 2), c);
      skinMap.set(p.key, v);
    }
    return v;
  };
  for (const poly of skinPolys) {
    const ids = poly.map(skinVert);
    for (let k = 1; k < ids.length - 1; k++) outIdx.push(ids[0], ids[k], ids[k + 1]);
  }
  const hash = (i: number) => {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const frontLine: THREE.Vector3[] = [];
  /** Ampleur du tissu : plus large en bas du pantalon et des manches. */
  const looseness = (g: number, p: Pt) => {
    const i = p.f < 0.5 ? p.a : p.b;
    const t = decodeT(K.coord[i]);
    if (g === PANTS && K.part[i] === P.leg) return (a.bottomStyle === 'jogging' ? 0.008 : 0.004) + Math.max(0, t - 0.55) * 0.02;
    if (g === TOP && K.part[i] === P.arm) return 0.003 + Math.max(0, t - 0.2) * 0.006;
    return 0;
  };
  G.forEach((gm, g) => {
    const polys = garmentPolys[g];
    if (!polys.length) return;
    const pts = new Map<string, Pt>();
    const edges = new Map<string, number>();
    const adj = new Map<string, Set<string>>();
    for (const poly of polys) {
      for (const p of poly) pts.set(p.key, p);
      for (let i = 0; i < poly.length; i++) {
        const k0 = poly[i].key;
        const k1 = poly[(i + 1) % poly.length].key;
        const e = k0 < k1 ? k0 + '#' + k1 : k1 + '#' + k0;
        edges.set(e, (edges.get(e) ?? 0) + 1);
        (adj.get(k0) ?? adj.set(k0, new Set()).get(k0)!).add(k1);
        (adj.get(k1) ?? adj.set(k1, new Set()).get(k1)!).add(k0);
      }
    }
    const boundary = new Set<string>();
    for (const [e, c] of edges) if (c === 1) for (const k of e.split('#')) boundary.add(k);
    // position du tissu : surface du corps + épaisseur, puis lissage (bords fixes)
    const sp = new Map<string, [number, number, number]>();
    for (const [key, p] of pts) {
      const th = gm.thick + looseness(g, p);
      sp.set(key, [lerp3(pos, p, 0) + lerp3(nrm, p, 0) * th, lerp3(pos, p, 1) + lerp3(nrm, p, 1) * th, lerp3(pos, p, 2) + lerp3(nrm, p, 2) * th]);
    }
    const iters = g === SHOES || g === SOLE ? 7 : g === TOP || g === PANTS ? 3 : 0;
    for (let it = 0; it < iters; it++) {
      const next = new Map<string, [number, number, number]>();
      for (const [key, q] of sp) {
        if (boundary.has(key)) continue;
        let ax = 0;
        let ay = 0;
        let az = 0;
        let cnt = 0;
        for (const u of adj.get(key)!) {
          const r = sp.get(u)!;
          ax += r[0];
          ay += r[1];
          az += r[2];
          cnt++;
        }
        if (cnt) next.set(key, [q[0] * 0.5 + (ax / cnt) * 0.5, q[1] * 0.5 + (ay / cnt) * 0.5, q[2] * 0.5 + (az / cnt) * 0.5]);
      }
      for (const [key, q] of next) sp.set(key, q);
    }
    const ids = new Map<string, number>();
    const hemIds = new Map<string, number>();
    let h = 0;
    for (const [key, p] of pts) {
      const [x, y, z] = sp.get(key)!;
      let f = 0.96 + hash(p.a * 7 + h++) * 0.08;
      if (lerp3(nrm, p, 1) < -0.35) f *= 0.88;
      if (gm.quilt) f *= 1 - 0.22 * Math.max(0, Math.cos((y / 0.075) * Math.PI * 2)) ** 6;
      ids.set(key, addVert(p, x, y, z, [gm.color.r * f, gm.color.g * f, gm.color.b * f, gm.rough]));
      if (g === TOP && Math.abs(x) < 0.02 && z > 0) frontLine.push(new THREE.Vector3(x, y, z));
      if (boundary.has(key)) hemIds.set(key, addVert(p, lerp3(pos, p, 0), lerp3(pos, p, 1), lerp3(pos, p, 2), [gm.color.r * 0.7, gm.color.g * 0.7, gm.color.b * 0.7, gm.rough]));
    }
    for (const poly of polys) {
      const pid = poly.map((p) => ids.get(p.key)!);
      for (let k = 1; k < pid.length - 1; k++) outIdx.push(pid[0], pid[k], pid[k + 1]);
    }
    // ourlets : bande entre le bord du tissu et la peau, tournée vers l'extérieur
    for (const [e, c] of edges) {
      if (c !== 1) continue;
      const [k0, k1] = e.split('#');
      const s0 = ids.get(k0)!;
      const s1 = ids.get(k1)!;
      const b0 = hemIds.get(k0)!;
      const b1 = hemIds.get(k1)!;
      const P0 = new THREE.Vector3(...sp.get(k0)!);
      const P1 = new THREE.Vector3(...sp.get(k1)!);
      const B0 = new THREE.Vector3(outPos[b0 * 3], outPos[b0 * 3 + 1], outPos[b0 * 3 + 2]);
      const fn = P1.clone().sub(P0).cross(B0.clone().sub(P0));
      // direction « hors de la pièce » : du milieu de l'arête vers l'intérieur s'oppose au centre des voisins
      const mid = P0.clone().add(P1).multiplyScalar(0.5);
      const inner = new THREE.Vector3();
      let cnt = 0;
      for (const u of adj.get(k0)!) {
        if (u === k1) continue;
        inner.add(new THREE.Vector3(...sp.get(u)!));
        cnt++;
      }
      const away = cnt ? mid.clone().sub(inner.multiplyScalar(1 / cnt)) : new THREE.Vector3(0, -1, 0);
      if (fn.dot(away) >= 0) outIdx.push(s0, s1, b1, s0, b1, b0);
      else outIdx.push(s1, s0, b0, s1, b0, b1);
    }
  });
  // couture avant (boutons, fermeture) : un point par tranche de 2 cm, le plus en avant
  const front: THREE.Vector3[] = [];
  {
    const bins = new Map<number, THREE.Vector3>();
    for (const p of frontLine) {
      const b = Math.round(p.y / 0.02);
      const cur = bins.get(b);
      if (!cur || p.z > cur.z) bins.set(b, p);
    }
    for (const k2 of [...bins.keys()].sort((x, y) => x - y)) front.push(bins.get(k2)!);
  }

  const total = refA.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outPos), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(outCol), 4));
  const si = new Uint16Array(total * 4);
  const sw = new Float32Array(total * 4);
  const acc = new Float32Array(32);
  for (let i = 0; i < total; i++) {
    const A = refA[i];
    const B = refB[i];
    const f = refF[i];
    if (A === B || f === 0) {
      for (let q = 0; q < 4; q++) {
        si[i * 4 + q] = K.skinIndex[A * 4 + q];
        sw[i * 4 + q] = K.skinWeight[A * 4 + q] / 255;
      }
      continue;
    }
    // mélange des influences des deux sommets d'origine, 4 plus fortes conservées
    acc.fill(0);
    for (let q = 0; q < 4; q++) {
      acc[K.skinIndex[A * 4 + q]] += (K.skinWeight[A * 4 + q] / 255) * (1 - f);
      acc[K.skinIndex[B * 4 + q]] += (K.skinWeight[B * 4 + q] / 255) * f;
    }
    const order = [...acc.keys()].sort((x, y) => acc[y] - acc[x]).slice(0, 4);
    const tot = order.reduce((s2, bI) => s2 + acc[bI], 0) || 1;
    order.forEach((bI, q) => {
      si[i * 4 + q] = bI;
      sw[i * 4 + q] = acc[bI] / tot;
    });
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(total < 65536 ? new THREE.BufferAttribute(new Uint16Array(outIdx), 1) : new THREE.BufferAttribute(new Uint32Array(outIdx), 1));
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
      const base = new Float32Array(n * 3);
      const tmp = new Float32Array(J.joints.length * 3);
      applyTarget(t, 1, base, tmp);
      const arr = new Float32Array(total * 3);
      for (let i = 0; i < total; i++) {
        const A = refA[i] * 3;
        const B = refB[i] * 3;
        const f = refF[i];
        for (let q = 0; q < 3; q++) arr[i * 3 + q] = (base[A + q] * (1 - f) + base[B + q] * f) * k;
      }
      morphs.push(new THREE.BufferAttribute(arr, 3));
      expressions.push(name);
    }
    geo.morphAttributes.position = morphs;
    geo.morphTargetsRelative = true;
  }
  return { geo, rest, headY: eyeY, head, expressions, front };
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
