// Fula-Fula Kin — boucle de jeu, conduite du taxi, économie de la journée.
import { Radio } from './radio.js';
import { buildCockpit } from './cockpit.js';
import { Lunettes } from './lunettes.js';
import { releaseCpuCopies, watchScene } from './memoire.js';
import * as THREE from 'three';
import * as W1 from './world.js';
import { createCar, createMinibus, createCityBus, createTruck, createSUV, createTricycle, createMoto, createPolicePickup, createAmbulance, createTrain, TRAIN_L, setNight, receveurTenue, setReceveurLive, RECEVEUR_POSTE } from './models.js';
import { NightGlow, makeBeam, setBeam } from './nuit.js';
import { Retro } from './retro.js';
import { buildCabin } from './cabine.js';
import { Preacher } from './predication.js';
import { Incidents } from './incidents.js';
import { Rain } from './pluie.js';
import { Character, outfit, hasModel } from './characters.js';
import { Traffic } from './traffic.js';
import { Passengers, newBoard, LINES } from './passengers.js';
import { StreetLife } from './life.js';
import { QuartierLife } from './quartier.js';
import { Input } from './input.js';
import { Hud, fmtFC } from './hud.js';
import { Sound } from './audio.js';
import * as RT1 from './route.js';
import { ROUTES, CURRENT, ITINERAIRES, VEHICULES, COURSES } from './routes.js';
import { THANKS } from './credits.js';
// Mesure du chargement (adresse + ?mesure) : temps depuis le début de la navigation, dans la console (lignes « MESURE »)
const MESURE = new URLSearchParams(location.search).has('mesure');
// Témoin de coupure (téléphone : Safari ferme la page sans message) : la dernière étape atteinte est gardée ; à la réouverture on l'affiche en haut de l'écran
let derniereEtape = null;
try { derniereEtape = localStorage.getItem('taxikin_etape'); localStorage.setItem('taxikin_etape', ''); } catch { /* stockage indisponible */ }
// (l'auteur, 26/11 : le bandeau rouge « chargement précédent… » est retiré ; l'étape reste notée par mark() pour les mesures)
{ const v = document.getElementById('ver'); if (v) v.textContent += ` · monde ${W1.WORLD_VER ?? 'ancien'}`; }   // (version du monde chargé, vue en bas à gauche)
const mark = n => {
  if (MESURE) console.log(`MESURE ${String(Math.round(performance.now())).padStart(6)} ms  ${n}`);
  try { localStorage.setItem('taxikin_etape', `${n.trim()} (${Math.round(performance.now() / 1000)} s)`); } catch { /* stockage indisponible */ }
};
addEventListener('pagehide', () => { try { localStorage.setItem('taxikin_etape', 'OK'); } catch { /* stockage indisponible */ } });   // (sortie normale : pas de coupure à signaler)
mark('fichiers de code chargés et évalués (world.js compris)');

// Fonctions de la route où roule le taxi : celles du trajet principal, ou celles du trajet attaché (ATT) quand le taxi y
// est (voir switchRoad)
let { FINISH_LEN, FUELS, FLYOVERS, inFlyover, SIGNALS, signalState, blockedAt, roadAxisAt, nextLevel, surfaceH,
  LANE_R, LANE_W, MEDIAN, ROAD_EDGE, RAMP_X, fuelSideAt } = W1;   // (la Route Poids Lourds n'a pas le même nombre de voies)
let { place, worldVec, stretchX, yawAt } = RT1;
const { toGame, EXT_ARCS } = RT1;                // (positions du trajet principal)

// ---------- Itinéraire, variante, sens et véhicule choisis (menu) : ?trajet=, ?var=, ?sens=, ?veh= ; sans ?trajet= mais avec ?route=, l'ancien fonctionnement (tests) ----------
const PARAMS = new URLSearchParams(location.search);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(`taxikin.${k}`); localStorage.setItem(`taxikin.${k}`, v); } catch { /* (navigation privée) */ } return null; };
const OLD_TRAJETS = { 'masina-gare': 'aeroport-gare', 'aeroport-limete': 'masina-limete', 'ngaba-masina': 'kingasani-ngaba', 'bypass-ngaba': 'kingasani-ngaba', kulumba: 'masina-limete' };
const syncVariant = (it, forceId) => {
  if (!it?.variants) return it;
  it.baseRoads ??= it.roads;
  const vid = forceId ?? (PARAMS.get('trajet') === it.id ? PARAMS.get('var') : null) ?? store(`var.${it.id}`);
  const v = it.variants.find(x => x.id === vid) ?? it.variants[0];
  Object.assign(it, { variant: v.id, variantLabel: v.label, variantShort: v.short, via: v.via, stops: v.stops, km: v.km, A: v.A ?? it.A, B: v.B ?? it.B, roads: v.roads ?? it.baseRoads });
  return it;
};
ITINERAIRES.forEach(it => syncVariant(it));
const rawTid = PARAMS.get('trajet') ?? store('trajet');
const tid = OLD_TRAJETS[rawTid] ?? rawTid;
let IT = PARAMS.get('trajet') || !PARAMS.get('route') ? (ITINERAIRES.find(i => i.id === tid) ?? ITINERAIRES[0]) : null;
syncVariant(IT);
if (IT && IT.route !== CURRENT.id) {                // (la page doit être construite sur le trajet de l'itinéraire)
  const url = new URL(location.href);
  url.searchParams.set('route', IT.route);
  url.searchParams.set('trajet', IT.id);
  location.replace(url.href);
  await new Promise(() => {});
}
let SENS = PARAMS.get('sens') ?? store('sens') ?? 'aller';
let VEH_ID = VEHICULES[PARAMS.get('veh')] ? PARAMS.get('veh') : VEHICULES[store('veh')] ? store('veh') : 'berline';
let VEH = VEHICULES[VEH_ID];
const want = key => !IT || IT.roads.includes(key);
// Mode : journée de travail, ou course (à l'aller, sur un itinéraire qui reste sur une seule route ; taxis ou motos)
const raceOK = it => it.A.road === it.B.road || (it.variants?.some(v => (v.A ?? it.A).road === (v.B ?? it.B).road) ?? false);
const ensureRaceVariant = it => {
  if (!it?.variants || it.A.road === it.B.road) return;
  const v = it.variants.find(x => (x.A ?? it.A).road === (x.B ?? it.B).road);
  if (v) { store(`var.${it.id}`, v.id); syncVariant(it, v.id); }
};
let MODE = IT && store('mode') === 'course' && raceOK(IT) ? 'course' : 'travail';
if (MODE === 'course' && IT) ensureRaceVariant(IT);
let TRIP = store('trip') === 'simple' ? 'simple' : 'ar';   // (l'auteur, 08/11 : aller simple → la partie finit au terminus ; aller-retour → au retour)
let RACE_AR = store('course') === 'ar';             // (l'auteur, 08/11 : la course est soit un aller simple, soit un aller-retour)

// ---------- Réglages du jeu ----------
let MAX_FWD = VEH.max;           // m/s (berline ~80 km/h)
const MAX_REV = 5;
// Durée de la journée (06:00 → 18:00), versement dû au propriétaire du taxi, essence au départ : selon le trajet
const SHIFT_SECONDS = CURRENT.shiftSeconds;

// ---------- Liaisons entre trajets (routes.js `links`) ----------
// Le 24 Novembre (trajet principal) et le Boulevard du 30 Juin sont deux scènes construites séparément : en prenant la
// liaison, la page se recharge sur l'autre trajet et la journée continue (caisse, heure, essence) à l'endroit voulu.
const TRANSFER_KEY = 'taxikin.transfer';
let transfer = null;
try {
  transfer = JSON.parse(sessionStorage.getItem(TRANSFER_KEY));
  sessionStorage.removeItem(TRANSFER_KEY);
} catch { transfer = null; }
if (transfer?.route !== CURRENT.id) transfer = null;
let VERSEMENT = transfer?.versement ?? (IT ? VEH.versement : CURRENT.versement);
const FUEL_START = Number(new URLSearchParams(location.search).get('essence')) || CURRENT.fuelStart;   // (adresse + ?essence=3 : partir avec 3 % pour essayer la panne sèche)
const FUEL_PRICE = 100;          // FC par % de réservoir
const REPAIR_COST = 500;
const FINE_RED = 5000;          // amende de la police pour un feu rouge grillé (FC)
// Conduite libre : messages quand le taxi touche un obstacle (voir blockedAt dans world.js)
const WALL_MSG = { median: 'Attention au terre-plein !', curb: 'Attention au trottoir !', rail: 'Attention au garde-corps !', obstacle: 'Attention, obstacle !', gens: 'Attention aux gens !', vehicule: 'Attention à la voiture !', travaux: 'Travaux : voie fermée, serre de l’autre côté !',
  wall: 'Attention au mur !', end: 'Fin de la route', start: "Fin de la route : l'aérogare" };
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let worldReady = false;

// ---------- Menu affiché immédiatement avant la construction 3D ----------
const radioGroup = (box, items, isOn, onPick) => {
  box.innerHTML = '';
  for (const it of items) {
    const btn = document.createElement('button');
    btn.className = 'route-btn';
    btn.disabled = !!it.disabled;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(isOn(it)));
    btn.innerHTML = it.html;
    btn.addEventListener('click', () => onPick(it));
    box.append(btn);
  }
};
const VEH_ART = {
  berline: '<svg viewBox="0 0 110 48"><path d="M6 34 Q6 28 14 27 L28 25 L40 15 Q44 12 52 12 L70 12 Q76 12 80 16 L88 25 L100 27 Q105 28 105 33 L105 37 L6 37 Z" fill="#f5c400"/><path d="M42 17 L50 14 L64 14 L64 25 L33 25 Z M67 14 L72 14 Q76 14 79 18 L85 25 L67 25 Z" fill="#1c2b3a"/><rect x="10" y="29" width="92" height="3" fill="#1d4fa0"/><rect x="45" y="6" width="20" height="5" rx="1.5" fill="#fff5cc"/><circle cx="28" cy="38" r="7" fill="#17181b"/><circle cx="84" cy="38" r="7" fill="#17181b"/><circle cx="28" cy="38" r="3" fill="#cfd6de"/><circle cx="84" cy="38" r="3" fill="#cfd6de"/></svg>',
  bus: '<svg viewBox="0 0 110 48"><path d="M8 38 L8 20 Q8 10 18 10 L92 10 Q102 10 104 20 L104 38 Z" fill="#2a93cc"/><path d="M8 26 L104 26 L104 38 L8 38 Z" fill="#f5c400"/><path d="M14 14 h16 v10 h-16z M34 14 h16 v10 h-16z M54 14 h16 v10 h-16z M74 14 h12 v10 h-12z M90 13 L100 13 L102 24 L90 24 Z" fill="#1c2b3a"/><rect x="58" y="14" width="10" height="24" fill="#111317"/><circle cx="26" cy="39" r="7" fill="#17181b"/><circle cx="88" cy="39" r="7" fill="#17181b"/><circle cx="26" cy="39" r="3" fill="#3a3e44"/><circle cx="88" cy="39" r="3" fill="#3a3e44"/></svg>',
  moto: '<svg viewBox="0 0 110 48"><circle cx="28" cy="36" r="10" fill="none" stroke="#17181b" stroke-width="4"/><circle cx="84" cy="36" r="10" fill="none" stroke="#17181b" stroke-width="4"/><path d="M28 36 L48 24 L70 24 L84 36 M62 24 L76 12 L82 12" stroke="#9aa0a6" stroke-width="3" fill="none"/><path d="M44 22 Q56 16 68 22 L66 27 L46 27 Z" fill="#b91c1c"/><path d="M50 22 L54 6 L64 6 L66 20 Z" fill="#d6dc24"/><rect x="51" y="11" width="14" height="2.5" fill="#9aa0a6"/><circle cx="59" cy="3" r="5" fill="#1a2a55"/><path d="M52 24 L48 34 L54 34 L58 26 Z" fill="#2f3e57"/></svg>',
  perso: '<svg viewBox="0 0 110 48"><path d="M6 34 Q6 28 14 27 L28 25 L40 15 Q44 12 52 12 L70 12 Q76 12 80 16 L88 25 L100 27 Q105 28 105 33 L105 37 L6 37 Z" fill="#1e3a8a"/><path d="M42 17 L50 14 L64 14 L64 25 L33 25 Z M67 14 L72 14 Q76 14 79 18 L85 25 L67 25 Z" fill="#1c2b3a"/><rect x="10" y="29" width="92" height="3" fill="#1d4fa0"/><rect x="45" y="6" width="20" height="5" rx="1.5" fill="#fff5cc"/><circle cx="28" cy="38" r="7" fill="#17181b"/><circle cx="84" cy="38" r="7" fill="#17181b"/><circle cx="28" cy="38" r="3" fill="#cfd6de"/><circle cx="84" cy="38" r="3" fill="#cfd6de"/></svg>',
  athlete: '<svg viewBox="0 0 110 48"><circle cx="62" cy="9" r="5" fill="#6b4428"/><path d="M58 6 Q63 3 67 7" stroke="#ffffff" stroke-width="2.5" fill="none"/><path d="M52 22 L60 14 L66 16 L58 27 Z" fill="#d62828"/><path d="M48 16 L58 15 L68 20 L74 15" stroke="#6b4428" stroke-width="3.2" stroke-linecap="round" fill="none"/><path d="M52 25 L59 27 L64 33 L56 32 Z" fill="#1a1a1a"/><path d="M59 27 L70 32 L78 41 M54 27 L43 34 L34 31" stroke="#6b4428" stroke-width="3.5" stroke-linecap="round" fill="none"/><rect x="75" y="39" width="7" height="3.5" rx="1.5" fill="#f2f2f2"/><rect x="30" y="29" width="6" height="3.5" rx="1.5" fill="#f2f2f2"/></svg>',
};
const statRow = (label, v) => `<span class="vstat">${label}<i style="--v:${Math.round(v * 100)}%"></i></span>`;
const syncUrl = () => {
  const url = new URL(location.href);
  if (IT) {
    url.searchParams.set('trajet', IT.id);
    if (IT.variant) url.searchParams.set('var', IT.variant); else url.searchParams.delete('var');
  }
  history.replaceState(null, '', url.href);
};
const pickRoute = it => {
  IT = it;
  if (MODE === 'course') ensureRaceVariant(IT);
  store('trajet', IT.id);
  VERSEMENT = VEH.versement;
  syncUrl();
  drawMenu();
};
$('mode-travail').addEventListener('click', () => { MODE = 'travail'; store('mode', 'travail'); drawMenu(); goStep(2); });
$('mode-course').addEventListener('click', () => {
  MODE = 'course'; store('mode', 'course');
  if (VEH_ID === 'bus' || VEH_ID === 'perso') { store('veh', 'berline'); setVehicle('berline'); }
  if (IT && !raceOK(IT)) {
    const it = ITINERAIRES.find(raceOK);
    pickRoute(it);
    return;
  }
  if (IT) ensureRaceVariant(IT);
  drawMenu(); goStep(2);
});
for (const [name, what] of THANKS) {
  const li = document.createElement('li');
  li.append(Object.assign(document.createElement('b'), { textContent: name }));
  if (what) li.append(` · ${what}`);
  $('thanks').append(li);
}
drawMenu();
await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- Rendu ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Téléphone : le jeu se figeait (musique qui continue) → on affiche la cause à l'écran au lieu d'un gel muet
const panne = txt => {
  if (document.getElementById('panne')) return;
  const d = document.createElement('div');
  d.id = 'panne';
  d.style.cssText = 'position:fixed;left:6px;right:6px;bottom:6px;z-index:99999;padding:8px 10px;background:rgba(160,20,20,.92);color:#fff;font:bold 16px/1.3 sans-serif;border-radius:8px';
  d.textContent = txt;
  d.onclick = () => d.remove();
  document.body.appendChild(d);
};
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); panne('Le téléphone a coupé l’affichage (mémoire). Touche pour fermer, puis recharge la page.'); });
canvas.addEventListener('webglcontextrestored', () => location.reload());
addEventListener('error', e => panne(`Erreur : ${e.message} (${(e.filename ?? '').split('/').pop()}:${e.lineno})`));
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;   // couleurs moins « plastique »
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 3600);
globalThis.TAXIKIN_KV = !!CURRENT.attachKv && want('kv');   // (world.js : le décor du carrefour Kasa-Vubu laisse la place à la vraie avenue)
globalThis.TAXIKIN_ROC = !!CURRENT.attachRoc && want('roc'); // (world.js : les entrées « Rocade Sud-Est » laissent la place à la vraie route)
globalThis.TAXIKIN_MM = TAXIKIN_ROC && !!CURRENT.attachMm && want('mm');   // (Première Entrée → Rocade : seulement avec la Rocade, où elle arrive)
mark('avant la construction de la ville');
watchScene(scene);                               // (téléphone : sommets du décor réduits dès qu'ils sont ajoutés, voir memoire.js)
const world = W1.buildWorld(scene);
releaseCpuCopies(scene);                         // (téléphone : libère la copie mémoire des sommets du décor, voir memoire.js)
mark('ville principale construite');
await new Promise(r => setTimeout(r, 0));
const lunettes = new Lunettes(renderer);          // mode lunettes (téléphone glissé dans des lunettes)
const retro = new Retro(renderer);                // rétroviseur (image de l'arrière en haut de l'écran)
const rain = new Rain(scene);                     // la pluie (averses dans la journée)
mark('lunettes, rétroviseur, pluie créés');
let fogFar = 380;
const UP = new THREE.Vector3(0, 1, 0);

// ---------- Trajet attaché (routes.js `attach`) : le vrai Boulevard du 30 Juin au bout du 24 Novembre ----------
// Ses modules sont chargés une seconde fois avec ?route=… (importmap de index.html) : il est construit tel quel, avec sa
// circulation, ses clients et ses piétons, dans un groupe tourné et déplacé de façon que son entrée (attach.road, côté
// attach.side, à attach.join m du bord) prolonge exactement le bout de la chaussée du trajet principal.
const ROAD1 = { W: W1, RT: RT1, group: scene, world, rho: 0, Hud, Traffic, Passengers, StreetLife,
  endName: (CURRENT.finish ?? CURRENT.end).name, startMsg: WALL_MSG.start, title: CURRENT.title };
let ROAD2 = null, ROAD3 = null, ROAD4 = null, ROAD5 = null, ROAD6 = null, ROAD7 = null, ROAD8 = null, JOIN_W = null;
/** Charge une autre copie des modules pour un trajet attaché et la construit dans un groupe de la scène. */
async function loadRoad(route) {
  const q = `?route=${route}`;
  mark(`route attachée ${route} : début`);
  const [W, RT, T, P, L, H] = await Promise.all(['world', 'route', 'traffic', 'passengers', 'life', 'hud'].map(m => import(`./${m}.js${q}`)));
  mark(`route attachée ${route} : fichiers chargés`);
  await new Promise(r => setTimeout(r, 0));
  const group = new THREE.Group();
  scene.add(group);
  watchScene(group);
  const built = W.buildWorld(group, { env: false, fog: scene.fog });
  releaseCpuCopies(group);
  mark(`route attachée ${route} : construite`);
  return { W, RT, group, world: built, Hud: H.Hud,
    Traffic: T.Traffic, Passengers: P.Passengers, StreetLife: L.StreetLife, endName: ROUTES[route].end.name, startMsg: 'Fin de la route', title: ROUTES[route].title };
}
const ang = v => Math.atan2(v.x, v.z);
mark('avant les routes attachées 1');
const [r2Loaded, r3Loaded] = await Promise.all([
  CURRENT.attach && want('30juin') ? loadRoad(CURRENT.attach.route) : null,
  CURRENT.attachPL && want('pl') ? loadRoad(CURRENT.attachPL.route) : null,
]);
if (r2Loaded) {
  const at = CURRENT.attach;
  ROAD2 = r2Loaded;
  const { RT: RT2, group } = ROAD2;
  // alignement : le bout du trajet principal (axe, sens de la marche) = l'entrée du trajet attaché, vers sa chaussée
  const zJ1 = -W1.ROUTE_LEN, th1 = RT1.yawAt(zJ1);
  JOIN_W = RT1.worldVec(0, 0, zJ1, new THREE.Vector3());
  const zr = -RT2.toGame(at.road);
  const Q = RT2.worldVec(at.side * (ROAD_EDGE + at.join), 0, zr, new THREE.Vector3());
  const d2 = RT2.worldVec(at.side * ROAD_EDGE, 0, zr, new THREE.Vector3()).sub(Q);
  ROAD2.rho = ang(new THREE.Vector3(Math.sin(th1), 0, -Math.cos(th1))) - ang(d2);
  group.rotation.y = ROAD2.rho;
  group.position.copy(JOIN_W).sub(Q.applyAxisAngle(UP, ROAD2.rho));
  group.position.y = -0.04;                    // (son sol passe sous celui du trajet principal là où ils se recouvrent)
  group.updateMatrixWorld(true);
  ROAD1.zJoin = zJ1;
  ROAD2.zJoin = zr;
  ROAD2.zEnd = ROAD2.W.PLAZA?.z;
}
// ---------- Route Poids Lourds (routes.js `attachPL`) : du bout de la route des rails du Pont Matete à la Place de la Gare ----------
// Même principe que le Boulevard du 30 Juin ; son début (z = 0) prolonge la route des rails et son tracé (tools/poids_lourds.py) a
// été calculé pour que son bout tombe sur le bout du Boulevard du 30 Juin.
mark('routes attachées 1 en place');
const JOINS = [];                                // raccords : { a, za, b, zb, w (point de la scène), r (décor de l'autre route affiché en deçà) }
if (JOIN_W) JOINS.push({ a: ROAD1, za: ROAD1.zJoin, b: ROAD2, zb: ROAD2.zJoin, w: JOIN_W, r: 900 });
if (r3Loaded) {
  ROAD3 = r3Loaded;
  const { RT: RT3, group } = ROAD3;
  const [jx, jz] = W1.plDiagAt(W1.PL_JOIN_U), [kx, kz] = W1.plDiagAt(W1.PL_JOIN_U + 2);
  const P = RT1.worldVec(jx, 0, jz, new THREE.Vector3()), dir = RT1.worldVec(kx, 0, kz, new THREE.Vector3()).sub(P);
  const Q = RT3.worldVec(0, 0, 0, new THREE.Vector3()), d3 = RT3.worldVec(0, 0, -2, new THREE.Vector3()).sub(Q);
  ROAD3.rho = ang(dir) - ang(d3);
  group.rotation.y = ROAD3.rho;
  group.position.copy(P).sub(Q.applyAxisAngle(UP, ROAD3.rho));
  group.position.y = -0.035;
  group.updateMatrixWorld(true);
  // raccord à la Place de la Gare : on change de route en la traversant (world.js PLAZA, au même endroit sur les deux routes)
  ROAD3.zEnd = ROAD3.W.PLAZA.z + 4;
  JOINS.push({ a: ROAD1, za: jz, b: ROAD3, zb: 0, w: P.clone(), r: 350 });
  if (ROAD2) {
    ROAD2.zEnd = ROAD2.W.PLAZA.z;
    const G3 = group.localToWorld(RT3.worldVec(0, 0, ROAD3.zEnd, new THREE.Vector3()));
    JOINS.push({ a: ROAD2, za: ROAD2.zEnd, b: ROAD3, zb: ROAD3.zEnd, w: G3, r: 900 });
  }
  // Liaisons vers Limete (14e à 17e Rues, Av. de l'Aérodrome) : on passe d'une route à l'autre au point où elles se touchent
  for (const l of ROAD3.W.PL_LINKS) {
    const end = l.pts[l.pts.length - 1], w = group.localToWorld(RT3.worldVec(end[0], 0, end[1], new THREE.Vector3()));
    const stub = W1.PL_STUBS.find(q => q.key === l.key) ?? null;
    JOINS.push({ a: ROAD1, za: stub ? stub.b[1] : W1.Z_FORK_ - 46, b: ROAD3, zb: end[1], w, r: 420 });
    l.join = { end, stub, w };
  }
}
// ---------- Avenue de l'Université (routes.js `attachUni`) : elle prolonge son entrée sur le boulevard Sendwe ----------
if (CURRENT.attachUni && want('uni')) {
  ROAD4 = await loadRoad(CURRENT.attachUni.route);
  const { RT: RT4, group } = ROAD4, q = W1.UNI_STUB;
  const P = RT1.worldVec(q.b[0], 0, q.b[1], new THREE.Vector3()), dir = P.clone().sub(RT1.worldVec(q.a[0], 0, q.a[1], new THREE.Vector3()));
  const Q = RT4.worldVec(0, 0, 0, new THREE.Vector3()), d4 = RT4.worldVec(0, 0, -2, new THREE.Vector3()).sub(Q);
  ROAD4.rho = ang(dir) - ang(d4);
  group.rotation.y = ROAD4.rho;
  group.position.copy(P).sub(Q.applyAxisAngle(UP, ROAD4.rho));
  group.position.y = -0.03;
  group.updateMatrixWorld(true);
  JOINS.push({ a: ROAD1, za: q.b[1], b: ROAD4, zb: 0, w: P.clone(), r: 420 });
}
// ---------- By Pass (routes.js `attachBp`) : son tracé est déjà dans le repère de la scène (tools/bypass.py) ----------
if (CURRENT.attachBp && want('bp')) {
  ROAD5 = await loadRoad(CURRENT.attachBp.route);
  ROAD5.rho = 0;
  ROAD5.group.position.y = -0.025;
  ROAD5.group.updateMatrixWorld(true);
  const b = W1.BP_STUB, B = ROAD5.W.BP_JOIN, V = THREE.Vector3;
  JOINS.push({ a: ROAD1, za: b.b[1], b: ROAD5, zb: 0, w: RT1.worldVec(b.b[0], 0, b.b[1], new V()), r: 420 });
  if (ROAD4) {
    const U = ROAD4.W.UNI_JOIN;
    JOINS.push({ a: ROAD4, za: U.c[1], b: ROAD5, zb: B.z0, w: ROAD4.group.localToWorld(ROAD4.RT.worldVec(U.c[0], 0, U.c[1], new V())), r: 520 });
    JOINS.push({ a: ROAD4, za: U.kim[1], b: ROAD5, zb: B.kim[1], w: ROAD4.group.localToWorld(ROAD4.RT.worldVec(U.kim[0], 0, U.kim[1], new V())), r: 420 });
  }
}

// ---------- Avenue Kasa-Vubu (routes.js `attachKv`, l'auteur, 08/11) : branchée au croisement Sendwe / Triomphal (Pont-Cabu), au milieu de son tracé ----------
// Son point du croisement (kvJoin.s) est posé sur le centre du carrefour du trajet principal, et son axe suit son cap réel (extYaw : le prolongement
// après la fourche suit les caps réels d'OSM). De là, elle part vers la Gombe et vers Kintambo.
mark('routes attachées 2 en place');
const KV = { z1: 0, z6: 0, dir6: null, dir1: null };
if (CURRENT.attachKv && want('kv')) {
  ROAD6 = await loadRoad(CURRENT.attachKv.route);
  const { RT: RT6, group } = ROAD6, J = ROAD6.RT.ROUTE_DATA.extra.kvJoin, V = THREE.Vector3;
  KV.z1 = -RT1.toGame(CURRENT.ext.from + CURRENT.ext.b);       // centre du carrefour Kasa-Vubu sur le trajet principal
  KV.z6 = -RT6.toGame(J.s);
  const P = RT1.worldVec(0, 0, KV.z1, new V()), y = RT1.extYaw(J.bearing), dirW = new V(Math.sin(y), 0, -Math.cos(y));
  if (J.exact) {
    // (l'auteur, 08/11 : « fais d'abord le raccordement avec le 30 Juin et Kintambo ») tracé exact, déjà dans la scène (tools/kasavubu.py) : il passe
    // par le carrefour Pont-Cabu et arrive au bord du 30 Juin, à ses deux entrées « Avenue Kasa-Vubu » (Kintambo Magasin, Gombe)
    ROAD6.rho = 0;
    group.position.set(0, -0.02, 0);
  } else {
    const Q = RT6.worldVec(0, 0, KV.z6, new V()), d6 = RT6.worldVec(0, 0, KV.z6 - 2, new V()).sub(Q);
    ROAD6.rho = ang(dirW) - ang(d6);
    group.rotation.y = ROAD6.rho;
    group.position.copy(P).sub(Q.applyAxisAngle(UP, ROAD6.rho));
    group.position.y = -0.02;
  }
  group.updateMatrixWorld(true);
  KV.dir6 = group.localToWorld(RT6.worldVec(0, 0, KV.z6 - 2, new V())).sub(group.localToWorld(RT6.worldVec(0, 0, KV.z6 + 2, new V()))).normalize();
  KV.dir1 = RT1.worldVec(0, 0, KV.z1 - 2, new V()).sub(RT1.worldVec(0, 0, KV.z1 + 2, new V())).normalize();
  KV.P = P.clone();
  JOINS.push({ a: ROAD1, za: KV.z1, b: ROAD6, zb: KV.z6, w: P.clone(), r: 420 });
  // ses deux bouts, sur les entrées « Avenue Kasa-Vubu » du Boulevard du 30 Juin (Kintambo Magasin s = 25 m, Gombe s = 6 562 m, à droite)
  if (J.exact && ROAD2) {
    KV.zK2 = -ROAD2.RT.toGame(380); KV.zG2 = -ROAD2.RT.toGame(6562); KV.zEnd6 = -ROAD6.W.ROUTE_LEN;
    JOINS.push({ a: ROAD2, za: KV.zK2, b: ROAD6, zb: 0, w: group.localToWorld(RT6.worldVec(0, 0, 0, new V())), r: 420 });
    JOINS.push({ a: ROAD2, za: KV.zG2, b: ROAD6, zb: KV.zEnd6, w: group.localToWorld(RT6.worldVec(0, 0, KV.zEnd6, new V())), r: 420 });
  }
}
// ---------- Rocade Sud-Est (routes.js `attachRoc`) : tracé exact dans la scène (tools/rocade.py) ----------
// Son début est au bord droit de l'avenue de l'Université (avant le portail de l'UNIKIN), son bout au bord gauche du boulevard Lumumba, 900 m après
// l'aérogare (entrées « ROCADE SUD-EST » de routes.js, qui ne sont pas dessinées quand elle est chargée).
const ROC = {};
if (CURRENT.attachRoc && want('roc')) {
  [ROAD7, ROAD8] = await Promise.all([
    loadRoad(CURRENT.attachRoc.route),
    globalThis.TAXIKIN_MM ? loadRoad(CURRENT.attachMm.route) : Promise.resolve(null),
  ]);
  ROAD7.rho = 0;
  ROAD7.group.position.y = -0.02;
  ROAD7.group.updateMatrixWorld(true);
  const V = THREE.Vector3, q1 = W1.SIDE_ROADS_.find(r => r.roc);
  ROC.z1 = q1.z; ROC.zEnd7 = -ROAD7.W.ROUTE_LEN;
  JOINS.push({ a: ROAD1, za: ROC.z1, b: ROAD7, zb: ROC.zEnd7, w: RT1.worldVec(-ROAD_EDGE, 0, ROC.z1, new V()), r: 420 });
  if (ROAD4) {
    const q4 = ROAD4.W.SIDE_ROADS_.find(r => r.roc);
    ROC.z4 = q4.z;
    JOINS.push({ a: ROAD4, za: ROC.z4, b: ROAD7, zb: 0, w: ROAD7.RT.worldVec(0, 0, 0, new V()), r: 420 });
  }
}
// ---------- Première Entrée de N'djili → Rocade (routes.js `attachMm`) : tracé exact dans la scène (tools/mamamobutu.py) ----------
// Son début est au bord gauche du boulevard Lumumba (entrée « PREMIÈRE ENTRÉE », juste avant le Pont N'djili), son bout au bord droit de la
// Rocade, juste après Cecomaf (entrée « ROUTE DE NSANDA ») ; ces deux entrées ne sont pas dessinées quand elle est chargée.
const MM = {};
if (ROAD8) {
  ROAD8.rho = 0;
  ROAD8.group.position.y = -0.03;
  ROAD8.group.updateMatrixWorld(true);
  const V = THREE.Vector3;
  MM.z1 = W1.SIDE_ROADS_.find(r => r.mm).z; MM.z7 = ROAD7.W.SIDE_ROADS_.find(r => r.mm).z; MM.zEnd8 = -ROAD8.W.ROUTE_LEN;
  JOINS.push({ a: ROAD1, za: MM.z1, b: ROAD8, zb: 0, w: RT1.worldVec(-ROAD_EDGE, 0, MM.z1, new V()), r: 420 });
  JOINS.push({ a: ROAD7, za: MM.z7, b: ROAD8, zb: MM.zEnd8, w: ROAD8.RT.worldVec(0, 0, MM.zEnd8, new V()), r: 420 });
}
mark('routes attachées 3 en place');
const loadedRoads = new Set();
if (ROAD2) loadedRoads.add('30juin');
if (ROAD3) loadedRoads.add('pl');
if (ROAD4) loadedRoads.add('uni');
if (ROAD5) loadedRoads.add('bp');
if (ROAD6) loadedRoads.add('kv');
if (ROAD7) loadedRoads.add('roc');
if (ROAD8) loadedRoads.add('mm');
const MULTI = !!(ROAD2 || ROAD3 || ROAD4 || ROAD5 || ROAD6 || ROAD7 || ROAD8);   // (plusieurs routes : raccords et décor des autres routes)
const weakPc = (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator.deviceMemory ?? 8) <= 4;   // (collègues : PC modestes → départ en « Légers »)
let quality = isTouch || weakPc ? 'low' : 'high';
let renderScale = 1;                                    // (baisse automatique si l'image reste saccadée, voir frame())
$('sel-quality').value = (PARAMS.get('autostart') === '1' && store('quality')) || quality;

