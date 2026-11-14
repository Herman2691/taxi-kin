// Vue cabine (l'auteur, 10/11 : « possibilité de voir aussi à l'intérieur du bus ») : l'intérieur du véhicule, vu du fond vers l'avant :
// les bancs, les passagers assis (les clients à bord), le prédicateur debout dans l'allée, le chauffeur, et la route par le pare-brise.
// Le groupe est posé chaque image à la place du véhicule (main.js) et n'est visible que dans cette vue. Coordonnées du véhicule :
// x vers la droite, y vers le haut, z vers l'arrière (l'avant est vers -z, comme les modèles).
import * as THREE from 'three';
import { Builder, VC_MAT } from './models.js';

const GLASS_MAT = new THREE.MeshBasicMaterial({ color: 0xa9c4d8, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false });
const FLOOR = 0x3a3a3c, FRAME = 0x9aa0a6, WALL = 0xd8d4c8, ROOF = 0xe6e2d8, DASH = 0x2b2d31, BLACK = 0x1c1d20;

/** L'intérieur du véhicule `id` ('bus' | 'berline' ; pas de cabine pour la moto). Renvoie { group, seats, driver, stand, eye, look, seatY }. */
export function buildCabin(id) {
  const group = new THREE.Group();
  const b = new Builder(), w = new Builder();
  let seats, driver, stand, eye, look, seatY;
  if (id === 'bus') {
    const VINYL = [0x5a3b2a, 0x24456e];
    b.box(1.96, 0.05, 3.9, FLOOR, 0, 0.42, 0.8).box(1.96, 0.04, 3.9, ROOF, 0, 2.15, 0.8);                      // plancher, plafond
    for (const sx of [-1, 1]) {
      b.box(0.05, 0.78, 3.9, WALL, sx * 0.98, 0.81, 0.8).box(0.05, 0.3, 3.9, WALL, sx * 0.98, 2.0, 0.8);        // panneaux bas et haut
      for (let z = -1.1; z <= 2.75; z += 0.95) b.box(0.06, 0.7, 0.08, FRAME, sx * 0.98, 1.55, z);              // montants
      w.add(new THREE.PlaneGeometry(3.9, 0.7), 0xffffff, sx * 0.98, 1.55, 0.8, 0, Math.PI / 2, 0);              // vitres latérales
    }
    b.box(1.96, 0.78, 0.05, WALL, 0, 0.81, 2.75).box(1.96, 0.3, 0.05, WALL, 0, 2.0, 2.75).box(0.06, 0.7, 0.05, FRAME, 0, 1.55, 2.75);   // portes arrière
    w.add(new THREE.PlaneGeometry(1.9, 0.7), 0xffffff, 0, 1.55, 2.75);                                           // vitres arrière
    // l'avant : tableau de bord, capot moteur entre les sièges, montants du pare-brise (le pare-brise reste ouvert sur la route)
    b.box(2.0, 0.3, 0.5, DASH, 0, 1.0, -2.3).box(0.7, 0.55, 0.9, 0x2b2f36, 0.05, 0.7, -1.55).box(0.08, 1.0, 0.08, 0xf2c200, -0.98, 1.65, -2.45).box(0.08, 1.0, 0.08, 0xf2c200, 0.98, 1.65, -2.45);
    b.box(1.0, 0.03, 0.03, 0x111318, 0, 1.0, -1.85);                                                             // le volant (vu de dos)
    seats = [];
    for (let r = 0; r < 4; r++) {
      const z = 0.05 + r * 0.8, col = VINYL[r % 2];
      for (const [x, wd] of [[-0.46, 0.9], [0.62, 0.46]]) {                                                       // banc de deux à gauche, siège à droite
        b.box(wd, 0.1, 0.44, col, x, 0.86, z).box(wd, 0.5, 0.08, col, x, 1.14, z + 0.24).box(wd, 0.05, 0.44, FRAME, x, 0.72, z);
        for (const dx of [-wd / 2 + 0.05, wd / 2 - 0.05]) b.box(0.04, 0.3, 0.04, FRAME, x + dx, 0.57, z);
      }
      seats.push({ x: -0.68, z }, { x: -0.24, z }, { x: 0.62, z });
    }
    seatY = 0.86 - 0.48;
    driver = { x: -0.6, y: seatY, z: -1.6 };
    stand = { x: 0.3, y: 0.44, z: -0.75 };
    eye = { x: 0.25, y: 1.92, z: 2.55 };
    look = { x: 0, y: 1.02, z: -2.2 };
  } else {
    const SEAT = 0x4a4642;
    b.box(1.7, 0.05, 2.6, FLOOR, 0, 0.35, 0.3).box(1.7, 0.04, 2.3, ROOF, 0, 1.45, 0.25);
    for (const sx of [-1, 1]) {
      b.box(0.05, 0.62, 2.6, 0xd9d2c0, sx * 0.86, 0.66, 0.3).box(0.06, 0.5, 0.1, FRAME, sx * 0.86, 1.2, 0.3).box(0.06, 0.5, 0.1, FRAME, sx * 0.86, 1.2, 1.4);
      w.add(new THREE.PlaneGeometry(2.4, 0.5), 0xffffff, sx * 0.86, 1.2, 0.3, 0, Math.PI / 2, 0);
    }
    b.box(1.7, 0.05, 0.5, 0x2a2a2a, 0, 1.0, 1.55);                                                               // plage arrière
    w.add(new THREE.PlaneGeometry(1.6, 0.45), 0xffffff, 0, 1.22, 1.75, -0.5, 0, 0);                              // lunette arrière
    b.box(1.7, 0.3, 0.5, DASH, 0, 0.95, -0.95).box(0.08, 0.8, 0.08, 0xf5c400, -0.84, 1.1, -0.85).box(0.08, 0.8, 0.08, 0xf5c400, 0.84, 1.1, -0.85);
    for (const sx of [-1, 1]) b.box(0.5, 0.1, 0.5, SEAT, sx * 0.38, 0.52, -0.1).box(0.5, 0.6, 0.1, SEAT, sx * 0.38, 0.85, 0.15).box(0.26, 0.2, 0.1, BLACK, sx * 0.38, 1.22, 0.15);   // sièges avant, appuie-tête
    b.box(1.55, 0.1, 0.5, SEAT, 0, 0.5, 0.8).box(1.55, 0.55, 0.1, SEAT, 0, 0.82, 1.05);                           // banquette arrière
    seats = [{ x: 0.38, z: -0.1 }, { x: -0.55, z: 0.8 }, { x: 0.55, z: 0.8 }, { x: 0, z: 0.8 }, { x: 0.1, z: 0.8 }];
    seatY = 0.52 - 0.48;
    driver = { x: -0.38, y: seatY, z: -0.1 };
    stand = null;
    eye = { x: 0, y: 1.3, z: 1.62 };
    look = { x: 0, y: 0.95, z: -1.3 };
  }
  const shell = b.mesh(VC_MAT), glass = w.mesh(GLASS_MAT);
  for (const m of [shell, glass]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; }
  glass.renderOrder = 3;
  group.add(shell, glass);
  group.visible = false;
  group.rotation.order = 'YXZ';
  return { group, seats, driver, stand, eye, look, seatY };
}
