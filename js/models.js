// Modèles 3D détaillés des véhicules de Kinshasa. Chaque véhicule est fusionné en un seul
// maillage à couleurs par sommet (un seul appel de dessin), pour rester fluide sur mobile et PC.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { outfit, bakeStatic, hasModel, Character, solveGrip } from './characters.js';
import { nonIndexed } from './geo.js';
const __mark = n => { if (location.search.includes('mesure')) console.log(`MESURE ${String(Math.round(performance.now())).padStart(6)} ms  ${n}`); };
__mark('models.js : début');

export const VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
export const CAR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.12 });

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function paint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Assemble des primitives colorées puis les fusionne. */
export class Builder {
  constructor() { this.parts = []; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), ONE);
    const g = geo.index ? nonIndexed(geo) : geo;
    if (g !== geo) geo.dispose();
    this.parts.push(paint(g.applyMatrix4(_m), color));
    return this;
  }
  /** Ajoute une géométrie déjà placée (sans transformation). */
  addRaw(geo, color) {
    const g = geo.index ? nonIndexed(geo) : geo;
    if (g !== geo) geo.dispose();
    this.parts.push(paint(g, color));
    return this;
  }
  // Les pièces longues sont subdivisées pour suivre les courbes du boulevard une fois pliées.
  box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d, 1, 1, Math.max(1, Math.ceil(d / 8))), color, x, y, z, rx, ry, rz);
  }
  cyl(rt, rb, h, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }
  ball(r, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
    return this.add(new THREE.IcosahedronGeometry(r, r > 1.2 ? 1 : 0).scale(sx, sy, sz), color, x, y, z);
  }
  geometry() {
    const g = mergeGeometries(this.parts);
    this.parts.forEach(p => p.dispose());
    return g;
  }
  mesh(mat = VC_MAT) {
    const m = new THREE.Mesh(this.geometry(), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

const GLASS = 0x1c2b3a;
const GLASS_IN = 0x121c26;
const TYRE = 0x171719;
const RIM = 0xcfd6de;
const HUB = 0x454a52;
const CHROME = 0xdce2e8;
const BUMPER = 0x22252a;
const GRILLE = 0x16181c;
const PLATE_W = 0xf4f4f0;
const PLATE_B = 0x1d4fa0;
const SKIN = [0x5a3a22, 0x4a2e1a, 0x6b4428];
const pick = a => a[Math.floor(Math.random() * a.length)];

/** Autocollant municipal des taxis de Kinshasa (fond blanc + bandeau bleu + QR/numéro sur les portières avant, vu dans les vidéos). */
function taxiSticker(b, W, y, z) {
  for (const sx of [-1, 1]) {
    b.box(0.024, 0.22, 0.34, 0xf8f9fa, sx * (W / 2 + 0.008), y, z)
      .box(0.027, 0.06, 0.34, 0x1d4fa0, sx * (W / 2 + 0.009), y + 0.07, z)
      .box(0.027, 0.09, 0.09, 0x15181c, sx * (W / 2 + 0.009), y - 0.03, z - 0.09)
      .box(0.027, 0.05, 0.16, 0x1d4fa0, sx * (W / 2 + 0.009), y - 0.03, z + 0.06);
  }
}

let roofSignMat = null;
function roofSign() {
  if (!roofSignMat) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 48;
    const x = c.getContext('2d');
    x.fillStyle = '#fff5cc'; x.fillRect(0, 0, 128, 48);
    x.strokeStyle = '#d49b00'; x.lineWidth = 4; x.strokeRect(2, 2, 124, 44);
    x.fillStyle = '#111'; x.font = 'bold 28px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('TAXI', 64, 25);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    roofSignMat = new THREE.MeshLambertMaterial({ map: t });
  }
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.24), VC_MAT);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.2), roofSignMat);
  m.position.y = 0.11;
  g.add(base, m);
  g.position.set(0, 1.44, -0.05);
  return g;
}

function wrap(mesh, L, W, extra = []) {
  const g = new THREE.Group();
  g.add(mesh, ...extra, nightLights(L, W));
  g.userData = { L, W };
  return g;
}

// ---------- Nuit (l'auteur, 10/11 : « les phares du véhicule ou de la moto doivent fonctionner pour voir la route ») ----------
// Chaque véhicule porte ses phares (avant, blanc chaud) et ses feux (arrière, rouge) : un petit maillage à part, matériau sans éclairage
// partagé par tous, visible seulement la nuit (setNight). Les halos et le faisceau sur la chaussée sont dessinés par nuit.js.
export const NIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, visible: false, toneMapped: false });
const LAMP_SPOTS = new Map(), LIGHT_GEO = new Map();
/** Positions { front, rear } des phares et des feux d'un véhicule de L × W (l'avant est vers -z) : une moto n'a qu'un phare. */
export function lampSpots(L, W) {
  const k = `${L}|${W}`;
  let S = LAMP_SPOTS.get(k);
  if (S) return S;
  if (W < 1) S = { front: [[0, 0.96, -0.8]], rear: [[0, 0.84, L / 2 - 0.1]] };
  else {
    const y = W < 1.95 ? 0.68 : W < 2.3 ? 0.92 : 1.05, dx = W / 2 - 0.3;
    S = { front: [[-dx, y, -L / 2 + 0.03], [dx, y, -L / 2 + 0.03]], rear: [[-dx, y + 0.02, L / 2 - 0.03], [dx, y + 0.02, L / 2 - 0.03]] };
  }
  LAMP_SPOTS.set(k, S);
  return S;
}
function nightLights(L, W) {
  const k = `${L}|${W}`;
  let g = LIGHT_GEO.get(k);
  if (!g) {
    const b = new Builder(), S = lampSpots(L, W);
    for (const [x, y, z] of S.front) b.box(W < 1 ? 0.16 : 0.3, 0.12, 0.06, 0xfff6d5, x, y, z);
    for (const [x, y, z] of S.rear) b.box(W < 1 ? 0.14 : 0.3, 0.1, 0.06, 0xff2a2a, x, y, z);
    g = b.geometry();
    LIGHT_GEO.set(k, g);
  }
  const m = new THREE.Mesh(g, NIGHT_MAT);
  m.castShadow = m.receiveShadow = false;
  return m;
}
/** k : 0 le jour, 1 la nuit noire : phares et feux allumés dès le soir. */
export function setNight(k) { NIGHT_MAT.visible = k > 0.04; }

// ---------- Carrosseries : la caisse est une surface continue, tirée de coupes le long du véhicule. Chaque modèle existe en deux versions (de près, de loin) ----------
// et les véhicules identiques partagent leur forme en mémoire. L'avant est vers -Z. Formes et couleurs refaites d'après les vidéos et photos, sans logo de marque.
const lerpTable = (T, u) => {
  let i = 1;
  while (i < T.length - 1 && T[i][0] < u) i++;
  const [a, va] = T[i - 1], [c, vc] = T[i], f = Math.max(0, Math.min(1, (u - a) / (c - a || 1))), k = f * f * (3 - 2 * f);
  return va + (vc - va) * k;
};
const LOD_DIST = 42, GEO = new Map();
/** Groupe d'un véhicule : `build(b, low)` remplit le Builder, une seule fois pour chaque `key` et chaque version. */
function vehicle(key, L, W, build, extra = []) {
  const mk = low => {
    const k = `${key}|${low ? 'l' : 'h'}`;
    let g = GEO.get(k);
    if (!g) { const b = new Builder(); build(b, low); g = b.geometry(); GEO.set(k, g); }
    const m = new THREE.Mesh(g, CAR_MAT);
    m.castShadow = true; m.receiveShadow = !low;
    return m;
  };
  const lod = new THREE.LOD();
  lod.addLevel(mk(false), 0);
  lod.addLevel(mk(true), LOD_DIST);
  return wrap(lod, L, W, extra);
}
const sub3 = (a, c) => [a[0] - c[0], a[1] - c[1], a[2] - c[2]], cross3 = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
/**
 * Surface de la caisse. sp : L, W, z0 (décalage), top (dessus, de l'avant vers l'arrière), belt (bas des vitres), hw (demi-largeur, en fraction de W/2), sill (bas de caisse),
 * axle, R, wheelZ (passages de roue), shield/rear (pare-brise, lunette), pillars (montants, en u), paint(u, j) : couleur imposée, lamp/tail : longueur des phares et des feux.
 */
