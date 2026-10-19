// Reserv i molnet när Geminis gratiskvot är slut: Groq (gratis nyckel från console.groq.com).
// Funkar utan att datorn är igång. web=true låter modellen söka på nätet (browser_search).
const API = 'https://api.groq.com/openai/v1/chat/completions';
const has = () => !!process.env.GROQ_API_KEY;

async function ask(prompt, { web = false } = {}) {
  if (!has()) throw new Error('GROQ_API_KEY saknas');
  const body = {
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    ...(web ? { tools: [{ type: 'browser_search' }], tool_choice: 'auto' } : {}),
  };
  const r = await fetch(API, {
    method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || `Groq-fel ${r.status}`;
    // Sökning inte tillgänglig för kontot: försök utan sökning hellre än inget
    if (web && (r.status === 400 || r.status === 403) && /browser|tool|search/i.test(msg)) return ask(prompt, { web: false });
    throw Object.assign(new Error(msg), { quota: r.status === 429 });
  }
  return (j.choices?.[0]?.message?.content || '').trim();
}

module.exports = { ask, has };
