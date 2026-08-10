/**
 * CIP-1694 vote delegation for the cast, so DReps have real on-chain voting
 * power (separate from stake-pool delegation). Each wallet registers its stake
 * key (if needed) and delegates its VOTE to a target DRep. Idempotent-ish:
 * re-running just re-delegates (cheap). Optionally limit with an arg, e.g.
 *
 *   node tools/delegate-votes.cjs dave        # only Dave
 *   node tools/delegate-votes.cjs             # all in PLAN
 */
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const personas = require('./persona-wallets.json');

const KOIOS = 'https://preprod.koios.rest/api/v1';
const harden = (n) => n + 0x80000000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// who delegates their vote → to which DRep (by persona key whose drepKeyHash is the target)
const PLAN = [
  { who: 'dave', toDrepOf: 'dave' }, // self
  { who: 'erin', toDrepOf: 'erin' },
  { who: 'frank', toDrepOf: 'frank' },
  { who: 'grace', toDrepOf: 'grace' },
  { who: 'board', toDrepOf: 'regular' }, // Bob → Alice (external delegator)
  { who: 'holder', toDrepOf: 'dave' }, // Carol → Dave (external delegator)
  { who: 'heidi', toDrepOf: 'heidi' }, // self
  { who: 'judy', toDrepOf: 'judy' }, // self
];

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
    stakeAddr: CSL.RewardAddress.new(0, sc).to_address().to_bech32(),
  };
}

async function delegateOne(whoKey, targetDrepKeyHash, pp) {
  const k = keys(personas[whoKey].mnemonic);
  const addrBech = k.addr.to_bech32();
  const info = (await koiosPost('/account_info', { _stake_addresses: [k.stakeAddr] }))[0];
  const registered = info && info.status === 'registered';

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
  if (!registered) {
    certs.add(CSL.Certificate.new_stake_registration(CSL.StakeRegistration.new(k.stakeCred)));
  }
  const drep = CSL.DRep.new_key_hash(CSL.Ed25519KeyHash.from_hex(targetDrepKeyHash));
  certs.add(CSL.Certificate.new_vote_delegation(CSL.VoteDelegation.new(k.stakeCred, drep)));
  txb.set_certs_builder(certs);

  const utxos = await koiosPost('/address_utxos', { _addresses: [addrBech] });
  if (!utxos.length) throw new Error(`no UTxOs at ${whoKey}`);
  const unspent = CSL.TransactionUnspentOutputs.new();
  for (const u of utxos) {
    const input = CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index));
    const out = CSL.TransactionOutput.new(k.addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value))));
    unspent.add(CSL.TransactionUnspentOutput.new(input, out));
  }
  txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
  txb.add_change_if_needed(k.addr);

  const fixedTx = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
  fixedTx.sign_and_add_vkey_signature(k.payPrv);
  fixedTx.sign_and_add_vkey_signature(k.stakePrv);
  const txHash = fixedTx.transaction_hash().to_hex();

  const r = await fetch(`${KOIOS}/submittx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/cbor' },
    body: Buffer.from(fixedTx.to_hex(), 'hex'),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`submit ${whoKey} ${r.status}: ${text}`);
  console.log(`  → ${whoKey}${registered ? '' : ' (+register stake)'} → DRep ${targetDrepKeyHash.slice(0, 12)}…: ${txHash}`);
  return txHash;
}

async function main() {
  const only = process.argv[2];
  const plan = only ? PLAN.filter((p) => p.who === only) : PLAN;
  if (!plan.length) throw new Error(`no plan entry for "${only}"`);
  const pp = (await koiosGet('/epoch_params'))[0];
  console.log(`Vote-delegating ${plan.length} wallet(s)…`);
  for (const p of plan) {
    try {
      await delegateOne(p.who, personas[p.toDrepOf].drepKeyHash, pp);
    } catch (e) {
      console.error(`  ✗ ${p.who}: ${e.message}`);
    }
    await sleep(1500);
  }
  console.log('\nDone. Delegators appear on Koios within ~1 min; voting power reflects immediately in the dashboard (live sum).');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
