/**
 * Affichage 3D du magasin vu de trois quarts (caméra orthographique) : bâtiment, rue et immeubles KayKit,
 * mobilier, produits en rayon, personnages animés, bulles et noms, aperçu de construction.
 * Ne modifie jamais la partie : il lit l'état (World + personnages) qu'il reçoit.
 */
import * as THREE from 'three';
import { FURN_BY_ID, STORE_SIZES, type FurnDef } from '../data/furniture';
import { PRODUCT_BY_ID } from '../data/products';
import { BACK_D, BDOOR_W, BDOOR_X, centerOf, cellsOf, DOCK, DOOR_W, DOOR_X, GX0, GX1, SIDEWALK_Z1 } from '../sim/grid';
import { levelCap, reserveCartons, ROAD_Z, OPEN_MIN, CLOSE_MIN } from '../sim/sim';
import type { AgentView, Furn, World } from '../sim/types';
import { equipModel, kitModel, kitSize, personModel } from './assets';
import { productGeometry, productMaterial } from './products';
import { Post } from './post';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const CITY_SCALE = 4.5;
const WALL_H = 3;
const LOW_H = 0.45;
const ANIM_CLIP: Record<string, string> = { idle: 'Idle', walk: 'Walk', interact: 'Interact', wave: 'Wave' };
const UI_EMOJI: Record<string, string> = { heart: '😍', ok: '🙂', sad: '😞' };

interface AgentObj {
  root: THREE.Object3D;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  cur: string;
  x: number;
  z: number;
  rot: number;
  tx: number;
  tz: number;
  trot: number;
  anim: string;
  box: THREE.Object3D | null;
  boxKind: string;
  ring: THREE.Mesh | null;
  tagEl: HTMLElement | null;
  bubbleEl: HTMLElement | null;
  bubble: string | null;
  kind: string;
  seen: boolean;
}

