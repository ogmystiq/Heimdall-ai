// Pengapotten: du sätter en budget, agenten "Pengajakten" föreslår saker att lägga pengarna på.
// Inget spenderas automatiskt — du godkänner varje förslag själv och loggar vad det gav tillbaka.
const { db, save, id, today, addTask } = require('./db');

const TRACKS = { 'Nytt projekt': null, 'Befintligt projekt': null, Flipp: null, Övrigt: null };

function pot() {
  db.pot = db.pot || { budget: 0, proposals: [] };
  return db.pot;
}

function stats() {
  const p = pot();
  const live = p.proposals.filter(x => x.status === 'pågår' || x.status === 'klar');
  const spent = live.reduce((a, x) => a + (Number(x.cost) || 0), 0);
  const earned = p.proposals.filter(x => x.status === 'klar').reduce((a, x) => a + (Number(x.result) || 0), 0);
  const tracks = {};
  for (const x of live) {
    const t = tracks[x.track] = tracks[x.track] || { spent: 0, earned: 0, count: 0 };
    t.spent += Number(x.cost) || 0; t.count++;
    if (x.status === 'klar') t.earned += Number(x.result) || 0;
  }
  // Det som kommer tillbaka går in i potten igen
  return { budget: p.budget, spent, earned, left: Math.max(0, p.budget - spent + earned), net: earned - spent, tracks };
}

function setBudget(kr) {
  const n = Math.max(0, Math.round(Number(kr) || 0));
  pot().budget = n; save();
  return { ok: true, budget: n, ...stats() };
}

function addProposals(list, agent = 'pengajakt') {
  const p = pot();
  const added = (list || []).filter(x => x && x.title).slice(0, 6).map(x => ({
    id: id(), agent, at: new Date().toISOString(), status: 'förslag',
    title: String(x.title).slice(0, 120), track: TRACKS.hasOwnProperty(x.track) ? x.track : 'Övrigt',
    why: String(x.why || '').slice(0, 400), steps: (Array.isArray(x.steps) ? x.steps : []).map(String).slice(0, 8),
    cost: Math.max(0, Math.round(Number(x.cost) || 0)), expected: Math.max(0, Math.round(Number(x.expected) || 0)),
    hours: Number(x.hours) || null, monthly: Math.max(0, Math.round(Number(x.monthly) || 0)) || null, risk: ['låg', 'medel', 'hög'].includes(x.risk) ? x.risk : 'medel', link: /^https?:\/\//.test(x.link || '') ? x.link : '',
  }));
  // Gamla obesvarade förslag ersätts av de nya
  p.proposals = [...added, ...p.proposals.filter(x => x.status !== 'förslag')].slice(0, 60);
  save();
  return added;
}

const find = pid => pot().proposals.find(x => x.id === pid || x.title.toLowerCase().includes(String(pid || '').toLowerCase()));

function decide(pid, approve) {
  const x = find(pid);
  if (!x) return { error: 'hittade inget sånt förslag' };
  if (x.status !== 'förslag') return { error: `förslaget är redan ${x.status}` };
  if (!approve) { x.status = 'avböjd'; save(); return { ok: true, declined: x.title }; }
  const s = stats();
  if (x.cost > s.left) return { error: `Potten räcker inte: ${x.cost} kr behövs, ${s.left} kr kvar. Höj potten först.` };
  x.status = 'pågår'; x.startedAt = new Date().toISOString();
  const t = addTask({ title: `💰 ${x.title}`, project: TRACKS[x.track] || 'Övrigt', date: today(), estimate_min: Math.round((x.hours || 1) * 60), priority: 2 });
  x.taskId = t.id;
  // Nytt projekt: spara i idébanken så det finns kvar som projektidé
  if (x.track === 'Nytt projekt') (db.ideas = db.ideas || []).push({ id: id(), text: `${x.title} — ${x.why}${x.monthly ? ` (kan ge ca ${x.monthly} kr/mån)` : ''}`, project: null, created: new Date().toISOString() });
  save();
  return { ok: true, approved: x.title, task: t.title, left: stats().left };
}

// Logga vad ett godkänt förslag gav tillbaka (0 = gick inte)
function result(pid, kr) {
  const x = find(pid);
  if (!x) return { error: 'hittade inget sånt förslag' };
  if (x.status !== 'pågår') return { error: 'bara pågående förslag kan få ett resultat' };
  x.status = 'klar'; x.result = Math.round(Number(kr) || 0); x.doneAt = new Date().toISOString();
  if (x.result > 0) (db.income = db.income || []).push({ id: id(), amount: x.result, project: TRACKS[x.track] || 'övrigt', note: `Pengapotten: ${x.title}`, date: today() });
  if (x.cost > 0) (db.income = db.income || []).push({ id: id(), amount: -x.cost, project: TRACKS[x.track] || 'övrigt', note: `Pengapotten (insats): ${x.title}`, date: today() });
  save();
  return { ok: true, title: x.title, result: x.result, ...stats() };
}

function markBuilt(pid, out) { const x = pot().proposals.find(p => p.id === pid); if (x) { x.built = { at: new Date().toISOString(), dir: out.dir, jobId: out.jobId }; save(); } }

const view = () => ({ ...stats(), proposals: pot().proposals.slice(0, 40) });
const history = () => pot().proposals.filter(x => x.status !== 'förslag').slice(0, 15).map(x => `${x.status}: ${x.title} (${x.cost} kr${x.status === 'klar' ? ` → ${x.result} kr` : ''})`);

module.exports = { markBuilt, stats, setBudget, addProposals, decide, result, view, history, TRACKS };
