/**
 * Caméra 2.5D : orthographique, vue isométrique fixe (plongée ~35°), déplacement, zoom autour du doigt,
 * rotation par quarts de tour. Indique aussi quels côtés du magasin font face à la caméra (murs à couper).
 */
import * as THREE from 'three';

export class IsoCamera {
  readonly cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 400);
  readonly target = new THREE.Vector3(0, 0, 6);
  /** Hauteur de vue (mètres) au zoom 1. */
  span = 24;
  zoom = 1;
  minZoom = 0.45;
  maxZoom = 4;
  /** Angle autour de la verticale : π/4 = vue depuis l'avant-droite du magasin. */
  azimuth = Math.PI / 4;
  elevation = 0.62;
  w = 800;
  h = 600;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor() {
    this.update();
  }

  get dir() {
    const c = Math.cos(this.elevation);
    return new THREE.Vector3(Math.sin(this.azimuth) * c, Math.sin(this.elevation), -Math.cos(this.azimuth) * c);
  }

  update() {
    const halfH = this.span / this.zoom / 2;
    const halfW = (halfH * this.w) / Math.max(1, this.h);
    const c = this.cam;
    c.left = -halfW;
    c.right = halfW;
    c.top = halfH;
    c.bottom = -halfH;
    c.position.copy(this.target).addScaledVector(this.dir, 120);
    c.lookAt(this.target);
    c.near = 1;
    c.far = 400;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  /** Mètres par pixel à l'écran. */
  get mpp() {
    return this.span / this.zoom / this.h;
  }

  /** Déplace la vue d'un glissement écran. */
  pan(dx: number, dy: number) {
    const k = this.mpp;
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, Math.sin(this.azimuth));
    const fwd = new THREE.Vector3(-Math.sin(this.azimuth), 0, Math.cos(this.azimuth));
    this.target.addScaledVector(right, -dx * k);
    this.target.addScaledVector(fwd, (dy * k) / Math.sin(this.elevation));
    this.update();
  }

  zoomAt(f: number, sx: number, sy: number) {
    const before = this.ground(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * f));
    this.update();
    const after = this.ground(sx, sy);
    if (before && after) {
      this.target.x += before.x - after.x;
      this.target.z += before.z - after.z;
      this.update();
    }
  }

  /** Rayon depuis un point écran (pour la sélection). */
  rayAt(sx: number, sy: number): THREE.Raycaster {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.cam);
    return this.ray;
  }

  /** Point du sol sous un point écran. */
  ground(sx: number, sy: number): { x: number; z: number } | null {
    const p = new THREE.Vector3();
    return this.rayAt(sx, sy).ray.intersectPlane(this.plane, p) ? { x: p.x, z: p.z } : null;
  }

  /** Projette un point du monde à l'écran (pixels CSS). */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.cam);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  rotate(steps: number) {
    this.azimuth += (steps * Math.PI) / 2;
    this.update();
  }

  /** Côtés du magasin tournés vers la caméra (front = z0, back = z1, left = x0, right = x1). */
  nearSides(): string[] {
    const d = this.dir;
    const out: string[] = [];
    if (-d.z > 0.2) out.push('front');
    if (d.z > 0.2) out.push('back');
    if (d.x > 0.2) out.push('right');
    if (-d.x > 0.2) out.push('left');
    return out;
  }

  /** Cadre une zone du sol. */
  fit(x0: number, z0: number, x1: number, z1: number) {
    this.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const diag = Math.hypot(x1 - x0, z1 - z0);
    const needH = diag * 0.75;
    const needW = diag * 1.0;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min(this.span / needH, (this.span * this.w) / this.h / needW)));
    this.update();
  }
}
