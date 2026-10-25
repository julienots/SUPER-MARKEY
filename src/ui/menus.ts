/**
 * Écrans hors jeu et dialogues : démarrage studio, menu principal comique, nouvelle partie, chargement,
 * options (graphismes, audio, commandes reconfigurables, accessibilité), crédits, pause,
 * rapport de fin de journée, faillite, éditeur de prix, assignation de produit, espionnage concurrent.
 */
import { h, clear, modal, keyLabel } from './dom';
import { money, money0, pct } from '../core/math';
import { SLOGANS } from '../data/lines';
import { STYLE_PRESETS } from '../data/styles';
import { COMPETITORS } from '../data/competitors';
import { CATEGORIES, PRODUCT_BY_ID, PRODUCTS, psychologicalPrice } from '../data/products';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { KEY_LABELS, DEFAULT_KEYS, saveSettings, type Settings } from '../game/settings';
import { SLOTS, slotMeta, deleteSlot } from '../save/save';
import { canHold, slotQty, assignSlot, backroomUnits } from '../sim/inventory';
import { basePrice, promosFor } from '../sim/pricing';
import { avgDailySales } from '../sim/orders';
import { dayOf, type PlacedEquip } from '../sim/state';
import type { DayCloseReport } from '../sim/economy';
import type { Game } from '../game/game';
import type { AudioEngine } from '../audio/audio';

const ui = () => document.getElementById('ui')!;
const BASE = import.meta.env?.BASE_URL ?? './';
export const asset = (p: string) => `${BASE}${p}`.replace(/\/\//g, '/');

/** Écran SuperEssence Studio. */
export function showSplash(onDone: () => void) {
  const el = h('div', { id: 'splash' }, h('img', { src: asset('brand/superessence-studio.jpg'), alt: 'SuperEssence Studio' }), h('div', { class: 'presents' }, 'PRÉSENTE'), h('div', { class: 'skip' }, 'Cliquez pour continuer'));
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
    onDone();
  };
  el.addEventListener('click', finish);
  window.addEventListener('keydown', finish, { once: true });
  ui().append(el);
  setTimeout(finish, 4200);
}

export interface MenuActions {
  newGame: (o: { name: string; difficulty: 'facile' | 'normal' | 'enfer'; style: string }) => void;
  continueGame: () => void;
  load: (slot: string) => void;
  importFile: (json: string) => void;
}

export class Menus {
  menuEl: HTMLElement | null = null;
  private burstTimer: number | null = null;

  constructor(private settings: Settings, private audio: AudioEngine, private actions: MenuActions) {}

  showMainMenu() {
    this.hideMainMenu();
    const hasSave = SLOTS.some((s) => slotMeta(s));
    const item = (ico: string, label: string, fn: () => void, disabled = false) =>
      h('button', { class: 'btn menu-btn', disabled, onclick: () => { this.audio.unlock(); this.audio.sfx('boing'); fn(); }, onmouseenter: () => this.audio.sfx('ui') }, h('span', { class: 'ico' }, ico), label);
    const slogan = SLOGANS[Math.floor(Math.random() * SLOGANS.length)];
    const receiptLines = ['BAZAR BAZAR', '------------', 'PATES      1,15', 'CHIPS      1,99', 'PATES      1,15', 'PATES      1,15', 'PATES      1,15', 'CAFE       3,69', 'PATES      1,15', 'BANANES    1,99', 'PATES      1,15', 'PATIENCE   0,00', 'PATES      1,15', 'PQ x12     4,99', 'PATES      1,15', 'PATES      1,15', 'TOTAL   ∞,∞∞ €'];
    this.menuEl = h(
      'div',
      { id: 'menu' },
      h('div', { class: 'menu-panel' }, item('▶️', 'Nouvelle partie', () => this.newGameDialog()), item('⏩', 'Continuer', () => this.actions.continueGame(), !hasSave), item('📂', 'Charger une sauvegarde', () => this.loadDialog()), item('⚙️', 'Options', () => this.optionsDialog()), item('🎮', 'Commandes', () => this.controlsDialog()), item('♿', 'Accessibilité', () => this.optionsDialog('acces')), item('🎬', 'Crédits', () => this.credits()), item('🚪', 'Quitter', () => this.quit())),
      h('div', { class: 'logo-wrap' }, h('div', { class: 'logo-card' }, h('img', { src: asset('brand/bazar-bazar-logo-officiel.png'), alt: 'BAZAR BAZAR — SuperEssence Studio' }))),
      this.settings.menuAnimations && !this.settings.reduceMotion ? h('div', { class: 'receipt' }, receiptLines.join('\n').repeat(4)) : null,
      h('div', { class: 'menu-slogan' }, `« ${slogan} »`),
      h('div', { class: 'menu-footer' }, h('img', { src: asset('brand/superessence-studio.jpg'), alt: '' }), 'SuperEssence Studio · v0.1 · Jeu de fiction : toute ressemblance avec une supérette existante serait un pur bazar.'),
    );
    ui().append(this.menuEl);
    if (this.settings.menuAnimations && !this.settings.reduceMotion) this.burstTimer = window.setInterval(() => this.burst(), 1500);
  }

