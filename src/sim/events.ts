/**
 * Événements dynamiques : chacun a des conditions, une cause plausible, des effets dans la simulation
 * et parfois des choix. Les effets physiques passent par `WorldHooks` (implémenté par le runtime 3D).
 */
import { CATEGORIES, PRODUCTS, PRODUCT_BY_ID, type CategoryId } from '../data/products';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import type { Rng } from '../core/rng';
import { clamp01, money0 } from '../core/math';
import { dayOfWeek, season } from '../core/time';
import { earn, spend, insuranceClaim } from './economy';
import { expiredInSlot, takeUnitsFromBackroom } from './inventory';
import { allocUid, dayOf, hourOf, type ActiveEvent, type GameState, type PendingChoice } from './state';
import { storeArea } from './economy';

export interface WorldHooks {
  notify(text: string, kind?: 'info' | 'good' | 'bad' | 'event'): void;
  /** Fait apparaître un groupe de clients/passants (supporters, fête...). */
  spawnCrowd(n: number, from: [number, number], boost: Partial<Record<CategoryId, number>>): void;
  spawnSpecial(kind: 'inspecteur_sanitaire' | 'inspecteur_securite' | 'influenceur' | 'client_furieux' | 'rodeurs' | 'chat' | 'police', data?: any): void;
  setPowerOut(on: boolean): void;
  addMess(kind: 'tag' | 'salete' | 'flaque' | 'detritus', x: number, z: number, amount?: number): void;
  announce(text: string): void;
  dropPallet(pid: string, cartons: number): void;
}

export interface EventCtx {
  st: GameState;
  rng: Rng;
  hooks: WorldHooks;
}

export interface EventDef {
  id: string;
  name: string;
  /** Poids de tirage par heure (0 = impossible maintenant). */
  weight(c: EventCtx): number;
  cooldownDays: number;
  start(c: EventCtx): ActiveEvent | null;
  end?(c: EventCtx, ev: ActiveEvent): void;
  /** Résolution d'un choix proposé au joueur. */
  choose?(c: EventCtx, choice: PendingChoice, option: string): void;
  /** Mise à jour chaque minute de jeu pendant l'événement. */
  tick?(c: EventCtx, ev: ActiveEvent): void;
}

const mkEvent = (c: EventCtx, id: string, minutes: number, data: Record<string, any> = {}): ActiveEvent => ({ id, uid: allocUid(c.st), start: c.st.time, end: c.st.time + minutes, data });

function ask(c: EventCtx, eventId: string, title: string, text: string, options: PendingChoice['options'], minutes = 180, data: Record<string, any> = {}) {
  c.st.pendingChoices.push({ uid: allocUid(c.st), eventId, title, text, options, expires: c.st.time + minutes, data });
}

const storeOpenNow = (st: GameState) => hourOf(st.time) >= st.store.openHour && hourOf(st.time) < st.store.closeHour;
export const isActive = (st: GameState, id: string) => st.activeEvents.some((e) => e.id === id && st.time < e.end);
export const activeData = (st: GameState, id: string) => st.activeEvents.find((e) => e.id === id && st.time < e.end)?.data;

/** Multiplicateurs de demande par catégorie dus aux événements en cours. */
export function demandBoost(st: GameState): Partial<Record<CategoryId, number>> {
  const b: Partial<Record<CategoryId, number>> = {};
  const add = (k: CategoryId, v: number) => (b[k] = (b[k] ?? 0) + v);
  if (isActive(st, 'match')) {
    add('boissons', 2);
    add('snacks', 2);
  }
  if (isActive(st, 'fete')) {
    add('boissons', 1);
    add('snacks', 1);
    add('local', 1.5);
  }
  if (isActive(st, 'canicule')) {
    add('boissons', 1.5);
    add('surgeles', 1);
  }
  if (st.weather.kind === 'pluie' || st.weather.kind === 'orage') add('saison', 0.5);
  return b;
}

