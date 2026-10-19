// Molnet (Render) sparar inga filer mellan omstarter. Därför sparas data/db.json och data/vapid.json
// i grenen "data" i ditt privata GitHub-repo. Hämtas vid start, sparas när något ändrats.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'data');
const FILES = ['db.json', 'vapid.json'];
const BRANCH = process.env.DATA_BRANCH || 'data';
const REPO = () => process.env.DATA_REPO || '';
const TOKEN = () => process.env.GITHUB_TOKEN || '';
const API = process.env.GITHUB_API || 'https://api.github.com';

const state = { enabled: false, shas: {}, hashes: {}, lastSave: null, error: null };
const hash = buf => crypto.createHash('sha1').update(buf).digest('hex');

async function gh(method, url, body, accept = 'application/vnd.github+json') {
  const r = await fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN()}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'heimdall', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return r;
}

async function ensureBranch() {
  const r = await gh('GET', `/repos/${REPO()}/git/ref/heads/${BRANCH}`);
  if (r.ok) return;
  if (r.status !== 404) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 150)}`);
  // Skapa en tom gren som bara innehåller data (ingen kod)
  const tree = await (await gh('POST', `/repos/${REPO()}/git/trees`, { tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: 'HEIMDALL-data. Rör inte — sparas automatiskt.\n' }] })).json();
  if (!tree.sha) throw new Error('Kunde inte skapa datagrenen: ' + JSON.stringify(tree).slice(0, 150));
  const commit = await (await gh('POST', `/repos/${REPO()}/git/commits`, { message: 'HEIMDALL: datagren', tree: tree.sha, parents: [] })).json();
  const ref = await gh('POST', `/repos/${REPO()}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  if (!ref.ok) throw new Error('Kunde inte skapa datagrenen: ' + (await ref.text()).slice(0, 150));
  console.log(`  Skapade grenen "${BRANCH}" i ${REPO()} för din data`);
}

// Hämta data från GitHub innan resten av HEIMDALL startar
async function restore() {
  if (!TOKEN()) { console.log('  GITHUB_TOKEN saknas — data sparas bara tills molnet startar om!'); return false; }
  if (!REPO()) { console.log('  DATA_REPO saknas (ditt-användarnamn/heimdall) — data sparas bara tills molnet startar om!'); return false; }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await ensureBranch();
      fs.mkdirSync(DIR, { recursive: true });
      for (const f of FILES) {
        const meta = await gh('GET', `/repos/${REPO()}/contents/${f}?ref=${BRANCH}`);
        if (meta.status === 404) continue; // finns inte än = första start
        if (!meta.ok) throw new Error(`GitHub ${meta.status} för ${f}`);
        const { sha } = await meta.json();
        const raw = await gh('GET', `/repos/${REPO()}/contents/${f}?ref=${BRANCH}`, null, 'application/vnd.github.raw');
        if (!raw.ok) throw new Error(`GitHub ${raw.status} för ${f}`);
        const buf = Buffer.from(await raw.arrayBuffer());
        fs.writeFileSync(path.join(DIR, f), buf);
        state.shas[f] = sha; state.hashes[f] = hash(buf);
        console.log(`  Hämtade ${f} från GitHub (${(buf.length / 1024).toFixed(0)} kB)`);
      }
      state.enabled = true;
      return true;
    } catch (e) {
      state.error = e.message;
      console.log(`  Kunde inte hämta data från GitHub (försök ${attempt}/5):`, e.message);
      if (attempt < 5) await new Promise(r => setTimeout(r, attempt * 3000));
    }
  }
  // Starta hellre utan att spara än att skriva över din riktiga data med en tom databas
  console.log('  ⚠  Sparning till GitHub är AVSTÄNGD tills nästa omstart, så ingen data skrivs över.');
  return false;
}

let saving = false;
async function flush() {
  if (!state.enabled || saving) return;
  saving = true;
  try {
    for (const f of FILES) {
      const file = path.join(DIR, f);
      if (!fs.existsSync(file)) continue;
      const buf = fs.readFileSync(file);
      const h = hash(buf);
      if (state.hashes[f] === h) continue;
      try { JSON.parse(buf.toString()); } catch { continue; } // halvskriven fil — vänta till nästa varv
      for (let tries = 0; tries < 2; tries++) {
        const r = await gh('PUT', `/repos/${REPO()}/contents/${f}`, {
          message: `HEIMDALL: sparar ${f}`, branch: BRANCH, content: buf.toString('base64'), ...(state.shas[f] ? { sha: state.shas[f] } : {}),
        });
        if (r.ok) { const j = await r.json(); state.shas[f] = j.content.sha; state.hashes[f] = h; state.lastSave = new Date().toISOString(); state.error = null; break; }
        if (r.status === 409 || r.status === 422) { // fel sha — hämta aktuell och försök igen
          const meta = await gh('GET', `/repos/${REPO()}/contents/${f}?ref=${BRANCH}`);
          state.shas[f] = meta.ok ? (await meta.json()).sha : undefined;
          continue;
        }
        throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 150)}`);
      }
    }
  } catch (e) {
    state.error = e.message;
    console.log('  Kunde inte spara till GitHub:', e.message);
  } finally { saving = false; }
}

function start() {
  if (!state.enabled) return;
  setInterval(flush, 20000);
  // Render stänger med SIGTERM vid omstart — spara först
  const bye = async () => {
    try { require('./db').saveNow(); } catch {}
    while (saving) await new Promise(r => setTimeout(r, 100));
    await flush();
    process.exit(0);
  };
  process.once('SIGTERM', bye);
  process.once('SIGINT', bye);
}

module.exports = { restore, flush, start, status: () => ({ enabled: state.enabled, lastSave: state.lastSave, error: state.error }) };
