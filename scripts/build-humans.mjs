/**
 * Génère le « kit humain » du jeu à partir des données CC0 de MakeHuman (https://github.com/makehumancommunity/makehuman).
 *
 *   node scripts/build-humans.mjs <chemin vers makehuman/data>
 *
 * Étapes : maillage de base hm08 → bras/jambes reposés le long du corps (skinning MakeHuman) → poids de peau
 * regroupés sur les 21 os du jeu → simplification (visage préservé) → cibles morphologiques (sexe, âge, muscle,
 * poids, origines, traits du visage, expressions) quantifiées → masques (lèvres, sourcils, barbe, cuir chevelu,
 * joues) → yeux haute définition colorés depuis la texture CC0.
 * Sortie : public/humans/kit.json + public/humans/kit.bin
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { MeshoptSimplifier } from 'meshoptimizer';

const DATA = process.argv[2];
if (!DATA || !fs.existsSync(path.join(DATA, '3dobjs/base.obj'))) {
  console.error('Usage : node scripts/build-humans.mjs <makehuman/data>');
  process.exit(1);
}
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/humans');
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;

// ------------------------------------------------------------ maillage de base
const V = [];
const faces = []; // { g, v: [i...] }
let group = '';
for (const line of fs.readFileSync(path.join(DATA, '3dobjs/base.obj'), 'utf8').split('\n')) {
  if (line.startsWith('v ')) {
    const p = line.split(/\s+/);
    V.push([+p[1], +p[2], +p[3]]);
  } else if (line.startsWith('g ')) group = line.split(/\s+/)[1];
  else if (line.startsWith('f ')) faces.push({ g: group, v: line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1) });
}
const NV = V.length;
console.log(`base.obj : ${NV} sommets, ${faces.length} faces`);

const tris = (filter) => {
  const out = [];
  for (const f of faces) if (filter(f.g)) for (let k = 1; k < f.v.length - 1; k++) out.push(f.v[0], f.v[k], f.v[k + 1]);
  return out;
};

// ------------------------------------------------------------ squelette MakeHuman et poids
const skel = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs/default.mhskel'), 'utf8'));
const mhw = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs/default_weights.mhw'), 'utf8')).weights;
const jointPos = (name, P = V) => {
  const idx = skel.joints[name];
  const s = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) s[k] += P[i][k];
  return s.map((x) => x / idx.length);
};
const boneHead = (b) => jointPos(skel.bones[b].head);

/** Os du jeu (ordre identique à BONES dans src/entities/character.ts). */
const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'browL', 'browR', 'mouth', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
function mapBone(mh) {
  const side = mh.endsWith('.L') ? 'L' : mh.endsWith('.R') ? 'R' : '';
  const base = mh.replace(/\.(L|R)$/, '');
  if (base === 'root' || base === 'pelvis' || base === 'spine05') return [['hips', 1]];
  if (base === 'spine04' || base === 'spine03') return [['spine', 1]];
  if (base === 'spine02' || base === 'spine01' || base === 'breast' || base === 'clavicle') return [['chest', 1]];
  if (base === 'shoulder01') return [['chest', 0.5], ['shoulder' + side, 0.5]];
  if (base.startsWith('upperarm')) return [['shoulder' + side, 1]];
  if (base.startsWith('lowerarm')) return [['elbow' + side, 1]];
  if (base === 'wrist' || base.startsWith('metacarpal') || base.startsWith('finger')) return [['hand' + side, 1]];
  if (base.startsWith('upperleg')) return [['thigh' + side, 1]];
  if (base.startsWith('lowerleg')) return [['knee' + side, 1]];
  if (base === 'foot' || base.startsWith('toe')) return [['foot' + side, 1]];
  if (base.startsWith('neck')) return [['neck', 1]];
  return [['head', 1]];
}
// poids MakeHuman bruts par sommet (pour le repositionnement) et poids regroupés (pour le jeu)
const mhBoneW = Array.from({ length: NV }, () => new Map());
for (const [bone, list] of Object.entries(mhw)) for (const [vi, w] of list) mhBoneW[vi].set(bone, (mhBoneW[vi].get(bone) ?? 0) + w);
const gameW = Array.from({ length: NV }, () => new Float32Array(BONES.length));
for (let i = 0; i < NV; i++) for (const [bone, w] of mhBoneW[i]) for (const [gb, k] of mapBone(bone)) gameW[i][BI[gb]] += w * k;

