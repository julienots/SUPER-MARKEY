/**
 * Le quartier : routes, trottoirs, passages piétons, immeubles, maisons, commerces, concurrents,
 * stade, éclairage public, arbres, mobilier urbain. Enregistre aussi la navigation et les collisions statiques.
 */
import * as THREE from 'three';
import { BUILDINGS, BUS_STOP, CROSSWALKS, ROADS, SIDEWALKS, STREET_LAMPS, type BuildingDef } from '../data/world';
import { COMPETITORS } from '../data/competitors';
import { F_CROSSWALK, F_ROAD, type NavGrid } from '../sim/nav';
import type { GameState } from '../sim/state';
import type { Physics } from '../physics/physics';
import { box, cyl, mat, metalMat, glassMat, plane } from './materials';
import { asphaltTexture, facadeTextures, grassTexture, paverTexture, signTexture, radialGlowTexture } from './textures';
import { carMesh, CAR_COLORS } from './vehicleMeshes';

export class City {
  group = new THREE.Group();
  private windowMats: THREE.MeshStandardMaterial[] = [];
  private lampMats: THREE.MeshStandardMaterial[] = [];
  private lampGlows: THREE.Sprite[] = [];
  private competitorGroups = new Map<string, THREE.Group>();
  private stadiumLights: THREE.MeshStandardMaterial[] = [];
  private builtProsperity = new Map<string, number>();

  constructor(private scene: THREE.Scene, private physics: Physics, private nav: NavGrid) {
    this.group.name = 'city';
    scene.add(this.group);
  }

  build(st: GameState) {
    this.buildGround();
    this.buildRoads();
    for (const b of BUILDINGS) if (b.kind !== 'garage') this.buildBuilding(b, st);
    for (const c of COMPETITORS) this.buildCompetitor(c.id, st);
    this.buildLamps();
    this.buildTrees();
    this.buildProps();
  }

  private buildGround() {
    const g = grassTexture();
    let m: THREE.Material = mat(0x5f8a3b, { rough: 1 });
    if (g) {
      const t = g.clone();
      t.needsUpdate = true;
      t.repeat.set(60, 45);
      m = new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
    }
    const ground = plane(this.group, 260, 200, m);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
  }

