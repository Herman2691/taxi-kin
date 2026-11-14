// La radio du taxi : les morceaux du dossier music/ (liste dans data/radio.json, faite par tools/radio.py), dans un ordre mélangé, plus les chansons que
// le joueur ajoute depuis son appareil (l'auteur, 08/11 : « l'utilisateur doit avoir le droit de changer les chansons et d'étendre la musique ») : elles sont
// gardées dans le navigateur (IndexedDB) et reviennent à la partie suivante. Un seul morceau est chargé à la fois, au moment de l'écouter.
const DB = 'taxikin', STORE = 'chansons';
function openDB() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function dbAll() {
  try {
    const db = await openDB();
    return await new Promise((ok, ko) => { const q = db.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
  } catch { return []; }                         // (navigation privée, ou stockage bloqué : les chansons ajoutées ne durent que la partie)
}
async function dbPut(rec) {
  try {
    const db = await openDB();
    return await new Promise((ok, ko) => { const q = db.transaction(STORE, 'readwrite').objectStore(STORE).add(rec); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
  } catch { return null; }
}
async function dbDel(id) {
  try { const db = await openDB(); db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id); } catch { /* (rien à faire) */ }
}

export class Radio {
  constructor() {
    this.list = [];                                // { titre, fichier } (dossier music/) ou { titre, blob, id, mine: true } (ajoutées par le joueur)
    this.order = [];
    this.i = -1;
    this.current = null;
    this.on = true;
    this.muted = false;
    this.paused = false;
    this.level = 0.55;
    this.duckK = 1;
    this.url = null;
    this.fails = 0;
    this.onTitle = null;
    this.onList = null;
    this.first = true;                       // (le premier titre s'affiche après le message de début de journée)
    try { this.on = localStorage.getItem('taxikin-radio') !== 'off'; } catch { /* (navigation privée) */ }
    this.el = new Audio();
    this.el.preload = 'none';
    this.el.addEventListener('ended', () => this.next());
    this.el.addEventListener('playing', () => { this.fails = 0; });
    this.ready = Promise.all([
      fetch(new URL('../data/radio.json', import.meta.url)).then(r => (r.ok ? r.json() : { titres: [] })).catch(() => ({ titres: [] })),
      dbAll(),
    ]).then(([d, mine]) => {
      this.list = [...(d.titres ?? []), ...mine.map(m => ({ titre: m.titre, blob: m.blob, id: m.id, mine: true }))];
      this.shuffle();
    });
  }

  get hasSongs() { return this.list.length > 0; }
  shuffle() { this.order = this.list.map((_, k) => k).sort(() => Math.random() - 0.5); this.i = -1; }

  /** Début de la journée : la radio joue si elle est allumée. */
  async start() {
    await this.ready;
    if (this.on && this.hasSongs && this.el.paused && !this.req) this.next();   // (si le joueur a déjà choisi une chanson, on la laisse)
  }

  /** Morceau suivant (bouton ⏭, ou fin du morceau). */
  async next() {
    await this.ready;
    if (!this.hasSongs || !this.on) return;
    this.i = (this.i + 1) % this.order.length;
    await this.play(this.list[this.order[this.i]]);
  }

  /** Joue un morceau précis (liste des chansons). */
  async play(song) {
    if (!song) return;
    if (!this.on) { this.on = true; try { localStorage.setItem('taxikin-radio', 'on'); } catch { /* */ } }
    const req = this.req = (this.req ?? 0) + 1;     // (seule la dernière demande compte : un choix ne se fait pas écraser par un chargement plus lent)
    try {
      const blob = song.blob ?? await fetch(new URL(`../${song.fichier}`, import.meta.url)).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      if (req !== this.req) return;
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(song.blob ? blob : new Blob([blob], { type: 'audio/mpeg' }));
      this.el.src = this.url;
      this.current = song;
      this.applyVolume();
      this.onTitle?.(song.titre, this.first);
      this.first = false;
      this.onList?.();
      if (!this.paused) await this.el.play();
    } catch {
      if (++this.fails < this.list.length) setTimeout(() => this.next(), 400);   // (fichier absent ou illisible : on passe au suivant)
    }
  }

  /** Ajoute des chansons choisies sur l'appareil du joueur (fichiers audio) ; elles sont gardées pour les prochaines parties. */
  async addFiles(files) {
    let n = 0;
    for (const f of files) {
      if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|ogg|wav|mpeg|opus)$/i.test(f.name)) continue;
      const titre = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
      const rec = { titre, blob: f };
      const id = await dbPut(rec);
      this.list.push({ titre, blob: f, id, mine: true });
      this.order.push(this.list.length - 1);
      n++;
    }
    this.onList?.();
    return n;
  }

  /** Retire une chanson ajoutée par le joueur. */
  async remove(song) {
    if (!song?.mine) return;
    if (song.id !== null && song.id !== undefined) await dbDel(song.id);
    const k = this.list.indexOf(song);
    if (k >= 0) { this.list.splice(k, 1); this.shuffle(); }
    if (this.current === song) this.next();
    this.onList?.();
  }

  /** Bouton RADIO : allume ou éteint. */
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('taxikin-radio', this.on ? 'on' : 'off'); } catch { /* (navigation privée) */ }
    if (this.on) { this.fails = 0; this.next(); } else this.el.pause();
    return this.on;
  }

  /** Le choix du menu : allumée ou éteinte, sans rien jouer tout de suite (la radio démarre avec la journée). */
  setOn(v) {
    this.on = v;
    try { localStorage.setItem('taxikin-radio', v ? 'on' : 'off'); } catch { /* (navigation privée) */ }
    if (!v) this.el.pause();
  }

  pause() { this.paused = true; this.el.pause(); }
  resume() { this.paused = false; if (this.on && this.el.src) this.el.play().catch(() => {}); }
  stop() { this.paused = true; this.el.pause(); }
  setMuted(m) { this.muted = m; this.applyVolume(); }
  setLevel(v) { this.level = Math.max(0, Math.min(1, v)); this.applyVolume(); try { localStorage.setItem('taxikin-volume', String(this.level)); } catch { /* */ } }
  /** k : 1 normalement, plus bas quand une sirène approche. */
  duck(k) { if (Math.abs(k - this.duckK) > 0.02) { this.duckK = k; this.applyVolume(); } }
  applyVolume() { this.el.volume = this.muted ? 0 : this.level * this.duckK; }
}
