/** Logo personnalisable du magasin du joueur (dessiné sur canvas, utilisé sur l'enseigne, les sacs, l'UI). */
import type { LogoConfig } from '../sim/state';
import { css } from './textures';

export function drawLogoIcon(x: CanvasRenderingContext2D, icon: string, cx: number, cy: number, r: number, fg: string, accent: string) {
  x.save();
  x.translate(cx, cy);
  x.fillStyle = fg;
  x.strokeStyle = fg;
  x.lineJoin = 'round';
  x.lineCap = 'round';
  const s = r / 50;
  x.scale(s, s);
  switch (icon) {
    case 'cart':
    case 'devil': {
      x.lineWidth = 7;
      x.beginPath();
      x.moveTo(-40, -26);
      x.lineTo(-28, -26);
      x.lineTo(-18, 14);
      x.lineTo(26, 14);
      x.lineTo(34, -14);
      x.lineTo(-24, -14);
      x.stroke();
      x.beginPath();
      x.arc(-12, 26, 7, 0, Math.PI * 2);
      x.arc(20, 26, 7, 0, Math.PI * 2);
      x.fill();
      if (icon === 'devil') {
        x.fillStyle = accent;
        x.beginPath();
        x.moveTo(-14, -16);
        x.quadraticCurveTo(-22, -38, -8, -46);
        x.quadraticCurveTo(-12, -30, -4, -18);
        x.fill();
        x.beginPath();
        x.moveTo(20, -16);
        x.quadraticCurveTo(28, -38, 14, -46);
        x.quadraticCurveTo(18, -30, 10, -18);
        x.fill();
        x.strokeStyle = accent;
        x.lineWidth = 4;
        x.beginPath();
        x.moveTo(34, 10);
        x.quadraticCurveTo(52, 14, 44, 32);
        x.stroke();
        x.beginPath();
        x.moveTo(44, 32);
        x.lineTo(38, 26);
        x.lineTo(50, 26);
        x.closePath();
        x.fill();
      }
      break;
    }
    case 'flame':
      x.beginPath();
      x.moveTo(0, -46);
      x.bezierCurveTo(30, -10, 36, 10, 24, 30);
      x.bezierCurveTo(14, 46, -14, 46, -24, 30);
      x.bezierCurveTo(-34, 12, -20, -6, -8, -16);
      x.bezierCurveTo(-6, -4, 0, 2, 4, 4);
      x.bezierCurveTo(8, -12, 4, -30, 0, -46);
      x.fill();
      x.fillStyle = accent;
      x.beginPath();
      x.ellipse(0, 24, 10, 16, 0, 0, Math.PI * 2);
      x.fill();
      break;
    case 'star':
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 20 : 46;
        x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      x.closePath();
      x.fill();
      break;
    case 'bag':
      x.fillRect(-30, -16, 60, 54);
      x.lineWidth = 6;
      x.beginPath();
      x.arc(0, -16, 16, Math.PI, 0);
      x.stroke();
      x.fillStyle = accent;
      x.fillRect(-30, 4, 60, 8);
      break;
    case 'basket':
      x.lineWidth = 6;
      x.beginPath();
      x.arc(0, -4, 30, Math.PI, 0);
      x.stroke();
      x.beginPath();
      x.moveTo(-42, -4);
      x.lineTo(42, -4);
      x.lineTo(30, 36);
      x.lineTo(-30, 36);
      x.closePath();
      x.fill();
      x.strokeStyle = accent;
      x.lineWidth = 4;
      for (let i = -2; i <= 2; i++) {
        x.beginPath();
        x.moveTo(i * 14, 2);
        x.lineTo(i * 11, 32);
        x.stroke();
      }
      break;
    case 'crown':
      x.beginPath();
      x.moveTo(-40, 26);
      x.lineTo(-44, -24);
      x.lineTo(-20, 0);
      x.lineTo(0, -34);
      x.lineTo(20, 0);
      x.lineTo(44, -24);
      x.lineTo(40, 26);
      x.closePath();
      x.fill();
      x.fillStyle = accent;
      for (const px of [-44, 0, 44]) {
        x.beginPath();
        x.arc(px, px === 0 ? -38 : -28, 6, 0, Math.PI * 2);
        x.fill();
      }
      break;
    case 'bolt':
      x.beginPath();
      x.moveTo(8, -46);
      x.lineTo(-26, 6);
      x.lineTo(-2, 6);
      x.lineTo(-10, 46);
      x.lineTo(26, -8);
      x.lineTo(2, -8);
      x.closePath();
      x.fill();
      break;
    case 'heart':
      x.beginPath();
      x.moveTo(0, 40);
      x.bezierCurveTo(-60, 0, -30, -46, 0, -18);
      x.bezierCurveTo(30, -46, 60, 0, 0, 40);
      x.fill();
      break;
    case 'leaf':
      x.beginPath();
      x.moveTo(-34, 34);
      x.bezierCurveTo(-40, -30, 10, -46, 40, -40);
      x.bezierCurveTo(40, 0, 10, 40, -34, 34);
      x.fill();
      x.strokeStyle = accent;
      x.lineWidth = 4;
      x.beginPath();
      x.moveTo(-34, 34);
      x.lineTo(30, -30);
      x.stroke();
      break;
  }
  x.restore();
}

/** Dessine le logo complet (fond + icône) dans un canvas carré. */
export function drawLogo(x: CanvasRenderingContext2D, logo: LogoConfig, size: number) {
  const bg = css(logo.bg);
  const fg = css(logo.fg);
  const ac = css(logo.accent);
  x.clearRect(0, 0, size, size);
  const c = size / 2;
  x.fillStyle = bg;
  x.strokeStyle = ac;
  x.lineWidth = size * 0.05;
  x.beginPath();
  if (logo.shape === 'rond') x.arc(c, c, size * 0.46, 0, Math.PI * 2);
  else if (logo.shape === 'carre') x.roundRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.16);
  else if (logo.shape === 'blason') {
    x.moveTo(size * 0.1, size * 0.08);
    x.lineTo(size * 0.9, size * 0.08);
    x.lineTo(size * 0.88, size * 0.55);
    x.quadraticCurveTo(size * 0.8, size * 0.85, c, size * 0.95);
    x.quadraticCurveTo(size * 0.2, size * 0.85, size * 0.12, size * 0.55);
    x.closePath();
  } else {
    // étiquette de prix
    x.moveTo(size * 0.3, size * 0.08);
    x.lineTo(size * 0.92, size * 0.08);
    x.lineTo(size * 0.92, size * 0.92);
    x.lineTo(size * 0.3, size * 0.92);
    x.lineTo(size * 0.06, c);
    x.closePath();
  }
  x.fill();
  x.stroke();
  if (logo.shape === 'etiquette') {
    x.fillStyle = ac;
    x.beginPath();
    x.arc(size * 0.24, c, size * 0.05, 0, Math.PI * 2);
    x.fill();
  }
  drawLogoIcon(x, logo.icon, logo.shape === 'etiquette' ? size * 0.6 : c, c, size * 0.33, fg, ac);
}

export function logoCanvas(logo: LogoConfig, size = 256): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawLogo(c.getContext('2d')!, logo, size);
  return c;
}

export function logoDataUrl(logo: LogoConfig, size = 128): string {
  return logoCanvas(logo, size)?.toDataURL() ?? '';
}
