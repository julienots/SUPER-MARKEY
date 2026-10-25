/**
 * Scène 3D du menu principal : une publicité de supermarché devenue incontrôlable.
 * Pluie de produits physiques, caddie fou, employé qui glisse sur une banane, client qui court après un carton,
 * ballons, pancartes « PROMO DU SIÈCLE ». Tout est simulé (physique Rapier, personnages animés).
 */
import * as THREE from 'three';
import { Physics } from '../physics/physics';
import { PRODUCTS, PRODUCT_BY_ID } from '../data/products';
import { Rng } from '../core/rng';
import { productCollider, productMesh } from '../world/productMeshes';
import { cartMesh } from '../world/equipmentMeshes';
import { buildCharacter, randomAppearance } from '../entities/character';
import { Animator } from '../entities/animator';
import { box, mat } from '../world/materials';
import { signTexture, floorTexture } from '../world/textures';
import { FLOORS } from '../data/styles';
import { cartonObject } from '../entities/items';
import type RAPIER from '@dimforge/rapier3d-compat';

interface Falling {
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
  age: number;
}

export class MenuScene {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  private physics: Physics;
  private items: Falling[] = [];
  private spawnT = 0;
  private t = 0;
  private cart: THREE.Group;
  private cartBody: RAPIER.RigidBody;
  private runner: { root: THREE.Group; anim: Animator; x: number };
  private carton: THREE.Group;
  private slipper: { root: THREE.Group; anim: Animator; t: number };
  private banana: THREE.Mesh;
  private balloons: THREE.Mesh[] = [];
  private signs: THREE.Mesh[] = [];
  private cashier: { root: THREE.Group; anim: Animator };
  reduced = false;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0x1a0604);
    s.fog = new THREE.Fog(0x1a0604, 18, 45);
    this.physics = new Physics();
    const hemi = new THREE.HemisphereLight(0xffe8c8, 0x401010, 1.1);
    s.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
    key.position.set(-6, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
    s.add(key);
    const rim = new THREE.PointLight(0xff5a1a, 40, 30, 1.5);
    rim.position.set(6, 4, -4);
    s.add(rim);
    // sol carrelé de supermarché
    const ft = floorTexture(FLOORS[1]);
    let fm: THREE.Material = mat(0xf2efe6);
    if (ft) {
      const t = ft.clone();
      t.needsUpdate = true;
      t.repeat.set(12, 12);
      fm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.3 });
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), fm);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    // rayons d'arrière-plan avec produits
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      box(g, 3.6, 2.2, 0.6, 0, 0, 0, mat(0xdfe4ea, { rough: 0.4, metal: 0.3 }));
      for (let lv = 0; lv < 4; lv++)
        for (let k = 0; k < 9; k++) {
          const p = PRODUCTS[(i * 37 + lv * 11 + k * 7) % PRODUCTS.length];
          const m = productMesh(p.id);
          m.position.set(-1.6 + k * 0.4, 0.3 + lv * 0.5 + p.size[1] / 2, 0.35);
          m.scale.setScalar(Math.min(1.4, 0.35 / Math.max(...p.size)));
          g.add(m);
        }
      g.position.set(-8 + i * 4.2, 0, -6);
      s.add(g);
    }
    // pancartes promo qui se dandinent
    const texts = ['PROMO DU SIÈCLE', '-99% SUR TOUT*', 'CHIPS À 0,01 €', 'TOUT DOIT DISPARAÎTRE'];
    texts.forEach((txt, i) => {
      const tex = signTexture(txt, i % 2 ? 0xffd32a : 0xe8291c, i % 2 ? 0xe8291c : 0xffffff, 512, 192);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.2 }));
      m.position.set(-7 + i * 4.6, 3.2 + (i % 2) * 0.5, -5);
      s.add(m);
      this.signs.push(m);
    });
    // ballons
    const cols = [0xe8291c, 0xffc72c, 0x0097e6, 0x44bd32, 0x9c88ff, 0xff7aa2];
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), mat(cols[i % cols.length], { rough: 0.15, metal: 0.05 }));
      b.scale.y = 1.2;
      b.position.set(-9 + Math.random() * 18, 3 + Math.random() * 3, -3 - Math.random() * 3);
      b.userData.phase = Math.random() * 10;
      s.add(b);
      this.balloons.push(b);
    }
    // caddie fou (cinématique : il bouscule les produits)
    this.cart = cartMesh(0xe8291c);
    this.cart.scale.setScalar(1.3);
    s.add(this.cart);
    const kb = this.physics.addKinematicBox(-12, 0.7, 2, 0.4, 0.65, 0.55, { kind: 'cart' });
    this.cartBody = kb.body;
    // client qui court après un carton
    const rng = new Rng(7);
    const app = randomAppearance(rng, { female: false, age: 30 });
    app.hat = 'casquette';
    app.top = 0xc0392b;
    const rig = buildCharacter(app);
    s.add(rig.root);
    this.runner = { root: rig.root, anim: new Animator(rig), x: -14 };
    this.runner.anim.run = true;
    this.carton = cartonObject('cereales', true);
    s.add(this.carton);
    // employé qui glisse sur une banane
    const app2 = randomAppearance(new Rng(99), { female: true, age: 26, uniform: 0xe8291c, role: 'rayon' });
    const rig2 = buildCharacter(app2);
    rig2.root.position.set(3.2, 0, 0.8);
    s.add(rig2.root);
    this.slipper = { root: rig2.root, anim: new Animator(rig2), t: 0 };
    this.banana = productMesh('bananes') as THREE.Mesh;
    this.banana.position.set(3.2, 0.04, 1.3);
    s.add(this.banana);
    // caissière impassible qui scanne
    const app3 = randomAppearance(new Rng(3), { female: true, age: 52, uniform: 0xffc72c, role: 'caissier' });
    const rig3 = buildCharacter(app3);
    rig3.root.position.set(7.5, 0, -1.5);
    rig3.root.rotation.y = -0.6;
    s.add(rig3.root);
    box(s, 2.4, 0.9, 0.8, 7.0, 0, -0.6, mat(0xe8291c));
    this.cashier = { root: rig3.root, anim: new Animator(rig3) };
    this.camera.position.set(0, 3.2, 11);
    this.camera.lookAt(0, 1.4, 0);
  }

  private spawnProduct() {
    const p = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
    const m = productMesh(p.id);
    const sc = Math.min(2.2, 0.45 / Math.max(...p.size));
    m.scale.setScalar(sc);
    const col = productCollider(p);
    const scaled = col.type === 'box' ? { ...col, hx: col.hx * sc, hy: col.hy * sc, hz: col.hz * sc } : col.type === 'cyl' ? { ...col, r: col.r * sc, hh: col.hh * sc } : { ...col, r: col.r * sc };
    const { body } = this.physics.addDynamic(scaled as any, { x: -6 + Math.random() * 12, y: 9 + Math.random() * 3, z: -1 + Math.random() * 4 }, { mass: Math.max(0.3, p.mass), restitution: 0.45, friction: 0.6, user: { kind: 'item' }, rotY: Math.random() * 6 });
    body.setAngvel({ x: Math.random() * 6 - 3, y: Math.random() * 6 - 3, z: Math.random() * 6 - 3 }, true);
    this.scene.add(m);
    this.items.push({ mesh: m, body, age: 0 });
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = this.reduced ? 1.2 : 0.18;
      if (this.items.length < (this.reduced ? 15 : 70)) this.spawnProduct();
    }
    // caddie : traverse l'écran en zigzaguant
    const cx = ((t * 4.5) % 34) - 17;
    const cz = 2 + Math.sin(t * 1.7) * 1.2;
    this.cartBody.setNextKinematicTranslation({ x: cx, y: 0.7, z: cz });
    this.cart.position.set(cx, 0, cz);
    this.cart.rotation.y = Math.PI / 2 + Math.sin(t * 1.7) * 0.35;
    this.physics.step(dt, 3);
    for (const it of this.items) {
      it.age += dt;
      const p = it.body.translation();
      const r = it.body.rotation();
      it.mesh.position.set(p.x, p.y, p.z);
      it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    const old = this.items.filter((i) => i.age > 14);
    for (const o of old) {
      this.scene.remove(o.mesh);
      this.physics.removeBody(o.body);
    }
    this.items = this.items.filter((i) => i.age <= 14);
    // le carton s'échappe, le client court derrière
    const rx = ((t * 3.6) % 32) - 16;
    this.carton.position.set(rx + 1.6, 0.3 + Math.abs(Math.sin(t * 6)) * 0.5, 4.2);
    this.carton.rotation.set(t * 3, t * 2, 0);
    this.runner.root.position.set(rx, 0, 4.2);
    this.runner.root.rotation.y = Math.PI / 2;
    this.runner.anim.speed = 3.6;
    this.runner.anim.expression = 'surprised';
    this.runner.anim.update(dt, Math.PI / 2, this.runner.root.position);
    // glissade en boucle
    this.slipper.t += dt;
    const ph = this.slipper.t % 6;
    const sAnim = this.slipper.anim;
    if (ph < 2.2) {
      sAnim.speed = 1.2;
      sAnim.stop();
      this.slipper.root.position.set(3.2 - 2.2 + ph, 0, 1.3);
      this.slipper.root.rotation.y = Math.PI / 2;
    } else if (ph < 2.3) sAnim.play('slip');
    else if (ph > 4.6) {
      sAnim.play('shrug');
      sAnim.speed = 0;
    } else sAnim.speed = 0;
    sAnim.update(dt, this.slipper.root.rotation.y, this.slipper.root.position);
    this.banana.rotation.y = t;
    this.cashier.anim.play('scan');
    this.cashier.anim.update(dt, -0.6, this.cashier.root.position);
    for (const b of this.balloons) b.position.y += Math.sin(t * 1.4 + b.userData.phase) * dt * 0.3;
    this.signs.forEach((s, i) => {
      s.rotation.z = Math.sin(t * 2 + i) * 0.08;
      s.rotation.y = Math.sin(t * 0.7 + i) * 0.25;
    });
    // caméra qui respire
    this.camera.position.x = Math.sin(t * 0.15) * 2.2;
    this.camera.position.y = 3.2 + Math.sin(t * 0.21) * 0.3;
    this.camera.lookAt(0, 1.3, 0);
  }

  dispose() {
    this.scene.clear();
  }
}

export const _p = PRODUCT_BY_ID;
