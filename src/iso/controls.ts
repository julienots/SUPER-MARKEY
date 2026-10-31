/**
 * Contrôles de la vue 2.5D : glisser (doigt ou souris) pour déplacer la caméra, pincer / molette pour zoomer,
 * appui court pour sélectionner, survol (souris) pour l'aperçu de construction, clavier (flèches/ZQSD, +/−).
 */
import type { IsoView } from './view';

export interface ControlHandlers {
  tap(sx: number, sy: number): void;
  hover?(sx: number, sy: number): void;
  /** Le joueur a déplacé la vue à la main (on arrête de suivre le patron). */
  panned?(): void;
}

export class IsoControls {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinchD = 0;
  private moved = false;
  private keys = new Set<string>();
  enabled = true;

  constructor(
    private el: HTMLElement,
    private view: IsoView,
    private h: ControlHandlers,
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e, true));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.size) this.h.hover?.(-1, -1);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        this.view.zoomAt(e.deltaY > 0 ? 0.9 : 1.11, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.view.zoomAt(1.15, this.view.w / 2, this.view.h / 2);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.view.zoomAt(1 / 1.15, this.view.w / 2, this.view.h / 2);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  private local(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    if (!this.enabled) return;
    const p = this.local(e);
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, t: performance.now() });
    if (this.pointers.size === 1) this.moved = false;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  private move(e: PointerEvent) {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) {
      if (e.pointerType === 'mouse') this.h.hover?.(p.x, p.y);
      return;
    }
    if (!this.enabled) return;
    const dx = p.x - ptr.x;
    const dy = p.y - ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    if (Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 9) this.moved = true;
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchD > 0) this.view.zoomAt(d / this.pinchD, (a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinchD = d;
      this.view.pan(dx / 2, dy / 2);
      this.h.panned?.();
    } else if (this.moved) {
      this.view.pan(dx, dy);
      this.h.panned?.();
    }
    if (e.pointerType === 'mouse') this.h.hover?.(p.x, p.y);
  }

  private up(e: PointerEvent, cancel = false) {
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.pinchD = 0;
    if (!ptr || cancel || !this.enabled) return;
    if (!this.moved && this.pointers.size === 0 && performance.now() - ptr.t < 600) this.h.tap(ptr.sx, ptr.sy);
  }

  /** Déplacement au clavier (appelé à chaque image). */
  update(dt: number) {
    if (!this.enabled) return;
    const sp = 600 * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx += sp;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx -= sp;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy += sp;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy -= sp;
    if (dx || dy) {
      this.view.pan(dx, dy);
      this.h.panned?.();
    }
  }
}