// ------------------------------------------------------------ repose : bras et jambes le long du corps
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => scl(a, 1 / Math.hypot(...a));
/** Matrice 3×3 (lignes) de rotation qui amène u sur v. */
function rotTo(u, v) {
  u = norm(u);
  v = norm(v);
  const ax = cross(u, v);
  const s = Math.hypot(...ax);
  const c = dot(u, v);
  if (s < 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [x, y, z] = scl(ax, 1 / s);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}
const mv = (M, a) => [dot(M[0], a), dot(M[1], a), dot(M[2], a)];
const mm = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const lerpM = (terms) => {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const [w, R] of terms) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r][c] += w * R[r][c];
  return M;
};

/** Pour chaque sommet : transformation affine (M, t) du repositionnement. */
const reM = Array.from({ length: NV }, () => I3);
const reT = Array.from({ length: NV }, () => [0, 0, 0]);
const jointXform = {}; // os du jeu → [M, t] rigide appliqué à son articulation

const sumW = (i, pred, half) => {
  let s = 0;
  for (const [b, w] of mhBoneW[i]) if (pred(b)) s += w;
  if (half) for (const [b, w] of mhBoneW[i]) if (half(b)) s += w * 0.5;
  return s;
};
for (const side of ['L', 'R']) {
  const sx = side === 'L' ? 1 : -1;
  // bras : rotation de l'épaule puis redressement du coude
  const cS = boneHead(`upperarm01.${side}`);
  const cE = boneHead(`lowerarm01.${side}`);
  const cW = boneHead(`wrist.${side}`);
  const armDir = [sx * Math.sin((7 * Math.PI) / 180), -Math.cos((7 * Math.PI) / 180), 0];
  const R1 = rotTo(sub(cE, cS), armDir);
  const R2 = rotTo(mv(R1, sub(cW, cE)), armDir);
  const R12 = mm(R2, R1);
  const T1 = (p) => add(mv(R1, sub(p, cS)), cS);
  const cE1 = T1(cE);
  const T12 = (p) => add(mv(R2, sub(T1(p), cE1)), cE1);
  const inU = (b) => b.endsWith('.' + side) && /^(upperarm|lowerarm|wrist|metacarpal|finger)/.test(b);
  const inL = (b) => b.endsWith('.' + side) && /^(lowerarm|wrist|metacarpal|finger)/.test(b);
  const isSh = (b) => b === `shoulder01.${side}`;
  // jambes : rotation à la hanche pour ramener la cheville sous la hanche
  const cH = boneHead(`upperleg01.${side}`);
  const cA = boneHead(`foot.${side}`);
  const legDir = [sx * 0.04, -1, (cA[2] - cH[2]) / Math.abs(cA[1] - cH[1])];
  const RL = rotTo(sub(cA, cH), legDir);
  const TL = (p) => add(mv(RL, sub(p, cH)), cH);
  const inLeg = (b) => b.endsWith('.' + side) && /^(upperleg|lowerleg|foot|toe)/.test(b);
  for (let i = 0; i < NV; i++) {
    const wU = Math.min(1, sumW(i, inU, isSh));
    const wL = Math.min(wU, sumW(i, inL));
    const wG = Math.min(1, sumW(i, inLeg));
    if (wU > 0) {
      // v' = (1-wU) v + (wU-wL) T1(v) + wL T12(v)
      const p = V[i];
      const a = T1(p);
      const b = T12(p);
      const np = add(add(scl(p, 1 - wU), scl(a, wU - wL)), scl(b, wL));
      reM[i] = lerpM([[1 - wU, I3], [wU - wL, R1], [wL, R12]]);
      reT[i] = sub(np, mv(reM[i], p));
    } else if (wG > 0) {
      const p = V[i];
      const np = add(scl(p, 1 - wG), scl(TL(p), wG));
      reM[i] = lerpM([[1 - wG, I3], [wG, RL]]);
      reT[i] = sub(np, mv(reM[i], p));
    }
  }
  jointXform['shoulder' + side] = [I3, [0, 0, 0]];
  jointXform['elbow' + side] = [R1, sub(T1(cE), mv(R1, cE))];
  jointXform['hand' + side] = [R12, sub(T12(cW), mv(R12, cW))];
  jointXform['thigh' + side] = [I3, [0, 0, 0]];
  jointXform['knee' + side] = [RL, sub(TL(boneHead(`lowerleg01.${side}`)), mv(RL, boneHead(`lowerleg01.${side}`)))];
  jointXform['foot' + side] = [RL, sub(TL(cA), mv(RL, cA))];
}
const P0 = V.map((p, i) => add(mv(reM[i], p), reT[i]));

