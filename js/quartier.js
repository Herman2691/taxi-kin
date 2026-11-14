// La vie des rues des quartiers.
// - Les gens qui marchent (l'auteur, 14/11 : « il faut simuler aussi les personnes dans ce quartier, même à Masina vers Kulumba ») : à Moboma
//   (Kingasani) et dans la boucle de Masina, au bord de la chaussée, dans les deux sens ; ils s'arrêtent quand un véhicule arrive sur eux.
// - Les motos et les voitures (l'auteur, 14/11 : « simuler aussi les motos et les voitures personnelles dans les rues de Moboma jusqu'à Mobutu ») :
//   elles roulent à droite dans les rues de Moboma jusqu'à la Rue Kabila (ex Mobutu), tournent aux carrefours, font demi-tour au fond des
//   culs-de-sac, sortent vers le boulevard (et d'autres arrivent) ; elles freinent et s'arrêtent devant le véhicule du joueur, les gens et les autres
//   véhicules, et font demi-tour si la rue reste bouchée. Rien ne passe à travers : main.js solidAround arrête le véhicule du joueur contre elles.
// Seuls ceux des rues proches du véhicule sont montrés et animés (téléphone).
import { Character, outfit } from './characters.js';
import { createMoto, createCar, createCitadine, createCrossover, createHatchback } from './models.js';
import { place } from './route.js';

const COUNT = 34;                       // (gens qui marchent, pour tout le quartier où se trouve le véhicule)
const NEAR = 170;                       // (m : rues prises en compte autour du véhicule)
const MOTOS = 10, CARS = 6, VNEAR = 230;
const BASINS = [0x1d6fd1, 0xd62828, 0xe8e8e8, 0x2b8a3e];
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
/** Écart de la voie de droite à l'axe : un quart de la rue, sans que la carrosserie approche le bord à moins de 0,7 m (les gens y marchent). */
const laneOf = (r, vh) => Math.max(1.0, Math.min(2.3, r.w / 4, r.w / 2 - 0.7 - vh.half));
const cumOf = pts => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };

export class QuartierLife {
  /** paths : le bord de chaque rue (world.js quartierPaths) ; roads : les rues où roulent motos et voitures (world.js quartierRoads). */
  constructor(scene, paths, roads = []) {
    this.paths = paths;
    this.people = [];
    this.vehicles = [];
    this.active = false;
    this.vActive = false;
    for (let i = 0; i < (paths.length ? COUNT : 0); i++) {
      const kind = ['woman', 'man', 'woman', 'student', 'man', 'woman'][i % 6];
      const o = kind === 'student' && i % 4 === 1
        ? outfit('woman', { shirt: 0xffffff, pagne: 0x1d3557, pagne2: 0x1d3557, dress: true, pagneTop: false, headwrap: null, bag: 0x2b2b2b, basin: null })
        : outfit(kind, { basin: kind === 'woman' && Math.random() < 0.35 ? BASINS[i % BASINS.length] : null });
      const ch = new Character(o);
      ch.mesh.visible = false;
      scene.add(ch.mesh);
      this.people.push({ ch, path: null, t: 0, dir: 1, speed: 1, wait: 0, x: 0, z: 0, on: false, ph: Math.random() * 10 });
    }
    this.roads = roads.map(r => { const cum = cumOf(r.pts); return { ...r, cum, len: cum.at(-1) }; }).filter(r => r.len > 12);
    if (!this.roads.length) return;
    const all = this.roads.flatMap(r => r.pts);
    this.box = [Math.min(...all.map(p => p[0])), Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1])), Math.min(...all.map(p => p[1]))];
    const CAR_COLORS = [0xf2f2f2, 0x1f1f1f, 0x7a1f1f, 0xb8bec4, 0x2b6cb0, 0x8a3f1a];
    for (let i = 0; i < MOTOS + CARS; i++) {
      const moto = i < MOTOS;
      const mesh = moto ? createMoto({ riders: i % 3 === 0 ? 2 : 1 })
        : [() => createCitadine(), () => createCrossover(), () => createCar({ color: CAR_COLORS[i % CAR_COLORS.length] }), () => createHatchback({ taxi: false, color: CAR_COLORS[(i + 3) % CAR_COLORS.length] })][i % 4]();
      mesh.visible = false;
      scene.add(mesh);
      this.vehicles.push({ mesh, moto, len: moto ? 2.1 : 4.3, half: moto ? 0.45 : 0.92, vmax: moto ? 6 + Math.random() * 2.5 : 4.5 + Math.random() * 2,
        road: null, t: 0, dir: 1, v: 0, off: 0, x: 0, z: 0, h: 0, on: false, wait: 0, stuck: 0 });
    }
  }

  /** Point du chemin p à t m de son début (borné). */
  at(p, t) {
    const T = Math.max(0, Math.min(p.len, t)), c = p.cum;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= T) lo = m; else hi = m; }
    const a = p.pts[lo], b = p.pts[hi], L = (c[hi] - c[lo]) || 1, u = (T - c[lo]) / L;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, (b[0] - a[0]) / L, (b[1] - a[1]) / L];
  }
  /** Distance le long de la rue r jusqu'au point de r le plus proche de q, et l'écart. */
  arcOn(r, q) {
    let best = 1e9, at = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = (r.cum[i] - r.cum[i - 1]) || 1;
      const u = Math.max(0, Math.min(1, ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / (L * L)));
      const d = Math.hypot(q[0] - a[0] - (b[0] - a[0]) * u, q[1] - a[1] - (b[1] - a[1]) * u);
      if (d < best) { best = d; at = r.cum[i - 1] + L * u; }
    }
    return [at, best];
  }

  hide() {
    if (this.active) { for (const p of this.people) { p.ch.mesh.visible = false; p.on = false; } this.active = false; }
    if (this.vActive) { for (const v of this.vehicles) { v.mesh.visible = false; v.on = false; } this.vActive = false; }
  }

  /** Une personne sur une rue proche du véhicule, à un endroit qu'il ne voit pas encore de trop près (pas sous ses roues). */
  spawn(p, near, taxi) {
    for (let k = 0; k < 6; k++) {
      const path = near[Math.floor(Math.random() * near.length)], t = Math.random() * path.len, q = this.at(path, t);
      const d = Math.hypot(q[0] - taxi.x, q[1] - taxi.z);
      if (d < 12 || d > NEAR || this.vehicles.some(v => v.on && Math.hypot(v.x - q[0], v.z - q[1]) < 3.5)) continue;
      Object.assign(p, { path, t, dir: Math.random() < 0.5 ? 1 : -1, speed: 0.95 + Math.random() * 0.45, wait: Math.random() < 0.25 ? 2 + Math.random() * 5 : 0, on: true, x: q[0], z: q[1] });
      p.ch.mesh.visible = true;
      return;
    }
    p.on = false;
    p.ch.mesh.visible = false;
  }

  /** Une moto ou une voiture sur une rue proche, hors de la vue immédiate du joueur et loin des autres. */
  spawnV(vh, near, taxi) {
    for (let k = 0; k < 8; k++) {
      const r = near[Math.floor(Math.random() * near.length)], lo = r.out[0] ? r.outX[0] + vh.len / 2 : 1, hi = r.out[1] ? r.len - r.outX[1] - vh.len / 2 : r.len - 1;
      if (hi - lo < 10) continue;
      const t = lo + 3 + Math.random() * (hi - lo - 6), dir = Math.random() < 0.5 ? 1 : -1;
      const lane = laneOf(r, vh), [px, pz, ux, uz] = this.at(r, t), x = px - uz * lane * dir, z = pz + ux * lane * dir;
      const d = Math.hypot(x - taxi.x, z - taxi.z);
      if (d < 40 || d > VNEAR) continue;
      if (this.vehicles.some(o => o !== vh && o.on && Math.hypot(o.x - x, o.z - z) < 12) || this.people.some(p => p.on && Math.hypot(p.x - x, p.z - z) < 3.5)) continue;
      Object.assign(vh, { road: r, t, dir, off: lane * dir, x, z, h: Math.atan2(ux * dir, -uz * dir), v: vh.vmax * 0.6, on: true, wait: 0, stuck: 0, next: null, flip: false, flipT: 0, outT: 0, rx: x, rz: z, bk: 0 });
      vh.mesh.visible = true;
      return;
    }
    vh.on = false;
    vh.mesh.visible = false;
  }

  /** Ce qu'il fera au bout de sa rue (décidé un peu avant d'y arriver) : vers le boulevard, il s'en va (un autre arrivera) ; à un carrefour, il prend
   *  une autre rue ; au fond d'un cul-de-sac (ou parfois), demi-tour. */
  planEnd(vh) {
    const r = vh.road, last = vh.dir > 0, end = last ? r.pts.at(-1) : r.pts[0];
    if (r.out[last ? 1 : 0]) return { out: true, end };
    const cand = [];
    for (const o of this.roads) {
      if (o === r) continue;
      const [t2, d] = this.arcOn(o, end);
      if (d < o.w / 2 + 2.5) cand.push([o, t2]);
    }
    if (!cand.length || Math.random() < 0.12) return { uturn: true, end };
    const [o, t2] = cand[Math.floor(Math.random() * cand.length)];
    const dir = t2 < 4 ? 1 : t2 > o.len - 4 ? -1 : (Math.random() < 0.5 ? 1 : -1), lane = laneOf(o, vh), [px, pz, ux, uz] = this.at(o, t2);
    return { road: o, t: t2, dir, x: px - uz * lane * dir, z: pz + ux * lane * dir, end };
  }
  /** Le carrefour et la voie qu'il va prendre sont-ils libres ? (personne, aucun autre véhicule) */
  clearAt(vh, nx, taxi) {
    const room = (x, z, r) => !this.people.some(p => p.on && Math.hypot(p.x - x, p.z - z) < r) && !this.vehicles.some(q => q !== vh && q.on && Math.hypot(q.x - x, q.z - z) < r + q.len / 2)
      && !(taxi && Math.hypot(taxi.x - x, taxi.z - z) < r + 2.4);
    return room(nx.end[0], nx.end[1], 3.5) && (!nx.road || room(nx.x, nx.z, vh.len / 2 + 1.5));
  }
  roadEnd(vh) {
    const nx = vh.next ?? this.planEnd(vh);
    vh.next = null;
    if (nx.out) { vh.on = false; vh.mesh.visible = false; return; }
    if (nx.uturn) { vh.flip = true; return; }                              // (demi-tour quand l'autre voie est libre)
    vh.road = nx.road; vh.t = nx.t; vh.dir = nx.dir; vh.off = laneOf(nx.road, vh) * nx.dir;   // (il prend sa voie en tournant)
  }

  /** Une moto ou une voiture sous le point (x, z) ? (main.js solidAround : le véhicule du joueur s'y arrête) */
  vehicleAt(px, pz) {
    for (const vh of this.vehicles) {
      if (!vh.on) continue;
      const dx = px - vh.x, dz = pz - vh.z;
      if (dx * dx + dz * dz > 9) continue;
      const hx = Math.sin(vh.h), hz = -Math.cos(vh.h);
      if (Math.abs(dx * hx + dz * hz) < vh.len / 2 && Math.abs(dx * hz - dz * hx) < vh.half) return true;
    }
    return false;
  }

  updateVehicles(dt, taxi) {
    const b = this.box;
    if (!b || taxi.x < b[0] - VNEAR || taxi.x > b[1] + VNEAR || taxi.z > b[2] + VNEAR || taxi.z < b[3] - VNEAR) {
      if (this.vActive) { for (const v of this.vehicles) { v.mesh.visible = false; v.on = false; } this.vActive = false; }
      return;
    }
    this.vActive = true;
    const near = this.roads.filter(r => r.pts.some(p => Math.abs(p[0] - taxi.x) < VNEAR && Math.abs(p[1] - taxi.z) < VNEAR));
    if (!near.length) return;
    for (const vh of this.vehicles) {
      if (!vh.on || Math.hypot(vh.x - taxi.x, vh.z - taxi.z) > VNEAR + 30) this.spawnV(vh, near, taxi);
      if (!vh.on) continue;
      // ce qu'il y a devant lui : le véhicule du joueur, les gens, les autres motos et voitures
      const [, , rx, rz] = this.at(vh.road, vh.t), hx = rx * vh.dir, hz = rz * vh.dir, look = 3 + vh.v * 1.4;
      let free = look + 10, byVehicle = false, byTaxi = false;
      const test = (x, z, half, len, kind) => {
        const dx = x - vh.x, dz = z - vh.z, fwd = dx * hx + dz * hz, lat = Math.abs(dx * hz - dz * hx);
        if (fwd > 0 && fwd < look + (len + vh.len) / 2 && lat < vh.half + half + 0.3) {
          const gap = fwd - (len + vh.len) / 2;
          if (gap < free) { free = gap; byVehicle = kind === 'v'; byTaxi = kind === 't'; }
        }
      };
      test(taxi.x, taxi.z, 1.0, 4.4, 't');
      for (const p of this.people) if (p.on) test(p.x, p.z, 0.05, 0.6, 'p');
      for (const o of this.vehicles) if (o !== vh && o.on) test(o.x, o.z, o.half, o.len, 'v');
      // les bouts de sa rue : du côté du boulevard, il s'arrête avant la bordure (sa carrosserie ne touche jamais la chaussée du boulevard) ; ailleurs, le carrefour
      const R0 = vh.road, lo = R0.out[0] ? R0.outX[0] + vh.len / 2 : 1, hi = R0.out[1] ? R0.len - R0.outX[1] - vh.len / 2 : R0.len - 1;
      const toEnd = vh.dir > 0 ? hi - vh.t : vh.t - lo;
      if (toEnd < 10 && !vh.next) vh.next = this.planEnd(vh);
      if (vh.next?.out) {
        // vers le boulevard : il s'arrête avant la bordure, comme pour attendre de pouvoir s'engager ; loin du joueur, il s'en va (un autre arrivera) ;
        // tout près, il finit par faire demi-tour
        free = Math.min(free, toEnd + 1.2);
        if (toEnd < 0.8) {
          if (Math.hypot(vh.x - taxi.x, vh.z - taxi.z) > 70) { vh.on = false; vh.mesh.visible = false; continue; }
          vh.outT += dt;
          if (vh.outT > 6 && !vh.flip) { vh.flip = true; vh.outT = 0; }
        }
      } else if (vh.next && toEnd < 10 && !this.clearAt(vh, vh.next, taxi)) { free = Math.min(free, toEnd - 6); byVehicle = true; }
      const vmax = vh.vmax * (vh.road.paved ? 1 : 0.75);
      const target = vh.wait > 0 || vh.flip || free < 1.2 ? 0 : Math.min(vmax, (free - 1.2) * 1.6);
      if (vh.wait > 0) vh.wait -= dt;
      vh.v += Math.max(-7 * dt, Math.min(2.5 * dt, target - vh.v));
      // bouché trop longtemps (par une autre voiture, ou par le joueur arrêté en travers) : demi-tour
      vh.stuck = vh.v < 0.2 && (byVehicle || byTaxi) ? vh.stuck + dt : 0;
      if (vh.stuck > (byTaxi ? 6 : 3.5)) { vh.flip = true; vh.stuck = 0; }
      // le demi-tour : arrêté, il passe dans l'autre voie seulement si sa place y est libre (aucun véhicule, personne, ni le joueur) ; il préfère
      // attendre qu'aucun autre véhicule ne soit tout près (au bout de 8 s, la place libre suffit)
      if (vh.flip) {
        vh.flipT += dt;
        vh.v = Math.max(0, vh.v - 7 * dt);
        const lane = laneOf(vh.road, vh), [fx, fz, fux, fuz] = this.at(vh.road, vh.t), nxp = fx + fuz * lane * vh.dir, nzp = fz - fux * lane * vh.dir;
        const spotFree = !this.vehicles.some(q => q !== vh && q.on && Math.hypot(q.x - nxp, q.z - nzp) < (q.len + vh.len) / 2 + 0.6)
          && Math.hypot(taxi.x - nxp, taxi.z - nzp) > vh.len / 2 + 3 && !this.people.some(p => p.on && Math.hypot(p.x - nxp, p.z - nzp) < vh.len / 2 + 0.8);
        const calm = !this.vehicles.some(q => q !== vh && q.on && Math.hypot(q.x - vh.x, q.z - vh.z) < 11);
        if (vh.v < 0.3 && spotFree && (calm || vh.flipT > 8)) { vh.dir = -vh.dir; vh.off = lane * vh.dir; vh.flip = false; vh.flipT = 0; vh.next = null; vh.wait = 0.5; vh.outT = 0; }
      }
      vh.t += vh.dir * vh.v * dt;
      if (vh.flip || vh.next?.out) vh.t = Math.max(lo, Math.min(hi, vh.t));
      else if (vh.t >= hi && vh.dir > 0) this.roadEnd(vh);
      else if (vh.t <= lo && vh.dir < 0) this.roadEnd(vh);
      if (!vh.on) continue;
      // à droite de la chaussée (il se décale doucement en changeant de sens ou de rue)
      const r = vh.road, lane = laneOf(r, vh), [px, pz, ux, uz] = this.at(r, vh.t);
      const side = 0.45 * vh.v * dt;                                          // (de côté seulement en roulant : arrêtée, une voiture ne glisse pas)
      vh.off += Math.max(-side, Math.min(side, lane * vh.dir - vh.off));
      const ox = vh.x, oz = vh.z;
      vh.x = px - uz * vh.off; vh.z = pz + ux * vh.off;
      // (en tournant ou en faisant demi-tour, sa place saute de quelques mètres : la carrosserie y glisse en une demi-seconde)
      if (Math.hypot(vh.x - ox, vh.z - oz) > Math.max(0.5, vh.v * dt * 3)) { vh.bk = 0.5; vh.rx = ox; vh.rz = oz; }
      if (vh.bk > 0) { const f = Math.min(1, dt / vh.bk); vh.rx += (vh.x - vh.rx) * f; vh.rz += (vh.z - vh.rz) * f; vh.bk -= dt; }
      else { vh.rx = vh.x; vh.rz = vh.z; }
      vh.h += wrapA(Math.atan2(ux * vh.dir, -uz * vh.dir) - vh.h) * Math.min(1, dt * 4);
      place(vh.mesh, vh.rx, vh.rz, vh.h, 0);
    }
  }

  update(dt, taxi, time) {
    this.updateVehicles(dt, taxi);
    if (!this.people.length) return;
    const near = this.paths.filter(p => taxi.x > p.x0 - NEAR && taxi.x < p.x1 + NEAR && taxi.z < p.z0 + NEAR && taxi.z > p.z1 - NEAR);
    if (!near.length) {
      if (this.active) { for (const p of this.people) { p.ch.mesh.visible = false; p.on = false; } this.active = false; }
      return;
    }
    this.active = true;
    const hx = Math.sin(taxi.heading), hz = -Math.cos(taxi.heading), sp = Math.abs(taxi.speed ?? 0);
    for (const p of this.people) {
      if (!p.on || !near.includes(p.path) || Math.hypot(p.x - taxi.x, p.z - taxi.z) > NEAR + 25) this.spawn(p, near, taxi);
      if (!p.on) continue;
      // le véhicule tout près, ou qui arrive sur lui : il s'arrête (et ne repart que quand la voie est libre)
      const ahead = this.at(p.path, p.t + p.dir * 1.6), dx = p.x - taxi.x, dz = p.z - taxi.z, dist = Math.hypot(dx, dz);
      const coming = sp > 0.5 && dist < 9 && (dx * hx + dz * hz) * Math.sign(taxi.speed) > 0 && Math.abs(dx * hz - dz * hx) < 2.4;
      const blocked = dist < 3.2 || Math.hypot(ahead[0] - taxi.x, ahead[1] - taxi.z) < 3.4 || coming
        || this.vehicles.some(v => {                                          // (une moto ou une voiture tout près, ou qui arrive sur lui : il attend)
          if (!v.on) return false;
          const dx = p.x - v.x, dz = p.z - v.z, d = Math.hypot(dx, dz);
          if (d < v.len / 2 + 1.6) return true;
          const hx = Math.sin(v.h), hz = -Math.cos(v.h), f = dx * hx + dz * hz;
          return v.v > 0.5 && d < 11 && f > 0 && Math.abs(dx * hz - dz * hx) < v.half + 1.2;
        });
      if (p.wait > 0) p.wait -= dt;
      else if (!blocked) {
        p.t += p.dir * p.speed * dt;
        if (p.t <= 0 || p.t >= p.path.len) {                                    // (au bout de son bout de rue : demi-tour, parfois une pause)
          p.t = Math.max(0, Math.min(p.path.len, p.t));
          p.dir = -p.dir;
          if (Math.random() < 0.35) p.wait = 1.5 + Math.random() * 4;
        }
      }
      const q = this.at(p.path, p.t), q2 = this.at(p.path, p.t + p.dir * 0.6);
      p.x = q[0]; p.z = q[1];
      const walking = !blocked && p.wait <= 0;
      p.ch.pose(walking ? 'walk' : 'idle', time + p.ph, p.speed);
      place(p.ch.mesh, q[0], q[1], Math.atan2(q2[0] - q[0], -(q2[1] - q[1])), 0);
    }
  }
}
