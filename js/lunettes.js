// Mode lunettes (l'auteur, 08/11 : des lunettes où l'on glisse le téléphone) : l'image est dessinée deux fois, une pour chaque œil, et la tête regarde
// autour d'elle grâce aux capteurs du téléphone. Comme on ne peut plus toucher l'écran dans les lunettes, la conduite se fait avec la tête :
// pencher la tête à gauche ou à droite pour tourner, le véhicule avance seul à vitesse de ville, regarder vers le bas pour freiner ; une touche sur
// l'écran (le bouton des lunettes) arrête le véhicule ou le fait repartir, un appui long (2 s) quitte le mode. Une manette Bluetooth marche aussi.
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';

const SEP_DEFAULT = 0, SEP_MAX = 0.08, SEP_STEP = 0.005;   // écart des yeux en m (0 à 8 cm, par pas de 0,5 cm)
const CRUISE = 9;                                  // m/s (environ 32 km/h) : la vitesse où le véhicule avance seul
const zee = new THREE.Vector3(0, 0, 1), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), eul = new THREE.Euler();

export class Lunettes {
  constructor(renderer) {
    this.renderer = renderer;
    this.on = false;
    this.stereo = new StereoEffect(renderer);
    // Écart entre les deux images (relief), réglé par le joueur : les lunettes de téléphone n'ont pas de réglage d'écartement, et un mauvais écart
    // donne deux routes qui se croisent. 0 = même image dans les deux yeux (aucun relief, aucune vision double).
    this.sep = SEP_DEFAULT;
    try { const v = parseFloat(localStorage.getItem('taxikin_eyesep')); if (Number.isFinite(v)) this.sep = Math.min(SEP_MAX, Math.max(0, v)); } catch { /* stockage indisponible */ }
    this.stereo.setEyeSeparation(this.sep);
    this.padT = 0;
    this.buildSetting();
    this.head = new THREE.Quaternion();
    this.rel = new THREE.Euler(0, 0, 0, 'YXZ');
    this.yaw0 = null;
    this.has = false;                              // (des mesures des capteurs sont arrivées)
    this.stopped = false;
    this.onExit = null;
    this.onOrient = e => {
      if (e.alpha === null) return;
      const orient = THREE.MathUtils.degToRad(screen.orientation?.angle ?? window.orientation ?? 0);
      eul.set(THREE.MathUtils.degToRad(e.beta), THREE.MathUtils.degToRad(e.alpha), -THREE.MathUtils.degToRad(e.gamma), 'YXZ');
      this.head.setFromEuler(eul).multiply(q1).multiply(q0.setFromAxisAngle(zee, -orient));
      // la position de la tête au départ devient « droit devant » : on mesure ensuite les mouvements par rapport à elle
      if (this.yaw0 === null) { this.base = this.head.clone(); this.yaw0 = 0; this.relQ = null; }
      // (les capteurs du téléphone tremblent un peu : on lisse, sinon l'image vibre, surtout au loin)
      const q = this.base.clone().invert().multiply(this.head);
      if (!this.relQ) this.relQ = q; else this.relQ.slerp(q, q.angleTo(this.relQ) > 0.2 ? 0.6 : 0.25);
      this.rel.setFromQuaternion(this.relQ, 'YXZ');
      this.has = true;
    };
    let downT = 0, timer = null;
    this.onDown = () => { downT = performance.now(); timer = setTimeout(() => { timer = null; this.disable(); this.onExit?.(); }, 2000); };
    this.onUp = () => { if (!timer) return; clearTimeout(timer); timer = null; if (performance.now() - downT < 600) this.stopped = !this.stopped; };
  }

