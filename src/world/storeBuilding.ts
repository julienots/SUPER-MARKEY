/**
 * Bâtiment du magasin du joueur : sol, murs, façade segmentée (mur / vitrine / porte), portes automatiques,
 * rideaux métalliques la nuit, réserve, quai de livraison, enseigne + logo, parking, parcelles à vendre, chantier.
 * Reconstruit entièrement depuis l'état (agrandissement, façade, style) — rien n'est « figé ».
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { FLOORS, WALLS } from '../data/styles';
import { PARKING_EXT, PLAYER_LOT, PLAYER_PARKING, DOCK_YARD } from '../data/world';
import { FACADE_SEG, LANDS, STAGES, storeRect, WALL_H, type StoreRect } from '../sim/layout';
import { F_DOCK, F_DOOR, F_INTERIOR, F_STAFF, type NavGrid } from '../sim/nav';
import type { GameState } from '../sim/state';
import type { Physics } from '../physics/physics';
import { box, glassMat, mat, metalMat, plane } from './materials';
import { brickTexture, floorTexture, hasDom, signTexture, asphaltTexture, css } from './textures';
import { logoCanvas } from './shopLogo';
import { mergeStatic } from './merge';

interface SlidingDoor {
  x: number;
  left: THREE.Object3D;
  right: THREE.Object3D;
  open: number;
}

export interface ParkingSpot {
  x: number;
  z: number;
  ry: number;
  taken: boolean;
}

export class StoreBuilding {
  group = new THREE.Group();
  private colliders: RAPIER.Collider[] = [];
  private doors: SlidingDoor[] = [];
  private shutters: THREE.Mesh[] = [];
  private shutterLevel = 0;
  private dockShutter: THREE.Mesh | null = null;
  private dockOpen = 0;
  private staffDoor: THREE.Object3D | null = null;
  private staffOpen = 0;
  lights: THREE.PointLight[] = [];
  private lightPanels: THREE.MeshStandardMaterial[] = [];
  private extLights: THREE.PointLight[] = [];
  parkingSpots: ParkingSpot[] = [];
  rect!: StoreRect;
  private power = true;
  private signMat: THREE.MeshStandardMaterial | null = null;

  constructor(private scene: THREE.Scene, private physics: Physics, private nav: NavGrid) {
    this.group.name = 'store';
    scene.add(this.group);
  }

  private clear() {
    for (const c of this.colliders) this.physics.removeCollider(c);
    this.colliders = [];
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && (m.geometry as any).__own) m.geometry.dispose();
    });
    this.group.clear();
    this.doors = [];
    this.shutters = [];
    this.lights = [];
    this.lightPanels = [];
    this.extLights = [];
    this.parkingSpots = [];
    this.dockShutter = null;
    this.staffDoor = null;
  }

  private wallBox(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: THREE.Material, collide = true) {
    const w = Math.abs(x1 - x0);
    const d = Math.abs(z1 - z0);
    const h = y1 - y0;
    if (w < 0.01 || d < 0.01 || h < 0.01) return;
    const mesh = box(this.group, w, h, d, (x0 + x1) / 2, y0, (z0 + z1) / 2, m);
    if (collide) this.colliders.push(this.physics.addStaticBox((x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2, w / 2, h / 2, d / 2));
    return mesh;
  }

  build(st: GameState) {
    this.clear();
    const r = (this.rect = storeRect(st.store.stage));
    const wallStyle = WALLS.find((w) => w.id === st.store.wall) ?? WALLS[0];
    const floorStyle = FLOORS.find((f) => f.id === st.store.floor) ?? FLOORS[0];
    const inner = mat(wallStyle.color, { rough: 0.85 });
    const brick = brickTexture(0xb5654a);
    const outer = mat(0xffffff, { map: brick, rough: 0.9, key: 'brickwall' });
    if (brick) {
      brick.repeat.set(1, 1);
    }
    const facadeMat = mat(st.store.signBg, { rough: 0.6 });
    const T = 0.25;

    // ---------------- Nav : réinitialise la parcelle
    const n = this.nav;
    n.fillRect(PLAYER_LOT[0], PLAYER_LOT[1], PLAYER_LOT[2], PLAYER_LOT[3], 2, 0, 'set');
    n.fillRect(PLAYER_PARKING[0], PLAYER_PARKING[1], PLAYER_PARKING[2], PLAYER_PARKING[3], 1, 0, 'set');
    n.fillRect(DOCK_YARD[0], DOCK_YARD[1], DOCK_YARD[2], DOCK_YARD[3], 1, F_DOCK, 'set');
    const owned = (id: string) => st.store.ownedLand.includes(id);
    n.fillRect(PARKING_EXT[0], PARKING_EXT[1], PARKING_EXT[2], PARKING_EXT[3], owned('parking') ? 1 : 0, 0, 'set');

    // ---------------- Sol extérieur de la parcelle
    const asphalt = asphaltTexture();
    const lotMat = mat(0x6b6e72, { map: asphalt, rough: 0.95, key: 'lotAsphalt' });
    const lot = plane(this.group, PLAYER_LOT[2] - PLAYER_LOT[0], PLAYER_LOT[3] - PLAYER_LOT[1], lotMat);
    if (asphalt) {
      const t = asphalt.clone();
      t.needsUpdate = true;
      t.repeat.set((PLAYER_LOT[2] - PLAYER_LOT[0]) / 4, (PLAYER_LOT[3] - PLAYER_LOT[1]) / 4);
      (lot.material as THREE.MeshStandardMaterial) = mat(0x8a8d91, { map: t, rough: 0.95, key: 'lotAsphalt2' });
    }
    lot.rotation.x = -Math.PI / 2;
    lot.position.set((PLAYER_LOT[0] + PLAYER_LOT[2]) / 2, 0.012, (PLAYER_LOT[1] + PLAYER_LOT[3]) / 2);
    lot.receiveShadow = true;
    this.buildParking(st);

    // ---------------- Sol intérieur
    const ft = floorTexture(floorStyle);
    let floorMat: THREE.Material = mat(floorStyle.base, { rough: 0.35 });
    if (ft) {
      const t = ft.clone();
      t.needsUpdate = true;
      t.repeat.set((r.x1 - r.x0) / 2, (r.backZ - r.z0) / 2);
      floorMat = new THREE.MeshStandardMaterial({ map: t, roughness: floorStyle.pattern === 'wood' ? 0.6 : 0.25, metalness: 0.05 });
    }
    const salesFloor = plane(this.group, r.x1 - r.x0, r.backZ - r.z0, floorMat);
    salesFloor.rotation.x = -Math.PI / 2;
    salesFloor.position.set((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.backZ) / 2);
    salesFloor.receiveShadow = true;
    const backFloor = plane(this.group, r.x1 - r.x0, r.z1 - r.backZ, mat(0x9a9a96, { rough: 0.8 }));
    backFloor.rotation.x = -Math.PI / 2;
    backFloor.position.set((r.x0 + r.x1) / 2, 0.02, (r.backZ + r.z1) / 2);
    backFloor.receiveShadow = true;
    n.fillRect(r.x0, r.z0, r.x1, r.backZ, 1, F_INTERIOR, 'set');
    n.fillRect(r.x0, r.backZ, r.x1, r.z1, 1, F_INTERIOR | F_STAFF, 'set');

    // ---------------- Murs latéraux et arrière
    const outerWall = (x0: number, z0: number, x1: number, z1: number) => {
      this.wallBox(x0, z0, x1, z1, 0, WALL_H, outer);
      n.fillRect(x0, z0, x1, z1, 0, 0, 'set');
    };
    outerWall(r.x0 - T, -T, r.x0, r.z1 + T);
    outerWall(r.x1, -T, r.x1 + T, r.z1 + T);
    // mur arrière avec porte de quai
    const dw = 1.4;
    outerWall(r.x0, r.z1, r.dockDoorX - dw, r.z1 + T);
    outerWall(r.dockDoorX + dw, r.z1, r.x1, r.z1 + T);
    this.wallBox(r.dockDoorX - dw, r.z1, r.dockDoorX + dw, r.z1 + T, 3.0, WALL_H, outer, false);
    n.fillRect(r.dockDoorX - dw, r.z1 - 0.2, r.dockDoorX + dw, r.z1 + T + 0.6, 1, F_STAFF | F_DOOR | F_DOCK | F_INTERIOR, 'set');
    const sh = new THREE.Mesh(new THREE.BoxGeometry(dw * 2, 3.0, 0.08), mat(0xa4b0be, { rough: 0.5, metal: 0.6 }));
    (sh.geometry as any).__own = true;
    sh.geometry.translate(0, -1.5, 0);
    sh.position.set(r.dockDoorX, 3.0, r.z1 + T / 2);
    sh.castShadow = true;
    this.group.add(sh);
    this.dockShutter = sh;
    // quai : butoirs + marquage
    box(this.group, dw * 2 + 1, 0.15, 3, r.dockDoorX, 0, r.z1 + T + 1.5, mat(0xf1c40f, { rough: 0.8 }), false, true);
    // parements intérieurs (couleur de mur choisie)
    const innerWall = (x0: number, z0: number, x1: number, z1: number) => this.wallBox(x0, z0, x1, z1, 0, WALL_H - 0.01, inner, false);
    innerWall(r.x0 - 0.002, 0, r.x0 + 0.01, r.backZ);
    innerWall(r.x1 - 0.01, 0, r.x1 + 0.002, r.backZ);
    // bandeau de couleur d'accent à 2,6 m
    box(this.group, 0.02, 0.25, r.backZ, r.x0 + 0.015, 2.6, r.backZ / 2, mat(wallStyle.accent), false, false);
    box(this.group, 0.02, 0.25, r.backZ, r.x1 - 0.015, 2.6, r.backZ / 2, mat(wallStyle.accent), false, false);

    // ---------------- Cloison réserve + porte du personnel
    const pw = 0.75;
    const partZ0 = r.backZ;
    const partZ1 = r.backZ + 0.18;
    this.wallBox(r.x0, partZ0, r.staffDoorX - pw, partZ1, 0, WALL_H, inner);
    this.wallBox(r.staffDoorX + pw, partZ0, r.x1, partZ1, 0, WALL_H, inner);
    this.wallBox(r.staffDoorX - pw, partZ0, r.staffDoorX + pw, partZ1, 2.2, WALL_H, inner, false);
    n.fillRect(r.x0, partZ0 + 0.001, r.x1, partZ1, 0, 0, 'set');
    n.fillRect(r.staffDoorX - pw, partZ0 - 0.4, r.staffDoorX + pw, partZ1 + 0.4, 1, F_STAFF | F_INTERIOR, 'set');
    const pivot = new THREE.Group();
    pivot.position.set(r.staffDoorX - pw, 0, partZ0 + 0.09);
    const leaf = box(pivot, pw * 2 - 0.05, 2.15, 0.05, pw - 0.02, 0, 0, mat(0x95a5a6, { rough: 0.5, metal: 0.4 }));
    leaf.castShadow = true;
    this.group.add(pivot);
    this.staffDoor = pivot;
    const priv = signTexture('PRIVÉ — PERSONNEL', 0xc0392b, 0xffffff, 256, 48);
    if (priv) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.17), new THREE.MeshStandardMaterial({ map: priv }));
      s.position.set(r.staffDoorX, 2.45, partZ0 - 0.01);
      s.rotation.y = Math.PI;
      this.group.add(s);
    }

    // ---------------- Façade
    const nSeg = st.store.facade.length;
    for (let i = 0; i < nSeg; i++) {
      const t = st.store.facade[i];
      const x0 = r.x0 + i * FACADE_SEG;
      const x1 = x0 + FACADE_SEG;
      const xc = (x0 + x1) / 2;
      if (t === 'mur') {
        this.wallBox(x0, -T, x1, 0, 0, WALL_H, facadeMat);
        n.fillRect(x0, -T, x1, 0, 0, 0, 'set');
        innerWall(x0, -0.002, x1, 0.01);
      } else if (t === 'vitrine') {
        this.wallBox(x0, -T, x1, 0, 0, 0.5, facadeMat);
        this.wallBox(x0, -T, x1, 0, 2.9, WALL_H, facadeMat);
        const g = new THREE.Mesh(new THREE.BoxGeometry(FACADE_SEG - 0.08, 2.4, 0.04), glassMat());
        (g.geometry as any).__own = true;
        g.position.set(xc, 1.7, -T / 2);
        this.group.add(g);
        this.colliders.push(this.physics.addStaticBox(xc, 1.7, -T / 2, FACADE_SEG / 2, 1.2, T / 2));
        box(this.group, 0.06, 2.4, 0.08, x0 + 0.03, 0.5, -T / 2, metalMat(0x2d3436), false);
        n.fillRect(x0, -T, x1, 0, 0, 0, 'set');
      } else {
        // porte coulissante automatique
        this.wallBox(x0, -T, x1, 0, 2.6, WALL_H, facadeMat);
        const left = new THREE.Group();
        const right = new THREE.Group();
        const panel = (grp: THREE.Group) => {
          const p = new THREE.Mesh(new THREE.BoxGeometry(FACADE_SEG / 2, 2.55, 0.04), glassMat());
          (p.geometry as any).__own = true;
          p.position.y = 1.3;
          grp.add(p);
          box(grp, FACADE_SEG / 2, 0.06, 0.06, 0, 2.52, 0, metalMat(0x2d3436), false);
          box(grp, 0.05, 2.55, 0.06, 0, 0, 0, metalMat(0x2d3436), false);
        };
        panel(left);
        panel(right);
        left.position.set(xc - FACADE_SEG / 4, 0, -T / 2);
        right.position.set(xc + FACADE_SEG / 4, 0, -T / 2);
        this.group.add(left, right);
        this.doors.push({ x: xc, left, right, open: 0 });
        n.fillRect(x0 + 0.05, -T - 0.4, x1 - 0.05, 0.4, 1, F_DOOR | F_INTERIOR, 'set');
        // tapis-brosse + auvent
        const mat2 = plane(this.group, FACADE_SEG, 1.2, mat(0x3d3d3d, { rough: 1 }));
        mat2.rotation.x = -Math.PI / 2;
        mat2.position.set(xc, 0.025, 0.7);
        box(this.group, FACADE_SEG + 0.6, 0.12, 1.4, xc, 2.75, -0.95, mat(st.store.signFg === 0xffffff ? 0x2d3436 : st.store.signFg));
      }
      // rideau métallique (fermeture nocturne) pour vitrines et portes
      if (t !== 'mur') {
        const shm = new THREE.Mesh(new THREE.BoxGeometry(FACADE_SEG, 2.9, 0.05), mat(0x8395a7, { rough: 0.45, metal: 0.7, key: 'shutter' }));
        (shm.geometry as any).__own = true;
        shm.geometry.translate(0, -1.45, 0);
        shm.position.set(xc, 2.9, -T - 0.06);
        shm.scale.y = 0.001;
        this.group.add(shm);
        this.shutters.push(shm);
      }
    }
    // ---------------- Enseigne
    this.buildSign(st, r);

    // ---------------- Plafond, toit, éclairage
    const ceil = plane(this.group, r.x1 - r.x0, r.z1 - r.z0, mat(0xf2f2f2, { rough: 0.9, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set((r.x0 + r.x1) / 2, WALL_H, (r.z0 + r.z1) / 2);
    const roof = box(this.group, r.x1 - r.x0 + 2 * T + 0.3, 0.3, r.z1 - r.z0 + 2 * T + 0.3, (r.x0 + r.x1) / 2, WALL_H, (r.z0 + r.z1) / 2, mat(0x4a4f55, { rough: 0.9 }));
    roof.castShadow = true;
    for (let k = 0; k < 2 + st.store.stage; k++) box(this.group, 1.6, 0.9, 1.2, r.x0 + 3 + k * 5, WALL_H + 0.3, r.z1 - 3, mat(0xb2bec3, { rough: 0.5, metal: 0.5 }));
    const lc = st.store.lightColor;
    const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: lc, emissiveIntensity: 1.1 * st.store.lightLevel });
    this.lightPanels.push(panelMat);
    for (let x = r.x0 + 2; x < r.x1 - 1; x += 3)
      for (let z = 1.5; z < r.z1 - 0.5; z += 3) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), panelMat);
        (p.geometry as any).__own = true;
        p.rotation.x = Math.PI / 2;
        p.position.set(x, WALL_H - 0.01, z);
        this.group.add(p);
      }
    const nl = Math.min(6, Math.max(2, Math.round(((r.x1 - r.x0) * (r.z1 - r.z0)) / 70)));
    const cols = Math.ceil(Math.sqrt(nl * ((r.x1 - r.x0) / (r.z1 - r.z0))));
    const rows = Math.ceil(nl / cols);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        if (this.lights.length >= nl) break;
        const L = new THREE.PointLight(lc, 0, 0, 1.6);
        L.position.set(r.x0 + ((i + 0.5) * (r.x1 - r.x0)) / cols, WALL_H - 0.4, ((j + 0.5) * r.z1) / rows);
        this.group.add(L);
        this.lights.push(L);
      }
    this.setLightLevel(st.store.lightLevel);

    // ---------------- Éclairage extérieur (amélioration)
    if (st.store.upgrades['eclairage_ext']) {
      for (const [x, z] of [[r.x0 - 1, -8], [r.x1 - 2, -8], [r.dockDoorX, r.z1 + 4]]) {
        const pole = box(this.group, 0.12, 5, 0.12, x, 0, z, metalMat(0x2d3436));
        pole.castShadow = false;
        const head = box(this.group, 0.5, 0.15, 0.3, x, 5, z, mat(0xffffff, { emissive: 0xfff3d6, emissiveIntensity: 1.5 }));
        head.castShadow = false;
        const L = new THREE.PointLight(0xfff3d6, 0, 22, 1.4);
        L.position.set(x, 4.8, z);
        this.group.add(L);
        this.extLights.push(L);
      }
    }

    // ---------------- Parcelles, garage, chantier
    this.buildPlots(st);
    if (st.store.construction) this.buildConstruction(st, r);
    const skip = new Set<THREE.Object3D>([...this.shutters, ...this.doors.flatMap((d) => [d.left, d.right])]);
    if (this.dockShutter) skip.add(this.dockShutter);
    if (this.staffDoor) skip.add(this.staffDoor);
    // les éléments en hauteur restent séparés (masqués en vue de construction)
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.position.y >= WALL_H - 1.2) skip.add(o);
    });
    mergeStatic(this.group, skip);
  }

  private buildSign(st: GameState, r: StoreRect) {
    const w = r.x1 - r.x0 + 0.5;
    const band = box(this.group, w, 1.1, 0.35, (r.x0 + r.x1) / 2, WALL_H - 1.1, -0.42, mat(st.store.signBg, { rough: 0.5 }));
    band.castShadow = true;
    if (!hasDom()) return;
    const c = document.createElement('canvas');
    c.width = 2048;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = css(st.store.signBg);
    x.fillRect(0, 0, 2048, 128);
    const logo = logoCanvas(st.store.logo, 128);
    const nameW = Math.min(1500, 2048 - 400);
    x.font = '96px "Luckiest Guy", Impact, sans-serif';
    x.textAlign = 'left';
    x.textBaseline = 'middle';
    const name = st.store.name.toUpperCase();
    let size = 96;
    while (x.measureText(name).width > nameW && size > 30) {
      size -= 4;
      x.font = `${size}px "Luckiest Guy", Impact, sans-serif`;
    }
    const tw = x.measureText(name).width;
    const total = tw + 150;
    const start = (2048 - total) / 2;
    if (logo) x.drawImage(logo, start, 0, 128, 128);
    x.fillStyle = 'rgba(0,0,0,0.35)';
    x.fillText(name, start + 154, 70);
    x.fillStyle = css(st.store.signFg);
    x.fillText(name, start + 150, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
    const aspect = 2048 / 128;
    const h = Math.min(1.0, w / aspect);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), this.signMat);
    (p.geometry as any).__own = true;
    p.position.set((r.x0 + r.x1) / 2, WALL_H - 0.55, -0.61);
    // la face visible regarde vers -z (la rue)
    p.rotation.y = Math.PI;
    this.group.add(p);
    // totem au bord de la route
    const totX = 14;
    const totZ = -12.6;
    box(this.group, 0.3, 4.2, 0.3, totX, 0, totZ, metalMat(0x2d3436));
    box(this.group, 1.9, 2.1, 0.25, totX, 4.2, totZ, mat(st.store.signBg));
    const lc2 = logoCanvas(st.store.logo, 256);
    if (lc2) {
      const t2 = new THREE.CanvasTexture(lc2);
      t2.colorSpace = THREE.SRGBColorSpace;
      for (const side of [-1, 1]) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshStandardMaterial({ map: t2, transparent: true, emissive: 0xffffff, emissiveMap: t2, emissiveIntensity: 0.2 }));
        (q.geometry as any).__own = true;
        q.position.set(totX, 5.25, totZ + side * 0.13);
        if (side < 0) q.rotation.y = Math.PI;
        this.group.add(q);
      }
    }
    this.colliders.push(this.physics.addStaticBox(totX, 2.1, totZ, 0.15, 2.1, 0.15));
  }

  private buildParking(st: GameState) {
    const line = mat(0xf5f6fa, { rough: 0.8, key: 'parkline' });
    const spotsX: number[] = [];
    for (let x = -10.75; x < 15; x += 2.5) {
      if (x > -4.5 && x < 2.5) continue; // allée piétonne vers l'entrée
      spotsX.push(x);
    }
    if (st.store.ownedLand.includes('parking')) for (let x = 17.25; x < 34; x += 2.5) spotsX.push(x);
    for (const x of spotsX) {
      this.parkingSpots.push({ x, z: -10.4, ry: Math.PI, taken: false });
      const l = plane(this.group, 0.1, 5, line);
      l.rotation.x = -Math.PI / 2;
      l.position.set(x - 1.25, 0.02, -10.4);
    }
    // passage piéton peint vers l'entrée
    for (let k = 0; k < 6; k++) {
      const s = plane(this.group, 3, 0.4, mat(0xf5f6fa, { rough: 0.8, key: 'parkline' }));
      s.rotation.x = -Math.PI / 2;
      s.position.set(-1, 0.021, -12.6 + k * 0.8);
    }
    // bordures et jardinières
    for (const x of [-11.5, 15.5]) {
      box(this.group, 0.8, 0.5, 0.8, x, 0, -1.2, mat(0x7f8c8d));
      const tree = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), mat(0x3c8d2f, { flat: true }));
      (tree.geometry as any).__own = true;
      tree.position.set(x, 1.0, -1.2);
      tree.castShadow = true;
      this.group.add(tree);
      this.colliders.push(this.physics.addStaticBox(x, 0.25, -1.2, 0.4, 0.25, 0.4));
      this.nav.fillRect(x - 0.4, -1.6, x + 0.4, -0.8, 0, 0, 'set');
    }
    // abri à caddies
    box(this.group, 3, 0.08, 1.4, 9.5, 2.2, -2.6, mat(0xdfe6e9, { transparent: true, opacity: 0.6 }));
    for (const [x, z] of [[8.1, -3.2], [10.9, -3.2], [8.1, -2], [10.9, -2]]) box(this.group, 0.06, 2.2, 0.06, x, 0, z, metalMat());
  }

  private buildPlots(st: GameState) {
    const fence = mat(0x95a5a6, { rough: 0.5, metal: 0.6, transparent: true, opacity: 0.55, key: 'fence' });
    const stage = st.store.stage;
    const curR = storeRect(stage);
    for (const land of LANDS) {
      const owned = st.store.ownedLand.includes(land.id);
      const [x0, z0, x1, z1] = land.rect;
      const covered = x0 >= curR.x0 && x1 <= curR.x1 && z1 <= curR.z1 && z0 >= curR.z0;
      if (covered) continue;
      if (owned) {
        if (land.id !== 'parking') {
          const slab = plane(this.group, x1 - x0, z1 - z0, mat(0xa4a4a0, { rough: 0.9 }));
          slab.rotation.x = -Math.PI / 2;
          slab.position.set((x0 + x1) / 2, 0.025, (z0 + z1) / 2);
          this.nav.fillRect(x0, z0, x1, z1, 2, 0, 'set');
        }
        continue;
      }
      if (land.id === 'est2') {
        // ancien garage abandonné
        const g = box(this.group, x1 - x0 - 2, 5.5, z1 - z0 - 2, (x0 + x1) / 2, 0, (z0 + z1) / 2, mat(0x9e9a92, { rough: 0.95 }));
        g.castShadow = true;
        this.colliders.push(this.physics.addStaticBox((x0 + x1) / 2, 2.75, (z0 + z1) / 2, (x1 - x0 - 2) / 2, 2.75, (z1 - z0 - 2) / 2));
        this.nav.fillRect(x0 + 1, z0 + 1, x1 - 1, z1 - 1, 0, 0, 'set');
        const s = signTexture('GARAGE DU ROND-POINT — FERMÉ', 0x2d3436, 0xe17055, 512, 64);
        if (s) {
          const p = new THREE.Mesh(new THREE.PlaneGeometry(8, 1), new THREE.MeshStandardMaterial({ map: s }));
          (p.geometry as any).__own = true;
          p.position.set((x0 + x1) / 2, 4.2, z0 + 0.98);
          p.rotation.y = Math.PI;
          this.group.add(p);
        }
        box(this.group, 4, 3.2, 0.1, (x0 + x1) / 2, 0, z0 + 0.95, mat(0x7f6f5f, { rough: 0.7, metal: 0.5 }));
      } else {
        for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x0, z1, x1, z1], [x0, z0, x0, z1]] as const) {
          const len = Math.hypot(bx - ax, bz - az);
          const f = new THREE.Mesh(new THREE.BoxGeometry(ax === bx ? 0.05 : len, 1.8, az === bz ? 0.05 : len), fence);
          (f.geometry as any).__own = true;
          f.position.set((ax + bx) / 2, 0.9, (az + bz) / 2);
          this.group.add(f);
        }
        this.nav.fillRect(x0, z0, x1, z1, 0, 0, 'set');
        for (let k = 0; k < 14; k++) {
          const weed = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 5), mat(0x7a8f3a, { flat: true }));
          (weed.geometry as any).__own = true;
          weed.position.set(x0 + 0.5 + ((k * 37) % 100) / 100 * (x1 - x0 - 1), 0.3, z0 + 0.5 + ((k * 61) % 100) / 100 * (z1 - z0 - 1));
          this.group.add(weed);
        }
        const s = signTexture(`À VENDRE — ${land.price.toLocaleString('fr-FR')} €`, 0xffffff, 0xc0392b, 512, 128);
        if (s) {
          const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: s, side: THREE.DoubleSide }));
          (p.geometry as any).__own = true;
          p.position.set((x0 + x1) / 2, 1.5, z0 - 0.05);
          this.group.add(p);
        }
      }
    }
  }

  private buildConstruction(st: GameState, cur: StoreRect) {
    const target = storeRect(st.store.construction!.toStage);
    const stripes = mat(0xff7f00, { rough: 0.7 });
    const white = mat(0xffffff, { rough: 0.7 });
    const zones: [number, number, number, number][] = [];
    if (target.x1 > cur.x1) zones.push([cur.x1 + 0.3, 0, target.x1, target.z1]);
    if (target.z1 > cur.z1) zones.push([target.x0, cur.z1 + 0.3, Math.min(cur.x1, target.x1), target.z1]);
    for (const [x0, z0, x1, z1] of zones) {
      this.nav.fillRect(x0, z0, x1, z1, 0, 0, 'set');
      for (let x = x0; x < x1; x += 2) {
        box(this.group, 1.9, 1.0, 0.1, x + 1, 0, z0 - 0.1, (Math.round(x / 2) % 2 ? stripes : white));
      }
      for (let z = z0; z < z1; z += 2) box(this.group, 0.1, 1.0, 1.9, x1 + 0.1, 0, z + 1, (Math.round(z / 2) % 2 ? stripes : white));
      // échafaudage
      for (let x = x0 + 1; x < x1; x += 3)
        for (let z = z0 + 1; z < z1; z += 4) box(this.group, 0.08, 6, 0.08, x, 0, z, metalMat(0xf39c12));
      const slab = plane(this.group, x1 - x0, z1 - z0, mat(0x8c7b6b, { rough: 1 }));
      slab.rotation.x = -Math.PI / 2;
      slab.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
    }
    const s = signTexture(`TRAVAUX — ${STAGES[st.store.construction!.toStage].name.toUpperCase()}`, 0xf1c40f, 0x2d3436, 512, 128);
    if (s && zones.length) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: s, side: THREE.DoubleSide }));
      (p.geometry as any).__own = true;
      p.position.set(zones[0][0] + 2, 1.6, zones[0][1] - 0.3);
      this.group.add(p);
    }
  }

  setLightLevel(level: number) {
    for (const L of this.lights) L.intensity = this.power ? 26 * level : 0;
    for (const m of this.lightPanels) m.emissiveIntensity = this.power ? 1.1 * level : 0;
  }

  setPower(on: boolean, level: number) {
    this.power = on;
    this.setLightLevel(level);
    if (this.signMat) this.signMat.emissiveIntensity = on ? 0.25 : 0;
  }

  /** Animation : portes automatiques, rideaux, quai, éclairage extérieur. */
  update(dt: number, people: { x: number; z: number }[], storeOpen: boolean, night: boolean, dockActive: boolean) {
    for (const d of this.doors) {
      let want = 0;
      if (storeOpen || !night)
        for (const p of people) {
          if (Math.abs(p.x - d.x) < 1.8 && p.z > -3.2 && p.z < 2.4) {
            want = 1;
            break;
          }
        }
      if (!storeOpen && night) want = 0;
      d.open += (want - d.open) * Math.min(1, dt * 6);
      const o = d.open * (FACADE_SEG / 2 - 0.05);
      d.left.position.x = d.x - FACADE_SEG / 4 - o;
      d.right.position.x = d.x + FACADE_SEG / 4 + o;
    }
    const shutterTarget = !storeOpen && night ? 1 : 0;
    this.shutterLevel += (shutterTarget - this.shutterLevel) * Math.min(1, dt * 0.8);
    for (const s of this.shutters) s.scale.y = Math.max(0.001, this.shutterLevel);
    const r = this.rect;
    let staffWant = 0;
    for (const p of people) if (Math.abs(p.x - r.staffDoorX) < 1.2 && Math.abs(p.z - r.backZ) < 1.4) staffWant = 1;
    this.staffOpen += (staffWant - this.staffOpen) * Math.min(1, dt * 5);
    if (this.staffDoor) this.staffDoor.rotation.y = -this.staffOpen * 1.5;
    let dockWant = dockActive ? 1 : 0;
    for (const p of people) if (Math.abs(p.x - r.dockDoorX) < 2 && Math.abs(p.z - r.z1) < 2.5) dockWant = 1;
    this.dockOpen += (dockWant - this.dockOpen) * Math.min(1, dt * 1.5);
    if (this.dockShutter) this.dockShutter.scale.y = Math.max(0.05, 1 - this.dockOpen);
    for (const L of this.extLights) L.intensity = night ? 30 : 0;
  }

  get shuttersClosed() {
    return this.shutterLevel > 0.9;
  }
}
