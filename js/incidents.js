// Les incidents de la route (l'auteur, 10/11, Modifier.docx point 6, 10 et 11) :
//  - 'accident' : deux voitures de la circulation se cognent devant le joueur, les deux chauffeurs descendent et se battent sur la chaussée,
//    les badauds accourent, tout bloque derrière ; la police arrive, les sépare, et la route se libère ;
//  - 'kuluna' : des jeunes se bagarrent sur le boulevard et bloquent la route (Masina Quartier 3, Kingasani ya Suka) ; les jeeps de la
//    police arrivent ; les policiers les arrêtent un par un et les font monter à l'arrière des jeeps (l'auteur, 14/11), puis la route se libère ;
//  - 'dispute' : quand le joueur cogne un véhicule, son chauffeur peut lui barrer la route, descendre et venir se battre : payer la tôlerie,
//    ou refuser (bagarre) ; s'il est têtu, la police vient, l'arrête et le met dans la jeep, un policier emmène sa voiture (l'auteur, 14/11) ;
//  - 'vol' : sur la moto, à Pascal et à Victoire, des voleurs courent vers le wewa arrêté ou au ralenti : accélérer, ou perdre la recette.
// Tout se joue sur la route où roule le véhicule (coordonnées route) ; les gens sur la chaussée sont solides (blockVehicle).
import { Character, outfit, bakeCharacter } from './characters.js';
import { createPolicePickup, Builder, VC_MAT } from './models.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const HELD_KINDS = new Set(['car', 'taxi', 'bus', 'van']);

/**
 * ctx : { group(), W(), traffic(), place(obj, x, z, yaw, y), say(t, who, d), toast(t, d), sound, infraction(what, fine), hold(on),
 *        choice(text, yes, no, cb), time(), night(), veh(), onLoss(fc), cash(), isMain() }
 */
export class Incidents {
  constructor(ctx) {
    this.c = ctx;
    this.cur = null;                               // la scène en cours
    this.next = 75 + Math.random() * 60;           // (secondes avant le prochain accident ou blocage)
    this.disputeCd = 0; this.theftCd = 60; this.theftT = 0; this.inZoneT = 0;
  }
  get active() { return !!this.cur; }
  /** La sirène de la police de la scène ({ kind, near }) ou null (main.js la joue). */
  get siren() { return this.cur?.siren ?? null; }

