// Tunnel mellan molnet och datorn.
// Datorn ringer upp molnet (WebSocket ut från datorn — inga portar behöver öppnas hemma).
// Molnet skickar sen vidare de anrop som bara datorn kan göra (Claude-jobb, video, datorstyrning)
// och datorn skickar tillbaka händelser (jobb klart, notiser).
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events');
const WebSocket = require('ws');

const CHUNK = 256 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;
const rid = () => crypto.randomBytes(6).toString('hex');
const PASS_HEADERS = ['content-type', 'content-length', 'range', 'accept'];
const BACK_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'cache-control'];
const pick = (h, keys) => Object.fromEntries(keys.filter(k => h[k] != null).map(k => [k, String(h[k])]));

function sendJson(ws, obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

// Väntar tills socketens buffert tömts lite, så stora filer inte fyller minnet
function drained(ws) {
  return new Promise(resolve => {
    const check = () => (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount < HIGH_WATER) ? resolve() : setTimeout(check, 30);
    check();
  });
}

// ===================== MOLNSIDAN =====================
const cloud = new EventEmitter();
let pcSock = null;
let pcInfo = null;
const pending = new Map(); // id -> { res, timer }

function pcOnline() { return !!(pcSock && pcSock.readyState === WebSocket.OPEN); }

function attachPc(ws) {
  if (pcSock && pcSock !== ws) { try { pcSock.close(4000, 'ersatt'); } catch {} }
  pcSock = ws;
  pcInfo = { since: new Date().toISOString() };
  const alive = setInterval(() => { try { ws.ping(); } catch {} }, 20000);

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    const p = pending.get(m.id);
    if (m.t === 'head' && p) { p.res.writeHead(m.status, m.headers || {}); bump(p); }
    else if (m.t === 'data' && p) { p.res.write(Buffer.from(m.d, 'base64')); bump(p); }
    else if (m.t === 'done' && p) { clearTimeout(p.timer); pending.delete(m.id); p.res.end(); }
    else if (m.t === 'hello') { pcInfo = { ...pcInfo, host: m.host }; cloud.emit('hello', m, reply => sendJson(ws, reply)); }
    else if (m.t === 'event') cloud.emit('event', m.type, m.data);
  });
  ws.on('close', () => {
    clearInterval(alive);
    if (pcSock !== ws) return;
    pcSock = null;
    for (const [id, p] of pending) { clearTimeout(p.timer); try { if (!p.res.headersSent) p.res.writeHead(502, { 'Content-Type': 'application/json' }); p.res.end(JSON.stringify({ error: 'Datorn kopplades från' })); } catch {} pending.delete(id); }
    cloud.emit('offline');
  });
  cloud.emit('online');
}

function bump(p) { clearTimeout(p.timer); p.timer = setTimeout(() => { try { p.res.end(); } catch {} pending.delete(p.id); }, 10 * 60000); }

// Skickar ett HTTP-anrop vidare till datorn och strömmar svaret tillbaka
function forward(req, res, pathWithQuery) {
  if (!pcOnline()) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: 'Datorn är inte igång — det här funkar när den är på.' }));
  }
  const id = rid();
  const p = { id, res, timer: null };
  pending.set(id, p); bump(p);
  const ws = pcSock;
  sendJson(ws, { t: 'req', id, method: req.method, path: pathWithQuery, headers: pick(req.headers, PASS_HEADERS) });
  req.on('data', async chunk => {
    for (let i = 0; i < chunk.length; i += CHUNK) sendJson(ws, { t: 'body', id, d: chunk.subarray(i, i + CHUNK).toString('base64') });
    if (ws.bufferedAmount > HIGH_WATER) { req.pause(); await drained(ws); req.resume(); }
  });
  req.on('end', () => sendJson(ws, { t: 'end', id }));
  res.on('close', () => { if (pending.has(id)) { sendJson(ws, { t: 'abort', id }); clearTimeout(p.timer); pending.delete(id); } });
}

