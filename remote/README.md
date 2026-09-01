# Codex Pane Remote

English | [简体中文](README.zh-CN.md)

Codex Pane remote access uses a stable thin relay, a desktop Remote Bridge, and a desktop-delivered mobile UI. The relay does not understand Codex app-server, validate Passkeys, store accounts or devices, or persist messages. It serves the fixed bootstrap files and forwards opaque end-to-end encrypted WebSocket frames.

## Deploy the relay

Run `npm run package:relay` from the repository root to create a minimal, self-contained deployment directory at `release/relay-deploy`. Upload that directory to the server and follow its `README.md` or `README.zh-CN.md`.

1. Point a domain at the server and allow inbound TCP 80/443 and UDP 443.
2. Copy `relay/.env.example` to `relay/.env` and set `PANE_DOMAIN` to a hostname without a scheme or path. `PANE_BASE_PATH=/` is the default; set a prefix such as `/codex-pane-relay` when sharing an existing domain. Adjust the connection limits only when necessary.
3. Run `docker compose up -d --build` from `remote/relay`.
4. In Codex Pane, open Settings → Remote Access, enter `https://<your-domain>`, enable remote access, and save.
5. Generate a pairing QR code, scan it on the phone, and create a Passkey.
6. Confirm only when the six-digit codes on the phone and desktop match.

There is no relay enrollment secret, user database, or business-data backup. Only Caddy's certificate data and configuration use persistent Docker volumes. Relay restarts discard in-memory channels; the desktop and phones reconnect automatically.

The QR fragment contains a short-lived pairing secret and desktop public identity. A registered phone proves its device key to the relay for admission, then proves its Passkey directly to the desktop inside an authenticated encrypted session. Revoking a phone in desktop settings closes its active connection and requires a new QR pairing.

Each phone has a distinct short device fingerprint and can be revoked independently. “Sign out all phones” clears active login sessions only; each retained device can sign in again with its Passkey. Public deployments accept only a root HTTPS origin, while HTTP is limited to localhost development.

The relay sees network metadata such as IP addresses, channel identifiers, timing, and frame sizes. It cannot decrypt normal business traffic. Because the web bootstrap is downloaded from the relay domain, a fully compromised relay could still replace that bootstrap; use a separately trusted PWA or native client if this threat must also be covered.

## Updates

Desktop releases include their matching mobile business UI and deliver it through the encrypted channel. Conversation features and app-server protocol changes therefore do not require a relay update. Rebuild the relay only for relay security fixes, infrastructure changes, or an explicit outer-protocol upgrade.

The default Compose service runs the relay with a read-only root filesystem, no Linux capabilities, and `no-new-privileges`; it still has no business-data volume. The Caddy admin endpoint is disabled.

## Local development

Install dependencies and use `npm run dev`, `npm test`, and `npm run build` separately in `relay` and `mobile`.

WebAuthn requires a secure context. Use the production HTTPS deployment for phone testing; localhost is suitable only when the browser treats it as a trusted local origin.
