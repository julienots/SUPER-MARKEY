/**
 * Contrôles tactiles (téléphones, tablettes, appli Android) : joystick flottant à gauche, vue au doigt à droite,
 * boutons d'action contextuels, et en mode construction : glisser = orbite, pincer = zoom, taper = aperçu puis validation.
 */
import { h } from './dom';
import { clamp } from '../core/math';
import type { Game } from '../game/game';
import type { BuildMode } from '../build/buildMode';
import type { Input } from '../player/input';

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  if (q.has('touch')) return true;
  if (q.has('notouch')) return false;
  return (window as any).Capacitor?.isNativePlatform?.() === true || matchMedia('(pointer: coarse)').matches;
}

// ------------------------------------------------------------ appuis maintenus (boutons, invites tactiles)
const pressed = new Map<number, { input: Input; action: string }>();
let releaseBound = false;

function release(e: PointerEvent) {
  const p = pressed.get(e.pointerId);
  if (!p) return;
  pressed.delete(e.pointerId);
  p.input.inject(p.action, false);
}

/** Un appui sur l'élément = touche maintenue tant que le doigt reste posé. */
export function bindPress(el: HTMLElement, input: () => Input, action: string) {
  if (!releaseBound) {
    releaseBound = true;
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  }
  el.classList.add('tap');
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const inp = input();
    inp.inject(action, true);
    pressed.set(e.pointerId, { input: inp, action });
  });
}

