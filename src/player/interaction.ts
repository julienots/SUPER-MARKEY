/**
 * Interactions contextuelles : on regarde un objet → les actions possibles s'affichent (touche + libellé).
 * Toutes les actions modifient réellement l'état (stock, caisse, physique...).
 */
import * as THREE from 'three';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { COMPETITORS } from '../data/competitors';
import { money } from '../core/math';
import { G_AGENT, G_CART, G_DYNAMIC, G_STATIC, G_TRIGGER, groups } from '../physics/physics';
import { addToSlot, canHold, freeSpace, rackFree, slotQty, storeCarton, takeFromSlot, assignSlot, removeExpired, expiredInSlot } from '../sim/inventory';
import { shelfPrice } from '../sim/pricing';
import { dayOf, type PlacedEquip } from '../sim/state';
import { MAX_CARTONS, type Player } from './player';
import type { Game } from '../game/game';
import type { Customer } from '../entities/customer';
import type { EmployeeAgent } from '../entities/employee';
import type { Lane } from '../game/checkout';
import { CART_CAPACITY, type FreeCart } from '../entities/items';
import { Burglar } from '../entities/burglar';

export type Target =
  | { kind: 'slot'; e: PlacedEquip; idx: number }
  | { kind: 'rack'; e: PlacedEquip }
  | { kind: 'equip'; e: PlacedEquip }
  | { kind: 'carton'; uid: number }
  | { kind: 'pallet'; uid: number }
  | { kind: 'loose'; uid: number }
  | { kind: 'mess'; uid: number }
  | { kind: 'checkout'; lane: Lane }
  | { kind: 'customer'; agent: Customer }
  | { kind: 'employee'; agent: EmployeeAgent }
  | { kind: 'loiterer' }
  | { kind: 'burglar'; agent: Burglar }
  | { kind: 'cart'; cart: FreeCart }
  | { kind: 'competitor'; id: string }
  | { kind: 'none' };

export interface ActionDef {
  action: string; // nom d'action d'entrée (interagir, secondaire, prix...)
  label: string;
  hold?: boolean;
  run: () => void;
}

export interface Prompt {
  title: string;
  subtitle?: string;
  actions: ActionDef[];
  info?: string[];
}

export class Interaction {
  target: Target = { kind: 'none' };
  prompt: Prompt | null = null;
  private holdT = 0;
  private cleanT = 0;
  /** Messages éphémères affichés près du réticule. */
  flash: ((text: string) => void) | null = null;
  /** Ouvre l'éditeur de prix (UI). */
  onEditPrice: ((pid: string) => void) | null = null;
  onAssignSlot: ((e: PlacedEquip, idx: number) => void) | null = null;
  onOpenTablet: ((tab?: string) => void) | null = null;
  onOpenCameras: (() => void) | null = null;
  onEmployee: ((a: EmployeeAgent) => void) | null = null;
  onCompetitor: ((id: string) => void) | null = null;

  constructor(private game: Game, private p: Player) {}

  private say(t: string) {
    this.flash?.(t);
  }