  // ---------- outils ----------
  actor(o, x, z, yaw = 0) {
    const ch = new Character(o);
    this.c.group().add(ch.mesh);
    const a = { ch, x, z, yaw, path: null, spd: 1.5, mode: 'idle' };
    this.c.place(ch.mesh, x, z, yaw, 0);
    this.cur.actors.push(a);
    return a;
  }
  prop(m, x, z, yaw) { this.c.group().add(m); this.c.place(m, x, z, yaw, 0); this.cur.props.push(m); return m; }
  /** Une personne : elle marche de path[0] à path[1] entre t0 et t1 (puis reste), sinon sa pose (mode). */
  move(a, t, time) {
    if (a.path && t > a.path[2] && t < a.path[3]) {
      // (l'auteur, 13/11 : « rien ne doit passer transparent ») : un véhicule sur son chemin : il attend qu'il passe
      const [from, to, t0, t1] = a.path, k = clamp((t + 0.15 - t0) / (t1 - t0), 0, 1), [nx, nz] = lerp2(from, to, k);
      if (this.vehicleAt(nx, nz, 0.25, a.ignore)) { a.path = [from, to, t0 + 0.05, t1 + 0.05]; a.waitT = (a.waitT ?? 0) + 0.05; }
    }
    if (a.path) {
      const [from, to, t0, t1] = a.path, k = clamp((t - t0) / (t1 - t0), 0, 1);
      [a.x, a.z] = lerp2(from, to, k);
      if (k > 0 && k < 1) { a.yaw = Math.atan2(-(to[0] - from[0]), (to[1] - from[1])) + Math.PI; a.ch.pose('walk', time, a.spd); }
      else a.ch.pose(a.mode, time + (a.phase ?? 0));
      if (k >= 1 && a.then) { const f = a.then; a.then = null; a.path = null; f(); }
    } else a.ch.pose(a.mode, time + (a.phase ?? 0));
    this.c.place(a.ch.mesh, a.x, a.z, a.yaw, this.c.W().pedHeight?.(a.x, a.z) ?? 0);   // (sur le terre-plein, il est dessus)
  }
  face(a, b) { a.yaw = Math.atan2(-(b.x - a.x), (b.z - a.z)) + Math.PI; }
  /** Un véhicule (circulation de la route, ou celui du joueur) occupe-t-il le point (x, z), à m mètres près ? */
  vehicleAt(x, z, m, ignore = null) {
    const T = this.c.traffic(), taxi = this.c.taxi;
    for (const v of T.list) {
      if (!v.mesh.visible || v === ignore) continue;                    // (ignore : sa propre voiture, où il remonte)
      // (on regarde avant de traverser : une voiture qui arrive compte aussi sur la distance qu'elle fait en 1,2 s)
      const run = (v.speed ?? 0) * 1.2, z0 = v.z - v.len / 2 - m - (v.side > 0 ? run : 0), z1 = v.z + v.len / 2 + m + (v.side < 0 ? run : 0);
      if (Math.abs(v.x - x) < v.wid / 2 + m && z > z0 && z < z1) return true;
    }
    return Math.abs(taxi.x - x) < (taxi.bw ?? 1.8) / 2 + m && Math.abs(taxi.z - z) < (taxi.bl ?? 4.4) / 2 + m;
  }
  /** Un chemin en plusieurs morceaux (points [x, z]) à la vitesse spd, à partir du temps t0 ; done à l'arrivée. */
  route(a, pts, t0, spd, done) {
    const go = (i, ts) => {
      if (i >= pts.length - 1) { done?.(); return; }
      const p = pts[i], q = pts[i + 1], dur = Math.max(0.2, Math.hypot(q[0] - p[0], q[1] - p[1]) / spd);
      a.path = [p, q, ts, ts + dur]; a.spd = spd;
      a.then = () => go(i + 1, ts + dur);
    };
    a.ch.mesh.visible = true;
    go(0, t0);
  }
  /** La police (l'auteur, 13/11 : « la police doit arriver par derrière ; s'il ne trouve pas le chemin, les policiers descendent et vont là où il
   *  y a l'incident » ; « les jeeps de policiers viennent ») : n jeeps (pick-ups de la circulation) qui viennent de derrière le taxi sur la voie de
   *  gauche, sirène allumée ; les voitures se rangent si elles peuvent, sinon elles restent dans la file (jamais à travers). crews[k] : les policiers
   *  de la jeep k. */
  callPolice(S, crews) {
    const T = this.c.traffic(), taxi = this.c.taxi, X = this.c.W().LANE_X;
    S.units = crews.map((officers, k) => {
      const v = T.jeep(k, taxi);
      this.clearCargo(v);                                                  // (ceux qu'elle avait emmenés la dernière fois sont descendus)
      // (toujours de derrière la scène : derrière le taxi s'il attend dans la file, sinon derrière la scène elle-même)
      const z0 = Math.max(taxi.z + 40, S.zI + 45);
      let z = null;
      for (let d = k * 14; d <= 80 && z === null; d += 5) if (T.laneFree(X[0], z0 + d, v, taxi, 9, 1)) z = z0 + d;
      v.x = v.targetX = X[0]; v.z = z ?? z0 + 82 + k * 12;
      T.unstack(v, taxi);
      Object.assign(v, { speed: 10, keep: true, urgent: 999, chase: null, flee: 0, stop: 0 });
      v.mesh.visible = true;
      return { v, officers, still: 0, braking: false, out: 0, back: 0 };
    });
    S.pol = S.units[0].v;
  }
  /** Chaque image : les jeeps avancent ; chacune, arrêtée par la file ou arrivée près de la scène, fait descendre ses policiers (portière du côté du
   *  terre-plein), qui longent le terre-plein puis vont à leur place (ways(cx, ze)[i] : les points de leur chemin, i : numéro du policier dans la scène). */
  policeStep(S, t, dt, ways, said) {
    const taxi = this.c.taxi, cx = this.c.W().MEDIAN + 0.25;
    if (!S.units) return false;
    const moving = S.units.find(u => !u.out) ?? S.units[0];
    S.siren = !S.polBack && S.units.some(u => !u.out) ? { kind: 'police', near: clamp(1 - Math.hypot(moving.v.x - taxi.x, moving.v.z - taxi.z) / 150, 0, 1) } : null;
    let any = false;
    S.units.forEach((u, k) => {
      if (u.out) return;
      const v = u.v;
      u.still = v.speed < 0.4 ? u.still + dt : 0;
      if (v.z - S.zI < 18 + k * 9 && v.z - S.zI > -5 && !u.braking) { u.braking = true; v.stop = 1e6; }   // (près de la scène : elle freine et s'arrête)
      if (!((u.braking || u.still > 1.5) && v.speed < 0.3)) return;                // (on ne descend que d'une jeep arrêtée)
      u.out = t; any = true;
      v.stop = 1e6; v.urgent = 0;
      u.door = v.z;
      // (ze : devant la jeep arrêtée la plus avancée ; les policiers de la deuxième jeep passent à côté de la première)
      const front = Math.min(...S.units.map(q => q.v.z - q.v.len / 2));
      const ze = Math.min(S.zI + 7, front - 1.2);
      S.cx = cx; S.ze = Math.min(S.ze ?? Infinity, ze); S.door = S.door ?? u.door;
      u.officers.forEach((o, j) => {
        const i = S.officers.indexOf(o), z0 = u.door + (j - 0.5) * 0.9;
        o.x = cx; o.z = z0; o.unit = u;
        o.fwd = [[cx, z0], ...ways(cx, ze)[i]];                                    // (le retour par le même chemin)
        this.route(o, o.fwd, t + 0.4 + j * 0.3, 2.6, () => { o.arrived = true; });
      });
      if (Math.abs(u.door - S.zI) > 30) this.c.toast('La police est bloquée dans la file : les policiers descendent et y vont à pied.', 3.5);
    });
    if (any && said && !S.saidPol) { S.saidPol = true; this.c.say(said[0], 'police', 3.5); this.c.sound.voice(said[1], { pitch: 0.75, rate: 1.05 }); }
    S.polOut = S.polOut || (S.units.some(u => u.out) ? t : 0);
    return any;
  }
  /** Les policiers reviennent à leur jeep par le même chemin et y montent ; ceux qu'ils emmènent montent par l'arrière de la première jeep ; chaque
   *  jeep repart avec la circulation quand son équipe est à bord. */
  policeBack(S, t, people) {
    const cx = S.cx, zEnd = S.ze, u0 = S.units[0], rear = u0.door + u0.v.len / 2 + 0.6;
    const left = new Map(S.units.map(u => [u, 0]));
    for (const o of people) { const u = o.unit ?? u0; left.set(u, left.get(u) + 1); o.unit = u; }
    for (const u of S.units) if (!left.get(u)) { u.out = u.out || -1; u.back = t; Object.assign(u.v, { stop: 0, keep: false, urgent: 0 }); }   // (une jeep dont l'équipe n'est pas descendue repart)
    if (S.units.every(q => q.back)) S.polBack = t;
    people.forEach((o, i) => this.route(o, o.fwd ? [[o.x, o.z], ...o.fwd.slice(0, -1).reverse()] : [[o.x, o.z], [cx, zEnd - (i % 3) * 0.7], [cx, rear + 0.5 * (i % 2)]], t + i * 0.25, 2.4, () => {
      o.ch.mesh.visible = false;
      const u = o.unit;
      left.set(u, left.get(u) - 1);
      if (left.get(u) === 0) { u.back = t; Object.assign(u.v, { stop: 0, keep: false, urgent: 0 }); }
      if (S.units.every(q => q.back)) S.polBack = t;
    }));
  }
  // ---------- l'arrestation (l'auteur, 14/11 : « le policier vient arrêter les Kuluna et les met dans le véhicule de police ; même chose pour un
  // chauffeur têtu ») ----------
  /** Une personne arrêtée, assise à l'arrière de la jeep v (figée et accrochée au pick-up, elle part avec lui) : trois au milieu de la benne, entre
   *  les policiers, le quatrième sur le hayon, les jambes dehors, puis deux à l'avant de la benne. */
  seat(v, o, slot) {
    const spots = [[0, 0.62], [0, 1.24], [0, 1.86], [0, v.len / 2 - 0.22], [0.47, 0.62], [-0.47, 0.62]];
    const [x, z] = spots[Math.min(slot, spots.length - 1)], b = new Builder();
    bakeCharacter(b, { ...o, cuffed: true }, 'sit', x, z, 0, Math.random() * 10, true);
    const m = b.mesh(VC_MAT);
    m.position.y = slot === 3 ? 0.74 : 0.81;
    m.castShadow = false;
    v.mesh.add(m);
    (v.cargo ??= []).push(m);
  }
  clearCargo(v) { for (const m of v.cargo ?? []) { v.mesh.remove(m); m.geometry.dispose(); } v.cargo = []; }
  /** Le policier o emmène y, les mains dans le dos, jusqu'à la jeep u par les points pts puis par le bord du terre-plein (y devant, le policier juste
   *  derrière) ; y monte à l'arrière (boardStep), puis done(). */
  escort(S, o, y, u, pts, done, lead = false) {
    const t = S.t, cx = S.cx, v = u.v, slot = S.seats.get(u) ?? 0;
    S.seats.set(u, slot + 1);
    const board = [cx, v.z + v.len / 2 - 0.9];                            // (à côté de la benne, du côté du terre-plein)
    y.ch.outfit.cuffed = true; y.mode = 'idle'; y.ignore = null;
    const path = [[y.x, y.z], ...pts, [cx, pts.at(-1)?.[1] ?? y.z], board];
    this.route(y, path, t + (lead ? 0.6 : 0), 1.8, () => { y.mode = 'climb'; y.climbAt = S.t; y.climbJeep = u; y.climbSlot = slot; y.yaw = Math.PI / 2; });
    // (lead : le policier, déjà devant lui sur le chemin, ouvre la marche ; sinon il le suit, un peu derrière)
    if (lead) this.route(o, [[o.x, o.z], ...path.slice(2, -1), [cx, board[1] + 1.0]], t, 1.8, () => this.face(o, y));
    else this.route(o, [[o.x, o.z], ...path.slice(0, -1), [cx, board[1] - 1.0]], t + 0.5, 1.8, () => this.face(o, y));
    o.task = y; o.free = false;
    y.onBoard = () => { o.task = null; o.free = true; done?.(); };
  }
  /** Ceux qui ont fini de grimper sont assis dans la benne. */
  boardStep(S) {
    for (const a of S.actors) {
      if (!a.climbAt || a.aboard || S.t < a.climbAt + 0.8) continue;
      a.aboard = true; a.ch.mesh.visible = false;
      this.seat(a.climbJeep.v, a.ch.outfit, a.climbSlot);
      a.onBoard?.();
    }
  }
  /** Les policiers remontent dans leur jeep (par le bord du terre-plein jusqu'à leur portière) ; chaque jeep repart quand son équipe est à bord. */
  crewBack(S, people) {
    const cx = S.cx, left = new Map(S.units.map(u => [u, 0]));
    for (const o of people) { o.unit ??= S.units[0]; left.set(o.unit, left.get(o.unit) + 1); }
    const go = u => { u.back = S.t; Object.assign(u.v, { stop: 0, keep: false, urgent: 0 }); if (S.units.every(q => q.back)) S.polBack = S.t; };
    for (const u of S.units) if (!left.get(u) && !u.back) go(u);
    people.forEach((o, i) => this.route(o, [[o.x, o.z], [cx, o.z], [cx, o.unit.door + (i % 2) * 0.8]], S.t + i * 0.2, 2.6, () => {
      o.ch.mesh.visible = false;
      left.set(o.unit, left.get(o.unit) - 1);
      if (left.get(o.unit) === 0) go(o.unit);
    }));
  }
  holdCar(v, x, z, yaw) { v.held = true; v.heldYaw = yaw; v.x = v.targetX = x; v.z = z; v.speed = 0; v.stop = 0; v.chase = null; v.flee = 0; }
  releaseCar(v) { v.held = false; v.heldYaw = undefined; v.speed = Math.max(2, v.cruise * 0.6); v.stop = 0; }
  finish() {
    const S = this.cur;
    if (!S) return;
    const g = this.c.group(), T = this.c.traffic();
    for (const a of S.actors) { g.remove(a.ch.mesh); a.ch.mesh.traverse(o => { if (o.isSkinnedMesh) o.geometry.dispose(); }); }
    for (const m of S.props) g.remove(m);
    for (const v of S.cars ?? []) this.releaseCar(v);
    T.blocks = T.blocks.filter(b => b !== S.block);
    T.extraPeds = null;
    for (const u of S.units ?? []) Object.assign(u.v, { keep: false, stop: 0, urgent: 0 });
    if (S.held) this.c.hold(false);
    this.cur = null;
  }

