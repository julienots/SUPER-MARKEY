/**
 * Écrans « jeu mobile » de la vue 2.5D : gros boutons, grandes images, peu de texte.
 * - Commander : la marchandise au carton, un panier, un livreur qui arrive après un délai.
 * - Construire : les meubles (vignettes des modèles Blender), débloqués par niveau.
 * - Équipe : employés, contrats CDI / CDD, annonces, candidats.
 * - Niveau supérieur : ce qui vient d'être débloqué.
 */
import { h, clear, modal } from '../ui/dom';
import { money, money0 } from '../core/math';
import { fmtClock } from '../core/time';
import { CATEGORIES, CATEGORY_BY_ID, PRODUCTS, PRODUCT_BY_ID, type CategoryId } from '../data/products';
import { CELL, EQUIPMENT_BY_ID, type EquipCategory, type EquipmentDef } from '../data/equipment';
import { ROLES, ROLE_BY_ID, type RoleId } from '../data/roles';
import { backroomUnits, shelfUnits } from '../sim/inventory';
import { basePrice } from '../sim/pricing';
import { cartonCost, placeSimpleOrder, simpleQuote, cancelOrder } from '../sim/orders';
import { catLevel, catUnlocked, equipLevel, equipUnlocked, equipmentCatalog, levelProgress } from '../sim/progress';
import { CDD_DURATIONS, CDI_TRIAL, fire, fireCost, hire, postJob, renewCdd, toCdi } from '../sim/staff';
import { dayOf } from '../sim/state';
import { productImage, uiIcon } from './art';
import { equipThumb } from './thumbs';
import type { Game } from '../game/game';
import type { AudioEngine } from '../audio/audio';

const img = (src: string, cls = '', size?: number) => h('img', { src, alt: '', class: cls, draggable: false, width: size, height: size });

/** Fenêtre plein écran (téléphone) / grande carte (PC) avec en-tête, contenu défilant et pied. */
class Sheet {
  root: HTMLElement;
  body = h('div', { class: 'm-body' });
  foot = h('div', { class: 'm-foot' });
  tabs = h('div', { class: 'm-tabs' });
  private titleEl = h('div', { class: 'm-title' });
  private subEl = h('div', { class: 'm-sub' });
  onClose: (() => void) | null = null;

  constructor(icon: string, title: string, cls = '') {
    this.root = h(
      'div',
      { class: `m-back ${cls}`, onpointerdown: (e: PointerEvent) => e.target === this.root && this.close() },
      h(
        'div',
        { class: 'm-sheet' },
        h('div', { class: 'm-head' }, img(uiIcon(icon), 'm-head-ico'), h('div', { class: 'm-head-txt' }, this.titleEl, this.subEl), h('button', { class: 'm-x', 'aria-label': 'Fermer', onclick: () => this.close() }, '✕')),
        this.tabs,
        this.body,
        this.foot,
      ),
    );
    this.titleEl.textContent = title;
    document.getElementById('ui')!.append(this.root);
  }

  set sub(t: string) {
    this.subEl.textContent = t;
  }

  close() {
    this.root.remove();
    this.onClose?.();
  }
}

// ==================================================================== COMMANDER
export class OrderScreen {
  private sheet: Sheet | null = null;
  private cat: CategoryId | 'panier' = 'epicerie';
  private cart = new Map<string, number>();

  constructor(private game: Game, private audio: AudioEngine) {}

  get open() {
    return !!this.sheet;
  }

  close() {
    this.sheet?.close();
  }

  show(pids?: string[]) {
    const st = this.game.st;
    if (pids?.length) for (const pid of pids) if (catUnlocked(st, PRODUCT_BY_ID[pid].category)) this.cart.set(pid, Math.max(1, this.cart.get(pid) ?? 0));
    if (pids?.length) this.cat = PRODUCT_BY_ID[pids[0]].category;
    if (!catUnlocked(st, this.cat as CategoryId) && this.cat !== 'panier') this.cat = CATEGORIES.find((c) => catUnlocked(st, c.id))!.id;
    if (!this.sheet) {
      this.sheet = new Sheet('cart', 'Commander', 'm-order');
      this.sheet.onClose = () => (this.sheet = null);
      this.audio.sfx('whoosh');
    }
    this.render();
  }

