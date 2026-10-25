/**
 * Tablette de gestion : fenêtre compacte à onglets (ne masque qu'une partie de la vue 3D).
 * Chaque onglet agit sur la vraie simulation : prix, commandes, RH, marketing, finances, sécurité, magasin.
 */
import { h, clear, modal } from './dom';
import { chart } from './charts';
import { money, money0, pct, clamp01 } from '../core/math';
import { fmtClock, DAY_NAMES } from '../core/time';
import { CATEGORIES, CATEGORY_BY_ID, PRODUCTS, PRODUCT_BY_ID, psychologicalPrice, type CategoryId } from '../data/products';
import { EQUIPMENT_BY_ID, UPGRADES } from '../data/equipment';
import { SUPPLIERS, SUPPLIER_BY_ID, supplierSells } from '../data/suppliers';
import { ROLES, ROLE_BY_ID, TRAITS, type RoleId } from '../data/roles';
import { COMPETITORS } from '../data/competitors';
import { OBJECTIVES } from '../data/objectives';
import { FLOORS, WALLS, STYLE_PRESETS, MUSIC_STYLES, LOGO_ICONS } from '../data/styles';
import { backroomUnits, shelfUnits, shelfCapacity, slotQty, expiredInSlot } from '../sim/inventory';
import { basePrice, priceIndex, promosFor } from '../sim/pricing';
import { availableSuppliers, avgDailySales, cancelOrder, negotiateContract, placeOrder, quote, reorderNeeds, unitCost } from '../sim/orders';
import { dailyKwh, dayProfit, fixedCostsPreview, forecast, insuranceDaily, maxLoan, repayLoan, takeLoan, KWH_PRICE, estimatedDailyWages, tryBuy } from '../sim/economy';
import { postJob, hire, fire, train, trainingCost } from '../sim/staff';
import { marketShare, PLAYER } from '../sim/market';
import { coverageGrid, burglaryRisk } from '../sim/security';
import { rank, statValue } from '../sim/objectives';
import { LANDS, STAGES } from '../sim/layout';
import { CAMPAIGNS, PROMO_KINDS, launchCampaign, launchPromo, stopPromo } from '../sim/marketing';
import { dayOf, type Employee } from '../sim/state';
import { applyLayout } from '../sim/build';
import { logoDataUrl } from '../world/shopLogo';
import type { Game } from '../game/game';
import type { AudioEngine } from '../audio/audio';

type Tab = { id: string; name: string; icon: string; render: (el: HTMLElement) => void };

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const unhex = (s: string) => parseInt(s.replace('#', ''), 16);

export class Tablet {
  el: HTMLElement | null = null;
  private tab = 'dashboard';
  private content!: HTMLElement;
  private title!: HTMLElement;
  private refreshT = 0;
  private catFilter: CategoryId | 'all' = 'all';
  private orderSupplier = 'grossiste';
  private orderLines = new Map<string, number>();
  private rackUid: number | null = null;
  onClose: (() => void) | null = null;
  /** Onglets rafraîchis automatiquement (sans champ de saisie). */
  private liveTabs = new Set(['dashboard', 'finances', 'concurrence', 'securite', 'objectifs', 'journal', 'reserve']);

  constructor(private game: Game, private audio: AudioEngine) {}

  get open() {
    return !!this.el;
  }

  private tabs(): Tab[] {
    return [
      { id: 'dashboard', name: 'Tableau de bord', icon: '📊', render: (e) => this.dashboard(e) },
      { id: 'produits', name: 'Produits & prix', icon: '🏷️', render: (e) => this.products(e) },
      { id: 'commandes', name: 'Commandes', icon: '🚚', render: (e) => this.orders(e) },
      { id: 'reserve', name: 'Réserve', icon: '📦', render: (e) => this.backroom(e) },
      { id: 'personnel', name: 'Personnel', icon: '👥', render: (e) => this.staff(e) },
      { id: 'marketing', name: 'Marketing', icon: '📣', render: (e) => this.marketing(e) },
      { id: 'finances', name: 'Finances', icon: '💶', render: (e) => this.finances(e) },
      { id: 'concurrence', name: 'Concurrence', icon: '🥊', render: (e) => this.competition(e) },
      { id: 'securite', name: 'Sécurité', icon: '🛡️', render: (e) => this.security(e) },
      { id: 'magasin', name: 'Magasin', icon: '🏪', render: (e) => this.store(e) },
      { id: 'objectifs', name: 'Objectifs', icon: '🏆', render: (e) => this.objectives(e) },
      { id: 'journal', name: 'Journal', icon: '📰', render: (e) => this.journal(e) },
    ];
  }

  toggle(tab?: string) {
    if (this.el && (!tab || tab === this.tab)) return this.close();
    this.show(tab);
  }

  show(tab?: string) {
    if (tab?.startsWith('rack:')) {
      this.rackUid = Number(tab.slice(5));
      tab = 'reserve';
    }
    if (tab) this.tab = tab;
    this.game.st.flags.tabletOpened = true;
    if (!this.el) {
      const nav = h('nav', null, h('div', { class: 'brand' }, '📱 BAZAR-PAD'));
      for (const t of this.tabs()) nav.append(h('button', { 'data-tab': t.id, onclick: () => this.select(t.id) }, h('span', null, `${t.icon} ${t.name}`)));
      this.title = h('h2');
      this.content = h('div', { class: 'content' });
      this.el = h('div', { id: 'tablet', class: 'panel' }, nav, h('div', { class: 'body' }, h('div', { class: 'head' }, this.title, h('button', { class: 'btn small', onclick: () => this.close(), 'aria-label': 'Fermer' }, '✕ Fermer')), this.content));
      document.getElementById('ui')!.append(this.el);
      this.audio.sfx('ui');
    }
    this.select(this.tab);
  }

  close() {
    this.el?.remove();
    this.el = null;
    this.rackUid = null;
    this.audio.sfx('uiBack');
    this.onClose?.();
  }

