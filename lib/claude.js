// Kör Claude Code (claude -p) i en projektmapp på din dator.
// Regler: Claude får aldrig committa eller pusha själv, och HEIMDALL kör aldrig `git add -A`.
// Före jobbet sparas en checkpoint (utan att något i repot ändras) så jobbet kan ångras.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { db, save, id, completeTask } = require('./db');
const active = require('./activemodel');

const bus = new EventEmitter();
bus.setMaxListeners(50);

const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'Bash(npm run *)', 'Bash(npm install*)', 'Bash(npx *)', 'Bash(node *)',
  'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)',
  'mcp__playwright', // webbläsarverktygen (Playwright MCP) — utan denna nekas de i bakgrundsjobb
  'Bash(ffmpeg *)', 'Bash(ffprobe *)', 'Bash(mkdir *)', 'Bash(ls *)', 'Bash(dir *)',
].join(',');
// git add / commit / push ingår INTE — det sker bara när du trycker "Publicera".

const running = new Map(); // jobId -> child process

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);

function isRepo(cwd) {
  try { return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true'; } catch { return false; }
}

function checkpoint(cwd, job) {
  if (!isRepo(cwd)) return null;
  try {
    // Hämta senaste först (krockar annars med botens dagliga push) — bara om inget är ändrat lokalt
    if (!git(cwd, ['status', '--porcelain'])) {
      try {
        let up = null; try { up = git(cwd, ['rev-parse', '--abbrev-ref', '@{u}']); } catch {}
        git(cwd, up ? ['pull', '--rebase'] : ['pull', '--rebase', 'origin', 'main']);
        job.log.push({ t: 'info', v: 'Hämtade senaste från GitHub' });
      }
      catch { job.log.push({ t: 'info', v: 'Kunde inte hämta från GitHub, kör på lokala versionen' }); }
    }
    return {
      head: git(cwd, ['rev-parse', 'HEAD']),
      stash: git(cwd, ['stash', 'create']) || null, // ögonblicksbild av ändringar som fanns innan, rör inget
      untracked: lines(git(cwd, ['ls-files', '--others', '--exclude-standard'])),
    };
  } catch {
    return null;
  }
}

function changedFiles(cwd, cp) {
  const diff = lines(git(cwd, ['diff', '--name-only', cp.stash || cp.head]));
  const fresh = lines(git(cwd, ['ls-files', '--others', '--exclude-standard'])).filter(f => !cp.untracked.includes(f));
  return [...new Set([...diff, ...fresh])];
}

function emit(job) { bus.emit('job', publicJob(job)); }
function publicJob(j) { return { ...j, log: j.log.slice(-200) }; }

function startJob({ project, instruction, taskId = null, resume = null }) {
  if (!project || !project.path) throw new Error(`${project?.name || 'Projektet'} har ingen mapp på datorn än`);
  if (!fs.existsSync(project.path)) throw new Error(`Mappen finns inte: ${project.path}`);

  const job = {
    id: id(), project: project.id, instruction, taskId,
    status: 'kör', started: new Date().toISOString(), ended: null,
    checkpoint: null, log: [], result: null, cost: 0, changed: [], published: false, sessionId: null, resumedFrom: resume?.id || null,
  };
  job.checkpoint = checkpoint(project.path, job);
  db.jobs.unshift(job);
  db.jobs = db.jobs.slice(0, 100);
  save();

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', `"${ALLOWED_TOOLS}"`,
    ...(resume?.sessionId ? ['--resume', resume.sessionId] : []),
  ];
  const child = spawn('claude', args, { cwd: project.path, shell: true, windowsHide: true, env: { ...process.env, HEIMDALL_JOB: '1', PLAYWRIGHT_MCP_HEADLESS: 'true', PLAYWRIGHT_MCP_ISOLATED: 'true' } });
  running.set(job.id, child);

  const extra = project.rules ? `\n\nRegler för projektet:\n${project.rules}` : '';
  child.stdin.write(instruction + extra +
    '\n\nCommitta eller pusha aldrig — det gör användaren själv efter granskning.' +
    '\nWebbläsartest: använd Playwright headless. Saknas webbläsaren, kör `npx playwright install chromium` en gång och försök igen.' +
    '\nSvara kort på svenska när du är klar: vad du gjorde och vilka filer som ändrades.');
  child.stdin.end();

  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { handleEvent(job, JSON.parse(line)); } catch { job.log.push({ t: 'text', v: line }); }
    }
    emit(job);
  });
  child.stderr.on('data', d => { job.log.push({ t: 'fel', v: d.toString().slice(0, 500) }); emit(job); });

  child.on('close', code => {
    running.delete(job.id);
    job.ended = new Date().toISOString();
    if (job.status === 'kör') job.status = code === 0 ? 'klar' : 'misslyckades';
    const all = job.log.map(l => l.v).join(' ') + ' ' + (job.result || '');
    if (/oauth|failed to authenticate|not logged in|please run \/login|invalid api key/i.test(all)) {
      job.status = 'misslyckades';
      job.result = 'Claude Code är utloggad på datorn. Öppna PowerShell, skriv claude, sen /login och logga in. Kör jobbet igen efteråt.';
    } else if (/usage limit|rate limit|limit reached|5-hour limit|weekly limit/i.test(all)) {
      job.status = 'misslyckades';
      job.result = 'Claude-gränsen är nådd just nu. Jobbet kan köras igen när den nollställts.';
    }
    if (job.status === 'klar' && job.taskId) {
      const t = completeTask(job.taskId, 'auto (Claude-jobb)');
      if (t) job.log.push({ t: 'info', v: `Bockade av: ${t.title}` });
    }
    if (job.checkpoint) { try { job.changed = changedFiles(project.path, job.checkpoint); } catch {} }
    save();
    emit(job);
    bus.emit('done', publicJob(job));
  });
  child.on('error', err => {
    job.status = 'misslyckades';
    job.log.push({ t: 'fel', v: `Kunde inte starta claude: ${err.message}. Är Claude Code installerat?` });
    save(); emit(job);
  });

  emit(job);
  return publicJob(job);
}