  render() {
    const s = this.sheet;
    if (!s) return;
    const g = this.game;
    const st = g.st;
    s.sub = `Caisse : ${money0(st.cash)}`;
    clear(s.tabs);
    clear(s.body);
    clear(s.foot);
    // familles de produits (images), les verrouillées à la fin
    const cats = [...CATEGORIES].sort((a, b) => catLevel(a.id) - catLevel(b.id));
    for (const c of cats) {
      const ok = catUnlocked(st, c.id);
      const first = PRODUCTS.find((p) => p.category === c.id && !p.seasonal) ?? PRODUCTS.find((p) => p.category === c.id)!;
      s.tabs.append(
        h(
          'button',
          { class: `m-tab ${this.cat === c.id ? 'on' : ''} ${ok ? '' : 'locked'}`, onclick: () => { if (!ok) { this.toast(`🔒 ${c.name} : disponible au niveau ${catLevel(c.id)}`); return; } this.cat = c.id; this.audio.sfx('ui'); this.render(); } },
          img(productImage(first.id), 'm-tab-img'),
          h('span', null, ok ? c.name.split(' ')[0] : `Niv ${catLevel(c.id)}`),
          ok ? null : img(uiIcon('lock'), 'm-lock'),
        ),
      );
    }
    // livraisons en cours
    const pending = st.orders.filter((o) => o.status === 'en_cours' || o.status === 'livraison');
    for (const o of pending) {
      const left = Math.max(0, Math.ceil(o.eta - st.time));
      s.body.append(
        h(
          'div',
          { class: 'm-delivery' },
          img(uiIcon('truck'), '', 40),
          h('div', { class: 'grow' }, h('b', null, o.status === 'livraison' ? 'Le livreur est en route vers la réserve !' : `Livraison dans ${left} min`), h('div', { class: 'small' }, `${o.lines.reduce((a, l) => a + l.cartons, 0)} carton(s) · arrivée vers ${fmtClock(o.eta % 1440)}`)),
          o.status === 'en_cours' && st.time - o.placedAt < 10 ? h('button', { class: 'm-btn small ghost', onclick: () => { cancelOrder(st, o.id); this.render(); } }, 'Annuler') : null,
        ),
      );
    }
    // produits de la famille
    const grid = h('div', { class: 'm-grid' });
    for (const p of PRODUCTS.filter((x) => x.category === this.cat && (!x.seasonal || st.assortment.includes(x.id)))) {
      const n = this.cart.get(p.id) ?? 0;
      const cost = cartonCost(st, p.id);
      const stock = backroomUnits(st, p.id);
      const shelf = shelfUnits(st, p.id);
      grid.append(
        h(
          'div',
          { class: `m-card prod ${n ? 'in' : ''}` },
          img(productImage(p.id), 'm-prod-img'),
          n ? h('div', { class: 'm-qty-badge' }, `×${n}`) : null,
          h('div', { class: 'm-name' }, p.name),
          h('div', { class: 'm-price' }, money(cost), h('small', null, ` / carton de ${p.cartonQty}`)),
          h('div', { class: 'm-meta' }, `Revente ${money(basePrice(st, p.id))} · 📦 ${stock} · 🏷️ ${shelf}`),
          h(
            'div',
            { class: 'm-step' },
            h('button', { class: 'm-btn small ghost', disabled: !n, onclick: () => this.set(p.id, n - 1) }, '−'),
            h('b', null, String(n)),
            h('button', { class: 'm-btn small', onclick: () => this.set(p.id, n + 1) }, '+'),
          ),
        ),
      );
    }
    s.body.append(grid);
    // panier
    const lines = [...this.cart].filter(([, n]) => n > 0).map(([pid, cartons]) => ({ pid, cartons }));
    const q = simpleQuote(st, lines);
    s.foot.append(
      h(
        'div',
        { class: 'm-cart' },
        h('div', { class: 'm-cart-imgs' }, ...lines.slice(0, 6).map((l) => img(productImage(l.pid), '', 34)), lines.length > 6 ? h('span', null, `+${lines.length - 6}`) : null),
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'm-total' }, q.cartons ? money(q.total) : 'Panier vide'),
          h('div', { class: 'small' }, q.cartons ? `${q.cartons} carton(s) · livraison ${q.fee ? money(q.fee) : 'offerte'} · 🚚 ~${q.delay} min` : 'Touchez + pour ajouter des cartons'),
        ),
        lines.length ? h('button', { class: 'm-btn small ghost', onclick: () => { this.cart.clear(); this.render(); } }, 'Vider') : null,
        h('button', { class: 'm-btn big green', disabled: !q.cartons || q.total > st.cash, onclick: () => this.order() }, q.total > st.cash ? 'Pas assez 💸' : 'Commander'),
      ),
    );
  }

  private set(pid: string, n: number) {
    if (n <= 0) this.cart.delete(pid);
    else this.cart.set(pid, Math.min(50, n));
    this.audio.sfx('ui');
    const y = this.sheet?.body.scrollTop ?? 0;
    this.render();
    if (this.sheet) this.sheet.body.scrollTop = y;
  }

  private order() {
    const g = this.game;
    const lines = [...this.cart].filter(([, n]) => n > 0).map(([pid, cartons]) => ({ pid, cartons }));
    const r = placeSimpleOrder(g.st, lines);
    if (!r.ok || !r.order) return this.toast(r.reason ?? 'Commande impossible.');
    this.cart.clear();
    this.audio.sfx('cash');
    g.bus.emit('notify', { text: `🚚 Commande passée ! Le livreur arrive vers ${fmtClock(r.order.eta % 1440)}.`, kind: 'good' });
    this.render();
  }

  private toast(t: string) {
    this.game.bus.emit('notify', { text: t, kind: 'info' });
    this.audio.sfx('error');
  }
}

