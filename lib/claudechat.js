// Reserv för kärnan: när Gemini-kvoten är slut svarar Claude (via `claude -p`, din Pro-prenumeration).
// Claude får verktygslistan som text och svarar med JSON: antingen verktyg att köra eller ett slutligt svar.
const { spawn } = require('child_process');

const MODEL = 'sonnet';
const TIMEOUT_MS = 120000;

// web=true: Claude får söka på nätet (för agenterna när Gemini är slut)
function runClaude(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    let out = '', err = '', done = false;
    const tools = opts.web ? ['--allowedTools', '"WebSearch,WebFetch"'] : ['--tools', '""'];
    const child = spawn('claude', ['-p', '--output-format', 'text', ...tools, '--model', MODEL],
      { shell: true, windowsHide: true, env: { ...process.env, HEIMDALL_JOB: '1' } });
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']); else child.kill();
      finish(reject, new Error('Claude svarade inte i tid'));
    }, opts.web ? 300000 : TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish(reject, new Error(`Kunde inte starta claude: ${e.message}. Är Claude Code installerat?`)));
    child.on('close', code => {
      const all = out + ' ' + err;
      if (/oauth|failed to authenticate|not logged in|please run \/login|invalid api key/i.test(all)) return finish(reject, new Error('Claude Code är utloggad på datorn. Skriv claude och sen /login i PowerShell.'));
      if (/usage limit|rate limit|limit reached|5-hour limit|weekly limit/i.test(all)) return finish(reject, new Error('Claude-gränsen är nådd just nu.'));
      if (code !== 0 && !out.trim()) return finish(reject, new Error(`Claude misslyckades: ${err.slice(0, 200)}`));
      finish(resolve, out.trim());
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function toolList(tools) {
  return tools.map(t => {
    const props = Object.entries(t.parameters?.properties || {})
      .map(([k, v]) => `${k}${(t.parameters.required || []).includes(k) ? '*' : ''} (${String(v.type).toLowerCase()}): ${v.description}`).join('; ');
    return `- ${t.name}: ${t.description}${props ? ` Parametrar: ${props}` : ''}`;
  }).join('\n');
}

function parseReply(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { svar: text };
  try { return JSON.parse(m[0]); } catch { return { svar: text }; }
}

async function chat({ history, message, systemPrompt, handlers, tools }) {
  const actions = [];
  const log = history.slice(-16).map(m => `${m.role === 'user' ? 'Användaren' : 'HEIMDALL'}: ${m.text}`).join('\n');
  const head = `${systemPrompt}

Du kör nu som reserv eftersom Gemini är slut, utan inbyggda verktyg. Använd bara verktygen nedan.
Svara ALLTID med exakt ett JSON-objekt, ingen annan text:
- För att köra verktyg: {"verktyg":[{"namn":"add_task","args":{"title":"..."}}]}
- När du är klar: {"svar":"kort svar på svenska"}
Verktyg (* = obligatorisk parameter):
${toolList(tools)}

Tidigare konversation:
${log || '(ingen)'}

Användaren: ${message}`;

  let transcript = '';
  for (let round = 0; round < 6; round++) {
    const reply = parseReply(await runner(head + transcript + '\n\nDitt JSON-svar:'));
    const calls = Array.isArray(reply.verktyg) ? reply.verktyg : [];
    if (!calls.length) return { text: String(reply.svar || 'Klart.').trim(), actions, via: 'claude' };

    const results = [];
    for (const c of calls) {
      let result;
      try {
        const h = handlers[c.namn];
        result = h ? await h(c.args || {}) : { error: 'okänt verktyg' };
      } catch (e) {
        result = { error: e.message };
      }
      actions.push({ tool: c.namn, args: c.args, ok: !result?.error });
      results.push({ namn: c.namn, resultat: result });
    }
    transcript += `\n\nDu körde verktyg. Resultat: ${JSON.stringify(results).slice(0, 6000)}`;
  }
  return { text: 'Jag gjorde det jag kunde, kolla schemat.', actions, via: 'claude' };
}

// I molnet finns inget Claude Code — då ber molnet datorn köra Claude åt sig
let runner = runClaude;
const setRunner = fn => { runner = fn; };

const raw = (prompt, opts) => runner(prompt, opts);

module.exports = { chat, runClaude, setRunner, raw };
