// Realtidsröst med Gemini Live. Appen skickar mikrofonljud hit, servern skickar vidare till Google
// och utför verktygen (tasks, skift, Claude-jobb) här på datorn. Nyckeln lämnar aldrig datorn.
const WebSocket = require('ws');
const { db, save } = require('./db');
const { TOOLS } = require('./brain');
const active = require('./activemodel');

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

let cachedModel = null, cachedList = null;
// Alla modeller som klarar realtidsröst, bästa först
async function listLive() {
  if (cachedList) return cachedList;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${process.env.GEMINI_API_KEY}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'Kunde inte hämta modellistan');
  const live = (json.models || []).filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent')).map(m => m.name.replace(/^models\//, ''));
  if (!live.length) throw new Error('Google har ingen realtidsmodell för ditt konto');
  const score = n => (/native-audio|live/.test(n) ? 10 : 0) + (/preview|exp/.test(n) ? -1 : 0) + (/flash/.test(n) ? 2 : 0) + (/lite/.test(n) ? -3 : 0)
    + (parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0);
  cachedList = live.sort((a, b) => score(b) - score(a));
  console.log('Realtidsmodeller:', cachedList.join(', '));
  return cachedList;
}
async function liveModel() {
  if (process.env.GEMINI_LIVE_MODEL) return process.env.GEMINI_LIVE_MODEL;
  if (db.settings.liveModel) return db.settings.liveModel;
  if (!cachedModel) cachedModel = (await listLive())[0];
  return cachedModel;
}

const sessions = new Set(); // pågående samtal, så HEIMDALL kan säga saker självmant
function sayToAll(text) {
  for (const s of sessions) { try { s.send(JSON.stringify({ realtimeInput: { text: `[Systemmeddelande, berätta kort för användaren] ${text}` } })); } catch {} }
  return sessions.size;
}

function attach(client, { systemPrompt, handlers, onTurn, onAction }) {
  let upstream = null;
  let userText = '', modelText = '', actions = [];
  const sendClient = obj => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(obj)); };

  (async () => {
    let model;
    try { model = await liveModel(); }
    catch (e) { sendClient({ type: 'error', message: e.message }); return client.close(); }

    upstream = new WebSocket(`${process.env.GEMINI_LIVE_URL || WS_URL}?key=${process.env.GEMINI_API_KEY}`);

    upstream.on('open', () => {
      upstream.send(JSON.stringify({
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            thinkingConfig: { thinkingBudget: 0 }, // inget tänkande = snabbare svar
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: db.settings.voice || process.env.GEMINI_VOICE || 'Achird' } },
            },
          },
          systemInstruction: { parts: [{ text: systemPrompt() +
            '\n\nDu är i ett röstsamtal i realtid. Svara direkt och kort, som i ett vanligt samtal. Prata alltid svenska. ' +
            'Låt som en riktig människa: naturlig svensk rytm och intonation, avslappnad och varm ton, korta meningar, små naturliga pauser och ibland ett "mm" eller "okej" — aldrig stel eller uppläst.' }] },
          tools: [{ functionDeclarations: TOOLS }],
          realtimeInputConfig: {
            automaticActivityDetection: {
              startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', // hör inte sin egen röst i högtalaren
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 300, // klipper inte bort början av det du säger
              silenceDurationMs: 400, // svara efter 0,4 s tystnad
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
    });

    upstream.on('message', async raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      stats.outMsgs++;
      if (msg.serverContent?.inputTranscription) stats.heard++;
      if (msg.serverContent?.modelTurn) stats.audioOut++;

      if (msg.setupComplete) { active.set('Gemini Live', model); sessions.add(upstream); return sendClient({ type: 'ready', model }); }

      if (msg.toolCall) {
        const responses = [];
        for (const fc of msg.toolCall.functionCalls || []) {
          let result;
          try { result = handlers[fc.name] ? await handlers[fc.name](fc.args || {}) : { error: 'okänt verktyg' }; }
          catch (e) { result = { error: e.message }; }
          const a = { tool: fc.name, args: fc.args, ok: !result?.error };
          actions.push(a);
          sendClient({ type: 'action', action: a });
          onAction?.();
          responses.push({ id: fc.id, name: fc.name, response: { result } });
        }
        upstream.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
        return;
      }

      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.inputTranscription?.text) { userText += sc.inputTranscription.text; sendClient({ type: 'you', text: sc.inputTranscription.text }); }
      if (sc.outputTranscription?.text) { modelText += sc.outputTranscription.text; sendClient({ type: 'me', text: sc.outputTranscription.text }); }
      for (const p of sc.modelTurn?.parts || []) {
        if (p.inlineData?.data) sendClient({ type: 'audio', data: p.inlineData.data, mime: p.inlineData.mimeType });
      }
      if (sc.interrupted) sendClient({ type: 'interrupted' });
      if (sc.turnComplete) {
        sendClient({ type: 'turn' });
        if (userText.trim() || modelText.trim()) onTurn?.(userText.trim(), modelText.trim(), actions);
        userText = ''; modelText = ''; actions = [];
      }
    });

    upstream.on('close', (code, reason) => {
      sessions.delete(upstream);
      const r = reason?.toString() || '';
      console.log(`Samtal stängt av Google: kod ${code}${r ? ' — ' + r : ''}`);
      if (code !== 1000) sendClient({ type: 'error', message: r || `Google stängde samtalet (kod ${code})` });
      if (/voice/i.test(r) && db.settings.voice) { delete db.settings.voice; save(); }
      if (/model/i.test(r)) { cachedModel = null; delete db.settings.liveModel; save(); }
      client.close();
    });
    upstream.on('error', e => { console.log('Samtalsfel:', e.message); sendClient({ type: 'error', message: e.message }); });
  })();

  // Kontrollrad i det svarta fönstret var 10:e sekund under samtal
  const stats = { in: 0, outMsgs: 0, heard: 0, audioOut: 0 };
  const statTimer = setInterval(() => {
    console.log(`Samtal: skickat ${stats.in} ljudbitar, Google svarat ${stats.outMsgs} gånger (hörde dig ${stats.heard}, ljud tillbaka ${stats.audioOut})`);
  }, 10000);
  client.on('close', () => clearInterval(statTimer));
  client.on('message', raw => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
    stats.in++;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'audio') upstream.send(JSON.stringify({ realtimeInput: { audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } } }));
    if (msg.type === 'text') upstream.send(JSON.stringify({ realtimeInput: { text: msg.text } }));
  });
  client.on('close', () => { try { upstream?.close(); } catch {} });
}

module.exports = { attach, liveModel, listLive, sayToAll };
