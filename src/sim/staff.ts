/**
 * Ressources humaines : annonces, candidatures, embauche, plannings, salaires, moral, fatigue, formation.
 * Le comportement physique (marcher, remplir, encaisser) est dans entities/employee.ts.
 */
import { FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES } from '../data/names';
import { ROLE_BY_ID, TRAITS, type RoleId, type TraitId } from '../data/roles';
import type { Rng } from '../core/rng';
import { clamp, clamp01 } from '../core/math';
import { dayOfWeek } from '../core/time';
import { spend } from './economy';
import { allocUid, dayOf, hourOf, type Candidate, type Employee, type GameState } from './state';

const PITCHES = [
  'Motivé·e, ponctuel·le, et je sais compter jusqu’à très loin.',
  'J’ai trois ans d’expérience en grande surface et un caddie à mon nom.',
  'Je cherche un emploi stable près de chez moi, aux Tilleuls.',
  'Étudiant·e, disponible le soir et le week-end. Je scanne plus vite que mon ombre.',
  'Ancien·ne vigile de discothèque. Rien ne m’échappe.',
  'Je range tout par couleur. Tout. Même les gens.',
  'Reconversion professionnelle : j’étais mime. Je travaille en silence.',
  'Je connais tout le quartier, les clients me font confiance.',
];

export function postJob(st: GameState, role: RoleId, wage: number, days: number): boolean {
  const cost = 40 + days * 15;
  if (st.cash < cost) return false;
  spend(st, 'recrutement', cost);
  st.jobPostings.push({ role, until: dayOf(st.time) + days, wage });
  return true;
}

export function makeCandidate(st: GameState, rng: Rng, role: RoleId, offeredWage: number): Candidate {
  const female = rng.chance(0.5);
  const base = ROLE_BY_ID[role].baseWage;
  const skill = clamp01(rng.gauss(0.45 + (offeredWage / base - 1) * 0.6, 0.18));
  const exp = Math.max(0, Math.round(rng.gauss(skill * 2000, 400)));
  const traits: TraitId[] = [];
  const nTraits = rng.int(1, 2);
  for (let i = 0; i < nTraits; i++) {
    const t = rng.pick(TRAITS).id;
    if (!traits.includes(t)) traits.push(t);
  }
  return {
    id: allocUid(st),
    name: `${rng.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M)} ${rng.pick(LAST_NAMES)}`,
    female,
    seed: rng.int(1, 2 ** 30),
    role,
    wage: offeredWage,
    expectedWage: Math.round(base * (0.95 + skill * 0.35) * 10) / 10,
    skill,
    speed: clamp(rng.gauss(1, 0.15) + (traits.includes('rapide') ? 0.2 : 0) - (traits.includes('flemme') ? 0.15 : 0), 0.6, 1.45),
    reliability: clamp01(rng.gauss(0.8, 0.12) + (traits.includes('ponctuel') ? 0.15 : 0)),
    experience: exp,
    traits,
    expires: dayOf(st.time) + 3,
    pitch: rng.pick(PITCHES),
    wantsCdi: skill > 0.6 && rng.chance(0.55),
  };
}

/** Génère les candidatures (appelé chaque heure de jeu). */
export function hourlyRecruitment(st: GameState, rng: Rng) {
  const day = dayOf(st.time);
  st.jobPostings = st.jobPostings.filter((j) => j.until >= day);
  st.candidates = st.candidates.filter((c) => c.expires >= day);
  for (const j of st.jobPostings) {
    const attract = (j.wage / ROLE_BY_ID[j.role].baseWage) * (0.6 + st.reputation.overall / 200);
    if (rng.chance(0.3 * attract) && st.candidates.length < 12) st.candidates.push(makeCandidate(st, rng, j.role, j.wage));
  }
}

export const CDD_DURATIONS = [7, 14, 30];
/** Période d'essai d'un CDI (jours). */
export const CDI_TRIAL = 7;

