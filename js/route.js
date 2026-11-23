// Tracé réel du trajet choisi (OpenStreetMap), compressé pour le jeu.
//
// Tout le jeu raisonne en « coordonnées route » : z = -s (s = distance parcourue depuis l'aéroport),
// x = décalage latéral (positif à droite). Ce module transforme ces coordonnées en position réelle
// le long des courbes du boulevard : pour le décor (déformation des sommets) et pour les objets mobiles.
import * as THREE from 'three';
import { CURRENT } from './routes.js';

export const ROUTE_DATA = await (await fetch(new URL(`../${CURRENT.data}`, import.meta.url))).json();
if (ROUTE_DATA.extra) Object.assign(CURRENT, ROUTE_DATA.extra);   // (rues, lieux, arrêts… tirés de la carte : data/universite.json)
if (CURRENT.moreSideRoads) CURRENT.sideRoads = [...(CURRENT.sideRoads ?? []), ...CURRENT.moreSideRoads];   // (entrée de la Rocade : routes.js)

export const SCALE = CURRENT.scale;       // compression des distances (voir routes.js)
export const toGame = sReal => sReal * SCALE;
export const GAME_LEN = toGame(ROUTE_DATA.length);

const STEP = 2;                           // pas d'échantillonnage du tracé de jeu (m)
const R_MIN = 320;                        // rayon minimal après compression (le décor s'étend à ±220 m)
// au-delà de la fin du tracé OSM, la route continue tout droit (Échangeur, puis Limete jusqu'à la 1re Rue)
const S_MIN = -400, S_MAX = GAME_LEN + Math.max(400, 400 - (CURRENT.end.trim ?? 0));

// ---------- Prolongement après la fourche Sendwe (routes.js `ext`) ----------
// Caps réels relevés sur OSM, comptés à partir du boulevard Lumumba à la fourche ; chaque virage de carrefour est un arc
// du rayon de jeu donné (pas le lissage général, qui en ferait de très grandes courbes)
const EXT = CURRENT.ext ?? null;
const DEG = Math.PI / 180;
const EXT_S = EXT ? toGame(EXT.from) : Infinity;        // fourche (m de jeu depuis le départ)
const EXT_KEYS = [];                                     // [u (m de jeu après la fourche), cap réel (degrés)]
/** Virages du prolongement : z0 (début de l'arc), z1 (fin), side (1 : vers la droite), r (rayon de jeu), turn (rad). */
export const EXT_ARCS = [];
if (EXT) {
  let h = EXT.h0;
  EXT_KEYS.push([0, h]);
  const ev = [...EXT.corners.map(c => ({ u: toGame(c.s), c })), ...EXT.keys.map(([s, hh]) => ({ u: toGame(s), h: hh }))]
    .sort((a, b) => a.u - b.u);
  for (const e of ev) {
    if (!e.c) { EXT_KEYS.push([e.u, e.h]); h = e.h; continue; }
    const turn = (e.c.to - h) * DEG, L = e.c.r * Math.abs(turn);
    EXT_KEYS.push([e.u - L / 2, h], [e.u + L / 2, e.c.to]);
    EXT_ARCS.push({ z0: -(EXT_S + e.u - L / 2), z1: -(EXT_S + e.u + L / 2), side: Math.sign(turn), r: e.c.r, turn: Math.abs(turn) });
    h = e.c.to;
  }
}
function extHeading(u) {
  const K = EXT_KEYS;
  if (u <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) {
    if (u <= K[i][0]) return K[i - 1][1] + (K[i][1] - K[i - 1][1]) * (u - K[i - 1][0]) / ((K[i][0] - K[i - 1][0]) || 1);
  }
  return K[K.length - 1][1];
}
let EXT_TH0 = 0;                                         // cap de jeu du boulevard Lumumba à la fourche

// Cap réel à chaque point OSM : θ tel que la direction soit (sin θ, -cos θ) dans le plan XZ
// (x = est, z = -nord). θ = 0 : vers le nord ; θ > 0 : tourne vers la droite.
function realHeadings() {
  const p = ROUTE_DATA.points;
  const h = [];
  for (let i = 0; i < p.length - 1; i++) h.push(Math.atan2(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]));
  h.push(h[h.length - 1]);
  for (let i = 1; i < h.length; i++) {           // dépliage des angles
    while (h[i] - h[i - 1] > Math.PI) h[i] -= 2 * Math.PI;
    while (h[i] - h[i - 1] < -Math.PI) h[i] += 2 * Math.PI;
  }
  // lissage (moyenne glissante sur ~300 m réels, deux passes)
  let a = h;
  for (let pass = 0; pass < 2; pass++) {
    const W = 15, b = [];
    for (let i = 0; i < a.length; i++) {
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - W); k <= Math.min(a.length - 1, i + W); k++) { sum += a[k]; n++; }
      b.push(sum / n);
    }
    a = b;
  }
  return a;
}

