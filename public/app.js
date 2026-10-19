// HEIMDALL — appen
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;            // serverstate
let token = '';
let tts = true;
let selectedDay = null;
try { token = localStorage.getItem('h_token') || ''; tts = localStorage.getItem('h_tts') !== '0'; } catch {}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Heimdall-Token': token },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLock('Fel kod'); throw new Error('Fel kod'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Fel ${res.status}`);
  return json;
}

async function refresh() {
  S = await api('/api/state');
  render();
  renderModel();
}

// ---------- Lås ----------
function showLock(msg = '') {
  $('#lock').classList.remove('hidden');
  $('#lockErr').textContent = msg;
  setTimeout(() => $('#lockInput').focus(), 50);
}
$('#lockBtn').onclick = async () => {
  token = $('#lockInput').value.trim();
  try { localStorage.setItem('h_token', token); } catch {}
  try { await refresh(); $('#lock').classList.add('hidden'); connect(); } catch (e) { $('#lockErr').textContent = e.message; }
};
$('#lockInput').onkeydown = e => { if (e.key === 'Enter') $('#lockBtn').click(); };

// ---------- Live ----------
let es = null;
function connect() {
  if (es) es.close();
  es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  es.addEventListener('hello', () => { $('#link').classList.add('on'); refresh().catch(() => {}); });
  es.addEventListener('state', () => refresh().catch(() => {}));
  es.addEventListener('model', e => {
    if (S) S.activeModel = JSON.parse(e.data);
    renderModel(true);
  });
  es.addEventListener('job', e => {
    if (!S) return;
    const j = JSON.parse(e.data);
    const i = S.jobs.findIndex(x => x.id === j.id);
    if (i >= 0) S.jobs[i] = j; else S.jobs.unshift(j);
    renderJobs(); renderBadge();
  });
  es.addEventListener('notify', e => {
    const n = JSON.parse(e.data);
    toast(n.title, n.body);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then(r => r.showNotification(n.title, { body: n.body, icon: '/icon-192.png' }))
        .catch(() => new Notification(n.title, { body: n.body }));
    }
  });
  es.addEventListener('agent', e => {
    const j = JSON.parse(e.data);
    if (j.status === 'kör') setEye('thinking', `DATORN · STEG ${j.steps}`);
    else if (!L) setEye('idle', 'VAKTAR');
  });
  es.addEventListener('shortcut', e => {
    const s = JSON.parse(e.data);
    if (/iPhone|iPad/.test(navigator.userAgent)) location.href = s.url;
    else toast('Genväg', `"${s.name}" körs på telefonen`);
  });
  es.onerror = () => { $('#link').classList.remove('on'); };
}

// ---------- Hjälpare ----------
const proj = id => S?.projects.find(p => p.id === id)
  || (String(id).startsWith('ny:') ? { name: 'Nytt: ' + String(id).slice(3), color: '#e8fbff', local: true }
  : String(id).startsWith('video:') ? { name: 'Video: ' + String(id).slice(6), color: '#ffc24d', local: true } : { name: id, color: '#8aa0b4' });
const shiftOf = date => S?.shifts.find(s => s.date === date);
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' });
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
const mins = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;

