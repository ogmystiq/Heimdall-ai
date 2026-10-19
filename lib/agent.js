// Datoragent: tittar på skärmen, flyttar musen, klickar och skriver tills uppgiften är klar.
// Hjärna: Gemini (gratis) som tittar på skärmdumpar. Händer: PowerShell + Windows egna funktioner.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const brain = require('./brain');

const bus = new EventEmitter();
const isWin = process.platform === 'win32';
const SHOT = path.join(os.tmpdir(), 'heimdall-skarm.png');

// C#-hjälpare för mus och tangentbord, laddas i varje PowerShell-anrop
const NATIVE = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
if (-not ('H.W' -as [type])) { Add-Type -Namespace H -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, int e);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte s, uint f, int e);
'@ }
[H.W]::SetProcessDPIAware() | Out-Null
`;

function ps(script, timeout = 15000) {
  if (!isWin) return Promise.reject(new Error('Datorstyrning funkar bara på Windows'));
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', NATIVE + script], { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('tog för lång tid')); }, timeout);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim().split('\n')[0] || `kod ${code}`)); });
    p.on('error', e => { clearTimeout(t); reject(e); });
  });
}

// Skärmdump, nedskalad till max 1280 px bred. Returnerar bild + verklig skärmstorlek.
async function screenshot() {
  const out = await ps(`
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$p = [System.Windows.Forms.Cursor]::Position
$g.FillEllipse([System.Drawing.Brushes]::Red, $p.X - 6, $p.Y - 6, 12, 12)
$w = [Math]::Min(1280, $b.Width); $h = [int]($b.Height * $w / $b.Width)
$s = New-Object System.Drawing.Bitmap $bmp, $w, $h
$s.Save('${SHOT}', [System.Drawing.Imaging.ImageFormat]::Png)
"$($b.Width)x$($b.Height)"`);
  const [w, h] = out.split('x').map(Number);
  return { data: fs.readFileSync(SHOT).toString('base64'), w, h };
}

const VK = { enter: 13, tab: 9, esc: 27, escape: 27, backspace: 8, delete: 46, space: 32, up: 38, down: 40, left: 37, right: 39,
  home: 36, end: 35, pageup: 33, pagedown: 34, ctrl: 17, control: 17, shift: 16, alt: 18, win: 91, windows: 91,
  f5: 116, f11: 122, f12: 123 };
const vk = k => VK[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : null);

async function act(a, scr) {
  const px = (v, max) => Math.round(Math.max(0, Math.min(1000, Number(v))) / 1000 * max);
  switch (a.action) {
    case 'click': case 'double_click': case 'right_click': {
      const x = px(a.x, scr.w), y = px(a.y, scr.h);
      const [d, u] = a.action === 'right_click' ? [8, 16] : [2, 4];
      const clicks = a.action === 'double_click' ? 2 : 1;
      return ps(`[H.W]::SetCursorPos(${x}, ${y}); Start-Sleep -Milliseconds 80; 1..${clicks} | % { [H.W]::mouse_event(${d},0,0,0,0); [H.W]::mouse_event(${u},0,0,0,0); Start-Sleep -Milliseconds 60 }`);
    }
    case 'move': return ps(`[H.W]::SetCursorPos(${px(a.x, scr.w)}, ${px(a.y, scr.h)})`);
    case 'scroll': return ps(`[H.W]::mouse_event(2048,0,0,${(a.direction === 'up' ? 1 : -1) * 120 * (a.amount || 5)},0)`);
    case 'type': {
      const t = String(a.text || '').replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, '{$&}');
      return ps(`[System.Windows.Forms.SendKeys]::SendWait('${t}')`);
    }
    case 'key': {
      const keys = String(a.keys || '').toLowerCase().split('+').map(s => s.trim()).filter(Boolean).map(vk);
      if (!keys.length || keys.includes(null)) throw new Error(`okänd tangent: ${a.keys}`);
      const down = keys.map(k => `[H.W]::keybd_event(${k},0,0,0)`).join('; ');
      const up = keys.slice().reverse().map(k => `[H.W]::keybd_event(${k},0,2,0)`).join('; ');
      return ps(`${down}; Start-Sleep -Milliseconds 50; ${up}`);
    }
    case 'open': {
      const target = String(a.target || '').replace(/'/g, "''");
      return ps(`Start-Process '${target}'`);
    }
    case 'wait': return new Promise(r => setTimeout(r, Math.min(5000, (a.seconds || 1) * 1000)));
    default: throw new Error(`okänd åtgärd: ${a.action}`);
  }
}

const PROMPT = (goal, history) => `Du styr en Windows-dator för att utföra: "${goal}"
Bilden är en skärmdump just nu. Den röda pricken är muspekaren.

Tidigare steg:
${history.map((h, i) => `${i + 1}. ${h}`).join('\n') || '(inga än)'}

Välj EXAKT ETT nästa steg. Svara med ETT JSON-objekt och inget annat:
{"thought": "kort: vad du ser och varför", "action": "...", ...fält}

