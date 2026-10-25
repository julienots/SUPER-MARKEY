/**
 * Sauvegardes : état logique uniquement (JSON versionné), migrations, emplacements multiples,
 * sauvegarde automatique, export/import de fichier. Les objets physiques sont reconstruits au chargement.
 */
import { SAVE_VERSION, emptyDay, type GameState } from '../sim/state';
import { defaultFacade } from '../sim/layout';
import { makeCompetitors, makeQuartiers } from '../sim/market';
import { ensureUidAbove } from '../core/math';
import LZString from 'lz-string';

const LZ = 'LZ1:';
/** Arrondit les flottants (les sauvegardes restent compactes). */
const compact = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);

export interface SaveFile {
  format: 'bazarbazar-save';
  version: number;
  savedAt: number;
  meta: { storeName: string; day: number; cash: number; stage: number; rep: number };
  state: GameState;
}

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
const PREFIX = 'bazarbazar.save.';

type Migration = (s: any) => any;
/** Migrations successives : la clé est la version de départ. */
const MIGRATIONS: Record<number, Migration> = {
  1: (s) => {
    s.store.facade = s.store.facade ?? defaultFacade(s.store.stage ?? 0);
    s.competitors = s.competitors ?? makeCompetitors();
    s.version = 2;
    return s;
  },
  2: (s) => {
    s.quartiers = s.quartiers ?? makeQuartiers();
    s.today.expenses.pertes = s.today.expenses.pertes ?? 0;
    for (const d of s.ledger ?? []) d.expenses.pertes = d.expenses.pertes ?? 0;
    s.flags = s.flags ?? {};
    s.version = 3;
    return s;
  },
};

export function migrate(raw: any): GameState {
  let s = raw;
  if (typeof s.version !== 'number') throw new Error('Sauvegarde invalide (pas de version)');
  if (s.version > SAVE_VERSION) throw new Error(`Sauvegarde trop récente (v${s.version}) pour cette version du jeu (v${SAVE_VERSION})`);
  while (s.version < SAVE_VERSION) {
    const m = MIGRATIONS[s.version];
    if (!m) throw new Error(`Aucune migration depuis la version ${s.version}`);
    s = m(s);
  }
  // champs facultatifs ajoutés au fil du temps
  s.today = s.today ?? emptyDay(Math.floor(s.time / 1440));
  s.pendingChoices = s.pendingChoices ?? [];
  s.looseItems = s.looseItems ?? [];
  validate(s);
  return s as GameState;
}

function validate(s: any) {
  const req = ['time', 'cash', 'store', 'equipment', 'residents', 'employees', 'orders', 'ledger', 'reputation', 'stats'];
  for (const k of req) if (s[k] === undefined) throw new Error(`Sauvegarde corrompue : champ « ${k} » manquant`);
  if (!Array.isArray(s.equipment)) throw new Error('Sauvegarde corrompue : équipements');
  if (!Number.isFinite(s.cash) || !Number.isFinite(s.time)) throw new Error('Sauvegarde corrompue : valeurs numériques');
}

export function serialize(st: GameState): SaveFile {
  return {
    format: 'bazarbazar-save',
    version: SAVE_VERSION,
    savedAt: Date.now(),
    meta: { storeName: st.store.name, day: Math.floor(st.time / 1440), cash: Math.round(st.cash), stage: st.store.stage, rep: Math.round(st.reputation.overall) },
    state: st,
  };
}

export function deserialize(json: string): GameState {
  if (json.startsWith(LZ)) json = LZString.decompressFromUTF16(json.slice(LZ.length)) ?? '';
  const f = JSON.parse(json);
  const raw = f.format === 'bazarbazar-save' ? f.state : f;
  const st = migrate(structuredClone(raw));
  ensureUidAbove(st.nextUid);
  return st;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveToSlot(slot: string, st: GameState): { ok: boolean; error?: string } {
  const s = storage();
  if (!s) return { ok: false, error: 'Stockage local indisponible' };
  try {
    const data = LZ + LZString.compressToUTF16(JSON.stringify(serialize(st), compact));
    // double écriture : l'ancienne sauvegarde reste disponible si l'écriture échoue
    const prev = s.getItem(PREFIX + slot);
    if (prev) s.setItem(PREFIX + slot + '.bak', prev);
    s.setItem(PREFIX + slot, data);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'QuotaExceededError' ? 'Espace de stockage plein' : String(e?.message ?? e) };
  }
}

export function loadFromSlot(slot: string): { st?: GameState; error?: string } {
  const s = storage();
  if (!s) return { error: 'Stockage local indisponible' };
  const raw = s.getItem(PREFIX + slot);
  if (!raw) return { error: 'Emplacement vide' };
  try {
    return { st: deserialize(raw) };
  } catch (e: any) {
    const bak = s.getItem(PREFIX + slot + '.bak');
    if (bak) {
      try {
        return { st: deserialize(bak), error: `Sauvegarde principale illisible (${e.message}) : copie de secours chargée.` };
      } catch {
        /* rien */
      }
    }
    return { error: String(e?.message ?? e) };
  }
}

export function slotMeta(slot: string): SaveFile['meta'] & { savedAt: number } | null {
  const s = storage();
  const raw = s?.getItem(PREFIX + slot);
  if (!raw) return null;
  try {
    const f = JSON.parse(raw.startsWith(LZ) ? LZString.decompressFromUTF16(raw.slice(LZ.length)) ?? '{}' : raw);
    return { ...f.meta, savedAt: f.savedAt };
  } catch {
    return null;
  }
}

export function deleteSlot(slot: string) {
  storage()?.removeItem(PREFIX + slot);
}

export function lastSlot(): string | null {
  let best: string | null = null;
  let t = 0;
  for (const sl of SLOTS) {
    const m = slotMeta(sl);
    if (m && m.savedAt > t) {
      t = m.savedAt;
      best = sl;
    }
  }
  return best;
}

export function downloadSave(st: GameState) {
  const blob = new Blob([JSON.stringify(serialize(st))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bazarbazar-${st.store.name.replace(/\W+/g, '_')}-jour${Math.floor(st.time / 1440) + 1}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
