# Codex Pane Relay deployment

This directory is a self-contained Relay deployment package. It does not contain the Codex Pane desktop application or mobile business interface.

## Deploy

1. Point a domain name to the server and allow TCP 443. Allow TCP 80 when available; UDP 443 is optional.
2. Copy `.env.example` to `.env` and set `PANE_DOMAIN` to the domain name without a scheme or path. Keep `PANE_BASE_PATH=/` for a root deployment, or set a path such as `/codex-pane-relay` when sharing an existing domain.
3. Run:

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f
```

4. Check `https://<your-domain>/health` for a root deployment or `https://<your-domain>/codex-pane-relay/health` for a path deployment.
5. Enter the same complete URL in Codex Pane under Settings → Remote access, for example `https://www.example.com/codex-pane-relay`.

If the server already has an HTTPS entry point, run `docker compose -f docker-compose.proxy.yml up -d --build`. Relay then listens only on `127.0.0.1:8787`. Configure the existing reverse proxy to preserve the configured path prefix when forwarding requests to that port. For Nginx, use `proxy_pass http://127.0.0.1:8787` without a trailing slash and enable WebSocket forwarding.

To update the deployment, replace this directory with a newly generated package while keeping `.env`, then run `docker compose up -d --build` again.
