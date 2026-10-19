// HEIMDALLs hjärna: Gemini (gratis) med verktyg som styr schemat och Claude-jobben.
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

// Flera gratisnycklar (från olika Google-projekt) = flera gratiskvoter: GEMINI_API_KEY, GEMINI_API_KEY_2, _3 …
function keys() {
  const ks = [process.env.GEMINI_API_KEY, ...Object.keys(process.env).filter(k => /^GEMINI_API_KEY_\d+$/.test(k)).sort().map(k => process.env[k])].filter(Boolean);
  if (!ks.length) throw new Error('GEMINI_API_KEY saknas i .env');
  return [...new Set(ks)];
}
const key = () => keys()[0];
const { db, save } = require('./db');
const active = require('./activemodel');
const model = () => db.settings.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Varje Gemini-modell har egen gratiskvot. När en tar slut provar vi nästa.
let modelList = null, listAt = 0;
async function freeModels() {
  if (modelList && Date.now() - listAt < 6 * 3600000) return modelList;
  try {
    const res = await fetch(`${API}?pageSize=200&key=${key()}`);
    const json = await res.json();
    const names = (json.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-/.test(n) && !/(tts|image|embed|audio|live|vision|robotics|computer|thinking-exp|aqa|learnlm)/.test(n));
    const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
    const score = n => ver(n) * 10 + (/flash/.test(n) ? 5 : 0) + (/lite/.test(n) ? -2 : 0) + (/pro/.test(n) ? -4 : 0)
      + (/preview|exp/.test(n) ? -1 : 0) + (/latest/.test(n) ? 1 : 0);
    modelList = names.sort((a, b) => score(b) - score(a));
    listAt = Date.now();
    console.log('Gemini-modeller att växla mellan:', modelList.slice(0, 8).join(', '));
  } catch { modelList = modelList || []; }
  return modelList;
}

const exhausted = {}; // modell -> tidpunkt då vi provar igen
async function candidates() {
  const list = [...new Set([model(), ...(await freeModels())])];
  const now = Date.now();
  const out = [];
  keys().forEach((k, ki) => list.slice(0, 6).forEach(m => { if (!(exhausted[`${ki}:${m}`] > now)) out.push({ m, k, id: `${ki}:${m}` }); }));
  return out.length ? out : [{ m: model(), k: key(), id: `0:${model()}` }];
}

