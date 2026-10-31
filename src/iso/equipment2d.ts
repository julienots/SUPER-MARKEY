/**
 * Dessin 2.5D des équipements : rayons avec leur stock réel (les produits disparaissent quand ils sont vendus),
 * frigos, congélateurs, étals, caisses, réserve, petits équipements.
 */
import { CELL, EQUIPMENT_BY_ID } from '../data/equipment';
import { PRODUCT_BY_ID } from '../data/products';
import { localDir, localToWorld, slotCapacity, slotLocal } from '../sim/layout';
import { slotQty } from '../sim/inventory';
import type { PlacedEquip } from '../sim/state';
import { box as _box, css, flat, prism, type P2, type PrismStyle } from './paint';
import type { IsoView } from './view';

void _box;

/** Couleurs du mobilier selon le style du magasin. */
export interface EquipStyle {
  shelf: number;
  wood: number;
}

type Part = () => void;

/** Polygone local (x0..x1 en largeur, z0..z1 en profondeur) → monde. */
function lpoly(e: PlacedEquip, lx0: number, lz0: number, lx1: number, lz1: number): P2[] {
  return [
    localToWorld(e, lx0, 0, lz0),
    localToWorld(e, lx1, 0, lz0),
    localToWorld(e, lx1, 0, lz1),
    localToWorld(e, lx0, 0, lz1),
  ].map((p) => ({ x: p.x, z: p.z }));
}

/** La face locale de normale (0, dir) est-elle tournée vers le spectateur ? */
function facesViewer(e: PlacedEquip, dir: number) {
  const n = localDir(e.rot, 0, dir);
  return n.x - n.z > 0.01;
}

