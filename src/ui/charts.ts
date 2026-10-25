/** Graphiques canvas légers (courbes et barres) pour la tablette. */
export interface Series {
  label: string;
  color: string;
  values: number[];
  type?: 'line' | 'bar';
}

export function chart(series: Series[], labels: string[], opts: { height?: number; money?: boolean } = {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'chart';
  const draw = () => {
    const w = c.clientWidth || 520;
    const hgt = opts.height ?? 170;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = hgt * dpr;
    c.style.height = `${hgt}px`;
    const x = c.getContext('2d')!;
    x.scale(dpr, dpr);
    const padL = 46;
    const padB = 22;
    const padT = 18;
    const all = series.flatMap((s) => s.values);
    const max = Math.max(1, ...all);
    const min = Math.min(0, ...all);
    const n = Math.max(1, labels.length);
    const X = (i: number) => padL + ((w - padL - 8) * (i + 0.5)) / n;
    const Y = (v: number) => padT + (hgt - padT - padB) * (1 - (v - min) / (max - min || 1));
    x.font = '11px Nunito, sans-serif';
    x.fillStyle = 'rgba(255,255,255,0.45)';
    x.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let k = 0; k <= 4; k++) {
      const v = min + ((max - min) * k) / 4;
      const y = Y(v);
      x.beginPath();
      x.moveTo(padL, y);
      x.lineTo(w - 4, y);
      x.stroke();
      x.fillText(opts.money ? `${Math.round(v)}€` : String(Math.round(v)), 4, y + 4);
    }
    labels.forEach((l, i) => {
      if (n > 14 && i % 2) return;
      x.fillText(l, X(i) - 8, hgt - 6);
    });
    const bars = series.filter((s) => s.type === 'bar');
    const bw = ((w - padL - 8) / n) * 0.7 / Math.max(1, bars.length);
    bars.forEach((s, si) => {
      x.fillStyle = s.color;
      s.values.forEach((v, i) => {
        const x0 = X(i) - (bw * bars.length) / 2 + si * bw;
        x.fillRect(x0, Math.min(Y(v), Y(0)), bw - 1, Math.abs(Y(v) - Y(0)));
      });
    });
    for (const s of series.filter((q) => q.type !== 'bar')) {
      x.strokeStyle = s.color;
      x.lineWidth = 2.2;
      x.beginPath();
      s.values.forEach((v, i) => (i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v))));
      x.stroke();
      x.fillStyle = s.color;
      s.values.forEach((v, i) => {
        x.beginPath();
        x.arc(X(i), Y(v), 2.5, 0, Math.PI * 2);
        x.fill();
      });
    }
    let lx = padL;
    for (const s of series) {
      x.fillStyle = s.color;
      x.fillRect(lx, 4, 10, 8);
      x.fillStyle = 'rgba(255,255,255,0.75)';
      x.fillText(s.label, lx + 14, 12);
      lx += x.measureText(s.label).width + 30;
    }
  };
  requestAnimationFrame(draw);
  return c;
}
