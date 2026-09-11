# Codex Pulse

Codex Pulse is a lightweight Windows companion for Codex. It stays near your tray and shows your remaining 5-hour and weekly usage, live token activity, and what Codex is currently doing in VS Code.

**Current version: 1.5.1**

> **[Download the latest Codex Pulse installer](https://github.com/bonkval/Codex-Pulse/releases/latest/download/Codex-Pulse-Setup.exe)**
>
> If the direct download is unavailable, use the [latest GitHub release](https://github.com/bonkval/Codex-Pulse/releases/latest).
## Screenshots
<img width="476" height="697" alt="image" src="https://github.com/user-attachments/assets/3562a7d0-7990-414a-baad-31ee499b3d03" />
<img width="479" height="701" alt="image" src="https://github.com/user-attachments/assets/7f905b40-a56f-4673-ac39-81c65eb18229" />
<img width="481" height="705" alt="image" src="https://github.com/user-attachments/assets/a4b83c5a-9497-4356-a2aa-edcda305417c" />
<img width="475" height="703" alt="image" src="https://github.com/user-attachments/assets/42edea74-47d1-4a4b-871e-aabbd5d3783b" />
<img width="475" height="695" alt="image" src="https://github.com/user-attachments/assets/eb4dcfce-2ed9-4db7-858d-5e64b780dfff" />
<img width="478" height="696" alt="image" src="https://github.com/user-attachments/assets/d39d4a5e-a415-42cf-a4ed-9cb225332aa8" />
<img width="484" height="698" alt="image" src="https://github.com/user-attachments/assets/40c21fbc-fe00-45a8-a899-707303207cf1" />

## Install and run

1. Download the **[Codex Pulse installer](https://github.com/bonkval/Codex-Pulse/releases/latest/download/Codex-Pulse-Setup.exe)**.
2. Double-click `Codex-Pulse-Setup.exe` and follow the installer steps.
3. Leave **Create a desktop shortcut** checked if you want a shortcut on your desktop.
4. Open Codex Pulse from the desktop shortcut or the Start Menu.

Codex Pulse runs as a normal Windows app. No PowerShell, terminal, Node.js, or VS Code setup is required for installed users. Make sure Codex is signed in and active in VS Code so live session data is available.

## What the app does

- Shows remaining usage for the rolling 5-hour limit.
- Shows remaining usage for the rolling 7-day limit.
- Refreshes account usage on the configured interval.
- Reads local VS Code Codex session events and updates live activity, token counts, and today's history within about a second.
- Shows today's tokens, the last 7 days, lifetime tokens, peak daily usage, and usage streaks when available.
- Includes 7-day and 30-day token history charts with readable dates, highest-use days, averages, and hover details.
- Shows the current session's input, output, reasoning, and total tokens when Codex provides them.
- Scans local VS Code session metadata to show recent sessions, project totals, and model totals without storing prompt or response text.
- Includes a 90-day activity calendar and actionable pacing guidance with recent usage rate, safe pace, and reset comparison.
- Estimates how long your remaining usage may last based on your recent pace.
- Shows a Codex Pet companion above the minimized logo while Codex is working and a green completion badge when it finishes.
- Sends configurable notifications for separate 5-hour and weekly thresholds, daily token targets, and rate-limit resets.
- Provides connection diagnostics, a clipboard-ready report, notification snoozing, and local history clear/backup/restore controls.
- Shows plan, connection health, last sync time, and reset credits when provided.
- Supports light, dark, and system themes.
- Supports compact mode, adjustable popup size and opacity, always-on-top, start minimized, pause monitoring, and per-monitor positions.
- Can be moved anywhere and remembers its position across restarts and monitors.
- Minimizes to a compact floating logo and restores when clicked.
- Includes a Windows tray menu for showing, hiding, refreshing, opening Codex, and quitting.
- Supports a customizable global keyboard shortcut for showing or hiding the popup, with a default of `Ctrl+Shift+Alt+P`.
- Can launch with Windows or start quietly in the tray.
- Exports locally collected token history as JSON or CSV.
- Checks GitHub Releases for updates.

## Privacy

Codex Pulse does not ask for or store API keys. It uses the existing local Codex login and reads local session records from `%USERPROFILE%\.codex\sessions`. Session data is processed locally and is not uploaded by Codex Pulse.

## Latest release files

For the v1.5.1 GitHub release, the installer is the only file users need for a normal installation. The other files support automatic updates and are optional for first-time users.

- `Codex-Pulse-Setup.exe` — the only required download; use this to install Codex Pulse.
- `Codex-Pulse-Setup.exe.blockmap` — optional; helps the automatic updater download updates efficiently.
- `latest.yml` — optional for installation; lets the app find and install updates automatically.
- `Codex-Pulse-1.5.1-x64-tray.exe` — optional portable version.
