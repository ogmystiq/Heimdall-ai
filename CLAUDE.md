# HEIMDALL — instruktioner till Claude

HEIMDALL är ett personligt AI-system (en egen "Jarvis") med röst, schema, agenter och projektstyrning.
Du jobbar här när användaren ber om ändringar i HEIMDALL inifrån appen. Läs hela filen innan du börjar.

## Om användaren
- Är troligen ingen programmerare — förklara vad som ska klickas/skrivas, inte vad koden gör.
- Korta svar, ett steg i taget, rakt besked när något inte går (lova aldrig funktioner som inte funkar).
- Allt i appen ska vara på svenska.
- Ska vara GRATIS i grunden: Gemini (gratis) för småsaker/röst/agenter, Claude Code (användarens Claude-prenumeration) för tunga jobb.
- Användarens namn och beskrivning finns i `config.json` (`owner`, `about`).

## Hur HEIMDALL körs (två delar)
**Molnet (Render, gratis, alltid igång)** — startas med `cloud-start.js` (`MODE=cloud`). Här bor hjärnan: chatt, röstsamtal, schema, påminnelser, notiser, mejl, agenter, driftkoll, mål, pengar. Appen öppnas på Render-adressen.
- Render sparar inga filer: `lib/persist.js` hämtar `data/db.json` + `data/vapid.json` från grenen `data` i GitHub-repot vid start och sparar dit var 20:e sekund och vid avstängning. Misslyckas hämtningen stängs sparningen av så ingen data skrivs över.
- Render somnar efter 15 min utan besök — molnet pingar sig självt var 10:e min (`RENDER_EXTERNAL_URL`).
- Inställningar i Renders miljövariabler (se `render.yaml`): DATA_REPO, HEIMDALL_TOKEN, GEMINI_API_KEY, GITHUB_TOKEN, valfritt GEMINI_API_KEY_2, GROQ_API_KEY, N8N_URL, N8N_API_KEY och MAIL_<NAMN>. TZ=Europe/Stockholm.
- Molnet får `config.json`-inställningarna (namn, projekt, skift m.m.) från datorn när den ansluter, eller från appens inställningar (`/api/config`), och sparar dem i databasen.
- Uppdateras automatiskt när ny kod pushas till `main`.

**Datorn (Windows, HEIMDALL-mappen)** — `start.bat` → `launcher.js` → `server.js`. När `CLOUD_URL` finns i `.env` körs den i `pc`-läge: kopplar upp sig mot molnet via WebSocket (`lib/tunnel.js`, ut från datorn — inga portar öppnas) och sköter bara det som kräver datorn: Claude-jobb, datorstyrning, datoragent, video, Claude-reserven för hjärnan och auto-avbockning.
- Molnet skickar `/api/jobs*` och `/api/video*` vidare till datorn, och verktygen i `PC_TOOLS` (server.js) går till datorns `/api/tool/:namn`.
- Datorn skickar tillbaka händelser (`broadcast` → `tunnel.sendEvent`), molnet gör notiser av dem.
- Första gången datorn ansluter flyttas dess gamla data till molnet (`mergeFromPc`).
- `launcher.js` hämtar senaste versionen från GitHub (`main`) vid start. Finns opublicerade ändringar hoppar den över uppdateringen.
- Ändringar når användaren när hen trycker **Publicera** på jobbet: committar exakt de filer du ändrat, pushar till GitHub (då uppdateras molnet automatiskt) och startar om datorns HEIMDALL.
- Utan `CLOUD_URL` körs allt på datorn som förr (`local`-läge).

