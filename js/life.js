// Piétons animés qui marchent sur les accotements autour du joueur (recyclés en permanence).
import { Character, outfit } from './characters.js';
import { ROAD_EDGE, inRiver, inRaised, WALK_END, inCrowd, inFlyover, CROWDS, BUS_STOPS, BUS_STOPS_L, FOOTBRIDGES, blockedAt, obstacleAt, pedHeight, WORKS } from './world.js';
import * as THREE from 'three';
import { place } from './route.js';

const COUNT = 40;
const AHEAD = 230;
const BEHIND = 40;
const BASINS = [0x1d6fd1, 0xd62828, 0xe8e8e8, 0x2b8a3e];
/** Sur une chaussée (là où un véhicule peut rouler) ? */
const onRoad = (x, z) => blockedAt(x, z, null) === null;

export class StreetLife {
  constructor(scene) {
    this.people = [];
    for (let i = 0; i < COUNT; i++) {
      const kind = ['woman', 'man', 'woman', 'student', 'man'][i % 5];
      const o = outfit(kind, { basin: kind === 'woman' && Math.random() < 0.4 ? BASINS[i % BASINS.length] : null });
      const ch = new Character(o);
      scene.add(ch.mesh);
      this.people.push({ ch, x: 0, z: 0, dir: 1, speed: 1, stop: 0 });
    }
    // Ceux qui traversent le boulevard : nombreux dans les zones de foule, rares ailleurs (main.js : accident ; traffic.js : les voitures leur cèdent)
    this.crossers = [];
    for (let i = 0; i < (CROWDS.length ? 5 : 2); i++) {
      const ch = new Character(outfit(['man', 'woman', 'student', 'woman'][i % 4], { basin: i % 4 === 1 ? BASINS[i % BASINS.length] : null }));
      ch.mesh.visible = false;
      scene.add(ch.mesh);
      this.crossers.push({ ch, active: false, x: 0, z: 0, dir: 1, speed: 1.3, wait: 0, fallen: false });
    }
    this.spawnT = 0;
    // Ceux qui passent par la passerelle (l'auteur, 08/11) : ils montent l'escalier, traversent en haut, redescendent de l'autre côté
    this.bridgers = FOOTBRIDGES.length ? Array.from({ length: 5 }, (_, i) => {
      const ch = new Character(outfit(['woman', 'student', 'man', 'woman', 'man'][i], { basin: i === 3 ? BASINS[1] : null }));
      ch.mesh.visible = false;
      scene.add(ch.mesh);
      return { ch, fb: null, path: null, i: 0, pos: null, dir: [0, -1], wait: 0, speed: 1.05 + Math.random() * 0.3 };
    }) : [];
    this.stops = [...BUS_STOPS, ...BUS_STOPS_L];
    // Les athlètes (l'auteur, 10/11 & 16/11 : « ajouter la course des athlètes, des personnes qui courent ») : deux pelotons de sportifs
    // (hommes et femmes en maillots et survêtements) courent sur les accotements de part et d'autre du boulevard et reviennent régulièrement devant le joueur
    const MAILLOTS = [0xd62828, 0x1d4fa0, 0xffffff, 0xe0a100, 0x2b8a3e, 0x1a1a1a, 0x7b2cbf, 0xff6b00];
    this.runners = Array.from({ length: 14 }, (_, i) => {
      const fem = i % 4 === 1;
      const ch = new Character(outfit(fem ? 'woman' : 'man', {
        dress: false, pagneTop: false, headwrap: null, basin: null, bag: null,
        shirt: MAILLOTS[i % MAILLOTS.length],
        pants: i % 2 ? 0x1a1a1a : 0x1d3557,
        shoes: 0xf2f2f2,
        cap: i % 5 === 0 ? 0xffffff : null,
        untucked: false, sandals: false, beard: false,
        height: 0.96 + Math.random() * 0.08, girth: 0.88 + Math.random() * 0.1, stride: 1.15,
      }));
      ch.mesh.visible = false;
      scene.add(ch.mesh);
      return { ch, group: i < 8 ? 0 : 1 };
    });
    this.runGroups = [
      { z: null, side: 1, dir: -1, speed: 3.6 },
      { z: null, side: -1, dir: 1, speed: 3.8 },
    ];
    // Les ouvriers des chantiers (l'auteur, 13/11 : « ajouter des travaux dans le boulevard ») : gilet orange, casque jaune ; trois creusent la
    // tranchée, un fait signe aux voitures avec le panneau rouge et vert, deux vont et viennent. Ils travaillent au chantier le plus proche.
    this.workers = WORKS.length ? Array.from({ length: 6 }, (_, i) => {
      const ch = new Character(outfit('man', { shirt: [0x1d3557, 0x2b2d31, 0x5b4a3a][i % 3], pants: 0x23262b, vest: 0xf28c28, cap: 0xf5c400, idle: 0, untucked: false, sandals: false }));
      if (i < 3) { const sh = new THREE.Group(); sh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6).translate(0, -0.45, 0), new THREE.MeshLambertMaterial({ color: 0x8a5a2a })), new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.03).translate(0, -1.15, 0), new THREE.MeshLambertMaterial({ color: 0x6f7378 }))); ch.hold(sh); }   // (la pelle)
      if (i === 3) ch.hold(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16).rotateX(Math.PI / 2).translate(0, -0.55, 0), new THREE.MeshLambertMaterial({ color: 0xd62828 })));
      ch.mesh.visible = false;
      scene.add(ch.mesh);
      return { ch, role: i < 3 ? 'dig' : i === 3 ? 'flag' : 'walk', x: 0, z: 0, t: Math.random() * 10, dir: 1 };
    }) : [];
    this.site = null;
  }

  /** Les ouvriers : au chantier le plus proche (moins de 320 m), dans les voies fermées. */
  updateWorkers(dt, z, time) {
    if (!this.workers.length) return;
    const Wk = WORKS.filter(q => q.on && Math.abs((q.z0 + q.z1) / 2 - z) < 320).sort((a, b) => Math.abs((a.z0 + a.z1) / 2 - z) - Math.abs((b.z0 + b.z1) / 2 - z))[0] ?? null;
    if (Wk !== this.site) {
      this.site = Wk;
      for (const w of this.workers) w.ch.mesh.visible = !!Wk;
      if (!Wk) return;
      const s = Wk.side, L = Wk.z0 - Wk.z1, xm = s * (Wk.xIn + Wk.xOut) / 2;
      this.workers.forEach((w, i) => {
        if (w.role === 'dig') { w.x = xm + s * (i % 2 ? -1.1 : 1.0); w.z = Wk.z1 + L * (0.18 + i * 0.12); }
        else if (w.role === 'flag') { w.x = s * ((Wk.outer ? Wk.xIn : Wk.xOut) + (Wk.outer ? 0.6 : -0.6)); w.z = (s > 0 ? Wk.z0 : Wk.z1) - s * 1.5 + s * 3; }
        else { w.x = xm + s * (i % 2 ? 1.8 : -1.8); w.z = Wk.z1 + L * (0.3 + (i - 4) * 0.3); w.z0 = Wk.z1 + 6; w.z1 = Wk.z0 - 6; w.dir = i % 2 ? 1 : -1; }
      });
    }
    if (!Wk) return;
    const s = Wk.side;
    for (const w of this.workers) {
      w.t += dt;
      if (w.role === 'walk') {
        w.z += w.dir * 1.0 * dt;
        if (w.z > w.z1) w.dir = -1; else if (w.z < w.z0) w.dir = 1;
        w.ch.pose('walk', time + w.t, 1.0);
        place(w.ch.mesh, w.x, w.z, w.dir < 0 ? 0 : Math.PI, 0);
      } else if (w.role === 'dig') {
        w.ch.pose('dig', w.t);
        place(w.ch.mesh, w.x, w.z, (w.x - (s * (Wk.xIn + Wk.xOut) / 2)) * s > 0 ? -s * Math.PI / 2 : s * Math.PI / 2, 0);   // (tourné vers la tranchée)
      } else {
        w.ch.pose('flag', w.t);
        place(w.ch.mesh, w.x, w.z, s > 0 ? Math.PI : 0, 0);           // (face aux voitures qui arrivent)
      }
    }
  }

  /** Les pelotons d'athlètes : posés entre 55 m et 135 m devant le joueur sur les deux accotements, ils courent en rythme (pose 'run') et reviennent devant dès qu'on les dépasse. */
  updateRunners(dt, z, time, morning, back) {
    const fwd = back ? 1 : -1;
    this.runGroups.forEach((R, gi) => {
      const groupRunners = this.runners.filter(r => r.group === gi);
      const behind = (R.z !== null) ? (R.z - z) * (-fwd) : Infinity;
      if (R.z === null || behind > 45 || Math.abs(R.z - z) > 210) {
        R.side = gi === 0 ? 1 : -1;
        R.dir = gi === 0 ? fwd : -fwd;
        R.speed = 3.5 + Math.random() * 0.7;
        R.z = z + fwd * (60 + gi * 45 + Math.random() * 35);
        if (R.z < WALK_END + 60 || R.z > 130) {
          R.z = null;
          for (const r of groupRunners) r.ch.mesh.visible = false;
          return;
        }
      }
      R.z += R.dir * R.speed * dt;
      if (R.z < WALK_END + 20) R.dir = 1;
      if (inRiver(R.z, 3)) R.z += R.dir * 8;
      groupRunners.forEach((r, k) => {
        const col = k % 2, row = Math.floor(k / 2);
        const x0 = R.side * (ROAD_EDGE + 1.45 + col * 0.9), zz = R.z - R.dir * (row * 1.65 + (col ? 0.45 : 0));
        // (l'auteur, 13/11 : rien ne passe à travers) : un obstacle devant lui : il s'écarte vers l'extérieur le temps de le passer
        const want = [0, 0.7, 1.4, 2.1].find(d => !obstacleAt(x0 + R.side * d, zz + R.dir * 0.8, 0.3) && !obstacleAt(x0 + R.side * d, zz, 0.3)) ?? 0;
        r.dx = (r.dx ?? 0) + (want - (r.dx ?? 0)) * Math.min(1, dt * 3);
        const x = x0 + R.side * r.dx;
        r.x = x; r.z = zz;
        const near = Math.abs(zz - z) < 210 && !inRaised(zz, 2) && !inFlyover(zz, 4) && !onRoad(x, zz);
        r.ch.mesh.visible = near;
        if (near) {
          r.ch.pose('run', time + k * 0.31 + gi * 1.1, R.speed);
          place(r.ch.mesh, x, zz, R.dir < 0 ? 0 : Math.PI, pedHeight(x, zz));
        }
      });
    });
  }

  /** Le chemin sur la passerelle en zf, du côté s vers l'autre (même géométrie que world.js addFootbridge). */
  bridgePath(zf, s) {
    const E = ROAD_EDGE, sx = E + 4.4, top = 6.42;
    const one = k => [[k * (E + 3), 0, zf + 14], [k * sx, 0, zf + 11.6], [k * sx, 3.36, zf + 5.9], [k * sx, top, zf + 0.2]];
    return [...one(s), ...one(-s).reverse()];
  }
  updateBridgers(dt, z, time) {
    const fb = FOOTBRIDGES.find(f => Math.abs(f - z) < 230) ?? null;
    this.bridgers.forEach((b, n) => {
      if (fb === null) { b.ch.mesh.visible = false; b.fb = null; return; }
      if (b.fb !== fb) {                             // nouvelle passerelle : chacun ailleurs sur le chemin
        b.fb = fb;
        b.path = this.bridgePath(fb, n % 2 ? 1 : -1);
        b.i = Math.floor(Math.random() * (b.path.length - 1));
        b.pos = b.path[b.i].slice();
        b.wait = Math.random() * 3;
      }
      b.ch.mesh.visible = true;
      if (b.wait > 0) { b.wait -= dt; b.ch.pose('idle', time); }
      else {
        let step = b.speed * dt;
        while (step > 0 && b.i < b.path.length - 1) {
          const a = b.pos, q = b.path[b.i + 1], d = Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]);
          if (Math.hypot(q[0] - a[0], q[2] - a[2]) > 0.01) b.dir = [q[0] - a[0], q[2] - a[2]];
          if (d <= step) { b.pos = q.slice(); b.i++; step -= d; } else { b.pos = a.map((v, j) => v + (q[j] - v) * step / d); step = 0; }
        }
        if (b.i >= b.path.length - 1) { b.path = b.path.slice().reverse(); b.i = 0; b.wait = 2 + Math.random() * 6; }   // (arrivé : il repartira dans l'autre sens)
        b.ch.pose('walk', time, b.speed);
      }
      place(b.ch.mesh, b.pos[0], b.pos[2], Math.atan2(b.dir[0], -b.dir[1]), b.pos[1]);
    });
  }

  /** Un piéton commence à traverser en zAhead, devant le taxi. */
  startCrossing(p, zAhead) {
    p.z = zAhead;
    p.dir = Math.random() < 0.5 ? -1 : 1;
    p.x = -p.dir * (ROAD_EDGE + 1.2);
    p.speed = 1.1 + Math.random() * 0.6;
    p.wait = 0;
    p.fallen = false;
    p.flee = false;
    p.active = true;
    p.y = 0; p.blockT = 0;
    p.ch.mesh.visible = true;
    p.ch.mesh.rotation.set(0, 0, 0);
  }
  /** (l'auteur, 13/11 : « rien ne doit passer transparent ») Un véhicule (circulation, voitures des rues, celui du joueur) occupe-t-il (x, z) ? */
  vehicleAt(x, z, taxi, m = 0.35) {
    for (const v of this.traffic?.list ?? []) {
      if (!v.mesh.visible) continue;
      const run = (v.speed ?? 0) * 1.2, z0 = v.z - v.len / 2 - m - (v.side > 0 ? run : 0), z1 = v.z + v.len / 2 + m + (v.side < 0 ? run : 0);   // (une voiture qui arrive : on la laisse passer)
      if (Math.abs(v.x - x) < v.wid / 2 + m && z > z0 && z < z1) return true;
    }
    for (const c of this.traffic?.crossing ?? []) {
      if (c.hidden || !c.mesh.visible) continue;
      const across = Math.abs(c.hx) > 0.7, ex = across ? c.len : c.wid, ez = across ? c.wid : c.len;
      if (Math.abs(c.x - x) < ex / 2 + m && Math.abs(c.z - z) < ez / 2 + m) return true;
    }
    return !!taxi && Math.abs(taxi.x - x) < (taxi.bw ?? 1.8) / 2 + m && Math.abs(taxi.z - z) < (taxi.bl ?? 4.4) / 2 + m;
  }

  /** Les traversées : taxi = { x, z, speed, heading } dans le repère de la route ; elles attendent au bord si un véhicule arrive tout près. */
  updateCrossers(dt, taxi, time) {
    this.taxiRef = taxi;
    const fwd = Math.cos(taxi.heading ?? 0) >= 0 ? -1 : 1;           // sens de la marche du taxi en z
    // (l'auteur, 08/11 : « les piétons traversent à tout moment, ce n'est pas bien ») : peu à la fois, surtout aux arrêts ; près d'une
    // passerelle, on passe par la passerelle
    const crowd = inCrowd(taxi.z, 150), want = crowd ? 3 : 1;
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.crossers.filter(p => p.active).length < want) {
      this.spawnT = crowd ? 4 + Math.random() * 5 : 14 + Math.random() * 12;
      const p = this.crossers.find(q => !q.active);
      // (pas sous un saut-de-mouton, ni sur un pont : on cherche un endroit libre devant le taxi)
      for (let k = 0; k < 12 && p; k++) {
        const zr = taxi.z + fwd * (crowd ? 35 + Math.random() * 130 : 60 + Math.random() * 140);
        const st = this.stops.find(q => Math.abs(q - zr) < 40);
        if (st === undefined && !(crowd && Math.random() < 0.3)) continue;
        const z = st === undefined ? zr : st + (Math.random() - 0.5) * 12;
        if (FOOTBRIDGES.some(f => Math.abs(f - z) < 70) || inFlyover(z, 8) || inRiver(z, 10) || inRaised(z, 10)) continue;
        if (obstacleAt(ROAD_EDGE + 1.2, z, 0.4) || obstacleAt(-(ROAD_EDGE + 1.2), z, 0.4)) continue;   // (l'auteur, 13/11 : ni départ ni arrivée dans un étal)
        if (WORKS.some(q => q.on && z < q.z0 + 45 && z > q.z1 - 45)) continue;                      // (ni dans un chantier)
        this.startCrossing(p, z);
        break;
      }
    }
    for (const p of this.crossers) {
      if (!p.active) continue;
      if (Math.abs(p.z - taxi.z) > 260) { p.active = false; p.ch.mesh.visible = false; continue; }
      if (p.fallen) { p.ch.pose('idle', 0); continue; }
      // au bord d'une chaussée, on attend si le taxi arrive tout près sur elle ; une fois engagé, on continue
      const nextX = p.x + p.dir * p.speed * dt, onRoad = Math.abs(nextX) < ROAD_EDGE + 0.3, wasOff = Math.abs(p.x) >= ROAD_EDGE + 0.3 || Math.abs(p.x) < 0.6;
      const tz = (p.z - taxi.z) * fwd, sameSide = Math.sign(nextX || p.dir) === Math.sign(taxi.x || 1);
      if (onRoad && wasOff && !p.flee && sameSide && tz > 0 && tz < 30 && Math.abs(taxi.speed) > 3) p.wait = 0.5;
      // déjà sur la chaussée et le véhicule arrive vite : il court s'écarter (en avant ou en arrière, du côté opposé au véhicule)
      if (!p.flee && Math.abs(p.x) < ROAD_EDGE && tz > 0 && tz < 28 && Math.abs(taxi.speed) > 5 && Math.abs(taxi.x - p.x) < 4.5) {
        p.flee = true; p.wait = 0;
        p.dir = Math.sign(p.x - taxi.x) || p.dir;
        p.speed = 3.6 + Math.random() * 0.8;
      }
      // (l'auteur, 13/11 : « rien ne doit passer transparent ; les piétons doivent sauter la bordure ») : il monte sur la bordure, enjambe le
      // séparateur (plus lentement), redescend ; un véhicule sur son chemin : il attend qu'il passe
      const hNow = pedHeight(p.x, p.z), hNext = pedHeight(p.x + p.dir * 0.45, p.z);
      const climbing = (Math.max(hNow, hNext) > 0.15 && Math.abs(hNext - (p.y ?? 0)) > 0.06) || hNow > 0.6;
      const step = p.dir * p.speed * (Math.max(hNow, hNext) > 0.6 ? 0.35 : climbing ? 0.6 : 1) * dt;
      if (p.wait > 0) p.wait -= dt;
      else if (!p.flee && this.vehicleAt(p.x + step + p.dir * 0.3, p.z, taxi)) p.blockT = (p.blockT ?? 0) + dt;
      else { p.x += step; p.blockT = 0; }
      p.y = (p.y ?? 0) + (pedHeight(p.x, p.z) - (p.y ?? 0)) * Math.min(1, dt * 14);
      if (p.dir * p.x > ROAD_EDGE + 3) { p.active = false; p.ch.mesh.visible = false; continue; }
      p.ch.pose(p.wait > 0 || p.blockT > 0 ? 'idle' : climbing ? 'climb' : 'walk', time, p.speed);
      place(p.ch.mesh, p.x, p.z, p.dir * Math.PI / 2, p.y);   // (face au côté où il va : l'auteur, 08/11, ils marchaient à reculons)
    }
  }

  /** Accident : le piéton tombe et reste au sol. */
  knockDown(p) {
    p.fallen = true;
    p.ch.pose('idle', 0);
    p.ch.mesh.rotation.x = -Math.PI / 2;
    p.ch.mesh.position.y = 0.25;
  }

  place(p, zFrom, span) {
    // (l'auteur, 08/11 : « les piétons marchent dans le macadam » devant Akram, au 30 Juin) : jamais sur une chaussée (bretelle, rue, place)
    for (let k = 0; k < 10; k++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      p.x = side * (ROAD_EDGE + 2.4 + Math.random() * 6);
      p.z = zFrom - Math.random() * span;
      if (inRiver(p.z, 2)) p.z -= 60;
      if (p.z < WALK_END) p.z = WALK_END + Math.random() * 60;     // pas au-delà du bout de la chaussée
      if (onRoad(p.x, p.z) || obstacleAt(p.x, p.z, 0.4)) continue;   // (l'auteur, 13/11 : jamais dans un étal ou un poteau)
      break;
    }
    p.off = onRoad(p.x, p.z);                                     // (aucune place libre : il reste caché)
    p.dir = Math.random() < 0.5 ? -1 : 1;
    p.speed = 0.8 + Math.random() * 0.7;
    p.stop = 0;
    p.tx = undefined;
  }

  /** (l'auteur, 13/11 : « rien ne doit passer transparent ») Le point (x, z) est-il pris pour le passant p : décor, autre passant, athlète,
   *  véhicule, clients qui attendent ? */
  blocked(p, x, z) {
    if (obstacleAt(x, z, 0.28)) return true;
    for (const o of this.people) if (o !== p && !o.off && o.ch.mesh.visible && Math.abs(o.x - x) < 0.55 && Math.abs(o.z - z) < 0.55) return true;
    for (const r of this.runners) if (r.ch.mesh.visible && Math.abs(r.x - x) < 0.6 && Math.abs(r.z - z) < 0.7) return true;
    const T = this.taxiRef;
    if (T && Math.abs(T.x - x) < (T.bw ?? 1.8) / 2 + 0.45 && Math.abs(T.z - z) < (T.bl ?? 4.4) / 2 + 0.45) return true;
    for (const c of this.passengers?.clients ?? []) if (c.state === 'waiting' && c.root.visible && Math.sign(x) === c.side && Math.abs(x) < ROAD_EDGE + 2.1 && Math.abs(z - c.z) < 1.5) return true;
    return false;
  }
  /** Un obstacle devant : on passe par le côté libre (on s'écarte d'abord, sans avancer) ; s'il n'y en a pas, demi-tour. */
  dodge(p, nz) {
    const s = Math.sign(p.x) || 1, zf = nz + p.dir * 0.4;
    for (const d of [0.6, -0.6, 1.1, -1.1, 1.7, -1.7]) {
      const x = p.x + d * s, ax = Math.abs(x);
      if (ax < ROAD_EDGE + 1.3 || ax > ROAD_EDGE + 9 || onRoad(x, p.z)) continue;
      // (le pas de côté lui-même ne doit traverser aucun obstacle)
      let clear = true;
      for (let k = 1; k <= Math.ceil(Math.abs(d) / 0.3) && clear; k++) if (obstacleAt(p.x + Math.sign(d) * s * Math.min(Math.abs(d), k * 0.3), p.z, 0.22)) clear = false;
      if (clear && !this.blocked(p, x, p.z) && !this.blocked(p, x, zf)) { p.tx = x; return; }
    }
    p.dir = -p.dir; p.stop = 0.3 + Math.random() * 0.6;
  }

  /** Le véhicule quitte cette route : plus personne d'animé ici, on cache tout (sinon ils restent figés sur place). */
  hideAll() {
    for (const w of this.workers ?? []) w.ch.mesh.visible = false;
    this.site = null;
    for (const r of this.runners ?? []) r.ch.mesh.visible = false;
    for (const g of this.runGroups ?? []) g.z = null;
    for (const p of this.crossers ?? []) { p.active = false; p.ch.mesh.visible = false; }
    for (const p of this.people) p.ch.mesh.visible = false;
    for (const b of this.bridgers ?? []) { b.ch.mesh.visible = false; b.fb = null; }
  }

  reset(z) {
    for (const p of this.crossers ?? []) { p.active = false; p.fallen = false; p.ch.mesh.visible = false; }
    this.people.forEach((p, i) => this.place(p, z + BEHIND - i * (AHEAD + BEHIND) / COUNT, 6));
  }

  /** back : le taxi revient vers l'aéroport (+z) ; les piétons sont alors renouvelés devant lui dans ce sens. */
  update(dt, z, time, back = false, morning = false) {
    if (this.bridgers.length) this.updateBridgers(dt, z, time);
    this.updateWorkers(dt, z, time);
    this.updateRunners(dt, z, time, morning, back);
    for (const p of this.people) {
      if (!back && (p.z > z + BEHIND || p.z < z - AHEAD - 40)) this.place(p, z - AHEAD + 60, 60);
      else if (back && (p.z < z - BEHIND || p.z > z + AHEAD + 40)) this.place(p, Math.min(150, z + AHEAD), 60);
      // pauses de temps en temps (on discute, on regarde la marchandise)
      if (p.stop > 0) p.stop -= dt;
      else if (Math.random() < dt * 0.04) p.stop = 2 + Math.random() * 4;
      const walking = p.stop <= 0, close = Math.abs(p.z - z) < 150 && !p.off;
      if (walking) {
        const nz = p.z + p.dir * p.speed * dt;
        if (onRoad(p.x, nz + p.dir * 0.6)) { p.dir = -p.dir; p.stop = 0.5 + Math.random(); }   // (du goudron devant : il fait demi-tour)
        else if (p.tx !== undefined) { /* (il s'écarte d'abord) */ }
        else if (close && this.blocked(p, p.x, nz + p.dir * 0.4)) this.dodge(p, nz);   // (l'auteur, 13/11 : il contourne)
        else p.z = nz;
      }
      if (p.tx !== undefined) {
        const d = p.tx - p.x, nx = p.x + Math.sign(d) * Math.min(Math.abs(d), 1.1 * dt);
        if (close && this.blocked(p, nx + Math.sign(d) * 0.15, p.z) && !this.blocked(p, p.x, p.z)) { p.tx = undefined; p.dir = -p.dir; p.stop = 0.4; }   // (quelqu'un s'est mis là : demi-tour)
        else { p.x = nx; if (Math.abs(d) < 0.03) p.tx = undefined; }
      }
      if (inRiver(p.z, 1)) { p.dir = -p.dir; p.z += p.dir * 1.5; }
      if (p.z < WALK_END) { p.dir = 1; p.z = WALK_END + 0.5; }   // demi-tour au bout de la chaussée
      // On n'anime que ceux qui sont proches : au-delà, la pose ne se voit plus
      const near = Math.abs(p.z - z) < 150 && !inRaised(p.z, 2) && !p.off;   // pas d'accotement le long du remblai du Pont Matete
      p.ch.mesh.visible = near;
      if (near) p.ch.pose(walking ? 'walk' : 'idle', time, p.speed);
      place(p.ch.mesh, p.x, p.z, p.dir < 0 ? 0 : Math.PI, 0);
    }
  }
}