  // ---------------------------------------------------------------- détection de la cible
  pick(): Target {
    const g = this.game;
    const p = this.p;
    if (p.mode === 'cashier' && p.lane) return { kind: 'checkout', lane: p.lane };
    const o = p.eye;
    const d = p.forward();
    const hit = g.physics.raycast(o, d, 3.4, groups(0xffff, G_STATIC | G_DYNAMIC | G_AGENT | G_CART | G_TRIGGER), undefined, undefined);
    // concurrents : à proximité de leur porte
    for (const c of COMPETITORS) if (Math.hypot(c.door[0] - p.pos.x, c.door[1] - p.pos.z) < 3.2) return { kind: 'competitor', id: c.id };
    if (!hit) return { kind: 'none' };
    const u = hit.user;
    if (u) {
      switch (u.kind) {
        case 'item':
          return { kind: 'loose', uid: u.ref };
        case 'carton':
          return { kind: 'carton', uid: u.ref };
        case 'pallet':
          return { kind: 'pallet', uid: u.ref };
        case 'cart':
          if (u.ref && (u.ref as FreeCart).body && (u.ref as any).heldBy !== undefined) return { kind: 'cart', cart: u.ref };
          break;
        case 'agent': {
          const a = u.ref;
          if (a.kind === 'customer') return { kind: 'customer', agent: a };
          if (a.kind === 'employee') return { kind: 'employee', agent: a };
          if (g.specials.loiterers.includes(a)) return { kind: 'loiterer' };
          if (a instanceof Burglar) return { kind: 'burglar', agent: a };
          break;
        }
        case 'equip': {
          const e = g.st.equipment.find((x) => x.uid === u.ref);
          if (!e) break;
          const def = EQUIPMENT_BY_ID[e.def];
          if (def.shelf) return { kind: 'slot', e, idx: g.equipView.slotAt(e, hit.point.x, hit.point.y, hit.point.z) };
          if (def.cartons) return { kind: 'rack', e };
          if (def.category === 'caisse') {
            const lane = g.checkouts.laneByUid(e.uid);
            if (lane) return { kind: 'checkout', lane };
          }
          return { kind: 'equip', e };
        }
      }
    }
    // sol : salissure ?
    const m = g.items.messAt(hit.point.x, hit.point.z, 0.8);
    if (m) return { kind: 'mess', uid: m.uid };
    return { kind: 'none' };
  }