  // ---------- chaque image ----------
  update(dt, taxi) {
    const S = this.cur;
    if (S) {
      S.t += dt;
      for (const a of S.actors) { a.active = a.ch.mesh.visible; a.fallen = false; }   // (traffic.js : les voitures freinent pour eux)
      this.c.traffic().extraPeds = S.actors;
      this[S.kind](S, dt, taxi);
      return;
    }
    this.disputeCd -= dt;
    this.theftCd -= dt;
    this.maybeTheft(dt, taxi);
    if ((this.next -= dt) > 0 || !this.c.isMain()) return;
    this.next = 150 + Math.random() * 120;
    // accident ou Kuluna devant le joueur, sur sa chaussée (la chaussée de droite, en roulant vers Limete)
    if (taxi.x <= 0 || Math.cos(taxi.heading) < 0.5 || Math.abs(taxi.speed) < 2) { this.next = 20; return; }
    const W = this.c.W(), zI = taxi.z - 150;
    if (W.inFlyover(zI, 60) || W.inRiver?.(zI, 40) || W.inRaised?.(zI, 40) || W.SIGNALS.some(s => Math.abs(s.z - zI) < 90) || (W.inHighway?.(zI))) { this.next = 25; return; }
    const kul = (W.KULUNA_ZONES ?? []).some(q => zI < q.z0 && zI > q.z1);
    if (kul && Math.random() < 0.7) this.startKuluna(zI); else this.startAccident(zI);
  }

