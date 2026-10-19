// Styr datorn som HEIMDALL körs på. Bara en fast lista med säkra kommandon — inget fritt terminalkommando.
const { spawn } = require('child_process');
const os = require('os');

const isWin = process.platform === 'win32';

function ps(script) {
  if (!isWin) return Promise.resolve({ ok: false, error: 'Datorstyrning funkar bara på Windows' });
  return new Promise(resolve => {
    const p = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('close', code => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().slice(0, 200) || `kod ${code}` }));
    p.on('error', e => resolve({ ok: false, error: e.message }));
  });
}

const esc = s => String(s).replace(/'/g, "''");
const KEYS = { playpause: 179, next: 176, previous: 178, mute: 173, volume_down: 174, volume_up: 175 };

// Vanliga program -> vad som ska startas
const APPS = {
  spotify: 'spotify:', discord: 'discord:', chrome: 'chrome', brave: 'brave', edge: 'msedge', firefox: 'firefox',
  utforskaren: 'explorer', explorer: 'explorer', anteckningar: 'notepad', notepad: 'notepad', steam: 'steam:',
  'vs code': 'code', vscode: 'code', terminal: 'wt', powershell: 'powershell', kalkylator: 'calc', inställningar: 'ms-settings:',
  'claude': 'claude:', 'aktivitetshanteraren': 'taskmgr', notes: 'notepad', anteckningar: 'notepad', paint: 'mspaint',
  'word': 'winword', 'excel': 'excel', 'kamera': 'microsoft.windows.camera:', 'klocka': 'ms-clock:', 'kalender': 'outlookcal:',
};

const actions = {
  open_url: ({ url }) => {
    if (!/^https?:\/\//i.test(url || '')) url = 'https://' + url;
    return ps(`Start-Process '${esc(url)}'`);
  },
  open_app: async ({ name }) => {
    const key = String(name || '').toLowerCase().trim();
    const target = APPS[key];
    if (target) { const r = await ps(`Start-Process '${esc(target)}'`); if (r.ok) return r; }
    // Hittar vilket program som helst: Windows-knappen, skriv namnet, Enter — som du själv gör
    const typed = String(name).replace(/'/g, "''").replace(/[+^%~(){}[\]]/g, '{$&}');
    return ps(`Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace H2 -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte s, uint f, int e);'
[H2.K]::keybd_event(91,0,0,0); [H2.K]::keybd_event(91,0,2,0); Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait('${typed}'); Start-Sleep -Milliseconds 900
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`);
  },
  open_folder: ({ path }) => ps(`Start-Process explorer '${esc(path || os.homedir())}'`),
  media: ({ key }) => {
    const code = KEYS[key];
    if (!code) return { ok: false, error: 'okänd mediaknapp' };
    const times = /volume/.test(key) ? 5 : 1;
    return ps(`$w = New-Object -ComObject WScript.Shell; 1..${times} | % { $w.SendKeys([char]${code}) }`);
  },
  lock: () => ps('rundll32.exe user32.dll,LockWorkStation'),
  sleep: () => ps('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)'),
  shutdown: ({ minutes = 1 }) => ps(`shutdown /s /t ${Math.max(30, Math.round(minutes * 60))}`),
  cancel_shutdown: () => ps('shutdown /a'),
  type_text: ({ text }) => ps(`$w = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 300; $w.SendKeys('${esc(String(text).replace(/[+^%~(){}[\]]/g, '{$&}'))}')`),
};

async function run({ action, ...args }) {
  const fn = actions[action];
  if (!fn) return { ok: false, error: `okänd åtgärd: ${action}` };
  return fn(args);
}

module.exports = { run, ACTIONS: Object.keys(actions) };
