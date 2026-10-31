/**
 * Personnages et objets dessinés (style illustration 2.5D) : habitants « chibi » expressifs, produits,
 * cartons. Tout est dessiné en vectoriel sur Canvas 2D (net à toutes les résolutions, aucun asset externe).
 */
import type { Appearance } from '../entities/character';
import { PRODUCT_BY_ID, type ProductDef } from '../data/products';
import { css, hexRgb, rgbCss, shadeRgb, rrect } from './paint';

export type Carry = 'basket' | 'cart' | 'carton' | 'item' | null;
export type Mood = 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised';

export interface Pose {
  /** Direction écran du regard (x : gauche/droite, y > 0 : vers le spectateur). */
  dirX: number;
  dirY: number;
  /** Phase de marche (radians) et amplitude 0..1. */
  phase: number;
  walk: number;
  carry: Carry;
  carryColor?: number;
  mood: Mood;
  /** Action : bras levés, scan, etc. */
  action?: 'wave' | 'scan' | 'reach' | 'celebrate' | 'angry' | 'sit' | 'mop' | null;
  t: number;
  highlight?: boolean;
}

const BLACKISH = 'rgba(30,22,18,0.85)';

/** Dessine un habitant, pieds en (sx, sy). k = pixels par mètre. */
export function drawPerson(ctx: CanvasRenderingContext2D, sx: number, sy: number, k: number, a: Appearance, p: Pose) {
  const young = a.age < 16;
  const H = Math.max(0.9, a.height) * k * 0.8 * (young ? 0.92 : 1);
  const u = H;
  const front = p.dirY >= -0.05;
  const flip = p.dirX < 0 ? -1 : 1;
  const bob = p.walk > 0 ? Math.abs(Math.sin(p.phase)) * 0.025 * u * p.walk : Math.sin(p.t * 1.8) * 0.006 * u;
  const width = (a.width ?? 1) * (a.female ? 0.95 : 1.05);
  const belly = a.body ? a.body.weight : 0.5;
  const tw = u * 0.27 * width * (0.9 + belly * 0.25);
  const headR = u * (young ? 0.19 : 0.17);
  const hipY = sy - u * 0.36 - bob;
  const shoulderY = sy - u * 0.66 - bob;
  const headY = shoulderY - headR * 0.92;
  const skin = a.skin;
  const top = a.vest ?? a.top;
  const bottom = a.bottom;
  const swing = p.walk > 0 ? Math.sin(p.phase) * p.walk : 0;

  ctx.save();
  if (p.highlight) {
    ctx.strokeStyle = 'rgba(255,214,10,0.95)';
    ctx.lineWidth = Math.max(2, k * 0.05);
    ctx.beginPath();
    ctx.ellipse(sx, sy, u * 0.3, u * 0.14, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // ombre
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, u * 0.2, u * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();

  // chariot derrière le personnage s'il s'éloigne
  if (p.carry === 'cart' && !front) drawCart(ctx, sx + flip * u * 0.05, sy - u * 0.05, u, flip, false);

  // --- jambes
  const legW = u * 0.085 * (0.9 + belly * 0.2);
  const legX = tw * 0.32;
  const legH = sy - hipY;
  const skirt = a.bottomStyle === 'jupe' || a.topStyle === 'robe';
  const shortLen = a.bottomStyle === 'short' ? 0.45 : skirt ? 0.4 : 1;
  for (const side of [-1, 1]) {
    const off = side * swing * u * 0.06;
    const lx = sx + side * legX;
    const footY = sy - (side * swing > 0 ? Math.abs(swing) * u * 0.02 : 0);
    // peau (mollet nu si short/jupe)
    ctx.fillStyle = css(skin);
    rrect(ctx, lx - legW / 2 + off * 0.5, hipY, legW, footY - hipY, legW * 0.45);
    ctx.fill();
    ctx.fillStyle = css(bottom, a.bottomStyle === 'jogging' ? 0.95 : 0.9);
    rrect(ctx, lx - legW / 2 - u * 0.004 + off * 0.5, hipY, legW + u * 0.008, legH * shortLen, legW * 0.45);
    ctx.fill();
    // chaussure
    ctx.fillStyle = css(a.shoes, 0.95);
    ctx.beginPath();
    ctx.ellipse(lx + off + (front ? 0 : 0), footY - u * 0.012, legW * 0.85, u * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // jupe / robe
  if (skirt) {
    const c = a.topStyle === 'robe' ? top : bottom;
    ctx.fillStyle = css(c, 0.95);
    ctx.beginPath();
    ctx.moveTo(sx - tw * 0.5, hipY - u * 0.04);
    ctx.lineTo(sx + tw * 0.5, hipY - u * 0.04);
    ctx.lineTo(sx + tw * 0.68, hipY + legH * 0.45);
    ctx.lineTo(sx - tw * 0.68, hipY + legH * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  // --- bras arrière (dessiné avant le torse)
  const armW = u * 0.075;
  const sleeveShort = a.topStyle === 'tshirt' || a.topStyle === 'robe';
  const drawArm = (side: number, back: boolean) => {
    const ax = sx + side * (tw * 0.5 + armW * 0.25);
    let ang = side * 0.08 + (back ? -1 : 1) * swing * 0.45 * side;
    let len = u * 0.3;
    if (p.action === 'wave' && side === flip) ang = side * (2.6 + Math.sin(p.t * 9) * 0.25);
    if (p.action === 'celebrate') ang = side * (2.7 + Math.sin(p.t * 8) * 0.2);
    if (p.action === 'angry' && side === flip) ang = side * (2.4 + Math.sin(p.t * 10) * 0.35);
    if (p.action === 'scan' && side === flip) ang = side * (1.2 + Math.sin(p.t * 7) * 0.25);
    if (p.action === 'reach' && side === flip) ang = side * 1.9;
    if (p.carry === 'carton' || p.carry === 'cart') {
      ang = side * 0.5;
      len = u * 0.26;
    }
    ctx.save();
    ctx.translate(ax, shoulderY + armW * 0.4);
    ctx.rotate(-ang * (front ? 1 : -1) * 0.5 + ang * 0.5 * (front ? 0 : 0));
    ctx.rotate(ang);
    ctx.fillStyle = css(skin, back ? 0.9 : 1);
    rrect(ctx, -armW / 2, 0, armW, len, armW / 2);
    ctx.fill();
    ctx.fillStyle = css(top, back ? 0.82 : 0.92);
    rrect(ctx, -armW / 2 - u * 0.005, -u * 0.01, armW + u * 0.01, len * (sleeveShort ? 0.42 : 0.92), armW / 2);
    ctx.fill();
    // main
    ctx.fillStyle = css(skin, back ? 0.9 : 1);
    ctx.beginPath();
    ctx.arc(0, len, armW * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawArm(-flip, true);

  // --- torse
  const torsoTop = shoulderY - u * 0.02;
  const torsoH = hipY - torsoTop + u * 0.04;
  const puffy = a.topStyle === 'doudoune' ? 1.12 : a.topStyle === 'hoodie' || a.topStyle === 'veste' ? 1.05 : 1;
  ctx.fillStyle = css(top);
  rrect(ctx, sx - (tw * puffy) / 2, torsoTop, tw * puffy, torsoH, tw * 0.3);
  ctx.fill();
  // ombre latérale (volume)
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  rrect(ctx, sx + (flip > 0 ? tw * puffy * 0.18 : -(tw * puffy) / 2), torsoTop, tw * puffy * 0.32, torsoH, tw * 0.3);
  ctx.fill();
  if (a.topStyle === 'doudoune') {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = Math.max(1, u * 0.008);
    for (let i = 1; i < 4; i++) {
      const y = torsoTop + (torsoH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(sx - (tw * puffy) / 2 + 2, y);
      ctx.lineTo(sx + (tw * puffy) / 2 - 2, y);
      ctx.stroke();
    }
  }
  if (front) {
    if (a.topStyle === 'veste' || a.topStyle === 'doudoune' || a.topStyle === 'hoodie') {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(1, u * 0.01);
      ctx.beginPath();
      ctx.moveTo(sx, torsoTop + u * 0.03);
      ctx.lineTo(sx, hipY);
      ctx.stroke();
    }
    if (a.topStyle === 'chemise') {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(sx - tw * 0.18, torsoTop);
      ctx.lineTo(sx, torsoTop + u * 0.05);
      ctx.lineTo(sx + tw * 0.18, torsoTop);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(sx, torsoTop + (torsoH * i) / 4, Math.max(1, u * 0.009), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (a.apron !== null) {
      ctx.fillStyle = css(a.apron, 1.05);
      rrect(ctx, sx - tw * 0.36, torsoTop + torsoH * 0.28, tw * 0.72, torsoH * 0.85, tw * 0.1);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      rrect(ctx, sx + tw * 0.08, torsoTop + torsoH * 0.12, tw * 0.22, u * 0.035, 2);
      ctx.fill();
    }
  }
  if (a.vest !== null) {
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(sx - (tw * puffy) / 2, torsoTop + torsoH * 0.38, tw * puffy, u * 0.035);
  }

  // --- tête
  const hc = a.hair;
  const hairStyle = a.hat === 'foulard' ? 'chauve' : a.hairStyle;
  // cheveux arrière (longs) derrière la tête
  if (front && (hairStyle === 'long' || hairStyle === 'tresses')) {
    ctx.fillStyle = css(hc);
    rrect(ctx, sx - headR * 1.05, headY - headR * 0.2, headR * 2.1, headR * (hairStyle === 'long' ? 1.9 : 1.7), headR * 0.6);
    ctx.fill();
  }
  if (a.topStyle === 'hoodie' && !front) {
    ctx.fillStyle = css(top, 0.85);
    ctx.beginPath();
    ctx.ellipse(sx, shoulderY - u * 0.01, headR * 0.95, headR * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // cou
  ctx.fillStyle = css(skin, 0.9);
  ctx.fillRect(sx - headR * 0.32, headY + headR * 0.6, headR * 0.64, headR * 0.6);
  // visage
  ctx.fillStyle = css(skin);
  ctx.beginPath();
  ctx.ellipse(sx, headY, headR * 0.95, headR, 0, 0, Math.PI * 2);
  ctx.fill();
  // oreilles
  ctx.beginPath();
  ctx.ellipse(sx - headR * 0.93, headY + headR * 0.08, headR * 0.16, headR * 0.22, 0, 0, Math.PI * 2);
  ctx.ellipse(sx + headR * 0.93, headY + headR * 0.08, headR * 0.16, headR * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // cheveux
  ctx.fillStyle = css(hc);
  const cap = (cover: number) => {
    ctx.beginPath();
    ctx.ellipse(sx, headY - headR * 0.08, headR * 1.02, headR * 1.0, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(sx + headR * 1.02, headY - headR * 0.08 + headR * cover);
    ctx.quadraticCurveTo(sx, headY - headR * (front ? 0.35 : -0.9), sx - headR * 1.02, headY - headR * 0.08 + headR * cover);
    ctx.closePath();
    ctx.fill();
  };
  switch (hairStyle) {
    case 'chauve':
      break;
    case 'afro':
      ctx.beginPath();
      ctx.arc(sx, headY - headR * 0.35, headR * 1.38, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(sx, headY - headR * 0.3, headR * 1.38, headR * 1.05, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      if (!front) {
        ctx.beginPath();
        ctx.arc(sx, headY, headR * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'chignon':
      cap(front ? 0.45 : 1.2);
      ctx.beginPath();
      ctx.arc(sx, headY - headR * 1.1, headR * 0.42, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'queue':
      cap(front ? 0.45 : 1.2);
      ctx.beginPath();
      ctx.ellipse(sx + flip * headR * 0.95, headY + headR * 0.35, headR * 0.28, headR * 0.7, flip * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'long':
      cap(front ? 0.5 : 1.8);
      break;
    case 'tresses':
      cap(front ? 0.4 : 1.2);
      ctx.strokeStyle = css(hc, 0.75);
      ctx.lineWidth = Math.max(1, headR * 0.08);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * headR * 0.32, headY - headR * 0.9);
        ctx.lineTo(sx + i * headR * 0.34, headY - headR * 0.25);
        ctx.stroke();
      }
      break;
    case 'meche':
      cap(front ? 0.38 : 1.2);
      ctx.beginPath();
      ctx.ellipse(sx + flip * headR * 0.3, headY - headR * 0.55, headR * 0.6, headR * 0.28, flip * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      cap(front ? 0.32 : 1.1);
  }
  if (!front && hairStyle !== 'chauve' && hairStyle !== 'afro') {
    ctx.beginPath();
    ctx.ellipse(sx, headY + headR * 0.05, headR * 0.98, headR * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // visage (vue de face)
  if (front) {
    const ex = headR * 0.36;
    const ey = headY + headR * 0.08;
    const lookX = p.dirX * headR * 0.12;
    // yeux
    ctx.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx + s * ex + lookX, ey, headR * 0.17, headR * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const blink = Math.sin(p.t * 0.9 + sx * 0.01) > 0.985;
    ctx.fillStyle = css(a.body?.eyes ?? 0x3b2a1a, 0.9);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      if (blink) ctx.ellipse(sx + s * ex + lookX, ey, headR * 0.15, headR * 0.03, 0, 0, Math.PI * 2);
      else ctx.ellipse(sx + s * ex + lookX * 1.4, ey + headR * 0.02, headR * 0.1, headR * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    if (!blink)
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx + s * ex + lookX * 1.4 - headR * 0.03, ey - headR * 0.03, headR * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
    // sourcils
    ctx.strokeStyle = css(a.hair > 0xb0b0b0 ? 0x8a7a6a : a.hair, 0.8);
    ctx.lineWidth = Math.max(1, headR * 0.08);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const tilt = p.mood === 'angry' ? 0.22 : p.mood === 'sad' ? -0.18 : p.mood === 'surprised' ? 0 : 0.04;
      const by = ey - headR * (p.mood === 'surprised' ? 0.42 : 0.32);
      ctx.beginPath();
      ctx.moveTo(sx + s * ex - headR * 0.14, by - s * tilt * headR * 0.5 * -1 * (s > 0 ? 1 : -1));
      ctx.lineTo(sx + s * ex + headR * 0.14, by + s * tilt * headR * 0.5 * (s > 0 ? -1 : 1));
      ctx.stroke();
    }
    // joues
    ctx.fillStyle = 'rgba(255,120,110,0.22)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx + s * headR * 0.55, ey + headR * 0.32, headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // barbe
    if (a.beard) {
      ctx.fillStyle = css(a.hair, 0.95, 0.85);
      ctx.beginPath();
      ctx.ellipse(sx, headY + headR * 0.55, headR * 0.72, headR * 0.45, 0, 0, Math.PI);
      ctx.fill();
    }
    // bouche
    ctx.strokeStyle = 'rgba(120,40,40,0.9)';
    ctx.fillStyle = 'rgba(120,30,40,0.9)';
    ctx.lineWidth = Math.max(1, headR * 0.07);
    const my = headY + headR * 0.52;
    ctx.beginPath();
    if (p.mood === 'happy') {
      ctx.arc(sx, my - headR * 0.08, headR * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (p.mood === 'sad' || p.mood === 'angry') {
      ctx.arc(sx, my + headR * 0.16, headR * 0.18, 1.2 * Math.PI, 1.8 * Math.PI);
      ctx.stroke();
    } else if (p.mood === 'surprised') {
      ctx.ellipse(sx, my, headR * 0.09, headR * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.arc(sx, my - headR * 0.12, headR * 0.16, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
    }
    // lunettes
    if (a.glasses) {
      ctx.strokeStyle = BLACKISH;
      ctx.lineWidth = Math.max(1, headR * 0.06);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx + s * ex + lookX, ey, headR * 0.24, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(sx - ex + headR * 0.24 + lookX, ey);
      ctx.lineTo(sx + ex - headR * 0.24 + lookX, ey);
      ctx.stroke();
    }
  }

  // couvre-chefs
  const hat = a.hat;
  if (hat === 'casquette') {
    ctx.fillStyle = css(a.hatColor);
    ctx.beginPath();
    ctx.ellipse(sx, headY - headR * 0.25, headR * 1.03, headR * 0.82, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    if (front) {
      ctx.fillStyle = css(a.hatColor, 0.8);
      ctx.beginPath();
      ctx.ellipse(sx + flip * headR * 0.25, headY - headR * 0.25, headR * 0.9, headR * 0.18, 0, 0, Math.PI);
      ctx.fill();
    }
  } else if (hat === 'bonnet') {
    ctx.fillStyle = css(a.hatColor);
    ctx.beginPath();
    ctx.ellipse(sx, headY - headR * 0.3, headR * 1.04, headR * 1.0, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(a.hatColor, 0.8);
    rrect(ctx, sx - headR * 1.05, headY - headR * 0.42, headR * 2.1, headR * 0.3, headR * 0.12);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, headY - headR * 1.32, headR * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (hat === 'foulard') {
    ctx.fillStyle = css(a.hatColor);
    ctx.beginPath();
    ctx.ellipse(sx, headY - headR * 0.05, headR * 1.12, headR * 1.12, 0, Math.PI * 0.98, Math.PI * 2.02);
    ctx.fill();
    // pans autour du visage jusqu'aux épaules
    ctx.beginPath();
    ctx.moveTo(sx - headR * 1.12, headY);
    ctx.quadraticCurveTo(sx - headR * 1.15, headY + headR * 1.3, sx - tw * 0.55, shoulderY + u * 0.06);
    ctx.lineTo(sx + tw * 0.55, shoulderY + u * 0.06);
    ctx.quadraticCurveTo(sx + headR * 1.15, headY + headR * 1.3, sx + headR * 1.12, headY);
    ctx.lineTo(sx + headR * 0.8, headY);
    ctx.quadraticCurveTo(sx + headR * 0.85, headY + headR * 1.05, sx, headY + headR * 1.05);
    ctx.quadraticCurveTo(sx - headR * 0.85, headY + headR * 1.05, sx - headR * 0.8, headY);
    ctx.closePath();
    ctx.fill();
    if (!front) {
      ctx.beginPath();
      ctx.ellipse(sx, headY + headR * 0.1, headR * 1.12, headR * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (hat === 'beret') {
    ctx.fillStyle = '#1e1e1e';
    ctx.beginPath();
    ctx.ellipse(sx + flip * headR * 0.15, headY - headR * 0.78, headR * 0.95, headR * 0.35, flip * 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (hat === 'casque') {
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.ellipse(sx, headY - headR * 0.28, headR * 1.08, headR * 0.92, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }

  // bras avant
  drawArm(flip, false);

  // objets portés
  if (p.carry === 'basket') {
    const bx = sx + flip * (tw * 0.55 + armW * 0.6);
    const by = hipY + u * 0.05;
    ctx.fillStyle = '#d63031';
    rrect(ctx, bx - u * 0.09, by - u * 0.03, u * 0.18, u * 0.11, u * 0.02);
    ctx.fill();
    ctx.strokeStyle = '#d63031';
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.beginPath();
    ctx.arc(bx, by - u * 0.03, u * 0.07, Math.PI, 0);
    ctx.stroke();
    if (p.carryColor !== undefined) {
      ctx.fillStyle = css(p.carryColor);
      rrect(ctx, bx - u * 0.06, by - u * 0.06, u * 0.07, u * 0.05, 2);
      ctx.fill();
    }
  } else if (p.carry === 'carton') {
    const by = shoulderY + u * 0.12;
    ctx.fillStyle = '#c49a6c';
    rrect(ctx, sx - u * 0.17, by - u * 0.06, u * 0.34, u * 0.22, u * 0.015);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(sx - u * 0.17, by - u * 0.06, u * 0.34, u * 0.03);
    ctx.fillStyle = 'rgba(120,80,40,0.6)';
    ctx.fillRect(sx - u * 0.02, by - u * 0.06, u * 0.04, u * 0.22);
    if (p.carryColor !== undefined) {
      ctx.fillStyle = css(p.carryColor);
      ctx.fillRect(sx - u * 0.12, by + u * 0.04, u * 0.08, u * 0.05);
    }
  } else if (p.carry === 'item' && p.carryColor !== undefined) {
    ctx.fillStyle = css(p.carryColor);
    rrect(ctx, sx + flip * (tw * 0.55 + armW), hipY - u * 0.05, u * 0.06, u * 0.09, 2);
    ctx.fill();
  }
  if (p.carry === 'cart' && front) drawCart(ctx, sx + flip * u * 0.05, sy + u * 0.02, u, flip, true);
  ctx.restore();
}

/** Chariot de courses vu de côté (simple et lisible). */
function drawCart(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, flip: number, frontSide: boolean) {
  const w = u * 0.5;
  const h = u * 0.32;
  const bx = x + flip * u * 0.12;
  ctx.save();
  ctx.strokeStyle = frontSide ? '#636e72' : '#7f8c8d';
  ctx.lineWidth = Math.max(1, u * 0.012);
  ctx.fillStyle = 'rgba(200,214,229,0.55)';
  ctx.beginPath();
  ctx.moveTo(bx - w / 2, y - h - u * 0.12);
  ctx.lineTo(bx + w / 2, y - h - u * 0.12);
  ctx.lineTo(bx + w * 0.4, y - u * 0.12);
  ctx.lineTo(bx - w * 0.4, y - u * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2d3436';
  for (const s of [-0.35, 0.35]) {
    ctx.beginPath();
    ctx.arc(bx + s * w, y - u * 0.04, u * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------ produits (icônes pour la boutique, les panneaux)
const iconCache = new Map<string, string>();

/** Dessine un produit vu de face dans un rectangle (x, y, w, h). */
export function drawProduct(ctx: CanvasRenderingContext2D, p: ProductDef, x: number, y: number, w: number, h: number) {
  const c1 = p.color;
  const c2 = p.color2;
  const cx = x + w / 2;
  ctx.save();
  ctx.lineWidth = Math.max(1, w * 0.03);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  const label = () => {
    ctx.fillStyle = css(c2);
    ctx.fillRect(x + w * 0.2, y + h * 0.42, w * 0.6, h * 0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `800 ${Math.round(h * 0.13)}px Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.brand.slice(0, 1).toUpperCase(), cx, y + h * 0.52);
  };
  switch (p.shape) {
    case 'can':
      ctx.fillStyle = css(c1);
      rrect(ctx, x + w * 0.25, y + h * 0.2, w * 0.5, h * 0.75, w * 0.08);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dfe6e9';
      ctx.fillRect(x + w * 0.27, y + h * 0.2, w * 0.46, h * 0.06);
      label();
      break;
    case 'bottle':
      ctx.fillStyle = css(c1);
      rrect(ctx, x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.66, w * 0.12);
      ctx.fill();
      ctx.stroke();
      rrect(ctx, x + w * 0.42, y + h * 0.1, w * 0.16, h * 0.22, w * 0.04);
      ctx.fill();
      ctx.fillStyle = css(c2);
      ctx.fillRect(x + w * 0.42, y + h * 0.06, w * 0.16, h * 0.06);
      label();
      break;
    case 'carton':
      ctx.fillStyle = css(c1);
      ctx.fillRect(x + w * 0.27, y + h * 0.25, w * 0.46, h * 0.7);
      ctx.strokeRect(x + w * 0.27, y + h * 0.25, w * 0.46, h * 0.7);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.27, y + h * 0.25);
      ctx.lineTo(cx, y + h * 0.1);
      ctx.lineTo(x + w * 0.73, y + h * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      label();
      break;
    case 'jar':
      ctx.fillStyle = css(c1);
      rrect(ctx, x + w * 0.24, y + h * 0.3, w * 0.52, h * 0.65, w * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = css(c2);
      rrect(ctx, x + w * 0.27, y + h * 0.2, w * 0.46, h * 0.12, w * 0.04);
      ctx.fill();
      label();
      break;
    case 'bag':
      ctx.fillStyle = css(c1);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.22, y + h * 0.18);
      ctx.lineTo(x + w * 0.78, y + h * 0.18);
      ctx.quadraticCurveTo(x + w * 0.9, y + h * 0.6, x + w * 0.76, y + h * 0.95);
      ctx.lineTo(x + w * 0.24, y + h * 0.95);
      ctx.quadraticCurveTo(x + w * 0.1, y + h * 0.6, x + w * 0.22, y + h * 0.18);
      ctx.fill();
      ctx.stroke();
      label();
      break;
    case 'fruit':
      ctx.fillStyle = css(c1);
      for (const [dx, dy] of [[-0.14, 0.12], [0.14, 0.12], [0, -0.06]]) {
        ctx.beginPath();
        ctx.arc(cx + dx * w, y + h * (0.62 + dy), w * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = css(c2);
      ctx.beginPath();
      ctx.ellipse(cx + w * 0.05, y + h * 0.33, w * 0.07, w * 0.03, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bread':
      ctx.fillStyle = css(c1);
      ctx.beginPath();
      ctx.ellipse(cx, y + h * 0.6, w * 0.44, h * 0.16, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = css(c2);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * w * 0.14 - w * 0.05, y + h * 0.62 + i * h * 0.06);
        ctx.lineTo(cx + i * w * 0.14 + w * 0.05, y + h * 0.54 + i * h * 0.06);
        ctx.stroke();
      }
      break;
    case 'egg':
      ctx.fillStyle = css(c1);
      ctx.fillRect(x + w * 0.12, y + h * 0.5, w * 0.76, h * 0.38);
      ctx.strokeRect(x + w * 0.12, y + h * 0.5, w * 0.76, h * 0.38);
      ctx.fillStyle = '#f5e6c8';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(x + w * (0.27 + i * 0.23), y + h * 0.48, w * 0.09, h * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'tube':
      ctx.fillStyle = css(c1);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + h * 0.15);
      ctx.lineTo(x + w * 0.7, y + h * 0.15);
      ctx.lineTo(x + w * 0.62, y + h * 0.82);
      ctx.lineTo(x + w * 0.38, y + h * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = css(c2);
      ctx.fillRect(x + w * 0.42, y + h * 0.82, w * 0.16, h * 0.12);
      break;
    case 'tray':
    case 'pack':
      ctx.fillStyle = css(c1);
      rrect(ctx, x + w * 0.1, y + h * 0.42, w * 0.8, h * 0.5, w * 0.06);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = css(c2);
      ctx.fillRect(x + w * 0.18, y + h * 0.5, w * 0.64, h * 0.16);
      break;
    default:
      ctx.fillStyle = css(c1);
      ctx.fillRect(x + w * 0.2, y + h * 0.12, w * 0.6, h * 0.83);
      ctx.strokeRect(x + w * 0.2, y + h * 0.12, w * 0.6, h * 0.83);
      label();
  }
  ctx.restore();
}

/** Icône d'un produit en data URL (mise en cache) pour l'interface HTML. */
export function productIcon(pid: string, size = 96): string {
  const key = `${pid}:${size}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const p = PRODUCT_BY_ID[pid];
  const c = document.createElement('canvas');
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  c.width = c.height = size * dpr;
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  drawProduct(x, p, size * 0.08, size * 0.06, size * 0.84, size * 0.88);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

/** Variation de teinte stable (pour éviter l'uniformité des rangées de produits). */
export const tint = (c: number, f: number) => rgbCss(shadeRgb(hexRgb(c), f));
