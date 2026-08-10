/**
 * Generate TWO dedicated single-wallet seeds for role testing:
 *   - "regular" → a regular DRep
 *   - "board"   → a DRep who is also a board member
 * Each is its own 24-word mnemonic (import as a separate Lace wallet, Preprod).
 *
 *   node tools/gen-persona-wallets.cjs
 *
 * TEST / PREPROD ONLY. Secrets written to gitignored tools/persona-wallets.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');

const NETWORK_ID = 0; // Preprod
const harden = (n) => n + 0x80000000;
const toHex = (b) => Buffer.from(b).toString('hex');

function derive(mnemonic) {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payment = acct.derive(0).derive(0).to_public();
  const stake = acct.derive(2).derive(0).to_public();
  const drep = acct.derive(3).derive(0).to_public();
  const paymentCred = CSL.Credential.from_keyhash(payment.to_raw_key().hash());
  const stakeCred = CSL.Credential.from_keyhash(stake.to_raw_key().hash());
  return {
    mnemonic,
    paymentAddress: CSL.BaseAddress.new(NETWORK_ID, paymentCred, stakeCred).to_address().to_bech32(),
    stakeAddress: CSL.RewardAddress.new(NETWORK_ID, stakeCred).to_address().to_bech32(),
    drepKeyHash: toHex(drep.to_raw_key().hash().to_bytes()),
  };
}

const out = {
  network: 'Preprod',
  regular: derive(bip39.generateMnemonic(256)),
  board: derive(bip39.generateMnemonic(256)),
};
const file = path.join(__dirname, 'persona-wallets.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2));

console.log('\n=== PERSONA WALLETS (Preprod) — TEST ONLY ===\n');
for (const [role, w] of [['REGULAR DRep', out.regular], ['BOARD DRep', out.board]]) {
  console.log(`${role}`);
  console.log(`  seed   : ${w.mnemonic}`);
  console.log(`  stake  : ${w.stakeAddress}`);
  console.log(`  payment: ${w.paymentAddress}\n`);
}
console.log(`Saved to ${file} (gitignored). Run: pnpm seed:persona-wallets`);
