// Vilket läge HEIMDALL körs i:
//  cloud = i molnet (Render): hjärnan, schema, samtal, mejl, agenter, notiser. Alltid igång.
//  pc    = på datorn med CLOUD_URL satt: kopplar upp sig mot molnet och sköter Claude-jobb, datorstyrning och video.
//  local = allt på datorn som förut (ingen molnserver).
const mode = () => {
  const m = String(process.env.MODE || '').toLowerCase();
  if (m === 'cloud') return 'cloud';
  if (process.env.CLOUD_URL) return 'pc';
  return 'local';
};

module.exports = {
  mode,
  isCloud: () => mode() === 'cloud',
  isPc: () => mode() === 'pc',
  cloudUrl: () => String(process.env.CLOUD_URL || '').replace(/\/$/, ''),
};
