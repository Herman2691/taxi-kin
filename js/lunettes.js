// Mode VR / Lunettes (téléphone dans un casque VR type Cardboard / VR Box).
// Projection VR PARALLÈLE : deux caméras rigoureusement parallèles, centrées sur la vraie distance entre les lentilles
// (calée sur la hauteur de l'écran, réglable en direct avec le calibrage) ; profondeur 3D à 0 par défaut (même direction
// dans les deux yeux, zéro dédoublement du boulevard) et réglable si souhaité ; recentrage horizontal uniquement.
import * as THREE from 'three';

const CRUISE = 9;                                  // m/s (~32 km/h) : vitesse de croisière en conduite à la tête
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const ZEE = new THREE.Vector3(0, 0, 1);
const Q0 = new THREE.Quaternion();
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const EUL = new THREE.Euler();
const TMP_V = new THREE.Vector3();
const EYE_L_M = new THREE.Matrix4();
const EYE_R_M = new THREE.Matrix4();
const _SIZE = new THREE.Vector2();
const _PREV_COL = new THREE.Color();

const storeGet = (k, def) => {
  try { const v = localStorage.getItem(`taxikin.vr.${k}`); return v === null ? def : Number(v); } catch { return def; }
};
const storeSet = (k, v) => { try { localStorage.setItem(`taxikin.vr.${k}`, String(v)); } catch { /* navigation privée */ } };

export class Lunettes {
  constructor(renderer) {
    this.renderer = renderer;
    this.on = false;
    this.calibrating = false;

    // Deux caméras parallèles (une par œil) — zéro convergence forcée à l'infini
    this.camL = new THREE.PerspectiveCamera(80, 1, 0.15, 3600);
    this.camR = new THREE.PerspectiveCamera(80, 1, 0.15, 3600);
    this.camL.matrixAutoUpdate = false;
    this.camR.matrixAutoUpdate = false;

    // Réglages optiques sauvegardés : écartement centré sur les lentilles (~63 mm), 3D à 0 par défaut (zéro croisement)
    this.ipdScale = Math.max(0.65, Math.min(1.25, storeGet('ipdScale', 0.92)));
    this.zoom = Math.max(0.68, Math.min(1.0, storeGet('zoom', 0.9)));
    this.eyeSep = Math.max(0, Math.min(0.07, storeGet('eyeSep', 0)));
    this.fov = Math.max(65, Math.min(95, storeGet('fov', 80)));

    this.head = new THREE.Quaternion();
    this.baseInv = new THREE.Quaternion();
    this.relQ = null;
    this.rel = new THREE.Euler(0, 0, 0, 'YXZ');
    this.yaw0 = null;
    this.has = false;
    this.stopped = false;
    this.onExit = null;
    this.onRecenter = null;
    this.onLayout = null;
    this._padPrev = {};

    this.onOrient = e => {
      if (e.alpha === null) return;
      const orient = THREE.MathUtils.degToRad(screen.orientation?.angle ?? window.orientation ?? 0);
      EUL.set(THREE.MathUtils.degToRad(e.beta), THREE.MathUtils.degToRad(e.alpha), -THREE.MathUtils.degToRad(e.gamma), 'YXZ');
      this.head.setFromEuler(EUL).multiply(Q1).multiply(Q0.setFromAxisAngle(ZEE, -orient));
      // Recentrage HORIZONTAL uniquement : seul le cap (yaw autour de Y) est remis à zéro, pour que l'horizon reste toujours droit !
      if (this.yaw0 === null) {
        TMP_V.copy(FWD).applyQuaternion(this.head);
        this.yaw0 = Math.atan2(-TMP_V.x, -TMP_V.z);
        this.baseInv.setFromAxisAngle(UP, -this.yaw0);
        this.relQ = null;
      }
      const q = this.baseInv.clone().multiply(this.head);
      if (!this.relQ) this.relQ = q;
      else this.relQ.slerp(q, q.angleTo(this.relQ) > 0.22 ? 0.55 : 0.28);
      this.rel.setFromQuaternion(this.relQ, 'YXZ');
      this.has = true;
    };

    let downT = 0, lastTap = 0, timer = null;
    this.onDown = e => {
      if (this.calibrating || e.target?.closest?.('#vr-cal')) return;
      downT = performance.now();
      timer = setTimeout(() => { timer = null; this.disable(); this.onExit?.(); }, 1800);
    };
    this.onUp = e => {
      if (this.calibrating || e.target?.closest?.('#vr-cal')) return;
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      const now = performance.now();
      if (now - downT < 550) {
        if (now - lastTap < 360) {
          this.recenter();
          this.onRecenter?.();
          lastTap = 0;
        } else {
          lastTap = now;
          this.stopped = !this.stopped;
        }
      }
    };
  }

  /** Calcule les deux fenêtres d'œil (x, y, w, h, cx) centrées sur la vraie distance entre les lentilles. */
  layout(W = innerWidth, H = innerHeight) {
    const eyeDist = Math.max(W * 0.24, Math.min(W * 0.5, H * this.ipdScale));
    const cxL = W * 0.5 - eyeDist * 0.5;
    const cxR = W * 0.5 + eyeDist * 0.5;
    const maxW = Math.max(60, Math.min(eyeDist, W - eyeDist));
    const w = Math.floor(maxW * this.zoom);
    const h = Math.floor(Math.min(H, w * 1.18) * this.zoom);
    const y = Math.floor((H - h) * 0.5);
    const xL = Math.floor(cxL - w * 0.5);
    const xR = Math.floor(cxR - w * 0.5);
    return { W, H, eyeDist, cxL, cxR, xL, xR, y, w, h };
  }