// ==================================================================== CONSTRUIRE
const BUILD_TABS: { id: string; label: string; icon: string; cats: EquipCategory[] }[] = [
  { id: 'rayons', label: 'Rayons', icon: 'basket', cats: ['rayon'] },
  { id: 'froid', label: 'Froid', icon: 'fridge', cats: ['froid'] },
  { id: 'caisse', label: 'Caisse & réserve', icon: 'cashier', cats: ['caisse', 'reserve'] },
  { id: 'equipe', label: 'Équipe & sécurité', icon: 'shield', cats: ['personnel', 'securite'] },
  { id: 'deco', label: 'Déco & services', icon: 'sparkles', cats: ['deco', 'eclairage', 'service'] },
];

export class BuildScreen {
  private sheet: Sheet | null = null;
  private tab = 'rayons';

  constructor(private game: Game, private audio: AudioEngine, private cb: { place: (def: string) => void; arrange: () => void }) {}

  get open() {
    return !!this.sheet;
  }

  close() {
    this.sheet?.close();
  }

  show() {
    if (!this.sheet) {
      this.sheet = new Sheet('build', 'Construire', 'm-build');
      this.sheet.onClose = () => (this.sheet = null);
      this.audio.sfx('whoosh');
    }
    this.render();
  }

  private render() {
    const s = this.sheet;
    if (!s) return;
    const g = this.game;
    const st = g.st;
    s.sub = `Caisse : ${money0(st.cash)}`;
    clear(s.tabs);
    clear(s.body);
    clear(s.foot);
    for (const t of BUILD_TABS) s.tabs.append(h('button', { class: `m-tab ${this.tab === t.id ? 'on' : ''}`, onclick: () => { this.tab = t.id; this.audio.sfx('ui'); this.render(); } }, img(uiIcon(t.icon), 'm-tab-img'), h('span', null, t.label)));
    const tab = BUILD_TABS.find((t) => t.id === this.tab)!;
    const style = g.equipView.style(st);
    const grid = h('div', { class: 'm-grid wide' });
    const list = equipmentCatalog().filter((d) => tab.cats.includes(d.category));
    for (const d of list) grid.append(this.card(d, style));
    s.body.append(grid);
    s.foot.append(h('div', { class: 'small grow' }, 'Achetez un meuble puis touchez le sol du magasin : un 1er appui montre l’aperçu, un 2e le pose. Il est payé à la pose.'), h('button', { class: 'm-btn small ghost', onclick: () => { this.close(); this.cb.arrange(); } }, '✋ Déplacer mes meubles'));
  }