  // ---------------------------------------------------------------- actions disponibles
  buildPrompt(t: Target): Prompt | null {
    const g = this.game;
    const st = g.st;
    const p = this.p;
    const held = p.held;
    switch (t.kind) {
      case 'slot': {
        const s = t.e.slots?.[t.idx];
        if (!s) return null;
        const def = EQUIPMENT_BY_ID[t.e.def];
        const pr = s.pid ? PRODUCT_BY_ID[s.pid] : null;
        const q = slotQty(s);
        const cap = s.pid ? g.equipView.capacityOf(t.e, t.idx, s.pid) : 0;
        const actions: ActionDef[] = [];
        const info: string[] = [];
        if (pr) {
          info.push(`${q}/${cap} en rayon · ${money(shelfPrice(st, pr.id))}`);
          const exp = expiredInSlot(s, dayOf(st.time));
          if (exp) info.push(`⚠️ ${exp} périmé(s) !`);
          const soon = s.lots.filter((l) => l.exp >= 0 && l.exp - dayOf(st.time) <= 1 && l.exp >= dayOf(st.time)).reduce((a, l) => a + l.q, 0);
          if (soon) info.push(`⏳ ${soon} à date courte`);
        } else info.push(`Facing vide · ${def.shelf!.storage === 'chilled' ? 'froid positif' : def.shelf!.storage === 'frozen' ? 'surgelés' : 'ambiant'}`);
        if (held?.kind === 'cartons') {
          const c = held.list[held.list.length - 1];
          const cp = PRODUCT_BY_ID[c.pid];
          if ((s.pid === c.pid || (!s.pid && canHold(def, t.idx, cp))) && freeSpace(t.e, t.idx) + (s.pid ? 0 : 1) > 0) {
            if (!c.opened) actions.push({ action: 'secondaire', label: 'Ouvrir le carton', run: () => this.openCarton() });
            else actions.push({ action: 'interagir', label: `Remplir (${c.q} dans le carton)`, hold: true, run: () => this.fillOne(t.e, t.idx) });
          } else if (s.pid && s.pid !== c.pid) info.push(`Ce facing contient ${PRODUCT_BY_ID[s.pid].name}`);
          else if (!canHold(def, t.idx, cp)) info.push(cp.storage !== def.shelf!.storage ? 'Mauvaise température de stockage !' : 'Produit incompatible avec ce meuble');
          else info.push('Facing plein');
        } else if (held?.kind === 'item') {
          if (s.pid === held.pid || (!s.pid && canHold(def, t.idx, PRODUCT_BY_ID[held.pid])))
            actions.push({ action: 'interagir', label: 'Reposer l’article', run: () => this.putItemBack(t.e, t.idx) });
        } else if (!held) {
          if (pr && q > 0) actions.push({ action: 'interagir', label: 'Prendre un article', run: () => this.takeItem(t.e, t.idx) });
          if (!pr || q === 0) actions.push({ action: 'secondaire', label: pr ? 'Changer de produit' : 'Assigner un produit', run: () => this.onAssignSlot?.(t.e, t.idx) });
          if (pr && expiredInSlot(s, dayOf(st.time))) actions.push({ action: 'secondaire', label: 'Retirer les périmés', run: () => this.removeExpired(t.e, t.idx) });
        }
        if (pr) actions.push({ action: 'prix', label: 'Prix & promo', run: () => this.onEditPrice?.(pr.id) });
        return { title: pr ? pr.name : def.name, subtitle: pr ? `${pr.brand} · ${def.name}` : def.name, actions, info };
      }
      case 'rack': {
        const def = EQUIPMENT_BY_ID[t.e.def];
        const actions: ActionDef[] = [];
        const n = t.e.cartons?.length ?? 0;
        const info = [`${n}/${def.cartons} cartons`];
        if (t.e.broken) info.push('⚠️ EN PANNE');
        if (held?.kind === 'cartons' && rackFree(t.e) > 0) {
          const c = held.list[held.list.length - 1];
          const cold = PRODUCT_BY_ID[c.pid].storage !== 'ambient';
          if (cold && t.e.def !== 'chambre_froide') info.push('⚠️ Produit frais : rangez-le en chambre froide');
          actions.push({ action: 'interagir', label: 'Ranger le carton', run: () => this.storeHeldCarton(t.e) });
        }
        if ((!held || (held.kind === 'cartons' && held.list.length < MAX_CARTONS)) && n > 0) actions.push({ action: 'secondaire', label: 'Prendre un carton…', run: () => this.onOpenTablet?.(`rack:${t.e.uid}`) });
        if (!held && n > 0) {
          const last = t.e.cartons![n - 1];
          actions.push({ action: 'interagir', label: `Prendre : ${PRODUCT_BY_ID[last.pid].name}`, run: () => this.takeFromRack(t.e, n - 1) });
        }
        if (t.e.broken) actions.push({ action: 'prix', label: 'Réparer (bricolage)', run: () => this.diyRepair(t.e) });
        return { title: def.name, actions, info };
      }
      case 'equip': {
        const def = EQUIPMENT_BY_ID[t.e.def];
        const actions: ActionDef[] = [];
        if (t.e.def === 'ecran_secu') actions.push({ action: 'interagir', label: 'Regarder les caméras', run: () => this.onOpenCameras?.() });
        if (t.e.def === 'bureau') actions.push({ action: 'interagir', label: 'Ouvrir la gestion', run: () => this.onOpenTablet?.() });
        if (t.e.def === 'cafe_client') actions.push({ action: 'interagir', label: 'Boire un café (1 €)', run: () => { g.st.cash -= 0; this.say('☕ Ahh. Le café du patron.'); } });
        if (t.e.broken) actions.push({ action: 'prix', label: 'Réparer (bricolage)', run: () => this.diyRepair(t.e) });
        return { title: def.name, subtitle: def.desc, actions };
      }
      case 'carton': {
        const c = st.worldCartons.find((x) => x.uid === t.uid);
        if (!c) return null;
        const actions: ActionDef[] = [];
        if (!held || (held.kind === 'cartons' && held.list.length < MAX_CARTONS && p.cartonWeight() < 30)) actions.push({ action: 'interagir', label: held ? 'Empiler sur votre pile' : 'Porter le carton', run: () => this.pickCarton(t.uid) });
        if (!c.opened) actions.push({ action: 'secondaire', label: 'Ouvrir', run: () => { c.opened = true; g.items.refreshCartonVisual(c.uid); } });
        return { title: `Carton : ${PRODUCT_BY_ID[c.pid].name}`, subtitle: `${c.q} unité(s)${c.exp >= 0 ? ` · DLC J+${c.exp - dayOf(st.time)}` : ''}`, actions };
      }
      case 'pallet': {
        const pl = st.pallets.find((x) => x.uid === t.uid);
        if (!pl) return null;
        const actions: ActionDef[] = [];
        if (!held || (held.kind === 'cartons' && held.list.length < MAX_CARTONS)) actions.push({ action: 'interagir', label: 'Prendre un carton', run: () => this.takeFromPallet(t.uid) });
        const counts = new Map<string, number>();
        for (const c of pl.cartons) counts.set(c.pid, (counts.get(c.pid) ?? 0) + 1);
        return { title: `Palette (${pl.cartons.length} cartons)`, info: [...counts].slice(0, 4).map(([pid, n]) => `${n}× ${PRODUCT_BY_ID[pid].name}`), actions };
      }
      case 'loose': {
        const l = st.looseItems.find((x) => x.uid === t.uid);
        if (!l) return null;
        const actions: ActionDef[] = [];
        if (!held) actions.push({ action: 'interagir', label: 'Ramasser', run: () => this.pickLoose(t.uid) });
        if (held?.kind === 'cartons') {
          const c = held.list[held.list.length - 1];
          if (c.pid === l.pid) actions.push({ action: 'interagir', label: 'Remettre dans le carton', run: () => { if (g.items.removeLoose(l.uid)) { c.q++; this.say('+1 dans le carton'); } } });
        }
        return { title: PRODUCT_BY_ID[l.pid].name, subtitle: 'Article tombé par terre', actions };
      }
      case 'mess': {
        const m = st.messes.find((x) => x.uid === t.uid);
        if (!m) return null;
        const names = { flaque: 'Flaque', salete: 'Saleté', verre: 'Débris de verre', tag: 'Tag', detritus: 'Détritus' };
        return { title: names[m.kind], subtitle: `${Math.round(m.amount * 100)} % à nettoyer`, actions: held ? [] : [{ action: 'interagir', label: 'Nettoyer', hold: true, run: () => this.cleanStep(m.uid) }] };
      }
      case 'checkout': {
        const l = t.lane;
        const actions: ActionDef[] = [];
        const info: string[] = [];
        if (l.e.broken) info.push('⚠️ Caisse en panne');
        if (p.mode === 'cashier' && p.lane === l) {
          const s = l.scan;
          if (s && s.phase === 'scan') {
            info.push(`${s.items.length - s.scanned} article(s) à scanner`);
            actions.push({ action: 'interagir', label: 'Scanner l’article', run: () => { const err = g.checkouts.playerScan(l); if (err) this.say(err); } });
          } else if (s?.phase === 'pay') info.push('Paiement en cours…');
          else info.push(l.queue.length ? 'Le client arrive…' : 'Aucun client');
          actions.push({ action: 'quitterCaisse', label: 'Quitter la caisse', run: () => this.leaveCashier() });
          return { title: `Caisse — ${l.served} clients servis`, actions, info };
        }
        info.push(`${l.queue.length} client(s) en file · ${l.auto ? 'caisse automatique' : l.operator ? (l.operator === 'player' ? 'tenue par vous' : `tenue par ${l.operator.emp.name}`) : 'fermée'}`);
        if (l.auto && l.scan?.needAssist) actions.push({ action: 'interagir', label: 'Débloquer (assistance)', run: () => { g.checkouts.assist(l); this.say('✅ « Merci de votre patience. »'); } });
        else if (!l.auto && !l.e.broken && (!l.operator || l.operator === 'player') && !held) actions.push({ action: 'interagir', label: 'Tenir la caisse', run: () => this.enterCashier(l) });
        actions.push({ action: 'secondaire', label: l.e.open === false ? 'Ouvrir la caisse' : 'Fermer la caisse', run: () => { l.e.open = l.e.open === false; g.equipView.sync(g.st); } });
        if (l.e.broken) actions.push({ action: 'prix', label: 'Réparer (bricolage)', run: () => this.diyRepair(l.e) });
        return { title: EQUIPMENT_BY_ID[l.e.def].name, actions, info };
      }
      case 'customer': {
        const c = t.agent;
        const actions: ActionDef[] = [];
        const info = [`${c.arch.name} · panier : ${c.basket.length} article(s)`];
        if (c.special === 'furieux' && !c.calmed) actions.push({ action: 'interagir', label: 'Calmer le client', run: () => g.specials.calm(c, 'Vous') });
        else if (c.suspect && c.stolen.length) actions.push({ action: 'interagir', label: '🚨 Interpeller', run: () => c.getCaught('vous') });
        else if (c.stolen.length && c.distTo(p.pos.x, p.pos.z) < 2) actions.push({ action: 'interagir', label: 'Contrôler le sac', run: () => { if (Math.random() < 0.7) c.getCaught('vous'); else this.say('Le client nie tout en bloc et s’éloigne…'); } });
        else actions.push({ action: 'interagir', label: 'Saluer / aider', run: () => this.greet(c) });
        if (c.resident) info.push(`${c.resident.memory.visits} visite(s) · satisfaction ${Math.round(c.resident.memory.satisfaction * 100)} %`);
        return { title: c.name, subtitle: c.special === 'influenceur' ? '🤳 Influenceur en tournage !' : c.suspect ? '❗ Comportement suspect' : undefined, actions, info };
      }
      case 'employee': {
        const a = t.agent;
        return {
          title: a.emp.name,
          subtitle: `${g.staff.roleName(a.emp)} · humeur ${Math.round(a.emp.mood * 100)} % · fatigue ${Math.round(a.emp.fatigue * 100)} %`,
          info: [a.task ? `Tâche : ${a.task.kind}` : `État : ${a.state}`],
          actions: [{ action: 'interagir', label: 'Donner des consignes', run: () => this.onEmployee?.(a) }],
        };
      }
      case 'burglar':
        return { title: '🥷 Individu cagoulé', subtitle: t.agent.loot.length || t.agent.cash ? 'Il emporte votre marchandise !' : 'Intrusion !', actions: t.agent.distTo(p.pos.x, p.pos.z) < 2.6 ? [{ action: 'interagir', label: '🚨 Maîtriser', run: () => (Math.random() < 0.7 ? t.agent.getCaught('vous') : this.say('Il vous file entre les doigts !')) }] : [] };
      case 'loiterer':
        return { title: 'Groupe devant l’entrée', actions: [{ action: 'interagir', label: 'Discuter', run: () => this.say(g.specials.talkToLoiterers()) }] };
      case 'cart': {
        const c = t.cart;
        const actions: ActionDef[] = [];
        if (held?.kind === 'cartons' && c.cargo.length < CART_CAPACITY) actions.push({ action: 'interagir', label: `Poser le carton dans le chariot (${c.cargo.length}/${CART_CAPACITY})`, run: () => { const k = held.list.pop()!; c.cargo.push(k); if (!held.list.length) p.held = null; p.refreshHeld(); g.items.refreshCargo(c); g.bus.emit('sfx', { name: 'thud' }); } });
        if (!held) actions.push({ action: 'interagir', label: 'Pousser le chariot', run: () => p.grabCart(c) });
        if ((!held || (held.kind === 'cartons' && held.list.length < MAX_CARTONS)) && c.cargo.length) actions.push({ action: 'secondaire', label: `Prendre un carton (${c.cargo.length})`, run: () => { const k = c.cargo.pop()!; if (p.held?.kind === 'cartons') p.held.list.push(k); else p.held = { kind: 'cartons', list: [k] }; p.refreshHeld(); g.items.refreshCargo(c); } });
        return { title: 'Chariot', subtitle: c.wobble ? 'Une roue a sa propre volonté' : c.cargo.length ? `${c.cargo.length} carton(s) : ${[...new Set(c.cargo.map((k) => PRODUCT_BY_ID[k.pid].name))].slice(0, 3).join(', ')}` : undefined, actions };
      }
      case 'competitor': {
        const def = COMPETITORS.find((c) => c.id === t.id)!;
        const c = st.competitors.find((x) => x.id === t.id)!;
        return {
          title: def.name,
          subtitle: c.closedForever ? 'Fermé définitivement' : c.open ? def.desc : 'Pas encore ouvert',
          actions: c.open ? [{ action: 'interagir', label: 'Observer les prix (espionnage)', run: () => this.onCompetitor?.(t.id) }] : [],
        };
      }
      default:
        return null;
    }
  }

