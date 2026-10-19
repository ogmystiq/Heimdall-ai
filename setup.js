// Första gången: frågar efter det HEIMDALL behöver och skriver .env + config.json åt dig.
// Kör igen när som helst med:  node setup.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

process.chdir(__dirname);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async q => { process.stdout.write(q); const { value } = await lines.next(); return String(value || '').trim(); };

function readEnv() {
  if (!fs.existsSync('.env')) return {};
  return Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => /^\s*[A-Z0-9_]+=/.test(l)).map(l => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()]));
}

(async () => {
  console.log('\n  ===== HEIMDALL – första inställningen =====\n');
  console.log('  Svara på frågorna och tryck Enter. Tryck bara Enter för att behålla det som står inom [ ].\n');
  const env = readEnv();
  const cfgFile = 'config.json';
  const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : JSON.parse(fs.readFileSync('config.example.json', 'utf8'));
  const cur = v => (v && !/klistra-in|byt-till|Ditt namn/.test(v) ? v : '');

  const name = await ask(`  1. Vad heter du? [${cur(cfg.owner) || '–'}] `) || cur(cfg.owner);
  if (name) cfg.owner = name;

  console.log('\n  2. Gemini-nyckel (gratis). Öppna https://aistudio.google.com/apikey, logga in med Google,');
  console.log('     tryck "Create API key" och kopiera nyckeln. Klistra in med högerklick i det här fönstret.');
  let key = await ask(`     Nyckel [${cur(env.GEMINI_API_KEY) ? 'sparad' : '–'}]: `) || cur(env.GEMINI_API_KEY);
  for (let i = 0; !key && i < 5; i++) key = await ask('     HEIMDALL kan inte tänka utan en nyckel. Klistra in den: ');
  if (!key) { console.log('\n  Ingen nyckel — kör setup igen när du har den (dubbelklicka start.bat).'); process.exit(1); }

  let token = cur(env.HEIMDALL_TOKEN);
  if (!token) token = crypto.randomBytes(9).toString('base64url');
  console.log(`\n  3. Din åtkomstkod till appen: ${token}`);
  console.log('     Skriv upp den! Du skriver in den första gången du öppnar appen på mobilen/datorn.');

  console.log('\n  4. Molnadress (bara om du redan satt upp HEIMDALL på Render enligt README, annars tryck Enter)');
  const cloud = await ask(`     Adress, t.ex. https://heimdall-abcd.onrender.com [${env.CLOUD_URL || '–'}]: `) || env.CLOUD_URL || '';

  const out = { ...env, GEMINI_API_KEY: key, HEIMDALL_TOKEN: token, PORT: env.PORT || '4777' };
  if (cloud) out.CLOUD_URL = cloud.replace(/\/+$/, ''); else delete out.CLOUD_URL;
  fs.writeFileSync('.env', Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  console.log('\n  Klart! Sparat i .env och config.json. HEIMDALL startar nu.\n');
  rl.close();
})();
