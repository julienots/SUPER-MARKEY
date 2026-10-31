/**
 * Panneau contextuel de la vue 2.5D : ce qu'on vient de toucher (rayon, réserve, caisse, palette, client,
 * employé, salissure, le patron) avec son état en direct et les ordres possibles.
 */
import * as THREE from 'three';
import { h, clear } from '../ui/dom';
import { assignDialog, priceDialog } from '../ui/menus';
import { money, money0, pct } from '../core/math';
import { CELL, EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { ROLE_BY_ID } from '../data/roles';
import { backroomUnits, capacityFor, slotQty } from '../sim/inventory';
import { basePrice } from '../sim/pricing';
import { avgDailySales } from '../sim/orders';
import { equipCenter, footprint } from '../sim/layout';
import { productIcon } from './sprites';
import type { Pick } from './picking';
import type { Manager } from './manager';
import type { Game } from '../game/game';
import type { Customer } from '../entities/customer';
import type { EmployeeAgent } from '../entities/employee';
import type { PlacedEquip } from '../sim/state';
import type { AudioEngine } from '../audio/audio';

export interface PanelCallbacks {
  /** Ouvre la boutique du grossiste (éventuellement avec des produits déjà dans le panier). */
  openShop: (pids?: string[]) => void;
  openTablet: (tab?: string) => void;
  openBuild: () => void;
}

const C_STATE: Record<string, string> = {
  arriving: 'Arrive au magasin',
  enter: 'Entre',
  browse: 'Fait ses courses',
  shop: 'Fait ses courses',
  toShelf: 'Cherche un produit',
  pick: 'Prend un article',
  waitLane: 'Attend en caisse',
  queue: 'Fait la queue',
  paying: 'Paie',
  leaving: 'Repart',
  exit: 'Repart',
};
const E_STATE: Record<string, string> = {
  arriving: 'Arrive pour son service',
  changing: 'Se change',
  idle: 'Disponible',
  task: 'Au travail',
  cashier: 'En caisse',
  monitor: 'Surveille les écrans',
  patrol: 'Patrouille',
  chase: 'Poursuit un voleur !',
  break: 'En pause',
  leaving: 'Fin de service',
};

export class SelectionPanel {
  el = h('div', { id: 'iso-panel', class: 'panel' });
  sel: Pick | null = null;
  private sig = '';
  private t = 0;
  private hovering = false;
  private marker: THREE.Mesh;

  constructor(private game: Game, private mgr: Manager, private audio: AudioEngine, private cb: PanelCallbacks) {
    this.el.style.display = 'none';
    this.el.addEventListener('pointerenter', () => (this.hovering = true));
    this.el.addEventListener('pointerleave', () => (this.hovering = false));
    document.getElementById('ui')!.append(this.el);
    // anneau de sélection au sol
    const ring = new THREE.RingGeometry(0.42, 0.52, 40);
    ring.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffc72c, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.renderOrder = 5;
    this.marker.visible = false;
    game.scene.add(this.marker);
  }

  select(p: Pick | null) {
    this.sel = p && p.kind !== 'ground' ? p : null;
    this.sig = '';
    this.render(true);
    if (this.sel) this.audio.sfx('ui');
  }

  close() {
    this.select(null);
  }

  private valid(): boolean {
    const s = this.sel;
    if (!s) return false;
    const g = this.game;
    switch (s.kind) {
      case 'equip':
        return g.st.equipment.includes(s.e);
      case 'agent':
        return !s.a.dead;
      case 'pallet':
        return g.items.pallets.has(s.uid);
      case 'mess':
        return g.st.messes.some((m) => m.uid === s.uid);
      default:
        return true;
    }
  }

  update(dt: number) {
    if (this.sel && !this.valid()) this.select(null);
    this.placeMarker();
    this.t -= dt;
    if (this.t > 0 || !this.sel || this.hovering) return;
    this.t = 0.4;
    this.render(false);
  }

  private placeMarker() {
    const s = this.sel;
    const m = this.marker;
    m.visible = !!s;
    if (!s) return;
    const g = this.game;
    let x = 0;
    let z = 0;
    let r = 1;
    if (s.kind === 'equip') {
      const c = equipCenter(s.e);
      const f = footprint(EQUIPMENT_BY_ID[s.e.def], s.e.rot);
      x = c.x;
      z = c.z;
      r = (Math.max(f.w, f.d) * CELL) / 2 + 0.3;
    } else if (s.kind === 'agent') {
      x = s.a.pos.x;
      z = s.a.pos.z;
    } else if (s.kind === 'player') {
      x = g.player.pos.x;
      z = g.player.pos.z;
    } else if (s.kind === 'pallet') {
      const t = g.items.pallets.get(s.uid)!.body.translation();
      x = t.x;
      z = t.z;
      r = 1.4;
    } else if (s.kind === 'mess') {
      const ms = g.st.messes.find((k) => k.uid === s.uid)!;
      x = ms.x;
      z = ms.z;
      r = 1.1;
    }
    m.position.set(x, 0.04, z);
    m.scale.setScalar(r * (1 + Math.sin(performance.now() / 260) * 0.04));
  }

  // ---------------------------------------------------------------- rendu
  private render(force: boolean) {
    const s = this.sel;
    if (!s) {
      this.el.style.display = 'none';
      return;
    }
    const body = this.content(s);
    const sig = body.sig;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    clear(this.el);
    this.el.append(h("button", { class: "x", "aria-label": "Fermer", onclick: () => this.close() }, "✕"), ...body.nodes.filter((n): n is HTMLElement => !!n));
    this.el.style.display = '';
  }

  private btn(label: string, fn: () => void, cls = '') {
    return h('button', { class: `btn small ${cls}`, onclick: () => { this.audio.sfx('ui'); fn(); this.sig = ''; this.t = 0; } }, label);
  }

  private content(s: Pick): { nodes: (HTMLElement | null)[]; sig: string } {
    const g = this.game;
    switch (s.kind) {
      case 'equip':
        return this.equip(s.e);
      case 'player': {
        const p = g.player;
        const held = p.held?.kind === 'cartons' ? `📦 porte ${p.held.list.length} carton(s)` : 'mains libres';
        const st = this.mgr.status || (p.mode === 'cashier' ? 'Tient la caisse' : 'Attend vos ordres');
        return {
          sig: `pl|${st}|${held}`,
          nodes: [
            h('div', { class: 'ttl' }, '👑 Vous, le patron'),
            h('div', { class: 'sub' }, `${st} · ${held}`),
            h('div', { class: 'small muted' }, 'Touchez un endroit du sol pour vous y rendre, ou un meuble pour lui donner un ordre.'),
            h('div', { class: 'acts' }, this.mgr.busy || p.mode === 'cashier' ? this.btn('✋ Arrêter', () => { this.mgr.cancel(); if (p.mode === 'cashier') p.interaction.leaveCashier(); }) : null, p.held ? this.btn('📦 Ranger ce que je porte', () => this.mgr.returnHeld()) : null),
          ],
        };
      }
      case 'agent': {
        const a = s.a;
        if (a.kind === 'customer') {
          const c = a as Customer;
          const name = c.resident?.name ?? 'Client·e de passage';
          const state = C_STATE[c.state] ?? 'Se promène';
          const flags = [c.special === 'furieux' && !c.calmed ? '😡 furieux' : '', c.special === 'influenceur' ? '📸 influenceur' : '', c.special === 'inspecteur' ? '🕵️ inspecteur ?' : '', c.suspect ? '🚨 suspect' : ''].filter(Boolean).join(' · ');
          const acts: HTMLElement[] = [];
          if (c.special === 'furieux' && !c.calmed) acts.push(this.btn('🤝 Aller le calmer', () => this.mgr.approach(c, () => g.specials.calm(c, 'Vous'))));
          if (c.suspect && c.stolen.length) acts.push(this.btn('🚨 Interpeller', () => this.mgr.approach(c, () => c.getCaught('vous')), 'danger'));
          acts.push(this.btn('👋 Aller le saluer', () => this.mgr.approach(c, () => { c.say('🙂', undefined, 1.5); g.bus.emit('notify', { text: '« Bonjour ! Besoin d’aide ? »', kind: 'info' }); })));
          return {
            sig: `c|${c.id}|${c.state}|${c.basket.length}|${flags}`,
            nodes: [
              h('div', { class: 'ttl' }, `🛒 ${name}`),
              h('div', { class: 'sub' }, `${c.arch.name} · ${state}`),
              h('div', { class: 'small' }, `Panier : ${c.basket.length} article(s) · budget ~${money0(c.budget)}`),
              c.list.length ? h('div', { class: 'small muted' }, `Cherche : ${c.list.filter((l) => !l.done).slice(0, 5).map((l) => (l.pid ? PRODUCT_BY_ID[l.pid].name : l.cat)).join(', ') || '—'}`) : null,
              flags ? h('div', { class: 'small bad' }, flags) : null,
              h('div', { class: 'acts' }, ...acts),
            ],
          };
        }
        if (a.kind === 'employee') {
          const e = a as EmployeeAgent;
          const emp = e.emp;
          const role = ROLE_BY_ID[emp.role];
          const state = E_STATE[e.state] ?? e.state;
          return {
            sig: `e|${e.id}|${e.state}|${Math.round(emp.fatigue * 20)}|${Math.round(emp.mood * 20)}`,
            nodes: [
              h('div', { class: 'ttl' }, `${role.icon} ${emp.name}`),
              h('div', { class: 'sub' }, `${role.name} · ${state}`),
              h('div', { class: 'bars' }, bar('Humeur', emp.mood, emp.mood < 0.35), bar('Fatigue', emp.fatigue, emp.fatigue > 0.75), bar('Compétence', emp.skill)),
              h('div', { class: 'small muted' }, `${money(emp.wage)}/h · service ${emp.shiftStart} h – ${emp.shiftEnd} h`),
              h('div', { class: 'acts' }, this.btn('👥 Gérer le personnel', () => this.cb.openTablet('personnel'))),
            ],
          };
        }
        return { sig: `a|${a.id}`, nodes: [h('div', { class: 'ttl' }, '🙂 Quelqu’un'), h('div', { class: 'sub' }, 'Un habitant du quartier.')] };
      }
      case 'pallet': {
        const pv = g.items.pallets.get(s.uid)!;
        const list = new Map<string, number>();
        for (const c of pv.data.cartons) list.set(c.pid, (list.get(c.pid) ?? 0) + 1);
        return {
          sig: `p|${s.uid}|${pv.data.cartons.length}|${this.mgr.label}`,
          nodes: [
            h('div', { class: 'ttl' }, `🚚 Palette livrée — ${pv.data.cartons.length} carton(s)`),
            h('div', { class: 'sub' }, 'À ranger dans la réserve avant de remplir les rayons.'),
            h('div', { class: 'chips' }, ...[...list].slice(0, 12).map(([pid, n]) => chip(pid, `${n}×`))),
            h('div', { class: 'acts' }, this.btn('📥 Ranger en réserve', () => this.mgr.putAwayPallet(s.uid), 'primary')),
          ],
        };
      }
      case 'mess': {
        const m = g.st.messes.find((k) => k.uid === s.uid)!;
        const names: Record<string, string> = { flaque: '💧 Flaque', salete: '🟤 Saleté', verre: '🔪 Débris de verre', tag: '🎨 Tag', detritus: '🗑️ Détritus' };
        return {
          sig: `m|${m.uid}|${Math.round(m.amount * 20)}`,
          nodes: [
            h('div', { class: 'ttl' }, names[m.kind] ?? 'Salissure'),
            h('div', { class: 'sub' }, `${Math.round(m.amount * 100)} % à nettoyer — les clients détestent ça.`),
            h('div', { class: 'acts' }, this.btn('🧽 Nettoyer', () => this.mgr.clean(m.uid), 'primary')),
          ],
        };
      }
      default:
        return { sig: '', nodes: [] };
    }
  }

  private equip(e: PlacedEquip): { nodes: (HTMLElement | null)[]; sig: string } {
    const g = this.game;
    const st = g.st;
    const d = EQUIPMENT_BY_ID[e.def];
    const nodes: (HTMLElement | null)[] = [h('div', { class: 'ttl' }, d.name)];
    let sig = `q|${e.uid}|${e.broken}|${this.mgr.label}`;
    if (e.broken) nodes.push(h('div', { class: 'small bad' }, `⚠️ En panne — réparation ${money0(g.repairCost(e.uid))}`));
    // ---- caisses
    const lane = g.checkouts.lanes.get(e.uid);
    if (lane) {
      const op = lane.auto ? 'caisse automatique' : lane.operator === 'player' ? 'tenue par vous' : lane.operator ? `tenue par ${lane.operator.emp.name}` : 'personne en caisse';
      const scan = lane.scan;
      sig += `|${lane.queue.length}|${op}|${scan?.scanned}|${scan?.phase}|${lane.served}|${e.open}`;
      nodes.push(
        h('div', { class: 'sub' }, `${lane.queue.length} client(s) en file · ${op} · ${lane.served} servis`),
        lane.operator === 'player' && scan?.phase === 'scan' ? h('div', { class: 'small' }, `🧾 ${scan.items.length - scan.scanned} article(s) à scanner`) : null,
      );
      const acts: HTMLElement[] = [];
      if (lane.operator === 'player') acts.push(this.btn('🚪 Quitter la caisse', () => g.player.interaction.leaveCashier()));
      else if (!lane.auto && !lane.operator && !e.broken) acts.push(this.btn('🧾 Tenir la caisse', () => this.mgr.manCheckout(lane), 'primary'));
      if (lane.auto && scan?.needAssist) acts.push(this.btn('🆘 Débloquer', () => g.checkouts.assist(lane)));
      acts.push(this.btn(e.open === false ? '✅ Ouvrir cette caisse' : '⛔ Fermer cette caisse', () => { e.open = e.open === false; g.equipView.sync(st); }));
      if (e.broken) acts.push(this.btn('🔧 Réparer', () => g.bus.emit('notify', { text: g.repair(e.uid), kind: 'info' })));
      nodes.push(h('div', { class: 'acts' }, ...acts));
      return { nodes, sig };
    }
    // ---- réserve (racks, chambre froide)
    if (e.cartons) {
      const list = new Map<string, number>();
      for (const c of e.cartons) list.set(c.pid, (list.get(c.pid) ?? 0) + 1);
      sig += `|${e.cartons.length}`;
      nodes.push(
        h('div', { class: 'sub' }, `${e.cartons.length}/${d.cartons} cartons stockés`),
        list.size ? h('div', { class: 'chips' }, ...[...list].slice(0, 16).map(([pid, n]) => chip(pid, `${n}×`))) : h('div', { class: 'small muted' }, 'Vide. Commandez chez le grossiste : les livreurs déposent des palettes au quai.'),
        h('div', { class: 'acts' }, this.btn('🛒 Commander', () => this.cb.openShop(), 'primary'), this.btn('📋 Détail de la réserve', () => this.cb.openTablet(`rack:${e.uid}`))),
      );
      return { nodes, sig };
    }
    // ---- rayons et meubles froids
    if (e.slots) {
      const groups = new Map<string | null, { idx: number[]; q: number; cap: number }>();
      e.slots.forEach((sl, i) => {
        const k = sl.pid;
        const gr = groups.get(k) ?? { idx: [], q: 0, cap: 0 };
        gr.idx.push(i);
        gr.q += slotQty(sl);
        if (sl.pid) gr.cap += capacityFor(e, i, sl.pid);
        groups.set(k, gr);
      });
      let q = 0;
      let cap = 0;
      for (const gr of groups.values()) {
        q += gr.q;
        cap += gr.cap;
      }
      sig += `|${q}|${[...groups.keys()].join(',')}|${[...groups.keys()].map((pid) => (pid ? backroomUnits(st, pid) + ':' + basePrice(st, pid) : '')).join(',')}`;
      nodes.push(h('div', { class: 'sub' }, cap ? `${q}/${cap} articles en rayon (${pct(q / Math.max(1, cap))})` : 'Aucun produit assigné à ce meuble.'));
      const rows = h('div', { class: 'prods' });
      for (const [pid, gr] of groups) {
        if (!pid) {
          rows.append(h('div', { class: 'prow empty', onclick: () => assignDialog(g, e, gr.idx[0]) }, h('div', { class: 'ic' }, '＋'), h('div', { class: 'grow' }, h('b', null, `${gr.idx.length} emplacement(s) libre(s)`), h('div', { class: 'small muted' }, 'Touchez pour choisir un produit'))));
          continue;
        }
        const p = PRODUCT_BY_ID[pid];
        const back = backroomUnits(st, pid);
        const f = gr.cap ? gr.q / gr.cap : 0;
        rows.append(
          h(
            'div',
            { class: 'prow' },
            h('img', { class: 'ic', src: productIcon(pid, 64), alt: '' }),
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 'pn' }, p.name),
              h('div', { class: 'fill' }, h('i', { style: { width: `${Math.round(f * 100)}%`, background: f < 0.25 ? 'var(--bad)' : f < 0.6 ? 'var(--orange)' : 'var(--green)' } })),
              h('div', { class: 'small muted' }, `${gr.q}/${gr.cap} · réserve ${back} · ${avgDailySales(st, pid).toFixed(1)}/j`),
            ),
            h(
              'div',
              { class: 'col', style: { gap: '4px', alignItems: 'stretch' } },
              h('button', { class: 'btn small price', title: 'Changer le prix', onclick: () => priceDialog(g, pid) }, money(basePrice(st, pid))),
              h('div', { class: 'row', style: { gap: '4px' } }, h('button', { class: 'btn small', title: 'Commander ce produit', onclick: () => this.cb.openShop([pid]) }, '🛒'), h('button', { class: 'btn small', title: 'Changer de produit', onclick: () => assignDialog(g, e, gr.idx[0]) }, '⇄')),
            ),
          ),
        );
      }
      nodes.push(rows);
      const pids = [...groups.keys()].filter((x): x is string => !!x);
      const inBack = pids.some((pid) => backroomUnits(st, pid) > 0);
      nodes.push(
        h(
          'div',
          { class: 'acts' },
          this.btn(inBack ? '📦 Remplir depuis la réserve' : '📦 Remplir (réserve vide)', () => this.mgr.restock(e), inBack ? 'primary' : ''),
          this.btn('🛒 Commander', () => this.cb.openShop(pids)),
          this.btn('🏗️ Déplacer', () => this.cb.openBuild()),
        ),
      );
      return { nodes, sig };
    }
    nodes.push(h('div', { class: 'sub' }, d.desc), h('div', { class: 'acts' }, e.broken ? this.btn('🔧 Réparer', () => g.bus.emit('notify', { text: g.repair(e.uid), kind: 'info' })) : null, this.btn('🏗️ Aménager', () => this.cb.openBuild())));
    return { nodes, sig };
  }
}

function bar(label: string, v: number, bad = false) {
  return h('div', { class: 'bar' }, h('span', null, label), h('div', { class: 'fill' }, h('i', { style: { width: `${Math.round(v * 100)}%`, background: bad ? 'var(--bad)' : 'var(--green)' } })));
}

function chip(pid: string, txt: string) {
  return h('span', { class: 'chip', title: PRODUCT_BY_ID[pid].name }, h('img', { src: productIcon(pid, 40), alt: '' }), txt);
}
