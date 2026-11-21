/**
 * Interface en jeu : barre du haut (argent, étoiles, heure, vitesse, niveau), 4 gros boutons en bas
 * (Commander, Construire, Équipe, Menu), panneau du meuble touché, écrans en feuille glissante,
 * notifications, fin de journée et niveau supérieur.
 */
import { CATEGORIES, CATEGORY_BY_ID, PRODUCT_BY_ID, PRODUCTS, type CategoryId } from '../data/products';
import { CAT_LEVEL, FURN_BY_ID, FURNITURE, LEVEL_XP, MAX_LEVEL, ROLES, STORE_SIZES, type FurnDef, type Role } from '../data/furniture';
import { canPlace, dims, storeSize } from '../sim/grid';
import { cartonsUsed, compatible, maxStaff, rent, reserveCapacity, shelfCap, stars, OPEN_MIN, CLOSE_MIN } from '../sim/sim';
import type { DayStats, Furn, Fx, World } from '../sim/types';
import type { Session } from '../session';
import type { View } from '../render/view';
import type { Controls } from '../render/controls';
import type { Audio } from '../audio';
import { thumb } from '../render/thumbs';
import { clock, euro, h, prodIcon, uiIcon } from './dom';

interface BuildState {
  def: string;
  x: number;
  z: number;
  rot: number;
  moveId: number | null;
  placed: boolean;
}

