# Deployment

Production deployment guide for the Innovation & Growth DAO platform. The stack
is a NestJS API + Next.js web app backed by Postgres and Redis. This guide uses
systemd + Nginx as a concrete example; any process manager and reverse proxy
work the same way.

> Values like the domain, database credentials and secrets are **examples** —
> substitute your own. **Never commit `.env`.**

## 1. Server prerequisites

- Linux host (this project is run on Ubuntu/Debian).
- **Node.js ≥ 20** and **pnpm 9** (`corepack enable pnpm`).
- **Postgres 16** and **Redis 7** — either the bundled Docker services
  (`infra/docker-compose.yml`) or managed instances.
- A reverse proxy terminating TLS (Nginx, Caddy, …).

## 2. Get the code and configure

```bash
sudo mkdir -p /opt/innovation-growth-dao && cd /opt/innovation-growth-dao
# deploy the repository here (git clone, git archive, CI artifact, …)

cp .env.example .env
# edit .env — see the checklist below
```

### Production `.env` checklist

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string for the production DB. |
| `REDIS_URL` | Redis connection string. |
| `JWT_SECRET` | **Generate a strong secret:** `openssl rand -hex 32`. |
| `LOGIN_DOMAIN` | Shown in the wallet-signing prompt (e.g. your DAO name). |
| `ADMIN_REQUIRE_2FA` | `true` in production. On Mainnet 2FA is enforced regardless. |
| `CORS_ORIGINS` | Your web origin(s), comma-separated (e.g. `https://dao.example.org`). |
| `NEXT_PUBLIC_API_URL` | Public URL the browser calls (your API origin). Inlined at build. |
| `NEXT_PUBLIC_APP_NAME` | Brand: `Innovation & Growth DAO` (or `DRep DAO`). Inlined at build. |
| `CARDANO_NETWORK` | `Preprod` or `Mainnet`. |
| `BLOCKFROST_PROJECT_ID` | Blockfrost project id for the chosen network. |
| `KOIOS_URL` | Free fallback read provider (network-specific base URL). |
| `DAO_MULTISIG_ADDRESS` | Default treasury address for new rounds. |
| `ANCHOR_HOT_WALLET_SKEY` | Bech32 skey of the **low-balance** anchoring wallet — **not** the treasury. Keep out of git. See [ANCHOR-WALLET.md](ANCHOR-WALLET.md). |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email (optional). |

> `NEXT_PUBLIC_*` values are compiled into the web bundle, so they must be set
> **before** `pnpm build`.

## 3. Install, migrate, build

```bash
cd /opt/innovation-growth-dao
set -a && . ./.env && set +a          # load env for the build/migrate steps

pnpm install --prod=false             # dev deps are needed to build
pnpm --filter @drep-dao/db exec prisma migrate deploy   # apply DB migrations
pnpm build                            # builds all packages (api dist/, web .next/)
```

`prisma migrate deploy` is idempotent and applies only pending migrations — run
it on every release.

### First release only — seed and bootstrap

```bash
pnpm db:seed                          # platform_config defaults + subcategories
# Seat the founding board from genesis.json (edit it for your DAO first):
pnpm bootstrap:board
# Create the platform admin account (interactive):
pnpm admin:create
```

Membership is **open by default** (`DREP_OPEN_ADMISSION`), so registered DReps
can join and vote — including passing the internal proposal that installs the
board — before any board is seated. Adjust in **Platform setup** later.

## 4. Run the services

Run two long-lived processes: the API (`node dist/main.js` in `apps/api`) and the
web server (`next start` in `apps/web`). Example systemd units:

`/etc/systemd/system/igdao-api.service`

```ini
[Unit]
Description=Innovation & Growth DAO API (NestJS)
After=network.target

[Service]
WorkingDirectory=/opt/innovation-growth-dao/apps/api
EnvironmentFile=/opt/innovation-growth-dao/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
User=igdao

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/igdao-web.service`

```ini
[Unit]
Description=Innovation & Growth DAO Web (Next.js)
After=network.target

[Service]
WorkingDirectory=/opt/innovation-growth-dao/apps/web
EnvironmentFile=/opt/innovation-growth-dao/.env
ExecStart=/usr/bin/pnpm start
Restart=on-failure
User=igdao

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now igdao-api igdao-web
systemctl is-active igdao-api igdao-web
```

The API listens on `API_PORT` (default 4000); the web app on 3000.

## 5. Reverse proxy (Nginx example)

Serve the web app at your domain and proxy `/api` to the API. Example:

```nginx
server {
    server_name dao.example.org;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # TLS via certbot / your ACME client.
}
```

Set `NEXT_PUBLIC_API_URL` to the public API URL (e.g. `https://dao.example.org/api`)
and `CORS_ORIGINS` to the web origin, then rebuild.

## 6. Updating an existing deployment

```bash
cd /opt/innovation-growth-dao
# deploy the new code (git pull / archive / artifact)
set -a && . ./.env && set +a
pnpm install --prod=false
pnpm --filter @drep-dao/db exec prisma migrate deploy
pnpm build
sudo systemctl restart igdao-api igdao-web
```

For a web-only change (no API or DB change), restarting `igdao-web` is enough.

## 7. Health & verification

- API health: `curl https://dao.example.org/api/healthz` → `ok`.
- The footer of the web app shows API / DB / Redis status.
- On-chain anchoring and its wallet are covered in
  [ANCHOR-WALLET.md](ANCHOR-WALLET.md); treasury multisig in
  [TREASURY.md](TREASURY.md) and [MULTISIG-SIGNING.md](MULTISIG-SIGNING.md).

## 8. Operational security

- Keep `.env`, `*.skey`, `*.vkey` and wallet files off the server's git and out
  of backups that leave the host.
- The anchoring hot wallet is intentionally low-balance and separate from the
  treasury multisig.
- Run the API and web under an unprivileged user.
- See [SECURITY.md](../SECURITY.md).