const real = realHeadings();
const realStep = ROUTE_DATA.step;
const theta0 = real[0];
function headingAtGame(s) {
  const f = Math.min(real.length - 1, Math.max(0, s / SCALE / realStep));
  const i = Math.min(real.length - 2, Math.floor(f));
  return real[i] + (real[i + 1] - real[i]) * (f - i) - theta0;   // départ orienté vers -Z
}

// Échantillons du tracé de jeu : position et cap tous les STEP mètres
const N = Math.ceil((S_MAX - S_MIN) / STEP) + 1;
const PX = new Float64Array(N), PZ = new Float64Array(N), TH = new Float64Array(N);
const i0 = Math.round(-S_MIN / STEP);
TH[i0] = 0;
const maxTurn = STEP / R_MIN;
for (let i = i0 + 1; i < N; i++) {
  const d = headingAtGame(S_MIN + i * STEP) - TH[i - 1];
  TH[i] = TH[i - 1] + Math.max(-maxTurn, Math.min(maxTurn, d));
}
for (let i = i0 - 1; i >= 0; i--) TH[i] = 0;
if (EXT) {
  const iA = Math.round((EXT_S - S_MIN) / STEP);
  EXT_TH0 = TH[iA];
  for (let i = iA + 1; i < N; i++) TH[i] = EXT_TH0 + (extHeading(S_MIN + i * STEP - EXT_S) - EXT.h0) * DEG;
}
for (let i = i0 + 1; i < N; i++) {
  const t = (TH[i - 1] + TH[i]) / 2;
  PX[i] = PX[i - 1] + Math.sin(t) * STEP;
  PZ[i] = PZ[i - 1] - Math.cos(t) * STEP;
}
for (let i = i0 - 1; i >= 0; i--) { PX[i] = PX[i + 1]; PZ[i] = PZ[i + 1] + STEP; }

// Tracé exact (data/bypass.json) : les points sont déjà en mètres de jeu dans la scène ; rien n'est intégré ni limité
if (ROUTE_DATA.exact) {
  const Q = ROUTE_DATA.points, st = ROUTE_DATA.step * SCALE, n = Q.length - 1;
  const at = s => {
    const f = s / st, i = Math.max(0, Math.min(n - 1, Math.floor(f))), t = f - i;   // (au-delà des bouts : dans le prolongement)
    return [Q[i][0] + (Q[i + 1][0] - Q[i][0]) * t, Q[i][1] + (Q[i + 1][1] - Q[i][1]) * t];
  };
  let prev = null;
  for (let i = 0; i < N; i++) {
    const s = S_MIN + i * STEP, [x, z] = at(s), [ax, az] = at(s - 6), [bx, bz] = at(s + 6);
    let th = Math.atan2(bx - ax, -(bz - az));
    if (prev !== null) { while (th - prev > Math.PI) th -= 2 * Math.PI; while (th - prev < -Math.PI) th += 2 * Math.PI; }
    prev = th;
    PX[i] = x; PZ[i] = z; TH[i] = th;
  }
}

function sample(s) {
  const f = Math.min(N - 1.001, Math.max(0, (s - S_MIN) / STEP));
  const i = Math.floor(f), t = f - i;
  return {
    x: PX[i] + (PX[i + 1] - PX[i]) * t,
    z: PZ[i] + (PZ[i + 1] - PZ[i]) * t,
    th: TH[i] + (TH[i + 1] - TH[i]) * t,
  };
}

/** Cap du boulevard (radians) à la position route z. */
export function yawAt(z) { return sample(-z).th; }
/** Cap de jeu (radians) d'une direction réelle (degrés, 0 = nord, + = vers l'est), sur le prolongement après la fourche. */
export const extYaw = hReal => EXT_TH0 + (hReal - (EXT?.h0 ?? 0)) * DEG;
/** Point de l'axe et cap en z : { x, z, th } (monde). */
export const frameAt = z => sample(-z);

/**
 * Coordonnées route (x, z) d'un point du monde (wx, wz), cherchées entre zFrom et zTo (zFrom > zTo) : là où le point est
 * dans l'axe d'une tranche de la route ; s'il y en a plusieurs (dedans d'un virage), la plus proche de l'axe. null sinon.
 */
