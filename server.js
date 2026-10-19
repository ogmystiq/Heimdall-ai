// HEIMDALL — kärnan. Körs i molnet (Render) och/eller på din Windows-dator, se lib/mode.js.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- .env ---
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// --- config ---
const cfgFile = path.join(__dirname, 'config.json');
if (!fs.existsSync(cfgFile)) fs.copyFileSync(path.join(__dirname, 'config.example.json'), cfgFile);
let config = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
// Nya standardvärden (t.ex. skiftschemat) förs in i din config.json om du inte redan har egna
{
  const ex = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.example.json'), 'utf8'));
  let changed = false;
  if (!config.shifts?.pattern?.length && ex.shifts?.pattern?.length) { config.shifts = ex.shifts; changed = true; }
  for (const k of Object.keys(ex)) if (config[k] === undefined) { config[k] = ex[k]; changed = true; }
  if (changed) fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));
}

const { db, save, today, addTask, completeTask, updateTask, deleteTask, findTask, id } = require('./lib/db');
const shifts = require('./lib/shifts');
const claude = require('./lib/claude');
const brain = require('./lib/brain');
const activeModel = require('./lib/activemodel');
const push = require('./lib/push');
const pc = require('./lib/pc');
const tv = require('./lib/tv');
const pot = require('./lib/pot');
const macros = require('./lib/macros');
const n8n = require('./lib/n8n');
const scheduler = require('./lib/scheduler');
const autocheck = require('./lib/autocheck');
const agent = require('./lib/agent');
const mail = require('./lib/mail');
const agents = require('./lib/agents');
agents.setConfig(config);
const video = require('./lib/video');
const mode = require('./lib/mode');
const tunnel = require('./lib/tunnel');
const claudechat = require('./lib/claudechat');
const agentNotify = (title, body) => { broadcast('notify', { title, body }); push.send(title, body).catch(() => {}); broadcast('state'); };
agent.bus.on('update', j => broadcast('agent', { goal: j.goal, status: j.status, step: j.steps.at(-1)?.text || '', steps: j.steps.length, summary: j.summary }));
agent.bus.on('done', j => {
  db.agentRuns = [{ goal: j.goal, status: j.status, summary: j.summary, steps: j.steps.slice(-30), at: new Date().toISOString() }, ...(db.agentRuns || [])].slice(0, 10);
  save(); broadcast('state');
  const title = j.status === 'klar' ? 'Klart på datorn' : j.status === 'stoppad' ? 'Datorjobbet stoppat' : 'Datorjobbet gick inte';
  broadcast('notify', { title, body: j.summary || j.goal });
  push.send(title, j.summary || j.goal).catch(() => {});
  try { require('./lib/live').sayToAll(`${title}: ${j.summary || j.goal}`); } catch {}
});
shifts.setConfig(config.shifts);

// Sajter som bevakas (config.json → "monitors": [{ "name": "minsajt.se", "url": "https://minsajt.se" }])
const MONITORS = () => config.monitors || [];
const OWNER = () => config.owner || 'användaren';

const PORT = Number(process.env.PORT || 4777);
const HOST = mode.isCloud() ? '0.0.0.0' : '127.0.0.1';
const TOKEN = process.env.HEIMDALL_TOKEN || '';
if (!TOKEN) console.warn('⚠  HEIMDALL_TOKEN saknas i .env — sätt en lång kod innan du kopplar in mobilen.');

// HEIMDALL är alltid ett eget projekt, så du kan bygga vidare på den inifrån sig själv
if (!config.projects.some(p => p.id === 'heimdall')) {
  config.projects.push({ id: 'heimdall', name: 'HEIMDALL', color: '#7fe9ff', path: __dirname,
    description: 'HEIMDALL själv — bygg nya funktioner och fixa buggar',
    rules: 'Läs CLAUDE.md först och följ den. Rör aldrig .env, config.json eller data/. Committa eller pusha inte själv.' });
}

// Inställningar som molnet får från datorn (config.json där) eller från appen — sparas i databasen
const CFG_KEYS = ['owner', 'about', 'vocab', 'monitors', 'projects', 'shifts', 'planning'];
const pickConfig = () => Object.fromEntries(CFG_KEYS.filter(k => config[k] !== undefined).map(k => [k, config[k]]));
function applyConfig(c = {}) {
  for (const k of CFG_KEYS) if (c[k] !== undefined) config[k] = c[k];
  shifts.setConfig(config.shifts);
}
if (mode.isCloud() && db.config) applyConfig(db.config);
function saveConfig(c) {
  applyConfig(c);
  if (mode.isCloud()) { db.config = { ...(db.config || {}), ...Object.fromEntries(CFG_KEYS.filter(k => c[k] !== undefined).map(k => [k, c[k]])) }; save(); }
  else fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));
}

// Nya projekt som Claude bygger från Pengapotten hamnar här på datorn
const NEW_ROOT = () => process.env.NEW_PROJECTS_DIR || path.join(require('os').homedir(), 'heimdall-projekt');
const slugify = t => String(t || 'projekt').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projekt';
const projectById = pid => {
  const s = String(pid || '');
  if (s.startsWith('ny:')) { const slug = slugify(s.slice(3)); return { id: `ny:${slug}`, name: `Nytt: ${slug}`, path: path.join(NEW_ROOT(), slug), rules: '' }; }
  if (s.startsWith('video:')) { try { return { id: s, name: `Video: ${s.slice(6)}`, path: video.dir(s.slice(6)), rules: '' }; } catch { return null; } }
  return config.projects.find(p => p.id === s.toLowerCase()) || config.projects.find(p => p.name.toLowerCase() === s.toLowerCase());
};

