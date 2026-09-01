# Codex Pane 远程端

[English](README.md) | 简体中文

Codex Pane 远程访问由稳定的极简中转、桌面 Remote Bridge 和桌面下发的手机页面组成。中转服务不理解 Codex app-server，不验证 Passkey，不保存账号、设备和消息；它只提供固定引导文件，并透传不透明的端到端加密 WebSocket 帧。

## 部署中转服务

在仓库根目录运行 `npm run package:relay`，会在 `release/relay-deploy` 生成可独立上传的最小部署目录。将整个目录上传到服务器，然后按照目录中的 `README.md` 或 `README.zh-CN.md` 操作。

1. 将域名解析到服务器，并开放 TCP 80/443 和 UDP 443。
2. 将 `relay/.env.example` 复制为 `relay/.env`，填写不带协议和路径的域名 `PANE_DOMAIN`。默认 `PANE_BASE_PATH=/`；复用现有域名时可以配置 `/codex-pane-relay` 等路径前缀。只有确有需要时才调整连接上限。
3. 在 `remote/relay` 中运行 `docker compose up -d --build`。
4. 在 Codex Pane 中打开“设置 → 远程访问”，填写 `https://<你的域名>`，启用并保存。
5. 生成配对二维码，用手机扫描并创建 Passkey。
6. 只有手机和桌面的 6 位数字一致时，才在桌面确认绑定。

中转服务没有首次绑定密钥、用户数据库和业务数据备份。Docker 持久卷只用于保存 Caddy 的证书数据和配置。中转进程重启会丢弃内存通道，桌面与手机随后自动重连。

二维码片段包含短时配对秘密和桌面身份公钥。已登记手机先使用设备密钥向中转证明准入资格，再在经过身份校验的加密会话内直接向桌面证明 Passkey。桌面设置中撤销手机后，当前连接会立即关闭，再次使用必须重新扫码绑定。

每部手机都显示独立的短设备指纹，可分别撤销；“退出所有手机”只清除当前登录会话，之后仍可使用各自的 Passkey 重新登录。公网部署只接受 HTTPS 根地址，本机开发才允许 localhost 的 HTTP 地址。

中转仍能看到 IP、通道标识、连接时间和帧大小等网络元数据，但无法解密正常业务消息。由于网页引导代码来自中转域名，完全被攻陷的中转仍可能替换引导代码；若必须覆盖该威胁，应使用独立可信发布的 PWA 或原生手机端。

## 更新策略

桌面安装包包含与自身版本匹配的手机业务页面，并通过加密通道下发。会话功能和 app-server 协议变化不要求更新中转服务。只有修复中转自身安全问题、调整基础设施或明确升级外层协议时，才需要重新构建中转。

默认 Compose 以只读根文件系统、无额外 Linux capabilities 和 `no-new-privileges` 运行 Relay；Relay 仍不挂载业务数据卷。Caddy 管理接口已关闭。

## 本地开发

分别在 `relay` 和 `mobile` 中安装依赖并运行 `npm run dev`、`npm test` 和 `npm run build`。

WebAuthn 只能在安全上下文中使用。手机真机测试应使用生产 HTTPS 部署；只有浏览器认可的本机可信来源才适合用 localhost 调试。