  update(dt: number) {
    this.target = this.pick();
    this.prompt = this.buildPrompt(this.target);
    const inp = this.p.input;
    const held = this.p.held;
    // lâcher / lancer
    if (held && inp.pressed('lacher')) this.p.dropHeld(false);
    else if (held && inp.mouseClicked[0] && this.p.mode === 'walk' && held.kind !== 'cartons') this.p.dropHeld(true);
    else if (held?.kind === 'cartons' && inp.mouseClicked[2]) this.p.dropHeld(true);
    if (!this.prompt) return;
    for (const a of this.prompt.actions) {
      if (a.hold) {
        if (inp.down(a.action)) {
          this.holdT -= dt;
          if (this.holdT <= 0) {
            this.holdT = a.label.startsWith('Nettoyer') ? 0.1 : 0.16;
            a.run();
          }
        } else if (inp.releasedAction(a.action)) this.holdT = 0;
      } else if (inp.pressed(a.action) || (a.action === 'interagir' && inp.mouseClicked[0] && !held && this.p.mode === 'cashier')) {
        a.run();
        break;
      }
    }
  }

  /** Exécute une action par son libellé (tests automatisés / boutons tactiles). */
  perform(target: Target, labelStart: string): boolean {
    const pr = this.buildPrompt(target);
    const a = pr?.actions.find((x) => x.label.startsWith(labelStart));
    if (!a) return false;
    a.run();
    return true;
  }