// "Bygg det": Claude sätter upp en första version av ett nytt projekt i en egen mapp (körs på datorn)
function startBuild({ title, why, steps, monthly }) {
  const slug = slugify(title);
  const dir = path.join(NEW_ROOT(), slug);
  fs.mkdirSync(dir, { recursive: true });
  const { execFileSync } = require('child_process');
  const g = args => execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: 'pipe' });
  if (!fs.existsSync(path.join(dir, '.git'))) {
    g(['init', '-b', 'main']);
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${title}\n\n${why || ''}\n`);
    g(['add', 'README.md']);
    try { g(['commit', '-m', 'Start']); } catch {}
  }
  const instruction = `Du sätter upp en första version (MVP) av ett nytt projekt åt ${OWNER()}. Målet är att det ska kunna bli en egen inkomstkälla.
Projekt: ${title}
Varför: ${why || '—'}
${steps?.length ? 'Plan: ' + steps.join(' → ') : ''}
${monthly ? `Mål: ca ${monthly} kr/mån efter 6 månader.` : ''}

Gör så här:
1. Skriv en kort PLAN.md på svenska: målgrupp, vad de betalar för, intäktsmodell och pris, hur man når första kunderna utan att ringa någon, och de 5 nästa stegen.
2. Bygg den enklaste versionen som går att visa upp: en snygg landningssida (en index.html med inbyggd CSS, mobil först) som förklarar erbjudandet och har ett sätt att visa intresse/köpa. Bygg kärnfunktionen om den är liten.
3. Inga onödiga beroenden. Committa eller pusha inte.
Avsluta med 3 meningar: vad du byggde, var filerna ligger och vad ${OWNER()} ska göra härnäst.`;
  const job = claude.startJob({ project: { id: `ny:${slug}`, name: `Nytt: ${title}`, path: dir, rules: '' }, instruction });
  return { started: true, jobId: job.id, dir };
}

// --- state ---
function addDays(date, n) {
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE');
}

// Det datorn sköter (jobb, video, datorjobb) — i molnet hämtas det från datorn via tunneln
let pcCache = { jobs: [], weekCost: 0, agentRuns: [], video: { ffmpeg: false, root: '', projects: [] } };
function pcState() {
  return {
    jobs: db.jobs.slice(0, 30).map(claude.publicJob),
    weekCost: claude.weekCost(),
    agentRuns: db.agentRuns || [],
    video: { ffmpeg: video.ffmpegOk(), root: video.ROOT(), projects: video.list() },
  };
}
const pcPart = () => mode.isCloud() ? pcCache : pcState();
const weekCost = () => pcPart().weekCost || 0;

function state() {
  const t = today();
  const pcp = pcPart();
  return {
    today: t,
    projects: config.projects.map(({ id, name, color, description }) => ({ id, name, color, description })),
    shiftTypes: config.shifts?.types || {},
    hasShifts: !!config.shifts?.pattern?.length,
    owner: config.owner || '',
    about: config.about || '',
    shifts: shifts.range(addDays(t, -1), 15),
    tasks: db.tasks,
    ideas: db.ideas,
    jobs: pcp.jobs,
    settings: db.settings,
    monitors: MONITORS().map(m => ({ ...m, ...(db.monitor?.[m.url] || { up: true }) })),
    pushCount: (db.pushSubs || []).length,
    mails: mail.recent(8),
    agentRuns: pcp.agentRuns,
    goals: db.goals || [],
    agents: agents.list(),
    agentReports: (db.agentReports || []).slice(0, 40),
    pot: pot.view(),
    n8n: n8n.view(),
    video: pcp.video,
    pc: mode.isCloud() ? { mode: 'cloud', online: tunnel.pcOnline(), ...(tunnel.pcInfo() || {}) } : { mode: mode.mode(), online: true },
    income: (db.income || []).slice(-50),
    incomeReport: incomeReport(),
    focus: db.focus && db.focus.until > Date.now() ? db.focus : null,
    mailStatus: mail.status().map(({ name, user, ok, error }) => ({ name, user, ok, error })),
    weekCost: weekCost(),
    activeModel: activeModel.get() || { provider: 'Gemini', model: brain.defaultModel(), at: null, standby: true },
    chat: db.chat.slice(-40),
  };
}

function systemPrompt() {
  const t = today();
  const now = new Date();
  const week = shifts.range(t, 10).map(s => `${s.date} (${s.weekday}): ${s.code} ${s.name || ''} ${s.start ? s.start + '–' + s.end : ''}`).join('\n');
  const open = db.tasks.filter(x => !x.done && x.date <= addDays(t, 21))
    .sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority)
    .map(x => `[${x.id}] ${x.date} ${x.project}: ${x.title} (${x.estimate_min} min, prio ${x.priority}${x.claude_heavy ? ', Claude-tung' : ''})${x.date < t ? ' FÖRSENAD' : ''}`)
    .join('\n') || '(inga öppna tasks)';
  const projects = config.projects.map(p => `- ${p.id}: ${p.name} — ${p.description || ''}`).join('\n');
  const types = Object.entries(config.shifts?.types || {}).map(([k, v]) => `${k} = ${v.name}${v.start ? ` ${v.start}–${v.end}` : ''}`).join(', ');

  return `Du är HEIMDALL, personligt AI-system åt ${OWNER()} — vaktaren som ser allt och aldrig sover.
Om ${OWNER()}: ${config.about || '(ingen beskrivning än)'}
Prata svenska, kort och rakt, lite coolt men inte töntigt. Säg du till ${OWNER()}. Max 2–3 meningar om inget annat behövs. Inga emojis. Ditt svar läses ofta upp med röst, så skriv som man pratar — inga listor eller markdown om han inte ber om det.
Utför saker direkt med verktygen istället för att fråga. Lista ut detaljer själv (vilket program, vilken sida) och fråga bara om något är helt omöjligt att gissa. Misslyckas ett verktyg: prova ett annat sätt (t.ex. pc_agent) innan du ger upp, fråga inte. Ljug aldrig om att något är gjort — bekräfta bara det verktygen faktiskt returnerade.

Nu: ${now.toLocaleString('sv-SE')} (${now.toLocaleDateString('sv-SE', { weekday: 'long' })}).

${config.shifts?.pattern?.length ? `Skiftkoder: ${types}\nSkift kommande dagar:\n${week}` : 'Inget skiftschema inlagt.'}

Projekt:
${projects}

Öppna tasks:
${open}

Namn och ord ${OWNER()} använder (stava alltid exakt så, och tolka liknande ljud som dessa): ${(db.settings.vocab || config.vocab || []).join(', ') || 'inga än'}

Mål: ${(db.goals || []).filter(g => !g.done).map(g => `[${g.id}] ${g.title}${g.deadline ? ' (senast ' + g.deadline + ')' : ''}${g.target != null ? ` ${g.current}/${g.target} ${g.unit}` : ''}`).join('; ') || 'inga än'}
${db.focus && db.focus.until > Date.now() ? `FOKUSLÄGE pågår till ${new Date(db.focus.until).toLocaleTimeString('sv-SE')} (${db.focus.task || ''}) — håll svar extra korta.` : ''}

Claude-veckobudget kvar: ${db.settings.claudeBudgetLeft}% (Claude-jobb senaste 7 dagarna motsvarar ca $${weekCost().toFixed(2)} i API-värde).
${mode.isCloud() ? (tunnel.pcOnline() ? 'Datorn är PÅ: Claude-jobb, video och datorstyrning funkar.' : 'Datorn är AV: Claude-jobb, video och datorstyrning funkar inte just nu — säg det rakt ut om han ber om sånt.') : ''}

Planeringsregler:
- Lediga dagar: tunga pass och Claude-tunga tasks.
- Arbetsdagar: max ${config.planning?.maxMinutesWorkday ?? 60} min, lätta saker. Nattskift: helst inget alls den dagen, och dagen efter natt sover hen länge. Dagskift: bara kvällen är fri.
- Under 25% budget kvar: lägg inte Claude-tunga tasks förrän budgeten återställs ${config.planning?.budgetResetDay || 'på måndag'}.
- Prioritet 1 först. Försenade tasks flyttas till nästa lämpliga dag när han ber dig planera om.
- Mål: när han sätter ett mål, lägg in det med add_goal och föreslå 2–4 konkreta tasks fördelade fram till deadline (lägg in dem direkt). Planera veckor så att målen hinns.
- Pengar: när han säger att han fått betalt eller köpt något till ett projekt, logga det med add_income.
- Säger han en tid ("påminn mig kl 18", "imorgon 14:30") ska tasken få time så han får en push-påminnelse.
- Datorn: EN enkel sak (öppna ett program, musik, volym, låsa) gör du direkt med pc_control — skicka programnamnet precis som han sa det, översätt aldrig. Allt i flera steg (öppna något OCH skriva/klicka/söka i det) gör du med pc_agent direkt. Vill han söka något, öppna en sök-URL med pc_control open_url (t.ex. https://www.youtube.com/results?search_query=rolig+video). Allt som kräver att titta på skärmen och klicka (välja en video, fylla i, leta i ett program) gör du med pc_agent. Säger han stopp: pc_agent_stop.
- TV:n (Google TV/Android TV): styr med tv_control (på/av, volym, knappar, öppna Netflix/YouTube m.m., öppna länk). Vill han höra en viss låt eller se en viss video på TV:n: tv_control action play med query (låt + artist) och app spotify/youtube — säg aldrig att du inte kan. Första gången: be om TV:ns IP-adress och kör action connect — den sparas sen. Gå aldrig via pc_agent för TV:n. Får du fel, läs upp felet rakt av.
- n8n-flöden: n8n med action list/start/pause och flödets namn.
- Egna kommandon (macro): vill han skapa ett kommando, kör create med namn + stegen i hans ord. Säger han namnet på ett befintligt kommando: kör run direkt. Hans kommandon: ${(db.settings.macros || []).map(m => m.name).join(', ') || 'inga än'}.
- Inkomstmål per månad: set_settings incomeGoal (kr).
- Pengapotten: money_pot (status, budget = sätt potten i kr, approve/decline ett förslag, result = logga vad ett förslag gav i kr, hunt = leta nya förslag nu). Spendera aldrig något själv — ${OWNER()} godkänner.
- iPhone-genvägar kör du med phone_shortcut.
- Trailer för en hemsida ("gör en trailer för minsajt.se"): använd make_trailer. Har han laddat upp musik i ett projekt, skicka det projektet.
- Video: vill han redigera/klippa en video, använd video_edit med en tydlig instruktion (format, längd, captions, stil, musik). Kolla video_projects om du är osäker på vilket projekt.
- Stäng aldrig av eller sätt datorn i vila utan att han tydligt bett om det.
- Vill han bygga om eller lägga till något i HEIMDALL självt: run_claude med project "heimdall". Följdfrågor/ändringar på samma sak: continue_last=true så Claude minns sammanhanget.
- När han säger att något är klart: bocka av det. När han ber dig bygga/fixa något i ett projekt: kör run_claude med en tydlig instruktion och koppla matchande task.`;
}

const handlers = {
  list_tasks: ({ from, to, project, include_done }) =>
    db.tasks.filter(t => (include_done || !t.done) && (!from || t.date >= from) && (!to || t.date <= to) && (!project || t.project === project))
      .map(({ id, title, project, date, done, priority }) => ({ id, title, project, date, done, priority })),
  add_task: ({ remind_before, ...a }) => addTask({ ...a, remindBefore: remind_before }),
  complete_task: ({ task }) => completeTask(task, 'röst/chatt') || { error: 'hittade ingen sån task' },
  update_task: ({ task, remind_before, ...patch }) => {
    if (remind_before !== undefined) patch.remindBefore = remind_before;
    if (patch.time === '') patch.time = null;
    return updateTask(task, patch) || { error: 'hittade ingen sån task' };
  },
  delete_task: ({ task }) => deleteTask(task) || { error: 'hittade ingen sån task' },
  set_shift: ({ date, code }) => { shifts.setShift(date, code === 'auto' ? null : code); return { ok: true, date, code }; },
  save_idea: ({ text, project }) => { const i = { id: id(), text, project: project || null, created: new Date().toISOString() }; db.ideas.push(i); save(); return i; },
  run_claude: ({ project, instruction, task, continue_last, taskId }) => {
    const p = projectById(project);
    if (!p) return { error: `okänt projekt: ${project}` };
    const t = task ? findTask(task) : (taskId ? { id: taskId } : null);
    const prev = continue_last ? db.jobs.find(j => j.project === p.id && j.sessionId) : null;
    const j = claude.startJob({ project: p, instruction, taskId: t?.id || null, resume: prev });
    return { started: true, jobId: j.id, project: p.name };
  },
  pc_control: ({ action, media, ...a }) => pc.run({ action, key: media, ...a }),
  n8n: async ({ action, name }) => {
    if (action === 'start' || action === 'pause') { const r = await n8n.setActive(name, action === 'start'); broadcast('state'); return r; }
    if (!n8n.has()) return { error: 'n8n är inte kopplat än' };
    const v = await n8n.refresh();
    return v.error ? { error: v.error } : v.list.map(w => ({ name: w.name, igång: w.active, senast: w.last ? `${w.last.status} ${w.last.at}` : 'aldrig' }));
  },
  macro: async ({ action, name, steps }) => {
    let r;
    if (action === 'create') r = await macros.create({ name, steps }, { brain, tools: brain.TOOLS, handlers });
    else if (action === 'run') r = await macros.run(name, handlers);
    else if (action === 'delete') r = macros.remove(name);
    else return macros.list().map(m => ({ name: m.name, does: m.summary }));
    broadcast('state'); return r;
  },
  money_pot: ({ action, kr, proposal }) => {
    if (action === 'budget') { const r = pot.setBudget(kr); broadcast('state'); return r; }
    if (action === 'approve' || action === 'decline') { const r = pot.decide(proposal, action === 'approve'); broadcast('state'); return r; }
    if (action === 'result') { const r = pot.result(proposal, kr); broadcast('state'); return r; }
    if (action === 'build') return (async () => {
      const x = pot.view().proposals.find(p => p.id === proposal) || pot.view().proposals.find(p => p.title.toLowerCase().includes(String(proposal || '').toLowerCase()));
      if (!x) return { error: 'hittade inget sånt förslag' };
      const body = { title: x.title, why: x.why, steps: x.steps, monthly: x.monthly };
      const out = mode.isCloud() ? await tunnel.call('POST', '/api/jobs/build', body) : startBuild(body);
      if (!out.error) { pot.markBuilt(x.id, out); broadcast('state'); }
      return out;
    })();
    if (action === 'hunt') { agents.run('pengajakt', { projects: config.projects }, agentNotify).then(() => broadcast('state')); return { started: true }; }
    const v = pot.view(); return { ...v, proposals: v.proposals.filter(x => ['förslag', 'pågår'].includes(x.status)).map(({ id, title, status, cost, expected, track }) => ({ id, title, status, cost, expected, track })) };
  },
  tv_control: async ({ action, ip, ...a }) => {
    const tvIp = String(ip || db.settings.tvIp || process.env.TV_IP || '').trim();
    const r = await tv.run({ action, ip: tvIp, mac: db.settings.tvMac, ...a });
    if (action === 'connect' && r.ok) { db.settings.tvIp = tvIp; if (r.mac) db.settings.tvMac = r.mac; save(); }
    // Fick vi kontakt men saknar adressen för att väcka TV:n — spara den i bakgrunden
    if (r.ok && action !== 'connect' && !db.settings.tvMac && tvIp) tv.run({ action: 'connect', ip: tvIp }).then(c => { if (c.mac) { db.settings.tvMac = c.mac; save(); } }).catch(() => {});
    return r;
  },
  add_goal: ({ title, project, deadline, target, unit }) => {
    const g = { id: id(), title, project: project || null, deadline: deadline || null, target: target ?? null, unit: unit || '', current: 0, done: false, created: new Date().toISOString() };
    (db.goals = db.goals || []).push(g); save(); broadcast('state'); return g;
  },
  update_goal: ({ goal, remove, ...patch }) => {
    const s = String(goal || '').toLowerCase();
    const g = (db.goals || []).find(x => x.id === goal) || (db.goals || []).find(x => x.title.toLowerCase().includes(s));
    if (!g) return { error: 'hittade inget sånt mål' };
    if (remove) { db.goals = db.goals.filter(x => x !== g); save(); broadcast('state'); return { removed: g.title }; }
    Object.assign(g, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    if (g.target != null && g.current >= g.target) g.done = true;
    save(); broadcast('state'); return g;
  },
  add_income: ({ amount, project, note, date }) => {
    const e = { id: id(), amount: Number(amount), project, note: note || '', date: date || today() };
    (db.income = db.income || []).push(e); save(); broadcast('state'); return e;
  },
  income_report: () => incomeReport(),
  start_focus: ({ minutes = 50, task }) => {
    const t = task ? findTask(task) : null;
    db.focus = { until: Date.now() + minutes * 60000, task: t?.title || task || null, taskId: t?.id || null, minutes };
    save(); broadcast('state'); return { ok: true, until: new Date(db.focus.until).toLocaleTimeString('sv-SE') };
  },
  stop_focus: () => { db.focus = null; save(); broadcast('state'); return { ok: true }; },
  video_projects: () => ({ projekt: video.list().map(p => ({ id: p.id, namn: p.name, klipp: p.input.map(f => f.name), färdiga: p.output.map(f => f.name) })), ffmpeg: video.ffmpegOk() }),
  video_edit: ({ project, instruction }) => startVideoEdit(project, instruction),
  make_trailer: a => startTrailer(a),
  run_agent: ({ agent }) => {
    const a = String(agent || '').toLowerCase().replace(/[^a-z]/g, '');
    const key = Object.keys(agents.AGENTS).find(k => a.includes(k) || k.includes(a));
    if (!key) return { error: 'okänd agent' };
    agents.run(key, { projects: config.projects }, agentNotify).then(() => broadcast('state'));
    return { started: agents.AGENTS[key].name, note: 'Jobbar i bakgrunden, du får en notis' };
  },
  read_mail: ({ count }) => ({ mails: mail.recent(count || 10), konton: mail.status().map(a => `${a.name}: ${a.ok === false ? 'fel — ' + a.error : 'ok'}`) }),
  pc_agent: ({ goal }) => {
    if (agent.isRunning()) return { error: 'Ett datorjobb körs redan' };
    agent.run(goal).catch(() => {});
    return { started: true, note: 'Jobbar på datorn nu, säger till när det är klart' };
  },
  pc_agent_stop: () => ({ stopped: agent.stop() }),
  phone_shortcut: ({ name, input }) => {
    const url = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}${input ? `&input=text&text=${encodeURIComponent(input)}` : ''}`;
    broadcast('shortcut', { url, name });
    return { ok: true, note: 'Skickat till telefonen — körs om HEIMDALL är öppen där' };
  },
  add_word: ({ word, note }) => {
    const list = db.settings.vocab || config.vocab || [];
    const w = note ? `${word} (${note})` : word;
    if (!list.some(x => x.toLowerCase().startsWith(word.toLowerCase()))) list.push(w);
    db.settings.vocab = list; save();
    return { ok: true, vocab: list };
  },
  set_settings: a => { Object.assign(db.settings, Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined))); save(); broadcast('state'); return db.settings; },
  update_self: () => restartSoon(),
  set_budget: ({ percent }) => { db.settings.claudeBudgetLeft = Math.max(0, Math.min(100, Math.round(percent))); save(); return db.settings; },
};

