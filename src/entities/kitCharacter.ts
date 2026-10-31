/**
 * Habitants fabriqués à partir du kit Blender (public/models/characters.glb) : pièces rigides attachées aux os
 * du squelette du jeu (même animateur), recolorées selon l'apparence (peau, vêtements, cheveux, yeux…).
 * Style figurine : formes douces, grosse tête expressive, rien d'inquiétant.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getKit } from '../models/kit';
import { BONES, PARENT, humanMaterial, type Appearance, type BoneName, type CharacterRig } from './character';

/** Repères du modèle Blender (personnage de référence 1,75 m). */
const HEAD_Z = 1.72;
const REST: Record<BoneName, [number, number, number]> = {
  root: [0, 0, 0],
  hips: [0, 0.95, 0],
  spine: [0, 0.12, 0],
  chest: [0, 0.2, 0],
  neck: [0, 0.2, 0],
  head: [0, 0.08, 0],
  browL: [0.055, HEAD_Z + 0.072 - 1.55, 0.135],
  browR: [-0.055, HEAD_Z + 0.072 - 1.55, 0.135],
  mouth: [0, HEAD_Z - 0.065 - 1.55, 0.14],
  shoulderL: [0.21, 0.13, 0],
  elbowL: [0, -0.24, 0],
  handL: [0, -0.23, 0],
  shoulderR: [-0.21, 0.13, 0],
  elbowR: [0, -0.24, 0],
  handR: [0, -0.23, 0],
  thighL: [0.095, -0.05, 0],
  kneeL: [0, -0.4, 0],
  footL: [0, -0.38, 0],
  thighR: [-0.095, -0.05, 0],
  kneeR: [0, -0.4, 0],
  footR: [0, -0.38, 0],
};

const HEAD_BONES = new Set<BoneName>(['head', 'browL', 'browR', 'mouth']);
const lin = (hex: number, f = 1) => new THREE.Color(hex).multiplyScalar(f).convertSRGBToLinear();

/** Pièces à assembler pour une apparence. */
function partsFor(a: Appearance): string[] {
  const p: string[] = [];
  p.push(a.female ? 'hips__hips_f' : 'hips__hips_m');
  p.push('spine__belly');
  p.push(a.belly > 0.55 ? 'chest__chest_big' : a.female ? 'chest__chest_f' : 'chest__chest_m', 'chest__shoulderpadL', 'chest__shoulderpadR', 'neck__neck');
  p.push('head__head', 'head__eyes', 'browL__brow', 'browR__brow', 'mouth__mouth');
  if (a.female || a.age < 14) p.push('head__blush');
  for (const s of ['L', 'R']) p.push(`shoulder${s}__upperarm`, `elbow${s}__forearm`, `hand${s}__hand`, `thigh${s}__thigh`, `knee${s}__shin`, `foot${s}__shoe`);
  const longSleeves = a.topStyle !== 'tshirt' && a.topStyle !== 'robe';
  if (longSleeves) p.push('elbowL__cuff', 'elbowR__cuff');
  const hairHidden = a.hat === 'foulard' || a.hairStyle === 'chauve' || ((a.hat === 'casque' || a.hat === 'bonnet') && a.hairStyle !== 'long' && a.hairStyle !== 'tresses');
  if (!hairHidden) p.push(`head__hair_${a.hairStyle === 'gris' ? 'court' : a.hairStyle}`);
  if (a.hat) p.push(`head__hat_${a.hat}`);
  if (a.glasses) p.push('head__glasses');
  if (a.beard) p.push('head__beard');
  if (a.topStyle === 'chemise') p.push('chest__collar', 'chest__buttons');
  if (a.topStyle === 'hoodie') p.push('chest__hood');
  if (a.topStyle === 'doudoune') p.push('chest__hood', 'chest__puffer', 'chest__zip', 'spine__zip_low');
  if (a.topStyle === 'veste') p.push('chest__zip', 'spine__zip_low');
  if (a.apron !== null) p.push('spine__apron', 'chest__apron_bib');
  if (a.vest !== null) p.push('chest__vest_band');
  if (a.bottomStyle === 'jupe' || a.topStyle === 'robe') p.push('hips__skirt');
  return p;
}

