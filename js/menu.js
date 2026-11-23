// Taxi Kin — le menu seul (page d'accueil légère) : on choisit le mode, le véhicule, la ligne, le sens, et ce n'est qu'en appuyant sur « Commencer »
// que le jeu (jeu.html, js/main.js) se charge et construit la ville de l'itinéraire choisi. Mêmes réglages enregistrés (localStorage) que dans le jeu.
import { ROUTES, CURRENT, ITINERAIRES, VEHICULES, COURSES } from './routes.js';
import { THANKS } from './credits.js';

const $ = id => document.getElementById(id);
const fmtFC = n => `${Math.round(n).toLocaleString('fr-FR')} FC`;
const PARAMS = new URLSearchParams(location.search);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(`taxikin.${k}`); localStorage.setItem(`taxikin.${k}`, v); } catch { /* (navigation privée) */ } return null; };
const OLD_TRAJETS = { 'masina-gare': 'aeroport-gare', 'aeroport-limete': 'masina-limete', 'ngaba-masina': 'kingasani-ngaba', 'bypass-ngaba': 'kingasani-ngaba', kulumba: 'masina-limete' };
const syncVariant = (it, forceId) => {
  if (!it?.variants) return it;
  it.baseRoads ??= it.roads;
  const vid = forceId ?? (PARAMS.get('trajet') === it.id ? PARAMS.get('var') : null) ?? store(`var.${it.id}`);
  const v = it.variants.find(x => x.id === vid) ?? it.variants[0];
  Object.assign(it, { variant: v.id, variantLabel: v.label, variantShort: v.short, via: v.via, stops: v.stops, km: v.km, A: v.A ?? it.A, B: v.B ?? it.B, roads: v.roads ?? it.baseRoads });
  return it;
};
ITINERAIRES.forEach(it => syncVariant(it));
const rawTid = PARAMS.get('trajet') ?? store('trajet');
const tid = OLD_TRAJETS[rawTid] ?? rawTid;
let IT = PARAMS.get('trajet') || !PARAMS.get('route') ? (ITINERAIRES.find(i => i.id === tid) ?? ITINERAIRES[0]) : null;
syncVariant(IT);
let SENS = PARAMS.get('sens') ?? store('sens') ?? 'aller';
let VEH_ID = VEHICULES[PARAMS.get('veh')] ? PARAMS.get('veh') : VEHICULES[store('veh')] ? store('veh') : 'berline';
let VEH = VEHICULES[VEH_ID];
// Mode : journée de travail, ou course (à l'aller, sur un itinéraire qui reste sur une seule route ; taxis ou motos)
const raceOK = it => it.A.road === it.B.road || (it.variants?.some(v => (v.A ?? it.A).road === (v.B ?? it.B).road) ?? false);
const ensureRaceVariant = it => {
  if (!it?.variants || it.A.road === it.B.road) return;
  const v = it.variants.find(x => (x.A ?? it.A).road === (x.B ?? it.B).road);
  if (v) { store(`var.${it.id}`, v.id); syncVariant(it, v.id); }
};
let MODE = IT && store('mode') === 'course' && raceOK(IT) ? 'course' : 'travail';
if (MODE === 'course' && IT) ensureRaceVariant(IT);
let TRIP = store('trip') === 'simple' ? 'simple' : 'ar';   // (l'auteur, 08/11 : aller simple → la partie finit au terminus ; aller-retour → au retour)
let RACE_AR = store('course') === 'ar';             // (l'auteur, 08/11 : la course est soit un aller simple, soit un aller-retour)
let worldReady = true;                       // (ici le bouton est actif tout de suite : la ville ne se construit qu'après le clic)
let VERSEMENT = VEH.versement;
const setVehicle = id => { VEH_ID = id; VEH = VEHICULES[id]; VERSEMENT = VEH.versement; };
// ---------- Menu affiché immédiatement avant la construction 3D ----------
const radioGroup = (box, items, isOn, onPick) => {
  box.innerHTML = '';
  for (const it of items) {
    const btn = document.createElement('button');
    btn.className = 'route-btn';
    btn.disabled = !!it.disabled;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(isOn(it)));
    btn.innerHTML = it.html;
    btn.addEventListener('click', () => onPick(it));
    box.append(btn);
  }
};
const VEH_ART = {
  berline: '<svg viewBox="0 0 110 48"><path d="M6 34 Q6 28 14 27 L28 25 L40 15 Q44 12 52 12 L70 12 Q76 12 80 16 L88 25 L100 27 Q105 28 105 33 L105 37 L6 37 Z" fill="#f5c400"/><path d="M42 17 L50 14 L64 14 L64 25 L33 25 Z M67 14 L72 14 Q76 14 79 18 L85 25 L67 25 Z" fill="#1c2b3a"/><rect x="10" y="29" width="92" height="3" fill="#1d4fa0"/><rect x="45" y="6" width="20" height="5" rx="1.5" fill="#fff5cc"/><circle cx="28" cy="38" r="7" fill="#17181b"/><circle cx="84" cy="38" r="7" fill="#17181b"/><circle cx="28" cy="38" r="3" fill="#cfd6de"/><circle cx="84" cy="38" r="3" fill="#cfd6de"/></svg>',
  bus: '<svg viewBox="0 0 110 48"><path d="M8 38 L8 20 Q8 10 18 10 L92 10 Q102 10 104 20 L104 38 Z" fill="#2a93cc"/><path d="M8 26 L104 26 L104 38 L8 38 Z" fill="#f5c400"/><path d="M14 14 h16 v10 h-16z M34 14 h16 v10 h-16z M54 14 h16 v10 h-16z M74 14 h12 v10 h-12z M90 13 L100 13 L102 24 L90 24 Z" fill="#1c2b3a"/><rect x="58" y="14" width="10" height="24" fill="#111317"/><circle cx="26" cy="39" r="7" fill="#17181b"/><circle cx="88" cy="39" r="7" fill="#17181b"/><circle cx="26" cy="39" r="3" fill="#3a3e44"/><circle cx="88" cy="39" r="3" fill="#3a3e44"/></svg>',
  moto: '<svg viewBox="0 0 110 48"><circle cx="28" cy="36" r="10" fill="none" stroke="#17181b" stroke-width="4"/><circle cx="84" cy="36" r="10" fill="none" stroke="#17181b" stroke-width="4"/><path d="M28 36 L48 24 L70 24 L84 36 M62 24 L76 12 L82 12" stroke="#9aa0a6" stroke-width="3" fill="none"/><path d="M44 22 Q56 16 68 22 L66 27 L46 27 Z" fill="#b91c1c"/><path d="M50 22 L54 6 L64 6 L66 20 Z" fill="#d6dc24"/><rect x="51" y="11" width="14" height="2.5" fill="#9aa0a6"/><circle cx="59" cy="3" r="5" fill="#1a2a55"/><path d="M52 24 L48 34 L54 34 L58 26 Z" fill="#2f3e57"/></svg>',
  perso: '<svg viewBox="0 0 110 48"><path d="M6 34 Q6 28 14 27 L28 25 L40 15 Q44 12 52 12 L70 12 Q76 12 80 16 L88 25 L100 27 Q105 28 105 33 L105 37 L6 37 Z" fill="#1e3a8a"/><path d="M42 17 L50 14 L64 14 L64 25 L33 25 Z M67 14 L72 14 Q76 14 79 18 L85 25 L67 25 Z" fill="#1c2b3a"/><rect x="10" y="29" width="92" height="3" fill="#1d4fa0"/><rect x="45" y="6" width="20" height="5" rx="1.5" fill="#fff5cc"/><circle cx="28" cy="38" r="7" fill="#17181b"/><circle cx="84" cy="38" r="7" fill="#17181b"/><circle cx="28" cy="38" r="3" fill="#cfd6de"/><circle cx="84" cy="38" r="3" fill="#cfd6de"/></svg>',
  athlete: '<svg viewBox="0 0 110 48"><circle cx="62" cy="9" r="5" fill="#6b4428"/><path d="M58 6 Q63 3 67 7" stroke="#ffffff" stroke-width="2.5" fill="none"/><path d="M52 22 L60 14 L66 16 L58 27 Z" fill="#d62828"/><path d="M48 16 L58 15 L68 20 L74 15" stroke="#6b4428" stroke-width="3.2" stroke-linecap="round" fill="none"/><path d="M52 25 L59 27 L64 33 L56 32 Z" fill="#1a1a1a"/><path d="M59 27 L70 32 L78 41 M54 27 L43 34 L34 31" stroke="#6b4428" stroke-width="3.5" stroke-linecap="round" fill="none"/><rect x="75" y="39" width="7" height="3.5" rx="1.5" fill="#f2f2f2"/><rect x="30" y="29" width="6" height="3.5" rx="1.5" fill="#f2f2f2"/></svg>',
};
const statRow = (label, v) => `<span class="vstat">${label}<i style="--v:${Math.round(v * 100)}%"></i></span>`;
const syncUrl = () => {
  const url = new URL(location.href);
  if (IT) {
    url.searchParams.set('trajet', IT.id);
    if (IT.variant) url.searchParams.set('var', IT.variant); else url.searchParams.delete('var');
  }
  history.replaceState(null, '', url.href);
};
const pickRoute = it => {
  IT = it;
  if (MODE === 'course') ensureRaceVariant(IT);
  store('trajet', IT.id);
  VERSEMENT = VEH.versement;
  syncUrl();
  drawMenu();
};
$('mode-travail').addEventListener('click', () => { MODE = 'travail'; store('mode', 'travail'); drawMenu(); goStep(2); });
$('mode-course').addEventListener('click', () => {
  MODE = 'course'; store('mode', 'course');
  if (VEH_ID === 'bus' || VEH_ID === 'perso') { store('veh', 'berline'); setVehicle('berline'); }
  if (IT && !raceOK(IT)) {
    const it = ITINERAIRES.find(raceOK);
    pickRoute(it);
    return;
  }
  if (IT) ensureRaceVariant(IT);
  drawMenu(); goStep(2);
});
for (const [name, what] of THANKS) {
  const li = document.createElement('li');
  li.append(Object.assign(document.createElement('b'), { textContent: name }));
  if (what) li.append(` · ${what}`);
  $('thanks').append(li);
}

