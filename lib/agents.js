// Agenter: små medarbetare som jobbar själva enligt schema och rapporterar till dig.
// De drivs av gratis-Gemini med Google-sökning och drar inget från Claude-budgeten.
const { db, save, id, today } = require('./db');
const brain = require('./brain');
const claudechat = require('./claudechat');

// Gemini först (gratis, flera nycklar). Är kvoten slut: Groq (gratis, i molnet, utan datorn),
// sen Claude via datorn om den är på. Annars nytt försök om 90 min.
const groq = require('./groq');
const isQuota = e => !!e?.quota || /gräns|quota|429|RESOURCE_EXHAUSTED|overloaded|high demand|rate limit/i.test(e?.message || '');
async function fallback(prompt, web, first) {
  const why = [];
  if (groq.has()) {
    try { return { text: await groq.ask(web ? `${prompt}\n\nSök på nätet för att hitta aktuell information. Svara bara med JSON, ingen annan text.` : prompt, { web }), via: 'groq' }; }
    catch (g) { why.push(`Groq: ${g.message}`); }
  }
  try { return { text: await claudechat.raw(web ? `${prompt}\n\nSök på nätet med WebSearch/WebFetch. Svara bara med JSON, ingen annan text.` : prompt, { web }), via: 'claude' }; }
  catch (c) { why.push(c.message); }
  throw Object.assign(new Error(`Googles gratiskvot är slut och reserverna svarade inte (${why.join(' · ')})`), { quota: true, first });
}
async function search(prompt) {
  try { return await brain.search(prompt); }
  catch (e) {
    if (!isQuota(e)) throw e;
    const { text, via } = await fallback(prompt, true, e);
    return { text, sources: [], json: brain.parseJson(text), via };
  }
}
async function ask(prompt) {
  try { return await brain.ask(prompt); }
  catch (e) {
    if (!isQuota(e)) throw e;
    return (await fallback(prompt, false, e)).text;
  }
}

// Vem agenterna jobbar åt (från config.json)
let cfg = { owner: 'Användaren', about: '', projects: [] };
const setConfig = c => { if (c) cfg = c; };
const who = () => cfg.owner || 'Användaren';
const projList = () => (cfg.projects || []).filter(p => p.id !== 'ovrigt').map(p => `- ${p.name}: ${p.description || ''}`).join('\n') || '(inga projekt inlagda än)';

// ---------- Mejlsvar ----------
// Skriver svarsförslag på mejl från riktiga människor till inkorgar som har "svar" som filter i .env
async function draftReply(mail) {
  const thread = (db.mails || []).filter(m => m.account === mail.account && m.fromAddr === mail.fromAddr).slice(0, 5);
  const firstContact = thread.length <= 1 && !mail.isReply;
  const text = await ask(`Du skriver ett svarsförslag åt ${who()}.
Om ${who()}: ${cfg.about || '(ingen beskrivning)'}
Projekt:
${projList()}

Mejl till inkorgen ${mail.account} från ${mail.from} <${mail.fromAddr}>
Ämne: ${mail.subject}
${mail.text || mail.summary}

Skriv svaret på samma språk som mejlet, i vanlig, proffsig men personlig ton: stor bokstav, normal interpunktion.
${firstContact ? 'Det är första kontakten: börja med en hälsning med mottagarens förnamn och avsluta med en hälsningsfras och ' + who() + 's namn.' : 'Det är en pågående tråd: gå rakt på sak, ingen hälsningsfras, upprepa inte sånt mottagaren redan vet.'}
Håll det kort (3–6 meningar). Föreslå ett tydligt nästa steg. Hitta inte på priser, datum eller löften — skriv [PRIS] eller [DATUM] där ${who()} måste fylla i.
Svara bara med själva mejltexten.`);
  return report('mejlsvar', {
    title: `Svarsförslag till ${mail.from}`,
    body: mail.summary,
    draft: text.trim(),
    to: mail.fromAddr,
    subject: /^(re|sv):/i.test(mail.subject) ? mail.subject : `Sv: ${mail.subject}`,
  });
}

// ---------- Idéer ----------
async function ideas() {
  const r = await search(`Du är idé-agent åt ${who()}. Idag är ${today()}.
Om ${who()}: ${cfg.about || '(ingen beskrivning)'}
Projekt:
${projList()}

Sök vad som händer och trendar just nu inom områdena för projekten ovan. Föreslå 5 konkreta, aktuella idéer (innehåll, funktioner, kampanjer eller förbättringar) som kan ge fler besökare, följare eller kunder.
Svara med JSON och inget annat: {"ideas": [{"title": "kort idé", "why": "varför den är aktuell nu, 1 mening på svenska", "items": ["2–4 konkreta steg"]}]}`);
  const list = r.json?.ideas || [];
  return report('ideer', {
    title: list.length ? `${list.length} nya idéer` : 'Inga idéer den här gången',
    body: list.map(i => `${i.title} — ${i.why}`).join('\n'),
    ideas: list,
    sources: r.sources.slice(0, 8),
  });
}

