// Personnages 3D articulés, générés dans le code (aucun fichier externe, aucun droit d'image).
// Chaque personnage est un SkinnedMesh (un seul appel de dessin) avec un squelette simple
// et des animations procédurales : marche, attente, signe de la main, assis, bassine sur la tête.
// Le même modèle peut être « figé » dans une pose et fusionné dans le décor (vendeurs assis).
import * as THREE from 'three';

// ---------- Squelette (pose de référence, mètres, face vers -Z, droite = +X) ----------
const BONES = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.2, 0]],
  ['neck', 'chest', [0, 0.24, 0]],
  ['head', 'neck', [0, 0.08, 0]],
  ['upperArm.L', 'chest', [-0.2, 0.2, 0]],
  ['foreArm.L', 'upperArm.L', [0, -0.28, 0]],
  ['upperArm.R', 'chest', [0.2, 0.2, 0]],
  ['foreArm.R', 'upperArm.R', [0, -0.28, 0]],
  ['thigh.L', 'hips', [-0.1, -0.04, 0]],
  ['shin.L', 'thigh.L', [0, -0.43, 0]],
  ['thigh.R', 'hips', [0.1, -0.04, 0]],
  ['shin.R', 'thigh.R', [0, -0.43, 0]],
];
const BI = Object.fromEntries(BONES.map(([n], i) => [n, i]));

// Position de référence (monde du personnage) de chaque os
const REST = [];
BONES.forEach(([, parent, off], i) => {
  const p = parent ? REST[BI[parent]] : [0, 0, 0];
  REST[i] = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
});

// ---------- Palettes ----------
const SKIN = [0x4a2e1a, 0x5a3a22, 0x6b4428, 0x3d2614];
const HAIR = 0x14100c;
const SHIRTS = [0xffffff, 0xd9480f, 0x1d4fa0, 0x2b8a3e, 0xe0a100, 0x7b2cbf, 0xc2185b, 0x00838f, 0x9e9e9e, 0x1a1a1a];
const PANTS = [0x23262b, 0x2f3e57, 0x5b4a3a, 0x3b3b3b, 0x1f3a2a, 0xc9b28a];
const PAGNES = [0xc8102e, 0x1d6fd1, 0xf28c28, 0x2b8a3e, 0x6a1b9a, 0xe0a100, 0x00838f, 0xd81b60];
const SHOES = [0x1a1a1a, 0x5d4330, 0xe8e8e8, 0x1d4fa0];
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------- Géométrie ----------
const _c = new THREE.Color();
function colored(geo, color, bone) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  _c.set(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    si[i * 4] = bone; sw[i * 4] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}