function loftBody(b, sp, color, low) {
  const n = low ? 12 : 26, m = 9, z0 = sp.z0 ?? 0, US = i => 0.45 * i / n + 0.55 * (1 - Math.cos(Math.PI * i / n)) / 2, P = [];
  for (let i = 0; i <= n; i++) {
    const u = US(i), z = z0 - sp.L / 2 + u * sp.L, hw = sp.W / 2 * lerpTable(sp.hw, u), top = lerpTable(sp.top, u), belt = Math.min(lerpTable(sp.belt, u), top - 0.015);
    const cab = Math.max(0, Math.min(1, (top - belt) / 0.28));
    let sill = sp.sill;
    for (const wz of sp.wheelZ) { const d = z - wz; if (Math.abs(d) < sp.R) sill = Math.max(sill, sp.axle + Math.sqrt(sp.R * sp.R - d * d)); }
    const lo = Math.min(sill, belt - 0.05), mid = lo + (belt - lo) * 0.55, rail = hw * (0.97 - (sp.tumble ?? 0.2) * cab), railY = belt + (top - belt) * ((sp.railK ?? 0.86) * cab + 0.94 * (1 - cab));
    P.push([[0, sp.sill - 0.02], [hw * 0.9, Math.min(lo, sp.sill + 0.02)], [hw * 0.985, lo], [hw, mid], [hw * 0.985, belt], [hw * (0.99 - 0.5 * (sp.tumble ?? 0.2) * cab), belt + (top - belt) * 0.45], [rail, railY], [rail * 0.55, belt + (top - belt) * (0.97 + 0.02 * (1 - cab))], [0, top]].map(([x, y]) => [x, y, z]));
  }
  const N = P.map(r => r.map(() => [0, 0, 0]));
  for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) {
    const f = cross3(sub3(P[i][j + 1], P[i][j]), sub3(P[i + 1][j], P[i][j]));
    for (const [a, c] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) { N[a][c][0] += f[0]; N[a][c][1] += f[1]; N[a][c][2] += f[2]; }
  }
  for (const r of N) for (const v of r) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; }
  const inR = (u, R) => R && u >= R[0] && u < R[1], lamp = sp.lamp ?? 0.06, tail = sp.tail ?? 0.045;
  const paintOf = (u, j, cab) => {
    const own = sp.paint?.(u, j, cab);
    if (own !== undefined) return own;
    if (j <= 1) return BUMPER;
    if (j === 3 && u < lamp) return 0xe9eef2;
    if (j === 4 && u < lamp / 2) return 0xe9eef2;
    if (j === 3 && u >= lamp && u < lamp * 1.14) return 0xff9914;
    if (j === 3 && u > 1 - tail) return 0xb3131a;
    if (j === 4 && u > 1 - tail / 2) return 0xb3131a;
    if (j >= 4 && j <= 5 && cab > 0.3 && u > sp.shield[0] - 0.005 && u < (sp.rear ? sp.rear[1] : 1) + 0.005) return sp.pillars.some(([a, c]) => u >= a && u < c) ? (sp.pillarColor ?? color) : (sp.glass ?? GLASS);
    if (j >= 6 && (inR(u, sp.shield) || inR(u, sp.rear))) return GLASS;
    return sp.roof && j >= 6 && u >= sp.shield[0] && u < (sp.roofEnd ?? 1) ? sp.roof : color;
  };
  const byCol = new Map(), bucket = c => byCol.get(c) ?? byCol.set(c, { p: [], n: [] }).get(c);
  for (let i = 0; i < n; i++) {
    const u = (US(i) + US(i + 1)) / 2, top = lerpTable(sp.top, u), belt = Math.min(lerpTable(sp.belt, u), top - 0.015), cab = Math.max(0, Math.min(1, (top - belt) / 0.28));
    for (let j = 0; j < m - 1; j++) {
      const o = bucket(paintOf(u, j, cab)), q = [[i, j], [i, j + 1], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i + 1, j]];
      for (const [a, e] of q) { o.p.push(...P[a][e]); o.n.push(...N[a][e]); }
      for (const [a, e] of [...q].reverse()) { o.p.push(-P[a][e][0], P[a][e][1], P[a][e][2]); o.n.push(-N[a][e][0], N[a][e][1], N[a][e][2]); }
    }
  }
  for (const [i, nz] of [[0, -1], [n, 1]]) for (let j = 0; j < m - 1; j++) {           // la caisse est fermée aux deux bouts
    const a = P[i][j], c = P[i][j + 1], o = bucket(j <= 1 ? BUMPER : color), ma = [-a[0], a[1], a[2]], mc = [-c[0], c[1], c[2]];
    const tri = (q, r, t) => { o.p.push(...q, ...r, ...t); for (let k = 0; k < 3; k++) o.n.push(0, 0, nz); };
    if (nz < 0) { tri(a, mc, c); tri(a, ma, mc); } else { tri(a, c, mc); tri(a, mc, ma); }
  }
  for (const [c, o] of byCol) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(o.p.length / 3 * 2).fill(0), 2));
    b.addRaw(g, c);
  }
}
/** Roues dans leurs passages : pneu, jante à branches (de près), moyeu ; le fond du passage est sombre. */
function realWheels(b, sp, low, list = sp.wheelZ) {
  const r = sp.axle, w = sp.tyre ?? 0.22, x0 = sp.W / 2 - w / 2 - 0.02, seg = low ? 8 : 14;
  for (const sx of [-1, 1]) for (const z of list) {
    b.box(0.5, sp.R * 1.2, sp.R * 1.9, 0x0b0c0e, sx * (sp.W / 2 - 0.34), sp.axle + sp.R * 0.25, z);
    b.add(new THREE.CylinderGeometry(r, r, w, seg).rotateZ(Math.PI / 2), TYRE, sx * x0, r, z);
    b.add(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w + 0.012, low ? 6 : 12).rotateZ(Math.PI / 2), low ? RIM : 0x8e959c, sx * x0, r, z);
    if (low) continue;
    if (sp.steel) {                                                         // jante d'acier : disque, couronne de trous, gros moyeu
      b.add(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12).rotateZ(Math.PI / 2), sp.steel, sx * x0, r, z);
      for (let k = 0; k < 8; k++) b.box(0.012, r * 0.09, r * 0.09, 0x15171a, sx * (x0 + w / 2 + 0.012), r + r * 0.42 * Math.cos(k * Math.PI / 4), z + r * 0.42 * Math.sin(k * Math.PI / 4));
      b.add(new THREE.CylinderGeometry(r * 0.24, r * 0.3, w + 0.07, 8).rotateZ(Math.PI / 2), 0x3a3e44, sx * x0, r, z);
      continue;
    }
    for (let k = 0; k < 5; k++) b.box(0.012, r * 1.18, r * 0.16, RIM, sx * (x0 + w / 2 + 0.01), r, z, k * Math.PI * 2 / 5);
    b.add(new THREE.CylinderGeometry(r * 0.17, r * 0.17, w + 0.03, 6).rotateZ(Math.PI / 2), HUB, sx * x0, r, z);
  }
}
/** Calandre, plaques, rétroviseurs, poignées, joints de portes, posés sur la surface. grille : largeur et hauteur de la calandre. */
function realDetails(b, sp, color, low, { yF, yR, doors = [], grille = [0.42, 0.13], lower = 0.56 }) {
  const { L, W } = sp, zF = (sp.z0 ?? 0) - L / 2, zR = (sp.z0 ?? 0) + L / 2;
  b.box(W * grille[0], grille[1], 0.04, GRILLE, 0, yF - 0.02, zF + 0.015);
  if (lower) b.box(W * lower, 0.11, 0.04, GRILLE, 0, yF - 0.28, zF + 0.03);
  for (const [z, dir] of [[zF + 0.005, -1], [zR - 0.005, 1]]) {
    const py = dir < 0 ? yF - 0.17 : yR - 0.2;
    b.box(0.46, 0.11, 0.02, PLATE_W, 0, py, z).box(0.08, 0.11, 0.024, PLATE_B, -0.18 * dir, py, z);
  }
  for (const sx of [-1, 1]) {
    b.box(0.17, 0.1, 0.11, sp.mirrorColor ?? color, sx * (W / 2 + 0.05), sp.mirrorY, sp.mirrorZ);
    if (low) continue;
    b.box(0.05, 0.03, 0.06, BUMPER, sx * (W / 2 - 0.01), sp.mirrorY - 0.05, sp.mirrorZ);
    for (const dz of doors) b.box(0.012, sp.mirrorY - 0.45, 0.012, 0x24272c, sx * (W / 2 * 1.002), (sp.mirrorY + 0.42) / 2, dz);
    for (const dz of doors.slice(0, -1)) b.box(0.03, 0.03, 0.13, BUMPER, sx * (W / 2 + 0.008), sp.mirrorY - 0.14, dz + 0.17);
  }
}
const HW = [[0, 0.66], [0.02, 0.84], [0.07, 0.94], [0.2, 1], [0.8, 1], [0.94, 0.95], [0.985, 0.84], [1, 0.68]], HW_BOX = [[0, 0.8], [0.015, 0.92], [0.05, 0.98], [0.15, 1], [0.92, 1], [0.985, 0.96], [1, 0.9]];
const SEDAN = { L: 4.4, W: 1.78, sill: 0.3, axle: 0.32, R: 0.4, wheelZ: [-1.32, 1.3], mirrorY: 0.98, mirrorZ: -0.62, shield: [0.3, 0.46], rear: [0.67, 0.78], pillars: [[0.3, 0.325], [0.53, 0.545], [0.68, 0.79]], hw: HW,
  top: [[0, 0.56], [0.012, 0.68], [0.04, 0.76], [0.14, 0.84], [0.26, 0.91], [0.31, 0.95], [0.455, 1.37], [0.54, 1.43], [0.66, 1.39], [0.79, 1.02], [0.9, 0.99], [0.975, 0.92], [0.992, 0.8], [1, 0.58]],
  belt: [[0, 0.5], [0.3, 0.93], [0.6, 0.98], [0.8, 1.0], [1, 0.8]] };
const HATCH = { L: 3.85, W: 1.7, sill: 0.3, axle: 0.3, R: 0.37, wheelZ: [-1.18, 1.18], mirrorY: 1.02, mirrorZ: -0.6, shield: [0.24, 0.4], rear: [0.84, 0.95], pillars: [[0.24, 0.265], [0.52, 0.535], [0.79, 0.87]], hw: HW,
  top: [[0, 0.6], [0.015, 0.72], [0.05, 0.8], [0.14, 0.87], [0.22, 0.93], [0.26, 1.0], [0.4, 1.44], [0.5, 1.48], [0.8, 1.44], [0.86, 1.4], [0.95, 1.0], [0.985, 0.85], [1, 0.6]],
  belt: [[0, 0.55], [0.25, 0.95], [0.6, 1.0], [0.85, 1.05], [1, 0.8]] };
const CITY = { L: 4.05, W: 1.8, sill: 0.3, axle: 0.32, R: 0.38, wheelZ: [-1.27, 1.24], mirrorY: 1.0, mirrorZ: -0.6, shield: [0.25, 0.42], rear: [0.8, 0.93], pillars: [[0.25, 0.27], [0.52, 0.535], [0.76, 0.84]], pillarColor: 0x1b1d20, hw: HW,
  top: [[0, 0.58], [0.015, 0.7], [0.05, 0.78], [0.14, 0.86], [0.23, 0.92], [0.27, 0.97], [0.42, 1.37], [0.52, 1.42], [0.76, 1.37], [0.82, 1.33], [0.94, 0.98], [0.985, 0.82], [1, 0.58]],
  belt: [[0, 0.5], [0.25, 0.92], [0.6, 1.0], [0.85, 1.1], [1, 0.8]] };
const CROSS = { L: 4.45, W: 1.86, sill: 0.42, axle: 0.37, R: 0.46, wheelZ: [-1.34, 1.32], mirrorY: 1.12, mirrorZ: -0.62, shield: [0.3, 0.44], rear: [0.82, 0.94], pillars: [[0.3, 0.32], [0.54, 0.555], [0.77, 0.9]],
  hw: [[0, 0.72], [0.02, 0.88], [0.07, 0.96], [0.2, 1], [0.84, 1], [0.95, 0.96], [0.985, 0.88], [1, 0.74]],
  top: [[0, 0.72], [0.012, 0.84], [0.04, 0.95], [0.14, 1.02], [0.27, 1.08], [0.31, 1.12], [0.44, 1.56], [0.54, 1.62], [0.78, 1.58], [0.9, 1.5], [0.95, 1.22], [0.985, 1.08], [1, 0.74]],
  belt: [[0, 0.68], [0.3, 1.1], [0.6, 1.16], [0.86, 1.2], [1, 0.9]] };
const PRADO = { L: 4.6, W: 1.86, sill: 0.44, axle: 0.38, R: 0.46, wheelZ: [-1.38, 1.35], mirrorY: 1.16, mirrorZ: -0.92, tumble: 0.1, shield: [0.2, 0.31], rear: [0.93, 0.975], pillars: [[0.2, 0.225], [0.5, 0.515], [0.74, 0.755], [0.9, 0.975]], hw: HW_BOX, lamp: 0.05,
  top: [[0, 0.75], [0.012, 0.95], [0.04, 1.08], [0.18, 1.14], [0.22, 1.18], [0.31, 1.7], [0.4, 1.76], [0.92, 1.74], [0.955, 1.68], [0.98, 1.56], [0.99, 1.1], [1, 0.8]],
  belt: [[0, 0.7], [0.2, 1.14], [0.9, 1.2], [1, 1.0]] };
const PICKUP = { L: 5.05, W: 1.86, sill: 0.46, axle: 0.4, R: 0.46, wheelZ: [-1.55, 1.35], mirrorY: 1.2, mirrorZ: -1.1, mirrorColor: 0x1a1a1a, tumble: 0.1, shield: [0.17, 0.27], pillars: [[0.17, 0.19], [0.39, 0.4], [0.52, 0.56]], rear: [0.56, 0.56], hw: HW_BOX, lamp: 0.045, tail: 0.03,
  top: [[0, 0.78], [0.01, 0.98], [0.04, 1.1], [0.15, 1.16], [0.19, 1.2], [0.27, 1.72], [0.34, 1.76], [0.54, 1.75], [0.565, 1.2], [0.585, 1.16], [0.98, 1.14], [0.995, 0.98], [1, 0.8]],
  belt: [[0, 0.7], [0.18, 1.14], [0.56, 1.18], [0.6, 1.1], [1, 1.1]] };
const VAN = { L: 4.95, W: 1.9, sill: 0.34, axle: 0.34, R: 0.4, wheelZ: [-1.58, 1.5], mirrorY: 1.42, mirrorZ: -1.5, mirrorColor: 0x1a1a1a, tumble: 0.08, shield: [0.1, 0.22], rear: [0.955, 0.99], pillars: [[0.1, 0.12], [0.37, 0.385], [0.6, 0.615], [0.82, 0.84], [0.93, 1]], hw: HW_BOX, lamp: 0.05, tail: 0.03,
  top: [[0, 0.82], [0.01, 0.98], [0.05, 1.12], [0.1, 1.2], [0.14, 1.5], [0.22, 2.02], [0.3, 2.1], [0.9, 2.1], [0.96, 2.0], [0.99, 1.6], [1, 0.84]],
  belt: [[0, 0.78], [0.1, 1.16], [0.3, 1.28], [0.95, 1.3], [1, 1.0]] };
const M207 = { L: 5.5, W: 2.02, sill: 0.44, axle: 0.38, R: 0.44, wheelZ: [-1.72, 1.2], steel: 0x24272c, mirrorY: 1.5, mirrorZ: -2.0, mirrorColor: 0x151515, tumble: 0.05, railK: 0.74, shield: [0.13, 0.22], pillars: [[0.12, 0.15], [0.93, 1]], hw: HW_BOX, lamp: 0, tail: 0,
  top: [[0, 0.72], [0.008, 0.98], [0.03, 1.12], [0.09, 1.24], [0.13, 1.36], [0.22, 2.02], [0.3, 2.16], [0.97, 2.16], [0.99, 1.95], [1, 0.72]],
  belt: [[0, 0.72], [0.1, 1.26], [0.3, 1.34], [1, 1.34]] };
const FORCE = { L: 6.0, W: 2.08, sill: 0.36, axle: 0.38, R: 0.42, wheelZ: [-1.95, 1.85], mirrorY: 1.5, mirrorZ: -1.85, mirrorColor: 0x151515, tumble: 0.05, shield: [0.12, 0.2], pillars: [[0.1, 0.13], [0.33, 0.345], [0.48, 0.495], [0.63, 0.645], [0.78, 0.795], [0.9, 1]], hw: HW_BOX, lamp: 0.04, tail: 0.025,
  top: [[0, 0.84], [0.01, 1.0], [0.05, 1.16], [0.1, 1.25], [0.14, 1.55], [0.2, 2.2], [0.27, 2.4], [0.97, 2.4], [0.99, 2.1], [1, 0.84]],
  belt: [[0, 0.8], [0.1, 1.2], [0.25, 1.42], [1, 1.42]] };
