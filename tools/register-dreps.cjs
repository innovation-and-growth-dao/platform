/**
 * Register each of the 7 new cast wallets as an on-chain DRep (Conway
 * DRepRegistration cert, 500 tADA refundable deposit). Each wallet pays from its
 * own funds (see tools/fund-cast.cjs) and signs with its payment key (inputs) +
 * DRep key (the cert). Idempotent: skips wallets already registered. Polls Koios
 * for the funding UTxO and for final registration status.
 *
 *   node tools/register-dreps.cjs
 */
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const { drepIdFromKeyHashHex } = require('../packages/cardano/dist/index.js');
const personas = require('./persona-wallets.json');

const KOIOS = 'https://preprod.koios.rest/api/v1';
const harden = (n) => n + 0x80000000;
const WALLETS = ['dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function koiosGet(p) {
  const r = await fetch(`${KOIOS}${p}`);
  if (!r.ok) throw new Error(`koios GET ${p}: ${r.status} ${await r.text()}`);
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

function keys(mnemonic) {
  const entropy = bip39.mnemonicToEntropy(mnemonic);
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payKey = acct.derive(0).derive(0);
  const stakeKey = acct.derive(2).derive(0);
  const drepKey = acct.derive(3).derive(0);
  const pc = CSL.Credential.from_keyhash(payKey.to_public().to_raw_key().hash());
  const sc = CSL.Credential.from_keyhash(stakeKey.to_public().to_raw_key().hash());
  return {
    payPrv: payKey.to_raw_key(),
    drepPrv: drepKey.to_raw_key(),
    drepCred: CSL.Credential.from_keyhash(drepKey.to_public().to_raw_key().hash()),
    addr: CSL.BaseAddress.new(0, pc, sc).to_address(),
  };
}

async function alreadyRegistered(drepId) {
  const rows = await koiosPost('/drep_info', { _drep_ids: [drepId] });
  const r = rows.find((x) => x.drep_id === drepId);
  return !!r && r.drep_status === 'registered' && r.active === true;
}

async function waitForUtxos(addrBech, label) {
  for (let i = 0; i < 30; i++) {
    const u = await koiosPost('/address_utxos', { _addresses: [addrBech] });
    if (u.length) return u;
    if (i === 0) console.log(`  …waiting for funding UTxO for ${label}`);
    await sleep(10000);
  }
  throw new Error(`no UTxO arrived for ${label} (${addrBech}) — fund it first`);
}

async function registerOne(key, pp) {
  const k = keys(personas[key].mnemonic);
  const addrBech = k.addr.to_bech32();
  const drepId = drepIdFromKeyHashHex(personas[key].drepKeyHash);

  if (await alreadyRegistered(drepId)) {
    console.log(`  ✓ ${personas[key].displayName} already registered (${drepId})`);
    return { key, drepId, skipped: true };
  }

  const utxos = await waitForUtxos(addrBech, personas[key].displayName);

  const cfg = CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
    .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
    .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
    .max_value_size(Number(pp.max_val_size))
    .max_tx_size(Number(pp.max_tx_size))
    .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
    .build();
  const txb = CSL.TransactionBuilder.new(cfg);

  const certs = CSL.CertificatesBuilder.new();
  certs.add(
    CSL.Certificate.new_drep_registration(
      CSL.DRepRegistration.new(k.drepCred, CSL.BigNum.from_str(String(pp.drep_deposit))),
    ),
  );
  txb.set_certs_builder(certs);

  const unspent = CSL.TransactionUnspentOutputs.new();
  for (const u of utxos) {
    const input = CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index));
    const out = CSL.TransactionOutput.new(k.addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value))));
    unspent.add(CSL.TransactionUnspentOutput.new(input, out));
  }
  txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
  txb.add_change_if_needed(k.addr);

  const fixedTx = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
  fixedTx.sign_and_add_vkey_signature(k.payPrv); // inputs
  fixedTx.sign_and_add_vkey_signature(k.drepPrv); // DRep cert
  const txHash = fixedTx.transaction_hash().to_hex();

  const cbor = Buffer.from(fixedTx.to_hex(), 'hex');
  const r = await fetch(`${KOIOS}/submittx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/cbor' },
    body: cbor,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`submit failed for ${key} ${r.status}: ${text}`);
  console.log(`  → ${personas[key].displayName}: submitted ${txHash}`);
  return { key, drepId, txHash, skipped: false };
}

async function main() {
  const pp = (await koiosGet('/epoch_params'))[0];
  console.log(`Registering ${WALLETS.length} DReps (deposit ${Number(pp.drep_deposit) / 1e6} tADA each)…`);

  const results = [];
  for (const key of WALLETS) results.push(await registerOne(key, pp));

  const pending = results.filter((r) => !r.skipped);
  if (pending.length === 0) {
    console.log('\nAll already registered. Next: node tools/seat-board.cjs');
    return;
  }

  console.log(`\nWaiting for ${pending.length} registration(s) to confirm on-chain…`);
  for (let i = 0; i < 30; i++) {
    await sleep(15000);
    const ids = pending.map((r) => r.drepId);
    const rows = await koiosPost('/drep_info', { _drep_ids: ids });
    const ok = rows.filter((x) => x.drep_status === 'registered' && x.active === true).length;
    console.log(`  [${(i + 1) * 15}s] ${ok}/${pending.length} registered + active`);
    if (ok === pending.length) {
      console.log('\n✅ All registered. Next: node tools/seat-board.cjs');
      return;
    }
  }
  console.log('\n⚠ Timed out waiting for confirmation; re-run to check (idempotent).');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
