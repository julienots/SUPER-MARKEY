/** Mini-utilitaire DOM (pas de framework : interface légère et réactive). */
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, any> | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Space: 'Espace', ShiftLeft: 'Maj', ShiftRight: 'Maj D', Escape: 'Échap', Tab: 'Tab', ControlLeft: 'Ctrl', Enter: 'Entrée', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Mouse0: 'Clic' };
  return map[code] ?? code;
}

export function modal(title: string, body: HTMLElement | HTMLElement[], buttons: { label: string; primary?: boolean; danger?: boolean; onClick?: () => void | boolean }[] = [{ label: 'Fermer' }], opts: { onClose?: () => void; width?: string } = {}): () => void {
  const root = document.getElementById('ui')!;
  const close = () => {
    back.remove();
    opts.onClose?.();
  };
  const back = h(
    'div',
    { class: 'modal-back', onmousedown: (e: MouseEvent) => e.target === back && close() },
    h(
      'div',
      { class: 'panel modal', style: opts.width ? { width: opts.width } : undefined, role: 'dialog', 'aria-label': title },
      h('h2', null, title),
      ...(Array.isArray(body) ? body : [body]),
      h(
        'div',
        { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px', flexWrap: 'wrap' } },
        buttons.map((b) =>
          h('button', { class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, onclick: () => (b.onClick?.() === false ? null : close()) }, b.label),
        ),
      ),
    ),
  );
  root.append(back);
  (back.querySelector('.btn') as HTMLElement | null)?.focus();
  return close;
}
