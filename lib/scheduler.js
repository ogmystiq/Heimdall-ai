// Körs varje minut: påminnelser, morgonbrief, kvällssammanfattning och driftkoll.
const { db, save, today } = require('./db');
const push = require('./push');

const hm = d => d.toTimeString().slice(0, 5);
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };

function start({ shifts, brief, monitors, broadcast, onTick }) {
  if (!db.sent) db.sent = {};
  if (!db.monitor) db.monitor = {};

  const notify = (title, body, key, important = false) => {
    if (key) { if (db.sent[key]) return; db.sent[key] = Date.now(); save(); }
    if (!important && db.focus && db.focus.until > Date.now()) return; // fokusläge: bara viktigt
    push.send(title, body).catch(() => {});
    broadcast('notify', { title, body });
  };

  async function tick() {
    const now = new Date();
    const t = today();
    const time = hm(now);
    const s = db.settings;

    try { onTick?.(now); } catch (e) { console.log('onTick:', e.message); }

    // Påminnelser för tasks med klockslag
    for (const task of db.tasks) {
      if (task.done || task.date !== t || !task.time) continue;
      const [h, m] = task.time.split(':').map(Number);
      const due = new Date(now); due.setHours(h, m, 0, 0);
      const mins = Math.round((due - now) / 60000);
      const lead = task.remindBefore ?? 15;
      if (mins <= lead && mins > lead - 2) notify(`Om ${lead} min: ${task.title}`, task.project, `r-${task.id}-${t}`);
      if (mins <= 0 && mins > -2) notify(`Nu: ${task.title}`, task.project, `n-${task.id}-${t}`, true);
    }

    // Fokusläget slut
    if (db.focus && db.focus.until <= Date.now()) {
      const f = db.focus; db.focus = null; save();
      notify('Fokuspasset är slut', f.task ? `Hur gick det med: ${f.task}?` : 'Bra jobbat.', null, true);
      broadcast('state');
    }

    // Morgonbrief
    if (s.morningOn !== false && time === (s.morningTime || '09:00')) {
      try { notify('God morgon', await brief('morgon'), `brief-${t}`); } catch (e) { console.log('Brief:', e.message); }
    }
    // Kvällssammanfattning
    if (s.eveningOn !== false && time === (s.eveningTime || '21:30')) {
      try { notify('Dagens summering', await brief('kväll'), `kvall-${t}`); } catch (e) { console.log('Kväll:', e.message); }
    }

    // Driftkoll var 5:e minut
    if (now.getMinutes() % 5 === 0) {
      for (const m of monitors()) {
        let up = false;
        try {
          const r = await fetch(m.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15000) });
          up = r.status < 500;
        } catch {}
        const st = db.monitor[m.url] || { up: true, fails: 0 };
        st.fails = up ? 0 : st.fails + 1;
        st.checked = now.toISOString();
        if (st.up && st.fails >= 2) { st.up = false; notify(`${m.name} ligger nere`, m.url, null, true); }
        if (!st.up && up) { st.up = true; notify(`${m.name} är uppe igen`, m.url); }
        db.monitor[m.url] = st;
      }
      save();
      broadcast('state');
    }

    // Städa gamla "skickat"-markeringar
    if (time === '03:00') {
      const weekAgo = Date.now() - 7 * 86400000;
      for (const k of Object.keys(db.sent)) if (db.sent[k] < weekAgo) delete db.sent[k];
      save();
    }
  }

  // Kör strax efter varje hel minut
  const loop = () => { tick().catch(e => console.log('Schemaläggare:', e.message)); setTimeout(loop, 60000 - (Date.now() % 60000) + 500); };
  setTimeout(loop, 60000 - (Date.now() % 60000) + 500);
}

module.exports = { start, addDays };
