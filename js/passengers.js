// Taxi collectif (l'auteur, 07/11) : des groupes de clients attendent aux arrêts des deux chaussées (à droite, ils vont vers la fin du trajet ; à gauche,
// vers son début). Quand le véhicule s'arrête dans la zone jaune, ils montent un par un tant qu'il reste des places ; chacun descend à sa destination
// et paie le prix du transport (selon le véhicule), un peu plus si le voyage a été confortable. Le chargement (`board`) est partagé par toutes les routes :
// les clients restent à bord quand le véhicule passe d'une route à l'autre. Ceux qui vont au terminus de l'itinéraire paient en y arrivant.
import * as THREE from 'three';
import { Character, outfit } from './characters.js';
import { place, spreadAt, worldVec } from './route.js';
import { GOALS, BUS_STOPS, BUS_STOPS_L, STATIONS, GOALS_LEN, LANE_R, LANE_W, ROAD_EDGE, inRiver, inRaised, roadH, CROWDS, inCrowd, inFlyover } from './world.js';
import { CURRENT } from './routes.js';

// Ce que disent les clients : en lingala, puis en français (lignes écrites pour Taxi Kin)
const TYPES = [
  { label: 'Maman du marché', kind: 'woman', basin: true, board: d => `Mbote ! Na ${d}, malembe hein. — Bonjour ! À ${d}, doucement, j'ai des œufs.` },
  { label: "Homme d'affaires", kind: 'business', board: d => `${d}, mbangu ! — ${d}, vite, j'ai une réunion !` },
  { label: 'Étudiant', kind: 'student', board: d => `Mbote chauffeur ! Tokende ${d}. — Salut ! On va à ${d}.` },
  { label: 'Fonctionnaire', kind: 'man', longSleeves: true, board: d => `Na ${d}, soki olingi. — À ${d}, s'il vous plaît.` },
];
const TRAVELER = { label: "Voyageur de l'aéroport", kind: 'traveler', board: d => `Bonjour ! ${d}, s'il vous plaît. C'est ma première fois à Kin !` };
export const LINES = {
  thanks: ['Matondo mingi ! — Merci beaucoup !', 'Nakiti awa. Matondo ! — Je descends ici. Merci !', 'Okumba malamu, chauffeur ! — Tu conduis bien !'],
  angry: ['Malembe chauffeur ! — Doucement !', 'Bokeba ! — Attention !', 'Ah ! Tozali bato, tozali bibende te ! — On est des gens, pas de la ferraille !'],
  leave: ['Kitisa ngai awa ! Nakoki lisusu te. — Laisse-moi ici, j\'en ai assez !'],
  offer: x => `Nazali na ${x} kaka… — Je n'ai que ${x}…`,
  extra: 'Chauffeur, tika ngai na kati, nakokanga ! — Laisse-moi monter, je me serre !',
};

const ZONE_HALF = 7;
const DROP_HALF = 12;
const STOP_SPEED = 2.2;
const STEP = 0.7;                                // secondes entre deux clients qui montent ou descendent
const pick = a => a[Math.floor(Math.random() * a.length)];

function zoneMesh(color, len) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W - 0.4, len),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(LANE_R, 0.03, 0);
  return m;
}
/** Chargement par défaut (anciens tests sans itinéraire) : un seul client à la fois. */
export const newBoard = (cap = 1, fare = 1500, groupMax = 1) => ({ riders: [], cap, fare, groupMax, extra: 0, comfort: 100, refusedOffer: null });