  // ---------------------------------------------------------------- actions
  private takeItem(e: PlacedEquip, idx: number) {
    const it = takeFromSlot(e, idx);
    if (!it) return;
    this.p.held = { kind: 'item', pid: it.pid, exp: it.exp };
    this.p.refreshHeld();
    this.game.equipView.markDirty();
    this.game.bus.emit('sfx', { name: 'pick' });
  }

  private putItemBack(e: PlacedEquip, idx: number) {
    const h = this.p.held;
    if (h?.kind !== 'item') return;
    if (addToSlot(e, idx, h.pid, 1, h.exp)) {
      this.p.held = null;
      this.p.refreshHeld();
      this.game.equipView.markDirty();
      this.game.bus.emit('sfx', { name: 'place' });
    } else this.say('Pas de place ici.');
  }

  openCarton() {
    const h = this.p.held;
    if (h?.kind !== 'cartons') return;
    const c = h.list[h.list.length - 1];
    c.opened = true;
    this.p.refreshHeld();
    this.game.bus.emit('sfx', { name: 'tape' });
  }

  /** Remplit une unité depuis le carton du dessus vers le facing visé. */
  fillOne(e: PlacedEquip, idx: number): boolean {
    const h = this.p.held;
    if (h?.kind !== 'cartons') return false;
    const c = h.list[h.list.length - 1];
    if (!c.opened) c.opened = true;
    const n = addToSlot(e, idx, c.pid, 1, c.exp);
    if (!n) {
      this.say('Facing plein !');
      return false;
    }
    c.q--;
    this.game.st.stats.unitsShelvedByPlayer++;
    this.game.equipView.markDirty();
    this.game.bus.emit('sfx', { name: 'place' });
    if (c.q <= 0) {
      h.list.pop();
      this.say('Carton vide → aplati et recyclé ♻️');
      if (!h.list.length) this.p.held = null;
      this.p.refreshHeld();
    }
    return true;
  }

