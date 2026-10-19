// Räknar ut dina skift från rotationen i config.json + manuella ändringar.
const { db, save } = require('./db');

let cfg = { cycleStart: '2026-10-19', pattern: [], types: {} };
function setConfig(c) { if (c) cfg = c; }

function dayDiff(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}

function shiftFor(date) {
  if (db.shiftOverrides[date]) return db.shiftOverrides[date];
  if (!cfg.pattern || !cfg.pattern.length) return '?';
  const n = cfg.pattern.length;
  const i = ((dayDiff(cfg.cycleStart, date) % n) + n) % n;
  return cfg.pattern[i];
}

function info(code) {
  return { code, ...(cfg.types[code] || { name: code === '?' ? 'Okänt' : code }) };
}

function range(from, days = 7) {
  const out = [];
  const d = new Date(from + 'T12:00:00');
  for (let i = 0; i < days; i++) {
    const s = d.toLocaleDateString('sv-SE');
    out.push({ date: s, weekday: d.toLocaleDateString('sv-SE', { weekday: 'short' }), ...info(shiftFor(s)) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function setShift(date, code) {
  if (code === null || code === 'auto') delete db.shiftOverrides[date];
  else db.shiftOverrides[date] = code;
  save();
}

module.exports = { setConfig, shiftFor, range, setShift, info };