function handleEvent(job, ev) {
  const usedModel = ev.type === 'assistant' ? ev.message?.model : ev.type === 'system' ? ev.model : null;
  if (usedModel && usedModel !== '<synthetic>') active.set('Claude', usedModel);
  if (ev.type === 'assistant' && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type === 'text' && c.text.trim()) job.log.push({ t: 'text', v: c.text });
      if (c.type === 'tool_use') {
        const target = c.input?.file_path || c.input?.command || c.input?.pattern || c.input?.query || '';
        job.log.push({ t: 'verktyg', v: `${c.name} ${String(target).slice(0, 120)}` });
      }
    }
  } else if (ev.type === 'system' && ev.session_id) {
    job.sessionId = ev.session_id;
  } else if (ev.type === 'result') {
    if (ev.session_id) job.sessionId = ev.session_id;
    job.result = ev.result || null;
    job.cost = ev.total_cost_usd || 0;
    if (ev.is_error || ev.subtype !== 'success') job.status = 'misslyckades';
  }
}

function stopJob(jobId) {
  const child = running.get(jobId);
  if (!child) return false;
  const job = db.jobs.find(j => j.id === jobId);
  if (job) job.status = 'stoppad';
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  } catch {}
  return true;
}

// Återställer projektet till exakt läget före jobbet — även ändringar du hade innan finns kvar.
function undoJob(jobId, projects) {
  const job = db.jobs.find(j => j.id === jobId);
  if (!job?.checkpoint) throw new Error('Jobbet har ingen checkpoint att ångra till');
  if (job.published) throw new Error('Jobbet är redan publicerat och kan inte ångras härifrån');
  const p = projects.find(x => x.id === job.project);
  const cp = job.checkpoint;
  const nowUntracked = lines(git(p.path, ['ls-files', '--others', '--exclude-standard']));
  git(p.path, ['reset', '--hard', cp.head]);
  if (cp.stash) git(p.path, ['stash', 'apply', cp.stash]);
  for (const f of nowUntracked) {
    if (!cp.untracked.includes(f)) fs.rmSync(path.join(p.path, f), { force: true });
  }
  job.status = 'ångrad';
  save(); emit(job);
  return publicJob(job);
}

// "Publicera" = committa just jobbets filer (namngivna, aldrig add -A), hämta senaste, pusha.
function publish(project, job) {
  if (!isRepo(project.path)) throw new Error('Projektet är inte ett git-repo');
  if (!job) throw new Error('Inget klart jobb att publicera');
  if (job.published) throw new Error('Redan publicerat');
  const files = (job.changed || []);
  if (!files.length) throw new Error('Jobbet ändrade inga filer');
  const why = e => String(e.stderr || e.message || e).trim().split('\n').slice(0, 3).join(' ');
  // Ett tidigare försök kan ha hunnit committa men inte pusha — då finns inget nytt att committa, gå vidare till push
  try {
    git(project.path, ['add', '--', ...files]);
    let staged = true;
    try { git(project.path, ['diff', '--cached', '--quiet', '--', ...files]); staged = false; } catch {}
    if (staged) git(project.path, ['commit', '-m', `HEIMDALL: ${job.instruction.slice(0, 60)}`, '--', ...files]);
  } catch (e) { throw new Error(`Kunde inte committa: ${why(e)}`); }
  const upstream = (() => { try { return git(project.path, ['rev-parse', '--abbrev-ref', '@{u}']); } catch { return null; } })();
  try { git(project.path, upstream ? ['pull', '--rebase', '--autostash'] : ['pull', '--rebase', '--autostash', 'origin', 'main']); }
  catch (e) {
    // Lämna inte repot fast i halvfärdig rebase — det blockerar alla framtida publiceringar
    try { git(project.path, ['rebase', '--abort']); } catch {}
    throw new Error(`Krock med GitHub när senaste hämtades (${why(e)}) — öppna Claude Code i projektet och lös det`);
  }
  let out;
  try { out = git(project.path, upstream ? ['push'] : ['push', 'origin', 'HEAD:main']); }
  catch (e) { throw new Error(`Kunde inte pusha till GitHub: ${why(e)}`); }
  job.published = true;
  save(); emit(job);
  return { files, out };
}

function weekCost() {
  const weekAgo = Date.now() - 7 * 86400000;
  return db.jobs.filter(j => new Date(j.started).getTime() > weekAgo).reduce((s, j) => s + (j.cost || 0), 0);
}

module.exports = { bus, startJob, stopJob, undoJob, publish, weekCost, publicJob };
