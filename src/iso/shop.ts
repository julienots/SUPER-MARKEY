/**
 * La boutique « comme les vrais commerçants » : on achète la marchandise au carton chez des grossistes
 * (prix d'achat, remises au volume, minimum de commande, frais et délai de livraison, express), le matériel
 * du magasin (rayons, frigos, caisses…) et on suit ses commandes. Les camions livrent des palettes au quai.
 */
import { h, clear } from '../ui/dom';
import { money, money0, pct } from '../core/math';
import { fmtClock } from '../core/time';
import { CATEGORIES, CATEGORY_BY_ID, PRODUCTS, PRODUCT_BY_ID, type CategoryId } from '../data/products';
import { SUPPLIER_BY_ID, supplierSells, type SupplierDef } from '../data/suppliers';
import { CELL, EQUIPMENT, EQUIP_CATEGORY_NAMES, type EquipCategory } from '../data/equipment';
import { availableSuppliers, avgDailySales, cancelOrder, placeOrder, quote, unitCost } from '../sim/orders';
import { backroomUnits, rackFree, shelfCapacity, shelfUnits, storageRacks } from '../sim/inventory';
import { basePrice } from '../sim/pricing';
import { spend } from '../sim/economy';
import { dayOf } from '../sim/state';
import { productIcon } from './sprites';
import type { Game } from '../game/game';
import type { AudioEngine } from '../audio/audio';

type ShopTab = 'marchandises' | 'materiel' | 'commandes';

export interface ShopCallbacks {
  /** Le joueur a choisi un meuble : on passe en mode aménagement pour le poser. */
  place: (def: string) => void;
  onClose?: () => void;
}

/** Délai express : environ 12 % du délai normal (au moins 20 min de jeu). */
const expressFee = (sup: SupplierDef, goods: number) => Math.round(25 + goods * 0.06);

export class Shop {
  el: HTMLElement | null = null;
  private tab: ShopTab = 'marchandises';
  private supplier = 'grossiste';
  private cat: CategoryId | 'tout' | 'rayons' = 'rayons';
  private search = '';
  private cart = new Map<string, number>();
  private express = false;
  private equipCat: EquipCategory = 'rayon';
  private body = h('div', { class: 'shop-body' });
  private bar = h('div', { class: 'shop-bar' });
  private cashEl = h('span', { class: 'shop-cash' });

  constructor(private game: Game, private audio: AudioEngine, private cb: ShopCallbacks) {}

  get open() {
    return !!this.el;
  }

  /** Ouvre la boutique ; `pids` : produits ajoutés d'office au panier (1 carton chacun). */
  show(tab: ShopTab = 'marchandises', pids?: string[]) {
    const st = this.game.st;
    this.tab = tab;
    if (pids?.length) {
      // choisit un fournisseur qui vend tout (ou le premier qui vend le premier produit)
      const sups = availableSuppliers(st);
      const cur = SUPPLIER_BY_ID[this.supplier];
      if (!pids.every((pid) => supplierSells(cur, PRODUCT_BY_ID[pid].category))) this.supplier = (sups.find((s) => pids.every((pid) => supplierSells(s, PRODUCT_BY_ID[pid].category))) ?? sups.find((s) => supplierSells(s, PRODUCT_BY_ID[pids[0]].category)) ?? sups[0]).id;
      this.cart.clear();
      for (const pid of pids) if (supplierSells(SUPPLIER_BY_ID[this.supplier], PRODUCT_BY_ID[pid].category)) this.cart.set(pid, Math.max(1, this.cart.get(pid) ?? 0));
      this.cat = 'rayons';
    }
    if (!this.el) {
      this.el = h(
        'div',
        { id: 'shop' },
        h(
          'div',
          { class: 'shop-win panel' },
          h(
            'div',
            { class: 'shop-head' },
            h('div', { class: 'shop-title' }, h('span', { class: 'logo' }, '🏪'), h('div', null, h('div', { class: 't' }, 'Le Marché de Gros'), h('div', { class: 'small muted' }, 'Achetez au carton, revendez à l’unité.'))),
            this.cashEl,
            h('button', { class: 'btn small', 'aria-label': 'Fermer', onclick: () => this.close() }, '✕'),
          ),
          h('div', { class: 'shop-tabs' }, ...(['marchandises', 'materiel', 'commandes'] as ShopTab[]).map((t) => h('button', { 'data-t': t, onclick: () => { this.tab = t; this.audio.sfx('ui'); this.render(); } }, t === 'marchandises' ? '🥫 Marchandises' : t === 'materiel' ? '🛠️ Matériel' : '🚚 Commandes'))),
          this.body,
          this.bar,
        ),
      );
      this.el.addEventListener('pointerdown', (e) => {
        if (e.target === this.el) this.close();
      });
      document.getElementById('ui')!.append(this.el);
      this.audio.sfx('whoosh');
    }
    this.render();
  }

