/**
 * Add an ADA-holder persona (NOT a DRep) and rebuild genesis.json from the
 * existing BOARD DRep persona. Does NOT touch the existing regular/board seeds.
 *
 *   node tools/gen-holder-and-genesis.cjs
 *
 * The founding board's DRep ID here is derived (CIP-105) from the board wallet's
 * DRep key; replace it with the wallet's real on-chain DRep ID after you register
 * that wallet as a DRep (then re-upload genesis.json via /admin).
 */
const fs = require('node:fs');
const path = require('node:path');
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const { drepIdFromKeyHashHex } = require('../packages/cardano/dist/address.js');

const NETWORK_ID = 0;
const harden = (n) => n + 0x80000000;
const toHex = (b) => Buffer.from(b).toString('hex');

function derive(mnemonic) {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payment = acct.derive(0).derive(0).to_public();
  const stake = acct.derive(2).derive(0).to_public();
  const pc = CSL.Credential.from_keyhash(payment.to_raw_key().hash());
  const sc = CSL.Credential.from_keyhash(stake.to_raw_key().hash());
  return {
    mnemonic,
    paymentAddress: CSL.BaseAddress.new(NETWORK_ID, pc, sc).to_address().to_bech32(),
    stakeAddress: CSL.RewardAddress.new(NETWORK_ID, sc).to_address().to_bech32(),
  };
}

const personaFile = path.join(__dirname, 'persona-wallets.json');
const personas = JSON.parse(fs.readFileSync(personaFile, 'utf8'));

if (!personas.holder) {
  personas.holder = derive(bip39.generateMnemonic(256));
  fs.writeFileSync(personaFile, JSON.stringify(personas, null, 2));
}

// New format: name + drep_id only. drep_id is CIP-129 (matches Eternl). The
// platform verifies it's a registered on-chain DRep before seating — so the
// board seat must be a wallet that is actually registered on-chain. Only the
// `regular` (library) persona is registered, so it is board seat #1 here.
const genesis = {
  founding_board: [
    { name: 'Alice (Founding Board)', drep_id: drepIdFromKeyHashHex(personas.regular.drepKeyHash) },
  ],
};
fs.writeFileSync(path.join(__dirname, '..', 'genesis.json'), JSON.stringify(genesis, null, 2));

console.log('\n=== ADA HOLDER persona (NOT a DRep) ===');
console.log('  seed   :', personas.holder.mnemonic);
console.log('  stake  :', personas.holder.stakeAddress);
console.log('  payment:', personas.holder.paymentAddress);
console.log('\n=== genesis.json founding board (1 member = your Board DRep) ===');
console.log('  stake  :', genesis.founding_board[0].stake_address);
console.log('  drep_id:', genesis.founding_board[0].drep_id, '(derived; replace with on-chain id if desired)');
