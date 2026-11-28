// Le décor du trajet choisi (routes.js). Tout est construit en coordonnées route
// (on roule vers -Z, chaussée de droite en +X), puis plié selon le vrai tracé (route.js).
//
// Profil en travers, côté droit, en partant du centre :
//   style populaire   : terre-plein | voies | bordure | caniveau | accotement en terre (vendeurs) | façades
//   style monumental  : terre-plein planté | voies | bordure | trottoir dallé, arbres | grille | bâtiments
//   style centre-ville : séparateur | voies | bordure | trottoir dallé | grands arbres, murs blancs, immeubles et tours
import * as THREE from 'three';
import { Builder, VC_MAT, createMinibus, createHatchback, createMoto, createCityBus, createCar, createPolicePickup, createPoliceVan, createTruck, createAmbulance } from './models.js';
import { bakeCharacter, outfit, Character } from './characters.js';
import { toGame, GAME_LEN, bendGeometry, bendRigid, place, worldVec, setSpread, realX, toWorld, frameAt, extYaw, EXT_ARCS } from './route.js';
import { CURRENT as R, ROUTES, ATTACHED } from './routes.js';
import { MOBILE } from './memoire.js';
const __mark = n => { if (location.search.includes('mesure')) console.log(`MESURE ${String(Math.round(performance.now())).padStart(6)} ms  ${n}`); };
__mark('world.js : début');

const g = sReal => -Math.round(toGame(sReal));      // position de jeu d'un point situé à sReal m du départ
const POPULAR = R.style === 'popular';
const MONUMENTAL = R.style === 'monumental';
const DOWNTOWN = R.style === 'downtown';

export const END_Z = -Math.round(GAME_LEN);          // fin du tracé OSM (tour, carrefour…)
export const WORLD_VER = 'd10';   // (affiché en bas à gauche : permet de voir si le téléphone a la dernière version)

// Lancement groupé et mis en cache des données JSON et textures partagées entre routes
const __DATA_CACHE = (globalThis.__TAXIKIN_DATA ??= new Map());
const __cachedJson = (key, rel, fallback = null) => {
  if (!__DATA_CACHE.has(key)) {
    __DATA_CACHE.set(key, fetch(new URL(`../${rel}`, import.meta.url)).then(r => (r.ok ? r.json() : fallback)).catch(() => fallback));
  }
  return __DATA_CACHE.get(key);
};
const __cachedImg = rel => {
  const key = `img:${rel}`;
  if (!__DATA_CACHE.has(key)) {
    __DATA_CACHE.set(key, new Promise(res => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = new URL(`../${rel}`, import.meta.url).href;
    }));
  }
  return __DATA_CACHE.get(key);
};
const __MOB_ON = new URLSearchParams(globalThis.location?.search ?? '').get('moboma') === '0' ? null : (R.moboma ?? null);
const __pMasOsm = R.masina?.osm ? __cachedJson(`json:${R.masina.osm}`, R.masina.osm) : Promise.resolve(null);
const __pMobOsm = __MOB_ON?.osm ? __cachedJson(`json:${__MOB_ON.osm}`, __MOB_ON.osm) : Promise.resolve(null);
const __pPlLinks = R.pl || R.attachPL ? __cachedJson('json:data/poidslourds_links.json', 'data/poidslourds_links.json') : Promise.resolve(null);
const __pAsphalt = __cachedImg('data/tex/asphalt.jpg');
const __pStrips = __cachedJson('json:data/tex/strips/strips.json', 'data/tex/strips/strips.json', {});
const __pPhotoBoards = Promise.all((R.photoBoards ?? []).map(async p => ({ ...p, image: await __cachedImg(p.img) })));
const __pMobLogo = __MOB_ON ? __cachedImg('data/tex/moboma/logo_passio.jpg') : Promise.resolve(null);
const __pLimOsm = R.limete?.buildings ? __cachedJson(`json:${R.limete.buildings}`, R.limete.buildings) : Promise.resolve(null);
export const ROUTE_LEN = Math.round(GAME_LEN) - R.end.trim;   // portique d'arrivée
export const MEDIAN = R.twoLane || R.pl ? 0.12 : R.rocade ? 0.3 : 1.2;   // demi-largeur du terre-plein (route à deux bandes : simple ligne ; Rocade : double ligne)
export const LANE_W = 3.5;
export const LANES = R.lanes;
export const ROAD_EDGE = MEDIAN + LANES * LANE_W;
export const LANE_X = Array.from({ length: LANES }, (_, i) => MEDIAN + LANE_W * (i + 0.5));
export const LANE_L = LANE_X[0];
export const LANE_R = LANE_X[LANES - 1];           // voie de droite : arrêts, clients
const FRONT = ROAD_EDGE + 10;                      // alignement des façades

// Lieux (minor : arrêt possible mais pas d'étiquette sur la barre du trajet)
export const LANDMARKS = [
  ...R.landmarks.map(([name, short, sr, minor]) => ({ name, short, z: sr ? g(sr) : 0, minor: !!minor })),
  { name: R.end.name, short: R.end.short, z: -ROUTE_LEN },
];
// Trajet raccourci (routes.js `finish`, ex. Aéroport → Limete 1re Rue) : même décor, arrivée plus tôt ; destinations des
// clients et barre de trajet jusqu'à cette arrivée. goalsUntil : clients et barre s'arrêtent là, sans fin de journée
// (trajet principal : la suite après Mandela est sur le trajet du 30 Juin, voir `links`)
export const FINISH_LEN = R.finish ? Math.round(toGame(R.finish.s)) : ROUTE_LEN;
export const GOALS_LEN = R.finish ? FINISH_LEN : R.goalsUntil ? Math.round(toGame(R.goalsUntil)) : ROUTE_LEN;
export const GOALS = R.finish
  ? [...LANDMARKS.filter(l => l.z > -FINISH_LEN), { name: R.finish.name, short: R.finish.short, z: -FINISH_LEN }]
  : R.goalsUntil ? LANDMARKS.filter(l => l.z >= -GOALS_LEN) : LANDMARKS;
/** Zones de foule : piétons nombreux, traversées, clients qui courent vers le taxi. */
export const CROWDS = (R.crowds ?? []).map(([a, b, name]) => ({ z0: g(a), z1: g(b), name }));
// (l'auteur, 10/11) zones des bagarres de Kuluna (routes.js `kuluna`) et des vols à moto (routes.js `thefts`, plus le rond-point Victoire : voir RINGS)
export const KULUNA_ZONES = (R.kuluna ?? []).map(([a, b]) => ({ z0: g(a), z1: g(b) }));
export const THEFT_ZONES = (R.thefts ?? []).map(([a, b]) => ({ z0: g(a), z1: g(b) }));
export const inCrowd = (z, m = 0) => CROWDS.some(c => z < c.z0 + m && z > c.z1 - m);
export const RIVERS = R.rivers.map(([name, sr, w, bridge]) => ({ name, z: g(sr), w, bridge }));
// Sauts-de-mouton : les voies intérieures (x < RAMP_X) montent sur une rampe, les voies extérieures restent au sol
export const RAMP_X = MEDIAN + 2 * LANE_W;
const FLY_H = 6.2;
export const FLYOVERS = (R.flyovers ?? []).map(f => {
  const z0 = g(f.s0), z1 = g(f.s1);
  return { ...f, z0, z1, ramp: Math.min(95, (z0 - z1) * 0.42) };
});
const smooth = t => t * t * (3 - 2 * t);
/** Hauteur de la rampe à la position z (0 hors saut-de-mouton). */
export function flyH(z) {
  for (const f of FLYOVERS) {
    if (z <= f.z0 && z >= f.z1) return FLY_H * smooth(Math.min(1, (f.z0 - z) / f.ramp, (z - f.z1) / f.ramp));
  }
  return 0;
}
/** Pente dans le sens de la marche (vers -z), positive en montée. */
export const flySlope = z => flyH(z - 0.5) - flyH(z + 0.5);
export const inFlyover = (z, margin = 0) => FLYOVERS.some(f => z < f.z0 + margin && z > f.z1 - margin);
export const FOOTBRIDGES = R.footbridges.map(g);
export const TRAFFIC_MIX = R.traffic ?? R.pl?.traffic ?? null;    // (véhicules propres au trajet : voir traffic.js)
/** Embouteillages (routes.js `jams`) : à créneaux horaires fixes (tableau [[débutH, finH], ...]) ou aléatoires sur les autres boulevards (probabilité). */
export const JAMS = (R.jams ?? []).map(([a, b, lvl = 1, scheduleOrProb = 1]) => {
  const scheduled = Array.isArray(scheduleOrProb);
  return {
    z0: g(a), z1: g(b), lvl,
    scheduled,
    prob: scheduled ? 1 : scheduleOrProb,
    hours: scheduled ? scheduleOrProb : null,
    on: true,
  };
});
/** L'embouteillage j est-il actif à l'heure courante du jeu (globalThis.__TAXIKIN_HOUR) ? */
export function isJamActive(j) {
  const forced = globalThis.__TAXIKIN_FORCE_JAM;
  if (forced !== null && forced !== undefined) return forced;
  if (!j.on) return false;
  if (!j.hours?.length) return true;
  const h = globalThis.__TAXIKIN_HOUR ?? 6;
  return j.hours.some(([h0, h1]) => (h0 <= h1 ? (h >= h0 && h < h1) : (h >= h0 || h < h1)));
}
/** Tire au sort les embouteillages aléatoires de la journée (les embouteillages programmés gardent toujours leurs horaires fixes). */
export function randomizeJams() {
  for (const j of JAMS) {
    if (j.scheduled) {
      j.on = true;
    } else {
      j.on = Math.random() < j.prob;
      if (j.on) {
        const m0 = +(6.5 + Math.random() * 4).toFixed(2), d0 = +(1.8 + Math.random() * 1.5).toFixed(2);
        const m1 = +(13 + Math.random() * 4.5).toFixed(2), d1 = +(2 + Math.random() * 1.8).toFixed(2);
        j.hours = [[m0, m0 + d0], [m1, m1 + d1]];
      } else {
        j.hours = null;
      }
    }
  }
  return JAMS.filter(j => j.on);
}
// ---------- Les travaux (l'auteur, 13/11 : « ajouter aussi des travaux dans le boulevard ») : routes.js `works`. Les voies fermées sont entourées de
// barrières, précédées d'un biseau de cônes et d'un panneau « TRAVAUX » ; dedans : tranchée, tas de sable et de gravier, pelleteuse, rouleau, camion.
// Les ouvriers sont animés par life.js ; la circulation se rabat sur les voies ouvertes (traffic.js) ; le véhicule du joueur s'arrête aux barrières.
export const WORKS = (R.works ?? []).map(([a, b, side, lanes]) => {
  const zA = g(a), zB = g(b), z0 = Math.max(zA, zB), z1 = Math.min(zA, zB);   // (z0 : côté aéroport)
  const lo = Math.min(...lanes), hi = Math.max(...lanes);
  const xIn = MEDIAN + lo * LANE_W, xOut = MEDIAN + (hi + 1) * LANE_W, outer = xOut >= ROAD_EDGE - 0.1;
  const taper = 30, zt = side > 0 ? z0 + taper : z1 - taper;   // (le biseau, du côté d'où vient la circulation)
  return { z0, z1, side, lanes, lo, hi, xIn, xOut, outer, taper, zt, on: false, meshes: [], props: [], solids: [] };
});
/** Remet debout à leur place initiale tous les cônes et barrières légères d'un chantier. */
export function resetWorkProps(Wk) {
  if (!Wk.props) return;
  for (const p of Wk.props) {
    p.x = p.x0; p.z = p.z0; p.yaw = p.yaw0;
    p.vx = 0; p.vz = 0; p.vyaw = 0; p.tilt = 0; p.vtilt = 0; p.hit = false; p.fallSign = 1;
    p.mesh.rotation.set(0, 0, 0);
    place(p.mesh, p.x, p.z, p.yaw, roadH(p.z));
  }
}
/** Le tirage de la journée (l'auteur, 14/11 : « pas à chaque course, c'est aléatoire ») : souvent aucun chantier, parfois un, rarement deux. */
export function randomizeWorks() {
  const n = !WORKS.length || Math.random() < 0.45 ? 0 : Math.random() < 0.7 ? 1 : 2;
  const pickd = new Set(WORKS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, n));
  WORKS.forEach((Wk, i) => {
    Wk.on = pickd.has(i);
    if (Wk.on) resetWorkProps(Wk);
    for (const m of Wk.meshes) m.visible = Wk.on;
  });
  return WORKS.filter(Wk => Wk.on).length;
}
/** La part fermée de la largeur en z : 1 dans la zone, de 0 à 1 dans le biseau, 0 ailleurs (utilisé par la circulation IA pour se rabattre). */
function workK(Wk, z) {
  if (!Wk.on) return 0;                                                    // (pas de chantier à cet endroit aujourd'hui)
  if (z <= Wk.z0 && z >= Wk.z1) return 1;
  if (Wk.side > 0 && z > Wk.z0 && z < Wk.z0 + Wk.taper) return 1 - (z - Wk.z0) / Wk.taper;
  if (Wk.side < 0 && z < Wk.z1 && z > Wk.z1 - Wk.taper) return 1 - (Wk.z1 - z) / Wk.taper;
  return 0;
}
/** Le point (x, z) touche-t-il un engin lourd immobile du chantier (pelleteuse, rouleau, camion-benne) ? Les cônes et barrières légères ne bloquent pas : ils se dégagent. */
export function inWorks(x, z, m = 0) {
  for (const Wk of WORKS) {
    if (!Wk.on || (x >= 0 ? 1 : -1) !== Wk.side) continue;
    if (z > Wk.z0 + 4 || z < Wk.z1 - 4) continue;
    for (const s of Wk.solids) {
      if (Math.abs(x - s.x) < s.hx + m && Math.abs(z - s.z) < s.hz + m) return true;
    }
  }
  return false;
}
/** Les voies fermées (indices) pour un véhicule de `side` en z, ou null. */
export function closedLanesAt(side, z) {
  for (const Wk of WORKS) if (Wk.side === side && workK(Wk, z) > 0.12) return Wk.lanes;
  return null;
}

export const inJam = (z, m = 0) => JAMS.some(j => isJamActive(j) && z < j.z0 + m && z > j.z1 - m);
/** Vitesse permise (m/s) en z au temps t : Infinity hors embouteillage ; entrée et sortie progressives ; des vagues qui avancent et s'arrêtent. */
export function jamSpeed(z, t) {
  for (const j of JAMS) {
    if (!isJamActive(j) || z > j.z0 + 60 || z < j.z1 - 60) continue;
    const edge = Math.min(1, (j.z0 + 60 - z) / 120, (z - j.z1 + 60) / 120);
    const wave = Math.max(0, Math.sin(z * 0.045 + t * 0.55));
    return 14 - edge * (14 - (0.8 + 6.5 * wave) / j.lvl);
  }
  return Infinity;
}
export const BUS_STOPS = R.busStops.map(g);
export const STATIONS = R.stations.map(([name, sr, kind]) => ({ name, z: g(sr), kind }));   // kind 'strip' : dans la bande (Limete)
const CROSSINGS = R.crossings.map(([sr, name, w = 14, hide = 0]) => ({ z: g(sr), name, w, hide: !!hide }));   // (hide : pas de rue dessinée, l'autre route est déjà là)   // (w : largeur ; Kasa-Vubu : le boulevard Sendwe / Triomphal)

export const inRiver = (z, margin = 0) => RIVERS.some(r => Math.abs(z - r.z) < r.w / 2 + margin);
const inCrossing = (z, margin = 0) => CROSSINGS.some(c => Math.abs(z - c.z) < c.w / 2 + margin);

// Pont Matete (croquis de l'auteur, photos et OSM) : tout le boulevard monte sur un remblai, passe au-dessus
// du chemin de fer et de la Route Poids Lourds (pont biais), puis au-dessus des petits boulevards (2e pont),
// et redescend. Les petits boulevards restent au niveau du sol et se rattachent au boulevard plus loin.
const HAS_MATETE = (R.places ?? []).some(p => p.kind === 'pont_matete');
const ZM = g(11496), ZB2 = g(11690);               // pont sur le chemin de fer, pont sur les petits boulevards
const MAT = { up0: ZM + 100, up1: ZM + 34, down0: ZB2 - 8, down1: ZB2 - 72, H: 5.5 };
/** Hauteur de toute la chaussée à la position z (remblai du Pont Matete, 0 ailleurs). */
export function roadH(z) {
  if (!HAS_MATETE || z >= MAT.up0 || z <= MAT.down1) return 0;
  if (z > MAT.up1) return MAT.H * smooth((MAT.up0 - z) / (MAT.up0 - MAT.up1));
  if (z < MAT.down0) return MAT.H * smooth((z - MAT.down1) / (MAT.down0 - MAT.down1));
  return MAT.H;
}
export const roadSlope = z => roadH(z - 0.5) - roadH(z + 0.5);
export const inRaised = (z, margin = 0) => HAS_MATETE && z < MAT.up0 + margin && z > MAT.down1 - margin;
// Échangeur de Limete (croquis de l'auteur) : les deux chaussées s'écartent autour du parc de la tour (END_Z)
// et continuent jusqu'à la 17e Rue (arrivée). À droite, le petit boulevard longe le parc : Transco puis Collège Lumumba.
const IS_TOWER = R.end.kind === 'tower';
// Profil de l'écartement (photos aériennes) : [distance à la tour (m, + = avant la tour), écart de chaque chaussée].
// Les chaussées s'ouvrent à la pointe du parc, longent l'allée, font le tour du parc rond de la tour (rayon ~64 m)
// puis restent écartées (route en travers, puis l'enceinte de la Police entre elles) et se rejoignent juste avant
// la 17e Rue (croquis de l'Échangeur).
const ECH_PROFILE = [[215, 0], [150, 16], [95, 40], [60, 54], [25, 62], [0, 63], [-25, 62], [-55, 52], [-75, 44], [-95, 42],
  [-130, 46], [-170, 46], [-210, 38], [-245, 20], [-270, 5], [-285, 0]];
// station : à droite, juste là où le petit boulevard se raccorde (pb0 = départ du petit boulevard)
// bypass : bretelle au sol à gauche, avant la route en travers ; pbL : petit boulevard de gauche avant la 17e Rue
const ECH = { fork0: END_Z + 215, merge: END_Z - 285, cross: END_Z - 75, station: END_Z + 186, pb0: END_Z + 166, bypass: END_Z - 40, pbL: END_Z - 232, rue17: END_Z - 92, tri0: END_Z + 204, tri1: END_Z + 180, park0: END_Z + 156 };
// tri0-tri1 : petit triangle de pelouse où les chaussées se séparent ; tri1-park0 : petit boulevard qui relie les deux chaussées
// rue17 : la 17e Rue part du petit boulevard de droite (pas du grand), au coin où finit le Collège Lumumba
/** Interpolation cubique monotone (pas de bosse entre deux points du profil). */
const spreadCurve = (() => {
  const P = ECH_PROFILE.map(([d, s]) => [-d, s]), n = P.length;
  const m = P.slice(0, -1).map((p, i) => (P[i + 1][1] - p[1]) / (P[i + 1][0] - p[0]));
  const t = P.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  return u => {
    let i = 0;
    while (i < n - 2 && u > P[i + 1][0]) i++;
    const [x0, y0] = P[i], [x1, y1] = P[i + 1], h = x1 - x0, s = (u - x0) / h;
    return (2 * s ** 3 - 3 * s ** 2 + 1) * y0 + (s ** 3 - 2 * s ** 2 + s) * h * t[i] + (-2 * s ** 3 + 3 * s ** 2) * y1 + (s ** 3 - s ** 2) * h * t[i + 1];
  };
})();
/** Écart de chaque chaussée par rapport à l'axe (0 hors de l'Échangeur). */
const spreadAt = z => (!IS_TOWER || z >= ECH.fork0 || z <= ECH.merge ? 0 : Math.max(0, spreadCurve(END_Z - z)));
/** Entre la pointe du parc et la jonction derrière la tour : pas de terre-plein central. */
const inEchPark = (z, margin = 0) => IS_TOWER && z < ECH.fork0 + margin && z > ECH.merge - margin;
// Deux chaussées séparées au début du trajet (routes.js `pair`, By Pass) : chacune s'écarte de S ; la pelouse tient dans le milieu
const PAIR = R.pair ? (() => {
  const z1 = -toGame(R.pair.until), S = R.pair.S, RAMP = 50;
  const at = z => S * smooth(Math.max(0, Math.min(1, Math.min(-z / 40, (z - z1) / RAMP))));
  let nose = -40;                                          // (dernier point de la pelouse : l'ovale du croquis de Salongo vient juste après)
  while (nose > z1 && at(nose - 1) > S - 0.05) nose -= 1;
  return { z1, S, at, nose, CORE: 2 * 0.9 / (0.9 + S), full: z => at(z) > S - 0.05 };   // CORE : bord de la pelouse (x route) quand elle a 4 m de large
})() : null;
setSpread(IS_TOWER ? spreadAt : PAIR ? PAIR.at : null);
// Routes du parc de l'Échangeur, en x réel (le parc est construit sans écartement) : la route arrière (ECH.cross), qui
// part de la chaussée de droite avec deux coins arrondis, longe le bord arrière du parc, monte sur le pont au-dessus de la
// chaussée de gauche puis redescend et continue à gauche ; le petit triangle de pelouse à la pointe du parc.
const ECH_XB = IS_TOWER ? (() => {
  const S = spreadAt(ECH.cross), xOut = -(S + ROAD_EDGE + 1.5);
  return { S, BH: 5.5, w: 8, GY: 0.17, RC: 10, xIn: -(S + MEDIAN - 1.2), xOut, xLand: 6, xRight: S + MEDIAN - 0.1, xFar: xOut - 46, xEnd: -214 };
})() : null;
const ECH_TRI = IS_TOWER ? (() => { const hw = MEDIAN - 0.16 + spreadAt(ECH.tri1) - 3.2; return [[0, ECH.tri0], [hw, ECH.tri1], [-hw, ECH.tri1]]; })() : null;
// entrée de la 16e Rue (grand boulevard), là où les chaussées se rejoignent ; ensuite le tronçon de Limete (routes.js `limete`)
const Z16 = R.limete ? g(R.limete.from) : -ROUTE_LEN - 8;
const PB_X = ROAD_EDGE + 14, PB_W = 8;             // petit boulevard (axe, largeur) : de l'Échangeur jusqu'à la 1re Rue, des deux côtés
const ROAD_AFTER = R.end.after ?? 90;              // longueur de chaussée construite après l'arrivée
// fourche Sendwe : bout du tronçon de Limete (avec le prolongement `ext`, le trajet continue à gauche par le boulevard Sendwe)
const Z_FORK = R.ext ? g(R.ext.from) : -ROUTE_LEN - ROAD_AFTER;
export const Z_FORK_ = Z_FORK;                       // (pour les liaisons vers la Route Poids Lourds, main.js)
// Bandes latérales réservées (pas d'accotement, de vendeurs ni de façades génériques) : le Pont Matete
// (à droite jusqu'au bout de la boucle, à gauche aussi) et, à droite, le petit boulevard de l'Échangeur
const ECH_ZONE = [ECH.fork0 - 8, Z_FORK];          // jusqu'à la fourche Sendwe : le petit boulevard continue
// à gauche : bypass, puis petit boulevard de gauche (jusqu'au bout de la chaussée quand le tronçon de Limete existe)
const ECH_ZONES_L = [[ECH.bypass + (R.attachBp ? 118 : 75), ECH.cross - 14], [ECH.pbL + 12, R.limete ? Z_FORK : Z16 - 60]];
// Bretelle de gauche avant la 16e Rue (croquis de l'Échangeur) : le petit boulevard de gauche de Limete s'y raccorde
const PBL_PTS = [[-(ROAD_EDGE + 4), ECH.pbL], [-(ROAD_EDGE + 4.5), ECH.pbL - 20], [-(ROAD_EDGE + 30), ECH.pbL - 50], [-(ROAD_EDGE + 52), ECH.pbL - 82]];
/** t (sur PBL_PTS) où le bord intérieur de la bretelle atteint |x| = xAbs. */
function pblT(xAbs) {
  for (let k = 0; k <= 200; k++) if (innerEdge(PBL_PTS, PB_W, k / 200)[0] <= -xAbs) return k / 200;
  return 1;
}
// (à droite depuis le panneau de la Route Poids Lourds, reculée de 40 m le 31/10)
const MATETE_ZONE = { 1: [ZM + 190, ZB2 - 106], [-1]: [ZM + 104, ZB2 - 106] };
const inMateteZone = (side, z, margin = 0) => (HAS_MATETE && z < MATETE_ZONE[side][0] + margin && z > MATETE_ZONE[side][1] - margin)
  || (IS_TOWER && side > 0 && z < ECH_ZONE[0] + margin && z > ECH_ZONE[1] - margin)
  || (IS_TOWER && side < 0 && ECH_ZONES_L.some(([a, c]) => z < a + margin && z > c - margin));
// Ouvertures de la bordure : départ de la Route Poids Lourds (droite), départ et retour des boucles (des deux côtés),
// départ de l'Entrée Matete vers la boucle (gauche, en haut du remblai juste après le Pont Matete : MAT_RAMP)
const LOOP_GAPS = [[ZB2 - 86, ZB2 - 104]];
const MAT_RAMP_GAP = [ZM - 29.5, ZM - 43];
const MATETE_GAPS = { 1: [[ZM + 178, ZM + 140], ...LOOP_GAPS], [-1]: [MAT_RAMP_GAP, ...LOOP_GAPS] };

// Entrées de routes d'un seul côté (Mikondo, SIFORCO, Kimbuta…) : la bordure s'interrompt de ce côté
// ang (degrés) : route en biais, + = elle penche vers l'avant (vers Limete) en s'éloignant du boulevard
const SIDE_ROADS = [...(R.sideRoads ?? []), ...(R.ext?.streets ?? []).map(r => ({ ...r, s: R.ext.from + r.s }))]
  .map(r => ({ ...r, z: g(r.s), w: r.triangle ? 17 : (r.w ?? 9), ang: r.ang ?? 0 }));
export const SIDE_ROADS_ = SIDE_ROADS;              // (entrées de la Rocade : main.js ROAD7)
/** Emprise [haut, bas] (z) d'une entrée de route jusqu'à 45 m du bord, en tenant compte du biais (façades, étals). */
const sideRoadSpan = r => {
  const lean = 45 * Math.tan(r.ang * Math.PI / 180);
  return [r.z + r.w / 2 + 2 + Math.max(0, -lean), r.z - r.w / 2 - 2 - Math.max(0, lean)];
};
const inSideRoadSpan = (side, z) => SIDE_ROADS.some(r => r.side === side && r.ang && z <= sideRoadSpan(r)[0] && z >= sideRoadSpan(r)[1]);
// (l'auteur, 10/11 : « la seule chose qui peut bloquer les véhicules, c'est la bordure ou les caniveaux » : les stations au bord de la route ont une
// devanture ouverte, on entre sur leur aire ; voir SIDE_APRONS plus bas, rempli une fois les lieux connus)
let SIDE_APRONS = [];
/** Demi-largeur d'une embouchure le long de la bordure : une rue de Moboma en biais la coupe sur w / cos(biais), plus 1,2 m d'évasement. */
const sideHalf = r => (r.moboma ? r.w / 2 / Math.max(0.3, Math.cos(r.ang * Math.PI / 180)) + 1.2 : r.w / 2);
/** Coupure [haut, bas] (z) de la bordure, du caniveau et du bas-côté devant une entrée (Moboma : jusqu'au bout du caniveau, 2,4 m, du côté où la rue penche). */
const mouthCut = r => { const lean = r.moboma ? 2.4 * Math.tan(r.ang * Math.PI / 180) : 0; return [r.z + sideHalf(r) + Math.max(0, -lean), r.z - sideHalf(r) - Math.max(0, lean)]; };
for (const r of SIDE_ROADS) r.cut = mouthCut(r);
const atSideRoad = (side, z, margin = 0) => SIDE_ROADS.some(r => r.side === side && z <= r.cut[0] + margin && z >= r.cut[1] - margin)
  || SIDE_APRONS.some(q => q.side === side && Math.abs(z - q.z) < q.half + margin)
  || (HAS_MATETE && MATETE_GAPS[side].some(([a, b]) => z <= a + margin && z >= b - margin))
  || (IS_TOWER && side > 0 && z <= ECH.pb0 + 2 + margin && z >= ECH.pb0 - 24 - margin)        // départ du petit boulevard
  || (IS_TOWER && side < 0 && ((z <= ECH.bypass + 2 + margin && z >= ECH.bypass - 22 - margin) || (BP_STUB && z <= ECH.bypass + 112 + margin && z >= ECH.bypass + 84 - margin) || (z <= ECH.pbL + 2 + margin && z >= ECH.pbL - 24 - margin)))
  || (IS_TOWER && side > 0 && Math.abs(z - ECH.station) < 14 + margin)                         // entrée de la station
  || LIM_EDGE_GAPS.some(q => q.side === side && Math.abs(z - q.z) < q.half + margin);           // Limete : rues qui partent de la chaussée
const lmZ = short => LANDMARKS.find(l => l.short === short)?.z;

// (trajet attaché par son début, Route Poids Lourds : rien avant z = 0, la route d'où l'on vient est déjà là)
const START_ATTACHED = R.start === 'attached';
const Z_START = START_ATTACHED ? 4 : 160;
// Place de la Gare (trajets attachés) : carrefour libre, au même endroit de la scène sur les deux routes (voir main.js, ROAD3)
export const PLAZA = R.end.kind === 'open' ? { x: 0, z: END_Z, r: 30 } : ATTACHED && R.id === '30juin' ? { x: 0, z: END_Z + 13, r: 30 } : null;
export const inPlaza = (x, z) => !!PLAZA && Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r;
// fin de la chaussée (après l'arrivée, le boulevard continue encore un peu)
const Z_END = IS_TOWER ? -ROUTE_LEN - ROAD_AFTER : END_Z + 10;
const EXT = R.ext ?? null;
/** z de jeu d'un point situé à s m réels après la fourche Sendwe (prolongement). */
const ZX = s => g(EXT.from + s);
const Z_GEN = EXT ? Z_FORK : Z_END;                  // fin du décor générique (boulevard Lumumba, Limete) ; après : addExtension
const EXT_ZB = EXT ? ZX(EXT.b) : 0, EXT_ZC = EXT ? ZX(EXT.c) : 0, EXT_ZD = EXT ? ZX(EXT.d) : 0;
const [ARC_A, ARC_B, ARC_C, ARC_D] = EXT_ARCS;
const arcMid = a => (a ? (a.z0 + a.z1) / 2 : 0);
/** Tronçon du prolongement en z : 'sendwe', 'triomphal', 'liberation' (ex-24 Novembre) ou '30juin' (Boulevard du 30 Juin). */
const extZone = z => (z > EXT_ZB ? 'sendwe' : z > EXT_ZC ? 'triomphal' : z > EXT_ZD ? 'liberation' : '30juin');
/** Écart maximal à l'axe (m) d'un objet plié du côté `side` en z : à l'intérieur d'un virage, au-delà du rayon, la géométrie
 *  se replierait sur elle-même ; près du virage, chaque branche garde sa moitié de l'angle (bissectrice). */
function insideMax(side, z) {
  let m = Infinity;
  for (const a of EXT_ARCS) {
    if (a.side !== side) continue;
    const r = a.r - 1.5, k = 1 / Math.tan(a.turn / 2);
    m = Math.min(m, z > a.z0 ? r + (z - a.z0) * k : z < a.z1 ? r + (a.z1 - z) * k : r);
  }
  return m;
}
const insideMaxSpan = (side, z0, z1) => Math.min(insideMax(side, z0), insideMax(side, z1), insideMax(side, (z0 + z1) / 2));
/** Dehors d'un virage serré (Libération) : les façades pliées s'y étireraient. */
const outsideArc = (side, z, m = 0) => EXT_ARCS.some(a => a.side === -side && a.r < 60 && z < a.z0 + m && z > a.z1 - m);
/** Longueur utile d'une rue latérale (limitée par l'intérieur des virages ou par r.len sur le prolongement). */
const sideRoadLen = r => r.link ? 10 : Math.min(r.len ?? 88, r.z < Z_FORK ? Math.max(16, insideMaxSpan(r.side, r.z + 6, r.z - 6) - ROAD_EDGE - 4) : 88);

// ---------- Limete, de la 16e Rue à la 1re Rue (croquis OSM, routes.js `limete`) ----------
const LIM = R.limete ?? null;
const LIM_ST = (LIM?.streets ?? []).map(r => ({ ...r, z: -toGame(r.s), z2: -toGame(r.s2 ?? r.s), w: r.w ?? 9, ang: r.ang ?? 0 }));
const LIM_MEDIAN = (LIM?.median ?? []).map(s => -toGame(s));
/** Ouverture du terre-plein (séparateur interrompu) sur le tronçon de Limete. */
const inMedianOpen = (z, margin = 0) => LIM_MEDIAN.some(m => Math.abs(z - m) < 5.5 + margin);
const STRIP_STATIONS = STATIONS.filter(st => st.kind === 'strip');
// Vidéos de Limete (drone et au sol) : larges bandes entre le boulevard et les petits boulevards (~3 fois la chaussée),
// pelouse avec arbustes et grands arbres près du boulevard, terre battue (voitures, kiosques, étals) près du petit boulevard
const LIM_PB_X = ROAD_EDGE + 32, LIM_LAWN = 12;    // axe des petits boulevards de Limete, largeur de la pelouse

// ---------- Masina : boucle Siforco – Avenue Bosango – Avenue Kulumba – route de BKTF (routes.js `masina`) ----------
// Le vrai tracé d'OSM (data/masina_osm.json, tools/masina_osm.py), en mètres réels (s, o), ramené à l'échelle du
// boulevard dans les deux directions (x = o × scale) : les distances gardent les proportions de la carte (l'auteur, 30/10 :
// « rétablir la distance »). Chaque route est une polyligne en coordonnées route avec sa largeur réelle : la boucle en
// goudron, les avenues de quartier en terre qui croisent Kulumba (courts tronçons dans leur vraie direction, fermés par une
// maison au fond), la rue Imbali le long du chemin de fer. dead : [début, fin] en cul-de-sac.
const MAS = R.masina ?? null;
const MAS_OSM = await __pMasOsm;
const MAS_K = R.scale, MAS_W = 9, MAS_SW = 6, MAS_SL = 34;   // échelle des écarts ; largeur de Kulumba ; avenues de quartier
// La rivière Bonamak du boulevard s'arrête à 120 m, avant Kulumba : en vrai, Kulumba n'a pas de pont à cet endroit (l'auteur
// en cite trois : sur Bosango près du Marché Hindou, après l'Avenue Congo, et sur le Mokali après Kibunda)
const MAS_RIVER_END = 120;
const mz = s => -toGame(s);
const mp = ([s, o]) => [MAS_K * o, mz(s)];                    // point OSM (s, o) → coordonnées route
const nameKey = t => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const MAS_ROADS = [];
const MAS_STREETS = [];   // avenues qui croisent Kulumba : { x, z (carrefour), name, sides : [{ side (1 intérieur, -1 boulevard), dir }] }
let MAS_KUL = [];         // axe de Kulumba, du carrefour de Bosango vers Limete
/** Axe de Kulumba à la position z : x, direction unitaire (vers Limete) et normale vers l'intérieur (côté chemin de fer). */
function kulAt(z) {
  const K = MAS_KUL;
  let i = 1;
  while (i < K.length - 1 && K[i][1] > z) i++;
  const a = K[i - 1], b = K[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = (a[1] - z) / ((a[1] - b[1]) || 1);
  const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  return { x: a[0] + (b[0] - a[0]) * t, z, ux, uz, nx: -uz, nz: ux };
}
if (MAS && MAS_OSM) {
  const O = MAS_OSM, entry = key => SIDE_ROADS.find(r => r.masina === key);
  const road = (key, name, w, paved, pts, dead = [false, false]) => MAS_ROADS.push({ key, name, w, paved, pts, dead });
  // routes d'entrée : depuis l'embouchure (triangle de Siforco, ou bord de la chaussée), puis le tracé OSM au-delà
  const fromMouth = (key, pts, x0) => [[x0, entry(key).z], ...pts.map(mp).filter(p => p[0] > x0 + 6)];
  road('bosango', 'AVENUE BOSANGO', MAS_W, true, fromMouth('bosango', O.bosango, ROAD_EDGE + 15.5), [false, true]);
  // (l'auteur, 14/11) l'Avenue Twana suit son embouchure (routes.js) : le tracé d'OSM est déplacé d'autant et prolongé jusqu'à l'axe de Kulumba
  const twShift = entry('twana').s - O.twana[0][0], twPts = O.twana.map(([s, o]) => [s + twShift, o]);
  {
    const K = O.kulumba, sE = twPts.at(-1)[0];
    let i = 1;
    while (i < K.length - 1 && K[i][0] < sE) i++;
    const a = K[i - 1], b = K[i], t = (sE - a[0]) / (b[0] - a[0]);
    twPts[twPts.length - 1] = [sE, a[1] + (b[1] - a[1]) * t];
  }
  road('twana', 'AVENUE TWANA', MAS_W, true, fromMouth('twana', twPts, ROAD_EDGE - 0.3));
  road('bktf', 'ROUTE DE BKTF', MAS_W, true, fromMouth('bktf', O.bktf, ROAD_EDGE - 0.3));
  // Kulumba, du carrefour de Bosango jusqu'à kulumbaEnd (elle continue en vrai vers Tshangu)
  const kEnd = mz(MAS.kulumbaEnd), kul = O.kulumba.map(mp), last = kul.findIndex(p => p[1] < kEnd);
  if (last > 0) { const a = kul[last - 1], b = kul[last], t = (a[1] - kEnd) / (a[1] - b[1]); kul.splice(last, Infinity, [a[0] + (b[0] - a[0]) * t, kEnd]); }
  MAS_KUL = kul;
  road('kulumba', 'AVENUE KULUMBA', MAS_W, true, kul, [false, true]);
  // rue Imbali, le long du chemin de fer, au bout de la route de BKTF (morceau MAS.imbali)
  const im = O.imbali.flat().map(mp).filter(p => p[1] <= mz(MAS.imbali[0]) && p[1] >= mz(MAS.imbali[1])).sort((p, q) => q[1] - p[1]);
  road('imbali', 'RUE IMBALI', 7, false, im.filter((p, i) => i === 0 || Math.hypot(p[0] - im[i - 1][0], p[1] - im[i - 1][1]) > 0.5), [true, true]);
  // avenues qui croisent Kulumba : axe continu d'après OSM (parallèles entre avenues voisines, sans cassure au carrefour)
  let prevAng = 0;
  for (const [s, name, sides, osmName] of MAS.streets) {
    const z = mz(s), k = kulAt(z), J = [k.x, z], st = { x: k.x, z, name, sides: [] };
    const cand = O.cross.filter(c => Math.abs(c.at[0] - s) < 16 && (!name || nameKey(c.name).includes(nameKey(osmName ?? name)) || !c.name));
    const pts = cand.flatMap(c => c.pts.map(mp));
    let sx = 0, sz = 0;
    for (const p of pts) {
      const dx = p[0] - J[0], dz = p[1] - J[1], d = Math.hypot(dx, dz);
      if (d > 4 && d < 120) {
        const sgn = dx * k.nx + dz * k.nz >= 0 ? 1 : -1;
        if (Math.abs(dx * k.nx + dz * k.nz) / d > 0.7) { sx += (dx / d) * sgn; sz += (dz / d) * sgn; }
      }
    }
    let ang = sx || sz ? Math.atan2(sx * (-k.nz) + sz * k.nx, sx * k.nx + sz * k.nz) : prevAng;
    ang = Math.max(-0.21, Math.min(0.16, ang));
    const prevSt = MAS_STREETS.at(-1);
    if (prevSt && Math.abs(prevSt.z - z) < 13) ang = prevAng * 0.7 + ang * 0.3;
    prevAng = ang;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ux0 = k.nx * ca - k.nz * sa, uz0 = k.nz * ca + k.nx * sa;
    for (const [c, side] of [['i', 1], ['b', -1]]) {
      if (!sides.includes(c)) continue;
      const dx = ux0 * side, dz = uz0 * side, cos = ca, e = MAS_W / 2 / cos;
      const a = [J[0] + dx * (e - 0.5 / cos), J[1] + dz * (e - 0.5 / cos)], b = [J[0] + dx * (e + MAS_SL), J[1] + dz * (e + MAS_SL)];
      st.sides.push({ side, dir: [dx, dz], a, b });
      road('street', name, MAS_SW, false, [a, b], [false, true]);
    }
    MAS_STREETS.push(st);
  }
}
/** Où s'arrête une rivière du boulevard du côté de Masina : la Bonamak avant Kulumba, les autres au bord du sol plié. */
const masRiverEnd = r => (MAS_KUL.length && r.z < MAS_KUL[0][1] && r.z > MAS_KUL.at(-1)[1] ? MAS_RIVER_END : GROUND_HALF);
// Entonnoir entre le triangle de Siforco (19 m de large) et l'Avenue Bosango, qui part en biais vers Limete
const MAS_FUNNEL = (() => {
  const r = MAS_ROADS.find(q => q.key === 'bosango');
  if (!r) return null;
  const [a, b] = r.pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, t = Math.min(12, L);
  const c = [a[0] + ux * t, a[1] + uz * t], x0 = ROAD_EDGE + 15.6, z0 = SIDE_ROADS.find(q => q.masina === 'bosango').z;
  const e = [-uz * r.w / 2, ux * r.w / 2];                 // demi-largeur, perpendiculaire à l'avenue
  return [[x0, z0 + 9.5], [c[0] - e[0], c[1] - e[1]], [c[0] + e[0], c[1] + e[1]], [x0, z0 - 9.5]].sort((p, q) => q[1] - p[1]);
})();
// Segments où roule le taxi (centre à moins de hw de l'axe ; en cul-de-sac, on s'arrête avant la maison du fond)
const MAS_SEGS = MAS_ROADS.flatMap(r => r.pts.slice(1).map((q, i) => {
  let a = r.pts[i], b = q;
  const hw = r.w / 2 - 0.9, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, cut = hw + 2.4;
  if (r.dead[0] && i === 0) a = [a[0] + ux * cut, a[1] + uz * cut];
  if (r.dead[1] && i === r.pts.length - 2) b = [b[0] - ux * cut, b[1] - uz * cut];
  return { a, b, hw, x0: Math.min(a[0], b[0]) - hw - 1, x1: Math.max(a[0], b[0]) + hw + 1, z0: Math.max(a[1], b[1]) + hw + 1, z1: Math.min(a[1], b[1]) - hw - 1 };
}));
const MAS_Z0 = MAS ? Math.max(...MAS_ROADS.flatMap(r => r.pts.map(p => p[1]))) : 0;   // emprise de la boucle en z
const MAS_Z1 = MAS ? Math.min(...MAS_ROADS.flatMap(r => r.pts.map(p => p[1]))) : 0;
/** Sur une route de Masina ? (côté droit seulement) */
function onMasinaRoad(x, z) {
  if (!MAS || x < ROAD_EDGE - 1 || z > MAS_Z0 + 12 || z < MAS_Z1 - 8) return false;
  const F = MAS_FUNNEL;
  if (F && x < F[1][0] + 1 && pointInPoly([x, z], F) && segDist(x, z, F[0], F[1]) > 0.7 && segDist(x, z, F[2], F[3]) > 0.7) return true;
  for (const sg of MAS_SEGS) {
    if (z <= sg.z0 && z >= sg.z1 && x >= sg.x0 && x <= sg.x1 && segDist(x, z, sg.a, sg.b) < sg.hw) return true;
  }
  return false;
}
/** Direction de la route de Masina sous le taxi (null hors route ou dans un carrefour). */
function masinaAxis(x, z) {
  if (!MAS || x < ROAD_EDGE - 1 || z > MAS_Z0 + 8 || z < MAS_Z1 - 8) return null;
  let axis = null;
  for (const sg of MAS_SEGS) {
    if (z > sg.z0 || z < sg.z1 || x < sg.x0 || x > sg.x1 || segDist(x, z, sg.a, sg.b) > sg.hw + 0.9) continue;
    const a = Math.atan2(sg.b[0] - sg.a[0], -(sg.b[1] - sg.a[1]));
    if (axis !== null && Math.abs(Math.sin(a - axis)) > 0.2) return null;
    axis = a;
  }
  return axis;
}
/** Position et cap de départ/arrivée dans la boucle de Masina ('bktf' ou 'siforco') et nom de la rue sous (x, z). */
export function masinaPose(which, intoMasina = true) {
  const r = MAS_ROADS.find(q => q.key === (which === 'bktf' ? 'bktf' : 'bosango'));
  if (!r) return { x: LANE_R, z: 0, heading: 0 };
  const [a, b] = r.pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  const d = Math.min(20, L * 0.35), dir = intoMasina ? 1 : -1;
  return { x: a[0] + ux * d, z: a[1] + uz * d, heading: Math.atan2(ux * dir, -uz * dir) };
}
export function masinaRoadName(x, z) {
  if (!MAS || x < ROAD_EDGE + 2 || z > MAS_Z0 + 12 || z < MAS_Z1 - 8) return null;
  let best = null, bd = 12;
  for (const r of MAS_ROADS) for (let i = 1; i < r.pts.length; i++) {
    const d = segDist(x, z, r.pts[i - 1], r.pts[i]);
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return 'Boucle de Masina';
  return best.key === 'bosango' ? 'Route Siforco · Av. Bosango' : best.key === 'bktf' ? 'Route de BKTF' : best.key === 'kulumba' ? 'Avenue Kulumba' : best.name || 'Quartier Sans-Fil · Masina';
}

// ---------- Kingasani : l'Entrée Moboma (l'auteur, 14/11 : croquis Kingasani/carte_corrigee.png, vidéos « Entreé Moboma » et « Direction mobutu
// vers moboma direction hopital », photos du dossier Lycée) ----------
// Le croquis est le plan d'OSM tourné : l'Avenue Moboma (le MACADAM de gauche) part du boulevard à l'Aéro Club et s'enfonce en biais jusqu'à la
// Rue Kabila (ex Mobutu, « direction Mobutu ») ; la Rue Kimpioka (l'AVENUE de droite) longe l'EP, le lycée, les hôpitaux, Passio et Saint-Marc,
// puis tourne vers l'ITP Passio ; quatre traverses ; Maswa et Ndona séparent les trois parcelles de chaque rangée ; à gauche, de petites avenues.
// Tracé : data/moboma_osm.json (tools/moboma_osm.py), à l'échelle du boulevard (comme Masina). Les entrées sur le boulevard sont dans routes.js
// sideRoads (moboma : clé de la rue, link : seulement l'embouchure) ; une rue qui arrive au boulevard sans entrée (Maison communale, station,
// Kin Marché, arrêts) s'arrête derrière les façades. Routes : { key, name, w, paved, pts (coordonnées route), dead : [début, fin] en cul-de-sac }.
const MOB = __MOB_ON;   // (?moboma=0 : sans le quartier, pour comparer)
const MOB_OSM = await __pMobOsm;
const MOB_ROADS = [];
export const MOB_ROADS_ = MOB_ROADS;                // (tests : main.js ?debug=1)
export const MOB_LOG = {};                          // (tests : repères sans place, maisons du cœur des îlots)
let MOB_LYC = null;                                 // (le Lycée de Kingasani 2 : repère de son allée, voir addLycee)
const MOB_PROPS = [];                               // [x, z, rayon] des parasols et des véhicules garés : les poteaux électriques s'en écartent
const MOB_BACK = -(FRONT + 15);                     // (sans entrée, la rue s'arrête derrière les maisons du boulevard)
if (MOB && MOB_OSM) {
  const dist2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const bez3 = (P, t) => { const u = 1 - t; return [0, 1].map(k => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]); };
  for (const [key, name, paved, w, opts = {}] of MOB.roads) {
    let pts = (MOB_OSM.roads[key] ?? []).map(mp);
    if (pts.length < 2) continue;
    if (pts[0][0] < pts.at(-1)[0]) pts.reverse();      // (le premier point : le bout le plus proche du boulevard)
    const dead = [false, false], entry = SIDE_ROADS.find(r => r.moboma === key);
    if (entry && opts.joinAt) {
      // (l'auteur, 14/11 : « l'Entrée Mobutu est déjà liée au boulevard, il faut juste la continuer avec l'avenue Mobutu ») : tout droit depuis
      // l'embouchure sur `straight` m, puis une longue courbe qui rejoint le vrai tracé à `joinAt` m de son bout (avant son premier carrefour)
      const S = [-(ROAD_EDGE - 0.3), entry.z], a = entry.ang * Math.PI / 180, d0 = [-Math.cos(a), -Math.sin(a)];
      const A = [S[0] + d0[0] * opts.straight, S[1] + d0[1] * opts.straight];
      let acc = 0, iq = pts.length - 2;
      for (let i = 1; i < pts.length - 1; i++) { acc += dist2(pts[i - 1], pts[i]); if (acc >= opts.joinAt) { iq = i; break; } }
      const Q = pts[iq], N = pts[iq + 1], tl = dist2(Q, N) || 1, tq = [(N[0] - Q[0]) / tl, (N[1] - Q[1]) / tl];
      const L = dist2(A, Q) / 3, C = [A, [A[0] + d0[0] * L, A[1] + d0[1] * L], [Q[0] - tq[0] * L, Q[1] - tq[1] * L], Q];
      pts = [S, A, ...[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(t => bez3(C, t)), ...pts.slice(iq)];
    } else if (entry) {
      // depuis l'embouchure (bord de la chaussée, cap de l'entrée), raccord en courbe sur le vrai tracé à 14 m au moins du bord
      const S = [-(ROAD_EDGE - 0.3), entry.z], a = entry.ang * Math.PI / 180, d0 = [-Math.cos(a), -Math.sin(a)];
      let i = pts.findIndex(p => p[0] < S[0] - 14);
      if (i < 0) i = pts.length - 1;
      const Q = pts[i], N = pts[Math.min(i + 1, pts.length - 1)], M = i + 1 < pts.length ? N : pts[i - 1];
      const tl = dist2(Q, M) || 1, tq = i + 1 < pts.length ? [(N[0] - Q[0]) / tl, (N[1] - Q[1]) / tl] : [(Q[0] - M[0]) / tl, (Q[1] - M[1]) / tl];
      const L = dist2(S, Q) / 3, C = [S, [S[0] + d0[0] * L, S[1] + d0[1] * L], [Q[0] - tq[0] * L, Q[1] - tq[1] * L], Q];
      pts = [S, ...[0.25, 0.5, 0.75].map(t => bez3(C, t)), ...pts.slice(i)];
    } else if (pts[0][0] > MOB_BACK) {
      // sans entrée : on coupe la rue derrière les maisons du boulevard (cul-de-sac)
      const j = pts.findIndex(p => p[0] <= MOB_BACK);
      if (j <= 0) continue;
      const p = pts[j - 1], q = pts[j], t = (MOB_BACK - p[0]) / (q[0] - p[0]);
      pts = [[MOB_BACK, p[1] + (q[1] - p[1]) * t], ...pts.slice(j)];
      dead[0] = true;
    }
    const cutAt = opts.split ? MOB_ROADS.find(q => q.key === opts.split) : null;
    let X = null, ci = -1;
    if (cutAt) for (let i = 1; i < pts.length && !X; i++) for (let j = 1; j < cutAt.pts.length && !X; j++) { X = segCross(pts[i - 1], pts[i], cutAt.pts[j - 1], cutAt.pts[j]); if (X) ci = i; }
    if (X) {
      // (l'auteur, 14/11 : « à gauche de Moboma, il n'y a pas de macadam ») : avant la traversée, côté boulevard, la rue est en terre
      const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05;
      const west = [...pts.slice(0, ci).filter(p => !near(p, X)), X], east = [X, ...pts.slice(ci).filter(p => !near(p, X))];
      MOB_ROADS.push({ key: `${key}_g`, name: opts.west ?? name, label: opts.westLabel, plate: opts.plate, w, paved: false, pts: west, dead: [dead[0], false], entry: entry ?? null });
      MOB_ROADS.push({ key, name, label: opts.label, plate: opts.plate, w, paved, pts: east, dead: [false, dead[1]], entry: null });
    } else MOB_ROADS.push({ key, name, label: opts.label, plate: opts.plate, w, paved, pts, dead, entry: entry ?? null });
  }
  // un bout qui ne touche aucune autre rue (ni l'embouchure) est un cul-de-sac
  const nearRoad = (p, self) => MOB_ROADS.some(o => o !== self && o.pts.slice(1).some((q, i) => segDist(p[0], p[1], o.pts[i], q) < o.w / 2 + 1.5));
  for (const r of MOB_ROADS) {
    if (!r.entry && !r.dead[0] && !nearRoad(r.pts[0], r)) r.dead[0] = true;
    if (!nearRoad(r.pts.at(-1), r)) r.dead[1] = true;
  }
  // (l'auteur, 14/11) le Lycée de Kingasani 2 et l'E.P. Elikya, en face de la Rue de la Commune, de l'autre côté de la Rue Kimpioka : une longue allée de
  // sable qui prolonge la Rue de la Commune ; les véhicules y entrent (photos et vidéo du dossier Kingasani/Lycée ; décor : addLycee)
  const co = MOB.lycee && MOB_ROADS.find(r => r.key === 'commune');
  if (co) {
    const J0 = co.pts.at(-1);
    let k = co.pts.length - 2;
    while (k > 0 && dist2(co.pts[k], J0) < 15) k--;                   // (direction prise sur les 15 derniers mètres au moins)
    const P = co.pts[k], L = dist2(P, J0) || 1, U = [(J0[0] - P[0]) / L, (J0[1] - P[1]) / L];
    // l'allée part de l'axe de la Rue Kimpioka (le bout de la Rue de la Commune dans OSM s'arrête à près de 2 m de l'axe)
    const kim = MOB_ROADS.find(r => r.key === 'kimpioka');
    let J = J0;
    if (kim) for (let i = 1; i < kim.pts.length; i++) {
      const X = segCross([J0[0] - U[0] * 20, J0[1] - U[1] * 20], [J0[0] + U[0] * 20, J0[1] + U[1] * 20], kim.pts[i - 1], kim.pts[i]);
      if (X) { J = X; break; }
    }
    MOB_LYC = { J, U, V: [U[1], -U[0]], len: MOB.lycee.len };
    MOB_ROADS.push({ key: 'lycee', name: 'LYCÉE DE KINGASANI 2', label: 'Lycée de Kingasani 2', plate: false, w: MOB.lycee.w, paved: false, col: 0xa99c86,
      pts: [J, [J[0] + U[0] * MOB.lycee.len, J[1] + U[1] * MOB.lycee.len]], dead: [false, true], entry: null, noPlots: true, noWall: true });
  }
}
/** Repère de l'allée du lycée : (u le long de l'allée depuis la Rue Kimpioka, v vers la Rue Kabila) ↔ coordonnées route. */
const lycUV = (x, z) => { const dx = x - MOB_LYC.J[0], dz = z - MOB_LYC.J[1]; return [dx * MOB_LYC.U[0] + dz * MOB_LYC.U[1], dx * MOB_LYC.V[0] + dz * MOB_LYC.V[1]]; };
const lycXZ = (u, v) => [MOB_LYC.J[0] + MOB_LYC.U[0] * u + MOB_LYC.V[0] * v, MOB_LYC.J[1] + MOB_LYC.U[1] * u + MOB_LYC.V[1] * v];
// Où l'on roule dans le lycée, en plus de l'allée [u0, u1, v0, v1] : le passage du portail du lycée, sa cour, la place du fond ; moins les obstacles
// [u, v, rayon] : le mât du drapeau, la poubelle, le flamboyant, le parasol de la vendeuse, la guérite, l'arbre, la voiture garée, le panneau (addLycee)
const MOB_AREAS = MOB_LYC ? [[27.6, 30.0, 2.6, 6.2], [21.5, 52.5, 5.6, 16.9], [62.5, 80.6, -10.6, 8.2]] : [];
const MOB_SOLIDS = MOB_LYC ? [[33.6, 6.6, 1.55], [24.5, 9.5, 2.2], [39.5, 18.7, 1.2], [46.5, 12, 1.25], [48, 9.2, 2.2], [51.5, 15.5, 1.6], [79.5, -4.5, 3.2], [80.4, 5.2, 3.1], [75, -10.4, 1.9]] : [];
/** Dans la cour du lycée ou sur sa place (là où l'on roule, hors des rues) ? */
function mobArea(x, z) {
  if (!MOB_LYC) return false;
  const [u, v] = lycUV(x, z);
  if (u < 0 || u > 85 || v < -30 || v > 34) return false;
  return MOB_AREAS.some(([u0, u1, v0, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1) && !MOB_SOLIDS.some(([su, sv, r]) => Math.hypot(u - su, v - sv) < r);
}
// Segments où roule le véhicule (centre à moins de hw de l'axe ; en cul-de-sac, on s'arrête avant le mur du fond)
const MOB_SEGS = MOB_ROADS.flatMap(r => r.pts.slice(1).map((q, i) => {
  let a = r.pts[i], b = q;
  const hw = r.w / 2 - 0.9, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, cut = hw + 2.4;
  if (r.dead[0] && i === 0) a = [a[0] + ux * cut, a[1] + uz * cut];
  if (r.dead[1] && i === r.pts.length - 2) b = [b[0] - ux * cut, b[1] - uz * cut];
  return { r, a, b, hw, x0: Math.min(a[0], b[0]) - hw - 1, x1: Math.max(a[0], b[0]) + hw + 1, z0: Math.max(a[1], b[1]) + hw + 1, z1: Math.min(a[1], b[1]) - hw - 1 };
}));
const MOB_Z0 = MOB_ROADS.length ? Math.max(...MOB_ROADS.flatMap(r => r.pts.map(p => p[1]))) : 0;   // emprise du quartier en z
const MOB_Z1 = MOB_ROADS.length ? Math.min(...MOB_ROADS.flatMap(r => r.pts.map(p => p[1]))) : 0;
const MOB_X1 = MOB_ROADS.length ? Math.min(...MOB_ROADS.flatMap(r => r.pts.map(p => p[0]))) : 0;  // (le plus loin du boulevard, x < 0)
/** Le long du boulevard (côté gauche) : la tranche dont le quartier construit lui-même les façades (ses rues y passent en biais). */
const MOB_FRONT = MOB_ROADS.length ? [MOB.front[0], MOB.front[1]].map(s => -toGame(s)) : null;
const inMobZ = z => MOB_ROADS.length > 0 && z < MOB_Z0 + 40 && z > MOB_Z1 - 40;
/** Sur une rue de Moboma ? (côté gauche seulement) */
function onMobomaRoad(x, z) {
  if (!MOB_ROADS.length || x > -(ROAD_EDGE - 1) || z > MOB_Z0 + 12 || z < MOB_Z1 - 12) return false;
  if (mobArea(x, z)) return true;
  for (const sg of MOB_SEGS) {
    if (z <= sg.z0 && z >= sg.z1 && x >= sg.x0 && x <= sg.x1 && segDist(x, z, sg.a, sg.b) < sg.hw) return true;
  }
  return false;
}
/** Les chemins des gens qui marchent dans les quartiers (js/quartier.js) : le bord de chaque rue de Moboma et de la boucle de Masina, des deux côtés,
 *  par morceaux loin du boulevard et des murs des culs-de-sac. */
export function quartierPaths() {
  const out = [];
  const add = (zone, r, inner) => {
    const o = r.w / 2 - 0.4, L = roadLen(r);
    for (const e of [1, -1]) {
      let run = [];
      const flush = () => {
        if (run.length >= 8) {
          const cum = [0];
          for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
          out.push({ zone, pts: run, cum, len: cum.at(-1), x0: Math.min(...run.map(p => p[0])), x1: Math.max(...run.map(p => p[0])), z0: Math.max(...run.map(p => p[1])), z1: Math.min(...run.map(p => p[1])) });
        }
        run = [];
      };
      for (let t = 0; t <= L; t += 2) {
        const P = roadAlong(r, t), x = P.x + P.uz * o * e, z = P.z - P.ux * o * e;
        if (inner(x) && !(r.dead[0] && t < 3.5) && !(r.dead[1] && t > L - 3.5)) run.push([x, z]); else flush();
      }
      flush();
    }
  };
  for (const r of MOB_ROADS) add('mob', r, x => x < -(FRONT + 4));
  for (const r of MAS_ROADS) add('mas', r, x => x > FRONT + 4);
  return out;
}
/** Les rues de Moboma où roulent les motos et les voitures (js/quartier.js) : toutes, de l'Aéro Club à la Rue Kabila (ex Mobutu), sauf l'allée du
 *  lycée ; out : [début, fin] du côté du boulevard (le véhicule y sort), dead : culs-de-sac (il y fait demi-tour). */
export function quartierRoads() {
  // outX : distance le long de la rue, depuis son bout côté boulevard, où l'axe passe à 2,2 m du bord de la chaussée (l'avant du véhicule s'arrête là)
  const tAt = (pts, xLim) => {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (a[0] <= xLim) return acc;
      if (b[0] <= xLim) return acc + L * (a[0] - xLim) / (a[0] - b[0]);
      acc += L;
    }
    return acc;
  };
  return MOB_ROADS.filter(r => r.key !== 'lycee').map(r => {
    const out = [r.pts[0][0] > -(FRONT + 6), r.pts.at(-1)[0] > -(FRONT + 6)], xLim = -(ROAD_EDGE + 2.2);
    return { key: r.key, pts: r.pts.map(p => [p[0], p[1]]), w: r.w, paved: r.paved, out, dead: [...r.dead],
      outX: [out[0] ? tAt(r.pts, xLim) : 0, out[1] ? tAt([...r.pts].reverse(), xLim) : 0] };
  });
}
/** Embouchure d'une entrée de Moboma (addSideRoad) : goudron évasé du bord de la chaussée jusqu'à t m le long de la rue, là où toute sa
 *  largeur a passé la bordure et le caniveau du boulevard ; la chaussée de la rue (addMobomaRoad) commence là. */
const MOB_MOUTHS = new Map();
function mobMouth(e) {
  if (!MOB_MOUTHS.has(e)) {
    const r = MOB_ROADS.find(q => q.entry === e);
    let out = null;
    if (r) {
      const [hi, lo] = e.cut, x0 = -(ROAD_EDGE - 0.3), xg = -(ROAD_EDGE + 2.4), hw = r.w / 2;
      let t = 1, P = roadAlong(r, t);
      while (t < 40 && P.x + Math.abs(P.uz) * hw > xg) { t += 0.5; P = roadAlong(r, t); }
      const n = [P.uz, -P.ux], A = [P.x + n[0] * hw, P.z + n[1] * hw], B = [P.x - n[0] * hw, P.z - n[1] * hw];   // (n : vers +z, la rue part vers x < 0)
      out = { r, t, hi, lo, poly: [[x0, hi], A, B, [x0, lo]], edges: [[[-(ROAD_EDGE + 0.3), hi], A], [[-(ROAD_EDGE + 0.3), lo], B]] };
    }
    MOB_MOUTHS.set(e, out);
  }
  return MOB_MOUTHS.get(e);
}
/** Nom de la rue de Moboma sous (x, z) (panneau « Tu es sur »), ou null. */
export function mobomaRoadName(x, z) {
  if (!MOB_ROADS.length || x > -(ROAD_EDGE + 2) || z > MOB_Z0 + 12 || z < MOB_Z1 - 12) return null;
  if (mobArea(x, z)) return 'Lycée de Kingasani 2 · Kingasani';
  let best = null, bd = 10;
  for (const r of MOB_ROADS) for (let i = 1; i < r.pts.length; i++) {
    const d = segDist(x, z, r.pts[i - 1], r.pts[i]);
    if (d < bd) { bd = d; best = r; }
  }
  if (!best) return null;
  const small = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'ex', 'vers']);
  const nm = best.label ?? (best.name ? best.name.toLowerCase().replace(/(^|[\s(-])([^\s(-]+)/g, (m, a, w, i) => a + (i && small.has(w) ? w : w[0].toUpperCase() + w.slice(1))) : '');
  return nm ? `${nm} · Kingasani` : 'Kingasani · Moboma';
}

// ---------- Carrefours à feux tricolores (routes.js limete.signals) ----------
// La rue traverse tout le boulevard : plus de terre-plein sur w mètres. Lignes d'arrêt avant le carrefour, dans les
// deux sens ; les voitures de la rue attendent au bord du boulevard (stopX) et traversent pendant leur vert.
// streets[1 | -1] : la rue de chaque côté (bord du boulevard z, petit boulevard z2, biais au-delà, longueur, sens
// unique éventuel), ou null.
export const SIGNALS = [
  ...(LIM?.signals ?? []).map(v => {
    const [s, w = 12] = Array.isArray(v) ? v : [v], z = -toGame(s), streets = {};
    for (const side of [1, -1]) {
      const r = LIM_ST.find(r => r.side === side && r.from === 'road' && Math.abs(r.z - z) < w / 2 + 2);
      streets[side] = r ? { z: r.z, z2: r.z2, ang: r.ang * Math.PI / 180, len: r.len, oneway: r.oneway } : null;
    }
    return { z, w, stopR: z + w / 2 + 1.2, stopL: z - w / 2 - 1.2, stopX: ROAD_EDGE + 2.6, xIn: LIM_PB_X - PB_W / 2, streets };
  }),
  // Carrefours à robot roulage sur une entrée d'avenue (routes.js `signals`, l'auteur, 10/11 : Kimbuta) : le terre-plein s'ouvre sur w m,
  // la rue est l'avenue d'entrée de ce côté (elle part du bord de la chaussée : pas de petit boulevard), le robot fait le feu
  ...(R.signals ?? []).map(q => {
    const z = g(q.s), w = q.w ?? 22, streets = { 1: null, [-1]: null };
    for (const r of SIDE_ROADS) if (Math.abs(r.z - z) < w / 2 + 2) streets[r.side] = { z: r.z, z2: r.z, ang: r.ang * Math.PI / 180, len: 88, oneway: null };
    return { z, w, stopR: z + w / 2 + 1.2, stopL: z - w / 2 - 1.2, stopX: ROAD_EDGE + 2.6, xIn: ROAD_EDGE + 0.01, streets, robot: !!q.robot };
  }),
];
/** Rues à sens unique où entrent les voitures qui quittent le boulevard (limete.streets, oneway 'in'). */
export const ONEWAY_IN = LIM_ST.filter(r => r.from === 'road' && r.oneway === 'in')
  .map(r => ({ side: r.side, z: r.z, z2: r.z2, ang: r.ang * Math.PI / 180, len: r.len, xIn: LIM_PB_X - PB_W / 2 }));
// Terre-plein enlevé : carrefours à feux, carrefours sans feux (limete.cuts), et devant Saint Raphaël jusqu'au début de Sendwe
const Z_ST_RAPHAEL = g(17435);
const MEDIAN_CUTS = [
  ...SIGNALS.map(sg => ({ z: sg.z, w: sg.w })),
  ...(LIM?.cuts ?? []).map(s => ({ z: -toGame(s), w: 12 })),
  ...(R.medianCuts ?? []).map(([s, w = 20]) => ({ z: g(s), w })),   // (routes.js `medianCuts` : terre-plein ouvert, ex. Entrée Siforco)
  ...(R.limete ? [{ z: (Z_ST_RAPHAEL + Z_FORK) / 2, w: Z_ST_RAPHAEL - Z_FORK + 2 }] : []),
];
const inSignalCrossing = (z, margin = 0) => MEDIAN_CUTS.some(c => Math.abs(z - c.z) < c.w / 2 + margin);
// Cycle (secondes) : vert boulevard, orange, tout rouge, vert rue, orange, tout rouge
const SIGNAL_CYCLE = [['main', 'green', 20], ['main', 'amber', 3], ['all', 'red', 1.5], ['street', 'green', 10], ['street', 'amber', 2.5], ['all', 'red', 1.5]];
const SIGNAL_T = SIGNAL_CYCLE.reduce((a, c) => a + c[2], 0);
/** Couleur des feux au temps t (s) : { main (boulevard), street (rue) } = 'green' | 'amber' | 'red'. */
export function signalState(t) {
  let u = ((t % SIGNAL_T) + SIGNAL_T) % SIGNAL_T;
  for (const [who, col, d] of SIGNAL_CYCLE) {
    if (u < d) return { main: who === 'main' ? col : 'red', street: who === 'street' ? col : 'red' };
    u -= d;
  }
  return { main: 'green', street: 'red' };
}
// Bordure du boulevard interrompue : rues qui partent de la chaussée et traversent la bande, stations dans la bande
const LIM_EDGE_GAPS = [
  ...LIM_ST.filter(r => r.from === 'road').map(r => ({ side: r.side, z: r.z, half: r.w / 2 + 0.8 })),
  ...STRIP_STATIONS.map(st => ({ side: 1, z: st.z, half: 13 })),
  ...(R.limete ? [
    { side: -1, z: (Z_ST_RAPHAEL + Z_FORK) / 2, half: (Z_ST_RAPHAEL - Z_FORK) / 2 + 2 },
    { side: 1, z: (Z_ST_RAPHAEL + Z_FORK) / 2, half: (Z_ST_RAPHAEL - Z_FORK) / 2 + 2 },
  ] : []),
];
/** Au-delà, plus de circulation (bout de la chaussée construite). Un carrefour à feux juste après l'arrivée est traversé en
 *  entier ; à une fourche (croisement Sendwe), les voitures s'engagent un peu dans la fourche avant de disparaître. */
export const TRAFFIC_START = START_ATTACHED ? -2 : Infinity;    // (trajet attaché : la circulation part dès son raccord)
export const TRAFFIC_END = R.end.kind === 'open' ? Z_END + 8 : !IS_TOWER ? -Infinity : R.ext ? Z_END + 6 : R.end.fork ? Z_END - 12
  : Math.min(Z_END + 40, ...SIGNALS.filter(sg => sg.stopL > Z_END + 20).map(sg => Math.max(Z_END + 14, sg.stopL - 15)));
/** Les piétons font demi-tour au bout de la chaussée construite (au-delà : la fourche, ou rien). */
export const WALK_END = IS_TOWER ? Z_END + 2 : -Infinity;

// ---------- Conduite libre : où le taxi peut-il rouler ? (demande de l'auteur : tour complet, demi-tour, routes secondaires) ----------
// Les deux chaussées ; le terre-plein là où le séparateur laisse un passage (face aux grandes avenues, passages piétons
// sauvages, carrefours de Limete, section autoroute où il n'est que peint) ; les avenues d'entrée (droites, en biais, en
// triangle) ; à Limete, les rues qui traversent la bande et les petits boulevards. Coordonnées du centre du taxi.
const TX_IN = MEDIAN + 0.95, TX_OUT = ROAD_EDGE - 0.55, SIDE_L = 88;
const BLK_LEN = R.barrierLen ?? 3.2;
const GREEN_TO = R.greenMedianUntil === 'END' ? -Infinity : R.greenMedianUntil ? lmZ(R.greenMedianUntil) : Infinity;
/** Le bloc béton du séparateur qui commence en zs manque-t-il ? (mêmes règles que la pose des blocs, dans buildWorld) */
function separatorGap(zs) {
  const zm = zs - BLK_LEN / 2;
  return SIDE_ROADS.some(r => !r.noGap && Math.abs(zm - r.z) < 5.5) || inMedianOpen(zm) || inSignalCrossing(zm, 1)
    || (POPULAR && Math.abs(((zs % 170) + 170) % 170 - 80) < 3);
}
function medianOpen(z) {
  if (EXT && z < Z_FORK) return extMedianOpen(z);
  if (inEchPark(z, 2) || inFlyover(z, 3)) return false;
  if (inCrossing(z, -1) || inHighway(z)) return true;
  if (z > GREEN_TO) return false;                                         // terre-plein planté (avenues rénovées)
  if (R.separator === false) return true;
  // le taxi (1,8 m de large) passe si les blocs manquent sur 1 m de part et d'autre de son centre
  return [z + 1, z - 1].every(zz => separatorGap(Z_START - Math.floor((Z_START - zz) / BLK_LEN) * BLK_LEN));
}
const pointInPoly = (p, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
/** Sur une avenue d'entrée ? e : distance au bord de la chaussée (m, vers l'extérieur), dz : écart à l'axe de l'avenue. */
function onSideRoad(s, e, z) {
  for (const r of SIDE_ROADS) {
    const sL = sideRoadLen(r);
    if (r.side !== s || Math.abs(z - r.z) > sL + 20) continue;
    const dz = z - r.z, edge = e < 0.8 ? r.w / 2 - 0.6 : null;            // au bord du boulevard : dans l'ouverture de la bordure
    // (entrée de la boucle de Masina : seulement l'embouchure, la suite est une route de Masina)
    if (r.triangle) {                                                      // embouchure en triangle (Siforco) : îlot au milieu
      if (e < 16 && Math.abs(dz) < (edge ?? 9.5 - 0.7) && Math.hypot(e - 6.4, dz) > 4.9) return true;
      if (e >= 14 && e < (r.masina ? 16.5 : sL - 2) && Math.abs(dz) < 5.25 - 0.7) return true;
      continue;
    }
    const rw = r.w + 2;
    if (!r.ang) { if (e < (r.masina ? 2 : sL - 2) && Math.abs(dz) < (edge ?? rw / 2 - 0.7)) return true; continue; }
    const a = r.ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), along = e * ca - dz * sa, across = e * sa + dz * ca;
    if (along > 3 && along < (r.link ? 10 : sL - 2) && Math.abs(across) < rw / 2 - 0.7) return true;   // (link : embouchure seule)
    // (l'embouchure commence un peu sur la chaussée, pour qu'on y passe sans bloquer au bord)
    const e0 = 4, mouth = [[-1.2, r.w / 2], [e0 * ca + sa * rw / 2, -e0 * sa + ca * rw / 2], [e0 * ca - sa * rw / 2, -e0 * sa - ca * rw / 2], [-1.2, -r.w / 2]];
    if (e < e0 * ca + 1 && pointInPoly([e, dz], mouth) && (e > 0.8 || Math.abs(dz) < r.w / 2 - 0.6)) return true;
  }
  return false;
}
const LIM_XIN = LIM_PB_X - PB_W / 2, LIM_XOUT = LIM_PB_X + PB_W / 2;
let limPbStart = null;                                                   // début des petits boulevards de Limete (droite, gauche)
/** Sous le tablier haut d'un saut-de-mouton (hors rampes), et pas contre un pilier (mêmes positions que addFlyover) ? */
function underDeck(x, z) {
  for (const f of FLYOVERS) {
    if (z > f.z0 - f.ramp - 1 || z < f.z1 + f.ramp + 1) continue;
    for (let zp = f.z0 - f.ramp - 5; zp > f.z1 + f.ramp + 5; zp -= 14) {
      if (Math.abs(z - zp) > 2.3) continue;
      if ([-RAMP_X + 2.2, 0, RAMP_X - 2.2].some(px => Math.abs(x - px) < 1.65)) return false;
    }
    return true;
  }
  return false;
}
/** À Limete : sur une rue qui traverse la bande ou sur un petit boulevard ? ax : |x|. */
function onLimeteRoad(s, ax, z) {
  if (!LIM || z > Z16 + 2 || z < Z_FORK) return false;
  limPbStart ??= { 1: Z16 - 5.5 - 45, [-1]: innerEdge(PBL_PTS, PB_W, pblT(LIM_XIN))[1] };
  if (ax > LIM_XIN + 0.6 && ax < LIM_XOUT - 0.6 && z <= limPbStart[s]) return true;
  if (ax < ROAD_EDGE - 1 || ax > LIM_XIN + 1.2) return false;
  for (const r of LIM_ST) {
    if (r.side !== s || r.from !== 'road' || Math.abs(z - r.z) > 60) continue;
    const t = Math.max(0, Math.min(1, (ax - ROAD_EDGE) / (LIM_XIN - ROAD_EDGE)));
    if (Math.abs(z - (r.z + (r.z2 - r.z) * t)) < r.w / 2 - 0.7) return true;
  }
  return false;
}
// ---------- Échangeur (l'auteur, 30/10) : « le boulevard qui contourne l'échangeur devant le triangle et celui du côté du
// pont » : la liaison entre les deux chaussées à la pointe du parc, et la route arrière avec son pont (niveau 'pont') ----------
const echDz = z => Math.abs(z - ECH.cross);
/** Entre les deux chaussées (au sol) : la liaison devant le triangle, ou la route arrière du pied de la rampe jusqu'à la
 *  chaussée de droite (avec ses deux coins arrondis). */
function onEchMedian(x, z) {
  if (!IS_TOWER || z > ECH.fork0 || z < ECH.merge) return false;
  const X = realX(x, z), B = ECH_XB, T = ECH_TRI;
  if (z < ECH.tri0 + 1.5 && z > ECH.park0 + 1) {
    return !pointInPoly([X, z], T) && [0, 1, 2].every(i => segDist(X, z, T[i], T[(i + 1) % 3]) > 1);
  }
  const dz = echDz(z);
  if (dz < B.w / 2 - 0.9 && X >= B.xLand - 2.5) return true;
  if (X > B.xRight - B.RC && dz < B.w / 2 + B.RC) {
    return [-1, 1].every(e => Math.hypot(X - (B.xRight - B.RC), z - (ECH.cross + e * (B.w / 2 + B.RC))) > B.RC + 0.9);
  }
  return false;
}
/** Sur la route arrière au-delà du pont, à gauche (au sol, jusqu'au talus du bout). */
const onEchFar = (x, z) => IS_TOWER && echDz(z) < ECH_XB.w / 2 - 0.9 && realX(x, z) <= ECH_XB.xFar + 2.5 && realX(x, z) > ECH_XB.xEnd;
/** Sur les rampes ou le tablier du pont de la route arrière (niveau 'pont'). */
const onEchBridge = (x, z) => IS_TOWER && echDz(z) < ECH_XB.w / 2 - 0.9 && realX(x, z) >= ECH_XB.xFar - 2.5 && realX(x, z) <= ECH_XB.xLand + 2.5;
/** Hauteur du goudron sur les rampes et le tablier, en x réel. */
function echBridgeH(X) {
  const B = ECH_XB;
  if (X >= B.xIn) return B.GY - 0.05 + (B.BH - B.GY + 0.05) * (1 - smooth(Math.min(1, (X - B.xIn) / (B.xLand - B.xIn)))) + 0.065;
  if (X >= B.xOut) return B.BH + 0.06;
  return B.BH * smooth(Math.max(0, (X - B.xFar) / (B.xOut - B.xFar))) + 0.065;
}
// ---------- Pont Matete (l'auteur, 31/10 : « entrer dans la boucle de Pont Matete pour passer en dessous, aller de l'autre
// côté ») : une boucle au sol de chaque côté (matLoopPts, comme addPontMatete) et le passage sous le 2e pont (z = ZB2), sous
// le boulevard en remblai ; on y roule au niveau 'sous' (ni le boulevard au-dessus ni ses voitures ne gênent) ----------
const MAT_UX = ROAD_EDGE + 10.2;                     // bout du passage sous le 2e pont, où commencent les boucles
const MAT_COVER = ROAD_EDGE + 3;                     // en deçà : sous le tablier (niveau 'sous')
const matLoopPts = s => [[s * MAT_UX, ZB2], [s * 80, ZB2 - 6], [s * (ROAD_EDGE + 6), ZB2 - 72], [s * (ROAD_EDGE + 4), ZB2 - 102]];
const MAT_LOOPS = HAS_MATETE ? [1, -1].map(s => ({ s, pts: Array.from({ length: 41 }, (_, i) => bez(matLoopPts(s), i / 40)) })) : [];
const matBand = z => HAS_MATETE && Math.abs(z - ZB2) < 4 - 0.9;   // dans le passage (route de 8 m entre les trottoirs)
/** Segment de boucle du Pont Matete sous le point (au sol), ou null. */
function mateteSeg(x, z) {
  if (!HAS_MATETE || z > ZB2 + 8 || z < ZB2 - 110) return null;
  const L = MAT_LOOPS.find(l => l.s === (x >= 0 ? 1 : -1)).pts;
  for (let i = 1; i < L.length; i++) if (segDist(x, z, L[i - 1], L[i]) < 7.5 / 2 - 0.9) return [L[i - 1], L[i]];
  return null;
}
/** Sur une boucle du Pont Matete (au sol), sur son raccord au boulevard ou à l'entrée du passage sous le 2e pont. */
function onMateteLoop(x, z) {
  if (!HAS_MATETE || z > ZB2 + 8 || z < ZB2 - 110) return false;
  const ax = Math.abs(x);
  if (matBand(z) && ax >= MAT_COVER - 0.5 && ax < MAT_UX + 3) return true;
  if (z < LOOP_GAPS[0][0] - 1.5 && z > LOOP_GAPS[0][1] + 1.5 && ax < ROAD_EDGE + 8) return true;
  return !!mateteSeg(x, z);
}
// ---------- Entrée Matete (croquis de l'auteur, 31/10 : « le petit boulevard de l'entrée Matete … s'attache au grand
// boulevard avant la station Debonhomme … donc il passe derrière la station » ; « regarde comment l'entrée Matete s'attache
// à la boucle ») ----------
// MAT_PB : petit boulevard de l'Entrée Matete. Il part du bord gauche du boulevard juste au bout du saut-de-mouton de
// Debonhomme (sideRoads `link: 'matete'`, l'embouchure en biais), passe derrière la Station ENGEN, longe le boulevard derrière
// les maisons et s'attache à la Route Poids Lourds côté Matete, à la sortie du Pont Matete, sans la traverser. La Route
// Poids Lourds reste un décor : au carrefour, le taxi a juste la place de faire demi-tour.
// MAT_RAMP : l'Entrée Matete vers la boucle. Bretelle qui quitte le bord gauche du boulevard juste après le Pont Matete (en
// haut du remblai), descend le long du triangle de pelouse et arrive en T sur la boucle de gauche (t = MAT_TJ) par une
// embouchure évasée (bordure de la boucle ouverte de MAT_TJ - MAT_TDT à MAT_TJ + MAT_TDT).
const MAT_ZPL = ZM + 6;                               // axe de la Route Poids Lourds de gauche (comme addPontMatete)
const MAT_TJ = 0.1, MAT_TDT = 1 / 15;
/** Normale d'une boucle du Pont Matete en t, tournée vers l'extérieur (loin du boulevard). */
function matLoopOut(s, t) {
  const L = matLoopPts(s), [ax, az] = bez(L, Math.max(0, t - 0.005)), [bx, bz] = bez(L, Math.min(1, t + 0.005));
  const len = Math.hypot(bx - ax, bz - az), n = [(bz - az) / len, -(bx - ax) / len];
  return s * n[0] > 0 ? n : [-n[0], -n[1]];
}
/** Points d'une suite de courbes de Bézier (n pas chacune). */
const bezChain = (curves, n) => curves.flatMap((c, k) => Array.from({ length: n + (k === curves.length - 1 ? 1 : 0) }, (_, i) => bez(c, i / n)));
const bboxOf = (pts, m) => {
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  return [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...zs) - m, Math.max(...zs) + m];
};
/** Sur une route décrite par ses points `pts` et ses demi-largeurs `hw` (marge de bordure 0,7 m) ? */
function onRibbon(Q, x, z) {
  if (x < Q.box[0] || x > Q.box[1] || z < Q.box[2] || z > Q.box[3]) return false;
  for (let i = 1; i < Q.pts.length; i++) if (segDist(x, z, Q.pts[i - 1], Q.pts[i]) < Math.min(Q.hw[i - 1], Q.hw[i]) - 0.7) return true;
  return false;
}
/** Segment de la route le plus proche du point (indice de son 2e point). */
function ribbonSeg(Q, x, z) {
  let k = 1, best = Infinity;
  for (let i = 1; i < Q.pts.length; i++) {
    const d = segDist(x, z, Q.pts[i - 1], Q.pts[i]);
    if (d < best) { best = d; k = i; }
  }
  return k;
}
// ---------- Liaisons Lumumba ↔ Route Poids Lourds (14e, 15e, 16e, 17e Rues, Av. de l'Aérodrome) ----------
// Elles prolongent les rues de Limete, qui s'arrêtent à 90 m du petit boulevard, jusqu'aux rues d'entrée de la Route Poids Lourds. Le
// tracé (data/poidslourds_links.json, tools/poids_lourds_links.js) est dans le repère de la Route Poids Lourds, où le taxi les parcourt.
const PL_LINK_DATA = await __pPlLinks;
/** Repère du trajet principal : bouts de rue de Limete où le taxi passe sur la liaison (a → b : en s'éloignant du boulevard). */
export const PL_STUBS = R.attachPL && LIM ? (() => {
  const r15 = LIM_ST.find(r => r.name === '15e RUE'), r14 = LIM_ST.find(r => r.name === '14e RUE' && r.side > 0), a15 = r15.ang * Math.PI / 180;
  const S15 = [LIM_XOUT + 2, r15.z], u15 = [Math.cos(a15), -Math.sin(a15)];
  return [
    { key: '17e', a: [PB_X + 2, ECH.rue17], b: [PB_X + 4 + 84, ECH.rue17] },
    { key: '16e', a: [ROAD_EDGE + 40, Z16], b: [ROAD_EDGE + 84, Z16] },
    { key: '15e', a: S15, b: [S15[0] + u15[0] * 84, S15[1] + u15[1] * 84] },
    { key: '14e', a: [LIM_XOUT - 1, r14.z], b: [LIM_XOUT + 84, r14.z] },
  ];
})() : [];
const ribbon = (pts, hw) => ({ pts, hw: pts.map(() => hw), box: bboxOf(pts, hw + 1) });
// ---------- Ronds-points de l'avenue de l'Université (vidéo d'Ezo, croquis de Ngaba) ----------
// L'avenue les longe (axe x = 0) : l'îlot central est sur le côté, comme sur OSM et sur le croquis, et la circulation passe à côté.
// Ezo : à droite en allant vers l'UNIKIN, avec la fourche en Y côté Sendwe. Ngaba : la grande station, à gauche.
const VIC_ISL = 14, VIC_R = 23;
const VIC_ENGEN_A = 1.19, VIC_ENGEN_R = VIC_R + 15;   // la station Engen, en diagonale du rond-point (angle autour de la place, distance au centre)                      // Rond-point Victoire : rayon de la place, rayon extérieur de la chaussée qui en fait le tour
const RINGS = (R.rings ?? []).map(r => {
  // Rond-point Victoire (l'auteur, 08/11, photos et vidéo du dossier « route kasa-vubu ») : la place ronde au milieu de l'avenue, la chaussée tout autour
  if (r.kind === 'victoire') {
    const z = g(r.s);
    return { kind: 'victoire', z, c: [0, z], isl: VIC_ISL, r: VIC_R, reach: VIC_R + 28, engen: [Math.sin(VIC_ENGEN_A) * VIC_ENGEN_R, z + Math.cos(VIC_ENGEN_A) * VIC_ENGEN_R] };
  }
  if (r.kind === 'gap') return { kind: 'gap', z: (g(r.s0) + g(r.s1)) / 2, reach: (g(r.s0) - g(r.s1)) / 2 + 30, z0: g(r.s0), z1: g(r.s1) };   // (By Pass : traversée du Rond-Point Ngaba de l'avenue)
  const z = g(r.s);
  return r.kind === 'ezo'
    ? { kind: 'ezo', z, c: [24, z], r: 30, isl: 13, reach: 76,
      branch: ribbon(Array.from({ length: 13 }, (_, i) => bez([[1, z + 70], [8, z + 52], [40, z + 46], [47, z + 20]], i / 12)), 5),
      tri: [[3.5, z + 60], [6, z + 33], [31, z + 37]] }
    : { kind: 'ngaba', z, c: [-25, z], r: 31, reach: 66, rect: { x: -25, z, hx: 16, hz: 7.5, ry: 0.22 }, tri: [[-5.5, z + 36], [-13, z + 36], [-9, z + 50]] };
});
for (const q of RINGS) if (q.kind === 'victoire') THEFT_ZONES.push({ z0: q.z + 70, z1: q.z - 70 });   // (vols à moto autour de la Place Victoire)
/** Passage dans la pelouse (By Pass) : tous les 180 m, avec un passage piéton, et en face des grandes rues. */
const pairOpen = z => (((-z % 180) + 180) % 180) < 7 || SIDE_ROADS.some(r => r.w > 5 && Math.abs(r.z - z) < 5);
/** Points de raccord du By Pass. Sur le By Pass : la traversée du rond-point (`gap`) et le bout de la rue de la Route de Kimwenza (`kim`). */
export const BP_JOIN = R.kimJoin ? (() => {
  const G = RINGS.find(q => q.kind === 'gap'), r = SIDE_ROADS.find(q => q.name === 'ROUTE DE KIMWENZA'), a = r.ang * Math.PI / 180, s = r.side, L = r.len - 3;
  return { z0: G.z0, z1: G.z1, kim: [s * ROAD_EDGE + s * Math.cos(a) * L, r.z - Math.sin(a) * L], kimA: [s * ROAD_EDGE + s * Math.cos(a) * (L - 8), r.z - Math.sin(a) * (L - 8)] };
})() : null;
const BP_AIRY = z => !!PAIR && z > (RINGS.find(q => q.kind === 'gap')?.z0 ?? 0);
const CAMPUS_Z = R.campus ? R.campus.gate + 30 : -Infinity;   // (avenue de l'Université : au-delà, le campus : addCampus)
const nearRing = (z, m = 0) => RINGS.some(q => Math.abs(z - q.z) < q.reach + m);
/** Rond-point Victoire : écart (x) d'un véhicule de la voie x qui contourne la place, chacun de son côté (la place à sa gauche, comme on roule à droite). */
export function ringShift(x, z) {
  for (const q of RINGS) {
    if (q.kind !== 'victoire') continue;
    const Re = q.r + 12, dz = z - q.z;
    if (Math.abs(dz) >= Re) continue;
    const k = Math.cos(Math.PI / 2 * dz / Re) ** 2, ax = Math.abs(x), Rl = (q.isl + q.r) / 2 + 0.4;
    return Math.sign(x || 1) * (ax + (Math.max(ax, Rl) - ax) * k);
  }
  return x;
}
/** Sur un rond-point ? null : non ; 'free' : on y roule librement ; 'island' : îlot, station. */
function ringAt(x, z) {
  for (const q of RINGS) {
    if (q.kind === 'gap' || Math.abs(z - q.z) > q.reach + 4) continue;
    const d = Math.hypot(x - q.c[0], z - q.c[1]);
    if (q.kind === 'victoire') {
      if (d < q.isl + 0.6) return 'island';
      if (d < q.r - 0.7) return 'free';
      // l'aire de la station Engen, reliée à la chaussée du rond-point (u : vers l'extérieur, t : en travers)
      const dx = x - q.engen[0], dz = z - q.engen[1], u = dx * Math.sin(VIC_ENGEN_A) + dz * Math.cos(VIC_ENGEN_A), t = dx * Math.cos(VIC_ENGEN_A) - dz * Math.sin(VIC_ENGEN_A);
      if (u > -15.5 && u < 3.8 && Math.abs(t) < 7.3) return 'free';
      continue;
    }
    if (q.kind === 'ezo') {
      if (d < q.isl + 1 || pointInPoly([x, z], q.tri)) return 'island';
      if (d < q.r - 0.7 || onRibbon(q.branch, x, z)) return 'free';
    } else {
      const R0 = q.rect, c = Math.cos(R0.ry), s = Math.sin(R0.ry), dx = x - R0.x, dz = z - R0.z, u = dx * c - dz * s, v = dx * s + dz * c;
      if (Math.abs(u) < R0.hx + 1 && Math.abs(v) < R0.hz + 1) return 'island';
      if (pointInPoly([x, z], q.tri)) return 'island';
      if (d < q.r - 0.7 || (Math.abs(z - q.z) < q.reach - 6 && x > -15 && x < ROAD_EDGE + 6 && Math.abs(z - (q.z - 6)) < 7) || (Math.abs(z - q.z) < q.reach - 6 && x > -15 && x < ROAD_EDGE)) return 'free';
    }
  }
  return null;
}
// ---------- Séparations du By Pass (croquis de l'auteur, 07/11 : « station salongo », « rondpoint et triangle ») ----------
// Salongo : la pelouse finit, la route se sépare en deux ; le By Pass à droite, la route de Salongo à gauche. Au milieu : la station à la pointe, l'espace
// clôturé derrière, et une petite route derrière lui relie les deux. Kimwenza : le triangle à la pointe, tout entouré de route, puis la station.
const FORKS = (R.forks ?? []).map(f => {
  const F = f.z;
  if (f.kind === 'salongo') {
    const P = [[-2.6, F + 8], [-5, F - 8], [-24, F - 26], [-62, F - 70]], out = Array.from({ length: 17 }, (_, i) => bez(P, i / 16));
    for (let i = 1; i <= 6; i++) out.push([-62 - 5 * i, F - 70 - 6 * i]);
    const link = Array.from({ length: 13 }, (_, i) => bez([[-2.6, F - 100], [-14, F - 96], [-34, F - 86], [-58, F - 66]], i / 12));
    return { ...f, z0: F + 14, z1: F - 108, st: { x: -13, z: F - 42 }, roads: [{ pts: out, w: 8.4, Q: ribbon(out, 5.1) }, { pts: link, w: 7, Q: ribbon(link, 4.4) }],
      pad: [[-2.8, F - 10], [-14.2, F - 24.4], [-32.3, F - 45.5], [-37, F - 51], [-37, F - 58], [-2.8, F - 58]],
      island: [[-5, F - 14], [-14.2, F - 24.4], [-32.3, F - 45.5], [-50, F - 66], [-31.4, F - 81.6], [-12.4, F - 91], [-4.6, F - 93]], curbs: [[-37, F - 51], [-50, F - 66], [-31.4, F - 81.6], [-12.4, F - 91], [-4.6, F - 93], [-4.6, F - 58]],
      wall: [[-6.5, F - 60], [-38, F - 60], [-44, F - 66.5], [-30, F - 76.5], [-12, F - 85.5], [-6.5, F - 85.5]] };
  }
  return { ...f, z0: F + 20, z1: F - 72, st: { x: -17, z: F - 46 }, roads: [],
    pad: [[-2.8, F - 1], [-10.4, F - 14.5], [-16.9, F - 22.5], [-28, F - 32.5], [-40, F - 42], [-40, F - 64], [-2.8, F - 64]],
    tri: [[-7, F - 13], [-7, F - 26], [-15.5, F - 26]], curbs: [[-40, F - 64], [-4.6, F - 64]] };
});
const FORK_R = FORKS.flatMap(f => f.roads.map(r => r.Q));
const nearFork = (z, m = 0) => FORKS.some(f => z < f.z0 + m && z > f.z1 - m);
/** Sur une séparation ? null : non ; 'road' : ses routes ; 'pad' : l'aire de la station ; 'island' : îlot, triangle, espace clôturé. */
function forkAt(x, z) {
  for (const f of FORKS) {
    if (z > f.z0 || z < f.z1 || x > 0) continue;
    if (f.tri && pointInPoly([x, z], f.tri)) return 'island';
    if (pointInPoly([x, z], f.pad)) return 'pad';
    if (f.island && pointInPoly([x, z], f.island)) return 'island';
    if (f.roads.some(r => onRibbon(r.Q, x, z))) return 'road';
  }
  return null;
}
// Le petit boulevard de droite, de la 17e à la 16e Rue, puis sa courbe vers celui de Limete (mêmes points qu'addInterchange, addLimete)
const PL_R1 = PL_STUBS.length ? [
  ...PL_STUBS.map(q => {                               // (un peu au-delà du bout de la rue : le taxi y arrive depuis la liaison)
    const L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);
    return ribbon([q.a, [q.b[0] + (q.b[0] - q.a[0]) / L * 12, q.b[1] + (q.b[1] - q.a[1]) / L * 12]], 5.2);
  }),
  ribbon([[PB_X, ECH.rue17 + 8], [PB_X, Z16 - 5.5]], 4.2),
  ribbon(Array.from({ length: 13 }, (_, i) => bez([[PB_X, Z16 - 5.5], [PB_X, Z16 - 21.5], [LIM_PB_X, Z16 - 34.5], [LIM_PB_X, Z16 - 50.5]], i / 12)), 4.4),
] : [];
const onPLR1 = (x, z) => PL_R1.some(Q => onRibbon(Q, x, z));
/** L'entrée du By Pass à l'Échangeur, dans le repère du trajet principal (même courbe que addInterchange) ; le taxi change de route à son bout. */
// (l'auteur, 13/11, croquis « entrebaypassCoriger » : un Y) : deux branches se rejoignent au début du By Pass (b) : la sortie (P : la chaussée de gauche,
// vers l'aéroport, quitte le boulevard vers le By Pass) et l'entrée (P2 : du By Pass, on rejoint la chaussée de gauche plus loin, dans le sens
// de l'aéroport, vers Masina). Avant : seule la sortie existait, et depuis le By Pass on arrivait à contresens sur le boulevard.
export const BP_STUB = R.attachBp ? (() => {
  const P = [[-(ROAD_EDGE + 4), ECH.bypass - 20], [-(ROAD_EDGE + 4.5), ECH.bypass], [-(ROAD_EDGE + 30), ECH.bypass + 25], [-(ROAD_EDGE + 58), ECH.bypass + 48]];
  const pts = Array.from({ length: 15 }, (_, i) => bez(P, i / 14)), e = pts[14], c = pts[13], L = Math.hypot(e[0] - c[0], e[1] - c[1]);
  const P2 = [[-(ROAD_EDGE + 4.5), ECH.bypass + 96], [-(ROAD_EDGE + 8), ECH.bypass + 64], [-(ROAD_EDGE + 37), ECH.bypass + 30.75], e];
  const pts2 = Array.from({ length: 17 }, (_, i) => bez(P2, i / 16));
  const tail = [e[0] + (e[0] - c[0]) / L * 9, e[1] + (e[1] - c[1]) / L * 9];
  return { a: bez(P, 0.8), a2: bez(P2, 0.8), b: e, P, P2, pts: [[-(ROAD_EDGE - 1), ECH.bypass - 25], ...pts, tail], pts2: [[-(ROAD_EDGE - 1), ECH.bypass + 106], ...pts2, tail] };
})() : null;
const BP_R1 = BP_STUB ? ribbon(BP_STUB.pts, 5) : null, BP_R2 = BP_STUB ? ribbon(BP_STUB.pts2, 5) : null;
const onBpStub = (x, z) => !!BP_R1 && (onRibbon(BP_R1, x, z) || onRibbon(BP_R2, x, z));
// ---------- Routes secondaires de Limete (l'auteur, 06/11 : « les chemins secondaires doivent être opérationnels ») ----------
// Toutes les rues dessinées au-delà des petits boulevards se conduisent jusqu'à leur bout ; les petits boulevards ont leur entrée
// depuis le grand boulevard (droite : avant le Collège Lumumba ; gauche : la bretelle avant la 16e Rue).
const SEC_R = LIM && IS_TOWER ? (() => {
  const out = [], rad = a => a * Math.PI / 180, zPb1 = ECH.pb0 - 50;
  const pbR = [[ROAD_EDGE + 4, ECH.pb0], [ROAD_EDGE + 4.5, ECH.pb0 - 16], [PB_X, zPb1 + 18], [PB_X, zPb1]];
  out.push(ribbon([[ROAD_EDGE - 1, ECH.pb0 + 6], ...Array.from({ length: 13 }, (_, i) => bez(pbR, i / 12))], 8));   // (large : pas de mur invisible entre la chaussée et le petit boulevard dessiné)
  out.push(ribbon([[PB_X, zPb1], [PB_X, Z16 - 5.5]], 4.4));
  out.push(ribbon(Array.from({ length: 13 }, (_, i) => bez([[PB_X, Z16 - 5.5], [PB_X, Z16 - 21.5], [LIM_PB_X, Z16 - 34.5], [LIM_PB_X, Z16 - 50.5]], i / 12)), 4.4));
  out.push(ribbon([[-(ROAD_EDGE - 1), ECH.pbL + 6], ...Array.from({ length: 13 }, (_, i) => bez(PBL_PTS, i / 12))], 5));
  for (const r of LIM_ST) {
    if (!(r.len > 0)) continue;
    const a = rad(r.ang), sd = r.side, w = r.from === 'service' ? 5 : r.w, zm = r.from === 'road' ? r.z2 : r.z;
    const u = [sd * Math.cos(a), -Math.sin(a)], n = [-u[1], u[0]], S = [sd * (LIM_XOUT + 0.4 + (w / 2) * Math.abs(Math.sin(a))), zm];
    const at = (P, d, k) => [P[0] + d[0] * k, P[1] + d[1] * k], E = at(S, u, r.len);
    out.push(ribbon([at(S, u, -4), E], w / 2 + 0.7));
    if (r.roundabout) {                                  // rond-point au bout (Zinnias) : l'anneau et ses trois branches
      out.push(ribbon([E, [E[0] + 0.01, E[1]]], 11));
      for (const [d, L] of [[u, 34], [n, 40], [[-n[0], -n[1]], 40]]) out.push(ribbon([E, at(E, d, 9.5 + L)], 5.3));
    }
  }
  return out;
})() : [];
const onSecR = (x, z) => SEC_R.some(Q => onRibbon(Q, x, z));
// ---------- Stations et arrêts dans les deux sens (l'auteur, 06/11 : « ça devait aller dans tous les sens ») ----------
const ALL_PLACES = [...(R.places ?? []), ...(LIM?.places ?? []), ...(EXT?.places ?? []).map(p => ({ ...p, s: EXT.from + (p.s ?? p.s0 ?? 0) }))]
  .filter(p => typeof p.s === 'number');
// Les stations dessinées au bord de la route (addSideFuel, sans décalage) : leur aire, du bord de la chaussée jusqu'au fond (19 m), sur 28 m
SIDE_APRONS = ALL_PLACES.filter(p => p.kind === 'fuel' && !(LIM?.places ?? []).includes(p)).map(p => ({ side: p.side, z: g(p.s), half: 14 }));
/** Sur l'aire d'une station au bord de la route (on y entre depuis la chaussée, on y fait le plein) ? */
export const onSideApron = (x, z) => SIDE_APRONS.some(q => q.side === (x >= 0 ? 1 : -1) && Math.abs(z - q.z) < q.half - 0.5 && Math.abs(x) > ROAD_EDGE - 0.6 && Math.abs(x) < ROAD_EDGE + 19);
/** Où l'on peut faire le plein : les stations du trajet, celles qui étaient seulement dessinées (Engen, TotalEnergies…) et celle de l'Échangeur. */
export const FUELS = [...STATIONS.map(st => ({ ...st, side: 1 })), ...ALL_PLACES.filter(p => p.kind === 'fuel' || p.kind === 'kadafi').map(p => ({ name: p.name, z: g(p.s), side: p.side, kadafi: p.kind === 'kadafi' })),
  ...(IS_TOWER ? [{ name: 'Station', z: ECH.station, side: 1 }] : []), ...RINGS.filter(q => q.kind === 'victoire').map(q => ({ name: 'Engen Victoire', z: q.engen[1], side: 1, area: [q.engen[0], q.engen[1], 9] })),
  ...RINGS.filter(q => q.kind === 'ezo' || q.kind === 'ngaba').map(q => (q.kind === 'ngaba' ? { name: 'Station Rond-Point Ngaba', z: q.z, side: -1 } : { name: 'Station Ezo', z: q.z + 26, side: 1 })),
  ...FORKS.map(f => ({ name: f.name, z: f.st.z, side: -1 }))];
// Stations des petits boulevards (l'auteur, 06/11) : leurs aires goudronnées se conduisent (mêmes emprises que le dessin)
const FUEL_R = LIM && IS_TOWER ? [
  ribbon([[ROAD_EDGE + 10.7, ECH.station + 13], [ROAD_EDGE + 10.7, ECH.station - 13]], 12.4),  // Échangeur : du boulevard au petit boulevard
  ...STRIP_STATIONS.map(st => ribbon([[ROAD_EDGE + 6.2, st.z + 12], [ROAD_EDGE + 6.2, st.z - 12]], 7.4)),   // dans la bande, depuis le boulevard
  ...(LIM.places ?? []).filter(p => p.kind === 'fuel').map(p => {                                // derrière le petit boulevard (TOTAL, 14e Rue)
    const xc = p.side * (LIM_XOUT + 6.8), z = g(p.s);
    return ribbon([[xc, z + 13], [xc, z - 13]], 8.6);
  }),
] : [];
const onFuelR = (x, z) => FUEL_R.some(Q => onRibbon(Q, x, z));
/** Côté (1 ou -1) du petit boulevard ou de l'aire de station sous le taxi, 0 ailleurs : on y fait le plein aux stations de ce côté. */
export function fuelSideAt(x, z) {
  const ax = Math.abs(x), s = x >= 0 ? 1 : -1;
  if (onFuelR(x, z) || forkAt(x, z) === 'pad' || onSideApron(x, z)) return s;
  if (LIM && z <= Z16 + 2 && z >= Z_FORK && ax > LIM_XIN - 0.5 && ax < LIM_XOUT + 0.5) return s;   // petits boulevards de Limete
  if (IS_TOWER && x > 0 && z <= ECH.pb0 && z >= Z16 && Math.abs(x - PB_X) < PB_W / 2 + 0.5) return 1;   // petit boulevard de l'Échangeur
  return 0;
}
const PLACES_L = ALL_PLACES.filter(p => p.side === -1 && p.kind !== 'pont_matete').map(p => g(p.s));
/** Arrêt possible à gauche en z ? (ni rue, ni lieu, ni pont, ni virage, ni parc de l'Échangeur, ni Pont Matete) */
const leftStopFree = z => z < -60 && z > Z_END + 20 && !nearRing(z, 20) && !nearFork(z, 20) && !atSideRoad(-1, z, 14) && !PLACES_L.some(q => Math.abs(q - z) < 30)
  && !inRiver(z, 20) && !inRaised(z, 20) && !inCrossing(z, 12)   // (sous un saut-de-mouton : sur les voies du bas, comme à droite)
  && !(IS_TOWER && z < ECH.fork0 + 20 && z > ECH.merge - 20) && !(HAS_MATETE && z < MATETE_ZONE[-1][0] + 10 && z > MATETE_ZONE[-1][1] - 10)
  && !EXT_ARCS.some(a => z < a.z0 + 40 && z > a.z1 - 40) && !(LIM && z < Z16 + 10 && z > Z_FORK - 10);
/** Arrêts de la chaussée de gauche : en face de ceux de droite (un peu décalés s'il le faut). À Limete : `leftStops`, déjà dessinés. */
export const BUS_STOPS_L = [
  ...BUS_STOPS.map(z => [0, -18, 18, -36, 36, -54, 54, -72, 72].map(d => z + d).find(leftStopFree)).filter(z => z !== undefined),
  ...(LIM?.leftStops ?? []).map(([sr]) => -toGame(sr)),
];
/** Repère de la Route Poids Lourds : les liaisons, de leur rue d'entrée jusqu'à Limete ou la fourche. */
export const PL_LINKS = R.pl && PL_LINK_DATA ? PL_LINK_DATA.links.map(l => ({ ...l, Q: { pts: l.pts, hw: l.pts.map((_, i) => (i >= l.draw ? 7.4 : l.w / 2 + 0.9)), box: bboxOf(l.pts, 9) } }))
  : [...(R.uniRoads ?? []), ...(R.campus?.roads ?? [])].map(l => {
    // (les routes du repère de l'avenue partent des ronds-points)
    const z0 = R.rings ? g(R.rings[0].s) : 0, head = l.key === 'ezo_o' ? [[46, z0]] : [], pts = [...head, ...l.pts];
    return { ...l, pts, draw: pts.length, Q: { pts, hw: pts.map(() => l.w / 2 + 0.9), box: bboxOf(pts, 9) } };
  });
const onPLLink = (x, z) => PL_LINKS.some(l => onRibbon(l.Q, x, z));
/** Sur l'avenue de l'Université : les sorties du Rond-Point Ngaba vers le By Pass (est, ouest) et le début de la Route de Kimwenza. */
export const UNI_JOIN = R.rings && R.uniRoads ? (() => {
  const z = g(R.rings[1].s), P = PL_LINKS.find(l => l.key === 'kimwenza').pts;
  return { E: [-30, z - 24], W: [3.2, z - 6], c: [-25, z], kim: P[0], kimB: P[1] };
})() : null;
/** L'entrée de l'avenue de l'Université sur le boulevard Sendwe, dans le repère du trajet principal : { a, b } (b : son bout). */
export const UNI_STUB = R.attachUni ? (() => {
  const r = SIDE_ROADS.find(q => q.name === "AV. DE L'UNIVERSITÉ"), a = r.ang * Math.PI / 180, u = [r.side * Math.cos(a), -Math.sin(a)], L = sideRoadLen(r) - 3;
  const P = e => [r.side * ROAD_EDGE + u[0] * e, r.z + u[1] * e];
  return { a: P(Math.max(4, L - 12)), b: P(L), side: r.side };
})() : null;
/** Fourche Sendwe : le prolongement du boulevard Lumumba (posé en bloc, voir addSendweFork), en coordonnées de scène du trajet principal. */
export function plForkArm() {
  const ze = Z_FORK, p = frameAt(ze), c = Math.cos(p.th), s = Math.sin(p.th);
  const Lm = [[ROAD_EDGE - 7, ze], [ROAD_EDGE - 7, ze - 12], [ROAD_EDGE, ze - 40], [ROAD_EDGE + 21, ze - 115]];
  const [a, e] = [Lm[2], Lm[3]], n = Math.hypot(e[0] - a[0], e[1] - a[1]), end = [e[0] + (e[0] - a[0]) / n * 160, e[1] + (e[1] - a[1]) / n * 160];
  const pts = [end, e, ...[0.85, 0.7, 0.55].map(t => bez(Lm, t))];   // du bout vers la chaussée
  return pts.map(([x, z]) => { const dz = z - ze; return [p.x + x * c - dz * s, p.z + x * s + dz * c]; });
}
/** Le taxi quitte la chaussée vers le prolongement du boulevard Lumumba (fourche Sendwe) ? */
export const plForkHit = (x, z) => !!PL_STUBS.length && x > TX_OUT - 0.4 && z < Z_FORK - 30 && z > Z_FORK - 62;

const MAT_PB = (() => {
  const r = HAS_MATETE && SIDE_ROADS.find(q => q.link === 'matete');
  if (!r) return null;
  const s = r.side, a = r.ang * Math.PI / 180, u = [s * Math.cos(a), -Math.sin(a)];
  const P0 = [s * ROAD_EDGE + u[0] * 8, r.z + u[1] * 8];                     // (recouvre le bout de l'embouchure)
  const eng = (R.places ?? []).find(p => p.kind === 'fuel' && p.side === s && Math.abs(g(p.s) - r.z) < 80);
  const ZE = eng ? g(eng.s) : r.z - 30, xb = s * 68, xf = s * 40;           // derrière les maisons (2e rangée : |x| ≤ 59)
  const pts = bezChain([
    [P0, [P0[0] + u[0] * 14, P0[1] + u[1] * 14], [s * 62, ZE + 8], [xb, ZE - 8]],    // derrière la Station ENGEN
    [[xb, ZE - 8], [xb, ZE - 40], [xb, ZM + 150], [xb, ZM + 118]],
    [[xb, ZM + 118], [xb, ZM + 98], [xf, ZM + 93], [xf, ZM + 70]],                 // vers le pied du remblai
    [[xf, ZM + 70], [xf, ZM + 50], [xf, ZM + 30], [xf, MAT_ZPL + 3.5]],           // jusqu'à la Route Poids Lourds
  ], 12);
  const hw = pts.map((p, i) => 4 + (r.w / 2 + 1 - 4) * Math.max(0, 1 - i / 8));    // 11 m (embouchure) → 8 m
  return {
    s, pts, hw, xEnd: xf, box: bboxOf(pts, 8),
    pad: [Math.min(xf - 11, xf + 11), Math.max(xf - 11, xf + 11), MAT_ZPL - 3.3, MAT_ZPL + 4.5],   // carrefour : demi-tour
  };
})();
const onMatPB = (x, z) => !!MAT_PB && (onRibbon(MAT_PB, x, z)
  || (x > MAT_PB.pad[0] && x < MAT_PB.pad[1] && z > MAT_PB.pad[2] && z < MAT_PB.pad[3]));
// Route Poids Lourds (l'auteur, 31/10 : « donne la possibilité aussi de prendre la route poids lourds pour tourner au pont
// matete et venir entrer dans le boulevard derrière la station ») : on la prend par sa bretelle de droite (MAT_PL_PTS, la
// même courbe qu'addPontMatete), on fait demi-tour sur l'aire de la jonction avec la route des rails en biais, on passe sous
// le Pont Matete (niveau 'sous', comme sous le 2e pont) et on suit à gauche la route tout droit jusqu'au petit boulevard de
// l'Entrée Matete (MAT_PB), qui ramène au boulevard derrière la Station ENGEN.
const MAT_ZPD = ZM + 9;                               // route des rails en biais à droite : par (0, MAT_ZPD), direction (0,8 ; -0,6)
// (l'auteur, 08/11, croquis « corrction poilourd pont matete » : en Y, la bretelle d'Akram rejoint la route qui vient de sous le pont plus loin,
// en biais et dans le même sens ; entre les deux, un îlot en pointe. Avant, elle la coupait en travers tout près du pont.)
export const MAT_PL_PTS = [[ROAD_EDGE + 4, ZM + 176], [ROAD_EDGE + 4, ZM + 146], [50, MAT_ZPD - 20], [92, MAT_ZPD - 69]];   // fin : alongRail(ZPD, 115), presque dans l'axe
/** [le long, en travers] de la route des rails en biais (u = 0 sous le milieu du Pont Matete, n > 0 côté de la bretelle). */
const plDiag = (x, z) => [0.8 * x - 0.6 * (z - MAT_ZPD), 0.6 * x + 0.8 * (z - MAT_ZPD)];
const MAT_PL = HAS_MATETE ? (() => {
  const N = 30, pts = Array.from({ length: N + 1 }, (_, i) => bez(MAT_PL_PTS, i / N));
  // goudron continu entre la chaussée et la bretelle tant qu'elle n'en est pas séparée (comme fillToEdge) ; pour la conduite,
  // jusqu'à l'axe de la bretelle, pour rejoindre sa voie sans buter sur la marge de bordure
  const tSep = tAtGap(MAT_PL_PTS, 8, 4.2), edge = Array.from({ length: 11 }, (_, k) => bez(MAT_PL_PTS, tSep * k / 10));
  const u = 75, n = 8;                                // aire de demi-tour : dans l'angle entre la bretelle et la route des rails (pointe de l'îlot)
  return {
    pts, hw: pts.map(() => 5.0), box: bboxOf(pts, 10), tSep,
    mouth: [[ROAD_EDGE - 1.2, edge[0][1] + 2.5], ...edge, [ROAD_EDGE - 1.2, edge[10][1] - 2.5]],
    pad: [u * 0.8 + n * 0.6, MAT_ZPD - u * 0.6 + n * 0.8], padR: 9.0,  // (on y tourne à gauche, vers le Pont Matete)
  };
})() : null;
// Fin de la route des rails en biais (l'auteur, 08/11 : « ça doit avoir la même grandeur », « ça ne doit pas montrer qu'il y a un raccordement ») :
// après le Y d'Akram, elle prend peu à peu la coupe de la Route Poids Lourds attachée (2 × 2 voies de 3,5 m, bande grise de 2,4 m au milieu, caniveaux,
// deux voies ferrées à gauche), si bien qu'au raccord (u = PL_JOIN_U) les deux routes sont identiques.
const smooth01 = t => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
const PL_MED = 0.12;                                  // (l'auteur, 27/11 : le milieu n'est qu'UNE ligne, pas une bande où l'on passe)
const PL_HALF = PL_MED + 2 * LANE_W;                     // demi-largeur de la Route Poids Lourds (son MEDIAN + 2 voies)
const plHalfR = u => 4 + (PL_HALF - 4) * smooth01((u - 115) / 35);   // bord droit (côté Akram) : s'élargit juste après le Y
const plHalfL = u => 4 + (PL_HALF - 4) * smooth01((u - 200) / 40);   // bord gauche : une fois la voie ferrée écartée
const plMed = u => PL_MED * smooth01((u - 115) / 35);                    // demi-largeur de la bande grise du milieu
const plRailA = u => -12 - 5.2 * smooth01((u - 150) / 70);           // voie ferrée (en travers) : -12 sous le pont → -(PL_HALF + 9) au raccord
const plRailB = u => plRailA(u) - 3.6 * smooth01((u - 170) / 65);     // 2e voie : se détache de la première (aiguillage)
// Loin de l'axe du boulevard, sa courbe resserre le dessin en travers (k < 1 : 8 m du plan ≈ 5,5 m à l'écran). La fin de la route des rails est
// donc dessinée en vrais mètres (plPt), en passant peu à peu du dessin courbé (u ≤ 115, raccord avec le Y et le pont) aux vrais mètres (u ≥ 200,
// raccord exact avec la Route Poids Lourds, qui est en vrais mètres).
const _pw = { x: 0, z: 0 };
const plBent = (u, n) => { const [x, z] = alongRail(MAT_ZPD, u, n); toWorld(x, z, _pw); return [_pw.x, _pw.z]; };
const plMetric = u => smooth01((u - 115) / 85);
const _plK = new Map();
/** Mètres réels pour un mètre en travers du plan, à u. */
function plK(u) {
  const at = key => { if (!_plK.has(key)) { const c = plBent(key, 0), q = plBent(key, 1); _plK.set(key, Math.hypot(q[0] - c[0], q[1] - c[1]) || 1); } return _plK.get(key); };
  const k0 = Math.floor(u / 5) * 5, t = (u - k0) / 5;
  return at(k0) * (1 - t) + at(k0 + 5) * t;                 // (entre deux points tous les 5 m)
}
/** Point du monde (scène) à u, n (n en vrais mètres une fois passé u = 200). */
export function plPt(u, n) {
  const w = plMetric(u), b = plBent(u, n);
  if (w <= 0) return b;
  const c = plBent(u, 0), a = plBent(u - 0.5, 0), d = plBent(u + 0.5, 0), q = plBent(u, 1);
  let tx = d[0] - a[0], tz = d[1] - a[1]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
  let rx = -tz, rz = tx; if (rx * (q[0] - c[0]) + rz * (q[1] - c[1]) < 0) { rx = -rx; rz = -rz; }
  return [b[0] + (c[0] + rx * n - b[0]) * w, b[1] + (c[1] + rz * n - b[1]) * w];
}
/** Limite en travers, dans le plan, d'un bord dessiné à `half` (et marge de 0,45 m réels). */
const plRoadN = (u, half) => { const k = plK(u), w = plMetric(u); return half * ((1 - w) + w / k) - 0.45 / k; };
/** Sur la chaussée de la Route Poids Lourds au sol, de part et d'autre du Pont Matete (tout droit à gauche, en biais à droite). */
function onPLBand(x, z) {
  if (!HAS_MATETE) return false;
  if (x <= 6 && x > -206 && Math.abs(z - MAT_ZPL) < 4 - 0.7) return true;
  const [u, n] = plDiag(x, z);
  return u > -2 && u < 268 && n < plRoadN(u, plHalfR(u)) && n > -plRoadN(u, plHalfL(u));
}
const onPLPad = (x, z, m = 0.7) => !!MAT_PL && Math.hypot(x - MAT_PL.pad[0], z - MAT_PL.pad[1]) < MAT_PL.padR - m;
// Raccord avec la Route Poids Lourds attachée (main.js, ROAD3) : son z = 0 est à u = PL_JOIN_U sur la route des rails en biais
export const PL_JOIN_U = 245;
/** Point (x, z) de l'axe de la route des rails en biais à la distance u du milieu du Pont Matete. */
export const plDiagAt = u => [0.8 * u, MAT_ZPD - 0.6 * u];
/** u sur la route des rails en biais sous (x, z), ou -1 hors de sa chaussée. */
export function plBandU(x, z) {
  if (!HAS_MATETE) return -1;
  const [u, n] = plDiag(x, z);
  return u > -2 && u < 268 && n < plRoadN(u, plHalfR(u)) && n > -plRoadN(u, plHalfL(u)) ? u : -1;
}
const onMatPL = (x, z) => !!MAT_PL && (onPLBand(x, z) || onRibbon(MAT_PL, x, z) || pointInPoly([x, z], MAT_PL.mouth) || onPLPad(x, z));
const MAT_RAMP = HAS_MATETE ? (() => {
  const s = -1, loop = matLoopPts(s), J = bez(loop, MAT_TJ), nJ = matLoopOut(s, MAT_TJ);
  const P0 = [s * ROAD_EDGE, ZM - 34], u0 = [s * 0.77, -0.64];               // juste après le tablier du Pont Matete
  const ctrl = [P0, [P0[0] + u0[0] * 14, P0[1] + u0[1] * 14], [J[0] + nJ[0] * 24, J[1] + nJ[1] * 24], J];
  const N = 40, pts = Array.from({ length: N + 1 }, (_, i) => bez(ctrl, i / N)), arc = [0];
  for (let i = 1; i <= N; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const f = arc.map(v => v / arc[N]);
  const hAt = fr => MAT.H * (1 - Math.min(1, Math.max(0, (fr - 0.04) / 0.85)));   // en haut du remblai → au sol avant la boucle
  // Embouchure sur la boucle : des bords de la bretelle, à 11 m de l'axe de la boucle, jusqu'au bord de la boucle
  const F0 = [J[0] + nJ[0] * 11, J[1] + nJ[1] * 11], q = [nJ[1], -nJ[0]];
  const onLoop = (t, d) => { const p = bez(loop, t), n = matLoopOut(s, t); return [p[0] + n[0] * d, p[1] + n[1] * d]; };
  const corners = (dc, de, dt) => {
    let Ca = [F0[0] + q[0] * dc, F0[1] + q[1] * dc], Cb = [F0[0] - q[0] * dc, F0[1] - q[1] * dc];
    const Ea = onLoop(MAT_TJ - dt, de), Eb = onLoop(MAT_TJ + dt, de);
    if (Math.hypot(Ca[0] - Ea[0], Ca[1] - Ea[1]) > Math.hypot(Cb[0] - Ea[0], Cb[1] - Ea[1])) [Ca, Cb] = [Cb, Ca];
    return [Ca, Cb, Eb, Ea];
  };
  const mouth = corners(3.75, 3.75, MAT_TDT), [Ca, Cb, Eb, Ea] = corners(3.05, 3.05, MAT_TDT * 0.92);
  return {
    s, ctrl, pts, f, hAt, J, mouth, hw: pts.map(() => 3.75), box: bboxOf(pts, 8),
    iMouth: pts.findIndex(p => Math.hypot(p[0] - J[0], p[1] - J[1]) < 11),
    drive: [Ca, Cb, Eb, bez(loop, MAT_TJ + MAT_TDT), J, bez(loop, MAT_TJ - MAT_TDT), Ea],   // embouchure, jusqu'à l'axe de la boucle
  };
})() : null;
const onMatRamp = (x, z) => !!MAT_RAMP && (onRibbon(MAT_RAMP, x, z) || pointInPoly([x, z], MAT_RAMP.drive));
/** Hauteur de la bretelle de l'Entrée Matete sous (x, z), ou null hors de la bretelle (son embouchure sur la boucle : au sol). */
function matRampH(x, z) {
  if (!onMatRamp(x, z)) return null;
  const M = MAT_RAMP, k = ribbonSeg(M, x, z), a = M.pts[k - 1], c = M.pts[k];
  const ax = c[0] - a[0], az = c[1] - a[1], L2 = ax * ax + az * az || 1;
  const u = Math.max(0, Math.min(1, ((x - a[0]) * ax + (z - a[1]) * az) / L2));
  return M.hAt(M.f[k - 1] + (M.f[k] - M.f[k - 1]) * u);
}

/**
 * Niveau du taxi après un déplacement (x0, z0) → (x1, z1) : on monte sur le pont de la route arrière de l'Échangeur par
 * l'un de ses deux bouts au sol (jamais depuis la chaussée de gauche, qui passe dessous) et on en redescend au même endroit ;
 * on passe sous le 2e pont du Pont Matete depuis une boucle (jamais depuis le boulevard, qui passe dessus).
 */
export function nextLevel(level, x0, z0, x1, z1) {
  // (sous le 2e pont du Pont Matete ou sous le Pont Matete lui-même, par la Route Poids Lourds)
  const under = (x, z) => matBand(z) || onPLBand(x, z);
  if (HAS_MATETE && (level === 'sous' || (!level && under(x0, z0) && under(x1, z1)))) {
    if (level === 'sous') return under(x1, z1) && Math.abs(x1) < MAT_COVER ? 'sous' : null;
    if (Math.abs(x0) >= MAT_COVER && Math.abs(x1) < MAT_COVER) return 'sous';
  }
  if (!IS_TOWER || (level && level !== 'pont')) return level;
  const B = ECH_XB, X0 = realX(x0, z0), X1 = realX(x1, z1), band = z => echDz(z) < B.w / 2;
  if (level === 'pont') return band(z1) && X1 > B.xFar && X1 < B.xLand ? 'pont' : null;
  if (!band(z0) || !band(z1)) return level;
  if ((X0 >= B.xLand - 2.5 && X1 < B.xLand - 0.5) || (X0 <= B.xFar + 2.5 && X1 > B.xFar + 0.5)) return 'pont';
  return level;
}
/** Hauteur de la chaussée sous le taxi : saut-de-mouton (rampe), remblai du Pont Matete, routes du parc de l'Échangeur. */
export function surfaceH(x, z, level = null) {
  if (level === 'sous') return 0.06;                                        // sous le 2e pont du Pont Matete
  if (!level && Math.abs(x) > ROAD_EDGE - 0.5) {                            // bretelle de l'Entrée Matete vers la boucle
    const hr = matRampH(x, z);
    if (hr !== null) return hr;
  }
  let h = (level === 'up' ? flyH(z) : 0) + (Math.abs(x) <= LIFT_X + 0.5 ? roadH(z) : 0);   // (le remblai : la chaussée seule)
  if (IS_TOWER && echDz(z) < ECH_XB.w / 2 + ECH_XB.RC) {
    const X = realX(x, z), B = ECH_XB;
    if (level === 'pont') h += echBridgeH(X);
    else if (X >= B.xLand - 2.5 && X <= B.xRight && (echDz(z) < B.w / 2 + 0.5 || X > B.xRight - B.RC)) h += B.GY + 0.03;
    else if (X <= B.xFar + 2.5 && X > B.xEnd - 4 && echDz(z) < B.w / 2 + 0.5) h += 0.07;
  }
  return h;
}

/**
 * Ce que le taxi heurterait en (x, z) : null si la place est libre, sinon 'start' (avant l'aérogare), 'end' (bout de la
 * chaussée construite), 'median' (terre-plein), 'curb' (trottoir), 'rail' / 'wall' (rampe d'un saut-de-mouton).
 * level : 'up' (sur la rampe) / 'down' (voies du bas) sur un saut-de-mouton, 'pont' sur le pont de la route arrière de
 * l'Échangeur, sinon null.
 */
export function blockedAt(x, z, level = null) {
  if (inPlaza(x, z)) return null;
  if (PAIR && Math.hypot(x / PAIR.CORE, (z - PAIR.nose + 1) / 5.5) < 1) return 'curb';
  if (PAIR && z < -0.5 && PAIR.full(z)) {                 // deux chaussées : on roule dans toute leur largeur ; la pelouse a ses passages
    const ax = Math.abs(x);
    if (ax < PAIR.CORE + 0.12) return pairOpen(z) ? null : 'curb';
    if (ax <= TX_OUT) return null;
  }
  if (RINGS.length) {
    const ring = ringAt(x, z);
    if (ring) return ring === 'island' ? 'curb' : null;
  }
  if (FORKS.length) {
    const fk = forkAt(x, z);
    if (fk) return fk === 'island' ? 'curb' : null;
  }
  if (z > (START_ATTACHED ? 0.5 : 25)) return 'start';
  if (z < Z_END + 1.5 && !onPLLink(x, z)) return 'end';
  if (level === 'pont') return onEchBridge(x, z) ? null : 'rail';
  if (level === 'sous') return (matBand(z) && Math.abs(x) < MAT_UX + 3) || onPLBand(x, z) ? null : 'wall';
  const ax = Math.abs(x), s = x >= 0 ? 1 : -1;
  // En bas d'un saut-de-mouton : on passe sous le tablier (demi-tour) là où il est haut, entre les piliers ; le long des
  // rampes, murs de soutènement
  if (level === 'down' && ax < RAMP_X + 0.95) return underDeck(x, z) ? null : 'wall';
  if (ax >= TX_IN && ax <= TX_OUT) {
    if (level === 'up' && ax > RAMP_X - 0.95) return 'rail';
    return null;
  }
  if (ax < TX_IN) return (!level && (medianOpen(z) || onEchMedian(x, z))) || (level === 'up' && FLYOVERS.some(f => f.noSeparator && z < f.z0 && z > f.z1)) ? null : 'median';   // (pont sans séparateur : lignes peintes)
  if (!level && onMatRamp(x, z)) return null;          // (l'Entrée Matete quitte le haut du remblai juste après le Pont Matete)
  // (sur la rampe : garde-corps ; en bas d'un saut-de-mouton, on peut prendre une avenue ; remblai du Pont Matete)
  if (level === 'up' || (roadH(z) > 0.4 && ax < ROAD_EDGE + 3)) return level === 'up' ? 'rail' : 'curb';
  if (EXT && ((ARC_C && z < ARC_C.z0 + 26 && z > ARC_C.z1 - 26 && s < 0 && ax < ROAD_EDGE + 48)
    || (ARC_D && z < ARC_D.z0 + 28 && z > ARC_D.z1 - 28 && s < 0 && ax < ROAD_EDGE + 95))) return null;
  if (onSideAsphalt(x, z)) return null;
  // (l'auteur, 10/11 : « la seule chose qui peut bloquer les véhicules, c'est la bordure ou les caniveaux ») : là où il n'y a pas de bordure
  // (section autoroute de l'aéroport, routes à deux bandes), on peut quitter le macadam : accotement de terre jusqu'aux façades (onDirt)
  if (onDirt(x, z)) return null;
  return 'curb';
}
/** Les chaussées secondaires qui touchent la route (avenues d'entrée, rues de Limete, Masina, Échangeur, Pont Matete, stations…). */
function onSideAsphalt(x, z) {
  const ax = Math.abs(x), s = x >= 0 ? 1 : -1;
  return onSideRoad(s, ax - ROAD_EDGE, z) || onLimeteRoad(s, ax, z) || onMasinaRoad(x, z) || onMobomaRoad(x, z) || onEchFar(x, z) || onMateteLoop(x, z)
    || onMatPB(x, z) || onMatPL(x, z) || onPLR1(x, z) || onPLLink(x, z) || onSecR(x, z) || onFuelR(x, z) || onBpStub(x, z) || onSideApron(x, z);
}
/** (l'auteur, 10/11 : « les véhicules bloquent trop sur des traces, on ne peut pas quitter le macadam ou aller dans les macadams secondaires ») Près
 *  d'un endroit où l'on peut vouloir tourner : entrée d'avenue ou de station de ce côté, accotement de terre, terre-plein ouvert. L'aide qui remet le
 *  véhicule dans l'axe de la route s'y coupe (main.js). */
export function openingNear(x, z) {
  const s = x >= 0 ? 1 : -1, ax = Math.abs(x);
  if (MAT_PL && !onPLPad(x, z, 0) && ((onRibbon(MAT_PL, x, z) && x > ROAD_EDGE + 4.5) || onPLBand(x, z))) return false;
  if (ax > TX_OUT + 0.3) return true;                                    // (hors des voies : avenue, aire, terre)
  if (ax > LANE_R - LANE_W * 0.8 && (atSideRoad(s, z, 16) || onDirt(s * (ROAD_EDGE + 1), z))) return true;
  if (ax < MEDIAN + LANE_W * 1.3 && !inHighway(z) && !R.twoLane && R.separator !== false && (medianOpen(z) || inSignalCrossing(z, 8))) return true;
  return false;
}
/** Sur l'accotement de terre (hors du macadam, là où il n'y a ni bordure ni caniveau) : on y roule au pas (main.js). */
export function onDirt(x, z) {
  const ax = Math.abs(x);
  return ax > ROAD_EDGE + 0.2 && ax < FRONT - 1.5 && (R.twoLane || inHighway(z)) && !inRiver(z, 2) && !inRaised(z, 2) && !inFlyover(z, 2) && !onSideAsphalt(x, z) && !(RINGS.length && ringAt(x, z));
}
/** Direction de la route sous le taxi (cap qui la suit en s'éloignant du boulevard, ou en descendant vers -z), ou null. */
export function roadAxisAt(x, z) {
  if (inPlaza(x, z) && z < PLAZA.z) return null;         // (Place de la Gare : pas d'aide au milieu ; on se redresse en quittant la place)
  if (RINGS.length && ringAt(x, z) && Math.abs(x) > TX_OUT) return null;
  if (RINGS.some(q => q.kind === 'victoire' && Math.hypot(x - q.c[0], z - q.c[1]) < q.r + 3)) return null;   // (Victoire : on tourne librement autour de la place)      // (rond-point, hors de l'axe de l'avenue)
  const ax = Math.abs(x), s = x >= 0 ? 1 : -1;
  // Échangeur : la route arrière va en travers (sauf au-dessus de la chaussée de gauche) ; pas d'aide dans la liaison
  if (IS_TOWER && echDz(z) < ECH_XB.w / 2) {
    const X = realX(x, z);
    if ((X > ECH_XB.xIn + 1 && X <= ECH_XB.xRight + 1.2) || (X < ECH_XB.xOut - 1 && X > ECH_XB.xEnd - 4)) return Math.PI / 2;
  }
  if (IS_TOWER && ax < TX_IN && onEchMedian(x, z)) return null;
  if (matBand(z) && ax > ROAD_EDGE + 0.5 && ax < MAT_UX + 3) return Math.PI / 2;       // passage sous le 2e pont
  if (BP_STUB && Math.hypot(x - BP_STUB.b[0], z - BP_STUB.b[1]) < 18) return null;   // (la fourche du By Pass : on choisit sa branche)
  for (const Q of ax > TX_OUT + 0.3 ? [...PL_R1, ...SEC_R, ...PL_LINKS.map(l => l.Q), ...FORK_R, ...(BP_R1 ? [BP_R2, BP_R1] : [])] : []) {   // (l'entrée du By Pass avant sa sortie : venant du By Pass, l'aide suit la branche vers Masina)   // liaisons, rues de Limete, petits boulevards
    if (!onRibbon(Q, x, z)) continue;
    const k = ribbonSeg(Q, x, z), P = Q.pts;
    return Math.atan2(P[k][0] - P[k - 1][0], -(P[k][1] - P[k - 1][1]));
  }
  if (ax <= TX_OUT + 0.3) return 0;
  if (LIM && z <= Z16 + 2 && z >= Z_FORK && ax > LIM_XIN + 0.3 && ax < LIM_XOUT - 0.3) return 0;
  for (const r of SIDE_ROADS) {
    if (r.side !== s || Math.abs(z - r.z) > SIDE_L + 20 || !onSideRoad(s, ax - ROAD_EDGE, z)) continue;
    const a = r.ang * Math.PI / 180;
    return Math.atan2(s * Math.cos(a), Math.sin(a));
  }
  if (LIM) for (const r of LIM_ST) {
    if (r.side !== s || r.from !== 'road' || Math.abs(z - r.z) > 60) continue;
    if (onLimeteRoad(s, ax, z)) return Math.atan2(s * (LIM_XIN - ROAD_EDGE), -(r.z2 - r.z));
  }
  for (const M of [MAT_RAMP, MAT_PB]) {                  // Entrée Matete : bretelle vers la boucle, petit boulevard
    if (!M || !onRibbon(M, x, z)) continue;
    const k = ribbonSeg(M, x, z), P = M.pts;
    if (M.iMouth && k >= M.iMouth) return null;          // (pas d'aide dans l'embouchure sur la boucle)
    return Math.atan2(P[k][0] - P[k - 1][0], -(P[k][1] - P[k - 1][1]));
  }
  if (MAT_RAMP && pointInPoly([x, z], MAT_RAMP.drive)) return null;
  if (MAT_PL) {                                          // Route Poids Lourds (pas d'aide sur l'aire de demi-tour)
    if (onPLPad(x, z, 0)) return null;
    if (onRibbon(MAT_PL, x, z)) {
      const k = ribbonSeg(MAT_PL, x, z), P = MAT_PL.pts;
      return Math.atan2(P[k][0] - P[k - 1][0], -(P[k][1] - P[k - 1][1]));
    }
    if (onPLBand(x, z)) {
      if (x <= 4 && Math.abs(z - MAT_ZPL) < 3.3) return -Math.PI / 2;
      // (l'auteur, 08/11 : « au croisement Y le véhicule ne marche pas droit ») : la fin de la route est dessinée en vrais mètres (plPt) ;
      // l'aide suit les voies dessinées, pas la ligne du plan : n du plan = r × g(u), r constant le long de la voie
      const [u, n] = plDiag(x, z), g = v => { const w = plMetric(v); return (1 - w) + w / plK(v); };
      const slope = n / g(u) * (g(u + 2) - g(u - 2)) / 4;
      return Math.atan2(0.8 + 0.6 * slope, 0.6 - 0.8 * slope);
    }
  }
  const ms = mateteSeg(x, z);
  if (ms) return Math.atan2(ms[1][0] - ms[0][0], -(ms[1][1] - ms[0][1]));
  return masinaAxis(x, z);
}
const SEG = 192;
// De l'aéroport à Mikondo : route large « comme une autoroute » (ni bordure, ni séparateur, ni passerelle)
const HW_END = R.highwayUntil ? lmZ(R.highwayUntil) : Infinity;
export const inHighway = z => z > HW_END;
const GROUND_HALF = 260;                           // le sol plié suit la route sur ±260 m

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const chance = p => Math.random() < p;

// ---------- Textures ----------
// Images tirées des vidéos des créateurs qui ont donné leur accord (voir js/credits.js)
__mark('world.js : avant les textures de bandes');
const [ASPHALT, STRIPS, PHOTO_BOARDS, MOB_LOGO, LIM_OSM] = await Promise.all([
  __pAsphalt, __pStrips, __pPhotoBoards, __pMobLogo, __pLimOsm,
]);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  // téléphone : grandes images dessinées à la moitié de la taille (4 fois moins de mémoire), le dessin s'adapte tout seul
  const k = MOBILE && w >= 512 ? 0.5 : 1;
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const cx = c.getContext('2d');
  if (k !== 1) cx.scale(k, k);
  draw(cx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MOBILE ? 2 : 8;
  return t;
}

// (partagée entre les copies du module chargées pour les routes attachées : même image, même contexte WebGL ; chargement plus court)
const TEX_SHARED = (globalThis.TAXIKIN_TEX ??= new Map());
function roadTexture(mirror, lanes = LANES, single = !!R.pl) {
  const key = `road|${mirror}|${lanes}|${!!R.twoLane}|${!!ASPHALT}|${single}`;
  if (!TEX_SHARED.has(key)) TEX_SHARED.set(key, roadTextureDraw(mirror, lanes, single));
  return TEX_SHARED.get(key);
}
function roadTextureDraw(mirror, lanes, single) {
  // Le carreau couvre toute la chaussée d'un sens (LANES voies) sur 12 m de long.
  const t = canvasTexture(1024, 1024, (x, W, H) => {
    if (ASPHALT) {
      // goudron réel du boulevard Lumumba (vidéo de 3Exa production), répété 2 × 2 fois
      const pat = x.createPattern(ASPHALT, 'repeat');
      pat.setTransform(new DOMMatrix().scale(W / 2 / ASPHALT.width, H / 2 / ASPHALT.height));
      x.fillStyle = pat; x.fillRect(0, 0, W, H);
      // plus foncé et plus froid, comme le goudron du jeu de référence (l'auteur, 08/11) : gris sombre, un peu bleuté, bien uni
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = 'rgb(150,160,182)'; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'source-over';
    } else {
      x.fillStyle = '#4c4f58'; x.fillRect(0, 0, W, H);
    }
    x.scale(W / 256, H / 256);                       // dessin en unités 256 × 256
    const w = 256, h = 256;
    // rapiéçages et nids-de-poule
    for (let i = 0; i < 3; i++) {
      x.fillStyle = pick(['rgba(30,30,30,0.22)', 'rgba(90,90,85,0.2)']);
      x.fillRect(rand(10, 230), rand(0, 240), rand(10, 30), rand(8, 26));
    }
    x.fillStyle = 'rgba(25,25,25,0.6)';
    for (let i = 0; i < 2; i++) { x.beginPath(); x.ellipse(rand(20, 236), rand(0, h), rand(2, 5), rand(1.5, 4), 0, 0, 7); x.fill(); }
    // sable rouge poussé contre la bordure
    const sx = mirror ? 0 : w - 18;
    const g = x.createLinearGradient(sx, 0, sx + 18, 0);
    g.addColorStop(mirror ? 0 : 1, 'rgba(176,96,52,0.18)');
    g.addColorStop(mirror ? 1 : 0, 'rgba(176,96,52,0)');
    x.fillStyle = g; x.fillRect(sx, 0, 18, h);
    // lignes blanches : continues au bord, tirets de 3 m tous les 6 m entre les voies
    const inner = mirror ? w - 5 : 2, outer = mirror ? 2 : w - 5;
    x.fillStyle = 'rgba(236,236,230,0.85)';
    if (!R.twoLane) {                                // (deux bandes : seulement les tirets au milieu, dessinés à part)
      if (!single) x.fillRect(inner, 0, 3, h);       // (une seule ligne au milieu, dessinée à part)
      x.fillRect(outer, 0, 3, h);
    }
    for (let k = 1; k < lanes; k++) for (const y0 of [0, 128]) x.fillRect(k * w / lanes - 1.5, y0, 3, 64);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function groundTexture() {
  const t = canvasTexture(128, 128, (x, w, h) => {
    x.fillStyle = '#a95a30'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) {
      x.fillStyle = pick(['#9a5029', '#b8693b', '#8e4826', '#7f8a3c', '#c27a48']);
      x.fillRect(Math.random() * w, Math.random() * h, rand(1, 4), rand(1, 4));
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function signTexture(title, sub, bg, fg = '#fff', painted = false) {
  const key = `sign|${title}|${sub}|${bg}|${fg}|${painted}`;
  if (!TEX_SHARED.has(key)) TEX_SHARED.set(key, signTextureDraw(title, sub, bg, fg, painted));
  return TEX_SHARED.get(key);
}
function signTextureDraw(title, sub, bg, fg, painted) {
  return canvasTexture(512, 160, (x, w, h) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    if (painted) {
      // peinture à la main : coulures, bord irrégulier
      x.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 14; i++) x.fillRect(rand(0, w), rand(h * 0.6, h), rand(2, 5), rand(10, 40));
      x.strokeStyle = fg; x.lineWidth = 5; x.strokeRect(10 + rand(-3, 3), 10, w - 20, h - 20 + rand(-4, 4));
    } else {
      x.strokeStyle = '#fff'; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
    }
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save();
    if (painted) { x.translate(w / 2, h / 2); x.rotate(rand(-0.025, 0.025)); x.translate(-w / 2, -h / 2); }
    x.font = `bold ${painted ? 54 : 50}px ${painted ? 'Impact, "Arial Black", sans-serif' : 'sans-serif'}`;
    x.fillText(title, w / 2, sub ? 62 : h / 2, w - 40);
    if (sub) { x.font = '30px sans-serif'; x.fillText(sub, w / 2, 120, w - 40); }
    x.restore();
  });
}

/** Grandes lettres blanches à empattements sur un bandeau (enseigne d'immeuble : Cité Béthel). */
function letterTexture(text, bg, fg) {
  return canvasTexture(1024, 200, (x, w, h) => {
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 128px Georgia, "Times New Roman", serif';
    if ('letterSpacing' in x) x.letterSpacing = '12px';
    x.fillText(text, w / 2, h / 2 + 8, w - 40);
  });
}

/** Écran géant (culte retransmis) : fond clair, silhouette du prédicateur et pupitre. */
function screenTexture() {
  return canvasTexture(256, 150, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#9fd4ff'); g.addColorStop(1, '#eaf6ff');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#1b1b1b'; x.beginPath(); x.arc(118, 50, 13, 0, Math.PI * 2); x.fill(); x.fillRect(103, 64, 30, 72);
    x.fillStyle = '#2a3a4a'; x.fillRect(140, 92, 46, 58);
  });
}

const SHOP_SIGNS = [
  ['ALIMENTATION', 'Chez Maman Bijou', '#c8102e'],
  ['PHARMACIE', 'La Grâce', '#1b8a3a'],
  ['SALON DE COIFFURE', 'Bel Homme', '#1d4fa0'],
  ['QUINCAILLERIE', 'Ets Mukendi & Fils', '#e0a100', '#1a1a1a'],
  ['DÉPÔT BOISSONS', 'Bien glacé', '#0b5d8f'],
  ['MALEWA', 'Fufu · Pondu · Poisson salé', '#a0522d'],
  ["TRANSFERT D'ARGENT", 'Envoi · Retrait', '#6a1b9a'],
  ['CRÉDIT · UNITÉS', 'Toutes les cartes ici', '#d62828'],
  ['COUTURE', 'Modèles pagne', '#c2185b'],
  ['ÉGLISE DE RÉVEIL', 'Culte 7h · 10h · 16h', '#f2f0e8', '#1d4fa0'],
  ['ATELIER SOUDURE', 'Portails · Grilles', '#455a64'],
  ['BOUTIQUE', 'Tout à bas prix', '#ff8a1f', '#1a1a1a'],
  ['PHOTOCOPIE', 'Saisie · Impression', '#2e7d32'],
  ['BOULANGERIE', 'Pain chaud', '#8d6e63'],
  ['CABINE MÉDICALE', 'Soins 24h/24', '#00838f'],
  ['VIDÉOTHÈQUE', 'Match ce soir', '#283593'],
];
const BILLBOARDS = [
  ['KIN CRÉDIT', 'Recharge partout, à tout moment', '#d62828'],
  ['SAVON MAMA', 'Propre na propre !', '#1d6fd1'],
  ['GRANDE CROISADE', 'Dimanche · Stade des Martyrs', '#6a1b9a'],
  ['LOTERIE NA BISO', 'Gagne 10 000 $ ce samedi', '#e0a100', '#1a1a1a'],
  ['KIN BOPETO', 'Ville propre, ville belle', '#1b8a3a'],
  ['VACCINATION GRATUITE', 'Dans tous les centres de santé', '#00838f'],
];

// ---------- Palettes ----------
const WALLS = [0xe9dcc3, 0xd8c08f, 0xc96f4a, 0x7fb3c8, 0xe8a0a0, 0xf2f0e8, 0x9cc28a, 0xe6c35c, 0xb9a3d1, 0xd4d4cc, 0xf0e2b6];
const STRONG = [0xc8102e, 0x1d4fa0, 0xe0a100, 0x1b8a3a, 0xff8a1f, 0x6a1b9a];
const TIN = [0x8a4b2a, 0x9c5a35, 0x7d4426, 0x8c9196, 0x6f747a, 0xa86b45, 0x2f6b45, 0x3a7a52];   // rouille, galvanisé, vert
const GATES = [0x1d4fa0, 0x2f6f3e, 0x7a1f1f, 0x2a2a2a, 0x5b6b7a];
const UMBRELLAS = [0xd62828, 0x1d5fbf, 0xf5c400, 0x2a9d4b, 0xf28c28, 0xffffff];
const GOODS = [0xd62828, 0xe0a100, 0x2b8a3e, 0x7a4b2a, 0xf28c28, 0x2a2a2a, 0xe8e2d0];
const SHIRTS = [0xd9480f, 0x7b2cbf, 0x2b8a3e, 0xe0a100, 0x1d4fa0, 0xffffff, 0xc2185b, 0x00838f];
const SKIN = [0x5a3a22, 0x4a2e1a, 0x6b4428];
const CONCRETE = 0xbdb7a9;

// ---------- Outils d'assemblage ----------
/** Builders regroupés par tranches de route, pour garder le découpage (frustum culling). */
class Chunks {
  constructor(size = 320, keepUv = false) { this.size = size; this.keepUv = keepUv; this.map = new Map(); }
  at(z) {
    const k = Math.floor(z / this.size);
    if (!this.map.has(k)) this.map.set(k, new Builder(this.keepUv));
    return this.map.get(k);
  }
  build(scene, material = VC_MAT, cast = true, raw = false) {   // raw : sans écartement des chaussées (ce qui est posé sur le terre-plein)
    this.meshes = [];
    for (const [k, b] of this.map) {
      if (!b.parts.length) continue;
      const geo = b.geometry();
      if (this.scan) obstMark(geo);                       // (les obstacles du bord de la route : voir obstacleAt)
      const m = new THREE.Mesh(bendGeometry(raise(geo), raw), material);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.userData.z0 = k * this.size;
      scene.add(m);
      this.meshes.push(m);
    }
  }
  /** N'affiche que les tranches entre `back` mètres derrière et `far` mètres devant le joueur. */
  cull(z, far, back = 150) {
    for (const m of this.meshes) m.visible = m.userData.z0 + this.size > z - far && m.userData.z0 < z + back;
  }
}

// ---------- Les obstacles du bord de la route (l'auteur, 13/11 : « rien ne doit passer transparent, pour tout le monde ») ----------
// Une grille de 0,5 m sur les deux bandes au bord des chaussées (du bord de la chaussée jusqu'aux façades), remplie à partir de la géométrie du
// décor au moment de sa construction (étals, poteaux, abris, panneaux sur pied, gens figés, bancs…) : tout ce qui se dresse entre 0,35 m et 2,3 m.
// Les piétons qui marchent le long de la route la contournent ; le véhicule qui roule sur la terre s'y arrête.
const OB = { cell: 0.5, x0: 0, x1: 0, z0: 0, nx: 0, nz: 0, grid: null };
function obstInit(zTop, zBot) {
  OB.x0 = ROAD_EDGE + 0.7; OB.x1 = Math.max(FRONT + 2, ROAD_EDGE + 21);
  OB.z0 = zBot; OB.nz = Math.max(1, Math.ceil((zTop - zBot) / OB.cell)); OB.nx = Math.ceil((OB.x1 - OB.x0) / OB.cell);
  OB.grid = new Uint8Array(OB.nx * OB.nz * 2);
}
function obstMark(geo) {
  const P = geo?.attributes?.position?.array;
  if (!OB.grid || !P) return;
  const C = OB.cell, X0 = OB.x0, X1 = OB.x1, NX = OB.nx, NZ = OB.nz, G = OB.grid, Z0 = OB.z0;
  for (let i = 0; i + 8 < P.length; i += 9) {
    const y0 = Math.min(P[i + 1], P[i + 4], P[i + 7]), y1 = Math.max(P[i + 1], P[i + 4], P[i + 7]);
    if (y1 < 0.35 || y0 > 2.3) continue;                                     // (au sol, ou au-dessus des têtes)
    const xa = Math.min(P[i], P[i + 3], P[i + 6]), xb = Math.max(P[i], P[i + 3], P[i + 6]);
    if (xb < X0 && xa > -X0) continue;                                        // (sur la chaussée ou le terre-plein)
    const za = Math.min(P[i + 2], P[i + 5], P[i + 8]), zb = Math.max(P[i + 2], P[i + 5], P[i + 8]);
    if (zb - za > 40 || xb - xa > 24) continue;                               // (très grands : sols, longues façades)
    const iz0 = Math.max(0, Math.floor((za - Z0) / C)), iz1 = Math.min(NZ - 1, Math.floor((zb - Z0) / C));
    if (iz1 < iz0) continue;
    for (let s = 0; s < 2; s++) {
      const lo = s === 0 ? xa : -xb, hi = s === 0 ? xb : -xa;                // (x vu du côté droit, puis du côté gauche)
      if (hi < X0 || lo > X1) continue;
      const ix0 = Math.max(0, Math.floor((lo - X0) / C)), ix1 = Math.min(NX - 1, Math.floor((hi - X0) / C)), base = s * NX * NZ;
      for (let iz = iz0; iz <= iz1; iz++) { const row = base + iz * NX; for (let ix = ix0; ix <= ix1; ix++) G[row + ix] = 1; }
    }
  }
}
/** Un obstacle du décor au bord de la route à moins de r mètres de (x, z) ? (coordonnées de la route) */
export function obstacleAt(x, z, r = 0) {
  if (!OB.grid) return false;
  const ax = Math.abs(x), C = OB.cell;
  if (ax + r < OB.x0 || ax - r > OB.x1) return false;
  const ix0 = Math.max(0, Math.floor((ax - r - OB.x0) / C)), ix1 = Math.min(OB.nx - 1, Math.floor((ax + r - OB.x0) / C));
  const iz0 = Math.max(0, Math.floor((z - r - OB.z0) / C)), iz1 = Math.min(OB.nz - 1, Math.floor((z + r - OB.z0) / C));
  const base = (x >= 0 ? 0 : 1) * OB.nx * OB.nz;
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) if (OB.grid[base + iz * OB.nx + ix]) return true;
  return false;
}
/** La hauteur du sol pour un piéton qui traverse (l'auteur, 13/11 : « ils doivent sauter la bordure ») : la bordure du bord (23 cm), le
 *  terre-plein et ses bordures (22 à 30 cm), le bloc du séparateur béton (1,07 m) qu'il enjambe ; 0 sur la chaussée. */
export function pedHeight(x, z) {
  if (inWorks(x, z)) return 0;
  const ax = Math.abs(x), s = x >= 0 ? 1 : -1;
  const plain = R.rocade || R.twoLane || R.industrial || inCrossing(z) || inHighway(z);
  if (ax > ROAD_EDGE - 0.05 && ax < ROAD_EDGE + 0.66) return plain || inRiver(z, 1) || atSideRoad(s, z, 0.6) ? 0 : 0.23;
  if (ax >= MEDIAN + 0.05 || plain || inSignalCrossing(z, 0.5)) return 0;
  const zs = Z_START - Math.floor((Z_START - z) / BLK_LEN) * BLK_LEN, zm = zs - BLK_LEN / 2;
  const block = !(R.separator === false || inFlyover(zm, 2) || inCrossing(zm, 1) || inHighway(zm) || inEchPark(zm, BLK_LEN) || separatorGap(zs));
  if (block && ax < 0.36) return 1.1;
  if (block && ax < 0.5) return 0.5;
  return z > GREEN_TO ? 0.3 : 0.22;
}

// Grandes tours repères (SOZACOM) : construites à part, toujours affichées et sans brouillard, pour qu'on les voie de loin
// depuis le boulevard, au-dessus des autres immeubles (voir buildWorld)
let SKYLINE = null;

/** Panneaux texturés regroupés par texture (un appel de dessin par texture). */
class Signs {
  constructor() { this.groups = new Map(); }
  // zRef : panneau posé en bloc avec un objet (bendRigid) au lieu d'être plié le long de la route
  add(key, makeTexture, w, h, x, y, z, ry, basic = false, zRef = null) {
    const k = zRef === null ? key : `${key}@${zRef}`;
    if (!this.groups.has(k)) this.groups.set(k, { tex: makeTexture(), b: new Builder(true), basic, zRef });
    this.groups.get(k).b.add(new THREE.PlaneGeometry(w, h), 0xffffff, x, y, z, 0, ry, 0);
  }
  build(scene, raw = false) {   // raw : ne suit pas l'écartement des chaussées (parc de l'Échangeur)
    const out = [];
    for (const { tex, b, basic, zRef } of this.groups.values()) {
      const mat = basic ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ map: tex });
      const m = new THREE.Mesh(zRef === null ? bendGeometry(raise(b.geometry()), raw) : bendRigid(b.geometry(), zRef), mat);
      scene.add(m);
      out.push(m);
    }
    return out;                                                          // (les chantiers montrent ou cachent leurs panneaux)
  }
}

/** Objets construits en coordonnées route autour d'un zRef et posés en bloc (bendRigid) : fourche Sendwe, carrefours du
 *  prolongement (ils ne se tordent pas dans les virages). Un maillage par zRef. */
class Rigid {
  constructor() { this.map = new Map(); }
  at(zRef) {
    if (!this.map.has(zRef)) this.map.set(zRef, new Builder());
    return this.map.get(zRef);
  }
  build(scene) {
    for (const [z, b] of this.map) {
      if (!b.parts.length) continue;
      const m = new THREE.Mesh(bendRigid(b.geometry(), z), VC_MAT);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }
}

/** Plan horizontal dont les UV sont en mètres (texture répétée tous les `tile` mètres). */
function groundPlane(w, len, tileU, tileV = tileU) {
  const geo = new THREE.PlaneGeometry(w, len, 1, Math.max(1, Math.ceil(len / 6))).rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tileU, uv.getY(i) * len / tileV);
  return geo;
}

/** Découpe [from, to] (from > to) en morceaux d'au plus `max` mètres. */
function pieces(from, to, max = SEG) {
  const out = [];
  for (let z = from; z > to + 0.01; z -= max) out.push([z, Math.max(to, z - max)]);
  return out;
}

/** Comme pieces(), mais coupé aussi à la fin de la section « autoroute ». */
function spans(from, to, max = SEG) {
  const cut = HW_END < from && HW_END > to ? [[from, HW_END], [HW_END, to]] : [[from, to]];
  return cut.flatMap(([a, b]) => pieces(a, b, max));
}

/** Morceaux de [p, q] (p > q) qui ne tombent pas sur une entrée de route du côté `side`. */
function cutSide(side, p, q) {
  let out = [[p, q]];
  const cuts = [...SIDE_ROADS.filter(r => r.side === side).map(r => r.cut), ...SIDE_APRONS.filter(q => q.side === side).map(q => [q.z + q.half, q.z - q.half])];
  if (HAS_MATETE) cuts.push(MATETE_ZONE[side]);
  if (IS_TOWER && side > 0) cuts.push(ECH_ZONE);
  if (IS_TOWER && side < 0) cuts.push(...ECH_ZONES_L);
  for (const [a, c] of cuts) {
    out = out.flatMap(([x, y]) => (c >= x || a <= y) ? [[x, y]] : [...(x > a ? [[x, a]] : []), ...(c > y ? [[c, y]] : [])]);
  }
  return out.filter(([x, y]) => x - y > 0.5);
}

/** Intervalles de terre ferme (hors rivières) entre from et to. */
function solid(from, to, withCrossings = false) {
  const gaps = [...RIVERS, ...(withCrossings ? CROSSINGS : [])].sort((a, b) => b.z - a.z);
  const out = [];
  let top = from;
  for (const r of gaps) {
    // (l'auteur, 09/11 : « c'est une copie du grand boulevard ») : seulement les rivières entre from et to ; celles du prolongement
    // (Pont-Cabu…) faisaient redessiner le décor du boulevard Lumumba par-dessus le boulevard Sendwe
    if (r.z - r.w / 2 >= top) continue;
    if (r.z + r.w / 2 <= to) break;
    if (r.z + r.w / 2 < top) out.push([top, r.z + r.w / 2]);
    top = r.z - r.w / 2;
  }
  if (top > to) out.push([top, to]);
  return out;
}

function nearAny(z, list, d) { return list.some(p => Math.abs((p.z ?? p) - z) < (p.d ?? d)); }

const LIFT_X = ROAD_EDGE + 2.5;                    // la chaussée, les bordures, la berme et les panneaux de bord de route
/** Monte sur le remblai du Pont Matete les sommets situés à moins de `xMax` de l'axe (coordonnées route). */
function raise(geo, xMax = LIFT_X) {
  if (!HAS_MATETE) return geo;
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getX(i)) <= xMax) p.setY(i, p.getY(i) + roadH(p.getZ(i)));
  }
  return geo;
}

// ---------- Éléments ----------
function addPerson(b, x, z, { sitting = false, kind, ry = Math.random() * 6.28 } = {}) {
  const o = outfit(kind ?? (sitting ? 'vendor' : undefined), { basin: !sitting && chance(0.25) ? pick([0x1d6fd1, 0xd62828, 0xe8e8e8]) : null });
  if (sitting) b.box(0.4, 0.45, 0.4, 0x6b4f2a, x, 0.22, z + 0.15);   // tabouret
  bakeCharacter(b, o, sitting ? 'sit' : 'idle', x, z, ry, Math.random() * 10, true);
}

function addMango(b, x, z, s = rand(0.8, 1.3)) {
  b.cyl(0.25 * s, 0.35 * s, 3 * s, 0x5d4330, x, 1.5 * s, z)
    .ball(2.6 * s, pick([0x2c5e2a, 0x356b2f, 0x24502a]), x, 4.2 * s, z, 1.1, 0.8, 1.1);
}

function addPalm(b, x, z, s = rand(0.9, 1.25)) {
  const h = 7 * s;
  b.cyl(0.15, 0.24, h, 0x7a5a3a, x, h / 2, z, 0, 0, rand(-0.06, 0.06));
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + rand(-0.2, 0.2);
    b.box(0.5, 0.06, 3, pick([0x2f6b2f, 0x3b7d34]), x + Math.sin(a) * 1.3, h - 0.3, z + Math.cos(a) * 1.3, 0.45, a, 0);
  }
}

function addShop(b, signs, side, z, w) {
  const d = rand(6, 10), h = rand(3, 4.4);
  const x = side * (FRONT + d / 2);
  const strong = chance(0.35);
  b.box(d, h, w, strong ? pick(STRONG) : pick(WALLS), x, h / 2, z);
  b.box(d + 0.8, 0.12, w + 0.6, pick(TIN), x, h + 0.25, z, 0, 0, side * 0.12);  // tôle inclinée
  const fx = side * (FRONT - 0.03);
  // portes métalliques et ouvertures
  b.box(0.06, 2.2, Math.min(2.4, w * 0.35), pick(GATES), fx, 1.1, z - w * 0.2);
  if (w > 6) b.box(0.06, 1.2, 1.4, 0x2a2a2a, fx, 1.5, z + w * 0.25);
  // auvent en tôle devant la boutique
  if (chance(0.5)) {
    b.box(2, 0.08, w * 0.9, pick(TIN), side * (FRONT - 1), 2.7, z, 0, 0, -side * 0.15);
    for (const dz of [-w * 0.4, w * 0.4]) b.cyl(0.05, 0.05, 2.7, 0x6b5a4a, side * (FRONT - 1.9), 1.35, z + dz);
  }
  if (chance(0.8)) {
    const s = Math.floor(Math.random() * SHOP_SIGNS.length);
    const [t, sub, bg, fg] = SHOP_SIGNS[s];
    signs.add(`shop${s}`, () => signTexture(t, sub, bg, fg, true), Math.min(w * 0.9, 6), 1.15, side * (FRONT - 0.06), h - 0.75, z, -side * Math.PI / 2);
  }
}

function addParcel(b, side, z, w) {
  const color = chance(0.4) ? pick(STRONG) : pick(WALLS);
  const x = side * (FRONT + 0.15);
  const gate = Math.min(3.2, w * 0.3);
  const gz = z + rand(-w / 4, w / 4);
  // mur de clôture avec portail métallique
  const l1 = (gz - gate / 2) - (z - w / 2), l2 = (z + w / 2) - (gz + gate / 2);
  if (l1 > 0.2) b.box(0.25, 2.3, l1, color, x, 1.15, z - w / 2 + l1 / 2);
  if (l2 > 0.2) b.box(0.25, 2.3, l2, color, x, 1.15, z + w / 2 - l2 / 2);
  b.box(0.12, 2.1, gate, pick(GATES), x, 1.05, gz);
  // maison basse derrière, toit en tôle
  const d = rand(7, 11), h = rand(2.8, 3.6);
  const hx = side * (FRONT + 3 + d / 2);
  b.box(d, h, w * rand(0.6, 0.85), pick(WALLS), hx, h / 2, z);
  b.box(d + 0.8, 0.12, w * 0.9, pick(TIN), hx, h + 0.3, z, 0, 0, -side * 0.1);
  if (chance(0.15)) addMango(b, side * (FRONT + rand(18, 26)), z + rand(-w / 3, w / 3));   // rare arbre au fond de la parcelle
}

/** Toit en pavillon (quatre pans) en tuiles brun-rouge. */
function addHipRoof(b, x, h, z, d, w) {
  const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).scale(d + 0.8, rand(2, 3), w + 0.8);
  b.add(geo, pick([0x8a3b2a, 0x7a3326, 0x9c4a32, 0x6b3a2a]), x, h + 1.2, z);
}

function addSolarLight(b, side, z) {
  const x = side * (ROAD_EDGE + 2.4);
  b.cyl(0.08, 0.12, 9, 0x8e949a, x, 4.5, z)
    .box(1.6, 0.08, 0.08, 0x8e949a, x - side * 0.8, 8.6, z)
    .box(0.5, 0.15, 0.3, 0xdddddd, x - side * 1.5, 8.5, z)
    .box(1.1, 0.06, 0.7, 0x1c2d4a, x, 9.2, z, 0, 0, side * 0.5);   // panneau solaire
  lampHead(x - side * 1.5, 8.5, z);
}

// ---------- Nuit (l'auteur, 09/11 : « s'il fait nuit tu allumes les lampes de boulevard et on continue ») ----------
// Chaque lampadaire du boulevard a une ampoule (éteinte le jour, jaune la nuit) et une tache de lumière sur la chaussée :
// pas de vraies lumières (trop lourd pour le téléphone), des maillages sans éclairage regroupés par tranches.
let LAMPS = null, POOLS = null;
const LAMP_OFF = new THREE.Color(0x77787a), LAMP_ON = new THREE.Color(0xfff0b8);
const LAMP_MAT = new THREE.MeshBasicMaterial({ color: LAMP_OFF.clone() });
const POOL_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, map: canvasTexture(64, 64, (x, w, h) => {
  const gr = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#8a8a8a'); gr.addColorStop(1, '#000000');
  x.fillStyle = gr; x.fillRect(0, 0, w, h);
}), depthWrite: false, blending: THREE.AdditiveBlending,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
POOL_MAT.visible = false;
function lampHead(x, y, z) {
  if (!LAMPS) return;
  LAMPS.at(z).box(0.6, 0.07, 0.3, 0xffffff, x, y - 0.12, z);
  POOLS.at(z).add(new THREE.PlaneGeometry(16, 16), 0xffffff, x * 0.92, 0.06, z, -Math.PI / 2);
}
// (l'auteur, 10/11 : « les lumières la nuit ne sont pas suffisantes ») : nuit moins noire (ciel bleu sombre, lune), taches des lampadaires plus
// grandes et plus claires ; les phares des véhicules sont dans models.js / nuit.js
const NIGHT_BG = new THREE.Color(0x141c2e), DAY_BG = new THREE.Color(0xd5dde2), NIGHT_SKY = new THREE.Color(0x253149);
const HEMI_DAY = new THREE.Color(0xf2f4f5), HEMI_NIGHT = new THREE.Color(0x8d9cc4), GROUND_DAY = new THREE.Color(0x8a6a4a), GROUND_NIGHT = new THREE.Color(0x4a4a55);
const SUN_DAY = new THREE.Color(0xfffaf0), MOON = new THREE.Color(0xb9c6e6);
const RAIN_BG = new THREE.Color(0x7f8a94), RAIN_SKY = new THREE.Color(0x6e7a86);   // (ciel de pluie)
/** k : 0 le jour, 1 la nuit noire. */
function setLamps(k) {
  LAMP_MAT.color.copy(LAMP_OFF).lerp(LAMP_ON, Math.min(1, k * 1.6));
  POOL_MAT.visible = k > 0.03;
  POOL_MAT.color.setRGB(0.95 * k, 0.78 * k, 0.5 * k);
}

function addMast(b, x, z) {
  const H = 34, grey = chance(0.5);
  for (let i = 0; i < 6; i++) b.box(1.1 - i * 0.1, H / 6, 1.1 - i * 0.1, grey ? (i % 2 ? 0x8e949a : 0x7a8086) : (i % 2 ? 0xffffff : 0xd62828), x, H / 12 + i * H / 6, z);
  b.box(2.2, 0.2, 0.2, 0x9aa0a6, x, H - 2, z).box(0.2, 1.2, 0.6, 0xe8e8e8, x + 1, H - 2.5, z);
}

function addTall(b, signs, side, z, w, floors = 2 + Math.floor(Math.random() * 2)) {
  const d = rand(10, 14), h = floors * 3.2;
  const x = side * (FRONT + d / 2);
  b.box(d, h, w, pick(WALLS), x, h / 2, z);
  if (chance(0.6)) addHipRoof(b, x, h, z, d, w);
  else b.box(d + 0.3, 0.3, w + 0.3, 0x9a958a, x, h + 0.15, z);
  const fx = side * (FRONT - 0.03);
  for (let f = 1; f < floors; f++) {
    b.box(1.2, 0.15, w * 0.9, 0x9a958a, side * (FRONT - 0.6), f * 3.2, z);       // balcon
    for (let k = -1; k <= 1; k++) b.box(0.06, 1.2, 1.4, 0x2a3540, fx, f * 3.2 + 1.5, z + k * w * 0.3);
  }
  b.box(0.06, 2.2, w * 0.5, pick(GATES), fx, 1.1, z);
  const s = Math.floor(Math.random() * SHOP_SIGNS.length);
  const [t, sub, bg, fg] = SHOP_SIGNS[s];
  signs.add(`shop${s}`, () => signTexture(t, sub, bg, fg, true), Math.min(w * 0.85, 7), 1.3, side * (FRONT - 0.06), 2.9, z, -side * Math.PI / 2);
}

function addVendors(b, side, z, dense) {
  // ligablo (kiosque en bois), parasols, bâches avec marchandises, vendeuses assises
  const x0 = side * (ROAD_EDGE + 3.6);
  const n = dense ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const x = x0 + side * (i * 2.2 + rand(0, 0.6));
    const zz = z + rand(-2, 2);
    const kind = Math.random();
    if (kind < 0.3) {
      const c = pick([0x1d4fa0, 0xf5c400, 0x2b8a3e, 0xd62828, 0xe8e2d0]);
      b.box(1.4, 2.0, 1.6, c, x, 1.0, zz).box(1.7, 0.1, 1.9, pick(TIN), x, 2.05, zz);
    } else if (kind < 0.7) {
      b.cyl(0.04, 0.04, 2.1, 0x666666, x, 1.05, zz)
        .add(new THREE.ConeGeometry(1.5, 0.6, 8), pick(UMBRELLAS), x, 2.25, zz)
        .box(1.2, 0.7, 0.9, 0x8b6b45, x, 0.35, zz);
      for (let k = 0; k < 4; k++) b.ball(0.13, pick(GOODS), x + rand(-0.4, 0.4), 0.8, zz + rand(-0.3, 0.3));
      addPerson(b, x + side * 0.8, zz + 0.5, { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    } else {
      b.box(1.8, 0.03, 1.4, pick([0x1d4fa0, 0x2b8a3e, 0xd62828, 0x6a1b9a]), x, 0.02, zz);
      for (let k = 0; k < 6; k++) b.ball(0.15, pick(GOODS), x + rand(-0.7, 0.7), 0.12, zz + rand(-0.5, 0.5), 1, 0.7, 1);
      addPerson(b, x + side * 1.1, zz, { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
}

function addCrane(b, x, z) {
  const y = 38, c = 0xe0a100;
  b.box(1.6, y, 1.6, c, x, y / 2, z)
    .box(1.2, 1.2, 46, c, x, y + 0.6, z - 12)        // flèche
    .box(1.0, 1.0, 12, c, x, y + 0.5, z + 14)        // contre-flèche
    .box(2.4, 2, 3, 0x6c7680, x, y - 1, z + 17)       // contrepoids
    .box(2.2, 2.2, 2.2, 0x444a50, x, y + 2, z)        // cabine
    .box(0.06, 18, 0.06, 0x222222, x, y - 9, z - 28); // câble
}

function addPowerPoles(chunks, details) {
  for (const s of [-1, 1]) {
    if (R.industrial && s < 0) continue;              // (Route Poids Lourds : à gauche, le chemin de fer)
    const x = s * (FRONT - 1.2);
    let prev = null;
    for (let z = Z_START - 5; z > Z_GEN; z -= 32) {
      if (inRiver(z, 3) || inCrossing(z, 2) || inMateteZone(s, z, 3) || nearRing(z, 6) || (R.campus && z < CAMPUS_Z) || onSideAsphalt(x, z)) { prev = null; continue; }
      const b = chunks.at(z);
      b.cyl(0.11, 0.15, 9, chance(0.5) ? 0x5d4a38 : 0x9a958a, x, 4.5, z)
        .box(1.4, 0.1, 0.1, 0x4a3a2a, x, 8.4, z);
      if (prev !== null) {
        // trois fils tendus entre les poteaux (légèrement en dessous des isolateurs)
        for (const dx of [-0.6, 0, 0.6]) details.at(z).box(0.03, 0.03, prev - z, 0x1a1a1a, x + dx, 8.15, (prev + z) / 2);
      }
      prev = z;
    }
  }
}

function addStreetlight(b, z) {
  b.cyl(0.1, 0.16, 10, 0x8e949a, 0, 5, z);
  for (const s of [-1, 1]) {
    b.box(3.4, 0.12, 0.12, 0x8e949a, s * 1.7, 9.9, z)
      .box(0.7, 0.18, 0.35, 0xdddddd, s * 3.4, 9.8, z);
    lampHead(s * 3.4, 9.8, z);
  }
  // Ornements lumineux géométriques blancs à mi-hauteur du mât (vus sur les vidéos de Limete et de l'aéroport)
  b.box(1.5, 0.07, 0.07, 0xf6f8fa, 0, 6.2, z, 0, 0, Math.PI / 4)
    .box(1.5, 0.07, 0.07, 0xf6f8fa, 0, 6.2, z, 0, 0, -Math.PI / 4)
    .box(1.1, 1.1, 0.06, 0xe8f2ff, 0, 6.2, z);
}

function addFootbridge(b, z) {
  // Passerelle piétonne du boulevard Lumumba (d'après les photos : grand arc métallique gris-bleu,
  // toile blanche tendue ondulée en pointes au-dessus de l'arc, tablier rouge-brun, garde-corps ajourés,
  // doubles volées d'escaliers métalliques sur chaque rive).
  const L = 2 * ROAD_EDGE + 10, y = 6.2;
  const steel = 0x3b4654, rail = 0x9eb1c4, canopy = 0xf5f7fa, deck = 0x8a382d;
  b.box(L, 0.36, 3.2, 0x8e959e, 0, y, z)                                                // structure du tablier
    .box(L - 0.2, 0.06, 2.8, deck, 0, y + 0.19, z);                                     // revêtement rouge-brun
  for (const dz of [-1.5, 1.5]) {
    b.box(L, 0.09, 0.09, steel, 0, y + 1.25, z + dz)                                    // main courante supérieure
      .box(L, 0.06, 0.06, rail, 0, y + 0.65, z + dz);                                   // lisse intermédiaire
    for (let x = -L / 2; x <= L / 2; x += 0.9) b.box(0.04, 1.22, 0.04, rail, x, y + 0.62, z + dz);
  }
  // Grand arc tubulaire acier + suspentes verticales + toile blanche ondulée (chapiteau tendu)
  const N = 24, span = L * 0.92, rise = 9.4;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N, tm = (t0 + t1) / 2;
    const x0 = -span / 2 + span * t0, x1 = -span / 2 + span * t1, xm = (x0 + x1) / 2;
    const y0 = y + rise * 4 * t0 * (1 - t0), y1 = y + rise * 4 * t1 * (1 - t1), ym = (y0 + y1) / 2;
    const segLen = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
    // Arc principal
    b.add(new THREE.CylinderGeometry(0.32, 0.32, segLen + 0.05, 8).rotateZ(ang - Math.PI / 2), steel, xm, ym, z);
    // Suspentes verticales
    if (i % 2 === 0 && i > 0) {
      for (const dz of [-1.4, 1.4]) b.box(0.05, y0 - y, 0.05, steel, x0, y + (y0 - y) / 2, z + dz);
      b.box(0.10, 0.10, 3.2, steel, x0, y0, z);
    }
    // Toile blanche tendue à festons (ondulations caractéristiques sur l'arc)
    if (i >= 2 && i <= N - 3) {
      const wave = (i % 2 === 0 ? 0.55 : -0.15);
      b.box(segLen + 0.15, 0.07, 3.8, canopy, xm, ym + 0.35 + wave * 0.5, z, 0, 0, ang);
      if (i % 2 === 0) {
        b.add(new THREE.ConeGeometry(1.9, 1.1, 4).rotateY(Math.PI / 4), canopy, xm, ym + 0.85, z);
      }
    }
  }
  // Piliers de rive en V et escaliers à double volée avec palier et toit
  for (const s of [-1, 1]) {
    const px = s * (ROAD_EDGE + 1.8);
    b.box(0.65, y, 0.65, steel, px, y / 2, z - 1.1)
      .box(0.65, y, 0.65, steel, px, y / 2, z + 1.1)
      .box(0.75, 0.5, 3.2, 0xc9c3b5, px, 0.25, z);
    const sx = s * (ROAD_EDGE + 4.4);
    // Palier intermédiaire + deux volées d'escaliers + toiture rouge-brun
    b.box(2.6, 0.28, 3.4, 0x8e959e, sx, y * 0.52, z + 5.8)
      .box(0.25, y * 0.52, 0.25, steel, sx - 1.1, y * 0.26, z + 7.2)
      .box(0.25, y * 0.52, 0.25, steel, sx + 1.1, y * 0.26, z + 7.2)
      .box(2.0, 0.24, 6.2, deck, sx, y * 0.76, z + 2.8, Math.atan2(y * 0.48, 5.2), 0, 0)
      .box(2.0, 0.24, 6.2, deck, sx, y * 0.26, z + 8.8, Math.atan2(y * 0.52, 5.2), 0, 0)
      .box(0.06, 1.05, 11.8, rail, sx + 0.95, y / 2 + 0.75, z + 5.6, Math.atan2(y, 10.4), 0, 0)
      .box(0.06, 1.05, 11.8, rail, sx - 0.95, y / 2 + 0.75, z + 5.6, Math.atan2(y, 10.4), 0, 0)
      .box(2.4, 0.12, 12.2, deck, sx, y / 2 + 2.55, z + 5.6, Math.atan2(y, 10.4), 0, 0);
  }
  b.box(0.65, y, 0.65, steel, 0, y / 2, z);                                             // pile centrale sur le terre-plein
}

/** Déforme une géométrie selon la rampe : 'lift' monte les sommets de flyH(z), 'scale' étire y de 0..1 à 0..flyH(z). */
function rampify(geo, mode) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const h = flyH(p.getZ(i));
    p.setY(i, mode === 'lift' ? p.getY(i) + h : p.getY(i) * h);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Saut-de-mouton (d'après les photos de Pascal, Bitabe et Debonhomme) :
 * les deux voies de gauche de chaque sens montent sur la rampe avec flèches directionnelles blanches
 * peintes au sol, séparateur central béton rouge et blanc (DBA), glissières métalliques + garde-corps
 * blancs ajourés au sommet, gros piliers évasés en T sous le tablier, câbles électriques aériens
 * et kiosque conteneur bleu au pied de la rampe.
 */
function addFlyover(scene, signs, f, roadMats) {
  // look 'asanef' (avenue de la Libération, vidéos « Saute de mouton 24 Novembre… » et « GOMBE/LINGWALA… » 2:12–2:30) :
  // séparateur béton gris, glissières métalliques, lampadaires solaires sur les bords, bandeaux verts « Bavaria smalt · SO
  // GOOD » sur le tablier au-dessus du carrefour et grandes affiches jaunes et vertes sur les murs des rampes
  const ASANEF = f.look === 'asanef';
  const lift = new Builder(), walls = new Builder();
  const len = f.z0 - f.z1, zc = (f.z0 + f.z1) / 2;
  const fine = (w, h, d) => new THREE.BoxGeometry(w, h, d, 1, 1, Math.max(1, Math.ceil(d / 2)));
  lift.add(fine(2 * RAMP_X + 0.4, 1.15, len), CONCRETE, 0, -0.54, zc);                  // tablier béton
  if (f.noSeparator) {                                  // sans séparateur : le goudron continue, deux lignes blanches au milieu
    lift.add(fine(2 * MEDIAN + 0.1, 0.02, len), 0x4a4c53, 0, 0.03, zc);
    for (const sx of [-0.2, 0.2]) lift.add(fine(0.14, 0.02, len - 1), 0xf2f2ec, sx, 0.045, zc);
  } else lift.add(fine(2 * MEDIAN, 0.22, len), 0xa9a49a, 0, 0.11, zc);                  // embase terre-plein

  // Séparateur central DBA rouge vif et blanc (comme sur SDM Pascal.png)
  let k = 0;
  for (let z = f.z0; !f.noSeparator && z > f.z1 + 2.5; z -= 2.8) {
    const col = ASANEF ? (k++ % 2 ? 0xc9c3b6 : 0xbdb7aa) : k++ % 2 ? 0xf6f5f0 : 0xd62828;
    lift.add(fine(0.46, 0.88, 2.75), col, 0, 0.65, z - 1.4)
      .add(fine(0.68, 0.26, 2.75), col, 0, 0.32, z - 1.4);
  }

  // Flèches directionnelles blanches peintes sur les 2 voies de chaque sens de la rampe
  for (let z = f.z0 - 10; z > f.z1 + 12; z -= 34) {
    for (const s of [1, -1]) {
      for (const lane of [0, 1]) {
        const lx = s * (MEDIAN + LANE_W * (lane + 0.5));
        const dir = s > 0 ? -1 : 1; // s=1 roule vers -Z, s=-1 roule vers +Z
        lift.add(new THREE.BoxGeometry(0.22, 0.02, 3.4), 0xf4f4f0, lx, 0.08, z)
          .add(new THREE.ConeGeometry(0.55, 1.3, 3).rotateX(dir < 0 ? -Math.PI / 2 : Math.PI / 2), 0xf4f4f0, lx, 0.08, z + dir * 2.1);
      }
    }
  }

  for (const s of [-1, 1]) {
    if (ASANEF) {                                         // muret bas et glissière métallique (double onde) sur poteaux
      lift.add(fine(0.16, 0.02, len), 0xf4f4f0, s * (RAMP_X - 0.55), 0.075, zc)
        .add(fine(0.42, 0.92, len), 0xc9c3b6, s * (RAMP_X - 0.18), 0.46, zc)           // (l'auteur, 26/11 : « c'est une bordure, pas un truc transparent ») : muret plein, sans jour
        .add(fine(0.1, 0.34, len), 0xb8bec4, s * (RAMP_X - 0.3), 1.1, zc);
      for (let z = f.z0; z > f.z1; z -= 2) lift.add(new THREE.BoxGeometry(0.1, 0.5, 0.1), 0x8e949a, s * (RAMP_X - 0.2), 1.0, z);
    } else {
    lift.add(fine(0.16, 0.02, len), 0xf4f4f0, s * (RAMP_X - 0.55), 0.075, zc)           // ligne blanche de rive
      .add(fine(0.42, 0.92, len), 0xe2ded4, s * (RAMP_X - 0.18), 0.46, zc)              // muret garde-corps béton
      .add(fine(0.10, 0.24, len), 0xcfd5dc, s * (RAMP_X - 0.18), 1.18, zc)              // glissière / lisse haute blanche
      .add(fine(0.08, 0.10, len), 0xf4f4f0, s * (RAMP_X - 0.18), 1.48, zc);             // main courante supérieure blanche
    for (let z = f.z0; z > f.z1; z -= 2.2) {
      lift.add(new THREE.BoxGeometry(0.08, 0.62, 0.08), 0xdedad0, s * (RAMP_X - 0.18), 1.18, z);
    }
    }
    // Murs de soutènement sur les rampes d'accès (avec bande de couronnement et damier rouge/blanc en tête)
    for (const [a, b] of [[f.z0, f.z0 - f.ramp], [f.z1 + f.ramp, f.z1]]) {
      walls.add(fine(0.55, 1, a - b), 0xcbc5b7, s * (RAMP_X - 0.22), 0.5, (a + b) / 2)
        .add(fine(0.60, 0.14, a - b), 0x9c9689, s * (RAMP_X - 0.22), 0.94, (a + b) / 2);
    }
    // Musoir d'entrée de rampe peint rouge et blanc
    for (const zEnd of [f.z0 + 0.6, f.z1 - 0.6]) {
      lift.add(new THREE.BoxGeometry(0.6, 0.9, 1.2), 0xd62828, s * (RAMP_X - 0.22), 0.45, zEnd);
    }
  }

  // Grands piliers centraux et latéraux évasés en T sous le tablier haut (comme sur images (3).jfif et (5).jfif)
  for (let z = f.z0 - f.ramp - 5; z > f.z1 + f.ramp + 5; z -= 14) {
    const ph = FLY_H - 1.1;
    // Piliers en T avec chevêtre évasé
    for (const px of [-RAMP_X + 2.2, 0, RAMP_X - 2.2]) {
      lift.add(new THREE.BoxGeometry(1.3, ph, 1.8), 0xc4beb0, px, -1.05 - ph / 2, z)
        .add(new THREE.BoxGeometry(3.8, 1.1, 2.0), 0xd0cabd, px, -1.55, z);
    }
  }

  if (ASANEF) {
    // lampadaires solaires sur les bords du tablier, en quinconce
    let n = 0;
    for (let z = f.z0 - 10; z > f.z1 + 8; z -= 18) {
      const s = n++ % 2 ? -1 : 1, x = s * (RAMP_X - 0.1);
      lift.add(new THREE.CylinderGeometry(0.07, 0.11, 8, 6), 0x8e949a, x, 4.5, z)
        .add(new THREE.BoxGeometry(1.8, 0.08, 0.08), 0x8e949a, x - s * 0.9, 8.4, z)
        .add(new THREE.BoxGeometry(0.6, 0.14, 0.3), 0xf2f0e0, x - s * 1.7, 8.3, z)
        .add(new THREE.BoxGeometry(1.1, 0.06, 0.75), 0x1c2d4a, x, 8.9, z, 0, 0, s * 0.45);
    }
    // bandeaux verts sur les deux faces du tablier, au-dessus des avenues (partie haute)
    for (let z = f.z0 - f.ramp - 0.5; z - 9.8 >= f.z1 + f.ramp - 0.5; z -= 10) {
      for (const s of [-1, 1]) signs.add('xbavaria', bavariaTexture, 9.8, 1.1, s * (RAMP_X + 0.24), FLY_H - 0.55, z - 4.9, s > 0 ? Math.PI / 2 : -Math.PI / 2, true);
    }
    // affiches jaunes et vertes sur les murs des rampes (là où ils sont assez hauts), côté voies du bas
    for (const [a, c] of [[f.z0 - f.ramp * 0.45, f.z0 - f.ramp], [f.z1 + f.ramp, f.z1 + f.ramp * 0.45]]) {
      for (let z = a - 0.5; z - 8 > c; z -= 8.6) {
        for (const s of [-1, 1]) signs.add('xbavaria_mur', bavariaWallTexture, 8, Math.min(3, flyH(z - 4) - 0.6), s * (RAMP_X + 0.1), Math.min(3, flyH(z - 4) - 0.6) / 2 + 0.3, z - 4, s > 0 ? Math.PI / 2 : -Math.PI / 2, true);
      }
    }
  }
  // Lampadaires solaires doubles sur le séparateur central
  for (let z = f.z0 - 14; z > f.z1 + 10 && !ASANEF; z -= 30) {
    lift.add(new THREE.CylinderGeometry(0.09, 0.13, 8.8, 6), 0x8e949a, 0, 4.9, z)
      .add(new THREE.BoxGeometry(3.8, 0.1, 0.12), 0x8e949a, 0, 9.2, z)
      .add(new THREE.BoxGeometry(0.75, 0.14, 0.34), 0xf2f0e0, -1.85, 9.15, z)
      .add(new THREE.BoxGeometry(0.75, 0.14, 0.34), 0xf2f0e0, 1.85, 9.15, z)
      .add(new THREE.BoxGeometry(1.1, 0.06, 0.75), 0x1c2d4a, 0, 9.65, z, 0.35, 0, 0);
  }

  for (const [b, mode] of [[lift, 'lift'], [walls, 'scale']]) {
    const m = new THREE.Mesh(bendGeometry(rampify(b.geometry(), mode)), VC_MAT);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // Chaussée bitumée de la rampe
  for (const s of [1, -1]) {
    const geo = groundPlane(2 * LANE_W, len, LANE_W * LANES, 12).translate(s * (MEDIAN + LANE_W), 0.06, zc);
    if (s < 0) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + 1 - 2 * LANE_W / (LANE_W * LANES)); }
    const m = new THREE.Mesh(bendGeometry(rampify(geo, 'lift')), roadMats[s > 0 ? 0 : 1]);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Kiosque conteneur bleu et faisceau de câbles électriques aériens à l'entrée du saut-de-mouton (photos SDM Pascal)
  const entry = new Builder();
  const kx = ROAD_EDGE + 3.2, kz = f.z0 + 10;
  entry.box(2.8, 2.5, 3.2, 0x1668b8, kx, 1.25, kz)
    .box(0.8, 2.1, 0.06, 0xf2c200, kx - 0.8, 1.15, kz + 1.62)
    .box(1.5, 1.6, 0.08, 0x1e2630, kx + 0.4, 1.25, kz + 1.62);
  // Poteau béton + faisceau de câbles noirs traversant au-dessus de l'entrée de la rampe
  for (const s of [-1, 1]) entry.cyl(0.16, 0.22, 12, 0x7c7870, s * (ROAD_EDGE + 2.8), 6, f.z0 + 6);
  for (let c = 0; c < 5; c++) {
    entry.box(2 * (ROAD_EDGE + 2.8), 0.035, 0.035, 0x181818, 0, 10.6 + c * 0.22, f.z0 + 6 + (c - 2) * 0.4);
  }
  scene.add(new THREE.Mesh(bendGeometry(entry.geometry()), VC_MAT));

  signs.add(`fly${f.z0}`, () => signTexture(f.title, f.sub, '#1d6b3a'), 7.8, 2.1, ROAD_EDGE - 0.6, 5.2, f.z0 + 140.15, 0, true);
}

/** Rivière et pont du boulevard. clearX : bandes |x| = [a, c] sans végétation (ponts des petits boulevards de Limete). */
function addRiver(b, signs, r, clearX = [], rightEnd = GROUND_HALF) {
  const half = r.w / 2;
  const isNdjili = r.w >= 40;
  const isExt = EXT && r.z < Z_FORK;
  const leftEnd = isExt ? 72 : GROUND_HALF;
  if (isExt) rightEnd = 72;
  const clear = x => clearX.some(([a, c]) => Math.abs(x) > a && Math.abs(x) < c) || x > rightEnd - 3 || x < -leftEnd + 3;
  // rightEnd : la rivière s'arrête là à droite (Masina : le sol reprend au-delà, buildWorld), touffes de roseaux au bout
  const W = leftEnd + rightEnd, cx = (rightEnd - leftEnd) / 2;

  // Lit de la rivière : eau boueuse ocre-brun + reflets + bancs de sable et berges érodées. L'eau est juste au-dessus du
  // grand plan du lointain (y = -1,6), sinon il la cache
  b.box(W, 0.22, r.w + 4, 0x6e5b3b, cx, -1.52, r.z);
  for (let i = 0; i < 24; i++) {
    b.box(rand(5, 18), 0.025, rand(0.4, 1.1), 0x8f7d58, rand(-leftEnd + 12, Math.min(160, rightEnd - 12)), -1.4, r.z + rand(-half + 2, half - 2));
  }
  // Berges en pente (hautes au bord, basses vers l'eau), bancs de sable / érosions typiques des rivières N'djili et Tshangu
  for (const s of [-1, 1]) {
    b.box(W, 0.28, 9, 0x9c5a2e, cx, -1.25, r.z + s * (half - 2.6), -Math.atan2(2.3, 8) * s, 0, 0)
      .box(W, 0.12, 4.5, 0xc28b52, cx, -2.15, r.z + s * (half - 5.2));
  }
  if (rightEnd < GROUND_HALF) for (let k = 0; k < 14; k++) {
    b.ball(rand(1, 2.2), pick([0x3f7a34, 0x56893a, 0x2f6b2f]), rightEnd - rand(0, 3), -0.6, r.z + rand(-half, half), 1, 0.8, 1);
  }

  // Culées en béton armé et tablier du pont avec trottoirs piétons surélevés
  b.box(2 * ROAD_EDGE + 3.2, 1.15, r.w + 3.6, CONCRETE, 0, -0.52, r.z);
  for (const s of [-1, 1]) {
    const swX = s * (ROAD_EDGE + 0.85);
    b.box(1.5, 0.28, r.w + 3.6, 0xc9c3b6, swX, 0.14, r.z)                              // trottoir piéton du pont
      .box(0.32, 0.72, r.w + 3.6, 0xd8d3c6, s * (ROAD_EDGE + 0.15), 0.36, r.z);         // muret chasse-roue interne
  }

  // Piles massives en béton dans le lit de la rivière
  const pierZ = isNdjili ? [r.z - half * 0.55, r.z, r.z + half * 0.55] : [r.z - half * 0.45, r.z + half * 0.45];
  for (const zz of pierZ) {
    for (const x of [-ROAD_EDGE + 2.5, -5, 5, ROAD_EDGE - 2.5]) {
      b.cyl(0.85, 1.05, 2.8, 0xa8a295, x, -2.0, zz, 0, 0, 0, 12);
    }
  }

  // Garde-corps peints en rouge et blanc + treillis métallique propre au Pont N'djili
  for (const s of [-1, 1]) {
    const x = s * (ROAD_EDGE + 1.48);
    b.box(0.32, 0.18, r.w + 4, 0xf2efe8, x, 1.15, r.z)
      .box(0.14, 0.10, r.w + 4, 0x3b4654, x, 1.42, r.z);
    for (let zz = r.z - half - 1.5; zz <= r.z + half + 1.5; zz += 1.2) {
      const isRed = Math.abs(Math.round(zz)) % 4 < 2;
      b.box(0.22, 1.05, 0.24, isRed ? 0xd62828 : 0xf4f4f0, x, 0.55, zz);
    }
    // Blocs béton d'approche (DBA rouge/blanc) aux 4 coins du pont, sauf devant l'entrée d'une rue (Limete, Sendwe, 24 Nov.)
    const open = zz => LIM_EDGE_GAPS.some(q => q.side === s && Math.abs(q.z - zz) < q.half + 1.6) || atSideRoad(s, zz, 1.6);
    for (const endZ of [r.z + half + 3.2, r.z - half - 3.2]) {
      const z2 = endZ + (endZ > r.z ? 3.2 : -3.2);
      if (!open(endZ)) b.box(0.55, 0.9, 3.2, 0xd62828, s * (ROAD_EDGE + 0.4), 0.45, endZ);
      if (!open(z2)) b.box(0.55, 0.9, 3.2, 0xf4f4f0, s * (ROAD_EDGE + 0.4), 0.45, z2);
    }

    if (isNdjili) {
      // Poutres latérales en treillis métallique (Pont Mayi ya N'djili)
      const tx = s * (ROAD_EDGE + 1.65), th = 3.8;
      b.box(0.28, 0.30, r.w + 2, 0x4a5562, tx, th, r.z)
        .box(0.28, 0.30, r.w + 2, 0x4a5562, tx, 1.2, r.z);
      for (let zz = r.z - half; zz <= r.z + half; zz += 3.8) {
        b.box(0.24, th - 1.0, 0.24, 0x566372, tx, 1.2 + (th - 1.2) / 2, zz);
        if (zz + 3.8 <= r.z + half + 0.5) {
          b.box(0.20, 0.20, 4.6, 0x566372, tx, 1.2 + (th - 1.2) / 2, zz + 1.9, 0.62, 0, 0);
        }
      }
    }
  }

  // Pirogue de pêcheurs / dragueurs de sable sur la rivière N'djili
  if (isNdjili) {
    b.box(1.1, 0.35, 6.5, 0x5a3d24, ROAD_EDGE + 22, -1.28, r.z - 4, 0, 0.3, 0)
      .box(0.9, 0.25, 5.8, 0x4e341e, -ROAD_EDGE - 28, -1.3, r.z + 6, 0, -0.4, 0);
  }

  // Roseaux, bananiers, palmiers et végétation dense des berges
  for (let i = 0; i < 80; i++) {
    const side = chance(0.5) ? 1 : -1;
    const x = side * rand(ROAD_EDGE + 4, isExt ? 68 : 165);
    const zz = r.z + (chance(0.5) ? 1 : -1) * (half - rand(0.4, 3.5));
    if (!clear(x)) b.ball(rand(0.9, 2.2), pick([0x3f7a34, 0x56893a, 0x2f6b2f]), x, -1.05, zz, 1, 0.75, 1);
    const xp = side * rand(ROAD_EDGE + 8, isExt ? 58 : 65);
    if (i < 12 && !clear(xp)) addPalm(b, xp, zz + rand(-5, 5), rand(0.8, 1.15));
  }

  const name = r.bridge ?? (r.name.startsWith('Rivière ') ? 'PONT ' + r.name.slice(8).toUpperCase() : r.name.toUpperCase());
  for (const s of [1, -1]) {
    const sx = s * (ROAD_EDGE + 1.8), sz = r.z + (s > 0 ? half + 3.2 : -half - 3.2);
    signs.add(`river${r.z}_${s}`, () => signTexture(name, r.name, '#1d4fa0'), 4.8, 1.3, sx, 2.3, sz, s > 0 ? 0 : Math.PI, true);
    b.box(0.14, 2.8, 0.14, 0x8e949a, sx - 1.4, 1.4, sz - 0.08).box(0.14, 2.8, 0.14, 0x8e949a, sx + 1.4, 1.4, sz - 0.08);
  }
}

/** Pont d'un petit boulevard de Limete (axe |x| = px) au-dessus d'une rivière : tablier en béton sous le goudron,
 *  garde-corps rouge et blanc des deux côtés, piles dans le lit. */
function addPbBridge(b, side, px, r, W = PB_W) {
  const L = r.w + 3.2, half = W / 2;
  b.box(W + 1.4, 1.0, L, CONCRETE, side * px, -0.46, r.z);
  for (const e of [-1, 1]) {
    const x = side * px + e * (half + 0.45);
    b.box(0.3, 0.16, L, 0xf2efe8, x, 1.0, r.z);
    for (let zz = r.z - L / 2 + 0.3; zz <= r.z + L / 2 - 0.3; zz += 1.2) b.box(0.2, 0.95, 0.22, Math.abs(Math.round(zz)) % 4 < 2 ? 0xd62828 : 0xf4f4f0, x, 0.5, zz);
  }
  for (const zz of [r.z - r.w * 0.25, r.z + r.w * 0.25]) for (const e of [-1, 1]) b.cyl(0.6, 0.75, 2.6, 0xa8a295, side * px + e * (half - 1), -1.9, zz, 0, 0, 0, 10);
}

function addStation(b, signs, st) {
  const x = ROAD_EDGE + 12;
  const upper = st.name.toUpperCase();
  const isML = upper.includes('ML');
  const isEngen = upper.includes('ENGEN');
  const isCobil = upper.includes('COBIL');
  // Cobil (vidéo Kulumba 43:52 à Siforco) : boutique bleue à bandeau blanc/rouge, cage à gaz rouge, auvent blanc sur piliers
  // rouges et grand totem bleu « COBIL · ESSENCE 2990 · GASOIL 2980 »
  if (isCobil) {
    const BLUE = 0x1668b8, RED = 0xc8102e, WHITE = 0xf4f4f0;
    b.box(14, 0.55, 20, WHITE, x, 5.25, st.z).box(14.2, 0.16, 20.2, 0x3b424c, x, 4.92, st.z)
      .box(16, 0.05, 30, 0x5c5e63, x + 1, 0.03, st.z);
    for (const sx of [-4.2, 4.2]) for (const sz of [-7, 7]) b.box(0.36, 4.9, 0.36, RED, x + sx, 2.45, st.z + sz);
    for (const sz of [-3.8, 3.8]) b.box(0.85, 1.65, 0.65, WHITE, x - 2, 0.82, st.z + sz).box(0.9, 0.4, 0.68, RED, x - 2, 1.4, st.z + sz);
    // Boutique Cobil bleue à gauche de l'aire + cage rouge de bouteilles de gaz devant (f_658_43m52s.jpg)
    const sx = x + 6.8, sz = st.z + 8.5;
    b.box(9.5, 3.6, 8.8, BLUE, sx, 1.8, sz).box(10.2, 0.45, 9.4, WHITE, sx, 3.75, sz).box(10.3, 0.16, 9.5, RED, sx, 3.5, sz)
      .box(0.12, 2.2, 1.8, 0x1e2d3d, sx - 4.78, 1.15, sz).box(0.12, 1.2, 1.5, 0x1e2d3d, sx - 4.78, 1.65, sz - 2.4)
      .box(1.8, 1.8, 2.6, 0xe8e8e4, sx - 5.7, 0.9, sz + 2.4).box(1.5, 1.5, 2.2, 0xd85a28, sx - 5.7, 0.78, sz + 2.4);
    signs.add(`st_shop_${st.z}`, () => signTexture('cobil', 'Boutique · Gaz · Lubrifiants', '#f4f4f0', '#1668b8'), 5.4, 0.65, sx - 5.15, 3.75, sz, -Math.PI / 2, true);
    signs.add(`st_canopy_${st.z}`, () => signTexture('cobil', 'Service 24h/24', '#f4f4f0', '#1668b8'), 9.5, 0.75, x - 7.12, 5.25, st.z, -Math.PI / 2, true);
    // Grand totem bleu Cobil avec losange blanc au sommet et tableau des prix (ESSENCE / GASOIL)
    const tx = ROAD_EDGE + 3.4, tz = st.z - 9.5;
    b.box(1.8, 7.2, 0.55, BLUE, tx, 3.6, tz).box(2.6, 0.22, 1.8, 0xb8b2a6, tx, 0.11, tz)
      .box(1.6, 1.6, 0.62, WHITE, tx, 6.2, tz, 0, 0, Math.PI / 4)
      .box(1.95, 1.3, 0.64, WHITE, tx, 4.1, tz);
    signs.add(`st_totem_${st.z}`, () => signTexture('COBIL', 'ESSENCE 2990 · GASOIL 2980', '#1668b8', '#ffffff'), 2.1, 2.8, tx, 4.8, tz + 0.34, 0, true);
    signs.add(`st_totem_${st.z}`, () => signTexture('COBIL', 'ESSENCE 2990 · GASOIL 2980', '#1668b8', '#ffffff'), 2.1, 2.8, tx, 4.8, tz - 0.34, Math.PI, true);
    return;
  }
  // Engen : bleu profond #003da5, bande blanche et liseré rouge #e31837 ; ML : jaune d'or et gris anthracite
  const roofCol = isEngen ? 0x003da5 : isML ? 0xf59e0b : 0xc8102e;
  const trimCol = isEngen ? 0xffffff : isML ? 0x1e293b : 0xffffff;
  const signBg = isEngen ? '#003da5' : isML ? '#d97706' : '#b0102a';
  const signFg = '#ffffff';
  const subText = isEngen ? 'Service 24h/24 · Boutique' : isML ? 'Carburant · Lubrifiants' : 'Carburant · Huile';
  b.box(14, 0.65, 22, roofCol, x, 5.4, st.z).box(14.2, 0.25, 22.2, trimCol, x, 5.0, st.z);
  if (isEngen) b.box(14.3, 0.16, 22.3, 0xe31837, x, 5.76, st.z);
  for (const sx of [-4.5, 4.5]) for (const sz of [-8, 8]) b.box(0.42, 5, 0.42, 0xdcdcdc, x + sx, 2.5, st.z + sz);
  for (const sz of [-4, 4]) b.box(0.9, 1.65, 0.65, roofCol, x - 2, 0.82, st.z + sz).box(0.94, 0.4, 0.68, isEngen ? 0xe31837 : trimCol, x - 2, 1.4, st.z + sz);
  b.box(10, 3.5, 7, 0xf2f0e8, x + 7, 1.75, st.z - 12).box(10.3, 0.35, 7.3, roofCol, x + 7, 3.6, st.z - 12);
  b.box(14, 0.05, 30, 0x555559, x, 0.03, st.z);
  // Bandeau sur l'auvent face au boulevard + grand totem double-face au bord de la route
  signs.add(`st_canopy_${st.z}`, () => signTexture(upper, subText, signBg, signFg), 11, 0.9, x - 7.12, 5.38, st.z, -Math.PI / 2, true);
  signs.add(`st_totem_${st.z}`, () => signTexture(upper, subText, signBg, signFg), 5.2, 1.65, ROAD_EDGE + 2.4, 6.2, st.z + 11.7, 0, true);
  signs.add(`st_totem_${st.z}`, () => signTexture(upper, subText, signBg, signFg), 5.2, 1.65, ROAD_EDGE + 2.4, 6.2, st.z + 11.3, Math.PI, true);
  b.box(0.32, 5.8, 0.32, isEngen ? 0x003da5 : 0x8e949a, ROAD_EDGE + 2.4, 2.9, st.z + 11.5);
}

function addMarketHalls(b, details, z0, z1) {
  // grands hangars du marché : piliers + toit à deux pans
  // (pas de hangar sur une avenue qui part du marché, même en biais : Avenue Bolenge)
  const onAvenue = (x, z) => SIDE_ROADS.some(r => {
    if (r.side !== 1 || r.triangle) return false;
    const a = r.ang * Math.PI / 180;
    return Math.abs(z - (r.z - (x - ROAD_EDGE) * Math.tan(a))) < (r.w / 2 + 1) / Math.cos(a) + 6 * Math.tan(a) + 11.5;
  });
  for (let z = z0; z > z1; z -= 22) {
    for (let col = 0; col < 3; col++) {
      const x = FRONT + 6 + col * 14;
      if (onAvenue(x, z)) continue;
      const roof = pick([0x2f5fa8, 0x8c9196, 0x9c5a35, 0x2b7a4b]);
      for (const sx of [-5, 5]) for (const sz of [-9, 9]) b.box(0.35, 4, 0.35, 0x8e949a, x + sx, 2, z + sz);
      for (const s of [-1, 1]) b.box(6.2, 0.15, 20, roof, x + s * 2.9, 4.5, z, 0, 0, s * -0.22);
      for (let k = 0; k < 4; k++) {
        const tx = x + rand(-4, 4), tz = z + rand(-8, 8);
        const d = details.at(tz);
        d.box(1.6, 0.8, 1.2, 0x8b6b45, tx, 0.4, tz);
        for (let g = 0; g < 3; g++) d.ball(0.18, pick(GOODS), tx + rand(-0.5, 0.5), 0.95, tz + rand(-0.4, 0.4));
        if (chance(0.4)) addPerson(d, tx + rand(-1.2, 1.2), tz + rand(-1, 1));
      }
    }
  }
}

function addAirport(b, signs) {
  // Aéroport international de N'djili (d'après aeroport de ndjili.jfif, aeroport2.jfif et areroport.jfif) :
  // 1) Aérogare moderne à façade claire, trois grandes baies vitrées sombres, large auvent couleur bronze/ocre
  //    porté par des piliers gris anthracite avec l'inscription « AEROPORT INTERNATIONAL DE N'DJILI »,
  //    bordures rouge et blanc, passage piéton et véhicule de Police.
  // 2) Tour de contrôle conique jaune-orangé encadrée par deux ailes modernes bleu-gris à brise-soleil inclinés.
  const x = ROAD_EDGE + 30;
  const bronze = 0xc98a4b, darkSteel = 0x2c323a, wall = 0xedeff2, glass = 0x1a2836;

  // Parvis asphalté + passage piéton + plots rouge et blanc devant l'aérogare
  b.box(28, 0.04, 128, 0x5a5c60, ROAD_EDGE + 14, 0.02, 8);
  for (let k = -4; k <= 4; k++) b.box(0.55, 0.05, 3.6, 0xf4f4f0, ROAD_EDGE + 6 + k * 1.1, 0.035, -2);
  let cb = 0;
  for (let z = -48; z <= 64; z += 2.2) {
    b.box(0.35, 0.22, 1.5, cb++ % 2 ? 0xd62828 : 0xf4f4f0, x - 18.5, 0.11, z);
    if (cb % 2 === 0) b.cyl(0.05, 0.05, 0.85, 0xd8dce0, x - 17.2, 0.42, z);
  }

  // Corps de l'aérogare + trois grandes entrées vitrées + auvent bronze-ocre en porte-à-faux
  b.box(24, 8.8, 114, wall, x, 4.4, 8);
  for (const bz of [-30, 8, 46]) {
    b.box(0.4, 4.2, 24, glass, x - 11.9, 2.1, bz)
      .box(0.5, 0.18, 24.4, darkSteel, x - 11.95, 4.2, bz);
    for (let dz = -10; dz <= 10; dz += 4) b.box(0.45, 4.2, 0.14, darkSteel, x - 11.92, 2.1, bz + dz);
  }
  // Grand bandeau d'auvent couleur bronze/cuivre (exactement comme sur aeroport de ndjili.jfif)
  b.box(10, 2.4, 118, bronze, x - 13.5, 8.4, 8)
    .box(10.2, 0.22, 118.4, 0x3a322b, x - 13.5, 9.65, 8)
    .box(10.2, 0.20, 118.4, 0xd8dce0, x - 13.5, 7.15, 8);
  // Piliers métalliques gris foncé soutenant l'auvent
  for (let z = -44; z <= 60; z += 13) {
    b.box(0.55, 7.2, 0.55, darkSteel, x - 17.2, 3.6, z);
  }
  signs.add('airport', () => signTexture("AEROPORT INTERNATIONAL DE N'DJILI", null, '#c98a4b', '#ffffff'),
    52, 2.1, x - 18.55, 8.4, 8, -Math.PI / 2, true);

  // Complexe de la Tour de Contrôle (d'après areroport.jfif : fût conique évasé jaune-orangé + 2 ailes bleu-gris)
  const tx = x + 28, tz = 68;
  // Fût évasé jaune-orangé + vigie vitrée circulaire + toit débordant
  b.cyl(3.2, 2.4, 18, 0xe89b18, tx, 9, tz, 0, 0, 0, 18)
    .cyl(4.2, 3.2, 10, 0xeba21c, tx, 23, tz, 0, 0, 0, 18)
    .cyl(4.9, 4.1, 4.2, 0x223242, tx, 30.1, tz, 0, 0, 0, 18)
    .cyl(5.6, 5.2, 0.7, 0xdfe4ea, tx, 32.5, tz, 0, 0, 0, 18)
    .cyl(0.12, 0.16, 6, 0xcccccc, tx, 35.8, tz);
  // Deux bâtiments administratifs latéraux à brise-soleil inclinés bleu-gris et façades orange
  for (const s of [-1, 1]) {
    const wz = tz + s * 22;
    b.box(16, 8.2, 26, 0xe89b18, tx - 4, 4.1, wz)
      .box(16.4, 8.4, 24, 0x6c879e, tx - 4.4, 4.2, wz)
      .box(0.4, 6.2, 22, 0x1c2b3a, tx - 12.65, 4.0, wz);
    for (let k = -10; k <= 10; k += 2.2) {
      b.box(0.7, 8.4, 0.28, 0x8aa4ba, tx - 12.5, 4.2, wz + k, 0.14, 0, 0);
    }
  }
}

/** Clôture unique « en escalier » du périmètre aéroportuaire / CETA / Badara à droite (side = 1),
 *  de 10 m avant l'aéroport (z0 = -58) jusqu'à 20 m avant la Station Cobil de l'Entrée Siforco (z1 = g(4064) + 35). */
function addAirportFence(chunks, details, z0, z1) {
  const x = FRONT - 0.5, bay = 3.9, steps = 3, sw = bay / steps;
  const WALL = 0xded9cc, PANEL = 0xcbc4b4, CAP = 0x7e786d, PIL = 0xe8e3d6, IRON = 0x2f3640;
  for (const [a, c] of solid(z0, z1, true)) {
    for (const [p, q] of pieces(a, c, 64)) {
      const len = p - q, zc = (p + q) / 2, b = chunks.at(zc);
      // Bande herbeuse du domaine aéroportuaire derrière la clôture + soubassement continu
      b.box(28, 0.04, len, 0x6f9244, x + 15, 0.02, zc)
        .box(0.38, 0.45, len, 0x9e988c, x, 0.225, zc);
      // Travées crénelées « en escalier » (3 marches montantes par travée entre deux piliers)
      for (let z = p; z - bay >= q - 0.5; z -= bay) {
        // Pilier béton à chapeau débordant
        b.box(0.50, 2.75, 0.50, PIL, x, 1.375, z)
          .box(0.62, 0.16, 0.62, CAP, x, 2.83, z);
        for (let s = 0; s < steps; s++) {
          const sz = z - (s + 0.5) * sw;
          if (sz < q) break;
          const h = 1.45 + s * 0.42; // marches d'escalier : 1,45 m → 1,87 m → 2,29 m
          b.box(0.30, h - 0.45, sw + 0.02, WALL, x, 0.45 + (h - 0.45) / 2, sz)
            .box(0.34, h - 0.85, sw * 0.76, PANEL, x, 0.55 + (h - 0.85) / 2, sz)
            .box(0.44, 0.13, sw + 0.08, CAP, x, h + 0.065, sz)
            .box(0.06, 0.34, 0.06, IRON, x, h + 0.28, sz - sw * 0.28)
            .box(0.06, 0.34, 0.06, IRON, x, h + 0.28, sz + sw * 0.28)
            .box(0.05, 0.05, sw + 0.04, IRON, x, h + 0.42, sz);
        }
      }
      // Dernier pilier de la tranche
      b.box(0.50, 2.75, 0.50, PIL, x, 1.375, q)
        .box(0.62, 0.16, 0.62, CAP, x, 2.83, q);
      // Arbres derrière la clôture (domaine aéroportuaire / Parc Présidentiel / Camp CETA)
      for (let z = p - rand(6, 14); z > q + 4; z -= rand(18, 32)) {
        (chance(0.45) ? addPalm : addMango)(b, x + rand(9, 28), z, rand(0.95, 1.45));
      }
    }
  }
}

/** Grands panneaux publicitaires TAXI-KIN VR (affiche officielle du dossier LogoApplication) le long du boulevard. */
function addPromoBillboards(scene, chunks) {
  const tex = new THREE.TextureLoader().load('data/logo/poster.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  const posterMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x1a1d24 });
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xf5c400 });
  const spots = [
    [-ROAD_EDGE - 6.5, -135, 0.22],
    [ROAD_EDGE + 7.5, g(4140), -0.22],
    [-ROAD_EDGE - 6.5, g(6100), 0.2],
    [ROAD_EDGE + 7.5, g(12450), -0.2],
  ];
  for (const [x, z, yaw] of spots) {
    if (z < Z_END) continue;
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 6.2, 10), frameMat);
    pole.position.y = 3.1;
    const box = new THREE.Mesh(new THREE.BoxGeometry(4.6, 7.6, 0.28), frameMat);
    box.position.y = 9.2;
    const border = new THREE.Mesh(new THREE.BoxGeometry(4.76, 7.76, 0.22), goldMat);
    border.position.y = 9.2;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 7.3), posterMat);
    face.position.set(0, 9.2, 0.16);
    const backFace = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 7.3), posterMat);
    backFace.position.set(0, 9.2, -0.16);
    backFace.rotation.y = Math.PI;
    grp.add(pole, border, box, face, backFace);
    place(grp, x, z, yaw, 0);
    scene.add(grp);
  }
}

/** Polygone plat convexe (x, z) à la hauteur y, face vers le haut. */
function flatPoly(b, pts, y, color) {
  const [a, c] = [pts[1], pts[2]].map(p => [p[0] - pts[0][0], p[1] - pts[0][1]]);
  const up = a[1] * c[0] - a[0] * c[1] > 0;          // composante y du produit vectoriel du premier triangle
  const P = up ? pts : [...pts].reverse(), pos = [];
  for (let i = 1; i < P.length - 1; i++) pos.push(P[0][0], y, P[0][1], P[i][0], y, P[i][1], P[i + 1][0], y, P[i + 1][1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
  g.computeVertexNormals();
  return b.addRaw(g, color);
}

/**
 * Échangeur de Limete, d'après le croquis de l'auteur (forme, emplacements) et les photos/vidéos du dossier
 * Echangeur (aspect). Les deux chaussées du boulevard s'écartent (spreadAt) autour du parc de la tour et
 * continuent jusqu'à la 17e Rue, où se trouve l'arrivée. Dans le parc, en partant de la pointe : un petit îlot
 * avec un monument, la place blanche en triangle avec la statue de Lumumba, puis une allée bordée de murets
 * jaunes qui monte vers la plate-forme ronde de la tour (quatre ailes blanches).
 * À droite, un petit boulevard quitte la chaussée près du triangle et longe le parc jusqu'à la 17e Rue :
 * en face de l'Échangeur, l'Entreprise Transco puis, juste après, le Collège Lumumba.
 */
function addInterchange(scene, chunks, details, signs) {
  const cz = END_Z;
  const GRASS = 0x5e8f3e, YELLOW = 0xe1b232, WHITE = 0xf2f0ea, CONCRETE_P = 0xbdb3a2, BRONZE = 0x5b3b24;
  // Le parc est construit en coordonnées réelles (il ne suit pas l'écartement des chaussées)
  const P = new Builder(), PS = new Signs();
  const inner = z => MEDIAN - 0.16 + spreadAt(z);    // pied de la bordure intérieure de chaque chaussée
  const at = d => cz + d;                              // position par rapport à la tour (+ = côté arrivée)

  // Dallages (texture de carreaux) : place en losange rose, carrés beiges le long de l'allée
  const tiled = { pink: [], beige: [] };
  const tilePoly = (kind, pts, y) => {
    const [a, c] = [pts[1], pts[2]].map(p => [p[0] - pts[0][0], p[1] - pts[0][1]]);
    const Q = a[1] * c[0] - a[0] * c[1] > 0 ? pts : [...pts].reverse();
    for (let i = 1; i < Q.length - 1; i++) tiled[kind].push(Q[0][0], y, Q[0][1], Q[i][0], y, Q[i][1], Q[i + 1][0], y, Q[i + 1][1]);
  };

  // ---------- Pelouse du parc, de la pointe jusqu'à la jonction derrière la tour ----------
  const XR = ECH.cross, XW = 8;                        // route à 2 voies (une par sens) entre le parc de la tour et la Police
  // Pointe : goudron entre les chaussées (le petit boulevard qui les relie), petit triangle de pelouse
  for (let z = ECH.fork0; z > ECH.park0 + 0.5; z -= 3) {
    const z2 = Math.max(ECH.park0, z - 3), a = inner(z) + 0.2, c = inner(z2) + 0.2;
    flatPoly(P, [[a, z], [c, z2], [-c, z2], [-a, z]], 0.035, ASPHALT_COL);
  }
  {
    const hw = inner(ECH.tri1) - 3.2, tri = [[0, ECH.tri0], [hw, ECH.tri1], [-hw, ECH.tri1]];
    flatPoly(P, tri, 0.2, GRASS);
    for (let i = 0; i < 3; i++) {
      const [p, q] = [tri[i], tri[(i + 1) % 3]], n = Math.max(2, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / 1.5));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        P.box(0.3, 0.24, Math.hypot(q[0] - p[0], q[1] - p[1]) / n, k % 2 ? CURB_DARK : CURB_LIGHT, p[0] + (q[0] - p[0]) * u, 0.12, p[1] + (q[1] - p[1]) * u, 0, Math.atan2(q[0] - p[0], q[1] - p[1]), 0);
      }
    }
    for (let x = -inner(ECH.park0) + 2; x < inner(ECH.park0) - 2; x += 6) P.box(3, 0.02, 0.18, 0xf2f2ec, x, 0.06, (ECH.tri1 + ECH.park0) / 2);   // axe du petit boulevard
    // bordure du parc côté petit boulevard
    const w = inner(ECH.park0);
    for (let x = -w + 0.75, k = 0; x < w; x += 1.5, k++) P.box(1.5, 0.24, 0.3, k % 2 ? CURB_DARK : CURB_LIGHT, x, 0.12, ECH.park0 - 0.15);
  }
  for (let z = ECH.park0; z > ECH.merge + 0.5; z -= 3) {
    const z2 = Math.max(ECH.merge, z - 3), a = inner(z), c = inner(z2);
    if (Math.abs((z + z2) / 2 - XR) < XW / 2 + 1) continue;
    flatPoly(P, [[a, z], [c, z2], [-c, z2], [-a, z]], 0.16, GRASS);
  }
  // La route qui arrive par la gauche après l'Échangeur : un PONT au-dessus de la chaussée de gauche (sans s'y
  // raccorder), qui redescend entre les deux chaussées et se raccorde au sol à la chaussée de droite (croquis).
  // Aucun lien avec le petit boulevard de droite.
  {
    const { S, BH, xIn, xOut, xLand, xRight, xFar, GY, RC, xEnd } = ECH_XB;              // (mêmes valeurs pour la conduite)
    P.box(xLand - xIn + 2, 0.06, XW + 0.6, GRASS, (xIn + xLand) / 2 - 1, 0.01, XR);       // pelouse sous la rampe (sous le goudron au pied)
    // a) rampe d'accès à gauche (au-delà de la chaussée) et route au sol plus loin, jusqu'au bout construit (talus)
    bezierRoad(P, [[xFar, XR], [xOut, XR]], XW, 12, { height: t => BH * smooth(t), rail: false });
    P.box(220 + xFar, 0.06, XW, ASPHALT_COL, (xFar - 220) / 2, 0.04, XR);
    for (const e of [-1, 1]) for (let x = xFar - 0.75, k = 0; x > -220; x -= 1.5, k++) P.box(1.5, 0.24, 0.3, k % 2 ? CURB_DARK : CURB_LIGHT, x, 0.12, XR + e * (XW / 2 + 0.15));
    P.box(3, 0.8, XW + 2, 0x9a5a34, xEnd - 3.2, 0.3, XR);
    for (let k = 0; k < 6; k++) P.ball(rand(0.5, 1), pick([0x56893a, 0x3f7a34]), xEnd - 3.2 + rand(-1, 1), 0.8, XR + rand(-XW / 2, XW / 2), 1, 0.7, 1);
    // b) tablier au-dessus de la chaussée de gauche : dalle, garde-corps, culées de part et d'autre
    const len = xIn - xOut;
    P.box(len, 1.0, XW + 1.2, 0xc9bfae, (xIn + xOut) / 2, BH - 0.5, XR)
      .box(len, 0.06, XW, ASPHALT_COL, (xIn + xOut) / 2, BH + 0.03, XR);
    for (const e of [-1, 1]) {
      for (let x = xOut + 0.75, k = 0; x < xIn; x += 1.5, k++) P.box(1.5, 0.24, 0.3, k % 2 ? CURB_DARK : CURB_LIGHT, x, BH + 0.12, XR + e * (XW / 2 + 0.15));
      for (const x of [xOut, xIn]) P.box(1.2, BH - 1, XW + 1.2, 0xb9b0a0, x, (BH - 1) / 2, XR);
    }
    for (let x = xOut + 3; x < xIn - 2; x += 6) P.box(3, 0.02, 0.18, 0xf2f2ec, x, BH + 0.07, XR);
    PS.add('ech_pont', () => signTexture('ÉCHANGEUR DE LIMETE', 'Pont', '#c9bfae', '#1d3557'), 9, 0.9, (xIn + xOut) / 2, BH - 0.5, XR + XW / 2 + 0.62, 0, true);
    // c) elle redescend et longe le bord arrière du parc, puis tourne en arrondi au coin pour se raccorder à la
    //    chaussée de droite, dans les deux sens (croquis « echangeurFin »)
    // (GY : niveau au sol, au-dessus de la pelouse ; RC : rayon des arrondis)
    bezierRoad(P, [[xIn, XR], [xLand, XR]], XW, 16, { height: t => GY - 0.05 + (BH - GY + 0.05) * (1 - smooth(t)), rail: false });
    P.box(xRight - xLand, 0.06, XW, ASPHALT_COL, (xRight + xLand) / 2, GY, XR);
    for (let x = xLand + 2; x < xRight - 2; x += 6) P.box(3, 0.02, 0.18, 0xf2f2ec, x, GY + 0.04, XR);
    for (const e of [-1, 1]) for (let x = xLand + 0.75, k = 0; x < xRight - RC; x += 1.5, k++) P.box(1.5, 0.24, 0.3, k % 2 ? CURB_DARK : CURB_LIGHT, x, GY + 0.07, XR + e * (XW / 2 + 0.15));
    for (const e of [-1, 1]) {                         // arrondis des deux coins (côté tour et côté Police)
      const C = [xRight, XR + e * XW / 2], O = [xRight - RC, XR + e * (XW / 2 + RC)], N = 10;
      const arc = Array.from({ length: N + 1 }, (_, i) => {
        const a = i / N * Math.PI / 2;
        return [O[0] + RC * Math.sin(a), O[1] - e * RC * Math.cos(a)];
      });
      for (let i = 0; i < N; i++) {
        flatPoly(P, [C, arc[i], arc[i + 1]], GY + 0.03, ASPHALT_COL);
        const [p, q] = [arc[i], arc[i + 1]], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const nx = (p[0] + q[0]) / 2 - O[0], nz = (p[1] + q[1]) / 2 - O[1], nl = Math.hypot(nx, nz);
        P.box(0.3, 0.24, len + 0.05, i % 2 ? CURB_DARK : CURB_LIGHT, (p[0] + q[0]) / 2 - nx / nl * 0.15, GY + 0.07, (p[1] + q[1]) / 2 - nz / nl * 0.15, 0, Math.atan2(q[0] - p[0], q[1] - p[1]), 0);
      }
    }
  }
  // Clôture métallique verte le long des chaussées (vidéo), sur une petite bordure béton
  for (const s of [-1, 1]) {
    let prev = null;
    for (let z = ECH.park0 - 3; z > ECH.merge + 30; z -= 2.5) {
      if (s > 0 && Math.abs(z - XR) < XW / 2 + 11) { prev = null; continue; }      // raccord arrondi de la route arrière
      const x = s * (inner(z) - 0.8);
      P.box(0.09, 1.8, 0.09, 0x2f5d3a, x, 0.9, z);
      if (prev) {
        const len = Math.hypot(x - prev[0], z - prev[1]), ry = Math.atan2(x - prev[0], z - prev[1]), mx = (x + prev[0]) / 2, mz = (z + prev[1]) / 2;
        P.box(0.3, 0.3, len, 0xc9c3b6, mx, 0.15, mz, 0, ry, 0);
        for (const y of [0.45, 1.05, 1.72]) P.box(0.05, 0.06, len, 0x2f5d3a, mx, y, mz, 0, ry, 0);
        for (let k = 1; k < 5; k++) P.box(0.03, 1.3, 0.03, 0x2f5d3a, prev[0] + (x - prev[0]) * k / 5, 1.05, prev[1] + (z - prev[1]) * k / 5);
      }
      prev = [x, z];
    }
  }

  // ---------- 1) Pointe du parc : petit îlot avec une statue sur un socle blanc ----------
  const zMon = at(149);
  P.cyl(2.4, 2.6, 0.5, 0xcbc4b4, 0, 0.35, zMon, 0, 0, 0, 20).box(1.6, 3.2, 1.6, WHITE, 0, 2.2, zMon)
    .box(0.55, 1.4, 0.4, BRONZE, 0, 4.5, zMon).ball(0.26, BRONZE, 0, 5.4, zMon);

  // ---------- 2) Place en losange (dallage rose) avec la statue de Patrice Lumumba et sa couronne jaune ----------
  const lz = at(112);
  tilePoly('pink', [[0, at(142)], [22, lz], [0, at(88)], [-22, lz]], 0.21);
  P.cyl(6.5, 6.8, 0.35, 0xd9d2c6, 0, 0.3, lz, 0, 0, 0, 28)                                // cercle autour du socle
    .cyl(2.2, 2.6, 1.6, 0x3a3532, 0, 1.2, lz, 0, 0, 0, 16)                                // socle sombre
    .cyl(1.6, 1.8, 2.4, 0x2d2926, 0, 3.2, lz, 0, 0, 0, 16);
  for (let i = 0; i < 14; i++) {                                                          // couronne d'arcs jaunes rayonnants
    const a = i / 14 * Math.PI * 2, r = 3.3;
    P.box(0.32, 0.32, 3.6, 0xdcc07a, Math.sin(a) * r, 2.6, lz + Math.cos(a) * r, -0.75, a, 0)
      .box(0.28, 1.7, 0.28, 0xdcc07a, Math.sin(a) * (r + 1.5), 0.95, lz + Math.cos(a) * (r + 1.5));
  }
  P.box(0.9, 1.9, 0.6, BRONZE, 0, 5.4, lz)                                                // statue en bronze : jambes
    .box(1.05, 1.7, 0.7, BRONZE, 0, 7.2, lz)                                              // buste (costume)
    .ball(0.4, BRONZE, 0, 8.45, lz)                                                       // tête
    .box(0.28, 1.6, 0.28, BRONZE, 0.75, 8.6, lz, 0, 0, -0.25)                             // bras droit levé
    .box(0.26, 1.3, 0.26, BRONZE, -0.68, 6.9, lz, 0, 0, 0.1);
  PS.add('lumumba_statue', () => signTexture('PATRICE ÉMERY LUMUMBA', 'Héros National · Échangeur de Limete', '#7a5c1e'),
    4.2, 0.9, 0, 1.25, lz + 2.65, 0, true);
  P.box(6, 2.4, 2.4, 0xb8262b, -13, 1.2, lz - 6, 0, 0.35, 0);                             // conteneur rouge (vidéo)

  // ---------- 3) Allée surélevée sur piliers, garde-corps jaunes, qui monte vers la plate-forme ----------
  const PLAT_R = 20, PLAT_H = 3.2, zW0 = at(90), zW1 = at(PLAT_R - 0.5), nW = 14;
  for (let i = 0; i < nW; i++) {
    const za = zW0 + (zW1 - zW0) * i / nW, zb = zW0 + (zW1 - zW0) * (i + 1) / nW;
    const ha = 0.4 + (PLAT_H - 0.4) * i / nW, hb = 0.4 + (PLAT_H - 0.4) * (i + 1) / nW, len = za - zb, zc = (za + zb) / 2, hm = (ha + hb) / 2;
    const rx = Math.atan2(hb - ha, len);
    P.box(5.2, 0.4, len + 0.05, 0xcfc6b5, 0, hm - 0.2, zc, rx, 0, 0);
    for (const s of [-1, 1]) P.box(0.3, 1.0, len + 0.05, YELLOW, s * 2.75, hm + 0.3, zc, rx, 0, 0);
    if (hm > 1) for (const s of [-1, 1]) P.box(0.55, hm - 0.4, 0.55, 0xc4bcae, s * 1.9, (hm - 0.4) / 2, zc);
  }

  // ---------- 4) Carrés dallés de part et d'autre de l'allée : fontaines rondes, bacs, arbres ----------
  for (const s of [-1, 1]) {
    for (const [d0, d1] of [[86, 60], [55, 30]]) tilePoly('beige', [[s * 4, at(d0)], [s * 27, at(d0)], [s * 27, at(d1)], [s * 4, at(d1)]], 0.19);
    for (const d of [73, 42]) {
      P.cyl(3.6, 3.8, 0.55, 0xeeeae2, s * 15, 0.3, at(d), 0, 0, 0, 24).cyl(3.1, 3.1, 0.58, 0x4b9fc9, s * 15, 0.32, at(d), 0, 0, 0, 24)
        .cyl(0.35, 0.5, 1.4, 0xeeeae2, s * 15, 0.8, at(d), 0, 0, 0, 10);
    }
    for (const d of [80, 64, 49, 34]) P.cyl(1.4, 1.5, 0.5, 0xeeeae2, s * 24, 0.3, at(d), 0, 0, 0, 14).cyl(1.15, 1.15, 0.55, 0x3f7a35, s * 24, 0.32, at(d), 0, 0, 0, 14);
  }

  // ---------- 5) Plate-forme ronde de la tour ----------
  P.cyl(PLAT_R, PLAT_R + 0.6, PLAT_H, CONCRETE_P, 0, PLAT_H / 2, cz, 0, 0, 0, 40)
    .cyl(PLAT_R - 0.4, PLAT_R - 0.4, 0.1, 0xcfc6b5, 0, PLAT_H + 0.05, cz, 0, 0, 0, 40);
  for (let i = 0; i < 40; i++) {                                                          // muret jaune (ouvert pour l'allée)
    const a = i / 40 * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.15 && Math.cos(a) > 0) continue;
    P.box(0.4, 0.9, 2 * Math.PI * PLAT_R / 40, YELLOW, Math.sin(a) * (PLAT_R - 0.2), PLAT_H + 0.45, cz + Math.cos(a) * (PLAT_R - 0.2), 0, a + Math.PI / 2, 0);
  }
  // Grand escalier en éventail (blanc) face à l'allée, qui monte au pied de la tour
  for (let k = 0; k < 6; k++) {
    P.add(new THREE.CylinderGeometry(12 - k * 1.2, 12 - k * 1.2, 0.42, 28, 1, false, -Math.PI / 2, Math.PI), 0xf1eee6, 0, PLAT_H + 0.21 + k * 0.42, cz + 4);
  }
  // Gradins en demi-cercle sur le côté droit de la plate-forme
  for (let k = 0; k < 5; k++) {
    P.add(new THREE.CylinderGeometry(17 - k * 1.5, 17 - k * 1.5, 0.4, 24, 1, false, Math.PI / 2 - 0.9, 1.8), 0xd8cfbf, 0, PLAT_H + 0.2 + (4 - k) * 0.4, cz);
  }
  // Bâtiment courbe à toiture rouge-brun accolé à la plate-forme (photos aériennes)
  P.add(new THREE.CylinderGeometry(24.5, 24.5, PLAT_H, 18, 1, true, Math.PI / 2 - 0.55, 1.1), 0xd9cdb5, 0, PLAT_H / 2, cz)
    .add(new THREE.RingGeometry(20.4, 25, 18, 1, -0.55, 1.1).rotateX(-Math.PI / 2), 0x9a4b32, 0, PLAT_H + 0.15, cz);
  // Quatre ailes blanches en pente, murs jaunes
  for (const a of [Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4]) {
    const L = 27, r = PLAT_R + L / 2 - 1, tilt = Math.atan2(PLAT_H, L);
    const x = Math.sin(a) * r, z = cz + Math.cos(a) * r;
    P.box(7.5, 0.5, L, WHITE, x, PLAT_H / 2, z, tilt, a, 0);
    for (const s of [-1, 1]) P.box(0.45, 1.4, L, YELLOW, x + Math.cos(a) * s * 3.95, PLAT_H / 2 + 0.35, z - Math.sin(a) * s * 3.95, tilt, a, 0);
    const ex = Math.sin(a) * (r + L / 2), ez = cz + Math.cos(a) * (r + L / 2);
    P.box(8.4, 1.2, 0.45, YELLOW, ex, 0.6, ez, 0, a, 0);                                  // bout de l'aile
  }

  // ---------- 6) Bassins allongés (eau verte), bosquets de palmiers, kiosques, arbres, drapeaux ----------
  for (const [x, d, ry] of [[-40, 6, 0.25], [40, 6, -0.25], [-34, -38, -0.5], [34, -38, 0.5]]) {
    P.box(8.5, 0.35, 26, 0xd6cdbd, x, 0.22, at(d), 0, ry, 0).box(6.4, 0.38, 24, 0x3f8f86, x, 0.25, at(d), 0, ry, 0);
    for (const e of [-1, 1]) P.cyl(4.25, 4.25, 0.35, 0xd6cdbd, x + Math.sin(ry) * e * 13, 0.22, at(d) + Math.cos(ry) * e * 13, 0, 0, 0, 16);
  }
  for (const s of [-1, 1]) for (let k = 0; k < 7; k++) addPalm(P, s * (30 + (k % 3) * 2.5), at(-12 - k * 2.2), rand(0.7, 0.95));
  for (let i = 0; i < 8; i++) {                                                           // kiosques blancs à toit bleu
    const s = i % 2 ? 1 : -1, x = s * (9 + (i >> 1) % 2 * 4.5), d = -42 - (i >> 2) * 6;
    P.box(2.6, 2.2, 2.2, 0xf4f4f0, x, 1.1, at(d)).box(3, 0.25, 2.6, 0x1d5fbf, x, 2.35, at(d));
  }
  const tree = (x, z, s = rand(0.9, 1.25)) => P.cyl(0.25 * s, 0.35 * s, 3.2 * s, 0x6b4f2a, x, 1.6 * s, z)
    .ball(2.6 * s, 0x2f6b2a, x, 4.2 * s, z, 1, 0.8, 1).ball(1.9 * s, 0x3b7d34, x + 0.9 * s, 5.2 * s, z + 0.4 * s, 1, 0.8, 1);
  for (let z = at(130); z > ECH.merge + 40; z -= 17) {
    const d = z - cz, w = inner(z) - 7;
    if (w < 9 || Math.abs(z - XR) < XW / 2 + 13) continue;
    for (const s of [-1, 1]) {
      const x = s * (w - rand(0, 3));
      if (Math.abs(x) > 30 && Math.abs(x) < 50 && d < 22 && d > -54) continue;           // bassins      tree(x, z + rand(-3, 3));
    }
  }
  for (const [x, d] of [[-32, 92], [32, 92], [-34, 58], [34, 58], [-38, 30], [38, 30]]) tree(x, at(d));

  // ---------- 8) Après la route en travers : l'enceinte de la Police, entre les deux chaussées ----------
  {
    const zp0 = at(-108), zp1 = at(-200), zc = (zp0 + zp1) / 2, hw = 24, L = zp0 - zp1;
    P.box(2 * hw, 0.05, L, 0x8e9399, 0, 0.19, zc);                                          // cour goudronnée
    for (const s of [-1, 1]) P.box(0.3, 2.4, L, 0xf2f5f8, s * hw, 1.2, zc).box(0.34, 0.45, L, 0x1d4fa0, s * hw, 2.5, zc);
    for (const z of [zp0, zp1]) {
      for (const s of [-1, 1]) P.box(hw - 4, 2.4, 0.3, 0xf2f5f8, s * (hw + 4) / 2, 1.2, z).box(hw - 4, 0.45, 0.34, 0x1d4fa0, s * (hw + 4) / 2, 2.5, z);
      P.box(0.6, 3.6, 0.6, 0x1d4fa0, -4, 1.8, z).box(0.6, 3.6, 0.6, 0x1d4fa0, 4, 1.8, z);  // portail
    }
    const b1 = at(-135), b2 = at(-178);
    P.box(30, 10.5, 13, 0xf4f4f0, 0, 5.25, b1).box(30.6, 0.5, 13.6, 0x1d4fa0, 0, 10.6, b1);   // bâtiment principal (R+2)
    for (const fy of [2, 5.5, 9]) for (let x = -12; x <= 12; x += 3) P.box(1.6, 1.3, 0.12, 0x1e3246, x, fy, b1 + 6.52);
    P.box(16, 6.5, 10, 0xe8ecf0, -6, 3.25, b2).box(16.6, 0.4, 10.6, 0x1d4fa0, -6, 6.7, b2);
    P.box(8, 3, 6, 0xe6c35c, 13, 1.5, b2);
    addFlag(P, PS, 8, zp0 - 4, 10);
    PS.add('police_ech', () => signTexture('POLICE NATIONALE CONGOLAISE', 'Limete · Échangeur', '#1d4fa0', '#ffffff'),
      14, 1.5, 0, 8.2, b1 + 6.6, 0, true);
    for (const [x, d] of [[-16, -120], [16, -120], [-16, -192], [16, -192]]) tree(x, at(d), 0.9);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2;
    addFlag(P, PS, Math.sin(a) * 30, cz + Math.cos(a) * 30, 11);
  }

  // Dallages texturés
  for (const [kind, base, line] of [['pink', '#dcb8a6', '#c49a88'], ['beige', '#d9c49c', '#bfa77c']]) {
    const tex = canvasTexture(256, 256, (x, w) => {
      x.fillStyle = base; x.fillRect(0, 0, w, w);
      x.strokeStyle = line; x.lineWidth = 3;
      for (let i = 0; i <= 4; i++) {
        x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, w); x.stroke();
        x.beginPath(); x.moveTo(0, i * w / 4); x.lineTo(w, i * w / 4); x.stroke();
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const pos = tiled[kind], uv = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 8, pos[i + 2] / 8);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(bendGeometry(geo, true), new THREE.MeshLambertMaterial({ map: tex }));
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---------- 7) La tour : quatre fûts de béton, nacelles jaunes en gradins, flèche jaune ----------
  const tb = new Builder();
  const H = 145;
  const shaftCol = 0xcfc7b8, darkSlot = 0x4f4a42, TOP = 0xe0b42a;
  tb.cyl(10, 12, 2.4, darkSlot, 0, PLAT_H + 1.2, cz, 0, 0, 0, 24);                       // socle sur la plate-forme
  for (const sx of [-4.6, 4.6]) {
    for (const sz of [-4.6, 4.6]) {
      tb.cyl(2.3, 2.8, H, shaftCol, sx, H / 2, cz + sz, 0, 0, 0, 16)
        .box(1.1, H - 10, 3.4, shaftCol, sx * 1.15, H / 2, cz + sz)
        .box(3.4, H - 10, 1.1, shaftCol, sx, H / 2, cz + sz * 1.15);
    }
  }
  tb.box(4.2, H - 4, 4.2, darkSlot, 0, H / 2, cz);                                        // noyau sombre (fentes)
  for (let y = 16; y < 125; y += 13) tb.box(12, 1.3, 12, 0xc5bba8, 0, y, cz);              // entretoises
  // Nacelles : 4 grappes de coupes jaunes en 3 étages, entre les fûts
  tb.cyl(9, 9, 1.2, 0xc5bba8, 0, 126, cz, 0, 0, 0, 20).cyl(8, 8, 1, 0xc5bba8, 0, H + 0.5, cz, 0, 0, 0, 20);
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const px = Math.sin(a) * 8.2, pz = cz + Math.cos(a) * 8.2;
    for (let k = 0; k < 3; k++) {
      const y = 128 + k * 5.2;
      tb.cyl(3.7, 2.8, 3.6, TOP, px, y + 1.8, pz, 0, 0, 0, 16)
        .cyl(3.45, 3.0, 1.1, 0x2a2622, px, y + 1.0, pz, 0, 0, 0, 16);
    }
  }
  // Flèche : faisceau de tubes jaunes puis un mât fin, balise rouge
  for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) tb.cyl(1, 1, 24, TOP, dx, H + 12, cz + dz, 0, 0, 0, 10);
  tb.box(5.5, 1.2, 5.5, 0x8e949a, 0, H + 4, cz)                                           // plate-forme des antennes
    .cyl(0.8, 1.1, 34, TOP, 0, H + 41, cz, 0, 0, 0, 10)
    .ball(0.7, 0xd62828, 0, H + 58.5, cz);

  const tower = new THREE.Mesh(bendGeometry(tb.geometry(), true), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }));
  tower.castShadow = true;
  scene.add(tower);
  const park = new THREE.Mesh(bendGeometry(P.geometry(), true), VC_MAT);
  park.castShadow = park.receiveShadow = true;
  scene.add(park);
  PS.build(scene, true);

  // ---------- À droite : le petit boulevard qui longe le parc (suit la chaussée de droite) ----------
  const b = new Builder();                             // maillage dédié (suit l'écartement) : visible jusqu'à la 17e Rue
  // Il part seulement de la chaussée de droite, près du triangle (il n'est pas relié au passage sous le 2e pont)
  const zPb0 = ECH.pb0, zPb1 = ECH.pb0 - 50;
  const pbPts = [[ROAD_EDGE + 4, zPb0], [ROAD_EDGE + 4.5, zPb0 - 16], [PB_X, zPb1 + 18], [PB_X, zPb1]];
  const tPb = tAtGap(pbPts, PB_W, 2.5), NB = 16;
  bezierRoad(b, pbPts, PB_W, NB, { innerFrom: Math.ceil(tPb * NB) });
  fillToEdge(b, pbPts, PB_W, 1, 0, tPb, { n: 6 });
  // Pelouse entre la chaussée et le petit boulevard (là où ils se séparent, puis tout du long)
  for (let i = 0; i < 8; i++) {
    const t0 = tPb + (1 - tPb) * i / 8, t1 = tPb + (1 - tPb) * (i + 1) / 8;
    const a = innerEdge(pbPts, PB_W, t0), c = innerEdge(pbPts, PB_W, t1);
    flatPoly(b, [[ROAD_EDGE + 0.6, a[1]], [a[0] - 0.3, a[1]], [c[0] - 0.3, c[1]], [ROAD_EDGE + 0.6, c[1]]], 0.12, GRASS);
  }
  // il traverse la 17e Rue et continue (croquis) ; après la 16e Rue, addLimete le prolonge jusqu'à la 1re Rue
  const zPbEnd = LIM ? Z16 - 5.5 : Z_END + 2;
  const at17 = z => Math.abs(z - Z16) < 5.5;
  for (const [p, q] of [...pieces(zPb1, Z16 + 5.5, 24), ...pieces(Z16 - 5.5, zPbEnd, 24)]) {
    const len = p - q, zc = (p + q) / 2;
    b.box(PB_W, 0.05, len, ASPHALT_COL, PB_X, 0.04, zc)
      .box(PB_X - PB_W / 2 - ROAD_EDGE - 0.9, 0.2, len, GRASS, (PB_X - PB_W / 2 + ROAD_EDGE + 0.6) / 2, 0.1, zc);
  }
  // Station-service à droite, juste là où le petit boulevard se raccorde au grand boulevard (croquis de l'Échangeur)
  addSideFuel(b, signs, 1, ECH.station, 'fuel_ech', 'STATION');
  b.box(4.6, 0.05, 28, 0x555559, ROAD_EDGE + 2.9, 0.03, ECH.station);                     // entrée depuis la chaussée
  b.box(PB_W, 0.05, 11, ASPHALT_COL, PB_X, 0.045, Z16);                                    // croisement avec la 17e Rue
  for (let z = zPb1, k = 0; z > zPbEnd + 0.75; z -= 1.5, k++) {
    if (at17(z - 0.75)) continue;
    for (const x of [PB_X - PB_W / 2 - 0.15, PB_X + PB_W / 2 + 0.15]) if (!(x > PB_X && Math.abs(z - 0.75 - ECH.rue17) < 5)) b.box(0.3, 0.22, 1.5, k % 2 ? CURB_DARK : CURB_LIGHT, x, 0.11, z - 0.75);
    if (k % 4 === 0) b.box(0.18, 0.02, 3, 0xf2f2ec, PB_X, 0.07, z - 1.5);
  }
  for (let z = zPb1 - 10; z > zPbEnd + 8; z -= 30) {
    if (PHOTO_BOARDS.some(p => p.side > 0 && Math.abs(g(p.s) - z) < 7)) continue;   // pas de lampadaire contre un grand panneau
    addSolarLamp(b, PB_X - PB_W / 2 - 1.2, z, 1);
  }
  // Panneau au départ de la bretelle
  {
    const sx = ROAD_EDGE + 1.6, sz = ECH.station + 22;
    b.box(0.14, 2.8, 0.14, 0x8e949a, sx - 1.4, 1.4, sz).box(0.14, 2.8, 0.14, 0x8e949a, sx + 1.4, 1.4, sz);
    signs.add('ech_pb', () => signTexture('PETIT BOULEVARD ↗', 'Transco · Collège Lumumba · 17e Rue', '#1d4fa0', '#f5c400'),
      4.8, 1.3, sx, 2.3, sz + 0.08, 0, true);
  }

  // ---------- À gauche : le « bypass » (au sol), avant la route en travers ----------
  {
    const bp = [[-(ROAD_EDGE + 4), ECH.bypass - 20], [-(ROAD_EDGE + 4.5), ECH.bypass], [-(ROAD_EDGE + 30), ECH.bypass + 25], [-(ROAD_EDGE + 58), ECH.bypass + 48]];
    const wBp = BP_STUB ? 7.24 : PB_W, t0 = tAtGap(bp, wBp, 2.5);
    bezierRoad(b, bp, wBp, 16, { innerFrom: Math.ceil(t0 * 16), innerTo: BP_STUB ? 13 : Infinity, outerTo: BP_STUB ? 15 : Infinity, outerSign: -1 });
    fillToEdge(b, bp, wBp, -1, 0, t0, { n: 6 });
    if (BP_STUB) {                                   // (l'auteur, 13/11) l'entrée : du By Pass vers l'aéroport, deuxième branche du Y
      const bp2 = BP_STUB.P2, t2 = tAtGap(bp2, wBp, 2.5);
      bezierRoad(b, bp2, wBp, 16, { innerFrom: Math.ceil(t2 * 16), innerTo: 12, outerFrom: Math.ceil(t2 * 16), outerTo: 15, outerSign: 1 });
      fillToEdge(b, bp2, wBp, -1, 0, t2, { n: 6 });
      // pointe du Y : les deux bordures intérieures se rejoignent proprement sans empiéter sur la chaussée
      const z0 = ECH.bypass;
      b.box(0.3, 0.22, 3.35, CURB_LIGHT, -56.6, 0.11, z0 + 38.75, 0, Math.atan2(-2.6, 2.1), 0)
        .box(0.3, 0.22, 2.55, CURB_DARK, -56.65, 0.11, z0 + 39.95, 0, Math.atan2(-2.5, -0.3), 0);
      // panneaux posés dans le terre-plein central du Y (hors du goudron)
      const fx = -(ROAD_EDGE + 33), fz = z0 + 36.5, fang = Math.PI / 2 + 0.6, fcx = Math.cos(fang), fsz = Math.sin(fang);
      b.box(0.14, 2.8, 0.14, 0x8e949a, fx - fcx * 1.4, 1.4, fz + fsz * 1.4).box(0.14, 2.8, 0.14, 0x8e949a, fx + fcx * 1.4, 1.4, fz - fsz * 1.4);
      signs.add('ech_bp_in', () => signTexture('↗ BD LUMUMBA · MASINA', 'Vers l’aéroport', '#1d4fa0', '#f5c400'), 4.8, 1.3, fx, 2.3, fz, fang, true);
      // la branche de gauche (la sortie du boulevard) est en sens interdit quand on vient du By Pass
      const gx = -(ROAD_EDGE + 30), gz = z0 + 26.5;
      b.box(0.14, 2.6, 0.14, 0x8e949a, gx, 1.3, gz);
      signs.add('ech_bp_sens', () => signTexture('⛔ SENS INTERDIT', 'Sortie du boulevard seulement', '#c8102e', '#ffffff'), 3.6, 1.2, gx, 2.2, gz, fang, true);
    }
    const sx = -(ROAD_EDGE + 1.6), sz = ECH.bypass - 30;
    b.box(0.14, 2.8, 0.14, 0x8e949a, sx - 1.4, 1.4, sz).box(0.14, 2.8, 0.14, 0x8e949a, sx + 1.4, 1.4, sz);
    signs.add('ech_bypass', () => signTexture('↖ BYPASS', 'Échangeur de Limete', '#1d4fa0', '#f5c400'), 4.8, 1.3, sx, 2.3, sz - 0.08, Math.PI, true);
  }
  // ---------- À gauche, avant la 17e Rue : un petit boulevard quitte la chaussée, petit triangle de pelouse ----------
  {
    const pl = PBL_PTS;
    const t0 = tAtGap(pl, PB_W, 2.5);
    // Limete : le petit boulevard de gauche part d'ici, tout droit ; pas de bordure là où la bretelle le traverse
    const skip = LIM ? [Math.floor(pblT(LIM_PB_X - PB_W / 2) * 16), Math.ceil(pblT(LIM_PB_X + PB_W / 2 + 0.3) * 16)] : null;
    bezierRoad(b, pl, PB_W, 16, { innerFrom: Math.ceil(t0 * 16), innerSkip: skip });
    fillToEdge(b, pl, PB_W, -1, 0, t0, { n: 6 });
    const i1 = innerEdge(pl, PB_W, tAtGap(pl, PB_W, 3.5)), i2 = innerEdge(pl, PB_W, tAtGap(pl, PB_W, 12));
    const tri = [[-(ROAD_EDGE + 1.2), i1[1] - 1], [i2[0] + 1.5, i2[1]], [-(ROAD_EDGE + 1.2), i2[1] - 4]];
    flatPoly(b, tri, 0.2, GRASS);
    for (let i = 0; i < 3; i++) {
      const [p, q] = [tri[i], tri[(i + 1) % 3]], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      b.box(0.3, 0.24, len, i % 2 ? CURB_DARK : CURB_LIGHT, (p[0] + q[0]) / 2, 0.12, (p[1] + q[1]) / 2, 0, Math.atan2(q[0] - p[0], q[1] - p[1]), 0);
    }
  }

  // ---------- En face de l'Échangeur, au bord du petit boulevard : Entreprise Transco puis Collège Lumumba ----------
  const zTransco = cz + 42, txWall = PB_X + PB_W / 2 + 1.6, txYard = txWall + 19;
  b.box(38, 0.05, 26, 0x6c7075, txYard, 0.025, zTransco);
  for (const [z0, z1] of [[zTransco + 6.5, zTransco + 12.5], [zTransco - 6.5, zTransco - 12.5]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.35, 2.3, len, 0xf2f5f8, txWall, 1.15, zc).box(0.40, 0.48, len, 0x1d4fa0, txWall, 2.50, zc);
  }
  b.box(0.65, 5.4, 0.65, 0x1d4fa0, txWall, 2.7, zTransco - 6.3)
    .box(0.65, 5.4, 0.65, 0x1d4fa0, txWall, 2.7, zTransco + 6.3)
    .box(0.55, 0.85, 13.4, 0x1d4fa0, txWall, 5.55, zTransco)
    .box(0.60, 0.25, 13.6, 0xd62828, txWall, 5.05, zTransco)
    .box(txWall - PB_X - PB_W / 2, 0.05, 11, ASPHALT_COL, (txWall + PB_X + PB_W / 2) / 2, 0.03, zTransco);   // entrée du dépôt
  signs.add('transco_gate_matete', () => signTexture('ENTREPRISE TRANSCO', 'Transport au Congo · Direction Générale & Dépôt', '#1d4fa0', '#f5c400'),
    12.4, 1.45, txWall - 0.32, 5.55, zTransco, -Math.PI / 2, true);
  const hxT = txWall + 24;
  b.box(20, 8.4, 24, 0xe8ecf0, hxT, 4.2, zTransco)
    .box(21.2, 0.75, 25.2, 0x1d4fa0, hxT, 8.7, zTransco)
    .box(21.4, 0.28, 25.4, 0xd62828, hxT, 8.15, zTransco);
  for (const dzBay of [-6.5, 6.5]) {
    b.box(0.25, 4.8, 7.5, 0x1e293b, hxT - 10.05, 2.4, zTransco + dzBay).box(0.35, 0.45, 8.0, 0x1d4fa0, hxT - 10.1, 5.0, zTransco + dzBay);
  }
  signs.add('transco_hangar_matete', () => signTexture('ENTREPRISE TRANSCO · ATELIERS', 'Établissement Public de Transport · Kinshasa', '#1d4fa0', '#ffffff'),
    16, 1.6, hxT - 10.15, 7.1, zTransco, -Math.PI / 2, true);
  for (const [dzBus, ryBus] of [[-5.5, -Math.PI / 2 + 0.12], [5.5, -Math.PI / 2 - 0.12]]) {
    const bus = createCityBus();
    place(bus, txWall + 8.5, zTransco + dzBus, ryBus, 0);
    scene.add(bus);
  }

  // Collège Lumumba : juste après Transco, il longe le petit boulevard jusqu'au coin de la 17e Rue
  const cA = cz + 27, cB = ECH.rue17 + 6, zCollege = cz - 22, cxWall = txWall, cxBldg = cxWall + 12.5, cH = 8.0;
  b.box(30, 0.05, cA - cB, 0xc8c2b6, cxWall + 15, 0.025, (cA + cB) / 2);                    // cour
  for (const [z0, z1] of [[cA, zCollege + 4.3], [zCollege - 4.3, cB]]) {                     // mur blanc à bande bleue
    for (const [p, q] of pieces(z0, z1, 12)) b.box(0.30, 2.1, p - q, 0xf5f7fa, cxWall, 1.05, (p + q) / 2).box(0.34, 0.45, p - q, 0x1d5fbf, cxWall, 2.28, (p + q) / 2);
  }
  b.box(30, 2.1, 0.30, 0xf5f7fa, cxWall + 15, 1.05, cB).box(30, 0.45, 0.34, 0x1d5fbf, cxWall + 15, 2.28, cB);   // mur sur la 17e Rue
  b.box(0.55, 4.8, 0.55, 0x1d5fbf, cxWall, 2.4, zCollege - 4.3)                              // portail
    .box(0.55, 4.8, 0.55, 0x1d5fbf, cxWall, 2.4, zCollege + 4.3)
    .box(0.48, 0.75, 9.4, 0x1d5fbf, cxWall, 4.95, zCollege)
    .box(12, cH, 16, 0xf6f8fb, cxBldg, cH / 2, zCollege)                                      // bâtiment principal face au portail
    .box(12.8, 0.45, 16.8, 0x1d5fbf, cxBldg, cH + 0.2, zCollege);
  for (let dz = -6; dz <= 6; dz += 4) {
    b.box(0.16, 1.3, 2.2, 0x1e2f42, cxBldg - 6.02, 2.0, zCollege + dz)
      .box(0.16, 1.3, 2.2, 0x1e2f42, cxBldg - 6.02, 5.7, zCollege + dz);
  }
  for (const [z0, z1] of [[cA - 3, zCollege + 13], [zCollege - 13, cB + 3]]) {               // bâtiments de classes
    const zc = (z0 + z1) / 2, len = z0 - z1;
    b.box(9, 7, len, 0xf6f8fb, cxWall + 16, 3.5, zc).box(9.6, 0.4, len + 0.6, 0x1d5fbf, cxWall + 16, 7.2, zc);
    for (let z = z0 - 3; z > z1 + 2; z -= 4) b.box(0.16, 1.2, 2.2, 0x1e2f42, cxWall + 11.45, 2.0, z).box(0.16, 1.2, 2.2, 0x1e2f42, cxWall + 11.45, 5.2, z);
  }
  addFlag(b, signs, cxWall + 3.2, zCollege + 6, 9.0);
  for (const [dx, dz] of [[3.2, -2.5], [4.0, 2.0], [4.8, -5.5], [6, -30], [7, 25]]) addPerson(details.at(zCollege), cxWall + dx, zCollege + dz, { ry: -Math.PI / 2 });
  for (const [dx, dz] of [[-1.2, 3], [-1.6, -1]]) addPerson(details.at(zCollege), cxWall + dx, zCollege + dz, { ry: Math.PI / 2 });
  signs.add('college_lumumba_gate', () => signTexture('COLLÈGE LUMUMBA · ÉCOLE LUMUMBA', 'Groupe Scolaire Officiel · Limete', '#1d5fbf', '#f5c400'),
    9.0, 1.3, cxWall - 0.26, 4.95, zCollege, -Math.PI / 2, true);
  signs.add('college_lumumba_bldg', () => signTexture('COLLÈGE PATRICE EMERY LUMUMBA', 'Enseignement Secondaire · Kinshasa Limete', '#ffffff', '#1d5fbf'),
    14, 1.4, cxBldg - 6.05, 7.2, zCollege, -Math.PI / 2, true);

  // La 17e Rue : elle part du petit boulevard (côté extérieur), au coin du Collège
  {
    const x0 = PB_X + PB_W / 2, L = 90, z = ECH.rue17;
    b.box(L, 0.05, 9, ASPHALT_COL, x0 + L / 2, 0.035, z);
    for (let x = x0 + 3; x < x0 + L - 2; x += 6) b.box(3, 0.02, 0.18, 0xf2f2ec, x, 0.065, z);
    for (const e of [-1, 1]) for (let x = x0 + 0.75, k = 0; x < x0 + L; x += 1.5, k++) b.box(1.5, 0.22, 0.3, k % 2 ? CURB_DARK : CURB_LIGHT, x, 0.11, z + e * 4.65);
    const sx = x0 + 1.2, sz = z + 5.6;
    b.box(0.1, 3.2, 0.1, 0x8e949a, sx, 1.6, sz);
    signs.add('rue17_pb', () => signTexture('17e RUE LIMETE', 'Quartier Industriel', '#1d4fa0'), 3.4, 0.7, sx, 2.9, sz + 0.06, 0, true);
    for (let k = 0; k < 4; k++) addPerson(details.at(z), x0 + 3 + k * 2, z + 6 + rand(0, 3), { ry: rand(-1, 1) });
  }

  // Façades derrière le petit boulevard, après la 17e Rue (jusqu'à la 16e Rue quand le tronçon de Limete suit)
  for (let z = ECH.rue17 - 12; z > (LIM ? Z16 + 12 : Z_END + 8); z -= 14) {
    if (Math.abs(z - Z16) < 12) continue;
    const h = rand(4, 9);
    b.box(10, h, 11, pick([0xd9d4c8, 0xeeeeec, 0xc8c2b6]), txWall + 6, h / 2, z).box(10.6, 0.25, 11.6, pick([0x8e949a, 0x5f6b77]), txWall + 6, h + 0.12, z);
  }
  const side = new THREE.Mesh(bendGeometry(b.geometry()), VC_MAT);
  side.castShadow = side.receiveShadow = true;
  scene.add(side);
}

function addFinish(b, signs) {
  for (const x of [MEDIAN + 0.3, ROAD_EDGE + 0.4]) b.box(0.45, 7, 0.45, 0x5c6670, x, 3.5, -ROUTE_LEN);
  signs.add('finish', () => signTexture(R.end.name.toUpperCase(), 'Fin de la course', '#1d6b3a'),
    ROAD_EDGE - MEDIAN + 0.6, 2, (ROAD_EDGE + MEDIAN) / 2 + 0.35, 6.4, -ROUTE_LEN + 0.05, 0, true);
}

// Lampes des feux tricolores : couleur allumée, couleur éteinte
const LENS = { r: [0xff2a1a, 0x3a1010], a: [0xffb000, 0x3a2a08], g: [0x2ee05f, 0x0c2a14] };
let signalLenses = null;                              // { main | street : { r, a, g : maillage } }

/**
 * Carrefours à feux (SIGNALS) : goudron à la place du terre-plein, lignes d'arrêt, deux feux par sens sur le boulevard
 * (au bord et sur le terre-plein) et un feu à chaque sortie de la rue. Les lampes sont des maillages à part, allumés
 * par updateSignals selon le cycle.
 */
function addSignals(scene, chunks) {
  // goudron à la place du terre-plein (carrefours à feux et carrefours ouverts sans feux)
  for (const c of MEDIAN_CUTS) chunks.at(c.z).box(MEDIAN * 2 + 0.4, 0.04, c.w, ASPHALT_COL, 0, 0.02, c.z);
  if (!SIGNALS.length) return;
  const B = { main: { r: new Builder(), a: new Builder(), g: new Builder() }, street: { r: new Builder(), a: new Builder(), g: new Builder() } };
  for (const sg of SIGNALS) {
    const b = chunks.at(sg.z);
    for (const [z, s] of [[sg.stopR, 1], [sg.stopL, -1]]) b.box(ROAD_EDGE - MEDIAN - 0.2, 0.02, 0.45, 0xf2f2ec, s * (ROAD_EDGE + MEDIAN) / 2, 0.035, z);   // lignes d'arrêt
    if (sg.robot) { addRobot(b, B, 0, sg.z + sg.w / 2 + 1.6, sg.streets[-1] ? -1 : 1); continue; }   // (au bout du terre-plein, côté aéroport)
    // [x, z, vers qui regarde le feu, groupe] : boulevard dans les deux sens, puis la sortie de la rue de chaque côté.
    // Juste derrière le portique d'arrivée (1re Rue), les feux du boulevard passent devant lui.
    const zR = Math.abs(sg.stopR + ROUTE_LEN) < 8 ? [sg.stopR + 7, sg.stopR + 7] : [sg.stopR + 3, sg.stopR + 1.4];
    const heads = [
      [ROAD_EDGE + 0.9, zR[0], 'pz', 'main'], [0.7, zR[1], 'pz', 'main'],
      [-(ROAD_EDGE + 0.9), sg.stopL - 3, 'nz', 'main'], [-0.7, sg.stopL - 1.4, 'nz', 'main'],
      ...(sg.streets[1] ? [[ROAD_EDGE + 2.2, sg.z - sg.w / 2 - 1.0, 'px', 'street']] : []),
      ...(sg.streets[-1] ? [[-(ROAD_EDGE + 2.2), sg.z + sg.w / 2 + 1.0, 'nx', 'street']] : []),
    ];
    for (const [x, z, dir, grp] of heads) {
      const H = 3.6, f = { pz: [0, 0.22], nz: [0, -0.22], px: [0.22, 0], nx: [-0.22, 0] }[dir], across = dir === 'pz' || dir === 'nz';
      b.cyl(0.07, 0.09, H, 0x2a2a2a, x, H / 2, z).box(0.42, 1.25, 0.42, 0x1a1a1a, x, H + 0.5, z);
      for (const [k, dy] of [['r', 0.38], ['a', 0], ['g', -0.38]]) {
        B[grp][k].box(across ? 0.27 : 0.06, 0.27, across ? 0.06 : 0.27, 0xffffff, x + f[0], H + 0.5 + dy, z + f[1]);
      }
    }
  }
  signalLenses = {};
  for (const grp of ['main', 'street']) {
    signalLenses[grp] = {};
    for (const k of ['r', 'a', 'g']) {
      const on = new THREE.MeshBasicMaterial({ color: LENS[k][0] }), off = new THREE.MeshLambertMaterial({ color: LENS[k][1] });
      const m = new THREE.Mesh(bendGeometry(B[grp][k].geometry()), off);
      m.userData = { on, off };
      scene.add(m);
      signalLenses[grp][k] = m;
    }
  }
}

/** Robot roulage (l'auteur, 10/11) : le robot de la circulation de Kinshasa, grand corps d'aluminium sur un socle au bout du terre-plein ;
 *  feux rouge / orange / vert sur la poitrine et dans le dos (pour le boulevard, groupe main) et au bout du bras tendu vers la rue (groupe street).
 *  B : les Builders des lampes (voir addSignals) ; streetSide : côté de la rue (-1 : à gauche). */
function addRobot(b, B, x, z, streetSide) {
  const AL = 0xcfd4da, DARK = 0x3a3f46, Y = 0xf5c400;
  b.cyl(0.9, 1.0, 0.5, 0x8a8d92, x, 0.25, z, 0, 0, 0, 14).cyl(0.62, 0.62, 0.12, Y, x, 0.56, z, 0, 0, 0, 14);       // socle, liseré jaune
  for (const dx of [-0.22, 0.22]) b.box(0.22, 1.0, 0.26, AL, x + dx, 1.12, z).box(0.3, 0.1, 0.34, DARK, x + dx, 1.6, z);   // jambes
  b.box(0.8, 0.3, 0.5, DARK, x, 1.78, z).box(0.95, 1.1, 0.55, AL, x, 2.48, z).box(1.0, 0.12, 0.6, DARK, x, 3.08, z);        // bassin, torse, épaules
  b.box(0.5, 0.52, 0.48, AL, x, 3.42, z).box(0.52, 0.16, 0.1, 0x101418, x, 3.52, z - 0.25).box(0.52, 0.16, 0.1, 0x101418, x, 3.52, z + 0.25);   // tête, visières
  for (const dx of [-0.95, 0.95]) b.box(0.9, 0.06, 0.6, 0x1f3550, x + dx, 3.2, z, 0, 0, dx > 0 ? -0.25 : 0.25);          // panneaux solaires
  for (const dx of [-1, 1]) b.box(1.3, 0.22, 0.22, AL, x + dx * 1.15, 2.78, z).box(0.3, 0.44, 0.3, DARK, x + dx * 1.9, 2.78, z);   // bras, poings
  b.box(0.6, 0.18, 0.04, Y, x, 1.95, z + 0.28).box(0.6, 0.18, 0.04, Y, x, 1.95, z - 0.28);                                 // bandeau « roulage »
  for (const [k, dy] of [['r', 0.3], ['a', 0], ['g', -0.3]]) {
    B.main[k].box(0.26, 0.24, 0.05, 0xffffff, x, 2.55 + dy, z + 0.3);                                                    // poitrine (vers +z)
    B.main[k].box(0.26, 0.24, 0.05, 0xffffff, x, 2.55 + dy, z - 0.3);                                                    // dos (vers -z)
    B.street[k].box(0.05, 0.12, 0.26, 0xffffff, x + streetSide * 2.08, 2.78 + dy * 0.45, z);                             // bout du bras, vers la rue
  }
}

let _workGeos = null;
function workPropGeos() {
  if (!_workGeos) {
    const cone = new Builder().cyl(0.04, 0.18, 0.72, 0xff6a00, 0, 0.38, 0).cyl(0.105, 0.125, 0.1, 0xffffff, 0, 0.47, 0).box(0.42, 0.04, 0.42, 0x1a1a1a, 0, 0.02, 0).geometry();
    const barR = new Builder().box(0.44, 0.55, 1.85, 0xd62828, 0, 0.28, 0).box(0.26, 0.32, 1.85, 0xd62828, 0, 0.7, 0).geometry();
    const barW = new Builder().box(0.44, 0.55, 1.85, 0xf2f2ec, 0, 0.28, 0).box(0.26, 0.32, 1.85, 0xf2f2ec, 0, 0.7, 0).geometry();
    cone.userData._freed = barR.userData._freed = barW.userData._freed = true;
    _workGeos = { cone, barR, barW };
  }
  return _workGeos;
}

/** Anime et dégage les cônes et barrières légères touchés par le véhicule du joueur. */
function updateWorksProps(dt, taxi) {
  if (!WORKS.length || !taxi) return;
  const h = taxi.heading ?? 0, sinH = Math.sin(h), cosH = Math.cos(h);
  const hl = taxi.hl ?? 2.2, hw = taxi.hw ?? 0.95, sp = Math.abs(taxi.speed ?? 0);
  const sgn = (taxi.speed ?? 0) < -0.1 ? -1 : 1;
  const fx = sinH * sgn, fz = -cosH * sgn;
  for (const Wk of WORKS) {
    if (!Wk.on || !Wk.props?.length) continue;
    const zMid = (Wk.z0 + Wk.z1) / 2, span = (Wk.z0 - Wk.z1) / 2 + Wk.taper + 55;
    if (Math.abs(taxi.z - zMid) > span) continue;
    for (const p of Wk.props) {
      const dx = p.x - taxi.x, dz = p.z - taxi.z;
      let af = dx * sinH - dz * cosH, al = dx * cosH + dz * sinH;
      const penF = hl + p.r - Math.abs(af), penL = hw + p.r - Math.abs(al);
      if (penF > 0 && penL > 0) {
        const sideSign = al >= 0 ? 1 : -1;
        const pushX = cosH * sideSign, pushZ = sinH * sideSign;
        if (!p.hit || Math.hypot(p.vx, p.vz) < 1.5) taxi.coneHit = true;
        if (penF < penL) {
          af = (af >= 0 ? 1 : -1) * (hl + p.r + 0.14);
        } else {
          al = sideSign * (hw + p.r + 0.14);
        }
        p.x = taxi.x + sinH * af + cosH * al;
        p.z = taxi.z - cosH * af + sinH * al;
        const kick = Math.max(4.8, sp * 1.2 + 3.2);
        p.vx = fx * kick * (penF < penL ? 0.95 : 0.55) + pushX * (3.2 + sp * 0.45) + (Math.random() - 0.5) * 1.4;
        p.vz = fz * kick * (penF < penL ? 0.95 : 0.55) + pushZ * (3.2 + sp * 0.45) + (Math.random() - 0.5) * 1.4;
        if (p.kind === 'cone') {
          p.yaw = Math.atan2(p.vx, -p.vz);
        } else {
          const bCos = Math.cos(p.yaw), bSin = Math.sin(p.yaw);
          p.fallSign = (p.vx * bCos + p.vz * bSin) >= 0 ? -1 : 1;
          p.vyaw = (Math.random() - 0.5) * 4.5;
        }
        p.vtilt = Math.max(p.vtilt, 9.5 + Math.min(8, sp * 0.6));
        p.hit = true;
      }
      if (p.hit && (Math.abs(p.vx) > 0.03 || Math.abs(p.vz) > 0.03 || p.tilt < 1.38)) {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        p.yaw += p.vyaw * dt;
        const drag = Math.exp(-3.5 * dt);
        p.vx *= drag; p.vz *= drag; p.vyaw *= drag;
        p.tilt = Math.min(1.42, p.tilt + p.vtilt * dt);
        const yOff = (p.kind === 'cone' ? 0.15 : 0.21) * Math.sin(p.tilt);
        p.mesh.rotation.set(0, 0, 0);
        place(p.mesh, p.x, p.z, p.yaw, roadH(p.z) + yOff);
        if (p.kind === 'cone') p.mesh.rotation.x = -p.tilt;
        else p.mesh.rotation.z = p.fallSign * p.tilt;
      }
    }
  }
}

/** Le décor des chantiers (voir WORKS) : chaque chantier a ses propres maillages (montrés ou cachés selon le tirage de la journée). */
function addWorks(scene) {
  if (!WORKS.length) return;
  const geos = workPropGeos();
  WORKS.forEach((Wk, i) => {
    const own = new Builder(), signs = new Signs();
    const chunks = { at: () => own }, details = chunks;
    const s = Wk.side, L = Wk.z0 - Wk.z1, zc = (Wk.z0 + Wk.z1) / 2, xm = s * (Wk.xIn + Wk.xOut) / 2;
    const xb = s * (Wk.outer ? Wk.xIn : Wk.xOut), xEdge = s * (Wk.outer ? ROAD_EDGE - 0.4 : MEDIAN + 0.4);
    const zStart = s > 0 ? Wk.z0 : Wk.z1, zEnd = s > 0 ? Wk.z1 : Wk.z0, dir = s > 0 ? -1 : 1;   // (dir : sens de la marche en z)
    Wk.props = [];
    Wk.solids = [];
    const addProp = (geo, kind, x0, z0, yaw0, r) => {
      const pm = new THREE.Mesh(geo, VC_MAT);
      pm.rotation.order = 'YXZ';
      pm.castShadow = pm.receiveShadow = true;
      place(pm, x0, z0, yaw0, roadH(z0));
      scene.add(pm);
      Wk.props.push({ mesh: pm, kind, x0, z0, yaw0, x: x0, z: z0, yaw: yaw0, vx: 0, vz: 0, vyaw: 0, tilt: 0, vtilt: 0, hit: false, fallSign: 1, r });
      return pm;
    };
    const propMeshes = [];
    // les barrières rouges et blanches légères le long des voies fermées, et en travers à la fin (dégageables si heurtées)
    let k = 0;
    for (let z = Wk.z1; z < Wk.z0; z += 2) {
      propMeshes.push(addProp(k++ % 2 ? geos.barW : geos.barR, 'bar', xb, z + 1, 0, 0.55));
    }
    for (let x = Math.min(xb, xEdge) + 1; x < Math.max(xb, xEdge); x += 2) {
      propMeshes.push(addProp(k++ % 2 ? geos.barW : geos.barR, 'bar', x, zEnd, Math.PI / 2, 0.55));
    }
    // le biseau de cônes orange, du bord jusqu'à la ligne des barrières (dégageables si heurtés)
    const nC = Math.ceil(Wk.taper / 2.5);
    for (let j = 0; j <= nC; j++) {
      const u = j / nC, x = xEdge + (xb - xEdge) * u, z = Wk.zt + (zStart - Wk.zt) * u;
      propMeshes.push(addProp(geos.cone, 'cone', x, z, 0, 0.28));
    }
    // les panneaux « TRAVAUX » avant le biseau, au bord de la chaussée, face à la circulation
    for (const [dz, title, sub] of [[70, '⚠ TRAVAUX', Wk.outer ? 'Voies de droite fermées' : 'Voies de gauche fermées'], [38, Wk.outer ? '⬉ SERREZ À GAUCHE' : '⬈ SERREZ À DROITE', 'Chantier · Réfection de la chaussée']]) {
      const zs = Wk.zt - dir * dz, xs = s * (ROAD_EDGE + 1.1), b = chunks.at(zs);
      b.box(0.12, 2.6, 0.12, 0x8e949a, xs - 1.4, 1.3, zs).box(0.12, 2.6, 0.12, 0x8e949a, xs + 1.4, 1.3, zs);
      signs.add(`works_${i}_${dz}`, () => signTexture(title, sub, '#f5c400', '#1a1a1a'), 3.6, 1.5, xs, 2.3, zs + (s > 0 ? 0.08 : -0.08), s > 0 ? 0 : Math.PI, true);
    }
    // dedans : la chaussée défoncée, la tranchée et sa terre, le sable, le gravier
    const b = chunks.at(zc);
    for (let z = Wk.z1 + 4; z < Wk.z0 - 4; z += 9) b.box((Wk.xOut - Wk.xIn) * 0.8, 0.025, 6, 0x2c2d30, xm, 0.022, z);
    const zTr0 = Wk.z1 + L * 0.12, zTr1 = Wk.z1 + L * 0.55;
    b.box(1.5, 0.035, zTr1 - zTr0, 0x2a1d14, xm, 0.03, (zTr0 + zTr1) / 2);
    for (let z = zTr0 + 1; z < zTr1; z += 1.8) details.at(z).ball(0.55, 0x7a5432, xm + s * 1.4, 0.18, z + rand(-0.4, 0.4), 1.2, 0.5, 1.4);
    b.add(new THREE.ConeGeometry(1.5, 1.1, 10), 0xd8b66e, xm - s * 1.0, 0.55, Wk.z1 + L * 0.82)
      .add(new THREE.ConeGeometry(1.2, 0.9, 10), 0x8a8d92, xm + s * 1.4, 0.45, Wk.z1 + L * 0.88);
    // la pelleteuse : le bras plonge dans la tranchée
    {
      const x = xm, z = Wk.z1 + L * 0.66, Y = 0xf2b705, D = 0x2a2b2e;
      Wk.solids.push({ x, z, hx: 1.4, hz: 2.4 });
      b.box(0.6, 0.65, 3.6, D, x - 1.05, 0.33, z).box(0.6, 0.65, 3.6, D, x + 1.05, 0.33, z).box(1.6, 0.35, 2.4, 0x3a3c40, x, 0.75, z)
        .box(2.5, 1.0, 2.8, Y, x, 1.45, z + 0.2).box(2.5, 0.8, 0.6, 0x2b2d31, x, 1.4, z + 1.75)
        .box(0.95, 1.2, 1.1, Y, x - 0.7, 2.5, z - 0.6).box(0.88, 0.62, 0.03, 0x1c2b3a, x - 0.7, 2.62, z - 1.17)
        .box(0.38, 0.42, 3.4, Y, x + 0.4, 2.9, z - 2.0, 0.55, 0, 0).box(0.32, 2.9, 0.32, Y, x + 0.4, 2.4, z - 3.8, 0.26, 0, 0)
        .box(0.95, 0.62, 0.72, 0x2b2d31, x + 0.4, 0.78, z - 4.25);
    }
    // le rouleau compresseur
    {
      const x = xm, z = Wk.z1 + L * 0.22, Y = 0xf2b705;
      Wk.solids.push({ x, z, hx: 1.15, hz: 2.0 });
      b.add(new THREE.CylinderGeometry(0.75, 0.75, 1.8, 14).rotateZ(Math.PI / 2), 0x7c8086, x, 0.75, z - 1.3)
        .box(2.0, 0.25, 0.42, Y, x, 1.55, z - 1.3).box(1.7, 1.1, 2.0, Y, x, 1.2, z + 0.6)
        .add(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 12).rotateZ(Math.PI / 2), 0x1c1d20, x - 0.9, 0.55, z + 1.0)
        .add(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 12).rotateZ(Math.PI / 2), 0x1c1d20, x + 0.9, 0.55, z + 1.0)
        .box(1.4, 0.08, 1.4, 0x2b2d31, x, 2.65, z + 0.4);
      for (const [px, pz] of [[-0.62, -0.2], [0.62, -0.2], [-0.62, 1.0], [0.62, 1.0]]) b.box(0.06, 0.95, 0.06, 0x2b2d31, x + px, 2.15, z + pz);
    }
    // le camion-benne garé au fond
    {
      const x = xm + s * 0.2, z = s > 0 ? Wk.z1 + 7 : Wk.z0 - 7, o = s > 0 ? -1 : 1;   // (cabine vers la sortie du chantier)
      Wk.solids.push({ x, z, hx: 1.3, hz: 3.5 });
      b.box(2.3, 1.9, 1.8, 0xd9480f, x, 1.55, z + o * 2.7).box(2.1, 0.7, 0.03, 0x1c2b3a, x, 1.95, z + o * 3.62)
        .box(2.4, 1.2, 4.2, 0xa0522d, x, 1.85, z - o * 0.5).box(2.2, 0.35, 6.6, 0x2b2d31, x, 0.75, z);
      for (const dz of [2.6, -0.9, -2.1]) for (const sx of [-1, 1]) b.add(new THREE.CylinderGeometry(0.5, 0.5, 0.36, 12).rotateZ(Math.PI / 2), 0x1c1d20, x + sx * 1.05, 0.5, z + o * dz);
    }
    const m = new THREE.Mesh(bendGeometry(raise(own.geometry())), VC_MAT);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    Wk.meshes = [m, ...propMeshes, ...signs.build(scene)];
    for (const q of Wk.meshes) q.visible = Wk.on;
  });
}

/** Allume les lampes des feux selon le temps du jeu (à chaque image). */
export function updateSignals(t) {
  if (!signalLenses) return;
  const st = signalState(t);
  for (const grp of ['main', 'street']) {
    for (const k of ['r', 'a', 'g']) {
      const m = signalLenses[grp][k];
      m.material = st[grp] === { r: 'red', a: 'amber', g: 'green' }[k] ? m.userData.on : m.userData.off;
    }
  }
}

/**
 * Grand panneau publicitaire avec une photo (deux faces) sur deux pieds, dans la bande au bord du boulevard :
 * face au taxi, la même image au dos pour l'autre sens. Passerelle d'entretien et projecteurs en bas du panneau.
 */
function addPhotoBoard(b, signs, p) {
  if (!p.image) return;
  const z = g(p.s), side = p.side, w = p.w ?? 9, h = w * p.image.height / p.image.width;
  const inLim = LIM && z <= Z16 + 6 && z >= Z_FORK - 6;
  const baseX = inLim ? PB_X + 7.5 : R.twoLane ? FRONT - 2.0 : ROAD_EDGE + 5.6;
  const x = side * (p.x ?? baseX) - (R.industrial && side < 0 ? PL_LEFT_X : 0);
  const totem = w < 5.2, y0 = p.y ?? (totem ? 3.6 : 5), yc = y0 + h / 2;
  if (totem) {
    b.box(0.56, yc, 0.56, 0x5d666e, x, yc / 2, z)
      .box(w + 0.56, h + 0.56, 0.28, 0xf5c400, x, yc, z)
      .box(w + 0.36, h + 0.36, 0.36, 0x1a1d24, x, yc, z);
  } else {
    for (const dx of [-w * 0.3, w * 0.3]) b.box(0.5, yc, 0.5, 0x5d666e, x + dx, yc / 2, z);              // pieds
    b.box(w + 0.5, h + 0.5, 0.35, 0x2a2e33, x, yc, z)                                                    // cadre
      .box(w + 0.6, 0.12, 1.3, 0x5d666e, x, y0 - 0.35, z + 0.55)                                        // passerelle d'entretien
      .box(w + 0.6, 0.6, 0.05, 0x5d666e, x, y0 + 0.05, z + 1.2);                                        // garde-corps
  }
  const nLights = totem ? 2 : 3;
  for (let k = 0; k < nLights; k++) b.box(0.35, 0.25, 0.45, 0xdedede, x + (k - (nLights - 1) / 2) * (w / nLights), y0 - 0.1, z + 0.95);   // projecteurs
  if (LAMPS) {                                                                                       // (la nuit : projecteurs allumés et tache de lumière sur le bas-côté, comme les lampadaires)
    for (let k = 0; k < nLights; k++) LAMPS.at(z).box(0.45, 0.14, 0.55, 0xffffff, x + (k - (nLights - 1) / 2) * (w / nLights), y0 - 0.1, z + 0.95);
    POOLS.at(z).add(new THREE.PlaneGeometry(w * 1.6, 14), 0xffffff, x - side * 2, 0.06, z + 0.6, -Math.PI / 2);
  }
  const tex = () => {
    const t = new THREE.Texture(p.image);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = MOBILE ? 2 : 8;
    t.needsUpdate = true;
    return t;
  };
  signs.add(`photo_${p.img}`, tex, w, h, x, yc, z + 0.2, 0, true);
  signs.add(`photo_${p.img}`, tex, w, h, x, yc, z - 0.2, Math.PI, true);
}

function addRoadSign(b, signs, key, title, sub, z, bg = '#1d6b3a') {
  b.box(0.25, 6.2, 0.25, 0x8e949a, ROAD_EDGE + 2.2, 3.1, z)
    .box(4.5, 0.2, 0.2, 0x8e949a, ROAD_EDGE + 0.2, 6, z);
  signs.add(key, () => signTexture(title, sub, bg), 6.5, 2, ROAD_EDGE - 0.6, 5.2, z + 0.15, 0, true);
}

function flagTexture() {
  // drapeau de la RDC : bleu ciel, bande diagonale rouge bordée de jaune, étoile jaune
  return canvasTexture(300, 200, (x, w, h) => {
    x.fillStyle = '#007fff'; x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.atan2(h, w));
    x.fillStyle = '#f7d618'; x.fillRect(-w, -34, 2 * w, 68);
    x.fillStyle = '#ce1021'; x.fillRect(-w, -24, 2 * w, 48);
    x.restore();
    x.fillStyle = '#f7d618'; x.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 14 : 34, a = -Math.PI / 2 + i * Math.PI / 5;
      x.lineTo(58 + Math.cos(a) * r, 50 + Math.sin(a) * r);
    }
    x.fill();
  });
}

function addFlag(b, signs, x, z, h = 9) {
  b.cyl(0.06, 0.08, h, 0xd8d8d8, x, h / 2, z);
  for (const ry of [0, Math.PI]) signs.add('flagRDC', flagTexture, 1.8, 1.2, x + 0.95 * Math.cos(ry), h - 0.7, z, ry);
}

/** Rue transversale : chaussée, passages piétons, feux, plaque de rue. */
function addCrossStreet(b, details, signs, z, name, key) {
  const w = 12;
  for (const s of [-1, 1]) b.box(GROUND_HALF - ROAD_EDGE, 0.03, w, 0x66676a, s * (ROAD_EDGE + GROUND_HALF) / 2, 0.02, z);
  for (const dz of [w / 2 + 2.5, -w / 2 - 2.5]) {
    for (let x = -ROAD_EDGE + 0.6; x < ROAD_EDGE - 0.3; x += 1.2) {
      if (Math.abs(x) < MEDIAN) continue;
      details.at(z + dz).box(0.6, 0.02, 3, 0xf2f2ee, x, 0.035, z + dz);   // zèbre
    }
  }
  for (const s of [-1, 1]) {
    const x = s * (ROAD_EDGE + 1), zz = z + w / 2 + 5.5;
    b.cyl(0.08, 0.1, 3.6, 0x2a2a2a, x, 1.8, zz)
      .box(0.35, 1, 0.3, 0x1a1a1a, x, 3.9, zz)
      .box(0.22, 0.22, 0.05, s > 0 ? 0x2bd45a : 0xd62828, x, 4.15, zz + 0.16);
  }
  signs.add(key, () => signTexture(name, null, '#1d4fa0'), 3.4, 0.7, ROAD_EDGE + 1.6, 2.8, z + w / 2 + 1.2, 0, true);
  b.box(0.1, 3.2, 0.1, 0x8e949a, ROAD_EDGE + 1.6, 1.6, z + w / 2 + 1.1);
}

/** Bâtiment administratif : long, 3-4 niveaux, façade à lamelles verticales, derrière une pelouse. */
function addAdmin(b, side, z, w) {
  const floors = 3 + Math.floor(Math.random() * 2), h = floors * 3.6, d = rand(16, 22);
  const set = rand(6, 12);
  const x = side * (FRONT + set + d / 2);
  const wall = pick([0xd2c29a, 0xcdb98f, 0xd8cba8, 0xc9b48a]);
  b.box(d, h, w, wall, x, h / 2, z)
    .box(d + 0.6, 0.5, w + 0.6, 0xbfae84, x, h + 0.25, z);
  const fx = side * (FRONT + set - 0.05);
  b.box(0.06, h - 2, w * 0.92, 0x34404c, fx, h / 2 + 0.6, z);               // vitrages sombres
  for (let k = -w / 2 + 0.8; k < w / 2 - 0.6; k += 1.3) b.box(0.45, h - 1.4, 0.22, wall, fx - side * 0.2, h / 2 + 0.3, z + k);   // lamelles
  b.box(set - 0.5, 0.05, w, 0x6f9a48, side * (FRONT + set / 2), 0.02, z);  // pelouse
}

/** Grille en fer sur muret le long des parcelles administratives. */
function addFence(chunks, details) {
  for (const [a, c] of solid(Z_START, Z_END, true)) {
    for (const [p, q] of pieces(a, c, 96)) {
      for (const s of [-1, 1]) {
        chunks.at((p + q) / 2).box(0.3, 0.6, p - q, 0xcfc6b0, s * (FRONT - 0.2), 0.3, (p + q) / 2)
          .box(0.06, 0.06, p - q, 0x2b2f33, s * (FRONT - 0.2), 2.0, (p + q) / 2);
      }
    }
    for (let z = a; z > c; z -= 0.6) for (const s of [-1, 1]) details.at(z).box(0.04, 1.4, 0.04, 0x2b2f33, s * (FRONT - 0.2), 1.3, z);
  }
}

/** Équipe du Service national : agents en bleu, cônes, brouette. */
function addWorkers(d, z) {
  for (let i = 0; i < 5; i++) {
    const o = outfit('man', { shirt: 0x1d4fa0, pants: 0x1d4fa0, cap: 0x1d4fa0, longSleeves: true, dress: false, basin: null, bag: null });
    bakeCharacter(d, o, 'idle', ROAD_EDGE + rand(1.5, 5), z + rand(-8, 8), rand(0, 6.28), Math.random() * 10, true);
  }
  for (let k = 0; k < 4; k++) d.add(new THREE.ConeGeometry(0.22, 0.6, 8), 0xff6a13, ROAD_EDGE + 0.9, 0.5, z - 10 + k * 6);
  d.box(0.6, 0.35, 1, 0x4a5a3a, ROAD_EDGE + 4, 0.55, z + 3).cyl(0.2, 0.2, 0.08, 0x1a1a1a, ROAD_EDGE + 4, 0.2, z + 2.4, 0, 0, Math.PI / 2);
}

function addPalais(b, signs, m) {
  const side = m.side, z = g(m.s), D = 32, H = 24, L = 165, ESP = 228;
  const x = side * (FRONT + 42 + D / 2), fx = x - side * D / 2;   // fx : façade côté boulevard (rapprochée pour être vue de la route)
  b.box(D, H, L, 0xe6e1d4, x, H / 2, z)                                        // corps
    .box(D + 6, 1.8, L + 6, 0xd9d3c3, x, H + 0.9, z)                           // grande dalle de toiture débordante
    .box(D - 6, 4, L * 0.55, 0xd2ccbc, x, H + 3.8, z)                          // attique
    .box(0.2, H - 3, L - 4, 0x55606b, fx - side * 0.1, (H - 3) / 2 + 1.5, z);  // murs vitrés en retrait
  // poteaux minces sur toute la hauteur (le motif qu'on reconnaît de loin), plus serrés au centre
  for (let k = -L / 2 + 1; k <= L / 2 - 1; k += Math.abs(k) < 22 ? 1.6 : 3.2) {
    b.box(1.2, H, 0.55, 0xf4f1ea, fx - side * 1.6, H / 2, z + k);
  }
  for (const f of [1, 2, 3]) b.box(1.4, 0.35, L, 0xd9d3c3, fx - side * 0.9, f * H / 4, z);   // nez de dalle
  // panneaux colorés de la rénovation, derrière les poteaux de la partie centrale (palais du peuple1.jfif)
  const COLS = [0xd23f36, 0x1d6fd1, 0xe0a100, 0x2b8a3e];
  for (let k = -24; k <= 24; k += 1.6) b.box(0.12, H * 0.68, 1.25, COLS[Math.floor((k + 24) / 1.6) % 4], fx - side * 0.25, H * 0.46, z + k);
  // grand escalier, vaste esplanade pavée beige dès la route des Huileries (v9_17s.jpg), pelouses et fontaine ronde
  b.box(10, 1.2, 64, 0xece8de, fx - side * 5, 0.6, z)
    .box(42, 0.06, ESP, 0xd8cdb8, side * (FRONT + 21), 0.03, z);
  for (const dz of [-L / 3, L / 3]) b.box(26, 0.1, 34, 0x6f8f3e, side * (FRONT + 24), 0.05, z + dz);
  // Jardinières géométriques colorées alignées le long du boulevard (exactement comme sur palais du peuple1.jfif)
  for (let k = -L * 0.45; k <= L * 0.45; k += 11) {
    const jx = side * (FRONT + 3.2), jz = z + k;
    b.box(1.6, 0.55, 4.2, 0x1d6fd1, jx, 0.28, jz);
    for (let c = 0; c < 4; c++) {
      b.box(1.64, 0.50, 0.9, COLS[c], jx, 0.28, jz - 1.35 + c * 0.9);
    }
    b.ball(0.75, 0x3b8a3e, jx, 0.72, jz, 1, 0.6, 2.2);
  }
  // Lampadaires blancs à globes sur l'esplanade
  for (let k = -L * 0.4; k <= L * 0.4; k += 22) {
    const lx = side * (FRONT + 8), lz = z + k;
    b.cyl(0.08, 0.11, 7.5, 0xf2f2ee, lx, 3.75, lz).ball(0.32, 0xffffff, lx, 7.7, lz);
  }
  const fcx = side * (FRONT + 22);
  b.add(new THREE.CylinderGeometry(10, 10.5, 0.8, 24), 0xe8e4da, fcx, 0.4, z)
    .add(new THREE.CylinderGeometry(9.2, 9.2, 0.1, 24), 0x6fb1c9, fcx, 0.75, z)
    .add(new THREE.CylinderGeometry(0.5, 1.6, 4, 10), 0xeaf6fb, fcx, 2.6, z);
  for (const k of [-30, -10, 10, 30]) addFlag(b, signs, side * (FRONT + 12), z + k, 14);
  // Mât monumental géant du drapeau de la RDC sur l'esplanade du Palais du Peuple (vidéos v3_t1013s et v4_t8s)
  b.box(2.8, 0.9, 2.8, 0xe8e4da, side * (FRONT + 15), 0.45, z - 22)
    .cyl(0.18, 0.32, 28, 0xf4f4f0, side * (FRONT + 15), 14, z - 22);
  for (const ry of [0, Math.PI]) {
    signs.add('flagRDC', flagTexture, 5.2, 3.4, side * (FRONT + 15) + 2.65 * Math.cos(ry), 26.0, z - 22, ry);
  }
  // Bâtiment ministériel classique jaune-ocre à colonnades (au fond de l'esplanade du Palais du Peuple, vu dans v4_t8s et v3_t775s)
  const mx = side * (FRONT + 48), mz = z - L / 2 - 48;
  b.box(24, 15, 58, 0xd8c383, mx, 7.5, mz)
    .box(25, 1.1, 60, 0xc2ab6b, mx, 15.5, mz)
    .box(0.4, 12.5, 52, 0x2c3844, mx - side * 12.05, 7.0, mz);
  for (let k = -24; k <= 24; k += 3.2) {
    b.box(0.9, 14.5, 0.65, 0xede2be, mx - side * 12.3, 7.25, mz + k);
  }
  // Tribune Officielle couverte juste en face du Palais du Peuple de l'autre côté du Boulevard Triomphal (vue aérienne v4_t8s.jpg)
  // (pas sur le prolongement du boulevard Lumumba : le Centre culturel occupe l'autre côté)
  const tx = -side * (FRONT + 8.5);
  if (!m.noTribune) b.box(9.5, 1.6, 86, 0xd8d2c4, tx, 0.8, z)
    .box(6.5, 3.8, 84, 0xc9c2b2, tx - side * 1.4, 2.7, z)
    .box(12.2, 0.45, 90, 0x3b4d63, tx, 6.8, z, 0, 0, -side * 0.08);
  for (let k = -40; k <= 40; k += 8) {
    if (!m.noTribune) b.cyl(0.18, 0.22, 5.8, 0x8e949a, tx + side * 3.8, 3.7, z + k);
  }
  signs.add('palais', () => signTexture(m.name, 'Assemblée nationale · Sénat', '#7a5c1e'), 12, 2.2, side * (FRONT - 0.5), 3.4, z + 40, -side * Math.PI / 2, true);
  b.box(0.4, 4.6, 0.4, 0xcfc6b0, side * (FRONT - 0.5), 2.3, z + 33.6).box(0.4, 4.6, 0.4, 0xcfc6b0, side * (FRONT - 0.5), 2.3, z + 46.4);
}

function addStadium(b, signs, m) {
  // Stade des Martyrs de la Pentecôte (d'après stade de martyre.jfif) :
  // grande couronne supérieure ocre-doré nervurée en porte-à-faux soutenue par des paires de piliers
  // inclinés en V, coursives sombres à banderoles rouges/oranges, 4 hauts mâts d'éclairage, et long
  // mur-enseigne ocre au bord du boulevard : « COMPLEXE OMNISPORTS STADE DES MARTYRS ».
  const side = m.side, z = g(m.s), cx = side * (FRONT + 106), A = 92, B = 78, N = 44;
  const per = 2 * Math.PI * Math.sqrt((A * A + B * B) / 2) / N;
  const ochre = 0xc89d54, ochreDark = 0xa87e3b, concrete = 0xcfc6b2;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    const ry = Math.atan2(-B * c, -A * sn);            // axe x local le long de la façade
    const at = (k, y) => [cx + (A + k) * c, y, z + (B + k * B / A) * sn];
    // Gradins inférieurs, coursives sombres à étages, couronne supérieure ocre-doré nervurée en porte-à-faux
    b.box(per + 0.6, 9, 6, concrete, ...at(-6, 4.5), 0, ry, 0)
      .box(per + 0.6, 5.5, 4.5, 0x262523, ...at(-4.5, 11.5), 0, ry, 0)
      .box(per + 0.5, 0.9, 5.2, concrete, ...at(-2.5, 9.2), 0, ry, 0)
      .box(per + 0.5, 0.9, 5.8, concrete, ...at(-1.8, 13.8), 0, ry, 0)
      .box(per + 0.6, 11.5, 9.2, ochre, ...at(0, 20.5), 0, ry, 0)
      .box(per + 0.6, 1.4, 9.6, ochreDark, ...at(0.2, 15.2), 0, ry, 0);
    // Nervures verticales sur la couronne ocre
    for (const dx of [-per * 0.25, per * 0.25]) {
      b.box(0.32, 11.6, 0.75, ochreDark, cx + (A + 4.5) * c - sn * dx, 20.5, z + (B + 4.5 * B / A) * sn + c * dx, 0, ry, 0);
    }
    // Piliers inclinés en V caractéristiques sous la couronne (stade de martyre.jfif)
    b.box(1.15, 16.5, 1.3, concrete, ...at(2.0, 7.8), 0, ry, 0.30)
      .box(1.15, 16.5, 1.3, concrete, ...at(2.0, 7.8), 0, ry, -0.30);
    // Banderoles rouges/oranges sur le balcon intermédiaire côté boulevard
    if (i % 3 === 0) b.box(per * 0.85, 1.3, 0.3, i % 6 === 0 ? 0xd9480f : 0x1d4fa0, ...at(2.6, 9.8), 0, ry, 0);
  }
  b.add(new THREE.CylinderGeometry(1, 1, 0.2, 32).scale(A - 26, 1, B - 26), 0x3f8a3a, cx, 0.1, z);
  b.add(new THREE.CylinderGeometry(1, 1, 0.1, 32).scale(A - 14, 1, B - 14), 0xb0402e, cx, 0.05, z);
  // Grands mâts d'éclairage blancs devant la façade
  for (const [dx, dz] of [[-A, -B], [A, -B], [-A, B], [A, B]]) {
    b.box(1.2, 48, 1.2, 0xd8dce0, cx + dx * 0.82, 24, z + dz * 0.82)
      .box(7.5, 3.8, 1.2, 0xf4f4f0, cx + dx * 0.82, 48, z + dz * 0.82);
  }
  // Mur-enseigne bas ocre le long du boulevard avec lettres rouges « COMPLEXE OMNISPORTS STADE DES MARTYRS » (stade de martyre.jfif)
  const wx = side * (FRONT + 3.5);
  b.box(1.2, 2.4, 76, 0xd9b36c, wx, 1.2, z)
    .box(1.3, 2.4, 4.5, 0x1d6fd1, wx, 1.2, z + 36)
    .box(4.5, 0.25, 82, 0x5c8a38, wx - side * 2.2, 0.12, z); // pelouse devant le mur
  signs.add('stade_wall', () => signTexture('COMPLEXE OMNISPORTS STADE DES MARTYRS', null, '#d9b36c', '#b81414'),
    66, 2.1, wx - side * 0.65, 1.25, z - 2, -side * Math.PI / 2, true);
  signs.add('stade', () => signTexture('STADE DES MARTYRS', 'Complexe Omnisports de la Pentecôte', '#1d4fa0'),
    20, 3.0, cx - side * (A + 4.8), 21.5, z + 28, -side * Math.PI / 2, true);
}

/**
 * Centre culturel et artistique pour les pays d'Afrique centrale (vidéo « Kinshasa change de visage ») :
 * grand bâtiment arrondi couleur bronze, rythmé de fines lames verticales, bandeau vitré sombre,
 * attique en retrait, podium et larges escaliers face au boulevard, petits palmiers en pots.
 */
function addCulture(b, signs, m) {
  const side = m.side, z = g(m.s), A = 30, B = 92, H = 24;            // demi-axes (travers, le long) et hauteur
  const cx = side * (FRONT + 16 + A);
  const bronze = 0xa27c4c, light = 0xbf975f, dark = 0x3a2d24;
  const ring = (r, h, col, y) => b.add(new THREE.CylinderGeometry(1, 1, h, 56).scale(A + r, 1, B + r), col, cx, y, z);
  ring(0, H, bronze, H / 2);                       // corps
  ring(0.25, 4.2, dark, 15.6);                     // bandeau vitré
  ring(0.25, 3.2, dark, 4.2);                      // rez-de-chaussée vitré
  ring(0.5, 1.1, light, H + 0.55);                 // corniche
  ring(-7, 3.5, light, H + 2.8);                   // attique en retrait
  // fines lames verticales sur toute la hauteur (seulement côté boulevard : l'arrière ne se voit pas)
  for (let i = 0; i < 160; i++) {
    const t = (i + 0.5) / 160 * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    if (c * side > 0.35) continue;
    const ry = Math.atan2(-B * c, -A * sn);         // axe x local le long de la façade
    b.box(0.3, H - 2, 1.1, light, cx + (A + 0.55) * c, H / 2 + 0.5, z + (B + 0.55) * sn, 0, ry, 0);
  }
  // podium, larges escaliers, jardinières avec petits palmiers
  const front = side * (FRONT + 16);
  b.box(10, 1.8, 70, 0xd8d2c6, front - side * 1, 0.9, z);
  for (let k = 0; k < 6; k++) b.box(1.1, 0.3 * (k + 1), 46, 0xe4dfd4, side * (FRONT + 4.5 + k * 1.1), 0.15 * (k + 1), z);
  for (const dz of [-30, -12, 12, 30]) {
    b.box(2.2, 0.6, 2.2, 0xd8d2c6, side * (FRONT + 2.2), 0.3, z + dz)
      .cyl(0.12, 0.16, 1.6, 0x7a5a3a, side * (FRONT + 2.2), 1.4, z + dz);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      b.box(0.35, 0.05, 1.3, 0x3b7d34, side * (FRONT + 2.2) + Math.sin(a) * 0.6, 2.2, z + dz + Math.cos(a) * 0.6, 0.5, a, 0);
    }
  }
  // garde-corps blanc le long du trottoir
  b.box(0.08, 0.08, B * 1.6, 0xf2f2ee, side * (FRONT - 0.6), 1.0, z);
  for (let k = -B * 0.8; k <= B * 0.8; k += 2) b.box(0.06, 1, 0.06, 0xf2f2ee, side * (FRONT - 0.6), 0.5, z + k);
  signs.add('culture', () => signTexture('CENTRE CULTUREL', 'et artistique pour les pays d\'Afrique centrale', '#5a4126'), 16, 1.8, side * (FRONT + 15.2), 3.2, z, -side * Math.PI / 2, true);
}

/** Long mur de clôture blanc (parcelles officielles, résidences), avec grands arbres derrière. */
function addWhiteWall(b, side, z, w) {
  const x = side * (FRONT - 0.2);
  b.box(0.35, 2.8, w, 0xf1efe8, x, 1.4, z).box(0.45, 0.15, w, 0xd9d6cc, x, 2.85, z);
  for (let k = -w / 2; k <= w / 2; k += 3.5) b.box(0.5, 3, 0.5, 0xe6e3da, x, 1.5, z + k);   // piliers
  if (chance(0.35)) addMango(b, side * (FRONT + rand(18, 28)), z + rand(-w / 3, w / 3), rand(1.3, 1.8));   // loin derrière le mur
}

/** Immeuble moderne ou tour : de plus en plus haut en approchant du centre (t de 0 à 1). */
function addHighrise(b, signs, side, z, w, t) {
  const tower = chance(0.12 + 0.3 * t);
  const floors = tower ? Math.round(rand(14, 18 + 8 * t)) : Math.round(rand(3, 6 + 5 * t));
  const fh = 3.3, h = floors * fh, d = tower ? Math.min(w, rand(16, 22)) : rand(12, 18);
  const ww = tower ? Math.min(w, rand(16, 24)) : w;
  const x = side * (FRONT + 2 + d / 2);
  const wall = tower ? pick([0xcab79a, 0xd8d2c4, 0xb9a98c, 0xe9e7e2]) : pick([0xeeeeec, 0x8e949a, 0xd9d4c8, 0xc8102e, 0xe6c35c, 0x5f6b77]);
  b.box(d, h, ww, wall, x, h / 2, z);
  // bandes de fenêtres sur la façade côté boulevard (une sur deux pour les tours, pour rester léger)
  const fx = side * (FRONT + 2 - 0.04);
  for (let f = 1; f < floors; f += tower ? 2 : 1) b.box(0.06, 1.2, ww * 0.86, 0x2c3a48, fx, f * fh + 0.4, z);
  b.box(0.08, 3.2, ww * 0.9, 0x1f2a33, fx, 1.6, z);                       // rez-de-chaussée vitré
  b.box(d + 0.4, 0.6, ww + 0.4, 0x9a958a, x, h + 0.3, z);
  if (tower) b.box(2, 4, 2, 0xb0aba0, x, h + 2.6, z).cyl(0.08, 0.1, 8, 0x9aa0a6, x + 2, h + 4, z + 2);   // édicule et antenne
  if (chance(0.7)) {
    const s = Math.floor(Math.random() * SHOP_SIGNS.length);
    const [tt, sub, bg, fg] = SHOP_SIGNS[s];
    signs.add(`shop${s}`, () => signTexture(tt, sub, bg, fg, true), Math.min(ww * 0.8, 7), 1.2, side * (FRONT + 2 - 0.12), 3.8, z, -side * Math.PI / 2);
  }
  if (false && !tower && chance(0.15)) {   // panneau publicitaire sur le toit (l'auteur, 26/11 : tous les panneaux génériques sont retirés)
    const k = Math.floor(Math.random() * BILLBOARDS.length);
    const [tt, sub, bg, fg] = BILLBOARDS[k];
    b.box(0.2, 2, 0.2, 0x6c7680, x, h + 1.6, z - 3).box(0.2, 2, 0.2, 0x6c7680, x, h + 1.6, z + 3);
    signs.add(`bb${k}`, () => signTexture(tt, sub, bg, fg), 8, 2.6, x - side * 0.2, h + 3.6, z, -side * Math.PI / 2);
  }
}

/**
 * Place de la Gare & Gare Centrale de Kinshasa — état actuel (l'auteur, 22/11, vidéos « place gard », « plade degard » et « actuel ») : le boulevard du 30 Juin
 * débouche sur une vaste esplanade de terre et gravier gris (kiosques rouges et blancs, parasols, tas de terre, garde-corps rouges et blancs), fermée dans l'axe par
 * le monument aux deux hauts piliers de pierre, avec l'hôtel ocre et un immeuble blanc au fond (l'ancien bassin et les lions n'existent plus) ; la gare (petit bâtiment à façade orange, tour blanche carrelée, « KINSHASA-EST · GARE CENTRALE »,
 * Rawbank) est sur le CÔTÉ GAUCHE de la place, de l'autre côté de la rue, et ne ferme pas la perspective.
 */
function addGare(b, signs, m) {
  const z = g(m.s), TILE = 0xd8b9a2, TILE2 = 0xc9a58c, RIM = 0x7a3f2e, STONE = 0xb39a80;
  // 1. Esplanade de terre et gravier gris, sans marquage (vidéos « place gard » et « actuel », 22/11) ; bordure rouge et blanche côté boulevard
  b.box(96, 0.06, 200, 0xa3a099, 4, 0.03, z - 98);
  for (let dx = -46, k = 0; dx < 52; dx += 1.6, k++) b.box(1.6, 0.14, 0.9, k % 2 ? 0xf2f2f0 : 0xc42b22, dx + 0.8, 0.07, z + 1.2);
  for (const [tx, tz, tl] of [[-12, -22, 18], [8, -30, 14], [20, -12, 12], [-30, -40, 16]]) b.box(tl, 0.02, 0.5, 0x7e7a72, tx, 0.07, z + tz, 0, rand(-0.5, 0.5), 0);   // traces de pneus
  // 2. Garde-corps rouges et blancs le long de la place (00:01:05, 00:02:28)
  for (let dx = -42; dx <= 50; dx += 3.2) {
    if (Math.abs(dx) < 5 || (ATTACHED && dx > -8 && dx < 24)) continue;   // passage piéton dans l'axe ; (trajets attachés) la Route Poids Lourds
    b.box(0.18, 1.2, 0.18, 0x8e1b2a, dx, 0.6, z + 0.8).box(2.9, 0.9, 0.06, 0xf4f4f2, dx + 1.6, 0.6, z + 0.8);
  }
  // 3. Sur l'esplanade : kiosques rouges et blancs, parasols de couleur, tas de terre, lampadaires (état actuel)
  for (const [kx, kz] of [[-24, -16], [-17, -21], [-30, -27], [14, -22]]) {
    b.box(2.4, 2.4, 2.4, 0xf4f4f2, kx, 1.2, z + kz).box(2.5, 0.7, 2.5, 0xc42b22, kx, 2.0, z + kz).box(3.0, 0.2, 3.0, 0xa83222, kx, 2.65, z + kz)
      .box(1.2, 1.0, 0.1, 0x3a4650, kx, 1.3, z + kz + 1.23);
  }
  for (const [px, pz, pc] of [[-20, -18, 0xe8a317], [-27, -22, 0xc42b22], [-14, -25, 0x2b8a3e], [12, -26, 0x1d4fa0], [-22, -30, 0xe8a317]]) {
    b.cyl(0.04, 0.05, 2.6, 0x8a8f94, px, 1.3, z + pz).cyl(0.06, 1.7, 0.55, pc, px, 2.75, z + pz, 0, 0, 0, 8);
  }
  for (const [mx, mz, mw] of [[-8, -14, 7], [24, -34, 9], [-36, -34, 6]]) b.box(mw, 0.6, mw * 0.55, 0x8d6a45, mx, 0.3, z + mz, 0, rand(0, 1), 0).box(mw * 0.6, 0.9, mw * 0.35, 0x7d5c3a, mx, 0.55, z + mz, 0, rand(0, 1), 0);
  for (const [lx, lz] of [[-26, -12], [30, -12], [-4, -46], [12, -52]]) {
    b.cyl(0.1, 0.14, 9, 0x5b6168, lx, 4.5, z + lz);
    lampHead(lx, 9.1, z + lz);
  }
  // le panneau « Canadian Pure » (au fond à droite) et un deuxième panneau noir sur deux poteaux
  b.cyl(0.18, 0.2, 9, 0x6b7076, 31, 4.5, z - 26).cyl(0.18, 0.2, 9, 0x6b7076, 35, 4.5, z - 26);
  signs.add('gare_canadian', () => signTexture('CANADIAN PURE', 'Le leader de l\'eau minérale', '#1e6bb8', '#ffffff'), 7, 9, 33, 8.2, z - 25.8, 0, true);
  // 4b. Le fond de la place, à droite : hôtel ocre à balcons et bout arrondi (00:03:30, 00:07:00) ; à gauche : immeuble blanc à bandeaux vitrés R+7
  b.box(34, 18, 16, 0xc9a45a, 24, 9, z - 186);
  for (let fy = 3.4; fy < 18; fy += 3.4) b.box(34.4, 0.45, 17.5, 0x8d6e35, 24, fy, z - 185.2).box(34.2, 1.3, 0.08, 0x3a3326, 24, fy - 1.6, z - 178.1);
  b.cyl(8, 8, 18, 0xd2b062, 41, 9, z - 186, 0, 0, 0, 20).cyl(8.4, 8.4, 0.6, 0x8d6e35, 41, 18.2, z - 186, 0, 0, 0, 20);
  b.box(26, 24, 30, 0xe9ebe8, -46, 12, z - 180);
  for (let fy = 3; fy < 24; fy += 3.2) b.box(26.3, 1.1, 30.3, 0x3a4650, -46, fy, z - 180);
  signs.add('gare_hotel', () => signTexture('HÔTEL', 'Place de la Gare Centrale', '#8d6e35', '#ffffff'), 8, 1.4, 24, 16.5, z - 177.9, 0, true);
  // 4. Monument aux deux hauts piliers de pierre fermant l'axe du boulevard, sur un socle à gradins (00:00:30, 00:07:00)
  const mz = z - 70, PH = 24;
  b.box(22, 1.2, 12, STONE, 0, 0.6, mz).box(18, 1.2, 9, 0xa68d73, 0, 1.8, mz);
  for (const s of [-1, 1]) {
    b.box(4.6, PH, 4.6, STONE, s * 4.4, 2.4 + PH / 2, mz);
    for (const g2 of [-1.2, 0, 1.2]) b.box(0.25, PH - 2, 0.2, 0x8d765f, s * 4.4 + g2, 2.4 + PH / 2, mz + 2.35);   // rainures
    b.box(5.2, 0.6, 5.2, 0x8d765f, s * 4.4, 2.4 + PH + 0.3, mz);
  }
  b.box(15, 0.5, 0.5, 0x9aa0a6, 0, 2.4 + PH + 1.2, mz);                // cadre métallique entre les piliers
  for (const fx of [-16, -12, 12, 16]) addFlag(b, signs, fx, mz + 6, 13);
  for (const fx of [-26, 30]) b.cyl(0.25, 0.35, 22, 0xe8e8e8, fx, 11, z - 12);   // grands mâts d'éclairage blancs
  for (const [px, pz] of [[-20, z - 58], [22, z - 60], [-30, z - 84], [34, z - 82]]) addPalm(b, px, pz, 1.2);
  // 5. Gare Centrale, sur le côté gauche de la place, façade tournée vers la place (00:02:28)
  const gx = -(FRONT + 30), gz = z - 40, ORANGE = 0xd8643a;
  b.box(12, 10, 30, ORANGE, gx, 5, gz)                                // corps à façade orange
    .box(12.6, 0.6, 30.6, 0x6b3a26, gx, 10.3, gz)
    .box(10, 6.5, 12, 0xeceeee, gx, 3.25, gz + 21)                     // ailes basses blanches
    .box(10, 6.5, 12, 0xeceeee, gx, 3.25, gz - 21)
    .box(7, 22, 7, 0xf1f3f4, gx + 1, 11, gz + 14)                      // tour blanche carrelée
    .box(5, 4.5, 6, 0x1b1b1b, gx + 1, 24.2, gz + 14)                   // écran noir en haut de la tour
    .box(2, 3.2, 26, 0x5a2a1c, gx + 5.2, 1.6, gz);                     // rez-de-chaussée : boutiques et guichets
  for (let dz = -12; dz <= 12; dz += 3.2) b.box(0.4, 3.4, 0.4, 0xb52b2b, gx + 6.3, 1.7, gz + dz);   // piliers rouges
  for (let fy = 1.2; fy < 22; fy += 1.4) b.box(0.05, 0.05, 7.05, 0xd5d9dc, gx + 4.55, fy, gz + 14);  // joints du carrelage
  signs.add('gare_kin_est', () => signTexture('KINSHASA - EST', '', '#9aa0a6', '#f4f4f2', true),
    14, 1.6, gx + 1, 11.6, gz, Math.PI / 2, true);
  signs.add('gare_front', () => signTexture(m.name ?? 'GARE CENTRALE', 'ONATRA · SCTP · Place de la Gare', '#1d4fa0', '#ffffff'),
    18, 4.6, gx + 6.08, 6.6, gz, Math.PI / 2, true);
  signs.add('gare_rawbank', () => signTexture('RAWBANK', 'Agence · Gare Centrale', '#f4f4f2', '#1a1a1a'),
    6, 1.3, gx + 6.1, 3.7, gz + 2, Math.PI / 2, true);
  b.box(0.2, 0.2, 40, 0xc9ccd0, gx + 7, 0.1, gz);                       // bordure de la rue devant la gare
  // 6. Immeubles bordant la place à droite : grand immeuble inachevé couvert de panneaux publicitaires (00:00:40, 00:08:30)
  // (trajet attaché : reculé sur le même côté de la place, la Route Poids Lourds arrive par là)
  const ix = FRONT + 26 + (ATTACHED ? 3 : 0), iz = z - 36 - (ATTACHED ? 80 : 0), ax = ix - 11.2;
  b.box(22, 20, 44, 0x9a9590, ix, 10, iz);
  for (let fy = 4; fy < 20; fy += 3.6) b.box(22.4, 0.5, 44.4, 0x7e7a75, ix, fy, iz);
  signs.add('gare_pub1', () => signTexture('FAMECO', 'Votre partenaire en acier', '#c8102e', '#ffffff'), 14, 7, ax, 11, iz + 10, -Math.PI / 2, true);
  signs.add('gare_pub2', () => signTexture('SKOL', 'Esili nanu te…', '#f2c230', '#8b1d24'), 9, 7, ax, 11, iz - 4, -Math.PI / 2, true);
  signs.add('gare_pub3', () => signTexture('ALOE VERA', 'Iveco · Yamaha · Isuzu', '#3d8b37', '#ffffff'), 12, 7, ax, 11, iz - 16, -Math.PI / 2, true);
  addGareWheel(b, signs, z);   // la Grande Roue et son parc, derrière le monument
}

// ---------- Bâtiments emblématiques de Kintambo Magasin au Boulevard du 30 Juin (vidéo Boulevard du 30juin.wmv) ----------

/** 1. Rond-point Kintambo Magasin (vidéo 01:14–03:18) : immeuble vitré arrondi au coin droit, immeuble blanc R+4 à gauche. */
function addB30Kintambo(b, details, signs, side, z, p) {
  const xR = FRONT + 9, xL = -(FRONT + 10);
  // Coin droit : immeuble commercial cylindrique à mur-rideau bleu-gris réfléchissant et soubassement brique (01:14)
  b.cyl(9.5, 9.5, 16, 0x2c4c66, xR, 9.5, z + 6, 0, 0, 0, 20)
    .cyl(9.8, 9.8, 3.6, 0x8e3b2e, xR, 1.8, z + 6, 0, 0, 0, 20)
    .cyl(9.9, 9.9, 0.5, 0xd8d4cc, xR, 17.6, z + 6, 0, 0, 0, 20);
  for (let y = 5.5; y <= 15.5; y += 3.2) b.cyl(9.62, 9.62, 0.22, 0x5c6873, xR, y, z + 6, 0, 0, 0, 20);
  // Côté gauche : grand immeuble moderne blanc et gris anthracite R+4 derrière la station Cobil (02:00)
  b.box(16, 17, 28, 0xf2f2ee, xL - 8, 8.5, z - 12)
    .box(16.4, 3.4, 28.4, 0x383e46, xL - 8, 15.2, z - 12);
  for (let fy = 3.5; fy <= 11.5; fy += 3.2) b.box(0.2, 1.3, 24, 0x24303c, xL + 0.05, fy, z - 12);
  signs.add('b30_kintambo_sign', () => signTexture('ROND-POINT KINTAMBO MAGASIN', 'Kintambo · Ngaliema · Av. Colonel Mondjiba', '#1d4fa0', '#ffffff'),
    12, 1.6, xR - 9.6, 4.4, z + 6, -Math.PI / 2, true);
  for (let i = 0; i < 12; i++) addPerson(details.at(z), (i % 2 ? 1 : -1) * (ROAD_EDGE + rand(1.5, 6)), z + rand(-18, 18));
}

/** 2. École Rév. Kim (vidéo 04:32) : mur blanc avec grand lettrage « ECOLE Rév. Kim », double portail bleu à 2 écussons, bâtiment brique/bleu. */
function addB30RevKim(b, signs, side, z, p) {
  const wx = side * (FRONT - 0.15), bx = side * (FRONT + 11);
  b.box(0.35, 3.0, 34, 0xf2efe8, wx, 1.5, z)
    .box(0.45, 0.25, 34.4, 0x7c7870, wx, 3.05, z)
    .box(0.42, 2.8, 6.4, 0x264178, wx - side * 0.04, 1.4, z + 6)                 // grand portail bleu
    .cyl(0.65, 0.65, 0.12, 0xd8dce2, wx - side * 0.22, 1.7, z + 4.5, 0, 0, Math.PI / 2, 16)
    .cyl(0.65, 0.65, 0.12, 0xd8dce2, wx - side * 0.22, 1.7, z + 7.5, 0, 0, Math.PI / 2, 16)
    .box(15, 11.5, 28, 0xb87348, bx, 5.75, z - 2)                                 // bâtiment brique ocre
    .box(4.5, 12.2, 7.5, 0x1e4d94, bx - side * 5.5, 6.1, z - 2);                  // travée vitrée bleue
  signs.add('b30_rev_kim', () => signTexture('ECOLE Rév. Kim', 'Complexe Scolaire · Mondjiba', '#f2efe8', '#9e1b1b'),
    12, 1.5, wx - side * 0.22, 2.1, z - 4, -side * Math.PI / 2, true);
}

/** 3. Fresque murale marine bleue sur l'avenue Colonel Mondjiba (vidéo 04:18). */
function addB30Mural(b, signs, side, z) {
  const wx = side * (FRONT - 0.15);
  b.box(0.35, 2.9, 36, 0xf4f2ec, wx, 1.45, z)
    .box(0.42, 1.8, 30, 0x2b6cb0, wx - side * 0.04, 1.5, z)
    .box(0.44, 0.45, 30, 0xc29b61, wx - side * 0.05, 0.75, z);
  for (let dz = -11; dz <= 11; dz += 5.5) {
    b.ball(0.45, pick([0xf5c400, 0xff7f11, 0x1a202c, 0xffffff]), wx - side * 0.22, 1.65, z + dz, 0.3, 0.7, 1.5);
  }
}

/** 4. GGmart Hypermarket (vidéo 06:36) : long bâtiment commercial vitré gris anthracite à résille et grand panneau GGmart. */
function addB30Ggmart(b, signs, side, z, p) {
  const x = side * (FRONT + 14), fx = side * (FRONT + 4);
  b.box(20, 8.5, 42, 0x222831, x, 4.25, z)
    .box(20.6, 0.6, 42.6, 0x8e959e, x, 8.6, z)
    .box(0.25, 6.8, 39, 0x34495e, fx, 4.2, z);
  for (let dz = -18; dz <= 18; dz += 3) b.box(0.32, 7.2, 0.18, 0x9aa0a6, fx - side * 0.08, 4.2, z + dz);
  // Clôture métallique noire et grand panneau vertical GGmart au coin droit
  b.box(0.15, 1.8, 42, 0x1a1a1a, side * (FRONT - 0.2), 0.9, z);
  const px = side * (FRONT + 1.5), pz = z - 18;
  b.cyl(0.22, 0.28, 12, 0x2b2f33, px, 6, pz);
  signs.add('b30_ggmart', () => signTexture('GGmart', 'Hypermarket · Électroménager & Supermarché', '#ffffff', '#e65100'),
    4.6, 6.4, px, 9.2, pz + 0.25, 0, true);
  signs.add('b30_ggmart_f', () => signTexture('GGmart HYPERMARKET', 'Avenue Colonel Mondjiba', '#222831', '#00a8e8'),
    14, 1.6, fx - side * 0.18, 7.4, z, -side * Math.PI / 2, true);
}

/** 5. JAC Motors / JETO Showroom (vidéo 08:15) : concessionnaire automobile gris anthracite avec enseignes JAC et JETO. */
function addB30Jac(b, signs, side, z, p) {
  const x = side * (FRONT + 11), fx = side * (FRONT + 2);
  b.box(18, 8.2, 38, 0x2f353d, x, 4.1, z)
    .box(18.6, 1.4, 38.6, 0x1e2329, x, 7.6, z)
    .box(0.2, 5.2, 34, 0x7fa6c4, fx, 2.8, z);
  for (let dz = -15; dz <= 15; dz += 6) b.box(0.45, 7.8, 0.55, 0x454d57, fx - side * 0.1, 3.9, z + dz);
  signs.add('b30_jac', () => signTexture('JAC MOTORS · JETO', 'Showroom & Service Center', '#1e2329', '#ffffff'),
    18, 1.3, fx - side * 0.22, 7.6, z, -side * Math.PI / 2, true);
}

/** 6. Immeuble R+8 à R+12 en chantier (béton brut ou filet vert de sécurité + grue, vidéos 07:51, 16:06, 17:54). */
function addB30Chantier(b, side, z, p) {
  const floors = p.floors ?? 10, fh = 3.2, H = floors * fh, W = 22, D = 16;
  const x = side * (FRONT + 3 + D / 2);
  for (let f = 0; f <= floors; f++) b.box(D, 0.35, W, 0x9e998e, x, f * fh, z);
  for (const dx of [-D * 0.38, 0, D * 0.38]) {
    for (let dz = -W * 0.4; dz <= W * 0.4; dz += 4.2) b.box(0.55, H, 0.55, 0x8e897e, x + dx, H / 2, z + dz);
  }
  if (p.netted) {
    b.box(D + 0.5, H * 0.78, W + 0.5, 0x1e7e48, x, H * 0.58, z);
    addCrane(b, x + side * 6, z - 6);
  }
  b.box(0.25, 2.6, W + 4, 0x1d5fbf, side * (FRONT - 0.1), 1.3, z);               // palissade bleue de chantier
}

/** 7. Tour Batetela (vidéo 00:24 « Avenue Batetela ») : deux ailes en brique brune à gradins encadrant un cylindre central vitré bleu-vert. */
function addB30Batetela(b, signs, side, z, p) {
  const x = side * (FRONT + 14), fx = side * (FRONT + 4), H = 44;
  // Cylindre central en verre bleu-turquoise réfléchissant
  b.cyl(6.8, 6.8, H + 3, 0x4ca3b8, x - side * 2, (H + 3) / 2, z, 0, 0, 0, 22);
  // Deux ailes symétriques en brique ocre-brun à fenêtres carrés et sommet en gradins (comme à 00:24)
  for (const s of [-1, 1]) {
    const wz = z + s * 9.5;
    b.box(16, H, 10.5, 0x8c6d53, x, H / 2, wz)
      .box(14, 4, 8.5, 0x8c6d53, x, H + 2, wz);
    for (let y = 5; y < H - 2; y += 3.4) {
      for (const dz of [-2.6, 0, 2.6]) b.box(0.3, 1.7, 1.7, 0x1e2832, fx - side * 1.9, y, wz + dz);
    }
  }
  // Basilaire commercial beige avec arcades
  b.box(18, 4.2, 32, 0xd8c8b0, x - side * 1, 2.1, z);
  signs.add('b30_batetela', () => signTexture('TOUR BATETELA', 'Avenue des Batetela · Bd du 30 Juin', '#5c432d', '#ffffff'),
    12, 1.4, fx - side * 3.1, 4.4, z, -side * Math.PI / 2, true);
}

/** 8. Immeuble CNSS / BCDC vitré bleu-vert avec enseigne rose sur le toit (vidéo 10:19). */
function addB30CnssGlass(b, signs, side, z, p) {
  const x = side * (FRONT + 13), H = 32;
  b.cyl(10, 10, H, 0x1a7a8c, x, H / 2, z, 0, 0, 0, 20)
    .box(16, H - 2, 18, 0x1f6b7a, x + side * 3, (H - 2) / 2, z)
    .box(12, 14, 18, 0xc87d65, x - side * 2, 7, z + 16);                         // bâtiment brique rose-ocre juste avant
  signs.add('b30_cnss_top', () => signTexture('CNSS · GOMBE', 'Sécurité Sociale', '#d81b60', '#ffffff'),
    9, 2.2, x - side * 6, H + 1.5, z, -side * Math.PI / 2, true);
}

/** 9. Résidence 165 (vidéo 10:42 à droite) : immeuble courbe brun-bordeaux à nervures verticales derrière un mur blanc à toit de tuiles. */
function addB30Res165(b, signs, side, z, p) {
  const x = side * (FRONT + 16), H = 26;
  b.cyl(12, 12, H, 0x5a2a2c, x, H / 2, z, 0, 0, 0, 24)
    .box(20, H, 18, 0x5a2a2c, x + side * 4, H / 2, z);
  for (let a = -1.3; a <= 1.3; a += 0.22) {
    b.box(0.35, H - 2, 0.35, 0xd8cfc4, x - side * Math.cos(a) * 12.1, H / 2, z + Math.sin(a) * 12.1);
  }
  // Pavillon bas blanc à toit en tuiles rouges devant (comme à 10:42)
  const px = side * (FRONT + 5);
  b.box(8, 4.2, 18, 0xf2efe8, px, 2.1, z + 10);
  addHipRoof(b, px, 4.2, z + 10, 8, 18);
  signs.add('b30_res165', () => signTexture('RÉSIDENCE 165', 'Hôtel & Restaurant · Gombe', '#5a2a2c', '#f5c400'),
    9, 1.4, side * (FRONT + 0.5), 4.6, z, -side * Math.PI / 2, true);
}

/** 10. Hôtel du Gouvernement / Immeuble Intelligent (vidéo 10:42 à gauche) : grande tour R+11 blanche et grise à grille régulière. */
function addB30Gouvernement(b, signs, side, z, p) {
  const x = side * (FRONT + 16), fx = side * (FRONT + 7), H = 38, W = 26, D = 18;
  b.box(D, H, W, 0xdcdad2, x, H / 2, z)
    .box(D + 0.8, 1.0, W + 0.8, 0x5a626a, x, H + 0.5, z);
  for (let fy = 4; fy < H - 1; fy += 3.2) {
    b.box(0.25, 1.5, W - 2, 0x263238, fx, fy, z);
  }
  for (let dz = -W / 2 + 2; dz <= W / 2 - 2; dz += 3.2) {
    b.box(0.45, H - 2, 0.45, 0xeeeeea, fx - side * 0.1, H / 2, z + dz);
  }
  // Totem vert sur le trottoir (10:42)
  b.box(0.4, 5.5, 1.8, 0x007a5e, side * (FRONT + 1.2), 2.75, z + 12);
  signs.add('b30_gouv', () => signTexture('HÔTEL DU GOUVERNEMENT', 'Place Royal · Kinshasa Gombe', '#007a5e', '#ffffff'),
    13, 1.6, fx - side * 0.2, H - 2.2, z, -side * Math.PI / 2, true);
}

/** 11. Haute tour blanche moderne à balcons en porte-à-faux (vidéo 11:09 à droite). */
function addB30WhiteTower(b, signs, side, z, p) {
  const x = side * (FRONT + 14), fx = side * (FRONT + 5), H = 42, W = 20, D = 18;
  b.box(D, H, W, 0xf2f4f7, x, H / 2, z)
    .box(0.3, H - 4, 7, 0x1e3548, fx, H / 2, z);
  for (let fy = 5; fy < H - 2; fy += 3.4) {
    b.box(2.2, 0.35, W + 1.2, 0xffffff, fx - side * 0.8, fy, z);
  }
  b.box(0.2, 2.5, W + 6, 0x1d5fbf, side * (FRONT - 0.1), 1.25, z);
}

/** 12. Immeuble blanc et verre à 3 grandes colonnes monumentales en façade (vidéo 11:35). */
function addB30ThreePillars(b, signs, side, z, p) {
  const x = side * (FRONT + 13), fx = side * (FRONT + 5), H = 28, W = 24, D = 16;
  b.box(D, H, W, 0x243442, x, H / 2, z)
    .box(D + 1, 4.0, W + 2, 0xd8cbb8, x, 2.0, z);
  for (const dz of [-7.5, 0, 7.5]) {
    b.box(2.4, H + 1.5, 3.8, 0xf2f2ee, fx - side * 0.8, (H + 1.5) / 2, z + dz);
  }
  for (let fy = 5.5; fy < H; fy += 3.2) b.box(0.35, 0.25, W, 0xe6e6e2, fx - side * 0.1, fy, z);
}

/** 13. Immeuble moderne cuivre & verre bleu + immeuble vitré noir incurvé (vidéo 12:48 & 12:54 à gauche). */
function addB30CopperGlass(b, signs, side, z, p) {
  const x = side * (FRONT + 13), fx = side * (FRONT + 4.5), H = 34, W = 24, D = 16;
  // Tour cuivre / terre cuite et mur-rideau bleu
  b.box(D, H, W, 0xb85d38, x, H / 2, z + 12)
    .box(0.35, H - 3, W - 3, 0x3b6e9c, fx, H / 2 + 1, z + 12);
  for (let dz = -9; dz <= 9; dz += 3) b.box(0.5, H, 0.45, 0xb85d38, fx - side * 0.1, H / 2, z + 12 + dz);
  // Immeuble noir vitré à bandeaux rouges juste après (12:54)
  b.box(16, 22, 20, 0x161b22, x, 11, z - 14)
    .box(0.4, 22, 2.2, 0xc8102e, fx - side * 0.1, 11, z - 8)
    .box(0.4, 22, 2.2, 0xc8102e, fx - side * 0.1, 11, z - 20);
}

/** 14. Haute tour étroite avec bâche géante verticale Africell / Rawbank (vidéo 12:54 & 13:13 à droite). */
function addB30AfricellTower(b, signs, side, z, p) {
  const x = side * (FRONT + 12), H = 46, W = 12, D = 14;
  b.box(D, H, W, 0x8e887c, x, H / 2, z);
  for (let fy = 4; fy < H - 2; fy += 3.2) b.box(0.25, 1.4, W - 1.5, 0x262c34, x - side * (D / 2 + 0.05), fy, z);
  // Immense bâche verticale sur le flanc face aux voitures qui arrivent (+z)
  signs.add('b30_africell_tall', () => signTexture('africell · rawbank', 'Bonne fête de fin d\'année', '#f4f4f0', '#a01a7d'),
    10, 28, x, H * 0.56, z + W / 2 + 0.2, 0, true);
}

/** 15. Afriland First Bank CD (vidéo 13:38) : façade vitrée sombre à grand bandeau supérieur rouge et blanc. */
function addB30Afriland(b, signs, side, z, p) {
  const x = side * (FRONT + 11), fx = side * (FRONT + 3), H = 13, W = 26, D = 15;
  b.box(D, H, W, 0xf2f2ee, x, H / 2, z)
    .box(0.3, H - 3, W - 2, 0x1e293b, fx, (H - 3) / 2 + 0.5, z)
    .box(0.5, 1.8, W + 0.4, 0xc8102e, fx - side * 0.15, H - 0.9, z);
  b.box(0.15, 1.8, W + 2, 0x22262a, side * (FRONT - 0.1), 0.9, z);
  signs.add('b30_afriland', () => signTexture('Afriland First Bank CD', 'Boulevard du 30 Juin · Gombe', '#c8102e', '#ffffff'),
    18, 1.4, fx - side * 0.45, H - 0.9, z, -side * Math.PI / 2, true);
}

/** 16. Immeuble Matrix / LC Waikiki (vidéo 14:50 à droite) & Résidence Mandela (à gauche, 14:40). */
function addB30Matrix(b, signs, side, z, p) {
  const x = side * (FRONT + 14), fx = side * (FRONT + 4), H = 30, W = 28, D = 18;
  b.box(D, H, W, 0xd8b888, x, H / 2, z)
    .box(D + 0.4, 9, W + 0.4, 0x8c4a32, x, 4.5, z)
    .box(0.4, H - 4, 10, 0x2b5c8f, fx, H / 2 + 1, z);
  for (let fy = 11; fy < H - 1; fy += 3.2) {
    for (const dz of [-10, -6.5, 6.5, 10]) b.box(0.25, 1.5, 1.8, 0x222831, fx - side * 0.05, fy, z + dz);
  }
  signs.add('b30_matrix', () => signTexture('MATRIX · LC Waikiki', 'Shopping & Offices · 30 Juin', '#1d4fa0', '#ffffff'),
    14, 1.6, fx - side * 0.25, 9.2, z, -side * Math.PI / 2, true);
}

function addB30MandelaApt(b, signs, side, z, p) {
  const x = side * (FRONT + 14), fx = side * (FRONT + 5), H = 32, W = 24, D = 16;
  b.box(D, H, W, 0x5c646d, x, H / 2, z)
    .box(D + 0.4, H - 4, 6, 0xf2f2ee, x, H / 2, z - 5)
    .box(4, H - 2, 5, 0x9e3b24, x - side * 4, (H - 2) / 2, z - 10);
  for (let fy = 4.5; fy < H - 2; fy += 3.2) b.box(0.3, 1.3, W - 4, 0x1e2630, fx, fy, z);
}

/** 17. Kin Plaza Arjaan by Rotana & Premier Shopping Mall (vidéo 15:42 à gauche). */
function addB30Rotana(b, signs, side, z, p) {
  const x = side * (FRONT + 16), fx = side * (FRONT + 5), H = 26, W = 44, D = 20;
  b.box(D, H, W, 0xd8d4cc, x, H / 2, z)
    .box(D + 0.6, H * 0.65, 22, 0x3e322b, x, H * 0.325, z - 6)
    .box(0.4, H * 0.55, 18, 0x1c2833, fx - side * 0.3, H * 0.32, z + 10);
  // Colonnes et grandes arches de l'hôtel Rotana
  for (let dz = -16; dz <= 2; dz += 4.5) b.box(0.8, H * 0.65, 0.8, 0xc8bfb2, fx - side * 0.4, H * 0.325, z + dz);
  signs.add('b30_rotana', () => signTexture('KIN PLAZA ARJAAN BY ROTANA', 'Le Premier Shopping Mall · CityMarket', '#3e322b', '#f5c400'),
    18, 1.8, fx - side * 0.5, H * 0.68, z - 4, -side * Math.PI / 2, true);
}

/** 18. Hôtel Believe (vidéo 16:31 à gauche) : immeuble vitré bleu foncé à cadres gris et rez-de-chaussée rouge-orangé. */
function addB30Believe(b, signs, side, z, p) {
  const x = side * (FRONT + 12), fx = side * (FRONT + 4), H = 24, W = 22, D = 15;
  b.box(D, H, W, 0x5a626a, x, H / 2, z)
    .box(0.35, H - 5, W - 2.5, 0x1a365d, fx, (H + 3) / 2, z)
    .box(D + 0.5, 4.2, W + 0.4, 0xc84b31, x, 2.1, z);
  signs.add('b30_believe', () => signTexture(p.name, p.sub ?? '', '#c84b31', '#ffffff'),
    14, 1.5, fx - side * 0.3, 4.3, z, -side * Math.PI / 2, true);
}

/** 19. Immeuble Sabena / Galeries (vidéo 16:56 à gauche) : long bâtiment moderniste R+7 à brise-soleil horizontaux blancs. */
function addB30Sabena(b, signs, side, z, p) {
  const x = side * (FRONT + 13), fx = side * (FRONT + 4), H = 26, W = 46, D = 16;
  b.box(D, H, W, 0x343d46, x, H / 2, z);
  for (let fy = 3.6; fy <= H; fy += 3.1) {
    b.box(1.4, 0.42, W + 0.4, 0xeeece6, fx - side * 0.5, fy, z);
  }
  for (let dz = -W / 2 + 2; dz <= W / 2 - 2; dz += 4.4) {
    b.box(1.2, H, 0.3, 0xd8d4ca, fx - side * 0.4, H / 2, z + dz);
  }
  signs.add('b30_sabena', () => signTexture('IMMEUBLE SABENA · GALERIES', 'Boulevard du 30 Juin · Gombe', '#1d4fa0', '#ffffff'),
    16, 1.5, fx - side * 1.25, 3.8, z, -side * Math.PI / 2, true);
}

/** 20. Immeuble Orange RDC (vidéo 16:56–17:01 au fond à droite) : tour beige R+9 surmontée du grand logo Orange. */
function addB30OrangeTower(b, signs, side, z, p) {
  const x = side * (FRONT + 14), fx = side * (FRONT + 5), H = 32, W = 18, D = 16;
  b.box(D, H, W, 0xd9cbb8, x, H / 2, z);
  for (let fy = 4; fy < H - 1; fy += 3.2) b.box(0.25, 1.4, W - 2, 0x2b343c, fx, fy, z);
  signs.add('b30_orange_top', () => signTexture('Orange', 'Orange RDC · 30 Juin', '#ff6600', '#ffffff'),
    8, 2.4, fx - side * 0.2, H + 1.4, z, -side * Math.PI / 2, true);
}

/** 21. Chancellerie des Ordres Nationaux (vidéo 17:21 à droite) : portique officiel à colonnes et drapeaux + tour bleue/rouge derrière. */
function addB30Chancellerie(b, signs, side, z, p) {
  const gx = side * (FRONT + 2.5), tx = side * (FRONT + 20);
  // Portique officiel gris anthracite et blanc à 6 colonnes
  for (let dz = -10; dz <= 10; dz += 4) b.box(0.7, 5.2, 0.7, 0x3b424c, gx, 2.6, z + dz);
  b.box(1.1, 0.9, 22, 0x3b424c, gx, 5.4, z);
  signs.add('b30_chancellerie', () => signTexture('CHANCELLERIE DES ORDRES NATIONAUX', 'République Démocratique du Congo', '#2c353d', '#ffffff'),
    16, 1.1, gx - side * 0.6, 5.4, z, -side * Math.PI / 2, true);
  for (const dz of [-6, 0, 6]) addFlag(b, signs, gx - side * 1.2, z + dz, 8.5);
  // Tour bleue et rouge derrière la Chancellerie (vue à 17:21)
  b.box(16, 30, 18, 0x2b6cb0, tx, 15, z + 6);
  for (let fy = 5; fy < 28; fy += 3.5) b.box(0.3, 1.4, 15, 0xc8102e, tx - side * 8.1, fy, z + 6);
}

/** 22. REGIDESO SA — Direction Générale (vidéo 17:28 & 17:45) : haute tour beige à lames verticales serrées + basilaire avec logo REGIDESO SA. */
function addB30Regideso(b, signs, side, z, p) {
  const x = side * (FRONT + 16), fx = side * (FRONT + 3.5), H = 44, W = 22, D = 16;
  // Haute tour REGIDESO à façade finement nervurée
  b.box(D, H, W, 0xc8bca8, x, H / 2, z)
    .box(D - 1, H - 2, W - 1, 0x2c2824, x - side * 0.3, H / 2, z);
  for (let dz = -W / 2 + 0.8; dz <= W / 2 - 0.8; dz += 1.2) {
    b.box(0.55, H - 1, 0.38, 0xd8cbb8, x - side * (D / 2 + 0.1), H / 2, z + dz);
  }
  // Basilaire horizontal sur le boulevard avec lames verticales et enseigne bleue « REGIDESO SA DIRECTION GENERALE » (17:45)
  b.box(10, 8.5, 32, 0xd2c5b0, side * (FRONT + 8.5), 4.25, z + 4)
    .box(0.25, 5.5, 29, 0x2c2824, fx, 4.2, z + 4);
  for (let dz = -10; dz <= 18; dz += 1.4) b.box(0.45, 5.8, 0.35, 0xd8cbb8, fx - side * 0.1, 4.2, z + dz);
  signs.add('b30_regideso', () => signTexture('REGIDESO SA', 'DIRECTION GÉNÉRALE', '#e8e2d5', '#0b4f9c'),
    9.5, 1.7, fx - side * 0.35, 6.2, z + 11, -side * Math.PI / 2, true);
}

/** 23. Immeuble Dentisterie + Chantier (vidéo 19:25 à gauche) & Tour bleue incurvée (19:25 à droite). */
function addB30DentisterieChantier(b, signs, side, z, p) {
  const x = side * (FRONT + 13), fx = side * (FRONT + 4);
  b.box(16, 18, 18, 0xf2f2ee, x, 9, z + 14)
    .box(16, 36, 22, 0x9e7b56, x, 18, z - 8)
    .box(16.4, 36, 7, 0x1e7e48, x, 18, z - 2);
  addCrane(b, x + side * 5, z - 10);
  signs.add('b30_diamant', () => signTexture(p.name, p.sub ?? '', '#1d4fa0', '#ffffff'),
    12, 1.4, fx - side * 0.15, 4.2, z + 14, -side * Math.PI / 2, true);
}

function addB30BlueCurve(b, signs, side, z, p) {
  const x = side * (FRONT + 13), H = 34;
  b.cyl(11, 11, H, 0x153e6b, x, H / 2, z, 0, 0, 0, 22)
    .box(16, H, 20, 0x153e6b, x + side * 4, H / 2, z);
  for (let fy = 4; fy < H; fy += 3.2) b.cyl(11.15, 11.15, 0.35, 0xd8dce2, x, fy, z, 0, 0, 0, 22);
  signs.add('b30_ecobank_curve', () => signTexture('Ecobank · Gombe', 'La Banque Panafricaine', '#005b82', '#8dc63f'),
    11, 1.5, side * (FRONT + 1.8), 4.2, z, -side * Math.PI / 2, true);
}

/** 24. La Grande Poste — SCPT (vidéo 19:40–19:49 à droite) : long bâtiment gris-beige à 4 hautes colonnes blanches centrales, palmiers et abribus rouge Ooh. */
function addB30Scpt(b, signs, side, z, p) {
  const x = side * (FRONT + 16), fx = side * (FRONT + 6), H = 15.5, W = 52, D = 20;
  b.box(D, H, W, 0xb8b4ac, x, H / 2, z)
    .box(D + 0.6, 0.8, W + 0.6, 0x8e8a82, x, H + 0.4, z)
    .box(4, H + 0.5, 14, 0x9e9589, fx - side * 1.2, (H + 0.5) / 2, z);
  // 4 hautes colonnes blanches du portique central SCPT (19:45)
  for (const dz of [-4.8, -1.6, 1.6, 4.8]) {
    b.box(0.85, H - 1.5, 0.85, 0xf4f2ec, fx - side * 3.1, (H - 1.5) / 2 + 0.8, z + dz);
  }
  // Bandeaux de fenêtres et piliers bleus au rez-de-chaussée
  for (const fy of [6.2, 10.8]) b.box(0.3, 1.8, W - 4, 0x4a3c31, fx, fy, z);
  for (let dz = -22; dz <= 22; dz += 4.4) b.box(0.5, 3.4, 0.5, 0x1d4fa0, fx - side * 0.2, 1.7, z + dz);
  // Palmiers dans la cour et abribus rouge « Ooh » sur le trottoir (19:49)
  for (const dz of [-14, 10, 18]) addPalm(b, side * (FRONT + 3.2), z + dz, 0.9);
  const bx = side * (ROAD_EDGE + 3.2), bz = z - 8;
  b.box(2.2, 2.5, 5.2, 0xb81d24, bx, 1.25, bz).box(2.6, 0.2, 5.6, 0xd62828, bx, 2.55, bz);
  signs.add('b30_scpt', () => signTexture('SCPT', 'Société Commerciale des Postes et Télécommunications', '#b8b4ac', '#1d3557'),
    10, 1.8, fx - side * 0.25, H - 1.6, z - 14, -side * Math.PI / 2, true);
}

/** 25. Tour SOZACOM & Basilaire EquityBCDC (vidéo 20:13–20:42 à droite) : haute tour brune à grille dense + immeuble jaune-ocre + basilaire à lames béton. */
function addB30Sozacom(b, signs, side, z, p) {
  // (façade sur l'alignement des autres immeubles : de loin, on la voit dépasser au-dessus de la rangée)
  const x = side * (FRONT + 11), fx = side * (FRONT + 0.3), W = 24, D = 20;
  // Immeuble jaune-ocre voisin, en retrait pour ne pas cacher la tour quand on arrive (20:13)
  b.box(15, 28, 18, 0xd9b468, side * (FRONT + 22), 14, z + 24);
  // Haute tour SOZACOM brune (vidéo « KINSHASA Gare Centrale au centre-ville » 02:47, 04:45) : ~24 niveaux, volumes
  // décalés en gradins sur les côtés, bandeaux de fenêtres horizontaux sombres, nervures verticales côté gauche,
  // couronnement en retrait aux angles coupés, antennes
  const BROWN = 0x6e4b3a, BROWN2 = 0x5a3d2f, WIN = 0x2a2420, HT = 92, fr = x - side * (D / 2);
  const t = SKYLINE ? SKYLINE.at(z) : b;                                   // (la tour : visible de loin)
  t.box(D, HT, W - 6, BROWN, x, HT / 2, z)                                 // fût principal
    .box(D - 3, HT - 8, 4, BROWN2, x - side * 1.5, (HT - 8) / 2, z + W / 2 - 2)   // gradin arrière, un peu plus bas
    .box(D - 4, HT - 16, 4, BROWN2, x - side * 2, (HT - 16) / 2, z - W / 2 + 2)   // gradin avant, plus bas encore
    .box(D - 5, 6, W - 10, BROWN2, x + side * 1, HT + 3, z)               // couronnement en retrait
    .box(D - 8, 3, W - 14, 0x4b3428, x + side * 1.5, HT + 7.5, z);
  for (const dz of [-4, 3]) t.cyl(0.15, 0.2, 9, 0x9aa0a6, x + side * 2, HT + 13, z + dz);   // antennes
  // bandeaux de fenêtres sur la façade côté boulevard (et sur les gradins)
  for (let fy = 6; fy < HT - 2; fy += 3.4) {
    t.box(0.2, 1.5, W - 9, WIN, fr - side * 0.08, fy, z);
    if (fy < HT - 10) t.box(0.2, 1.5, 3, WIN, fr + side * 1.42, fy, z + W / 2 - 2);
    if (fy < HT - 18) t.box(0.2, 1.5, 3, WIN, fr + side * 1.92, fy, z - W / 2 + 2);
  }
  for (const dz of [-(W / 2 - 4), -(W / 2 - 5.4)]) t.box(0.9, HT - 6, 0.6, 0x7a5644, fr - side * 0.4, (HT - 6) / 2 + 3, z + dz);   // nervures
  b.box(D + 0.4, 1.0, W - 5.6, 0x8a6a56, x, 4.5, z);                    // bandeau au-dessus du hall
  // Basilaire brutaliste à grandes lames verticales en béton clair au bord du boulevard + banderole rouge EquityBCDC 2026 (20:39–20:42)
  b.box(1.2, 9.5, 26, 0xb8afa2, side * (FRONT + 0.6), 4.75, z - 4);
  for (let dz = -15; dz <= 7; dz += 1.8) b.box(0.8, 9.2, 0.45, 0xc8bfb2, fx, 4.6, z + dz);
  signs.add('b30_sozacom_top', () => signTexture('SOZACOM', 'Boulevard du 30 Juin', '#36281e', '#f5c400'),
    10, 1.8, x - side * (D / 2 + 0.25), HT - 1.6, z, -side * Math.PI / 2, true);
  signs.add('b30_sozacom_bcdc', () => signTexture('EquityBCDC · 2026', 'Vous souhaite de joyeuses fêtes et une bonne année', '#9e2835', '#ffffff'),
    16, 1.8, side * (FRONT - 0.15), 10.6, z, -side * Math.PI / 2, true);   // (au-dessus du basilaire)
}

/** 26. Immeuble Solenac vert et blanc (vidéo 21:29 à gauche). */
function addB30Solenac(b, signs, side, z, p) {
  const x = side * (FRONT + 12), fx = side * (FRONT + 4), H = 15, W = 28, D = 16;
  b.box(D, H, W, 0xf2f4f0, x, H / 2, z)
    .box(0.35, 3.8, W, 0x2b8a3e, fx, 2.2, z);
  for (let fy = 6.5; fy < H - 1; fy += 3.4) b.box(0.25, 1.5, W - 3, 0x263238, fx, fy, z);
  signs.add('b30_solenac', () => signTexture('SOLENAC · PHARMACIE', 'Boulevard du 30 Juin · Gombe', '#2b8a3e', '#ffffff'),
    14, 1.4, fx - side * 0.22, 3.8, z, -side * Math.PI / 2, true);
}

/** 27. Hôtel Memling (à droite, en retrait sur l'avenue du Tchad / Ipenge). */
function addB30Memling(b, signs, side, z, p) {
  const x = side * (FRONT + 22), H = 32, W = 26, D = 18;
  b.box(D, H, W, 0xd8cfc2, x, H / 2, z)
    .box(D + 2, 4.5, W + 4, 0x3b424c, x - side * 3, 2.25, z);
  for (let fy = 6; fy < H - 1; fy += 3.2) b.box(0.3, 1.4, W - 3, 0x1e293b, x - side * (D / 2 + 0.05), fy, z);
  signs.add('b30_memling', () => signTexture('HÔTEL MEMLING', 'Cinq Étoiles · Kinshasa Gombe', '#1b365d', '#f5c400'),
    12, 1.8, x - side * (D / 2 + 0.25), H - 1.8, z, -side * Math.PI / 2, true);
}

/** 28. Tour Equity BCDC à gradins (vidéo 21:29–22:18 à gauche) : la grande tour beige-ocre emblématique à sommet étagé. */
function addB30BcdcTower(b, signs, side, z, p) {
  const x = side * (FRONT + 14), fx = side * (FRONT + 5), H = 54;
  // Corps principal ocre-fauve à fentes verticales sombres et sommet en 3 gradins (comme à 21:39 et 22:08)
  b.box(16, H - 10, 22, 0xb88b58, x, (H - 10) / 2, z)
    .box(14, 6, 16, 0xb88b58, x, H - 7, z)
    .box(11, 5, 11, 0xa67946, x, H - 1.5, z);
  for (let dz = -8; dz <= 8; dz += 2.2) {
    b.box(0.35, H - 14, 0.7, 0x2b2218, fx, (H - 12) / 2 + 2, z + dz);
  }
  // Long mur-galerie commercial au pied de la tour BCDC avec grandes affiches (21:39)
  b.box(6, 6.5, 44, 0xd8cfc2, side * (FRONT + 5), 3.25, z + 6);
  signs.add('b30_bcdc_tower', () => signTexture('EQUITY BCDC', 'Siège Social · Boulevard du 30 Juin', '#8e1b1b', '#ffffff'),
    12, 1.8, side * (FRONT + 1.9), 6.2, z, -side * Math.PI / 2, true);
}

/** Façade de pierre beige à pilastres fins et petites fenêtres de l'immeuble ONATRA (une dalle = une travée de 1,3 m sur un étage de 3,2 m, répétée). */
function onatraFacadeTexture() {
  if (!TEX_SHARED.has('onatra')) {
    TEX_SHARED.set('onatra', canvasTexture(32, 64, (x, w, h) => {
      x.fillStyle = '#b9ad98'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#d0c4ad'; x.fillRect(0, 0, 6, h);              // pilastre clair
      x.fillStyle = '#8c806c'; x.fillRect(6, 0, 2, h);              // son ombre
      x.fillStyle = '#3a3f44'; x.fillRect(12, 14, 12, 30);          // la petite fenêtre
      x.fillStyle = '#6a7279'; x.fillRect(13, 15, 10, 12);
      x.fillStyle = '#a69a84'; x.fillRect(8, 50, 24, 5);            // allège
    }));
  }
  return TEX_SHARED.get('onatra');
}

/**
 * 29. Immeuble ONATRA (l'auteur, 22/11, image « imeuble onatra » = vidéo « place gard » 05:25, et 04:30–05:00) : très grand immeuble de bureaux de pierre beige à droite du
 * boulevard, avant la Place de la Gare. De face (de la droite vers la gauche de l'image, donc dans le sens de la marche) : une aile basse à grandes fenêtres, le corps principal
 * (R+12) à pilastres fins et petites fenêtres, trois bandes noires à son angle, une tour plus haute et étroite à colonne de fenêtres vitrées et coffre à aérations, puis
 * l'aile gauche ; devant, trois grands palmiers à gauche, le jardin et sa grille basse, des lampadaires et un panneau Qatar Airways.
 */
function addB30PalaisJustice(b, signs, side, z, p) {
  const GAP = 8, X = d => side * (FRONT + d), face = -side * Math.PI / 2, STONE = 0xb9ad98, CORN = 0x8c8170;
  // [dz, longueur, hauteur, profondeur] : image-droite = +z (côté d'où l'on vient), image-gauche = -z
  const blocks = [[29, 24, 33, 17], [2, 30, 42, 19], [-18, 8, 47, 20], [-34, 26, 36, 18]];
  blocks.forEach(([dz, len, H, D], i) => {
    const cxx = X(GAP + D / 2);
    b.box(D, H, len, STONE, cxx, H / 2, z + dz).box(D + 1.2, 0.9, len + 1.2, CORN, cxx, H + 0.45, z + dz);
    b.box(0.8, 4.4, len - 1, 0x40362c, X(GAP - 0.15), 2.2, z + dz);                                  // rez-de-chaussée sombre (boutiques, arcades)
    signs.add(`onatra_${side}_${i}`, () => {
      const t = onatraFacadeTexture().clone();
      t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(Math.round(len / 1.3), Math.round((H - 4.4) / 3.2));
      return t;
    }, len, H - 4.4, X(GAP - 0.05), 4.4 + (H - 4.4) / 2, z + dz, face, true);
  });
  // le corps principal : couronnement en retrait, trois bandes noires verticales à l'angle (côté +z)
  b.box(19 * 0.6, 4, 30 * 0.6, 0xa89b84, X(GAP + 9.5), 42 + 2.9, z + 2).box(19 * 0.6 + 0.6, 0.5, 30 * 0.6 + 0.6, CORN, X(GAP + 9.5), 42 + 5.2, z + 2);
  for (let k = 0; k < 3; k++) b.box(0.45, 42, 0.32, 0x1f1c1a, X(GAP - 0.25), 21, z + 2 + 14.2 - k * 0.8);
  // la tour étroite : colonne de fenêtres vitrées très hautes, coffre à aérations au sommet
  for (let k = -1; k <= 1; k++) b.box(0.3, 36, 1.0, 0x2e3b4a, X(GAP - 0.25), 4.4 + 18, z - 18 + k * 2.2);
  b.box(10, 3.6, 11, 0xa89b84, X(GAP + 10), 47 + 2.4, z - 18).box(10.5, 0.5, 11.5, CORN, X(GAP + 10), 47 + 4.45, z - 18);
  for (let k = 0; k < 5; k++) b.box(0.15, 0.25, 6.6, 0x4a4036, X(GAP + 4.9), 47 + 2.6 + (k % 2 ? 0.4 : 0), z - 18);
  b.cyl(0.15, 0.2, 6, 0x7b8086, X(GAP + 8), 47 + 7, z - 18);                                       // antenne
  signs.add('onatra_name', () => signTexture('IMMEUBLE ONATRA', 'Office national des transports', '#1d4fa0', '#ffffff'), 15, 1.8, X(GAP - 0.4), 6.4, z + 2, face, true);
  // le jardin : grille basse, palmiers (trois grands à gauche), lampadaires, panneau Qatar Airways
  b.box(0.12, 0.9, 112, 0x2f3a33, X(1.4), 0.45, z);
  for (let dz = -52; dz <= 52; dz += 6.5) { if (dz > -36 && dz < -16) continue; addPalm(b, X(4.6), z + dz, 1.0); b.box(0.6, 0.5, 0.6, 0x9a8f78, X(1.4), 0.25, z + dz); }
  for (const [pd, pz, ps] of [[3.8, -31, 1.5], [5.2, -26, 1.35], [4.2, -21, 1.25]]) addPalm(b, X(pd), z + pz, ps);
  b.box(2.5, 0.5, 112, 0x6f7a5a, X(3.4), 0.2, z);
  for (const dz of [-40, 0, 40]) { b.cyl(0.1, 0.14, 9, 0x5b6168, X(2.4), 4.5, z + dz); lampHead(X(2.4), 9.1, z + dz); }
  b.cyl(0.15, 0.18, 6, 0x6b7076, X(0.6), 3, z + 60);
  signs.add('onatra_qatar', () => signTexture('QATAR AIRWAYS', 'Voyagez vers 190 destinations', '#5c0a2e', '#ffffff'), 4.2, 3.2, X(0.6) - side * 0.12, 6, z + 60, face, true);
}

/** 30. Immeuble en chantier couvert de panneaux géants BOLD / AGUA (vidéo 23:05–23:34 à droite). */
function addB30BoldChantier(b, signs, side, z, p) {
  const x = side * (FRONT + 13), fx = side * (FRONT + 4), H = 22, W = 38, D = 16;
  b.box(D, H, W, 0x6e6a63, x, H / 2, z);
  for (let fy = 3.6; fy <= H; fy += 3.6) b.box(D + 0.3, 0.35, W + 0.3, 0x8e8980, x, fy, z);
  b.box(0.2, 2.4, W + 4, 0x1d4fa0, side * (FRONT - 0.1), 1.2, z);
  addCrane(b, x + side * 6, z - 8);
  signs.add('b30_bold_1', () => signTexture('BOLD · AGUA', 'Révèle ton pouvoir · Energy Drink', '#1b365d', '#f5c400'),
    14, 8, fx - side * 0.25, 11, z + 6, -side * Math.PI / 2, true);
  signs.add('b30_bold_2', () => signTexture('CGA MOTORS · SAMSUNG', 'Place de la Gare Centrale', '#c8102e', '#ffffff'),
    12, 7.5, fx - side * 0.25, 11, z - 10, -side * Math.PI / 2, true);
}

/**
 * 31. La clôture bleue du Parc de la Grande Roue le long du boulevard (vidéo 23:57 à gauche) et son panneau. La roue et le parc de loisirs eux-mêmes sont sur la place, derrière
 * les deux piliers du monument (l'auteur, 22/11 : « la roue est derrière les deux piliers, c'est là l'espace de la gare ») : voir addGareWheel.
 */
function addB30FerrisWheel(b, signs, side, z, p) {
  b.box(0.2, 2.6, 56, 0x1e6bb8, side * (FRONT - 0.1), 1.3, z);
  for (let dz = -24; dz <= 24; dz += 6) b.box(0.3, 1.2, 3.8, 0xf2f2ee, side * (FRONT - 0.22), 1.1, z + dz);
  signs.add('b30_wheel', () => signTexture('LA GRANDE ROUE', 'Place de la Gare Centrale · Kinshasa', '#1e6bb8', '#ffffff'),
    12, 1.5, side * (FRONT - 0.25), 3.2, z, -side * Math.PI / 2, true);
}

/**
 * La Grande Roue et son parc de loisirs, sur la place de la Gare, derrière le monument aux deux piliers (l'auteur, 22/11, vidéo « place de la gars actuel » de nuit) : la roue
 * blanche tournée vers le boulevard, illuminée de toutes les couleurs ; le château de jeux en bois à toboggan tubulaire vert, le cinéma « 5D » dans un conteneur peint, le manège à
 * chevaux, la caisse jaune, les petites barrières blanches, les parasols turquoise et les lampadaires. La nuit, les lumières de la roue, du manège et des lampadaires s'allument.
 * (z : début de la place ; x = 0 est l'axe du boulevard, les piliers sont à z - 70)
 */
function addGareWheel(b, signs, z) {
  const cx = -12, zc = z - 118, R = 21, yc = R + 4.5, LED = [0x46e6f0, 0xf050d8, 0xf0e050, 0x60f070, 0x7a8cff], WHITE = 0xf4f4f2;
  // pieds en A blancs de chaque côté, axe et deux jantes concentriques, rayons et 20 nacelles
  for (const dz of [-2.4, 2.4]) for (const s of [-1, 1]) b.cyl(0.35, 0.45, yc + 2, 0xf4f6f8, cx + s * 7, yc / 2, zc + dz, 0, 0, -s * 0.3, 10);
  b.cyl(0.9, 0.9, 6.2, 0xd8dce2, cx, yc, zc, Math.PI / 2, 0, 0, 16);
  for (const dz of [-1.4, 1.4]) {
    b.add(new THREE.TorusGeometry(R, 0.32, 8, 36), 0xf6f8fa, cx, yc, zc + dz);
    b.add(new THREE.TorusGeometry(R * 0.62, 0.18, 6, 28), 0xe2e8f0, cx, yc, zc + dz);
  }
  const N = 20;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2, px = cx + Math.cos(a) * R, py = yc + Math.sin(a) * R;
    b.add(new THREE.CylinderGeometry(0.08, 0.08, R * 2, 6).rotateZ(a + Math.PI / 2), 0xd8dce2, cx, yc, zc);
    b.cyl(1.1, 0.9, 1.8, i % 2 ? 0xf4f6f8 : 0x1e88e5, px, py - 1.1, zc, 0, 0, 0, 10);
    if (LAMPS) LAMPS.at(z).box(0.9, 0.5, 0.9, LED[i % 5], px, py - 0.2, zc);                       // (la nuit : nacelles colorées allumées)
  }
  if (LAMPS) {
    for (let i = 0; i < 48; i++) {                                                               // la jante allumée, tous les 7,5°
      const a = i / 48 * Math.PI * 2;
      LAMPS.at(z).box(0.55, 0.55, 0.55, LED[i % 5], cx + Math.cos(a) * (R + 0.3), yc + Math.sin(a) * (R + 0.3), zc);
      if (i % 2 === 0) LAMPS.at(z).box(0.4, 0.4, 0.4, LED[(i + 2) % 5], cx + Math.cos(a) * R * 0.62, yc + Math.sin(a) * R * 0.62, zc);
    }
    for (let i = 0; i < 12; i++) LAMPS.at(z).box(R * 1.9, 0.12, 0.12, LED[i % 5], cx, yc, zc + (i % 2 ? 0.2 : -0.2), 0, 0, i / 12 * Math.PI);   // les rayons lumineux
  }
  const rail = (x0, z0, w, d) => {                                                                // petite barrière blanche rectangulaire (w en x, d en z)
    for (const sx of [-1, 1]) b.box(0.08, 0.9, d, WHITE, x0 + sx * w / 2, 0.55, z0).box(0.06, 0.06, d, WHITE, x0 + sx * w / 2, 0.95, z0);
    for (const sz of [-1, 1]) b.box(w, 0.9, 0.08, WHITE, x0, 0.55, z0 + sz * d / 2).box(w, 0.06, 0.06, WHITE, x0, 0.95, z0 + sz * d / 2);
  };
  // le manège à chevaux : plateau rond, mât, grand toit à lumières, chevaux
  const mx = cx + 24, mz = zc + 22;
  rail(mx, mz, 12, 12);
  b.cyl(4.8, 4.8, 0.35, 0xd8c9b0, mx, 0.35, mz, 0, 0, 0, 20).cyl(0.35, 0.35, 5.2, 0xe9d28a, mx, 2.9, mz).cyl(1.2, 5.4, 1.5, 0xf2e6c4, mx, 5.9, mz, 0, 0, 0, 20)
    .cyl(0.2, 1.2, 1.1, 0xe2b83a, mx, 7.1, mz, 0, 0, 0, 16).cyl(5.5, 5.5, 0.18, 0xe2b83a, mx, 5.1, mz, 0, 0, 0, 20);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, hx = mx + Math.sin(a) * 3.2, hz = mz + Math.cos(a) * 3.2;
    b.cyl(0.04, 0.04, 3.6, 0xe9d28a, hx, 2.3, hz).box(0.5, 0.7, 1.3, i % 2 ? 0xf2f2ee : 0x8d5a3a, hx, 1.6, hz, 0, a, 0).ball(0.28, i % 2 ? 0xf2f2ee : 0x8d5a3a, hx + Math.sin(a + 1.57) * 0.1, 2.2, hz + Math.cos(a + 1.57) * 0.1);
    if (LAMPS) LAMPS.at(z).box(0.35, 0.35, 0.35, LED[i % 5], mx + Math.sin(a) * 5.3, 5.0, mz + Math.cos(a) * 5.3);
  }
  if (LAMPS) for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; LAMPS.at(z).box(0.3, 0.3, 0.3, LED[(i + 1) % 5], mx + Math.sin(a) * 3.2, 6.9 - Math.abs(Math.sin(a * 2)) * 0.6, mz + Math.cos(a) * 3.2); }
  // la caisse jaune (face au boulevard)
  const kx = cx + 9, kz = zc + 24;
  b.box(2.4, 2.6, 2.4, 0xf0c21a, kx, 1.3, kz).box(2.8, 0.25, 2.8, 0xd8a912, kx, 2.7, kz).box(1.4, 0.9, 0.1, 0x3a4650, kx, 1.5, kz + 1.22);
  signs.add('park_caisse', () => signTexture('CAISSE', 'Parc de la Gare', '#f0c21a', '#1a1a1a'), 2.2, 0.5, kx, 2.2, kz + 1.24, 0, true);
  // le château de jeux en bois (tours à créneaux, plaques vertes) et son toboggan tubulaire vert
  const gx = cx - 26, gz = zc + 16;
  rail(gx, gz, 15, 11);
  b.box(4, 5, 4, 0x6e4a30, gx, 2.5, gz - 3).box(4.6, 0.5, 4.6, 0x5a3a24, gx, 5.2, gz - 3)
    .box(3.2, 3.2, 3.2, 0x7a5236, gx + 3.6, 1.6, gz + 1.6).box(3.8, 0.4, 3.8, 0x5a3a24, gx + 3.6, 3.4, gz + 1.6)
    .box(3.0, 6.2, 3.0, 0x6e4a30, gx - 3.4, 3.1, gz + 2).box(3.6, 0.5, 3.6, 0x5a3a24, gx - 3.4, 6.4, gz + 2)
    .box(1.2, 1.2, 0.1, 0x7bc043, gx, 3.2, gz - 0.96).box(1.0, 1.0, 0.1, 0x7bc043, gx - 3.4, 5.0, gz + 3.55);
  for (let k = -1; k <= 1; k++) for (const [cxk, czk, cw] of [[gx, gz - 3, 4.6], [gx - 3.4, gz + 2, 3.6]]) b.box(0.7, 0.6, 0.7, 0x5a3a24, cxk + k * (cw / 2 - 0.4), cw > 4 ? 5.7 : 6.9, czk);
  b.cyl(0.55, 0.55, 8, 0x4caf50, gx + 5.5, 2.6, gz + 1.8, 0, 0, 0.9, 12).cyl(0.62, 0.62, 2.4, 0x9aa0a6, gx + 8.6, 0.55, gz + 2.0, 0, 0, 1.45, 12);
  // le cinéma « 5D » : conteneur peint (ciel, nuages, côte) sous une bande de pellicule, lettres rouges ; face au boulevard
  const fx = cx + 30, fz = zc - 4;
  b.box(12, 4.6, 5, 0x7fa8d0, fx, 2.3, fz);
  for (const [cdx, cw, ch] of [[-3.8, 2.8, 1.2], [1.6, 3.4, 1.6], [4.2, 2.2, 1.0]]) b.box(cw, ch, 0.1, 0xf0f4f8, fx + cdx, 3.3, fz + 2.53);
  b.box(11.6, 1.1, 0.1, 0x4f9a5a, fx, 0.9, fz + 2.53).box(12.4, 1.3, 0.5, 0xf4f4f2, fx, 5.3, fz + 2.4);
  for (let dx = -5.5; dx <= 5.5; dx += 1.1) b.box(0.55, 0.55, 0.52, 0x30343a, fx + dx, 5.3, fz + 2.4);
  signs.add('park_5d', () => signTexture('5D', 'Cinéma · Parc de la Gare', '#ffffff', '#c8102e'), 3.2, 1.6, fx, 6.5, fz + 2.7, 0, true);
  // parasols turquoise et lampadaires du parc
  for (const [px, pz] of [[cx + 4, zc + 20], [cx + 14, zc + 26], [cx - 12, zc + 28], [cx + 20, zc + 10]]) {
    b.cyl(0.06, 0.07, 3.0, 0x8a8f94, px, 1.5, pz).cyl(0.06, 2.4, 0.8, 0x13a89a, px, 3.1, pz, 0, 0, 0, 10);
  }
  for (const [lx, lz] of [[cx - 40, zc + 6], [cx - 14, zc + 34], [cx + 16, zc + 36], [cx + 44, zc + 14], [cx + 40, zc - 18], [cx - 32, zc - 20]]) {
    b.cyl(0.1, 0.14, 9, 0x5b6168, lx, 4.5, lz);
    lampHead(lx, 9.1, lz);
  }
}

/**
 * Ensemble architectural du Quartier 1 (N'djili) — d'après appocalypse quartier1.jfif et quartier 1 appocalyspe.jfif :
 * 1) Immeuble Apocalypse (Hôtel Apocalypse 22) : R+5/R+6 beige, deux grandes travées gris anthracite en saillie
 *    terminées par des arcs en plein cintre, balcons vitrés bleutés, dizaines de climatiseurs blancs en façade,
 *    combles vitrés à 3 petits pignons rouges, drapeau RDC sur le toit, agence Ecobank + portail en arc au RDC,
 *    et piles de casiers de boissons jaunes et rouges sur le trottoir.
 * 2) Immeuble Super Tex (mitoyen) : façade claire à bandes verticales de briques rouge-terre cuite, motif en X
 *    et grand mur-rideau vitré vert-bleu avec l'enseigne « SUPER TEX » au rez-de-chaussée.
 * 3) Immeuble National (plus loin) : immeuble R+4 moderne à grille de loggias à garde-corps biseautés,
 *    immense affiche publicitaire verticale sur le flanc gauche et enseigne rouge « NATIONAL » en bas.
 */
function addApocalypse(b, signs, side, z) {
  const D = 16, W = 24, F = 6, fh = 3.25, H = F * fh;
  const x = side * (FRONT + D / 2), fx = side * (FRONT - 0.05);

  // 1) Immeuble Apocalypse
  b.box(D, H, W, 0xe8dec6, x, H / 2, z)
    // Étage d'attique entièrement vitré gris-bleu + 3 pignons à toiture rouge (comme sur la photo)
    .box(D - 2, 2.8, W - 3, 0x4f687a, x - side * 0.4, H + 1.4, z);
  for (const gz of [-6.5, 0, 6.5]) {
    b.add(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).scale(D - 1, 2.2, 6.2), 0xa83228, x - side * 0.4, H + 3.4, z + gz);
  }
  // Deux grandes travées verticales gris foncé en saillie avec arcs au sommet + balcons d'angle
  for (const bz of [-5.2, 4.8]) {
    b.box(1.3, H - fh + 0.6, 4.8, 0x4e5258, fx - side * 0.55, fh + (H - fh) / 2, z + bz);
    for (let f = 1; f < F; f++) {
      const y = f * fh;
      b.box(0.25, 1.8, 3.4, 0x1e242b, fx - side * 1.12, y + 1.15, z + bz)
        .box(0.10, 0.88, 3.6, 0x7fb3c8, fx - side * 1.25, y + 0.45, z + bz); // garde-corps vitré bleuté
      if (f === F - 1) {
        b.add(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2),
          0x1e242b, fx - side * 1.12, y + 2.05, z + bz);
      }
    }
  }
  // Balcons latéraux biseautés (à droite et à gauche de la façade)
  for (const bz of [-9.8, 9.8]) {
    for (let f = 1; f < F; f++) {
      const y = f * fh;
      b.box(1.1, 0.22, 3.6, 0x4e5258, fx - side * 0.5, y, z + bz)
        .box(0.10, 0.85, 3.4, 0x7fb3c8, fx - side * 0.98, y + 0.45, z + bz)
        .box(0.9, 1.0, 0.16, 0xe8dec6, fx - side * 0.45, y + 0.5, z + bz - 1.7);
    }
  }
  // Travée centrale et intermédiaire : grandes fenêtres + multiples splits de climatisation blancs
  for (const bz of [-0.2, -9.8, 9.8]) {
    for (let f = 1; f < F; f++) {
      const y = f * fh;
      b.box(0.12, 1.65, 2.8, 0x2c3e50, fx, y + 1.25, z + bz)
        .box(0.45, 0.42, 0.68, 0xf4f4f0, fx - side * 0.24, y + 0.38, z + bz - 0.65)
        .box(0.45, 0.42, 0.68, 0xf4f4f0, fx - side * 0.24, y + 0.38, z + bz + 0.65);
    }
  }
  // Rez-de-chaussée : agence Ecobank bleue, portail en arc en brique et pile de casiers jaune/rouge devant
  b.box(0.15, 3.0, W - 0.8, 0x262a30, fx, 1.5, z)
    .box(0.25, 3.1, 5.5, 0x9c422e, fx - side * 0.08, 1.55, z + 7.5);
  signs.add('apoca', () => signTexture('APOCALYPSE 22', "Quartier 1 · N'djili", '#3a2218', '#f6e7c4'), 8.2, 1.25, fx - side * 0.15, 3.55, z - 2, -side * Math.PI / 2, true);
  signs.add('ecobank', () => signTexture('Ecobank', 'La Banque Panafricaine', '#005696', '#ffffff'), 5.2, 1.05, fx - side * 0.18, 3.45, z + 7.5, -side * Math.PI / 2, true);
  addFlag(b, signs, fx - side * 0.5, z - W / 2 + 1.5, H + 5);
  // Piles de casiers de bière / boissons gazeuses (jaunes et rouges) sur le trottoir devant Apocalypse
  for (let c = 0; c < 6; c++) {
    const ch = 1.2 + (c % 3) * 0.55;
    b.box(0.65, ch, 0.65, c < 3 ? 0xe6b400 : 0xc81e1e, side * (FRONT - 2.2), ch / 2, z + 2.5 + c * 0.72);
  }

  // 2) Immeuble Super Tex (juste à droite d'Apocalypse sur la photo)
  const zSuper = z - W / 2 - 9.5, wSuper = 15, hSuper = 17.5, xSuper = side * (FRONT + 7.5);
  b.box(15, hSuper, wSuper, 0xeae3d2, xSuper, hSuper / 2, zSuper)
    // Bandes verticales en briques rouge-brun + motif en X
    .box(0.25, hSuper - 3.2, 2.2, 0xb34632, fx, (hSuper + 3.2) / 2, zSuper + 2.2)
    .box(0.25, hSuper - 3.2, 1.8, 0xb34632, fx, (hSuper + 3.2) / 2, zSuper - 3.8)
    // Grand pan vitré bleu-vert réfléchissant
    .box(0.22, hSuper - 3.4, 5.2, 0x3b6978, fx - side * 0.04, (hSuper + 3.2) / 2, zSuper - 1.0);
  for (let f = 1; f <= 4; f++) {
    b.box(0.18, 1.3, 1.6, 0x2c3a47, fx, f * 3.3 + 1.2, zSuper + 5.2);
  }
  signs.add('supertex', () => signTexture('SUPER TEX', 'Tissus · Pagnes · Prêt-à-porter', '#f4f1ea', '#1d4fa0'),
    9.5, 1.3, fx - side * 0.14, 3.1, zSuper, -side * Math.PI / 2, true);

  // 3) Immeuble National (avec sa grille de balcons et son grand panneau vertical à gauche, d'après quartier 1 appocalyspe.jfif)
  const zNat = zSuper - wSuper / 2 - 15, wNat = 24, hNat = 16.5, xNat = side * (FRONT + 8);
  b.box(16, hNat, wNat, 0xded5be, xNat, hNat / 2, zNat)
    .box(0.18, 3.2, wNat - 1, 0x262a30, fx, 1.6, zNat);
  // Grille de loggias sur 3 étages à droite
  for (let f = 1; f <= 3; f++) {
    const y = f * 3.7 + 0.5;
    for (let k = -10; k <= 2; k += 3.6) {
      b.box(0.3, 2.4, 2.8, 0x2a3038, fx - side * 0.05, y + 1.2, zNat + k)
        .box(0.35, 0.95, 3.0, 0xd2c7ae, fx - side * 0.25, y + 0.48, zNat + k);
    }
  }
  // Grand panneau publicitaire vertical sur la partie gauche de la façade
  signs.add('nat_billboard', () => signTexture('CONGO MIKILI', 'Transfert rapide · Mobile Money', '#1d6fd1', '#ffffff'),
    5.8, 9.5, fx - side * 0.18, 9.6, zNat + 7.5, -side * Math.PI / 2, true);
  signs.add('national_shop', () => signTexture('NATIONAL', 'Électroménager · Supermarché', '#b81d24', '#ffffff'),
    14, 1.45, fx - side * 0.16, 3.35, zNat - 2, -side * Math.PI / 2, true);
}

/** Terrain vague : muret de parpaings inachevé, tas de sable et de briques. */
function addLot(b, side, z, w) {
  const x = side * (FRONT + 0.2);
  if (chance(0.6)) for (let k = -w / 2; k < w / 2 - 1; k += rand(2.5, 4)) b.box(0.22, rand(0.6, 1.6), rand(1.5, 2.6), 0x9b968c, x, 0.5, z + k + 1);
  if (chance(0.5)) b.add(new THREE.ConeGeometry(rand(1, 1.8), rand(0.6, 1), 7), 0xc9a26e, side * (FRONT + rand(3, 7)), 0.35, z + rand(-w / 3, w / 3));
  if (chance(0.4)) b.box(1.6, 0.6, 1.2, 0x8f8a80, side * (FRONT + rand(3, 7)), 0.3, z + rand(-w / 3, w / 3));
}

/** Réservoirs de carburant (dépôt près de l'aéroport, d'après OpenStreetMap). */
function addTanks(b, side, z) {
  for (const [dx, dz] of [[70, -18], [70, 8], [92, -18], [92, 8], [114, -18], [114, 8]]) {
    b.cyl(9, 9, 11, 0xeeeeea, side * dx, 5.5, z + dz, 0, 0, 0, 18).cyl(9.1, 9.1, 0.5, 0xb8bcc2, side * dx, 11, z + dz, 0, 0, 0, 18);
  }
}

/**
 * Église de Jésus-Christ des Saints des Derniers Jours (à gauche, juste après l'Entrée Mikondo vers Maman Mobutu) :
 * parcelle clôturée avec grille et pelouse arborée, chapelle claire à toit en pente, haute flèche blanche (clocher)
 * et panneau officiel noir et blanc au bord du boulevard.
 */
function addLDSChurch(b, signs, side, z) {
  const x = side * (FRONT + 0.2), bx = side * (FRONT + 13.5), H = 6.8;
  // Pelouse verte soignée et allée pavée
  b.box(24, 0.05, 30, 0x5c8a3e, side * (FRONT + 12), 0.025, z)
    .box(10, 0.06, 6.5, 0xc8c4bc, side * (FRONT + 5), 0.03, z);
  // Clôture basse en briques claires + piliers + grilles métalliques sombres
  for (const [z0, z1] of [[z + 3.5, z + 14.5], [z - 3.5, z - 14.5]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.32, 0.95, len, 0xe8e2d5, x, 0.48, zc)
      .box(0.10, 1.35, len, 0x262a30, x, 1.62, zc);
  }
  for (let dz = -14; dz <= 14; dz += 3.5) {
    if (Math.abs(dz) < 3) continue;
    b.box(0.45, 2.4, 0.45, 0xe8e2d5, x, 1.2, z + dz);
  }
  // Corps de la chapelle (façade beige/crème et soubassement brique claire, toit à deux pans gris ardoise)
  b.box(14, H, 22, 0xf2eee6, bx, H / 2, z)
    .box(14.3, 1.4, 22.3, 0xc9a982, bx, 0.7, z)
    .box(8.2, 0.28, 23.2, 0x3b424c, bx - side * 3.4, H + 1.15, z, 0, 0, side * 0.30)
    .box(8.2, 0.28, 23.2, 0x3b424c, bx + side * 3.4, H + 1.15, z, 0, 0, -side * 0.30);
  // Porche d'entrée à pignon blanc et hautes fenêtres verticales
  b.box(3.4, 5.4, 6.4, 0xf7f5f0, side * (FRONT + 5.6), 2.7, z)
    .box(3.8, 0.35, 6.8, 0xd8d2c5, side * (FRONT + 5.6), 5.5, z);
  for (let dz = -8; dz <= 8; dz += 4) {
    if (Math.abs(dz) < 2.5) continue;
    b.box(0.18, 3.2, 1.2, 0x2c3e50, side * (FRONT + 6.45), 3.4, z + dz);
  }
  // Haute flèche blanche caractéristique (clocher pyramidal élancé) au-dessus de la chapelle
  const sx = side * (FRONT + 9.5), sz = z + 2.5;
  b.box(2.2, 4.2, 2.2, 0xf7f7f5, sx, H + 2.6, sz)
    .box(2.5, 0.3, 2.5, 0xdad6cc, sx, H + 4.7, sz)
    .cyl(0.85, 1.15, 3.8, 0xfafaf8, sx, H + 6.6, sz, 0, 0, 0, 8)
    .cyl(0.06, 0.75, 6.5, 0xffffff, sx, H + 11.6, sz, 0, 0, 0, 8);
  // Panneau officiel sur socle à l'entrée + enseigne sur la façade
  const px = side * (ROAD_EDGE + 2.6), pz = z + 9.5;
  b.box(0.55, 1.1, 4.4, 0xc9a982, px, 0.55, pz);
  signs.add(`lds_road_${side}_${z}`, () => signTexture('ÉGLISE DE JÉSUS-CHRIST', 'DES SAINTS DES DERNIERS JOURS', '#1b2430', '#ffffff'),
    4.2, 1.35, px, 1.85, pz + 0.08, 0, true);
  signs.add(`lds_wall_${side}_${z}`, () => signTexture('ÉGLISE DE JÉSUS-CHRIST', 'DES SAINTS DES DERNIERS JOURS', '#1b2430', '#ffffff'),
    10.5, 1.45, side * (FRONT + 6.35), 5.6, z, -side * Math.PI / 2, true);
}

/** Maison Communale (Masina à l'Entrée BKTF Pascal, Kimbanseke en face de la Station Angel). */
function addCommune(b, signs, side, z, communeName, gateSub, keyPrefix) {
  const x = side * (FRONT + 0.2), bx = side * (FRONT + 12.5), H = 8.4;
  // Mur d'enceinte administratif blanc et bleu avec piliers et portail ouvert sur la cour
  for (const [z0, z1] of [[z + 5, z + 15], [z - 5, z - 15]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.30, 2.1, len, 0xf2f4f8, x, 1.05, zc)
      .box(0.34, 0.42, len, 0x1d4fa0, x, 2.25, zc);
  }
  b.box(0.55, 4.6, 0.55, 0x1d4fa0, x, 2.3, z - 4.8)
    .box(0.55, 4.6, 0.55, 0x1d4fa0, x, 2.3, z + 4.8)
    .box(0.45, 0.65, 10.4, 0x1d4fa0, x, 4.75, z)
    .box(22, 0.05, 30, 0x8e9399, side * (FRONT + 11), 0.025, z);
  // Bâtiment principal de la Maison Communale (R+1 blanc et bleu roi, porche à colonnes, bandeau tricolore)
  b.box(14, H, 26, 0xf4f5f7, bx, H / 2, z)
    .box(14.5, 0.65, 26.5, 0x1d4fa0, bx, H + 0.32, z)
    .box(14.6, 0.22, 26.6, 0xf5c400, bx, H - 0.1, z)
    .box(14.6, 0.22, 26.6, 0xd62828, bx, 4.2, z)
    .box(3.2, 4.2, 9.6, 0xe8ecf2, side * (FRONT + 4.8), 2.1, z)
    .box(3.5, 0.35, 10.2, 0x1d4fa0, side * (FRONT + 4.8), 4.35, z);
  for (const dz of [-4.2, -1.5, 1.5, 4.2]) {
    b.box(0.38, 4.2, 0.38, 0x1d4fa0, side * (FRONT + 3.4), 2.1, z + dz);
  }
  for (const f of [1.8, 5.8]) {
    for (let dz = -10; dz <= 10; dz += 4) {
      b.box(0.16, 1.4, 2.1, 0x1e2d3d, side * (FRONT + 5.42), f, z + dz);
    }
  }
  // Mât et drapeau de la RDC dans la cour d'honneur + enseignes officielles (portail, façade et bord de route)
  addFlag(b, signs, side * (FRONT + 3.2), z + 8.5, 9.5);
  signs.add(`${keyPrefix}_gate`, () => signTexture(`COMMUNE DE ${communeName}`, gateSub, '#1d4fa0', '#f5c400'),
    9.8, 1.25, x - side * 0.24, 4.75, z, -side * Math.PI / 2, true);
  signs.add(`${keyPrefix}_bldg`, () => signTexture(`MAISON COMMUNALE DE ${communeName}`, 'Ville de Kinshasa · République Démocratique du Congo', '#ffffff', '#1d4fa0'),
    14, 1.5, side * (FRONT + 5.35), 7.3, z, -side * Math.PI / 2, true);
  const rx = side * (ROAD_EDGE + 2.5), rz = z + 11.5;
  b.box(0.16, 3.8, 0.16, 0x1d4fa0, rx - side * 1.3, 1.9, rz)
    .box(0.16, 3.8, 0.16, 0x1d4fa0, rx + side * 1.3, 1.9, rz);
  signs.add(`${keyPrefix}_road`, () => signTexture(`COMMUNE DE ${communeName}`, 'Maison Communale', '#1d4fa0', '#f5c400'),
    4.6, 1.3, rx, 3.5, rz + 0.08, 0, true);
}

/** Entrée de Petro Congo (SEP Congo) : route d'accès, mur d'enceinte, portail, cuves et enseigne. */
function addPetroCongo(b, signs, side, z) {
  const x = side * (FRONT + 0.2);
  for (const [z0, z1] of [[z + 6, z + 20], [z - 6, z - 22]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.3, 2.6, len, 0xf2efe8, x, 1.3, zc).box(0.32, 0.5, len, 0x1b6f3a, x, 2.85, zc);
  }
  b.box(0.15, 2.4, 9, 0x8e949a, side * (FRONT + 6), 1.2, z)                                   // portail en retrait
    .box(0.7, 5.2, 0.7, 0x1b6f3a, x, 2.6, z - 5.6).box(0.7, 5.2, 0.7, 0x1b6f3a, x, 2.6, z + 5.6)
    .box(0.4, 0.6, 12, 0x1b6f3a, x, 5.4, z);
  // Cuves cylindriques blanches SEP Congo visibles derrière le mur d'enceinte
  for (const dz of [-11, 9]) {
    b.cyl(5.5, 5.5, 9.5, 0xeeeeea, side * (FRONT + 18), 4.75, z + dz, 0, 0, 0, 16)
      .cyl(5.6, 5.6, 0.45, 0x1b6f3a, side * (FRONT + 18), 9.5, z + dz, 0, 0, 0, 16);
  }
  signs.add('petro', () => signTexture('PETRO CONGO', 'SEP Congo · Entrée', '#1b6f3a'), 9, 1.4, x - side * 0.25, 5.4, z, -side * Math.PI / 2, true);
}

/**
 * Entrée d'une grande avenue / boulevard transversal (Mikondo, SIFORCO, Kimbuta, Matete, 7e Rue…) :
 * chaussée latérale bitumée avec marquage axial, dalot en béton sur le caniveau, bordures d'angle
 * peintes rouge et blanc, stationnement de motos-taxis (wewas) sous parasol au coin et panneau « ENTRÉE … ».
 */
function addSideRoad(b, details, signs, r) {
  // (entrée de la boucle de Masina : seulement l'embouchure, la route elle-même est construite par addMasina)
  const s = r.side, L = sideRoadLen(r), rw = r.triangle ? 10 : r.w + 2;      // (link : embouchure seule, la suite est MAT_PB)
  if (r.triangle) {
    // Carrefour d'entrée en triangle (ex. Entrée Siforco) : deux branches en Y encadrant un îlot triangulaire central
    const mouthW = 19;
    b.box(16, 0.035, mouthW, 0x5c5e63, s * (ROAD_EDGE + 8), 0.025, r.z)
      .box(2.4, 0.18, mouthW + 1.2, 0xb8b2a6, s * (ROAD_EDGE + 1.3), 0.08, r.z);
    if (!r.masina) b.box(L - 14, 0.035, 10.5, 0x5c5e63, s * (ROAD_EDGE + 14 + (L - 14) / 2), 0.025, r.z);
    // Îlot triangulaire central bordé de rouge/blanc et engazonné au milieu de l'embouchure
    const tx = s * (ROAD_EDGE + 6.4), rotY = s > 0 ? 0 : Math.PI;
    b.add(new THREE.CylinderGeometry(4.6, 4.8, 0.26, 3).rotateY(rotY), 0xd62828, tx, 0.13, r.z)
      .add(new THREE.CylinderGeometry(4.1, 4.2, 0.30, 3).rotateY(rotY), 0xf2efe8, tx, 0.16, r.z)
      .add(new THREE.CylinderGeometry(3.4, 3.5, 0.34, 3).rotateY(rotY), 0x4b7f35, tx, 0.19, r.z);
    // Panneau « ENTRÉE SIFORCO » planté directement sur le triangle + grand panneau publicitaire à deux mâts et marché d'entrée (f_654)
    b.box(0.16, 4.0, 0.16, 0x8e949a, tx - s * 1.2, 2.0, r.z + 1.2)
      .box(0.16, 4.0, 0.16, 0x8e949a, tx + s * 1.2, 2.0, r.z + 1.2);
    signs.add(`side_${r.side}_${r.z}`, () => signTexture(r.name, r.sub ?? 'Entrée', '#1d4fa0'), 4.8, 1.35, tx, 3.6, r.z + 1.28, 0, true);
    // Grand panneau publicitaire double-mât sur l'îlot triangulaire de Siforco (« LA SCIENCE DE LA PEAU · POUR UN ÉCLAT PARFAIT »)
    b.cyl(0.18, 0.22, 7.6, 0x2a2f35, tx - s * 0.4, 3.8, r.z - 1.8)
      .cyl(0.18, 0.22, 7.6, 0x2a2f35, tx - s * 0.4, 3.8, r.z + 1.8)
      .box(0.38, 3.4, 6.8, 0x1e242b, tx - s * 0.4, 6.8, r.z)
      .box(0.44, 3.6, 7.0, 0xd8d8d2, tx - s * 0.4, 6.8, r.z);
    signs.add(`sif_bill_a_${r.z}`, () => signTexture('LA SCIENCE DE LA PEAU', 'Pour un éclat parfait · Entrée Siforco', '#8b1e3f', '#ffffff'), 6.6, 3.2, tx - s * 0.65, 6.8, r.z, -s * Math.PI / 2, true);
    signs.add(`sif_bill_b_${r.z}`, () => signTexture('BIENVENUE À MASINA', 'Route Siforco · Quartier Sans-Fil', '#0055a4', '#f5c400'), 6.6, 3.2, tx - s * 0.15, 6.8, r.z, s * Math.PI / 2, true);
    // (l'auteur, 13/11 : « dans l'entrée Siforco, enlève les éléments qui se trouvent sur le macadam ») : le portique d'affichage et les cinq étals
    // sous parasols qui étaient posés sur le goudron de l'embouchure sont enlevés (au bord : la station Cobil d'un côté, l'arrêt Siforco de l'autre)
    for (const dz of [-mouthW / 2 - 0.35, mouthW / 2 + 0.35]) {
      b.box(6.0, 0.24, 0.42, 0xd62828, s * (ROAD_EDGE + 3.0), 0.12, r.z + dz);
    }
  } else if (r.moboma) {
    // Entrée d'une rue de Kingasani (Moboma, souvent très en biais) : goudron évasé jusqu'au début de la rue (addMoboma), bordures d'angle
    // peintes rouge et blanc le long de l'évasement, sable du bas-côté autour ; panneau à deux faces du côté de l'angle ouvert
    const M = mobMouth(r);
    if (M) {
      b.box(FRONT - ROAD_EDGE, 0.04, M.hi - M.lo, 0xc0956a, -(FRONT + ROAD_EDGE) / 2, 0.0, (M.hi + M.lo) / 2);
      flatPoly(b, M.poly, M.r.paved ? 0.046 : 0.03, M.r.paved ? 0x5c5e63 : LATERITE);
      for (const [p, q] of M.edges) {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(L / 1.5)), ry = Math.atan2(q[0] - p[0], q[1] - p[1]);
        for (let k = 0; k < n; k++) b.box(0.42, 0.24, L / n - 0.02, k % 2 ? 0xeeeae2 : 0xd62828, p[0] + (q[0] - p[0]) * (k + 0.5) / n, 0.12, p[1] + (q[1] - p[1]) * (k + 0.5) / n, 0, ry, 0);
      }
    }
    const k = r.ang < 0 ? -1 : 1, x = -(ROAD_EDGE + 2.6), zc = r.z + k * (sideHalf(r) + 2.4);
    b.box(0.14, 3.8, 0.14, 0x8e949a, x - 1.2, 1.9, zc).box(0.14, 3.8, 0.14, 0x8e949a, x + 1.2, 1.9, zc);
    for (const [dz, ry] of [[0.08, 0], [-0.08, Math.PI]]) signs.add(`side_${r.side}_${r.z}`, () => signTexture(r.name, r.sub ?? 'Entrée', '#1d4fa0'), 4.4, 1.25, x, 3.4, zc + dz, ry, true);
  } else if (r.ang) {
    // Avenue en biais (ex. Entrée Matete) : embouchure évasée au bord du boulevard, puis chaussée, bordures et tirets
    // dans l'axe de la route (u : direction de la route en s'éloignant du boulevard, n : perpendiculaire)
    const a = r.ang * Math.PI / 180, u = [s * Math.cos(a), -Math.sin(a)], n = [Math.sin(a), s * Math.cos(a)], ry = s > 0 ? a : Math.PI - a;
    const P = e => [s * ROAD_EDGE + u[0] * e, r.z + u[1] * e], e0 = 4;
    const [cx0, cz0] = P(e0), N = [[cx0 + n[0] * rw / 2, cz0 + n[1] * rw / 2], [cx0 - n[0] * rw / 2, cz0 - n[1] * rw / 2]].sort((p, q) => q[1] - p[1]);
    flatPoly(b, [[s * (ROAD_EDGE - 0.3), r.z + r.w / 2], N[0], N[1], [s * (ROAD_EDGE - 0.3), r.z - r.w / 2]], 0.03, 0x5c5e63);
    const [mx, mz] = P(e0 + (L - e0) / 2);
    b.box(L - e0 + 0.4, 0.035, rw, 0x5c5e63, mx, 0.025, mz, 0, ry, 0)
      .box(2.4, 0.18, r.w + 1.6, 0xb8b2a6, s * (ROAD_EDGE + 1.3), 0.08, r.z);
    for (const k of [-1, 1]) {
      const [bx, bz] = P(5 + (L - 5) / 2);
      b.box(L - 5, 0.20, 0.38, 0xb8b2a6, bx + k * n[0] * (rw / 2 + 0.35), 0.10, bz + k * n[1] * (rw / 2 + 0.35), 0, ry, 0);
    }
    for (let dx = 8; dx < L - 6; dx += 8) { const [tx, tz] = P(dx); b.box(3.5, 0.045, 0.18, 0xecece6, tx, 0.03, tz, 0, ry, 0); }
    const x = s * (ROAD_EDGE + 2.2), zc = r.z + r.w / 2 + 1.6;
    b.box(0.14, 3.8, 0.14, 0x8e949a, x - s * 1.2, 1.9, zc)
      .box(0.14, 3.8, 0.14, 0x8e949a, x + s * 1.2, 1.9, zc);
    signs.add(`side_${r.side}_${r.z}`, () => signTexture(r.name, r.sub ?? 'Entrée', '#1d4fa0'), 4.4, 1.25, x, 3.4, zc + 0.08, 0, true);
  } else {
    // Chaussée de l'avenue latérale + dalot béton au-dessus du caniveau
    if (!r.masina) b.box(L, 0.035, rw, 0x5c5e63, s * (ROAD_EDGE + L / 2), 0.025, r.z);
    b.box(2.4, 0.18, rw + 1.6, 0xb8b2a6, s * (ROAD_EDGE + 1.3), 0.08, r.z);
    // Bordures latérales peintes rouge et blanc à l'embouchure
    for (const dz of [-rw / 2 - 0.35, rw / 2 + 0.35]) {
      if (!r.masina) b.box(L - 5, 0.20, 0.38, 0xb8b2a6, s * (ROAD_EDGE + 5 + (L - 5) / 2), 0.10, r.z + dz);
      b.box(5.0, 0.24, 0.42, 0xd62828, s * (ROAD_EDGE + 2.6), 0.12, r.z + dz);
    }
    // Grand panneau d'entrée d'avenue au coin, bien lisible depuis le boulevard
    const x = s * (ROAD_EDGE + 2.2), zc = r.z + rw / 2 + 1.6;
    b.box(0.14, 3.8, 0.14, 0x8e949a, x - s * 1.2, 1.9, zc)
      .box(0.14, 3.8, 0.14, 0x8e949a, x + s * 1.2, 1.9, zc);
    signs.add(`side_${r.side}_${r.z}`, () => signTexture(r.name, r.sub ?? 'Entrée', '#1d4fa0'), 4.4, 1.25, x, 3.4, zc + 0.08, 0, true);
  }
  // Tirets blancs au centre de la route d'entrée (route en biais : déjà tracés dans son axe)
  if (!r.ang && !r.masina) for (let dx = r.triangle ? 16 : 6; dx < L - 6; dx += 8) {
    b.box(3.5, 0.045, 0.18, 0xecece6, s * (ROAD_EDGE + dx), 0.03, r.z);
  }
  // Parasol et regroupement de motos-taxis (wewas) et piétons au coin de l'entrée (côté avant, hors de la route en biais)
  if (r.z < Z_FORK && extZone(r.z) === 'triomphal') return;
  const d = details.at(r.z), ta = Math.tan(r.ang * Math.PI / 180), ca = Math.cos(r.ang * Math.PI / 180);
  const wx = s * (ROAD_EDGE + 4.5), wz = r.z - (r.triangle ? 9.5 : r.ang ? 4.5 * ta + rw / 2 / ca : rw / 2) - 2.4;
  d.cyl(0.04, 0.04, 2.2, 0x555555, wx, 1.1, wz)
    .add(new THREE.ConeGeometry(1.6, 0.65, 8), pick(UMBRELLAS), wx, 2.35, wz);
  addPerson(d, wx + s * 0.9, wz + 0.6, { ry: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
  addPerson(d, wx - s * 0.6, wz - 0.7, { ry: 0 });
}

/**
 * Arrêt de bus / taxis-bus officiel le long du boulevard :
 * encoche / aire d'arrêt pavée, abribus couvert avec banc, panneau « ARRÊT … »,
 * passagers qui attendent au bord de la chaussée et vendeuses sous parasol.
 */
function addBusStop(b, details, signs, z, label, side = 1) {
  const shelterCol = POPULAR ? 0x1d4fa0 : 0x2c3e50;
  const roofCol = POPULAR ? 0xf5c400 : 0xd8dce2;
  const E = side * ROAD_EDGE;
  // Dalot béton couvrant le caniveau + quai d'attente pavé en retrait de la chaussée
  b.box(1.8, 0.18, 22, 0xb8b2a6, E + side * 1.3, 0.08, z)
    .box(4.6, 0.14, 24, 0xc8c3b8, E + side * 4.4, 0.07, z);
  // Bordure jaune et noire officielle d'arrêt de bus le long de la voie extérieure
  for (let k = -10; k < 10; k += 2) {
    b.box(0.50, 0.24, 1.9, (k / 2) % 2 === 0 ? 0xf5c400 : 0x1a1a1a, E + side * 0.32, 0.12, z + k + 1);
  }
  // Abribus (bien en retrait à ROAD_EDGE + 5.3 pour laisser le quai et la zone d'arrêt totalement dégagés)
  const sx = E + side * 5.3;
  b.box(0.12, 2.5, 6.0, shelterCol, sx + side * 0.85, 1.25, z)
    .box(2.1, 0.15, 6.6, roofCol, sx, 2.55, z, 0, 0, side * 0.08)
    .box(0.55, 0.10, 4.8, 0x7a5a3a, sx + side * 0.35, 0.54, z); // banc
  for (const dz of [-2.8, 2.8]) {
    b.box(0.10, 2.5, 0.10, 0x555b62, sx - side * 0.75, 1.25, z + dz)
      .box(0.10, 2.5, 0.10, 0x555b62, sx + side * 0.85, 1.25, z + dz);
  }
  // Grand panneau d'arrêt (« ARRÊT ... ») placé à l'entrée de la zone d'arrêt, bien lisible en approchant dans le sens de la chaussée
  const pz = z + side * 9.2, ry = side > 0 ? 0 : Math.PI;
  b.cyl(0.07, 0.09, 3.8, 0x1d4fa0, E + side * 2.3, 1.9, pz);
  signs.add(`stop${side}_${z}`, () => signTexture(`ARRÊT ${label.toUpperCase()}`, 'Taxis · Taxis-bus · Transco', '#f5c400', '#111111'),
    3.8, 1.15, E + side * 2.3, 3.5, pz + side * 0.08, ry, true);

  // Passagers en attente sous l'abribus et sur le quai (sans gêner le client principal en bord de chaussée)
  const d = details.at(z);
  for (let i = 0; i < 5; i++) {
    const px = E + side * (i < 2 ? 5.4 : rand(2.6, 4.4));
    const pz2 = i < 2 ? z + (i === 0 ? -1.4 : 1.4) : z + rand(3.5, 8.2) * (i % 2 ? 1 : -1);
    addPerson(d, px, pz2, { sitting: i < 2, ry: -side * Math.PI / 2 + rand(-0.25, 0.25) });
  }
}

/** REGIDESO (distribution d'eau) : enceinte bleue et blanche, bâtiment de bureaux, enseigne. */
function addRegideso(b, signs, side, z) {
  const x = side * (FRONT + 0.2);
  b.box(0.3, 2.4, 34, 0xf2f2ee, x, 1.2, z).box(0.32, 0.5, 34, 0x1d5fbf, x, 2.6, z)
    .box(0.15, 2.2, 6, 0x1d5fbf, x - side * 0.05, 1.1, z - 6);
  const bx = side * (FRONT + 16), H = 9;
  b.box(20, H, 28, 0xeef1f4, bx, H / 2, z).box(20.4, 0.6, 28.4, 0x1d5fbf, bx, H + 0.3, z);
  for (const f of [1, 2]) b.box(0.08, 1.4, 24, 0x34495e, side * (FRONT + 5.95), f * 3.6 - 0.6, z);
  signs.add(`regideso_${side}_${z}`, () => signTexture('REGIDESO', "Usine de Traitement d'Eau · N'djili", '#1d5fbf'), 11, 1.8, side * (FRONT + 5.9), 7.2, z, -side * Math.PI / 2, true);
  const rx = side * (ROAD_EDGE + 2.5), rz = z + 14;
  b.box(0.16, 3.8, 0.16, 0x1d5fbf, rx - side * 1.2, 1.9, rz)
    .box(0.16, 3.8, 0.16, 0x1d5fbf, rx + side * 1.2, 1.9, rz);
  signs.add(`regideso_road_${side}_${z}`, () => signTexture('REGIDESO N\'DJILI', "Usine de Traitement d'Eau", '#1d5fbf', '#ffffff'),
    4.6, 1.3, rx, 3.5, rz + 0.08, 0, true);
}

/**
 * Kin Marché (Quartier 1 N'djili) + immeuble en briques rouges à grande verrière en arche (demi-lune)
 * et totem vertical rouge « KIN MARCHÉ » au bord du boulevard (d'après la vidéo v1_t277s.jpg).
 */
function addKinMarche(b, signs, side, z) {
  const x = side * (FRONT + 9), fx = side * (FRONT - 0.05), H = 8.5;
  b.box(18, H, 18, 0xe8e6e0, x, H / 2, z)
    .box(18.4, 0.6, 18.4, 0xc8102e, x, H + 0.3, z)
    .box(0.12, 3.8, 15, 0x2c3e50, fx, 2.1, z)
    .box(3.2, 0.18, 16.5, 0xc8102e, side * (FRONT - 1.5), 4.0, z, 0, 0, -side * 0.10);
  signs.add(`kinmarche_${side}_${z}`, () => signTexture('KIN MARCHÉ', 'Supermarché · Alimentation', '#c8102e'), 10, 1.7, side * (FRONT - 0.14), 6.2, z, -side * Math.PI / 2, true);

  // Grand totem vertical rouge « KIN MARCHÉ » en bordure de chaussée (vu dans v1_t277s.jpg), double-face
  const tx = side * (ROAD_EDGE + 2.8), tz = z + 8.5;
  b.box(2.2, 7.8, 0.45, 0xc8102e, tx, 3.9, tz)
    .box(2.4, 0.4, 0.50, 0xf5c400, tx, 7.9, tz);
  for (const [dz, ry] of [[0.26, 0], [-0.26, Math.PI]]) {
    signs.add(`kinmarche_totem_${side}_${z}`, () => signTexture('KIN MARCHÉ', 'Supermarché', '#c8102e', '#ffffff'),
      2.1, 4.2, tx, 5.2, tz + dz, ry, true);
  }

  if (side > 0) {
    // Immeuble en briques rouges à grande fenêtre cintrée en demi-lune et panneau sur le toit (juste avant Kin Marché au Q1 dans v1_t277s.jpg)
    const zBrick = z + 19, hBrick = 13.5, xBrick = side * (FRONT + 8.5);
    b.box(16, hBrick, 16, 0xa83e2b, xBrick, hBrick / 2, zBrick)
      .box(16.6, 0.5, 16.6, 0xe6dfd3, xBrick, hBrick + 0.25, zBrick)
      .box(0.18, 3.2, 14, 0x1e2630, fx, 1.6, zBrick)
      // Grande baie vitrée rectangulaire surmontée d'une arche en plein cintre (demi-lune) entourée d'un bandeau blanc
      .box(0.22, 4.8, 9.6, 0xf2efe8, fx - side * 0.04, 6.8, zBrick)
      .box(0.28, 4.4, 8.8, 0x1c2d3d, fx - side * 0.08, 6.7, zBrick)
      .add(new THREE.CylinderGeometry(4.8, 4.8, 0.24, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2),
        0xf2efe8, fx - side * 0.04, 9.2, zBrick)
      .add(new THREE.CylinderGeometry(4.3, 4.3, 0.30, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2),
        0x1c2d3d, fx - side * 0.08, 9.2, zBrick);
    // Structure de panneau publicitaire sur le toit de l'immeuble en briques
    b.box(0.25, 3.6, 0.25, 0x454a52, fx - side * 1.5, hBrick + 1.8, zBrick - 3.5)
      .box(0.25, 3.6, 0.25, 0x454a52, fx - side * 1.5, hBrick + 1.8, zBrick + 3.5);
    signs.add('q1_rooftop', () => signTexture('ORANGE MONEY', 'Transfert & Paiement mobile', '#ff6600', '#ffffff'),
      8.8, 2.8, fx - side * 1.6, hBrick + 2.4, zBrick, -side * Math.PI / 2, true);
  }
}

/** Dépôt Transco Limete (s = 12348) : grands hangars bleus de maintenance et bus Transco alignés (vidéo kyZZyIOLUNw). */
function addTranscoDepot(scene, b, signs, side, z) {
  const x = side * (FRONT + 22);
  // Mur d'enceinte blanc et bleu avec large portail ouvert
  for (const [z0, z1] of [[z + 10, z + 42], [z - 10, z - 42]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.32, 2.4, len, 0xf2f4f7, side * (FRONT + 0.2), 1.2, zc)
      .box(0.36, 0.45, len, 0x1d4fa0, side * (FRONT + 0.2), 2.55, zc);
  }
  // Cour bétonnée et grands ateliers à toiture bleue Transco
  b.box(42, 0.05, 84, 0x6c7075, side * (FRONT + 21), 0.025, z)
    .box(22, 8.2, 64, 0xe8ecf0, x + side * 8, 4.1, z)
    .box(23.2, 0.7, 65.2, 0x1d4fa0, x + side * 8, 8.5, z)
    .box(23.4, 0.25, 65.4, 0xd62828, x + side * 8, 8.0, z);
  signs.add('transco_depot', () => signTexture('DÉPÔT TRANSCO LIMETE', 'Transport au Congo · Atelier Central', '#1d4fa0', '#f5c400'),
    12, 1.8, side * (FRONT + 0.2), 4.6, z, -side * Math.PI / 2, true);
  b.box(0.35, 5.2, 0.35, 0x1d4fa0, side * (FRONT + 0.2), 2.6, z - 5.5)
    .box(0.35, 5.2, 0.35, 0x1d4fa0, side * (FRONT + 0.2), 2.6, z + 5.5);
  // Trois grands bus Transco blancs à bande tricolore garés dans le dépôt
  for (const dz of [-20, 0, 20]) {
    const bus = createCityBus();
    place(bus, side * (FRONT + 11), z + dz, side > 0 ? -Math.PI / 2 + 0.25 : Math.PI / 2 - 0.25, 0);
    scene.add(bus);
  }
}

/** Shop Vodacom (à gauche dans l'Arrêt Bonamak, 30 m après Kin Marché) : façade rouge et blanche, vitrine et totem M-Pesa. */
function addVodacomShop(b, signs, side, z) {
  const x = side * (FRONT + 7.5), fx = side * (FRONT - 0.05), H = 7.4;
  b.box(15, H, 15, 0xf7f7f7, x, H / 2, z)
    .box(15.4, 1.6, 15.4, 0xe60000, x, H - 0.6, z)
    .box(0.14, 3.6, 12.5, 0x1a2634, fx, 1.9, z)
    .box(2.8, 0.20, 14.2, 0xe60000, side * (FRONT - 1.3), 3.85, z, 0, 0, -side * 0.08);
  signs.add(`vodacom_wall_${side}_${z}`, () => signTexture('SHOP VODACOM', 'M-Pesa · Cartes SIM · Smartphones 4G/5G', '#e60000', '#ffffff'),
    11.5, 1.5, side * (FRONT - 0.14), 6.2, z, -side * Math.PI / 2, true);
  // Totem vertical rouge et blanc Vodacom / M-Pesa au bord de l'arrêt (double-face)
  const tx = side * (ROAD_EDGE + 2.7), tz = z + 7.2;
  b.box(1.9, 6.4, 0.40, 0xe60000, tx, 3.2, tz)
    .box(2.05, 0.35, 0.46, 0xffffff, tx, 6.45, tz);
  for (const [dz, ry] of [[0.24, 0], [-0.24, Math.PI]]) {
    signs.add(`vodacom_totem_${side}_${z}`, () => signTexture('VODACOM', 'Shop Bonamak · M-Pesa', '#e60000', '#ffffff'),
      1.8, 3.2, tx, 4.3, tz + dz, ry, true);
  }
}

/** Shop Airtel (juste avant l'entrée Kimbuta, l'auteur) : boutique blanche à bandeau rouge, vitrine, totem au bord. */
function addAirtelShop(b, signs, side, z) {
  const x = side * (FRONT + 6), fx = side * (FRONT - 0.05), H = 5.2, RED = 0xe40000;
  b.box(12, H, 11, 0xf7f7f7, x, H / 2, z).box(12.4, 1.2, 11.4, RED, x, H - 0.4, z)
    .box(0.14, 3.0, 9, 0x1a2634, fx, 1.7, z).box(2.4, 0.2, 10.4, RED, side * (FRONT - 1.1), 3.4, z, 0, 0, -side * 0.08);
  signs.add(`airtel_wall_${side}_${Math.round(z)}`, () => signTexture('SHOP AIRTEL', 'Airtel Money · Cartes SIM · Recharges', '#e40000', '#ffffff'),
    9, 1.1, side * (FRONT - 0.26), 4.8, z, -side * Math.PI / 2, true);
  const tx = side * (ROAD_EDGE + 2.7), tz = z - 5;
  b.box(1.6, 5.2, 0.38, RED, tx, 2.6, tz).box(1.75, 0.3, 0.44, 0xffffff, tx, 5.3, tz);
  for (const [dz, ry] of [[0.22, 0], [-0.22, Math.PI]]) {
    signs.add(`airtel_totem_${side}_${Math.round(z)}`, () => signTexture('AIRTEL', 'Shop · Kimbuta', '#e40000', '#ffffff'), 1.5, 2.6, tx, 3.6, tz + dz, ry, true);
  }
}

/** Mosquée (Badara ; Mosquée Atwa en face de Kimbuta) : salle blanche à bandeau vert et fenêtres en arc, coupole verte,
 *  minaret à balcon et croissant (côté arrivée du taxi), mur d'enceinte blanc et vert avec portail et enseigne. */
function addMosque(b, signs, side, z, p) {
  const GREEN = 0x1f7a3d, WHITE = 0xf3f1ea, GOLD = 0xd4af37, x0 = FRONT + 5, D = 15, W = 18, H = 6.5, xc = side * (x0 + D / 2);
  b.box(D, H, W, WHITE, xc, H / 2, z).box(D + 0.5, 0.5, W + 0.5, GREEN, xc, H + 0.25, z)                 // salle de prière
    .cyl(4.2, 4.5, 1.2, WHITE, xc, H + 1.1, z, 0, 0, 0, 16).ball(4.3, GREEN, xc, H + 1.7, z, 1, 0.7, 1)   // tambour et coupole
    .cyl(0.08, 0.08, 1.4, GOLD, xc, H + 5.3, z)
    .add(new THREE.TorusGeometry(0.4, 0.09, 6, 12, Math.PI * 1.5), GOLD, xc, H + 6.3, z, 0, Math.PI / 2, 0);
  for (let k = -2; k <= 2; k++) {                                          // fenêtres en arc
    const wz = z + k * 3.3, wx = side * (x0 - 0.05);
    b.box(0.1, 2.2, 1.3, 0x2a3540, wx, 2.3, wz).ball(0.65, 0x2a3540, wx, 3.4, wz, 0.15, 1, 1);
  }
  const mx = side * (x0 + 2.2), mz = z + W / 2 + 1.6;                       // minaret
  b.cyl(1.0, 1.2, 15, WHITE, mx, 7.5, mz, 0, 0, 0, 10).cyl(1.6, 1.6, 0.5, GREEN, mx, 12, mz, 0, 0, 0, 10)
    .cyl(0.8, 0.8, 2.4, WHITE, mx, 16.2, mz, 0, 0, 0, 10).add(new THREE.ConeGeometry(1.0, 2.4, 10), GREEN, mx, 18.6, mz)
    .add(new THREE.TorusGeometry(0.32, 0.07, 6, 12, Math.PI * 1.5), GOLD, mx, 20.3, mz, 0, Math.PI / 2, 0);
  const wx = side * (FRONT + 0.2);                                         // mur d'enceinte et portail
  for (const [a, c] of [[z + W / 2 + 4, z + 2.4], [z - 2.4, z - W / 2 - 2]]) {
    b.box(0.3, 1.8, a - c, WHITE, wx, 0.9, (a + c) / 2).box(0.36, 0.25, a - c, GREEN, wx, 1.9, (a + c) / 2);
  }
  for (const e of [-1, 1]) b.box(0.5, 3.4, 0.5, WHITE, wx, 1.7, z + e * 2.4);
  b.box(0.36, 0.7, 5.3, GREEN, wx, 3.05, z);
  signs.add(`mosq_${side}_${Math.round(z)}`, () => signTexture(p.name ?? 'MOSQUÉE', p.sub ?? '', '#1f7a3d', '#ffffff'),
    4.8, 1.0, wx - side * 0.2, 3.05, z, -side * Math.PI / 2, true);
}

/** Shop d'Orange à 2 niveaux (R+1, à droite à 30 m après le Pont Bonamak) : façade noire et orange vif, 2 étages vitrés et totem. */
function addOrangeShop(b, signs, side, z) {
  const x = side * (FRONT + 8), fx = side * (FRONT - 0.05), H = 8.8;
  // Corps du bâtiment R+1 (2 niveaux) noir anthracite et bandeaux Orange (#ff6600)
  b.box(16, H, 18, 0x1c1e22, x, H / 2, z)
    .box(16.4, 0.7, 18.4, 0xff6600, x, H + 0.3, z)
    .box(16.3, 0.45, 18.3, 0xff6600, x, 4.3, z)
    // Rez-de-chaussée (1er niveau) : grande vitrine + auvent Orange
    .box(0.14, 3.6, 14.5, 0x162432, fx, 1.9, z)
    .box(2.8, 0.20, 16.0, 0xff6600, side * (FRONT - 1.3), 3.9, z, 0, 0, -side * 0.08);
  // 2e niveau (étage) : baies vitrées encadrées d'orange
  for (let dz = -6; dz <= 6; dz += 4) {
    b.box(0.18, 2.3, 2.8, 0xff6600, fx - side * 0.02, 5.9, z + dz)
      .box(0.22, 2.0, 2.5, 0x1c2d3e, fx - side * 0.05, 5.9, z + dz);
  }
  signs.add(`orange_wall_${side}_${z}`, () => signTexture('SHOP ORANGE', 'Orange Money · Fibre · Smartphones 4G/5G', '#ff6600', '#ffffff'),
    13.5, 1.45, side * (FRONT - 0.14), 7.8, z, -side * Math.PI / 2, true);
  // Totem vertical noir et orange au bord du boulevard (double-face)
  const tx = side * (ROAD_EDGE + 2.7), tz = z + 8.5;
  b.box(1.9, 6.6, 0.42, 0x181818, tx, 3.3, tz)
    .box(2.05, 0.45, 0.48, 0xff6600, tx, 6.65, tz);
  for (const [dz, ry] of [[0.25, 0], [-0.25, Math.PI]]) {
    signs.add(`orange_totem_${side}_${z}`, () => signTexture('ORANGE', 'Shop · Orange Money', '#ff6600', '#111111'),
      1.8, 3.4, tx, 4.5, tz + dz, ry, true);
  }
}

/** Immeuble de 3 niveaux appelé « MBUJIMAYI KANANGA » (à droite, 30 m après le Shop d'Orange). */
function addMbujimayiKananga(b, signs, side, z) {
  const x = side * (FRONT + 9), fx = side * (FRONT - 0.05), H = 12.2;
  // Corps de l'immeuble R+2 (3 niveaux bien marqués par des dalles et balcons)
  b.box(18, H, 22, 0xf2ece0, x, H / 2, z)
    .box(18.5, 0.65, 22.5, 0x1d4fa0, x, H + 0.3, z)
    // Rez-de-chaussée commercial (niveau 1) avec piliers et auvent
    .box(0.14, 3.4, 19, 0x22303e, fx, 1.8, z)
    .box(2.6, 0.20, 20.5, 0x1d4fa0, side * (FRONT - 1.2), 3.7, z, 0, 0, -side * 0.08);
  // Dalles de balcons et fenêtres des niveaux 2 et 3
  for (const [lvlY, railCol] of [[4.1, 0xd62828], [8.0, 0x1d4fa0]]) {
    b.box(2.2, 0.24, 21.4, 0xe4ddd0, side * (FRONT - 0.9), lvlY, z)
      .box(0.12, 0.95, 21.2, railCol, side * (FRONT - 1.9), lvlY + 0.55, z);
    for (let dz = -8; dz <= 8; dz += 4) {
      b.box(0.18, 2.1, 2.4, 0x1e2d3d, fx - side * 0.04, lvlY + 1.5, z + dz);
    }
  }
  for (let dz = -9; dz <= 9; dz += 6) {
    b.box(0.45, H, 0.45, 0x1d4fa0, side * (FRONT - 0.2), H / 2, z + dz);
  }
  signs.add(`mbujimayi_wall_${side}_${z}`, () => signTexture('IMMEUBLE MBUJIMAYI KANANGA', 'Galerie Commerciale · Bureaux · 3 Niveaux', '#1d4fa0', '#f5c400'),
    16, 1.55, side * (FRONT - 0.25), 11.2, z, -side * Math.PI / 2, true);
  // Panneau en bord de route bien lisible en approchant
  const rx = side * (ROAD_EDGE + 2.6), rz = z + 10.5;
  b.box(0.16, 4.2, 0.16, 0x1d4fa0, rx - side * 1.3, 2.1, rz)
    .box(0.16, 4.2, 0.16, 0x1d4fa0, rx + side * 1.3, 2.1, rz);
  signs.add(`mbujimayi_road_${side}_${z}`, () => signTexture('MBUJIMAYI KANANGA', 'Immeuble Commercial · 3 Niveaux', '#1d4fa0', '#f5c400'),
    4.6, 1.35, rx, 3.7, rz + 0.08, 0, true);
}

/** École appelée « LUKA » (à droite, 30 m après Mbujimayi Kananga et 20 m avant le Saut-de-mouton Pascal). */
function addEcoleLuka(b, details, signs, side, z) {
  const x = side * (FRONT + 0.2), bx = side * (FRONT + 13), H = 7.8;
  // Mur de clôture scolaire blanc et bleu roi avec portail d'entrée et cour de récréation
  for (const [z0, z1] of [[z + 4.5, z + 15], [z - 4.5, z - 15]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.30, 2.1, len, 0xf5f7fa, x, 1.05, zc)
      .box(0.34, 0.45, len, 0x1d5fbf, x, 2.28, zc);
  }
  // Arche du portail de l'École LUKA
  b.box(0.55, 4.6, 0.55, 0x1d5fbf, x, 2.3, z - 4.3)
    .box(0.55, 4.6, 0.55, 0x1d5fbf, x, 2.3, z + 4.3)
    .box(0.45, 0.7, 9.4, 0x1d5fbf, x, 4.75, z)
    .box(24, 0.05, 30, 0xc8c2b6, side * (FRONT + 12), 0.025, z);
  // Bâtiment scolaire R+1 blanc et bleu avec coursives extérieures et toit en tôle bleue
  b.box(12, H, 26, 0xf7f8fa, bx, H / 2, z)
    .box(13.2, 0.4, 27, 0x1d5fbf, bx, H + 0.2, z)
    .box(2.4, 0.22, 26, 0xe2e6ec, side * (FRONT + 5.8), 3.9, z)
    .box(0.14, 1.0, 25.8, 0x1d5fbf, side * (FRONT + 4.7), 4.5, z)
    .box(0.14, 1.0, 25.8, 0x1d5fbf, side * (FRONT + 4.7), 0.5, z);
  for (let dz = -11; dz <= 11; dz += 4.4) {
    b.box(0.32, H, 0.32, 0x1d5fbf, side * (FRONT + 4.7), H / 2, z + dz);
    for (const fy of [2.0, 5.8]) {
      b.box(0.16, 1.3, 2.4, 0x1e2f42, side * (FRONT + 6.95), fy, z + dz);
    }
  }
  // Drapeau de la RDC dans la cour de l'école + élèves
  addFlag(b, signs, side * (FRONT + 3.5), z + 8.5, 9.0);
  const d = details.at(z);
  for (const [dx, dz] of [[3.5, -2.5], [4.2, 1.8], [5.0, -5.0]]) {
    addPerson(d, side * (FRONT + dx), z + dz, { ry: -side * Math.PI / 2 });
  }
  signs.add(`luka_gate_${side}_${z}`, () => signTexture('ÉCOLE LUKA', 'Complexe Scolaire · Primaire & Secondaire', '#1d5fbf', '#ffffff'),
    8.8, 1.25, x - side * 0.24, 4.75, z, -side * Math.PI / 2, true);
  signs.add(`luka_bldg_${side}_${z}`, () => signTexture('COMPLEXE SCOLAIRE LUKA', 'Éducation · Discipline · Excellence', '#ffffff', '#1d5fbf'),
    15, 1.45, side * (FRONT + 6.85), 7.1, z, -side * Math.PI / 2, true);
  const rx = side * (ROAD_EDGE + 2.5), rz = z + 12.5;
  b.box(0.16, 3.8, 0.16, 0x1d5fbf, rx - side * 1.2, 1.9, rz)
    .box(0.16, 3.8, 0.16, 0x1d5fbf, rx + side * 1.2, 1.9, rz);
  signs.add(`luka_road_${side}_${z}`, () => signTexture('ÉCOLE LUKA', 'Complexe Scolaire Luka', '#1d5fbf', '#f5c400'),
    4.4, 1.3, rx, 3.5, rz + 0.08, 0, true);
}

/** Stade Municipal de Masina (TPF gis_osm_buildings s=6640, à droite après Pascal). */
function addStadeMasina(b, signs, side, z, L = 36) {
  // L : longueur le long du boulevard (le stade va jusqu'à l'entrée BKTF, l'auteur et OSM : 6 638–6 742 m)
  const x = side * (FRONT + 0.2), bx = side * (FRONT + 18), h = L / 2 - 1;
  // Mur d'enceinte blanc/vert/jaune avec portail et tribune couverte + pylônes d'éclairage
  b.box(34, 0.05, L, 0x3f8236, bx, 0.025, z);
  for (const [z0, z1] of [[z + 5, z + h], [z - 5, z - h]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.32, 2.5, len, 0xf2f4f8, x, 1.25, zc)
      .box(0.36, 0.45, len, 0x1b7a3d, x, 2.65, zc);
  }
  b.box(0.6, 5.0, 0.6, 0x1b7a3d, x, 2.5, z - 4.8)
    .box(0.6, 5.0, 0.6, 0x1b7a3d, x, 2.5, z + 4.8)
    .box(0.5, 0.75, 10.4, 0x1b7a3d, x, 5.15, z)
    // Tribune latérale couverte
    .box(8, 6.2, L - 8, 0xd8dce2, side * (FRONT + 7.5), 3.1, z)
    .box(10, 0.35, L - 7, 0x1d4fa0, side * (FRONT + 8.2), 7.6, z, 0, 0, -side * 0.12);
  for (const dz of [-(L / 2 - 4), L / 2 - 4]) {
    b.cyl(0.14, 0.22, 16, 0x8e949a, side * (FRONT + 6), 8, z + dz)
      .box(0.6, 1.2, 2.2, 0xf5f5f0, side * (FRONT + 5.8), 16.2, z + dz);
  }
  signs.add(`stade_masina_${z}`, () => signTexture('STADE MUNICIPAL DE MASINA', 'Commune de Masina · Football & Jeunesse', '#1b7a3d', '#f5c400'),
    9.8, 1.3, x - side * 0.25, 5.15, z, -side * Math.PI / 2, true);
}

// ---------- Pont Matete ----------
// D'après le croquis de l'auteur (forme et emplacements) et ses photos (aspect). Le chemin de fer passe sous le
// pont : à gauche il part tout droit en travers, à droite en biais (direction (0,8 ; -0,6) en coordonnées route).
const RAIL_RY = Math.atan2(0.8, -0.6);   // boîte dont la longueur `d` suit la partie en biais
/** Point à `u` mètres le long d'une ligne en biais passant par (0, z0), décalé de `n` en travers. */
const alongRail = (z0, u, n = 0) => [u * 0.8 + n * 0.6, z0 - u * 0.6 + n * 0.8];
const ASPHALT_COL = 0x45474e;                      // (rues et liaisons : du même gris foncé que les boulevards)
const CURB_DARK = 0x2a2a2a, CURB_LIGHT = 0xeeeeea;   // bordures noir et blanc des photos
const FILL_COL = 0xa8958a;                           // murs en pierre des bretelles en remblai

/** Talus du remblai : mosaïque de pierres aux joints clairs (photos du Pont Matete). */
function mosaicTexture() {
  const t = canvasTexture(256, 256, (x, w) => {
    x.fillStyle = '#dad0c3'; x.fillRect(0, 0, w, w);
    const n = 6, c = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const cx = (i + 0.5) * c + rand(-5, 5), cy = (j + 0.5) * c + rand(-5, 5);
      x.fillStyle = pick(['#a47f74', '#9b8a80', '#b08c7f', '#8f7f76', '#a8968a', '#b39385']);
      x.beginPath();
      for (let a = 0; a < 7; a++) {
        const ang = a / 7 * Math.PI * 2 + rand(-0.2, 0.2), r = c * rand(0.36, 0.46);
        x.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      }
      x.closePath(); x.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Point d'une courbe de Bézier (de degré quelconque) en coordonnées (x, z). */
function bez(pts, t) {
  let p = pts;
  while (p.length > 1) p = p.slice(1).map((q, i) => [p[i][0] + (q[0] - p[i][0]) * t, p[i][1] + (q[1] - p[i][1]) * t]);
  return p[0];
}

/**
 * Route suivant une courbe de Bézier : chaussée, axe pointillé, bordures noir et blanc. `height(t)` la pose sur
 * un remblai à murs de pierre (bretelle qui descend du boulevard). innerFrom : pas de bordure côté boulevard
 * sur les premiers segments (la route n'en est pas encore séparée).
 */
function bezierRoad(b, pts, w, n, { innerFrom = 0, innerTo = Infinity, innerSkip = null, outerFrom = 0, outerTo = Infinity, outerSkip = null, outerSign = 0, height = () => 0, dash = true, rail = true } = {}) {
  for (let i = 0; i < n; i++) {
    const [ax, az] = bez(pts, i / n), [bx, bz] = bez(pts, (i + 1) / n);
    const ha = height(i / n), hb = height((i + 1) / n), hm = (ha + hb) / 2;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz), rx = Math.atan2(ha - hb, len);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, px = dz / len, pz = -dx / len;
    const hf = Math.min(ha, hb) - 0.08;                // remblai sous le bas du segment (ne traverse pas la chaussée en pente)
    if (hf > 0.05) b.box(w + 0.8, hf, len + 0.3, FILL_COL, mx, hf / 2, mz, 0, ry, 0);
    b.box(w, 0.05, len + 0.5, ASPHALT_COL, mx, hm + 0.04, mz, rx, ry, 0);
    if (dash && i % 2 === 0) b.box(0.18, 0.02, len * 0.5, 0xf2f2ec, mx, hm + 0.075, mz, rx, ry, 0);
    const curbs = [-1, 1].map(k => [mx + k * px * (w / 2 + 0.15), mz + k * pz * (w / 2 + 0.15)]);
    if (outerSign) { if (outerSign > 0) curbs.reverse(); }
    else curbs.sort((a, c) => Math.abs(c[0]) - Math.abs(a[0]));   // [extérieure, intérieure (côté axe)]
    if (i < innerFrom || i >= innerTo || (innerSkip && i >= innerSkip[0] && i < innerSkip[1])) curbs.pop();
    if (i < outerFrom || i >= outerTo || (outerSkip && i >= outerSkip[0] && i < outerSkip[1])) curbs.shift();
    for (const [cx, cz] of curbs) {
      b.box(0.3, 0.22, len, i % 2 ? CURB_DARK : CURB_LIGHT, cx, hm + 0.11, cz, rx, ry, 0);
      if (rail && hm > 1) b.box(0.06, 0.06, len, 0x6d8aa3, cx, hm + 1.0, cz, rx, ry, 0).box(0.06, 1.0, 0.06, 0x6d8aa3, cx, hm + 0.5, cz);
    }
  }
}

/** Bord de la bretelle (courbe pts, largeur w) le plus proche de l'axe du boulevard, en t. */
function innerEdge(pts, w, t) {
  const [x, z] = bez(pts, t), [ax, az] = bez(pts, Math.max(0, t - 0.01)), [bx, bz] = bez(pts, Math.min(1, t + 0.01));
  const len = Math.hypot(bx - ax, bz - az), nx = (bz - az) / len * w / 2, nz = -(bx - ax) / len * w / 2;
  return Math.abs(x + nx) < Math.abs(x - nx) ? [x + nx, z + nz] : [x - nx, z - nz];
}

/** t où la bretelle s'écarte de `gap` m du bord du boulevard (depuis son début, ou depuis sa fin). */
function tAtGap(pts, w, gap, fromEnd = false) {
  for (let k = 0; k <= 100; k++) {
    const t = fromEnd ? 1 - k / 100 : k / 100;
    if (Math.abs(innerEdge(pts, w, t)[0]) - ROAD_EDGE > gap) return fromEnd ? Math.min(1, t + 0.01) : Math.max(0, t - 0.01);
  }
  return fromEnd ? 0 : 1;
}

/** Goudron continu entre le bord du boulevard et la bretelle, de t0 à t1 : la bretelle est raccordée à la chaussée. */
function fillToEdge(b, pts, w, side, t0, t1, { n = 8, y = 0.05 } = {}) {
  const xE = side * (ROAD_EDGE - 0.3);               // recouvre la ligne de rive : on peut passer d'une chaussée à l'autre
  for (let i = 0; i < n; i++) {
    const a = innerEdge(pts, w, t0 + (t1 - t0) * i / n), c = innerEdge(pts, w, t0 + (t1 - t0) * (i + 1) / n);
    flatPoly(b, [[xE, a[1]], a, c, [xE, c[1]]], y, ASPHALT_COL);
  }
}

/**
 * Fin de la route des rails en biais, de u = 115 (le Y d'Akram) au raccord (u = PL_JOIN_U) : la coupe de la Route Poids Lourds attachée.
 * Le goudron est le même (roadTexture à 2 voies, carreau de 7 m × 12 m, en phase avec celui de la Route Poids Lourds qui commence à z = 4,
 * soit u = PL_JOIN_U - 4), la bande grise et ses deux lignes, les bordures, caniveaux et rebords, le trottoir de béton à gauche, la terre battue.
 * Dans l'élargissement, le goudron montre la voie intérieure, puis les deux voies.
 */
function plWide(scene) {
  const U0 = 115, U1 = PL_JOIN_U + 1, ST = 3, Y = 0.06, F = new Builder();   // (F : en coordonnées de la scène, sans courbure)
  const pt = plPt;
  const us = []; for (let u = U0; u < U1; u += ST) us.push(u); us.push(U1);
  // le goudron des deux sens : bandes de la bande grise au bord, coordonnées de texture comme sur la Route Poids Lourds
  for (const sd of [1, -1]) {
    const half = sd > 0 ? plHalfR : plHalfL, pos = [], uv = [], idx = [];
    us.forEach((u, i) => {
      const a = plMed(u), b = half(u), w = b - a;
      const [x0, z0] = pt(u, sd * a), [x1, z1] = pt(u, sd * b), v = (u - (PL_JOIN_U - 4)) / 12;
      pos.push(x0, Y, z0, x1, Y, z1);
      uv.push(sd > 0 ? 0 : 1, v, sd > 0 ? w / 7 : 1 - w / 7, v);
      if (i) { const k = 2 * i; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    // (le sens des triangles dépend du côté : on garde les faces vers le haut)
    if (sd < 0) { const ix = geo.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: roadTexture(sd < 0, 2, true) }));
    m.receiveShadow = true;
    scene.add(m);
  }
  const seg = (u0, u1, nf, w, h, y, col) => {
    const [ax, az] = pt(u0, nf(u0)), [cx, cz] = pt(u1, nf(u1));
    if (w > 0.01) F.box(w, h, Math.hypot(cx - ax, cz - az) + 0.05, col, (ax + cx) / 2, y, (az + cz) / 2, 0, Math.atan2(cx - ax, cz - az), 0);
  };
  for (let i = 1; i < us.length; i++) {
    const u0 = us[i - 1], u1 = us[i], um = (u0 + u1) / 2;
    // la bande grise du milieu et ses deux lignes blanches (comme la Route Poids Lourds : ni terre-plein ni séparateur)
    seg(u0, u1, () => 0, 2 * plMed(um), 0.02, Y + 0.004, 0x66676a);
    seg(u0, u1, () => 0, 0.2, 0.02, Y + 0.014, 0xf2f2ec);              // (une seule ligne au milieu)
    // bordures, caniveaux, rebords (à droite, après la jonction de la bretelle) ; trottoir de béton à gauche ; terre battue qui s'étale
    for (const sd of [1, -1]) {
      if (sd > 0 && um < 128) continue;
      const half = sd > 0 ? plHalfR : plHalfL, at = o => u => sd * (half(u) + o);
      seg(u0, u1, at(0.14), 0.28, 0.22, 0.11, 0xb7b1a5);
      seg(u0, u1, at(0.9), 1.25, 0.03, 0.03, 0x35302b);
      seg(u0, u1, at(1.62), 0.2, 0.26, 0.1, 0xa8a296);
      if (sd < 0) seg(u0, u1, at(3), 2.5, 0.12, 0.06, 0xb9b3a7);
      const dw = u => 46 * smooth01((u - 150) / (PL_JOIN_U - 150));
      if (um > 150) {
        const a0 = pt(u0, sd * (half(u0) + 1.7)), a1 = pt(u1, sd * (half(u1) + 1.7)), b1 = pt(u1, sd * (half(u1) + 1.7 + dw(u1))), b0 = pt(u0, sd * (half(u0) + 1.7 + dw(u0)));
        flatPoly(F, [a0, a1, b1, b0], 0.02, 0xad9b82);   // (PL_DIRT ; flatPoly tourne la face vers le haut)
      }
    }
  }
  // le chemin de fer en biais (il part de u = 9, à n = -12 sous le pont) : comme celui de la Route Poids Lourds (lit de terre, écartement,
  // traverses) ; il s'écarte puis se dédouble (aiguillage) pour tomber sur ses deux voies au raccord
  const rseg = (u0, u1, nf, off, w, h, y, col) => {
    const [ax, az] = pt(u0, nf(u0) + off), [cx, cz] = pt(u1, nf(u1) + off);
    F.box(w, h, Math.hypot(cx - ax, cz - az) + 0.04, col, (ax + cx) / 2, y, (az + cz) / 2, 0, Math.atan2(cx - ax, cz - az), 0);
  };
  for (const [nf, from] of [[plRailA, 9], [plRailB, 172]]) {
    for (let u = from; u < U1; u += 3) {
      const v = Math.min(U1, u + 3);
      rseg(u, v, nf, 0, 2.6, 0.05, 0.03, 0x9c8b74);                          // lit de terre (PL_DIRT2)
      for (const g2 of [-0.55, 0.55]) rseg(u, v, nf, g2, 0.07, 0.13, 0.12, 0x6d675f);
    }
    for (let u = from + 1.2; u < U1; u += 2.4) {
      const [sx, sz] = pt(u, nf(u)), [tx, tz] = pt(u + 0.5, nf(u + 0.5));
      F.box(1.9, 0.06, 0.26, 0x5e5044, sx, 0.075, sz, 0, Math.atan2(tx - sx, tz - sz), 0);
    }
  }
  const m = new THREE.Mesh(F.geometry(), VC_MAT);
  m.receiveShadow = true;
  scene.add(m);
}

/** Lampadaire solaire à une tête (panneau à plat au sommet), comme sur les photos du Pont Matete. */
function addSolarLamp(b, x, z, toward) {
  b.cyl(0.07, 0.11, 7.6, 0x7e868e, x, 3.8, z)
    .box(1.3, 0.07, 0.07, 0x7e868e, x + toward * 0.6, 7.45, z)
    .box(0.6, 0.12, 0.32, 0xeeeee6, x + toward * 1.2, 7.4, z)
    .box(1.1, 0.06, 0.8, 0x1c2d4a, x, 7.75, z, 0.12, 0, 0);
}

/**
 * Pont Matete (s = 11 496 m), dans l'ordre du croquis de l'auteur, en partant de l'aéroport :
 * 1) À droite : Hôpital Akram, petit îlot ovale de pelouse (les piétons y attendent pour traverser), départ de la
 *    Route Poids Lourds au niveau du sol.
 * 2) Le boulevard monte sur un remblai et passe sur le Pont Matete, au-dessus du chemin de fer et de la route
 *    goudronnée qui le longe (Route Poids Lourds) : tout droit à gauche, en biais à droite.
 * 3) 2e pont : le petit boulevard passe sous le boulevard. De chaque côté, une boucle qui reste de son côté :
 *    elle descend du boulevard juste après le Pont Matete, rejoint le passage sous le 2e pont, puis repart
 *    et revient se rattacher au boulevard après la descente du remblai.
 * (Transco et le Collège Lumumba sont en face de l'Échangeur, sur le petit boulevard : voir addInterchange.)
 */
function addPontMatete(scene, details, signs) {
  const F = new Builder();                 // ouvrages au sol (hauteurs absolues)
  const T = new Builder();                 // berme, garde-corps et lampadaires posés sur le remblai (montés de roadH)
  const H = MAT.H, X0 = ROAD_EDGE + 2.2, K = 1.1;   // bord de la berme, fruit du talus
  const DECK = 0xc9bfae, WALL = 0xb9b0a0, GRASS = 0x5e8f3e;
  const ZR = ZM - 6;                       // axe du chemin de fer
  const ZPL = ZR + 12, ZPD = ZR + 15;      // route des rails : à gauche (tout droit), à droite (ligne en biais par (0, ZPD))
  const ZA1 = ZM + 18, ZA2 = ZM - 14;      // culées du Pont Matete (tout droit à gauche, en biais à droite)
  const B1 = [ZM + 34, ZM - 30], B2 = [ZB2 + 8.5, ZB2 - 8.5];   // tabliers
  const UX = MAT_UX;                       // bout du passage sous le 2e pont, où les deux moitiés de boucle se rejoignent
  // Piétons : dans F au sol (pas dans `details`, que le remblai soulèverait près de l'axe), dans T sur la berme
  const people = (b, x, z, n, spread = 1.5) => {
    for (let i = 0; i < n; i++) addPerson(b, x + rand(-spread, spread) * 0.4, z + rand(-spread, spread), { ry: rand(-1, 1) - Math.sign(x) * Math.PI / 2 });
  };

  // ---------- 1) Chemin de fer (voie unique) : tout droit à gauche, en biais à droite ----------
  F.box(210, 0.3, 3.6, 0x8a8178, -105, 0.12, ZR);
  for (const n of [-0.72, 0.72]) F.box(210, 0.16, 0.09, 0x5b5148, -105, 0.35, ZR + n);
  for (let x = -90; x <= 0; x += 0.75) F.box(0.24, 0.1, 2.4, 0x6b5a48, x, 0.29, ZR);
  // (en biais : voir plWide, qui dessine aussi le chemin de fer)

  // ---------- 2) Route goudronnée le long des rails (Route Poids Lourds), côté aéroport des rails ----------
  F.box(214, 0.05, 8, ASPHALT_COL, -103, 0.035, ZPL);
  // (côté aéroport, bordure et trottoir ouverts au carrefour du petit boulevard de l'Entrée Matete : MAT_PB)
  const pbCut = MAT_PB ? [MAT_PB.xEnd - 7.4, MAT_PB.xEnd + 7.4] : null;
  const atPB = (n, x) => n > 0 && pbCut && x > pbCut[0] && x < pbCut[1];
  for (const n of [-1, 1]) {
    for (const [a, c] of n > 0 && pbCut ? [[-210, pbCut[0]], [pbCut[1], 4]] : [[-210, 4]]) {
      F.box(c - a, 0.2, 0.3, 0xb8b2a6, (a + c) / 2, 0.1, ZPL + n * 4.15).box(c - a, 0.16, 2.2, 0xc6bfb2, (a + c) / 2, 0.08, ZPL + n * 5.4);
    }
  }
  for (let x = -200; x <= 0; x += 6) F.box(3, 0.02, 0.18, 0xf2f2ec, x, 0.065, ZPL);
  for (let x = -40, k = 0; x <= 2; x += 1.5, k++) {
    for (const n of [-1, 1]) if (!atPB(n, x)) F.box(1.45, 0.24, 0.34, k % 2 ? CURB_DARK : CURB_LIGHT, x, 0.11, ZPL + n * 4.15);
  }
  {
    const [x, z] = alongRail(ZPD, 61.5);
    F.box(8, 0.05, 113, ASPHALT_COL, x, 0.035, z, 0, RAIL_RY, 0);       // (jusqu'au Y ; ensuite : plWide, la coupe de la Route Poids Lourds)
    for (const n of [-1, 1]) {
      // (côté bretelle, bordure et trottoir ouverts à la jonction et à son aire de demi-tour : MAT_PL ; après u = 128 : caniveaux de plWide)
      for (const [u0, u1] of n > 0 && MAT_PL ? [[5, 66]] : [[5, 128]]) {
        const [cx, cz] = alongRail(ZPD, (u0 + u1) / 2, n * 4.15);
        F.box(0.3, 0.2, u1 - u0, 0xb8b2a6, cx, 0.1, cz, 0, RAIL_RY, 0);
        const [wx, wz] = alongRail(ZPD, (u0 + u1) / 2, n * 5.4);
        F.box(2.2, 0.16, u1 - u0, 0xc6bfb2, wx, 0.08, wz, 0, RAIL_RY, 0);
      }
    }
    for (let u = 8; u <= 110; u += 6) {
      const [mx, mz] = alongRail(ZPD, u);
      F.box(0.18, 0.02, 3, 0xf2f2ec, mx, 0.065, mz, 0, RAIL_RY, 0);
    }
    for (let u = 5, k = 0; u <= 45; u += 1.5, k++) {
      for (const n of [-1, 1]) {
        const [cx, cz] = alongRail(ZPD, u, n * 4.15);
        F.box(0.34, 0.24, 1.45, k % 2 ? CURB_DARK : CURB_LIGHT, cx, 0.11, cz, 0, RAIL_RY, 0);
      }
    }
  }

  plWide(scene);

  // ---------- 3) Route Poids Lourds qui quitte le boulevard à droite (au niveau du sol) ----------
  // Bretelle tangente au boulevard : la chaussée s'élargit (goudron continu) puis la route s'en sépare. Départ, ovale, panneau
  // et Akram reculés de 40 m vers l'aéroport (l'auteur, 31/10 : « trop près du pont » ; OSM : départ vers 11 050 m) ;
  // MATETE_GAPS et MATETE_ZONE suivent
  const plPts = MAT_PL_PTS;                         // (même courbe pour la conduite : MAT_PL ; fin = alongRail(ZPD, 115))
  const plSep = tAtGap(plPts, 8, 4.2);
  bezierRoad(F, plPts, 8, 30, { innerFrom: Math.ceil(plSep * 30), innerTo: 22, outerTo: 27 });   // (bordures jusqu'à l'aire et la route des rails)
  fillToEdge(F, plPts, 8, 1, 0, plSep, { n: 12 });
  // Aire de demi-tour à la jonction avec la route des rails : on y repart vers le Pont Matete pour passer dessous (MAT_PL)
  if (MAT_PL) {
    const [px, pz] = MAT_PL.pad;
    flatPoly(F, Array.from({ length: 20 }, (_, k) => [px + MAT_PL.padR * Math.cos(k * Math.PI / 10), pz + MAT_PL.padR * Math.sin(k * Math.PI / 10)]), 0.058, ASPHALT_COL);
  }
  // Îlot ovale de pelouse entre le boulevard et la Route Poids Lourds
  const ovX = ROAD_EDGE + 2.8, ovZ = ZM + 134;
  F.add(new THREE.CylinderGeometry(1, 1, 0.16, 18).scale(1.75, 1, 6.4), CURB_DARK, ovX, 0.08, ovZ)
    .add(new THREE.CylinderGeometry(1, 1, 0.2, 18).scale(1.5, 1, 6), GRASS, ovX, 0.1, ovZ);
  people(F, ovX, ovZ, 3, 3);
  const plX = ROAD_EDGE + 2.6, plZ = ZM + 186;
  F.box(0.16, 4.0, 0.16, 0x8e949a, plX - 1.3, 2.0, plZ).box(0.16, 4.0, 0.16, 0x8e949a, plX + 1.3, 2.0, plZ);
  signs.add('matete_pl', () => signTexture('ROUTE POIDS LOURDS ↗', 'Chemin de fer · Matete · Kingabwa', '#1d4fa0', '#f5c400'),
    4.8, 1.35, plX, 3.6, plZ + 0.08, 0, true);

  // Centre Hospitalier AKRAM : à droite, derrière le départ de la Route Poids Lourds
  {
    const zA = ZM + 152, fx = 33, hx = fx + 7.5, h = 9.6;
    F.box(18, 0.05, 28, 0x8e9399, hx - 2, 0.025, zA);
    for (const [z0, z1] of [[zA + 4.5, zA + 13], [zA - 4.5, zA - 13]]) {
      const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
      F.box(0.30, 2.1, len, 0xf7f9fb, fx - 2.5, 1.05, zc).box(0.34, 0.40, len, 0x0b7285, fx - 2.5, 2.22, zc);
    }
    F.box(15, h, 24, 0xf7f9fc, hx, h / 2, zA)
      .box(15.5, 0.65, 24.5, 0x0b7285, hx, h + 0.3, zA)
      .box(3.6, 4.0, 8.0, 0xeaf2f8, fx - 0.8, 2.0, zA)
      .box(4.0, 0.38, 8.6, 0xd62828, fx - 0.8, 4.1, zA)
      .box(0.24, 2.4, 0.70, 0xd62828, fx - 0.05, 7.0, zA)
      .box(0.24, 0.70, 2.4, 0xd62828, fx - 0.05, 7.0, zA);
    for (const fy of [2.0, 5.4, 7.8]) {
      for (let dz = -9; dz <= 9; dz += 4.5) {
        if (Math.abs(dz) < 2 && fy > 4) continue;
        F.box(0.18, 1.35, 2.2, 0x1e3246, fx - 0.02, fy, zA + dz);
      }
    }
    signs.add('akram_bldg', () => signTexture('CENTRE HOSPITALIER AKRAM', 'Clinique · Urgences 24h/24 · Pont Matete', '#ffffff', '#c8102e'),
      15, 1.55, fx - 0.06, 8.9, zA, -Math.PI / 2, true);
  }

  // ---------- 4) Remblai : talus en mosaïque de pierres, berme en pelouse, garde-corps, lampadaires ----------
  // Le talus s'arrête aux culées (en biais à droite du Pont Matete, tout droit à gauche) et au 2e pont
  const slopes = s => (s > 0
    ? [[MAT.up0, ZA1 - 0.75 * X0], [ZA2 - 0.75 * X0, ZB2 + 7.5], [ZB2 - 7.5, MAT.down1]]
    : [[MAT.up0, ZA1], [ZA2, ZB2 + 7.5], [ZB2 - 7.5, MAT.down1]]);
  const pos = [], uv = [], TILE = 3, SL = Math.hypot(1, K);
  for (const s of [-1, 1]) {
    for (const [za, zb] of slopes(s)) {
      const n = Math.max(1, Math.ceil((za - zb) / 2));
      for (let i = 0; i < n; i++) {
        const z0 = za - (za - zb) * i / n, z1 = za - (za - zb) * (i + 1) / n, h0 = roadH(z0), h1 = roadH(z1);
        const a = [s * X0, h0, z0], b = [s * (X0 + K * h0), 0, z0], c = [s * (X0 + K * h1), 0, z1], d = [s * X0, h1, z1];
        pos.push(...a, ...b, ...c, ...a, ...c, ...d);
        uv.push(z0 / TILE, 0, z0 / TILE, h0 * SL / TILE, z1 / TILE, h1 * SL / TILE, z0 / TILE, 0, z1 / TILE, h1 * SL / TILE, z1 / TILE, 0);
      }
      // Extrémités du talus (triangles verticaux) au droit des culées
      for (const ze of [za, zb]) {
        const h = roadH(ze);
        if (h < 0.3) continue;
        pos.push(s * X0, h, ze, s * X0, 0, ze, s * (X0 + K * h), 0, ze);
        uv.push(0, 0, 0, h / TILE, K * h / TILE, h / TILE);
      }
    }
    // Berme en pelouse au sommet du talus (hors tabliers)
    const berm = [[MAT.up0, B1[0]], [B1[1], B2[0]], [B2[1], MAT.down1]];
    for (const [za, zb] of s === MAT_RAMP?.s ? minus(berm, [MAT_RAMP_GAP]) : berm) {   // (départ de l'Entrée Matete)
      for (const [p, q] of pieces(za, zb, 40)) T.box(1.6, 0.2, p - q, GRASS, s * (ROAD_EDGE + 1.4), 0.1, (p + q) / 2);
    }
    for (const [p, q] of [B1, B2]) T.box(1.6, 0.25, p - q, 0xc9c3b6, s * (ROAD_EDGE + 1.4), 0.12, (p + q) / 2);
  }
  const slopeGeo = new THREE.BufferGeometry();
  slopeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  slopeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  slopeGeo.computeVertexNormals();
  const slopeMesh = new THREE.Mesh(bendGeometry(slopeGeo), new THREE.MeshLambertMaterial({ map: mosaicTexture(), side: THREE.DoubleSide }));
  slopeMesh.receiveShadow = true;
  scene.add(slopeMesh);

  // Garde-corps tubulaire gris-bleu là où le remblai dépasse ~1 m (les boucles restent au sol ; ouvert seulement au départ de
  // l'Entrée Matete, à gauche juste après le Pont Matete), lampadaires solaires
  let zr0 = MAT.up0, zr1 = MAT.down1;
  while (roadH(zr0) < 0.9) zr0 -= 0.5;
  while (roadH(zr1) < 0.9) zr1 += 0.5;
  for (const s of [-1, 1]) {
    const x = s * (ROAD_EDGE + 2.1);
    for (const [a, c] of s === MAT_RAMP?.s ? minus([[zr0, zr1]], [MAT_RAMP_GAP]) : [[zr0, zr1]]) {
      for (const [p, q] of pieces(a, c, 40)) {
        T.box(0.07, 0.07, p - q, 0x6d8aa3, x, 1.1, (p + q) / 2).box(0.06, 0.06, p - q, 0x6d8aa3, x, 0.6, (p + q) / 2);
      }
      for (let z = a; z >= c; z -= 2.4) T.box(0.07, 1.1, 0.07, 0x6d8aa3, x, 0.55, z);
    }
    for (let z = MAT.up0 - 12 - (s > 0 ? 0 : 11); z > MAT.down1 + 6; z -= 22) {
      if (s === MAT_RAMP?.s && z < MAT_RAMP_GAP[0] + 2 && z > MAT_RAMP_GAP[1] - 2) continue;
      addSolarLamp(T, s * (ROAD_EDGE + 1.5), z, -s);
    }
  }
  people(T, ROAD_EDGE + 1.3, ZM - 56, 2);

  // ---------- 5) Pont Matete : tablier, culées, piles entre la voie ferrée et la route ----------
  F.box(2 * (ROAD_EDGE + 2.4), 1.2, B1[0] - B1[1], DECK, 0, H - 0.6, (B1[0] + B1[1]) / 2);
  for (const za of [ZA1, ZA2]) {
    F.box(X0, H - 1.2, 0.9, WALL, -X0 / 2, (H - 1.2) / 2, za);                         // à gauche : tout droit
    const [x, z] = alongRail(za, X0 / 0.8 / 2);
    F.box(0.9, H - 1.2, X0 / 0.8, WALL, x, (H - 1.2) / 2, z, 0, RAIL_RY, 0);           // à droite : en biais
  }
  const pier = (x, z, ry) => F.box(0.9, H - 1.7, 1.8, 0xc4beb0, x, (H - 1.7) / 2, z, 0, ry, 0)
    .box(1.5, 0.5, 2.8, 0xd0cabd, x, H - 1.45, z, 0, ry, 0);
  for (const x of [-16, -8, -1]) for (const z of [ZM - 2.5, ZM - 11]) pier(x, z, Math.PI / 2);
  for (const u of [4, 12, 20]) for (const zl of [ZM - 1.5, ZM - 11]) pier(...alongRail(zl, u), RAIL_RY);
  // Piétons à l'abri sous le pont (photos)
  for (const x of [-12, -6]) people(F, x, ZPL - 5.4, 2, 1);
  for (const u of [8, 14]) people(F, ...alongRail(ZPD, u, -5.4), 2, 1);
  // Nom du pont : au bord de la chaussée en arrivant, et sur la face du tablier pour ceux d'en bas
  const nmX = ROAD_EDGE + 1.4, nmZ = ZM + 38;          // panneaux de bord de route : montés avec le remblai (raise)
  T.box(0.14, 2.8, 0.14, 0x8e949a, nmX - 1.4, 1.4, nmZ - 0.08).box(0.14, 2.8, 0.14, 0x8e949a, nmX + 1.4, 1.4, nmZ - 0.08);
  signs.add('pont_matete', () => signTexture('PONT MATETE', 'Chemin de fer · Route Poids Lourds', '#1d4fa0'), 4.8, 1.3, nmX, 2.3, nmZ, 0, true);
  for (const s of [-1, 1]) {
    signs.add('pont_matete_face', () => signTexture('PONT MATETE', 'Boulevard Lumumba', '#c9bfae', '#1d3557'),
      9, 0.9, s * (ROAD_EDGE + 2.42), -0.6, ZM + 2 - s * 8, s * Math.PI / 2, true);
  }

  // ---------- 6) 2e pont : le petit boulevard passe sous le boulevard ----------
  F.box(2 * (ROAD_EDGE + 2.4), 1.2, B2[0] - B2[1], DECK, 0, H - 0.6, ZB2);
  for (const dz of [7.95, -7.95]) F.box(2 * X0, H - 1.2, 0.9, WALL, 0, (H - 1.2) / 2, ZB2 + dz);
  F.box(2 * UX + 6, 0.05, 8, ASPHALT_COL, 0, 0.035, ZB2);
  for (const k of [-1, 1]) F.box(2 * UX, 0.16, 1.8, 0xc6bfb2, 0, 0.08, ZB2 + k * 5);
  for (let x = -UX + 3; x <= UX - 3; x += 6) F.box(3, 0.02, 0.18, 0xf2f2ec, x, 0.065, ZB2);
  for (let x = -UX + 1, k = 0; x <= UX - 1; x += 1.5, k++) {
    for (const dz of [-4.15, 4.15]) F.box(1.45, 0.24, 0.34, k % 2 ? CURB_DARK : CURB_LIGHT, x, 0.11, ZB2 + dz);
  }
  people(F, -3, ZB2 + 5, 2, 2);
  people(F, 6, ZB2 - 5, 2, 2);

  // ---------- 7) Une boucle de chaque côté, au sol (croquis) ----------
  // Elle part du passage sous le 2e pont, s'écarte en arrondi et revient se rattacher au boulevard
  // après la descente du remblai (goudron continu au raccord). Rien ne part du haut du remblai.
  for (const s of [-1, 1]) {
    const loop = matLoopPts(s);                      // (même tracé pour la conduite : MAT_LOOPS)
    const tJoin = tAtGap(loop, 7.5, 3.2, true);
    const link = MAT_RAMP?.s === s ? [Math.round((MAT_TJ - MAT_TDT) * 30), Math.round((MAT_TJ + MAT_TDT) * 30)] : null;   // (Entrée Matete)
    bezierRoad(F, loop, 7.5, 30, { innerTo: Math.floor(tJoin * 30), outerSkip: link });
    fillToEdge(F, loop, 7.5, s, tJoin, 1, { n: 8 });
    addSolarLamp(F, s * 55, ZB2 - 20, -s);
    addSolarLamp(F, s * 32, ZB2 - 40, s);
    // Panneau au bord du boulevard, au raccord de la boucle
    const sx = s * (ROAD_EDGE + 1.6), sz = ZB2 - 80 + (s > 0 ? 0 : -26);
    F.box(0.14, 2.8, 0.14, 0x8e949a, sx - 1.4, 1.4, sz).box(0.14, 2.8, 0.14, 0x8e949a, sx + 1.4, 1.4, sz);
    signs.add(`matete_loop_${s}`, () => signTexture('PETIT BOULEVARD', 'Sous le 2e pont · Demi-tour', '#1d4fa0', '#f5c400'),
      4.8, 1.3, sx, 2.3, sz + (s > 0 ? 0.08 : -0.08), s > 0 ? 0 : Math.PI, true);
  }

  // ---------- 8) À gauche, entre le Pont Matete et le 2e pont : triangle de pelouse au pied du remblai ----------
  // (entre la bretelle de l'Entrée Matete et le passage sous le 2e pont, comme sur le croquis de l'auteur du 31/10)
  {
    const tri = [[-25.5, ZM - 54], [-33, ZM - 64], [-25.5, ZM - 71]];
    flatPoly(F, tri, 0.2, GRASS);
    for (let i = 0; i < 3; i++) {
      const [a, c] = [tri[i], tri[(i + 1) % 3]], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      for (let k = 0; k < Math.floor(len / 1.5); k++) {
        const u = (k + 0.5) / Math.floor(len / 1.5);
        F.box(0.3, 0.24, len / Math.floor(len / 1.5), k % 2 ? CURB_DARK : CURB_LIGHT, a[0] + (c[0] - a[0]) * u, 0.12, a[1] + (c[1] - a[1]) * u, 0, Math.atan2(c[0] - a[0], c[1] - a[1]), 0);
      }
    }
    people(F, -28.2, ZM - 63, 2, 1.2);
  }

  // ---------- 9) À gauche : l'Entrée Matete vers la boucle (MAT_RAMP) et le petit boulevard de l'Entrée Matete (MAT_PB) ----------
  if (MAT_RAMP) {
    // Bretelle en remblai à murs de pierre : elle quitte le haut du remblai juste après le Pont Matete et descend vers la boucle
    const M = MAT_RAMP, n = M.pts.length - 1;
    const hOfT = t => {
      const i = Math.min(n - 1, Math.floor(t * n)), v = t * n - i;
      return M.hAt(M.f[i] + (M.f[i + 1] - M.f[i]) * v) + 0.015;
    };
    bezierRoad(F, M.ctrl, 7.5, n, { height: hOfT, innerFrom: Math.ceil(tAtGap(M.ctrl, 7.5, 0.4) * n), innerTo: M.iMouth, outerTo: M.iMouth });
    // Embouchure évasée sur la boucle (la bordure de la boucle y est ouverte), bordures noir et blanc comme la boucle
    flatPoly(F, M.mouth, 0.058, ASPHALT_COL);
    const [Ca, Cb, Eb, Ea] = M.mouth;
    for (const [a, c] of [[Ca, Ea], [Cb, Eb]]) {
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]), m = Math.max(1, Math.round(len / 1.5)), ry = Math.atan2(c[0] - a[0], c[1] - a[1]);
      for (let k = 0; k < m; k++) {
        const u = (k + 0.5) / m;
        F.box(0.3, 0.22, len / m, k % 2 ? CURB_DARK : CURB_LIGHT, a[0] + (c[0] - a[0]) * u, 0.11, a[1] + (c[1] - a[1]) * u, 0, ry, 0);
      }
    }
    // Panneau sur la berme, pour ceux qui arrivent de Limete
    const sx = M.s * (ROAD_EDGE + 1.6), sz = ZM - 52;
    T.box(0.14, 2.8, 0.14, 0x8e949a, sx - 1.4, 1.4, sz).box(0.14, 2.8, 0.14, 0x8e949a, sx + 1.4, 1.4, sz);
    signs.add('matete_entree_boucle', () => signTexture('ENTRÉE MATETE', 'Boucle · Petit boulevard', '#1d4fa0'),
      4.8, 1.3, sx, 2.3, sz - 0.08, Math.PI, true);
  }
  if (MAT_PB) {
    // Petit boulevard de l'Entrée Matete : chaussée, bordures grises comme les avenues, tirets ; carrefour sur la Route Poids Lourds
    const M = MAT_PB, P = M.pts, n = P.length - 1;
    const dir = i => {
      const a = P[Math.max(0, i - 1)], c = P[Math.min(n, i + 1)], l = Math.hypot(c[0] - a[0], c[1] - a[1]);
      return [(c[0] - a[0]) / l, (c[1] - a[1]) / l];
    };
    const E = P.map((p, i) => { const [dx, dz] = dir(i), w = M.hw[i]; return [[p[0] + dz * w, p[1] - dx * w], [p[0] - dz * w, p[1] + dx * w]]; });
    const arc = [0];
    for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const zFlare = ZPL + 4 + 3.4;                          // (coins évasés du carrefour : pas de bordure au-delà)
    for (let i = 0; i < n; i++) {
      flatPoly(F, [E[i][0], E[i + 1][0], E[i + 1][1], E[i][1]], 0.062, ASPHALT_COL);
      if (arc[i] < 2.2 || Math.min(P[i][1], P[i + 1][1]) < zFlare) continue;   // (l'embouchure a ses propres bordures)
      const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], len = Math.hypot(dx, dz);
      for (const k of [0, 1]) {
        const a = E[i][k], c = E[i + 1][k], o = (k ? -0.19 : 0.19) / len;
        F.box(0.38, 0.2, Math.hypot(c[0] - a[0], c[1] - a[1]) + 0.05, 0xb8b2a6, (a[0] + c[0]) / 2 + dz * o, 0.1, (a[1] + c[1]) / 2 - dx * o, 0, Math.atan2(c[0] - a[0], c[1] - a[1]), 0);
      }
    }
    for (let d = 6, i = 1; d < arc[n] - 8; d += 8) {       // tirets dans l'axe, tous les 8 m
      while (arc[i] < d) i++;
      const a = P[i - 1], c = P[i], u = (d - arc[i - 1]) / (arc[i] - arc[i - 1]);
      F.box(0.18, 0.02, 3.5, 0xecece6, a[0] + (c[0] - a[0]) * u, 0.07, a[1] + (c[1] - a[1]) * u, 0, Math.atan2(c[0] - a[0], c[1] - a[1]), 0);
    }
    const xe = M.xEnd;                                     // carrefour en T sur la Route Poids Lourds : coins évasés
    for (const k of [-1, 1]) flatPoly(F, [[xe + k * 4, zFlare], [xe + k * 7.4, ZPL + 4], [xe + k * 4, ZPL + 4]], 0.06, ASPHALT_COL);
  }

  for (const [b, lift] of [[F, false], [T, true]]) {
    const m = new THREE.Mesh(bendGeometry(lift ? raise(b.geometry(), Infinity) : b.geometry()), VC_MAT);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}

/**
 * Petite agence bancaire (Rawbank, l'auteur, 31/10 : « juste une petite agence attachée à la station, un distributeur avec
 * quelques places assises ; le macadam passe derrière ») : kiosque noir à bandeau jaune collé à la station, distributeur
 * sous un auvent côté boulevard, banc et chaises en plastique devant.
 */
function addAtmKiosk(b, signs, side, z, key, p) {
  const x0 = ROAD_EDGE + 4, D = 6.5, L = 4.6, H = 3.1, xc = side * (x0 + D / 2), fx = side * x0;   // façade côté boulevard
  const BLACK = 0x1a1a1a, YELLOW = 0xf5c400;
  b.box(D + 2.4, 0.12, L + 0.8, 0xbdb8ad, xc - side * 1.2, 0.06, z)                      // dalle
    .box(D, H, L, BLACK, xc, H / 2, z).box(D + 0.2, 0.45, L + 0.2, YELLOW, xc, H + 0.2, z)   // kiosque, bandeau jaune
    .box(D - 0.3, 0.06, L - 0.3, BLACK, xc, H + 0.45, z)                                    // toit noir dans le bandeau
    .box(0.1, 2.1, 1.4, 0x1c2b3a, fx - side * 0.02, 1.15, z + 1.3)                        // porte vitrée
    .box(0.55, 1.7, 0.9, 0x8e949a, fx - side * 0.25, 0.85, z - 1.0)                       // distributeur
    .box(0.06, 0.42, 0.62, 0x0d2238, fx - side * 0.54, 1.3, z - 1.0)                      // écran
    .box(1.7, 0.1, L + 0.4, YELLOW, fx - side * 0.85, 2.75, z, 0, 0, -side * 0.08);       // auvent
  // banc métallique et deux chaises en plastique devant le kiosque, un client au distributeur
  const bx = side * (x0 - 1.7);
  b.box(0.5, 0.08, 1.9, 0x6d7177, bx, 0.45, z + 0.9).box(0.08, 0.45, 1.9, 0x6d7177, bx + side * 0.25, 0.7, z + 0.9)
    .box(0.4, 0.42, 1.7, 0x4a4d52, bx, 0.21, z + 0.9);
  for (const dz of [-0.6, -1.5]) {
    b.box(0.44, 0.06, 0.44, 0xe8e8e6, bx, 0.45, z + dz).box(0.06, 0.4, 0.44, 0xe8e8e6, bx + side * 0.22, 0.66, z + dz)
      .box(0.36, 0.42, 0.36, 0xd9d9d6, bx, 0.21, z + dz);
  }
  addPerson(b, bx, z + 1.3, { sitting: true, ry: -side * Math.PI / 2 });
  addPerson(b, fx - side * 1.05, z - 1.0, { ry: side * Math.PI / 2 });
  signs.add(key, () => signTexture(p.name ?? 'RAWBANK', p.sub ?? 'Distributeur · Agence', '#1a1a1a', '#f5c400'),
    4.2, 0.8, fx - side * 0.12, H + 0.2, z, -side * Math.PI / 2, true);
}

/** Hôpital / Centre Hospitalier (Biamba Mutombo, Telema — d'après TPF gis_osm_pois). */
function addHospital(b, signs, side, z, p) {
  const x = side * (FRONT + 0.2), bx = side * (FRONT + 12), H = 9.2;
  for (const [z0, z1] of [[z + 4.5, z + 13], [z - 4.5, z - 13]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.28, 2.0, len, 0xf7f9fb, x, 1.0, zc).box(0.32, 0.38, len, 0x0b7285, x, 2.15, zc);
  }
  b.box(15, H, 22, 0xf7f9fc, bx, H / 2, z)
    .box(15.5, 0.6, 22.5, 0x0b7285, bx, H + 0.3, z)
    .box(3.4, 3.8, 7.6, 0xeaf2f8, side * (FRONT + 3.8), 1.9, z)
    .box(3.8, 0.35, 8.2, 0xd62828, side * (FRONT + 3.8), 3.95, z);
  // Croix rouge médicale en façade
  b.box(0.22, 2.2, 0.65, 0xd62828, side * (FRONT + 4.35), 6.8, z)
    .box(0.22, 0.65, 2.2, 0xd62828, side * (FRONT + 4.35), 6.8, z);
  for (const fy of [2.0, 5.2, 7.6]) {
    for (let dz = -8; dz <= 8; dz += 4) {
      if (Math.abs(dz) < 2 && fy > 4) continue;
      b.box(0.16, 1.3, 2.1, 0x1e3246, side * (FRONT + 4.45), fy, z + dz);
    }
  }
  signs.add(`hosp_bldg_${side}_${z}`, () => signTexture(p.name, p.sub ?? 'Urgences · Maternité · Soins 24h/24', '#ffffff', '#c8102e'),
    13.5, 1.45, side * (FRONT + 4.35), 8.6, z, -side * Math.PI / 2, true);
  const rx = side * (ROAD_EDGE + 2.5), rz = z + 9.5;
  b.box(0.16, 3.8, 0.16, 0x0b7285, rx - side * 1.2, 1.9, rz)
    .box(0.16, 3.8, 0.16, 0x0b7285, rx + side * 1.2, 1.9, rz);
  signs.add(`hosp_road_${side}_${z}`, () => signTexture(`+ ${p.name}`, p.sub ?? 'Hôpital', '#0b7285', '#ffffff'),
    4.6, 1.3, rx, 3.5, rz + 0.08, 0, true);
}

/** École / Université nommée (École ITEC, Université Rév. Kim, C.S. Le Bambino, G.S. Lumumba — d'après TPF). */
function addNamedSchool(b, signs, side, z, p) {
  const x = side * (FRONT + 0.2), bx = side * (FRONT + 12.5), H = 7.6;
  for (const [z0, z1] of [[z + 4, z + 12], [z - 4, z - 12]]) {
    const len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
    b.box(0.28, 2.0, len, 0xf5f7fa, x, 1.0, zc).box(0.32, 0.4, len, 0x1d5fbf, x, 2.18, zc);
  }
  b.box(12, H, 22, 0xf6f8fb, bx, H / 2, z)
    .box(12.6, 0.45, 22.6, 0x1d5fbf, bx, H + 0.2, z)
    .box(2.2, 0.22, 22, 0xe2e6ec, side * (FRONT + 5.6), 3.8, z)
    .box(0.14, 0.95, 21.8, 0x1d5fbf, side * (FRONT + 4.6), 4.35, z);
  for (let dz = -8; dz <= 8; dz += 4) {
    b.box(0.16, 1.3, 2.2, 0x1e2f42, side * (FRONT + 6.45), 2.0, z + dz)
      .box(0.16, 1.3, 2.2, 0x1e2f42, side * (FRONT + 6.45), 5.6, z + dz);
  }
  signs.add(`sch_bldg_${side}_${z}`, () => signTexture(p.name, p.sub ?? 'Enseignement · Kinshasa', '#1d5fbf', '#f5c400'),
    13, 1.45, side * (FRONT + 6.35), 7.0, z, -side * Math.PI / 2, true);
  if (p.noTotem) return;                             // derrière un petit boulevard : pas de panneau au bord du boulevard
  const rx = side * (ROAD_EDGE + 2.5), rz = z + 9.5;
  b.box(0.16, 3.8, 0.16, 0x1d5fbf, rx - side * 1.2, 1.9, rz)
    .box(0.16, 3.8, 0.16, 0x1d5fbf, rx + side * 1.2, 1.9, rz);
  signs.add(`sch_road_${side}_${z}`, () => signTexture(p.name, p.sub ?? 'Établissement', '#1d5fbf', '#ffffff'),
    4.6, 1.3, rx, 3.5, rz + 0.08, 0, true);
}

/** Église paroissiale nommée (ex. Église Sainte-Famille de Masina — d'après TPF gis_osm_pofw). */
function addNamedChurch(b, signs, side, z, p) {
  const bx = side * (FRONT + 11), H = 8.2;
  b.box(14, H, 20, 0xf2ece1, bx, H / 2, z)
    .box(8.0, 0.3, 21, 0x8c3b2b, bx - side * 3.2, H + 1.1, z, 0, 0, side * 0.28)
    .box(8.0, 0.3, 21, 0x8c3b2b, bx + side * 3.2, H + 1.1, z, 0, 0, -side * 0.28)
    // Clocher en façade avec croix
    .box(3.2, 13.5, 3.2, 0xe8dfd1, side * (FRONT + 4.8), 6.75, z + 6.5)
    .box(0.18, 2.2, 0.18, 0xf5c400, side * (FRONT + 4.8), 14.5, z + 6.5)
    .box(0.18, 0.18, 1.3, 0xf5c400, side * (FRONT + 4.8), 14.9, z + 6.5);
  signs.add(`chr_bldg_${side}_${z}`, () => signTexture(p.name, p.sub ?? 'Paroisse', '#7b2cbf', '#ffffff'),
    11, 1.4, side * (FRONT + 3.9), 6.8, z - 1.5, -side * Math.PI / 2, true);
}

/** Brique orange à chevrons de la façade de l'église Shekinah (dalle répétée). */
function brickChevronTexture() {
  if (!TEX_SHARED.has('brickchev')) {
    const t = canvasTexture(64, 64, (x, w, h) => {
      x.fillStyle = '#c9772e'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#8c4a1c'; x.lineWidth = 5; x.lineJoin = 'miter';
      for (const y0 of [8, 40]) { x.beginPath(); x.moveTo(0, y0); x.lineTo(32, y0 + 16); x.lineTo(64, y0); x.stroke(); }
      x.strokeStyle = 'rgba(230,170,100,0.5)'; x.lineWidth = 2;
      for (const y0 of [16, 48]) { x.beginPath(); x.moveTo(0, y0); x.lineTo(32, y0 + 16); x.lineTo(64, y0); x.stroke(); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(26, 3);
    TEX_SHARED.set('brickchev', t);
  }
  return TEX_SHARED.get('brickchev');
}

/**
 * Église Shekinah de Debonhomme (l'auteur, 22/11, photos du dossier shekinanh), à gauche, 70 m de clôture qui finissent 10 m avant la Station Debonhomme : mur beige à piliers
 * surmonté d'une grille verte, portail de tôle gris-bleu à losanges, cour de gravier aux bordures rouges et blanches, arche de tissu bleu et blanc, et l'église en travaux
 * (2 niveaux : brique orange à chevrons et persiennes brun-rouge en bas, ouvertures nues en haut, dalle sans toit, échafaudage de bois au bout).
 */
function addShekinah(b, signs, side, z, p) {
  const L = 70, GZ = 12, x = d => side * (FRONT + d), face = -side * Math.PI / 2;
  const WALL = 0xd2c6a4, GREEN = 0x3c5c52, GATE = 0x6f8c98, WOOD = 0x8a6a3e;
  // clôture : mur bas, piliers tous les 11,6 m, grille (barreaux et deux traverses), portail
  b.box(0.4, 1.3, L, WALL, x(0.5), 0.65, z);
  b.box(0.08, 0.08, L, GREEN, x(0.5), 1.75, z).box(0.08, 0.08, L, GREEN, x(0.5), 2.45, z);
  for (let dz = -L / 2 + 0.5; dz <= L / 2 - 0.4; dz += 0.85) if (Math.abs(dz - GZ) > 4) b.box(0.06, 1.5, 0.06, GREEN, x(0.5), 2.05, z + dz);
  for (let k = -3; k <= 3; k++) b.box(0.8, 3.0, 0.8, WALL, x(0.5), 1.5, z + k * 11.6).box(0.9, 0.2, 0.9, 0xbfb394, x(0.5), 3.05, z + k * 11.6);
  b.box(0.8, 3.2, 0.8, WALL, x(0.5), 1.6, z + GZ - 4.2).box(0.8, 3.2, 0.8, WALL, x(0.5), 1.6, z + GZ + 4.2);
  b.box(0.12, 2.1, 7.6, GATE, x(0.5), 1.05, z + GZ);
  for (let dz = -3.6; dz <= 3.6; dz += 0.5) b.box(0.05, 0.9, 0.05, GREEN, x(0.5), 2.55, z + GZ + dz);
  b.box(0.08, 0.08, 7.6, GREEN, x(0.5), 2.2, z + GZ).box(0.08, 0.08, 7.6, GREEN, x(0.5), 3.0, z + GZ);
  signs.add(`shek_gate_${side}`, () => signTexture('ÉGLISE SHEKINAH', 'Debonhomme · Kinshasa', '#1d4fa0', '#ffffff'), 6.4, 1.0, x(0.3), 3.55, z + GZ, face, true);
  // la cour : gravier, allée de bordures rouges et blanches du portail à l'église, muret de brique rouge et pelouse
  b.box(30, 0.04, L - 1, 0xb9a98e, x(15.7), 0.03, z);
  for (let d = 2, k = 0; d < 25; d += 0.7, k++) for (const off of [-1.9, 1.9]) b.box(0.55, 0.16, 0.5, k % 2 ? 0xf2f2f2 : 0xc42b22, x(d), 0.1, z + GZ + off);
  b.box(18, 0.5, 0.4, 0xa4442e, x(22), 0.25, z - 22).box(16, 0.05, 11, 0x4f8f3a, x(22), 0.05, z - 27.5);
  // l'église : volume de 20 m de profondeur sur 36 m de long, un peu à droite de l'allée
  const cz = z + 2, bx = 36;
  b.box(20, 8, 36, 0xd8cdb6, x(bx), 4, cz);
  signs.add(`shek_brick_${side}`, () => brickChevronTexture(), 36, 3.8, x(25.95), 2.0, cz, face, true);
  b.box(0.3, 0.32, 36.4, 0x9a968c, x(25.8), 4.1, cz);
  for (const dz of [-13, -6.5, 6.5, 13]) {
    b.box(0.12, 1.6, 1.5, 0x2b1d15, x(25.9), 1.95, cz + dz).box(0.14, 1.45, 1.25, 0x7a4630, x(25.85), 1.95, cz + dz);
    for (let k = 0; k < 5; k++) b.box(0.16, 0.04, 1.25, 0x2b1d15, x(25.8), 1.45 + k * 0.28, cz + dz);
  }
  b.box(0.14, 2.7, 2.6, 0x1a1d22, x(25.9), 1.35, cz).box(2.2, 0.2, 3.4, 0xbfb6a0, x(25.1), 0.1, cz);
  for (const dz of [-13, -6.5, 0, 6.5, 13]) b.box(0.12, 1.6, 1.6, 0x15181c, x(25.9), 5.9, cz + dz);
  signs.add(`shek_bldg_${side}`, () => signTexture('SHEKINAH', 'Église · Debonhomme', '#1d4fa0', '#ffffff'), 9, 1.2, x(25.8), 7.2, cz, face, true);
  // le toit pas encore fait : dalle, poteaux d'attente, poutre de façade, demi-acrotère
  b.box(20.6, 0.4, 36.6, 0x8d897f, x(bx), 8.2, cz);
  for (let k = -2; k <= 2; k++) b.box(0.28, 2.4, 0.28, 0x7b7a74, x(26.6), 9.6, cz + k * 8);
  b.box(0.3, 0.3, 32, 0x8d897f, x(26.6), 10.9, cz).box(0.3, 1.0, 18, 0x9a968c, x(26.0), 8.9, cz - 9);
  // échafaudage de bois au bout gauche de la façade
  for (let k = 0; k < 4; k++) b.box(0.1, 10.4, 0.1, WOOD, x(24.4), 5.2, cz + 13 + k * 1.7);
  for (const y of [3.2, 6.0, 8.8]) b.box(0.1, 0.1, 5.2, WOOD, x(24.4), y, cz + 15.5).box(1.4, 0.06, 5.2, 0xa88a58, x(25.1), y, cz + 15.5);
  // l'arche de tissu bleu et blanc au-dessus de l'allée
  const N = 16, R = 6, Hh = 5.6;
  for (let i = 0; i < N; i++) {
    const t0 = Math.PI * i / N, t1 = Math.PI * (i + 1) / N, z0 = R * Math.cos(t0), y0 = Hh * Math.sin(t0), z1 = R * Math.cos(t1), y1 = Hh * Math.sin(t1);
    b.box(0.5, 0.42, Math.hypot(z1 - z0, y1 - y0) * 1.03, i % 4 < 2 ? 0x1d4fa0 : 0xf4f4f4, x(12), (y0 + y1) / 2, z + GZ + (z0 + z1) / 2, -Math.atan2(y1 - y0, z1 - z0), 0, 0);
  }
  addMango(b, x(9), z - 20, 1.1);
  addMango(b, x(17), z + 27, 1.0);
}

/**
 * L'ancien bâtiment de l'église Shekinah (l'auteur, 22/11, d'après sa description) : à droite, à étages (4 niveaux), peinture crème passée ; devant, la statue de l'aigle sur son
 * piédestal, tournée vers le macadam.
 */
function addShekinahOld(b, signs, side, z, p) {
  const L = 30, H = 14.4, x = d => side * (FRONT + d), face = -side * Math.PI / 2, e = -side;   // e : vers la route
  const CREAM = 0xe0d5b4, BAND = 0xb3a888, GLASS_D = 0x1e2f42;
  b.box(14, H, L, CREAM, x(16), H / 2, z);
  for (const y of [3.6, 7.2, 10.8]) b.box(14.4, 0.3, L + 0.4, BAND, x(16), y, z);
  b.box(14.6, 0.9, L + 0.6, 0x9a8f72, x(16), H + 0.35, z);
  // la patine : coulures sombres sous les rebords
  for (let k = 0; k < 12; k++) b.box(0.05, rand(2.5, 6), rand(0.2, 0.45), 0x9c9174, x(8.97), rand(3.2, 9.5), z + rand(-L / 2 + 1, L / 2 - 1));
  // fenêtres : 6 travées sur 4 niveaux ; au rez-de-chaussée, l'entrée à la place des deux travées du milieu
  for (let f = 0; f < 4; f++) for (let k = 0; k < 6; k++) {
    const dz = -12.5 + k * 5;
    if (f === 0 && (k === 2 || k === 3)) continue;
    b.box(0.12, 1.55, 1.8, GLASS_D, x(8.95), 2.0 + f * 3.6, z + dz).box(0.14, 0.1, 2.0, BAND, x(8.9), 1.15 + f * 3.6, z + dz);
  }
  b.box(0.14, 2.8, 3.2, 0x3a2a1c, x(8.95), 1.4, z).box(2.6, 0.2, 4.4, BAND, x(7.7), 3.3, z).box(2.2, 0.2, 4.0, 0xbfb6a0, x(7.7), 0.1, z);
  // balcon filant du 1er étage et son garde-corps
  b.box(1.4, 0.2, L, CREAM, x(8.3), 3.7, z).box(0.06, 0.9, L, 0x3a3f46, x(7.65), 4.25, z);
  for (let dz = -L / 2 + 0.5; dz <= L / 2 - 0.4; dz += 1.0) b.box(0.05, 0.9, 0.05, 0x3a3f46, x(7.65), 4.25, z + dz);
  // toit-terrasse : deux citernes bleues et une antenne
  b.cyl(1.0, 1.0, 1.6, 0x2f6fb0, x(18), H + 1.5, z - 7).cyl(1.0, 1.0, 1.6, 0x2f6fb0, x(18), H + 1.5, z + 3).box(0.06, 4, 0.06, 0x6b7076, x(14), H + 2.8, z + 10);
  signs.add(`shek_old_${side}`, () => signTexture('SHEKINAH', 'Ancien bâtiment · Debonhomme', '#1d4fa0', '#ffffff'), 11, 1.3, x(8.85), 12.5, z, face, true);
  // le sol devant : dalle de béton
  b.box(9, 0.04, L + 2, 0xa8a49a, x(4.5), 0.03, z);
  // la statue de l'aigle : piédestal, corps, tête blanche, bec doré, ailes déployées, queue ; il regarde le macadam
  const px = x(3), BR = 0x7a5a2c, DK = 0x4a3820, GOLD = 0xe2a812;
  b.box(2.4, 0.5, 2.4, 0xc9c2b2, px, 0.25, z).box(1.7, 2.4, 1.7, 0xd8d2c4, px, 1.7, z).box(2.0, 0.25, 2.0, 0xc9c2b2, px, 3.0, z);
  b.ball(0.55, BR, px, 3.75, z, 1.5, 0.95, 0.8);
  b.ball(0.3, 0xf2efe6, px + e * 0.95, 4.35, z).box(0.34, 0.1, 0.12, GOLD, px + e * 1.3, 4.3, z).box(0.2, 0.08, 0.1, GOLD, px + e * 1.18, 4.22, z);
  for (const sz of [-1, 1]) {
    b.box(0.95, 0.12, 1.9, BR, px, 4.05, z + sz * 1.15, -sz * 0.45, 0, 0).box(0.8, 0.1, 1.3, DK, px, 4.55, z + sz * 2.2, -sz * 0.8, 0, 0);
  }
  b.box(1.0, 0.1, 0.8, DK, px - e * 0.95, 3.55, z, 0, 0, -side * 0.4);
  b.box(0.6, 0.3, 0.8, 0x8a8478, px + e * 0.2, 3.25, z);
}

/** Immeuble commercial, banque ou hôtel nommé (Rawbank, Equity BCDC, TMB, Hôtel Océan, Siège PNC — d'après TPF). */
function addCommercialBldg(b, signs, side, z, p) {
  const x = side * (FRONT + 8), fx = side * (FRONT - 0.05), H = p.h ?? 10.2, gh = Math.min(7.2, H - 3);   // p.h : hauteur (2 niveaux ≈ 7,4 m)
  const rawCol = p.accent ?? p.color ?? '#1d4fa0';
  const colStr = typeof rawCol === 'number' ? `#${rawCol.toString(16).padStart(6, '0')}` : String(rawCol);
  const bgHex = typeof rawCol === 'number' ? rawCol : parseInt(colStr.replace('#', ''), 16);
  const wallHex = typeof p.color === 'number' ? p.color : 0xedeff2;
  b.box(16, H, 16, wallHex, x, H / 2, z)
    .box(16.4, 0.7, 16.4, bgHex, x, H + 0.3, z)
    .box(0.16, gh, 13.5, 0x1a2a3a, fx, 0.6 + gh / 2, z)
    .box(2.6, 0.22, 14.8, bgHex, side * (FRONT - 1.2), 3.6, z, 0, 0, -side * 0.08);
  if (p.h) b.box(16.2, 0.3, 16.2, bgHex, x, H / 2 + 0.6, z);                 // bandeau entre les deux niveaux
  signs.add(`comm_wall_${side}_${z}`, () => signTexture(p.name, p.sub ?? '', colStr, p.fg ?? '#ffffff'),
    13, 1.5, side * (FRONT - 0.15), H - 1.2, z, -side * Math.PI / 2, true);
  const rx = side * (ROAD_EDGE + 2.6), rz = z + 7.5;
  b.box(1.8, 5.8, 0.38, bgHex, rx, 2.9, rz);
  for (const [dz, ry] of [[0.22, 0], [-0.22, Math.PI]]) {
    signs.add(`comm_totem_${side}_${z}`, () => signTexture(p.name, p.sub ?? '', colStr, p.fg ?? '#ffffff'),
      1.7, 2.8, rx, 4.0, rz + dz, ry, true);
  }
}

/** Monument Patrice Emery Lumumba (TPF gis_osm_pois s=12210, avant l'Échangeur de Limete). */
function addLumumbaMonument(b, signs, side, z) {
  const x = side * (ROAD_EDGE + 5.2);
  b.box(5.2, 0.45, 5.2, 0xc8c2b6, x, 0.22, z)
    .box(3.6, 0.55, 3.6, 0xd8d2c6, x, 0.72, z)
    .box(2.1, 3.2, 2.1, 0x8e3b2e, x, 2.6, z)
    .box(2.4, 0.28, 2.4, 0xf5c400, x, 4.3, z)
    // Statue bronze de Patrice Lumumba debout, bras droit levé
    .cyl(0.32, 0.36, 1.9, 0x5c4328, x, 5.35, z)
    .ball(0.26, 0x5c4328, x, 6.55, z)
    .cyl(0.11, 0.12, 1.1, 0x5c4328, x - side * 0.38, 6.65, z, 0, 0, side * 0.45);
  signs.add(`lum_mon_${z}`, () => signTexture('PATRICE EMERY LUMUMBA', 'Héros National · 1925 – 1961', '#1d4fa0', '#f5c400'),
    3.6, 1.0, x - side * 1.1, 2.6, z, -side * Math.PI / 2, true);
}

/** Station-service décorative (sans arrêt pour le plein), de l'un ou l'autre côté. */
// off : décalage vers l'extérieur (station derrière un petit boulevard, Limete) ; le totem reste au bord de son aire
function addSideFuel(b, signs, side, z, key, label = 'STATION', off = 0) {
  const x = side * (ROAD_EDGE + 12 + off);
  const upper = label.toUpperCase();
  const isML = upper.includes('ML');
  const isEngen = upper.includes('ENGEN');
  const isTotal = upper.includes('TOTAL');
  const roofCol = isEngen ? 0x003da5 : isML ? 0xf59e0b : isTotal ? 0xe31837 : 0xc8102e;
  const trimCol = isEngen ? 0xffffff : isML ? 0x1e293b : 0xffffff;
  const signBg = isEngen ? '#003da5' : isML ? '#d97706' : isTotal ? '#e31837' : '#b0102a';
  const signFg = '#ffffff';
  const subText = isEngen ? 'Service 24h/24 · Boutique' : isML ? 'Carburant · Lubrifiants' : isTotal ? 'Bonjour · Carburant & Lubrifiants' : 'Carburant · Huile';
  b.box(14, 0.65, 22, roofCol, x, 5.4, z).box(14.2, 0.25, 22.2, trimCol, x, 5.0, z);
  if (isEngen) b.box(14.3, 0.16, 22.3, 0xe31837, x, 5.76, z);
  for (const sx of [-4.5, 4.5]) for (const sz of [-8, 8]) b.box(0.42, 5, 0.42, 0xdcdcdc, x + sx, 2.5, z + sz);
  for (const sz of [-4, 4]) b.box(0.9, 1.65, 0.65, roofCol, x - side * 2, 0.82, z + sz).box(0.94, 0.4, 0.68, isEngen ? 0xe31837 : trimCol, x - side * 2, 1.4, z + sz);
  b.box(10, 3.5, 7, 0xf2f0e8, x + side * 7, 1.75, z - 12).box(10.3, 0.35, 7.3, roofCol, x + side * 7, 3.6, z - 12);
  b.box(14, 0.05, 30, 0x555559, x, 0.03, z);
  if (!off) b.box(5.6, 0.04, 28, 0x58595d, side * (ROAD_EDGE + 2.5), 0.028, z);   // (devanture ouverte : le goudron jusqu'à la chaussée)
  signs.add(`${key}_canopy`, () => signTexture(upper, subText, signBg, signFg), 11, 0.9, x - side * 7.12, 5.38, z, -side * Math.PI / 2, true);
  const tx = off ? x - side * 6.2 : side * (ROAD_EDGE + 2.4);
  b.box(0.32, 5.8, 0.32, isEngen ? 0x003da5 : 0x8e949a, tx, 2.9, z + 11.5);
  signs.add(key, () => signTexture(upper, subText, signBg, signFg), 5.2, 1.65, tx, 6.2, z + 11.7, 0, true);
  signs.add(key, () => signTexture(upper, subText, signBg, signFg), 5.2, 1.65, tx, 6.2, z + 11.3, Math.PI, true);
}

// ---------- Limete : de la 16e Rue à la 1re Rue ----------

/** Builder décalé en x, pour poser les façades génériques derrière un petit boulevard (box, cyl, ball, add). */
function shiftX(b, dx) {
  const p = {
    box(w, h, d, c, x = 0, ...r) { b.box(w, h, d, c, x + dx, ...r); return p; },
    cyl(rt, rb, h, c, x = 0, ...r) { b.cyl(rt, rb, h, c, x + dx, ...r); return p; },
    ball(r, c, x = 0, ...q) { b.ball(r, c, x + dx, ...q); return p; },
    add(geo, c, x = 0, ...r) { b.add(geo, c, x + dx, ...r); return p; },
  };
  return p;
}
const shiftSigns = (signs, dx) => ({ add: (key, make, w, h, x, ...r) => signs.add(key, make, w, h, x + dx, ...r) });

/** Intervalles [p, q] (p > q) privés des coupures [a, c] (a > c). */
function minus(list, cuts) {
  let out = list;
  for (const [a, c] of cuts) out = out.flatMap(([x, y]) => (c >= x || a <= y) ? [[x, y]] : [...(x > a ? [[x, a]] : []), ...(c > y ? [[c, y]] : [])]);
  return out.filter(([x, y]) => x - y > 0.3);
}

/** Bordure noir et blanc le long du segment p → q (coordonnées route). */
function curbLine(b, p, q, y = 0.11) {
  const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz), n = Math.max(1, Math.round(len / 1.5)), ry = Math.atan2(dx, dz);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    b.box(0.3, 0.22, len / n, i % 2 ? CURB_DARK : CURB_LIGHT, p[0] + dx * u, y, p[1] + dz * u, 0, ry, 0);
  }
}

/** flatPoly sans les sommets confondus (un coin peut disparaître : triangle). */
function flatPolyClean(b, pts, y, color) {
  const P = pts.filter((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05; });
  if (P.length >= 3) flatPoly(b, P, y, color);
}

/** Dépôt de Limete Industriel : mur d'enceinte et portail sur le petit boulevard, hangar en tôle à deux pans. F : alignement. */
function addDepot(b, side, z, w, F) {
  const x = side * (F + 0.15), col = pick([0xe9e6de, 0xd8d4c8, 0xc9c3b6, 0xb8c4cc]);
  const gate = Math.min(6, w * 0.4), gz = z + rand(-w / 6, w / 6);
  const l1 = (gz - gate / 2) - (z - w / 2), l2 = (z + w / 2) - (gz + gate / 2);
  for (const [len, zc] of [[l1, z - w / 2 + l1 / 2], [l2, z + w / 2 - l2 / 2]]) {
    if (len > 0.2) b.box(0.3, 2.6, len, col, x, 1.3, zc).box(0.34, 0.3, len, 0x1d4fa0, x, 2.65, zc);
  }
  b.box(0.12, 2.4, gate, pick(GATES), x, 1.2, gz);
  // toitures surtout bleues (vue du drone sur Limete Industriel), quelques-unes en tôle grise
  const d = rand(14, 22), h = rand(6, 8.5), hx = side * (F + 6 + d / 2), roof = pick([0x3b6fb6, 0x4a7fc1, 0x3d6aa8, 0x8c9196, 0x6f747a]), a = 0.2;
  b.box(d, h, w * 0.86, pick([0xd9d4c8, 0xc8c2b6, 0xb9b4aa, 0xe2ddd2]), hx, h / 2, z);
  for (const e of [-1, 1]) b.box(d / 2 / Math.cos(a) + 0.5, 0.14, w * 0.92, roof, hx + e * d / 4, h + d / 4 * Math.tan(a), z, 0, 0, -e * a);
}

/** Villa de Limete Résidentiel (vue du drone) : mur blanc ou crème avec portail, maison à étage et toit de tuiles. F : alignement. */
function addVilla(b, side, z, w, F) {
  const x = side * (F + 0.15), col = pick([0xf2f0e8, 0xe9e2d0, 0xf0e2b6, 0xe8e8e4]);
  const gate = Math.min(3.4, w * 0.3), gz = z + rand(-w / 5, w / 5);
  const l1 = (gz - gate / 2) - (z - w / 2), l2 = (z + w / 2) - (gz + gate / 2);
  for (const [len, zc] of [[l1, z - w / 2 + l1 / 2], [l2, z + w / 2 - l2 / 2]]) if (len > 0.2) b.box(0.25, 2.2, len, col, x, 1.1, zc);
  b.box(0.12, 2.0, gate, pick(GATES), x, 1.0, gz);
  const d = rand(9, 12), floors = chance(0.6) ? 2 : 1, h = floors * 3.1, hx = side * (F + 4.5 + d / 2), hw = w * rand(0.6, 0.8);
  b.box(d, h, hw, pick([0xf2f0e8, 0xe9dcc3, 0xf0e2b6, 0xd8c08f, 0xe8a0a0]), hx, h / 2, z);
  addHipRoof(b, hx, h - 1.2, z, d, hw);
  for (let f = 0; f < floors; f++) for (const k of [-1, 1]) b.box(0.08, 1.2, hw * 0.22, 0x2a3540, side * (F + 4.46), f * 3.1 + 1.7, z + k * hw * 0.25);
}

/** Voiture garée sur la terre battue (simple, cuite dans le décor). */
function addParkedCar(b, x, z, ry = 0) {
  const c = pick([0xf2f2f2, 0xc0c4c8, 0xf5c400, 0x1a1a1a, 0xb02a2a, 0x2a4a8a, 0xf2f2f2]);
  b.box(1.8, 0.75, 4.3, c, x, 0.62, z, 0, ry, 0)
    .box(1.6, 0.6, 2.3, 0x1e2a36, x, 1.28, z + (ry ? 0 : 0.2), 0, ry, 0);
}

/** Immeuble nommé (hôtel, banque…) derrière le petit boulevard : façade vitrée, marquise, enseigne. F : alignement.
 *  Facultatifs : p.depth (profondeur, m), p.color (corniche, marquise, fond de l'enseigne), p.wall (murs), p.text (lettres),
 *  p.shops (bandeau de boutiques colorées au rez-de-chaussée), p.corner (immeuble d'angle : enseigne et fenêtres aussi
 *  sur le côté qui regarde l'arrivée du taxi). */
function addNamedBlock(b, signs, side, z, w, p, F0, floors = 4) {
  // p.set : recul derrière une cour pavée ; p.fence 'lattice' : clôture en treillis (on voit à travers) sur p.plot mètres
  const set = p.set ?? 0, F = F0 + set, plot = p.plot ?? w + 8;
  if (set) b.box(set, 0.04, plot, 0xc8c3b8, side * (F0 + set / 2), 0.02, z);
  if (p.fence === 'lattice') addLatticeFence(b, side, F0 + 0.25, z + plot / 2, z - plot / 2, z);
  const d = p.depth ?? 14, h = floors * 3.3, x = side * (F + d / 2), fx = side * (F - 0.04), zf = z + w / 2 + 0.04;
  const col = p.color ?? '#1d4fa0', c = parseInt(col.slice(1), 16);
  b.box(d, h, w, p.wall ?? 0xeef0f3, x, h / 2, z).box(d + 0.4, 0.5, w + 0.4, c, x, h + 0.25, z);
  for (let f = p.shops ? 1 : 0; f < floors; f++) for (let k = -1; k <= 1; k++) {
    b.box(0.08, 1.3, w * 0.22, 0x1e3246, fx, f * 3.3 + 1.8, z + k * w * 0.3);
    if (p.corner) b.box(d * 0.22, 1.3, 0.08, 0x1e3246, x + side * k * d * 0.3, f * 3.3 + 1.8, zf);
  }
  if (p.shops) {                                          // vitrines de boutiques (sans panneaux vides de couleur)
    for (let k = 0; k < 3; k++) {
      const zk = z + (k - 1) * w / 3, xk = x + side * (k - 1) * d / 3;
      b.box(0.1, 2.2, w / 3 - 0.5, 0x2a3540, fx, 1.25, zk);
      if (p.corner) b.box(d / 3 - 0.5, 2.2, 0.1, 0x2a3540, xk, 1.25, zf);
    }
  } else b.box(2.4, 0.2, w * 0.8, c, side * (F - 1.1), 3.3, z, 0, 0, -side * 0.08);   // marquise
  const key = `nb_${side}_${Math.round(z)}`, make = () => signTexture(p.name, p.sub ?? '', col, p.text ?? '#ffffff');
  signs.add(key, make, Math.min(w * 0.95, 11), 1.4, fx - side * 0.06, h - 1.3, z, -side * Math.PI / 2, true);
  if (p.corner) signs.add(key, make, Math.min(d * 0.95, 11), 1.4, x, h - 1.3, zf + 0.06, 0, true);
}

/**
 * Grand hôpital (HJ Hospitals) derrière le petit boulevard : immeuble blanc à bandeaux vitrés bleus, hall vitré sous auvent
 * face au petit boulevard avec dépose-minute, enseignes sur la façade et sur le côté qui regarde l'arrivée du taxi, croix
 * bleue (la croix rouge est un emblème protégé). F : alignement ; w : longueur le long du boulevard ; p.depth, p.floors.
 */
function addBigHospital(b, details, signs, side, z, w, p, F) {
  const d = p.depth ?? 24, floors = p.floors ?? 6, h = floors * 3.4, set = 4, x0 = F + set;
  const xc = side * (x0 + d / 2), fx = side * (x0 - 0.05), zf = z + w / 2 + 0.05;
  const WHITE = 0xf3f5f7, GLASS = 0x2f6db5, BLUE = 0x0a4fa3;
  b.box(d, h, w, WHITE, xc, h / 2, z).box(d + 0.6, 0.6, w + 0.6, BLUE, xc, h + 0.3, z);          // corps, corniche
  for (let f = 1; f < floors; f++) b.box(d + 0.08, 1.4, w + 0.08, GLASS, xc, f * 3.4 + 1.6, z);   // bandeaux vitrés
  b.box(0.12, 2.8, w * 0.5, 0x2a4f7a, fx, 1.5, z);                                                 // hall vitré
  b.box(set + 0.4, 0.25, w * 0.4, BLUE, side * (x0 - set / 2 + 0.2), 3.5, z);                      // auvent
  for (const e of [-1, 1]) b.box(0.25, 3.4, 0.25, 0xd8dde2, side * (x0 - set + 1), 1.7, z + e * w * 0.18);
  b.box(set - 0.4, 0.06, w, 0xd7d2c8, side * (x0 - set / 2), 0.03, z);                             // dépose-minute pavé
  const key = `hosp_${side}_${Math.round(z)}`, make = () => signTexture(p.name, p.sub ?? '', '#0a4fa3', '#ffffff');
  signs.add(key, make, Math.min(w * 0.55, 22), 2.8, fx - side * 0.1, h - 2.3, z, -side * Math.PI / 2, true);
  signs.add(key, make, Math.min(d * 0.75, 18), 2.6, xc - side * d * 0.08, h - 2.3, zf + 0.06, 0, true);
  const cx = xc + side * (d / 2 - 1.8);                                                           // croix bleue, à l'angle
  b.box(0.75, 2.4, 0.14, BLUE, cx, h - 2.3, zf + 0.07).box(2.4, 0.75, 0.14, BLUE, cx, h - 2.3, zf + 0.07);
  for (let i = 0; i < 10; i++) addPerson(details.at(z), side * (x0 - rand(0.8, set - 0.6)), z + rand(-w * 0.3, w * 0.3));
}

/** Clôture en treillis (losanges, on voit l'intérieur à travers) à |x| = xf, de zA à zB (zA > zB), portail ouvert en zGate. */
function addLatticeFence(b, side, xf, zA, zB, zGate, col = 0xf2f2f2) {
  const x = side * xf, H = 2.1, G = 2.2;                                   // hauteur, demi-largeur du portail
  for (const [a, c] of [[zA, zGate + G], [zGate - G, zB]]) {
    if (a - c < 1) continue;
    b.box(0.12, 0.12, a - c, col, x, H, (a + c) / 2).box(0.12, 0.12, a - c, col, x, 0.12, (a + c) / 2);   // lisses
    for (let zz = a; zz > c - 2.4; zz -= 2.5) b.box(0.14, H + 0.1, 0.14, col, x, H / 2, Math.max(c, zz));  // poteaux
    for (let zz = a - H / 2; zz > c + H / 2 - 0.01; zz -= 0.6) for (const e of [-1, 1]) {
      b.box(0.04, H * Math.SQRT2, 0.04, col, x, H / 2 + 0.06, zz, e * Math.PI / 4, 0, 0);                // barreaux en croix
    }
  }
  for (const e of [-1, 1]) b.box(0.3, 2.6, 0.3, col, x, 1.3, zGate + e * G);                             // piliers du portail
}

/** Résidence privée (Limete, d'après l'auteur) derrière le petit boulevard : mur d'enceinte, portail noir entre deux hautes
 *  colonnes blanches, cour pavée, deux immeubles à étages (4 et 5 niveaux) avec balcons. F : alignement ; p.w : longueur. */
function addResidence(b, side, z, p, F) {
  const L = p.w ?? 30, X = lx => side * lx, WALL = 0xe9e2d0, COL = 0xf4f1ea;
  for (const [a, c] of [[z + L / 2, z + 3.4], [z - 3.4, z - L / 2]]) {
    b.box(0.3, 2.4, a - c, WALL, X(F + 0.2), 1.2, (a + c) / 2).box(0.36, 0.2, a - c, 0xb8a98a, X(F + 0.2), 2.45, (a + c) / 2);
  }
  for (const e of [-1, 1]) b.cyl(0.55, 0.6, 5.5, COL, X(F + 0.2), 2.75, z + e * 2.6, 0, 0, 0, 12).box(1.4, 0.4, 1.4, COL, X(F + 0.2), 5.7, z + e * 2.6);
  b.box(0.12, 2.2, 3.8, 0x2a2a2a, X(F + 0.25), 1.1, z);
  b.box(5.5, 0.04, L - 1, 0xc8c3b8, X(F + 3), 0.02, z);
  for (const [dz, fl] of [[L / 4 + 0.5, 4], [-L / 4 - 0.5, 5]]) {
    const h = fl * 3.2, zc = z + dz, w = L / 2 - 3;
    b.box(12, h, w, 0xf1ece0, X(F + 12), h / 2, zc).box(12.4, 0.4, w + 0.4, 0x9a7b5a, X(F + 12), h + 0.2, zc);
    for (let f = 0; f < fl; f++) {
      b.box(0.08, 1.2, w * 0.8, 0x2a3540, X(F + 5.95), f * 3.2 + 1.5, zc);                                  // fenêtres
      if (f > 0) b.box(1.4, 0.15, w * 0.8, 0xd8d0c0, X(F + 5.3), f * 3.2, zc)
        .box(0.06, 0.9, w * 0.8, 0xe8e2d4, X(F + 4.65), f * 3.2 + 0.5, zc);                                // balcons
    }
  }
}

/**
 * Église à toits en gradins (Saint Raphaël, d'après la photo de l'auteur) derrière le petit boulevard : murs jaunes, toits
 * de tôle rouge-brun qui montent en escalier jusqu'au haut mur du fond (croix blanche, côté fourche), bandeau sombre sous
 * chaque toit ; cour avec grotte en pierres et statue, muret rose à l'entrée puis claustras noir et blanc, panneau de la
 * paroisse, étal de vendeuse sur le trottoir. F : alignement ; p.w : longueur du terrain le long du boulevard.
 */
function addStepChurch(b, details, signs, side, z, p, F) {
  const YEL = 0xf0c22e, ROOF = 0x9b3f2a, DARK = 0x2e2620, WHITE = 0xf4f4f0, PINK = 0xe8957a, n = 5, D = 18, a = 0.1;
  const L = p.w ?? 28, x0 = F + 3, sb = D / (n + 2), X = lx => side * lx, H = i => 4.5 + i * 2.4;
  const zW = z - L / 2, zHi = zW + 3, zLo = z + L / 2 - 4, step = (zLo - zHi) / n;   // haut mur du fond, nef en gradins, cour
  for (let i = 0; i < n; i++) {
    const zs = zLo - i * step, len = zs - zHi, xf = x0 + i * sb, d = D - i * sb, zc = (zs + zHi) / 2, dr = d + 1, rise = dr * Math.tan(a);
    b.box(d, H(i), len, YEL, X(xf + d / 2), H(i) / 2, zc)
      .box(dr / Math.cos(a), 0.16, len + 0.6, ROOF, X(xf - 0.7 + dr / 2), H(i) + rise / 2 + 0.1, zc + 0.3, 0, 0, side * a);
    if (i > 0) b.box(0.1, 1.5, len, DARK, X(xf - 0.05), H(i - 1) + 1.35, zc);        // bandeau sombre sous le toit
  }
  for (let zz = zHi + 2; zz < zLo - 1; zz += 3) b.box(0.1, 2.4, 0.7, DARK, X(x0 - 0.05), 2.2, zz);   // fenêtres hautes
  b.box(D + 0.6, 17, 3, YEL, X(x0 + D / 2), 8.5, zW + 1.5)                                         // haut mur du fond
    .box(0.4, 3.4, 0.4, WHITE, X(x0 + 4), 18.7, zW + 1.5).box(0.4, 0.4, 2.2, WHITE, X(x0 + 4), 19.4, zW + 1.5);   // croix
  b.box(3, 0.04, L, 0xc8b89a, X(F + 1.5), 0.02, z).box(D, 0.04, 4, 0xc8b89a, X(x0 + D / 2), 0.02, zLo + 2);     // cour
  // Grotte en pierres et statue blanche, dans la cour à l'entrée
  for (let k = 0; k < 7; k++) b.ball(rand(0.7, 1.3), pick([0x8a8780, 0x9c988f, 0x7d7a72]), X(x0 + rand(1.2, 3.6)), rand(0.4, 1.8), zLo + 2 + rand(-1.2, 1.2));
  b.cyl(0.22, 0.28, 1.3, WHITE, X(x0 + 0.4), 1.55, zLo + 2).ball(0.18, WHITE, X(x0 + 0.4), 2.35, zLo + 2);
  // Muret rose et portail à l'entrée, puis claustras noir et blanc le long de l'église
  b.box(0.3, 1.8, 0.9, PINK, X(F + 0.25), 0.9, zLo + 3.55).box(0.3, 1.8, 5.2, PINK, X(F + 0.25), 0.9, zLo - 2.4);
  let k = 0;
  for (let zz = zLo - 5; zz > zW + 0.4; zz -= 0.8, k++) for (const r of [0, 1]) b.box(0.25, 0.6, 0.8, (k + r) % 2 ? CURB_DARK : WHITE, X(F + 0.25), 0.3 + r * 0.6, zz - 0.4);
  b.box(0.12, 2.6, 0.12, 0x8e949a, X(F - 0.4), 1.3, zLo + 3.6);
  signs.add(`raph_${Math.round(z)}`, () => signTexture(p.name, p.sub ?? '', '#1d4fa0', '#ffffff'), 3.2, 0.9, X(F - 0.48), 2.4, zLo + 3.6, -side * Math.PI / 2, true);
  // Étal de vendeuse sur le trottoir (parasol, table, étagère de marchandises)
  const vz = zLo - 2, vx = X(F - 1.2), d = details.at(vz);
  d.cyl(0.04, 0.04, 2.1, 0x666666, vx, 1.05, vz).add(new THREE.ConeGeometry(1.5, 0.6, 8), pick([0x2a9d4b, 0xffffff]), vx, 2.25, vz)
    .box(1.0, 0.7, 1.4, 0x8b6b45, vx, 0.35, vz).box(0.35, 1.5, 1.8, 0x8b6b45, X(F - 0.3), 0.75, vz);
  for (let i = 0; i < 8; i++) d.box(0.2, 0.25, 0.3, pick(GOODS), X(F - 0.45), rand(0.4, 1.4), vz + rand(-0.7, 0.7));
  addPerson(d, X(F - 0.6), vz + 1.1, { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
  for (let i = 0; i < 4; i++) addPerson(d, X(F - rand(0.4, 1.6)), z + rand(-L / 2, L / 2));
}

/** Distance du point (x, z) au segment [a, b]. */
function segDist(x, z, a, b) {
  const ax = b[0] - a[0], az = b[1] - a[1], L2 = ax * ax + az * az || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ax + (z - a[1]) * az) / L2));
  return Math.hypot(x - a[0] - ax * t, z - a[1] - az * t);
}

/**
 * Marché d'objets traditionnels, sans nom (croquis de l'auteur) : rangées d'étals en bois sous tôle derrière le petit
 * boulevard, avec statues, masques, pagnes et paniers. Les étals qui toucheraient une rue (segs) sont omis.
 */
function addCraftMarket(b, details, side, z, w, F, segs) {
  const WOOD = [0x3b2416, 0x4a2e1a, 0x2a1a10, 0x5a3a22, 0x6b4428], CLOTH = [0x8b5a2b, 0xc8a165, 0x5c3317, 0xa0522d, 0xe0c9a0, 0x2a1a10];
  const near = (x, zz) => segs.some(s => segDist(x, zz, s.a, s.b) < s.hw + 2.4);
  for (const depth of [3, 9.5, 16, 22.5]) {                              // étals tournés vers le petit boulevard, allées entre
    const x = side * (F + depth), xb = x + side * 1.32;                  // xb : fond de l'étal
    for (let zz = z + w / 2 - 1.8; zz > z - w / 2 + 1.8; zz -= 3.4) {
      if (near(x, zz)) continue;
      for (const sx of [-1.3, 1.3]) for (const sz of [-1.45, 1.45]) b.box(0.12, 2.6, 0.12, 0x7a5a3a, x + sx, 1.3, zz + sz);
      b.box(3.1, 0.08, 3.3, pick(TIN), x, 2.68, zz, 0, 0, -side * 0.12);  // tôle en pente
      b.box(0.06, 1.7, 2.8, pick(CLOTH), xb, 1.45, zz).box(2.5, 1.5, 0.05, pick(CLOTH), x + side * 0.1, 1.55, zz - 1.45);   // pagnes, nattes
      b.box(1.0, 0.75, 2.6, 0x8b6b45, x, 0.38, zz);                       // table
      const d = details.at(zz);
      for (let i = 0; i < 5; i++) {                                          // statues en bois sombre : sur la table, puis devant
        const hS = rand(0.35, 1.1), y0 = i < 3 ? 0.75 : 0, sx = i < 3 ? x + side * rand(-0.35, 0.35) : x - side * rand(0.9, 1.3), sz = zz + rand(-1.1, 1.1);
        d.cyl(0.08, 0.12, hS, pick(WOOD), sx, y0 + hS / 2, sz, 0, 0, 0, 6).ball(0.1, pick(WOOD), sx, y0 + hS + 0.06, sz);
      }
      for (let i = 0; i < 3; i++) d.box(0.05, 0.42, 0.28, pick(WOOD), xb - side * 0.05, rand(1.4, 2.1), zz + rand(-1, 1));   // masques au fond
      for (let i = 0; i < 2; i++) d.cyl(0.32, 0.22, 0.3, 0xc8a165, x - side * rand(0.8, 1.3), 0.15, zz + rand(-1.2, 1.2), 0, 0, 0, 10);   // paniers
      if (chance(0.7)) addPerson(d, x + side * 0.9, zz + rand(-0.8, 0.8), { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      if (chance(0.5)) addPerson(d, x - side * rand(1.8, 2.6), zz + rand(-1.2, 1.2));
    }
  }
}

/** Petit marché (Marché Yolo) : hangars ouverts en tôle, étals, vendeuses, portique avec l'enseigne. F : alignement. */
function addMarketBlock(b, details, signs, side, z, w, p, F) {
  for (let k = 0; k < 2; k++) {
    const x = side * (F + 5 + k * 9), roof = pick([0x2f5fa8, 0x8c9196, 0x9c5a35, 0x2b7a4b]);
    for (const sx of [-3.4, 3.4]) for (const sz of [-w / 2 + 1, w / 2 - 1]) b.box(0.25, 3.4, 0.25, 0x8e949a, x + sx, 1.7, z + sz);
    for (const e of [-1, 1]) b.box(4.2, 0.12, w - 0.4, roof, x + e * 2, 3.75, z, 0, 0, -e * 0.18);
    for (let i = 0; i < 4; i++) {
      const tz = z + rand(-w / 2 + 2, w / 2 - 2), tx = x + rand(-2.4, 2.4), d = details.at(tz);
      d.box(1.6, 0.8, 1.1, 0x8b6b45, tx, 0.4, tz);
      for (let j = 0; j < 3; j++) d.ball(0.18, pick(GOODS), tx + rand(-0.5, 0.5), 0.95, tz + rand(-0.4, 0.4));
      if (chance(0.7)) addPerson(d, tx + side * 1.1, tz + rand(-0.8, 0.8), { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  const gx = side * (F + 0.3);
  b.box(0.35, 4.8, 0.35, 0x8e949a, gx, 2.4, z - 4.2).box(0.35, 4.8, 0.35, 0x8e949a, gx, 2.4, z + 4.2);
  signs.add(`mk_${side}_${Math.round(z)}`, () => signTexture(p.name, p.sub ?? 'Marché', '#c8102e', '#ffffff', true),
    8, 1.4, gx - side * 0.2, 4.3, z, -side * Math.PI / 2, true);
  for (let i = 0; i < 5; i++) addPerson(details.at(z), side * (F + rand(-1.2, 1)), z + rand(-w / 2, w / 2));
}

/** Arrêt de bus du côté gauche (sens vers l'Échangeur) : quai, abribus, panneau tourné vers ce sens. */
function addLeftStop(b, details, signs, z, label) {
  b.box(1.8, 0.18, 22, 0xb8b2a6, -(ROAD_EDGE + 1.3), 0.08, z)
    .box(4.6, 0.14, 24, 0xc8c3b8, -(ROAD_EDGE + 4.4), 0.07, z);
  const sx = -(ROAD_EDGE + 5.3);
  b.box(0.12, 2.5, 6.0, 0x1d4fa0, sx - 0.85, 1.25, z)
    .box(2.1, 0.15, 6.6, 0xf5c400, sx, 2.55, z, 0, 0, -0.08)
    .box(0.55, 0.10, 4.8, 0x7a5a3a, sx - 0.35, 0.54, z);
  for (const dz of [-2.8, 2.8]) b.box(0.10, 2.5, 0.10, 0x555b62, sx + 0.75, 1.25, z + dz).box(0.10, 2.5, 0.10, 0x555b62, sx - 0.85, 1.25, z + dz);
  const pz = z - 9.2;
  b.cyl(0.07, 0.09, 3.8, 0x1d4fa0, -(ROAD_EDGE + 2.3), 1.9, pz);
  signs.add(`stopL${Math.round(z)}`, () => signTexture(`ARRÊT ${label.toUpperCase()}`, 'Taxis · Taxis-bus · Transco', '#f5c400', '#111111'),
    3.8, 1.15, -(ROAD_EDGE + 2.3), 3.5, pz - 0.08, Math.PI, true);
  const d = details.at(z);
  for (let i = 0; i < 4; i++) {
    addPerson(d, -(ROAD_EDGE + (i < 2 ? 5.4 : rand(2.6, 4.4))), i < 2 ? z + (i ? 1.4 : -1.4) : z + rand(3.5, 8) * (i % 2 ? 1 : -1),
      { sitting: i < 2, ry: Math.PI / 2 + rand(-0.25, 0.25) });
  }
}

/** Station-service dans la bande entre la chaussée et le petit boulevard (Sonap à Limete), face à la voie de droite. */
function addStripStation(b, signs, st) {
  const x0 = ROAD_EDGE + 0.4, wd = LIM_LAWN - 0.4, xc = x0 + wd / 2;            // sur la pelouse, au bord de la chaussée
  const upper = st.name.toUpperCase().replace(/^STATION /, ''), sub = 'Station-service · Carburant · Lubrifiants';
  b.box(wd, 0.05, 31, 0x555559, xc, 0.03, st.z);                                                     // aire goudronnée
  b.box(wd - 2, 0.6, 18, 0xf2f2ee, xc, 5.3, st.z).box(wd - 1.8, 0.3, 18.2, 0x1d4fa0, xc, 4.95, st.z);   // auvent
  for (const sz of [-7, 7]) b.box(0.4, 5, 0.4, 0xdcdcdc, xc, 2.5, st.z + sz);
  for (const sz of [-3.5, 3.5]) b.box(0.8, 1.6, 0.6, 0x1d4fa0, xc, 0.8, st.z + sz).box(0.84, 0.35, 0.64, 0xf5c400, xc, 1.35, st.z + sz);
  b.box(wd - 3, 3.2, 5, 0xf2f0e8, xc + 0.8, 1.6, st.z - 12.8).box(wd - 2.6, 0.3, 5.4, 0x1d4fa0, xc + 0.8, 3.35, st.z - 12.8);   // boutique
  const make = () => signTexture(upper, sub, '#1d4fa0', '#ffffff');
  signs.add(`st_strip_${st.z}`, make, wd - 2.4, 0.85, xc, 5.3, st.z + 9.13, 0, true);                    // bandeau de l'auvent
  b.box(0.32, 5.8, 0.32, 0x8e949a, ROAD_EDGE + 1.4, 2.9, st.z + 16.5);
  signs.add(`st_strip_${st.z}`, make, 4.4, 1.4, ROAD_EDGE + 1.4, 6.2, st.z + 16.7, 0, true);            // totem double-face
  signs.add(`st_strip_${st.z}`, make, 4.4, 1.4, ROAD_EDGE + 1.4, 6.2, st.z + 16.3, Math.PI, true);
}

// Limete, bâtiments OSM : compression en travers (la même que pour les rues en biais du croquis), agrandissement des tailles
const LIM_KB = 0.43, LIM_GROW = 1.5;
const OSM_H = {
  house: () => (chance(0.55) ? 3.3 : 6.4), apartments: () => rand(10, 16.5), industrial: () => rand(6, 9), school: () => 7.4,
  church: () => 10, health: () => 8, bank: () => 10.5, hotel: () => 13.5, public: () => 8.2, commercial: () => rand(6.5, 9),
};
const OSM_WALL = { school: 0xf6f8fb, church: 0xf2ece1, health: 0xf7f9fc, bank: 0xedeff2, hotel: 0xeef0f3, public: 0xf2f5f8, apartments: 0xe9e2d0 };
const OSM_SIGN = {
  school: ['#1d5fbf', '#f5c400', 'Établissement scolaire'], health: ['#ffffff', '#c8102e', 'Santé'], bank: ['#1a1a1a', '#f5c400', 'Banque'],
  hotel: ['#1d4fa0', '#ffffff', 'Hôtel'], public: ['#1d4fa0', '#ffffff', 'Limete'], church: ['#7b2cbf', '#ffffff', 'Paroisse'],
  commercial: ['#c8102e', '#ffffff', 'Commerce'], apartments: ['#1d4fa0', '#ffffff', 'Limete'], house: ['#1d4fa0', '#ffffff', 'Limete'],
  industrial: ['#3d6aa8', '#ffffff', 'Limete Industriel'],
};

/**
 * Bâtiments réels (OpenStreetMap, data/limete_osm.json) derrière un petit boulevard de Limete. Positions : compression
 * du jeu le long du boulevard (×0,4) et en travers (LIM_KB) ; tailles agrandies (LIM_GROW) pour rester à l'échelle des
 * voitures et des piétons. Un bâtiment qui tomberait sur une rue est décalé (5 m au plus) ou retiré ; ceux qui ont un
 * nom (école, banque, église, hôpital…) reçoivent une enseigne côté boulevard. Entre les bâtiments qui donnent sur le
 * petit boulevard : murs de clôture avec portails.
 * streets : segments { a, b, hw } ou disques { c, r } à éviter ; blocks : [zHaut, zBas, xMax] (bâtiments du croquis).
 */
function addOsmSide(chunks, details, signs, side, list, F, streets, blocks, [zA, zB], gaps) {
  const KS = R.scale ?? 1, labelled = new Set(), front = [];
  for (const [s, , back, L1, L2, ang, kind, name0, sub] of list) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const m = [side * LIM_KB * sa, -KS * ca], q = [side * LIM_KB * ca, KS * sa];        // (dx, dz) d'un mètre réel en longueur, en largeur
    const lm = Math.hypot(m[0], m[1]), lq = Math.hypot(q[0], q[1]);
    const um = [m[0] / lm, m[1] / lm], uq = [q[0] / lq, q[1] / lq];
    const d = Math.max(3, L1 * lm * LIM_GROW), w = Math.max(3, L2 * lq * LIM_GROW);
    let cx = side * (F + Math.max(0, back) * LIM_KB), cz = -toGame(LIM.from + s);
    if (cz > zA || cz < zB) continue;
    const corners = () => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [cx + (um[0] * d * i + uq[0] * w * j) / 2, cz + (um[1] * d * i + uq[1] * w * j) / 2]);
    const pushOut = () => { const inner = Math.min(...corners().map(c => side * c[0])); if (inner < F + 0.4) cx += side * (F + 0.4 - inner); };
    pushOut();
    if (blocks.some(([a, c, xm]) => cz < a && cz > c && side * cx < xm)) continue;
    let ok = true;
    for (const st of streets) {
      if (st.r) {
        if (Math.hypot(cx - st.c[0], cz - st.c[1]) < st.r + Math.max(d, w) / 2) { ok = false; break; }
        continue;
      }
      const ax = st.b[0] - st.a[0], az = st.b[1] - st.a[1], L = Math.hypot(ax, az), ux = ax / L, uz = az / L, nx = -uz, nz = ux;
      const C = corners(), along = C.map(c => (c[0] - st.a[0]) * ux + (c[1] - st.a[1]) * uz);
      if (Math.max(...along) < -0.5 || Math.min(...along) > L + 0.5) continue;
      const off = C.map(c => (c[0] - st.a[0]) * nx + (c[1] - st.a[1]) * nz), lo = Math.min(...off), hi = Math.max(...off);
      if (hi < -st.hw || lo > st.hw) continue;
      const up = st.hw - lo, down = hi + st.hw, sh = up < down ? up : -down;
      if (Math.abs(sh) > 5) { ok = false; break; }
      cx += nx * sh; cz += nz * sh;
    }
    if (!ok) continue;
    pushOut();

    const ry = Math.atan2(um[0], um[1]), h = OSM_H[kind]?.() ?? 4, b = chunks.at(cz);
    const C = corners(), xi = Math.min(...C.map(c => side * c[0])), zs = C.map(c => c[1]), zl = Math.max(...zs) - Math.min(...zs);
    if (xi < F + 1.5) front.push([Math.max(...zs), Math.min(...zs)]);
    b.box(w, h, d, OSM_WALL[kind] ?? (kind === 'industrial' ? pick([0xd9d4c8, 0xc8c2b6, 0xb9b4aa, 0xe2ddd2]) : pick(WALLS)), cx, h / 2, cz, 0, ry, 0);
    if (h > 6 && kind !== 'industrial' && kind !== 'church') {                           // rangées de fenêtres sur tout le tour
      for (let f = 0; f < Math.floor(h / 3.3); f++) b.box(w + 0.06, 0.85, d + 0.06, 0x2a3540, cx, f * 3.3 + 1.9, cz, 0, ry, 0);
    }
    const lx = [Math.cos(ry), -Math.sin(ry)];                                             // axe local x (largeur)
    let top = h;
    if (kind === 'industrial' || kind === 'church' || (kind === 'house' && side > 0 && chance(0.4))) {   // toit à deux pans
      const a = kind === 'church' ? 0.45 : 0.2, roof = kind === 'church' ? 0x8c3b2b : pick([0x3b6fb6, 0x4a7fc1, 0x3d6aa8, 0x8c9196, 0x6f747a]);
      for (const e of [-1, 1]) b.box(w / 2 / Math.cos(a) + 0.4, 0.14, d + 0.5, roof, cx + lx[0] * e * w / 4, h + w / 4 * Math.tan(a), cz + lx[1] * e * w / 4, 0, ry, -e * a);
      top = h + w / 2 * Math.tan(a);
    } else if ((kind === 'house' || kind === 'apartments' || kind === 'hotel') && Math.abs(Math.sin(2 * ry)) < 0.35 && chance(kind === 'house' ? (side < 0 ? 0.6 : 0.3) : 0.35)) {
      const swap = Math.abs(Math.sin(ry)) > 0.7;                                          // toit de tuiles à quatre pans
      addHipRoof(b, cx, h, cz, swap ? d : w, swap ? w : d);
      top = h + 2.5;
    } else {
      b.box(w + 0.5, 0.18, d + 0.5, kind === 'house' || kind === 'commercial' ? pick(TIN) : 0x9a958a, cx, h + 0.1, cz, 0, ry, 0);
    }
    // Enseigne des bâtiments qui ont un nom dans OSM (une seule par nom), côté boulevard
    const name = (name0 || '').replace(/^kn\s+/i, '');
    if (name && !labelled.has(name) && back < 170) {
      labelled.add(name);
      const [bg, fg, def] = OSM_SIGN[kind] ?? OSM_SIGN.house, sw = Math.max(3.5, Math.min(12, zl * 0.9)), y = Math.max(2.6, Math.min(h - 1, 7));
      signs.add(`osm_${side}_${Math.round(cz)}`, () => signTexture(name.toUpperCase(), sub || def, bg, fg), sw, sw / 3.2, side * (xi - 0.1), y, cz, -side * Math.PI / 2, true);
      if (kind === 'health') b.box(0.2, 1.8, 0.55, 0xd62828, side * (xi - 0.12), y + sw / 6.4 + 1.2, cz).box(0.2, 0.55, 1.8, 0xd62828, side * (xi - 0.12), y + sw / 6.4 + 1.2, cz);
      if (kind === 'church') b.box(0.22, 2.4, 0.22, 0xf5c400, cx, top + 1.2, cz).box(0.22, 0.22, 1.4, 0xf5c400, cx, top + 1.7, cz);
      if (kind === 'public' && xi < F + 8) addFlag(b, signs, side * (F + 1), cz + Math.min(4, zl / 2), 8);
    } else if (xi < F + 2 && (kind === 'house' || kind === 'commercial') && chance(side < 0 ? 0.35 : 0.2)) {
      const k = Math.floor(Math.random() * SHOP_SIGNS.length), [t, s2, bg, fg] = SHOP_SIGNS[k];          // boutique sur le petit boulevard
      signs.add(`shop${k}`, () => signTexture(t, s2, bg, fg, true), Math.min(zl * 0.85, 6), 1.15, side * (xi - 0.06), Math.min(h - 0.7, 3.3), cz, -side * Math.PI / 2);
    }
  }
  // Murs de clôture (avec portails) le long du trottoir, entre les bâtiments qui donnent sur le petit boulevard
  const cuts = [...gaps, ...front.map(([a, c]) => [a + 0.4, c - 0.4]), ...blocks.map(([a, c]) => [a, c])];
  for (const [p, q] of minus(pieces(zA, zB, 400), cuts)) {
    for (let z = p; z > q + 1.5;) {
      const len = Math.min(z - q, rand(8, 18)), zc = z - len / 2, b = chunks.at(zc), x = side * (F + 0.15);
      b.box(0.25, 2.3, len, pick(WALLS), x, 1.15, zc);
      if (len > 5) b.box(0.12, 2.1, Math.min(3.2, len * 0.3), pick(GATES), x - side * 0.08, 1.05, zc + rand(-len / 4, len / 4));
      z -= len;
    }
  }
}

/**
 * Limete, de la 16e Rue à la 1re Rue, d'après le croquis OSM (numéros et positions dans routes.js `limete`) :
 * de chaque côté une bande de pelouse, puis un petit boulevard à double sens (Industriel à droite, Résidentiel à
 * gauche). Les rues partent du petit boulevard, ou de la chaussée en traversant la bande ; façades derrière.
 * Le terre-plein n'est ouvert qu'aux grands carrefours (limete.median : voir la boucle du séparateur).
 */
/**
 * Croisement du boulevard Sendwe, au bout du trajet (limete.fork) : le grand boulevard tourne à gauche (boulevard Sendwe,
 * deux chaussées et terre-plein), le boulevard Lumumba continue un peu à droite ; station-service dans la pointe entre
 * les deux (auvent, pompes, boutique, totem tourné vers l'arrivée), église en face côté industriel, panneaux de direction.
 */
function addSendweFork(chunks, details, signs, rigid) {
  // Avec le prolongement (routes.js `ext`), la chaussée elle-même tourne à gauche sur le boulevard Sendwe : ici, seulement le
  // boulevard Lumumba qui continue à droite, la pointe (station) et l'église, posés en bloc dans le repère de la route droite
  // qui arrive à la fourche (ils ne suivent pas le virage)
  const f = LIM.fork, ze = Z_FORK, b = EXT ? rigid.at(ze) : chunks.at(ze - 40), d = EXT ? b : details.at(ze - 40);
  const zr = EXT ? ze : null, sadd = (key, make, w, h, x, y, z, ry, basic) => signs.add(key, make, w, h, x, y, z, ry, basic, zr);
  const off = (pts, k) => pts.map((p, i) => {             // courbe de contrôle décalée de k m vers la droite (k < 0 : gauche)
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    return [p[0] - (c[1] - a[1]) / L * k, p[1] + (c[0] - a[0]) / L * k];
  });
  const xAt = (pts, z) => {                               // x de la courbe à la hauteur z
    let best = null;
    for (let i = 0; i <= 60; i++) { const q = bez(pts, i / 60); if (!best || Math.abs(q[1] - z) < Math.abs(best[1] - z)) best = q; }
    return best[0];
  };
  const strip = (pts, w, h, y, col, t0 = 0, n = 16, alt = null) => {   // bande le long d'une courbe (terre-plein, bordure)
    for (let i = Math.round(t0 * n); i < n; i++) {
      const [ax, az] = bez(pts, i / n), [bx, bz] = bez(pts, (i + 1) / n), len = Math.hypot(bx - ax, bz - az);
      b.box(w, h, len + 0.05, alt && i % 2 ? alt : col, (ax + bx) / 2, y, (az + bz) / 2, 0, Math.atan2(bx - ax, bz - az), 0);
    }
  };
  const half = MEDIAN + LANE_W * LANES / 2, CW = LANE_W * LANES, NOCURB = { innerFrom: 99, outerFrom: 99, rail: false };
  // Boulevard Sendwe : les deux chaussées tournent à gauche (~30°) ; boulevard Lumumba : 2 × 2 voies, un peu à droite (~15°).
  // Au départ les deux se recouvrent (les voies se séparent) : bordures et pointe seulement là où ils sont séparés (t ≥ 0,45)
  const S = [[0, ze], [0, ze - 12], [-12, ze - 40], [-55, ze - 115]];
  const Lm = [[ROAD_EDGE - 7, ze], [ROAD_EDGE - 7, ze - 12], [ROAD_EDGE, ze - 40], [ROAD_EDGE + 21, ze - 115]];
  const ext = (P, L) => {                                 // prolongement en ligne droite (jusque dans la brume)
    const [a, c] = [P[2], P[3]], n = Math.hypot(c[0] - a[0], c[1] - a[1]);
    return [c, [c[0] + (c[0] - a[0]) / n * L, c[1] + (c[1] - a[1]) / n * L]];
  };
  const S2 = ext(S, 160), L2 = ext(Lm, 160);
  if (!EXT) for (const [P, n] of [[S, 16], [S2, 10]]) {
    for (const k of [half, -half]) bezierRoad(b, off(P, k), CW, n, NOCURB);
    strip(P, MEDIAN * 2, 0.22, 0.11, 0xa9a49a, 0, n);
  }
  // (prolongement : le boulevard Lumumba passe sous la chaussée là où il la recouvre encore)
  const lb = EXT ? new Builder() : b;
  for (const [P, n] of [[Lm, 16], [L2, 10]]) bezierRoad(lb, P, 14, n, { ...NOCURB, dash: !EXT });
  if (EXT) for (const g of lb.parts) b.parts.push(g.translate(0, -0.05, 0));
  const sR = off(S, ROAD_EDGE + 0.15), sL = off(S, -ROAD_EDGE - 0.15), lL = off(Lm, -7.15), lR = off(Lm, 7.15);
  for (const [pts, t0] of [...(EXT ? [] : [[sL, 0], [sR, 0.45], [off(S2, ROAD_EDGE + 0.15), 0], [off(S2, -ROAD_EDGE - 0.15), 0]]),
    [lR, 0.45], [lL, 0.45], [off(L2, 7.15), 0], [off(L2, -7.15), 0]]) strip(pts, 0.3, 0.22, 0.11, CURB_LIGHT, t0, 32, CURB_DARK);
  // bord droit du boulevard Sendwe (avec le prolongement : celui de la chaussée, qui tourne) dans le repère de la fourche
  const edgeF = EXT ? (() => {
    const p = frameAt(ze), c = Math.cos(p.th), s = Math.sin(p.th), w = { x: 0, z: 0 }, out = [];
    for (let z = ze; z > ze - 240; z -= 2) {
      toWorld(ROAD_EDGE + 0.15, z, w, true);
      const dx = w.x - p.x, dz = w.z - p.z;
      out.push([dx * c + dz * s, ze - dx * s + dz * c]);
    }
    return out;
  })() : null;
  const xS = !EXT ? z => xAt(sR, z) : z => {
    for (let i = 1; i < edgeF.length; i++) {
      if (edgeF[i][1] > z) continue;
      const [a, c] = [edgeF[i - 1], edgeF[i]], t = (a[1] - z) / ((a[1] - c[1]) || 1);
      return a[0] + (c[0] - a[0]) * t;
    }
    return edgeF[edgeF.length - 1][0];
  };
  // début de la pointe : là où les deux boulevards se séparent (au moins 1,5 m entre les bordures)
  let zSep = ze - 34;
  if (EXT) for (let z = ze - 20; z > ze - 100; z -= 1) if (xAt(lL, z) - xS(z) > 1.5) { zSep = z; break; }
  // Maisons et boutiques le long des deux boulevards (hors OSM : le trajet s'arrête à la fourche), tournées vers la route
  const row = (P, k, t0, t1, n) => {
    for (let i = 0; i < n; i++) {
      const t = t0 + (t1 - t0) * (i + 0.5) / n, q = bez(off(P, k), t), a = bez(P, Math.max(0, t - 0.02)), c = bez(P, Math.min(1, t + 0.02));
      const ry = Math.atan2(c[0] - a[0], c[1] - a[1]), w = rand(8, 13), dd = rand(8, 11), h = rand(3.5, 8.5);
      b.box(dd, h, w, pick(WALLS), q[0], h / 2, q[1], 0, ry, 0).box(dd + 0.6, 0.15, w + 0.6, pick(TIN), q[0], h + 0.1, q[1], 0, ry, 0);
    }
  };
  if (!EXT) { row(S, -24, 0.55, 1, 4); row(S2, -24, 0, 1, 9); row(S2, 24, 0.2, 1, 7); }
  row(L2, 16, 0.2, 1, 7); row(L2, -16, 0.2, 1, 7);                  // (à droite du bd Lumumba, d'abord l'église)
  // Pointe entre les deux : pelouse au bout, puis la cour pavée de la station
  const edgePts = (z0, z1, n) => Array.from({ length: n + 1 }, (_, i) => z0 + (z1 - z0) * i / n);
  const poly = (z0, z1, y, col) => {
    const zs = edgePts(z0, z1, 6), left = zs.map(z => [xS(z) + 0.2, z]), right = zs.map(z => [xAt(lL, z) - 0.2, z]).reverse();
    flatPolyClean(b, [...left, ...right], y, col);
  };
  poly(zSep, zSep - 14, 0.1, 0x5e8f3e);
  poly(zSep - 14, ze - 112, 0.06, 0xc8c3b8);
  for (let i = 0; i < 3; i++) addPalm(b, (xS(zSep - 4 - i * 4) + xAt(lL, zSep - 4 - i * 4)) / 2 + rand(-0.8, 0.8), zSep - 4 - i * 4, rand(0.7, 0.9));
  // Station : auvent sur 4 poteaux, 3 îlots de pompes, boutique au fond, totem à la pointe (vers l'arrivée du taxi)
  const zc = ze - 74, xc = (xS(zc) + xAt(lL, zc)) / 2, BLUE = 0x1d4fa0, key = 'fork_station';
  b.box(18, 0.7, 12, 0xf4f4f0, xc, 5.4, zc).box(18.2, 0.5, 12.2, BLUE, xc, 5.0, zc);
  for (const [px, pz] of [[-7.5, -5], [7.5, -5], [-7.5, 5], [7.5, 5]]) b.box(0.4, 5, 0.4, 0xd8dde2, xc + px, 2.5, zc + pz);
  for (const px of [-5, 0, 5]) {
    b.box(1.2, 0.25, 7, 0xbdb7a9, xc + px, 0.13, zc);
    for (const pz of [-1.8, 1.8]) b.box(0.7, 1.6, 0.5, 0xf4f4f0, xc + px, 1.05, zc + pz).box(0.72, 0.3, 0.52, BLUE, xc + px, 1.75, zc + pz);
  }
  b.box(14, 4, 7, 0xf2efe8, xc, 2, zc - 16).box(14.4, 0.5, 7.4, BLUE, xc, 4.2, zc - 16).box(10, 2.2, 0.1, 0x34404c, xc, 1.6, zc - 12.45);
  sadd(key, () => signTexture(f.station.name, f.station.sub ?? '', '#1d4fa0', '#ffffff'), 9, 1.4, xc, 4.7, zc + 6.15, 0, true);
  const tz = zSep - 10, tx = (xS(tz) + xAt(lL, tz)) / 2;
  b.box(2.4, 7, 0.5, BLUE, tx, 3.5, tz);
  sadd(key, () => signTexture(f.station.name, f.station.sub ?? '', '#1d4fa0', '#ffffff'), 2.2, 2.2, tx, 5.6, tz + 0.27, 0, true);
  for (let i = 0; i < 3; i++) addParkedCar(b, xc + rand(-6, 6), zc + rand(-3, 3), rand(-0.2, 0.2));
  for (let i = 0; i < 6; i++) addPerson(d, xc + rand(-8, 8), zc + rand(-12, 6));
  // Panneaux de direction sur un portique juste après l'arrivée : boulevard Sendwe à gauche, boulevard Lumumba à droite
  const dz = ze - 4;
  for (const x of [MEDIAN + 0.3, ROAD_EDGE + 0.4]) b.box(0.4, 7, 0.4, 0x5c6670, x, 3.5, dz);
  b.box(ROAD_EDGE - MEDIAN, 0.3, 0.3, 0x5c6670, (ROAD_EDGE + MEDIAN) / 2, 6.9, dz);
  for (const [x, name] of [[MEDIAN + 3.7, '← ' + f.left], [ROAD_EDGE - 3.3, f.right + ' →']]) {
    sadd(`fork_dir_${name}`, () => signTexture(name, '', '#1d4fa0', '#ffffff'), 6.2, 1.5, x, 6.0, dz + 0.2, 0, true);
  }
  // Église en face de la station, à droite du boulevard Lumumba (photos de l'auteur), tournée vers la pointe : immeuble de
  // verre fumé bleu-gris à structure gris anthracite, lettres blanches sur le bandeau du haut, enseigne bleue lumineuse au
  // milieu de la façade, deux ailes plus basses (écran géant sur celle de gauche), palmiers devant ; parvis avec rangées de
  // chaises bleues et fidèles, tentes blanches à gauche, voitures garées à droite
  const th = 0.6, ct = Math.cos(th), st = Math.sin(th), cz = ze - 80, cx = xAt(lR, cz) + 27, CK = 'fork_church';
  const W = (lx, lz) => [cx + lx * ct + lz * st, cz - lx * st + lz * ct];   // repère de l'église → route (lx < 0 : devant)
  const bx = (w, h, dd, col, lx, y, lz) => { const [x, z] = W(lx, lz); b.box(w, h, dd, col, x, y, z, 0, th, 0); };
  const sg = (key, make, w, h, lx, y, lz) => { const [x, z] = W(lx, lz); sadd(key, make, w, h, x, y, z, th - Math.PI / 2, true); };
  const GLASS = 0x2f4d6e, FRAME = 0x4c525a, BASE = 0x3c4148, TRIM = 0x7a7f86;
  bx(18, 13, 14, FRAME, 0, 6.5, 0);                                    // bloc central (3 niveaux)
  bx(0.3, 9.4, 13, GLASS, -9.1, 7.9, 0);                               // façade de verre
  for (const y of [6.3, 9.5]) bx(0.36, 0.18, 13, FRAME, -9.15, y, 0);
  for (const lz of [-4.3, -1.4, 1.4, 4.3]) bx(0.36, 9.4, 0.15, FRAME, -9.15, 7.9, lz);
  for (const lz of [-7, 7]) bx(0.5, 13, 0.5, 0xdadde0, -9.2, 6.5, lz); // montants clairs
  bx(18.4, 0.5, 14.4, TRIM, 0, 13.25, 0);
  bx(1.2, 2.6, 12, 0x6b7079, -8.6, 14.3, 0);                           // bandeau des lettres, au-dessus du toit
  bx(0.4, 3.2, 14, BASE, -9.1, 1.6, 0);                                // rez-de-chaussée sombre, portes vitrées
  bx(0.45, 2.6, 5, 0x1c2a38, -9.15, 1.3, 0);
  for (const e of [-1, 1]) {                                           // ailes
    bx(17, 9, 7, FRAME, 0.5, 4.5, e * 10.5);
    bx(0.3, 5.6, 6.4, GLASS, -8.1, 6.0, e * 10.5);
    bx(0.36, 0.18, 6.4, FRAME, -8.15, 6.0, e * 10.5);
    bx(0.4, 3.2, 7, BASE, -8.1, 1.6, e * 10.5);
    bx(17.4, 0.5, 7.4, TRIM, 0.5, 9.25, e * 10.5);
  }
  bx(0.3, 3.6, 5.9, 0x1a1a1a, -8.3, 5.8, -10.5);                       // écran géant, aile de gauche
  sg(`${CK}_screen`, screenTexture, 5.4, 3.1, -8.47, 5.8, -10.5);
  sg(`${CK}_top`, () => letterTexture(f.church.name, '#6b7079', '#ffffff'), 11.4, 2.2, -9.26, 14.3, 0);
  sg(`${CK}_lit`, () => signTexture(f.church.name, '', '#1f5fd6', '#ffffff'), 5.6, 1.7, -9.4, 8.7, 0);
  bx(1.4, 0.5, 13, 0x6b6f75, -10.4, 0.25, 0);                          // jardinière : fleurs et palmiers
  for (let i = 0; i < 12; i++) { const [x, z] = W(-10.4 + rand(-0.4, 0.4), -6 + i * 1.1); b.ball(0.35, pick([0xd62828, 0xf5c400, 0x4b8a3c, 0x3f7a35]), x, 0.65, z); }
  for (const lz of [-5, -1.7, 1.7, 5]) { const [x, z] = W(-10.4, lz); addPalm(b, x, z, rand(0.75, 0.9)); }
  bx(10, 0.05, 30, 0xc8c3b8, -14, 0.03, 0);                            // parvis
  for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) {           // chaises bleues (tournées vers l'église), fidèles assis
    const lx = -12.8 - r * 1.3, lz = -5.2 + c * 0.8, [x, z] = W(lx, lz), [kx, kz] = W(lx - 0.25, lz);
    b.box(0.5, 0.47, 0.5, 0x1d5fbf, x, 0.235, z + 0.15, 0, th, 0).box(0.08, 0.5, 0.48, 0x1d5fbf, kx, 0.72, kz + 0.15, 0, th, 0);
    if (chance(0.6)) addPerson(d, x, z, { sitting: true, ry: Math.PI / 2 + th });
  }
  for (let i = 0; i < 6; i++) { const [x, z] = W(-9.9 - rand(0, 1), rand(-3, 3)); addPerson(d, x, z); }
  for (const lz of [-17.5, -22]) {                                     // tentes blanches
    for (const [ex, ez] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const [x, z] = W(-5 + ex, lz + ez); b.box(0.1, 2.6, 0.1, 0xd8d8d8, x, 1.3, z); }
    const [x, z] = W(-5, lz);
    b.add(new THREE.ConeGeometry(3.1, 0.9, 4), 0xf4f4f0, x, 3.05, z, 0, th + Math.PI / 4, 0);
    for (let i = 0; i < 3; i++) { const [px, pz] = W(-5 + rand(-1.2, 1.2), lz + rand(-1.2, 1.2)); addPerson(d, px, pz, { sitting: true }); }
  }
  for (const lz of [8.6, 11.2, 13.8]) { const [x, z] = W(-14.5, lz); addParkedCar(b, x, z, th + Math.PI / 2); }
}

/** Flèche peinte au sol (3,2 m) en (cx, cz), pointe vers f (vecteur unitaire x, z). */
function addRoadArrow(b, cx, cz, f, y = 0.065) {
  const p = [-f[1], f[0]], P = (a, s) => [cx + f[0] * a + p[0] * s, cz + f[1] * a + p[1] * s];
  flatPoly(b, [P(-1.6, 0.18), P(0.3, 0.18), P(0.3, -0.18), P(-1.6, -0.18)], y, 0xf2f2ec);
  flatPoly(b, [P(0.3, 0.55), P(1.6, 0), P(0.3, -0.55)], y, 0xf2f2ec);
}

/** Panneau « sens interdit » (disque rouge à barre blanche, dos gris) en (x, z), tourné vers (fx, fz). */
function addNoEntry(b, x, z, fx, fz) {
  const ry = Math.atan2(fx, fz), at = k => [x + fx * k, z + fz * k], [px, pz] = at(-0.08), [gx, gz] = at(-0.03), [wx, wz] = at(0.025);
  b.box(0.08, 2.5, 0.08, 0x8e949a, px, 1.25, pz)
    .cyl(0.44, 0.44, 0.02, 0x9aa0a6, gx, 2.45, gz, Math.PI / 2, ry, 0, 20)
    .cyl(0.42, 0.42, 0.03, 0xd62828, x, 2.45, z, Math.PI / 2, ry, 0, 20)
    .box(0.56, 0.12, 0.02, 0xffffff, wx, 2.45, wz, 0, ry, 0);
}

// ---------- Bande de Limete côté industriel (l'auteur, 31/10 ; vidéo « LIMETE 15ème rue ｜ Décoration de la nativité ») ----------
// Décorations lumineuses (palmiers et sapins de lumière, arches, tunnel, dômes, cube-cadeau, vasque tressée, flocons) : les
// lumières vont dans `glow` (matériau sans éclairage, elles brillent), les mâts et armatures dans le décor normal.
const LIGHT_COLS = [0xff3b3b, 0x2ee86f, 0xffffff, 0x4fb3ff, 0xff4fd8, 0xffe14f];
/** Palmier lumineux : mât blanc, panache de 4 ou 5 grandes feuilles de lumière colorées. */
function addLightPalm(b, glow, x, z, h = rand(6, 7.5)) {
  b.cyl(0.09, 0.13, h, 0xf2f2ef, x, h / 2, z);
  const n = 4 + Math.floor(Math.random() * 2), a0 = rand(0, 6.28);
  for (let i = 0; i < n; i++) {
    const az = a0 + i * 2 * Math.PI / n + rand(-0.3, 0.3), tilt = rand(0.45, 0.85), L = rand(2.2, 3), c = Math.cos(tilt) * L / 2;
    glow.add(new THREE.SphereGeometry(1, 10, 6).scale(0.4, 0.06, L / 2), pick(LIGHT_COLS),
      x + Math.sin(az) * c, h - 0.15 + Math.sin(tilt) * L / 2, z + Math.cos(az) * c, -tilt, az, 0);
  }
  glow.ball(0.22, 0xffffff, x, h, z);
}
/** Sapin de lumière : cône, guirlandes en anneaux, étoile au sommet. */
function addLightCone(glow, x, z, h, col, ring = null) {
  const r = h * 0.3;
  glow.add(new THREE.ConeGeometry(r, h, 12), col, x, h / 2, z);
  if (ring) for (let k = 1; k <= 3; k++) glow.add(new THREE.TorusGeometry(r * (1 - k / 4) + 0.05, 0.07, 4, 18), ring, x, h * k / 4, z, Math.PI / 2, 0, 0);
  glow.add(new THREE.OctahedronGeometry(0.3 + h * 0.035), 0xfff1a8, x, h + 0.3, z);
}
/** Arche de lumière au-dessus d'une allée qui suit z (galerie d'arches vertes). */
const addLightArch = (glow, x, z, r, tube, col) => glow.add(new THREE.TorusGeometry(r, tube, 6, 20, Math.PI), col, x, 0, z);
/** Tunnel de lumières blanches et dorées (arches serrées et lisses le long de l'allée), de z0 à z1 (z0 > z1). */
function addLightTunnel(glow, x, z0, z1, r = 2.3) {
  for (let z = z0, k = 0; z >= z1; z -= 1.6, k++) glow.add(new THREE.TorusGeometry(r, 0.06, 4, 20, Math.PI), k % 2 ? 0xffd27a : 0xffffff, x, 0, z);
  for (const a of [0.35, 0.8, 1.2, 1.57, 1.94, 2.34, 2.79]) glow.box(0.06, 0.06, z0 - z1, 0xfff4d6, x + Math.cos(a) * r, Math.sin(a) * r, (z0 + z1) / 2);
}
/** Flocon de lumière (sur les lampadaires), tourné vers le boulevard. */
function addSnowflake(glow, x, y, z, r = 0.8) {
  for (let k = 0; k < 3; k++) glow.box(0.07, 2 * r, 0.07, 0xdff6ff, x, y, z, k * Math.PI / 3, 0, 0);
  glow.ball(0.15, 0xffffff, x, y, z);
}
/** Banc de jardin (assise le long de z, ou le long de x). */
function addParkBench(b, x, z, alongZ = true) {
  b.box(alongZ ? 0.45 : 1.7, 0.06, alongZ ? 1.7 : 0.45, 0x8b5a2b, x, 0.46, z);
  for (const k of [-0.7, 0.7]) b.box(alongZ ? 0.4 : 0.06, 0.44, alongZ ? 0.06 : 0.4, 0x555555, x + (alongZ ? 0 : k), 0.22, z + (alongZ ? k : 0));
}
/** Enfant (personnage aux deux tiers de la taille). */
function addKid(b, x, z, ry = Math.random() * 6.28) {
  const o = outfit(chance(0.5) ? 'woman' : 'man');
  Object.assign(o, { height: rand(0.55, 0.7), basin: null, headwrap: null, beard: false, cap: chance(0.2) ? 0xd62828 : null });
  bakeCharacter(b, o, 'idle', x, z, ry, Math.random() * 10, true);
}
// Jeux pour enfants (aire de jeux de la 14e Rue) : balançoires, toboggan, tourniquet, tape-cul, jeux à ressort, dôme à grimper,
// bac à sable
function addSwings(b, x, z) {
  const H = 2.6, BLUE = 0x2e86de;
  b.box(0.12, 0.12, 7.4, BLUE, x, H, z);
  for (const dz of [-3.6, 3.6]) for (const k of [-1, 1]) b.box(0.1, 2.75, 0.1, BLUE, x + k * 0.75, H / 2, z + dz, 0, 0, k * 0.28);
  for (const dz of [-2.2, 0, 2.2]) {
    for (const k of [-0.25, 0.25]) b.box(0.03, 2.0, 0.03, 0x9aa0a6, x, H - 1.0, z + dz + k);
    b.box(0.3, 0.06, 0.6, pick([0xd62828, 0xf5c400, 0x2b8a3e]), x, 0.6, z + dz);
  }
}
function addSlideTower(b, x, z) {
  const P = 1.6, RED = 0xd62828, Y = 0xf5c400, BLUE = 0x2e86de;
  for (const dx of [-0.8, 0.8]) for (const dz of [-0.8, 0.8]) b.box(0.1, 2.9, 0.1, BLUE, x + dx, 1.45, z + dz);
  b.box(1.7, 0.1, 1.7, 0x8b5a2b, x, P, z).add(new THREE.ConeGeometry(1.35, 0.9, 4).rotateY(Math.PI / 4), RED, x, 3.35, z);
  for (const dx of [-0.85, 0.85]) b.box(0.05, 0.6, 1.7, Y, x + dx, P + 0.35, z);
  for (const dx of [-0.35, 0.35]) b.box(0.06, 1.9, 0.06, Y, x + dx, 0.95, z + 1.25, -0.25, 0, 0);   // échelle (côté +z)
  for (let k = 0; k < 5; k++) b.box(0.7, 0.05, 0.05, Y, x, 0.3 + k * 0.33, z + 1.45 - k * 0.08);
  const L = 3.6, a = Math.atan2(P - 0.25, L), len = Math.hypot(L, P - 0.25), zc = z - 0.85 - L / 2, yc = (P + 0.25) / 2;
  b.box(0.7, 0.06, len, Y, x, yc, zc, -a, 0, 0);                                                     // toboggan (côté -z)
  for (const dx of [-0.37, 0.37]) b.box(0.05, 0.22, len, RED, x + dx, yc + 0.12, zc, -a, 0, 0);
}
function addMerryGoRound(b, x, z) {
  b.cyl(1.5, 1.5, 0.14, 0xd62828, x, 0.32, z, 0, 0, 0, 16).cyl(1.52, 1.52, 0.04, 0xf5c400, x, 0.41, z, 0, 0, 0, 16)
    .cyl(0.12, 0.12, 1.2, 0x8e949a, x, 0.9, z).cyl(0.2, 0.25, 0.25, 0x555555, x, 0.12, z);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    b.box(0.05, 0.05, 1.3, 0x2e86de, x + Math.sin(a) * 0.65, 1.0, z + Math.cos(a) * 0.65, 0, a, 0)
      .box(0.05, 0.6, 0.05, 0x2e86de, x + Math.sin(a) * 1.3, 0.7, z + Math.cos(a) * 1.3);
  }
}
function addSeeSaw(b, x, z) {
  b.box(0.3, 0.45, 0.4, 0x555555, x, 0.22, z).box(0.3, 0.07, 3.6, pick([0x2b8a3e, 0xd62828, 0x2e86de]), x, 0.52, z, 0.14, 0, 0);
  for (const dz of [-1.5, 1.5]) b.box(0.4, 0.06, 0.06, 0xf5c400, x, 0.78 + (dz > 0 ? -0.22 : 0.22), z + dz);
}
function addSpringRider(b, x, z, col) {
  b.cyl(0.08, 0.08, 0.45, 0x8e949a, x, 0.35, z).ball(0.32, col, x, 0.78, z, 1, 0.8, 1.5).ball(0.17, col, x, 1.08, z + 0.38)
    .box(0.42, 0.04, 0.04, 0x222222, x, 1.02, z + 0.27);
}
function addClimbDome(b, x, z, r = 1.9) {
  for (let k = 0; k < 4; k++) b.add(new THREE.TorusGeometry(r, 0.045, 4, 16, Math.PI), 0xe67e22, x, 0.1, z, 0, k * Math.PI / 4, 0);
  for (const h of [0.7, 1.35]) b.add(new THREE.TorusGeometry(Math.sqrt(r * r - h * h), 0.045, 4, 20), 0xe67e22, x, h + 0.1, z, Math.PI / 2, 0, 0);
}
function addSandbox(b, x, z, s = 4) {
  b.box(s, 0.08, s, 0xe8d39a, x, 0.16, z);
  for (const [dx, dz, w, d] of [[0, s / 2, s + 0.3, 0.15], [0, -s / 2, s + 0.3, 0.15], [s / 2, 0, 0.15, s], [-s / 2, 0, 0.15, s]]) {
    b.box(w, 0.3, d, 0x8b5a2b, x + dx, 0.27, z + dz);
  }
}

function addLimete(chunks, details, curbs, signs, scene) {
  const PX = LIM_PB_X, xIn = PX - PB_W / 2, xOut = PX + PB_W / 2;   // bords du petit boulevard de Limete
  const xLawn = ROAD_EDGE + LIM_LAWN;                                // limite pelouse / terre battue
  const F = xOut + 2, DX = F - FRONT;                                 // alignement des façades derrière le petit boulevard
  const GRASS = 0x5e8f3e, DIRT = 0xbf9568, WALK = 0xbfa57e, PAVE = 0xc8c3b8, SHRUB = [0x4b8a3c, 0x3f7a35, 0x56963f, 0x467f38];
  const zEnd = Z_FORK + 1, rad = a => a * Math.PI / 180, zOf = s => -toGame(s);
  // À gauche, le petit boulevard part de la bretelle de l'Échangeur (pbL), là où elle passe à sa hauteur
  const tJ = pblT(xIn), tW = pblT(xOut + 0.3);
  const zJ = innerEdge(PBL_PTS, PB_W, tJ)[1], zW = innerEdge(PBL_PTS, PB_W, tW)[1];
  {                                                       // la bretelle continue tout droit (vers l'Av. Sefu)
    const [p2, p3] = [PBL_PTS[2], PBL_PTS[3]], L = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    bezierRoad(chunks.at(p3[1]), [p3, [p3[0] + (p3[0] - p2[0]) / L * 42, p3[1] + (p3[1] - p2[1]) / L * 42]], PB_W, 7, { rail: false });
  }
  // À droite, le petit boulevard de l'Échangeur s'écarte juste après la 16e Rue : la bande s'élargit
  const zR0 = Z16 - 5.5, zT = zR0 - 45, curveR = [[PB_X, zR0], [PB_X, zR0 - 16], [PX, zR0 - 29], [PX, zT]];
  bezierRoad(chunks.at(zR0), curveR, PB_W, 12, { rail: false });
  for (let i = 0; i < 10; i++) {
    const a = innerEdge(curveR, PB_W, i / 10), c = innerEdge(curveR, PB_W, (i + 1) / 10);
    flatPoly(chunks.at(a[1]), [[ROAD_EDGE + 0.6, a[1]], [a[0] - 0.3, a[1]], [c[0] - 0.3, c[1]], [ROAD_EDGE + 0.6, c[1]]], 0.12, GRASS);
  }
  const places = (LIM.places ?? []).map(p => ({ ...p, z: zOf(p.s) }));
  const rivers = RIVERS.filter(r => r.z < Z16 && r.z > Z_FORK);     // la Yolo, juste avant la 1re Rue
  const leftStops = (LIM.leftStops ?? []).map(([s, label]) => ({ z: zOf(s), label }));
  const rightStops = BUS_STOPS.filter(z => z < Z16 && z > Z_FORK);
  const busy = (z, stops) => stops.some(q => Math.abs(z - q) < 16) || STRIP_STATIONS.some(st => Math.abs(z - st.z) < 19)
    || FOOTBRIDGES.some(q => z < q + 15 && z > q - 4);
  const sideOf = {};                                      // zones à éviter dans la bande, par côté (pour les panneaux publicitaires)
  // Parcs de la bande (routes.js `stripParks`) : décorations lumineuses (16e – 15e Rue), aire de jeux (14e Rue – passerelle)
  const parks = (LIM.stripParks ?? []).map(p => {
    const za = zOf(p.s0) - (p.kind === 'playground' ? 8.5 : 4), zb = p.before ? g(p.s1) + p.before : zOf(p.s1) + 2;
    return { ...p, za, zb };
  });
  const glow = new Builder();                             // lumières des décorations (sans éclairage : elles brillent)

  for (const side of [1, -1]) {
    const z0 = side > 0 ? zT : zJ;
    const mine = LIM_ST.filter(r => r.side === side);
    const cross = mine.filter(r => r.from === 'road');
    const stops = side > 0 ? rightStops : leftStops.map(s => s.z);
    const named = places.filter(p => p.side === side);
    // Rues au-delà du petit boulevard ; une rue en biais démarre un peu plus loin pour ne pas mordre sur le petit boulevard
    const mouths = mine.filter(r => r.from !== 'road' || r.len > 0).map(r => {
      const a = rad(r.ang), w = r.from === 'service' ? 5 : r.w, zm = r.from === 'road' ? r.z2 : r.z;
      const u = [side * Math.cos(a), -Math.sin(a)], n = [-u[1], u[0]];
      const xe = side * (xOut - 0.2), S = [side * (xOut + 0.4 + (w / 2) * Math.abs(Math.sin(a))), zm];
      const c1 = [S[0] + n[0] * w / 2, S[1] + n[1] * w / 2], c2 = [S[0] - n[0] * w / 2, S[1] - n[1] * w / 2];
      const zAt = (c, x) => c[1] + u[1] / u[0] * (x - c[0]);          // bord de la rue prolongé jusqu'à x
      const e1 = [xe, zAt(c1, xe)], e2 = [xe, zAt(c2, xe)];
      const xs = [xe, side * (F + Math.min(26, r.len))], zs = [c1, c2].flatMap(c => xs.map(x => zAt(c, x)));
      return { r, w, zm, u, n, S, c1, c2, e1, e2, zTop: Math.max(e1[1], e2[1]), zBot: Math.min(e1[1], e2[1]),
        foot: [Math.max(...zs) + 2.5, Math.min(...zs) - 2.5] };
    });
    const inAny = (z, list, m = 0) => list.some(([a, c]) => z <= a + m && z >= c - m);
    const innerGaps = cross.map(r => [r.z2 + r.w / 2 + 0.3, r.z2 - r.w / 2 - 0.3]);
    const crossCuts = cross.map(r => [Math.max(r.z, r.z2) + r.w / 2 + 0.1, Math.min(r.z, r.z2) - r.w / 2 - 0.1]);
    const lawnCuts = [...stops.map(z => (side > 0 ? [z + 21, z - 21] : [z + 13, z - 13])),
      ...(side > 0 ? STRIP_STATIONS.map(st => [st.z + 15.5, st.z - 15.5]) : [])];
    const outerGaps = [...mouths.map(m => [m.zTop + 0.3, m.zBot - 0.3]),
      ...named.filter(p => p.kind === 'fuel').map(p => [p.z + 15, p.z - 15]), ...(side < 0 ? [[zJ + 1, zW - 0.5]] : [])];
    const edgeGaps = [...LIM_EDGE_GAPS.filter(q => q.side === side).map(q => [q.z + q.half, q.z - q.half]),
      ...SIDE_ROADS.filter(r => r.side === side).map(r => [r.z + r.w / 2, r.z - r.w / 2])];
    // Rivière : ni bande, ni trottoir, ni bordure au-dessus de l'eau (le petit boulevard passe sur son pont).
    // Cour d'un lieu (HJ Hospitals, `court`) : pavée de la chaussée au petit boulevard, au lieu de la pelouse et de la terre
    const riverCuts = rivers.map(r => [r.z + r.w / 2 + 0.6, r.z - r.w / 2 - 0.6]);
    const courts = named.filter(p => p.court).map(p => [zOf(p.court[0]), zOf(p.court[1])]);
    const stRaphaelCut = side < 0 ? [[zOf(17435), zEnd - 2]] : [];
    innerGaps.push(...riverCuts, ...stRaphaelCut); outerGaps.push(...riverCuts, ...stRaphaelCut); edgeGaps.push(...riverCuts, ...stRaphaelCut);
    lawnCuts.push(...stRaphaelCut);

    // Petit boulevard (goudron continu), pelouse puis terre battue dans la bande, trottoir derrière, bordure du boulevard
    for (const [p, q] of pieces(z0 + (side < 0 ? 3 : 0), zEnd, 24)) chunks.at((p + q) / 2).box(PB_W, 0.05, p - q, ASPHALT_COL, side * PX, 0.04, (p + q) / 2);
    for (const r of rivers) addPbBridge(chunks.at(r.z), side, PX, r);
    for (const [p, q] of minus(pieces(z0, zEnd, 24), [...crossCuts, ...lawnCuts, ...riverCuts, ...courts])) {
      chunks.at((p + q) / 2).box(xLawn - ROAD_EDGE - 0.6, 0.12, p - q, GRASS, side * (ROAD_EDGE + 0.6 + xLawn) / 2, 0.06, (p + q) / 2);
    }
    const parkCuts = parks.filter(pk => pk.side === side).map(pk => [pk.za, pk.zb]);
    for (const [p, q] of minus(pieces(z0, zEnd, 24), [...crossCuts, ...riverCuts, ...courts, ...parkCuts])) {
      chunks.at((p + q) / 2).box(xIn - 0.3 - xLawn, 0.03, p - q, DIRT, side * (xLawn + xIn - 0.3) / 2, 0.015, (p + q) / 2);
    }
    for (const [pa, pb] of parkCuts) for (const [p, q] of minus(pieces(Math.min(pa, z0), pb, 24), [...crossCuts, ...riverCuts])) {   // (parcs : pelouse)
      chunks.at((p + q) / 2).box(xIn - 0.3 - xLawn, 0.12, p - q, GRASS, side * (xLawn + xIn - 0.3) / 2, 0.06, (p + q) / 2);
    }
    for (const [ca, cc] of courts) for (const [p, q] of minus(pieces(ca, cc, 24), crossCuts)) {
      chunks.at((p + q) / 2).box(xIn - 0.3 - ROAD_EDGE - 0.6, 0.06, p - q, PAVE, side * (ROAD_EDGE + 0.6 + xIn - 0.3) / 2, 0.0, (p + q) / 2);
    }
    for (const [p, q] of minus(pieces(z0, zEnd, 24), outerGaps)) chunks.at((p + q) / 2).box(F - xOut - 0.3, 0.04, p - q, WALK, side * (F + xOut + 0.3) / 2, 0.02, (p + q) / 2);
    for (const [p, q] of minus(pieces(side > 0 ? zR0 : ECH.pbL - 24.5, zEnd, 24), edgeGaps)) {
      chunks.at((p + q) / 2).box(0.6, 0.2, p - q, 0xb8b2a6, side * (ROAD_EDGE + 0.3), 0.1, (p + q) / 2);
    }
    if (side < 0) {                                       // pelouse entre le boulevard et la bretelle, jusqu'au petit boulevard
      const tA = tAtGap(PBL_PTS, PB_W, 13), n = 10;
      for (let i = 0; i < n; i++) {
        const a = innerEdge(PBL_PTS, PB_W, tA + (tJ - tA) * i / n), c = innerEdge(PBL_PTS, PB_W, tA + (tJ - tA) * (i + 1) / n);
        flatPoly(chunks.at(a[1]), [[-(ROAD_EDGE + 0.6), a[1]], [a[0] + 0.3, a[1]], [c[0] + 0.3, c[1]], [-(ROAD_EDGE + 0.6), c[1]]], 0.12, GRASS);
      }
    }
    // Bordures noir et blanc des deux côtés du petit boulevard, axe pointillé, lampadaires solaires
    let k = 0;
    for (let z = z0; z > zEnd + 0.75; z -= 1.5, k++) {
      const zm = z - 0.75, c = k % 2 ? CURB_DARK : CURB_LIGHT, cb = curbs.at(zm);
      if (!inAny(zm, innerGaps, 0.75)) cb.box(0.3, 0.22, 1.5, c, side * (xIn - 0.15), 0.11, zm);
      if (!inAny(zm, outerGaps, 0.75)) cb.box(0.3, 0.22, 1.5, c, side * (xOut + 0.15), 0.11, zm);
      if (k % 4 === 0) cb.box(0.18, 0.02, 3, 0xf2f2ec, side * PX, 0.07, z - 1.5);
    }
    for (let z = z0 - 14; z > zEnd + 8; z -= 30) if (!inAny(z, innerGaps, 4) && !inAny(z, crossCuts, 2)) addSolarLamp(chunks.at(z), side * (xIn - 1.2), z, side);
    // Arrêts : aire pavée sur la pelouse (à droite, l'abribus est construit avec les arrêts du boulevard)
    for (const z of stops) chunks.at(z).box(LIM_LAWN - 0.6, 0.06, side > 0 ? 42 : 26, PAVE, side * (ROAD_EDGE + 0.6 + LIM_LAWN / 2 - 0.3), 0.03, z);
    // Cour pavée : trois rangées de voitures garées en épi (entre deux allées), totem du lieu à l'entrée, côté arrivée du taxi
    for (const p of named.filter(q => q.court)) {
      const ca = zOf(p.court[0]), cc = zOf(p.court[1]);
      for (const xr of [ROAD_EDGE + 3.2, (ROAD_EDGE + xIn) / 2, xIn - 3.4]) {
        for (let zc = ca - 2.5; zc > cc + 2; zc -= 2.6) {
          if (inAny(zc, crossCuts, 1.8)) continue;
          chunks.at(zc).box(4.6, 0.02, 0.12, 0xf2f2ec, side * xr, 0.035, zc + 1.3);
          if (chance(0.7)) addParkedCar(chunks.at(zc), side * xr, zc, Math.PI / 2);
        }
      }
      const tx = side * (ROAD_EDGE + 1.6), tz = ca - 1.2, key = `court_${side}_${Math.round(ca)}`;
      chunks.at(tz).box(0.22, 4.6, 0.22, 0x8e949a, tx - 1.5, 2.3, tz).box(0.22, 4.6, 0.22, 0x8e949a, tx + 1.5, 2.3, tz);
      signs.add(key, () => signTexture(p.name, p.sub ?? '', '#0a4fa3', '#ffffff'), 3.8, 1.3, tx, 4.1, tz + 0.14, 0, true);
      for (let i = 0; i < 6; i++) addPerson(details.at(tz), side * rand(ROAD_EDGE + 2, xIn - 2), rand(cc + 4, ca - 4));
    }
    if (side < 0) for (const st of leftStops) addLeftStop(chunks.at(st.z), details, signs, st.z, st.label);

    // Rues qui partent de la chaussée et traversent la bande (droites ou en biais), avec leurs bordures
    for (const r of cross) {
      const b = chunks.at(r.z), hw = r.w / 2, xa = side * (ROAD_EDGE - 0.3), xb = side * (xIn + 0.3);
      flatPoly(b, [[xa, r.z + hw], [xb, r.z2 + hw], [xb, r.z2 - hw], [xa, r.z - hw]], 0.05, ASPHALT_COL);
      const zLine = (x, za, zb) => za + (zb - za) * (x - ROAD_EDGE) / (xIn - ROAD_EDGE);
      for (const e of [-1, 1]) {
        const za = r.z + e * (hw + 0.15), zb = r.z2 + e * (hw + 0.15);
        curbLine(curbs.at(r.z), [side * (ROAD_EDGE + 0.6), zLine(ROAD_EDGE + 0.6, za, zb)], [side * (xIn - 0.3), zLine(xIn - 0.3, za, zb)]);
      }
      if (Math.abs(r.z - r.z2) > 0.5) {                   // traversée en biais : pelouse et terre battue de part et d'autre
        const top = Math.max(r.z, r.z2) + hw + 0.1, bot = Math.min(r.z, r.z2) - hw - 0.1;
        const up = x => Math.min(top, zLine(x, r.z + hw + 0.3, r.z2 + hw + 0.3)), lo = x => Math.max(bot, zLine(x, r.z - hw - 0.3, r.z2 - hw - 0.3));
        for (const [g0, g1, y, col] of [[ROAD_EDGE + 0.6, xLawn, 0.12, GRASS], [xLawn, xIn - 0.3, 0.03, DIRT]]) {
          flatPolyClean(b, [[side * g0, top], [side * g1, top], [side * g1, up(g1)], [side * g0, up(g0)]], y, col);
          flatPolyClean(b, [[side * g0, lo(g0)], [side * g1, lo(g1)], [side * g1, bot], [side * g0, bot]], y, col);
        }
      }
      if (r.oneway) {                                     // sens unique : flèches au sol, « sens interdit » à l'entrée défendue
        const L = Math.hypot(xIn - ROAD_EDGE, r.z2 - r.z), d = [side * (xIn - ROAD_EDGE) / L, (r.z2 - r.z) / L];   // vers le petit boulevard
        const f = r.oneway === 'in' ? d : [-d[0], -d[1]], p = [-f[1], f[0]];
        for (const t of [0.3, 0.72]) for (const e of [-1, 1]) {
          addRoadArrow(b, side * (ROAD_EDGE + t * (xIn - ROAD_EDGE)) + p[0] * e * hw / 2, r.z + t * (r.z2 - r.z) + p[1] * e * hw / 2, f);
        }
        // à droite de qui voudrait rouler à contresens (vers -f), tourné vers lui : à l'embouchure ou au petit boulevard
        const t = r.oneway === 'out' ? 0.12 : 0.9, cx = side * (ROAD_EDGE + t * (xIn - ROAD_EDGE)), cz = r.z + t * (r.z2 - r.z);
        addNoEntry(b, cx + f[1] * (hw + 0.9), cz - f[0] * (hw + 0.9), f[0], f[1]);
      }
      if (r.lawnBefore) {                                 // pelouse sur toute la bande jusqu'à la rue précédente (croquis)
        const prev = cross.filter(q => q.z > r.z).sort((a, c) => a.z - c.z)[0];
        if (prev) {
          const lo = x => zLine(x, r.z + hw + 0.3, r.z2 + hw + 0.3), hi = x => zLine(x, prev.z - prev.w / 2 - 0.3, prev.z2 - prev.w / 2 - 0.3);
          flatPolyClean(b, [[side * xLawn, lo(xLawn)], [side * (xIn - 0.3), lo(xIn - 0.3)], [side * (xIn - 0.3), hi(xIn - 0.3)], [side * xLawn, hi(xLawn)]], 0.12, GRASS);
        }
      }
    }
    // Rues au-delà du petit boulevard : embouchure, chaussée, bordures ; rond-point Zinnias ; portail au bout des accès
    const edgeSigns = [];
    for (const m of mouths) {
      const { r, w, u, n, S, c1, c2, e1, e2 } = m, b = chunks.at(m.zm), service = r.from === 'service';
      flatPolyClean(b, [e1, c1, c2, e2], 0.045, ASPHALT_COL);
      const La = r.roundabout ? r.len - 9.5 : r.len, ry = Math.atan2(u[0], u[1]);
      bezierRoad(b, [S, [S[0] + u[0] * La, S[1] + u[1] * La]], w, Math.max(2, Math.round(La / 6)), { dash: !service && !r.roundabout, rail: false });
      if (service) b.box(w, 2.2, 0.12, pick(GATES), S[0] + u[0] * La, 1.1, S[1] + u[1] * La, 0, ry, 0);
      if (r.roundabout) {
        const R0 = 9.5, C = [S[0] + u[0] * r.len, S[1] + u[1] * r.len];
        b.cyl(R0, R0, 0.05, ASPHALT_COL, C[0], 0.04, C[1], 0, 0, 0, 28)
          .cyl(4.6, 4.6, 0.22, CURB_LIGHT, C[0], 0.11, C[1], 0, 0, 0, 20)
          .cyl(4.3, 4.3, 0.26, GRASS, C[0], 0.13, C[1], 0, 0, 0, 20);
        const Lm = La - 6, M = [S[0] + u[0] * (3 + Lm / 2), S[1] + u[1] * (3 + Lm / 2)];
        b.box(1.4, 0.24, Lm, GRASS, M[0], 0.12, M[1], 0, ry, 0);              // les deux voies à sens unique, séparées
        for (const [dir, len] of [[u, 34], [n, 40], [[-n[0], -n[1]], 40]]) {
          bezierRoad(b, [[C[0] + dir[0] * (R0 - 0.5), C[1] + dir[1] * (R0 - 0.5)], [C[0] + dir[0] * (R0 + len), C[1] + dir[1] * (R0 + len)]], 8, 6, { rail: false });
        }
      }
      if (!r.name) continue;
      // Plaque au coin de la rue (derrière le petit boulevard) et panneau au bord du boulevard, lisible depuis le taxi
      const key = `lim_${r.n}_${side}`, sub = r.sub ?? (side > 0 ? 'Limete Industriel' : 'Limete Résidentiel');
      const make = () => signTexture(r.name, sub, '#1d4fa0');
      const px = side * (xOut + 1.3), pz = m.zTop + 1.2;
      chunks.at(pz).box(0.1, 3.2, 0.1, 0x8e949a, px, 1.6, pz);
      signs.add(key, make, 3.4, 0.7, px, 2.9, pz + 0.06, 0, true);
      for (let i = 0; i < 2; i++) addPerson(details.at(pz), side * (xOut + rand(1.2, 3)), pz + rand(0.5, 3));
      const zr = r.from === 'road' ? r.z : m.zm, half = w / 2;
      for (const zs of [zr + half + 2.2, zr - half - 2.2]) {
        if (busy(zs, stops)) continue;
        const sx = side * (ROAD_EDGE + 2.2);
        chunks.at(zs).box(0.14, 3.8, 0.14, 0x8e949a, sx - 1.2, 1.9, zs).box(0.14, 3.8, 0.14, 0x8e949a, sx + 1.2, 1.9, zs);
        signs.add(key, make, 4.4, 1.25, sx, 3.4, zs + 0.08, 0, true);
        edgeSigns.push(zs);
        break;
      }
    }

    // Vie de la bande, d'après les vidéos : arbustes au bord du boulevard, grands arbres et quelques palmiers sur la
    // pelouse ; rangée de hauts lampadaires ; kiosques, voitures garées et étals sur la terre battue
    const avoid = (z, m) => inAny(z, crossCuts, m) || inAny(z, lawnCuts, m) || inAny(z, riverCuts, m + 2) || inAny(z, courts, m)
      || FOOTBRIDGES.some(q => z < q + 15 + m && z > q - 4 - m);
    const inPark = (z, m = 0) => parks.some(pk => pk.side === side && z <= pk.za + m && z >= pk.zb - m);
    const inLights = z => parks.some(pk => pk.side === side && pk.kind === 'lights' && z <= pk.za && z >= pk.zb);
    sideOf[side] = (z, m) => avoid(z, m) || inPark(z, m);
    for (let z = z0 - 4; z > zEnd + 4; z -= rand(6, 8.5)) {
      if (avoid(z, 1) || edgeSigns.some(q => Math.abs(z - q) < 3.5)) continue;
      const r = rand(0.5, 0.75), x = side * (ROAD_EDGE + 2.6);          // arbuste taillé en boule (deux touffes)
      chunks.at(z).ball(r, pick(SHRUB), x, r * 0.8, z, 1.15, 0.9, 1.15).ball(r * 0.75, pick(SHRUB), x + side * 0.35, r * 0.95, z + r * 0.7, 1, 0.9, 1);
    }
    for (let z = z0 - 10; z > zEnd + 10; z -= rand(24, 44)) {
      if (avoid(z, 6) || inPark(z, 4)) continue;
      const x = side * (ROAD_EDGE + rand(6.5, 10));
      if (chance(0.8)) addMango(chunks.at(z), x, z, rand(1.05, 1.5)); else addPalm(chunks.at(z), x, z, rand(0.6, 0.8));
    }
    for (let z = z0 - 18; z > zEnd + 8; z -= 40) {
      if (avoid(z, 2)) continue;
      const x = side * (xLawn + 0.6);
      chunks.at(z).cyl(0.12, 0.18, 11, 0x8e949a, x, 5.5, z).box(2.2, 0.12, 0.12, 0x8e949a, x - side * 1.1, 10.9, z)
        .box(0.7, 0.18, 0.35, 0xdddddd, x - side * 2.1, 10.8, z);
      if (inLights(z)) addSnowflake(glow, x - side * 0.25, 7.4, z);                 // (décorations : flocons sur les lampadaires)
    }
    for (let z = z0 - 20; z > zEnd + 10; z -= rand(55, 95)) {
      if (avoid(z, 3) || inPark(z, 3)) continue;
      const x = side * rand(xLawn + 3, xIn - 6), c = pick([0x1d4fa0, 0xf5c400, 0xd62828, 0xe8e2d0, 0x2b8a3e]);
      chunks.at(z).box(2.4, 2.4, 2.6, c, x, 1.2, z).box(2.9, 0.12, 3.1, pick(TIN), x, 2.5, z);
      addPerson(details.at(z), x - side * 1.8, z + rand(-1, 1));
    }
    for (let z = z0 - 30; z > zEnd + 20; z -= rand(70, 130)) {
      const n = 3 + Math.floor(Math.random() * 6), ry = chance(0.5) ? Math.PI / 2 : 0, step = ry ? 2.6 : 5.4;
      for (let i = 0; i < n; i++) {
        const zc = z - i * step;
        if (!avoid(zc, 3) && !inPark(zc, 3)) addParkedCar(chunks.at(zc), side * (xIn - (ry ? 3.4 : 2.6)), zc, ry);
      }
    }
    for (const zc of [...FOOTBRIDGES.filter(q => q < Z16 && q > Z_FORK), zOf(15737)]) {   // étals : passerelles, carrefour Avenue Yolo
      for (let i = 0; i < 8; i++) {
        const z = zc + rand(-30, 30);
        if (inAny(z, crossCuts, 2) || inPark(z, 2)) continue;
        const x = side * rand(xLawn + 1.5, xIn - 4), d = details.at(z);
        d.cyl(0.04, 0.04, 2.1, 0x666666, x, 1.05, z).add(new THREE.ConeGeometry(1.5, 0.6, 8), pick(UMBRELLAS), x, 2.25, z)
          .box(1.2, 0.7, 0.9, 0x8b6b45, x, 0.35, z);
        for (let j = 0; j < 4; j++) d.ball(0.13, pick(GOODS), x + rand(-0.4, 0.4), 0.8, z + rand(-0.3, 0.3));
        addPerson(d, x + side * 0.8, z + 0.5, { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        if (chance(0.6)) addPerson(d, x - side * rand(1, 2.5), z + rand(-1.5, 1.5));
      }
    }


    // Parcs de la bande (l'auteur, 31/10) : décorations lumineuses le long d'une allée ; aire de jeux clôturée
    for (const pk of parks.filter(q => q.side === side)) {
      const X = v => side * v, b = chunks.at((pk.za + pk.zb) / 2), d = details.at((pk.za + pk.zb) / 2);
      if (pk.kind === 'lights') {
        // l'allée commence où la bande a toute sa largeur (le petit boulevard de l'Échangeur s'écarte avant)
        const zw = side > 0 ? zT - 1 : pk.za, wx = xLawn + 4.3, stop = stops.find(q => q < pk.za && q > pk.zb);
        for (const [p, q] of pieces(zw, pk.zb, 24)) chunks.at((p + q) / 2).box(3, 0.03, p - q, 0xd2cbbd, X(wx), 0.135, (p + q) / 2);
        if (stop !== undefined) chunks.at(stop).box(wx - xLawn - 1.5, 0.03, 2.4, 0xd2cbbd, X((xLawn + wx - 1.5) / 2), 0.135, stop);
        const at = f => pk.za - f * (pk.za - pk.zb);
        const nearStop = (z, v) => stop !== undefined && v < xLawn + 0.5 && Math.abs(z - stop) < 24;
        const fits = (z, v) => !nearStop(z, v) && (side < 0 || z <= zT || v < ROAD_EDGE + 10);   // (avant zT : pelouse étroite)
        // grandes décorations d'abord (vidéo) : sapins de lumière de toutes les couleurs, vasque bleue tressée, cube-cadeau
        // doré à ruban rouge, dômes roses ; les palmiers et les promeneurs se placent autour (occ : [x, z, rayon])
        const occ = [];
        const free = (z, v, r) => fits(z, v) && occ.every(([ov, oz, or]) => Math.hypot(v - ov, z - oz) > or + r);
        for (const [f, v, h, col, ring] of [[0.11, ROAD_EDGE + 8.6, 4.5, 0x4fe3ff, 0xff3b3b], [0.37, xIn - 6, 6.5, 0x3b6bff, 0xffffff],
          [0.65, ROAD_EDGE + 9.3, 3, 0xffffff, 0xffd27a], [0.67, xIn - 5.5, 4.2, 0x39ff6a, 0xffffff],
          [0.88, ROAD_EDGE + 9.3, 3.2, 0xff3b3b, 0xffffff], [0.97, xIn - 5.5, 7, 0x4fe3ff, 0xff4fd8]]) {
          if (!free(at(f), v, h * 0.3)) continue;
          addLightCone(glow, X(v), at(f), h, col, ring);
          occ.push([v, at(f), h * 0.3]);
        }
        const zb1 = at(0.46), vb = xIn - 5.6;
        glow.add(new THREE.LatheGeometry([[0.6, 0], [2.4, 0.5], [3.3, 1.5], [3.6, 2.7]].map(([r, y]) => new THREE.Vector2(r, y)), 18),
          0x2a7fff, X(vb), 0.12, zb1);
        for (const y of [0.9, 1.8]) glow.add(new THREE.TorusGeometry(2.85 + y * 0.28, 0.05, 4, 24), 0x8fd0ff, X(vb), 0.12 + y, zb1, Math.PI / 2, 0, 0);
        occ.push([vb, zb1, 3.6]);
        const zg = at(0.54), s = 2.2, vg = xIn - 5, gx = X(vg);
        glow.box(s, s, s, 0xffd23f, gx, s / 2 + 0.12, zg).box(s + 0.05, s + 0.05, 0.32, 0xff3b3b, gx, s / 2 + 0.12, zg)
          .box(0.32, s + 0.05, s + 0.05, 0xff3b3b, gx, s / 2 + 0.12, zg);
        for (const ry of [0.6, -0.6]) glow.add(new THREE.TorusGeometry(0.35, 0.08, 4, 10), 0xff3b3b, gx, s + 0.45, zg, 0, ry, 0);
        occ.push([vg, zg, 1.6]);
        for (const [f, v, r] of [[0.76, ROAD_EDGE + 9.3, 2], [0.78, xIn - 4.7, 1.7]]) {
          glow.add(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xff4fd8, X(v), 0.12, at(f));
          occ.push([v, at(f), r]);
        }
        // palmiers lumineux : une rangée côté boulevard, une rangée côté petit boulevard
        for (let f = 0.03; f < 1; f += 0.092) {
          const z1 = at(f), z2 = at(Math.min(0.99, f + 0.046));
          if (free(z1, ROAD_EDGE + 6, 0.8)) addLightPalm(chunks.at(z1), glow, X(ROAD_EDGE + 6), z1);
          if (free(z2, xIn - 3.5, 0.8)) addLightPalm(chunks.at(z2), glow, X(xIn - 3.5), z2);
        }
        // sur l'allée : long tunnel de lumières blanches, puis galerie d'arches vertes
        addLightTunnel(glow, X(wx), at(0.58), at(0.72));
        for (let k = 0; k < 5; k++) addLightArch(glow, X(wx), at(0.8 + k * 0.035), 2.6, 0.3, 0x39ff6a);
        // bancs et promeneurs
        for (const [f, v] of [[0.52, wx + 2.6], [0.84, wx - 2.4], [0.95, wx + 2.6]]) addParkBench(chunks.at(at(f)), X(v), at(f));
        for (let i = 0; i < 14; i++) {
          const z = rand(Math.min(zw, pk.za), pk.zb), v = chance(0.6) ? wx + rand(-1, 1) : rand(xLawn + 1, xIn - 2);
          if (free(z, v, 0.5)) addPerson(details.at(z), X(v), z);
        }
      } else if (pk.kind === 'playground') {
        // aire clôturée (barrière verte à lisses jaunes), deux entrées face à face au milieu, panneau côté boulevard
        const xa = ROAD_EDGE + 4.4, xb = xIn - 1.6, zm = (pk.za + pk.zb) / 2, gate = [[zm + 1.6, zm - 1.6]];
        const POST = 0x2b8a3e, RAIL = 0xf5c400;
        for (const v of [xa, xb]) for (const [p, q] of minus([[pk.za, pk.zb]], gate)) {
          chunks.at((p + q) / 2).box(0.06, 0.06, p - q, RAIL, X(v), 0.95, (p + q) / 2).box(0.06, 0.06, p - q, RAIL, X(v), 0.45, (p + q) / 2);
          for (let z = p; z >= q; z -= 2) chunks.at(z).box(0.09, 1.05, 0.09, POST, X(v), 0.52, z);
        }
        for (const z of [pk.za, pk.zb]) {
          b.box(xb - xa, 0.06, 0.06, RAIL, X((xa + xb) / 2), 0.95, z).box(xb - xa, 0.06, 0.06, RAIL, X((xa + xb) / 2), 0.45, z);
          for (let v = xa; v <= xb; v += 2) b.box(0.09, 1.05, 0.09, POST, X(v), 0.52, z);
        }
        b.box(0.12, 2.6, 0.12, 0x8e949a, X(xa - 0.3), 1.3, zm + 2.1).box(0.12, 2.6, 0.12, 0x8e949a, X(xa - 0.3), 1.3, zm - 2.1);
        signs.add(`playground_${side}`, () => signTexture('AIRE DE JEUX', 'Pour les enfants · Limete', '#2b8a3e', '#ffffff'),
          4, 1.1, X(xa - 0.4), 2.3, zm, -side * Math.PI / 2, true);
        // tapis de sol colorés sous les jeux, puis les jeux, du côté de la 14e Rue vers la passerelle
        const xc = (xa + xb) / 2, L = pk.za - pk.zb, at = f => pk.za - f * L;
        const mat = (v, z, w, dz, col) => chunks.at(z).box(w, 0.03, dz, col, X(v), 0.135, z);
        mat(xc, at(0.11), 4.4, 8, 0x2e86de); addSwings(chunks.at(at(0.11)), X(xc), at(0.11));
        mat(xc, at(0.27), 5, 7, 0xc0392b); addSlideTower(chunks.at(at(0.27)), X(xc), at(0.27));
        mat(xc, at(0.4), 4.6, 4.6, 0xf1c40f); addMerryGoRound(chunks.at(at(0.4)), X(xc), at(0.4));
        for (const dv of [-4.5, 4.5]) { mat(xc + dv, at(0.5), 2.4, 5, 0x27ae60); addSeeSaw(chunks.at(at(0.5)), X(xc + dv), at(0.5)); }
        mat(xc, at(0.61), 14, 3.2, 0xe67e22);
        for (const [dv, col] of [[-5.5, 0xd62828], [0, 0xf5c400], [5.5, 0x2e86de]]) addSpringRider(chunks.at(at(0.61)), X(xc + dv), at(0.61), col);
        mat(xc, at(0.74), 5.4, 5.4, 0x8e44ad); addClimbDome(chunks.at(at(0.74)), X(xc), at(0.74));
        addSandbox(chunks.at(at(0.88)), X(xc), at(0.88));
        // bancs le long des barrières, parasols, enfants et parents
        for (const f of [0.18, 0.45, 0.66, 0.9]) addParkBench(chunks.at(at(f)), X(xa + 1.4), at(f));
        for (const f of [0.33, 0.8]) addParkBench(chunks.at(at(f)), X(xb - 1.4), at(f));
        for (const f of [0.18, 0.66]) {
          d.cyl(0.04, 0.04, 2.3, 0x666666, X(xa + 2.2), 1.15, at(f)).add(new THREE.ConeGeometry(1.5, 0.55, 8), pick(UMBRELLAS), X(xa + 2.2), 2.35, at(f));
          addPerson(details.at(at(f)), X(xa + 1.4), at(f) + 0.3, { sitting: true, ry: -side * Math.PI / 2 });
        }
        for (const f of [0.08, 0.2, 0.3, 0.36, 0.43, 0.52, 0.58, 0.64, 0.7, 0.79, 0.86, 0.93]) {
          addKid(details.at(at(f)), X(xc + rand(-6, 6)), at(f) + rand(-1.5, 1.5));
        }
        for (const f of [0.25, 0.55, 0.84]) addPerson(details.at(at(f)), X(rand(xa + 2, xb - 2)), at(f));
      }
    }

    // Rues au-delà du petit boulevard, en segments (pour placer le marché d'objets traditionnels et les bâtiments OSM)
    const mouthSegs = mouths.map(m => {
      const La = m.r.roundabout ? m.r.len - 9.5 : m.r.len;
      return { a: m.S, b: [m.S[0] + m.u[0] * La, m.S[1] + m.u[1] * La], hw: m.w / 2 + 0.6 };
    });
    // Bâtiments nommés (OSM et croquis) : station Total, hôtels, banque, Marché Yolo, marché d'objets traditionnels, école
    for (const p of named) {
      const b = chunks.at(p.z);
      if (p.kind === 'fuel') addSideFuel(b, signs, side, p.z, `fuel_lim_${p.s}`, p.name, xOut + 0.3 - ROAD_EDGE - 5);
      else if (p.kind === 'hotel' || p.kind === 'bank' || p.kind === 'supermarket') addNamedBlock(b, signs, side, p.z, p.w ?? 10, p, F, p.floors ?? 4);
      else if (p.kind === 'residence') addResidence(b, side, p.z, p, F);
      else if (p.kind === 'market') addMarketBlock(b, details, signs, side, p.z, 22, p, F);
      else if (p.kind === 'crafts') addCraftMarket(b, details, side, p.z, p.w ?? 20, F, mouthSegs);
      else if (p.kind === 'hospital') addBigHospital(b, details, signs, side, p.z, p.w ?? 50, p, F);
      else if (p.kind === 'church' && p.look === 'steps') addStepChurch(b, details, signs, side, p.z, p, F);
      else if (p.kind === 'church') addNamedChurch(shiftX(b, side * DX), shiftSigns(signs, side * DX), side, p.z, p);
      else if (p.kind === 'school') addNamedSchool(shiftX(b, side * DX), shiftSigns(signs, side * DX), side, p.z, { ...p, noTotem: true });
    }

    // Bâtiments réels (OSM) derrière le petit boulevard, en évitant les rues et les bâtiments du croquis ; un lieu du
    // croquis qui remplace un bâtiment OSM (replaces : son nom) le retire
    const W = { fuel: 32, hotel: 12, bank: 10, supermarket: 18, residence: 30, market: 22, crafts: 20, school: 26, hospital: 50, church: 24 };
    const len = p => p.plot ?? p.w ?? W[p.kind];                            // longueur occupée (clôture comprise)
    if (LIM_OSM) {
      const streets = [...mouthSegs];
      for (const m of mouths.filter(m => m.r.roundabout)) {
        const C = [m.S[0] + m.u[0] * m.r.len, m.S[1] + m.u[1] * m.r.len];
        streets.push({ c: C, r: 10.5 });
        for (const [dir, len] of [[m.u, 34], [m.n, 40], [[-m.n[0], -m.n[1]], 40]]) streets.push({ a: C, b: [C[0] + dir[0] * (9.5 + len), C[1] + dir[1] * (9.5 + len)], hw: 4.6 });
      }
      if (side > 0) streets.push({ a: [ROAD_EDGE, Z16], b: [ROAD_EDGE + 88, Z16], hw: 6.1 });     // 16e Rue
      if (side > 0) for (const l of PL_LINK_DATA?.links ?? []) l.r1.slice(1).forEach((q, i) => streets.push({ a: l.r1[i], b: q, hw: l.w / 2 + 2 }));   // liaisons vers la Route Poids Lourds
      const gaps = [...outerGaps];
      if (side < 0) {                                       // bretelle de l'Échangeur vers l'Av. Sefu
        const [p1, p2, p3] = PBL_PTS.slice(1), L = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
        const e = [p3[0] + (p3[0] - p2[0]) / L * 42, p3[1] + (p3[1] - p2[1]) / L * 42];
        streets.push({ a: p1, b: p2, hw: 4.6 }, { a: p2, b: p3, hw: 4.6 }, { a: p3, b: e, hw: 4.6 });
        gaps.push([zJ + 10, PBL_PTS[3][1] - 46]);
      }
      const blocks = [...named.map(p => [p.z + len(p) / 2 + 1, p.z - len(p) / 2 - 1, F + 34]),
        ...rivers.map(r => [r.z + r.w / 2 + 4, r.z - r.w / 2 - 4, Infinity])];       // pas de bâtiment dans la rivière
      addOsmSide(chunks, details, signs, side, LIM_OSM.buildings.filter(bd => bd[1] === side && !named.some(p => p.replaces === bd[7])), F, streets, blocks,
        [side > 0 ? Z16 - 12 : z0 - 8, zEnd + 6], gaps);
    } else {
      const blocks = [...mouths.map(m => m.foot), ...named.map(p => [p.z + len(p) / 2 + 1, p.z - len(p) / 2 - 1]),
        ...rivers.map(r => [r.z + r.w / 2 + 4, r.z - r.w / 2 - 4])];
      if (side < 0) blocks.push([zJ + 10, PBL_PTS[3][1] - 46]);   // bretelle vers l'Av. Sefu
      const blocked = (zc, w) => blocks.some(([a, c]) => zc - w / 2 < a && zc + w / 2 > c);
      let z = (side > 0 ? Z16 - 12 : z0 - 8);
      while (z > zEnd + 12) {
        const w = rand(8, 16), cz = z - w / 2;
        if (blocked(cz, w)) { z -= 2; continue; }
        const b = chunks.at(cz), pb = shiftX(b, side * DX), ps = shiftSigns(signs, side * DX), kind = Math.random();
        const shopping = side < 0 && cz < zOf(15600) && cz > zOf(16100);   // commerces autour de l'Avenue Yolo
        let back = true;
        if (side > 0) {
          if (kind < 0.55) { addDepot(b, side, cz, w, F); back = false; }
          else if (kind < 0.72) addParcel(pb, side, cz, w);
          else if (kind < 0.9) addShop(pb, ps, side, cz, w);
          else addTall(pb, ps, side, cz, w);
        } else if (shopping) {
          if (kind < 0.5) addShop(pb, ps, side, cz, w);
          else if (kind < 0.85) addTall(pb, ps, side, cz, w, 3 + Math.floor(Math.random() * 2));
          else addVilla(b, side, cz, w, F);
        } else if (kind < 0.62) addVilla(b, side, cz, w, F);
        else if (kind < 0.78) addShop(pb, ps, side, cz, w);
        else if (kind < 0.9) addTall(pb, ps, side, cz, w);
        else addLot(pb, side, cz, w);
        if (back && chance(0.6)) {                          // deuxième rangée en arrière-plan
          const d = rand(7, 12), h = rand(2.8, 6), x = side * (F + 15 + d / 2 + rand(0, 8));
          b.box(d, h, w * rand(0.7, 1), pick(WALLS), x, h / 2, cz).box(d + 0.6, 0.12, w, pick(TIN), x, h + 0.25, cz, 0, 0, side * 0.1);
        }
        z -= w + rand(0.4, 2);
      }
    }
  }

  // Grands panneaux publicitaires sur deux pieds, dans la bande (vidéos), en alternant les côtés
  let bi = 0;
  for (let z = Z16 - 70; false && z > zEnd + 30; z -= rand(170, 250), bi++) {   // (retirés, 26/11)
    const side = bi % 2 ? -1 : 1;
    if (sideOf[side](z, 6)) continue;
    const x = side * (xLawn + 4), [t, sub, bg, fg] = BILLBOARDS[bi % BILLBOARDS.length], b = chunks.at(z);
    b.box(0.35, 9.4, 0.35, 0x6c7680, x - 3.4, 4.7, z).box(0.35, 9.4, 0.35, 0x6c7680, x + 3.4, 4.7, z)
      .box(8.9, 2.9, 0.25, 0x2a2e33, x, 8.4, z - 0.2);
    signs.add(`bb${bi % BILLBOARDS.length}`, () => signTexture(t, sub, bg, fg), 8.6, 2.7, x, 8.4, z - 0.05, 0);
  }

  if (glow.parts.length) {
    const m = new THREE.Mesh(bendGeometry(glow.geometry()), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.castShadow = true;
    scene.add(m);
  }

  // Passages piétons au sol (16e Rue, devant la 12e Rue, 1re Rue)
  for (const s of LIM.zebras ?? []) {
    const z = zOf(s), d = details.at(z);
    for (let x = -ROAD_EDGE + 0.6; x < ROAD_EDGE - 0.3; x += 1.2) if (Math.abs(x) > MEDIAN) d.box(0.6, 0.02, 3, 0xf2f2ee, x, 0.035, z);
  }
}

/**
 * Fond de décor photographique : les bandes de façades tirées des vidéos (tools/strips.py), posées à
 * l'alignement des façades. plan : { right, left, highwayRight, highwayLeft } (noms de bandes).
 * blockedAt(side, z) : vrai là où un ouvrage (station, marché, rivière…) occupe déjà la façade.
 * Renvoie les maillages, affichés ou non selon la distance.
 */
// ---------- Masina : construction de la boucle (routes.js `masina`) ----------
const LATERITE = 0xb5734a, SHOULDER = 0xc0956a, MAS_ASPH = 0x5c5e63;

/** Builder dans le repère d'une rue : x local de l'axe de la rue vers les maisons, z local le long de la rue (rotation th). */
function frame(b, ox, oz, th) {
  const c = Math.cos(th), s = Math.sin(th), X = (x, z) => ox + x * c + z * s, Z = (x, z) => oz - x * s + z * c;
  const p = {
    X, Z,                                              // (local → coordonnées route, pour les personnages, drapeaux…)
    box(w, h, d, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { b.box(w, h, d, col, X(x, z), y, Z(x, z), rx, ry + th, rz); return p; },
    cyl(rt, rb, h, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10) { b.cyl(rt, rb, h, col, X(x, z), y, Z(x, z), rx, ry + th, rz, seg); return p; },
    ball(r, col, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) { b.add(new THREE.IcosahedronGeometry(r, r > 1.2 ? 1 : 0).scale(sx, sy, sz), col, X(x, z), y, Z(x, z), 0, th, 0); return p; },
    add(geo, col, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { b.add(geo, col, X(x, z), y, Z(x, z), rx, ry + th, rz); return p; },
  };
  return p;
}
const frameSigns = (signs, ox, oz, th) => {
  const c = Math.cos(th), s = Math.sin(th);
  return { add: (key, make, w, h, x, y, z, ry = 0, basic) => signs.add(key, make, w, h, ox + x * c + z * s, y, oz - x * s + z * c, ry + th, basic) };
};

/** Occupation du sol de Masina (cases de 1 m, x ≥ 0) : routes, rivières, enclos, maisons déjà posées. */
class MasGrid {
  constructor(x1, zTop, zBot) { this.zTop = Math.ceil(zTop); this.W = Math.ceil(x1); this.H = Math.ceil(zTop - zBot) + 1; this.c = new Uint8Array(this.W * this.H); }
  k(x, z) { const i = Math.floor(x), j = Math.floor(this.zTop - z); return i < 0 || j < 0 || i >= this.W || j >= this.H ? -1 : j * this.W + i; }
  set(x, z) { const k = this.k(x, z); if (k >= 0) this.c[k] = 1; }
  free(x, z) { const k = this.k(x, z); return k >= 0 && !this.c[k]; }
  /** Rectangle [x0, x1] × [-hz, hz] du repère (ox, oz, th) : libre ? (ou l'occuper, mark) */
  rect(ox, oz, th, x0, x1, hz, mark = false) {
    const c = Math.cos(th), s = Math.sin(th);
    for (let lx = x0; lx <= x1 + 0.01; lx += 0.7) for (let lz = -hz; lz <= hz + 0.01; lz += 0.7) {
      const x = ox + lx * c + lz * s, z = oz - lx * s + lz * c;
      if (mark) this.set(x, z); else if (!this.free(x, z)) return false;
    }
    return true;
  }
  box(xa, xb, za, zb) { for (let x = xa; x < xb; x++) for (let z = za; z > zb; z--) this.set(x + 0.5, z - 0.5); }   // za > zb
  seg(a, b, r) {
    for (let x = Math.floor(Math.min(a[0], b[0]) - r); x <= Math.max(a[0], b[0]) + r; x++) {
      for (let z = Math.ceil(Math.max(a[1], b[1]) + r); z >= Math.min(a[1], b[1]) - r; z--) if (segDist(x + 0.5, z - 0.5, a, b) < r) this.set(x + 0.5, z - 0.5);
    }
  }
}

// ---------- Kingasani : l'Entrée Moboma (décor) ----------
/** Occupation du sol de Moboma (côté gauche, x < 0) : la grille de Masina, décalée en x. */
class MobGrid extends MasGrid {
  constructor(x0, zTop, zBot) { super(-x0, zTop, zBot); this.x0 = x0; }
  k(x, z) { return super.k(x - this.x0, z); }
}
/** Point (x, z) et direction unitaire à t m du début de la route r ; arc(r, p) : distance le long de r jusqu'au point de r le plus proche de p. */
function roadAlong(r, t) {
  let acc = 0;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], c = r.pts[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (acc + L >= t || i === r.pts.length - 1) { const u = Math.max(0, Math.min(1, (t - acc) / L)); return { x: a[0] + (c[0] - a[0]) * u, z: a[1] + (c[1] - a[1]) * u, ux: (c[0] - a[0]) / L, uz: (c[1] - a[1]) / L }; }
    acc += L;
  }
}
function roadArc(r, p) {
  let acc = 0, best = Infinity, at = 0;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], c = r.pts[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (c[0] - a[0]) + (p[1] - a[1]) * (c[1] - a[1])) / (L * L))), d = Math.hypot(p[0] - a[0] - (c[0] - a[0]) * t, p[1] - a[1] - (c[1] - a[1]) * t);
    if (d < best) { best = d; at = acc + L * t; }
    acc += L;
  }
  return at;
}
const roadLen = r => r.pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - r.pts[i][0], q[1] - r.pts[i][1]), 0);
/** Repère d'une construction au bord de la route r, à t m de son début, du côté e (1 : à gauche de la marche, -1 : à droite) :
 *  x local vers la parcelle (façade à f de l'axe), z local le long de la route. */
const roadSide = (r, t, e) => { const P = roadAlong(r, t); return { ...P, th: Math.atan2(P.ux, P.uz) + (e > 0 ? 0 : Math.PI) }; };
/** Point du croquis de l'auteur (X à droite, Y le long de Moboma) → coordonnées route du jeu (repère de data/moboma_osm.json). */
const mobSketch = (X, Y) => {
  const F = MOB_OSM.frame, [ux, uo] = F.u;
  return mp([F.a[0] + Y * ux - X * uo, F.a[1] + Y * uo + X * ux]);
};
/** Chaussée d'une rue de Moboma (comme addMasinaRoad) : goudron, caniveaux ouverts en béton et accotements (MACADAM), ou terre (AVENUE).
 *  Les caniveaux s'arrêtent aux carrefours (ils ne barrent pas l'autre rue), devant le boulevard et dans l'embouchure ; une entrée
 *  commence au bout de son embouchure (mobMouth). */
function addMobomaRoad(mc, r) {
  const paved = r.paved, y = paved ? 0.03 : 0.016, h = paved ? 0.035 : 0.03, col = paved ? MAS_ASPH : (r.col ?? LATERITE);
  const M = r.entry ? mobMouth(r.entry) : null;
  let pts = r.pts;
  if (M) {
    const P = roadAlong(r, M.t);
    let acc = 0, i = 1;
    for (; i < r.pts.length; i++) { const L = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); if (acc + L > M.t) break; acc += L; }
    pts = [[P.x, P.z], ...r.pts.slice(i)];
  }
  const others = MOB_ROADS.filter(q => q !== r);
  const free = (x, z) => x < -(ROAD_EDGE + 2.2) && !others.some(q => q.pts.slice(1).some((p, i) => segDist(x, z, q.pts[i], p) < q.w / 2 + 0.75));
  const run = (a, ux, uz, ry, nx, nz, t1, t2, e) => {
    const segL = t2 - t1, tc = (t1 + t2) / 2, xc = a[0] + ux * tc, zc = a[1] + uz * tc, B = mc.at(zc, xc);
    const offsh = e * (r.w / 2 + 1.05), offG = e * (r.w / 2 + 0.45), offW1 = e * (r.w / 2 + 0.16), offW2 = e * (r.w / 2 + 0.74);
    B.box(1.9, 0.02, segL, SHOULDER, xc + nx * offsh, 0.012, zc + nz * offsh, 0, ry, 0)
      .box(0.46, 0.025, segL, 0x2b2d30, xc + nx * offG, 0.022, zc + nz * offG, 0, ry, 0)
      .box(0.14, 0.14, segL, 0x9e9a90, xc + nx * offW1, 0.07, zc + nz * offW1, 0, ry, 0)
      .box(0.14, 0.15, segL, 0xb2ada2, xc + nx * offW2, 0.075, zc + nz * offW2, 0, ry, 0);
    for (let d = 3.5; d < segL - 2; d += 11) B.box(0.76, 0.07, 1.55, 0xc4bfb4, a[0] + ux * (t1 + d) + nx * offG, 0.125, a[1] + uz * (t1 + d) + nz * offG, 0, ry, 0);
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i], ry = Math.atan2(c[0] - a[0], c[1] - a[1]), L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 0.05) continue;
    const n = Math.max(1, Math.ceil(L / 40)), len = L / n, nx = Math.cos(ry), nz = -Math.sin(ry), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
    for (let k = 0; k < n; k++) {
      const x = a[0] + ux * len * (k + 0.5), z = a[1] + uz * len * (k + 0.5);
      mc.at(z, x).box(r.w, h, len + 0.02, col, x, y, z, 0, ry, 0);
    }
    if (!paved) continue;
    const m = Math.max(1, Math.ceil(L / 2)), pl = L / m;
    for (const e of [-1, 1]) {
      const og = e * (r.w / 2 + 0.45), osh = e * (r.w / 2 + 2.0);
      let t1 = null;
      for (let j = 0; j <= m; j++) {
        const ok = j < m && [j * pl, (j + 1) * pl].every(t => free(a[0] + ux * t + nx * og, a[1] + uz * t + nz * og) && free(a[0] + ux * t + nx * osh, a[1] + uz * t + nz * osh));
        if (ok && t1 === null) t1 = j * pl;
        if (t1 !== null && (!ok || j * pl - t1 >= 40)) { run(a, ux, uz, ry, nx, nz, t1, j * pl, e); t1 = ok ? j * pl : null; }
      }
    }
  }
  for (const [x, z] of pts.slice(1, -1)) mc.at(z, x).cyl(r.w / 2, r.w / 2, h, col, x, y, z, 0, 0, 0, 18);   // coins arrondis
}

// ---------- Kingasani, l'Entrée Moboma : les repères, le cœur des îlots, les poteaux et les plaques ----------
// (l'auteur, 14/11 : « tu traduis ces images en 3D ») Places d'après son croquis Kingasani/carte_corrigee.png, qui l'emporte sur OSM : l'Aéro Club
// au coin du boulevard, Passio et l'ITP Passio en bas, l'Église Saint-Marc au coin de la Rue Kimpioka, puis, de ce côté de Kimpioka, le centre
// pastoral, les hôpitaux, le lycée et l'EP 12 ; en face, le home des vieillards ; le dispensaire sur la Rue Ma Sœur ; le marché en haut de Moboma.
// Aspect d'après les vidéos « Entreé Moboma » et « Direction mobutu vers moboma direction hopital » et les photos du dossier Lycée.
// Chaque repère est posé dans le repère de sa rue (roadSide : x local depuis l'axe vers la parcelle, z local le long de la rue).

/** Inscription peinte, lignes [texte, poids] de haut en bas (murs et enseignes de Moboma). */
function mobText(lines, bg, fg, w = 1024, h = 256, font = '"Arial Black", Impact, sans-serif') {
  return canvasTexture(w, h, (x, W, H) => {
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    const L = lines.map(l => (Array.isArray(l) ? l : [l, 1])), tot = L.reduce((s, l) => s + l[1], 0);
    let y = 0;
    for (const [t, k] of L) {
      const lh = H * k / tot;
      x.font = `bold ${Math.round(lh * 0.68)}px ${font}`;
      x.fillText(t, W / 2, y + lh / 2 + 2, W - 28);
      y += lh;
    }
  });
}
/** Emblème des Passionistes peint sur leur mur : cœur surmonté d'une croix, « JESU XPI PASSIO ». */
function passioEmblem() {
  return canvasTexture(256, 256, (x, W, H) => {
    x.fillStyle = '#e9eef5'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1b2438'; x.beginPath(); x.arc(W / 2, H / 2, 118, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(128, 222);
    x.bezierCurveTo(28, 150, 50, 74, 104, 90); x.bezierCurveTo(118, 94, 126, 104, 128, 114);
    x.bezierCurveTo(130, 104, 138, 94, 152, 90); x.bezierCurveTo(206, 74, 228, 150, 128, 222); x.fill();
    x.fillRect(122, 24, 12, 74); x.fillRect(100, 42, 56, 11);
    x.fillStyle = '#1b2438'; x.font = 'bold 24px serif'; x.textAlign = 'center';
    x.fillText('JESU XPI', 128, 146); x.fillText('PASSIO', 128, 174);
  });
}
/** Enceinte vue de la rue : mur sur la rue (x = f) avec un portail (largeur gate, centre gz), murs latéraux jusqu'à x1, mur du fond. */
function mobCompound(F, f, x1, hz, col, cap, gate = 4, gz = 0, h = 2.3) {
  const g0 = gz - gate / 2, g1 = gz + gate / 2;
  for (const [p, q] of [[-hz, g0], [g1, hz]]) if (q - p > 0.2) F.box(0.25, h, q - p, col, f + 0.12, h / 2, (p + q) / 2).box(0.32, 0.16, q - p, cap, f + 0.12, h + 0.08, (p + q) / 2);
  if (gate > 0) F.box(0.12, h - 0.15, gate, pick(GATES), f + 0.2, (h - 0.15) / 2, gz);
  for (const z of [-hz, hz]) F.box(x1 - f, h, 0.25, col, (f + x1) / 2, h / 2, z);
  F.box(0.25, h, 2 * hz, col, x1, h / 2, 0);
}
/** Toit à deux pans (faîtage le long de z local) sur un bâtiment centré en x, de profondeur d et de longueur len, posé à la hauteur h. */
function mobGable(F, x, d, len, h, col, z = 0, pitch = 0.32) {
  const half = d / 2 + 0.4, slope = half / Math.cos(pitch);
  for (const s of [-1, 1]) F.box(slope, 0.12, len + 0.6, col, x + s * half / 2, h + Math.tan(pitch) * half / 2, z, 0, 0, -s * pitch);
}
/** Bâtiment d'école ou d'hôpital (un niveau, ou deux) : murs, soubassement, rangée de fenêtres et portes côté rue (x0), toit. */
function mobBlock(F, x0, d, len, z, wall, band, roof, floors = 1, gable = true) {
  const h = floors * 3.2, x = x0 + d / 2;
  F.box(d, h, len, wall, x, h / 2, z).box(d + 0.06, 0.9, len + 0.06, band, x, 0.45, z);
  for (let fl = 0; fl < floors; fl++) for (let k = -len / 2 + 1.6; k < len / 2 - 1; k += 3.2) {
    F.box(0.08, fl === 0 && Math.round(k) % 2 === 0 ? 2.1 : 1.2, 1.5, fl === 0 && Math.round(k) % 2 === 0 ? pick(GATES) : 0x24303c, x0 - 0.03, fl * 3.2 + (fl === 0 && Math.round(k) % 2 === 0 ? 1.05 : 1.7), z + k);
  }
  if (gable) mobGable(F, x, d, len, h, roof, z);
  else F.box(d + 0.4, 0.25, len + 0.4, roof, x, h + 0.12, z);
  return h;
}
/** Parasol de marché (souvent multicolore) avec étal et vendeuse assise. */
function mobUmbrella(b, d, x, z, rainbow = chance(0.6)) {
  b.cyl(0.04, 0.04, 2.3, 0x555555, x, 1.15, z);
  if (rainbow) for (let k = 0; k < 6; k++) b.add(new THREE.ConeGeometry(1.7, 0.6, 6, 1, true, k * Math.PI / 3, Math.PI / 3), [0xd62828, 0xf5c400, 0x2a9d4b, 0x1d5fbf, 0xf28c28, 0xffffff][k], x, 2.45, z);
  else b.add(new THREE.ConeGeometry(1.7, 0.6, 8), pick(UMBRELLAS), x, 2.45, z);
  b.box(1.2, 0.75, 0.8, 0x8b6b45, x + 0.4, 0.38, z + 0.3);
  if (chance(0.7)) addPerson(d, x - 0.5, z - 0.4, { sitting: true });
  MOB_PROPS.push([x, z, 2.2]);
}

/** Le logo des Passionistes sur fond blanc (photo de l'auteur) ; sans la photo, l'emblème dessiné. */
const mobLogo = () => (MOB_LOGO ? canvasTexture(256, 340, (x, W, H) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); x.drawImage(MOB_LOGO, 3, 4, W - 6, H - 8); }) : passioEmblem());
/** Claustra en blocs de béton ajourés (bâtiment de l'ITP Passio, photo de l'auteur). */
const claustraTexture = () => canvasTexture(128, 96, (x, W, H) => {
  x.fillStyle = '#d8d6cf'; x.fillRect(0, 0, W, H); x.fillStyle = '#3a3a36';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) x.fillRect(i * 16 + 4, j * 16 + 4, 8, 8);
});
/** Le grand panneau peint du Centre Hospitalier de Kingasani, à côté de son portail (vidéo « direction Mobutu », 0:32). */
const chkPanel = () => canvasTexture(1024, 400, (x, W, H) => {
  x.fillStyle = '#1f8a8a'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#ffffff'; x.textAlign = 'center';
  x.font = 'bold 76px "Arial Black", Impact, sans-serif'; x.fillText('C.H.K', W / 2, 80);
  x.font = 'bold 40px sans-serif'; x.fillText('CENTRE HOSPITALIER DE KINGASANI', W / 2, 130, W - 30);
  x.textAlign = 'left';
  const col = (title, lines, x0) => {
    x.font = 'bold 27px sans-serif'; x.fillText(title, x0, 184);
    x.font = '23px sans-serif'; lines.forEach((l, i) => x.fillText(l, x0, 218 + i * 30));
  };
  col('SERVICES', ['Médecine interne', 'Chirurgie', 'Gynéco-obstétrique', 'Pédiatrie', 'Urgences 24h/24'], 34);
  col('LABORATOIRE', ['Biochimie', 'Hématologie', 'Parasitologie', 'Échographie', 'Radiologie'], 384);
  col('HEURES DE VISITE', ['Lundi à vendredi :', '6h – 8h · 12h – 14h', '17h – 19h', 'Samedi, dimanche :', '6h – 19h'], 700);
});
/** Un obstacle invisible au bord du boulevard (moto garée, chauffeur) : les piétons le contournent (voir obstacleAt). */
function obstBox(x, z, w, d, yaw = 0) {
  const g = new THREE.BoxGeometry(w, 1.2, d).rotateY(yaw).translate(x, 0.9, z), n = g.toNonIndexed();
  obstMark(n); g.dispose(); n.dispose();
}
/** Une longue clôture le long de la rue key, du côté e, de t0 à t1 (m le long de la rue) : mur gris continu, avec ses portes ; dans l'intervalle
 *  mesh, un mur bas et un grillage. gates : { t, w, col, pillar?, small?, open?, sign? [titre, sous-titre, fond, texte], logo?, panel?, panelW? } */
function mobEnclosure({ MC, signs, grid, road }, key, e, t0, t1, gates, mesh = null) {
  const r = road(key);
  if (!r) return;
  const f = r.w / 2 + (r.paved ? 2.2 : 1.2), x = f + 0.12, STEP = 2;
  for (let t = t0; t < t1 - 0.01; t += STEP) {
    let parts = [[t, Math.min(t1, t + STEP)]];
    for (const g of gates) parts = parts.flatMap(([p, q]) => { const g0 = g.t - g.w / 2, g1 = g.t + g.w / 2; return q <= g0 || p >= g1 ? [[p, q]] : [...(p < g0 ? [[p, g0]] : []), ...(q > g1 ? [[g1, q]] : [])]; });
    for (const [p, q] of parts) {
      if (q - p < 0.05) continue;
      const tc = (p + q) / 2, o = roadSide(r, tc, e), F = frame(MC.at(o.z, o.x), o.x, o.z, o.th), len = q - p + 0.04;
      if (mesh && tc >= mesh[0] && tc <= mesh[1]) {                     // mur bas et grillage (photos du dossier Lycée)
        F.box(0.3, 0.9, len, 0xf2efe8, x, 0.45, 0).box(0.07, 2.3, 0.07, 0x5a5f66, x, 1.15, -len / 2 + 0.05);
        for (const y of [1.3, 1.8, 2.25]) F.box(0.03, 0.03, len, 0x6f757c, x, y, 0);
      } else {                                                           // le long mur gris, crépi grossier (vidéo « direction Mobutu »)
        F.box(0.25, 2.5, len, 0xa7a49b, x, 1.25, 0).box(0.27, 0.5, len, 0x8a877f, x, 0.25, 0).box(0.32, 0.14, len, 0x8f8c84, x, 2.55, 0);
      }
      grid.rect(o.x, o.z, o.th, f - 0.3, f + 0.6, len / 2, true);
    }
  }
  for (const g of gates) {
    const o = roadSide(r, g.t, e), F = frame(MC.at(o.z, o.x), o.x, o.z, o.th), S = frameSigns(signs, o.x, o.z, o.th), h = g.small ? 2.4 : 2.9, pc = g.pillar ?? 0x8f8c84;
    F.box(0.5, h, 0.5, pc, x, h / 2, -g.w / 2 - 0.25).box(0.5, h, 0.5, pc, x, h / 2, g.w / 2 + 0.25);
    if (g.open) for (const s of [-1, 1]) F.box(g.w / 2 - 0.1, h - 0.4, 0.1, g.col, x + g.w / 4 + 0.1, (h - 0.4) / 2, s * (g.w / 2 - 0.1));   // (battants ouverts vers l'intérieur)
    else F.box(0.1, h - 0.4, g.w / 2 - 0.05, g.col, x + 0.1, (h - 0.4) / 2, -g.w / 4).box(0.1, h - 0.4, g.w / 2 - 0.05, g.col, x + 0.1, (h - 0.4) / 2, g.w / 4);
    if (g.sign) {
      F.box(0.3, 0.9, g.w + 1.4, g.lintel ?? 0xf2efe8, x, h + 0.45, 0);
      S.add(`mob_gate_${g.sign[0]}`, () => signTexture(...g.sign), g.w + 1.2, 0.8, x - 0.17, h + 0.45, 0, -Math.PI / 2, true);
    }
    if (g.logo) S.add('mob_logo_passio', mobLogo, 0.9, 1.2, x - 0.14, 1.55, g.w / 2 + 1.3, -Math.PI / 2, true);
    if (g.plaque) for (const s of [-1, 1]) {                             // (plaques blanches posées sur les deux piliers, photos du dossier Lycée)
      F.box(0.1, 1.05, 1.85, 0xf4f4f0, x - 0.36, h + 0.55, s * (g.w / 2 + 0.25));
      S.add(`mob_plaque_${g.plaque[0]}`, () => mobText([[g.plaque[0], 1.05], [g.plaque[1], 0.55]], '#f7f7f2', '#262626', 512, 256, 'Georgia, "Times New Roman", serif'), 1.75, 0.95, x - 0.42, h + 0.55, s * (g.w / 2 + 0.25), -Math.PI / 2, true);
    }
    if (g.panel) S.add(`mob_panel_${g.t.toFixed(0)}`, g.panel, g.panelW ?? 5, 2.0, x - 0.14, 1.4, -(g.w / 2 + 0.6 + (g.panelW ?? 5) / 2), -Math.PI / 2, true);
  }
}

/** La pancarte du Lycée technique Louis Palazzolo de Kingasani 2 (photo de l'auteur) : panneau blanc, titre rouge, options en bleu, mentions en noir. */
const palazzoloSign = () => canvasTexture(1024, 680, (x, W, H) => {
  x.fillStyle = '#f6f6f2'; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#d23a2a'; x.font = 'bold 78px Georgia, "Times New Roman", serif';
  ['LYCEE TECHNIQUE', 'LOUIS PALAZZOLO', 'DE KINGASANI 2'].forEach((t, i) => x.fillText(t, W / 2, 86 + i * 92, W - 60));
  x.textAlign = 'left'; x.fillStyle = '#2f8fd8'; x.font = 'bold 40px Georgia, "Times New Roman", serif';
  x.fillText('OPTIONS', 40, 380);
  x.font = '40px Georgia, "Times New Roman", serif';
  x.fillText('- Technique Coupe et Couture', 250, 380, W - 280);
  x.fillText('- Technique Commerciale Informatique', 250, 432, W - 280);
  x.textAlign = 'center'; x.fillStyle = '#2a2a2a'; x.font = '44px Georgia, "Times New Roman", serif';
  x.fillText('ECOLE CONVENTIONNEE CATHOLIQUE', W / 2, 530, W - 60);
  x.fillText('ASS. SOEURS DES PAUVRES DE BERGAME', W / 2, 600, W - 60);
});

/** Une élève du lycée en uniforme (photos du dossier Lycée ; l'auteur, 20/11 : « lycée : les filles ») : chemisier bleu très clair à manches courtes et longue jupe bleu marine (photo lycée2), modèle MakeHuman « fille ». */
const pupil = () => outfit('student', { model: 'fille', female: true, dress: true, pagne: 0x1d3557, pagne2: 0x1d3557, pagneTop: false, shirt: 0xdfe9f7, shoes: 0x2b2b2b, headwrap: null, basin: null, bag: chance(0.6) ? 0x2b2b2b : null });

/** Le Lycée de Kingasani 2 et l'E.P. Elikya de Kingasani 2 (l'auteur, 14/11 : « vas dans le dossier Lycée, tu vas voir les images intérieures du lycée,
 *  implémente ça, respecte bien, parce que nous allons donner la possibilité aux véhicules d'entrer » ; photos et vidéo du dossier Kingasani/Lycée).
 *  En face de la Rue de la Commune, de l'autre côté de la Rue Kimpioka, le grand portail ouvre sur une longue allée de sable (la rue 'lycee', qui prolonge
 *  la Rue de la Commune), entre deux murets gris sur un soubassement de pierres, à piliers sombres, surmontés de grillage et de fil barbelé, sous les
 *  flamboyants ; des fleurs rouges tombées sur le sable.
 *  - À gauche (côté Rue Kabila) : le bâtiment jaune de l'administration et ses climatiseurs, puis le portail du lycée (pilier de béton brut et sa plaque
 *    blanche « LYCÉE DE KINGASANI 2 », grille grise ouverte) sur la grande cour de gravier : le long bâtiment des classes, vert en bas et jaune en haut,
 *    volets bruns, toit de fibrociment à large avancée, son hall ouvert au milieu et la statue, l'auvent de tôle rouillée, le claustra, les massifs de
 *    fleurs, le drapeau, le banc, la poubelle, deux grands flamboyants dont un sur sa margelle, la vendeuse de cahiers sous son parasol, et au fond le
 *    bâtiment jaune à deux niveaux.
 *  - À droite : le portail grillagé vert de l'E.P. Elikya (plaque sur son pilier), son petit bâtiment bleu au toit de tôle rouillée, puis le long bâtiment
 *    crème à soubassement et portes bleus tout près de l'allée, l'arbre aux fleurs roses.
 *  - Au fond, l'allée s'élargit en une place de sable : à droite la bande d'herbe et sa clôture de piquets et de fils, puis la clôture aux deux portails
 *    bleus et le bâtiment jaune à bandeau bleu ; à gauche les grands arbres et les élèves dessous ; au bout, la guérite blanche et bleue au toit orange,
 *    le panneau d'affichage, une voiture garée et le portail bleu du fond.
 *  Repère de l'allée (MOB_LYC) : u le long de l'allée depuis l'axe de la Rue Kimpioka, v vers la Rue Kabila. Les véhicules roulent dans l'allée, la cour du
 *  lycée et la place du fond (MOB_AREAS, MOB_SOLIDS : mêmes positions), pas chez Elikya. */
function addLycee({ site, grid, MC, md, scene, fails }) {
  const LY = MOB_LYC, th = Math.atan2(LY.U[0], LY.U[1]);
  const GREY = 0x8f8e88, PIER = 0x6c6c68, STONE = 0x6e655a, MESH = 0x9aa1a6, POST = 0x5a5f66, SAND = 0xa99c86, GRAVEL = 0x9d968b;
  const GREEN = 0x2e8b3a, YELLOW = 0xf2d200, CREAM = 0xf1e3b0, BLUE = 0x1f6fbf, ROOF = 0x9c9c96, PALE = 0xf0dc8c;
  /** Un morceau dans le repère de l'allée (x local = v, z local = u - uc) ; le sol est contrôlé à 1,2 m de ses bords (cases de 1 m de la grille). */
  const part = (name, u0, u1, v0, v1, build, check = true) => {
    const uc = (u0 + u1) / 2, [x, z] = lycXZ(uc, 0), o = { x, z, th };
    if (!site(o, v0 + 0.6, v1 - 1.2, (u1 - u0) / 2 - 1.2, (F, S, Fd) => build(F, S, Fd, uc), check)) { fails.push(name); return; }
    grid.rect(o.x, o.z, o.th, v0 - 0.3, v1 + 0.3, (u1 - u0) / 2 + 0.3, true);                     // (tout le morceau est pris)
  };
  /** Muret gris sur pierres, à piliers sombres, surmonté de grillage et de barbelé, le long de u (en v), de ua à ub. */
  const fenceU = (F, uc, v, ua, ub, mesh = true) => {
    const L = ub - ua, zc = (ua + ub) / 2 - uc, s = Math.sign(v) || 1;
    if (L < 0.1) return;
    F.box(0.44, 0.35, L, STONE, v, 0.175, zc).box(0.3, 0.95, L, GREY, v, 0.82, zc);
    for (let u = ua + 0.2; u <= ub; u += 2.9) F.box(0.42, 1.12, 0.42, PIER, v, 0.56, u - uc);
    if (!mesh) return;
    for (let u = ua + 0.2; u <= ub; u += 2.9) F.box(0.06, 1.75, 0.06, POST, v, 2.17, u - uc).box(0.04, 0.5, 0.04, POST, v - 0.16 * s, 3.17, u - uc, 0, 0, 0.6 * s);
    for (const y of [1.45, 1.95, 2.45, 2.95]) F.box(0.025, 0.025, L, MESH, v, y, zc);
    for (let u = ua + 0.3; u < ub - 0.1; u += 0.45) F.box(0.02, 1.55, 0.02, MESH, v, 2.2, u - uc);
    F.box(0.02, 0.02, L, 0x777b80, v - 0.3 * s, 3.36, zc);
  };
  /** La même clôture le long de v (en u), de va à vb. */
  const fenceV = (F, uc, u, va, vb, mesh = true) => {
    const L = vb - va, xc = (va + vb) / 2, z = u - uc;
    if (L < 0.1) return;
    F.box(L, 0.35, 0.44, STONE, xc, 0.175, z).box(L, 0.95, 0.3, GREY, xc, 0.82, z);
    if (!mesh) return;
    for (let v = va + 0.2; v <= vb; v += 2.9) F.box(0.06, 1.75, 0.06, POST, v, 2.17, z);
    for (const y of [1.45, 1.95, 2.45, 2.95]) F.box(L, 0.025, 0.025, MESH, xc, y, z);
    for (let v = va + 0.3; v < vb - 0.1; v += 0.45) F.box(0.02, 1.55, 0.02, MESH, v, 2.2, z);
  };
  /** Pilier de portail en béton brut, et sa plaque blanche posée dessus, tournée vers l'allée. */
  const pillar = (F, S, uc, v, u, key, title, sub) => {
    F.box(0.62, 2.7, 0.62, 0x8e8e8a, v, 1.35, u - uc);
    if (!title) return;
    const s = Math.sign(v) || 1;
    F.box(0.1, 1.05, 1.85, 0xf4f4f0, v - 0.34 * s, 3.2, u - uc);
    S.add(key, () => mobText([[title, 1.05], [sub, 0.55]], '#f7f7f2', '#262626', 512, 256, 'Georgia, "Times New Roman", serif'), 1.75, 0.95, v - 0.4 * s, 3.2, u - uc, s > 0 ? -Math.PI / 2 : Math.PI / 2, true);
  };
  /** Un grand arbre : flamboyant (fleurs rouge orangé), arbre aux fleurs roses ou arbre vert ; base : sa margelle en béton (photo). */
  const tree = (F, uc, u, v, s = 1, flowers = 0xd9381e, base = false) => {
    const z = u - uc;
    F.cyl(0.32 * s, 0.48 * s, 3.3 * s, 0x5d4330, v, 1.65 * s, z).ball(3.8 * s, 0x2f6d2a, v, 4.8 * s, z, 1.4, 0.55, 1.4);
    if (flowers) for (let k = 0; k < 8; k++) F.ball(0.9 * s, flowers, v + rand(-2.8, 2.8) * s, 5.2 * s + rand(-0.3, 0.6), z + rand(-2.8, 2.8) * s, 1.2, 0.6, 1.2);
    if (base) F.cyl(1.2, 1.2, 0.42, 0x6f6c66, v, 0.21, z, 0, 0, 0, 12);
  };
  /** Des élèves debout, en petits groupes. */
  const pupils = (Fd, uc, n, v0, v1, u0, u1, mode = 'idle') => {
    for (let i = 0; i < n; i++) {
      const v = rand(v0, v1), u = rand(u0, u1), x = Fd.X(v, u - uc), z = Fd.Z(v, u - uc);
      bakeCharacter(md.at(z), pupil(i), mode, x, z, rand(0, 6.28), Math.random() * 10, true);
    }
  };
  /** Une rangée de salles de classe le long de u : soubassement low, haut high, volets bruns et portes, toit de fibrociment à faible pente et bord
   *  sombre, l'avancée du côté de la façade (face : -1 si la façade regarde vers v décroissant). */
  const classes = (F, uc, u0, u1, v0, v1, face, low, high, door, h = 3.1, over = 1.4, frame = null) => {
    const L = u1 - u0, zc = (u0 + u1) / 2 - uc, d = v1 - v0, vc = (v0 + v1) / 2, fv = face < 0 ? v0 : v1;
    F.box(d, h, L, high, vc, h / 2, zc).box(d + 0.06, 1.15, L + 0.06, low, vc, 0.575, zc);
    for (let k = 1.6, n = 0; k < L - 1; k += 3.1, n++) {
      const isDoor = n % 3 === 1, z = u0 + k - uc;
      F.box(0.08, isDoor ? 2.1 : 1.3, isDoor ? 1.0 : 1.6, isDoor ? door : 0x3a2a1e, fv + face * 0.04, isDoor ? 1.05 : 1.85, z);
      if (frame) F.box(0.1, isDoor ? 2.3 : 1.5, 0.12, frame, fv + face * 0.06, isDoor ? 1.15 : 1.85, z - (isDoor ? 0.56 : 0.86)).box(0.1, isDoor ? 2.3 : 1.5, 0.12, frame, fv + face * 0.06, isDoor ? 1.15 : 1.85, z + (isDoor ? 0.56 : 0.86));
    }
    F.box(d + over + 0.4, 0.1, L + 0.5, ROOF, vc + face * over / 2, h + 0.18, zc, 0, 0, face * 0.05)
      .box(0.08, 0.32, L + 0.5, 0x2a2a2a, fv + face * (over + 0.2), h + 0.1, zc);
  };

  // --- côté Rue Kabila, à l'entrée : le bâtiment jaune de l'administration (photo : derrière le grillage, à gauche en entrant, ses climatiseurs)
  part('Lycée de Kingasani 2 (administration)', 7.3, 20, 4.3, 16.7, (F, S, Fd, uc) => {
    F.box(12.4, 0.02, 12.7, GRAVEL, 10.5, 0.012, 13.65 - uc);
    fenceU(F, uc, 4.0, 10.6, 20);
    fenceU(F, uc, 16.6, 7.3, 20);
    F.box(9, 6.4, 7, PALE, 11, 3.2, 13 - uc).box(9.3, 0.3, 7.3, 0xe0c86a, 11, 6.5, 13 - uc);
    for (let u = 10.3; u < 16; u += 2.2) for (const y of [1.8, 4.9]) F.box(0.08, 1.2, 1.3, 0x2a3540, 6.46, y, u - uc);
    for (const [u, y] of [[11.4, 2.7], [13.6, 2.7], [14.8, 5.6]]) F.box(0.35, 0.45, 0.6, 0xf2f2f2, 6.3, y, u - uc);   // climatiseurs
    for (let u = 8.2; u < 19.6; u += 0.24) F.box(0.12, 0.03, 0.14, 0xc0392b, rand(-3, 3), 0.035, u - uc + rand(-0.1, 0.1));   // fleurs tombées sur l'allée
    tree(F, uc, 18.2, 6.4, 1.1, 0xd9381e);
    pupils(Fd, uc, 3, 5.0, 6.0, 8.5, 15.5);
  });
  // --- la grande cour de gravier du lycée, le long bâtiment des classes et son hall, le bâtiment jaune du fond
  part('Lycée de Kingasani 2 (cour)', 20, 62.5, 4.3, 26.9, (F, S, Fd, uc) => {
    F.box(22.6, 0.02, 42.5, GRAVEL, 15.6, 0.012, 41.25 - uc);
    for (let k = 0; k < 80; k++) F.box(rand(0.12, 0.35), 0.05, rand(0.12, 0.3), pick([0xd8d4cc, 0xbdb8ae, 0xe8e4dc]), rand(5, 18), 0.035, rand(21, 53) - uc, 0, rand(0, 3), 0);   // les cailloux
    fenceU(F, uc, 4.0, 20, 26.3);
    fenceU(F, uc, 4.0, 31.3, 62.5);
    fenceU(F, uc, 26.8, 20, 62.5);
    fenceV(F, uc, 20, 16.6, 26.8);
    fenceV(F, uc, 62.5, 4.3, 26.8);
    // le portail : piliers, plaque, grille grise ouverte, ses deux battants rabattus le long de la clôture
    pillar(F, S, uc, 4.0, 26.3, 'mob_lyc_plaque', 'LYCÉE DE KINGASANI 2', 'École conventionnée catholique · Sœurs de Kingasani');
    pillar(F, S, uc, 4.0, 31.3);
    for (const u of [25.0, 32.6]) {
      F.box(0.06, 2.1, 2.2, 0x8a9096, 4.45, 1.15, u - uc);
      for (let k = -0.8; k <= 0.8; k += 0.4) F.box(0.04, 0.04, 2.2, 0x9aa0a6, 4.45, 1.15 + k, u - uc);
      for (let k = -0.9; k <= 0.9; k += 0.45) F.box(0.04, 1.9, 0.04, 0x9aa0a6, 4.45, 1.15, u + k - uc);
    }
    // le long bâtiment des classes, vert en bas, jaune en haut, volets bruns, en deux ailes de part et d'autre du hall
    classes(F, uc, 21.5, 34.5, 20.5, 26, -1, GREEN, YELLOW, 0x2a5c8a);
    classes(F, uc, 37.5, 54, 20.5, 26, -1, GREEN, YELLOW, 0x2a5c8a);
    F.box(1.4, 2.0, 0.1, 0xf4f4f0, 20.46, 1.6, 31.6 - uc);
    S.add('mob_claustra', claustraTexture, 1.3, 1.9, 20.44, 1.6, 31.6 - uc, -Math.PI / 2);
    F.box(1.6, 0.06, 11, 0x8a4b2a, 19.75, 2.72, 27.5 - uc, 0, 0, 0.12);                                // l'auvent de tôle rouillée (photo)
    // le hall ouvert : sol, mur du fond, toit, la statue dorée, une table et deux personnes assises
    F.box(5.5, 0.02, 3, 0xbdb8ae, 23.25, 0.02, 36 - uc).box(0.25, 3.1, 3.2, YELLOW, 25.9, 1.55, 36 - uc).box(7.3, 0.1, 3.4, ROOF, 22.6, 3.28, 36 - uc, 0, 0, -0.05);
    F.box(0.7, 0.5, 0.7, 0xf4f4f0, 24.6, 0.25, 36 - uc).cyl(0.22, 0.3, 1.1, 0xd4af37, 24.6, 1.05, 36 - uc).ball(0.18, 0xd4af37, 24.6, 1.75, 36 - uc);
    F.box(0.9, 0.75, 1.6, 0x8b6b45, 22.4, 0.38, 36 - uc);
    for (const dz of [-1.1, 1.1]) {
      F.box(0.4, 0.45, 0.4, 0x6b4f2a, 22.4, 0.22, 36 + dz * 1.15 - uc);
      const x = Fd.X(22.4, 36 + dz - uc), z = Fd.Z(22.4, 36 + dz - uc);
      bakeCharacter(md.at(z), pupil(dz > 0 ? 1 : 2), 'sit', x, z, dz > 0 ? th + Math.PI : th, Math.random() * 10, true);
    }
    // les massifs de fleurs devant l'aile de gauche et de part et d'autre du hall
    for (let u = 22.2; u < 34.2; u += 0.9) {
      F.ball(0.42, 0x3f7d2c, 18.6, 0.38, u - uc, 1.2, 0.8, 1.2);
      if (chance(0.65)) F.ball(0.24, pick([0xc2185b, 0xd62828, 0xe91e63, 0xff6f00]), 18.6 + rand(-0.3, 0.3), 0.72, u - uc + rand(-0.3, 0.3));
    }
    F.box(0.12, 0.2, 12.3, 0xd9d4ca, 17.9, 0.1, 28.2 - uc);
    // le drapeau de la RDC devant le hall, le banc, la poubelle
    F.cyl(0.05, 0.05, 7, 0xcfcfcf, 18.7, 3.5, 39.5 - uc);
    S.add('flagRDC', flagTexture, 1.5, 1.0, 18.71, 6.3, 38.7 - uc, Math.PI / 2);
    S.add('flagRDC', flagTexture, 1.5, 1.0, 18.69, 6.3, 38.7 - uc, -Math.PI / 2);
    F.box(0.45, 0.45, 2, 0xc9c6bd, 19.3, 0.23, 42 - uc);
    F.cyl(0.28, 0.24, 0.8, 0x3a3d42, 12, 0.4, 46.5 - uc);
    // les flamboyants : un près du portail, au-dessus de l'allée ; deux grands dans la cour, l'un sur sa margelle
    tree(F, uc, 33.6, 6.6, 1.15, 0xd9381e);
    tree(F, uc, 48, 9.2, 1.25, 0xd9381e, true);
    tree(F, uc, 51.5, 15.5, 1.15, 0xd9381e);
    // la vendeuse de cahiers : parasol, table, cahiers
    {
      const x = Fd.X(9.5, 24.5 - uc), z = Fd.Z(9.5, 24.5 - uc), d = md.at(z);
      mobUmbrella(MC.at(z, x), d, x, z, true);
      for (let k = 0; k < 8; k++) d.box(0.22, 0.03, 0.3, pick([0x1d6fd1, 0xd62828, 0x2a9d4b, 0xf5c400, 0x8e24aa]), x + 0.4 + rand(-0.4, 0.4), 0.77 + (k % 4) * 0.03, z + 0.3 + rand(-0.25, 0.25), 0, rand(-0.3, 0.3), 0);
    }
    // le bâtiment jaune du fond, à deux niveaux, toit plat, ses climatiseurs
    F.box(20, 6.4, 7.5, PALE, 16, 3.2, 58.25 - uc).box(20.3, 0.3, 7.8, 0xe0c86a, 16, 6.5, 58.25 - uc);
    for (let v = 7.4; v < 25.5; v += 2.6) for (const y of [1.8, 4.9]) F.box(1.3, 1.2, 0.08, 0x2a3540, v, y, 54.46 - uc);
    for (let k = 0; k < 4; k++) F.box(0.6, 0.45, 0.35, 0xf2f2f2, 8 + k * 4.5, 2.7, 54.3 - uc);
    // les élèves : sous l'avancée du toit, devant les classes, et contre le bâtiment du fond
    pupils(Fd, uc, 6, 19.6, 20.3, 22.5, 33.5);
    pupils(Fd, uc, 6, 19.4, 20.3, 38.5, 53.5);
    pupils(Fd, uc, 4, 7, 18, 53.7, 54.2);
  });
  // --- l'E.P. Elikya de Kingasani 2, de l'autre côté de l'allée (pas d'entrée pour les véhicules)
  part('E.P. Elikya de Kingasani 2', 7.3, 62.5, -25.5, -4.3, (F, S, Fd, uc) => {
    F.box(21.2, 0.02, 55.2, 0xb5a68c, -14.9, 0.012, 34.9 - uc);
    fenceU(F, uc, -4.0, 10.6, 15.3);
    fenceU(F, uc, -4.0, 18.7, 62.5);
    fenceU(F, uc, -25.5, 7.3, 62.5);
    fenceV(F, uc, 62.5, -25.5, -4.3);
    // le portail : piliers, plaque, grille grillagée verte fermée
    pillar(F, S, uc, -4.0, 15.0);
    pillar(F, S, uc, -4.0, 19.0, 'mob_elikya_plaque', 'E.P. ELIKYA DE KINGASANI 2', 'École conventionnée catholique · Kingasani');
    F.box(0.06, 2.1, 3.4, 0x1f7a5a, -4.0, 1.25, 17 - uc);
    for (let k = -1.5; k <= 1.5; k += 0.3) F.box(0.03, 2.0, 0.02, 0x2f8f6a, -4.04, 1.25, 17 + k - uc);
    // le petit bâtiment bleu derrière le portail, toit de tôle rouillée, fenêtres grillagées (vidéo, 0:10–0:15)
    F.box(5, 3.0, 12, BLUE, -10.5, 1.5, 17 - uc).box(6.2, 0.1, 12.6, 0x8a4b2a, -10.5, 3.25, 17 - uc, 0, 0, 0.08);
    for (let k = -4.5; k <= 4.5; k += 2.25) F.box(0.08, 1.1, 1.4, 0x1b2430, -7.96, 1.8, 17 + k - uc);
    // le long bâtiment crème à soubassement et cadres bleus, tout près de l'allée (photo), et son annexe plus basse
    classes(F, uc, 26, 50, -12.6, -7.2, 1, BLUE, CREAM, 0x1f5fbf, 3.1, 1.4, BLUE);
    F.box(4.4, 2.6, 8, CREAM, -9.8, 1.3, 54 - uc).box(4.5, 0.9, 8.06, BLUE, -9.8, 0.45, 54 - uc).box(5.2, 0.1, 8.6, ROOF, -9.8, 2.75, 54 - uc, 0, 0, 0.06);
    F.box(0.08, 1.1, 1.6, 0x24303c, -7.56, 1.7, 54 - uc);
    tree(F, uc, 23.5, -5.8, 0.85, 0xe7a1c4);
    tree(F, uc, 57, -18, 1.1, 0);
    pupils(Fd, uc, 8, -18, -14, 12, 50);
  });
  // --- au fond, la place de sable où l'allée s'élargit (on y roule)
  part('Lycée (place du fond)', 62.5, 82.5, -13, 13, (F, S, Fd, uc) => {
    F.box(26, 0.03, 20, SAND, 0, 0.016, 72.5 - uc);
    // à droite : la bande d'herbe et sa clôture de piquets et de fils (vidéo, 0:35 et 0:51)
    F.box(1.6, 0.04, 20, 0x4f8a3a, -12, 0.02, 72.5 - uc);
    for (let u = 62.8; u <= 82.5; u += 2.5) F.box(0.08, 1.2, 0.08, 0x8a6a4a, -12.9, 0.6, u - uc);
    for (const y of [0.45, 0.8, 1.1]) F.box(0.02, 0.02, 20, 0x6a6a6a, -12.9, y, 72.5 - uc);
    // à gauche : la clôture, deux grands arbres et les élèves dessous
    fenceU(F, uc, 13, 62.5, 82.5);
    tree(F, uc, 66, 10.6, 1.2, 0);
    tree(F, uc, 73, 10.9, 1.1, 0xd9381e);
    pupils(Fd, uc, 9, 9.8, 12.3, 64, 75);
    // au bout : la guérite blanche et bleue au toit orange, le panneau d'affichage, le mur et le portail bleu du fond
    F.box(3, 2.6, 3, 0xf4f4f0, -4.5, 1.3, 79.5 - uc).box(3.06, 0.8, 3.06, BLUE, -4.5, 0.4, 79.5 - uc).box(3.8, 0.15, 3.8, 0xd2691e, -4.5, 2.7, 79.5 - uc)
      .box(1.2, 0.9, 0.08, 0x1b2430, -4.5, 1.6, 77.96 - uc).box(0.08, 2.0, 0.9, 0x2a3540, -2.96, 1.0, 80.2 - uc);
    F.box(0.08, 2.2, 0.08, 0x5a5f66, -10.4, 1.1, 74.1 - uc).box(0.08, 2.2, 0.08, 0x5a5f66, -10.4, 1.1, 75.9 - uc).box(0.06, 1.1, 1.9, 0xf7f7f2, -10.36, 1.75, 75 - uc);
    S.add('mob_lyc_avis', () => mobText([['AVIS AUX ÉLÈVES', 1], ['Lycée de Kingasani 2', 0.7]], '#f7f7f2', '#1d3f8f', 512, 256), 1.8, 1.0, -10.32, 1.75, 75 - uc, Math.PI / 2, true);
    // le mur du fond et, au milieu, le portail bleu en treillis du Lycée technique Louis Palazzolo de Kingasani 2 (l'auteur, 14/11 : « la dernière porte
    // bleue dans la cour du lycée, mets-la sous forme de treillis » ; sa pancarte, d'après la photo, plantée à côté, sur son cadre de fer)
    const zw = 82.35 - uc, GB = 0x1f6fd1;
    F.box(10.75, 2.4, 0.3, GREY, -7.625, 1.2, zw).box(10.75, 2.4, 0.3, GREY, 7.625, 1.2, zw);
    F.box(0.5, 2.7, 0.5, 0x8e8e8a, -2.25, 1.35, zw).box(0.5, 2.7, 0.5, 0x8e8e8a, 2.25, 1.35, zw);
    for (const sv of [-1, 1]) {                                            // deux battants : cadre bleu, treillis en losanges
      const c0 = sv * 1.0, x0 = c0 - 0.95, x1 = c0 + 0.95, y0 = 0.15, y1 = 2.25, Hh = y1 - y0;
      F.box(1.98, 0.07, 0.07, GB, c0, y0, zw).box(1.98, 0.07, 0.07, GB, c0, y1, zw).box(1.98, 0.06, 0.06, GB, c0, (y0 + y1) / 2, zw)
        .box(0.07, Hh, 0.07, GB, x0, (y0 + y1) / 2, zw).box(0.07, Hh, 0.07, GB, x1, (y0 + y1) / 2, zw);
      for (const sl of [1, -1]) for (let cc = x0 - Hh; cc < x1; cc += 0.32) {
        const xa = Math.max(x0, cc), xb = Math.min(x1, cc + Hh);
        if (xb - xa < 0.05) continue;
        const ya = sl > 0 ? y0 + (xa - cc) : y1 - (xa - cc), yb = sl > 0 ? y0 + (xb - cc) : y1 - (xb - cc), len = Math.hypot(xb - xa, yb - ya);
        F.box(len, 0.025, 0.025, GB, (xa + xb) / 2, (ya + yb) / 2, zw, 0, 0, Math.atan2(yb - ya, xb - xa));
      }
    }
    // la pancarte : panneau blanc dans son cadre de fer rouillé, sur deux poteaux et leurs jambes de force (photo)
    const pv = 8.7, pz = 81.6 - uc, RUST = 0x9b4a2c;
    F.box(3.5, 2.3, 0.07, RUST, pv, 2.45, pz + 0.05);
    for (const dv of [-1.62, 1.62]) F.box(0.09, 3.6, 0.09, RUST, pv + dv, 1.8, pz + 0.08).box(0.07, 1.6, 0.07, RUST, pv + dv, 0.75, pz + 0.55, -0.55, 0, 0);
    S.add('mob_palazzolo_pancarte', palazzoloSign, 3.3, 2.15, pv, 2.45, pz - 0.01, Math.PI, true);
    const [cx, cz] = lycXZ(80.4, 5.2), car = createCar({ color: 0xf2f2f2 });
    place(car, cx, cz, Math.atan2(-LY.U[0], LY.U[1]), 0);
    scene.add(car);
  }, false);
  // --- à droite de la place : la clôture aux deux portails bleus et le bâtiment jaune à bandeau bleu (vidéo, 0:48–0:53)
  part('Lycée (bâtiment jaune et bleu)', 62.5, 82.5, -22, -13.4, (F, S, Fd, uc) => {
    fenceU(F, uc, -14.2, 62.5, 66.6);
    fenceU(F, uc, -14.2, 69.4, 73.6);
    fenceU(F, uc, -14.2, 76.4, 82.5);
    for (const u of [68, 75]) {
      F.box(0.5, 2.5, 0.5, 0x8e8e8a, -14.2, 1.25, u - 1.65 - uc).box(0.5, 2.5, 0.5, 0x8e8e8a, -14.2, 1.25, u + 1.65 - uc);
      F.box(0.08, 2.2, 2.8, 0x1f6fd1, -14.2, 1.1, u - uc);
      for (let k = -1.2; k <= 1.2; k += 0.3) F.box(0.03, 2.1, 0.02, 0x2a7fe0, -14.25, 1.1, u + k - uc);
    }
    classes(F, uc, 64, 81, -21, -15.6, 1, BLUE, 0xf0d36a, 0x1f5fbf, 3.2, 1.0);
  });
  // --- au loin, côté Rue Kabila : un autre long bâtiment jaune
  part('Lycée (bâtiment du fond, à gauche)', 62.5, 82.5, 13.4, 22, (F, S, Fd, uc) => {
    classes(F, uc, 65, 81, 15.5, 21, -1, 0xe0c86a, PALE, 0x5b4a3a, 3.2, 1.0);
  });
  // --- derrière le portail en treillis : le Lycée technique Louis Palazzolo de Kingasani 2, sa cour de sable sous les grands arbres et ses classes
  part('Lycée technique Louis Palazzolo', 82.5, 100, -13, 13, (F, S, Fd, uc) => {
    F.box(26, 0.025, 17.5, SAND, 0, 0.015, 91.25 - uc);
    fenceU(F, uc, -13, 82.5, 100, false);
    fenceU(F, uc, 13, 82.5, 100, false);
    fenceV(F, uc, 100, -13, 13, false);
    classes(F, uc, 85, 98, 7, 12.4, -1, BLUE, 0xf4f1e6, 0x1f5fbf);          // les classes, le long de la cour
    F.box(14, 3.2, 5.6, 0xf4f1e6, -2, 1.6, 96.6 - uc).box(14.06, 1.1, 5.66, BLUE, -2, 0.55, 96.6 - uc).box(14.8, 0.1, 6.6, ROOF, -2, 3.35, 96.6 - uc, 0.05, 0, 0);
    for (let v = -7.5; v < 5; v += 3) F.box(1.4, 1.2, 0.08, 0x24303c, v, 1.8, 93.76 - uc);
    tree(F, uc, 88, -9, 1.25, 0);
    tree(F, uc, 93, -5, 1.1, 0xd9381e);
    pupils(Fd, uc, 8, -6, 4, 86, 92);
  });
}

/** Les repères du quartier (avant les parcelles ordinaires) ; renvoie la liste de ceux qui n'ont pas trouvé leur place (tests). */
function addMobomaLandmarks({ site, road, grid, MC, md, signs, scene }) {
  const fails = [];
  const at = (key, t, e) => roadSide(road(key), t, e);
  const MOB_LEN = roadLen(road('moboma'));                                // (le haut de Moboma se compte depuis la Rue Kabila, au bout)
  const fOf = key => { const r = road(key); return r.w / 2 + (r.paved ? 2.2 : 1.2); };
  /** Repère sur la rue key, du côté e, de t0 à t1 (m le long de la rue), profondeur depth ; build(F, S, Fd, info). */
  const spot = (name, key, t0, t1, e, depth, build) => {
    const r = road(key);
    if (!r) { fails.push(name + ' (rue absente)'); return null; }
    const tc = (t0 + t1) / 2, hz = (t1 - t0) / 2, o = at(key, tc, e), f = fOf(key);
    const info = { o, f, hz, e, r, tc, lz: t => (t - tc) * (e > 0 ? 1 : -1) };   // lz : z local d'un point de la rue à t m
    if (!site(o, f, f + depth, hz, (F, S, Fd) => build(F, S, Fd, info))) {
      // (tests) la première case occupée : où, et la rue la plus proche
      const c = Math.cos(o.th), sn = Math.sin(o.th);
      let hit = null;
      for (let lx = f + 0.6; lx <= f + depth + 0.01 && !hit; lx += 0.7) for (let lz = -hz; lz <= hz + 0.01; lz += 0.7) {
        const x = o.x + lx * c + lz * sn, z = o.z - lx * sn + lz * c;
        if (!grid.free(x, z)) { const near = MOB_ROADS.map(q => [q.key, Math.min(...q.pts.slice(1).map((p, i) => segDist(x, z, q.pts[i], p)))]).sort((a, b) => a[1] - b[1])[0]; hit = `${name} : x local ${lx.toFixed(1)}, z local ${lz.toFixed(1)} (près de ${near[0]} à ${near[1].toFixed(1)} m)`; break; }
      }
      fails.push(hit ?? name);
      return null;
    }
    return info;
  };
  const person = (Fd, lx, lz, opts) => addPerson(md.at(Fd.Z(lx, lz)), Fd.X(lx, lz), Fd.Z(lx, lz), opts);
  const crowd = (Fd, n, x0, x1, z0, z1, kind) => { for (let i = 0; i < n; i++) { const x = rand(x0, x1), z = rand(z0, z1); bakeCharacter(md.at(Fd.Z(x, z)), outfit(kind ?? (chance(0.5) ? 'woman' : 'man')), 'idle', Fd.X(x, z), Fd.Z(x, z), rand(0, 6.28), Math.random() * 10, true); } };
  const park = (mesh, F, lx, lz, yaw) => {          // véhicule garé : yaw local (0 : le long de z local)
    const th = Math.atan2(F.X(0, 1) - F.X(0, 0), F.Z(0, 1) - F.Z(0, 0));
    place(mesh, F.X(lx, lz), F.Z(lx, lz), Math.PI - th + yaw, 0);
    scene.add(mesh);
    MOB_PROPS.push([F.X(lx, lz), F.Z(lx, lz), 4.6]);
    return mesh;
  };

  // 1. Le bar Aéro Club « Chez Tonton Ka », LE repère de l'Entrée Moboma (l'auteur, 14/11 : « c'est la référence, c'est devant lui qu'il y a les
  //    wewa ») : long bâtiment jaune à soubassement vert, mur de tôle jaune, grande enseigne rouge sur jaune tournée vers le boulevard, terrasse
  //    (vidéo, 0:16–1:02) ; devant, entre lui et le boulevard, la grande place de terre des motos-taxis et de leurs chauffeurs, les kiosques
  //    rouges (vidéo, 4:16–6:08). Il occupe le coin entre l'Entrée Moboma et l'Avenue Maswa.
  {
    const mob = road('moboma'), mas = road('maswa');
    const zAt = (r, x) => {
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], c = r.pts[i];
        if ((a[0] - x) * (c[0] - x) <= 0 && a[0] !== c[0]) { const u = (x - a[0]) / (c[0] - a[0]), L = Math.hypot(c[0] - a[0], c[1] - a[1]); return { z: a[1] + (c[1] - a[1]) * u, ux: Math.abs((c[0] - a[0]) / L) }; }
      }
      return null;
    };
    const zTop = x => { const q = mob && zAt(mob, x); return q ? q.z - (mob.w / 2 + 2.6) / Math.max(0.3, q.ux) : null; };   // (Moboma, caniveau et accotement compris)
    const zBot = x => { const q = mas && zAt(mas, x); return q ? q.z + (mas.w / 2 + 1.4) / Math.max(0.3, q.ux) : null; };   // (Maswa, en terre)
    const xf = FRONT + 4.8, xb = xf + 6.5;                                // façade et fond du bar (écart à l'axe du boulevard)
    const tops = [zTop(-xf), zTop(-xb)], bots = [zBot(-xf), zBot(-xb)];
    if (tops.every(v => v !== null) && bots.every(v => v !== null)) {
      const top = Math.min(...tops), bot = Math.max(...bots), hz = (top - bot) / 2 - 0.3, zc = (top + bot) / 2;
      const o = { x: 0, z: zc, th: Math.PI };                             // (x local : vers l'intérieur ; la façade regarde le boulevard)
      const aero = t => () => mobText([[t, 1]], '#f5c400', '#d4141c', 1024, 128);
      if (hz < 4 || !site(o, xf, xb, hz, (F, S, Fd) => {
        const d = xb - xf, x = xf + d / 2, len = 2 * hz;
        F.box(d, 3.6, len, 0xf2c200, x, 1.8, 0).box(d + 0.06, 1.1, len + 0.06, 0x2e8b3a, x, 0.55, 0)
          .box(d + 0.6, 0.22, len + 0.6, 0x8c9196, x, 3.7, 0)
          .box(0.26, 1.3, len + 0.6, 0xf5c400, xf - 0.13, 4.45, 0).box(d + 0.6, 1.3, 0.26, 0xf5c400, x, 4.45, -hz - 0.43);
        for (let k = -len / 2 + 0.3; k < len / 2 - 0.2; k += 0.32) F.box(0.04, 2.4, 0.06, 0xd9a900, xf - 0.02, 2.3, k);   // la tôle ondulée jaune
        for (let k = 0; k < 4; k++) F.box(0.07, 2.3, 1.7, k === 1 ? 0x1d4fa0 : 0x22262b, xf - 0.06, 1.15, -len / 2 + 2 + k * (len - 4) / 3);
        F.box(2.6, 0.08, len - 0.6, pick(TIN), xf - 1.3, 3.0, 0, 0, 0, 0.1);                       // l'auvent de la terrasse
        for (let k = -len / 2 + 0.8; k <= len / 2 - 0.7; k += (len - 1.5) / 4) F.cyl(0.08, 0.08, 3.0, 0xf2f0e8, xf - 2.5, 1.5, k);
        S.add('mob_aero_a', aero('AÉRO CLUB CHEZ TONTON KA'), len - 0.8, 1.15, xf - 0.28, 4.45, 0, -Math.PI / 2, true);
        S.add('mob_aero_b', aero('TO ZO REGNER !'), d, 1.05, x, 4.45, -hz - 0.58, Math.PI, true);
        // la terrasse du bar : tables, chaises en plastique, parasols, clients
        for (let k = 0; k < 4; k++) {
          const tz = -len / 2 + 2.2 + k * (len - 4.4) / 3, tx = xf - 4.2;
          F.box(0.8, 0.75, 0.8, 0xf2f2f2, tx, 0.38, tz);
          for (const dz of [-0.75, 0.75]) F.box(0.45, 0.45, 0.45, pick([0xd62828, 0xf2f2f2, 0x1d5fbf]), tx, 0.22, tz + dz);
          if (k % 2 === 0) { const ux = Fd.X(tx, tz), uz = Fd.Z(tx, tz); mobUmbrella(md.at(uz), md.at(uz), ux, uz, true); }
          person(Fd, tx + 0.4, tz + 0.75, { sitting: true });
        }
        // les kiosques rouges (crédit, Airtel Money, M-Pesa) au bord de la place
        for (const [kz, t1, t2] of [[hz - 1.2, 'airtel', 'Money · Crédit · Cartes SIM'], [-hz + 1.2, 'M-PESA', 'Vodacom · Orange Money']]) {
          const kx = xf - 6.5;
          F.box(2.2, 2.4, 2.2, 0xe00000, kx, 1.2, kz).box(2.7, 0.16, 2.7, 0xb00000, kx, 2.48, kz).box(0.05, 0.9, 1.5, 0xf2f2f2, kx - 1.12, 1.5, kz);
          S.add(`mob_kiosk_${t1}`, () => signTexture(t1, t2, '#e40000', '#ffffff'), 2.1, 0.75, kx - 1.13, 2.15, kz, -Math.PI / 2, true);
          person(Fd, kx - 1.8, kz + 0.5, { kind: 'vendor' });
        }
      })) fails.push('Aéro Club (place trop petite)');
      grid.rect(o.x, o.z, o.th, ROAD_EDGE + 1, xf - 0.4, hz + 3, true);   // (la place des wewa reste libre)
      // les wewa : des rangées de motos-taxis, nez vers le boulevard, souvent avec leur chauffeur assis dessus ; d'autres chauffeurs debout
      const e = mob.entry, signZ = e ? e.z - (sideHalf(e) + 2.4) : null, umbZ = e ? e.z - (4.5 * Math.tan(e.ang * Math.PI / 180) + (e.w + 2) / 2 / Math.cos(e.ang * Math.PI / 180)) - 2.4 : null;
      let n = 0;
      for (const rx of [-(ROAD_EDGE + 2.7), -(ROAD_EDGE + 5.1), -(ROAD_EDGE + 7.5)]) {
        const zt = zTop(rx), zb = zBot(rx);
        if (zt === null || zb === null) continue;
        for (let z = zt - 1.3; z > zb + 1.3; z -= 1.2) {
          if (n >= 28 || chance(0.42)) continue;
          if (signZ !== null && Math.abs(z - signZ) < 1.6 && Math.abs(rx + ROAD_EDGE + 2.6) < 2.4) continue;
          if (umbZ !== null && Math.abs(z - umbZ) < 2.4 && Math.abs(rx + ROAD_EDGE + 4.5) < 2.4) continue;
          const m = createMoto({ riders: chance(0.4) ? 1 : 0 }), h = Math.PI / 2 + rand(-0.3, 0.3), x = rx + rand(-0.3, 0.3);
          place(m, x, z, h, 0);
          scene.add(m);
          obstBox(x, z, 0.9, 2.1, -h);
          n++;
        }
      }
      for (let k = 0; k < 12; k++) {
        const x = -(ROAD_EDGE + rand(2, 9)), z = rand(bot + 1, top - 1);
        bakeCharacter(md.at(z), outfit(chance(0.8) ? 'man' : 'woman'), 'idle', x, z, rand(0, 6.28), Math.random() * 10, true);
      }
    }
  }
  // 2. Après Saint-Marc, la rue qui descend vers le poste de police : contre le mur bleu de l'ITP, le vieux minibus jaune abandonné et un camion
  //    (vidéo, 8:04–8:20) ; flaques et boue sur le goudron défoncé, ici et sur le macadam de Saint-Marc (7:04–7:16). Passio est en face (après Saint-Marc).
  {
    const kb = road('kimpioka_bas');
    if (kb) for (const [t, make, wreck] of [[9, () => createMinibus({ color: 0xc9b23a, apprenti: false }), true], [25.5, () => createTruck(), false]]) {
      const P = roadSide(kb, t, -1), F = frame(MC.at(P.z, P.x), P.x, P.z, P.th), m = park(make(), F, kb.w / 2 + 0.9, 0, rand(-0.04, 0.04));
      grid.rect(P.x, P.z, P.th, kb.w / 2, kb.w / 2 + 1.5, 4.4, true);
      if (wreck) { m.rotation.z = 0.06; m.position.y = -0.12; }            // (le vieux bus abandonné, affaissé)
    }
    for (const [key, t0, t1] of [['bas', 4, 56], ['kimpioka_bas', 3, 50]]) {
      const r = road(key);
      if (r) for (let t = t0; t < t1; t += rand(3, 6)) {
        const P = roadAlong(r, t), off = rand(-r.w / 2 + 1, r.w / 2 - 1), x = P.x + P.uz * off, z = P.z - P.ux * off, b = MC.at(z, x);
        b.box(rand(1.5, 3.5), 0.012, rand(1.2, 3), chance(0.5) ? 0x5d6b6e : 0x7a5f3e, x, 0.05, z, 0, rand(0, 3.14), 0);
      }
    }
  }

  // 3. L'ITP Passio (croquis carte_corrigee : au sud du virage, en diagonale de Saint-Marc, le long de la rue qui descend vers le poste de police ;
  //    photo « devant de l'ITP Passio » ; vidéo, 8:20–9:00) ; au bout de la rue, le poste de police
  spot('ITP Passio', 'kimpioka_bas', 4, 30, -1, 14, (F, S, Fd, I) => {
    // (l'auteur, 14/11 : « l'ITP, celui qui est en diagonale de Saint-Marc, c'est juste un seul bâtiment, pas deux » ; photo « devant de l'ITP Passio »,
    // vidéo 8:36–9:00) : au coin, du côté de Saint-Marc, le bâtiment : rez-de-chaussée peint en bleu vif sur un soubassement gris et ses inscriptions,
    // étage en briques brutes, inachevé, ses baies sans fenêtres et les fers en attente ; à côté, le portail vert-bleu, puis le mur bleu au logo des
    // Passionistes et à l'inscription rouge ; derrière le mur, la cour et le grand arbre
    const f = I.f, hz = I.hz, BLUE = 0x2f8fd8, GREY = 0x9b9a92, BRICK = 0x9a5b3c, gate = 4.2, gz = -hz * 0.1, g0 = gz - gate / 2, g1 = gz + gate / 2;
    const bl = hz - g1 - 0.45, bz = (g1 + 0.45 + hz) / 2, bd = 11;
    F.box(bd, 1.0, bl, GREY, f + bd / 2, 0.5, bz).box(bd, 2.3, bl, BLUE, f + bd / 2, 2.15, bz)
      .box(bd + 0.2, 0.14, bl + 0.2, 0x8a8982, f + bd / 2, 3.37, bz).box(bd, 3.0, bl, BRICK, f + bd / 2, 4.94, bz);
    for (let k = -bl / 2 + 1.4; k < bl / 2 - 0.8; k += 2.8) F.box(0.1, 1.3, 1.3, 0x1b1f24, f - 0.04, 5.0, bz + k);   // les baies de l'étage
    for (let k = -bl / 2 + 2.2; k < bl / 2 - 1; k += 3.6) F.box(0.08, 1.2, 1.3, 0x24303c, f - 0.03, 1.95, bz + k);  // les fenêtres grillagées
    for (let k = 0; k < 8; k++) F.box(0.04, 1.0, 0.04, 0x5a4a3a, f + 0.4 + (k % 4) * 3.4, 6.95, bz + (k < 4 ? -bl / 2 + 0.4 : bl / 2 - 0.4));   // les fers
    S.add('mob_claustra', claustraTexture, 1.4, 1.6, f - 0.05, 1.95, g1 + 1.4, -Math.PI / 2);
    S.add('mob_itp_d', () => mobText([['INSTITUT TECHNIQUE ET PROFESSIONNEL PASSIO', 1], ['ÉCOLE CONVENTIONNÉE CATHOLIQUE', 0.7], ['ÉLECTRICITÉ · PÉTROCHIMIE · COMMERCIALE · MÉCANIQUE GÉNÉRALE', 0.7]], '#2f8fd8', '#ffffff', 1024, 256),
      Math.min(9, bl - 3.4), 1.35, f - 0.05, 2.25, bz + 1.2, -Math.PI / 2, true);
    // le mur bleu de l'autre côté du portail, le logo, l'inscription rouge ; les murs de la cour
    const wl = g0 + hz, wz = (-hz + g0) / 2;
    F.box(0.3, 1.0, wl, GREY, f + 0.15, 0.5, wz).box(0.26, 1.6, wl, BLUE, f + 0.15, 1.8, wz).box(0.32, 0.12, wl, 0x7d7c75, f + 0.15, 2.66, wz);
    F.box(14, 2.6, 0.25, GREY, f + 7, 1.3, -hz).box(14 - bd, 2.6, 0.25, GREY, f + bd + (14 - bd) / 2, 1.3, hz).box(0.25, 2.6, 2 * hz, GREY, f + 14, 1.3, 0);
    F.box(0.5, 2.9, 0.5, GREY, f + 0.2, 1.45, g0 - 0.25).box(0.5, 2.9, 0.5, GREY, f + 0.2, 1.45, g1 + 0.25);
    F.box(0.1, 2.5, gate / 2 - 0.05, 0x1f8a7a, f + 0.22, 1.25, gz - gate / 4).box(0.1, 2.5, gate / 2 - 0.05, 0x1f8a7a, f + 0.22, 1.25, gz + gate / 4)
      .box(0.12, 1.9, 0.8, 0x177066, f + 0.16, 0.95, gz - gate / 4);
    S.add('mob_logo_passio', mobLogo, 1.2, 1.6, f - 0.03, 1.7, g0 - 1.2, -Math.PI / 2, true);
    const wt = Math.min(6, wl - 3.4);
    S.add('mob_itp_g', () => mobText([['MINISTÈRE DE L’EPSP', 0.7], ['ÉCOLE CONVENTIONNÉE CATHOLIQUE', 0.9], ['I.T.P. PASSIO', 1.3]], '#2f8fd8', '#d4141c', 1024, 300), wt, 1.35, f - 0.03, 1.85, g0 - 2.4 - wt / 2, -Math.PI / 2, true);
    F.cyl(0.3, 0.45, 4, 0x5d4330, f + 7, 2, g0 - 3.5).ball(4.5, 0x3f7d2c, f + 7, 6.2, g0 - 3.5, 1.4, 0.6, 1.4);   // le grand arbre de la cour
    crowd(Fd, 4, f - 1.5, f - 0.5, -hz + 2, hz - 2, 'student');
  });
  spot('Poste de police', 'kimpioka_bas', 36, 50, 1, 9, (F, S, Fd, I) => {
    const f = I.f, x = f + 2.6;
    F.box(5, 3.1, 7, 0xf2f2f2, x + 2.5, 1.55, 0).box(5.06, 0.9, 7.06, 0x1d4fa0, x + 2.5, 0.45, 0).box(5.6, 0.22, 7.6, 0x1d4fa0, x + 2.5, 3.2, 0)
      .box(0.08, 2.1, 1.2, 0x1d4fa0, x - 0.04, 1.05, 1.5).box(0.08, 1.1, 1.4, 0x24303c, x - 0.04, 1.8, -1.6);
    S.add('mob_police', () => signTexture('POLICE NATIONALE CONGOLAISE', 'Sous-commissariat de Kingasani', '#1d4fa0', '#f5c400'), 6.4, 1.1, x - 0.06, 2.55, 0, -Math.PI / 2, true);
    park(createPolicePickup(), F, f + 1.1, -4.6, 0);
    for (let k = 0; k < 2; k++) bakeCharacter(md.at(Fd.Z(f - 0.6, 3 + k)), outfit('police'), 'idle', Fd.X(f - 0.6, 3 + k), Fd.Z(f - 0.6, 3 + k), rand(0, 6.28), Math.random() * 10, true);
  });

  // 4. L'Église Saint-Marc, au coin du macadam du bas et de la Rue Kimpioka (vidéo, 9:04–10:24) : grande place de sable, clocher carré en béton
  //    surmonté d'une croix, bâtiment de la paroisse à l'enseigne « ARCHIDIOCÈSE DE KINSHASA · PAROISSE SAINT MARC », église derrière ;
  //    le long de Kimpioka, la cure blanche à deux niveaux derrière son mur blanc
  spot('Saint-Marc', 'kimpioka', 4, 26, -1, 44, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz;
    F.box(21, 0.03, 2 * hz, 0xd9c9a6, f + 10.5, 0.02, 0);                   // la place, sable clair
    const tx = f + 18, tz = I.lz(7);                                         // le clocher, côté ITP
    F.box(2.8, 19, 2.8, 0x9c9b94, tx, 9.5, tz).box(3.2, 0.3, 3.2, 0x8a8982, tx, 19.1, tz);
    for (const [ox, oz] of [[-1.42, 0], [1.42, 0], [0, -1.42], [0, 1.42]]) F.box(ox ? 0.06 : 1.2, 2.2, oz ? 0.06 : 1.2, 0x2a2c30, tx + ox, 16.6, tz + oz);
    F.box(0.22, 3.2, 0.22, 0xe8e8e8, tx, 20.8, tz).box(0.22, 0.22, 1.6, 0xe8e8e8, tx, 21.6, tz).box(1.6, 0.22, 0.22, 0xe8e8e8, tx, 21.6, tz);
    // le bâtiment de la paroisse, au fond de la place, son enseigne tournée vers la place
    const bx = f + 23, len = 2 * hz - 2;
    F.box(6, 3.6, len, 0xf2f0ea, bx + 3, 1.8, 0).box(6.06, 0.8, len + 0.06, 0x8c9196, bx + 3, 0.4, 0);
    mobGable(F, bx + 3, 6, len, 3.6, 0xb03a2e);
    S.add('mob_stmarc', () => mobText([['ARCHIDIOCÈSE DE KINSHASA', 1], ['PAROISSE SAINT MARC', 1]], '#ffffff', '#c8102e', 1024, 256), 12, 2.4, bx - 0.03, 2.5, 0, -Math.PI / 2, true);
    // l'église, derrière : grande nef blanche, toit rouge, croix sur le pignon
    const cx = f + 31, cl = Math.min(len, 22);
    F.box(12, 7.5, cl, 0xf4efe4, cx + 6, 3.75, 0).box(12.06, 0.9, cl + 0.06, 0xc9b98f, cx + 6, 0.45, 0);
    mobGable(F, cx + 6, 12, cl, 7.5, 0x9c3b2b, 0, 0.42);
    F.box(0.25, 2.6, 0.25, 0xf5c400, cx + 6, 12.6, -cl / 2 - 0.2).box(0.25, 0.25, 1.4, 0xf5c400, cx + 6, 13.1, -cl / 2 - 0.2);
    crowd(Fd, 14, f + 1, f + 19, -hz + 1, hz - 1);
  });
  // le Groupe Scolaire Passio et la Congrégation des Passionistes (l'auteur, 14/11 : « le groupe scolaire Passio, c'est à gauche, côté Saint-Marc ; après ça
  // vient Saint-Marc » ; croquis : « ITPPASSIO » de ce côté-là de la rue ; vidéo, 7:16–7:52) : en face de l'ITP, juste après Saint-Marc ; le long mur
  // blanc et bleu, ses grands logos, ses inscriptions, les parasols des vendeuses devant, un taxi jaune garé ; l'école derrière
  spot('Groupe scolaire Passio', 'kimpioka_bas', 16.5, 34.5, 1, 9.5, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz, len = 2 * hz;
    mobCompound(F, f, f + 9.5, hz, 0xe4e9ef, 0x8fa7c4, 3.2, hz - 2.2, 2.8);
    F.box(0.27, 0.9, hz - 3.8 + hz, 0x8fa7c4, f + 0.12, 0.45, (-hz + hz - 3.8) / 2);
    S.add('mob_logo_passio', mobLogo, 1.6, 2.1, f - 0.03, 1.55, -hz + 1.1, -Math.PI / 2, true);
    S.add('mob_passio_cong', () => mobText([['CONGRÉGATION DES PASSIONISTES', 1.2], ['1920 – 2023 · 103 ANS D’EXISTENCE', 0.8]], '#e4e9ef', '#b3261e', 1024, 192), 5.6, 1.4, f - 0.03, 1.6, -hz + 5, -Math.PI / 2, true);
    S.add('mob_logo_passio', mobLogo, 1.6, 2.1, f - 0.03, 1.55, -hz + 9.1, -Math.PI / 2, true);
    S.add('mob_passio_gs', () => mobText([['ARCHIDIOCÈSE DE KINSHASA', 0.6], ['ÉCOLE PRIVÉE AGRÉÉE · GROUPE SCOLAIRE', 0.7], ['G.S. PASSIO', 1.3], ['TRAVAIL ET EXCELLENCE', 0.6]], '#ffffff', '#1d3f8f', 1024, 320), 3.4, 1.8, f - 0.03, 1.6, -hz + 12.2, -Math.PI / 2, true);
    mobBlock(F, f + 3.2, 6, len - 2, 0, 0xf2efe8, 0x2b63c4, 0x8c9196, 2);
    for (let k = 0; k < 3; k++) { const z0 = -hz + 2 + k * 3.6, ux = Fd.X(f - 1.2, z0), uz = Fd.Z(f - 1.2, z0); mobUmbrella(md.at(uz), md.at(uz), ux, uz); }
    park(createHatchback({ taxi: true }), F, f - 1.6, hz - 6, 0);
    crowd(Fd, 3, f - 1.8, f - 0.6, -hz + 1, hz - 7);
  });
  // La Rue Kimpioka, côté Saint-Marc (l'auteur, 14/11) : une seule longue clôture grise, de Saint-Marc jusqu'à l'EP 12 (le long mur du début de la
  // vidéo « direction Mobutu »), avec ses portes. Dans l'ordre : l'École Cosma, dans la même clôture que l'église ; le centre pastoral, juste en face
  // de la Direction centre pastoral ; le Centre Hospitalier de Kingasani, en face de la Rue Ma Sœur, et sa petite porte 10 m plus loin ; la clôture
  // continue jusqu'à la Rue de la Commune : l'E.P. Elikya et, à l'intérieur, le Lycée de Kingasani ; 20 m plus loin le couvent des Passionistes,
  // 10 m plus loin l'EP 12. Les bâtiments sont à l'intérieur ; la clôture et ses portes viennent après (mobEnclosure).
  const kim = road('kimpioka'), endOn = key => { const r = road(key); return r && kim ? roadArc(kim, r.pts.at(-1)) : null; };
  const tA = endOn('milieu') ?? 49, tMS = endOn('masoeur') ?? 97, tCo = endOn('commune') ?? 137;
  const KGATES = [];
  spot('École Cosma', 'kimpioka', 28, 41.5, -1, 30, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz;
    F.box(14, 0.025, 2 * hz - 0.6, 0xd9c08e, f + 7.5, 0.015, 0);                                  // la cour
    mobBlock(F, f + 14.5, 6.5, 2 * hz - 1.5, 0, 0xf5f0e0, 0x1d5fbf, 0x8c9196, 2);                    // les classes, deux niveaux, au fond de la cour
    S.add('mob_cosma_b', () => signTexture('ÉCOLE COSMA', 'Maternelle · Primaire · Secondaire', '#1d5fbf', '#ffffff'), 6, 1.1, f + 14.45, 3.7, 0, -Math.PI / 2, true);
    crowd(Fd, 8, f + 2, f + 13, -hz + 1.5, hz - 1.5, 'student');
    // la cure : la maison blanche à deux niveaux, derrière l'école, dans la même clôture que l'église (vidéo, 9:14–9:56)
    const x = f + 22.5, d = 7, len = 2 * hz - 2;
    F.box(d, 6.4, len, 0xf7f7f3, x + d / 2, 3.2, 0).box(d + 0.5, 0.25, len + 0.5, 0xb03a2e, x + d / 2, 3.3, 0);
    mobGable(F, x + d / 2, d, len, 6.4, 0xb03a2e, 0, 0.22);
    for (let k = -len / 2 + 1.5; k < len / 2 - 0.5; k += 2.6) for (const y of [1.8, 4.9]) F.box(0.08, 1.2, 1.1, 0x2a3540, x - 0.04, y, k);
  });
  KGATES.push({ t: 34.75, w: 3.4, col: 0x1d5fbf, sign: ['ÉCOLE COSMA', 'Maternelle · Primaire · Secondaire', '#1d5fbf', '#ffffff'] });
  spot('Centre pastoral', 'kimpioka', tA - 6, tA + 6, -1, 14, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz;
    F.box(4, 0.025, 2 * hz - 0.6, 0xd9c9a6, f + 2, 0.015, 0);
    mobBlock(F, f + 4.5, 8, 2 * hz - 1.5, 0, 0xf2efe8, 0x2b63c4, 0x8a4b2a, 2);
    crowd(Fd, 3, f + 1, f + 4, -hz + 1.5, hz - 1.5);
  });
  KGATES.push({ t: tA, w: 4, col: 0x2b63c4, sign: ['CENTRE PASTORAL SAINT-MARC', 'Paroisse Saint-Marc · Kingasani', '#2b63c4', '#ffffff'] });
  spot('Centre Hospitalier de Kingasani', 'kimpioka', tA + 8, tCo - 30, -1, 34, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz, gz = I.lz(tMS);                                                     // (l'entrée principale, en face de la Rue Ma Sœur)
    F.box(14, 0.025, 2 * hz - 0.6, 0xd9c9a6, f + 7, 0.015, 0);
    const mx = f + 9;
    mobBlock(F, mx, 9, 24, gz, 0xf7f9fc, 0x0b7285, 0xb03a2e, 2);                                    // le bâtiment principal, face au portail
    F.box(0.2, 2.2, 0.65, 0xd62828, mx - 0.12, 5.3, gz).box(0.2, 0.65, 2.2, 0xd62828, mx - 0.12, 5.3, gz);
    S.add('mob_chk_b', () => mobText([['C.H.K.', 1.1], ['CENTRE HOSPITALIER DE KINGASANI', 0.9]], '#ffffff', '#0b7285', 1024, 220), 9, 1.4, mx - 0.13, 3.75, gz + 6.5, -Math.PI / 2, true);
    for (const z of [-hz + 7, -hz / 3, hz / 3, hz - 7]) {                                          // les pavillons, toits de tôle rouge
      if (Math.abs(z - gz) < 15) continue;
      F.box(16, 3.2, 6, 0xf7f3e8, f + 26, 1.6, z).box(16.06, 0.9, 6.06, 0x0b7285, f + 26, 0.45, z);
      F.box(16.6, 0.12, 3.6, 0xb03a2e, f + 26, 3.7, z - 1.6, 0.25, 0, 0).box(16.6, 0.12, 3.6, 0xb03a2e, f + 26, 3.7, z + 1.6, -0.25, 0, 0);
    }
    park(createAmbulance(), F, f + 4.5, gz + 6, 0);
    for (let k = 0; k < 12; k++) person(Fd, f + rand(1.2, 8), rand(-hz + 2, hz - 2), { sitting: chance(0.5) });
  });
  KGATES.push({ t: tMS, w: 6, col: 0x0b7285, pillar: 0x0b7285, lintel: 0x0b7285, open: true, sign: ['C.H.K.', 'Centre Hospitalier de Kingasani', '#0b7285', '#ffffff'], panel: chkPanel, panelW: 5.5 });
  KGATES.push({ t: tMS + 5, w: 1.4, col: 0x0b7285, small: true });                                 // (la petite porte, 10 m plus loin)
  // le Lycée de Kingasani 2 et l'E.P. Elikya de Kingasani 2 : la grande allée qui prolonge la Rue de la Commune, les deux cours, la place du fond
  if (MOB_LYC) addLycee({ site, grid, MC, md, scene, fails });
  KGATES.push({ t: tCo, w: 8, col: 0x8a9096, pillar: 0x8e8e8a, open: true, plaque: ['LYCÉE DE KINGASANI 2', 'E.P. Elikya de Kingasani 2 · École conventionnée catholique'] });
  spot('Couvent des Passionistes', 'kimpioka', tCo + 18, tCo + 25.5, -1, 12, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz, len = 2 * hz - 1;
    F.box(3, 0.025, len, 0xd9c9a6, f + 1.5, 0.015, 0);
    F.box(8, 6.4, len, 0xf2ece1, f + 7, 3.2, 0).box(8.06, 0.9, len + 0.06, 0x8a6a4a, f + 7, 0.45, 0);
    mobGable(F, f + 7, 8, len, 6.4, 0x8a4b2a, 0, 0.3);
    for (let k = -len / 2 + 1.2; k < len / 2 - 0.5; k += 2.2) for (const y of [1.8, 4.9]) F.box(0.08, 1.1, 0.9, 0x2a3540, f + 2.96, y, k);
    S.add('mob_logo_passio', mobLogo, 1.2, 1.6, f + 2.95, 4.6, 0, -Math.PI / 2, true);
    F.box(0.2, 1.6, 0.2, 0xf5c400, f + 7, 9.0, 0).box(0.2, 0.2, 0.9, 0xf5c400, f + 7, 9.3, 0);       // la croix sur le faîte
  });
  KGATES.push({ t: tCo + 20, w: 3, col: 0x5a3a22, logo: true, sign: ['COUVENT DES PASSIONISTES', 'Pères Passionistes · Kingasani', '#5a3a22', '#ffffff'] });
  spot('EP 12', 'kimpioka', tCo + 27, tCo + 42.5, -1, 12, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz;
    F.box(4, 0.025, 2 * hz - 0.6, 0xd9c08e, f + 2, 0.015, 0);
    mobBlock(F, f + 5, 6.5, 2 * hz - 3, 0.5, 0xf5c400, 0x1d4fa0, 0x8c9196, 1);
    crowd(Fd, 5, f + 1, f + 4, -hz + 2, hz - 2, 'student');
  });
  KGATES.push({ t: tCo + 30, w: 3.4, col: 0x1d4fa0, sign: ['E.P. 12 KINGASANI', 'École primaire · Ministère de l’EPSP', '#1d4fa0', '#f5c400'] });
  // la clôture elle-même, de la place Saint-Marc jusqu'à l'EP 12 (le long de l'école : mur bas et grillage)
  mobEnclosure({ MC, signs, grid, road }, 'kimpioka', -1, 26.2, tCo + 42.5, KGATES, [tCo - 29, tCo + 17]);

  // en face de l'École Cosma : la salle Atandele, salle de fête et d'événements à deux niveaux (l'auteur, 14/11)
  spot('Salle Atandele', 'kimpioka', 27, 41, 1, 7.8, (F, S, Fd, I) => {
    const f = I.f, len = 2 * I.hz, x = f + 0.6, d = 6.8;
    F.box(d, 7.2, len, 0xf3ead8, x + d / 2, 3.6, 0).box(d + 0.06, 1.0, len + 0.06, 0x6a1b9a, x + d / 2, 0.5, 0)
      .box(d + 0.4, 0.3, len + 0.4, 0xd4af37, x + d / 2, 7.35, 0);
    F.box(1.6, 0.2, len - 1, 0xe8e2d0, x - 0.8, 3.7, 0).box(0.08, 1.0, len - 1, 0x2a2a2a, x - 1.55, 4.3, 0);   // le balcon de l'étage
    F.box(0.08, 2.6, 4, 0x1c2b3a, x - 0.03, 1.3, 0);                                                          // la grande porte vitrée
    for (let k = -len / 2 + 1.5; k < len / 2 - 1; k += 2.5) F.box(0.08, 1.6, 1.4, 0x1c2b3a, x - 0.03, 5.2, k);
    S.add('mob_atandele', () => mobText([['SALLE ATANDELE', 1.2], ['Salle de fête · Événements · Réceptions', 0.8]], '#6a1b9a', '#f5c400', 1024, 220), Math.min(9, len - 1), 1.6, x - 0.06, 6.3, 0, -Math.PI / 2, true);
    crowd(Fd, 4, f - 1.5, f - 0.4, -len / 2 + 1, len / 2 - 1);
  });
  // le home des vieillards, en face (« Homme et Vieard » sur le croquis, entre l'avenue et la Rue Ma Sœur)
  spot('Home des vieillards', 'kimpioka', 56, 90, 1, 7.8, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz;
    mobCompound(F, f, f + 7.8, hz, 0xe8dcc0, 0x8a4b2a, 3, -hz / 3, 2.1);
    S.add('mob_home', () => signTexture('HOME DES VIEILLARDS', 'Kingasani · Maison de retraite', '#2f6f3e', '#ffffff'), 5.5, 1.2, f - 0.03, 1.3, hz / 3, -Math.PI / 2, true);
    const x = f + 3.0, len = 2 * hz - 3;
    F.box(4.4, 3.0, len, 0xf0e2b6, x + 2.2, 1.5, 0).box(2.0, 0.1, len, pick(TIN), x - 1, 2.7, 0, 0, 0, 0.12);
    mobGable(F, x + 2.2, 4.4, len, 3.0, 0x8a4b2a);
    for (let k = -len / 2 + 1; k < len / 2; k += 4) F.cyl(0.07, 0.07, 2.7, 0x6b5a4a, x - 1.9, 1.35, k);
    for (let k = 0; k < 7; k++) person(Fd, x - rand(0.6, 1.6), rand(-len / 2 + 1, len / 2 - 1), { sitting: true });
  });

  // 7. Le dispensaire, sur la Rue Ma Sœur côté Rue Kabila, au coin de Moboma (croquis : « Dispensaire simple »)
  spot('Dispensaire', 'masoeur', 84.5, 91.2, 1, 8, (F, S, Fd, I) => {
    const f = I.f, len = 2 * I.hz;
    F.box(6, 3.2, len, 0xf7f9fb, f + 3, 1.6, 0).box(6.06, 0.8, len + 0.06, 0x1d5fbf, f + 3, 0.4, 0).box(6.5, 0.22, len + 0.5, 0x1d5fbf, f + 3, 3.3, 0)
      .box(0.08, 2.1, 1.2, 0x1d5fbf, f - 0.04, 1.05, -1.2).box(0.2, 1.4, 0.45, 0xd62828, f - 0.1, 2.4, 1.6).box(0.2, 0.45, 1.4, 0xd62828, f - 0.1, 2.4, 1.6);
    S.add('mob_dispensaire', () => signTexture('DISPENSAIRE', 'Soins de santé primaires', '#ffffff', '#1d5fbf'), Math.min(5.2, len - 0.4), 0.9, f - 0.12, 3.0, 0, -Math.PI / 2, true);
    person(Fd, f - 0.8, 0.5, { sitting: true });
  });

  // 8. En haut de Moboma, vers la Rue Kabila (vidéo « direction Mobutu », 0:32–2:52) : la vieille FANFARE ocre au toit de tuiles, le bâtiment
  //    à balcon et ses boutiques de vêtements, les kiosques rouges Airtel Money et « ANGE APPEL », les parasols du marché
  spot('Fanfare', 'moboma', MOB_LEN - 43.5, MOB_LEN - 20.5, 1, 11, (F, S, Fd, I) => {
    const f = I.f, len = 2 * I.hz, x = f + 5.5;
    F.box(11, 5.2, len, 0xd8a24a, x, 2.6, 0).box(11.06, 0.8, len + 0.06, 0xa8743a, x, 0.4, 0);
    mobGable(F, x, 11, len, 5.2, 0x9c4a2e, 0, 0.36);
    for (let k = -len / 2 + 2; k < len / 2 - 1; k += 3.2) F.box(0.08, 1.0, 1.2, 0x2a2420, f - 0.04, 3.6, k).box(0.08, 2.3, 1.5, k % 2 > 0 ? 0x6b3a22 : 0x3a2a1e, f - 0.04, 1.15, k + 1.4);
    S.add('mob_fanfare', () => mobText([['FANFARE', 1]], '#d8a24a', '#7a3a24', 1024, 160, 'Georgia, "Times New Roman", serif'), 7, 1.1, f - 0.06, 4.3, -len / 4, -Math.PI / 2, true);
    for (let k = 0; k < 4; k++) { const ux = Fd.X(f - 1.3, -len / 2 + 2.5 + k * 6), uz = Fd.Z(f - 1.3, -len / 2 + 2.5 + k * 6); mobUmbrella(md.at(uz), md.at(uz), ux, uz); }
    crowd(Fd, 10, f - 1.8, f - 0.4, -len / 2 + 1, len / 2 - 1);
  });
  spot('Bâtiment à balcon', 'moboma', MOB_LEN - 42.9, MOB_LEN - 9.5, -1, 9, (F, S, Fd, I) => {
    const f = I.f, len = 2 * I.hz, x = f + 4.5;
    F.box(9, 6.6, len, 0xd9c08a, x, 3.3, 0).box(9.4, 0.25, len + 0.4, 0xb8a272, x, 6.7, 0);
    F.box(1.6, 0.22, len, 0xc9b27e, f - 0.8, 3.4, 0).box(0.2, 1.0, len, 0xd9c08a, f - 1.55, 4.0, 0);   // balcon et son parapet
    for (let k = -len / 2 + 1.6; k < len / 2; k += 2.2) F.box(0.25, 0.8, 0.25, 0xd9c08a, f - 1.55, 4.9, k).box(0.08, 1.4, 1.2, 0x2a3540, f - 0.04, 5.0, k + 1.1);
    for (let k = -len / 2 + 1.5; k < len / 2 - 1; k += 3.0) {                 // boutiques de vêtements au rez-de-chaussée
      F.box(0.08, 2.4, 2.4, pick(GATES), f - 0.02, 1.2, k + 1.2);
      for (let i = 0; i < 5; i++) F.box(0.05, rand(0.9, 1.3), 0.45, pick([0xd62828, 0x1d5fbf, 0xf5c400, 0xffffff, 0x2a9d4b, 0xe07bb5, 0x6a1b9a]), f - 0.35, 2.0, k + 0.3 + i * 0.5);
    }
    crowd(Fd, 8, f - 1.6, f - 0.3, -len / 2 + 1, len / 2 - 1);
  });
  spot('Kiosques du marché', 'moboma', MOB_LEN - 48.5, MOB_LEN - 43.9, -1, 3, (F, S, Fd, I) => {
    const f = I.f;
    F.box(1.9, 2.4, 1.9, 0xe00000, f + 1.1, 1.2, -1.2).box(2.3, 0.16, 2.3, 0xb00000, f + 1.1, 2.48, -1.2)
      .box(1.9, 2.3, 1.9, 0x2a9d4b, f + 1.1, 1.15, 1.3).box(2.3, 0.16, 2.3, 0xf28c28, f + 1.1, 2.4, 1.3);
    S.add('mob_airtel_m', () => signTexture('airtel', 'Money', '#e40000', '#ffffff'), 1.8, 0.7, f + 0.12, 2.0, -1.2, -Math.PI / 2, true);
    S.add('mob_ange', () => signTexture('ANGE APPEL', 'M-Pesa · Orange Money', '#ffffff', '#c8102e'), 1.8, 0.7, f + 0.12, 1.9, 1.3, -Math.PI / 2, true);
    person(Fd, f - 0.7, -1.2, { kind: 'vendor' });
  });
  {
    const r = road('moboma');
    for (let t = MOB_LEN - 92.5; t < MOB_LEN - 4; t += rand(5, 9)) {          // parasols du marché sur les accotements
      const e = chance(0.5) ? 1 : -1, P = roadSide(r, t, e), F = frame(MC.at(P.z, P.x), P.x, P.z, P.th), x = r.w / 2 + 1.6;
      if (MOB_ROADS.some(q => q !== r && q.pts.slice(1).some((p, i) => segDist(F.X(x, 0), F.Z(x, 0), q.pts[i], p) < q.w / 2 + 2.5))) continue;
      mobUmbrella(md.at(P.z), md.at(P.z), F.X(x, 0), F.Z(x, 0));
    }
  }

  // 9. Les petits établissements d'OSM, à leur place le long des rues
  const smallSchool = (name, sub, key, t0, t1, e, col = 0x1d4fa0, depth = 12) => spot(name, key, t0, t1, e, depth, (F, S, Fd, I) => {
    const f = I.f, hz = I.hz;
    mobCompound(F, f, f + depth, hz, 0xf2efe8, col, 3, -hz / 2, 2.2);
    S.add(`mob_s_${name}`, () => signTexture(name, sub, `#${col.toString(16).padStart(6, '0')}`, '#ffffff'), Math.min(5.4, hz * 1.2), 1.1, f - 0.03, 1.3, hz / 3, -Math.PI / 2, true);
    mobBlock(F, f + depth - 7, 6, 2 * hz - 2.5, 0, pick([0xf5c400, 0xf2efe8, 0x9fc3e6]), col, 0x8c9196, 1);
    crowd(Fd, 3, f + 1.5, f + depth - 8, -hz + 1.5, hz - 1.5, 'student');
  });
  smallSchool('COLLÈGE ROYAL', 'Kingasani', 'g1', 6.5, 20, 1, 0x6a1b9a, 11);
  smallSchool('COLLÈGE DÉPART', 'Kingasani', 'masoeur', 26, 37, -1, 0x2f6f3e);
  smallSchool('COLLÈGE SAINT-PLACIDE', 'Kingasani', 'kabila', 106, 121, -1, 0x7a1f1f);
  smallSchool('C.P.K. ÉCOLE PUBLIQUE', 'Kingasani', 'ndona', 212, 230, 1, 0x1d4fa0);
  spot('Église Mont Horeb', 'masoeur', 84.4, 90.2, -1, 12, (F, S, Fd, I) => {
    const f = I.f, len = 2 * I.hz;
    F.box(10, 4.6, len, 0xf2ece1, f + 5.5, 2.3, 0);
    mobGable(F, f + 5.5, 10, len, 4.6, 0x2f6b45);
    F.box(0.2, 2.0, 0.2, 0xf5c400, f + 0.4, 5.6, 0).box(0.2, 0.2, 1.1, 0xf5c400, f + 0.4, 6.0, 0);
    S.add('mob_horeb', () => signTexture('ÉGLISE MONT HOREB', 'Culte : dimanche 8 h · mercredi 17 h', '#7b2cbf', '#ffffff'), Math.min(6, len - 0.6), 1.1, f + 0.47, 3.4, 0, -Math.PI / 2, true);
  });
  spot('Chez Ma Maguy', 'maswa', 42, 54, -1, 9, (F, S, Fd, I) => {
    const f = I.f, len = 2 * I.hz;
    F.box(5, 3.0, len * 0.6, 0x7fb3c8, f + 6, 1.5, len * 0.2);
    F.box(5.5, 0.12, len * 0.65, pick(TIN), f + 6, 3.25, len * 0.2, 0, 0, -0.1);
    S.add('mob_maguy', () => signTexture('CHEZ MA MAGUY', 'Bar · Terrasse · Grillades', '#1a1d20', '#f5c400'), Math.min(5, len * 0.55), 0.9, f + 3.45, 2.5, len * 0.2, -Math.PI / 2, true);
    for (let k = 0; k < 3; k++) {
      const z = -len / 2 + 2 + k * 2.6;
      { const ux = Fd.X(f + 1.8, z), uz = Fd.Z(f + 1.8, z); mobUmbrella(md.at(uz), md.at(uz), ux, uz, false); }
      for (const dz of [-0.7, 0.7]) Fd.box(0.45, 0.45, 0.45, pick([0xd62828, 0xffffff, 0x1d5fbf]), f + 2.6, 0.22, z + dz);
      person(Fd, f + 2.6, z + 0.7, { sitting: true });
    }
  });
  spot('Djiboa Dia Ditumba', 'maswa', 56, 64, -1, 9, (F, S, Fd, I) => {
    const f = I.f, len = 2 * I.hz;
    addMasinaPlot(F, S, f, len, 8, 'gabled_shop');
    S.add('mob_djiboa', () => signTexture('DJIBOA DIA DITUMBA', 'Alimentation · Divers', '#c8102e', '#ffffff'), Math.min(5, len - 1), 0.9, f - 0.05, 3.5, 0, -Math.PI / 2, true);
  });
  // le long de la Rue Kabila, avant Moboma : longs murs d'enceinte gris (début de la vidéo « direction Mobutu »)
  spot('Murs de la Rue Kabila', 'kabila', 96, 104, 1, 14, (F, S, Fd, I) => {
    mobCompound(F, I.f, I.f + 14, I.hz, 0xb9b6ac, 0x9e9a90, 3, I.hz / 2, 2.5);
    { const mx = Fd.X(I.f + 7, 0), mzz = Fd.Z(I.f + 7, 0); addMango(md.at(mzz), mx, mzz); }
  });
  return fails;
}

/** Le cœur des îlots et les abords du quartier : petites maisons serrées (cour, mur, tôle, quelques immeubles inachevés, manguiers),
 *  chacune tournée vers la rue la plus proche ; la grille d'occupation évite les rues, les repères et les parcelles déjà posées. */
function addMobomaFill({ grid, MC, signs }) {
  // deuxième rangée : petites maisons et parcelles derrière celles de la rue, tournées vers elle
  const plain = () => pick(['parcel', 'house', 'house', 'parcel', 'unfinished']);
  for (const r of MOB_ROADS) {
    if (r.noPlots) continue;
    const f2 = r.w / 2 + (r.paved ? 2.2 : 1.2) + 12.5;
    for (let i = 1; i < r.pts.length; i++) for (const e of [1, -1]) placeAlong(MC, signs, grid, r.pts[i - 1], r.pts[i], e, f2, 5, 8, plain);
  }
  const F0 = MOB_OSM.frame, [ux, uo] = F0.u, a = mp(F0.a), eY = [uo, -ux], eX = [ux, uo];   // (directions du croquis : Y le long de Moboma, X vers Kimpioka)
  let n = 0;
  for (let i = -24; i <= 48; i++) for (let j = -32; j <= 22; j++) {
    const sp = 7, px = a[0] + (i * eY[0] + j * eX[0]) * sp + rand(-1.3, 1.3), pz = a[1] + (i * eY[1] + j * eX[1]) * sp + rand(-1.3, 1.3);
    if (px > -(FRONT + 17) || px < -GROUND_HALF + 25) continue;
    let best = null, bd = 52;
    for (const r of MOB_ROADS) for (let k = 1; k < r.pts.length; k++) { const d = segDist(px, pz, r.pts[k - 1], r.pts[k]); if (d < bd) { bd = d; best = [r.pts[k - 1], r.pts[k]]; } }
    if (!best) continue;
    const [p, q] = best, L = Math.hypot(q[0] - p[0], q[1] - p[1]), dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L;
    const th = Math.atan2(dx, dz) + ((px - p[0]) * dz - (pz - p[1]) * dx > 0 ? 0 : Math.PI);
    const k = Math.random();
    if (k < 0.1) {                                                           // un manguier ou un palmier dans une cour
      if (!grid.rect(px, pz, th, -1.5, 1.5, 1.5)) continue;
      grid.rect(px, pz, th, -1.6, 1.6, 1.6, true);
      (chance(0.7) ? addMango : addPalm)(MC.at(pz, px), px, pz);
      continue;
    }
    const w = rand(4.5, 7), d = rand(4.5, 6.5);
    if (!grid.rect(px, pz, th, -d / 2 - 0.3, d / 2 + 0.3, w / 2 + 0.3)) continue;
    grid.rect(px, pz, th, -d / 2 - 0.4, d / 2 + 0.4, w / 2 + 0.4, true);
    const F = frame(MC.at(pz, px), px, pz, th);
    if (k < 0.62) {                                                          // maison basse, tôle inclinée vers l'arrière
      const h = rand(2.7, 3.4);
      F.box(d, h, w, pick(WALLS), 0, h / 2, 0).box(d + 0.7, 0.12, w + 0.5, pick(TIN), 0.15, h + 0.28, 0, 0, 0, -0.1)
        .box(0.06, 2.0, 1.0, pick(GATES), -d / 2 - 0.03, 1.0, rand(-w / 4, w / 4));
    } else if (k < 0.84) {                                                   // parcelle : mur, portail, maison au fond
      const col = pick(WALLS), h = rand(2.6, 3.1);
      F.box(0.2, 2.0, w, col, -d / 2, 1.0, 0).box(d, 2.0, 0.2, col, 0, 1.0, -w / 2).box(d, 2.0, 0.2, col, 0, 1.0, w / 2)
        .box(0.12, 1.9, 2.2, pick(GATES), -d / 2 - 0.08, 0.95, rand(-w / 4, w / 4))
        .box(d * 0.5, h, w * 0.85, pick(WALLS), d * 0.22, h / 2, 0).box(d * 0.5 + 0.6, 0.12, w * 0.9, pick(TIN), d * 0.22, h + 0.25, 0, 0, 0, -0.1);
    } else {                                                                 // immeuble R+1 inachevé, ferraillage en attente
      const col = pick([0x8c8d88, 0x96958e, 0x7f807b, 0xb9b3a6]);
      F.box(d, 6.2, w, col, 0, 3.1, 0).box(d + 0.3, 0.2, w + 0.3, 0xa8a59c, 0, 3.2, 0);
      for (const y of [1.6, 4.7]) F.box(0.06, 1.2, w * 0.5, 0x22262b, -d / 2 - 0.03, y, 0);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.box(0.05, 1.1, 0.05, 0x5a4a3a, sx * (d / 2 - 0.2), 6.75, sz * (w / 2 - 0.2));
    }
    n++;
  }
  return n;
}

/** Poteaux électriques en bois et fils emmêlés le long des rues goudronnées (vidéos) ; plaques de rue aux carrefours des rues nommées. */
function addMobomaPoles({ MC, md, plates }) {
  for (const r of MOB_ROADS) {
    if (!r.paved) continue;
    const len = roadLen(r), off = r.w / 2 + 1.95, H = 8.2;
    let prev = null;
    for (let t = r.entry ? mobMouth(r.entry).t + 8 : 5; t < len - 4; t += rand(21, 27)) {
      const P = roadAlong(r, t), x = P.x + P.uz * off, z = P.z - P.ux * off;
      const nearJ = MOB_ROADS.some(q => q !== r && q.pts.slice(1).some((p, i) => segDist(x, z, q.pts[i], p) < q.w / 2 + 2.6));
      if (nearJ || x > -(FRONT + 1) || MOB_PROPS.some(([px, pz, rr]) => Math.hypot(px - x, pz - z) < rr)) { prev = null; continue; }
      const b = MC.at(z, x);
      b.cyl(0.1, 0.14, H, chance(0.5) ? 0x5d4a38 : 0x7a6a58, x, H / 2, z).box(1.4, 0.09, 0.09, 0x4a3a2a, x, H - 0.45, z, 0, Math.atan2(P.ux, P.uz), 0);
      if (prev) {
        const dx = x - prev[0], dz = z - prev[1], L = Math.hypot(dx, dz), ry = Math.atan2(dx, dz), mx = (x + prev[0]) / 2, mzz = (z + prev[1]) / 2;
        for (const [o, y] of [[-0.6, H - 0.75], [0, H - 0.8], [0.6, H - 0.75], [rand(-0.3, 0.3), H - 1.7]]) {
          b.box(0.035, 0.035, L, 0x1a1a1a, mx + P.uz * o, y, mzz - P.ux * o, rand(-0.02, 0.02), ry, 0);
        }
      }
      prev = [x, z];
    }
  }
  // plaques : au coin de chaque carrefour de deux rues nommées, une plaque par rue, parallèle à sa rue
  const short = n => n.replace('AVENUE ', 'AV. ').replace(' (EX MOBUTU)', '');
  const done = [];
  for (let i = 0; i < MOB_ROADS.length; i++) for (let j = i + 1; j < MOB_ROADS.length; j++) {
    const A = MOB_ROADS[i], B = MOB_ROADS[j], an = A.plate === false ? '' : A.name, bn = B.plate === false ? '' : B.name;
    if (!an && !bn) continue;
    for (let a = 1; a < A.pts.length; a++) for (let c = 1; c < B.pts.length; c++) {
      const X = segCross(A.pts[a - 1], A.pts[a], B.pts[c - 1], B.pts[c]);
      if (!X || done.some(p => Math.hypot(p[0] - X[0], p[1] - X[1]) < 8)) continue;
      done.push(X);
      const da = [A.pts[a][0] - A.pts[a - 1][0], A.pts[a][1] - A.pts[a - 1][1]], db = [B.pts[c][0] - B.pts[c - 1][0], B.pts[c][1] - B.pts[c - 1][1]];
      const la = Math.hypot(...da), lb = Math.hypot(...db), na = [da[1] / la, -da[0] / la], nb = [db[1] / lb, -db[0] / lb];
      const ka = B.w / 2 + 2.3, kb = A.w / 2 + 2.3, x = X[0] + na[0] * kb + nb[0] * ka, z = X[1] + na[1] * kb + nb[1] * ka;
      if (x > -(FRONT + 1) || MOB_ROADS.some(q => q.pts.slice(1).some((p, i) => segDist(x, z, q.pts[i], p) < q.w / 2 + 0.8))) continue;
      md.at(z).box(0.09, 3.4, 0.09, 0x8e949a, x, 1.7, z);
      if (an) for (const e of [0, Math.PI]) plates.add(short(an), 1.75, 0.42, x, 3.2, z, Math.atan2(-da[1], da[0]) + e);
      if (bn) for (const e of [0, Math.PI]) plates.add(short(bn), 1.75, 0.42, x, 2.75, z, Math.atan2(-db[1], db[0]) + e);
    }
  }
}

function addMoboma(chunks, near, far, md, signs, plates, scene) {
  MOB_PROPS.length = 0;
  const MC = { at: (z, x = 0) => (x < -125 ? far : near).at(z) };
  const road = key => MOB_ROADS.find(r => r.key === key);
  const zTop = MOB_Z0 + 70, zBot = MOB_Z1 - 70, grid = new MobGrid(Math.floor(MOB_X1) - 160, zTop, zBot);
  /** Construit build(F, S) dans le repère (o : origine et cap th), si le rectangle [x0, x1] × [-hz, hz] est libre ; l'occupe. */
  const site = (o, x0, x1, hz, build, check = true) => {
    if (check && !grid.rect(o.x, o.z, o.th, x0 + 0.6, x1, hz)) return false;
    grid.rect(o.x, o.z, o.th, x0 - 0.3, x1 + 0.3, hz + 0.3, true);
    build(frame(MC.at(o.z, o.x), o.x, o.z, o.th), frameSigns(signs, o.x, o.z, o.th), frame(md.at(o.z), o.x, o.z, o.th));
    return true;
  };

  // --- sol occupé : la bande du boulevard (trottoir), les rues (avec caniveaux), les lieux du boulevard de ce côté
  grid.box(-(FRONT - 1), 0, Math.ceil(zTop), zBot);
  if (MOB_FRONT) { grid.box(-(FRONT + 34), 0, Math.ceil(zTop), MOB_FRONT[0]); grid.box(-(FRONT + 34), 0, Math.ceil(MOB_FRONT[1]), zBot); }   // (façades génériques du boulevard)
  for (const r of MOB_ROADS) for (let i = 1; i < r.pts.length; i++) {
    let a = r.pts[i - 1], c = r.pts[i];
    const rr = r.w / 2 + (r.paved ? 1.8 : 0.7), L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
    if (r.dead[0] && i === 1) a = [a[0] + ux * rr, a[1] + uz * rr];          // bout carré : le mur du fond s'y colle
    if (r.dead[1] && i === r.pts.length - 1) c = [c[0] - ux * rr, c[1] - uz * rr];
    grid.seg(a, c, rr);
  }
  const PLACE_D = { kimbanseke_commune: 16, fuel: 17, kinmarche: 34, atm: 6 };
  for (const p of ALL_PLACES) {
    const z = g(p.s);
    if (p.side !== -1 || z > zTop || z < zBot) continue;
    const d = PLACE_D[p.kind] ?? 14;
    grid.box(-(FRONT + 24), 0, Math.ceil(z + d), z - d);
  }
  for (const z of BUS_STOPS_L) if (z < zTop && z > zBot) grid.box(-(FRONT + 4), 0, Math.ceil(z + 13), z - 13);

  // --- les rues : goudron et caniveaux (MACADAM), ou terre (AVENUE)
  for (const r of MOB_ROADS) addMobomaRoad(MC, r);
  // murs au fond des culs-de-sac (portail métallique au milieu)
  for (const r of MOB_ROADS) for (const end of [0, 1]) {
    if (!r.dead[end] || r.noWall) continue;
    const p = end ? r.pts.at(-1) : r.pts[0], q = end ? r.pts.at(-2) : r.pts[1], L = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const ux = (p[0] - q[0]) / L, uz = (p[1] - q[1]) / L, x = p[0] - ux * 0.4, z = p[1] - uz * 0.4, th = Math.atan2(ux, uz);
    const F = frame(MC.at(z, x), x, z, th), wall = pick(WALLS), half = r.w / 2 + (r.paved ? 2 : 1);
    F.box(half * 2, 2.3, 0.25, wall, 0, 1.15, 0).box(Math.min(3.2, r.w * 0.45), 2.0, 0.12, pick(GATES), 0, 1.0, -0.15);
  }

  // --- les repères (Aéro Club, Passio, ITP, Saint-Marc, hôpitaux, écoles, marché…), avant tout le reste
  const ctx = { site, road, grid, MC, md, signs, plates, scene };
  MOB_LOG.fails = addMobomaLandmarks(ctx);

  // --- le long du boulevard : les façades de la tranche du quartier (les rues y passent en biais : on construit là où le sol est libre)
  if (MOB_FRONT) {
    for (let z = MOB_FRONT[0]; z > MOB_FRONT[1];) {
      const kind = Math.random(), w = kind < 0.5 ? rand(5, 9) : rand(9, 15), d = 14, cz = z - w / 2;
      const o = { x: 0, z: cz, th: Math.PI };
      const clear = [cz - w / 2, cz, cz + w / 2].every(zz => [FRONT - 3, FRONT + 1].every(xx => !MOB_ROADS.some(q => q.pts.slice(1).some((p, i) => segDist(-xx, zz, q.pts[i], p) < q.w / 2 + 0.8))));
      if (clear && grid.rect(o.x, o.z, o.th, FRONT + 0.6, FRONT + d, w / 2 + 0.3)) {
        grid.rect(o.x, o.z, o.th, FRONT - 0.3, FRONT + d + 0.3, w / 2 + 0.3, true);
        const b = chunks.at(cz);
        if (kind < 0.45) addShop(b, signs, -1, cz, w);
        else if (kind < 0.78) addParcel(b, -1, cz, w);
        else addTall(b, signs, -1, cz, w);
        // deuxième rangée en arrière-plan, si la place est libre
        const d2 = rand(7, 11), x2 = FRONT + 15 + d2 / 2;
        if (chance(0.7) && grid.rect(o.x, o.z, o.th, x2 - d2 / 2, x2 + d2 / 2, w * 0.4)) {
          grid.rect(o.x, o.z, o.th, x2 - d2 / 2 - 0.3, x2 + d2 / 2 + 0.3, w * 0.4 + 0.3, true);
          const h = rand(2.8, 6);
          b.box(d2, h, w * 0.8, pick(WALLS), -x2, h / 2, cz).box(d2 + 0.6, 0.12, w * 0.85, pick(TIN), -x2, h + 0.25, cz, 0, 0, -0.1);
        }
        z -= w + rand(0.3, 2);
        MOB_LOG.front = (MOB_LOG.front ?? 0) + 1;
      } else z -= 1.5;
    }
  }

  // --- maisons et boutiques le long des rues (types de Masina : même style de quartier populaire)
  const lower = (r, t) => r.key === 'moboma' && t < 95;            // le bas de Moboma : immeubles de plusieurs niveaux (vidéo, 6:16)
  const kindFor = (r, t) => {
    if (lower(r, t)) return pick(['unfinished', 'balcony_r1', 'hipped_r1', 'unfinished', 'shop']);
    if (r.paved) return pick(['shop', 'gabled_shop', 'parcel', 'house', 'hipped_r1', 'balcony_r1', 'unfinished', 'parcel']);
    return pick(['parcel', 'parcel', 'house', 'house', 'shop']);
  };
  for (const r of MOB_ROADS) {
    if (r.noPlots) continue;
    const f = r.w / 2 + (r.paved ? 2.2 : 1.2);
    for (let i = 1; i < r.pts.length; i++) {
      const t0 = roadArc(r, r.pts[i - 1]);
      for (const e of [1, -1]) placeAlong(MC, signs, grid, r.pts[i - 1], r.pts[i], e, f, r.paved ? 7 : 6, r.paved ? 12 : 10,
        () => kindFor(r, t0));
    }
  }


  // --- le cœur des îlots et les abords, puis les poteaux électriques et les plaques de rue
  MOB_LOG.fill = addMobomaFill(ctx);
  MOB_LOG.free = (() => { let n = 0; for (const v of grid.c) n += v ? 0 : 1; return n; })();   // (cases libres restantes : tests)
  addMobomaPoles(ctx);
  return { grid, site, road, MC };
}

/** Plaques de rue (Masina) : toutes les inscriptions sur une seule texture et un seul maillage. */
class PlateAtlas {
  constructor(bg = '#1d4fa0', fg = '#fff') { this.names = []; this.parts = []; this.bg = bg; this.fg = fg; }
  add(name, w, h, x, y, z, ry) {
    let i = this.names.indexOf(name);
    if (i < 0) { i = this.names.length; this.names.push(name); }
    this.parts.push({ i, w, h, x, y, z, ry });
  }
  build(scene) {
    if (!this.parts.length) return;
    const COLS = 4, CW = 256, CH = 64, H = 2 ** Math.ceil(Math.log2(Math.ceil(this.names.length / COLS) * CH));
    const tex = canvasTexture(COLS * CW, H, x => {
      this.names.forEach((n, i) => {
        const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * CH;
        x.fillStyle = this.bg; x.fillRect(cx, cy, CW, CH);
        x.strokeStyle = this.fg; x.lineWidth = 4; x.strokeRect(cx + 5, cy + 5, CW - 10, CH - 10);
        x.fillStyle = this.fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 30px sans-serif';
        x.fillText(n, cx + CW / 2, cy + CH / 2 + 2, CW - 26);
      });
    });
    const b = new Builder(true);
    for (const p of this.parts) {
      const geo = new THREE.PlaneGeometry(p.w, p.h), uv = geo.attributes.uv;
      const u0 = (p.i % COLS) / COLS, dv = CH / H, v0 = 1 - (Math.floor(p.i / COLS) + 1) * dv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / COLS, v0 + uv.getY(k) * dv);
      b.add(geo, 0xffffff, p.x, p.y, p.z, 0, p.ry, 0);
    }
    scene.add(new THREE.Mesh(bendGeometry(b.geometry()), new THREE.MeshLambertMaterial({ map: tex })));
  }
}

const MAS_SHOP_SIGNS = [
  ['PHARMACIE LA PROVIDENCE', 'Médicaments · Soins · Kulumba', '#ffffff', '#c8102e'],
  ['ANA SHOP ★ 5 ÉTOILES ★', 'Maison Jovial · Habillement & Divers', '#f4f4f0', '#1d4fa0'],
  ['MAISON EMMANUEL', 'Ventes & Services · Alimentation', '#c8102e', '#ffffff'],
  ['QUADO ALIMENTATION', 'Vivres Frais · Boissons · Glace', '#0066cc', '#ffffff'],
  ['BOUTIQUE & COUTURE', 'Prêt-à-Porter · Pagnes · Mode', '#1a1d20', '#f5c400'],
  ['VODACOM M-PESA · AIRTEL', 'Change · Transfert · Cabine', '#e31837', '#ffffff'],
  ['WINNER BET · SPORT', 'Paris Sportifs · Jeux · Direct', '#4a154b', '#f5c400'],
  ['SALON DE COIFFURE & BEAUTÉ', 'Tresses · Soins · Cosmétique', '#b5179e', '#ffffff'],
  ['QUINCAILLERIE DE MASINA', 'Matériaux · Ciment · Peinture', '#1d6b3a', '#ffffff'],
  ['DÉPÔT BOISSONS & VIVRES', 'Gros & Demi-Gros · Sans-Fil', '#f5c400', '#111111'],
];

/** Parcelle de Masina dans le repère de sa rue (façade en x = f, la rue en x < f ; z le long de la rue, centre 0 ; d :
 *  profondeur). kind : 'parcel' (mur, portail, maison au fond), 'shop' (boutique, mannequins de couture, vêtements suspendus,
 *  cabines M-Pesa / Airtel Money et enseigne), 'house' (maison sur la rue), 'unfinished' (immeuble R+1 en briques grises en
 *  chantier, très fréquent sur Kulumba), 'hipped_r1' (immeuble R+1 à toit à croupe et boutiques sous auvent, f_038, f_340),
 *  'balcony_r1' (immeuble R+1 à balcon métallique brun-rouge et perron à marches, f_130, f_610), 'gabled_shop' (boutique à pignon). */
function addMasinaPlot(F, S, f, w, d, kind) {
  if (kind === 'unfinished') {
    const h1 = 3.3, h2 = 3.1, col = pick([0x8c8d88, 0x96958e, 0x7f807b]);
    F.box(d, h1, w * 0.94, col, f + d / 2, h1 / 2, 0)
      .box(d + 0.5, 0.24, w * 0.98, 0xa8a59c, f + d / 2, h1 + 0.12, 0)
      .box(d * 0.92, h2, w * 0.9, col, f + d / 2 + 0.2, h1 + 0.24 + h2 / 2, 0);
    // Ouvertures brutes (sans vitres) à l'étage + fers à béton qui dépassent sur la dalle
    for (const zz of [-w * 0.28, 0, w * 0.28]) {
      F.box(0.14, 1.35, 1.25, 0x22252a, f + 0.3, h1 + 1.6, zz)
        .box(0.08, 2.3, 1.6, pick([0x4a3828, 0x8e949a, 0x2a4f7f]), f - 0.03, 1.15, zz);
    }
    for (let k = -2; k <= 2; k++) F.cyl(0.04, 0.04, 1.1, 0x5a4638, f + 0.6, h1 + h2 + 0.75, k * w * 0.18);
    // Auvent de tôle au RDC avec vêtements suspendus ou petit tas de sable / gravier devant le chantier
    if (chance(0.55)) {
      F.box(2.0, 0.08, w * 0.9, pick(TIN), f - 0.95, 2.75, 0, 0, 0, -0.14);
      for (const dz of [-w * 0.36, -w * 0.12, w * 0.12, w * 0.36]) {
        F.box(0.08, 0.85, 0.42, pick([0xe63946, 0x1d4fa0, 0xf5c400, 0x2a9d8f, 0xf4a261]), f - 1.65, 2.15, dz);
      }
    }
    if (chance(0.5)) F.add(new THREE.ConeGeometry(1.1, 0.65, 7), 0xb89c68, f - 0.85, 0.32, w * 0.22);
    return;
  }
  if (kind === 'hipped_r1') {
    const h = 6.3, col = pick([0xb8b2a4, 0xd8c8b0, 0x9e9c95, 0xe2cfb8]), roof = pick([0x4a4e54, 0x6b4c35, 0x3d434a]);
    F.box(d, h, w * 0.92, col, f + d / 2, h / 2, 0)
      .box(d + 0.4, 0.22, w * 0.95, 0x8c887e, f + d / 2, 3.2, 0)
      .box(d + 0.9, 0.95, w * 0.98, roof, f + d / 2, h + 0.48, 0)
      .box(2.2, 0.09, w * 0.92, pick(TIN), f - 1.0, 2.82, 0, 0, 0, -0.14);
    for (const dz of [-w * 0.28, w * 0.28]) {
      F.box(0.08, 2.25, 1.55, pick([0x1d4fa0, 0x6b3e26, 0x2b3036]), f - 0.04, 1.12, dz)
        .box(0.1, 1.25, 1.3, 0x222830, f - 0.04, 4.7, dz)
        .cyl(0.05, 0.05, 2.75, 0x5c4a38, f - 1.9, 1.38, dz * 1.3);
    }
    if (chance(0.5)) {
      const k = Math.floor(Math.random() * MAS_SHOP_SIGNS.length), [t, sub, bg, fg] = MAS_SHOP_SIGNS[k];
      S.add(`mshop_${k}`, () => signTexture(t, sub, bg, fg, true), Math.min(w * 0.82, 5.4), 0.95, f - 0.06, 3.25, 0, -Math.PI / 2);
    }
    return;
  }
  if (kind === 'balcony_r1') {
    const h = 6.5, col = pick([0xe8dcc8, 0xd4c4ae, 0xc8c2b6, 0xf0e4d4]);
    F.box(d, h, w * 0.92, col, f + d / 2, h / 2, 0)
      .box(d + 0.8, 0.2, w * 0.96, pick(TIN), f + d / 2, h + 0.2, 0, 0, 0, -0.09)
      // Balcon en porte-à-faux + garde-corps métallique brun-rouge (f_130, f_610)
      .box(1.45, 0.2, w * 0.88, 0xb8b2a6, f - 0.68, 3.3, 0)
      .box(0.08, 0.92, w * 0.86, 0x7a2e22, f - 1.34, 3.82, 0)
      .box(1.38, 0.92, 0.08, 0x7a2e22, f - 0.68, 3.82, -w * 0.43)
      .box(1.38, 0.92, 0.08, 0x7a2e22, f - 0.68, 3.82, w * 0.43);
    for (const dz of [-w * 0.26, w * 0.26]) {
      F.box(0.08, 2.25, 1.5, pick(GATES), f - 0.04, 1.12, dz)
        .box(0.08, 1.85, 1.35, 0x222830, f - 0.04, 4.35, dz);
    }
    // Perron en béton à marches devant les boutiques (f_130)
    F.box(0.95, 0.28, w * 0.84, 0x9e9a90, f - 0.45, 0.14, 0)
      .box(1.35, 0.14, w * 0.86, 0xb2ada2, f - 0.65, 0.07, 0);
    return;
  }
  if (kind === 'gabled_shop') {
    const h = rand(3.3, 4.1), wall = chance(0.45) ? pick(STRONG) : pick(WALLS), roof = pick(TIN), a = 0.26;
    F.box(d, h, w * 0.94, wall, f + d / 2, h / 2, 0);
    for (const e of [-1, 1]) {
      F.box(d + 0.8, 0.12, (w * 0.52) / Math.cos(a), roof, f + d / 2, h + (w * 0.24) * Math.tan(a), e * w * 0.24, e * a, 0, 0);
    }
    F.box(0.08, 2.3, Math.min(2.2, w * 0.38), pick(GATES), f - 0.03, 1.15, 0);
    const pool = chance(0.65) ? MAS_SHOP_SIGNS : SHOP_SIGNS;
    const k = Math.floor(Math.random() * pool.length), [t, sub, bg, fg] = pool[k];
    S.add(`${pool === MAS_SHOP_SIGNS ? 'mshop_' : 'shop'}${k}`, () => signTexture(t, sub, bg, fg, true), Math.min(w * 0.86, 5.6), 1.1, f - 0.06, h - 0.55, 0, -Math.PI / 2);
    return;
  }
  if (kind === 'shop') {
    const h = rand(3.1, 4.3);
    F.box(d, h, w, chance(0.45) ? pick(STRONG) : pick(WALLS), f + d / 2, h / 2, 0)
      .box(d + 0.8, 0.12, w + 0.6, pick(TIN), f + d / 2, h + 0.25, 0, 0, 0, 0.12)
      .box(0.06, 2.2, Math.min(2.4, w * 0.35), pick(GATES), f - 0.03, 1.1, -w * 0.2);
    if (w > 6) F.box(0.06, 1.2, 1.4, 0x2a2a2a, f - 0.03, 1.5, w * 0.25);
    if (chance(0.62)) {
      F.box(2.1, 0.08, w * 0.92, pick(TIN), f - 1.0, 2.72, 0, 0, 0, -0.15);
      for (const dz of [-w * 0.4, w * 0.4]) F.cyl(0.05, 0.05, 2.7, 0x6b5a4a, f - 1.9, 1.35, dz);
      // Robes et habits colorés suspendus sous le bord de l'auvent (f_038, f_450, f_610)
      if (chance(0.5)) {
        for (const dz of [-w * 0.3, -w * 0.1, w * 0.1, w * 0.3]) {
          F.box(0.08, 0.82, 0.38, pick([0xe63946, 0x0066cc, 0xf5c400, 0x2a9d8f, 0x9b5de5]), f - 1.75, 2.15, dz);
        }
      }
    }
    // Mannequins de couture / prêt-à-porter et robes exposées devant la boutique (omniprésents sur Kulumba)
    if (chance(0.38)) {
      for (const mz of [-w * 0.32, w * 0.32]) {
        const dressCol = pick([0xe63946, 0xf4a261, 0x2a9d8f, 0x1d4fa0, 0xf5c400, 0x9b5de5]);
        F.cyl(0.03, 0.03, 0.75, 0x333333, f - 0.65, 0.38, mz)
          .cyl(0.16, 0.24, 0.72, dressCol, f - 0.65, 1.08, mz)
          .ball(0.11, 0x2a2522, f - 0.65, 1.55, mz);
      }
    }
    // Cabine Mobile Money (M-Pesa / Airtel / Orange), kiosque en bois surélevé (f_340) ou casiers de boissons bleus (f_570)
    if (chance(0.38)) {
      const kz = w * 0.36, mCol = pick([0xe31837, 0xff6b00, 0x0066cc, 0xf5c400]);
      F.box(0.75, 1.95, 0.75, mCol, f - 0.85, 0.98, kz)
        .box(0.82, 0.1, 0.82, 0xf2efe8, f - 0.85, 1.98, kz)
        .box(0.08, 0.95, 0.55, 0x1a1d20, f - 1.25, 0.5, kz - 0.7, 0, 0, -0.14);
    } else if (chance(0.32)) {
      // Kiosque-étal en bois couvert de tôle en bord de trottoir (f_310, f_340)
      const kz = -w * 0.3;
      F.box(1.15, 0.08, 1.65, 0x7c5836, f - 1.05, 0.85, kz)
        .box(1.35, 0.08, 1.85, pick(TIN), f - 1.05, 2.15, kz, 0, 0, -0.12);
      for (const dx of [-0.5, 0.5]) for (const dz of [-0.75, 0.75]) F.box(0.07, 2.1, 0.07, 0x6b4c30, f - 1.05 + dx, 1.05, kz + dz);
    }
    if (chance(0.78)) {
      const pool = chance(0.65) ? MAS_SHOP_SIGNS : SHOP_SIGNS;
      const k = Math.floor(Math.random() * pool.length), [t, sub, bg, fg] = pool[k];
      S.add(`${pool === MAS_SHOP_SIGNS ? 'mshop_' : 'shop'}${k}`, () => signTexture(t, sub, bg, fg, true), Math.min(w * 0.9, 6), 1.15, f - 0.06, h - 0.75, 0, -Math.PI / 2);
    }
    return;
  }
  const tank = (x, h) => { if (chance(0.22)) F.cyl(0.55, 0.55, 1.15, pick([0x1d4fa0, 0x1a1a1a]), x, h + 0.9, rand(-w / 5, w / 5)); };   // réservoir d'eau sur le toit
  if (kind === 'house') {
    const h = rand(2.8, 3.5);
    F.box(d, h, w * 0.92, pick(WALLS), f + d / 2, h / 2, 0)
      .box(d + 0.8, 0.12, w, pick(TIN), f + d / 2, h + 0.3, 0, 0, 0, 0.1)
      .box(0.06, 2.1, 1.1, pick(GATES), f - 0.03, 1.05, rand(-w / 4, w / 4))
      .box(0.06, 1, 1.2, 0x2a3540, f - 0.03, 1.6, w * 0.32);
    tank(f + d * 0.7, h);
    return;
  }
  // parcelle : mur de clôture et portail sur la rue, maison basse au fond de la cour
  const color = chance(0.4) ? pick(STRONG) : pick(WALLS), gate = Math.min(3.2, w * 0.3), gz = rand(-w / 4, w / 4);
  const l1 = gz - gate / 2 + w / 2, l2 = w / 2 - gz - gate / 2;
  if (l1 > 0.2) F.box(0.25, 2.2, l1, color, f + 0.15, 1.1, -w / 2 + l1 / 2);
  if (l2 > 0.2) F.box(0.25, 2.2, l2, color, f + 0.15, 1.1, w / 2 - l2 / 2);
  F.box(0.12, 2.0, gate, pick(GATES), f + 0.15, 1.0, gz);
  const hd = Math.max(4, d - 3), h = rand(2.8, 3.5);
  F.box(hd, h, w * rand(0.6, 0.85), pick(WALLS), f + 3 + hd / 2, h / 2, 0)
    .box(hd + 0.8, 0.12, w * 0.9, pick(TIN), f + 3 + hd / 2, h + 0.3, 0, 0, 0, -0.1);
  tank(f + 3 + hd * 0.6, h);
}

/** Pose des parcelles le long du segment a → c, du côté e (±1), façades à f de l'axe, là où le sol est libre. */
function placeAlong(mc, signs, grid, a, c, e, f, dMin, dMax, kindAt) {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
  const th = Math.atan2(ux, uz) + (e > 0 ? 0 : Math.PI);
  for (let t = 0; t < L - 4;) {
    let done = false;
    for (const w of [rand(7, 11), rand(5, 6.5)]) {
      // (contrôle un peu en retrait de la façade : le long d'une route en biais, les cases de 1 m de la chaussée débordent)
      const d = rand(dMin, dMax), tc = t + w / 2, ox = a[0] + ux * tc, oz = a[1] + uz * tc;
      if (tc + w / 2 > L || !grid.rect(ox, oz, th, f + 0.6, f + d + 0.4, w / 2 + 0.3)) continue;
      grid.rect(ox, oz, th, f - 0.3, f + d + 0.4, w / 2 + 0.3, true);
      addMasinaPlot(frame(mc.at(oz, ox), ox, oz, th), frameSigns(signs, ox, oz, th), f, w, d, kindAt(oz));
      t += w + rand(0.2, 0.9);
      done = true;
      break;
    }
    if (!done) t += 1.5;
  }
}

/** Chaussée d'une route de Masina, en morceaux de 40 m au plus (tranches, pliage) : goudron, caniveaux en béton ouverts
 *  de chaque côté avec dalles de passage devant les entrées, accotements/trottoirs, marquage axial blanc délavé sur
 *  Kulumba et Bosango (f_088, f_168), et zone dégradée rocailleuse/nids-de-poule sur Kulumba (29m44s–30m32s). */
function addMasinaRoad(mc, r, cuts) {
  const paved = r.paved, y = paved ? 0.03 : 0.016, h = paved ? 0.035 : 0.03, col = paved ? MAS_ASPH : LATERITE;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], c = r.pts[i], ry = Math.atan2(c[0] - a[0], c[1] - a[1]), L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / 40)), along = Math.abs(c[0] - a[0]) < 0.01, len = L / n;
    const nx = Math.cos(ry), nz = -Math.sin(ry), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
    for (let k = 0; k < n; k++) {
      const x = a[0] + (c[0] - a[0]) * (k + 0.5) / n, z = a[1] + (c[1] - a[1]) * (k + 0.5) / n, b = mc.at(z, x);
      b.box(r.w, h, len + 0.02, col, x, y, z, 0, ry, 0);
      if (!paved) continue;
      // Caniveaux ouverts en béton (fond sombre + deux murets de bordure en béton gris) et trottoir sablonneux de chaque côté
      const drainSegment = (xxc, zzc, segL) => {
        for (const e of [-1, 1]) {
          const offsh = e * (r.w / 2 + 1.05), offG = e * (r.w / 2 + 0.45), offW1 = e * (r.w / 2 + 0.16), offW2 = e * (r.w / 2 + 0.74);
          b.box(1.9, 0.02, segL, SHOULDER, xxc + nx * offsh, 0.012, zzc + nz * offsh, 0, ry, 0)
            .box(0.46, 0.025, segL, 0x2b2d30, xxc + nx * offG, 0.022, zzc + nz * offG, 0, ry, 0)
            .box(0.14, 0.14, segL, 0x9e9a90, xxc + nx * offW1, 0.07, zzc + nz * offW1, 0, ry, 0)
            .box(0.14, 0.15, segL, 0xb2ada2, xxc + nx * offW2, 0.075, zzc + nz * offW2, 0, ry, 0);
          // Dalles en béton posées en travers du caniveau tous les ~11 m pour l'accès piéton aux boutiques et parcelles
          for (let d = -segL / 2 + 3.5; d < segL / 2 - 2; d += 11) {
            b.box(0.76, 0.07, 1.55, 0xc4bfb4, xxc + nx * offG + ux * d, 0.125, zzc + nz * offG + uz * d, 0, ry, 0);
          }
        }
      };
      if (along) {
        for (const [p, q] of minus([[Math.max(z + len / 2, z - len / 2), Math.min(z + len / 2, z - len / 2)]], cuts)) {
          drainSegment(x, (p + q) / 2, p - q);
        }
      } else {
        drainSegment(x, z, len);
      }
    }
    if (r.dashes) for (let t = 6; t < L - 4; t += 8.5) {
      const x = a[0] + (c[0] - a[0]) * t / L, z = a[1] + (c[1] - a[1]) * t / L;
      mc.at(z, x).box(0.16, 0.045, 3.2, r.key === 'kulumba' ? 0xd8d6ce : 0xecece6, x, 0.03, z, 0, ry, 0);
    }
    // Zones de chaussée dégradée (cailloux, terre ocre et nids-de-poule) visibles dans la vidéo à 29m44s–30m32s et au carrefour BKTF
    if (r.key === 'kulumba') {
      for (let t = 8; t < L - 8; t += 3.5) {
        const x = a[0] + ux * t, z = a[1] + uz * t;
        const rough = (z < mz(4565) && z > mz(4635)) || (z < mz(6520) && z > mz(6575));
        if (!rough) continue;
        const b = mc.at(z, x);
        b.box(r.w * rand(0.55, 0.92), 0.042, rand(2.4, 4.2), pick([0x8b6f4e, 0x9a7b56, 0x766552, 0x6b5c4c]), x + nx * rand(-1.2, 1.2), 0.032, z, 0, ry + rand(-0.08, 0.08), 0);
        if (chance(0.45)) b.cyl(rand(0.45, 0.9), rand(0.5, 0.95), 0.046, 0x4e4338, x + nx * rand(-2.2, 2.2), 0.034, z + rand(-1, 1), 0, 0, 0, 8);
      }
    }
  }
  for (const [x, z] of r.pts.slice(1, -1)) mc.at(z, x).cyl(r.w / 2, r.w / 2, h, col, x, y, z, 0, 0, 0, 18);   // coins arrondis
}

/** Ruisseau ou caniveau : eau entre deux bordures en béton ; sous une route goudronnée, pont avec trottoirs surélevés en
 *  béton et longs garde-corps tubulaires métalliques rouge et blanc à 3 lisses (pont de la rivière Mokali à 10m40s–11m20s
 *  et 2e pont après l'Avenue Congo à 26m16s). ww : largeur de l'eau. */
function addStream(mc, pts, ww = 3.2) {
  const under = (x, z) => MAS_ROADS.some(r => r.pts.slice(1).some((q, i) => segDist(x, z, r.pts[i], q) < r.w / 2 + 0.6));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i], ry = Math.atan2(c[0] - a[0], c[1] - a[1]), L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, nx = Math.cos(ry), nz = -Math.sin(ry), eo = ww / 2 + 0.25;
    for (let t = 0; t < L - 0.01; t += 30) {
      const len = Math.min(30, L - t), x = a[0] + ux * (t + len / 2), z = a[1] + uz * (t + len / 2);
      mc.at(z, x).box(ww, 0.02, len, 0x4e5b3a, x, 0.02, z, 0, ry, 0);
    }
    for (let t = 0; t < L - 0.01; t += 4) {
      const len = Math.min(4, L - t), x = a[0] + ux * (t + len / 2), z = a[1] + uz * (t + len / 2);
      for (const e of [-1, 1]) {
        const ex = x + e * nx * eo, ez = z + e * nz * eo;
        if (!under(ex, ez)) mc.at(z, x).box(0.5, 0.3, len, 0xb5ae9f, ex, 0.15, ez, 0, ry, 0);
      }
    }
  }
  for (const r of MAS_ROADS.filter(q => q.paved)) for (let i = 1; i < r.pts.length; i++) for (let j = 1; j < pts.length; j++) {
    const p = segCross(r.pts[i - 1], r.pts[i], pts[j - 1], pts[j]);
    if (!p) continue;
    const [a, c] = [r.pts[i - 1], r.pts[i]], ry = Math.atan2(c[0] - a[0], c[1] - a[1]), nx = Math.cos(ry), nz = -Math.sin(ry), ux = Math.sin(ry), uz = Math.cos(ry);
    const isMokali = ww > 2.5 && r.key === 'kulumba';
    const isKulSecond = ww <= 2.5 && r.key === 'kulumba';
    // Pont Mokali : longue promenade bétonnée surélevée (~68 m) avec garde-corps tubulaire rouge et blanc (f_160, f_168, f_170)
    const span = isMokali ? 68 : isKulSecond ? 24 : 10;
    const railRed = isKulSecond ? 0x9e2b25 : 0xd62828;
    for (const e of [-1, 1]) {
      const offWalk = e * (r.w / 2 + 1.05), offRail = e * (r.w / 2 + 1.72), offCurb = e * (r.w / 2 + 0.16);
      // Trottoir de pont en béton surélevé par tranches
      for (let s = -span / 2; s < span / 2 - 0.01; s += 12) {
        const seg = Math.min(12, span / 2 - s), sc = s + seg / 2;
        const bx = p[0] + ux * sc, bz = p[1] + uz * sc, b = mc.at(bz, bx);
        b.box(1.55, 0.28, seg + 0.05, 0xc2bdb2, bx + nx * offWalk, 0.14, bz + nz * offWalk, 0, ry, 0);
        // Blocs de bordure espacés le long de la chaussée (typiques du pont Mokali dans la vidéo)
        for (let d = -seg / 2 + 0.9; d < seg / 2; d += 2.2) {
          b.box(0.22, 0.34, 1.05, 0xd4cfc4, bx + nx * offCurb + ux * d, 0.17, bz + nz * offCurb + uz * d, 0, ry, 0);
        }
        // Garde-corps tubulaire métallique à 3 lisses horizontales alternant travées rouges et blanches
        const nBays = Math.max(1, Math.round(seg / 2.4)), bayL = seg / nBays;
        for (let k = 0; k < nBays; k++) {
          const dc = -seg / 2 + (k + 0.5) * bayL, rx = bx + nx * offRail + ux * dc, rz = bz + nz * offRail + uz * dc;
          const col = (k + Math.round((s + span) / 2)) % 2 === 0 ? railRed : 0xf2efe8;
          b.box(0.09, 1.05, 0.09, col, rx - ux * (bayL / 2), 0.72, rz - uz * (bayL / 2), 0, ry, 0);
          for (const yh of [0.52, 0.84, 1.16]) b.box(0.07, 0.07, bayL + 0.04, col, rx, yh, rz, 0, ry, 0);
        }
      }
      // Parapet maçonné central au-dessus même du lit de l'eau
      const b0 = mc.at(p[1], p[0]);
      b0.box(0.36, 0.95, ww + 2.8, 0xb8b2a6, p[0] + nx * (offRail + e * 0.12), 0.48, p[1] + nz * (offRail + e * 0.12), 0, ry, 0);
    }
    // Palmiers au bord de la rivière Mokali (f_160_10m40s) et palissade en tôles pastel (jaune/vert/rose) au 2e pont (f_394_26m16s)
    if (isMokali) {
      for (const [sd, ds] of [[-1, -6], [1, 5], [1, -9], [-1, 8]]) {
        addPalm(mc.at(p[1] + uz * ds, p[0]), p[0] + nx * sd * (r.w / 2 + 4.2) + ux * ds, p[1] + nz * sd * (r.w / 2 + 4.2) + uz * ds, rand(7.5, 10));
      }
    } else if (isKulSecond) {
      const b2 = mc.at(p[1], p[0]), pastel = [0xf4d35e, 0x90be6d, 0xf28482, 0xf6bd60, 0x84a59d];
      for (let k = 0; k < 10; k++) {
        const dc = -14 - k * 1.6, fx = p[0] + nx * (r.w / 2 + 2.15) + ux * dc, fz = p[1] + nz * (r.w / 2 + 2.15) + uz * dc;
        b2.box(0.1, 2.2, 1.55, pastel[k % pastel.length], fx, 1.1, fz, 0, ry, 0);
      }
    }
  }
}
/** Point de croisement des segments a-b et c-d (coordonnées route), ou null. */
function segCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}

/** Voie ferrée le long de la polyligne pts (ballast, traverses, rails). */
function addRailLine(mc, pts) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]), ry = Math.atan2(c[0] - a[0], c[1] - a[1]);
    const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, nx = Math.cos(ry), nz = -Math.sin(ry);
    for (let t = 0; t < L - 0.01; t += 30) {
      const len = Math.min(30, L - t), x = a[0] + ux * (t + len / 2), z = a[1] + uz * (t + len / 2), b = mc.at(z, x);
      b.box(3.6, 0.3, len + 0.1, 0x8f8778, x, 0.15, z, 0, ry, 0);
      for (const e of [-0.72, 0.72]) b.box(0.08, 0.15, len + 0.1, 0x70757a, x + nx * e, 0.42, z + nz * e, 0, ry, 0);
      for (let k = 0.5; k < len; k += 1.2) b.box(2.5, 0.12, 0.24, 0x4a3b2c, a[0] + ux * (t + k), 0.33, a[1] + uz * (t + k), 0, ry, 0);
    }
  }
}

/** SOCIDER, Société Sidérurgique de Masina (l'auteur ; pas sur OSM), au bout de l'Avenue Bosango : mur d'enceinte, portail
 *  et enseigne sur l'avenue, loge du gardien, deux grands halls en tôle, cheminée, ferraille. x0 : portail ; z : axe. */
function addSocider(mc, signs, x0, z, name, sub) {
  const b = mc.at(z, x0), D = 40, L = 84, WALL = 0xd9d3c5, BRICK = 0x8a4b2a;
  const wall = (len, x, zc, alongZ = true) => b.box(alongZ ? 0.35 : len, 2.8, alongZ ? len : 0.35, WALL, x, 1.4, zc)
    .box(alongZ ? 0.4 : len, 0.3, alongZ ? len : 0.4, BRICK, x, 2.95, zc);
  const side = L / 2 - 5;
  wall(side, x0, z + 5 + side / 2); wall(side, x0, z - 5 - side / 2);
  wall(D, x0 + D / 2, z + L / 2, false); wall(D, x0 + D / 2, z - L / 2, false); wall(L, x0 + D, z);
  // portail : piliers, linteau avec l'enseigne, deux battants bleus
  b.box(0.8, 4.6, 0.8, BRICK, x0, 2.3, z + 5).box(0.8, 4.6, 0.8, BRICK, x0, 2.3, z - 5).box(0.7, 1.0, 10.8, BRICK, x0, 4.6, z)
    .box(0.12, 2.5, 4.7, 0x2a4f7f, x0 + 0.25, 1.25, z + 2.4).box(0.12, 2.5, 4.7, 0x2a4f7f, x0 + 0.25, 1.25, z - 2.4);
  signs.add('socider', () => signTexture(name, sub, '#8a4b2a'), 9.4, 1.25, x0 - 0.4, 4.6, z, -Math.PI / 2, true);
  // cour, loge du gardien
  b.box(D - 0.8, 0.03, L - 0.8, 0x7d7870, x0 + D / 2, 0.015, z)
    .box(4, 3, 4, 0xf2f0e8, x0 + 3, 1.5, z + 9).box(4.8, 0.14, 4.8, 0x8c9196, x0 + 3, 3.1, z + 9).box(0.06, 1, 1.6, 0x2a3540, x0 + 0.97, 1.7, z + 9);
  // halls : murs en tôle grise, toit à deux pans rouillé, grande porte sur la cour
  for (const [hz, hl] of [[z + 20, 34], [z - 21, 32]]) {
    const hx = x0 + 25, hd = 22, hh = 10.5, a = 0.24;
    b.box(hd, hh, hl, 0x9aa1a8, hx, hh / 2, hz).box(0.1, 6.5, 7, 0x5f666d, hx - hd / 2 - 0.05, 3.25, hz);
    for (const e of [-1, 1]) b.box(hd / 2 / Math.cos(a) + 0.6, 0.16, hl + 0.8, pick([0x8a4b2a, 0x9c5a35, 0x7d4426]), hx + e * hd / 4, hh + hd / 4 * Math.tan(a), hz, 0, 0, -e * a);
  }
  // cheminée à bandes rouges et blanches, cuve
  for (let k = 0; k < 6; k++) b.cyl(1.25 - k * 0.07, 1.3 - k * 0.07, 4.2, k % 2 ? 0xf2efe8 : 0xc8102e, x0 + 35, 2.1 + k * 4.2, z - 2, 0, 0, 0, 12);
  b.cyl(2.4, 2.4, 5, 0x8e949a, x0 + 34, 2.5, z + 6, 0, 0, 0, 14);
  // ferraille et poutrelles empilées dans la cour
  for (let k = 0; k < 16; k++) b.box(rand(1.5, 4), rand(0.3, 1.2), rand(0.8, 2.5), pick([0x6b3e26, 0x8a4b2a, 0x5a5f66, 0x7d4426]), x0 + rand(6, 13), 0.4, z + rand(-36, 36), 0, rand(0, 3.14), 0);
}

// ----- Repères de Masina (l'auteur, 30/10, enrichis fidèlement d'après la vidéo Kulumba / Siforco / BKTF) -----
/** Tricycle motorisé (« keke » jaune ou bleu, omniprésent sur Kulumba et Siforco) cuit dans le décor. */
function addKeke(b, x, z, ry = 0, col = 0xf5c400) {
  const c = Math.cos(ry), s = Math.sin(ry), X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  b.box(1.22, 0.72, 1.55, col, X(0, -0.32), 0.62, Z(0, -0.32), 0, ry, 0)
    .box(1.26, 0.09, 2.08, 0x1a1d20, X(0, -0.1), 1.62, Z(0, -0.1), 0, ry, 0)
    .box(0.88, 0.65, 0.1, 0x9fd1e6, X(0, 0.68), 1.18, Z(0, 0.68), -0.18, ry, 0)
    .box(0.55, 0.58, 0.65, col, X(0, 0.65), 0.56, Z(0, 0.65), 0, ry, 0)
    .cyl(0.04, 0.04, 0.68, 0x222222, X(-0.56, -0.95), 1.28, Z(-0.56, -0.95), 0, ry, 0)
    .cyl(0.04, 0.04, 0.68, 0x222222, X(0.56, -0.95), 1.28, Z(0.56, -0.95), 0, ry, 0)
    .cyl(0.24, 0.24, 0.16, 0x1a1a1a, X(0, 0.98), 0.24, Z(0, 0.98), 0, ry, Math.PI / 2, 8)
    .cyl(0.24, 0.24, 0.16, 0x1a1a1a, X(-0.58, -0.7), 0.24, Z(-0.58, -0.7), 0, ry, Math.PI / 2, 8)
    .cyl(0.24, 0.24, 0.16, 0x1a1a1a, X(0.58, -0.7), 0.24, Z(0.58, -0.7), 0, ry, Math.PI / 2, 8);
}

/** Lampadaire solaire autonome (mât métallique gris, bras incliné, panneau photovoltaïque bleu incliné au sommet et bloc LED)
 *  qui borde les deux côtés de la Route Siforco (Avenue Bosango) et plusieurs tronçons d'Avenue Kulumba. */
function addMasinaSolarLamp(b, x, z, ry = 0) {
  const c = Math.cos(ry), s = Math.sin(ry), X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  b.cyl(0.09, 0.13, 7.6, 0x8e949a, x, 3.8, z)
    .box(1.3, 0.08, 0.08, 0x8e949a, X(-0.55, 0), 7.25, Z(-0.55, 0), 0, ry, 0.22)
    .box(0.55, 0.1, 0.28, 0xf2f2ec, X(-1.12, 0), 7.36, Z(-1.12, 0), 0, ry, 0)
    .box(0.75, 0.06, 1.05, 0x1a3a6e, X(0.05, 0), 7.75, Z(0.05, 0), 0.28, ry, 0)
    .box(0.79, 0.04, 1.09, 0xd8dce0, X(0.05, 0), 7.73, Z(0.05, 0), 0.28, ry, 0);
}

/** Petit marché couvert (Marché Hindou) : toit de tôle sur poteaux, étals et marchandises, enseigne sur la rue. */
function addMarketHall(F, S, f, w, d, name, sub) {
  const h = 3.4;
  for (const zz of [-w / 2 + 0.3, 0, w / 2 - 0.3]) for (const xx of [f + 0.3, f + d - 0.3]) F.cyl(0.08, 0.08, h, 0x6b5a4a, xx, h / 2, zz);
  F.box(d + 1, 0.1, w + 0.8, pick(TIN), f + d / 2, h + 0.1, 0, 0, 0, 0.08);
  for (let k = 0; k < 4; k++) {
    const zz = -w / 2 + (k + 0.5) * w / 4;
    F.box(d * 0.7, 0.8, 1.1, 0x7a5a3a, f + d / 2, 0.4, zz);
    for (let j = 0; j < 5; j++) F.box(0.35, 0.22, 0.35, pick(GOODS), f + d / 2 + rand(-d / 3, d / 3), 0.92, zz + rand(-0.35, 0.35));
  }
  S.add(`mas_${nameKey(name)}`, () => signTexture(name, sub, '#c8102e', '#fff', true), Math.min(w * 0.9, 6.5), 1.2, f - 0.1, h - 0.4, 0, -Math.PI / 2);
}

/** Grand Marché Kulumba (« COMMUNE DE MASINA · MARCHÉ KULUMBA », f_026_01m44s) : longue file de hangars en bois sombre et
 *  tôle ondulée à deux pans remplis d'étals, bassines colorées et parasols, avec le panneau métallique officiel sur deux
 *  poteaux surmonté d'un mégaphone haut-parleur blanc ! */
function addMarcheKulumba(F, S, f, w, d) {
  const nBays = 4, bayW = (w - 1) / nBays;
  for (let b = 0; b < nBays; b++) {
    const zc = -w / 2 + 0.5 + (b + 0.5) * bayW, h = 3.35, a = 0.24;
    for (const xx of [f + 0.6, f + d * 0.5, f + d - 0.6]) {
      for (const dz of [-bayW * 0.44, bayW * 0.44]) F.cyl(0.08, 0.09, h, 0x4a3828, xx, h / 2, zc + dz);
    }
    // Toit à deux pans en tôle sombre patinée
    for (const e of [-1, 1]) {
      F.box(d + 0.8, 0.1, (bayW * 0.54) / Math.cos(a), pick([0x4a433d, 0x5c4d42, 0x3d3a36]), f + d / 2, h + (bayW * 0.24) * Math.tan(a), zc + e * bayW * 0.24, e * a, 0, 0);
    }
    // Étals en bois chargés de vivres, sacs et bassines
    F.box(d * 0.78, 0.82, bayW * 0.68, 0x6b4c30, f + d / 2, 0.41, zc);
    for (let j = 0; j < 7; j++) {
      F.box(0.38, 0.26, 0.38, pick(GOODS), f + 1.2 + (j % 3) * (d * 0.28), 0.95, zc + (j - 3) * (bayW * 0.09));
    }
  }
  // Panneau officiel sur deux poteaux métalliques + mégaphone haut-parleur au sommet (f_026_01m44s)
  const sz = w / 2 - 2.6;
  F.cyl(0.07, 0.07, 4.1, 0x4a5058, f - 0.35, 2.05, sz - 1.35)
    .cyl(0.07, 0.07, 4.1, 0x4a5058, f - 0.35, 2.05, sz + 1.35)
    .box(0.14, 1.35, 3.1, 0xd8dce2, f - 0.35, 3.35, sz);
  // Mégaphone conique blanc perché sur tige au-dessus du panneau
  F.cyl(0.04, 0.04, 0.95, 0x4a5058, f - 0.35, 4.45, sz)
    .cyl(0.08, 0.32, 0.65, 0xf2efe8, f - 0.35, 4.95, sz, 0, 0, Math.PI / 2);
  S.add('mas_marche_kulumba_a', () => signTexture('MARCHÉ KULUMBA', 'Commune de Masina · Quartier Sans-Fil', '#e8eef5', '#1d4fa0'), 2.95, 1.22, f - 0.44, 3.35, sz, -Math.PI / 2, true);
  S.add('mas_marche_kulumba_b', () => signTexture('COMMUNE DE MASINA', 'Marché Kulumba', '#1d4fa0', '#ffffff'), 5.8, 1.05, f + 0.45, 3.45, 0, -Math.PI / 2);
}

/** Terrain Sademi 1 sur la Route Siforco (f_530_35m20s – f_538_35m52s) : soubassement en béton + haute grille métallique à
 *  barreaux verticaux le long de la rue, deux grandes tribunes couvertes à charpente métallique, structure conteneur à
 *  l'entrée avec escalier extérieur menant au toit-terrasse et fresque peinte (portrait), fûts bleus et grand portique
 *  publicitaire métallique à l'angle. */
function addPitch(F, S, f, W, L, name, sub) {
  const cx = f + 1.2 + W / 2;
  F.box(W + 2, 0.05, L + 2, 0x9a7a4a, cx, 0.025, 0);
  for (let k = 0; k < 8; k++) F.box(rand(3, 8), 0.03, rand(3, 10), pick([0x6f8f3e, 0x7d9a48]), cx + rand(-W / 3, W / 3), 0.055, rand(-L / 3, L / 3));
  const line = (w, d, x, z) => F.box(w, 0.02, d, 0xf2f2ec, x, 0.07, z);
  line(0.15, L, cx - W / 2, 0); line(0.15, L, cx + W / 2, 0); line(W, 0.15, cx, -L / 2); line(W, 0.15, cx, L / 2); line(W, 0.15, cx, 0);
  for (const e of [-1, 1]) {
    F.box(0.12, 2.2, 0.12, 0xf2f2f2, cx - 2.5, 1.1, e * L / 2).box(0.12, 2.2, 0.12, 0xf2f2f2, cx + 2.5, 1.1, e * L / 2)
      .box(5.1, 0.12, 0.12, 0xf2f2f2, cx, 2.2, e * L / 2);
  }
  // Clôture sur la Route Siforco : muret bas en béton gris + piliers + grille métallique ajourée (f_530, f_532)
  F.box(0.24, 0.85, L + 2, 0x9a968c, f + 0.2, 0.42, 0)
    .box(0.1, 0.08, L + 2, 0x2b3036, f + 0.2, 2.65, 0)
    .box(0.1, 0.08, L + 2, 0x2b3036, f + 0.2, 1.75, 0);
  for (let zz = -L / 2 - 0.8; zz <= L / 2 + 0.8; zz += 2.6) {
    F.box(0.32, 2.8, 0.32, 0x8e8a80, f + 0.2, 1.4, zz);
    for (const dzz of [-0.9, -0.45, 0, 0.45, 0.9]) {
      if (Math.abs(zz + dzz) < L / 2 + 0.9) F.box(0.05, 1.8, 0.05, 0x2b3036, f + 0.2, 1.75, zz + dzz);
    }
  }
  // Murs d'enceinte arrière et latéraux
  F.box(0.28, 2.2, L + 2, 0xd8d2c4, f + W + 2, 1.1, 0)
    .box(W + 2, 2.2, 0.28, 0xd8d2c4, cx, 1.1, L / 2 + 1)
    .box(W + 2, 2.2, 0.28, 0xd8d2c4, cx, 1.1, -L / 2 - 1);
  // Deux tribunes couvertes à charpente métallique (f_530, f_532)
  for (const tz of [-L * 0.24, L * 0.14]) {
    const tw = 9.5, td = 4.2, tx = f + 3.2;
    for (let s = 0; s < 3; s++) F.box(0.9, 0.45 * (s + 1), tw, 0x8c887e, tx + 1.1 - s * 0.9, 0.22 * (s + 1), tz);
    for (const dz of [-tw / 2 + 0.3, 0, tw / 2 - 0.3]) {
      F.box(0.14, 5.2, 0.14, 0x3a3f45, tx - 1.2, 2.6, tz + dz)
        .box(0.14, 4.4, 0.14, 0x3a3f45, tx + 1.8, 2.2, tz + dz);
    }
    F.box(td + 1.0, 0.14, tw + 0.8, 0x7a8086, tx + 0.3, 4.9, tz, 0, 0, -0.18);
  }
  // Bâtiment-conteneur d'entrée avec escalier métallique extérieur, garde-corps sur le toit, fresque et fûts bleus (f_536)
  const kz = L / 2 - 3.6, kx = f + 2.8;
  F.box(3.8, 3.1, 6.4, 0x3a4856, kx, 1.55, kz)
    .box(4.1, 0.18, 6.7, 0xc8c4ba, kx, 3.18, kz)
    .box(0.08, 0.95, 6.5, 0x22262a, kx - 1.9, 3.68, kz)
    .box(3.9, 0.95, 0.08, 0x22262a, kx, 3.68, kz + 3.25);
  // Escalier extérieur montant sur la dalle du conteneur
  for (let st = 0; st < 7; st++) {
    F.box(0.9, 0.12, 0.38, 0x22262a, kx - 1.2, 0.42 + st * 0.42, kz - 3.4 - st * 0.32);
  }
  // Fûts d'eau bleus alignés devant le conteneur
  for (const dz of [-1.8, -0.8, 0.2]) F.cyl(0.32, 0.32, 0.95, 0x0066cc, f - 0.35, 0.48, kz + dz);
  // Grand portique d'affichage métallique au coin de Sademi 1 (f_538)
  const gz = L / 2 + 0.4;
  F.box(0.22, 6.4, 0.22, 0x2b3036, f - 0.25, 3.2, gz - 2.4)
    .box(0.22, 6.4, 0.22, 0x2b3036, f - 0.25, 3.2, gz + 2.4)
    .box(0.28, 2.5, 5.2, 0x3a4048, f - 0.25, 5.1, gz);
  S.add(`mas_${nameKey(name)}`, () => signTexture(name, sub, '#1b7a3d', '#f5c400'), 4.9, 2.2, f - 0.42, 5.1, gz, -Math.PI / 2, true);
  S.add(`mas_sademi_mural`, () => signTexture('ESPACE SADEMI 1', 'Sport · Culture · Jeunesse de Masina', '#d97706', '#ffffff'), 4.6, 1.6, kx - 1.95, 1.85, kz, -Math.PI / 2, true);
}

/** Pharmacie à colonnade turquoise sur Kulumba (f_366_24m24s) ou au carrefour Bosango : façade blanche, piliers et auvent
 *  turquoise-vert, croix verte lumineuse, enseigne « PHARMACIE ». */
function addPharmacy(F, S, f, w, d) {
  const h = 3.6;
  F.box(d, h, w, 0xf4f6f4, f + d / 2, h / 2, 0)
    .box(d + 1.2, 0.28, w + 0.5, 0x1ca39c, f + d / 2 - 0.3, h + 0.14, 0)
    .box(0.06, 2.2, w * 0.55, 0x8fd3e8, f - 0.03, 1.15, 0);
  for (const zz of [-w / 2 + 0.35, 0, w / 2 - 0.35]) {
    F.box(0.28, h, 0.28, 0x1ca39c, f - 0.55, h / 2, zz);
  }
  F.box(0.12, 0.9, 0.3, 0x24c24a, f - 0.65, h + 0.65, w / 2 - 0.6)
    .box(0.12, 0.3, 0.9, 0x24c24a, f - 0.65, h + 0.65, w / 2 - 0.6);
  S.add('mas_pharmacie', () => signTexture('PHARMACIE', 'Médicaments · Conseils · Santé', '#1ca39c', '#ffffff'), Math.min(w * 0.9, 5.2), 0.98, f - 0.68, h - 0.42, 0, -Math.PI / 2);
}

/** Complexe Scolaire Saint François sur Kulumba (f_404_26m56s, à LM.school = 4833) : long mur de clôture blanc, jaune et
 *  bleu ciel avec grande inscription rouge « COMPLEXE SCOLAIRE SAINT FRANÇOIS » et ses 3 panneaux (« MATERNEL PRIMAIRE »,
 *  « COUTURE INFORMATIQUE ALPHABETISATION », « BIBLIOTHEQUE ATELIER »), portail bleu, bâtiment R+1 rose-saumon à coursive
 *  dans la cour et drapeau de la RDC. */
function addSmallSchool(F, S, f, w, d) {
  const gate = 2.8, l1 = w * 0.58, l2 = w - gate - l1, gz = -w / 2 + l1 + gate / 2;
  // Mur d'enceinte : soubassement bleu, panneau principal blanc/crème à bandeau jaune vif, portail métallique bleu
  F.box(0.26, 2.45, l1, 0xf7f5ec, f + 0.15, 1.22, -w / 2 + l1 / 2)
    .box(0.28, 0.55, l1, 0x1d63b8, f + 0.15, 0.28, -w / 2 + l1 / 2)
    .box(0.3, 0.28, l1, 0xf5c400, f + 0.15, 2.52, -w / 2 + l1 / 2);
  if (l2 > 0.3) {
    F.box(0.26, 2.45, l2, 0xe8f1f8, f + 0.15, 1.22, w / 2 - l2 / 2)
      .box(0.28, 0.55, l2, 0x1d63b8, f + 0.15, 0.28, w / 2 - l2 / 2)
      .box(0.3, 0.28, l2, 0xd62828, f + 0.15, 2.52, w / 2 - l2 / 2);
  }
  F.box(0.36, 2.85, 0.36, 0x1d63b8, f + 0.15, 1.42, gz - gate / 2)
    .box(0.36, 2.85, 0.36, 0x1d63b8, f + 0.15, 1.42, gz + gate / 2)
    .box(0.12, 2.3, gate, 0x1d4fa0, f + 0.2, 1.15, gz);
  // Bâtiment scolaire R+1 rose-saumon / corail au fond de la cour avec coursive à l'étage et toit de tôle (f_404)
  const cd = Math.min(7.5, d - 3.6), h = 6.4, bx = f + d - cd / 2;
  F.box(cd, h, w * 0.92, 0xe58c78, bx, h / 2, 0)
    .box(cd + 1.4, 0.18, w * 0.96, 0x8c9196, bx - 0.3, h + 0.25, 0, 0, 0, -0.09)
    .box(1.3, 0.18, w * 0.9, 0xd8d2c6, bx - cd / 2 - 0.6, 3.25, 0)
    .box(0.1, 0.92, w * 0.9, 0xe58c78, bx - cd / 2 - 1.2, 3.72, 0);
  for (let k = -2; k <= 2; k++) {
    const zz = k * w * 0.18;
    F.box(0.08, 2.1, 0.95, 0x2a3540, bx - cd / 2 - 0.04, 1.05, zz)
      .box(0.08, 2.0, 0.95, 0x2a3540, bx - cd / 2 - 0.04, 4.3, zz)
      .box(0.18, h, 0.18, 0xf2efe8, bx - cd / 2 - 1.15, h / 2, zz);
  }
  // Mât et couleurs du drapeau RDC dans la cour
  F.cyl(0.06, 0.08, 7.2, 0x9aa0a6, f + 2.2, 3.6, w / 2 - 1.2)
    .box(0.05, 0.65, 1.05, 0x007fff, f + 2.2, 6.75, w / 2 - 0.65)
    .box(0.06, 0.16, 1.06, 0xd62828, f + 2.2, 6.75, w / 2 - 0.65);
  S.add('mas_ecole_main', () => signTexture('COMPLEXE SCOLAIRE SAINT FRANÇOIS', 'Maternel · Primaire · Secondaire · Masina', '#f7f5ec', '#c8102e'), Math.min(l1 - 0.4, 8.2), 1.45, f - 0.02, 1.55, -w / 2 + l1 / 2, -Math.PI / 2, true);
  if (l2 > 1.8) {
    S.add('mas_ecole_sub', () => signTexture('COUTURE · INFORMATIQUE', 'Alphabétisation · Bibliothèque', '#f5c400', '#1d4fa0'), Math.min(l2 - 0.2, 3.6), 1.25, f - 0.02, 1.55, w / 2 - l2 / 2, -Math.PI / 2, true);
  }
}

/** Salle de fête / Espace Jaber Business & Brida à 2 niveaux (f_274_18m16s, LM.partyHall = 5238) : façade colorée jaune
 *  vif et violette, grandes portes, balcon, mur jaune « BRIDA » et boutique « SHOP JABER BUSINESS ». */
function addPartyHall(F, S, f, w, d) {
  const h = 7.2;
  F.box(d, h, w, 0xf5d033, f + d / 2, h / 2, 0).box(d + 0.6, 0.4, w + 0.6, 0x7b2cbf, f + d / 2, h + 0.2, 0)
    .box(0.08, 2.6, w * 0.45, 0x2a2a2a, f - 0.04, 1.3, 0)
    .box(1.4, 0.15, w * 0.8, 0xd8d3c6, f - 0.7, 3.7, 0).box(0.08, 0.9, w * 0.8, 0x1d4fa0, f - 1.36, 4.2, 0);
  for (const zz of [-w * 0.3, 0, w * 0.3]) F.box(0.06, 1.4, 1.6, 0x1e2d3d, f - 0.03, 5.4, zz);
  S.add('mas_salle_fete', () => signTexture('SALLE DE FÊTE · JABER BUSINESS', 'Réceptions · Shop & Galerie · Av. Révolution', '#1d4fa0', '#f5c400'), Math.min(w * 0.92, 7.6), 1.3, f - 0.06, 6.5, 0, -Math.PI / 2);
}

/** Galerie commerciale des Chinois sur Kulumba (f_288_19m12s, entre Avenue Révolution et Mayamba) : longue galerie
 *  commerciale en béton gris à hautes portes métalliques grises à double battant, large dalle de casquette blanche en
 *  porte-à-faux soutenue par des poteaux et vaste esplanade bétonnée devant les dépôts. */
function addChineseBldg(F, S, f, w, d) {
  const h = 5.4, n = Math.max(3, Math.floor(w / 3.8));
  // Esplanade bétonnée devant la galerie + corps principal gris + casquette blanche en porte-à-faux (f_288)
  F.box(d + 1.2, 0.12, w + 0.4, 0xb8b4aa, f + (d - 1.0) / 2, 0.06, 0)
    .box(d, h, w, 0x96999e, f + d / 2, h / 2, 0)
    .box(d + 1.4, 0.34, w + 0.6, 0xf2f2ee, f + d / 2 - 0.5, h + 0.17, 0)
    .box(0.22, 0.45, w + 0.6, 0xd8d8d2, f - 1.15, h - 0.1, 0);
  for (let k = 0; k < n; k++) {
    const zz = -w / 2 + (k + 0.5) * w / n;
    // Hautes portes métalliques grises à double battant + impostes grillagées + poteaux sous la casquette
    F.box(0.08, 3.2, w / n - 0.7, 0x5f656d, f - 0.04, 1.6, zz)
      .box(0.1, 3.2, 0.06, 0x2b3036, f - 0.05, 1.6, zz)
      .box(0.08, 0.85, w / n - 0.7, 0x353b42, f - 0.04, 4.15, zz)
      .box(0.24, h, 0.24, 0xbec2c6, f - 1.1, h / 2, zz - w / n / 2 + 0.15);
  }
  S.add('mas_chinois', () => signTexture('GALERIE & DÉPÔTS DES CHINOIS', 'Commerce Général · Gros & Détail · Kulumba', '#c8102e', '#f5c400'), Math.min(w * 0.85, 10), 1.15, f - 1.28, h + 0.15, 0, -Math.PI / 2);
}

/** Station SEGAP au carrefour de Kulumba et de la Route de BKTF (f_010_00m40s, f_012_00m48s) : auvent orange-rouge et
 *  blanc siglé « SEGAP », piliers rouges, îlots de pompes, mur de fond et boutique rayés jaune vif et bleu, et tricycle
 *  « keke » jaune stationné sur la piste. */
function addTotalStation(F, S, f, w, d) {
  const cx = f + 5.4, cw = Math.min(14.2, w - 0.8);
  // Dalle de piste + auvent blanc et orange-rouge SEGAP
  F.box(10.5, 0.06, w, 0x626468, cx, 0.03, 0)
    .box(9.2, 0.52, cw, 0xf4f4f0, cx, 5.2, 0)
    .box(9.4, 0.34, cw + 0.25, 0xe03c1f, cx, 4.92, 0)
    .box(9.45, 0.18, cw + 0.3, 0x1d4fa0, cx, 5.5, 0);
  for (const zz of [-cw / 2 + 2.4, cw / 2 - 2.4]) {
    F.box(0.44, 4.85, 0.44, 0xd62828, cx - 1.8, 2.42, zz)
      .box(0.44, 4.85, 0.44, 0xd62828, cx + 1.8, 2.42, zz)
      .box(2.8, 0.18, 0.95, 0xc8c4ba, cx, 0.09, zz)
      .box(0.85, 1.72, 0.65, 0xe03c1f, cx, 0.95, zz)
      .box(0.88, 0.48, 0.68, 0xf4f4f0, cx, 1.48, zz);
  }
  // Mur de fond et boutique aux bandes horizontales jaunes et bleues caractéristiques de la Station SEGAP (f_010, f_012)
  const bx = f + d - 2.8;
  F.box(4.8, 3.6, w * 0.88, 0xf5c400, bx, 1.8, 0)
    .box(4.86, 0.85, w * 0.89, 0x0055a4, bx, 0.45, 0)
    .box(4.86, 0.65, w * 0.89, 0x0055a4, bx, 2.15, 0)
    .box(5.2, 0.25, w * 0.92, 0xe03c1f, bx, 3.68, 0)
    .box(0.08, 2.1, 2.2, 0x1e2832, bx - 2.42, 1.05, -w * 0.18);
  // Totem SEGAP en bord de rue
  F.box(1.25, 5.2, 0.32, 0xe03c1f, f + 0.4, 2.6, -w / 2 + 1.2)
    .box(1.32, 1.1, 0.36, 0xf5c400, f + 0.4, 4.5, -w / 2 + 1.2);
  S.add('mas_segap_front', () => signTexture('SEGAP', 'Station-Service · Carburant & Lubrifiants', '#e03c1f', '#ffffff'), 8.6, 0.65, cx - 4.74, 5.18, 0, -Math.PI / 2, true);
  S.add('mas_segap_side', () => signTexture('STATION SEGAP', 'Kulumba × Route de BKTF', '#0055a4', '#f5c400'), 6.5, 0.62, cx, 5.18, -cw / 2 - 0.16, 0, true);
}

/** Centre Les Merveilles sur la Route de BKTF juste avant le croisement Kulumba (f_004_00m16s) : haut mur en béton gris
 *  avec barbelés, grand portail métallique noir à double battant avec rampe en béton sur le caniveau et banderole blanche
 *  « INSCRIPTIONS 2025-2026 · CENTRE LES MERVEILLES ». */
function addCentreMerveilles(F, S, f, w, d) {
  const gate = 3.8, l = (w - gate) / 2;
  F.box(0.3, 2.9, l, 0x9a9c9e, f + 0.2, 1.45, -w / 2 + l / 2)
    .box(0.3, 2.9, l, 0x9a9c9e, f + 0.2, 1.45, w / 2 - l / 2)
    .box(0.42, 3.3, 0.42, 0x85888c, f + 0.2, 1.65, -gate / 2)
    .box(0.42, 3.3, 0.42, 0x85888c, f + 0.2, 1.65, gate / 2)
    .box(0.14, 2.75, gate - 0.1, 0x1a1c20, f + 0.22, 1.38, 0)
    .box(1.6, 0.12, gate + 0.6, 0xb8b4aa, f - 0.6, 0.08, 0)
    // Bâtiment intérieur à toit en tôle derrière le mur
    .box(d - 3.5, 4.2, w * 0.86, 0xe8e4da, f + 2.8 + (d - 3.5) / 2, 2.1, 0)
    .box(d - 2.8, 0.16, w * 0.9, 0x7a8086, f + 2.8 + (d - 3.5) / 2, 4.35, 0, 0, 0, -0.08);
  S.add('mas_merveilles', () => signTexture('CENTRE LES MERVEILLES', 'Inscriptions 2025-2026 · Route de BKTF', '#ffffff', '#1d4fa0'), Math.min(l - 0.3, 5.4), 1.25, f + 0.02, 2.15, -w / 2 + l / 2, -Math.PI / 2, true);
}

/** Cliniques Dr. Alidor Kabangu · Maternité sur Kulumba (f_088_05m52s, vers s ≈ 6150) : façade blanche à soubassement
 *  bleu, deux disques rouges « (H) », portail bleu « MATERNITÉ », rampe/terrasse bétonnée avec chaises en plastique bleues. */
function addCliniqueKabangu(F, S, f, w, d) {
  const h = 3.9;
  F.box(d, h, w, 0xf7f8fa, f + d / 2, h / 2, 0)
    .box(d + 0.2, 1.05, w + 0.1, 0x1d5bb8, f + d / 2, 0.52, 0)
    .box(d + 1.0, 0.16, w + 0.5, 0x8c9196, f + d / 2 - 0.2, h + 0.15, 0, 0, 0, -0.08)
    // Portail bleu MATERNITÉ à droite + terrasse bétonnée surélevée
    .box(0.1, 2.35, 2.4, 0x1d5bb8, f - 0.04, 1.18, w / 2 - 1.6)
    .box(1.8, 0.22, w * 0.65, 0xc2bdb2, f - 0.85, 0.11, -w * 0.12);
  // Chaises en plastique bleues posées devant la clinique
  for (const zz of [-w * 0.32, -w * 0.12, w * 0.08]) {
    F.box(0.48, 0.45, 0.48, 0x1d63b8, f - 0.75, 0.44, zz)
      .box(0.08, 0.45, 0.48, 0x1d63b8, f - 0.52, 0.78, zz);
  }
  S.add('mas_kabangu', () => signTexture('(H) CLINIQUES DR. ALIDOR KABANGU (H)', 'Médecine Générale · Maternité · Labo', '#f7f8fa', '#c8102e'), Math.min(w * 0.88, 8.2), 1.15, f - 0.06, 3.05, -0.4, -Math.PI / 2, true);
}

/** Immeuble R+2 moderne blanc et terracotta/corail avec 2 citernes d'eau bleues sur le toit (f_088_05m52s, juste après la
 *  Clinique Kabangu) : 3 niveaux, balcons vitrés à garde-corps sombres, encadrements terracotta et réservoirs bleus. */
function addCoralR2Bldg(F, S, f, w, d) {
  const h = 9.8;
  F.box(d, h, w, 0xf4f3ee, f + d / 2, h / 2, 0)
    .box(d + 0.5, 0.35, w + 0.5, 0xd45d3a, f + d / 2, h + 0.18, 0)
    // Pilastres verticaux terracotta/corail en façade
    .box(0.35, h, 1.4, 0xd45d3a, f - 0.1, h / 2, -w / 2 + 0.8)
    .box(0.35, h, 1.4, 0xd45d3a, f - 0.1, h / 2, w / 2 - 0.8)
    .box(0.35, h, 1.1, 0xd45d3a, f - 0.1, h / 2, 0);
  for (const yh of [3.2, 6.4]) {
    F.box(1.35, 0.22, w * 0.86, 0xf4f3ee, f - 0.65, yh, 0)
      .box(0.08, 0.95, w * 0.84, 0x222830, f - 1.28, yh + 0.55, 0);
    for (const zz of [-w * 0.26, w * 0.26]) F.box(0.1, 1.6, 1.7, 0x1c2833, f - 0.05, yh + 1.1, zz);
  }
  // Deux citernes d'eau bleues cylindriques sur support au sommet du toit (f_088)
  for (const zz of [-1.4, 1.4]) {
    F.box(1.2, 0.8, 1.2, 0x3a3f45, f + 2.2, h + 0.55, zz)
      .cyl(0.68, 0.68, 1.45, 0x0066cc, f + 2.2, h + 1.65, zz);
  }
}

/** Immeuble commercial R+1 moderne blanc et bleu vif avec auvent en tôle bleue et conteneur bleu (f_072_04m48s). */
function addBlueWhiteR1Bldg(F, S, f, w, d) {
  const h = 6.8;
  F.box(d, h, w * 0.72, 0xf2f4f7, f + d / 2, h / 2, -w * 0.12)
    .box(d + 1.2, 0.55, w * 0.76, 0x0055cc, f + d / 2 - 0.3, h + 0.25, -w * 0.12)
    .box(1.3, 0.42, w * 0.76, 0x0055cc, f - 0.6, 3.35, -w * 0.12)
    .box(0.08, 0.92, w * 0.72, 0x0055cc, f - 1.18, 3.95, -w * 0.12);
  for (const zz of [-w * 0.34, -w * 0.12, w * 0.1]) {
    F.box(0.08, 2.3, 1.45, 0x2a3540, f - 0.04, 1.15, zz)
      .box(0.08, 1.4, 1.35, 0x1c2833, f - 0.04, 4.7, zz);
  }
  // Conteneur boutique bleu vif posé juste à côté (f_072)
  F.box(3.2, 2.7, w * 0.24, 0x0066cc, f + 1.8, 1.35, w * 0.36)
    .box(0.08, 2.1, w * 0.18, 0xf5c400, f + 0.18, 1.05, w * 0.36);
  S.add('mas_blue_r1', () => signTexture('ESPACE COMMERCIAL & BUREAUX', 'Avenue Kulumba · Masina', '#0055cc', '#ffffff'), Math.min(w * 0.68, 6.8), 0.95, f - 1.28, 3.38, -w * 0.12, -Math.PI / 2, true);
}

/** Flat Auberge Nzete ya Mbila & Collège Saint Paul Mutumba derrière le garde-corps du pont Mokali (f_170_11m20s). */
function addMokaliSchoolAndAuberge(F, S, f, w, d) {
  const w1 = w * 0.44, w2 = w * 0.52, z1 = -w / 2 + w1 / 2, z2 = w / 2 - w2 / 2;
  // 1) Flat Auberge Nzete ya Mbila : bâtiment vert menthe clair et blanc avec inscriptions rouges
  F.box(d * 0.85, 3.8, w1, 0xd8f0dc, f + d * 0.45, 1.9, z1)
    .box(d * 0.9, 0.22, w1 + 0.3, 0x2a9d8f, f + d * 0.45, 3.92, z1)
    .box(0.24, 2.2, w1, 0xd8f0dc, f + 0.2, 1.1, z1)
    .box(0.12, 2.0, 2.2, 0x8c2d19, f + 0.18, 1.0, z1);
  S.add('mas_nzete_mbila', () => signTexture('FLAT AUBERGE NZETE YA MBILA', 'Espace Détente · Calme et Fraîcheur', '#d8f0dc', '#c8102e'), Math.min(w1 - 0.3, 5.6), 1.2, f + 0.04, 1.65, z1, -Math.PI / 2, true);
  // 2) Collège Saint Paul Mutumba : immeuble scolaire R+1 blanc (2e niveau en briques/fers à béton) avec lettrage rouge
  const h = 6.6;
  F.box(d, h, w2, 0xf4f4f0, f + d / 2, h / 2, z2)
    .box(d + 0.4, 0.25, w2 + 0.3, 0x9a9c9e, f + d / 2, 3.4, z2)
    .box(d + 0.4, 0.22, w2 + 0.3, 0x9a9c9e, f + d / 2, h + 0.11, z2);
  for (let k = -1; k <= 1; k++) {
    const zz = z2 + k * w2 * 0.28;
    F.box(0.1, 1.3, 1.35, 0x22262a, f - 0.03, 1.8, zz)
      .box(0.1, 1.3, 1.35, 0x22262a, f - 0.03, 4.9, zz)
      .cyl(0.04, 0.04, 1.1, 0x5a4638, f + 0.5, h + 0.75, zz);
  }
  S.add('mas_mutumba', () => signTexture('COLLÈGE SAINT PAUL MUTUMBA', 'École Chrétienne Privée Agréée', '#f4f4f0', '#c8102e'), Math.min(w2 - 0.3, 6.6), 1.35, f - 0.06, 3.45, z2, -Math.PI / 2, true);
}

/** Immeuble R+3 (4 niveaux) à toit en pignon avec échafaudage en bois sur toute la façade et portes rouges au RDC,
 *  accompagné de l'immeuble R+2 brun-beige voisin (f_266_17m44s, vers s ≈ 5365). */
function addScaffoldR3Bldg(F, S, f, w, d) {
  const w1 = w * 0.54, w2 = w * 0.42, z1 = -w / 2 + w1 / 2, z2 = w / 2 - w2 / 2;
  // 1) Immeuble R+3 en briques grises avec pignon et échafaudage en perches de bois (f_266)
  const h1 = 12.2, a = 0.28;
  F.box(d, h1, w1, 0x8e908c, f + d / 2, h1 / 2, z1);
  for (const e of [-1, 1]) {
    F.box(d + 0.8, 0.16, (w1 * 0.54) / Math.cos(a), 0x7a7d82, f + d / 2, h1 + (w1 * 0.25) * Math.tan(a), z1 + e * w1 * 0.25, e * a, 0, 0);
  }
  for (const dz of [-w1 * 0.28, 0, w1 * 0.28]) {
    F.box(0.08, 2.35, 1.45, 0xa82020, f - 0.04, 1.18, z1 + dz);
    for (const yh of [4.6, 7.6, 10.5]) F.box(0.1, 1.35, 1.25, 0x1e2228, f - 0.04, yh, z1 + dz);
  }
  // Échafaudage en bois (montants verticaux et traverses horizontales devant la façade)
  for (let k = -2; k <= 2; k++) {
    F.cyl(0.05, 0.06, h1 + 0.6, 0x7c5c38, f - 0.75, (h1 + 0.6) / 2, z1 + k * w1 * 0.2);
  }
  for (const yh of [2.8, 5.6, 8.4, 11.2]) {
    F.box(0.85, 0.1, w1 * 0.92, 0x8a6842, f - 0.45, yh, z1);
  }
  // 2) Immeuble R+2 brun-beige à côté (f_266)
  const h2 = 9.4;
  F.box(d * 0.92, h2, w2, 0xb89872, f + d * 0.48, h2 / 2, z2)
    .box(d, 0.24, w2 + 0.4, 0x6b4c35, f + d * 0.48, h2 + 0.12, z2)
    .box(1.2, 0.18, w2 * 0.88, 0xd8c8b0, f - 0.55, 3.2, z2)
    .box(1.2, 0.18, w2 * 0.88, 0xd8c8b0, f - 0.55, 6.3, z2);
  for (const yh of [1.5, 4.7, 7.8]) {
    for (const dz of [-w2 * 0.25, w2 * 0.25]) F.box(0.08, 1.3, 1.3, 0x222830, f - 0.04, yh, z2 + dz);
  }
}

/** Dépôt Relais Pain d'Or, Salon Dodo et grand immeuble R+2 en parpaings gris à toit à croupe et tas de gravier devant,
 *  en face de la Galerie des Chinois (f_288_19m12s, vers s ≈ 5210). */
function addPainDorAndConcreteR2(F, S, f, w, d) {
  const wShop = w * 0.38, wBldg = w * 0.58, zS = -w / 2 + wShop / 2, zB = w / 2 - wBldg / 2;
  // 1) Dépôt Relais Pain d'Or (boutique brune à pignon) + Salon Dodo (kiosque vert)
  F.box(d * 0.65, 3.5, wShop * 0.56, 0x6e3b26, f + d * 0.35, 1.75, zS - wShop * 0.2)
    .box(d * 0.72, 0.15, wShop * 0.6, 0x8c4a2e, f + d * 0.35, 3.65, zS - wShop * 0.2, 0, 0, -0.1)
    .box(d * 0.55, 3.1, wShop * 0.4, 0x2e8b57, f + d * 0.3, 1.55, zS + wShop * 0.28);
  S.add('mas_pain_dor', () => signTexture('DÉPÔT RELAIS PAIN D\'OR', 'Boulangerie · Pâtisserie · Salon Dodo', '#6e3b26', '#f5c400'), Math.min(wShop - 0.2, 5.2), 1.05, f - 0.05, 3.0, zS, -Math.PI / 2, true);
  // 2) Grand immeuble R+2 en parpaings gris avec toit à croupe, lucarnes et tas de gravier/sable devant (f_288)
  const h = 9.4;
  F.box(d, h, wBldg, 0x8a8d91, f + d / 2, h / 2, zB)
    .box(d + 0.6, 0.28, wBldg + 0.4, 0xa4a6a8, f + d / 2, 3.2, zB)
    .box(d + 0.6, 0.28, wBldg + 0.4, 0xa4a6a8, f + d / 2, 6.3, zB)
    .box(d + 1.0, 1.35, wBldg + 0.6, 0x5c6066, f + d / 2, h + 0.68, zB);
  for (const yh of [1.5, 4.7, 7.8]) {
    for (const dz of [-wBldg * 0.3, 0, wBldg * 0.3]) F.box(0.1, 1.35, 1.35, 0x1e2226, f - 0.04, yh, zB + dz);
  }
  // Tas de gravier et de sable de chantier sur l'accotement devant l'immeuble
  F.add(new THREE.ConeGeometry(1.45, 0.85, 8), 0x8c8982, f - 0.9, 0.42, zB - 1.5)
    .add(new THREE.ConeGeometry(1.25, 0.72, 8), 0xb89c68, f - 0.85, 0.36, zB + 1.4);
}

/** Grand immeuble commercial R+2 (3 niveaux) orange-beige à grilles de fenêtres blanches, antennes paraboliques, portes
 *  rouges au RDC et camion Bracongo rouge garé devant (f_470_31m20s, vers s ≈ 4548). */
function addOrangeCommercialR2(F, S, f, w, d) {
  const h = 9.6, fB = f + 1.25, dB = d - 1.25;
  F.box(dB, h, w, 0xdf9b52, fB + dB / 2, h / 2, 0)
    .box(dB + 0.9, 0.32, w + 0.6, 0x8c4a27, fB + dB / 2 - 0.2, h + 0.16, 0)
    .box(1.2, 0.22, w + 0.3, 0xf2efe8, fB - 0.5, 3.3, 0)
    .box(1.2, 0.22, w + 0.3, 0xf2efe8, fB - 0.5, 6.45, 0);
  const cols = [-w * 0.34, -w * 0.11, w * 0.11, w * 0.34];
  for (const zz of cols) {
    // Portes métalliques rouges au RDC + fenêtres à grilles blanches aux étages (f_470)
    F.box(0.08, 2.45, 1.55, 0xb82020, fB - 0.04, 1.22, zz);
    for (const yh of [4.85, 8.0]) {
      F.box(0.1, 1.35, 1.45, 0xf4f4f0, fB - 0.04, yh, zz)
        .box(0.12, 1.15, 1.25, 0x222830, fB - 0.06, yh, zz);
    }
  }
  // Camion de boissons rouge vif (« Bracongo / Skol ») stationné sur l'esplanade devant l'immeuble (f_470_31m20s)
  const tx = f + 0.1, tz = -w * 0.15;
  F.box(1.85, 2.45, 5.0, 0xc8102e, tx, 1.6, tz)
    .box(1.75, 1.9, 2.0, 0xd62828, tx, 1.3, tz - 3.6)
    .box(1.65, 0.72, 0.1, 0x9fd1e6, tx, 1.7, tz - 4.6)
    .cyl(0.38, 0.38, 1.95, 0x1a1a1a, tx, 0.38, tz - 3.35, 0, 0, Math.PI / 2, 10)
    .cyl(0.38, 0.38, 1.95, 0x1a1a1a, tx, 0.38, tz + 1.3, 0, 0, Math.PI / 2, 10);
  S.add('mas_orange_r2', () => signTexture('GALERIE COMMERCIALE & DÉPÔT', 'Boissons · Alimentation · Kulumba', '#8c4a27', '#f5c400'), Math.min(w * 0.85, 8.4), 1.05, fB - 1.12, 3.35, 0, -Math.PI / 2, true);
}

/** Maison Grande Vision & Point de vente Canal+ au coin du carrefour Kulumba × Route Siforco (f_506_33m44s) : boutique
 *  d'angle bordeaux/grenat à auvent de tôle et enseigne « MAISON GRANDE VISION » + « CANAL+ », flanquée de l'immeuble R+2
 *  sombre en briques grises juste à côté. */
function addGrandeVisionCorner(F, S, f, w, d) {
  const w1 = w * 0.48, w2 = w * 0.48, z1 = -w / 2 + w1 / 2, z2 = w / 2 - w2 / 2;
  // 1) Boutique d'angle bordeaux « MAISON GRANDE VISION · CANAL+ »
  F.box(d * 0.78, 3.7, w1, 0x7a1c24, f + d * 0.4, 1.85, z1)
    .box(d * 0.95, 0.16, w1 + 0.8, 0x8c9196, f + d * 0.35, 3.82, z1, 0, 0, -0.1)
    .box(2.2, 0.1, w1 + 0.6, 0x5c6268, f - 1.0, 2.85, z1, 0, 0, -0.14)
    .box(0.08, 2.25, 2.1, 0x22262a, f - 0.04, 1.12, z1);
  S.add('mas_grande_vision', () => signTexture('MAISON GRANDE VISION', 'habillement · Accessoires · Coin Siforco', '#7a1c24', '#ffffff'), Math.min(w1 - 0.2, 5.8), 1.05, f - 0.06, 3.3, z1, -Math.PI / 2, true);
  S.add('mas_canal_plus', () => signTexture('CANAL+', 'Abonnement · Réabonnement · Décodeurs', '#111111', '#ffffff'), 2.6, 0.9, f - 0.08, 2.1, z1 - w1 * 0.28, -Math.PI / 2, true);
  // 2) Immeuble R+2 en béton gris sombre adjacent au carrefour (f_506)
  const h2 = 9.2;
  F.box(d, h2, w2, 0x6e7175, f + d / 2, h2 / 2, z2)
    .box(d + 0.5, 0.26, w2 + 0.4, 0x8e9196, f + d / 2, 3.1, z2)
    .box(d + 0.5, 0.26, w2 + 0.4, 0x8e9196, f + d / 2, 6.2, z2)
    .box(d + 0.6, 0.28, w2 + 0.5, 0x52565a, f + d / 2, h2 + 0.14, z2);
  for (const yh of [1.5, 4.6, 7.6]) {
    for (const dz of [-w2 * 0.24, w2 * 0.24]) F.box(0.1, 1.3, 1.3, 0x1c2024, f - 0.04, yh, z2 + dz);
  }
}

/** Complexe « SIFORCO D'ABORD · CHEZ MANDY » sur la Route Siforco (f_522_34m48s) : long bâtiment commercial jaune-ocre au
 *  rez-de-chaussée avec poteaux en béton d'un étage en construction sur la dalle, terrasse de chaises jaunes et rouges. */
function addSiforcoDabord(F, S, f, w, d) {
  const h = 3.8;
  F.box(d, h, w, 0xe8a828, f + d / 2, h / 2, 0)
    .box(d + 1.2, 0.26, w + 0.5, 0xb8b2a6, f + d / 2 - 0.4, h + 0.13, 0)
    .box(2.2, 0.12, w * 0.92, 0xc8c2b6, f - 1.0, 0.06, 0);
  // Poteaux de béton du 1er étage en attente sur la dalle supérieure (f_522)
  for (let k = -3; k <= 3; k++) {
    const zz = k * (w / 7);
    F.box(0.28, 2.7, 0.28, 0x9e9a90, f + 0.4, h + 0.26 + 1.35, zz)
      .box(0.28, 2.7, 0.28, 0x9e9a90, f + d - 0.6, h + 0.26 + 1.35, zz);
    if (Math.abs(k) <= 2) F.box(0.08, 2.3, 1.65, 0x5c3a24, f - 0.04, 1.15, zz);
  }
  // Chaises de terrasse jaunes et rouges devant « Chez Mandy »
  for (let k = -2; k <= 2; k++) {
    F.box(0.46, 0.44, 0.46, k % 2 === 0 ? 0xf5c400 : 0xd62828, f - 0.95, 0.28, k * 2.1);
  }
  S.add('mas_siforco_dabord', () => signTexture('SIFORCO D\'ABORD · CHEZ MANDY', 'Bar · Restaurant · Terrasse · Route Siforco', '#c8102e', '#f5c400'), Math.min(w * 0.88, 9.2), 1.18, f - 0.08, 3.25, 0, -Math.PI / 2, true);
}

/** Supermarché / Dépôt moderne à casquette bleu cyan vif et panneaux jaunes/verts sur la Route Siforco (f_544_36m16s). */
function addCyanSupermarket(F, S, f, w, d) {
  const h = 4.8;
  F.box(d, h, w, 0xf2f4f7, f + d / 2, h / 2, 0)
    .box(d + 1.8, 0.72, w + 0.8, 0x00a8e8, f + d / 2 - 0.6, h + 0.32, 0)
    .box(0.26, 0.9, w + 0.8, 0x0088cc, f - 1.35, h + 0.35, 0)
    .box(2.4, 0.14, w + 0.4, 0xc2bdb2, f - 1.1, 0.07, 0);
  for (const zz of [-w * 0.32, 0, w * 0.32]) {
    F.box(0.08, 2.6, 2.2, 0x1e2d3d, f - 0.04, 1.3, zz)
      .box(0.28, h, 0.28, 0x00a8e8, f - 1.25, h / 2, zz - 1.25);
  }
  S.add('mas_cyan_super', () => signTexture('SUPERMARCHÉ & ALIMENTATION SIFORCO', 'Vivres Frais · Boissons · Divers', '#f5c400', '#004488'), Math.min(w * 0.88, 8.8), 1.1, f - 1.52, h + 0.35, 0, -Math.PI / 2, true);
}

/** Maisons à étage à toit vert en croupe (f_554_36m56s, f_598_39m52s) et mur bleu Pepsi + boutique rouge Vodacom M-Pesa
 *  sur la Route Siforco. */
function addSiforcoGreenRoofHouse(F, S, f, w, d, withPepsiWall = false) {
  const wH = withPepsiWall ? w * 0.56 : w * 0.88, zH = withPepsiWall ? -w / 2 + wH / 2 : 0, h = 6.5, a = 0.3;
  // Mur de clôture bas + maison R+1 rose/beige à toit vert émeraude à deux pans
  F.box(0.24, 2.1, wH, 0xf2e8dc, f + 0.15, 1.05, zH)
    .box(0.12, 1.95, 2.6, 0x22303c, f + 0.18, 0.98, zH)
    .box(d - 2.2, h, wH * 0.9, 0xf0d5c8, f + 1.8 + (d - 2.2) / 2, h / 2, zH);
  for (const e of [-1, 1]) {
    F.box(d - 1.4, 0.18, (wH * 0.52) / Math.cos(a), 0x1b8a4b, f + 1.8 + (d - 2.2) / 2, h + (wH * 0.23) * Math.tan(a), zH + e * wH * 0.23, e * a, 0, 0);
  }
  for (const dz of [-wH * 0.24, wH * 0.24]) {
    F.box(0.08, 1.25, 1.25, 0x1e2832, f + 1.75, 4.7, zH + dz);
  }
  if (withPepsiWall) {
    // Mur publicitaire bleu vif « PEPSI » + boutique rouge « VODACOM M-PESA / COSMÉTIQUE » (f_558, f_562)
    const wP = w * 0.4, zP = w / 2 - wP / 2;
    F.box(d * 0.65, 3.5, wP, 0x004b93, f + d * 0.35, 1.75, zP)
      .box(d * 0.72, 0.18, wP + 0.4, 0xe31837, f + d * 0.35, 3.6, zP)
      .box(0.08, 2.2, 1.8, 0xe31837, f - 0.04, 1.1, zP + wP * 0.18);
    S.add(`mas_pepsi_voda_${Math.round(zP)}`, () => signTexture('PEPSI · VODACOM M-PESA', 'Cosmétique & Shop · Route Siforco', '#004b93', '#ffffff'), Math.min(wP - 0.2, 5.6), 1.15, f - 0.06, 2.65, zP, -Math.PI / 2, true);
  }
}

/** Pharmacie La Providence sur Kulumba juste après le pont Mokali (f_190_12m40s, vers s ≈ 5710) : boutique basse à long
 *  auvent de tôle ondulée surmonté du grand panneau blanc et rouge « PHARMACIE LA PROVIDENCE », avec parasol Winner Bet
 *  violet/jaune et tables d'étal en bois devant. */
function addPharmacieProvidence(F, S, f, w, d) {
  const h = 3.5;
  F.box(d, h, w, 0xf2efe8, f + d / 2, h / 2, 0)
    .box(d + 1.0, 0.14, w + 0.6, 0x6b5a4a, f + d / 2, h + 0.2, 0, 0, 0, -0.1)
    .box(1.4, 0.09, w * 0.94, 0x7a6858, f - 0.65, 2.75, 0, 0, 0, -0.15)
    .box(0.08, 2.2, 2.1, 0x1d6b3a, f - 0.04, 1.1, 0);
  // Poteaux de l'auvent + table en bois et parasol Winner Bet (violet et jaune, f_190)
  for (const dz of [-w * 0.4, 0, w * 0.4]) F.cyl(0.05, 0.05, 2.7, 0x4a3828, f - 1.15, 1.35, dz);
  F.box(0.95, 0.78, 1.35, 0x6b4c30, f - 0.75, 0.39, -w * 0.22)
    .cyl(0.04, 0.04, 2.3, 0x333333, f - 0.85, 1.15, w * 0.25)
    .add(new THREE.ConeGeometry(1.3, 0.55, 8), 0x4a154b, f - 0.85, 2.35, w * 0.25);
  S.add('mas_pharm_providence', () => signTexture('PHARMACIE LA PROVIDENCE', 'Médicaments · Soins · Kulumba', '#ffffff', '#c8102e'), Math.min(w * 0.86, 5.8), 1.25, f - 0.45, h + 0.65, 0, -Math.PI / 2, true);
}

/** Galerie commerciale à 3 pignons en tôle sombre et maison R+1 beige en retrait (f_215_14m20s, vers s ≈ 5580). */
function addTripleGableGallery(F, S, f, w, d) {
  const bayW = w / 3, h = 3.7, a = 0.3;
  F.box(d * 0.68, h, w, 0xe8e2d5, f + d * 0.34, h / 2, 0)
    .box(2.1, 0.09, w * 0.96, 0x8e949a, f - 0.95, 2.75, 0, 0, 0, -0.14);
  for (let b = 0; b < 3; b++) {
    const zc = -w / 2 + (b + 0.5) * bayW;
    for (const e of [-1, 1]) {
      F.box(d * 0.74, 0.12, (bayW * 0.54) / Math.cos(a), 0x3a3d42, f + d * 0.34, h + (bayW * 0.24) * Math.tan(a), zc + e * bayW * 0.24, e * a, 0, 0);
    }
    F.box(0.08, 2.25, bayW * 0.58, 0x5c2824, f - 0.04, 1.12, zc);
  }
  // Maison R+1 beige clair à toit en croupe qui s'élève en arrière-plan (f_215)
  F.box(d * 0.55, 6.8, w * 0.62, 0xf0e4ce, f + d * 0.72, 3.4, -w * 0.12)
    .box(d * 0.6, 0.85, w * 0.66, 0x555a60, f + d * 0.72, 7.2, -w * 0.12);
  S.add('mas_triple_gable', () => signTexture('GALERIE COMMERCIALE · KULUMBA', 'Boutiques · Airtel Money · Divers', '#8c2d19', '#ffffff'), Math.min(w * 0.82, 6.8), 0.98, f - 0.06, 3.25, 0, -Math.PI / 2, true);
}

/** Immeuble R+1 à grand pignon en façade et boutique « ANA SHOP ★ 5 ÉTOILES ★ JOVIAL » (f_240_16m00s, vers s ≈ 5465). */
function addAnaShopJovial(F, S, f, w, d) {
  const w1 = w * 0.56, w2 = w * 0.4, z1 = -w / 2 + w1 / 2, z2 = w / 2 - w2 / 2;
  // 1) Immeuble R+1 beige-gris à grand pignon sur rue et loggia supérieure (f_240)
  const h1 = 6.6, a = 0.28;
  F.box(d, h1, w1, 0xd8cec0, f + d / 2, h1 / 2, z1)
    .box(1.5, 0.18, w1 * 0.92, 0x9e9a90, f - 0.68, 3.25, z1);
  for (const e of [-1, 1]) {
    F.box(d + 0.8, 0.16, (w1 * 0.54) / Math.cos(a), 0x5c6066, f + d / 2, h1 + (w1 * 0.24) * Math.tan(a), z1 + e * w1 * 0.24, e * a, 0, 0);
  }
  for (const dz of [-w1 * 0.25, w1 * 0.25]) {
    F.box(0.08, 2.25, 1.5, 0x2b3036, f - 0.04, 1.12, z1 + dz)
      .box(0.1, 1.55, 1.4, 0x1e2228, f - 0.04, 4.75, z1 + dz);
  }
  // 2) Boutique « ANA SHOP ★ 5 ÉTOILES ★ JOVIAL » à pignon blanc (f_240)
  const h2 = 3.6;
  F.box(d * 0.72, h2, w2, 0xf4f4f0, f + d * 0.36, h2 / 2, z2)
    .box(d * 0.78, 0.14, w2 + 0.5, 0x7a8086, f + d * 0.36, h2 + 0.18, z2, 0, 0, -0.1)
    .box(0.08, 2.25, w2 * 0.55, 0x1d4fa0, f - 0.04, 1.12, z2);
  S.add('mas_ana_shop', () => signTexture('ANA SHOP ★ 5 ÉTOILES ★', 'Maison Jovial · Commerce Général', '#f4f4f0', '#1d4fa0'), Math.min(w2 - 0.2, 5.2), 1.1, f - 0.06, 3.15, z2, -Math.PI / 2, true);
}

/** Mur peint vert et blanc « CENTRE HOSPITALIER STELLA · ASBL ONGD » avec fourgonnette jaune garée devant (f_420_28m00s, vers s ≈ 4745). */
function addCentreStellaAndVan(F, S, f, w, d) {
  const fW = f + 1.15;
  // Long mur vert menthe et blanc avec inscriptions rouges et vertes + bâtiment hospitalier au fond
  F.box(0.28, 2.65, w, 0xd8f0dc, fW + 0.15, 1.32, 0)
    .box(0.32, 0.55, w, 0x2b3036, fW + 0.15, 0.28, 0)
    .box(0.12, 2.35, 2.8, 0x1d6b3a, fW + 0.18, 1.18, w * 0.28)
    .box(d - 3.6, 4.4, w * 0.86, 0xf4f6f4, f + 3.2 + (d - 3.6) / 2, 2.2, 0)
    .box(d - 2.8, 0.18, w * 0.9, 0x1d6b3a, f + 3.2 + (d - 3.6) / 2, 4.5, 0, 0, 0, -0.09);
  S.add('mas_stella_wall', () => signTexture('CENTRE HOSPITALIER STELLA · ASBL ONGD', 'Médecine · Pédiatrie · Maternité · Masina', '#d8f0dc', '#c8102e'), Math.min(w * 0.65, 7.8), 1.35, fW - 0.02, 1.65, -w * 0.14, -Math.PI / 2, true);
  // Fourgonnette jaune (« Mercedes / Renault ») stationnée sur l'accotement devant le mur (f_420_28m00s)
  const vx = f - 0.05, vz = -w * 0.15;
  F.box(1.75, 1.95, 4.5, 0xf5d033, vx, 1.28, vz)
    .box(1.68, 0.68, 0.1, 0x9fd1e6, vx, 1.62, vz - 2.24)
    .box(1.8, 0.36, 4.56, 0x22262a, vx, 0.48, vz)
    .cyl(0.35, 0.35, 1.85, 0x1a1a1a, vx, 0.35, vz - 1.4, 0, 0, Math.PI / 2, 10)
    .cyl(0.35, 0.35, 1.85, 0x1a1a1a, vx, 0.35, vz + 1.4, 0, 0, Math.PI / 2, 10);
}

/**
 * Boucle de Masina (croquis « Boucle de Masina », vrai tracé d'OSM à l'échelle du boulevard) : les routes (goudron pour la
 * boucle, terre pour les avenues de quartier), le ruisseau Mokali et les caniveaux (petits ponts), le chemin de fer,
 * SOCIDER au bout de l'Avenue Bosango, les repères de l'auteur et tous les bâtiments redessinés en 3D d'après la vidéo
 * (Route de BKTF → Avenue Kulumba → Route Siforco), les parcelles et boutiques le long de toutes les rues, les plaques de rue
 * et les panneaux qui ramènent au boulevard.
 * near / far : décor près du boulevard ou au loin (caché depuis le boulevard, voir follow) ; md : petits objets.
 */
function addMasina(near, far, md, signs, plates) {
  const O = MAS_OSM, MC = { at: (z, x = 0) => (x > 160 ? far : near).at(z) };
  const road = key => MAS_ROADS.find(r => r.key === key);
  const kul = road('kulumba'), bos = road('bosango'), tw = road('twana'), bk = road('bktf'), im = road('imbali');
  const zK0 = kul.pts[0][1], zK1 = kul.pts.at(-1)[1], zTop = MAS_Z0 + 40, zBot = MAS_Z1 - 40, grid = new MasGrid(720, zTop, zBot);
  const right = (ux, uz) => [-uz, ux], left = (ux, uz) => [uz, -ux];
  /** Point (x, z) et direction unitaire à t m du début de la route r ; arc(r, p) : distance le long de r jusqu'au point le plus proche de p. */
  const along = (r, t) => {
    let acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], c = r.pts[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (acc + L >= t || i === r.pts.length - 1) { const u = Math.max(0, Math.min(1, (t - acc) / L)); return { x: a[0] + (c[0] - a[0]) * u, z: a[1] + (c[1] - a[1]) * u, ux: (c[0] - a[0]) / L, uz: (c[1] - a[1]) / L }; }
      acc += L;
    }
  };
  const arc = (r, p) => {
    let acc = 0, best = Infinity, at = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], c = r.pts[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (c[0] - a[0]) + (p[1] - a[1]) * (c[1] - a[1])) / (L * L))), d = Math.hypot(p[0] - a[0] - (c[0] - a[0]) * t, p[1] - a[1] - (c[1] - a[1]) * t);
      if (d < best) { best = d; at = acc + L * t; }
      acc += L;
    }
    return at;
  };
  /** Construit build(F, S) dans le repère d'une parcelle (P, normale n vers la parcelle), si le sol est libre. */
  const spot = (P, n, f, w, d, build, check = true) => {
    const th = Math.atan2(-n[1], n[0]);
    if (check && !grid.rect(P.x, P.z, th, f + 0.6, f + d + 0.4, w / 2 + 0.3)) return false;
    grid.rect(P.x, P.z, th, f - 0.3, f + d + 0.4, w / 2 + 0.3, true);
    build(frame(MC.at(P.z, P.x), P.x, P.z, th), frameSigns(signs, P.x, P.z, th));
    return true;
  };
  const F0 = MAS_W / 2 + 2.2;                                                          // façades le long de la boucle
  const kulP = z => { const k = kulAt(z); return { x: k.x, z, ux: k.ux, uz: k.uz }; };
  for (const r of MAS_ROADS) r.dashes = r.key === 'bosango' || r.key === 'bktf' || r.key === 'kulumba' || r.key === 'twana';

  // --- sol occupé : rivières (la Bonamak s'arrête avant Kulumba), routes, ruisseaux
  const rivers = RIVERS.filter(r => r.z < zTop && r.z > zBot);
  for (const r of rivers) grid.box(0, r.z < zK0 && r.z > zK1 ? MAS_RIVER_END + 6 : 720, Math.ceil(r.z + r.w / 2 + 3), r.z - r.w / 2 - 3);
  for (const r of MAS_ROADS) for (let i = 1; i < r.pts.length; i++) {
    let a = r.pts[i - 1], c = r.pts[i];
    const rr = r.w / 2 + (r.paved ? 1.8 : 0.6), L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
    if (r.dead[0] && i === 1) a = [a[0] + ux * rr, a[1] + uz * rr];          // bout carré : la maison du fond s'y colle
    if (r.dead[1] && i === r.pts.length - 1) c = [c[0] - ux * rr, c[1] - uz * rr];
    grid.seg(a, c, rr);
  }
  // le Mokali (vrai cours, jusqu'à la Tshangu) ; les caniveaux d'OSM qui passent sous Kulumba (après l'Avenue Congo)
  const tshangu = RIVERS.find(r => r.name.includes('Tshangu'));
  const streams = [];
  for (const w of O.water.filter(w => w.name === 'Mokali')) {
    const pts = w.pts.map(mp).filter(p => p[0] > 62 && (!tshangu || p[1] > tshangu.z + tshangu.w / 2 + 3));
    if (pts.length > 1) streams.push({ pts, ww: 3.2 });
  }
  for (const w of O.water.filter(w => w.name !== 'Mokali')) {
    const pts = w.pts.map(mp);
    for (let j = 1; j < pts.length; j++) for (let i = 1; i < kul.pts.length; i++) {
      const p = segCross(kul.pts[i - 1], kul.pts[i], pts[j - 1], pts[j]);
      if (!p) continue;
      const k = kulAt(p[1]);                                                           // court caniveau en travers de Kulumba
      streams.push({ pts: [[p[0] - k.nx * 16, p[1] - k.nz * 16], [p[0] + k.nx * 16, p[1] + k.nz * 16]], ww: 1.8 });
    }
  }
  // le petit pont de l'Avenue Bosango, 20 m après le Marché Hindou (l'auteur) : le caniveau passe dessous en travers
  const hindouT = 14, culv = along(bos, hindouT + 11), cn = right(culv.ux, culv.uz);
  streams.push({ pts: [[culv.x - cn[0] * 14, culv.z - cn[1] * 14], [culv.x + cn[0] * 14, culv.z + cn[1] * 14]], ww: 1.8 });
  for (const s of streams) for (let i = 1; i < s.pts.length; i++) grid.seg(s.pts[i - 1], s.pts[i], s.ww / 2 + 1.2);
  const rail = O.rail.map(r => r.map(mp).map(([x, z]) => [x + 6, z])).filter(r => r.some(p => p[1] < bk.pts.at(-1)[1] + 80 && p[1] > bk.pts.at(-1)[1] - 120));
  for (const r of rail) for (let i = 1; i < r.length; i++) grid.seg(r[i - 1], r[i], 3);
  const sEnd = bos.pts.at(-1), xs = sEnd[0] + 0.6, zs = sEnd[1];                       // SOCIDER au bout de l'Avenue Bosango
  grid.box(Math.floor(xs - 1), 720, Math.ceil(zs + 44), zs - 44);

  // --- routes, ruisseaux et petits ponts, chemin de fer, SOCIDER, bouts de chaussée
  for (const r of MAS_ROADS) addMasinaRoad(MC, r, []);
  if (MAS_FUNNEL) flatPoly(near.at(MAS_FUNNEL[0][1]), MAS_FUNNEL, 0.046, MAS_ASPH);
  for (const s of streams) addStream(MC, s.pts, s.ww);
  for (const r of rail) addRailLine(MC, r);
  addRailLine(MC, [[xs + 46, zs + 60], [xs + 46, zs - 60]]);
  addSocider(MC, signs, xs, zs, ...MAS.socider);
  const mound = (x, z, w) => {
    MC.at(z, x).box(w, 0.7, 3, 0x9a5a34, x, 0.2, z);
    for (let k = 0; k < 5; k++) md.at(z).ball(rand(0.5, 0.9), pick([0x56893a, 0x3f7a34]), x + rand(-w / 2, w / 2), 0.6, z + rand(-1, 1), 1, 0.7, 1);
  };
  { const k = kulAt(zK1); mound(kul.pts.at(-1)[0] + k.ux * 1.6, zK1 + k.uz * 1.6, MAS_W + 2); }
  mound(im.pts[0][0], im.pts[0][1] + 1.6, 9);
  mound(im.pts.at(-1)[0], im.pts.at(-1)[1] - 1.6, 9);

  // --- repères de l'auteur et bâtiments réels de la vidéo (BKTF → Kulumba → Route Siforco), posés avant les parcelles ordinaires
  // 1) Route Siforco (Avenue Bosango) : Marché Hindou, Terrain Sademi 1, Siforco d'Abord / Chez Mandy, Supermarché cyan,
  //    maisons R+1 à toit vert et mur Pepsi / Vodacom M-Pesa
  { const P = along(bos, hindouT); spot(P, right(P.ux, P.uz), F0, 10, 8, (F, S) => addMarketHall(F, S, F0, 10, 8, 'MARCHÉ HINDOU', 'Avenue Bosango · Siforco')); }
  grid.box(0, 58, grid.zTop, zBot);                                                    // ensuite : rien sur les abords du boulevard
  const aJ = arc(bos, kul.pts[0]);
  for (const [dt, L] of [[0, 36], [-6, 32], [-12, 30], [-18, 28]]) {
    const P = along(bos, aJ - MAS_W / 2 - 4 - L / 2 + dt);
    if (spot(P, right(P.ux, P.uz), F0, L + 2, 26, (F, S) => addPitch(F, S, F0, 24, L, 'TERRAIN SADEMI 1', 'Football · Masina'))) break;
  }
  // En face de Sademi 1 sur la Route Siforco (côté nord / left(bos)) : « SIFORCO D'ABORD · CHEZ MANDY » (f_522) et Supermarché cyan (f_544)
  for (const t of [aJ - 18, aJ - 22, aJ - 26]) {
    const P = along(bos, t);
    if (spot(P, left(P.ux, P.uz), F0, 16, 11, (F, S) => addSiforcoDabord(F, S, F0, 16, 11))) break;
  }
  for (const t of [aJ - 44, aJ - 48, aJ - 52]) {
    const P = along(bos, t);
    if (spot(P, left(P.ux, P.uz), F0, 14, 11, (F, S) => addCyanSupermarket(F, S, F0, 14, 11))) break;
  }
  // Plus loin vers le boulevard sur la Route Siforco : maison R+1 à toit vert + mur Pepsi / Vodacom (f_554–f_562) à gauche en marchant (right(bos)),
  // et belles maisons R+1 à toit vert en croupe (f_598, f_626) à droite en marchant (left(bos))
  for (const t of [aJ - 68, aJ - 74, aJ - 80]) {
    const P = along(bos, t);
    if (spot(P, right(P.ux, P.uz), F0, 18, 12, (F, S) => addSiforcoGreenRoofHouse(F, S, F0, 18, 12, true))) break;
  }
  for (const t of [aJ - 72, aJ - 96, aJ - 118]) {
    const P = along(bos, t);
    spot(P, left(P.ux, P.uz), F0, 13, 11, (F, S) => addSiforcoGreenRoofHouse(F, S, F0, 13, 11, false));
  }

  // 2) Carrefour Kulumba × Route Siforco : « MAISON GRANDE VISION · CANAL+ » et immeuble R+2 gris sombre au coin (f_506_33m44s)
  for (const dz of [-14, -18, -22]) {
    const P = kulP(zK0 + dz);
    if (spot(P, right(P.ux, P.uz), F0, 15, 11, (F, S) => addGrandeVisionCorner(F, S, F0, 15, 11))) break;
  }
  // Pharmacie au coin de Bosango/Kulumba ET pharmacie à colonnade turquoise sur Kulumba après Mayamba (f_366_24m24s, vers s ≈ 4965)
  const pharm = (r, t, side, w = 5.5, d = 7.5) => { const P = along(r, t); return spot(P, side(P.ux, P.uz), F0, w, d, (F, S) => addPharmacy(F, S, F0, w, d)); };
  [8, 11, 14].some(t => pharm(bos, aJ + t, right)) || [[7.5, 5], [19.5, 4.5]].some(([t, w]) => pharm(kul, t, right, w))
    || [16, 22, 28].some(t => pharm(bos, aJ + t, left, 5, 5));
  for (const s of [4965, 4955, 4975]) {
    const P = kulP(mz(s));
    if (spot(P, left(P.ux, P.uz), F0, 7.5, 9, (F, S) => addPharmacy(F, S, F0, 7.5, 9))) break;
  }

  // 3) Kulumba entre Siforco et Avenue Congo :
  //    - Grand immeuble commercial R+2 orange-beige avec camion Bracongo (f_470_31m20s, s ≈ 4548)
  //    - Mur vert/blanc « CENTRE HOSPITALIER STELLA · ASBL ONGD » + fourgonnette jaune (f_420_28m00s, s ≈ 4745)
  //    - Complexe Scolaire Saint François à gauche après l'Avenue Congo (f_404_26m56s, LM.school = 4833)
  for (const s of [4548, 4538, 4558]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 16, 12, (F, S) => addOrangeCommercialR2(F, S, F0, 16, 12))) break;
  }
  for (const s of [4745, 4733, 4757]) {
    const P = kulP(mz(s));
    if (spot(P, left(P.ux, P.uz), F0, 15, 11, (F, S) => addCentreStellaAndVan(F, S, F0, 15, 11))) break;
  }
  const LM = MAS.landmarks ?? {};
  for (const w of [14, 12, 9]) { const P = kulP(mz(LM.school ?? 4833)); if (spot(P, left(P.ux, P.uz), F0, w, 12, (F, S) => addSmallSchool(F, S, F0, w, 12))) break; }

  // 4) Kulumba autour de Mayamba, Révolution et Sukambundu :
  //    - Salle de fête / Shop Jaber Business & Brida (f_274_18m16s, LM.partyHall = 5238)
  //    - Galerie & Dépôts des Chinois (f_288_19m12s, LM.chinese = 5291..5337) et Dépôt Relais Pain d'Or + R+2 parpaings gris en face (s ≈ 5210)
  //    - Immeuble R+3 avec échafaudage en bois + R+2 brun-beige (f_266_17m44s, s ≈ 5365)
  //    - Immeuble R+1 à grand pignon + « ANA SHOP ★ 5 ÉTOILES ★ JOVIAL » (f_240_16m00s, s ≈ 5465)
  //    - Galerie commerciale à 3 pignons en tôle sombre + maison R+1 beige (f_215_14m20s, s ≈ 5580)
  {
    const z0 = mz(LM.partyHall ?? 5238) - (MAS_SW / 2 + 0.6) - 4.6;
    let P = kulP(z0);
    for (const w of [8.5, 7]) if (spot(kulP(z0 - (8.5 - w) / 2), right(P.ux, P.uz), F0, w, 12, (F, S) => addPartyHall(F, S, F0, w, 12))) break;
    P = kulP(z0 - 4.25 - 0.4 - 2.1);
    spot(P, right(P.ux, P.uz), F0, 4.2, 10, (F, S) => addMasinaPlot(F, S, F0, 4.2, 10, 'parcel'));
  }
  // En face de Jaber Business (côté boulevard, left(kul)) : « ESPACE NDEKA HÔTEL · AV. RÉVOLUTION N°15 » (f_274_18m16s)
  for (const s of [5268, 5258, 5278]) {
    const P = kulP(mz(s));
    if (spot(P, left(P.ux, P.uz), F0, 12, 10, (F, S) => {
      F.box(0.26, 2.3, 12, 0xf2efe8, F0 + 0.15, 1.15, 0).box(0.12, 2.1, 3.0, 0x1d4fa0, F0 + 0.18, 1.05, 0)
        .box(7.5, 6.4, 10.5, 0xf5e6c8, F0 + 5.5, 3.2, 0).box(8.1, 0.25, 11.1, 0x8c3b2b, F0 + 5.5, 6.5, 0);
      S.add('mas_ndeka_hotel', () => signTexture('ESPACE NDEKA HÔTEL ← 45m', 'Hébergement · Bar · Av. Révolution N°15', '#1d4fa0', '#f5c400'), 6.2, 1.25, F0 - 0.04, 2.55, 0, -Math.PI / 2, true);
    })) break;
  }
  {
    const [sa, sb] = LM.chinese ?? [5291, 5337], za = mz(sa), zb = mz(sb), wz = Math.abs(za - zb) - MAS_SW - 1.4;
    const P = kulP((za + zb) / 2);
    for (const w of [wz, wz - 2, 8]) if (w > 5 && spot(P, right(P.ux, P.uz), F0, w, 13, (F, S) => addChineseBldg(F, S, F0, w, 13))) break;
  }
  for (const s of [5205, 5195, 5215]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 16, 12, (F, S) => addPainDorAndConcreteR2(F, S, F0, 16, 12))) break;
  }
  for (const s of [5368, 5358, 5378]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 16, 12, (F, S) => addScaffoldR3Bldg(F, S, F0, 16, 12))) break;
  }
  for (const s of [5465, 5452, 5478]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 15, 11, (F, S) => addAnaShopJovial(F, S, F0, 15, 11))) break;
  }
  for (const s of [5580, 5568, 5592]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 16, 12, (F, S) => addTripleGableGallery(F, S, F0, 16, 12))) break;
  }

  // 5) Zone du Pont de la rivière Mokali :
  //    - « PHARMACIE LA PROVIDENCE » & parasol Winner Bet (f_190_12m40s, s ≈ 5710)
  //    - « FLAT AUBERGE NZETE YA MBILA » & « COLLÈGE SAINT PAUL MUTUMBA » (f_170_11m20s, s ≈ 5805)
  for (const s of [5710, 5698, 5722]) {
    const P = kulP(mz(s));
    if (spot(P, left(P.ux, P.uz), F0, 12, 10, (F, S) => addPharmacieProvidence(F, S, F0, 12, 10))) break;
  }
  for (const s of [5805, 5792, 5818]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 18, 12, (F, S) => addMokaliSchoolAndAuberge(F, S, F0, 18, 12))) break;
  }

  // 6) Kulumba entre BKTF et le Pont Mokali :
  //    - Cliniques Dr. Alidor Kabangu · Maternité (f_088_05m52s, s ≈ 6152) + Immeuble R+2 blanc & terracotta à citernes bleues (s ≈ 6118)
  //    - Immeuble R+1 moderne blanc & bleu vif + conteneur bleu (f_072_04m48s, s ≈ 6240)
  //    - Grand Marché Kulumba (« COMMUNE DE MASINA · MARCHÉ KULUMBA » avec mégaphone haut-parleur, f_026_01m44s, s ≈ 6468)
  for (const s of [6152, 6142, 6162]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 13, 11, (F, S) => addCliniqueKabangu(F, S, F0, 13, 11))) break;
  }
  for (const s of [6118, 6108, 6128]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 12, 12, (F, S) => addCoralR2Bldg(F, S, F0, 12, 12))) break;
  }
  for (const s of [6240, 6228, 6252]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 15, 11, (F, S) => addBlueWhiteR1Bldg(F, S, F0, 15, 11))) break;
  }
  for (const s of [6468, 6456, 6480]) {
    const P = kulP(mz(s));
    if (spot(P, right(P.ux, P.uz), F0, 22, 11, (F, S) => addMarcheKulumba(F, S, F0, 22, 11))) break;
  }

  // 7) Carrefour Route de BKTF × Avenue Kulumba :
  //    - Station SEGAP au carrefour (f_010_00m40s, f_012_00m48s)
  //    - Centre Les Merveilles sur la Route de BKTF juste avant Kulumba (f_004_00m16s)
  const bkJ = bk.pts.reduce((m, p) => (Math.abs(p[0] - kulAt(p[1]).x) < Math.abs(m[0] - kulAt(m[1]).x) ? p : m));
  for (const dz of [17, 19, 21, 23]) {
    const P = kulP(bkJ[1] + dz);
    if (spot(P, right(P.ux, P.uz), F0, 15, 13, (F, S) => addTotalStation(F, S, F0, 15, 13))) break;
  }
  const bkLen = arc(bk, bkJ);
  for (const dt of [22, 28, 34]) {
    const P = along(bk, Math.max(18, bkLen - dt));
    if (spot(P, right(P.ux, P.uz), F0, 14, 11, (F, S) => addCentreMerveilles(F, S, F0, 14, 11))) break;
  }

  // --- panneaux de direction sur Kulumba (place réservée avant les maisons)
  const dirs = [];
  const dir = (key, zj, sub, ahead = true, back = true) => {
    for (const [on, k, dz, e, title] of [[ahead, 'a', 13, 1, '← BD LUMUMBA'], [back, 'b', -13, -1, 'BD LUMUMBA →']]) {
      if (!on) continue;
      const q = kulAt(zj + dz), n = right(q.ux, q.uz), off = (MAS_W / 2 + 3.2) * e;
      const ry = e > 0 ? Math.atan2(-q.ux, -q.uz) : Math.atan2(q.ux, q.uz);
      dirs.push({ key: `${key}_${k}`, x: q.x + n[0] * off, z: zj + dz + n[1] * off, ry, title, sub });
    }
  };
  dir('sif', zK0, 'Entrée Siforco · SOCIDER ←', false, true);
  dir('twana', tw.pts.at(-1)[1], 'Par l\'Avenue Twana');
  dir('bktf', bkJ[1], 'Entrée BKTF · Maison Communale');
  for (const d of dirs) grid.box(Math.floor(d.x - 2.4), Math.ceil(d.x + 2.4), Math.ceil(d.z + 1.2), d.z - 1.2);

  // --- parcelles et bâtiments 3D le long de Kulumba, Route Siforco (Bosango), Route de BKTF, Twana, Imbali et des avenues
  const jz = [...MAS_STREETS.map(s => s.z), tw.pts.at(-1)[1], bkJ[1], zK0];
  const nearJ = z => jz.some(j => Math.abs(j - z) < 9);
  const plain = () => pick(['parcel', 'parcel', 'house']);
  const kindKul = (side, z) => {
    if (side < 0 && (z > zK0 - 45 || (z < mz(5238) + 5 && z > mz(5345)))) return chance(0.65) ? 'shop' : 'gabled_shop';
    return nearJ(z)
      ? pick(['shop', 'gabled_shop', 'hipped_r1'])
      : pick(['shop', 'gabled_shop', 'unfinished', 'hipped_r1', 'balcony_r1', 'shop', 'parcel', 'house']);
  };
  for (let i = 1; i < kul.pts.length; i++) {
    const a = kul.pts[i - 1], c = kul.pts[i];
    placeAlong(MC, signs, grid, a, c, 1, F0, 8, 13, z => kindKul(-1, z));               // (e = 1 : côté boulevard, à gauche)
    placeAlong(MC, signs, grid, a, c, -1, F0, 8, 13, z => kindKul(1, z));
  }
  const nearBosJ = (x, z) => Math.hypot(x - kul.pts[0][0], z - kul.pts[0][1]) < 90;
  for (const r of [bos, tw, bk]) for (let i = 1; i < r.pts.length; i++) {
    for (const e of [1, -1]) placeAlong(MC, signs, grid, r.pts[i - 1], r.pts[i], e, F0, 7, 12,
      z => (r === bos && e > 0 && nearBosJ(r.pts[i][0], z)
        ? pick(['shop', 'gabled_shop', 'hipped_r1'])
        : r === bos || r === bk
          ? pick(['shop', 'gabled_shop', 'hipped_r1', 'balcony_r1', 'unfinished', 'parcel', 'house'])
          : chance(0.45) ? 'shop' : plain()));
  }
  const streets = MAS_ROADS.filter(r => r.key === 'street');
  for (const r of streets) {                                                               // maison qui ferme l'avenue au fond
    const [a, c] = r.pts, Ls = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / Ls, uz = (c[1] - a[1]) / Ls;
    for (const w of [10, 7.5]) if (spot({ x: c[0], z: c[1] }, [ux, uz], 0.6, w, rand(7, 9), (F, S) => addMasinaPlot(F, S, 0.6, w, 8, plain()))) break;
  }
  for (const r of streets) for (const e of [1, -1]) placeAlong(MC, signs, grid, r.pts[0], r.pts[1], e, MAS_SW / 2 + 1, 6, 10, plain);
  for (let i = 1; i < im.pts.length; i++) placeAlong(MC, signs, grid, im.pts[i - 1], im.pts[i], 1, 3.5 + 1.2, 6, 10, plain);

  // --- plaques de rue (l'avenue qui croise, et Kulumba) à chaque carrefour nommé ; Bosango et Twana aussi ; Quartier 3 / 2
  const plate = (x, z, name, d, k) => {                 // d : direction de l'avenue qui croise ; k : direction de Kulumba
    md.at(z).box(0.09, 3.3, 0.09, 0x8e949a, x, 1.65, z);
    if (name) for (const e of [0, Math.PI]) plates.add(name, 1.75, 0.42, x, 2.75, z, Math.atan2(-d[1], d[0]) + e);
    for (const e of [0, Math.PI]) plates.add('AV. KULUMBA', 1.75, 0.42, x, 3.2, z, Math.atan2(-k[1], k[0]) + e);
  };
  for (const st of MAS_STREETS) {
    if (!st.name) continue;
    const s0 = st.sides[0], k = kulAt(st.z), n = [k.nx * s0.side, k.nz * s0.side], off = MAS_W / 2 + 1.2, back = MAS_SW / 2 + 1;
    plate(st.x + n[0] * off - k.ux * back, st.z + n[1] * off - k.uz * back, `AV. ${st.name}`, s0.dir, [k.ux, k.uz]);
  }
  {
    const k = kulAt(zK0), b0 = along(bos, aJ + 6), bn = left(b0.ux, b0.uz);
    plate(b0.x + bn[0] * (MAS_W / 2 + 1.4), b0.z + bn[1] * (MAS_W / 2 + 1.4), 'AV. BOSANGO', [b0.ux, b0.uz], [k.ux, k.uz]);
    const tj = tw.pts.at(-1), kt = kulAt(tj[1]), t0 = along(tw, arc(tw, tj) - 6), tn = left(t0.ux, t0.uz);
    plate(t0.x + tn[0] * (MAS_W / 2 + 1.4), t0.z + tn[1] * (MAS_W / 2 + 1.4), 'AV. TWANA', [t0.ux, t0.uz], [kt.ux, kt.uz]);
    const kb = kulAt(bkJ[1]), b1 = along(bk, arc(bk, bkJ) - 6), b1n = left(b1.ux, b1.uz);
    plate(b1.x + b1n[0] * (MAS_W / 2 + 1.4), b1.z + b1n[1] * (MAS_W / 2 + 1.4), null, [b1.ux, b1.uz], [kb.ux, kb.uz]);
  }
  for (const s of streams.filter(s => s.ww > 3)) for (let j = 1; j < s.pts.length; j++) for (let i = 1; i < kul.pts.length; i++) {
    const p = segCross(kul.pts[i - 1], kul.pts[i], s.pts[j - 1], s.pts[j]);
    if (!p) continue;                                   // le pont du Mokali relie le Quartier 3 (côté aéroport) et le Quartier 2
    for (const [dz, e, txt] of [[8, 1, 'QUARTIER 2'], [-8, -1, 'QUARTIER 3']]) {
      const q = kulAt(p[1] + dz), n = right(q.ux, q.uz), x = q.x + n[0] * (MAS_W / 2 + 1.3) * e, z = p[1] + dz + n[1] * (MAS_W / 2 + 1.3) * e;
      md.at(z).box(0.09, 2.9, 0.09, 0x8e949a, x, 1.45, z);
      plates.add(txt, 1.75, 0.42, x, 2.65, z, e > 0 ? Math.atan2(-q.ux, -q.uz) : Math.atan2(q.ux, q.uz));
    }
  }
  for (const d of dirs) {
    const cx = Math.cos(d.ry), sx = -Math.sin(d.ry);
    MC.at(d.z, d.x).box(0.14, 3.4, 0.14, 0x8e949a, d.x - cx * 1.3, 1.7, d.z - sx * 1.3).box(0.14, 3.4, 0.14, 0x8e949a, d.x + cx * 1.3, 1.7, d.z + sx * 1.3);
    signs.add(`mas_dir_${d.key}`, () => signTexture(d.title, d.sub, '#1d6b3a'), 3.6, 1.1, d.x + Math.sin(d.ry) * 0.09, 2.95, d.z + Math.cos(d.ry) * 0.09, d.ry, true);
  }

  // --- lampadaires solaires sur la Route Siforco (Bosango) et Kulumba, banderoles aériennes, poteaux électriques,
  //     tricycles « keke » jaunes/bleus/rouges/verts, vendeuses sous parasol, passants et voitures garées
  for (let t = 18; t < aJ - 10; t += 24) {
    const P = along(bos, t), nr = right(P.ux, P.uz), nl = left(P.ux, P.uz), ry = Math.atan2(P.ux, P.uz);
    addMasinaSolarLamp(MC.at(P.z, P.x), P.x + nr[0] * (MAS_W / 2 + 1.45), P.z + nr[1] * (MAS_W / 2 + 1.45), ry);
    addMasinaSolarLamp(MC.at(P.z, P.x), P.x + nl[0] * (MAS_W / 2 + 1.45), P.z + nl[1] * (MAS_W / 2 + 1.45), ry + Math.PI);
  }
  for (let t = 16; t < bkLen - 12; t += 28) {
    const P = along(bk, t), nr = right(P.ux, P.uz), ry = Math.atan2(P.ux, P.uz);
    addMasinaSolarLamp(MC.at(P.z, P.x), P.x + nr[0] * (MAS_W / 2 + 1.45), P.z + nr[1] * (MAS_W / 2 + 1.45), ry);
  }
  // Banderoles aériennes en tissu tendues en travers de la chaussée (comme « FLASH ! ANNÉE SCOLAIRE 2025-2026 C.S. PATY MUBENGA », f_486, et « COLLÈGE PATMOS », f_420)
  for (const [key, sPos, txt, sub, bg, fg] of [
    ['ban_paty', 4532, 'FLASH ! ANNÉE SCOLAIRE 2025-2026', 'Complexe Scolaire Paty Mubenga · Inscriptions', '#ffffff', '#c8102e'],
    ['ban_patmos', 4735, 'COLLÈGE PATMOS · MASINA', 'Maternel · Primaire · Secondaire & Humanités', '#f8f6f0', '#b81d24'],
    ['ban_mas', 5248, 'BIENVENUE SUR L\'AVENUE KULUMBA', 'Commune de Masina · Quartier Sans-Fil', '#f5c400', '#1d4fa0'],
    ['ban_bktf', 6488, 'MARCHÉ KULUMBA · MASINA', 'Commerce · Transport · Artisanat', '#1d6b3a', '#ffffff'],
  ]) {
    const q = kulAt(mz(sPos)), ry = Math.atan2(q.ux, q.uz), span = MAS_W + 2.8;
    for (const e of [-1, 1]) {
      MC.at(q.z, q.x).cyl(0.06, 0.07, 6.6, 0x555a60, q.x + q.nx * e * (span / 2), 3.3, q.z + q.nz * e * (span / 2));
    }
    MC.at(q.z, q.x).box(span, 0.03, 0.03, 0x222222, q.x, 6.25, q.z, 0, ry, 0);
    for (const [suf, a] of [['a', ry], ['b', ry + Math.PI]]) {
      signs.add(`${key}_${suf}`, () => signTexture(txt, sub, bg, fg), 6.4, 1.05, q.x, 5.65, q.z, a, true);
    }
  }

  const open = z => nearJ(z) || streams.some(s => s.pts.some((p, i) => i > 0 && segDist(kulAt(z).x, z, s.pts[i - 1], p) < 5)) || dirs.some(d => Math.abs(d.z - z) < 3);
  let prev = null;
  for (let z = zK0 - 12; z > zK1 + 8; z -= 30) {
    const k = kulAt(z), x = k.x - k.nx * (MAS_W / 2 + 1.7), zz = z - k.nz * (MAS_W / 2 + 1.7);
    if (open(z)) { prev = null; continue; }
    MC.at(zz, x).cyl(0.11, 0.15, 9, chance(0.5) ? 0x5d4a38 : 0x9a958a, x, 4.5, zz).box(1.4, 0.1, 0.1, 0x4a3a2a, x, 8.4, zz, 0, Math.atan2(k.ux, k.uz), 0);
    // Lampadaire solaire côté intérieur en alternance sur Kulumba
    if (Math.round(z) % 60 < 30) {
      addMasinaSolarLamp(MC.at(z, k.x), k.x + k.nx * (MAS_W / 2 + 1.5), z + k.nz * (MAS_W / 2 + 1.5), Math.atan2(k.ux, k.uz));
    }
    if (prev) {
      const dx = x - prev[0], dz = zz - prev[1], L = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
      for (const o of [-0.6, 0, 0.6]) md.at(zz).box(0.03, 0.03, L, 0x1a1a1a, (x + prev[0]) / 2 + Math.cos(ry) * o, 8.15, (zz + prev[1]) / 2 - Math.sin(ry) * o, 0, ry, 0);
    }
    prev = [x, zz];
  }
  const kekeCols = [0xf5c400, 0xf5c400, 0x0066cc, 0xc8102e, 0x1b8a4b];
  for (let z = zK0 - 6; z > zK1 + 6; z -= rand(8, 17)) {
    if (open(z)) continue;
    const k = kulAt(z), e = chance(0.5) ? 1 : -1, off = (MAS_W / 2 + rand(0.6, 1.4)) * e, x = k.x + k.nx * off, zz = z + k.nz * off, d = md.at(zz);
    const r = Math.random(), ry = Math.atan2(k.ux, k.uz);
    if (r < 0.44) addPerson(d, x, zz, { ry: chance(0.5) ? ry : ry + Math.PI });
    else if (r < 0.64) {                                                                  // vendeuse sous un parasol
      d.box(1.1, 0.75, 0.7, 0x6b4f2a, x, 0.38, zz, 0, ry, 0).cyl(0.04, 0.04, 2.2, 0x555555, x, 1.1, zz + 0.6)
        .add(new THREE.ConeGeometry(1.4, 0.6, 8), pick(UMBRELLAS), x, 2.3, zz + 0.6);
      for (let j = 0; j < 3; j++) d.box(0.25, 0.18, 0.25, pick(GOODS), x + rand(-0.4, 0.4), 0.85, zz + rand(-0.25, 0.25));
      addPerson(d, x + k.nx * 0.9 * e, zz + k.nz * 0.9 * e, { sitting: true, ry: ry + e * Math.PI / 2 });
    } else if (r < 0.78) {                                                                // tricycle « keke » (omniprésent dans la vidéo)
      addKeke(MC.at(zz, x), k.x + k.nx * (MAS_W / 2 + 0.75) * e, z + k.nz * (MAS_W / 2 + 0.75) * e, e > 0 ? ry : ry + Math.PI, pick(kekeCols));
    } else if (r < 0.88) addParkedCar(MC.at(zz, x), k.x + k.nx * (MAS_W / 2 + 0.9) * e, z + k.nz * (MAS_W / 2 + 0.9) * e, ry);
  }
  // Vie urbaine, tricycles « keke » et vendeuses le long de la Route Siforco (Avenue Bosango) et de la Route de BKTF
  for (let t = 16; t < aJ - 8; t += rand(11, 20)) {
    const P = along(bos, t), e = chance(0.5) ? 1 : -1, n = e > 0 ? right(P.ux, P.uz) : left(P.ux, P.uz), ry = Math.atan2(P.ux, P.uz);
    const x = P.x + n[0] * (MAS_W / 2 + 1.0), zz = P.z + n[1] * (MAS_W / 2 + 1.0), d = md.at(zz);
    if (chance(0.45)) addPerson(d, x, zz, { ry: chance(0.5) ? ry : ry + Math.PI });
    else if (chance(0.6)) addKeke(MC.at(zz, x), P.x + n[0] * (MAS_W / 2 + 0.7), P.z + n[1] * (MAS_W / 2 + 0.7), e > 0 ? ry : ry + Math.PI, pick(kekeCols));
    else {
      d.box(1.1, 0.75, 0.7, 0x6b4f2a, x, 0.38, zz, 0, ry, 0).cyl(0.04, 0.04, 2.2, 0x555555, x, 1.1, zz)
        .add(new THREE.ConeGeometry(1.4, 0.6, 8), pick(UMBRELLAS), x, 2.3, zz);
      addPerson(d, x + n[0] * 0.75, zz + n[1] * 0.75, { sitting: true, ry: ry + Math.PI / 2 });
    }
  }
}

function addBackdrops(scene, plan, blockedAt) {
  const meshes = [], mats = new Map(), loader = new THREE.TextureLoader();
  const material = file => {
    if (!mats.has(file)) {
      const tex = loader.load(new URL(`../data/tex/strips/${file}`, import.meta.url).href);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      // photo déjà éclairée : pas d'ombrage ni de second réglage des couleurs ; le ciel est découpé
      mats.set(file, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false }));
    }
    return mats.get(file);
  };
  // Les bandes sont « vues de face depuis la route ». À droite, la gauche de l'image est vers l'avant :
  // en roulant, on les parcourt donc de la fin vers le début (carreaux en ordre inverse, u décroissant).
  const tilesOf = (names, side) => (names ?? []).flatMap(n => {
    const t = (STRIPS[n]?.tiles ?? []).map(t => ({ ...t, strip: STRIPS[n] }));
    return side > 0 ? t.reverse() : t;
  });
  for (const side of [1, -1]) {
    const queues = { main: tilesOf(plan[side > 0 ? 'right' : 'left'], side), hw: tilesOf(plan[side > 0 ? 'highwayRight' : 'highwayLeft'], side) };
    const at = { main: 0, hw: 0 };
    let tile = null, key = null, used = 0;           // carreau en cours et longueur déjà posée (m)
    let z = Z_START;
    while (z > Z_GEN + 20) {
      // même règle que photoAt() : une liste « highway » prévue (même vide) remplace la liste principale
      const k = inHighway(z) && plan[side > 0 ? 'highwayRight' : 'highwayLeft'] ? 'hw' : 'main';
      if (!queues[k].length) { z -= 8; continue; }
      if (blockedAt(side, z)) { z -= 4; continue; }
      if (!tile || k !== key) { tile = queues[k][at[k]++ % queues[k].length]; key = k; used = 0; }
      const L = tile.w / tile.strip.pxPerM, H = tile.strip.height_m;
      // longueur libre devant : jusqu'au prochain ouvrage, au changement de section ou à la fin du carreau
      let len = 0;
      while (len < L - used && !blockedAt(side, z - len - 4) && inHighway(z - len - 4) === inHighway(z) && z - len > Z_GEN + 20) len += 4;
      len = Math.min(len, L - used);
      if (len < 4) { z -= 4; continue; }
      const geo = new THREE.PlaneGeometry(len, H, Math.max(1, Math.ceil(len / 8)), 1);
      const uv = geo.attributes.uv;
      const u0 = side > 0 ? 1 - (used + len) / L : used / L, u1 = side > 0 ? 1 - used / L : (used + len) / L;
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
      // face tournée vers la chaussée ; u croît vers l'arrière à droite, vers l'avant à gauche
      geo.rotateY(side > 0 ? -Math.PI / 2 : Math.PI / 2).translate(side * (FRONT + 3.5), H / 2 - 0.4, z - len / 2);
      const m = new THREE.Mesh(bendGeometry(geo), material(tile.file));
      m.userData.z0 = z - len;
      m.userData.z1 = z;
      scene.add(m);
      meshes.push(m);
      used += len;
      z -= len;
      if (used >= L - 0.01) tile = null;
    }
  }
  return meshes;
}

const SUN_OFFSET = new THREE.Vector3(42, 85, 39);

/** Ciel de Kinshasa : bleu pâle voilé, très blanc vers l'horizon, gros cumulus (d'après les vidéos). */
function skyDome() {
  const tex = canvasTexture(1024, 512, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h / 2);
    gr.addColorStop(0, '#7fa6cf'); gr.addColorStop(0.55, '#b9cde0'); gr.addColorStop(1, '#e6e9ea');
    x.fillStyle = gr; x.fillRect(0, 0, w, h / 2);
    x.fillStyle = '#d5dde2'; x.fillRect(0, h / 2, w, h / 2);
    // cumulus : amas de bouffées douces (dégradés radiaux), base grise, sommet blanc
    for (let c = 0; c < 26; c++) {
      const cx = Math.random() * w, cy = rand(h * 0.18, h * 0.46), sc = (cy / (h / 2)) ** 1.5;
      const cw = rand(40, 120) * (0.6 + sc), ch = cw * rand(0.25, 0.4);
      for (let k = 0; k < 12; k++) {
        const px = cx + rand(-cw, cw), py = cy - Math.random() * ch, r = rand(0.35, 0.6) * ch;
        const col = py > cy - ch * 0.3 ? '214,220,228' : '255,255,255';
        for (const dx of [0, -w, w]) {
          const gr = x.createRadialGradient(px + dx, py, 0, px + dx, py, r);
          gr.addColorStop(0, `rgba(${col},0.75)`); gr.addColorStop(1, `rgba(${col},0)`);
          x.fillStyle = gr; x.fillRect(px + dx - r, py - r, 2 * r, 2 * r);
        }
      }
    }
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  m.renderOrder = -1;
  return m;
}

// ---------- Construction ----------
// ---------- Prolongement : boulevard Sendwe → boulevard Triomphal → avenue de la Libération → boulevard du 30 Juin ----------
// (routes.js `ext`, demande de l'auteur du 31/10.) La chaussée tourne à gauche à la fourche Sendwe, à gauche au carrefour
// Kasa-Vubu, à droite sur l'avenue de la Libération (virages : EXT_ARCS de route.js) et arrive au boulevard du 30 Juin.
// Tout ce qui est après la fourche est construit ici (le décor générique du boulevard Lumumba s'arrête à Z_GEN).
// Positions : OSM (dossier TPF) ; aspect : Google Maps (dossier sendwe) et vidéos du dossier Route24.

// Terre-plein ouvert (on traverse) : grands carrefours de Sendwe, Kasa-Vubu, Triomphal (Huileries, Victoire), 24 Novembre et 30 Juin
const EXT_OPEN = EXT ? [
  [(Z_FORK + ZX(68)) / 2, (Z_FORK - ZX(68)) / 2 + 1],
  [ZX(705), 6], [ZX(800), 6], [ZX(1305), 6],
  [arcMid(ARC_B), 17],
  [ZX(2135), 7], [ZX(2400), 11], [ZX(3060), 8],
  [arcMid(ARC_C), 28],
  [ZX(4205), 7], [ZX(4676), 9], [ZX(5255), 7], [ZX(5650), 7], [ZX(5949), 8], [ZX(6345), 7],
  [ARC_D ? arcMid(ARC_D) : EXT_ZD, 28],
  [ZX(7152), 7], [ZX(7755), 8], [ZX(9033), 11], [ZX(9970), 8], [ZX(10533), 8], [ZX(10995), 8], [ZX(11500), 10],
] : [];
function extMedianOpen(z) {
  if (inFlyover(z, 3)) return false;
  return EXT_OPEN.some(([zc, h]) => Math.abs(z - zc) < h - 1);
}
// Coin sud-est du carrefour de la Libération : là où le bord gauche du boulevard Triomphal (avant le virage) atteint le
// trottoir est de l'avenue de la Libération vers le sud (dans le prolongement de la Libération après le virage)
const EXT_SE = EXT ? (() => {
  const f = frameAt(ARC_C.z1), c = Math.cos(f.th), s = Math.sin(f.th), w = { x: 0, z: 0 };
  for (let z = ARC_C.z0 + 120; z > ARC_C.z1; z -= 0.5) {
    toWorld(-(ROAD_EDGE + 0.3), z, w, true);
    const dx = w.x - f.x, dz = w.z - f.z, lx = dx * c + dz * s, lz = ARC_C.z1 - dx * s + dz * c;
    if (lx < ROAD_EDGE + 4.6) return { z, lx, lz };       // (lz : z dans le repère de la Libération après le virage)
  }
  return { z: ARC_C.z0, lx: ROAD_EDGE + 4.6, lz: ARC_C.z1 + 60 };
})() : null;
// Coin sud-ouest du Rond-point Mandela : là où le bord gauche de l'avenue de la Libération (24 Novembre) rejoint la branche
// ouest du boulevard du 30 Juin (vers Gouvernement, Socimat et Kintambo Magasin)
const EXT_SW = EXT && ARC_D ? (() => {
  const f = frameAt(ARC_D.z1), c = Math.cos(f.th), s = Math.sin(f.th), w = { x: 0, z: 0 };
  for (let z = ARC_D.z0 + 120; z > ARC_D.z1; z -= 0.5) {
    toWorld(-(ROAD_EDGE + 0.3), z, w, true);
    const dx = w.x - f.x, dz = w.z - f.z, lx = dx * c + dz * s, lz = ARC_D.z1 - dx * s + dz * c;
    if (lx < ROAD_EDGE + 4.6) return { z, lx, lz };
  }
  return { z: ARC_D.z0, lx: ROAD_EDGE + 4.6, lz: ARC_D.z1 + 60 };
})() : null;
// Bordures interrompues (bouches des carrefours, des avenues et des ponts), de chaque côté : [haut, bas]
// L'avenue Kasa-Vubu traverse le carrefour en biais (routes.js ext.kvCross : son axe z = z0 + k·x dans le repère du boulevard) : de chaque côté,
// ni trottoir, ni bordure, ni façade sur son passage (l'auteur, 08/11 : « les entrées des avenues, ce n'est pas propre »)
const KV_CUT = (() => {
  const K = EXT?.kvCross, out = { 1: null, [-1]: null };
  if (!K) return out;
  const z0 = ZX(K.s);
  for (const s of [1, -1]) {
    const za = z0 + K.k * s * ROAD_EDGE, zb = z0 + K.k * s * (ROAD_EDGE + 45);
    out[s] = [Math.max(za, zb) + K.hw, Math.min(za, zb) - K.hw];
  }
  return out;
})();
const EXT_CUTS = EXT ? (() => {
  const c = { 1: [], [-1]: [] }, zB = arcMid(ARC_B);
  for (const s of [1, -1]) {
    c[s].push([zB + 19, zB - 19], [ARC_C.z0 + 20, ARC_C.z1 - 14]);
    if (ARC_D) c[s].push([ARC_D.z0 + 22, ARC_D.z1 - 16]);
    else c[s].push([EXT_ZD + 24, EXT_ZD - 24]);
  }
  c[-1].push([Z_FORK + 2, ZX(68)]);                      // pas de bordure au début de Sendwe : la bordure commence juste après l'entrée de l'Université
  c[1].push([Z_FORK + 2, ZX(85)]);                       // ouverture de la fourche du boulevard Lumumba jusqu'à la pointe Cohydro
  c[-1].push([EXT_SE.z, ARC_C.z1 - 14]);                 // l'avenue de la Libération continue vers le sud (Kokolo, Bandal)
  if (EXT_SW) c[-1].push([EXT_SW.z, ARC_D.z1 - 16]);     // le boulevard du 30 Juin continue vers l'ouest (Gouvernement, Socimat, Kintambo)
  for (const r of SIDE_ROADS) if (r.z < Z_FORK) c[r.side].push([r.z + r.w / 2 + 1, r.z - r.w / 2 - 1]);
  for (const r of RIVERS) if (r.z < Z_FORK) for (const s of [1, -1]) c[s].push([r.z + r.w / 2 + 1.8, r.z - r.w / 2 - 1.8]);
  for (const s of [1, -1]) if (KV_CUT[s]) c[s].push(KV_CUT[s]);
  return c;
})() : null;
const extCut = (side, z, m = 0) => EXT_CUTS[side].some(([a, c]) => z < a + m && z > c - m);
const EXT_PLACES = (EXT?.places ?? []).map(p => ({ ...p, z: p.s !== undefined ? ZX(p.s) : null, z0: p.s0 !== undefined ? ZX(p.s0) : null, z1: p.s1 !== undefined ? ZX(p.s1) : null }));
// Emprise des lieux nommés le long du boulevard (pas de façade générique) : demi-longueur de jeu par genre
const EXT_HALF = { fuel: 17, block: null, radio: 9, church: 13, stadium: 82, arena: 36, school: 14, palais: 118, culture: 118, tembe: 16, museum: 28, pnmls: 18, church_big: 28,
  campus: 30, tower: 16, rtnc_pond: 20, urk: 16, cathedral: 26, glass: null, netted: null, beaux_arts: 16, rotunda: 16, mall: 25, asanef: 0, billboard: 0, stadium_far: 0, hoarding: null, wall: null, empty_lot: null,
  commercial: 14, hospital: 16, kinmarche: 32, airtel_shop: 9, gare: 55,
  b30_kintambo: 38, b30_rev_kim: 28, b30_mural: 38, b30_ggmart: 34, b30_chantier: 22, b30_jac: 32, b30_batetela: 26, b30_cnss_glass: 22, b30_res165: 24, b30_gouvernement: 44, b30_white_tower: 22, b30_3pillars: 24, b30_copper_glass: 22, b30_africell_tower: 24, b30_afriland: 22, b30_matrix: 24, b30_mandela_apt: 24, b30_rotana: 44, b30_believe: 22, b30_sabena: 34, b30_orange_tower: 22, b30_chancellerie: 28, b30_regideso: 32, b30_dentisterie_chantier: 28, b30_blue_curve: 22, b30_scpt: 36, b30_sozacom: 38, b30_solenac: 24, b30_memling: 26, b30_bcdc_tower: 36, b30_palais_justice: 60, b30_bold_chantier: 24, b30_ferris_wheel: 34 };
const extTaken = (() => {
  const out = { 1: [], [-1]: [] };
  if (!EXT) return out;
  out[1].push([Z_FORK + 2, Z_FORK - 112]);                // pointe de la fourche (station Cohydro)
  for (const s of [1, -1]) out[s].push([arcMid(ARC_B) + 30, arcMid(ARC_B) - 30]);   // maisons de l'avenue Kasa-Vubu
  for (const s of [1, -1]) if (KV_CUT[s]) out[s].push(KV_CUT[s]);
  if (ARC_D) for (const s of [1, -1]) out[s].push([ARC_D.z0 + 26, ARC_D.z1 - 26]);  // carrefour Rond-point Mandela (24 Novembre / 30 Juin)
  for (const r of RIVERS) if (r.z < Z_FORK) for (const s of [1, -1]) out[s].push([r.z + r.w / 2 + 8, r.z - r.w / 2 - 8]);
  for (const r of SIDE_ROADS) if (r.z < Z_FORK) {
    const lean = 24 * Math.tan(r.ang * Math.PI / 180);
    out[r.side].push([r.z + r.w / 2 + 1.5 + Math.max(0, -lean), r.z - r.w / 2 - 1.5 - Math.max(0, lean)]);
  }
  for (const p of EXT_PLACES) {
    if (p.z0 !== null) { out[p.side].push([p.z0 + 1, p.z1 - 1]); continue; }
    const h = EXT_HALF[p.kind] ?? (p.w ? p.w / 2 + 1.5 : 10);
    if (h) {
      if (p.side === 0) { out[1].push([p.z + h, p.z - h]); out[-1].push([p.z + h, p.z - h]); }
      else out[p.side].push([p.z + h, p.z - h]);
    }
  }
  for (const z of BUS_STOPS) if (z < Z_FORK) out[1].push([z + 18, z - 18]);
  for (const st of STATIONS) if (st.z < Z_FORK && st.kind !== 'fork') out[1].push([st.z + 22, st.z - 22]);
  return out;
})();
const extFree = (side, z0, z1) => !extTaken[side].some(([a, c]) => z1 < a && z0 > c) && !extCut(side, z0, 1) && !extCut(side, z1, 1)
  && !extCut(side, (z0 + z1) / 2) && z1 > Z_END + 4;

// ----- textures (bandeaux publicitaires, façade perforée du Kinshasa Mall) -----
function bavariaTexture() {
  // bandeau vert du saut-de-mouton d'Asanef (vidéo « Saute de mouton 24 Novembre ») : « SO GOOD », pommes vertes
  return canvasTexture(1024, 128, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#2f8f3a'); gr.addColorStop(0.5, '#7cc242'); gr.addColorStop(1, '#2f8f3a');
    x.fillStyle = gr; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) { x.fillStyle = 'rgba(200,240,140,0.55)'; x.beginPath(); x.arc(60 + i * 150, 70 + (i % 2) * 14, 34, 0, 7); x.fill(); }
    x.fillStyle = '#ffffff'; x.beginPath(); x.ellipse(330, 64, 70, 50, 0, 0, 7); x.fill();
    x.fillStyle = '#1f6b2a'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Bavaria', 330, 50); x.font = 'bold 26px sans-serif'; x.fillText('smalt', 330, 80);
    x.fillStyle = '#ffffff'; x.font = 'bold 96px "Arial Black", sans-serif'; x.fillText('SO GOOD', 700, 68);
  });
}
function bavariaWallTexture() {
  // murs des rampes : grandes affiches jaunes et vertes
  return canvasTexture(512, 256, (x, w, h) => {
    x.fillStyle = '#f2c230'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#3f9a3c'; x.fillRect(0, h * 0.62, w, h * 0.38);
    x.fillStyle = '#ffffff'; x.beginPath(); x.ellipse(130, 100, 90, 70, 0, 0, 7); x.fill();
    x.fillStyle = '#1f6b2a'; x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Bavaria', 130, 85); x.fillText('smalt', 130, 125);
    x.fillStyle = 'rgba(120,200,80,0.9)'; for (const [cx, cy] of [[330, 90], [410, 120], [370, 170]]) { x.beginPath(); x.arc(cx, cy, 40, 0, 7); x.fill(); }
    x.fillStyle = '#ffffff'; x.font = 'bold 40px sans-serif'; x.fillText('SO GOOD', w / 2, h * 0.82);
  });
}
function africellTexture() {
  // bandeaux violets du saut-de-mouton du 30 Juin au-dessus du carrefour (vidéo « GOMBE/LINGWALA… » 8:24–8:54)
  return canvasTexture(1024, 128, (x, w, h) => {
    x.fillStyle = '#5b2a86'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#8b4fc0'; x.fillRect(0, h - 18, w, 18);
    x.fillStyle = '#ffffff'; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.font = 'bold 52px sans-serif'; x.fillText('africell', 30, 60);
    x.font = 'bold 60px "Arial Black", sans-serif'; x.fillText('4G', 260, 60);
    x.font = 'bold 34px sans-serif'; x.fillText('LA PLUS RAPIDE EN RDC', 350, 60, 400);
    x.fillStyle = '#f5c400'; x.font = 'bold 40px sans-serif'; x.textAlign = 'right'; x.fillText('afrimoney', w - 24, 60, 220);
  });
}
function perforatedTexture() {
  // façade du Kinshasa Mall : tôle blanche percée de cercles de toutes tailles (vidéo « Découvrez le nouveau Mall »)
  return canvasTexture(512, 256, (x, w, h) => {
    x.fillStyle = '#eef0f1'; x.fillRect(0, 0, w, h);
    for (let g = 0; g < 26; g++) {                       // grappes de trous de toutes tailles
      const cx = rand(0, w), cy = rand(0, h), n = 6 + Math.floor(Math.random() * 14);
      for (let i = 0; i < n; i++) {
        const r = Math.random() < 0.12 ? rand(6, 10) : rand(1.5, 4.5);
        x.fillStyle = Math.random() < 0.4 ? '#7a8289' : '#a3aab0';
        x.beginPath(); x.arc(cx + rand(-28, 28), cy + rand(-22, 22), r, 0, 7); x.fill();
      }
    }
    x.strokeStyle = '#c9cdd0'; x.lineWidth = 2;
    for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * w / 4, 0); x.lineTo(k * w / 4, h); x.stroke(); }
  });
}
function hoardingTexture(col) {
  // palissade de chantier en tôle ondulée (sans affiches vides de couleur)
  return canvasTexture(512, 128, (x, w, h) => {
    x.fillStyle = col; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 8) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(i, 0, 3, h); }
  });
}

/** Builder vide (rien n'est dessiné) : pour sauter un objet sans changer le code qui l'appelle. */
const NOOP = { box() { return NOOP; }, cyl() { return NOOP; }, ball() { return NOOP; }, add() { return NOOP; } };

/** Sol du prolongement : tuiles carrées dans le repère du monde (sans pliage : il ne se replie pas dans les virages).
 *  Les tuiles proches d'une rivière traversante (Funa, Cabu/Ngabi, Gombe) sont subdivisées pour découper le lit de la rivière. */
function addExtGround(scene, mat) {
  const T = 40, pts = [];
  for (let z = Z_FORK - 2; z > Z_END - 320; z -= 6) pts.push(frameAt(z));
  const f0 = frameAt(Z_FORK - 4), F = [Math.sin(f0.th), -Math.cos(f0.th)];
  const extRivs = RIVERS.filter(r => r.z < Z_FORK).map(r => {
    const f = frameAt(r.z);
    return { x: f.x, z: f.z, ux: Math.sin(f.th), uz: -Math.cos(f.th), nx: Math.cos(f.th), nz: Math.sin(f.th), hw: r.w / 2 + 1.2 };
  });
  const inExtRiv = (wx, wz) => extRivs.some(rv => {
    const dx = wx - rv.x, dz = wz - rv.z;
    return Math.abs(dx * rv.ux + dz * rv.uz) < rv.hw && Math.abs(dx * rv.nx + dz * rv.nz) < 70;
  });
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const pos = [], uv = [], nor = [];
  const pushQuad = (ax, az, s) => {
    const q = [[ax, az], [ax + s, az], [ax + s, az + s], [ax, az + s]];
    for (const i of [0, 2, 1, 0, 3, 2]) { pos.push(q[i][0], -0.07, q[i][1]); uv.push(q[i][0] / 14, -q[i][1] / 14); nor.push(0, 1, 0); }
  };
  for (let gx = Math.floor((x0 - 320) / T) * T; gx < x1 + 320; gx += T) {
    for (let gz = Math.floor((z0 - 320) / T) * T; gz < z1 + 320; gz += T) {
      const cx = gx + T / 2, cz = gz + T / 2;
      if ((cx - f0.x) * F[0] + (cz - f0.z) * F[1] < -T * 0.75) continue;   // derrière la fourche : sol plié du boulevard Lumumba
      let d2 = Infinity;
      for (const p of pts) { const dx = cx - p.x, dz = cz - p.z; if (dx * dx + dz * dz < d2) d2 = dx * dx + dz * dz; }
      if (d2 > 300 * 300) continue;
      if (extRivs.some(rv => Math.hypot(cx - rv.x, cz - rv.z) < 96)) {
        const st = 4;
        for (let sx = gx; sx < gx + T; sx += st) for (let sz = gz; sz < gz + T; sz += st) {
          if (!inExtRiv(sx + st / 2, sz + st / 2)) pushQuad(sx, sz, st);
        }
      } else {
        pushQuad(gx, gz, T);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  scene.add(m);
}

/** Lampadaire à une crosse sur le trottoir, au-dessus de la chaussée (avenue de la Libération). */
function addSideLamp(b, side, z) {
  const x = side * (ROAD_EDGE + 1.0);
  b.cyl(0.09, 0.15, 10, 0x8e949a, x, 5, z)
    .box(2.6, 0.12, 0.12, 0x8e949a, x - side * 1.3, 9.9, z)
    .box(0.75, 0.18, 0.36, 0xdddddd, x - side * 2.6, 9.8, z);
  lampHead(x - side * 2.6, 9.8, z);
}

/** Grand panneau sur deux pieds, face au taxi (et au dos pour l'autre sens). */
function addExtBillboard(b, signs, side, z, title, sub, bg, fg = '#ffffff', { x = FRONT - 3.5, w = 8, h = 2.8, y = 6.4, tall = false } = {}) {
  return;   // (l'auteur, 26/11 : plus aucun panneau publicitaire de couleur)
  const X = side * x;
  if (tall) {                                             // panneau vertical sur un mât (Samsung)
    b.box(0.5, 5, 0.5, 0x6c7680, X, 2.5, z).box(3.4, 6, 0.3, 0x2a2f36, X, 8, z);
    for (const ry of [0, Math.PI]) signs.add(`xbb_${title}`, () => signTexture(title, sub, bg, fg), 3.1, 5.6, X, 8, z + (ry ? -0.17 : 0.17), ry);
    return;
  }
  b.box(0.3, y, 0.3, 0x6c7680, X - w * 0.3, y / 2, z).box(0.3, y, 0.3, 0x6c7680, X + w * 0.3, y / 2, z);
  for (const ry of [0, Math.PI]) signs.add(`xbb_${title}`, () => signTexture(title, sub, bg, fg), w, h, X, y + 0.1, z + (ry ? -0.18 : 0.18), ry);
}

/** Long mur (camp, ambassade, école) : piliers, couronnement, portail et enseigne en option, barbelés. */
function addExtWall(b, signs, p) {
  const side = p.side, x = side * (FRONT - 0.2), h = p.h ?? 2.6, col = p.color ?? 0xeeeeea, top = p.top ?? 0xd9d6cc;
  const zg = p.gate !== undefined ? ZX(p.gate) : null;
  for (const [a, c] of minus([[p.z0, p.z1]], zg !== null ? [[zg + 3.5, zg - 3.5]] : [])) {
    for (const [q0, q1] of pieces(a, c, 24)) {
      if (extCut(side, (q0 + q1) / 2, 0)) continue;
      const len = q0 - q1, zc = (q0 + q1) / 2;
      b.box(0.35, h, len, col, x, h / 2, zc).box(0.45, 0.15, len, top, x, h + 0.05, zc);
      for (let k = q1 + 1.5; k < q0; k += 3.5) b.box(0.5, h + 0.2, 0.5, top, x, (h + 0.2) / 2, k);
      if (p.wire) for (const dy of [0.35, 0.6]) b.box(0.05, 0.05, len, 0x3a3a3a, x, h + dy, zc);
      if (p.trees && chance(0.8)) addMango(b, side * (FRONT + rand(8, 22)), zc + rand(-6, 6), rand(1.1, 1.6));
      if (p.palms && chance(0.5)) addPalm(b, side * (FRONT + rand(4, 10)), zc + rand(-6, 6));
    }
  }
  if (zg !== null) {
    b.box(0.7, h + 1.6, 0.7, top, x, (h + 1.6) / 2, zg + 3.6).box(0.7, h + 1.6, 0.7, top, x, (h + 1.6) / 2, zg - 3.6)
      .box(0.12, h - 0.2, 6.6, p.gateCol ?? 0x2f6f3e, x, (h - 0.2) / 2, zg);
    if (p.name) signs.add(`xwall_${p.name}`, () => signTexture(p.name, p.sub ?? '', p.sign ?? '#1d6b3a', '#ffffff'), 7, 1.3, x - side * 0.4, h + 1.3, zg, -side * Math.PI / 2, true);
  } else if (p.name) {
    const zm = (p.z0 + p.z1) / 2;
    signs.add(`xwall_${p.name}`, () => signTexture(p.name, p.sub ?? '', p.sign ?? '#1d6b3a', '#ffffff'), 8, 1.3, x - side * 0.25, h - 0.9, zm, -side * Math.PI / 2, true);
  }
}

/** Palissade de chantier en tôle ondulée bleue, avec affiches. */
function addHoarding(b, signs, p) {
  const side = p.side, x = side * (FRONT - 0.3), key = `xhoard_${p.color}`;
  for (const [q0, q1] of pieces(p.z0, p.z1, 12)) {
    const len = q0 - q1, zc = (q0 + q1) / 2;
    b.box(0.12, 2.6, len, p.color ?? 0x1d5fbf, x, 1.3, zc);
    signs.add(key, () => hoardingTexture(p.css ?? '#1d5fbf'), len - 0.1, 2.5, x - side * 0.08, 1.3, zc, -side * Math.PI / 2);
  }
  if (p.crane) addCrane(b, side * (FRONT + 22), (p.z0 + p.z1) / 2);
}

/** Bassin / étang en croissant devant la RTNC (Cité de la Voix du Peuple, Google Maps boulevard24_1_.PNG). */
function addRtncPond(b, details, side, z) {
  const cx = side * (FRONT + 15), d = details.at(z);
  b.box(24, 0.05, 36, 0x4b7f35, cx, 0.02, z);                                // pelouse du parc devant la RTNC
  for (const [dz, dx, rx, rz] of [[-8, -1.5, 5.5, 7.5], [0, 1.0, 6.2, 9.0], [8, -1.5, 5.5, 7.5]]) {
    b.add(new THREE.CylinderGeometry(1, 1, 0.14, 20).scale(rx + 0.6, 1, rz + 0.6), 0xc8c2b4, cx + side * dx, 0.05, z + dz)
      .add(new THREE.CylinderGeometry(1, 1, 0.16, 20).scale(rx, 1, rz), 0x266591, cx + side * dx, 0.06, z + dz)
      .add(new THREE.CylinderGeometry(1, 1, 0.17, 16).scale(rx * 0.55, 1, rz * 0.55), 0x4e8fba, cx + side * dx, 0.065, z + dz);
  }
  for (const dz of [-14, -5, 5, 14]) addPalm(b, side * (FRONT + 4.5), z + dz, rand(0.8, 1.05));
  for (let i = 0; i < 6; i++) d.ball(rand(0.7, 1.2), pick([0x3f7a34, 0x56893a, 0x2f6b2f]), cx - side * rand(5, 8), 0.35, z + rand(-13, 13), 1, 0.7, 1);
}

/** Ruisseaux et canaux latéraux du prolongement (Bd de la Permanence, Stade des Martyrs, Kinshasa Arena → Huileries, INA). */
function addExtStreams(chunks, details) {
  for (const st of EXT?.streams ?? []) {
    const z0 = ZX(st.s0), z1 = ZX(st.s1), side = st.side, x = side * (ROAD_EDGE + (st.offset ?? 15)), w = st.w ?? 4.5;
    const zb = st.bridgeAt !== undefined ? ZX(st.bridgeAt) : null;
    for (const [p, q] of pieces(z0, z1, 20)) {
      const zc = (p + q) / 2, len = p - q;
      if (inRiver(zc, 8)) continue;
      const b = chunks.at(zc);
      b.box(w + 1.4, 0.24, len + 0.2, 0x8b8273, x, -0.04, zc)               // berges maçonnées / talus du canal
        .box(w, 0.26, len + 0.25, 0x2b5f82, x, -0.02, zc)                   // eau du ruisseau
        .box(w * 0.48, 0.27, len * 0.65, 0x528ab0, x + rand(-0.4, 0.4), -0.015, zc);
      if (zb !== null && Math.abs(zc - zb) < 12) continue;
      if (chance(0.7)) b.ball(rand(0.85, 1.5), pick([0x3f7a34, 0x56893a, 0x2f6b2f]), x + side * (w / 2 + rand(1.0, 2.4)), 0.35, zc + rand(-len / 3, len / 3), 1, 0.7, 1);
      if (chance(0.28)) addPalm(b, x + side * (w / 2 + rand(1.8, 3.5)), zc + rand(-len / 3, len / 3), rand(0.75, 0.95));
    }
    if (zb !== null) {
      // Dalot / pont sur le ruisseau à l'entrée de l'Avenue des Huileries (s = 2400) avec garde-corps rouge et blanc
      const bw = 15, b = chunks.at(zb);
      b.box(w + 3.8, 0.26, bw, 0xc9c3b6, x, 0.08, zb);
      for (const dz of [-bw / 2 - 0.3, bw / 2 + 0.3]) {
        b.box(w + 3.8, 0.16, 0.28, 0xf2efe8, x, 0.96, zb + dz);
        for (let k = -w / 2 - 1.4; k <= w / 2 + 1.4; k += 1.1) {
          const isRed = Math.abs(Math.round(k * 2)) % 2 === 0;
          b.box(0.24, 0.82, 0.24, isRed ? 0xd62828 : 0xf4f4f0, x + k, 0.48, zb + dz);
        }
      }
    }
  }
}

/** Robot Roulage de Kinshasa (robot solaire humanoïde de régulation routière : Pont-Cabu / Kasa-Vubu, Triomphal / Huileries). */
function addRobotRoulage(b, signs, x, z, key) {
  b.cyl(1.15, 1.35, 0.45, 0xd62828, x, 0.22, z, 0, 0, 0, 16)
    .cyl(0.95, 1.05, 0.45, 0xf4f4f0, x, 0.65, z, 0, 0, 0, 16)
    .box(0.95, 1.4, 0.95, 0x1d4fa0, x, 1.55, z)                              // socle bleu
    .cyl(0.22, 0.26, 1.1, 0x8e949a, x, 2.75, z)                              // colonne
    .box(1.15, 1.35, 0.72, 0xf5c400, x, 3.85, z)                             // torse jaune
    .box(0.85, 0.45, 0.76, 0x1a1a1a, x, 3.95, z)                             // plastron à feux LED
    .ball(0.14, 0xff2a1a, x - 0.22, 3.95, z + 0.39)
    .ball(0.14, 0x2ee05f, x + 0.22, 3.95, z + 0.39)
    .ball(0.14, 0xff2a1a, x - 0.22, 3.95, z - 0.39)
    .ball(0.14, 0x2ee05f, x + 0.22, 3.95, z - 0.39)
    .box(0.62, 0.58, 0.58, 0xf5c400, x, 4.88, z)                             // tête avec lunettes-caméras
    .box(0.48, 0.18, 0.62, 0x111111, x, 4.92, z)
    .box(1.85, 0.24, 0.24, 0xf5c400, x, 4.18, z)                             // bras tendus
    .box(0.24, 0.65, 0.24, 0x1a1a1a, x - 0.95, 4.45, z)
    .box(0.24, 0.65, 0.24, 0x1a1a1a, x + 0.95, 4.45, z)
    .ball(0.11, 0x2ee05f, x - 0.95, 4.6, z + 0.13)
    .ball(0.11, 0xff2a1a, x + 0.95, 4.6, z + 0.13)
    .cyl(0.08, 0.08, 1.1, 0x6c7680, x, 5.65, z)                              // mât du panneau solaire
    .box(1.5, 0.08, 1.1, 0x1a2c42, x, 6.2, z, 0.18, 0, 0);                   // panneau solaire
  signs.add(key, () => signTexture('ROBOT ROULAGE', 'Kinshasa · Circulation', '#1d4fa0', '#f5c400'), 1.8, 0.48, x, 2.0, z + 0.52, 0, true);
}

/** Tour RTNC (Cité de la Voix du Peuple) : haute tour à nervures verticales, édicule, mât d'antennes à côté. */
function addRtncTower(b, signs, side, z) {
  const D = 16, W = 24, H = 70, x = side * (FRONT + 24 + D / 2), fx = x - side * D / 2;
  b.box(D, H, W, 0xb8a88a, x, H / 2, z).box(D - 4, 6, W - 6, 0xa89a80, x, H + 3, z);
  for (let k = -W / 2 + 0.6; k <= W / 2 - 0.6; k += 1.5) b.box(0.6, H - 4, 0.45, k % 3 < 0.8 ? 0xcfc3a8 : 0x9c8f76, fx - side * 0.3, H / 2 + 1, z + k);
  for (let f = 1; f < 22; f++) b.box(0.2, 0.25, W, 0x8c806a, fx - side * 0.62, f * 3.1, z);
  b.box(D + 6, 4.2, W + 6, 0x6e6a62, x, 2.1, z).box(D + 7, 0.4, W + 7, 0x4e4a44, x, 4.4, z);   // socle
  b.box(0.4, 0.4, 0.4, 0, x, 0, z);
  const mx = side * (FRONT + 12), mz = z + 30;                 // mât d'antennes en treillis (vidéo 0:54–1:00)
  for (let i = 0; i < 10; i++) b.box(2.2 - i * 0.16, 4.6, 2.2 - i * 0.16, i % 2 ? 0x9aa0a6 : 0xd62828, mx, 2.3 + i * 4.6, mz);
  b.box(3, 0.3, 0.3, 0x9aa0a6, mx, 44, mz).box(0.3, 2.4, 0.9, 0xe8e8e8, mx + 1.4, 42.5, mz);
  signs.add('xrtnc', () => signTexture('RTNC', 'Cité de la Voix du Peuple', '#123d7a', '#ffffff'), 10, 2.6, fx - side * 0.7, 6.2, z, -side * Math.PI / 2, true);
  for (let k = -12; k <= 12; k += 6) addMango(b, side * (FRONT + 6), z + k + 20, rand(1.2, 1.6));
}

/** Kinshasa Mall : 4 niveaux sous une façade de tôle blanche perforée, enseigne en haut, entrée vitrée, parking devant. */
function addKinshasaMall(b, details, signs, side, z) {
  const set = 24, D = 38, W = 44, H = 21, x = side * (FRONT + set + D / 2), fx = x - side * D / 2;
  b.box(D, H, W, 0xdfe2e4, x, H / 2, z).box(D + 0.6, 0.8, W + 0.6, 0xc7cbcf, x, H + 0.4, z);
  b.box(0.3, 4.2, W - 4, 0x26313c, fx - side * 0.05, 2.1, z);                         // rez-de-chaussée vitré
  b.box(4, 6, 8, 0x3a5f80, fx - side * 1.5, 3, z + W / 2 - 6);                         // entrée vitrée au coin
  for (const [w, h, y, zz] of [[W - 2, H - 6, H / 2 + 2.4, z]]) {
    signs.add('xmall_face', perforatedTexture, w, h, fx - side * 0.35, y, zz, -side * Math.PI / 2);
  }
  signs.add('xmall_side', perforatedTexture, D - 2, H - 6, x, H / 2 + 2.4, z + W / 2 + 0.35, 0);   // côté vu en arrivant
  signs.add('xmall_name', () => signTexture('KINSHASA MALL', 'Shopping · Restaurants · Loisirs', '#ffffff', '#1d7a46'), 18, 2.4, fx - side * 0.5, H - 1.2, z, -side * Math.PI / 2, true);
  signs.add('xmall_name', () => signTexture('KINSHASA MALL', 'Shopping · Restaurants · Loisirs', '#ffffff', '#1d7a46'), 14, 2, x, H - 1.2, z + W / 2 + 0.5, 0, true);
  // parking devant (voitures garées), allée, bordures, palmiers en bacs
  b.box(set - 2, 0.05, W + 8, 0x5c5e63, side * (FRONT + set / 2), 0.03, z);
  for (let k = -W / 2 + 4; k < W / 2 - 3; k += 3) {
    b.box(5, 0.02, 0.12, 0xf2f2ec, side * (FRONT + 5), 0.06, z + k).box(5, 0.02, 0.12, 0xf2f2ec, side * (FRONT + set - 5), 0.06, z + k);
    if (chance(0.55)) addParkedCar(b, side * (FRONT + 5), z + k + 1.5, Math.PI / 2);
    if (chance(0.4)) addParkedCar(b, side * (FRONT + set - 5), z + k + 1.5, Math.PI / 2);
  }
  for (const k of [-W / 2, -W / 6, W / 6, W / 2]) addPalm(b, side * (FRONT + set / 2), z + k, rand(0.8, 1));
  for (let i = 0; i < 8; i++) addPerson(details.at(z), fx - side * rand(1, 4), z + rand(-W / 2, W / 2));
  addExtBillboard(b, signs, side, z + W / 2 + 4, 'KINSHASA MALL', 'Avenue de la Libération', '#1d7a46', '#ffffff', { x: FRONT - 2.5, w: 6, h: 2.2, y: 5.6 });
}

/** Immeuble « Haier » au coin du Mont des Arts : façade courbe rouge et grise, grand cylindre vitré au coin, lettres sur le toit. */
function addRotunda(b, signs, side, z, p) {
  const R0 = 16, H = 16, x = side * (FRONT + 4 + R0), key = `xrot_${z}`;
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (i + 0.5) / 14 * Math.PI, c = Math.cos(a), s = Math.sin(a), per = Math.PI * R0 / 14;
    const px = x - side * c * R0, pz = z + s * R0, ry = Math.atan2(-side * c, s) + Math.PI / 2;
    b.box(per + 0.2, H, 1.4, i % 3 === 1 ? 0x8e949a : 0xa6322e, px, H / 2, pz, 0, ry, 0)
      .box(per + 0.1, 1.4, 1.5, 0x2c3a48, px, 3.0, pz, 0, ry, 0)
      .box(per + 0.1, 1.4, 1.5, 0x2c3a48, px, 8.0, pz, 0, ry, 0)
      .box(per + 0.1, 1.4, 1.5, 0x2c3a48, px, 12.6, pz, 0, ry, 0);
  }
  b.box(R0 * 2, H, R0 * 2, 0xb0aaa0, x + side * R0 * 0.4, H / 2, z);
  b.cyl(5, 5, H + 9, 0x7fa9c9, x - side * (R0 - 2), (H + 9) / 2, z + R0 - 3, 0, 0, 0, 18)   // cylindre vitré
    .cyl(5.4, 5.4, 2.2, 0x8e949a, x - side * (R0 - 2), H + 10, z + R0 - 3, 0, 0, 0, 18);
  for (let k = 0; k < 6; k++) b.box(0.15, H + 8, 0.15, 0xdfe6ec, x - side * (R0 - 2) + 5 * Math.cos(k), (H + 8) / 2, z + R0 - 3 + 5 * Math.sin(k));
  b.box(0.3, 3.2, 10, 0xffffff, x, H + 1.8, z).box(0.3, 0.3, 0.3, 0, x, H, z);
  signs.add(key, () => letterTexture(p.name ?? 'Haier', '#ffffff', '#0a4ea3'), 10, 2.4, x - side * 0.2, H + 1.8, z, -side * Math.PI / 2, true);
  signs.add(key, () => letterTexture(p.name ?? 'Haier', '#ffffff', '#0a4ea3'), 10, 2.4, x, H + 1.8, z + 0.2, 0, true);
}

/** Immeuble moderne vitré à bandeaux colorés (Infinity Center ; immeuble rose au coin arrondi) ; p.build : en chantier. */
function addGlassBldg(b, signs, side, z, p) {
  const w = p.w ?? 20, D = p.depth ?? 16, floors = p.floors ?? 8, fh = 3.4, H = floors * fh, x = side * (FRONT + 2 + D / 2), fx = x - side * D / 2;
  const band = p.band ?? 0x7a3b2e, glass = p.glass ?? 0x3a6ea5;
  if (p.build) {                                          // squelette béton, dalles, une partie vitrée, grue
    for (let f = 0; f <= floors; f++) b.box(D, 0.35, w, 0xbdb7a9, x, f * fh, z);
    for (const dx of [-D / 2 + 0.4, 0, D / 2 - 0.4]) for (const dz of [-w / 2 + 0.4, 0, w / 2 - 0.4]) b.box(0.6, H, 0.6, 0xb0aa9c, x + dx, H / 2, z + dz);
    b.box(0.2, H * 0.55, w - 1, glass, fx, H * 0.28, z);
    addCrane(b, x + side * 6, z - 6);
    return;
  }
  b.box(D, H, w, glass, x, H / 2, z);
  for (let f = 1; f <= floors; f++) b.box(D + 0.3, 0.8, w + 0.3, band, x, f * fh - 0.4, z);
  if (p.round) b.cyl(D / 2, D / 2, H, glass, x, H / 2, z + w / 2, 0, 0, 0, 16);
  if (p.round) for (let f = 1; f <= floors; f++) b.cyl(D / 2 + 0.2, D / 2 + 0.2, 0.8, band, x, f * fh - 0.4, z + w / 2, 0, 0, 0, 16);
  b.box(0.3, 3.4, w - 2, 0x1f2a33, fx - side * 0.1, 1.7, z);
  if (p.name) signs.add(`xglass_${p.name}`, () => signTexture(p.name, p.sub ?? '', p.sign ?? '#5a2a1e', '#ffffff'), Math.min(w - 2, 9), 1.5, fx - side * 0.4, 4.3, z, -side * Math.PI / 2, true);
}

/** Immeuble en chantier sous filet vert (vidéo 3:36–3:48). */
function addNettedBldg(b, side, z, p) {
  const w = p.w ?? 16, D = p.depth ?? 14, floors = p.floors ?? 7, H = floors * 3.3, x = side * (FRONT + 2 + D / 2);
  for (let f = 0; f <= floors; f++) b.box(D, 0.3, w, 0xbdb7a9, x, f * 3.3, z);
  b.box(D + 0.8, H, w + 0.8, 0x2f7a3a, x, H / 2, z);
  for (let k = -w / 2; k <= w / 2; k += 2) b.box(0.12, H + 0.4, 0.12, 0x8a7a5a, x - side * (D / 2 + 0.5), H / 2, z + k);   // échafaudage
}

/** Université protestante au Congo (UPC) : mur à balustres blanc et vert, arbres, bâtiments du campus derrière. */
function addUpcCampus(b, signs, side, z, p) {
  const x = side * (FRONT - 0.2), L = 56;
  for (const [a, c] of [[z + L / 2, z + 4], [z - 4, z - L / 2]]) {
    const len = a - c, zc = (a + c) / 2;
    b.box(0.35, 0.9, len, 0xf2f2ee, x, 0.45, zc).box(0.4, 0.15, len, 0x2f8f4a, x, 2.0, zc);
    for (let k = c + 0.5; k < a; k += 0.6) b.box(0.18, 1.0, 0.18, 0xf6f6f2, x, 1.4, k);
  }
  b.box(0.7, 3.2, 0.7, 0xf2f2ee, x, 1.6, z + 4).box(0.7, 3.2, 0.7, 0xf2f2ee, x, 1.6, z - 4).box(0.12, 2.4, 7.4, 0x2f6f3e, x, 1.2, z);
  signs.add('xupc', () => signTexture(p.name, p.sub ?? '', '#1d4fa0', '#ffffff'), 7.4, 1.3, x - side * 0.4, 3.9, z, -side * Math.PI / 2, true);
  for (const [dz, fl] of [[-16, 3], [14, 4]]) {
    const bx = side * (FRONT + 22), w = 22, h = fl * 3.4;
    b.box(14, h, w, 0xf4f4f0, bx, h / 2, z + dz).box(14.6, 0.5, w + 0.6, 0x1d4fa0, bx, h + 0.25, z + dz);
    for (let f = 0; f < fl; f++) b.box(0.1, 1.3, w * 0.86, 0x2a3a4c, bx - side * 7.02, f * 3.4 + 1.8, z + dz);
  }
  for (let k = -L / 2; k <= L / 2; k += 7) addMango(b, side * (FRONT + rand(5, 11)), z + k, rand(1.1, 1.5));
}

/** Université Révérend Kim : grand volume blanc et beige sur pilotis, toit en pente, affiches au pied (vidéo 2:48). */
function addUrk(b, signs, side, z, p) {
  const D = 18, W = 30, x = side * (FRONT + 3 + D / 2), fx = x - side * D / 2;
  for (const dz of [-W / 2 + 1, -W / 6, W / 6, W / 2 - 1]) for (const dx of [-D / 2 + 1, D / 2 - 1]) b.box(0.9, 6, 0.9, 0xd8d2c4, x + dx, 3, z + dz);
  b.box(D, 9, W, 0xf1efe9, x, 10.5, z);
  const roof = new THREE.BoxGeometry(D + 1, 0.6, W + 1);
  b.add(roof, 0xd9d3c3, x, 15.6, z, 0.12, 0, 0);                                        // toit en pente vers l'arrière
  for (let k = -W / 2 + 2; k < W / 2; k += 3.2) b.box(0.3, 8, 1.4, k % 6 < 3 ? 0x9a6b3e : 0xc8b08a, fx - side * 0.15, 10.5, z + k);
  b.box(D, 0.5, W, 0xcfc6b2, x, 6.2, z);
  signs.add('xurk', () => signTexture(p.name, p.sub ?? '', '#1d4fa0', '#ffffff'), 9, 1.4, fx - side * 0.5, 5.2, z - 6, -side * Math.PI / 2, true);
  for (const [dz, t, bg] of [[6, 'INSCRIPTIONS', '#c8102e'], [-1, 'LICENCE · MASTER', '#1d6b3a']]) {
    b.box(0.2, 3, 5, 0x2a2f36, fx - side * 0.4, 2.2, z + dz);
    signs.add(`xurk_${t}`, () => signTexture(t, 'Université Révérend Kim', bg, '#ffffff'), 4.8, 2.8, fx - side * 0.55, 2.2, z + dz, -side * Math.PI / 2, true);
  }
  b.box(0.6, 1.6, W + 2, 0xf2f2ee, side * (FRONT - 0.2), 0.8, z).box(0.7, 0.3, W + 2, 0x1d4fa0, side * (FRONT - 0.2), 1.7, z);
}

/** Cathédrale (Notre-Dame du Congo ; du Centenaire) : grande nef, façade à pignon et rosace, clocher carré, parvis. */
function addCathedral(b, details, signs, side, z, p) {
  const set = p.set ?? 18, D = 22, L = 42, H = 15, x = side * (FRONT + set + 9 + D / 2), zf = z + L / 2;
  const wall = p.wall ?? 0xeee6d6, roof = p.roof ?? 0x8c3b2b;
  b.box(D, H, L, wall, x, H / 2, z);
  for (const e of [-1, 1]) b.box(D / 2 + 1.6, 0.5, L + 1.4, roof, x + e * D / 4, H + D / 4 * 0.7, z, 0, 0, -e * 0.62);
  b.add(new THREE.CylinderGeometry(D / 2 / Math.cos(Math.PI / 6), D / 2 / Math.cos(Math.PI / 6), 0.8, 3).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.55, 1), wall, x, H + 3.2, zf - 0.4);   // pignon
  b.cyl(2.4, 2.4, 0.3, 0x4a6a9a, x, H - 3.5, zf + 0.2, Math.PI / 2, 0, 0, 16).cyl(1.4, 1.4, 0.35, 0xd8c070, x, H - 3.5, zf + 0.25, Math.PI / 2, 0, 0, 16);   // rosace
  b.box(4, 6.5, 0.4, 0x5a3a24, x, 3.25, zf + 0.15);                                          // portail
  for (let k = -L / 2 + 4; k < L / 2 - 2; k += 6) b.box(1.2, H - 2, 1.4, wall, x - side * (D / 2 + 0.6), (H - 2) / 2, z + k);   // contreforts
  for (let k = -L / 2 + 7; k < L / 2 - 3; k += 6) b.box(0.15, 6, 1.6, 0x3c5a8a, x - side * (D / 2 + 0.05), H / 2, z + k);       // vitraux
  const tx = x + side * (D / 2 - 2), tz = zf - 3, TH = p.tower ?? 38;
  b.box(6, TH, 6, wall, tx, TH / 2, tz).box(6.4, 0.6, 6.4, 0xd9d1bf, tx, TH, tz)
    .add(new THREE.ConeGeometry(4.4, 8, 4).rotateY(Math.PI / 4), roof, tx, TH + 4.2, tz)
    .box(0.3, 3, 0.3, 0xf5c400, tx, TH + 9.6, tz).box(0.3, 0.3, 1.6, 0xf5c400, tx, TH + 10.4, tz);
  for (const dy of [TH - 6, TH - 12]) b.box(6.1, 2.6, 1.6, 0x3a3a3a, tx, dy, tz + 2.3);
  b.box(set + 6, 0.06, L + 16, 0xd6d0c2, side * (FRONT + (set + 6) / 2), 0.03, z);          // parvis
  for (let k = -L / 2; k <= L / 2; k += 8) addPalm(b, side * (FRONT + 4), z + k, rand(0.8, 1));
  for (let i = 0; i < 10; i++) addPerson(details.at(z), side * (FRONT + rand(6, set + 6)), z + rand(-L / 2, L / 2));
  signs.add(`xcath_${z}`, () => signTexture(p.name, p.sub ?? '', '#6b2c1e', '#ffffff'), 10, 1.6, side * (FRONT + 1.6), 2.6, z + L / 2 + 6, 0, true);
  b.box(0.2, 3.4, 0.2, 0x8e949a, side * (FRONT + 1.6) - 4.4, 1.7, z + L / 2 + 6).box(0.2, 3.4, 0.2, 0x8e949a, side * (FRONT + 1.6) + 4.4, 1.7, z + L / 2 + 6);
}

/** Grand terrain vide dégagé (en face du Stade des Martyrs, et entre Kinshasa Arena et l'Av. des Huileries, vidéos v9_17s & v9_41s). */
function addExtEmptyLot(chunks, details, p) {
  const side = p.side;
  for (const [a, c] of pieces(p.z0, p.z1, 24)) {
    const len = a - c, zc = (a + c) / 2, b = chunks.at(zc), d = details.at(zc);
    b.box(56, 0.04, len + 0.2, 0x738e42, side * (FRONT + 28), 0.015, zc)
      .box(18, 0.05, len * 0.75, 0xa88f65, side * (FRONT + 11), 0.02, zc);
    // Quelques touffes d'herbe basse et arbres tout au fond du terrain (dégagé au bord du boulevard)
    for (let i = 0; i < 3; i++) {
      d.ball(rand(0.7, 1.3), pick([0x4c7c34, 0x5f8f3e, 0x3b6e2c]), side * (FRONT + rand(14, 44)), 0.3, zc + rand(-len / 3, len / 3), 1.3, 0.5, 1.3);
    }
    if (chance(0.45)) addMango(b, side * (FRONT + rand(38, 56)), zc + rand(-len / 3, len / 3), rand(1.0, 1.4));
  }
}

/** Kinshasa Arena (complexe sportif couvert courbe juste à côté du Stade des Martyrs, avec palissade bleue et grues, vidéos v8_1117s & tri_1080s). */
function addKinshasaArena(b, details, signs, side, z, p) {
  const A = 30, B = 32, H = 18.5, cx = side * (FRONT + 22 + A), N = 32;
  const per = 2 * Math.PI * Math.sqrt((A * A + B * B) / 2) / N;
  const beige = 0xdccbb0, ochre = 0xc59b58, dark = 0x353c44, roofCol = 0xe8e4dc;
  // Dôme / arène elliptique à nervures verticales et anneau supérieur en porte-à-faux
  b.add(new THREE.CylinderGeometry(1, 1, H, 36).scale(A - 2, 1, B - 2), dark, cx, H / 2, z);
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    const ry = Math.atan2(-B * c, -A * sn);
    b.box(per * 0.55, H, 1.6, i % 2 ? beige : ochre, cx + A * c, H / 2, z + B * sn, 0, ry, 0)
      .box(per + 0.3, 2.8, 3.2, ochre, cx + (A + 1.2) * c, H - 1.2, z + (B + 1.2) * sn, 0, ry, 0)
      .box(per + 0.3, 1.2, 3.6, roofCol, cx + (A + 1.5) * c, H + 0.8, z + (B + 1.5) * sn, 0, ry, 0);
  }
  b.add(new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(A - 1, 5.5, B - 1), roofCol, cx, H, z);
  // Esplanade sablonneuse et palissade de chantier bleue le long du boulevard (v8_1117s.jpg)
  const L = 66, wx = side * (FRONT + 1.2);
  b.box(22, 0.05, L, 0xc4b08b, side * (FRONT + 11), 0.02, z);
  for (const [q0, q1] of pieces(z + L / 2, z - L / 2, 11)) {
    const len = q0 - q1, zc = (q0 + q1) / 2;
    b.box(0.16, 2.5, len, 0x1d5fbf, wx, 1.25, zc).box(0.24, 0.12, len, 0xf4f4f0, wx, 2.52, zc);
  }
  addCrane(b, cx - side * 8, z - 24);
  signs.add('xarena', () => signTexture(p.name ?? 'KINSHASA ARENA', p.sub ?? 'Complexe Omnisports · Stade des Martyrs', '#1d4fa0', '#f5c400'),
    16, 2.2, cx - side * (A + 2.8), H - 0.8, z, -side * Math.PI / 2, true);
}

/** Immeuble Tembe n'a Tembe (vidéo v8_670s.jpg : immeuble R+3 vert-jaune pâle avec 2 pavillons d'entrée symétriques au RDC). */
function addTembeNaTembe(b, signs, side, z, p) {
  const set = 12, D = 16, W = 30, H = 14.8, x = side * (FRONT + set + D / 2), fx = x - side * D / 2;
  const wall = 0xd2dfab, trim = 0x424952, win = 0x232d38;
  b.box(D, H, W, wall, x, H / 2, z).box(D + 0.8, 0.65, W + 0.8, trim, x, H + 0.32, z);
  // Cage d'escalier vitrée verticale au centre + bandes de fenêtres horizontales sur 4 niveaux
  b.box(0.5, H - 1, 3.6, win, fx - side * 0.15, H / 2 + 0.3, z)
    .box(0.7, H - 0.6, 0.35, 0xf2f2ee, fx - side * 0.25, H / 2 + 0.3, z - 1.9)
    .box(0.7, H - 0.6, 0.35, 0xf2f2ee, fx - side * 0.25, H / 2 + 0.3, z + 1.9);
  for (let f = 0; f < 4; f++) {
    const y = f * 3.6 + 2.1;
    for (const sgn of [-1, 1]) {
      b.box(0.25, 1.35, 10.5, win, fx - side * 0.08, y, z + sgn * 8.2)
        .box(0.35, 0.22, 11.2, 0xf4f4f0, fx - side * 0.14, y - 0.75, z + sgn * 8.2);
    }
  }
  // Deux pavillons bas d'entrée symétriques en avant de la façade (v8_670s.jpg)
  for (const dz of [-7.5, 7.5]) {
    const px = fx - side * 4.2;
    b.box(8, 3.6, 8.5, wall, px, 1.8, z + dz)
      .box(8.6, 0.65, 9.1, trim, px, 3.85, z + dz)
      .box(0.2, 2.3, 4.2, win, px - side * 4.05, 1.25, z + dz);
  }
  b.box(set, 0.05, W + 6, 0xc8c2b4, side * (FRONT + set / 2), 0.025, z);
  signs.add('xtembe', () => signTexture(p.name, p.sub ?? 'HET Triomphal', '#2c3e50', '#f5c400'),
    13, 1.5, fx - side * 0.35, H - 1.0, z, -side * Math.PI / 2, true);
}

/** Immeuble du PNMLS en face de l'entrée de la Salle Panacée (vidéo tri_150s.jpg & triompal5.PNG : long bâtiment jaune R+1/R+2 avec grand portique central vitré bleu encadré de blanc, guérite jaune et clôture). */
function addPnmls(b, signs, side, z, p) {
  const set = 10, D = 15, W = 32, H = 9.6, x = side * (FRONT + set + D / 2), fx = x - side * D / 2;
  const yellow = 0xe8b930, darkYellow = 0xc99718, white = 0xf4f4f0, blueGlass = 0x1a5fb4;
  // Corps principal jaune ocre à 2 grands niveaux
  b.box(D, H, W, yellow, x, H / 2, z)
    .box(D + 0.6, 0.55, W + 0.6, darkYellow, x, H + 0.28, z)
    .box(D + 0.4, 0.3, W + 0.4, white, x, H / 2, z);
  // Fenêtres régulières encadrées de blanc
  for (const f of [0, 1]) {
    const y = f * 4.6 + 2.4;
    for (let k = -W / 2 + 2.5; k <= W / 2 - 2.5; k += 3.4) {
      if (Math.abs(k) < 4.8) continue;
      b.box(0.28, 1.5, 1.8, white, fx - side * 0.08, y, z + k)
        .box(0.34, 1.25, 1.5, 0x22303c, fx - side * 0.12, y, z + k);
    }
  }
  // Grand portique central en saillie encadré de blanc avec mur-rideau en verre bleu réfléchissant et bande rouge (tri_150s.jpg)
  const px = fx - side * 1.4;
  b.box(3.0, H + 1.4, 8.6, white, px, (H + 1.4) / 2, z)
    .box(3.2, 0.45, 9.0, 0xd62828, px, H + 0.85, z)
    .box(0.35, H - 0.8, 6.8, blueGlass, px - side * 1.42, (H - 0.8) / 2 + 0.4, z)
    .box(2.4, 0.35, 7.6, white, px - side * 0.8, 3.6, z);
  // Cour pavée, guérite jaune à toit pyramidal au coin et muret bas jaune/blanc à grille
  b.box(set, 0.05, W + 6, 0xcfc9bc, side * (FRONT + set / 2), 0.025, z);
  const gx = side * (FRONT + 1.8), gz = z - W / 2 - 1;
  b.box(2.8, 3.2, 2.8, yellow, gx, 1.6, gz)
    .add(new THREE.ConeGeometry(2.3, 1.2, 4).rotateY(Math.PI / 4), 0x8a3b2a, gx, 3.8, gz);
  const wx = side * (FRONT - 0.2);
  for (const [q0, q1] of [[z + W / 2 + 2, z + 4.5], [z - 4.5, z - W / 2 - 2]]) {
    const len = q0 - q1, zc = (q0 + q1) / 2;
    b.box(0.3, 0.9, len, yellow, wx, 0.45, zc).box(0.36, 0.15, len, white, wx, 0.95, zc)
      .box(0.08, 1.1, len, 0x2b3036, wx, 1.5, zc);
  }
  signs.add('xpnmls_bldg', () => signTexture(p.name ?? 'PNMLS', p.sub ?? 'Programme national multisectoriel de lutte contre le sida', '#1d4fa0', '#ffffff'),
    8.2, 1.35, px - side * 1.58, H - 0.3, z, -side * Math.PI / 2, true);
}

/** Grand temple protestant (Cathédrale du Centenaire, vidéos r24_30s & v3_42s) : long mur blanc ajouré à claustras au bord du trottoir, large nef à double toit en pente, haute flèche blanche avec croix. */
function addCentenaire(b, details, signs, side, z, p) {
  const set = 14, D = 30, L = 48, x = side * (FRONT + set + D / 2);
  b.box(D, 10.5, L, 0xf4f2ec, x, 5.25, z);
  for (const e of [-1, 1]) b.box(D / 2 + 2.5, 0.6, L + 2, 0x55606b, x + e * D / 4, 15.2, z, 0, 0, -e * 0.95);   // toit très pentu
  b.box(0.3, 9, L * 0.7, 0x2a3c50, x - side * (D / 2 + 0.05), 5.5, z);
  const tx = side * (FRONT + set + 4), tz = z + L / 2 + 5;
  b.box(3.2, 36, 3.2, 0xf4f4f0, tx, 18, tz).add(new THREE.ConeGeometry(2.4, 10, 4).rotateY(Math.PI / 4), 0xf4f4f0, tx, 41, tz)
    .box(0.35, 4, 0.35, 0x2a2a2a, tx, 47.5, tz).box(0.35, 0.35, 2.2, 0x2a2a2a, tx, 48.6, tz);
  b.box(set, 0.06, L + 22, 0xd6d0c2, side * (FRONT + set / 2), 0.03, z);
  // Mur de clôture blanc à claustras (breeze-blocks) caractéristique sur l'Avenue du 24 Novembre (r24_30s.jpg)
  const wx = side * (FRONT - 0.2);
  for (const [q0, q1] of [[z + L / 2 + 9, z + 5], [z - 5, z - L / 2 - 9]]) {
    const len = q0 - q1, zc = (q0 + q1) / 2;
    b.box(0.32, 2.3, len, 0xf6f6f2, wx, 1.15, zc).box(0.42, 0.18, len, 0xdad6cc, wx, 2.35, zc)
      .box(0.36, 0.65, len - 0.8, 0x7a8086, wx, 1.65, zc);
    for (let k = q1 + 1.2; k < q0; k += 2.4) b.box(0.45, 2.5, 0.45, 0xffffff, wx, 1.25, k);
  }
  for (let k = -L / 2; k <= L / 2 + 8; k += 9) addPalm(b, side * (FRONT + 3), z + k, rand(0.85, 1.05));
  for (let i = 0; i < 8; i++) addPerson(details.at(z), side * (FRONT + rand(4, set)), z + rand(-L / 2, L / 2));
  signs.add('xcent', () => signTexture(p.name, p.sub ?? '', '#1d4fa0', '#ffffff'), 10, 1.6, side * (FRONT + 1.4), 2.7, z + L / 2 + 12, 0, true);
}

/** Académie des Beaux-Arts : portail dans le mur turquoise, statues dans la cour, ateliers bas. */
function addBeauxArts(b, details, signs, side, z, p) {
  const x = side * (FRONT - 0.2);
  b.box(0.8, 4.2, 0.8, 0x3fb3a8, x, 2.1, z + 5).box(0.8, 4.2, 0.8, 0x3fb3a8, x, 2.1, z - 5).box(0.9, 0.8, 11, 0x2f8f86, x, 4.4, z)
    .box(0.12, 2.6, 9.2, 0x23313d, x, 1.3, z);
  signs.add('xaba', () => signTexture(p.name, p.sub ?? '', '#2f8f86', '#ffffff'), 9.6, 1.4, x - side * 0.5, 4.4, z, -side * Math.PI / 2, true);
  for (const [dz, h, col] of [[-10, 3.2, 0x7a5a3a], [-3, 4.2, 0x3a3a3a], [6, 2.8, 0xb08a5a], [12, 3.6, 0x5a4636]]) {   // statues
    const sx = side * (FRONT + 6), sz = z + dz;
    b.box(1.4, 1, 1.4, 0xd8d2c4, sx, 0.5, sz).cyl(0.28, 0.4, h, col, sx, 1 + h / 2, sz).ball(0.4, col, sx, 1.3 + h, sz);
  }
  for (const dz of [-14, 14]) b.box(10, 4.2, 18, 0xe9e2d0, side * (FRONT + 18), 2.1, z + dz).box(10.6, 0.3, 18.6, 0x8a4b2a, side * (FRONT + 18), 4.4, z + dz);
  for (let i = 0; i < 5; i++) addPerson(details.at(z), side * (FRONT + rand(3, 12)), z + rand(-12, 12));
}

/** Musée national de la RDC (MNRDC, vidéo v8_521s.jpg) : 3 grands pavillons en brique rouge-brun à quadrillage blanc coiffés de toits pyramidaux tronqués gris anthracite à lanterneau blanc, clôture blanche ajourée et enseigne verte MNRDC. */
function addMuseum(b, signs, side, z, p) {
  const set = 14, D = 20, W = 52, H = 9.2, x = side * (FRONT + set + D / 2), fx = x - side * D / 2;
  const brick = 0x9e4730, roofDark = 0x3a3f47, white = 0xf4f4f0;
  // Cour jardin et 3 pavillons à toits pyramidaux tronqués (huttes modernes du MNRDC, v8_521s.jpg)
  b.box(set + D + 6, 0.05, W + 8, 0x5c8a38, side * (FRONT + (set + D) / 2), 0.02, z)
    .box(set, 0.06, 20, 0xd8cdb8, side * (FRONT + set / 2), 0.03, z);
  for (const dz of [-16, 0, 16]) {
    const pw = 14.5, pd = 16, pz = z + dz;
    b.box(pd, H, pw, brick, x, H / 2, pz)
      .box(pd + 0.5, 0.45, pw + 0.5, white, x, H + 0.22, pz);
    // Quadrillage blanc sur la façade de brique
    for (const y of [3.2, 6.2]) b.box(0.25, 0.22, pw + 0.1, white, fx - side * 0.08, y, pz);
    for (let k = -pw / 2 + 2.4; k < pw / 2; k += 2.4) b.box(0.25, H, 0.2, white, fx - side * 0.08, H / 2, pz + k);
    // Toit pyramidal tronqué gris anthracite + lanterneau blanc au sommet
    b.add(new THREE.CylinderGeometry(4.2, 10.5, 5.2, 4).rotateY(Math.PI / 4), roofDark, x, H + 3.0, pz)
      .box(5.6, 0.9, 5.6, white, x, H + 5.8, pz);
  }
  // Clôture blanche à grilles sombres le long du boulevard + enseigne verte « MNRDC » (v8_521s.jpg)
  const wx = side * (FRONT - 0.2);
  for (const [q0, q1] of [[z + W / 2 + 2, z + 5], [z - 5, z - W / 2 - 2]]) {
    const len = q0 - q1, zc = (q0 + q1) / 2;
    b.box(0.3, 1.0, len, white, wx, 0.5, zc).box(0.08, 1.3, len, 0x262c34, wx, 1.65, zc);
    for (let k = q1 + 1.5; k < q0; k += 3.2) b.box(0.42, 2.4, 0.42, white, wx, 1.2, k);
  }
  signs.add('xmusee', () => signTexture(p.name ?? 'MUSÉE NATIONAL (MNRDC)', p.sub ?? 'Institut des Musées Nationaux du Congo', '#1d6b3a', '#ffffff'),
    14, 1.7, wx - side * 0.25, 2.5, z + 11, -side * Math.PI / 2, true);
  addFlag(b, signs, side * (FRONT + 5), z - 8, 11);
}

/**
 * Musée International · Centre culturel et artistique pour les pays d'Afrique centrale (vidéos v5_12s, v5_36s, v9_17s) :
 * commence directement après l'Avenue des Huileries et fait exactement face au Palais du Peuple sur 228 m de jeu ;
 * longue colonnade / portique courbe ocre sur le devant, grand tambour cylindrique du théâtre derrière, 4 grands blocs
 * ocre à claustras dès la sortie des Huileries, arche monumentale, tour carrée et esplanade bordée de palmiers.
 */
function addCcapac(b, details, signs, side, z, p) {
  const OC = 0xc98a52, OD = 0xb07440, OL = 0xd9a06a, DK = 0x5a3a24, ESP = 228;
  // Grand tambour cylindrique du théâtre (v5_12s.jpg & v9_17s.jpg)
  const A = 28, B = 36, H = 21, cx = side * (FRONT + 24 + A), cz = z - 18;
  const ring = (r, h, col, y, s = 1) => b.add(new THREE.CylinderGeometry(1, 1, h, 48).scale((A + r) * s, 1, (B + r) * s), col, cx, y, cz);
  ring(0, H, OD, H / 2); ring(0.3, 3.5, DK, 2.0);
  for (let i = 0; i < 120; i++) {                                  // lames verticales tout autour du tambour
    const t = (i + 0.5) / 120 * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
    if (c * side > 0.5) continue;
    b.box(0.35, H - 1, 1.2, OL, cx + (A + 0.7) * c, H / 2, cz + (B + 0.7) * sn, 0, Math.atan2(-B * c, -A * sn), 0);
  }
  b.add(new THREE.SphereGeometry(1, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(A + 1, 6.5, B + 1), OC, cx, H, cz);
  // Longue colonnade / portique ocre en arc devant le tambour, face au Palais du Peuple (v5_12s.jpg & v5_36s.jpg)
  const px0 = side * (FRONT + 14);
  b.box(4.2, 0.9, 96, OL, px0, 10.6, cz).box(4.6, 0.6, 98, OD, px0, 11.3, cz);
  for (let k = -46; k <= 46; k += 3.2) {
    b.box(0.95, 10.4, 0.95, OC, px0 - side * 1.4, 5.2, cz + k);
  }
  // 4 grands blocs rectangulaires ocre à claustras commençant directement après la route des Huileries (z + 88 → z + 18) et côté Victoire (z - 76)
  for (const [dz, w, fl] of [[84, 34, 4], [44, 32, 4], [-72, 34, 3]]) {
    const bx = side * (FRONT + 18 + 14), h = fl * 4, bz = z + dz;
    b.box(28, h, w, OC, bx, h / 2, bz).box(28.6, 0.8, w + 0.6, OD, bx, h + 0.4, bz);
    for (let k = -w / 2 + 1; k < w / 2; k += 1.6) b.box(1.6, h - 1, 0.35, OL, bx - side * 14.6, h / 2, bz + k);
    for (let f = 0; f < fl; f++) b.box(0.2, 2.2, w - 3, 0x8a5a34, bx - side * 13.9, f * 4 + 2.2, bz);
  }
  // Passerelle haute reliant les blocs dès les Huileries au tambour central
  b.box(4, 1.4, 150, OD, side * (FRONT + 18 + 4), 9.2, z + 10).box(4.2, 1.2, 150, OL, side * (FRONT + 18 + 4), 10.4, z + 10);
  for (const pz of [z + 64, z + 24, z - 52]) b.box(1.2, 8.5, 1.2, OD, side * (FRONT + 18 + 4), 4.25, pz);
  // Mur à grande arche ronde (porte de lune) face au boulevard
  const ax = side * (FRONT + 13), az = z + 22;
  b.box(1.6, 12, 6, OC, ax, 6, az - 7).box(1.6, 12, 6, OC, ax, 6, az + 7).box(1.6, 3, 8, OC, ax, 10.5, az);
  b.add(new THREE.TorusGeometry(4.6, 0.8, 8, 24, Math.PI).rotateY(Math.PI / 2), OD, ax, 6.4, az);
  const tx = side * (FRONT + 22), tz = z - 96;                     // tour carrée ajourée
  b.box(7, 30, 7, OC, tx, 15, tz).box(7.4, 1, 7.4, OD, tx, 30.5, tz);
  for (const dy of [24, 27]) b.box(7.1, 1.6, 2.2, DK, tx, dy, tz);
  // Vaste esplanade pavée ocre clair de 228 m commençant directement après les Huileries, grands escaliers, palmiers et clôture blanche
  b.box(20, 0.06, ESP, 0xe2d6bf, side * (FRONT + 10), 0.03, z);
  for (let k = 0; k < 5; k++) b.box(1.1, 0.3 * (k + 1), 42, 0xe8dcc4, side * (FRONT + 8 + k * 1.1), 0.15 * (k + 1), cz);
  for (let dz = -102; dz <= 102; dz += 20) addPalm(b, side * (FRONT + 4), z + dz, rand(0.75, 0.98));
  b.box(0.08, 0.08, ESP, 0xf2f2ee, side * (FRONT - 0.6), 1.0, z);
  for (let k = -ESP / 2 + 2; k <= ESP / 2 - 2; k += 2.5) b.box(0.06, 1, 0.06, 0xf2f2ee, side * (FRONT - 0.6), 0.5, z + k);
  signs.add('xccapac', () => signTexture(p.name ?? 'MUSÉE INTERNATIONAL · CENTRE CULTUREL', "Centre culturel et artistique pour les pays d'Afrique centrale", '#8a5a34', '#ffffff'),
    18, 2.0, side * (FRONT + 12.5), 3.6, z + 38, -side * Math.PI / 2, true);
  for (let i = 0; i < 8; i++) addPerson(details.at(z), side * (FRONT + rand(3, 14)), z + rand(-85, 85));
}

/** Radio Maria : petit immeuble à étage, mât d'antenne rouge et blanc sur le toit. */
function addRadioMaria(b, signs, side, z, p) {
  const x = side * (FRONT + 7), h = 7;
  b.box(14, h, 16, 0xf2efe6, x, h / 2, z).box(14.6, 0.4, 16.6, 0x1d4fa0, x, h + 0.2, z);
  for (let i = 0; i < 6; i++) b.box(0.9 - i * 0.1, 3, 0.9 - i * 0.1, i % 2 ? 0xffffff : 0xd62828, x + side * 3, h + 1.5 + i * 3, z - 4);
  b.box(0.1, 2.2, 6, 0x2a3540, side * (FRONT - 0.05), 1.6, z);
  signs.add('xradio', () => signTexture(p.name, p.sub ?? '', '#1d4fa0', '#ffffff'), 10, 1.4, side * (FRONT - 0.1), h - 1.1, z, -side * Math.PI / 2, true);
}

/** Stade au fond du quartier (Tata Raphaël) : mâts d'éclairage et toit de tribune visibles au-dessus des maisons. */
function addFarStadium(b, signs, side, z, p) {
  const cx = side * (FRONT + 120);
  b.box(36, 12, 90, 0xcfc6b2, cx - side * 20, 6, z).box(14, 0.6, 96, 0x8e2b2b, cx - side * 26, 15, z, 0, 0, side * 0.1);
  for (const [dx, dz] of [[-28, -50], [28, -50], [-28, 50], [28, 50]]) b.box(1, 34, 1, 0xd8dce0, cx + dx, 17, z + dz).box(6, 3, 1, 0xf4f4f0, cx + dx, 34, z + dz);
  b.box(60, 0.15, 100, 0x3f8a3a, cx + side * 14, 0.08, z);
}

/** Abords du saut-de-mouton d'Asanef : foule, motos-taxis, vendeuses sous parasols, tas d'ordures, pharmacie au coin. */
function addAsanefLife(scene, b, details, signs, z) {
  const d = details.at(z);
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) {                                          // motos-taxis garées au bord
      const moto = createMoto();
      place(moto, side * (ROAD_EDGE + rand(2.4, 5)), z + rand(-26, 26), side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      scene.add(moto);
    }
    for (let k = 0; k < 14; k++) addPerson(d, side * (ROAD_EDGE + rand(1.5, 7)), z + rand(-30, 30));
    for (let k = 0; k < 5; k++) {                                          // parasols (dont « Jouez au loto » rouges)
      const ux = side * (ROAD_EDGE + rand(3.5, 7)), uz = z + rand(-28, 28), red = chance(0.4);
      d.cyl(0.04, 0.04, 2.3, 0x555555, ux, 1.15, uz).add(new THREE.ConeGeometry(1.7, 0.6, 8), red ? 0xd62828 : pick(UMBRELLAS), ux, 2.4, uz)
        .box(1.1, 0.75, 0.8, red ? 0xd62828 : 0x8b6b45, ux, 0.38, uz);
      addPerson(d, ux + side * 0.9, uz, { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
    for (let k = 0; k < 2; k++) {                                          // tas d'ordures (bouteilles, sacs, cartons)
      const tx = side * (ROAD_EDGE + rand(2.5, 4)), tz = z + rand(-24, 24);
      d.ball(0.8, 0x5a5448, tx, 0.05, tz, 1.5, 0.3, 1.0);
      for (let i = 0; i < 16; i++) d.box(rand(0.12, 0.4), 0.07, rand(0.12, 0.35), pick([0xe8e8e8, 0x1d6fd1, 0x2b2b2b, 0xd62828, 0xb08a5a, 0x9fd3e8]), tx + rand(-1.3, 1.3), rand(0.1, 0.3), tz + rand(-0.9, 0.9), 0, rand(0, 3), 0);
    }
  }
  // Pharmacie Notre Dame au coin (gauche, après l'avenue Sergent Moke) ; boutique Infinix ; panneau Alpenliebe
  const pz = ZX(4700), px = -(FRONT + 7);
  b.box(14, 7, 14, 0xf2efe6, px, 3.5, pz).box(14.4, 0.4, 14.4, 0x2b8a3e, px, 7.2, pz).box(0.1, 2.4, 10, 0x2a3540, -(FRONT - 0.05), 1.4, pz);
  signs.add('xpharma', () => signTexture('PHARMACIE NOTRE DAME', 'Asanef', '#2b8a3e', '#ffffff'), 11, 1.4, -(FRONT - 0.1), 4.4, pz, Math.PI / 2, true);
  const iz = ZX(4720), ix = FRONT + 6;
  b.box(12, 6.6, 12, 0xe8e2d0, ix, 3.3, iz).box(0.1, 2.4, 9, 0x2a3540, FRONT - 0.05, 1.4, iz);
  signs.add('xinfinix', () => signTexture('Infinix', 'Smartphones · Asanef', '#111111', '#7fe03a'), 9, 1.3, FRONT - 0.1, 4.2, iz, -Math.PI / 2, true);
  addExtBillboard(b, signs, 1, ZX(4640), 'Alpenliebe', 'Le plus délicieux des bonbons', '#f5c400', '#c8102e', { tall: true, x: FRONT - 2 });
}

/**
 * Lieu nommé du prolongement (routes.js ext.places). b : tranche pliée (ou en bloc dans un virage), d : petits objets.
 */
function addExtPlace(scene, chunks, details, signs, p) {
  const b = chunks.at(p.z ?? p.z0), side = p.side, z = p.z, key = `xp_${p.kind}_${side}_${Math.round(z ?? p.z0)}`;
  const m = { ...p, s: EXT.from + (p.s ?? 0) };
  switch (p.kind) {
    case 'fuel': addSideFuel(b, signs, side, z, key, p.name); break;
    case 'block': addNamedBlock(b, signs, side, z, p.w ?? 16, p, FRONT, p.floors ?? 3); break;
    case 'school': addNamedSchool(b, signs, side, z, p); break;
    case 'church': addNamedChurch(b, signs, side, z, p); break;
    case 'radio': addRadioMaria(b, signs, side, z, p); break;
    case 'empty_lot': addExtEmptyLot(chunks, details, p); break;
    case 'stadium_far': addFarStadium(b, signs, side, z, p); break;
    case 'stadium': addStadium(b, signs, m); break;
    case 'arena': addKinshasaArena(b, details, signs, side, z, p); break;
    case 'palais': addPalais(b, signs, { ...m, noTribune: true }); break;
    case 'culture': addCcapac(b, details, signs, side, z, p); break;
    case 'tembe': addTembeNaTembe(b, signs, side, z, p); break;
    case 'museum': addMuseum(b, signs, side, z, p); break;
    case 'pnmls': addPnmls(b, signs, side, z, p); break;
    case 'church_big': addCentenaire(b, details, signs, side, z, p); break;
    case 'wall': addExtWall(b, signs, p); break;
    case 'hoarding': addHoarding(b, signs, p); break;
    case 'campus': addUpcCampus(b, signs, side, z, p); break;
    case 'rtnc_pond': addRtncPond(b, details, side, z); break;
    case 'tower': addRtncTower(b, signs, side, z); break;
    case 'asanef': addAsanefLife(scene, b, details, signs, z); break;
    case 'urk': addUrk(b, signs, side, z, p); break;
    case 'billboard': addExtBillboard(b, signs, side, z, p.text, p.sub ?? '', p.bg ?? '#1d4fa0', p.fg ?? '#ffffff', { tall: !!p.tall, w: p.bw ?? 8, h: p.bh ?? 2.8 }); break;
    case 'cathedral': addCathedral(b, details, signs, side, z, p); break;
    case 'glass': addGlassBldg(b, signs, side, z, p); break;
    case 'netted': addNettedBldg(b, side, z, p); break;
    case 'beaux_arts': addBeauxArts(b, details, signs, side, z, p); break;
    case 'rotunda': addRotunda(b, signs, side, z, p); break;
    case 'mall': addKinshasaMall(b, details, signs, side, z); break;
    case 'commercial': addCommercialBldg(b, signs, side, z, p); break;
    case 'hospital': addHospital(b, signs, side, z, p); break;
    case 'kinmarche': addKinMarche(b, signs, side, z); break;
    case 'airtel_shop': addAirtelShop(b, signs, side, z); break;
    case 'gare': addGare(b, signs, m); break;
    case 'b30_kintambo': addB30Kintambo(b, details, signs, side, z, p); break;
    case 'b30_rev_kim': addB30RevKim(b, signs, side, z, p); break;
    case 'b30_mural': addB30Mural(b, signs, side, z); break;
    case 'b30_ggmart': addB30Ggmart(b, signs, side, z, p); break;
    case 'b30_chantier': addB30Chantier(b, side, z, p); break;
    case 'b30_jac': addB30Jac(b, signs, side, z, p); break;
    case 'b30_batetela': addB30Batetela(b, signs, side, z, p); break;
    case 'b30_cnss_glass': addB30CnssGlass(b, signs, side, z, p); break;
    case 'b30_res165': addB30Res165(b, signs, side, z, p); break;
    case 'b30_gouvernement': addB30Gouvernement(b, signs, side, z, p); break;
    case 'b30_white_tower': addB30WhiteTower(b, signs, side, z, p); break;
    case 'b30_3pillars': addB30ThreePillars(b, signs, side, z, p); break;
    case 'b30_copper_glass': addB30CopperGlass(b, signs, side, z, p); break;
    case 'b30_africell_tower': addB30AfricellTower(b, signs, side, z, p); break;
    case 'b30_afriland': addB30Afriland(b, signs, side, z, p); break;
    case 'b30_matrix': addB30Matrix(b, signs, side, z, p); break;
    case 'b30_mandela_apt': addB30MandelaApt(b, signs, side, z, p); break;
    case 'b30_rotana': addB30Rotana(b, signs, side, z, p); break;
    case 'b30_believe': addB30Believe(b, signs, side, z, p); break;
    case 'b30_sabena': addB30Sabena(b, signs, side, z, p); break;
    case 'b30_orange_tower': addB30OrangeTower(b, signs, side, z, p); break;
    case 'b30_chancellerie': addB30Chancellerie(b, signs, side, z, p); break;
    case 'b30_regideso': addB30Regideso(b, signs, side, z, p); break;
    case 'b30_dentisterie_chantier': addB30DentisterieChantier(b, signs, side, z, p); break;
    case 'b30_blue_curve': addB30BlueCurve(b, signs, side, z, p); break;
    case 'b30_scpt': addB30Scpt(b, signs, side, z, p); break;
    case 'b30_sozacom': addB30Sozacom(b, signs, side, z, p); break;
    case 'b30_solenac': addB30Solenac(b, signs, side, z, p); break;
    case 'b30_memling': addB30Memling(b, signs, side, z, p); break;
    case 'b30_bcdc_tower': addB30BcdcTower(b, signs, side, z, p); break;
    case 'b30_palais_justice': addB30PalaisJustice(b, signs, side, z, p); break;
    case 'b30_bold_chantier': addB30BoldChantier(b, signs, side, z, p); break;
    case 'b30_ferris_wheel': addB30FerrisWheel(b, signs, side, z, p); break;
    default: break;
  }
}

/** Façade générique du prolongement, selon le tronçon (Sendwe populaire, Triomphal monumental, Libération urbaine, 30 Juin centre-ville). */
function addExtFacade(b, d, signs, side, z, w, zone) {
  const lim = insideMaxSpan(side, z + w / 2, z - w / 2);
  const k = Math.random();
  if (zone === 'sendwe') {
    if (lim < FRONT + 16) { if (lim > FRONT + 2) addParcel(b, side, z, w); return; }
    if (k < 0.5) addShop(b, signs, side, z, w);
    else if (k < 0.78) addParcel(b, side, z, w);
    else if (k < 0.93) addTall(b, signs, side, z, w);
    else addLot(b, side, z, w);
    if (lim > FRONT + 40 && chance(0.7)) {
      const dd = rand(7, 12), h = rand(2.8, 6), x = side * (FRONT + 14 + dd / 2 + rand(0, 8));
      b.box(dd, h, w * rand(0.7, 1), pick(WALLS), x, h / 2, z).box(dd + 0.6, 0.12, w, pick(TIN), x, h + 0.25, z, 0, 0, side * 0.1);
    }
    return;
  }
  if (zone === 'triomphal') {
    if (lim < FRONT + 30 || k < 0.35) { addWhiteWall(b, side, z, w); return; }
    if (k < 0.8) addAdmin(b, side, z, w);
    else b.box(14, 0.06, w, 0x6f9a48, side * (FRONT + 7), 0.03, z);
    if (chance(0.5)) addMango(b, side * (FRONT + rand(3, 6)), z + rand(-w / 3, w / 3), rand(0.9, 1.2));
    return;
  }
  if (zone === '30juin') {
    if (lim < FRONT + 22 || k < 0.22) { addWhiteWall(b, side, z, w); return; }
    addHighrise(b, signs, side, z, w, 0.75);
    if (chance(0.5)) addPalm(b, side * (FRONT + rand(2.5, 5.5)), z + rand(-w / 3, w / 3), rand(0.85, 1.1));
    return;
  }
  // Libération : immeubles de 2 à 6 niveaux, boutiques au rez-de-chaussée, murs de parcelles, quelques villas
  if (lim < FRONT + 14) { if (lim > FRONT + 2) addWhiteWall(b, side, z, w); return; }
  if (k < 0.34) addTall(b, signs, side, z, w, 2 + Math.floor(Math.random() * 4));
  else if (k < 0.58) addShop(b, signs, side, z, w);
  else if (k < 0.74 && lim > FRONT + 26) addHighrise(b, signs, side, z, w, rand(0, 0.35));
  else if (k < 0.86) addWhiteWall(b, side, z, w);
  else addParcel(b, side, z, w);
}

/**
 * Le prolongement après la fourche : sol, terre-plein, bordures et trottoirs, lampadaires, poteaux, façades, carrefours
 * (Kasa-Vubu, Libération, 30 Juin et son saut-de-mouton), lieux nommés. rigid : objets posés en bloc (carrefours).
 */
function* addExtension(scene, chunks, details, curbs, signs, rigid, groundMat) {   // (générateur : le décor lointain se construit par tranches, voir buildWorld)
  const zA = Z_FORK - 0.5, zE = Z_END;
  addExtGround(scene, groundMat);
  yield;

  // Terre-plein : Sendwe béton + blocs rouges et blancs ; Triomphal planté (palmiers en bacs, drapeaux) ; Libération muret bas ;
  // Boulevard du 30 Juin : comme sur le trajet « Boulevard du 30 Juin » (béton gris + séparateur DBA rouge et blanc, voir plus bas)
  const openCuts = EXT_OPEN.map(([zc, h]) => [zc + h, zc - h]);
  for (const [p, q] of minus(pieces(zA, zE, 24), openCuts)) {
    const zc = (p + q) / 2, len = p - q, b = chunks.at(zc), zone = extZone(zc);
    if (inFlyover(zc, 1)) continue;                       // (le saut-de-mouton a son propre séparateur)
    if (zone === 'triomphal') b.box(MEDIAN * 2, 0.24, len, 0xf2f2ee, 0, 0.12, zc).box(MEDIAN * 2 - 0.3, 0.3, len, 0x5f8a3a, 0, 0.16, zc);
    else b.box(MEDIAN * 2, zone === 'liberation' ? 0.26 : 0.22, len, 0xa9a49a, 0, zone === 'liberation' ? 0.13 : 0.11, zc);
  }
  for (const [zc, h] of EXT_OPEN) chunks.at(zc).box(MEDIAN * 2 + 0.4, 0.04, 2 * h, ASPHALT_COL, 0, 0.02, zc);
  let blk = 0;
  for (let z = zA; z > EXT_ZB; z -= 6) {                 // blocs DBA du boulevard Sendwe
    const zm = z - 3;
    if (EXT_OPEN.some(([zc, h]) => Math.abs(zm - zc) < h + 3) || SIDE_ROADS.some(r => r.z < Z_FORK && Math.abs(zm - r.z) < 5.5)) continue;
    const col = blk++ % 2 ? 0xf2efe8 : 0x9e2835;
    chunks.at(z).box(0.44, 0.86, 5.88, col, 0, 0.64, zm).box(0.68, 0.26, 5.88, col, 0, 0.35, zm);
  }
  // Boulevard du 30 Juin : séparateur béton DBA rouge et blanc, en blocs de la longueur du trajet « Boulevard du 30 Juin »
  const BLK30 = ROUTES['30juin'].barrierLen ?? 9;
  for (let z = EXT_ZD - 30; z > zE + 4; z -= BLK30) {
    const zm = z - BLK30 / 2;
    if (inFlyover(zm, 2) || EXT_OPEN.some(([zc, h]) => Math.abs(zm - zc) < h + BLK30 / 2) || SIDE_ROADS.some(r => r.z < EXT_ZD && Math.abs(zm - r.z) < 5.5)) continue;
    const col = blk++ % 2 ? 0xf2efe8 : 0x9e2835;
    chunks.at(z).box(0.44, 0.86, BLK30 - 0.12, col, 0, 0.64, zm).box(0.68, 0.26, BLK30 - 0.12, col, 0, 0.35, zm);
  }
  for (const [zStart, zStop] of [[EXT_ZB - 22, EXT_ZC + 20]]) {
    for (let z = zStart; z > zStop; z -= 24) {            // Triomphal : bacs blancs, palmiers, drapeaux
      if (EXT_OPEN.some(([zc, h]) => Math.abs(z - zc) < h + 3)) continue;
      const b = chunks.at(z);
      b.box(1.75, 0.28, 3.6, 0xf2f2ee, 0, 0.24, z).box(1.45, 0.32, 3.3, 0x3b6e2e, 0, 0.26, z)
        .ball(0.45, 0x2e6b28, 0, 0.55, z - 1.1, 1.2, 0.6, 1.2).ball(0.45, 0x2e6b28, 0, 0.55, z + 1.1, 1.2, 0.6, 1.2);
      addPalm(b, 0, z, rand(0.75, 1.05));
    }
    for (let z = zStart - 18; z > zStop + 10; z -= 76) addFlag(chunks.at(z), signs, 0, z, 10);
  }
  yield;
  // Bordures peintes du terre-plein (rouge et blanc ; blanches sur le Triomphal)
  let paint = 0;
  for (let z = zA; z > zE; z -= 1.5) {
    const zm = z - 0.75, zone = extZone(zm), c = paint++ % 2 ? 0xd23f36 : 0xeeeae2;
    if (inFlyover(zm, 1) || EXT_OPEN.some(([zc, h]) => Math.abs(zm - zc) < h)) continue;
    for (const s of [-1, 1]) curbs.at(z).box(0.16, 0.3, 1.5, zone === 'triomphal' ? 0xf4f4f0 : c, s * (MEDIAN - 0.08), zone === 'liberation' ? 0.18 : 0.16, zm);
  }

  yield;
  // Bordures, caniveaux, trottoirs (bouches des carrefours et des avenues ouvertes)
  for (const s of [-1, 1]) {
    yield;
    for (const [p, q] of minus(pieces(zA, zE, 16), EXT_CUTS[s])) {
      const zc = (p + q) / 2, len = p - q, b = chunks.at(zc), zone = extZone(zc), d = details.at(zc);
      const pointe = s > 0 && zc > Z_FORK - 112;           // pointe de la fourche : seulement la bordure
      if (zone === 'sendwe') {
        b.box(0.6, 0.2, len, 0xb8b2a6, s * (ROAD_EDGE + 0.3), 0.1, zc);
        if (pointe) continue;
        b.box(1.4, 0.04, len, 0x2b2622, s * (ROAD_EDGE + 1.3), 0, zc)
          .box(0.15, 0.28, len, 0x9e988c, s * (ROAD_EDGE + 0.62), 0.12, zc).box(0.15, 0.28, len, 0x9e988c, s * (ROAD_EDGE + 1.98), 0.12, zc)
          .box(FRONT - ROAD_EDGE - 2.05, 0.04, len, 0xc0956a, s * (FRONT + ROAD_EDGE + 2.05) / 2, 0, zc);
        if (chance(0.5)) b.box(3, 0.06, len * rand(0.4, 1), pick([0x6f8f3e, 0x7d9a48, 0x62853a]), s * (ROAD_EDGE + 3.6), 0.01, zc);
      } else if (zone === 'triomphal' || zone === '30juin') {
        b.box(0.6, 0.2, len, 0xb8b2a6, s * (ROAD_EDGE + 0.3), 0.1, zc)
          .box(FRONT - ROAD_EDGE - 0.6, 0.16, len, 0xc9c6bd, s * (FRONT + ROAD_EDGE + 0.6) / 2, 0.08, zc);
      } else {
        // Libération : bordure, caniveau couvert de dalles béton (souvent cassées : vidéo Asanef), puis terre battue
        b.box(0.45, 0.24, len, 0xb3ada2, s * (ROAD_EDGE + 0.22), 0.12, zc)
          .box(2.3, 0.2, len, 0xa9a397, s * (ROAD_EDGE + 1.6), 0.1, zc)
          .box(FRONT - ROAD_EDGE - 2.75, 0.06, len, 0xb79a76, s * (FRONT + ROAD_EDGE + 2.75) / 2, 0.03, zc);
        for (let k = q + 0.6; k < p; k += 1.5) d.box(2.3, 0.02, 0.07, 0x6f6a60, s * (ROAD_EDGE + 1.6), 0.205, k);
        if (chance(0.35)) d.box(1.2, 0.04, 1.3, 0x2a2620, s * (ROAD_EDGE + rand(1, 2.2)), 0.19, zc + rand(-len / 3, len / 3));   // dalle cassée
      }
    }
  }
  // Bordures rouge et blanc au bord de la chaussée (Sendwe, Triomphal et Boulevard du 30 Juin)
  paint = 0;
  for (let z = zA; z > zE; z -= 1.5) {
    const zm = z - 0.75, zone = extZone(zm), c = paint++ % 2 ? 0xd23f36 : 0xeeeae2;
    if (zone === 'liberation') continue;
    for (const s of [-1, 1]) if (!extCut(s, zm)) curbs.at(z).box(0.62, 0.04, 1.5, c, s * (ROAD_EDGE + 0.3), 0.21, zm);
    if (zone === '30juin' && paint % 2 === 0) for (const s of [-1, 1]) if (!extCut(s, z)) details.at(z).box(0.28, 0.32, 0.5, 0x6e2a22, s * (ROAD_EDGE + 0.3), 0.36, z);   // bornes
  }

  yield;
  // Lampadaires : doubles sur le terre-plein (Sendwe, Triomphal et 30 Juin, avec bannières bleues), à crosse sur les trottoirs (Libération)
  for (const [zStart, zStop] of [[zA - 12, EXT_ZC], [EXT_ZD - 26, zE + 18]]) {
    for (let z = zStart; z > zStop; z -= 38) {
      if (EXT_OPEN.some(([zc, h]) => Math.abs(z - zc) < h + 2) || inFlyover(z, 3)) continue;
      addStreetlight(chunks.at(z), z);
    }
  }
  let lamp = 0;
  for (let z = EXT_ZC - 10; z > EXT_ZD + 18; z -= 21) {
    const s = lamp++ % 2 ? -1 : 1;
    if (extCut(s, z, 2) || inFlyover(z, 2)) continue;
    addSideLamp(chunks.at(z), s, z);
  }
  yield;
  // Poteaux électriques et fils (Sendwe, Libération, Boulevard du 30 Juin)
  for (const s of [-1, 1]) {
    yield;
    let prev = null;
    for (let z = zA - 6; z > zE + 18; z -= 32) {
      if (extZone(z) === 'triomphal' || (ARC_D && z < ARC_D.z0 + 30 && z > ARC_D.z1 - 30) || extCut(s, z, 2) || (s > 0 && z > Z_FORK - 112)) { prev = null; continue; }
      const x = s * (FRONT - 1.2), b = chunks.at(z);
      b.cyl(0.11, 0.15, 9, chance(0.5) ? 0x5d4a38 : 0x9a958a, x, 4.5, z).box(1.4, 0.1, 0.1, 0x4a3a2a, x, 8.4, z);
      if (prev !== null) for (const dx of [-0.6, 0, 0.6]) details.at(z).box(0.03, 0.03, prev - z, 0x1a1a1a, x + dx, 8.15, (prev + z) / 2);
      prev = z;
    }
  }

  yield;
  // Façades génériques et vie des trottoirs
  for (const side of [-1, 1]) {
    let z = zA - 10, nf = 0;
    while (z > zE + 6) {
      if (++nf % 40 === 0) yield;
      const zone = extZone(z), k = Math.random();
      const w = (zone === 'triomphal' || zone === '30juin') ? rand(18, 32) : k < 0.5 ? rand(6, 10) : rand(10, 18);
      const z0 = z, z1 = z - w, cz = z - w / 2;
      if (!extFree(side, z0, z1) || outsideArc(side, cz, 6)) { z -= 3; continue; }
      const b = chunks.at(cz), d = details.at(cz);
      addExtFacade(b, d, signs, side, cz, w, zone);
      if (zone !== 'triomphal' && zone !== '30juin' && chance(zone === 'sendwe' ? 0.4 : 0.3)) addVendors(d, side, cz, false);
      if (zone !== 'triomphal' && chance(0.3)) for (let i = 0; i < 2; i++) addPerson(d, side * (ROAD_EDGE + rand(1.5, 6)), cz + rand(-w / 2, w / 2));
      z -= w + rand(0.4, 2.2);
    }
  }
  // Panneaux publicitaires (Sendwe, Libération, 30 Juin)
  let bi = 0;
  for (let z = zA - 60; false && z > zE + 60; z -= rand(160, 240)) {   // (retirés, 26/11)
    const side = bi % 2 ? -1 : 1;
    if (extZone(z) === 'triomphal' || !extFree(side, z + 4, z - 4)) continue;
    const [t, sub, bg, fg] = BILLBOARDS[bi++ % BILLBOARDS.length];
    addExtBillboard(chunks.at(z), signs, side, z, t, sub, bg, fg);
  }

  // Ruisseaux et canaux latéraux (Bd de la Permanence, Stade des Martyrs, Kinshasa Arena → Huileries, INA)
  yield;
  addExtStreams(chunks, details);
  yield;

  // Lieux nommés
  for (const p of EXT_PLACES) { addExtPlace(scene, chunks, details, signs, p); yield; }

  // Robots roulage emblématiques (Pont-Cabu / Kasa-Vubu, Carrefour des Huileries sur le Triomphal, et REGIDESO / Huileries sur le 30 Juin)
  addRobotRoulage(chunks.at(ZX(1465)), signs, 0, ZX(1465), 'xrobot_cabu');
  addRobotRoulage(chunks.at(ZX(2400)), signs, 0, ZX(2400), 'xrobot_huileries');
  addRobotRoulage(chunks.at(ZX(9033)), signs, 0, ZX(9033), 'xrobot_30juin_huileries');

  yield;
  addExtJunctions(scene, chunks, details, signs, rigid);
}

/**
 * Carrefours du prolongement, posés en bloc (pas pliés par les virages) : avenue Kasa-Vubu (deux chaussées, du nord au sud),
 * avenue de la Libération vers le sud, boulevard du 30 Juin avec son saut-de-mouton au-dessus du carrefour.
 */
function addExtJunctions(scene, chunks, details, signs, rigid) {
  // Route transversale posée en bloc : centre (route x = 0, z = zc), cap réel hReal (degrés). t > 0 : vers la droite.
  const cross = (zc, hReal, { half = 130, lanes = 2, skip = 20, median = true, name = null, sub = '', y = 0.008 } = {}) => {
    const b = rigid.at(zc), th = frameAt(zc).th, a = extYaw(hReal) - th, dx = Math.sin(a), dz = -Math.cos(a), ry = Math.atan2(dx, dz);
    const at = t => [dx * t, zc + dz * t], hw = MEDIAN + lanes * LANE_W, edge = hw + 0.3;
    for (const [t0, t1] of [[-half, half]]) {
      const [mx, mz] = at((t0 + t1) / 2);
      b.box(2 * hw, 0.03, t1 - t0, ASPHALT_COL, mx, y, mz, 0, ry, 0);
    }
    for (const sgn of [-1, 1]) {                           // de chaque côté de notre chaussée : bordures, trottoirs, terre-plein
      const [m0, m1] = sgn > 0 ? [skip, half] : [-half, -skip], [cx, cz] = at((m0 + m1) / 2), L = m1 - m0;
      for (const e of [-1, 1]) {
        const ox = Math.cos(a) * e, oz = Math.sin(a) * e;     // normale à la transversale
        b.box(0.5, 0.2, L, 0xb8b2a6, cx + ox * edge, 0.1, cz + oz * edge, 0, ry, 0)
          .box(4, 0.15, L, 0xc2b59e, cx + ox * (edge + 2.2), 0.075, cz + oz * (edge + 2.2), 0, ry, 0);
        for (let t = m0 + 6; t < m1 - 4; t += rand(9, 15)) {   // façades le long de la transversale
          const [qx, qz] = at(t), dd = rand(8, 12), h = rand(3.5, 9), w = rand(7, 11), off = edge + 4.5 + dd / 2;
          b.box(dd, h, w, pick(WALLS), qx + ox * off, h / 2, qz + oz * off, 0, ry, 0)
            .box(dd + 0.6, 0.15, w + 0.6, pick(TIN), qx + ox * off, h + 0.1, qz + oz * off, 0, ry, 0);
        }
      }
      if (median) b.box(MEDIAN * 2, 0.22, L, 0xa9a49a, cx, 0.11, cz, 0, ry, 0);
      for (let t = m0 + 3; t < m1; t += 9) { const [qx, qz] = at(t); b.box(0.15, 0.02, 3, 0xf2f2ec, qx + Math.cos(a) * (MEDIAN + LANE_W), 0.03, qz + Math.sin(a) * (MEDIAN + LANE_W), 0, ry, 0)
        .box(0.15, 0.02, 3, 0xf2f2ec, qx - Math.cos(a) * (MEDIAN + LANE_W), 0.03, qz - Math.sin(a) * (MEDIAN + LANE_W), 0, ry, 0); }
    }
    if (name) for (const e of [-1, 1]) {
      const [qx, qz] = at(e * (skip + 4)), ox = Math.cos(a) * (edge + 1.5), oz = Math.sin(a) * (edge + 1.5);
      b.box(0.16, 3.8, 0.16, 0x8e949a, qx + ox, 1.9, qz + oz);
      signs.add(`xcross_${name}`, () => signTexture(name, sub, '#1d4fa0'), 4.4, 1.25, qx + ox, 3.6, qz + oz, ry + (e > 0 ? Math.PI : 0), true, zc);
    }
    return { b, at, a, ry, hw };
  };

  // Carrefour Kasa-Vubu (OSM : avenue à deux chaussées, cap -15,5° vers le nord)
  const zB = arcMid(ARC_B);
  // (quand la vraie avenue Kasa-Vubu est chargée, main.js ROAD6 : pas ce bout d'avenue de décor, qui se superposerait à elle, de travers)
  if (!globalThis.TAXIKIN_KV) cross(zB, -15.5, { name: 'AVENUE KASA-VUBU', sub: 'Kasa-Vubu · Victoire ↓  Gombe ↑', skip: 22 });

  // Libération vers le sud (Camp Kokolo, Bandalungwa) : dans le prolongement de la Libération après le virage
  // (aucune bordure dans le croisement Boulevard Triomphal / 24 Novembre : les bordures de la branche sud commencent au-delà du carrefour)
  {
    const zr = ARC_C.z1, b = rigid.at(zr), hw = ROAD_EDGE, zSouth0 = Math.max(EXT_SE.lz + 14, zr + 56);
    b.box(2 * hw, 0.03, 240, ASPHALT_COL, 0, 0.012, zr + 4 + 120);
    b.box(MEDIAN * 2, 0.22, 184, 0xa9a49a, 0, 0.11, zr + 56 + 92);
    for (const e of [-1, 1]) {
      const z0 = zSouth0, L = zr + 240 - z0;
      b.box(0.5, 0.2, L, 0xb8b2a6, e * (hw + 0.3), 0.1, z0 + L / 2)
        .box(4, 0.15, L, 0xc2b59e, e * (hw + 2.4), 0.075, z0 + L / 2);
      for (const lx of [MEDIAN + LANE_W, MEDIAN + 2 * LANE_W, MEDIAN + 3 * LANE_W]) for (let k = 58; k < 240; k += 9) b.box(0.15, 0.02, 3, 0xf2f2ec, e * lx, 0.03, zr + k);
    }
    // façades de la branche sud (au-delà du croisement du Triomphal)
    for (let k = 62; k < 230; k += rand(10, 16)) {
      const dd = rand(9, 13), h = rand(3.5, 10), w = rand(8, 12);
      b.box(dd, h, w, pick(WALLS), -(FRONT + dd / 2), h / 2, zr + k).box(dd + 0.6, 0.15, w + 0.6, pick(TIN), -(FRONT + dd / 2), h + 0.1, zr + k);
      if (zr + k + 5 - w / 2 > zSouth0 + 12) b.box(dd, h, w, pick(WALLS), FRONT + dd / 2, h / 2, zr + k + 5);
    }
    // asphalte lisse du carrefour (sous les deux chaussées, sans bordure)
    b.box(68, 0.02, 76, ASPHALT_COL, 8, 0.004, zr + 30);
    signs.add('xlib_sud', () => signTexture('AV. DE LA LIBÉRATION', '↓ Camp Kokolo · Bandal', '#1d4fa0'), 5, 1.3, -(hw + 2.5), 3.6, zSouth0 + 4, Math.PI / 2, true, zr);
    b.box(0.16, 3.8, 0.16, 0x8e949a, -(hw + 2.5), 1.9, zSouth0 + 4);
  }

  // Rond-point Mandela : liaison directe Avenue de la Libération (ex-24 Novembre) ↔ Boulevard du 30 Juin !
  // La chaussée principale tourne à droite sur le Boulevard du 30 Juin Est (vers Rotana, La Poste, Gare Centrale),
  // tandis que la branche Ouest du Boulevard du 30 Juin (vers Gouvernement, Socimat, Kintambo Magasin) part à gauche
  // dans le prolongement arrière de ARC_D.z1, avec le saut-de-mouton Mandela et l'Arche du 30 Juin au-dessus du carrefour.
  if (ARC_D) {
    const zr = ARC_D.z1, b = rigid.at(zr), hw = ROAD_EDGE, zWest0 = Math.max((EXT_SW?.lz ?? zr + 56) + 14, zr + 56);
    // 1. Branche Ouest du Boulevard du 30 Juin (vers Hôtel du Gouvernement · Socimat · Kintambo Magasin)
    b.box(2 * hw, 0.03, 280, ASPHALT_COL, 0, 0.012, zr + 4 + 140);
    b.box(MEDIAN * 2, 0.24, 224, 0xf2f2ee, 0, 0.12, zr + 56 + 112)
      .box(MEDIAN * 2 - 0.3, 0.3, 224, 0x5f8a3a, 0, 0.16, zr + 56 + 112);
    for (let k = 68; k < 270; k += 26) addPalm(b, 0, zr + k, rand(0.8, 1.05));
    for (const e of [-1, 1]) {
      const z0 = zWest0, L = zr + 280 - z0;
      b.box(0.5, 0.2, L, 0xb8b2a6, e * (hw + 0.3), 0.1, z0 + L / 2)
        .box(8, 0.16, L, 0xc9c6bd, e * (hw + 4.4), 0.08, z0 + L / 2);
      for (const lx of [MEDIAN + LANE_W, MEDIAN + 2 * LANE_W, MEDIAN + 3 * LANE_W]) {
        for (let k = 58; k < 280; k += 9) b.box(0.15, 0.02, 3, 0xf2f2ec, e * lx, 0.03, zr + k);
      }
    }
    // Asphalte lisse du carrefour Mandela (sous le virage 24 Novembre → 30 Juin, sans bordure)
    b.box(74, 0.02, 80, ASPHALT_COL, 8, 0.004, zr + 28);
    // 2. Saut-de-mouton Mandela & Arche monumentale du 30 Juin au-dessus du carrefour (axe du Boulevard du 30 Juin)
    const DH = 6.6, W = 2 * (MEDIAN + 2 * LANE_W), L = 128, zc = zr + 28;
    b.box(W, 1.35, L, 0xc4beb0, 0, DH, zc);
    for (const e of [-1, 1]) {
      b.box(0.4, 1.1, L, 0xd8d2c4, e * W / 2, DH + 1.2, zc);
      for (const sgn of [-1, 1]) {
        const rz = zc + sgn * (L / 2 + 42);
        b.box(W, 1.2, 86, 0xc4beb0, 0, DH / 2, rz, sgn > 0 ? 0.076 : -0.076, 0, 0);
      }
      for (const dz of [-22, 22]) {
        signs.add('xafricell', africellTexture, 32, 1.3, e * (W / 2 + 0.25), DH, zc + dz, e > 0 ? Math.PI / 2 : -Math.PI / 2, true, zr);
      }
      // Arche monumentale tricolore du Rond-point Mandela (vidéo Boulevard du 30juin.wmv 14:40)
      b.box(1.4, DH + 6.5, 2.2, 0xd8cfc2, e * (hw + 2.2), (DH + 6.5) / 2, zc - 10)
        .box(1.5, 2.2, 2.4, 0x0066cc, e * (hw + 2.2), DH + 2.0, zc - 10)
        .box(1.5, 1.6, 2.4, 0xf5c400, e * (hw + 2.2), DH + 3.9, zc - 10)
        .box(1.5, 1.6, 2.4, 0xd62828, e * (hw + 2.2), DH + 5.5, zc - 10);
    }
    b.box(2 * (hw + 3.2), 1.6, 1.8, 0x1b365d, 0, DH + 6.2, zc - 10);
    signs.add('xmandela_arch', () => signTexture('BOULEVARD DU 30 JUIN · ROND-POINT MANDELA', '← Socimat · Kintambo   |   Rotana · La Poste · Gare Centrale →', '#1b365d', '#f5c400'),
      22, 1.5, 0, DH + 6.2, zc - 9.0, 0, true, zr);
    for (const dz of [-38, -16, 16, 38]) b.cyl(0.85, 0.85, DH - 0.6, 0x9aa0a6, 0, (DH - 0.6) / 2, zc + dz);
    // 3. Grands immeubles emblématiques de la branche Ouest du 30 Juin (Mandela → Gouvernement, visibles à gauche au carrefour)
    addB30Afriland(b, signs, -1, zr + 78, { name: 'AFRILAND FIRST BANK CD', sub: 'Direction Générale · Bd du 30 Juin' });
    addB30AfricellTower(b, signs, -1, zr + 122, { name: 'TOUR AFRICELL · RAWBANK', sub: 'Boulevard du 30 Juin · Gombe' });
    addB30CopperGlass(b, signs, 1, zr + 132, { name: 'QUANTUM · FIBANK TOWER', sub: 'Boulevard du 30 Juin · Gombe' });
    addB30ThreePillars(b, signs, -1, zr + 172, { name: 'IMMEUBLE DES PALMIERS', sub: 'Boulevard du 30 Juin · Gombe' });
    addB30WhiteTower(b, signs, -1, zr + 212, { name: 'TOUR ROYAL GOMBE', sub: 'Boulevard du 30 Juin' });
    addB30Gouvernement(b, signs, 1, zr + 246, { name: 'HÔTEL DU GOUVERNEMENT', sub: 'Immeuble Intelligent · TMB · Place Royal' });
    // Panneaux directionnels au carrefour Mandela (liaison 24 Novembre ↔ 30 Juin)
    signs.add('x30j_ouest', () => signTexture('BD DU 30 JUIN (OUEST)', '← Gouvernement · Socimat · Kintambo', '#1d4fa0', '#ffffff'),
      5.8, 1.35, -(hw + 2.5), 3.6, zWest0 + 4, Math.PI / 2, true, zr);
    b.box(0.16, 3.8, 0.16, 0x8e949a, -(hw + 2.5), 1.9, zWest0 + 4);
    signs.add('x30j_est', () => signTexture('BD DU 30 JUIN (EST)', 'Rotana · La Poste · Gare Centrale →', '#1d4fa0', '#f5c400'),
      5.8, 1.35, hw + 2.5, 3.6, ARC_D.z0 + 8, -Math.PI / 4, true, ARC_D.z0);
    chunks.at(ARC_D.z0 + 8).box(0.16, 3.8, 0.16, 0x8e949a, hw + 2.5, 1.9, ARC_D.z0 + 8);
  }
}

/**
 * Construit le trajet dans `scene`. opts.env = false : trajet attaché à un autre dans la même scène (routes.js `attach`) :
 * ni ciel, ni lumières, ni brouillard, ni grand sol lointain (ceux du trajet principal servent, opts.fog : son brouillard).
 */
// ---------- Route Poids Lourds (routes.js `poidslourds`, `pl`) ----------
// D'après les vidéos du dossier « Routes poids lourds » et OSM : une seule chaussée sans terre-plein, de chaque côté un caniveau en
// béton bordé de blocs blancs et roses, de larges bas-côtés en terre battue ; à gauche, trottoir de béton puis chemin de fer (deux
// voies) ; le long de la route, murs d'usine, hangars, marchés, boutiques et grands panneaux. km : m réels depuis le boulevard Lumumba.
const PL = R.pl ?? null;
const PL_DIRT = 0xad9b82, PL_DIRT2 = 0x9c8b74;
const zKm = km => -toGame(km - 1057);                 // (le trajet commence à 1 057 m du boulevard Lumumba : plKm dans routes.js)
const PL_RAIL = [ROAD_EDGE + 9, ROAD_EDGE + 12.6];    // axes des deux voies ferrées (x < 0)
const PL_LEFT_X = 15;                                 // côté gauche : façades reculées derrière les rails

/** Bas-côté de la tranche [zc ± len/2] : bordure, caniveau, terre battue (et trottoir de béton à gauche). */
function plShoulder(b, s, zc, len) {
  const E = ROAD_EDGE;
  b.box(0.28, 0.22, len, 0xb7b1a5, s * (E + 0.14), 0.11, zc)                 // bordure
    .box(1.25, 0.03, len, 0x35302b, s * (E + 0.9), 0.012, zc)                 // caniveau
    .box(0.2, 0.26, len, 0xa8a296, s * (E + 1.62), 0.1, zc)                   // rebord du caniveau
    .box(46, 0.02, len, PL_DIRT, s * (E + 1.7 + 23), 0.008, zc);              // terre battue, poussière
  if (s < 0) b.box(2.5, 0.12, len, 0xb9b3a7, -(E + 3), 0.06, zc);             // trottoir de béton, entre le caniveau et les rails
}
// ---------- Rocade Sud-Est (routes.js `rocade`, tools/rocade.py ; vidéos du dossier « route rocade », regardées seulement comme modèle) ----------
// 2 × 2 voies sans terre-plein (double ligne blanche), caniveaux en U de béton, terre rouge ; dans les tranchées, de hauts talus couverts d'une
// grille de béton en losanges (pavés hexagonaux dans les cases) ; au bord, maisons neuves éparses et parcelles vides.
const ROC_CUTS = (R.rocCuts ?? []).map(([a, c]) => [g(a), g(c)]);          // [haut, bas] en z
const inRocCut = (z, m = 0) => ROC_CUTS.some(([a, c]) => z < a + m && z > c - m);
/** Accotement de la Rocade : caniveau en U de béton, puis terre rouge damée. */
function rocShoulder(b, s, zc, len) {
  const E = ROAD_EDGE;
  b.box(0.22, 0.2, len, 0xd9d4c8, s * (E + 0.11), 0.1, zc)                  // bord du caniveau, côté route
    .box(0.7, 0.03, len, 0x7f7a70, s * (E + 0.57), 0.0, zc)                 // fond du caniveau
    .box(0.22, 0.2, len, 0xd9d4c8, s * (E + 1.03), 0.1, zc)                 // bord extérieur
    .box(FRONT - E - 1.14, 0.02, len, 0xb5743f, s * (FRONT + E + 1.14) / 2, 0.008, zc);   // terre rouge damée
}
/** Grille de béton des talus : losanges clairs sur fond de pavés hexagonaux. */
function rocSlopeTexture() {
  const t = canvasTexture(256, 256, (x, W, H) => {
    x.fillStyle = '#c9bca2'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#b3a487'; x.lineWidth = 1;                              // pavés hexagonaux
    for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
      const cx = i * 22 + (j % 2) * 11, cy = j * 22, r = 10;
      x.beginPath();
      for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; x.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      x.closePath(); x.stroke();
    }
    x.strokeStyle = '#e4dccb'; x.lineWidth = 9;                              // nervures en losanges
    for (const [a, c] of [[[0, 0], [W, H]], [[W, 0], [0, H]], [[-W / 2, H / 2], [W / 2, -H / 2]], [[W / 2, H * 1.5], [W * 1.5, H / 2]],
      [[W / 2, -H / 2], [W * 1.5, H / 2]], [[-W / 2, H / 2], [W / 2, H * 1.5]]]) { x.beginPath(); x.moveTo(...a); x.lineTo(...c); x.stroke(); }
    x.strokeStyle = '#a0805a'; x.lineWidth = 3;                              // traces de terre le long des nervures
    for (let i = 0; i < 40; i++) { x.beginPath(); const px = Math.random() * W, py = Math.random() * H; x.moveTo(px, py); x.lineTo(px + rand(-8, 8), py + rand(4, 14)); x.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function addRocade(scene, chunks, details, signs) {
  // Talus des tranchées : une surface pliée par côté et par tranchée, du caniveau (y 0) au haut du talus
  const mat = new THREE.MeshLambertMaterial({ map: rocSlopeTexture(), side: THREE.DoubleSide });
  for (const [za, zb] of ROC_CUTS) for (const s of [-1, 1]) {
    const pos = [], uv = [], idx = [], n = Math.max(2, Math.ceil((za - zb) / 6));
    for (let i = 0; i <= n; i++) {
      const u = i / n, z = za - (za - zb) * u;
      const h = 1.2 + 8.5 * Math.pow(Math.sin(Math.PI * u), 0.55);            // (le talus monte et redescend aux deux bouts)
      const x0 = s * (ROAD_EDGE + 1.2), x1 = s * (ROAD_EDGE + 1.2 + h * 1.35), run = Math.hypot(h * 1.35, h);
      pos.push(x0, 0.05, z, x1, h, z);
      uv.push((za - z) / 3.5, 0, (za - z) / 3.5, run / 3.5);
      if (i) { const k = 2 * i; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      // haut du talus : terre rouge et broussailles
      const b = chunks.at(z);
      if (i < n) b.box(14, 0.4, (za - zb) / n + 0.2, 0xa8592c, s * (ROAD_EDGE + 1.2 + h * 1.35 + 7), h - 0.15, z - (za - zb) / n / 2);
      if (i % 3 === 1 && chance(0.6)) b.ball(rand(0.8, 1.6), pick([0x4f7a2e, 0x5f8a35, 0x3f6a28]), s * (ROAD_EDGE + 3 + h * 1.35 + rand(0, 8)), h + 0.5, z, 1.3, 0.8, 1.3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(bendGeometry(geo), mat);
    m.receiveShadow = true;
    scene.add(m);
  }
  // Passage du rail (chemin de fer Matadi–Kinshasa) : rails noyés dans la chaussée, croix de Saint-André
  if (R.rail) {
    const z = g(R.rail), b = chunks.at(z), L = 2 * FRONT;
    for (const dz of [-0.72, 0.72]) b.box(L, 0.05, 0.08, 0x6d6a66, 0, 0.035, z + dz);
    for (let x = -FRONT + 0.3; x < FRONT; x += 0.65) if (Math.abs(x) > ROAD_EDGE + 0.4) b.box(0.22, 0.06, 2.4, 0x5a4632, x, 0.02, z);
    for (const s of [-1, 1]) {
      const x = s * (ROAD_EDGE + 2.2), zs = z + s * 6;
      b.box(0.12, 3.2, 0.12, 0x8e949a, x, 1.6, zs);
      for (const r of [0.6, -0.6]) b.box(1.6, 0.22, 0.05, 0xd62828, x, 2.9, zs, 0, 0, r).box(1.6, 0.08, 0.06, 0xf4f4f0, x, 2.9, zs, 0, 0, r);
    }
    signs.add('roc_rail', () => signTexture('PASSAGE À NIVEAU', 'Chemin de fer Matadi – Kinshasa', '#c0392b'), 3.6, 1.1, ROAD_EDGE + 2.2, 4, z + 6, 0, true, z);
  }
}
/** Blocs de béton blancs et roses sur la bordure, tous les 3,4 m (tronçons sans rue ni pont). */
function plBlocks(details) {
  let k = 0;
  for (let z = -42; z > Z_END + 120; z -= 3.4) {
    k++;
    for (const s of [-1, 1]) {
      if (atSideRoad(s, z, 1) || inRiver(z, 2) || chance(0.08)) continue;
      details.at(z).box(0.46, 0.44, 1.4, k % 3 === 0 ? 0xc9747c : 0xdcd8cc, s * (ROAD_EDGE + 0.2), 0.3, z);
    }
  }
}
/** Chemin de fer le long de la route, à gauche : ballast, rails, traverses (de près). */
function plRails(chunks, details) {
  const z0 = zKm(PL.railFrom), z1 = zKm(PL.railTo);
  for (const [a, c] of solid(z0, z1)) {
    for (const [p, q] of pieces(a, c, 96)) {
      const b = chunks.at((p + q) / 2), len = p - q, zc = (p + q) / 2;
      for (const x of PL_RAIL) {
        b.box(2.6, 0.05, len, PL_DIRT2, -x, 0.03, zc);
        for (const g2 of [-0.55, 0.55]) b.box(0.07, 0.13, len, 0x6d675f, -x + g2, 0.12, zc);
      }
    }
  }
  for (let z = z0; z > z1; z -= 2.4) {
    if (inRiver(z, 2)) continue;
    for (const x of PL_RAIL) details.at(z).box(1.9, 0.06, 0.26, 0x5e5044, -x, 0.075, z);
  }
  // Déchets et ordures entre les rails et la route
  for (let z = z0; z > z1; z -= rand(3, 9)) {
    if (inRiver(z, 3) || atSideRoad(-1, z, 2)) continue;
    details.at(z).box(rand(0.1, 0.5), 0.04, rand(0.1, 0.5), pick([0xe8e8e8, 0x1d6fd1, 0x2b2b2b, 0xd62828, 0x7a6a55]), -(ROAD_EDGE + rand(5, 20)), 0.03, z);
  }
}
/** Voie ferrée qui traverse la route (OSM) : rails à ras du goudron, croix de passage à niveau. */
function plCrossing(chunks, signs, km, angDeg, name) {
  const z = zKm(km), a = angDeg * Math.PI / 180, b = chunks.at(z), L = 2 * ROAD_EDGE + 80;   // (train qui traverse : main.js updateTrain)
  for (const g2 of [-0.55, 0.55]) {
    b.box(L, 0.05, 0.08, 0x77716a, 12, 0.05, z + g2 / Math.cos(a), 0, a, 0);
  }
  for (const s of [-1, 1]) {
    const x = s * (ROAD_EDGE + 3), zc = z + s * 7;
    b.box(0.14, 3.2, 0.14, 0x2a2a2a, x, 1.6, zc)
      .box(1.6, 0.16, 0.05, 0xd62828, x, 3, zc, 0, 0, 0.7).box(1.6, 0.16, 0.05, 0xf2f2ec, x, 3, zc, 0, 0, -0.7);
  }
  signs.add(`pl_cross_${km}`, () => signTexture(name, 'Attention aux trains', '#c8102e'), 3.4, 0.9, ROAD_EDGE + 3, 3.9, z + 7.08, 0, true);
}
/** Mur d'usine en panneaux de béton avec poteaux, fil barbelé et parfois une publicité peinte. */
function plWall(b, side, z, len, x, h = 3.2) {
  const col = pick([0xb4b0a6, 0xa9a59b, 0xbdb7a9, 0x9d9a90]);
  b.box(0.3, h, len, col, x, h / 2, z).box(0.34, 0.5, len, 0x7c7a73, x, 0.25, z);        // mur, soubassement sali
  for (let dz = -len / 2; dz <= len / 2; dz += 4) b.box(0.42, h + 0.4, 0.42, 0x8f8c84, x, (h + 0.4) / 2, z + dz);
  b.box(0.04, 0.04, len, 0x2a2a2a, x, h + 0.42, z);
}
/** Grand hangar industriel : mur, bardage, toit à deux pans. */
function plShed(b, side, z, w, d, x, wall, roof, h = 7) {
  b.box(d, h, w, wall, x + side * d / 2, h / 2, z);
  b.add(new THREE.CylinderGeometry(0.72, 0.72, w, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).scale(d * 0.86, 2.3, 1), roof, x + side * d / 2, h + 0.72, z);
  b.box(0.08, 3.2, Math.min(w * 0.3, 7), 0x5b6b7a, x - side * 0.05, 1.6, z + rand(-w / 4, w / 4));
  b.box(0.06, 0.9, w * 0.96, pick([0x1d4fa0, 0xc8102e, 0x2f6f3e, 0x8e949a]), x - side * 0.05, h - 0.8, z);
}
/** Étals de marché le long de la route : bâches, parasols, kiosques, gens. */
function plMarket(details, side, z, w) {
  for (let k = 0, n = Math.round(w / 5); k < n; k++) {
    const zz = z - w / 2 + (k + 0.5) * w / n;
    if (atSideRoad(side, zz, 2)) continue;
    addVendors(details.at(zz), side, zz, chance(0.5));
    if (chance(0.5)) addPerson(details.at(zz), side * (ROAD_EDGE + rand(3, 7)), zz + rand(-2, 2));
  }
}
/** Façades d'une tranche [z, z - w] d'un côté, selon le genre de la section. x0 : alignement ; b : la tranche. */
function plFacade(chunks, details, signs, kind, side, z, w) {
  const cz = z - w / 2, dx = side < 0 ? -PL_LEFT_X : 0, b = chunks.at(cz), B = side < 0 ? shiftX(b, dx) : b, S = side < 0 ? shiftSigns(signs, dx) : signs;
  const x0 = side * FRONT + dx;
  switch (kind) {
    case 'wall': case 'wallAds':
      plWall(b, side, cz, w, x0, rand(2.8, 3.6), kind === 'wallAds');
      if (chance(0.45)) plShed(b, side, cz, w * 0.8, rand(16, 26), x0 + side * rand(6, 14), pick([0xd9d6cc, 0xc9c6bc, 0xe2dfd6]), pick([0x8c9196, 0x6f747a, 0x9aa0a6]), rand(6, 9));
      break;
    case 'prison':
      plWall(b, side, cz, w, x0, 5.2);
      if (chance(0.25)) b.box(2.4, 8, 2.4, 0xa9a59b, x0 - side * 1, 4, cz).box(3, 0.4, 3, 0x6f747a, x0 - side * 1, 8.2, cz);   // mirador
      break;
    case 'redfence':
      b.box(0.2, 2.5, w, 0xa81e2c, x0, 1.25, cz);
      plShed(b, side, cz, w * 0.85, 24, x0 + side * 8, 0xe9e7df, 0xcfd2d2, 9);
      break;
    case 'shed':
      plWall(b, side, cz, w, x0, 2.4);
      plShed(b, side, cz, w * 0.88, rand(18, 28), x0 + side * 6, pick([0xe2dfd6, 0xc9ced2, 0xd8dbdc, 0x8fa6b8]), pick([0x8c9196, 0x5e7f9c, 0xb4b8bb]), rand(7, 10));
      break;
    case 'factory':
      plWall(b, side, cz, w, x0, 2.6);
      plShed(b, side, cz, w * 0.8, 16, x0 + side * 6, 0xe6dcc8, 0x9c4a32, 6.5);
      break;
    case 'brewery':
      plWall(b, side, cz, w, x0, 3);
      plShed(b, side, cz, w * 0.9, 26, x0 + side * 6, 0xe8e4d8, 0x8c9196, 11);
      if (chance(0.5)) for (let k = 0; k < 3; k++) b.cyl(3, 3, 17, 0xcfd2d2, x0 + side * (38 + k * 7), 8.5, cz);   // cuves
      break;
    case 'longRed':
      B.box(9, 4.2, w, 0xe6dcc8, side * (FRONT + 4.5), 2.1, cz).box(9.8, 0.2, w, 0x9c3a2a, side * (FRONT + 4.5), 4.5, cz);
      for (let dz = -w / 2 + 3; dz < w / 2; dz += 6) B.box(0.06, 2.4, 3.6, pick(GATES), side * (FRONT - 0.03), 1.2, cz + dz);
      plMarket(details, side, cz, w * 0.5);
      break;
    case 'longBlue':
      B.box(8, 3.6, w, 0xf2f2ee, side * (FRONT + 4), 1.8, cz).box(8.6, 0.2, w, 0x2f6fb0, side * (FRONT + 4), 3.8, cz).box(0.08, 0.9, w, 0x2f6fb0, side * (FRONT - 0.03), 3, cz);
      plMarket(details, side, cz, w * 0.5);
      break;
    case 'longStore':
      B.box(14, 5.2, w, 0xf4f2ec, side * (FRONT + 9), 2.6, cz).box(14.6, 0.5, w, 0xc8102e, side * (FRONT + 9), 5.3, cz)
        .box(0.08, 2.8, w * 0.9, 0x24323f, side * (FRONT + 1.96), 1.6, cz);
      for (let dz = -w / 2 + 2; dz < w / 2; dz += 4) B.box(2.4, 0.32, 1.2, 0x4b7f35, side * (FRONT - 1.4), 0.16, cz + dz);   // bacs à fleurs
      break;
    case 'blueShack':
      for (let dz = -w / 2 + 3; dz < w / 2 - 2; dz += 7.5) {
        B.box(7, 3, 6.8, pick(WALLS), side * (FRONT + 4), 1.5, cz + dz).box(8, 0.14, 7.6, 0x2a62b0, side * (FRONT + 4), 3.2, cz + dz, 0, 0, side * 0.1);
      }
      plMarket(details, side, cz, w * 0.6);
      break;
    case 'market':
      plMarket(details, side, cz, w);
      if (chance(0.7)) addShop(B, S, side, cz, Math.min(w, rand(7, 11)));
      break;
    case 'shops':
      if (chance(0.55)) addShop(B, S, side, cz, Math.min(w, rand(6, 11))); else addParcel(B, side, cz, Math.min(w, 12));
      if (chance(0.45)) addVendors(details.at(cz), side, cz, false);
      break;
    case 'shops2':
      addTall(B, S, side, cz, Math.min(w, rand(9, 14)), 2 + Math.floor(Math.random() * 2));
      if (chance(0.5)) addVendors(details.at(cz), side, cz, false);
      break;
    case 'tall':
      addTall(B, S, side, cz, Math.min(w, rand(12, 16)), 4 + Math.floor(Math.random() * 4));
      break;
    case 'houses':
      if (chance(0.65)) addParcel(B, side, cz, Math.min(w, 13)); else addTall(B, S, side, cz, Math.min(w, 11), 2);
      break;
    case 'trees':
      if (chance(0.7)) addMango(b, x0 + side * rand(1, 14), cz + rand(-w / 3, w / 3), rand(1, 1.7));
      if (chance(0.3)) addPalm(b, x0 + side * rand(1, 12), cz + rand(-w / 3, w / 3));
      if (chance(0.5)) b.box(0.26, 2, w, pick([0xc9c6bc, 0xd6d2c6]), x0 + side * 0.2, 1, cz);
      break;
    case 'lot':
      if (chance(0.35)) b.ball(rand(2, 4.5), PL_DIRT2, x0 + side * rand(0, 12), 0, cz, 1, 0.42, 1);    // tas de sable et de gravats
      if (chance(0.3)) addShop(B, S, side, cz, Math.min(w, rand(6, 9)));
      if (chance(0.25)) addVendors(details.at(cz), side, cz, false);
      break;
    case 'lawn':
      b.box(w, 0.04, 24, 0x6f9a48, x0 + side * 12, 0.03, cz, 0, Math.PI / 2, 0);
      break;
    default:
  }
}
const PL_W = { wall: [26, 44], wallAds: [26, 44], prison: [40, 60], redfence: [34, 40], shed: [28, 42], factory: [20, 30], brewery: [34, 44],
  longRed: [30, 46], longBlue: [26, 40], longStore: [34, 46], blueShack: [20, 28], market: [14, 22], shops: [8, 13], shops2: [10, 15],
  tall: [14, 20], houses: [10, 15], trees: [10, 18], lot: [12, 22], lawn: [24, 30], none: [10, 10] };

/** Murs texturés qui se répètent (murs ajourés, pierre, fenêtres) : un maillage par motif. tw, th : taille du motif en mètres. */
class TexWalls {
  constructor() { this.g = new Map(); }
  add(key, w, h, x, y, z, ry) {
    const [draw, tw, th] = CAMPUS_TEX[key];
    if (!this.g.has(key)) {
      const tex = canvasTexture(256, 128, draw);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      this.g.set(key, { tex, b: new Builder(true) });
    }
    const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tw, uv.getY(i) * h / th);
    this.g.get(key).b.add(geo, 0xffffff, x, y, z, 0, ry, 0);
  }
  build(scene) {
    for (const { tex, b } of this.g.values()) {
      const m = new THREE.Mesh(bendGeometry(b.geometry()), new THREE.MeshLambertMaterial({ map: tex }));
      m.receiveShadow = true;
      scene.add(m);
    }
  }
}
/** Mur ajouré « en appareil de briques » : cadre de béton, trous en quinconce (portail, facultés). */
const latticeDraw = (frame, hole) => (x, W, H) => {
  x.fillStyle = frame; x.fillRect(0, 0, W, H);
  x.fillStyle = hole;
  const bw = W / 2, bh = H / 2, m = 9;
  for (let r = 0; r < 2; r++) for (let c = -1; c < 3; c++) x.fillRect(c * bw + (r ? bw / 2 : 0) + m, r * bh + m * 0.7, bw - 2 * m, bh - 1.4 * m);
};
const speckle = (bg, cols, n, a, b2) => (x, W, H) => {
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  for (let i = 0; i < n; i++) { x.fillStyle = cols[i % cols.length]; const r = a + Math.random() * (b2 - a); x.fillRect(Math.random() * W - r / 2, Math.random() * H - r / 2, r, r * 0.7); }
};
const windowDraw = (frame, sill, glass) => (x, W, H) => {
  x.fillStyle = frame; x.fillRect(0, 0, W, H);
  x.fillStyle = sill; x.fillRect(0, H - 14, W, 14); x.fillRect(0, 0, 10, H); x.fillRect(W / 2 - 5, 0, 10, H);
  x.fillStyle = glass; for (const ox of [18, W / 2 + 13]) x.fillRect(ox, 18, W / 2 - 31, H - 46);
  x.fillStyle = frame; for (const ox of [W / 4 + 2, W * 3 / 4 + 2]) x.fillRect(ox, 18, 5, H - 46);
};
const CAMPUS_TEX = {
  claustra: [latticeDraw('#dcdcd4', '#2c2a28'), 3.6, 1.8],          // portail : béton clair, trous sombres
  brickLat: [latticeDraw('#9a5240', '#3b2520'), 2.6, 1.3],          // facultés : grille de brique rouge
  tanLat: [latticeDraw('#dcc58e', '#6d5a3a'), 2.2, 1.1],            // bâtiment administratif : ailes
  stoneBase: [speckle('#6e5c4c', ['#a58f78', '#8a7562', '#bda68e', '#57473a'], 130, 6, 22), 2.4, 1.2],   // socle en pierre
  rubble: [speckle('#6f6358', ['#8d7f70', '#574d43', '#a09180', '#463d35'], 420, 3, 9), 3, 1.5],         // pignons en moellons
  facWin: [windowDraw('#c9bda2', '#e3dac4', '#2f3c47'), 6, 3.1],    // facultés : fenêtres en bandes
  homeWin: [windowDraw('#d9c48f', '#efe3c2', '#54493a'), 5, 3.3],   // homes : coursives, trame beige
};
/** L'image de Notre-Dame de la Sagesse : ciel bleu et rose, colombe, et le plan du campus en blocs sombres (vue du drone, photo de face). */
const muralTexture = () => canvasTexture(512, 512, (x, W, H) => {
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#4f97c9'); g.addColorStop(0.32, '#a8c6d8'); g.addColorStop(0.55, '#dcb2ae'); g.addColorStop(1, '#c79a95');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,0.28)'; x.beginPath(); x.arc(W * 0.62, H * 0.42, W * 0.3, 0, 7); x.fill();
  x.fillStyle = '#34414f';
  for (let i = 0; i < 110; i++) { const bx = W * (0.08 + Math.random() * 0.84), by = H * (0.42 + Math.random() * 0.54); x.fillRect(bx, by, 10 + Math.random() * 30, 6 + Math.random() * 16); }
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(W / 2, H * 0.07); x.lineTo(W * 0.56, H * 0.11); x.lineTo(W * 0.66, H * 0.09); x.lineTo(W * 0.54, H * 0.14); x.lineTo(W / 2, H * 0.2); x.lineTo(W * 0.46, H * 0.14); x.lineTo(W * 0.34, H * 0.09); x.lineTo(W * 0.44, H * 0.11); x.fill();
});
/** L'enseigne du portail : grand panneau blanc, écusson à gauche, « UNIVERSITÉ DE KINSHASA » puis UNIKIN en grandes lettres (vidéo, 00:03). */
const gateSign = () => canvasTexture(1024, 256, (x, W, H) => {
  x.fillStyle = '#eef0ec'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#8f9498'; x.lineWidth = 8; x.strokeRect(4, 4, W - 8, H - 8);
  x.fillStyle = '#d9c26a'; x.beginPath(); x.moveTo(50, 46); x.lineTo(170, 46); x.lineTo(170, 150); x.quadraticCurveTo(110, 240, 50, 150); x.fill();
  x.fillStyle = '#eef0ec'; x.fillRect(100, 46, 20, 170);
  x.fillStyle = '#3f6d8a'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 40px sans-serif'; x.fillText('UNIVERSITÉ DE KINSHASA', W * 0.58, 58);
  x.font = 'bold 142px sans-serif'; x.fillText('UNIKIN', W * 0.58, 168, W * 0.72);
});
/** Une aile de bâtiment du campus (u le long, v en travers, v > 0 du côté `front` : la route la plus proche). */
function campusBuilding(b, d, T, plates, signs, B, front, free) {
  const { x, z, ux, uz, l, w, k, name } = B, ry = Math.atan2(ux, uz), vx = -uz * front, vz = ux * front;
  const at = (u, v) => [x + ux * u + vx * v, z + uz * u + vz * v];
  const box = (W, H, D, c, u, y, v, rx = 0) => { const [px, pz] = at(u, v); b.box(W, H, D, c, px, y, pz, rx, ry, 0); };   // (W en travers, D le long)
  const ryF = Math.atan2(vx, vz), ryB = ryF + Math.PI, ryE = ry;    // plans : façade, arrière, pignons
  const wall = (key, W, H, u, y, v, r = ryF) => { const [px, pz] = at(u, v); T.add(key, W, H, px, y, pz, r); };
  const CONC = 0xd8d2c0, ROOF = 0x8d8f8c;
  if (k === 'dome') {
    // Notre-Dame de la Sagesse : très haute façade à l'image du campus entre deux murs crème en biais, grand toit gris-vert arrondi
    // qui déborde, portique blanc à trois ouvertures, escalier en éventail (photo de face, vue du drone)
    const R0 = Math.max(l, w) / 2 + 1, H = 15, [fx, fz] = [vx, vz], tx = fz, tz = -fx, ryN = Math.atan2(fx, fz);
    const P = (f, s) => [x + fx * f + tx * s, z + fz * f + tz * s];
    b.add(new THREE.CylinderGeometry(R0, R0, H, 20, 1, false, Math.PI / 2, Math.PI), 0xece7d6, x, H / 2, z, 0, ryN, 0);
    b.add(new THREE.SphereGeometry(R0 * 1.05, 20, 6, Math.PI / 2, Math.PI, 0, Math.PI / 2).scale(1, 0.34, 1), 0x7c8a80, x, H, z, 0, ryN, 0);
    b.box(2 * R0 + 2.4, 0.8, 3.2, 0x6f7f76, ...(([px, pz]) => [px, H + 0.5, pz])(P(0.6, 0)), 0, ryN, 0);
    for (const s of [-1, 1]) {
      const [px, pz] = P(1.2, s * R0 * 0.72);
      b.box(R0 * 0.62, H, 1.2, 0xede6cf, px, H / 2, pz, 0, ryN + s * 0.34, 0);
    }
    const [mx, mz] = P(0.3, 0);
    signs.add('sagesse_img', muralTexture, R0 * 0.96, H - 4, mx, H / 2 + 2.2, mz, ryN);
    const [cx, cz] = P(2.3, 0);
    b.box(R0 * 1.15, 3.6, 3.8, 0xf4f3ee, cx, 1.8, cz, 0, ryN, 0).box(R0 * 1.25, 0.5, 4.2, 0x8c7a66, cx, 3.8, cz, 0, ryN, 0);
    for (const s of [-1, 0, 1]) {
      const [ox, oz] = P(4.25, s * R0 * 0.38);
      b.box(R0 * 0.3, 2.4, 0.08, 0x1d232a, ox, 1.3, oz, 0, ryN, 0).box(R0 * 0.3, 0.7, 0.09, 0x5c9ac4, ox, 2.95, oz, 0, ryN, 0);
    }
    for (let i = 0; i < 4; i++) {
      const [sx, sz] = P(4.8 + i * 1.1, 0);
      b.box(R0 * (1.4 + i * 0.16), 0.5 - i * 0.12, 1.1, 0xbfb9ac, sx, (0.5 - i * 0.12) / 2, sz, 0, ryN, 0);
    }
    const [nx, nz] = P(4.4, R0 * 0.72);
    plates.add(name, 6, 1.5, nx, 3, nz, ryN);
    return;
  }
  if (k === 'admin') {
    // Bâtiment administratif : corps central en moellons sombres, hautes colonnes blanches, vitrage bleu, toit clair qui se relève aux
    // deux bouts ; ailes basses aux cadres blancs remplis de grille beige ; large escalier (vidéo de la visite du campus)
    const lc = Math.min(l * 0.32, 15), H = 11, HW = 6.8, lw = (l - lc) / 2;
    box(w, H, lc, 0x5e544a, 0, H / 2, 0);
    wall('rubble', lc, H, 0, H / 2, w / 2 + 0.03); wall('rubble', lc, H, 0, H / 2, -(w / 2 + 0.03), ryB);
    wall('rubble', w, H, lc / 2 + 0.03, H / 2, 0, ryE); wall('rubble', w, H, -lc / 2 - 0.03, H / 2, 0, ryE + Math.PI);
    box(0.1, H * 0.62, lc * 0.5, 0x3f7fb2, 0, H * 0.34, w / 2 + 0.08);
    for (let i = -2; i <= 2; i++) box(0.32, H * 0.7, 0.32, 0xf4f3ee, i * lc * 0.13, H * 0.35, w / 2 + 0.9);
    for (const sg of [-1, 1]) box(w + 3.6, 0.42, lc * 0.56, 0xeae4d6, sg * lc * 0.26, H + 0.75, 0, -sg * 0.17);    // toit relevé
    for (const sg of [-1, 1]) {
      const uc = sg * (lc + lw) / 2;
      box(w * 0.92, HW, lw, 0x7a6a50, uc, HW / 2, 0);
      for (const v of [1, -1]) {
        wall('tanLat', lw, HW - 1, uc, HW / 2, v * (w * 0.46 + 0.03), v > 0 ? ryF : ryB);
        for (let i = 0, n = Math.max(2, Math.round(lw / 3)); i <= n; i++) box(0.34, HW, 0.34, 0xf4f3ee, uc - lw / 2 + lw * i / n, HW / 2, v * (w * 0.46 + 0.18));
      }
      box(w * 0.92 + 2.6, 0.42, lw + 1, 0xeae4d6, uc, HW + 0.2, 0);
    }
    for (let i = 0; i < 4; i++) box(1.1, 0.5 - i * 0.12, lc * (1.05 + i * 0.1), 0xc9c4b6, 0, (0.5 - i * 0.12) / 2, w / 2 + 1.8 + i * 1.05);
    if (name) { const [px, pz] = at(0, w / 2 + 1.1); plates.add(name, 6, 1.5, px, H * 0.78, pz, ryF); }
    // bordure rouge et blanche et massifs devant (vidéo)
    for (let i = -9; i <= 9; i++) {
      const [cx, cz] = at(i * 2.2, w / 2 + 7);
      if (free(cx, cz, 0.3)) d.box(0.34, 0.26, 2.15, i % 2 ? 0xc8102e : 0xf2efe8, cx, 0.13, cz, 0, ry, 0);
    }
    for (const sg of [-1, 1]) { const [px, pz] = at(sg * lc * 0.8, w / 2 + 3.4); if (free(px, pz, 1)) addPalm(b, px, pz, 0.8); }
    return;
  }
  if (k === 'home') {
    // Homes : longues barres beiges à trois niveaux, trame régulière d'ouvertures, grand toit gris de tôle (vue du drone)
    const H = 10;
    box(w, H, l, 0xcdb88a, 0, H / 2, 0);
    for (const v of [1, -1]) wall('homeWin', l, H - 0.5, 0, H / 2 + 0.2, v * (w / 2 + 0.03), v > 0 ? ryF : ryB);
    box(w + 1.8, 0.3, l + 1.8, ROOF, 0, H + 0.2, 0);
    box(w * 0.5, 0.5, l, 0x7f817e, 0, H + 0.55, 0);
    if (name) { const [px, pz] = at(l * 0.25, w / 2 + 0.12); plates.add(name, 4.8, 1.2, px, H - 1.1, pz, ryF); }
    return;
  }
  if (k === 'fac') {
    // Facultés : grille de brique rouge au rez-de-chaussée, bandes de fenêtres entre des poteaux clairs à l'étage, pignons en moellons,
    // toit à faible pente aux larges débords (vidéos de la visite et en voiture)
    const H = 9.4, Hb = 3.3;
    box(w, H, l, 0x8a7a62, 0, H / 2, 0);
    for (const v of [1, -1]) {
      const rr = v > 0 ? ryF : ryB, vv = v * (w / 2 + 0.03);
      wall('brickLat', l, Hb, 0, Hb / 2, vv, rr);
      wall('facWin', l, H - Hb, 0, Hb + (H - Hb) / 2, vv, rr);
      box(0.3, 0.22, l, CONC, 0, Hb, v * (w / 2 + 0.1));
      for (let i = 0, n = Math.max(2, Math.round(l / 4.4)); i <= n; i++) box(0.3, H, 0.42, CONC, -l / 2 + l * i / n, H / 2, v * (w / 2 + 0.16));
    }
    wall('rubble', w, H, l / 2 + 0.03, H / 2, 0, ryE); wall('rubble', w, H, -l / 2 - 0.03, H / 2, 0, ryE + Math.PI);
    box(w + 3.4, 0.28, l + 3, ROOF, 0, H + 0.12, 0);
    for (const v of [1, -1]) box(w / 2 + 1.7, 0.2, l + 2.4, 0x9b9c98, 0, H + 0.52, v * (w / 4 + 0.4), 0);
    if (name) {
      const [ex, ez] = at(0, w / 2 + 0.8);
      b.box(4.6, 3.9, 1.5, 0xeeebe0, ex, 1.95, ez, 0, ry + Math.PI / 2, 0);
      const [gx, gz] = at(0, w / 2 + 1.58);
      b.box(3.1, 2.7, 0.1, 0x1f2830, gx, 1.35, gz, 0, ry + Math.PI / 2, 0);
      for (let i = 0; i < 3; i++) { const [sx, sz] = at(0, w / 2 + 1.9 + i * 0.7); b.box(5.4 + i * 0.7, 0.36 - i * 0.1, 0.7, 0xc9c4b6, sx, (0.36 - i * 0.1) / 2, sz, 0, ry + Math.PI / 2, 0); }
      const [px, pz] = at(0, w / 2 + 1.62); plates.add(name, 5.6, 1.4, px, 4.7, pz, ryF);
    }
    return;
  }
  const H = k === 'resto' ? 5.2 : 4, col = k === 'resto' ? 0xe0d8c6 : pick([0xd8cfba, 0xe2dccb, 0xcfc6b2]);
  box(w, H, l, col, 0, H / 2, 0);
  box(w + 1.6, 0.22, l + 1.6, k === 'resto' ? 0x9a4a32 : pick([0x8c6a54, 0x8f8d86]), 0, H + 0.14, 0);
  box(0.08, 1.5, l * 0.72, 0x2f3c47, 0, 2.1, w / 2 + 0.04);
  if (name) { const [px, pz] = at(0, w / 2 + 0.1); plates.add(name, 4.8, 1.2, px, H - 0.5, pz, ryF); }
}
/** Le portail de l'UNIKIN (vidéos en voiture, 00:03) : deux piliers de béton portent un long auvent mince qui se relève à droite, avec le
 *  grand panneau blanc posé dessus ; de chaque côté, de longs pavillons aux murs ajourés sur un socle de pierre ; barrière rouge et blanche. */
function addCampusGate(b, d, T, signs, zG) {
  const E = ROAD_EDGE, PX = E + 1.5, CONC = 0xa9a79f, DARK = 0x777670, WH = 0xeeeee6, Y = 6.5;
  for (const s of [-1, 1]) {
    b.box(1.5, Y, 2.6, CONC, s * PX, Y / 2, zG);
    b.box(0.8, 0.9, 3.2, CONC, s * PX, Y - 0.4, zG);
  }
  // l'auvent : dalle mince, dessous sombre ; à gauche il dépasse en pointe, à droite il se relève au-dessus du pavillon
  b.box(2 * PX + 1.5, 0.5, 8, CONC, 0, Y + 0.25, zG).box(2 * PX + 1.3, 0.1, 7.6, DARK, 0, Y - 0.04, zG);
  b.box(4.4, 0.42, 6.6, CONC, -(PX + 2.6), Y + 0.26, zG);
  b.box(7, 0.46, 8.4, CONC, PX + 3.6, Y + 1.15, zG, 0, 0, 0.3).box(6.9, 0.1, 8, DARK, PX + 3.6, Y + 0.88, zG, 0, 0, 0.3);
  // le grand panneau posé sur l'auvent, entre les piliers
  const SW = 2 * PX + 1.2, SH = SW / 4;
  for (const u of [-SW * 0.36, SW * 0.36]) b.box(0.22, 1, 0.22, 0x8f9498, u, Y + 0.95, zG + 0.6);
  b.box(SW + 0.2, SH + 0.15, 0.22, 0x8f9498, 0, Y + 1.3 + SH / 2, zG + 0.6);
  signs.add('unikin_gate', gateSign, SW, SH, 0, Y + 1.3 + SH / 2, zG + 0.74, 0, true);
  signs.add('unikin_gate', gateSign, SW, SH, 0, Y + 1.3 + SH / 2, zG + 0.46, Math.PI, true);
  // les pavillons : à droite long, à gauche plus court ; façades côté route d'arrivée et côté campus
  for (const [s, L] of [[1, 24], [-1, 12]]) {
    const x0 = s * (PX + 1), xc = x0 + s * L / 2, H = 4.5, D = 7, zf = zG + D / 2;
    b.box(L, H, D, 0x38322c, xc, H / 2, zG).box(L + 0.5, 0.3, D + 0.5, WH, xc, H + 0.15, zG).box(L + 0.5, 0.14, D + 0.5, 0x2f2f2d, xc, H + 0.36, zG);
    for (const [zz, ry] of [[zf + 0.04, 0], [zG - D / 2 - 0.04, Math.PI]]) {
      T.add('stoneBase', L, 0.95, xc, 0.48, zz, ry);
      T.add('claustra', L, H - 0.95, xc, 0.95 + (H - 0.95) / 2, zz, ry);
    }
    for (const zz of [zf + 0.12, zG - D / 2 - 0.12]) for (let i = 1, n = Math.round(L / 6); i < n; i++) b.box(0.46, H - 0.95, 0.2, WH, x0 + s * L * i / n, 0.95 + (H - 0.95) / 2, zz);
    T.add('stoneBase', D, 0.95, x0 + s * (L + 0.04), 0.48, zG, s * Math.PI / 2);
    T.add('claustra', D, H - 0.95, x0 + s * (L + 0.04), 0.95 + (H - 0.95) / 2, zG, s * Math.PI / 2);
  }
  // la petite loge blanche contre le pilier de droite, sa fenêtre bleue ; la porte brune à gauche
  b.box(1.9, 4.2, 4, WH, PX + 1.8, 2.1, zG + 5.2).box(2.1, 0.3, 4.2, 0x8f9498, PX + 1.8, 4.3, zG + 5.2).box(0.9, 1.3, 0.06, 0x2a62b0, PX + 1.8, 2.5, zG + 7.23);
  b.box(1.3, 2.6, 0.06, 0x7a4b2a, -(PX + 2.6), 1.3, zG + 3.56);
  // la barrière : poteau, contrepoids, perche rouge et blanche levée au-dessus de la voie de gauche
  const bx = -(E + 0.5), bz = zG + 4.8;
  b.box(0.22, 1.1, 0.22, 0xd8d8d0, bx, 0.55, bz).box(0.7, 0.34, 0.34, 0x444444, bx - 0.5, 1.1, bz, 0, 0, 0.22);
  for (let i = 0; i < 7; i++) {
    const t = 0.5 + i * 0.95, a = 0.22;
    b.box(0.95, 0.09, 0.09, i % 2 ? 0xf2f2ec : 0xc8102e, bx + t * Math.cos(a), 1.12 + t * Math.sin(a), bz, 0, 0, a);
  }
  // Parasols et vendeurs devant le pavillon de gauche (vlog), petits étals à droite ; plantes le long de la bordure
  for (let k = 0; k < 8; k++) {
    const x = -(E + 3.5 + k * 1.9), zz = zG + rand(7.5, 12);
    d.cyl(0.04, 0.04, 2.3, 0x666666, x, 1.15, zz).add(new THREE.ConeGeometry(1.35, 0.5, 8), pick(UMBRELLAS), x, 2.4, zz).box(1.1, 0.7, 0.8, 0x8b6b45, x, 0.35, zz);
    addPerson(d, x + 0.6, zz + 1, { sitting: chance(0.5) });
  }
  for (let k = 0; k < 3; k++) {
    const x = E + 7 + k * 3.2, zz = zG + rand(7, 11);
    d.cyl(0.04, 0.04, 2.3, 0x666666, x, 1.15, zz).add(new THREE.ConeGeometry(1.35, 0.5, 8), pick(UMBRELLAS), x, 2.4, zz);
    addPerson(d, x, zz + 0.9, {});
  }
  for (let k = 0; k < 6; k++) d.ball(0.4, 0x4f8a3a, -(E + 3 + k * 1.7), 0.4, zG + 5.5, 0.8, 1.3, 0.8);
  for (let k = 0; k < 6; k++) addPerson(d, (k % 2 ? 1 : -1) * (E + rand(0.8, 2.2)), zG + rand(-8, 8), {});
}
/** Arbres du campus : grands flamboyants, tronc peint en rose et blanc le long des routes, eucalyptus clairs (vidéos en voiture). */
function campusTree(b, x, z, r) {
  if (r < 0.4) {
    const s = rand(1.2, 2);
    b.cyl(0.22 * s, 0.34 * s, 3.2 * s, 0x5d4a38, x, 1.6 * s, z).cyl(0.36 * s, 0.38 * s, 1.2, 0xd98a96, x, 0.6, z);
    b.ball(3.2 * s, pick([0x356b2f, 0x2c5e2a, 0x3f7a35]), x, 4.3 * s, z, 1.2, 0.55, 1.2);
    if (chance(0.25)) b.ball(1.8 * s, 0xc9472c, x + s, 5 * s, z, 1, 0.45, 1);    // flamboyant en fleurs
  } else if (r < 0.65) {
    const H = rand(8, 13);
    b.cyl(0.14, 0.28, H, 0xc4bca8, x, H / 2, z).ball(1.9, 0x5c8a42, x, H, z, 1, 1.4, 1).ball(1.3, 0x6c9a4c, x + 0.8, H - 2, z, 1, 1, 1);
  } else if (r < 0.85) addPalm(b, x, z, rand(1, 1.5));
  else for (let q = 0; q < 7; q++) b.cyl(0.05, 0.08, rand(5, 8), 0x7a8a3a, x + rand(-1.1, 1.1), 3, z + rand(-1.1, 1.1));   // bambous
}
/** Campus de l'UNIKIN (OSM pour les routes et les bâtiments ; vidéos et photos du dossier « Université » pour leur aspect). */
function addCampus(scene, chunks, details, signs, plates, groundMat) {
  const C = R.campus, zG = C.gate, T = new TexWalls(), P2 = new PlateAtlas('#f4f4ee', '#24507e');
  // Le sol : terre claire et herbe par plaques, comme vu du drone ; au-delà du campus, la colline boisée
  const [x0, x1, z0, z1] = C.extent;
  const big = new THREE.Mesh(bendGeometry(groundPlane(x1 - x0 + 500, z1 - z0 + 500, 14).translate((x0 + x1) / 2, -0.05, (z0 + z1) / 2)), groundMat);
  big.receiveShadow = true; scene.add(big);
  for (const [cx, cz] of C.cells) chunks.at(cz).box(C.cell + 0.2, 0.02, C.cell + 0.2, 0xb5a27a, cx, -0.012, cz);
  const roads = PL_LINKS.filter(l => l.noHouses || l.key === 'kimwenza').map(l => l.Q);
  const axis = (x, z, m) => Math.abs(x) < ROAD_EDGE + m && z < zG + 30;
  const free = (x, z, m) => !axis(x, z, m) && !roads.some(Q => onRibbon({ ...Q, box: [Q.box[0] - m - 1, Q.box[1] + m + 1, Q.box[2] - m - 1, Q.box[3] + m + 1], hw: Q.hw.map(h => h + m + 0.7) }, x, z));
  for (const [cx, cz] of C.cells) {
    if (chance(0.3)) continue;
    const bb = chunks.at(cz), sx = rand(6, 15), sz = rand(6, 15);
    bb.add(new THREE.CylinderGeometry(1, 1, 0.02, 10).scale(sx, 1, sz), pick([0x7f9a4e, 0x8fa55a, 0x76924a]), cx + rand(-8, 8), 0.0, cz + rand(-8, 8));
  }
  const inGate = (x, z, m) => Math.abs(z - zG) < 5 + m && Math.abs(x) < ROAD_EDGE + 30 + m;
  // Les bâtiments : façade vers la route la plus proche
  const dist = (x, z) => { let best = Math.abs(x); for (const Q of roads) { if (x < Q.box[0] - 40 || x > Q.box[1] + 40 || z < Q.box[2] - 40 || z > Q.box[3] + 40) continue; for (let i = 1; i < Q.pts.length; i++) best = Math.min(best, segDist(x, z, Q.pts[i - 1], Q.pts[i])); } return best; };
  const dome = C.buildings.find(B => B.k === 'dome');
  const list = C.buildings.filter(B => !inGate(B.x, B.z, Math.max(B.l, B.w) / 2) && !(dome && B.k === 'low' && Math.hypot(B.x - dome.x, B.z - dome.z) < Math.max(dome.l, dome.w) / 2 + 24));
  for (const B of list) {
    const off = B.w / 2 + 6, f = dist(B.x - B.uz * off, B.z + B.ux * off) <= dist(B.x + B.uz * off, B.z - B.ux * off) ? 1 : -1;
    campusBuilding(chunks.at(B.z), details.at(B.z), T, P2, signs, B, f, free);
    if (B.name) {
      B.fx = -B.uz * f; B.fz = B.ux * f;
    }
  }
  addCampusGate(chunks.at(zG), details.at(zG), T, signs, zG);
  // Dans l'axe, après le portail : le grand mât au drapeau, des lampadaires à deux têtes le long de l'avenue (vidéo de la visite)
  addFlag(chunks.at(zG - 42), signs, ROAD_EDGE + 7, zG - 42, 14);
  for (let z = zG - 14; z > Z_END + 10; z -= 26) for (const s of [-1, 1]) {
    const bb = chunks.at(z), x = s * (ROAD_EDGE + 1.6);
    bb.cyl(0.07, 0.1, 8.5, 0xb9bcbc, x, 4.25, z).box(1.6, 0.06, 0.06, 0xb9bcbc, x, 8.4, z).box(0.5, 0.1, 0.24, 0xdddddd, x - 0.75, 8.35, z).box(0.5, 0.1, 0.24, 0xdddddd, x + 0.75, 8.35, z);
  }
  // Repères de la carte
  const M = C.marks;
  if (M.stade) {
    // Complexe sportif : stade à pelouse rayée entourée d'une piste, tribune, gymnase au toit vert et bleu en croix (vue du drone)
    const [sx, sz] = M.stade, bs = chunks.at(sz);
    bs.add(new THREE.CylinderGeometry(1, 1, 0.1, 40).scale(26, 1, 42), 0xd6cdb8, sx, 0.06, sz).add(new THREE.CylinderGeometry(1, 1, 0.12, 40).scale(21, 1, 37), 0x4d9a3e, sx, 0.08, sz);
    for (let k = -5; k <= 5; k += 2) bs.box(32, 0.03, 3.4, 0x5fb04c, sx, 0.15, sz + k * 3.4);
    bs.box(5, 3, 40, 0xc9c6bd, sx + 30, 1.5, sz).box(6, 0.2, 41, 0x8f8d86, sx + 30, 3.1, sz);
    bs.box(26, 5, 14, 0xe9e7df, sx, 2.5, sz + 58).box(27, 0.5, 15, 0x2f7f55, sx, 5.2, sz + 58).box(11, 0.5, 26, 0x3a7ec0, sx, 5.4, sz + 58);
    P2.add('COMPLEXE SPORTIF', 6, 1.5, sx, 3.6, sz + 65.2, 0);
  }
  for (const [k, c, W, D] of [['tennis', 0x4f7f9a, 15, 26], ['basket', 0xa86b45, 13, 22]]) if (M[k]) chunks.at(M[k][1]).box(W, 0.05, D, c, M[k][0], 0.05, M[k][1]).box(W - 1, 0.02, 0.1, 0xf2f2ec, M[k][0], 0.08, M[k][1]);
  if (M.gillon) {
    const [gx, gz] = M.gillon, bg = chunks.at(gz);
    bg.box(2.2, 1.2, 2.2, 0xd8d3c6, gx, 0.6, gz).box(0.8, 2.2, 0.6, 0xe9e7df, gx, 2.3, gz).ball(0.4, 0xe9e7df, gx, 3.7, gz);
    P2.add('MGR LUC GILLON', 2.4, 0.6, gx, 0.7, gz + 1.15, 0);
  }
  for (const [k, n, c] of [['police', 'POLICE UNIVERSITAIRE', 0x1d4fa0], ['rawbank', 'RAWBANK', 0x1a1a1a], ['bcdc', 'BCDC', 0x9e2835], ['amphi', 'AMPHI L. DE SAINT MOULIN', 0x7a4b2a], ['koulibaly', 'CENTRE KOULIBALY', 0x2f6f3e]]) {
    if (!M[k]) continue;
    const [px, pz] = M[k], ob = chunks.at(pz);
    ob.box(9, 3.6, 7, 0xe6e1d4, px, 1.8, pz).box(9.6, 0.5, 7.6, c, px, 3.8, pz);
    P2.add(n, 6, 1.5, px, 2.8, pz + 3.55, 0);
  }
  // Les arbres, loin des routes et des bâtiments ; le long des routes, les troncs peints
  const onBuilding = (x, z, m) => list.some(B => Math.hypot(x - B.x, z - B.z) < Math.max(B.l, B.w) / 2 + m);
  let t = 0;
  for (let k = 0; k < 1100 && t < 170; k++) {
    const [cx, cz] = C.cells[Math.floor(Math.random() * C.cells.length)], x = cx + rand(-13, 13), z = cz + rand(-13, 13);
    if (!free(x, z, 3) || onBuilding(x, z, 3.5) || inGate(x, z, 6) || (z > zG + 2 && Math.abs(x) < ROAD_EDGE + 26)) continue;
    t++;
    campusTree(details.at(z), x, z, Math.random());
  }
  // La colline boisée autour du campus (vue du drone) : sol vert, grandes masses d'arbres, posées une seule fois
  for (let zz = z1 + 150; zz > z0 - 150; zz -= 60) {
    const zc = zz - 30, gr = chunks.at(zc), W = x1 - x0 + 330, xm = (x0 + x1) / 2;
    if (zc < zG + 10) gr.box(W, 0.02, 60.2, 0x5f7f3e, xm, -0.03, zc);
    else for (const sd of [-1, 1]) { const a = sd > 0 ? ROAD_EDGE + 70 : x0 - 165, c = sd > 0 ? x1 + 165 : -(ROAD_EDGE + 70); gr.box(c - a, 0.02, 60.2, 0x5f7f3e, (a + c) / 2, -0.03, zc); }
  }
  const inCell = (x, z) => C.cells.some(c => Math.abs(x - c[0]) < C.cell && Math.abs(z - c[1]) < C.cell);
  for (let zz = z1 + 140; zz > z0 - 130; zz -= 24) for (let xx = x0 - 120; xx < x1 + 120; xx += 24) {
    const x = xx + rand(-9, 9), z = zz + rand(-9, 9);
    if (z > zG + 12 && Math.abs(x) < ROAD_EDGE + 70) continue;
    if (inCell(x, z) || !free(x, z, 6) || chance(0.18)) continue;
    chunks.at(z).ball(rand(4.5, 8), pick([0x3b6b30, 0x2f5e2a, 0x477a38, 0x2b5526]), x, rand(3.5, 6), z, 1.2, 0.72, 1.2);
  }
  // Étudiants debout devant les bâtiments, voitures garées le long des façades (vidéos)
  for (const B of list) {
    if (!B.name || B.fx === undefined) continue;
    const off = B.w / 2 + 3.2, dd = details.at(B.z), ry = Math.atan2(B.ux, B.uz);
    for (let k = 0; k < 5; k++) addPerson(dd, B.x + B.fx * off + B.ux * rand(-B.l / 2.5, B.l / 2.5), B.z + B.fz * off + B.uz * rand(-B.l / 2.5, B.l / 2.5), {});
    for (let k = 0; k < (B.k === 'fac' || B.k === 'home' ? 2 : 0); k++) {      // (pas sur les escaliers du Bâtiment administratif)
      const u = rand(-B.l / 3, B.l / 3), x = B.x + B.fx * (off + 2) + B.ux * u, z = B.z + B.fz * (off + 2) + B.uz * u;
      if (!free(x, z, 1)) continue;
      chunks.at(B.z).box(1.9, 0.75, 4.3, pick([0xf2f2f2, 0x1f1f1f, 0x7a1f1f, 0x1e3a8a, 0xb8bec4]), x, 0.55, z, 0, ry, 0).box(1.6, 0.6, 2.2, 0x2a3540, x, 1.2, z, 0, ry, 0);
    }
  }
  T.build(scene);
  P2.build(scene);
}
/** Voitures et piétons qui parcourent les routes du campus (animés seulement quand le taxi y est). */
class CampusLife {
  constructor(scene) {
    this.routes = PL_LINKS.filter(l => l.noHouses && l.pts.length > 4).map(l => l.pts);
    this.movers = [];
    const pick2 = () => this.routes[Math.floor(Math.random() * this.routes.length)];
    if (!this.routes.length) return;
    for (let i = 0; i < 10; i++) {
      const mesh = i % 3 === 0 ? createHatchback({}) : i % 3 === 1 ? createCar({ color: [0xf2f2f2, 0x1f1f1f, 0x7a1f1f, 0xb8bec4][i % 4] }) : createMinibus({ apprenti: false });
      scene.add(mesh);
      this.movers.push({ mesh, P: pick2(), i: 0, t: Math.random(), dir: 1, v: 6 + Math.random() * 3, lane: 1.45, car: true });
    }
    for (let i = 0; i < 28; i++) {
      const ch = new Character(outfit(['student', 'woman', 'man', 'student'][i % 4], {}));
      scene.add(ch.mesh);
      this.movers.push({ mesh: ch.mesh, ch, P: pick2(), i: 0, t: Math.random(), dir: i % 2 ? 1 : -1, v: 1 + Math.random() * 0.5, lane: 3.9 });
    }
    for (const m of this.movers) m.i = Math.floor(Math.random() * (m.P.length - 1));
    this.visible = true;
  }
  update(dt, time, taxi) {
    const near = taxi.z < CAMPUS_Z + 240;
    if (!near) { if (this.visible) { for (const m of this.movers) m.mesh.visible = false; this.visible = false; } return; }
    this.visible = true;
    for (const m of this.movers) {
      const a = m.P[m.i], c = m.P[m.i + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, sd = m.dir > 0 ? 1 : -1;
      const x = a[0] + (c[0] - a[0]) * m.t - uz * sd * m.lane * -1, z = a[1] + (c[1] - a[1]) * m.t + ux * sd * m.lane * -1;
      const far = Math.hypot(x - taxi.x, z - taxi.z) > 300;
      m.mesh.visible = !far;
      if (far && !m.car) continue;
      // les voitures s'arrêtent derrière le taxi
      let go = true;
      if (m.car) { const dx = taxi.x - x, dz = taxi.z - z, along = (dx * ux + dz * uz) * sd; if (along > 0 && along < 11 && Math.abs(dx * uz - dz * ux) < 3) go = false; }
      if (go) {
        m.t += sd * m.v * dt / L;
        if (m.t > 1) { if (m.i < m.P.length - 2) { m.i++; m.t = 0; } else { m.dir = -1; m.t = 1; } }
        else if (m.t < 0) { if (m.i > 0) { m.i--; m.t = 1; } else { m.dir = 1; m.t = 0; } }
      }
      if (far) continue;
      place(m.mesh, x, z, Math.atan2(ux * sd, -uz * sd), 0);
      if (m.ch) m.ch.pose('walk', time, m.v);
    }
  }
}

const pairPeople = new Chunks(100), pairFar = new Chunks(100);   // (posés sans écartement, au milieu de la pelouse : ils ne sont pas étirés)
/** La pelouse et les bordures du début du By Pass : les gens y montent et attendent pour traverser l'autre chaussée (l'auteur, 07/11). D'après la
 *  vidéo du dossier Baypas : bordures de béton, pelouse sèche par endroits, une rangée de grands lampadaires solaires au milieu, caniveaux couverts
 *  au bord des chaussées, larges passages piétons. */
function addPairMedian(chunks, curbs, details) {
  const q = PAIR.CORE, x2 = wx => (wx < 0.9 + PAIR.S ? wx * 0.9 / (0.9 + PAIR.S) : wx - PAIR.S);   // x route d'un écart réel à l'axe
  const stop = (s, z) => (s > 0 ? BUS_STOPS : BUS_STOPS_L).some(b => Math.abs(b - z) < 14);
  for (let z = -40; z > PAIR.z1 + 50; z -= 5) {
    const zm = z - 2.5;
    if (!PAIR.full(zm)) continue;
    const c = curbs.at(zm), b = chunks.at(zm);
    c.box(0.05, 0.02, 3, 0xe8e8e0, 0.8, 0.03, zm).box(0.05, 0.02, 3, 0xe8e8e0, -0.8, 0.03, zm);   // tirets entre les deux bandes de chaque chaussée
    for (const s of [-1, 1]) {
      if (atSideRoad(s, zm, 0.5) || stop(s, zm)) continue;
      b.box(1.3, 0.03, 5.02, 0x2e2a26, s * (ROAD_EDGE + 0.85), 0.03, zm)                        // caniveau de béton
        .box(0.18, 0.34, 5.02, 0xa8a296, s * (ROAD_EDGE + 0.1), 0.17, zm).box(0.18, 0.34, 5.02, 0xa8a296, s * (ROAD_EDGE + 1.6), 0.17, zm);
      if (Math.floor(-zm / 5) % 3 === 0) details.at(zm).box(1.5, 0.09, 1.2, 0xb9b3a7, s * (ROAD_EDGE + 0.85), 0.34, zm);   // dalles
    }
    if (pairOpen(zm) || pairOpen(zm - 2.5) || pairOpen(zm + 2.5)) continue;
    b.box(2 * q, 0.2, 5.02, chance(0.72) ? 0x7f9a4e : 0xb7a380, 0, 0.1, zm);
    for (const s of [-1, 1]) b.box(0.05, 0.26, 5.02, 0xbdb7a9, s * q, 0.13, zm);
  }
  pairPeople.at(PAIR.nose).ball(1, 0x7f9a4e, 0, 0.1, PAIR.nose - 1, 1.9, 0.2, 5.5);   // l'ovale du croquis, juste avant la séparation
  // larges passages piétons, à chaque ouverture régulière (bandes parallèles à la route)
  for (let z = -180; z > PAIR.z1 + 50; z -= 180) {
    const zc = z - 3.5;
    if (!PAIR.full(zc)) continue;
    for (const s of [-1, 1]) for (let wx = 2.5; wx < 8.3; wx += 1.45) {
      const x0 = x2(wx), x1 = x2(wx + 0.75);
      curbs.at(zc).box(x1 - x0, 0.02, 4.2, 0xf0f0ea, s * (x0 + x1) / 2, 0.032, zc);
    }
  }
  for (let z = -60; z > PAIR.z1 + 60; z -= rand(22, 46)) {
    if (!pairOpen(z) && PAIR.full(z)) addPerson(pairPeople.at(z), rand(-1, 1), z, {});     // des gens debout sur la pelouse, qui attendent de traverser
  }
  // la rangée de grands lampadaires au milieu : mât gris, deux bras, panneau solaire (vidéo, 03:40–05:40)
  for (let z = -52; z > PAIR.z1 + 50; z -= 26) {
    if (!PAIR.full(z) || pairOpen(z) || pairOpen(z - 3) || pairOpen(z + 3)) continue;
    pairFar.at(z).cyl(0.09, 0.16, 11, 0x9aa0a2, 0, 5.5, z).box(3.4, 0.08, 0.08, 0x9aa0a2, 0, 10.6, z).box(0.5, 0.12, 0.26, 0xdcdcdc, 1.6, 10.5, z).box(0.5, 0.12, 0.26, 0xdcdcdc, -1.6, 10.5, z)
      .box(1.5, 0.06, 0.8, 0x1c2d4a, 0, 11.3, z, 0.4, 0, 0);
  }
}
/** Immenses panneaux sur structure de tubes (vidéo, photo de Ngaba) : côté route, face à ceux qui arrivent ; `empty` : la structure seule. */
function addBigBoard(chunks, signs, side, z, i, empty) {
  return;   // (l'auteur, 26/11 : plus aucun panneau géant, avec ou sans publicité)
  const b = chunks.at(z), x = side * (FRONT + 2), W = 11, H = 7, y = 11, C = empty ? 0xb7c3cc : 0x7a858c;
  for (const ox of [-W / 2 + 0.6, W / 2 - 0.6]) b.box(0.26, y, 0.26, C, x + ox, y / 2, z).box(0.26, y, 0.26, C, x + ox, y / 2, z + 1.8);
  b.box(0.42, y + H - 2, 0.42, empty ? 0x3f7fb2 : C, x, (y + H - 2) / 2, z + 0.9);
  for (const yy of [y - 3, y, y + H / 2, y + H]) b.box(W, 0.14, 0.14, C, x, yy, z).box(W, 0.14, 0.14, C, x, yy, z + 1.8);
  const [t, sub2] = BILLBOARDS[i % BILLBOARDS.length];
  signs.add(`bigb${i % BILLBOARDS.length}`, () => signTexture(t, sub2, pick(['#1d4fa0', '#0b5fb0', '#163a7a']), '#f5c400'), W - 0.2, H - 0.2, x, y + H / 2, z + 1.95, 0);
}
/** Décor du By Pass, de l'Échangeur à Ngaba, d'après les vidéos du dossier Baypas : grands arbres et bâtiments en retrait, panneaux géants ; juste avant
 *  Ngaba (photo « rondpointb ») : rangée de maisons crème à pignons sur un talus vert, mur peint d'affiches, immeuble gris. */
function addBpDecor(chunks, details, signs) {
  const G = RINGS.find(q => q.kind === 'gap'), Zend = G.z0 + 75;
  let i = 0;
  for (let z = -130; z > Zend + 200; z -= rand(190, 300), i++) {
    const side = i % 2 ? 1 : -1, zz = z;
    if (!atSideRoad(side, zz, 8) && !nearAny(zz, BUS_STOPS, 16) && !(side < 0 && nearFork(zz, 8))) addBigBoard(chunks, signs, side, zz, i, i % 4 === 3);
  }
  // grands arbres : manguiers et palmiers en retrait, surtout à gauche ; quelques-uns au bord
  for (let z = -70; z > Zend + 10; z -= rand(9, 20)) {
    const side = chance(0.65) ? -1 : 1, x = side * (FRONT + rand(18, 44));
    if (atSideRoad(side, z, 5) || (side < 0 && nearFork(z, 12))) continue;
    if (chance(0.72)) addMango(chunks.at(z), x, z, rand(1.5, 2.6)); else addPalm(chunks.at(z), x, z, rand(1.1, 1.6));
  }
  for (let z = -90; z > Zend + 10; z -= rand(60, 130)) {
    const side = chance(0.7) ? -1 : 1;
    if (!atSideRoad(side, z, 6) && !nearAny(z, BUS_STOPS, 18) && !(side < 0 && nearFork(z, 8))) addMango(chunks.at(z), side * (FRONT - 2.5), z, rand(1.1, 1.5));
  }
  // la rangée de maisons sur le talus (à gauche en allant vers Ngaba), puis en face le mur peint et l'immeuble
  const z0 = G.z0 + 190, bL = chunks.at(z0), xf = -(FRONT + 6);
  bL.box(22, 0.7, 70, 0x6f9a48, xf - 8, 0.2, z0 - 16);
  for (let k = 0; k < 4; k++) {
    const zc = z0 - k * 12.5;
    bL.box(11, 8, 11.5, 0xe8d6a0, xf - 8, 4.6, zc).box(0.3, 2.8, 11.5, 0xb5583e, xf - 2.3, 2, zc)
      .add(new THREE.CylinderGeometry(0.72, 0.72, 11.8, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).scale(11.6, 3.4, 1), 0x8f959c, xf - 8, 9.3, zc);
    for (const y of [4.8, 7.2]) bL.box(0.06, 1.2, 3, 0x3a4550, xf - 2.48, y, zc);
  }
  addBigBoard(chunks, signs, -1, z0 - 62, 0, true);
  const z1 = G.z0 + 130, bR = chunks.at(z1), xr = FRONT + 3;
  for (let k = 0; k < 5; k++) {
    const zc = z1 - k * 9;
    bR.box(0.3, 3, 8.8, k % 2 ? 0xdedbd2 : 0xcfcabd, xr, 1.5, zc);
  }
  bR.box(11, 14, 16, 0x8d8a82, xr + 12, 7, z1 - 14);
  for (let y = 2.5; y < 13; y += 3.2) for (let k = -6; k <= 6; k += 4) bR.box(0.06, 1.3, 1.7, 0x2a3540, xr + 6.47, y, z1 - 14 + k);
  for (let k = 0; k < 6; k++) bR.box(9, 3.2, 8, pick(WALLS), xr + 10 + k * 3, 1.6, z1 + 16 + k * 9).box(9.6, 0.16, 8.6, pick([0x7f8e92, 0x6f8a86, 0x8c9196]), xr + 10 + k * 3, 3.4, z1 + 16 + k * 9);
}
/** Police au bord des routes (photos du dossier Acteurs), figée dans le décor pour rester légère : aux grands carrefours, une ou un agent du roulage (gilet
 *  orange, gants blancs) qui fait signe ; de loin en loin, une patrouille arrêtée sur le bas-côté. */
function addPolicePosts(scene, details) {
  const faceRoad = s => s * Math.PI / 2;
  const free = (s, z) => z < -120 && z > Math.max(Z_END + 60, CAMPUS_Z + 40) && !nearRing(z, 30) && !nearFork(z, 30) && !atSideRoad(s, z, 9) && !ALL_PLACES.some(p => p.side === s && Math.abs(g(p.s) - z) < 32)
    && !inRiver(z, 25) && !inRaised(z, 25) && !inCrossing(z, 15) && !(IS_TOWER && z < ECH.fork0 + 30 && z > ECH.merge - 30) && !(HAS_MATETE && z < MATETE_ZONE[s][0] + 10 && z > MATETE_ZONE[s][1] - 10)
    && !EXT_ARCS.some(a => z < a.z0 + 40 && z > a.z1 - 40) && !(LIM && z < Z16 + 10 && z > Z_FORK - 10) && !(s > 0 ? BUS_STOPS : BUS_STOPS_L).some(q => Math.abs(q - z) < 40) && !FUELS.some(f => f.side === s && Math.abs(f.z - z) < 35);
  // Le roulage, aux carrefours à feux et dans les grandes rues (au moins 450 m entre deux)
  let last = Infinity;
  const spots = [...SIGNALS.map(sg => ({ z: sg.z + sg.w / 2 + 2, side: 1 })), ...SIDE_ROADS.filter(r => r.w >= 7 && r.z > Z_END + 60 && r.z < -120 && !nearRing(r.z, 30) && !nearFork(r.z, 30) && !r.triangle).map(r => ({ z: r.z + r.w / 2 + 2.5, side: r.side }))].sort((a, c) => c.z - a.z);
  for (const q of spots) {
    if (last - q.z < 450 || inRiver(q.z, 25) || inRaised(q.z, 25)) continue;
    last = q.z;
    bakeCharacter(details.at(q.z), outfit('roulage'), 'wave', q.side * (ROAD_EDGE + 0.9), q.z, faceRoad(q.side), Math.random() * 10, true);
  }
  // Les patrouilles, en alternant les côtés
  let k = 0;
  for (let z = -420; z > Z_END + 60; z -= rand(1500, 2000), k++) {
    const s = k % 2 ? -1 : 1, zz = [0, -30, 30, -60, 60, -90, 90].map(d => z + d).find(q => free(s, q));
    if (zz === undefined) continue;
    const veh = k % 4 < 2 ? createPolicePickup() : createPoliceVan();
    place(veh, s * (ROAD_EDGE + 4.4), zz, s > 0 ? 0 : Math.PI, 0);
    scene.add(veh);
    for (let i = 0; i < 3; i++) bakeCharacter(details.at(zz), outfit('police'), 'idle', s * (ROAD_EDGE + rand(1.1, 2.2)), zz + 4 + i * 1.5, faceRoad(s) + rand(-0.5, 0.5), Math.random() * 10, true);
  }
}
/** Bordure de béton de p à q, coupée en petits morceaux (elle suit le virage de la route). */
function forkCurb(b, p, q, h = 0.26, c = 0xb9b3a7, t = 0.28) {
  const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L / 4)), ry = Math.atan2(dx, dz);
  for (let i = 0; i < n; i++) b.box(t, h, L / n + 0.05, c, p[0] + dx * (i + 0.5) / n, h / 2, p[1] + dz * (i + 0.5) / n, 0, ry, 0);
}
/** Surface plate : triangles depuis le centre, bords coupés en petits morceaux (elle suit le virage de la route). */
function forkGround(b, poly, y, color) {
  const c = [poly.reduce((a, q) => a + q[0], 0) / poly.length, poly.reduce((a, q) => a + q[1], 0) / poly.length];
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 5));
    for (let k = 0; k < n; k++) flatPoly(b, [c, [p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n], [p[0] + (q[0] - p[0]) * (k + 1) / n, p[1] + (q[1] - p[1]) * (k + 1) / n]], y, color);
  });
}
/** Les deux séparations du By Pass (FORKS) : leurs routes, la station au milieu, le triangle ou l'espace clôturé, les maisons le long. */
function addForks(chunks, details, signs) {
  for (const f of FORKS) {
    const b = chunks.at(f.z), d = details.at(f.z), F = f.z;
    for (const r of f.roads) {
      const P = r.pts, hw = r.w / 2, ww = i => hw * Math.min(1, 0.2 + i / 5), nor = i => { const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)], L = Math.hypot(c[0] - a[0], c[1] - a[1]); return [-(c[1] - a[1]) / L, (c[0] - a[0]) / L]; };
      const off = (q, n, e) => [q[0] + n[0] * e, q[1] + n[1] * e];
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], c = P[i + 1], na = nor(i), nc = nor(i + 1), zm = (a[1] + c[1]) / 2, bb = chunks.at(zm), L = Math.hypot(c[0] - a[0], c[1] - a[1]), ry = Math.atan2(c[0] - a[0], c[1] - a[1]);
        flatPoly(bb, [off(a, na, -ww(i)), off(a, na, ww(i)), off(c, nc, ww(i + 1)), off(c, nc, -ww(i + 1))], 0.05, ASPHALT_COL);
        if (i > 2 && i % 2) details.at(zm).box(0.16, 0.02, 2.6, 0xf2f2ec, (a[0] + c[0]) / 2, 0.075, zm, 0, ry, 0);
        if (L > 2 && r.w > 8) {                                           // des maisons le long de la route de Salongo, côté extérieur
          const q = off(a, na, -(hw + rand(8, 12)));
          if (forkAt(q[0], q[1]) || chance(0.25) || i < 8) continue;
          const dd = rand(6, 10), w = rand(7, 13), h = rand(2.8, 4.2);
          bb.box(dd, h, w, pick(WALLS), q[0], h / 2, q[1], 0, ry, 0).box(dd + 0.8, 0.12, w + 0.6, pick(TIN), q[0], h + 0.2, q[1], 0, ry, 0);
        }
      }
    }
    if (f.island) forkGround(b, f.island, 0.1, 0xa58d6e);
    forkGround(b, f.pad, 0.11, 0x4a4c53);
    for (let i = 0; i < f.curbs.length - 1; i++) forkCurb(b, f.curbs[i], f.curbs[i + 1]);
    addSideFuel(chunks.at(f.st.z), signs, -1, f.st.z, `fuel_fork_${f.kind}`, f.name, -f.st.x - (ROAD_EDGE + 12));
    if (f.kind === 'salongo') {
      // L'espace clôturé, derrière la station : mur, portail côté petite route, un hangar, des arbres
      for (let i = 0; i < f.wall.length; i++) {
        const p = f.wall[i], q = f.wall[(i + 1) % f.wall.length];
        if (i === 3) {                                                    // (le portail)
          const m = t => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
          forkCurb(b, p, m(0.38), 2.5, 0xd8d0bd, 0.3); forkCurb(b, m(0.62), q, 2.5, 0xd8d0bd, 0.3); forkCurb(b, m(0.38), m(0.62), 2.2, 0x3a4a55, 0.12);
        } else forkCurb(b, p, q, 2.5, 0xd8d0bd, 0.3);
      }
      forkGround(b, f.wall, 0.13, 0xb09a78);
      b.box(13, 3.6, 9, 0xcfc8b6, -22, 1.8, F - 69).box(14, 0.14, 10, 0x8c9196, -22, 3.75, F - 69);
      b.box(2.4, 2.4, 6, 0xc8a02a, -11, 1.3, F - 75, 0, 0.3, 0);
      addMango(b, -33, F - 66, 1.5); addMango(b, -14, F - 81, 1.3);
      const q = f.roads[0].pts[10], u = f.roads[0].pts[9], ry = Math.atan2(q[0] - u[0], q[1] - u[1]);
      b.cyl(0.05, 0.06, 3, 0x8e949a, q[0] + 6, 1.5, q[1] - 5);
      signs.add('fork_salongo', () => signTexture('ROUTE DE SALONGO', 'Limete · Salongo', '#1d4fa0', '#ffffff'), 3.4, 0.7, q[0] + 6, 3, q[1] - 5, ry, true);
    } else {
      // Le triangle, à la pointe, puis le fond de la pointe derrière la station
      flatPoly(b, f.tri, 0.14, 0x7f9a4e);
      for (let k = 0; k < 3; k++) forkCurb(b, f.tri[k], f.tri[(k + 1) % 3]);
      addMango(b, -10, F - 22.5, 0.9);
      b.cyl(0.05, 0.06, 3, 0x8e949a, -8.2, 1.5, F - 15);
      signs.add('fork_kim', () => signTexture('ROUTE DE KIMWENZA', '← Kimwenza · By Pass ↑', '#1d4fa0', '#ffffff'), 3.4, 0.7, -8.2, 3, F - 15, 0, true);
      for (let k = 0; k < 3; k++) addMango(chunks.at(F - 68), -9 - k * 11, F - 68, rand(1, 1.5));
      for (let k = 0; k < 5; k++) addPerson(d, -9 + rand(-1, 1), F - 30 - k * 1.4, {});
    }
  }
}
/** Le marché du Rond-Point Ngaba, entre l'avenue côté Sendwe et le By Pass vers Cité Verte (croquis « rondpoint et triangle »). */
function addNgabaMarket(b, d, signs, z) {
  const zc = z + 34;
  for (let k = 0; k < 3; k++) {
    const x = 13 + k * 10.5;
    b.box(9.4, 0.14, 36, k % 2 ? 0x8c9196 : 0xa8643a, x, 4, zc, 0, 0, k % 2 ? 0.05 : -0.05);
    for (let zz = zc - 16; zz <= zc + 16; zz += 8) for (const e of [-4.2, 4.2]) b.box(0.22, 4, 0.22, 0x6c5a44, x + e, 2, zz);
    for (let zz = zc - 15; zz < zc + 15; zz += 3.4) for (const e of [-2.3, 2.3]) {
      b.box(2.4, 0.9, 2.6, 0x8a6b45, x + e, 0.45, zz);
      if (chance(0.8)) d.box(2, 0.18, 2.2, pick([0xc8452e, 0xe6a02a, 0x5f8a3a, 0xe8e0c8, 0x9c4a8a]), x + e, 1, zz);
    }
    for (let i = 0; i < 9; i++) addPerson(d, x + rand(-1, 1), zc + rand(-16, 16), {});
  }
  b.box(0.3, 6, 0.3, 0x6c7680, 7.6, 3, zc - 5).box(0.3, 6, 0.3, 0x6c7680, 7.6, 3, zc + 5);
  signs.add('ngaba_marche', () => signTexture('MARCHÉ', 'Rond-Point Ngaba', '#c8102e', '#ffffff'), 10, 1.5, 7.6, 5.4, zc, -Math.PI / 2, true);
}
/**
 * Kadafi (l'auteur, 08/11 ; photos du dossier « route kasa-vubu », modèles seulement) : vendeur d'essence en bidon au bord de la route. Table en bois avec
 * des bouteilles d'essence rouge-orangé et un entonnoir, bidons jaunes, bleus, noirs et blancs alignés par terre, le vendeur assis sur une chaise en
 * plastique sous un parasol de couleur ; parfois un aide debout, un bidon à la main. On s'y arrête pour faire le plein (main.js handleStations).
 */
function addKadafi(b, d, side, z) {
  const x = side * (ROAD_EDGE + 2.6), toRoad = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  // la table et ses bouteilles
  b.box(1.4, 0.06, 0.8, 0x8b6b45, x, 0.95, z);
  for (const [dx, dz] of [[-0.6, -0.32], [0.6, -0.32], [-0.6, 0.32], [0.6, 0.32]]) b.box(0.06, 0.95, 0.06, 0x6b5235, x + dx, 0.47, z + dz);
  b.box(1.3, 0.04, 0.7, 0x8b6b45, x, 0.3, z);
  for (let i = 0; i < 6; i++) {
    const bx = x - 0.5 + i * 0.2, col = i % 3 === 1 ? 0xe2701e : 0xc8471f;
    d.cyl(0.065, 0.07, 0.3, col, bx, 1.13, z - 0.15, 0, 0, 0, 8).cyl(0.025, 0.03, 0.06, 0xd8d8d0, bx, 1.31, z - 0.15, 0, 0, 0, 6);
  }
  d.add(new THREE.ConeGeometry(0.12, 0.16, 10).rotateX(Math.PI), 0x2a5fb0, x + 0.45, 1.06, z + 0.2);    // l'entonnoir
  // les bidons par terre, en rang (côté route)
  const CANS = [0xf2c200, 0xf2c200, 0x1f5fbf, 0x1c1c1c, 0xeeeeea, 0xf2c200, 0x1f5fbf];
  CANS.forEach((col, i) => {
    const cx = x - side * 0.9, cz = z - 1.3 + i * 0.42;
    d.box(0.34, 0.44, 0.22, col, cx, 0.22, cz, 0, toRoad, 0).box(0.06, 0.08, 0.06, 0x2a2a2a, cx, 0.48, cz + 0.06);
  });
  d.box(0.34, 0.44, 0.22, 0xf2c200, x + 0.5, 0.52, z + 0.05);              // (un bidon posé sur la tablette du bas)
  // le vendeur sous son parasol, sur sa chaise en plastique
  const sx = x + side * 1.1, sz = z + 0.9;
  d.box(0.45, 0.42, 0.45, 0x2a5fb0, sx, 0.21, sz).box(0.45, 0.45, 0.06, 0x2a5fb0, sx + side * 0.2, 0.62, sz, 0, Math.PI / 2, 0);
  addPerson(d, sx, sz, { sitting: true, ry: toRoad });
  d.cyl(0.04, 0.04, 2.3, 0x666666, sx - side * 0.4, 1.15, sz - 0.4).add(new THREE.ConeGeometry(1.6, 0.6, 8), pick(UMBRELLAS), sx - side * 0.4, 2.4, sz - 0.4);
  if (chance(0.5)) addPerson(d, x - side * 1.4, z + 1.6, { ry: toRoad });  // l'aide, au bord de la route
}

/** Rues transversales de l'avenue de l'Université : courtes, en terre, avec leur plaque de nom (atlas commun : pas une texture par rue). */
function addLightStreets(chunks, plates) {
  for (const r of SIDE_ROADS) {
    if (!r.light || r.z <= Z_END) continue;
    const s = r.side, a = r.ang * Math.PI / 180, L = sideRoadLen(r), rw = r.w + 2, u = [s * Math.cos(a), -Math.sin(a)], b = chunks.at(r.z);
    const P = e => [s * ROAD_EDGE + u[0] * e, r.z + u[1] * e];
    // (l'auteur, 08/11 : « les entrées des avenues, ce n'est pas propre ») : la rue part du bord de la chaussée, coupée le long du bord, avec une
    // embouchure évasée du même goudron que l'avenue, puis sa chaussée (goudron pour les grandes rues, terre battue pour les petites)
    const nr = [-u[1], u[0]], hw = rw / 2, E = s * (ROAD_EDGE - 0.15);
    const side = (k, e) => [P(e)[0] + k * nr[0] * hw, P(e)[1] + k * nr[1] * hw];
    const edge = k => { const e = (E - s * ROAD_EDGE - k * nr[0] * hw) / u[0], q = side(k, e); return [E, q[1] + Math.sign(q[1] - r.z || k) * 1.8]; };
    const M = Math.min(7, L * 0.4);
    flatPoly(b, [edge(1), side(1, M), side(-1, M), edge(-1)], 0.03, ASPHALT_COL);
    flatPoly(b, [side(1, M - 0.2), side(1, L), side(-1, L), side(-1, M - 0.2)], 0.028, r.w > 5 ? ASPHALT_COL : 0x9c7c5c);
    if (r.name) {
      const [px, pz] = P(2.4), n = [-u[1], u[0]], q = [px + n[0] * (rw / 2 + 0.7), pz + n[1] * (rw / 2 + 0.7)];
      b.cyl(0.05, 0.06, 3, 0x8e949a, q[0], 1.5, q[1]);
      for (const e of [0, Math.PI]) plates.add(r.name, 1.75, 0.42, q[0], 2.75, q[1], Math.atan2(-u[1], u[0]) + e);
    }
  }
}
/**
 * Rond-point Victoire (Matonge), d'après les photos et la vidéo du dossier « route kasa-vubu » (modèles seulement) : une grande place ronde pavée gris clair,
 * dessin de grandes lignes bleu-gris en losanges et une allée ocre ; barrières métalliques tout autour ; au centre, sur une marche ronde jaune,
 * l'obélisque : pyramide carrée tronquée en granit gris, quatre bandes sombres, la sculpture des mains en pierre blanche au sommet. La chaussée en
 * fait le tour ; autour, les avenues, les vendeurs (bâches, parasols), la foule, les grands panneaux et les immeubles.
 */
function addVictoire(q, chunks, details, signs) {
  const [cx, cz] = q.c, b = chunks.at(cz), d = details.at(cz), I = q.isl, R = q.r;
  const at = (r, a) => [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
  // la chaussée autour (goudron), son trait discontinu, les avenues qui partent (Victoire de chaque côté, deux autres en biais)
  b.add(new THREE.CylinderGeometry(R, R, 0.04, 72), ASPHALT_COL, cx, 0.045, cz);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) { const [x, z] = at((I + R) / 2, a); b.box(0.15, 0.02, 1.8, 0xf2f2ec, x, 0.075, z, 0, a, 0); }
  const ROADS = [Math.PI / 2, -Math.PI / 2, 0.8, 0.8 + Math.PI];             // (l'avenue Kasa-Vubu : angles 0 et π)
  const SECT = [0.4, 1.19, 2.36, 3.55, 4.33, 5.5];                             // (le milieu des espaces libres entre les avenues)
  for (const a of ROADS) {
    const [x, z] = at(R + 20, a);
    b.box(9, 0.04, 44, ASPHALT_COL, x, 0.04, z, 0, a, 0);
    for (let k = 0; k < 4; k++) { const [mx, mz] = at(R + 4 + k * 10, a); b.box(0.16, 0.02, 3, 0xf2f2ec, mx, 0.07, mz, 0, a, 0); }
  }
  // la place : dallage, lignes en losanges, allée ocre, bordure
  b.add(new THREE.CylinderGeometry(I, I, 0.3, 72), 0xd9d5cc, cx, 0.15, cz);
  for (const s of [1, -1]) for (let o = -I + 2; o < I; o += 4.4) {
    const h = Math.sqrt(Math.max(0, I * I - o * o)) - 0.6;
    if (h < 0.5) continue;
    const a = s * Math.PI / 4, ox = Math.cos(a) * o, oz = -Math.sin(a) * o;
    b.box(0.32, 0.02, 2 * h, 0x8ea1b5, cx + ox, 0.31, cz + oz, 0, a, 0);
  }
  b.box(2.4, 0.02, 2 * I - 1.2, 0xb88a6a, cx, 0.315, cz, 0, 0.35, 0);
  for (let a = 0, k = 0; a < Math.PI * 2; a += Math.PI / 36, k++) { const [x, z] = at(I + 0.15, a); b.box(0.32, 0.34, 1.32, k % 2 ? 0x8e8a82 : 0xc9c4ba, x, 0.17, z, 0, a, 0); }
  // les barrières (ouvertes en face des avenues)
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 30) {
    if ([0, Math.PI / 2, Math.PI, -Math.PI / 2].some(o => Math.abs(Math.atan2(Math.sin(a - o), Math.cos(a - o))) < 0.12)) continue;
    const [x, z] = at(I - 0.5, a), [x2, z2] = at(I - 0.5, a + Math.PI / 30), L = Math.hypot(x2 - x, z2 - z), ry = Math.atan2(x2 - x, z2 - z);
    b.box(0.06, 1.1, 0.06, 0xb9bfc5, x, 0.85, z).box(0.04, 0.05, L, 0xc9ced3, (x + x2) / 2, 1.38, (z + z2) / 2, 0, ry, 0).box(0.03, 0.04, L, 0xc9ced3, (x + x2) / 2, 0.85, (z + z2) / 2, 0, ry, 0);
  }
  // la marche ronde jaune et l'obélisque
  b.add(new THREE.CylinderGeometry(4.6, 4.8, 0.32, 40), 0xcfa457, cx, 0.46, cz).add(new THREE.CylinderGeometry(4.2, 4.2, 0.04, 40), 0xd9b56b, cx, 0.63, cz);
  b.box(3.7, 1.15, 3.7, 0x8c877e, cx, 1.2, cz);
  for (const [sx, sz] of [[0, 1.86], [0, -1.86], [1.86, 0], [-1.86, 0]]) b.box(sz ? 0.7 : 0.03, 0.45, sz ? 0.03 : 0.7, 0x2a2826, cx + sx, 1.25, cz + sz);   // plaques
  const H = 10.5, y0 = 1.78, rb = 1.62 * Math.SQRT2, rt = 0.72 * Math.SQRT2;
  b.add(new THREE.CylinderGeometry(rt, rb, H, 4, 1).rotateY(Math.PI / 4), 0x9c988f, cx, y0 + H / 2, cz);
  for (const f of [0.08, 0.36, 0.6, 0.82]) { const r = rb + (rt - rb) * f + 0.05; b.add(new THREE.CylinderGeometry(r, r + 0.01, 0.24, 4, 1).rotateY(Math.PI / 4), 0x4a4946, cx, y0 + H * f, cz); }
  const yt = y0 + H;
  b.box(1.95, 0.3, 1.95, 0x7f7c76, cx, yt + 0.15, cz);
  // la sculpture des mains (pierre blanche) : deux mains qui se serrent, doigts repliés, pouces dressés
  const WH = 0xe9e7e0;
  for (const s of [-1, 1]) {
    b.cyl(0.3, 0.36, 0.8, WH, cx + s * 0.32, yt + 0.7, cz, 0, 0, s * -0.25, 10)
      .add(new THREE.SphereGeometry(0.5, 12, 10).scale(0.85, 1.1, 0.75), WH, cx + s * 0.38, yt + 1.4, cz, 0, 0, s * -0.3);
    for (let k = 0; k < 4; k++) b.cyl(0.11, 0.11, 0.55, WH, cx + s * 0.08, yt + 1.05 + k * 0.2, cz + 0.18, 0, 0, Math.PI / 2, 8);
    b.cyl(0.11, 0.12, 0.6, WH, cx + s * 0.55, yt + 1.95, cz - 0.15, 0.2, 0, s * -0.35, 8);
  }
  // sur la place : la foule, des rangées de chaises (comme sur la photo d'en haut), des parasols
  for (let i = 0; i < 26; i++) { const a = rand(0, Math.PI * 2), r = rand(5.2, I - 1.5); const [x, z] = at(r, a); addPerson(d, x, z); }
  for (const [a, col] of [[0.6, 0xf5c400], [1.4, 0x0b7285], [2.3, 0x3aa0c8], [3.6, 0x0b7285], [4.6, 0xf5c400]]) {
    for (let rr = 0; rr < 3; rr++) for (let cc = 0; cc < 5; cc++) {
      const [x, z] = at(8 + rr * 0.9, a + (cc - 2) * 0.06);
      d.box(0.42, 0.45, 0.42, col, x, 0.53, z).box(0.42, 0.45, 0.06, col, x, 0.85, z + 0.18);
    }
  }
  for (const a of [0.2, 2.9, 4.1, 5.5]) { const [x, z] = at(I - 3, a); d.cyl(0.04, 0.04, 2.2, 0x666666, x, 1.4, z).add(new THREE.ConeGeometry(1.4, 0.55, 8), pick(UMBRELLAS), x, 2.45, z); }
  // autour, sur les trottoirs : vendeurs (bâches et marchandises par terre, parasols), wewa et foule
  for (let a = 0; a < Math.PI * 2; a += 0.22) {
    if ([...ROADS, VIC_ENGEN_A].some(o => Math.abs(Math.atan2(Math.sin(a - o), Math.cos(a - o))) < 0.32) || Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.3 || Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.3) continue;
    const [x, z] = at(R + rand(2.5, 6), a);
    d.box(rand(1.4, 2.4), 0.03, rand(1.2, 2), pick([0x1d4fa0, 0xe8e2d0, 0x6b4e3a, 0x2b8a3e]), x, 0.33, z, 0, a, 0);
    for (let k = 0; k < 5; k++) d.box(0.25, 0.12, 0.3, pick(GOODS), x + rand(-0.6, 0.6), 0.4, z + rand(-0.5, 0.5));
    if (chance(0.6)) d.cyl(0.04, 0.04, 2.1, 0x666666, x + 0.8, 1.05, z).add(new THREE.ConeGeometry(1.5, 0.6, 8), pick(UMBRELLAS), x + 0.8, 2.25, z);
    addPerson(d, x + rand(-1, 1), z + rand(-1, 1));
    if (chance(0.5)) addPerson(d, x + rand(-1.5, 1.5), z + rand(-1.5, 1.5), { sitting: true });
  }
  // les immeubles autour, entre les avenues (comme sur les photos : tour grise aux antennes, immeuble bleu vitré, bâtiment vert, R+3 blancs)
  const BL = [
    [SECT[2], R + 24, 14, 34, 14, 0x8f9196, 'tower'], [SECT[0], R + 22, 14, 12, 12, 0xe7e2d6], [SECT[4], R + 22, 16, 16, 14, 0x2f6fb5, 'glass'],
    [SECT[3], R + 23, 14, 13, 12, 0xd9d4c9], [SECT[5], R + 22, 14, 15, 12, 0x9aa3ad, 'glass']];
  // la station Engen, en diagonale du rond-point (l'auteur, 09/11 : « en diagonale du rond-point Victoire sur Kasa-Vubu, il y a une station Engen »)
  {
    const a = VIC_ENGEN_A, [ex, ez] = at(VIC_ENGEN_R, a), ry = a, ux = Math.sin(a), uz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
    const P = (u, t) => [ex + ux * u + tx * t, ez + uz * u + tz * t];
    b.box(16, 0.05, 22, 0x5a5c62, ex, 0.05, ez, 0, ry, 0);                                   // l'aire
    { const [qx, qz] = P(-10, 0); b.box(15, 0.045, 12, ASPHALT_COL, qx, 0.048, qz, 0, ry, 0); }   // son entrée, depuis la chaussée du rond-point
    b.box(12, 0.6, 14, 0x003da5, ex, 5.3, ez, 0, ry, 0).box(12.2, 0.22, 14.2, 0xffffff, ex, 4.95, ez, 0, ry, 0).box(12.25, 0.16, 14.25, 0xe31837, ex, 5.42, ez, 0, ry, 0);   // l'auvent bleu, sa bande rouge sur le bord
    for (const [u, t] of [[-4, -5.5], [-4, 5.5], [4, -5.5], [4, 5.5]]) { const [px, pz] = P(u, t); b.box(0.42, 5, 0.42, 0xdcdcdc, px, 2.5, pz); }
    for (const t of [-3, 3]) { const [px, pz] = P(0, t); b.box(1, 0.25, 4.5, 0xbfbfbf, px, 0.17, pz, 0, ry, 0).box(0.8, 1.6, 0.6, 0x003da5, px, 1.05, pz, 0, ry, 0).box(0.84, 0.35, 0.64, 0xe31837, px, 1.65, pz, 0, ry, 0); }
    const [sx, sz] = P(7.5, 0);
    b.box(6, 3.4, 9, 0xf2f0e8, sx, 1.7, sz, 0, ry, 0).box(6.3, 0.4, 9.3, 0x003da5, sx, 3.55, sz, 0, ry, 0);   // la boutique
    const [ax2, az2] = P(-6.15, 0);
    signs.add('victoire_engen_auvent', () => signTexture('ENGEN', 'Service 24h/24 · Boutique', '#003da5', '#fff'), 9, 0.7, ax2, 5.3, az2, a + Math.PI, true);
    const [kx, kz] = P(-9, 7);
    b.box(0.3, 6, 0.3, 0x003da5, kx, 3, kz);
    signs.add('victoire_engen', () => signTexture('ENGEN', 'Rond-point Victoire', '#003da5', '#fff'), 3.2, 2, kx, 6.4, kz, a + Math.PI, true);
  }
  BL.forEach(([a, r, w, h, dep, col, kind], i) => {
    const [x, z] = at(r, a), ry = a + Math.PI;
    b.box(w, h, dep, col, x, h / 2, z, 0, ry, 0);
    for (let f = 3; f < h - 1; f += 3.2) b.box(w + 0.05, 1.1, dep + 0.05, kind === 'glass' ? 0x1d3550 : 0x2f3a45, x, f, z, 0, ry, 0);
    if (kind === 'tower') for (const o of [-3, 0, 3]) b.box(0.15, 5, 0.15, 0x7a7d82, x + o * Math.cos(ry), h + 2.5, z - o * Math.sin(ry)).box(1.2, 0.6, 0.1, 0x9ea3a8, x + o * Math.cos(ry), h + 4.4, z - o * Math.sin(ry), 0, ry, 0);
  });
  // les grands panneaux publicitaires (inventés pour le jeu)
  const PAN = [[SECT[0], 'KINDU · MBANDAKA', 'Transport fluvial · Matonge', '#c8102e', '#fff'], [SECT[2], 'FORFAIT 1 GB', 'Réseau mobile · Victoire', '#6a1b9a', '#fff'],
    [SECT[3], 'TOKOMI !', 'Place Victoire · Matonge', '#f5c400', '#1a1a1a'], [SECT[5], 'BIENVENUE À MATONGE', 'Kalamu · Rond-point Victoire', '#1d4fa0', '#f5c400']];
  PAN.forEach(([a, t, sub, bg, fg], i) => {
    const [x, z] = at(R + 10, a), ry = a + Math.PI;
    b.box(0.3, 7, 0.3, 0x5d6670, x, 3.5, z);
    signs.add(`victoire_pan${i}`, () => signTexture(t, sub, bg, fg), 7, 3, x, 7.8, z, ry, true);
  });
}

/** Rond-Point Ezo (vidéo « le rond-point Ezo se transforme ») et Rond-Point Ngaba (croquis et photo de l'auteur). */
function addUniRings(chunks, details, signs) {
  const PALE = 0xb4afa3, DIRT = 0x9c8b74;
  for (const q of RINGS) {
    if (q.kind === 'gap') continue;
    if (q.kind === 'victoire') { addVictoire(q, chunks, details, signs); continue; }
    const z = q.z, b = chunks.at(z), d = details.at(z), [cx, cz] = q.c;
    if (q.kind === 'ezo') {
      b.add(new THREE.CylinderGeometry(q.r, q.r, 0.05, 48), PALE, cx, 0.045, cz).add(new THREE.CylinderGeometry(q.isl, q.isl + 0.3, 0.32, 36), DIRT, cx, 0.16, cz);
      addMango(b, cx - 3, cz + 3, 1.5);
      b.box(21, 0.9, 3.2, 0x8f8c84, cx + 2, 0.75, cz - 2, 0, 0.6, 0).box(20, 0.2, 2.2, 0x35302b, cx + 2, 1.22, cz - 2, 0, 0.6, 0);   // long ouvrage en béton
      flatPoly(b, q.tri, 0.12, DIRT);
      const P = q.branch.pts;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], c = P[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        b.box(8.6, 0.05, L + 0.6, PALE, (a[0] + c[0]) / 2, 0.044, (a[1] + c[1]) / 2, 0, Math.atan2(c[0] - a[0], c[1] - a[1]), 0);
      }
      // Caniveaux en béton couverts de dalles de part et d'autre de la chaussée, autour d'Ezo (07/11 : là où la vidéo les montre)
      for (const s of [-1, 1]) {
        for (let zz = z + 215; zz > z - 215; zz -= 3) {
          if (atSideRoad(s, zz - 1.5, 1) || ringAt(s * (ROAD_EDGE + 1), zz - 1.5)) continue;
          const dd = details.at(zz), bb = chunks.at(zz);
          bb.box(1.5, 0.03, 3, 0x2e2a26, s * (ROAD_EDGE + 0.95), 0.03, zz - 1.5).box(0.22, 0.52, 3, 0xa8a296, s * (ROAD_EDGE + 0.1), 0.26, zz - 1.5).box(0.22, 0.52, 3, 0xa8a296, s * (ROAD_EDGE + 1.8), 0.26, zz - 1.5);
          dd.box(1.7, 0.1, 0.5, 0xb9b3a7, s * (ROAD_EDGE + 0.95), 0.5, zz - 0.5);
        }
      }
      // Repères de la vidéo : grand panneau noir à gauche, mât au milieu,
      // station au toit vert et rouge, immeuble clair au coin, toit rose
      const px = -(ROAD_EDGE + 10), pz = z + 62;
      b.box(0.5, 12, 0.5, 0x3a3f45, px, 6, pz);
      signs.add('ezo_noir', () => signTexture('TOZA BA ZOBA TE', 'Rond-Point Ezo', '#14141e', '#f4f4f2'), 7.5, 9, px, 12, pz + 0.3, 0);
      b.box(0.1, 12, 0.1, 0x9aa0a6, 0.3, 6, z + 112).box(1.6, 0.5, 0.5, 0x4a4f55, 0.3, 12, z + 112);
      addSideFuel(b, signs, 1, z + 26, 'fuel_ezo', 'STATION', 54);
      const w = -(ROAD_EDGE + 20);
      b.box(22, 11, 26, 0xeae6da, w, 5.5, z + 18).box(22.6, 0.4, 26.6, 0x8e8a80, w, 11.2, z + 18);
      for (let y = 3; y < 11; y += 3.4) b.box(0.12, 1.3, 22, 0x2a3540, w + 11.03, y, z + 18);
      b.box(16, 4.4, 18, 0xdcd7cc, 66, 2.2, z - 40).box(17, 0.3, 19, 0xe6609a, 66, 4.6, z - 40);
      for (let k = 0; k < 14; k++) addPerson(d, cx + rand(-26, 26), cz + rand(-26, 26) + 0, {});
      for (let k = 0; k < 10; k++) addPerson(details.at(z + 40), rand(-3, 6), z + rand(20, 70), {});
    } else {
      const S = q.rect;
      b.add(new THREE.CylinderGeometry(q.r, q.r, 0.05, 48), 0x4a4c53, cx, 0.045, cz);
      flatPoly(b, [[-15, z + q.reach - 6], [ROAD_EDGE, z + q.reach - 6], [ROAD_EDGE, z - q.reach + 6], [-15, z - q.reach + 6]], 0.04, 0x4a4c53);
      // La station, au milieu (croquis) ; le grand toit en T et la foule (photo)
      const R0 = S.ry, sn = Math.sin(R0), cs = Math.cos(R0), at = (u, v) => [S.x + u * cs + v * sn, S.z - u * sn + v * cs];
      b.box(2 * S.hx, 0.2, 2 * S.hz, 0x7e7a72, S.x, 0.12, S.z, 0, R0, 0);
      b.box(30, 0.5, 8.5, 0x8f8778, S.x, 6.2, S.z, 0, R0, 0).box(30.5, 0.14, 9, 0xa59c8b, S.x, 6.5, S.z, 0, R0, 0);
      const [tx, tz] = at(0, 8);
      b.box(11, 0.5, 8, 0xb9b4a8, tx, 6, tz, 0, R0, 0);
      for (const u of [-12, -4, 4, 12]) for (const v of [-3.2, 3.2]) { const [ax, az] = at(u, v); b.box(0.4, 6, 0.4, 0xd8d3c6, ax, 3, az); }
      for (const u of [-6, 6]) { const [ax, az] = at(u, 0); b.box(1, 1.7, 0.7, 0xc8102e, ax, 0.9, az, 0, R0, 0); }
      const [mx, mz] = at(-8, -8.2);
      signs.add('ngaba_st', () => signTexture('STATION', 'Rond-Point Ngaba', '#c8102e', '#ffffff'), 8, 1.2, S.x, 5.4, S.z + S.hz * 0.7, R0, true);
      for (const [u, v] of [[-S.hx - 3, -S.hz - 2], [S.hx + 3, -S.hz - 2], [-S.hx - 3, S.hz + 2], [S.hx + 3, S.hz + 2]]) {      // les quatre îlots du croquis
        const [ix, iz] = at(u, v);
        b.ball(2.4, 0x5f8a3a, ix, 0.12, iz, 1.4, 0.12, 0.55);
      }
      flatPoly(b, q.tri, 0.14, 0x5f8a3a);                                              // le petit triangle, côté Sendwe (croquis)
      for (let k = 0; k < 3; k++) forkCurb(b, q.tri[k], q.tri[(k + 1) % 3]);
      addNgabaMarket(b, d, signs, z);
      for (let k = 0; k < 34; k++) {
        const ang = Math.random() * 6.28, rr = rand(16, 28), [ax, az] = [cx + Math.cos(ang) * rr, cz + Math.sin(ang) * rr];
        if (Math.abs(ax) > ROAD_EDGE + 0.5) addPerson(d, ax, az, {});
      }
      for (let k = 0; k < 8; k++) {
        const ang = k * 0.8 + 0.4, rr = rand(20, 27), ax = cx + Math.cos(ang) * rr, az = cz + Math.sin(ang) * rr;
        if (Math.abs(ax) > ROAD_EDGE + 1.5) b.box(2, 1.7, 4.6, pick([0xf2c200, 0xf2c200, 0xe8e2d0, 0x2a2a2a]), ax, 0.95, az, 0, ang, 0);
      }
      void mx; void mz;
    }
  }
}

/** Routes des liaisons (quads pliés avec la route), bordures, sol au-delà des ±260 m, maisons le long. */
function plLinkRoads(scene, chunks, details, groundMat) {
  for (const l of PL_LINKS) {
    const P = l.pts, zs = P.map(q => q[1]), xs = P.map(q => q[0]), sd = Math.abs(Math.max(...xs)) > Math.abs(Math.min(...xs)) ? 1 : -1, far = Math.max(...xs.map(v => sd * v));
    const z0 = Math.max(...zs) + 70, z1 = Math.min(...zs) - 70;
    if (!l.noGround && far + 90 > GROUND_HALF) {
      const ground = new THREE.Mesh(bendGeometry(groundPlane(far + 90 - GROUND_HALF, z0 - z1, 14).translate(sd * (GROUND_HALF + far + 90) / 2, -0.05, (z0 + z1) / 2)), groundMat);
      ground.receiveShadow = true;
      scene.add(ground);
    }
    const hw = l.w / 2, nor = i => {                       // normale à la route au point i
      const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      return [-(c[1] - a[1]) / L, (c[0] - a[0]) / L];
    };
    let dash = 0;
    for (let i = 0; i < l.draw - 1; i++) {
      const a = P[i], c = P[i + 1], na = nor(i), nc = nor(i + 1), zm = (a[1] + c[1]) / 2, b = chunks.at(zm), off = (q, n, d) => [q[0] + n[0] * d, q[1] + n[1] * d];
      flatPoly(b, [off(a, na, -hw), off(a, na, hw), off(c, nc, hw), off(c, nc, -hw)], 0.05, l.noHouses ? 0x4a4c53 : ASPHALT_COL);
      if (l.noHouses) flatPoly(b, [off(a, na, -hw - 1.5), off(a, na, hw + 1.5), off(c, nc, hw + 1.5), off(c, nc, -hw - 1.5)], 0.012, 0xb7a380);
      if (!l.plain) for (const e of [-1, 1]) flatPoly(b, [off(a, na, e * hw), off(a, na, e * (hw + 0.4)), off(c, nc, e * (hw + 0.4)), off(c, nc, e * hw)], 0.09, 0xb8b2a6);
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]), ry = Math.atan2(c[0] - a[0], c[1] - a[1]);
      for (; dash < L; dash += 8) {
        const t = dash / L;
        details.at(zm).box(0.18, 0.02, 3, 0xf2f2ec, a[0] + (c[0] - a[0]) * t, 0.075, a[1] + (c[1] - a[1]) * t, 0, ry, 0);
      }
      dash -= L;
      // Maisons et clôtures le long de la route, poteaux (quartier populaire, puis Limete)
      if (i % 1 === 0) for (const e of [-1, 1]) {
        if (l.noHouses || i < 1 || i > l.draw - 3 || (l.key === 'kimwenza' && e > 0 && i < 13) || chance(0.22) || (R.campus && R.campus.cells.some(q => Math.abs(a[0] - q[0]) < 44 && Math.abs(a[1] - q[1]) < 44))) continue;
        const n = off(a, na, e * (hw + rand(7, 11))), d = rand(6, 10), w = rand(7, 13), h = rand(2.8, 4.2);
        b.box(d, h, w, pick(WALLS), n[0], h / 2, n[1], 0, ry, 0).box(d + 0.8, 0.12, w + 0.6, pick(TIN), n[0], h + 0.2, n[1], 0, ry, 0);
      }
    }
  }
}

function addPoidsLourds(scene, chunks, details, signs, groundMat) {
  plLinkRoads(scene, chunks, details, groundMat);
  plBlocks(details);
  plRails(chunks, details);
  for (const [km, ang, name] of PL.crossings) plCrossing(chunks, signs, km, ang, name);
  // (plus d'évasement au début : la fin de la route des rails a la même coupe, voir plWide)
  // Goudron qui traverse le parvis de la Gare jusqu'au bout du Boulevard du 30 Juin
  for (const [p, q] of pieces(END_Z + 130, Z_END, 16)) chunks.at((p + q) / 2).box(2 * ROAD_EDGE, 0.02, p - q, ASPHALT_COL, 0, 0.11, (p + q) / 2);
  // Lieux nommés (côté gauche : derrière les rails)
  const nearPlace = (side, z, m) => PL.places.some(p => p.side === side && Math.abs(zKm(p.km) - z) < m);
  for (const p of PL.places) {
    const z = zKm(p.km), b0 = chunks.at(z), dx = p.side < 0 ? -PL_LEFT_X : 0, b = dx ? shiftX(b0, dx) : b0, S = dx ? shiftSigns(signs, dx) : signs;
    if (p.kind === 'commercial') addCommercialBldg(b, S, p.side, z, p);
    else if (p.kind === 'church') addNamedChurch(b, S, p.side, z, p);
    else if (p.kind === 'school') addNamedSchool(b, S, p.side, z, { ...p, noTotem: dx !== 0 });
    else if (p.kind === 'bethesda') plBethesda(b, S, p.side, z, p);
    else if (p.kind === 'halte') plHalte(b, S, p.side, z, p);
  }
  // Suite des façades, côté par côté
  for (const [side, sec] of [[-1, PL.left], [1, PL.right]]) {
    for (const [k0, k1, kind] of sec) {
      let z = zKm(k0);
      const end = Math.max(zKm(k1), END_Z + 130);
      while (z > end) {
        const [a, c] = PL_W[kind], w = Math.min(rand(a, c), z - end + 0.1), cz = z - w / 2;
        if (w > 3 && !inRiver(cz, w / 2 + 3) && !atSideRoad(side, cz, w / 2 + 2) && !nearPlace(side, cz, w / 2 + 16)) plFacade(chunks, details, signs, kind, side, z, w);
        z -= w + rand(0.5, 3);
      }
    }
  }
  // Grands panneaux publicitaires sur un mât (vues : Altesse, Mayo…) : textes génériques du jeu
  if (false) PL.billboards.forEach(([km, side], i) => {
    const z = zKm(km), x = side * (FRONT - 3) - (side < 0 ? PL_LEFT_X : 0), [t, sub, bg, fg] = BILLBOARDS[i % BILLBOARDS.length];
    chunks.at(z).cyl(0.28, 0.34, 9, 0x6c7680, x, 4.5, z).box(9.4, 0.3, 0.3, 0x6c7680, x, 8.7, z);
    signs.add(`bb${i % BILLBOARDS.length}`, () => signTexture(t, sub, bg, fg), 9, 3.8, x, 10.6, z + 0.2, 0);
  });
  // Pylônes en treillis de la ligne haute tension
  for (const [km, side] of PL.pylons) {
    const z = zKm(km), x = side * (FRONT + 6) - (side < 0 ? PL_LEFT_X : 0), b = chunks.at(z);
    for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) b.box(0.2, 26, 0.2, 0x8e949a, x + ox * 0.55, 13, z + oz * 0.55, oz * 0.05, 0, -ox * 0.05);
    for (const y of [17, 21, 25]) b.box(9, 0.18, 0.18, 0x8e949a, x, y, z);
  }
  // Grands arbres qui dépassent (vidéos : pins et manguiers)
  for (const [km, side] of PL.trees) addMango(chunks.at(zKm(km)), side * (FRONT + 4) - (side < 0 ? PL_LEFT_X : 0), zKm(km), rand(1.8, 2.5));
  // Carrefour de l'Avenue de l'Aérodrome : feux et tour de la police de roulage (décor)
  const zj = zKm(PL.junction), bj = chunks.at(zj);
  const tx = ROAD_EDGE + 4.6, tz = zj + 10;
  for (const [ox, oz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) bj.box(0.14, 6.4, 0.14, 0x8e1b2a, tx + ox, 3.2, tz + oz);
  bj.box(3, 1.5, 3, 0xf5c400, tx, 5.4, tz).box(3.4, 0.2, 3.4, 0x8e1b2a, tx, 6.6, tz).box(3.1, 1.2, 3.1, 0xc8102e, tx, 1.2, tz);
  for (const [fx, fz] of [[ROAD_EDGE + 1.6, zj + 8], [-(ROAD_EDGE + 1.6), zj - 8]]) {
    bj.cyl(0.1, 0.13, 6, 0x4a4f55, fx, 3, fz).box(0.4, 1.1, 0.34, 0x151515, fx, 5.6, fz)
      .ball(0.13, 0x2bd04a, fx, 5.25, fz + 0.18);
  }
}
/** Mission Mondiale Bethesda : grand bâtiment beige à arcades (vidéo du 29 août 2026, 12:48). */
function plBethesda(b, signs, side, z, p) {
  const x = side * (FRONT + 10), H = 11;
  b.box(20, H, 28, 0xd9c6a4, x, H / 2, z).box(20.6, 0.5, 28.6, 0xb79f7c, x, H + 0.25, z);
  for (let dz = -11; dz <= 11; dz += 5.5) {
    b.box(0.12, 4.2, 3.4, 0x6e6250, side * FRONT - side * 0.03, 2.1, z + dz);
    b.cyl(1.7, 1.7, 0.12, 0x6e6250, side * FRONT - side * 0.03, 4.2, z + dz, 0, 0, Math.PI / 2);
    b.box(0.12, 2.2, 2.6, 0x4a5560, side * FRONT - side * 0.03, 8, z + dz);
  }
  signs.add(`pl_beth_${z}`, () => signTexture(p.name, p.sub, '#7b2cbf', '#ffffff'), 13, 1.5, side * FRONT - side * 0.1, 5.8, z, -side * Math.PI / 2, true);
}
/** Gare ou halte le long des rails : petit bâtiment, quai, panneau. */
function plHalte(b, signs, side, z, p) {
  const L = p.big ? 34 : 18, x = side * (FRONT + 5), H = p.big ? 7 : 4;
  b.box(10, H, L, 0xe8dcc4, x, H / 2, z).box(11, 0.3, L + 1, 0x9c4a32, x, H + 0.15, z)
    .box(2.6, 0.5, L + 14, 0xb9b3a7, side * (FRONT - 2.3), 0.25, z);   // quai
  signs.add(`pl_halte_${z}`, () => signTexture(p.name, p.sub, '#1d6b3a', '#ffffff'), Math.min(L * 0.8, 11), 1.3, side * FRONT - side * 0.1, H - 1, z, -side * Math.PI / 2, true);
}

export function buildWorld(scene, opts = {}) {
  const env = opts.env !== false;
  let sky = null, sun = null, hemi = null;
  if (env) {
    scene.background = new THREE.Color(0xd5dde2);
    scene.fog = new THREE.Fog(0xd5dde2, 80, 480);
    sky = skyDome();
    scene.add(sky);
    scene.add(hemi = new THREE.HemisphereLight(0xf2f4f5, 0x8a6a4a, 2.0));
    sun = new THREE.DirectionalLight(0xfffaf0, 1.5);
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);
  }
  const fog = env ? scene.fog : opts.fog;

  const chunks = new Chunks();
  const skyline = SKYLINE = new Chunks(1e6);
  const details = new Chunks(100);    // petits objets, affichés seulement de près
  const curbs = new Chunks(100);      // bordures peintes : visibles plus loin que les détails
  const signs = new Signs();
  const lamps = LAMPS = new Chunks(), pools = POOLS = new Chunks(320, true);   // ampoules et taches de lumière des lampadaires (nuit)
  chunks.scan = details.scan = true;                       // (l'auteur, 13/11 : les obstacles du bord de la route, voir obstacleAt)
  obstInit(Z_START + 30, Math.min(Z_GEN, Z_END) - 40);

  __mark('bw Sol (hors rivières) plié le long de la route, plus');
  // Sol (hors rivières) plié le long de la route, plus un grand plan plat en dessous pour le lointain
  const groundMat = new THREE.MeshLambertMaterial({ map: groundTexture() });
  for (const [a, z] of solid(Z_START + (START_ATTACHED ? 0 : 700), EXT ? Z_FORK - 4 : R.end.kind === 'open' ? Z_END - 20 : Math.min(END_Z - 700, Z_END - 400))) {
    for (const [p, q] of pieces(a, z, 300)) {
      const geo = groundPlane(2 * GROUND_HALF, p - q, 14).translate(0, -0.05, (p + q) / 2);
      const m = new THREE.Mesh(bendGeometry(geo), groundMat);
      m.receiveShadow = true;
      scene.add(m);
    }
  }
  __mark('bw Masina : le sol plié continue au-delà de ±260 m ju');
  // Masina : le sol plié continue au-delà de ±260 m jusqu'au chemin de fer et à SOCIDER ; là où la rivière Bonamak s'arrête
  __mark('bw (avant Kulumba), le sol recouvre la suite de son l');
  // (avant Kulumba), le sol recouvre la suite de son lit
  if (MAS) {
    const ground = geo => { const m = new THREE.Mesh(bendGeometry(geo), groundMat); m.receiveShadow = true; scene.add(m); };
    // (vers l'aéroport, le boulevard tourne vers Masina, rayon 720 m vers z -1490 : le sol s'y arrête à 600 m de l'axe)
    for (const [p, q] of pieces(MAS_Z0 + 60, MAS_Z1 - 280, 300)) ground(groundPlane(720 - GROUND_HALF, p - q, 14).translate((720 + GROUND_HALF) / 2, -0.05, (p + q) / 2));
    ground(groundPlane(600 - GROUND_HALF, 140, 14).translate((600 + GROUND_HALF) / 2, -0.05, MAS_Z0 + 130));
    for (const r of RIVERS.filter(r => masRiverEnd(r) < GROUND_HALF)) ground(groundPlane(GROUND_HALF - masRiverEnd(r), r.w, 14).translate((GROUND_HALF + masRiverEnd(r)) / 2, -0.05, r.z));
  }
  if (env) {
    const far = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x9a5530 }));
    far.position.y = -1.6;
    scene.add(far);
  }

  const roadMats = [roadTexture(false), roadTexture(true)].map(map => new THREE.MeshLambertMaterial({ map }));
  const roadGaps = RINGS.filter(q => q.kind === 'gap').map(q => [q.z0, q.z1]);   // (By Pass : dans le rond-point, la chaussée de l'avenue)
  for (const [p, q] of minus([[Z_START, Z_END]], roadGaps).flatMap(([a, c]) => pieces(a, c))) {
    for (const s of [1, -1]) {
      const geo = groundPlane(LANE_W * LANES, p - q, LANE_W * LANES, 12)
        .translate(s * (MEDIAN + LANE_W * LANES / 2), 0.02, (p + q) / 2);
      const m = new THREE.Mesh(bendGeometry(raise(geo)), roadMats[s > 0 ? 0 : 1]);
      m.receiveShadow = true;
      scene.add(m);
    }
  }

  __mark('bw Terre-plein : bordures + séparateur béton (avec pa');
  // Terre-plein : bordures + séparateur béton (avec passages sauvages) + lampadaires
  const signalCuts = MEDIAN_CUTS.map(c => [c.z + c.w / 2, c.z - c.w / 2]);   // carrefours ouverts : pas de terre-plein
  for (const [p, q] of minus([...spans(Z_START, IS_TOWER ? ECH.fork0 : Z_GEN), ...(IS_TOWER ? pieces(ECH.merge, Z_GEN) : [])], signalCuts)) {
    const b = chunks.at((p + q) / 2), len = p - q, zc = (p + q) / 2;
    if (R.twoLane) b.box(MEDIAN * 2 + 0.3, 0.02, len, 0x7d7b78, 0, 0.012, zc);
    else if (R.pl) b.box(MEDIAN * 2, 0.02, len, 0x66676a, 0, 0.012, zc).box(0.2, 0.02, len, 0xf2f2ec, 0, 0.024, zc);   // (une seule ligne au milieu)
    else if (R.industrial || R.rocade) b.box(MEDIAN * 2, 0.02, len, 0x66676a, 0, 0.012, zc).box(0.14, 0.02, len, 0xe8e8e2, 0.14, 0.024, zc).box(0.14, 0.02, len, 0xe8e8e2, -0.14, 0.024, zc);   // (ni terre-plein ni séparateur : lignes au sol)
    else if (inHighway(zc)) b.box(MEDIAN * 2, 0.02, len, 0x7a7b7e, 0, 0.012, zc);   // simple marquage au sol
    else b.box(MEDIAN * 2, 0.22, len, 0xa9a49a, 0, 0.11, zc);
  }
  __mark('bw Section rénovée : terre-plein en herbe planté de p');
  // Section rénovée : terre-plein en herbe planté de palmiers, bordures rouge et blanc
  const GREEN_END = R.greenMedianUntil === 'END' ? Z_END - 1 : R.greenMedianUntil ? lmZ(R.greenMedianUntil) : Infinity;
  if (GREEN_END !== Infinity) for (const [p, q] of pieces(Z_START, GREEN_END)) chunks.at((p + q) / 2).box(MEDIAN * 2 - 0.3, 0.3, p - q, 0x5f8a3a, 0, 0.16, (p + q) / 2);
  if (PAIR) addPairMedian(chunks, curbs, details);
  if (PAIR) addBpDecor(chunks, details, signs);
  if (FORKS.length) addForks(chunks, details, signs);
  if (R.twoLane) for (let z = Z_START - 2; z > Z_END; z -= 8) if (!nearRing(z, -4) && !(PAIR && PAIR.at(z) > 0.05)) curbs.at(z).box(0.17, 0.012, 3.4, 0xeeeee8, 0, 0.03, z);   // le trait d'aller et retour
  let blk = 0;
  const BLK = R.barrierLen ?? 3.2;
  for (let z = Z_START; z > Z_GEN; z -= BLK) {
    const zm = z - BLK / 2;
    if (inEchPark(zm, BLK) ||R.separator === false || inFlyover(zm, 2) || inCrossing(zm, 1) || inHighway(zm)) continue;
    // Ouverture dans le séparateur béton DBA face aux grandes avenues d'entrée (comme dans v1_early_120s.jpg)
    if (SIDE_ROADS.some(r => !r.noGap && Math.abs(zm - r.z) < 5.5) || inMedianOpen(zm) || inSignalCrossing(zm, 1)) continue;
    if (POPULAR && Math.abs(((z % 170) + 170) % 170 - 80) < 3) continue;   // passage piéton sauvage
    const col = blk++ % 2 ? 0xf2efe8 : 0x9e2835; // alternance blanc et rouge bordeaux authentique (vidéos v1 et v6)
    chunks.at(z).box(0.44, 0.86, BLK - 0.12, col, 0, 0.64, zm)
      .box(0.68, 0.26, BLK - 0.12, col, 0, 0.35, zm);
  }
  for (let z = Z_START - 10; z > Z_GEN; z -= 38) if (!inFlyover(z, 3) && !inHighway(z) && !inEchPark(z, 5) && !inSignalCrossing(z, 3)) addStreetlight(chunks.at(z), z);
  addPowerPoles(chunks, details);
  if (WORKS.length) { addWorks(scene); randomizeWorks(); }
  if (MONUMENTAL) {
    // Boulevard Triomphal (d'après les vidéos v3_t178s et v3_t476s) :
    // terre-plein central avec bacs à fleurs bordés de blanc contenant des palmiers, drapeaux RDC et panneaux verticaux sur les lampadaires
    for (let z = -40; z > Z_END; z -= 76) addFlag(chunks.at(z), signs, 0, z, 10);
    for (let z = -22; z > Z_END + 20; z -= 24) {
      if (inCrossing(z, 8)) continue;
      const b = chunks.at(z);
      // Bac à fleurs rectangulaire bordé de blanc avec arbustes et palmier central (v3_t178s.jpg)
      b.box(1.75, 0.28, 3.6, 0xf2f2ee, 0, 0.24, z)
        .box(1.45, 0.32, 3.3, 0x3b6e2e, 0, 0.26, z)
        .ball(0.45, 0x2e6b28, 0, 0.55, z - 1.1, 1.2, 0.6, 1.2)
        .ball(0.45, 0x2e6b28, 0, 0.55, z + 1.1, 1.2, 0.6, 1.2);
      addPalm(b, 0, z, rand(0.75, 1.05));
    }
  }
  let solar = 0;
  for (let z = -60; z > Z_GEN; z -= 48) {
    const side = solar++ % 2 ? -1 : 1;
    if (inRiver(z, 4) || inMateteZone(side, z, 3) || nearRing(z, 6) || atSideRoad(side, z, 2)) continue;
    addSolarLight(chunks.at(z), side, z);
    if (POPULAR && !inHighway(z) && solar % 3 === 0) {
      for (const ry of [0, Math.PI]) signs.add('flagRDC', flagTexture, 1.1, 0.75, side * (ROAD_EDGE + 2.4) + 0.6 * Math.cos(ry), 6.6, z, ry);
    }
  }
  __mark('bw (pas de pylône sur le tronçon de Limete : il tombe');
  // (pas de pylône sur le tronçon de Limete : il tomberait sur une des rues du croquis)
  __mark('bw (à Masina, côté droit : la boucle passe derrière l');
  // (à Masina, côté droit : la boucle passe derrière les façades)
  const inMasZ = z => MAS && z < MAS_Z0 + 40 && z > MAS_Z1 - 40;
  for (let z = -420; z > Z_GEN + 200; z -= rand(700, 1100)) if (!(LIM && z < Z16 + 40) && !(inMobZ(z) && inMasZ(z))) addMast(chunks.at(z), (inMasZ(z) || chance(0.5) ? -1 : 1) * rand(45, 80), z);   // (ni dans la boucle de Masina, ni dans le quartier de Moboma)

  __mark('bw Glissières métalliques (ex. vers Kingasani)');
  // Glissières métalliques (ex. vers Kingasani)
  for (const [at, r] of R.guardrails) {
    const zc = lmZ(at);
    // (l'auteur, 14/11 : rien ne passe à travers) : la glissière s'ouvre devant les entrées d'avenue et les stations (atSideRoad)
    for (const s of [-1, 1]) {
      let run = null;
      const flush = zEnd => { if (run !== null && run - zEnd > 0.5) for (const [p, q] of pieces(run, zEnd, 96)) chunks.at((p + q) / 2).box(0.08, 0.32, p - q, 0xaab0b6, s * (ROAD_EDGE + 0.45), 0.78, (p + q) / 2); run = null; };
      for (let z = zc + r; z > zc - r; z -= 1) {
        const open = atSideRoad(s, z, 1);
        if (open) flush(z + 1); else if (run === null) run = z;
        if (!open && Math.round(z) % 2 === 0) details.at(z).box(0.1, 0.75, 0.1, 0x8e949a, s * (ROAD_EDGE + 0.5), 0.45, z);
      }
      flush(zc - r);
    }
  }

  __mark('bw Bordures peintes rouge et blanc + bornes (petits o');
  // Bordures peintes rouge et blanc + bornes (petits objets : affichés seulement de près)
  let paint = 0;
  for (let z = Z_START; z > Z_GEN; z -= 1.5) {
    const c = paint++ % 2 ? 0xd23f36 : 0xeeeae2;
    const d = details.at(z);
    if (R.rocade || inCrossing(z) || inHighway(z)) continue;   // (Rocade : caniveaux béton gris, pas de bordures peintes ; voir rocShoulder)
    for (const s of [-1, 1]) {
      if (!inRiver(z, 1) && !atSideRoad(s, z - 0.75, 0.6)) curbs.at(z).box(0.62, 0.04, 1.5, c, s * (ROAD_EDGE + 0.3), 0.21, z - 0.75);
      if (!inFlyover(z, 1) && !inSignalCrossing(z - 0.75, 0.75) && !(IS_TOWER && ((s > 0 && Math.abs(z - 0.75 - ECH.cross) < 14.3) || (z - 0.75 < ECH.tri0 + 2 && z - 0.75 > ECH.park0)))) curbs.at(z).box(0.16, 0.3, 1.5, c, s * (MEDIAN - 0.08), 0.16, z - 0.75);   // bordure du terre-plein
    }
    if (paint % 2 === 0 && !inRiver(z, 1)) for (const s of [-1, 1]) if (!atSideRoad(s, z, 0.5)) d.box(0.28, 0.32, 0.5, 0x6e2a22, s * (ROAD_EDGE + 0.3), 0.36, z);
  }

  __mark('bw Bordures, caniveaux et accotements (pas sur les po');
  // Bordures, caniveaux et accotements (pas sur les ponts) — ou trottoirs dallés sur les avenues rénovées
  for (const [a, c] of solid(Z_START, Z_GEN, true)) {
    for (const [p0, q0] of spans(a, c)) for (const s of [-1, 1]) for (const [p, q] of cutSide(s, p0, q0)) {
      const b = chunks.at((p + q) / 2), len = p - q, zc = (p + q) / 2;
      if (R.industrial) { plShoulder(b, s, zc, len); continue; }
      if (R.rocade) { rocShoulder(b, s, zc, len); continue; }
      if (R.twoLane && RINGS.some(q => q.kind === 'gap' && zc < q.z0 + 30 && zc > q.z1 - 30)) continue;
      if (R.twoLane) { b.box(FRONT - ROAD_EDGE, 0.03, len, 0xb8926a, s * (FRONT + ROAD_EDGE) / 2, 0.0, zc); continue; }   // (ni bordure ni caniveau : la terre)
      if (inHighway(zc)) {
        b.box(1.6, 0.02, len, 0x77787b, s * (ROAD_EDGE + 0.8), 0.012, zc)                                     // bande d'arrêt goudronnée
          .box(FRONT - ROAD_EDGE - 1.6, 0.03, len, 0xc4996c, s * (FRONT + ROAD_EDGE + 1.6) / 2, 0.0, zc);      // sable
        if (chance(0.4)) b.box(rand(2, 6), 0.04, len * rand(0.2, 0.6), 0xb0855a, s * (ROAD_EDGE + rand(4, 8)), 0.01, zc + rand(-len / 4, len / 4));
        continue;
      }
      if (!POPULAR) {
        b.box(0.6, 0.2, len, 0xb8b2a6, s * (ROAD_EDGE + 0.3), 0.1, zc)
          .box(FRONT - ROAD_EDGE - 0.6, 0.16, len, 0xc9c6bd, s * (FRONT + ROAD_EDGE + 0.6) / 2, 0.08, zc);
        continue;
      }
      {
        b.box(0.6, 0.2, len, 0xb8b2a6, s * (ROAD_EDGE + 0.3), 0.1, zc)
          .box(1.4, 0.04, len, 0x2b2622, s * (ROAD_EDGE + 1.3), 0.0, zc)
          .box(0.15, 0.28, len, 0x9e988c, s * (ROAD_EDGE + 0.62), 0.12, zc)
          .box(0.15, 0.28, len, 0x9e988c, s * (ROAD_EDGE + 1.98), 0.12, zc)
          .box(FRONT - ROAD_EDGE - 2.05, 0.04, len, 0xc0956a, s * (FRONT + ROAD_EDGE + 2.05) / 2, 0.0, zc);
        if (chance(0.5)) b.box(3, 0.06, len * rand(0.4, 1), pick([0x6f8f3e, 0x7d9a48, 0x62853a]), s * (ROAD_EDGE + 3.6), 0.01, zc);
      }
    }
  }
  __mark('bw (lauteur, 09/11 : « ces boulevards ne sont pas bi');
  // (l'auteur, 09/11 : « ces boulevards ne sont pas bien attachés ») : les entrées « Avenue Kasa-Vubu » du 30 Juin ne sont pas dessinées quand la vraie
  __mark('bw avenue est chargée (main.js ROAD6) : elle arrive a');
  // avenue est chargée (main.js ROAD6) : elle arrive au même endroit ; on y roule quand même (onSideRoad), jusqu'au changement de route
  for (const r of SIDE_ROADS.filter(r => r.z > Z_END && !r.light && !(r.kv && globalThis.TAXIKIN_KV) && !(r.roc && globalThis.TAXIKIN_ROC) && !(r.mm && globalThis.TAXIKIN_MM))) {   // (rien au-delà de la fin de la chaussée : parc de l'Échangeur)
    addSideRoad(chunks.at(r.z), details, signs, r);
    // Drapeau de la RDC flottant au coin de l'entrée d'avenue (comme dans la vidéo v1_early_120s.jpg) + motos-taxis (wewas)
    // (Moboma : rue très en biais ; le drapeau va du côté de l'angle ouvert, après le panneau, et les motos-taxis sont sur le parvis de l'Aéro Club)
    if (!r.moboma) addFlag(chunks.at(r.z), signs, r.side * (ROAD_EDGE + 3.2), r.z + r.w / 2 + 2.8, 8.5);
    else if (r.ang >= 0) addFlag(chunks.at(r.z), signs, -(ROAD_EDGE + 3.2), r.z + sideHalf(r) + 4.6, 8.5);
    if (POPULAR && !r.moboma && !(r.z < Z_FORK && extZone(r.z) === 'triomphal')) {
      for (let m = 0; m < 2; m++) {
        const moto = createMoto();
        place(moto, r.side * (ROAD_EDGE + 4.2 + m * 1.6), r.z - r.w / 2 - 1.5, r.side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
        scene.add(moto);
      }
    }
  }

  __mark('bw Arrêts de bus et taxis-bus le long du boulevard');
  // Arrêts de bus et taxis-bus le long du boulevard
  for (const bz of BUS_STOPS.filter(z => z > Z_END)) {
    const nearest = LANDMARKS.reduce((best, l) => (Math.abs(l.z - bz) < Math.abs(best.z - bz) ? l : best), LANDMARKS[0]);
    addBusStop(chunks.at(bz), details, signs, bz, nearest.short);
  }
  for (const bz of BUS_STOPS_L.filter(z => z > Z_END && !(LIM && z < Z16 + 10 && z > Z_FORK - 10))) {   // (à Limete : déjà dessinés, leftStops)
    const nearest = LANDMARKS.reduce((best, l) => (Math.abs(l.z - bz) < Math.abs(best.z - bz) ? l : best), LANDMARKS[0]);
    addBusStop(chunks.at(bz), details, signs, bz, nearest.short, -1);
  }

  __mark('bw Ouvrages');
  // Ouvrages
  for (const r of RIVERS) addRiver(chunks.at(r.z), signs, r, LIM && r.z < Z16 ? [[LIM_PB_X - PB_W / 2 - 2.5, LIM_PB_X + PB_W / 2 + 2.5]] : [], masRiverEnd(r));
  __mark('ouvrage 1 : for (const r of RIVERS) addRiver(chu');
  for (const f of FLYOVERS) addFlyover(scene, signs, f, roadMats);
  __mark('ouvrage 2 : for (const f of FLYOVERS) addFlyover');
  for (const z of FOOTBRIDGES.filter(z => z > Z_END)) addFootbridge(chunks.at(z), z);
  __mark('ouvrage 3 : for (const z of FOOTBRIDGES.filter(z');
  for (const st of STATIONS) if (st.kind !== 'fork') (st.kind === 'strip' ? addStripStation : addStation)(chunks.at(st.z), signs, st);
  __mark('ouvrage 4 : for (const st of STATIONS) if (st.ki');
  CROSSINGS.forEach((c, i) => { if (!c.hide) addCrossStreet(chunks.at(c.z), details, signs, c.z, c.name, `cross${i}`); });
  __mark('ouvrage 5 : CROSSINGS.forEach((c, i) => { if (!c');
  if (R.start === 'airport') {
    addAirport(chunks.at(0), signs);
    // Clôture continue à droite : de 10 m avant le parvis de l'aéroport (z = -58) jusqu'à 20 m avant la Station Cobil de Siforco (g(4064) + 35)
    addAirportFence(chunks, details, -58, g(4064) + 35);
    // addPromoBillboards(scene, chunks);   // (l'auteur, 26/11 : plus aucun grand panneau)
  }
  else if (!START_ATTACHED) addCrossStreet(chunks.at(24), details, signs, 24, R.landmarks[0][0], 'crossStart');
  __mark('ouvrage 7 : else if (!START_ATTACHED) addCrossSt');
  if (R.end.kind === 'tower') addInterchange(scene, chunks, details, signs);
  else if (R.end.kind !== 'open') addCrossStreet(chunks.at(END_Z + 4), details, signs, END_Z + 4, R.end.name, 'crossEnd');
  __mark('ouvrage 9 : else if (R.end.kind !== open) addC');
  if (LIM) addLimete(chunks, details, curbs, signs, scene);
  __mark('ouvrage 10 : if (LIM) addLimete(chunks, details, ');
  const rigid = new Rigid();
  __mark('ouvrage 11 : const rigid = new Rigid();');
  if (LIM?.fork && R.end.fork) addSendweFork(chunks, details, signs, rigid);
  __mark('ouvrage 12 : if (LIM?.fork && R.end.fork) addSend');
  // (26/11, chargement plus court) : quand le départ est loin du prolongement, son décor se construit après le départ, par petites tranches
  // (extStep, appelée à chaque image) ; il a ses propres lots, ses lampes et ses panneaux, affichés ensuite comme les autres (voir follow)
  // (seulement pour un départ à l'aéroport / début de route, loin du prolongement : les départs nommés, Sendwe, Triomphal, 24 Novembre, Mandela, ou une reprise
  // à une position précise, arrivent dans le décor lointain, qui doit déjà être là)
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const defExt = !!EXT && !START_ATTACHED && Z_START - Z_FORK > 1500 && ['start', 'airport'].includes(qs.get('start') || R.startAt || 'sendwe') && !qs.get('s') && !qs.get('z');
  let X = null;
  if (EXT && !defExt) for (const _ of addExtension(scene, chunks, details, curbs, signs, rigid, groundMat));
  else if (EXT) {
    X = { c: new Chunks(), d: new Chunks(100), k: new Chunks(100), s: new Signs(), r: new Rigid(), sky: new Chunks(1e6), l: new Chunks(), p: new Chunks(320, true), done: false };
    X.gen = (function* () {
      yield* addExtension(scene, X.c, X.d, X.k, X.s, X.r, groundMat);
      yield; X.c.build(scene);
      yield; X.sky.build(scene, Object.assign(VC_MAT.clone(), { fog: false }));
      yield; X.r.build(scene);
      yield; X.d.build(scene);
      yield; X.k.build(scene);
      yield; X.s.build(scene);
      yield; X.l.build(scene, LAMP_MAT, false);
      yield; X.p.build(scene, POOL_MAT, false);
      for (const m of X.p.meshes) { m.receiveShadow = false; m.renderOrder = 1; }
      X.done = true;
    })();
  }
  __mark('ouvrage 13 : if (EXT) addExtension(scene, chunks,');
  __mark('bw Boucle de Masina : tranches à part, affichées de p');
  // Boucle de Masina : tranches à part, affichées de plus loin quand le taxi y roule (voir follow)
  const masNear = new Chunks(100), masFar = new Chunks(100), masD = new Chunks(100), plates = new PlateAtlas();
  if (MAS && MAS_OSM) addMasina(masNear, masFar, masD, signs, plates);
  const mobNear = new Chunks(100), mobFar = new Chunks(100), mobD = new Chunks(100);
  mobNear.scan = mobD.scan = true;                       // (les obstacles du bord de la route : voir obstacleAt)
  if (MOB_ROADS.length) addMoboma(chunks, mobNear, mobFar, mobD, signs, plates, scene);
  addLightStreets(chunks, plates);
  if (R.uniRoads) plLinkRoads(scene, chunks, details, groundMat);
  if (R.campus) addCampus(scene, chunks, details, signs, plates, groundMat);
  if (RINGS.length) addUniRings(chunks, details, signs);
  if (!R.attach && !ATTACHED) addFinish(chunks.at(-ROUTE_LEN), signs);   // (trajet attaché : la route continue sur l'autre)
  for (const m of R.monuments) {
    const b = chunks.at(g(m.s));
    if (m.kind === 'palais') addPalais(b, signs, m);
    else if (m.kind === 'stadium') addStadium(b, signs, m);
    else if (m.kind === 'gare') addGare(b, signs, m);
    else addCulture(b, signs, m);
  }
  for (const sr of R.workers) addWorkers(details.at(g(sr)), g(sr));
  for (let p of PHOTO_BOARDS) {
    if (p.flex) {                                                                       // (cherche l'emplacement libre le plus proche : ni rue latérale ni arrêt de bus)
      const ok = s => { const z = g(s); return !atSideRoad(p.side, z, 12) && !inSideRoadSpan(p.side, z) && !nearAny(z, p.side > 0 ? BUS_STOPS : BUS_STOPS_L, 22) && !inRiver(z, 12) && !inCrossing(z, 12); };
      const d = [0, 20, -20, 40, -40, 60, -60, 90, -90, 130, -130].find(o => ok(p.s + o));
      if (d === undefined) continue;
      p = { ...p, s: p.s + d };
    }
    addPhotoBoard(chunks.at(g(p.s)), signs, p);
  }
  addSignals(scene, chunks);
  if (R.industrial) addPoidsLourds(scene, chunks, details, signs, groundMat);
  if (R.rocade) addRocade(scene, chunks, details, signs);
  for (const p of R.places ?? []) {
    if (p.kind === 'apocalypse') addApocalypse(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'lds_church') addLDSChurch(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'kimbanseke_commune') addCommune(chunks.at(g(p.s)), signs, p.side, g(p.s), 'KIMBANSEKE', 'Maison Communale · En face Station Engen', 'kimbanseke');
    else if (p.kind === 'masina_commune') addCommune(chunks.at(g(p.s)), signs, p.side, g(p.s), 'MASINA', 'Maison Communale · Entrée BKTF', 'masina');
    else if (p.kind === 'vodacom_shop') addVodacomShop(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'orange_shop') addOrangeShop(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'mbujimayi_kananga') addMbujimayiKananga(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'ecole_luka') addEcoleLuka(chunks.at(g(p.s)), details, signs, p.side, g(p.s));
    else if (p.kind === 'stade_masina') addStadeMasina(chunks.at(g(p.s)), signs, p.side, g(p.s), p.length);
    else if (p.kind === 'pont_matete') addPontMatete(scene, details, signs);
    else if (p.kind === 'hospital') addHospital(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'school') {                                       // p.back : en retrait (derrière une station, par ex.)
      const b = chunks.at(g(p.s));
      addNamedSchool(p.back ? shiftX(b, p.side * p.back) : b, p.back ? shiftSigns(signs, p.side * p.back) : signs, p.side, g(p.s), p);
    }
    else if (p.kind === 'mosque') addMosque(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'airtel_shop') addAirtelShop(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'church') addNamedChurch(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'commercial') addCommercialBldg(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'shekinah') addShekinah(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'shekinah_old') addShekinahOld(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'lumumba_monument') addLumumbaMonument(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'petro') addPetroCongo(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'tanks') addTanks(chunks.at(g(p.s)), p.side, g(p.s));
    else if (p.kind === 'regideso') addRegideso(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'kinmarche') addKinMarche(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'transco_depot') addTranscoDepot(scene, chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'fuel') addSideFuel(chunks.at(g(p.s)), signs, p.side, g(p.s), `fuel_${p.side}_${p.s}`, p.name);
    else if (p.kind === 'kadafi') addKadafi(chunks.at(g(p.s)), details.at(g(p.s)), p.side, g(p.s));
    else if (p.kind === 'atm') addAtmKiosk(chunks.at(g(p.s)), signs, p.side, g(p.s), `atm_${p.side}_${p.s}`, p);
    else if (p.kind === 'b30_kintambo') addB30Kintambo(chunks.at(g(p.s)), details, signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_rev_kim') addB30RevKim(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_mural') addB30Mural(chunks.at(g(p.s)), signs, p.side, g(p.s));
    else if (p.kind === 'b30_ggmart') addB30Ggmart(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_chantier') addB30Chantier(chunks.at(g(p.s)), p.side, g(p.s), p);
    else if (p.kind === 'b30_jac') addB30Jac(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_batetela') addB30Batetela(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_cnss_glass') addB30CnssGlass(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_res165') addB30Res165(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_gouvernement') addB30Gouvernement(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_white_tower') addB30WhiteTower(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_3pillars') addB30ThreePillars(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_copper_glass') addB30CopperGlass(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_africell_tower') addB30AfricellTower(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_afriland') addB30Afriland(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_matrix') addB30Matrix(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_mandela_apt') addB30MandelaApt(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_rotana') addB30Rotana(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_believe') addB30Believe(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_sabena') addB30Sabena(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_orange_tower') addB30OrangeTower(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_chancellerie') addB30Chancellerie(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_regideso') addB30Regideso(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_dentisterie_chantier') addB30DentisterieChantier(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_blue_curve') addB30BlueCurve(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_scpt') addB30Scpt(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_sozacom') addB30Sozacom(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_solenac') addB30Solenac(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_memling') addB30Memling(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_bcdc_tower') addB30BcdcTower(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_palais_justice') addB30PalaisJustice(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_bold_chantier') addB30BoldChantier(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
    else if (p.kind === 'b30_ferris_wheel') addB30FerrisWheel(chunks.at(g(p.s)), signs, p.side, g(p.s), p);
  }
  if (MONUMENTAL) addFence(chunks, details);

  __mark('bw Marchés (grands hangars) et taxis-bus / taxis « Ke');
  // Marchés (grands hangars) et taxis-bus / taxis « Ketch » en attente de clients aux arrêts
  const LIB = R.market ? lmZ(R.market.at) : null;
  const PARKS = R.busParks.map(lmZ);
  if (R.market) addMarketHalls(chunks.at(LIB), details, LIB + 85, LIB - 110);
  __mark('bw Véhicules en stationnement aux grands terminus (Pa');
  // Véhicules en stationnement aux grands terminus (Pascal, Q1) et en amont/aval des arrêts (sans bloquer l'abribus ni la zone jaune)
  for (const zc of PARKS) {
    for (let i = 0; i < 4; i++) {
      const veh = i % 2 === 1 ? createHatchback({ taxi: true }) : createMinibus({ apprenti: chance(0.6) });
      place(veh, ROAD_EDGE + 5.0 + (i % 2) * 2.6, zc - 22 - i * 9, rand(-0.15, 0.15), 0);
      scene.add(veh);
    }
  }
  for (const zc of BUS_STOPS.filter(z => z > Z_END)) {
    for (const dz of [-16, 17]) {
      if (atSideRoad(1, zc + dz, 3)) continue;                             // pas devant l'entrée d'une rue
      const veh = dz > 0 ? createHatchback({ taxi: true }) : createMinibus({ apprenti: chance(0.6) });
      place(veh, ROAD_EDGE + 4.2, zc + dz, rand(-0.08, 0.08), 0);
      scene.add(veh);
    }
  }
  addPolicePosts(scene, details);
  __mark('bw La foule des zones de Masina, Pascal, Bitabe, Quar');
  // La foule des zones de Masina, Pascal, Bitabe, Quartier 1 : des gens debout ou assis le long des deux trottoirs (figés : légers)
  for (const C of CROWDS) for (const side of [-1, 1]) for (let z = C.z0 - 4; z > C.z1; z -= rand(4, 7.5)) {
    if (atSideRoad(side, z, 4) || inRiver(z, 6) || inRaised(z, 6) || FUELS.some(f => f.side === side && Math.abs(f.z - z) < 20)) continue;
    const x = side * (ROAD_EDGE + rand(1.4, 7.5));
    if (chance(0.18)) addPerson(details.at(z), x, z, { sitting: true, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    else addPerson(details.at(z), x, z, {});
  }
  if (R.market) {
    signs.add('market', () => signTexture(R.market.title, R.market.sub, '#c8102e', '#fff', true), 16, 2.6, FRONT + 1, 6.2, LIB + 112, 0);
    chunks.at(LIB).box(0.6, 7.5, 0.6, 0xd8d3c6, FRONT - 7, 3.75, LIB + 112).box(0.6, 7.5, 0.6, 0xd8d3c6, FRONT + 9, 3.75, LIB + 112);
  }

  __mark('bw Panneaux de direction');
  // Panneaux de direction
  LANDMARKS.slice(1).filter(lm => !lm.minor).forEach((lm, i) => addRoadSign(chunks.at(lm.z + 200), signs, `dir${i}`, lm.name, '200 m', lm.z + 200));
  addRoadSign(chunks.at(-40), signs, 'start', R.startSign[0], R.startSign[1], -40);
  for (const f of FLYOVERS) chunks.at(f.z0 + 140).box(0.25, 6.2, 0.25, 0x8e949a, ROAD_EDGE + 2.2, 3.1, f.z0 + 140).box(4.5, 0.2, 0.2, 0x8e949a, ROAD_EDGE + 0.2, 6, f.z0 + 140);
  for (const st of STATIONS) {
    if (!STATIONS.some(o => o !== st && o.z > st.z && o.z - st.z < 180)) {
      addRoadSign(chunks.at(st.z + 120), signs, `st${st.z}`, 'STATION', `${st.name} · 100 m`, st.z + 120, '#b0102a');
    }
  }

  __mark('bw Façades photographiques (vidéos) là où le trajet e');
  // Façades photographiques (vidéos) là où le trajet en a ; ailleurs, façades modélisées
  const PHOTO = R.backdrops ?? {};
  const planFor = (side, cz) => (inHighway(cz) && PHOTO[side > 0 ? 'highwayRight' : 'highwayLeft']) || PHOTO[side > 0 ? 'right' : 'left'] || [];
  const photoAt = (side, cz) => planFor(side, cz).some(n => STRIPS[n]);

  __mark('bw Panneaux publicitaires (pas devant les façades pho');
  // Panneaux publicitaires (pas devant les façades photographiques : elles ont leurs vrais panneaux)
  let bi = 0;
  for (let z = -160; false && !R.industrial && z > Z_GEN + 100; z -= rand(220, 320)) {   // (Route Poids Lourds : plBoards)
    const side = bi % 2 ? -1 : 1;
    if (inRiver(z, 20) || inCrossing(z, 10) || inMateteZone(side, z, 10) || atSideRoad(side, z, 4) || nearRing(z, 10) || (MONUMENTAL && bi > 3)) continue;
    if (photoAt(side, z)) { bi++; continue; }
    const [t, sub, bg, fg] = BILLBOARDS[bi % BILLBOARDS.length];
    const x = side * (FRONT - 3.5);
    chunks.at(z).box(0.3, 6, 0.3, 0x6c7680, x - 2.5, 3, z).box(0.3, 6, 0.3, 0x6c7680, x + 2.5, 3, z);
    signs.add(`bb${bi % BILLBOARDS.length}`, () => signTexture(t, sub, bg, fg), 8, 2.6, x, 6.3, z + 0.2, 0);
    bi++;
  }

  __mark('bw Façades : boutiques, parcelles, immeubles R+2, ter');
  // Façades : boutiques, parcelles, immeubles R+2, terrains vagues avec arbres
  const SKIP_R = [...STATIONS.map(s => ({ z: s.z, d: 30 })), ...PARKS.map(z => ({ z, d: 45 })), ...BUS_STOPS.map(z => ({ z, d: 30 })),
    ...(R.market ? [{ z: LIB, d: 125 }] : [])];
  const SKIP_BOTH = [...RIVERS.map(r => ({ z: r.z, d: r.w / 2 + 4 })), ...RINGS.map(q => ({ z: q.z, d: q.reach + 4 })), ...RINGS.filter(q => q.kind === 'gap').map(q => ({ z: q.z0 + 150, d: 75 })), ...(R.campus ? [{ z: CAMPUS_Z - 400, d: 400 }] : []),
    ...CROSSINGS.map(c => ({ z: c.z, d: c.w / 2 + 3 }))];
  const SKIP_SIDE = [...R.monuments.map(m => ({ side: m.side, z: g(m.s), d: m.kind === 'stadium' ? 110 : m.kind === 'palais' ? 95 : m.kind === 'culture' ? 100 : 50 })),
    ...(R.places ?? []).filter(p => p.kind !== 'tanks' && p.kind !== 'pont_matete').map(p => ({ side: p.side, z: g(p.s), d: { petro: 24, lds_church: 18, kimbanseke_commune: 18, masina_commune: 18, vodacom_shop: 12, orange_shop: 13, airtel_shop: 9, atm: 7, mosque: 16, mbujimayi_kananga: 15, ecole_luka: 18, stade_masina: (p.length ?? 36) / 2 + 3, hospital: 16, school: 15, church: 14, shekinah: 42, shekinah_old: 22, commercial: 12, lumumba_monument: 8, apocalypse: 68, regideso: 20, kinmarche: 32, transco_depot: 46, fuel: 22, b30_kintambo: 38, b30_rev_kim: 28, b30_mural: 38, b30_ggmart: 34, b30_chantier: 22, b30_jac: 32, b30_batetela: 26, b30_cnss_glass: 22, b30_res165: 24, b30_gouvernement: 44, b30_white_tower: 22, b30_three_pillars: 24, b30_copper_glass: 22, b30_africell_tower: 24, b30_afriland: 22, b30_matrix: 24, b30_mandela_apt: 24, b30_rotana: 44, b30_believe: 22, b30_sabena: 34, b30_orange_tower: 22, b30_chancellerie: 28, b30_regideso: 32, b30_dentisterie_chantier: 28, b30_blue_curve: 22, b30_scpt: 36, b30_sozacom: 38, b30_solenac: 24, b30_memling: 26, b30_bcdc_tower: 36, b30_palais_justice: 60, b30_bold_chantier: 24, b30_ferris_wheel: 34 }[p.kind] ?? 30 })),
    ...(HAS_MATETE ? [-1, 1].map(side => ({ side, z: (MATETE_ZONE[side][0] + MATETE_ZONE[side][1]) / 2, d: (MATETE_ZONE[side][0] - MATETE_ZONE[side][1]) / 2 + 4 })) : []),
    ...(IS_TOWER ? [{ side: 1, z: (ECH_ZONE[0] + ECH_ZONE[1]) / 2, d: (ECH_ZONE[0] - ECH_ZONE[1]) / 2 },
      ...ECH_ZONES_L.map(([a, c]) => ({ side: -1, z: (a + c) / 2, d: (a - c) / 2 }))] : []),
    ...SIDE_ROADS.map(r => { const [a, c] = sideRoadSpan(r); return { side: r.side, z: (a + c) / 2, d: (a - c) / 2 }; }),
    ...FORKS.map(f => ({ side: -1, z: (f.z0 + f.z1) / 2, d: (f.z0 - f.z1) / 2 })), ...RINGS.filter(q => q.kind === 'gap').map(q => ({ side: 1, z: q.z1 - 40, d: 45 })),
    ...(MOB_FRONT ? [{ side: -1, z: (MOB_FRONT[0] + MOB_FRONT[1]) / 2, d: (MOB_FRONT[0] - MOB_FRONT[1]) / 2 }] : []),
    // routes d'entrée de Masina, là où elles passent derrière les façades (jusqu'à 64 m de l'axe)
    ...MAS_ROADS.filter(r => r.paved && r.key !== 'kulumba').map(r => {
      const zs = r.pts.slice(1).flatMap((c, i) => {
        const a = r.pts[i], out = [];
        for (let t = 0; t <= 1.0001; t += 0.02) if (a[0] + (c[0] - a[0]) * t <= 64) out.push(a[1] + (c[1] - a[1]) * t);
        return out;
      });
      const z0 = Math.max(...zs) + r.w / 2 + 2, z1 = Math.min(...zs) - r.w / 2 - 2;
      return { side: 1, z: (z0 + z1) / 2, d: (z0 - z1) / 2 };
    })];
  const DENSE = R.dense.map(([at, r]) => ({ z: lmZ(at), d: r }));
  const zAirportFenceEnd = g(4064) + 35;   // 20 m avant l'aire de la Station Cobil de l'Entrée Siforco
  const blockedAt = (side, cz) => (side > 0 && ((R.start === 'airport' && cz > zAirportFenceEnd) || nearAny(cz, SKIP_R))) || nearAny(cz, SKIP_BOTH)
    || SKIP_SIDE.some(m => m.side === side && Math.abs(cz - m.z) < m.d) || cz < Z_GEN + 20;
  const backdrops = addBackdrops(scene, PHOTO, blockedAt);
  for (const side of R.industrial ? [] : [-1, 1]) {   // (Route Poids Lourds : addPoidsLourds)
    let z = Z_START;
    while (z > (EXT ? Z_GEN : ATTACHED ? Z_END + 8 : Z_END - 60)) {   // (trajet attaché : au-delà, la Route Poids Lourds arrive sur la place)
      const kind = Math.random();
      const w = kind < 0.5 ? rand(5, 9) : kind < 0.8 ? rand(10, 20) : rand(10, 16);
      const cz = z - w / 2;
      const blocked = blockedAt(side, cz);
      if (!blocked && photoAt(side, cz)) {
        // façade photographique : on garde seulement la vie de l'accotement (plus bas)
      } else {
      const nearLimete = R.tallNearEnd && cz < -ROUTE_LEN + R.tallNearEnd;   // en approchant de la fin : immeubles de 4-5 niveaux
      const b = chunks.at(cz);
      if (!blocked && BP_AIRY(cz) && chance(0.45)) { z -= w + rand(2, 12); continue; }   // (By Pass, avant Ngaba : terrains libres entre les bâtiments)
      if (R.rocade && (inRocCut(cz, 8) || (!blocked && chance(0.62)))) {         // (Rocade : maisons neuves éparses, parcelles vides, palmiers ; rien dans les tranchées)
        if (!blocked && !inRocCut(cz, 8) && chance(0.35)) (chance(0.5) ? addPalm : addMango)(b, side * (FRONT + rand(2, 16)), cz, rand(0.8, 1.3));
        z -= w + rand(4, 22); continue;
      }
      if (!blocked && DOWNTOWN) {
        // centre-ville : à l'ouest grands arbres et murs blancs, puis immeubles de plus en plus hauts vers la Gare
        const t = Math.min(1, -cz / ROUTE_LEN);
        const leafy = R.trees && cz > g(R.trees);
        const ww = leafy ? rand(18, 40) : rand(14, 30), cw = z - ww / 2;
        if (!blockedAt(side, cw) && !blockedAt(side, z - ww + 2)) {
          const b2 = chunks.at(cw);
          if (leafy && chance(0.6)) addWhiteWall(b2, side, cw, ww);
          else addHighrise(b2, signs, side, cw, ww, t);
        }
        z -= ww + rand(1, 4);
        continue;
      }
      if (!blocked && MONUMENTAL) {
        // avenue rénovée : longs bâtiments administratifs, quelques immeubles, arbres d'alignement
        const ww = kind < 0.65 ? w * 2.2 : w, cw = z - ww / 2;
        if (kind < 0.65) addAdmin(chunks.at(cw), side, cw, ww);
        else if (kind < 0.85) addTall(chunks.at(cw), signs, side, cw, ww);
        else chunks.at(cw).box(14, 0.06, ww, 0x6f9a48, side * (FRONT + 7), 0.03, cw);   // pelouse
        z -= ww + rand(2, 6);
        continue;
      }
      if (!blocked && inHighway(cz) && !R.twoLane && chance(0.45)) { /* terrain nu le long de la route large */ }
      else if (!blocked) {
        if (kind < 0.5) addShop(b, signs, side, cz, w);
        else if (kind < 0.8) addParcel(b, side, cz, w);
        else if (kind < 0.9 || (nearLimete && kind < 0.97)) addTall(b, signs, side, cz, w, nearLimete ? 4 + Math.floor(Math.random() * 2) : undefined);
        else addLot(b, side, cz, w);
        // deuxième rangée en arrière-plan
        if (chance(0.7)) {
          const d = rand(7, 12), h = rand(2.8, 6);
          const x = side * (FRONT + 14 + d / 2 + rand(0, 8));
          b.box(d, h, w * rand(0.7, 1), pick(WALLS), x, h / 2, cz).box(d + 0.6, 0.12, w, pick(TIN), x, h + 0.25, cz, 0, 0, side * 0.1);
        }
      }
      }
      // vie de l'accotement
      const busPark = side > 0 ? [...PARKS, ...BUS_STOPS].some(zc => cz < zc + 36 && cz > zc - 52) : BUS_STOPS_L.some(zc => Math.abs(cz - zc) < 18);
      if (cz > Z_GEN + 2 && !nearRing(cz, 4) && !(R.campus && cz < CAMPUS_Z) && !inRiver(cz, 3) && !(side > 0 && R.start === 'airport' && cz > zAirportFenceEnd) && !busPark && !inCrossing(cz, 2) && !atSideRoad(side, cz, 3) && !inSideRoadSpan(side, cz) && !inMateteZone(side, cz, 3)) {
        const dense = nearAny(cz, DENSE, 0);
        if (dense || chance(inHighway(cz) && !R.twoLane ? 0.12 : 0.35)) addVendors(details.at(cz), side, cz, dense);
        if (chance(0.4)) for (let k = 0; k < 4; k++) details.at(cz).box(rand(0.1, 0.3), 0.04, rand(0.1, 0.3), pick([0xe8e8e8, 0x1d6fd1, 0x2b2b2b, 0xd62828]), side * (ROAD_EDGE + rand(0.7, 3)), 0.03, cz + rand(-w / 2, w / 2));
      }
      z -= w + rand(0.3, 2.5);
    }
  }

  __mark('bw (la flèche passe au-dessus de la route : pas de gr');
  // (la flèche passe au-dessus de la route : pas de grue sur le remblai du Pont Matete ni là où les chaussées s'écartent)
  if (R.cranes) for (const [x, z0] of [[-48, END_Z + 875], [105, END_Z + 435]]) { const z = inRaised(z0, 40) ? MAT.down1 - 80 : z0; addCrane(chunks.at(z), x, z); }

  chunks.build(scene);
  __mark('build chunks');
  skyline.build(scene, Object.assign(VC_MAT.clone(), { fog: false }));   // (jamais masquée : pas de cull)
  __mark('build skyline');
  rigid.build(scene);
  __mark('build rigid');
  details.build(scene);
  __mark('build details');
  curbs.build(scene);
  __mark('build curbs');
  if (PAIR) { pairPeople.build(scene, VC_MAT, true, true); pairFar.build(scene, VC_MAT, true, true); }
  masNear.build(scene);
  __mark('build masNear');
  masFar.build(scene);
  __mark('build masFar');
  masD.build(scene);
  __mark('build masD');
  mobNear.build(scene);
  __mark('build mobNear');
  mobFar.build(scene);
  __mark('build mobFar');
  mobD.build(scene);
  __mark('build mobD');
  plates.build(scene);
  __mark('build plates');
  signs.build(scene);
  __mark('build signs');
  lamps.build(scene, LAMP_MAT, false);
  __mark('build lamps');
  pools.build(scene, POOL_MAT, false);
  __mark('build pools');
  for (const m of pools.meshes) { m.receiveShadow = false; m.renderOrder = 1; }
  LAMPS = POOLS = null;

  const campusLife = R.campus ? new CampusLife(scene) : null;
  return {
    sun,
    tick(dt, time, taxi) {
      campusLife?.update(dt, time, taxi);
      updateWorksProps(dt, taxi);
    },
    /** Construit le décor lointain par tranches (ms par appel) ; renvoie vrai quand c'est fini (ou s'il n'y a rien à faire). */
    extStep(ms = 5) {
      if (!X || X.done) return true;
      const t0 = performance.now();
      [SKYLINE, LAMPS, POOLS] = [X.sky, X.l, X.p];
      try { while (!X.done && performance.now() - t0 < ms) X.gen.next(); }
      finally { SKYLINE = LAMPS = POOLS = null; }
      return X.done;
    },
    follow(x, z, heading = 0) {
      // On voit loin dans le sens où roule le taxi (vers Limete, -z, ou en revenant vers l'aéroport, +z) ; de côté : des deux
      const c = Math.cos(heading), far = fog.far + 40, ahead = c > -0.35, behind = c < 0.35;
      chunks.cull(z, ahead ? far : 150, behind ? far : 150);
      details.cull(z, ahead ? 200 : 60, behind ? 200 : 60);   // vendeurs, foules, marchandises : invisibles de loin
      curbs.cull(z, ahead ? 340 : 60, behind ? 340 : 60);
      lamps.cull(z, ahead ? far : 150, behind ? far : 150);
      pools.cull(z, ahead ? 340 : 60, behind ? 340 : 60);
      if (X?.done) {
        X.c.cull(z, ahead ? far : 150, behind ? far : 150);
        X.d.cull(z, ahead ? 200 : 60, behind ? 200 : 60);
        X.k.cull(z, ahead ? 340 : 60, behind ? 340 : 60);
        X.l.cull(z, ahead ? far : 150, behind ? far : 150);
        X.p.cull(z, ahead ? 340 : 60, behind ? 340 : 60);
      }
      if (PAIR) { pairPeople.cull(z, ahead ? 200 : 60, behind ? 200 : 60); pairFar.cull(z, ahead ? far : 150, behind ? far : 150); }
      for (const m of backdrops) m.visible = m.userData.z1 > z - (ahead ? far : 150) && m.userData.z0 < z + (behind ? far : 150);
      // Masina : depuis le boulevard, on n'en voit que les abords des entrées ; dans la boucle, on voit loin des deux côtés
      if (MAS) {
        const inside = x > ROAD_EDGE + 1;
        masNear.cull(z, inside ? 380 : ahead ? 170 : 70, inside ? 380 : behind ? 170 : 70);
        masFar.cull(z, inside ? 420 : -1e6, inside ? 420 : -1e6);                    // (le loin : seulement depuis Masina)
        masD.cull(z, inside ? 170 : ahead ? 90 : 40, inside ? 170 : behind ? 90 : 40);
      }
      // Moboma (côté gauche) : depuis le boulevard, les abords des entrées ; dans le quartier, on voit loin
      if (MOB_ROADS.length) {
        const inside = x < -(ROAD_EDGE + 1) && inMobZ(z);
        mobNear.cull(z, inside ? 360 : ahead ? 170 : 70, inside ? 360 : behind ? 170 : 70);
        mobFar.cull(z, inside ? 400 : -1e6, inside ? 400 : -1e6);
        mobD.cull(z, inside ? 160 : ahead ? 90 : 40, inside ? 160 : behind ? 90 : 40);
      }
      if (env) this.light(worldVec(x, 0, z, new THREE.Vector3()));
    },
    /** Tombée de la nuit : k = 0 le jour, 1 la nuit (lampes de cette route ; ciel et lumière si c'est la scène principale). */
    night(k) {
      this._nk = k;
      setLamps(k);
      if (!env) return;
      const r = this._rk ?? 0, dim = 1 - 0.45 * r;                     // (la pluie assombrit tout : voir rain)
      hemi.intensity = (2.0 - 1.1 * k) * dim;
      hemi.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, k).lerp(RAIN_SKY, r * 0.5);
      hemi.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, k);
      sun.intensity = (1.5 * (1 - k) + 0.22 * k) * (1 - 0.7 * r);
      sun.color.copy(SUN_DAY).lerp(MOON, k);
      scene.background.copy(DAY_BG).lerp(NIGHT_BG, k).lerp(RAIN_BG, r * (1 - 0.6 * k));
      scene.fog.color.copy(scene.background);
      sky.material.color.setRGB(1, 1, 1).lerp(NIGHT_SKY, k).lerp(RAIN_SKY, r * (1 - 0.6 * k));
    },
    /** La pluie (pluie.js) : k = 0 sec, 1 grosse averse ; ciel gris, lumière basse, et tout le décor plus sombre et plus bleu (mouillé). */
    rain(k) {
      this._rk = k;
      if (env) VC_MAT.color.setRGB(1 - 0.22 * k, 1 - 0.2 * k, 1 - 0.1 * k);
      this.night(this._nk ?? 0);
    },
    /** Soleil (ombres) et ciel centrés sur un point de la scène (le taxi, même sur un trajet attaché). */
    light(p) {
      if (!env) return;
      sun.target.position.copy(p);
      sky.position.set(p.x, -60, p.z);
      sun.position.copy(p).add(SUN_OFFSET);
    },
  };
}
