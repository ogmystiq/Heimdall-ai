// Körs av Claude Code när den svarat klart. Säger till HEIMDALL att titta på vad som gjordes.
// Får aldrig störa Claude Code: kör snabbt, svälj alla fel, avsluta alltid med 0.
const fs = require('fs');
const path = require('path');
const http = require('http');

if (process.env.HEIMDALL_JOB) process.exit(0); // HEIMDALLs egna jobb bockar av sig själva

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(input || '{}');
    let token = '', port = 4777;
    try {
      const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
      token = (env.match(/^HEIMDALL_TOKEN=(.*)$/m) || [])[1]?.trim() || '';
      port = Number((env.match(/^PORT=(.*)$/m) || [])[1]) || 4777;
    } catch {}
    const body = JSON.stringify({ session_id: ev.session_id, transcript_path: ev.transcript_path, cwd: ev.cwd });
    const req = http.request({ host: '127.0.0.1', port, path: '/api/hook/claude', method: 'POST', timeout: 2000,
      headers: { 'Content-Type': 'application/json', 'X-Heimdall-Token': token, 'Content-Length': Buffer.byteLength(body) } },
      res => { res.resume(); res.on('end', () => process.exit(0)); });
    req.on('error', () => process.exit(0));
    req.on('timeout', () => { req.destroy(); process.exit(0); });
    req.end(body);
  } catch { process.exit(0); }
});
setTimeout(() => process.exit(0), 3000);
