# Codex Pane

[English](README.md) | 简体中文

## 项目是什么

Codex Pane 是 Windows 11 上的本机 Codex 多窗格工作台，可在一个窗口中使用多个 Codex 会话。它直接调用电脑上已有的 Codex CLI。

## 为什么使用

- 最多同时处理六个会话。
- 每个窗格使用独立会话和工作目录。
- 清晰查看回复、命令、文件变更、工具调用、审批和图片。

## 快速开始

1. 确认 PowerShell 中可以运行 `codex`。
2. 下载并解压 `win-unpacked` 目录。
3. 运行 `Codex Pane.exe`，选择默认工作目录后即可使用。

## 参考

Codex Pane 支持多种窗格布局、会话新建与恢复、窗格独立工作目录、模型与推理强度选择、权限切换、Skills、附件、命令与差异展示、MCP 调用、审批、进程状态和用量状态。

可用命令：`/agents`、`/compact`、`/cwd`、`/kill-processes`、`/mcp`、`/new`、`/permissions`、`/processes`、`/resume`、`/review`、`/skills` 和 `/status`。

设置项包括主题、界面字体、字号、强调色、默认工作目录、PowerShell 7 路径和 MCP Gateway 适配。

应用数据默认保存在程序旁的 `data` 目录中。

## 开发

需要 Node.js 24 或更高版本。

```powershell
npm install
npm run dev
npm run verify
npm run package:win
```

## 许可证

[MIT](LICENSE)
