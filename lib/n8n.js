// n8n-flödena: status, senaste körning, starta/pausa.
// Kräver N8N_URL (t.ex. https://dittnamn.app.n8n.cloud) och N8N_API_KEY (n8n → Settings → n8n API).
const has = () => !!(process.env.N8N_URL && process.env.N8N_API_KEY);
let cache = { at: 0, list: [], error: null };

async function api(method, p) {
  const base = (() => { try { return new URL(process.env.N8N_URL).origin; } catch { return process.env.N8N_URL.replace(/\/+$/, ''); } })(); // tål att hela adressen klistrats in
  const r = await fetch(base + '/api/v1' + p, {
    method, headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 401 ? 'n8n: fel API-nyckel' : `n8n ${r.status}: ${j.message || ''}`.trim());
  return j;
}

async function refresh() {
  if (!has()) return cache;
  try {
    const wf = (await api('GET', '/workflows?limit=100')).data || [];
    const list = await Promise.all(wf.filter(w => !w.isArchived).map(async w => {
      let last = null;
      try { last = ((await api('GET', `/executions?workflowId=${w.id}&limit=1`)).data || [])[0] || null; } catch {}
      return { id: w.id, name: w.name, active: !!w.active, updated: w.updatedAt,
        last: last ? { status: last.status || (last.finished ? 'success' : 'error'), at: last.startedAt, done: last.stoppedAt } : null };
    }));
    cache = { at: Date.now(), list: list.sort((a, b) => b.active - a.active || a.name.localeCompare(b.name)), error: null };
  } catch (e) { cache = { ...cache, at: Date.now(), error: e.message }; }
  return cache;
}

const norm = t => String(t || '').toLowerCase().replace(/[^a-z0-9åäö]/g, '');
function find(name) {
  const n = norm(name);
  return cache.list.find(w => w.id === name) || cache.list.find(w => norm(w.name) === n) || cache.list.find(w => norm(w.name).includes(n) || n.includes(norm(w.name)));
}

async function setActive(name, on) {
  if (!has()) return { error: 'n8n är inte kopplat än (N8N_URL och N8N_API_KEY saknas i Render)' };
  if (!cache.list.length) await refresh();
  const w = find(name);
  if (!w) return { error: `Hittade inget flöde som heter ${name}. Finns: ${cache.list.map(x => x.name).join(', ')}` };
  await api('POST', `/workflows/${w.id}/${on ? 'activate' : 'deactivate'}`);
  await refresh();
  return { ok: true, name: w.name, active: on };
}

const view = () => ({ connected: has(), list: cache.list, error: cache.error, at: cache.at });
function start(onChange) {
  if (!has()) return;
  const tick = async () => { const before = JSON.stringify(cache.list); await refresh(); if (JSON.stringify(cache.list) !== before) onChange?.(); };
  tick(); setInterval(tick, 5 * 60000);
}

module.exports = { has, refresh, setActive, view, start };