  /** Les gens d'une scène sont solides : le véhicule du joueur s'arrête contre eux (sans les renverser). */
  blockVehicle(taxi) {
    const S = this.cur;
    if (!S) return;
    const solids = S.actors.filter(a => a.ch.mesh.visible).map(a => ({ x: a.x, z: a.z, w: 0, l: 0 }));
    if (S.pc?.visible && S.pcX !== undefined) solids.push({ x: S.pcX, z: S.pcZ, w: S.pc.userData.W ?? 2, l: S.pc.userData.L ?? 5.2 });
    for (const a of solids) {
      const dx = taxi.x - a.x, dz = taxi.z - a.z;
      if (Math.abs(dx) < taxi.bw / 2 + 0.5 + a.w / 2 && Math.abs(dz) < taxi.bl / 2 + 0.5 + a.l / 2) {
        taxi.speed *= 0.2;
        const pz = taxi.bl / 2 + 0.55 + a.l / 2 - Math.abs(dz), px = taxi.bw / 2 + 0.55 + a.w / 2 - Math.abs(dx);
        if (pz < px) taxi.z += Math.sign(dz || 1) * pz; else taxi.x += Math.sign(dx || 1) * px;
        if (!S.warned) { S.warned = true; this.c.toast('Attention aux gens sur la route !', 2); }
      }
    }
  }