  private buildRoads() {
    const at = asphaltTexture();
    for (const r of ROADS) {
      const [x0, z0, x1, z1] = r.rect;
      let m: THREE.Material = mat(0x3b3d40, { rough: 0.95 });
      if (at) {
        const t = at.clone();
        t.needsUpdate = true;
        t.repeat.set((x1 - x0) / 6, (z1 - z0) / 6);
        m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
      }
      const p = plane(this.group, x1 - x0, z1 - z0, m);
      p.rotation.x = -Math.PI / 2;
      p.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2);
      p.receiveShadow = true;
      this.nav.fillRect(x0, z0, x1, z1, 9, F_ROAD, 'set');
      // marquage central en pointillés
      const dash = mat(0xf5f6fa, { rough: 0.8, key: 'dash' });
      if (r.axis === 'x') {
        for (let x = x0 + 2; x < x1; x += 6) {
          const d = plane(this.group, 3, 0.15, dash);
          d.rotation.x = -Math.PI / 2;
          d.position.set(x, 0.015, (z0 + z1) / 2);
        }
      } else {
        for (let z = z0 + 2; z < z1; z += 6) {
          const d = plane(this.group, 0.15, 3, dash);
          d.rotation.x = -Math.PI / 2;
          d.position.set((x0 + x1) / 2, 0.015, z);
        }
      }
    }
    const pt = paverTexture();
    for (const s of SIDEWALKS) {
      const [x0, z0, x1, z1] = s;
      let m: THREE.Material = mat(0xb9b4aa, { rough: 0.9 });
      if (pt) {
        const t = pt.clone();
        t.needsUpdate = true;
        t.repeat.set((x1 - x0) / 2, (z1 - z0) / 2);
        m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
      }
      const b = box(this.group, x1 - x0, 0.12, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2, m, false, true);
      b.castShadow = false;
      this.nav.fillRect(x0, z0, x1, z1, 1, 0, 'set');
      this.physics.addStaticBox((x0 + x1) / 2, 0.06, (z0 + z1) / 2, (x1 - x0) / 2, 0.06, (z1 - z0) / 2);
    }
    const white = mat(0xf5f6fa, { rough: 0.7, key: 'zebra' });
    for (const c of CROSSWALKS) {
      const [x0, z0, x1, z1] = c;
      const alongX = x1 - x0 < z1 - z0; // les bandes sont perpendiculaires au sens de marche
      const len = alongX ? z1 - z0 : x1 - x0;
      for (let k = 0.4; k < len; k += 0.9) {
        const s = plane(this.group, alongX ? x1 - x0 : 0.5, alongX ? 0.5 : z1 - z0, white);
        s.rotation.x = -Math.PI / 2;
        s.position.set(alongX ? (x0 + x1) / 2 : x0 + k, 0.016, alongX ? z0 + k : (z0 + z1) / 2);
      }
      this.nav.fillRect(x0, z0, x1, z1, 1, F_CROSSWALK, 'set');
    }
  }

  private buildingMaterials(b: BuildingDef, prosperity: number, faceLen: number) {
    const cols = Math.max(2, Math.round(faceLen / 3));
    const { map, emissive } = facadeTextures(Math.abs(Math.round(b.rect[0] * 13 + b.rect[1] * 7)) + 1, b.color, Math.max(1, b.floors), cols, prosperity);
    const m = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : b.color, map, roughness: 0.9, emissive: emissive ? 0xffffff : 0x000000, emissiveMap: emissive, emissiveIntensity: 0 });
    this.windowMats.push(m);
    return m;
  }

  private buildBuilding(b: BuildingDef, st: GameState) {
    const [x0, z0, x1, z1] = b.rect;
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const prosperity = st.quartiers.find((q) => q.id === b.quartier)?.prosperity ?? 0.5;
    this.builtProsperity.set(b.id, prosperity);
    const g = new THREE.Group();
    g.name = `bld:${b.id}`;
    this.group.add(g);
    const floorH = 3;
    const H = b.kind === 'maison' ? 5.5 : b.kind === 'stade' ? 9 : b.kind === 'gymnase' ? 8 : b.floors * floorH;
    this.nav.fillRect(x0, z0, x1, z1, 0, 0, 'set');
    this.physics.addStaticBox(cx, H / 2, cz, w / 2, H / 2, d / 2);
    // porte : petite encoche praticable devant
    this.nav.fillRect(b.door[0] - 0.6, b.door[1] - 0.6, b.door[0] + 0.6, b.door[1] + 0.6, 1, 0, 'set');

    if (b.kind === 'immeuble' || b.kind === 'commerce') {
      const faces: [number, number, number, number, number][] = [
        // cx, cz, len, rotY, normal
        [cx, z1 + 0.01, w, 0, 0],
        [cx, z0 - 0.01, w, Math.PI, 0],
        [x1 + 0.01, cz, d, Math.PI / 2, 0],
        [x0 - 0.01, cz, d, -Math.PI / 2, 0],
      ];
      for (const [fx, fz, len, ry] of faces) {
        const m = this.buildingMaterials(b, prosperity, len);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(len, H), m);
        p.position.set(fx, H / 2, fz);
        p.rotation.y = ry;
        p.receiveShadow = true;
        g.add(p);
      }
      const core = box(g, w - 0.04, H, d - 0.04, cx, 0, cz, mat(b.color, { rough: 0.9 }));
      core.castShadow = true;
      box(g, w + 0.3, 0.4, d + 0.3, cx, H, cz, mat(0x5d6d7e, { rough: 0.8 }));
      // entrée
      const fd = b.face;
      const doorRot = fd === 's' ? Math.PI : fd === 'n' ? 0 : fd === 'e' ? Math.PI / 2 : -Math.PI / 2;
      const dg = new THREE.Group();
      dg.position.set(b.door[0], 0, b.door[1]);
      dg.rotation.y = doorRot;
      box(dg, 1.4, 2.3, 0.1, 0, 0, -0.45, mat(0x5d4037, { rough: 0.6 }));
      box(dg, 2.2, 0.15, 1.1, 0, 2.6, -0.1, mat(0x2d3436));
      g.add(dg);
      if (b.kind === 'commerce' && b.sign) {
        const tex = signTexture(b.sign.text, b.sign.bg, b.sign.fg, 512, 96);
        const sw = Math.min(w - 0.6, 6);
        const s = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 5.3), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : b.sign.bg, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }));
        s.position.set(b.door[0], 3.4, b.door[1] - (fd === 's' ? 0.55 : -0.55));
        s.rotation.y = fd === 's' ? Math.PI : 0;
        g.add(s);
        // vitrine
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(w - 1, 2.2), mat(0x9fc5e8, { rough: 0.1, metal: 0.3, emissive: 0xfff2d0, emissiveIntensity: 0.15 }));
        gl.position.set(cx + 1.2, 1.3, (fd === 's' ? z0 : z1) + (fd === 's' ? -0.02 : 0.02));
        gl.rotation.y = fd === 's' ? Math.PI : 0;
        gl.scale.x = 0.5;
        g.add(gl);
      }
    } else if (b.kind === 'maison') {
      const wall = box(g, w - 2, 2.9, d - 2, cx, 0, cz, mat(b.color, { rough: 0.85 }));
      wall.castShadow = true;
      // toit à deux pans
      const roofGeo = new THREE.CylinderGeometry(0.01, (w - 1.4) * 0.72, 2.2, 4, 1);
      roofGeo.rotateY(Math.PI / 4);
      const roof = new THREE.Mesh(roofGeo, mat(b.roof ?? 0x8b3a2b, { rough: 0.8, flat: true }));
      roof.scale.z = (d - 1.4) / (w - 1.4);
      roof.position.set(cx, 2.9 + 1.1, cz);
      roof.castShadow = true;
      g.add(roof);
      // fenêtres
      for (const sx of [-1, 1]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.windowMat());
        win.position.set(x0 + 0.98, 1.6, cz + sx * 1.5);
        win.rotation.y = -Math.PI / 2;
        g.add(win);
      }
      box(g, 0.1, 2.1, 1, x0 + 0.95, 0, cz, mat(0x6d4c41));
      // jardin : haie
      const hedge = mat(0x2e7d32, { rough: 1, flat: true });
      box(g, 0.5, 1.1, d, x1 - 0.25, 0, cz, hedge);
      box(g, w, 1.1, 0.5, cx, 0, z1 - 0.25, hedge);
      if (prosperity > 0.7) {
        const pool = plane(g, 2, 3, mat(0x48dbfb, { rough: 0.1, metal: 0.2, emissive: 0x0a3d62, emissiveIntensity: 0.2 }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x1 - 1.3, 0.03, cz);
      }
    } else if (b.kind === 'stade') {
      const pitch = plane(g, w - 8, d - 6, mat(0x2ecc71, { rough: 1 }));
      pitch.rotation.x = -Math.PI / 2;
      pitch.position.set(cx, 0.03, cz);
      for (let k = 0; k < 4; k++) {
        box(g, w, 1.2, 1.2, cx, k * 1.2, z0 + 0.6 + k * 1.2, mat(0xbdc3c7, { rough: 0.9 }));
        box(g, w, 1.2, 1.2, cx, k * 1.2, z1 - 0.6 - k * 1.2, mat(0xbdc3c7, { rough: 0.9 }));
      }
      for (const [mx, mz] of [[x0 + 1, z0 + 1], [x1 - 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z1 - 1]]) {
        box(g, 0.4, 18, 0.4, mx, 0, mz, metalMat(0x7f8c8d));
        const lm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 });
        this.stadiumLights.push(lm);
        box(g, 2.5, 1.2, 0.3, mx, 18, mz, lm);
      }
      const tex = signTexture('STADE R. KOPA', 0x1e3799, 0xffffff, 512, 96);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.9), new THREE.MeshStandardMaterial({ map: tex }));
      s.position.set(cx, 6.5, z0 - 0.05);
      s.rotation.y = Math.PI;
      g.add(s);
      box(g, w, 4.8, 0.3, cx, 0, z0, mat(0x95a5a6));
    } else if (b.kind === 'gymnase') {
      box(g, w, 6, d, cx, 0, cz, mat(b.color, { rough: 0.8 }));
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 16, 1, false, 0, Math.PI), mat(0x95a5a6, { rough: 0.6, metal: 0.4 }));
      arch.rotation.z = Math.PI / 2;
      arch.rotation.y = 0;
      arch.position.set(cx, 6, cz);
      arch.scale.set(1, 1, 0.35);
      g.add(arch);
    }
  }

  private windowMat() {
    const m = new THREE.MeshStandardMaterial({ color: 0x41505c, roughness: 0.2, metalness: 0.2, emissive: 0xffd9a0, emissiveIntensity: 0 });
    this.windowMats.push(m);
    return m;
  }

  private buildCompetitor(id: string, st: GameState) {
    const def = COMPETITORS.find((c) => c.id === id)!;
    const c = st.competitors.find((x) => x.id === id)!;
    const [x0, z0, x1, z1] = def.rect;
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const old = this.competitorGroups.get(id);
    if (old) this.group.remove(old);
    const g = new THREE.Group();
    g.name = `comp:${id}`;
    this.group.add(g);
    this.competitorGroups.set(id, g);
    this.nav.fillRect(x0, z0, x1, z1, 0, 0, 'set');
    const facesSouth = def.door[1] < cz;
    const notYet = !c.open && !c.closedForever && def.opensDay !== undefined;
    if (notYet) {
      // chantier de l'hypermarché
      box(g, w, 0.3, d, cx, 0, cz, mat(0x8c7b6b));
      for (let x = x0; x < x1; x += 4) box(g, 0.15, 10, 0.15, x, 0, z0, metalMat(0xf39c12));
      box(g, w, 6, d * 0.5, cx, 0, cz + d * 0.2, mat(0xbdc3c7, { rough: 0.9 }));
      const tex = signTexture('PROCHAINEMENT : MÉGAHYPER GALAXIE', 0x8c7ae6, 0xffffff, 1024, 128);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }));
      s.position.set(cx, 3.5, z0 - 0.6);
      g.add(s);
      this.physics.addStaticBox(cx, 3, cz, w / 2, 3, d / 2);
      return;
    }
    const H = def.strategy === 'hyper' ? 9 : def.strategy === 'discount' ? 6 : 4.5;
    const body = box(g, w, H, d, cx, 0, cz, mat(def.strategy === 'discount' ? 0xdfe4ea : def.strategy === 'premium' ? 0x3d3d3d : 0xf1f2f6, { rough: 0.7 }));
    body.castShadow = true;
    this.physics.addStaticBox(cx, H / 2, cz, w / 2, H / 2, d / 2);
    const frontZ = facesSouth ? z0 - 0.02 : z1 + 0.02;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, 2.6), mat(0x9fc5e8, { rough: 0.05, metal: 0.4, emissive: 0xfff6e0, emissiveIntensity: c.closedForever ? 0 : 0.35 }));
    glass.position.set(cx, 1.4, frontZ);
    glass.rotation.y = facesSouth ? Math.PI : 0;
    g.add(glass);
    const text = c.closedForever ? `${def.name} — FERMÉ DÉFINITIVEMENT` : def.name.toUpperCase();
    const tex = signTexture(text, c.closedForever ? 0x636e72 : def.color, def.strategy === 'discount' ? 0x1e272e : 0xffffff, 1024, 128);
    const sw = Math.min(w - 1, 16);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 8), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : def.color, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: c.closedForever ? 0 : 0.3 }));
    s.position.set(cx, H - 0.9, frontZ + (facesSouth ? -0.05 : 0.05));
    s.rotation.y = facesSouth ? Math.PI : 0;
    g.add(s);
    this.nav.fillRect(def.door[0] - 1, def.door[1] - 0.8, def.door[0] + 1, def.door[1] + 0.8, 1, 0, 'set');
    if (def.strategy === 'discount' || def.strategy === 'hyper') {
      // parking avec voitures garées
      const pz0 = facesSouth ? z0 - 10 : z1;
      const pz1 = facesSouth ? z0 : z1 + 10;
      if (def.strategy === 'hyper') {
        const lot = plane(g, w, 9, mat(0x55585c, { rough: 0.95 }));
        lot.rotation.x = -Math.PI / 2;
        lot.position.set(cx, 0.012, (pz0 + pz1) / 2 - (facesSouth ? 0 : 0));
      }
      for (let k = 0; k < 5; k++) {
        const car = carMesh(CAR_COLORS[(k * 5 + id.length) % CAR_COLORS.length], k % 2 ? 'berline' : 'citadine');
        car.position.set(x0 + 3 + k * 3, 0, facesSouth ? z0 - 3.5 : z1 + 3.5);
        car.rotation.y = facesSouth ? 0 : Math.PI;
        if (def.strategy === 'discount' && facesSouth) car.position.z = z0 - 1.8 - (k % 2) * 0.01;
        if (def.strategy === 'discount') continue;
        g.add(car);
      }
    }
  }

  /** Met à jour un concurrent (ouverture, faillite) sans tout reconstruire. */
  refreshCompetitor(id: string, st: GameState) {
    this.buildCompetitor(id, st);
  }

  private buildLamps() {
    const pole = metalMat(0x34495e);
    for (const [x, z] of STREET_LAMPS) {
      cyl(this.group, 0.07, 5.5, x, 0, z, pole, 6).castShadow = false;
      const m = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffd28a, emissiveIntensity: 0 });
      this.lampMats.push(m);
      const head = box(this.group, 0.35, 0.12, 0.7, x, 5.5, z, m, false);
      head.castShadow = false;
      const gt = radialGlowTexture(0xffd28a);
      if (gt) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
        sp.scale.set(3, 3, 1);
        sp.position.set(x, 5.4, z);
        this.group.add(sp);
        this.lampGlows.push(sp);
      }
      this.physics.addStaticBox(x, 2.75, z, 0.1, 2.75, 0.1);
      this.nav.fillRect(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0, 0, 'set');
    }
  }

  private buildTrees() {
    const spots: [number, number][] = [];
    for (let x = -94; x <= 94; x += 9) {
      if ((x > -48 && x < -32) || (x > 46 && x < 64)) continue;
      if (x > -14 && x < 38) continue; // devant notre parcelle
      spots.push([x + 2, -12.9], [x + 5, -27.1]);
    }
    for (let z = -64; z <= 36; z += 10) spots.push([-47.2, z + 3], [63.2, z + 5]);
    // petit parc de la cité
    for (let k = 0; k < 10; k++) spots.push([-68 + (k % 5) * 5, -52 + Math.floor(k / 5) * 7]);
    const n = spots.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 2.4, 6), mat(0x5d4037, { rough: 1 }), n);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.5, 1), mat(0x3e7d32, { rough: 1, flat: true }), n);
    trunk.castShadow = crown.castShadow = true;
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      m.makeTranslation(x, 1.2, z);
      trunk.setMatrixAt(i, m);
      const s = 0.8 + ((i * 37) % 10) / 20;
      m.makeScale(s, s * 1.15, s);
      m.setPosition(x, 3.2 * s + 0.6, z);
      crown.setMatrixAt(i, m);
      this.physics.addStaticBox(x, 1.2, z, 0.18, 1.2, 0.18);
      this.nav.fillRect(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0, 0, 'set');
    });
    this.group.add(trunk, crown);
  }

  private buildProps() {
    // abribus
    const [bx, bz] = BUS_STOP;
    const glassM = glassMat();
    box(this.group, 3.6, 0.1, 1.6, bx, 2.4, bz + 0.1, mat(0x2d3436));
    box(this.group, 3.6, 2.4, 0.05, bx, 0, bz + 0.8, glassM);
    for (const sx of [-1.75, 1.75]) box(this.group, 0.08, 2.4, 1.5, bx + sx, 0, bz + 0.1, mat(0x2d3436));
    box(this.group, 2.4, 0.45, 0.4, bx, 0, bz + 0.5, mat(0x7f8c8d));
    const ad = signTexture('BAZAR BAZAR : PROMOS INFERNALES', 0xe84118, 0xffffff, 512, 128);
    if (ad) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ map: ad, emissive: 0xffffff, emissiveMap: ad, emissiveIntensity: 0.3 }));
      p.position.set(bx + 1.79, 1.3, bz + 0.1);
      p.rotation.y = -Math.PI / 2;
      this.group.add(p);
    }
    this.physics.addStaticBox(bx, 1.2, bz + 0.8, 1.8, 1.2, 0.05);
    // voitures garées le long des rues (décor)
    let k = 0;
    for (let x = -90; x < 90; x += 7.5) {
      if ((x > -50 && x < -30) || (x > 44 && x < 66) || (x > -16 && x < 40)) continue;
      if ((k++ * 7) % 3 === 0) continue;
      const car = carMesh(CAR_COLORS[k % CAR_COLORS.length], k % 3 === 0 ? 'break' : k % 2 ? 'berline' : 'citadine');
      car.position.set(x, 0, -17.2);
      car.rotation.y = Math.PI / 2;
      this.group.add(car);
      this.physics.addStaticBox(x, 0.7, -17.2, 2.2, 0.7, 0.9);
    }
    // bancs et poubelles
    for (const [x, z] of [[-20, -14.2], [44, -14.2], [-40, -28], [6, 49.4], [30, -25.2]]) {
      box(this.group, 1.6, 0.45, 0.45, x, 0.12, z, mat(0x8d6e63));
      cyl(this.group, 0.22, 0.8, x + 1.3, 0.12, z, mat(0x27ae60, { metal: 0.3 }), 10);
    }
    // aire de jeux de la cité
    box(this.group, 3, 0.1, 0.1, -60, 2.2, -26 - 2, metalMat(0xe84118));
    for (const sx of [-1.5, 1.5]) box(this.group, 0.1, 2.2, 0.1, -60 + sx, 0, -28, metalMat(0xe84118));
  }

  /** Nuit : fenêtres allumées, lampadaires, projecteurs du stade. */
  setNight(f: number, stadiumOn: boolean) {
    for (const m of this.windowMats) m.emissiveIntensity = f * 0.9;
    for (const m of this.lampMats) m.emissiveIntensity = f * 2.2;
    for (const s of this.lampGlows) s.material.opacity = f * 0.75;
    for (const m of this.stadiumLights) m.emissiveIntensity = stadiumOn ? 3 : f * 0.2;
  }
}
