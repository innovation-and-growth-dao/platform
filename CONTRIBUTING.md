# Contributing to Innovation & Growth DAO

Thanks for your interest in improving the platform. This guide covers how to set
up the project, the quality bar, and how to propose changes.

## Getting set up

Prerequisites and the local setup are in the [README](README.md#getting-started).
In short:

```bash
pnpm install
cp .env.example .env
pnpm infra:up          # local Postgres 16 + Redis 7 via Docker
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev               # web on :3000, api on :4000
```

## Project layout

Monorepo (pnpm workspaces + Turborepo):

- `apps/web` — Next.js 15 / React 19 frontend
- `apps/api` — NestJS backend (REST API, scheduled jobs) — the source of truth
- `packages/shared` — types, enums, role/status constants, platform-config defaults
- `packages/cardano` — Cardano integration (queries, wallet helpers, anchoring)
- `packages/db` — Prisma schema, migrations, seeds
- `docs/` — design document, parameters, user guide, deployment, test report

## Quality bar

Every change must keep the following green — this is exactly what CI runs
(`.github/workflows/ci.yml`):

```bash
pnpm typecheck     # strict TypeScript across all packages (the static-analysis gate)
pnpm test          # unit tests (vitest) in shared / cardano / api
pnpm build         # production build of every package
```

Formatting is handled by Prettier (`.prettierrc`):

```bash
pnpm format        # apply
pnpm format:check  # verify
```

There is no ESLint configuration; strict `tsc` is the linter of record.

### Tests

- **Unit tests** live next to the code as `*.spec.ts` and run with `pnpm test`.
  Pure logic (allocation maths, tallies, state classifiers, config guards) is
  extracted into standalone modules specifically so it can be unit-tested without
  a database — please keep that pattern and add tests for new logic.
- **End-to-end suites** live in `tools/` and run with `pnpm test:e2e`. They need a
  live Postgres + Redis and funded Preprod test wallets (see
  [docs/TEST-REPORT.md](docs/TEST-REPORT.md)), so they are not part of the default
  CI. Run them locally when touching signing, treasury, or round-lifecycle flows.

If you change behaviour, add or update a test that would have caught the old
behaviour. Bug fixes should come with a test that reproduces the bug.

## Database changes

Schema changes go through Prisma migrations:

```bash
# after editing packages/db/prisma/schema.prisma
pnpm --filter @drep-dao/db exec prisma migrate dev --name <short_description>
```

Never edit an already-applied migration; add a new one. Migrations are applied in
production with `prisma migrate deploy` (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Making a change

1. Branch off the default branch.
2. Keep changes surgical — every changed line should trace to the stated goal
   (see [CLAUDE.md](CLAUDE.md) for the working guidelines this repo follows).
3. Ensure `pnpm typecheck && pnpm test && pnpm build` pass.
4. Open a pull request describing **what** changed and **why**, and how you
   verified it. Reference any related issue.

## Reporting bugs & requesting features

Open a GitHub issue. For bugs, include steps to reproduce, what you expected, and
what happened (with logs where relevant). **Do not** file security issues as
public issues — see [SECURITY.md](SECURITY.md).

## Design decisions

The platform is deliberately **off-chain source of truth with on-chain
anchoring** — there is no Plutus/Aiken on-chain logic. Please read the relevant
part of [docs/DESIGN.md](docs/DESIGN.md) before proposing architecture changes,
and open an issue to discuss significant ones first.

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
