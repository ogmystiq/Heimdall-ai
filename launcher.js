// Startar HEIMDALL: hämtar senaste versionen från GitHub, installerar det som behövs,
// kör servern och startar om den om den stannar (t.ex. efter "uppdatera dig").
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.chdir(__dirname);
const run = cmd => execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });

function update() {
  try {
    if (!fs.existsSync('.git')) { console.log('HEIMDALL är inte nerladdad med git — hoppar över automatiska uppdateringar.'); throw Object.assign(new Error('ingen git'), { quiet: true }); }
    console.log('Letar efter uppdateringar...');
    run('git fetch -q origin main');
    const before = fs.existsSync('.git/HEAD') ? (() => { try { return run('git rev-parse HEAD').trim(); } catch { return ''; } })() : '';
    // Finns lokala ändringar som inte publicerats (t.ex. Claude jobbat i HEIMDALL) — skriv inte över dem
    const dirty = run('git status --porcelain --untracked-files=no').split('\n').map(s => s.trim()).filter(s => s && !/start\.bat|\.gitattributes/.test(s));
    if (dirty.length && before) {
      console.log('Det finns ändringar i HEIMDALL som inte publicerats — hoppar över uppdateringen tills de är publicerade eller ångrade:', dirty.join(', '));
    } else {
      run('git reset -q --hard origin/main');
      const after = run('git rev-parse HEAD').trim();
      console.log(before === after ? 'Redan senaste versionen.' : 'HEIMDALL är uppdaterad.');
    }
  } catch (e) {
    if (!e.quiet) console.log('Kunde inte uppdatera, kör nuvarande version.', (e.stderr || e.message || '').toString().split('\n')[0]);
  }
  try {
    run('npm install --omit=dev --no-audit --no-fund --loglevel=error');
  } catch (e) {
    console.log('npm install misslyckades:', (e.stderr || e.message || '').toString().split('\n')[0]);
  }
}

function start() {
  update();
  // Första gången (eller om nyckeln saknas): fråga efter det som behövs
  const env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  if (!/GEMINI_API_KEY=\S/.test(env) || /klistra-in/.test(env)) require('child_process').spawnSync(process.execPath, ['setup.js'], { stdio: 'inherit' });
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'inherit' });
  child.on('exit', code => {
    console.log(`\nHEIMDALL startar om${code ? ' (kraschade, kod ' + code + ')' : ''}...`);
    setTimeout(start, code ? 3000 : 500);
  });
}

start();