function applyQuality() {
  const high = quality === 'high';
  renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 2 : 1.25) * renderScale);
  renderer.shadowMap.enabled = high;
  ROAD1.world.sun.castShadow = high;
  fogFar = high ? 520 : 380;
  scene.fog.far = fogFar;
  retro.setQuality(high);
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  lunettes.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1.3 ? 72 : 62;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------- Objets du jeu ----------
// (l'auteur, 08/11 : « une fois que la personne monte, ce n'est plus la même personne ») : la moto du joueur garde sa couleur et le numéro de son conducteur
mark('qualité réglée');
let MOTO_LOOK = null;
const makeVehicle = (id, two = false) => {
  if (id === 'athlete') {
    const ch = new Character(outfit('man', {
      shirt: 0xd62828, pants: 0x1a1a1a, shoes: 0xf2f2f2, cap: 0xffffff,
      untucked: false, sandals: false, beard: false, height: 1.03, girth: 0.94, stride: 1.2,
    }));
    ch.mesh.userData.character = ch;
    ch.mesh.userData.L = 0.7;
    ch.mesh.userData.W = 0.65;
    return ch.mesh;
  }
  if (id === 'perso') return createCar({ color: 0x1e3a8a, taxi: false });   // (voiture personnelle : berline bleue, sans enseigne)
  if (id === 'bus') {
    const humain = hasModel('homme'), m = createMinibus({ top: 0x2a93cc, apprenti: !humain });   // (avec le corps MakeHuman, le receveur est animé : voir receveurCorps)
    rcv = humain ? newReceveur(m) : null;
    return m;
  }
  if (id !== 'moto') return createCar({ color: 0xf5c400, taxi: true });
  const m = createMoto({ riders: two ? 2 : 1, look: MOTO_LOOK });
  MOTO_LOOK ??= m.userData.look;
  return m;
};
// Le receveur du bus du joueur (corps MakeHuman animé, 22/11 : « il peut faire des mouvements, il peut descendre et monter ») : debout sur le marchepied, il appelle les clients ;
// quand le bus s'arrête pour faire monter ou descendre des clients, il descend sur la chaussée, appelle, puis remonte dès que le bus repart
let rcv = null;
const RCV = { step: null, ground: null };
function newReceveur(bus) {
  const W = bus.userData.W;
  const ch = new Character(outfit('man', receveurTenue([0xf2c200, 0xf4f4f4, 0x1d4fa0, 0x2b8a3e][Math.floor(Math.random() * 4)])));
  RCV.step = new THREE.Vector3(...RECEVEUR_POSTE.pos);
  RCV.yaw = RECEVEUR_POSTE.yaw;
  RCV.ground = new THREE.Vector3(W / 2 + 1.1, 0, 0.45);
  ch.mesh.position.copy(RCV.step);
  ch.mesh.rotation.y = RCV.yaw;
  bus.add(ch.mesh);
  return { ch, st: 'on', k: 0, t: 0, idle: 0, grip: ch.outfit.grip };
}
/** Chaque image : le receveur sur le marchepied, en train de descendre, dehors ou en train de remonter. */
function receveurCorps(dt) {
  if (!rcv) return;
  const R = rcv, m = R.ch.mesh, sp = Math.abs(taxi.speed), serving = /montent|descendent/.test(passengers.prompt) && sp < 1;
  R.t += dt;
  if (R.st === 'on') {
    if (serving) { R.st = 'down'; R.k = 0; }
    else { R.ch.pose('call', R.t); m.position.copy(RCV.step); m.rotation.y = RCV.yaw; R.ch.outfit.grip = R.grip; }
  } else if (R.st === 'down' || R.st === 'up') {
    if (sp > 2.5) { R.st = 'on'; R.k = 0; return; }                  // (le bus repart : il saute à bord)
    const dir = R.st === 'down' ? 1 : -1;
    R.k = Math.min(1, Math.max(0, R.k + dir * dt / 0.9));
    m.position.lerpVectors(RCV.step, RCV.ground, R.k);
    m.rotation.y = RCV.yaw + (-Math.PI / 2 - RCV.yaw) * R.k;
    R.ch.pose('walk', R.t, 1.3);
    if (R.st === 'down' && R.k >= 1) { R.st = 'out'; R.idle = 0; }
    else if (R.st === 'up' && R.k <= 0) R.st = 'on';
  } else {                                                           // dehors : il appelle les clients ; il remonte quand tout le monde est monté ou descendu
    R.idle = serving || sp < 0.5 && /Arrête|Réponds|Complet/.test(passengers.prompt) ? 0 : R.idle + dt;
    m.position.copy(RCV.ground); m.rotation.y = -Math.PI / 2;
    R.ch.outfit.grip = null;                                         // (dehors : plus de barre à tenir)
    R.ch.pose('call', R.t);
    if (R.idle > 1.2 || sp > 1.5) { R.st = 'up'; R.k = 1; }
  }
}
/** Les 207 de la circulation proches du joueur : leur receveur s'anime (les autres restent figés, pour ne pas alourdir le jeu). */
function receveursProches() {
  for (const v of A.traffic.list) {
    const g = v.mesh;
    if (!g?.userData.receveurStatic) continue;
    const ch = setReceveurLive(g, g.visible && Math.abs(v.z - taxi.z) < 40);
    if (ch) ch.pose('call', G.time);
  }
}
let taxiMesh = makeVehicle(VEH_ID);
scene.add(camera);                               // (le poste de conduite de la vue intérieure est accroché à la caméra)
let cockpit = buildCockpit(VEH_ID);
camera.add(cockpit.group);
taxiMesh.rotation.order = 'YXZ';
scene.add(taxiMesh);
// Le faisceau des phares du joueur (nuit.js) : posé chaque image à la place du véhicule, dans le groupe de sa route ; visible aussi en vue intérieure
let beam = makeBeam(VEH.l, VEH.w);
scene.add(beam);
// La cabine (cabine.js, vue CAM n° 3) : l'intérieur du véhicule, posé comme lui ; les clients à bord y sont assis, le prédicateur debout
let cabin = buildCabin(VEH_ID);
scene.add(cabin.group);
const camModes = () => (VEH_ID === 'moto' || VEH_ID === 'athlete' ? 2 : 3);     // extérieur, poste de conduite, cabine (pas de cabine sur la moto ni pour l'athlète)
const cycleCam = () => { G.cam = (G.cam + 1) % camModes(); };
/** Change de véhicule (menu) : son modèle, sa vitesse, sa taille, le versement. */
let motoTwo = false;
function setVehicle(id, two = false) {
  VEH_ID = id; VEH = VEHICULES[id]; MAX_FWD = VEH.max;
  if (IT) VERSEMENT = VEH.versement;
  motoTwo = two;
  if (!worldReady) return;
  if (IT) Object.assign(BOARD, { cap: VEH.places, fare: VEH.fare, groupMax: GROUP_MAX[id] });
  const parent = taxiMesh.parent;
  parent?.remove(taxiMesh);
  taxiMesh = makeVehicle(id, two);
  camera.remove(cockpit.group);
  cockpit = buildCockpit(id);
  camera.add(cockpit.group);
  taxiMesh.rotation.order = 'YXZ';
  (parent ?? scene).add(taxiMesh);
  beam.parent?.remove(beam);
  beam = makeBeam(VEH.l, VEH.w);
  setBeam(beam, nightK);
  (parent ?? scene).add(beam);
  cabinClear();
  cabin.group.parent?.remove(cabin.group);
  cabin = buildCabin(id);
  (parent ?? scene).add(cabin.group);
  if (G.cam >= camModes()) G.cam = 0;
}
let selectedStart = new URLSearchParams(location.search).get('start') || CURRENT.startAt || 'sendwe';
function startCoords() {
  const params = new URLSearchParams(location.search);
  const sParam = Number(params.get('s'));
  const zParam = Number(params.get('z'));
  const xParam = Number(params.get('x'));
  if (!CURRENT.ext && selectedStart !== 'airport') selectedStart = 'start';   // (départs nommés : trajet principal seulement)
  const defS = selectedStart === 'airport' || selectedStart === 'start' ? (CURRENT.ext ? 45 : 25)
    : selectedStart === 'triomphal' ? 18995
    : selectedStart === '24nov' ? 21120
    : selectedStart === 'mandela' ? 23900
    : CURRENT.ext ? CURRENT.ext.from - 20 : 25;
  const z = zParam < 0 ? zParam : (sParam > 0 ? -toGame(sParam) : -toGame(defS));
  const x = Math.abs(xParam) > MEDIAN ? xParam : LANE_R;   // (x < 0 : côté gauche)
  return { x, z };
}
// level : sur un saut-de-mouton, 'up' (rampe) ou 'down' (voies du bas), choisi en y entrant
mark('véhicule, cockpit, cabine créés');
const taxi = { ...startCoords(), heading: 0, speed: 0, steer: 0, level: null, y: 0 };

const DAY = { urgent: 0 };                       // (partagé par la circulation de toutes les routes)
// Le chargement du véhicule (taxi collectif) : partagé par les clients de toutes les routes, les clients restent à bord d'une route à l'autre
const GROUP_MAX = { berline: 2, bus: 4, moto: 1, perso: 1, athlete: 1 };
const BOARD = IT ? newBoard(VEH.places, VEH.fare, GROUP_MAX[VEH_ID]) : newBoard();
for (const r of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) {
  if (!r) continue;
  mark('vie de la route : début');
  r.traffic = new r.Traffic(r.group);
  mark('  circulation créée');
  r.traffic.day = DAY;
  r.glow = new NightGlow(r.group);             // (nuit : halos des phares et des feux de sa circulation)
  mark('  lueurs de nuit créées');
  r.passengers = new r.Passengers(r.group);
  mark('  clients créés');
  r.passengers.board = BOARD;
  r.life = new r.StreetLife(r.group);
  mark('  piétons créés');
  r.traffic.peds = r.life.crossers;
  r.life.traffic = r.traffic;                   // (l'auteur, 13/11 : les piétons attendent les véhicules, contournent les clients)
  r.life.passengers = r.passengers;
  r.qlife = new QuartierLife(r.group, r.W.quartierPaths?.() ?? [], r.W.quartierRoads?.() ?? []);   // (l'auteur, 14/11 : les gens, les motos et les voitures des quartiers)
}
mark('vie de toutes les routes créée');
let A = ROAD1;                                   // route où roule le taxi
let { traffic, passengers, life } = ROAD1;
const input = new Input();
let hud = new Hud();
const sound = new Sound();
const radio = new Radio();
if (isTouch) input.bindTouch();

const G = {
  state: 'menu', time: 0, minutes: 360, fuel: FUEL_START,
  fares: 0, tips: 0, fuelCost: 0, repairs: 0, fines: 0, rides: 0, crashes: 0,
  cash: 0, prompt: '', crashCd: 0, wallCd: 0, brakeHold: 0, cam: 0, fuelWarned: false,
};

// ---------- États ----------
const screens = { menu: $('menu'), pause: $('pause'), end: $('end') };
function show(name) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  const playing = name === 'play';
  if (playing) document.documentElement.classList.remove('boot');       // (écran d'attente de jeu.html)
  if (playing) mark('écran de jeu affiché');
  $('hud').hidden = !(playing || name === 'pause');
  $('touch').hidden = !(isTouch && playing);
  retro.rect = null;                             // (le cadre du rétroviseur se remesure quand le HUD apparaît)
  $('more').hidden = true;
  $('btn-more').setAttribute('aria-expanded', 'false');
}

const ROADS = { 1: ROAD1, 2: ROAD2, 3: ROAD3, 4: ROAD4, 5: ROAD5, 6: ROAD6, 7: ROAD7, 8: ROAD8 };
/** Un point d'itinéraire : route, z, et le cap (0 : vers -z, chaussée de droite ; π : vers +z, chaussée de gauche) pour la marche `dir`. */
function itPoint(P, dir) {
  const road = ROADS[P.road] ?? ROAD1, W = road.W, RT = road.RT;
  if (P.at === 'bktf' || P.at === 'siforco') {
    const into = P.at === 'bktf' ? dir < 0 : dir > 0;
    const m = W.masinaPose(P.at, into);
    return { road, x: m.x, z: m.z, heading: m.heading, dir };
  }
  const z = P.s !== undefined ? -RT.toGame(P.s)
    : P.at === 'sendwe' ? -RT.toGame(CURRENT.ext.from - 20)
    : P.at === 'plaza' ? road.zEnd + (dir > 0 ? 0 : 22)
    : P.at === 'campus' ? RT.ROUTE_DATA.extra.campus.gate + 12
    : P.at === 'bpStart' ? -25
    : P.at === 'ngaba' ? W.BP_JOIN.z0 + 12 : 0;
  return { road, z, x: dir > 0 ? W.LANE_R : -W.LANE_R, heading: dir > 0 ? 0 : Math.PI, dir };
}
/** Les deux bouts du trajet dans le sens choisi : départ (from) et arrivée (to), avec le sens de la marche à chacun. */
function legs(sens = SENS) {
  const at = (P, dir, end) => ({ ...P, dir, s: (end ? P.endS : P.startS) ?? P.s, name: (end ? P.endName : P.startName) ?? P.name });
  return sens === 'retour' ? { from: at(IT.B, -IT.B.dir, false), to: at(IT.A, -IT.A.dir, true) } : { from: at(IT.A, IT.A.dir, false), to: at(IT.B, IT.B.dir, true) };
}
function startItinerary() {
  hintDone = false;
  const { from } = legs(), p = itPoint(from, from.dir);
  if (p.road !== ROAD1) switchRoad(p.road, p.x, p.z, p.heading, false, from.name);
  else Object.assign(taxi, { x: p.x, z: p.z, heading: p.heading });
}
// ---------- Mode Course ----------
/** Grille de départ : le joueur sur la voie de droite, trois adversaires à côté et derrière ; pas de clients ; la mise est payée. */
function startRace() {
  const C = COURSES[VEH_ID] ?? COURSES.berline, L = legs(), start = itPoint(L.from, 1), fin = itPoint(L.to, 1);
  for (const c of passengers.clients) { c.state = 'empty'; c.root.visible = false; }
  hud.setClients([]);
  const W = A.W, lanes = W.LANE_X;
  taxi.x = lanes[0];
  let rIdx = 0;
  const rShirts = [0x1d4fa0, 0xe0a100, 0x2b8a3e];
  traffic.addRacers(VEH_ID === 'moto' || VEH_ID === 'athlete' ? 'moto' : 'taxi', C.rivals, taxi.z, VEH.max, () => {
    if (VEH_ID === 'athlete') {
      const ch = new Character(outfit('man', {
        shirt: rShirts[rIdx++ % rShirts.length], pants: 0x1a1a1a, shoes: 0xf2f2f2,
        untucked: false, sandals: false, beard: false, height: 1.01, girth: 0.92, stride: 1.18,
      }));
      ch.mesh.userData.character = ch;
      ch.mesh.userData.L = 0.7;
      ch.mesh.userData.W = 0.65;
      return ch.mesh;
    }
    return VEH_ID === 'moto' ? createMoto({ riders: 1 }) : createCar({ color: 0xf5c400, taxi: true, roof: false });
  });
  for (const v of traffic.list) if (!v.racer && v.side === 1 && v.z < taxi.z && v.z > taxi.z - 120) v.z -= 150;   // (la ligne de départ est dégagée)
  for (const v of traffic.list) if (!v.racer) traffic.unstack(v, taxi);                                              // (l'auteur, 13/11 : jamais l'un sur l'autre)
  // aller-retour : demi-tour au bout, arrivée au point de départ ; deux fois plus long, la mise et le prix montent
  const ar = RACE_AR, mise = ar ? Math.round(C.mise * 1.5) : C.mise, prix = ar ? C.prix * 2 : C.prix;
  G.race = { t: -3.5, z0: start.z, zf: fin.z, to: L.to.name, from: L.from.name, ar, leg: 1, len: (start.z - fin.z) * (ar ? 2 : 1), total: 4, pos: 4, left: (start.z - fin.z) * (ar ? 2 : 1), progress: 0, results: [], mise, prix };
  G.mise = mise;
  $('countdown').hidden = false;
}
function updateRace(dt) {
  const R = G.race;
  const before = R.t;
  R.t += dt;
  if (R.t < 0) {                                   // compte à rebours : tout le monde attend
    taxi.speed = 0;
    traffic.raceFrozen = true;
    const n = Math.ceil(-R.t);
    $('countdown').textContent = n > 3 ? '' : String(n);
    return;
  }
  if (before < 0) { traffic.raceFrozen = false; $('countdown').textContent = 'Partez !'; sound.ding(); }
  if (R.t > 1.2) $('countdown').hidden = true;
  const half = R.z0 - R.zf, LX = A.W.LANE_X;
  for (const [k, v] of traffic.racers.entries()) {
    if (v.racer.done) continue;
    if (v.side === 1 && v.z <= R.zf) {
      if (R.ar) { v.side = -1; v.x = v.targetX = -LX[k % LX.length]; v.speed = Math.min(v.speed, 5); continue; }   // (demi-tour au bout)
    } else if (!(R.ar && v.side === -1 && v.z >= R.z0)) continue;
    v.racer.done = true; v.racer.time = R.t; R.results.push({ name: v.racer.name, time: R.t });
  }
  // le joueur au bout de l'aller : demi-tour sur l'autre chaussée, retour vers le départ
  if (R.ar && R.leg === 1 && taxi.z <= R.zf) {
    R.leg = 2;
    Object.assign(taxi, { x: -A.W.LANE_R, z: R.zf, heading: Math.PI, speed: Math.min(taxi.speed, 5), level: null });
    updateCamera(0, true);
    R.to = R.from;
    hud.toast(`Demi-tour ! Retour vers ${R.from} !`, 3);
    sound.ding();
  }
  const done = v => (v.side === -1 ? half + (v.z - R.zf) : R.z0 - v.z);   // (distance faite depuis le départ)
  const me = R.leg === 2 ? half + (taxi.z - R.zf) : R.z0 - taxi.z;
  R.left = Math.max(0, R.len - me);
  R.progress = clamp(me / R.len, 0, 1);
  R.pos = 1 + R.results.length + traffic.racers.filter(v => !v.racer.done && done(v) > me).length;
}
/** Le joueur a-t-il passé la ligne d'arrivée de la course ? */
const raceOver = () => (G.race.ar ? G.race.leg === 2 && taxi.z >= G.race.z0 : taxi.z <= G.race.zf);
/** Le joueur passe la ligne d'arrivée : classement, gain. */
function finishRace() {
  const R = G.race, rank = R.results.length + 1;
  R.rank = rank;
  R.gain = rank === 1 ? R.prix : rank === 2 ? R.mise : 0;
  G.fares += R.gain;
  const rest = traffic.racers.filter(v => !v.racer.done).sort((a, b) => a.z - b.z).map(v => ({ name: v.racer.name, time: null }));
  R.board = [...R.results, { name: 'Toi', time: R.t, me: true }, ...rest];
  endShift('course');
}

/** Conseils de route aux embranchements selon la ligne ou la variante choisie (By Pass, Poids Lourds, Première Entrée N'djili). */
let hintDone = false;
function itineraryHints() {
  if (hintDone || !IT) return;
  if (ROAD5 && A === ROAD1 && SENS === (IT.A.road === 5 ? 'retour' : 'aller') && IT.roads.includes('bp') && Math.cos(taxi.heading) >= 0.5) {
    const z0 = W1.BP_STUB.pts[0][1];
    if (taxi.x > 0 && taxi.z < z0 + 450 && taxi.z > z0) {
      hintDone = true;
      hud.toast('Pour le By Pass : passe l\'Échangeur, fais demi-tour à la première ouverture (200 m), reviens et tourne à droite.', 7);
    }
  } else if (ROAD3 && A === ROAD1 && SENS === 'aller' && IT.variant === 'poidslourds' && Math.cos(taxi.heading) >= 0.5) {
    const zMat = -RT1.toGame(11800);
    if (taxi.x > 0 && taxi.z < zMat + 420 && taxi.z > zMat) {
      hintDone = true;
      hud.toast('Variante Poids Lourds : reste à droite au Pont Matete pour t\'engager sur la Route Poids Lourds vers la Gare Centrale.', 6.5);
    }
  } else if (ROAD8 && A === ROAD7 && SENS === 'aller' && IT.variant === 'quartier1' && Math.cos(taxi.heading) >= 0.5) {
    if (taxi.x > 0 && taxi.z < MM.z7 + 380 && taxi.z > MM.z7) {
      hintDone = true;
      hud.toast('Direction Quartier 1 N\'djili : à Cecomaf, tourne à droite sur la Route de Nsanda (Première Entrée).', 6.5);
    }
  }
}
/** Terminus (l'auteur, 07/11 : « il laisse le client et il prend les autres pour le ramener ») : les clients descendent, le véhicule fait demi-tour
 *  sur l'autre chaussée et repart dans l'autre sens ; la journée continue jusqu'à 18 h. */
function terminus() {
  const { to } = legs();
  passengers.payAll(callbacks);
  preacher.leave(true);
  if (VEH_ID === 'moto' && motoTwo) setVehicle('moto', false);
  G.tours = (G.tours ?? 0) + 1;
  SENS = SENS === 'retour' ? 'aller' : 'retour';
  const L = legs(), E = SENS === 'retour' ? IT.B : IT.A;
  // (l'auteur, 13/11 : « pas de saut ») : si le bout a un point de demi-tour (turnS : Entrée Siforco à Masina), on reste où l'on est, on roule soi-même
  // jusque-là, on fait demi-tour, et le retour commence à ce point ; sinon, comme avant, le véhicule est mis sur l'autre chaussée
  const from = E.turnS !== undefined ? { ...L.from, s: E.turnS, name: E.turnName ?? L.from.name } : L.from, p = itPoint(from, from.dir);
  if (E.turnS !== undefined && p.road === A) { G.depart = { z: p.z, dir: from.dir, name: from.name, road: A }; taxi.speed = 0; }
  else if (p.road !== A) switchRoad(p.road, p.x, p.z, p.heading, false, to.name);
  else { Object.assign(taxi, { x: p.x, z: p.z, heading: p.heading, speed: 0, level: null }); traffic.reset(taxi); life.reset(taxi.z); }
  taxi.speed = 0;
  passengers.reset();
  hud.setClients(passengers.clients);
  updateCamera(0, true);
  hintDone = false;
  G.terminus = legs().to.name;
  hud.toast(G.depart ? `Terminus : ${to.name} ! Continue jusqu'à ${from.name}, fais demi-tour et reprends des clients vers ${legs().to.name}.` : `Terminus : ${to.name} ! Demi-tour : en route vers ${legs().to.name}.`, 6);
}
/** Après le terminus : on roule jusqu'au point de demi-tour (G.depart), puis on repart dans l'autre sens. */
function departHint() {
  const D = G.depart;
  if (!D || A !== D.road) return;
  const rem = (D.z - taxi.z) * D.dir;                           // (> 0 : le point est encore devant, dans l'ancien sens)
  if (rem > -30 && rem < 450) G.prompt ||= `Demi-tour à ${D.name} pour reprendre des clients`;
  if (Math.cos(taxi.heading) * D.dir > 0.5 && Math.abs(taxi.speed) > 1 && rem < 60) G.depart = null;   // (tourné dans le nouveau sens : c'est reparti)
}
// ---------- L'arrivée au terminus (l'auteur, 08/11) : le véhicule s'arrête à l'arrêt, tout le monde descend (« Tosuki awa ! ») ; avant, le
// receveur du 207 fait passer l'argent (« Bosangisela ngai mbongo banc par banc ») ; aller simple : la partie finit là ; aller-retour : on
// repart, et la partie finit au terminus du retour ----------
const termMarker = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 40, 18, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x3ccf6e, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false }));
termMarker.visible = false;
scene.add(termMarker);
const resolveTo = to => (to.at === 'plaza' && (A === ROAD2 || A === ROAD3) && ROADS[A === ROAD3 ? 3 : 2] ? { ...to, road: A === ROAD3 ? 3 : 2 } : to);
function terminusStop(dt) {
  const L = legs(), to = resolveTo(L.to), p = itPoint(to, to.dir);
  if (A !== p.road) { termMarker.visible = false; return; }
  const ahead = (taxi.z - p.z) * (L.to.dir > 0 ? 1 : -1);         // > 0 : avant le terminus
  termMarker.visible = ahead < 350 && ahead > -40;
  if (termMarker.visible) { p.road.group.localToWorld(p.road.RT.worldVec(p.x, 20, p.z, termMarker.position)); }
  // le receveur fait passer l'argent, un peu avant
  if (VEH_ID === 'bus' && !G.saidBosa && BOARD.riders.length && ahead < 450 && ahead > 80) {
    G.saidBosa = true;
    say('Bosangisela ngai mbongo banc par banc ! — Faites passer l’argent, banc par banc !', 'receveur', 4.5);
    if (!(VOIX.includes('receveur-bosangisela') && sound.clip('receveur-bosangisela', { vol: 1 }))) sound.voice('Bosangisela ngai mbongo, banc par banc !', { pitch: 1.2, rate: 1.1 });
  }
  if (G.termStop) {                                                // arrêtés : les clients descendent
    taxi.speed = 0;
    G.prompt = `Terminus ${L.to.name} : tout le monde descend…`;
    if ((G.termStop.t -= dt) <= 0) { G.termStop = null; finishLeg(); }
    return;
  }
  if (ahead < 25 && ahead > -40) {
    G.prompt ||= `Terminus ${L.to.name} : arrête-toi`;
    if (Math.abs(taxi.speed) < 1) {
      G.termStop = { t: 3.5 };
      passengers.alightAll(callbacks);
      if (VEH_ID === 'bus') { say('Tosuki awa ! — On est arrivés !', 'receveur', 3); if (!(VOIX.includes('receveur-tosuki') && sound.clip('receveur-tosuki', { vol: 1 }))) sound.voice('Tosuki awa !', { pitch: 1.2, rate: 1.05 }); }
      else say('Tosuki ! Matondo chauffeur. — On est arrivés, merci !', 'client', 3);
    }
  } else if (ahead <= -40) finishLeg();                            // (dépassé sans s'arrêter)
}
/** Fin d'un trajet : aller simple ou retour fait → fin de la partie ; sinon demi-tour pour le retour. */
function finishLeg() {
  termMarker.visible = false;
  if (TRIP !== 'ar' || G.leg >= 2) { passengers.payAll(callbacks); endShift('arrive'); return; }
  G.leg = 2;
  G.saidBosa = false;
  terminus();
  // (l'auteur, 08/11 : au terminus, le receveur appelle aussitôt les clients du retour : « Pascal Kingasani ! »…)
  if (VEH_ID === 'bus') { sound.stopClip(); receveurCall(); }
}
/** Arrivé ? (sur la route de l'arrivée, passé son repère dans le sens de la marche) */
function arrived() {
  const { to } = legs(), t = resolveTo(to), p = itPoint(t, t.dir);
  return A === p.road && (t.dir > 0 ? taxi.z <= p.z : taxi.z >= p.z);
}