export function routeAt(wx, wz, zFrom, zTo) {
  let best = null, prev = null;
  for (let z = zFrom; z >= zTo; z -= STEP) {
    const p = sample(-z), c = Math.cos(p.th), s = Math.sin(p.th), dx = wx - p.x, dz = wz - p.z;
    const along = dx * s - dz * c, x = dx * c + dz * s;
    if (prev && Math.sign(along) !== Math.sign(prev.along)) {
      const t = prev.along / (prev.along - along), cand = { x: prev.x + (x - prev.x) * t, z: prev.z - STEP * t };
      if (!best || Math.abs(cand.x) < Math.abs(best.x)) best = cand;
    }
    prev = { along, x, z };
  }
  return best;
}

// Écartement des deux chaussées (Échangeur de Limete) : spreadOf(z) donne de combien chaque chaussée
// s'éloigne de l'axe. Tout ce qui est à plus de SPREAD_CORE de l'axe suit sa chaussée ; le terre-plein s'élargit.
let spreadOf = () => 0;
const SPREAD_CORE = 0.9;
export function setSpread(fn) { spreadOf = fn ?? (() => 0); }
export const spreadAt = z => spreadOf(z);
function spreadX(x, z) {
  const S = spreadOf(z);
  if (!S) return x;
  return Math.abs(x) >= SPREAD_CORE ? x + Math.sign(x) * S : x * (SPREAD_CORE + S) / SPREAD_CORE;
}

/** Écart réel à l'axe (m) d'un point route x (à l'Échangeur, le terre-plein élargi tient dans |x| < SPREAD_CORE). */
export const realX = (x, z) => spreadX(x, z);
/** Mètres réels pour un mètre de x route à cet endroit (plus de 1 dans le terre-plein élargi de l'Échangeur). */
export const stretchX = (x, z) => (Math.abs(x) < SPREAD_CORE ? (SPREAD_CORE + spreadOf(z)) / SPREAD_CORE : 1);

/** Coordonnées route (x, z) → monde. Écrit dans `out` ({x, z}) et renvoie le cap local. raw : sans écartement. */
export function toWorld(x, z, out, raw = false) {
  if (!raw) x = spreadX(x, z);
  const p = sample(-z);
  out.x = p.x + Math.cos(p.th) * x;
  out.z = p.z + Math.sin(p.th) * x;
  return p.th;
}

const _w = { x: 0, z: 0 };
/** Place un objet 3D en coordonnées route, orienté selon la route (+ cap local). */
export function place(obj, x, z, localYaw = 0, y = obj.position.y, raw = false) {
  const th = toWorld(x, z, _w, raw);
  // sur une chaussée qui s'écarte, l'objet suit la direction de sa chaussée
  const turn = raw || Math.abs(x) < SPREAD_CORE ? 0 : Math.sign(x) * Math.atan(spreadOf(z - 0.5) - spreadOf(z + 0.5));
  obj.position.set(_w.x, y, _w.z);
  obj.rotation.y = -(th + localYaw + turn);
}

/** Vecteur monde d'un point route (pratique pour la caméra). */
export function worldVec(x, y, z, v = new THREE.Vector3()) {
  toWorld(x, z, _w);
  return v.set(_w.x, y, _w.z);
}

/**
 * Comme bendGeometry, mais sans plier : la géométrie construite en coordonnées route autour de zRef suit en bloc la route
 * droite qui passe par zRef (sa tangente). Pour ce qui ne doit pas se tordre dans les virages du prolongement : fourche,
 * avenues qui croisent, bâtiments.
 */
export function bendRigid(geo, zRef) {
  const p = sample(-zRef), c = Math.cos(p.th), s = Math.sin(p.th);
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), dz = pos.getZ(i) - zRef;
    pos.setXYZ(i, p.x + x * c - dz * s, pos.getY(i), p.z + x * s + dz * c);
    if (nor) {
      const nx = nor.getX(i), nz = nor.getZ(i);
      nor.setXYZ(i, nx * c - nz * s, nor.getY(i), nx * s + nz * c);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** Plie une géométrie construite en coordonnées route le long du tracé (positions + normales). */
export function bendGeometry(geo, raw = false) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const th = toWorld(pos.getX(i), pos.getZ(i), _w, raw);
    pos.setXYZ(i, _w.x, pos.getY(i), _w.z);
    if (nor) {
      const nx = nor.getX(i), nz = nor.getZ(i), c = Math.cos(th), s = Math.sin(th);
      nor.setXYZ(i, nx * c - nz * s, nor.getY(i), nx * s + nz * c);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
