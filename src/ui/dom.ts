/** Petit utilitaire de création d'éléments. */
type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any> | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className = v;
      else if (k in el && k !== 'list') (el as any)[k] = v;
      else el.setAttribute(k, String(v));
    }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export const img = (src: string, cls = 'ico') => h('img', { src, class: cls, alt: '', draggable: false });
export const uiIcon = (name: string, cls = 'ico') => img(`./ui/${name}.webp`, cls);
export const prodIcon = (pid: string, cls = 'ico') => img(`./products/${pid}.webp`, cls);

export const euro = (v: number, dec = false) =>
  (dec ? v.toFixed(2).replace('.', ',') : Math.round(v).toLocaleString('fr-FR')).replace(/ | /g, ' ') + ' €';

export const clock = (min: number) => {
  const m = Math.floor(min) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
