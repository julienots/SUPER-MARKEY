/**
 * Caméra au doigt et à la souris : glisser = déplacer la vue, pincer / molette = zoom,
 * un appui court = « tap » (sélection, déplacement de l'avatar, pose d'un meuble).
 */
import type { View } from './view';

export class Controls {
  private pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinch0 = 0;
  private size0 = 0;
  private moved = false;
  bounds = { x0: -6, x1: 20, z0: -16, z1: 8 };
  onTap: (x: number, y: number) => void = () => {};
  onDrag: (x: number, y: number) => boolean = () => false;
  /** Appelé quand le joueur déplace la vue à la main. */
  onPan: () => void = () => {};
  enabled = true;
  private keys = new Set<string>();

  constructor(
    private el: HTMLElement,
    private view: View,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    addEventListener('pointermove', (e) => this.move(e));
    addEventListener('pointerup', (e) => this.up(e));
    addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === '+' || e.key === '=') this.zoom(1 / 1.15);
      if (e.key === '-') this.zoom(1.15);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  zoom(f: number) {
    const c = this.view.cam;
    c.size = Math.max(7, Math.min(42, c.size * f));
  }

  rotate(dir = 1) {
    this.view.cam.az = (((this.view.cam.az + dir) % 4) + 4) % 4;
  }

  /** Déplace la vue : le sol suit le doigt (glissement de dx, dy pixels jusqu'au point x, y). */
  private pan(dx: number, dy: number, x?: number, y?: number) {
    const r = this.el.getBoundingClientRect();
    const cx = x ?? r.left + r.width / 2;
    const cy = y ?? r.top + r.height / 2;
    this.view.updateCamera();
    const a = this.view.groundAt(cx - dx, cy - dy);
    const b = this.view.groundAt(cx, cy);
    if (!a || !b) return;
    this.view.cam.x += a.x - b.x;
    this.view.cam.z += a.z - b.z;
    this.clamp();
    this.onPan();
  }

  clamp() {
    const c = this.view.cam;
    const b = this.bounds;
    c.x = Math.max(b.x0, Math.min(b.x1, c.x));
    c.z = Math.max(b.z0, Math.min(b.z1, c.z));
  }

  /** Flèches / ZQSD / WASD : direction voulue pour son perso (x à droite, y vers le bas de l'écran). */
  keyVec() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('arrowleft') || k.has('q') || k.has('a')) x -= 1;
    if (k.has('arrowright') || k.has('d')) x += 1;
    if (k.has('arrowup') || k.has('z') || k.has('w')) y -= 1;
    if (k.has('arrowdown') || k.has('s')) y += 1;
    const m = Math.hypot(x, y) || 1;
    return { x: x / m, y: y / m, on: x !== 0 || y !== 0 };
  }

  update(_dt: number) {}

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    this.el.setPointerCapture?.(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.pts.size === 1) this.moved = false;
    if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      this.size0 = this.view.cam.size;
      this.moved = true;
    }
  }

  private move(e: PointerEvent) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pts.size === 2) {
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch0 > 0) this.view.cam.size = Math.max(7, Math.min(42, (this.size0 * this.pinch0) / Math.max(10, d)));
      this.pan(dx / 2, dy / 2, e.clientX, e.clientY);
      return;
    }
    if (!this.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 9) this.moved = true;
    if (this.moved) {
      // en mode construction, glisser déplace l'aperçu au lieu de la vue
      if (this.onDrag(e.clientX, e.clientY)) return;
      this.pan(dx, dy, e.clientX, e.clientY);
    }
  }

  private up(e: PointerEvent, cancel = false) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    this.pts.delete(e.pointerId);
    if (!cancel && !this.moved && this.pts.size === 0 && performance.now() - p.t < 600) this.onTap(e.clientX, e.clientY);
    if (this.pts.size === 0) this.pinch0 = 0;
  }
}
