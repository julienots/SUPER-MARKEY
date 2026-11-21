/** Réglages du joueur (gardés sur l'appareil). */
export interface Settings {
  music: number;
  sfx: number;
  quality: 'basse' | 'normale' | 'haute';
  name: string;
  tutorial: boolean;
}

const KEY = 'bazarbazar2.settings';

export function loadSettings(): Settings {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const def: Settings = { music: 0.5, sfx: 0.6, quality: mobile ? 'normale' : 'haute', name: '', tutorial: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return def;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible */
  }
}
