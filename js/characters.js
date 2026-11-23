// Personnages 3D articulés, générés dans le code (aucun fichier externe, aucun droit d'image).
// Chaque personnage est un SkinnedMesh (un seul appel de dessin) avec un squelette simple
// et des animations procédurales : marche, attente, signe de la main, assis, bassine sur la tête.
// Le même modèle peut être « figé » dans une pose et fusionné dans le décor (vendeurs assis).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { nonIndexed } from './geo.js';
const __mark = n => { if (location.search.includes('mesure')) console.log(`MESURE ${String(Math.round(performance.now())).padStart(6)} ms  ${n}`); };

// ---------- Modèles MakeHuman (tools/personnages_mh.py → data/personnages/*.glb) ----------
// Un fichier par modèle : un squelette de 13 os (mêmes noms que ci-dessous), un maillage détaillé (lod0) et un très allégé (lod1), une texture atlas
// et, par sommet, une « zone » (peau, haut, bas, chaussures, cheveux...) qui sert à donner ses couleurs à chaque personnage. Si un fichier manque,
// le personnage retombe sur l'ancien corps dessiné par le code.
const MODEL_FILES = ['homme', 'femme', 'policier', 'policiere', 'garcon', 'fille', 'femme_nue'];
const MODELS = {};
const ZONE_SKIN = 0, ZONE_TOP = 1, ZONE_BOTTOM = 2, ZONE_SHOES = 3, ZONE_HAIR = 4, ZONE_EYES = 5, ZONE_CLOTH = 6, ZONE_BELT = 7;
// teinte des cheveux : les textures de MakeHuman sont des bruns clairs, les cheveux d'ici sont presque noirs
const HAIR_TINT = { homme: 0x6a625a, femme: 0x4a4440, policier: 0x555048, policiere: 0xffffff, garcon: 0x6a625a, fille: 0xffffff, femme_nue: 0xffffff };
function readModel(name, g) {
  const byName = {};
  const lods = [];
  g.scene.traverse(o => {
    if (o.isBone) byName[o.name.replace(/([LR])$/, '.$1')] = o;       // (le chargeur retire le point : upperArm.L → upperArmL)
    if (o.isSkinnedMesh) lods[+o.name.slice(-1)] = o;
  });
  const offsets = BONES.map(([n]) => byName[n].position.toArray());
  const rest = [];
  BONES.forEach(([, parent], i) => { const p = parent ? rest[BI[parent]] : [0, 0, 0]; rest[i] = [p[0] + offsets[i][0], p[1] + offsets[i][1], p[2] + offsets[i][2]]; });
  const map = lods[0].material.map;
  const material = new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.4 });
  // accessoires : où poser béret, foulard, bassine, gilet... sur ce corps (le code les a dessinés pour l'ancien corps : tête de 0,25 m, buste de 0,17 m de demi-largeur)
  const ex = g.scene.userData || {};
  const hs = (ex.headTop - ex.headMinY) / 0.25;
  const headJ = rest[BI.head], chestJ = rest[BI.chest];
  const csx = ex.chestHalfX / 0.17, csz = ex.chestHalfZ / 0.12;
  const fit = {
    head: { s: hs, y0: 0.11, y1: (ex.headTop + ex.headMinY) / 2 - headJ[1], dz: ex.headZ - headJ[2] },
    chest: { sx: csx, sz: csz, dz: ex.chestZ - chestJ[2] },
    hips: { sx: csx * 0.95, sz: csz * 0.95, dz: 0 },
    'foreArm.L': { dy: -0.07 }, 'foreArm.R': { dy: -0.07 },
  };
  return { name, offsets, rest, geos: lods.map(m => m.geometry), material, fit, hair: HAIR_TINT[name] ?? 0xffffff };
}

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