Åtgärder:
- {"action":"click"|"double_click"|"right_click","x":0-1000,"y":0-1000}  (x/y = position i promille av bildens bredd/höjd, mitt på det du vill klicka på)
- {"action":"type","text":"..."}  (skriver i fältet som har fokus — klicka i fältet först)
- {"action":"key","keys":"enter" | "ctrl+l" | "win" | "alt+tab" | "ctrl+t" ...}
- {"action":"scroll","direction":"up"|"down","amount":1-10}
- {"action":"open","target":"https://... eller programnamn som spotify:, chrome, notepad"}
- {"action":"wait","seconds":1-5}
- {"action":"done","summary":"vad som gjordes, på svenska"}
- {"action":"fail","summary":"varför det inte gick, på svenska"}

Tips:
- Kortkommandon är säkrare än att klicka. Discord: ctrl+k och skriv namnet för att öppna en chatt med någon. Webbläsare: ctrl+l för adressfältet, ctrl+t ny flik. Windows: win och skriv programnamnet för att starta det.
- Öppna program med open (t.ex. "discord:", "spotify:") och vänta sedan 2 sekunder med wait innan du gör något mer.

Regler:
- Snabbaste vägen: vill du söka på nätet, använd open med en sök-URL (t.ex. https://www.youtube.com/results?search_query=...) istället för att klicka runt.
- Skriv aldrig in lösenord, kortnummer eller koder, och genomför aldrig köp eller betalningar — svara fail och be användaren göra det själv.
- Radera inget och skicka inga meddelanden till andra om uppgiften inte uttryckligen säger det.
- Om samma steg misslyckats två gånger, prova något annat.
- Svara done så fort målet är nått.`;

// Exakt mall för AI:ns svar
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    thought: { type: 'STRING' },
    action: { type: 'STRING', enum: ['click', 'double_click', 'right_click', 'move', 'type', 'key', 'scroll', 'open', 'wait', 'done', 'fail'] },
    x: { type: 'NUMBER' }, y: { type: 'NUMBER' },
    text: { type: 'STRING' }, keys: { type: 'STRING' }, target: { type: 'STRING' },
    direction: { type: 'STRING' }, amount: { type: 'NUMBER' }, seconds: { type: 'NUMBER' },
    summary: { type: 'STRING' },
  },
  required: ['thought', 'action'],
};

let current = null;

async function run(goal, { maxSteps = 25 } = {}) {
  if (current) throw new Error('Ett datorjobb körs redan — säg "stoppa" först');
  const job = { goal, steps: [], status: 'kör', started: Date.now(), summary: '' };
  current = job;
  bus.emit('update', job);
  try {
    for (let i = 0; i < maxSteps && job.status === 'kör'; i++) {
      const scr = await screenshot();
      let a;
      for (let tries = 0; tries < 3 && !a; tries++) {
        try {
          a = await brain.ask(PROMPT(goal, job.steps.map(s => s.text)), true, { inline_data: { mime_type: 'image/png', data: scr.data } }, SCHEMA);
        } catch (e) {
          job.lastErr = e.message;
          if (e.quota || /gräns|429|quota/i.test(e.message)) {
            job.steps.push({ text: `väntar ${Math.round((e.retryMs || 15000) / 1000)} s på Googles gräns`, ok: false });
            bus.emit('update', job);
            await new Promise(r => setTimeout(r, Math.min(60000, (e.retryMs || 15000) + 1000)));
          } else throw e;
        }
      }
      if (!a?.action) {
        // Ett misslyckat svar ska inte stoppa allt — försök igen med nästa skärmdump
        job.misses = (job.misses || 0) + 1;
        if (job.misses >= 3) throw new Error(job.lastErr ? `Google svarade med fel: ${job.lastErr}` : `AI:n svarade inte i rätt format. Senaste svar: ${brain.getLastRaw()}`);
        continue;
      }
      job.misses = 0;
      if (job.status !== 'kör') break;
      if (a.action === 'done' || a.action === 'fail') {
        job.status = a.action === 'done' ? 'klar' : 'misslyckades';
        job.summary = a.summary || '';
        break;
      }
      const label = `${a.action}${a.text ? ` "${String(a.text).slice(0, 40)}"` : ''}${a.keys ? ` ${a.keys}` : ''}${a.target ? ` ${a.target}` : ''} — ${a.thought || ''}`;
      try { await act(a, scr); job.steps.push({ text: label, ok: true }); }
      catch (e) { job.steps.push({ text: `${label} (MISSLYCKADES: ${e.message})`, ok: false }); }
      bus.emit('update', job);
      await new Promise(r => setTimeout(r, a.action === 'open' ? 1800 : 700)); // låt skärmen hinna uppdateras
    }
    if (job.status === 'kör') { job.status = 'misslyckades'; job.summary = 'Hann inte klart på tillåtet antal steg'; }
  } catch (e) {
    job.status = 'misslyckades'; job.summary = e.message;
    console.log('Datoragent-fel:', e.stack || e.message);
  } finally {
    current = null;
    bus.emit('update', job);
    bus.emit('done', job);
  }
  return job;
}

function stop() {
  if (!current) return false;
  current.status = 'stoppad'; current.summary = 'Stoppad av dig';
  return true;
}

module.exports = { run, stop, bus, screenshot, isRunning: () => !!current };