/** Les deux bouts du trajet dans le sens choisi : départ (from) et arrivée (to), avec le sens de la marche à chacun. */
function legs(sens = SENS) {
  const at = (P, dir, end) => ({ ...P, dir, s: (end ? P.endS : P.startS) ?? P.s, name: (end ? P.endName : P.startName) ?? P.name });
  return sens === 'retour' ? { from: at(IT.B, -IT.B.dir, false), to: at(IT.A, -IT.A.dir, true) } : { from: at(IT.A, IT.A.dir, false), to: at(IT.B, IT.B.dir, true) };
}

function drawMenu() {
  ITINERAIRES.forEach(i => syncVariant(i));
  radioGroup($('vehs'), Object.entries(VEHICULES).map(([id, v]) => ({
    id,
    html: `<div class="veh-top"><span class="veh-art">${VEH_ART[id]}</span><span class="veh-fare-pill">${v.athlete ? '🏃 Sport' : v.perso ? 'Libre' : `${fmtFC(v.fare)} / client`}</span></div>`
      + `<b>${v.name}</b><span class="about">${v.about}</span>`
      + `<div class="vstats">${statRow(v.athlete ? 'Endurance' : 'Places', v.athlete ? 0.95 : v.places / 10)}${statRow('Vitesse', v.athlete ? 0.55 : (v.max - 12) / 14)}${statRow('Maniable', id === 'moto' || id === 'athlete' ? 0.98 : id === 'bus' ? 0.35 : 0.7)}</div>`
      + `<span class="price">${v.athlete ? 'Footing libre ou Marathon' : v.perso ? 'Sans versement · Balade' : `Versement : ${fmtFC(v.versement)}`}</span>`,
  })), it => it.id === VEH_ID, it => { store('veh', it.id); setVehicle(it.id); drawMenu(); goStep(3); });
  if (MODE === 'course') for (const [k, b] of [...$('vehs').children].entries()) if (['bus', 'perso'].includes(Object.keys(VEHICULES)[k])) b.disabled = true;

  if (IT) {
    const rBox = $('routes');
    rBox.innerHTML = '';
    for (const i of ITINERAIRES) {
      const disabled = MODE === 'course' && !raceOK(i);
      const active = i.id === IT.id;
      const stops = active && SENS === 'retour' && MODE !== 'course' ? [...(i.stops ?? [])].reverse() : (i.stops ?? []);
      const stopsHtml = stops.length ? `<div class="itin-stops">${stops.map(s => `<span class="itin-stop">${s}</span>`).join('')}</div>` : '';
      const varsHtml = i.variants ? `<div class="itin-vars">${i.variants.map(v => {
        const vDis = MODE === 'course' && (v.A ?? i.A).road !== (v.B ?? i.B).road;
        return `<span class="var-pill${i.variant === v.id ? ' on' : ''}" data-var="${v.id}"${vDis ? ' style="opacity:.35;pointer-events:none"' : ''}>${v.short ?? v.label}</span>`;
      }).join('')}</div>` : '';

      const btn = document.createElement('button');
      btn.className = 'route-btn';
      btn.disabled = disabled;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(active));
      btn.innerHTML = `<div class="itin-head-row"><div class="itin-badges"><span class="itin-code">${i.code ?? ''}</span><span class="itin-tag">${i.tag ?? ''}</span></div>`
        + `<span class="km">${i.km.toLocaleString('fr-FR')} KM${disabled ? ' · HORS COURSE' : ''}</span></div>`
        + `<b class="itin-name">${i.title}</b>`
        + stopsHtml
        + varsHtml;
      btn.addEventListener('click', e => {
        const vp = e.target.closest('[data-var]');
        if (vp) {
          const vid = vp.dataset.var;
          store(`var.${i.id}`, vid);
          syncVariant(i, vid);
          if (i.id === IT.id) { syncUrl(); drawMenu(); return; }
        }
        if (i.id === IT.id) return;
       pickRoute(i); goStep(4);
      });
      rBox.append(btn);
    }

    const varBox = $('sum-var-box');
    if (varBox) {
      varBox.hidden = !IT.variants;
      if (IT.variants) {
        radioGroup($('sum-vars'), IT.variants.map(v => ({
          id: v.id,
          disabled: MODE === 'course' && (v.A ?? IT.A).road !== (v.B ?? IT.B).road,
          html: `<b>${v.short ?? v.label}</b><span>${v.km.toLocaleString('fr-FR')} km</span>`,
        })), v => v.id === IT.variant, v => {
          store(`var.${IT.id}`, v.id);
          syncVariant(IT, v.id);
          syncUrl();
          drawMenu();
        });
      }
    }

    const La = legs('aller'), Lr = legs('retour');
    const L = { aller: `${La.from.name} → ${La.to.name}`, retour: `${Lr.from.name} → ${Lr.to.name}` };
    radioGroup($('sens'), ['aller', 'retour'].map(k => ({ id: k, html: `<b>${k === 'aller' ? 'Aller' : 'Retour'}</b><span>${L[k]}</span>` })), it => it.id === SENS, it => { SENS = it.id; store('sens', it.id); drawMenu(); });
    const L1 = legs(), L2 = legs(SENS === 'retour' ? 'aller' : 'retour');
    radioGroup($('trip'), [{ id: 'simple', html: `<b>Aller simple</b><span>Terminus : ${L1.to.name}</span>` }, { id: 'ar', html: `<b>Aller-retour</b><span>Retour : ${L2.to.name}</span>` }],
      it => it.id === TRIP, it => { TRIP = it.id; store('trip', it.id); drawMenu(); });
  }
  const race = MODE === 'course', C = COURSES[VEH_ID] ?? COURSES.berline;
  $('mode-travail').classList.toggle('on', !race); $('mode-course').classList.toggle('on', race);
  $('sens-title').lastChild.textContent = race ? ' Format de la course' : ' Sens de départ';
  $('trip').hidden = race || !IT;
  if (race && IT) radioGroup($('sens'), [{ id: 'simple', html: `<b>Aller simple</b><span>${IT.A.name} → ${IT.B.name}</span>` }, { id: 'ar', html: `<b>Aller-retour</b><span>${IT.A.name} → ${IT.B.name} → ${IT.A.name}</span>` }],
    it => it.id === (RACE_AR ? 'ar' : 'simple'), it => { RACE_AR = it.id === 'ar'; store('course', it.id); drawMenu(); });
  const isAth = VEH_ID === 'athlete', isPerso = VEH_ID === 'perso';
  const mise = race && RACE_AR ? Math.round(C.mise * 1.5) : C.mise, prix = race && RACE_AR ? C.prix * 2 : C.prix;
  $('sum-title').textContent = race ? 'Feuille de course' : isAth ? 'Parcours sportif' : isPerso ? 'Itinéraire libre' : 'Feuille de route';
  $('sum-l1').textContent = race ? 'Mise de départ' : isAth ? 'Objectif' : isPerso ? 'Mode' : 'Versement au patron';
  $('sum-l2').textContent = race ? 'Gain du 1er' : 'Horaires';
  $('sum-v2').textContent = race ? `${fmtFC(prix)} · 3 rivaux` : '06:00 → 18:00';
  $('rule-versement').textContent = race ? fmtFC(mise) : isAth ? 'Footing libre' : isPerso ? 'Balade libre' : fmtFC(VERSEMENT);
  $('btn-start').disabled = !worldReady;
  $('btn-start').textContent = !worldReady
    ? '⏳ Chargement de la ville…'
    : race
    ? '🏁 Lancer la course'
    : isAth
    ? '🏃 Commencer le footing'
    : isPerso
    ? '🚗 Partir en balade'
    : '🚕 Commencer la journée';
  $('sum-veh').textContent = VEH.name;
  if (IT) {
    const L = legs();
    $('sum-route').textContent = IT.variantShort ? `${IT.title} (${IT.variantShort})` : IT.title;
    $('sum-sens').textContent = race ? `${IT.A.name} → ${IT.B.name}${RACE_AR ? ` → ${IT.A.name}` : ''}` : `${L.from.name} → ${L.to.name}${TRIP === 'ar' ? ` → ${legs(SENS === 'retour' ? 'aller' : 'retour').to.name}` : ''}`;
    if ($('sum-code')) $('sum-code').textContent = IT.code ?? 'L1';
    if ($('sum-km')) $('sum-km').textContent = `${IT.km.toLocaleString('fr-FR')} KM`;
    if ($('sum-cri')) {
      const criA = L.to.cri ?? L.to.name, criB = legs(SENS === 'retour' ? 'aller' : 'retour').to.cri ?? L.from.cri;
      $('sum-cri').textContent = race
        ? `🏁 Rivaux : ${C.rivals.join(', ')}`
        : isAth
        ? `🏃 Course à pied · ${L.from.cri ?? L.from.name} → ${criA} (${IT.km.toLocaleString('fr-FR')} km)`
        : VEH.perso
        ? `🚗 Conduite libre · ${L.from.cri ?? L.from.name} → ${criA}`
        : `📢 Receveur : « ${criA} ! ${criA} !${TRIP === 'ar' ? ` — Retour ${criB} !` : ''} »`;
    }
  }
}