/** Produits d'un facing : rangée(s) de petits articles, proportionnelles au stock. */
function slotProducts(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, idx: number, opts: { lying?: boolean; round?: boolean } = {}) {
  const def = EQUIPMENT_BY_ID[e.def];
  const s = e.slots?.[idx];
  if (!s || !s.pid) return;
  const p = PRODUCT_BY_ID[s.pid];
  const q = slotQty(s);
  const l = slotLocal(def, idx);
  // étiquette de prix au bord de la tablette (même vide : le planogramme reste lisible)
  const tagZ = l.frontZ + l.dir * 0.005;
  prism(ctx, v, lpoly(e, l.lx - l.fw * 0.2, tagZ - 0.012, l.lx + l.fw * 0.2, tagZ + 0.012), l.y - 0.06, l.y, { color: q > 0 ? 0xffffff : 0xffeaa7, top: p.color2 });
  if (q <= 0) return;
  const cap = Math.max(1, slotCapacity(e, idx, s.pid));
  const pw = Math.max(0.05, Math.min(0.24, p.size[0]));
  const across = Math.max(1, Math.min(6, Math.floor(l.fw / (pw + 0.012))));
  const ph = Math.max(0.05, Math.min(l.clearance - 0.03, opts.lying ? Math.min(p.size[1], 0.09) : p.size[1]));
  const pd = Math.max(0.05, Math.min(0.16, p.size[2]));
  const rows = Math.max(1, Math.min(3, Math.floor(l.depth / (pd + 0.02))));
  const total = across * rows;
  const shown = Math.max(1, Math.min(total, Math.ceil((q / cap) * total)));
  const step = l.fw / across;
  // rangées du fond vers l'avant (la rangée avant est dessinée en dernier)
  const back = facesViewer(e, l.dir);
  for (let r = rows - 1; r >= 0; r--) {
    const rr = back ? r : rows - 1 - r;
    for (let i = 0; i < across; i++) {
      const n = rr * across + i;
      if (n >= shown) continue;
      const cx = l.lx - l.fw / 2 + (i + 0.5) * step;
      const cz = l.frontZ - l.dir * (0.02 + pd / 2 + rr * (pd + 0.02));
      const hw = Math.min(pw, step - 0.012) / 2;
      const poly = lpoly(e, cx - hw, cz - pd / 2, cx + hw, cz + pd / 2);
      if (opts.round) {
        const c = localToWorld(e, cx, 0, cz);
        const [sx, sy] = v.px(c.x, l.y + ph / 2, c.z);
        ctx.fillStyle = css(p.color);
        ctx.beginPath();
        ctx.ellipse(sx, sy, hw * v.k * 1.1, hw * v.k * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(sx - hw * v.k * 0.35, sy - hw * v.k * 0.3, hw * v.k * 0.3, hw * v.k * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      prism(ctx, v, poly, l.y, l.y + ph, { color: p.color, top: p.shape === 'can' || p.shape === 'jar' ? p.color2 : p.color });
      // bande d'étiquette (couleur secondaire) sur la face visible
      if (ph > 0.07) prism(ctx, v, poly.map((pt) => ({ x: pt.x, z: pt.z })), l.y + ph * 0.35, l.y + ph * 0.62, { color: p.color2, noTop: true });
    }
  }
}

function shelfUnit(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, st: EquipStyle) {
  const def = EQUIPMENT_BY_ID[e.def];
  const s = def.shelf!;
  const W = def.w * CELL;
  const D = def.d * CELL;
  const L = s.levels.length;
  const F = s.facings;
  const metal: PrismStyle = { color: st.shelf };
  const parts: Part[] = [];
  const side = (sd: number) => {
    const dir = sd === 0 ? 1 : -1;
    const z0 = s.sides === 2 ? 0 : -D / 2 + 0.06;
    const zf = s.sides === 2 ? dir * (D / 2 - 0.02) : Math.min(D / 2 - 0.01, -D / 2 + 0.04 + s.depth);
    const za = Math.min(z0, zf);
    const zb = Math.max(z0, zf);
    for (let lv = 0; lv < L; lv++) {
      const y = s.levels[lv];
      parts.push(() => {
        prism(ctx, v, lpoly(e, -W / 2 + 0.03, za, W / 2 - 0.03, zb), y - 0.035, y, { color: st.shelf, top: 0xf5f6fa });
        for (let f = 0; f < F; f++) slotProducts(ctx, v, e, (sd * L + lv) * F + f);
      });
    }
  };
  const plinth = () => prism(ctx, v, lpoly(e, -W / 2, -D / 2 + 0.02, W / 2, D / 2 - 0.02), 0, 0.1, { color: st.shelf, top: st.shelf });
  const panel = (zc: number) => () => prism(ctx, v, lpoly(e, -W / 2, zc - 0.03, W / 2, zc + 0.03), 0.1, def.h, metal);
  const caps = () => {
    // montants latéraux + bandeau haut
    for (const sx of [-1, 1]) prism(ctx, v, lpoly(e, sx * W / 2 - (sx > 0 ? 0.04 : 0), -D / 2 + 0.03, sx * W / 2 + (sx < 0 ? 0.04 : 0), D / 2 - 0.03), 0.1, def.h, { color: st.shelf });
  };
  if (s.sides === 2) {
    const nearSide = facesViewer(e, 1) ? 0 : 1;
    const farSide = 1 - nearSide;
    plinth();
    side(farSide);
    parts.push(panel(0));
    side(nearSide);
  } else {
    plinth();
    if (facesViewer(e, 1)) {
      parts.unshift(panel(-D / 2 + 0.04));
      side(0);
    } else {
      side(0);
      parts.push(panel(-D / 2 + 0.04));
    }
  }
  // montant visible : celui le plus proche du spectateur en dernier
  const capsNear = () => caps();
  for (const p of parts) p();
  capsNear();
  // fronton coloré au sommet
  prism(ctx, v, lpoly(e, -W / 2, -0.06, W / 2, 0.06), def.h, def.h + 0.12, { color: 0xe84118 });
}

function fridge(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, st: EquipStyle) {
  const def = EQUIPMENT_BY_ID[e.def];
  const s = def.shelf!;
  const W = def.w * CELL;
  const D = def.d * CELL;
  const body = e.broken ? 0xb2bec3 : 0xf5f6fa;
  const facing = facesViewer(e, 1);
  const shell = () => {
    prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, -D / 2 + 0.08), 0, def.h, { color: body });
    for (const sx of [-1, 1]) prism(ctx, v, lpoly(e, sx < 0 ? -W / 2 : W / 2 - 0.06, -D / 2, sx < 0 ? -W / 2 + 0.06 : W / 2, D / 2), 0, def.h, { color: body });
  };
  const inside = () => {
    prism(ctx, v, lpoly(e, -W / 2 + 0.06, -D / 2 + 0.08, W / 2 - 0.06, D / 2 - 0.02), 0, s.levels[0] - 0.04, { color: 0xdfe6e9 });
    for (let lv = 0; lv < s.levels.length; lv++) {
      const y = s.levels[lv];
      prism(ctx, v, lpoly(e, -W / 2 + 0.06, -D / 2 + 0.08, W / 2 - 0.06, D / 2 - 0.04), y - 0.025, y, { color: 0xc8d6e5, top: 0xeef5ff });
      for (let f = 0; f < s.facings; f++) slotProducts(ctx, v, e, lv * s.facings + f);
    }
  };
  if (facing) {
    shell();
    inside();
  } else {
    inside();
    shell();
  }
  // toit lumineux + vitre
  prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), def.h - 0.12, def.h, { color: body, top: 0xffffff });
  prism(ctx, v, lpoly(e, -W / 2 + 0.05, -0.02, W / 2 - 0.05, 0.02).map((p) => ({ x: p.x, z: p.z })), def.h - 0.2, def.h - 0.12, { color: e.broken ? 0xd63031 : 0x0984e3 });
  if (e.def === 'frigo_vitre') {
    prism(ctx, v, lpoly(e, -W / 2 + 0.05, D / 2 - 0.03, W / 2 - 0.05, D / 2), 0.08, def.h - 0.12, { color: 0xbfe3ff, alpha: 0.18, top: 0xbfe3ff });
  }
}

