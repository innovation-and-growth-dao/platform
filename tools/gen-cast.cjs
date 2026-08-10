/**
 * Generate the FIXED expanded test cast (one-time). Adds 7 new wallets to
 * persona-wallets.json — 4 board-elect + 3 non-board voting DReps — alongside
 * the existing Alice (regular), Bob (board), Carol (holder). Idempotent: only
 * generates a wallet that isn't already present. Also (re)writes docs/ACTORS.md.
 *
 *   node tools/gen-cast.cjs
 *
 * NOTE: this does NOT touch genesis.json (board seats must be REGISTERED first;
 * see tools/fund-cast.cjs → tools/register-dreps.cjs → tools/seat-board.cjs).
 */
const fs = require('node:fs');
const path = require('node:path');
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const { drepIdFromKeyHashHex } = require('../packages/cardano/dist/index.js');

const NETWORK_ID = 0;
const harden = (n) => n + 0x80000000;

// The fixed cast. Existing keys (regular/board/holder) are NOT regenerated here.
const NEW_ACTORS = [
  { key: 'dave', displayName: 'Dave (Founding Board)', role: 'BOARD' },
  { key: 'erin', displayName: 'Erin (Founding Board)', role: 'BOARD' },
  { key: 'frank', displayName: 'Frank (Founding Board)', role: 'BOARD' },
  { key: 'grace', displayName: 'Grace (Founding Board)', role: 'BOARD' },
  { key: 'heidi', displayName: 'Heidi (Voting DRep)', role: 'DREP' },
  { key: 'ivan', displayName: 'Ivan (Voting DRep)', role: 'DREP' },
  { key: 'judy', displayName: 'Judy (Voting DRep)', role: 'DREP' },
];

function derive(mnemonic) {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payment = acct.derive(0).derive(0).to_public();
  const stake = acct.derive(2).derive(0).to_public();
  const drep = acct.derive(3).derive(0).to_public();
  const pc = CSL.Credential.from_keyhash(payment.to_raw_key().hash());
  const sc = CSL.Credential.from_keyhash(stake.to_raw_key().hash());
  return {
    mnemonic,
    paymentAddress: CSL.BaseAddress.new(NETWORK_ID, pc, sc).to_address().to_bech32(),
    stakeAddress: CSL.RewardAddress.new(NETWORK_ID, sc).to_address().to_bech32(),
    drepKeyHash: drep.to_raw_key().hash().to_hex(),
  };
}

const file = path.join(__dirname, 'persona-wallets.json');
const personas = JSON.parse(fs.readFileSync(file, 'utf8'));

let added = 0;
for (const a of NEW_ACTORS) {
  if (personas[a.key]) continue;
  personas[a.key] = { displayName: a.displayName, role: a.role, ...derive(bip39.generateMnemonic(256)) };
  added++;
}
fs.writeFileSync(file, JSON.stringify(personas, null, 2));

// Annotate the three originals (display only; shape unchanged for old scripts).
const ORIGINALS = {
  regular: { displayName: 'Alice (Founding Board)', role: 'BOARD' },
  board: { displayName: 'Bob (ADA holder / funder)', role: 'HOLDER' },
  holder: { displayName: 'Carol (ADA holder)', role: 'HOLDER' },
};

const all = [
  { key: 'regular', ...ORIGINALS.regular, ...personas.regular },
  ...NEW_ACTORS.filter((a) => a.role === 'BOARD').map((a) => ({ key: a.key, ...personas[a.key] })),
  ...NEW_ACTORS.filter((a) => a.role === 'DREP').map((a) => ({ key: a.key, ...personas[a.key] })),
  { key: 'board', ...ORIGINALS.board, ...personas.board },
  { key: 'holder', ...ORIGINALS.holder, ...personas.holder },
];

const drepId = (p) => (p.drepKeyHash ? drepIdFromKeyHashHex(p.drepKeyHash) : '(no DRep key)');
const row = (p) =>
  `| **${p.displayName}** | ${p.role} | \`${p.stakeAddress}\` | ${p.drepKeyHash ? '`' + drepId(p) + '`' : '—'} |`;

const md = `# Test actors (Preprod) — FIXED

The **stable** test cast. Do not regenerate. Seeds live in \`tools/persona-wallets.json\`
(gitignored). Import each 24-word seed as a **separate** wallet in Lace/Eternl
(choose **24-word** recovery), network = **Preprod**.

DREP is an **on-chain role**: a wallet is a DRep only if its DRep key is
registered + active on-chain (verified at login via Koios). Board members are
registered DReps seated through the admin-confirmed \`genesis.json\`. ADA holders
are wallets with no on-chain DRep registration (viewer + submitter only).

| Actor | Intended role | Stake address | DRep ID (CIP-129) |
|---|---|---|---|
${all.map(row).join('\n')}

**Admin** (separate auth): Platform Admin at \`/admin/login\`, username \`satucha\`
(dev password via \`pnpm admin:create\`).

## Cast composition
- **5 board members** (registered DReps, seated in genesis): Alice, Dave, Erin, Frank, Grace
- **3 voting DReps** (registered, non-board): Heidi, Ivan, Judy
- **2 ADA holders** (not registered): Bob (also the funding source), Carol

## On-chain setup (programmatic)
1. \`node tools/gen-cast.cjs\` — generate the fixed wallets (this file).
2. \`node tools/fund-cast.cjs\` — Bob funds the 7 new wallets (~600 tADA each).
3. \`node tools/register-dreps.cjs\` — each of the 7 self-registers as a DRep on-chain (500 tADA deposit).
4. \`node tools/seat-board.cjs\` — write \`genesis.json\` (5 board) + verify + seat.
`;
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'ACTORS.md'), md);

console.log(`gen-cast: ${added} new wallet(s) added (${NEW_ACTORS.length} in cast); ACTORS.md rewritten.`);
console.log('\nNew payment addresses to fund:');
for (const a of NEW_ACTORS) console.log(`  ${a.displayName.padEnd(26)} ${personas[a.key].paymentAddress}`);
