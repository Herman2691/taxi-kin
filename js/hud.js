// Interface en course : caisse, heure, essence, trajet, course en cours, messages.
import { GOALS_LEN, GOALS, FUELS } from './world.js';

const $ = id => document.getElementById(id);
export const fmtFC = n => `${Math.round(n).toLocaleString('fr-FR')} FC`;
const pct = z => `${Math.min(100, Math.max(0, -z / GOALS_LEN * 100))}%`;

export class Hud {
  constructor() {
    this.el = {
      money: $('money'), clock: $('clock'), fuel: $('fuel'), speed: $('speed'),
      course: $('course'), who: $('course-who'), time: $('course-time'), dest: $('course-dest'),
      comfort: $('comfort'), prompt: $('prompt'), toast: $('toast'), track: $('track'),
    };
    this.cache = {};
    this.toastTime = 0;

    // Tous les messages dans une colonne à droite : le milieu de la route reste dégagé (surtout sur téléphone)
    const col = document.createElement('div');
    col.id = 'side-msgs';
    for (const id of ['prompt', 'bubbles', 'choice', 'toast', 'btn-flee', 'btn-descendre']) { const n = $(id); if (n) col.append(n); }
    $('hud')?.append(col);

    const track = this.el.track;
    let labels = 0;
    for (const lm of GOALS) {
      const t = document.createElement('div');
      // une étiquette sur deux au-dessus de la barre, pour qu'elles ne se chevauchent pas
      t.className = !lm.minor && labels++ % 2 ? 'tick alt' : 'tick';
      t.style.left = pct(lm.z);
      if (!lm.minor) t.innerHTML = `<span>${lm.short}</span>`;
      track.append(t);
    }
    for (const st of FUELS) {
      const s = document.createElement('div');
      s.className = 'station';
      s.style.left = pct(st.z);
      s.textContent = '⛽';
      track.append(s);
    }
    this.flag = document.createElement('div');
    this.flag.className = 'flag';
    this.taxiDot = document.createElement('div');
    this.taxiDot.className = 'dot taxi';
    track.append(this.flag, this.taxiDot);
    this.clientDots = [];
  }

  setClients(clients) {
    this.clientDots.forEach(d => d.remove());
    this.clientDots = clients.map(c => {
      const d = document.createElement('div');
      d.className = c.side < 0 ? 'dot client back' : 'dot client';   // (back : chaussée de gauche, vers le début du trajet)
      d.style.left = pct(c.z);
      this.el.track.insertBefore(d, this.flag);
      return d;
    });
  }

  text(key, el, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el.textContent = value;
  }

  update(dt, g, taxi, passengers) {
    const e = this.el;
    this.text('money', e.money, fmtFC(g.cash));
    const mins = Math.floor(g.minutes) % 1440;      // (le jeu continue la nuit : après minuit, 00:00)
    this.text('clock', e.clock, `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);
    this.text('speed', e.speed, String(Math.round(Math.abs(taxi.speed) * 3.6)));
    e.fuel.style.width = `${g.fuel}%`;
    e.fuel.classList.toggle('low', g.fuel < 20);
    this.taxiDot.style.left = pct(taxi.z);

    passengers.clients.forEach((c, i) => { if (this.clientDots[i]) this.clientDots[i].hidden = c.state !== 'waiting'; });

    if (g.race) {                                    // course : position, chrono, distance restante
      const R = g.race;
      e.course.hidden = false;
      this.flag.hidden = true;
      this.text('who', e.who, R.t < 0 ? 'Départ…' : `🏁 Position ${R.pos}/${R.total}`);
      const t = Math.max(0, R.t);
      this.text('time', e.time, `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
      e.time.classList.toggle('late', false);
      this.text('dest', e.dest, `→ ${R.to} · ${(R.left / 1000).toFixed(1).replace('.', ',')} km`);
      e.comfort.style.width = `${Math.round(R.progress * 100)}%`;
      if (this.cache.lbl !== 'Course') { this.cache.lbl = 'Course'; const l = $('comfort-label'); if (l) l.textContent = 'Course'; }
    } else {
    if (this.cache.lbl !== 'Confort') { this.cache.lbl = 'Confort'; const l = $('comfort-label'); if (l) l.textContent = 'Confort'; }
    // taxi collectif : places, prochain client à déposer sur cette route (ou le terminus), confort
    const B = passengers.board, n = B.riders.length;
    e.course.hidden = !n && B.cap <= 1;
    const next = B.riders.filter(r => r.road === passengers && r.destZ !== null).sort((a, b) => Math.abs(a.destZ - taxi.z) - Math.abs(b.destZ - taxi.z))[0];
    this.flag.hidden = !next;
    this.text('who', e.who, `👥 ${n}/${B.cap}${B.extra ? ' +1' : ''}`);
    this.text('time', e.time, n ? fmtFC(B.riders.reduce((a, r) => a + r.price, 0)) : 'Libre');
    e.time.classList.toggle('late', !!B.extra);
    if (next) {
      this.flag.style.left = pct(next.destZ);
      this.text('dest', e.dest, `→ ${next.destName} · ${Math.round(Math.abs(taxi.z - next.destZ))} m`);
    } else this.text('dest', e.dest, n ? `→ ${g.terminus ?? 'Terminus'}` : 'Prends des clients aux arrêts');
    e.comfort.style.width = `${B.comfort}%`;
    }

    const prompt = g.prompt;
    e.prompt.hidden = !prompt;
    if (prompt) this.text('prompt', e.prompt, prompt);

    if (this.toastTime > 0) {
      this.toastTime -= dt;
      if (this.toastTime <= 0) e.toast.classList.remove('show');
    }
  }

  // Message discret (lieu, chanson, météo) : petit, bref, jamais par-dessus un vrai message.
  note(msg, dur = 2) {
    if (this.toastTime > 0) return;
    this.el.toast.classList.add('note');
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this.toastTime = Math.min(dur, 2);
  }

  toast(msg, dur = 2.8) {
    this.el.toast.classList.remove('note');
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    this.toastTime = dur;
  }

  hideToast() {
    this.toastTime = 0;
    this.el.toast.classList.remove('show');
  }
}