  private burst() {
    if (!this.menuEl) return;
    const words = ['PROMO DU SIÈCLE !', '-90 %', '3 POUR 2 !', 'SOLDES INFERNAUX', 'ÇA DÉBORDE !', 'PRIX CASSÉS', 'BIP BIP !', 'RUPTURE DE STOCK ?!', 'CAISSE 2 FERMÉE', 'OFFERT* (*non)'];
    const b = h('div', { class: 'promo-burst' }, words[Math.floor(Math.random() * words.length)]);
    b.style.left = `${32 + Math.random() * 55}vw`;
    b.style.top = `${8 + Math.random() * 75}vh`;
    b.style.fontSize = `${1 + Math.random() * 1.3}em`;
    b.style.background = Math.random() < 0.5 ? '#e8291c' : '#ffc72c';
    if (b.style.background.includes('255, 199')) b.style.color = '#1a0d00';
    this.menuEl.append(b);
    setTimeout(() => b.remove(), 2500);
  }

  hideMainMenu() {
    if (this.burstTimer !== null) clearInterval(this.burstTimer);
    this.burstTimer = null;
    this.menuEl?.remove();
    this.menuEl = null;
  }

  private quit() {
    modal('Quitter ?', h('div', null, 'Votre supérette va rester sans patron… Les caddies vont prendre le pouvoir.'), [
      { label: 'Rester' },
      { label: 'Quitter', danger: true, onClick: () => { window.close(); document.body.innerHTML = '<div class="loading">Merci d’avoir joué à BAZAR BAZAR ! Vous pouvez fermer cet onglet.</div>'; } },
    ]);
  }

  newGameDialog() {
    let name = 'BAZAR BAZAR';
    let difficulty: 'facile' | 'normal' | 'enfer' = 'normal';
    let style = 'superette';
    const diffs = h('div', { class: 'row wrap' });
    const renderD = () => {
      clear(diffs);
      for (const [id, label, d] of [['facile', '😇 Paradis', '22 000 €, voleurs rares'], ['normal', '😈 Normal', '12 000 €, la vraie vie'], ['enfer', '🔥 Enfer', '6 500 €, tout va mal']] as const)
        diffs.append(h('button', { class: `btn small ${difficulty === id ? 'active' : ''}`, title: d, onclick: () => { difficulty = id; renderD(); } }, label));
    };
    renderD();
    const styles = h('select', { onchange: (e: Event) => (style = (e.target as HTMLSelectElement).value) }, STYLE_PRESETS.map((p) => h('option', { value: p.id }, `${p.name} — ${p.desc}`)));
    modal(
      '🏪 Nouvelle partie',
      [
        h('label', { class: 'field' }, 'Nom de votre supérette', h('input', { type: 'text', value: name, maxLength: 28, oninput: (e: Event) => (name = (e.target as HTMLInputElement).value) })),
        h('label', { class: 'field' }, 'Difficulté', diffs),
        h('label', { class: 'field' }, 'Style de départ', styles),
        h('p', { class: 'small muted' }, 'Vous reprenez une petite supérette de 16 × 14 m dans une banlieue bien vivante. Budget serré, trois concurrents, et un quartier qui vous observe.'),
      ],
      [{ label: 'Annuler' }, { label: 'C’est parti !', primary: true, onClick: () => this.actions.newGame({ name, difficulty, style }) }],
    );
  }

