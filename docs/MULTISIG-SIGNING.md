# Multisig signing — how the board moves treasury funds

> Living doc. **Last updated: 2026-06-12** (configurable 1-phase/2-phase signing,
> script-in-witness-set, internal transfers, signer/initiator merit).

The treasury is a Cardano **native-script multisig**: `atLeast M-of-N` of the board's
payment keys (currently **3-of-5**). To spend, the final transaction must carry **M
valid vkey witnesses** over *that exact transaction body*, plus the script itself.
The ledger does **not** care *which* M of the N keys sign — only that ≥M valid
witnesses matching script keys are present.

How those M witnesses are collected is governed by the platform parameter
**`TX_SIGNING_PROCESS`** (Platform setup → dropdown):

| Value | Ceremony | Wallet requirement |
|---|---|---|
| `1_PHASE` (default) | every board member signs the tx **once**; the platform broadcasts on the 3rd signature (first-3-wins) | **Eternl** (a wallet that signs native-script inputs without being named in the body) |
| `2_PHASE` (fallback) | **Authorize** (cheap CIP-30 data-sig) → **Sign** (real witness); only the 3 who authorized may sign | any CIP-30 wallet |

Switching the parameter is safe at any time — see "Switching modes" below.

## 1-phase (default — requires Eternl)

- The platform builds **one shared unsigned tx** with **no `required_signers`**.
- The unsigned tx carries the **multisig script in its witness set**. That is how a
  wallet learns its key participates (there are no required_signers to tell it):
  the wallet parses the script, finds its payment-key hash among the N, and prompts.
  Without this, Eternl answers "this tx doesn't need my signature" and refuses.
  Attaching the script does **not** change the body hash, so it never invalidates
  witnesses.
- Every board member sees a single **Sign tx** button. Any of the N keyholders may
  witness; the **first 3 win** — on the 3rd witness the platform combines them with
  the native script and broadcasts.
- `POST /admin/board-actions/:id/commit` is **refused** in this mode (there is no
  Authorize step).

## 2-phase (fallback — any CIP-30 wallet)

Some wallets only prompt for a signature when their key is named in the body's
`required_signers`. Naming keys there makes the ledger **require exactly those**
signatures, so the signer set must be fixed *before* the body is built:

1. **Authorize (commit)** — each board member signs a short commit message with
   their wallet (CIP-30 `signData`; free, touches no funds).
   `POST /admin/board-actions/:id/commit` `{ signature, key, ts }`.
   Once `SIGNING_THRESHOLD (3)` members commit, the platform snapshots exactly those
   3 payment-key hashes onto the action (`committedKeyHashes`) — the signer set is
   fixed.
2. **Sign tx (witness)** — `GET /admin/board-actions/:id/tx-body` builds the
   unsigned tx with `required_signers` = the committed 3; each of them `signTx`s it
   and submits the witness via `POST /admin/board-actions/:id/witness`
   `{ witnessHex }`. **Only the 3 who authorized can sign** — the API rejects any
   witness whose key hash isn't in `committedKeyHashes`. On the 3rd witness:
   combine + broadcast.

```
1_PHASE:  PENDING_SIGS ──(any 3 of N witness the shared body)──▶ CONFIRMED
2_PHASE:  PENDING_SIGS ──(3 commits → keyhashes snapshotted)──▶ PENDING_SIGS (signing)
              └─(3 witnesses from exactly those 3)─────────────▶ CONFIRMED
both:         └─(any board member cancels, with reason)────────▶ FAILED
```

## Switching modes

The mode is read **per call**, so flipping the parameter applies immediately:

- A cached tx body built under the *other* mode is detected (2-phase bodies carry
  `required_signers`; 1-phase bodies don't) and **discarded together with any
  witnesses already collected** — they signed a different body hash, so keeping
  them would produce an invalid tx. The action simply restarts signature collection
  under the new mode; nothing strands.
- Garbage/missing parameter values resolve to `1_PHASE` (the default); the
  governance endpoint only accepts `1_PHASE`/`2_PHASE`.

## Broadcast (both modes)

On the threshold witness the platform wraps the body + vkey witnesses + native
script, submits via the configured submit path (own `cardano-submit-api` when
`CARDANO_SUBMIT_API_URL` is set, else Koios `/submittx`), and stamps the action
`CONFIRMED` with the tx hash. Then, per action kind: reward entries are stamped
paid (+ on-chain payout anchor), milestones get `paidAt`/`paidInTx` (+ pledge-return
check).

**Merit (§13.2):** every signer of a broadcast tx earns **+1 `TX_SIGNED`**; the
board member who *initiated* the action (hot-wallet top-up request, internal
transfer — stored as `initiator_user_id`) earns **+1 `TX_INITIATED`**. Both are
idempotent per action and awarded only once the tx reaches the network (no farming
via cancelled actions). Platform-prepared actions (auto top-up) have no initiator.

## Source of funds

A spend sources from its `sourceBucketId` (default: the Operations-flagged bucket;
NULL = the primary bare-multisig script). Buckets are **separate sub-addresses**, so
if the chosen bucket holds no UTxOs the build **falls back to the primary multisig**
and persists that choice — otherwise the combine step would attach the wrong script
and the chain would reject it (Missing/ExtraneousScriptWitnesses). Change returns to
the same source.

**Internal transfers** (Treasury → Actions → Internal transfers) are
`BOARD_TRANSFER` actions whose destination is **picked from the treasury buckets**
(no free-form address — funds can't leave the DAO through that form; source ≠
destination enforced; the panel self-hides with fewer than two addresses). They
follow the same signing ceremony and show as **INTERNAL** (yellow) in the
transaction history; real external sends show **red**.

## Cancel

Any board member can cancel a pending action
(`POST /admin/board-actions/:id/cancel` `{ reason ≥5 chars }`) → `FAILED`, which
drops it from the sign queue and the notification badge. Collected signatures are
discarded. Broadcast/confirmed actions cannot be cancelled.

## Why a multisig at all?

No single key can move the treasury — it needs a board quorum, survives one
lost/compromised key, and the requirement is enforced on-chain by Cardano, not by
trusting an operator. The tiny single-sig **hot wallet** (auto-generated on boot,
holds only a fee float) is what *doesn't* need the ceremony.

Implementation: `apps/api/src/treasury/multisig-broadcast.service.ts`
(`signingMode`, `commitToSign`, `prepareTxBody`, `submitWitness`,
`combineAndSubmit`, `ensureScriptAttached`) +
`apps/web/src/components/board-actions.tsx` (mode-aware UI) +
`apps/web/src/components/internal-transfer-panel.tsx`.
Tests: `tools/test-signing-mode.cjs`, `tools/test-internal-transfer.cjs`,
`tools/test-merit-tx.cjs`.