function freezer(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip) {
  const def = EQUIPMENT_BY_ID[e.def];
  const s = def.shelf!;
  const W = def.w * CELL;
  const D = def.d * CELL;
  const h = def.h;
  prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), 0, h - 0.12, { color: e.broken ? 0xb2bec3 : 0xf5f6fa, top: 0x74b9ff });
  // produits vus à travers le couvercle
  for (let lv = 0; lv < s.levels.length; lv++)
    for (let f = 0; f < s.facings; f++) {
      const idx = lv * s.facings + f;
      const sl = e.slots?.[idx];
      if (!sl?.pid) continue;
      const q = slotQty(sl);
      const cap = Math.max(1, slotCapacity(e, idx, sl.pid));
      const p = PRODUCT_BY_ID[sl.pid];
      const l = slotLocal(def, idx);
      const n = Math.ceil((q / cap) * 6);
      for (let i = 0; i < n; i++) {
        const cx = l.lx - l.fw / 2 + 0.08 + (i % 3) * ((l.fw - 0.16) / 2);
        const cz = (lv === 0 ? 0.18 : -0.18) + (Math.floor(i / 3) - 0.5) * 0.14;
        prism(ctx, v, lpoly(e, cx - 0.07, cz - 0.05, cx + 0.07, cz + 0.05), h - 0.12, h - 0.06, { color: p.color, top: p.color2 });
      }
    }
  prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), h - 0.04, h, { color: 0xdff9fb, alpha: 0.35, top: 0xdff9fb, noSides: true });
  prism(ctx, v, lpoly(e, -W / 2, -0.02, W / 2, 0.02), h - 0.04, h + 0.01, { color: 0x95a5a6 });
}

function produceStand(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, st: EquipStyle) {
  const def = EQUIPMENT_BY_ID[e.def];
  const s = def.shelf!;
  const W = def.w * CELL;
  const D = def.d * CELL;
  const bread = e.def === 'bac_pain';
  prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), 0, s.levels[0] - 0.1, { color: st.wood });
  const nearSide = s.sides === 2 ? (facesViewer(e, 1) ? 0 : 1) : 0;
  const order = s.sides === 2 ? [1 - nearSide, nearSide] : [0];
  for (const sd of order)
    for (let lv = 0; lv < s.levels.length; lv++)
      for (let f = 0; f < s.facings; f++) {
        const idx = (sd * s.levels.length + lv) * s.facings + f;
        const l = slotLocal(def, idx);
        const z0 = Math.min(l.frontZ, l.frontZ - l.dir * l.depth);
        const z1 = Math.max(l.frontZ, l.frontZ - l.dir * l.depth);
        prism(ctx, v, lpoly(e, l.lx - l.fw / 2 + 0.03, z0, l.lx + l.fw / 2 - 0.03, z1), l.y - 0.1, l.y, { color: bread ? 0xc8a165 : 0x8e6e53, top: bread ? 0xe0c290 : 0xa0805f });
        slotProducts(ctx, v, e, idx, { round: !bread && e.slots?.[idx]?.pid ? PRODUCT_BY_ID[e.slots[idx].pid!].shape === 'fruit' || PRODUCT_BY_ID[e.slots[idx].pid!].shape === 'bag' : false, lying: bread });
      }
  // petite enseigne
  prism(ctx, v, lpoly(e, -0.04, -0.04, 0.04, 0.04), s.levels[s.levels.length - 1], def.h + 0.25, { color: 0x6d4c41 });
}

