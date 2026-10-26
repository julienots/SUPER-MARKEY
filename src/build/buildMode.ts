/**
 * Mode construction : vue du dessus orbitale, catalogue compact, aperçu fantôme (vert = valide, rouge = refusé
 * avec la raison), rotation, déplacement, revente, planogramme automatique, édition de la façade,
 * carte de couverture des caméras (angles morts).
 */
import * as THREE from 'three';
import { CELL, EQUIPMENT, EQUIPMENT_BY_ID, EQUIP_CATEGORY_NAMES, type EquipCategory } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { money0, clamp } from '../core/math';
import { canPlace, moveEquipment, occupancy, placeEquipment, sellEquipment } from '../sim/build';
import { cellsOf, equipCenter, FACADE_SEG, footprint, GRID_D, GRID_W, GRID_X0, GRID_Z0, rotAngle, storeRect, WALL_H } from '../sim/layout';
import { coverageGrid } from '../sim/security';
import { autoAssign } from '../sim/newgame';
import { spend } from '../sim/economy';
import { buildEquipment } from '../world/equipmentMeshes';
import { h, clear } from '../ui/dom';
import type { PlacedEquip } from '../sim/state';
import type { Game } from '../game/game';
import type { AudioEngine } from '../audio/audio';

type Tool = { kind: 'place'; def: string } | { kind: 'select' } | { kind: 'move'; uid: number } | { kind: 'facade' };

