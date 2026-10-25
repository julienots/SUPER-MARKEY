/**
 * Mur d'écrans de surveillance : chaque caméra installée est rendue en direct depuis sa vraie position
 * (rendu 3D dans des fenêtres du canvas principal via viewport/scissor, sans copie de pixels).
 */
import * as THREE from 'three';
import { h } from './dom';
import { cameraViews, CAM_HEIGHT, CAM_FOV } from '../sim/security';
import { fmtClock } from '../core/time';
import type { Game } from '../game/game';

export class CameraFeeds {
  el: HTMLElement | null = null;
  private feeds: { el: HTMLElement; cam: THREE.PerspectiveCamera; uid: number }[] = [];
  private clockEls: HTMLElement[] = [];
  onClose: (() => void) | null = null;

  constructor(private game: Game) {}

  get open() {
    return !!this.el;
  }

  toggle() {
    if (this.el) this.close();
    else this.show();
  }

  show() {
    const views = cameraViews(this.game.st);
    const grid = h('div', { class: 'grid' });
    this.feeds = [];
    this.clockEls = [];
    views.forEach((v, i) => {
      const cam = new THREE.PerspectiveCamera((CAM_FOV * 180) / Math.PI * 0.75, 16 / 10, 0.1, 60);
      cam.position.set(v.x, CAM_HEIGHT, v.z);
      cam.lookAt(v.x + Math.sin(v.dir) * 6, 0.6, v.z + Math.cos(v.dir) * 6);
      const clk = h('span');
      this.clockEls.push(clk);
      const feed = h('div', { class: 'feed' }, h('div', { class: 'lbl' }, `CAM ${String(i + 1).padStart(2, '0')} · `, clk), h('div', { class: 'rec' }, '● REC'));
      feed.style.background = 'transparent';
      feed.style.boxShadow = 'inset 0 0 0 2px rgba(159,255,159,0.25)';
      grid.append(feed);
      this.feeds.push({ el: feed, cam, uid: v.uid });
    });
    const monitor = this.game.staff.present('securite').find((a) => a.state === 'monitor');
    this.el = h(
      'div',
      { id: 'cams', class: 'panel', style: { background: 'rgba(5,10,5,0.55)' } },
      h('div', { class: 'row between', style: { marginBottom: '8px' } }, h('b', null, `📹 Surveillance — ${views.length} caméra(s)${monitor ? ` · poste tenu par ${monitor.emp.name}` : ' · personne au poste vidéo'}`), h('button', { class: 'btn small', onclick: () => this.close() }, '✕ Fermer')),
      views.length ? grid : h('div', { class: 'empty' }, 'Aucune caméra installée. Mode construction (B) → Sécurité → Caméra de surveillance.'),
    );
    document.getElementById('ui')!.append(this.el);
    this.game.player.input.exitLock();
  }

  close() {
    this.el?.remove();
    this.el = null;
    this.feeds = [];
    this.onClose?.();
  }

  /** Rend les flux dans leurs fenêtres (appelé après le rendu principal). */
  render(renderer: THREE.WebGLRenderer) {
    if (!this.el || !this.feeds.length) return;
    const canvas = renderer.domElement;
    const cr = canvas.getBoundingClientRect();
    const t = fmtClock(this.game.st.time % 1440);
    for (const c of this.clockEls) c.textContent = t;
    renderer.setScissorTest(true);
    const H = cr.height;
    for (const f of this.feeds) {
      const r = f.el.getBoundingClientRect();
      if (r.width < 4 || r.bottom < cr.top || r.top > cr.bottom) continue;
      const x = r.left - cr.left;
      const y = H - (r.bottom - cr.top);
      renderer.setViewport(x, y, r.width, r.height);
      renderer.setScissor(x, y, r.width, r.height);
      f.cam.aspect = r.width / r.height;
      f.cam.updateProjectionMatrix();
      renderer.render(this.game.scene, f.cam);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, cr.width, cr.height);
  }
}
