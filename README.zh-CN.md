# Codex Pane

[English](README.md) | 简体中文

Codex Pane 是 Windows 11 上的本机 Codex 工作台，直接使用电脑中已安装的 Codex CLI。

## 效果图

### 多窗格模式

在一个窗口中同时使用多个独立会话。每个窗格拥有自己的会话、工作目录、模型、推理强度和权限状态。

![多窗格模式](docs/screenshots/multi-pane.png)

### 会话侧栏模式

集中使用一个会话，通过侧栏浏览、搜索和切换其他会话。

![会话侧栏模式](docs/screenshots/session-sidebar.png)

两种模式可随时在设置中切换。

## 快速开始

1. 确认 PowerShell 7 中可以运行 `codex`。
2. 打开 `win-unpacked` 目录。
3. 运行 `Codex Pane.exe`，选择默认工作目录。

## 功能

- 新建、恢复、重命名和切换会话。
- 设置全局默认工作目录，也可为每个窗格单独设置。
- 查看回复、命令、差异、工具调用、审批、图片、子代理和后台任务。
- 使用 `/` 选择命令，`@` 使用 Skill，`$` 引用工作区文件。
- 添加本地文件和图片，也可直接粘贴图片。
- 在输入区切换模型、推理强度和权限模式。

命令：`/agents`、`/cd`、`/compact`、`/fast`、`/goal`、`/mcp`、`/new`、`/permissions`、`/plan`、`/ps`、`/rename`、`/resume`、`/review`、`/skills`、`/status`、`/stop`。

应用数据保存在程序旁的 `data` 目录中。

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
