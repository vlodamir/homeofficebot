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
- Stav poslední zprávy ukládá do `data/state.json` – přežije restart

## Instalace

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
stateFilePath: "data/state.json"
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
| `stateFilePath` | Cesta k souboru stavu | `data/state.json` |

Team members are now stored in the state file (`data/state.json`) and managed with the new slash command `/hovnobot-team-members`.

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

**Show all** displays the onsite roster while it loads the vacation timeline below. The timeline starts at the current month in the bot's configured timezone and includes month navigation and exact vacation dates. Use **Planned Absences** in the daily message to manage entries. Past months reflect the records still present in the existing state store.

Add `files:write` and `files:read` to the existing app's bot scopes, then reinstall or reauthorize it in the workspace before restarting the bot. The bot completes uploads without a channel destination and uses the authenticated Slack file URL in the modal when available. The date list remains available if a timeline image can't be displayed. [Slack file uploads](https://docs.slack.dev/reference/methods/files.completeUploadExternal/) · [Block Kit Slack file reference](https://docs.slack.dev/reference/block-kit/composition-objects/slack-file-object/)

Run `npm ci` and `npm run build` on the build machine, then copy `dist/index.js` to the server. The bundle includes the JavaScript dependencies, WebAssembly renderer, and chart fonts. The server needs Node.js 18.18 or later and the bot's existing configuration and writable state path. Start it with `node index.js --config /path/to/config.yaml`.

The bot uses the existing YAML configuration. It writes a small image cache index beside `stateFilePath` and keeps up to 24 private images per cache. Expired images are cleaned up when the cache is used. Keep the cache index on the same persistent volume as the bot state across restarts.

The bot also caches up to 128 Slack avatars on disk beside `stateFilePath`. New charts reuse cached avatars for up to seven days. A changed Slack avatar URL triggers a fresh download.

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