  close() {
    this.el?.remove();
    this.el = null;
    this.cb.onClose?.();
  }

  update() {
    if (!this.el) return;
    this.cashEl.textContent = money0(this.game.st.cash);
  }

  render() {
    if (!this.el) return;
    this.el.querySelectorAll('.shop-tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === this.tab));
    clear(this.body);
    clear(this.bar);
    this.update();
    if (this.tab === 'marchandises') this.goods();
    else if (this.tab === 'materiel') this.material();
    else this.orders();
  }

  // ---------------------------------------------------------------- marchandises
  private goods() {
    const g = this.game;
    const st = g.st;
    const sups = availableSuppliers(st);
    const sup = SUPPLIER_BY_ID[this.supplier] ?? sups[0];
    this.supplier = sup.id;
    // fournisseurs
    this.body.append(
      h(
        'div',
        { class: 'sups' },
        ...sups.map((s) =>
          h(
            'button',
            { class: `sup ${s.id === sup.id ? 'on' : ''}`, onclick: () => { if (s.id !== this.supplier) { this.supplier = s.id; for (const pid of [...this.cart.keys()]) if (!supplierSells(s, PRODUCT_BY_ID[pid].category)) this.cart.delete(pid); } this.audio.sfx('ui'); this.render(); } },
            h('div', { class: 'n' }, s.name),
            h('div', { class: 'd' }, `⏱ ${s.leadHours} h · 🚚 ${money0(s.deliveryFee)} · min ${money0(s.minOrder)}`),
            h('div', { class: 'd' }, `${'★'.repeat(Math.round(s.reliability * 5))}${'☆'.repeat(5 - Math.round(s.reliability * 5))} · prix ${s.priceFactor < 0.97 ? 'bas' : s.priceFactor > 1.05 ? 'élevés' : 'moyens'}`),
          ),
        ),
      ),
      h('div', { class: 'small muted sup-desc' }, `${sup.desc} Remises : ${sup.bulk.map((b) => `${b.cartons} cartons → −${Math.round(b.discount * 100)} %`).join(' · ')}`),
    );
    // filtres
    const cats = CATEGORIES.filter((c) => supplierSells(sup, c.id));
    const chip = (id: typeof this.cat, label: string) => h('button', { class: `chipbtn ${this.cat === id ? 'on' : ''}`, onclick: () => { this.cat = id; this.render(); } }, label);
    const searchIn = h('input', { type: 'search', placeholder: '🔎 Rechercher…', value: this.search, oninput: (e: Event) => { this.search = (e.target as HTMLInputElement).value; this.renderGrid(grid, sup); } });
    this.body.append(
      h(
        'div',
        { class: 'filters' },
        chip('rayons', '🏷️ Mes rayons'),
        chip('tout', '📚 Tout'),
        ...cats.map((c) => chip(c.id, `${c.icon} ${c.name}`)),
      ),
      h('div', { class: 'row', style: { gap: '6px', margin: '6px 0' } }, searchIn, h('button', { class: 'btn small', title: 'Remplit le panier pour ~2 jours de ventes', onclick: () => this.suggest(sup) }, '🪄 Suggestion')),
    );
    const grid = h('div', { class: 'pgrid' });
    this.body.append(grid);
    this.renderGrid(grid, sup);
    this.renderBar(sup);
  }

  /** Places libres en réserve (cartons), commandes en cours déduites. */
  private freeSlots(): number {
    const st = this.game.st;
    let free = 0;
    for (const r of storageRacks(st)) free += rackFree(r);
    for (const o of st.orders) if (o.status === 'en_cours' || o.status === 'livraison') for (const l of o.lines) free -= l.cartons;
    for (const p of st.pallets) free -= p.cartons.length;
    return Math.max(0, free);
  }

  /**
   * Suggestion de commande : de quoi remplir les rayons une fois + ~1 jour de ventes, produit par produit
   * (les plus populaires d'abord), sans dépasser la place disponible en réserve.
   */
  private suggest(sup: SupplierDef) {
    const st = this.game.st;
    const pending = new Map<string, number>();
    for (const o of st.orders) if (o.status === 'en_cours' || o.status === 'livraison') for (const l of o.lines) pending.set(l.pid, (pending.get(l.pid) ?? 0) + l.cartons * PRODUCT_BY_ID[l.pid].cartonQty);
    const want = new Map<string, number>();
    for (const pid of this.shelfPids()) {
      const p = PRODUCT_BY_ID[pid];
      if (!supplierSells(sup, p.category)) continue;
      const have = shelfUnits(st, pid) + backroomUnits(st, pid) + (pending.get(pid) ?? 0) + (this.cart.get(pid) ?? 0) * p.cartonQty;
      const target = shelfCapacity(st, pid) + avgDailySales(st, pid);
      const n = Math.min(3, Math.ceil((target - have) / p.cartonQty));
      if (n > 0) want.set(pid, n);
    }
    let room = this.freeSlots() - [...this.cart.values()].reduce((a, b) => a + b, 0);
    const order = [...want.keys()].sort((a, b) => PRODUCT_BY_ID[b].popularity - PRODUCT_BY_ID[a].popularity);
    let added = 0;
    for (let pass = 1; pass <= 3 && room > 0; pass++)
      for (const pid of order) {
        if (room <= 0) break;
        if ((want.get(pid) ?? 0) < pass) continue;
        this.cart.set(pid, (this.cart.get(pid) ?? 0) + 1);
        room--;
        added++;
      }
    this.game.bus.emit('notify', { text: added ? `🪄 ${added} carton(s) ajoutés au panier (selon la place en réserve).` : want.size ? 'Plus de place en réserve : rangez ou vendez d’abord.' : 'Rien à suggérer : vos stocks sont bons.', kind: 'info' });
    this.audio.sfx('ui');
    this.render();
  }

  private shelfPids(): Set<string> {
    const s = new Set<string>();
    for (const e of this.game.st.equipment) e.slots?.forEach((x) => x.pid && s.add(x.pid));
    return s;
  }

  private renderGrid(grid: HTMLElement, sup: SupplierDef) {
    const st = this.game.st;
    clear(grid);
    const onShelf = this.shelfPids();
    const q = this.search.trim().toLowerCase();
    const list = PRODUCTS.filter((p) => {
      if (!supplierSells(sup, p.category)) return false;
      if ((p.unlock ?? 0) > st.store.stage + 1) return false;
      if (q) return p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q);
      if (this.cat === 'rayons') return onShelf.has(p.id) || this.cart.has(p.id);
      if (this.cat === 'tout') return true;
      return p.category === this.cat;
    }).sort((a, b) => Number(this.cart.has(b.id)) - Number(this.cart.has(a.id)) || CATEGORIES.findIndex((c) => c.id === a.category) - CATEGORIES.findIndex((c) => c.id === b.category));
    if (!list.length) grid.append(h('div', { class: 'muted small', style: { padding: '12px' } }, this.cat === 'rayons' ? 'Aucun produit assigné à vos rayons chez ce fournisseur. Essayez « Tout ».' : 'Aucun produit.'));
    for (const p of list) {
      const n = this.cart.get(p.id) ?? 0;
      const uc = unitCost(st, sup, p.id);
      const sell = basePrice(st, p.id);
      const margin = (sell - uc) / sell;
      const stock = shelfUnits(st, p.id);
      const back = backroomUnits(st, p.id);
      const sales = avgDailySales(st, p.id);
      grid.append(
        h(
          'div',
          { class: `pcard ${n ? 'in' : ''}` },
          h('img', { src: productIcon(p.id, 72), alt: '' }),
          h('div', { class: 'pc-cat', style: { background: `#${CATEGORY_BY_ID[p.category].color.toString(16).padStart(6, '0')}` } }, CATEGORY_BY_ID[p.category].icon),
          h('div', { class: 'pc-name' }, p.name),
          h('div', { class: 'pc-brand' }, `${p.brand}${p.storage !== 'ambient' ? ' · ❄️' : ''}${p.shelfLife ? ` · DLC ${p.shelfLife} j` : ''}`),
          h('div', { class: 'pc-price' }, h('b', null, money(uc * p.cartonQty)), h('span', null, ` / carton de ${p.cartonQty}`)),
          h('div', { class: 'pc-sub' }, `${money(uc)}/u → vendu ${money(sell)} · marge ${pct(margin)}`),
          h('div', { class: 'pc-stock' }, onShelf.has(p.id) ? `🏷️ ${stock} en rayon · 📦 ${back} en réserve${sales ? ` · ${sales.toFixed(1)}/j` : ''}` : '➕ pas encore en rayon'),
          h(
            'div',
            { class: 'qty' },
            h('button', { class: 'btn small', disabled: !n, onclick: () => this.setQty(p.id, n - 1, grid, sup) }, '−'),
            h('b', null, n ? `${n}` : '0'),
            h('button', { class: 'btn small primary', onclick: () => this.setQty(p.id, n + 1, grid, sup) }, '+'),
          ),
        ),
      );
    }
  }

