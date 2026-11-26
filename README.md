# homeofficebot

Slack bot v TypeScriptu pro denní HO hlasování. Každý pracovní den v 18:00 pošle zprávu do zvoleného kanálu, přidá hlasovací reakci ✅ a aktualizuje seznam lidí kteří budou mít HO.

## Co bot dělá

- Každý pracovní den v 18:00 pošle do kanálu zprávu ve formátu:

```
🏠 *HO Úterý*
─────────────────
👤 Jana Nováková
👤 Mirek Vlček
```

- Přidá reakci ✅ jako hlasovací tlačítko
- Když někdo klikne na ✅, bot odebere svůj hlas a přidá jméno uživatele pod zprávu
- Když někdo hlas odebere, jméno zmizí; pokud nikdo nehlasuje, bot vrátí ✅ zpět
- Víkendy přeskočí
- Stav poslední zprávy, členy týmu a plánované absence ukládá do `data/state.sqlite`.

## Instalace

Použij Node.js 22.13.0 nebo novější. Soubor `.nvmrc` vybírá Node.js 22.

```bash
npm install
cp config.example.yaml config.yaml
```

Otevři `config.yaml` a vyplň hodnoty (viz sekce níže).

## Spuštění

```bash
npm run dev
```

Ruční odeslání zprávy okamžitě (pro testování):

```bash
npm run send-now
```

## Konfigurace (config.yaml)

Aplikace se konfiguruje přes YAML soubor, který se předá jako command-line argument `--config`.

Příklad `config.yaml`:

```yaml
slackBotToken: "xoxb-..."
slackAppToken: "xapp-..."
slackChannelId: "C0XXXXXXX"
postHour: 18
postMinute: 0
timezone: "Europe/Prague"
stateDatabasePath: "data/state.sqlite"
```

Team members are no longer configured in YAML. Use the Slack admin slash command `/hovnobot-team-members` to add or remove tracked users.

| Položka | Popis | Výchozí |
|---|---|---|
| `slackBotToken` | Bot User OAuth Token (`xoxb-...`) | — (povinné) |
| `slackAppToken` | App-Level Token (`xapp-...`) | — (povinné) |
| `slackChannelId` | ID cílového kanálu (`C0XXXXXXX`) | — (povinné) |
| `timezone` | Časová zóna (IANA format) | `Europe/Prague` |
| `postHour` | Hodina odeslání (0–23) | `18` |
| `postMinute` | Minuta odeslání (0–59) | `0` |
| `stateDatabasePath` | Cesta k databázi SQLite | `data/state.sqlite` nebo cesta odvozená z `stateFilePath` |
| `stateFilePath` | Cesta k původnímu JSON pro import | `data/state.json` |

Paths are relative to the bot's working directory. When `stateDatabasePath` is omitted, the bot replaces the `.json` suffix of `stateFilePath` with `.sqlite`, or appends `.sqlite` to paths with other suffixes.

## Nastavení Slack app

### 1. Vytvoř app
- Jdi na https://api.slack.com/apps → **Create New App → From scratch**

### 2. Bot Token Scopes
- **OAuth & Permissions → Bot Token Scopes** – přidej:
  - `chat:write`
  - `reactions:read`
  - `reactions:write`
  - `channels:history`
  - `groups:history`
  - `users:read`
  - `files:write` (upload and remove private vacation timeline images)
  - `files:read` (validate cached Slack file IDs before reuse)
- Klikni **Install to Workspace → Allow**
- Zkopíruj **Bot User OAuth Token** (`xoxb-...`) do `SLACK_BOT_TOKEN`

### 3. Socket Mode
- **Socket Mode → Enable Socket Mode**
- Vygeneruj App-Level Token se scope `connections:write`
- Zkopíruj token (`xapp-...`) do `SLACK_APP_TOKEN`

### 4. Event Subscriptions
- **Event Subscriptions → Enable Events**
- Přidej bot eventy: `reaction_added`, `reaction_removed`
- Ulož změny

### 5. Pozvi bota do kanálu
- V Slacku napiš do cílového kanálu: `/invite @nazev-bota`

## Planned vacation timeline

**Show all** displays the onsite roster while it loads the vacation timeline below. The timeline starts at the current month in the bot's configured timezone and includes month navigation and exact vacation dates. Use **Planned Absences** in the daily message to manage ongoing and upcoming entries. Completed vacations stay available in their historical months, including vacations of former team members.

Add `files:write` and `files:read` to the existing app's bot scopes, then reinstall or reauthorize it in the workspace before restarting the bot. The bot completes uploads without a channel destination and uses the authenticated Slack file URL in the modal when available. The date list remains available if a timeline image can't be displayed. [Slack file uploads](https://docs.slack.dev/reference/methods/files.completeUploadExternal/) · [Block Kit Slack file reference](https://docs.slack.dev/reference/block-kit/composition-objects/slack-file-object/)

The bot keeps the image index and avatar cache beside the SQLite database. It reuses the original cache names when the legacy JSON path is in the same directory. The image cache keeps up to 24 private Slack images and cleans up expired images when used. The avatar cache keeps up to 128 avatars for up to seven days and refreshes an avatar when its URL changes.

## Deploying and upgrading storage

Run `npm ci` and `npm run build` on the build machine, then copy `dist/index.js` to the server. Check that the bot service uses Node.js 22.13.0 or later and has write access to the database directory on persistent storage. Start it with `node index.js --config /path/to/config.yaml`.

For an upgrade from JSON, stop the old process and back up the file at `stateFilePath` before starting the new bundle. The first startup imports the snapshot into SQLite and keeps the original JSON available as a backup. Future writes go to SQLite. Entries already deleted by the old bot can only be recovered from an older backup. If import fails, correct the reported source error and restart to retry the import.

## Struktura projektu

```text
.
├── .env.example
├── .gitignore
├── data/
│   └── .gitkeep
├── package.json
├── src/
│   ├── config.ts
│   ├── date.ts
│   ├── hoMessage.ts
│   ├── index.ts
│   ├── logger.ts
│   ├── scheduler.ts
│   ├── sendNow.ts
│   ├── slack.ts
│   ├── state.ts
│   ├── types.ts
│   ├── vacationAvatars.ts
│   ├── vacationImages.ts
│   ├── vacationModal.ts
│   ├── vacationMonth.ts
│   └── vacationTimeline.ts
└── tsconfig.json
```

## Possible next improvements

- České státní svátky
- Slash command pro ruční odeslání HO zprávy
- Přechod z reactions na buttons
- Nasazení na server (Railway, Render, VPS)

