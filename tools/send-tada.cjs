/**
 * Distribute tADA from the funded BOARD DRep wallet to the other actor addresses,
 * so each can pay the on-chain DRep registration deposit. Builds + signs + submits
 * a Preprod tx via Koios (no API key needed). TEST ONLY.
 *
 *   node tools/send-tada.cjs
 */
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const personas = require('./persona-wallets.json');

const KOIOS = 'https://preprod.koios.rest/api/v1';
const harden = (n) => n + 0x80000000;
const ADA = 1_000_000n;

// From the funded Board wallet → others (Board keeps the change ~5,500 tADA).
const SENDS = [
  { addr: personas.regular.paymentAddress, ada: 3000 },
  { addr: personas.holder.paymentAddress, ada: 1500 },
];

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

function boardKeysAndAddress() {
  const entropy = bip39.mnemonicToEntropy(personas.board.mnemonic);
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(entropy, 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const payKey = acct.derive(0).derive(0);
  const stakeKey = acct.derive(2).derive(0);
  const pc = CSL.Credential.from_keyhash(payKey.to_public().to_raw_key().hash());
  const sc = CSL.Credential.from_keyhash(stakeKey.to_public().to_raw_key().hash());
  const addr = CSL.BaseAddress.new(0, pc, sc).to_address();
  return { prv: payKey.to_raw_key(), addr };
}

async function main() {
  const { prv, addr } = boardKeysAndAddress();
  const addrBech = addr.to_bech32();
  console.log('From:', addrBech);

  const pp = (await koiosGet('/epoch_params'))[0];
  const utxos = await koiosPost('/address_utxos', { _addresses: [addrBech] });
  if (!utxos.length) throw new Error('no UTxOs at the Board wallet');

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
        CSL.Address.from_bech32(s.addr),
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
  const r = await fetch(`${KOIOS}/submittx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/cbor' },
    body: cbor,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`submit failed ${r.status}: ${text}`);
  console.log('Submitted ✓ tx hash:', text.replaceAll('"', ''));
  console.log('Sent: 3,000 tADA → Regular DRep, 1,500 tADA → ADA holder (Board keeps the change).');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