// I molnet körs de här verktygen på datorn via tunneln
const PC_TOOLS = ['run_claude', 'pc_control', 'tv_control', 'pc_agent', 'pc_agent_stop', 'video_projects', 'video_edit', 'make_trailer'];
if (mode.isCloud()) {
  for (const name of PC_TOOLS) {
    handlers[name] = async args => {
      if (name === 'run_claude' && args.task) { const t = findTask(args.task); if (t) args = { ...args, taskId: t.id, task: undefined }; }
      return tunnel.call('POST', `/api/tool/${name}`, args);
    };
  }
  handlers.update_self = async () => {
    const r = await tunnel.call('POST', '/api/update', {});
    return r.error ? { note: 'Molnet uppdateras automatiskt när ny kod läggs upp. Datorn är inte igång, så den uppdateras när den startar.' } : { ok: true, note: 'Datorn hämtar senaste versionen. Molnet uppdateras automatiskt.' };
  };
  // Claude som reserv för hjärnan körs på datorn (din Claude-prenumeration finns där)
  claudechat.setRunner?.(async (prompt, opts = {}) => {
    if (!tunnel.pcOnline()) throw new Error('Datorn är av, så Claude kan inte ta över');
    const r = await tunnel.call('POST', '/api/claude-raw', { prompt, web: !!opts.web });
    if (r.error) throw new Error(r.error);
    return r.text;
  });
}