export function hire(st: GameState, candidateId: number, wage?: number, contract: { type: 'CDI' | 'CDD'; days?: number } = { type: 'CDI' }): { ok: boolean; msg: string; emp?: Employee } {
  const c = st.candidates.find((x) => x.id === candidateId);
  if (!c) return { ok: false, msg: 'Candidature introuvable.' };
  if (ROLE_BY_ID[c.role].requires && !st.equipment.some((e) => e.def === ROLE_BY_ID[c.role].requires)) return { ok: false, msg: 'Il faut d’abord installer un bureau pour embaucher un manager.' };
  const w = wage ?? c.wage;
  if (w < c.expectedWage * 0.92) return { ok: false, msg: `${c.name.split(' ')[0]} refuse : salaire trop bas (attendu ${c.expectedWage.toFixed(2)} €/h).` };
  if (contract.type === 'CDD' && c.wantsCdi) return { ok: false, msg: `${c.name.split(' ')[0]} refuse le CDD : « Je ne signe qu’en CDI. »` };
  const role = c.role;
  const today = dayOf(st.time);
  const defaultShift: Record<RoleId, [number, number]> = { caissier: [st.store.openHour, Math.min(st.store.closeHour, st.store.openHour + 8)], rayon: [Math.max(6, st.store.openHour - 2), Math.max(6, st.store.openHour - 2) + 8], logisticien: [6, 14], entretien: [Math.max(st.store.closeHour - 6, 12), st.store.closeHour + 1], securite: [Math.max(st.store.closeHour - 8, st.store.openHour), st.store.closeHour], manager: [st.store.openHour, st.store.openHour + 9] };
  const [s0, s1] = defaultShift[role];
  const emp: Employee = {
    id: c.id,
    name: c.name,
    female: c.female,
    seed: c.seed,
    role,
    wage: w,
    skill: c.skill,
    speed: c.speed,
    reliability: c.reliability,
    experience: c.experience,
    mood: clamp01(0.65 + (w / c.expectedWage - 1)),
    fatigue: 0,
    shiftStart: s0,
    shiftEnd: Math.min(24, s1),
    daysOff: [6],
    traits: c.traits,
    hiredDay: dayOf(st.time),
    zone: null,
    priority: null,
    trainingUntil: -1,
    absentToday: false,
    lowMoodDays: 0,
    relations: {},
    contract:
      contract.type === 'CDD'
        ? { type: 'CDD', start: today, end: today + (contract.days ?? 14) - 1, renewals: 0, paid: 0 }
        : { type: 'CDI', start: today, trialEnd: today + CDI_TRIAL, renewals: 0, paid: 0 },
  };
  // un CDI rassure (moral), un CDD un peu moins
  emp.mood = clamp01(emp.mood + (contract.type === 'CDI' ? 0.08 : -0.04));
  st.employees.push(emp);
  st.candidates = st.candidates.filter((x) => x.id !== c.id);
  st.stats.hires++;
  return { ok: true, msg: `${emp.name} rejoint l’équipe (${ROLE_BY_ID[role].name}, ${contract.type === 'CDD' ? `CDD de ${contract.days ?? 14} jours` : 'CDI'}).`, emp };
}

/** Coût d'une rupture de contrat à l'initiative du magasin. */
export function fireCost(st: GameState, e: Employee): number {
  const day = dayOf(st.time);
  const k = e.contract;
  if (k?.type === 'CDD') {
    // rupture anticipée d'un CDD : salaires restants jusqu'au terme + prime de précarité
    const left = Math.max(0, (k.end ?? day) - day + 1);
    const daily = e.wage * Math.max(1, e.shiftEnd - e.shiftStart) * (6 / 7);
    return Math.round(left * daily + k.paid * 0.1);
  }
  if (k?.type === 'CDI' && (k.trialEnd ?? -1) >= day) return 0; // période d'essai
  const days = day - e.hiredDay;
  return Math.round(e.wage * 8 * (2 + days / 30));
}

export function fire(st: GameState, id: number): number {
  const e = st.employees.find((x) => x.id === id);
  if (!e) return 0;
  const comp = fireCost(st, e);
  if (comp > 0) spend(st, 'salaires', comp);
  st.employees = st.employees.filter((x) => x.id !== id);
  for (const o of st.employees) {
    // le moral de l'équipe baisse un peu (surtout les amis)
    o.mood = clamp01(o.mood - 0.04 - Math.max(0, o.relations[id] ?? 0) * 0.1);
    delete o.relations[id];
  }
  return comp;
}

/** Renouvelle un CDD (2 fois au maximum). */
export function renewCdd(st: GameState, id: number, days: number): { ok: boolean; msg: string } {
  const e = st.employees.find((x) => x.id === id);
  const k = e?.contract;
  if (!e || k?.type !== 'CDD') return { ok: false, msg: 'Ce n’est pas un CDD.' };
  if (k.renewals >= 2) return { ok: false, msg: `Le CDD de ${e.name} a déjà été renouvelé 2 fois : proposez un CDI.` };
  k.renewals++;
  k.end = Math.max(k.end ?? dayOf(st.time), dayOf(st.time)) + days;
  e.mood = clamp01(e.mood + 0.03);
  return { ok: true, msg: `CDD de ${e.name} renouvelé jusqu’au jour ${k.end + 1}.` };
}

/** Transforme un CDD en CDI (pas de prime de précarité, moral en hausse). */
export function toCdi(st: GameState, id: number): { ok: boolean; msg: string } {
  const e = st.employees.find((x) => x.id === id);
  if (!e) return { ok: false, msg: 'Employé introuvable.' };
  if (e.contract?.type !== 'CDD') return { ok: false, msg: `${e.name} est déjà en CDI.` };
  e.contract = { type: 'CDI', start: dayOf(st.time), renewals: 0, paid: 0 };
  e.mood = clamp01(e.mood + 0.15);
  return { ok: true, msg: `🎉 ${e.name} passe en CDI ! Moral au beau fixe.` };
}

export function train(st: GameState, id: number): boolean {
  const e = st.employees.find((x) => x.id === id);
  const cost = 250 + Math.round((e?.skill ?? 0) * 400);
  if (!e || st.cash < cost || e.trainingUntil >= dayOf(st.time)) return false;
  spend(st, 'formation', cost);
  e.trainingUntil = dayOf(st.time) + 1;
  e.skill = clamp01(e.skill + 0.15);
  e.mood = clamp01(e.mood + 0.08);
  return true;
}