function pyramid(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip) {
  const def = EQUIPMENT_BY_ID[e.def];
  const W = def.w * CELL;
  const D = def.d * CELL;
  prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), 0, 0.35, { color: 0xe84118, top: 0xffc72c });
  const sl = e.slots?.[0];
  if (!sl?.pid) return;
  const q = slotQty(sl);
  const cap = Math.max(1, slotCapacity(e, 0, sl.pid));
  const p = PRODUCT_BY_ID[sl.pid];
  let n = Math.ceil((q / cap) * 14);
  const sz = 0.16;
  for (let layer = 0; layer < 4 && n > 0; layer++) {
    const per = 4 - layer;
    for (let i = 0; i < per && n > 0; i++)
      for (let j = 0; j < per && n > 0; j++, n--) {
        const cx = (i - (per - 1) / 2) * sz * 1.05;
        const cz = (j - (per - 1) / 2) * sz * 1.05;
        prism(ctx, v, lpoly(e, cx - sz / 2, cz - sz / 2, cx + sz / 2, cz + sz / 2), 0.35 + layer * sz, 0.35 + (layer + 1) * sz, { color: p.color, top: p.color2 });
      }
  }
}

function checkout(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, beltItems: number, operated: boolean) {
  const def = EQUIPMENT_BY_ID[e.def];
  const W = def.w * CELL;
  const D = def.d * CELL;
  if (e.def === 'caisse_auto') {
    prism(ctx, v, lpoly(e, -0.45, -0.3, 0.45, 0.3), 0, 0.9, { color: 0x2d3436, top: 0x636e72 });
    prism(ctx, v, lpoly(e, -0.3, -0.25, 0.3, -0.15), 0.9, 1.45, { color: 0x0984e3, top: 0x74b9ff });
    prism(ctx, v, lpoly(e, 0.15, 0, 0.45, 0.3), 0.9, 0.95, { color: 0xdfe6e9 });
    return;
  }
  // comptoir + tapis
  prism(ctx, v, lpoly(e, -W / 2 + 0.2, -0.25, W / 2 - 0.1, 0.45), 0, 0.85, { color: 0xf5f6fa, top: 0xdfe6e9 });
  prism(ctx, v, lpoly(e, -W / 2 + 0.9, -0.05, W / 2 - 0.2, 0.35), 0.85, 0.88, { color: 0x2d3436, top: 0x2d3436 });
  // articles sur le tapis
  for (let i = 0; i < Math.min(8, beltItems); i++) {
    const cx = W / 2 - 0.4 - i * 0.22;
    prism(ctx, v, lpoly(e, cx - 0.07, 0.05, cx + 0.07, 0.25), 0.88, 1.0, { color: [0xe17055, 0x0984e3, 0xfdcb6e, 0x00b894, 0x6c5ce7][i % 5] });
  }
  // caisse enregistreuse + écran
  prism(ctx, v, lpoly(e, -W / 2 + 0.25, -0.2, -W / 2 + 0.75, 0.25), 0.85, 1.05, { color: 0x2d3436, top: 0x636e72 });
  prism(ctx, v, lpoly(e, -W / 2 + 0.35, -0.05, -W / 2 + 0.65, 0.05), 1.05, 1.3, { color: 0x1e272e, top: 0x00cec9 });
  // poteau de caisse : vert si ouverte / tenue
  const on = (e.open ?? true) && !e.broken;
  prism(ctx, v, lpoly(e, -W / 2 + 0.25, 0.35, -W / 2 + 0.33, 0.43), 0.85, 2.1, { color: 0x95a5a6 });
  prism(ctx, v, lpoly(e, -W / 2 + 0.16, 0.3, -W / 2 + 0.42, 0.48), 2.1, 2.3, { color: on ? (operated ? 0x2ecc71 : 0xfdcb6e) : 0xd63031 });
  void D;
}