/** Couleur (linéaire) et rugosité d'un rôle de matériau pour une pièce donnée. */
function colorFor(a: Appearance, part: string, role: string): [THREE.Color, number] {
  const top = a.vest ?? a.top;
  const shortSleeves = a.topStyle === 'tshirt' || a.topStyle === 'robe';
  const bareLegs = a.bottomStyle === 'short' || a.bottomStyle === 'jupe' || a.topStyle === 'robe';
  const dressBottom = a.topStyle === 'robe' ? top : a.bottom;
  switch (role) {
    case 'skin':
      return [lin(a.skin), 0.55];
    case 'top':
      if (part.includes('forearm') && shortSleeves) return [lin(a.skin), 0.55];
      return [lin(top), a.topStyle === 'doudoune' ? 0.5 : 0.85];
    case 'topdark':
      return [lin(top, 0.72), 0.7];
    case 'bottom':
      if (part.includes('shin') && bareLegs) return [lin(a.skin), 0.55];
      if (part.includes('thigh') && (a.bottomStyle === 'jupe' || a.topStyle === 'robe')) return [lin(a.skin), 0.55];
      if (part.includes('skirt') || part.includes('hips')) return [lin(part.includes('hips') && a.topStyle === 'robe' ? top : dressBottom), 0.88];
      return [lin(a.bottom), 0.88];
    case 'shoes':
      return [lin(a.shoes), 0.45];
    case 'sole':
      return [lin(a.shoes === 0xffffff || a.shoes === 0xf5f6fa || a.shoes === 0xdcdde1 ? 0x3a3a3a : 0xf2f2ee), 0.7];
    case 'hair':
      return [lin(a.hair), 0.7];
    case 'brow':
      return [lin(a.hair > 0xb0b0b0 ? 0x8a7a6a : a.hair, 0.85), 0.8];
    case 'eye':
      return [lin(a.body?.eyes ?? 0x4a2e1a), 0.15];
    case 'hat':
      return [lin(a.hatColor), 0.8];
    case 'apron':
      return [lin(a.apron ?? 0xe84118), 0.85];
    case 'blush':
      return [lin(a.skin).lerp(lin(0xff8a80), 0.45), 0.6];
    case 'eyewhite':
      return [lin(0xf5f5f0), 0.2];
    case 'pupil':
      return [lin(0x111111), 0.1];
    case 'shine':
      return [lin(0xffffff), 0.05];
    case 'mouth':
      return [lin(0x8e2a35), 0.5];
    case 'dark':
      return [lin(0x1e1e1e), 0.4];
    case 'white':
      return [lin(0xf5f5f5), 0.7];
    case 'yellow':
      return [lin(0xf1c40f), 0.6];
    case 'metal':
      return [lin(0xb2bec3), 0.35];
    default:
      return [lin(0xcccccc), 0.7];
  }
}

const cache = new Map<string, THREE.BufferGeometry>();

export function kitReady() {
  return !!getKit('characters');
}

/** Fabrique un habitant à partir du kit Blender. */
export function buildKitCharacter(a: Appearance): CharacterRig | null {
  const kit = getKit('characters');
  if (!kit) return null;
  const s = a.height / 1.75;
  const w = Math.max(0.85, Math.min(1.3, a.width));
  const kid = a.age < 15;
  // tête un peu plus grosse chez les enfants, centre de tête pour la mise à l'échelle
  const headK = kid ? 1.12 : 1;
  const key = JSON.stringify(a);
  let geo = cache.get(key);
  if (!geo) {
    const geos: THREE.BufferGeometry[] = [];
    for (const name of partsFor(a)) {
      const pieces = kit.get(name);
      if (!pieces) continue;
      const bone = name.split('__')[0] as BoneName;
      const bi = BONES.indexOf(bone);
      for (const pc of pieces) {
        const g = pc.geo.clone();
        // mise à l'échelle : largeur pour le corps, uniforme pour la tête (autour de son centre)
        if (HEAD_BONES.has(bone)) {
          g.translate(0, -HEAD_Z, 0);
          g.scale(headK, headK, headK);
          g.translate(0, HEAD_Z, 0);
          g.scale(s, s, s);
        } else g.scale(w * s, s, (0.85 + w * 0.15) * s);
        const [c, rough] = colorFor(a, name, pc.role);
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 4);
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          col[i * 4] = c.r;
          col[i * 4 + 1] = c.g;
          col[i * 4 + 2] = c.b;
          col[i * 4 + 3] = rough;
          si[i * 4] = bi;
          sw[i * 4] = 1;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 4));
        g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        geos.push(g.index ? g.toNonIndexed() : g);
      }
    }
    geo = mergeGeometries(geos, false)!;
    geo.computeBoundingSphere();
    cache.set(key, geo);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  // os : positions de repos à l'échelle (la tête garde son centre)
  const rest = {} as Record<BoneName, THREE.Vector3>;
  for (const n of BONES) {
    const [x, y, z] = REST[n];
    const v = new THREE.Vector3(x * (n.startsWith('shoulder') || n.startsWith('thigh') ? w : 1) * s, y * s, z * s);
    if (n === 'browL' || n === 'browR' || n === 'mouth') v.set(x * headK * s, (HEAD_Z + (y + 1.55 - HEAD_Z) * headK - 1.55) * s, z * headK * s);
    rest[n] = v;
  }
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    const b = new THREE.Bone();
    b.name = n;
    b.position.copy(rest[n]);
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
  const browY = rest.browL.y;
  return {
    root,
    mesh,
    bones,
    headY: (HEAD_Z + 0.015) * s,
    scale: s,
    app: a,
    rest,
    // visage : sourcils et bouche sur leurs os (positions relatives au repos)
    face: (expr, open) => {
      const rot = expr === 'angry' ? 0.32 : expr === 'sad' ? -0.28 : 0;
      bones.browL.rotation.z = -rot;
      bones.browR.rotation.z = rot;
      const lift = expr === 'surprised' ? 0.012 * s : expr === 'angry' ? -0.006 * s : 0;
      bones.browL.position.y = browY + lift;
      bones.browR.position.y = browY + lift;
      bones.mouth.rotation.set(0, 0, expr === 'sad' || expr === 'angry' ? Math.PI : 0);
      bones.mouth.scale.set(expr === 'surprised' ? 0.7 : expr === 'happy' ? 1.25 : 1, Math.max(0.6, Math.min(2.4, open)), 1);
    },
    dispose() {
      skeleton.dispose();
    },
  };
}