export const EVENTS: EventDef[] = [
  {
    id: 'match',
    name: 'Fin de match au stade',
    cooldownDays: 3,
    weight: (c) => (dayOfWeek(dayOf(c.st.time)) >= 5 && hourOf(c.st.time) >= 16 && hourOf(c.st.time) < 19 && storeOpenNow(c.st) ? 0.5 : 0),
    start(c) {
      const won = c.rng.chance(0.55);
      c.hooks.notify(won ? '⚽ Le FC Quartier a gagné ! Une foule de supporters euphoriques sort du stade…' : '⚽ Défaite du FC Quartier… Des supporters dépités sortent du stade, assoiffés.', 'event');
      c.hooks.spawnCrowd(c.rng.int(12, 22), [-9, 51], { boissons: 3, snacks: 3 });
      return mkEvent(c, 'match', 120, { won });
    },
  },
  {
    id: 'viral',
    name: 'Produit viral',
    cooldownDays: 6,
    weight: (c) => (storeOpenNow(c.st) ? 0.06 : 0),
    start(c) {
      const pid = c.rng.pick(PRODUCTS.filter((p) => !p.seasonal && p.category !== 'boucherie')).id;
      c.hooks.notify(`📱 « ${PRODUCT_BY_ID[pid].name} » est viral sur Pépito ! Tout le quartier en veut pendant 2 jours.`, 'event');
      return mkEvent(c, 'viral', 2 * 1440, { pid });
    },
  },
  {
    id: 'panne_froid',
    name: 'Panne de réfrigérateur',
    cooldownDays: 5,
    weight: (c) => {
      const fr = c.st.equipment.filter((e) => EQUIPMENT_BY_ID[e.def].alwaysOn && EQUIPMENT_BY_ID[e.def].shelf && !e.broken);
      if (!fr.length) return 0;
      const wear = fr.reduce((a, e) => a + e.wear, 0) / fr.length;
      return 0.015 + wear * 0.06 + (isActive(c.st, 'canicule') ? 0.05 : 0);
    },
    start(c) {
      const fr = c.st.equipment.filter((e) => EQUIPMENT_BY_ID[e.def].alwaysOn && EQUIPMENT_BY_ID[e.def].shelf && !e.broken);
      const e = c.rng.weighted(fr, (x) => 0.2 + x.wear)!;
      e.broken = true;
      c.hooks.notify(`🧊❌ Panne : « ${EQUIPMENT_BY_ID[e.def].name} » ne refroidit plus ! Les produits frais vont se périmer.`, 'bad');
      ask(c, 'panne_froid', 'Panne de froid', `Le meuble « ${EQUIPMENT_BY_ID[e.def].name} » est en panne. Le frais qu'il contient se dégrade.`, [
        { id: 'express', label: 'Dépanneur express (420 €)', hint: 'Réparé dans l’heure' },
        { id: 'standard', label: 'Dépanneur standard (180 €)', hint: 'Demain matin' },
        { id: 'diy', label: 'Bricoler soi-même', hint: '45 % de réussite, gratuit' },
      ], 240, { uid: e.uid });
      return mkEvent(c, 'panne_froid', 1440, { uid: e.uid });
    },
    choose(c, ch, opt) {
      const e = c.st.equipment.find((x) => x.uid === ch.data?.uid);
      if (!e) return;
      if (opt === 'express') {
        spend(c.st, 'entretien', 420);
        e.broken = false;
        e.wear = 0.1;
        c.hooks.notify('🔧 Le dépanneur express a réparé le froid. Il est reparti en sifflotant avec votre chèque.', 'good');
      } else if (opt === 'standard') {
        spend(c.st, 'entretien', 180);
        c.st.flags.repairTomorrow = [...(c.st.flags.repairTomorrow ?? []), e.uid];
        c.hooks.notify('🔧 Réparation programmée demain matin.', 'info');
      } else {
        if (c.rng.chance(0.45)) {
          e.broken = false;
          e.wear = Math.min(1, e.wear + 0.2);
          c.hooks.notify('🛠️ Un coup de tournevis, un coup de pied : ça repart ! (pour combien de temps ?)', 'good');
        } else {
          c.hooks.notify('💥 Le bricolage a échoué. Ça sent le plastique brûlé. Il faudra un pro.', 'bad');
          ask(c, 'panne_froid', 'Panne de froid (bis)', 'Votre réparation a échoué. Appeler un pro ?', [
            { id: 'express', label: 'Dépanneur express (420 €)' },
            { id: 'standard', label: 'Dépanneur standard (180 €)' },
          ], 240, { uid: e.uid });
        }
      }
    },
  },
  {
    id: 'panne_caisse',
    name: 'Panne de caisse',
    cooldownDays: 4,
    weight: (c) => (c.st.equipment.some((e) => e.def.startsWith('caisse') && !e.broken) && storeOpenNow(c.st) ? 0.02 : 0),
    start(c) {
      const list = c.st.equipment.filter((e) => e.def.startsWith('caisse') && !e.broken);
      const e = c.rng.pick(list);
      e.broken = true;
      c.hooks.notify('🧾❌ Une caisse affiche « ERREUR 0x42 : JE REFUSE ». Elle est hors service.', 'bad');
      ask(c, 'panne_caisse', 'Caisse en panne', 'Une caisse est hors service. Les files vont s’allonger.', [
        { id: 'tech', label: 'Technicien (250 €)', hint: 'Réparée en 1 h' },
        { id: 'reboot', label: 'Éteindre et rallumer', hint: '60 % de réussite' },
      ], 120, { uid: e.uid });
      return mkEvent(c, 'panne_caisse', 600, { uid: e.uid });
    },
    choose(c, ch, opt) {
      const e = c.st.equipment.find((x) => x.uid === ch.data?.uid);
      if (!e) return;
      if (opt === 'tech') {
        spend(c.st, 'entretien', 250);
        e.broken = false;
        c.hooks.notify('🔧 Caisse réparée. Le technicien a juste… rebranché le câble.', 'good');
      } else if (c.rng.chance(0.6)) {
        e.broken = false;
        c.hooks.notify('🔁 Éteindre et rallumer : la solution universelle. La caisse remarche !', 'good');
      } else {
        c.hooks.notify('🔁 Elle redémarre… et affiche un écran bleu. Toujours en panne.', 'bad');
      }
    },
  },
  {
    id: 'retard',
    name: 'Livraison en retard',
    cooldownDays: 3,
    weight: (c) => (c.st.orders.some((o) => o.status === 'en_cours') ? 0.03 : 0),
    start(c) {
      const o = c.rng.pick(c.st.orders.filter((x) => x.status === 'en_cours'));
      const h = c.rng.int(3, 12);
      o.eta += h * 60;
      o.delayed = true;
      c.hooks.notify(`🚚⏳ ${c.rng.pick(['Grève des transporteurs', 'Camion en panne sur l’A86', 'Erreur de préparation', 'Le chauffeur s’est perdu'])} : la commande #${o.id} aura ${h} h de retard.`, 'bad');
      return mkEvent(c, 'retard', 60);
    },
  },
  {
    id: 'controle_sanitaire',
    name: 'Contrôle sanitaire',
    cooldownDays: 14,
    weight: (c) => (storeOpenNow(c.st) && dayOf(c.st.time) > 4 ? 0.012 : 0),
    start(c) {
      c.hooks.notify('🧑‍⚕️ Un inspecteur de l’hygiène vient d’entrer. Il a un bloc-notes. Et un regard.', 'event');
      c.hooks.spawnSpecial('inspecteur_sanitaire');
      return mkEvent(c, 'controle_sanitaire', 45);
    },
    end(c) {
      const st = c.st;
      const day = dayOf(st.time);
      let expired = 0;
      for (const e of st.equipment) e.slots?.forEach((s) => (expired += expiredInSlot(s, day)));
      const dirt = st.messes.filter((m) => m.kind !== 'tag').reduce((a, m) => a + m.amount, 0);
      const brokenCold = st.equipment.filter((e) => e.broken && EQUIPMENT_BY_ID[e.def].alwaysOn && EQUIPMENT_BY_ID[e.def].shelf && e.slots?.some((s) => s.lots.length)).length;
      let fine = expired * 15 + Math.round(dirt * 40) + brokenCold * 300;
      fine = Math.round(fine);
      if (fine <= 0) {
        st.reputation.proprete = Math.min(100, st.reputation.proprete + 8);
        earn(st, 'recompenses', 0);
        c.hooks.notify('✅ Contrôle sanitaire : RAS ! L’inspecteur a presque souri. Certificat « Hygiène exemplaire » affiché (+réputation).', 'good');
      } else {
        spend(st, 'amendes', fine);
        st.reputation.proprete = Math.max(0, st.reputation.proprete - Math.min(25, fine / 20));
        c.hooks.notify(`❌ Contrôle sanitaire : ${expired} produit(s) périmé(s) en rayon, ${dirt.toFixed(1)} u. de saleté, ${brokenCold} meuble(s) froid(s) en panne. Amende : ${money0(fine)}.`, 'bad');
        if (fine > 1200) {
          st.flags.closedUntil = st.time + 6 * 60;
          c.hooks.notify('⛔ Fermeture administrative de 6 heures ordonnée !', 'bad');
        }
      }
    },
  },
  {
    id: 'controle_securite',
    name: 'Inspection de sécurité',
    cooldownDays: 20,
    weight: (c) => (storeOpenNow(c.st) && dayOf(c.st.time) > 6 ? 0.008 : 0),
    start(c) {
      c.hooks.notify('🦺 Inspection de sécurité incendie en cours…', 'event');
      c.hooks.spawnSpecial('inspecteur_securite');
      return mkEvent(c, 'controle_securite', 40);
    },
    end(c) {
      const st = c.st;
      const needed = Math.max(1, Math.ceil(storeArea(st.store.stage) / 100));
      const have = st.equipment.filter((e) => e.def === 'extincteur').length;
      const clutter = st.looseItems.length + st.worldCartons.length * 0.5;
      const exits = st.store.facade.filter((f) => f === 'porte').length + 1;
      let fine = Math.max(0, needed - have) * 250 + (clutter > 10 ? 300 : 0) + (exits < 2 ? 400 : 0);
      if (fine === 0) c.hooks.notify(`✅ Sécurité incendie conforme (${have}/${needed} extincteurs).`, 'good');
      else {
        spend(st, 'amendes', fine);
        c.hooks.notify(`❌ Non-conformités : extincteurs ${have}/${needed}${clutter > 10 ? ', encombrement des allées' : ''}${exits < 2 ? ', issues insuffisantes' : ''}. Amende ${money0(fine)}.`, 'bad');
      }
    },
  },
  {
    id: 'coupure',
    name: 'Coupure d’électricité',
    cooldownDays: 8,
    weight: (c) => (c.st.weather.kind === 'orage' ? 0.08 : 0.006),
    start(c) {
      const dur = c.rng.int(60, 180);
      const gen = !!c.st.store.upgrades['groupe_electrogene'];
      c.hooks.setPowerOut(true);
      c.hooks.notify(gen ? '⚡ Coupure de courant ! Le groupe électrogène prend le relais (bruyamment).' : '⚡ Coupure de courant dans tout le quartier ! Froid et caisses à l’arrêt, magasin dans le noir.', 'bad');
      if (!gen && storeOpenNow(c.st))
        ask(c, 'coupure', 'Panne de courant', 'Le magasin est plongé dans le noir. Que faire ?', [
          { id: 'louer', label: 'Louer un groupe électrogène (350 €)', hint: 'Courant rétabli dans 20 min' },
          { id: 'fermer', label: 'Fermer temporairement', hint: 'Évite les vols, perd des ventes' },
          { id: 'bougies', label: 'Continuer à la lampe torche', hint: 'Ambiance « cave », vols facilités' },
        ], 60);
      return mkEvent(c, 'coupure', dur, { gen });
    },
    choose(c, _ch, opt) {
      const ev = c.st.activeEvents.find((e) => e.id === 'coupure');
      if (opt === 'louer') {
        spend(c.st, 'entretien', 350);
        if (ev) ev.end = Math.min(ev.end, c.st.time + 20);
      } else if (opt === 'fermer') {
        c.st.flags.closedUntil = ev?.end ?? c.st.time + 60;
        c.hooks.announce('Suite à une coupure de courant, le magasin ferme temporairement. Nous vous prions de sortir calmement, et sans les caddies.');
      } else c.hooks.notify('🔦 Les clients font leurs courses à la lampe de téléphone. C’est… une expérience.', 'info');
    },
    end(c) {
      c.hooks.setPowerOut(false);
      c.hooks.notify('💡 Le courant est revenu.', 'good');
    },
  },
  {
    id: 'client_furieux',
    name: 'Client furieux',
    cooldownDays: 2,
    weight: (c) => (storeOpenNow(c.st) && c.st.reputation.attente < 60 ? 0.05 : storeOpenNow(c.st) ? 0.012 : 0),
    start(c) {
      c.hooks.spawnSpecial('client_furieux');
      c.hooks.notify('😡 Un client furieux exige « LE RESPONSABLE ». Allez lui parler (ou envoyez un manager) avant qu’il ne filme tout.', 'event');
      return mkEvent(c, 'client_furieux', 40);
    },
  },
  {
    id: 'offre_fournisseur',
    name: 'Offre exceptionnelle',
    cooldownDays: 4,
    weight: (c) => (hourOf(c.st.time) > 8 && hourOf(c.st.time) < 18 ? 0.03 : 0),
    start(c) {
      const pid = c.rng.pick(c.st.assortment.length ? c.st.assortment : PRODUCTS.map((p) => p.id));
      const p = PRODUCT_BY_ID[pid];
      const cartons = c.rng.int(6, 16);
      const price = Math.round(p.cost * p.cartonQty * cartons * c.rng.range(0.5, 0.7));
      ask(c, 'offre_fournisseur', 'Offre exceptionnelle', `Un commercial de Destock’ Mania propose ${cartons} cartons de « ${p.name} » pour ${money0(price)} (−${Math.round((1 - price / (p.cost * p.cartonQty * cartons)) * 100)} %). Livraison immédiate. ${p.shelfLife ? 'Attention : date courte !' : ''}`, [
        { id: 'oui', label: `Accepter (${money0(price)})` },
        { id: 'non', label: 'Refuser poliment' },
      ], 120, { pid, cartons, price });
      return mkEvent(c, 'offre_fournisseur', 120);
    },
    choose(c, ch, opt) {
      if (opt !== 'oui') return;
      const { pid, cartons, price } = ch.data!;
      if (c.st.cash < price) {
        c.hooks.notify('💸 Trésorerie insuffisante pour cette offre.', 'bad');
        return;
      }
      spend(c.st, 'marchandises', price);
      if (!c.st.assortment.includes(pid)) c.st.assortment.push(pid);
      c.hooks.dropPallet(pid, cartons);
      c.hooks.notify(`📦 Palette de ${cartons} cartons livrée dans la cour de livraison.`, 'good');
    },
  },
  {
    id: 'fete',
    name: 'Fête de quartier',
    cooldownDays: 21,
    weight: (c) => (dayOfWeek(dayOf(c.st.time)) === 5 && hourOf(c.st.time) >= 9 && hourOf(c.st.time) < 11 && season(dayOf(c.st.time)) !== 'hiver' ? 0.4 : 0),
    start(c) {
      ask(c, 'fete', 'Fête de quartier', 'Le comité des fêtes organise une fête de quartier aujourd’hui. Ils cherchent des sponsors.', [
        { id: 'sponsor', label: 'Sponsoriser (400 €)', hint: 'Notoriété +, clients +' },
        { id: 'stand', label: 'Tenir un stand de boissons', hint: 'Ventes supplémentaires' },
        { id: 'rien', label: 'Ne rien faire' },
      ], 120);
      c.hooks.notify('🎉 Fête de quartier aujourd’hui ! Plus de monde dans les rues.', 'event');
      c.hooks.spawnCrowd(c.rng.int(6, 10), [10, -20], { boissons: 1, snacks: 1, local: 2 });
      return mkEvent(c, 'fete', 9 * 60);
    },
    choose(c, _ch, opt) {
      if (opt === 'sponsor') {
        spend(c.st, 'marketing', 400);
        for (const r of c.st.residents) r.awareness = clamp01(r.awareness + 0.2);
        c.hooks.notify('🎈 Votre logo flotte sur les banderoles. Tout le quartier vous connaît maintenant.', 'good');
      } else if (opt === 'stand') {
        const gain = c.rng.int(150, 420);
        earn(c.st, 'divers', gain);
        c.hooks.notify(`🥤 Le stand de boissons a rapporté ${gain} €. Votre manager a dansé la macarena.`, 'good');
      }
    },
  },
  {
    id: 'travaux_rue',
    name: 'Travaux dans la rue',
    cooldownDays: 25,
    weight: () => 0.004,
    start(c) {
      c.hooks.notify('🚧 Travaux de voirie sur l’avenue pendant 3 jours : moins de clients motorisés, bruit de marteau-piqueur.', 'event');
      return mkEvent(c, 'travaux_rue', 3 * 1440);
    },
  },
  {
    id: 'influenceur',
    name: 'Visite d’un influenceur',
    cooldownDays: 15,
    weight: (c) => (storeOpenNow(c.st) && dayOf(c.st.time) > 3 ? 0.008 : 0),
    start(c) {
      c.hooks.notify('🤳 « Kévin_ShoppingFou » (180 k abonnés) vient faire une vidéo dans votre magasin. Tout doit être parfait !', 'event');
      c.hooks.spawnSpecial('influenceur');
      return mkEvent(c, 'influenceur', 60);
    },
  },
  {
    id: 'offre_louche',
    name: 'Proposition douteuse',
    cooldownDays: 30,
    weight: (c) => (dayOf(c.st.time) > 8 && hourOf(c.st.time) > 19 && !c.st.flags.dealAccepted ? 0.012 : 0),
    start(c) {
      ask(c, 'offre_louche', 'Une proposition douteuse', 'Un individu en survêtement trop propre vous propose 600 €/semaine pour « garder quelques colis » dans votre réserve, sans poser de questions. Il insiste lourdement.', [
        { id: 'refuser', label: 'Refuser fermement', hint: 'Risque de pressions' },
        { id: 'signaler', label: 'Signaler à la police', hint: 'Sécurité du quartier +, risque d’intimidation' },
        { id: 'accepter', label: 'Accepter', hint: 'Argent facile… vraiment ?' },
      ], 240);
      return mkEvent(c, 'offre_louche', 240);
    },
    choose(c, _ch, opt) {
      const st = c.st;
      if (opt === 'accepter') {
        st.flags.dealAccepted = dayOf(st.time);
        earn(st, 'divers', 600);
        c.hooks.notify('😬 Des cartons sans étiquette apparaissent dans votre réserve. Vos employés évitent de vous regarder.', 'bad');
        for (const e of st.employees) e.mood = clamp01(e.mood - 0.15);
      } else if (opt === 'signaler') {
        st.flags.reportedDeal = dayOf(st.time);
        for (const q of st.quartiers) q.safety = clamp01(q.safety + 0.05);
        st.reputation.securite = Math.min(100, st.reputation.securite + 5);
        c.hooks.notify('👮 La police renforce ses patrouilles dans le secteur. Le quartier vous remercie… pas tout le monde.', 'good');
        if (c.rng.chance(0.4)) c.st.flags.tagTonight = true;
      } else {
        st.flags.refusedDeal = dayOf(st.time);
        c.hooks.notify('🙅 Vous refusez. Le type hausse les épaules : « Dommage. Belle vitrine, en tout cas. »', 'info');
        if (c.rng.chance(0.5)) c.st.flags.tagTonight = true;
      }
    },
  },
  {
    id: 'rodeurs',
    name: 'Rôdeurs devant l’entrée',
    cooldownDays: 3,
    weight: (c) => {
      const h = hourOf(c.st.time);
      if (h < 18 || h > 23) return 0;
      const q = c.st.quartiers.find((x) => x.id === 'centre')!;
      return 0.04 * (1 - q.safety) * (c.st.store.upgrades['eclairage_ext'] ? 0.4 : 1);
    },
    start(c) {
      c.hooks.spawnSpecial('rodeurs');
      ask(c, 'rodeurs', 'Rassemblement devant le magasin', 'Un groupe traîne bruyamment devant l’entrée. Certains clients hésitent à entrer.', [
        { id: 'parler', label: 'Aller leur parler', hint: 'Allez les voir et appuyez sur E' },
        { id: 'police', label: 'Appeler la police', hint: 'Efficace, mais froisse la cité' },
        { id: 'ignorer', label: 'Ignorer' },
      ], 90);
      return mkEvent(c, 'rodeurs', 120);
    },
    choose(c, _ch, opt) {
      if (opt === 'police') {
        c.hooks.spawnSpecial('police');
        const t = c.st.quartiers.find((x) => x.id === 'tilleuls')!;
        for (const r of c.st.residents) if (r.quartier === 'tilleuls') r.loyalty.player = clamp01(r.loyalty.player - 0.03);
        t.safety = clamp01(t.safety + 0.02);
        const ev = c.st.activeEvents.find((e) => e.id === 'rodeurs');
        if (ev) ev.end = c.st.time + 15;
      } else if (opt === 'parler') {
        c.hooks.notify('🗣️ Allez voir le groupe devant l’entrée et appuyez sur E pour discuter.', 'info');
      }
    },
  },
  {
    id: 'chat',
    name: 'Un chat dans la réserve',
    cooldownDays: 999,
    weight: (c) => (!c.st.flags.cat && dayOf(c.st.time) > 2 ? 0.01 : 0),
    start(c) {
      ask(c, 'chat', 'Un intrus à moustaches', 'Un chat roux s’est installé dans la réserve, sur un carton de croquettes… que vous ne vendez pas. Il vous fixe.', [
        { id: 'adopter', label: 'L’adopter comme mascotte', hint: '+ambiance, +moral' },
        { id: 'spa', label: 'Appeler la SPA' },
      ], 600);
      return mkEvent(c, 'chat', 600);
    },
    choose(c, _ch, opt) {
      if (opt === 'adopter') {
        c.st.flags.cat = { name: c.rng.pick(['Gérard', 'Promo', 'Caddie', 'Ticket', 'Monsieur Prix']) };
        c.hooks.spawnSpecial('chat');
        for (const e of c.st.employees) e.mood = clamp01(e.mood + 0.1);
        c.hooks.notify(`🐈 ${c.st.flags.cat.name} est officiellement la mascotte du magasin. Il refuse de porter l’uniforme.`, 'good');
      } else c.st.flags.cat = false;
    },
  },
  {
    id: 'enfant_perdu',
    name: 'Enfant perdu',
    cooldownDays: 10,
    weight: (c) => (storeOpenNow(c.st) ? 0.006 : 0),
    start(c) {
      ask(c, 'enfant_perdu', 'Enfant perdu', 'Un petit garçon en pyjama dinosaure a perdu sa maman au rayon céréales.', [
        { id: 'annonce', label: 'Faire une annonce au micro' },
        { id: 'attendre', label: 'Lui donner un bonbon et attendre' },
      ], 30);
      return mkEvent(c, 'enfant_perdu', 30);
    },
    choose(c, _ch, opt) {
      if (opt === 'annonce') {
        c.hooks.announce('La maman du petit Timéo, pyjama dinosaure, est attendue à l’accueil. Timéo va bien, il a mangé deux bonbons.');
        c.st.reputation.service = Math.min(100, c.st.reputation.service + 3);
        c.hooks.notify('👩‍👦 Maman retrouvée en 2 minutes. Elle racontera ça à tout le quartier.', 'good');
      } else {
        c.hooks.notify('🍬 Timéo a mangé 14 bonbons. Sa maman est arrivée. Elle n’était pas ravie.', 'info');
      }
    },
  },
  {
    id: 'canicule',
    name: 'Canicule',
    cooldownDays: 12,
    weight: (c) => (season(dayOf(c.st.time)) === 'été' && hourOf(c.st.time) < 10 ? 0.06 : 0),
    start(c) {
      c.st.weather = { kind: 'canicule', until: c.st.time + 2 * 1440 };
      c.hooks.notify('🥵 Canicule ! Ruée sur les boissons et les glaces. Les meubles froids souffrent, les clients s’impatientent.', 'event');
      return mkEvent(c, 'canicule', 2 * 1440);
    },
  },
  {
    id: 'commande_asso',
    name: 'Commande spéciale',
    cooldownDays: 9,
    weight: (c) => (hourOf(c.st.time) > 9 && hourOf(c.st.time) < 17 && c.st.assortment.includes('baguette') ? 0.012 : 0),
    start(c) {
      const pids = c.rng.shuffle(c.st.assortment.filter((p) => PRODUCT_BY_ID[p].category === 'boissons' || PRODUCT_BY_ID[p].category === 'boulangerie' || PRODUCT_BY_ID[p].category === 'snacks')).slice(0, 2);
      if (!pids.length) return null;
      const lines = pids.map((pid) => ({ pid, q: c.rng.int(10, 24) }));
      const value = Math.round(lines.reduce((a, l) => a + PRODUCT_BY_ID[l.pid].price * l.q, 0) * 1.15);
      ask(c, 'commande_asso', 'Commande du club de foot', `Le club de foot des Tilleuls commande ${lines.map((l) => `${l.q} × ${PRODUCT_BY_ID[l.pid].name}`).join(' et ')} pour ${money0(value)} (prix majoré, ils sont pressés). Les articles seront prélevés en réserve.`, [
        { id: 'oui', label: 'Accepter' },
        { id: 'non', label: 'Refuser' },
      ], 120, { lines, value });
      return mkEvent(c, 'commande_asso', 120);
    },
    choose(c, ch, opt) {
      if (opt !== 'oui') return;
      const { lines, value } = ch.data as { lines: { pid: string; q: number }[]; value: number };
      let wanted = 0;
      let got = 0;
      for (const l of lines) {
        wanted += l.q;
        got += takeUnitsFromBackroom(c.st, l.pid, l.q);
      }
      const ratio = wanted ? got / wanted : 0;
      const paid = Math.round(value * ratio);
      earn(c.st, 'ventes', paid);
      c.st.today.revenue += paid;
      c.st.stats.totalRevenue += paid;
      if (ratio >= 1) c.hooks.notify(`🏆 Commande livrée au club : +${money0(paid)}. Le coach vous offre une écharpe.`, 'good');
      else {
        c.st.reputation.service = Math.max(0, c.st.reputation.service - 4);
        c.hooks.notify(`😕 Stock insuffisant en réserve : commande livrée à ${Math.round(ratio * 100)} % (${money0(paid)}). Le club est déçu.`, 'bad');
      }
    },
  },
];