// ------------------------------------------------------------ articulations du jeu (position = moyenne de sommets d'articulation MakeHuman)
const GAME_JOINTS = {
  hips: 'spine05',
  spine: 'spine04',
  chest: 'spine02',
  neck: 'neck01',
  head: 'head',
  shoulderL: 'upperarm01.L',
  elbowL: 'lowerarm01.L',
  handL: 'wrist.L',
  shoulderR: 'upperarm01.R',
  elbowR: 'lowerarm01.R',
  handR: 'wrist.R',
  thighL: 'upperleg01.L',
  kneeL: 'lowerleg01.L',
  footL: 'foot.L',
  thighR: 'upperleg01.R',
  kneeR: 'lowerleg01.R',
  footR: 'foot.R',
  eyeL: 'eye.L',
  eyeR: 'eye.R',
};
const JNAMES = Object.keys(GAME_JOINTS);
const jointVerts = JNAMES.map((j) => skel.joints[skel.bones[GAME_JOINTS[j]].head]);
const jointMat = (j) => jointXform[j]?.[0] ?? I3;
const jointBase = JNAMES.map((j, k) => {
  const p = jointVerts[k].reduce((s, i) => add(s, V[i]), [0, 0, 0]).map((x) => x / jointVerts[k].length);
  const [M, t] = jointXform[j] ?? [I3, [0, 0, 0]];
  return add(mv(M, p), t);
});

// ------------------------------------------------------------ cibles
function readTarget(rel) {
  const d = new Map();
  for (const line of fs.readFileSync(path.join(DATA, 'targets', rel), 'utf8').split('\n')) {
    if (!line || line[0] === '#') continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    d.set(+p[0], [+p[1], +p[2], +p[3]]);
  }
  return d;
}

// ------------------------------------------------------------ yeux (vêtement MakeHuman « HighPolyEyes », CC0)
const eyeObj = { v: [], vt: [], f: [] };
for (const line of fs.readFileSync(path.join(DATA, 'eyes/high-poly/high-poly.obj'), 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'v') eyeObj.v.push(p.slice(1).map(Number));
  else if (p[0] === 'vt') eyeObj.vt.push(p.slice(1).map(Number));
  else if (p[0] === 'f') eyeObj.f.push(p.slice(1).map((t) => t.split('/').map((x) => parseInt(x, 10) - 1)));
}
const clo = { refs: [], scale: {} };
{
  let inVerts = false;
  for (const line of fs.readFileSync(path.join(DATA, 'eyes/high-poly/high-poly.mhclo'), 'utf8').split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'x_scale' || p[0] === 'y_scale' || p[0] === 'z_scale') clo.scale[p[0][0]] = p.slice(1).map(Number);
    if (p[0] === 'verts') {
      inVerts = true;
      continue;
    }
    if (inVerts) {
      if (!p[0] || isNaN(+p[0])) {
        if (clo.refs.length) inVerts = false;
        continue;
      }
      if (p.length === 1) clo.refs.push({ v: [+p[0], +p[0], +p[0]], w: [1, 0, 0], d: [0, 0, 0] });
      else clo.refs.push({ v: p.slice(0, 3).map(Number), w: p.slice(3, 6).map(Number), d: p.slice(6, 9).map(Number) });
    }
  }
}
const cloScale = (axis) => {
  const [a, b, den] = clo.scale[axis];
  const k = { x: 0, y: 1, z: 2 }[axis];
  return Math.abs(V[a][k] - V[b][k]) / den;
};
const eyeScale = [cloScale('x'), cloScale('y'), cloScale('z')];
const NE = clo.refs.length;
const eyeBase = clo.refs.map((r) => {
  let p = [0, 0, 0];
  for (let k = 0; k < 3; k++) p = add(p, scl(P0[r.v[k]], r.w[k]));
  return add(p, [r.d[0] * eyeScale[0], r.d[1] * eyeScale[1], r.d[2] * eyeScale[2]]);
});
// couleur des yeux échantillonnée dans la texture (UV du premier coin rencontré)
const eyePng = PNG.sync.read(fs.readFileSync(path.join(DATA, 'eyes/materials/brown_eye.png')));
const eyeUV = new Array(NE).fill(null);
for (const f of eyeObj.f) for (const [vi, ti] of f) if (eyeUV[vi] === null && ti >= 0) eyeUV[vi] = eyeObj.vt[ti];
const sample = (u, v) => {
  const x = Math.min(eyePng.width - 1, Math.max(0, Math.round(u * (eyePng.width - 1))));
  const y = Math.min(eyePng.height - 1, Math.max(0, Math.round((1 - v) * (eyePng.height - 1))));
  const o = (y * eyePng.width + x) * 4;
  return [eyePng.data[o], eyePng.data[o + 1], eyePng.data[o + 2]];
};
const eyeCol = eyeUV.map((uv) => (uv ? sample(uv[0], uv[1]) : [240, 240, 240]));
// la coque de cornée (transparente dans MakeHuman) est échantillonnée sur la pastille bleue : on l'écarte
const cornea = eyeCol.map((c) => c[2] > 235 && c[0] < 200);
const eyeTris = [];
for (const f of eyeObj.f) {
  if (f.some(([vi]) => cornea[vi])) continue;
  for (let k = 1; k < f.length - 1; k++) eyeTris.push(f[0][0], f[k][0], f[k + 1][0]);
}