  setSetting(key, val) {
    if (key === 'ipdScale') this.ipdScale = Math.max(0.65, Math.min(1.25, val));
    else if (key === 'zoom') this.zoom = Math.max(0.68, Math.min(1.0, val));
    else if (key === 'eyeSep') this.eyeSep = Math.max(0, Math.min(0.07, val));
    else if (key === 'fov') this.fov = Math.max(65, Math.min(95, val));
    storeSet(key, this[key]);
    this.onLayout?.(this.layout());
  }

  /** Demande les capteurs (iOS/Android), plein écran + paysage, et active le rendu stéréo parallèle. */
  async enable({ calibrating = false } = {}) {
    try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch { /* refusé */ }
    try { await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); } catch { /* pas toujours permis */ }
    if (!this.on) {
      addEventListener('deviceorientation', this.onOrient);
      addEventListener('pointerdown', this.onDown);
      addEventListener('pointerup', this.onUp);
    }
    this.on = true;
    this.calibrating = calibrating;
    this.yaw0 = null;
    this.stopped = false;
    document.body.classList.add('vr');
    document.body.classList.toggle('vr-cal', calibrating);
    this.onLayout?.(this.layout());
  }

  setCalibrating(flag) {
    this.calibrating = flag;
    document.body.classList.toggle('vr-cal', flag);
    if (!flag) this.recenter();
    this.onLayout?.(this.layout());
  }

  disable() {
    removeEventListener('deviceorientation', this.onOrient);
    removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointerup', this.onUp);
    this.on = false;
    this.calibrating = false;
    document.body.classList.remove('vr', 'vr-cal');
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, innerWidth, innerHeight);
  }

  recenter() { this.yaw0 = null; }

  /** Applique la rotation de la tête à la caméra (enfant du repère véhicule camRig). */
  applyHead(camera) {
    if (this.has && this.relQ) camera.quaternion.copy(this.relQ);
    else camera.quaternion.identity();
  }

  /** Commandes : manette Bluetooth si présente, sinon conduite à la tête. */
  input(speed) {
    const pad = navigator.getGamepads?.().find(p => p && p.connected);
    if (pad) {
      const ax = Math.abs(pad.axes[0]) > 0.14 ? pad.axes[0] : 0;
      const throttle = (pad.buttons[7]?.value ?? 0) > 0.15 ? pad.buttons[7].value : (pad.buttons[0]?.pressed ? 1 : 0);
      const brake = (pad.buttons[6]?.value ?? 0) > 0.15 ? pad.buttons[6].value : (pad.buttons[1]?.pressed ? 1 : 0);
      const horn = !!pad.buttons[2]?.pressed;
      const rec = !!pad.buttons[3]?.pressed;
      if (rec && !this._padPrev.rec) { this.recenter(); this.onRecenter?.(); }
      this._padPrev.rec = rec;
      return { steer: ax, throttle, brake, horn };
    }
    const roll = this.has ? this.rel.z : 0, pitch = this.has ? this.rel.x : 0;
    const steer = Math.abs(roll) < 0.08 ? 0 : Math.max(-1, Math.min(1, -(roll - Math.sign(roll) * 0.08) / 0.34));
    const wantStop = this.calibrating || this.stopped || pitch < -0.45;
    const brake = wantStop && speed > 0.3 ? 1 : 0;
    return { steer, throttle: !wantStop && speed < CRUISE ? 1 : 0, brake, horn: false };
  }

  setSize(w, h) {
    this.onLayout?.(this.layout(w, h));
  }

  /** Rendu stéréo VR PARALLÈLE : deux caméras rigoureusement parallèles, centrées sur les lentilles du casque. */
  render(scene, camera) {
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld();

    const r = this.renderer;
    r.getSize(_SIZE);
    const L = this.layout(_SIZE.width, _SIZE.height);
    const aspect = L.w / Math.max(1, L.h);

    if (this.camL.fov !== this.fov || Math.abs(this.camL.aspect - aspect) > 1e-4 || this.camL.near !== camera.near || this.camL.far !== camera.far) {
      this.camL.fov = this.camR.fov = this.fov;
      this.camL.aspect = this.camR.aspect = aspect;
      this.camL.near = this.camR.near = camera.near;
      this.camL.far = this.camR.far = camera.far;
      this.camL.updateProjectionMatrix();
      this.camR.updateProjectionMatrix();
    }

    const half = this.eyeSep * 0.5;
    EYE_L_M.makeTranslation(-half, 0, 0);
    EYE_R_M.makeTranslation(half, 0, 0);
    this.camL.matrixWorld.copy(camera.matrixWorld).multiply(EYE_L_M);
    this.camR.matrixWorld.copy(camera.matrixWorld).multiply(EYE_R_M);
    this.camL.matrixWorldInverse.copy(this.camL.matrixWorld).invert();
    this.camR.matrixWorldInverse.copy(this.camR.matrixWorld).invert();

    const prevClear = r.autoClear;
    r.getClearColor(_PREV_COL);
    const prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.setScissorTest(false);
    r.setViewport(0, 0, _SIZE.width, _SIZE.height);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.setClearColor(_PREV_COL, prevAlpha);

    r.setScissorTest(true);
    r.autoClear = true;
    r.setScissor(L.xL, L.y, L.w, L.h);
    r.setViewport(L.xL, L.y, L.w, L.h);
    r.render(scene, this.camL);

    r.setScissor(L.xR, L.y, L.w, L.h);
    r.setViewport(L.xR, L.y, L.w, L.h);
    r.render(scene, this.camR);

    r.setScissorTest(false);
    r.autoClear = prevClear;
  }
}
