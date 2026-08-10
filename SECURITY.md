# Security Policy

The Innovation & Growth DAO platform holds custody-adjacent responsibilities: it
authenticates with Cardano wallets, coordinates a 3-of-5 native-script multisig
treasury, and anchors an audit trail on-chain. Security reports are taken
seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately via one of:

- GitHub's **[Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)**
  (Security tab → "Report a vulnerability"), or
- Email the maintainers (add your security contact address here before publishing).

Include, where possible:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected component(s) and version/commit,
- any suggested remediation.

We aim to acknowledge a report within a few business days and to keep you updated
as we investigate and fix. Please give us reasonable time to release a fix before
any public disclosure.

## Scope

Especially interested in:

- **Authentication / session** — wallet auth (CIP-30/CIP-8), CIP-95 DRep identity,
  JWT handling, the admin login + 2FA path.
- **Authorization** — role checks (Viewer / Submitter / DRep / Board / Admin),
  board-only and admin-only endpoints.
- **Treasury & signing** — native-script multisig construction, transaction
  assembly/broadcast, the 1-phase vs 2-phase signing flow.
- **On-chain verification** — anchoring correctness and the integrity of the
  Merkle-hash audit trail.
- **Financial logic** — fee/pledge verification, budget allocation, reward maths.

## Out of scope

- Vulnerabilities in third-party dependencies without a demonstrated exploit in
  this project (report those upstream; we track advisories separately).
- Issues that require a compromised operator machine, leaked `.env`, or physical
  access.
- The bundled Preprod **test** wallets, personas, and `genesis.json` — these are
  throwaway testnet identities, not secrets.

## Operational security notes for operators

- **Never commit `.env`** or any `*.skey` / `*.vkey` / wallet file — `.gitignore`
  already excludes them.
- Generate a strong `JWT_SECRET` (`openssl rand -hex 32`) per deployment.
- On Mainnet, admin 2FA is always required (`ADMIN_REQUIRE_2FA` cannot disable it).
- The on-chain anchoring hot wallet is intentionally low-balance and **separate**
  from the treasury multisig — keep it that way.
- See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and
  [docs/ANCHOR-WALLET.md](docs/ANCHOR-WALLET.md) for the secure operational setup.
