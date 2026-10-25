/**
 * Génère le logo officiel « BAZAR BAZAR : LA SUPÉRETTE DE L'ENFER » en SVG 100 % vectoriel
 * (le texte est converti en tracés via opentype.js à partir de la police libre Luckiest Guy, licence OFL).
 * Sorties : public/brand/bazar-bazar-logo.svg, public/brand/bazar-bazar-icon.svg
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (f) => {
  const b = fs.readFileSync(path.join(root, 'node_modules/@fontsource/luckiest-guy/files', f));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const font = load('luckiest-guy-latin-400-normal.woff');

/** Tracés d'un mot, lettre par lettre (rotation et sautillement individuels = style « cartoon »). */
function word(text, x, baseline, size, { tracking = 0, rot = [], dy = [] } = {}) {
  const scale = size / font.unitsPerEm;
  let cx = x;
  const out = [];
  [...text].forEach((ch, i) => {
    const g = font.charToGlyph(ch);
    const adv = g.advanceWidth * scale;
    const p = g.getPath(cx, baseline + (dy[i] ?? 0), size).toPathData(1);
    const bb = g.getBoundingBox();
    const mx = cx + ((bb.x1 + bb.x2) / 2) * scale;
    const my = baseline + (dy[i] ?? 0) - ((bb.y1 + bb.y2) / 2) * scale;
    out.push({ d: p, r: rot[i] ?? 0, mx, my });
    cx += adv + tracking;
  });
  return { glyphs: out, width: cx - x - tracking };
}

const measure = (text, size, tracking = 0) => [...text].reduce((a, ch) => a + font.charToGlyph(ch).advanceWidth * (size / font.unitsPerEm) + tracking, -tracking);

/** Rendu d'un mot : extrusion 3D, contour épais, remplissage dégradé, reflet. */
function renderWord(w, { fill, extrude, depth = 12, stroke = '#120402', sw = 24, id }) {
  const glyphs = (attrs) => w.glyphs.map((g) => `<path d="${g.d}" transform="rotate(${g.r} ${g.mx.toFixed(1)} ${g.my.toFixed(1)})" ${attrs}/>`).join('');
  let s = `<g id="${id}">`;
  for (let k = depth; k >= 1; k--) s += `<g transform="translate(${k * 1.6} ${k * 2.2})">${glyphs(`fill="${extrude}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`)}</g>`;
  s += glyphs(`fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"`);
  s += glyphs(`fill="${fill}"`);
  s += '</g>';
  return s;
}

/** Texte posé sur un arc (bannière). */
function arcText(text, cx, cy, radius, size, tracking, fill) {
  const total = measure(text, size, tracking);
  const scale = size / font.unitsPerEm;
  let a = -total / 2 / radius;
  let s = '';
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    const adv = g.advanceWidth * scale;
    const mid = a + adv / 2 / radius;
    const x = cx + Math.sin(mid) * radius;
    const y = cy - Math.cos(mid) * radius;
    const p = g.getPath(-adv / 2, size * 0.36, size).toPathData(1);
    s += `<path d="${p}" fill="${fill}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((mid * 180) / Math.PI).toFixed(2)})"/>`;
    a += (adv + tracking) / radius;
  }
  return s;
}

function flame(x, y, w, h, lean = 0) {
  return `M ${x} ${y} C ${x - w * 0.6} ${y - h * 0.25}, ${x - w * 0.55 + lean * 0.3} ${y - h * 0.6}, ${x + lean} ${y - h} C ${x + w * 0.05 + lean * 0.6} ${y - h * 0.65}, ${x + w * 0.45} ${y - h * 0.55}, ${x + w * 0.35} ${y - h * 0.3} C ${x + w * 0.55} ${y - h * 0.4}, ${x + w * 0.6} ${y - h * 0.15}, ${x} ${y} Z`;
}

function sparkle(x, y, r, fill) {
  return `<path d="M ${x} ${y - r} Q ${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q ${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q ${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q ${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}" stroke="#120402" stroke-width="5" stroke-linejoin="round"/>`;
}