// ---------- Le panneau de l'itinéraire, à gauche (l'auteur, 08/11 : « à côté gauche il faut toujours montrer l'itinéraire, la situation des avenues qu'il passe ») ----------
const fmtDist = m => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const placeName = n => n.replace(/^Arrêt /, '');
/** L'avenue où roule le véhicule. */
function avenueName() {
  if (A === ROAD1 && W1.plBandU?.(taxi.x, taxi.z) >= 0) return 'Route Poids Lourds';
  const masName = A === ROAD1 && W1.masinaRoadName?.(taxi.x, taxi.z);
  if (masName) return masName;
  const mobName = A === ROAD1 && W1.mobomaRoadName?.(taxi.x, taxi.z);   // (Kingasani, l'Entrée Moboma)
  if (mobName) return mobName;
  if (A === ROAD1 && CURRENT.id === 'lumumba') return CURRENT.ext && taxi.z < -RT1.toGame(CURRENT.ext.from) ? 'Bd Sendwe · Triomphal · Libération' : 'Boulevard Lumumba';
  return A.title ?? '';
}
let itinT = 0;
const itinT0 = { road: null, z: 0, fwd: 0 };
$('itin').addEventListener('click', () => $('itin').classList.toggle('small'));
function updateItin(dt) {
  const el = $('itin'), show = !!IT && (G.state === 'play' || G.state === 'pause');
  if (el.hidden !== !show) el.hidden = !show;
  if (!show || (itinT -= dt) > 0) return;
  itinT = 0.4;
  el.classList.toggle('no-course', $('course').hidden);
  // le sens de la marche se lit sur le déplacement en z (sur les routes en biais, le cap ne suffit pas) ; à l'arrêt, sur le cap
  if (itinT0.road !== A || Math.abs(taxi.z - itinT0.z) > 40) { itinT0.road = A; itinT0.z = taxi.z; }
  else if (Math.abs(taxi.z - itinT0.z) > 6) { itinT0.fwd = Math.sign(taxi.z - itinT0.z); itinT0.z = taxi.z; }
  if (Math.abs(taxi.speed) < 0.5 || !itinT0.fwd) itinT0.fwd = Math.cos(taxi.heading) >= 0 ? -1 : 1;
  const L = legs(), fwd = itinT0.fwd, end = itPoint(L.to, L.to.dir);
  const endAhead = end.road === A && (end.z - taxi.z) * fwd > 0;
  $('itin-title').textContent = `${L.from.cri} → ${L.to.cri}`;
  $('itin-sens').textContent = G.race ? '🏁 Course' : `${SENS === 'retour' ? 'Retour' : 'Aller'}${G.tours ? ` · tour ${G.tours + 1}` : ''}`;
  $('itin-road').textContent = avenueName();
  // où l'on est : la zone de foule, sinon le dernier lieu passé
  const lms = (A.W.LANDMARKS ?? []).filter(l => !endAhead || (l.z - end.z) * fwd < -30);
  const crowd = (A.W.CROWDS ?? []).find(c => taxi.z < c.z0 && taxi.z > c.z1);
  const passed = lms.filter(l => (l.z - taxi.z) * fwd <= 0).sort((a, b) => Math.abs(a.z - taxi.z) - Math.abs(b.z - taxi.z))[0];
  $('itin-near').textContent = crowd ? `📍 ${crowd.name}` : passed && Math.abs(passed.z - taxi.z) < 900 ? `📍 Après ${placeName(passed.name)}` : '';
  // les prochains lieux, puis le terminus
  const ahead = lms.filter(l => (l.z - taxi.z) * fwd > 15).sort((a, b) => Math.abs(a.z - taxi.z) - Math.abs(b.z - taxi.z)).slice(0, 3);
  const rows = ahead.map(l => `<li><span>${placeName(l.name)}</span><span>${fmtDist(Math.abs(l.z - taxi.z))}</span></li>`);
  rows.push(`<li class="end"><span>${G.race ? '🏁' : 'Terminus'} ${L.to.name}</span><span>${endAhead ? fmtDist(Math.abs(end.z - taxi.z)) : ''}</span></li>`);
  const html = rows.join('');
  if (el.dataset.html !== html) { el.dataset.html = html; $('itin-next').innerHTML = html; }
}

function startShift() {
  if (IT && (IT.route !== CURRENT.id || IT.roads.some(r => !loadedRoads.has(r)))) {
    const url = new URL(location.href);
    url.searchParams.set('route', IT.route);
    url.searchParams.set('trajet', IT.id);
    if (IT.variant) url.searchParams.set('var', IT.variant); else url.searchParams.delete('var');
    url.searchParams.set('sens', SENS);
    url.searchParams.set('veh', VEH_ID);
    url.searchParams.set('autostart', '1');
    for (const k of ['z', 's', 'x', 'start', 'att', 'pl', 'uni', 'bp', 'kv', 'roc', 'mm']) url.searchParams.delete(k);
    $('btn-start').disabled = true;
    $('btn-start').textContent = '⏳ Chargement du trajet…';
    location.href = url.href;
    return;
  }
  quality = $('sel-quality').value;
  applyQuality();
  Object.assign(G, {
    state: 'play', time: 0, minutes: 360, fuel: FUEL_START,
    fares: 0, tips: 0, fuelCost: 0, repairs: 0, fines: 0, rides: 0, crashes: 0,
    cash: 0, prompt: '', crashCd: 0, wallCd: 0, brakeHold: 0, fuelWarned: false, police: null, wrongT: 0, tours: 0, ambulance: false, accident: null, race: null, mise: 0, hitRun: null, caughtRun: false,
    stolen: 0, held: false, choiceCb: null, lastSermon: -1e9, km: 0, depart: null,
  });
  incidents.finish();
  $('choice').hidden = true;
  rain.planDay(SHIFT_SECONDS);
  // (l'auteur, 14/11 : « le chantier ne doit pas être à chaque course, c'est aléatoire ») : le tirage des chantiers de la journée (test : ?travaux=1)
  // (l'auteur, 20/11 : l'embouteillage de Pascal au Quartier 1 n'a pas lieu à chaque course : 8 fois sur 10)
  let bouchon = false;
  for (const r of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) if (r?.W.randomizeJams) bouchon = r.W.randomizeJams().some(j => j.lvl > 1) || bouchon;
  if (PARAMS.get('bouchon')) for (const r of [ROAD1]) r.W.JAMS.forEach(j => { j.on = PARAMS.get('bouchon') !== '0'; });
  if (bouchon) setTimeout(() => { if (G.state === 'play') hud.note('📻 Embouteillage signalé de Pascal au Quartier 1 aujourd’hui', 2); }, 4000);
  for (const r of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) if (r?.W.randomizeWorks) { r.W.randomizeWorks(); if (PARAMS.get('travaux')) r.W.WORKS.forEach(Wk => { Wk.on = true; for (const m of Wk.meshes) m.visible = true; }); }
  worksWarned.clear();
  if (PARAMS.get('pluie')) rain.startNow(Number(PARAMS.get('pluie')) || 400);   // (test : ?pluie=1)
  DAY.urgent = 1 + Math.floor(Math.random() * 2);   // (une ou deux ambulances en urgence sans accident, sur toute la journée)
  // Test : ?z=-1600 ou ?s=4000 démarre directement à cette position du boulevard
  if (A !== ROAD1) switchRoad(ROAD1, 0, 0, 0, true);
  Object.assign(taxi, { ...startCoords(), heading: 0, speed: 0, steer: 0, level: null, y: 0 });
  flyWarned.clear();
  ROAD2?.passengers.reset();
  ROAD3?.passengers.reset();
  ROAD4?.passengers.reset();
  ROAD5?.passengers.reset();
  ROAD6?.passengers.reset();
  ROAD7?.passengers.reset();
  ROAD8?.passengers.reset();
  // Test : ?att=5000 démarre sur le trajet attaché (Boulevard du 30 Juin), à s = 5 000 m, vers la Gare
  const att = Number(new URLSearchParams(location.search).get('att'));
  if (ROAD2 && att > 0) switchRoad(ROAD2, LANE_R, -ROAD2.RT.toGame(att), 0);
  // Test : ?pl=3000 démarre sur la Route Poids Lourds, à s = 3 000 m de son début
  const pl = Number(new URLSearchParams(location.search).get('pl'));
  if (ROAD3 && pl > 0) switchRoad(ROAD3, ROAD3.W.LANE_R, -ROAD3.RT.toGame(pl), 0);
  // Test : ?uni=3000 démarre sur l'avenue de l'Université, à s = 3 000 m de son début
  const uni = Number(new URLSearchParams(location.search).get('uni'));
  if (ROAD4 && uni > 0) switchRoad(ROAD4, ROAD4.W.LANE_R, -ROAD4.RT.toGame(uni), 0);
  // Test : ?bp=3000 démarre sur le By Pass, à s = 3 000 m de son début (?bp=-25 : face à la fourche de Lumumba)
  const bp = Number(new URLSearchParams(location.search).get('bp'));
  if (ROAD5 && bp) { const ret = bp < 0 || PARAMS.get('sens') === 'retour'; switchRoad(ROAD5, (ret ? -1 : 1) * ROAD5.W.LANE_R, -ROAD5.RT.toGame(Math.abs(bp)), ret ? Math.PI : 0); }
  // Test : ?kv=3000 démarre sur l'avenue Kasa-Vubu, à s = 3 000 m de Kintambo Magasin
  const kv = Number(new URLSearchParams(location.search).get('kv'));
  if (ROAD6 && kv > 0) switchRoad(ROAD6, ROAD6.W.LANE_R, -ROAD6.RT.toGame(kv), 0);
  // Test : ?roc=3000 démarre sur la Rocade Sud-Est, à s = 3 000 m de l'UNIKIN
  const roc = Number(new URLSearchParams(location.search).get('roc'));
  if (ROAD7 && roc > 0) switchRoad(ROAD7, ROAD7.W.LANE_R, -ROAD7.RT.toGame(roc), 0);
  // Test : ?mm=1000 démarre sur la Première Entrée (Route Mama Mobutu), à s = 1 000 m du boulevard Lumumba
  const mm = Number(new URLSearchParams(location.search).get('mm'));
  if (ROAD8 && mm > 0) switchRoad(ROAD8, ROAD8.W.LANE_R, -ROAD8.RT.toGame(mm), 0);
  // Test : ?essai=policier pose les deux policiers d'essai devant le taxi, sur le bas-côté (voir essai.js)
  if (new URLSearchParams(location.search).get('essai') === 'policier') import('./essai.js').then(m => m.start(scene, A, taxi));
  if (new URLSearchParams(location.search).get('essai') === 'voitures') import('./essai.js').then(m => m.startCars(scene, A, taxi));
  if (new URLSearchParams(location.search).get('essai') === 'personnages') import('./essai.js').then(m => m.startPeople(scene, A, taxi));
  if (IT && MODE === 'course') { if (VEH_ID === 'bus') setVehicle('berline'); SENS = 'aller'; }
  if (IT) { startItinerary(); BOARD.riders.length = 0; BOARD.extra = 0; BOARD.comfort = 100; G.terminus = legs().to.name; if (motoTwo) setVehicle('moto', false); }
  Object.assign(G, { leg: 1, termStop: null, saidBosa: false });
  $('choice').hidden = true;
  passengers.reset();
  traffic.reset(taxi);
  life.reset(taxi.z);
  hud.setClients(passengers.clients);
  hud.hideToast();
  G.race = null;
  traffic.removeRacers?.();
  if (IT && MODE === 'course') startRace();
  updateCamera(0, true);
  sound.init();
  sound.preload(VOIX);
  radio.paused = false;
  radio.start();
  show('play');
  if (!G.race) hud.toast(IT ? `${legs().from.name} → ${legs().to.name} · ${VEH.name}` : CURRENT.intro, 4.5);
  if (isTouch) {
    // Plein écran + paysage quand le navigateur le permet (pas sur iPhone)
    Promise.resolve(document.documentElement.requestFullscreen?.())
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
}

function pause() {
  if (G.state !== 'play') return;
  G.state = 'pause';
  input.releaseAll();
  sound.horn(false);
  sound.suspend();
  sound.pauseSpeech();
  radio.pause();
  window.speechSynthesis?.cancel();
  show('pause');
}
function resume() {
  if (G.state !== 'pause') return;
  G.state = 'play';
  sound.resume();
  sound.resumeSpeech();
  if (!preacher.active) radio.resume();   // (pendant la prédication, la radio reste coupée)
  show('play');
}
function toMenu() {
 G.state = 'menu'; goStep(1);
  dismountEnd();
  preacher.leave(true);
  incidents.finish();
  sound.ambience?.(0);
  window.speechSynthesis?.cancel();
  sound.stopClip();
  sound.horn(false);
  sound.engine(0, 0, false);
  radio.stop();
  show('menu');
}

function endShift(reason) {
  dismountEnd();
  preacher.leave(true);
  incidents.finish();
  endControl(G.police);
  if (lunettes.on) lunettes.disable();
  G.state = 'end';
  input.releaseAll();
  sound.horn(false);
  sound.engine(0, 0, false);
  radio.stop();
  G.cash = G.fares + G.tips - G.fuelCost - G.repairs - G.fines - (G.stolen ?? 0);   // (le gain de la course vient d'être ajouté)
  const race = reason === 'course' ? G.race : null;
  const owed = G.race ? G.race.mise : VERSEMENT;
  const net = G.cash - owed;
  $('countdown').hidden = true;
  traffic.raceFrozen = false;
  $('end-title').textContent = race ? (race.rank === 1 ? 'Course gagnée ! 🏆' : `Course terminée : ${race.rank}e sur 4`) : reason === 'panne' ? 'Panne d’essence : fin de la journée' : reason === 'arret' ? 'Arrêté par la police' : reason === 'arrive' ? `Arrivé : ${IT ? legs().to.name : A.endName} !` : 'Il fait nuit, fin de journée';
  $('end-sub').textContent = `${G.rides} course${G.rides > 1 ? 's' : ''} · ${G.crashes} accrochage${G.crashes > 1 ? 's' : ''}${IT ? ` · ${G.tours ?? 0} trajet${(G.tours ?? 0) > 1 ? 's' : ''} terminé${(G.tours ?? 0) > 1 ? 's' : ''}` : ` · ${Math.round(-taxi.z)} m parcourus`}`;
  const rows = [
    [race ? 'Gain de la course' : 'Courses', G.fares], ...(race ? [] : [['Pourboires', G.tips]]),
    ['Carburant', -G.fuelCost], ['Tôlerie', -G.repairs], ...(G.fines ? [['Amendes de la police', -G.fines]] : []), ...(G.stolen ? [['Volé par des bandits', -G.stolen]] : []), G.race ? ['Mise de la course', -G.race.mise] : ['Versement au patron', -VERSEMENT],
  ];
  $('end-bill').innerHTML = rows.map(([l, v]) => `<tr class="${v < 0 ? 'neg' : ''}"><td>${l}</td><td>${v < 0 ? '−' : ''}${fmtFC(Math.abs(v))}</td></tr>`).join('')
    + `<tr class="total"><td>Il te reste</td><td>${net < 0 ? '−' : ''}${fmtFC(Math.abs(net))}</td></tr>`;
  if (VEH.perso) $('end-sub').textContent = `${(G.km ?? 0).toFixed(1).replace('.', ',')} km parcourus ${VEH_ID === 'athlete' ? 'en courant' : 'en ville'}`;
  if (race) $('end-sub').textContent = race.board.map((r, i) => `${i + 1}. ${r.name}${r.time ? ` (${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')})` : ''}`).join(' · ');
  if (reason === 'arret' && G.caughtRun) $('end-sub').textContent = G.caughtRun === 'bagarre' ? 'Bagarre avec la police' : 'Délit de fuite après un accident';
  $('end-verdict').textContent = race ? (race.rank === 1 ? `Bravo ! Tu remportes ${fmtFC(race.prix)}.` : race.rank === 2 ? 'Deuxième : tu récupères ta mise.' : 'Perdu : la mise est pour le gagnant. Revanche ?')
    : reason === 'arret' && G.caughtRun === 'bagarre' ? 'Tu t’es battu avec un policier et tu as fui : la police t’a rattrapé. Tu passes la nuit au poste.'
    : reason === 'arret' && G.caughtRun ? 'Tu as fui après avoir renversé un piéton : la police t’a rattrapé. Tu passes la nuit au poste.'
    : reason === 'arret' ? `Tu as renversé un piéton : l'ambulance l'a emmené à l'hôpital, et tu passes la nuit au poste (amende de ${fmtFC(ACC_FINE)}). Conduis prudemment dans la foule !`
    : net >= 10000 ? 'Grande journée, chauffeur ! La famille mange bien ce soir.'
    : net >= 0 ? 'Versement payé. Le patron est content.'
    : 'Le versement n\'est pas complet… le patron va crier demain.';
  $('btn-again').textContent = race ? 'Revanche' : 'Nouvelle journée';
  show('end');
}

// ---------- Boutons ----------
$('btn-start').addEventListener('click', startShift);
worldReady = true;
mark('ville prête (bouton de départ actif)');
if (MESURE) {
  const R = performance.getEntriesByType('resource'), by = k => R.filter(r => r.name.includes(k)), kb = a => Math.round(a.reduce((n, r) => n + (r.encodedBodySize || r.decodedBodySize), 0) / 1024);
  console.log(`MESURE fichiers : ${R.length} requêtes ; code ${by('/js/').length} (${kb(by('/js/'))} Ko), données ${by('/data/').length} (${kb(by('/data/'))} Ko), personnages ${by('personnages').length} (${kb(by('personnages'))} Ko), three ${by('three').length}`);
  console.log('MESURE les plus longues : ' + [...R].sort((a, b) => b.duration - a.duration).slice(0, 6).map(r => `${r.name.split('/').slice(-2).join('/')} ${Math.round(r.duration)} ms`).join(' | '));
  console.log(`MESURE mémoire JS : ${performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' Mo' : 'n/a'} ; triangles : ${renderer.info.render.triangles}`);
}
$('btn-start').disabled = false;                 // (la ville est construite : voir index.html)
$('btn-start').textContent = MODE === 'course' ? '🏁 Lancer la course' : '🚕 Commencer la journée';

// ---------- Menu : véhicule, itinéraire (sélection instantanée), sens ----------
function drawMenu() {
  ITINERAIRES.forEach(i => syncVariant(i));
  radioGroup($('vehs'), Object.entries(VEHICULES).map(([id, v]) => ({
    id,
    html: `<div class="veh-top"><span class="veh-art">${VEH_ART[id]}</span><span class="veh-fare-pill">${v.athlete ? '🏃 Sport' : v.perso ? 'Libre' : `${fmtFC(v.fare)} / client`}</span></div>`
      + `<b>${v.name}</b><span class="about">${v.about}</span>`
      + `<div class="vstats">${statRow(v.athlete ? 'Endurance' : 'Places', v.athlete ? 0.95 : v.places / 10)}${statRow('Vitesse', v.athlete ? 0.55 : (v.max - 12) / 14)}${statRow('Maniable', id === 'moto' || id === 'athlete' ? 0.98 : id === 'bus' ? 0.35 : 0.7)}</div>`
      + `<span class="price">${v.athlete ? 'Footing libre ou Marathon' : v.perso ? 'Sans versement · Balade' : `Versement : ${fmtFC(v.versement)}`}</span>`,
  })), it => it.id === VEH_ID, it => { store('veh', it.id); setVehicle(it.id); drawMenu(); goStep(3); });
  if (MODE === 'course') for (const [k, b] of [...$('vehs').children].entries()) if (['bus', 'perso'].includes(Object.keys(VEHICULES)[k])) b.disabled = true;

  if (IT) {
    const rBox = $('routes');
    rBox.innerHTML = '';
    for (const i of ITINERAIRES) {
      const disabled = MODE === 'course' && !raceOK(i);
      const active = i.id === IT.id;
      const stops = active && SENS === 'retour' && MODE !== 'course' ? [...(i.stops ?? [])].reverse() : (i.stops ?? []);
      const stopsHtml = stops.length ? `<div class="itin-stops">${stops.map(s => `<span class="itin-stop">${s}</span>`).join('')}</div>` : '';
      const varsHtml = i.variants ? `<div class="itin-vars">${i.variants.map(v => {
        const vDis = MODE === 'course' && (v.A ?? i.A).road !== (v.B ?? i.B).road;
        return `<span class="var-pill${i.variant === v.id ? ' on' : ''}" data-var="${v.id}"${vDis ? ' style="opacity:.35;pointer-events:none"' : ''}>${v.short ?? v.label}</span>`;
      }).join('')}</div>` : '';

      const btn = document.createElement('button');
      btn.className = 'route-btn';
      btn.disabled = disabled;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(active));
      btn.innerHTML = `<div class="itin-head-row"><div class="itin-badges"><span class="itin-code">${i.code ?? ''}</span><span class="itin-tag">${i.tag ?? ''}</span></div>`
        + `<span class="km">${i.km.toLocaleString('fr-FR')} KM${disabled ? ' · HORS COURSE' : ''}</span></div>`
        + `<b class="itin-name">${i.title}</b>`
        + stopsHtml
        + varsHtml;
      btn.addEventListener('click', e => {
        const vp = e.target.closest('[data-var]');
        if (vp) {
          const vid = vp.dataset.var;
          store(`var.${i.id}`, vid);
          syncVariant(i, vid);
          if (i.id === IT.id) { syncUrl(); drawMenu(); return; }
        }
        if (i.id === IT.id) return;
       pickRoute(i); goStep(4);
      });
      rBox.append(btn);
    }

    const varBox = $('sum-var-box');
    if (varBox) {
      varBox.hidden = !IT.variants;
      if (IT.variants) {
        radioGroup($('sum-vars'), IT.variants.map(v => ({
          id: v.id,
          disabled: MODE === 'course' && (v.A ?? IT.A).road !== (v.B ?? IT.B).road,
          html: `<b>${v.short ?? v.label}</b><span>${v.km.toLocaleString('fr-FR')} km</span>`,
        })), v => v.id === IT.variant, v => {
          store(`var.${IT.id}`, v.id);
          syncVariant(IT, v.id);
          syncUrl();
          drawMenu();
        });
      }
    }

    const La = legs('aller'), Lr = legs('retour');
    const L = { aller: `${La.from.name} → ${La.to.name}`, retour: `${Lr.from.name} → ${Lr.to.name}` };
    radioGroup($('sens'), ['aller', 'retour'].map(k => ({ id: k, html: `<b>${k === 'aller' ? 'Aller' : 'Retour'}</b><span>${L[k]}</span>` })), it => it.id === SENS, it => { SENS = it.id; store('sens', it.id); drawMenu(); });
    const L1 = legs(), L2 = legs(SENS === 'retour' ? 'aller' : 'retour');
    radioGroup($('trip'), [{ id: 'simple', html: `<b>Aller simple</b><span>Terminus : ${L1.to.name}</span>` }, { id: 'ar', html: `<b>Aller-retour</b><span>Retour : ${L2.to.name}</span>` }],
      it => it.id === TRIP, it => { TRIP = it.id; store('trip', it.id); drawMenu(); });
  }
  const race = MODE === 'course', C = COURSES[VEH_ID] ?? COURSES.berline;
  $('mode-travail').classList.toggle('on', !race); $('mode-course').classList.toggle('on', race);
  $('sens-title').lastChild.textContent = race ? ' Format de la course' : ' Sens de départ';
  $('trip').hidden = race || !IT;
  if (race && IT) radioGroup($('sens'), [{ id: 'simple', html: `<b>Aller simple</b><span>${IT.A.name} → ${IT.B.name}</span>` }, { id: 'ar', html: `<b>Aller-retour</b><span>${IT.A.name} → ${IT.B.name} → ${IT.A.name}</span>` }],
    it => it.id === (RACE_AR ? 'ar' : 'simple'), it => { RACE_AR = it.id === 'ar'; store('course', it.id); drawMenu(); });
  const isAth = VEH_ID === 'athlete', isPerso = VEH_ID === 'perso';
  const mise = race && RACE_AR ? Math.round(C.mise * 1.5) : C.mise, prix = race && RACE_AR ? C.prix * 2 : C.prix;
  $('sum-title').textContent = race ? 'Feuille de course' : isAth ? 'Parcours sportif' : isPerso ? 'Itinéraire libre' : 'Feuille de route';
  $('sum-l1').textContent = race ? 'Mise de départ' : isAth ? 'Objectif' : isPerso ? 'Mode' : 'Versement au patron';
  $('sum-l2').textContent = race ? 'Gain du 1er' : 'Horaires';
  $('sum-v2').textContent = race ? `${fmtFC(prix)} · 3 rivaux` : '06:00 → 18:00';
  $('rule-versement').textContent = race ? fmtFC(mise) : isAth ? 'Footing libre' : isPerso ? 'Balade libre' : fmtFC(VERSEMENT);
  $('btn-start').disabled = !worldReady;
  $('btn-start').textContent = !worldReady
    ? '⏳ Chargement de la ville…'
    : race
    ? '🏁 Lancer la course'
    : isAth
    ? '🏃 Commencer le footing'
    : isPerso
    ? '🚗 Partir en balade'
    : '🚕 Commencer la journée';
  $('sum-veh').textContent = VEH.name;
  if (IT) {
    const L = legs();
    $('sum-route').textContent = IT.variantShort ? `${IT.title} (${IT.variantShort})` : IT.title;
    $('sum-sens').textContent = race ? `${IT.A.name} → ${IT.B.name}${RACE_AR ? ` → ${IT.A.name}` : ''}` : `${L.from.name} → ${L.to.name}${TRIP === 'ar' ? ` → ${legs(SENS === 'retour' ? 'aller' : 'retour').to.name}` : ''}`;
    if ($('sum-code')) $('sum-code').textContent = IT.code ?? 'L1';
    if ($('sum-km')) $('sum-km').textContent = `${IT.km.toLocaleString('fr-FR')} KM`;
    if ($('sum-cri')) {
      const criA = L.to.cri ?? L.to.name, criB = legs(SENS === 'retour' ? 'aller' : 'retour').to.cri ?? L.from.cri;
      $('sum-cri').textContent = race
        ? `🏁 Rivaux : ${C.rivals.join(', ')}`
        : isAth
        ? `🏃 Course à pied · ${L.from.cri ?? L.from.name} → ${criA} (${IT.km.toLocaleString('fr-FR')} km)`
        : VEH.perso
        ? `🚗 Conduite libre · ${L.from.cri ?? L.from.name} → ${criA}`
        : `📢 Receveur : « ${criA} ! ${criA} !${TRIP === 'ar' ? ` — Retour ${criB} !` : ''} »`;
    }
  }
}
$('btn-flee').addEventListener('click', startFight);
addEventListener('keydown', e => { if (e.code === 'KeyF' && G.state === 'play') startFight(); });
$('btn-vr').addEventListener('click', async () => {
  await lunettes.enable();
  G.cam = 1;
  startShift();
  hud.toast('Lunettes : penche la tête pour tourner, regarde en bas pour freiner, touche l’écran pour t’arrêter.', 6);
});
lunettes.onExit = () => { G.cam = 0; if (G.state === 'play') pause(); };
drawMenu();
$('rule-versement').textContent = fmtFC(VERSEMENT);
$('btn-again').addEventListener('click', startShift);
$('btn-menu').addEventListener('click', toMenu);
$('btn-quit').addEventListener('click', toMenu);
$('btn-resume').addEventListener('click', resume);
$('btn-pause').addEventListener('click', pause);
$('btn-cam').addEventListener('click', cycleCam);
// Le menu ≡ (l'auteur, 10/11 : écran aéré) : son, radio, chansons, rétroviseur
$('btn-more').addEventListener('click', () => { const m = $('more'); m.hidden = !m.hidden; $('btn-more').setAttribute('aria-expanded', String(!m.hidden)); });
// Le rétroviseur : on le cache en le touchant, on le remet par le menu ≡ ; ◀ ▶ (ou A / R) : regarder à gauche, à droite tant qu'on appuie
retro.show(store('retro') !== 'off');
const setRetro = on => { retro.show(on); store('retro', on ? 'on' : 'off'); $('btn-retro').classList.toggle('off', !on); };
$('btn-retro').classList.toggle('off', !retro.on);
$('btn-retro').addEventListener('click', () => { setRetro(!retro.on); $('more').hidden = true; });
// (l'auteur, 26/11 : « l'écran est trop encombré à gauche ») : le panneau client + confort et le tableau du terminus se cachent, et se remettent, par le menu ≡
for (const [id, cls, key] of [['btn-hcourse', 'hide-course', 'hcourse'], ['btn-hitin', 'hide-itin', 'hitin']]) {
  const set = hide => { document.body.classList.toggle(cls, hide); $(id).classList.toggle('off', hide); store(key, hide ? 'off' : 'on'); };
  set(store(key) === 'off');
  $(id).addEventListener('click', () => { set(!document.body.classList.contains(cls)); $('more').hidden = true; });
}
retro.glass?.addEventListener('click', () => setRetro(false));
G.glance = 0;
for (const [id, dir] of [['glance-l', -1], ['glance-r', 1]]) {
  const b = $(id);
  const down = e => { e.preventDefault(); G.glance = dir; b.classList.add('on'); };
  const up = () => { if (G.glance === dir) G.glance = 0; b.classList.remove('on'); };
  b.addEventListener('pointerdown', down);
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, up);
}
addEventListener('keydown', e => { if (e.repeat) return; if (e.code === 'KeyQ') G.glance = -1; else if (e.code === 'KeyR') G.glance = 1; });   // (A et R en AZERTY)
addEventListener('keyup', e => { if ((e.code === 'KeyQ' && G.glance === -1) || (e.code === 'KeyR' && G.glance === 1)) G.glance = 0; });
const toggleMute = () => { sound.setMuted(!sound.muted); radio.setMuted(sound.muted); $('btn-mute').classList.toggle('off', sound.muted); };
// La radio : RADIO l'allume ou l'éteint, ⏭ passe au morceau suivant ; le titre s'affiche à chaque morceau
const showRadio = () => {
  $('btn-radio').classList.toggle('off', !radio.on);
  $('btn-radio').textContent = radio.on ? '📻 ON' : '📻 OFF';            // (l'auteur, 08/11 : pouvoir éteindre la radio, et le voir)
  $('songs-power').textContent = radio.on ? '📻 Éteindre la radio' : '📻 Allumer la radio';
  $('songs-power').classList.toggle('off', !radio.on);
  $('sel-radio').value = radio.on ? 'on' : 'off';
  $('btn-next').hidden = !radio.on || !radio.hasSongs;
};
radio.onTitle = (t, first) => setTimeout(() => { if (G.state === 'play') hud.note(`📻 ${t}`, 2); }, first ? 5000 : 0);
radio.ready.then(() => { showRadio(); drawSongs(); });
// La liste des chansons : en choisir une, en ajouter depuis l'appareil, retirer celles qu'on a ajoutées, régler le volume
try { const v = Number(localStorage.getItem('taxikin-volume')); if (v >= 0 && localStorage.getItem('taxikin-volume') !== null) radio.level = v; } catch { /* */ }
$('songs-vol').value = Math.round(radio.level * 100);
function drawSongs() {
  const ul = $('songs-list');
  ul.innerHTML = '';
  for (const song of radio.list) {
    const li = document.createElement('li');
    li.className = radio.current === song && radio.on ? 'on' : '';
    const b = Object.assign(document.createElement('button'), { className: 'play', textContent: `${radio.current === song && radio.on ? '▶ ' : ''}${song.titre}${song.mine ? ' · à moi' : ''}` });
    b.addEventListener('click', () => { radio.play(song); showRadio(); });
    li.append(b);
    if (song.mine) {
      const d = Object.assign(document.createElement('button'), { className: 'del', textContent: '🗑', title: 'Retirer' });
      d.addEventListener('click', () => radio.remove(song));
      li.append(d);
    }
    ul.append(li);
  }
  if (!radio.list.length) ul.innerHTML = '<li style="color:var(--muted);font-size:13px;padding:6px">Aucune chanson : ajoute les tiennes.</li>';
}
radio.onList = drawSongs;
$('btn-songs').addEventListener('click', () => { drawSongs(); $('songs').hidden = !$('songs').hidden; });
$('songs-close').addEventListener('click', () => { $('songs').hidden = true; });
$('songs-vol').addEventListener('input', e => radio.setLevel(e.target.value / 100));
$('songs-file').addEventListener('change', async e => {
  const n = await radio.addFiles([...e.target.files]);
  e.target.value = '';
  hud.toast(n ? `${n} chanson${n > 1 ? 's ajoutées' : ' ajoutée'} à la radio` : 'Aucun fichier audio reconnu', 3);
  if (n && (!radio.on || radio.el.paused)) { radio.play(radio.list[radio.list.length - n]); showRadio(); }
});
$('btn-radio').addEventListener('click', () => { radio.toggle(); showRadio(); hud.toast(radio.on ? '📻 Radio allumée' : '📻 Radio éteinte', 1.5); });
$('sel-radio').value = radio.on ? 'on' : 'off';
$('sel-radio').addEventListener('change', e => { radio.setOn(e.target.value === 'on'); showRadio(); });
if (PARAMS.get('autostart') === '1' && store('radioOn')) { radio.setOn(store('radioOn') === 'on'); showRadio(); }
$('songs-power').addEventListener('click', () => { radio.toggle(); showRadio(); drawSongs(); });
$('btn-next').addEventListener('click', () => radio.next());
$('btn-mute').addEventListener('click', toggleMute);
input.on('pause', () => (G.state === 'play' ? pause() : resume()));
input.on('mute', toggleMute);
input.on('camera', cycleCam);
input.on('hornDown', () => {
  if (G.state !== 'play') return;
  sound.horn(true);
  const msg = traffic.honk(taxi);
  if (msg) hud.toast(msg, 1.8);
});
input.on('hornUp', () => sound.horn(false));
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---------- Bulles de paroles (clients, receveur, police) : au-dessus du véhicule, à l'écran ----------
const bubbles = [];
const tmpB = new THREE.Vector3();
function say(text, who = 'client', dur = 3.2) {
  const el = document.createElement('div');
  el.className = `bubble ${who}`;
  el.textContent = text;
  $('bubbles').append(el);
  while (bubbles.length > 2) bubbles.shift().el.remove();       // (trois bulles au plus)
  bubbles.push({ el, t: dur, who, k: bubbles.length });
}
function updateBubbles(dt) {
  taxiMesh.getWorldPosition(tmpB);
  tmpB.y += VEH_ID === 'bus' ? 3.0 : 2.2;
  tmpB.project(camera);
  const x = (tmpB.x * 0.5 + 0.5) * innerWidth, y = (-tmpB.y * 0.5 + 0.5) * innerHeight;
  for (let i = bubbles.length - 1; i >= 0; i--) if ((bubbles[i].t -= dt) <= 0) { bubbles[i].el.remove(); bubbles.splice(i, 1); }
  let up = 40;                                   // (la plus récente en bas, les autres empilées au-dessus, selon leur hauteur)
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i], off = b.who === 'receveur' ? 90 : b.who === 'police' ? -90 : b.who === 'preacher' ? -60 : 0;
    b.el.style.transform = `translate(${Math.round(x + off)}px, ${Math.round(y - up)}px) translate(-50%, -100%)`;
    b.el.hidden = tmpB.z > 1;
    up += (b.el.offsetHeight || 40) + 10;
  }
}
// Choix proposés par un client : un prix plus bas, ou monter quand le véhicule est plein
function showOffer(o) {
  if (lunettes.on) { say(o.line, 'client', 4); setTimeout(() => passengers.answer(o.kind === 'price', callbacks), 1200); return; }
  say(o.line, 'client', 6);
  $('choice-text').textContent = o.kind === 'price'
    ? `Le client propose ${fmtFC(o.price)} au lieu de ${fmtFC(BOARD.fare)}.`
    : `Le véhicule est plein. Prendre un client de plus ? (+${fmtFC(BOARD.fare)}, mais la police peut te verbaliser pour surcharge)`;
  $('choice-yes').textContent = o.kind === 'price' ? 'Accepter' : 'Le prendre';
  $('choice-no').textContent = o.kind === 'price' ? 'Refuser' : 'Non, c\'est plein';
  $('choice').hidden = false;
}
function answerOffer(yes) {
  $('choice').hidden = true;
  if (G.choiceCb) { const f = G.choiceCb; G.choiceCb = null; f(yes); return; }   // (incidents.js : payer la tôlerie ou se battre)
  passengers.answer(yes, callbacks);
}
/** Une question au joueur (deux boutons) ; cb(oui). En mode lunettes : la réponse « non » toute seule. */
function askChoice(text, yesLabel, noLabel, cb) {
  if (lunettes.on) { setTimeout(() => cb(false), 1500); return; }
  G.choiceCb = cb;
  $('choice-text').textContent = text;
  $('choice-yes').textContent = yesLabel;
  $('choice-no').textContent = noLabel;
  $('choice').hidden = false;
}
$('choice-yes').addEventListener('click', () => answerOffer(true));
$('choice-no').addEventListener('click', () => answerOffer(false));
addEventListener('keydown', e => { if ($('choice').hidden) return; if (e.key === '1' || e.key === 'o') answerOffer(true); if (e.key === '2' || e.key === 'n') answerOffer(false); });