// ------------------------------------------------------------ simplification
const groupsOf = {
  body: (g) => g === 'body',
  skirt: (g) => g === 'helper-skirt',
  hair: (g) => g === 'helper-hair',
  lashes: (g) => g.includes('eyelashes'),
};
const dominant = (i) => {
  let best = 0;
  for (let b = 1; b < BONES.length; b++) if (gameW[i][b] > gameW[i][best]) best = b;
  return best;
};
const pos32 = new Float32Array(P0.flat());
function simplify(indices, ratio, lockBorder = true) {
  if (ratio >= 1) return indices;
  const idx = new Uint32Array(indices);
  const target = Math.floor((idx.length / 3) * ratio) * 3;
  const [res] = MeshoptSimplifier.simplify(idx, pos32, 3, target, 0.02, lockBorder ? ['LockBorder'] : []);
  return Array.from(res);
}
const bodyTris = tris(groupsOf.body);
const triRegion = (a) => {
  const d = BONES[dominant(a)];
  if (d === 'head' || d === 'neck') return 'head';
  if (d.startsWith('hand')) return 'hand';
  return 'rest';
};
const regionTris = { head: [], hand: [], rest: [] };
for (let t = 0; t < bodyTris.length; t += 3) {
  const r = triRegion(bodyTris[t]);
  regionTris[r].push(bodyTris[t], bodyTris[t + 1], bodyTris[t + 2]);
}
const RATIO = { head: 0.42, hand: 0.16, rest: 0.26 };
const bodyOut = [...simplify(regionTris.head, RATIO.head), ...simplify(regionTris.hand, RATIO.hand), ...simplify(regionTris.rest, RATIO.rest)];
const skirtOut = simplify(tris(groupsOf.skirt), 0.55, false);
const hairOut = tris(groupsOf.hair);
const lashOut = tris(groupsOf.lashes);
console.log(`triangles : corps ${bodyTris.length / 3} → ${bodyOut.length / 3}, jupe ${skirtOut.length / 3}, cheveux ${hairOut.length / 3}, cils ${lashOut.length / 3}, yeux ${eyeTris.length / 3}`);

// sommets conservés (base) + yeux à la suite
const keep = [...new Set([...bodyOut, ...skirtOut, ...hairOut, ...lashOut])].sort((a, b) => a - b);
const remap = new Int32Array(NV).fill(-1);
keep.forEach((v, k) => (remap[v] = k));
const NB = keep.length;
const N = NB + NE;
console.log(`sommets conservés : ${NB} + yeux ${NE} = ${N}`);
const R = (arr) => arr.map((v) => remap[v]);
const ranges = {};
const allIdx = [];
const pushRange = (name, arr) => {
  ranges[name] = { start: allIdx.length, count: arr.length };
  allIdx.push(...arr);
};
pushRange('body', R(bodyOut));
pushRange('skirt', R(skirtOut));
pushRange('hair', R(hairOut));
pushRange('lashes', R(lashOut));
pushRange('eyes', eyeTris.map((v) => NB + v));

// ------------------------------------------------------------ attributs par sommet
const position = new Float32Array(N * 3);
keep.forEach((v, k) => position.set(P0[v], k * 3));
eyeBase.forEach((p, k) => position.set(p, (NB + k) * 3));