// ---------- Départ : le jeu se charge alors, avec exactement l'itinéraire, la variante, le sens et le véhicule choisis ----------
function go(vrMode = false) {
  const url = new URL('jeu.html', location.href);
  url.searchParams.set('route', IT.route);
  url.searchParams.set('trajet', IT.id);
  if (IT.variant) url.searchParams.set('var', IT.variant);
  url.searchParams.set('sens', SENS);
  url.searchParams.set('veh', VEH_ID);
  if (vrMode) url.searchParams.set('vr', '1');
  else url.searchParams.set('autostart', '1');
  store('quality', $('sel-quality').value);
  store('radioOn', $('sel-radio').value);
  $('btn-start').disabled = true;
  $('btn-start').textContent = '⏳ Chargement de la ville…';
  document.documentElement.classList.add('boot');          // (le cercle qui tourne, tout de suite)
  setTimeout(() => { location.href = url.href; }, 60);
}
$('btn-start').addEventListener('click', () => go());
$('btn-vr').addEventListener('click', () => go(true));
for (const [id, k] of [['sel-quality', 'quality'], ['sel-radio', 'radioOn']]) { const v = store(k); if (v) $(id).value = v; }
$('rule-versement').textContent = fmtFC(VERSEMENT);
drawMenu();

// ===== MENU WIZARD 4 ÉTAPES (version corrigée) =====
let STEP = 1;