// ---------- Logique ----------
const callbacks = {
  onPickup(r, line) {
    sound.ding();
    say(line, 'client');
    maybePreacher();
  },
  /** Moto (l'auteur, 09/11 : « on doit voir comment le client monte, et il ne doit pas changer de vêtements ») : le client, arrivé à la moto, s'assoit derrière. */
  onMount(r, ch) {
    if (VEH_ID !== 'moto' || !BOARD.riders.includes(r)) { ch.mesh.visible = false; return; }
    taxiMesh.add(ch.mesh);
    ch.mesh.position.set(0, 0.36, 0.44);
    ch.mesh.rotation.set(0, 0, 0);
    ch.mesh.visible = true;
    ch.pose('sit', 0);
  },
  onDropoff(pay, tip, mood) {
    G.fares += pay;
    G.tips += tip;
    G.rides++;
    sound.cash();
    hud.toast(`+${fmtFC(pay + tip)}`, 2.5);
    say(mood, 'client', 2.8);
  },
  onLeave(r, line) {
    say(line, 'client', 3.5);
    hud.toast('Un client descend sans payer : trop secoué !', 3);
  },
  onOffer: showOffer,
  terminusName: () => (IT ? legs().to.name : null),
};
// ---------- Les sons de la ville (l'auteur, 08/11 : immersion) : brouhaha plus fort dans la foule, klaxons au loin, vendeurs qui crient ----------
const VENDORS = ['Mayi ya malili ! Mayi !', 'Mampa ! Mampa ya sika !', 'Nguba ! Nguba !', 'Unité ! Unité Vodacom !', 'Lotiti ! Lotiti mingi !', 'Makemba ya kotumba !'];
function cityAudio(dt) {
  if (G.state !== 'play' || G.accident) return;
  const crowd = A.W.inCrowd?.(taxi.z, 60) ? 1 : 0, cars = traffic.list.filter(v => v.mesh.visible && Math.abs(v.z - taxi.z) < 80).length;
  G.crowdLvl = (G.crowdLvl ?? 0) + (crowd * 0.8 + Math.min(1, cars / 25) * 0.3 - (G.crowdLvl ?? 0)) * Math.min(1, dt * 0.8);
  sound.ambience(G.crowdLvl);
  if (Math.random() < dt * (0.08 + G.crowdLvl * 0.35)) sound.hornFar(0.025 + Math.random() * 0.04);
  if (crowd && !sound.speechPlaying && Math.random() < dt * 0.09) {   // (pas de vendeurs pendant la prédication)
    if (Math.random() < 0.7) sound.clip(Math.random() < 0.5 ? 'vendeur-mayi' : 'vendeur-jus', { vol: 0.55, pan: Math.random() < 0.5 ? -0.6 : 0.6 });
    else sound.voice(VENDORS[Math.floor(Math.random() * VENDORS.length)], { pitch: 0.8 + Math.random() * 0.6, rate: 1.1, vol: 0.55 });
  }
  if (!sound.speechPlaying) clientVoices(dt);
}

// ---------- Les voix enregistrées par l'auteur (dossier « son receveur et client et autres », 08/11) ----------
// Le receveur crie la destination de la course (selon le terminus), et se moque parfois des clients ; les clients appellent le chauffeur
// depuis l'arrêt et parlent pendant le voyage ; les vendeurs crient dans la foule (cityAudio).
const VOIX = ['receveur-gare', 'receveur-limete', 'receveur-pascal-kingasani', 'receveur-ngaba', 'receveur-universite', 'receveur-aeroport', 'receveur-24-isc',
  'receveur-kintambo', 'receveur-moquerie', 'vendeur-mayi', 'vendeur-jus', 'client-attend', 'client-commentaires'];
/** La voix du receveur pour le terminus de la course (cri de routes.js) ; Sendwe : par le 24 Novembre (ISC). */
const RECEVEUR_VOIX = { Gare: 'receveur-gare', Gombe: 'receveur-gare', Limete: 'receveur-limete', Masina: 'receveur-pascal-kingasani', Kingasani: 'receveur-pascal-kingasani', Ngaba: 'receveur-ngaba', UNIKIN: 'receveur-universite',
  'Aéroport': 'receveur-aeroport', "N'djili": 'receveur-aeroport', Sendwe: 'receveur-24-isc', Kintambo: 'receveur-kintambo' };
function clientVoices(dt) {
  if (G.race) return;
  // des clients attendent tout près, devant : ils appellent le chauffeur (une fois par arrêt)
  const fwd = Math.cos(taxi.heading) >= 0 ? -1 : 1;
  for (const c of passengers.clients) {
    const ahead = (c.z - taxi.z) * fwd;
    if (c.state !== 'waiting' || c.called || ahead < 8 || ahead > 45 || c.side * taxi.x <= 0 || passengers.free <= 0) continue;
    if (sound.clipPlaying) break;
    c.called = true;
    if (Math.random() < 0.6) sound.clip('client-attend', { vol: 0.8, pan: 0.4 });   // (le trottoir est à droite du véhicule)
    break;
  }
  // à bord : les clients parlent entre eux de temps en temps ; dans le 207, le receveur se moque d'eux
  if (BOARD.riders.length && Math.abs(taxi.speed) > 4 && (G.talkCd = (G.talkCd ?? 25) - dt) <= 0) {
    const mock = VEH_ID === 'bus' && Math.random() < 0.4;
    const d = sound.clip(mock ? 'receveur-moquerie' : 'client-commentaires', { vol: 0.85 });
    G.talkCd = d ? d + 50 + Math.random() * 60 : 5;
    if (d && mock) say('Bino bato, bozali kosala makambo ! — Ah, vous les clients !', 'receveur', 3);
  }
  aiRider(dt);
}

// ---------- Un client qui parle grâce à une IA (api/chat.js sur Vercel : Groq, Gemini, OpenRouter, Mistral ; les clés restent sur le serveur) ----------
// Le client à bord fait de temps en temps une remarque sur la route, la pluie, la conduite. Il ne demande aucune réponse (rien à taper en conduisant).
// Si le serveur ne répond pas (hors ligne, limite atteinte…), le client ne dit rien de plus : le jeu continue. Désactivable avec ?ia=0.
const AI_URL = /vercel\.app$/.test(location.hostname) ? '/api/chat' : 'https://taxi-kin.vercel.app/api/chat';
const AI_ON = PARAMS.get('ia') !== '0' && /^https?:$/.test(location.protocol);
const AI_NAMES = ['Mama Nzuzi', 'Papa Kasongo', 'Jean-Pierre', 'Chantal', 'Fiston', 'Mireille', 'Papa Mukendi', 'Grâce', 'Bienvenu', 'Mama Rose', 'Patrick', 'Espérance'];
const AI_TRAITS = ['bavard et curieux', 'pressé et un peu nerveux', 'calme et poli', 'drôle, il plaisante tout le temps', 'fatigué après le travail', 'fier de son quartier', 'inquiet, il a peur des accidents', 'bon vivant, il aime la musique'];
const ai = { cd: 40, busy: false, fails: 0, pause: 0, pers: null, hist: [] };
function aiRider(dt) {
  if (!AI_ON || G.state !== 'play' || !BOARD.riders.length) { ai.pers = null; return; }
  if (ai.pause > 0) { ai.pause -= dt; return; }
  if (ai.busy || Math.abs(taxi.speed) < 3 || lunettes.on || (ai.cd -= dt) > 0) return;
  const who = BOARD.riders[0];
  if (!ai.pers || ai.pers.who !== who) {
    ai.pers = { who, name: AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)], trait: AI_TRAITS[Math.floor(Math.random() * AI_TRAITS.length)] };
    ai.hist = [];
  }
  ai.cd = 45 + Math.random() * 40;
  ai.busy = true;
  const near = ($('itin-near')?.textContent ?? '').replace('📍', '').trim();
  const kmh = Math.round(Math.abs(taxi.speed) * 3.6);
  const mins = Math.floor((G.minutes ?? 480) % 1440);
  const situation = `Le taxi roule à ${kmh} km/h${near ? `, ${near}` : ''}${rainK > 0.1 ? ', sous la pluie' : ''}${G.accident ? ', juste après un accident' : ''}. Il est ${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}. Fais une petite remarque au chauffeur.`;
  fetch(AI_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ message: situation, history: ai.hist, persona: { role: VEH_ID === 'bus' ? 'passager du bus' : 'client du taxi', name: ai.pers.name, trait: ai.pers.trait, place: near || avenueName(), weather: rainK > 0.1 ? 'pluie' : 'sec' } }),
  }).then(r => r.json()).then(o => {
    if (!o.text) throw new Error('pas de réponse');
    ai.fails = 0;
    ai.hist.push({ role: 'user', content: situation }, { role: 'assistant', content: o.text });
    if (ai.hist.length > 6) ai.hist.splice(0, 2);
    if (G.state === 'play' && BOARD.riders.includes(ai.pers?.who)) say(o.text, 'client', Math.min(6, 2.5 + o.text.length / 28));
    if (MESURE) console.log(`MESURE IA ${o.provider} ${o.ms} ms ${o.tried?.length ? JSON.stringify(o.tried) : ''}`);
  }).catch(() => { if (++ai.fails >= 3) { ai.fails = 0; ai.pause = 600; } }).finally(() => { ai.busy = false; });
}

/** Le receveur du 207 crie la destination quand le véhicule s'arrête près de clients ; il annonce aussi les places qui restent. */
function receveur(dt) {
  if (VEH_ID !== 'bus' || !IT || (G.shoutCd = (G.shoutCd ?? 0) - dt) > 0 || Math.abs(taxi.speed) > 3) return;
  const near = passengers.clients.some(c => c.state === 'waiting' && Math.abs(c.z - taxi.z) < 40 && c.side * taxi.x > 0);
  if (!near) return;
  receveurCall();
}
/** Le receveur crie la destination de la course (le terminus du sens où l'on roule) et les places qui restent. */
function receveurCall() {
  const T = legs().to.cri ?? legs().to.name, free = BOARD.cap - BOARD.riders.length;
  say(free > 0 ? `${T} ! ${T} ! Esika etikali ${free} ! — Il reste ${free} place${free > 1 ? 's' : ''} !` : `${T} ! Tondi ! — C'est plein, on part !`, 'receveur', 3);
  const v = RECEVEUR_VOIX[legs().to.cri], d = v && free > 0 ? sound.clip(v, { vol: 1 }) : 0;
  if (!d) sound.voice(free > 0 ? `${T} ! ${T} ! ${T} !` : `${T} ! Tondi !`, { pitch: 1.25, rate: 1.2 });
  G.shoutCd = d ? d + 5 : 6;
}
/** Surcharge (un client de plus) : une voiture de police proche peut verbaliser, une fois par voiture. */
function overloadCheck() {
  if (!BOARD.extra || G.police) return;
  for (const v of traffic.list) {
    if (v.kind !== 'police' || v.overloadSeen || Math.abs(v.z - taxi.z) > 30 || !v.mesh.visible) continue;
    v.overloadSeen = true;
    if (Math.random() < 0.4) { say('Bato ebele ! Trop de passagers, gare-toi !', 'police', 3.5); infraction('Surcharge', 10000); }
  }
}

// ---------- Au rond-point Mandela (l'auteur, 08/11 : « nous devons voir comment les bus quittent le 30 Juin et entrent sur le 24, et vice versa ») ----------
// Chaque route a sa propre circulation : au carrefour, des bus et des taxis tournent de l'une à l'autre, sur des courbes (en coordonnées de la scène).
const TURN = { list: [], spawnT: 0, paths: null };
function mandelaPaths() {
  if (TURN.paths || !ROAD2 || !JOIN_W) return TURN.paths;
  const V = THREE.Vector3, s = CURRENT.attach.side, zJ1 = ROAD1.zJoin, zr = ROAD2.zJoin, L1 = W1.LANE_X, W2 = ROAD2.W, L2 = W2.LANE_X;
  const p1 = (x, z) => RT1.worldVec(x, 0, z, new V());
  const p2 = (x, z) => ROAD2.group.localToWorld(ROAD2.RT.worldVec(x, 0, z, new V()));
  const r1 = L1[L1.length - 1], m1 = L1[Math.min(1, L1.length - 1)], l1 = L1[0];
  const r2 = L2[L2.length - 1], m2 = L2[Math.min(2, L2.length - 1)], l2 = L2[0];
  TURN.paths = [
    // du 24 Novembre vers le 30 Juin : à droite sur la chaussée proche, à gauche sur la chaussée d'en face
    [p1(r1, zJ1 + 55), p2(s * (W2.ROAD_EDGE + 1), zr), p2(s * r2, zr - s * 65)],
    [p1(m1, zJ1 + 50), p2(s * (W2.ROAD_EDGE - 2), zr - s * 4), p2(s * m2, zr - s * 60)],
    [p1(l1, zJ1 + 50), p2(0, zr), p2(-s * l2, zr + s * 60)],
    // du 30 Juin vers le 24 Novembre
    [p2(s * r2, zr + s * 65), p2(s * (W2.ROAD_EDGE + 1), zr), p1(-r1, zJ1 + 55)],
    [p2(s * m2, zr + s * 60), p2(s * (W2.ROAD_EDGE - 2), zr + s * 4), p1(-m1, zJ1 + 50)],
    [p2(-s * l2, zr - s * 60), p2(0, zr), p1(-l1, zJ1 + 50)],
  ];
  return TURN.paths;
}
const qbez = (P, t, out) => out.set(0, 0, 0).addScaledVector(P[0], (1 - t) * (1 - t)).addScaledVector(P[1], 2 * t * (1 - t)).addScaledVector(P[2], t * t);
function makeMandelaMesh() {
  const r = Math.random();
  return r < 0.38 ? createMinibus() : r < 0.65 ? createCar({ color: 0xf2c200, taxi: true, roof: false }) : r < 0.82 ? createCityBus() : createSUV();
}
function spawnMandelaTurner(P, t0 = 0) {
  const mesh = makeMandelaMesh();
  scene.add(mesh);
  let len = 0; const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let k = 1; k <= 20; k++) { qbez(P, (k - 1) / 20, a); qbez(P, k / 20, b); len += a.distanceTo(b); }
  TURN.list.push({ mesh, P, t: t0, len, speed: 6.5 + Math.random() * 3.5 });
}
function mandelaTurners(dt) {
  const paths = mandelaPaths();
  if (!paths) return;
  const near = G.state === 'play' && A.group.localToWorld(worldVec(taxi.x, 0, taxi.z, TURN.at ??= new THREE.Vector3())).distanceTo(JOIN_W) < 360;   // (le véhicule près du carrefour)
  if (near && TURN.list.length === 0) {
    spawnMandelaTurner(paths[0], 0.35);
    spawnMandelaTurner(paths[3], 0.45);
    spawnMandelaTurner(paths[1], 0.15);
    TURN.spawnT = 1.0;
  }
  if (near && (TURN.spawnT -= dt) <= 0 && TURN.list.length < 8) {
    TURN.spawnT = 1.0 + Math.random() * 1.8;
    const P = paths[Math.floor(Math.random() * paths.length)];
    if (!TURN.list.some(v => v.P === P && v.t < 0.28)) spawnMandelaTurner(P, 0);
  }
  const here = new THREE.Vector3(), ahead = new THREE.Vector3();
  for (let i = TURN.list.length - 1; i >= 0; i--) {
    const v = TURN.list[i];
    v.t += v.speed * dt / v.len;
    if (v.t >= 1 || !near) { scene.remove(v.mesh); TURN.list.splice(i, 1); continue; }
    qbez(v.P, v.t, here); qbez(v.P, Math.min(1, v.t + 0.02), ahead);
    v.mesh.position.set(here.x, 0.02, here.z);
    v.mesh.rotation.set(0, Math.atan2(-(ahead.x - here.x), -(ahead.z - here.z)), 0);
  }
}

// ---------- Entrée de la Route Poids Lourds au Pont Matete (bretelle Hôpital Akram & route des rails en biais) ----------
const PL_TURN = { list: [], spawnT: 0, paths: null, center: null };
function matetePlPaths() {
  if (PL_TURN.paths !== null) return PL_TURN.paths;
  if (!W1.MAT_PL_PTS || W1.plBandU(92, W1.MAT_PL_PTS[3][1]) < 0) return (PL_TURN.paths = false);
  const V = THREE.Vector3, M = W1.MAT_PL_PTS, zm = M[0][1] - 176;
  const cbez = (P, t) => {
    const u = 1 - t;
    return [
      u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0],
      u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1],
    ];
  };
  const sm = t => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
  const nOut = u => 1.8 + 1.4 * sm((u - 115) / 40);
  const nIn = u => -(1.8 + 1.4 * sm((u - 115) / 40));
  const poly = raw => {
    const pts = raw.map(([x, z]) => new V(x, 0, z)), cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { pts, cum, len: cum[cum.length - 1] };
  };
  // 1) Bretelle Hôpital Akram depuis le boulevard Lumumba → jonction en Y → Route Poids Lourds (u = 250)
  const raw0 = [];
  for (let z = zm + 212; z >= zm + 180; z -= 8) { const p = RT1.worldVec(W1.LANE_R, 0, z, new V()); raw0.push([p.x, p.z]); }
  for (let k = 1; k <= 12; k++) {
    const t = k / 13, [rx, rz] = cbez(M, t), p = RT1.worldVec(rx + 1.2 * t, 0, rz, new V());
    raw0.push([p.x, p.z]);
  }
  for (let u = 115; u <= 250; u += 9) raw0.push(W1.plPt(u, nOut(u)));
  // 2) Route des rails depuis le dessous du Pont Matete (u = 15) → Route Poids Lourds (u = 250)
  const raw1 = [];
  for (let u = 15; u <= 250; u += 10) raw1.push(W1.plPt(u, nOut(u)));
  // 3) Sens inverse : de la Route Poids Lourds (u = 250) vers le Pont Matete (u = 15) sur la voie de gauche
  const raw2 = [];
  for (let u = 250; u >= 15; u -= 10) raw2.push(W1.plPt(u, nIn(u)));
  const c = W1.plPt(120, 0);
  PL_TURN.center = new V(c[0], 0, c[1]);
  return (PL_TURN.paths = [poly(raw0), poly(raw1), poly(raw2)]);
}
function plPolyAt(P, u, out) {
  const { pts, cum } = P;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < u) i++;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = clamp((u - cum[i - 1]) / seg, 0, 1);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
  out.hx = dx / L; out.hz = dz / L;
}
function spawnPlTurner(P, pIdx, u0 = 0) {
  const r = Math.random();
  const mesh = r < 0.30 ? createTruck() : r < 0.56 ? createMinibus() : r < 0.78 ? createCar({ color: 0xf2c200, taxi: true, roof: false }) : r < 0.90 ? createTricycle() : createMoto({ riders: 1 });
  scene.add(mesh);
  const cruise = 7.5 + Math.random() * 3.5;
  PL_TURN.list.push({ mesh, P, pIdx, u: u0, speed: cruise, cruise, vl: mesh.userData.L ?? 4.5, vw: mesh.userData.W ?? 1.9, x: 0, z: 0, hx: 0, hz: -1 });
}
function matetePlTurners(dt) {
  const paths = matetePlPaths();
  if (!paths) return;
  const pTaxi = A.group.localToWorld(worldVec(taxi.x, 0, taxi.z, PL_TURN.at ??= new THREE.Vector3()));
  const near = G.state === 'play' && pTaxi.distanceTo(PL_TURN.center) < 380;
  if (near && PL_TURN.list.length === 0) {
    spawnPlTurner(paths[0], 0, paths[0].len * 0.24);
    spawnPlTurner(paths[0], 0, paths[0].len * 0.62);
    spawnPlTurner(paths[1], 1, paths[1].len * 0.42);
    spawnPlTurner(paths[2], 2, paths[2].len * 0.35);
    PL_TURN.spawnT = 1.2;
  }
  if (near && (PL_TURN.spawnT -= dt) <= 0 && PL_TURN.list.length < 7) {
    PL_TURN.spawnT = 1.4 + Math.random() * 2.0;
    const idx = Math.random() < 0.48 ? 0 : Math.random() < 0.5 ? 1 : 2, P = paths[idx];
    if (!PL_TURN.list.some(v => v.P === P && v.u < 24)) spawnPlTurner(P, idx, 0);
  }
  const st = { x: 0, z: 0, hx: 0, hz: -1 };
  for (const v of PL_TURN.list) { plPolyAt(v.P, v.u, st); v.x = st.x; v.z = st.z; v.hx = st.hx; v.hz = st.hz; }
  for (let i = PL_TURN.list.length - 1; i >= 0; i--) {
    const v = PL_TURN.list[i];
    if (!near) { scene.remove(v.mesh); PL_TURN.list.splice(i, 1); continue; }
    let target = v.cruise;
    for (const o of PL_TURN.list) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z, along = dx * v.hx + dz * v.hz, across = Math.abs(dz * v.hx - dx * v.hz);
      if (along > 0 && along < 22 && across < 2.2) target = Math.min(target, Math.max(0, (along - (o.vl + v.vl) / 2 - 2.5) * 0.8));
    }
    const tx = pTaxi.x - v.x, tz = pTaxi.z - v.z, tAlong = tx * v.hx + tz * v.hz, tAcross = Math.abs(tz * v.hx - tx * v.hz);
    if (taxi.level !== 'up' && tAlong > 0 && tAlong < v.vl / 2 + 8 && tAcross < 2.3) target = 0;
    if (taxi.level !== 'up' && Math.abs(tAlong) < (v.vl + VEH.l) / 2 - 0.3 && tAcross < (v.vw + VEH.w) / 2 - 0.25 && Math.abs(taxi.speed) > 1.5) {
      taxi.speed *= 0.6;
    }
    v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), (target > v.speed ? 3.5 : 9) * dt);
    v.u += v.speed * dt;
    if (v.u >= v.P.len) { scene.remove(v.mesh); PL_TURN.list.splice(i, 1); continue; }
    plPolyAt(v.P, v.u, st);
    v.mesh.position.set(st.x, 0.02, st.z);
    v.mesh.rotation.set(0, Math.atan2(-st.hx, -st.hz), 0);
  }
}

