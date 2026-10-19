// Egna kommandon: du säger "skapa kommandot Godnatt: stäng av TV:n och lås datorn".
// När det skapas översätter AI:n orden till verktygsanrop EN gång — sen körs det direkt utan AI (snabbt, ingen kvot).
const { db, save } = require('./db');

const list = () => (db.settings.macros = db.settings.macros || []);
const norm = t => String(t || '').toLowerCase().replace(/[^a-zåäö0-9]/g, '');
const find = name => list().find(m => norm(m.name) === norm(name));

async function create({ name, steps }, { brain, tools, handlers }) {
  if (!name || !steps) return { error: 'Behöver både namn och vad kommandot ska göra' };
  const usable = tools.filter(t => handlers[t.name] && !['macro', 'update_self', 'set_budget'].includes(t.name));
  const desc = usable.map(t => `- ${t.name}: ${t.description} Parametrar: ${Object.entries(t.parameters?.properties || {}).map(([k, v]) => `${k} (${String(v.type).toLowerCase()}): ${v.description}`).join('; ')}`).join('\n');
  const out = await brain.ask(`Översätt det här kommandot till en lista med verktygsanrop som körs i ordning.
Kommandot "${name}" ska: ${steps}

Verktyg:
${desc}

Svara med JSON: {"calls": [{"tool": "verktygsnamn", "args": {...}}], "summary": "kort beskrivning på svenska av vad kommandot gör"}
Använd bara verktygen ovan. Går något inte att göra med dem, hoppa över det och säg det i summary.`, true);
  const calls = (out?.calls || []).filter(c => handlers[c.tool] && c.tool !== 'macro').map(c => ({ tool: c.tool, args: c.args || {} }));
  if (!calls.length) return { error: 'Kunde inte göra om det till något HEIMDALL kan köra' };
  const m = { name: String(name).trim(), steps: String(steps), calls, summary: out.summary || steps, created: new Date().toISOString() };
  db.settings.macros = [...list().filter(x => norm(x.name) !== norm(name)), m];
  save();
  return { ok: true, name: m.name, does: m.summary, steps: calls.length };
}

async function run(name, handlers) {
  const m = find(name);
  if (!m) return { error: `Inget kommando som heter ${name}` };
  const results = [];
  for (const c of m.calls) {
    let r; try { r = await handlers[c.tool](c.args); } catch (e) { r = { error: e.message }; }
    results.push({ tool: c.tool, ok: !r?.error, error: r?.error });
  }
  return { ok: results.every(r => r.ok), name: m.name, results };
}

function remove(name) {
  const m = find(name);
  if (!m) return { error: `Inget kommando som heter ${name}` };
  db.settings.macros = list().filter(x => x !== m); save();
  return { ok: true, removed: m.name };
}

module.exports = { list, find, create, run, remove };
