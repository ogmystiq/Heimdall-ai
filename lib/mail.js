// Mejlkoll: tittar efter nya mejl var 2:a minut och skickar en notis med en kort sammanfattning.
// Läser bara — markerar inget som läst, raderar inget, skickar inget.
// Konton i .env, ett per rad:  MAIL_FORETAGET=imap.gmail.com|du@gmail.com|app-lösenord|993|filter
// filter: tom = notis för mejl från riktiga människor, "tips" = bara tips och förfrågningar från folk,
// "svar" = som tom + agenten Mejlsvar skriver ett svarsförslag på varje mejl. Flera går att kombinera: "tips,svar"
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { db, save } = require('./db');
const brain = require('./brain');

// Automatiska mejl (DMARC-rapporter, noreply, nyhetsbrev, studsar) — visas aldrig och kostar ingen AI-fråga
const AUTO_ADDR = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|newsletter|nyhetsbrev|dmarc|alerts?|reports?|automated|system)([._+-]|@)/i;
const AUTO_SUBJ = /^(report domain:|dmarc|delivery status|undeliverable|mail delivery|returned mail|out of office|automatiskt svar|autosvar)/i;
const isAutomated = (addr, subject, h = {}) => AUTO_ADDR.test(addr || '') || AUTO_SUBJ.test(subject || '') ||
  !!h.listUnsub || (h.autoSubmitted && !/^no$/i.test(h.autoSubmitted)) || /bulk|list|junk/i.test(h.precedence || '');

function accounts() {
  return Object.entries(process.env)
    .filter(([k, v]) => k.startsWith('MAIL_') && v.includes('|'))
    .map(([k, v]) => {
      const [host, user, pass, port, filter] = v.split('|').map(s => s.trim());
      const name = k.slice(5).toLowerCase();
      const pretty = name.charAt(0).toUpperCase() + name.slice(1);
      const f = (filter || '').toLowerCase();
      return { id: name, name: pretty, host, user, pass, port: Number(port) || 993, filter: f.includes('tips') ? 'tips' : '', replies: f.includes('svar') };
    });
}

async function checkAccount(acc, notify, onMail) {
  db.mailState = db.mailState || {};
  db.mails = db.mails || [];
  const st = db.mailState[acc.id] || {};
  const client = new ImapFlow({ host: acc.host, port: acc.port, secure: true, auth: { user: acc.user, pass: acc.pass }, logger: false });
  client.on('error', () => {}); // fel hanteras nedan — får aldrig krascha HEIMDALL
  await client.connect();
  try {
    const box = await client.mailboxOpen('INBOX', { readOnly: true });
    const top = box.uidNext - 1;
    if (st.lastUid == null || st.validity !== String(box.uidValidity)) {
      // Första gången: börja från nu, notifiera inte om gamla mejl
      db.mailState[acc.id] = { lastUid: top, validity: String(box.uidValidity), ok: true, checked: new Date().toISOString() };
      save();
      return [];
    }
    const fresh = [];
    if (top > st.lastUid) {
      for await (const msg of client.fetch(`${st.lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= st.lastUid) continue;
        const m = await simpleParser(msg.source);
        fresh.push({
          uid: msg.uid,
          from: m.from?.value?.[0]?.name || m.from?.value?.[0]?.address || 'okänd',
          fromAddr: m.from?.value?.[0]?.address || '',
          subject: m.subject || '(inget ämne)',
          text: (m.text || '').replace(/\n>.*$/gs, '').replace(/\s+/g, ' ').slice(0, 1500),
          date: (m.date || new Date()).toISOString(),
          isReply: /^(re|sv|aw)\s*:/i.test(m.subject || '') || !!m.inReplyTo,
          auto: isAutomated(m.from?.value?.[0]?.address, m.subject, {
            listUnsub: m.headers?.get('list-unsubscribe'), autoSubmitted: String(m.headers?.get('auto-submitted') || ''), precedence: String(m.headers?.get('precedence') || ''),
          }),
        });
      }
    }
    st.lastUid = Math.max(st.lastUid, top);
    st.ok = true; st.error = null; st.checked = new Date().toISOString();
    db.mailState[acc.id] = st;

    for (const f of fresh.slice(-10)) {
      // Samma mejl två gånger (t.ex. efter flytten till molnet) — hoppa över
      if (db.mails.some(x => x.account === acc.name && x.fromAddr === f.fromAddr && x.subject === f.subject && x.date === f.date)) continue;
      if (f.auto) { db.mails.unshift({ id: `${acc.id}-${f.uid}`, account: acc.name, from: f.from, fromAddr: f.fromAddr, subject: f.subject, summary: f.subject, date: f.date, notified: false, auto: true }); continue; }
      const rule = acc.filter === 'tips'
        ? 'notify = true BARA om en riktig person skickar ett tips eller en förfrågan: eventtips, låt-/releasetips, rättelser, frågor eller förslag om sajten. Allt annat (nyhetsbrev, reklam, kvitton, notiser från tjänster, automatiska mejl, spam) = false.'
        : 'notify = true om det är skrivet av en riktig människa (t.ex. svar från en kund eller förfrågan). Nyhetsbrev, reklam, kvitton, automatiska notiser och spam = false.';
      let out = null;
      try {
        out = await brain.ask(`Ett mejl kom till ${acc.name}-inkorgen.
Från: ${f.from} <${f.fromAddr}>
Ämne: ${f.subject}
${f.text}

Svara med JSON: {"summary": "EN kort mening på svenska, max 15 ord, om vad avsändaren vill", "notify": true/false}
${rule}`, true);
      } catch {}
      const summary = String(out?.summary || f.subject).slice(0, 200);
      const wanted = out ? out.notify !== false : true;
      const item = { id: `${acc.id}-${f.uid}`, account: acc.name, from: f.from, fromAddr: f.fromAddr, subject: f.subject, summary, text: f.text, date: f.date, isReply: f.isReply, notified: wanted };
      db.mails.unshift(item);
      if (wanted) { notify(`${acc.name}: ${f.isReply ? 'svar' : acc.filter === 'tips' ? 'tips' : 'mejl'} från ${f.from}`, summary); onMail?.(item, acc); }
    }
    db.mails = db.mails.slice(0, 100);
    save();
    return fresh;
  } finally {
    await client.logout().catch(() => {});
  }
}

function start(notify, onMail) {
  const list = accounts();
  if (!list.length) return;
  console.log('Mejlkoll på för:', list.map(a => a.name).join(', '));
  const tick = async () => {
    for (const acc of accounts()) {
      try { await checkAccount(acc, notify, onMail); }
      catch (e) {
        db.mailState = db.mailState || {};
        const st = db.mailState[acc.id] || {};
        let msg = e.authenticationFailed ? 'Fel lösenord eller IMAP avstängt' : (e.responseText || e.message || 'okänt fel');
        if (/zoho/i.test(acc.host) && !/imappro/i.test(acc.host) && /close|connection/i.test(msg)) msg += ' — Zoho med egen domän ska ha imappro.zoho.eu som server';
        if (st.error !== msg) console.log(`Mejl ${acc.name}:`, msg);
        db.mailState[acc.id] = { ...st, ok: false, error: msg, checked: new Date().toISOString() };
        save();
      }
    }
  };
  tick();
  setInterval(tick, 2 * 60000);
}

const recent = (n = 10, all = false) => (db.mails || []).filter(x => all || (x.notified !== false && !isAutomated(x.fromAddr, x.subject))).slice(0, n);
const status = () => accounts().map(a => ({ name: a.name, user: a.user, ...(db.mailState?.[a.id] || {}) }));

module.exports = { start, recent, status, isAutomated };