function toast(title, body = '', bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ---------- Render ----------
function render() {
  if (!S) return;
  renderTop(); renderToday(); renderWeek(); renderDays(); renderProjects(); renderMonitors(); renderMails(); renderGoals(); renderMoney(); renderFocus(); renderPot(); renderN8n(); renderActivity(); renderMoneyChart(); renderAgents(); renderVideo(); renderJobs(); renderAgentRuns(); renderBadge();
  if (!chatRendered) { renderChat(); chatRendered = true; }
}

function renderTop() {
  const s = shiftOf(S.today);
  const el = $('#shiftNow');
  el.closest('.hud-item').classList.toggle('hidden', !S.hasShifts);
  el.textContent = s ? (s.name || s.code) : '—';
  el.className = 'hud-v s-' + (s?.code || '?');
  const b = S.settings.claudeBudgetLeft ?? 100;
  $('#budgetBar').style.width = b + '%';
  $('#budgetBar').style.background = b < 25 ? 'var(--hot)' : b < 50 ? 'var(--warn)' : 'var(--accent)';
  $('#budgetTxt').textContent = b + '%';
  $('#ttsBtn').classList.toggle('off', !tts);
  const pc = S.pc || {};
  $('#pcBox').classList.toggle('hidden', pc.mode !== 'cloud');
  $('#pcTxt').textContent = pc.online ? 'PÅ' : 'AV';
  $('#pcTxt').className = 'hud-v ' + (pc.online ? 's-L' : 'dim');
}
const pcOffWarn = what => (S.pc?.mode === 'cloud' && !S.pc.online)
  ? `<div class="warn"><b>Datorn är av.</b> ${what} funkar när datorn är på och HEIMDALL är igång på den.</div>` : '';

// ---------- Skifttider ----------
const at = (date, hm) => new Date(`${date}T${hm}:00`);
// Skiftets start/slut som riktiga tider (nattskift slutar dagen efter)
function shiftSpan(s) {
  if (!s?.start || !s?.end) return null;
  const start = at(s.date, s.start); let end = at(s.date, s.end);
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { start, end };
}
const hm = d => d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
const until = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`; };
function shiftNow() {
  const now = new Date();
  for (const s of S.shifts) {
    const sp = shiftSpan(s); if (!sp) continue;
    if (now >= sp.start && now < sp.end) return { s, sp, live: true };
    if (sp.start > now) return { s, sp, live: false };
  }
  return null;
}

const weekNo = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7); };

// ---------- Kärna: statuskort + snabbknappar ----------
const sortTasks = (a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99') || a.priority - b.priority;
function renderToday() {
  const now = new Date();
  const sn = shiftNow();
  let shiftCard;
  if (!S.hasShifts) shiftCard = `<div class="dk-v">${esc(new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><div class="dk-s">vecka ${weekNo(new Date())}</div>`;
  else if (!sn) shiftCard = `<div class="dk-v">Inga skift</div><div class="dk-s">Ledig framöver</div>`;
  else if (sn.live) {
    const pct = Math.round((now - sn.sp.start) / (sn.sp.end - sn.sp.start) * 100);
    shiftCard = `<div class="dk-v s-${esc(sn.s.code)}">${esc(sn.s.name)} pågår</div><div class="dk-s">slutar ${hm(sn.sp.end)} · ${until(sn.sp.end - now)} kvar</div><div class="dk-bar"><i style="width:${pct}%"></i></div>`;
  } else {
    const day = sn.s.date === S.today ? 'idag' : sn.s.date === addDays(S.today, 1) ? 'imorgon' : esc(sn.s.weekday);
    shiftCard = `<div class="dk-v s-${esc(sn.s.code)}">${esc(sn.s.name)} ${day} ${esc(sn.s.start)}</div><div class="dk-s">börjar om ${until(sn.sp.start - now)}</div>`;
  }
  const todays = S.tasks.filter(t => t.date === S.today || (!t.done && t.date < S.today)).sort(sortTasks);
  const doneN = todays.filter(t => t.done).length;
  const next = todays.find(t => !t.done);
  const taskCard = next
    ? `<div class="dk-next"><button class="chk" data-toggle="${next.id}" aria-label="Klar"></button><span><span class="dk-v">${esc(next.title)}</span><span class="dk-s">${next.time ? '⏰ ' + esc(next.time) + ' · ' : ''}${esc(proj(next.project).name)}</span></span></div>`
    : `<div class="dk-v">${todays.length ? 'Allt klart ✓' : 'Inget inlagt'}</div><div class="dk-s">${todays.length ? 'Snyggt jobbat' : 'Säg vad du vill göra'}</div>`;
  const pc = S.pc || {};
  const actionJobs = (S.jobs || []).filter(j => jobGroup(j) === 'åtgärd').length;
  const runningAg = (S.agents || []).filter(a => a.running).length;
  const down = (S.monitors || []).filter(m => !m.up).length;
  const rows = [
    ['DATOR', pc.online ? 'PÅ' : 'AV', pc.online ? 'ok' : 'off'],
    ['JOBB', actionJobs ? `${actionJobs} väntar` : 'lugnt', actionJobs ? 'hot' : 'ok'],
    ['AGENTER', runningAg ? `${runningAg} jobbar` : 'vilar', runningAg ? 'live' : 'ok'],
    ['SAJTER', down ? `${down} nere` : 'uppe', down ? 'hot' : 'ok'],
  ];
  const html = `
    <div class="dk" data-go="plan"><div class="dk-l">${S.hasShifts ? 'SKIFT' : 'DATUM'}</div>${shiftCard}</div>
    <div class="dk" data-go="plan"><div class="dk-l">IDAG <b>${doneN}/${todays.length}</b></div>${taskCard}<div class="dk-bar"><i style="width:${todays.length ? Math.round(doneN / todays.length * 100) : 0}%"></i></div></div>
    <div class="dk sys" data-go="jobs"><div class="dk-l">SYSTEM</div>${rows.map(([l, v, c]) => `<div class="sy"><span>${l}</span><b class="c-${c}">${v}</b></div>`).join('')}</div>`;
  paint($('#deck'), html, html);
  // Mobil: en rad med det viktigaste — tryck för att fälla ut korten
  const shiftShort = !S.hasShifts && S.hasShifts !== undefined ? '' : !sn ? '' : sn.live ? `${sn.s.name} · ${until(sn.sp.end - now)} kvar` : `${sn.s.name} ${sn.s.date === S.today ? 'idag' : sn.s.date === addDays(S.today, 1) ? 'imorgon' : sn.s.weekday} ${sn.s.start}`;
  const goal = S.settings.incomeGoal;
  const mini = `${shiftShort ? `<span class="dm-s s-${esc(sn.s.code)}">${esc(shiftShort)}</span>` : ''}
    <span class="dm-t">${next ? `☐ ${esc(next.title)}${next.time ? ' ' + esc(next.time) : ''}` : todays.length ? 'Allt klart ✓' : 'Inget idag'}</span>
    <span class="dm-n mono">${doneN}/${todays.length}${goal ? ` · ${Math.round(monthIncome() / 1000 * 10) / 10}k/${Math.round(goal / 1000)}k` : ''}</span><i class="dm-chev"></i>`;
  paint($('#dashMini'), mini, mini);
  renderIncomeGoal();
  renderQuick();
}

// Mobil: översikten ihopfälld som standard, chatten får plats
const coreEl = $('.core');
let dashOpen = false; try { dashOpen = localStorage.getItem('h_dash') === '1'; } catch {}
coreEl.classList.toggle('dash-open', dashOpen);
$('#dashMini').onclick = () => { dashOpen = !dashOpen; coreEl.classList.toggle('dash-open', dashOpen); try { localStorage.setItem('h_dash', dashOpen ? '1' : '0'); } catch {} };
// Skrivläge: när du skriver på mobilen visas bara chatten
const isPhone = () => matchMedia('(max-width: 700px)').matches;
$('#sayInput').addEventListener('focus', () => { if (isPhone()) { coreEl.classList.add('composing'); toBottom(); } });
$('#sayInput').addEventListener('blur', () => setTimeout(() => coreEl.classList.remove('composing'), 150));
// Tangentbordet på iPhone: krymp appen så inmatningen syns och menyn göms
if (window.visualViewport) {
  const fit = () => {
    const kb = Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kb', kb > 80);
    if (kb > 80) toBottom();
  };
  visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit);
}

// Nedräkningen till skiftet hålls färsk
setInterval(() => { if (S) renderToday(); }, 30000);

const QUICK = [['Min dag', 'Vad har jag för dag idag?'], ['Planera veckan', 'Planera min vecka'], ['Mejlen', 'Kolla mejlen'], ['Pengapotten', 'Hur går det med pengapotten?']];
function monthIncome() {
  const m = S.today.slice(0, 7);
  return (S.income || []).filter(e => e.date.startsWith(m)).reduce((a, e) => a + e.amount, 0);
}
function renderIncomeGoal() {
  const goal = S.settings.incomeGoal || 0;
  let html;
  if (!goal) html = `<span class="ig-l">MÅNADSMÅL</span><span class="ig-set">Sätt hur mycket extra du vill tjäna per månad →</span>`;
  else {
    const got = (S.incomeReport?.perMånad?.[S.today.slice(0, 7)] ? Object.values(S.incomeReport.perMånad[S.today.slice(0, 7)]).reduce((a, b) => a + b, 0) : monthIncome());
    const pct = Math.max(0, Math.min(100, Math.round(got / goal * 100)));
    const d = new Date(S.today + 'T12:00'); const left = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate();
    html = `<span class="ig-l">MÅNADSMÅL</span><span class="ig-v"><b class="${got >= goal ? 'pos' : ''}">${kr(got)}</b> / ${kr(goal)}</span>
      <span class="ig-bar"><i style="width:${pct}%"></i></span><span class="ig-p mono">${pct}% · ${left} dagar kvar</span>`;
  }
  paint($('#incGoal'), html, html);
}
function renderQuick() {
  const own = (S.settings.macros || []).map(m => [m.name, m.name]);
  const list = [...own, ...(S.settings.quick || QUICK)];
  const html = list.map(([l, cmd], i) => `<button class="qb ${i < (S.settings.macros || []).length ? 'own' : ''}" data-say="${esc(cmd)}">${esc(l)}</button>`).join('');
  paint($('#quick'), html, html);
}

function renderWeek() {
  const days = S.shifts.slice(1, 15);
  const html = days.map(d => {
    const ts = S.tasks.filter(t => t.date === d.date && !t.done);
    const load = ts.reduce((s, t) => s + (t.estimate_min || 0), 0);
    const dots = ts.slice(0, 4).map(t => `<i style="background:${proj(t.project).color}"></i>`).join('');
    return `<div class="wd ${d.date === S.today ? 'today' : ''} ${d.date === selectedDay ? 'sel' : ''} ${d.code === 'L' ? 'free' : ''}" data-jump="${d.date}">
      <div class="wn">${esc(d.weekday)}</div><div class="dn">${+d.date.slice(8)}</div>
      <div class="sc s-${esc(d.code)}">${S.hasShifts ? esc(d.code === '?' ? '·' : d.code === 'L' ? 'LEDIG' : d.start || d.code) : ''}</div>
      <div class="wdots">${dots}${ts.length > 4 ? '<b>+</b>' : ''}</div>
      <span class="load" style="width:${Math.min(100, load / 2.4)}%"></span></div>`;
  }).join('');
  paint($('#week'), html, html);
  $('.lg-shift')?.parentElement.classList.toggle('hidden', !S.hasShifts);
}

// 24-timmarsstapel för en dag: skiftet (även natten innan som går in i dagen) + tasks med tid + nu-markör
function dayBar(date) {
  const dayStart = at(date, '00:00'), dayEnd = new Date(dayStart.getTime() + 86400000);
  const pct = d => Math.max(0, Math.min(100, (d - dayStart) / 864000));
  const segs = [];
  for (const s of [shiftOf(addDays(date, -1)), shiftOf(date)]) {
    const sp = shiftSpan(s); if (!sp || sp.end <= dayStart || sp.start >= dayEnd) continue;
    const a = Math.max(sp.start, dayStart), b = Math.min(sp.end, dayEnd);
    segs.push(`<i class="seg s-${esc(s.code)}" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%" title="${esc(s.name)} ${esc(s.start)}–${esc(s.end)}"></i>`);
  }
  const ticks = S.tasks.filter(t => t.date === date && t.time && !t.done)
    .map(t => `<b class="tk" style="left:${pct(at(date, t.time))}%;background:${proj(t.project).color}" title="${esc(t.time)} ${esc(t.title)}"></b>`).join('');
  const now = date === S.today ? `<em class="nowm" style="left:${pct(new Date())}%"></em>` : '';
  return `<div class="dbar">${segs.join('')}${ticks}${now}<span style="left:0">00</span><span style="left:25%">06</span><span style="left:50%">12</span><span style="left:75%">18</span></div>`;
}

function taskRow(t) {
  const p = proj(t.project);
  return `<div class="task ${t.done ? 'done' : ''}">
    <button class="chk" data-toggle="${t.id}" aria-label="Klar"></button>
    <div class="tt"><div>${esc(t.title)}</div>
      <div class="tm"><span class="tag"><i style="background:${p.color}"></i>${esc(p.name)}</span>
      ${t.time ? `<span class="when">⏰ ${esc(t.time)}</span>` : ''}<span>${mins(t.estimate_min || 0)}</span>${t.priority === 1 ? '<span class="p1">HÖG</span>' : ''}${t.claude_heavy ? '<span>◆ Claude</span>' : ''}${t.doneHow && t.done ? `<span>${esc(t.doneHow)}</span>` : ''}</div></div>
    <button class="more" data-edit="${t.id}" aria-label="Ändra">⋯</button></div>`;
}

function renderDays() {
  const out = [];
  const overdue = S.tasks.filter(t => !t.done && t.date < S.today);
  if (overdue.length) out.push(`<div class="day overdue"><div class="day-h"><b>FÖRSENAT</b><span class="meta">${overdue.length} st</span></div>${overdue.map(taskRow).join('')}</div>`);
  for (let i = 0; i < 14; i++) {
    const d = addDays(S.today, i);
    const s = shiftOf(d);
    const ts = S.tasks.filter(t => t.date === d).sort(sortTasks);
    const load = ts.filter(t => !t.done).reduce((a, t) => a + (t.estimate_min || 0), 0);
    out.push(`<div class="day ${d === selectedDay ? 'sel' : ''}" id="d-${d}">
      <div class="day-h"><b>${i === 0 ? 'IDAG' : i === 1 ? 'IMORGON' : esc(fmtDay(d).toUpperCase())}</b>
      <span class="meta">${load ? mins(load) : ''}${S.hasShifts ? `<span class="shift-pill s-${esc(s?.code || '?')}" data-shift="${d}">${esc(s ? (s.name || s.code) : '?')}${s?.start ? ' ' + esc(s.start) + '–' + esc(s.end) : ''}</span>` : ''}</span></div>
      ${dayBar(d)}
      ${ts.length ? ts.map(taskRow).join('') : `<div class="empty-day">Tomt</div>`}</div>`);
  }
  $('#days').innerHTML = out.join('');
}

function renderProjects() {
  $('#projects').innerHTML = S.projects.map(p => {
    const all = S.tasks.filter(t => t.project === p.id);
    const done = all.filter(t => t.done).length;
    const open = all.length - done;
    const last = S.jobs.find(j => j.project === p.id);
    const pct = all.length ? Math.round(done / all.length * 100) : 0;
    return `<div class="proj" style="--c:${p.color}">
      <h4>${esc(p.name)}</h4><p>${esc(p.description || '')}</p>
      <div class="stats"><div><b>${open}</b>öppna</div><div><b>${done}</b>klara</div><div><b>${last ? esc(last.status) : '—'}</b>senaste jobb</div></div>
      <div class="prog"><i style="width:${pct}%"></i></div>
      <div class="row"><button class="btn small" data-newjob="${p.id}">Nytt jobb</button>
      <button class="btn small" data-addtask="${p.id}">+ Task</button></div></div>`;
  }).join('');
  $('#ideas').innerHTML = S.ideas.length
    ? S.ideas.slice().reverse().map(i => `<div class="idea">${esc(i.text)}<small>${i.project ? esc(proj(i.project).name) + ' · ' : ''}${new Date(i.created).toLocaleDateString('sv-SE')}</small></div>`).join('')
    : `<div class="idea dim">Säg "spara idé: …" så hamnar den här.</div>`;
}

function renderGoals() {
  const gs = (S.goals || []).slice().sort((a, b) => a.done - b.done || (a.deadline || '9').localeCompare(b.deadline || '9'));
  $('#goals').innerHTML = gs.length ? gs.map(g => {
    const p = g.project ? proj(g.project) : null;
    const days = g.deadline ? Math.ceil((new Date(g.deadline + 'T23:59') - new Date()) / 86400000) : null;
    const pct = g.target ? Math.min(100, Math.round((g.current || 0) / g.target * 100)) : (g.done ? 100 : 0);
    return `<div class="goal ${g.done ? 'done' : ''}" style="--c:${p?.color || 'var(--accent)'}">
      <div class="gt"><span>${g.done ? '✓ ' : ''}${esc(g.title)}</span>${g.target != null ? `<span class="mono">${g.current || 0}/${g.target} ${esc(g.unit)}</span>` : ''}</div>
      <div class="gm">${p ? esc(p.name) + ' · ' : ''}${g.deadline ? (days < 0 ? `<span class="late">${-days} dagar sen</span>` : `${days} dagar kvar · ${esc(g.deadline)}`) : 'ingen deadline'}</div>
      <div class="prog"><i style="width:${pct}%;background:var(--c);box-shadow:0 0 8px var(--c)"></i></div></div>`;
  }).join('') : '<div class="idea dim">Inga mål än. Säg t.ex. "mitt mål är 3 betalande kunder innan jul".</div>';
}

function renderMoney() {
  const r = S.incomeReport || { totalt: {}, perMånad: {}, summa: 0 };
  const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const thisMonth = Object.values(r.perMånad[month] || {}).reduce((a, b) => a + b, 0);
  const kr = n => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('sv-SE')} kr`;
  const tiles = [
    ['Denna månad', thisMonth], ['Totalt', r.summa],
    ...Object.entries(r.totalt).map(([pid, v]) => [proj(pid).name, v]),
  ];
  $('#money').innerHTML = (S.income || []).length
    ? `<div class="money-grid">${tiles.map(([l, v]) => `<div class="mtile"><div class="ml">${esc(l)}</div><div class="mv ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${kr(v)}</div></div>`).join('')}</div>`
    : '<div class="idea dim">Inget loggat än. Säg t.ex. "fick 2000 kr för ett uppdrag".</div>';
}

let focusTimer = 0;
function renderFocus() {
  const f = S.focus;
  $('#focus').classList.toggle('hidden', !f);
  clearInterval(focusTimer);
  if (!f) return;
  $('#focusTask').textContent = f.task || 'Fokus';
  const total = (f.minutes || 50) * 60000;
  const tick = () => {
    const left = Math.max(0, f.until - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    $('#focusTime').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    $('#focusArc').style.strokeDashoffset = 565.5 * (1 - left / total);
    if (!left) { clearInterval(focusTimer); refresh().catch(() => {}); }
  };
  tick(); focusTimer = setInterval(tick, 1000);
}
$('#focusStop').onclick = async () => { await api('/api/focus', { method: 'POST', body: { stop: true } }).catch(() => {}); refresh(); };

function renderMails() {
  const st = (S.mailStatus || []).map(m => m.ok === false ? `<div class="idea" style="border-color:var(--hot)">${esc(m.name)}: ${esc(m.error)}</div>` : '').join('');
  $('#mails').innerHTML = st + ((S.mails || []).length
    ? S.mails.map(m => `<div class="idea" style="border-color:${m.isReply ? 'var(--ok)' : 'var(--accent)'}"><b>${esc(m.from)}</b> · ${esc(m.summary)}<small>${esc(m.account)} · ${esc(m.subject)} · ${new Date(m.date).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</small></div>`).join('')
    : `<div class="idea dim">${(S.mailStatus || []).length ? 'Inga nya mejl sen HEIMDALL började kolla.' : 'Ingen inkorg kopplad än.'}</div>`);
}

function renderMonitors() {
  $('#monitors').innerHTML = (S.monitors || []).map(m => `<div class="mon ${m.up ? '' : 'down'}" title="${esc(m.checked ? 'Kollad ' + new Date(m.checked).toLocaleTimeString('sv-SE') : 'Inte kollad än')}"><i></i>${esc(m.name)} ${m.up ? 'UPPE' : 'NERE'}</div>`).join('');
}

// Jobbvy: filter (status + projekt) sparas i webbläsaren
const JF = { st: localStorage.getItem('jobSt') || 'alla', pr: localStorage.getItem('jobPr') || 'alla' };
const needsAction = j => !j.dismissed && (['misslyckades', 'stoppad'].includes(j.status) || (j.status === 'klar' && j.changed?.length && !j.published));
const jobGroup = j => j.status === 'kör' ? 'aktiva' : needsAction(j) ? 'åtgärd' : 'klara';
const GROUPS = [['åtgärd', 'Kräver åtgärd'], ['aktiva', 'Pågår'], ['klara', 'Klara']];

// Ett "samtal" = första jobbet + alla svar du skickat efteråt (resumedFrom-kedjan)
const openThreads = new Set((() => { try { return JSON.parse(localStorage.getItem('openThreads') || '[]'); } catch { return []; } })());
const saveOpen = () => { try { localStorage.setItem('openThreads', JSON.stringify([...openThreads].slice(-30))); } catch {} };
function threadsOf(jobs) {
  const byId = Object.fromEntries(jobs.map(j => [j.id, j]));
  const rootOf = j => { const seen = new Set(); while (j.resumedFrom && byId[j.resumedFrom] && !seen.has(j.id)) { seen.add(j.id); j = byId[j.resumedFrom]; } return j; };
  const map = new Map();
  for (const j of jobs) { const r = rootOf(j); if (!map.has(r.id)) map.set(r.id, []); map.get(r.id).push(j); }
  return [...map.values()].map(list => {
    list.sort((a, b) => a.started.localeCompare(b.started));
    const last = list.at(-1);
    const group = list.some(needsAction) ? 'åtgärd' : last.status === 'kör' ? 'aktiva' : 'klara';
    return { id: list[0].id, root: list[0], jobs: list, last, group, project: list[0].project };
  }).sort((a, b) => b.last.started.localeCompare(a.last.started));
}

function turnHtml(j, isLast) {
  const failed = ['misslyckades', 'stoppad'].includes(j.status);
  const canUndo = j.checkpoint && !j.published && ['klar', 'misslyckades', 'stoppad'].includes(j.status);
  const log = j.log.map(l => `<div class="l-${esc(l.t)}">${l.t === 'verktyg' ? '› ' : ''}${esc(String(l.v).slice(0, 400))}</div>`).join('') || '<div>Startar…</div>';
  const steps = j.log.filter(l => l.t === 'verktyg').length;
  const live = j.status === 'kör';
  const btns = [
    live ? `<button class="btn small danger" data-stop="${j.id}">Stoppa</button>` : '',
    canUndo ? `<button class="btn small" data-undo="${j.id}">Ångra</button>` : '',
    failed && !j.dismissed ? `<button class="btn small" data-dismiss="${j.id}">Avfärda</button>` : '',
    j.published ? '<span class="act">PUBLICERAD</span>' : '',
    j.changed?.length ? `<span class="mono files" title="${esc(j.changed.join('\n'))}">${j.changed.length} filer</span>` : '',
  ].join('');
  return `<div class="turn">
    <div class="tmsg you"><span class="who mono">DU · ${new Date(j.started).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span><span class="tx">${esc(j.instruction.trim())}</span></div>
    ${live ? `<div class="tmsg claude working"><span class="who mono">CLAUDE · JOBBAR <span class="typing"><i></i><i></i><i></i></span></span><div class="job-log" data-log>${log}</div></div>`
      : `<div class="tmsg claude ${failed ? 'bad' : ''}"><span class="who mono">CLAUDE · ${esc(j.status.toUpperCase())}</span><span class="tx">${j.result ? md(j.result.trim()) : failed ? 'Jobbet ' + (j.status === 'stoppad' ? 'stoppades' : 'misslyckades') + '.' : '—'}</span><details class="job-d"><summary>Vad Claude gjorde (${steps} steg)</summary><div class="job-log" data-log>${log}</div></details></div>`}
    ${btns.trim() ? `<div class="turn-f">${btns}</div>` : ''}
  </div>`;
}

function threadCard(th) {
  const p = proj(th.project);
  const unpub = p.local ? [] : th.jobs.filter(j => j.status === 'klar' && j.changed?.length && !j.published && !j.dismissed);
  const open = th.group !== 'klara' || openThreads.has(th.id);
  const canReply = th.last.sessionId && th.last.status !== 'kör';
  const title = th.root.instruction.replace(/\s+/g, ' ');
  const preview = th.last.status === 'kör' ? 'Claude jobbar…' : (th.last.result || th.last.status).replace(/\s+/g, ' ');
  return `<details class="job thread ${th.group === 'åtgärd' ? 'alert' : ''} ${th.group === 'aktiva' ? 'live' : ''}" data-thread="${th.id}" ${open ? 'open' : ''}>
    <summary class="th-h">
      <span class="th-dot" style="background:${p.color};box-shadow:0 0 8px ${p.color}"></span>
      <span class="th-main"><span class="th-t">${esc(title.slice(0, 90))}${title.length > 90 ? '…' : ''}</span>
        <span class="th-s mono">${esc(p.name)} · ${th.jobs.length > 1 ? th.jobs.length + ' meddelanden · ' : ''}${new Date(th.last.started).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</span>
        <span class="th-p">${esc(preview.slice(0, 110))}</span></span>
      <span class="st st-${esc(th.last.status)}">${esc(th.last.status)}</span>
    </summary>
    ${unpub.length ? `<div class="th-pub"><span>${unpub.length === 1 ? 'Klar men inte publicerad' : unpub.length + ' svar med ändringar som inte är publicerade'}</span>
      <button class="btn small primary" data-pubthread="${unpub.map(j => j.id).join(',')}">Publicera</button>
      <button class="btn small" data-dismiss="${unpub.map(j => j.id).join(',')}">Avfärda</button></div>` : ''}
    <div class="th-body">${th.jobs.map((j, i) => turnHtml(j, i === th.jobs.length - 1)).join('')}</div>
    ${canReply ? `<div class="th-reply"><textarea class="draft" id="re-${th.last.id}" rows="1" placeholder="Svara Claude…"></textarea>
      <button class="btn primary" data-reply="${th.last.id}" aria-label="Skicka">➤</button></div>` : ''}
  </details>`;
}

function renderJobs(force) {
  $('#weekCost').textContent = S.weekCost ? `7 dagar ≈ $${S.weekCost.toFixed(2)} i API-värde` : '';
  // Stör inte medan du skriver eller har osänt svar — då missas klick på Skicka
  const typing = [...document.querySelectorAll('#jobs textarea')].some(t => t.value.trim() || t === document.activeElement);
  if (typing && force !== true) { clearTimeout(renderJobs.t); renderJobs.t = setTimeout(renderJobs, 3000); return; }
  const keepRe = {}; document.querySelectorAll('#jobs textarea[id]').forEach(t => keepRe[t.id] = t.value);
  const jobs = S.jobs || [];
  $('#pcWarnJobs').innerHTML = pcOffWarn('Claude-jobb och datorstyrning');
  const all = threadsOf(jobs);
  const pids = [...new Set(all.map(t => t.project))];
  if (JF.pr !== 'alla' && !pids.includes(JF.pr)) JF.pr = 'alla';
  const inProj = all.filter(t => JF.pr === 'alla' || t.project === JF.pr);
  const cnt = { åtgärd: 0, aktiva: 0, klara: 0 };
  inProj.forEach(t => cnt[t.group]++);
  const shown = inProj.filter(t => JF.st === 'alla' || t.group === JF.st);
  const pcount = pid => all.filter(t => t.project === pid && t.group === 'åtgärd').length;

  const stTabs = [['alla', 'Alla', inProj.length], ...GROUPS.map(([k, l]) => [k, l, cnt[k]])]
    .map(([k, l, n]) => `<button class="ftab ${JF.st === k ? 'on' : ''} ${k === 'åtgärd' && n ? 'hot' : ''}" data-jf="${k}">${l}<b>${n}</b></button>`).join('');
  const prTabs = [`<button class="ftab ${JF.pr === 'alla' ? 'on' : ''}" data-jp="alla">Alla projekt</button>`,
    ...pids.map(pid => { const n = pcount(pid); return `<button class="ftab ${JF.pr === pid ? 'on' : ''} ${n ? 'hot' : ''}" data-jp="${esc(pid)}" style="--c:${proj(pid).color}"><i class="dot"></i>${esc(proj(pid).name)}${n ? `<b>${n}</b>` : ''}</button>`; })].join('');
  const nFailed = jobs.filter(j => !j.dismissed && ['misslyckades', 'stoppad'].includes(j.status)).length;
  const dismissAll = nFailed ? `<button class="ftab" data-dismiss="all">Avfärda alla misslyckade (${nFailed})</button>` : '';

  let body;
  if (!jobs.length) body = `<div class="idea dim">Inga jobb än. Tryck <b>+ Nytt jobb</b> eller säg t.ex. "fixa footern på min hemsida".</div>`;
  else if (!shown.length) body = `<div class="idea dim">Inga jobb här.</div>`;
  else if (JF.st === 'alla') body = GROUPS.map(([k, l]) => {
    const list = shown.filter(t => t.group === k);
    return list.length ? `<div class="jgroup g-${k === 'åtgärd' ? 'hot' : k}"><h3>${l} <b>${list.length}</b></h3>${list.map(threadCard).join('')}</div>` : '';
  }).join('');
  else body = `<div class="jgroup">${shown.map(threadCard).join('')}</div>`;

  $('#jobs').innerHTML = `<div class="jfilters">${stTabs}${dismissAll}</div><div class="jfilters sub">${prTabs}</div>${body}`;
  for (const [k, v] of Object.entries(keepRe)) { const t = document.getElementById(k); if (t) t.value = v; }
  $$('#jobs [data-log]').forEach(el => el.scrollTop = el.scrollHeight);
  $$('#jobs .th-body').forEach(el => el.scrollTop = el.scrollHeight); // senaste meddelandet syns direkt
}
// Kom ihåg vilka samtal du öppnat
$('#jobs').addEventListener('toggle', e => {
  const d = e.target.closest?.('[data-thread]'); if (!d || e.target !== d) return;
  if (d.open) openThreads.add(d.dataset.thread); else openThreads.delete(d.dataset.thread);
  saveOpen();
}, true);
// Textrutan växer när du skriver, Enter skickar (Shift+Enter = ny rad)
$('#jobs').addEventListener('input', e => { if (e.target.matches('.th-reply textarea')) { e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; } });
$('#jobs').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.th-reply textarea') && !/Android|iPhone|iPad/.test(navigator.userAgent)) {
    e.preventDefault(); document.querySelector(`[data-reply="${e.target.id.slice(3)}"]`)?.click();
  }
});
$('#jobs').addEventListener('click', e => {
  const f = e.target.closest('[data-jf]'), p = e.target.closest('[data-jp]');
  if (!f && !p) return;
  if (f) { JF.st = f.dataset.jf; localStorage.setItem('jobSt', JF.st); }
  if (p) { JF.pr = p.dataset.jp; localStorage.setItem('jobPr', JF.pr); }
  renderJobs(true);
});

function agentDetail(ag, rep) {
  if (!rep) return '';
  if (rep.failed) return `<div class="job-r l-fel">${esc(rep.body)}</div>`;
  if (rep.draft) return `<div class="job-r"><div class="dim" style="font-size:12.5px;margin:0 0 8px">${esc(rep.body)}</div>
      <textarea class="draft" id="d-${rep.id}">${esc(rep.draft)}</textarea>
      <div class="job-f" style="padding:8px 0 0;border:0"><button class="btn small" data-copy="${rep.id}">Kopiera</button>
      <a class="btn small" href="mailto:${esc(rep.to)}?subject=${encodeURIComponent(rep.subject || '')}&body=${encodeURIComponent(rep.draft || '')}">Öppna i mejl</a></div></div>`;
  if (rep.ideas?.length) return rep.ideas.map(i => `<div class="idea-l"><b>${esc(i.title)}</b><small>${esc(i.why)}</small>${i.items?.length ? `<small>${i.items.map(esc).join(' · ')}</small>` : ''}</div>`).join('');
  return rep.body ? `<div class="job-r">${esc(rep.body)}</div>` : '';
}

// ---------- Pengapotten ----------
const kr = n => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n || 0)).toLocaleString('sv-SE')} kr`;
const TRACK_C = { 'Nytt projekt': '#e8fbff', 'Befintligt projekt': '#7fe9ff', Flipp: '#ffc24d', Övrigt: '#4dffb0' };
function renderPot() {
  const P = S.pot || { budget: 0, spent: 0, earned: 0, left: 0, net: 0, tracks: {}, proposals: [] };
  const ideas = P.proposals.filter(x => x.status === 'förslag').sort((a, b) => (b.track === 'Nytt projekt') - (a.track === 'Nytt projekt'));
  const active = P.proposals.filter(x => x.status === 'pågår');
  const done = P.proposals.filter(x => ['klar', 'avböjd'].includes(x.status));
  const roi = P.spent ? Math.round(P.net / P.spent * 100) : null;
  const tracks = Object.entries(P.tracks || {}).sort((a, b) => (b[1].earned - b[1].spent) - (a[1].earned - a[1].spent));
  const maxT = Math.max(1, ...tracks.map(([, t]) => Math.max(t.spent, t.earned)));
  const chip = t => `<span class="pchip" style="--c:${TRACK_C[t] || 'var(--accent)'}">${esc(t)}</span>`;
  const card = x => `<div class="pcard ${x.status} ${x.track === 'Nytt projekt' ? 'newp' : ''}">
      <div class="pc-h">${chip(x.track)}<span class="pc-r risk-${esc(x.risk)}">RISK ${esc(String(x.risk).toUpperCase())}</span></div>
      <div class="pc-t">${esc(x.title)}</div>
      <div class="pc-n"><span><small>INSATS</small><b>${kr(x.cost)}</b></span><i>→</i><span><small>${x.status === 'klar' ? 'GAV' : 'KAN GE'}</small><b class="${x.status === 'klar' ? (x.result > x.cost ? 'pos' : 'neg') : 'pos'}">${kr(x.status === 'klar' ? x.result : x.expected)}</b></span>${x.hours ? `<span><small>TID</small><b>${x.hours} h</b></span>` : ''}</div>
      ${x.monthly ? `<div class="pc-m"><small>KAN BLI</small><b>${kr(x.monthly)}/mån</b><small>efter ~6 mån om det går bra</small></div>` : ''}
      ${x.why ? `<div class="pc-w">${esc(x.why)}</div>` : ''}
      ${x.steps?.length ? `<details class="pc-s"><summary>Så gör du (${x.steps.length} steg)</summary><ol>${x.steps.map(st => `<li>${esc(st)}</li>`).join('')}</ol>${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">Källa ↗</a>` : ''}</details>` : ''}
      ${x.status === 'förslag' ? `<div class="pc-f">${x.cost > P.left ? `<button class="btn" data-potbudget="1" title="Potten räcker inte">Kräver ${kr(x.cost)} · höj potten</button>` : `<button class="btn primary" data-potok="${x.id}">Godkänn${x.cost ? ' · ' + kr(x.cost) : ''}</button>`}<button class="btn" data-potno="${x.id}">Avböj</button></div>` : ''}
      ${x.status === 'pågår' && x.track === 'Nytt projekt' ? (x.built ? `<div class="pc-b mono">⚙ Claude ${S.jobs?.find(j => j.id === x.built.jobId)?.status === 'kör' ? 'bygger nu' : 'har byggt första versionen'} · <a href="#" data-go="jobs">se Jobb</a><br><small>${esc(x.built.dir || '')}</small></div>`
        : `<button class="btn build" data-potbuild="${x.id}">⚙ Bygg första versionen med Claude</button>`) : ''}
      ${x.status === 'pågår' ? `<div class="pc-f"><span class="dim mono">Ligger i schemat som task</span><button class="btn primary" data-potres="${x.id}">Logga resultat</button></div>` : ''}
    </div>`;
  const html = `
    <div class="pot-top">
      <div class="pot-main" data-potbudget="1" title="Tryck för att ändra potten">
        <div class="pl">KVAR I POTTEN</div><div class="pv">${kr(P.left)}</div>
        <div class="pbar"><i style="width:${P.budget ? Math.min(100, P.left / Math.max(P.budget, P.left) * 100) : 0}%"></i></div>
        <div class="ps mono">${P.budget ? `startpott ${kr(P.budget)} + det som kommit tillbaka · tryck för att ändra` : 'Ingen pott än — tryck här och sätt en budget'}</div>
      </div>
      <div class="pot-stats">
        <div><span>INSATT</span><b>${kr(P.spent)}</b></div>
        <div><span>TILLBAKA</span><b class="pos">${kr(P.earned)}</b></div>
        <div><span>NETTO</span><b class="${P.net >= 0 ? 'pos' : 'neg'}">${kr(P.net)}</b></div>
        <div><span>AVKASTNING</span><b class="${(roi ?? 0) >= 0 ? 'pos' : 'neg'}">${roi == null ? '—' : roi + '%'}</b></div>
      </div>
    </div>
    ${tracks.length ? `<div class="pot-board"><div class="pl">TOPPLISTA</div>${tracks.map(([t, v]) => `<div class="pb-row"><span>${chip(t)}</span>
      <span class="pb-bars"><i class="sp" style="width:${v.spent / maxT * 100}%"></i><i class="er" style="width:${v.earned / maxT * 100}%;background:${TRACK_C[t] || 'var(--ok)'}"></i></span>
      <b class="${v.earned - v.spent >= 0 ? 'pos' : 'neg'}">${kr(v.earned - v.spent)}</b></div>`).join('')}</div>` : ''}
    ${active.length ? `<div class="pl sec">PÅGÅR <b>${active.length}</b></div><div class="pgrid">${active.map(card).join('')}</div>` : ''}
    <div class="pl sec">FÖRSLAG <b>${ideas.length}</b></div>
    ${ideas.length ? `<div class="pgrid">${ideas.map(card).join('')}</div>` : `<div class="idea dim">Inga förslag just nu. Tryck <b>Leta förslag nu</b> — Pengajakten letar annars själv måndagar och torsdagar.</div>`}
    ${done.length ? `<details class="hist"><summary>Historik (${done.length})</summary>${done.map(x => `<div class="hist-row">${x.status === 'avböjd' ? '<span class="dim">Avböjd</span>' : `<b class="${x.result >= x.cost ? 'pos' : 'neg'}">${kr(x.result - x.cost)}</b>`} · ${esc(x.title)}</div>`).join('')}</details>` : ''}`;
  paint($('#potBox'), html, html);
}

// ---------- Aktivitetslogg + pengagraf ----------
const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'nu' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : m < 2880 ? 'igår' : `${Math.floor(m / 1440)} d`; };
function activityItems() {
  const it = [];
  for (const t of S.tasks) if (t.done && t.doneAt) it.push({ at: t.doneAt, ic: '✓', c: 'ok', t: `Bockade av: ${t.title}`, s: t.doneHow || proj(t.project).name });
  for (const r of S.agentReports || []) it.push({ at: r.at, ic: r.failed ? '!' : '◆', c: r.failed ? 'hot' : 'ac2', t: r.title, s: (S.agents || []).find(a => a.id === r.agent)?.name || r.agent });
  for (const j of S.jobs || []) it.push({ at: j.ended || j.started, ic: j.status === 'kör' ? '⟳' : j.status === 'klar' ? '›' : '!', c: j.status === 'kör' ? 'ac' : j.status === 'klar' ? 'ac' : 'hot', t: `Claude ${j.status === 'kör' ? 'jobbar' : j.status}: ${j.instruction.slice(0, 60)}`, s: proj(j.project).name });
  for (const m of S.mails || []) it.push({ at: m.date, ic: '✉', c: 'ac', t: `${m.from}: ${m.summary}`, s: m.account });
  for (const x of S.pot?.proposals || []) if (x.status === 'förslag') it.push({ at: x.at, ic: '$', c: 'ok', t: `Förslag: ${x.title}`, s: 'Pengapotten' });
  return it.filter(x => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 14);
}
function renderActivity() {
  const items = activityItems();
  const html = items.length ? items.map(x => `<div class="act-row"><i class="ai c-${x.c}">${esc(x.ic)}</i><div class="at"><b>${esc(x.t)}</b><small>${esc(x.s || '')}</small></div><span class="aw mono">${ago(x.at)}</span></div>`).join('')
    : '<div class="dim" style="padding:10px;font-size:13px">Inget har hänt än.</div>';
  paint($('#activity'), 'a' + html, html);
  paint($('#activity2'), 'b' + html, html);
}
function weekKey(d) { const x = new Date(d + 'T12:00'); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x.toLocaleDateString('sv-SE'); }
function renderMoneyChart() {
  const weeks = []; const start = weekKey(S.today);
  for (let i = 7; i >= 0; i--) weeks.push(addDays(start, -7 * i));
  const sum = Object.fromEntries(weeks.map(w => [w, 0]));
  for (const e of S.income || []) { const k = weekKey(e.date); if (k in sum) sum[k] += e.amount; }
  const vals = weeks.map(w => sum[w]); const max = Math.max(1, ...vals.map(Math.abs));
  const html = `<div class="bars">${weeks.map((w, i) => `<div class="bc" title="v. från ${w}: ${kr(vals[i])}"><span class="bv mono">${vals[i] ? Math.round(vals[i] / 100) / 10 + 'k' : ''}</span><i class="${vals[i] < 0 ? 'neg' : ''}" style="height:${Math.max(2, Math.abs(vals[i]) / max * 100)}%"></i><small>${+w.slice(8)}/${+w.slice(5, 7)}</small></div>`).join('')}</div>`;
  paint($('#moneyChart'), 'c' + html, html); paint($('#moneyChart2'), 'd' + html, html);
  const tot = vals.reduce((a, b) => a + b, 0);
  $('#moneySum').textContent = `8 v: ${kr(tot)}`;
}

function renderN8n() {
  const N = S.n8n || {};
  let html;
  if (!N.connected) html = `<div class="idea dim">Inte kopplat än. Lägg in <b>N8N_URL</b> och <b>N8N_API_KEY</b> i Render så syns dina flöden här och kan startas/pausas med rösten.</div>`;
  else if (N.error && !N.list?.length) html = `<div class="idea" style="border-color:var(--hot)">${esc(N.error)}</div>`;
  else html = (N.list || []).map(w => {
    const st = w.last?.status, ok = st === 'success', bad = st === 'error' || st === 'crashed';
    const when = w.last?.at ? new Date(w.last.at).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' }) : 'aldrig körd';
    return `<div class="flow ${w.active ? 'on' : ''}"><i class="fd"></i><div class="fm"><b>${esc(w.name)}</b>
      <small class="mono">senast ${esc(when)}${st ? ` · <span class="${ok ? 'pos' : bad ? 'neg' : ''}">${ok ? 'lyckades' : bad ? 'misslyckades' : esc(st)}</span>` : ''}</small></div>
      <span class="pill ${w.active ? 'ok' : ''}">${w.active ? 'IGÅNG' : 'PAUSAD'}</span>
      <button class="sw ${w.active ? 'on' : ''}" data-n8n="${esc(w.id)}|${w.active ? 'pause' : 'start'}" aria-label="${w.active ? 'Pausa' : 'Starta'}"><i></i></button></div>`;
  }).join('') || '<div class="idea dim">Inga flöden hittades.</div>';
  paint($('#n8nBox'), html, html);
}

function renderAgents() {
  const reps = S.agentReports || [];
  const when = d => new Date(d).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
  const open = [...document.querySelectorAll('#agentsBox details[open]')].length;
  paint($('#agentsBox'), JSON.stringify([S.agents, reps]), (S.agents || []).map(ag => {
    const mine = reps.filter(r => r.agent === ag.id);
    const last = mine[0];
    const ok = mine.filter(r => !r.failed).length;
    // Mejlsvar: visa de senaste svarsförslagen, annars bara senaste rapporten
    const current = ag.id === 'mejlsvar' ? mine.filter(r => r.draft).slice(0, 3).concat(mine.find(r => !r.draft) || []) : (last ? [last] : []);
    const history = mine.slice(current.length);
    return `<div class="job">
      <div class="agent-row"><div><div class="an">${esc(ag.name)} <span class="pill ${ag.running ? 'live' : ag.retryAt ? 'warn' : last?.failed ? 'hot' : 'ok'}">${ag.running ? 'JOBBAR' : ag.retryAt ? 'VÄNTAR' : last?.failed ? 'FEL' : 'REDO'}</span></div>
        <div class="as">${ag.running ? 'JOBBAR JUST NU…' : ag.retryAt ? `Googles gratiskvot slut · försöker igen ${new Date(ag.retryAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : last ? `Senast: ${esc(last.title)} · ${when(last.at)}` : 'Inte körd än'}</div></div>
        <button class="btn small" data-agrun="${ag.id}" ${ag.running ? 'disabled' : ''}>${ag.running ? 'Kör…' : 'Kör nu'}</button></div>
      <div class="agent-desc">${esc(ag.desc || '')}</div>
      <div class="agent-stats"><span>Schema: <b>${esc(ag.schedule || '—')}</b></span><span>Körningar: <b>${mine.length}</b></span><span>Lyckade: <b>${ok}</b></span>${mine.length - ok ? `<span class="l-fel">Fel: <b>${mine.length - ok}</b></span>` : ''}</div>
      ${current.map(r => agentDetail(ag.id, r)).join('')}
      ${history.length ? `<details class="hist"><summary>Historik (${history.length})</summary>${history.map(r => `<div class="hist-row">${r.failed ? '<span class="l-fel">✕</span> ' : ''}<b>${esc(r.title)}</b><small>${when(r.at)}</small>${r.body ? `<pre>${esc(r.body.slice(0, 600))}</pre>` : ''}${r.draft ? `<pre>${esc(r.draft.slice(0, 600))}</pre>` : ''}</div>`).join('')}</details>` : ''}
    </div>`;
  }).join(''));
}

// ---------- Video ----------
const fileUrl = (pid, f, dl) => `/api/video/${pid}/file?f=${encodeURIComponent(f)}&token=${encodeURIComponent(token)}${dl ? '&dl=1' : ''}`;
const mb = n => n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(1) + ' MB';
// Rita bara om när något faktiskt ändrats, och behåll det du skrivit i textrutor
const lastSig = {};
function paint(el, sig, html) {
  if (lastSig[el.id] === sig) return;
  lastSig[el.id] = sig;
  const keep = {};
  el.querySelectorAll('textarea[id]').forEach(t => keep[t.id] = t.value);
  el.innerHTML = html;
  for (const [k, v] of Object.entries(keep)) { const t = document.getElementById(k); if (t) t.value = v; }
}

function renderVideo() {
  const V = S.video || { projects: [] };
  const sig = JSON.stringify([S.pc, V, S.jobs.filter(j => String(j.project).startsWith('video:')).map(j => [j.id, j.status, j.result, j.log.length])]);
  if (lastSig.videoBox === sig) return;
  const warn = pcOffWarn('Video') || (V.ffmpeg ? '' : `<div class="warn"><b>FFmpeg saknas på datorn.</b> Öppna PowerShell och kör <code>winget install Gyan.FFmpeg</code>, starta sen om HEIMDALL.</div>`);
  const jobsFor = pid => S.jobs.filter(j => j.project === `video:${pid}`).slice(0, 2);
  paint($('#videoBox'), sig, warn + (V.projects.length ? V.projects.map(p => {
    const clips = p.input.filter(f => !/\.srt$/i.test(f.name));
    const srts = new Set(p.input.filter(f => /\.srt$/i.test(f.name)).map(f => f.name.replace(/\.srt$/i, '')));
    return `<div class="job">
      <div class="agent-row"><div><div class="an">${esc(p.name)}</div><div class="as">${clips.length} klipp · ${p.output.length} färdiga</div></div>
        <span class="btn small upl">+ Ladda upp<input type="file" multiple accept="video/*,audio/*,image/*" data-upload="${p.id}"></span></div>
      <div id="up-${p.id}" class="as" style="padding:0 12px"></div>
      ${clips.length ? `<div class="clips">${clips.map(f => `<div class="clip">
        ${/\.(mp4|mov|m4v|webm)$/i.test(f.name) ? `<video src="${fileUrl(p.id, 'input/' + f.name)}#t=0.5" preload="metadata" muted playsinline></video>` : ''}
        <div class="cn" title="${esc(f.name)}">${esc(f.name)} · ${mb(f.size)}</div>
        <div class="cb">${/\.(mp4|mov|m4v|webm|mp3|wav|m4a)$/i.test(f.name) ? `<button class="btn" data-cap="${p.id}|${esc(f.name)}">${srts.has(f.name.replace(/\.[^.]+$/, '')) ? 'Captions ✓' : 'Captions'}</button>` : ''}</div>
      </div>`).join('')}</div>` : '<div class="agent-desc">Ladda upp dina klipp med knappen ovan — funkar från både mobil och dator.</div>'}
      ${p.output.filter(f => /\.(mp4|mov|webm)$/i.test(f.name)).map(f => `<div class="outv"><div class="as" style="margin-bottom:6px">FÄRDIG · ${esc(f.name)} · ${mb(f.size)}</div>
        <video src="${fileUrl(p.id, 'output/' + f.name)}" controls playsinline preload="metadata"></video>
        <div class="job-f" style="padding:8px 0 0;border:0"><a class="btn small" href="${fileUrl(p.id, 'output/' + f.name, true)}">Ladda ner</a></div></div>`).join('')}
      ${jobsFor(p.id).map(j => `<div class="job-i"><span class="st st-${esc(j.status)}">${esc(j.status)}</span> ${esc((j.result || j.log.at(-1)?.v || 'Startar…').slice(0, 220))}</div>`).join('')}
      <div class="vinst"><textarea class="draft" style="min-height:80px" id="vi-${p.id}" placeholder="Vad ska göras? T.ex. 'klipp ihop till en 30 sek TikTok i 9:16, snabba klipp på beatet, captions och zoom på höjdpunkterna'"></textarea>
        <div><button class="btn small primary" data-vedit="${p.id}">Redigera med Claude</button></div></div>
    </div>`;
  }).join('') : '<div class="idea dim">Inga videoprojekt än. Tryck + Projekt för att börja.</div>'));
}

function uploadFiles(pid, files) {
  const box = $('#up-' + pid);
  let i = 0;
  const next = () => {
    if (i >= files.length) { box.textContent = 'Uppladdat ✓'; refresh(); return; }
    const f = files[i++];
    const x = new XMLHttpRequest();
    x.open('POST', `/api/video/${pid}/upload?name=${encodeURIComponent(f.name)}`);
    x.setRequestHeader('X-Heimdall-Token', token);
    x.upload.onprogress = e => { box.textContent = `Laddar upp ${f.name} · ${Math.round(e.loaded / e.total * 100)}% (${i}/${files.length})`; };
    x.onload = () => { if (x.status !== 200) toast('Uppladdning', `${f.name}: ${x.responseText}`, true); next(); };
    x.onerror = () => { toast('Uppladdning', `${f.name} misslyckades`, true); next(); };
    x.send(f);
  };
  next();
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && e.target.id?.startsWith('re-')) {
    document.querySelector(`[data-reply="${e.target.id.slice(3)}"]`)?.click();
  }
});
document.addEventListener('change', e => { if (e.target.dataset.upload) uploadFiles(e.target.dataset.upload, [...e.target.files]); });
function trailerSheet() {
  const projs = (S.video?.projects || []);
  openSheet(`<h3>Trailer för hemsida</h3>
    <div class="field"><label>Sajt</label><input id="t-url" placeholder="minsajt.se"></div>
    <div class="grid2">
      <div class="field"><label>Format</label><select id="t-fmt"><option>9:16</option><option>16:9</option></select></div>
      <div class="field"><label>Längd (sek)</label><input id="t-len" type="number" value="30"></div>
    </div>
    <div class="field"><label>Stil (valfritt)</label><textarea id="t-style" placeholder="T.ex. mörkt och hårt, snabba klipp, visa releaselistan och festivalkartan"></textarea></div>
    <div class="field"><label>Musik/klipp från projekt (valfritt)</label><select id="t-proj"><option value="">Ingen musik</option>${projs.map(p => `<option value="${p.id}">${esc(p.name)} (${p.input.length} filer)</option>`).join('')}</select></div>
    <p class="dim" style="font-size:12px;margin:0 0 12px">Vill du ha musik: ladda upp låten i ett projekt först. Drar från Claude-budgeten.</p>
    <div class="sheet-actions"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="t-go">Gör trailer</button></div>`);
  $('#t-go').onclick = async () => {
    try {
      await api('/api/video/trailer', { method: 'POST', body: { url: $('#t-url').value, format: $('#t-fmt').value, length: +$('#t-len').value || 30, style: $('#t-style').value, project: $('#t-proj').value || undefined } });
      closeSheet(); toast('Trailer', 'Claude spelar in sajten och klipper — du får en notis'); refresh();
    } catch (e) { toast('Trailer', e.message, true); }
  };
}

$('#trailerBtn').onclick = () => trailerSheet();
$('#newVideoBtn').onclick = async () => {
  const name = prompt('Vad ska projektet heta?', 'Min video');
  if (!name) return;
  await api('/api/video', { method: 'POST', body: { name } }); refresh();
};

function renderAgentRuns() {
  const runs = S.agentRuns || [];
  $('#agentRuns').innerHTML = runs.length ? runs.map(r => `<div class="job ${['klar', 'kör'].includes(r.status) ? '' : 'alert'}">
    <div class="job-h"><span>${esc(r.goal)}</span><span class="st st-${esc(r.status)}">${esc(r.status)}</span></div>
    <div class="job-log">${r.steps.map(s => `<div class="${s.ok ? 'l-verktyg' : 'l-fel'}">› ${esc(s.text)}</div>`).join('') || '<div>Inga steg hann köras</div>'}</div>
    ${r.summary ? `<div class="job-r ${r.status === 'klar' ? '' : 'l-fel'}">${esc(r.summary)}</div>` : ''}</div>`).join('')
    : '<div class="idea dim">Inga datorjobb än.</div>';
}

function renderBadge() {
  const run = S.jobs.filter(j => j.status === 'kör').length;
  const bad = S.jobs.filter(j => jobGroup(j) === 'åtgärd').length;
  const b = $('#jobBadge');
  b.textContent = bad || run;
  b.classList.toggle('hidden', !(bad || run));
  b.classList.toggle('hot', !!bad);
}

// ---------- Chatt ----------
let chatRendered = false;
// Hoppa längst ner i chatten — även efter att typsnitt/ögat ändrat storlek
function toBottom() {
  const go = () => { const l = $('#log'); if (l) l.scrollTop = l.scrollHeight; };
  go(); requestAnimationFrame(go); [150, 500, 1200].forEach(ms => setTimeout(go, ms));
  document.fonts?.ready.then(go).catch(() => {});
}
function renderChat() {
  $('#log').innerHTML = '';
  S.chat.slice(-20).forEach(m => addMsg(m.role, m.text, m.actions, false));
  $('.core').classList.toggle('chatting', S.chat.length > 0);
  toBottom();
}

const ACT = { make_trailer: 'gör trailer', video_projects: 'kollade videoprojekten', video_edit: 'startade videoredigering', run_agent: 'startade agent', add_goal: 'satte mål', update_goal: 'uppdaterade mål', add_income: 'loggade pengar', income_report: 'räknade pengar', start_focus: 'startade fokus', stop_focus: 'avslutade fokus', add_word: 'lade till i ordlistan', read_mail: 'kollade mejlen', pc_agent: 'tar över datorn', pc_agent_stop: 'stoppade datorjobbet', pc_control: 'styrde datorn', tv_control: 'styrde TV:n', phone_shortcut: 'körde genväg', set_settings: 'ändrade inställning', update_self: 'uppdaterar', list_tasks: 'läste schemat', add_task: 'la till task', complete_task: 'bockade av', update_task: 'ändrade task',
  delete_task: 'tog bort task', set_shift: 'ändrade skift', save_idea: 'sparade idé', run_claude: 'startade Claude-jobb', set_budget: 'uppdaterade budget', money_pot: 'pengapotten', macro: 'eget kommando', n8n: 'n8n' };

function addMsg(role, text, actions = [], scroll = true) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  const tx = document.createElement('span'); tx.className = 'txt'; tx.textContent = text; el.appendChild(tx);
  const acts = (actions || []).filter(a => a.tool !== 'list_tasks');
  if (acts.length) {
    const a = document.createElement('div');
    a.className = 'acts';
    a.innerHTML = acts.map(x => `<span class="act ${x.ok ? '' : 'bad'}">${esc(ACT[x.tool] || x.tool)}${x.args?.title ? ': ' + esc(x.args.title) : ''}</span>`).join('');
    el.appendChild(a);
  }
  $('#log').appendChild(el);
  $('.core').classList.add('chatting');
  if (scroll) $('#log').scrollTop = 1e9;
  return el;
}