  /** Règle l'écart des yeux (relief) et le retient pour les prochaines parties. */
  setSep(v) {
    this.sep = Math.round(Math.min(SEP_MAX, Math.max(0, v)) * 1000) / 1000;
    this.stereo.setEyeSeparation(this.sep);
    try { localStorage.setItem('taxikin_eyesep', String(this.sep)); } catch { /* stockage indisponible */ }
    if (this.label) this.label.textContent = `${(this.sep * 100).toFixed(1).replace('.', ',')} cm`;
  }
  /** Le réglage dans le menu, à côté du bouton des lunettes : − / + , et la valeur. */
  buildSetting() {
    const btn = document.getElementById('btn-vr');
    if (!btn || document.getElementById('vr-sep')) return;
    const box = document.createElement('div');
    box.id = 'vr-sep';
    box.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13px;flex-wrap:wrap';
    const mk = (t, d) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-label', d > 0 ? 'Plus de relief' : 'Moins de relief');
      b.style.cssText = 'min-width:44px;height:38px;border:0;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;font-size:20px;font-weight:800';
      b.addEventListener('click', () => this.setSep(this.sep + d * SEP_STEP)); return b; };
    const txt = document.createElement('span');
    txt.textContent = 'Lunettes : relief (écart des yeux)';
    this.label = document.createElement('b');
    this.label.style.minWidth = '56px'; this.label.style.textAlign = 'center';
    box.append(txt, mk('−', -1), this.label, mk('+', 1));
    btn.after(box);
    this.setSep(this.sep);
  }

  /** Démande l'accès aux capteurs (iPhone), passe en plein écran et en paysage. À appeler après un geste du joueur. */
  async enable() {
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch { /* refusé : on regarde droit devant */ }
    try { await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); } catch { /* pas toujours permis */ }
    addEventListener('deviceorientation', this.onOrient);
    addEventListener('pointerdown', this.onDown);
    addEventListener('pointerup', this.onUp);
    this.on = true;
    this.yaw0 = null;
    this.stopped = false;
    document.body.classList.add('vr');
  }
  disable() {
    removeEventListener('deviceorientation', this.onOrient);
    removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointerup', this.onUp);
    this.on = false;
    document.body.classList.remove('vr');
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
  /** Regarder droit devant à nouveau (la position actuelle de la tête devient « devant »). */
  recenter() { this.yaw0 = null; }

  /** Après le placement de la caméra (elle regarde la route) : on y ajoute les mouvements de la tête. */
  applyHead(camera) { if (this.has && this.relQ) camera.quaternion.multiply(this.relQ); }

  /** Les commandes : manette s'il y en a une, sinon la tête. speed : vitesse actuelle (m/s). */
  input(speed) {
    const pad = navigator.getGamepads?.().find(p => p && p.connected);
    if (pad) {
      const now = performance.now();       // (croix directionnelle gauche / droite : moins / plus de relief, 4 pas par seconde au plus)
      if (now - this.padT > 250 && (pad.buttons[14]?.pressed || pad.buttons[15]?.pressed)) { this.padT = now; this.setSep(this.sep + (pad.buttons[15]?.pressed ? SEP_STEP : -SEP_STEP)); }
      const ax = Math.abs(pad.axes[0]) > 0.15 ? pad.axes[0] : 0;
      return { steer: ax, throttle: (pad.buttons[7]?.value ?? 0) > 0.2 || pad.buttons[0]?.pressed ? 1 : 0, brake: (pad.buttons[6]?.value ?? 0) > 0.2 || pad.buttons[1]?.pressed ? 1 : 0 };
    }
    const roll = this.has ? this.rel.z : 0, pitch = this.has ? this.rel.x : 0;
    const steer = Math.abs(roll) < 0.08 ? 0 : Math.max(-1, Math.min(1, -(roll - Math.sign(roll) * 0.08) / 0.32));
    const want = this.stopped || pitch < -0.5, brake = want && speed > 0.3 ? 1 : 0;   // (arrêté : on freine jusqu'à l'arrêt, sans repartir en arrière)
    return { steer, throttle: !want && speed < CRUISE ? 1 : 0, brake };
  }

  setSize(w, h) { this.stereo.setSize(w, h); }
  render(scene, camera) { camera.focus = 6; this.stereo.render(scene, camera); }   // (profondeur où les deux images se superposent)
}
