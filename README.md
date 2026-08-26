# Codex Pane

English | [简体中文](README.zh-CN.md)

## What This Project Is

Codex Pane is a Windows 11 desktop workbench for running several local Codex conversations in one window. It connects to the Codex CLI already installed on your computer and arranges independent threads in one, two, four, or six resizable panes.

Codex Pane does not include Codex or store Codex credentials. It reuses your existing Codex account, configuration, MCP servers, Skills, and thread history.

The current `0.1.0` release is delivered as a Windows `win-unpacked` directory. It has no installer or automatic updater.

## Why Use It

- Work with up to six independent Codex threads without managing several terminals.
- Keep a separate working directory, model, reasoning effort, draft, attachments, and scroll position in each pane.
- Read commands, file changes, MCP calls, plans, searches, images, and approvals as clear cards instead of protocol messages.
- Handle permission requests, command approvals, questions, and MCP forms in the pane where they occurred.
- Use `/` commands, `@` Skills, images, and file references directly from the message composer.
- Keep application data beside the executable so the unpacked directory is easy to move or back up.

## Quick Start

### Requirements

- Windows 11 x64.
- Codex CLI available as `codex` on `PATH`.
- A working Codex login or API configuration.

Codex Pane is fully tested with `codex-cli 0.149.1`. Other versions may work, but the app will warn when they are outside the tested baseline.

### Run the app

1. Keep the complete `win-unpacked` directory together and place it in a writable location.
2. Run `Codex Pane.exe`.
3. Open Settings and choose a default working directory if needed.
4. Choose a layout, enter a task, and press Enter.

There is no installation step. To upgrade, replace the application files but keep the adjacent `data` directory.

If Codex Pane cannot connect, run `codex --version` in PowerShell, correct the reported Codex problem, and then choose Reconnect in the title bar.

## Reference

### Panes and conversations

- Available layouts: single pane, side by side, stacked, 2×2 grid, four columns, four rows, and a fixed 2×3 six-pane grid.
- Each pane owns its thread settings and draft. A thread cannot be edited in two panes at the same time.
- Pane dividers, window size, focused pane, and thread bindings are restored after restart.
- Resume opens inside the current pane, so the other panes remain available.
- During a running turn, sending another message steers the current turn. Stop interrupts it.
- Full screen hides the custom title bar.

The footer keeps the active model, reasoning effort, working state, approval state, context usage, and available 5-hour and 7-day quota information together. Narrow panes wrap complete footer items instead of clipping them.

### Working directories

The default working directory is configured in Settings. Codex Pane explicitly starts `codex app-server` in that directory.

Use `/cwd` to choose a different directory for one pane. The effective order is:

1. The pane working directory.
2. The global default working directory.
3. The application directory when no default is set.

Resumed threads keep their own working directory.

### Composer

| Action | How to use it |
| --- | --- |
| Send | Press Enter. |
| New line | Press Shift+Enter. |
| Slash commands | Type `/` or use the `/` button, then press Tab or Enter to choose. |
| Skills | Type `@` or use the `@` button, then choose a Skill. |
| Attachments | Use one attachment button and one file picker for images or ordinary files. |
| Paste | Text enters the composer; clipboard images or files are saved as attachments. |
| Move between panes | Press Alt+Arrow. |
| Scroll to the latest message | With an empty composer, press Arrow Down. |

A selected Skill remains visible as `@SkillName` and is sent as a structured Skill input. Images and ordinary files are copied into the adjacent `data` directory before being sent as local-image or file-reference input.

Each pane accepts up to 20 attachments. A local image may be up to 15 MB, 8192 pixels on either edge, and 40 million pixels in total; an ordinary file may be up to 100 MB.

### Slash commands

