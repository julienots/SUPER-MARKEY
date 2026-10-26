/**
 * Synchronise les équipements de l'état avec la scène : modèles, collisions, occupation de la navigation,
 * et surtout le rendu instancié des produits réellement présents en rayon (un modèle par unité en stock).
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CELL, EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { equipCenter, footprint, itemLayout, itemLocalPositions, rotAngle, slotLocal, GRID_X0, GRID_Z0 } from '../sim/layout';
import { slotQty } from '../sim/inventory';
import { promoLabel, shelfPrice } from '../sim/pricing';
import { dayOf, type GameState, type PlacedEquip } from '../sim/state';
import type { NavGrid } from '../sim/nav';
import type { Physics } from '../physics/physics';
import { buildEquipment, type EquipVisual, type EquipStyle } from './equipmentMeshes';
import { productGeometry, productMaterial } from './productMeshes';
import { cardboardTexture, priceTexture } from './textures';
import { decal } from './materials';
import { WALLS } from '../data/styles';

interface View {
  sig: string;
  visual: EquipVisual;
  colliders: RAPIER.Collider[];
  matrix: THREE.Matrix4;
}

const posCache = new Map<string, { x: number; y: number; z: number; ry: number }[]>();
function positions(defId: string, idx: number, pid: string) {
  const k = `${defId}:${idx}:${pid}`;
  let p = posCache.get(k);
  if (!p) posCache.set(k, (p = itemLocalPositions(EQUIPMENT_BY_ID[defId], idx, PRODUCT_BY_ID[pid])));
  return p;
}

export class EquipmentView {
  group = new THREE.Group();
  private views = new Map<number, View>();
  private items = new Map<string, THREE.InstancedMesh>();
  private tags = new Map<string, THREE.InstancedMesh>();
  private cartons: THREE.InstancedMesh | null = null;
  private dirty = true;
  private dirtyT = 0;
  private power = true;
  /** Nombre d'unités visibles (statistique de rendu). */
  visibleUnits = 0;

  constructor(private scene: THREE.Scene, private physics: Physics, private nav: NavGrid) {
    this.group.name = 'equipment';
    scene.add(this.group);
  }

  style(st: GameState): EquipStyle {
    const wall = WALLS.find((w) => w.id === st.store.wall) ?? WALLS[0];
    return { shelfColor: st.store.shelfColor, accent: st.store.signBg ?? wall.accent, uniform: st.store.uniform };
  }

  markDirty() {
    this.dirty = true;
  }

  setPower(on: boolean, st: GameState) {
    if (this.power === on) return;
    this.power = on;
    for (const v of this.views.values()) this.removeView(v);
    this.views.clear();
    this.sync(st, true);
  }

  private removeView(v: View) {
    this.group.remove(v.visual.root);
    for (const c of v.colliders) this.physics.removeCollider(c);
  }

  /** Réconcilie les modèles avec l'état (ajouts, suppressions, déplacements, pannes). */
  sync(st: GameState, force = false) {
    const style = this.style(st);
    const styleSig = `${style.shelfColor}:${style.accent}`;
    const seen = new Set<number>();
    let navChanged = false;
    for (const e of st.equipment) {
      seen.add(e.uid);
      const sig = `${e.def}:${e.gx}:${e.gz}:${e.rot}:${!!e.broken}:${e.open !== false}:${styleSig}`;
      const old = this.views.get(e.uid);
      if (old && old.sig === sig && !force) continue;
      if (old) this.removeView(old);
      const visual = buildEquipment(e, style, this.power);
      const c = equipCenter(e);
      const a = rotAngle(e.rot);
      visual.root.position.set(c.x, 0, c.z);
      visual.root.rotation.y = a;
      this.group.add(visual.root);
      const colliders: RAPIER.Collider[] = [];
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      for (const b of visual.colliders) {
        const wx = c.x + b.cx * cos + b.cz * sin;
        const wz = c.z - b.cx * sin + b.cz * cos;
        colliders.push(this.physics.addStaticBox(wx, b.cy, wz, b.hx, b.hy, b.hz, a, { kind: 'equip', ref: e.uid }));
      }
      const matrix = new THREE.Matrix4().makeRotationY(a).setPosition(c.x, 0, c.z);
      this.views.set(e.uid, { sig, visual, colliders, matrix });
      navChanged = true;
    }
    for (const [uid, v] of this.views) {
      if (!seen.has(uid)) {
        this.removeView(v);
        this.views.delete(uid);
        navChanged = true;
      }
    }
    if (navChanged || force) this.rebuildNavOcc(st);
    this.dirty = true;
  }

  rebuildNavOcc(st: GameState) {
    this.nav.clearOcc();
    for (const e of st.equipment) {
      const d = EQUIPMENT_BY_ID[e.def];
      if (d.mount !== 'floor' || d.passable) continue;
      const f = footprint(d, e.rot);
      const x0 = GRID_X0 + e.gx * CELL;
      const z0 = GRID_Z0 + e.gz * CELL;
      this.nav.setOccRect(x0 + 0.02, z0 + 0.02, x0 + f.w * CELL - 0.02, z0 + f.d * CELL - 0.02, 1);
    }
  }

  private ensureMesh(map: Map<string, THREE.InstancedMesh>, key: string, geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], need: number, shadows: boolean): THREE.InstancedMesh {
    let im = map.get(key);
    if (!im || im.instanceMatrix.count < need) {
      if (im) {
        this.group.remove(im);
        im.dispose();
      }
      const cap = Math.max(16, Math.ceil(need * 1.5));
      im = new THREE.InstancedMesh(geo, m, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = shadows;
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
      map.set(key, im);
    }
    return im;
  }

  /** Reconstruit les instances de produits, étiquettes de prix et cartons de réserve. */
  rebuildItems(st: GameState) {
    const perProduct = new Map<string, THREE.Matrix4[]>();
    const perTag = new Map<string, { m: THREE.Matrix4[]; price: number; promo: string | null; expiring: boolean }>();
    const cartonMats: { m: THREE.Matrix4; color: THREE.Color }[] = [];
    const tmp = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const day = dayOf(st.time);
    let units = 0;
    for (const e of st.equipment) {
      const v = this.views.get(e.uid);
      if (!v) continue;
      const def = EQUIPMENT_BY_ID[e.def];
      if (e.slots && def.shelf) {
        e.slots.forEach((s, idx) => {
          if (!s.pid) return;
          const qty = slotQty(s);
          const pos = positions(def.id, idx, s.pid);
          const arr = perProduct.get(s.pid) ?? [];
          const n = Math.min(qty, pos.length);
          for (let i = 0; i < n; i++) {
            // ordre de remplissage : couche du bas d'abord, du fond vers l'avant
            // (la pyramide se vide donc par le haut, les rayons par l'avant, comme en vrai)
            const p = pos[i];
            const jitter = ((idx * 31 + i * 17) % 10) / 400;
            q.setFromAxisAngle(yAxis, p.ry + jitter);
            tmp.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
            arr.push(v.matrix.clone().multiply(tmp));
          }
          units += n;
          perProduct.set(s.pid, arr);
          // étiquette de prix sur le rail avant
          const l = slotLocal(def, idx);
          const price = shelfPrice(st, s.pid);
          const promo = promoLabel(st, s.pid);
          const expiring = s.lots.some((lt) => lt.exp >= 0 && lt.exp - day <= 1);
          const key = `${price.toFixed(2)}:${promo}:${expiring}`;
          const t = perTag.get(key) ?? { m: [], price, promo, expiring };
          const ty = def.shelf!.pile ? 0.25 : l.y - 0.035;
          q.setFromAxisAngle(yAxis, l.dir > 0 ? 0 : Math.PI);
          tmp.compose(new THREE.Vector3(l.lx, ty, l.frontZ + l.dir * 0.012), q, new THREE.Vector3(1, 1, 1));
          t.m.push(v.matrix.clone().multiply(tmp));
          perTag.set(key, t);
        });
      }
      if (e.cartons && e.def === 'rack_reserve') {
        e.cartons.forEach((c, i) => {
          const level = Math.floor(i / 8);
          const k = i % 8;
          const lx = -0.75 + (k % 4) * 0.5;
          const lz = k < 4 ? 0.2 : -0.2;
          const ly = [0.14, 0.89, 1.64][level] ?? 1.64;
          tmp.makeTranslation(lx, ly + 0.17, lz);
          const p = PRODUCT_BY_ID[c.pid];
          cartonMats.push({ m: v.matrix.clone().multiply(tmp), color: new THREE.Color(0xffffff).lerp(new THREE.Color(p.color2), 0.25) });
        });
      }
    }
    // produits
    for (const [pid, im] of this.items) if (!perProduct.has(pid)) im.count = 0;
    for (const [pid, mats] of perProduct) {
      const p = PRODUCT_BY_ID[pid];
      const im = this.ensureMesh(this.items, pid, productGeometry(p), productMaterial(p), mats.length, mats.length < 400);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.count = mats.length;
      im.instanceMatrix.needsUpdate = true;
    }
    // étiquettes
    for (const [, im] of this.tags) im.count = 0;
    for (const [key, t] of perTag) {
      let im = this.tags.get(key);
      if (!im || im.instanceMatrix.count < t.m.length) {
        if (im) {
          this.group.remove(im);
          im.dispose();
        }
        const tex = priceTexture(t.price, t.promo, t.expiring);
        const material = decal(new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : t.promo ? 0xffd32a : 0xffffff, roughness: 0.6 }), 2);
        im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.055), material, Math.max(8, t.m.length * 2));
        im.frustumCulled = false;
        this.group.add(im);
        this.tags.set(key, im);
      }
      t.m.forEach((m, i) => im!.setMatrixAt(i, m));
      im.count = t.m.length;
      im.instanceMatrix.needsUpdate = true;
    }
    // cartons de réserve
    if (!this.cartons || this.cartons.instanceMatrix.count < cartonMats.length) {
      if (this.cartons) {
        this.group.remove(this.cartons);
        this.cartons.dispose();
      }
      const tex = cardboardTexture(null);
      this.cartons = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.34, 0.36), new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.9 }), Math.max(48, cartonMats.length * 2));
      this.cartons.castShadow = true;
      this.cartons.receiveShadow = true;
      this.cartons.frustumCulled = false;
      this.group.add(this.cartons);
    }
    cartonMats.forEach((c, i) => {
      this.cartons!.setMatrixAt(i, c.m);
      this.cartons!.setColorAt(i, c.color);
    });
    this.cartons.count = cartonMats.length;
    this.cartons.instanceMatrix.needsUpdate = true;
    if (this.cartons.instanceColor) this.cartons.instanceColor.needsUpdate = true;
    this.visibleUnits = units;
  }

  update(dt: number, t: number, st: GameState) {
    this.dirtyT -= dt;
    if (this.dirty && this.dirtyT <= 0) {
      this.rebuildItems(st);
      this.dirty = false;
      this.dirtyT = 0.15;
    }
    for (const v of this.views.values()) v.visual.animate?.(t);
  }

  viewOf(uid: number) {
    return this.views.get(uid);
  }

  /** Retrouve le facing visé à partir d'un point d'impact sur le meuble. */
  slotAt(e: PlacedEquip, wx: number, wy: number, wz: number): number {
    const def = EQUIPMENT_BY_ID[e.def];
    if (!def.shelf) return -1;
    const c = equipCenter(e);
    const a = -rotAngle(e.rot);
    const dx = wx - c.x;
    const dz = wz - c.z;
    const lx = dx * Math.cos(a) + dz * Math.sin(a);
    const lz = -dx * Math.sin(a) + dz * Math.cos(a);
    const sh = def.shelf;
    const W = def.w * CELL;
    const side = sh.sides === 2 && lz < 0 ? 1 : 0;
    let level = 0;
    for (let i = 0; i < sh.levels.length; i++) if (wy >= sh.levels[i] - 0.06) level = i;
    const fw = W / sh.facings;
    const u = side === 0 ? lx + W / 2 : W / 2 - lx;
    const facing = Math.max(0, Math.min(sh.facings - 1, Math.floor(u / fw)));
    return (side * sh.levels.length + level) * sh.facings + facing;
  }

  /** Position monde du facing (pour placer les produits tombés, etc.). */
  slotWorld(e: PlacedEquip, idx: number): THREE.Vector3 {
    const def = EQUIPMENT_BY_ID[e.def];
    const l = slotLocal(def, idx);
    const v = this.views.get(e.uid);
    const p = new THREE.Vector3(l.lx, l.y + 0.1, l.frontZ - l.dir * 0.1);
    if (v) p.applyMatrix4(v.matrix);
    return p;
  }

  capacityOf(e: PlacedEquip, idx: number, pid: string) {
    return itemLayout(EQUIPMENT_BY_ID[e.def], idx, PRODUCT_BY_ID[pid]).capacity;
  }
}