/** Description des pièces d'un personnage : chaque pièce est rattachée à un os (coordonnées locales à l'os). */
function parts(o, low = false) {
  const P = [];
  const add = (bone, geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0) => {
    geo.scale(sx, sy, sz);
    if (rx) geo.rotateX(rx);
    geo.translate(x, y, z);
    P.push({ bone: BI[bone], geo, color });
  };
  // low : version allégée pour les personnages figés dans le décor
  const cap = (r, l, seg = 6) => new THREE.CapsuleGeometry(r, l, low ? 1 : 2, low ? 4 : seg);
  const legCol = o.dress ? o.skin : o.pants;
  const gx = o.girth, gz = 0.72 * Math.sqrt(o.girth);       // corpulence : plus large que profond
  // bassin, ventre, buste (le ventre suit la corpulence)
  // buste d'une seule pièce (profil tourné) : taille, ventre, poitrine, épaules, en deux morceaux
  // pour que les épaules puissent tourner à contre-temps des hanches
  const belly = (o.girth - 1) * 0.06, waist = o.female ? 0.118 : 0.126;
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), low ? 6 : seg);
  const hipW = o.female ? 0.162 : 0.15;
  add('hips', lathe([[0.001, -0.2], [0.11, -0.19], [hipW, -0.1], [hipW, -0.02], [0.13, 0.05], [0.118, 0.08]], 12),
    o.dress ? o.pagne : o.pants, 0, 0, 0, gx, 1, gz * 1.04);
  add('spine', lathe([[0.128, -0.13], [0.132 + belly * 0.6, -0.03], [waist + belly, 0.05], [0.134 + belly * 0.5, 0.13], [0.146, 0.18]], 12),
    o.shirt, 0, 0, 0, gx, 1, gz * 0.95);
  add('chest', lathe([[0.14, -0.07], [0.158, 0.03], [o.female ? 0.162 : 0.172, 0.12], [0.168, 0.17], [0.148, 0.212], [0.096, 0.245], [0.062, 0.258], [0.001, 0.26]], 12),
    o.shirt, 0, 0, 0, 0.5 + gx / 2, 1, 0.68 * (0.5 + gx / 2));
  if (o.female && !low) add('chest', new THREE.SphereGeometry(0.085, 8, 5), o.shirt, 0, 0.1, -0.055, 1.6, 0.75, 0.6);
  if (!low) {
    // épaules arrondies : évite la jointure « robot » entre buste et bras
    for (const sx of [-1, 1]) add('chest', new THREE.SphereGeometry(0.062, 7, 5), o.shirt, sx * 0.175, 0.185, 0, 1, 0.85, 1);
    // chemise portée par-dessus le pantalon
    if (o.untucked) add('hips', new THREE.CylinderGeometry(0.15, 0.17, 0.15, 10, 1, true), o.shirt, 0, 0.04, 0, gx * 1.02, 1, gz * 0.98);
    // haut en pagne assorti : liseré de la 2e couleur
    if (o.pagneTop) add('chest', new THREE.CylinderGeometry(0.172, 0.172, 0.035, 10, 1, true), o.pagne2, 0, -0.02, 0, 1.1 * (0.5 + gx / 2), 1, 0.72 * (0.5 + gx / 2));
  }
  add('neck', new THREE.CylinderGeometry(0.055, 0.062, 0.13, low ? 4 : 7), o.skin, 0, 0.02, 0);
  // tête : crâne, mâchoire, nez, oreilles, yeux
  add('head', new THREE.SphereGeometry(0.115, low ? 6 : 12, low ? 5 : 9), o.skin, 0, 0.11, 0, 0.9, 1.08, 1);
  if (!low) {
    add('head', new THREE.SphereGeometry(0.08, 8, 5), o.skin, 0, 0.05, -0.03, 1.05, 0.8, 1);                 // mâchoire
    add('head', new THREE.SphereGeometry(0.024, 6, 4), o.skin, 0, 0.1, -0.112, 1.15, 0.9, 1);                // nez
    for (const sx of [-1, 1]) {
      add('head', new THREE.SphereGeometry(0.028, 5, 4), o.skin, sx * 0.104, 0.1, 0.005, 0.5, 1, 0.8);      // oreille
      add('head', new THREE.SphereGeometry(0.017, 6, 4), 0xeee8dc, sx * 0.038, 0.128, -0.1, 1.2, 0.8, 0.6);  // blanc de l'œil
      add('head', new THREE.SphereGeometry(0.01, 5, 3), 0x16110c, sx * 0.038, 0.128, -0.11);                // pupille
    }
    if (o.beard) add('head', new THREE.SphereGeometry(0.075, 7, 4, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), HAIR, 0, 0.065, -0.035, 1.1, 0.9, 1.05);
  }
  if (o.beret) {                                               // le béret noir de la police
    add('head', new THREE.SphereGeometry(0.135, low ? 6 : 9, low ? 4 : 5), o.beret, 0.015, 0.205, 0.005, 1.05, 0.42, 1.08);
    if (!low) add('head', new THREE.SphereGeometry(0.018, 5, 3), 0xc9a227, -0.055, 0.2, -0.115);
  } else if (o.headwrap) {
    add('head', new THREE.SphereGeometry(0.13, low ? 5 : 9, low ? 3 : 6, 0, Math.PI * 2, 0, Math.PI * 0.55), o.headwrap, 0, 0.13, 0.01, 1, 1.15, 1.05);
    add('head', new THREE.SphereGeometry(0.065, 6, 4), o.headwrap, 0, 0.27, 0.03, 1.2, 0.9, 1);
    if (!low) add('head', new THREE.SphereGeometry(0.05, 6, 4), o.headwrap, 0.07, 0.25, 0.02, 1.2, 0.8, 1);  // nœud du foulard
  } else if (o.cap) {
    add('head', new THREE.SphereGeometry(0.122, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), o.cap, 0, 0.13, 0);
    add('head', new THREE.BoxGeometry(0.18, 0.02, 0.1), o.cap, 0, 0.14, -0.13);
  } else if (o.hair !== 'bald') {
    add('head', new THREE.SphereGeometry(0.12, low ? 5 : 9, low ? 3 : 5, 0, Math.PI * 2, 0, Math.PI * (o.hair === 'short' ? 0.42 : 0.5)), HAIR, 0, 0.125, 0.012);
    if (o.hair === 'bun') add('head', new THREE.SphereGeometry(0.065, 6, 4), HAIR, 0, 0.23, 0.07);
    if (o.hair === 'braids' && !low) add('head', new THREE.BoxGeometry(0.2, 0.2, 0.05), HAIR, 0, 0.02, 0.085);
  }
  if (o.basin) {
    add('head', new THREE.CylinderGeometry(0.3, 0.2, 0.14, 10), o.basin, 0, 0.3, 0);
    add('head', new THREE.SphereGeometry(0.24, 6, 4), o.goods, 0, 0.38, 0, 1, 0.45, 1);
  }
  // bras : manche + avant-bras + main (un peu plus épais si corpulent)
  const ag = Math.sqrt(o.girth);
  for (const s of ['L', 'R']) {
    if (o.longSleeves || low) add(`upperArm.${s}`, cap(0.052 * ag, 0.18, 6), o.shirt, 0, -0.13, 0);
    else {                                                     // manche courte, bras nu dessous
      add(`upperArm.${s}`, cap(0.056 * ag, 0.08, 6), o.shirt, 0, -0.07, 0);
      add(`upperArm.${s}`, cap(0.046 * ag, 0.15, 6), o.skin, 0, -0.15, 0);
    }
    add(`foreArm.${s}`, cap(0.044 * ag, 0.17, 6), o.longSleeves ? o.shirt : o.skin, 0, -0.12, 0);
    if (!low) add(`foreArm.${s}`, new THREE.SphereGeometry(0.048, 6, 4), o.skin, 0, -0.275, -0.01, 0.75, 1.3, 0.9);
  }
  if (o.vest) {                                                // le gilet orange du roulage, ses bandes grises et son ceinturon noir
    add('chest', new THREE.CylinderGeometry(0.178, 0.168, 0.42, low ? 6 : 10, 1, true), o.vest, 0, 0.03, 0, 0.5 + gx / 2, 1, 0.72 * (0.5 + gx / 2));
    for (const y of [0.11, -0.07]) add('chest', new THREE.CylinderGeometry(0.182, 0.176, 0.035, low ? 6 : 10, 1, true), 0xb8bcc0, 0, y, 0, 0.5 + gx / 2, 1, 0.72 * (0.5 + gx / 2));
    add('hips', new THREE.CylinderGeometry(0.17, 0.17, 0.06, low ? 6 : 10, 1, true), 0x101114, 0, 0.09, 0, gx, 1, gz);
  }
  if (o.beret && !low) {                                       // l'uniforme de près : col, épaulettes, écussons, poches, ceinturon, boucle, insigne de poitrine
    add('chest', new THREE.CylinderGeometry(0.075, 0.1, 0.05, 10, 1, true), 0x101a30, 0, 0.245, 0, 1, 1, 0.92);
    for (const sx of [-1, 1]) {
      add('chest', new THREE.BoxGeometry(0.1, 0.012, 0.075), 0x0d1626, sx * 0.135, 0.226, 0, 1, 1, 1);
      add('chest', new THREE.BoxGeometry(0.085, 0.075, 0.012), 0x1e2f52, sx * 0.08, 0.095, -0.118 * (0.5 + gx / 2));
      add('chest', new THREE.BoxGeometry(0.09, 0.022, 0.016), 0x101a30, sx * 0.08, 0.135, -0.12 * (0.5 + gx / 2));
    }
    for (const s of ['L', 'R']) add(`upperArm.${s}`, new THREE.BoxGeometry(0.01, 0.075, 0.06), 0xb8902a, s === 'L' ? -0.056 : 0.056, -0.09, 0);
    add('chest', new THREE.BoxGeometry(0.035, 0.035, 0.012), 0xc9a227, 0.08, 0.1, -0.125 * (0.5 + gx / 2));
    if (!o.vest) add('hips', new THREE.CylinderGeometry(0.168, 0.168, 0.055, 10, 1, true), 0x0c0d10, 0, 0.09, 0, gx, 1, gz);
    add('hips', new THREE.BoxGeometry(0.05, 0.04, 0.015), 0xc9a227, 0, 0.09, -0.125 * gz);
  }
  if (o.gloves) for (const s of ['L', 'R']) add(`foreArm.${s}`, new THREE.SphereGeometry(0.056, low ? 5 : 6, 4), 0xf4f4f0, 0, -0.27, -0.01, 0.8, 1.3, 0.95);
  if (o.bag) add('foreArm.R', new THREE.BoxGeometry(0.25, 0.3, 0.1), o.bag, 0.04, -0.42, 0);
  if (o.phone && !low) add('foreArm.R', new THREE.BoxGeometry(0.03, 0.13, 0.065), 0x111111, 0, -0.3, -0.03);
  // jambes
  for (const s of ['L', 'R']) {
    add(`thigh.${s}`, cap(0.078 * ag, 0.3, 7), legCol, 0, -0.21, 0);
    add(`shin.${s}`, cap(0.058, 0.3, 6), legCol, 0, -0.2, 0);
    if (o.sandals) {
      add(`shin.${s}`, new THREE.BoxGeometry(0.085, 0.05, 0.22), o.skin, 0, -0.4, -0.05);
      add(`shin.${s}`, new THREE.BoxGeometry(0.1, 0.025, 0.25), o.shoes, 0, -0.435, -0.05);
    } else add(`shin.${s}`, new THREE.BoxGeometry(0.1, 0.07, 0.24), o.shoes, 0, -0.41, -0.05);
  }
  // pagne (jupe longue) : cône rattaché au bassin, avec bandes de motif dans la 2e couleur
  if (o.dress) {
    const sx = Math.max(1, o.girth), sz = 0.9 * Math.max(1, o.girth);
    add('hips', new THREE.CylinderGeometry(0.19, 0.3, 0.74, low ? 6 : 12, 1, true), o.pagne, 0, -0.38, 0, sx, 1, sz);
    add('hips', new THREE.CylinderGeometry(0.288, 0.297, 0.07, low ? 6 : 12, 1, true), o.pagne2, 0, -0.66, 0, sx, 1, sz);
    if (!low) add('hips', new THREE.CylinderGeometry(0.234, 0.24, 0.05, 12, 1, true), o.pagne2, 0, -0.3, 0, sx, 1, sz);
  }
  return P;
}

