# Codex Pane

English | [简体中文](README.zh-CN.md)

## What This Project Is

Codex Pane is a Windows 11 desktop workbench for using multiple local Codex conversations in one window. It uses the Codex CLI already installed on your computer.

## Why Use It

- Work with up to six conversations at once.
- Give each pane its own conversation and working directory.
- View replies, commands, file changes, tool calls, approvals, and images clearly.

## Quick Start

1. Make sure `codex` works in PowerShell.
2. Download and open the `win-unpacked` directory.
3. Run `Codex Pane.exe` and choose a default working directory.

## Reference

Codex Pane supports multiple layouts, session creation and recovery, per-pane working directories, model and reasoning selection, permission switching, Skills, attachments, command and diff display, MCP calls, approvals, process status, and usage status.

Available commands: `/agents`, `/compact`, `/cwd`, `/kill-processes`, `/mcp`, `/new`, `/permissions`, `/processes`, `/resume`, `/review`, `/skills`, and `/status`.

Settings include theme, interface font, font size, accent color, default working directory, PowerShell 7 path, and MCP Gateway adaptation.

Application data is stored in the `data` directory beside the application when possible.

## Development

Requires Node.js 24 or later.

```powershell
npm install
npm run dev
npm run verify
npm run package:win
```

## License

[MIT](LICENSE)