  private setQty(pid: string, n: number, grid: HTMLElement, sup: SupplierDef) {
    if (n <= 0) this.cart.delete(pid);
    else this.cart.set(pid, Math.min(99, n));
    this.audio.sfx('ui');
    const y = this.body.scrollTop;
    this.renderGrid(grid, sup);
    this.renderBar(sup);
    this.body.scrollTop = y;
  }

  private firstFree(): boolean {
    const st = this.game.st;
    return !!st.flags.emptyStart && st.stats.ordersPlaced === 0;
  }

  private renderBar(sup: SupplierDef) {
    const g = this.game;
    const st = g.st;
    clear(this.bar);
    const lines = [...this.cart].filter(([, n]) => n > 0).map(([pid, cartons]) => ({ pid, cartons }));
    const q = quote(st, sup.id, lines);
    const free = this.firstFree();
    const exp = this.express && !free ? expressFee(sup, q.goods) : 0;
    const total = q.total + exp;
    const ok = q.ok && total <= st.cash;
    const reason = !q.ok ? q.reason : total > st.cash ? 'Trésorerie insuffisante' : '';
    this.bar.append(
      h(
        'div',
        { class: 'sum' },
        h('div', null, h('b', null, `🛒 ${q.cartons} carton(s)`), ` · marchandise ${money(q.goods)}${q.discount ? ` − remise ${money(q.discount)}` : ''} · livraison ${money(q.fee)}${exp ? ` + express ${money(exp)}` : ''}`),
        h(
          'label',
          { class: 'exp' },
          h('input', { type: 'checkbox', checked: this.express || free, disabled: free, onchange: (e: Event) => { this.express = (e.target as HTMLInputElement).checked; this.renderBar(sup); } }),
          free ? ' 🎁 Livraison express offerte pour votre 1ʳᵉ commande' : ` ⚡ Express (~${Math.max(20, Math.round(sup.leadHours * 60 * 0.12))} min au lieu de ${sup.leadHours} h)`,
        ),
        h('div', { class: `small ${q.cartons > this.freeSlots() ? 'bad' : 'muted'}` }, `📦 Réserve : ${this.freeSlots()} place(s) libre(s)${q.cartons > this.freeSlots() ? ' — le surplus restera sur la palette au quai' : ''}`),
        reason && q.cartons ? h('div', { class: 'small bad' }, reason) : null,
      ),
      h('div', { class: 'col', style: { gap: '4px', alignItems: 'stretch' } }, h('div', { class: 'total' }, money(q.cartons ? total : 0)), h('button', { class: 'btn primary', disabled: !ok, onclick: () => this.order(sup, lines, exp, free) }, '✅ Commander')),
    );
  }

