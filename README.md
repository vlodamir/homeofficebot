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

| Položka | Popis | Výchozí |
|---|---|---|
| `slackBotToken` | Bot User OAuth Token (`xoxb-...`) | — (povinné) |
| `slackAppToken` | App-Level Token (`xapp-...`) | — (povinné) |
| `slackChannelId` | ID cílového kanálu (`C0XXXXXXX`) | — (povinné) |
| `timezone` | Časová zóna (IANA format) | `Europe/Prague` |
| `postHour` | Hodina odeslání (0–23) | `18` |
| `postMinute` | Minuta odeslání (0–59) | `0` |
| `stateFilePath` | Cesta k souboru stavu | `data/state.json` |

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
│   └── types.ts
└── tsconfig.json
```

## Possible next improvements

- České státní svátky
- Slash command pro ruční odeslání HO zprávy
- Přechod z reactions na buttons
- Nasazení na server (Railway, Render, VPS)