// poids de peau (4 influences max)
const skinIndex = new Uint8Array(N * 4);
const skinWeight = new Uint8Array(N * 4);
const nearestBody = (p) => {
  let best = -1;
  let bd = Infinity;
  for (const v of bodyOut) {
    const q = P0[v];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
};
for (let k = 0; k < N; k++) {
  let w;
  if (k < NB) {
    w = gameW[keep[k]];
    if (w.reduce((a, b) => a + b, 0) < 1e-6) w = gameW[nearestBody(P0[keep[k]])];
  } else {
    w = new Float32Array(BONES.length);
    w[BI.head] = 1;
  }
  const order = [...w.keys()].sort((a, b) => w[b] - w[a]).slice(0, 4);
  const tot = order.reduce((a, b) => a + w[b], 0) || 1;
  let acc = 0;
  order.forEach((b, j) => {
    skinIndex[k * 4 + j] = b;
    const q = j === 3 ? 255 - acc : Math.round((w[b] / tot) * 255);
    skinWeight[k * 4 + j] = Math.max(0, q);
    acc += skinWeight[k * 4 + j];
  });
}

// partie du corps + coordonnée le long du membre
const PART = { head: 0, neck: 1, torso: 2, arm: 3, hand: 4, leg: 5, foot: 6, eye: 7, lashes: 8, hair: 9, skirt: 10 };
const part = new Uint8Array(N);
const coord = new Uint8Array(N);
const J = Object.fromEntries(JNAMES.map((j, k) => [j, jointBase[k]]));
const enc = (t) => Math.max(0, Math.min(255, Math.round(((t + 0.5) / 2) * 255)));
const inRange = (set, v) => set.has(v);
const skirtSet = new Set(skirtOut);
const hairSet = new Set(hairOut);
const lashSet = new Set(lashOut);
for (let k = 0; k < NB; k++) {
  const v = keep[k];
  const p = P0[v];
  if (inRange(skirtSet, v)) {
    part[k] = PART.skirt;
    coord[k] = enc((J.hips[1] - p[1]) / (J.hips[1] - J.footL[1]));
    continue;
  }
  if (inRange(hairSet, v)) {
    part[k] = PART.hair;
    continue;
  }
  if (inRange(lashSet, v)) {
    part[k] = PART.lashes;
    continue;
  }
  const d = BONES[dominant(v)];
  const side = d.endsWith('L') ? 'L' : 'R';
  if (d === 'head') part[k] = PART.head;
  else if (d === 'neck') part[k] = PART.neck;
  else if (d === 'hips' || d === 'spine' || d === 'chest' || d === 'root') part[k] = PART.torso;
  else if (d.startsWith('shoulder') || d.startsWith('elbow')) part[k] = PART.arm;
  else if (d.startsWith('hand')) part[k] = PART.hand;
  else if (d.startsWith('thigh') || d.startsWith('knee')) part[k] = PART.leg;
  else if (d.startsWith('foot')) part[k] = PART.foot;
  if (part[k] === PART.arm || part[k] === PART.hand) {
    const s = J['shoulder' + side];
    const w = J['hand' + side];
    const ax = sub(w, s);
    coord[k] = enc(dot(sub(p, s), ax) / dot(ax, ax));
  } else if (part[k] === PART.leg || part[k] === PART.foot) {
    const h = J['thigh' + side];
    const f = J['foot' + side];
    coord[k] = enc((h[1] - p[1]) / (h[1] - f[1]));
  } else if (part[k] === PART.torso || part[k] === PART.neck) {
    coord[k] = enc((p[1] - J.hips[1]) / (J.neck[1] - J.hips[1]));
  } else coord[k] = enc((p[1] - J.neck[1]) / (J.head[1] - J.neck[1]));
}
for (let k = NB; k < N; k++) part[k] = PART.eye;

// ------------------------------------------------------------ masques du visage
const magMask = (rels, lo, hi) => {
  const m = new Float32Array(NV);
  for (const rel of rels) for (const [i, d] of readTarget(rel)) m[i] = Math.max(m[i], Math.hypot(...d));
  let mx = 0;
  for (const x of m) mx = Math.max(mx, x);
  const out = new Uint8Array(N);
  keep.forEach((v, k) => {
    const t = Math.min(1, Math.max(0, (m[v] / mx - lo) / (hi - lo)));
    out[k] = Math.round(t * t * (3 - 2 * t) * 255);
  });
  return out;
};
const lips = magMask(['mouth/mouth-lowerlip-volume-incr.target', 'mouth/mouth-upperlip-volume-incr.target'], 0.12, 0.45);
const brows = magMask(['expression/units/caucasian/eyebrows-left-up.target', 'expression/units/caucasian/eyebrows-right-up.target'], 0.5, 0.85);
{
  // bande des sourcils uniquement (au-dessus de l'œil, pas le front)
  const ey = (J.eyeL[1] + J.eyeR[1]) / 2;
  const eh = Math.abs(J.eyeL[0] - J.eyeR[0]) / 2;
  for (let k = 0; k < NB; k++) {
    const p = P0[keep[k]];
    const dy = (p[1] - ey) / eh;
    const dx = Math.abs(p[0]) / eh;
    const band = dy > 0.32 && dy < 0.95 && dx > 0.2 && dx < 1.95 ? 1 : 0;
    brows[k] = Math.round(brows[k] * band);
  }
}
// cuir chevelu : au-dessus d'une ligne de cheveux (haute sur le front, descendant derrière les oreilles jusqu'à la nuque)
const scalp = new Uint8Array(N);
const eyeY = (J.eyeL[1] + J.eyeR[1]) / 2;
const eyeZ = (J.eyeL[2] + J.eyeR[2]) / 2;
const eyeHalf = Math.abs(J.eyeL[0] - J.eyeR[0]) / 2;
{
  // centre du crâne : milieu des sommets de tête au-dessus des yeux
  let cz = 0;
  let cnt = 0;
  for (let k = 0; k < NB; k++)
    if (part[k] === PART.head && P0[keep[k]][1] > eyeY) {
      cz += P0[keep[k]][2];
      cnt++;
    }
  cz /= cnt;
  const sm = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const u = eyeHalf;
  for (let k = 0; k < NB; k++) {
    if (part[k] !== PART.head && part[k] !== PART.neck) continue;
    const p = P0[keep[k]];
    const dy = (p[1] - eyeY) / u;
    const f = (p[2] - cz) / (eyeZ - cz); // 1 = plan des yeux, 0 = centre, < 0 = arrière
    const dx = Math.abs(p[0]) / u;
    // hauteur de la ligne de cheveux (en unités d'œil) selon la position avant/arrière
    let line = f > 0.55 ? 1.45 + (f - 0.55) * 0.9 : f > 0 ? 0.55 + (f / 0.55) * 0.9 : 0.55 + f * 2.6;
    // tempes et pattes : un peu plus bas sur les côtés, devant les oreilles
    if (f > 0 && f < 0.7 && dx > 1.6) line -= 0.55 * sm(1.6, 2.1, dx);
    line = Math.max(line, -3.2);
    const t = sm(line - 0.12, line + 0.25, dy);
    // pas d'oreilles : les oreilles dépassent sur les côtés autour de la hauteur des yeux
    const ear = dx > 2.25 && dy < 0.6 && dy > -1.6 ? 0 : 1;
    scalp[k] = Math.round(t * ear * 255);
  }
}
// barbe et moustache (zone géométrique relative aux yeux), joues (rougeur légère)
const beard = new Uint8Array(N);
const cheek = new Uint8Array(N);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const u = eyeHalf; // demi-écart des yeux comme unité de visage
for (let k = 0; k < NB; k++) {
  if (part[k] !== PART.head && part[k] !== PART.neck) continue;
  const p = P0[keep[k]];
  const dy = (p[1] - eyeY) / u;
  const dx = Math.abs(p[0]) / u;
  const dz = (p[2] - eyeZ) / u;
  // mâchoire, menton et dessous du menton : sous le nez, devant les oreilles
  const b = smooth(-1.3, -1.75, dy) * smooth(-4.9, -4.4, dy) * smooth(-3.6, -2.4, dz) * smooth(2.4, 1.9, dx);
  // moustache
  const m = smooth(-1.6, -1.75, dy) * smooth(-2.35, -2.15, dy) * smooth(1.05, 0.8, dx) * smooth(-0.8, 0, dz);
  beard[k] = Math.round(Math.min(1, Math.max(b, m) * (1 - lips[k] / 255)) * 255);
  cheek[k] = Math.round(smooth(-0.15, -0.6, dy) * smooth(-1.5, -1.0, dy) * smooth(0.5, 0.9, dx) * smooth(1.9, 1.4, dx) * smooth(-1.2, -0.3, dz) * 255);
}

// ------------------------------------------------------------ cibles retenues
const macroFiles = fs
  .readdirSync(path.join(DATA, 'targets/macrodetails'))
  .filter((f) => f.endsWith('.target') && !f.includes('baby'))
  .map((f) => 'macrodetails/' + f);
const FACE = [
  'nose/nose-scale-horiz-incr', 'nose/nose-scale-horiz-decr', 'nose/nose-scale-vert-incr', 'nose/nose-scale-vert-decr',
  'nose/nose-point-width-incr', 'nose/nose-hump-incr', 'nose/nose-volume-incr', 'nose/nose-volume-decr', 'nose/nose-flaring-incr',
  'mouth/mouth-scale-horiz-incr', 'mouth/mouth-scale-horiz-decr', 'mouth/mouth-lowerlip-volume-incr', 'mouth/mouth-lowerlip-volume-decr',
  'mouth/mouth-upperlip-volume-incr', 'mouth/mouth-upperlip-volume-decr',
  'chin/chin-prominent-incr', 'chin/chin-prominent-decr', 'chin/chin-width-incr', 'chin/chin-width-decr', 'chin/chin-jaw-drop-incr',
  'head/head-fat-incr', 'head/head-fat-decr', 'head/head-round', 'head/head-square', 'head/head-oval', 'head/head-triangular',
  'l-ear-scale-incr|r-ear-scale-incr', 'l-ear-scale-decr|r-ear-scale-decr', 'l-ear-flap-incr|r-ear-flap-incr',
  'l-eye-scale-incr|r-eye-scale-incr', 'l-eye-scale-decr|r-eye-scale-decr',
  'l-cheek-bones-incr|r-cheek-bones-incr', 'l-cheek-volume-incr|r-cheek-volume-incr',
  'eyebrows/eyebrows-trans-up', 'eyebrows/eyebrows-trans-down', 'eyebrows/eyebrows-angle-up', 'eyebrows/eyebrows-angle-down',
  'neck/neck-double-incr', 'stomach/stomach-pregnant-incr', 'breast/breast-point-decr', 'forehead/forehead-nubian-incr', 'forehead/forehead-temple-incr',
];
const pairDir = (n) => (n.startsWith('l-ear') || n.startsWith('r-ear') ? 'ears/' : n.includes('eye-') ? 'eyes/' : n.includes('cheek') ? 'cheek/' : '');
const EXPR = 'expression/units/caucasian/';
const EXPRESSIONS = {
  smile: [['mouth-corner-puller', 1], ['mouth-elevation', 0.25], ['eye-left-slit', 0.25], ['eye-right-slit', 0.25]],
  sad: [['mouth-depression', 0.8], ['eyebrows-left-inner-up', 0.9], ['eyebrows-right-inner-up', 0.9]],
  angry: [['eyebrows-left-down', 1], ['eyebrows-right-down', 1], ['mouth-compression', 0.6], ['nose-compression', 0.4]],
  surprised: [['eyebrows-left-up', 1], ['eyebrows-right-up', 1], ['eye-left-opened-up', 0.6], ['eye-right-opened-up', 0.6], ['mouth-open', 0.45]],
  open: [['mouth-open', 1]],
  blink: [['eye-left-closure', 1], ['eye-right-closure', 1]],
};

/** Delta (sur les sommets conservés + yeux) et delta des articulations, repositionnés comme le maillage. */
function buildDelta(parts) {
  const d = new Map();
  for (const [rel, w] of parts)
    for (const [i, v] of readTarget(rel)) {
      const o = d.get(i) ?? [0, 0, 0];
      d.set(i, add(o, scl(v, w)));
    }
  const out = new Float32Array(N * 3);
  for (let k = 0; k < NB; k++) {
    const v = d.get(keep[k]);
    if (v) out.set(mv(reM[keep[k]], v), k * 3);
  }
  clo.refs.forEach((r, e) => {
    let s = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = d.get(r.v[k]);
      if (v) s = add(s, scl(mv(reM[r.v[k]], v), r.w[k]));
    }
    out.set(s, (NB + e) * 3);
  });
  const jd = new Float32Array(JNAMES.length * 3);
  JNAMES.forEach((j, k) => {
    let s = [0, 0, 0];
    for (const i of jointVerts[k]) {
      const v = d.get(i);
      if (v) s = add(s, v);
    }
    jd.set(mv(jointMat(j), scl(s, 1 / jointVerts[k].length)), k * 3);
  });
  return { out, jd };
}

