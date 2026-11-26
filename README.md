# homeofficebot

Bot pro Slack napsaný v TypeScriptu slouží k dennímu hlasování o práci z domova (HO). Každý pracovní den v 18:00 pošle zprávu do zvoleného kanálu, přidá hlasovací reakci ✅ a aktualizuje seznam lidí, kteří budou pracovat z domova.

## Co bot dělá

- Každý pracovní den v 18:00 pošle do kanálu zprávu v tomto formátu.

```
🏠 *HO Úterý*
─────────────────
👤 Jana Nováková
👤 Mirek Vlček
```

- Přidá reakci ✅ jako hlasovací tlačítko
- Když někdo klikne na ✅, bot odebere svůj hlas a přidá jméno uživatele pod zprávu
- Když někdo odebere svůj hlas, jeho jméno zmizí. Pokud nikdo nehlasuje, bot znovu přidá ✅
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

Pro okamžité odeslání zkušební zprávy použij tento příkaz.

```bash
npm run send-now
```

## Konfigurace (config.yaml)

Aplikace načítá nastavení ze souboru YAML, jehož cestu zadáš pomocí volby `--config`.

Ukázka souboru `config.yaml`.

```yaml
slackBotToken: "xoxb-..."
slackAppToken: "xapp-..."
slackChannelId: "C0XXXXXXX"
postHour: 18
postMinute: 0
timezone: "Europe/Prague"
stateDatabasePath: "data/state.sqlite"
```

Členy sledovaného týmu mohou správci přidávat a odebírat příkazem `/hovnobot-team-members` ve Slacku.

| Položka | Popis | Výchozí |
|---|---|---|
| `slackBotToken` | Token OAuth pro bota (`xoxb-...`) | — (povinné) |
| `slackAppToken` | Token aplikace (`xapp-...`) | — (povinné) |
| `slackChannelId` | ID cílového kanálu (`C0XXXXXXX`) | — (povinné) |
| `timezone` | Časové pásmo (formát IANA) | `Europe/Prague` |
| `postHour` | Hodina odeslání (0–23) | `18` |
| `postMinute` | Minuta odeslání (0–59) | `0` |
| `stateDatabasePath` | Cesta k databázi SQLite | `data/state.sqlite` |

Relativní cesty se vyhodnocují vůči pracovnímu adresáři bota. Pokud máš existující databázi na jiném místě, nastav její cestu v položce `stateDatabasePath`.

## Nastavení aplikace ve Slacku

### 1. Vytvoř aplikaci

- V seznamu aplikací vyber **Create New App → From scratch**. [Aplikace Slack](https://api.slack.com/apps)

### 2. Nastav oprávnění bota

- V nabídce **OAuth & Permissions → Bot Token Scopes** přidej následující oprávnění.
  - `chat:write`
  - `reactions:read`
  - `reactions:write`
  - `channels:history`
  - `groups:history`
  - `users:read`
  - `files:write` (nahrávání a mazání soukromých obrázků s přehledem dovolených)
  - `files:read` (ověření uložených identifikátorů souborů ve Slacku před dalším použitím)
- Klikni **Install to Workspace → Allow**
- Zkopíruj **Bot User OAuth Token** (`xoxb-...`) do `SLACK_BOT_TOKEN`

### 3. Zapni režim Socket Mode

- Vyber **Socket Mode → Enable Socket Mode**
- Vygeneruj **App-Level Token** s oprávněním `connections:write`
- Zkopíruj token (`xapp-...`) do `SLACK_APP_TOKEN`

### 4. Nastav odběr událostí

- Vyber **Event Subscriptions → Enable Events**
- Přidej odběr událostí `reaction_added` a `reaction_removed`
- Ulož změny

### 5. Pozvi bota do kanálu

- Do cílového kanálu ve Slacku napiš `/invite @nazev-bota`

## Kalendář plánovaných dovolených

Tlačítko **Show all** zobrazí seznam lidí v kanceláři a pod ním načte kalendář dovolených. Kalendář se otevře na aktuálním měsíci podle časového pásma bota. Můžeš listovat mezi měsíci a zobrazit přesné termíny dovolených. Probíhající a budoucí absence můžeš spravovat přes tlačítko **Planned Absences** v denní zprávě. V minulých měsících jsou dostupné i skončené dovolené, včetně dovolených bývalých členů týmu.

Pokud aplikaci už používáš, přidej botovi oprávnění `files:write` a `files:read`. Potom aplikaci znovu nainstaluj do pracovního prostoru nebo jí znovu uděl přístup a restartuj bota. Bot nahrává obrázky bez určení cílového kanálu. Pokud je dostupná adresa souboru ve Slacku s ověřeným přístupem, použije ji v dialogu. Když se obrázek nepodaří zobrazit, termíny zůstanou dostupné v textovém seznamu. [Nahrávání souborů do Slacku](https://docs.slack.dev/reference/methods/files.completeUploadExternal/) · [Odkaz na soubor ve Slack Block Kitu](https://docs.slack.dev/reference/block-kit/composition-objects/slack-file-object/)

Bot ukládá evidenci obrázků a mezipaměť profilových fotek vedle databáze SQLite. Uchovává až 24 soukromých obrázků ve Slacku a při použití mezipaměti odstraňuje ty, kterým vypršela platnost. Ukládá také až 128 profilových fotek po dobu nejvýše sedmi dnů. Fotku obnoví, když se změní její adresa.

## Nasazení

Na počítači, kde aplikaci sestavuješ, spusť `npm ci` a `npm run build`. Potom zkopíruj `dist/index.js` na server. Ověř, že služba bota používá Node.js 22.13.0 nebo novější a má právo zapisovat do adresáře databáze na trvalém úložišti. Bota spusť příkazem `node index.js --config /path/to/config.yaml`.

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

## Možná vylepšení

- České státní svátky
- Příkaz ve Slacku pro ruční odeslání zprávy o práci z domova
- Přechod z reakcí na tlačítka
- Nasazení na server (Railway, Render, VPS)

