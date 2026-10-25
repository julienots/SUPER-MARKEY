/**
 * Textures procédurales générées sur canvas (aucun asset externe requis, donc aucun problème de licence).
 * En mode headless (tests Node), toutes les fonctions renvoient null.
 */
import * as THREE from 'three';
import { PRODUCT_BY_ID, type ProductDef } from '../data/products';
import type { FloorStyle } from '../data/styles';

export const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

const cache = new Map<string, THREE.Texture | null>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export const css = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
const shade = (c: number, f: number) => {
  const r = Math.min(255, Math.max(0, ((c >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((c >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (c & 255) * f));
  return (r << 16) | (g << 8) | b;
};
export const lum = (c: number) => (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114) / 255;

function finish(c: HTMLCanvasElement, repeat?: [number, number], srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function cached(key: string, make: () => THREE.Texture | null): THREE.Texture | null {
  if (!hasDom()) return null;
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key)!;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export function floorTexture(f: FloorStyle): THREE.Texture | null {
  return cached(`floor:${f.id}`, () => {
    const [c, x] = canvas(512, 512);
    x.fillStyle = css(f.base);
    x.fillRect(0, 0, 512, 512);
    if (f.pattern === 'tiles' || f.pattern === 'checker') {
      const n = 4;
      const s = 512 / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          x.fillStyle = css(f.pattern === 'checker' ? ((i + j) % 2 ? f.alt : f.base) : shade(f.base, 0.97 + ((i * 7 + j * 3) % 5) * 0.012));
          x.fillRect(i * s, j * s, s, s);
        }
      x.strokeStyle = css(shade(f.alt, 0.85), 0.9);
      x.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        x.beginPath();
        x.moveTo(i * s, 0);
        x.lineTo(i * s, 512);
        x.moveTo(0, i * s);
        x.lineTo(512, i * s);
        x.stroke();
      }
      noise(x, 512, 512, 10);
      return finish(c, [1, 1]);
    }
    if (f.pattern === 'wood') {
      for (let i = 0; i < 8; i++) {
        x.fillStyle = css(shade(i % 2 ? f.base : f.alt, 0.92 + (i % 3) * 0.05));
        x.fillRect(0, i * 64, 512, 64);
        x.fillStyle = css(0x000000, 0.25);
        x.fillRect(0, i * 64, 512, 2);
        const off = (i * 173) % 512;
        x.fillRect(off, i * 64, 2, 64);
        for (let k = 0; k < 30; k++) {
          x.strokeStyle = css(shade(f.alt, 0.7), 0.15);
          x.beginPath();
          const y = i * 64 + Math.random() * 64;
          x.moveTo(0, y);
          x.bezierCurveTo(170, y + 4, 340, y - 4, 512, y);
          x.stroke();
        }
      }
      noise(x, 512, 512, 12);
      return finish(c, [1, 1]);
    }
    if (f.pattern === 'terrazzo') {
      noise(x, 512, 512, 14);
      const cols = [f.alt, 0xffffff, 0x9c7c64, 0x6d8a96, 0xc9a27e];
      for (let k = 0; k < 900; k++) {
        x.fillStyle = css(cols[k % cols.length], 0.85);
        const r = 1.5 + Math.random() * 5;
        x.beginPath();
        x.ellipse(Math.random() * 512, Math.random() * 512, r, r * (0.5 + Math.random() * 0.6), Math.random() * 3, 0, Math.PI * 2);
        x.fill();
      }
      return finish(c, [1, 1]);
    }
    // béton
    noise(x, 512, 512, 22, 7);
    x.strokeStyle = css(0x000000, 0.18);
    x.lineWidth = 2;
    x.strokeRect(0, 0, 512, 512);
    return finish(c, [1, 1]);
  });
}

export function asphaltTexture(): THREE.Texture | null {
  return cached('asphalt', () => {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#3b3d40';
    x.fillRect(0, 0, 256, 256);
    noise(x, 256, 256, 26, 3);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = css(0x000000, 0.08);
      x.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 6, 1 + Math.random() * 3);
    }
    return finish(c, [1, 1]);
  });
}

export function paverTexture(): THREE.Texture | null {
  return cached('pavers', () => {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#b9b4aa';
    x.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 4; i++) {
        const off = j % 2 ? 32 : 0;
        x.fillStyle = css(shade(0xbab5ab, 0.9 + Math.random() * 0.15));
        x.fillRect(i * 64 + off + 2, j * 32 + 2, 60, 28);
      }
    noise(x, 256, 256, 14, 5);
    return finish(c, [1, 1]);
  });
}

