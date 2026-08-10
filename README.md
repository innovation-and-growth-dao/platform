# Innovation & Growth DAO

A self-hosted web platform for a Cardano governance & funding DAO: DReps
collectively review funding proposals in Catalyst-style rounds, run internal
governance votes, manage a 3-of-5 native-script multisig treasury, and pay
rewards. The backend + Postgres are the **source of truth**; the chain is used
for wallet auth (CIP-30/CIP-8), DRep identity (CIP-95), the multisig treasury,
fee/pledge verification, and daily Merkle-hash **anchoring** for independent
verifiability. There is **no Plutus/Aiken on-chain logic** (see design §21.2).

> This repository is the **Innovation & Growth DAO** edition. The same code base
> also ships a **DRep DAO** governance edition — the brand (tab title + icon) is
> selected at build time via `NEXT_PUBLIC_APP_NAME`. See
> [`apps/web/src/lib/brand.ts`](apps/web/src/lib/brand.ts).

- **User guide:** [docs/USER-GUIDE.md](docs/USER-GUIDE.md)
- **Full design:** [docs/DESIGN.md](docs/DESIGN.md)
- **Deployment:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Configurable parameters:** [docs/PARAMETERS.md](docs/PARAMETERS.md)
- **Test report:** [docs/TEST-REPORT.md](docs/TEST-REPORT.md)

## Architecture

```
innovation-growth-dao/
├── apps/
│   ├── web/        Next.js 15 + React 19 frontend (MeshJS wallet integration)
│   └── api/        NestJS backend — REST API, scheduled jobs, source of truth
├── packages/
│   ├── shared/     Shared types, enums, status/role constants, config defaults
│   ├── cardano/    Cardano integration (queries, wallet helpers, anchoring)
│   └── db/         Prisma schema, migrations, seed data
├── infra/          docker-compose for local Postgres + Redis
├── tools/          end-to-end test suites
└── docs/           design, user guide, deployment, parameters, test report
```

Monorepo: **pnpm workspaces + Turborepo**.

## Prerequisites

- **Node.js ≥ 20** (developed on 24; see `.nvmrc`)
- **pnpm 9** (`corepack enable pnpm`)
- **Docker + Docker Compose**, for local Postgres 16 + Redis 7
  - On WSL2: install Docker Desktop and enable WSL integration for this distro,
    or install the Docker engine inside WSL.

## Getting started

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment (edit values as needed; never commit .env)
cp .env.example .env

# 3. Start local Postgres + Redis
pnpm infra:up

# 4. Create the database schema and seed defaults
pnpm db:generate              # generate the Prisma client
pnpm db:migrate               # apply migrations
pnpm db:seed                  # seed platform_config + subcategories

# 5. Run everything in dev
pnpm dev                      # web on :3000, api on :4000
```

Health check: `curl http://localhost:4000/healthz`.

To log in you need a CIP-30 wallet (Lace/Eternl) set to the configured network
(`CARDANO_NETWORK`, Preprod by default). See the
[user guide](docs/USER-GUIDE.md) for roles and the full walkthrough.

## Quality checks

These are exactly what CI runs (`.github/workflows/ci.yml`):

```bash
pnpm typecheck     # strict TypeScript across all packages (the static-analysis gate)
pnpm test          # unit tests (vitest): shared / cardano / api
pnpm build         # production build of every package
pnpm format:check  # Prettier formatting (pnpm format to apply)
```

End-to-end suites (`pnpm test:e2e`) need a live Postgres + Redis and funded
Preprod test wallets; see [docs/TEST-REPORT.md](docs/TEST-REPORT.md).

## Deployment

Production deployment (systemd + Nginx, or your process manager of choice) is
documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
