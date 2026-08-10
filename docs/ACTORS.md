# Test actors (Preprod) — FIXED

The **stable** test cast. Do not regenerate. Seeds live in `tools/persona-wallets.json`
(gitignored). Import each 24-word seed as a **separate** wallet in Lace/Eternl
(choose **24-word** recovery), network = **Preprod**.

DREP is an **on-chain role**: a wallet is a DRep only if its DRep key is
registered + active on-chain (verified at login via Koios). Board members are
registered DReps seated through the admin-confirmed `genesis.json`. ADA holders
are wallets with no on-chain DRep registration (viewer + submitter only).

| Actor | Intended role | Stake address | DRep ID (CIP-129) |
|---|---|---|---|
| **Alice (Founding Board)** | BOARD | `stake_test1upn85fz4mdst939ymhfrgtppgc74tfr9mhwyp8u6vpxa7pgrtye29` | `drep1y22y7e70anzrjy8dker0k8q7350gu49dtrd3gpwgc5f84zq80yv0z` |
| **Dave (Founding Board)** | BOARD | `stake_test1upcs88jsuhpgqnccat827rjcxjq7efau9rurtj5nlr6lc3s8g4q0z` | `drep1y26xrktxrqqsd7yqs8tfpgvraynw29hsvzrkl5mgqnqffwsv8dyvz` |
| **Erin (Founding Board)** | BOARD | `stake_test1urc0amea4df7yyppxkhhr3hvqzfqzv742sykteglpuhdynse2h3zl` | `drep1ygne46zv9vp2utuw50c6xex5dtr2mcqetjc6wp0djrke4ys0slh40` |
| **Frank (Founding Board)** | BOARD | `stake_test1ur2ktqsmpkh00r8nrktu3afg9w4s7mdsrzsz737l27s728qv9ss26` | `drep1ygeace557eucst8legz7d8q28wk9047ua2u45zn6026yn0chzncke` |
| **Grace (Founding Board)** | BOARD | `stake_test1uqyze98kz9gycnafxv74prx6k93r20hqdwdtfnu5e7jm34cgjqypp` | `drep1yg8flsxc8lj7dw60wg4mcfsg6s9k59esgcdnrjtgvp76wys2dfqpj` |
| **Heidi (Voting DRep)** | DREP | `stake_test1urqnffpu3rcz983hssdglx4t7whrg2f7raklq6kl3erpwsq26d76v` | `drep1yf449phu0hf3cdtw3jenx70kz9w983hw7z7qutf7rfya4qqcx7kae` |
| **Ivan (Voting DRep)** | DREP | `stake_test1uqdqtxrr0nz8hcdjxzlds90834y5hlgspjwj6yv55f09zgcrzk58r` | `drep1ytkhgyn89pw5tervr5gyxsc2defuxznfruta4fkmlzn6rhgt5rn2t` |
| **Judy (Voting DRep)** | DREP | `stake_test1uq80gf28ywccc9yvrg4rdcmrw2ewenvqe0a63l84qtly02g2tdw4r` | `drep1yfshmj2hkjlsq6tmju5z38rqna30nca6j0c2nhe67xzj07cr63pa3` |
| **Bob (ADA holder / funder)** | HOLDER | `stake_test1urqn2e07tp6qa556rjc2pskxdlh7xhwxsushx5ug53xjevsan47jx` | `drep1ytwhq9236d0v0m4xq7nrw6xeqptpk6wchyukwrpk5xmsn2sa3jf6y` |
| **Carol (ADA holder)** | HOLDER | `stake_test1urqw60ntj3v8pwxr7veg7wnncn4anjlzx0geg9dl3536khg6j0ttd` | — |

**Admin** (separate auth): Platform Admin at `/admin/login`, username `satucha`
(dev password via `pnpm admin:create`).

## Cast composition
- **5 board members** (registered DReps, seated in genesis): Alice, Dave, Erin, Frank, Grace
- **3 voting DReps** (registered, non-board): Heidi, Ivan, Judy
- **2 ADA holders** (not registered): Bob (also the funding source), Carol

## On-chain setup (programmatic)
1. `node tools/gen-cast.cjs` — generate the fixed wallets (this file).
2. `node tools/fund-cast.cjs` — Bob funds the 7 new wallets (~600 tADA each).
3. `node tools/register-dreps.cjs` — each of the 7 self-registers as a DRep on-chain (500 tADA deposit).
4. `node tools/seat-board.cjs` — write `genesis.json` (5 board) + verify + seat.
