/**
 * Rendu 2.5D de la partie : sol, magasin coupé (murs du fond hauts, façade basse et vitrée), extérieur, meubles
 * (sprites mis en cache tant que leur stock ne change pas), personnages, objets, véhicules, bulles, nuit, sélection.
 */
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { FLOORS, WALLS } from '../data/styles';
import { PRODUCT_BY_ID } from '../data/products';
import { CROSSWALKS, PLAYER_LOT, PLAYER_PARKING, ROADS, SIDEWALKS, DOCK_YARD } from '../data/world';
import { cellsOf, doorCenters, equipCenter, FACADE_SEG, footprint, GRID_X0, GRID_Z0, storeRect } from '../sim/layout';
import { CELL } from '../data/equipment';
import { hourOf } from '../sim/state';
import { Rng } from '../core/rng';
import { randomAppearance, type Appearance } from '../entities/character';
import type { Agent } from '../entities/agent';
import type { Customer } from '../entities/customer';
import type { EmployeeAgent } from '../entities/employee';
import type { Game } from '../game/game';
import type { PlacedEquip } from '../sim/state';
import { drawEquipment, equipSignature, type EquipStyle } from './equipment2d';
import { box, bubble, css, flat, orect, path, prism, rect, shadow, type P2, type PrismStyle } from './paint';
import { drawPerson, type Carry, type Mood, type Pose } from './sprites';
import { IsoView } from './view';

export type Selection = { kind: 'equip'; uid: number } | { kind: 'agent'; id: number } | { kind: 'player' } | { kind: 'pallet'; uid: number } | null;

export interface Ghost {
  def: string;
  gx: number;
  gz: number;
  rot: 0 | 1 | 2 | 3;
  ok: boolean;
}

interface Drawable {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  d: number;
  y: number;
  draw: () => void;
  hit?: { kind: 'equip'; uid: number; hull: [number, number][] } | { kind: 'agent' | 'player'; id: number; box: [number, number, number, number] } | { kind: 'pallet'; uid: number; hull: [number, number][] };
}

interface Sprite {
  key: string;
  canvas: HTMLCanvasElement;
  /** Position de l'ancre (centre au sol) dans le canvas, en pixels CSS. */
  ax: number;
  ay: number;
  w: number;
  h: number;
  kq: number;
}

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

