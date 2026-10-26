/**
 * Galerie de personnages (?gallery) : une rangée d'habitants générés au hasard, pour contrôler le rendu
 * des humains réalistes (morphologies, origines, vêtements, expressions, animations).
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { buildCharacter, randomAppearance } from '../entities/character';
import { Animator, type Action, type Expression } from '../entities/animator';

export class Gallery {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  private anims: Animator[] = [];
  private t = 0;
  /** Durée de fabrication de chaque personnage (ms). */
  buildMs: number[] = [];

  constructor(seed = 1, count = 10, opts: { close?: boolean; actions?: boolean; hair?: boolean } = {}) {
    // éclairage proche de celui du magasin (néons + lumière du jour)
    this.scene.background = new THREE.Color(0xe9edf2);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b0a8, 2.2);
    const sun = new THREE.DirectionalLight(0xfff6ea, 2.0);
    sun.position.set(2, 6, 6);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    fill.position.set(-4, 3, 4);
    this.scene.add(hemi, sun, fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const rng = new Rng(seed);
    const exprs: Expression[] = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'bored'];
    const acts: Action[] = ['idle', 'talk', 'wave', 'examine', 'phone', 'shrug', 'idle', 'celebrate'];
    for (let i = 0; i < count; i++) {
      const female = i % 2 === 1;
      const age = [24, 31, 17, 45, 68, 38, 29, 55, 21, 76, 34, 15][i % 12];
      const app = randomAppearance(new Rng(rng.int(1, 1e9)), { female, age });
      if (opts.hair) {
        app.hairStyle = (['court', 'long', 'chignon', 'queue', 'tresses', 'afro', 'meche', 'chauve'] as const)[i % 8];
        app.hat = null;
      }
      const t0 = performance.now();
      const rig = buildCharacter(app);
      this.buildMs.push(performance.now() - t0);
      rig.root.position.set((i - (count - 1) / 2) * 0.75, 0, 0);
      this.scene.add(rig.root);
      const an = new Animator(rig);
      an.expression = opts.actions ? exprs[i % exprs.length] : 'neutral';
      if (opts.actions) an.play(acts[i % acts.length]);
      an.look = null;
      this.anims.push(an);
    }
    const w = count * 0.75;
    if (opts.close) {
      this.camera.position.set(0, 1.6, 2.2);
      this.camera.lookAt(0, 1.55, 0);
    } else {
      this.camera.position.set(0, 1.25, w * 1.25);
      this.camera.lookAt(0, 0.95, 0);
    }
  }

  update(dt: number) {
    this.t += dt;
    for (const a of this.anims) a.update(dt, 0, a.rig.root.position);
  }
}