function startVideoEdit(project, instruction) {
  const p = video.list().find(x => x.id === project || x.name.toLowerCase() === String(project || '').toLowerCase()) || video.list()[0];
  if (!p) return { error: 'Inga videoprojekt än — skapa ett under Video och ladda upp klipp' };
  if (!p.input.length) return { error: `Projektet ${p.name} har inga klipp än` };
  if (!video.ffmpegOk()) return { error: 'FFmpeg saknas på datorn — se fliken Video' };
  const job = claude.startJob({ project: { id: `video:${p.id}`, name: `Video: ${p.name}`, path: video.dir(p.id), rules: '' }, instruction: video.editInstruction(p, instruction) });
  return { started: true, project: p.name, jobId: job.id };
}

function startTrailer({ url, length, style, format, project }) {
  if (!url) return { error: 'Vilken sajt?' };
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  if (!video.ffmpegOk()) return { error: 'FFmpeg saknas på datorn' };
  const host = new URL(url).hostname.replace(/^www\./, '');
  let p = project ? video.list().find(x => x.id === project || x.name.toLowerCase() === String(project).toLowerCase()) : null;
  if (!p) { const pid = video.create(`Trailer ${host}`); p = video.list().find(x => x.id === pid); }
  const job = claude.startJob({ project: { id: `video:${p.id}`, name: `Video: ${p.name}`, path: video.dir(p.id), rules: '' }, instruction: video.trailerInstruction(p, { url, length, style, format }) });
  broadcast('state');
  return { started: true, project: p.name, jobId: job.id, note: 'Spelar in sajten och klipper — tar några minuter' };
}