// ---------- Le train (l'auteur, 08/11 : « il faut simuler aussi le passage du train », photo trainkinshasa1) ----------
// Sur la Route Poids Lourds : de temps en temps un train longe la route sur la voie ferrée de gauche ; à l'approche d'un passage à niveau, un
// train traverse la route : sonnerie, les voitures s'arrêtent ; il faut l'attendre (le toucher, c'est l'accident).
const TRAIN = { cars: null, road: null, kind: null, cd: 35, crossDone: new Map(), bellT: 0 };
const PL_CROSS = () => (ROUTES.poidslourds?.pl?.crossings ?? []).map(([km, ang]) => ({ z: -ROAD3.RT.toGame(km - 1057), a: ang * Math.PI / 180 }));
function trainShow(n) {
  TRAIN.cars ??= createTrain(3);
  TRAIN.cars.forEach((m, k) => { m.visible = k <= n; if (k <= n) A.group.add(m); });
  TRAIN.road = A;
  TRAIN.horn = false; TRAIN.hit = false;
}
function trainHide() {
  for (const m of TRAIN.cars ?? []) { m.visible = false; m.parent?.remove(m); }
  TRAIN.kind = null; TRAIN.road = null;
}
function updateTrain(dt) {
  if (!ROAD3) return;
  if (TRAIN.kind && (TRAIN.road !== A || G.state === 'menu' || G.state === 'end')) trainHide();
  if (A !== ROAD3 || G.state !== 'play' || G.race) return;
  const W = A.W, xRail = -(W.ROAD_EDGE + 9), zFrom = 0, zTo = -A.RT.toGame(10640 - 1057), fwd = Math.cos(taxi.heading) >= 0 ? -1 : 1;
  if (!TRAIN.kind && (TRAIN.cd -= dt) <= 0) {
    const now = G.time, cross = PL_CROSS().find(c => { const ah = (c.z - taxi.z) * fwd; return ah > 70 && ah < 260 && !(now - (TRAIN.crossDone.get(c.z) ?? -999) < 240); });
    if (cross && Math.random() < 0.85) {                         // un train va traverser la route devant
      Object.assign(TRAIN, { kind: 'cross', c: cross, tc: -12 / Math.cos(cross.a) });
      TRAIN.t = TRAIN.tc - 55;
      trainShow(1);
    } else {                                                     // un train longe la route
      const dir = Math.random() < 0.5 ? 1 : -1;
      Object.assign(TRAIN, { kind: 'long', dir, z: taxi.z + (dir === fwd ? -fwd * 120 : fwd * 420) });
      if (TRAIN.z > zFrom || TRAIN.z < zTo) { TRAIN.kind = null; TRAIN.cd = 20; return; }
      trainShow(3);
    }
  }
  if (TRAIN.kind === 'long') {
    TRAIN.z += TRAIN.dir * 12 * dt;
    TRAIN.cars.forEach((m, k) => {
      if (!m.parent) return;
      const z = TRAIN.z - TRAIN.dir * (TRAIN_L / 2 + k * (TRAIN_L + 0.6));
      m.visible = z < zFrom - 5 && z > zTo + 5;
      if (m.visible) place(m, xRail, z, TRAIN.dir < 0 ? 0 : Math.PI, 0);
    });
    if (!TRAIN.horn && Math.abs(TRAIN.z - taxi.z) < 230) { TRAIN.horn = true; sound.trainHorn(0.11); }
    const tail = TRAIN.z - TRAIN.dir * 4 * (TRAIN_L + 0.6);
    if ((tail - taxi.z) * TRAIN.dir > 380 || (TRAIN.z - taxi.z) * TRAIN.dir < -700 || TRAIN.z > zFrom + 90 || TRAIN.z < zTo - 90) { trainHide(); TRAIN.cd = 60 + Math.random() * 70; }
  } else if (TRAIN.kind === 'cross') {
    const C = TRAIN.c, ux = Math.cos(C.a), uz = -Math.sin(C.a), at = t => [12 + t * ux, C.z + t * uz];
    TRAIN.t += 8 * dt;
    const front = TRAIN.t, tail = front - 2 * (TRAIN_L + 0.6), active = front > TRAIN.tc - 40 && tail < TRAIN.tc + 16;
    TRAIN.cars.forEach((m, k) => {
      if (!m.parent || k > 1) return;
      const t = front - TRAIN_L / 2 - k * (TRAIN_L + 0.6), [x, z] = at(t);
      m.visible = Math.abs(x - 12) < W.ROAD_EDGE + 40;                 // (sur les rails du passage à niveau : world.js plCrossing)
      if (m.visible) place(m, x, z, Math.atan2(ux, -uz), 0);
      // le véhicule du joueur sur la voie quand le train passe : accident
      const dx = taxi.x - x, dz = taxi.z - z;
      if (!TRAIN.hit && Math.abs(dx * ux + dz * uz) < TRAIN_L / 2 + 1.5 && Math.abs(-dx * uz + dz * ux) < 1.6 + taxi.bw / 2) {
        TRAIN.hit = true; crash(1.4); taxi.speed = 0; hud.toast('Le train t’a percuté ! Il ne fallait pas traverser.', 4); sound.trainHorn(0.16);
      }
    });
    if (active) {
      if ((TRAIN.bellT -= dt) <= 0) { TRAIN.bellT = 0.6; sound.bell(); }
      if (!TRAIN.horn) { TRAIN.horn = true; sound.trainHorn(0.12); }
      const ah = (C.z - taxi.z) * fwd;
      if (ah > 0 && ah < 70) G.prompt ||= '🚆 Train ! Arrête-toi au passage à niveau';
      for (const v of traffic.list) if (v.side === 1 && v.z > C.z + 4 && v.z - C.z < 45) v.stop = Math.max(v.stop, 0.6);   // (les voitures attendent)
    }
    if (tail > TRAIN.tc + 60) { TRAIN.crossDone.set(C.z, G.time); trainHide(); TRAIN.cd = 45 + Math.random() * 40; }
  }
}

function crash(strength) {
  G.crashCd = 1;
  G.shake = 1;
  G.crashes++;
  if (strength > 8 && !G.ambulance) { G.ambulance = true; traffic.sendAmbulance(taxi); }   // (choc violent : une ambulance vient, une fois par journée de collisions)
  G.repairs += REPAIR_COST;
  { const l = passengers.jolt(20); if (l) say(l, 'client'); }
  sound.crash(Math.min(0.7, 0.2 + strength * 0.05));
  navigator.vibrate?.(80);
  hud.toast(`Accrochage ! −${fmtFC(REPAIR_COST)} de tôlerie`, 2);
}

function drive(dt) {
  const inp = G.off || G.held || G.panne ? { steer: 0, throttle: 0, brake: 1 } : lunettes.on ? lunettes.input(taxi.speed) : input.state;   // (moto : conducteur descendu, ou chauffeur cogné qui barre la route : on ne bouge pas)
  taxi.steer += (inp.steer - taxi.steer) * Math.min(1, dt * 8);

  // Accélération / freinage / marche arrière
  const maxF = G.fuel > 0 ? MAX_FWD : 3;
  const prev = taxi.speed;
  let a = 0;
  if (inp.throttle) a += taxi.speed < -0.2 ? 12 : VEH.acc * Math.max(0, 1 - taxi.speed / maxF);
  if (inp.brake) {
    if (taxi.speed > 0.3) { a -= 15 * (1 - 0.35 * rain.wet); G.brakeHold = 0; }   // (route mouillée : on freine moins bien)
    else if ((G.brakeHold += dt) > 0.35) a -= 4;   // arrêt bref, puis marche arrière
  } else G.brakeHold = 0;
  a -= taxi.speed * 0.06;
  if (!inp.throttle && !inp.brake) a -= Math.sign(taxi.speed) * 1.2;
  taxi.speed += a * dt;
  if (prev > 0 && taxi.speed < 0 && !(inp.brake && G.brakeHold > 0.35)) taxi.speed = 0;
  if (prev < 0 && taxi.speed > 0 && !inp.throttle) taxi.speed = 0;
  if (taxi.speed > maxF) taxi.speed = Math.max(maxF, taxi.speed - 4 * dt);
  taxi.speed = clamp(taxi.speed, -MAX_REV, MAX_FWD);
  if (G.held && taxi.speed <= 0.3) taxi.speed = 0;               // (route barrée par le chauffeur cogné : arrêté, pas de marche arrière)

  // Direction : tour complet possible (demi-tour, routes secondaires), plus douce à haute vitesse. Sans action sur le
  // volant, le taxi se remet dans l'axe de la route où il roule s'il en est proche (il ne lutte pas contre un demi-tour)
  const sp = Math.abs(taxi.speed), isAth = VEH_ID === 'athlete';
  const power = isAth ? 2.4 : 1.2 * Math.min(1, sp / 5) * (1 - 0.4 * sp / MAX_FWD) * (1 - 0.25 * rain.wet);   // (route mouillée : la direction répond moins ; athlète : tourne même à l'arrêt)
  taxi.heading += taxi.steer * power * (isAth ? 1 : Math.sign(taxi.speed || 1)) * dt;
  if (Math.abs(inp.steer) < 0.1) {
    const axis = roadAxisAt(taxi.x, taxi.z);
    // (l'auteur, 10/11 : « les véhicules bloquent trop sur des traces ») : près d'une entrée d'avenue ou de station, d'un passage du terre-plein ou de la
    // terre, pas d'aide : on y tourne librement ; ailleurs, une aide plus douce, seulement quand on est presque dans l'axe
    if (axis !== null && !A.W.openingNear?.(taxi.x, taxi.z)) {
      const d0 = wrapA(axis - taxi.heading), d1 = wrapA(axis + Math.PI - taxi.heading), d = Math.abs(d0) < Math.abs(d1) ? d0 : d1;
      // (en quittant la Place de la Gare, où l'on arrive en biais : aide plus large, pour ne pas finir sur le trottoir)
      if (Math.abs(d) < (A.W.inPlaza(taxi.x, taxi.z) ? 0.9 : 0.3)) taxi.heading += d * Math.min(1, dt * 1.4 * Math.min(1, sp / 4));
    }
  }
  taxi.heading = wrapA(taxi.heading);

  // Saut-de-mouton : on reste sur la rampe ou en bas jusqu'à la fin (sur les deux chaussées) ; le pont de la route arrière
  // de l'Échangeur a son propre niveau ('pont', voir nextLevel)
  if (inFlyover(taxi.z, 2)) taxi.level ??= Math.abs(taxi.x) < RAMP_X ? 'up' : 'down';
  else if (taxi.level !== 'pont' && taxi.level !== 'sous') taxi.level = null;

  // Déplacement ; contre un obstacle (terre-plein, trottoir, rampe, bout de route), on glisse le long, choc si on arrive vite.
  // (dans le terre-plein élargi de l'Échangeur, un mètre de x route vaut plusieurs mètres réels : stretchX)
  const rawBlock = (x, z, l) => { const w = blockedAt(x, z, l); return isAth && (w === 'curb' || w === 'median') ? null : w; };
  const x0 = taxi.x, z0 = taxi.z, k = stretchX(taxi.x, taxi.z);
  const nx = taxi.x + Math.sin(taxi.heading) * taxi.speed * dt / k, nz = taxi.z - Math.cos(taxi.heading) * taxi.speed * dt;
  const lvl = nextLevel(taxi.level, taxi.x, taxi.z, nx, nz);
  const why = rawBlock(nx, nz, lvl) ?? (lvl ? null : solidAround(nx, nz, taxi.heading));
  if (!why || rawBlock(taxi.x, taxi.z, taxi.level) || ((why === 'obstacle' || why === 'gens' || why === 'vehicule') && solidAround(taxi.x, taxi.z, taxi.heading)) ||
      (why === 'travaux' && solidAround(taxi.x, taxi.z, taxi.heading) === 'travaux' && (taxi.speed < 0 || !worksDeep(nx, nz, taxi.heading)))) {   // (26/11 : collé aux barrières du chantier, on peut en sortir : le pas suivant ne doit plus toucher la barrière elle-même)
    taxi.x = nx; taxi.z = nz; taxi.level = lvl;
  } else {
    // (on ne glisse que dans un sens où le taxi avançait vraiment : de face contre un obstacle, il s'arrête)
    // (l'auteur, 13/11 : rien ne passe à travers) : on ne glisse que là où ni bordure ni obstacle du décor ni personne ne bloque
    const free = (x, z) => !rawBlock(x, z, taxi.level) && (taxi.level || !solidAround(x, z, taxi.heading));
    const axis = roadAxisAt(taxi.x, taxi.z);
    const diag = axis !== null && Math.abs(axis) > 0.05 ? (Math.cos(taxi.heading - axis) >= 0 ? axis : wrapA(axis + Math.PI)) : null;
    const step = taxi.speed * dt * Math.max(0.4, diag !== null ? Math.cos(taxi.heading - diag) : 1);
    const sx = diag !== null ? taxi.x + Math.sin(diag) * step / k : taxi.x;
    const sz = diag !== null ? taxi.z - Math.cos(diag) * step : taxi.z;
    const slideDiag = diag !== null && Math.abs(step) > 0.002 && free(sx, sz);
    const slideZ = !slideDiag && Math.abs(nz - taxi.z) > 0.002 && free(taxi.x, nz);
    const slideX = !slideDiag && !slideZ && Math.abs(nx - taxi.x) > 0.002 && free(nx, taxi.z);
    if (slideDiag) { taxi.x = sx; taxi.z = sz; }
    else if (slideZ) taxi.z = nz;
    else if (slideX) taxi.x = nx;
    taxi.level = nextLevel(taxi.level, x0, z0, taxi.x, taxi.z);
    if (sp > 4 && G.wallCd <= 0 && (!(slideDiag || slideZ || slideX) || Math.abs(slideDiag ? Math.sin(taxi.heading - diag) : slideZ ? Math.sin(taxi.heading) : Math.cos(taxi.heading)) > 0.12)) {
      G.wallCd = 1;
      taxi.speed *= 0.75;
      { const l = passengers.jolt(8); if (l) say(l, 'client'); }
      sound.crash(0.15);
      hud.toast(why === 'start' ? A.startMsg : WALL_MSG[why], 1.5);
    }
    // le taxi se remet le long de ce qu'il longe ; de face (bout d'une avenue), il s'arrête presque
    const along = diag !== null ? diag : slideZ ? (Math.cos(taxi.heading) >= 0 ? 0 : Math.PI) : slideX ? (Math.sin(taxi.heading) >= 0 ? Math.PI / 2 : -Math.PI / 2) : null;
    if (along !== null) taxi.heading = wrapA(taxi.heading + wrapA(along - taxi.heading) * 0.7);
    else taxi.speed *= 0.3;
  }
  taxi.y = Math.max(surfaceH(taxi.x, taxi.z, taxi.level), isAth && !taxi.level ? (A.W.pedHeight?.(taxi.x, taxi.z) ?? 0) : 0);   // rampe, remblai, ou trottoir pour l'athlète
  // (l'auteur, 10/11) sur l'accotement de terre : au pas, ça secoue, et les clients n'aiment pas
  if (!isAth && !taxi.level && A.W.onDirt?.(taxi.x, taxi.z)) {
    if (sp > 6) taxi.speed *= 1 - Math.min(1, dt * 1.6);
    if (sp > 2) { G.shake = Math.max(G.shake ?? 0, 0.25); if ((G.dirtT = (G.dirtT ?? 0) + dt) > 1.5) { G.dirtT = 0; const l = passengers.jolt(3); if (l) say(l, 'client'); } }
    if (!G.dirtWarned) { G.dirtWarned = true; hud.note('Tu roules sur la terre : doucement !', 2); }
  }

  // Carburant (pas pour l'athlète)
  if (!isAth) {
    G.fuel = Math.max(0, G.fuel - sp * dt * (0.0125 + inp.throttle * 0.006));
    if (G.fuel < 15 && !G.fuelWarned) { G.fuelWarned = true; hud.toast('Réservoir presque vide ! Passe à la station.', 3); }
    if (G.fuel > 25) G.fuelWarned = false;
  } else G.fuel = 100;

  return inp;
}

/** (l'auteur, 13/11 : travaux) Un chantier devant, sur la chaussée où l'on roule : on prévient une fois. */
const worksWarned = new Set();
function worksHint() {
  for (const Wk of A.W.WORKS ?? []) {
    const fwd = Math.cos(taxi.heading) >= 0 ? 1 : -1, d = (taxi.z - Wk.zt) * Wk.side;
    if (!Wk.on || worksWarned.has(Wk) || (taxi.x >= 0 ? 1 : -1) !== Wk.side || fwd !== Wk.side || d < 0 || d > 150) continue;
    worksWarned.add(Wk);
    hud.toast(Wk.outer ? 'Travaux devant : les voies de droite sont fermées, serre à gauche.' : 'Travaux devant : les voies de gauche sont fermées, serre à droite.', 4);
  }
}
/** (l'auteur, 13/11 : « rien ne doit passer transparent ») Le véhicule en (x, z), cap h, touche-t-il un obstacle du bord de la route (sur la terre),
 *  un passant ou des clients qui attendent ? On regarde ses quatre coins et le milieu de l'avant et de l'arrière. */
/** Le véhicule en (x, z), cap h, touche-t-il vraiment une barrière de chantier (sans la marge de 15 cm de solidAround) ? */
function worksDeep(x, z, h) {
  const c = Math.cos(h), s = Math.sin(h), hl = VEH.l / 2, hw = VEH.w / 2;
  for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]]) if (A.W.inWorks?.(x + s * a + c * b, z - c * a + s * b, 0)) return true;
  return false;
}
function solidAround(x, z, h) {
  const W = A.W, c = Math.cos(h), s = Math.sin(h), hl = VEH.l / 2, hw = VEH.w / 2;
  if (A.qlife?.vehicleAt(x, z)) return 'vehicule';                       // (une moto ou une voiture de Moboma sous le véhicule)
  for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl, 0], [-hl, 0], [0, hw], [0, -hw]]) {
    const px = x + s * a + c * b, pz = z - c * a + s * b;
    if (W.inWorks?.(px, pz, 0.15)) return 'travaux';                         // (l'auteur, 13/11 : les barrières et les cônes d'un chantier)
    if (Math.abs(px) < ROAD_EDGE + 0.6) continue;                          // (sur la chaussée)
    if ((W.onDirt?.(px, pz) || W.onSideApron?.(px, pz)) && W.obstacleAt?.(px, pz, 0.05)) return 'obstacle';
    for (const p of life.people) if (p.ch.mesh.visible && Math.abs(p.x - px) < 0.45 && Math.abs(p.z - pz) < 0.45) return 'gens';
    for (const r of life.runners ?? []) if (r.ch.mesh.visible && Math.abs(r.x - px) < 0.45 && Math.abs(r.z - pz) < 0.5) return 'gens';
    for (const q of A.qlife?.people ?? []) if (q.on && Math.abs(q.x - px) < 0.45 && Math.abs(q.z - pz) < 0.45) return 'gens';   // (les gens des quartiers)
    if (A.qlife?.vehicleAt(px, pz)) return 'vehicule';                     // (les motos et les voitures de Moboma)
    for (const q of passengers.clients) if (q.state === 'waiting' && q.root.visible && Math.sign(px) === q.side && Math.abs(px) < ROAD_EDGE + 2.1 && Math.abs(pz - q.z) < 1.5) return 'gens';
  }
  return null;
}

function handleTraffic(dt) {
  // Emprise du taxi selon son cap (en x : largeur, en z : longueur), pour les chocs avec la circulation
  const ch = Math.abs(Math.cos(taxi.heading)), sh = Math.abs(Math.sin(taxi.heading));
  taxi.bw = ch * VEH.w + sh * VEH.l; taxi.bl = ch * VEH.l + sh * VEH.w;
  // Circulation vivante sur les routes voisines quand on approche d'un raccord (Mandela / 30 Juin, Route Poids Lourds, Place de la Gare)
  for (const other of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) {
    if (!other || other === A || other.nearZ === null || other.nearZ === undefined) continue;
    const proxy = { x: 999, z: other.nearZ, speed: 0, heading: 0, bw: 2, bl: 4, level: 'pont', core: true };
    if (!other.nearActive) { other.nearActive = true; other.traffic.reset(proxy); }
    other.traffic.update(dt, proxy, G.time);
  }
  const hit = traffic.update(dt, taxi, G.time);
  if (!hit) return;
  const dz = taxi.z - hit.z, dx = taxi.x - hit.x;
  const penZ = (taxi.bl + hit.len) / 2 - Math.abs(dz);
  const penX = (taxi.bw + hit.wid) / 2 - Math.abs(dx);
  // vitesses vers -z (vers Limete) : le taxi selon son cap, la voiture selon son sens (côté -1 : elle roule vers +z)
  const vz = Math.cos(taxi.heading) * taxi.speed, hz = (hit.side === -1 ? -1 : 1) * (hit.speed ?? 0);
  let strength;
  if (penZ < penX) {
    if (!blockedAt(taxi.x, taxi.z + Math.sign(dz || 1) * penZ, taxi.level)) taxi.z += Math.sign(dz || 1) * penZ;
    strength = dz > 0 ? vz - hz : hz - vz;     // la voiture devant nous (vers -z) ou derrière nous : vitesse de rapprochement
    taxi.speed *= 0.5;
    if (hit.speed !== undefined) hit.speed = Math.max(0, hit.speed * 0.5);
  } else {
    if (!blockedAt(taxi.x + Math.sign(dx || 1) * penX, taxi.z, taxi.level)) taxi.x += Math.sign(dx || 1) * penX;
    taxi.heading = wrapA(taxi.heading + wrapA((Math.cos(taxi.heading) >= 0 ? 0 : Math.PI) - taxi.heading) * 0.6);
    taxi.speed *= 0.9;
    strength = 4;
  }
  if (hit.kind === 'moto' && !hit.fallen) strength = Math.max(strength, 3.2);
  // (l'auteur, 26/11 : demi-tour ou contresens, « il pousse le véhicule au lieu d'avoir l'accident ») : tout contact qui n'est pas dans le même sens que la
  // circulation (de travers, à contresens) est un vrai choc ; et pendant le délai entre deux chocs, le taxi s'arrête au lieu de pousser la voiture.
  const sameWay = Math.cos(taxi.heading) * (hit.side === -1 ? -1 : 1) > 0.5 && Math.abs(Math.sin(taxi.heading)) < 0.5;
  if (!sameWay) {
    strength = Math.max(strength, 4);
    if (G.crashCd > 0) { taxi.speed *= 0.3; if (hit.speed !== undefined) hit.speed = 0; }
  }
  if (VEH_ID === 'moto' && !G.wewaFall && strength > 1.8) { crash(strength); startWewaFall(hit); return; }
  if ((G.crashCd <= 0 || hit.kind === 'moto') && strength > 2.5) { crash(strength); incidents.onCrash(hit, strength); }
}

function handleStations(dt, inp) {
  // Voie extérieure de l'une ou l'autre chaussée (pas depuis Masina, ni d'un pont) : le plein se fait dans les deux sens ;
  // sur un petit boulevard ou l'aire d'une station, aux stations de ce côté
  const ax = Math.abs(taxi.x), level = taxi.level !== 'pont' && taxi.level !== 'sous';
  const inLane = level && ax > LANE_R - LANE_W / 2 + 0.3 && ax < ROAD_EDGE, pbSide = level ? fuelSideAt(taxi.x, taxi.z) : 0;
  for (const st of FUELS) {
    // (station avec une aire : on y fait le plein n'importe où sur l'aire, comme l'Engen du rond-point Victoire)
    if (st.area ? Math.hypot(taxi.x - st.area[0], taxi.z - st.area[1]) > st.area[2] || G.fuel >= 99.5 : (!inLane && pbSide !== st.side) || Math.abs(taxi.z - st.z) > 12 || G.fuel >= 99.5) continue;
    if (Math.abs(taxi.speed) > 1 || inp.throttle) { G.prompt ||= 'Arrête-toi pour faire le plein'; continue; }
    // (kadafi : l'essence en bidon, versée à l'entonnoir : plus lent, un peu plus cher)
    const add = Math.min(100 - G.fuel, (st.kadafi ? 8 : 20) * dt);
    G.fuel += add;
    G.fuelCost += add * FUEL_PRICE * (st.kadafi ? 1.2 : 1);
    G.prompt = st.kadafi ? `Kadafi : essence en bidon… ${Math.round(G.fuel)} %` : `Plein en cours… ${Math.round(G.fuel)} %`;
  }
}

/** Feux tricolores : message en approchant du rouge, amende si le taxi passe la ligne d'arrêt au rouge. */
function handleSignals(zBefore) {
  if (!SIGNALS.length) return;
  const st = signalState(G.time).main;
  // Sur la chaussée de droite on va vers -z (ligne stopR), sur celle de gauche vers +z (ligne stopL), en conduite libre
  const right = taxi.x > 0, c = Math.cos(taxi.heading);
  for (const sg of SIGNALS) {
    const crossed = right ? zBefore > sg.stopR && taxi.z <= sg.stopR : zBefore < sg.stopL && taxi.z >= sg.stopL;
    const near = right ? c > 0.3 && taxi.z > sg.stopR && taxi.z - sg.stopR < 45 : c < -0.3 && taxi.z < sg.stopL && sg.stopL - taxi.z < 45;
    if (crossed && st === 'red') {
      infraction('Feu rouge grillé', FINE_RED);
      sound.horn(false);
    } else if (st !== 'green' && near) {
      G.prompt ||= st === 'red' ? 'Feu rouge : arrête-toi avant la ligne' : 'Feu orange : ralentis';
    }
  }
}

// ---------- La police (l'auteur, 07/11 : « je fais des infractions mais la police ne m'arrête pas ») ----------
// Une infraction (feu rouge, contresens prolongé) : la police arrive derrière le taxi, sirène, et lui fait signe de se garer. S'il s'arrête, contrôle :
// l'amende et du temps perdu. S'il ne s'arrête pas, délit de fuite : amende plus forte, et la police le recherche.
const POLICE_LINES = ['Pemba ! Gare-toi sur le côté.', 'Mokanda na yo ! Tes papiers, chauffeur.', 'Ozali kotambola ndenge nini ? Tu roules comment, toi ?'];
function infraction(what, fine) {
  if (G.police) { G.police.fine += fine; G.police.what.push(what); return; }
  const c = traffic.chaseTaxi(taxi);
  G.police = { fine, what: [what], t: 0, near: 0, stopT: 0 };
  hud.toast(`${what} ! La police arrive…`, 3);
  if (!c) G.police.t = 999;                       // (pas de voiture de police sur cette route : l'amende tout de suite)
}
// Le contrôle se voit (l'auteur, 08/11 : « montrer comment il sort de la voiture ou descend de la moto ») : le chauffeur ouvre et sort côté gauche,
// un policier descend de sa voiture et vient le voir ; à la fin, chacun remonte.
function startControl(P) {
  const c = traffic.taxiChaser(taxi), s = Math.cos(taxi.heading) >= 0 ? 1 : -1, left = -s, moto = VEH_ID === 'moto';
  const seat = [taxi.x + left * (moto ? 0.1 : 0.4), taxi.z], door = [taxi.x + left * (moto ? 0.8 : taxi.bw / 2 + 0.5), taxi.z + s * (moto ? 0.2 : -0.2)];
  const car = c ? [c.v.x + left * 1.1, c.v.z - s * 0.5] : [taxi.x + left * 1.2, taxi.z + s * 14];
  const actor = o => { const ch = new Character(o); A.group.add(ch.mesh); ch.mesh.visible = false; return { ch, x: 0, z: 0, yaw: 0, path: null }; };
  const S = P.scene = { t: 0, dur: P.control, s, moto, seat, door, car, road: A, driver: actor(outfit('man', { shirt: 0xf2f2f2 })), officer: actor(outfit('police')) };
  const d = S.driver, o = S.officer, meet = [door[0] + left * 0.1, door[1] + s * 1.3];
  [d.x, d.z] = seat; d.path = [seat, door, 0.5, 1.6];
  [o.x, o.z] = car; o.path = [car, meet, 1.2, 1.2 + Math.hypot(meet[0] - car[0], meet[1] - car[1]) / 2]; o.spd = 2;
  S.meet = meet;
}
// ---------- Moto : le conducteur descend et remonte (l'auteur, 08/11 : « donne la possibilité au motocycliste de descendre aussi de la moto ») ----------
// Moto arrêtée : bouton « Descendre » (ou E). Le conducteur descend à gauche et se tient à côté de sa moto ; « Monter » : il remonte et on repart.
function dismountToggle() {
  if (G.state !== 'play' || VEH_ID !== 'moto') return;
  const O = G.off;
  if (O) { if (O.phase === 'down' && O.t > O.t1) { O.phase = 'up'; O.a.path = [[O.a.x, O.a.z], O.seat, O.t, O.t + 0.7]; } return; }
  if (Math.abs(taxi.speed) > 0.5 || G.police || G.accident || G.race || lunettes.on) return;
  const s = Math.cos(taxi.heading) >= 0 ? 1 : -1, left = -s;
  const seat = [taxi.x + left * 0.1, taxi.z], stand = [taxi.x + left * 1.1, taxi.z + s * 0.4];
  const ch = new Character(outfit('man', { shirt: 0xd6dc24 }));
  A.group.add(ch.mesh);
  const a = { ch, x: seat[0], z: seat[1], yaw: 0, path: [seat, stand, 0.2, 1.0] };
  G.off = { a, t: 0, t1: 1.0, phase: 'down', seat, road: A, face: s > 0 ? Math.PI / 2 : -Math.PI / 2 };
  taxiMesh.traverse(m => { if (m.userData.rider === 'conducteur') m.visible = false; });
  say('Nakita mwa… — Je descends un instant.', 'client', 2);
}
function dismountScene(dt) {
  const O = G.off, btn = $('btn-descendre');
  const can = G.state === 'play' && VEH_ID === 'moto' && !G.police && !G.accident && !G.race && !lunettes.on && (O || Math.abs(taxi.speed) < 0.5);
  btn.hidden = !can;
  if (can) btn.textContent = O ? '🏍️ Monter' : '🧍 Descendre';
  if (!O) return;
  taxi.speed = 0;
  const t = (O.t += dt);
  moveActor(O.a, t, G.time);
  if (O.phase === 'down' && t > O.t1 && !O.turned) { O.turned = true; O.a.yaw = taxi.heading + O.face; }   // (debout, tourné vers sa moto)
  if (O.phase === 'up' && t > O.a.path[3]) dismountEnd();
}
function dismountEnd() {
  const O = G.off;
  if (!O) return;
  G.off = null;
  O.road.group.remove(O.a.ch.mesh);
  taxiMesh.traverse(m => { if (m.userData.rider) m.visible = true; });
  $('btn-descendre').hidden = true;
}
$('btn-descendre').addEventListener('click', dismountToggle);
addEventListener('keydown', e => { if (e.code === 'KeyE' && G.state === 'play') dismountToggle(); });

