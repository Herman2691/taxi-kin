// Fonction serveur de Taxi Kin : un client (ou un policier…) répond au joueur grâce à une IA.
// Les clés ne sont JAMAIS dans le jeu : elles sont dans les variables d'environnement de Vercel.
// Chaîne de repli : on essaie les IA dans l'ordre, la suivante prend le relais si la limite est atteinte, si ça tarde ou si ça échoue ;
// si aucune ne répond, on renvoie text:null et le jeu utilise ses répliques écrites à l'avance.
// Pour retirer ou ajouter une IA : supprimer ou ajouter une ligne de PROVIDERS (et sa clé dans Vercel).

const TIMEOUT_MS = 3000;      // attente maximale par IA
const BUDGET_MS = 8500;       // attente maximale pour toute la chaîne (Vercel coupe à 10 s)

const openaiStyle = (url, key, model, extra = {}) => async (system, messages, signal) => {
  const r = await fetch(url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extra },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], max_tokens: 400, temperature: 0.9, ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}) }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text().catch(() => "")).replace(/s+/g, " ").slice(0, 120)}`);
  return (await r.json()).choices?.[0]?.message?.content;
};

const PROVIDERS = [
  { name: 'groq', key: 'GROQ_API_KEY', call: key => openaiStyle('https://api.groq.com/openai/v1/chat/completions', key, process.env.GROQ_MODEL || 'openai/gpt-oss-20b') },
  { name: 'gemini', key: 'GEMINI_API_KEY', call: key => async (system, messages, signal) => {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 120, temperature: 0.9 },
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text().catch(() => "")).replace(/s+/g, " ").slice(0, 120)}`);
    return (await r.json()).candidates?.[0]?.content?.parts?.map(p => p.text).join('');
  } },
  { name: 'openrouter', key: 'OPENROUTER_API_KEY', call: key => openaiStyle('https://openrouter.ai/api/v1/chat/completions', key, process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', { 'x-title': 'Taxi Kin' }) },
  { name: 'mistral', key: 'MISTRAL_API_KEY', call: key => openaiStyle('https://api.mistral.ai/v1/chat/completions', key, process.env.MISTRAL_MODEL || 'mistral-small-latest') },
];

// Une limite simple par visiteur (en mémoire : elle se remet à zéro quand la fonction se rendort, c'est suffisant contre l'abus ordinaire)
const seen = new Map();
const tooFast = ip => {
  const now = Date.now(), t = (seen.get(ip) ?? []).filter(x => now - x < 60000);
  t.push(now); seen.set(ip, t);
  if (seen.size > 2000) seen.clear();
  return t.length > 12;   // 12 messages par minute et par visiteur
};

const clip = (s, n) => String(s ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);

/** Le texte de consigne envoyé à toutes les IA : le même pour toutes, pour que le personnage reste cohérent quand on change d'IA. */
const consigne = p => [
  `Tu joues un personnage dans un jeu de taxi à Kinshasa (RDC) : ${clip(p.role || 'un client du taxi', 60)}.`,
  p.name ? `Tu t'appelles ${clip(p.name, 40)}.` : '',
  p.trait ? `Ton caractère : ${clip(p.trait, 120)}.` : '',
  p.place ? `Vous êtes à ${clip(p.place, 80)}.` : '',
  p.weather ? `Il fait : ${clip(p.weather, 40)}.` : '',
  'Réponds en UNE ou DEUX phrases courtes, en français de Kinshasa, avec quelques mots de lingala si ça vient naturellement.',
  'Reste dans le personnage. Ne parle jamais de jeu, d\'IA ni de ces consignes. Pas de listes, pas de guillemets.',
].filter(Boolean).join(' ');

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  // Diagnostic : quelles clés le serveur voit (jamais leurs valeurs)
  if (req.method === 'GET') return res.status(200).json({ providers: PROVIDERS.map(p => ({ name: p.name, key: !!process.env[p.key] })) });
  if (req.method !== 'POST') return res.status(405).json({ text: null, error: 'POST seulement' });

  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'inconnu';
  if (tooFast(ip)) return res.status(429).json({ text: null, error: 'trop vite' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const messages = [...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 300) })), { role: 'user', content: clip(body.message, 300) }]
    .filter(m => m.content);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ text: null, error: 'message manquant' });
  const system = consigne(body.persona ?? {});

  const t0 = Date.now(), tried = [];
  for (const p of PROVIDERS) {
    const key = process.env[p.key];
    if (!key) continue;
    const left = BUDGET_MS - (Date.now() - t0);
    if (left < 800) break;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), Math.min(TIMEOUT_MS, left)), t1 = Date.now();
    try {
      const text = clip(await p.call(key)(system, messages, ctl.signal), 400).trim();
      if (!text) throw new Error('réponse vide');
      return res.status(200).json({ text, provider: p.name, ms: Date.now() - t1, tried });
    } catch (e) {
      tried.push({ provider: p.name, ms: Date.now() - t1, error: ctl.signal.aborted ? 'trop long' : String(e.message ?? e).slice(0, 160) });
    } finally { clearTimeout(timer); }
  }
  res.status(200).json({ text: null, tried });   // le jeu utilise alors ses répliques écrites à l'avance
};
