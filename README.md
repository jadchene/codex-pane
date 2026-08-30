# Codex Pane

English | [简体中文](README.zh-CN.md)

Codex Pane is a Windows 11 Codex workbench built on Codex app-server. It runs the `codex` command already installed on your computer and brings sessions, models, permissions, tool calls, and task status into one desktop interface. Choose the multi-pane workspace to run several tasks in parallel, or the session sidebar to focus on one conversation and switch through your session history.

## Screenshots

### Multi-Pane

Run several independent sessions in one window. Each pane has its own session, working directory, model, reasoning effort, and permission state.

<img src="docs/screenshots/multi-pane.png" alt="Multi-pane workspace" width="50%">

### Session Sidebar

Focus on one session while browsing, searching, and switching sessions from the sidebar.

<img src="docs/screenshots/session-sidebar.png" alt="Session sidebar" width="50%">

Switch modes at any time in Settings.

## Quick Start

1. Make sure `codex` works in PowerShell 7.
2. Open the `win-unpacked` directory.
3. Run `Codex Pane.exe` and choose a default working directory.

## Features

- Create, resume, rename, and switch sessions.
- Set a global default working directory or a separate directory for each pane.
- View replies, commands, diffs, tool calls, approvals, images, subagents, and background tasks.
- Use `/` for commands, `@` for Skills, and `$` for workspace files.
- Attach local files and images, or paste images directly.
- Switch models, reasoning effort, and permission modes from the composer.
- Copy redacted connection and protocol diagnostics from Settings when troubleshooting.
- Use `F11` to enter or leave full screen; `Esc` and the floating top-right action also exit full screen.

When several attachments are added, unreadable files are reported individually while successful imports are kept. MCP forms and choice answers require an explicit submit and are never sent merely by selecting an option.

Commands: `/agents`, `/cd`, `/compact`, `/fast`, `/goal`, `/mcp`, `/new`, `/permissions`, `/plan`, `/ps`, `/rename`, `/resume`, `/review`, `/skills`, `/status`, `/stop`.

Application data is stored in the `data` directory beside the application.

## Development

Requires Node.js 24 or later.

```powershell
npm install
npm run dev
npm run verify
npm run package:win
```

`package:win` produces only the unpacked Windows application in `release/win-unpacked`. User data is stored in its adjacent `data` directory.

## License

[MIT](LICENSE)
