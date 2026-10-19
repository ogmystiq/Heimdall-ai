// Push-notiser till telefonen och datorn, även när appen är stängd.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { db, save } = require('./db');

const KEYS = path.join(__dirname, '..', 'data', 'vapid.json');
let keys;
if (fs.existsSync(KEYS)) keys = JSON.parse(fs.readFileSync(KEYS, 'utf8'));
else {
  keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(KEYS), { recursive: true });
  fs.writeFileSync(KEYS, JSON.stringify(keys));
}
webpush.setVapidDetails(`mailto:${process.env.VAPID_EMAIL || 'heimdall@example.com'}`, keys.publicKey, keys.privateKey);
if (!db.pushSubs) db.pushSubs = [];

const publicKey = () => keys.publicKey;

function subscribe(sub) {
  if (!sub?.endpoint) throw new Error('Ogiltig prenumeration');
  db.pushSubs = db.pushSubs.filter(s => s.endpoint !== sub.endpoint);
  db.pushSubs.push(sub);
  save();
}

async function send(title, body = '', url = '/') {
  if (require('./mode').isPc()) return 0; // på datorn i molnläge skickar molnet notiserna
  const payload = JSON.stringify({ title, body, url });
  const dead = [];
  await Promise.all(db.pushSubs.map(s =>
    webpush.sendNotification(s, payload, { TTL: 3600 }).catch(e => {
      if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint);
      else console.log('Push misslyckades:', e.statusCode || e.message);
    })));
  if (dead.length) { db.pushSubs = db.pushSubs.filter(s => !dead.includes(s.endpoint)); save(); }
  return db.pushSubs.length;
}

module.exports = { publicKey, subscribe, send };