function incomeReport() {
  const rows = db.income || [];
  const byMonth = {};
  for (const e of rows) {
    const k = e.date.slice(0, 7);
    byMonth[k] = byMonth[k] || {};
    byMonth[k][e.project] = (byMonth[k][e.project] || 0) + e.amount;
  }
  const total = {};
  for (const e of rows) total[e.project] = (total[e.project] || 0) + e.amount;
  return { perMånad: byMonth, totalt: total, summa: rows.reduce((a, e) => a + e.amount, 0) };
}

// Startar om HEIMDALL — start.bat hämtar då senaste versionen från GitHub
function restartSoon() {
  broadcast('notify', { title: 'Uppdaterar', body: 'HEIMDALL startar om med senaste versionen' });
  setTimeout(() => process.exit(0), 1500);
  return { ok: true, message: 'Startar om och hämtar senaste versionen om några sekunder' };
}

// Lovade AI:n att göra något men anropade inget verktyg? Då gör vi det åt den direkt.
const PROMISE_RE = /\b(lägger (till|in|upp)|lagt (till|in)|lägg(er)? det|fixar (det|påminn)|planerar in|sätter (en |upp )?påminnels|ordnar|skapar|bokar|flyttar|bockar av|tar bort|uppdaterar|lägger dem|sparar)\b/i;
const READ_ONLY = new Set(['list_tasks', 'read_mail', 'income_report', 'video_projects']);
async function followThrough(userText, replyText, actions = []) {
  if (!userText || !PROMISE_RE.test(replyText || '') || actions.some(a => !READ_ONLY.has(a.tool))) return null;
  try {
    const r = await brain.chat({
      history: db.chat.slice(-12, -1), systemPrompt: systemPrompt(), handlers,
      message: `${userText}\n\n[Systemnotis: du svarade "${String(replyText).slice(0, 300)}" men anropade inget verktyg, så ingenting är gjort. Gör det nu med verktygen, utan att fråga. Svara sen med EN kort mening om exakt vad du gjorde.]`,
    });
    return r.actions?.some(a => !READ_ONLY.has(a.tool)) ? r : null;
  } catch (e) { console.log('Följ upp:', e.message); return null; }
}

async function talk(message) {
  db.chat.push({ role: 'user', text: message, at: new Date().toISOString() });
  // Snabbkommando: "G A B B E R" kör direkt utan att gå via AI:n
  const mac = macros.find(message);
  if (mac) {
    const r = await handlers.macro({ action: 'run', name: mac.name });
    const text = r.ok ? `✓ ${mac.name}: ${mac.summary}` : `${mac.name}: en del gick inte — ${r.results?.filter(x => !x.ok).map(x => x.error).join(', ') || r.error}`;
    const actions = (r.results || []).map(x => ({ tool: x.tool, args: {}, ok: x.ok }));
    db.chat.push({ role: 'heimdall', text, actions, at: new Date().toISOString() });
    db.chat = db.chat.slice(-200); save(); broadcast('state');
    return { text, actions };
  }

  const history = db.chat.slice(0, -1);
  // Aldrig hänga: efter 2,5 min får du ett tydligt besked i stället för en snurra
  const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('Det tog för lång tid att svara. Försök igen — kolla annars Renders logg.')), 150000));
  let { text, actions } = await Promise.race([brain.chat({ history, message, systemPrompt: systemPrompt(), handlers }), limit]);
  const fix = await followThrough(message, text, actions);
  if (fix) { text = fix.text; actions = [...actions, ...fix.actions]; }
  db.chat.push({ role: 'heimdall', text, actions, at: new Date().toISOString() });
  db.chat = db.chat.slice(-200);
  save();
  broadcast('state');
  return { text, actions };
}

