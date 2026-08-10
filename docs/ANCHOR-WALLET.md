# Platform wallets — anchor hot wallet & treasury (secure design)

The platform pays the small Cardano tx fees for **on-chain anchors** (one tx per
governance decision — votes are signed off-chain for free; only the decision is
anchored, §C). This describes who pays, how it's funded, and how to rotate keys
safely after a compromise.

## Two wallets

| Wallet | Purpose | Custody | Balance |
|---|---|---|---|
| **Treasury** | The DAO's funds. Source of truth for budget. | **3-of-5 native multisig** (the board's hardware wallets). | Full budget. |
| **Anchor hot wallet** | Pays ~0.2 ₳ per anchor tx (and future ops txs). | A single key held by the **operator** (env var / KMS), **not** in the app DB and **never** exposed in the UI. | **Minimal** — a small float (e.g. ≤ a few hundred ₳), enough for N anchors. |

The board **sees** both addresses + live balances in *Platform setup → Platform
wallets* (read-only oversight). The hot wallet's private key is never shown or
settable through the web app — a web compromise must not be able to exfiltrate or
swap signing keys.

## Funding flow

```
Treasury (3-of-5 multisig)  ──top-up──▶  Anchor hot wallet  ──fees──▶  on-chain anchors
        ▲ board signs                         (minimal float)
        │
   (Intersect / DAO income)
```

- The board periodically tops up the hot wallet from the treasury (a normal
  3-of-5 multisig payment). The hot wallet is kept low on purpose: if it's
  drained or its key leaks, the loss is bounded to the float.
- The platform raises an alert when the hot-wallet balance falls below a
  threshold so the board can top it up before anchors start failing
  (anchoring degrades gracefully — a decision still succeeds; its anchor is
  recorded as *pending* and can be re-submitted once funded).

## Configuration

- `ANCHOR_MNEMONIC` (or, in prod, a KMS-held key) — the hot-wallet signing key,
  an **operator secret**. Dev uses a 24-word mnemonic in `.env`.
- `TREASURY_ADDRESS` — the multisig address (display + balance only).
- The platform derives the hot-wallet address from its key and shows it; the
  board confirms that address is the one they fund.

## Key rotation (compromise response) — admin-managed, with an interlock

Rotation is a **platform-admin** action (DReps/board don't touch it), in the admin
dashboard → *Anchor hot wallet*. A two-step interlock prevents stranding funds:

1. **Move everything to the multisig** — `POST /sysadmin/wallet/sweep` sweeps all
   hot-wallet UTxOs to the treasury (multisig) in one tx. Until this leaves the hot
   wallet ≤ ~2 ₳, step 2 is disabled.
2. **Exchange the seed** — `POST /sysadmin/wallet/rotate-seed` generates a fresh
   24-word seed, stores it in the `platform_secret` table (overriding the env
   default, loaded on boot), and surfaces the new address. The seed is never
   returned to the UI. The DAO then funds the new address from the treasury.

Both steps require admin auth (the separate `/admin` session, 2FA) and are written
to the admin **audit log**.

**Security tradeoff (by design choice):** enabling in-platform rotation moves the
operator secret from env-only into the DB (`platform_secret`). That means an admin
account or DB compromise could swap the seed — mitigated by: the sweep interlock
(bounded float), admin-only + 2FA, the audit log, and the seed never being
displayed. **Production hardening:** hold the seed in a cloud KMS/HSM and have the
platform request signatures from a signing service rather than store the mnemonic.
