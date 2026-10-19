// Styr en Google TV/Android TV över hemnätet med ADB. Kräver att datorn ligger på samma nät som TV:n.
// Bara en fast lista med säkra kommandon — inget fritt skalkommando.
const { execFile } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const PORT = 5555;

// adb: i PATH, i projektets tools/adb, eller i Android SDK
function adbPath() {
  const local = process.env.LOCALAPPDATA || '';
  const cands = [
    path.join(__dirname, '..', 'tools', 'adb', 'adb.exe'),
    path.join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  ];
  return cands.find(p => fs.existsSync(p)) || 'adb';
}

function adb(args, timeout = 8000) {
  return new Promise(resolve => {
    execFile(adbPath(), args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ ok: false, missing: true, error: 'ADB saknas på datorn. Ladda ner "SDK Platform-Tools" från Google och packa upp till mappen tools\\adb i HEIMDALL-mappen (så att adb.exe ligger direkt i mappen adb).' });
      const out = String(stdout || '').trim();
      if (err) return resolve({ ok: false, error: (String(stderr || '').trim() || err.message).slice(0, 200), out });
      resolve({ ok: true, out });
    });
  });
}

const target = ip => `${ip}:${PORT}`;
const validIp = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || '').trim());

// Knappar -> Android-tangentkoder
const KEYS = {
  home: 3, back: 4, up: 19, down: 20, left: 21, right: 22, ok: 23, menu: 82,
  playpause: 85, next: 87, previous: 88, play: 126, pause: 127,
  volume_up: 24, volume_down: 25, mute: 164, power: 26, wakeup: 224, sleep: 223,
  channel_up: 166, channel_down: 167, input: 178, settings: 176,
};

// Appar -> Android-paket
const APPS = {
  youtube: 'com.google.android.youtube.tv', netflix: 'com.netflix.ninja', 'disney+': 'com.disney.disneyplus', disney: 'com.disney.disneyplus',
  viaplay: 'com.viaplay.android', svt: 'se.svt.svtplay', 'svt play': 'se.svt.svtplay', max: 'com.wbd.stream', hbo: 'com.wbd.stream',
  prime: 'com.amazon.amazonvideo.livingroom', 'prime video': 'com.amazon.amazonvideo.livingroom', spotify: 'com.spotify.tv.android',
  twitch: 'tv.twitch.android.app', 'tv4 play': 'se.tv4.tv4playtab', tv4: 'se.tv4.tv4playtab', plex: 'com.plexapp.android', kodi: 'org.xbmc.kodi',
};


// ---- Hitta en låt/video att spela (ingen nyckel behövs) ----
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8' };
async function get(url) {
  try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) }); return r.ok ? await r.text() : ''; } catch { return ''; }
}

// Låtnamn + artister för ett Spotify-id (från låtens publika sida)
async function spotifyInfo(id) {
  const html = await get(`https://open.spotify.com/track/${id}`);
  const meta = n => (html.match(new RegExp(`<meta[^>]+(?:property|name)="${n}"[^>]+content="([^"]*)"`, 'i')) || [])[1] || '';
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  if (!title && !meta('og:title')) return null;
  const text = [title, meta('og:title'), meta('og:description'), meta('description'), meta('music:musician_description')].join(' ');
  return { id, title: meta('og:title') || title.split(' - ')[0], text: text.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'") };
}

const norm = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9åäö ]/g, ' ');
const STOP = new Set(['med', 'by', 'feat', 'ft', 'och', 'and', 'the', 'av', 'låten', 'song', 'spotify', 'på', 'x']);
// Hur många av orden i det han bad om finns i låtnamn + artister (0–1)
function score(query, text) {
  const words = norm(query).split(/\s+/).filter(w => w && !STOP.has(w));
  if (!words.length) return 0;
  const hay = ' ' + norm(text).replace(/\s+/g, ' ') + ' ';
  return words.filter(w => hay.includes(' ' + w + ' ') || hay.includes(w)).length / words.length;
}

function idsFrom(text, into) {
  for (const m of String(text).matchAll(/(?:open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/g)) if (!into.includes(m[1])) into.push(m[1]);
}

async function best(query, ids) {
  const infos = (await Promise.all(ids.slice(0, 8).map(spotifyInfo))).filter(Boolean);
  let top = null;
  for (const i of infos) { i.score = score(query, i.text); if (!top || i.score > top.score) top = i; }
  return top;
}

async function findSpotify(query) {
  const ids = [];
  const pages = await Promise.all([
    get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' spotify')}`),
    get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent('site:open.spotify.com/track ' + query)}`),
  ]);
  for (const h of pages) { try { idsFrom(decodeURIComponent(h), ids); } catch { idsFrom(h, ids); } }
  let top = ids.length ? await best(query, ids) : null;
  if (!top || top.score < 1) {
    try {
      const r = await require('./brain').search(`Vilken är Spotify-länken (open.spotify.com/track/...) till låten "${query}"? Det måste vara exakt den versionen/artisten. Svara bara med länken.`);
      const more = [];
      idsFrom(r.text + ' ' + r.sources.map(x => x.url + ' ' + x.title).join(' '), more);
      const fresh = more.filter(x => !ids.includes(x));
      const t2 = fresh.length ? await best(query, fresh) : null;
      if (t2 && (!top || t2.score > top.score)) top = t2;
    } catch {}
  }
  // Hellre öppna en sökning än spela fel låt
  return top && top.score >= 0.99 ? top : null;
}

