// Circulation sur 2 × 4 voies : beaucoup de taxis et taxis-bus jaunes, des motos qui se faufilent,
// des camions de marchandises. Suivi de distance, arrêts des taxis-bus, réaction au klaxon.
import { createCar, createMinibus, createCityBus, createTruck, createMoto, createTricycle, createHatchback, createVan, createSUV, createPolicePickup, createPoliceVan, createAmbulance, createEspritDeVie, createTranscoMidi, createTanker, createCitadine, createCrossover, createYango, createTipperTruck, createContainerTruck, createCraneTruck, createFlatbedTruck, createReeferTruck, createCurtainTruck } from './models.js';
import { LANE_X, LANE_W, RAMP_X, ROAD_EDGE, flyH, flySlope, inFlyover, roadH, roadSlope, TRAFFIC_END, SIGNALS, signalState, ONEWAY_IN, TRAFFIC_MIX, TRAFFIC_START, jamSpeed, ringShift, WORKS, closedLanesAt, JAMS } from './world.js';
import { place } from './route.js';

const CAR_COLORS = [0xf2f2f2, 0xb8bec4, 0x1e3a8a, 0x7a1f1f, 0x1f1f1f, 0x2f6f3e, 0x9aa5b1];
const TAXI_YELLOW = 0xf2c200;
const AHEAD = 320;
const BEHIND = 90;
const TAXI_L = 4.2, TAXI_W = 1.8;
// Emprise du taxi en x (largeur) et en z (longueur) selon son cap : main.js met à jour taxi.bw et taxi.bl (conduite libre)
const tw = taxi => taxi.bw ?? TAXI_W, tl = taxi => taxi.bl ?? TAXI_L;
// Sur un saut-de-mouton, le taxi et la voiture sont-ils au même niveau (rampe en haut, voies du bas et dessous du tablier) ?
// (sur le pont de la route arrière de l'Échangeur, dans son terre-plein élargi ou sous le 2e pont du Pont Matete, le taxi
// ne croise aucune voiture)
const sameLevel = (taxi, v) => taxi.level !== 'pont' && taxi.level !== 'sous' && !taxi.core && (!taxi.level || !inFlyover(v.z, 2) || (taxi.level === 'up') === (Math.abs(v.x) < RAMP_X));
const RIGHT = LANE_X.length - 1;

// Composition du trafic dans notre sens et en sens inverse
const MIX_OUR = ['taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'bus', 'bus', 'bus', 'bus', 'bus', 'van', 'amb', 'edv', 'keke', 'keke', 'keke',
  'car', 'car', 'car', 'car', 'police', 'truck', 'truck', 'city', 'moto', 'moto', 'moto', 'moto', 'moto'];
// (l'auteur, 08/11 : « dans le chemin de retour il n'y a pas assez de bus ») : autant de bus et de taxis que dans notre sens
const MIX_ONC = ['taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'taxi', 'amb', 'bus', 'bus', 'bus', 'bus', 'bus', 'van', 'edv', 'car', 'car', 'car', 'police', 'truck', 'city', 'moto', 'moto', 'moto', 'keke', 'keke'];

// Embouteillages graves (routes.js `jams`, force supérieure à 1 ; l'auteur, 20/11 : de Pascal au Quartier 1, beaucoup de véhicules) : une flotte de plus, cachée loin
// de la route, qui se range pare-chocs contre pare-chocs autour du taxi quand il arrive dans la zone, et disparaît quand il en sort
const JAM_FLEET = { 1: 100, '-1': 55 };       // (l'auteur, 20/11, image fondvoiture : toutes les voies pleines, pare-chocs contre pare-chocs, la file jusqu'à l'horizon)
const JAM_MIX = ['taxi', 'bus', 'car', 'truck', 'bus', 'keke', 'car', 'taxi', 'truck', 'van', 'car', 'moto', 'bus', 'truck', 'city', 'taxi', 'car', 'edv', 'truck', 'car', 'bus', 'moto', 'taxi', 'truck', 'car', 'keke'];
const CRUISE = { taxi: [11, 16], bus: [9, 13], van: [10, 14], car: [11, 17], truck: [7, 10], city: [8, 11], moto: [13, 18], keke: [7, 11], police: [11, 16], edv: [8, 12], amb: [13, 18] };

function makeMesh(kind) {
  switch (kind) {
    case 'taxi': return Math.random() < 0.5 ? createHatchback() : createCar({ color: TAXI_YELLOW, taxi: true, roof: false });
    case 'van': return createVan();
    case 'bus': return Math.random() < 0.6 ? createMinibus({ top: 0x2a93cc }) : createMinibus();
    case 'police': return Math.random() < 0.5 ? createPolicePickup() : createPoliceVan();
    case 'edv': return createEspritDeVie();
    case 'amb': return createAmbulance();
    case 'city': return Math.random() < 0.4 ? createTranscoMidi() : createCityBus();
    case 'truck': {                                        // (l'auteur, 20/11 : les autres formes de camions du dossier Herman)
      const r = Math.random();
      return r < 0.1 ? createTanker() : r < 0.2 ? createTruck() : r < 0.36 ? createTipperTruck() : r < 0.5 ? createContainerTruck() : r < 0.62 ? createCraneTruck()
        : r < 0.74 ? createFlatbedTruck() : r < 0.87 ? createReeferTruck() : createCurtainTruck();
    }
    case 'moto': { const riders = Math.random() < 0.5 ? 1 : 2, m = createMoto({ riders }); m.userData.riders = riders; return m; }   // (le wewa roule seul ou avec un passager)
    case 'keke': return createTricycle();
    default: {                                             // voitures personnelles, de plusieurs modèles
      const r = Math.random();
      return r < 0.28 ? createSUV() : r < 0.52 ? createCar({ color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] }) : r < 0.72 ? createCitadine() : r < 0.88 ? createCrossover() : createYango();
    }
  }
}

/** Glissement latéral vers la voie cible : le véhicule pivote vers là où il va (cap = atan(vitesse latérale / vitesse), lissé), il ne glisse pas de côté.
 *  base = cap de la chaussée (0 vers -z, π vers +z). */
function steerX(v, dt, base, maxRate = 2.2) {
  const dx = v.targetX - v.x;
  const rate = Math.min(maxRate, 0.5 + Math.abs(v.speed) * 0.22);
  let lat = 0;
  if (Math.abs(dx) > 0.02) { lat = Math.sign(dx) * Math.min(Math.abs(dx) / Math.max(dt, 1e-3), rate); v.x += lat * dt; }
  const want = Math.max(-0.32, Math.min(0.32, Math.atan2(lat, Math.max(Math.abs(v.speed), 2.5))));
  const sgn = base === 0 ? -1 : 1;   // vers +x : cap négatif sur la chaussée 0, positif sur la chaussée π
  v.yawS = (v.yawS ?? 0) + (sgn * want - (v.yawS ?? 0)) * Math.min(1, dt * 6);
  return base + v.yawS;
}