function renderModel(flash) {
  const m = S?.activeModel, el = $('#modelBadge');
  if (!el) return;
  el.textContent = m ? `${m.provider.toUpperCase()} · ${m.model}${m.standby ? ' (redo)' : ''}` : 'MODELL: – (starta om HEIMDALL)';
  if (flash) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
}

function setEye(mode, label) {
  $('#eye').className = 'eye ' + mode;
  $('#eyeStatus').textContent = label;
}

function thinking() {
  const el = document.createElement('div');
  el.className = 'msg heimdall';
  el.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  $('#log').appendChild(el); $('#log').scrollTop = 1e9;
  setEye('thinking', 'ANALYSERAR');
  return el;
}

async function say(text) {
  if (!text.trim()) return;
  addMsg('user', text);
  const t = thinking();
  try {
    const r = await api('/api/chat', { method: 'POST', body: { message: text } });
    t.remove();
    reply(r);
  } catch (e) {
    t.remove(); addMsg('heimdall', e.message); setEye('error', 'FEL'); setTimeout(() => setEye('idle', 'VAKTAR'), 2500);
  }
}

function reply(r) {
  addMsg('heimdall', r.text, r.actions);
  speak(r.text);
  refresh().catch(() => {});
}

$('#say').onsubmit = e => {
  e.preventDefault();
  const v = $('#sayInput').value; $('#sayInput').value = '';
  unlockAudio();
  if (L?.ws.readyState === 1 && v.trim()) { L.youEl = addMsg('user', v); L.youEl = null; L.ws.send(JSON.stringify({ type: 'text', text: v })); return; }
  say(v);
};