async function findYouTube(query) {
  const html = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  const m = html.match(/"videoId":"([\w-]{11})"/);
  return m ? m[1] : null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const safeQuery = q => encodeURIComponent(String(q || '').trim()).replace(/['()!*]/g, '');

// Väcker TV:n från standby med "Wake on LAN/Wi-Fi" (magiskt paket från datorn på samma nät)
const validMac = mac => /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(mac || '').trim());
function wake(mac, ip) {
  return new Promise(resolve => {
    const hex = mac.replace(/[:-]/g, '');
    const pkt = Buffer.from('ff'.repeat(6) + hex.repeat(16), 'hex');
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => { try { sock.close(); } catch {} resolve(false); });
    sock.bind(() => {
      sock.setBroadcast(true);
      const targets = ['255.255.255.255', ip.replace(/\d+$/, '255')];
      let left = targets.length * 3;
      for (let i = 0; i < 3; i++) for (const t of targets) for (const port of [9]) sock.send(pkt, port, t, () => { if (--left === 0) { sock.close(); resolve(true); } });
    });
  });
}

async function powerOn(ip, mac) {
  let r = await shell(ip, 'input keyevent 224');
  if (r.ok || r.missing) return r;
  if (!validMac(mac)) return { ok: false, error: 'TV:n är helt avstängd så jag når den inte. Anslut till TV:n en gång till medan den är på (så sparar jag dess adress för att kunna väcka den), och slå på "Nätverksstandby"/"Väck med Wi-Fi" på TV:n.' };
  for (let i = 0; i < 6; i++) {
    await wake(mac, ip);
    await new Promise(res => setTimeout(res, 4000));
    const c = await connect(ip);
    if (c.ok) { r = await shell(ip, 'input keyevent 224'); if (r.ok) return { ok: true, woke: true }; }
  }
  return { ok: false, error: 'Skickade väckningssignal men TV:n svarade inte. Slå på "Nätverksstandby" (eller "Väck med Wi-Fi/Wake on LAN") under Inställningar → System → Ström och energi på TV:n.' };
}

async function connect(ip) {
  if (!validIp(ip)) return { ok: false, error: 'Ogiltig IP-adress för TV:n' };
  const r = await adb(['connect', target(ip)], 10000);
  if (!r.ok) return r;
  if (/connected to|already connected/i.test(r.out)) {
    const m = await adb(['-s', target(ip), 'shell', 'cat /sys/class/net/wlan0/address /sys/class/net/eth0/address 2>/dev/null']);
    const mac = (String(m.out || '').match(/([0-9a-f]{2}:){5}[0-9a-f]{2}/i) || [])[0] || null;
    return { ok: true, ip, ...(mac && mac !== '00:00:00:00:00:00' ? { mac } : {}) };
  }
  return { ok: false, error: r.out || 'Kunde inte ansluta' };
}

// Kör ett skalkommando på TV:n; ansluter först om det behövs
async function shell(ip, cmd, timeout = 8000) {
  if (!validIp(ip)) return { ok: false, error: 'TV:ns IP är inte inställd. Be mig ansluta till TV:n med dess IP-adress.' };
  let r = await adb(['-s', target(ip), 'shell', cmd], timeout);
  if (r.missing) return r;
  if (!r.ok && /not found|offline|no devices|cannot connect|closed/i.test(r.error)) {
    const c = await connect(ip);
    if (!c.ok) return { ok: false, error: `Får inte kontakt med TV:n (${ip}). ${c.error}. Är TV:n avstängd? Be mig starta den, annars kolla att den är på samma wifi.` };
    r = await adb(['-s', target(ip), 'shell', cmd], timeout);
  }
  if (!r.ok && /unauthorized/i.test(r.error)) return { ok: false, error: 'TV:n väntar på godkännande — tryck "Tillåt" på TV-skärmen och försök igen.' };
  return r;
}

const actions = {
  connect: ({ ip }) => connect(ip),
  key: async ({ ip, key }) => {
    const code = KEYS[String(key || '').toLowerCase()];
    if (!code) return { ok: false, error: `okänd knapp: ${key}. Finns: ${Object.keys(KEYS).join(', ')}` };
    return shell(ip, `input keyevent ${code}`);
  },
  volume: async ({ ip, direction, steps = 3 }) => {
    const code = direction === 'down' ? 25 : 24;
    const n = Math.max(1, Math.min(20, Math.round(steps)));
    return shell(ip, Array(n).fill(`input keyevent ${code}`).join(' && '));
  },
  power_on: ({ ip, mac }) => powerOn(ip, mac),
  power_off: ({ ip }) => shell(ip, 'input keyevent 223'),
  open_app: ({ ip, name }) => {
    const pkg = APPS[String(name || '').toLowerCase().trim()];
    if (!pkg) return { ok: false, error: `okänd TV-app: ${name}. Finns: ${[...new Set(Object.keys(APPS))].join(', ')}` };
    return shell(ip, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  },
  open_url: ({ ip, url }) => {
    if (!/^https?:\/\/[^\s'"`$;&|<>\\]+$/i.test(url || '')) return { ok: false, error: 'Ogiltig webbadress' };
    return shell(ip, `am start -a android.intent.action.VIEW -d '${url}'`);
  },
  type_text: ({ ip, text }) => {
    const t = String(text || '');
    if (!t || !/^[\p{L}\p{N} .,@_-]+$/u.test(t)) return { ok: false, error: 'Texten får bara innehålla bokstäver, siffror och enkla tecken' };
    return shell(ip, `input text '${t.replace(/ /g, '%s')}'`);
  },
  // Spela en låt/video direkt: Spotify (standard för musik) eller YouTube
  play: async ({ ip, query, app = 'spotify' }) => {
    if (!String(query || '').trim()) return { ok: false, error: 'Säg vad som ska spelas' };
    if (/youtube/i.test(app)) {
      const vid = await findYouTube(query);
      if (!vid) return { ok: false, error: `Hittade inte "${query}" på YouTube` };
      const r = await shell(ip, `am start -a android.intent.action.VIEW -d 'https://www.youtube.com/watch?v=${vid}' com.google.android.youtube.tv`);
      return r.ok ? { ok: true, playing: query, app: 'YouTube' } : r;
    }
    const hit = await findSpotify(query);
    if (!hit) {
      // Hittade inte exakt låt — öppna Spotifys sökning istället
      const r = await shell(ip, `am start -a android.intent.action.VIEW -d 'spotify:search:${safeQuery(query)}' com.spotify.tv.android`);
      return r.ok ? { ok: true, note: `Hittade inte exakt låt, öppnade Spotify-sökning på "${query}" på TV:n` } : r;
    }
    const r = await shell(ip, `am start -a android.intent.action.VIEW -d 'spotify:track:${hit.id}' com.spotify.tv.android`);
    if (!r.ok) return r;
    await sleep(4000);
    await shell(ip, 'input keyevent 126'); // tryck play ifall Spotify bara visar låten
    return { ok: true, playing: hit.title, app: 'Spotify', info: hit.text.slice(0, 120) };
  },
  // Volym till max: sätt TV:ns maxvärde direkt, annars tryck volym upp i omgångar
  max_volume: async ({ ip }) => {
    const readVol = async () => {
      const g = await shell(ip, 'cmd media_session volume --stream 3 --get 2>&1 || media volume --stream 3 --get 2>&1', 10000);
      const m = String(g.out || g.error || '').match(/volume is (\d+) in range \[\s*\d+\s*\.\.\s*(\d+)\s*\]/i);
      return m ? { now: Number(m[1]), max: Number(m[2]) } : null;
    };
    const v = await readVol();
    if (v && v.now >= v.max) return { ok: true, volume: 'max' };
    if (v) {
      await shell(ip, `cmd media_session volume --stream 3 --set ${v.max} 2>&1 || media volume --stream 3 --set ${v.max} 2>&1`, 10000);
      const after = await readVol();
      if (after && after.now >= after.max) return { ok: true, volume: 'max' };
    }
    // Reserv: volym upp 20 åt gången (TV:ns egen volym kan ha upp till 100 steg)
    let last = { ok: false };
    for (let i = 0; i < 5; i++) {
      last = await shell(ip, 'input keyevent ' + Array(20).fill(24).join(' '), 20000);
      if (!last.ok) break;
      const now = await readVol();
      if (now && now.now >= now.max) break;
    }
    return last.ok ? { ok: true, volume: 'max' } : last;
  },
  status: async ({ ip }) => {
    const r = await shell(ip, 'dumpsys power | grep -m1 mWakefulness');
    if (!r.ok) return r;
    return { ok: true, on: /Awake/i.test(r.out), raw: r.out };
  },
};

async function run({ action, ...args }) {
  const fn = actions[action];
  if (!fn) return { ok: false, error: `okänd TV-åtgärd: ${action}` };
  try { return await fn(args); } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { run, ACTIONS: Object.keys(actions), validIp };