__mark('personnages : début du chargement des modèles');
const _gltfLoader = new GLTFLoader();
await Promise.all(MODEL_FILES.map(async name => {
  try {
    const g = await _gltfLoader.loadAsync(new URL(`../data/personnages/${name}.glb`, import.meta.url).href);
    MODELS[name] = readModel(name, g);
  } catch (e) { console.warn('personnage', name, 'absent, ancien corps gardé', e); }
}));
__mark('personnages : modèles chargés');

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
  const g = geo.index ? nonIndexed(geo) : geo;
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
function parts(o, low = false, legacy = false) {
  const P = [];
  // avec un modèle MakeHuman, le corps, le visage, les cheveux, les bras et les jambes viennent du fichier : ici, seulement ce qui s'ajoute
  // (béret, foulard, bassine, gilet, sac, pagne...), posé selon les mesures du modèle
  const M = legacy ? null : MODELS[o.model];
  const add = (bone, geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0) => {
    geo.scale(sx, sy, sz);
    if (rx) geo.rotateX(rx);
    const f = M && M.fit[bone];
    if (f) {
      const fx = f.s ?? f.sx ?? 1, fy = f.s ?? 1, fz = f.s ?? f.sz ?? 1;
      geo.scale(fx, fy, fz);
      x = x * fx; y = (y - (f.y0 ?? 0)) * fy + (f.y1 ?? 0) + (f.dy ?? 0); z = z * fz + (f.dz ?? 0);
    }
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
  if (!M) {
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
  }
  if (o.helmet && o.helmetFull) {                              // casque de motard : calotte arrondie et visière sombre relevée
    add('head', new THREE.SphereGeometry(0.15, low ? 6 : 10, low ? 4 : 7, 0, Math.PI * 2, 0, Math.PI * 0.62), o.helmet, 0, 0.115, 0.01, 1, 1.02, 1.1);
    add('head', new THREE.BoxGeometry(0.22, 0.05, 0.05), 0x14161a, 0, 0.16, -0.155, 1, 1, 1, 0.25);
  } else if (o.helmet) {                                       // le casque jaune des agents de roulage (photos du dossier Herman)
    add('head', new THREE.SphereGeometry(0.133, low ? 6 : 10, low ? 4 : 6, 0, Math.PI * 2, 0, Math.PI * 0.5), o.helmet, 0, 0.14, 0.005, 1, 1.05, 1.08);
    add('head', new THREE.BoxGeometry(0.2, 0.015, 0.075), o.helmet, 0, 0.145, -0.135);
    if (!low) add('head', new THREE.BoxGeometry(0.03, 0.012, 0.2), o.helmet === 0xf2c200 ? 0xe8c000 : 0xee6a1c, 0, 0.268, 0);
  } else if (o.beret) {                                        // le béret noir de la police
    add('head', new THREE.SphereGeometry(0.135, low ? 6 : 9, low ? 4 : 5), o.beret, 0.015, 0.205, 0.005, 1.05, 0.42, 1.08);
    if (!low) add('head', new THREE.SphereGeometry(0.018, 5, 3), 0xc9a227, -0.055, 0.2, -0.115);
  } else if (o.headwrap) {
    add('head', new THREE.SphereGeometry(0.13, low ? 5 : 9, low ? 3 : 6, 0, Math.PI * 2, 0, Math.PI * 0.55), o.headwrap, 0, 0.13, 0.01, 1, 1.15, 1.05);
    add('head', new THREE.SphereGeometry(0.065, 6, 4), o.headwrap, 0, 0.27, 0.03, 1.2, 0.9, 1);
    if (!low) add('head', new THREE.SphereGeometry(0.05, 6, 4), o.headwrap, 0.07, 0.25, 0.02, 1.2, 0.8, 1);  // nœud du foulard
  } else if (o.cap) {
    add('head', new THREE.SphereGeometry(0.122, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), o.cap, 0, 0.13, 0);
    add('head', new THREE.BoxGeometry(0.18, 0.02, 0.1), o.cap, 0, 0.14, -0.13);
  } else if (o.hair !== 'bald' && !M) {
    add('head', new THREE.SphereGeometry(0.12, low ? 5 : 9, low ? 3 : 5, 0, Math.PI * 2, 0, Math.PI * (o.hair === 'short' ? 0.42 : 0.5)), HAIR, 0, 0.125, 0.012);
    if (o.hair === 'bun') add('head', new THREE.SphereGeometry(0.065, 6, 4), HAIR, 0, 0.23, 0.07);
    if (o.hair === 'braids' && !low) add('head', new THREE.BoxGeometry(0.2, 0.2, 0.05), HAIR, 0, 0.02, 0.085);
  }
  if (o.basin) {
    add('head', new THREE.CylinderGeometry(0.3, 0.2, 0.14, 10), o.basin, 0, 0.3, 0);
    add('head', new THREE.SphereGeometry(0.24, 6, 4), o.goods, 0, 0.38, 0, 1, 0.45, 1);
  }
  const ag = Math.sqrt(o.girth);
  if (!M) for (const s of ['L', 'R']) {
    if (o.longSleeves || low) add(`upperArm.${s}`, cap(0.052 * ag, 0.18, 6), o.shirt, 0, -0.13, 0);
    else {                                                     // manche courte, bras nu dessous
      add(`upperArm.${s}`, cap(0.056 * ag, 0.08, 6), o.shirt, 0, -0.07, 0);
      add(`upperArm.${s}`, cap(0.046 * ag, 0.15, 6), o.skin, 0, -0.15, 0);
    }
    add(`foreArm.${s}`, cap(0.044 * ag, 0.17, 6), o.longSleeves ? o.shirt : o.skin, 0, -0.12, 0);
    if (!low) add(`foreArm.${s}`, new THREE.SphereGeometry(0.048, 6, 4), o.skin, 0, -0.275, -0.01, 0.75, 1.3, 0.9);
  }
  if (o.vest) {
    const kx = (0.5 + gx / 2) * (o.vestK ?? 1);                 // (vestK : gilet plus ajusté sur un buste mince)                                                // le gilet orange du roulage, ses bandes grises et son ceinturon noir
    add('chest', new THREE.CylinderGeometry(0.2, 0.19, 0.42, low ? 6 : 10, 1, true), o.vest, 0, 0.03, 0, kx, 1, 0.92 * kx);
    for (const y of o.vestRings === 1 ? [0] : [0.11, -0.07]) add('chest', new THREE.CylinderGeometry(0.204, 0.198, 0.035, low ? 6 : 10, 1, true), 0xb8bcc0, 0, y, 0, kx, 1, 0.92 * kx);
    add('hips', new THREE.CylinderGeometry(0.17, 0.17, 0.06, low ? 6 : 10, 1, true), 0x101114, 0, 0.09, 0, gx, 1, gz);
    // bandes verticales grises sur le devant du gilet (le dos n'en a pas, d'après les photos), posées sur la surface du gilet
    const vx = 0.085 * kx, vz = 0.204 * 0.92 * kx * Math.sqrt(1 - (vx / (0.204 * kx)) ** 2) + 0.002;
    for (const sx of [-1, 1]) add('chest', new THREE.BoxGeometry(0.014, 0.4, 0.008), 0xb8bcc0, sx * vx, 0.03, -vz);
    if (!low && o.id) {                                          // numéro d'identification de l'agent, petit, imprimé en noir en haut du dos (4 chiffres)
      const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
      const k = o.idScale ?? 1, W = 0.018 * k, H = 0.036 * k, T = 0.005 * k, D = 0.005, gap = 0.027 * k, n = String(o.id).length;
      [...String(o.id)].forEach((ch, i) => {
        const cx = (i - (n - 1) / 2) * gap * kx, cz = 0.204 * 0.92 * kx * Math.sqrt(1 - (cx / (0.204 * kx)) ** 2) + 0.003, cy = 0.16;
        for (const sg of SEG[ch]) {
          const hor = 'adg'.includes(sg), up = 'abf'.includes(sg), right = 'bc'.includes(sg);
          const geo = hor ? new THREE.BoxGeometry(W, T, D) : new THREE.BoxGeometry(T, H / 2, D);
          const dy = hor ? (sg === 'a' ? H / 2 : sg === 'd' ? -H / 2 : 0) : (up ? H / 4 : -H / 4);
          add('chest', geo, 0x0b0b0e, cx + (hor ? 0 : (right ? W / 2 : -W / 2)), cy + dy, cz);
        }
      });
    }
  }
  if ((o.beret || o.helmet) && !o.civil && !low) {                         // l'uniforme de près : col, épaulettes, écussons, poches, ceinturon, boucle, insigne de poitrine
    add('chest', new THREE.CylinderGeometry(0.075, 0.1, 0.05, 10, 1, true), 0x101a30, 0, 0.245, 0, 1, 1, 0.92);
    for (const sx of [-1, 1]) {
      add('chest', new THREE.BoxGeometry(0.1, 0.012, 0.075), 0x0d1626, sx * 0.135, 0.226, 0, 1, 1, 1);
      if (o.vest) continue;                                    // (sous le gilet, les poches ne se voient pas)
      add('chest', new THREE.BoxGeometry(0.085, 0.075, 0.012), 0x1e2f52, sx * 0.08, 0.095, -0.118 * (0.5 + gx / 2));
      add('chest', new THREE.BoxGeometry(0.09, 0.022, 0.016), 0x101a30, sx * 0.08, 0.135, -0.12 * (0.5 + gx / 2));
    }
    for (const s of ['L', 'R']) add(`upperArm.${s}`, new THREE.BoxGeometry(0.01, 0.075, 0.06), o.vest ? 0xc8201e : 0xb8902a, s === 'L' ? -0.056 : 0.056, -0.09, 0);
    if (!o.vest) add('chest', new THREE.BoxGeometry(0.035, 0.035, 0.012), 0xc9a227, 0.08, 0.1, -0.125 * (0.5 + gx / 2));
    if (!o.vest && !M) add('hips', new THREE.CylinderGeometry(0.168, 0.168, 0.055, 10, 1, true), 0x0c0d10, 0, 0.09, 0, gx, 1, gz);
    add('hips', new THREE.BoxGeometry(0.05, 0.04, 0.015), 0xc9a227, 0, 0.09, -0.125 * gz);
  }
  if (o.gloves) for (const s of ['L', 'R']) add(`foreArm.${s}`, new THREE.SphereGeometry(0.056, low ? 5 : 6, 4), 0xf4f4f0, 0, -0.27, -0.01, 0.8, 1.3, 0.95);
  if (o.bag) add('foreArm.R', new THREE.BoxGeometry(0.25, 0.3, 0.1), o.bag, 0.04, -0.42, 0);
  if (o.phone && !low) add('foreArm.R', new THREE.BoxGeometry(0.03, 0.13, 0.065), 0x111111, 0, -0.3, -0.03);
  // jambes
  if (!M) for (const s of ['L', 'R']) {
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
/** Quel modèle MakeHuman pour cette tenue (undefined si le fichier manque : l'ancien corps est gardé). */
function pickModel(o) {
  const ok = n => MODELS[n] ? n : undefined;
  if (o.kind === 'police' || o.kind === 'roulage') return ok(o.female ? 'policiere' : 'policier');
  if (o.kind === 'student') return ok(Math.random() < 0.5 ? 'fille' : 'garcon');
  if (o.female) return ok(pick(['femme', 'femme', 'femme_nue']));
  return ok(pick(['homme', 'homme', 'garcon']));
}
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
    // roulage (photos du dossier Herman) : uniforme bleu marine, gants blancs, numéro dans le dos ; deux tenues vues sur les photos :
    // gilet orange à une bande (casque bleu clair pour les hommes, béret pour les femmes) ou gilet vert fluo à deux bandes (casque jaune)
    if (kind === 'roulage') {
      const lime = !fem && Math.random() < 0.4;
      Object.assign(o, { vest: lime ? 0xc4e11c : 0xee6a1c, vestRings: lime ? 2 : 1, gloves: true, id: 1000 + Math.floor(Math.random() * 9000),
        helmet: fem ? null : lime ? 0xf2c200 : 0x5aa6e0, beret: fem ? 0x111318 : null });
    }
  }
  o.phone = o.idle === 3 && !o.bag;
  o.skinTint = rnd(0.82, 1.12);
  o.model = pickModel(o);
  if (o.kind === 'student' && o.model === 'fille') o.female = true;
  return Object.assign(o, extra);
}

const MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });

// Short et maillot (22/11, le receveur) : sur le modèle « homme », les vêtements sont dessinés dans la texture (jean et T-shirt bleus, zone 6) ; on les repeint par sommet :
// jean (u de 0,68 à 0,855 dans l'atlas) au-dessus du genou → couleur unie (texel gris neutre × couleur), en dessous → peau nue ; reste de la zone 6 → maillot uni.
const PAINT_NEUTRAL = [0.62, 0.9], PAINT_SKIN = [0.16, 0.34], SHORT_HEM = 0.56, TEXEL_GREY = 0.2158, _paint = new Map();
function paintClothes(geo, src, o, M, low) {
  if (M.name !== 'homme' || !(o.shorts || o.paintShirt)) return;
  const key = `${low}|${o.shorts}|${o.paintShirt}|${(o.skinTint ?? 1).toFixed(2)}`;
  let P = _paint.get(key);
  if (!P) {
    const pos = src.attributes.position, zone = src.attributes._zone.array, uv = new Float32Array(src.attributes.uv.array), col = new Float32Array(zoneColors(src.attributes._zone, o, M).array);
    const flat = hex => { _c.set(hex); return [_c.r / TEXEL_GREY, _c.g / TEXEL_GREY, _c.b / TEXEL_GREY]; };
    const red = o.shorts ? flat(o.shorts) : null, tee = o.paintShirt ? flat(o.paintShirt) : null, t = o.skinTint ?? 1;
    for (let i = 0; i < pos.count; i++) {
      if (zone[i] !== ZONE_CLOTH) continue;
      const u = uv[i * 2], jeans = u >= 0.68 && u < 0.855;
      if (jeans && red) {
        if (pos.getY(i) >= SHORT_HEM) { uv[i * 2] = PAINT_NEUTRAL[0]; uv[i * 2 + 1] = PAINT_NEUTRAL[1]; col.set(red, i * 3); }
        else { uv[i * 2] = PAINT_SKIN[0]; uv[i * 2 + 1] = PAINT_SKIN[1]; col.set([t, t, t], i * 3); }
      } else if (!jeans && tee) { uv[i * 2] = PAINT_NEUTRAL[0]; uv[i * 2 + 1] = PAINT_NEUTRAL[1]; col.set(tee, i * 3); }
    }
    P = { uv: new THREE.BufferAttribute(uv, 2), color: new THREE.BufferAttribute(col, 3) };
    _paint.set(key, P);
  }
  geo.setAttribute('uv', P.uv);
  geo.setAttribute('color', P.color);
}

