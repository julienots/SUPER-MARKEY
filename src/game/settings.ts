/** Paramètres du joueur (persistés séparément des sauvegardes). */
export interface Settings {
  quality: 'basse' | 'moyenne' | 'haute';
  shadows: boolean;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  maxCustomers: number;
  volMaster: number;
  volMusic: number;
  volAmbience: number;
  volSfx: number;
  volVoice: number;
  comicSounds: boolean;
  reduceMotion: boolean;
  menuAnimations: boolean;
  announcements: boolean;
  uiScale: number;
  barks: boolean;
  thirdPerson: boolean;
  autosaveMinutes: number;
  pauseOnTablet: boolean;
  keys: Record<string, string>;
}

export const DEFAULT_KEYS: Record<string, string> = {
  avancer: 'KeyW',
  reculer: 'KeyS',
  gauche: 'KeyA',
  droite: 'KeyD',
  sauter: 'Space',
  courir: 'ShiftLeft',
  interagir: 'KeyE',
  secondaire: 'KeyF',
  prix: 'KeyR',
  lacher: 'KeyG',
  tablette: 'Tab',
  construction: 'KeyB',
  camera: 'KeyV',
  pause: 'Escape',
  vitesse: 'KeyT',
  quitterCaisse: 'KeyQ',
  surveillance: 'KeyC',
};

export const KEY_LABELS: Record<string, string> = {
  avancer: 'Avancer',
  reculer: 'Reculer',
  gauche: 'Gauche',
  droite: 'Droite',
  sauter: 'Sauter',
  courir: 'Courir',
  interagir: 'Interagir / Prendre',
  secondaire: 'Action secondaire (ouvrir, assigner)',
  prix: 'Changer le prix',
  lacher: 'Lâcher l’objet',
  tablette: 'Tablette de gestion',
  construction: 'Mode construction',
  camera: 'Vue 1ʳᵉ / 3ᵉ personne',
  pause: 'Pause / menu',
  vitesse: 'Vitesse du temps',
  quitterCaisse: 'Quitter la caisse',
  surveillance: 'Écrans de surveillance',
};

export const DEFAULT_SETTINGS: Settings = {
  quality: 'haute',
  shadows: true,
  fov: 72,
  sensitivity: 1,
  invertY: false,
  maxCustomers: 32,
  volMaster: 0.8,
  volMusic: 0.45,
  volAmbience: 0.6,
  volSfx: 0.8,
  volVoice: 0.8,
  comicSounds: true,
  reduceMotion: false,
  menuAnimations: true,
  announcements: true,
  uiScale: 1,
  barks: true,
  thirdPerson: false,
  autosaveMinutes: 1440,
  pauseOnTablet: false,
  keys: { ...DEFAULT_KEYS },
};

const KEY = 'bazarbazar.settings';

export function loadSettings(): Settings {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_SETTINGS), ...s, keys: { ...DEFAULT_KEYS, ...(s.keys ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible */
  }
}