const rnd = (a, b) => a + Math.random() * (b - a);
/** Couleur de tissu un peu passée ou plus vive : deux tenues ne sont jamais identiques. */
function worn(c) { return _c.set(c).multiplyScalar(rnd(0.82, 1.05)).getHex(); }

/** Tire au sort une tenue et une silhouette. kind : 'woman' | 'man' | 'student' | 'business' | 'traveler' | 'vendor'. */
export function outfit(kind = Math.random() < 0.5 ? 'woman' : 'man', extra = {}) {
  const female = kind === 'woman' || kind === 'vendor';
  const pagne = pick(PAGNES);
  let pagne2 = pick(PAGNES);
  if (pagne2 === pagne) pagne2 = 0xf2e6c8;
  const o = {
    kind, female,
    skin: pick(SKIN), shirt: worn(pick(SHIRTS)), pants: worn(pick(PANTS)), shoes: pick(SHOES),
    pagne: worn(pagne), pagne2, dress: female && Math.random() < 0.8,
    headwrap: female && Math.random() < 0.5 ? pick(PAGNES) : null,
    cap: !female && Math.random() < 0.25 ? pick([0xd62828, 0x1a1a1a, 0xffffff, 0x1d4fa0]) : null,
    hair: female ? pick(['bun', 'braids', 'short']) : pick(['short', 'short', 'short', 'bald']),
    beard: !female && Math.random() < 0.3,
    basin: null, goods: pick([0xe0a100, 0xc92a2a, 0x2b8a3e, 0x7a4b2a]),
    bag: null, longSleeves: false, phone: false,
    untucked: !female && Math.random() < 0.6,
    sandals: Math.random() < 0.35,
    // silhouette et manière de bouger
    height: female ? rnd(0.93, 1.02) : rnd(0.95, 1.07),
    girth: female ? rnd(0.92, 1.3) : rnd(0.9, 1.2),
    stride: rnd(0.85, 1.15),
    idle: Math.floor(Math.random() * 4),       // 0 bras le long du corps, 1 mains sur les hanches, 2 bras croisés, 3 téléphone
  };
  o.pagneTop = o.dress && Math.random() < 0.55;  // ensemble pagne : haut et jupe du même tissu
  if (o.pagneTop) o.shirt = o.pagne;
  if (o.sandals) o.shoes = pick([0x1a1a1a, 0x1d4fa0, 0xd62828, 0x5d4330]);
  if (kind === 'business') Object.assign(o, { shirt: 0xf2f2f2, pants: 0x23262b, longSleeves: true, bag: 0x3b2a1a, shoes: 0x111111, sandals: false, untucked: false });
  if (kind === 'student') Object.assign(o, { shirt: 0xffffff, pants: 0x1d3557, bag: 0x2b2b2b, height: rnd(0.9, 1), girth: rnd(0.88, 1.02) });
  if (kind === 'traveler') Object.assign(o, { bag: pick([0x1a1a1a, 0xc92a2a, 0x1d4fa0]), longSleeves: true, sandals: false });
  if (kind === 'police' || kind === 'roulage') {               // uniforme bleu nuit, béret noir (photos du dossier Acteurs)
    const fem = Math.random() < 0.35;
    Object.assign(o, { female: fem, dress: false, pagneTop: false, headwrap: null, cap: null, basin: null, bag: null, beard: false, hair: 'short', untucked: false, sandals: false, longSleeves: true,
      shirt: 0x16233f, pants: 0x16233f, shoes: 0x0c0d10, beret: 0x111318, idle: kind === 'roulage' ? 0 : pick([0, 1, 2]), height: rnd(0.97, 1.05), girth: rnd(0.95, 1.2) });
    if (kind === 'roulage') Object.assign(o, { vest: 0xee6a1c, gloves: true });
  }
  o.phone = o.idle === 3 && !o.bag;
  return Object.assign(o, extra);
}

const MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Personnage animé : détaillé de près, version allégée au-delà de 30 m (même squelette). */
export class Character {
  constructor(o = outfit()) {
    this.outfit = o;
    this.bones = BONES.map(([name, parent, off]) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.fromArray(off);
      return b;
    });
    BONES.forEach(([, parent], i) => { if (parent) this.bones[BI[parent]].add(this.bones[i]); });
    this.mesh = new THREE.LOD();
    this.mesh.add(this.bones[0]);
    this.mesh.scale.setScalar(o.height ?? 1);
    this.mesh.updateMatrixWorld(true);              // les inverses du squelette se calculent sur la pose de référence
    const skeleton = new THREE.Skeleton(this.bones);
    for (const [low, dist] of [[false, 0], [true, 30]]) {
      const m = new THREE.SkinnedMesh(mergeParts(parts(o, low), true), MATERIAL);
      this.mesh.addLevel(m, dist);
      m.updateMatrixWorld(true);
      m.bind(skeleton);
      m.castShadow = true;
      // Volume englobant fixe (les os bougent, mais restent dans cette sphère)
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
    }
    this.b = Object.fromEntries(BONES.map(([n], i) => [n, this.bones[i]]));
    this.phase = Math.random() * 10;
    this.pose('idle', 0);
  }

  /** Un outil tenu dans la main droite (pelle, panneau) : un maillage accroché à l'avant-bras, qui suit l'animation. */
  hold(mesh) { this.b['foreArm.R'].add(mesh); mesh.position.set(0, -0.3, 0); return mesh; }
  /** Applique une animation. mode : 'walk' | 'idle' | 'wave' | 'sit'. t en secondes, speed en m/s. */
  pose(mode, t, speed = 1.1) {
    applyPose(this.b, mode, t + this.phase, speed, this.outfit);
  }
}

