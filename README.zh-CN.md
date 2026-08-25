# Codex Pane

[English](README.md) | 简体中文

## 项目是什么（What This Project Is）

Codex Pane 是面向 Windows 11 的本机 Codex 多窗格工作台。它连接电脑上已有的 Codex CLI，把独立会话放在一个窗口中的单窗格、双窗格、四窗格或六窗格布局中。

Codex Pane 不附带 Codex，也不保存 Codex 凭据。它复用现有的 Codex 账号、配置、MCP 服务、Skills 和历史会话。

当前 `0.1.0` 版本只提供 Windows `win-unpacked` 目录，没有安装程序或自动更新功能。

## 为什么使用（Why Use It）

- 在一个工作台中同时处理最多六个互不串线的 Codex 会话，无需管理多个终端。
- 每个窗格独立保存工作目录、模型、推理强度、草稿、附件和滚动位置。
- 用清晰的卡片查看命令、文件变更、MCP 调用、计划、搜索、图片和审批，而不是协议消息。
- 在请求发生的窗格中直接处理权限、命令确认、用户问答和 MCP 表单。
- 从输入框直接使用 `/` 命令、`@` Skills、图片和文件引用。
- 用户数据保存在程序旁，整个解包目录便于移动和备份。

## 快速开始（Quick Start）

### 使用条件

- Windows 11 x64。
- `PATH` 中可以运行 `codex`。
- 已完成 Codex 登录或 API 配置。

Codex Pane 已完整验证 `codex-cli 0.149.1`。其他版本可能也能使用，但超出已验证范围时应用会给出提示。

### 启动应用

1. 保持整个 `win-unpacked` 目录结构不变，并放到可写位置。
2. 运行 `Codex Pane.exe`。
3. 如有需要，在设置中选择全局默认工作目录。
4. 选择布局，输入任务并按 Enter 发送。

应用无需安装。升级时替换程序文件，但要保留旁边的 `data` 目录。

如果无法连接 Codex，请先在 PowerShell 中运行 `codex --version`，处理界面提示的问题，再点击标题栏中的重连按钮。

## 参考（Reference）

### 窗格与会话

- 支持单窗格、左右双栏、上下双栏、四方格和固定 2×3 六窗格。
- 每个窗格独立保存会话设置和草稿；同一个会话不能同时在两个窗格中编辑。
- 应用重启后会恢复分隔比例、窗口大小、当前窗格和会话绑定。
- 恢复会话页面填满当前窗格，其他窗格仍可继续使用。
- 会话运行期间再次发送消息会追加指令；点击停止可中断当前任务。
- 进入全屏后隐藏自定义标题栏。

状态栏集中显示当前模型、推理强度、工作状态、审批状态、上下文用量，以及可用的 5 小时和 7 天额度。窄窗格会按完整项目换行，不会截断内容。

### 工作目录

在设置中选择全局默认工作目录后，Codex Pane 会显式在该目录中启动 `codex app-server`。

使用 `/cwd` 可以只修改当前窗格的工作目录。实际生效顺序为：

1. 窗格独立工作目录。
2. 全局默认工作目录。
3. 未设置默认值时的应用目录。

恢复的历史会话会保留自己的工作目录。

### 输入框

| 操作 | 使用方式 |
| --- | --- |
| 发送 | 按 Enter。 |
| 换行 | 按 Shift+Enter。 |
| 斜杠命令 | 输入 `/` 或点击 `/` 按钮，再按 Tab 或 Enter 选择。 |
| Skills | 输入 `@` 或点击 `@` 按钮，再选择 Skill。 |
| 附件 | 点击附件按钮，选择图片或普通文件。 |
| 粘贴图片 | 粘贴剪贴板图片、Windows 图片路径或 HTTPS 图片地址；支持多张图片。 |
| 切换窗格 | 按 Alt+方向键。 |
| 滚动到底部 | 输入框为空时按方向键下。 |

选中的 Skill 会以 `@Skill名称` 保留在输入框中，并作为结构化 Skill 输入发送。普通文件作为文件引用发送。`[Image #N]` 只是界面中的附件标签，Codex 实际收到对应的结构化图片输入。

每个窗格最多添加 20 张图片和 20 个文件引用。本地图片最大 15 MB，单边不超过 8192 像素，总像素不超过 4000 万。

### 斜杠命令