  private storeHeldCarton(e: PlacedEquip) {
    const h = this.p.held;
    if (h?.kind !== 'cartons') return;
    const c = h.list[h.list.length - 1];
    if (rackFree(e) <= 0) return this.say('Rack plein.');
    if (PRODUCT_BY_ID[c.pid].storage !== 'ambient' && e.def !== 'chambre_froide') this.say('⚠️ Produit frais hors du froid : il va se périmer vite !');
    e.cartons = e.cartons ?? [];
    e.cartons.push(h.list.pop()!);
    if (!h.list.length) this.p.held = null;
    this.p.refreshHeld();
    this.game.equipView.markDirty();
    this.game.bus.emit('sfx', { name: 'thud' });
  }

  takeFromRack(e: PlacedEquip, i: number) {
    const c = e.cartons?.[i];
    if (!c) return;
    const h = this.p.held;
    if (h && (h.kind !== 'cartons' || h.list.length >= MAX_CARTONS)) return this.say('Vos bras sont pleins.');
    e.cartons!.splice(i, 1);
    if (h?.kind === 'cartons') h.list.push(c);
    else this.p.held = { kind: 'cartons', list: [c] };
    this.p.refreshHeld();
    this.game.equipView.markDirty();
    this.game.bus.emit('sfx', { name: 'thud' });
  }