/** Place le véhicule, sur la rampe du saut-de-mouton s'il roule sur les voies intérieures. */
function put(v, yaw) {
  const up = Math.abs(v.x) < RAMP_X;
  // (Rond-point Victoire : le véhicule contourne la place, et se tourne dans le sens de sa courbe)
  const xr = ringShift(v.x, v.z);
  if (xr !== v.x) { const sl = (ringShift(v.x, v.z - 0.5) - ringShift(v.x, v.z + 0.5)); yaw += Math.atan(sl); }
  place(v.mesh, xr, v.z, yaw, (up ? flyH(v.z) : 0) + roadH(v.z) + (v.fallen ? 0.18 : 0));
  v.mesh.rotation.x = Math.atan(v.side * ((up ? flySlope(v.z) : 0) + roadSlope(v.z)));
  v.mesh.rotation.z = v.fallen ? (v.fallRoll ?? 1.42) : 0;
  if (v.mesh.userData.character) {
    v.mesh.userData.character.pose(v.speed > 0.3 ? 'run' : 'idle', performance.now() * 0.001, Math.max(2.6, v.speed * 0.45));
  }
  v.mesh.visible = v.z > TRAFFIC_END;
}

const laneOf = x => {
  let best = 0;
  LANE_X.forEach((lx, i) => { if (Math.abs(Math.abs(x) - lx) < Math.abs(Math.abs(x) - LANE_X[best])) best = i; });
  return best;
};

/**
 * Trajet d'une voiture qui sort de la rue au carrefour sg (dir -1 : de la droite vers la gauche, +1 : l'inverse).
 * Elle roule sur la moitié droite de la rue, suit la rue (même en biais), traverse le boulevard ; s'il n'y a pas de rue
 * en face (ou une rue à sens unique dont on ne peut que sortir), elle tourne à gauche sur l'autre chaussée.
 * Polyligne (x, z), longueurs cumulées, arrêt au feu (uStop).
 */
function crossPath(sg, dir) {
  const from = -dir, off = dir < 0 ? -2.3 : 2.3, RT = 4.5;                     // RT : rayon du virage à gauche
  const zAt = x => {
    const r = sg.streets[Math.sign(x)], ax = Math.abs(x);
    if (!r || ax <= ROAD_EDGE) return sg.z + off;
    if (ax <= sg.xIn) return r.z + (r.z2 - r.z) * (ax - ROAD_EDGE) / (sg.xIn - ROAD_EDGE) + off;
    return r.z2 - (ax - sg.xIn) * Math.tan(r.ang) + off;
  };
  const reach = r => (r.len > 20 ? sg.xIn + 34 : sg.xIn + 4);              // sur la rue, ou jusqu'au petit boulevard
  const pts = [], to = sg.streets[dir]?.oneway === 'out' ? null : sg.streets[dir];
  const xEnd = to ? dir * reach(to) : dir * (LANE_X[1] - RT);                 // le virage finit sur la 2e voie
  for (let x = from * reach(sg.streets[from]); dir < 0 ? x > xEnd : x < xEnd; x += dir * 2) pts.push([x, zAt(x)]);
  pts.push([xEnd, zAt(xEnd)]);
  if (!to) {                                                                  // pas de rue en face : à gauche, sur l'autre chaussée
    const [x0, z0] = pts[pts.length - 1];
    for (let k = 1; k <= 8; k++) {
      const f = k / 8 * Math.PI / 2;
      pts.push([x0 + dir * RT * Math.sin(f), z0 - dir * RT * (1 - Math.cos(f))]);
    }
    const [ex, ez] = pts[pts.length - 1];
    for (let d = 4; d <= 72; d += 4) pts.push([ex, ez - dir * d]);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const iStop = pts.findIndex(p => Math.abs(p[0]) <= sg.stopX);
  return { pts, cum, total: cum[cum.length - 1], uStop: cum[Math.max(0, iStop)] };
}

/** Une voiture qui apparaît à l'approche d'un feu (ou dans le carrefour) n'aurait pas le temps de freiner : elle est reportée juste après le carrefour. */
function clearOfSignals(z, side, len) {
  for (const sg of SIGNALS) {
    const g = side > 0 ? z - len / 2 - sg.stopR : sg.stopL - z - len / 2;     // nez → ligne d'arrêt
    if (g < 40 && g > sg.stopL - sg.stopR - len) return side > 0 ? sg.stopL - len / 2 - 2 - Math.random() * 8 : sg.stopR + len / 2 + 2 + Math.random() * 8;
  }
  return z;
}

/**
 * Trajet d'une voiture qui quitte le boulevard pour entrer dans une rue à sens unique (ONEWAY_IN) : voie de droite de la
 * chaussée de ce côté (150 m d'approche), virage à droite, puis la rue (même en biais) jusqu'au-delà du petit boulevard.
 */
function turnPath(r) {
  const s = r.side, dz = s > 0 ? -1 : 1, xl = s * LANE_X[RIGHT], RT = 5;
  const zAt = ax => {                                                       // voie de droite de la rue, à |x| = ax
    if (ax <= r.xIn) return r.z + (r.z2 - r.z) * (ax - ROAD_EDGE) / (r.xIn - ROAD_EDGE) + s * 2.3;
    return r.z2 - (ax - r.xIn) * Math.tan(r.ang) + s * 2.3;
  };
  const L = Math.hypot(r.xIn - ROAD_EDGE, r.z2 - r.z), h0 = [0, dz], h1 = [s * (r.xIn - ROAD_EDGE) / L, (r.z2 - r.z) / L];
  const right = h => [-h[1], h[0]], r0 = right(h0), r1 = right(h1);
  const turn = Math.acos(Math.max(-1, Math.min(1, h0[0] * h1[0] + h0[1] * h1[1])));
  const xe = xl + RT * (r0[0] - r1[0]), zs = zAt(Math.abs(xe)) - RT * (r0[1] - r1[1]);   // le virage finit sur la voie de la rue
  const pts = [];
  for (let d = 150; d > 0; d -= 6) pts.push([xl, zs - dz * d]);
  const C = [xl + r0[0] * RT, zs + r0[1] * RT];
  for (let k = 0; k <= 10; k++) {
    const f = turn * k / 10, h = [h0[0] * Math.cos(f) - h0[1] * Math.sin(f), h0[0] * Math.sin(f) + h0[1] * Math.cos(f)], rr = right(h);
    pts.push([C[0] - rr[0] * RT, C[1] - rr[1] * RT]);
  }
  for (let ax = Math.abs(xe) + 2; ax <= r.xIn + 30; ax += 2) pts.push([s * ax, zAt(ax)]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, total: cum[cum.length - 1], uStop: -Infinity, uTurn: cum[25], dz };
}

/** Position et cap à la distance u le long d'un trajet. */
function pathAt(P, u) {
  const { pts, cum } = P;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < u) i++;
  const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (u - cum[i - 1]) / seg));
  const hx = b[0] - a[0], hz = b[1] - a[1], L = Math.hypot(hx, hz) || 1;
  return { x: a[0] + hx * t, z: a[1] + hz * t, hx: hx / L, hz: hz / L };
}