  loadDialog() {
    const list = h('div', { class: 'col' });
    const render = () => {
      clear(list);
      for (const s of SLOTS) {
        const m = slotMeta(s);
        list.append(
          h('div', { class: 'list-item' }, h('div', { class: 'grow' }, h('div', { class: 'title' }, s === 'auto' ? '🔁 Sauvegarde automatique' : `💾 Emplacement ${s.slice(-1)}`), h('div', { class: 'small muted' }, m ? `${m.storeName} · jour ${m.day + 1} · ${money0(m.cash)} · réputation ${m.rep} · ${new Date(m.savedAt).toLocaleString('fr-FR')}` : 'Vide')), m ? h('button', { class: 'btn small primary', onclick: () => { close(); this.actions.load(s); } }, 'Charger') : null, m && s !== 'auto' ? h('button', { class: 'btn small', onclick: () => { deleteSlot(s); render(); } }, '🗑️') : null),
        );
      }
      const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { close(); this.actions.importFile(await f.text()); } } });
      list.append(file, h('button', { class: 'btn small', onclick: () => file.click() }, '📥 Importer un fichier de sauvegarde (.json)'));
    };
    render();
    const close = modal('📂 Charger une partie', list, [{ label: 'Fermer' }]);
  }

  controlsDialog() {
    const k = (a: string) => h('kbd', { class: 'key' }, keyLabel(this.settings.keys[a]));
    modal(
      '🎮 Commandes',
      h(
        'div',
        { class: 'col small' },
        h('div', null, k('avancer'), k('gauche'), k('reculer'), k('droite'), ' se déplacer (ZQSD sur AZERTY, WASD sur QWERTY) · souris : regarder · ', k('courir'), ' courir · ', k('sauter'), ' sauter'),
        h('div', null, k('interagir'), ' interagir / prendre / remplir (maintenir) / scanner · ', k('secondaire'), ' action secondaire (ouvrir un carton, assigner un produit…)'),
        h('div', null, k('prix'), ' prix & promo du produit visé · ', k('lacher'), ' lâcher · clic gauche : lancer un article · clic droit : lancer un carton'),
        h('div', null, k('tablette'), ' tablette de gestion · ', k('construction'), ' mode construction · ', k('surveillance'), ' caméras · ', k('camera'), ' vue 1ʳᵉ/3ᵉ personne · ', k('vitesse'), ' vitesse du temps · ', k('pause'), ' pause'),
        h('div', null, 'En caisse : ', k('interagir'), ' scanner l’article suivant · ', k('quitterCaisse'), ' quitter la caisse'),
        h('div', null, 'Construction : clic gauche poser/sélectionner · R pivoter · clic droit + glisser tourner la vue · molette zoom · Suppr vendre · Échap annuler'),
        h('div', { class: 'muted' }, 'Toutes les touches sont modifiables dans Options → Commandes.'),
      ),
    );
  }

  credits() {
    modal(
      '🎬 Crédits',
      h(
        'div',
        { class: 'col', style: { textAlign: 'center' } },
        h('img', { src: asset('brand/bazar-bazar-logo-officiel-640.jpg'), style: { width: '220px', margin: '0 auto', borderRadius: '18%' } }),
        h('div', null, h('b', null, 'BAZAR BAZAR : LA SUPÉRETTE DE L’ENFER')),
        h('img', { src: asset('brand/superessence-studio.jpg'), style: { width: '260px', margin: '6px auto', borderRadius: '8px' } }),
        h('div', { class: 'small' }, 'Un jeu SuperEssence Studio.'),
        h('div', { class: 'small muted' }, 'Développement, game design, simulation, modèles 3D procéduraux, sons et musiques génératives : SuperEssence Studio, avec l’assistance de Claude (Anthropic).'),
        h('div', { class: 'small muted' }, 'Technologies : three.js (MIT), Rapier physics (Apache-2.0), Vite. Polices : Luckiest Guy & Nunito (SIL Open Font License).'),
        h('div', { class: 'small muted' }, 'Aucun caddie n’a été maltraité pendant le développement. Enfin, presque.'),
      ),
    );
  }

  optionsDialog(tab: 'graphismes' | 'audio' | 'commandes' | 'acces' | 'jeu' = 'graphismes', onChange?: () => void) {
    const s = this.settings;
    const body = h('div', { class: 'col' });
    const tabs = h('div', { class: 'row wrap' });
    const content = h('div');
    const save = () => {
      saveSettings(s);
      this.audio.applyVolumes();
      onChange?.();
    };
    const range = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const lbl = h('span', { class: 'small muted' }, fmt(s[key] as number));
      return h('label', { class: 'field' }, h('span', null, label, ' ', lbl), h('input', { type: 'range', min, max, step, value: String(s[key]), oninput: (e: Event) => { (s as any)[key] = Number((e.target as HTMLInputElement).value); lbl.textContent = fmt(s[key] as number); save(); } }));
    };
    const check = (label: string, key: keyof Settings) => h('label', { class: 'field' }, label, h('input', { type: 'checkbox', checked: !!s[key], onchange: (e: Event) => { (s as any)[key] = (e.target as HTMLInputElement).checked; save(); } }));
    const render = (t: typeof tab) => {
      clear(tabs);
      for (const [id, n] of [['graphismes', 'Graphismes'], ['audio', 'Audio'], ['commandes', 'Commandes'], ['acces', 'Accessibilité'], ['jeu', 'Jeu']] as const) tabs.append(h('button', { class: `btn small ${t === id ? 'active' : ''}`, onclick: () => render(id) }, n));
      clear(content);
      if (t === 'graphismes') {
        content.append(
          h('label', { class: 'field' }, 'Qualité', h('select', { onchange: (e: Event) => { s.quality = (e.target as HTMLSelectElement).value as any; save(); } }, ['basse', 'moyenne', 'haute'].map((q) => h('option', { value: q, selected: s.quality === q }, q)))),
          check('Ombres dynamiques', 'shadows'),
          range('Champ de vision', 'fov', 55, 100, 1, (v) => `${v}°`),
          range('Clients simultanés max.', 'maxCustomers', 8, 60, 1, (v) => String(v)),
          h('div', { class: 'small muted' }, 'Certaines options (ombres, qualité) s’appliquent au prochain chargement.'),
        );
      } else if (t === 'audio') {
        content.append(range('Volume général', 'volMaster', 0, 1, 0.05, pct), range('Musique', 'volMusic', 0, 1, 0.05, pct), range('Ambiance', 'volAmbience', 0, 1, 0.05, pct), range('Effets', 'volSfx', 0, 1, 0.05, pct), range('Voix (annonces)', 'volVoice', 0, 1, 0.05, pct), check('Sons comiques', 'comicSounds'), check('Annonces au micro', 'announcements'));
      } else if (t === 'commandes') {
        content.append(range('Sensibilité souris', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)), check('Inverser l’axe vertical', 'invertY'));
        for (const a of Object.keys(DEFAULT_KEYS)) {
          const btn = h('button', { class: 'btn small' }, keyLabel(s.keys[a]));
          btn.onclick = () => {
            btn.textContent = '…appuyez sur une touche';
            const handler = (e: KeyboardEvent) => {
              e.preventDefault();
              s.keys[a] = e.code;
              btn.textContent = keyLabel(e.code);
              window.removeEventListener('keydown', handler, true);
              save();
            };
            window.addEventListener('keydown', handler, true);
          };
          content.append(h('label', { class: 'field' }, KEY_LABELS[a] ?? a, btn));
        }
        content.append(h('button', { class: 'btn small', onclick: () => { s.keys = { ...DEFAULT_KEYS }; save(); render('commandes'); } }, 'Rétablir les touches par défaut'));
      } else if (t === 'acces') {
        content.append(
          check('Réduire les animations (menus, interface)', 'reduceMotion'),
          check('Animations du menu principal', 'menuAnimations'),
          check('Bulles de dialogue des personnages', 'barks'),
          range('Taille de l’interface', 'uiScale', 0.8, 1.5, 0.05, (v) => `${Math.round(v * 100)} %`),
          h('div', { class: 'small muted' }, 'Les annonces sont aussi affichées en texte (sous-titres). Tous les sons sont désactivables par catégorie (onglet Audio).'),
        );
      } else {
        content.append(check('Vue à la 3ᵉ personne par défaut', 'thirdPerson'), check('Mettre en pause quand la tablette est ouverte', 'pauseOnTablet'), h('label', { class: 'field' }, 'Sauvegarde automatique', h('select', { onchange: (e: Event) => { s.autosaveMinutes = Number((e.target as HTMLSelectElement).value); save(); } }, [[0, 'Désactivée'], [360, 'Toutes les 6 h de jeu'], [1440, 'Chaque nuit']].map(([v, n]) => h('option', { value: v, selected: s.autosaveMinutes === v }, n)))));
      }
    };
    render(tab);
    body.append(tabs, content);
    modal('⚙️ Options', body, [{ label: 'Fermer', primary: true }], { width: 'min(620px, 94vw)' });
  }
}