function rack(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, cold: boolean) {
  const def = EQUIPMENT_BY_ID[e.def];
  const W = def.w * CELL;
  const D = def.d * CELL;
  const n = e.cartons?.length ?? 0;
  if (cold) {
    prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), 0, def.h, { color: 0xecf0f1, top: 0xffffff });
    prism(ctx, v, lpoly(e, -0.45, D / 2 - 0.02, 0.45, D / 2 + 0.02), 0.05, 1.95, { color: 0xb2bec3 });
    // jauge de remplissage sur la porte
    const cap = def.cartons ?? 30;
    prism(ctx, v, lpoly(e, -0.35, D / 2 + 0.02, -0.35 + 0.7 * Math.min(1, n / cap), D / 2 + 0.04), 1.6, 1.7, { color: 0x00b894 });
    return;
  }
  const levels = [0.15, 0.85, 1.55];
  const cap = def.cartons ?? 24;
  const per = Math.ceil(cap / levels.length);
  const cols = Math.ceil(per / 2);
  const facing = facesViewer(e, 1);
  const frame = () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) prism(ctx, v, lpoly(e, sx * W / 2 - 0.04, sz * D / 2 - 0.04, sx * W / 2 + 0.04, sz * D / 2 + 0.04).map((p) => p), 0, def.h, { color: 0x2d6cdf });
  };
  if (!facing) frame();
  let k = 0;
  levels.forEach((y) => {
    prism(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), y - 0.05, y, { color: 0xe67e22, top: 0x95a5a6 });
    for (let row = 1; row >= 0; row--)
      for (let c = 0; c < cols; c++) {
        const i = k + row * cols + c;
        if (i >= n || i >= cap) continue;
        const cart = e.cartons![i];
        const p = PRODUCT_BY_ID[cart.pid];
        const cx = -W / 2 + (c + 0.5) * (W / cols);
        const cz = (row === 0 ? 1 : -1) * D * 0.22 * (facing ? 1 : -1);
        prism(ctx, v, lpoly(e, cx - W / cols / 2 + 0.03, cz - 0.2, cx + W / cols / 2 - 0.03, cz + 0.2), y, y + 0.34, { color: 0xc49a6c, top: 0xd8b48a });
        if (p) prism(ctx, v, lpoly(e, cx - 0.06, cz - 0.21, cx + 0.06, cz + 0.21), y + 0.14, y + 0.24, { color: p.color, noTop: true });
      }
    k += per;
  });
  if (facing) frame();
}