/** Couleur de chaque sommet d'un modèle MakeHuman selon sa zone : la texture (peau, tissu, cheveux) est multipliée par la couleur de la tenue. */
function zoneColors(zone, o, M) {
  const col = hex => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
  const t = o.skinTint ?? 1, ct = rnd(0.88, 1.08);
  const pal = [
    [t, t, t],                                            // peau
    col(o.shirt), col(o.dress ? o.pagne : o.pants), col(o.shoes),
    col(M.hair), [1, 1, 1],                               // cheveux, yeux
    [ct, ct, ct],                                         // vêtement texturé du modèle
    col(0x0c0d10),                                        // ceinturon
  ];
  const n = zone.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(pal[zone.array[i]], i * 3);
  return new THREE.BufferAttribute(c, 3);
}

/** Personnage animé : détaillé de près, version allégée au-delà de 30 m (même squelette). */
export class Character {
  constructor(o = outfit()) {
    this.outfit = o;
    const M = this.model = MODELS[o.model];
    this.bones = BONES.map(([name, parent, off], i) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.fromArray(M ? M.offsets[i] : off);
      return b;
    });
    BONES.forEach(([, parent], i) => { if (parent) this.bones[BI[parent]].add(this.bones[i]); });
    this.mesh = new THREE.LOD();
    this.mesh.add(this.bones[0]);
    const h = o.height ?? 1;
    // corpulence : le modèle MakeHuman s'élargit (le gabarit est dans le maillage, pas dans les pièces)
    if (M) this.mesh.scale.set(h * (1 + ((o.girth ?? 1) - 1) * 0.7), h, h * (1 + ((o.girth ?? 1) - 1) * 0.5)); else this.mesh.scale.setScalar(h);
    this.mesh.updateMatrixWorld(true);              // les inverses du squelette se calculent sur la pose de référence
    const skeleton = new THREE.Skeleton(this.bones);
    for (const [low, dist] of [[false, 0], [true, 30]]) {
      const list = [];
      if (M) {
        const src = M.geos[low ? 1 : 0];
        const geo = new THREE.BufferGeometry();
        for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) geo.setAttribute(k, src.attributes[k]);   // (partagés entre tous les personnages)
        geo.setIndex(src.index);
        geo.setAttribute('color', zoneColors(src.attributes._zone, o, M));
        paintClothes(geo, src, o, M, low);
        list.push(new THREE.SkinnedMesh(geo, M.material));
      }
      const extra = parts(o, low);
      if (!M || extra.length) list.push(new THREE.SkinnedMesh(mergeParts(extra, true, M ? M.rest : REST), MATERIAL));
      const holder = list.length > 1 ? new THREE.Group() : list[0];
      for (const m of list) {
        if (holder !== m) holder.add(m);
        m.updateMatrixWorld(true);
        m.bind(skeleton);
        m.castShadow = true;
        // Volume englobant fixe (les os bougent, mais restent dans cette sphère)
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
      }
      this.mesh.addLevel(holder, dist);
    }
    this.b = Object.fromEntries(BONES.map(([n], i) => [n, this.bones[i]]));
    this.phase = Math.random() * 10;
    this.pose('idle', 0);
  }

  /** Un outil tenu dans la main droite (pelle, panneau) : un maillage accroché à l'avant-bras, qui suit l'animation. */
  hold(mesh) { this.b['foreArm.R'].add(mesh); mesh.position.set(0, this.model ? -0.37 : -0.3, 0); return mesh; }
  /** Applique une animation. mode : 'walk' | 'idle' | 'wave' | 'sit'. t en secondes, speed en m/s. */
  pose(mode, t, speed = 1.1) {
    applyPose(this.b, mode, t + this.phase, speed, this.outfit);
  }
}