// ---------- Röst ut ----------
let svVoice = null;
function pickVoice() {
  const vs = speechSynthesis?.getVoices?.() || [];
  const sv = vs.filter(v => /^sv/i.test(v.lang));
  // Neurala röster (Edge "Natural"/"Online", Google, Premium) låter betydligt mer mänskliga än standardrösten
  svVoice = sv.find(v => /Natural|Online/i.test(v.name) && /Mattias|Sofie/i.test(v.name))
    || sv.find(v => /Natural|Online|Neural/i.test(v.name))
    || sv.find(v => /Premium|Enhanced|Google/i.test(v.name))
    || sv.find(v => /Oskar|Alva|Klara/i.test(v.name))
    || sv[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

function unlockAudio() {
  // iOS kräver ett tryck innan röst får spelas
  if ('speechSynthesis' in window && !unlockAudio.done) {
    const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); unlockAudio.done = true;
  }
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

let ttsAudio = null, ttsSeq = 0;
async function speak(text) {
  if (!tts) { setEye('idle', 'VAKTAR'); return; }
  const seq = ++ttsSeq;
  try { ttsAudio?.pause(); speechSynthesis?.cancel(); } catch {}
  // Först naturlig röst från Gemini; faller tillbaka på enhetens röst om den inte svarar
  try {
    setEye('speaking', 'SVARAR');
    const r = await api('/api/tts', { method: 'POST', body: { text } });
    if (seq !== ttsSeq) return;
    const a = ttsAudio = new Audio(`data:${r.mime};base64,${r.audio}`);
    a.onended = a.onerror = () => { if (seq === ttsSeq) setEye('idle', 'VAKTAR'); };
    await a.play();
    return;
  } catch { if (seq !== ttsSeq) return; }
  speakLocal(text);
}
function speakLocal(text) {
  if (!('speechSynthesis' in window)) { setEye('idle', 'VAKTAR'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, ''));
  u.lang = 'sv-SE'; if (svVoice) u.voice = svVoice; u.rate = 1.05; u.pitch = .9;
  u.onstart = () => setEye('speaking', 'SVARAR');
  u.onend = u.onerror = () => setEye('idle', 'VAKTAR');
  speechSynthesis.speak(u);
}
$('#ttsBtn').onclick = () => { tts = !tts; try { localStorage.setItem('h_tts', tts ? '1' : '0'); } catch {} if (!tts) { ttsSeq++; ttsAudio?.pause(); speechSynthesis?.cancel(); } renderTop(); };

// ---------- Röst in ----------
let rec = null, chunks = [], stream = null, analyser = null, actx = null, raf = 0;

async function startRec() {
  unlockAudio();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { toast('Mikrofon', 'Fick inte tillgång till mikrofonen', true); return; }
  speechSynthesis?.cancel();
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = sendRec;
  rec.start();
  $('#micBtn').classList.add('rec');
  setEye('listening', 'LYSSNAR');
  actx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = actx.createAnalyser(); analyser.fftSize = 256;
  actx.createMediaStreamSource(stream).connect(analyser);
  drawWave();
  startRec.timer = setTimeout(stopRec, 45000);
}

function stopRec() {
  clearTimeout(startRec.timer);
  if (rec && rec.state !== 'inactive') rec.stop();
  stream?.getTracks().forEach(t => t.stop());
  $('#micBtn').classList.remove('rec');
  cancelAnimationFrame(raf);
  const c = $('#wave'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

async function sendRec() {
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  if (blob.size < 2000) { setEye('idle', 'VAKTAR'); actx?.close(); return; }
  const t = thinking();
  try {
    const wav = await toWav(blob);
    const r = await api('/api/voice', { method: 'POST', body: { audio: wav, mime: 'audio/wav' } });
    t.remove();
    if (r.transcript) addMsg('user', r.transcript);
    reply(r);
  } catch (e) {
    t.remove(); addMsg('heimdall', e.message); setEye('idle', 'VAKTAR');
  } finally { actx?.close(); }
}

// Gör om inspelningen till 16 kHz mono WAV (funkar med Gemini på både iPhone och dator)
async function toWav(blob) {
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const audio = await new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej));
  ctx.close();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * rate), rate);
  const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
  const out = (await off.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + out.length * 2));
  const w = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); view.setUint32(4, 36 + out.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, 'data'); view.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, out[i])) * 0x7fff, true);
  const bytes = new Uint8Array(view.buffer);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function drawWave() {
  const c = $('#wave'), g = c.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount);
  const loop = () => {
    analyser.getByteFrequencyData(data);
    g.clearRect(0, 0, 400, 400);
    const n = 72;
    for (let i = 0; i < n; i++) {
      const v = data[Math.floor(i / n * data.length * .7)] / 255;
      const a = i / n * Math.PI * 2 - Math.PI / 2;
      const r1 = 84, r2 = 84 + 8 + v * 70;
      g.strokeStyle = `rgba(127,255,212,${.35 + v * .65})`;
      g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(200 + Math.cos(a) * r1, 200 + Math.sin(a) * r1); g.lineTo(200 + Math.cos(a) * r2, 200 + Math.sin(a) * r2); g.stroke();
    }
    raf = requestAnimationFrame(loop);
  };
  loop();
}