// ---------- Panne sèche (l'auteur, 26/11) ----------
// Quand le carburant finit, le véhicule est garé là où il s'arrête. Avec de l'argent, on envoie le receveur (ou on y va soi-même) : il descend avec un bidon,
// marche jusqu'à la station la plus proche, achète l'essence, revient, ouvre le coffre et verse. Sans argent, le jeu s'arrête là.
const BIDON_PCT = 25, BIDON_FC = BIDON_PCT * FUEL_PRICE, PANNE_WALK = 4;
function panneBidon() {
  const g = new THREE.Group(), red = new THREE.MeshLambertMaterial({ color: 0xc8102e });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.17), red));
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.08), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  cap.position.set(0.08, 0.24, 0);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.05), red);
  grip.position.set(-0.05, 0.24, 0);
  g.add(cap, grip);
  return g;
}
/** Le coffre ouvert : un volet sombre relevé à l'arrière du véhicule. */
function panneCoffre() {
  const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.3, VEH.w * 0.75), 0.05, 0.7), new THREE.MeshLambertMaterial({ color: 0x2a2f36 }));
  m.position.set(0, 0, -0.35);
  g.add(m);
  g.position.set(0, VEH_ID === 'bus' ? 1.1 : 0.98, VEH.l / 2);
  g.rotation.x = -1.15;
  return g;
}
function panneStart() {
  const P = G.panne = { phase: 'stop', t: 0 };
  taxi.speed = Math.min(taxi.speed, 3);
  hud.toast('Panne d’essence ! Le réservoir est vide.', 3.5);
  say('Essence esili ! — On n’a plus d’essence !', 'client', 3.5);
  return P;
}
function panneEnd() {
  const P = G.panne;
  if (!P) return;
  if (P.a) A.group.remove(P.a.ch.mesh);
  if (P.coffre) taxiMesh.remove(P.coffre);
  if (rcv) rcv.ch.mesh.visible = true;
  taxiMesh.traverse(m => { if (m.userData.rider === 'conducteur') m.visible = true; });
  G.panne = null;
}
/** Le plan de marche : la porte, le bas-côté, la station, et le retour par le coffre. Un trajet trop long se fait hors de vue (le temps passe quand même). */
function panneGo(P, receveur) {
  const s = Math.cos(taxi.heading) >= 0 ? 1 : -1, sx = taxi.x >= 0 ? 1 : -1, fw = [Math.sin(taxi.heading), -Math.cos(taxi.heading)];
  const door = [taxi.x + (receveur ? sx : -sx) * (taxi.bw / 2 + 0.55), taxi.z];
  const rear = [taxi.x - fw[0] * (taxi.bl / 2 + 0.9), taxi.z - fw[1] * (taxi.bl / 2 + 0.9)];
  const vergeX = Math.abs(taxi.x) < ROAD_EDGE ? taxi.x + sx * (ROAD_EDGE - Math.abs(taxi.x) + 1.8) : taxi.x + sx * 2;
  const pool = FUELS.filter(f => !f.kadafi).length ? FUELS.filter(f => !f.kadafi) : FUELS;
  const zOf = f => (f.area ? f.area[1] : f.z);
  const st = pool.slice().sort((a, b) => Math.abs(zOf(a) - taxi.z) - Math.abs(zOf(b) - taxi.z))[0];
  const zS = st ? zOf(st) : taxi.z - s * 200, dist = Math.abs(zS - taxi.z), dir = zS < taxi.z ? -1 : 1;
  const vis = Math.min(dist, 150);                                                // (au-delà, il disparaît au loin)
  P.station = st?.name ?? 'une station';
  P.dist = dist;
  P.pts = [door, [vergeX, door[1]], [vergeX, taxi.z + dir * vis]];
  P.hidden = Math.min(18, Math.max(0, (dist - vis) * 2 / PANNE_WALK));          // (secondes hors de vue, aller-retour)
  P.back = [[vergeX, taxi.z + dir * vis], [vergeX, rear[1]], rear];
  P.rear = rear; P.door = door; P.vergeX = vergeX;
  const ch = new Character(outfit('man', { shirt: receveur ? 0x1d4fa0 : 0xf2f2f2, cap: receveur ? 0xf4f4f4 : null }));
  A.group.add(ch.mesh);
  P.bidon = ch.hold(panneBidon());
  P.a = { ch, x: door[0], z: door[1], yaw: 0 };
  P.receveur = receveur;
  if (receveur && rcv) rcv.ch.mesh.visible = false;
  if (!receveur) taxiMesh.traverse(m => { if (m.userData.rider === 'conducteur') m.visible = false; });
  P.leg = null; P.phase = 'out';
  say(receveur ? 'Ya mwana, kende mua kosomba bidon ! — Vas acheter un bidon d’essence !' : 'Nakende mua kosomba essence… — Je vais acheter de l’essence.', 'client', 3.5);
}
/** Fait avancer P.a le long de pts à vitesse constante ; renvoie vrai quand il est arrivé. */
function panneWalk(P, pts, dt) {
  if (!P.leg || P.leg.pts !== pts) P.leg = { pts, i: 0, k: 0 };
  const L = P.leg, a = P.a;
  let left = PANNE_WALK * dt;
  while (left > 0 && L.i < pts.length - 1) {
    const p = pts[L.i], q = pts[L.i + 1], d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-3, remain = d * (1 - L.k);
    const step = Math.min(left, remain);
    L.k += step / d; left -= step;
    a.yaw = Math.atan2(-(q[0] - p[0]), q[1] - p[1]) + Math.PI;
    if (L.k >= 0.9999) { L.i++; L.k = 0; }
  }
  const done = L.i >= pts.length - 1;
  if (done) [a.x, a.z] = pts[pts.length - 1];
  else [a.x, a.z] = lerp2(pts[L.i], pts[L.i + 1], L.k);
  a.ch.pose(done ? 'idle' : 'walk', G.time, 1.9);
  place(a.ch.mesh, a.x, a.z, a.yaw, 0);
  return done;
}
function panneScene(dt) {
  let P = G.panne;
  if (G.state !== 'play') { if (P) panneEnd(); return; }
  if (!P) {
    if (VEH_ID === 'athlete' || G.fuel > 0.05 || G.off || G.held || G.police || G.accident || G.race || G.wewaFall) return;
    P = panneStart();
  }
  P.t += dt;
  G.prompt = '';
  if (P.phase === 'stop') {
    if (Math.abs(taxi.speed) > 0.3 && P.t < 8) return;
    taxi.speed = 0;
    const cash = G.fares + G.tips - G.fuelCost - G.repairs - G.fines - (G.stolen ?? 0);
    if (cash < BIDON_FC) {
      P.phase = 'over'; P.t = 0;
      hud.toast(`Plus assez d’argent pour un bidon (${fmtFC(BIDON_FC)}) : le jeu s’arrête ici.`, 5);
      say('Mbongo ezali te… Tokoki lisusu kokende te. — Plus d’argent… on ne peut plus avancer.', 'client', 4);
      return;
    }
    P.phase = 'ask';
    if (VEH_ID === 'moto') { panneGo(P, false); return; }
    askChoice(`Panne d’essence ! Un bidon de ${BIDON_PCT} % coûte ${fmtFC(BIDON_FC)}. Qui va à la station ?`, 'Le receveur', 'Moi-même', yes => { if (G.panne === P && P.phase === 'ask') panneGo(P, !!yes); });
    return;
  }
  if (P.phase === 'over') { if (P.t > 5) { panneEnd(); endShift('panne'); } return; }
  if (P.phase === 'ask') { if (lunettes.on && P.t > 3) panneGo(P, false); return; }
  const a = P.a;
  if (P.phase === 'out') {
    if (panneWalk(P, P.pts, dt)) {
      P.phase = 'far'; P.t = 0;
      if (P.hidden > 0) a.ch.mesh.visible = false;
      hud.toast(`Il va à ${P.station} (${Math.round(P.dist)} m)…`, 3);
    }
  } else if (P.phase === 'far') {                                                // (à la station : il attend, achète, et repart)
    if (P.t > P.hidden + 3) {
      a.ch.mesh.visible = true;
      G.time += Math.min(900, P.dist * 2 / 1.3) * SHIFT_SECONDS / (720 * 60);      // (le temps réellement perdu : marche aller-retour à 1,3 m/s ; 1 min de jeu = SHIFT_SECONDS / 720 s)
      G.fuelCost += BIDON_FC;
      hud.toast(`Bidon payé : ${fmtFC(BIDON_FC)}. Retour au véhicule.`, 3);
      P.phase = 'back'; P.leg = null;
    }
  } else if (P.phase === 'back') {
    if (panneWalk(P, P.back, dt)) { P.phase = 'boot'; P.t = 0; a.yaw = taxi.heading; P.coffre = panneCoffre(); taxiMesh.add(P.coffre); hud.toast('Il ouvre le coffre…', 2.5); }
  } else if (P.phase === 'boot') {                                               // (il ouvre, verse, referme)
    a.ch.pose('idle', G.time);
    place(a.ch.mesh, a.x, a.z, a.yaw, 0);
    if (P.t > 3.2 && !P.poured) { P.poured = true; G.fuel = Math.min(100, G.fuel + BIDON_PCT); P.bidon.visible = false; hud.toast(`Il verse l’essence : +${BIDON_PCT} % de carburant.`, 3); }
    if (P.t > 5.4) { taxiMesh.remove(P.coffre); P.coffre = null; hud.toast('Coffre fermé.', 1.5); P.phase = 'in'; P.leg = null; P.door2 = [P.rear, [P.vergeX, P.rear[1]], [P.vergeX, P.door[1]], P.door]; }
  } else if (P.phase === 'in') {
    if (panneWalk(P, P.door2, dt)) { say('Yaka tokende ! — Allons-y !', 'client', 2.5); hud.toast('On repart !', 2); panneEnd(); }
  }
}

// ---------- Chute du wewa du joueur avec ses clients lorsqu'un véhicule le tamponne ----------
function startWewaFall(hit) {
  if (G.wewaFall || G.accident || G.police?.control > 0) return;
  if (G.off) dismountEnd();
  taxi.speed = 0;
  if (hit && hit.stop !== undefined) hit.stop = Math.max(hit.stop ?? 0, 5.5);
  if (hit && hit.speed !== undefined) hit.speed = 0;
  const side = taxi.x >= (hit?.x ?? taxi.x) ? 1 : -1, roll = side * 1.42;
  taxiMesh.traverse(m => { if (m.userData.rider) m.visible = false; });
  for (const r of BOARD.riders) if (r.ch?.mesh) r.ch.mesh.visible = false;
  const mk = (o, x0, z0, x1, z1, yaw) => {
    const ch = new Character(o);
    A.group.add(ch.mesh);
    place(ch.mesh, x0, z0, yaw, surfaceH(x0, z0, taxi.level) + 0.25);
    ch.mesh.rotation.x = -Math.PI / 2;
    return { ch, x0, z0, x1, z1, x: x0, z: z0, yaw, down: true, walking: false };
  };
  const driver = mk(outfit('man', { shirt: 0xd6dc24, cap: 0x1a2a55, idle: 1 }), taxi.x, taxi.z - 0.1, taxi.x + side * 1.05, taxi.z - 0.55, taxi.heading + 0.35);
  // (l'auteur, 22/11 : « je suis seul dans ma moto mais quand on me tamponne je tombe avec 2 personnes ») : seuls ceux qui sont vraiment à bord tombent avec le conducteur
  const riderOutfits = BOARD.riders.map(r => r.ch?.outfit ?? outfit(Math.random() < 0.5 ? 'woman' : 'man'));
  const clients = riderOutfits.slice(0, 2).map((o, i) =>
    mk(o, taxi.x, taxi.z + 0.35 + i * 0.3, taxi.x + side * (1.5 - i * 0.55), taxi.z + 0.25 + i * 0.65, taxi.heading + (i ? 0.9 : -0.5))
  );
  G.wewaFall = { t: 0, side, roll, curRoll: 0, road: A, driver, clients, actors: [driver, ...clients] };
  say(clients.length ? 'Aïe ! Wewa akweyi na ba clients na ye ! — Le wewa est tombé avec ses clients !' : 'Aïe ! Wewa akweyi ! — Le wewa est tombé !', 'client', 4);
  sound.voice('Aïe ! Wewa akweyi !', { pitch: 1.05, rate: 1.15 });
  hud.toast(clients.length ? 'Accident ! Ton wewa est tombé avec ses clients !' : 'Accident ! Ton wewa est tombé !', 3.8);
}
function wewaFallScene(dt) {
  const S = G.wewaFall;
  if (!S) return;
  const t = (S.t += dt);
  taxi.speed = 0;
  G.prompt = S.clients.length ? 'Chute à moto… le wewa et ses clients se relèvent' : 'Chute à moto… le wewa se relève';
  if (t < 0.35) S.curRoll = S.roll * smooth(t / 0.35);
  else if (t < 3.4) S.curRoll = S.roll;
  else if (t < 4.2) S.curRoll = S.roll * (1 - smooth((t - 3.4) / 0.8));
  else S.curRoll = 0;
  for (let i = 0; i < S.actors.length; i++) {
    const a = S.actors[i], isDriver = i === 0;
    if (t < 0.45) {
      const k = smooth(t / 0.45);
      a.x = a.x0 + (a.x1 - a.x0) * k;
      a.z = a.z0 + (a.z1 - a.z0) * k;
    } else if (isDriver && t > 2.4 && t < 3.5) {
      a.down = false;
      const k = smooth((t - 2.6) / 0.8);
      a.walking = k > 0 && k < 1;
      a.x = a.x1 + (taxi.x + S.side * 0.45 - a.x1) * k;
      a.z = a.z1 + (taxi.z - 0.1 - a.z1) * k;
    } else if (!isDriver && t > 2.9 && t < 4.2) {
      a.down = false;
      const k = smooth((t - 3.2) / 0.9);
      a.walking = k > 0 && k < 1;
      a.x = a.x1 + (taxi.x + S.side * 0.3 - a.x1) * k;
      a.z = a.z1 + (taxi.z + 0.4 - a.z1) * k;
    } else {
      a.walking = false;
    }
    a.ch.pose(a.down ? 'idle' : a.walking ? 'walk' : 'idle', a.down ? 0 : G.time, 1.8);
    place(a.ch.mesh, a.x, a.z, a.yaw, surfaceH(a.x, a.z, taxi.level) + (a.down ? 0.25 : 0));
    a.ch.mesh.rotation.x = a.down ? -Math.PI / 2 : 0;
  }
  if (t >= 4.4) {
    for (const a of S.actors) S.road.group.remove(a.ch.mesh);
    taxiMesh.traverse(m => { if (m.userData.rider) m.visible = true; });
    for (const r of BOARD.riders) if (r.ch?.mesh) r.ch.mesh.visible = true;
    taxiMesh.rotation.z = 0;
    G.wewaFall = null;
    G.crashCd = 1.5;
  }
}

// La bagarre (l'auteur, 08/11 : « le chauffeur doit se bagarrer aussi avec les policiers et fuir ») : pendant le contrôle, le joueur peut
// appuyer sur « S'enfuir » (ou F) ; le chauffeur et le policier se battent, le chauffeur court à son véhicule et démarre, la police le poursuit.
function startFight() {
  const P = G.police, S = P?.scene;
  if (!S || S.fight || S.back || P.hitRun || S.t < 1.6) return;
  // (le policier n'est pas encore arrivé : il accourt d'abord)
  const o = S.officer, far = Math.hypot(S.meet[0] - o.x, S.meet[1] - o.z);
  o.path = [[o.x, o.z], S.meet, S.t, S.t + far / 4]; o.spd = 4;
  S.fight = { t: 0, start: far / 4 };
  $('btn-flee').hidden = true;
  say('Tika ngai ! Nasali eloko te ! — Lâche-moi ! Je n’ai rien fait !', 'client', 2.5);
  sound.voice('Tika ngai !', { pitch: 0.95, rate: 1.1 });
}
function fightScene(S, dt, t, time) {
  const F = S.fight, d = S.driver, o = S.officer;
  if ((F.start -= dt) > 0) { for (const a of [d, o]) if (a.ch.mesh.visible) moveActor(a, t, time); return; }
  const ft = (F.t += dt);
  if (!F.run) {
    // ils se battent : face à face, poussées en avant et en arrière
    const yaw = Math.atan2(-(d.x - o.x), d.z - o.z) + Math.PI, push = Math.sin(ft * 7) * 0.12;
    o.yaw = yaw; d.yaw = yaw + Math.PI;
    const ux = (d.x - o.x), uz = (d.z - o.z), n = Math.hypot(ux, uz) || 1;
    d.ch.pose('fight', time); o.ch.pose('fight', time + 0.45);
    place(d.ch.mesh, d.x + ux / n * push, d.z + uz / n * push, d.yaw, 0);
    place(o.ch.mesh, o.x + ux / n * push, o.z + uz / n * push, o.yaw, 0);
    if (ft > 1.3 && !F.said) { F.said = true; say('Telema ! Okokanga yo ! — Arrête ! Tu vas finir en prison !', 'police', 2.5); }
    if (ft < 2.6) return;
    // (l'auteur, 10/11 : « le chauffeur peut résister aussi face aux policiers ») : une fois sur deux le policier renonce, pas d'amende ;
    // sinon le chauffeur court à son véhicule, le policier à sa voiture, et la poursuite commence
    F.run = true;
    F.win = Math.random() < 0.5;
    if (F.win) { say('Eh, kende ! Lelo natiki yo… — Va-t’en ! Aujourd’hui je te laisse…', 'police', 3); hud.toast('Tu as résisté : le policier renonce, pas d’amende.', 3.5); }
    d.path = [[d.x, d.z], S.door, t, t + 0.45]; d.next = [S.door, S.seat, t + 0.45, t + 0.75]; d.spd = F.win ? 1.6 : 4;
    o.path = [[o.x, o.z], S.car, t + 0.3, t + 0.3 + Math.hypot(S.car[0] - o.x, S.car[1] - o.z) / (F.win ? 1.6 : 4)]; o.spd = F.win ? 1.6 : 4;
  }
  if (d.next && t > d.path[3]) { d.path = d.next; d.next = null; }
  for (const a of [d, o]) if (a.ch.mesh.visible) moveActor(a, t, time);
  if (ft > (F.win ? 4.6 : 3.4) && d.ch.mesh.visible) { d.ch.mesh.visible = false; taxiMesh.traverse(m => { if (m.userData.rider) m.visible = true; }); }
  if (F.win) { if (ft > 5.2) { const P = G.police; endControl(P); P.control = 0; G.police = null; traffic.endTaxiChase(); } return; }
  if (ft > 4.4) fleeControl(G.police);
}
/** Fin de la bagarre : le chauffeur est au volant, la police le poursuit ; rattrapé, il est arrêté. */
function fleeControl(P) {
  endControl(P);
  P.control = 0;
  P.fine += 50000;
  P.what.push('Bagarre avec la police');
  P.hitRun = true; P.bagarre = true;
  P.t = 0; P.near = 0; P.stopT = 0; P.closeT = 0; P.sceneDone = false;
  const c = traffic.taxiChaser(taxi);
  if (c) { c.v.chase.t = 60; c.v.speed = 0; }
  hud.toast('Tu t’enfuis ! La police te poursuit.', 3.5);
}
function controlScene(dt) {
  const S = G.police?.scene;
  if (!S) return;
  const t = (S.t += dt), d = S.driver, o = S.officer, time = G.time;
  $('btn-flee').hidden = !!(S.fight || S.back || G.police.hitRun || t < 1.6 || lunettes.on);
  if (S.fight) { fightScene(S, dt, t, time); return; }
  if (t > 0.5 && !d.ch.mesh.visible) { d.ch.mesh.visible = true; if (S.moto) taxiMesh.traverse(m => { if (m.userData.rider === 'conducteur') m.visible = false; }); }
  if (t > 1.2) o.ch.mesh.visible = true;
  if (t > S.dur - 2.6 && !S.back) {                                 // fin du contrôle : chacun retourne à son véhicule
    S.back = true;
    d.path = [[d.x, d.z], S.door, t + 0.4, t + 1.3];
    d.next = [S.door, S.seat, t + 1.3, t + 2];
    o.path = [[o.x, o.z], S.car, t, t + Math.hypot(S.car[0] - o.x, S.car[1] - o.z) / 1.4];
  }
  if (d.next && t > d.path[3]) { d.path = d.next; d.next = null; }
  for (const a of [d, o]) if (a.ch.mesh.visible) moveActor(a, t, time);
  // l'un face à l'autre pendant le contrôle
  if (!S.back && t > o.path[3]) { o.yaw = Math.atan2(-(d.x - o.x), d.z - o.z) + Math.PI; d.yaw = o.yaw + Math.PI; }
  if (S.back && t > S.dur - 0.6) d.ch.mesh.visible = false;
}
function endControl(P) {
  $('btn-flee').hidden = true;
  const S = P?.scene;
  if (!S) return;
  P.scene = null;
  for (const a of [S.driver, S.officer]) S.road.group.remove(a.ch.mesh);
  taxiMesh.traverse(m => { if (m.userData.rider) m.visible = true; });
}
function handlePolice(dt) {
  const P = G.police;
  if (!P) return;
  if (P.control > 0) {                             // contrôle en cours : le taxi est arrêté
    taxi.speed = 0;
    G.prompt = `Contrôle de police… ${Math.ceil(P.control)} s`;
    if (!P.scene && !P.sceneDone) { P.sceneDone = true; startControl(P); }
    controlScene(dt);
    if (G.police !== P || P.control <= 0) return;   // (bagarre : le chauffeur s'est enfui)
    if (!P.scene?.fight && (P.control -= dt) <= 0) {
      endControl(P);
      if (P.hitRun) { G.fines += P.fine; G.police = null; traffic.endTaxiChase(); G.caughtRun = P.bagarre ? 'bagarre' : true; endShift('arret'); return; }
      G.fines += P.fine;
      hud.toast(`Amende : ${fmtFC(P.fine)} (${P.what.join(', ')}). Okoki kokende, tu peux partir.`, 4);
      G.police = null;
      traffic.endTaxiChase();
    }
    return;
  }
  P.t += dt;
  const c = traffic.taxiChaser(taxi);
  if (P.t > 900) { G.fines += P.fine; hud.toast(`${P.what.join(', ')} : amende de ${fmtFC(P.fine)}`, 3.5); G.police = null; return; }
  if (c && c.behind > 2 && c.behind < 25) {
    P.near += dt;
    G.prompt ||= '🚓 La police te fait signe : arrête-toi';
    if ((P.sayT = (P.sayT ?? 0) - dt) <= 0) { P.sayT = 5; const l = POLICE_LINES[Math.floor(P.t / 5) % POLICE_LINES.length]; say(l, 'police', 3.5); sound.voice(l.split('!')[0] + ' !', { pitch: 0.75, rate: 1 }); }
    if (Math.abs(taxi.speed) < 1) { if ((P.stopT += dt) > 1) { P.control = 12; hud.toast(P.hitRun ? 'La police t’arrête.' : 'Contrôle de police : ne bouge pas.', 3); sound.horn(false); } }
    else P.stopT = 0;
    // collée au véhicule pendant 3 s : la police le rattrape et le force à s'arrêter
    if (c.behind < 13) { if ((P.closeT = (P.closeT ?? 0) + dt) > 3) { taxi.speed = 0; P.control = 8; hud.toast('La police t’a rattrapé !', 3.5); say('Telema ! Okangami ! — Stop ! Tu es arrêté !', 'police', 3.5); } }
    else P.closeT = 0;
  }
  if (!c || P.t > (P.hitRun ? 70 : 40)) {                            // la poursuite s'arrête : s'il ne s'est jamais arrêté, délit de fuite
    G.fines += P.fine * 2;
    hud.toast(`Délit de fuite ! Amende doublée : ${fmtFC(P.fine * 2)}`, 4);
    G.police = null;
    traffic.endTaxiChase();
  }
}

/** Après avoir renversé un piéton : s'arrêter (la scène de l'accident, arrestation), ou fuir (délit de fuite : la police poursuit le véhicule). */
function handleHitRun(dt) {
  const H = G.hitRun;
  if (!H) return;
  H.t += dt;
  const far = Math.abs(taxi.z - H.p.z) > 50 || A !== H.road && H.road;
  H.road ??= A;
  if (Math.abs(taxi.speed) < 1 && !far) {
    G.prompt ||= 'Tu t’arrêtes… la police arrive.';
    if ((H.stopT += dt) > 1.5) { G.hitRun = null; startAccident(H.p); }
    return;
  }
  H.stopT = 0;
  if (far) {
    G.hitRun = null;
    if (G.police) { G.police.fine += 100000; G.police.what.push('Délit de fuite après un accident'); G.police.hitRun = true; }
    else { infraction('Délit de fuite après un accident', 100000); if (G.police) G.police.hitRun = true; }
    const c = traffic.taxiChaser(taxi);
    if (c) c.v.chase.t = 60;
    say('Polisi ! Akimi ! — Police ! Il s’enfuit !', 'client', 3.5);
    hud.toast('Délit de fuite ! La police te poursuit.', 4);
  } else G.prompt ||= 'Arrête-toi pour le blessé, ou fuis…';
}

/** Un piéton qui traverse sous les roues : il tombe. Amende, et l'ambulance vient (la scène complète, avec l'arrestation : étape suivante). */
function pedestrians() {
  for (const p of life.crossers) {
    if (!p.active || p.fallen || Math.abs(taxi.speed) < 2.5) continue;
    if (Math.abs(p.x - taxi.x) < taxi.bw / 2 + 0.3 && Math.abs(p.z - taxi.z) < taxi.bl / 2 + 0.3) {
      life.knockDown(p);
      taxi.speed *= 0.3;
      G.crashes++;
      sound.crash(0.5);
      navigator.vibrate?.(200);
      // (l'auteur, 08/11 : le chauffeur n'est pas obligé de s'arrêter ; s'il fuit, la police le poursuit)
      G.hitRun = { p, t: 0, stopT: 0 };
      traffic.sendAmbulance(taxi);
      say('Aïe ! Akweyisi moto ! Kanga ye ! — Il a renversé quelqu’un ! Arrêtez-le !', 'client', 4);
      hud.toast('Piéton renversé ! Arrête-toi… ou fuis.', 4);
      return;
    }
  }
}