function mergeParts(list, skinned) {
  const geos = list.map(p => {
    const g = p.geo;
    if (skinned) g.translate(...REST[p.bone]);
    return colored(g, p.color, p.bone);
  });
  const merged = mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  return merged;
}

/** Fusion simple (positions, normales, uv, couleurs, skin) sans dépendance externe. */
function mergeGeometries(geos) {
  const names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'];
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const first = geos[0].attributes[name];
    if (!first) continue;
    const total = geos.reduce((n, g) => n + g.attributes[name].array.length, 0);
    const arr = new first.array.constructor(total);
    let off = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, first.itemSize));
  }
  return out;
}

/**
 * Animations procédurales. Ce qui évite l'effet « robot » : le bassin monte, descend et bascule,
 * le poids passe d'une jambe à l'autre, les épaules tournent à l'inverse des hanches, les coudes
 * ne sont jamais tendus, la tête regarde autour d'elle, et chacun a son allure (o.stride, o.idle).
 */
function applyPose(b, mode, t, speed, o) {
  for (const k in b) b[k].rotation.set(0, 0, 0);
  b.hips.position.set(0, 0.95, 0);
  const st = o.stride ?? 1, idle = o.idle ?? 0;
  const lookY = Math.sin(t * 0.37) * 0.45 + Math.sin(t * 1.13) * 0.12;   // regard qui erre
  const breath = Math.sin(t * 1.7);

  if (mode === 'walk') {
    const w = t * speed * 5.2, s = Math.sin(w), c = Math.cos(w);
    const amp = 0.34 * st * Math.min(1.3, speed / 1.1) * (o.dress ? 0.6 : 1);   // le pagne serré raccourcit le pas
    const sway = o.female ? 1.6 : 1;
    b['thigh.L'].rotation.x = s * amp + 0.05;
    b['thigh.R'].rotation.x = -s * amp + 0.05;
    // genou plié pendant que la jambe revient vers l'avant, presque tendu à l'appui
    b['shin.L'].rotation.x = -(0.08 + Math.max(0, c) * 0.85 * st);
    b['shin.R'].rotation.x = -(0.08 + Math.max(0, -c) * 0.85 * st);
    b.hips.position.y = 0.925 + 0.035 * c * c;                 // plus haut au passage de la jambe
    b.hips.position.x = c * 0.022 * sway;                      // transfert du poids
    b.hips.rotation.y = s * 0.12 * st;
    b.hips.rotation.z = -c * 0.045 * sway;
    b['thigh.L'].rotation.z = c * 0.045 * sway;
    b['thigh.R'].rotation.z = c * 0.045 * sway;
    b.spine.rotation.x = 0.04 + speed * 0.025;                 // légèrement penché vers l'avant
    b.spine.rotation.z = c * 0.035 * sway;
    b.chest.rotation.y = -s * 0.22 * st;                       // épaules à contre-temps des hanches
    b.head.rotation.y = s * 0.1 * st + lookY * 0.25;
    b.head.rotation.x = -0.04;
    b['upperArm.L'].rotation.set(-s * 0.4 * st, 0, -0.1);
    b['upperArm.R'].rotation.set(s * 0.4 * st, 0, 0.1);
    b['foreArm.L'].rotation.x = 0.22 + Math.max(0, -s) * 0.45;   // le coude se plie quand le bras passe devant
    b['foreArm.R'].rotation.x = 0.22 + Math.max(0, s) * 0.45;
  } else if (mode === 'run') {
    // Course d'athlète / footing : foulée ample, genoux hauts, rebond vertical, buste penché en avant et coudes pliés à 90°
    const w = t * speed * 3.8, s = Math.sin(w), c = Math.cos(w);
    const amp = 0.68 * st;
    b['thigh.L'].rotation.x = s * amp + 0.14;
    b['thigh.R'].rotation.x = -s * amp + 0.14;
    b['shin.L'].rotation.x = -(0.28 + Math.max(0, c) * 1.22 * st);
    b['shin.R'].rotation.x = -(0.28 + Math.max(0, -c) * 1.22 * st);
    b.hips.position.y = 0.90 + Math.abs(s) * 0.068;
    b.hips.position.x = c * 0.025;
    b.hips.rotation.y = s * 0.18 * st;
    b.hips.rotation.z = -c * 0.05;
    b.spine.rotation.x = 0.18;
    b.chest.rotation.y = -s * 0.28 * st;
    b.head.rotation.y = s * 0.08;
    b.head.rotation.x = -0.08;
    b['upperArm.L'].rotation.set(-s * 0.78 * st + 0.1, 0, -0.14);
    b['upperArm.R'].rotation.set(s * 0.78 * st + 0.1, 0, 0.14);
    b['foreArm.L'].rotation.x = 1.28 + Math.max(0, -s) * 0.35;
    b['foreArm.R'].rotation.x = 1.28 + Math.max(0, s) * 0.35;
  } else if (mode === 'fight') {
    // bagarre (contrôle de police qui tourne mal) : jambes écartées, genoux pliés, les bras poussent et frappent tour à tour
    const w = t * 7, pL = Math.max(0, Math.sin(w)), pR = Math.max(0, Math.sin(w + Math.PI));
    b.hips.position.y = 0.89;
    b['thigh.L'].rotation.set(0.35, 0, -0.12);
    b['thigh.R'].rotation.set(-0.22, 0, 0.12);
    b['shin.L'].rotation.x = -0.45;
    b['shin.R'].rotation.x = -0.25;
    b.spine.rotation.x = 0.18;
    b.chest.rotation.y = (pL - pR) * 0.35;
    b.head.rotation.x = 0.05;
    b['upperArm.L'].rotation.set(0.9 + pL * 0.7, 0, -0.15);
    b['upperArm.R'].rotation.set(0.9 + pR * 0.7, 0, 0.15);
    b['foreArm.L'].rotation.x = 1.3 - pL * 1.1;
    b['foreArm.R'].rotation.x = 1.3 - pR * 1.1;
  } else if (mode === 'sit') {
    b.hips.position.y = 0.48;
    b['thigh.L'].rotation.set(1.45, 0, -0.18);
    b['thigh.R'].rotation.set(1.45, 0, 0.18);
    b['shin.L'].rotation.x = -1.35;
    b['shin.R'].rotation.x = -1.55;
    b.spine.rotation.x = 0.16 + breath * 0.01;
    b.head.rotation.y = lookY;
    b.head.rotation.x = Math.sin(t * 0.21) * 0.1;
    if (idle % 2) {                                            // coudes sur les genoux
      b['upperArm.L'].rotation.set(0.75, 0, -0.1);
      b['upperArm.R'].rotation.set(0.75, 0, 0.1);
      b['foreArm.L'].rotation.set(0.85, 0, 0.35);
      b['foreArm.R'].rotation.set(0.85, 0, -0.35);
    } else {                                                   // mains sur les cuisses
      b['upperArm.L'].rotation.set(0.45, 0, -0.08);
      b['upperArm.R'].rotation.set(0.45, 0, 0.08);
      b['foreArm.L'].rotation.x = 0.95;
      b['foreArm.R'].rotation.x = 0.95;
    }
  } else if (mode === 'dig') {
    // creuser (l'auteur, 13/11 : les ouvriers du chantier) : penché, la pelle plonge et remonte
    const w = t * 2.4, s = Math.sin(w), up = Math.max(0, s);
    b.hips.position.y = 0.9;
    b['thigh.L'].rotation.set(0.35, 0, -0.12); b['thigh.R'].rotation.set(-0.15, 0, 0.12);
    b['shin.L'].rotation.x = -0.45; b['shin.R'].rotation.x = -0.2;
    b.spine.rotation.x = 0.55 - up * 0.3;
    b.chest.rotation.y = s * 0.15;
    b.head.rotation.x = 0.25;
    b['upperArm.L'].rotation.set(1.1 - up * 0.6, 0, -0.1); b['upperArm.R'].rotation.set(0.9 - up * 0.7, 0, 0.15);
    b['foreArm.L'].rotation.x = 0.4; b['foreArm.R'].rotation.x = 0.5;
  } else if (mode === 'flag') {
    // faire signe avec le panneau rouge et vert : le bras droit levé, le gauche qui fait ralentir
    const w = Math.sin(t * 1.6);
    b['upperArm.R'].rotation.set(0.2, 0, 2.3); b['foreArm.R'].rotation.set(0, 0, 0.3);
    b['upperArm.L'].rotation.set(0.9 + w * 0.35, 0, -0.3); b['foreArm.L'].rotation.x = 0.4;
    b.head.rotation.y = 0.2 * w;
  } else if (mode === 'climb') {
    // enjamber (l'auteur, 13/11 : les piétons sautent la bordure, enjambent le séparateur) : genoux hauts, buste penché, bras qui s'aident
    const w = t * 4.2, s = Math.sin(w);
    b.hips.position.y = 0.92;
    b['thigh.L'].rotation.x = 0.2 + Math.max(0, s) * 1.25;
    b['thigh.R'].rotation.x = 0.2 + Math.max(0, -s) * 1.25;
    b['shin.L'].rotation.x = -(0.25 + Math.max(0, s) * 1.35);
    b['shin.R'].rotation.x = -(0.25 + Math.max(0, -s) * 1.35);
    b.spine.rotation.x = 0.3;
    b.head.rotation.x = 0.2;
    b['upperArm.L'].rotation.set(0.55 + Math.max(0, -s) * 0.4, 0, -0.3);
    b['upperArm.R'].rotation.set(0.55 + Math.max(0, s) * 0.4, 0, 0.3);
    b['foreArm.L'].rotation.x = 0.7;
    b['foreArm.R'].rotation.x = 0.7;
  } else if (mode === 'preach') {
    // prédicateur du bus (l'auteur, 10/11) : debout dans l'allée, la Bible contre la poitrine dans la main gauche, le bras droit qui
    // monte et redescend au rythme de la parole, le buste tourné vers les passagers d'un côté puis de l'autre
    const sway = Math.sin(t * 0.9), beat = Math.sin(t * 2.6), up = Math.max(0, beat);
    b.hips.position.y = 0.95;
    b['thigh.L'].rotation.z = -0.1;
    b['thigh.R'].rotation.z = 0.1;
    b.spine.rotation.x = 0.06;
    b.chest.rotation.y = sway * 0.35;
    b.head.rotation.y = sway * 0.25;
    b.head.rotation.x = -0.08 + beat * 0.05;
    b['upperArm.L'].rotation.set(1.05, 0, -0.1);
    b['foreArm.L'].rotation.set(1.65, 0, 0.5);
    b['upperArm.R'].rotation.set(1.9 + up * 0.9, 0, 0.35);
    b['foreArm.R'].rotation.set(0.5 - up * 0.3, 0, 0);
  } else {
    // debout (attente ou signe au taxi) : le poids passe lentement d'une jambe à l'autre
    const sh = Math.sin(t * 0.31) * 0.7 + Math.sin(t * 0.13 + 1) * 0.3;
    b.hips.position.x = sh * 0.035;
    b.hips.position.y = 0.95 - Math.abs(sh) * 0.012;
    b.hips.rotation.z = sh * 0.05;
    b['thigh.L'].rotation.z = b['thigh.R'].rotation.z = -sh * 0.09;
    const relaxL = Math.max(0, sh), relaxR = Math.max(0, -sh);  // la jambe libre plie le genou
    b['thigh.L'].rotation.x = relaxL * 0.14;
    b['shin.L'].rotation.x = -relaxL * 0.28;
    b['thigh.R'].rotation.x = relaxR * 0.14;
    b['shin.R'].rotation.x = -relaxR * 0.28;
    b.spine.rotation.z = -sh * 0.065;
    b.chest.rotation.x = breath * 0.015;
    b.head.rotation.y = lookY;
    b.head.rotation.x = Math.sin(t * 0.29) * 0.08 - 0.02;
    // bras selon l'habitude de chacun
    if (idle === 1) {                                          // mains sur les hanches
      b['upperArm.L'].rotation.set(-0.25, 0, -0.65);
      b['upperArm.R'].rotation.set(-0.25, 0, 0.65);
      b['foreArm.L'].rotation.z = 1.75;
      b['foreArm.R'].rotation.z = -1.75;
    } else if (idle === 2) {                                   // bras croisés
      b['upperArm.L'].rotation.set(0.4, 0, -0.12);
      b['upperArm.R'].rotation.set(0.42, 0, 0.12);
      b['foreArm.L'].rotation.set(1.35, 0, 0.95);
      b['foreArm.R'].rotation.set(1.3, 0, -0.95);
    } else if (idle === 3 && o.phone) {                        // au téléphone
      b['upperArm.L'].rotation.set(0.05, 0, -0.1);
      b['foreArm.L'].rotation.x = 0.2;
      b['upperArm.R'].rotation.set(0.35, 0, 0.75);
      b['foreArm.R'].rotation.set(2.35, 0, -0.55);
      b.head.rotation.z = 0.12;
      b.head.rotation.y *= 0.4;
    } else {                                                   // bras relâchés, coudes souples
      b['upperArm.L'].rotation.set(0.04 + breath * 0.02, 0, -0.11);
      b['upperArm.R'].rotation.set(0.04 + breath * 0.02, 0, 0.11);
      b['foreArm.L'].rotation.x = 0.18;
      b['foreArm.R'].rotation.x = 0.18;
    }
    if (mode === 'wave') {
      // héler un taxi : le bras se tend vers la chaussée et la main bat de haut en bas
      b.spine.rotation.x = 0.07;
      b.head.rotation.y = 0.25 + Math.sin(t * 0.6) * 0.2;
      b.head.rotation.x = 0;
      if (idle % 2) {
        b['upperArm.R'].rotation.set(1.2 + Math.sin(t * 5) * 0.12, 0, 0.3);
        b['foreArm.R'].rotation.set(0.15 + Math.sin(t * 5 + 0.6) * 0.3, 0, 0);
      } else {                                                 // bras levé, grand signe
        b['upperArm.R'].rotation.set(0.25, 0, 2.45);
        b['foreArm.R'].rotation.set(0, 0, 0.35 + Math.sin(t * 6.5) * 0.45);
      }
    }
  }
  if (o.cuffed && mode !== 'climb') {                          // (arrêté par la police : les mains dans le dos, la tête basse)
    b['upperArm.L'].rotation.set(-0.45, 0, 0.18);
    b['upperArm.R'].rotation.set(-0.45, 0, -0.18);
    b['foreArm.L'].rotation.set(1.2, 0.35, 0);
    b['foreArm.R'].rotation.set(1.2, -0.35, 0);
    b.head.rotation.x = 0.3;
    b.head.rotation.y *= 0.3;
    return;
  }
  if (o.basin && mode !== 'wave' && mode !== 'sit') {          // une main tient la bassine
    b['upperArm.L'].rotation.set(0, 0, -2.75);
    b['foreArm.L'].rotation.set(0, 0, -0.35);
    b.head.rotation.set(0, 0, 0);                              // la tête reste droite sous la charge
  }
}