// ---------- Pengajakten (Pengapotten) ----------
async function moneyHunt() {
  const pot = require('./pot');
  const st = pot.stats();
  const r = await search(`Du är affärsagent åt ${who()}. Målet är att tjäna mer pengar — både snabba pengar och saker som kan växa till riktiga inkomstkällor. Idag är ${today()}.
Om ${who()}: ${cfg.about || '(ingen beskrivning — utgå från en vanlig person med jobb och lite fritid som kan använda AI-verktyg)'}
Projekt:
${projList()}

Potten: ${st.left} kr kvar att lägga (budget ${st.budget} kr). Ett förslag får kosta högst det, gärna 0 kr.
Redan gjort/avböjt (föreslå inte samma igen): ${pot.history().join('; ') || 'inget än'}

Ge 4–5 förslag:
- 2–3 SNABBA: ger pengar inom en månad med befintliga projekt, färdigheter eller flipp (köpa billigt begagnat och sälja dyrare).
- 1–2 NYA PROJEKT (track "Nytt projekt"): en ny inkomstkälla som kan skala och rulla mer eller mindre av sig själv — t.ex. en nischad sajt/app/SaaS, digital produkt, automatiserad tjänst, mall-/verktygsförsäljning, AI-driven innehållskanal. Något som realistiskt kan byggas på kvällar med AI-verktyg som Claude Code, med låg startkostnad. Sök efter verkliga exempel och efterfrågan (vad folk betalar för, konkurrenter, priser) så det är grundat. Ange monthly = vad det realistiskt kan dra in per månad efter ca 6 månader om det går bra.

Regler: aldrig ringa folk, inget spel/betting, krypto, aktier, lån eller pyramidupplägg. Ärliga siffror, inte "bli rik snabbt".

Svara med JSON och inget annat:
{"proposals": [{"title": "kort och konkret", "track": "Nytt projekt|Befintligt projekt|Flipp|Övrigt", "why": "varför det kan ge pengar och bevis/efterfrågan, 1–3 meningar", "steps": ["konkreta steg"], "cost": kronor_insats, "expected": kronor_inom_en_månad, "monthly": kronor_per_månad_efter_6_mån_eller_0, "hours": timmar_att_komma_igång, "risk": "låg|medel|hög", "link": "källa eller tom"}]}`);
  const added = pot.addProposals(r.json?.proposals);
  return report('pengajakt', {
    title: added.length ? `${added.length} nya förslag till Pengapotten` : 'Inga nya förslag',
    body: added.map(x => `${x.title} — ${x.cost} kr → ca ${x.expected} kr`).join('\n'),
  });
}

// ---------- Veckorapport ----------
async function weeklyReport() {
  const weekAgo = Date.now() - 7 * 86400000;
  const done = (db.tasks || []).filter(t => t.done && t.doneAt && new Date(t.doneAt).getTime() > weekAgo);
  const open = (db.tasks || []).filter(t => !t.done && t.date <= new Date(Date.now() + 7 * 86400000).toLocaleDateString('sv-SE'));
  const money = (db.income || []).filter(e => new Date(e.date + 'T12:00').getTime() > weekAgo);
  const net = money.reduce((a, e) => a + e.amount, 0);
  const month = today().slice(0, 7);
  const monthNet = (db.income || []).filter(e => e.date.startsWith(month)).reduce((a, e) => a + e.amount, 0);
  const goal = db.settings.incomeGoal || 0;
  const pot = require('./pot').view();
  const ideas = pot.proposals.filter(x => x.status === 'förslag').slice(0, 3).map(x => x.title);
  const shifts = require('./shifts').range(new Date(Date.now() + 86400000).toLocaleDateString('sv-SE'), 7).map(d => `${d.weekday} ${d.name}${d.start ? ' ' + d.start : ''}`);
  const text = await ask(`Skriv veckorapporten till ${who()} på svenska, kort och peppig men ärlig. Max 6 korta rader, varje rad börjar med en emoji. Inga rubriker.
Klart den här veckan (${done.length} st): ${done.map(t => t.title).slice(0, 15).join(', ') || 'inget'}
Pengar in/ut den här veckan: ${net} kr (${money.map(e => `${e.amount} kr ${e.note || e.project}`).slice(0, 8).join('; ') || 'inget loggat'})
Den här månaden: ${monthNet} kr${goal ? ` av målet ${goal} kr/mån` : ''}
Pengapotten: ${pot.left} kr kvar, netto ${pot.net} kr. Obesvarade förslag: ${ideas.join(' | ') || 'inga'}
Öppna uppgifter närmaste veckan: ${open.map(t => t.title).slice(0, 10).join(', ') || 'inga'}
Nästa veckas skift: ${shifts.join(', ')}
Avsluta med EN sak som är viktigast nästa vecka, och när i schemat det finns tid att göra den.`);
  return report('veckorapport', { title: `Veckan: ${done.length} klara · ${net >= 0 ? '+' : ''}${net} kr`, body: text.trim() });
}

