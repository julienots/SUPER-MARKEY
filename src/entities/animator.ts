/**
 * Animation procédurale des personnages : marche/course synchronisées sur la vitesse réelle,
 * actions contextuelles (attraper, examiner, porter, pousser, scanner, balayer, téléphoner...),
 * expressions faciales et regard. Les actions se superposent à la locomotion.
 */
import * as THREE from 'three';
import { damp } from '../core/math';
import type { CharacterRig } from './character';

export type Action =
  | 'idle'
  | 'reach'
  | 'reachLow'
  | 'examine'
  | 'carry'
  | 'push'
  | 'scan'
  | 'mop'
  | 'phone'
  | 'sigh'
  | 'angry'
  | 'celebrate'
  | 'slip'
  | 'talk'
  | 'sit'
  | 'crouch'
  | 'conceal'
  | 'wave'
  | 'point'
  | 'write'
  | 'film'
  | 'basket'
  | 'pay'
  | 'shrug'
  | 'dance';

export type Expression = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'bored';

export class Animator {
  speed = 0;
  action: Action = 'idle';
  actionT = 0;
  /** Action de fond (porter, pousser, panier) combinée à la marche. */
  hold: 'none' | 'carry' | 'push' | 'basket' = 'none';
  expression: Expression = 'neutral';
  look: THREE.Vector3 | null = null;
  run = false;
  private phase = Math.random() * 10;
  private blink = 0;
  private t = Math.random() * 100;
  private lean = 0;
  private headYaw = 0;
  private headPitch = 0;
  private reachHeight = 1.1;
  oldAge = false;
  private sitBlend = 0;
  private slipBlend = 0;

  constructor(public rig: CharacterRig) {
    this.oldAge = rig.app.age >= 70;
  }

  play(a: Action, opts: { height?: number } = {}) {
    if (this.action !== a) this.actionT = 0;
    this.action = a;
    if (opts.height !== undefined) this.reachHeight = opts.height;
  }

  stop() {
    this.action = 'idle';
    this.actionT = 0;
  }