// ---------- La scène de l'accident (l'auteur, 07/11) : le piéton tombe, les gens accourent, la police arrive et emmène le chauffeur, le véhicule est
// poussé sur le côté, l'ambulance emmène le piéton à l'hôpital ; la journée s'arrête. Tout se passe sur la route où roule le véhicule (coordonnées route). ----------
const ACC_FINE = 50000;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function startAccident(p) {
  const h = taxi.heading, dz = Math.cos(h) >= 0 ? 1 : -1;            // dz : le véhicule roulait vers -z (1) ou vers +z (-1)
  const vx = p.x >= 0 ? LANE_R : -LANE_R, vh = p.x >= 0 ? 0 : Math.PI, vdz = p.x >= 0 ? 1 : -1;
  G.accident = { t: 0, p, tx: taxi.x, tz: taxi.z, h, dz, actors: [], props: [], cam: Math.random() * 6,
    police: { from: [taxi.x, taxi.z + dz * 80], to: [taxi.x, taxi.z + dz * 11] },
    amb: { from: [vx, p.z + vdz * 90], to: [vx, p.z + vdz * 8], h: vh, dz: vdz } };
  const A_ = G.accident;
  taxi.speed = 0;
  G.fines += ACC_FINE;
  sound.crash(0.6);
  sound.horn(false);
  navigator.vibrate?.(250);
  input.releaseAll();
  $('choice').hidden = true;
  for (const v of traffic.list) if (Math.abs(v.z - taxi.z) < 90) v.mesh.visible = false;   // (la circulation s'arrête autour)
  const add = (m, x, z, yaw) => { A.group.add(m); place(m, x, z, yaw, 0); A_.props.push(m); return m; };
  A_.policeCar = add(createPolicePickup(), ...A_.police.from, h);
  A_.ambulance = add(createAmbulance(), ...A_.amb.from, vh);
  const actor = (o, x, z) => { const ch = new Character(o); A.group.add(ch.mesh); place(ch.mesh, x, z, 0, 0); A_.actors.push(ch); return { ch, x, z, yaw: 0, path: null }; };
  A_.driver = actor(outfit('man', { shirt: 0xf2f2f2 }), taxi.x - 1.4, taxi.z); A_.driver.ch.mesh.visible = false;
  A_.officers = [actor(outfit('police'), 0, 0), actor(outfit('police'), 0, 0)];
  A_.medics = [actor(outfit('man', { shirt: 0xf4f4f4, pants: 0xf4f4f4, longSleeves: true }), 0, 0), actor(outfit('man', { shirt: 0xf4f4f4, pants: 0xf4f4f4, longSleeves: true }), 0, 0)];
  for (const a of [...A_.officers, ...A_.medics]) a.ch.mesh.visible = false;
  A_.crowd = Array.from({ length: 6 }, (_, k) => {
    const side = k % 2 ? 1 : -1, a = actor(outfit(['woman', 'man', 'student'][k % 3]), side * (ROAD_EDGE + 2 + Math.random() * 3), p.z + (k - 3) * 2.5);
    const ang = k / 6 * Math.PI * 2;
    a.path = [[a.x, a.z], [p.x + Math.cos(ang) * 2.6, p.z + Math.sin(ang) * 2.6], 0.6 + k * 0.25, 3.2 + k * 0.25];
    return a;
  });
  say('Aïe ! Bato, bobenga ambulance ! — Vite, appelez l\'ambulance !', 'client', 4);
  hud.toast('Accident : un piéton est renversé !', 4);
}
/** Une personne de la scène : elle marche de path[0] à path[1] entre les temps path[2] et path[3], puis reste là. */
function moveActor(a, t, time) {
  if (a.path) {
    const [from, to, t0, t1] = a.path, k = clamp((t - t0) / (t1 - t0), 0, 1);
    [a.x, a.z] = lerp2(from, to, k);
    if (k > 0 && k < 1) a.yaw = Math.atan2(-(to[0] - from[0]), (to[1] - from[1])) + Math.PI;
    a.ch.pose(k > 0 && k < 1 ? 'walk' : 'idle', time, a.spd ?? 1.4);
  } else a.ch.pose('idle', time);
  place(a.ch.mesh, a.x, a.z, a.yaw, 0);
}
function accidentScene(dt) {
  const S = G.accident, t = (S.t += dt), time = G.time;
  G.prompt = '';
  // la police arrive derrière le véhicule
  const pc = lerp2(S.police.from, S.police.to, smooth((t - 2) / 4));
  place(S.policeCar, ...pc, S.h, 0);
  if (t > 6.2 && !S.out) {                                            // les policiers descendent, le chauffeur sort
    S.out = true;
    const d = S.driver, [o1, o2] = S.officers;
    d.ch.mesh.visible = o1.ch.mesh.visible = o2.ch.mesh.visible = true;
    o1.x = pc[0] - 1.4; o1.z = pc[1]; o2.x = pc[0] + 1.4; o2.z = pc[1];
    o1.path = [[o1.x, o1.z], [d.x - 0.6, d.z + S.dz * 1.2], 6.3, 8.8];
    o2.path = [[o2.x, o2.z], [d.x + 0.6, d.z + S.dz * 1.2], 6.3, 8.8];
    say('Chauffeur, oyo bolamu te. Yaka na biso ! — Chauffeur, tu viens avec nous !', 'police', 4.5);
  }
  if (t > 9.4 && !S.walk) {                                           // ils l'emmènent à la voiture de police
    S.walk = true;
    const d = S.driver, [o1, o2] = S.officers, door = [pc[0] - 1.5, pc[1]];
    d.path = [[d.x, d.z], door, 9.5, 12.5];
    o1.path = [[o1.x, o1.z], [door[0] - 0.7, door[1] - S.dz], 9.5, 12.5];
    o2.path = [[o2.x, o2.z], [door[0] + 0.7, door[1] + S.dz], 9.5, 12.5];
  }
  if (t > 12.8 && !S.inCar) { S.inCar = true; for (const a of [S.driver, ...S.officers]) a.ch.mesh.visible = false; hud.toast('Le chauffeur est emmené au poste de police.', 3.5); }
  // le véhicule est poussé sur le côté
  const side = S.tx >= 0 ? 1 : -1, k = smooth((t - 13) / 3);
  taxi.x = S.tx + (side * (ROAD_EDGE + 2.2) - S.tx) * k;          // (sur le bas-côté, hors de la chaussée)
  taxi.heading = S.h + (wrapA((S.dz > 0 ? 0 : Math.PI) - S.h)) * k;
  // l'ambulance arrive, les secouristes emmènent le piéton
  const ac = lerp2(S.amb.from, S.amb.to, smooth((t - 4) / 5));
  const leave = smooth((t - 16.5) / 5), ac2 = [ac[0], ac[1] - S.amb.dz * 90 * leave];
  place(S.ambulance, ...ac2, S.amb.h, 0);
  if (t > 9.4 && !S.medicsOut) {
    S.medicsOut = true;
    S.medics.forEach((m, i) => { m.ch.mesh.visible = true; m.x = ac[0] + (i ? 1.2 : -1.2); m.z = ac[1] + S.amb.dz * 2.5; m.path = [[m.x, m.z], [S.p.x + (i ? 0.7 : -0.7), S.p.z], 9.5, 12]; });
    say('Tomemi ye na lopitalo. — On l\'emmène à l\'hôpital.', 'client', 3.5);
  }
  if (t > 13 && !S.loaded) {
    S.loaded = true;
    S.p.ch.mesh.visible = false;
    S.medics.forEach((m, i) => { m.path = [[m.x, m.z], [ac[0] + (i ? 1.2 : -1.2), ac[1] + S.amb.dz * 2.5], 13.2, 15.6]; });
  }
  if (t > 15.8 && !S.medicsIn) { S.medicsIn = true; for (const m of S.medics) m.ch.mesh.visible = false; }
  if (t > 16.5) place(S.policeCar, pc[0], pc[1] - S.dz * 80 * smooth((t - 16.5) / 5), S.h, 0);
  for (const a of [S.driver, ...S.officers, ...S.medics, ...S.crowd]) if (a.ch.mesh.visible) moveActor(a, t, time);
  // la sirène de l'ambulance, plus forte quand elle est proche
  const dA = Math.hypot(ac2[0] - taxi.x, ac2[1] - taxi.z);
  sound.siren(t > 3 ? { kind: 'amb', near: clamp(1 - dA / 150, 0, 1) } : null);
  sound.engine(0, 0, false);
  if (t > 22) {
    G.accident = null;
    for (const m of S.props) A.group.remove(m);
    for (const ch of S.actors) A.group.remove(ch.mesh);
    sound.siren(null);
    endShift('arret');
  }
}

/** Conduite libre : prévenir quand le taxi roule à contresens sur une chaussée (à droite vers -z, à gauche vers +z). */
function handleWrongWay() {
  if (taxi.level === 'pont' || taxi.level === 'sous' || taxi.core) return;   // (pont de l'Échangeur, sous le Pont Matete, terre-plein)
  const ax = Math.abs(taxi.x), vz = Math.cos(taxi.heading) * taxi.speed;   // vz > 0 : vers Limete
  if (ax > MEDIAN && ax < ROAD_EDGE && Math.abs(taxi.speed) > 3 && (taxi.x > 0 ? vz < -2 : vz > 2)) {
    G.prompt ||= 'Attention : tu roules à contresens !';
    if ((G.wrongT = (G.wrongT ?? 0) + 1 / 30) > 5) { G.wrongT = 0; infraction('Contresens', 10000); }
  }
}

/** Liaison sous le taxi : entrée d'une avenue (`sideRoad`) ou branche Ouest du Rond-point Mandela (`mandelaWest`). */
const ARC_MANDELA = EXT_ARCS[3];
function linkAt() {
  for (const L of CURRENT.links ?? []) {
    if (L.at === 'sideRoad') {
      // engagé d'au moins 45 m dans l'avenue
      if (L.side * taxi.x > ROAD_EDGE + 45 && Math.abs(taxi.z + toGame(L.road)) < 20) return L;
    } else if (L.at === 'mandelaEast' && ARC_MANDELA) {
      // chaussée de droite, au milieu du virage de Mandela (vers la Gare Centrale)
      if (taxi.x > MEDIAN && taxi.x < ROAD_EDGE + 30 && taxi.z <= (ARC_MANDELA.z0 + ARC_MANDELA.z1) / 2 && taxi.z > ARC_MANDELA.z1 - 40) return L;
    } else if (L.at === 'mandelaWest' && ARC_MANDELA) {
      // côté gauche du carrefour (là où part la branche Ouest), à plus de 50 m de la chaussée
      if (taxi.x < -(ROAD_EDGE + 50) && taxi.z < ARC_MANDELA.z0 + 28 && taxi.z > ARC_MANDELA.z1 - 28) return L;
    }
  }
  return null;
}
function handleLinks() {
  if (IT) return;                                // (itinéraire : ses routes sont déjà chargées, pas de changement de page)
  const L = linkAt();
  if (!L) return;
  if (passengers.ride) { G.prompt ||= `Dépose d'abord ton client pour prendre ${L.name}`; return; }
  G.state = 'transfer';
  sound.engine(0, 0, false);
  hud.toast(`${L.name}…`, 5);
  try {
    sessionStorage.setItem(TRANSFER_KEY, JSON.stringify({
      route: L.to, s: L.s, dir: L.dir ?? -1, name: L.name, speed: Math.min(Math.abs(taxi.speed), 8), versement: VERSEMENT,
      minutes: G.minutes, quality, cam: G.cam, muted: sound.muted,
      ...Object.fromEntries(['fuel', 'fares', 'tips', 'fuelCost', 'repairs', 'fines', 'rides', 'crashes'].map(k => [k, G[k]])),
    }));
  } catch { /* stockage indisponible : on change quand même de trajet, la journée recommence */ }
  const url = new URL(location.href);
  url.searchParams.set('route', L.to);
  for (const k of ['z', 's', 'x', 'start']) url.searchParams.delete(k);
  location.href = url.href;
}
/** Arrivée par une liaison : la journée continue sur ce trajet, dans le sens de son tracé (dir 1, chaussée de droite) ou
 *  dans le sens contraire (dir -1, chaussée de gauche). */
function continueShift(t) {
  quality = t.quality ?? quality;
  $('sel-quality').value = quality;
  applyQuality();
  Object.assign(G, {
    state: 'play', minutes: t.minutes, time: (t.minutes - 360) * SHIFT_SECONDS / 720 + 1e-6, cam: t.cam ?? 0,
    fuel: t.fuel, fares: t.fares, tips: t.tips, fuelCost: t.fuelCost, repairs: t.repairs, fines: t.fines,
    rides: t.rides, crashes: t.crashes, cash: 0, prompt: '', crashCd: 0, wallCd: 0, brakeHold: 0, fuelWarned: false, race: null,
  });
  const fwd = t.dir === 1;
  Object.assign(taxi, { x: fwd ? LANE_R : -LANE_R, z: -toGame(t.s), heading: fwd ? 0 : Math.PI, speed: t.speed ?? 0, steer: 0, level: null, y: 0 });
  flyWarned.clear();
  // (conseils des sauts-de-mouton : dans le sens du tracé, et seulement pour ceux qui sont devant)
  for (const f of FLYOVERS) if (!fwd || taxi.z <= f.z0 + 160) flyWarned.add(f);
  passengers.reset();
  traffic.reset(taxi);
  life.reset(taxi.z);
  hud.setClients(passengers.clients);
  updateCamera(0, true);
  show('play');
  hud.note(t.name, 2);
  if (t.muted) toggleMute();
  // (le son ne peut repartir qu'après un geste : première touche ou premier appui)
  const wake = () => sound.init();
  addEventListener('keydown', wake, { once: true });
  addEventListener('pointerdown', wake, { once: true });
}

// ---------- Passage d'une route à l'autre (trajet attaché) ----------
const tmpW = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpN = new THREE.Vector3();
/** Point de la scène → coordonnées route (x, z) sur `road`, en cherchant l'axe entre zHint - span et zHint + span. */
function roadCoords(road, pWorld, zHint, span) {
  const p = road.group.worldToLocal(pWorld.clone());
  let bz = zHint, bd = Infinity;
  const near = (z0, z1, st) => {
    for (let z = z0; z >= z1; z -= st) {
      road.RT.worldVec(0, 0, z, tmpC);
      const d = (p.x - tmpC.x) ** 2 + (p.z - tmpC.z) ** 2;
      if (d < bd) { bd = d; bz = z; }
    }
  };
  near(zHint + span, zHint - span, 2);
  near(bz + 2, bz - 2, 0.1);
  road.RT.worldVec(0, 0, bz, tmpC);
  road.RT.worldVec(1, 0, bz, tmpN).sub(tmpC).normalize();
  let x = (p.x - tmpC.x) * tmpN.x + (p.z - tmpC.z) * tmpN.z;
  const S = road.RT.spreadAt(bz);                // (à l'Échangeur, les chaussées s'écartent : écart réel → x route)
  if (Math.abs(x) >= 0.9 + S) x -= Math.sign(x) * S;
  return { x, z: bz };
}
/** Cap du taxi dans la scène (radians), et cap route correspondant sur une autre route. */
const sceneHeading = (road, z, h) => road.RT.yawAt(z) + h - road.rho;
const roadHeading = (road, z, th) => wrapA(th + road.rho - road.RT.yawAt(z));
/** Direction réelle du mouvement dans la scène : loin de l'axe d'une route en courbe (route des rails du Pont Matete), elle n'est
 *  pas tout à fait sceneHeading, car la route plie le décor. */
function motionHeading(road, x, z, h) {
  const a = road.RT.worldVec(x, 0, z, tmpC), bx = road.RT.worldVec(x + Math.sin(h), 0, z - Math.cos(h), tmpN);
  return Math.atan2(bx.x - a.x, -(bx.z - a.z)) - road.rho;
}
function switchRoad(to, x, z, heading, quiet = false, name = null) {
  if (to !== A) A.life?.hideAll?.();            // (l'auteur, 08/11 : les piétons de la route quittée restaient figés sur la chaussée)
  A = to;
  ({ FINISH_LEN, FUELS, FLYOVERS, inFlyover, SIGNALS, signalState, blockedAt, roadAxisAt, nextLevel, surfaceH,
    LANE_R, LANE_W, MEDIAN, ROAD_EDGE, RAMP_X, fuelSideAt } = A.W);
  ({ place, worldVec, stretchX, yawAt } = A.RT);
  ({ traffic, passengers, life } = A);
  for (const r of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) if (r && r !== A) r.qlife?.hide();
  A.group.add(taxiMesh);
  $('track').innerHTML = '';                     // barre du trajet : celle de la route où roule le taxi
  hud = new A.Hud();
  hud.setClients(passengers.clients);
  if (quiet) return;
  Object.assign(taxi, { x, z, heading, level: null });
  if (!to.nearActive) traffic.reset(taxi);
  else {
    to.nearActive = false;
    for (const v of traffic.list) {
      if (Math.abs(v.x - taxi.x) < 2.6 && Math.abs(v.z - taxi.z) < 14) traffic.place(v, taxi.z - 65, 45, taxi);
    }
  }
  life.reset(taxi.z);
  hud.note(name ?? (A === ROAD2 ? 'Boulevard du 30 Juin' : A === ROAD7 || A === ROAD8 ? A.title : 'Avenue de la Libération (ex-24 Novembre)'), 3);
}
/**
 * Au bout du 24 Novembre, le taxi entre sur le Boulevard du 30 Juin attaché (et en ressort par la même entrée). Au bout de la route
 * des rails du Pont Matete, il entre sur la Route Poids Lourds ; au bout de celle-ci, sur le Boulevard du 30 Juin, à la Place de la Gare.
 */
let joinUntil = 0;                               // (juste après un changement de route, on n'en reprend pas une autre)
/** Au croisement Pont-Cabu : le véhicule, près du centre du carrefour (z de la route où il est), roule dans la direction `dir` (dans un sens ou dans l'autre) ? */
function kvTurn(dir, zc) {
  if (!dir || Math.abs(taxi.speed) < 1 || Math.abs(taxi.z - zc) > 24) return false;
  const p = A.group.localToWorld(A.RT.worldVec(taxi.x, 0, taxi.z, new THREE.Vector3()));
  if (p.distanceTo(KV.P) > 26) return false;
  const th = motionHeading(A, taxi.x, taxi.z, taxi.heading + (taxi.speed < 0 ? Math.PI : 0));
  return Math.abs(Math.sin(th) * dir.x - Math.cos(th) * dir.z) > Math.cos(0.6);   // (à moins de 35° de cette direction)
}
function handleAttach() {
  if (!MULTI || G.time < joinUntil) return;
  const at = CURRENT.attach, vz = Math.cos(taxi.heading) * taxi.speed;   // vz > 0 : vers -z
  let to = null, zHint = 0, name = null, snap = null, zLand = null;
  const sh = Math.sin(taxi.heading) * taxi.speed;        // vitesse en x route
  if (A === ROAD1) {
    for (const l of ROAD3?.W.PL_LINKS ?? []) {
      const q = l.join.stub;
      const hit = q ? Math.hypot(taxi.x - q.b[0], taxi.z - q.b[1]) < 5.5 && sh * (q.b[0] - q.a[0]) + vz * -(q.b[1] - q.a[1]) > 0 : W1.plForkHit(taxi.x, taxi.z);
      if (hit) { to = ROAD3; zHint = l.join.end[1]; name = l.name; snap = l.join.end; }
    }
    if (ROAD4 && !to) {                          // avenue de l'Université : au bout de son entrée, sur le boulevard Sendwe
      const q = W1.UNI_STUB;
      if (Math.hypot(taxi.x - q.b[0], taxi.z - q.b[1]) < 4 && sh * (q.b[0] - q.a[0]) + vz * -(q.b[1] - q.a[1]) > 0) { to = ROAD4; zHint = 0; name = "Avenue de l'Université"; }
    }
    if (ROAD5 && !to) {                          // By Pass : au bout de son entrée, à l'Échangeur
      const q = W1.BP_STUB;
      if (Math.hypot(taxi.x - q.b[0], taxi.z - q.b[1]) < 5 && (sh * (q.b[0] - q.a[0]) + vz * -(q.b[1] - q.a[1]) > 0 || sh * (q.b[0] - q.a2[0]) + vz * -(q.b[1] - q.a2[1]) > 0)) { to = ROAD5; zHint = 0; name = 'By Pass'; }
    }
    if (ROAD6 && !to && kvTurn(KV.dir6, KV.z1)) { to = ROAD6; zHint = KV.z6; name = 'Avenue Kasa-Vubu'; }
    // (on prend l'entrée « Rocade Sud-Est », à gauche du boulevard Lumumba près de l'aéroport)
    if (ROAD7 && !to && taxi.x < -(ROAD_EDGE + 2) && sh < 0 && Math.abs(taxi.z - ROC.z1) < 8) { to = ROAD7; zHint = ROC.zEnd7; name = 'Rocade Sud-Est'; }
    // (la Première Entrée de N'djili, à gauche juste avant le Pont N'djili : vers Cecomaf et la Rocade)
    if (ROAD8 && !to && taxi.x < -(ROAD_EDGE + 2) && sh < 0 && Math.abs(taxi.z - MM.z1) < 8) { to = ROAD8; zHint = 0; name = "Première Entrée · Route Mama Mobutu"; }
    if (to) { /* liaison vers une route attachée */ }
    else if (ROAD2 && taxi.z <= ROAD1.zJoin) { to = ROAD2; zHint = ROAD2.zJoin; }
    else if (ROAD3 && W1.plBandU(taxi.x, taxi.z) >= W1.PL_JOIN_U - 2) { to = ROAD3; name = 'Route Poids Lourds'; }
  } else if (A === ROAD2 && ROAD6 && KV.zK2 !== undefined && taxi.x > ROAD_EDGE + 3 && sh > 0 && (Math.abs(taxi.z - KV.zK2) < 7 || Math.abs(taxi.z - KV.zG2) < 7)) {
    // (on prend l'entrée « Avenue Kasa-Vubu », à droite du 30 Juin : on passe sur l'avenue)
    const kin = Math.abs(taxi.z - KV.zK2) < 7;
    to = ROAD6; zHint = kin ? 0 : KV.zEnd6; name = kin ? 'Avenue Kasa-Vubu (Kintambo)' : 'Avenue Kasa-Vubu (Gombe)';
  } else if (A === ROAD2) {
    if (at.side * taxi.x > ROAD_EDGE + at.join + 1.5 && Math.abs(taxi.z - ROAD2.zJoin) < 25) { to = ROAD1; zHint = ROAD1.zJoin; }
    else if (ROAD3 && taxi.z <= ROAD2.zEnd && vz > 0) { to = ROAD3; zHint = ROAD3.zEnd; name = 'Route Poids Lourds'; }
  } else if (A === ROAD5) {
    const B = ROAD5.W.BP_JOIN, kx = B.kim[0] - B.kimA[0], kz = B.kim[1] - B.kimA[1];
    if (taxi.z > -0.5 && vz < 0) { to = ROAD1; zHint = W1.BP_STUB.b[1]; name = 'Boulevard Lumumba · Échangeur'; snap = W1.BP_STUB.b; }
    else if (ROAD4 && Math.hypot(taxi.x - B.kim[0], taxi.z - B.kim[1]) < 5 && sh * kx + vz * -kz > 0) { to = ROAD4; zHint = ROAD4.W.UNI_JOIN.kim[1]; name = 'Route de Kimwenza'; snap = ROAD4.W.UNI_JOIN.kim; }
    // dans le Rond-Point Ngaba, on passe sur l'avenue de l'Université (avec un client, on traverse tout droit, sur le By Pass)
    else if (ROAD4 && !passengers.ride && taxi.z < B.z0 && taxi.z > B.z1) { to = ROAD4; zHint = ROAD4.W.UNI_JOIN.c[1]; name = 'Rond-Point Ngaba'; }
  } else if (A === ROAD4 && ROAD5 && (() => {
    const U = ROAD4.W.UNI_JOIN, B = ROAD5.W.BP_JOIN;
    // on ne ressort que dans la vraie direction du By Pass (direction de la scène), jamais en braquant dans le rond-point
    const th = motionHeading(ROAD4, taxi.x, taxi.z, taxi.heading + (taxi.speed < 0 ? Math.PI : 0)), mx = Math.sin(th), mz = -Math.cos(th);
    const dirOut = (a, c) => { const pa = ROAD5.RT.worldVec(0, 0, a, new THREE.Vector3()), pc = ROAD5.RT.worldVec(0, 0, c, new THREE.Vector3()); return (pc.x - pa.x) * mx + (pc.z - pa.z) * mz; };
    const out = (P, C) => Math.hypot(taxi.x - P[0], taxi.z - P[1]) < 6.5 && sh * (P[0] - C[0]) + vz * -(P[1] - C[1]) > 0;
    const near = (P, a, c) => Math.hypot(taxi.x - P[0], taxi.z - P[1]) < 6.5 && dirOut(a, c) > 4;
    if (near(U.E, B.z0, B.z0 + 6)) { to = ROAD5; zHint = B.z0 + 4; name = 'By Pass, vers l\'Échangeur'; zLand = B.z0 + 2; }
    else if (near(U.W, B.z1, B.z1 - 6)) { to = ROAD5; zHint = B.z1 - 4; name = 'By Pass, vers Cité Verte'; zLand = B.z1 - 2; }
    else if (out(U.kim, U.kimB)) { to = ROAD5; zHint = B.kim[1]; name = 'By Pass'; snap = B.kim; }
    return to;
  })()) {
    /* (raccord choisi ci-dessus) */
  } else if (A === ROAD7) {
    if (ROAD8 && taxi.x > ROAD_EDGE + 2 && sh > 0 && Math.abs(taxi.z - MM.z7) < 8) { to = ROAD8; zHint = MM.zEnd8; name = "Route de Nsanda · Première Entrée"; }
    else if (taxi.z < ROC.zEnd7 + 3 && vz > 0) { to = ROAD1; zHint = ROC.z1; name = "Boulevard Lumumba · Aéroport"; }
    else if (ROAD4 && taxi.z > -2 && vz < 0) { to = ROAD4; zHint = ROC.z4; name = "Avenue de l'Université · UNIKIN"; }
  } else if (A === ROAD4 && ROAD7 && taxi.x > ROAD4.W.ROAD_EDGE + 2 && sh > 0 && Math.abs(taxi.z - ROC.z4) < 8) {
    to = ROAD7; zHint = 0; name = 'Rocade Sud-Est';
  } else if (A === ROAD8) {
    if (taxi.z > -2 && vz < 0) { to = ROAD1; zHint = MM.z1; name = "Boulevard Lumumba · Pont N'djili"; }
    else if (taxi.z < MM.zEnd8 + 3 && vz > 0) { to = ROAD7; zHint = MM.z7; name = 'Rocade Sud-Est · Cecomaf'; }
  } else if (A === ROAD6) {
    if (kvTurn(KV.dir1, KV.z6)) { to = ROAD1; zHint = KV.z1; name = 'Boulevard Sendwe · Triomphal'; }
    else if (ROAD2 && KV.zK2 !== undefined && taxi.z > -6 && vz < 0) { to = ROAD2; zHint = KV.zK2; name = 'Boulevard du 30 Juin · Kintambo Magasin'; }
    else if (ROAD2 && KV.zG2 !== undefined && taxi.z < KV.zEnd6 + 6 && vz > 0) { to = ROAD2; zHint = KV.zG2; name = 'Boulevard du 30 Juin · Gombe'; }
  } else if (A === ROAD4) {
    if (taxi.z > -0.5 && vz < 0) { to = ROAD1; zHint = W1.UNI_STUB.b[1]; name = 'Boulevard Sendwe'; snap = W1.UNI_STUB.a; }
  } else if (A === ROAD3) {
    const link = ROAD3.W.PL_LINKS.find(l => Math.hypot(taxi.x - l.join.end[0], taxi.z - l.join.end[1]) < 7.5);
    if (link) {
      const P = link.pts, a = P[P.length - 2], e = P[P.length - 1];
      if (sh * (e[0] - a[0]) + vz * -(e[1] - a[1]) > 0) { to = ROAD1; zHint = link.join.stub ? link.join.stub.b[1] : W1.Z_FORK_ - 46; name = link.back; }
    }
    if (to) { /* liaison vers le boulevard Lumumba */ }
    else if (taxi.z > -0.5 && vz < 0) { to = ROAD1; zHint = W1.plDiagAt(W1.PL_JOIN_U)[1]; name = 'Pont Matete'; }
    else if (ROAD2 && taxi.z <= ROAD3.zEnd && vz > 0) { to = ROAD2; zHint = ROAD2.zEnd; name = 'Place de la Gare · Boulevard du 30 Juin'; }
  }
  if (!to) return;
  if (!IT && passengers.ride) { G.prompt ||= "Dépose d'abord ton client avant de changer de boulevard"; return; }
  const from = A, p = from.RT.worldVec(taxi.x, 0, taxi.z, tmpW);
  from.group.localToWorld(p);
  const th = motionHeading(from, taxi.x, taxi.z, taxi.heading), c = roadCoords(to, p, zHint, 120);
  let h = roadHeading(to, c.z, th);
  for (let i = 0; i < 2; i++) h += wrapA(th - motionHeading(to, c.x, c.z, h));
  // (retour par la fourche Sendwe : on arrive sur la chaussée)
  if (to === ROAD1 && name === 'Boulevard Lumumba · Fourche Sendwe' && to.W.blockedAt(c.x, c.z)) c.x = Math.min(c.x, to.W.ROAD_EDGE - 1.5);
  if (zLand !== null) c.z = zLand;
  // (au croisement Pont-Cabu : on arrive sur la voie de droite de la route où l'on tourne)
  if ((to === ROAD6 || from === ROAD6) && to.W.blockedAt(c.x, c.z)) c.x = (Math.cos(h) >= 0 ? 1 : -1) * to.W.LANE_R;
  if (to === ROAD6 && c.z > -3) c.z = -3;                         // (au bout de l'avenue, côté Kintambo)
  if (to === ROAD6 && KV.zEnd6 !== undefined && c.z < KV.zEnd6 + 3) c.z = KV.zEnd6 + 3;
  if (to === ROAD5 && c.z > -1) c.z = -1.5;
  // (l'auteur, 13/11 : « Masina passe du côté Kingasani ») : en arrivant du By Pass, on part sur la branche de droite, vers la chaussée dans le sens de
  // l'aéroport (Masina, Kingasani) ; la branche de gauche est la sortie du boulevard, on y roulerait à contresens
  if (from === ROAD5 && to === ROAD1 && W1.BP_STUB) { const P2 = W1.BP_STUB.pts2, q = P2[P2.length - 4]; h = Math.atan2(q[0] - c.x, -(q[1] - c.z)); }
  if (to === ROAD7) { c.z = Math.min(-3, Math.max(ROC.zEnd7 + 4, c.z)); if (to.W.blockedAt(c.x, c.z)) c.x = (Math.cos(h) >= 0 ? 1 : -1) * to.W.LANE_R; }
  if (from === ROAD7 && to.W.blockedAt(c.x, c.z)) c.x = to === ROAD1 ? -(to.W.ROAD_EDGE - 2) : to.W.ROAD_EDGE - 1.5;   // (on arrive sur la chaussée)
  if (to === ROAD8) { c.z = Math.min(-3, Math.max(MM.zEnd8 + 4, c.z)); if (to.W.blockedAt(c.x, c.z)) c.x = (Math.cos(h) >= 0 ? 1 : -1) * to.W.LANE_R; }
  if (from === ROAD8 && to.W.blockedAt(c.x, c.z)) c.x = to === ROAD1 ? -(to.W.ROAD_EDGE - 2) : to.W.ROAD_EDGE - 1.5;
  if (snap && to.W.blockedAt(c.x, c.z)) { c.x = snap[0]; c.z = snap[1]; }   // (toujours sur la chaussée de la liaison)
  joinUntil = G.time + 1.2;
  switchRoad(to, c.x, c.z, wrapA(h), false, name);
}
/** Décor affiché : celui de la route du taxi ; les autres, seulement près d'un raccord (vue de part et d'autre). */
let followTick = 0;
function followRoads() {
  A.world.follow(taxi.x, taxi.z, taxi.heading);
  if (!MULTI) return;
  const p = A.RT.worldVec(taxi.x, 0, taxi.z, tmpW);
  A.group.localToWorld(p);
  if (followTick++ % 6 === 0) {
    for (const other of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) {
      if (!other || other === A) continue;
      let best = null, bd = Infinity;
      for (const j of JOINS) {
        if (j.a !== other && j.b !== other) continue;
        const d = p.distanceTo(j.w);
        if (d < j.r && d < bd) { bd = d; best = j; }
      }
      if (!best) { other.nearZ = null; other.nearActive = false; other.world.follow(0, 1e7, 0); }
      else { const c = roadCoords(other, p, best.a === other ? best.za : best.zb, 450); other.nearZ = c.z; other.world.follow(c.x, c.z, Math.PI / 2); }
    }
  }
  ROAD1.world.light(p);                          // soleil et ciel : sur le taxi
}