export class IsoRenderer {
  readonly ctx: CanvasRenderingContext2D;
  view = new IsoView();
  dpr = 1;
  selection: Selection = null;
  ghost: Ghost | null = null;
  /** Cases interdites/couvertes à surligner (mode construction). */
  showGrid = false;
  private sprites = new Map<number, Sprite>();
  private phases = new Map<number, number>();
  private barks = new Map<number, { text: string; until: number }>();
  private floats: { x: number; z: number; y: number; text: string; color: string; t: number }[] = [];
  private hits: NonNullable<Drawable['hit']>[] = [];
  private t = 0;
  private playerLook: Appearance;
  /** Agent suivi par la caméra (facultatif). */
  follow: { x: number; z: number } | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly game: Game,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.playerLook = randomAppearance(new Rng(4242), { female: false, age: 38, role: 'manager' });
    this.playerLook.hairStyle = 'court';
    this.playerLook.hat = null;
    this.playerLook.glasses = false;
    this.playerLook.top = 0x2d3436;
    this.playerLook.topStyle = 'veste';
    game.bus.on('bark', (b) => this.barks.set(b.id, { text: b.text, until: this.t + 3.6 }));
    game.bus.on('sale', (s) => this.floats.push({ x: s.x, z: s.z, y: 1.6, text: `+${s.amount.toFixed(2).replace('.', ',')} €`, color: '#00b894', t: 0 }));
    game.bus.on('layout', () => this.sprites.clear());
  }

  /** Message flottant (ex. « −12 € ») au-dessus d'un point du monde. */
  floatText(x: number, z: number, text: string, color = '#ffd32a') {
    this.floats.push({ x, z, y: 1.8, text, color, t: 0 });
  }

  resize(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.view.w = w;
    this.view.h = h;
  }

  /** Taille du magasin : utile pour cadrer la vue. */
  frameStore() {
    const r = storeRect(this.game.st.store.stage);
    this.view.fit(r.x0 - 1, r.z0 - 3, r.x1 + 1, r.z1);
  }

  // ---------------------------------------------------------------- sélection
  pick(sx: number, sy: number): Selection {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if ('box' in h) {
        const [x0, y0, x1, y1] = h.box;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return h.kind === 'player' ? { kind: 'player' } : { kind: 'agent', id: h.id };
      } else if (inPoly(sx, sy, h.hull)) return h.kind === 'equip' ? { kind: 'equip', uid: h.uid } : { kind: 'pallet', uid: h.uid };
    }
    return null;
  }

  // ---------------------------------------------------------------- rendu
  draw(dt: number) {
    this.t += dt;
    const g = this.game;
    const st = g.st;
    const ctx = this.ctx;
    const v = this.view;
    if (this.follow) {
      v.cx += (this.follow.x - v.cx) * Math.min(1, dt * 3);
      v.cz += (this.follow.z - v.cz) * Math.min(1, dt * 3);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#7fa66b';
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    const r = storeRect(st.store.stage);
    const floorStyle = FLOORS.find((f) => f.id === st.store.floor) ?? FLOORS[0];
    const wallStyle = WALLS.find((w) => w.id === st.store.wall) ?? WALLS[0];

    // --- extérieur (plat)
    const view = this.visibleBounds();
    flat(ctx, v, rect(PLAYER_LOT[0], PLAYER_LOT[1], PLAYER_LOT[2], PLAYER_LOT[3]), 0, css(0x8a8d91));
    for (const s of SIDEWALKS) if (overlaps(s, view)) flat(ctx, v, rect(s[0], s[1], s[2], s[3]), 0, css(0xc9c3b8));
    for (const rd of ROADS) if (overlaps(rd.rect, view)) {
      flat(ctx, v, rect(rd.rect[0], rd.rect[1], rd.rect[2], rd.rect[3]), 0, css(0x3d4045));
      const [x0, z0, x1, z1] = rd.rect;
      if (rd.axis === 'x') for (let x = Math.max(x0, view[0]) + 1; x < Math.min(x1, view[2]); x += 5) flat(ctx, v, rect(x, (z0 + z1) / 2 - 0.08, x + 2.5, (z0 + z1) / 2 + 0.08), 0, '#f5f6fa');
      else for (let z = Math.max(z0, view[1]) + 1; z < Math.min(z1, view[3]); z += 5) flat(ctx, v, rect((x0 + x1) / 2 - 0.08, z, (x0 + x1) / 2 + 0.08, z + 2.5), 0, '#f5f6fa');
    }
    for (const c of CROSSWALKS) if (overlaps(c, view)) {
      const [x0, z0, x1, z1] = c;
      const alongX = x1 - x0 < z1 - z0;
      const len = alongX ? z1 - z0 : x1 - x0;
      for (let k = 0.3; k < len; k += 0.9) flat(ctx, v, alongX ? rect(x0, z0 + k, x1, z0 + k + 0.5) : rect(x0 + k, z0, x0 + k + 0.5, z1), 0, '#f5f6fa');
    }
    // parking : places tracées
    flat(ctx, v, rect(PLAYER_PARKING[0], PLAYER_PARKING[1], PLAYER_PARKING[2], PLAYER_PARKING[3]), 0, css(0x6b6e72));
    for (let x = PLAYER_PARKING[0] + 2.5; x < PLAYER_PARKING[2]; x += 2.5) flat(ctx, v, rect(x - 0.05, -12.9, x + 0.05, -7.9), 0, 'rgba(255,255,255,0.8)');
    flat(ctx, v, rect(DOCK_YARD[0], Math.max(DOCK_YARD[1], r.z1), DOCK_YARD[2], DOCK_YARD[3]), 0, css(0x7a7d81));
    // trottoir devant le magasin
    flat(ctx, v, rect(r.x0 - 1, -2.2, r.x1 + 1, 0), 0, css(0xd8d2c6));

    // --- sol du magasin
    for (let x = r.x0; x < r.x1; x += 1)
      for (let z = r.z0; z < r.backZ; z += 1) {
        const alt = floorStyle.pattern === 'checker' ? (Math.floor(x) + Math.floor(z)) & 1 : floorStyle.pattern === 'tiles' ? ((Math.floor(x) + Math.floor(z)) & 1) * 0.5 : 0;
        const c = alt === 1 ? floorStyle.alt : floorStyle.base;
        flat(ctx, v, rect(x, z, Math.min(r.x1, x + 1), Math.min(r.backZ, z + 1)), 0, css(c, alt === 0.5 ? 0.97 : 1), 'rgba(0,0,0,0.05)');
      }
    flat(ctx, v, rect(r.x0, r.backZ, r.x1, r.z1), 0, css(0x9a9a96));
    if (this.showGrid) this.drawGrid(r);

    // --- objets triés en profondeur
    const items: Drawable[] = [];
    const T = 0.2;
    const wallH = 3.0;
    const wallC = wallStyle.color;
    // murs du fond (hauts) et de gauche
    items.push(this.boxItem(r.x0 - T, r.z0, r.x0, r.z1 + T, 0, wallH, { color: wallC, top: 0x636e72 }));
    items.push(this.boxItem(r.x0 - T, r.z1, r.x1 + T, r.z1 + T, 0, wallH, { color: wallC, top: 0x636e72 }, () => {
      // quai de livraison : rideau métallique
      box(ctx, v, r.dockDoorX - 1.2, r.z1 - 0.02, r.dockDoorX + 1.2, r.z1 + 0.01, 0, 2.6, { color: 0x95a5a6, top: 0x95a5a6 });
    }));
    // cloison de la réserve (mi-hauteur) avec porte du personnel
    items.push(this.boxItem(r.x0, r.backZ - 0.1, r.staffDoorX - 0.6, r.backZ + 0.1, 0, 1.3, { color: wallC, top: 0xb2bec3 }));
    items.push(this.boxItem(r.staffDoorX + 0.6, r.backZ - 0.1, r.x1, r.backZ + 0.1, 0, 1.3, { color: wallC, top: 0xb2bec3 }));
    // mur droit (bas) et façade vitrée
    items.push(this.boxItem(r.x1, r.z0, r.x1 + T, r.z1 + T, 0, 0.6, { color: wallC, top: 0x636e72 }));
    const doors = doorCenters(st.store.facade, st.store.stage);
    for (let x = r.x0; x < r.x1 - 0.01; x += FACADE_SEG) {
      const xc = x + FACADE_SEG / 2;
      const isDoor = doors.some((d) => Math.abs(d - xc) < 0.5);
      if (isDoor) {
        items.push(this.boxItem(x, -T, x + 0.12, 0, 0, 2.6, { color: 0x2d3436 }));
        items.push(this.boxItem(x + FACADE_SEG - 0.12, -T, x + FACADE_SEG, 0, 0, 2.6, { color: 0x2d3436 }));
      } else {
        items.push(this.boxItem(x, -T, x + FACADE_SEG, 0, 0, 0.5, { color: wallC, top: 0x636e72 }));
        items.push(this.boxItem(x + 0.05, -T + 0.06, x + FACADE_SEG - 0.05, -0.06, 0.5, 2.5, { color: 0xbfe3ff, alpha: 0.16, top: 0xbfe3ff }));
      }
    }
    // enseigne au-dessus de la façade
    items.push({
      x0: r.x0, z0: -T, x1: r.x1, z1: 0, d: IsoView.depth((r.x0 + r.x1) / 2, -T) + 0.5, y: 2.6,
      draw: () => this.drawSign(r.x0, r.x1, st.store.name, st.store.signBg, st.store.signFg),
    });

    // équipements
    const extra = new Map<number, { beltItems: number; operated: boolean }>();
    for (const l of g.checkouts.lanes.values()) extra.set(l.e.uid, { beltItems: l.scan ? Math.max(0, l.scan.items.length - l.scan.scanned) : 0, operated: !!l.operator });
    const est: EquipStyle = { shelf: st.store.shelfColor ?? 0xdfe6e9, wood: 0xb08355 };
    for (const e of st.equipment) {
      const def = EQUIPMENT_BY_ID[e.def];
      const f = footprint(def, e.rot);
      const x0 = GRID_X0 + e.gx * CELL;
      const z0 = GRID_Z0 + e.gz * CELL;
      const x1 = x0 + f.w * CELL;
      const z1 = z0 + f.d * CELL;
      if (x1 < view[0] - 2 || x0 > view[2] + 2 || z1 < view[1] - 2 || z0 > view[3] + 2) continue;
      const ex = extra.get(e.uid) ?? { beltItems: 0, operated: false };
      const c = equipCenter(e);
      const hull = hullOf(v, x0, z0, x1, z1, def.h + 0.3);
      items.push({
        x0, z0, x1, z1, d: IsoView.depth(c.x, c.z), y: 0,
        draw: () => {
          this.drawEquipSprite(e, est, ex);
          if (this.selection?.kind === 'equip' && this.selection.uid === e.uid) this.outline(x0, z0, x1, z1, def.h);
        },
        hit: { kind: 'equip', uid: e.uid, hull },
      });
    }

    // objets au sol : cartons, palettes, articles, salissures, chariots libres
    for (const m of st.messes) {
      const [sx, sy] = v.px(m.x, 0.01, m.z);
      const col = m.kind === 'flaque' ? 'rgba(116,185,255,0.55)' : m.kind === 'verre' ? 'rgba(223,230,233,0.8)' : m.kind === 'tag' ? 'rgba(232,65,24,0.6)' : 'rgba(110,80,50,0.5)';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(sx, sy, (0.35 + m.amount * 0.3) * v.k, (0.2 + m.amount * 0.17) * v.k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of g.items.cartons.values()) {
      const t = c.body.translation();
      const p = PRODUCT_BY_ID[c.data.pid];
      items.push({ x0: t.x - 0.25, z0: t.z - 0.2, x1: t.x + 0.25, z1: t.z + 0.2, d: IsoView.depth(t.x, t.z), y: 0, draw: () => this.carton(t.x, t.z, Math.max(0, t.y - 0.17), p?.color) });
    }
    for (const pv of g.items.pallets.values()) {
      const t = pv.body.translation();
      const pl = pv.data;
      const hull = hullOf(v, t.x - 0.6, t.z - 0.5, t.x + 0.6, t.z + 0.5, 0.15 + Math.ceil(pl.cartons.length / 6) * 0.34);
      items.push({
        x0: t.x - 0.6, z0: t.z - 0.5, x1: t.x + 0.6, z1: t.z + 0.5, d: IsoView.depth(t.x, t.z), y: 0,
        draw: () => {
          box(ctx, v, t.x - 0.6, t.z - 0.5, t.x + 0.6, t.z + 0.5, 0, 0.14, { color: 0xc8a165, top: 0xd9b67b });
          pl.cartons.forEach((c, i) => {
            const lay = Math.floor(i / 6);
            const j = i % 6;
            const cx = t.x - 0.4 + (j % 3) * 0.4;
            const cz = t.z - 0.22 + Math.floor(j / 3) * 0.44;
            box(ctx, v, cx - 0.18, cz - 0.2, cx + 0.18, cz + 0.2, 0.14 + lay * 0.34, 0.14 + (lay + 1) * 0.34 - 0.01, { color: 0xc49a6c, top: 0xd8b48a });
            const p = PRODUCT_BY_ID[c.pid];
            if (p) box(ctx, v, cx - 0.06, cz - 0.21, cx + 0.06, cz - 0.2, 0.14 + lay * 0.34 + 0.1, 0.14 + lay * 0.34 + 0.22, { color: p.color, noTop: true });
          });
          if (this.selection?.kind === 'pallet' && this.selection.uid === pl.uid) this.outline(t.x - 0.6, t.z - 0.5, t.x + 0.6, t.z + 0.5, 0.6);
        },
        hit: { kind: 'pallet', uid: pl.uid, hull },
      });
    }
    for (const lv of g.items.loose.values()) {
      const t = lv.body.translation();
      const p = PRODUCT_BY_ID[lv.data.pid];
      items.push({ x0: t.x - 0.08, z0: t.z - 0.08, x1: t.x + 0.08, z1: t.z + 0.08, d: IsoView.depth(t.x, t.z), y: 0, draw: () => box(ctx, v, t.x - 0.07, t.z - 0.05, t.x + 0.07, t.z + 0.05, 0, 0.12, { color: p?.color ?? 0xffffff, top: p?.color2 }) });
    }
    for (const c of g.items.carts) {
      if (c.heldBy !== null) continue;
      const t = c.body.translation();
      const q = c.body.rotation();
      const yaw = 2 * Math.atan2(q.y, q.w);
      items.push({ x0: t.x - 0.4, z0: t.z - 0.4, x1: t.x + 0.4, z1: t.z + 0.4, d: IsoView.depth(t.x, t.z), y: 0, draw: () => this.cart(t.x, t.z, yaw) });
    }

    // véhicules
    for (const vh of g.vehicles.list) {
      if (vh.dead) continue;
      if (vh.x < view[0] - 6 || vh.x > view[2] + 6 || vh.z < view[1] - 6 || vh.z > view[3] + 6) continue;
      const len = vh.length;
      items.push({ x0: vh.x - len / 2, z0: vh.z - len / 2, x1: vh.x + len / 2, z1: vh.z + len / 2, d: IsoView.depth(vh.x, vh.z), y: 0, draw: () => this.vehicle(vh.kind, vh.x, vh.z, vh.yaw, len, vh.id) });
    }

    // personnages
    for (const a of g.agents.list) {
      if (a.dead || a.hidden || !a.app) continue;
      if (a.pos.x < view[0] - 2 || a.pos.x > view[2] + 2 || a.pos.z < view[1] - 2 || a.pos.z > view[3] + 2) continue;
      const px = a.pos.x;
      const pz = a.pos.z;
      items.push({
        x0: px - 0.2, z0: pz - 0.2, x1: px + 0.2, z1: pz + 0.2, d: IsoView.depth(px, pz), y: 0,
        draw: () => this.person(a, dt),
        hit: { kind: 'agent', id: a.id, box: this.personBox(px, pz, a.app!.height) },
      });
    }
    const pl = g.player;
    items.push({
      x0: pl.pos.x - 0.2, z0: pl.pos.z - 0.2, x1: pl.pos.x + 0.2, z1: pl.pos.z + 0.2, d: IsoView.depth(pl.pos.x, pl.pos.z), y: 0,
      draw: () => this.drawPlayer(dt),
      hit: { kind: 'player', id: -1, box: this.personBox(pl.pos.x, pl.pos.z, 1.8) },
    });

    if (this.ghost) {
      const gh = this.ghost;
      const def = EQUIPMENT_BY_ID[gh.def];
      const f = footprint(def, gh.rot);
      const x0 = GRID_X0 + gh.gx * CELL;
      const z0 = GRID_Z0 + gh.gz * CELL;
      items.push({
        x0, z0, x1: x0 + f.w * CELL, z1: z0 + f.d * CELL, d: 1e6, y: 0,
        draw: () => {
          ctx.save();
          ctx.globalAlpha = 0.55;
          const fake: PlacedEquip = { uid: -1, def: gh.def, gx: gh.gx, gz: gh.gz, rot: gh.rot, wear: 0 };
          drawEquipment(ctx, v, fake, est, { beltItems: 0, operated: false });
          ctx.restore();
          flat(ctx, v, rect(x0, z0, x0 + f.w * CELL, z0 + f.d * CELL), 0.02, gh.ok ? 'rgba(46,204,113,0.35)' : 'rgba(231,76,60,0.4)', gh.ok ? '#2ecc71' : '#e74c3c');
        },
      });
    }

    items.sort(compare);
    this.hits = [];
    for (const it of items) {
      it.draw();
      if (it.hit) this.hits.push(it.hit);
    }

    // --- nuit
    const hour = hourOf(st.time);
    const night = hour < 6.5 ? 1 : hour < 8 ? 1 - (hour - 6.5) / 1.5 : hour > 21 ? 1 : hour > 19.5 ? (hour - 19.5) / 1.5 : 0;
    if (night > 0.01) this.nightOverlay(night * 0.55, r);

    // --- bulles et textes flottants
    for (const a of g.agents.list) {
      const b = this.barks.get(a.id);
      if (!b) continue;
      if (b.until < this.t || a.dead) {
        this.barks.delete(a.id);
        continue;
      }
      const [sx, sy] = v.px(a.pos.x, (a.app?.height ?? 1.7) * 0.92 + 0.15, a.pos.z);
      bubble(ctx, sx, sy, b.text, { scale: Math.max(0.75, Math.min(1.2, v.zoom)), alpha: Math.min(1, (b.until - this.t) * 2) });
    }
    this.floats = this.floats.filter((f) => f.t < 1.6);
    for (const f of this.floats) {
      f.t += dt;
      const [sx, sy] = v.px(f.x, f.y + f.t * 0.8, f.z);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      ctx.font = `900 ${Math.round(15 * Math.max(0.8, Math.min(1.3, v.zoom)))}px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- éléments
  private boxItem(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, st: PrismStyle, after?: () => void): Drawable {
    return {
      x0, z0, x1, z1, d: IsoView.depth((x0 + x1) / 2, (z0 + z1) / 2), y: y0,
      draw: () => {
        box(this.ctx, this.view, x0, z0, x1, z1, y0, y1, st);
        after?.();
      },
    };
  }

  private visibleBounds(): [number, number, number, number] {
    const v = this.view;
    const pts = [v.ground(0, 0), v.ground(v.w, 0), v.ground(0, v.h), v.ground(v.w, v.h), v.ground(v.w / 2, -v.h * 0.5)];
    const xs = pts.map((p) => p.x);
    const zs = pts.map((p) => p.z);
    return [Math.min(...xs) - 4, Math.min(...zs) - 4, Math.max(...xs) + 4, Math.max(...zs) + 4];
  }

  private drawGrid(r: ReturnType<typeof storeRect>) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    for (let x = r.x0; x <= r.x1 + 1e-6; x += CELL) {
      const [ax, ay] = v.px(x, 0.005, r.z0);
      const [bx, by] = v.px(x, 0.005, r.z1);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    for (let z = r.z0; z <= r.z1 + 1e-6; z += CELL) {
      const [ax, ay] = v.px(r.x0, 0.005, z);
      const [bx, by] = v.px(r.x1, 0.005, z);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }

  private outline(x0: number, z0: number, x1: number, z1: number, h: number) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.save();
    ctx.strokeStyle = '#ffd32a';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -this.t * 20;
    path(ctx, [v.px(x0, 0.02, z0), v.px(x1, 0.02, z0), v.px(x1, 0.02, z1), v.px(x0, 0.02, z1)]);
    ctx.stroke();
    path(ctx, [v.px(x0, h, z0), v.px(x1, h, z0), v.px(x1, h, z1), v.px(x0, h, z1)]);
    ctx.stroke();
    ctx.restore();
  }

  private drawSign(x0: number, x1: number, name: string, bg: number, fg: number) {
    const ctx = this.ctx;
    const v = this.view;
    const z = -0.22;
    box(ctx, v, x0 + 0.5, z - 0.12, x1 - 0.5, z, 2.6, 3.5, { color: bg, top: bg });
    // texte plaqué sur la face avant (plan z constant : axe x de l'écran incliné)
    const k = v.k;
    const [ox, oy] = v.px(x0 + 0.9, 3.4, z - 0.12);
    ctx.save();
    ctx.setTransform(this.dpr * 0.866 * k, this.dpr * 0.5 * k, 0, this.dpr * 0.92 * k, ox * this.dpr, oy * this.dpr);
    ctx.font = '900 0.7px "Luckiest Guy", Impact, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = css(fg);
    const maxW = x1 - x0 - 1.8;
    const w = ctx.measureText(name).width;
    const s = Math.min(1, maxW / Math.max(0.1, w));
    ctx.scale(s, 1);
    ctx.fillText(name, (maxW / s - w) / 2, 0.12);
    ctx.restore();
  }

  private carton(x: number, z: number, y: number, color?: number) {
    box(this.ctx, this.view, x - 0.23, z - 0.18, x + 0.23, z + 0.18, y, y + 0.34, { color: 0xc49a6c, top: 0xd8b48a });
    if (color !== undefined) box(this.ctx, this.view, x - 0.07, z - 0.19, x + 0.07, z - 0.18, y + 0.1, y + 0.22, { color, noTop: true });
  }

  private cart(x: number, z: number, yaw: number) {
    const ctx = this.ctx;
    const v = this.view;
    prism(ctx, v, orect(x, z, 0.28, 0.42, yaw), 0.25, 0.85, { color: 0xb2bec3, top: 0xdfe6e9, alpha: 0.75 });
    shadow(ctx, v, x, z, 0.35, 0.15);
  }

  private vehicle(kind: string, x: number, z: number, yaw: number, len: number, id: number) {
    const ctx = this.ctx;
    const v = this.view;
    const colors = [0xd63031, 0x0984e3, 0xdfe6e9, 0x2d3436, 0xfdcb6e, 0x00b894, 0x6c5ce7, 0xe17055];
    const col = kind === 'police' ? 0xf5f6fa : kind === 'bus' ? 0x0984e3 : kind === 'truck' ? 0xf5f6fa : colors[id % colors.length];
    const hw = kind === 'truck' || kind === 'bus' ? 1.2 : 0.9;
    // le lacet des véhicules : direction de déplacement (sin, cos)
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const at = (along: number) => ({ x: x + fx * along, z: z + fz * along });
    shadow(ctx, v, x, z, len * 0.45, 0.18);
    if (kind === 'truck') {
      const cab = at(len / 2 - 1.1);
      const cargo = at(-0.8);
      prism(ctx, v, orect(cargo.x, cargo.z, hw, len / 2 - 1.2, yaw), 0.5, 3.2, { color: 0xffffff, top: 0xe84118 });
      prism(ctx, v, orect(cab.x, cab.z, hw, 0.9, yaw), 0.5, 2.4, { color: 0xe84118, top: 0xd63031 });
      return;
    }
    if (kind === 'bus') {
      prism(ctx, v, orect(x, z, hw, len / 2, yaw), 0.4, 3.0, { color: col, top: 0xdfe6e9 });
      return;
    }
    prism(ctx, v, orect(x, z, hw, len / 2, yaw), 0.3, 0.95, { color: col, top: col });
    const cab = at(-0.2);
    prism(ctx, v, orect(cab.x, cab.z, hw * 0.85, len * 0.25, yaw), 0.95, 1.45, { color: 0x74b9ff, top: col, alpha: 0.95 });
    if (kind === 'police') {
      const [sx, sy] = v.px(cab.x, 1.6, cab.z);
      ctx.fillStyle = Math.sin(this.t * 12) > 0 ? '#0984e3' : '#d63031';
      ctx.beginPath();
      ctx.arc(sx, sy, 0.15 * v.k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private personBox(x: number, z: number, h: number): [number, number, number, number] {
    const [sx, sy] = this.view.px(x, 0, z);
    const k = this.view.k;
    const w = 0.32 * k;
    return [sx - w, sy - h * k * 0.85, sx + w, sy + 0.1 * k];
  }

  private poseFor(a: Agent, dt: number): Pose {
    const sp = a.speed;
    const ph = (this.phases.get(a.id) ?? Math.random() * 6) + dt * sp * 5.2;
    this.phases.set(a.id, ph);
    const fx = Math.sin(a.yaw);
    const fz = Math.cos(a.yaw);
    let carry: Carry = null;
    let carryColor: number | undefined;
    let mood: Mood = 'neutral';
    let action: Pose['action'] = null;
    if (a.kind === 'customer') {
      const c = a as Customer;
      if (c.hold2d === 'basket') carry = 'basket';
      else if (c.hold2d === 'push') carry = 'cart';
      else if (c.basket.length) carry = 'item';
      if (c.basket.length) carryColor = PRODUCT_BY_ID[c.basket[c.basket.length - 1].pid]?.color;
      if (c.state === 'ranting') mood = 'angry';
      else if (c.state === 'paying' || c.state === 'leaving') mood = c.basket.length ? 'happy' : 'neutral';
    } else if (a.kind === 'employee') {
      const e = a as EmployeeAgent;
      if (e.carton) {
        carry = 'carton';
        carryColor = PRODUCT_BY_ID[e.carton.pid]?.color;
      }
      if (e.state === 'break') mood = 'happy';
    }
    if (a.hold2d === 'carry' && !carry) carry = 'carton';
    const act = a.act2d && this.game.realTime - a.act2d.t < 2.5 ? a.act2d.a : null;
    if (act === 'angry') {
      mood = 'angry';
      action = 'angry';
    } else if (act === 'sigh' || act === 'shrug') mood = 'sad';
    else if (act === 'slip') mood = 'surprised';
    else if (act === 'celebrate' || act === 'dance') {
      mood = 'happy';
      action = 'celebrate';
    } else if (act === 'wave') action = 'wave';
    else if (act === 'scan') action = 'scan';
    else if (act === 'examine' || act === 'reach' || act === 'reachLow') action = 'reach';
    return { dirX: (fx + fz) * 0.866, dirY: (fx - fz) * 0.5, phase: ph, walk: Math.min(1, sp / 1.1), carry, carryColor, mood, action, t: this.t };
  }

  private person(a: Agent, dt: number) {
    const [sx, sy] = this.view.px(a.pos.x, 0, a.pos.z);
    const pose = this.poseFor(a, dt);
    pose.highlight = this.selection?.kind === 'agent' && this.selection.id === a.id;
    drawPerson(this.ctx, sx, sy, this.view.k, a.app!, pose);
    // petit badge pour les employés (repérage rapide)
    if (a.kind === 'employee') {
      const k = this.view.k;
      this.ctx.font = `${Math.max(9, 0.28 * k)}px ${EMOJI_FONT}`;
      this.ctx.textAlign = 'center';
      this.ctx.fillText('⭐', sx, sy - (a.app!.height * 0.8 + 0.18) * k);
    }
  }

  private playerPhase = 0;
  private drawPlayer(dt: number) {
    const p = this.game.player;
    this.playerPhase += dt * p.speedNow * 5.2;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const h = p.held;
    const carry: Carry = h?.kind === 'cartons' ? 'carton' : h?.kind === 'item' ? 'item' : h?.kind === 'cart' ? 'cart' : null;
    const carryColor = h?.kind === 'cartons' ? PRODUCT_BY_ID[h.list[0]?.pid]?.color : h?.kind === 'item' ? PRODUCT_BY_ID[h.pid]?.color : undefined;
    const [sx, sy] = this.view.px(p.pos.x, 0, p.pos.z);
    const k = this.view.k;
    // halo « patron »
    this.ctx.fillStyle = 'rgba(255,211,42,0.35)';
    this.ctx.beginPath();
    this.ctx.ellipse(sx, sy, 0.42 * k, 0.24 * k, 0, 0, Math.PI * 2);
    this.ctx.fill();
    const pose: Pose = { dirX: (fx + fz) * 0.866, dirY: (fx - fz) * 0.5, phase: this.playerPhase, walk: Math.min(1, p.speedNow / 1.4), carry, carryColor, mood: 'neutral', action: p.mode === 'cashier' ? 'scan' : null, t: this.t, highlight: this.selection?.kind === 'player' };
    if (p.mode === 'cashier' && !this.game.checkouts.lanes.size) pose.action = null;
    drawPerson(this.ctx, sx, sy, k, this.playerLook, pose);
    this.ctx.font = `${Math.max(10, 0.32 * k)}px ${EMOJI_FONT}`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText('👑', sx, sy - (1.8 * 0.8 + 0.2) * k);
  }

  private drawEquipSprite(e: PlacedEquip, est: EquipStyle, ex: { beltItems: number; operated: boolean }) {
    const v = this.view;
    const k = v.k;
    // zoom quantifié : on ne redessine pas les sprites à chaque cran de pincement
    const kq = Math.pow(1.06, Math.round(Math.log(k) / Math.log(1.06)));
    const key = `${kq.toFixed(3)}|${est.shelf}|${equipSignature(e, ex.beltItems, ex.operated)}`;
    let sp = this.sprites.get(e.uid);
    const c = equipCenter(e);
    if (!sp || sp.key !== key) {
      const def = EQUIPMENT_BY_ID[e.def];
      const f = footprint(def, e.rot);
      const hw = (f.w * CELL) / 2 + 0.6;
      const hd = (f.d * CELL) / 2 + 0.6;
      const tmp = new IsoView();
      tmp.base = 1;
      tmp.zoom = kq;
      tmp.cx = c.x;
      tmp.cz = c.z;
      tmp.w = 0;
      tmp.h = 0;
      const corners: [number, number][] = [];
      for (const [dx, dz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) for (const y of [0, def.h + 1.4]) corners.push(tmp.px(c.x + dx, y, c.z + dz));
      const minX = Math.min(...corners.map((p) => p[0])) - 4;
      const maxX = Math.max(...corners.map((p) => p[0])) + 4;
      const minY = Math.min(...corners.map((p) => p[1])) - 4;
      const maxY = Math.max(...corners.map((p) => p[1])) + 4;
      const w = Math.ceil(maxX - minX);
      const h = Math.ceil(maxY - minY);
      const canvas = sp?.canvas ?? document.createElement('canvas');
      const dpr = this.dpr;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      const cx = canvas.getContext('2d')!;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, w, h);
      cx.lineJoin = 'round';
      // vue locale : l'ancre (centre au sol) tombe en (-minX, -minY)
      tmp.w = -minX * 2;
      tmp.h = -minY * 2;
      drawEquipment(cx, tmp, e, est, ex);
      sp = { key, canvas, ax: -minX, ay: -minY, w, h, kq };
      this.sprites.set(e.uid, sp);
    }
    const [sx, sy] = v.px(c.x, 0, c.z);
    const s = k / sp.kq;
    this.ctx.drawImage(sp.canvas, sx - sp.ax * s, sy - sp.ay * s, sp.w * s, sp.h * s);
  }

  private nightOverlay(a: number, r: ReturnType<typeof storeRect>) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.save();
    ctx.fillStyle = `rgba(12,18,48,${a})`;
    ctx.beginPath();
    ctx.rect(0, 0, v.w, v.h);
    // le magasin éclairé reste plus clair (trou dans le voile, règle pair-impair)
    const lit = this.game.st.store.lightLevel > 0 && !this.game.powerOut;
    if (lit) {
      const pts = [v.px(r.x0, 0, r.z0), v.px(r.x1, 0, r.z0), v.px(r.x1, 0, r.z1), v.px(r.x1, 3, r.z1), v.px(r.x0, 3, r.z1), v.px(r.x0, 3, r.z0)];
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
    }
    ctx.fill('evenodd');
    if (lit) {
      ctx.fillStyle = `rgba(12,18,48,${a * 0.25})`;
      ctx.beginPath();
      const pts = [v.px(r.x0, 0, r.z0), v.px(r.x1, 0, r.z0), v.px(r.x1, 0, r.z1), v.px(r.x1, 3, r.z1), v.px(r.x0, 3, r.z1), v.px(r.x0, 3, r.z0)];
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- utilitaires
function overlaps(rc: readonly number[], b: [number, number, number, number]) {
  return rc[2] >= b[0] && rc[0] <= b[2] && rc[3] >= b[1] && rc[1] <= b[3];
}

/** Ordre de dessin : d'abord ce qui est derrière (x plus petit ou z plus grand). */
function compare(a: Drawable, b: Drawable): number {
  const E = 0.02;
  const aBehind = a.x1 <= b.x0 + E || a.z0 >= b.z1 - E;
  const bBehind = b.x1 <= a.x0 + E || b.z0 >= a.z1 - E;
  if (aBehind && !bBehind) return -1;
  if (bBehind && !aBehind) return 1;
  return a.d - b.d || a.y - b.y;
}

function hullOf(v: IsoView, x0: number, z0: number, x1: number, z1: number, h: number): [number, number][] {
  // contour hexagonal d'une boîte vue en isométrie
  return [v.px(x0, 0, z0), v.px(x1, 0, z0), v.px(x1, 0, z1), v.px(x1, h, z1), v.px(x0, h, z1), v.px(x0, h, z0)];
}

function inPoly(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Cellules couvertes par un équipement (pour la construction). */
export const equipCells = cellsOf;
export type { P2 };
