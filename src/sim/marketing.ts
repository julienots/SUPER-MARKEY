/** Promotions et campagnes marketing (effets réels sur la notoriété et le comportement d'achat). */
import type { CategoryId } from '../data/products';
import { clamp01 } from '../core/math';
import { spend } from './economy';
import { allocUid, dayOf, type CampaignKind, type GameState, type PromoKind } from './state';

export const PROMO_KINDS: { id: PromoKind; name: string; desc: string }[] = [
  { id: 'percent', name: 'Remise en %', desc: 'Prix barré sur l’étiquette.' },
  { id: 'lot3x2', name: '3 pour 2', desc: 'Le 3ᵉ article offert : les chasseurs de promos en prennent 3.' },
  { id: 'second50', name: '2ᵉ à −50 %', desc: 'Encourage l’achat par deux.' },
  { id: 'flash', name: 'Vente flash (aujourd’hui)', desc: 'Forte remise d’un jour, très visible.' },
  { id: 'antigaspi', name: 'Anti-gaspi automatique', desc: 'Remise sur tous les produits à date courte (J-1).' },
];

export const CAMPAIGNS: { id: CampaignKind; name: string; desc: string; cost: number; days: number; strength: number; reach: number }[] = [
  { id: 'flyers', name: 'Distribution de flyers', desc: 'Boîtes aux lettres des Tilleuls et du centre.', cost: 180, days: 3, strength: 0.6, reach: 0.35 },
  { id: 'affiches', name: 'Affiches abribus', desc: 'Visibles par les passants et usagers du bus.', cost: 260, days: 7, strength: 0.4, reach: 0.25 },
  { id: 'radio', name: 'Spot sur Radio Banlieue FM', desc: '« BAZAR BAZAR, c’est le bazar… mais pas cher ! »', cost: 900, days: 5, strength: 0.8, reach: 0.6 },
  { id: 'reseaux', name: 'Campagne sur Pépito (réseau social)', desc: 'Touche surtout les jeunes et les étudiants.', cost: 420, days: 4, strength: 0.7, reach: 0.45 },
  { id: 'lancement', name: 'Opération « Grande réouverture »', desc: 'Ballons, animations, tout le quartier est au courant.', cost: 1500, days: 2, strength: 1.2, reach: 0.9 },
];

export function launchPromo(st: GameState, kind: PromoKind, opts: { pids?: string[]; category?: CategoryId; value: number; days: number; advertised: boolean; name?: string }): { ok: boolean; msg: string } {
  const day = dayOf(st.time);
  const adCost = opts.advertised ? 60 + opts.days * 15 : 0;
  if (adCost && st.cash < adCost) return { ok: false, msg: 'Trésorerie insuffisante pour l’affichage.' };
  if (adCost) spend(st, 'marketing', adCost);
  const days = kind === 'flash' ? 1 : opts.days;
  st.promos.push({
    id: allocUid(st),
    kind,
    pids: opts.pids ?? [],
    category: opts.category,
    value: kind === 'lot3x2' || kind === 'second50' ? 0 : opts.value,
    start: day,
    end: day + days - 1,
    name: opts.name ?? PROMO_KINDS.find((p) => p.id === kind)!.name,
    advertised: opts.advertised,
  });
  st.stats.promosLaunched++;
  if (opts.advertised) for (const r of st.residents) if (Math.random() < 0.25) r.awareness = clamp01(r.awareness + 0.05);
  return { ok: true, msg: `Promotion lancée pour ${days} jour(s).${adCost ? ` Affichage : ${adCost} €.` : ''}` };
}

export function stopPromo(st: GameState, id: number) {
  const p = st.promos.find((x) => x.id === id);
  if (p) p.end = dayOf(st.time) - 1;
}

export function cleanupPromos(st: GameState) {
  const day = dayOf(st.time);
  st.promos = st.promos.filter((p) => p.end >= day - 7);
}

export function launchCampaign(st: GameState, id: CampaignKind): { ok: boolean; msg: string } {
  const c = CAMPAIGNS.find((x) => x.id === id)!;
  if (st.cash < c.cost) return { ok: false, msg: 'Trésorerie insuffisante.' };
  spend(st, 'marketing', c.cost);
  const day = dayOf(st.time);
  st.campaigns.push({ id: allocUid(st), kind: id, start: day, end: day + c.days - 1, strength: c.strength });
  for (const r of st.residents) {
    const young = r.archetype === 'etudiant' || r.archetype === 'ado';
    const p = c.reach * (id === 'reseaux' ? (young ? 1.6 : 0.5) : id === 'flyers' && r.quartier === 'coteaux' ? 0.5 : 1);
    if (Math.random() < p) r.awareness = clamp01(r.awareness + 0.25 * c.strength);
  }
  return { ok: true, msg: `${c.name} lancée !` };
}