export const EVENT_BY_ID: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

/** Tirage horaire des événements (une seule nouveauté par heure au maximum). */
export function hourlyEvents(c: EventCtx): ActiveEvent | null {
  const st = c.st;
  const day = dayOf(st.time);
  const candidates = EVENTS.filter((e) => (st.eventCooldowns[e.id] ?? -999) <= day && !isActive(st, e.id));
  const diff = st.difficulty === 'facile' ? 0.6 : st.difficulty === 'enfer' ? 1.6 : 1;
  for (const e of c.rng.shuffle([...candidates])) {
    const w = e.weight(c) * diff;
    if (w > 0 && c.rng.chance(w)) {
      const ev = e.start(c);
      if (ev) {
        st.activeEvents.push(ev);
        st.eventCooldowns[e.id] = day + e.cooldownDays;
        return ev;
      }
    }
  }
  return null;
}

export function tickEvents(c: EventCtx) {
  const st = c.st;
  for (const ev of [...st.activeEvents]) {
    if (st.time >= ev.end && !ev.resolved) {
      ev.resolved = true;
      EVENT_BY_ID[ev.id]?.end?.(c, ev);
    }
  }
  st.activeEvents = st.activeEvents.filter((e) => !e.resolved || st.time < e.end + 60);
  // choix expirés : option par défaut = dernière
  for (const ch of [...st.pendingChoices]) {
    if (st.time > ch.expires) {
      resolveChoice(c, ch, ch.options[ch.options.length - 1].id);
    }
  }
}

export function resolveChoice(c: EventCtx, choice: PendingChoice, option: string) {
  const st = c.st;
  st.pendingChoices = st.pendingChoices.filter((x) => x.uid !== choice.uid);
  EVENT_BY_ID[choice.eventId]?.choose?.(c, choice, option);
}

/** Météo : nouveau temps quand le précédent expire. */
export function weatherDaily(st: GameState, rng: Rng) {
  if (st.time < st.weather.until) return;
  const se = season(dayOf(st.time));
  const table: [GameState['weather']['kind'], number][] =
    se === 'été' ? [['soleil', 6], ['nuageux', 2], ['orage', 1], ['pluie', 0.5]] : se === 'hiver' ? [['nuageux', 4], ['pluie', 3], ['soleil', 2], ['neige', 0.6]] : [['soleil', 3], ['nuageux', 3], ['pluie', 2.5], ['orage', 0.4]];
  const kind = rng.weighted(table, (t) => t[1])![0];
  st.weather = { kind, until: st.time + rng.int(6, 30) * 60 };
}

export { insuranceClaim, CATEGORIES };