  private card(d: EquipmentDef, style: ReturnType<Game['equipView']['style']>) {
    const st = this.game.st;
    const lvOk = equipUnlocked(st, d.id);
    const stageOk = (d.stage ?? 0) <= st.store.stage;
    const ok = lvOk && stageOk;
    const owned = st.equipment.filter((e) => e.def === d.id).length;
    const thumb = equipThumb(d.id, style);
    return h(
      'div',
      { class: `m-card equip ${ok ? '' : 'locked'}` },
      thumb ? img(thumb, 'm-equip-img') : h('div', { class: 'm-equip-img' }),
      ok ? null : h('div', { class: 'm-lockband' }, img(uiIcon('lock'), '', 22), lvOk ? `Agrandissement ${d.stage}` : `Niveau ${equipLevel(d.id)}`),
      owned ? h('div', { class: 'm-qty-badge' }, `×${owned}`) : null,
      h('div', { class: 'm-name' }, d.name),
      h('div', { class: 'm-meta' }, `${(d.w * CELL).toFixed(1)} × ${(d.d * CELL).toFixed(1)} m${d.shelf ? ` · ${d.shelf.levels.length} étagères` : ''}${d.cartons ? ` · ${d.cartons} cartons` : ''}`),
      h('button', { class: 'm-btn small', disabled: !ok || d.price > st.cash, onclick: () => { this.close(); this.cb.place(d.id); } }, ok ? `Acheter · ${money0(d.price)}` : '🔒'),
    );
  }
}

// ==================================================================== ÉQUIPE
const ROLE_ICON: Record<RoleId, string> = { caissier: 'cashier', rayon: 'box', logisticien: 'truck', entretien: 'broom', securite: 'shield', manager: 'tie' };

export class TeamScreen {
  private sheet: Sheet | null = null;
  private role: RoleId = 'caissier';

  constructor(private game: Game, private audio: AudioEngine) {}

  get open() {
    return !!this.sheet;
  }

  close() {
    this.sheet?.close();
  }

  show() {
    if (!this.sheet) {
      this.sheet = new Sheet('team', 'Équipe', 'm-team');
      this.sheet.onClose = () => (this.sheet = null);
      this.audio.sfx('whoosh');
    }
    this.render();
  }

