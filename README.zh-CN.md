# Codex Pane

[English](README.md) | 简体中文

Codex Pane 是基于 Codex app-server 的 Windows 11 本机 Codex 工作台。它直接调用电脑中已安装的 `codex` 命令，将会话、模型、权限、工具调用和任务状态集中到一个桌面界面中。你可以使用多窗格工作台并行处理多个任务，也可以切换到会话侧栏，专注当前对话并快速浏览历史会话。

## 效果图

### 多窗格模式

在一个窗口中同时使用多个独立会话。每个窗格拥有自己的会话、工作目录、模型、推理强度和权限状态。

<img src="docs/screenshots/multi-pane.png" alt="多窗格模式" width="50%">

### 会话侧栏模式

集中使用一个会话，通过侧栏浏览、搜索和切换其他会话。

<img src="docs/screenshots/session-sidebar.png" alt="会话侧栏模式" width="50%">

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
- 在设置中复制已脱敏的连接与协议诊断，便于排查问题。
- 使用 `F11` 进入或退出全屏；全屏时也可按 `Esc` 或点击右上角按钮退出。

批量添加附件时，无法读取的文件会单独报告，已经成功导入的文件会保留。MCP 表单与选项回答都需要明确点击提交，不会在选择时立即发送。

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

`package:win` 只生成 `release/win-unpacked` 免安装目录，用户数据保存在其同级 `data` 目录中。

## 许可证

[MIT](LICENSE)
