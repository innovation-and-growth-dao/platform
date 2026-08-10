/**
 * Distribute tADA from Alice (the funded board DRep) to the other DReps so they
 * have varied, higher CIP-1694 voting power (each DRep self-vote-delegates, so its
 * controlled stake = its voting power). One multi-output tx; Alice keeps the change.
 *
 *   node tools/distribute-power.cjs
 */
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const personas = require('./persona-wallets.json');

const KOIOS = 'https://preprod.koios.rest/api/v1';
const harden = (n) => n + 0x80000000;
const ADA = 1_000_000n;

// From Alice (regular) → other DReps, varied amounts for a realistic power spread.
const SENDS = [
  { who: 'grace', ada: 4900 },
  { who: 'erin', ada: 2900 },
  { who: 'heidi', ada: 2400 },
  { who: 'frank', ada: 1900 },
  { who: 'judy', ada: 900 },
  { who: 'dave', ada: 400 },
];

async function koiosGet(p) {
  const r = await fetch(`${KOIOS}${p}`);
  if (!r.ok) throw new Error(`koios GET ${p}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function koiosPost(p, body) {
  const r = await fetch(`${KOIOS}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`koios POST ${p}: ${r.status} ${await r.text()}`);
  return r.json();
}

function aliceKeys() {
  const entropy = bip39.mnemonicToEntropy(personas.regular.mnemonic);
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payKey = acct.derive(0).derive(0);
  const stakeKey = acct.derive(2).derive(0);
  const pc = CSL.Credential.from_keyhash(payKey.to_public().to_raw_key().hash());
  const sc = CSL.Credential.from_keyhash(stakeKey.to_public().to_raw_key().hash());
  return { prv: payKey.to_raw_key(), addr: CSL.BaseAddress.new(0, pc, sc).to_address() };
}

async function main() {
  const { prv, addr } = aliceKeys();
  const addrBech = addr.to_bech32();
  console.log('From Alice:', addrBech);

  const pp = (await koiosGet('/epoch_params'))[0];
  const utxos = await koiosPost('/address_utxos', { _addresses: [addrBech] });
  if (!utxos.length) throw new Error('no UTxOs at Alice');

  const cfg = CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
    .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
    .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
    .max_value_size(Number(pp.max_val_size))
    .max_tx_size(Number(pp.max_tx_size))
    .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
    .build();
  const txb = CSL.TransactionBuilder.new(cfg);

  for (const s of SENDS) {
    txb.add_output(
      CSL.TransactionOutput.new(
        CSL.Address.from_bech32(personas[s.who].paymentAddress),
        CSL.Value.new(CSL.BigNum.from_str(String(BigInt(s.ada) * ADA))),
      ),
    );
  }

  const unspent = CSL.TransactionUnspentOutputs.new();
  for (const u of utxos) {
    const input = CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index));
    const out = CSL.TransactionOutput.new(addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value))));
    unspent.add(CSL.TransactionUnspentOutput.new(input, out));
  }
  txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
  txb.add_change_if_needed(addr);

  const unsignedTx = txb.build_tx();
  const fixedTx = CSL.FixedTransaction.from_hex(unsignedTx.to_hex());
  fixedTx.sign_and_add_vkey_signature(prv);
  const txHashStr = fixedTx.transaction_hash().to_hex();

  const cbor = Buffer.from(fixedTx.to_hex(), 'hex');
  console.log(`Submitting tx ${txHashStr} (${cbor.length} bytes)…`);
  const r = await fetch(`${KOIOS}/submittx`, { method: 'POST', headers: { 'Content-Type': 'application/cbor' }, body: cbor });
  const text = await r.text();
  if (!r.ok) throw new Error(`submit failed ${r.status}: ${text}`);
  console.log('Submitted ✓ tx:', text.replaceAll('"', ''));
  console.log('Sent:', SENDS.map((s) => `${s.ada}→${s.who}`).join(', '), '(Alice keeps the change).');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