| Command | Purpose |
| --- | --- |
| `/agents` | View and switch available agents. |
| `/compact` | Compact the current conversation. |
| `/cwd` | Change the current pane's working directory. |
| `/kill-processes` | Stop all background processes owned by the thread. |
| `/mcp` | View available MCP servers and tools. |
| `/new` | Start a new thread in the current pane. |
| `/permissions` | View and switch permission modes allowed by Codex. |
| `/processes` | View background processes. |
| `/resume` | Resume a previous thread in the current pane. |
| `/review` | Review current file changes. |
| `/skills` | View available Skills. |
| `/status` | View the thread ID, context usage, processes, and approval state. |

### Settings

| Setting | Effect |
| --- | --- |
| Theme | Switch between pure black and pure white. |
| Interface font | Choose an installed Windows font or enter a font family name. |
| Font size | Apply a size from 12 to 20 to the whole interface. |
| Accent color | Change the active border and control accent. |
| Default working directory | Set the directory used to start app-server and new threads. |
| PowerShell 7 path | Identify and remove the outer `pwsh -Command` wrapper from displayed commands. |
| MCP Gateway adaptation | Show the downstream service and tool for supported Gateway calls. |

Settings also shows the effective Codex model, provider, sandbox mode, approval policy, approval reviewer, reasoning effort, web-search mode, service tier, and permission profiles. These values come from Codex and are read-only here. Use the model and reasoning controls in each pane, and `/permissions` for an allowed thread permission mode.

### Approvals and structured output

Requests appear above the composer in the pane that triggered them. The app supports command execution, file changes, permissions, user questions, MCP forms, and MCP URL requests. A failed response stays available so it can be retried.

When Codex auto-review is active, its current state is shown in the footer. Each completed review is recorded in the conversation with the decision and any rationale or risk details returned by Codex; the same rationale is not repeated as a global banner.

Agent messages, plans, commands, file changes, MCP calls, searches, images, and background processes use dedicated cards. Command cards hide the outer PowerShell launcher when possible, and file changes use a readable diff with line counts instead of raw diff headers.

### User data

By default, all application and Chromium data is stored beside the executable:

```text
win-unpacked/
├─ Codex Pane.exe
└─ data/
   ├─ workspaces/
   ├─ media/
   ├─ files/
   ├─ logs/
   └─ chromium/
```

- `workspaces` stores the window, layouts, pane bindings, drafts, working directories, and attachment references.
- `media` stores validated local image copies for up to 30 days, with a 500 MB total limit.
- `files` stores ordinary file copies added through selection or paste.
- `logs` stores redacted diagnostics for up to 7 days.
- `chromium` contains browser preferences, local storage, cookies, sessions, network state, and caches.

Additional application instances use separate Chromium profiles to avoid profile locks. If the application directory is not writable, Codex Pane falls back to `%APPDATA%\codex-pane` and shows the effective location.

Keep `data` when replacing the unpacked application. Delete it only when its conversations, drafts, media, logs, and browser data are no longer needed.

### Scope and safety

- Codex Pane calls the local `codex app-server`; remote app-server connections are not supported.
- It does not save API keys, OAuth tokens, complete environment variables, or approval responses.
- Local images are validated and copied to `data/media`, while ordinary files are copied to `data/files`; app-server receives only the managed copy path.
- Closing or reconnecting stops the app-server process owned by that application instance.
- External links must use HTTPS and require confirmation before opening.
- The app has no installer, automatic update service, or built-in publishing flow.

## Development

Requires Node.js 24 or later and npm.

```powershell
npm install
npm run dev
```

Run the standard checks and build the unpacked Windows application:

```powershell
npm run verify
npm run test:e2e
npm run package:win
npm run test:packaged
```

Authenticated checks call a real Codex model and may incur API charges:

```powershell
npm run test:approval:live
npm run test:packaged:live
```

Regenerate the app-server protocol after changing the verified Codex baseline:

```powershell
npm run protocol:generate
codex app-server generate-json-schema --experimental --out packages/protocol/schema/generated
npm run protocol:manifest
```

Generated protocol files are read-only inputs. Keep compatibility code outside the generated directories.

## License

[MIT](LICENSE)
