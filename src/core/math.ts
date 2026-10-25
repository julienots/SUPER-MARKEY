export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
/** Amortissement exponentiel indépendant du framerate. */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dampAngle = (a: number, b: number, lambda: number, dt: number) =>
  a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
export const round2 = (v: number) => Math.round(v * 100) / 100;

const moneyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 2 });
const moneyFmt0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const money = (v: number) => moneyFmt.format(v).replace(/ /g, ' ');
export const money0 = (v: number) => moneyFmt0.format(v).replace(/ /g, ' ');
export const pct = (v: number) => `${Math.round(v * 100)} %`;

let uidCounter = 1;
export const nextUid = () => uidCounter++;
export const ensureUidAbove = (v: number) => {
  if (uidCounter <= v) uidCounter = v + 1;
};
