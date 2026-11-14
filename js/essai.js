// Essai (?essai=policier) : deux policiers côte à côte sur le bas-côté. À gauche, celui dessiné par le code du jeu ; à droite, celui fait à partir du
// corps de MakeHuman (tools/policier_mh.py). Chacun alterne l'attente, le signe de la main et la marche sur place. Ce fichier ne sert qu'à comparer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Character, outfit, poseBones } from './characters.js';

const MODES = ['idle', 'wave', 'walk'];
const modeAt = t => MODES[Math.floor(t / 4) % 3];

export async function start(scene, road, taxi) {
  const gltf = await new GLTFLoader().loadAsync(new URL('../data/personnages/policier_essai.glb', import.meta.url).href);
  const at = (x, z) => road.group.localToWorld(road.RT.worldVec(x, 0, z, new THREE.Vector3()));
  const z = taxi.z - 13, a = at(7, z), b = at(8.6, z), c = at(7, z - 10);
  const face = Math.atan2(-(c.x - a.x), -(c.z - a.z)) + Math.PI + 0.35;     // vers le taxi qui arrive

  const code = new Character(outfit('police', { idle: 0, height: 1 }));
  code.mesh.position.copy(a); code.mesh.rotation.y = face;
  scene.add(code.mesh);

  const man = gltf.scene;
  man.position.copy(b); man.rotation.y = face;
  const bones = {};
  man.traverse(o => {
    if (o.isBone) bones[o.name.replace(/([LR])$/, '.$1')] = o;   // (le chargeur retire le point : upperArm.L → upperArmL)
    if (o.isSkinnedMesh) { o.material = new THREE.MeshLambertMaterial({ vertexColors: true }); o.castShadow = true; o.frustumCulled = false; }
  });
  scene.add(man);
  const o = { idle: 0, stride: 1 };
  window.__essai = { code, man, bones };
  const clock = new THREE.Clock();
  (function loop() {
    const t = clock.getElapsedTime(), m = modeAt(t);
    code.pose(m, t);
    poseBones(bones, m, t, 1.1, o);
    requestAnimationFrame(loop);
  })();
}

/** ?essai=voitures : tous les modèles alignés sur le bas-côté, pour les regarder. */
export async function startCars(scene, road, taxi) {
  const M = await import('./models.js');
  const at = (x, z) => road.group.localToWorld(road.RT.worldVec(x, 0, z, new THREE.Vector3()));
  const z = taxi.z - 13, c0 = at(0, z), c1 = at(0, z - 10), yaw = Math.atan2(-(c1.x - c0.x), -(c1.z - c0.z));
  const make = [() => M.createCar({ color: 0xf5c400, taxi: true }), () => M.createHatchback(), () => M.createCitadine({ color: 0x1f3f9c }), () => M.createCrossover({ color: 0x8a3f1a }), () => M.createYango(), () => M.createSUV(), () => M.createSUV(), () => M.createSUV(), () => M.createMinibus(), () => M.createMinibus({ top: 0x2a86c8, apprenti: false }), () => M.createVan(),
    () => M.createPolicePickup(), () => M.createPoliceVan(), () => M.createAmbulance(), () => M.createEspritDeVie(), () => M.createCityBus(), () => M.createTranscoMidi(), () => M.createTanker(), () => M.createTruck(), () => M.createTricycle(), () => M.createTricycle(), () => M.createMoto()];
  const list = make.map((f, i) => { const m = f(); m.position.copy(at(8 + i * 8, z)); m.rotation.y = yaw + 0.75; scene.add(m); return m; });
  window.__essai = { list, yaw };
}
