/**
 * Primitives de dessin 2.5D sur Canvas 2D : prismes (boîtes) éclairés, polygones au sol, ombres, textes.
 * Lumière venant de la gauche-haut : dessus clair, face avant moyenne, face droite plus sombre.
 */
import type { IsoView } from './view';

export type RGB = [number, number, number];

export const hexRgb = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export const rgbCss = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
export const shadeRgb = (c: RGB, f: number): RGB => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: number, f = 1, a = 1) => rgbCss(shadeRgb(hexRgb(c), f), a);

/** Facteurs d'éclairage des faces. */
export const LIGHT = { top: 1.08, front: 0.86, side: 0.68 };

/** Point 2D de polygone au sol (monde x, z). */
export interface P2 {
  x: number;
  z: number;
}

export function path(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

export interface PrismStyle {
  color: number;
  top?: number;
  alpha?: number;
  /** Trait de contour (style dessin). */
  outline?: string | null;
  /** Faces latérales non dessinées (couvercle seul). */
  noSides?: boolean;
  /** Faces latérales seulement (tube ouvert). */
  noTop?: boolean;
}

/**
 * Prisme droit sur un polygone convexe au sol (sens quelconque), de y0 à y1.
 * Ne dessine que les faces tournées vers le spectateur (+x, −z).
 */
export function prism(ctx: CanvasRenderingContext2D, v: IsoView, poly: P2[], y0: number, y1: number, st: PrismStyle) {
  const base = hexRgb(st.color);
  const topC = st.top !== undefined ? hexRgb(st.top) : base;
  const a = st.alpha ?? 1;
  // orientation du polygone (pour les normales sortantes)
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area += p.x * q.z - q.x * p.z;
  }
  const sgn = area >= 0 ? 1 : -1;
  if (!st.noSides && y1 > y0) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      // normale sortante (x, z) d'une arête
      const nx = (q.z - p.z) * sgn;
      const nz = -(q.x - p.x) * sgn;
      const vis = nx - nz; // spectateur vers +x, −z
      if (vis <= 1e-6) continue;
      const len = Math.hypot(nx, nz) || 1;
      // face « avant » (−z) moyennement éclairée, face « droite » (+x) plus sombre
      const k = LIGHT.side + (LIGHT.front - LIGHT.side) * Math.max(0, -nz / len);
      path(ctx, [v.px(p.x, y0, p.z), v.px(q.x, y0, q.z), v.px(q.x, y1, q.z), v.px(p.x, y1, p.z)]);
      ctx.fillStyle = rgbCss(shadeRgb(base, k), a);
      ctx.fill();
      if (st.outline) {
        ctx.strokeStyle = st.outline;
        ctx.stroke();
      }
    }
  }
  if (!st.noTop) {
    path(
      ctx,
      poly.map((p) => v.px(p.x, y1, p.z)),
    );
    ctx.fillStyle = rgbCss(shadeRgb(topC, LIGHT.top), a);
    ctx.fill();
    if (st.outline) {
      ctx.strokeStyle = st.outline;
      ctx.stroke();
    }
  }
}

/** Rectangle aligné sur les axes au sol. */
export const rect = (x0: number, z0: number, x1: number, z1: number): P2[] => [
  { x: x0, z: z0 },
  { x: x1, z: z0 },
  { x: x1, z: z1 },
  { x: x0, z: z1 },
];

/** Rectangle orienté (centre, demi-largeurs locales, angle de lacet comme les équipements). */
export function orect(cx: number, cz: number, hw: number, hd: number, yaw: number): P2[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pt = (lx: number, lz: number) => ({ x: cx + lx * c + lz * s, z: cz - lx * s + lz * c });
  return [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)];
}

export function box(ctx: CanvasRenderingContext2D, v: IsoView, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, st: PrismStyle) {
  prism(ctx, v, rect(x0, z0, x1, z1), y0, y1, st);
}

/** Polygone plat au sol (ou à une hauteur y). */
export function flat(ctx: CanvasRenderingContext2D, v: IsoView, poly: P2[], y: number, fill: string, stroke?: string) {
  path(
    ctx,
    poly.map((p) => v.px(p.x, y, p.z)),
  );
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Ombre douce elliptique au sol. */
export function shadow(ctx: CanvasRenderingContext2D, v: IsoView, x: number, z: number, r: number, a = 0.22) {
  const [sx, sy] = v.px(x, 0, z);
  const k = v.k;
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * k * 0.95, r * k * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Rectangle à coins arrondis (écran). */
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Bulle de texte (dialogue) au-dessus d'un point écran. */
export function bubble(ctx: CanvasRenderingContext2D, sx: number, sy: number, text: string, opts: { scale?: number; bg?: string; fg?: string; alpha?: number } = {}) {
  const s = opts.scale ?? 1;
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.font = `700 ${Math.round(12 * s)}px Nunito, system-ui, sans-serif`;
  const maxW = 180 * s;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  const lh = 15 * s;
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 16 * s;
  const h = lines.length * lh + 10 * s;
  const x = sx - w / 2;
  const y = sy - h - 10 * s;
  ctx.fillStyle = opts.bg ?? 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  rrect(ctx, x, y, w, h, 9 * s);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx - 6 * s, y + h - 0.5);
  ctx.lineTo(sx, y + h + 8 * s);
  ctx.lineTo(sx + 6 * s, y + h - 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = opts.fg ?? '#2d3436';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, sx, y + 5 * s + i * lh));
  ctx.restore();
}