  update(dt: number, worldYaw: number, worldPos: THREE.Vector3) {
    const b = this.rig.bones;
    this.t += dt;
    this.actionT += dt;
    const s = this.rig.scale;
    const spd = this.speed;
    const moving = spd > 0.05;
    const stride = (this.run ? 1.6 : 1.15) * s * (this.oldAge ? 0.8 : 1);
    this.phase += (spd / stride) * Math.PI * dt * 1.0;
    const ph = this.phase;
    const amp = Math.min(1, spd / 1.4) * (this.run ? 1.25 : 0.75) * (this.oldAge ? 0.65 : 1);

    // ---- locomotion
    const legSwing = moving ? Math.sin(ph) * 0.55 * amp : 0;
    b.thighL.rotation.set(-legSwing, 0, 0);
    b.thighR.rotation.set(legSwing, 0, 0);
    b.kneeL.rotation.set(moving ? Math.max(0, Math.sin(ph - 1.2)) * 0.9 * amp : 0, 0, 0);
    b.kneeR.rotation.set(moving ? Math.max(0, Math.sin(ph + Math.PI - 1.2)) * 0.9 * amp : 0, 0, 0);
    b.footL.rotation.set(0, 0, 0);
    b.footR.rotation.set(0, 0, 0);
    const bob = moving ? Math.abs(Math.cos(ph)) * 0.035 * amp * s : Math.sin(this.t * 1.6) * 0.004 * s;
    b.hips.position.y = 0.95 * s + bob - (moving ? 0.02 * s * amp : 0);
    b.hips.rotation.set(0, moving ? Math.sin(ph) * 0.08 * amp : 0, 0);
    this.lean = damp(this.lean, (this.run ? 0.25 : 0.05) * amp + (this.oldAge ? 0.15 : 0), 6, dt);
    b.spine.rotation.set(this.lean, moving ? -Math.sin(ph) * 0.1 * amp : 0, 0);
    b.chest.rotation.set(Math.sin(this.t * 1.6) * 0.012, 0, 0);
    const armSwing = moving ? Math.sin(ph) * 0.5 * amp : Math.sin(this.t * 1.3) * 0.02;
    b.shoulderL.rotation.set(armSwing, 0, 0.06);
    b.shoulderR.rotation.set(-armSwing, 0, -0.06);
    b.elbowL.rotation.set(-0.15 - (moving ? 0.25 * amp : 0), 0, 0);
    b.elbowR.rotation.set(-0.15 - (moving ? 0.25 * amp : 0), 0, 0);
    b.handL.rotation.set(0, 0, 0);
    b.handR.rotation.set(0, 0, 0);
    b.root.rotation.set(0, 0, 0);
    b.root.position.set(0, 0, 0);

    // ---- maintien (porter/pousser)
    if (this.hold === 'carry') {
      b.shoulderL.rotation.set(-1.05, 0, 0.18);
      b.shoulderR.rotation.set(-1.05, 0, -0.18);
      b.elbowL.rotation.set(-0.55, 0, 0);
      b.elbowR.rotation.set(-0.55, 0, 0);
    } else if (this.hold === 'push') {
      b.shoulderL.rotation.set(-0.85, 0, 0.12);
      b.shoulderR.rotation.set(-0.85, 0, -0.12);
      b.elbowL.rotation.set(-0.45, 0, 0);
      b.elbowR.rotation.set(-0.45, 0, 0);
      b.spine.rotation.x += 0.12;
    } else if (this.hold === 'basket') {
      b.shoulderL.rotation.set(0.05, 0, 0.12);
      b.elbowL.rotation.set(-1.3, 0, 0);
    }

    // ---- actions
    const at = this.actionT;
    const a = this.action;
    const pulse = Math.sin(this.t * 9);
    let sitTarget = 0;
    let slipTarget = 0;
    switch (a) {
      case 'reach':
      case 'reachLow': {
        const k = Math.min(1, at / 0.35) * (at > 0.9 ? Math.max(0, 1 - (at - 0.9) / 0.3) : 1);
        const h = a === 'reachLow' ? 0.4 : this.reachHeight;
        const ang = -0.5 - (h / s) * 0.85;
        b.shoulderR.rotation.x = THREE.MathUtils.lerp(b.shoulderR.rotation.x, ang, k);
        b.elbowR.rotation.x = THREE.MathUtils.lerp(b.elbowR.rotation.x, -0.2, k);
        if (h < 0.7) {
          b.spine.rotation.x += 0.45 * k;
          b.kneeL.rotation.x += 0.5 * k;
          b.kneeR.rotation.x += 0.5 * k;
          b.thighL.rotation.x -= 0.5 * k;
          b.thighR.rotation.x -= 0.5 * k;
          b.hips.position.y -= 0.12 * s * k;
        }
        break;
      }
      case 'examine':
        b.shoulderR.rotation.set(-1.0, 0.2, -0.25);
        b.elbowR.rotation.set(-1.1, 0, 0);
        b.shoulderL.rotation.set(-0.7, -0.1, 0.25);
        b.elbowL.rotation.set(-1.0, 0, 0);
        b.handR.rotation.set(0, Math.sin(this.t * 1.5) * 0.6, 0);
        break;
      case 'scan':
        b.shoulderR.rotation.set(-0.9, 0, -0.2 + Math.sin(this.t * 6) * 0.35);
        b.elbowR.rotation.set(-0.8, 0, 0);
        b.shoulderL.rotation.set(-0.6, 0, 0.2);
        b.elbowL.rotation.set(-0.9, 0, 0);
        break;
      case 'mop':
        b.shoulderR.rotation.set(-0.7, 0, -0.1 + Math.sin(this.t * 3) * 0.4);
        b.shoulderL.rotation.set(-0.9, 0, 0.1 + Math.sin(this.t * 3) * 0.4);
        b.elbowL.rotation.set(-0.6, 0, 0);
        b.elbowR.rotation.set(-0.3, 0, 0);
        b.spine.rotation.y = Math.sin(this.t * 3) * 0.25;
        b.spine.rotation.x += 0.2;
        break;
      case 'phone':
        b.shoulderR.rotation.set(-0.35, 0, -0.55);
        b.elbowR.rotation.set(-2.3, 0, 0);
        b.handR.rotation.set(0, 0, 0.4);
        break;
      case 'sigh': {
        const k = Math.sin(Math.min(Math.PI, at * 2.2));
        b.chest.rotation.x -= 0.12 * k;
        b.shoulderL.rotation.z += 0.12 * k;
        b.shoulderR.rotation.z -= 0.12 * k;
        b.neck.rotation.x = 0.35 * k;
        break;
      }
      case 'angry':
        b.shoulderR.rotation.set(-2.4 + pulse * 0.25, 0, -0.2);
        b.elbowR.rotation.set(-0.7, 0, 0);
        b.shoulderL.rotation.set(-0.3, 0, 0.5);
        b.elbowL.rotation.set(-1.2, 0, 0);
        b.chest.rotation.x += 0.08 * pulse;
        break;
      case 'celebrate':
        b.shoulderR.rotation.set(-2.9, 0, -0.3 + pulse * 0.15);
        b.shoulderL.rotation.set(-2.9, 0, 0.3 - pulse * 0.15);
        b.elbowL.rotation.set(-0.2, 0, 0);
        b.elbowR.rotation.set(-0.2, 0, 0);
        b.hips.position.y += Math.abs(Math.sin(this.t * 8)) * 0.08 * s;
        break;
      case 'dance':
        b.shoulderR.rotation.set(-1.6 + Math.sin(this.t * 5) * 0.8, 0, -0.4);
        b.shoulderL.rotation.set(-1.6 - Math.sin(this.t * 5) * 0.8, 0, 0.4);
        b.hips.rotation.y = Math.sin(this.t * 5) * 0.4;
        b.hips.position.y += Math.abs(Math.sin(this.t * 5)) * 0.05 * s;
        break;
      case 'talk':
        b.shoulderR.rotation.set(-0.6 + Math.sin(this.t * 3) * 0.2, 0, -0.3);
        b.elbowR.rotation.set(-1.0, 0, 0);
        b.neck.rotation.x = Math.sin(this.t * 4) * 0.06;
        break;
      case 'wave':
        b.shoulderR.rotation.set(-2.6, 0, -0.5 + Math.sin(this.t * 10) * 0.35);
        b.elbowR.rotation.set(-0.4, 0, 0);
        break;
      case 'point':
        b.shoulderR.rotation.set(-1.5, 0, 0);
        b.elbowR.rotation.set(0, 0, 0);
        break;
      case 'shrug':
        b.shoulderL.rotation.set(-0.3, 0, 0.6);
        b.shoulderR.rotation.set(-0.3, 0, -0.6);
        b.elbowL.rotation.set(-1.4, 0, 0);
        b.elbowR.rotation.set(-1.4, 0, 0);
        b.chest.position.y = 0.2 * s + Math.max(0, Math.sin(at * 4)) * 0.02;
        break;
      case 'write':
        b.shoulderL.rotation.set(-0.9, 0, 0.2);
        b.elbowL.rotation.set(-1.2, 0, 0);
        b.shoulderR.rotation.set(-0.8, 0, -0.1);
        b.elbowR.rotation.set(-1.1 + Math.sin(this.t * 12) * 0.05, 0, 0);
        b.neck.rotation.x = 0.35;
        break;
      case 'film':
        b.shoulderR.rotation.set(-1.4, 0, 0);
        b.elbowR.rotation.set(-0.5, 0, 0);
        break;
      case 'pay':
        b.shoulderR.rotation.set(-0.9, 0, -0.1);
        b.elbowR.rotation.set(-0.6, 0, 0);
        break;
      case 'conceal':
        b.shoulderR.rotation.set(-0.2, 0, 0.35);
        b.elbowR.rotation.set(-1.7, 0.4, 0);
        b.neck.rotation.y = Math.sin(this.t * 3) * 0.6;
        break;
      case 'crouch':
        b.thighL.rotation.x = -1.3;
        b.thighR.rotation.x = -1.3;
        b.kneeL.rotation.x = 2.0;
        b.kneeR.rotation.x = 2.0;
        b.hips.position.y = 0.48 * s;
        b.spine.rotation.x += 0.4;
        b.shoulderR.rotation.set(-0.9, 0, 0);
        break;
      case 'sit':
        sitTarget = 1;
        break;
      case 'slip':
        slipTarget = at < 2.2 ? 1 : 0;
        break;
      default:
        break;
    }
    this.sitBlend = damp(this.sitBlend, sitTarget, 8, dt);
    if (this.sitBlend > 0.01) {
      const k = this.sitBlend;
      b.thighL.rotation.x = THREE.MathUtils.lerp(b.thighL.rotation.x, -1.5, k);
      b.thighR.rotation.x = THREE.MathUtils.lerp(b.thighR.rotation.x, -1.5, k);
      b.kneeL.rotation.x = THREE.MathUtils.lerp(b.kneeL.rotation.x, 1.5, k);
      b.kneeR.rotation.x = THREE.MathUtils.lerp(b.kneeR.rotation.x, 1.5, k);
      b.hips.position.y = THREE.MathUtils.lerp(b.hips.position.y, 0.5 * s, k);
    }
    this.slipBlend = damp(this.slipBlend, slipTarget, slipTarget ? 10 : 3, dt);
    if (this.slipBlend > 0.01) {
      const k = this.slipBlend;
      b.root.rotation.x = -1.35 * k;
      b.root.position.y = 0.18 * k;
      b.root.position.z = -0.3 * k;
      b.shoulderL.rotation.set(-2.5 * k, 0, 0.8 * k);
      b.shoulderR.rotation.set(-2.5 * k, 0, -0.8 * k);
      b.thighL.rotation.x = -0.9 * k;
      b.thighR.rotation.x = -0.3 * k;
    }

    // ---- regard
    let ty = 0;
    let tp = 0;
    if (this.look) {
      const dx = this.look.x - worldPos.x;
      const dz = this.look.z - worldPos.z;
      const yaw = Math.atan2(dx, dz) - worldYaw;
      let d = yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 1.6) {
        ty = Math.max(-1.0, Math.min(1.0, d));
        const dist = Math.hypot(dx, dz);
        tp = Math.max(-0.5, Math.min(0.6, Math.atan2(this.rig.headY - this.look.y, Math.max(0.3, dist))));
      }
    } else if (!moving) ty = Math.sin(this.t * 0.4) * 0.25;
    this.headYaw = damp(this.headYaw, ty, 5, dt);
    this.headPitch = damp(this.headPitch, tp, 5, dt);
    b.head.rotation.set(this.headPitch, this.headYaw, 0);
    if (a === 'sigh' || a === 'write') b.head.rotation.x += 0.2;