  // ---------- l'accident entre deux voitures ----------
  startAccident(zI) {
    const W = this.c.W(), T = this.c.traffic(), taxi = this.c.taxi;
    const far = v => v.side === 1 && HELD_KINDS.has(v.kind) && !v.racer && !v.chase && !v.held && !v.urgent && (Math.abs(v.z - taxi.z) > 260 || !v.mesh.visible);
    const cars = T.list.filter(far).slice(0, 2);
    if (cars.length < 2) { this.next = 30; return; }
    const [a, b] = cars, X = W.LANE_X;
    // (l'auteur, 13/11 : jamais sur une autre voiture) : l'endroit doit être libre dans les deux voies
    const zOk = [0, -15, -30, 15].map(d => zI + d).find(z => T.laneFree(X[1], z, a, null, 12, 1) && T.laneFree(X[2], z + 3.2, b, null, 12, 1));
    if (zOk === undefined) { this.next = 25; return; }
    zI = zOk;
    this.cur = { kind: 'accident', t: 0, zI, actors: [], props: [], cars, block: { z: zI + 9, side: 1 }, police: null };
    this.holdCar(a, X[1], zI, 0.1);
    this.holdCar(b, X[2], zI + 3.2, -0.3);
    T.blocks.push(this.cur.block);
    const S = this.cur;
    S.d1 = this.actor(outfit('man', { shirt: 0xf2f2f2 }), X[1] + a.wid / 2 + 0.25, zI + 0.5); S.d1.ch.mesh.visible = false; S.d1.ignore = a;   // (portière du côté de l'autre voiture)
    S.d2 = this.actor(outfit('man', { shirt: 0x1d4fa0 }), X[2] - b.wid / 2 - 0.25, zI + 3.5); S.d2.ch.mesh.visible = false; S.d2.ignore = b;
    S.door1 = [S.d1.x, S.d1.z]; S.door2 = [S.d2.x, S.d2.z];
    const mid = [(X[1] + X[2]) / 2, zI + 1.6];
    S.d1.path = [[S.d1.x, S.d1.z], [mid[0] - 0.55, mid[1]], 1.0, 2.6]; S.d1.mode = 'fight'; S.d1.phase = 0;
    S.d2.path = [[S.d2.x, S.d2.z], [mid[0] + 0.55, mid[1]], 1.2, 2.8]; S.d2.mode = 'fight'; S.d2.phase = 0.45;
    S.crowd = Array.from({ length: 5 }, (_, k) => {
      const c = this.actor(outfit(['man', 'woman', 'student', 'man', 'woman'][k]), W.ROAD_EDGE + 2.5 + Math.random() * 3, zI - 6 + k * 3.5);
      const ang = -0.9 + k * 0.45;
      c.path = [[c.x, c.z], [mid[0] + Math.cos(ang) * 3.4 + 2.2, mid[1] + Math.sin(ang) * 3.4], 2 + k * 0.4, 5.5 + k * 0.4];
      c.spd = 2; c.mode = 'idle';
      return c;
    });
    S.officers = [this.actor(outfit('police'), W.MEDIAN + 0.25, zI + 40), this.actor(outfit('police'), W.MEDIAN + 0.25, zI + 41)];
    for (const o of S.officers) o.ch.mesh.visible = false;
    for (const o of S.officers) o.ch.mesh.visible = false;
    this.c.toast('Accident devant : deux chauffeurs se battent, la route est bloquée !', 4.5);
    this.c.say('Eh ! Babeti bango ! Bakobunda ! — Ils se sont cognés ! Ils se battent !', 'client', 4);
    this.c.sound.crash(0.35);
  }
  accident(S, dt, taxi) {
    const t = S.t, time = this.c.time(), W = this.c.W(), X = W.LANE_X;
    if (t > 0.8 && !S.out) { S.out = true; S.d1.ch.mesh.visible = S.d2.ch.mesh.visible = true; }
    if (t > 12 && !S.units) this.callPolice(S, [S.officers]);              // (quelqu'un a appelé la police : une jeep, deux policiers)
    // les policiers vont se mettre de part et d'autre des deux chauffeurs
    const mx = (X[1] + X[2]) / 2, zI = S.zI;
    if (this.policeStep(S, t, dt, (cx, ze) => [[[cx, ze], [mx, zI + 3.4]], [[cx, ze], [cx, zI - 3.2], [mx, zI - 3.2], [mx, zI - 0.1]]], ['Police ! Botika ! — Police ! Arrêtez !', 'Botika ! Police !'])) { /* (ils descendent) */ }
    if (!S.calmT && S.officers.every(o => o.arrived)) { S.calmT = t; S.d1.mode = S.d2.mode = 'idle'; for (const c of S.crowd) c.mode = 'idle'; this.c.toast('La police sépare les deux chauffeurs.', 3); }
    if (S.calmT && t > S.calmT + 8 && !S.back) {
      S.back = true;
      S.d1.path = [[S.d1.x, S.d1.z], S.door1, t, t + 2]; S.d1.then = () => { S.d1.ch.mesh.visible = false; };
      S.d2.path = [[S.d2.x, S.d2.z], S.door2, t, t + 2]; S.d2.then = () => { S.d2.ch.mesh.visible = false; };
      S.crowd.forEach((c, i) => { c.path = [[c.x, c.z], [W.ROAD_EDGE + 2.5 + i, S.zI - 6 + i * 3.5], t + 1 + i * 0.3, t + 5 + i * 0.3]; });
      this.policeBack(S, t + 0.5, S.officers);
      this.c.toast('La police les a séparés : la route se libère.', 3.5);
    }
    if (S.back && t > S.calmT + 11 && S.cars) { for (const v of S.cars) this.releaseCar(v); S.cars = null; this.c.traffic().blocks = this.c.traffic().blocks.filter(b => b !== S.block); }
    if (!S.polOut && t > 110 && !S.back) S.calmT = t - 8;               // (sécurité : la police n'a pas pu venir)
    for (const a of S.actors) if (a.ch.mesh.visible) this.move(a, t, time);
    if ((S.polBack && t > S.polBack + 4 && !S.cars) || t > 160) this.finish();
  }