export class Hud {
  root: HTMLElement;
  private top: HTMLElement;
  private bottom: HTMLElement;
  private toasts: HTMLElement;
  private sheet: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private buildBar: HTMLElement | null = null;
  private selected: number | null = null;
  private build: BuildState | null = null;
  private els: Record<string, HTMLElement> = {};
  private refreshT = 0;
  private panelRev = -1;
  private sheetRev = -1;
  private sheetRender: (() => void) | null = null;
  private cart: Record<string, number> = {};
  private orderCat: CategoryId = 'boissons';
  private buildTab: 'rayons' | 'caisses' | 'deco' | 'agrandir' = 'rayons';
  private tipStep = 0;
  private tipT = 4;
  onMenu: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private s: Session,
    private view: View,
    private controls: Controls,
    private audio: Audio,
    private tutorial: boolean,
  ) {
    this.root = h('div', { class: 'hud' });
    parent.append(this.root);
    this.top = this.makeTop();
    this.bottom = this.makeBottom();
    this.toasts = h('div', { class: 'toasts' });
    const side = h(
      'div',
      { class: 'side' },
      h('button', { class: 'round', title: 'Zoom +', onclick: () => this.controls.zoom(1 / 1.25) }, '＋'),
      h('button', { class: 'round', title: 'Zoom −', onclick: () => this.controls.zoom(1.25) }, '－'),
      h('button', { class: 'round', title: 'Tourner la vue', onclick: () => this.controls.rotate(1) }, '⟳'),
      h('button', { class: 'round', title: 'Recentrer', onclick: () => this.recenter() }, '⌖'),
    );
    this.root.append(this.top, this.toasts, side, this.bottom);
    controls.onTap = (x, y) => this.tap(x, y);
    this.refresh();
    if (!tutorial) this.tipStep = 99;
  }

  get w(): World {
    return this.s.world;
  }

  recenter() {
    const sz = storeSize(this.w);
    this.view.cam.x = sz.w / 2;
    this.view.cam.z = -sz.d / 2 + 1;
    this.view.cam.size = Math.max(14, Math.min(30, Math.max(sz.w, sz.d) * 1.55)) * (innerHeight > innerWidth ? 1.25 : 1);
    this.controls.bounds = { x0: -8, x1: sz.w + 8, z0: -sz.d - 6, z1: 12 };
  }

  // ------------------------------------------------------------------ barres
  private makeTop() {
    const e = this.els;
    e.money = h('b');
    e.stars = h('span', { class: 'stars' });
    e.time = h('b');
    e.day = h('small');
    e.open = h('span', { class: 'pill-tag' });
    e.lvl = h('b');
    e.xpbar = h('i');
    e.duo = h('button', { class: 'pill duo', onclick: () => this.openMenu(true) });
    const speeds = h('div', { class: 'speeds' });
    for (const [v, t] of [
      [0, '❚❚'],
      [1, '▶'],
      [2, '▶▶'],
      [3, '▶▶▶'],
    ] as const) {
      const b = h('button', { 'data-v': v, onclick: () => this.s.act({ t: 'speed', v }) }, t);
      speeds.append(b);
    }
    e.speeds = speeds;
    return h(
      'div',
      { class: 'top' },
      h('div', { class: 'pill money' }, uiIcon('coin'), e.money),
      h('div', { class: 'pill clock' }, h('div', { class: 'col' }, e.time, e.day), e.open),
      speeds,
      h('div', { class: 'pill level', title: 'Niveau' }, uiIcon('star'), e.lvl, h('span', { class: 'xp' }, e.xpbar)),
      h('div', { class: 'pill rating' }, e.stars),
      e.duo,
    );
  }

  private makeBottom() {
    const btn = (icon: string, label: string, fn: () => void, id: string) => {
      const b = h('button', { class: 'big', 'data-id': id, onclick: () => (this.audio.sfx('click'), fn()) }, uiIcon(icon, 'big-ico'), h('span', null, label));
      return b;
    };
    return h(
      'div',
      { class: 'bottom' },
      btn('cart', 'Commander', () => this.openOrder(), 'order'),
      btn('build', 'Construire', () => this.openBuild(), 'build'),
      btn('team', 'Équipe', () => this.openTeam(), 'team'),
      btn('menu', 'Menu', () => this.openMenu(), 'menu'),
    );
  }

  private refresh() {
    const w = this.w;
    const e = this.els;
    e.money.textContent = euro(w.money);
    e.money.parentElement!.classList.toggle('neg', w.money < 0);
    const st = stars(w);
    e.stars.textContent = '★ ' + st.toFixed(1).replace('.', ',');
    e.time.textContent = clock(w.min);
    e.day.textContent = `Jour ${w.day}`;
    const open = w.min >= OPEN_MIN && w.min < CLOSE_MIN;
    e.open.textContent = open ? 'OUVERT' : 'FERMÉ';
    e.open.className = 'pill-tag ' + (open ? 'on' : 'off');
    e.lvl.textContent = String(w.level);
    const a = LEVEL_XP[w.level];
    const b = LEVEL_XP[Math.min(MAX_LEVEL, w.level + 1)];
    e.xpbar.style.width = w.level >= MAX_LEVEL ? '100%' : `${Math.max(0, Math.min(100, ((w.xp - a) / Math.max(1, b - a)) * 100))}%`;
    for (const b of e.speeds.children) (b as HTMLElement).classList.toggle('on', Number((b as HTMLElement).dataset.v) === w.speed);
    const others = this.s.partners;
    if (this.s.mode === 'solo') {
      e.duo.innerHTML = '';
      e.duo.append(uiIcon('team'), h('span', null, 'Inviter'));
    } else if (this.s.mode === 'host') {
      e.duo.innerHTML = '';
      e.duo.append(uiIcon('team'), h('span', null, others.length ? others.map((p) => p.name).join(', ') : 'Code ' + (this.s.host?.code ?? '')));
    } else {
      e.duo.innerHTML = '';
      e.duo.append(uiIcon('team'), h('span', null, 'Chez ' + (this.w.players.find((p) => p.id === 'host')?.name ?? 'l’hôte')));
    }
    e.duo.classList.toggle('live', others.length > 0);
  }

  // ------------------------------------------------------------------ boucle
  update(dt: number) {
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.25;
      this.refresh();
      if (this.panel && this.selected !== null && this.w.rev !== this.panelRev) this.renderPanel();
      if (this.sheet && this.sheetRender && this.w.rev !== this.sheetRev) {
        this.sheetRev = this.w.rev;
        this.sheetRender();
      }
    }
    if (this.build) {
      const b = this.build;
      const ok = canPlace(this.w, b.def, b.x, b.z, b.rot, b.moveId ?? -1).ok;
      this.view.setGhost(b.def, b.x, b.z, b.rot, ok);
      this.buildBar?.querySelector('.ok')?.toggleAttribute('disabled', !ok);
    }
    this.tips(dt);
  }

  private tips(dt: number) {
    if (this.tipStep >= 99 || this.s.mode === 'guest') return;
    this.tipT -= dt;
    if (this.tipT > 0) return;
    const T = [
      'Bienvenue ! Votre perso (anneau de couleur) encaisse et remplit les rayons tout seul.',
      'Touchez un rayon pour choisir son produit ou le remplir.',
      'Touchez 🛒 Commander pour acheter de la marchandise : une camionnette la livre.',
      'Touchez 🔨 Construire pour ajouter des rayons et de la déco.',
      'Envie de jouer à deux ? Menu → Jouer à deux, et donnez le code à votre ami.',
    ];
    if (this.tipStep < T.length) {
      this.toast(T[this.tipStep], 'info', 'sparkles', 7000);
      this.tipStep++;
      this.tipT = 14;
    } else this.tipStep = 99;
  }

  // ------------------------------------------------------------------ toucher dans le monde
  private tap(cx: number, cy: number) {
    const w = this.w;
    if (this.build) {
      const p = this.view.groundAt(cx, cy);
      if (!p) return;
      const def = FURN_BY_ID[this.build.def];
      const d = dims(def, this.build.rot);
      this.build.x = Math.round(p.x - d.w / 2);
      this.build.z = Math.round(p.z - d.d / 2);
      this.build.placed = true;
      this.audio.sfx('click');
      return;
    }
    const fid = this.view.pickFurn(cx, cy);
    if (fid !== null) {
      this.closeSheet();
      this.select(fid);
      this.audio.sfx('click');
      return;
    }
    // sol : on envoie son perso
    this.select(null);
    const p = this.view.groundAt(cx, cy);
    if (!p) return;
    const sz = storeSize(w);
    const inside = p.x >= 0 && p.x < sz.w && p.z >= -sz.d && p.z < 0;
    const outside = p.z >= 0 && p.z < 3 && p.x > -14 && p.x < 36;
    if (inside || outside) {
      this.s.act({ t: 'goto', x: p.x, z: p.z });
      this.view.showTap(p.x, p.z);
    }
  }

  select(id: number | null) {
    this.selected = id;
    const f = id !== null ? this.w.furn.find((g) => g.id === id) ?? null : null;
    this.view.setSelected(f);
    if (!f) {
      this.panel?.remove();
      this.panel = null;
      return;
    }
    this.renderPanel();
  }

  private renderPanel() {
    const f = this.w.furn.find((g) => g.id === this.selected);
    if (!f) return this.select(null);
    this.panelRev = this.w.rev;
    const def = FURN_BY_ID[f.def];
    const p = h('div', { class: 'panel' });
    const close = h('button', { class: 'x', onclick: () => this.select(null) }, '✕');
    const head = h('div', { class: 'panel-head' }, h('img', { src: thumb(def.id), class: 'thumb' }), h('div', { class: 'col' }, h('b', null, def.name)), close);
    p.append(head);
    const col = head.querySelector('.col')!;
    const actions = h('div', { class: 'actions' });
    if (def.kind === 'shelf') {
      const cap = shelfCap(def);
      if (f.product) {
        const pr = PRODUCT_BY_ID[f.product];
        col.append(h('span', { class: 'sub' }, pr.name, ' · ', euro(pr.price, true)));
        p.append(
          h(
            'div',
            { class: 'stockline' },
            prodIcon(f.product, 'pico'),
            h('div', { class: 'bar' }, h('i', { style: { width: `${(f.stock / cap) * 100}%` } })),
            h('span', null, `${f.stock}/${cap}`),
            h('small', null, `réserve : ${this.w.reserve[f.product] ?? 0}`),
          ),
        );
      } else col.append(h('span', { class: 'sub warn' }, 'Aucun produit : choisissez-en un !'));
      actions.append(
        this.actBtn('shop', 'Produit', () => this.pickProduct(f)),
        this.actBtn('box', 'Remplir', () => this.s.act({ t: 'fill', id: f.id }), !f.product),
      );
    } else if (def.kind === 'checkout') {
      const who = this.s.agents.find((a) => a.kind !== 'customer' && a.kind !== 'van' && this.isAtCheckout(a, f));
      col.append(h('span', { class: 'sub' }, def.self ? 'Fonctionne toute seule' : who ? `Tenue par ${who.tag}` : 'Personne à la caisse'));
      if (!def.self) actions.append(this.actBtn('cashier', 'J’y vais', () => this.s.act({ t: 'cash', id: f.id })));
    } else if (def.kind === 'storage') {
      col.append(h('span', { class: 'sub' }, `Réserve : ${cartonsUsed(this.w)}/${reserveCapacity(this.w)} cartons`));
    } else col.append(h('span', { class: 'sub' }, 'Décoration : attire les clients'));
    actions.append(
      this.actBtn('rotate', 'Tourner', () => this.s.act({ t: 'move', id: f.id, x: f.x, z: f.z, rot: f.rot + 1 })),
      this.actBtn('pin', 'Déplacer', () => this.startBuild(f.def, f.id)),
      this.actBtn('money', `Vendre +${euro(def.price / 2)}`, () => {
        this.s.act({ t: 'sell', id: f.id });
        this.select(null);
      }),
    );
    p.append(actions);
    this.panel?.remove();
    this.panel = p;
    this.root.append(p);
  }

  private isAtCheckout(a: { x: number; z: number }, f: Furn) {
    const def = FURN_BY_ID[f.def];
    const d = dims(def, f.rot);
    return a.x > f.x - 1.2 && a.x < f.x + d.w + 1.2 && a.z > f.z - 1.2 && a.z < f.z + d.d + 1.2;
  }

  private actBtn(icon: string, label: string, fn: () => void, disabled = false) {
    return h('button', { class: 'act', disabled, onclick: () => (this.audio.sfx('click'), fn()) }, uiIcon(icon), h('span', null, label));
  }

  private pickProduct(f: Furn) {
    const def = FURN_BY_ID[f.def];
    const list = PRODUCTS.filter((p) => compatible(def, p.id));
    this.openSheet('Produit du rayon', (body) => {
      const grid = h('div', { class: 'grid' });
      for (const p of list) {
        const locked = CAT_LEVEL[p.category] > this.w.level;
        const onShelves = this.w.furn.filter((g) => g.product === p.id).length;
        grid.append(
          h(
            'button',
            {
              class: 'card' + (f.product === p.id ? ' sel' : '') + (locked ? ' locked' : ''),
              disabled: locked,
              onclick: () => {
                this.s.act({ t: 'product', id: f.id, pid: p.id });
                this.closeSheet();
                this.select(f.id);
              },
            },
            prodIcon(p.id, 'cimg'),
            h('b', null, p.name),
            locked ? h('span', { class: 'lock' }, `🔒 niveau ${CAT_LEVEL[p.category]}`) : h('span', null, euro(p.price, true), ' · réserve ', String(this.w.reserve[p.id] ?? 0)),
            onShelves && !locked ? h('em', null, `déjà sur ${onShelves} rayon${onShelves > 1 ? 's' : ''}`) : null,
          ),
        );
      }
      body.append(grid);
    });
  }

  // ------------------------------------------------------------------ feuilles
  private openSheet(title: string, render: (body: HTMLElement) => void, footer?: () => HTMLElement) {
    this.closeSheet();
    this.select(null);
    const body = h('div', { class: 'sheet-body' });
    const foot = h('div', { class: 'sheet-foot' });
    const sheet = h('div', { class: 'sheet' }, h('div', { class: 'sheet-head' }, h('b', null, title), h('button', { class: 'x', onclick: () => this.closeSheet() }, '✕')), body, foot);
    const draw = () => {
      const st = body.scrollTop;
      body.innerHTML = '';
      render(body);
      body.scrollTop = st;
      foot.innerHTML = '';
      if (footer) foot.append(footer());
      foot.style.display = footer ? '' : 'none';
    };
    draw();
    this.sheet = sheet;
    this.sheetRender = draw;
    this.sheetRev = this.w.rev;
    this.root.append(sheet);
    this.bottom.classList.add('dim');
    this.audio.sfx('open');
  }

  closeSheet() {
    this.sheet?.remove();
    this.sheet = null;
    this.sheetRender = null;
    this.bottom.classList.remove('dim');
  }

  /** Bouton retour (Android / Échap). Renvoie true si quelque chose a été fermé. */
  back(): boolean {
    if (this.build) {
      this.endBuild();
      return true;
    }
    if (this.sheet) {
      this.closeSheet();
      return true;
    }
    if (this.panel) {
      this.select(null);
      return true;
    }
    return false;
  }

  private openOrder() {
    const cats = CATEGORIES.filter((c) => PRODUCTS.some((p) => p.category === c.id));
    if (CAT_LEVEL[this.orderCat] > this.w.level) this.orderCat = 'boissons';
    this.openSheet(
      'Commander',
      (body) => {
        const tabs = h('div', { class: 'tabs' });
        for (const c of cats) {
          const locked = CAT_LEVEL[c.id] > this.w.level;
          const first = PRODUCTS.find((p) => p.category === c.id)!;
          tabs.append(
            h(
              'button',
              { class: 'tab' + (c.id === this.orderCat ? ' on' : '') + (locked ? ' locked' : ''), title: c.name, onclick: () => ((this.orderCat = c.id), this.sheetRender?.()) },
              prodIcon(first.id),
              h('span', null, locked ? `🔒${CAT_LEVEL[c.id]}` : c.name.split(' ')[0]),
            ),
          );
        }
        body.append(tabs);
        const auto = h(
          'label',
          { class: 'toggle' },
          h('input', { type: 'checkbox', checked: this.w.autoOrder, onchange: (e: Event) => this.s.act({ t: 'autoOrder', on: (e.target as HTMLInputElement).checked }) }),
          h('span', null, '🔁 Réassort automatique des produits en rayon'),
        );
        body.append(auto);
        const locked = CAT_LEVEL[this.orderCat] > this.w.level;
        if (locked) {
          body.append(h('p', { class: 'center muted' }, `${CATEGORY_BY_ID[this.orderCat].name} : débloqué au niveau ${CAT_LEVEL[this.orderCat]}.`));
          return;
        }
        const grid = h('div', { class: 'grid' });
        for (const p of PRODUCTS.filter((q) => q.category === this.orderCat)) {
          const n = this.cart[p.id] ?? 0;
          const sold = this.w.furn.some((f) => f.product === p.id);
          grid.append(
            h(
              'div',
              { class: 'card' + (n ? ' sel' : '') },
              prodIcon(p.id, 'cimg'),
              h('b', null, p.name),
              h('span', null, `Carton de ${p.cartonQty} · ${euro(p.cost * p.cartonQty, true)}`),
              h('small', null, `vendu ${euro(p.price, true)} · réserve ${this.w.reserve[p.id] ?? 0}`, sold ? '' : ' · pas en rayon'),
              h(
                'div',
                { class: 'qty' },
                h('button', { onclick: () => ((this.cart[p.id] = Math.max(0, n - 1)), this.sheetRender?.()) }, '−'),
                h('b', null, String(n)),
                h('button', { onclick: () => ((this.cart[p.id] = Math.min(20, n + 1)), this.sheetRender?.()) }, '+'),
              ),
            ),
          );
        }
        body.append(grid);
      },
      () => {
        let cost = 0;
        let cartons = 0;
        for (const [pid, n] of Object.entries(this.cart)) {
          const p = PRODUCT_BY_ID[pid];
          cost += p.cost * p.cartonQty * n;
          cartons += n;
        }
        const room = reserveCapacity(this.w) - cartonsUsed(this.w);
        return h(
          'div',
          { class: 'foot-row' },
          h('div', { class: 'col' }, h('b', null, `Total : ${euro(cost, true)}`), h('small', { class: cartons > room ? 'warn' : '' }, `${cartons} carton${cartons > 1 ? 's' : ''} · place en réserve : ${Math.max(0, room)}`)),
          h(
            'button',
            {
              class: 'cta',
              disabled: !cartons || cartons > room || cost > this.w.money,
              onclick: () => {
                this.s.act({ t: 'order', items: { ...this.cart } });
                this.cart = {};
                this.closeSheet();
              },
            },
            uiIcon('truck'),
            ' Commander',
          ),
        );
      },
    );
  }

  private openBuild() {
    this.openSheet('Construire', (body) => {
      const tabs = h('div', { class: 'tabs' });
      for (const [id, label, icon] of [
        ['rayons', 'Rayons', 'shop'],
        ['caisses', 'Caisses & réserve', 'cashier'],
        ['deco', 'Déco', 'sparkles'],
        ['agrandir', 'Agrandir', 'home'],
      ] as const)
        tabs.append(h('button', { class: 'tab' + (this.buildTab === id ? ' on' : ''), onclick: () => ((this.buildTab = id), this.sheetRender?.()) }, uiIcon(icon), h('span', null, label)));
      body.append(tabs);
      if (this.buildTab === 'agrandir') {
        const cur = STORE_SIZES[this.w.sizeIdx];
        const next = STORE_SIZES[this.w.sizeIdx + 1];
        body.append(h('p', { class: 'center' }, `Taille actuelle : ${cur.w} × ${cur.d} m`));
        if (next) {
          const locked = next.level > this.w.level;
          body.append(
            h(
              'div',
              { class: 'center' },
              h(
                'button',
                { class: 'cta', disabled: locked || this.w.money < next.price, onclick: () => (this.s.act({ t: 'expand' }), this.closeSheet(), setTimeout(() => this.recenter(), 300)) },
                uiIcon('home'),
                locked ? ` Niveau ${next.level} requis` : ` Agrandir à ${next.w} × ${next.d} m · ${euro(next.price)}`,
              ),
            ),
          );
        } else body.append(h('p', { class: 'center muted' }, 'Le magasin est à sa taille maximale.'));
        return;
      }
      const kinds: Record<string, FurnDef['kind'][]> = { rayons: ['shelf'], caisses: ['checkout', 'storage'], deco: ['deco'] };
      const grid = h('div', { class: 'grid' });
      for (const def of FURNITURE.filter((d) => kinds[this.buildTab].includes(d.kind))) {
        const locked = def.level > this.w.level;
        const cats = def.shelf?.cats ? def.shelf.cats.map((c) => CATEGORY_BY_ID[c].name).join(', ') : def.shelf ? { ambient: 'Épicerie, boissons…', chilled: 'Produits frais', frozen: 'Surgelés' }[def.shelf.storage] : '';
        grid.append(
          h(
            'button',
            { class: 'card' + (locked ? ' locked' : ''), disabled: locked || this.w.money < def.price, onclick: () => this.startBuild(def.id, null) },
            h('img', { src: thumb(def.id), class: 'cimg' }),
            h('b', null, def.name),
            h('span', null, locked ? `🔒 niveau ${def.level}` : euro(def.price)),
            h('small', null, def.shelf ? `${cats} · ${shelfCap(def)} articles` : def.kind === 'storage' ? `+${def.cartons} cartons en réserve` : def.kind === 'checkout' ? (def.self ? 'Sans caissier' : 'Un caissier ou votre perso') : `Ambiance +${def.appeal}`),
          ),
        );
      }
      body.append(grid);
    });
  }

  private openTeam() {
    this.openSheet('Équipe', (body) => {
      const w = this.w;
      body.append(h('p', { class: 'muted center' }, `${w.staff.length}/${maxStaff(w)} employés · salaires payés le soir · loyer ${euro(rent(w))}/jour`));
      const hire = h('div', { class: 'grid two' });
      for (const [role, r] of Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][])
        hire.append(
          h(
            'button',
            { class: 'card', disabled: w.staff.length >= maxStaff(w), onclick: () => this.s.act({ t: 'hire', role }) },
            uiIcon(r.icon, 'cimg'),
            h('b', null, `Embaucher : ${r.name}`),
            h('span', null, `${euro(r.wage)} / jour`),
            h('small', null, r.desc),
          ),
        );
      body.append(hire);
      const list = h('div', { class: 'list' });
      for (const p of w.players)
        list.append(h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: '#' + p.color.toString(16).padStart(6, '0') } }), h('b', null, p.name), h('span', { class: 'muted' }, p.id === this.s.me ? 'vous' : 'joueur')));
      for (const st of w.staff)
        list.append(
          h(
            'div',
            { class: 'row' },
            uiIcon(ROLES[st.role].icon),
            h('b', null, st.name),
            h('span', { class: 'muted' }, ROLES[st.role].name),
            h('button', { class: 'small', onclick: () => this.s.act({ t: 'fire', id: st.id }) }, 'Renvoyer'),
          ),
        );
      body.append(list);
    });
  }

  openMenu(duo = false) {
    this.onMenu();
    void duo;
  }

  // ------------------------------------------------------------------ construction
  startBuild(defId: string, moveId: number | null) {
    this.closeSheet();
    const def = FURN_BY_ID[defId];
    const f = moveId !== null ? this.w.furn.find((g) => g.id === moveId) : null;
    this.select(null);
    let x = 0;
    let z = 0;
    let rot = 0;
    if (f) ({ x, z, rot } = f);
    else {
      // départ au centre de la vue
      const sz = storeSize(this.w);
      const d = dims(def, 0);
      x = Math.max(0, Math.min(sz.w - d.w, Math.round(this.view.cam.x - d.w / 2)));
      z = Math.max(-sz.d, Math.min(-d.d, Math.round(this.view.cam.z - d.d / 2)));
      // cherche une place libre proche
      for (let r = 0; r < 10 && !canPlace(this.w, defId, x, z, rot).ok; r++) {
        let found = false;
        for (let dx = -r; dx <= r && !found; dx++)
          for (let dz = -r; dz <= r && !found; dz++)
            for (const rr of [0, 1, 2, 3])
              if (canPlace(this.w, defId, x + dx, z + dz, rr).ok) {
                x += dx;
                z += dz;
                rot = rr;
                found = true;
                break;
              }
        if (found) break;
      }
    }
    this.build = { def: defId, x, z, rot, moveId, placed: false };
    this.bottom.classList.add('hidden');
    this.buildBar = h(
      'div',
      { class: 'buildbar' },
      h('div', { class: 'build-info' }, h('img', { src: thumb(defId), class: 'thumb' }), h('div', { class: 'col' }, h('b', null, def.name), h('small', null, moveId ? 'Touchez le sol pour le déplacer' : `${euro(def.price)} · touchez le sol pour le placer`))),
      h(
        'div',
        { class: 'actions' },
        this.actBtn('rotate', 'Tourner', () => {
          if (this.build) this.build.rot = (this.build.rot + 1) % 4;
        }),
        h('button', { class: 'act ok', onclick: () => this.confirmBuild() }, uiIcon('check'), h('span', null, 'Poser ici')),
        this.actBtn('x', 'Annuler', () => this.endBuild()),
      ),
    );
    this.root.append(this.buildBar);
  }

  private confirmBuild() {
    const b = this.build;
    if (!b) return;
    if (!canPlace(this.w, b.def, b.x, b.z, b.rot, b.moveId ?? -1).ok) return;
    if (b.moveId !== null) this.s.act({ t: 'move', id: b.moveId, x: b.x, z: b.z, rot: b.rot });
    else this.s.act({ t: 'build', def: b.def, x: b.x, z: b.z, rot: b.rot });
    this.endBuild();
  }

  endBuild() {
    this.build = null;
    this.view.setGhost(null);
    this.buildBar?.remove();
    this.buildBar = null;
    this.bottom.classList.remove('hidden');
  }

  get building() {
    return !!this.build;
  }

  // ------------------------------------------------------------------ événements
  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', icon?: string, ms = 4200) {
    // même message déjà affiché : on ne le répète pas
    const first = this.toasts.firstElementChild as HTMLElement | null;
    if (first && first.textContent === text && !first.classList.contains('out')) return;
    const el = h('div', { class: 'toast ' + kind });
    if (icon) {
      const [k, id] = icon.includes(':') ? icon.split(':') : ['ui', icon];
      el.append(k === 'p' ? prodIcon(id) : uiIcon(id));
    }
    el.append(h('span', null, text));
    this.toasts.prepend(el);
    while (this.toasts.children.length > 3) this.toasts.lastElementChild!.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, ms);
  }

  fx(f: Fx) {
    if (f.k === 'toast') {
      if (f.to && f.to !== this.s.me) return;
      this.toast(f.text, f.kind, f.icon);
    } else if (f.k === 'levelup') this.levelUp(f.level);
    else if (f.k === 'day') this.dayReport(f.stats, f.stars);
  }

  private card(content: HTMLElement[], ms: number) {
    const back = h('div', { class: 'cardwrap' });
    const c = h('div', { class: 'bigcard' }, ...content, h('button', { class: 'cta', onclick: () => back.remove() }, 'Super !'));
    back.append(c);
    back.addEventListener('pointerdown', (e) => e.target === back && back.remove());
    this.root.append(back);
    setTimeout(() => back.remove(), ms);
  }

  private levelUp(level: number) {
    this.audio.sfx('level');
    const cats = CATEGORIES.filter((c) => CAT_LEVEL[c.id] === level);
    const furn = FURNITURE.filter((f) => f.level === level);
    const next = STORE_SIZES.find((s) => s.level === level);
    this.card(
      [
        h('div', { class: 'burst' }, uiIcon('star', 'huge')),
        h('h2', null, `Niveau ${level} !`),
        h('p', null, `Prime de ${euro(100 * level)}`),
        h(
          'div',
          { class: 'unlocks' },
          ...cats.map((c) => h('div', { class: 'unlock' }, prodIcon(PRODUCTS.find((p) => p.category === c.id)!.id), h('span', null, c.name))),
          ...furn.map((f) => h('div', { class: 'unlock' }, h('img', { src: thumb(f.id), class: 'ico' }), h('span', null, f.name))),
          next ? h('div', { class: 'unlock' }, uiIcon('home'), h('span', null, 'Agrandissement')) : null,
        ),
      ],
      9000,
    );
  }

  private dayReport(s: DayStats, st: number) {
    const profit = s.revenue - s.purchases - s.wages - s.rent;
    this.card(
      [
        h('h2', null, `Fin du jour ${s.day}`),
        h('div', { class: 'stars-big' }, '★★★★★'.slice(0, Math.round(st)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(st))),
        h(
          'div',
          { class: 'report' },
          h('span', null, 'Clients servis'),
          h('b', null, `${s.served} / ${s.customers}`),
          h('span', null, 'Ventes'),
          h('b', { class: 'good' }, '+' + euro(s.revenue)),
          h('span', null, 'Marchandise'),
          h('b', null, '−' + euro(s.purchases)),
          h('span', null, 'Salaires + loyer'),
          h('b', null, '−' + euro(s.wages + s.rent)),
          h('span', null, 'Résultat'),
          h('b', { class: profit >= 0 ? 'good' : 'bad' }, (profit >= 0 ? '+' : '−') + euro(Math.abs(profit))),
        ),
        s.unhappy ? h('p', { class: 'muted' }, `${s.unhappy} client${s.unhappy > 1 ? 's' : ''} mécontent${s.unhappy > 1 ? 's' : ''} : rayons vides ou trop d’attente en caisse.`) : h('p', { class: 'muted' }, 'Tout le monde est reparti content. 😊'),
      ],
      14000,
    );
  }

  destroy() {
    this.root.remove();
    this.view.setGhost(null);
    this.view.setSelected(null);
  }
}
