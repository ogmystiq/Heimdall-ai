# HEIMDALL — din egen Jarvis

HEIMDALL är ett personligt AI-system som du pratar med, på svenska. Det håller koll på ditt schema, påminner dig, bockar av uppgifter, styr din dator och TV, kollar dina mejl, har små AI-agenter som jobbar åt dig och kan låta Claude bygga och fixa saker i dina projekt. Allt i en app på mobilen och datorn, med en mörk "HUD"-design.

Den här guiden förutsätter **inte** att du kan programmera eller har använt AI förut. Följ stegen i ordning, ett i taget. Det tar ungefär **30–60 minuter** första gången.

---

## Innehåll

1. [Vad HEIMDALL kan](#1-vad-heimdall-kan)
2. [Vad det kostar](#2-vad-det-kostar)
3. [Ord som används i guiden](#3-ord-som-används-i-guiden)
4. [Del A — Kom igång på datorn](#del-a--kom-igång-på-datorn-obligatoriskt)
5. [Del B — Claude Code (låt AI:n bygga i dina projekt)](#del-b--claude-code-valfritt)
6. [Del C — Molnet: HEIMDALL dygnet runt + mobilen](#del-c--molnet-heimdall-dygnet-runt--på-mobilen)
7. [Del D — Extra funktioner](#del-d--extra-funktioner-valfritt)
8. [Så använder du HEIMDALL](#så-använder-du-heimdall)
9. [Felsökning](#felsökning)
10. [Säkerhet — läs det här](#säkerhet--läs-det-här)

---

## 1. Vad HEIMDALL kan

- **Prata eller skriva** — "påminn mig att ringa mamma kl 18", "vad har jag för dag idag?", "planera min vecka". HEIMDALL lägger in, flyttar och bockar av uppgifter själv.
- **Röstsamtal i realtid** — tryck på mikrofonen och prata som med en människa.
- **Schema** — dina uppgifter per dag, och ditt **skiftschema** om du jobbar skift. Påminnelser som notiser på mobilen. Morgonbrief och kvällssummering.
- **Mål och pengar** — sätt mål med deadline, logga inkomster, sätt ett inkomstmål per månad.
- **Agenter** som jobbar själva:
  - **Pengajakten** — letar sätt att tjäna pengar och nya projektidéer åt dig. Du godkänner allt själv, inget köps automatiskt (**Pengapotten**).
  - **Idéer** — trender och idéer för dina projekt.
  - **Mejlsvar** — skriver svarsförslag när någon mejlar dig.
  - **Veckorapport** — varje söndag: vad du fått klart, pengar och veckans viktigaste sak.
- **Mejlkoll** — notis när en riktig människa mejlar (reklam och automatmejl filtreras bort).
- **Claude-jobb** — be HEIMDALL fixa något i en hemsida eller ett kodprojekt. Claude Code gör jobbet på din dator, du ser allt som en chatt och trycker **Publicera** när du är nöjd. Allt går att ångra.
- **Styra datorn** — öppna program och sidor, musik, låsa skärmen, och en datoragent som kan klicka och skriva själv.
- **Styra TV:n** (Google TV / Android TV) — slå på, volym, öppna appar, spela en viss låt på Spotify.
- **Egna kommandon** — säg "skapa kommandot Godnatt: stäng av TV:n och lås datorn". Sen räcker det att säga "Godnatt".
- **Video** — ladda upp klipp och be Claude klippa ihop, lägga på text och göra trailers.
- **n8n** — om du använder n8n-automationer: se status och starta/pausa dem med rösten.

> HEIMDALL kan inte allt helt felfritt — det är ett hobbyprojekt. Röstsamtal och datoragenten beror på Googles gratis-AI, som ibland är överbelastad eller har slut på dagens gratiskvot.

---

## 2. Vad det kostar

| Del | Kostnad | Behövs? |
|---|---|---|
| Gemini (Googles AI — hjärnan, rösten, agenterna) | **Gratis** (med dagliga gränser) | Ja |
| GitHub (där koden och din data sparas) | **Gratis** | Ja för molnet |
| Render (servern som gör att HEIMDALL är igång dygnet runt) | **Gratis** | Ja för mobilen/molnet |
| Groq (reserv-AI när Gemini tar slut) | **Gratis** | Valfritt |
| Claude Code (AI:n som bygger och fixar i dina projekt) | Kräver **betald Claude-prenumeration** (Pro eller högre) | Valfritt |
| n8n | Det du redan betalar, om du har det | Valfritt |

Du kan alltså köra allt utom Claude-jobben helt gratis.

---

## 3. Ord som används i guiden

- **PowerShell** — ett fönster där du skriver kommandon. Öppna det så här: tryck på **Windows-knappen**, skriv `powershell`, tryck **Enter**. Ett blått eller svart fönster öppnas.
- **Klistra in i PowerShell** — kopiera texten här, klicka i PowerShell-fönstret och **högerklicka** (det klistrar in). Tryck sen **Enter**.
- **Mappen** — HEIMDALL-mappen på din dator, t.ex. `C:\Users\DittNamn\heimdall`.
- **Repo** — en mapp med kod som ligger på GitHub.
- **Nyckel / API-nyckel** — en lång kod som ger HEIMDALL tillgång till en tjänst (t.ex. Googles AI). **Hemlig — dela den aldrig.**
- **Svarta fönstret** — fönstret som öppnas när HEIMDALL körs på datorn. Låt det vara öppet så länge du vill att datordelen ska vara igång.

---

## Del A — Kom igång på datorn (obligatoriskt)

Du behöver en **Windows 10- eller 11-dator**.

### A1. Installera Node.js

Node.js är programmet som HEIMDALL körs med.

1. Gå till **https://nodejs.org**
2. Klicka på den gröna knappen där det står **LTS**.
3. Öppna filen som laddas ner och klicka **Next** på allt (standardval är bra) och sen **Install** och **Finish**.

### A2. Installera Git

Git används för att ladda ner och uppdatera HEIMDALL.

1. Gå till **https://git-scm.com/downloads/win**
2. Klicka på **Click here to download**.
3. Öppna filen och klicka **Next** på allt (standardval är bra), sen **Install** och **Finish**.

**Kolla att båda funkar:** öppna PowerShell (se [ordlistan](#3-ord-som-används-i-guiden)) och klistra in:

```
node --version; git --version
```

Du ska se två rader med versionsnummer, t.ex. `v22.11.0` och `git version 2.47.0`. Står det "känns inte igen" — starta om datorn och försök igen.

### A3. Skaffa ett GitHub-konto

1. Gå till **https://github.com/signup** och skapa ett gratis konto.
2. Kom ihåg ditt **användarnamn** — det behövs senare.

### A4. Gör en egen kopia av HEIMDALL

Du gör en egen, **privat** kopia så att dina inställningar och din data bara är dina.

1. Gå till HEIMDALL-sidan på GitHub: **https://github.com/ogmystiq/heimdall-ai**
2. Klicka på den gröna knappen **Use this template** → **Create a new repository**.
3. Under **Repository name** skriv: `heimdall`
4. Välj **Private**.
5. Klicka **Create repository**.

Nu har du en egen kopia på `https://github.com/DITT-ANVÄNDARNAMN/heimdall`.

### A5. Ladda ner din kopia till datorn

Öppna PowerShell och klistra in (byt `DITT-ANVÄNDARNAMN` mot ditt GitHub-namn):

```
cd $HOME; git clone https://github.com/DITT-ANVÄNDARNAMN/heimdall.git
```

Första gången öppnas ett fönster där du loggar in på GitHub — gör det och klicka **Authorize**. När det är klart finns HEIMDALL i mappen `C:\Users\DittWindowsNamn\heimdall`.

### A6. Skaffa en gratis Gemini-nyckel (HEIMDALLs hjärna)

1. Gå till **https://aistudio.google.com/apikey** och logga in med ditt Google-konto.
2. Godkänn villkoren om du får frågan.
3. Klicka **Create API key** (välj "Create API key in new project" om du får välja).
4. Klicka på **kopiera**-ikonen bredvid nyckeln. Den börjar ofta med `AIza…`.

Ha nyckeln kopierad — du klistrar in den i nästa steg.

### A7. Starta HEIMDALL första gången

1. Öppna **Utforskaren** (den gula mappikonen) och gå till `C:\Users\DittWindowsNamn\heimdall`.
2. Dubbelklicka på **start.bat**. (Varnar Windows "Datorn skyddades av Windows" — klicka **Mer info** → **Kör ändå**.)
3. Ett svart fönster öppnas. Första gången installerar det några saker (kan ta en minut) och sen ställer det frågor:
   - **Vad heter du?** — skriv ditt namn, tryck Enter.
   - **Gemini-nyckel** — högerklicka för att klistra in nyckeln från A6, tryck Enter.
   - **Din åtkomstkod** visas — **skriv upp den!** Det är lösenordet till appen.
   - **Molnadress** — tryck bara Enter (det fixar vi i Del C).
4. När det står `HEIMDALL vaknar på datorn — port 4777` är den igång.
5. Öppna webbläsaren (Chrome eller Edge) och gå till **http://localhost:4777**
6. Skriv in **åtkomstkoden** och klicka **Lås upp**.

🎉 HEIMDALL är igång! Testa att skriva *"Vad kan du göra?"* i rutan längst ner.

### A8. Berätta om dig själv

1. Klicka på **kugghjulet** uppe till höger.
2. Fyll i **Ditt namn** och **Om dig** — t.ex. *"Jag jobbar som undersköterska, har en liten Instagram om träning och vill börja sälja träningsprogram."* Agenterna använder det för att ge förslag som passar dig.
3. Klicka **Spara**.

> **Stänga av:** stäng det svarta fönstret. **Starta igen:** dubbelklicka på `start.bat`. HEIMDALL uppdaterar sig själv från din GitHub-kopia varje gång den startar.

---

## Del B — Claude Code (valfritt)

Claude Code är en AI som kan läsa och ändra filer i dina projekt — t.ex. fixa din hemsida. HEIMDALL använder den för "Claude-jobb", "Bygg det" i Pengapotten, videoredigering och som reserv när Gemini tar slut. **Kräver en betald Claude-prenumeration (Pro eller högre).**

### B1. Skaffa Claude

1. Gå till **https://claude.ai** och skapa ett konto.
2. Uppgradera till **Pro** (eller högre) under inställningarna.

### B2. Installera Claude Code

Öppna PowerShell och klistra in:

```
irm https://claude.ai/install.ps1 | iex
```

Det syns ingen förloppsindikator — vänta tills det är klart. **Stäng PowerShell och öppna ett nytt**, och kolla sen:

```
claude --version
```

Du ska se ett versionsnummer. Står det att `claude` inte känns igen: starta om datorn och försök igen.

### B3. Logga in

Skriv i PowerShell:

```
claude
```

En webbläsare öppnas — logga in med ditt Claude-konto och godkänn. När du är tillbaka i PowerShell och ser en ruta där du kan skriva är du inloggad. Skriv `/exit` och tryck Enter för att stänga.

> Loggas du ut senare säger HEIMDALL "Claude Code är utloggad". Gör då bara B3 igen.

### B4. Lägg till dina projekt

HEIMDALL behöver veta vilka mappar Claude får jobba i.

1. Öppna HEIMDALL-mappen och högerklicka på **config.json** → **Öppna med** → **Anteckningar**.
2. Under `"projects"` finns redan "Övrigt". Lägg till dina projekt så här (exempel med en hemsida):

```json
  "projects": [
    {
      "id": "hemsida",
      "name": "Min hemsida",
      "color": "#ff2e63",
      "description": "Min företagssajt",
      "path": "C:\\Users\\DittWindowsNamn\\min-hemsida",
      "rules": "Ändra aldrig kontaktuppgifterna utan att fråga."
    },
    {
      "id": "ovrigt",
      "name": "Övrigt",
      "color": "#8aa0b4",
      "description": "Allt annat",
      "path": "",
      "rules": ""
    }
  ],
```

- **id** — kort namn utan mellanslag och åäö.
- **path** — mappen på datorn. Skriv **dubbla** `\\` som i exemplet. Lämna tomt om projektet inte har någon mapp.
- **rules** — saker Claude alltid ska tänka på i projektet.
- Tips: mappen bör vara ett git-repo (hämtad med `git clone` som i A5) — då kan du ångra och publicera.

3. Spara (Ctrl+S) och starta om HEIMDALL (stäng det svarta fönstret, dubbelklicka `start.bat`).

**Testa:** skriv *"fixa så att rubriken på min hemsida blir större"*. Gå till fliken **Jobb** och se Claude jobba. När det är klart kan du svara i samma tråd, trycka **Ångra** eller **Publicera**.

---

## Del C — Molnet: HEIMDALL dygnet runt + på mobilen

Hittills körs HEIMDALL bara när datorn är på, och bara på datorn. Nu lägger vi "hjärnan" i molnet (gratis, på Render), så att:

- HEIMDALL är igång **även när datorn är avstängd** (påminnelser, notiser, mejl, agenter, chatt, röst).
- Du kan använda den på **mobilen** var du än är.
- Datorn kopplar upp sig mot molnet när den är på och sköter det som kräver datorn (Claude-jobb, datorstyrning, TV, video).

Din data (uppgifter, chatt, mål) sparas i en egen gren i ditt **privata** GitHub-repo.

### C1. Skapa en GitHub-nyckel (token)

Molnet behöver få spara din data i ditt repo.

1. Gå till **https://github.com/settings/personal-access-tokens/new**
2. **Token name:** `heimdall`
3. **Expiration:** välj **No expiration** (eller ett långt datum — går den ut slutar sparningen fungera).
4. **Repository access:** välj **Only select repositories** → välj ditt repo **heimdall**.
5. **Permissions** → **Repository permissions** → leta upp **Contents** → välj **Read and write**.
6. Längst ner: **Generate token** → kopiera nyckeln (börjar med `github_pat_`). Den visas bara en gång — spara den någonstans säkert tills du är klar.

### C2. Skapa molnservern på Render

1. Gå till **https://render.com** → **Get Started** → **Sign up with GitHub** (logga in med ditt GitHub-konto).
2. Om Render frågar om tillgång till dina repon: välj ditt **heimdall**-repo.
3. Klicka på **New +** (uppe till höger) → **Blueprint**.
4. Välj ditt **heimdall**-repo → **Connect**.
5. Render läser inställningarna och visar en lista med fält att fylla i. Fyll i:

| Fält | Vad du skriver |
|---|---|
| `DATA_REPO` | `DITT-ANVÄNDARNAMN/heimdall` |
| `HEIMDALL_TOKEN` | **samma åtkomstkod** som du skrev upp i A7 (finns även i filen `.env` i mappen) |
| `GEMINI_API_KEY` | din Gemini-nyckel från A6 |
| `GITHUB_TOKEN` | nyckeln från C1 |
| `GEMINI_API_KEY_2`, `GROQ_API_KEY`, `N8N_URL`, `N8N_API_KEY` | lämna **tomma** (se Del D) |

6. Klicka **Apply** / **Deploy Blueprint**. Vänta några minuter tills det står **Live** (grönt).
7. Klicka på tjänsten **heimdall**. Högst upp finns din adress, t.ex. `https://heimdall-abcd.onrender.com`. **Kopiera den.**
8. Öppna adressen i webbläsaren, skriv in din åtkomstkod. Nu körs HEIMDALL i molnet!

> Render gratis "somnar" efter 15 minuter utan besök. HEIMDALL väcker sig själv, men första gången på länge kan det ta ~30 sekunder att öppna.

### C3. Koppla datorn till molnet

1. Stäng det svarta fönstret om HEIMDALL är igång.
2. Öppna HEIMDALL-mappen, högerklicka på filen **.env** → **Öppna med** → **Anteckningar**. (Ser du ingen `.env`? Klicka **Visa** → **Visa** → bocka i **Dolda objekt** och **Filnamnstillägg**.)
3. Lägg till en ny rad längst ner med din adress från C2:

```
CLOUD_URL=https://heimdall-abcd.onrender.com
```

4. Spara (Ctrl+S) och dubbelklicka på **start.bat**.
5. I det svarta fönstret ska det stå **Ansluten till molnet**. Första gången flyttas din data från datorn till molnet.

Från och med nu öppnar du alltid HEIMDALL på **molnadressen** (även på datorn). Rutan **DATOR** i Kärnan visar om datorn är på.

### C4. Lägg HEIMDALL som app på mobilen

**iPhone:**
1. Öppna **Safari** och gå till din molnadress.
2. Tryck på **Dela**-knappen (fyrkant med pil upp) → **Lägg till på hemskärmen** → **Lägg till**.
3. Öppna HEIMDALL **från hemskärmen** (inte Safari) och skriv in koden.
4. Tryck på **kugghjulet** → **Notiser** → **Aktivera** → **Tillåt**. Nu får du påminnelser som notiser.

**Android:**
1. Öppna **Chrome** och gå till din molnadress.
2. Tryck på **⋮** (tre prickar) → **Installera app** (eller **Lägg till på startskärmen**).
3. Öppna appen, skriv koden, kugghjulet → **Notiser** → **Aktivera**.

**Uppgifter och skift i telefonens kalender (valfritt):**
1. I appen: **kugghjulet** → **Kalender i telefonen** → **Kopiera länk**.
2. iPhone: **Inställningar** → **Kalender** → **Konton** → **Lägg till konto** → **Annat** → **Lägg till prenumererad kalender** → klistra in länken → **Nästa** → **Spara**.
   Android/Google Kalender: gå till **calendar.google.com** på datorn → **+** bredvid "Andra kalendrar" → **Från webbadress** → klistra in länken (byt `webcal://` mot `https://`).
3. Kalendern uppdateras av sig själv (ibland med upp till några timmars fördröjning — påminnelser kommer alltid direkt som notiser från appen).

### C5. Som app på datorn

1. Öppna molnadressen i **Chrome**.
2. Klicka **⋮** → **Spara och dela** → **Installera sidan som app** (i Edge: **⋯** → **Appar** → **Installera den här webbplatsen som en app**).

### C6. Starta datordelen automatiskt när datorn startar (rekommenderas)

1. Tryck **Windows-knappen + R**, skriv `shell:startup` och tryck Enter. En mapp öppnas.
2. Öppna HEIMDALL-mappen i ett annat fönster, **högerklicka** på `start.bat` → **Visa fler alternativ** → **Skapa genväg**.
3. Dra genvägen till startup-mappen.

---

## Del D — Extra funktioner (valfritt)

Allt här är valfritt. Inställningar för molnet läggs i **Render → din tjänst → Environment → Add Environment Variable** → fyll i **Key** och **Value** → **Save, rebuild and deploy**. (Kör du utan moln: lägg raden i `.env` i stället, som `NAMN=värde`.)

### D1. Mer gratis-AI (rekommenderas)

Googles gratiskvot tar slut vid mycket användning (den nollställs ungefär kl 09 svensk tid). Två sätt att få mer:

- **Extra Gemini-nyckel:** gör som i A6 men välj **Create API key in new project**. Lägg in som `GEMINI_API_KEY_2`. HEIMDALL byter automatiskt när den första tar slut.
- **Groq (reserv):** gå till **https://console.groq.com**, logga in med Google → **API Keys** → **Create API Key** → kopiera (börjar med `gsk_`). Lägg in som `GROQ_API_KEY`. Agenterna använder den när Gemini är slut.

### D2. Mejlkoll

HEIMDALL kan läsa (aldrig skicka eller radera) din inkorg och ge notis när en riktig människa mejlar.

**Gmail:**
1. Slå på tvåstegsverifiering: **https://myaccount.google.com/security** → **Tvåstegsverifiering**.
2. Skapa ett app-lösenord: **https://myaccount.google.com/apppasswords** → skriv namnet `heimdall` → **Skapa** → kopiera de 16 bokstäverna.
3. Lägg till en variabel:
   - **Key:** `MAIL_PRIVAT` (ordet efter `MAIL_` blir inkorgens namn i appen, t.ex. `MAIL_JOBB`)
   - **Value:** `imap.gmail.com|din@gmail.com|abcd efgh ijkl mnop|993|`

Det sista fältet (efter sista `|`) är ett filter:
- tomt — notis när en riktig människa mejlar (reklam, kvitton och automatmejl filtreras bort)
- `tips` — bara när någon skickar ett tips eller en förfrågan
- `svar` — som tomt, plus att agenten **Mejlsvar** skriver ett färdigt svarsförslag (`tips,svar` går också)

**Andra mejl:** Zoho med egen domän: `imappro.zoho.eu`. Outlook/Hotmail: `outlook.office365.com` (Microsoft tillåter inte alltid app-lösenord — då går det inte). Du behöver alltid ett **app-lösenord**, inte ditt vanliga lösenord.

### D3. Ditt skiftschema

Jobbar du skift i ett schema som upprepar sig kan HEIMDALL visa det och planera runt det. Öppna `config.json` och fyll i `"shifts"`:

```json
  "shifts": {
    "cycleStart": "2026-01-05",
    "pattern": ["D","D","K","K","N","N","L","L","L","L"],
    "types": {
      "D": { "name": "Dag", "start": "07:00", "end": "16:00" },
      "K": { "name": "Kväll", "start": "15:00", "end": "23:30" },
      "N": { "name": "Natt", "start": "23:00", "end": "07:00" },
      "L": { "name": "Ledig" }
    }
  },
```

- **types** — dina skifttyper: en kort kod, ett namn och tider. Ledigt har inga tider.
- **pattern** — schemat dag för dag, en kod per dag, tills det börjar om.
- **cycleStart** — ett datum (ÅÅÅÅ-MM-DD) då schemat börjar på första koden i listan.

Spara och starta om HEIMDALL på datorn — med molnet kopplat skickas schemat dit automatiskt. Enstaka byten gör du i appen: tryck på skiftet i **Schema**.

### D4. Bevaka dina hemsidor

Lägg till i `config.json` så får du notis om sajten slutar fungera:

```json
  "monitors": [
    { "name": "minsajt.se", "url": "https://minsajt.se" }
  ],
```

### D5. Styra TV:n (Google TV / Android TV)

Funkar när **datorn är på** och TV:n är på samma wifi.

1. **På TV:n:** Inställningar → System → Om → tryck **7 gånger** på **Android TV OS-version** (eller "Version") tills det står att du är utvecklare.
2. Inställningar → System → **Utvecklaralternativ** → slå på **USB-felsökning** (och **Nätverksfelsökning** om det finns).
3. Inställningar → System → **Ström och energi** → slå på **Nätverksstandby** eller **Snabbstart** (behövs för att kunna starta TV:n).
4. **På datorn:** ladda ner **https://dl.google.com/android/repository/platform-tools-latest-windows.zip**, packa upp, skapa mappen `tools\adb` i HEIMDALL-mappen och kopiera **allt innehåll** från mappen `platform-tools` dit (så att `adb.exe` ligger direkt i `tools\adb`).
5. Ta reda på TV:ns IP-adress: Inställningar → **Nätverk och internet** → ditt wifi → **IP-adress** (t.ex. `192.168.1.45`).
6. Säg till HEIMDALL: *"Anslut till TV:n på 192.168.1.45"*. På TV:n dyker en ruta upp — bocka i **Tillåt alltid** och tryck **OK**. Säger HEIMDALL att TV:n väntar på godkännande: tryck Tillåt och säg samma sak igen.

Sen kan du säga t.ex. *"sänk volymen på TV:n"*, *"öppna Netflix på TV:n"*, *"spela Blinding Lights på Spotify på TV:n"*, *"starta TV:n"*.

### D6. n8n-automationer

Använder du **n8n** kan du se och styra dina flöden från HEIMDALL.

1. I n8n: **Settings** → **n8n API** → **Create an API key** → kopiera.
2. Lägg till variablerna `N8N_URL` (din n8n-adress, t.ex. `https://dittnamn.app.n8n.cloud`) och `N8N_API_KEY`.
3. Flödena syns under **Projekt → Automationer**. Säg *"pausa flödet X"* eller använd reglaget.

### D7. Video

Installera FFmpeg (behövs för att klippa video): öppna PowerShell och klistra in

```
winget install Gyan.FFmpeg
```

Starta om HEIMDALL. Under fliken **Video** kan du skapa projekt, ladda upp klipp (även från mobilen), göra undertexter och be Claude redigera (kräver Del B).

### D8. Ord den hör fel

Säger du namn som HEIMDALL hör fel? Säg *"lägg till Ylva i ordlistan"*. Eller lägg dem i `config.json` under `"vocab": ["Ylva", "Mitt Företag AB"]`.

---

## Så använder du HEIMDALL

### Flikarna

| Flik | Vad den visar |
|---|---|
| **Kärna** | Chatten och mikrofonen, dagens läge (skift/datum, nästa uppgift, system), månadsmål och snabbknappar. På datorn även aktivitetslogg och pengagraf. |
| **Schema** | 14 dagar framåt. Varje dag har en 24-timmarsstapel med skift och uppgifter. Tryck på en dag för att hoppa dit, bocka av, tryck **⋯** för att ändra. |
| **Projekt** | Sajtbevakning, n8n-flöden, mål, pengar, dina projekt, inkorgen och idébanken. |
| **Agenter** | Pengapotten och alla agenter. Tryck **Kör nu** för att köra en agent direkt. |
| **Video** | Videoprojekt, uppladdning, undertexter och redigering. |
| **Jobb** | Claude-jobben som chattrådar. Svara, ångra eller publicera. |

På mobilen kan du **svepa åt sidan** för att byta flik.

### Saker att säga eller skriva

- *"Påminn mig att betala hyran på fredag kl 17"*
- *"Vad har jag för dag idag?"* / *"Planera min vecka"*
- *"Jag är klar med tvätten"* (bockar av)
- *"Mitt mål är 5 betalande kunder innan jul"*
- *"Jag fick 1500 kr för ett uppdrag"* (loggar pengar)
- *"Sätt potten till 1000 kr"* / *"leta pengaförslag"*
- *"Starta fokusläge i 50 minuter"*
- *"Öppna Spotify"* / *"lås datorn"* / *"sök på YouTube efter roliga katter"*
- *"Skapa kommandot Godmorgon: öppna min mejl och spela musik"*
- *"Fixa så att knappen på min hemsida blir blå"* (Claude-jobb)

### Pengapotten

1. **Agenter** → tryck på den gröna rutan och sätt en budget (t.ex. 500 kr).
2. **Pengajakten** kommer med förslag måndagar och torsdagar (eller tryck **Leta förslag nu**): insats, vad det kan ge, risk, tid och steg-för-steg.
3. **Godkänn** — förslaget blir en uppgift i schemat. Inget köps eller betalas automatiskt.
4. **Logga resultat** när du vet vad det gav — det räknas in under pengar och vinsten går tillbaka in i potten.
5. Godkända **nya projekt** kan byggas med **Bygg första versionen med Claude** (kräver Del B).

---

## Felsökning

| Problem | Lösning |
|---|---|
| `start.bat` stängs direkt / "node känns inte igen" | Node.js är inte installerat. Gör A1 och starta om datorn. |
| "git känns inte igen" | Git är inte installerat. Gör A2 och starta om datorn. |
| Appen säger **Fel kod** | Skriv åtkomstkoden exakt (den står i filen `.env` vid `HEIMDALL_TOKEN=`). Molnet och datorn måste ha **samma** kod. |
| HEIMDALL svarar "Gemini-gränsen nådd" | Gratiskvoten är slut för idag (nollställs ca kl 09). Gör D1 för mer gratis-AI. |
| "Datorn är av" fast den är på | Kolla att det svarta fönstret är öppet och står **Ansluten till molnet**. Kolla att `CLOUD_URL` i `.env` är exakt din Render-adress. |
| Claude-jobb: "Claude Code är utloggad" | Öppna PowerShell, skriv `claude` och logga in igen (B3). |
| Claude-jobb: "Mappen finns inte" | Fel `path` i `config.json`. Kolla stavningen och de dubbla `\\`. |
| Inga notiser på iPhone | Appen måste öppnas från **hemskärmen**, inte Safari. Aktivera notiser i kugghjulet igen. |
| Mejl: "Fel lösenord" | Använd ett **app-lösenord** (D2), inte ditt vanliga. För Gmail måste IMAP vara på (Gmail → Inställningar → Vidarebefordran och POP/IMAP). |
| Render: data försvinner | Kolla `GITHUB_TOKEN` (Contents: Read and write på rätt repo) och `DATA_REPO` (`användarnamn/heimdall`). Titta i **Render → Logs** efter "Kunde inte hämta data från GitHub". |
| TV: "ADB saknas" | `adb.exe` måste ligga direkt i mappen `tools\adb` (D5 steg 4). Kolla stavningen på mappen. |
| TV: "Fick inget kontakt" | TV:n är avstängd eller på annat wifi. Slå på Nätverksstandby/Snabbstart (D5 steg 3). |
| Röstsamtalet svarar inte | Tryck på mikrofonen igen. Det svarta fönstret / Render-loggen visar "Samtal: skickat X ljudbitar, Google svarat Y gånger" — svarar Google 0 gånger är det Googles sida. |

Fastnar du: titta i det svarta fönstret eller **Render → Logs** — där står oftast vad som är fel på svenska.

---

## Säkerhet — läs det här

- **Dela aldrig** filen `.env`, din åtkomstkod, eller dina nycklar (Gemini, GitHub, Groq, n8n, mejl-lösenord). Den som har dem kan använda dina konton.
- Håll ditt GitHub-repo **privat** — där sparas din data.
- Åtkomstkoden är det enda som skyddar appen på internet. Gör den lång.
- HEIMDALL **skickar aldrig mejl, köper aldrig något och spenderar aldrig pengar** själv. Claude-jobb publiceras bara när du trycker **Publicera**.
- Datoragenten och datorstyrningen kan klicka och skriva på din dator. Den är instruerad att aldrig skriva lösenord eller betala, men håll koll när den kör.

---

## För den nyfikne: hur det hänger ihop

```
  Mobil / dator (appen)  ──►  Molnet (Render)  ◄──►  Din dator (start.bat)
                               hjärna, schema,         Claude Code, datorstyrning,
                               mejl, agenter, röst     TV, video
                                     │
                                     ▼
                         Ditt privata GitHub-repo
                         (koden + din data)
```

- `server.js` — servern. `lib/` — alla delar (hjärnan, rösten, agenterna, mejl, TV …). `public/` — själva appen.
- Vill du bygga vidare: säg till HEIMDALL *"lägg till en funktion i HEIMDALL som …"* — med Claude Code (Del B) bygger den om sig själv. Instruktionerna Claude följer finns i `CLAUDE.md`.