// ---------- Samtal i realtid (Gemini Live) ----------
// Mic-knappen startar ett samtal. Prata fritt, avbryt när du vill. Tryck igen för att lägga på.
let L = null; // { ws, micCtx, playCtx, stream, node, sources, nextTime, youEl, meEl }

const WORKLET = `
class Mic extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.ratio = sampleRate / 16000; this.acc = 0; this.n = 0; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    // Medelvärde över varje grupp av sampel = ett enkelt lågpassfilter, så rösten inte blir förvrängd
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++; this.pos++;
      if (this.pos >= this.ratio) { this.buf.push(this.acc / this.n); this.acc = 0; this.n = 0; this.pos -= this.ratio; }
    }
    if (this.buf.length >= 1600) { // 100 ms
      const out = new Int16Array(this.buf.length);
      for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, this.buf[i])) * 0x7fff;
      this.port.postMessage(out.buffer, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor('mic', Mic);`;

const b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

async function startLive() {
  unlockAudio();
  speechSynthesis?.cancel();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { toast('Mikrofon', 'Fick inte tillgång till mikrofonen', true); return; }

  const AC = window.AudioContext || window.webkitAudioContext;
  L = { stream, sources: [], nextTime: 0, youEl: null, meEl: null };
  L.playCtx = new AC({ sampleRate: 24000 });
  L.micCtx = new AC();
  await L.playCtx.resume(); await L.micCtx.resume();

  $('#micBtn').classList.add('rec', 'live');
  setEye('thinking', 'ANSLUTER');

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  L.ws = new WebSocket(`${proto}://${location.host}/api/live?token=${encodeURIComponent(token)}`);
  L.ws.onmessage = e => onLive(JSON.parse(e.data));
  L.ws.onclose = e => {
    if (L && !L.ready) toast('Samtal', `Kunde inte starta samtalet${e.code && e.code !== 1000 ? ' (kod ' + e.code + ')' : ''} — kolla det svarta fönstret`, true);
    if (L) stopLive();
  };
  L.ws.onerror = () => toast('Samtal', 'Kunde inte ansluta', true);
}