export function grassTexture(): THREE.Texture | null {
  return cached('grass', () => {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#5f8a3b';
    x.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 3000; k++) {
      x.fillStyle = css(Math.random() < 0.5 ? 0x4e7a2f : 0x77a24a, 0.5);
      x.fillRect(Math.random() * 256, Math.random() * 256, 1, 3);
    }
    noise(x, 256, 256, 10, 9);
    return finish(c, [1, 1]);
  });
}

/** Façade d'immeuble : grille de fenêtres (texture couleur + carte émissive pour la nuit). */
export function facadeTextures(seed: number, color: number, floors: number, cols: number, prosperity: number): { map: THREE.Texture | null; emissive: THREE.Texture | null } {
  if (!hasDom()) return { map: null, emissive: null };
  const key = `facade:${seed}:${color}:${floors}:${cols}:${Math.round(prosperity * 4)}`;
  const em = `${key}:e`;
  if (!cache.has(key)) {
    const W = 64 * cols;
    const H = 64 * floors;
    const [c, x] = canvas(W, H);
    const [ce, xe] = canvas(W, H);
    x.fillStyle = css(color);
    x.fillRect(0, 0, W, H);
    noise(x, W, H, 10, seed);
    xe.fillStyle = '#000';
    xe.fillRect(0, 0, W, H);
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let f = 0; f < floors; f++) {
      // bandeau d'étage
      x.fillStyle = css(shade(color, 0.85));
      x.fillRect(0, f * 64 + 60, W, 4);
      for (let i = 0; i < cols; i++) {
        const wx = i * 64 + 14;
        const wy = f * 64 + 14;
        const lit = rnd() < 0.35 + prosperity * 0.3;
        x.fillStyle = lit ? '#41505c' : '#2b343c';
        x.fillRect(wx, wy, 36, 38);
        x.fillStyle = css(0xffffff, 0.15);
        x.fillRect(wx + 2, wy + 2, 14, 34);
        // volets, balcons, linge
        if (rnd() < 0.3) {
          x.fillStyle = css(rnd() < 0.5 ? 0x8d6e63 : 0x546e7a);
          x.fillRect(wx - 6, wy, 6, 38);
          x.fillRect(wx + 36, wy, 6, 38);
        }
        if (rnd() < 0.18 + prosperity * 0.2) {
          x.fillStyle = css(rnd() < 0.5 ? 0xe74c3c : 0x27ae60);
          x.fillRect(wx, wy + 40, 36, 5);
        }
        if (prosperity < 0.4 && rnd() < 0.1) {
          x.fillStyle = css(0xffffff, 0.9);
          x.fillRect(wx + 4, wy + 38, 6, 8);
          x.fillStyle = css(0x3498db, 0.9);
          x.fillRect(wx + 14, wy + 38, 8, 9);
        }
        if (lit) {
          xe.fillStyle = rnd() < 0.7 ? '#ffd9a0' : '#bfe3ff';
          xe.fillRect(wx, wy, 36, 38);
        }
      }
    }
    // tags au rez-de-chaussée dans les quartiers pauvres
    if (prosperity < 0.45) {
      for (let k = 0; k < 3; k++) {
        x.font = `bold ${18 + rnd() * 10}px sans-serif`;
        x.fillStyle = css([0xe84393, 0x0984e3, 0x00b894, 0xfdcb6e][k % 4], 0.85);
        x.save();
        x.translate(rnd() * (W - 80), H - 12 - rnd() * 30);
        x.rotate(-0.1 + rnd() * 0.2);
        x.fillText(['TILLEULS', 'K-RIM', '93 ZOO', 'SWAG', 'NIKO'][Math.floor(rnd() * 5)], 0, 0);
        x.restore();
      }
    }
    cache.set(key, finish(c));
    cache.set(em, finish(ce));
  }
  return { map: cache.get(key)!, emissive: cache.get(em)! };
}

