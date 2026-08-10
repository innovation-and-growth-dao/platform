/**
 * Build a genesis.json (§17.5) from the BOARD accounts in tools/test-wallets.json.
 * The genesis file is meant to be public and committed before deployment; this
 * dev version uses the Preprod test board.
 *
 *   node tools/gen-genesis.cjs   →   writes genesis.json at repo root
 */
const fs = require('node:fs');
const path = require('node:path');
const { drepIdFromKeyHashHex } = require('../packages/cardano/dist/address.js');

const wallets = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-wallets.json'), 'utf8'));
const board = wallets.wallets.filter((w) => w.role.startsWith('BOARD'));

const genesis = {
  deployment: {
    name: 'DRep DAO — Preprod test',
    network: 'Preprod',
    deployed_at: new Date().toISOString(),
  },
  founding_board: board.map((w, i) => ({
    display_name: `Board ${i + 1}`,
    stake_address: w.stakeAddress,
    drep_id: drepIdFromKeyHashHex(w.drepKeyHash),
  })),
};

const out = path.join(__dirname, '..', 'genesis.json');
fs.writeFileSync(out, JSON.stringify(genesis, null, 2));
console.log(`Wrote ${out} with ${genesis.founding_board.length} founding board members.`);
for (const m of genesis.founding_board) console.log(`  ${m.display_name}: ${m.drep_id}`);