  private order(sup: SupplierDef, lines: { pid: string; cartons: number }[], exp: number, free: boolean) {
    const g = this.game;
    const st = g.st;
    const o = placeOrder(st, g.rng, sup.id, lines);
    if (!o) return;
    for (const l of lines) if (!st.assortment.includes(l.pid)) st.assortment.push(l.pid);
    if (exp || free) {
      if (exp) spend(st, 'livraison', exp);
      o.eta = Math.round(st.time + Math.max(20, sup.leadHours * 60 * 0.12));
      o.delayed = false;
      const mod = o.eta % 1440;
      if (mod < 6 * 60) o.eta += 6 * 60 - mod;
      else if (mod > 20 * 60) o.eta += 1440 - mod + 6 * 60;
    }
    this.cart.clear();
    this.express = false;
    g.bus.emit('notify', { text: `📝 Commande #${o.id} chez ${sup.name} : livraison prévue à ${fmtClock(o.eta % 1440)}${dayOf(o.eta) !== dayOf(st.time) ? ` (J${dayOf(o.eta) + 1})` : ''}. Le camion déposera des palettes au quai.`, kind: 'good' });
    this.audio.sfx('cash');
    this.tab = 'commandes';
    this.render();
  }

  // ---------------------------------------------------------------- matériel
  private material() {
    const st = this.game.st;
    this.body.append(h('div', { class: 'filters' }, ...(Object.keys(EQUIP_CATEGORY_NAMES) as EquipCategory[]).map((c) => h('button', { class: `chipbtn ${this.equipCat === c ? 'on' : ''}`, onclick: () => { this.equipCat = c; this.render(); } }, EQUIP_CATEGORY_NAMES[c]))));
    const grid = h('div', { class: 'egrid' });
    for (const d of EQUIPMENT.filter((e) => e.category === this.equipCat)) {
      const locked = (d.stage ?? 0) > st.store.stage;
      const owned = st.equipment.filter((e) => e.def === d.id).length;
      grid.append(
        h(
          'div',
          { class: `ecard ${locked ? 'locked' : ''}` },
          h('div', { class: 'ec-name' }, d.name),
          h('div', { class: 'ec-desc' }, d.desc),
          h('div', { class: 'ec-meta' }, `${(d.w * CELL).toFixed(1)} × ${(d.d * CELL).toFixed(1)} m${d.shelf ? ` · ${d.shelf.levels.length} niveaux` : ''}${d.power ? ` · ${d.power} kW` : ''}${owned ? ` · vous en avez ${owned}` : ''}`),
          h(
            'div',
            { class: 'row between' },
            h('b', { class: 'ec-price' }, money0(d.price)),
            locked ? h('span', { class: 'small muted' }, `🔒 agrandissement ${d.stage}`) : h('button', { class: 'btn small primary', disabled: d.price > st.cash, onclick: () => { this.close(); this.cb.place(d.id); } }, '📐 Acheter & placer'),
          ),
        ),
      );
    }
    this.body.append(grid);
    this.bar.append(h('div', { class: 'small muted' }, 'Le meuble est payé au moment où vous le posez. Les rayons reçoivent automatiquement un planogramme que vous pourrez modifier.'));
  }