const AMBU = { L: 5.3, W: 1.98, sill: 0.34, axle: 0.35, R: 0.41, wheelZ: [-1.7, 1.6], mirrorY: 1.42, mirrorZ: -1.65, mirrorColor: 0x151515, tumble: 0.05, shield: [0.11, 0.21], pillars: [[0.1, 0.13], [0.36, 1]], hw: HW_BOX, lamp: 0.045, tail: 0.03,
  top: [[0, 0.82], [0.01, 0.98], [0.05, 1.12], [0.1, 1.22], [0.14, 1.5], [0.21, 2.12], [0.28, 2.28], [0.97, 2.28], [0.99, 2.0], [1, 0.84]],
  belt: [[0, 0.78], [0.1, 1.16], [0.25, 1.34], [1, 1.34]] };
const rows = (a, c, step, w) => { const out = []; for (let u = a; u < c; u += step) out.push([u, u + w]); return out; };
const COASTER = { L: 7.2, W: 2.12, sill: 0.4, axle: 0.42, R: 0.46, wheelZ: [-2.4, 2.2], mirrorY: 1.7, mirrorZ: -3.0, mirrorColor: 0x151515, tumble: 0.05, railK: 0.78, glass: 0x2c4152, shield: [0.05, 0.12], pillars: [[0.04, 0.135], [0.95, 1]], hw: HW_BOX, lamp: 0.03, tail: 0, roof: 0xf6f7f6,
  top: [[0, 0.82], [0.008, 1.1], [0.03, 1.4], [0.06, 1.9], [0.1, 2.4], [0.16, 2.6], [0.97, 2.6], [0.99, 2.2], [1, 0.8]],
  belt: [[0, 0.78], [0.05, 1.2], [0.12, 1.34], [1, 1.34]] };
const TRANSCO = { L: 11.2, W: 2.52, sill: 0.42, axle: 0.5, R: 0.6, wheelZ: [-3.2, 3.0], tyre: 0.3, mirrorY: 2.35, mirrorZ: -5.4, mirrorColor: 0x1a1a1a, tumble: 0.03, shield: [0.012, 0.04], rear: [0.985, 0.995], pillars: [[0.01, 0.05], ...rows(0.1, 0.96, 0.12, 0.012), [0.96, 1]], hw: HW_BOX, lamp: 0.018, tail: 0.012,
  top: [[0, 0.7], [0.004, 1.2], [0.012, 2.0], [0.03, 2.9], [0.06, 3.1], [0.97, 3.12], [0.99, 2.9], [1, 0.7]],
  belt: [[0, 0.7], [0.02, 1.7], [1, 1.75]] };

/** Berline (Toyota Corolla, Carina, Camry : taxi jaune ou voiture particulière). C'est aussi le taxi du joueur. */
export function createCar({ color = 0xffffff, taxi = false, roof = taxi } = {}) {
  return vehicle(`sedan|${color}|${taxi}`, SEDAN.L, SEDAN.W, (b, low) => {
    loftBody(b, SEDAN, color, low);
    realWheels(b, SEDAN, low);
    realDetails(b, SEDAN, color, low, { yF: 0.72, yR: 0.86, doors: [-0.72, 0.28, 1.06] });
    if (taxi) {
      for (const sx of [-1, 1]) b.box(0.012, 0.08, 2.2, 0x1d4fa0, sx * (SEDAN.W / 2 + 0.002), 0.66, 0.1);
      if (!low) taxiSticker(b, SEDAN.W, 0.86, -0.34);
    }
  }, roof ? [roofSign()] : []);
}
/** Citadine « Ketch » (Toyota Ist, Vitz) : très répandue comme taxi jaune à Kinshasa. */
export function createHatchback({ color = 0xf2c200, taxi = true } = {}) {
  return vehicle(`hatch|${color}|${taxi}`, HATCH.L, HATCH.W, (b, low) => {
    loftBody(b, HATCH, color, low);
    realWheels(b, HATCH, low);
    realDetails(b, HATCH, color, low, { yF: 0.74, yR: 0.82, doors: [-0.58, 0.32, 0.9] });
    if (taxi) {
      for (const sx of [-1, 1]) b.box(0.012, 0.08, 1.9, 0x1d4fa0, sx * (HATCH.W / 2 + 0.002), 0.66, 0.06);
      if (!low) taxiSticker(b, HATCH.W, 0.88, -0.25);
    }
  });
}
/** Pick-up double cabine ou 4x4 à roue de secours (Land Cruiser, Prado, RAV4). */
export function createSUV() {
  if (Math.random() < 0.35) {
    const col = pick([0xd8c898, 0x4b5d38, 0xf2f4f7, 0x1f242b]);
    return vehicle(`pickup|${col}`, PICKUP.L, PICKUP.W, (b, low) => {
      loftBody(b, PICKUP, col, low);
      realWheels(b, PICKUP, low);
      realDetails(b, PICKUP, col, low, { yF: 0.92, yR: 0.96, doors: [-1.05, -0.3, 0.3], lower: 0.5 });
      b.box(PICKUP.W * 0.84, 0.03, PICKUP.L * 0.38, 0x26292e, 0, 1.17, PICKUP.L * 0.28).box(0.08, 0.72, 0.08, 0x15181c, PICKUP.W * 0.47, 1.36, -1.02);
    });
  }
  const col = pick([0x1f242b, 0xf2f4f7, 0xb8bec4, 0x243b6b, 0x6b1d1d]);
  return vehicle(`prado|${col}`, PRADO.L, PRADO.W, (b, low) => {
    loftBody(b, PRADO, col, low);
    realWheels(b, PRADO, low);
    realDetails(b, PRADO, col, low, { yF: 0.92, yR: 1.0, doors: [-0.92, -0.05, 0.75], lower: 0.5 });
    for (const sx of [-1, 1]) b.box(0.05, 0.04, 2.3, 0x22252a, sx * (PRADO.W * 0.34), 1.78, 0.35);
    b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.22, low ? 8 : 14).rotateX(Math.PI / 2), TYRE, 0.18, 1.0, PRADO.L / 2 + 0.08)
      .add(new THREE.CylinderGeometry(0.28, 0.28, 0.24, low ? 6 : 12).rotateX(Math.PI / 2), col, 0.18, 1.0, PRADO.L / 2 + 0.08);
  });
}
/** Taxi-bus Mercedes 207 (photo « Taxi avec 27 ») : bas jaune, haut et toit bleu ciel, museau court, calandre à lamelles, pare-chocs noir, jantes d'acier. Sans `top` : le 207 des vidéos, toit clair et galerie chargée. */
const GRIP_AT = [M207.W / 2 + 0.05, 1.55, -0.55], RCV_STEP = [M207.W / 2 - 0.06, 0.46, -0.1], RCV_YAW = -0.9;   // (barre de la porte ; marchepied du receveur et son orientation)
export function createMinibus({ color = 0xf2c200, apprenti = true, top = null } = {}) {
  const shirt = pick([0xf2c200, 0xf4f4f4, 0x1d4fa0, 0x2b8a3e]), blue = top ?? 0x1d4fa0, { L, W } = M207, zF = -L / 2;
  const human = apprenti && hasModel('homme') ? receveurHumain(shirt, W) : null;   // (corps MakeHuman ; sans le fichier, l'ancien dessin en boîtes)
  const sp = { ...M207, roof: top ?? 0xe8edf2, roofEnd: 0.98, pillarColor: top ?? color, paint: (u, j) => (j >= 6 && u > 0.2 && u < 0.24 ? blue : undefined) };
  const g = vehicle(`m207|${color}|${top}|${apprenti ? shirt : 0}`, L, W, (b, low) => {
    loftBody(b, sp, color, low);
    realWheels(b, M207, low);
    // l'avant : calandre à lamelles, phares rectangulaires, clignotants, gros pare-chocs noir
    b.box(W * 0.56, 0.3, 0.05, 0xc99a1e, 0, 0.94, zF + 0.05);
    if (!low) for (let k = 0; k < 4; k++) b.box(W * 0.56, 0.03, 0.06, GRILLE, 0, 0.84 + k * 0.066, zF + 0.04);
    for (const sx of [-1, 1]) {
      b.box(0.24, 0.17, 0.06, 0xf4f1e2, sx * W * 0.34, 0.94, zF + 0.05).box(0.1, 0.1, 0.05, 0xff9914, sx * W * 0.43, 1.04, zF + 0.1);
      b.box(0.14, 0.2, 0.05, 0xb3131a, sx * W * 0.38, 0.98, L / 2 + 0.005).box(0.14, 0.08, 0.05, 0xff9914, sx * W * 0.38, 1.13, L / 2 + 0.005);
      if (!top) b.box(0.012, 0.13, L * 0.78, blue, sx * (W / 2 + 0.003), 1.0, 0.25);
    }
    b.box(W * 1.02, 0.17, 0.2, 0x17191c, 0, 0.6, zF + 0.02).box(W * 0.5, 0.05, 0.22, 0x2b2e33, 0, 0.47, zF + 0.04).box(W * 1.02, 0.2, 0.2, 0x17191c, 0, 0.56, L / 2 - 0.05);
    b.box(0.46, 0.11, 0.02, PLATE_W, 0, 0.6, zF - 0.09).box(0.08, 0.11, 0.024, PLATE_B, -0.18, 0.6, zF - 0.09).box(0.46, 0.11, 0.02, PLATE_W, 0, 0.78, L / 2 + 0.005);
    for (const sx of [-1, 1]) {
      b.box(0.1, 0.26, 0.08, 0x151515, sx * (W / 2 + 0.1), M207.mirrorY, M207.mirrorZ).box(0.14, 0.03, 0.03, 0x222222, sx * (W / 2 + 0.04), M207.mirrorY + 0.1, M207.mirrorZ);
      if (!low) b.box(0.012, M207.mirrorY - 0.55, 0.012, 0x24272c, sx * (W / 2 * 1.002), 1.0, -1.25).box(0.03, 0.03, 0.13, BUMPER, sx * (W / 2 + 0.008), 1.18, -1.42);
    }
    // l'arrière : deux portes vitrées, le joint, les réflecteurs
    b.box(W * 0.86, 0.6, 0.03, top ?? color, 0, 1.62, L / 2 - 0.05);
    for (const sx of [-0.46, 0.46]) b.box(0.66, 0.5, 0.04, GLASS, sx, 1.68, L / 2 - 0.02);
    for (const sx of [-1, 1]) for (const z of [-1.0, 0.72, 1.45]) b.box(0.014, 0.66, 0.13, top ?? color, sx * (W / 2 + 0.004), 1.68, z);
    if (!low) {
      b.box(0.03, 1.5, 0.02, 0x1a1d22, 0, 1.3, L / 2 + 0.002).box(0.012, 0.02, 0.5, 0x1a1d22, W / 2 + 0.004, 1.9, 0).box(0.012, 0.02, 0.5, 0x1a1d22, -W / 2 - 0.004, 1.9, 0);
      taxiSticker(b, W, 1.08, -1.0);
      for (const sx of [-0.62, 0.62]) b.box(0.32, 0.07, 0.03, 0xd62828, sx, 0.74, L / 2 + 0.01);
    }
    if (!apprenti) b.box(0.08, 1.2, 0.86, 0x111317, W / 2 - 0.02, 1.14, -0.1);   // la porte ouverte, à droite (avec le receveur : il l'occupe, les deux pieds à l'intérieur)
    b.box(0.16, 0.05, 0.86, BUMPER, W / 2 + 0.02, 0.5, -0.1);
    if (apprenti) b.box(0.035, 0.8, 0.035, 0xb8bcc2, GRIP_AT[0], GRIP_AT[1], GRIP_AT[2]).box(0.07, 0.03, 0.03, 0x24272c, GRIP_AT[0] - 0.03, GRIP_AT[1] + 0.36, GRIP_AT[2]).box(0.07, 0.03, 0.03, 0x24272c, GRIP_AT[0] - 0.03, GRIP_AT[1] - 0.36, GRIP_AT[2]);   // (barre d'appui du receveur, au bord avant de la porte)
    if (!top) {
      b.box(1.76, 0.08, 2.8, 0x2b2f36, 0, 2.21, 0.8).box(1.5, 0.34, 2.1, 0x7a5a32, 0, 2.4, 0.8).box(0.85, 0.32, 0.85, 0x2d6a4f, 0.28, 2.7, 0.45).box(0.65, 0.3, 0.65, 0xa8382b, -0.38, 2.66, 1.5);
      if (!low) b.box(0.28, 0.42, 0.28, 0x1d6fd1, 0.55, 2.42, -0.55).add(new THREE.CylinderGeometry(0.34, 0.34, 0.2, 10), TYRE, -0.35, 2.32, -0.55);
    }
    if (apprenti && !human) b.box(0.3, 0.66, 0.26, shirt, W / 2 + 0.2, 1.48, -0.1).box(0.24, 0.68, 0.22, 0x22252a, W / 2 + 0.2, 0.86, -0.1).ball(0.15, SKIN[0], W / 2 + 0.2, 1.96, -0.1);
  }, human ? [human] : []);
  if (human) Object.assign(g.userData, { receveurStatic: human, receveurShirt: shirt });   // (setReceveurLive : le receveur animé quand le 207 est près du joueur)
  return g;
}
// Le receveur du 207 (l'auteur, 22/11 : « il faut que le receveur prenne aussi la forme humaine ») : un corps MakeHuman (comme les piétons), figé debout sur le marchepied
// de la porte ouverte, le bras levé (il appelle les clients), tourné vers la rue ; un modèle par couleur de chemise, partagé par tous les 207
const _receveurs = new Map();
/** La tenue du receveur (22/11) : casquette noire, maillot de couleur uni, short rouge, baskets blanches (aussi pour le receveur animé du bus du joueur, main.js). */
const tenueBase = shirt => ({ model: 'homme', shirt, paintShirt: shirt, shorts: 0xc8102e, pants: 0xc8102e, shoes: 0xf2f2f2, cap: 0x17181b, untucked: false, sandals: false, civil: true, beard: false, hair: 'short', bag: null, phone: false,
  basin: null, headwrap: null, dress: false, pagneTop: false, longSleeves: false, idle: 0, height: 1.0, girth: 0.97, skinTint: 1 });