/** Petits équipements : formes simples reconnaissables. */
function prop(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, st: EquipStyle) {
  const def = EQUIPMENT_BY_ID[e.def];
  const W = def.w * CELL;
  const D = def.d * CELL;
  const full = (y0: number, y1: number, s: PrismStyle, inset = 0) => prism(ctx, v, lpoly(e, -W / 2 + inset, -D / 2 + inset, W / 2 - inset, D / 2 - inset), y0, y1, s);
  const c = localToWorld(e, 0, 0, 0);
  const emoji = (txt: string, y: number, size = 0.5) => {
    const [sx, sy] = v.px(c.x, y, c.z);
    ctx.font = `${Math.max(8, size * v.k)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, sx, sy);
  };
  switch (e.def) {
    case 'plante':
      full(0, 0.4, { color: 0x8d6e63 }, 0.08);
      for (const [dx, dy, r] of [[0, 1.0, 0.32], [-0.12, 0.8, 0.26], [0.14, 0.75, 0.24], [0, 1.3, 0.22]]) {
        const [sx, sy] = v.px(c.x + dx, dy, c.z);
        ctx.fillStyle = css(0x2e8b57, 0.9 + dx);
        ctx.beginPath();
        ctx.arc(sx, sy, r * v.k, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'poubelle':
      full(0, 0.8, { color: 0x636e72, top: 0x2d3436 }, 0.06);
      break;
    case 'extincteur':
      full(0, 0.55, { color: 0xd63031, top: 0xff7675 }, 0.12);
      break;
    case 'paniers':
      for (let i = 0; i < 6; i++) full(i * 0.09, i * 0.09 + 0.08, { color: 0xd63031, top: 0xe17055 }, 0.05);
      break;
    case 'caddies':
      full(0, 0.9, { color: 0xb2bec3, top: 0xdfe6e9, alpha: 0.85 }, 0.05);
      emoji('🛒', 1.2, 0.5);
      break;
    case 'tapis':
      flat(ctx, v, lpoly(e, -W / 2, -D / 2, W / 2, D / 2), 0.01, css(0x2d3436), 'rgba(0,0,0,0.2)');
      break;
    case 'camera':
      prism(ctx, v, lpoly(e, -0.1, -0.1, 0.1, 0.1), 2.7, 2.9, { color: 0x2d3436, top: 0x636e72 });
      emoji('📹', 3.1, 0.35);
      break;
    case 'panneau_rayon':
      prism(ctx, v, lpoly(e, -W / 2, -0.03, W / 2, 0.03), 2.4, 2.75, { color: 0x0984e3, top: 0x74b9ff });
      emoji('🪧', 2.95, 0.3);
      break;
    case 'spot':
      emoji('💡', 2.8, 0.35);
      break;
    case 'neon':
      prism(ctx, v, lpoly(e, -W / 2, -0.03, W / 2, 0.03), 2.2, 2.6, { color: 0xe84393, top: 0xfd79a8 });
      break;
    case 'ballons':
      for (const [dx, dz, col] of [[-0.15, 0, 0xe84118], [0.15, 0.05, 0xfdcb6e], [0, -0.1, 0x0984e3]] as const) {
        const [sx, sy] = v.px(c.x + dx, 2.0, c.z + dz);
        const [bx, by] = v.px(c.x, 0.2, c.z);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.fillStyle = css(col);
        ctx.beginPath();
        ctx.ellipse(sx, sy, 0.17 * v.k, 0.21 * v.k, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'portique':
      for (const sx of [-1, 1]) prism(ctx, v, lpoly(e, sx * W / 2 - 0.06, -0.08, sx * W / 2 + 0.06, 0.08), 0, 1.5, { color: 0xdfe6e9, top: 0xb2bec3 });
      break;
    case 'coffre':
      full(0, 0.9, { color: 0x2d3436, top: 0x636e72 }, 0.05);
      emoji('🔒', 1.15, 0.35);
      break;
    case 'vitrine_secu':
      full(0, 0.8, { color: st.wood }, 0);
      full(0.8, 1.5, { color: 0xbfe3ff, alpha: 0.25, top: 0xbfe3ff }, 0.02);
      break;
    default: {
      const colors: Record<string, number> = { bureau: 0x8d6e63, casiers: 0x74b9ff, salle_pause: 0xfab1a0, toilettes: 0xdfe6e9, ecran_secu: 0x2d3436, cafe_client: 0x6d4c41, detecteur: 0xdfe6e9, affiche: 0xfdcb6e };
      const icons: Record<string, string> = { bureau: '🗂️', casiers: '🧥', salle_pause: '☕', toilettes: '🚻', ecran_secu: '🖥️', cafe_client: '☕', detecteur: '📡', affiche: '📣' };
      full(0, Math.min(def.h, 1.6), { color: colors[e.def] ?? 0xb2bec3 }, 0.04);
      if (icons[e.def]) emoji(icons[e.def], Math.min(def.h, 1.6) + 0.35, 0.45);
    }
  }
}

/** Dessine un équipement complet. */
export function drawEquipment(ctx: CanvasRenderingContext2D, v: IsoView, e: PlacedEquip, st: EquipStyle, extra: { beltItems: number; operated: boolean }) {
  const def = EQUIPMENT_BY_ID[e.def];
  if (def.shelf) {
    if (e.def === 'frigo_vitre' || e.def === 'frigo_mural') fridge(ctx, v, e, st);
    else if (e.def === 'congelateur') freezer(ctx, v, e);
    else if (e.def === 'etal_fruits' || e.def === 'bac_pain') produceStand(ctx, v, e, st);
    else if (e.def === 'tete_gondole') pyramid(ctx, v, e);
    else shelfUnit(ctx, v, e, st);
  } else if (e.def === 'caisse' || e.def === 'caisse_auto') checkout(ctx, v, e, extra.beltItems, extra.operated);
  else if (e.def === 'rack_reserve') rack(ctx, v, e, false);
  else if (e.def === 'chambre_froide') rack(ctx, v, e, true);
  else prop(ctx, v, e, st);
  if (e.broken) {
    const c = localToWorld(e, 0, 0, 0);
    const [sx, sy] = v.px(c.x, def.h + 0.5, c.z);
    ctx.font = `${Math.max(10, 0.45 * v.k)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('⚠️', sx, sy);
  }
}

/** Signature d'état d'un équipement (le sprite en cache est redessiné quand elle change). */
export function equipSignature(e: PlacedEquip, beltItems: number, operated: boolean): string {
  let s = `${e.def}|${e.gx},${e.gz},${e.rot}|${e.broken ? 1 : 0}|${e.open === false ? 0 : 1}|${beltItems}|${operated ? 1 : 0}`;
  if (e.slots) for (const sl of e.slots) s += `|${sl.pid ?? ''}:${slotQty(sl)}`;
  if (e.cartons) s += `|c${e.cartons.length}:${e.cartons.map((c) => c.pid[0]).join('')}`;
  return s;
}
