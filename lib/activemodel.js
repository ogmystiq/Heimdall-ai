// Håller reda på vilken AI-modell som senast faktiskt svarade (visas under kärnan).
const { EventEmitter } = require('events');
const bus = new EventEmitter();
let current = null; // { provider, model, at }

function set(provider, model) {
  if (!model) return;
  if (current && current.provider === provider && current.model === model) { current.at = Date.now(); return; }
  current = { provider, model, at: Date.now() };
  bus.emit('change', current);
}
const get = () => current;

module.exports = { bus, set, get };