let _grip = null;
/** Angles du bras gauche qui tient la barre de la porte (calculés une fois : tous les receveurs ont la même taille). */
export function receveurGrip() {
  if (!_grip) {
    const ch = new Character(outfit('man', tenueBase(0xffffff)));
    ch.mesh.position.set(...RCV_STEP);
    ch.mesh.rotation.y = RCV_YAW;
    _grip = solveGrip(ch, GRIP_AT);
  }
  return _grip;
}
export const receveurTenue = shirt => ({ ...tenueBase(shirt), grip: receveurGrip() });
export const RECEVEUR_POSTE = { pos: RCV_STEP, yaw: RCV_YAW };
const _rpool = new Map();
/** Remplace le receveur figé d'un 207 par un receveur animé (pris dans une petite réserve) quand `live`, ou l'inverse ; renvoie le personnage animé (ou null). */
export function setReceveurLive(g, live) {
  const st = g.userData.receveurStatic;
  if (!st) return null;
  if (live && !g.userData.receveurChar) {
    const sh = g.userData.receveurShirt, list = _rpool.get(sh) ?? [];
    _rpool.set(sh, list);
    const ch = list.pop() ?? new Character(outfit('man', receveurTenue(sh)));
    ch.mesh.position.copy(st.position);
    ch.mesh.rotation.y = st.rotation.y;
    g.add(ch.mesh);
    st.visible = false;
    g.userData.receveurChar = ch;
  } else if (!live && g.userData.receveurChar) {
    const ch = g.userData.receveurChar;
    g.remove(ch.mesh);
    st.visible = true;
    _rpool.get(g.userData.receveurShirt).push(ch);
    g.userData.receveurChar = null;
  }
  return g.userData.receveurChar ?? null;
}
function receveurHumain(shirt, W) {
  if (!_receveurs.has(shirt)) {
    _receveurs.set(shirt, bakeStatic(outfit('man', receveurTenue(shirt)), 'call', [0, 0, 0]));
  }
  const m = _receveurs.get(shirt).clone();
  m.position.set(...RCV_STEP);                    // (dans l'ouverture de la porte, les deux pieds sur le plancher)
  m.rotation.y = RCV_YAW;                         // (l'avant du personnage est vers -z : il regarde vers l'avant et la rue)
  m.userData.rider = 'receveur';
  return m;
}
/** Fourgonnette Toyota Hiace, Sprinter : tout jaune, blanc à bas jaune, ou blanc à bande rouge. */
export function createVan() {
  const r = Math.random(), body = r < 0.6 ? 0xf2c200 : 0xf4f5f7, stripe = r < 0.6 ? 0x1d4fa0 : 0xc8282e, under = r >= 0.6 && r < 0.85 ? 0xf2c200 : null;
  const sp = { ...VAN, paint: (u, j) => (under && j === 2 ? under : undefined) };
  return vehicle(`van|${body}|${under}`, VAN.L, VAN.W, (b, low) => {
    loftBody(b, sp, body, low);
    realWheels(b, VAN, low);
    realDetails(b, VAN, body, low, { yF: 0.86, yR: 0.82, doors: [-1.2, -0.15], grille: [0.5, 0.18], lower: 0.5 });
    for (const sx of [-1, 1]) b.box(0.012, 0.11, VAN.L * 0.78, stripe, sx * (VAN.W / 2 + 0.002), 1.0, 0.1);
    for (const sx of [-0.42, 0.42]) b.box(0.62, 0.46, 0.04, GLASS, sx, 1.62, VAN.L / 2 - 0.04);
    if (!low) taxiSticker(b, VAN.W, 1.2, -1.28);
  });
}
/** Tricycle « Keke » de passagers, ou tricycle cargo bleu à bâche verte. */
export function createTricycle() {
  const cargo = Math.random() < 0.42, L = cargo ? 3.25 : 2.95, W = 1.4;
  const col = cargo ? 0x1d4fa0 : Math.random() < 0.8 ? 0xf0c020 : pick([0x2b8a3e, 0x1d4fa0]), roofCol = cargo ? 0x2b7a3e : 0x4e5257, rz = L / 2 - 0.42;   // (photo « 3pigner » : jaune, bâche gris foncé)
  const sp = { L, W, sill: 0.34, axle: 0.26, R: 0.32, wheelZ: [rz], mirrorY: 1.1, mirrorZ: -0.75, mirrorColor: 0x1a1a1a, tumble: 0.03, shield: [0.12, 0.27], pillars: [[0.1, 0.14], [0.26, 0.3], [0.62, 0.66], [0.92, 1]], lamp: 0, tail: 0.03, tyre: 0.14, roof: roofCol, glass: cargo ? GLASS : 0x3b3e42, pillarColor: cargo ? null : 0x15171a,
    hw: [[0, 0.3], [0.05, 0.42], [0.15, 0.62], [0.3, 0.92], [0.42, 1], [1, 1]],
    top: [[0, 0.5], [0.02, 0.76], [0.08, 0.92], [0.13, 1.0], [0.26, 1.7], [0.33, 1.78], [0.96, 1.76], [0.99, 1.6], [1, 0.6]],
    belt: [[0, 0.46], [0.13, 0.94], [0.35, 1.0], [1, 1.0]] };
  const sc = { ...sp, top: [[0, 0.5], [0.02, 0.76], [0.08, 0.92], [0.13, 1.0], [0.26, 1.7], [0.33, 1.78], [0.4, 1.74], [0.44, 1.0], [1, 0.9]], belt: [[0, 0.46], [0.13, 0.94], [0.3, 1.0], [0.44, 0.92], [1, 0.86]], pillars: [[0.1, 0.14], [0.26, 0.3]], roof: col };
  const shirt = pick([0xffffff, 0xd9480f, 0x1d4fa0]);
  return vehicle(`keke|${cargo}|${col}|${shirt}`, L, W, (b, low) => {
    loftBody(b, cargo ? sc : sp, col, low);
    realWheels(b, sp, low);
    b.add(new THREE.CylinderGeometry(0.25, 0.25, 0.12, low ? 8 : 12).rotateZ(Math.PI / 2), TYRE, 0, 0.25, -L / 2 + 0.28).add(new THREE.CylinderGeometry(0.14, 0.14, 0.13, 6).rotateZ(Math.PI / 2), RIM, 0, 0.25, -L / 2 + 0.28)
      .box(0.14, 0.26, 0.42, col, 0, 0.5, -L / 2 + 0.3).cyl(0.1, 0.1, 0.08, 0xfff8dc, 0, 0.82, -L / 2 + 0.03, Math.PI / 2, 0, 0, 8);
    if (cargo) b.add(new THREE.CylinderGeometry(W * 0.48, W * 0.48, L * 0.5, low ? 8 : 12, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), roofCol, 0, 1.06, L * 0.24);
    b.box(0.34, 0.46, 0.26, shirt, 0, 1.18, -0.42).ball(0.13, SKIN[0], 0, 1.54, -0.42);
    if (!cargo) {                                   // la bâche qui retombe à l'arrière, l'armature noire, le passager assis derrière
      b.box(W * 0.98, 0.5, 0.06, roofCol, 0, 1.5, L / 2 - 0.12).box(0.04, 0.9, 0.04, 0x15171a, W * 0.47, 1.3, -L * 0.17).box(0.04, 0.9, 0.04, 0x15171a, -W * 0.47, 1.3, -L * 0.17);
      b.box(0.36, 0.44, 0.28, pick([0xd9480f, 0x7b2cbf, 0x2b8a3e]), 0.25, 1.12, 0.55).ball(0.13, SKIN[1], 0.25, 1.48, 0.55);
    }
  });
}
/** La vague jaune, rouge, bleu de Transco et son logo, sur le flanc (photos). mirror : flanc gauche (l'avant est à gauche de l'image). */
const _trMat = {};
function transcoLivery(mirror, logo = true) {
  const key = `${mirror}${logo}`;
  if (_trMat[key]) return _trMat[key];
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d'), X = v => (mirror ? 1024 - v : v);
  const band = (dy, col, th) => {                  // de l'arrière (gauche, en haut) vers l'avant (droite, en bas), avec la vague sur la roue arrière
    x.beginPath(); x.moveTo(X(0), 60 + dy); x.bezierCurveTo(X(140), 60 + dy, X(220), 150 + dy, X(380), 205 + dy); x.bezierCurveTo(X(520), 240 + dy, X(760), 236 + dy, X(1024), 232 + dy);
    x.lineWidth = th; x.strokeStyle = col; x.stroke();
  };
  band(-12, '#f2c200', 11); band(-1, '#d6202a', 11); band(10, '#1d4fa0', 11);
  if (logo) {
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 44px sans-serif'; x.fillStyle = '#1d4fa0'; x.fillText('TRANSCO', X(250), 150);
    x.lineWidth = 6; x.strokeStyle = '#d6202a'; x.beginPath(); x.arc(X(250) - 40, 162, 70, Math.PI * 1.22, Math.PI * 1.55); x.stroke();
    x.strokeStyle = '#1d4fa0'; x.beginPath(); x.arc(X(250) - 30, 168, 82, Math.PI * 1.22, Math.PI * 1.5); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_trMat[key] = new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.35 }));
}
/** Grand bus Transco (photo « tranco ») : blanc, grande vague jaune, rouge, bleu sur le flanc, grand pare-brise noir avec la girouette orange, portes vitrées, TRANSCO sur la face avant. */
export function createCityBus() {
  const { L, W } = TRANSCO;
  return vehicle('transco', L, W, (b, low) => {
    loftBody(b, TRANSCO, 0xf4f5f7, low);
    realWheels(b, TRANSCO, low);
    realDetails(b, TRANSCO, 0xf4f5f7, low, { yF: 0.92, yR: 0.9, grille: [0.5, 0.1], lower: 0.62 });
    b.box(W * 0.72, 0.26, 0.07, 0x111111, 0, 2.86, -L / 2 + 0.2).box(W * 0.3, 0.14, 0.08, 0xff9914, W * 0.15, 2.86, -L / 2 + 0.19);   // la girouette (L01)
    b.box(W * 0.72, 0.22, 2.6, 0xe8eaed, 0, 3.2, -1.2).box(W * 0.72, 0.22, 2.2, 0xe8eaed, 0, 3.2, 2.4);
    for (const dz of [-L * 0.42, 0.6]) b.box(0.04, 1.95, 1.0, 0x23282e, W / 2 + 0.006, 1.5, dz).box(0.045, 1.6, 0.4, GLASS, W / 2 + 0.012, 1.62, dz - 0.24).box(0.045, 1.6, 0.4, GLASS, W / 2 + 0.012, 1.62, dz + 0.24);
    for (const sx of [-1, 1]) b.box(0.32, 0.05, 0.05, 0x1a1a1a, sx * (W / 2 + 0.14), 2.55, -L / 2 + 0.15).box(0.1, 0.36, 0.08, 0x1a1a1a, sx * (W / 2 + 0.3), 2.34, -L / 2 + 0.15);
    for (const sx of [-1, 1]) b.box(0.3, 0.06, 0.05, 0xf2c200, sx * W * 0.2, 0.7, -L / 2 - 0.005).box(0.3, 0.06, 0.05, 0x1d4fa0, sx * W * 0.2, 0.64, -L / 2 - 0.005);
  }, [decalMesh(transcoLivery(false), [[L * 0.86, 1.5, W / 2 + 0.03, 1.2, 0.3, Math.PI / 2]]), decalMesh(transcoLivery(true), [[L * 0.86, 1.5, -(W / 2 + 0.03), 1.2, 0.3, -Math.PI / 2]]),
    decalMesh(decalMat('TRANSCO', '#f4f5f7', '#1d4fa0'), [[1.3, 0.24, 0, 1.0, -L / 2 - 0.03, Math.PI]])]);
}
/** Midibus Transco (photo « tranco2 ») : blanc, nez arrondi à calandre noire, portes avant, la vague, le numéro. */
const MIDI = { ...COASTER, L: 8.4, W: 2.3, wheelZ: [-2.75, 2.5], mirrorZ: -3.6, roof: 0xf4f5f7, glass: 0x24333f };
export function createTranscoMidi() {
  const { L, W } = MIDI;
  return vehicle('transco_midi', L, W, (b, low) => {
    loftBody(b, { ...MIDI, pillarColor: 0x15181c }, 0xf4f5f7, low);
    realWheels(b, MIDI, low);
    realDetails(b, MIDI, 0xf4f5f7, low, { yF: 0.86, yR: 0.82, grille: [0.6, 0.16], lower: 0.5 });
    b.box(0.04, 1.8, 0.95, 0x23282e, W / 2 + 0.006, 1.42, -L / 2 + 1.4).box(0.045, 1.5, 0.82, GLASS, W / 2 + 0.012, 1.52, -L / 2 + 1.4);
    for (const sx of [-1, 1]) b.box(0.012, 0.035, L * 0.5, 0xf2c200, sx * (W / 2 + 0.004), 0.82, -L * 0.1).box(0.014, 0.035, L * 0.5, 0xd6202a, sx * (W / 2 + 0.005), 0.78, -L * 0.1).box(0.016, 0.035, L * 0.5, 0x1d4fa0, sx * (W / 2 + 0.006), 0.74, -L * 0.1);
  }, [decalMesh(transcoLivery(false), [[L * 0.8, 1.2, W / 2 + 0.03, 1.1, 0.5, Math.PI / 2]]), decalMesh(transcoLivery(true), [[L * 0.8, 1.2, -(W / 2 + 0.03), 1.1, 0.5, -Math.PI / 2]])]);
}
/** Camion : cabine arrondie à calandre chromée, échappement, plateau à ridelles chargé de sacs. */
export function createTruck() {
  const L = 7.4, W = 2.38, cab = pick([0xf2c200, 0xf2f2f0, 0xb91c1c, 0x1e3a8a, 0x2f6f3e]), bed = cab === 0xf2c200 ? 0xd9a900 : pick([0x1d4fa0, 0x6b4f2a, 0x2f6b45, 0x7a2828]);
  const CL = 2.6, z0 = -L / 2 + CL / 2, wf = -L / 2 + 0.95, wr = L / 2 - 1.5;
  const sp = { L: CL, W, z0, sill: 0.78, axle: 0.48, R: 0.56, wheelZ: [wf], mirrorY: 2.0, mirrorZ: wf - 0.45, mirrorColor: 0x1e2229, tumble: 0.05, tyre: 0.28, shield: [0.26, 0.42], pillars: [[0.24, 0.3], [0.72, 1]], lamp: 0.06, tail: 0, hw: HW_BOX,
    top: [[0, 0.95], [0.012, 1.25], [0.05, 1.5], [0.18, 1.6], [0.26, 1.8], [0.42, 2.72], [0.58, 2.9], [0.96, 2.85], [1, 1.1]], belt: [[0, 0.9], [0.26, 1.62], [1, 1.72]] };
  return vehicle(`truck|${cab}|${bed}`, L, W, (b, low) => {
    b.box(W * 0.78, 0.32, L * 0.94, 0x26292e, 0, 0.78, 0.1);
    loftBody(b, sp, cab, low);
    realWheels(b, sp, low);
    realWheels(b, { ...sp, wheelZ: [wr] }, low);
    b.box(W * 0.56, 0.62, 0.08, CHROME, 0, 1.28, -L / 2 + 0.04).box(W * 0.5, 0.54, 0.09, GRILLE, 0, 1.28, -L / 2 + 0.03).box(W * 1.02, 0.3, 0.26, 0x2b2f36, 0, 0.66, -L / 2 + 0.12)
      .cyl(0.28, 0.28, 1.1, 0x555b64, -W * 0.38, 0.8, -0.6, Math.PI / 2, 0, 0, low ? 6 : 10).cyl(0.07, 0.07, 2.2, CHROME, -W * 0.46, 2.0, z0 + CL / 2 + 0.05);
    const bedL = L - CL - 0.1, bz = L / 2 - bedL / 2;
    b.box(W, 0.22, bedL, 0x383c42, 0, 1.02, bz).box(W, 1.15, bedL - 0.1, bed, 0, 1.7, bz);
    if (!low) for (let z = bz - bedL / 2 + 0.2; z <= bz + bedL / 2 - 0.1; z += 0.95) for (const sx of [-1, 1]) b.box(0.06, 1.22, 0.08, 0x22252a, sx * (W / 2 + 0.01), 1.72, z);
    for (let i = 0; i < (low ? 4 : 12); i++) b.box(0.72, 0.42, 0.68, [0xe8e2d0, 0xd8c9a8, 0x2e5e4e, 0x303030][i % 4], (i % 3 - 1) * 0.72, 2.42 + (i >= 6 ? 0.38 : 0), bz - 1.5 + (i % 6) * 0.65);
    for (const sx of [-0.8, 0.8]) b.box(0.42, 0.14, 0.05, 0xb3131a, sx, 0.9, L / 2 + 0.02);
    b.box(0.46, 0.11, 0.02, PLATE_W, 0, 0.72, L / 2 + 0.02);
  });
}
// ---------- Camions lourds (photos du dossier Herman : Howo benne chargée de sacs, Howo camion-grue, semi-remorque AMICONGO, DAF plateau / frigorifique / bâché) ----------
/** Châssis commun : la cabine du camion de base (peinte à la couleur voulue), l'avant, les roues ; `body(b, low, g)` dessine la caisse derrière la cabine. */
function heavy(key, L, W, cab, rear, body, extra = []) {
  const CL = 2.6, z0 = -L / 2 + CL / 2, wf = -L / 2 + 0.95;
  const sp = { L: CL, W, z0, sill: 0.78, axle: 0.5, R: 0.58, wheelZ: [wf], mirrorY: 2.0, mirrorZ: wf - 0.45, mirrorColor: 0x1e2229, tumble: 0.05, tyre: 0.3, shield: [0.26, 0.42], pillars: [[0.24, 0.3], [0.72, 1]], lamp: 0.06, tail: 0, hw: HW_BOX,
    top: [[0, 0.95], [0.012, 1.25], [0.05, 1.5], [0.18, 1.6], [0.26, 1.8], [0.42, 2.72], [0.58, 2.9], [0.96, 2.85], [1, 1.1]], belt: [[0, 0.9], [0.26, 1.62], [1, 1.72]] };
  return vehicle(key, L, W, (b, low) => {
    b.box(W * 0.78, 0.32, L * 0.94, 0x26292e, 0, 0.78, 0.1);
    loftBody(b, sp, cab, low);
    realWheels(b, sp, low);
    realWheels(b, { ...sp, wheelZ: rear }, low);
    b.box(W * 0.56, 0.62, 0.08, CHROME, 0, 1.28, -L / 2 + 0.04).box(W * 0.5, 0.54, 0.09, GRILLE, 0, 1.28, -L / 2 + 0.03).box(W * 1.02, 0.3, 0.26, 0x2b2f36, 0, 0.66, -L / 2 + 0.12);
    body(b, low, { L, W, CL, z0: -L / 2 + CL + 0.12, z1: L / 2 - 0.08 });
    for (const sx of [-0.8, 0.8]) b.box(0.42, 0.14, 0.05, 0xb3131a, sx, 0.9, L / 2 + 0.02);
    b.box(0.46, 0.11, 0.02, PLATE_W, 0, 0.72, L / 2 + 0.02);
  }, extra);
}
/** Howo à benne orange chargée de sacs blancs sous une bâche bleue, un homme assis sur le chargement (photo vehicule111). */
export function createTipperTruck() {
  const L = 9.4, W = 2.5, orange = 0xe2601a;
  return heavy('tipper', L, W, orange, [L / 2 - 1.15, L / 2 - 2.45], (b, low, g) => {
    const len = g.z1 - g.z0, zc = (g.z0 + g.z1) / 2;
    b.box(W, 0.22, len, 0x383c42, 0, 1.0, zc).box(W * 0.98, 1.45, len, orange, 0, 1.85, zc).box(W * 0.98, 0.7, 0.16, orange, 0, 2.95, g.z0 + 0.1);   // benne et tête de benne
    if (!low) for (let z = g.z0 + 0.5; z < g.z1 - 0.2; z += 0.75) for (const sx of [-1, 1]) b.box(0.05, 1.4, 0.08, 0xb44a12, sx * (W * 0.49 + 0.02), 1.86, z);
    // sacs blancs empilés en tas, bâche bleue à l'avant
    const rows = low ? 3 : 7;
    for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) b.box(0.78, 0.46 + (r % 2) * 0.05, 0.62, r % 3 === 1 ? 0xe6e0d0 : 0xf3f1ea, (c - 1) * 0.78, 2.78 + (c === 1 ? 0.42 : 0), g.z1 - 0.5 - r * 0.62);
    b.box(W * 0.9, 0.22, len * 0.42, 0x2f7bd8, 0, 3.55, g.z0 + len * 0.28, 0.12).box(0.5, 0.5, 1.2, 0x2f7bd8, -0.5, 3.35, g.z0 + len * 0.05);
    if (!low) b.add(new THREE.CapsuleGeometry(0.17, 0.4, 2, 6).scale(1.05, 1, 0.8), 0xc9b38a, 0.25, 3.78, g.z0 + len * 0.55, 0.25).ball(0.13, SKIN[1], 0.25, 4.2, g.z0 + len * 0.5);
  });
}
/** Semi-remorque AMICONGO : tracteur blanc, conteneur bleu de 40 pieds, AMICONGO en blanc sur le flanc (photo vehicule222). */
export function createContainerTruck() {
  const L = 14.2, W = 2.5, blue = 0x24508c;
  return heavy('container_ami', L, W, 0xf3f4f6, [L / 2 - 1.2, L / 2 - 2.5, L / 2 - 3.8], (b, low, g) => {
    const len = g.z1 - g.z0, zc = (g.z0 + g.z1) / 2;
    b.box(W * 0.4, 0.3, len, 0x2a2d32, 0, 1.0, zc);
    b.box(W, 0.2, len + 0.3, 0x2a2d32, 0, 1.08, zc + 0.7).box(W * 0.98, 2.75, len - 0.5, blue, 0, 2.55, zc + 0.55);
    b.box(W * 0.2, 0.25, 0.6, 0x1c1f24, 0, 1.0, g.z0 + 0.5);                                    // sellette
    if (!low) for (let z = g.z0 + 0.9; z < g.z1 - 0.4; z += 0.55) for (const sx of [-1, 1]) b.box(0.04, 2.7, 0.06, 0x1d4274, sx * (W * 0.49 + 0.015), 2.55, z);   // nervures
  }, [decalMesh(decalMat('AMICONGO', '#24508c', '#f4f6f8'), [...onSides(5.2, 0.8, 2.5, 2.9, 1.2)]), decalMesh(decalMat('AMICONGO', '#f3f4f6', '#1d4fa0'), [[1.4, 0.26, 0, 1.0, -14.2 / 2 - 0.03, Math.PI]])]);
}
/** Howo camion-grue : cabine rouge, plateau rouge à ridelles, grue jaune repliée vers l'avant au-dessus de la cabine (photo vehicule333). */
export function createCraneTruck() {
  const L = 10.2, W = 2.5, red = 0xc12a1e, yellow = 0xf2b400;
  return heavy('crane', L, W, red, [L / 2 - 1.1, L / 2 - 2.35, L / 2 - 3.6], (b, low, g) => {
    const len = g.z1 - g.z0, zc = (g.z0 + g.z1) / 2;
    b.box(W, 0.22, len, 0x383c42, 0, 1.0, zc).box(W * 0.98, 0.1, len * 0.52, 0xa82218, 0, 1.18, g.z1 - len * 0.26).box(W * 0.98, 0.62, len * 0.52, red, 0, 1.5, g.z1 - len * 0.26);   // plateau à ridelles
    b.box(1.5, 0.9, 1.3, yellow, 0, 1.6, g.z0 + 0.8).box(0.5, 1.5, 0.5, 0x3a3e44, 0, 2.0, g.z0 + 0.8);                                          // socle de la grue
    for (const sx of [-1, 1]) b.box(0.18, 0.18, 1.8, yellow, sx * 1.2, 1.1, g.z0 + 0.8).box(0.6, 0.12, 0.6, 0x2a2c30, sx * 1.9, 0.93, g.z0 + 0.8);   // stabilisateurs
    // flèche télescopique : trois éléments, de la base vers l'avant, au-dessus de la cabine
    b.box(0.5, 0.6, 3.0, yellow, 0, 3.0, g.z0 - 0.5, -0.05).box(0.38, 0.46, 2.6, 0xe0a200, 0, 3.15, g.z0 - 2.4, -0.1).box(0.28, 0.34, 1.8, yellow, 0, 3.25, g.z0 - 3.9, -0.12);
    b.box(0.07, 0.07, 1.0, 0x2a2c30, 0, 2.85, g.z0 - 4.6).box(0.3, 0.2, 0.2, 0x2a2c30, 0, 2.3, g.z0 - 4.6);
    for (const sx of [-0.45, 0.45]) b.box(0.25, 0.25, 0.25, 0xf28c00, sx, 3.05, g.z0 - 0.6);                                                  // gyrophares orange
  });
}
/** DAF à plateau (photos de l'annonce) : cabine blanche ou bleue, plateau bas à ridelles basses, chargement de blocs ou de palettes. */
export function createFlatbedTruck() {
  const L = 9.0, W = 2.5, cab = pick([0xf2f3f4, 0x1f55c2, 0x1f55c2]);
  return heavy(`flat|${cab}`, L, W, cab, [L / 2 - 1.2, L / 2 - 2.5], (b, low, g) => {
    const len = g.z1 - g.z0, zc = (g.z0 + g.z1) / 2;
    b.box(W, 0.22, len, 0x383c42, 0, 1.0, zc).box(W * 0.98, 0.12, len, 0x7a6a52, 0, 1.2, zc);
    for (const sx of [-1, 1]) b.box(0.06, 0.34, len, cab === 0xf2f3f4 ? 0xdcdfe3 : 0x1b3f8a, sx * (W * 0.49), 1.43, zc);
    b.box(W * 0.98, 0.85, 0.12, 0x2b2f36, 0, 1.6, g.z0 + 0.06);
    for (let i = 0; i < (low ? 2 : 6); i++) b.box(0.9, 0.5, 0.9, [0xa8a49a, 0x8d8a82, 0xb38a5a][i % 3], ((i % 2) - 0.5) * 1.0, 1.6 + Math.floor(i / 4) * 0.5, g.z0 + 1.0 + (i >> 1) * 1.1);
  });
}
/** DAF frigorifique : caisse blanche isotherme, groupe de froid au-dessus de la cabine, portes arrière à joints (photo de l'annonce). */
export function createReeferTruck() {
  const L = 9.6, W = 2.5;
  return heavy('reefer', L, W, 0xf3f4f6, [L / 2 - 1.2, L / 2 - 2.5], (b, low, g) => {
    const len = g.z1 - g.z0, zc = (g.z0 + g.z1) / 2;
    b.box(W, 0.22, len, 0x383c42, 0, 1.0, zc).box(W * 0.98, 2.65, len - 0.1, 0xf6f7f8, 0, 2.5, zc + 0.05).box(1.6, 0.62, 0.4, 0x9aa1a8, 0, 4.0, g.z0 + 0.35);
    if (!low) { b.box(0.03, 2.55, 0.05, 0xc9ced3, -0.62, 2.5, g.z1).box(0.03, 2.55, 0.05, 0xc9ced3, 0.62, 2.5, g.z1); b.box(W * 0.98, 0.08, len - 0.1, 0xdfe3e6, 0, 3.86, zc + 0.05); }
  });
}
/** DAF bâché : plateau avec ridelles et rideau bleu tendu sur des arceaux (photo de l'annonce). */
export function createCurtainTruck() {
  const L = 10.2, W = 2.5, curtain = pick([0x2a54a8, 0x2a54a8, 0x2f6b45]);
  return heavy(`curtain|${curtain}`, L, W, 0xf2f3f4, [L / 2 - 1.2, L / 2 - 2.5, L / 2 - 3.8], (b, low, g) => {
    const len = g.z1 - g.z0, zc = (g.z0 + g.z1) / 2;
    b.box(W, 0.22, len, 0x383c42, 0, 1.0, zc).box(W * 0.98, 2.55, len - 0.1, curtain, 0, 2.45, zc + 0.05).box(W * 0.98, 0.1, len - 0.1, 0xcfd6dc, 0, 3.78, zc + 0.05);
    if (!low) for (let z = g.z0 + 0.4; z < g.z1 - 0.2; z += 0.62) for (const sx of [-1, 1]) b.box(0.05, 2.5, 0.06, 0xdfe4e8, sx * (W * 0.49 + 0.02), 2.45, z);
  });
}
/** Camion-citerne SEP Congo (photo « sep ») : cabine blanche à bas gris foncé, calandre noire, citerne blanche à liseré rouge, SEP en rouge. */
export function createTanker() {
  const L = 9.2, W = 2.45, CL = 2.5, z0 = -L / 2 + CL / 2, wf = -L / 2 + 1.0, white = 0xf2f3f4, dark = 0x3a3e44;
  const sp = { L: CL, W, z0, sill: 0.8, axle: 0.5, R: 0.58, wheelZ: [wf], mirrorY: 2.1, mirrorZ: wf - 0.5, mirrorColor: 0x1e2229, tumble: 0.04, tyre: 0.3, shield: [0.24, 0.4], pillars: [[0.22, 0.26], [0.7, 1]], lamp: 0.07, tail: 0, hw: HW_BOX,
    top: [[0, 1.0], [0.012, 1.3], [0.05, 1.6], [0.18, 1.72], [0.24, 1.9], [0.4, 2.85], [0.56, 3.0], [0.96, 2.95], [1, 1.2]], belt: [[0, 0.95], [0.24, 1.72], [1, 1.8]],
    paint: (u, j) => (j <= 3 ? dark : undefined) };
  return vehicle('tanker_sep', L, W, (b, low) => {
    b.box(W * 0.78, 0.32, L * 0.95, 0x26292e, 0, 0.8, 0.1);
    loftBody(b, sp, white, low);
    realWheels(b, sp, low);
    for (const wz of [L / 2 - 2.6, L / 2 - 1.3]) realWheels(b, { ...sp, wheelZ: [wz] }, low);
    b.box(W * 0.58, 0.5, 0.08, 0x1b1d20, 0, 1.22, -L / 2 + 0.08).box(W * 1.02, 0.34, 0.28, 0x2b2f36, 0, 0.68, -L / 2 + 0.12);
    const TL = L - CL - 0.4, tz = L / 2 - TL / 2 - 0.1;
    b.add(new THREE.CylinderGeometry(1.08, 1.08, TL, low ? 10 : 20).rotateX(Math.PI / 2).scale(1, 0.92, 1), white, 0, 2.12, tz);
    for (const sx of [-1, 1]) b.box(0.03, 0.09, TL * 0.96, 0xd0202a, sx * 1.075, 2.0, tz);
    if (!low) {
      for (const k of [-1, 0, 1]) b.cyl(0.24, 0.24, 0.12, 0xc9ccd0, 0, 3.12, tz + k * TL * 0.3, 0, 0, 0, 10);
      b.box(0.9, 0.04, TL * 0.9, 0x8e949a, 0, 3.08, tz).box(0.3, 0.3, 0.02, 0xe8601c, 0.9, 2.0, L / 2 + 0.02);
    }
    for (const sx of [-0.8, 0.8]) b.box(0.42, 0.14, 0.05, 0xb3131a, sx, 0.95, L / 2 + 0.02);
  }, [decalMesh(decalMat('SEP', '#f2f3f4', '#d0202a'), [[0.9, 0.3, 0, 1.62, -L / 2 + 0.36, Math.PI]]),
    decalMesh(decalMat('SEP CONGO', '#f2f3f4', '#d0202a'), [[2.2, 0.42, 1.11, 2.25, L / 2 - 3.2, Math.PI / 2], [2.2, 0.42, -1.11, 2.25, L / 2 - 3.2, -Math.PI / 2]])]);
}
// Conducteur et passager de wewa (corps MakeHuman, tools/wewa_mh.py), figés assis ; sans le fichier, le jeu garde des silhouettes simples
const WEWA = await new GLTFLoader().loadAsync(new URL('../data/personnages/wewa.glb', import.meta.url).href).then(g => {
  const o = {};
  g.scene.traverse(m => { if (m.isMesh) o[m.name] = m.geometry; });
  return o;
}).catch(() => null);
__mark('models.js : wewa.glb chargé');
const PEOPLE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
// Les occupants du wewa avec les modèles MakeHuman du dossier Herman (data/personnages/*.glb, comme les piétons) : figés à califourchon à leur première apparition,
// quelques conducteurs (gilet jaune à bandes grises, numéro noir dans le dos, casque, chacun son numéro) et quelques passagers, tirés au sort sur chaque moto
const RIDE_OK = hasModel('homme');
const _riders = { drv: [], pas: [] };
const DRV_NUMS = [], PAS_N = 6;
function ridePeople(look) {
  if (!_riders.drv.length) {
    for (let i = 0; i < PAS_N; i++) {
      const id = 100 + Math.floor(Math.random() * 900);
      const o = outfit('man', { model: 'homme', shirt: pick([0xd9480f, 0xe0a030, 0x2b8a3e, 0xd9480f]), pants: 0x24344f, shoes: 0x17181b, vest: 0xd6dc24, vestRings: 2, vestK: 0.8, helmet: pick([0x1a2a55, 0x2a2d33, 0xd8d8d8]), helmetFull: true, civil: true,
        id, idScale: 1.7, beard: false, hair: 'short', bag: null, phone: false, cap: null, basin: null, headwrap: null, dress: false, pagneTop: false, longSleeves: true, idle: 0, height: 0.97 + Math.random() * 0.08, girth: 0.95 + Math.random() * 0.15,
        ride: { arm: [0.8, 0.3, 0.2], lean: 0.04, grip: [-0.36, 1.08, -0.52] } });
      _riders.drv.push({ id, lod: bakeStatic(o, 'ride', [0, 0.9, 0.06]) });
      const fem = i % 3 === 2;
      const q = outfit(fem ? 'woman' : 'man', { shirt: pick([0xffffff, 0x1d4fa0, 0xc92a2a, 0x2b8a3e, 0x7b2cbf]), pants: pick([0x24344f, 0x17181b, 0x3b3f47]), dress: false, pagneTop: false, headwrap: null, basin: null, bag: null, phone: false, cap: null, idle: 0,
        longSleeves: true, height: 0.95 + Math.random() * 0.08, ride: { arm: [0.25, 0.75, 0.16], lean: 0.03 } });
      _riders.pas.push(bakeStatic(q, 'ride', [0, 0.92, 0.5]));
    }
  }
  const d = (look?.num && _riders.drv.find(r => r.id === look.num)) || pick(_riders.drv);
  const drv = d.lod.clone(), pas = pick(_riders.pas).clone();     // (les maillages restent partagés)
  drv.userData.rider = 'conducteur'; drv.userData.num = d.id;
  pas.userData.rider = 'passager';
  return { drv, pas };
}