// Snabba svar: låt modellen tänka lite (chatt behöver inte djupt resonerande)
const noThink = new Set(); // modeller som inte gillar inställningen
function thinking(m) {
  if (noThink.has(m)) return null;
  const v = parseFloat((m.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
  if (v >= 3) return { thinkingLevel: 'low' };
  if (/2\.5-flash/.test(m)) return { thinkingBudget: 0 };
  return null;
}

async function callModel(m, body, k = key()) {
  const tc = thinking(m);
  const sendBody = tc && !body.generationConfig?.thinkingConfig
    ? { ...body, generationConfig: { ...(body.generationConfig || {}), thinkingConfig: tc } } : body;
  let res;
  try {
    res = await fetch(`${API}/${m}:generateContent?key=${k}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sendBody),
      signal: AbortSignal.timeout(25000), // seg modell: byt till nästa efter 25 s
    });
  } catch (e) {
    const err = new Error(e.name === 'TimeoutError' ? `Google svarade inte i tid (${m})` : `Nätverksfel mot Google: ${e.message}`);
    err.quota = true; // behandla som kvotfel så nästa modell/Claude-reserven provas
    throw err;
  }
  const json = await res.json().catch(() => ({ error: { message: `Konstigt svar från Google (${res.status})` } }));
  // Gillar modellen inte tänk-inställningen: kom ihåg det och försök igen utan
  if (res.status === 400 && tc && /think/i.test(json.error?.message || '')) { noThink.add(m); return callModel(m, body, k); }
  return { res, json };
}

async function call(body, retry = true) {
  let lastErr = null;
  const tried = new Set();
  for (const { m, k, id } of await candidates()) {
    // Fel som inte beror på kvoten (nät, överbelastning) prövas inte på fler nycklar för samma modell
    if (tried.size >= 14) break;
    tried.add(id);
    let res, json;
    const ex = exhausted; const slot = id;
    try { ({ res, json } = await callModel(m, body, k)); }
    catch (e) { lastErr = e; ex[slot] = Date.now() + 60000; console.log(e.message); continue; } // prova nästa modell
    if (res.ok) { active.set('Gemini', m); return json; }
    const msg = json.error?.message || `Gemini-fel ${res.status}`;
    if (res.status === 429) {
      const wait = json.error?.details?.find(d => d.retryDelay)?.retryDelay;
      const daily = /per.?day|daily|exceeded your current quota/i.test(msg);
      // Dagskvot slut: vila modellen i 1 h. Minutgräns: vila så länge Google säger.
      exhausted[slot] = Date.now() + (daily ? 3600000 : (wait ? parseFloat(wait) * 1000 : 30000));
      console.log(`Kvot slut för ${m}, provar nästa modell`);
      lastErr = Object.assign(new Error(`Gemini-gränsen nådd på alla gratismodeller just nu: ${msg.slice(0, 120)}`), { quota: true, retryMs: wait ? parseFloat(wait) * 1000 : 30000 });
      continue;
    }
    if (res.status >= 500 || /high demand|overloaded|unavailable|try again later/i.test(msg)) {
      // Tillfälligt överbelastad hos Google — vila modellen 5 min och ta nästa direkt
      exhausted[slot] = Date.now() + 5 * 60000;
      console.log(`${m} är överbelastad hos Google, byter modell`);
      lastErr = Object.assign(new Error(`Googles modeller är överbelastade just nu: ${msg.slice(0, 100)}`), { quota: true });
      continue;
    }
    if (res.status === 404 || /no longer available|not found|not supported/i.test(msg)) {
      // Modellen finns inte för det här kontot — byt standard om Google föreslår en, annars nästa
      const suggested = msg.match(/\buse\s+(?:models\/)?(gemini-[\w-]+(?:\.\d+)?[\w-]*)/i)?.[1];
      if (m === model() && suggested) { db.settings.geminiModel = suggested; save(); console.log('Ny standardmodell:', suggested); }
      exhausted[slot] = Date.now() + 24 * 3600000;
      lastErr = new Error(msg);
      continue;
    }
    throw new Error(msg);
  }
  throw lastErr || new Error('Ingen Gemini-modell svarade');
}

const S = (type, description, extra = {}) => ({ type, description, ...extra });

const TOOLS = [
  { name: 'list_tasks', description: 'Lista tasks. Använd innan du flyttar/bockar av om du är osäker på id.',
    parameters: { type: 'OBJECT', properties: {
      from: S('STRING', 'Från datum YYYY-MM-DD'), to: S('STRING', 'Till datum YYYY-MM-DD'),
      project: S('STRING', 'Projekt-id'), include_done: S('BOOLEAN', 'Ta med klara'),
    } } },
  { name: 'add_task', description: 'Lägg till en task i schemat.',
    parameters: { type: 'OBJECT', required: ['title', 'project'], properties: {
      title: S('STRING', 'Kort titel'), project: S('STRING', 'Projekt-id'),
      date: S('STRING', 'YYYY-MM-DD'), estimate_min: S('NUMBER', 'Uppskattad tid i minuter'),
      claude_heavy: S('BOOLEAN', 'Kräver mycket Claude Code-jobb'), priority: S('NUMBER', '1=hög 2=normal 3=låg'),
      time: S('STRING', 'Klockslag HH:MM om det ska påminnas vid en viss tid'), remind_before: S('NUMBER', 'Påminn så här många minuter innan (standard 15)'),
    } } },
  { name: 'complete_task', description: 'Bocka av en task.',
    parameters: { type: 'OBJECT', required: ['task'], properties: { task: S('STRING', 'Task-id eller del av titeln') } } },
  { name: 'update_task', description: 'Ändra en task, t.ex. flytta datum, byta titel eller prioritet.',
    parameters: { type: 'OBJECT', required: ['task'], properties: {
      task: S('STRING', 'Task-id eller del av titeln'), date: S('STRING', 'Nytt datum YYYY-MM-DD'),
      title: S('STRING', 'Ny titel'), priority: S('NUMBER', '1-3'), estimate_min: S('NUMBER', 'Minuter'),
      project: S('STRING', 'Projekt-id'), time: S('STRING', 'Klockslag HH:MM, eller tom sträng för att ta bort'),
    } } },
  { name: 'delete_task', description: 'Ta bort en task helt.',
    parameters: { type: 'OBJECT', required: ['task'], properties: { task: S('STRING', 'Task-id eller titel') } } },
  { name: 'set_shift', description: 'Ändra skift för ett datum (byte, sjuk, ledig). code: koder från skiftlistan, eller "auto" för att återställa.',
    parameters: { type: 'OBJECT', required: ['date', 'code'], properties: {
      date: S('STRING', 'YYYY-MM-DD'), code: S('STRING', 'Skiftkod eller auto'),
    } } },
  { name: 'save_idea', description: 'Spara en idé i idébanken.',
    parameters: { type: 'OBJECT', required: ['text'], properties: { text: S('STRING', 'Idén'), project: S('STRING', 'Projekt-id') } } },
  { name: 'run_claude', description: 'Starta ett Claude Code-jobb i ett projekts mapp på datorn. Använd för allt som innebär att bygga, ändra kod eller filer i ett projekt. Drar från Claude-veckobudgeten.',
    parameters: { type: 'OBJECT', required: ['project', 'instruction'], properties: {
      project: S('STRING', 'Projekt-id'),
      instruction: S('STRING', 'Tydlig, fullständig instruktion till Claude Code på svenska'),
      task: S('STRING', 'Task-id som ska bockas av när jobbet är klart (valfritt)'),
      continue_last: S('BOOLEAN', 'Fortsätt i samma Claude-konversation som förra jobbet i projektet (för följdfrågor och ändringar)'),
    } } },
  { name: 'pc_control', description: 'Styr datorn: öppna webbsida/program/mapp, mediaknappar (spela/pausa/nästa/volym), låsa, viloläge, stänga av (med fördröjning) eller skriva text.',
    parameters: { type: 'OBJECT', required: ['action'], properties: {
      action: S('STRING', 'En av: open_url, open_app, open_folder, media, lock, sleep, shutdown, cancel_shutdown, type_text'),
      url: S('STRING', 'För open_url'), name: S('STRING', 'Programnamn för open_app, t.ex. spotify, discord, chrome, steam, vscode'),
      path: S('STRING', 'Mapp för open_folder'), text: S('STRING', 'Text för type_text'),
      media: S('STRING', 'För media: playpause, next, previous, mute, volume_up, volume_down'),
      minutes: S('NUMBER', 'Minuter till avstängning (minst 0.5)'),
    } } },
  { name: 'tv_control', description: 'Styr TV:n (Google TV/Android TV) över nätverket: slå på/av, volym, navigeringsknappar, spela/pausa, öppna appar (Netflix, YouTube m.m.) eller länkar, och spela en viss låt/video direkt (action play). Första gången måste TV:ns IP anges med action connect.',
    parameters: { type: 'OBJECT', required: ['action'], properties: {
      action: S('STRING', 'En av: connect, power_on, power_off, volume, key, open_app, open_url, type_text, play, max_volume, status'),
      ip: S('STRING', 'TV:ns IP-adress (bara för connect, sparas sen)'),
      key: S('STRING', 'För key: home, back, up, down, left, right, ok, menu, playpause, play, pause, next, previous, mute, volume_up, volume_down, channel_up, channel_down, input, settings'),
      direction: S('STRING', 'För volume: up eller down'), steps: S('NUMBER', 'För volume: antal steg, standard 3'),
      name: S('STRING', 'Appnamn för open_app: youtube, netflix, disney, viaplay, svt, max, prime, spotify, twitch, tv4, plex, kodi'),
      url: S('STRING', 'Länk för open_url'), text: S('STRING', 'Text för type_text'),
      query: S('STRING', 'För play: låt/video att spela, t.ex. "FTS Showtech" (låtnamn + artist)'), app: S('STRING', 'För play: spotify (standard för musik) eller youtube'),
    } } },
  { name: 'money_pot', description: 'Pengapotten: användarens budget som agenten Pengajakten föreslår hur den ska användas för att tjäna pengar. Visa status, sätt budget, godkänn/avböj förslag, logga resultat eller leta nya förslag.',
    parameters: { type: 'OBJECT', required: ['action'], properties: {
      action: S('STRING', 'En av: status, budget, approve, decline, result, hunt, build (= låt Claude bygga första versionen av ett godkänt nytt projekt)'),
      kr: S('NUMBER', 'För budget: potten i kr. För result: hur mycket förslaget gav tillbaka i kr'),
      proposal: S('STRING', 'Förslagets id eller del av titeln (för approve, decline, result)'),
    } } },
  { name: 'read_mail', description: 'Visa de senaste mejlen som kommit in (alla kopplade inkorgar) med kort sammanfattning.',
    parameters: { type: 'OBJECT', properties: { count: S('NUMBER', 'Hur många, standard 10') } } },
  { name: 'add_goal', description: 'Lägg till ett mål med deadline, t.ex. "första betalande kunden innan jul". Bryt sedan ner det i tasks med add_task.',
    parameters: { type: 'OBJECT', required: ['title'], properties: {
      title: S('STRING', 'Målet'), project: S('STRING', 'Projekt-id'), deadline: S('STRING', 'YYYY-MM-DD'),
      target: S('NUMBER', 'Siffra att nå om målet är mätbart, t.ex. 5 kunder'), unit: S('STRING', 'Enhet, t.ex. kunder, kr, följare'),
    } } },
  { name: 'update_goal', description: 'Uppdatera ett mål: nytt nuläge, klart, ändrad deadline eller ta bort.',
    parameters: { type: 'OBJECT', required: ['goal'], properties: {
      goal: S('STRING', 'Mål-id eller del av titeln'), current: S('NUMBER', 'Nuvarande värde'), done: S('BOOLEAN', 'Klart'),
      deadline: S('STRING', 'YYYY-MM-DD'), remove: S('BOOLEAN', 'Ta bort målet'),
    } } },
  { name: 'add_income', description: 'Logga en inkomst eller utgift för ett projekt (negativt belopp = utgift).',
    parameters: { type: 'OBJECT', required: ['amount', 'project'], properties: {
      amount: S('NUMBER', 'Belopp i kr, negativt för utgift'), project: S('STRING', 'Projekt-id'),
      note: S('STRING', 'Vad det gällde, t.ex. "hemsida Salong X"'), date: S('STRING', 'YYYY-MM-DD, standard idag'),
    } } },
  { name: 'income_report', description: 'Sammanställ inkomster/utgifter per projekt och månad.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'start_focus', description: 'Starta fokusläge: inga notiser utom viktiga, timer på skärmen.',
    parameters: { type: 'OBJECT', properties: { minutes: S('NUMBER', 'Hur länge, standard 50'), task: S('STRING', 'Task-id eller vad han ska jobba med') } } },
  { name: 'stop_focus', description: 'Avsluta fokusläget.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'video_projects', description: 'Lista videoprojekten och deras klipp.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'video_edit', description: 'Låt Claude redigera video i ett videoprojekt: klippa, slå ihop, captions, text, zoom, övergångar, musik, format för TikTok/Shorts osv. Drar från Claude-budgeten.',
    parameters: { type: 'OBJECT', required: ['instruction'], properties: { project: S('STRING', 'Projekt-id eller namn'), instruction: S('STRING', 'Exakt vad som ska göras, med alla detaljer han sagt') } } },
  { name: 'make_trailer', description: 'Gör en trailer för en hemsida: Claude spelar in sajten (scrollar mjukt genom sidorna) och klipper ihop en trailer med text och övergångar. Drar från Claude-budgeten.',
    parameters: { type: 'OBJECT', required: ['url'], properties: {
      url: S('STRING', 'Sajten, t.ex. minsajt.se'), length: S('NUMBER', 'Sekunder, standard 30'),
      format: S('STRING', '9:16 (TikTok/Reels, standard) eller 16:9 (YouTube)'), style: S('STRING', 'Önskemål om stil, tempo, text'),
      project: S('STRING', 'Befintligt videoprojekt med uppladdad musik/klipp (valfritt)'),
    } } },
  { name: 'run_agent', description: 'Kör en av agenterna direkt: pengajakt (förslag att tjäna pengar), ideer (idéer för projekten), veckorapport.',
    parameters: { type: 'OBJECT', required: ['agent'], properties: { agent: S('STRING', 'pengajakt, ideer eller veckorapport') } } },
  { name: 'pc_agent', description: 'Låt HEIMDALL ta över datorn och göra något som kräver att titta på skärmen, klicka, scrolla och skriva — t.ex. "leta upp en rolig video på YouTube och spela den", "fyll i formuläret", "hitta mejlet från X". Körs i bakgrunden; du får besked när det är klart.',
    parameters: { type: 'OBJECT', required: ['goal'], properties: { goal: S('STRING', 'Tydligt mål på svenska, med alla detaljer han sagt') } } },
  { name: 'pc_agent_stop', description: 'Stoppa datoragenten direkt.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'phone_shortcut', description: 'Kör en Genväg (Shortcuts) på iPhonen, t.ex. alarm, fokusläge, spela musik, skicka sms. Funkar när HEIMDALL är öppen på telefonen.',
    parameters: { type: 'OBJECT', required: ['name'], properties: {
      name: S('STRING', 'Genvägens exakta namn'), input: S('STRING', 'Text som skickas in i genvägen (valfritt)'),
    } } },
  { name: 'add_word', description: 'Lägg till ett namn eller ord i ordlistan så HEIMDALL alltid hör och stavar det rätt (t.ex. kompisars namn).',
    parameters: { type: 'OBJECT', required: ['word'], properties: { word: S('STRING', 'Exakt stavning'), note: S('STRING', 'Vem/vad det är, t.ex. "kompis på Discord"') } } },
  { name: 'set_settings', description: 'Ändra inställningar: morgonbrief/kvällssummering (tid HH:MM, av/på) och samtalsröst.',
    parameters: { type: 'OBJECT', properties: {
      morningTime: S('STRING', 'HH:MM'), morningOn: S('BOOLEAN', 'Morgonbrief på/av'),
      eveningTime: S('STRING', 'HH:MM'), eveningOn: S('BOOLEAN', 'Kvällssummering på/av'),
      voice: S('STRING', 'Röst i samtal: Achird, Sulafat, Gacrux, Charon, Puck, Kore, Fenrir, Aoede, Orus, Zephyr, Leda'),
      incomeGoal: S('NUMBER', 'Inkomstmål per månad i kr (extra pengar från alla projekt)'),
    } } },
  { name: 'n8n', description: 'n8n-flöden (automationer): visa status och senaste körning, starta eller pausa ett flöde.',
    parameters: { type: 'OBJECT', required: ['action'], properties: {
      action: S('STRING', 'En av: list, start, pause'), name: S('STRING', 'Flödets namn eller del av det (för start/pause)'),
    } } },
  { name: 'macro', description: 'Egna kommandon: skapa ett kommando som kör flera saker på en gång (t.ex. "Godnatt" = stäng av TV:n och lås datorn), kör, lista eller ta bort.',
    parameters: { type: 'OBJECT', required: ['action'], properties: {
      action: S('STRING', 'En av: create, run, list, delete'),
      name: S('STRING', 'Kommandots namn, det han säger, t.ex. "Godnatt"'),
      steps: S('STRING', 'För create: vad kommandot ska göra, i hans egna ord, t.ex. "stäng av TV:n och lås datorn"'),
    } } },
  { name: 'update_self', description: 'Uppdatera HEIMDALL till senaste versionen (startar om). Bara när användaren ber om det.',
    parameters: { type: 'OBJECT', properties: {} } },
  { name: 'set_budget', description: 'Uppdatera hur många procent av Claude-veckobudgeten som är kvar.',
    parameters: { type: 'OBJECT', required: ['percent'], properties: { percent: S('NUMBER', '0-100') } } },
];

// Gemini först (gratis). Är kvoten slut tar Claude över.
async function chat(args) {
  try {
    return await geminiChat(args);
  } catch (e) {
    if (!e.quota) throw e;
    console.log('Gemini-kvoten slut, kärnan kör via Claude');
    try {
      return await require('./claudechat').chat({ ...args, tools: TOOLS });
    } catch (ce) {
      throw new Error(`${e.message} Claude-reserven funkade inte heller: ${ce.message}`);
    }
  }
}

async function geminiChat({ history, message, systemPrompt, handlers }) {
  const contents = [
    ...history.slice(-16).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  const actions = [];

  for (let round = 0; round < 6; round++) {
    const json = await call({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      generationConfig: { temperature: 0.4 },
    });
    const content = json.candidates?.[0]?.content;
    if (!content?.parts) return { text: 'Jag fick inget svar. Försök igen.', actions };

    const calls = content.parts.filter(p => p.functionCall);
    if (!calls.length) {
      const text = content.parts.map(p => p.text || '').join('').trim();
      return { text: text || 'Klart.', actions };
    }

    contents.push(content);
    const responses = [];
    for (const { functionCall: fc } of calls) {
      let result;
      try {
        const h = handlers[fc.name];
        result = h ? await h(fc.args || {}) : { error: 'okänt verktyg' };
      } catch (e) {
        result = { error: e.message };
      }
      actions.push({ tool: fc.name, args: fc.args, ok: !result?.error });
      responses.push({ functionResponse: { name: fc.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { text: 'Jag gjorde det jag kunde, kolla schemat.', actions };
}

async function transcribe(base64, mimeType) {
  const json = await call({
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: 'Transkribera ljudet ordagrant. Det är troligen svenska. Svara bara med texten, inget annat.' },
    ] }],
    generationConfig: { temperature: 0 },
  });
  return (json.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

// En enkel fråga utan verktyg. json=true ger tillbaka ett objekt. schema = exakt mall för svaret.
let lastRaw = '';
async function ask(prompt, json = false, image = null, schema = null) {
  const body = mime => ({
    contents: [{ role: 'user', parts: [...(image ? [image] : []), { text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192, ...(mime ? { responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) } : {}) },
  });
  const read = res => {
    const c = res.candidates?.[0];
    const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
    lastRaw = text ? text.slice(0, 300) : `tomt svar (${c?.finishReason || res.promptFeedback?.blockReason || 'okänd orsak'})`;
    return text;
  };
  if (!json) return read(await call(body(false)));
  let text = read(await call(body(true)));
  let v = text ? parseJson(text) : null;
  if (v == null) { // försök en gång till utan JSON-läget
    text = read(await call(body(false)));
    v = text ? parseJson(text) : null;
  }
  return v;
}
const getLastRaw = () => lastRaw;

// Fråga med Google-sökning (gratis i Gemini). Svarar med text + källor.
async function search(prompt) {
  const res = await call({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  });
  const c = res.candidates?.[0];
  const text = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  const sources = (c?.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(Boolean).map(w => ({ title: w.title, url: w.uri }));
  return { text, sources, json: parseJson(text) };
}

// Plockar ut JSON även om AI:n lagt text runt den eller svarat med en lista
function parseJson(text) {
  const tryParse = s => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  if (v === undefined) { const m = text.match(/\{[\s\S]*\}/); if (m) v = tryParse(m[0]); }
  if (Array.isArray(v)) v = v[0];
  if (v === undefined || v === null) { console.log('Kunde inte tolka AI-svar:', text.slice(0, 300)); return null; }
  return v;
}

module.exports = { chat, transcribe, ask, search, getLastRaw, parseJson, TOOLS, defaultModel: model };