/** Caddie diabolique : cornes, queue fourchue, yeux méchants, roues en flammes. */
function devilCart(tx, ty, s, rot = 0) {
  const k = '#120402';
  return `<g class="devil-cart" transform="translate(${tx} ${ty}) rotate(${rot}) scale(${s})">
  <g class="wheel-flames">
    <path d="${flame(-48, 118, 70, 120, -30)}" fill="url(#fireV)" stroke="${k}" stroke-width="6"/>
    <path d="${flame(52, 118, 70, 110, -25)}" fill="url(#fireV)" stroke="${k}" stroke-width="6"/>
  </g>
  <path d="M -170 -92 L -120 -92 L -78 60 L 110 60" fill="none" stroke="${k}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M -170 -92 L -120 -92 L -78 60 L 110 60" fill="none" stroke="#d9dde3" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M -128 -62 L 150 -62 L 118 42 L -92 42 Z" fill="#e8291c" stroke="${k}" stroke-width="12" stroke-linejoin="round"/>
  <path d="M -112 -40 L 132 -40 M -104 -12 L 124 -12 M -96 16 L 116 16" stroke="#8e140c" stroke-width="7" stroke-linecap="round"/>
  <path d="M -60 -62 L -48 42 M 0 -62 L 2 42 M 60 -62 L 52 42" stroke="#8e140c" stroke-width="7" stroke-linecap="round"/>
  <!-- visage -->
  <path d="M -54 -30 L -14 -16 L -50 -6 Z" fill="#ffd23a" stroke="${k}" stroke-width="7" stroke-linejoin="round"/>
  <path d="M 66 -30 L 26 -16 L 62 -6 Z" fill="#ffd23a" stroke="${k}" stroke-width="7" stroke-linejoin="round"/>
  <path d="M -40 14 Q 6 44 64 12 L 52 26 L 38 18 L 26 30 L 12 20 L 0 30 L -14 20 L -26 28 Z" fill="#fff8e7" stroke="${k}" stroke-width="7" stroke-linejoin="round"/>
  <!-- cornes -->
  <path d="M -96 -60 C -122 -104 -112 -150 -78 -172 C -88 -136 -80 -104 -60 -64 Z" fill="#ffd23a" stroke="${k}" stroke-width="10" stroke-linejoin="round"/>
  <path d="M 104 -60 C 132 -104 124 -150 88 -172 C 98 -136 90 -104 68 -64 Z" fill="#ffd23a" stroke="${k}" stroke-width="10" stroke-linejoin="round"/>
  <!-- queue fourchue -->
  <path d="M 140 20 C 220 30 230 -40 196 -70" fill="none" stroke="${k}" stroke-width="20" stroke-linecap="round"/>
  <path d="M 140 20 C 220 30 230 -40 196 -70" fill="none" stroke="#e8291c" stroke-width="9" stroke-linecap="round"/>
  <path d="M 196 -70 L 168 -96 L 222 -112 L 208 -70 Z" fill="#e8291c" stroke="${k}" stroke-width="8" stroke-linejoin="round"/>
  <!-- roues -->
  <circle cx="-56" cy="92" r="26" fill="#2d3436" stroke="${k}" stroke-width="10"/>
  <circle cx="84" cy="92" r="26" fill="#2d3436" stroke="${k}" stroke-width="10"/>
  <circle cx="-56" cy="92" r="8" fill="#ffd23a"/><circle cx="84" cy="92" r="8" fill="#ffd23a"/>
  <!-- étiquette promo -->
  <g transform="translate(-196 -40) rotate(-18)">
    <path d="M 0 0 L 96 0 L 96 46 L 0 46 L -22 23 Z" fill="#ffd23a" stroke="${k}" stroke-width="7" stroke-linejoin="round"/>
    <circle cx="-6" cy="23" r="6" fill="${k}"/>
    ${(() => {
      const w = word('-66%', 8, 37, 30, { tracking: -1 });
      return w.glyphs.map((g) => `<path d="${g.d}" fill="#e8291c"/>`).join('');
    })()}
  </g>
</g>`;
}

function defs() {
  return `<defs>
  <linearGradient id="cream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf4"/><stop offset="1" stop-color="#ffe3a3"/></linearGradient>
  <linearGradient id="fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe45c"/><stop offset="0.45" stop-color="#ffa21c"/><stop offset="1" stop-color="#e8291c"/></linearGradient>
  <linearGradient id="fireV" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e8291c"/><stop offset="0.55" stop-color="#ff8a1c"/><stop offset="1" stop-color="#ffe45c"/></linearGradient>
  <linearGradient id="ribbon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8291c"/><stop offset="1" stop-color="#a5150b"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.55" r="0.55"><stop offset="0" stop-color="#ff7a1a" stop-opacity="0.55"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
</defs>`;
}