function wewaRider(kind) {
  const lod = new THREE.LOD();
  for (const [q, d] of [['h', 0], ['l', LOD_DIST]]) { const m = new THREE.Mesh(WEWA[`${kind}_${q}`], PEOPLE_MAT); m.castShadow = true; lod.addLevel(m, d); }
  lod.userData.rider = kind;
  return lod;
}
// Le numéro du conducteur, en noir dans le dos du gilet jaune (l'auteur, 08/11 : « un numéro en noir à trois chiffres, exemple 459 ») :
// une vingtaine de numéros, chacun sa texture ; posé sur le dos, à hauteur de poitrine (mesuré sur le corps du conducteur)
const WEWA_BACK = WEWA ? (() => {
  const p = WEWA.conducteur_h.attributes.position;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  const yc = y0 + (y1 - y0) * 0.68;
  let zb = -Infinity;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - yc) < 0.05 && Math.abs(p.getX(i)) < 0.1) zb = Math.max(zb, p.getZ(i));
  return zb > -Infinity ? { y: yc, z: zb + 0.012 } : null;
})() : null;
const WEWA_NUMS = Array.from({ length: 20 }, () => 100 + Math.floor(Math.random() * 900));
const _nums = {};
function wewaNumber(n = pick(WEWA_NUMS)) {
  if (!_nums[n]) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 80;
    const x = c.getContext('2d');
    x.fillStyle = '#d6dc24'; x.fillRect(0, 0, 128, 80);
    x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 66px sans-serif';
    x.fillText(String(n), 64, 43);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    _nums[n] = new THREE.MeshLambertMaterial({ map: t });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), _nums[n]);
  m.position.set(0, WEWA_BACK.y, WEWA_BACK.z);
  m.userData.rider = 'conducteur';                    // (il descend avec lui au contrôle de police)
  m.userData.num = n;
  return m;
}
/** Moto-taxi « wewa » (photo du dossier Acteurs) : moto type Boxer, réservoir galbé, selle longue, porte-bagages, pare-carter, rétroviseurs. Conducteur en gilet jaune et casque, parfois un passager. */
// look : { tank, num } pour garder la même moto et le même conducteur (la moto du joueur, quand le client monte ou descend)
export function createMoto({ riders: only = null, look = null } = {}) {   // only : nombre de personnes imposé (la moto du joueur part seule)
  const L = 2.05, W = 0.82, tank = look?.tank ?? pick([0xb91c1c, 0x17181b, 0x1e3a8a, 0x17181b]), riders = only ?? 2, helmet = pick([0x1a2a55, 0x2a2d33, 0xd8d8d8]), shirt = pick([0xd9480f, 0xffffff, 0x2b8a3e, 0x1d4fa0, 0x7b2cbf]);
  const m = vehicle(`moto|${tank}|${WEWA || RIDE_OK ? 0 : `${riders}|${helmet}|${shirt}`}`, L, W, (b, low) => {
    const seg = low ? 8 : 16, black = 0x17181b;
    for (const z of [-0.7, 0.7]) {
      b.add(new THREE.CylinderGeometry(0.31, 0.31, 0.1, seg).rotateZ(Math.PI / 2), TYRE, 0, 0.31, z).add(new THREE.CylinderGeometry(0.23, 0.23, 0.11, seg).rotateZ(Math.PI / 2), low ? RIM : 0x24262a, 0, 0.31, z);
      if (!low) {
        for (let k = 0; k < 6; k++) b.box(0.012, 0.44, 0.012, RIM, 0.062, 0.31, z, k * Math.PI / 6).box(0.012, 0.44, 0.012, RIM, -0.062, 0.31, z, k * Math.PI / 6);
        b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8).rotateZ(Math.PI / 2), HUB, 0, 0.31, z);
      }
      b.add(new THREE.SphereGeometry(0.35, low ? 6 : 12, 4, 0, Math.PI * 2, 0, Math.PI * 0.3).scale(0.34, 1, 1.05), z < 0 ? tank : black, 0, 0.33, z);    // garde-boue
    }
    for (const sx of [-0.065, 0.065]) b.box(0.032, 0.66, 0.032, CHROME, sx, 0.64, -0.58, -0.32).box(0.012, 0.28, 0.012, CHROME, sx * 3.2, 1.21, -0.5, -0.1);   // fourche, tiges de rétroviseurs
    b.add(new THREE.SphereGeometry(0.2, low ? 6 : 14, low ? 5 : 10).scale(0.72, 0.68, 1.32), tank, 0, 0.9, -0.2)                                                // réservoir
      .add(new THREE.SphereGeometry(0.085, low ? 6 : 12, low ? 4 : 8).scale(1, 1, 0.5), 0xfff4cf, 0, 0.96, -0.75).box(0.14, 0.14, 0.1, black, 0, 0.96, -0.69)    // phare et sa coque
      .box(0.72, 0.028, 0.028, 0x222222, 0, 1.08, -0.52).box(0.09, 0.03, 0.035, 0x0e0f11, 0.36, 1.08, -0.52).box(0.09, 0.03, 0.035, 0x0e0f11, -0.36, 1.08, -0.52)   // guidon et poignées
      .box(0.1, 0.06, 0.02, 0x10181f, 0.21, 1.36, -0.51, 0, 0.2, 0).box(0.1, 0.06, 0.02, 0x10181f, -0.21, 1.36, -0.51, 0, -0.2, 0)                                  // rétroviseurs
      .add(new THREE.SphereGeometry(0.2, low ? 6 : 12, low ? 4 : 8).scale(0.66, 0.26, 2.3), 0x141416, 0, 0.82, 0.32)                                              // selle longue
      .box(0.24, 0.3, 0.38, 0x4a4f57, 0, 0.56, -0.14).box(0.18, 0.12, 0.3, 0x2e3137, 0, 0.36, -0.14)                                                              // moteur
      .box(0.03, 0.2, 0.34, tank, 0.16, 0.62, 0.3).box(0.03, 0.2, 0.34, tank, -0.16, 0.62, 0.3)                                                                  // caches latéraux
      .box(0.34, 0.03, 0.36, 0x202226, 0, 0.92, 0.72).box(0.14, 0.1, 0.03, 0xb3131a, 0, 0.84, 0.91)                                                               // porte-bagages et feu
      .cyl(0.045, 0.035, 0.85, CHROME, 0.17, 0.42, 0.36, Math.PI / 2 - 0.12, 0, 0, 8).box(0.46, 0.03, 0.03, 0x2a2c30, 0, 0.36, -0.36);                             // échappement, repose-pieds
    if (!WEWA && !RIDE_OK) for (let i = 0; i < riders; i++) {
      const z = -0.12 + i * 0.44, top = i === 0 ? 0xd6dc24 : shirt;
      b.add(new THREE.CapsuleGeometry(0.17, 0.3, 2, low ? 5 : 8).scale(1.05, 1, 0.72), top, 0, 1.28, z, 0.08).ball(0.14, SKIN[i % 3], 0, 1.72, z);
      if (i === 0) b.ball(0.18, helmet, 0, 1.75, z, 1, 0.95, 1.08);
    }
  }, RIDE_OK ? (() => { const r = ridePeople(look); return riders > 1 ? [r.drv, r.pas] : [r.drv]; })()
    : WEWA ? [wewaRider('conducteur'), ...(WEWA_BACK ? [wewaNumber(look?.num)] : []), ...(riders > 1 ? [wewaRider('passager')] : [])] : []);
  let num = null;
  m.traverse(c => { if (c.userData.num) num = c.userData.num; });
  m.userData.look = { tank, num };
  return m;
}

