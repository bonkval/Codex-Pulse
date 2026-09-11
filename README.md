# Codex Pulse

Codex Pulse is a small Windows desktop companion that sits above the bottom-right corner of the screen and shows the remaining Codex rate-limit capacity.

It reads the authenticated account data from the local Codex CLI app-server, so it uses the same login as Codex and does not store or ask for API keys.

## Run locally

```powershell
npm install
npm start
```

## Build the executable

```powershell
npm run dist
```

The portable `.exe` is written to `dist/`. The app adds itself to Windows startup the first time it runs. The tray menu can be used to disable startup, refresh usage, show/hide the card, open Codex, or quit.

If Codex is installed somewhere that is not on the Windows PATH, set `CODEX_BIN` to the absolute path of `codex.exe` before launching the app.