  private pickCarton(uid: number) {
    const c = this.game.items.removeCarton(uid);
    if (!c) return;
    const h = this.p.held;
    if (h?.kind === 'cartons') h.list.push(c);
    else this.p.held = { kind: 'cartons', list: [c] };
    this.p.refreshHeld();
  }

  takeFromPallet(uid: number) {
    const c = this.game.items.takeFromPallet(uid);
    if (!c) return;
    const h = this.p.held;
    if (h?.kind === 'cartons') h.list.push(c);
    else this.p.held = { kind: 'cartons', list: [c] };
    this.p.refreshHeld();
    this.game.bus.emit('sfx', { name: 'thud' });
  }

  private pickLoose(uid: number) {
    const l = this.game.items.removeLoose(uid);
    if (!l) return;
    this.p.held = { kind: 'item', pid: l.pid, exp: l.exp };
    this.p.refreshHeld();
  }

  private removeExpired(e: PlacedEquip, idx: number) {
    const s = e.slots![idx];
    const pid = s.pid;
    const n = removeExpired(s, dayOf(this.game.st.time));
    if (n && pid) {
      this.game.recordLoss(n * PRODUCT_BY_ID[pid].cost, 'périmés');
      this.say(`🗑️ ${n} article(s) périmé(s) retiré(s).`);
      this.game.equipView.markDirty();
    }
  }

  private cleanStep(uid: number) {
    this.cleanT += 1;
    if (this.cleanT % 4 === 0) this.game.bus.emit('sfx', { name: 'mop' });
    if (this.game.items.clean(uid, 0.06)) this.say('✨ Propre !');
  }

  private diyRepair(e: PlacedEquip) {
    if (Math.random() < 0.4) {
      e.broken = false;
      e.wear = Math.min(1, e.wear + 0.15);
      this.say('🔧 Ça remarche ! (pour l’instant)');
      this.game.layoutChanged();
    } else this.say('🔧 Raté… ça fait un bruit inquiétant. Réessayez ou appelez un pro (tablette).');
  }

  private greet(c: Customer) {
    c.play('wave');
    c.calmed = true;
    this.say(['« Bonjour ! Besoin d’aide ? »', '« Les pâtes ? Allée de gauche ! »', '« Bienvenue chez nous ! »'][Math.floor(Math.random() * 3)]);
    c.say('🙂', undefined, 1.5);
  }

  enterCashier(l: Lane) {
    if (l.operator && l.operator !== 'player') return;
    l.operator = 'player';
    this.p.lane = l;
    this.p.teleport(l.pts.cashier.x, l.pts.cashier.z, l.pts.cashier.face + Math.PI);
    this.p.yaw = Math.atan2(l.pts.pay.x - l.pts.cashier.x, l.pts.pay.z - l.pts.cashier.z);
    this.p.pitch = 0.45;
    this.p.setMode('cashier');
    this.say('Mode caisse : E pour scanner, Q pour quitter.');
  }

  leaveCashier() {
    const l = this.p.lane;
    if (l && l.operator === 'player') l.operator = null;
    this.p.lane = null;
    this.p.setMode('walk');
  }
}

export const _v = THREE;