// ---------- Véhicules du dossier Acteurs ----------
const _decals = {};
/** Inscription sur une carrosserie (matériau partagé par tous les véhicules qui la portent). */
function decalMat(text, bg, fg) {
  const k = text + bg + fg;
  if (!_decals[k]) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 256, 64);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    let size = 46;
    do { x.font = `bold ${size}px sans-serif`; size -= 2; } while (x.measureText(text).width > 240);
    x.fillText(text, 128, 33);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    _decals[k] = new THREE.MeshLambertMaterial({ map: t });
  }
  return _decals[k];
}
/** Plusieurs panneaux d'une même inscription en un seul maillage : [largeur, hauteur, x, y, z, rotation]. */
function decalMesh(mat, list) {
  const geos = list.map(([w, h, x, y, z, ry]) => new THREE.PlaneGeometry(w, h).rotateY(ry).translate(x, y, z));
  const g = mergeGeometries(geos);
  geos.forEach(q => q.dispose());
  return new THREE.Mesh(g, mat);
}
const onSides = (w, h, W, y, z) => [[w, h, -(W / 2 + 0.025), y, z, -Math.PI / 2], [w, h, W / 2 + 0.025, y, z, Math.PI / 2]];
/** Rampe de gyrophares bleu et rouge. */
function lightBar(b, y, z, w = 1.2) {
  b.box(w, 0.06, 0.26, 0x1a1c20, 0, y, z).box(w * 0.42, 0.13, 0.22, 0xd21f26, -w * 0.28, y + 0.09, z).box(w * 0.42, 0.13, 0.22, 0x1f55d6, w * 0.28, y + 0.09, z).box(w * 0.14, 0.13, 0.22, 0xf0f0f0, 0, y + 0.09, z);
}
/** Pick-up de la police : blanc, portières noires, POLICE en lettres dorées, gyrophares, policiers assis à l'arrière (photo « police »). */
export function createPolicePickup() {
  const { L, W } = PICKUP, col = 0xf2f4f7, blk = 0x14161a, navy = 0x16233f;
  const sp = { ...PICKUP, paint: (u, j) => (j >= 2 && j <= 3 && u > 0.19 && u < 0.54 ? blk : undefined) };
  return vehicle('police_pickup', L, W, (b, low) => {
    loftBody(b, sp, col, low);
    realWheels(b, PICKUP, low);
    realDetails(b, PICKUP, 0x1a1a1a, low, { yF: 0.92, yR: 0.96, doors: [-0.3], lower: 0.5 });
    b.box(W * 0.84, 0.03, L * 0.38, 0x26292e, 0, 1.17, L * 0.28).box(0.46, 0.26, 1.5, 0x2a2d33, 0, 1.3, L / 2 - 0.9).box(0.08, 0.72, 0.08, 0x15181c, W * 0.47, 1.36, -1.02);
    lightBar(b, 1.78, -0.25);
    for (const sx of [-1, 1]) {
      b.box(0.05, 0.05, 1.5, 0x22252a, sx * (W * 0.47), 1.5, L / 2 - 0.9);
      for (const k of [0, 1]) {
        const z = L / 2 - 1.3 + k * 0.72, x = sx * 0.42;
        b.box(0.36, 0.52, 0.26, navy, x, 1.68, z).box(0.42, 0.16, 0.3, navy, x + sx * 0.14, 1.4, z).ball(0.13, SKIN[k], x, 2.08, z).ball(0.15, 0x111318, x, 2.17, z, 1.05, 0.42, 1.05);
      }
    }
  }, [decalMesh(decalMat('POLICE', '#14161a', '#c9a227'), [...onSides(1.32, 0.3, W, 0.82, -0.3), [1.3, 0.26, 0, 0.98, L / 2 + 0.03, 0]])]);
}
/** Fourgon de la police (photos « vehicules polices routières ») : bleu nuit, bandes rouge et jaune, gyrophares, POLICE au-dessus du pare-brise. */
export function createPoliceVan() {
  const { L, W } = FORCE, navy = 0x14264d;
  return vehicle('police_van', L, W, (b, low) => {
    loftBody(b, FORCE, navy, low);
    realWheels(b, FORCE, low);
    realDetails(b, FORCE, navy, low, { yF: 0.92, yR: 0.82, doors: [-1.5, -0.55], grille: [0.62, 0.3], lower: 0 });
    for (const sx of [-1, 1]) b.box(0.012, 0.09, L * 0.76, 0xc8102e, sx * (W / 2 + 0.003), 1.12, 0.2).box(0.012, 0.07, L * 0.76, 0xe0a800, sx * (W / 2 + 0.003), 0.74, 0.2);
    for (const sx of [-0.48, 0.48]) b.box(0.72, 0.62, 0.04, GLASS, sx, 1.76, L / 2 - 0.05);
    b.box(W * 0.9, 0.08, 0.5, 0xb8bcc0, 0, 0.36, L / 2 + 0.16);
    lightBar(b, 2.43, -L * 0.2, 1.5);
  }, [decalMesh(decalMat('POLICE', '#f4f4f0', '#14264d'), [[1.3, 0.22, 0, 2.2, -L * 0.3 - 0.02, Math.PI]]),
    decalMesh(decalMat('POLICE', '#14264d', '#ffffff'), [...onSides(1.15, 0.3, W, 1.34, L * 0.2), [1.1, 0.28, 0, 1.3, L / 2 + 0.02, 0]])]);
}
/** Ambulance (photos « ambulance », « Ambulance 2 ») : 4x4 long et carré, blanc, croix rouges sur les vitres, bande rouge à damier, AMBULANCE en rouge,
 *  gyrophare bleu, roue de secours sur la porte arrière, snorkel. */
