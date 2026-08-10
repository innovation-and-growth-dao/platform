/**
 * Create 2 fresh delegator wallets and have each vote-delegate (CIP-1694) ≥ 1000 tADA
 * to Heidi's DRep, so the §14.1 entry gate's delegator path can be tested on Preprod.
 *
 * Steps (idempotent): generate/load 2 wallets → fund each ~1100 tADA from Alice
 * (regular) → register stake + vote-delegate to Heidi. Wallets persisted (gitignored)
 * in tools/heidi-delegators.json.
 *
 *   node tools/seed-heidi-delegators.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const personas = require('./persona-wallets.json');

const KOIOS = 'https://preprod.koios.rest/api/v1';
const WALLET_FILE = path.join(__dirname, 'heidi-delegators.json');
const FUND_ADA = 1100; // each delegator ends with controlled stake comfortably ≥ 1000
const harden = (n) => n + 0x80000000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ADA = (n) => CSL.BigNum.from_str(String(Math.round(n * 1e6)));

async function koiosGet(p) {
  const r = await fetch(`${KOIOS}${p}`);
  if (!r.ok) throw new Error(`koios GET ${p}: ${r.status}`);
  return r.json();
}
async function koiosPost(p, body) {
  const r = await fetch(`${KOIOS}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`koios POST ${p}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function submit(fixedTx, label) {
  const txHash = fixedTx.transaction_hash().to_hex();
  const r = await fetch(`${KOIOS}/submittx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/cbor' },
    body: Buffer.from(fixedTx.to_hex(), 'hex'),
  });
  if (!r.ok) throw new Error(`submit ${label} ${r.status}: ${await r.text()}`);
  console.log(`  → ${label}: ${txHash}`);
  return txHash;
}

function keys(mnemonic) {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const pay = acct.derive(0).derive(0);
  const stake = acct.derive(2).derive(0);
  const pc = CSL.Credential.from_keyhash(pay.to_public().to_raw_key().hash());
  const sc = CSL.Credential.from_keyhash(stake.to_public().to_raw_key().hash());
  return {
    payPrv: pay.to_raw_key(),
    stakePrv: stake.to_raw_key(),
    stakeCred: sc,
    addr: CSL.BaseAddress.new(0, pc, sc).to_address(),
    addrBech: CSL.BaseAddress.new(0, pc, sc).to_address().to_bech32(),
    stakeAddr: CSL.RewardAddress.new(0, sc).to_address().to_bech32(),
  };
}

function builderCfg(pp) {
  return CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
    .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
    .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
    .max_value_size(Number(pp.max_val_size))
    .max_tx_size(Number(pp.max_tx_size))
    .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
    .build();
}

async function utxoTotal(addrBech) {
  const u = await koiosPost('/address_utxos', { _addresses: [addrBech] });
  return { utxos: u, total: u.reduce((s, x) => s + BigInt(x.value), 0n) };
}

function addInputs(txb, utxos, addr) {
  const unspent = CSL.TransactionUnspentOutputs.new();
  for (const u of utxos) {
    unspent.add(
      CSL.TransactionUnspentOutput.new(
        CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index)),
        CSL.TransactionOutput.new(addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value)))),
      ),
    );
  }
  txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
}

async function main() {
  // 1) load or generate 2 delegator wallets
  let wallets = fs.existsSync(WALLET_FILE) ? JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8')) : null;
  if (!wallets) {
    wallets = [
      { name: 'heidi-deleg-1', mnemonic: bip39.generateMnemonic(256) },
      { name: 'heidi-deleg-2', mnemonic: bip39.generateMnemonic(256) },
    ];
    fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
    console.log(`Generated 2 delegator wallets → ${WALLET_FILE}`);
  } else {
    console.log(`Loaded ${wallets.length} delegator wallets from ${WALLET_FILE}`);
  }
  const dels = wallets.map((w) => ({ ...w, k: keys(w.mnemonic) }));
  for (const d of dels) console.log(`  ${d.name}: ${d.k.addrBech}`);

  const pp = (await koiosGet('/epoch_params'))[0];

  // 2) fund any delegator below the target from Alice (regular)
  const TARGET = BigInt(Math.round(FUND_ADA * 1e6));
  const underfunded = [];
  for (const d of dels) {
    const { total } = await utxoTotal(d.k.addrBech);
    if (total < TARGET) underfunded.push(d);
    console.log(`  ${d.name} balance: ${Number(total) / 1e6} ADA`);
  }
  if (underfunded.length) {
    console.log(`\nFunding ${underfunded.length} wallet(s) with ${FUND_ADA} ADA each from Alice…`);
    const alice = keys(personas.regular.mnemonic);
    const { utxos } = await utxoTotal(alice.addrBech);
    const txb = CSL.TransactionBuilder.new(builderCfg(pp));
    for (const d of underfunded) {
      txb.add_output(CSL.TransactionOutput.new(d.k.addr, CSL.Value.new(ADA(FUND_ADA))));
    }
    addInputs(txb, utxos, alice.addr);
    txb.add_change_if_needed(alice.addr);
    const fixed = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
    fixed.sign_and_add_vkey_signature(alice.payPrv);
    await submit(fixed, `fund ${underfunded.map((d) => d.name).join(' + ')}`);

    // wait for the funded UTxOs to appear on Koios
    console.log('  waiting for funding to confirm…');
    for (let i = 0; i < 40; i++) {
      await sleep(15000);
      const ready = await Promise.all(underfunded.map(async (d) => (await utxoTotal(d.k.addrBech)).total >= BigInt(Math.round(FUND_ADA * 1e6))));
      if (ready.every(Boolean)) { console.log(`  funded (after ~${(i + 1) * 15}s)`); break; }
      process.stdout.write('.');
    }
  } else {
    console.log('All delegators already funded.');
  }

  // 3) register stake + vote-delegate each to Heidi
  const heidiDrep = personas.heidi.drepKeyHash;
  console.log(`\nVote-delegating to Heidi's DRep ${heidiDrep.slice(0, 12)}…`);
  for (const d of dels) {
    try {
      const info = (await koiosPost('/account_info', { _stake_addresses: [d.k.stakeAddr] }))[0];
      const registered = info && info.status === 'registered';
      const { utxos } = await utxoTotal(d.k.addrBech);
      if (!utxos.length) { console.error(`  ✗ ${d.name}: no UTxOs (funding not confirmed yet?)`); continue; }
      const txb = CSL.TransactionBuilder.new(builderCfg(pp));
      const certs = CSL.CertificatesBuilder.new();
      if (!registered) certs.add(CSL.Certificate.new_stake_registration(CSL.StakeRegistration.new(d.k.stakeCred)));
      const drep = CSL.DRep.new_key_hash(CSL.Ed25519KeyHash.from_hex(heidiDrep));
      certs.add(CSL.Certificate.new_vote_delegation(CSL.VoteDelegation.new(d.k.stakeCred, drep)));
      txb.set_certs_builder(certs);
      addInputs(txb, utxos, d.k.addr);
      txb.add_change_if_needed(d.k.addr);
      const fixed = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
      fixed.sign_and_add_vkey_signature(d.k.payPrv);
      fixed.sign_and_add_vkey_signature(d.k.stakePrv);
      await submit(fixed, `${d.name}${registered ? '' : ' (+register stake)'} → Heidi`);
    } catch (e) {
      console.error(`  ✗ ${d.name}: ${e.message}`);
    }
    await sleep(1500);
  }
  console.log("\nDone. Heidi's delegators appear on Koios within ~1 min; her voting power/delegators update live in the overview.");
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