const AGENTS = {
  veckorapport: { name: 'Veckorapport', desc: 'Söndag kväll: vad du fått klart, pengar in, hur nära månadsmålet du är, Pengapotten och veckans viktigaste sak.', schedule: 'Söndagar 19:07', when: d => d.getDay() === 0 && d.getHours() === 19 && d.getMinutes() === 7, key: () => `ag-vr-${today()}`, run: weeklyReport },
  pengajakt: { name: 'Pengajakten', desc: 'Letar snabba pengar och helt nya projekt som kan bli egna inkomstkällor. Föreslår vad potten ska läggas på — du godkänner allt själv.', schedule: 'Måndagar + torsdagar 11:17', when: d => [1, 4].includes(d.getDay()) && d.getHours() === 11 && d.getMinutes() === 17, key: () => `ag-pj-${today()}`, run: moneyHunt },
  ideer: { name: 'Idéer', desc: 'Kollar vad som trendar inom dina projekt och föreslår konkreta idéer för fler besökare, följare eller kunder.', schedule: 'Onsdagar 12:13', when: d => d.getDay() === 3 && d.getHours() === 12 && d.getMinutes() === 13, key: () => `ag-id-${today()}`, run: ideas },
  mejlsvar: { name: 'Mejlsvar', desc: 'Skriver ett svarsförslag direkt när en riktig människa mejlar en inkorg som har "svar" som filter.', schedule: 'Vid varje nytt mejl', when: () => false, key: () => '', run: async () => report('mejlsvar', { title: 'Körs automatiskt när mejl kommer', body: 'Mejlsvar startar av sig själv när ett mejl kommer till en inkorg med filtret "svar".' }) },
};

const running = new Set();
async function run(agentId, ctx, notify) {
  const a = AGENTS[agentId];
  if (!a) throw new Error(`okänd agent: ${agentId}`);
  if (running.has(agentId)) return { busy: true };
  running.add(agentId);
  try {
    const rep = await a.run(ctx);
    notify(`${a.name}: ${rep.title}`, (rep.body || '').split('\n')[0].slice(0, 160));
    return rep;
  } catch (e) {
    console.log(`Agent ${agentId}:`, e.message);
    // Kvoten slut: försök igen själv om 90 min (max 3 gånger per dag) i stället för att visa fel
    db.agentRetry = db.agentRetry || {};
    const prev = db.agentRetry[agentId];
    const tries = prev?.day === today() ? prev.tries + 1 : 1;
    if (isQuota(e) && tries <= 3) {
      db.agentRetry[agentId] = { day: today(), tries, at: Date.now() + 90 * 60000 };
      save();
      return { waiting: true, retryAt: db.agentRetry[agentId].at };
    }
    delete db.agentRetry[agentId]; save();
    return report(agentId, { title: 'Misslyckades', body: isQuota(e) ? 'Googles gratiskvot var slut hela dagen och reserverna svarade inte. Försöker igen vid nästa schemalagda körning.' : e.message, failed: true });
  } finally { running.delete(agentId); }
}

// Anropas varje minut av schemaläggaren
function tick(now, ctx, notify) {
  db.sent = db.sent || {};
  for (const [aid, a] of Object.entries(AGENTS)) {
    if (!a.when(now)) continue;
    const k = a.key(now);
    if (db.sent[k]) continue;
    db.sent[k] = Date.now(); save();
    run(aid, ctx, notify).catch(() => {});
  }
  // Nya försök för agenter som stoppades av kvoten
  for (const [aid, r] of Object.entries(db.agentRetry || {})) {
    if (r.at && r.at <= Date.now() && !running.has(aid)) { r.at = null; save(); run(aid, ctx, notify).catch(() => {}); }
  }
}

// Städa bort gamla fel om kvoten och svarsförslag till automatiska mejl
db.agentReports = (db.agentReports || []).filter(r => !(r.failed && /gräns|quota/i.test(r.body || '')) && !(r.draft && require('./mail').isAutomated(r.to, r.subject)));

module.exports = { setConfig, AGENTS, run, tick, draftReply, list: () => Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name, desc: a.desc, schedule: a.schedule, running: running.has(id), retryAt: db.agentRetry?.[id]?.at || null })) };
