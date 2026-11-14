// La prédication dans le bus (l'auteur, 10/11, vidéos du dossier Predication : « longue prédication pour les courses longues et les petites
// pour les petits cours » ; « ça ne doit pas être en écrit, transforme ces fichiers en audio, et la musique doit s'arrêter ») : un prédicateur
// monte dans le 207 à un arrêt et prêche ; on entend l'enregistrement d'une vraie prédication (data/voix/predication-N.mp3, tirées des
// vidéos par ffmpeg, liste dans data/predications.json), la radio se tait, puis il descend au premier arrêt du véhicule. Rien n'est écrit.

export const PREACHERS = [
  { name: 'Frère Jean', kind: 'man' }, { name: 'Papa Pasteur Mbuta', kind: 'man' }, { name: 'Frère Dieudonné', kind: 'man' }, { name: 'Maman Esther', kind: 'woman' },
];
const pick = a => a[Math.floor(Math.random() * a.length)];

/** La liste des enregistrements : [{ fichier, duree, longue }]. */
export const SERMONS = fetch(new URL('../data/predications.json', import.meta.url)).then(r => (r.ok ? r.json() : { predications: [] }))
  .then(d => d.predications ?? []).catch(() => []);

/**
 * Le prédicateur à bord. hooks : play(fichier, onEnd) joue l'enregistrement (et coupe la radio), stop() l'arrête (et remet la radio),
 * enter(prédicateur), exit(). start(long) : il monte ; update(dt, arrêté) : la prédication se joue, puis il descend au premier arrêt.
 */
export class Preacher {
  constructor(hooks) { this.h = hooks; this.active = false; this.done = false; this.who = null; this.list = []; SERMONS.then(l => { this.list = l; }); this.played = new Set(); }
  /** Un enregistrement du genre voulu, en évitant ceux déjà entendus dans la partie. */
  choose(long) {
    const all = this.list.filter(s => !!s.longue === long);
    const fresh = all.filter(s => !this.played.has(s.fichier));
    const s = pick(fresh.length ? fresh : all.length ? all : this.list);
    if (s) this.played.add(s.fichier);
    return s ?? null;
  }
  start(long) {
    const s = this.choose(long);
    if (!s) return false;
    this.who = pick(PREACHERS);
    this.sermon = s;
    this.active = true; this.done = false; this.t = 0; this.wait = 0;
    this.h.enter?.(this.who);
    this.h.play(s.fichier, () => { this.done = true; this.wait = 0; });
    return true;
  }
  /** stopped : le véhicule est arrêté (il peut descendre). */
  update(dt, stopped) {
    if (!this.active) return;
    this.t += dt;
    if (!this.done && this.t > (this.sermon?.duree ?? 300) + 20) { this.done = true; this.wait = 0; }   // (l'enregistrement n'a pas pu être lu)
    if (this.done) { if (stopped) { if ((this.wait += dt) > 1.5) this.leave(); } else this.wait = 0; }
  }
  /** Il descend (quiet : fin de partie ou terminus). */
  leave(quiet = false) {
    if (!this.active) return;
    this.active = false;
    this.h.stop?.(quiet);
    this.h.exit?.();
  }
}
