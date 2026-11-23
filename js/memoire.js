import * as THREE from 'three';
// Mémoire sur téléphone (l'auteur, 23/11 : sur iPhone Safari coupe la page, « problème récurrent »).
// Le décor d'une route pèse des centaines de Mo de sommets : three.js les garde en mémoire du programme ET sur la carte graphique.
// Sur un appareil tactile, une fois les données envoyées à la carte graphique, on libère la copie du programme.
// À appeler seulement sur le DÉCOR construit par buildWorld (jamais sur les personnages : characters.js relit leurs sommets).
// Limite : si le navigateur perd le contexte graphique (retour d'une autre application), le décor ne peut plus être renvoyé : la page se recharge.
export const MOBILE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !new URLSearchParams(globalThis.location?.search ?? '').has('memoire0');

/** Normales (octets signés) et couleurs (octets) au lieu de nombres à virgule : 18 octets par sommet au lieu de 36 pour position + normale + couleur. */
export function quantize(g) {
  if (g.userData._q || g.index === undefined) return;
  g.userData._q = true;
  const nor = g.attributes.normal, col = g.attributes.color;
  if (nor?.array instanceof Float32Array && !nor.isInterleavedBufferAttribute && nor.itemSize === 3) {
    const a = nor.array, o = new Int8Array(a.length);
    for (let i = 0; i < a.length; i++) o[i] = Math.round(a[i] * 127);
    g.setAttribute('normal', new THREE.BufferAttribute(o, 3, true));
  }
  if (col?.array instanceof Float32Array && !col.isInterleavedBufferAttribute && col.itemSize === 3) {
    const a = col.array; let ok = true;
    for (let i = 0; i < a.length; i++) if (a[i] > 1.001 || a[i] < 0) { ok = false; break; }
    if (ok) { const o = new Uint8Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.round(a[i] * 255); g.setAttribute('color', new THREE.BufferAttribute(o, 3, true)); }
  }
}
/** Décor d'une route en construction : chaque objet ajouté à `root` est réduit tout de suite (sinon le pic de mémoire pendant la construction reste énorme). */
export function watchScene(root) {
  if (!MOBILE || !root || root.userData._watched) return;
  root.userData._watched = true;
  const add = root.add.bind(root);
  root.add = (...objs) => {
    for (const ob of objs) ob?.traverse?.(o => { const g = o.geometry; if (g && !o.isSkinnedMesh && !o.isInstancedMesh && !g.morphAttributes?.position) quantize(g); });
    return add(...objs);
  };
}

export function releaseCpuCopies(root) {
  if (!MOBILE || !root) return 0;
  if (root.userData._watched) { delete root.add; root.userData._watched = false; }   // (fin de la construction : plus de réduction à l'ajout, pour ne pas toucher aux personnages ni aux véhicules)
  let n = 0;
  root.traverse(o => {
    const g = o.geometry;
    if (!g || g.userData._freed || o.isSkinnedMesh || o.isInstancedMesh || g.morphAttributes?.position) return;
    quantize(g);
    const attrs = Object.values(g.attributes);
    if (!attrs.length || attrs.some(a => a.isInterleavedBufferAttribute || !a.array)) return;
    g.computeBoundingSphere();                        // (le rendu en a besoin pour ne pas dessiner hors de l'écran ; Box3.setFromObject aussi)
    g.computeBoundingBox();
    g.userData._freed = true;
    for (const a of [...attrs, g.index].filter(Boolean)) a.onUpload(function () { this.array = null; });
    n++;
  });
  return n;
}