// ======================================================================= dialogues en jeu

export function dayReportDialog(r: DayCloseReport & { notes: string[] }, onClose: () => void) {
  const pos = r.profit >= 0;
  modal(
    `🌙 Bilan du jour ${r.day + 1}`,
    h(
      'div',
      { class: 'col' },
      h('div', { class: 'report-grid' }, h('span', null, 'Clients servis'), h('b', { class: 'num' }, r.customers), h('span', null, 'Clients perdus'), h('span', { class: 'num' }, r.lost), h('span', null, 'Chiffre d’affaires'), h('b', { class: 'num' }, money(r.revenue)), h('span', null, 'Marge brute'), h('span', { class: 'num' }, money(r.grossMargin)), h('span', null, 'Charges (hors achats de stock)'), h('span', { class: 'num' }, money(r.revenue - r.grossMargin + 0 > 0 ? r.grossMargin - r.profit : r.grossMargin - r.profit)), r.taxes ? h('span', null, 'Impôts de la semaine') : null, r.taxes ? h('span', { class: 'num' }, money(r.taxes)) : null, h('span', null, 'Résultat'), h('b', { class: `num ${pos ? 'good' : 'bad'}` }, money(r.profit)), h('span', null, 'Satisfaction moyenne'), h('span', { class: 'num' }, r.satisfaction ? pct(r.satisfaction) : '—')),
      r.notes.length ? h('div', { class: 'col small', style: { marginTop: '8px' } }, r.notes.map((n) => h('div', null, n))) : null,
      h('div', { class: 'small muted' }, pos ? 'Une journée de plus sans faillite. Champagne (en promo) !' : 'Journée difficile. Ajustez prix, stocks et personnel.'),
    ),
    [{ label: 'Au boulot !', primary: true }],
    { onClose },
  );
}

