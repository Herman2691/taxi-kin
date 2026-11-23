// Mémoire sur téléphone (l'auteur, 23/11 : sur iPhone Safari coupe la page, « problème récurrent »).
// Le décor d'une route pèse des centaines de Mo de sommets : three.js les garde en mémoire du programme ET sur la carte graphique.
// Sur un appareil tactile, une fois les données envoyées à la carte graphique, on libère la copie du programme.
// À appeler seulement sur le DÉCOR construit par buildWorld (jamais sur les personnages : characters.js relit leurs sommets).
// Limite : si le navigateur perd le contexte graphique (retour d'une autre application), le décor ne peut plus être renvoyé : la page se recharge.
export const MOBILE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !new URLSearchParams(globalThis.location?.search ?? '').has('memoire0');

export function releaseCpuCopies(root) {
  if (!MOBILE || !root) return 0;
  let n = 0;
  root.traverse(o => {
    const g = o.geometry;
    if (!g || g.userData._freed || o.isSkinnedMesh || o.isInstancedMesh || g.morphAttributes?.position) return;
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