export function brickTexture(color: number): THREE.Texture | null {
  return cached(`brick:${color}`, () => {
    const [c, x] = canvas(256, 256);
    x.fillStyle = css(shade(color, 0.7));
    x.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 16; j++)
      for (let i = 0; i < 5; i++) {
        const off = j % 2 ? 26 : 0;
        x.fillStyle = css(shade(color, 0.85 + Math.random() * 0.25));
        x.fillRect(i * 52 + off - 26 + 2, j * 16 + 2, 48, 12);
      }
    noise(x, 256, 256, 12);
    return finish(c, [1, 1]);
  });
}

/** Étiquette face avant d'un produit. */
export function labelTexture(p: ProductDef): THREE.Texture | null {
  return cached(`label:${p.id}`, () => {
    const [c, x] = canvas(128, 128);
    x.fillStyle = css(p.color);
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = css(p.color2);
    const s = p.id.length % 4;
    if (s === 0) x.fillRect(0, 74, 128, 30);
    else if (s === 1) {
      x.beginPath();
      x.arc(64, 70, 34, 0, Math.PI * 2);
      x.fill();
    } else if (s === 2) {
      x.fillRect(0, 0, 128, 28);
      x.fillRect(0, 100, 128, 28);
    } else {
      x.beginPath();
      x.moveTo(0, 128);
      x.lineTo(128, 50);
      x.lineTo(128, 128);
      x.fill();
    }
    const txt = lum(p.color) > 0.55 ? '#1e1e1e' : '#ffffff';
    x.fillStyle = txt;
    x.textAlign = 'center';
    x.font = 'bold 22px "Luckiest Guy", Impact, sans-serif';
    const brand = p.brand.toUpperCase();
    x.fillText(brand.length > 10 ? brand.slice(0, 10) : brand, 64, 48);
    x.font = 'bold 12px sans-serif';
    x.fillStyle = lum(p.color2) > 0.55 ? '#1e1e1e' : '#ffffff';
    const words = p.name.split(' ').slice(0, 3).join(' ');
    x.fillText(words.length > 18 ? words.slice(0, 18) : words, 64, 94);
    if (p.tier === 'premium') {
      x.fillStyle = '#d4af37';
      x.fillRect(8, 6, 112, 4);
    }
    if (p.tier === 'mdd') {
      x.fillStyle = '#e84118';
      x.font = 'bold 13px sans-serif';
      x.fillText('MARQUE BAZAR', 64, 118);
    }
    return finish(c);
  });
}

/** Étiquette de prix de rayon (avec bandeau promo). */
export function priceTexture(price: number, promo: string | null, expiring = false): THREE.Texture | null {
  const key = `price:${price.toFixed(2)}:${promo}:${expiring}`;
  return cached(key, () => {
    const [c, x] = canvas(128, 64);
    x.fillStyle = promo ? '#ffd32a' : '#ffffff';
    x.fillRect(0, 0, 128, 64);
    x.fillStyle = promo ? '#e84118' : '#2f3542';
    x.fillRect(0, 0, 128, 8);
    x.textAlign = 'center';
    x.fillStyle = '#1e272e';
    x.font = 'bold 34px "Luckiest Guy", Impact, sans-serif';
    x.fillText(price.toFixed(2).replace('.', ',') + '€', 64, 46);
    if (promo) {
      x.fillStyle = '#e84118';
      x.font = 'bold 13px sans-serif';
      x.fillText(promo, 64, 60);
    } else if (expiring) {
      x.fillStyle = '#16a085';
      x.font = 'bold 12px sans-serif';
      x.fillText('ANTI-GASPI', 64, 60);
    }
    return finish(c);
  });
}

export function signTexture(text: string, bg: number, fg: number, w = 512, h = 128, font = '"Luckiest Guy", Impact, sans-serif'): THREE.Texture | null {
  return cached(`sign:${text}:${bg}:${fg}:${w}:${h}`, () => {
    const [c, x] = canvas(w, h);
    x.fillStyle = css(bg);
    x.fillRect(0, 0, w, h);
    x.fillStyle = css(fg);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    let size = h * 0.62;
    x.font = `${size}px ${font}`;
    while (x.measureText(text).width > w * 0.92 && size > 10) {
      size -= 2;
      x.font = `${size}px ${font}`;
    }
    x.fillText(text, w / 2, h / 2 + size * 0.06);
    return finish(c);
  });
}

