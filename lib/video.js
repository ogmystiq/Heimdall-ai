// Videoredigering: projektmappar med dina klipp, captions via Gemini, klippning via Claude Code + FFmpeg.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const brain = require('./brain');

const ROOT = () => process.env.VIDEO_DIR || path.join(os.homedir(), 'heimdall-video');
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const MEDIA_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|png|jpe?g|gif|srt)$/i;

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projekt';
const safeName = s => path.basename(String(s)).replace(/[^\w.\-åäöÅÄÖ ]/g, '_').slice(0, 120);

function dir(pid) {
  const d = path.join(ROOT(), slug(pid));
  if (!d.startsWith(ROOT())) throw new Error('ogiltigt projekt');
  return d;
}

let ffCache = { at: 0, ok: false };
function ffmpegOk() {
  if (Date.now() - ffCache.at < 60000) return ffCache.ok;
  let ok = false;
  try { ok = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0; } catch {}
  ffCache = { at: Date.now(), ok };
  return ok;
}

function create(name) {
  const pid = slug(name);
  const d = dir(pid);
  fs.mkdirSync(path.join(d, 'input'), { recursive: true });
  fs.mkdirSync(path.join(d, 'output'), { recursive: true });
  const metaFile = path.join(d, 'meta.json');
  if (!fs.existsSync(metaFile)) fs.writeFileSync(metaFile, JSON.stringify({ name, created: new Date().toISOString() }, null, 2));
  return pid;
}

function listFiles(d) {
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => MEDIA_EXT.test(f)).map(f => {
    const st = fs.statSync(path.join(d, f));
    return { name: f, size: st.size, at: st.mtime.toISOString() };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

function list() {
  if (!fs.existsSync(ROOT())) return [];
  return fs.readdirSync(ROOT()).filter(f => fs.existsSync(path.join(ROOT(), f, 'meta.json'))).map(pid => {
    const d = path.join(ROOT(), pid);
    const meta = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8'));
    return { id: pid, name: meta.name, created: meta.created, input: listFiles(path.join(d, 'input')), output: listFiles(path.join(d, 'output')) };
  }).sort((a, b) => b.created.localeCompare(a.created));
}

// Tar emot en fil direkt till disk (stora mobilklipp funkar)
function upload(req, pid, filename) {
  return new Promise((resolve, reject) => {
    const d = path.join(dir(pid), 'input');
    if (!fs.existsSync(d)) return reject(new Error('Projektet finns inte'));
    const name = safeName(filename);
    if (!MEDIA_EXT.test(name)) return reject(new Error('Bara video, ljud och bilder'));
    const out = fs.createWriteStream(path.join(d, name));
    req.pipe(out);
    out.on('finish', () => resolve({ name }));
    out.on('error', reject);
    req.on('error', reject);
  });
}

// Spelar upp en fil med stöd för att spola (krävs av iPhone)
function stream(req, res, pid, rel) {
  const file = path.join(dir(pid), rel);
  if (!file.startsWith(dir(pid)) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(file).size;
  const type = /\.mp4|\.m4v$/i.test(file) ? 'video/mp4' : /\.mov$/i.test(file) ? 'video/quicktime' : /\.webm$/i.test(file) ? 'video/webm'
    : /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.srt$/i.test(file) ? 'text/plain; charset=utf-8' : 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  const disp = new URL(req.url, 'http://x').searchParams.get('dl') ? { 'Content-Disposition': `attachment; filename="${path.basename(file)}"` } : {};
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type, ...disp });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': size, 'Content-Type': type, 'Accept-Ranges': 'bytes', ...disp });
    fs.createReadStream(file).pipe(res);
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('close', c => c === 0 ? resolve() : reject(new Error(err.split('\n').filter(Boolean).slice(-2).join(' ') || `${cmd} kod ${c}`)));
    p.on('error', reject);
  });
}

const srtTime = s => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(r).padStart(3, '0')}`;
};

// Gratis captions: FFmpeg plockar ut ljudet, Gemini skriver ut texten med tider
async function captions(pid, file) {
  if (!ffmpegOk()) throw new Error('FFmpeg saknas på datorn');
  const d = dir(pid);
  const src = path.join(d, 'input', safeName(file));
  if (!fs.existsSync(src)) throw new Error('Klippet finns inte');
  const tmp = path.join(os.tmpdir(), `heimdall-${Date.now()}.mp3`);
  await run('ffmpeg', ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', tmp]);
  const data = fs.readFileSync(tmp).toString('base64');
  fs.rmSync(tmp, { force: true });
  if (data.length > 19e6) throw new Error('Klippet är för långt för gratis-captions (max ca 60 min)');
  const out = await brain.ask(`Transkribera allt tal i ljudet ordagrant, på det språk som pratas. Dela upp i korta rader (max 6 ord) som passar som captions i en kort video.