  // ---------------------------------------------------------------- commandes
  private orders() {
    const st = this.game.st;
    const list = st.orders.filter((o) => o.status === 'en_cours' || o.status === 'livraison').slice(-12).reverse();
    const done = st.orders.filter((o) => o.status === 'livree').slice(-6).reverse();
    if (!list.length) this.body.append(h('div', { class: 'muted', style: { padding: '14px' } }, 'Aucune commande en cours. Passez par l’onglet Marchandises pour remplir votre réserve.'));
    for (const o of list) {
      const left = Math.max(0, o.eta - st.time);
      this.body.append(
        h(
          'div',
          { class: 'olist' },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, `#${o.id} · ${SUPPLIER_BY_ID[o.supplier].name}${o.auto ? ' 🤖' : ''}`), h('div', { class: 'small muted' }, o.lines.map((l) => `${l.cartons}× ${PRODUCT_BY_ID[l.pid].name}`).join(', ')), h('div', { class: 'small' }, o.status === 'livraison' ? '🚚 Le camion arrive !' : `⏱ prévue à ${fmtClock(o.eta % 1440)} (dans ${left >= 60 ? `${Math.floor(left / 60)} h ${String(Math.round(left % 60)).padStart(2, '0')}` : `${Math.round(left)} min`})${o.delayed ? ' · retard probable' : ''}`)),
          h('b', null, money0(o.cost + o.fee)),
          o.status === 'en_cours' ? h('button', { class: 'btn small', onclick: () => { cancelOrder(st, o.id); this.render(); } }, 'Annuler') : null,
        ),
      );
    }
    if (done.length) {
      this.body.append(h('div', { class: 'section-title' }, 'Dernières livraisons'));
      for (const o of done) this.body.append(h('div', { class: 'small muted', style: { padding: '2px 6px' } }, `✅ #${o.id} · ${SUPPLIER_BY_ID[o.supplier].name} · ${o.lines.reduce((a, l) => a + l.cartons, 0)} carton(s)`));
    }
    this.bar.append(h('div', { class: 'small muted' }, 'À l’arrivée, touchez la palette au quai puis « Ranger en réserve », puis remplissez vos rayons.'));
  }
}
