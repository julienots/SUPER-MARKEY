/**
 * Vue isométrique 2.5D : projection monde (x, y, z en mètres) → écran (pixels CSS), déplacement et zoom.
 *
 * Orientation : la façade du magasin (z = 0) longe le bas-gauche de l'écran, le fond (z max) est en haut à droite.
 * Plus (x − z) est grand, plus l'objet est proche du spectateur (dessiné après).
 */
export const ISO_C = Math.cos(Math.PI / 6);
export const ISO_S = 0.5;
/** Écrasement de la hauteur (vue plongeante). */
export const ISO_H = 0.92;

export class IsoView {
  /** Pixels par mètre au zoom 1. */
  base = 44;
  zoom = 1;
  minZoom = 0.35;
  maxZoom = 3;
  /** Point du monde au centre de l'écran. */
  cx = 4;
  cz = 6;
  w = 800;
  h = 600;

  get k() {
    return this.base * this.zoom;
  }

  /** Monde → écran (pixels CSS). */
  px(x: number, y: number, z: number): [number, number] {
    const k = this.k;
    const dx = x - this.cx;
    const dz = z - this.cz;
    return [this.w / 2 + (dx + dz) * ISO_C * k, this.h / 2 + (dx - dz) * ISO_S * k - y * ISO_H * k];
  }

  /** Écran → sol (y = 0). */
  ground(sx: number, sy: number): { x: number; z: number } {
    const k = this.k;
    const a = (sx - this.w / 2) / (ISO_C * k);
    const b = (sy - this.h / 2) / (ISO_S * k);
    return { x: this.cx + (a + b) / 2, z: this.cz + (a - b) / 2 };
  }

  /** Profondeur de tri (plus grand = plus proche). */
  static depth(x: number, z: number) {
    return x - z;
  }

  /** Décale la vue d'un déplacement écran (glisser). */
  pan(dsx: number, dsy: number) {
    const k = this.k;
    const a = dsx / (ISO_C * k);
    const b = dsy / (ISO_S * k);
    this.cx -= (a + b) / 2;
    this.cz -= (a - b) / 2;
  }

  /** Zoom autour d'un point écran (le point visé reste sous le doigt). */
  zoomAt(f: number, sx: number, sy: number) {
    const before = this.ground(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * f));
    const after = this.ground(sx, sy);
    this.cx += before.x - after.x;
    this.cz += before.z - after.z;
  }

  /** Limite le centre de la vue à une zone (le joueur ne se perd pas dans le vide). */
  clamp(x0: number, z0: number, x1: number, z1: number) {
    this.cx = Math.max(x0, Math.min(x1, this.cx));
    this.cz = Math.max(z0, Math.min(z1, this.cz));
  }

  /** Cadre une zone du monde dans l'écran. */
  fit(x0: number, z0: number, x1: number, z1: number, margin = 60) {
    this.cx = (x0 + x1) / 2;
    this.cz = (z0 + z1) / 2;
    const span = (x1 - x0 + z1 - z0) * ISO_C;
    const spanY = (x1 - x0 + z1 - z0) * ISO_S + 3 * ISO_H;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min((this.w - margin * 2) / (span * this.base), (this.h - margin * 2) / (spanY * this.base))));
  }
}
