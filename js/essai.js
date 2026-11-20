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

/** ?essai=personnages : tous les modèles en rang sur le bas-côté, chacun dans une pose ; ?cam=face|dos|profil|tete règle la caméra (voir window.__essai). */
export async function startPeople(scene, road, taxi) {
  const at = (x, z) => road.group.localToWorld(road.RT.worldVec(x, 0, z, new THREE.Vector3()));
  const z = taxi.z - 9, c0 = at(0, z), c1 = at(0, z - 10), yaw = Math.atan2(-(c1.x - c0.x), -(c1.z - c0.z));
  const kinds = [['man', {}], ['man', {}], ['woman', {}], ['woman', { dress: false, headwrap: null }], ['student', {}], ['student', {}], ['police', { female: false }], ['police', { female: true }], ['roulage', {}], ['vendor', { basin: 0xd62828 }], ['business', {}], ['traveler', {}]];
  const list = kinds.map(([k, ex], i) => {
    const ch = new Character(outfit(k, ex));
    const p = at(-6.6 + i * 1.2, z);
    ch.mesh.position.copy(p); ch.mesh.rotation.y = yaw + Math.PI;
    scene.add(ch.mesh);
    return ch;
  });
  const P = new URLSearchParams(location.search), cam = P.get('cam') || 'face', who = Number(P.get('who') ?? -1), mode = P.get('pose') || 'idle';
  window.__essai = { list, yaw };
  window.__essaiCam = camera => {
    const sel = who >= 0 ? list[who] : null;
    const base = sel ? sel.mesh.position : at(0, z);
    const f = new THREE.Vector3(Math.sin(yaw + Math.PI), 0, Math.cos(yaw + Math.PI)), r = new THREE.Vector3(f.z, 0, -f.x);
    const d = cam === 'tete' ? 0.9 : sel ? 3 : 9.5;
    const h = cam === 'tete' ? 1.55 : sel ? 1.1 : 1.3;
    const side = cam === 'profil' ? r.clone().multiplyScalar(d) : cam === 'dos' ? f.clone().multiplyScalar(-d) : f.clone().multiplyScalar(d);
    camera.position.copy(base).add(side); camera.position.y += h;
    camera.lookAt(base.x, base.y + (cam === 'tete' ? 1.55 : 0.95), base.z);
  };
  const clock = new THREE.Clock();
  (function loop() {
    const t = clock.getElapsedTime();
    list.forEach((ch, i) => ch.pose(mode, t + i, 1.1));
    requestAnimationFrame(loop);
  })();
}