// --- Kalender (.ics) ---
function calendarIcs() {
  const esc = t => String(t || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const dt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = s => s.replace(/-/g, '');
  const stamp = dt(new Date());
  const ev = [];
  const from = addDays(today(), -7), to = addDays(today(), 60);
  for (const t of db.tasks) {
    if (t.done || !t.date || t.date < from || t.date > to) continue;
    const p = projectById(t.project);
    const lines = [`UID:task-${t.id}@heimdall`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(t.title)}`, `DESCRIPTION:${esc((p?.name || t.project || '') + (t.priority === 1 ? ' · hög prio' : ''))}`];
    if (t.time) {
      const start = new Date(`${t.date}T${t.time}:00`);
      lines.push(`DTSTART:${dt(start)}`, `DTEND:${dt(new Date(start.getTime() + Math.max(15, t.estimate_min || 30) * 60000))}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.title)}`, `TRIGGER:-PT${Math.max(0, t.remindBefore ?? 10)}M`, 'END:VALARM');
    } else lines.push(`DTSTART;VALUE=DATE:${day(t.date)}`, `DTEND;VALUE=DATE:${day(addDays(t.date, 1))}`);
    ev.push(['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n'));
  }
  for (const s of shifts.range(today(), 42)) {
    if (!s.start || !s.end) continue;
    const start = new Date(`${s.date}T${s.start}:00`); let end = new Date(`${s.date}T${s.end}:00`);
    if (end <= start) end = new Date(end.getTime() + 86400000);
    ev.push(['BEGIN:VEVENT', `UID:shift-${s.date}@heimdall`, `DTSTAMP:${stamp}`, `SUMMARY:${esc('Skift: ' + (s.name || s.code))}`, `DTSTART:${dt(start)}`, `DTEND:${dt(end)}`, 'TRANSP:OPAQUE', 'END:VEVENT'].join('\r\n'));
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HEIMDALL//SV', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:HEIMDALL', 'X-WR-TIMEZONE:Europe/Stockholm', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

// --- SSE ---
const clients = new Set();
function broadcast(type, data = {}) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
  if (mode.isPc()) tunnel.sendEvent(type, data); // datorn berättar för molnet
}
activeModel.bus.on('change', m => broadcast('model', m));
claude.bus.on('job', j => broadcast('job', j));
claude.bus.on('done', j => {
  const p = projectById(j.project);
  const title = `${p?.name || j.project}: jobb ${j.status}`;
  const body = (j.result || '').slice(0, 200);
  broadcast('notify', { title, body });
  push.send(title, body).catch(() => {});
  try { require('./lib/live').sayToAll(`${title}. ${body}`); } catch {}
  broadcast('state');
});

// Morgonbrief / kvällssummering skriven av Gemini
async function brief(kind) {
  const t = today();
  const doneToday = db.tasks.filter(x => x.done && (x.doneAt || '').slice(0, 10) === t).map(x => x.title);
  const ask = kind === 'morgon'
    ? `Skriv dagens morgonbrief till ${OWNER()}: dagens skift, vad som står på schemat idag och det viktigaste att börja med. Max 2 korta meningar, inga listor.`
    : `Skriv en kvällssummering till ${OWNER()}. Klart idag: ${doneToday.join(', ') || 'inget'}. Säg vad som blev klart, vad som är kvar och vad som står på tur imorgon. Max 2 korta meningar, inga listor.`;
  return (await brain.ask(systemPrompt() + '\n\n' + ask)).slice(0, 300);
}

// Automatisk avbockning: Claude Code hör av sig efter varje svar
const hookTimers = {};
async function handleHook(ev) {
  const r = await autocheck.onHook(ev, config.projects, mode.isPc() ? {
    tasks: async () => (await cloudApi('GET', '/api/state')).tasks || [],
    complete: async id => { const t = await cloudApi('POST', `/api/tasks/${id}/done`); return t?.id ? t : null; },
  } : undefined);
  if (r.skipped === 'väntar' && !hookTimers[ev.session_id]) {
    hookTimers[ev.session_id] = setTimeout(() => { delete hookTimers[ev.session_id]; handleHook(ev).catch(() => {}); }, 3.2 * 60000);
  }
  for (const t of r.done || []) {
    const title = `Bockade av: ${t.title}`;
    broadcast('notify', { title, body: r.reason || 'Klart enligt ditt Claude Code-jobb' });
    push.send(title, r.reason || '').catch(() => {});
  }
  if (r.done?.length) broadcast('state');
  return r;
}

// Datorn pratar med molnets vanliga API
async function cloudApi(method, p, body) {
  const r = await fetch(mode.cloudUrl() + p, {
    method, headers: { 'X-Heimdall-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  return r.json();
}

// --- HTTP ---
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 15e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('för stort')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); } });
  });
}

function authed(req, url) {
  if (!TOKEN) return true;
  const given = req.headers['x-heimdall-token'] || url.searchParams.get('token') || '';
  const a = Buffer.from(given); const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/api/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  // På datorn i molnläge: appen finns i molnet
  if (mode.isPc() && (p === '/' || p === '/index.html')) { res.writeHead(302, { Location: mode.cloudUrl() + '/' }); return res.end(); }

  if (!p.startsWith('/api/')) {
    const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Hittades inte');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(file).pipe(res);
  }

  if (!authed(req, url)) return send(res, 401, { error: 'Fel kod' });

  // Molnet: jobb och video finns på datorn — skicka vidare
  if (mode.isCloud() && /^\/api\/(jobs|video)(\/|$)/.test(p)) return tunnel.forward(req, res, req.url);

  try {
    const m = (method, re) => req.method === method && p.match(re);
    let r;

    if (m('GET', /^\/api\/state$/)) return send(res, 200, state());
    // Prenumererad kalender för telefonen (iPhone/Google Kalender): tasks + skift
    if (m('GET', /^\/api\/calendar\.ics$/)) { res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(calendarIcs()); }

    if (m('GET', /^\/api\/events$/)) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('event: hello\ndata: {}\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (m('POST', /^\/api\/chat$/)) {
      const { message } = await readBody(req);
      if (!message?.trim()) return send(res, 400, { error: 'Tomt meddelande' });
      return send(res, 200, await talk(message.trim()));
    }

    if (m('POST', /^\/api\/voice$/)) {
      const { audio, mime } = await readBody(req);
      const transcript = await brain.transcribe(audio, (mime || 'audio/webm').split(';')[0]);
      if (!transcript) return send(res, 200, { transcript: '', text: 'Jag hörde inget.', actions: [] });
      return send(res, 200, { transcript, ...(await talk(transcript)) });
    }

    // Naturlig röst för chattsvar: Gemini TTS (gratis) → WAV. Misslyckas den faller appen tillbaka på telefonens röst.
    if (m('POST', /^\/api\/tts$/)) {
      const { text } = await readBody(req);
      const clean = String(text || '').replace(/[*#_`]/g, '').trim().slice(0, 1500);
      if (!clean) return send(res, 400, { error: 'Tom text' });
      const voice = db.settings.voice || process.env.GEMINI_VOICE || 'Achird';
      let lastErr = 'okänt fel';
      for (const model of ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts']) {
        try {
          const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: `Läs upp följande som en riktig människa i ett personligt samtal, på naturlig rikssvenska. Varm, lugn och avslappnad ton med levande intonation, naturliga pauser vid kommatecken och punkt, och lite variation i tempo — aldrig stelt eller som en robot som läser upp text. Säg inte instruktionen, bara texten:\n\n${clean}` }] }],
              generationConfig: { temperature: 0.8, responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
            }),
          });
          clearTimeout(to);
          const j = await r.json();
          const b64 = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
          if (!r.ok || !b64) { lastErr = j.error?.message || 'inget ljud'; continue; }
          const pcm = Buffer.from(b64, 'base64');
          const h = Buffer.alloc(44);
          h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
          h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28);
          h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
          return send(res, 200, { audio: Buffer.concat([h, pcm]).toString('base64'), mime: 'audio/wav' });
        } catch (e) { lastErr = e.message; }
      }
      return send(res, 502, { error: lastErr });
    }

    if (m('POST', /^\/api\/tasks$/)) { const t = addTask(await readBody(req)); broadcast('state'); return send(res, 200, t); }
    if ((r = m('POST', /^\/api\/tasks\/(\w+)\/done$/))) { const t = completeTask(r[1]); broadcast('state'); return send(res, t ? 200 : 404, t || { error: 'saknas' }); }
    if ((r = m('POST', /^\/api\/tasks\/(\w+)\/undone$/))) { const t = updateTask(r[1], { done: false, doneAt: null }); broadcast('state'); return send(res, 200, t); }
    if ((r = m('PATCH', /^\/api\/tasks\/(\w+)$/))) { const t = updateTask(r[1], await readBody(req)); broadcast('state'); return send(res, t ? 200 : 404, t || { error: 'saknas' }); }
    if ((r = m('DELETE', /^\/api\/tasks\/(\w+)$/))) { const t = deleteTask(r[1]); broadcast('state'); return send(res, 200, t || {}); }

    if (m('POST', /^\/api\/shift$/)) { const { date, code } = await readBody(req); shifts.setShift(date, code || null); broadcast('state'); return send(res, 200, { ok: true }); }
    if (m('GET', /^\/api\/live\/models$/)) {
      const lv = require('./lib/live');
      const models = await lv.listLive();
      return send(res, 200, { models, auto: models[0], current: db.settings.liveModel || null });
    }
    if (m('GET', /^\/api\/push\/key$/)) return send(res, 200, { key: push.publicKey() });
    if (m('POST', /^\/api\/push\/subscribe$/)) { push.subscribe(await readBody(req)); return send(res, 200, { ok: true }); }
    if (m('POST', /^\/api\/push\/test$/)) { const n = await push.send('HEIMDALL', 'Notiserna funkar.'); return send(res, 200, { ok: true, devices: n }); }
    if (m('POST', /^\/api\/hook\/claude$/)) { const ev = await readBody(req); send(res, 200, { ok: true }); handleHook(ev).catch(e => console.log('Hook:', e.message)); return; }
    if (m('POST', /^\/api\/update$/)) {
      if (mode.isCloud()) return send(res, 200, await handlers.update_self());
      send(res, 200, { ok: true }); return restartSoon();
    }
    // Det molnet ber datorn om
    if (m('GET', /^\/api\/pcstate$/)) return send(res, 200, pcState());
    if ((r = m('POST', /^\/api\/tool\/(\w+)$/))) {
      if (mode.isCloud()) return send(res, 400, { error: 'körs på datorn' });
      const h = handlers[r[1]];
      if (!h) return send(res, 404, { error: 'okänt verktyg' });
      const out = await h(await readBody(req));
      broadcast('state');
      return send(res, 200, out ?? { ok: true });
    }
    if (m('POST', /^\/api\/claude-raw$/)) {
      if (mode.isCloud()) return send(res, 400, { error: 'körs på datorn' });
      const { prompt, web } = await readBody(req);
      try { return send(res, 200, { text: await claudechat.runClaude(prompt, { web: !!web }) }); }
      catch (e) { return send(res, 200, { error: e.message }); }
    }
    if (m('GET', /^\/api\/video$/)) return send(res, 200, { root: video.ROOT(), ffmpeg: video.ffmpegOk(), projects: video.list() });
    if (m('POST', /^\/api\/video$/)) { const { name } = await readBody(req); const pid = video.create(name || 'Nytt projekt'); broadcast('state'); return send(res, 200, { id: pid }); }
    if ((r = m('POST', /^\/api\/video\/([\w-]+)\/upload$/))) { const out = await video.upload(req, r[1], url.searchParams.get('name') || 'klipp.mp4'); broadcast('state'); return send(res, 200, out); }
    if ((r = m('POST', /^\/api\/video\/([\w-]+)\/captions$/))) { const { file } = await readBody(req); const out = await video.captions(r[1], file); broadcast('state'); return send(res, 200, out); }
    if (m('POST', /^\/api\/video\/trailer$/)) { const out = startTrailer(await readBody(req)); return send(res, out.error ? 400 : 200, out); }
    if ((r = m('POST', /^\/api\/video\/([\w-]+)\/edit$/))) { const { instruction } = await readBody(req); const out = startVideoEdit(r[1], instruction); return send(res, out.error ? 400 : 200, out); }
    if ((r = m('GET', /^\/api\/video\/([\w-]+)\/file$/))) return video.stream(req, res, r[1], url.searchParams.get('f') || '');
    if ((r = m('POST', /^\/api\/agents\/(\w+)\/run$/))) {
      agents.run(r[1], { projects: config.projects }, agentNotify).then(() => broadcast('state'));
      broadcast('state'); return send(res, 200, { ok: true });
    }
    if (m('POST', /^\/api\/focus$/)) { const b = await readBody(req); return send(res, 200, b.stop ? handlers.stop_focus() : handlers.start_focus(b)); }
    if (m('GET', /^\/api\/config$/)) return send(res, 200, pickConfig());
    if (m('POST', /^\/api\/config$/)) { saveConfig(await readBody(req)); broadcast('state'); return send(res, 200, pickConfig()); }
    if (m('POST', /^\/api\/settings$/)) { Object.assign(db.settings, await readBody(req)); save(); broadcast('state'); return send(res, 200, db.settings); }

    if (m('POST', /^\/api\/jobs$/)) {
      const { project, instruction, taskId, resume } = await readBody(req);
      const prev = resume ? db.jobs.find(j => j.id === resume) : null;
      const proj = projectById(project || prev?.project);
      if (!proj) return send(res, 400, { error: 'Okänt projekt' });
      return send(res, 200, claude.startJob({ project: proj, instruction, taskId, resume: prev }));
    }
    if ((r = m('POST', /^\/api\/jobs\/(\w+)\/stop$/))) return send(res, 200, { ok: claude.stopJob(r[1]) });
    if ((r = m('POST', /^\/api\/jobs\/(\w+)\/undo$/))) { const j = claude.undoJob(r[1], config.projects); broadcast('state'); return send(res, 200, j); }
    if ((r = m('POST', /^\/api\/jobs\/(\w+)\/dismiss$/))) { // kvittera/avfärda — "all" = alla misslyckade/stoppade
      const hit = r[1] === 'all' ? db.jobs.filter(j => ['misslyckades', 'stoppad'].includes(j.status)) : db.jobs.filter(j => j.id === r[1]);
      hit.forEach(j => { j.dismissed = true; });
      save(); broadcast('state');
      return send(res, 200, { ok: true, count: hit.length });
    }
    // Publicera flera svar i samma tråd på en gång (en omstart)
    if ((r = m('POST', /^\/api\/n8n\/([\w-]+)\/(start|pause)$/))) { const out = await handlers.n8n({ action: r[2], name: r[1] }); return send(res, out.error ? 400 : 200, out); }
    if (m('POST', /^\/api\/n8n\/refresh$/)) { await n8n.refresh(); broadcast('state'); return send(res, 200, n8n.view()); }
    if (m('POST', /^\/api\/macro$/)) { const b = await readBody(req); const out = await handlers.macro(b); return send(res, out?.error ? 400 : 200, out); }
    if (m('POST', /^\/api\/jobs\/build$/)) { try { return send(res, 200, startBuild(await readBody(req))); } catch (e) { return send(res, 400, { error: e.message }); } }
    if ((r = m('POST', /^\/api\/pot\/(\w+)\/build$/))) { const out = await handlers.money_pot({ action: 'build', proposal: r[1] }); return send(res, out.error ? 400 : 200, out); }
    if (m('POST', /^\/api\/pot\/budget$/)) { const { kr } = await readBody(req); return send(res, 200, handlers.money_pot({ action: 'budget', kr })); }
    if ((r = m('POST', /^\/api\/pot\/(\w+)\/(approve|decline|result)$/))) { const { kr } = await readBody(req); const out = handlers.money_pot({ action: r[2], proposal: r[1], kr }); return send(res, out.error ? 400 : 200, out); }
    if (m('POST', /^\/api\/jobs\/publish-many$/)) {
      const { ids } = await readBody(req);
      const list = (ids || []).map(id => db.jobs.find(j => j.id === id)).filter(j => j && !j.published).sort((a, b) => a.started.localeCompare(b.started));
      const proj = projectById(list[0]?.project);
      if (!proj) return send(res, 404, { error: 'Okänt jobb' });
      const done = [];
      for (const job of list) { claude.publish(proj, job); done.push(job.id); }
      broadcast('state');
      send(res, 200, { ok: true, published: done, restarting: proj.id === 'heimdall' });
      if (proj.id === 'heimdall') restartSoon();
      return;
    }
    if ((r = m('POST', /^\/api\/jobs\/(\w+)\/publish$/))) {
      const job = db.jobs.find(j => j.id === r[1]);
      const proj = projectById(job?.project);
      if (!proj) return send(res, 404, { error: 'Okänt jobb' });
      const out = claude.publish(proj, job);
      broadcast('state');
      send(res, 200, { ok: true, ...out, restarting: proj.id === 'heimdall' });
      if (proj.id === 'heimdall') restartSoon(); // starta om så den nya versionen körs direkt
      return;
    }

    send(res, 404, { error: 'Okänd väg' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

// --- Realtidsröst (Gemini Live) ---
const { WebSocketServer } = require('ws');
const live = require('./lib/live');
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/pc' && mode.isCloud()) {
    return wss.handleUpgrade(req, socket, head, ws => {
      if (!authed(req, url)) return ws.close(4001, 'fel kod');
      tunnel.attachPc(ws);
    });
  }
  if (url.pathname !== '/api/live' || !authed(req, url)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    live.attach(ws, {
      systemPrompt,
      handlers,
      onAction: () => broadcast('state'),
      onTurn: (you, me, actions) => {
        if (you) db.chat.push({ role: 'user', text: you, at: new Date().toISOString() });
        if (me) db.chat.push({ role: 'heimdall', text: me, actions, at: new Date().toISOString() });
        db.chat = db.chat.slice(-200);
        save();
        // Rösten lovar ibland saker utan att göra dem — då gör textjärnan det i bakgrunden
        followThrough(you, me, actions).then(fix => {
          if (!fix) return;
          db.chat.push({ role: 'heimdall', text: fix.text, actions: fix.actions, at: new Date().toISOString() });
          db.chat = db.chat.slice(-200); save(); broadcast('state');
          try { require('./lib/live').sayToAll(fix.text); } catch {}
        }).catch(() => {});
      },
    });
  });
});