## Hårda regler
- Rör ALDRIG `.env` (API-nycklar, mejllösenord), `config.json` (användarens inställningar) eller `data/` (tasks, chatt, mål m.m.).
- Committa eller pusha aldrig själv — det görs med Publicera-knappen.
- Använd aldrig `git add -A` / `git add .`.
- Inga nya beroenden i onödan. Allt ska funka på Windows + Node 24.
- Testa det du ändrat (minst `node --check` på ändrade filer). Krascha aldrig servern — fånga fel.
- Tänk på båda lägena: ny funktion som behöver datorn (filer, program, Claude Code) ska läggas i `PC_TOOLS` eller under `/api/jobs`/`/api/video` så molnet skickar den vidare.
- Behåll designen: mörk HUD-stil, färgtokens i `public/style.css` (`--accent` #7fe9ff, `--accent2` #a77bff, `--hot`, `--ok`), typsnitt Chakra Petch + IBM Plex Mono, mobil först.

## Filer
- `server.js` — HTTP-server, API, systemprompt till Gemini, verktygshanterare (`handlers`), schemaläggning, SSE (`/api/events`).
- `lib/brain.js` — Gemini: chatt med verktyg (`TOOLS`), `ask()` (enkel fråga, JSON-läge), `search()` (Google-sökning). Byter automatiskt mellan gratismodeller när en kvot tar slut.
- `lib/live.js` — röstsamtal i realtid via Gemini Live (WebSocket-proxy, verktyg körs på servern, `sayToAll()` låter HEIMDALL säga saker själv).
- `lib/claude.js` — kör Claude Code (`claude -p`) i projektmappar, checkpoint/ångra, publicera, fortsätt konversation (`--resume`).
- `lib/agent.js` — datoragent (skärmdump → Gemini → mus/tangentbord via PowerShell).
- `lib/pc.js` — enkla datorkommandon (öppna program/sidor, media, lås m.m.).
- `lib/agents.js` — agenter: Veckorapport, Pengajakten, Idéer, Mejlsvar (svarsförslag för inkorgar med filtret `svar`). Körs i molnet. Gemini först (alla nycklar GEMINI_API_KEY, GEMINI_API_KEY_2 …), sen Groq (`lib/groq.js`, GROQ_API_KEY, i molnet), sen Claude via datorn; annars nytt försök om 90 min.
- `lib/macros.js` — egna kommandon (`settings.macros`): skapas med AI en gång, körs sen direkt utan AI (snabbknappar i Kärnan).
- `lib/n8n.js` — n8n-flöden via n8n API (N8N_URL, N8N_API_KEY): status, starta/pausa.
- Nya projekt från Pengapotten ("Bygg det") byggs av Claude i `~/heimdall-projekt/<namn>` på datorn (`startBuild` i server.js, projekt-id `ny:<namn>`).
- `lib/pot.js` — Pengapotten: budget, förslag från Pengajakten som användaren godkänner (blir task), resultat loggas som pengar. Inget spenderas automatiskt.
- `lib/mail.js` — mejlkoll via IMAP (konton i `MAIL_<NAMN>=server|adress|app-lösenord|993|filter`), bara läsning. Automatiska mejl (noreply, DMARC, nyhetsbrev) filtreras bort utan AI-fråga.
- `lib/video.js` — videoprojekt (`~/heimdall-video`), uppladdning, captions via Gemini, redigering/trailers via Claude + FFmpeg.
- `lib/scheduler.js` — varje minut: påminnelser, morgon-/kvällsbrief, driftkoll, fokusläge, agentschema.
- `lib/push.js` — web push till telefonen. `lib/autocheck.js` + `hooks/claude-stop.js` — auto-avbockning från Claude Code.
- `lib/mode.js` — vilket läge (cloud/pc/local). `lib/tunnel.js` — tunneln moln↔dator. `lib/persist.js` + `cloud-start.js` + `render.yaml` — molnet.
- `lib/shifts.js` — skiftrotation (från `config.json`, valfri). `lib/tv.js` — Google TV via ADB. `setup.js` — frågor första gången (skriver `.env` + `config.json`). `lib/db.js` — JSON-databas i `data/db.json`.
- `public/` — appen (PWA): `index.html`, `style.css`, `app.js`, `sw.js`. Flikar: Kärna, Schema, Projekt, Agenter, Video, Jobb (svep åt sidan byter flik på mobil). Kärnan har statuskort (skift/idag/system) och snabbknappar (`QUICK` i app.js, kan ersättas av `settings.quick` = [[etikett, kommando], …]). Schemat har 14-dagarsremsa och en 24h-stapel per dag med skift + tasks.

## Lägga till en ny förmåga
1. Lägg till verktyget i `TOOLS` i `lib/brain.js` (namn, svensk beskrivning, parametrar).
2. Lägg till hanteraren i `handlers` i `server.js`.
3. Lägg gärna till en svensk etikett i `ACT` i `public/app.js` så det syns i chatten.
4. Behövs regler för när den ska användas: lägg en rad i systemprompten (`systemPrompt()` i `server.js`).
Röstsamtalen får automatiskt samma verktyg.

## Kända problem
- Röstsamtalet: ibland svarar Google inte. Loggen skriver "Samtal: skickat X ljudbitar, Google svarat Y gånger" var 10:e sekund — använd det för att felsöka.
- Gemini gratis-kvot tar slut vid tung användning (särskilt datoragenten). Kvoten nollställs ca 09:00 svensk tid. Fler nycklar (GEMINI_API_KEY_2) och Groq hjälper.
