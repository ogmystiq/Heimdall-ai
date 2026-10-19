// Startpunkt i molnet (Render): hämta din data från GitHub först, starta sen HEIMDALL.
process.env.MODE = 'cloud';
const persist = require('./lib/persist');

persist.restore().then(() => {
  require('./server.js');
  persist.start();
}).catch(e => {
  console.log('Start misslyckades:', e.message);
  process.exit(1);
});
