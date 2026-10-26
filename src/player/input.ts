/** Entrées clavier/souris avec actions reconfigurables et verrouillage du pointeur. */
import type { Settings } from '../game/settings';

export class Input {
  private keys = new Set<string>();
  private edges = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseDown = [false, false, false];
  mouseClicked = [false, false, false];
  locked = false;
  enabled = true;
  /** Contrôles tactiles actifs (pas de verrouillage du pointeur, vue au doigt). */
  touch = false;
  /** Joystick virtuel : x à droite, y en avant (−1…1). */
  moveX = 0;
  moveY = 0;
  /** Bloque les touches quand un champ texte a le focus. */
  private typing = () => {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  };

  constructor(private settings: Settings, private target?: HTMLElement) {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (this.typing()) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      this.mouseDown[e.button] = true;
      this.mouseClicked[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => (this.mouseDown[e.button] = false));
    window.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === this.target));
  }

  requestLock() {
    if (this.touch) return;
    if (this.target && !this.locked) {
      try {
        const p = this.target.requestPointerLock() as any;
        if (p?.catch) p.catch(() => {});
      } catch {
        /* navigateur sans pointer lock */
      }
    }
  }

  exitLock() {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock();
  }

  code(action: string) {
    return this.settings.keys[action] ?? action;
  }

  down(action: string) {
    return this.enabled && this.keys.has(this.code(action));
  }

  pressed(action: string) {
    return this.enabled && this.edges.has(this.code(action));
  }

  releasedAction(action: string) {
    return this.released.has(this.code(action));
  }

  rawPressed(code: string) {
    return this.edges.has(code);
  }

  /** La vue suit-elle les déplacements souris/doigt ? */
  get looking() {
    return this.locked || this.touch;
  }

  /** Simule une touche (tests automatisés, boutons tactiles). */
  inject(action: string, down: boolean) {
    const c = this.code(action);
    if (down) {
      if (!this.keys.has(c)) this.edges.add(c);
      this.keys.add(c);
    } else if (this.keys.delete(c)) this.released.add(c);
  }

  endFrame() {
    this.edges.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.mouseClicked = [false, false, false];
  }
}