export function priceDialog(game: Game, pid: string) {
  const st = game.st;
  const p = PRODUCT_BY_ID[pid];
  let price = basePrice(st, pid);
  const lbl = h('b', { style: { fontSize: '1.6em' } }, money(price));
  const marginEl = h('div', { class: 'small' });
  const upd = () => {
    lbl.textContent = money(price);
    const m = (price - p.cost) / price;
    marginEl.textContent = `Marge ${pct(m)} · prix marché ${money(p.price)} · ${price > p.price * 1.15 ? '⚠️ jugé cher par les clients' : price < p.cost ? '⚠️ vendu à perte !' : 'prix raisonnable'}`;
    marginEl.className = `small ${price < p.cost || price > p.price * 1.2 ? 'bad' : 'good'}`;
  };
  upd();
  const step = (d: number) => {
    price = Math.max(0.05, Math.round((price + d) * 100) / 100);
    upd();
  };
  const promos = promosFor(st, pid);
  modal(
    `🏷️ ${p.name}`,
    h(
      'div',
      { class: 'col' },
      h('div', { class: 'small muted' }, `${p.brand} · coût d’achat ${money(p.cost)} · ventes ${avgDailySales(st, pid).toFixed(1)}/jour · réserve ${backroomUnits(st, pid)}`),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '6px' } }, h('button', { class: 'btn', onclick: () => step(-0.5) }, '−0,50'), h('button', { class: 'btn', onclick: () => step(-0.1) }, '−0,10'), lbl, h('button', { class: 'btn', onclick: () => step(0.1) }, '+0,10'), h('button', { class: 'btn', onclick: () => step(0.5) }, '+0,50')),
      marginEl,
      h('div', { class: 'row wrap' }, h('button', { class: 'btn small', onclick: () => { price = psychologicalPrice(p.price); upd(); } }, 'Prix du marché'), h('button', { class: 'btn small', onclick: () => { price = psychologicalPrice(p.cost * 1.3); upd(); } }, 'Coût +30 %'), h('button', { class: 'btn small', onclick: () => { price = psychologicalPrice(p.price * 0.92); upd(); } }, 'Agressif (−8 %)')),
      promos.length ? h('div', { class: 'small' }, `🔥 Promotion en cours : ${promos.map((x) => x.name).join(', ')}`) : null,
    ),
    [
      { label: 'Annuler' },
      { label: '🔥 Promo…', onClick: () => { (game as any).ui?.tablet.promoDialog([pid]); } },
      { label: 'Valider', primary: true, onClick: () => { st.prices[pid] = price; game.equipView.markDirty(); } },
    ],
  );
}

