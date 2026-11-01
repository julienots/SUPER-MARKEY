/**
 * Images de l'interface : produits et icônes en 3D (Microsoft Fluent Emoji 3D, licence MIT),
 * redimensionnées dans public/products et public/ui.
 */
const BASE = (import.meta.env?.BASE_URL ?? './').replace(/\/?$/, '/');

/** Image d'un produit à vendre. */
export const productImage = (pid: string) => `${BASE}products/${pid}.webp`;

/** Icône de l'interface (cart, truck, team, build, menu, box, money, star, lock…). */
export const uiIcon = (name: string) => `${BASE}ui/${name}.webp`;

/** Image d'icône prête à insérer. */
export function iconImg(name: string, size = 28, cls = 'ico'): HTMLImageElement {
  const im = document.createElement('img');
  im.src = uiIcon(name);
  im.alt = '';
  im.className = cls;
  im.width = size;
  im.height = size;
  im.draggable = false;
  return im;
}