function goStep(n) {
  STEP = n;
  document.querySelectorAll('.menu-step').forEach(s => {
    s.classList.toggle('active', +s.dataset.step === n);
  });
  document.querySelectorAll('.wizard-progress span').forEach((d, i) => {
    d.classList.toggle('on', i < n);
  });
  console.log('🎯 Étape', n);
}

// Navigation avec les boutons "Suivant" et "Retour"
document.querySelectorAll('[data-next]').forEach(b => {
  b.addEventListener('click', () => goStep(+b.dataset.next));
});
document.querySelectorAll('[data-back]').forEach(b => {
  b.addEventListener('click', () => goStep(+b.dataset.back));
});

// Étape 1 → 2 : après clic sur un mode (on attend que drawMenu() finisse)
setTimeout(() => {
  const mt = document.getElementById('mode-travail');
  const mc = document.getElementById('mode-course');
  if (mt) mt.addEventListener('click', () => setTimeout(() => goStep(2), 100));
  if (mc) mc.addEventListener('click', () => setTimeout(() => goStep(2), 100));
}, 0);

// Étape 2 → 3 : après sélection d'un véhicule
// Étape 3 → 4 : après sélection d'une ligne
document.addEventListener('click', (e) => {
  const vehBtn = e.target.closest('#vehs .route-btn');
  if (vehBtn && vehBtn.getAttribute('aria-checked') === 'true') {
    setTimeout(() => goStep(3), 150);
  }
  const routeBtn = e.target.closest('#routes .route-btn');
  if (routeBtn && routeBtn.getAttribute('aria-checked') === 'true') {
    setTimeout(() => goStep(4), 150);
  }
});


// Initialisation
goStep(1);