function mergeParts(list, skinned, rest = REST) {
  if (!list.length) return new THREE.BufferGeometry();
  const geos = list.map(p => {
    const g = p.geo;
    if (skinned) g.translate(...rest[p.bone]);
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
  } else if (mode === 'ride') {
    // à califourchon sur une moto, le bassin à l'origine (face vers -z : rotation x positive = vers l'avant) : o.ride = { arm: [haut, avant, écart], lean }
    const { arm: [au, af, sp], lean } = o.ride;
    b.hips.position.set(0, 0, 0);
    b.hips.rotation.x = lean * 0.3; b.spine.rotation.x = lean; b.chest.rotation.x = lean * 0.5; b.neck.rotation.x = -lean * 0.8; b.head.rotation.x = -lean * 0.5;
    b['thigh.L'].rotation.set(1.22, 0, -0.14); b['thigh.R'].rotation.set(1.22, 0, 0.14);
    b['shin.L'].rotation.set(-1.42, 0, 0.14); b['shin.R'].rotation.set(-1.42, 0, -0.14);
    b['upperArm.L'].rotation.set(au, 0, -sp); b['upperArm.R'].rotation.set(au, 0, sp);
    b['foreArm.L'].rotation.x = af; b['foreArm.R'].rotation.x = af;
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
    if (mode === 'call') {
      // le receveur sur le marchepied (22/11) : la main gauche tient fermement la barre de la porte (o.grip : angles calculés par solveGrip pour que la main touche la barre),
      // la main droite invite à entrer : le bras part vers la rue, puis l'avant-bras ramène la main vers la porte, paume vers le haut, en boucle
      const s = Math.sin(t * 3.6), k = 0.5 + 0.5 * s;
      b.spine.rotation.set(0.06, -0.2 + 0.1 * s, 0.03 * s);
      b.chest.rotation.y = 0.1 * s;
      b.head.rotation.y = 0.5 * Math.sin(t * 0.8);
      b.head.rotation.x = -0.05;
      b['upperArm.R'].rotation.set(0.95 + 0.25 * k, 0, 0.55 - 0.2 * k);
      b['foreArm.R'].rotation.set(0.35 + 1.25 * k, 0.5 * (1 - k), 0);
      if (o.grip) {
        b['upperArm.L'].rotation.set(o.grip[0], 0, o.grip[1]);
        b['foreArm.L'].rotation.set(o.grip[2], 0, 0);
      } else {
        b['upperArm.L'].rotation.set(0.7, 0, -0.3);
        b['foreArm.L'].rotation.set(1.25, 0, 0);
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

/**
 * Angles [épaule avant, épaule côté, coude] du bras gauche pour que la main touche `target` (dans le repère du parent du personnage, dont le maillage est déjà placé) :
 * recherche sur une grille, le moins tordu l'emporte. À donner à o.grip (pose 'call').
 */
export function solveGrip(ch, target) {
  const hand = new THREE.Object3D(), v = new THREE.Vector3(), T = new THREE.Vector3(...target), U = ch.b['upperArm.L'], F = ch.b['foreArm.L'];
  hand.position.set(0, -0.37, 0);
  F.add(hand);
  ch.mesh.updateMatrixWorld(true);
  let best = null;
  const evalAt = (x, z, f) => {
    U.rotation.set(x, 0, z); F.rotation.set(f, 0, 0);
    U.updateMatrixWorld(true);
    const cost = v.setFromMatrixPosition(hand.matrixWorld).distanceTo(T) + 0.03 * (Math.abs(z + 0.3) + Math.abs(f - 1.1));
    if (!best || cost < best[0]) best = [cost, x, z, f];
  };
  for (let x = -0.4; x <= 2.2; x += 0.25) for (let z = -1.3; z <= 0.7; z += 0.25) for (let f = 0; f <= 2.4; f += 0.25) evalAt(x, z, f);
  const [, bx, bz, bf] = best;
  const x0 = Math.max(-0.4, bx - 0.25), x1 = Math.min(2.2, bx + 0.25);
  const z0 = Math.max(-1.3, bz - 0.25), z1 = Math.min(0.7, bz + 0.25);
  const f0 = Math.max(0, bf - 0.25), f1 = Math.min(2.4, bf + 0.25);
  for (let x = x0; x <= x1 + 1e-6; x += 0.05) for (let z = z0; z <= z1 + 1e-6; z += 0.05) for (let f = f0; f <= f1 + 1e-6; f += 0.05) evalAt(x, z, f);
  F.remove(hand);
  U.rotation.set(0, 0, 0); F.rotation.set(0, 0, 0);
  return best.slice(1);
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
  if (MODELS[o.model]?.geos[2]) return bakeModelled(builder, o, mode, x, z, ry, t);
  applyPose(_b, mode, t, 1, o);
  _root.position.set(x, 0, z);
  _root.rotation.set(0, ry, 0);
  _root.scale.setScalar(o.height ?? 1);
  _root.updateMatrixWorld(true);
  for (const p of parts(o, low, true)) {
    p.geo.applyMatrix4(_m.copy(_bones[p.bone].matrixWorld));
    builder.addRaw(p.geo, p.color);
  }
}


/** Le modèle d'un personnage est-il chargé (sinon on garde l'ancien dessin) ? */
export const hasModel = name => !!MODELS[name];

/**
 * Fige un personnage dans une pose et en fait un maillage immobile (LOD : près, loin), à placer sur un véhicule : le squelette est appliqué une fois pour toutes.
 * origin : position du bassin ; o.ride = { arm: [haut, avant, écart], lean, grip: [x, y, z] }, si grip est donné les bras sont ajustés pour que la main L (et son symétrique) l'atteigne.
 */
export function bakeStatic(o, mode, origin, farDist = 14) {
  const ch = new Character(o);
  ch.mesh.position.set(...origin);
  if (mode === 'ride' && o.ride.grip) {
    const hand = new THREE.Object3D(); hand.position.set(0, -0.37, 0); ch.b['foreArm.L'].add(hand);
    const g = new THREE.Vector3(...o.ride.grip), v = new THREE.Vector3();
    let best = null;
    const evalArm = (au, af, sp) => {
      o.ride.arm = [au, af, sp];
      ch.pose(mode, 0);
      ch.mesh.updateMatrixWorld(true);
      const e = hand.getWorldPosition(v).distanceTo(g);
      if (!best || e < best[0]) best = [e, au, af, sp];
    };
    for (let au = 0.2; au < 1.5; au += 0.2) for (let af = -0.3; af < 1.2; af += 0.2) for (const sp of [0.1, 0.2, 0.3, 0.4]) evalArm(au, af, sp);
    const [, bau, baf] = best;
    const au0 = Math.max(0.2, bau - 0.2), au1 = Math.min(1.49, bau + 0.2);
    const af0 = Math.max(-0.3, baf - 0.2), af1 = Math.min(1.19, baf + 0.2);
    for (let au = au0; au <= au1 + 1e-6; au += 0.05) for (let af = af0; af <= af1 + 1e-6; af += 0.05) for (const sp of [0.1, 0.2, 0.3, 0.4]) evalArm(au, af, sp);
    o.ride.arm = best.slice(1);
    ch.b['foreArm.L'].remove(hand);
  }
  ch.phase = 0;
  ch.pose(mode, 0);
  ch.mesh.updateMatrixWorld(true);
  const lod = new THREE.LOD(), p = new THREE.Vector3(), q = new THREE.Vector3();
  ch.mesh.levels.slice(0, 2).forEach(({ object }, li) => {
    const grp = new THREE.Group();
    for (const sm of object.isSkinnedMesh ? [object] : object.children.filter(c => c.isSkinnedMesh)) {
      const src = sm.geometry, { pos, nor } = skinnedWorld(sm);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', src.attributes.color);
      if (src.attributes.uv) geo.setAttribute('uv', src.attributes.uv);
      geo.setIndex(src.index);
      const m = new THREE.Mesh(geo, sm.material);
      m.castShadow = true;
      grp.add(m);
    }
    lod.addLevel(grp, li ? farDist : 0);
  });
  return lod;
}
const q2 = new THREE.Vector3();

const _bmTmp = new THREE.Matrix4(), _nmTmp = new THREE.Matrix3();
let _bmArr = new Float32Array(16 * 16);

/** Positions et normales (repère du monde) d'un SkinnedMesh dans sa pose actuelle (matrices d'os précalculées). */
function skinnedWorld(sm) {
  sm.skeleton.update();
  const bones = sm.skeleton.bones, invs = sm.skeleton.boneInverses, nb = bones.length;
  if (_bmArr.length < nb * 16) _bmArr = new Float32Array(nb * 16);
  const bind = sm.bindMatrix, bindInv = sm.bindMatrixInverse;
  for (let b = 0; b < nb; b++) {
    _bmTmp.multiplyMatrices(bones[b].matrixWorld, invs[b]).premultiply(bindInv).multiply(bind);
    _bmTmp.toArray(_bmArr, b * 16);
  }
  const wm = sm.matrixWorld.elements;
  const w00 = wm[0], w01 = wm[4], w02 = wm[8], w03 = wm[12];
  const w10 = wm[1], w11 = wm[5], w12 = wm[9], w13 = wm[13];
  const w20 = wm[2], w21 = wm[6], w22 = wm[10], w23 = wm[14];
  _nmTmp.getNormalMatrix(sm.matrixWorld);
  const ne = _nmTmp.elements;
  const n00 = ne[0], n01 = ne[3], n02 = ne[6];
  const n10 = ne[1], n11 = ne[4], n12 = ne[7];
  const n20 = ne[2], n21 = ne[5], n22 = ne[8];

  const src = sm.geometry;
  const pArr = src.attributes.position.array, nArr = src.attributes.normal.array;
  const siArr = src.attributes.skinIndex.array, swArr = src.attributes.skinWeight.array;
  const n = src.attributes.position.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const bm = _bmArr;

  for (let i = 0, i3 = 0, i4 = 0; i < n; i++, i3 += 3, i4 += 4) {
    const px = pArr[i3], py = pArr[i3 + 1], pz = pArr[i3 + 2];
    const nx = nArr[i3], ny = nArr[i3 + 1], nz = nArr[i3 + 2];
    let sx = 0, sy = 0, sz = 0, rnx = 0, rny = 0, rnz = 0;
    for (let k = 0; k < 4; k++) {
      const w = swArr[i4 + k];
      if (!w) continue;
      const o = siArr[i4 + k] * 16;
      sx += w * (bm[o] * px + bm[o + 4] * py + bm[o + 8] * pz + bm[o + 12]);
      sy += w * (bm[o + 1] * px + bm[o + 5] * py + bm[o + 9] * pz + bm[o + 13]);
      sz += w * (bm[o + 2] * px + bm[o + 6] * py + bm[o + 10] * pz + bm[o + 14]);
      rnx += w * (bm[o] * nx + bm[o + 4] * ny + bm[o + 8] * nz);
      rny += w * (bm[o + 1] * nx + bm[o + 5] * ny + bm[o + 9] * nz);
      rnz += w * (bm[o + 2] * nx + bm[o + 6] * ny + bm[o + 10] * nz);
    }
    pos[i3] = w00 * sx + w01 * sy + w02 * sz + w03;
    pos[i3 + 1] = w10 * sx + w11 * sy + w12 * sz + w13;
    pos[i3 + 2] = w20 * sx + w21 * sy + w22 * sz + w23;
    const rl = Math.hypot(rnx, rny, rnz) || 1;
    rnx /= rl; rny /= rl; rnz /= rl;
    let wnx = n00 * rnx + n01 * rny + n02 * rnz;
    let wny = n10 * rnx + n11 * rny + n12 * rnz;
    let wnz = n20 * rnx + n21 * rny + n22 * rnz;
    const wl = Math.hypot(wnx, wny, wnz) || 1;
    nor[i3] = wnx / wl; nor[i3 + 1] = wny / wl; nor[i3 + 2] = wnz / wl;
  }
  return { pos, nor };
}

// ---------- Figures fixes du décor avec les modèles MakeHuman ----------
// Les foules, élèves et postes de police sont fusionnés dans le décor (un seul matériau, des couleurs par sommet) : on pose le squelette une fois,
// et la texture du modèle (visage, vêtements) est « cuite » dans les couleurs des sommets de la version de 700 triangles.
const _poser = {}, _atlas = {};
function atlasPixels(M) {
  if (!_atlas[M.name]) {
    const img = M.material.map.image, c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    _atlas[M.name] = { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  }
  return _atlas[M.name];
}
const _lin = new Float32Array(256).map((_, i) => Math.pow(i / 255, 2.2));
function bakeTexColors(M) {
  if (!M._bakeTex) {
    const A = atlasPixels(M), uv = M.geos[2].attributes.uv, n = uv.count, out = new Float32Array(n * 3);
    const ua = uv.array;
    for (let i = 0, i2 = 0, i3 = 0; i < n; i++, i2 += 2, i3 += 3) {
      const px = Math.min(A.w - 1, Math.max(0, Math.floor(ua[i2] * A.w)));
      const py = Math.min(A.h - 1, Math.max(0, Math.floor(ua[i2 + 1] * A.h)));
      const k = (py * A.w + px) * 4;
      out[i3] = _lin[A.d[k]]; out[i3 + 1] = _lin[A.d[k + 1]]; out[i3 + 2] = _lin[A.d[k + 2]];
    }
    M._bakeTex = out;
  }
  return M._bakeTex;
}
function bakeModelled(builder, o, mode, x, z, ry, t) {
  const M = MODELS[o.model];
  let P = _poser[o.model];
  if (!P) {
    const ch = new Character({ ...outfit('man'), model: o.model });
    const g2 = new THREE.BufferGeometry(), src = M.geos[2];
    for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) g2.setAttribute(k, src.attributes[k]);
    g2.setIndex(src.index);
    const sm = new THREE.SkinnedMesh(g2, M.material);
    ch.mesh.add(sm);
    ch.mesh.updateMatrixWorld(true);
    sm.bind(ch.mesh.levels[0].object.isSkinnedMesh ? ch.mesh.levels[0].object.skeleton : ch.mesh.levels[0].object.children.find(c => c.isSkinnedMesh).skeleton);
    P = _poser[o.model] = { ch, sm };
  }
  const { ch, sm } = P, h = o.height ?? 1, g = o.girth ?? 1;
  ch.mesh.position.set(x, 0, z);
  ch.mesh.rotation.set(0, ry, 0);
  ch.mesh.scale.set(h * (1 + (g - 1) * 0.7), h, h * (1 + (g - 1) * 0.5));
  applyPose(ch.b, mode, t, 1, o);
  ch.mesh.updateMatrixWorld(true);
  const src = sm.geometry, { pos, nor } = skinnedWorld(sm);
  const zc = zoneColors(M.geos[2].attributes._zone, o, M).array, bt = bakeTexColors(M), col = new Float32Array(pos.length);
  for (let i = 0; i < col.length; i++) col[i] = zc[i] * bt[i];
  builder.addColored(pos, nor, col, src.index?.array);
  for (const p of parts(o, true)) {                                         // béret, gilet, foulard... : pièces rigides posées sur leur os
    p.geo.applyMatrix4(_m.copy(ch.bones[p.bone].matrixWorld));
    builder.addRaw(p.geo, p.color);
  }
}