// Ett fel i en del (mejl, agent, nätverk) ska aldrig fälla hela HEIMDALL
process.on('uncaughtException', e => console.log('Fångat fel:', e.message));
process.on('unhandledRejection', e => console.log('Fångat fel:', e?.message || e));

if (mode.isCloud()) startCloud();
if (mode.isPc()) startPc();
if (!mode.isCloud()) autocheck.installHook();
if (!mode.isPc()) n8n.start(() => broadcast('state'));
if (!mode.isPc()) mail.start((title, body) => { broadcast('notify', { title, body }); push.send(title, body).catch(() => {}); broadcast('state'); },
  (item, acc) => { if (acc.replies) agents.draftReply(item).then(r => agentNotify('Svarsförslag klart', `Till ${item.from} — finns under Agenter`)).catch(e => console.log('Svarsförslag:', e.message)); });
if (!mode.isPc()) scheduler.start({ shifts, brief, monitors: MONITORS, broadcast, onTick: now => agents.tick(now, { projects: config.projects }, agentNotify) });

// ---------- Molnet ----------
function startCloud() {
  let refreshing = null;
  const refreshPc = () => {
    clearTimeout(refreshing);
    refreshing = setTimeout(async () => {
      if (!tunnel.pcOnline()) return;
      const r = await tunnel.call('GET', '/api/pcstate');
      if (!r.error) { pcCache = r; broadcast('state'); }
    }, 400);
  };
  tunnel.cloud.on('online', () => { console.log('  Datorn är ansluten'); refreshPc(); broadcast('state'); });
  tunnel.cloud.on('offline', () => { console.log('  Datorn kopplades från'); broadcast('state'); });
  tunnel.cloud.on('event', (type, data) => {
    if (type === 'job') {
      const i = pcCache.jobs.findIndex(j => j.id === data.id);
      if (i >= 0) pcCache.jobs[i] = data; else pcCache.jobs.unshift(data);
      if (data.status === 'klar' && data.taskId) { const t = completeTask(data.taskId, 'auto (Claude-jobb)'); if (t) broadcast('state'); }
      return broadcast('job', data);
    }
    if (type === 'state') return refreshPc();
    if (type === 'notify') {
      push.send(data.title, data.body).catch(() => {});
      try { require('./lib/live').sayToAll(`${data.title}. ${data.body || ''}`); } catch {}
    }
    if (type === 'model' || type === 'pc') return;
    broadcast(type, data);
  });
  // Flytta din data från datorn till molnet första gången datorn ansluter
  tunnel.cloud.on('hello', (m, reply) => {
    if (m.config) { saveConfig(m.config); broadcast('state'); } // datorns config.json är det som gäller
    if (!m.migrate) return;
    if (db.migrated) return reply({ t: 'migrated', skipped: true });
    mergeFromPc(m.migrate);
    db.migrated = { from: m.host, at: new Date().toISOString() };
    save(); broadcast('state');
    console.log('  Tog emot din data från datorn');
    reply({ t: 'migrated' });
  });
  setInterval(refreshPc, 60000);
  // Håll molnet vaket (Render somnar efter 15 min utan besök)
  const self = process.env.RENDER_EXTERNAL_URL;
  if (self) setInterval(() => fetch(self + '/api/ping').catch(() => {}), 10 * 60000);
}