export class BuildMode {
  active = false;
  private ui: HTMLElement | null = null;
  private help: HTMLElement | null = null;
  private tip: HTMLElement | null = null;
  private tool: Tool = { kind: 'select' };
  private cat: EquipCategory | 'facade' = 'rayon';
  private rot: 0 | 1 | 2 | 3 = 0;
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private target = new THREE.Vector3();
  private yaw = 0.0;
  private pitch = 1.05;
  private dist = 24;
  private mouse = new THREE.Vector2();
  private mouseIn = false;
  private cell: { gx: number; gz: number } | null = null;
  private selected: number | null = null;
  private selPanel: HTMLElement | null = null;
  private highlight: THREE.Mesh | null = null;
  private coverage: THREE.Mesh | null = null;
  private showCoverage = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private hidden: THREE.Object3D[] = [];
  private onKeyDown = (e: KeyboardEvent) => this.key(e);
  private onMove = (e: MouseEvent) => this.mousemove(e);
  private onDown = (e: MouseEvent) => this.mousedown(e);
  private onUp = () => (this.dragging = false);
  private onWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement).closest?.('#build-ui')) return;
    this.dist = clamp(this.dist * (e.deltaY > 0 ? 1.12 : 0.89), 6, 70);
  };
  private onCtx = (e: Event) => e.preventDefault();
  onExit: (() => void) | null = null;

  constructor(private game: Game, private audio: AudioEngine, private canvas: HTMLCanvasElement) {}

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    const g = this.game;
    this.active = true;
    g.player.setMode('build');
    g.player.input.exitLock();
    const r = storeRect(g.st.store.stage);
    this.target.set((r.x0 + r.x1) / 2, 0, r.z1 / 2);
    this.dist = Math.max(18, (r.x1 - r.x0) * 1.1);
    this.yaw = 0;
    this.pitch = 1.05;
    // vue en coupe : on retire toit, plafond et enseigne
    this.hidden = [];
    g.storeBuilding.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.position.y >= WALL_H - 1.2 && o.visible) {
        o.visible = false;
        this.hidden.push(o);
      }
    });
    this.buildUI();
    window.addEventListener('keydown', this.onKeyDown);
    this.canvas.addEventListener('mousemove', this.onMove);
    this.canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
    this.canvas.addEventListener('contextmenu', this.onCtx);
    this.canvas.addEventListener('mouseenter', () => (this.mouseIn = true));
    this.canvas.addEventListener('mouseleave', () => (this.mouseIn = false));
    this.mouseIn = true;
    this.audio.sfx('whoosh');
  }

  exit() {
    const g = this.game;
    this.active = false;
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.removeGhost();
    this.setCoverage(false);
    if (this.highlight) g.scene.remove(this.highlight);
    this.highlight = null;
    this.ui?.remove();
    this.help?.remove();
    this.tip?.remove();
    this.selPanel?.remove();
    this.ui = this.help = this.tip = this.selPanel = null;
    window.removeEventListener('keydown', this.onKeyDown);
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onCtx);
    g.player.setMode('walk');
    this.onExit?.();
  }

  // ------------------------------------------------------------ interface
  private buildUI() {
    const root = document.getElementById('ui')!;
    this.help = h('div', { id: 'build-help', class: 'panel' });
    this.tip = h('div', { id: 'build-tip', class: 'panel' });
    this.tip.style.display = 'none';
    this.ui = h('div', { id: 'build-ui', class: 'panel' });
    root.append(this.help, this.tip, this.ui);
    this.renderUI();
  }

  private renderUI() {
    if (!this.ui) return;
    clear(this.ui);
    const st = this.game.st;
    const cats = h('div', { class: 'cats' });
    cats.append(h('button', { class: `btn small ${this.tool.kind === 'select' ? 'active' : ''}`, onclick: () => this.setTool({ kind: 'select' }) }, '🖐️ Sélection'));
    for (const c of Object.keys(EQUIP_CATEGORY_NAMES) as EquipCategory[]) cats.append(h('button', { class: `btn small ${this.cat === c && this.tool.kind === 'place' ? 'active' : ''}`, onclick: () => { this.cat = c; this.renderUI(); } }, EQUIP_CATEGORY_NAMES[c]));
    cats.append(h('button', { class: `btn small ${this.tool.kind === 'facade' ? 'active' : ''}`, onclick: () => this.setTool({ kind: 'facade' }) }, '🏪 Façade'));
    cats.append(h('button', { class: `btn small ${this.showCoverage ? 'active' : ''}`, onclick: () => this.setCoverage(!this.showCoverage) }, '📹 Angles morts'));
    cats.append(h('span', { style: { flex: '1' } }), h('button', { class: 'btn small primary', onclick: () => this.exit() }, '✔ Terminer (B)'));
    const items = h('div', { class: 'items' });
    if (this.tool.kind !== 'facade')
      for (const d of EQUIPMENT.filter((e) => e.category === this.cat)) {
        const locked = (d.stage ?? 0) > st.store.stage;
        const on = this.tool.kind === 'place' && this.tool.def === d.id;
        items.append(
          h('button', { class: `item ${on ? 'on' : ''} ${locked ? 'locked' : ''}`, title: d.desc, onclick: () => !locked && this.setTool({ kind: 'place', def: d.id }) }, h('div', { class: 'n' }, d.name), h('div', { class: 'p' }, money0(d.price)), h('div', { class: 'small muted' }, locked ? `🔒 palier ${d.stage}` : `${((d.w * CELL) as number).toFixed(1)}×${(d.d * CELL).toFixed(1)} m`)),
        );
      }
    else items.append(h('div', { class: 'small muted', style: { padding: '8px' } }, 'Cliquez sur un segment de la façade (le long du mur avant) pour alterner Mur → Vitrine → Porte. 300 € par modification. Il faut au moins une porte.'));
    this.ui.append(cats, items);
    this.updateHelp();
  }

  private updateHelp() {
    if (!this.help) return;
    const t = this.tool;
    if (this.game.player.input.touch) {
      const tb = 'Glisser : tourner · Pincer : zoom · Joystick : déplacer la vue';
      this.help.textContent = t.kind === 'place' ? `${EQUIPMENT_BY_ID[t.def].name} — Touchez pour l'aperçu, retouchez pour poser · ⟳ pivoter` : t.kind === 'move' ? 'Déplacement — Touchez pour l’aperçu, retouchez pour poser · ⟳ pivoter' : t.kind === 'facade' ? `Façade — Touchez un segment — ${tb}` : `Sélection — Touchez un équipement · ${tb}`;
      return;
    }
    const base = 'Clic droit + glisser : tourner · Molette : zoom · ZQSD/WASD : déplacer la vue';
    this.help.textContent = t.kind === 'place' ? `${EQUIPMENT_BY_ID[t.def].name} — Clic : poser · R : pivoter · Échap : annuler — ${base}` : t.kind === 'move' ? `Déplacement — Clic : poser · R : pivoter · Échap : annuler` : t.kind === 'facade' ? `Façade — Clic sur un segment pour le modifier — ${base}` : `Sélection — Cliquez sur un équipement · ${base}`;
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.removeGhost();
    if (t.kind !== 'select') this.deselect();
    this.renderUI();
    this.audio.sfx('ui');
  }

  // ------------------------------------------------------------ entrées
  private key(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'KeyR') {
      this.rot = ((this.rot + 1) % 4) as 0 | 1 | 2 | 3;
      this.audio.sfx('ui');
    } else if (e.code === 'Escape') {
      if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
      else this.exit();
      e.stopPropagation();
    } else if (e.code === this.game.settings.keys.construction) this.exit();
    else if (e.code === 'Delete' && this.selected !== null) this.sellSelected();
  }

  // ------------------------------------------------------------ tactile
  private lastTap = '';

  /** Glisser au doigt : orbite autour du magasin. */
  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.004, 0.35, 1.45);
  }

  zoom(f: number) {
    this.dist = clamp(this.dist * f, 6, 70);
  }

  rotate() {
    this.rot = ((this.rot + 1) % 4) as 0 | 1 | 2 | 3;
    this.audio.sfx('ui');
  }

  /** Tape au doigt : pour poser/déplacer, un 1er tap montre l'aperçu, un 2e au même endroit valide. */
  tap(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.mouseIn = true;
    if (this.tip) {
      this.tip.style.left = `${clientX}px`;
      this.tip.style.top = `${clientY}px`;
    }
    const p = this.groundPoint();
    if (!p) return;
    this.cell = { gx: Math.floor((p.x - GRID_X0) / CELL), gz: Math.floor((p.z - GRID_Z0) / CELL) };
    const key = `${this.cell.gx},${this.cell.gz}`;
    if ((this.tool.kind === 'place' || this.tool.kind === 'move') && key !== this.lastTap) {
      this.lastTap = key;
      return;
    }
    this.lastTap = '';
    this.mousedown({ button: 0, clientX, clientY } as MouseEvent);
  }

  private mousemove(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (this.dragging) {
      this.yaw -= (e.clientX - this.lastX) * 0.006;
      this.pitch = clamp(this.pitch + (e.clientY - this.lastY) * 0.004, 0.35, 1.45);
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.tip) {
      this.tip.style.left = `${e.clientX}px`;
      this.tip.style.top = `${e.clientY}px`;
    }
  }

  private mousedown(e: MouseEvent) {
    if (e.button === 2) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.tool.kind === 'place' || this.tool.kind === 'move') this.setTool({ kind: 'select' });
      return;
    }
    if (e.button !== 0) return;
    const g = this.game;
    const st = g.st;
    const t = this.tool;
    const p = this.groundPoint();
    if (!p) return;
    if (t.kind === 'facade') return this.clickFacade(p.x, p.z);
    if (!this.cell) return;
    if (t.kind === 'place') {
      const pos = this.anchor(t.def);
      const res = placeEquipment(st, t.def, pos.gx, pos.gz, this.rot);
      if (res.ok && res.e) {
        // remplit automatiquement le planogramme avec l'assortiment compatible
        if (res.e.slots) autoAssign(res.e, this.suggestProducts(res.e));
        g.layoutChanged();
        this.audio.sfx('thud');
        g.bus.emit('notify', { text: `${EQUIPMENT_BY_ID[t.def].name} installé (−${money0(EQUIPMENT_BY_ID[t.def].price)}).`, kind: 'info', quiet: true });
        this.ghostKey = '';
      } else {
        this.audio.sfx('error');
        g.bus.emit('notify', { text: `❌ ${res.reason}`, kind: 'bad' });
      }
    } else if (t.kind === 'move') {
      const e2 = st.equipment.find((x) => x.uid === t.uid);
      if (!e2) return this.setTool({ kind: 'select' });
      const pos = this.anchor(e2.def);
      const res = moveEquipment(st, t.uid, pos.gx, pos.gz, this.rot);
      if (res.ok) {
        g.layoutChanged();
        this.audio.sfx('thud');
        this.setTool({ kind: 'select' });
        this.select(t.uid);
      } else {
        this.audio.sfx('error');
        g.bus.emit('notify', { text: `❌ ${res.reason}`, kind: 'bad' });
      }
    } else {
      const occ = occupancy(st);
      const i = this.cell.gz * GRID_W + this.cell.gx;
      const uid = this.cell.gx >= 0 && this.cell.gz >= 0 && this.cell.gx < GRID_W && this.cell.gz < GRID_D ? occ.floor[i] || occ.ceil[i] || occ.wall[i] : 0;
      if (uid) this.select(uid);
      else this.deselect();
    }
  }

  /** Produits de l'assortiment qui conviennent à ce meuble (froid/ambiant, catégories). */
  private suggestProducts(e: PlacedEquip): string[] {
    const sh = EQUIPMENT_BY_ID[e.def].shelf!;
    const used = new Set<string>();
    for (const x of this.game.st.equipment) x.slots?.forEach((s) => s.pid && used.add(s.pid));
    const ok = this.game.st.assortment.filter((pid) => {
      const p = PRODUCT_BY_ID[pid];
      return p.storage === sh.storage && (!sh.categories || sh.categories.includes(p.category));
    });
    // priorité aux produits pas encore en rayon
    return [...ok.filter((p) => !used.has(p)), ...ok.filter((p) => used.has(p))];
  }

  private anchor(def: string) {
    const f = footprint(EQUIPMENT_BY_ID[def], this.rot);
    return { gx: this.cell!.gx - Math.floor((f.w - 1) / 2), gz: this.cell!.gz - Math.floor((f.d - 1) / 2) };
  }

  private clickFacade(x: number, z: number) {
    const st = this.game.st;
    const r = storeRect(st.store.stage);
    if (z < -2 || z > 1.2 || x < r.x0 || x > r.x1) return;
    const i = Math.floor((x - r.x0) / FACADE_SEG);
    const cur = st.store.facade[i];
    const next = cur === 'mur' ? 'vitrine' : cur === 'vitrine' ? 'porte' : 'mur';
    if (cur === 'porte' && st.store.facade.filter((f) => f === 'porte').length <= 1) {
      this.game.bus.emit('notify', { text: 'Il faut garder au moins une porte d’entrée.', kind: 'bad' });
      return;
    }
    if (st.cash < 300) return void this.game.bus.emit('notify', { text: 'Trésorerie insuffisante (300 €).', kind: 'bad' });
    const old = [...st.store.facade];
    st.store.facade[i] = next;
    // une porte ne doit pas être bloquée par un meuble
    const blocked = st.equipment.some((e) => {
      const d = EQUIPMENT_BY_ID[e.def];
      if (d.mount !== 'floor' || d.passable) return false;
      return cellsOf(e).some(([gx, gz]) => {
        const cx = GRID_X0 + (gx + 0.5) * CELL;
        const cz = GRID_Z0 + (gz + 0.5) * CELL;
        return next === 'porte' && cz < 1.6 && Math.abs(cx - (r.x0 + i * FACADE_SEG + FACADE_SEG / 2)) < 1.2;
      });
    });
    if (blocked) {
      st.store.facade = old;
      this.game.bus.emit('notify', { text: 'Un meuble bloque l’emplacement de cette porte.', kind: 'bad' });
      return;
    }
    spend(st, 'travaux', 300);
    this.game.rebuildStore();
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.game.storeBuilding.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.position.y >= WALL_H - 1.2) {
        o.visible = false;
        this.hidden.push(o);
      }
    });
    this.audio.sfx('thud');
  }

  private select(uid: number) {
    this.selected = uid;
    const st = this.game.st;
    const e = st.equipment.find((x) => x.uid === uid);
    if (!e) return;
    const d = EQUIPMENT_BY_ID[e.def];
    this.selPanel?.remove();
    const products = e.slots ? [...new Set(e.slots.filter((s) => s.pid).map((s) => PRODUCT_BY_ID[s.pid!].name))] : [];
    this.selPanel = h(
      'div',
      { class: 'panel', style: { position: 'fixed', right: '12px', top: '64px', width: '280px', padding: '12px' } },
      h('div', { style: { fontWeight: '800' } }, d.name),
      h('div', { class: 'small muted' }, d.desc),
      e.broken ? h('div', { class: 'small bad' }, '⚠️ En panne') : null,
      products.length ? h('div', { class: 'small', style: { margin: '6px 0' } }, `Produits : ${products.slice(0, 8).join(', ')}${products.length > 8 ? '…' : ''}`) : null,
      e.cartons ? h('div', { class: 'small' }, `${e.cartons.length}/${d.cartons} cartons`) : null,
      h(
        'div',
        { class: 'row wrap', style: { marginTop: '8px' } },
        h('button', { class: 'btn small', onclick: () => { this.rot = e.rot; this.setTool({ kind: 'move', uid }); } }, '✥ Déplacer'),
        h('button', { class: 'btn small', onclick: () => { const r = moveEquipment(st, uid, e.gx, e.gz, ((e.rot + 1) % 4) as 0 | 1 | 2 | 3); if (r.ok) this.game.layoutChanged(); else this.game.bus.emit('notify', { text: `❌ ${r.reason}`, kind: 'bad' }); } }, '⟳ Pivoter'),
        e.slots ? h('button', { class: 'btn small', onclick: () => { const n = autoAssign(e, this.suggestProducts(e)); this.game.layoutChanged(); this.game.bus.emit('notify', { text: `${n} facing(s) assigné(s).`, kind: 'info' }); } }, '🪄 Planogramme auto') : null,
        h('button', { class: 'btn small danger', onclick: () => this.sellSelected() }, `Vendre (+${money0(Math.round(d.price * 0.5 * (1 - e.wear * 0.5)))})`),
      ),
    );
    document.getElementById('ui')!.append(this.selPanel);
    // surbrillance
    if (this.highlight) this.game.scene.remove(this.highlight);
    const f = footprint(d, e.rot);
    this.highlight = new THREE.Mesh(new THREE.PlaneGeometry(f.w * CELL + 0.1, f.d * CELL + 0.1), new THREE.MeshBasicMaterial({ color: 0xffc72c, transparent: true, opacity: 0.35, depthWrite: false }));
    this.highlight.rotation.x = -Math.PI / 2;
    const c = equipCenter(e);
    this.highlight.position.set(c.x, 0.05, c.z);
    this.game.scene.add(this.highlight);
  }

  private deselect() {
    this.selected = null;
    this.selPanel?.remove();
    this.selPanel = null;
    if (this.highlight) this.game.scene.remove(this.highlight);
    this.highlight = null;
  }

  private sellSelected() {
    if (this.selected === null) return;
    const r = sellEquipment(this.game.st, this.selected);
    if (r.ok) {
      this.game.layoutChanged();
      this.game.items.rebuildFromState();
      this.game.bus.emit('notify', { text: `Équipement revendu (+${money0(r.refund)}).${r.returned ? ` ${r.returned} article(s) remis en cartons au quai.` : ''}`, kind: 'info' });
      this.audio.sfx('cash');
    }
    this.deselect();
  }

  // ------------------------------------------------------------ couverture caméras
  setCoverage(on: boolean) {
    this.showCoverage = on;
    if (this.coverage) {
      this.game.scene.remove(this.coverage);
      (this.coverage.material as THREE.MeshBasicMaterial).map?.dispose();
      this.coverage = null;
    }
    if (on) {
      const cov = coverageGrid(this.game.st);
      const c = document.createElement('canvas');
      c.width = GRID_W;
      c.height = GRID_D;
      const x = c.getContext('2d')!;
      const r = storeRect(this.game.st.store.stage);
      for (let gz = 0; gz < GRID_D; gz++)
        for (let gx = 0; gx < GRID_W; gx++) {
          const wx = GRID_X0 + (gx + 0.5) * CELL;
          const wz = GRID_Z0 + (gz + 0.5) * CELL;
          if (wx < r.x0 || wx > r.x1 || wz > r.z1) continue;
          const n = cov.grid[gz * GRID_W + gx];
          x.fillStyle = n ? `rgba(46,204,113,${Math.min(0.75, 0.35 + n * 0.15)})` : 'rgba(255,60,40,0.55)';
          x.fillRect(gx, gz, 1, 1);
        }
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter;
      this.coverage = new THREE.Mesh(new THREE.PlaneGeometry(GRID_W * CELL, GRID_D * CELL), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      this.coverage.rotation.x = -Math.PI / 2;
      this.coverage.position.set(GRID_X0 + (GRID_W * CELL) / 2, 0.06, GRID_Z0 + (GRID_D * CELL) / 2);
      this.coverage.renderOrder = 3;
      this.game.scene.add(this.coverage);
      this.game.bus.emit('notify', { text: `📹 Couverture : ${cov.total ? Math.round((cov.covered / cov.total) * 100) : 0} % de la surface (rouge = angle mort).`, kind: 'info' });
    }
    this.renderUI();
  }

  // ------------------------------------------------------------ fantôme
  private removeGhost() {
    if (this.ghost) this.game.scene.remove(this.ghost);
    this.ghost = null;
    this.ghostKey = '';
    if (this.tip) this.tip.style.display = 'none';
  }

  private groundPoint(): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.mouse, this.game.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  update(dt: number) {
    if (!this.active) return;
    const g = this.game;
    const inp = g.player.input;
    // déplacement de la vue (clavier)
    const sp = this.dist * 0.9 * dt;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    if (inp.down('avancer')) this.target.addScaledVector(fwd, -sp);
    if (inp.down('reculer')) this.target.addScaledVector(fwd, sp);
    if (inp.down('gauche')) this.target.addScaledVector(right, -sp);
    if (inp.down('droite')) this.target.addScaledVector(right, sp);
    if (inp.moveX || inp.moveY) {
      this.target.addScaledVector(fwd, -sp * inp.moveY);
      this.target.addScaledVector(right, sp * inp.moveX);
    }
    this.target.x = clamp(this.target.x, -40, 60);
    this.target.z = clamp(this.target.z, -30, 50);
    const cam = g.camera;
    cam.position.set(this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    cam.lookAt(this.target);
    inp.endFrame();
    // cellule sous la souris
    const p = this.mouseIn ? this.groundPoint() : null;
    this.cell = p ? { gx: Math.floor((p.x - GRID_X0) / CELL), gz: Math.floor((p.z - GRID_Z0) / CELL) } : null;
    const t = this.tool;
    const defId = t.kind === 'place' ? t.def : t.kind === 'move' ? g.st.equipment.find((x) => x.uid === t.uid)?.def : undefined;
    if (!defId || !this.cell) {
      if (this.ghost) this.ghost.visible = false;
      if (this.tip) this.tip.style.display = 'none';
      return;
    }
    const pos = this.anchor(defId);
    const chk = canPlace(g.st, defId, pos.gx, pos.gz, this.rot, t.kind === 'move' ? t.uid : -1);
    const key = `${defId}:${this.rot}:${chk.ok}`;
    if (key !== this.ghostKey) {
      if (this.ghost) g.scene.remove(this.ghost);
      const v = buildEquipment({ uid: -1, def: defId, gx: pos.gx, gz: pos.gz, rot: this.rot, wear: 0 }, g.equipView.style(g.st));
      const gm = new THREE.MeshBasicMaterial({ color: chk.ok ? 0x2ecc71 : 0xff4030, transparent: true, opacity: 0.5, depthWrite: false });
      v.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = gm;
      });
      this.ghost = v.root;
      g.scene.add(this.ghost);
      this.ghostKey = key;
    }
    const e = { def: defId, gx: pos.gx, gz: pos.gz, rot: this.rot };
    const c = equipCenter(e);
    this.ghost!.visible = true;
    this.ghost!.position.set(c.x, 0.01, c.z);
    this.ghost!.rotation.y = rotAngle(this.rot);
    if (this.tip) {
      const price = t.kind === 'place' ? ` · ${money0(EQUIPMENT_BY_ID[defId].price)}` : '';
      this.tip.textContent = chk.ok ? `✔ ${EQUIPMENT_BY_ID[defId].name}${price}` : `✖ ${chk.reason}`;
      this.tip.style.display = '';
      this.tip.style.borderColor = chk.ok ? '#2ecc71' : '#ff5c4d';
    }
  }
}