async function micOn() {
  try { await micSetup(); }
  catch (e) {
    // Webbläsaren klarade inte 16 kHz direkt — kör med vanlig samplingsfrekvens istället
    try {
      try { L.micCtx.close(); } catch {}
      L.micCtx = new (window.AudioContext || window.webkitAudioContext)();
      await L.micCtx.resume();
      await micSetup();
    } catch (e2) {
      toast('Mikrofon', `Kunde inte starta: ${e2.message}`, true);
      stopLive();
    }
  }
}

async function micSetup() {
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
  await L.micCtx.audioWorklet.addModule(url);
  const src = L.micCtx.createMediaStreamSource(L.stream);
  L.node = new AudioWorkletNode(L.micCtx, 'mic');
  L.node.port.onmessage = e => { if (L?.ws.readyState === 1) L.ws.send(JSON.stringify({ type: 'audio', data: b64(e.data) })); };
  src.connect(L.node);
  analyser = L.micCtx.createAnalyser(); analyser.fftSize = 256; src.connect(analyser);
  drawWave();
}

function onLive(m) {
  if (m.type === 'ready') { L.ready = true; micOn(); setEye('listening', 'SAMTAL'); }
  else if (m.type === 'audio') {
    if (L.heardAt) { L.lag = ((performance.now() - L.heardAt) / 1000).toFixed(1); L.heardAt = 0; }
    playChunk(m.data);
  }
  else if (m.type === 'interrupted') stopPlayback();
  else if (m.type === 'you') {
    L.heardAt = performance.now();
    if (!L.youEl) { L.youEl = addMsg('user', ''); L.meEl = null; }
    L.youEl.querySelector('.txt').textContent += m.text;
    $('#log').scrollTop = 1e9;
  } else if (m.type === 'me') {
    if (!L.meEl) L.meEl = addMsg('heimdall', '');
    L.meEl.querySelector('.txt').textContent += m.text;
    $('#log').scrollTop = 1e9;
  } else if (m.type === 'action') {
    if (!L.meEl) L.meEl = addMsg('heimdall', '');
    let a = L.meEl.querySelector('.acts');
    if (!a) { a = document.createElement('div'); a.className = 'acts'; L.meEl.appendChild(a); }
    if (m.action.tool !== 'list_tasks') a.insertAdjacentHTML('beforeend', `<span class="act ${m.action.ok ? '' : 'bad'}">${esc(ACT[m.action.tool] || m.action.tool)}${m.action.args?.title ? ': ' + esc(m.action.args.title) : ''}</span>`);
    refresh().catch(() => {});
  } else if (m.type === 'turn') { L.youEl = null; L.meEl = null; }
  else if (m.type === 'error') { toast('Samtal', m.message, true); }
}