function buildLogo() {
  const W = 1600;
  const H = 1080;
  const size = 300;
  const tr = -6;
  const w1w = measure('BAZAR', size, tr);
  const x1 = 760 - w1w / 2 - 60;
  const w1 = word('BAZAR', x1, 470, size, { tracking: tr, rot: [-5, 3, -3, 4, -4], dy: [0, -10, 6, -6, 4] });
  const x2 = x1 + 150;
  const w2 = word('BAZAR', x2, 770, size, { tracking: tr, rot: [4, -3, 5, -2, 3], dy: [-4, 6, -8, 4, -2] });
  // flammes d'arrière-plan
  let flames = '';
  const fl = [
    [250, 820, 170, 380, -30], [430, 790, 200, 520, 20], [640, 800, 230, 610, -10], [860, 790, 240, 660, 25],
    [1080, 800, 220, 560, -20], [1270, 820, 190, 450, 15], [1420, 840, 150, 330, -15],
  ];
  fl.forEach(([x, y, w, h, l], i) => (flames += `<path class="flame f${i % 3}" d="${flame(x, y, w, h, l)}" fill="url(#fireV)" stroke="#120402" stroke-width="10" stroke-linejoin="round"/>`));
  let inner = '';
  fl.forEach(([x, y, w, h, l], i) => (inner += `<path class="flame-in f${(i + 1) % 3}" d="${flame(x + 6, y - 20, w * 0.5, h * 0.55, l * 0.6)}" fill="#ffe45c" opacity="0.9"/>`));
  // bannière courbe
  const cx = 800;
  const cy = 2600;
  const R = 1780;
  const bw = 1180;
  const a0 = -bw / 2 / R;
  const a1 = bw / 2 / R;
  const pt = (a, r) => `${(cx + Math.sin(a) * r).toFixed(1)} ${(cy - Math.cos(a) * r).toFixed(1)}`;
  const top = R + 62;
  const bot = R - 62;
  const ribbon = `M ${pt(a0, top)} A ${top} ${top} 0 0 1 ${pt(a1, top)} L ${pt(a1, bot)} A ${bot} ${bot} 0 0 0 ${pt(a0, bot)} Z`;
  const tailL = `M ${pt(a0 + 0.02, top - 20)} L ${pt(a0 - 0.07, top - 6)} L ${pt(a0 - 0.045, R)} L ${pt(a0 - 0.075, bot - 14)} L ${pt(a0 + 0.02, bot - 30)} Z`;
  const tailR = `M ${pt(a1 - 0.02, top - 20)} L ${pt(a1 + 0.07, top - 6)} L ${pt(a1 + 0.045, R)} L ${pt(a1 + 0.075, bot - 14)} L ${pt(a1 - 0.02, bot - 30)} Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t">
<title id="t">BAZAR BAZAR : la supérette de l'enfer</title>
${defs()}
<ellipse cx="800" cy="560" rx="760" ry="470" fill="url(#glow)"/>
<g id="flames">${flames}${inner}</g>
<g id="words" transform="rotate(-5 800 600)">
${renderWord(w1, { fill: 'url(#cream)', extrude: '#7a0f0a', id: 'w1' })}
${renderWord(w2, { fill: 'url(#fire)', extrude: '#5c0905', id: 'w2' })}
</g>
${devilCart(1300, 250, 1.05, 12)}
<g id="sparkles">
${sparkle(230, 300, 34, '#ffe45c')}${sparkle(1440, 560, 26, '#fff8e7')}${sparkle(320, 650, 20, '#fff8e7')}${sparkle(1180, 860, 22, '#ffe45c')}
</g>
<g id="banner">
<path d="${tailL}" fill="#7a0f0a" stroke="#120402" stroke-width="12" stroke-linejoin="round"/>
<path d="${tailR}" fill="#7a0f0a" stroke="#120402" stroke-width="12" stroke-linejoin="round"/>
<path d="${ribbon}" fill="url(#ribbon)" stroke="#120402" stroke-width="14" stroke-linejoin="round"/>
<path d="M ${pt(a0 + 0.01, top - 14)} A ${top - 14} ${top - 14} 0 0 1 ${pt(a1 - 0.01, top - 14)}" fill="none" stroke="#ff6b5c" stroke-width="5" opacity="0.8"/>
${arcText("LA SUPÉRETTE DE L'ENFER", cx, cy, R - 4, 84, 3, '#fff8e7')}
</g>
</svg>`;
  return svg;
}

function buildIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${defs()}
<rect x="16" y="16" width="480" height="480" rx="110" fill="#1a0604"/>
<rect x="28" y="28" width="456" height="456" rx="100" fill="url(#ribbon)"/>
<circle cx="256" cy="300" r="190" fill="url(#glow)"/>
${devilCart(250, 270, 1.0, 0)}
</svg>`;
  return svg;
}

const out = path.join(root, 'public/brand');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bazar-bazar-logo.svg'), buildLogo());
fs.writeFileSync(path.join(out, 'bazar-bazar-icon.svg'), buildIcon());
console.log('Logo généré :', path.join(out, 'bazar-bazar-logo.svg'));