const AMBU4 = { L: 5.2, W: 1.9, sill: 0.5, axle: 0.4, R: 0.48, wheelZ: [-1.65, 1.35], mirrorY: 1.25, mirrorZ: -1.0, mirrorColor: 0x1a1a1a, tumble: 0.06, shield: [0.18, 0.27], pillars: [[0.18, 0.2], [0.36, 0.38], [0.48, 0.5], [0.72, 0.74], [0.96, 1]], hw: HW_BOX, lamp: 0.04, tail: 0.02,
  top: [[0, 0.8], [0.01, 1.02], [0.04, 1.14], [0.15, 1.2], [0.19, 1.26], [0.26, 2.0], [0.32, 2.08], [0.985, 2.08], [1, 0.9]], belt: [[0, 0.75], [0.18, 1.2], [1, 1.26]] };
export function createAmbulance() {
  const { L, W } = AMBU4, red = 0xc8102e, white = 0xf6f7f8;
  return vehicle('ambulance', L, W, (b, low) => {
    loftBody(b, AMBU4, white, low);
    realWheels(b, AMBU4, low);
    realDetails(b, AMBU4, white, low, { yF: 0.95, yR: 1.0, doors: [-1.0, -0.05], grille: [0.5, 0.2], lower: 0.5 });
    for (const sx of [-1, 1]) {
      b.box(0.012, 0.09, L * 0.86, red, sx * (W / 2 + 0.003), 1.08, 0.2);
      if (!low) for (let k = 0; k < 22; k++) b.box(0.013, 0.05, 0.1, k % 2 ? red : white, sx * (W / 2 + 0.004), 0.8, -L * 0.35 + k * 0.2);
      for (const z of [0.55, 1.55]) b.box(0.016, 0.42, 0.13, red, sx * (W / 2 + 0.008), 1.62, z).box(0.016, 0.13, 0.42, red, sx * (W / 2 + 0.008), 1.62, z);   // les croix sur les vitres
    }
    b.box(0.08, 0.8, 0.08, 0x15181c, W * 0.48, 1.55, -1.25);                                                  // snorkel
    b.box(1.1, 0.06, 0.24, 0x1a1c20, 0, 2.11, -0.7).box(1.0, 0.13, 0.2, 0x1f55d6, 0, 2.2, -0.7);              // gyrophare
    b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.24, low ? 8 : 14).rotateX(Math.PI / 2), TYRE, -0.3, 1.15, L / 2 + 0.12)
      .add(new THREE.CylinderGeometry(0.24, 0.24, 0.26, low ? 6 : 12).rotateX(Math.PI / 2), 0xcfd2d6, -0.3, 1.15, L / 2 + 0.12);
  }, [decalMesh(decalMat('AMBULANCE', '#f6f7f8', '#c8102e'), [...onSides(1.9, 0.3, W, 1.3, 0.9), [1.0, 0.18, 0.4, 1.7, L / 2 + 0.02, 0]])]);
}
/** La décoration du flanc d'Esprit de Vie (photo) : l'arc jaune, rouge et bleu, le nom, la petite étoile, les enfants qui lèvent les bras. back : vers le côté de l'arrière du bus, à gauche de l'image ou à droite. */
let _edvMat = {};
function espritLivery(mirror) {
  if (_edvMat[mirror]) return _edvMat[mirror];
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d'), X = v => (mirror ? 1024 - v : v);
  const band = (y0, col, th) => {
    x.beginPath(); x.moveTo(X(45), 170 + y0); x.bezierCurveTo(X(170), 55 + y0, X(270), 30 + y0, X(430), 40 + y0); x.bezierCurveTo(X(620), 52 + y0, X(830), 110 + y0, X(960), 158 + y0);
    x.lineWidth = th; x.strokeStyle = col; x.stroke();
  };
  band(0, '#e8b400', 18); band(17, '#c8102e', 18); band(41, '#1d4fa0', 34);
  // le nom sur la bande bleue
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 34px sans-serif';
  x.save(); x.translate(mirror ? 1024 - 300 : 300, 76); x.rotate((mirror ? 1 : -1) * 0.02); x.fillText('ESPRIT DE VIE', 0, 0); x.restore();
  x.fillStyle = '#f5c400'; x.font = 'bold 22px sans-serif'; x.fillText('★', X(115), 118);
  // les enfants, bras levés, sur leur socle
  x.fillStyle = '#3f7fb8';
  x.beginPath(); x.ellipse(X(336), 233, 96, 9, 0, 0, Math.PI * 2); x.fill();
  [[258, 0.84], [290, 0.98], [322, 0.88], [354, 1.0], [386, 0.86], [415, 0.94]].forEach(([cx, k]) => {
    const px = X(cx), h = 100 * k, yb = 228;
    x.beginPath(); x.arc(px, yb - h, 8.5 * k, 0, 7); x.fill();
    x.fillRect(px - 8 * k, yb - h + 9, 16 * k, h * 0.5);
    x.fillRect(px - 8 * k, yb - h * 0.45, 6 * k, h * 0.45); x.fillRect(px + 2 * k, yb - h * 0.45, 6 * k, h * 0.45);
    x.lineWidth = 5 * k; x.strokeStyle = '#3f7fb8'; x.beginPath(); x.moveTo(px - 6 * k, yb - h + 13); x.lineTo(px - 18 * k, yb - h - 12); x.moveTo(px + 6 * k, yb - h + 13); x.lineTo(px + 18 * k, yb - h - 12); x.stroke();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (_edvMat[mirror] = new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.35 }));
}
/** Petit bus « Esprit de Vie » (photo) : blanc, longue bande de vitres sombres encadrées de noir, porte double vitrée au milieu à droite, numéro de parc, jantes d'acier. */
export function createEspritDeVie() {
  const { L, W } = COASTER, white = 0xeef0ee, zDoor = -0.75;
  const sp = { ...COASTER, pillarColor: 0x15181c };
  return vehicle('esprit', L, W, (b, low) => {
    loftBody(b, sp, white, low);
    realWheels(b, sp, low);
    realDetails(b, sp, white, low, { yF: 0.86, yR: 0.82, grille: [0.42, 0.1], lower: 0.42 });
    b.box(W * 1.01, 0.22, 0.22, 0xdfe1df, 0, 0.56, -L / 2 + 0.1).box(W * 1.01, 0.22, 0.22, 0xdfe1df, 0, 0.56, L / 2 - 0.1);
    for (const sx of [-1, 1]) {
      b.box(0.3, 0.05, 0.05, 0x1a1a1a, sx * (W / 2 + 0.14), 2.1, -L / 2 + 0.28).box(0.1, 0.34, 0.09, 0x151515, sx * (W / 2 + 0.28), 1.92, -L / 2 + 0.28);
      if (!low) b.box(0.012, 0.3, 0.1, 0x1d4fa0, sx * (W / 2 + 0.006), 1.12, -L / 2 + 0.72);          // le petit rappel bleu à l'avant
    }
    for (const sx of [-1, 1]) b.box(0.16, 0.26, 0.05, 0xb3131a, sx * W * 0.38, 1.0, L / 2 + 0.005);
    b.box(W * 0.78, 0.62, 0.05, GLASS, 0, 1.78, L / 2 - 0.06).box(0.2, 0.1, 0.05, 0xff9914, W * 0.34, 0.92, -L / 2 + 0.05).box(0.2, 0.1, 0.05, 0xff9914, -W * 0.34, 0.92, -L / 2 + 0.05);
    for (const sx of [-1, 1]) for (const z of [-2.1, -1.35, -0.1, 0.75, 1.6, 2.45]) b.box(0.014, 0.82, 0.07, 0x15181c, sx * (W / 2 + 0.004), 1.76, z);
    // la porte double, à droite : cadre gris clair, deux vitres hautes, marchepied
    b.box(0.03, 1.74, 1.02, 0xd4d7d6, W / 2 + 0.024, 1.42, zDoor);
    for (const dz of [-0.24, 0.24]) b.box(0.03, 1.52, 0.42, GLASS, W / 2 + 0.034, 1.42, zDoor + dz);
    if (!low) b.box(0.03, 1.66, 0.02, 0x24272c, W / 2 + 0.04, 1.42, zDoor).box(0.03, 0.05, 0.2, 0x2a2d33, W / 2 + 0.04, 1.2, zDoor + 0.14);
  }, [decalMesh(espritLivery(false), [[5.5, 1.12, W / 2 + 0.03, 0.96, 0.15, Math.PI / 2]]), decalMesh(espritLivery(true), [[5.5, 1.12, -(W / 2 + 0.03), 0.96, 0.15, -Math.PI / 2]]),
    decalMesh(decalMat('080', '#eef0ee', '#15181c'), onSides(0.3, 0.13, W, 1.2, -2.85))]);
}
/** Citadine récente (photo « personnelle2 ») : toit fuyant, montants noirs, jantes sombres. */
export function createCitadine({ color = pick([0x1f3f9c, 0xc22a2a, 0xeceff1, 0x6f7780, 0x1b1d20]) } = {}) {
  return vehicle(`citadine|${color}`, CITY.L, CITY.W, (b, low) => {
    loftBody(b, CITY, color, low);
    realWheels(b, CITY, low);
    realDetails(b, CITY, color, low, { yF: 0.72, yR: 0.86, doors: [-0.62, 0.3, 0.95] });
  });
}
/** Petit SUV récent (photo « voiture personnelle ») : haut sur roues, barres de toit. */
export function createCrossover({ color = pick([0x8a3f1a, 0xeceff1, 0x23262b, 0x7c828a, 0x233a6b]) } = {}) {
  return vehicle(`crossover|${color}`, CROSS.L, CROSS.W, (b, low) => {
    loftBody(b, CROSS, color, low);
    realWheels(b, CROSS, low);
    realDetails(b, CROSS, color, low, { yF: 0.88, yR: 1.14, doors: [-0.72, 0.3, 1.1] });
    for (const sx of [-1, 1]) b.box(0.05, 0.04, 1.5, 0xc8ccd0, sx * (CROSS.W * 0.3), 1.58, 0.3);
  });
}
/** Berline Yango (photo « yango ») : blanche, grand panneau rouge sur les portières, l'inscription en blanc. */
export function createYango() {
  const sp = { ...SEDAN, paint: (u, j) => (j >= 2 && j <= 3 && u > 0.33 && u < 0.72 ? 0xd8201f : undefined) };
  return vehicle('yango', SEDAN.L, SEDAN.W, (b, low) => {
    loftBody(b, sp, 0xf2f3f4, low);
    realWheels(b, SEDAN, low);
    realDetails(b, SEDAN, 0xf2f3f4, low, { yF: 0.72, yR: 0.86, doors: [-0.72, 0.28, 1.06] });
  }, [decalMesh(decalMat('YANGO', '#d8201f', '#ffffff'), onSides(1.5, 0.3, SEDAN.W, 0.74, 0.2))]);
}

