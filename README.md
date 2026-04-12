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
copy .env.example .env
```

Otevři `.env` a vyplň hodnoty (viz sekce níže).

## Spuštění

```bash
npm run dev
```

Ruční odeslání zprávy okamžitě (pro testování):

```bash
npm run send-now
```

## Environment proměnné

| Proměnná | Popis |
|---|---|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App-Level Token (`xapp-...`) |
| `SLACK_CHANNEL_ID` | ID cílového kanálu (`C0XXXXXXX`) |
| `TIMEZONE` | Časová zóna (výchozí: `Europe/Prague`) |
| `POST_HOUR` | Hodina odeslání (výchozí: `18`) |
| `POST_MINUTE` | Minuta odeslání (výchozí: `0`) |
| `STATE_FILE_PATH` | Cesta k souboru stavu (výchozí: `data/state.json`) |

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

