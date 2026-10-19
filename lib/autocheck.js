// Automatisk avbockning när du jobbar i Claude Code som vanligt.
// 1) Lägger in en hook i Claude Codes inställningar (en gång, med backup).
// 2) När hooken hör av sig läser vi vad som ändrats och låter Gemini matcha mot öppna tasks.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db, save, completeTask } = require('./db');
const brain = require('./brain');

const HOOK = path.join(__dirname, '..', 'hooks', 'claude-stop.js');
const COMMAND = `node "${HOOK}"`;

function installHook() {
  const dir = path.join(os.homedir(), '.claude');
  const file = path.join(dir, 'settings.json');
  try {
    let settings = {};
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8');
      try { settings = JSON.parse(raw); } catch { console.log('Claude Code-inställningarna gick inte att läsa, rör dem inte.'); return false; }
      if (!fs.existsSync(file + '.heimdall-backup')) fs.writeFileSync(file + '.heimdall-backup', raw);
    }
    settings.hooks = settings.hooks || {};
    const stop = settings.hooks.Stop = settings.hooks.Stop || [];
    const already = stop.some(g => (g.hooks || []).some(h => /heimdall/i.test(h.command || '') && /claude-stop/.test(h.command || '')));
    if (already) {
      // Uppdatera sökvägen om mappen flyttats
      stop.forEach(g => (g.hooks || []).forEach(h => { if (/claude-stop/.test(h.command || '')) h.command = COMMAND; }));
    } else {
      stop.push({ hooks: [{ type: 'command', command: COMMAND, timeout: 5 }] });
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    if (!already) console.log('Automatisk avbockning från Claude Code är påslagen.');
    return true;
  } catch (e) {
    console.log('Kunde inte lägga in Claude Code-hooken:', e.message);
    return false;
  }
}

const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

function readNew(transcriptPath, from) {
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const files = new Set(); const said = []; const asked = [];
  for (const line of lines.slice(from)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const content = e.message?.content;
    if (e.type === 'assistant' && Array.isArray(content)) {
      for (const c of content) {
        if (c.type === 'tool_use' && EDIT_TOOLS.test(c.name)) files.add(c.input?.file_path || c.input?.notebook_path || '?');
        if (c.type === 'tool_use' && c.name === 'Bash' && /git (commit|push)/.test(c.input?.command || '')) said.push(`[körde: ${c.input.command.slice(0, 80)}]`);
        if (c.type === 'text' && c.text.trim()) said.push(c.text.trim());
      }
    }
    if (e.type === 'user' && typeof content === 'string') asked.push(content.slice(0, 300));
    if (e.type === 'user' && Array.isArray(content)) for (const c of content) if (c.type === 'text') asked.push(c.text.slice(0, 300));
  }
  return { total: lines.length, files: [...files], said, asked };
}

async function onHook({ session_id, transcript_path, cwd }, projects, remote) {
  if (!session_id || !transcript_path || !fs.existsSync(transcript_path)) return { skipped: 'ingen transkription' };
  db.hookSessions = db.hookSessions || {};
  const st = db.hookSessions[session_id] || { offset: 0, last: 0 };

  if (Date.now() - st.last < 3 * 60000) return { skipped: 'väntar' }; // max var 3:e minut per session
  const r = readNew(transcript_path, st.offset);
  if (!r.files.length && !r.said.some(s => s.startsWith('[körde'))) {
    st.offset = r.total; db.hookSessions[session_id] = st; save();
    return { skipped: 'inga ändringar' };
  }

  const norm = p => String(p || '').toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
  const project = projects.find(p => p.path && norm(cwd).startsWith(norm(p.path)));
  const allTasks = remote ? await remote.tasks() : db.tasks;
  const open = allTasks.filter(t => !t.done && (!project || t.project === project.id));
  st.offset = r.total; st.last = Date.now(); db.hookSessions[session_id] = st;
  save();
  if (!open.length) return { skipped: 'inga öppna tasks' };

  const prompt = `Användaren har jobbat i Claude Code${project ? ` i projektet ${project.name}` : ''}.
Vad han bad om:
${r.asked.slice(-6).join('\n---\n') || '(okänt)'}

Vad Claude sa och gjorde:
${r.said.join('\n').slice(-2500)}

Ändrade filer: ${r.files.join(', ') || 'inga'}

Öppna tasks:
${open.map(t => `[${t.id}] ${t.title}`).join('\n')}

Vilka tasks är nu HELT klara enligt ovan? Var sträng: bara om arbetet tydligt är gjort, inte påbörjat eller planerat.
Svara med JSON: {"done": ["id", ...], "reason": "kort förklaring på svenska"}`;

  const out = await brain.ask(prompt, true);
  const ids = Array.isArray(out?.done) ? out.done : [];
  const doneTasks = remote
    ? (await Promise.all(ids.map(id => remote.complete(id)))).filter(Boolean)
    : ids.map(id => completeTask(id, 'auto (Claude Code)')).filter(Boolean);
  return { done: doneTasks, reason: out?.reason || '' };
}

module.exports = { installHook, onHook };
