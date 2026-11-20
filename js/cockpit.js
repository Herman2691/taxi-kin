// Vue intérieure (l'auteur, 08/11) : ce que voit le chauffeur. Le poste de conduite est accroché à la caméra : tableau de bord, volant qui tourne, mains,
// montants du pare-brise, toit, rétroviseur avec son chapelet ; pour le 207, un grand volant presque à plat ; pour la moto, le guidon, le réservoir et
// les rétroviseurs. Coordonnées de la caméra : elle regarde vers -z, y vers le haut ; tout est au-delà de 0,3 m (plan proche de la caméra).
import * as THREE from 'three';
import { Builder, VC_MAT } from './models.js';

const SKIN = 0x5a3a22, SLEEVE = 0xf2f2f2, DASH = 0x2b2d31, DASH2 = 0x3a3d42, ROOF = 0xb9b2a4, BLACK = 0x1c1d20;

/** Le poste de conduite du véhicule `id` ('berline', 'bus', 'moto'). Renvoie { group, wheel, eye } : eye = position de l'œil (m) par rapport au centre du véhicule. */
export function buildCockpit(id) {
  const group = new THREE.Group(), body = new Builder(), wb = new Builder();
  let wheel = new THREE.Group(), eye;
  if (id === 'athlete') {
    eye = { x: 0, y: 1.62, z: -0.12 };
    const spin = new THREE.Group();
    group.add(spin);
    group.visible = false;
    return { group, spin, eye, wipers: null };
  }
  if (id === 'moto') {
    eye = { x: 0, y: 1.5, z: -0.1 };
    body.box(0.36, 0.2, 0.55, 0xb91c1c, 0, -0.78, -0.55)                       // le réservoir
      .box(0.24, 0.16, 0.1, BLACK, 0, -0.42, -0.86)                              // la coque du phare et le compteur
      .cyl(0.07, 0.07, 0.02, 0xe8e8e0, 0, -0.33, -0.84, -1.2, 0, 0, 16);
    wb.box(0.78, 0.03, 0.03, 0x222222, 0, 0, 0)                                  // le guidon
      .box(0.1, 0.035, 0.04, BLACK, 0.36, 0, 0).box(0.1, 0.035, 0.04, BLACK, -0.36, 0, 0)
      .box(0.01, 0.2, 0.01, 0xc9ccd0, 0.32, 0.1, 0.02).box(0.01, 0.2, 0.01, 0xc9ccd0, -0.32, 0.1, 0.02)   // tiges des rétroviseurs
      .add(new THREE.CircleGeometry(0.045, 14), 0x6f7d88, 0.33, 0.22, 0.03).add(new THREE.CircleGeometry(0.045, 14), 0x6f7d88, -0.33, 0.22, 0.03)
      .ball(0.045, SKIN, 0.33, 0.02, 0, 1.3, 0.8, 1).ball(0.045, SKIN, -0.33, 0.02, 0, 1.3, 0.8, 1)            // les mains, et les manches du gilet
      .box(0.08, 0.08, 0.34, 0xd6dc24, 0.36, -0.04, 0.2, 0.5).box(0.08, 0.08, 0.34, 0xd6dc24, -0.36, -0.04, 0.2, 0.5);
    wheel.position.set(0, -0.46, -0.66);
  } else {
    const bus = id === 'bus';
    eye = bus ? { x: -0.55, y: 1.95, z: -1.6 } : { x: -0.38, y: 1.18, z: -0.15 };
    const right = bus ? 1.55 : 0.95;                                              // (le chauffeur est à gauche : le reste de la cabine est à droite)
    body.box(right + 1.0, 0.16, 0.5, DASH, (right - 0.7) / 2, -0.6, -0.95)       // le tableau de bord, bas pour laisser voir la route
      .box(right + 1.0, 0.03, 0.12, DASH2, (right - 0.7) / 2, -0.51, -1.15)
      .box(0.42, 0.07, 0.2, DASH, 0, -0.5, -0.82)                                 // la visière des compteurs
      .cyl(0.05, 0.05, 0.01, 0xd9d6cc, -0.09, -0.52, -0.9, -1.2, 0, 0, 16).cyl(0.05, 0.05, 0.01, 0xd9d6cc, 0.09, -0.52, -0.9, -1.2, 0, 0, 16)
      .box(0.003, 0.04, 0.004, 0xd21f26, -0.09, -0.51, -0.895, -1.2, 0, 0.6).box(0.003, 0.04, 0.004, 0xd21f26, 0.09, -0.51, -0.895, -1.2, 0, -0.4)
      .box(0.3, 0.1, 0.02, 0x0e1014, right * 0.45, -0.55, -0.72)                  // la radio
      .box(0.06, 0.62, 0.08, bus ? 0xf2c200 : 0xf5c400, -0.62, 0.02, -0.9, 0.35, 0, 0.12)   // montant gauche du pare-brise
      .box(0.08, 0.62, 0.08, bus ? 0xf2c200 : 0xf5c400, right + 0.28, 0.02, -1.0, 0.35, 0, -0.12)   // montant droit
      .box(right + 1.5, 0.04, 0.3, ROOF, (right - 0.7) / 2, 0.46, -0.55)         // le toit (ciel de toit)
      .box(right + 1.5, 0.05, 0.05, bus ? 0x2a86c8 : 0xf5c400, (right - 0.7) / 2, 0.43, -0.72)
      .box(0.05, 0.22, 0.9, bus ? 0xf2c200 : 0xf5c400, -0.74, -0.45, -0.45)         // la portière gauche
      .box(0.26, 0.07, 0.03, BLACK, 0.32, 0.22, -0.78).box(0.24, 0.055, 0.01, 0x7f8c97, 0.32, 0.22, -0.765)   // le rétroviseur
      .box(0.01, 0.08, 0.01, BLACK, 0.32, 0.29, -0.79)
      .box(0.006, 0.12, 0.006, 0x8a5a2a, 0.32, 0.12, -0.78).ball(0.018, 0xc8102e, 0.32, 0.05, -0.78);       // le chapelet suspendu
    if (bus) body.box(0.3, 0.5, 0.3, 0x2b2f36, 0.55, -0.55, -0.55).box(1.1, 0.05, 0.3, 0x2b2f36, 0.9, 0.36, -0.25);   // le capot moteur entre les sièges
    const r = bus ? 0.23 : 0.18;
    // le volant (image fondvoiture) : jante bleue à secteurs rouges, branches noires, moyeu vert ; les mains dans des gants noirs sans doigts
    wb.add(new THREE.TorusGeometry(r, 0.026, 10, 32), 0x1f4fb0, 0, 0, 0)
      .add(new THREE.TorusGeometry(r, 0.029, 10, 8, 0.7).rotateZ(Math.PI * 0.5 + 0.25), 0xd62828, 0, 0, 0).add(new THREE.TorusGeometry(r, 0.029, 10, 8, 0.7).rotateZ(Math.PI * 0.5 - 0.95), 0xd62828, 0, 0, 0)
      .box(r * 2, 0.03, 0.02, BLACK, 0, 0, 0).box(0.03, r, 0.02, BLACK, 0, -r / 2, 0)
      .cyl(0.058, 0.058, 0.03, 0x3fae3a, 0, 0, 0.012, Math.PI / 2, 0, 0, 16).cyl(0.026, 0.026, 0.034, 0x1c2a1c, 0, 0, 0.014, Math.PI / 2, 0, 0, 6)
      .add(new THREE.SphereGeometry(0.038, 10, 8).scale(1.15, 1.3, 0.95), 0x17181b, -r * 0.95, 0.02, 0.012).add(new THREE.SphereGeometry(0.038, 10, 8).scale(1.15, 1.3, 0.95), 0x17181b, r * 0.95, 0.02, 0.012)
      .box(0.05, 0.012, 0.02, SKIN, -r * 0.95, 0.065, 0.02).box(0.05, 0.012, 0.02, SKIN, r * 0.95, 0.065, 0.02);                  // le bout des doigts, nu
    body.box(0.07, 0.07, 0.4, SKIN, -0.21, -0.56, -0.42, 0.55, 0.25).box(0.07, 0.07, 0.4, SKIN, 0.21, -0.56, -0.42, 0.55, -0.25)   // les avant-bras nus
      .box(0.085, 0.085, 0.14, SLEEVE, -0.27, -0.55, -0.22, 0.55, 0.25).box(0.085, 0.085, 0.14, SLEEVE, 0.27, -0.55, -0.22, 0.55, -0.25);   // manches courtes
    if (!bus) {
      // le tableau de bord matelassé (losanges), ses pompons blancs au bord du pare-brise, le téléphone de navigation, les trois dés rouges suspendus
      for (let k = -6; k <= 6; k++) {
        body.box(0.004, 0.003, 0.5, 0x3d4046, k * 0.13, -0.515, -0.95, 0, 0.7, 0).box(0.004, 0.003, 0.5, 0x3d4046, k * 0.13, -0.515, -0.95, 0, -0.7, 0);
      }
      for (let x = -0.5; x <= right + 0.3; x += 0.065) body.cyl(0.016, 0.005, 0.045, 0xe9e9e4, x, -0.505, -1.14, 0, 0, 0, 6);
      body.cyl(0.012, 0.012, 0.16, 0x1a1b1e, -0.52, -0.43, -0.78, 0.25, 0, 0, 6)                                                    // le support du téléphone
        .box(0.078, 0.14, 0.012, 0x0b0c0e, -0.52, -0.33, -0.8, 0, 0.18, 0).box(0.066, 0.122, 0.004, 0xe4ece2, -0.52, -0.33, -0.793, 0, 0.18, 0)
        .box(0.012, 0.09, 0.003, 0x2f7bd8, -0.52, -0.33, -0.79, 0, 0.18, 0.4).box(0.03, 0.02, 0.003, 0x4cae4c, -0.53, -0.36, -0.789, 0, 0.18, 0);   // son écran : le trajet
      for (const [i, dx] of [0.1, 0.17, 0.24].entries()) {                                                                            // trois dés rouges
        const dy = 0.14 - i * 0.012;
        body.box(0.002, 0.1 + i * 0.012, 0.002, 0xdedede, 0.32 + dx - 0.1, 0.18 - (0.1 + i * 0.012) / 2 + 0.0, -0.78)
          .box(0.045, 0.045, 0.045, 0xc42222, 0.32 + dx - 0.1, dy - 0.05, -0.78, 0.3 * i, 0.5 + i, 0.2)
          .box(0.012, 0.012, 0.004, 0xf4f4f0, 0.32 + dx - 0.1, dy - 0.05, -0.756, 0.3 * i, 0.5 + i, 0.2).box(0.008, 0.008, 0.004, 0xf4f4f0, 0.32 + dx - 0.1 + 0.014, dy - 0.05 + 0.01, -0.756, 0.3 * i, 0.5 + i, 0.2);
      }
    }
    wheel.position.set(0, bus ? -0.52 : -0.4, bus ? -0.62 : -0.64);
    wheel.rotation.x = bus ? -1.0 : -0.4;
  }
  const b = body.mesh(VC_MAT), w = wb.mesh(VC_MAT);
  for (const m of [b, w]) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 10; m.frustumCulled = false; }
  const spin = new THREE.Group();
  spin.add(w);
  wheel.add(spin);
  group.add(b, wheel);
  // Les essuie-glaces (la pluie, l'auteur 10/11) : deux balais qui pivotent au bas du pare-brise, montrés seulement quand il pleut (main.js)
  let wipers = null;
  if (id !== 'moto') {
    wipers = new THREE.Group();
    for (const [px, len] of [[-0.3, 0.5], [0.3, 0.46]]) {
      const arm = new THREE.Group(), wb2 = new Builder();
      wb2.box(0.025, len, 0.02, 0x15161a, 0, len / 2, 0).box(0.012, len * 0.9, 0.03, 0x2b2d31, 0.02, len / 2, 0.01);
      const m = wb2.mesh(VC_MAT); m.castShadow = m.receiveShadow = false; m.renderOrder = 11; m.frustumCulled = false;
      arm.add(m); arm.position.set(px, -0.46, -1.08); arm.rotation.z = -0.35;
      wipers.add(arm);
    }
    wipers.visible = false;
    group.add(wipers);
  }
  group.visible = false;
  return { group, spin, eye, wipers };
}