  // ---------- les Kuluna ----------
  startKuluna(zI) {
    const W = this.c.W(), T = this.c.traffic(), X = W.LANE_X;
    this.cur = { kind: 'kuluna', t: 0, zI, actors: [], props: [], cars: [], block: { z: zI + 10, side: 1 } };
    T.blocks.push(this.cur.block);
    const S = this.cur;
    S.youths = Array.from({ length: 8 }, (_, k) => {
      const side = k % 2 ? 1 : -1, from = [side > 0 ? W.ROAD_EDGE + 2.5 + Math.random() * 2 : W.MEDIAN + 0.4, zI - 8 + Math.random() * 16];
      const y = this.actor(outfit('man', { shirt: pick([0x1a1a1a, 0xd62828, 0xffffff, 0x7b2cbf, 0xe0a100]), cap: Math.random() < 0.5 ? 0x1a1a1a : null, idle: 1 }), from[0], from[1]);
      // (l'auteur, 10/11 : « ils bloquent la route ») : deux par voie, sur les quatre voies, face à face
      const to = [X[Math.floor(k / 2)] + (k % 2 ? 0.6 : -0.6), zI + (Math.floor(k / 2) % 2 ? 1.6 : -0.4)];
      y.spd = 3.2; y.path = [from, to, 0.2 + k * 0.15, 1.6 + k * 0.15]; y.mode = 'fight'; y.phase = k % 2 ? 0.45 : 0;
      return y;
    });
    S.officers = Array.from({ length: 4 }, (_, i) => { const o = this.actor(outfit('police'), W.MEDIAN + 0.25, zI + 40 + i); o.ch.mesh.visible = false; return o; });
    // (l'auteur, 10/11 : « ils bloquent la route pendant 2 à 3 minutes » : la police est appelée tard, elle arrive vers 2 min à 2 min 40)
    S.callAt = 95 + Math.random() * 40;
    this.c.toast('Kuluna ! Des jeunes se battent sur le boulevard : la route est bloquée.', 4.5);
    this.c.say('Kuluna ! Bakangi nzela ! — Les Kuluna bloquent la route !', 'client', 4);
  }
  kuluna(S, dt, taxi) {
    const t = S.t, time = this.c.time(), W = this.c.W(), X = W.LANE_X;
    if (t > S.callAt && !S.units) this.callPolice(S, [S.officers.slice(0, 2), S.officers.slice(2)]);   // (deux jeeps)
    if (t > 50 && !S.saidWait) { S.saidWait = true; this.c.say('Bakangi nzela naino… Police ezali wapi ? — Ils bloquent encore la route… Où est la police ?', 'client', 4); }
    const xs = [X[0] + 0.4, X[1] - 0.7, X[1] + 0.9, X[2] - 0.3];
    if (this.policeStep(S, t, dt, (cx, ze) => [0, 1, 2, 3].map(i => [[cx, ze - (i % 2) * 0.6], [xs[i], Math.min(S.zI + 4.5, ze - 1)]]), ['Police ! Bokima te ! — Police ! Ne bougez pas !', 'Police ! Telema !'])) { /* (ils descendent) */ }
    for (const o of S.officers) if (o.arrived && o.free === undefined) o.free = true;
    // (l'auteur, 14/11 : « le policier vient arrêter les Kuluna et les met dans le véhicule de police ») : dès que les policiers arrivent, les jeunes
    // cessent de se battre ; chaque policier en prend un, lui met les mains dans le dos, le conduit à sa jeep par le bord du terre-plein et le fait monter
    // à l'arrière ; il revient chercher le suivant par le terre-plein. Quand tous sont à bord, la route se libère et les jeeps repartent avec eux.
    if (!S.caught && S.polOut && S.officers.some(o => o.ch.mesh.visible && Math.abs(o.z - S.zI) < 9)) {
      S.caught = t;
      S.waiting = S.youths.filter(y => y.ch.mesh.visible);
      for (const y of S.waiting) { y.mode = 'idle'; y.path = null; y.then = null; }
      S.seats = new Map(S.units.map(u => [u, 0]));
      this.c.toast('La police arrête les Kuluna : ils montent un par un dans les jeeps.', 4);
      this.c.say('Bokanga maboko na sima ! — Les mains dans le dos !', 'police', 3);
    }
    if (S.caught && !S.allIn) {
      const cx = S.cx, mt = W.MEDIAN - 0.35, zLine = S.zI + 3.2, zA = S.zI + 5.6;   // (mt : sur le terre-plein ; zLine : on emmène ; zA : on va chercher)
      for (const o of S.officers) {
        if (!o.ch.mesh.visible || o.task || !o.free || !S.waiting.length) continue;
        S.waiting.sort((a, b) => Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(b.x - o.x, b.z - o.z));
        const y = S.waiting.shift();
        o.task = y; o.free = false;
        const near = [y.x + (y.x > cx + 1.5 ? -0.75 : 0.75), y.z + 0.5];
        const go = Math.abs(o.z - zA) > 3 ? [[o.x, o.z], [mt, o.z], [mt, zA], [near[0], zA], near] : [[o.x, o.z], [near[0], zA], near];
        this.route(o, go, t, 2.6, () => {
          const u = (S.seats.get(o.unit) ?? 0) < 4 ? o.unit : S.units.reduce((a, b) => ((S.seats.get(a) ?? 0) <= (S.seats.get(b) ?? 0) ? a : b));
          this.face(o, y);
          this.escort(S, o, y, u, [[y.x, zLine], [cx, zLine]]);
        });
      }
      this.boardStep(S);
      if (!S.waiting.length && S.youths.every(y => y.aboard)) {
        S.allIn = t;
        if (S.block) { this.c.traffic().blocks = this.c.traffic().blocks.filter(b => b !== S.block); S.block = null; }
        this.c.toast('Les Kuluna sont dans les jeeps : la route est libre.', 3);
        this.crewBack(S, S.officers.filter(o => o.ch.mesh.visible));
      }
    }
    // (sécurité : la police n'a pas pu venir) : les jeunes finissent par partir sur les trottoirs
    if (!S.polOut && t > S.callAt + 90 && !S.allIn) {
      S.allIn = t; S.polBack = t;
      S.youths.forEach((y, i) => { y.mode = 'idle'; this.route(y, [[y.x, y.z], [W.ROAD_EDGE + 7, y.z - 25 + Math.random() * 10]], t + i * 0.2, 2.2, () => { y.ch.mesh.visible = false; }); });
      if (S.block) { this.c.traffic().blocks = this.c.traffic().blocks.filter(b => b !== S.block); S.block = null; }
    }
    for (const a of S.actors) if (a.ch.mesh.visible) this.move(a, t, time);
    if ((S.polBack && t > S.polBack + 4 && !S.block) || t > 420) this.finish();
  }