export class Traffic {
  constructor(scene) {
    this.list = [];
    this.scene = scene;
    this.blocks = [];                                // (incidents.js) { z, side } : la circulation de ce côté s'arrête avant z
    for (const k of TRAFFIC_MIX?.our ?? MIX_OUR) this.add(scene, 1, k);
    for (const k of TRAFFIC_MIX?.onc ?? MIX_ONC) this.add(scene, -1, k);
    this.jamActive = false;
    this.jamTodo = [];
    if (JAMS.some(j => j.lvl > 1)) {
      for (const side of [1, -1]) {
        for (let i = 0; i < JAM_FLEET[side]; i++) {
          this.jamTodo.push([side, JAM_MIX[(i * 7 + (side > 0 ? 0 : 3)) % JAM_MIX.length]]);
        }
      }
    }
    // Carrefours à feux : des voitures sortent de la rue et traversent le boulevard pendant le vert de la rue.
    // dir -1 : de la droite vers la gauche, dir +1 : de la gauche vers la droite (seulement s'il y a une rue de ce côté)
    this.crossing = [];
    for (const sg of SIGNALS) {
      for (const dir of [-1, 1]) {
        if (!sg.streets[-dir] || sg.streets[-dir].oneway === 'in') continue;   // personne ne sort d'une rue d'entrée
        const path = crossPath(sg, dir);
        for (let i = 0; i < (dir < 0 ? 3 : 2); i++) {
          const mesh = makeMesh(['taxi', 'car', 'bus', 'taxi', 'van'][(i + (dir > 0 ? 2 : 0)) % 5]);
          scene.add(mesh);
          this.crossing.push({ mesh, sg, dir, path, i, len: mesh.userData.L, wid: mesh.userData.W, u: 0, speed: 0, delay: 0,
            hidden: false, inside: false, x: 0, z: 0, hx: dir, hz: 0 });
        }
      }
    }
    // Rues à sens unique d'entrée : des voitures quittent le boulevard (voie de droite) et y tournent, sans feu
    for (const r of ONEWAY_IN) {
      const path = turnPath(r), ref = { z: r.z, w: 0 };
      for (let i = 0; i < 2; i++) {
        const mesh = makeMesh(['car', 'taxi'][i]);
        scene.add(mesh);
        this.crossing.push({ mesh, sg: ref, dir: 0, path, i, turner: true, len: mesh.userData.L, wid: mesh.userData.W, u: 0, speed: 0,
          delay: 0, hidden: false, inside: false, x: 0, z: 0, hx: 0, hz: -r.side });
      }
    }
    this.resetCrossing();
  }

  resetCrossing() {
    for (const c of this.crossing) {
      c.u = c.turner ? 0 : Math.max(0, c.path.uStop - c.len / 2 - 0.6 - c.i * 7);   // en file devant la ligne d'arrêt de la rue
      c.speed = 0;
      c.delay = c.turner ? 1 + c.i * 8 : c.i * 1.5;
      c.hidden = !!c.turner;                                              // elles partent quand la voie est libre
      c.inside = false;
    }
  }

  /** Vitesse maximale pour s'arrêter avant la ligne d'arrêt d'un feu (side 1 : vers -z, -1 : vers +z). */
  signalLimit(v, st, side) {
    if (!st) return Infinity;
    let lim = Infinity;
    for (const sg of SIGNALS) {
      const g = side > 0 ? v.z - v.len / 2 - sg.stopR : sg.stopL - v.z - v.len / 2;
      if (g < -1 || g > 70) continue;
      const busy = this.crossing.some(c => c.inside && c.sg === sg);   // une voiture de la rue encore dans le carrefour
      if (busy || st.main === 'red' || (st.main === 'amber' && g > 14)) lim = Math.min(lim, Math.max(0, (g - 1) * 0.6));
    }
    return lim;
  }

  /** Un véhicule du boulevard est encore dans le carrefour sg (entré à l'orange, par exemple). */
  boxBusy(sg) {
    return this.list.some(v => Math.abs(v.x) < ROAD_EDGE && Math.abs(v.z - sg.z) < (sg.w + v.len) / 2);
  }

  /** Voiture sortie d'une rue devant v, dans sa voie (side 1 : v roule vers -z, -1 : vers +z) : écart, et sa vitesse dans le sens de v. */
  crossGap(v, side) {
    let gap = Infinity, lead = 0;
    for (const c of this.crossing) {
      const ahead = side > 0 ? v.z - c.z : c.z - v.z, ax = Math.abs(c.hx), az = Math.abs(c.hz);
      if (c.hidden || ahead <= 0 || ahead > 40) continue;
      if (Math.abs(c.x - v.x) > (ax * c.len + az * c.wid + v.wid) / 2 + 0.3) continue;   // emprise selon son cap
      const g = ahead - (az * c.len + ax * c.wid + v.len) / 2;
      if (g < gap) { gap = g; lead = Math.max(0, -side * c.hz * c.speed); }
    }
    return { gap, lead };
  }