export const trainingCost = (e: Employee) => 250 + Math.round(e.skill * 400);

/** L'employé doit-il être au travail maintenant ? */
export function onShift(st: GameState, e: Employee, t = st.time): boolean {
  const day = dayOf(t);
  if (e.absentToday || e.trainingUntil >= day || (e.sickUntil ?? -1) >= day) return false;
  if (e.daysOff.includes(dayOfWeek(day))) return false;
  const h = hourOf(t);
  return h >= e.shiftStart && h < e.shiftEnd;
}

/** Salaire versé à la minute travaillée (appelé chaque minute de jeu pour les présents). */
export function accrueWages(st: GameState, minutes: number, present: Employee[]) {
  let total = 0;
  for (const e of present) {
    const night = hourOf(st.time) >= 21 || hourOf(st.time) < 6 ? 1.25 : 1;
    const w = (e.wage * night * minutes) / 60;
    total += w;
    if (e.contract) e.contract.paid += w;
    e.experience += minutes / 60;
  }
  spend(st, 'salaires', total);
}

/** Évolution de l'humeur pendant le service. */
export function moodTick(st: GameState, e: Employee, minutes: number, ctx: { hasBreakRoom: boolean; hasLockers: boolean; managerPresent: boolean; queuePressure: number }) {
  const lazy = e.traits.includes('flemme') ? 1.3 : 1;
  e.fatigue = clamp01(e.fatigue + (minutes / 480) * 0.8 * lazy * (1 + ctx.queuePressure * 0.3));
  let d = 0;
  if (e.fatigue > 0.75) d -= 0.0008 * minutes;
  if (ctx.managerPresent) d += 0.0003 * minutes;
  if (!ctx.hasLockers) d -= 0.0001 * minutes;
  d -= ctx.queuePressure * 0.0002 * minutes;
  e.mood = clamp01(e.mood + d);
}

export function restTick(e: Employee, minutes: number, inBreakRoom: boolean) {
  e.fatigue = clamp01(e.fatigue - (minutes / 60) * (inBreakRoom ? 2.0 : 1.0));
  if (inBreakRoom) e.mood = clamp01(e.mood + 0.002 * minutes);
}

/** Matin : absences, récupération nocturne, démissions. Renvoie des messages. */
export function staffMorning(st: GameState, rng: Rng): string[] {
  const msgs: string[] = [];
  const day = dayOf(st.time);
  const quitters: number[] = [];
  for (const e of st.employees) {
    e.fatigue = clamp01(e.fatigue * 0.15);
    e.absentToday = false;
    const absentP = (1 - e.reliability) * 0.12 + (e.mood < 0.3 ? 0.08 : 0);
    if (!e.daysOff.includes(dayOfWeek(day)) && rng.chance(absentP)) {
      e.absentToday = true;
      msgs.push(`🤒 ${e.name} ne viendra pas aujourd’hui (${rng.pick(['panne de réveil', 'grippe', 'enfant malade', 'RER en grève', 'raison mystérieuse'])}).`);
    }
    if (e.mood < 0.25) e.lowMoodDays++;
    else e.lowMoodDays = Math.max(0, e.lowMoodDays - 1);
    if (e.lowMoodDays >= 4 && rng.chance(0.35)) {
      quitters.push(e.id);
      msgs.push(`🚪 ${e.name} démissionne : « Je mérite mieux que ce rayon conserves. »`);
    }
    // relations entre collègues
    for (const o of st.employees) {
      if (o.id === e.id) continue;
      const r = e.relations[o.id] ?? 0;
      e.relations[o.id] = clamp(r + rng.gauss(0.01, 0.03) + (e.traits.includes('bavard') ? 0.01 : 0), -1, 1);
    }
  }
  // fins de CDD : départ avec la prime de précarité (10 % des salaires versés) ; prévenir la veille
  for (const e of st.employees) {
    const k = e.contract;
    if (k?.type !== 'CDD' || k.end === undefined || quitters.includes(e.id)) continue;
    if (day > k.end) {
      const prime = Math.round(k.paid * 0.1);
      if (prime > 0) spend(st, 'salaires', prime);
      quitters.push(e.id);
      msgs.push(`📝 Fin du CDD de ${e.name} : départ aujourd’hui (prime de précarité ${prime} €).`);
    } else if (day === k.end) msgs.push(`📝 Le CDD de ${e.name} se termine ce soir : renouvelez-le ou proposez un CDI (écran Équipe).`);
  }
  st.employees = st.employees.filter((e) => !quitters.includes(e.id));
  return msgs;
}

/** Facteur d'efficacité global (compétence, humeur, fatigue, traits). */
export function efficiency(e: Employee): number {
  return clamp((0.55 + e.skill * 0.45) * (0.75 + e.mood * 0.35) * (1 - e.fatigue * 0.4) * e.speed, 0.25, 1.6);
}