/** Les mêmes animations sur un squelette venu d'un fichier (mêmes noms d'os, sans rotation au repos). */
export const poseBones = (bones, mode, t, speed, o) => applyPose(bones, mode, t, speed, o);

// ---------- Version figée (fusionnée dans le décor) ----------
const _bones = BONES.map(([name, , off]) => { const o = new THREE.Object3D(); o.name = name; o.position.fromArray(off); return o; });
BONES.forEach(([, parent], i) => { if (parent) _bones[BI[parent]].add(_bones[i]); });
const _root = new THREE.Object3D();
_root.add(_bones[0]);
const _b = Object.fromEntries(BONES.map(([n], i) => [n, _bones[i]]));
const _m = new THREE.Matrix4();

/**
 * Ajoute à un Builder (models.js) un personnage figé dans une pose, placé en (x, z) et tourné de ry.
 * Utilisé pour les vendeurs assis et les foules statiques : pas de squelette, coût minimal.
 */
export function bakeCharacter(builder, o, mode, x, z, ry = 0, t = Math.random() * 10, low = false) {
  applyPose(_b, mode, t, 1, o);
  _root.position.set(x, 0, z);
  _root.rotation.set(0, ry, 0);
  _root.scale.setScalar(o.height ?? 1);
  _root.updateMatrixWorld(true);
  for (const p of parts(o, low)) {
    p.geo.applyMatrix4(_m.copy(_bones[p.bone].matrixWorld));
    builder.addRaw(p.geo, p.color);
  }
}