| 命令 | 用途 |
| --- | --- |
| `/agents` | 查看和切换可用代理。 |
| `/compact` | 压缩当前会话。 |
| `/cwd` | 修改当前窗格的工作目录。 |
| `/kill-processes` | 停止当前会话的所有后台进程。 |
| `/mcp` | 查看可用 MCP 服务和工具。 |
| `/new` | 在当前窗格新建会话。 |
| `/permissions` | 查看并切换 Codex 允许使用的权限模式。 |
| `/processes` | 查看后台进程。 |
| `/resume` | 在当前窗格恢复历史会话。 |
| `/review` | 审查当前文件变更。 |
| `/skills` | 查看可用 Skills。 |
| `/status` | 查看会话 ID、上下文用量、后台进程和审批状态。 |

### 设置

| 设置项 | 作用 |
| --- | --- |
| 主题 | 在纯黑和纯白主题间切换。 |
| 界面字体 | 选择 Windows 已安装字体，也可以直接输入字体名称。 |
| 字号 | 将 12 到 20 的字号应用到整个界面。 |
| 强调色 | 修改当前边框和控件的强调色。 |
| 全局默认工作目录 | 设置 app-server 和新会话使用的工作目录。 |
| 命令外壳路径 | 识别命令显示所使用的 PowerShell 兼容外壳。 |
| MCP Gateway 适配 | 为支持的 Gateway 调用显示实际下游服务和工具。 |

设置页还会显示 Codex 当前生效的模型、模型提供方、沙箱模式、操作确认策略、确认评审方、推理强度、联网搜索模式、服务层级和权限配置。这些内容由 Codex 提供，在设置页中只读。模型和推理强度在各窗格中切换；允许使用的会话权限模式通过 `/permissions` 切换。

### 审批与内容展示

待处理请求显示在触发它的窗格输入区上方。应用支持命令执行、文件修改、权限申请、用户问答、MCP 表单和 MCP URL 请求。提交失败的请求会保留，可以再次尝试。

启用 Codex 自动审批后，当前状态会显示在状态栏中。每次完成的审批会在会话中留下记录，并展示 Codex 返回的结果、理由和风险信息；同一理由不会再重复显示为应用顶部横幅。

Agent 回复、计划、命令、文件变更、MCP 调用、联网搜索、图片和后台进程都有对应的展示卡。命令会尽量隐藏外层 PowerShell 启动参数；文件变更使用带行数统计的可读 Diff，不直接展示原始 Diff 头。

### 用户数据

默认情况下，应用数据和 Chromium 数据都保存在程序旁：

```text
win-unpacked/
├─ Codex Pane.exe
└─ data/
   ├─ workspaces/
   ├─ media/
   ├─ logs/
   └─ chromium/
```

- `workspaces` 保存窗口、布局、窗格绑定、草稿、工作目录和附件引用。
- `media` 保存校验后的本地图片副本，最长保留 30 天，总量上限 500 MB。
- `logs` 保存脱敏诊断，最长保留 7 天。
- `chromium` 包含浏览器偏好设置、本地存储、Cookies、会话、网络状态和缓存。

同时启动多个应用实例时，会使用不同的 Chromium profile，避免目录锁冲突。如果程序目录不可写，Codex Pane 会回退到 `%APPDATA%\codex-pane`，并显示最终生效位置。

替换解包程序时请保留 `data`。只有确认其中的会话、草稿、媒体、日志和浏览器数据都不再需要时，才删除该目录。

### 使用范围与安全

- Codex Pane 直接调用本机 `codex app-server`，不支持远程 app-server。
- 应用不保存 API Key、OAuth Token、完整环境变量或审批响应。
- 本地图片经过校验后复制到应用管理目录；持久化的远程图片地址使用 Windows DPAPI 保护。
- 关闭应用或重新连接时，会停止当前应用实例拥有的 app-server 进程。
- 外部链接必须使用 HTTPS，并在打开前经过确认。
- 应用没有安装程序、自动更新服务或内置发布流程。

## 开发（Development）

需要 Node.js 24 或更高版本及 npm。

```powershell
npm install
npm run dev
```

运行常规验证并构建 Windows 解包目录：

```powershell
npm run verify
npm run test:e2e
npm run package:win
npm run test:packaged
```

真实联调会调用 Codex 模型，可能产生 API 费用：

```powershell
npm run test:approval:live
npm run test:packaged:live
```

更换 Codex 验证基线后，重新生成 app-server 协议：

```powershell
npm run protocol:generate
codex app-server generate-json-schema --experimental --out packages/protocol/schema/generated
npm run protocol:manifest
```

生成的协议文件只作为只读输入；兼容代码应放在生成目录之外。

## 许可证（License）

[MIT](LICENSE)