export class Passengers {
  constructor(scene) {
    this.scene = scene;
    this.clients = [];                             // les arrêts (groupes qui attendent) : { z, side, waiting: [...], state }
    this.board = newBoard();
    this.prompt = '';
    this.hold = 0;
    this.offer = null;                             // proposition en attente (prix, client de plus) : main.js affiche le choix
    this.walkers = [];                             // (l'auteur, 08/11) les clients qu'on voit monter et descendre : { ch, pts, speed, done }
    this.taxi = null;
    this.markerGeo = new THREE.OctahedronGeometry(0.45);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xf5c400, fog: false });

    // Colonne verte : le prochain client à déposer sur cette route
    this.dest = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x3ccf6e, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    col.position.set(LANE_R, 20, 0);
    this.dest.add(col, zoneMesh(0x3ccf6e, DROP_HALF * 2));
    this.dest.visible = false;
    scene.add(this.dest);
  }

  /** Compatibilité : « un client à bord » (raccords de routes, anciens tests). */
  get ride() { return this.board.riders.length ? this.board.riders[0] : null; }
  set ride(v) { if (!v) this.board.riders.length = 0; }

  reset() {
    for (const w of this.walkers.splice(0)) w.done();
    for (const c of this.clients) this.scene.remove(c.root);
    this.clients = [];
    this.offer = null;
    this.dest.visible = false;
    const stops = BUS_STOPS.length >= 6 ? [-70, ...BUS_STOPS.filter(z => z < -140 && z > -GOALS_LEN + 120)] : null;
    if (stops) {
      stops.forEach((z, idx) => {
        if (!STATIONS.some(s => Math.abs(s.z - z) < 28) && !inRiver(z, 20) && !inRaised(z, 20)) this.clients.push(this.makeStop(z, 1, idx === 0 && CURRENT.start === 'airport'));
      });
      this.addLeftClients(BUS_STOPS_L);
      this.addCrowdClients();
      return;
    }
    let z = -70;
    while (z > -GOALS_LEN + 260) {
      if (!STATIONS.some(s => Math.abs(s.z - z) < 40) && !inRiver(z, 25) && !inRaised(z, 25)) this.clients.push(this.makeStop(z, 1));
      z -= 170 + Math.random() * 190;
    }
    const left = [];
    for (let zl = -160; zl > -GOALS_LEN + 120; zl -= 220 + Math.random() * 190) left.push(zl);
    this.addLeftClients(left);
  }

  /** Zones de foule : des clients un peu partout le long des deux trottoirs, en plus des arrêts. */
  addCrowdClients() {
    for (const C of CROWDS) for (const side of [1, -1]) for (let z = C.z0 - 30; z > C.z1 + 20; z -= 70 + Math.random() * 50) {
      if (this.clients.some(c => c.side === side && Math.abs(c.z - z) < 35) || inRiver(z, 15) || inRaised(z, 15) || inFlyover(z, 4) || STATIONS.some(s => Math.abs(s.z - z) < 28)) continue;
      this.clients.push(this.makeStop(z, side, false, true));
    }
  }

  /** Arrêts de la chaussée de gauche : on y va vers le début du trajet. */
  addLeftClients(zs) {
    for (const z of zs) {
      if (z <= -GOALS_LEN + 40 || inRiver(z, 20) || inRaised(z, 20)) continue;
      this.clients.push(this.makeStop(z, -1));
    }
  }

  /** Place un groupe au bord d'une chaussée (side) : ses x locaux comptent vers l'extérieur de cette chaussée. */
  placeSide(obj, z, side, y) {
    place(obj, side * spreadAt(z), z, side > 0 ? 0 : Math.PI, y, true);   // à l'Échangeur, les chaussées s'écartent de l'axe
  }

  /** Destination d'un client qui monte en z, côté side : un repère plus loin sur cette route, ou le terminus de l'itinéraire. */
  destFor(z, side) {
    const ahead = side > 0 ? GOALS.filter(l => l.z < z - 220) : GOALS.filter(l => l.z > z + 220).reverse();
    if (!ahead.length || Math.random() < 0.3) return { name: null, z: null };    // (au terminus)
    return ahead.length > 2 && Math.random() < 0.5 ? ahead[1 + Math.floor(Math.random() * Math.min(3, ahead.length - 1))] : ahead[0];
  }

  /** Un arrêt : un groupe de clients (1 à groupMax), trois personnages visibles au plus, et le losange jaune. */
  makeStop(z, side, traveler = false, crowd = inCrowd(z)) {
    const n = traveler ? 1 : 1 + Math.floor(Math.random() * this.board.groupMax * (crowd ? 1.6 : 1));
    const waiting = Array.from({ length: n }, (_, k) => ({ type: traveler && !k ? TRAVELER : pick(TYPES) }));
    const root = new THREE.Group(), chars = [];
    waiting.slice(0, 3).forEach((w, k) => {
      const ch = new Character(outfit(w.type.kind, { basin: w.type.basin ? pick([0x1d6fd1, 0xd62828, 0xe8e8e8]) : null, longSleeves: !!w.type.longSleeves }));
      ch.mesh.position.set(ROAD_EDGE + 0.55 + k * 0.55, 0.2, (k - 1) * 0.8);
      ch.mesh.rotation.y = Math.PI / 2;            // face à la chaussée
      root.add(ch.mesh);
      chars.push(ch);
    });
    const marker = new THREE.Mesh(this.markerGeo, this.markerMat);
    marker.position.set(ROAD_EDGE + 0.55, 2.7, 0);
    const zone = zoneMesh(0xf5c400, ZONE_HALF * 2);
    root.add(marker, zone);
    this.placeSide(root, z, side, 0);
    this.scene.add(root);
    if (crowd) zone.visible = false;               // (dans la foule, pas de zone : les clients courent vers le taxi)
    return { z, side, waiting, root, chars, marker, zone, state: 'waiting', phase: Math.random() * 6, refused: false, crowd, home: chars.map(ch => ch.mesh.position.clone()) };
  }

  /** Choc : tous les clients perdent du confort (et le disent). */
  jolt(amount) {
    if (!this.board.riders.length) return null;
    this.board.comfort = Math.max(0, this.board.comfort - amount);
    return amount >= 12 ? pick(LINES.angry) : null;
  }

  /** Places libres (avec le client de plus accepté). */
  get free() { return this.board.cap + this.board.extra - this.board.riders.length; }

  /** Un client qui marche (repère du groupe de la route) : il suit les points pts, puis done(). */
  walk(ch, pts, speed, done) {
    ch.mesh.visible = true;
    this.walkers.push({ ch, pts, speed, done });
  }
  updateWalkers(dt, time) {
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i], m = w.ch.mesh, q = w.pts[0];
      const dx = q.x - m.position.x, dz = q.z - m.position.z, d = Math.hypot(dx, dz), st = w.speed * dt;
      if (d > st) {
        m.position.x += dx / d * st; m.position.z += dz / d * st; m.position.y += (q.y - m.position.y) * st / d;
        m.rotation.set(0, Math.atan2(-dx, -dz), 0);
        w.ch.pose('walk', time, w.speed);
      } else {
        m.position.copy(q);
        w.pts.shift();
        if (!w.pts.length) { this.walkers.splice(i, 1); w.done(); }
      }
    }
  }
  /** La portière côté trottoir (side : chaussée de droite 1, de gauche -1). */
  door(side, y) {
    const T = this.taxi, half = this.board.cap <= 1 ? 0.75 : this.board.cap > 4 ? 1.4 : 1.2;
    return worldVec(T.x + side * half, y, T.z);
  }
  /** Un personnage pour un client qui n'était pas visible dans le groupe. */
  newChar(type) {
    const ch = new Character(outfit(type.kind, { basin: type.basin ? pick([0x1d6fd1, 0xd62828, 0xe8e8e8]) : null, longSleeves: !!type.longSleeves }));
    this.scene.add(ch.mesh);
    return ch;
  }
  dispose(ch) {
    ch.mesh.parent?.remove(ch.mesh);
    ch.release();   // (téléphone Android : le jeu se figeait après quelques arrêts ; voir Character.release)
  }
  /** Le client descend : il sort par la portière côté trottoir, monte sur le trottoir et s'éloigne. */
  alight(r) {
    const T = this.taxi;
    if (!T) { if (r.ch) this.dispose(r.ch); r.ch = null; return; }
    const ch = r.ch ?? this.newChar(r.type), s = r.side, y0 = T.y ?? 0;
    r.ch = null;
    this.scene.add(ch.mesh);
    ch.mesh.position.copy(this.door(s, y0));
    const away = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4);
    this.walk(ch, [worldVec(s * (ROAD_EDGE + 1.4), y0 + 0.2, T.z + s * 0.6), worldVec(s * (ROAD_EDGE + 1.7 + Math.random()), y0 + 0.2, T.z + away)], 1.4, () => this.dispose(ch));
  }

  update(dt, taxi, time, cb) {
    const B = this.board, slow = Math.abs(taxi.speed) < STOP_SPEED;
    this.taxi = taxi;
    this.updateWalkers(dt, time);
    const inLane = side => side * taxi.x > LANE_R - LANE_W / 2 + 0.3 && side * taxi.x < ROAD_EDGE && taxi.level !== 'pont' && taxi.level !== 'sous';
    this.prompt = '';
    B.comfort = Math.min(100, B.comfort + dt * 1.5);               // le confort revient doucement

    // descentes : les clients de cette route arrivés à leur destination
    const here = B.riders.filter(r => r.road === this && r.destZ !== null && inLane(r.side) && Math.abs(taxi.z - r.destZ) < DROP_HALF);
    if (here.length) {
      this.prompt = slow ? 'Les clients descendent…' : `Arrête-toi : ${here.length} client${here.length > 1 ? 's descendent' : ' descend'} ici`;
      if (slow && (this.hold += dt) > STEP) { this.hold = 0; this.dropoff(here[0], cb); }
      if (!slow) this.hold = 0;
      this.showDest(taxi);
      return;
    }
    // un client trop secoué descend sans payer, au premier arrêt
    if (B.comfort < 20 && slow && B.riders.length) {
      const r = B.riders.pop();
      B.comfort = 45;
      this.alight(r);
      cb.onLeave?.(r, pick(LINES.leave));
    }

    for (const c of this.clients) {
      if (c.state !== 'waiting') continue;
      const near = Math.abs(c.z - taxi.z);
      for (const ch of c.chars) ch.mesh.visible = near < 200;
      // dans la foule : quand le taxi ralentit tout près, du bon côté, les clients courent vers sa portière
      const rush = c.crowd && inLane(c.side) && near < 26 && Math.abs(taxi.speed) < 5 && this.free > 0;
      if (near < 160) {
        c.chars.forEach((ch, k) => {
          const m = ch.mesh.position, home = c.home[k];
          const tx = rush ? LANE_R + 1.1 + k * 0.4 : home.x, tz = rush ? (taxi.z - c.z) * c.side + (k - 1) * 0.9 : home.z;
          const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
          if (d > 0.15) { const st = Math.min(d, (rush ? 3.4 : 1.4) * 0.033); m.x += dx / d * st; m.z += dz / d * st; ch.mesh.rotation.y = Math.atan2(-dx, -dz); ch.pose('walk', time + k, rush ? 3.2 : 1.2); }
          else { ch.mesh.rotation.y = Math.PI / 2; ch.pose(k === 0 && (this.free > 0 || !c.refused) ? 'wave' : 'idle', time + k); }
        });
        c.marker.rotation.y = time * 2;
        c.marker.position.y = 2.7 + Math.sin(time * 3 + c.phase) * 0.2;
      }
      if (!inLane(c.side) || near > (c.crowd ? 20 : ZONE_HALF)) continue;
      if (!slow) { this.prompt = `Arrête-toi : ${c.waiting.length} client${c.waiting.length > 1 ? 's attendent' : ' attend'}`; this.hold = 0; continue; }
      if (this.offer) { this.prompt = 'Réponds au client…'; continue; }
      if (this.free <= 0) {
        // complet : un client demande à monter quand même (pas sur la moto)
        if (!c.refused && B.cap > 1 && !B.extra) { this.offer = { kind: 'extra', stop: c, line: LINES.extra }; cb.onOffer?.(this.offer); }
        else this.prompt = 'Complet !';
        continue;
      }
      this.prompt = 'Les clients montent…';
      if ((this.hold += dt) > STEP) { this.hold = 0; this.board1(c, taxi, cb); }
    }
    this.showDest(taxi);
  }

  /** Un client du groupe monte (parfois, il propose d'abord un prix plus bas). */
  board1(c, taxi, cb) {
    const w = c.waiting[0];
    if (!w.asked && Math.random() < 0.2 && this.board.fare > 500) {
      w.asked = true;
      const low = this.board.fare - (this.board.fare >= 1500 ? 500 : 200);
      this.offer = { kind: 'price', stop: c, price: low, line: LINES.offer(`${low.toLocaleString('fr-FR')} FC`) };
      cb.onOffer?.(this.offer);
      return;
    }
    this.take(c, w.price ?? this.board.fare, cb);
  }

  take(c, price, cb) {
    // (l'auteur, 08/11 : un client allait à la 1re Rue, déjà passée) : la destination est devant le véhicule, dans le sens où il roule
    const fwd = this.taxi ? (Math.cos(this.taxi.heading ?? 0) >= 0 ? 1 : -1) : c.side;
    const w = c.waiting.shift(), d = this.destFor(c.z, fwd);
    const name = d.name ? (d.short ?? d.name).replace(/^Arrêt /, '') : null;
    const r = { type: w.type, side: fwd, road: this, destName: name, destZ: d.z, price };
    this.board.riders.push(r);
    // on le voit marcher jusqu'à la portière et monter (un personnage du groupe, ou un autre du groupe qu'on ne voyait pas)
    if (this.taxi) {
      c.root.updateMatrixWorld(true);
      const ch = c.chars.length > c.waiting.length ? c.chars.pop() : this.newChar(w.type);
      const from = (ch.mesh.parent === c.root ? ch.mesh.position.clone() : c.home[0].clone()).applyMatrix4(c.root.matrix);
      this.scene.add(ch.mesh);
      ch.mesh.position.copy(from);
      // (moto : le client lui-même s'assoit derrière le conducteur, avec ses vêtements ; voiture, bus : il entre et disparaît)
      this.walk(ch, [this.door(c.side, from.y)], 2.2, () => { if (this.board.cap <= 1 && cb.onMount) cb.onMount(r, ch); else ch.mesh.visible = false; });
      r.ch = ch;
    } else if (c.chars.length > c.waiting.length) c.chars.pop().mesh.visible = false;
    if (!c.waiting.length) { c.state = 'empty'; c.root.visible = false; }
    cb.onPickup(r, w.type.board(name ?? cb.terminusName?.() ?? 'au terminus'));
  }

  /** Réponse du joueur à une proposition (main.js). */
  answer(yes, cb) {
    const o = this.offer;
    this.offer = null;
    if (!o) return;
    if (o.kind === 'price') {
      if (yes) this.take(o.stop, o.price, cb);
      else { o.stop.waiting.shift(); if (!o.stop.waiting.length) { o.stop.state = 'empty'; o.stop.root.visible = false; } }
    } else if (yes) { this.board.extra = 1; this.take(o.stop, this.board.fare, cb); }
    else o.stop.refused = true;
  }

  dropoff(r, cb) {
    const B = this.board;
    B.riders.splice(B.riders.indexOf(r), 1);
    this.alight(r);
    if (B.extra && B.riders.length < B.cap) B.extra = 0;             // (plus de surcharge)
    const tip = B.comfort >= 85 && Math.random() < 0.4 ? 200 : 0;
    cb.onDropoff(Math.round(r.price * (0.6 + 0.4 * B.comfort / 100) / 100) * 100, tip, pick(LINES.thanks));
  }

  /** Arrêt au terminus : tout le monde descend par la portière, paie, et s'en va à pied. */
  alightAll(cb) {
    const B = this.board, n = B.riders.length;
    let sum = 0;
    for (const r of B.riders) { sum += Math.round(r.price * (0.6 + 0.4 * B.comfort / 100) / 100) * 100; this.alight(r); }
    B.riders.length = 0; B.extra = 0;
    if (n) cb.onDropoff(sum, 0, `${n} client${n > 1 ? 's descendent' : ' descend'} au terminus`);
  }

  /** Au terminus : tout le monde descend et paie. */
  payAll(cb) {
    const B = this.board;
    let sum = 0;
    for (const r of B.riders) sum += Math.round(r.price * (0.6 + 0.4 * B.comfort / 100) / 100) * 100;
    const n = B.riders.length;
    for (const r of B.riders) if (r.ch) { this.dispose(r.ch); r.ch = null; }   // (au terminus le véhicule repart aussitôt dans l'autre sens)
    B.riders.length = 0; B.extra = 0;
    if (n) cb.onDropoff(sum, 0, `${n} client${n > 1 ? 's descendent' : ' descend'} au terminus`);
  }

  /** Colonne verte : le prochain client à déposer sur cette route. */
  showDest(taxi) {
    const next = this.board.riders.filter(r => r.road === this && r.destZ !== null).sort((a, b) => Math.abs(a.destZ - taxi.z) - Math.abs(b.destZ - taxi.z))[0];
    this.dest.visible = !!next;
    if (next && this.destShown !== next) { this.destShown = next; this.placeSide(this.dest, next.destZ, next.side, roadH(next.destZ)); }
  }
}