  render() {
    const s = this.sheet;
    if (!s) return;
    const g = this.game;
    const st = g.st;
    const day = dayOf(st.time);
    s.sub = `${st.employees.length} employé(s) · caisse ${money0(st.cash)}`;
    clear(s.tabs);
    clear(s.body);
    clear(s.foot);
    // employés
    s.body.append(h('div', { class: 'm-section' }, 'Mon équipe'));
    if (!st.employees.length) s.body.append(h('div', { class: 'm-empty' }, 'Personne pour l’instant : vous faites tout vous-même ! Recrutez ci-dessous.'));
    for (const e of st.employees) {
      const k = e.contract ?? { type: 'CDI' as const, start: e.hiredDay, renewals: 0, paid: 0 };
      const left = k.type === 'CDD' && k.end !== undefined ? k.end - day + 1 : 0;
      const trial = k.type === 'CDI' && (k.trialEnd ?? -1) >= day;
      const cost = fireCost(st, e);
      s.body.append(
        h(
          'div',
          { class: 'm-card emp' },
          img(uiIcon(ROLE_ICON[e.role]), 'm-emp-img'),
          h(
            'div',
            { class: 'grow' },
            h('div', { class: 'm-name' }, e.name),
            h('div', { class: 'm-meta' }, `${ROLE_BY_ID[e.role].name} · ${money(e.wage)}/h · ${e.shiftStart} h–${e.shiftEnd} h`),
            h('div', { class: 'm-chips' }, h('span', { class: `m-chip ${k.type === 'CDI' ? 'green' : 'orange'}` }, k.type === 'CDI' ? (trial ? `CDI · essai ${(k.trialEnd ?? day) - day + 1} j` : 'CDI') : `CDD · ${left} j restant${left > 1 ? 's' : ''}`), h('span', { class: 'm-chip' }, `Moral ${Math.round(e.mood * 100)} %`), h('span', { class: 'm-chip' }, `Compétence ${'★'.repeat(1 + Math.round(e.skill * 4))}`)),
          ),
          h(
            'div',
            { class: 'm-col' },
            k.type === 'CDD' ? h('button', { class: 'm-btn small green', onclick: () => this.say(toCdi(st, e.id)) }, 'Passer en CDI') : null,
            k.type === 'CDD' && k.renewals < 2 ? h('button', { class: 'm-btn small', onclick: () => this.say(renewCdd(st, e.id, 14)) }, 'Renouveler 14 j') : null,
            h('button', { class: 'm-btn small red', onclick: () => modal(`Se séparer de ${e.name} ?`, h('div', null, k.type === 'CDD' ? `Rompre un CDD avant son terme coûte les salaires restants et la prime de précarité : ${money0(cost)}.` : trial ? 'Période d’essai : la rupture est gratuite.' : `Licenciement : indemnité de ${money0(cost)}. Le moral de l’équipe baissera.`), [{ label: 'Annuler' }, { label: cost ? `Confirmer (${money0(cost)})` : 'Confirmer', danger: true, onClick: () => { fire(st, e.id); this.audio.sfx('thud'); this.render(); } }]) }, k.type === 'CDD' ? 'Rompre' : 'Licencier'),
          ),
        ),
      );
    }
    // recrutement
    s.body.append(h('div', { class: 'm-section' }, 'Recruter'));
    const roles = h('div', { class: 'm-roles' });
    for (const r of ROLES) roles.append(h('button', { class: `m-role ${this.role === r.id ? 'on' : ''}`, onclick: () => { this.role = r.id; this.audio.sfx('ui'); this.render(); } }, img(uiIcon(ROLE_ICON[r.id]), '', 40), h('b', null, r.name), h('small', null, `${money(r.baseWage)}/h`)));
    s.body.append(roles, h('div', { class: 'small m-roledesc' }, ROLE_BY_ID[this.role].desc));
    const posted = st.jobPostings.filter((j) => j.role === this.role);
    s.body.append(
      h(
        'div',
        { class: 'm-row' },
        h('button', { class: 'm-btn', onclick: () => { if (postJob(st, this.role, ROLE_BY_ID[this.role].baseWage + 1, 3)) { this.game.bus.emit('notify', { text: `📣 Annonce publiée (${ROLE_BY_ID[this.role].name}) : les candidats arrivent dans les heures qui viennent.`, kind: 'good' }); this.audio.sfx('cash'); } else this.game.bus.emit('notify', { text: 'Pas assez d’argent pour l’annonce.', kind: 'bad' }); this.render(); } }, `📣 Publier une annonce · ${money0(40 + 3 * 15)}`),
        posted.length ? h('span', { class: 'small' }, `Annonce en ligne jusqu’au jour ${posted[0].until + 1}`) : null,
      ),
    );
    const cands = st.candidates;
    s.body.append(h('div', { class: 'm-section' }, `Candidats (${cands.length})`));
    if (!cands.length) s.body.append(h('div', { class: 'm-empty' }, 'Aucun candidat pour l’instant. Publiez une annonce, puis revenez dans quelques heures de jeu.'));
    for (const c of cands)
      s.body.append(
        h(
          'div',
          { class: 'm-card emp' },
          img(uiIcon(ROLE_ICON[c.role]), 'm-emp-img'),
          h('div', { class: 'grow' }, h('div', { class: 'm-name' }, c.name), h('div', { class: 'm-meta' }, `${ROLE_BY_ID[c.role].name} · demande ${money(Math.max(c.wage, c.expectedWage))}/h`), h('div', { class: 'm-chips' }, h('span', { class: 'm-chip' }, `Compétence ${'★'.repeat(1 + Math.round(c.skill * 4))}`), c.wantsCdi ? h('span', { class: 'm-chip green' }, 'CDI seulement') : null), h('div', { class: 'small m-pitch' }, `« ${c.pitch} »`)),
          h('button', { class: 'm-btn small green', onclick: () => this.contractChoice(c.id) }, 'Embaucher'),
        ),
      );
  }