function playChunk(data) {
  const bin = atob(data); const n = bin.length / 2;
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const buf = L.playCtx.createBuffer(1, n, 24000); const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 0x8000;
  const src = L.playCtx.createBufferSource(); src.buffer = buf; src.connect(L.playCtx.destination);
  // Ny mening eller glapp: buffra 0,2 s så ljudet flyter, annars spela direkt efter förra biten
  const now = L.playCtx.currentTime;
  const t = L.nextTime > now ? L.nextTime : now + 0.2;
  src.start(t); L.nextTime = t + buf.duration;
  L.sources.push(src);
  setEye('speaking', L.lag ? `SVARAR · ${L.lag}s` : 'SVARAR');
  src.onended = () => {
    L && (L.sources = L.sources.filter(s => s !== src));
    if (L && !L.sources.length) setEye('listening', 'SAMTAL');
  };
}

function stopPlayback() {
  if (!L) return;
  L.sources.forEach(s => { try { s.stop(); } catch {} });
  L.sources = []; L.nextTime = 0;
  setEye('listening', 'SAMTAL');
}

function stopLive() {
  const l = L; L = null;
  if (!l) return;
  try { l.ws.close(); } catch {}
  l.stream.getTracks().forEach(t => t.stop());
  try { l.micCtx.close(); l.playCtx.close(); } catch {}
  cancelAnimationFrame(raf);
  const c = $('#wave'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
  $('#micBtn').classList.remove('rec', 'live');
  setEye('idle', 'VAKTAR');
  refresh().catch(() => {});
}

$('#micBtn').onclick = () => L ? stopLive() : startLive();
$('#eye').onclick = () => $('#micBtn').click();

// ---------- Navigering ----------
$$('.nav button').forEach(b => b.onclick = () => go(b.dataset.v));
function go(v, dir = 0) {
  $$('.nav button').forEach(x => x.classList.toggle('on', x.dataset.v === v));
  document.documentElement.style.setProperty('--from', dir > 0 ? '36px' : dir < 0 ? '-36px' : '0px');
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
  if (v === 'core') toBottom();
}

// Svep åt sidan för att byta flik (mobil)
(() => {
  let x0 = 0, y0 = 0, t0 = 0, ok = false;
  const main = $('main');
  main.addEventListener('touchstart', e => {
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    ok = e.touches.length === 1 && !e.target.closest('input,textarea,select,video,.week,.quick,.jfilters,.clips,.job-log,pre');
  }, { passive: true });
  main.addEventListener('touchend', e => {
    if (!ok) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || Date.now() - t0 > 700) return;
    const order = $$('.nav button').map(b => b.dataset.v);
    const nxt = order[order.indexOf($('.nav button.on')?.dataset.v) + (dx < 0 ? 1 : -1)];
    if (nxt) go(nxt, dx < 0 ? 1 : -1);
  }, { passive: true });
})();

// ---------- Klick ----------
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-say],[data-go],[data-toggle],[data-done],[data-edit],[data-jump],[data-shift],[data-newjob],[data-addtask],[data-publish],[data-dismiss],[data-stop],[data-undo],[data-agrun],[data-copy],[data-cap],[data-vedit],[data-reply],[data-pubthread],[data-newjobany],[data-potok],[data-potno],[data-potres],[data-potbudget],[data-pothunt],[data-potbuild],[data-incgoal],[data-n8n],[data-n8nref],[data-macdel]');
  if (!t) return;
  const d = t.dataset;
  try {
    if (d.say) { unlockAudio(); if (L?.ws.readyState === 1) { addMsg('user', d.say); L.ws.send(JSON.stringify({ type: 'text', text: d.say })); } else say(d.say); return; }
    if (d.go) { go(d.go); return; }
    if (d.toggle || d.done) {
      const id = d.toggle || d.done;
      const task = S.tasks.find(x => x.id === id);
      await api(`/api/tasks/${id}/${task.done ? 'undone' : 'done'}`, { method: 'POST' });
      if (!task.done) toast('Klart', task.title);
      await refresh();
    } else if (d.edit) taskSheet(S.tasks.find(x => x.id === d.edit));
    else if (d.jump) { selectedDay = d.jump; renderWeek(); renderDays(); document.getElementById('d-' + d.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (d.shift) shiftSheet(d.shift);
    else if (d.newjob) jobSheet(d.newjob);
    else if (d.addtask) taskSheet(null, d.addtask);
    else if (d.publish) {
      const job = S.jobs.find(x => x.id === d.publish);
      if (!confirm(`Publicera live?\n\nFiler:\n${job.changed.join('\n')}`)) return;
      await api(`/api/jobs/${d.publish}/publish`, { method: 'POST' });
      toast('Publicerat', proj(job.project).name);
    } else if (d.pubthread) {
      const js = d.pubthread.split(',').map(id => S.jobs.find(x => x.id === id)).filter(Boolean);
      const files = [...new Set(js.flatMap(j => j.changed))];
      if (!confirm(`Publicera live?\n\nFiler:\n${files.join('\n')}`)) return;
      t.disabled = true;
      const r = await api('/api/jobs/publish-many', { method: 'POST', body: { ids: js.map(j => j.id) } });
      toast('Publicerat', `${proj(js[0].project).name}${r.restarting ? ' · HEIMDALL startar om' : ''}`);
    } else if (d.newjobany) jobSheet(S.projects[0]?.id);
    else if (d.potok) { const r = await api(`/api/pot/${d.potok}/approve`, { method: 'POST' }); toast('Godkänt', `Ligger i schemat · ${kr(r.left)} kvar i potten`); await refresh(); }
    else if (d.potno) { await api(`/api/pot/${d.potno}/decline`, { method: 'POST' }); await refresh(); }
    else if (d.potres) {
      const v = prompt('Hur mycket gav det tillbaka i kr? (0 om det inte blev något)', '0'); if (v == null) return;
      const r = await api(`/api/pot/${d.potres}/result`, { method: 'POST', body: { kr: +v.replace(/[^\d.-]/g, '') || 0 } });
      toast('Loggat', `${r.title}: ${kr(r.result)}`); await refresh();
    }
    else if (d.potbudget) {
      const v = prompt('Hur mycket ska finnas i potten totalt (kr)?', String(S.pot?.budget || 500)); if (v == null) return;
      await api('/api/pot/budget', { method: 'POST', body: { kr: +v.replace(/[^\d]/g, '') || 0 } }); await refresh();
    }
    else if (d.potbuild) {
      if (!confirm('Låta Claude bygga första versionen? Drar från Claude-veckobudgeten och kräver att datorn är på.')) return;
      t.disabled = true;
      const r = await api(`/api/pot/${d.potbuild}/build`, { method: 'POST' });
      toast('Claude bygger', r.dir ? `Mapp: ${r.dir}` : 'Följ jobbet under Jobb'); await refresh();
    }
    else if (d.incgoal) {
      const v = prompt('Hur mycket extra vill du tjäna per månad (kr)?', String(S.settings.incomeGoal || 10000)); if (v == null) return;
      await api('/api/settings', { method: 'POST', body: { incomeGoal: +v.replace(/[^\d]/g, '') || 0 } }); await refresh();
    }
    else if (d.n8n) { const [id, act] = d.n8n.split('|'); t.disabled = true; const r = await api(`/api/n8n/${id}/${act}`, { method: 'POST' }); toast('n8n', `${r.name} ${r.active ? 'är igång' : 'är pausat'}`); await refresh(); }
    else if (d.n8nref) { await api('/api/n8n/refresh', { method: 'POST' }); await refresh(); }
    else if (d.macdel) { if (!confirm(`Ta bort kommandot ${d.macdel}?`)) return; await api('/api/macro', { method: 'POST', body: { action: 'delete', name: d.macdel } }); await refresh(); settingsSheet(); }
    else if (d.pothunt) { await api('/api/agents/pengajakt/run', { method: 'POST' }); toast('Pengajakten', 'Letar — du får en notis när förslagen är klara'); await refresh(); }
    else if (d.dismiss && d.dismiss !== 'all' && d.dismiss.includes(',')) {
      for (const id of d.dismiss.split(',')) await api(`/api/jobs/${id}/dismiss`, { method: 'POST' });
      toast('Avfärdat', 'Stör inte längre'); await refresh();
    } else if (d.dismiss) { await api(`/api/jobs/${d.dismiss}/dismiss`, { method: 'POST' }); toast('Avfärdat', 'Jobbet stör inte längre'); await refresh();
    } else if (d.stop) { await api(`/api/jobs/${d.stop}/stop`, { method: 'POST' }); }
    else if (d.undo) {
      if (!confirm('Ångra allt jobbet ändrade? Projektet återställs till läget innan jobbet.')) return;
      await api(`/api/jobs/${d.undo}/undo`, { method: 'POST' }); toast('Ångrat', 'Projektet är återställt');
    }
    else if (d.agrun) { await api(`/api/agents/${d.agrun}/run`, { method: 'POST' }); toast('Agent', 'Startad — du får en notis när den är klar'); refresh(); }
    else if (d.cap) {
      const [pid, file] = d.cap.split('|');
      t.textContent = 'Jobbar…'; t.disabled = true;
      const r = await api(`/api/video/${pid}/captions`, { method: 'POST', body: { file } });
      toast('Captions klara', `${r.lines} rader — be Claude bränna in dem`); refresh();
    }
    else if (d.vedit) {
      const ins = $('#vi-' + d.vedit).value.trim();
      if (!ins) return toast('Video', 'Skriv vad som ska göras först', true);
      $('#vi-' + d.vedit).value = '';
      await api(`/api/video/${d.vedit}/edit`, { method: 'POST', body: { instruction: ins } });
      toast('Claude redigerar', 'Du får en notis när videon är klar'); refresh();
    }
    else if (d.reply) {
      const box = $('#re-' + d.reply);
      const ins = box.value.trim();
      if (!ins) return;
      box.value = '';
      const prev = S.jobs.find(x => x.id === d.reply);
      const th = prev && threadsOf(S.jobs).find(x => x.jobs.includes(prev));
      if (th) { openThreads.add(th.id); saveOpen(); }
      t.disabled = true;
      await api('/api/jobs', { method: 'POST', body: { resume: d.reply, instruction: ins } });
      toast('Claude', 'Skickat — svaret kommer här i samma tråd'); await refresh(); renderJobs(true);
    }
    else if (d.copy) {
      await navigator.clipboard.writeText($('#d-' + d.copy).value); toast('Kopierat', 'Klistra in i mejlet');
    }
  } catch (err) { toast('Fel', err.message, true); }
});

$('#addTaskBtn').onclick = () => taskSheet(null);
$('#budgetBox').onclick = () => budgetSheet();
$('#setBtn').onclick = () => settingsSheet();

// ---------- Notiser ----------
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(/iPhone|iPad/.test(navigator.userAgent) ? 'Öppna HEIMDALL från hemskärmen, inte i Safari' : 'Den här webbläsaren stödjer inte notiser');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notiser nekades — slå på dem i telefonens inställningar');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('/api/push/key');
  const pad = '='.repeat((4 - key.length % 4) % 4);
  const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
  await api('/api/push/test', { method: 'POST' });
}