/**
 * Train urbain de Kinshasa (photo trainkinshasa1 du dossier Acteurs, référence seulement) : motrice bleue à face plate, bande rouge-orangé
 * soulignée de jaune, grandes vitres, porte frontale ; voitures blanches à bandes rouge et bleue. Renvoie [motrice, voitures…] : chacune
 * fait TRAIN_L m, l'avant de la motrice vers -z.
 */
export const TRAIN_L = 19;
export function createTrain(cars = 3) {
  const L = TRAIN_L, W = 2.9, out = [];
  for (let k = 0; k <= cars; k++) {
    const b = new Builder(), loco = k === 0, body = loco ? 0x1f5cc4 : 0xeeeee8;
    b.box(W - 0.4, 0.55, L - 1.2, 0x2a2b2e, 0, 0.78, 0);                              // châssis
    for (const z of [-(L / 2 - 3), L / 2 - 3]) {                                       // bogies et roues
      b.box(W - 0.7, 0.45, 2.8, 0x1c1c1e, 0, 0.42, z);
      for (const dz of [-0.85, 0.85]) for (const sx of [-1, 1]) b.cyl(0.42, 0.42, 0.12, 0x3a3a3c, sx * (W / 2 - 0.45), 0.42, z + dz, 0, 0, Math.PI / 2, 12);
    }
    b.box(W, 2.35, L, body, 0, 2.22, 0)                                                 // caisse
      .box(W - 0.3, 0.22, L - 0.6, loco ? 0x2a6fd6 : 0xd6d6d0, 0, 3.5, 0)               // toit
      .box(W + 0.02, 0.85, L - 3.2, 0x1b2430, 0, 2.55, 0);                             // bandeau des vitres (des deux côtés)
    if (loco) {
      b.box(W + 0.03, 0.26, L, 0xd8402a, 0, 1.72, 0).box(W + 0.03, 0.09, L, 0xf5c400, 0, 1.55, 0)   // bandes rouge-orangé et jaune
        .box(W - 0.5, 0.95, 0.06, 0x1b2430, 0, 2.62, -L / 2 - 0.02)                     // pare-brise
        .box(0.85, 2.0, 0.05, 0x2a62c2, 0, 2.0, -L / 2 - 0.05)                           // porte frontale
        .box(0.5, 0.75, 0.04, 0x1b2430, 0, 2.55, -L / 2 - 0.08)
        .box(W + 0.03, 0.26, 0.06, 0xd8402a, 0, 1.72, -L / 2 - 0.03)
        .box(0.38, 0.26, 0.05, 0xfff3c4, -0.95, 1.4, -L / 2 - 0.05).box(0.38, 0.26, 0.05, 0xfff3c4, 0.95, 1.4, -L / 2 - 0.05)   // phares
        .box(W - 0.6, 0.35, 0.4, 0x2a2b2e, 0, 0.75, -L / 2 - 0.1)                      // attelage, chasse-pierres
        .box(0.5, 0.25, 0.9, 0x6d7278, 0, 3.72, -L / 2 + 3);                           // climatiseur
    } else {
      b.box(W + 0.03, 0.2, L, 0xc8102e, 0, 1.75, 0).box(W + 0.03, 0.14, L, 0x1d4fa0, 0, 1.52, 0);   // bandes rouge et bleue
    }
    for (const z of [-L / 4, L / 4]) b.box(W + 0.04, 1.9, 1.2, loco ? 0x1a52b0 : 0xd9d9d2, 0, 2.0, z);   // portes
    const m = b.mesh(VC_MAT);
    m.userData.L = L;
    out.push(m);
  }
  return out;
}