  /** Voitures qui sortent de la rue : attente au feu, traversée, puis retour au départ (cachées en attendant). */
  updateCrossing(dt, st, taxi) {
    let hit = null;
    for (const c of this.crossing) {
      const P = c.path;
      if (c.delay > 0) c.delay -= dt;
      else if (c.hidden && this.crossing.some(o => o !== c && o.path === P && !o.hidden && o.u < c.len + o.len / 2 + 3)) c.delay = 0.5;   // (l'auteur, 13/11 : pas sur une autre)
      else if (c.hidden && c.turner && this.list.some(v => {                // départ encombré : une voiture arrive derrière ou est là
        const d = (v.z - P.pts[0][1]) * P.dz;
        return Math.abs(v.x - P.pts[0][0]) < 2.5 && d > -35 && d < 12;
      })) c.delay = 0.5;
      else c.hidden = false;
      let target = c.turner ? (c.u < P.uTurn - 12 ? 11 : 6) : 7.5;          // sur le boulevard, puis au ralenti pour tourner
      const g = P.uStop - (c.u + c.len / 2);                                // nez de la voiture → ligne d'arrêt de la rue
      if (c.delay > 0) target = 0;
      else if (g > -1 && g < 45 && (st.street === 'red' || (st.street === 'amber' && g > 5) || this.boxBusy(c.sg))) target = Math.max(0, (g - 0.5) * 0.8);
      for (const o of this.crossing) {                                       // voiture de devant, sur le même trajet
        if (o === c || o.path !== P || o.hidden) continue;
        const d = o.u - c.u;
        if (d > 0) target = Math.min(target, Math.max(0, (d - (o.len + c.len) / 2 - 2.5) * 0.8));
      }
      if (Math.abs(c.hz) > 0.7) for (const v of this.list) {                // après le virage : suit la voiture de devant sur sa voie
        const d = (v.z - c.z) * Math.sign(c.hz);
        if (d > 0 && d < 30 && Math.abs(v.x - c.x) < (v.wid + c.wid) / 2 + 0.3) target = Math.min(target, Math.max(0, (d - (v.len + c.len) / 2 - 2.5) * 0.8));
      }
      const dx = taxi.x - c.x, dz = taxi.z - c.z, along = dx * c.hx + dz * c.hz;   // le taxi sur son chemin : elle attend
      if (along > 0 && along < c.len / 2 + 7 && Math.abs(dz * c.hx - dx * c.hz) < 2.4) target = 0;
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), (target > c.speed ? 2.5 : 8) * dt);
      c.u += c.speed * dt;
      if (c.u >= P.total) { c.u = 0; c.speed = 0; c.delay = c.turner ? 3 + Math.random() * 9 : 2 + Math.random() * 6; c.hidden = true; }
      const p = pathAt(P, c.u);
      c.x = p.x; c.z = p.z; c.hx = p.hx; c.hz = p.hz;
      c.inside = Math.abs(c.x) < ROAD_EDGE + 1.5 && Math.abs(c.z - c.sg.z) < c.sg.w / 2 + 2;
      place(c.mesh, c.x, c.z, Math.atan2(c.hx, -c.hz), 0);
      c.mesh.visible = !c.hidden && Math.abs(c.sg.z - taxi.z) < 420;
      if (!c.hidden) {                                                      // choc avec le taxi (boîte selon son cap)
        const across = Math.abs(c.hx) > 0.7, ex = across ? c.len : c.wid, ez = across ? c.wid : c.len;
        if (Math.abs(taxi.x - c.x) < (tw(taxi) + ex) / 2 && Math.abs(taxi.z - c.z) < (tl(taxi) + ez) / 2) hit = { x: c.x, z: c.z, len: ez, wid: ex, speed: 0 };
      }
    }
    return hit;
  }

  add(scene, side, kind) {
    const mesh = makeMesh(kind);
    mesh.rotation.order = 'YXZ';      // cap puis tangage (rampes)
    scene.add(mesh);
    const v = { mesh, side, kind, len: mesh.userData.L, wid: mesh.userData.W, x: 0, targetX: 0, z: 0, speed: 0, cruise: 0, stop: 0, stuck: 0, weave: 0 };
    this.list.push(v);
    return v;
  }

  /** Les véhicules de l'embouteillage grave : construits par petits lots après le départ, cachés tant que le taxi n'est pas dans la zone. */
  stepJamBuild(n = 2) {
    while (n-- > 0 && this.jamTodo.length) {
      const [side, kind] = this.jamTodo.shift();
      const v = this.add(this.scene, side, kind);
      v.jam = true;
      this.hideJam(v);
    }
  }
  inJamNow(z) { return this.jamActive && JAMS.some(j => j.on && j.lvl > 1 && z < j.z0 && z > j.z1); }
  hideJam(v) { v.x = v.targetX = 0; v.z = 1e7; v.speed = 0; v.mesh.visible = false; }
  startJam(taxi) {
    if (this.jamTodo.length) this.stepJamBuild(this.jamTodo.length);
    this.jamActive = true;
    for (const v of this.list) if (v.jam) { this.place(v, taxi.z, 0, taxi); put(v, v.side === 1 ? 0 : Math.PI); }
  }
  stopJam() {
    this.jamActive = false;
    for (const v of this.list) if (v.jam) this.hideJam(v);
  }

  /** Un blocage (incidents.js) ne retient que les véhicules des voies qu'il occupe (x0..x1) ; sans x0 : toute la chaussée. */
  blockHits(bk, v) { return bk.x0 === undefined || (v.targetX > bk.x0 - 0.8 && v.targetX < bk.x1 + 0.8) || (v.x > bk.x0 - 0.8 && v.x < bk.x1 + 0.8); }

  laneFree(x, z, self, taxi, margin = 10, side = 1) {
    if (taxi && Math.abs(taxi.x - x) < 2.4 && Math.abs(taxi.z - z) < margin + tl(taxi) / 2) return false;
    return !this.list.some(o => o !== self && o.side === side && Math.abs(o.targetX - x) < 1.5 && Math.abs(o.z - z) < margin + o.len / 2);
  }

  place(v, zFrom, span, taxi) {
    // (une jeep recyclée : les personnes arrêtées qu'elle emmenait, assises à l'arrière, s'en vont avec elle ; incidents.js seat)
    if (v.cargo?.length) { for (const m of v.cargo) { v.mesh.remove(m); m.geometry.dispose(); } v.cargo = []; }
    if (v.fallen) {
      v.fallen = false;
      v.fallRoll = 0;
      v.mesh.rotation.z = 0;
      v.mesh.traverse(m => { if (m.userData.rider) m.visible = true; });
    }
    if (v.jam && taxi) {                                                    // (embouteillage grave : juste devant le taxi, et dans la zone de l'embouteillage)
      const J = JAMS.find(j => j.on && j.lvl > 1 && taxi.z < j.z0 + 700 && taxi.z > j.z1 - 700);
      zFrom = taxi.z + 25; span = v.side > 0 ? 240 : 200;
      if (J) zFrom = Math.min(J.z0 - 20, Math.max(J.z1 + 20 + span, zFrom));
    }
    const sign = v.side;
    // Les taxis-bus et camions roulent plutôt à droite, les voitures à gauche
    const preferRight = v.kind === 'bus' || v.kind === 'van' || v.kind === 'truck' || v.kind === 'city' || v.kind === 'keke';
    let x = 0, z = zFrom, free = false;
    for (let k = 0; k < 12; k++) {
      z = zFrom - Math.random() * span;
      const lane = preferRight && Math.random() < 0.7 ? RIGHT - Math.floor(Math.random() * 2) : Math.floor(Math.random() * LANE_X.length);
      x = sign * LANE_X[lane];
      z = clearOfSignals(z, v.side, v.len);
      if (this.laneClosedNear(v.side, lane, z, 60)) continue;               // (l'auteur, 13/11 : pas dans les voies fermées d'un chantier)
      if (this.laneFree(x, z, v, taxi, v.jam ? 5 + v.len / 2 : 14, v.side)) { free = true; break; }   // (l'auteur, 13/11 : « les véhicules se passent transparents » : jamais posé sur un autre)
    }
    if (!free) {
      // (aucune place en 12 essais : une voie ouverte, jamais une voie fermée par un chantier ; puis plus loin jusqu'à une place libre)
      const away = taxi ? (z <= taxi.z ? -1 : 1) : -1;
      if (this.laneClosedNear(v.side, laneOf(x), z, 60)) { const l = LANE_X.map((_, i) => i).find(i => !this.laneClosedNear(v.side, i, z, 60)); if (l !== undefined) x = sign * LANE_X[l]; }
      for (let k = 0; k < 40 && (!this.laneFree(x, z, v, taxi, v.jam ? 5 + v.len / 2 : 14, v.side) || this.laneClosedNear(v.side, laneOf(x), z, 60)); k++) z += away * (v.jam ? 4 : 7);
    }
    v.x = v.targetX = x;
    v.z = z;
    const [lo, hi] = CRUISE[v.kind];
    v.cruise = lo + Math.random() * (hi - lo);
    v.speed = v.cruise;
    v.stop = 0;
    v.stuck = 0;
    v.weave = 2 + Math.random() * 4;
    v.chase = null;
    v.flee = 0;
    // (sans accident, une ou deux ambulances seulement passent en urgence dans la journée : day.urgent, partagé par toutes les routes)
    v.urgent = 0;
    if (v.kind === 'amb' && this.day?.urgent > 0 && Math.random() < 0.06) { this.day.urgent--; v.urgent = 25 + Math.random() * 15; }
  }

  reset(taxi) {
    if (this.jamActive) this.stopJam();
    const our = this.list.filter(v => v.side === 1 && !v.racer && !v.jam);
    const onc = this.list.filter(v => v.side === -1 && !v.racer && !v.jam);
    for (const v of this.list) if (v.jam) this.hideJam(v);
    our.forEach((v, i) => this.place(v, taxi.z - 40 - i * (AHEAD / our.length), 10, taxi));
    onc.forEach((v, i) => this.place(v, taxi.z + 60 - i * ((AHEAD + 40) / onc.length), 14, taxi));
    for (const v of this.list) if (!v.jam) put(v, v.side === 1 ? 0 : Math.PI);
    this.resetCrossing();
  }

  /** Change de voie si possible (dir = -1 vers la gauche, +1 vers la droite, 0 = au mieux). */
  tryLaneChange(v, taxi, dir = 0) {
    const cur = laneOf(v.targetX);
    const options = dir ? [cur + dir] : [cur - 1, cur + 1].sort(() => Math.random() - 0.5);
    // pas de changement entre la rampe et les voies du bas sur un saut-de-mouton (ni juste avant)
    const split = inFlyover(v.z, 12) || inFlyover(v.z - 45);
    for (const l of options) {
      if (l < 0 || l > RIGHT) continue;
      if (split && (LANE_X[l] < RAMP_X) !== (LANE_X[cur] < RAMP_X)) continue;
      if (this.laneClosedNear(v.side, l, v.z, 90)) continue;              // (chantier devant : pas vers une voie fermée)
      if (this.blocks.some(bk => bk.side === v.side && bk.x0 !== undefined && LANE_X[l] > bk.x0 - 0.8 && LANE_X[l] < bk.x1 + 0.8 && v.z - bk.z > -8 && v.z - bk.z < 120)) continue;   // (incident devant : pas vers une voie bloquée)
      if (this.laneSafe(LANE_X[l], v, taxi)) { v.targetX = LANE_X[l]; return true; }
    }
    return false;
  }

  /** (l'auteur, 13/11 : travaux) La voie l est-elle fermée par un chantier entre z et `ahead` mètres plus loin (pour un véhicule de `side`) ? */
  laneClosedNear(side, l, z, ahead) {
    if (!WORKS.length) return false;
    for (let d = -6; d <= ahead; d += 8) { const c = closedLanesAt(side, z - side * d); if (c && c.includes(l)) return true; }
    return false;
  }
  /** Un chantier devant v ferme sa voie : il se rabat sur la voie ouverte la plus proche s'il y a la place ; sinon il s'arrête avant le biseau.
   *  Renvoie la vitesse permise (Infinity s'il n'y a rien). */
  worksLimit(v, taxi, dt) {
    if (!WORKS.length) return Infinity;
    const l = laneOf(v.targetX);
    for (const Wk of WORKS) {
      if (!Wk.on || Wk.side !== v.side || !Wk.lanes.includes(l)) continue;
      const d = (v.z - Wk.zt) * v.side - v.len / 2;                      // (distance au début du biseau)
      if (d < -Wk.taper - (Wk.z0 - Wk.z1) || d > 140) continue;
      if ((v.mergeT = (v.mergeT ?? 0) - dt) <= 0) {
        v.mergeT = 0.4;
        const open = LANE_X.map((_, i) => i).filter(i => !Wk.lanes.includes(i)).sort((a, b) => Math.abs(a - l) - Math.abs(b - l));
        for (const i of open) if (this.laneSafe(v.side * LANE_X[i], v, taxi)) { v.targetX = v.side * LANE_X[i]; return Infinity; }
      }
      return Math.sqrt(2 * 6 * Math.max(0, d - 2));                      // (pas de place : il attend avant le biseau)
    }
    return Infinity;
  }
  /** (l'auteur, 13/11 : rien ne doit passer à travers) La voie x est-elle sûre pour que v s'y glisse : assez de place devant et derrière, selon les vitesses. */
  laneSafe(x, v, taxi) {
    const room = (d, half, faster, slower) => (d > 0 ? d - half >= 4 + Math.max(0, faster - slower) * 1.2 : -d - half >= 6 + Math.max(0, slower - faster) * 1.8);
    for (const o of this.list) {
      if (o === v || o.side !== v.side || !(Math.abs(o.targetX - x) < 1.5 || Math.abs(o.x - x) < (o.wid + v.wid) / 2 + 0.3)) continue;
      if (!room((v.z - o.z) * v.side, (o.len + v.len) / 2, v.speed, o.speed)) return false;   // (d > 0 : o est devant v)
    }
    if (taxi && sameLevel(taxi, v) && Math.abs(taxi.x - x) < (tw(taxi) + v.wid) / 2 + 0.3 && !room((v.z - taxi.z) * v.side, (tl(taxi) + v.len) / 2, v.speed, Math.abs(taxi.speed))) return false;
    return true;
  }
  /** (l'auteur, 13/11) v chevauche-t-il un autre véhicule ? On le recule plus loin du taxi jusqu'à une place libre (après un déplacement d'office). */
  unstack(v, taxi) {
    const away = taxi ? (v.z <= taxi.z ? -1 : 1) : -1;
    for (let k = 0; k < 40 && !this.laneFree(v.x, v.z, v, taxi, 8, v.side); k++) v.z += away * 6;
  }
  /** (incidents.js) La k-ième jeep de police (pick-up) de cette route : créée une fois, elle roule ensuite comme les autres. */
  jeep(k, taxi) {
    this.jeeps ??= [];
    if (!this.jeeps[k]) {
      const mesh = createPolicePickup();
      mesh.rotation.order = 'YXZ';
      this.scene.add(mesh);
      const v = { mesh, side: 1, kind: 'police', jeep: true, len: mesh.userData.L, wid: mesh.userData.W, x: 0, targetX: 0, z: 0, speed: 0, cruise: 0, stop: 0, stuck: 0, weave: 0 };
      this.list.push(v);
      this.place(v, taxi.z - AHEAD, 100, taxi);
      this.jeeps[k] = v;
    }
    return this.jeeps[k];
  }
  /** Une place libre pour un véhicule de `side`, à partir de d0 m derrière le taxi (vers z0 + side × d), voie du taxi d'abord. */
  freeSpot(taxi, side, d0, self) {
    const l0 = laneOf(taxi.x), lanes = [l0, ...LANE_X.map((_, i) => i).filter(i => i !== l0)];
    for (let d = d0; d <= d0 + 150; d += 6) for (const li of lanes) {
      const z = taxi.z + side * d, x = side * LANE_X[li];
      if (z > TRAFFIC_START) continue;
      if (this.laneFree(x, z, self, taxi, 10, side)) return [x, z];
    }
    return null;
  }

  /** Ambulance, ou police en poursuite, la plus proche du taxi (on l'entend à moins de 150 m), ou null. La police sans poursuite reste silencieuse. */
  sirenNear(taxi) {
    let best = null, bd = 150;
    for (const v of this.list) {
      if (!((v.kind === 'amb' && v.urgent > 0) || (v.kind === 'police' && v.chase)) || !v.mesh.visible) continue;
      const d = Math.hypot(v.x - taxi.x, v.z - taxi.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best && { kind: best.kind, near: 1 - bd / 150 };
  }

  /** Le taxi a commis une infraction : la police du même sens le prend en chasse (elle arrive derrière lui si elle n'y est pas déjà). */
  chaseTaxi(taxi) {
    const side = Math.cos(taxi.heading ?? 0) >= 0 ? 1 : -1, list = this.list.filter(v => v.kind === 'police' && v.side === side && !v.keep);   // (pas une jeep occupée par une scène)
    if (!list.length) return;
    const behind = v => (side > 0 ? v.z - taxi.z : taxi.z - v.z), v = list.find(q => behind(q) > 10 && behind(q) < 120) ?? list[0];
    if (!(behind(v) > 10 && behind(v) < 120)) {
      // (l'auteur, 13/11 : « le véhicule de la police passe les autres ») : elle arrive sur une place libre derrière le taxi, jamais sur une voiture
      const spot = this.freeSpot(taxi, side, 55, v);
      if (!spot) return;
      [v.x, v.z] = spot; v.targetX = v.x;
      v.speed = Math.max(v.speed, 12);
    }
    if (v.chase?.o) v.chase.o.flee = 0;
    v.chase = { o: null, t: 25 };
    return v;
  }

  /** La course : trois adversaires sur la grille de départ (voies de la chaussée de droite), derrière zStart. kind : 'taxi' ou 'moto'. */
  addRacers(kind, names, zStart, maxSpeed, makeMesh) {
    this.removeRacers();
    names.forEach((name, k) => {
      const mesh = makeMesh();
      mesh.rotation.order = 'YXZ';
      this.scene.add(mesh);
      const lane = LANE_X.length > 1 ? LANE_X[(k + 1) % LANE_X.length] : LANE_X[0], row = LANE_X.length > 1 ? Math.floor((k + 1) / LANE_X.length) : k + 1;
      const v = { mesh, side: 1, kind, len: mesh.userData.L, wid: mesh.userData.W, x: lane, targetX: lane, z: zStart + row * 8, speed: 0, stop: 0, stuck: 0, weave: 1,
        cruise: maxSpeed * (0.86 + 0.04 * k + Math.random() * 0.05), chase: null, flee: 0, urgent: 0, racer: { name, done: false, time: 0 } };
      this.list.push(v);
      put(v, 0);
    });
    this.raceFrozen = true;
  }
  removeRacers() {
    for (const v of this.list.filter(q => q.racer)) this.scene.remove(v.mesh);
    this.list = this.list.filter(q => !q.racer);
  }
  get racers() { return this.list.filter(q => q.racer); }
  /** Course aller-retour : l'adversaire a fait demi-tour ; il roule vers +z sur la chaussée de gauche, double ceux qui le gênent. */
  raceBack(v, dt, taxi) {
    const ahead = x => {
      let g = Infinity, l = 0;
      for (const o of this.list) {
        if (o === v || o.side !== -1 || o.z <= v.z || Math.abs(o.x - x) > (o.wid + v.wid) / 2 + 0.2) continue;
        const d = o.z - v.z - (o.len + v.len) / 2;
        if (d < g) { g = d; l = o.speed; }
      }
      if (taxi.z > v.z && sameLevel(taxi, v) && Math.abs(taxi.x - x) < (tw(taxi) + v.wid) / 2 + 0.2) { const d = taxi.z - v.z - (tl(taxi) + v.len) / 2; if (d < g) { g = d; l = Math.max(0, -Math.cos(taxi.heading ?? 0) * taxi.speed); } }
      return [g, l];
    };
    const [gap, lead] = ahead(v.x);
    if (gap < 25 && lead < v.cruise - 2 && (v.weave -= dt) < 0) {                // (dépassement par une autre voie libre)
      v.weave = 0.8;
      for (const lx of LANE_X) { const x = -lx; if (Math.abs(x - v.targetX) > 0.5 && ahead(x)[0] > gap + 8 && this.laneSafe(x, v, taxi)) { v.targetX = x; break; } }
    }
    let target = v.cruise;
    if (gap < 16) target = Math.min(target, Math.max(0, lead + (gap - 5) * 0.6));
    v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), (target > v.speed ? (v.kind === 'moto' ? 5 : 3.5) : 9) * dt);
    v.z += v.speed * dt;
    put(v, steerX(v, dt, Math.PI, v.kind === 'moto' ? 3.2 : 2.2));
  }

  /** Accident : une ambulance arrive derrière le taxi, sirène allumée, et le dépasse. */
  sendAmbulance(taxi) {
    const side = Math.cos(taxi.heading ?? 0) >= 0 ? 1 : -1, v = this.list.find(q => q.kind === 'amb' && q.side === side);
    if (!v) return null;
    const spot = this.freeSpot(taxi, side, 70, v);                     // (l'auteur, 13/11 : jamais sur une voiture)
    if (!spot) return null;
    [v.x, v.z] = spot; v.targetX = v.x; v.speed = 12; v.urgent = 40;
    return v;
  }

  /** La voiture de police qui poursuit le taxi, et sa distance derrière lui (m), ou null. */
  taxiChaser(taxi) {
    const v = this.list.find(q => q.kind === 'police' && q.chase && !q.chase.o);
    return v ? { v, behind: v.side > 0 ? v.z - taxi.z : taxi.z - v.z } : null;
  }
  /** Fin de la poursuite du taxi (contrôle fait, ou il s'est échappé). */
  endTaxiChase() { for (const v of this.list) if (v.chase && !v.chase.o) v.chase = null; }

  /** Les poursuites : de temps en temps, une voiture de police prend en chasse un véhicule en infraction devant elle, qui accélère pour lui échapper. */
  updateChases(dt, taxi) {
    for (const v of this.list) {
      if (v.flee > 0) v.flee -= dt;
      if (v.urgent > 0) v.urgent -= dt;
      if (v.kind !== 'police' || v.keep) continue;
      if (v.chase) {
        const o = v.chase.o, ahead = o ? (v.side > 0 ? v.z - o.z : o.z - v.z) : (v.side > 0 ? v.z - taxi.z : taxi.z - v.z);
        if ((v.chase.t -= dt) <= 0 || ahead < -5 || ahead > 220 || (o && !(o.flee > 0))) { if (o) o.flee = 0; v.chase = null; }
        continue;
      }
      if ((v.nextChase = (v.nextChase ?? 15 + Math.random() * 30) - dt) > 0) continue;
      v.nextChase = 30 + Math.random() * 40;
      if (Math.abs(v.z - taxi.z) > 220) continue;                             // (loin du taxi : personne ne la verrait)
      let o = null, best = 140;
      for (const q of this.list) {
        const a = v.side > 0 ? v.z - q.z : q.z - v.z;
        if (q.side !== v.side || q.racer || (q.kind !== 'car' && q.kind !== 'taxi' && q.kind !== 'moto') || a < 15 || a >= best || (v.side < 0 && Math.abs(q.x - v.x) > 1)) continue;
        best = a; o = q;
      }
      if (o) { const T = 14 + Math.random() * 8; o.flee = T; v.chase = { o, t: T }; }
    }
  }

  /** Vitesse voulue pendant une poursuite (celui qui fuit, la police qui le suit) ; sinon `base`. */
  chaseTarget(v, base, taxi) {
    if (v.flee > 0) return v.cruise + 5;
    if (v.urgent > 0) return v.cruise + 4;                                   // (l'ambulance en urgence roule plus vite)
    if (!v.chase) return base;
    const o = v.chase.o, ahead = o ? (v.side > 0 ? v.z - o.z : o.z - v.z) : (v.side > 0 ? v.z - taxi.z : taxi.z - v.z);
    const lead = o ? o.speed : Math.max(0, v.side * Math.cos(taxi.heading ?? 0) * taxi.speed);
    if (v.side > 0 && ahead < 70) {                                           // elle se met dans sa voie
      const x = o ? o.targetX : LANE_X[laneOf(taxi.x)];
      if (Math.abs(x - v.targetX) > 0.5 && this.laneSafe(x, v, taxi)) v.targetX = x;
    }
    return ahead > 16 ? Math.min(27, lead + 6) : o ? lead : Math.min(27, lead + 3);   // (le taxi poursuivi : elle vient se coller derrière lui)
  }

  /** Fait avancer la circulation (t : temps du jeu, pour les feux). Renvoie le véhicule percuté par le taxi, s'il y en a un. */
  update(dt, taxi, t = 0) {
    const st = SIGNALS.length ? signalState(t) : null;
    let hit = st ? this.updateCrossing(dt, st, taxi) : null;
    this.updateChases(dt, taxi);
    // Le taxi revient vers l'aéroport (+z) : on renouvelle les voitures devant lui dans ce sens (sans dépasser le début de la route)
    const back = Math.cos(taxi.heading ?? 0) < -0.35, zMax = Math.min(140, TRAFFIC_START - 30);
    const peds = this.extraPeds?.length ? (this.peds ?? []).concat(this.extraPeds) : (this.peds ?? []);   // (incidents.js : les gens sur la chaussée)
    if (this.jamTodo.length && !this.jamActive) this.stepJamBuild(2);
    if (this.jamActive !== undefined && !taxi.fixed) {
      const J = JAMS.find(j => j.on && j.lvl > 1 && taxi.z < j.z0 + 700 && taxi.z > j.z1 - 700);
      if (J && !this.jamActive) this.startJam(taxi); else if (!J && this.jamActive) this.stopJam();
    }
    for (const v of this.list) {
      if (v.jam && !this.jamActive) continue;
      if (v.held) { put(v, v.heldYaw ?? (v.side > 0 ? 0 : Math.PI)); continue; }   // (incidents.js : voiture arrêtée dans une scène)
      if (v.side === -1) {
        if (v.racer?.done) { v.mesh.visible = false; continue; }
        if (v.racer) { this.raceBack(v, dt, taxi); continue; }        // (course aller-retour : l'adversaire revient vers le départ)
        if (!back && (v.z > taxi.z + 70 || v.z > TRAFFIC_START)) this.place(v, taxi.z - AHEAD - 40, 120, taxi);
        else if (back && v.z > TRAFFIC_START) this.place(v, taxi.z - BEHIND, 100, taxi);
        else if (back && (v.z > taxi.z + AHEAD + 160 || v.z < taxi.z - BEHIND)) this.place(v, Math.min(zMax, taxi.z + AHEAD + 100), 100, taxi);
        // en sens inverse : vitesse constante, sauf à l'approche d'un feu (arrêt au rouge, file d'attente)
        let target = Math.min(this.chaseTarget(v, v.cruise, taxi), v.chase || v.urgent ? Infinity : jamSpeed(v.z, t));
        let lo = null, lg = Infinity;
        for (const o of this.list) {                 // (l'auteur, 13/11 : « les véhicules entre eux se passent transparents ») : on suit toujours celui de devant, dans sa voie
          if (o === v || o.side !== -1 || o.z <= v.z || Math.abs(o.x - v.x) > (o.wid + v.wid) / 2 + 0.2) continue;
          const g = o.z - v.z - (o.len + v.len) / 2;
          if (g < lg) { lg = g; lo = o; }
          if (g < 18) target = Math.min(target, Math.max(0, o.speed + (g - (this.inJamNow(v.z) ? 1.9 : 4)) * 0.6));
        }
        const taxiAhead = taxi.z > v.z && sameLevel(taxi, v) && Math.abs(taxi.x - v.x) < (tw(taxi) + v.wid) / 2 + 0.1;
        for (const q of peds) {                                             // piéton devant elle (elle roule vers +z)
          if (!q.active || q.fallen || Math.abs(q.x - v.x) > 1.6 || q.z <= v.z) continue;
          const g = q.z - v.z - v.len / 2 - 1.5;
          if (g < 18) target = Math.min(target, Math.max(0, (g - 3) * 0.6));
        }
        if (st && SIGNALS.some(sg => sg.stopL - v.z > -5 && sg.stopL - v.z < 120)) {
          target = Math.min(target, this.signalLimit(v, st, -1));
          for (const o of this.list) {
            if (o === v || o.side !== -1 || o.z <= v.z || Math.abs(o.x - v.x) > 1.5) continue;
            const g = o.z - v.z - (o.len + v.len) / 2;
            if (g < 16) target = Math.min(target, Math.max(0, (g - 4) * 0.6));
          }
        }
        if (st) {                                                            // voiture sortie d'une rue devant elle
          const cg = this.crossGap(v, -1);
          if (cg.gap < 16) target = Math.min(target, Math.max(0, cg.lead + (cg.gap - 4) * 0.6));
        }
        if (v.stop > 0 && !v.flee) { v.stop -= dt; target = 0; }            // (la jeep de police de l'autre chaussée s'arrête à la scène)
        target = Math.min(target, this.worksLimit(v, taxi, dt));            // (chantier : se rabattre)
        for (const bk of this.blocks) if (bk.side === -1 && this.blockHits(bk, v)) { const g = bk.z - v.z - v.len / 2; if (g > -8 && g < 90) target = Math.min(target, Math.sqrt(2 * 6 * Math.max(0, g - 3))); }   // (freinage selon la distance d'arrêt)
        if (taxi.z > v.z && sameLevel(taxi, v) && Math.abs(taxi.x - v.x) < (tw(taxi) + v.wid) / 2 + 0.2) {   // le taxi devant elle, dans sa voie
          const g = taxi.z - v.z - (tl(taxi) + v.len) / 2;
          if (g < 18) target = Math.min(target, Math.max(0, -Math.cos(taxi.heading ?? 0) * taxi.speed + (g - 5) * 0.6));
        }
        v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), (target > v.speed ? 3 : 9) * dt);
        v.z += v.speed * dt;
        const yawL = steerX(v, dt, Math.PI);   // (en sens inverse aussi, on change de voie : chantier)
        // (l'auteur, 13/11 : « rien ne doit passer transparent ») : jamais dans le véhicule de devant, ni dans le taxi
        if (lo) { const m = lo.z - (lo.len + v.len) / 2 - 0.4; if (v.z > m) { v.z = m; v.speed = Math.min(v.speed, lo.speed); } }
        if (taxiAhead) { const m = taxi.z - (tl(taxi) + v.len) / 2 - 0.4; if (v.z > m) { v.z = m; v.speed = Math.min(v.speed, Math.max(0, -Math.cos(taxi.heading ?? 0) * taxi.speed)); } }
        put(v, yawL);
        // (l'auteur, 08/11 : « les véhicules de sens contraire me passent transparents ») : le taxi les touche aussi (avenues sans séparateur)
        if (sameLevel(taxi, v) && Math.abs(taxi.x - v.x) < (tw(taxi) + v.wid) / 2 && Math.abs(taxi.z - v.z) < (tl(taxi) + v.len) / 2) hit = v;
        continue;
      }

      if (v.racer?.done) { v.mesh.visible = false; continue; }          // (adversaire arrivé)
      if (v.racer) { /* les adversaires de la course ne sont jamais renouvelés */ }
      else if (v.keep) { /* (incidents.js : la voiture de police de la scène) */ }
      else if (!back && (v.z > taxi.z + BEHIND || v.z < taxi.z - AHEAD - 160)) this.place(v, taxi.z - AHEAD, 100, taxi);
      else if (back && v.z < taxi.z - 70) this.place(v, Math.min(zMax, taxi.z + AHEAD + 160), 120, taxi);

      // Les taxis-bus s'arrêtent n'importe où sur la voie de droite pour charger
      let target = v.racer ? (this.raceFrozen ? 0 : v.cruise) : Math.min(this.chaseTarget(v, v.cruise, taxi), v.chase || v.urgent ? Infinity : jamSpeed(v.z, t));
      if (v.stop > 0 && !v.flee) { v.stop -= dt; target = 0; }
      else if ((v.kind === 'bus' || v.kind === 'van') && laneOf(v.targetX) === RIGHT && Math.random() < dt * 0.05) v.stop = 3 + Math.random() * 3;

      // Distance au véhicule de devant (y compris le taxi du joueur)
      let gap = Infinity, lead = 0, lo = null;
      for (const o of this.list) {
        if (o === v || o.side !== 1 || o.z >= v.z) continue;
        if (Math.abs(o.x - v.x) < (o.wid + v.wid) / 2 + 0.2) {
          const g = v.z - o.z - (o.len + v.len) / 2;
          if (g < gap) { gap = g; lead = o.speed; lo = o; }
        }
      }
      const taxiAhead = taxi.z < v.z && sameLevel(taxi, v) && Math.abs(taxi.x - v.x) < (tw(taxi) + v.wid) / 2 + 0.1;
      if (taxi.z < v.z && sameLevel(taxi, v) && Math.abs(taxi.x - v.x) < (tw(taxi) + v.wid) / 2 + 0.2) {
        const g = v.z - taxi.z - (tl(taxi) + v.len) / 2;
        if (g < gap) { gap = g; lead = Math.max(0, Math.cos(taxi.heading ?? 0) * taxi.speed); }   // vitesse du taxi vers -z
      }
      if (st) {                                                              // voiture sortie d'une rue, dans sa voie
        const cg = this.crossGap(v, 1);
        if (cg.gap < gap) { gap = cg.gap; lead = cg.lead; }
      }
      for (const q of peds) {                                               // piéton qui traverse devant, dans sa voie
        if (!q.active || q.fallen || Math.abs(q.x - v.x) > 1.6 || q.z >= v.z) continue;
        const g = v.z - q.z - v.len / 2 - 1.5;
        if (g < gap) { gap = g; lead = 0; }
      }
      const safe = v.kind === 'moto' ? 3 : this.inJamNow(v.z) ? 1.9 : 6;
      if (gap < safe + 10) target = Math.min(target, Math.max(0, lead + (gap - safe) * 0.6));
      for (const bk of this.blocks) if (bk.side === 1 && this.blockHits(bk, v)) {
        const g0 = v.z - v.len / 2 - bk.z;
        if (bk.x0 !== undefined && g0 > 0 && g0 < 70 && (v.blkT = (v.blkT ?? Math.random() * 0.5) - dt) <= 0) { v.blkT = 0.5; this.tryLaneChange(v, taxi); }   // (l'auteur, 26/11 : seules les voies concernées sont bloquées : on se range dans une voie libre)
      }
      for (const bk of this.blocks) if (bk.side === 1 && this.blockHits(bk, v)) { const g = v.z - v.len / 2 - bk.z; if (g > -8 && g < 90) target = Math.min(target, Math.sqrt(2 * 6 * Math.max(0, g - 3))); }   // (incidents.js : route bloquée ; freinage selon la distance d'arrêt, même pour la police)
      target = Math.min(target, this.signalLimit(v, st, 1));                // feu rouge devant : arrêt à la ligne
      target = Math.min(target, this.worksLimit(v, taxi, dt));               // (chantier : se rabattre)

      // (l'auteur, 13/11 : « la police passe les autres ») : une sirène arrive derrière, dans sa voie : on se range pour la laisser passer
      if (!v.chase && !(v.urgent > 0) && !v.racer && v.stop <= 0 && (v.yieldT = (v.yieldT ?? Math.random()) - dt) <= 0) {
        v.yieldT = 0.4;
        if (this.list.some(o => o !== v && o.side === 1 && (o.chase || o.urgent > 0) && o.z > v.z && o.z - v.z < 50 && Math.abs(o.x - v.x) < 1.6)) {
          v.yieldT = 1.5;
          if (!this.tryLaneChange(v, taxi, 1)) this.tryLaneChange(v, taxi, -1);
        }
      }
      // Les adversaires de la course doublent ceux qui les ralentissent
      if (v.racer && !this.raceFrozen && gap < 28 && lead < v.cruise - 2 && (v.weave -= dt) < 0) { v.weave = 0.8; this.tryLaneChange(v, taxi); }
      // Les motos se faufilent : changement de voie fréquent
      if (v.kind === 'moto' && (v.weave -= dt) < 0) {
        v.weave = 1.5 + Math.random() * 3;
        if (gap < 25 || Math.random() < 0.3) this.tryLaneChange(v, taxi);
      }

      // Bloqué derrière quelqu'un : tentative de dépassement
      if (v.speed < 1 && gap < 10 && v.stop <= 0) {
        v.stuck += dt;
        if (v.stuck > 1.5) { this.tryLaneChange(v, taxi); v.stuck = 0; }
      } else v.stuck = 0;

      const acc = target > v.speed ? (v.kind === 'moto' ? 5 : 3.5) : 9;
      v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), acc * dt);
      v.z -= v.speed * dt;
      // (l'auteur, 13/11 : « rien ne doit passer transparent ») : jamais dans le véhicule de devant, ni dans le taxi
      if (lo) { const m = lo.z + (lo.len + v.len) / 2 + 0.4; if (v.z < m) { v.z = m; v.speed = Math.min(v.speed, lo.speed); } }
      if (taxiAhead) { const m = taxi.z + (tl(taxi) + v.len) / 2 + 0.4; if (v.z < m) { v.z = m; v.speed = Math.min(v.speed, Math.max(0, Math.cos(taxi.heading ?? 0) * taxi.speed)); } }
      put(v, steerX(v, dt, 0, v.kind === 'moto' ? 3.2 : 2.2));

      if (sameLevel(taxi, v) && Math.abs(taxi.x - v.x) < (tw(taxi) + v.wid) / 2 && Math.abs(taxi.z - v.z) < (tl(taxi) + v.len) / 2) hit = v;
    }
    return hit;
  }

  /** Coup de klaxon : le véhicule juste devant se range peut-être. */
  honk(taxi) {
    let best = null, bestGap = 32;
    for (const v of this.list) {
      if (v.side !== 1 || v.z >= taxi.z || Math.abs(v.x - taxi.x) > LANE_W * 0.65) continue;
      const g = taxi.z - v.z - (v.len + tl(taxi)) / 2;
      if (g < bestGap) { bestGap = g; best = v; }
    }
    if (!best || best.targetX !== best.x || best.held) return null;
    if (best.kind === 'bus' && Math.random() < 0.5) return 'Le taxi-bus fait semblant de ne pas entendre…';
    if (best.kind === 'truck' && Math.random() < 0.6) return 'Le camion est trop chargé pour bouger…';
    best.stop = 0;
    // On se range de préférence à droite, sinon à gauche
    if (this.tryLaneChange(best, taxi, 1) || this.tryLaneChange(best, taxi, -1)) return null;
    return 'Pas de place pour se ranger !';
  }
}