// ------------------------------------------------------------ écriture binaire
const chunks = [];
let offset = 0;
const pushBuf = (typed) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  chunks.push(b);
  const at = offset;
  offset += b.length;
  return at;
};
const header = {
  format: 'bazarbazar-humans',
  version: 1,
  source: 'MakeHuman 1.x (hm08), données CC0 — https://github.com/makehumancommunity/makehuman',
  unit: 'dm',
  vertexCount: N,
  baseCount: NB,
  bones: BONES,
  parts: PART,
  joints: JNAMES,
  jointBase: jointBase.flat(),
  ranges,
  buffers: {},
  targets: [],
  expressions: Object.keys(EXPRESSIONS),
};
const indices = N < 65536 ? new Uint16Array(allIdx) : new Uint32Array(allIdx);
header.buffers.index = { offset: pushBuf(indices), type: indices instanceof Uint16Array ? 'u16' : 'u32', count: indices.length };
header.buffers.position = { offset: pushBuf(position), type: 'f32', count: position.length };
header.buffers.skinIndex = { offset: pushBuf(skinIndex), type: 'u8', count: skinIndex.length };
header.buffers.skinWeight = { offset: pushBuf(skinWeight), type: 'u8', count: skinWeight.length };
header.buffers.part = { offset: pushBuf(part), type: 'u8', count: N };
header.buffers.coord = { offset: pushBuf(coord), type: 'u8', count: N };
for (const [name, arr] of Object.entries({ lips, brows, scalp, beard, cheek })) header.buffers[name] = { offset: pushBuf(arr), type: 'u8', count: N };
const eyeRGB = new Uint8Array(NE * 3);
eyeCol.forEach((c, i) => eyeRGB.set(c, i * 3));
header.buffers.eyeColor = { offset: pushBuf(eyeRGB), type: 'u8', count: eyeRGB.length };

