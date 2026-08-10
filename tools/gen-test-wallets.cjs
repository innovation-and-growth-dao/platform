/**
 * Generate ONE BIP-39 mnemonic and derive N Cardano accounts (CIP-1852) for
 * Preprod testing. Import the single seed into Lace, then switch the active
 * account to act as different board members / DReps (each account has its own
 * stake address, which is the platform's identity key).
 *
 *   node tools/gen-test-wallets.cjs
 *
 * TEST / PREPROD ONLY. Never reuse these seeds on mainnet or with real ADA.
 * Full output (incl. mnemonic) is written to tools/test-wallets.json (gitignored).
 */
const fs = require('node:fs');
const path = require('node:path');
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');

const NETWORK_ID = 0; // 0 = testnet (Preprod/Preview), 1 = mainnet
const ACCOUNTS = [
  { idx: 0, role: 'BOARD #1' },
  { idx: 1, role: 'BOARD #2' },
  { idx: 2, role: 'BOARD #3' },
  { idx: 3, role: 'BOARD #4' },
  { idx: 4, role: 'BOARD #5' },
  { idx: 5, role: 'DREP applicant A' },
  { idx: 6, role: 'DREP applicant B' },
  { idx: 7, role: 'DREP applicant C' },
];

const harden = (n) => n + 0x80000000;
const toHex = (bytes) => Buffer.from(bytes).toString('hex');

function deriveAccount(rootKey, accountIndex) {
  const account = rootKey
    .derive(harden(1852))
    .derive(harden(1815))
    .derive(harden(accountIndex));

  const payment = account.derive(0).derive(0).to_public();
  const stake = account.derive(2).derive(0).to_public();
  const drep = account.derive(3).derive(0).to_public(); // CIP-95 DRep key

  const paymentCred = CSL.Credential.from_keyhash(payment.to_raw_key().hash());
  const stakeCred = CSL.Credential.from_keyhash(stake.to_raw_key().hash());

  const baseAddr = CSL.BaseAddress.new(NETWORK_ID, paymentCred, stakeCred)
    .to_address()
    .to_bech32();
  const rewardAddr = CSL.RewardAddress.new(NETWORK_ID, stakeCred)
    .to_address()
    .to_bech32();

  return {
    accountIndex,
    paymentAddress: baseAddr,
    stakeAddress: rewardAddr,
    stakeKeyHash: toHex(stake.to_raw_key().hash().to_bytes()),
    drepKeyHash: toHex(drep.to_raw_key().hash().to_bytes()),
  };
}

function main() {
  const mnemonic = bip39.generateMnemonic(256); // 24 words
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(
    Buffer.from(entropy, 'hex'),
    Buffer.from(''),
  );

  const wallets = ACCOUNTS.map((a) => ({ role: a.role, ...deriveAccount(rootKey, a.idx) }));

  const outFile = path.join(__dirname, 'test-wallets.json');
  fs.writeFileSync(outFile, JSON.stringify({ network: 'Preprod', mnemonic, wallets }, null, 2));

  console.log('\n=== TEST WALLET SET (Preprod) — TEST ONLY, never use on mainnet ===\n');
  console.log('Recovery phrase (import once into Lace):\n');
  console.log('  ' + mnemonic + '\n');
  console.log('Accounts (switch the active account in Lace to change identity):\n');
  for (const w of wallets) {
    console.log(`  [acct ${w.accountIndex}] ${w.role}`);
    console.log(`     payment: ${w.paymentAddress}`);
    console.log(`     stake  : ${w.stakeAddress}`);
  }
  console.log(`\nFull details written to ${outFile} (gitignored).`);
  console.log('Fund the *payment* addresses from the Preprod faucet: https://docs.cardano.org/cardano-testnets/tools/faucet\n');
}

main();
