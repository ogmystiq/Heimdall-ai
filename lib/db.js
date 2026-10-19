// Enkel JSON-databas. Allt sparas i data/db.json på din dator.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');

const empty = () => ({
  tasks: [],
  ideas: [],
  shiftOverrides: {}, // { "2026-10-20": "N" }
  jobs: [],
  chat: [],
  settings: { claudeBudgetLeft: 100 },
});

let db = empty();
try {
  if (fs.existsSync(FILE)) db = { ...empty(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch (e) {
  console.error('Kunde inte läsa db.json, startar tomt:', e.message);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, FILE);
  }, 150);
}

const id = () => Math.random().toString(36).slice(2, 8);
const today = () => new Date().toLocaleDateString('sv-SE');

function addTask({ title, project = 'Övrigt', date = null, estimate_min = 30, claude_heavy = false, priority = 2, time = null, remindBefore }) {
  const t = {
    id: id(), title, project, date: date || today(), estimate_min, claude_heavy, priority, time: time || null,
    ...(remindBefore != null ? { remindBefore } : {}),
    done: false, created: new Date().toISOString(), doneAt: null,
  };
  db.tasks.push(t);
  save();
  return t;
}

function findTask(idOrTitle) {
  if (!idOrTitle) return null;
  const s = String(idOrTitle).toLowerCase();
  return db.tasks.find(t => t.id === idOrTitle) ||
    db.tasks.find(t => !t.done && t.title.toLowerCase().includes(s));
}

function completeTask(idOrTitle, how = 'manuellt') {
  const t = findTask(idOrTitle);
  if (!t) return null;
  t.done = true; t.doneAt = new Date().toISOString(); t.doneHow = how;
  save();
  return t;
}

function updateTask(idOrTitle, patch) {
  const t = findTask(idOrTitle);
  if (!t) return null;
  Object.assign(t, patch);
  save();
  return t;
}

function deleteTask(idOrTitle) {
  const t = findTask(idOrTitle);
  if (!t) return null;
  db.tasks = db.tasks.filter(x => x !== t);
  save();
  return t;
}

// Skriv direkt (används när HEIMDALL stängs, så inget hinner försvinna)
function saveNow() {
  clearTimeout(saveTimer);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}

module.exports = { db, save, saveNow, id, today, addTask, findTask, completeTask, updateTask, deleteTask };