/** Stocke un delta : dense (int16 quantifié) ou creux (index + int16) selon le nombre de sommets touchés. */
function storeTarget(name, kind, parts, tokens) {
  const { out, jd } = buildDelta(parts);
  let mx = 0;
  const touched = [];
  for (let k = 0; k < N; k++) {
    const m = Math.max(Math.abs(out[k * 3]), Math.abs(out[k * 3 + 1]), Math.abs(out[k * 3 + 2]));
    if (m > 1e-5) touched.push(k);
    mx = Math.max(mx, m);
  }
  const scale = mx / 32767 || 1;
  const t = { name, kind, tokens, scale, joints: Array.from(jd, (x) => Math.round(x * 1e5) / 1e5) };
  if (touched.length > N * 0.35) {
    const q = new Int16Array(N * 3);
    for (let i = 0; i < N * 3; i++) q[i] = Math.round(out[i] / scale);
    t.dense = pushBuf(q);
  } else {
    const idx = new Uint16Array(touched);
    const q = new Int16Array(touched.length * 3);
    touched.forEach((k, j) => {
      for (let c = 0; c < 3; c++) q[j * 3 + c] = Math.round(out[k * 3 + c] / scale);
    });
    t.sparse = { index: pushBuf(idx), delta: pushBuf(q), count: touched.length };
  }
  header.targets.push(t);
}
for (const rel of macroFiles) {
  const base = path.basename(rel, '.target');
  storeTarget(base, 'macro', [[rel, 1]], base.split('-'));
}
for (const f of FACE) {
  const parts = f.split('|').map((p) => [(p.includes('/') ? '' : pairDir(p)) + p + '.target', 1]);
  storeTarget(f.split('|')[0].replace(/^.*\//, '').replace(/^l-/, ''), 'face', parts, null);
}
for (const [name, list] of Object.entries(EXPRESSIONS)) storeTarget(name, 'expression', list.map(([u, w]) => [EXPR + u + '.target', w]), null);

fs.writeFileSync(path.join(OUT, 'kit.bin'), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, 'kit.json'), JSON.stringify(header));
fs.writeFileSync(
  path.join(OUT, 'LICENCE.txt'),
  'Kit humain généré par scripts/build-humans.mjs à partir des données de MakeHuman 1.x\n' +
    '(maillage hm08, cibles morphologiques, squelette, yeux), publiées sous licence CC0 1.0\n' +
    'par Data Collection AB, Joel Palmius et Jonas Hauquier : https://github.com/makehumancommunity/makehuman\n',
);
console.log(`kit écrit : ${(offset / 1024 / 1024).toFixed(2)} Mo, ${header.targets.length} cibles`);