Svara med JSON: {"lines": [{"start": sekunder, "end": sekunder, "text": "..."}]}. Är det inget tal, svara {"lines": []}.`, true, { inline_data: { mime_type: 'audio/mp3', data } });
  const lines = (out?.lines || []).filter(l => l.text && l.end > l.start);
  const srt = lines.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text.trim()}\n`).join('\n');
  const name = file.replace(/\.[^.]+$/, '') + '.srt';
  fs.writeFileSync(path.join(d, 'input', name), srt);
  return { name, lines: lines.length };
}

function editInstruction(p, instruction) {
  const files = p.input.map(f => `- input/${f.name} (${(f.size / 1e6).toFixed(1)} MB)`).join('\n');
  return `Du är videoredigerare. Projektmappen innehåller råmaterial i input/ och färdiga filer ska hamna i output/.
Råmaterial:
${files || '(inga filer)'}

Uppdrag: ${instruction}

Så här jobbar du:
- Använd ffprobe för att kolla längd, upplösning och ljud innan du klipper. Använd ffmpeg för klippning, ihopslagning, hastighet, zoom, övergångar (xfade), text (drawtext), captions (subtitles-filtret med .srt-filer från input/), musik och ljudnivåer.
- Finns en .srt i input/ med samma namn som ett klipp är det färdiga captions — bränn in dem snyggt (vit text, svart kontur, nedre tredjedelen, stor nog för mobil) om uppdraget vill ha captions.
- Shorts/TikTok/Reels = 1080x1920 (9:16), annars behåll originalformatet. Exportera H.264 + AAC, -movflags +faststart, rimlig storlek.
- Behövs avancerade animationer som ffmpeg inte klarar kan du använda Remotion via npx i en undermapp, men börja med ffmpeg.
- Skriv aldrig över eller radera något i input/. Spara resultatet som output/<kort-beskrivande-namn>.mp4. Gör du flera versioner, numrera dem.
- Kolla resultatet med ffprobe när du är klar.
Svara kort på svenska när du är klar: vilka filer du skapade och vad du gjorde.`;
}

function trailerInstruction(p, { url, length = 30, style = '', format = '9:16' }) {
  const audio = p.input.filter(f => /\.(mp3|wav|m4a|aac)$/i.test(f.name));
  const clips = p.input.filter(f => VIDEO_EXT.test(f.name));
  return `Gör en trailer för hemsidan ${url} . Projektmappen: råmaterial i input/, färdigt i output/.
Längd: ca ${length} sekunder. Format: ${format === '16:9' ? '1920x1080 (16:9)' : '1080x1920 (9:16, för TikTok/Reels/Shorts)'}.
${style ? 'Stil/önskemål: ' + style : ''}
Musik: ${audio.length ? audio.map(f => 'input/' + f.name).join(', ') + ' — klipp i takt till den' : 'ingen uppladdad — gör trailern utan musik (ladda ALDRIG ner musik från nätet, upphovsrätt)'}.
${clips.length ? 'Egna klipp att använda också: ' + clips.map(f => 'input/' + f.name).join(', ') : ''}

Så här gör du:
1. Spela in sajten på riktigt: skapa mappen work/, kör "npm install playwright" där och "npx playwright install chromium". Skriv ett node-skript som öppnar sajten i en ${format === '16:9' ? 'desktop-stor (1920x1080)' : 'mobilstor (390x844, deviceScaleFactor 3)'} webbläsare med recordVideo påslaget och spelar in flera korta sekvenser: startsidan, och 3–5 av de mest visuella undersidorna (hitta dem via länkarna på sajten). Scrolla mjukt (små steg med mouse.wheel och korta pauser), hovra/klicka gärna på något som animeras. Vänta tills sidan laddat klart. Stäng cookie-rutor om de dyker upp.
2. Välj ut de snyggaste 1–3 sekundersbitarna. Klipp snabbt och rytmiskt, med en lugnare start, ökande tempo och ett tydligt slut.
3. Lägg till korta, kraftfulla textskyltar (drawtext, stor fet text, max 4–5 ord per skylt) som säger vad sajten erbjuder — hämta orden från sajtens egna rubriker, hitta inte på påståenden. Avsluta med sajtens namn/domän stort i ca 2 sekunder.
4. Matcha sajtens färger och känsla. Inga emojis, inget töntigt.
${audio.length ? '5. Hitta takten i musiken (t.ex. med ett litet node-skript som läser ljudvolymen via ffmpeg och letar toppar) och lägg klippen på taktslagen. Tona ut musiken mot slutet.' : ''}
Exportera output/trailer-${format === '16:9' ? '16x9' : '9x16'}.mp4 (H.264, AAC, -movflags +faststart). Kolla med ffprobe att längd och upplösning stämmer.
Radera inget i input/. Svara kort på svenska vad du gjorde.`;
}

module.exports = { ROOT, create, list, upload, stream, captions, editInstruction, trailerInstruction, dir, ffmpegOk, VIDEO_EXT };