  select(id: string) {
    this.tab = id;
    const t = this.tabs().find((x) => x.id === id)!;
    this.el?.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === id));
    this.title.textContent = `${t.icon} ${t.name}`;
    this.render();
  }

  render() {
    if (!this.el) return;
    const scroll = this.content.scrollTop;
    clear(this.content);
    this.tabs().find((x) => x.id === this.tab)!.render(this.content);
    this.content.scrollTop = scroll;
  }

  update(dt: number) {
    if (!this.el) return;
    this.refreshT -= dt;
    if (this.refreshT <= 0 && this.liveTabs.has(this.tab)) {
      this.refreshT = 1.5;
      const active = document.activeElement;
      if (!active || !this.content.contains(active)) this.render();
    }
  }

  private notify(text: string, ok = true) {
    this.game.bus.emit('notify', { text, kind: ok ? 'good' : 'bad' });
    this.audio.sfx(ok ? 'cash' : 'error');
  }

  private card(k: string, v: string, d?: string, cls = '') {
    return h('div', { class: 'card' }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v), d ? h('div', { class: 'd muted' }, d) : null);
  }

  // ================================================================ TABLEAU DE BORD
  private dashboard(el: HTMLElement) {
    const g = this.game;
    const st = g.st;
    const t = st.today;
    const avgBasket = t.customers ? t.revenue / t.customers : 0;
    const sat = t.satisfactionN ? t.satisfaction / t.satisfactionN : 0;
    const share = marketShare(st);
    const r = rank(st);
    el.append(
      h('div', { class: 'row between', style: { marginBottom: '8px' } }, h('div', null, h('b', null, st.store.name), h('span', { class: 'muted small' }, ` · ${STAGES[st.store.stage].name} · ${r.name}`)), h('div', { class: 'small muted' }, `Jour ${dayOf(st.time) + 1}, ${fmtClock(st.time % 1440)}`)),
      h(
        'div',
        { class: 'cards' },
        this.card('Trésorerie', money0(st.cash), st.loan ? `Emprunt restant : ${money0(st.loan.remaining)}` : undefined, st.cash < 0 ? 'bad' : ''),
        this.card('CA du jour', money(t.revenue), `${t.customers} clients · panier ${money(avgBasket)}`),
        this.card('Marge brute', money(t.revenue - t.cogs), t.revenue ? pct((t.revenue - t.cogs) / t.revenue) : '—'),
        this.card('Satisfaction', t.satisfactionN ? pct(sat) : '—', `${t.lostCustomers} client(s) perdu(s)`, sat > 0.7 ? 'good' : sat && sat < 0.45 ? 'bad' : ''),
        this.card('Réputation', `${Math.round(st.reputation.overall)}/100`, '★'.repeat(Math.round(st.reputation.overall / 20)).padEnd(5, '☆')),
        this.card('Part de marché', pct(share), '7 derniers jours'),
        this.card('En magasin', `${g.agents.count('customer')} clients`, `${g.staff.present().length} employé(s) présent(s)`),
      ),
    );
    // alertes
    const alerts: string[] = [];
    const day = dayOf(st.time);
    let empty = 0;
    let expired = 0;
    for (const e of st.equipment)
      e.slots?.forEach((s) => {
        if (s.pid && slotQty(s) === 0) empty++;
        expired += expiredInSlot(s, day);
      });
    if (empty) alerts.push(`🕳️ ${empty} facing(s) vide(s) en rayon`);
    if (expired) alerts.push(`🤢 ${expired} produit(s) périmé(s) en rayon (risque d’amende)`);
    if (st.pallets.length) alerts.push(`📦 ${st.pallets.reduce((a, p) => a + p.cartons.length, 0)} carton(s) sur palette au quai`);
    if (st.looseItems.length) alerts.push(`🫳 ${st.looseItems.length} article(s) par terre`);
    if (st.messes.length) alerts.push(`🧽 ${st.messes.length} salissure(s)`);
    for (const l of g.checkouts.lanes.values()) if (!l.auto && !l.operator && l.queue.length) alerts.push('🧾 Des clients attendent à une caisse sans caissier !');
    if (st.equipment.some((e) => e.broken)) alerts.push(`🔧 ${st.equipment.filter((e) => e.broken).length} équipement(s) en panne`);
    if (st.cash < 0) alerts.push(`⚠️ Trésorerie négative (${st.debtDays} j) — faillite au-delà de 7 jours`);
    if (!st.employees.length && st.time > 1440) alerts.push('👤 Vous travaillez seul·e : pensez à recruter (onglet Personnel)');
    el.append(h('div', { class: 'section-title' }, 'Alertes'), alerts.length ? h('div', { class: 'col small' }, alerts.map((a) => h('div', null, a))) : h('div', { class: 'muted small' }, 'Tout roule. Pour l’instant.'));
    for (const e of st.equipment.filter((x) => x.broken))
      el.append(h('div', { class: 'list-item' }, h('div', { class: 'grow small' }, `🔧 ${EQUIPMENT_BY_ID[e.def].name} en panne`), h('button', { class: 'btn small primary', onclick: () => { const m = g.repair(e.uid); this.notify(m, !e.broken); this.render(); } }, `Technicien (${money0(g.repairCost(e.uid))})`)));
    // CA sur 14 jours
    const days = [...st.ledger.slice(-13), st.today];
    el.append(
      h('div', { class: 'section-title' }, 'Chiffre d’affaires et résultat'),
      chart(
        [
          { label: 'CA', color: '#ffc72c', values: days.map((d) => d.revenue), type: 'bar' },
          { label: 'Résultat', color: '#2ecc71', values: days.map((d) => dayProfit(d)) },
        ],
        days.map((d) => `J${d.day + 1}`),
        { money: true },
      ),
    );
    // réputation détaillée
    const rep = st.reputation;
    const keys: [keyof typeof rep, string][] = [['prix', 'Prix'], ['choix', 'Choix'], ['attente', 'Attente'], ['proprete', 'Propreté'], ['service', 'Service'], ['securite', 'Sécurité'], ['ambiance', 'Ambiance']];
    el.append(
      h('div', { class: 'section-title' }, 'Ce que pensent les clients'),
      h('div', { class: 'col' }, keys.map(([k, n]) => h('div', { class: 'row' }, h('div', { style: { width: '80px' }, class: 'small' }, n), h('div', { class: 'bar', style: { flex: '1' } }, h('i', { style: { width: `${rep[k]}%`, background: rep[k] < 40 ? '#ff5c4d' : rep[k] > 70 ? '#2ecc71' : '#ffc72c' } })), h('div', { class: 'small num', style: { width: '32px' } }, Math.round(rep[k]))))),
    );
    const missed = Object.entries(st.todayMissed).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (missed.length)
      el.append(h('div', { class: 'section-title' }, 'Demandes non satisfaites aujourd’hui'), h('div', { class: 'small' }, missed.map(([k, n]) => `${PRODUCT_BY_ID[k]?.name ?? CATEGORY_BY_ID[k as CategoryId]?.name ?? k} (${n})`).join(' · ')));
  }

  // ================================================================ PRODUITS & PRIX
  private products(el: HTMLElement) {
    const st = this.game.st;
    const sel = h('select', { onchange: (e: Event) => { this.catFilter = (e.target as HTMLSelectElement).value as any; this.render(); } }, h('option', { value: 'all' }, 'Toutes catégories'), CATEGORIES.map((c) => h('option', { value: c.id, selected: this.catFilter === c.id }, `${c.icon} ${c.name}`)));
    const bulk = (m: number) => {
      for (const p of PRODUCTS) if (this.catFilter === 'all' || p.category === this.catFilter) st.prices[p.id] = psychologicalPrice(p.cost * (1 + m));
      this.game.equipView.markDirty();
      this.render();
    };
    el.append(
      h('div', { class: 'row wrap', style: { marginBottom: '8px' } }, sel, h('span', { class: 'muted small' }, `Indice de prix : ${(priceIndex(st) * 100).toFixed(0)} (100 = marché)`), h('span', { style: { flex: '1' } }), h('button', { class: 'btn small', onclick: () => bulk(0.18) }, 'Marge 18 %'), h('button', { class: 'btn small', onclick: () => bulk(0.3) }, 'Marge 30 %'), h('button', { class: 'btn small', onclick: () => bulk(0.45) }, 'Marge 45 %')),
    );
    const rows = PRODUCTS.filter((p) => this.catFilter === 'all' || p.category === this.catFilter).map((p) => {
      const listed = st.assortment.includes(p.id);
      const price = basePrice(st, p.id);
      const margin = (price - p.cost) / price;
      const priceInput = h('input', {
        type: 'number',
        step: '0.01',
        min: '0.05',
        value: price.toFixed(2),
        style: { width: '76px' },
        onchange: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (v > 0) {
            st.prices[p.id] = Math.round(v * 100) / 100;
            this.game.equipView.markDirty();
            this.render();
          }
        },
      });
      const promo = promosFor(st, p.id)[0];
      return h(
        'tr',
        null,
        h('td', null, h('input', { type: 'checkbox', checked: listed, title: 'Référencé', onchange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; if (on && !st.assortment.includes(p.id)) st.assortment.push(p.id); if (!on) st.assortment = st.assortment.filter((x) => x !== p.id); } })),
        h('td', null, h('div', { style: { fontWeight: '700' } }, p.name), h('div', { class: 'small muted' }, `${p.brand}${p.tier === 'premium' ? ' · premium' : p.tier === 'mdd' ? ' · MDD' : p.tier === 'local' ? ' · local' : ''}${p.seasonal ? ' · saison' : ''}${promo ? ` · 🔥 ${promo.name}` : ''}`)),
        h('td', { class: 'num' }, `${shelfUnits(st, p.id)}/${shelfCapacity(st, p.id)}`),
        h('td', { class: 'num' }, backroomUnits(st, p.id)),
        h('td', { class: 'num' }, money(p.cost)),
        h('td', { class: 'num' }, money(p.price)),
        h('td', null, priceInput),
        h('td', { class: `num ${margin < 0.05 ? 'bad' : margin > 0.25 ? 'good' : ''}` }, pct(margin)),
        h('td', { class: 'num' }, avgDailySales(st, p.id).toFixed(1)),
        h('td', null, h('button', { class: 'btn small', onclick: () => this.promoDialog([p.id]) }, 'Promo')),
      );
    });
    el.append(h('table', { class: 'data' }, h('thead', null, h('tr', null, ['', 'Produit', 'Rayon', 'Réserve', 'Achat', 'Marché', 'Prix', 'Marge', 'Ventes/j', ''].map((x) => h('th', { class: ['Rayon', 'Réserve', 'Achat', 'Marché', 'Marge', 'Ventes/j'].includes(x) ? 'num' : '' }, x)))), h('tbody', null, rows)));
  }

  promoDialog(pids: string[], category?: CategoryId) {
    const st = this.game.st;
    let kind: any = 'percent';
    let value = 0.2;
    let days = 3;
    let adv = true;
    const valueRow = h('label', { class: 'field' }, 'Remise', h('input', { type: 'range', min: '5', max: '60', value: '20', oninput: (e: Event) => { value = Number((e.target as HTMLInputElement).value) / 100; valLbl.textContent = `${Math.round(value * 100)} %`; } }));
    const valLbl = h('span', { class: 'small muted' }, '20 %');
    const body = h(
      'div',
      { class: 'col' },
      h('div', { class: 'muted small' }, pids.length ? pids.map((p) => PRODUCT_BY_ID[p].name).join(', ') : `Catégorie : ${CATEGORY_BY_ID[category!].name}`),
      h('label', { class: 'field' }, 'Type', h('select', { onchange: (e: Event) => { kind = (e.target as HTMLSelectElement).value; valueRow.style.display = kind === 'percent' || kind === 'flash' || kind === 'antigaspi' ? '' : 'none'; } }, PROMO_KINDS.map((k) => h('option', { value: k.id }, k.name)))),
      valueRow,
      valLbl,
      h('label', { class: 'field' }, 'Durée (jours)', h('input', { type: 'number', min: '1', max: '14', value: '3', onchange: (e: Event) => (days = Math.max(1, Number((e.target as HTMLInputElement).value))) })),
      h('label', { class: 'field' }, 'Affichage en magasin et en vitrine', h('input', { type: 'checkbox', checked: true, onchange: (e: Event) => (adv = (e.target as HTMLInputElement).checked) })),
      h('div', { class: 'small muted' }, 'Les clients sensibles aux promos réagissent : achats impulsifs, lots, venue au magasin si l’offre est affichée.'),
    );
    modal('🔥 Nouvelle promotion', body, [
      { label: 'Annuler' },
      {
        label: 'Lancer',
        primary: true,
        onClick: () => {
          const r = launchPromo(st, kind, { pids, category, value, days, advertised: adv });
          this.notify(r.msg, r.ok);
          this.game.equipView.markDirty();
          this.game.shelfIndex.invalidate();
          this.render();
        },
      },
    ]);
  }

  // ================================================================ COMMANDES
  private orders(el: HTMLElement) {
    const g = this.game;
    const st = g.st;
    const sups = availableSuppliers(st);
    const sup = SUPPLIER_BY_ID[this.orderSupplier] ?? sups[0];
    el.append(
      h('div', { class: 'row wrap' }, ...sups.map((s) => h('button', { class: `btn small ${s.id === sup.id ? 'active' : ''}`, onclick: () => { this.orderSupplier = s.id; this.orderLines.clear(); this.render(); } }, s.name))),
      h('div', { class: 'small muted', style: { margin: '6px 0' } }, `${sup.desc} Délai ~${sup.leadHours} h · fiabilité ${pct(sup.reliability)} · livraison ${money0(sup.deliveryFee)} · minimum ${money0(sup.minOrder)} · remises : ${sup.bulk.map((b) => `${b.cartons} cartons → −${Math.round(b.discount * 100)} %`).join(', ')}`),
      h('div', { class: 'row wrap', style: { marginBottom: '8px' } }, h('button', { class: 'btn small', onclick: () => { for (const n of reorderNeeds(st, 2)) if (supplierSells(sup, PRODUCT_BY_ID[n.pid].category)) this.orderLines.set(n.pid, n.cartons); this.render(); } }, '🪄 Suggérer (2 jours de stock)'), h('button', { class: 'btn small', onclick: () => { this.orderLines.clear(); this.render(); } }, 'Vider')),
    );
    const rows = PRODUCTS.filter((p) => supplierSells(sup, p.category) && (st.assortment.includes(p.id) || this.orderLines.has(p.id)) && (p.unlock ?? 0) <= st.store.stage + 1).map((p) => {
      const n = this.orderLines.get(p.id) ?? 0;
      const uc = unitCost(st, sup, p.id);
      return h(
        'tr',
        null,
        h('td', null, h('div', { style: { fontWeight: '700' } }, p.name), h('div', { class: 'small muted' }, `${p.cartonQty}/carton${p.shelfLife ? ` · DLC ${p.shelfLife} j` : ''}${p.storage !== 'ambient' ? ' · ❄️ froid' : ''}`)),
        h('td', { class: 'num' }, `${shelfUnits(st, p.id)} + ${backroomUnits(st, p.id)}`),
        h('td', { class: 'num' }, avgDailySales(st, p.id).toFixed(1)),
        h('td', { class: 'num' }, money(uc * p.cartonQty)),
        h('td', null, h('div', { class: 'row', style: { gap: '4px' } }, h('button', { class: 'btn small', onclick: () => { this.orderLines.set(p.id, Math.max(0, n - 1)); this.render(); } }, '−'), h('b', { style: { minWidth: '22px', textAlign: 'center' } }, n), h('button', { class: 'btn small', onclick: () => { this.orderLines.set(p.id, n + 1); this.render(); } }, '+'))),
      );
    });
    // produits non référencés de ce fournisseur
    const extra = PRODUCTS.filter((p) => supplierSells(sup, p.category) && !st.assortment.includes(p.id) && !this.orderLines.has(p.id) && (p.unlock ?? 0) <= st.store.stage + 1);
    el.append(h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Produit', 'Stock', 'Ventes/j', 'Prix carton', 'Cartons'].map((x) => h('th', null, x)))), h('tbody', null, rows)));
    if (extra.length)
      el.append(h('div', { class: 'row wrap small', style: { marginTop: '6px' } }, h('span', { class: 'muted' }, 'Ajouter au catalogue :'), h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) { this.orderLines.set(v, 1); if (!st.assortment.includes(v)) st.assortment.push(v); this.render(); } } }, h('option', { value: '' }, '— nouveau produit —'), extra.map((p) => h('option', { value: p.id }, `${p.name}${p.seasonal ? ' (saison)' : ''}`)))));
    const lines = [...this.orderLines].filter(([, n]) => n > 0).map(([pid, cartons]) => ({ pid, cartons }));
    const q = quote(st, sup.id, lines);
    el.append(
      h(
        'div',
        { class: 'panel', style: { padding: '10px', marginTop: '10px', position: 'sticky', bottom: '0' } },
        h('div', { class: 'row between' }, h('div', null, `${q.cartons} carton(s) · marchandises ${money(q.goods)}${q.discount ? ` − remise ${money(q.discount)}` : ''} + livraison ${money(q.fee)} = `, h('b', null, money(q.total))), h('button', { class: 'btn primary', disabled: !q.ok, onclick: () => { const o = placeOrder(st, g.rng, sup.id, lines); if (o) { this.orderLines.clear(); this.notify(`Commande #${o.id} passée chez ${sup.name}. Livraison prévue vers ${fmtClock(o.eta % 1440)} (J${dayOf(o.eta) + 1}).`); this.render(); } } }, 'Commander')),
        !q.ok && q.reason ? h('div', { class: 'small bad' }, q.reason) : null,
      ),
    );
    // commandes en cours
    const pending = st.orders.filter((o) => o.status === 'en_cours' || o.status === 'livraison').slice(-10);
    el.append(h('div', { class: 'section-title' }, 'Commandes en cours'));
    if (!pending.length) el.append(h('div', { class: 'muted small' }, 'Aucune commande en attente.'));
    for (const o of pending)
      el.append(
        h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, `#${o.id} · ${SUPPLIER_BY_ID[o.supplier].name}${o.auto ? ' 🤖' : ''}`), h('div', { class: 'small muted' }, `${o.lines.map((l) => `${l.cartons}× ${PRODUCT_BY_ID[l.pid].name}`).join(', ')} · ${o.status === 'livraison' ? '🚚 en cours de livraison' : `prévue J${dayOf(o.eta) + 1} ${fmtClock(o.eta % 1440)}${o.delayed ? ' (retard probable)' : ''}`}`)), o.status === 'en_cours' ? h('button', { class: 'btn small', onclick: () => { cancelOrder(st, o.id); this.render(); } }, 'Annuler') : null),
      );
    // contrats & automatisation
    el.append(h('div', { class: 'section-title' }, 'Contrats fournisseurs'));
    for (const c of st.contracts) el.append(h('div', { class: 'small' }, `📄 ${SUPPLIER_BY_ID[c.supplier].name} : −${(c.discount * 100).toFixed(1)} %, ${c.cartonsThisWeek}/${c.weeklyCartons} cartons cette semaine, jusqu’au J${c.until + 1}`));
    el.append(h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onclick: () => { const r = negotiateContract(st, g.rng, sup.id, 25); this.notify(r.text, r.ok); this.render(); } }, `Négocier avec ${sup.name} (25 cartons/sem.)`), h('button', { class: 'btn small', onclick: () => { const r = negotiateContract(st, g.rng, sup.id, 60); this.notify(r.text, r.ok); this.render(); } }, '(60 cartons/sem.)')));
    const soft = !!st.store.upgrades['logiciel_stock'];
    el.append(
      h('div', { class: 'section-title' }, 'Réapprovisionnement automatique'),
      soft
        ? h('div', { class: 'col' }, h('label', { class: 'field' }, 'Activé (7 h et 15 h)', h('input', { type: 'checkbox', checked: st.store.autoOrder.enabled, onchange: (e: Event) => (st.store.autoOrder.enabled = (e.target as HTMLInputElement).checked) })), h('label', { class: 'field' }, `Couverture visée : ${st.store.autoOrder.threshold} jour(s)`, h('input', { type: 'range', min: '1', max: '7', value: String(st.store.autoOrder.threshold), onchange: (e: Event) => { st.store.autoOrder.threshold = Number((e.target as HTMLInputElement).value); this.render(); } })), h('label', { class: 'field' }, 'Fournisseur préféré', h('select', { onchange: (e: Event) => (st.store.autoOrder.supplier = (e.target as HTMLSelectElement).value) }, sups.map((s) => h('option', { value: s.id, selected: s.id === st.store.autoOrder.supplier }, s.name)))), h('div', { class: 'small muted' }, 'Un logisticien ou un manager compétent commande plus juste.'))
        : h('div', { class: 'small muted' }, 'Nécessite le « Logiciel de gestion de stock » (onglet Magasin → améliorations).'),
    );
  }

  // ================================================================ RÉSERVE
  private backroom(el: HTMLElement) {
    const g = this.game;
    const st = g.st;
    const racks = st.equipment.filter((e) => e.cartons);
    const used = racks.reduce((a, r) => a + (r.cartons?.length ?? 0), 0);
    const cap = racks.reduce((a, r) => a + (EQUIPMENT_BY_ID[r.def].cartons ?? 0), 0);
    el.append(h('div', { class: 'cards' }, this.card('Occupation', `${used}/${cap}`, 'cartons'), this.card('Sur palettes', String(st.pallets.reduce((a, p) => a + p.cartons.length, 0)), 'à ranger'), this.card('Cartons au sol', String(st.worldCartons.length))));
    if (this.rackUid !== null) {
      const rack = st.equipment.find((e) => e.uid === this.rackUid);
      if (rack?.cartons) {
        el.append(h('div', { class: 'section-title' }, `Prendre un carton dans « ${EQUIPMENT_BY_ID[rack.def].name} »`));
        const byPid = new Map<string, number[]>();
        rack.cartons.forEach((c, i) => byPid.set(c.pid, [...(byPid.get(c.pid) ?? []), i]));
        for (const [pid, idxs] of byPid)
          el.append(h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, PRODUCT_BY_ID[pid].name), h('div', { class: 'small muted' }, `${idxs.length} carton(s)`)), h('button', { class: 'btn small primary', onclick: () => { g.player.interaction.takeFromRack(rack, idxs[0]); this.close(); } }, 'Prendre')));
      }
    }
    const rows = st.assortment.map((pid) => ({ pid, br: backroomUnits(st, pid), sh: shelfUnits(st, pid) })).filter((r) => r.br > 0).sort((a, b) => b.br - a.br);
    el.append(h('div', { class: 'section-title' }, 'Stock en réserve'), h('table', { class: 'data' }, h('thead', null, h('tr', null, ['Produit', 'Réserve', 'Rayon', 'Jours de stock'].map((x) => h('th', null, x)))), h('tbody', null, rows.map((r) => h('tr', null, h('td', null, PRODUCT_BY_ID[r.pid].name), h('td', { class: 'num' }, r.br), h('td', { class: 'num' }, r.sh), h('td', { class: 'num' }, ((r.br + r.sh) / avgDailySales(st, r.pid)).toFixed(1)))))));
  }

  // ================================================================ PERSONNEL
  private staff(el: HTMLElement) {
    const g = this.game;
    const st = g.st;
    el.append(h('div', { class: 'cards' }, this.card('Effectif', String(st.employees.length)), this.card('Masse salariale / jour', money0(estimatedDailyWages(st))), this.card('Présents', String(g.staff.present().length)), this.card('Moral moyen', st.employees.length ? pct(st.employees.reduce((a, e) => a + e.mood, 0) / st.employees.length) : '—')));
    for (const e of st.employees) el.append(this.employeeRow(e));
    if (!st.employees.length) el.append(h('div', { class: 'empty' }, 'Aucun employé. Vous faites tout vous-même… pour l’instant.'));
    // annonces
    el.append(h('div', { class: 'section-title' }, 'Publier une offre d’emploi'));
    let role: RoleId = 'caissier';
    let wage = 13;
    let days = 3;
    const wageLbl = h('b', null, `${wage.toFixed(1)} €/h`);
    el.append(
      h(
        'div',
        { class: 'row wrap' },
        h('select', { onchange: (ev: Event) => { role = (ev.target as HTMLSelectElement).value as RoleId; wage = ROLE_BY_ID[role].baseWage + 1; wageLbl.textContent = `${wage.toFixed(1)} €/h`; } }, ROLES.map((r) => h('option', { value: r.id }, `${r.icon} ${r.name}`))),
        h('input', { type: 'range', min: '11', max: '28', step: '0.5', value: '13', style: { width: '140px' }, oninput: (ev: Event) => { wage = Number((ev.target as HTMLInputElement).value); wageLbl.textContent = `${wage.toFixed(1)} €/h`; } }),
        wageLbl,
        h('select', { onchange: (ev: Event) => (days = Number((ev.target as HTMLSelectElement).value)) }, [3, 7, 14].map((d) => h('option', { value: d }, `${d} jours (${40 + d * 15} €)`))),
        h('button', { class: 'btn small primary', onclick: () => { if (postJob(st, role, wage, days)) this.notify('Offre publiée : les candidatures arrivent au fil des heures.'); else this.notify('Trésorerie insuffisante.', false); this.render(); } }, 'Publier'),
      ),
    );
    for (const j of st.jobPostings) el.append(h('div', { class: 'small muted' }, `📌 ${ROLE_BY_ID[j.role].name} à ${j.wage.toFixed(1)} €/h, jusqu’au J${j.until + 1}`));
    el.append(h('div', { class: 'section-title' }, `Candidatures (${st.candidates.length})`));
    if (!st.candidates.length) el.append(h('div', { class: 'muted small' }, 'Aucune candidature. Publiez une offre (un meilleur salaire attire de meilleurs profils).'));
    for (const c of st.candidates) {
      el.append(
        h(
          'div',
          { class: 'list-item' },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, `${ROLE_BY_ID[c.role].icon} ${c.name} — ${ROLE_BY_ID[c.role].name}`), h('div', { class: 'small' }, `Compétence ${pct(c.skill)} · vitesse ${pct(c.speed)} · fiabilité ${pct(c.reliability)} · ${Math.round(c.experience)} h d’expérience`), h('div', { class: 'small muted' }, `${c.traits.map((t) => TRAITS.find((x) => x.id === t)!.name).join(', ')} — « ${c.pitch} »`)),
          h('div', { class: 'col', style: { alignItems: 'flex-end' } }, h('div', { class: 'small' }, `Demande ${c.expectedWage.toFixed(2)} €/h`), h('button', { class: 'btn small primary', onclick: () => { const r = hire(st, c.id, Math.max(c.wage, c.expectedWage)); this.notify(r.msg, r.ok); this.render(); } }, `Embaucher (${Math.max(c.wage, c.expectedWage).toFixed(2)} €/h)`)),
        ),
      );
    }
  }

  private employeeRow(e: Employee): HTMLElement {
    const g = this.game;
    const st = g.st;
    const agent = g.staff.agents.find((a) => a.emp === e);
    const status = e.absentToday ? '🤒 absent' : e.trainingUntil >= dayOf(st.time) ? '🎓 en formation' : agent ? (agent.state === 'break' ? '☕ pause' : agent.task ? `🛠️ ${agent.task.kind}` : `🟢 ${agent.state}`) : '⚪ hors service';
    const hours = h('div', { class: 'row', style: { gap: '4px' } }, h('input', { type: 'number', min: '0', max: '23', value: String(e.shiftStart), style: { width: '52px' }, onchange: (ev: Event) => (e.shiftStart = Math.max(0, Math.min(23, Number((ev.target as HTMLInputElement).value)))) }), '→', h('input', { type: 'number', min: '1', max: '24', value: String(e.shiftEnd), style: { width: '52px' }, onchange: (ev: Event) => (e.shiftEnd = Math.max(e.shiftStart + 1, Math.min(24, Number((ev.target as HTMLInputElement).value)))) }), 'h');
    const days = h('div', { class: 'row', style: { gap: '2px' } }, DAY_NAMES.map((d, i) => h('button', { class: `btn small ${e.daysOff.includes(i) ? '' : 'active'}`, title: e.daysOff.includes(i) ? `${d} : repos` : `${d} : travaille`, onclick: (ev: Event) => { e.daysOff = e.daysOff.includes(i) ? e.daysOff.filter((x) => x !== i) : [...e.daysOff, i]; (ev.target as HTMLElement).classList.toggle('active'); } }, d[0])));
    const lanes = [...g.checkouts.lanes.values()].filter((l) => !l.auto);
    const zoneSel =
      e.role === 'caissier'
        ? h('select', { onchange: (ev: Event) => (e.zone = (ev.target as HTMLSelectElement).value || null) }, h('option', { value: '' }, 'Caisse : auto'), lanes.map((l, i) => h('option', { value: String(l.uid), selected: e.zone === String(l.uid) }, `Caisse ${i + 1}`)))
        : e.role === 'securite'
          ? h('select', { onchange: (ev: Event) => (e.zone = (ev.target as HTMLSelectElement).value || null) }, [['', 'Ronde dans le magasin'], ['entree', 'Poste à l’entrée'], ['monitor', 'Poste vidéo']].map(([v, n]) => h('option', { value: v, selected: (e.zone ?? '') === v }, n)))
          : h('select', { onchange: (ev: Event) => (e.priority = (ev.target as HTMLSelectElement).value || null) }, [['', 'Priorité : auto'], ['restock', 'Remplir les rayons'], ['putaway', 'Ranger les livraisons'], ['pickup', 'Ramasser'], ['clean', 'Nettoyer'], ['expired', 'Retirer les périmés']].map(([v, n]) => h('option', { value: v, selected: (e.priority ?? '') === v }, n)));
    return h(
      'div',
      { class: 'list-item', style: { alignItems: 'flex-start' } },
      h(
        'div',
        { class: 'grow col', style: { gap: '4px' } },
        h('div', { class: 'title' }, `${ROLE_BY_ID[e.role].icon} ${e.name} `, h('span', { class: 'small muted' }, `${ROLE_BY_ID[e.role].name} · ${e.wage.toFixed(2)} €/h · ${status}`)),
        h('div', { class: 'small' }, `Compétence ${pct(e.skill)} · moral ${pct(e.mood)} · fatigue ${pct(e.fatigue)} · ${Math.round(e.experience)} h · ${e.traits.map((t) => TRAITS.find((x) => x.id === t)!.name).join(', ')}`),
        h('div', { class: 'row wrap' }, hours, days, zoneSel),
      ),
      h(
        'div',
        { class: 'col' },
        h('button', { class: 'btn small', onclick: () => { if (train(st, e.id)) this.notify(`${e.name} part en formation demain (+compétence).`); else this.notify('Formation impossible (trésorerie ou déjà en formation).', false); this.render(); } }, `Former (${trainingCost(e)} €)`),
        h('button', { class: 'btn small', onclick: () => { e.wage = Math.round((e.wage + 0.5) * 100) / 100; e.mood = clamp01(e.mood + 0.1); this.notify(`${e.name} est augmenté·e ! Moral en hausse.`); this.render(); } }, '+0,50 €/h'),
        h('button', { class: 'btn small danger', onclick: () => modal('Licencier ?', h('div', null, `${e.name} recevra une indemnité. Le moral de l’équipe baissera.`), [{ label: 'Annuler' }, { label: 'Licencier', danger: true, onClick: () => { const c = fire(st, e.id); this.notify(`${e.name} a quitté l’équipe (indemnité ${money0(c)}).`, false); this.render(); } }]) }, 'Licencier'),
      ),
    );
  }

  // ================================================================ MARKETING
  private marketing(el: HTMLElement) {
    const st = this.game.st;
    const day = dayOf(st.time);
    el.append(h('div', { class: 'section-title' }, 'Promotions actives'));
    const active = st.promos.filter((p) => p.end >= day);
    if (!active.length) el.append(h('div', { class: 'muted small' }, 'Aucune promotion. Les chasseurs de promos regardent ailleurs…'));
    for (const p of active)
      el.append(h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, `🔥 ${p.name}${p.value ? ` −${Math.round(p.value * 100)} %` : ''}`), h('div', { class: 'small muted' }, `${p.pids.length ? p.pids.map((x) => PRODUCT_BY_ID[x].name).join(', ') : p.category ? CATEGORY_BY_ID[p.category].name : 'Tous les produits à date courte'} · jusqu’au J${p.end + 1}${p.advertised ? ' · affichée' : ''}`)), h('button', { class: 'btn small', onclick: () => { stopPromo(st, p.id); this.game.equipView.markDirty(); this.render(); } }, 'Arrêter')));
    el.append(
      h('div', { class: 'row wrap', style: { marginTop: '6px' } }, h('button', { class: 'btn small primary', onclick: () => this.select('produits') }, 'Promo sur un produit…'), h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value as CategoryId; if (v) this.promoDialog([], v); } }, h('option', { value: '' }, 'Promo sur une catégorie…'), CATEGORIES.map((c) => h('option', { value: c.id }, `${c.icon} ${c.name}`))), h('button', { class: 'btn small', onclick: () => { const r = launchPromo(st, 'antigaspi', { value: 0.4, days: 14, advertised: false }); this.notify(r.msg, r.ok); this.render(); } }, '♻️ Anti-gaspi automatique (−40 %, 14 j)')),
    );
    el.append(h('div', { class: 'section-title' }, 'Campagnes'));
    for (const c of CAMPAIGNS) {
      const running = st.campaigns.find((x) => x.kind === c.id && x.end >= day);
      el.append(h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, c.name), h('div', { class: 'small muted' }, `${c.desc} · ${c.days} j`)), running ? h('span', { class: 'tag y' }, `En cours (J${running.end + 1})`) : h('button', { class: 'btn small primary', onclick: () => { const r = launchCampaign(st, c.id); this.notify(r.msg, r.ok); this.render(); } }, money0(c.cost))));
    }
    const aware = st.residents.reduce((a, r) => a + r.awareness, 0) / Math.max(1, st.residents.length);
    const members = st.residents.filter((r) => r.memory.loyaltyMember).length;
    el.append(h('div', { class: 'section-title' }, 'Notoriété & fidélité'), h('div', { class: 'cards' }, this.card('Notoriété moyenne', pct(aware)), this.card('Habitants clients', String(st.residents.filter((r) => r.memory.visits > 0).length), `sur ${st.residents.length}`), this.card('Cartes de fidélité', st.store.upgrades['carte_fidelite'] ? String(members) : '—', st.store.upgrades['carte_fidelite'] ? 'membres (−5 %)' : 'Programme non activé')));
    if (st.store.upgrades['carte_fidelite'])
      el.append(h('button', { class: 'btn small', onclick: () => { let n = 0; for (const r of st.residents) if (!r.memory.loyaltyMember && r.memory.visits >= 2 && Math.random() < 0.5) { r.memory.loyaltyMember = true; n++; } this.notify(`${n} habitué(s) inscrit(s) au programme de fidélité.`); this.render(); } }, 'Démarcher les habitués'));
  }

  // ================================================================ FINANCES
  private finances(el: HTMLElement) {
    const g = this.game;
    const st = g.st;
    const t = st.today;
    const fc = forecast(st);
    el.append(h('div', { class: 'cards' }, this.card('Trésorerie', money0(st.cash), undefined, st.cash < 0 ? 'bad' : ''), this.card('Résultat du jour', money(dayProfit(t)), 'ventes − coût − charges'), this.card('Prévision / jour', money0(fc.profit), `CA moyen ${money0(fc.revenue)} · charges ${money0(fc.fixed)}`, fc.profit < 0 ? 'bad' : 'good'), this.card('Autonomie', fc.runwayDays === Infinity ? '∞' : `${fc.runwayDays} j`, 'avant trésorerie nulle')));
    const days = [...st.ledger.slice(-13), st.today];
    el.append(
      chart(
        [
          { label: 'CA', color: '#ffc72c', values: days.map((d) => d.revenue), type: 'bar' },
          { label: 'Charges', color: '#ff5c4d', values: days.map((d) => d.cogs + Object.entries(d.expenses).reduce((a, [k, v]) => a + (k === 'marchandises' || k === 'equipement' || k === 'travaux' ? 0 : v), 0)), type: 'bar' },
          { label: 'Résultat', color: '#2ecc71', values: days.map((d) => dayProfit(d)) },
        ],
        days.map((d) => `J${d.day + 1}`),
        { money: true },
      ),
    );
    const exp = Object.entries(t.expenses).filter(([, v]) => v > 0.005);
    el.append(
      h('div', { class: 'section-title' }, 'Compte du jour'),
      h(
        'div',
        { class: 'report-grid small' },
        h('span', null, 'Ventes'),
        h('b', { class: 'num good' }, money(t.revenue)),
        h('span', null, 'Coût des marchandises vendues'),
        h('span', { class: 'num' }, `−${money(t.cogs)}`),
        ...exp.flatMap(([k, v]) => [h('span', { class: 'muted' }, k === 'marchandises' ? 'Achats de stock (trésorerie)' : k[0].toUpperCase() + k.slice(1)), h('span', { class: 'num' }, `−${money(v)}`)]),
        ...Object.entries(t.incomes).filter(([k, v]) => v > 0 && k !== 'ventes').flatMap(([k, v]) => [h('span', { class: 'muted' }, k[0].toUpperCase() + k.slice(1)), h('span', { class: 'num good' }, `+${money(v)}`)]),
        h('span', null, 'Démarque (vols)'),
        h('span', { class: 'num bad' }, money(t.theftLoss)),
      ),
      h('div', { class: 'section-title' }, 'Charges fixes quotidiennes'),
      h('div', { class: 'report-grid small' }, ...fixedCostsPreview(st).flatMap((c) => [h('span', null, c.label), h('span', { class: 'num' }, money(c.amount))]), h('span', null, 'Salaires estimés'), h('span', { class: 'num' }, money(estimatedDailyWages(st)))),
      h('div', { class: 'small muted' }, `Électricité : ${dailyKwh(st).toFixed(0)} kWh/j à ${KWH_PRICE} €/kWh. Impôts & charges : 22 % du bénéfice hebdomadaire, prélevés le dimanche.`),
    );
    // emprunt
    el.append(h('div', { class: 'section-title' }, 'Banque'));
    if (st.loan) el.append(h('div', { class: 'row between' }, h('div', { class: 'small' }, `Emprunt : reste ${money0(st.loan.remaining)} · ${money(st.loan.daily)}/jour · taux ${(st.loan.rate * 100).toFixed(1)} %`), h('button', { class: 'btn small', onclick: () => { this.notify(repayLoan(st) ? 'Emprunt remboursé !' : 'Trésorerie insuffisante.', !!st.loan === false); this.render(); } }, 'Rembourser')));
    else {
      const max = maxLoan(st);
      let amt = Math.min(10000, max);
      let days = 60;
      const lbl = h('b', null, money0(amt));
      el.append(h('div', { class: 'row wrap' }, h('input', { type: 'range', min: '1000', max: String(max), step: '500', value: String(amt), style: { width: '160px' }, oninput: (e: Event) => { amt = Number((e.target as HTMLInputElement).value); lbl.textContent = money0(amt); } }), lbl, h('select', { onchange: (e: Event) => (days = Number((e.target as HTMLSelectElement).value)) }, [30, 60, 120].map((d) => h('option', { value: d, selected: d === 60 }, `${d} jours`))), h('button', { class: 'btn small primary', onclick: () => { this.notify(takeLoan(st, amt, days) ? `Prêt de ${money0(amt)} accordé.` : 'La banque refuse.', true); this.render(); } }, 'Emprunter')), h('div', { class: 'small muted' }, `Plafond accordé par la banque : ${money0(max)}`));
    }
    // assurance
    el.append(h('div', { class: 'section-title' }, 'Assurance'), h('div', { class: 'row wrap' }, ([['Aucune', 0], ['Basique (60 %, franchise 300 €)', 1], ['Premium (90 %, franchise 100 €)', 2]] as const).map(([n, v]) => h('button', { class: `btn small ${st.store.insurance === v ? 'active' : ''}`, onclick: () => { st.store.insurance = v; this.render(); } }, n))), h('div', { class: 'small muted' }, `Prime actuelle : ${money(insuranceDaily(st))}/jour · ${st.insuranceClaims} sinistre(s) déclaré(s)`));
  }

  // ================================================================ CONCURRENCE
  private competition(el: HTMLElement) {
    const st = this.game.st;
    const share = marketShare(st);
    el.append(h('div', { class: 'cards' }, this.card('Votre part de marché', pct(share)), this.card('Votre indice de prix', (priceIndex(st) * 100).toFixed(0), '100 = prix du marché'), this.card('Votre réputation', `${Math.round(st.reputation.overall)}`)));
    for (const c of st.competitors) {
      const def = COMPETITORS.find((x) => x.id === c.id)!;
      const last = c.history.slice(-7);
      const avg = last.length ? last.reduce((a, h2) => a + h2.customers, 0) / last.length : 0;
      el.append(
        h(
          'div',
          { class: 'list-item', style: { borderLeft: `4px solid ${hex(def.color)}` } },
          h('div', { class: 'grow' }, h('div', { class: 'title' }, def.name, ' ', h('span', { class: `tag ${c.closedForever ? 'r' : c.open ? 'g' : ''}` }, c.closedForever ? 'Fermé' : c.open ? 'Ouvert' : 'Bientôt')), h('div', { class: 'small muted' }, def.desc), h('div', { class: 'small' }, `Indice prix ${(c.priceIndex * 100).toFixed(0)} · qualité ${pct(c.quality)} · service ${pct(c.service)} · réputation ${Math.round(c.reputation)} · ~${Math.round(avg)} clients/j${c.promoCategory ? ` · 🔥 promo ${CATEGORY_BY_ID[c.promoCategory].name} −${Math.round(c.promoDepth * 100)} %` : ''}`)),
        ),
      );
    }
    const days = st.ledger.slice(-14);
    if (days.length > 1)
      el.append(
        h('div', { class: 'section-title' }, 'Fréquentation comparée'),
        chart(
          [{ label: 'Vous', color: '#ffc72c', values: days.map((d) => d.customers) }, ...st.competitors.filter((c) => c.history.length).map((c) => ({ label: c.name, color: hex(COMPETITORS.find((x) => x.id === c.id)!.color), values: days.map((d) => c.history.find((h2) => h2.day === d.day)?.customers ?? 0) }))],
          days.map((d) => `J${d.day + 1}`),
        ),
      );
    el.append(h('div', { class: 'small muted', style: { marginTop: '8px' } }, 'Astuce : allez devant la porte d’un concurrent et appuyez sur E pour relever ses prix.'));
  }

  // ================================================================ SÉCURITÉ
  private security(el: HTMLElement) {
    const g = this.game;
    const st = g.st;
    const cov = coverageGrid(st);
    const nightGuard = st.employees.some((e) => e.role === 'securite' && (e.shiftEnd >= 24 || e.shiftStart <= 3));
    el.append(h('div', { class: 'cards' }, this.card('Caméras', String(st.equipment.filter((e) => e.def === 'camera').length), `couverture ${cov.total ? pct(cov.covered / cov.total) : '0 %'}`), this.card('Dissuasion', pct(g.security.deterrence())), this.card('Risque d’effraction', pct(burglaryRisk(st, nightGuard)), 'par nuit'), this.card('Vols ce mois', String(st.incidents.filter((i) => i.kind === 'vol' && i.day > dayOf(st.time) - 30).length)), this.card('Voleurs interpellés', String(st.stats.thievesCaught))));
    el.append(h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onclick: () => g.bus.emit('notify', { text: 'Ouvrez le mode construction (B) pour voir la couverture des caméras et les angles morts.', kind: 'info' }) }, '🗺️ Voir les angles morts'), st.store.upgrades['alarme'] ? h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: st.store.alarmArmed, onchange: (e: Event) => (st.store.alarmArmed = (e.target as HTMLInputElement).checked) }), 'Alarme armée (automatique à la fermeture)') : null));
    el.append(h('div', { class: 'section-title' }, 'Équipements de sécurité'));
    for (const u of UPGRADES.filter((x) => x.category === 'securite')) el.append(this.upgradeRow(u.id));
    el.append(h('div', { class: 'section-title' }, 'Incidents récents'));
    const inc = st.incidents.slice(-15).reverse();
    if (!inc.length) el.append(h('div', { class: 'muted small' }, 'Aucun incident. Profitez-en.'));
    for (const i of inc)
      el.append(h('div', { class: 'list-item' }, h('div', { class: 'grow small' }, h('b', null, `J${i.day + 1} ${fmtClock(i.minute)} · `), i.text, i.onCamera ? ' 📹' : ''), i.kind === 'vol' && !i.resolved ? h('button', { class: 'btn small', onclick: () => { this.notify(g.security.fileComplaint(i.id)); this.render(); } }, 'Porter plainte') : null));
    const q = st.quartiers;
    el.append(h('div', { class: 'section-title' }, 'Quartiers'), h('div', { class: 'cards' }, q.map((x) => this.card(x.name, `Sécurité ${pct(x.safety)}`, `Prospérité ${pct(x.prosperity)} · ${x.population} hab.`))));
  }

  private upgradeRow(id: string) {
    const st = this.game.st;
    const u = UPGRADES.find((x) => x.id === id)!;
    const owned = !!st.store.upgrades[id];
    return h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, u.name), h('div', { class: 'small muted' }, `${u.desc}${u.daily ? ` · ${u.daily} €/jour` : ''}`)), owned ? h('span', { class: 'tag g' }, 'Installé') : h('button', { class: 'btn small primary', onclick: () => { const m = this.game.buyUpgrade(id); this.notify(m, !!st.store.upgrades[id]); this.render(); } }, money0(u.price)));
  }

  // ================================================================ MAGASIN
  private store(el: HTMLElement) {
    const g = this.game;
    const st = g.st;
    const s = st.store;
    const rebuild = () => {
      g.rebuildStore();
      this.render();
    };
    // identité
    const logoImg = h('img', { src: logoDataUrl(s.logo, 96), style: { width: '72px', height: '72px' } });
    const refreshLogo = () => (logoImg.src = logoDataUrl(s.logo, 96));
    el.append(
      h('div', { class: 'section-title' }, 'Identité'),
      h(
        'div',
        { class: 'row wrap', style: { alignItems: 'flex-start' } },
        logoImg,
        h(
          'div',
          { class: 'col', style: { flex: '1', minWidth: '240px' } },
          h('label', { class: 'field' }, 'Nom du magasin', h('input', { type: 'text', value: s.name, maxLength: 28, onchange: (e: Event) => { s.name = (e.target as HTMLInputElement).value.trim() || 'BAZAR BAZAR'; rebuild(); } })),
          h('label', { class: 'field' }, 'Slogan', h('input', { type: 'text', value: s.slogan, maxLength: 60, onchange: (e: Event) => (s.slogan = (e.target as HTMLInputElement).value) })),
          h('label', { class: 'field' }, 'Icône du logo', h('select', { onchange: (e: Event) => { s.logo.icon = (e.target as HTMLSelectElement).value as any; refreshLogo(); } }, LOGO_ICONS.map((i) => h('option', { value: i, selected: s.logo.icon === i }, i)))),
          h('label', { class: 'field' }, 'Forme', h('select', { onchange: (e: Event) => { s.logo.shape = (e.target as HTMLSelectElement).value as any; refreshLogo(); } }, ['rond', 'carre', 'etiquette', 'blason'].map((i) => h('option', { value: i, selected: s.logo.shape === i }, i)))),
          h('div', { class: 'row wrap small' }, 'Couleurs :', h('input', { type: 'color', value: hex(s.logo.bg), oninput: (e: Event) => { s.logo.bg = unhex((e.target as HTMLInputElement).value); refreshLogo(); } }), h('input', { type: 'color', value: hex(s.logo.fg), oninput: (e: Event) => { s.logo.fg = unhex((e.target as HTMLInputElement).value); refreshLogo(); } }), h('input', { type: 'color', value: hex(s.logo.accent), oninput: (e: Event) => { s.logo.accent = unhex((e.target as HTMLInputElement).value); refreshLogo(); } }), ' Enseigne :', h('input', { type: 'color', value: hex(s.signBg), oninput: (e: Event) => (s.signBg = unhex((e.target as HTMLInputElement).value)) }), h('input', { type: 'color', value: hex(s.signFg), oninput: (e: Event) => (s.signFg = unhex((e.target as HTMLInputElement).value)) }), ' Uniformes :', h('input', { type: 'color', value: hex(s.uniform), oninput: (e: Event) => (s.uniform = unhex((e.target as HTMLInputElement).value)) })),
          h('button', { class: 'btn small primary', onclick: rebuild }, 'Appliquer l’enseigne et le logo'),
        ),
      ),
    );
    // style
    el.append(h('div', { class: 'section-title' }, 'Style & ambiance'), h('div', { class: 'row wrap' }, STYLE_PRESETS.map((p) => h('button', { class: `btn small ${s.style === p.id ? 'active' : ''}`, title: p.desc, onclick: () => { const cost = (FLOORS.find((f) => f.id === p.floor)!.price + WALLS.find((w) => w.id === p.wall)!.price) * (1 + s.stage * 0.5); if (!tryBuy(st, 'travaux', cost)) return this.notify('Trésorerie insuffisante.', false); Object.assign(s, { style: p.id, floor: p.floor, wall: p.wall, shelfColor: p.shelfColor, lightColor: p.light, uniform: p.uniform, signBg: p.signBg, signFg: p.signFg }); rebuild(); this.notify(`Style « ${p.name} » appliqué (${money0(cost)}).`); } }, p.name))));
    el.append(
      h('div', { class: 'row wrap' }, h('span', { class: 'small' }, 'Sol :'), FLOORS.map((f) => h('button', { class: `btn small ${s.floor === f.id ? 'active' : ''}`, onclick: () => { const c = f.price * (1 + s.stage * 0.5); if (f.id !== s.floor && !tryBuy(st, 'travaux', c)) return this.notify('Trésorerie insuffisante.', false); s.floor = f.id; rebuild(); } }, `${f.name}${f.price ? ` (${money0(f.price * (1 + s.stage * 0.5))})` : ''}`))),
      h('div', { class: 'row wrap', style: { marginTop: '4px' } }, h('span', { class: 'small' }, 'Murs :'), WALLS.map((w) => h('button', { class: `btn small ${s.wall === w.id ? 'active' : ''}`, onclick: () => { const c = w.price * (1 + s.stage * 0.5); if (w.id !== s.wall && !tryBuy(st, 'travaux', c)) return this.notify('Trésorerie insuffisante.', false); s.wall = w.id; rebuild(); } }, w.name))),
      h('label', { class: 'field' }, `Intensité de l’éclairage (${Math.round(s.lightLevel * 100)} %)`, h('input', { type: 'range', min: '50', max: '150', value: String(s.lightLevel * 100), onchange: (e: Event) => { s.lightLevel = Number((e.target as HTMLInputElement).value) / 100; g.storeBuilding.setLightLevel(s.lightLevel); this.render(); } })),
      h('label', { class: 'field' }, 'Couleur de la lumière', h('input', { type: 'color', value: hex(s.lightColor), onchange: (e: Event) => { s.lightColor = unhex((e.target as HTMLInputElement).value); rebuild(); } })),
      h('label', { class: 'field' }, 'Musique d’ambiance', h('select', { onchange: (e: Event) => (s.music = (e.target as HTMLSelectElement).value as any) }, MUSIC_STYLES.map((m) => h('option', { value: m.id, selected: s.music === m.id }, m.name)))),
      h('label', { class: 'field' }, 'Horaires', h('div', { class: 'row' }, h('input', { type: 'number', min: '5', max: '12', value: String(s.openHour), style: { width: '60px' }, onchange: (e: Event) => (s.openHour = Math.max(5, Math.min(12, Number((e.target as HTMLInputElement).value)))) }), '→', h('input', { type: 'number', min: '17', max: '24', value: String(s.closeHour), style: { width: '60px' }, onchange: (e: Event) => (s.closeHour = Math.max(17, Math.min(24, Number((e.target as HTMLInputElement).value)))) }), 'h')),
      h('div', { class: 'small muted' }, 'La façade (portes, vitrines, murs) se modifie en mode construction (B) → outil « Façade ».'),
    );
    // agrandissement
    const next = STAGES[s.stage + 1];
    el.append(h('div', { class: 'section-title' }, 'Agrandissement'));
    el.append(h('div', { class: 'small' }, `Actuel : ${STAGES[s.stage].name} (${(STAGES[s.stage].x1 - STAGES[s.stage].x0)} × ${STAGES[s.stage].z1} m) · loyer ${money0(STAGES[s.stage].rentPerDay)}/j`));
    if (s.construction) el.append(h('div', { class: 'tag y' }, `🏗️ Travaux en cours → ${STAGES[s.construction.toStage].name}, fin J${dayOf(s.construction.until) + 1} ${fmtClock(s.construction.until % 1440)}`));
    else if (next)
      el.append(h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, `➡️ ${next.name}`), h('div', { class: 'small muted' }, `${next.x1 - next.x0} × ${next.z1} m · ${next.days} jours de travaux · loyer ${money0(next.rentPerDay)}/j${next.land ? ` · terrain requis : ${LANDS.find((l) => l.id === next.land)!.name}` : ''}`)), h('button', { class: 'btn small primary', onclick: () => { this.notify(g.startExpansion(), !!s.construction); this.render(); } }, money0(next.cost))));
    el.append(h('div', { class: 'section-title' }, 'Terrains'));
    for (const l of LANDS) el.append(h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, l.name), h('div', { class: 'small muted' }, l.desc)), s.ownedLand.includes(l.id) ? h('span', { class: 'tag g' }, 'Acheté') : h('button', { class: 'btn small primary', onclick: () => { this.notify(g.buyLand(l.id), s.ownedLand.includes(l.id)); this.render(); } }, money0(l.price))));
    el.append(h('div', { class: 'section-title' }, 'Améliorations'));
    for (const u of UPGRADES.filter((x) => x.category !== 'securite')) el.append(this.upgradeRow(u.id));
    // plans
    el.append(h('div', { class: 'section-title' }, 'Plans de magasin sauvegardés'));
    el.append(h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onclick: () => { s.savedLayouts.push({ name: `Plan ${s.savedLayouts.length + 1} (J${dayOf(st.time) + 1})`, stage: s.stage, equip: st.equipment.map((e) => ({ def: e.def, gx: e.gx, gz: e.gz, rot: e.rot })) }); this.notify('Plan enregistré.'); this.render(); } }, '💾 Enregistrer le plan actuel')));
    for (const p of s.savedLayouts)
      el.append(
        h(
          'div',
          { class: 'list-item' },
          h('div', { class: 'grow small' }, `📐 ${p.name} — ${p.equip.length} équipements (palier ${p.stage})`),
          h('button', { class: 'btn small', onclick: () => modal('Appliquer ce plan ?', h('div', null, 'Les meubles existants sont réutilisés (avec leur stock), les manquants achetés, les surplus revendus (stock renvoyé en cartons au quai).'), [{ label: 'Annuler' }, { label: 'Appliquer', primary: true, onClick: () => { const r = applyLayout(st, p as any); g.layoutChanged(); g.items.rebuildFromState(); this.notify(`Plan appliqué : ${r.placed} placés (${r.bought} achetés, ${money0(r.cost)}), ${r.sold} revendus, ${r.skipped} ignorés.`); this.render(); } }]) }, 'Appliquer'),
          h('button', { class: 'btn small', onclick: () => { s.savedLayouts = s.savedLayouts.filter((x) => x !== p); this.render(); } }, '🗑️'),
        ),
      );
  }

  // ================================================================ OBJECTIFS
  private objectives(el: HTMLElement) {
    const st = this.game.st;
    const r = rank(st);
    el.append(h('div', { class: 'cards' }, this.card('Rang', r.name, r.next ? `prochain à ${money0(r.next)} de CA cumulé` : 'Rang maximum !'), this.card('CA cumulé', money0(st.stats.totalRevenue)), this.card('Clients servis', st.stats.customersServed.toLocaleString('fr-FR'))));
    el.append(h('div', { class: 'bar', style: { margin: '4px 0 12px' } }, h('i', { style: { width: `${r.progress * 100}%` } })));
    for (const o of OBJECTIVES) {
      const done = st.objectivesDone.includes(o.id);
      const v = Math.min(o.target, statValue(st, o.stat));
      el.append(h('div', { class: 'list-item', style: { opacity: done ? '0.6' : '1' } }, h('div', { style: { fontSize: '1.4em' } }, done ? '✅' : '🎯'), h('div', { class: 'grow' }, h('div', { class: 'title' }, o.name), h('div', { class: 'small muted' }, o.desc), done ? null : h('div', { class: 'bar' }, h('i', { style: { width: `${(v / o.target) * 100}%` } }))), h('span', { class: 'tag y' }, `+${money0(o.reward)}`)));
    }
    const s = st.stats;
    el.append(h('div', { class: 'section-title' }, 'Statistiques'), h('div', { class: 'small' }, `Articles vendus : ${s.unitsSold} · rangés par vous : ${s.unitsShelvedByPlayer} · scannés par vous : ${s.playerScans} · casse : ${s.itemsBroken} · commandes : ${s.ordersPlaced} · embauches : ${s.hires} · cambriolages : ${s.burglaries}`));
  }

  // ================================================================ JOURNAL
  private journal(el: HTMLElement) {
    const st = this.game.st;
    const logs = st.log.slice(-80).reverse();
    if (!logs.length) el.append(h('div', { class: 'empty' }, 'Rien à signaler.'));
    for (const l of logs) el.append(h('div', { class: `small ${l.kind === 'bad' ? 'bad' : l.kind === 'good' ? 'good' : ''}`, style: { padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' } }, h('span', { class: 'muted' }, `J${dayOf(l.t) + 1} ${fmtClock(l.t % 1440)} `), l.text));
  }
}

export const _unused = [SUPPLIERS, PLAYER];