function key(code: string) {
  dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

interface TouchCtx {
  game: () => Game | null;
  build: () => BuildMode | null;
  playing: () => boolean;
}

interface Look {
  x: number;
  y: number;
  sx: number;
  sy: number;
  t: number;
  moved: boolean;
}

const STICK_R = 56;

export class TouchControls {
  root = h('div', { id: 'touch' });
  private base = h('div', { class: 'stick-base' }, h('div', { class: 'stick-knob' }));
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private looks = new Map<number, Look>();
  private pinch = 0;
  private play: HTMLElement;
  private cashier: HTMLElement;
  private buildBtns: HTMLElement;
  private throwBtn: HTMLElement;
  private askedFullscreen = false;

  constructor(private canvas: HTMLCanvasElement, private ctx: TouchCtx) {
    document.body.classList.add('touch');
    const inp = () => ctx.game()!.player.input;
    const btn = (cls: string, ico: string, label: string, action: string) => {
      const b = h('button', { class: `tbtn ${cls}`, 'aria-label': label }, h('span', { class: 'ico' }, ico), h('span', { class: 'lbl' }, label));
      bindPress(b, inp, action);
      return b;
    };
    this.throwBtn = h('button', { class: 'tbtn small', 'aria-label': 'Lancer' }, h('span', { class: 'ico' }, '🎯'), h('span', { class: 'lbl' }, 'Lancer'));
    this.throwBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = ctx.game()?.player;
      if (!p?.held) return;
      p.input.mouseClicked[p.held.kind === 'cartons' ? 2 : 0] = true;
    });
    this.play = h(
      'div',
      { class: 'tpad' },
      btn('big', '✋', 'Action E', 'interagir'),
      btn('', '⚙️', 'Second. F', 'secondaire'),
      btn('', '🏷️', 'Prix R', 'prix'),
      btn('small', '⬇️', 'Lâcher G', 'lacher'),
      this.throwBtn,
      btn('small', '⤒', 'Sauter', 'sauter'),
    );
    this.cashier = h('div', { class: 'tpad' }, btn('big', '🧾', 'Scanner E', 'interagir'), btn('', '🚪', 'Quitter', 'quitterCaisse'));
    const tool = (ico: string, label: string, fn: () => void) =>
      h('button', { class: 'tbtn', 'aria-label': label, onpointerdown: (e: PointerEvent) => (e.preventDefault(), e.stopPropagation(), fn()) }, h('span', { class: 'ico' }, ico), h('span', { class: 'lbl' }, label));
    this.buildBtns = h(
      'div',
      { class: 'tpad build' },
      tool('⟳', 'Pivoter', () => ctx.build()?.rotate()),
      tool('➕', 'Zoom', () => ctx.build()?.zoom(0.8)),
      tool('➖', 'Dézoom', () => ctx.build()?.zoom(1.25)),
      tool('🗑️', 'Vendre', () => key('Delete')),
      tool('↩️', 'Annuler', () => key('Escape')),
    );
    this.root.append(this.base, this.play, this.cashier, this.buildBtns);
    document.getElementById('ui')!.append(this.root);
    canvas.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    canvas.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.style.touchAction = 'none';
    this.update();
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    this.fullscreen();
    this.canvas.setPointerCapture(e.pointerId);
    if (this.stickId === null && e.clientX < innerWidth * 0.4 && (this.ctx.build()?.active || this.ctx.game()?.player.mode === 'walk')) {
      this.stickId = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      this.knob(0, 0);
      return;
    }
    this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
    this.pinch = 0;
  }

  private move(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const g = this.ctx.game();
    if (!g) return;
    if (e.pointerId === this.stickId) {
      let dx = (e.clientX - this.origin.x) / STICK_R;
      let dy = (e.clientY - this.origin.y) / STICK_R;
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      g.player.input.moveX = dx;
      g.player.input.moveY = -dy;
      this.knob(dx * STICK_R, dy * STICK_R);
      return;
    }
    const l = this.looks.get(e.pointerId);
    if (!l) return;
    const dx = e.clientX - l.x;
    const dy = e.clientY - l.y;
    l.x = e.clientX;
    l.y = e.clientY;
    if (Math.hypot(e.clientX - l.sx, e.clientY - l.sy) > 10) l.moved = true;
    const b = this.ctx.build();
    if (b?.active) {
      if (this.looks.size >= 2) {
        const [a, c] = [...this.looks.values()];
        const d = Math.hypot(a.x - c.x, a.y - c.y);
        if (this.pinch) b.zoom(clamp(this.pinch / d, 0.8, 1.25));
        this.pinch = d;
      } else b.orbit(dx, dy);
      return;
    }
    g.player.input.mouseDX += dx * 2.2;
    g.player.input.mouseDY += dy * 2.2;
  }

  private up(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    const g = this.ctx.game();
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.base.classList.remove('on');
      if (g) g.player.input.moveX = g.player.input.moveY = 0;
      return;
    }
    const l = this.looks.get(e.pointerId);
    this.looks.delete(e.pointerId);
    this.pinch = 0;
    if (!l || l.moved || performance.now() - l.t > 400) return;
    // simple tape
    const b = this.ctx.build();
    if (b?.active) b.tap(e.clientX, e.clientY);
    else if (g?.player.mode === 'cashier') {
      g.player.input.inject('interagir', true);
      requestAnimationFrame(() => g.player.input.inject('interagir', false));
    }
  }

  private knob(x: number, y: number) {
    (this.base.firstElementChild as HTMLElement).style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Plein écran + paysage au premier contact (navigateur mobile). */
  private fullscreen() {
    if (this.askedFullscreen) return;
    this.askedFullscreen = true;
    if ((window as any).Capacitor?.isNativePlatform?.()) return;
    const d = document.documentElement as any;
    try {
      const p = d.requestFullscreen?.();
      p?.then?.(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
    } catch {
      /* refusé : on reste en fenêtre */
    }
  }

  /** Affiche les bons boutons selon le contexte (à appeler à chaque image). */
  update() {
    const g = this.ctx.game();
    const b = this.ctx.build();
    const overlay = !!document.querySelector('.modal-back, #tablet, #cams');
    const on = !!g && this.ctx.playing() && !overlay;
    this.root.style.display = on ? '' : 'none';
    if (!on || !g) {
      if (this.stickId !== null && g) g.player.input.moveX = g.player.input.moveY = 0;
      this.stickId = null;
      this.base.classList.remove('on');
      return;
    }
    const m = g.player.mode;
    document.body.classList.toggle('building', !!b?.active);
    this.play.style.display = m === 'walk' && !b?.active ? '' : 'none';
    this.cashier.style.display = m === 'cashier' ? '' : 'none';
    this.buildBtns.style.display = b?.active ? '' : 'none';
    this.throwBtn.style.display = g.player.held ? '' : 'none';
  }
}