interface Car {
  obj: THREE.Object3D;
  x: number;
  dir: number;
  speed: number;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
  /** Point visé, zoom (mètres visibles en hauteur), quart de tour de la caméra. */
  cam = { x: 5, z: -4, size: 18, az: 0 };
  private hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a66, 1.2);
  private sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  private storeLight = new THREE.PointLight(0xfff1d6, 0, 40, 1.2);
  private shell = new THREE.Group();
  private city = new THREE.Group();
  private furnG = new THREE.Group();
  private agentsG = new THREE.Group();
  private fxG = new THREE.Group();
  private furnObjs = new Map<number, { g: THREE.Group; key: string }>();
  private prodMeshes = new Map<string, THREE.InstancedMesh>();
  private cartons: THREE.InstancedMesh;
  private agentObjs = new Map<number, AgentObj>();
  private cars: Car[] = [];
  private carT = 2;
  private shellKey = '';
  private stockRev = -1;
  private ground: THREE.Mesh;
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private selMesh: THREE.Mesh;
  private tapMark: THREE.Mesh;
  private tapT = 0;
  private floats: { el: HTMLElement; x: number; z: number; t: number }[] = [];
  private lampMats: THREE.MeshStandardMaterial[] = [];
  private basketMat = new THREE.MeshStandardMaterial({ color: 0xe0393e, roughness: 0.6 });
  private raycaster = new THREE.Raycaster();
  overlay: HTMLElement;
  shadows = true;
  private post: Post | null = null;
  private quality: 'basse' | 'normale' | 'haute' = 'normale';
  private dayF = 1;
  private duskF = 0;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, quality: 'basse' | 'normale' | 'haute') {
    this.overlay = overlay;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'basse', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    const s = this.scene;
    // reflets réalistes : éclairage d'environnement (métal, verre, carrelage brillant)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    s.environmentIntensity = 0.55;
    s.background = new THREE.Color(0x9fd4f5);
    s.add(this.hemi, this.sun, this.sun.target, this.storeLight, this.shell, this.city, this.furnG, this.agentsG, this.fxG);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;

    // herbe : texture avec variations de teinte et touffes
    const grass = canvasTex(
      256,
      256,
      (g) => {
        g.fillStyle = '#7fae5a';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 2600; i++) {
          const v = Math.random();
          g.fillStyle = v < 0.5 ? `rgba(60,110,40,${0.15 + Math.random() * 0.25})` : `rgba(170,200,110,${0.1 + Math.random() * 0.2})`;
          const x = Math.random() * 256;
          const y = Math.random() * 256;
          g.fillRect(x, y, 1 + Math.random() * 2, 2 + Math.random() * 4);
        }
        for (let i = 0; i < 14; i++) {
          g.fillStyle = `rgba(90,130,60,${0.12 + Math.random() * 0.1})`;
          g.beginPath();
          g.arc(Math.random() * 256, Math.random() * 256, 12 + Math.random() * 30, 0, Math.PI * 2);
          g.fill();
        }
      },
      [80, 80],
    );
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: grass, roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.ground.receiveShadow = true;
    s.add(this.ground);

    this.cartons = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.36, 0.42),
      new THREE.MeshStandardMaterial({
        map: canvasTex(64, 64, (g) => {
          g.fillStyle = '#c8955a';
          g.fillRect(0, 0, 64, 64);
          g.fillStyle = '#e6c08a';
          g.fillRect(28, 0, 8, 64);
          g.fillStyle = '#7a5532';
          g.font = 'bold 14px sans-serif';
          g.fillText('BAZAR', 10, 40);
        }),
        roughness: 0.9,
      }),
      400,
    );
    this.cartons.castShadow = true;
    this.cartons.count = 0;
    s.add(this.cartons);

    this.selMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.35, depthWrite: false }));
    this.selMesh.rotation.x = -Math.PI / 2;
    this.selMesh.visible = false;
    s.add(this.selMesh);
    this.tapMark = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
    this.tapMark.rotation.x = -Math.PI / 2;
    this.tapMark.visible = false;
    s.add(this.tapMark);
    this.setQuality(quality);
  }

  setQuality(q: 'basse' | 'normale' | 'haute') {
    this.quality = q;
    const cap = q === 'basse' ? 1 : q === 'normale' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
    this.shadows = q !== 'basse';
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = this.shadows;
    // ombres douces (bord flou) et plus fines en qualité Belle
    const ms = q === 'haute' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as any;
    }
    this.sun.shadow.radius = q === 'haute' ? 4 : 2.5;
    this.scene.environmentIntensity = q === 'basse' ? 0.35 : 0.55;
    this.post?.dispose();
    this.post = q === 'basse' ? null : new Post(this.renderer, this.scene, this.camera, q);
    const el = this.renderer.domElement;
    if (this.post && el.clientWidth) this.post.setSize(el.clientWidth, el.clientHeight, this.renderer.getPixelRatio());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => (x.needsUpdate = true));
    });
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.updateCamera();
  }

  /** Direction horizontale vers la caméra. */
  camDir() {
    const a = Math.PI / 4 + (this.cam.az * Math.PI) / 2;
    return { x: Math.sin(a), z: Math.cos(a) };
  }

  updateCamera() {
    const el = this.renderer.domElement;
    const aspect = (el.clientWidth || 1) / (el.clientHeight || 1);
    const half = this.cam.size / 2;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    const d = this.camDir();
    const elev = 0.62;
    const dist = 80;
    this.camera.position.set(this.cam.x + d.x * dist * Math.cos(elev), dist * Math.sin(elev), this.cam.z + d.z * dist * Math.cos(elev));
    this.camera.lookAt(this.cam.x, 0, this.cam.z);
  }

  // ------------------------------------------------------------------ bâtiment
  private buildShell(w: World) {
    const sz = STORE_SIZES[w.sizeIdx];
    const d = this.camDir();
    const key = `${w.sizeIdx}:${this.cam.az}`;
    if (key === this.shellKey) return;
    const cityChanged = !this.shellKey.startsWith(w.sizeIdx + ':');
    this.shellKey = key;
    this.shell.clear();
    const W = sz.w;
    const D = sz.d;
    // sol carrelé
    const floorTex = canvasTex(
      128,
      128,
      (g) => {
        for (let i = 0; i < 4; i++) {
          const x = (i % 2) * 64;
          const y = Math.floor(i / 2) * 64;
          const t = 232 + Math.floor(Math.random() * 10);
          g.fillStyle = `rgb(${t + 6},${t + 2},${t - 8})`;
          g.fillRect(x, y, 64, 64);
          // marbrure légère
          for (let k = 0; k < 40; k++) {
            g.fillStyle = `rgba(150,140,120,${Math.random() * 0.05})`;
            g.fillRect(x + Math.random() * 64, y + Math.random() * 64, 2 + Math.random() * 8, 1 + Math.random() * 3);
          }
        }
        g.strokeStyle = 'rgba(110,100,85,0.45)';
        g.lineWidth = 2;
        for (const v of [0, 64, 128]) {
          g.beginPath();
          g.moveTo(v, 0);
          g.lineTo(v, 128);
          g.moveTo(0, v);
          g.lineTo(128, v);
          g.stroke();
        }
      },
      [W / 2, D / 2],
    );
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.28, metalness: 0.0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(W / 2, 0.005, -D / 2);
    floor.receiveShadow = true;
    this.shell.add(floor);
    // murs
    const inner = new THREE.MeshStandardMaterial({ color: 0xfbf4e6, roughness: 0.85 });
    const outer = new THREE.MeshStandardMaterial({ color: 0xd8714a, roughness: 0.9 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xff7a2f, roughness: 0.6 });
    const top = new THREE.MeshStandardMaterial({ color: 0x5b4a3f, roughness: 0.8 });
    const T = 0.2;
    const wall = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number) => {
      const near = nx * d.x + nz * d.z > 0.05;
      const h = near ? LOW_H : WALL_H;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(len + (nz ? T * 2 : 0), h, T);
      const mats = [outer, outer, top, top, nz > 0 || nx > 0 ? outer : inner, nz > 0 || nx > 0 ? inner : outer];
      const m = new THREE.Mesh(g, mats);
      m.position.set((x0 + x1) / 2 + (nx * T) / 2, h / 2, (z0 + z1) / 2 + (nz * T) / 2);
      if (nx) m.rotation.y = Math.PI / 2;
      m.castShadow = !near;
      m.receiveShadow = true;
      this.shell.add(m);
      if (!near) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 0.02), stripe);
        s.position.set((x0 + x1) / 2 - nx * 0.01, 2.45, (z0 + z1) / 2 - nz * 0.01);
        if (nx) s.rotation.y = Math.PI / 2;
        this.shell.add(s);
      }
    };
    const B = D + BACK_D;
    wall(0, -B, W, -B, 0, -1);
    wall(0, -B, 0, 0, -1, 0);
    wall(W, -B, W, 0, 1, 0);
    // réserve : sol béton, cloison avec porte, inscription au sol
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(W, BACK_D),
      new THREE.MeshStandardMaterial({
        map: canvasTex(512, 128, (g) => {
          g.fillStyle = '#b9b6ae';
          g.fillRect(0, 0, 512, 128);
          for (let i = 0; i < 900; i++) {
            g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
            g.fillRect(Math.random() * 512, Math.random() * 128, 3, 3);
          }
          g.fillStyle = 'rgba(255,214,0,0.85)';
          g.font = 'bold 54px sans-serif';
          g.textAlign = 'center';
          g.fillText('RÉSERVE', 300, 84);
        }),
        roughness: 0.9,
      }),
    );
    back.rotation.x = -Math.PI / 2;
    back.position.set(W / 2, 0.006, -D - BACK_D / 2);
    back.receiveShadow = true;
    this.shell.add(back);
    const part = new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.8 });
    const PH = 1.5;
    for (const [x0, x1] of [
      [0, BDOOR_X],
      [BDOOR_X + BDOOR_W, W],
    ]) {
      if (x1 <= x0) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, PH, 0.14), [part, part, top, top, part, part]);
      m.position.set((x0 + x1) / 2, PH / 2, -D);
      m.castShadow = true;
      m.receiveShadow = true;
      this.shell.add(m);
    }
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.7 });
    for (const x of [BDOOR_X, BDOOR_X + BDOOR_W]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.22), doorMat);
      p.position.set(x, 1.15, -D);
      this.shell.add(p);
    }
    const signTex = canvasTex(256, 64, (g) => {
      g.fillStyle = '#ffd400';
      g.fillRect(0, 0, 256, 64);
      g.fillStyle = '#3a2400';
      g.font = 'bold 40px sans-serif';
      g.textAlign = 'center';
      g.fillText('RÉSERVE', 128, 46);
    });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(BDOOR_W + 0.3, 0.5, 0.08), [doorMat, doorMat, doorMat, doorMat, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }), doorMat]);
    sign.position.set(BDOOR_X + BDOOR_W / 2, 2.55, -D + 0.02);
    this.shell.add(sign);
    wall(0, 0, DOOR_X, 0, 0, 1);
    wall(DOOR_X + DOOR_W, 0, W, 0, 0, 1);
    // linteau et montants de porte
    const frontNear = d.z > 0.05;
    const frame = new THREE.MeshStandardMaterial({ color: 0x3b3f46, roughness: 0.5, metalness: 0.4 });
    for (const x of [DOOR_X, DOOR_X + DOOR_W]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, frontNear ? 0.8 : WALL_H, 0.25), frame);
      p.position.set(x, frontNear ? 0.4 : WALL_H / 2, 0.1);
      this.shell.add(p);
    }
    // paillasson
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, 1.2), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 1 }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(DOOR_X + DOOR_W / 2, 0.012, 0.6);
    this.shell.add(mat);
    // trottoir
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(GX1 - GX0 + 60, 0.12, SIDEWALK_Z1),
      new THREE.MeshStandardMaterial({
        map: canvasTex(64, 64, (g) => {
          g.fillStyle = '#c9c6c0';
          g.fillRect(0, 0, 64, 64);
          g.strokeStyle = '#b3afa8';
          g.lineWidth = 2;
          g.strokeRect(0, 0, 64, 64);
        }, [(GX1 - GX0 + 60) / 1.5, SIDEWALK_Z1 / 1.5]),
        roughness: 0.95,
      }),
    );
    side.position.set((GX0 + GX1) / 2, -0.05, SIDEWALK_Z1 / 2);
    side.receiveShadow = true;
    this.shell.add(side);
    // totem avec le logo
    const logo = new THREE.TextureLoader().load('./brand/bazar-bazar-logo.png');
    logo.colorSpace = THREE.SRGBColorSpace;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 10), frame);
    pole.position.set(1.2, 1.6, 1.2);
    this.shell.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.9, 0.12), [frame, frame, frame, frame, new THREE.MeshStandardMaterial({ map: logo, roughness: 0.5, emissive: 0xffffff, emissiveMap: logo, emissiveIntensity: 0.15 }), frame]);
    board.position.set(1.2, 3.6, 1.2);
    board.rotation.y = Math.PI / 4 + (this.cam.az * Math.PI) / 2;
    board.castShadow = true;
    this.shell.add(board);
    if (cityChanged) this.buildCity(W);
    this.storeLight.position.set(W / 2, 4, -(D + BACK_D) / 2);
    this.storeLight.distance = Math.max(W, D) * 1.6;
  }

  private buildCity(W: number) {
    this.city.clear();
    this.lampMats = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const put = (name: string, x: number, z: number, ry = 0, s = CITY_SCALE) => {
      const o = kitModel('city', name);
      if (!o) return null;
      o.position.set(x, 0, z);
      o.rotation.y = ry;
      o.scale.setScalar(s);
      this.city.add(o);
      return o;
    };
    // route : tuiles de 9 m le long de x
    const tile = 2 * CITY_SCALE;
    const rz = SIDEWALK_Z1 + tile / 2;
    for (let x = -54; x < 80; x += tile) {
      const crossing = Math.abs(x + tile / 2 - (DOOR_X + 1)) < tile / 2;
      put(crossing ? 'road_straight_crossing' : 'road_straight', x + tile / 2, rz, Math.PI / 2);
    }
    // trottoir d'en face et immeubles
    const far = new THREE.Mesh(new THREE.BoxGeometry(140, 0.12, 4), new THREE.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.95 }));
    far.position.set(13, -0.05, SIDEWALK_Z1 + tile + 2);
    far.receiveShadow = true;
    this.city.add(far);
    const builds = ['building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G', 'building_H'];
    for (let x = -50; x < 76; x += 9.4) put(builds[Math.floor(rnd() * builds.length)] + '_withoutBase', x, SIDEWALK_Z1 + tile + 4 + 4.6, Math.PI);
    // voisins de gauche et de droite (derrière le trottoir)
    for (let x = -6; x > -60; x -= 9.4) put(builds[Math.floor(rnd() * builds.length)] + '_withoutBase', x, -4.8, 0);
    for (let x = W + 5.6; x < 85; x += 9.4) put(builds[Math.floor(rnd() * builds.length)] + '_withoutBase', x, -4.8, 0);
    // lampadaires, buissons, bancs
    const lampXs: number[] = [];
    for (let x = -12; x < W + 14; x += 8) if (x < -1 || x > W + 1) lampXs.push(x);
    for (const x of lampXs) {
      const l = put('streetlight', x, SIDEWALK_Z1 - 0.35, -Math.PI / 2);
      if (l)
        l.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) m.castShadow = false;
        });
    }
    const lampGlow = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, emissive: 0xffd27a, emissiveIntensity: 0, roughness: 0.4 });
    this.lampMats.push(lampGlow);
    for (const x of lampXs) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), lampGlow);
      b.position.set(x + 0.95, 4.15, SIDEWALK_Z1 - 0.35);
      this.city.add(b);
    }
    for (const x of [-3, W + 1.2]) put('bush', x, 0.6, rnd() * 6, 3.2);
    put('bench', W - 1.5, 2.3, Math.PI, 3.2);
    put('trash_A', -1.3, 0.5, 0, 3);
    put('firehydrant', W + 0.6, 2.4, 0, 3);
    // derrière le magasin : pelouse et buissons
    for (let i = 0; i < 14; i++) put('bush', rnd() * (W + 20) - 8, -16 - rnd() * 6, rnd() * 6, 3 + rnd() * 2);
  }

  // ------------------------------------------------------------------ mobilier
  private furnModel(def: FurnDef): THREE.Object3D {
    let o: THREE.Object3D | null = null;
    if (def.model.kit === 'equip') o = equipModel(def.model.name);
    else {
      o = kitModel('props', def.model.name);
      if (o) {
        if (def.model.fit) {
          const s = kitSize('props', def.model.name);
          o.scale.setScalar(Math.min((def.w * 0.95) / s.x, (def.d * 0.95) / s.z));
        } else o.scale.setScalar(def.model.scale ?? 1);
      }
    }
    if (!o) o = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.9, 1, def.d * 0.9), new THREE.MeshStandardMaterial({ color: 0xcccccc }));
    const wrap = new THREE.Group();
    o.position.z += def.model.dz ?? 0;
    o.rotation.y += def.model.rotY ?? 0;
    wrap.add(o);
    return wrap;
  }

  private syncFurniture(w: World) {
    const seen = new Set<number>();
    for (const f of w.furn) {
      seen.add(f.id);
      const key = `${f.def}:${f.x}:${f.z}:${f.rot}`;
      let o = this.furnObjs.get(f.id);
      if (!o || o.key !== key) {
        if (!o) {
          const g = new THREE.Group();
          g.add(this.furnModel(FURN_BY_ID[f.def]));
          g.traverse((c) => (c.userData.fid = f.id));
          this.furnG.add(g);
          o = { g, key };
          this.furnObjs.set(f.id, o);
        }
        o.key = key;
        const c = centerOf(f);
        o.g.position.set(c.x, 0, c.z);
        o.g.rotation.y = (f.rot * Math.PI) / 2;
      }
    }
    for (const [id, o] of this.furnObjs)
      if (!seen.has(id)) {
        this.furnG.remove(o.g);
        this.furnObjs.delete(id);
      }
  }

  private syncStock(w: World) {
    const counts = new Map<string, THREE.Matrix4[]>();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const f of w.furn) {
      const def = FURN_BY_ID[f.def];
      const sh = def.shelf;
      if (!sh) continue;
      const fw = sh.width / sh.facings;
      const modelD = def.model.dz ? 0.5 : def.d;
      const front = (def.model.dz ?? 0) + modelD / 2;
      const back = (def.model.dz ?? 0) - modelD / 2;
      const rowD = sh.depth / sh.rows;
      const c = centerOf(f);
      const base = (f.rot * Math.PI) / 2;
      const cos = Math.cos(base);
      const sin = Math.sin(base);
      const cap = levelCap(def);
      for (let lvl = 0; lvl < sh.levels.length; lvl++) {
        const pid = f.prod[lvl];
        const n = Math.min(f.stock[lvl] ?? 0, cap);
        if (!pid || n <= 0) continue;
        const p = PRODUCT_BY_ID[pid];
        const list = counts.get(pid) ?? [];
        counts.set(pid, list);
        const y0 = sh.levels[lvl];
        const clear = lvl + 1 < sh.levels.length ? sh.levels[lvl + 1] - y0 - 0.06 : 0.34;
        const [px, py, pz] = p.size;
        const tall = py * (p.shape === 'fruit' ? 1.4 : 1);
        const sc = Math.min(1.5, (fw * 0.92) / px, (clear * 0.92) / tall, (rowD * 0.9) / pz);
        const k = Math.max(1, Math.min(4, Math.floor((fw * 0.95) / (px * sc + 0.01))));
        const ly = y0 + (tall * sc) / 2 + 0.01;
        // une colonne (emplacement) se remplit d'avant en arrière ; les colonnes se vident une par une
        for (let u = 0; u < n; u++) {
          const col = Math.floor(u / sh.rows);
          const row = u % sh.rows;
          const side = Math.floor(col / sh.facings);
          const fac = col % sh.facings;
          const lz = side === 0 ? front - 0.04 - rowD * (row + 0.5) : back + 0.04 + rowD * (row + 0.5);
          q.setFromAxisAngle(up, base + (side === 0 ? 0 : Math.PI));
          for (let i = 0; i < k; i++) {
            const lx = (side === 0 ? 1 : -1) * (-sh.width / 2 + fw * fac + (fw * (i + 0.5)) / k);
            m4.compose(new THREE.Vector3(c.x + lx * cos + lz * sin, ly, c.z - lx * sin + lz * cos), q, new THREE.Vector3(sc, sc, sc));
            list.push(m4.clone());
          }
        }
      }
    }
    for (const [pid, mats] of counts) {
      let im = this.prodMeshes.get(pid);
      if (!im || im.instanceMatrix.count < mats.length) {
        if (im) {
          this.scene.remove(im);
          im.dispose();
        }
        const p = PRODUCT_BY_ID[pid];
        im = new THREE.InstancedMesh(productGeometry(p), productMaterial(p), Math.max(64, Math.ceil(mats.length * 1.5)));
        im.castShadow = false;
        im.receiveShadow = true;
        im.frustumCulled = false;
        this.prodMeshes.set(pid, im);
        this.scene.add(im);
      }
      mats.forEach((m, i) => im!.setMatrixAt(i, m));
      im.count = mats.length;
      im.instanceMatrix.needsUpdate = true;
    }
    for (const [pid, im] of this.prodMeshes) if (!counts.has(pid)) im.count = 0;
    // cartons dans les racks de la réserve
    let left = reserveCartons(w);
    let n = 0;
    const racks = w.furn.filter((f) => f.def === 'rack_reserve');
    for (const r of racks) {
      const c = centerOf(r);
      const base = (r.rot * Math.PI) / 2;
      for (let lvl = 0; lvl < 3 && left > 0; lvl++)
        for (let i = 0; i < 4 && left > 0; i++, left--) {
          const lx = -0.75 + i * 0.5;
          const wx = c.x + lx * Math.cos(base);
          const wz = c.z - lx * Math.sin(base);
          q.setFromAxisAngle(up, base + (i % 2 ? 0.05 : -0.04));
          m4.compose(new THREE.Vector3(wx, [0.14, 0.89, 1.64][lvl] + 0.19, wz), q, new THREE.Vector3(0.95, 1, 1));
          this.cartons.setMatrixAt(n++, m4);
        }
    }
    // le reste s'empile au sol de la réserve, au fond à droite
    const s = STORE_SIZES[w.sizeIdx];
    for (let i = 0; left > 0 && n < 380; i++, left--) {
      const col = i % 4;
      const lvl = Math.floor(i / 4) % 3;
      const row = Math.floor(i / 12);
      m4.compose(new THREE.Vector3(s.w - 0.4 - row * 0.55, 0.18 + lvl * 0.36, -s.d - BACK_D + 0.4 + col * 0.45), q.setFromAxisAngle(up, 0), new THREE.Vector3(1, 1, 1));
      this.cartons.setMatrixAt(n++, m4);
    }
    // cartons livrés devant la porte
    for (let i = 0; i < w.dock.length && n < 400; i++) {
      const col = i % 3;
      const lvl = Math.floor(i / 3) % 3;
      const row = Math.floor(i / 9);
      m4.compose(new THREE.Vector3(DOCK.x - 0.6 + col * 0.52, 0.18 + lvl * 0.36, DOCK.z - 0.2 + row * 0.45), q.setFromAxisAngle(up, (i % 3) * 0.06), new THREE.Vector3(1, 1, 1));
      this.cartons.setMatrixAt(n++, m4);
    }
    this.cartons.count = n;
    this.cartons.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ personnages
  private makeAgent(a: AgentView): AgentObj {
    const root = new THREE.Group();
    let model: THREE.Object3D;
    let mixer: THREE.AnimationMixer | null = null;
    const actions = new Map<string, THREE.AnimationAction>();
    if (a.kind === 'van') {
      model = kitModel('city', a.model) ?? new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 4));
      model.scale.setScalar(CITY_SCALE);
    } else {
      const p = personModel(a.model);
      model = p.root;
      mixer = new THREE.AnimationMixer(model);
      for (const [k, clipName] of Object.entries(ANIM_CLIP)) {
        const clip = p.clips.get(clipName);
        if (clip) actions.set(k, mixer.clipAction(clip));
      }
      const idle = actions.get('idle');
      if (idle) {
        idle.play();
        idle.time = Math.random() * 2;
      }
      model.scale.setScalar(a.kind === 'player' ? 1 : 0.95);
    }
    root.add(model);
    let ring: THREE.Mesh | null = null;
    if (a.kind === 'player') {
      ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 32), new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      root.add(ring);
    }
    this.agentsG.add(root);
    let tagEl: HTMLElement | null = null;
    if (a.tag && a.kind !== 'customer') {
      tagEl = document.createElement('div');
      tagEl.className = 'tag' + (a.kind === 'player' ? ' tag-player' : '');
      tagEl.textContent = a.tag;
      if (a.kind === 'player') tagEl.style.background = '#' + a.color.toString(16).padStart(6, '0');
      this.overlay.append(tagEl);
    }
    return { root, model, mixer, actions, cur: 'idle', x: a.x, z: a.z, rot: a.rot, tx: a.x, tz: a.z, trot: a.rot, anim: a.anim, box: null, boxKind: '', ring, tagEl, bubbleEl: null, bubble: null, kind: a.kind, seen: true };
  }

  private syncAgents(list: AgentView[], dt: number) {
    for (const o of this.agentObjs.values()) o.seen = false;
    for (const a of list) {
      let o = this.agentObjs.get(a.id);
      if (!o) {
        o = this.makeAgent(a);
        this.agentObjs.set(a.id, o);
      }
      o.seen = true;
      o.tx = a.x;
      o.tz = a.z;
      o.trot = a.rot;
      o.anim = a.anim;
      // carton porté (employés, joueurs) ou panier (clients)
      const kind = a.carry ? (a.carry === 'basket' ? 'basket' : 'box') : '';
      if (kind !== o.boxKind) {
        if (o.box) o.root.remove(o.box);
        o.box = null;
        o.boxKind = kind;
        if (kind === 'box') {
          o.box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.34), this.cartons.material as THREE.Material);
          o.box.position.set(0, 1.05, 0.32);
        } else if (kind === 'basket') {
          o.box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.24), this.basketMat);
          o.box.position.set(0.3, 0.72, 0.08);
        }
        if (o.box) {
          o.box.castShadow = true;
          o.root.add(o.box);
        }
      }
      // bulle
      if (a.bubble !== o.bubble) {
        o.bubble = a.bubble;
        o.bubbleEl?.remove();
        o.bubbleEl = null;
        if (a.bubble) {
          const el = document.createElement('div');
          el.className = 'bubble';
          const [kind, id] = a.bubble.split(':');
          if (kind === 'ui' && UI_EMOJI[id]) el.textContent = UI_EMOJI[id];
          else {
            const im = document.createElement('img');
            im.src = kind === 'ui' ? `./ui/${id}.webp` : `./products/${id}.webp`;
            el.append(im);
            if (kind === 'no') el.classList.add('bubble-no');
          }
          this.overlay.append(el);
          o.bubbleEl = el;
        }
      }
    }
    for (const [id, o] of this.agentObjs) {
      if (!o.seen) {
        this.agentsG.remove(o.root);
        o.tagEl?.remove();
        o.bubbleEl?.remove();
        o.mixer?.stopAllAction();
        this.agentObjs.delete(id);
        continue;
      }
      const jump = Math.hypot(o.tx - o.x, o.tz - o.z);
      const k = jump > 4 ? 1 : 1 - Math.exp(-dt * 14);
      const px = o.x;
      const pz = o.z;
      o.x += (o.tx - o.x) * k;
      o.z += (o.tz - o.z) * k;
      o.rot = lerpAngle(o.rot, o.trot, 1 - Math.exp(-dt * 12));
      o.root.position.set(o.x, 0, o.z);
      o.root.rotation.y = o.rot;
      if (o.mixer) {
        const want = o.anim === 'drive' ? 'idle' : o.anim;
        if (want !== o.cur && o.actions.has(want)) {
          const from = o.actions.get(o.cur);
          const to = o.actions.get(want)!;
          to.reset().play();
          if (from) to.crossFadeFrom(from, 0.2, false);
          o.cur = want;
        }
        if (o.cur === 'walk') {
          const v = dt > 0 ? Math.hypot(o.x - px, o.z - pz) / dt : 1.3;
          o.actions.get('walk')!.timeScale = Math.max(0.7, Math.min(2.2, v / 1.25));
        }
        o.mixer.update(dt);
      }
    }
  }

  // ------------------------------------------------------------------ lumière du jour
  private lighting(w: World) {
    const h = w.min / 60;
    // 0 = nuit, 1 = plein jour
    const day = h < 7 ? 0 : h < 9 ? (h - 7) / 2 : h < 18 ? 1 : h < 21 ? 1 - (h - 18) / 3 : 0;
    const dusk = h > 17 && h < 21 ? Math.sin(((h - 17) / 4) * Math.PI) : h > 7 && h < 9.5 ? Math.sin(((h - 7) / 2.5) * Math.PI) * 0.6 : 0;
    this.dayF = day;
    this.duskF = dusk;
    this.scene.environmentIntensity = (this.quality === 'basse' ? 0.2 : 0.42) * (0.3 + 0.7 * day);
    const sky = new THREE.Color(0x0f1b3a).lerp(new THREE.Color(0x9fd4f5), day).lerp(new THREE.Color(0xf6a26b), dusk * 0.5);
    (this.scene.background as THREE.Color).copy(sky);
    this.sun.intensity = 0.2 + 2.9 * day;
    this.sun.color.set(0xffffff).lerp(new THREE.Color(0xffb070), dusk * 0.7);
    this.hemi.intensity = (this.quality === 'basse' ? 0.45 : 0.18) + (this.quality === 'basse' ? 0.8 : 0.32) * day;
    this.hemi.color.set(0x8aa4d6).lerp(new THREE.Color(0xcfe8ff), day);
    const t = (h - 6) / 14;
    const ang = Math.PI * Math.max(0.08, Math.min(0.92, t));
    const s = STORE_SIZES[w.sizeIdx];
    const cx = s.w / 2;
    const cz = -s.d / 2;
    this.sun.position.set(cx - Math.cos(ang) * 30, 12 + Math.sin(ang) * 30, cz + 18);
    this.sun.target.position.set(cx, 0, cz);
    const open = w.min >= OPEN_MIN - 30 && w.min < CLOSE_MIN + 60;
    this.storeLight.intensity = open ? (1 - day) * 14 : 0;
    for (const m of this.lampMats) m.emissiveIntensity = (1 - day) * 2.5;
  }

  // ------------------------------------------------------------------ aperçu de construction & sélection
  setGhost(defId: string | null, x = 0, z = 0, rot = 0, ok = true) {
    const key = defId ? `${defId}` : '';
    if (key !== this.ghostKey) {
      if (this.ghost) this.fxG.remove(this.ghost);
      this.ghost = null;
      this.ghostKey = key;
      if (defId) {
        const def = FURN_BY_ID[defId];
        const g = new THREE.Group();
        const m = this.furnModel(def);
        m.traverse((o) => {
          const mm = o as THREE.Mesh;
          if (mm.isMesh) {
            mm.material = (Array.isArray(mm.material) ? mm.material[0] : mm.material).clone();
            (mm.material as THREE.MeshStandardMaterial).transparent = true;
            (mm.material as THREE.MeshStandardMaterial).opacity = 0.7;
            mm.castShadow = false;
          }
        });
        g.add(m);
        const tiles = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.d), new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.45, depthWrite: false }));
        tiles.rotation.x = -Math.PI / 2;
        tiles.position.y = 0.03;
        tiles.name = 'tiles';
        g.add(tiles);
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, 0.05, def.d / 2 + 0.35);
        g.add(arrow);
        this.ghost = g;
        this.fxG.add(g);
      }
    }
    if (this.ghost && defId) {
      const c = centerOf({ def: defId, x, z, rot });
      this.ghost.position.set(c.x, 0, c.z);
      this.ghost.rotation.y = (rot * Math.PI) / 2;
      const tiles = this.ghost.getObjectByName('tiles') as THREE.Mesh;
      (tiles.material as THREE.MeshBasicMaterial).color.set(ok ? 0x3ddc84 : 0xff4d4d);
    }
  }

  setSelected(f: Furn | null) {
    if (!f) {
      this.selMesh.visible = false;
      return;
    }
    const def = FURN_BY_ID[f.def];
    const cells = cellsOf(def, f.x, f.z, f.rot);
    const xs = cells.map((c) => c.x);
    const zs = cells.map((c) => c.z);
    const x0 = Math.min(...xs);
    const z0 = Math.min(...zs);
    const x1 = Math.max(...xs) + 1;
    const z1 = Math.max(...zs) + 1;
    this.selMesh.scale.set(x1 - x0 + 0.2, z1 - z0 + 0.2, 1);
    this.selMesh.position.set((x0 + x1) / 2, 0.025, (z0 + z1) / 2);
    this.selMesh.visible = true;
  }

  showTap(x: number, z: number) {
    this.tapMark.position.set(x, 0.04, z);
    this.tapMark.visible = true;
    this.tapT = 0.8;
  }

  floatText(text: string, x: number, z: number, color = '#fff') {
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    this.overlay.append(el);
    this.floats.push({ el, x, z, t: 0 });
  }

  // ------------------------------------------------------------------ circulation (décor)
  private traffic(dt: number) {
    this.carT -= dt;
    if (this.carT <= 0 && this.cars.length < 5) {
      this.carT = 3 + Math.random() * 6;
      const name = ['car_hatchback', 'car_sedan', 'car_taxi', 'car_police', 'car_sedan', 'car_hatchback'][Math.floor(Math.random() * 6)];
      const obj = kitModel('city', name);
      if (obj) {
        obj.scale.setScalar(CITY_SCALE);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const x = dir > 0 ? -60 : 80;
        obj.position.set(x, 0, dir > 0 ? ROAD_Z : ROAD_Z + 4.2);
        obj.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.scene.add(obj);
        this.cars.push({ obj, x, dir, speed: 6 + Math.random() * 4 });
      }
    }
    for (const c of [...this.cars]) {
      c.x += c.dir * c.speed * dt;
      // ralentit près de la camionnette de livraison garée
      c.obj.position.x = c.x;
      if (c.x > 82 || c.x < -62) {
        this.scene.remove(c.obj);
        this.cars.splice(this.cars.indexOf(c), 1);
      }
    }
  }

  // ------------------------------------------------------------------ image
  update(w: World, agents: AgentView[], dt: number) {
    this.buildShell(w);
    this.syncFurniture(w);
    if (w.rev !== this.stockRev) {
      this.stockRev = w.rev;
      this.syncStock(w);
    }
    this.syncAgents(agents, dt);
    this.lighting(w);
    this.traffic(w.speed > 0 ? dt : 0);
    if (this.tapT > 0) {
      this.tapT -= dt;
      this.tapMark.scale.setScalar(1 + (0.8 - this.tapT));
      (this.tapMark.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.tapT);
      if (this.tapT <= 0) this.tapMark.visible = false;
    }
    this.updateCamera();
    if (this.post) this.post.render(dt, this.dayF, this.duskF);
    else this.renderer.render(this.scene, this.camera);
    this.place(dt);
  }

  private project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const el = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
  }

  /** Positionne les noms, bulles et textes flottants. */
  private place(dt: number) {
    for (const o of this.agentObjs.values()) {
      if (o.tagEl) {
        const p = this.project(o.x, 2.15, o.z);
        o.tagEl.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      }
      if (o.bubbleEl) {
        const p = this.project(o.x, o.tagEl ? 2.7 : 2.25, o.z);
        o.bubbleEl.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      }
    }
    for (const f of [...this.floats]) {
      f.t += dt;
      const p = this.project(f.x, 2 + f.t * 1.2, f.z);
      f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 1.6));
      if (f.t > 1.6) {
        f.el.remove();
        this.floats.splice(this.floats.indexOf(f), 1);
      }
    }
  }

  // ------------------------------------------------------------------ toucher
  private ray(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    return this.raycaster;
  }

  groundAt(cx: number, cy: number): { x: number; z: number } | null {
    const r = this.ray(cx, cy);
    const p = new THREE.Vector3();
    return r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x, z: p.z } : null;
  }

  pickFurn(cx: number, cy: number): number | null {
    const r = this.ray(cx, cy);
    const hits = r.intersectObjects(this.furnG.children, true);
    for (const h of hits) if (h.object.userData.fid) return h.object.userData.fid;
    return null;
  }

  /** Oublie tout ce qui est affiché (changement de partie). */
  reset() {
    for (const o of this.agentObjs.values()) {
      o.tagEl?.remove();
      o.bubbleEl?.remove();
      this.agentsG.remove(o.root);
    }
    this.agentObjs.clear();
    for (const o of this.furnObjs.values()) this.furnG.remove(o.g);
    this.furnObjs.clear();
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    this.shellKey = '';
    this.stockRev = -1;
    this.setGhost(null);
    this.setSelected(null);
  }

  /** Nombre de personnages affichés (tests). */
  get agentCount() {
    return this.agentObjs.size;
  }

  dispose() {
    for (const o of this.agentObjs.values()) {
      o.tagEl?.remove();
      o.bubbleEl?.remove();
    }
    for (const f of this.floats) f.el.remove();
    this.agentObjs.clear();
    this.renderer.dispose();
  }
}