export function assignDialog(game: Game, e: PlacedEquip, idx: number) {
  const st = game.st;
  const def = EQUIPMENT_BY_ID[e.def];
  const options = PRODUCTS.filter((p) => canHold(def, idx, p));
  const list = h('div', { class: 'col', style: { maxHeight: '50vh', overflow: 'auto' } });
  const cur = e.slots![idx];
  const sorted = options.sort((a, b) => Number(st.assortment.includes(b.id)) - Number(st.assortment.includes(a.id)) || backroomUnits(st, b.id) - backroomUnits(st, a.id));
  let close: () => void = () => {};
  for (const cat of CATEGORIES) {
    const ps = sorted.filter((p) => p.category === cat.id);
    if (!ps.length) continue;
    list.append(h('div', { class: 'section-title' }, `${cat.icon} ${cat.name}`));
    for (const p of ps)
      list.append(
        h('button', { class: 'btn small', style: { justifyContent: 'space-between' }, onclick: () => { if (slotQty(cur) > 0) return game.bus.emit('notify', { text: 'Videz d’abord ce facing.', kind: 'bad' }); assignSlot(e, idx, p.id); if (!st.assortment.includes(p.id)) st.assortment.push(p.id); game.equipView.markDirty(); game.shelfIndex.invalidate(); close(); } }, h('span', null, p.name), h('span', { class: 'muted' }, `réserve ${backroomUnits(st, p.id)}${st.assortment.includes(p.id) ? '' : ' · non référencé'}`)),
      );
  }
  if (cur.pid && slotQty(cur) === 0) list.prepend(h('button', { class: 'btn small danger', onclick: () => { assignSlot(e, idx, null); game.equipView.markDirty(); game.shelfIndex.invalidate(); close(); } }, 'Libérer ce facing'));
  close = modal(`Assigner un produit — ${def.name}`, list, [{ label: 'Fermer' }]);
}

export function competitorDialog(game: Game, id: string) {
  const st = game.st;
  const c = st.competitors.find((x) => x.id === id)!;
  const def = COMPETITORS.find((x) => x.id === id)!;
  const sample = PRODUCTS.filter((p) => c.catalog.includes(p.category) && !p.seasonal).slice(0, 60);
  const rows = sample
    .filter((_, i) => i % 3 === 0)
    .map((p) => {
      const their = psychologicalPrice(p.price * c.priceIndex * (c.promoCategory === p.category ? 1 - c.promoDepth : 1));
      const mine = basePrice(st, p.id);
      return h('tr', null, h('td', null, p.name), h('td', { class: 'num' }, money(their)), h('td', { class: `num ${mine > their * 1.05 ? 'bad' : mine < their * 0.97 ? 'good' : ''}` }, money(mine)));
    });
  st.flags[`spied_${id}`] = dayOf(st.time);
  modal(`🕵️ Relevé de prix — ${def.name}`, h('div', { class: 'col' }, h('div', { class: 'small muted' }, `${def.desc} Horaires ${def.openHour} h–${def.closeHour} h. ${c.promoCategory ? `Promo en cours : ${CATEGORIES.find((x) => x.id === c.promoCategory)!.name} −${Math.round(c.promoDepth * 100)} %.` : ''}`), h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Produit'), h('th', { class: 'num' }, 'Chez eux'), h('th', { class: 'num' }, 'Chez vous'))), h('tbody', null, rows))));
}

export function bankruptDialog(onNew: () => void, onLoad: () => void, onBailout: () => void) {
  modal(
    '💀 FAILLITE',
    h('div', { class: 'col' }, h('div', null, 'La banque a fermé le robinet. Les fournisseurs ne livrent plus. Le chat est parti chez Gégé.'), h('div', { class: 'small muted' }, 'Vous pouvez recommencer, charger une sauvegarde, ou accepter le plan de sauvetage du tribunal de commerce (dette effacée contre la moitié de votre réputation).')),
    [
      { label: 'Charger', onClick: onLoad },
      { label: 'Plan de sauvetage', onClick: onBailout },
      { label: 'Nouvelle partie', primary: true, onClick: onNew },
    ],
  );
}