const flyWarned = new Set();
function update(dt) {
  G.time += dt;
  G.minutes = 360 + G.time * (720 / SHIFT_SECONDS);
  G.crashCd -= dt;
  G.wallCd -= dt;

  if (G.accident) { accidentScene(dt); return; }
  if (G.wewaFall) {
    wewaFallScene(dt);
    traffic.update(dt, taxi, G.time);
    incidents.update(dt, taxi);
    sound.engine(0, 0, false);
    return;
  }
  const zBefore = taxi.z;
  const inp = drive(dt);
  if (G.race && G.race.t < 0) taxi.speed = 0;
  taxi.core = stretchX(taxi.x, taxi.z) > 1.05;   // dans le terre-plein élargi de l'Échangeur : loin des voitures (traffic)
  handleTraffic(dt);
  life.update(dt, taxi.z, G.time, Math.cos(taxi.heading) < -0.35, G.minutes % 1440 >= 5.5 * 60 && G.minutes % 1440 < 8.5 * 60);   // (le matin : les athlètes)
  G.km = (G.km ?? 0) + Math.abs(taxi.speed) * dt / 1000;
  life.updateCrossers(dt, taxi, G.time);
  A.qlife?.update(dt, taxi, G.time);
  pedestrians();
  A.world.tick(dt, G.time, taxi);
  if (G.race) { updateRace(dt); G.prompt = ''; }
  else if (VEH.perso) G.prompt = '';         // (voiture personnelle ou athlète : on parcourt la ville, pas de clients)
  else {
    passengers.update(dt, taxi, G.time, callbacks);
    G.prompt = passengers.prompt;
    receveur(dt);
    receveurCorps(dt);
    receveursProches();
    overloadCheck();
  }
  if (!(Math.abs(taxi.x) > MEDIAN && Math.abs(taxi.x) < ROAD_EDGE && Math.abs(taxi.speed) > 3 && (taxi.x > 0 ? Math.cos(taxi.heading) * taxi.speed < -2 : Math.cos(taxi.heading) * taxi.speed > 2))) G.wrongT = 0;
  if (VEH_ID !== 'athlete') handleStations(dt, inp);
  worksHint();
  if (VEH_ID !== 'athlete') handleSignals(zBefore);
  if (VEH_ID !== 'athlete') handleWrongWay();
  handleHitRun(dt);
  handlePolice(dt);
  dismountScene(dt);
  panneScene(dt);
  W1.updateSignals(G.time);
  for (const f of FLYOVERS) {
    if (flyWarned.has(f) || taxi.z > f.z0 + 160 || taxi.z < f.z0 || Math.abs(taxi.x) > ROAD_EDGE) continue;   // (pas depuis Masina)
    flyWarned.add(f);
    hud.toast(`Saut-de-mouton ${f.name} : à gauche la rampe pour aller vite, à droite les clients en bas.`, 4);
  }
  G.cash = G.fares + G.tips - G.fuelCost - G.repairs - G.fines - (G.stolen ?? 0);
  handleLinks();
  handleAttach();
  if (IT) itineraryHints();

  sound.engine(VEH_ID === 'athlete' ? 0 : taxi.speed, VEH_ID === 'athlete' ? 0 : inp.throttle, VEH_ID !== 'athlete');
  cityAudio(dt);
  updateTrain(dt);
  mandelaTurners(dt);
  matetePlTurners(dt);
  incidents.update(dt, taxi);
  incidents.blockVehicle(taxi);
  const siren = traffic.sirenNear(taxi) ?? incidents.siren;
  sound.siren(siren);
  radio.duck(Math.min(siren ? 1 - 0.6 * siren.near : 1, sound.clipPlaying ? 0.4 : 1));   // (la radio baisse quand une sirène approche, ou quand quelqu'un parle ; pendant la prédication elle est coupée)
  preacher.update(dt, Math.abs(taxi.speed) < 0.5);

  if (G.state !== 'play') return;              // (liaison prise : la page se recharge)
  if (G.race) { if (raceOver()) finishRace(); }
  else if (IT && !VEH.perso) { terminusStop(dt); departHint(); }
  else if (!IT && taxi.z <= -FINISH_LEN && !ROAD3 && !(A === ROAD1 && ROAD2)) endShift('arrive');   // (trajets attachés : la route continue)
  // (l'auteur, 09/11 : on n'arrête plus le jeu à la nuit : les lampes du boulevard s'allument et on continue)
  nightTick();
  rainTick(dt);
}
// ---------- La pluie (pluie.js) : les gouttes suivent la caméra ; le ciel, la route mouillée, le bruit et les essuie-glaces suivent l'averse ----------
let rainK = 0;
function rainTick(dt) {
  rain.update(dt, G.time, camera.position);
  const k = rain.k;
  if (Math.abs(k - rainK) > 0.015 || (k === 0 && rainK !== 0)) {
    if (k > 0.1 && rainK <= 0.1) hud.note('Il commence à pleuvoir : roule doucement.', 2);
    if (k < 0.1 && rainK >= 0.1) hud.note('La pluie s’arrête.', 2);
    rainK = k;
    for (const r of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) r?.world?.rain?.(k);
    scene.fog.far = fogFar * (1 - 0.3 * k);
    scene.fog.near = 80 * (1 - 0.5 * k);
    sound.rain(k);
  }
  if (cockpit.wipers) {
    cockpit.wipers.visible = k > 0.05 && G.cam === 1;
    for (const arm of cockpit.wipers.children) arm.rotation.z = -0.35 + (Math.sin(G.time * 4.5) * 0.5 + 0.5) * 1.1;
  }
}
/** 0 le jour, 1 la nuit : le soir de 17 h 45 à 19 h, l'aube de 5 h à 6 h 15. */
function nightAt(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m >= 19 * 60 || m < 5 * 60) return 1;
  if (m >= 17.75 * 60) return smooth((m - 17.75 * 60) / 75);
  if (m < 6.25 * 60) return 1 - smooth((m - 5 * 60) / 75);
  return 0;
}
let nightK = 0;
function nightTick() {
  const k = nightAt(G.minutes);
  if (Math.abs(k - nightK) < 0.004) return;
  nightK = k;
  for (const r of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) r?.world?.night?.(k);
  setNight(k);                                   // phares et feux des véhicules (models.js)
  setBeam(beam, k);                              // faisceau du joueur
}
/** Chaque image, la nuit : le faisceau suit le véhicule du joueur, les halos suivent la circulation de chaque route. */
const TAXI_GLOW = { mesh: null, len: 0, wid: 0 };
function nightFrame() {
  if (nightK <= 0.04) return;
  beam.visible = VEH_ID !== 'athlete';
  if (beam.parent !== taxiMesh.parent) { beam.parent?.remove(beam); taxiMesh.parent.add(beam); }
  place(beam, taxi.x, taxi.z, taxi.heading, taxi.y);
  beam.rotation.x = taxiMesh.rotation.x;
  TAXI_GLOW.mesh = taxiMesh; TAXI_GLOW.len = VEH.l; TAXI_GLOW.wid = VEH.w;
  for (const r of [ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8]) {
    if (!r?.glow) continue;
    r.glow.update(r === A && VEH_ID !== 'athlete' ? [TAXI_GLOW, ...r.traffic.list, ...r.traffic.crossing] : [...r.traffic.list, ...r.traffic.crossing], nightK);
  }
}

// ---------- La cabine (vue CAM n° 3, l'auteur, 10/11 : « voir aussi à l'intérieur du bus ») : l'intérieur suit le véhicule ; les clients à bord
// sont assis à leur place (leur personnage, caché depuis qu'ils sont montés), le chauffeur au volant, le prédicateur debout dans l'allée ----------
const CABIN = { seated: new Map(), driver: null, preacher: null };
function cabinFrame() {
  const on = G.cam === 2 && G.state !== 'menu' && !G.accident && !!cabin.eye;
  if (cabin.group.parent !== taxiMesh.parent) { cabin.group.parent?.remove(cabin.group); taxiMesh.parent.add(cabin.group); }
  cabin.group.visible = on;
  if (!on) { if (CABIN.seated.size) cabinClear(false); return; }
  place(cabin.group, taxi.x, taxi.z, taxi.heading, taxi.y);
  cabin.group.rotation.x = taxiMesh.rotation.x;
  if (!CABIN.driver) { CABIN.driver = new Character(outfit('man', { shirt: 0xf2f2f2, idle: 0, cap: null })); cabin.group.add(CABIN.driver.mesh); }
  CABIN.driver.mesh.position.set(cabin.driver.x, cabin.driver.y, cabin.driver.z);
  CABIN.driver.pose('sit', G.time);
  let i = 0;
  const seen = new Set();
  for (const r of BOARD.riders) {
    const ch = r.ch, seat = cabin.seats[Math.min(i, cabin.seats.length - 1)];
    i++;
    if (!ch || r.road.walkers.some(w => w.ch === ch)) continue;          // (encore en train de marcher vers la portière)
    if (ch.mesh.parent !== cabin.group) { cabin.group.add(ch.mesh); ch.mesh.rotation.set(0, 0, 0); CABIN.seated.set(r, ch); }
    ch.mesh.position.set(seat.x, cabin.seatY, seat.z);
    ch.mesh.visible = true;
    ch.pose('sit', G.time);
    seen.add(r);
  }
  for (const r of [...CABIN.seated.keys()]) if (!seen.has(r)) CABIN.seated.delete(r);   // (descendu : passengers.js a repris son personnage)
  if (CABIN.preacher && cabin.stand) {
    CABIN.preacher.mesh.position.set(cabin.stand.x, cabin.stand.y, cabin.stand.z);
    CABIN.preacher.mesh.rotation.y = Math.PI;                           // (tourné vers les passagers)
    CABIN.preacher.pose('preach', G.time);
  }
}
/** Quitte la vue cabine : les clients redeviennent invisibles (ils restent à bord) ; all : le chauffeur aussi (changement de véhicule). */
function cabinClear(all = true) {
  for (const ch of CABIN.seated.values()) ch.mesh.visible = false;
  CABIN.seated.clear();
  if (all && CABIN.driver) { CABIN.driver.mesh.parent?.remove(CABIN.driver.mesh); CABIN.driver = null; }
}

// ---------- Les incidents de la route (incidents.js ; l'auteur, 10/11 : accidents, bagarres, Kuluna, chauffeur cogné, voleurs à moto) ----------
const incidents = new Incidents({
  taxi, group: () => A.group, W: () => A.W, traffic: () => A.traffic, place: (o, x, z, yaw, y) => place(o, x, z, yaw, y),
  say, toast: (t, d) => hud.toast(t, d), sound, infraction: (what, fine) => infraction(what, fine), hold: on => { G.held = on; },
  choice: askChoice, time: () => G.time, night: () => nightK, veh: () => VEH_ID, cash: () => Math.max(0, G.cash),
  onLoss: (fc, why) => { if (why === 'vol') G.stolen = (G.stolen ?? 0) + fc; else G.repairs += fc; },
  isMain: () => A === ROAD1 && !G.race && !G.police && !G.accident && !G.hitRun && !lunettes.on,
  riders: on => taxiMesh.traverse(m => { if (m.userData.rider) m.visible = on; }),   // (moto : le conducteur descend pour la bagarre)
});

// ---------- La prédication dans le bus (predication.js ; l'auteur, 10/11 : en audio, pas en écrit ; la radio se tait) ----------
let radioBeforeSermon = false;
const preacher = new Preacher({
  play(file, onEnd) {
    radioBeforeSermon = radio.on && !radio.el.paused;
    radio.pause();
    sound.speak(file, { vol: 1, onEnd });
  },
  stop() {
    sound.stopSpeech();
    if (radioBeforeSermon && G.state === 'play') radio.resume();
    radioBeforeSermon = false;
  },
  enter(who) {
    const o = who.kind === 'woman' ? outfit('woman', { dress: true, pagneTop: false, shirt: 0xffffff, headwrap: 0xf2e6c8, idle: 0 })
      : outfit('man', { shirt: 0xffffff, pants: 0x23262b, longSleeves: true, cap: null, untucked: false, sandals: false, beard: true, idle: 0 });
    const ch = new Character(o);
    CABIN.preacher = ch;
    cabin.group.add(ch.mesh);
    ch.mesh.visible = true;
    hud.toast(`${who.name} monte dans le bus pour prêcher…`, 3);
    G.lastSermon = G.time;
  },
  exit() { if (CABIN.preacher) { CABIN.preacher.mesh.parent?.remove(CABIN.preacher.mesh); CABIN.preacher = null; } },
});
/** Un prédicateur monte parfois quand un client monte dans le 207 : longue prédication sur un long trajet, courte sur un court. */
function maybePreacher() {
  if (VEH_ID !== 'bus' || preacher.active || G.race || !IT || BOARD.riders.length < 3 || G.time - (G.lastSermon ?? -1e9) < 240 || Math.random() > 0.45) return;
  const L = legs(), end = itPoint(L.to, L.to.dir), left = end.road === A ? Math.abs(end.z - taxi.z) : Infinity;
  if (left < 900) return;                                               // (presque au terminus : il ne monte pas)
  preacher.start(IT.km >= 12 && left > 2500);
}

// ---------- Caméra ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const tmpPos = new THREE.Vector3(), tmpLook = new THREE.Vector3();
/** Hauteur de la chaussée et point du monde à d mètres devant le taxi (derrière si d < 0). Dans le terre-plein élargi de
 *  l'Échangeur, un mètre de x route vaut plusieurs mètres réels : on y compte en mètres réels. */
const aheadH = d => {
  const k = stretchX(taxi.x, taxi.z);
  return surfaceH(taxi.x + Math.sin(taxi.heading) * d / k, taxi.z - Math.cos(taxi.heading) * d, taxi.level);
};
function ahead(d, y, out) {
  if (stretchX(taxi.x, taxi.z) === 1) return worldVec(taxi.x + Math.sin(taxi.heading) * d, y, taxi.z - Math.cos(taxi.heading) * d, out);
  const th = yawAt(taxi.z) + taxi.heading;
  worldVec(taxi.x, y, taxi.z, out);
  out.x += Math.sin(th) * d;
  out.z -= Math.cos(th) * d;
  return out;
}
function updateCamera(dt, snap = false) {
  if (G.dbgCam) {                                     // (tests sans écran, ?debug=1 : vue aérienne)
    worldVec(...G.dbgCam.p, tmpPos);
    worldVec(...G.dbgCam.l, tmpLook);
  } else if (G.accident) {
    const S = G.accident, cx = (S.tx + S.p.x) / 2, cz = (S.tz + S.p.z) / 2, a = S.cam + S.t * 0.12;
    worldVec(cx + Math.sin(a) * 15, 8.5, cz + Math.cos(a) * 15, tmpPos);
    worldVec(cx, 1, cz, tmpLook);
  } else if (G.wewaFall) {
    ahead(-6.5, 2.9 + Math.max(aheadH(-6.5), taxi.y), tmpPos);
    ahead(1.2, 0.7 + taxi.y, tmpLook);
  } else if (G.cam === 0) {
    const back = VEH_ID === 'bus' ? -9 : VEH_ID === 'athlete' ? -4.2 : -7.5;
    const up = VEH_ID === 'bus' ? 4.1 : VEH_ID === 'athlete' ? 2.15 : 3.3;
    ahead(back, up + Math.max(aheadH(back), taxi.y), tmpPos);
    ahead(VEH_ID === 'athlete' ? 4 : 6, (VEH_ID === 'athlete' ? 1.25 : 1.1) + aheadH(VEH_ID === 'athlete' ? 4 : 6), tmpLook);
  } else if (G.cam === 2 && cabin.eye) {
    // la cabine : du fond du véhicule vers l'avant (les passagers, le prédicateur, la route par le pare-brise)
    const e = cabin.eye, l = cabin.look, sp = Math.abs(taxi.speed);
    G.bob = (G.bob ?? 0) + dt * (2 + sp * 0.5);
    const bob = Math.sin(G.bob * 2.3) * 0.005 * Math.min(1, sp / 8);
    beside(-e.z, e.x, taxi.y + e.y + bob, tmpPos);
    beside(-l.z, l.x, taxi.y + l.y + bob * 0.5, tmpLook);
  } else {
    // à la place du chauffeur (à gauche dans la berline et le 207) ; la tête bouge un peu avec la route, et le choc la secoue
    const e = cockpit.eye, h = taxi.heading, sp = Math.abs(taxi.speed);
    G.bob = (G.bob ?? 0) + dt * (2 + sp * 0.5);
    const shake = (G.shake = Math.max(0, (G.shake ?? 0) - dt * 2)) * 0.06;
    const bob = Math.sin(G.bob * 2.3) * 0.006 * Math.min(1, sp / 8) + (Math.random() - 0.5) * shake;
    const ox = Math.cos(h) * e.x, oz = Math.sin(h) * e.x, fx = Math.sin(h) * -e.z, fz = -Math.cos(h) * -e.z;
    const k0 = stretchX(taxi.x, taxi.z);
    worldVec(taxi.x + (ox + fx) / k0, e.y + taxi.y + bob, taxi.z + oz + fz, tmpPos);
    worldVec(taxi.x + (ox + fx) / k0 + Math.sin(h) * 20 / k0, e.y - 0.25 + aheadH(20) + bob * 0.5, taxi.z + oz + fz - Math.cos(h) * 20, tmpLook);
  }
  A.group.localToWorld(tmpPos);
  A.group.localToWorld(tmpLook);
  const inside = G.cam === 1 && G.state !== 'menu' && !G.accident && !G.wewaFall;
  cockpit.group.visible = inside;
  if (inside) cockpit.spin.rotation.z = -taxi.steer * (VEH_ID === 'moto' ? 0.5 : 2.2);
  // (le plan proche : 0,3 m seulement pour la vue intérieure ; plus loin dehors, la profondeur est plus précise et les surfaces lointaines ne scintillent plus sur téléphone)
  const cab = G.cam === 2 && !!cabin.eye && G.state !== 'menu' && !G.accident && !G.wewaFall;
  const fov = inside ? 74 : cab ? 84 : innerWidth / innerHeight < 1.3 ? 72 : 62, near = inside ? 0.3 : cab ? 0.15 : 1.2;
  if (camera.fov !== fov || camera.near !== near) { camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
  const k = snap ? 1 : 1 - Math.exp(-dt * (G.cam === 0 ? 6 : 30));
  camPos.lerp(tmpPos, k);
  camLook.lerp(tmpLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (lunettes.on && G.cam === 1 && !G.accident) lunettes.applyHead(camera);
}

function menuCamera(t) {
  const a = t * 0.12 + 0.6;
  worldVec(taxi.x + Math.sin(a) * 11, 4, taxi.z + Math.cos(a) * 11, camera.position);
  camera.lookAt(worldVec(taxi.x, 1, taxi.z, tmpLook));
  camPos.copy(camera.position);
  camLook.copy(tmpLook);
}

// ---------- Boucle ----------
let last = performance.now();
let menuT = 0;
const perf = { n: 0, sum: 0, skip: 1 };
let extDone = false;                                    // (décor lointain du prolongement : construit par tranches, voir world.js extStep)
const portraitTouch = matchMedia('(orientation: portrait) and (pointer: coarse)');

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  // Adaptation automatique : si l'image reste lente 4 s, on allège (ombres coupées, puis image moins définie)
  if (!extDone) {
    try { extDone = ROAD1.world.extStep?.(G.state === 'play' ? 5 : 14) ?? true; } catch (err) { extDone = true; console.error(err); }
    if (extDone) releaseCpuCopies(scene);
  }
  if (G.state === 'play' && !document.hidden && extDone) {
    perf.n++; perf.sum += now - last;
    if (perf.sum > 4000) {
      const fps = perf.n * 1000 / perf.sum;
      perf.n = 0; perf.sum = 0;
      if (fps < 26 && perf.skip-- <= 0) {
        if (quality === 'high') { quality = 'low'; $('sel-quality').value = 'low'; applyQuality(); hud.toast('Image lente : mode « Légers » activé.', 3); }
        else if (renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.2); applyQuality(); hud.toast('Image lente : définition réduite.', 3); }
        perf.skip = 1;                                  // (on laisse une période pour juger le nouveau réglage)
      }
    }
  } else { perf.n = 0; perf.sum = 0; perf.skip = 1; }
  last = now;

  if (G.state === 'play') {
    if (portraitTouch.matches) pause();
    else try { update(dt); } catch (err) { panne(`Erreur : ${err.message} — ${(err.stack ?? '').split('\n')[1]?.split('/').pop() ?? ''}`); console.error(err); }
  }

  place(taxiMesh, taxi.x, taxi.z, taxi.heading, taxi.y + (G.wewaFall ? Math.abs(G.wewaFall.curRoll ?? 0) * 0.14 : 0));
  taxiMesh.rotation.x = Math.atan(aheadH(0.5) - aheadH(-0.5));   // pente selon le sens (rampes, remblai, pont de l'Échangeur)
  taxiMesh.rotation.z = G.wewaFall ? (G.wewaFall.curRoll ?? 0) : 0;
  if (taxiMesh.userData.character) {
    const sp = G.state === 'menu' ? 3.8 : Math.abs(taxi.speed);
    const tPose = G.state === 'menu' ? menuT : G.time;
    taxiMesh.userData.character.pose(sp < 0.25 ? 'idle' : sp < 2.4 ? 'walk' : 'run', tPose, Math.max(1.2, sp * 0.52));
  }
  taxiMesh.visible = G.cam === 0 || G.state === 'menu' || !!G.accident || !!G.wewaFall;
  nightFrame();
  cabinFrame();
  followRoads();

  if (G.state === 'menu') { menuT += dt; menuCamera(menuT); }
  else updateCamera(dt);
  if (window.__essaiCam) window.__essaiCam(camera);                 // (?essai=personnages : caméra posée par l'essai)

  if (G.state === 'play' || G.state === 'pause') hud.update(dt, G, taxi, passengers);
  updateItin(dt);
  updateBubbles(G.state === 'play' ? dt : 0);
  if (lunettes.on && G.state !== 'menu') lunettes.render(scene, camera);
  else {
    renderer.render(scene, camera);
    if ((G.state === 'play' || G.state === 'pause') && !G.accident && retro.on) renderMirror();
  }
}
/** Point du monde à d m devant le véhicule (derrière si d < 0) et s m à sa droite (à gauche si s < 0), à la hauteur y. */
function beside(d, s, y, out) {
  const h = taxi.heading;
  if (stretchX(taxi.x, taxi.z) === 1) return worldVec(taxi.x + Math.sin(h) * d + Math.cos(h) * s, y, taxi.z - Math.cos(h) * d + Math.sin(h) * s, out);
  const th = yawAt(taxi.z) + h;                  // (terre-plein élargi de l'Échangeur : en mètres réels)
  worldVec(taxi.x, y, taxi.z, out);
  out.x += Math.sin(th) * d + Math.cos(th) * s;
  out.z += -Math.cos(th) * d + Math.sin(th) * s;
  return out;
}
const mirPos = new THREE.Vector3(), mirLook = new THREE.Vector3();
/** Le rétroviseur : caméra arrière au-dessus de l'arrière du véhicule ; ◀ ▶ : au rétroviseur extérieur gauche ou droit, tournée vers l'arrière et le côté. */
function renderMirror() {
  const g = G.glance, bus = VEH_ID === 'bus', moto = VEH_ID === 'moto';
  if (!g) {
    beside(-VEH.l / 2 + 0.3, 0, taxi.y + (bus ? 2.35 : moto ? 1.4 : 1.4), mirPos);
    beside(-32, 0, taxi.y + 0.7, mirLook);
  } else {
    beside(VEH.l * 0.2, g * (VEH.w / 2 + 0.35), taxi.y + (bus ? 1.7 : 1.15), mirPos);
    beside(-22, g * (VEH.w / 2 + 7), taxi.y + 0.5, mirLook);
  }
  A.group.localToWorld(mirPos);
  A.group.localToWorld(mirLook);
  retro.render(scene, mirPos, mirLook, [cockpit.group]);
}

applyQuality();
passengers.reset();
traffic.reset(taxi);
life.reset(taxi.z);
show('menu');
if (transfer) continueShift(transfer);
else if (PARAMS.get('autostart') === '1') {
  const url = new URL(location.href);
  url.searchParams.delete('autostart');
  history.replaceState(null, '', url.href);
  startShift();
}
requestAnimationFrame(frame);

// Tests sans écran (?debug=1) : l'état du jeu et quelques fonctions, pour les scripts de test de l'auteur (rien sans ce paramètre)
if (PARAMS.get('debug')) {
  globalThis.__taxiDbg = {
    taxi, G, input, VEH: () => VEH_ID, A: () => A.title, sim: (dt, step = true) => { if (step) update(dt); updateCamera(dt, true); },
    blockedAt: (x, z, l) => A.W.blockedAt(x, z, l), surfaceH: (x, z, l) => A.W.surfaceH(x, z, l), signals: () => A.W.SIGNALS, fuels: () => A.W.FUELS,
    setMinutes: m => { G.time = (m - 360) * SHIFT_SECONDS / 720; nightTick(); }, night: () => nightK, start: startShift, setVehicle, cam: c => { G.cam = c; },
    glance: v => { G.glance = v; }, retro, toGame: A.RT.toGame,
    // des clients à bord sans passer par un arrêt, et le prédicateur (tests de la vue cabine)
    board: n => { for (let i = 0; i < n; i++) { const ch = passengers.newChar({ kind: Math.random() < 0.5 ? 'woman' : 'man' }); ch.mesh.visible = false; BOARD.riders.push({ type: { kind: 'man' }, side: 1, road: passengers, destName: null, destZ: null, price: BOARD.fare, ch }); } return BOARD.riders.length; },
    preach: long => { preacher.start(long); return preacher.who; }, preacher, sound, radio, incidents, get life() { return life; }, rain, sceneFogFar: () => Math.round(scene.fog.far),
    solid: (x, z, h) => solidAround(x, z, h), get qlife() { return A.qlife; }, aerial: (p, l) => { G.dbgCam = p ? { p, l } : null; }, scene, worldVec, roads: () => ({ ROAD1, ROAD2, ROAD3, ROAD4, ROAD5, ROAD6, ROAD7, ROAD8 }), get road() { return A; }, switchRoad: (to, x, z, h) => { switchRoad(to, x, z, h, true); Object.assign(taxi, { x, z, heading: h, speed: 0, level: null }); traffic.reset(taxi); life.reset(taxi.z); }, THREE, RT1,
  };
}
// Essai de l'embouteillage grave (?essai=bouchon&debug=1) : le taxi est posé au milieu de la zone, la circulation tourne 40 s, puis le compte est écrit dans la console
if (PARAMS.get('essai') === 'bouchon') {
  const stat = z => {
    const near = traffic.list.filter(v => v.mesh.visible && Math.abs(v.z - z) < 120), jam = traffic.list.filter(v => v.jam && v.mesh.visible);
    let overlaps = 0;
    for (const a of near) for (const b of near) if (a !== b && a.side === b.side && Math.abs(a.x - b.x) < 1.4 && a.z < b.z && b.z - a.z < (a.len + b.len) / 2 - 0.3) overlaps++;
    const sp = near.reduce((n, v) => n + v.speed, 0) / Math.max(1, near.length);
    const kinds = {};
    for (const v of near) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
    return `visibles ±120 m : ${near.length} (dont embouteillage ${jam.length}), vitesse moyenne ${sp.toFixed(1)} m/s, chevauchements ${overlaps}, types ${JSON.stringify(kinds)}`;
  };
  startShift();
  const z0 = -A.RT.toGame(7000);
  Object.assign(taxi, { x: W1.LANE_R ?? 4, z: z0, speed: 0 });
  traffic.reset(taxi);
  console.log(`BOUCHON début : taxi z ${z0.toFixed(0)}, ${traffic.list.length} véhicules dans la liste, dont ${traffic.list.filter(v => v.jam).length} de l'embouteillage`);
  for (let i = 0; i < 800; i++) { traffic.update(0.05, taxi, G.time + i * 0.05); if (i === 20) console.log('BOUCHON 1 s : ' + stat(z0)); if (i === 399) console.log('BOUCHON 20 s : ' + stat(z0)); }
  console.log('BOUCHON 40 s : ' + stat(z0));
  taxi.z = -A.RT.toGame(2500); traffic.update(0.05, taxi, 0);
  console.log('BOUCHON hors zone (taxi à 2,5 km) : actif ' + traffic.jamActive + ', visibles de l\'embouteillage ' + traffic.list.filter(v => v.jam && v.mesh.visible).length);
}
// ===== MENU WIZARD 4 ÉTAPES (version corrigée) =====
var STEP = 1;   // (var : toMenu() appelle goStep() avant cette ligne ; avec let : « Cannot access STEP before initialization »)

function goStep(n) {
  STEP = n;
  document.querySelectorAll('.menu-step').forEach(s => {
    s.classList.toggle('active', +s.dataset.step === n);
  });
  document.querySelectorAll('.wizard-progress span').forEach((d, i) => {
    d.classList.toggle('on', i < n);
  });
  console.log('🎯 Étape', n);
}

// Navigation avec les boutons "Suivant" et "Retour"
document.querySelectorAll('[data-next]').forEach(b => {
  b.addEventListener('click', () => goStep(+b.dataset.next));
});
document.querySelectorAll('[data-back]').forEach(b => {
  b.addEventListener('click', () => goStep(+b.dataset.back));
});

// Étape 1 → 2 : après clic sur un mode (on attend que drawMenu() finisse)
setTimeout(() => {
  const mt = document.getElementById('mode-travail');
  const mc = document.getElementById('mode-course');
  if (mt) mt.addEventListener('click', () => setTimeout(() => goStep(2), 100));
  if (mc) mc.addEventListener('click', () => setTimeout(() => goStep(2), 100));
}, 0);

// Étape 2 → 3 : après sélection d'un véhicule
// Étape 3 → 4 : après sélection d'une ligne
document.addEventListener('click', (e) => {
  const vehBtn = e.target.closest('#vehs .route-btn');
  if (vehBtn && vehBtn.getAttribute('aria-checked') === 'true') {
    setTimeout(() => goStep(3), 150);
  }
  const routeBtn = e.target.closest('#routes .route-btn');
  if (routeBtn && routeBtn.getAttribute('aria-checked') === 'true') {
    setTimeout(() => goStep(4), 150);
  }
});

// S'assurer que le bouton "Commencer la journée" lance bien le jeu
setTimeout(() => {
  const btnStart = document.getElementById('btn-start');
  if (btnStart) {
    // On retire les anciens écouteurs pour éviter les conflits
    const newBtn = btnStart.cloneNode(true);
    btnStart.parentNode.replaceChild(newBtn, btnStart);
    newBtn.addEventListener('click', () => {
      console.log('🚀 Lancement du jeu...');
      console.log('Mode:', MODE, 'Véhicule:', VEH_ID, 'Itinéraire:', IT?.id);
      if (typeof startShift === 'function') {
        startShift();
      } else {
        console.error('❌ startShift() non trouvé');
      }
    });
  }
}, 500);

// Initialisation
goStep(1);

