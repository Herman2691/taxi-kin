// Entrées clavier + tactiles réunies dans un même état { steer, throttle, brake, horn }.
const KEYS = {
  left: ['ArrowLeft', 'KeyA'],     // KeyA = touche Q en AZERTY
  right: ['ArrowRight', 'KeyD'],
  gas: ['ArrowUp', 'KeyW'],        // KeyW = touche Z en AZERTY
  brake: ['ArrowDown', 'KeyS'],
  horn: ['Space'],
};
const ACTIONS = { KeyP: 'pause', Escape: 'pause', KeyM: 'mute', KeyC: 'camera' };
const BLOCK = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { gas: false, brake: false, horn: false };
    this.touchSteer = 0;
    this.handlers = {};

    addEventListener('keydown', e => {
      if (BLOCK.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.emit('hornDown');
      if (ACTIONS[e.code]) this.emit(ACTIONS[e.code]);
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.emit('hornUp');
    });
    addEventListener('blur', () => this.releaseAll());
  }

  on(name, fn) { (this.handlers[name] ??= []).push(fn); }
  emit(name) { for (const fn of this.handlers[name] ?? []) fn(); }

  releaseAll() {
    if (this.keys.has('Space') || this.touch.horn) this.emit('hornUp');
    this.keys.clear();
    for (const k in this.touch) this.touch[k] = false;
    this.touchSteer = 0;
    document.querySelectorAll('#touch .on').forEach(el => el.classList.remove('on'));
  }

  /** Branche le volant (glisser d'une flèche à l'autre) et les pédales, en multi-touch. */
  bindTouch() {
    const steer = document.getElementById('steer');
    const pads = [...steer.querySelectorAll('.pad')];
    const fingers = new Map();
    const refresh = () => {
      let s = 0;
      for (const x of fingers.values()) {
        const r = steer.getBoundingClientRect();
        s = x < r.left + r.width / 2 ? -1 : 1;
      }
      this.touchSteer = s;
      pads.forEach(p => p.classList.toggle('on', s !== 0 && +p.dataset.dir === s));
    };
    steer.addEventListener('pointerdown', e => {
      e.preventDefault();
      steer.setPointerCapture(e.pointerId);
      fingers.set(e.pointerId, e.clientX);
      refresh();
    });
    steer.addEventListener('pointermove', e => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, e.clientX);
      refresh();
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      steer.addEventListener(t, e => { fingers.delete(e.pointerId); refresh(); });
    }

    for (const btn of document.querySelectorAll('#pedals [data-act]')) {
      const act = btn.dataset.act;
      const ids = new Set();
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        ids.add(e.pointerId);
        if (!this.touch[act] && act === 'horn') this.emit('hornDown');
        this.touch[act] = true;
        btn.classList.add('on');
        navigator.vibrate?.(10);
      });
      const up = e => {
        ids.delete(e.pointerId);
        if (ids.size || !this.touch[act]) return;
        this.touch[act] = false;
        btn.classList.remove('on');
        if (act === 'horn') this.emit('hornUp');
      };
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(t, up);
    }
    document.getElementById('touch').addEventListener('contextmenu', e => e.preventDefault());
  }

  get state() {
    const has = list => list.some(k => this.keys.has(k));
    const kSteer = (has(KEYS.right) ? 1 : 0) - (has(KEYS.left) ? 1 : 0);
    return {
      steer: kSteer || this.touchSteer,
      throttle: has(KEYS.gas) || this.touch.gas ? 1 : 0,
      brake: has(KEYS.brake) || this.touch.brake ? 1 : 0,
    };
  }
}