  /** Choix du contrat : deux grosses cartes CDI / CDD (durées). */
  private contractChoice(cid: number) {
    const st = this.game.st;
    const c = st.candidates.find((x) => x.id === cid);
    if (!c) return;
    const wage = Math.max(c.wage, c.expectedWage);
    let close = () => {};
    const go = (type: 'CDI' | 'CDD', days?: number) => {
      const r = hire(st, cid, wage, { type, days });
      this.game.bus.emit('notify', { text: r.ok ? `🤝 ${r.msg}` : r.msg, kind: r.ok ? 'good' : 'bad' });
      this.audio.sfx(r.ok ? 'fanfare' : 'error');
      close();
      this.render();
    };
    close = modal(
      `Contrat pour ${c.name}`,
      h(
        'div',
        { class: 'm-contracts' },
        h('div', { class: 'm-contract cdi' }, img(uiIcon('handshake'), '', 56), h('b', null, 'CDI'), h('div', { class: 'small' }, `Sans date de fin. Moral en hausse. Période d’essai de ${CDI_TRIAL} jours, puis indemnité en cas de licenciement.`), h('button', { class: 'm-btn green', onclick: () => go('CDI') }, 'Signer un CDI')),
        h(
          'div',
          { class: 'm-contract cdd' },
          img(uiIcon('contract'), '', 56),
          h('b', null, 'CDD'),
          h('div', { class: 'small' }, 'Durée fixe, renouvelable 2 fois. À la fin : prime de précarité de 10 % des salaires versés.'),
          c.wantsCdi ? h('div', { class: 'small bad' }, `${c.name.split(' ')[0]} n’accepte qu’un CDI.`) : h('div', { class: 'm-row' }, ...CDD_DURATIONS.map((d) => h('button', { class: 'm-btn small', onclick: () => go('CDD', d) }, `${d} jours`))),
        ),
      ),
      [{ label: 'Annuler' }],
      { width: 'min(620px, 96vw)' },
    );
  }

  private say(r: { ok: boolean; msg: string }) {
    this.game.bus.emit('notify', { text: r.msg, kind: r.ok ? 'good' : 'bad' });
    this.audio.sfx(r.ok ? 'cash' : 'error');
    this.render();
  }
}

// ==================================================================== NIVEAU SUPÉRIEUR
export function levelUpScreen(lv: { level: number; cats: CategoryId[]; equip: string[]; bonus: number }, audio: AudioEngine, onClose?: () => void, thumb?: (def: string) => string) {
  audio.sfx('fanfare');
  const items: HTMLElement[] = [];
  for (const c of lv.cats) {
    const p = PRODUCTS.find((x) => x.category === c && !x.seasonal) ?? PRODUCTS.find((x) => x.category === c)!;
    items.push(h('div', { class: 'm-unlock' }, img(productImage(p.id), '', 64), h('b', null, CATEGORY_BY_ID[c].name), h('small', null, 'nouveaux produits')));
  }
  for (const e of lv.equip.slice(0, 6)) items.push(h('div', { class: 'm-unlock' }, img(thumb?.(e) || uiIcon('build'), 'm-unlock-equip', 64), h('b', null, EQUIPMENT_BY_ID[e].name), h('small', null, 'nouveau meuble')));
  const back = h(
    'div',
    { class: 'm-back m-levelup', onpointerdown: (e: PointerEvent) => e.target === back && done() },
    h(
      'div',
      { class: 'm-sheet small' },
      h('div', { class: 'm-lv-burst' }, img(uiIcon('party'), '', 96)),
      h('div', { class: 'm-lv-title' }, `NIVEAU ${lv.level} !`),
      lv.bonus ? h('div', { class: 'm-lv-bonus' }, img(uiIcon('money'), '', 32), `+${money0(lv.bonus)} de prime`) : null,
      items.length ? h('div', { class: 'm-unlocks' }, ...items) : h('div', { class: 'small' }, 'Votre supérette prend du galon !'),
      h('button', { class: 'm-btn big green', onclick: () => done() }, 'Génial !'),
    ),
  );
  const done = () => {
    back.remove();
    onClose?.();
  };
  document.getElementById('ui')!.append(back);
}

/** Petit badge niveau + barre d'XP pour le haut de l'écran. */
export function levelBadge(game: Game): { el: HTMLElement; update: () => void } {
  const num = h('b', null, '1');
  const fill = h('i');
  const el = h('div', { class: 'm-level', title: 'Niveau du magasin (vendez pour progresser)' }, img(uiIcon('star'), '', 30), num, h('div', { class: 'm-xp' }, fill));
  let last = '';
  return {
    el,
    update: () => {
      const p = levelProgress(game.st);
      const sig = `${p.level}:${p.frac.toFixed(2)}`;
      if (sig === last) return;
      last = sig;
      num.textContent = String(p.level);
      fill.style.width = `${Math.round(p.frac * 100)}%`;
      el.title = p.next ? `Niveau ${p.level} · ${p.xp}/${p.next} XP` : `Niveau ${p.level} (max)`;
    },
  };
}