/** Petite icône emoji pour les bulles au-dessus des personnages. */
export function emojiTexture(emoji: string): THREE.Texture | null {
  return cached(`emoji:${emoji}`, () => {
    const [c, x] = canvas(96, 96);
    x.fillStyle = 'rgba(255,255,255,0.95)';
    x.beginPath();
    x.arc(48, 44, 38, 0, Math.PI * 2);
    x.fill();
    x.beginPath();
    x.moveTo(38, 76);
    x.lineTo(48, 94);
    x.lineTo(56, 76);
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.25)';
    x.lineWidth = 3;
    x.beginPath();
    x.arc(48, 44, 38, 0, Math.PI * 2);
    x.stroke();
    x.font = '46px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(emoji, 48, 47);
    return finish(c);
  });
}

export function cardboardTexture(pid: string | null): THREE.Texture | null {
  return cached(`carton:${pid}`, () => {
    const [c, x] = canvas(128, 128);
    x.fillStyle = '#c49a6c';
    x.fillRect(0, 0, 128, 128);
    noise(x, 128, 128, 16, 11);
    x.fillStyle = 'rgba(120,80,40,0.5)';
    x.fillRect(58, 0, 12, 128);
    if (pid) {
      const p = PRODUCT_BY_ID[pid];
      x.fillStyle = css(p.color2);
      x.fillRect(10, 40, 108, 46);
      x.fillStyle = lum(p.color2) > 0.55 ? '#111' : '#fff';
      x.font = 'bold 14px sans-serif';
      x.textAlign = 'center';
      x.fillText(p.brand.toUpperCase().slice(0, 14), 64, 60);
      x.font = '11px sans-serif';
      x.fillText(`x${p.cartonQty}`, 64, 78);
    }
    x.fillStyle = '#222';
    x.font = '10px sans-serif';
    x.fillText('↑ HAUT ↑', 64, 112);
    return finish(c);
  });
}

export function radialGlowTexture(color = 0xffffff): THREE.Texture | null {
  return cached(`glow:${color}`, () => {
    const [c, x] = canvas(64, 64);
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, css(color, 1));
    g.addColorStop(0.4, css(color, 0.4));
    g.addColorStop(1, css(color, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return finish(c);
  });
}

export function messTexture(kind: string): THREE.Texture | null {
  return cached(`mess:${kind}`, () => {
    const [c, x] = canvas(128, 128);
    x.clearRect(0, 0, 128, 128);
    const col = kind === 'flaque' ? 'rgba(120,170,220,0.55)' : kind === 'verre' ? 'rgba(200,230,255,0.7)' : kind === 'tag' ? 'rgba(232,67,147,0.9)' : kind === 'detritus' ? 'rgba(90,70,50,0.8)' : 'rgba(80,60,40,0.55)';
    x.fillStyle = col;
    if (kind === 'tag') {
      x.font = 'bold 40px Impact, sans-serif';
      x.textAlign = 'center';
      x.fillText('TAG!', 64, 80);
      x.strokeStyle = 'rgba(0,0,0,0.6)';
      x.lineWidth = 2;
      x.strokeText('TAG!', 64, 80);
    } else if (kind === 'verre') {
      for (let k = 0; k < 18; k++) {
        x.beginPath();
        const cx = 64 + (Math.random() - 0.5) * 80;
        const cy = 64 + (Math.random() - 0.5) * 80;
        x.moveTo(cx, cy);
        x.lineTo(cx + Math.random() * 12, cy + Math.random() * 6);
        x.lineTo(cx + Math.random() * 4, cy + Math.random() * 12);
        x.fill();
      }
      x.fillStyle = 'rgba(120,20,40,0.4)';
      x.beginPath();
      x.ellipse(64, 64, 40, 28, 0.3, 0, Math.PI * 2);
      x.fill();
    } else {
      for (let k = 0; k < 7; k++) {
        x.beginPath();
        x.ellipse(64 + (Math.random() - 0.5) * 50, 64 + (Math.random() - 0.5) * 50, 14 + Math.random() * 22, 10 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
        x.fill();
      }
    }
    return finish(c);
  });
}

export function skyTexture(top: number, bottom: number): THREE.Texture | null {
  if (!hasDom()) return null;
  const [c, x] = canvas(4, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, css(top));
  g.addColorStop(1, css(bottom));
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 256);
  return finish(c);
}