  // ---------- le chauffeur cogné te barre la route ----------
  /** Appelé par main.js après un choc avec un véhicule de la circulation (hit : l'objet de traffic.js). */
  onCrash(hit, strength, force = false) {
    if (this.cur || this.disputeCd > 0 || strength < 4 || !hit || hit.side !== 1 || !HELD_KINDS.has(hit.kind) || hit.racer || hit.chase || (!force && Math.random() > 0.4)) return;
    const taxi = this.c.taxi, W = this.c.W();
    if (Math.cos(taxi.heading) < 0.5 || taxi.x <= 0 || taxi.level) return;
    this.disputeCd = 180;
    const zF = taxi.z - (taxi.bl / 2 + hit.len / 2 + 2.2);
    this.cur = { kind: 'dispute', t: 0, actors: [], props: [], cars: [hit], block: { z: zF + 6, side: 1 }, held: true };
    this.c.traffic().blocks.push(this.cur.block);
    const xF = clamp(taxi.x, W.LANE_X[0], W.LANE_X[W.LANE_X.length - 1]), T = this.c.traffic();
    this.holdCar(hit, T.laneFree(xF, zF, hit, null, 4, 1) ? xF : hit.x, T.laneFree(xF, zF, hit, null, 4, 1) ? zF : hit.z, 0);   // (l'auteur, 13/11 : jamais sur une autre voiture)
    this.c.hold(true);
    const S = this.cur, d = this.actor(outfit('man', { shirt: pick([0xf2f2f2, 0xd9480f, 0x2b8a3e]), idle: 1 }), hit.x - hit.wid / 2 - 0.5, zF);
    S.driver = d; d.ch.mesh.visible = false;
    d.spd = 2; d.path = [[d.x, d.z], [taxi.x - taxi.bw / 2 - 0.9, taxi.z - 0.2], 0.8, 2.6]; d.mode = 'fight';
    d.then = () => { this.face(d, { x: taxi.x, z: taxi.z }); };
    this.c.say('Obeti ngai ! Kita, futa tôlerie ! — Tu m\'as cogné ! Descends, paie la tôlerie !', 'client', 4.5);
    this.c.sound.voice('Obeti ngai ! Futa !', { pitch: 0.8, rate: 1.1 });
    this.c.toast('Le chauffeur te barre la route et vient se battre.', 3.5);
  }
  dispute(S, dt, taxi) {
    const t = S.t, time = this.c.time();
    if (t > 0.7 && !S.out) { S.out = true; S.driver.ch.mesh.visible = true; }
    if (t > 3 && !S.asked) {
      S.asked = true;
      this.c.choice('Le chauffeur réclame la tôlerie : 10 000 FC. Payer, ou refuser et se battre ?', 'Payer 10 000 FC', 'Refuser', yes => {
        if (yes) {
          this.c.onLoss(10000, 'tôlerie');
          this.c.say('Merci. Kende malamu. — Merci. Va bien.', 'client', 3);
          this.c.sound.cash?.();
          S.endAt = t + 1.5;
        } else {
          S.fight = true; S.driver.mode = 'fight';
          this.c.say('Okofuta te ? Tobunda ! — Tu ne paies pas ? On se bat !', 'client', 3.5);
          S.fightEnd = t + 6;
          S.stubborn = Math.random() < 0.55;                             // (il est têtu : la police viendra le chercher)
          // (l'auteur, 10/11 : « il descend pour la bagarre ») : ton chauffeur descend aussi, ils se battent face à face à côté du taxi
          const moto = this.c.veh() === 'moto', bw = taxi.bw ?? 1.8, bl = taxi.bl ?? 4.4, s = Math.cos(taxi.heading) >= 0 ? 1 : -1;
          const xF = taxi.x - s * (bw / 2 + 0.55), zMe = taxi.z - s * (bl / 2 - 1.4), zHim = zMe - s * 1.05;
          S.me = this.actor(outfit('man', { shirt: moto ? 0xd6dc24 : 0xf2f2f2 }), taxi.x - s * (bw / 2 + 0.35), taxi.z, 0);
          S.me.mode = 'fight'; S.me.phase = 0.45; S.me.ignore = null;
          S.me.path = [[S.me.x, S.me.z], [xF, zMe], t, t + 0.8];
          S.driver.path = [[S.driver.x, S.driver.z], [xF, zHim], t, t + 0.9];
          S.meSpot = [taxi.x - s * (bw / 2 + 0.35), taxi.z];
          if (moto) this.c.riders(false);
        }
      });
    }
    if (S.fight && t > S.fightEnd && !S.fightDone) {
      S.fightDone = true;
      if (S.stubborn) {
        // (l'auteur, 14/11 : « même chose quand il s'agit d'un chauffeur têtu ») : il ne veut rien entendre et continue ; un passant appelle la police,
        // la jeep vient par derrière ; un policier l'arrête et le met dans la jeep, l'autre monte dans sa voiture et l'emmène
        const W = this.c.W(), car = S.cars[0];
        this.c.say('Nakokende te ! Okofuta ! — Je ne bouge pas ! Tu vas payer !', 'client', 3.5);
        this.c.toast('Le chauffeur est têtu : quelqu’un appelle la police.', 3.5);
        S.zI = car.z;
        S.officers = [0, 1].map(i => { const o = this.actor(outfit('police'), W.MEDIAN + 0.25, taxi.z + 40 + i); o.ch.mesh.visible = false; return o; });
        this.callPolice(S, [S.officers]);
        S.waitPolice = true;
      } else {
        this.c.say('Okomona ! Nakozonga ! — Tu verras ! Je reviendrai !', 'client', 3.5);
        this.c.toast('Il renonce : tu as gagné la bagarre.', 3);
        S.endAt = t + 1.2;
      }
    }
    if (S.units) {
      const d = S.driver, car = S.cars[0] ?? S.car, [o0, o1] = S.officers;
      S.car ??= car;
      this.policeStep(S, t, dt, (cx) => {
        // (jamais à travers les voitures arrêtées à côté du taxi) : par le bord du terre-plein jusque devant sa voiture, où les voies sont libres, puis le
        // long du taxi jusqu'au chauffeur ; le deuxième policier va à la portière de la voiture
        S.xw = Math.min(taxi.x - (taxi.bw ?? 1.8) / 2, car.x - car.wid / 2) - 0.95; S.zc = car.z - car.len / 2 - 2.6;
        return [[[cx, S.zc], [S.xw, S.zc], [S.xw, d.z - 0.9]], [[cx, S.zc - 1.3], [S.xw, S.zc - 1.3], [car.x - car.wid / 2 - 0.3, car.z - 0.3]]];
      }, ['Police ! Botika ! — Police ! Arrêtez !', 'Botika ! Police !']);
      if (o0.arrived && !S.arrested) {
        S.arrested = true; S.waitPolice = false;
        this.c.say('Okokende na biso ! — Tu viens avec nous !', 'police', 3);
        this.c.toast('La police arrête le chauffeur têtu et le met dans la jeep.', 3.5);
        S.seats = new Map([[S.units[0], 0]]);
        this.escort(S, o0, d, S.units[0], [[S.xw, d.z], [S.xw, S.zc]], () => this.crewBack(S, [o0]), true);
      }
      if (o1.arrived && !S.carTaken) { S.carTaken = t; o1.ch.mesh.visible = false; }   // (il monte dans la voiture du chauffeur)
      if (S.carTaken && t > S.carTaken + 1.2 && S.cars.length) {
        this.releaseCar(S.cars[0]); S.cars = [];
        this.c.toast('Un policier emmène sa voiture.', 2.5);
      }
      this.boardStep(S);
      if (d.aboard && !S.released) {
        S.released = true;
        this.c.hold(false); S.held = false;
        if (S.block) { this.c.traffic().blocks = this.c.traffic().blocks.filter(b => b !== S.block); S.block = null; }
      }
      if (S.polBack && t > S.polBack + 3 && S.released) S.finishAt = t;
    }
    if (S.endAt && t > S.endAt && !S.leaving) {
      S.leaving = true;
      const d = S.driver, v = S.cars[0];
      d.mode = 'idle'; d.spd = 2; d.path = [[d.x, d.z], [v.x - v.wid / 2 - 0.5, v.z], t, t + 2]; d.then = () => { d.ch.mesh.visible = false; };
      this.c.hold(false); S.held = false;
      S.finishAt = t + 2.3;
    }
    if (S.fight && (!S.fightDone || S.waitPolice)) {                   // (le chauffeur têtu se bat jusqu'à l'arrivée de la police)
      S.driver.mode = 'fight';
      if (S.me && !S.driver.path && !S.me.path) { this.face(S.me, S.driver); this.face(S.driver, S.me); }   // (face à face)
    }
    if (S.fightDone && !S.waitPolice && S.me && !S.meBack) {          // ton chauffeur remonte
      S.meBack = true; S.me.mode = 'idle';
      S.me.path = [[S.me.x, S.me.z], S.meSpot, t, t + 0.8]; S.me.then = () => { S.me.ch.mesh.visible = false; if (this.c.veh() === 'moto') this.c.riders(true); };
    }
    for (const a of S.actors) if (a.ch.mesh.visible) this.move(a, t, time);
    if (S.finishAt && t > S.finishAt) this.finish();
    if (t > (S.units ? 220 : 40)) this.finish();                      // (sécurité)
  }