// Enkelt JSON-anrop till datorn (för verktyg)
function call(method, path, body) {
  return new Promise(resolve => {
    if (!pcOnline()) return resolve({ error: 'Datorn är inte igång just nu, så det går inte. Det funkar när den är på.' });
    const chunks = [];
    let status = 200;
    const res = {
      headersSent: false,
      writeHead(s) { status = s; this.headersSent = true; },
      write(b) { chunks.push(b); },
      end(b) { if (b) chunks.push(Buffer.from(b)); const txt = Buffer.concat(chunks).toString(); let out; try { out = JSON.parse(txt); } catch { out = { error: txt.slice(0, 200) || `fel ${status}` }; } resolve(status >= 400 && !out.error ? { error: `fel ${status}` } : out); },
      on() {},
    };
    const id = rid();
    const p = { id, res, timer: null };
    pending.set(id, p); bump(p);
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    sendJson(pcSock, { t: 'req', id, method, path, headers: { 'content-type': 'application/json' } });
    if (data) sendJson(pcSock, { t: 'body', id, d: data.toString('base64') });
    sendJson(pcSock, { t: 'end', id });
  });
}

// ===================== DATORSIDAN =====================
const pcEvents = [];
let client = null;
let started = false;

function startClient({ cloudUrl, token, localPort, hello, onMigrated }) {
  if (started) return;
  started = true;
  let backoff = 2000;
  const wsUrl = cloudUrl.replace(/^http/, 'ws') + `/api/pc?token=${encodeURIComponent(token)}`;
  const reqs = new Map();

  const connect = () => {
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 15000 });
    let alive = null;
    ws.on('open', () => {
      backoff = 2000;
      client = ws;
      console.log('  Ansluten till molnet:', cloudUrl);
      sendJson(ws, { t: 'hello', host: os.hostname(), ...(hello ? hello() : {}) });
      while (pcEvents.length) sendJson(ws, pcEvents.shift());
      alive = setInterval(() => { try { ws.ping(); } catch {} }, 20000);
    });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.t === 'req') {
        const lr = http.request({ host: '127.0.0.1', port: localPort, method: m.method, path: m.path, headers: { ...m.headers, 'x-heimdall-token': token } }, async lres => {
          sendJson(ws, { t: 'head', id: m.id, status: lres.statusCode, headers: pick(lres.headers, BACK_HEADERS) });
          lres.on('data', async chunk => {
            for (let i = 0; i < chunk.length; i += CHUNK) sendJson(ws, { t: 'data', id: m.id, d: chunk.subarray(i, i + CHUNK).toString('base64') });
            if (ws.bufferedAmount > HIGH_WATER) { lres.pause(); await drained(ws); lres.resume(); }
          });
          lres.on('end', () => { reqs.delete(m.id); sendJson(ws, { t: 'done', id: m.id }); });
        });
        lr.on('error', e => {
          reqs.delete(m.id);
          sendJson(ws, { t: 'head', id: m.id, status: 502, headers: { 'content-type': 'application/json' } });
          sendJson(ws, { t: 'data', id: m.id, d: Buffer.from(JSON.stringify({ error: e.message })).toString('base64') });
          sendJson(ws, { t: 'done', id: m.id });
        });
        reqs.set(m.id, lr);
      } else if (m.t === 'body') reqs.get(m.id)?.write(Buffer.from(m.d, 'base64'));
      else if (m.t === 'end') reqs.get(m.id)?.end();
      else if (m.t === 'abort') { reqs.get(m.id)?.destroy(); reqs.delete(m.id); }
      else if (m.t === 'migrated') {
        console.log(m.skipped ? '  Molnet hade redan din data sen tidigare.' : '  Din data är flyttad till molnet.');
        onMigrated?.(m);
      }
    });
    ws.on('close', (code, reason) => {
      clearInterval(alive);
      if (client === ws) client = null;
      for (const r of reqs.values()) r.destroy();
      reqs.clear();
      const why = reason?.toString();
      if (code === 4001) console.log('  Molnet nekade anslutningen: fel HEIMDALL_TOKEN i .env (måste vara samma som i molnet)');
      else console.log(`  Tappade molnet${why ? ' (' + why + ')' : ''} — försöker igen om ${Math.round(backoff / 1000)} s`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
    });
    ws.on('error', () => {}); // close hanteras ovan
  };
  connect();
}

// Händelser från datorn till molnet (jobb klart, notiser m.m.)
function sendEvent(type, data) {
  const msg = { t: 'event', type, data };
  if (client && client.readyState === WebSocket.OPEN) sendJson(client, msg);
  else { pcEvents.push(msg); if (pcEvents.length > 50) pcEvents.shift(); }
}

module.exports = { cloud, attachPc, pcOnline, pcInfo: () => pcInfo, forward, call, startClient, sendEvent };