function mergeFromPc(d) {
  const byId = (a = [], b = []) => { const seen = new Set(a.map(x => x.id)); return [...a, ...b.filter(x => x && !seen.has(x.id))]; };
  db.tasks = byId(db.tasks, d.tasks);
  db.ideas = byId(db.ideas, d.ideas);
  db.goals = byId(db.goals, d.goals);
  db.income = byId(db.income, d.income);
  db.mails = byId(d.mails, db.mails).slice(0, 100);
  db.agentReports = byId(db.agentReports, d.agentReports).slice(0, 40);
  db.dismissedEvents = [...new Set([...(d.dismissedEvents || []), ...(db.dismissedEvents || [])])];
  db.shiftOverrides = { ...(d.shiftOverrides || {}), ...(db.shiftOverrides || {}) };
  db.mailState = { ...(d.mailState || {}), ...(db.mailState || {}) };
  db.sent = { ...(d.sent || {}), ...(db.sent || {}) };
  if (!db.chat.length && d.chat?.length) db.chat = d.chat.slice(-200);
  const cloudChanged = Object.fromEntries(Object.entries(db.settings || {}).filter(([k, v]) => !(k === 'claudeBudgetLeft' && v === 100)));
  db.settings = { ...(d.settings || {}), ...cloudChanged };
}

// ---------- Datorn ----------
function startPc() {
  const KEYS = ['tasks', 'ideas', 'goals', 'income', 'mails', 'mailState', 'agentReports', 'dismissedEvents', 'shiftOverrides', 'sent', 'chat', 'settings'];
  tunnel.startClient({
    cloudUrl: mode.cloudUrl(), token: TOKEN, localPort: PORT,
    hello: () => ({ config: pickConfig(), ...(db.migratedToCloud ? {} : { migrate: Object.fromEntries(KEYS.map(k => [k, db[k]])) }) }),
    onMigrated: () => { db.migratedToCloud = new Date().toISOString(); save(); },
  });
}

server.listen(PORT, HOST, () => {
  const where = mode.isCloud() ? 'i molnet' : mode.isPc() ? `på datorn (kopplad till ${mode.cloudUrl()})` : 'på datorn';
  console.log(`\n  HEIMDALL vaknar ${where} — port ${PORT}\n`);
});