    // ---- visage
    this.blink -= dt;
    const blinkNow = this.blink < 0.12;
    if (this.blink < 0) this.blink = 2 + Math.random() * 4;
    const e = a === 'angry' ? 'angry' : a === 'celebrate' || a === 'dance' ? 'happy' : a === 'slip' ? 'surprised' : a === 'sigh' ? 'sad' : this.expression;
    b.mouth.rotation.set(0, 0, e === 'sad' || e === 'angry' ? Math.PI : 0);
    const talk = a === 'talk' || a === 'phone' || a === 'angry';
    const mouthOpen = talk ? 0.5 + Math.abs(Math.sin(this.t * 14)) : e === 'surprised' ? 2.2 : e === 'neutral' || e === 'bored' ? 0.25 : 1;
    b.mouth.scale.set(e === 'surprised' ? 0.6 : 1, mouthOpen, 1);
    const browRot = e === 'angry' ? 0.35 : e === 'sad' ? -0.3 : e === 'surprised' ? 0 : 0;
    const browY = e === 'surprised' ? 0.012 : 0;
    b.browL.rotation.z = browRot;
    b.browR.rotation.z = -browRot;
    b.browL.position.y = 0.167 * s + browY;
    b.browR.position.y = 0.167 * s + browY;
    b.head.scale.set(1, blinkNow ? 1 : 1, 1);
  }
}