  // ---------- les voleurs à moto (Pascal, Victoire) ----------
  maybeTheft(dt, taxi) {
    if (this.c.veh() !== 'moto' || this.theftCd > 0) { this.inZoneT = 0; return; }
    const W = this.c.W(), zones = W.THEFT_ZONES ?? [];
    if (!zones.some(q => taxi.z < q.z0 && taxi.z > q.z1)) { this.inZoneT = 0; return; }
    const slow = Math.abs(taxi.speed) < (this.c.night() > 0.5 ? 4 : 1.5);
    this.inZoneT = slow ? this.inZoneT + dt : 0;
    if (this.inZoneT < 2.5 || Math.random() > dt * 0.35) return;
    this.theftCd = 240; this.inZoneT = 0;
    const side = taxi.x >= 0 ? 1 : -1, zI = taxi.z;
    this.cur = { kind: 'vol', t: 0, actors: [], props: [], cars: [], block: null, taken: false };
    const S = this.cur;
    S.thieves = [0, 1].map(i => {
      const th = this.actor(outfit('man', { shirt: pick([0x1a1a1a, 0xd62828, 0x23262b]), cap: 0x1a1a1a, idle: 1 }), side * (W.ROAD_EDGE + 3 + i * 1.5), zI + (i ? 5 : -4));
      th.spd = 4.5; th.path = [[th.x, th.z], [taxi.x + side * (i ? 1.1 : -1.1), taxi.z + (i ? 0.6 : -0.6)], 0.2, 2.4]; th.mode = 'fight';
      return th;
    });
    this.c.say('Eh ! Miyibi ! Bazali koya ! — Des voleurs ! Ils arrivent !', 'client', 3);
    this.c.toast('Des voleurs courent vers toi : accélère !', 2.5);
  }
  vol(S, dt, taxi) {
    const t = S.t, time = this.c.time();
    for (const th of S.thieves) { if (th.path && t > 0.2 && t < 2.4) { th.path[1] = [taxi.x + (th.path[1][0] > taxi.x ? 1.1 : -1.1), taxi.z + (th.path[1][1] > taxi.z ? 0.6 : -0.6)]; } }
    if (t > 2.4 && !S.decided) {
      S.decided = true;
      const near = S.thieves.some(th => Math.hypot(th.x - taxi.x, th.z - taxi.z) < 2.2) && Math.abs(taxi.speed) < 6;
      if (near) {
        S.taken = true;
        const loss = Math.min(this.c.cash(), 8000 + Math.round(Math.random() * 12) * 1000);
        this.c.onLoss(loss, 'vol');
        this.c.say('Pesa mbongo ! Pesa telefone ! — Donne l\'argent ! Donne le téléphone !', 'client', 3.5);
        this.c.sound.voice('Pesa mbongo !', { pitch: 0.8, rate: 1.2 });
        this.c.toast(loss > 0 ? `Volé ! Ils ont pris ${loss.toLocaleString('fr-FR')} FC de ta recette.` : 'Volé ! Mais ta caisse était vide.', 4);
        taxi.speed *= 0.3;
      } else this.c.toast('Trop rapide pour eux : ils t\'ont raté !', 3);
      for (const th of S.thieves) { th.mode = 'idle'; th.spd = 4.5; const side = th.x >= 0 ? 1 : -1; th.path = [[th.x, th.z], [side * (this.c.W().ROAD_EDGE + 8), th.z + 20], t + (S.taken ? 2 : 0.3), t + (S.taken ? 5.5 : 3.5)]; th.then = () => { th.ch.mesh.visible = false; }; }
    }
    for (const a of S.actors) if (a.ch.mesh.visible) this.move(a, t, time);
    if (t > 9) this.finish();
  }
}
