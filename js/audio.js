// Sons synthétisés avec Web Audio : moteur, klaxon, bruitages. Aucun fichier à télécharger.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.osc1.connect(filter); this.osc2.connect(filter);
    filter.connect(this.engineGain).connect(this.master);
    this.osc1.start(); this.osc2.start();

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  /** Le brouhaha de la ville (0 : calme, 1 : la foule de Masina) : un bruit filtré qui tourne en boucle. */
  ambience(level) {
    if (!this.ctx) return;
    if (!this.ambGain) {
      const ctx = this.ctx, buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < d.length; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = v * 6 + (Math.random() * 2 - 1) * 0.15; }   // (grave et irrégulier, comme des voix au loin)
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 0.5;
      this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0;
      src.connect(f).connect(this.ambGain).connect(this.master); src.start();
    }
    this.ambGain.gain.setTargetAtTime(0.02 + level * 0.09, this.ctx.currentTime, 0.6);
  }

  /** Le bruit de la pluie (pluie.js) : level 0 (rien) à 1 (grosse averse). */
  rain(level) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const ctx = this.ctx, buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
      src.connect(f).connect(this.rainGain).connect(this.master); src.start();
    }
    this.rainGain.gain.setTargetAtTime(level * 0.14, this.ctx.currentTime, 0.8);
  }

  /** Un klaxon au loin, d'un côté ou de l'autre. */
  hornFar(vol = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null, lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1600;
    const n = 1 + Math.floor(Math.random() * 3), base = 300 + Math.random() * 180, dur = 0.12 + Math.random() * 0.25;
    g.gain.value = 0;
    for (let k = 0; k < n; k++) { g.gain.setValueAtTime(vol, t + k * (dur + 0.08)); g.gain.setValueAtTime(0, t + k * (dur + 0.08) + dur); }
    for (const f of [base, base * 1.26]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + n * (dur + 0.08) + 0.05); }
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; lp.connect(g).connect(pan).connect(this.master); } else lp.connect(g).connect(this.master);
  }

  /** Une voix (synthèse vocale du navigateur, en français) : le receveur, les vendeurs, la police. Une seule à la fois. */
  voice(text, { pitch = 1, rate = 1.05, vol = 0.9 } = {}) {
    const S = window.speechSynthesis;
    if (!S || this.muted || S.speaking || this.clipPlaying) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; u.pitch = pitch; u.rate = rate; u.volume = vol;
    this.frVoice ??= S.getVoices().find(v => /^fr/i.test(v.lang)) ?? null;
    if (this.frVoice) u.voice = this.frVoice;
    S.speak(u);
  }

  // ---------- Les voix enregistrées par l'auteur (data/voix, 08/11) : receveur, clients, vendeurs ; une seule à la fois ----------
  /** Charge les voix (après le premier geste du joueur : l'AudioContext existe). */
  preload(names) { for (const n of names) this.loadClip(n); }
  loadClip(name) {
    if (!this.ctx) return;
    this.clipBuf ??= {}; this.clipLoading ??= {};
    if (this.clipBuf[name] || this.clipLoading[name]) return;
    this.clipLoading[name] = true;
    fetch(new URL(`../data/voix/${name}.mp3`, import.meta.url)).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then(a => this.ctx.decodeAudioData(a)).then(b => { this.clipBuf[name] = b; }).catch(() => { /* (fichier absent : la voix de synthèse prend le relais) */ });
  }
  /** Une voix est-elle en train de parler ? */
  get clipPlaying() { return !!this.ctx && this.ctx.currentTime < (this.clipUntil ?? 0); }
  /** Joue une voix enregistrée ; renvoie sa durée (s), ou 0 si elle n'est pas prête ou si une autre parle déjà. */
  clip(name, { vol = 1, pan = 0 } = {}) {
    if (!this.ctx || this.muted || this.clipPlaying) return 0;
    const buf = this.clipBuf?.[name];
    if (!buf) { this.loadClip(name); return 0; }
    window.speechSynthesis?.cancel();
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain(), p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    src.buffer = buf; g.gain.value = vol;
    if (p) { p.pan.value = pan; src.connect(g).connect(p).connect(this.master); } else src.connect(g).connect(this.master);
    src.start();
    this.clipSrc = src;
    this.clipUntil = this.ctx.currentTime + buf.duration;
    return buf.duration;
  }
  stopClip() { try { this.clipSrc?.stop(); } catch { /* (déjà finie) */ } this.clipSrc = null; this.clipUntil = 0; }

  setMuted(m) {
    this.muted = m;
    if (m) this.stopClip();
    if (m) window.speechSynthesis?.cancel();
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
    if (this.speech) this.speech.volume = m ? 0 : (this.speechVol ?? 1);
  }

  // ---------- Longs enregistrements (les prédications dans le bus, l'auteur 10/11) : lus en continu par un élément audio, sans les décoder en mémoire ----------
  /** Joue data/voix/`file` (nom avec son extension) ; onEnd à la fin (ou si la lecture est impossible). */
  speak(file, { vol = 1, onEnd = null } = {}) {
    this.stopSpeech();
    const el = this.speech ??= new Audio();
    el.src = new URL(`../data/voix/${file}`, import.meta.url).href;
    el.volume = this.muted ? 0 : vol;
    this.speechVol = vol;
    this.speechOn = true;
    el.onended = () => { this.speechOn = false; onEnd?.(); };
    el.onerror = () => { this.speechOn = false; onEnd?.(); };
    el.play().catch(() => { this.speechOn = false; onEnd?.(); });
  }
  stopSpeech() {
    if (!this.speech) return;
    this.speech.onended = this.speech.onerror = null;
    this.speech.pause();
    this.speech.removeAttribute('src');
    this.speechOn = false;
  }
  pauseSpeech() { this.speech?.pause(); }
  resumeSpeech() { if (this.speechOn) this.speech?.play().catch(() => {}); }
  get speechPlaying() { return !!this.speechOn; }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  engine(speed, throttle, on = true) {
    if (!this.ctx) return;
    if (!on) this.siren(null);
    const t = this.ctx.currentTime;
    const f = 42 + Math.abs(speed) * 4.2 + throttle * 14;
    this.osc1.frequency.setTargetAtTime(f, t, 0.06);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + throttle * 0.04 : 0, t, 0.1);
  }

  horn(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (on && !this.hornNodes) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.connect(this.master);
      const oscs = [370, 466].map(f => {
        const o = this.ctx.createOscillator();
        o.type = 'square'; o.frequency.value = f;
        o.connect(g); o.start();
        return o;
      });
      this.hornNodes = { g, oscs };
    } else if (!on && this.hornNodes) {
      const { g, oscs } = this.hornNodes;
      g.gain.setTargetAtTime(0, t, 0.03);
      oscs.forEach(o => o.stop(t + 0.2));
      this.hornNodes = null;
    }
  }

  /** Sirène du véhicule le plus proche, { kind, near } (near : 0 au loin, 1 tout près), ou null : ambulance à deux tons, police qui monte et descend. */
  siren(v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!v) { this.sirenGain?.gain.setTargetAtTime(0, t, 0.15); return; }
    if (!this.sirenOsc) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2200;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sawtooth';
      this.sirenOsc.connect(f).connect(this.sirenGain).connect(this.master);
      this.sirenOsc.start();
    }
    const amb = v.kind === 'amb', freq = amb ? (t % 1.3 < 0.65 ? 960 : 720) : 720 + 520 * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI / 3.2));
    this.sirenOsc.frequency.setTargetAtTime(freq, t, amb ? 0.012 : 0.05);
    this.sirenGain.gain.setTargetAtTime(0.1 * v.near * v.near, t, 0.12);
  }

  tone(freqs, dur = 0.12, type = 'sine', vol = 0.15) {
    if (!this.ctx) return;
    let t = this.ctx.currentTime;
    for (const f of freqs) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur);
      t += dur * 0.8;
    }
  }

  crash(vol = 0.5) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = this.noise;
    g.gain.value = vol;
    s.connect(g).connect(this.master);
    s.start();
  }

  ding() { this.tone([880, 1320], 0.14); }
  /** Klaxon du train : accord grave et long. */
  trainHorn(vol = 0.12) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.08); g.gain.setValueAtTime(vol, t + 1.4); g.gain.linearRampToValueAtTime(0, t + 1.7);
    for (const f of [185, 233, 311]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 1.75); }
    lp.connect(g).connect(this.master);
  }
  /** Sonnerie du passage à niveau. */
  bell() { this.tone([1250], 0.18, 'triangle', 0.07); }
  cash() { this.tone([1046, 1318, 1568], 0.1, 'triangle', 0.18); }
}