const VOICES = ['Achird', 'Sulafat', 'Gacrux', 'Charon', 'Puck', 'Kore', 'Fenrir', 'Aoede', 'Orus', 'Zephyr', 'Leda'];
function settingsSheet() {
  const s = S.settings;
  openSheet(`<h3>Inställningar</h3>
    <div class="field"><label>Ditt namn</label><input id="s-owner" value="${esc(S.owner || '')}" placeholder="T.ex. Alex"></div>
    <div class="field"><label>Om dig (agenterna använder det här)</label><textarea id="s-about" placeholder="Vad du jobbar med, dina projekt, vad du vill uppnå…">${esc(S.about || '')}</textarea></div>
    <div class="set-row"><div><div class="lbl">Notiser på den här enheten</div><div class="sub">${S.pushCount} enhet${S.pushCount === 1 ? '' : 'er'} aktiverade</div></div><button class="btn small primary" id="s-push">Aktivera</button></div>
    <div class="set-row"><div><div class="lbl">Kalender i telefonen</div><div class="sub">Tasks och skift syns i iPhone-/Google-kalendern</div></div><button class="btn small" id="s-cal">Kopiera länk</button></div>
    <div class="set-row"><div><div class="lbl">Morgonbrief</div><div class="sub">Dagens plan som notis</div></div><span><input type="checkbox" id="s-mon" ${s.morningOn !== false ? 'checked' : ''}> <input type="time" id="s-mt" value="${esc(s.morningTime || '09:00')}"></span></div>
    <div class="set-row"><div><div class="lbl">Kvällssummering</div><div class="sub">Vad du hann och vad som är kvar</div></div><span><input type="checkbox" id="s-eon" ${s.eveningOn !== false ? 'checked' : ''}> <input type="time" id="s-et" value="${esc(s.eveningTime || '21:30')}"></span></div>
    <div class="set-row"><div><div class="lbl">Röst i samtal</div><div class="sub">Gäller nästa samtal</div></div><select id="s-voice">${VOICES.map(v => `<option ${v === (s.voice || 'Achird') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="set-row"><div><div class="lbl">Samtalsmodell</div><div class="sub">Byt om den hör dåligt</div></div><select id="s-model"><option value="">Automatiskt</option></select></div>
    <div class="set-row"><div><div class="lbl">Inkomstmål per månad</div><div class="sub">Visas i Kärnan</div></div><span><input type="number" id="s-goal" style="width:110px" value="${esc(s.incomeGoal || '')}" placeholder="10000"> kr</span></div>
    <div class="set-row col"><div><div class="lbl">Egna kommandon</div><div class="sub">Skapa med rösten: "skapa kommandot Godnatt: stäng av TV:n och lås datorn"</div></div>
      ${(s.macros || []).map(m => `<div class="mac"><b>${esc(m.name)}</b><span>${esc(m.summary)}</span><button class="btn small danger" data-macdel="${esc(m.name)}">Ta bort</button></div>`).join('') || '<div class="sub">Inga än.</div>'}</div>
    <div class="set-row"><div><div class="lbl">Uppdatera HEIMDALL</div><div class="sub">Hämtar senaste versionen och startar om</div></div><button class="btn small" id="s-upd">Uppdatera</button></div>
    <div class="sheet-actions"><button class="btn" data-close>Stäng</button><button class="btn primary" id="s-save">Spara</button></div>`);
  $('#s-cal').onclick = async () => {
    const link = `${location.origin}/api/calendar.ics?token=${encodeURIComponent(token)}`.replace(/^https?:/, 'webcal:');
    try { await navigator.clipboard.writeText(link); } catch { prompt('Kopiera länken:', link); }
    toast('Kalenderlänk kopierad', 'iPhone: Inställningar → Kalender → Konton → Lägg till konto → Annat → Lägg till prenumererad kalender → klistra in');
  };
  $('#s-push').onclick = async () => {
    try { await enablePush(); toast('Notiser', 'Påslaget — du ska ha fått en testnotis'); refresh(); }
    catch (e) { toast('Notiser', e.message, true); }
  };
  api('/api/live/models').then(r => {
    $('#s-model').innerHTML = `<option value="">Automatiskt (${esc(r.auto || '?')})</option>` + r.models.map(m => `<option ${m === s.liveModel ? 'selected' : ''}>${esc(m)}</option>`).join('');
  }).catch(() => {});
  $('#s-upd').onclick = async () => { await api('/api/update', { method: 'POST' }); closeSheet(); setTimeout(() => location.reload(), 9000); };
  $('#s-save').onclick = async () => {
    await api('/api/settings', { method: 'POST', body: {
      morningOn: $('#s-mon').checked, morningTime: $('#s-mt').value, eveningOn: $('#s-eon').checked, eveningTime: $('#s-et').value, voice: $('#s-voice').value, liveModel: $('#s-model').value || null, incomeGoal: +$('#s-goal').value || 0,
    } });
    const owner = $('#s-owner').value.trim(), about = $('#s-about').value.trim();
    if (owner !== (S.owner || '') || about !== (S.about || '')) await api('/api/config', { method: 'POST', body: { owner, about } });
    closeSheet(); refresh();
  };
}

// ---------- Sheets ----------
function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); }
$('#sheet').onclick = e => { if (e.target.id === 'sheet' || e.target.dataset.close !== undefined) closeSheet(); };

const projOpts = sel => S.projects.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

function taskSheet(task, projectId) {
  const t = task || { title: '', project: projectId || S.projects[0]?.id, date: S.today, estimate_min: 30, priority: 2, claude_heavy: false };
  openSheet(`<h3>${task ? 'Ändra task' : 'Ny task'}</h3>
    <div class="field"><label>Vad</label><input id="f-title" value="${esc(t.title)}" placeholder="t.ex. Lägg in nya event"></div>
    <div class="grid2">
      <div class="field"><label>Projekt</label><select id="f-proj">${projOpts(t.project)}</select></div>
      <div class="field"><label>Dag</label><input id="f-date" type="date" value="${esc(t.date)}"></div>
      <div class="field"><label>Klockslag (påminnelse)</label><input id="f-time" type="time" value="${esc(t.time || '')}"></div>
      <div class="field"><label>Tid (min)</label><input id="f-est" type="number" inputmode="numeric" value="${t.estimate_min}"></div>
      <div class="field"><label>Prioritet</label><select id="f-prio"><option value="1" ${t.priority === 1 ? 'selected' : ''}>Hög</option><option value="2" ${t.priority === 2 ? 'selected' : ''}>Normal</option><option value="3" ${t.priority === 3 ? 'selected' : ''}>Låg</option></select></div>
    </div>
    <label class="check"><input id="f-heavy" type="checkbox" ${t.claude_heavy ? 'checked' : ''}> Claude-tung (kräver mycket kodjobb)</label>
    <div class="sheet-actions">
      ${task ? '<button class="btn danger" id="f-del">Ta bort</button><button class="btn" id="f-focus">Fokus 50 min</button><button class="btn" id="f-run">Kör med Claude</button>' : ''}
      <button class="btn" data-close>Avbryt</button><button class="btn primary" id="f-save">Spara</button></div>`);
  $('#f-title').focus();
  $('#f-save').onclick = async () => {
    const body = { title: $('#f-title').value.trim(), project: $('#f-proj').value, date: $('#f-date').value, estimate_min: +$('#f-est').value || 30, priority: +$('#f-prio').value, claude_heavy: $('#f-heavy').checked, time: $('#f-time').value || null };
    if (!body.title) return;
    await (task ? api(`/api/tasks/${task.id}`, { method: 'PATCH', body }) : api('/api/tasks', { method: 'POST', body }));
    closeSheet(); refresh();
  };
  if (task) {
    $('#f-del').onclick = async () => { await api(`/api/tasks/${task.id}`, { method: 'DELETE' }); closeSheet(); refresh(); };
    $('#f-run').onclick = () => jobSheet(task.project, task);
    $('#f-focus').onclick = async () => { closeSheet(); await api('/api/focus', { method: 'POST', body: { minutes: 50, task: task.id } }); refresh(); };
  }
}

function jobSheet(projectId, task = null) {
  openSheet(`<h3>Nytt Claude-jobb</h3>
    <div class="field"><label>Projekt</label><select id="j-proj">${projOpts(projectId)}</select></div>
    <div class="field"><label>Vad ska göras</label><textarea id="j-ins" placeholder="Beskriv vad Claude Code ska göra…">${task ? esc(task.title) : ''}</textarea></div>
    <div class="field"><label>Bocka av när klart</label><select id="j-task"><option value="">Ingen</option>${S.tasks.filter(t => !t.done).map(t => `<option value="${t.id}" ${task?.id === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></div>
    <p class="dim" style="font-size:12px;margin:0 0 12px">Drar från Claude-veckobudgeten. HEIMDALL tar en checkpoint först så du kan ångra.</p>
    <div class="sheet-actions"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="j-go">Starta</button></div>`);
  $('#j-go').onclick = async () => {
    const instruction = $('#j-ins').value.trim(); if (!instruction) return;
    try {
      await api('/api/jobs', { method: 'POST', body: { project: $('#j-proj').value, instruction, taskId: $('#j-task').value || null } });
      closeSheet(); go('jobs'); refresh();
    } catch (e) { toast('Kunde inte starta', e.message, true); }
  };
}

function shiftSheet(date) {
  const cur = shiftOf(date);
  openSheet(`<h3>Skift ${esc(fmtDay(date))}</h3>
    <div class="field"><label>Skift</label><select id="s-code">
      <option value="">Automatiskt (rotationen)</option>
      ${Object.entries(S.shiftTypes).map(([k, v]) => `<option value="${k}" ${cur?.code === k ? 'selected' : ''}>${esc(v.name)}${v.start ? ` ${v.start}–${v.end}` : ''}</option>`).join('')}
    </select></div>
    <div class="sheet-actions"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="s-save">Spara</button></div>`);
  $('#s-save').onclick = async () => { await api('/api/shift', { method: 'POST', body: { date, code: $('#s-code').value || null } }); closeSheet(); refresh(); };
}

function budgetSheet() {
  openSheet(`<h3>Claude-veckobudget</h3>
    <p class="dim" style="font-size:13px;margin-top:0">Kolla procenten i Claude (Inställningar → Användning) och dra hit. HEIMDALL planerar Claude-tunga tasks efter den.</p>
    <div class="field"><label>Kvar: <span id="b-v">${S.settings.claudeBudgetLeft}</span>%</label>
    <input id="b-r" type="range" min="0" max="100" value="${S.settings.claudeBudgetLeft}"></div>
    <div class="sheet-actions"><button class="btn" data-close>Avbryt</button><button class="btn primary" id="b-save">Spara</button></div>`);
  $('#b-r').oninput = e => $('#b-v').textContent = e.target.value;
  $('#b-save').onclick = async () => { await api('/api/settings', { method: 'POST', body: { claudeBudgetLeft: +$('#b-r').value } }); closeSheet(); refresh(); };
}

// ---------- Bakgrund ----------
(function bg() {
  const c = $('#bg'), g = c.getContext('2d');
  let w, h, pts;
  const resize = () => {
    w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio;
    pts = Array.from({ length: Math.min(70, Math.floor(innerWidth / 18)) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .25 }));
  };
  resize(); addEventListener('resize', resize);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = () => {
    g.clearRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h * .3, 0, w / 2, h * .3, Math.max(w, h) * .7);
    grd.addColorStop(0, 'rgba(30,70,100,.28)'); grd.addColorStop(1, 'rgba(4,7,12,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const step = 46 * devicePixelRatio;
    g.strokeStyle = 'rgba(127,233,255,.035)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const max = 140 * devicePixelRatio;
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1;
      g.fillStyle = 'rgba(127,233,255,.5)'; g.fillRect(p.x, p.y, 1.6 * devicePixelRatio, 1.6 * devicePixelRatio);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.hypot(dx, dy);
      if (d < max) { g.strokeStyle = `rgba(127,233,255,${.12 * (1 - d / max)})`; g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); g.stroke(); }
    }
    if (!still) requestAnimationFrame(draw);
  };
  draw();
})();

// ---------- Klocka ----------
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }); }, 1000);
$('#clock').textContent = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
document.addEventListener('visibilitychange', () => { if (!document.hidden && token) refresh().catch(() => {}); });

(async () => {
  try { await refresh(); connect(); }
  catch (e) { if (e.message !== 'Fel kod') { toast('Ingen kontakt', 'Är HEIMDALL igång på datorn?', true); } }
  if (!S) showLock();
})();
