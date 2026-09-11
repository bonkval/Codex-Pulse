# Codex Pulse

Codex Pulse is a lightweight Windows companion app that shows how much Codex usage you have remaining in your current 5-hour and weekly limits while you work.

> **[Download Codex Pulse for Windows](https://github.com/bonkval/ai-tray/releases/latest/download/Codex-Pulse-Setup.exe)**
>
> If the direct download is unavailable, use the [latest release page](https://github.com/bonkval/ai-tray/releases/latest).

## Install and run

1. Click **[Download Codex Pulse for Windows](https://github.com/bonkval/ai-tray/releases/latest/download/Codex-Pulse-Setup.exe)**.
2. Double-click the installer to install Codex Pulse.
3. Leave **Create a desktop shortcut** checked if you want an icon on your desktop.
4. Finish the installation, then open Codex Pulse from the desktop shortcut or the Start Menu.

Codex Pulse opens automatically as a small popup. No PowerShell or terminal commands are needed. Make sure you are signed in to Codex so the app can sync your usage.

## Features

- Shows remaining usage for the rolling 5-hour limit.
- Shows remaining usage for the 7-day weekly limit.
- Syncs usage from your local Codex login.
- Shows token activity for today, the last 7 days, and your lifetime account total when Codex provides it.
- Includes daily token history with 7-day and 30-day views, highest-day and average-use summaries.
- Shows live session token counts when the Codex app-server sends active-thread updates.
- Provides an estimate of when a usage window may be exhausted based on recent activity.
- Refreshes account usage on the configured interval, while VS Code activity, live session tokens, and today\'s history update within about a second.
- Sends optional notifications for low limits, daily token targets, and rate-limit resets.
- Shows healthy, warning, and critical usage states.
- Stays available while you code in VS Code or other apps.
- Can be moved anywhere on the screen.
- Remembers the popup position across restarts and monitors.
- Minimizes to a compact floating logo and restores when clicked.
- Includes an optional Codex Pet companion that reads local VS Code Codex session events, types live activity above the minimized logo, and shows a completion badge when work finishes.
- Supports light, dark, and system themes.
- Includes settings for refresh interval, startup behavior, notifications, quiet mode, and Codex executable selection.
- Lets you set a daily token target and export locally stored history as JSON or CSV.
- Shows plan, connection health, last sync time, and available reset credits when provided.
- Includes a Windows tray icon for showing, hiding, refreshing, opening Codex, and quitting the app.
- Can be configured to launch with Windows or run quietly in the tray.
- Checks GitHub Releases for updates and can install them from the app.

Codex Pulse does not ask for or store API keys. It uses the existing local Codex session on your computer.
