/** Temps de jeu : 1 seconde réelle = 1 minute de jeu à vitesse x1. */
export const MINUTES_PER_DAY = 1440;
export const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** La partie commence un lundi 2 mars (jour 60 de l'année). */
export const START_DAY_OF_YEAR = 60;

export const dayOfWeek = (day: number) => ((day % 7) + 7) % 7;
export const isWeekend = (day: number) => dayOfWeek(day) >= 5;
export const dayOfYear = (day: number) => (START_DAY_OF_YEAR + day) % 365;

export function calendarDate(day: number): { d: number; m: number; label: string } {
  let doy = dayOfYear(day);
  let m = 0;
  while (doy >= MONTH_DAYS[m]) {
    doy -= MONTH_DAYS[m];
    m++;
  }
  return { d: doy + 1, m, label: `${doy + 1} ${MONTHS[m]}` };
}

export type Season = 'hiver' | 'printemps' | 'été' | 'automne';
export function season(day: number): Season {
  const m = calendarDate(day).m;
  if (m === 11 || m <= 1) return 'hiver';
  if (m <= 4) return 'printemps';
  if (m <= 7) return 'été';
  return 'automne';
}

export const fmtClock = (minute: number) => {
  const h = Math.floor(minute / 60) % 24;
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const fmtDay = (day: number) => `${DAY_NAMES[dayOfWeek(day)]} ${calendarDate(day).label}`;
