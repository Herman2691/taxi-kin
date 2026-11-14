// La pluie (l'auteur, 10/11 : « prévoir aussi la pluie ») : des averses dans la journée. Un nuage de gouttes qui tombent autour de la caméra,
// le ciel et la lumière qui s'assombrissent, la route mouillée (tout est plus sombre et plus bleu), le bruit de la pluie, les essuie-glaces en
// vue intérieure (cockpit.js), et la voiture qui tient moins bien la route (main.js : direction et freinage). Léger pour le téléphone :
// un seul nuage de points, pas de vraie lumière.
import * as THREE from 'three';

const N = 1400, BOX = { w: 36, h: 22, d: 36 };
let DROP_TEX = null;
function dropTexture() {
  if (DROP_TEX) return DROP_TEX;
  const c = document.createElement('canvas');
  c.width = 6; c.height = 48;
  const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 48);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(2, 0, 2, 48);
  DROP_TEX = new THREE.CanvasTexture(c);
  DROP_TEX.colorSpace = THREE.SRGBColorSpace;
  return DROP_TEX;
}

export class Rain {
  constructor(scene) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * BOX.w; pos[i * 3 + 1] = Math.random() * BOX.h; pos[i * 3 + 2] = (Math.random() - 0.5) * BOX.d; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.26, map: dropTexture(), color: 0xdfe8f0, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, sizeAttenuation: true });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
    this.k = 0;                                    // 0 : sec, 1 : grosse averse
    this.plan = null;                              // { start, dur } en secondes de jeu : l'averse du jour
    this.wet = 0;                                  // la route reste mouillée un moment après
  }
  /** Prévoit (ou non) une averse pour la journée : t0 et durée en secondes de jeu. */
  planDay(shiftSeconds) {
    this.k = 0; this.wet = 0; this.points.visible = false;
    this.plan = Math.random() < 0.4 ? { start: 60 + Math.random() * shiftSeconds * 0.7, dur: 150 + Math.random() * 150 } : null;
  }
  /** Force une averse maintenant (tests, ou ?pluie=1), pour dur s. */
  startNow(dur = 200) { this.plan = { start: 0, dur }; this.t0 = null; }
  /** Intensité voulue au temps t (montée et descente en 40 s). */
  wantAt(t) {
    const P = this.plan;
    if (!P) return 0;
    const u = t - P.start;
    if (u < 0 || u > P.dur) return 0;
    return Math.min(1, u / 40, (P.dur - u) / 40);
  }
  /** Chaque image : les gouttes tombent autour de la caméra (cam : position monde). k suit l'intensité voulue. */
  update(dt, t, cam) {
    const want = this.wantAt(t);
    this.k += (want - this.k) * Math.min(1, dt * 0.5);
    if (this.k < 0.01 && want === 0) { this.k = 0; this.points.visible = false; }
    this.wet = Math.max(this.k, this.wet - dt / 240);          // (la route sèche en quatre minutes)
    if (this.k <= 0) return;
    this.points.visible = true;
    this.mat.opacity = 0.42 * this.k;
    const a = this.points.geometry.attributes.position, p = a.array, fall = (14 + 6 * this.k) * dt;
    for (let i = 0; i < N; i++) {
      let y = p[i * 3 + 1] - fall;
      if (y < 0) { y += BOX.h; p[i * 3] = (Math.random() - 0.5) * BOX.w; p[i * 3 + 2] = (Math.random() - 0.5) * BOX.d; }
      p[i * 3 + 1] = y;
    }
    a.needsUpdate = true;
    this.points.position.set(cam.x, cam.y - 4, cam.z);
  }
  get raining() { return this.k > 0.05; }
}
