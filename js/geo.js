// Outils de géométrie partagés (une seule copie du module, même pour les routes attachées).
import * as THREE from 'three';

/**
 * Comme BufferGeometry.toNonIndexed(), mais par boucles sur les tableaux typés : celui de three lit chaque sommet par getX/getY/getZ, ce qui coûtait
 * environ 3 s au chargement (chaque boîte du décor et chaque personnage figé passent par là). Même résultat : attributs dépliés suivant l'index, groupes conservés.
 */
export function nonIndexed(geo) {
  const index = geo.index;
  if (!index) return geo;
  const names = Object.keys(geo.attributes);
  if (Object.keys(geo.morphAttributes).length || names.some(n => geo.attributes[n].isInterleavedBufferAttribute)) return geo.toNonIndexed();   // (cas rares : version de three)
  const idx = index.array, n = idx.length, out = new THREE.BufferGeometry();
  for (const name of names) {
    const a = geo.attributes[name], size = a.itemSize, src = a.array, dst = new src.constructor(n * size);
    if (size === 3) for (let i = 0, d = 0; i < n; i++, d += 3) { const s = idx[i] * 3; dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; }
    else if (size === 2) for (let i = 0, d = 0; i < n; i++, d += 2) { const s = idx[i] * 2; dst[d] = src[s]; dst[d + 1] = src[s + 1]; }
    else for (let i = 0; i < n; i++) { const s = idx[i] * size, d = i * size; for (let k = 0; k < size; k++) dst[d + k] = src[s + k]; }
    out.setAttribute(name, new THREE.BufferAttribute(dst, size, a.normalized));
  }
  for (const g of geo.groups) out.addGroup(g.start, g.count, g.materialIndex);
  return out;
}
