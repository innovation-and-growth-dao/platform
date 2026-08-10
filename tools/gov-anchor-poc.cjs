/**
 * PoC: on-chain governance voting via tx metadata (WingRiders pattern), applied
 * to our DRep admission flow (1-person-1-vote). Anchors an application, three
 * board votes, and the final result as Cardano tx metadata (label 80808081),
 * then reads them back from Koios and RE-TALLIES independently — proving the
 * mechanism end to end. Standalone (does not touch the app DB/UI).
 *
 *   node tools/gov-anchor-poc.cjs
 */
const crypto = require('node:crypto');
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const {
  GOVERNANCE_METADATA_LABEL,
  VotingStyle,
  GovSubject,
  buildGovMetadata,
  decodeGovEvent,
  tallyOnePersonOneVote,
  drepIdFromKeyHashHex,
} = require('../packages/cardano/dist/index.js');
const personas = require('./persona-wallets.json');

const KOIOS = 'https://preprod.koios.rest/api/v1';
const harden = (n) => n + 0x80000000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rhash = (s) => crypto.createHash('sha256').update(s).digest('hex'); // 64-hex commitment
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

async function koiosPost(p, body) {
  const r = await fetch(`${KOIOS}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`koios ${p}: ${r.status} ${await r.text()}`);
  return r.json();
}
const koiosGet = async (p) => { const r = await fetch(`${KOIOS}${p}`); if (!r.ok) throw new Error(`koios ${p}: ${r.status}`); return r.json(); };

function keys(mnemonic) {
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'), Buffer.from(''));
  const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
  const pay = acct.derive(0).derive(0);
  const sc = CSL.Credential.from_keyhash(acct.derive(2).derive(0).to_public().to_raw_key().hash());
  const pc = CSL.Credential.from_keyhash(pay.to_public().to_raw_key().hash());
  return { prv: pay.to_raw_key(), addr: CSL.BaseAddress.new(0, pc, sc).to_address() };
}

/** Build + sign + submit a tx carrying one governance metadatum, from `personaKey`'s wallet. */
async function submitGovEvent(personaKey, event, pp) {
  const k = keys(personas[personaKey].mnemonic);
  const addrBech = k.addr.to_bech32();
  buildGovMetadata(event); // validates field sizes; throws if too long

  const cfg = CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
    .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
    .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
    .max_value_size(Number(pp.max_val_size)).max_tx_size(Number(pp.max_tx_size))
    .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
    .build();
  const txb = CSL.TransactionBuilder.new(cfg);
  txb.add_json_metadatum_with_schema(
    CSL.BigNum.from_str(String(GOVERNANCE_METADATA_LABEL)),
    JSON.stringify(event),
    CSL.MetadataJsonSchema.NoConversions,
  );

  const utxos = await koiosPost('/address_utxos', { _addresses: [addrBech] });
  if (!utxos.length) throw new Error(`no UTxOs at ${personaKey}`);
  const unspent = CSL.TransactionUnspentOutputs.new();
  for (const u of utxos) {
    unspent.add(CSL.TransactionUnspentOutput.new(
      CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index)),
      CSL.TransactionOutput.new(k.addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value)))),
    ));
  }
  txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
  txb.add_change_if_needed(k.addr);

  const fixed = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
  fixed.sign_and_add_vkey_signature(k.prv);
  const txHash = fixed.transaction_hash().to_hex();
  const r = await fetch(`${KOIOS}/submittx`, { method: 'POST', headers: { 'Content-Type': 'application/cbor' }, body: Buffer.from(fixed.to_hex(), 'hex') });
  if (!r.ok) throw new Error(`submit ${personaKey} ${r.status}: ${await r.text()}`);
  return txHash;
}

(async () => {
  const drepId = (k) => drepIdFromKeyHashHex(personas[k].drepKeyHash);
  const ref = drepId('heidi'); // applicant DRep ID ties the admission together
  const now = () => new Date().toISOString();

  console.log('\n=== Part A — codec round-trip (offline) ===');
  const sampleVote = { v: 1, t: 'vote', subject: GovSubject.ADMISSION, style: VotingStyle.ONE_PERSON_ONE_VOTE, ts: now(), ref, voter: drepId('regular'), choice: 'YES', rh: rhash('Strong candidate.') };
  const decoded = decodeGovEvent(JSON.parse(JSON.stringify(buildGovMetadata(sampleVote)))[GOVERNANCE_METADATA_LABEL]);
  ok('vote encodes + decodes', decoded.t === 'vote' && decoded.choice === 'YES' && decoded.style === '1P1V');
  const t = tallyOnePersonOneVote([sampleVote, { ...sampleVote, voter: drepId('dave') }, { ...sampleVote, voter: drepId('erin') }], 3);
  ok('1P1V tally: 3 YES ≥ 3 → passed', t.passed && t.yes === 3, `yes=${t.yes}`);

  console.log('\n=== Part B — anchor admission on-chain (Preprod) ===');
  const pp = (await koiosGet('/epoch_params'))[0];
  const events = [
    { who: 'heidi', e: { v: 1, t: 'application', subject: GovSubject.ADMISSION, style: VotingStyle.ONE_PERSON_ONE_VOTE, ts: now(), ref, name: 'Heidi', uri: 'https://drep-dao.local/drep/heidi' } },
    { who: 'regular', e: { v: 1, t: 'vote', subject: GovSubject.ADMISSION, style: VotingStyle.ONE_PERSON_ONE_VOTE, ts: now(), ref, voter: drepId('regular'), choice: 'YES', rh: rhash('Strong governance track record.') } },
    { who: 'dave', e: { v: 1, t: 'vote', subject: GovSubject.ADMISSION, style: VotingStyle.ONE_PERSON_ONE_VOTE, ts: now(), ref, voter: drepId('dave'), choice: 'YES', rh: rhash('Agree.') } },
    { who: 'erin', e: { v: 1, t: 'vote', subject: GovSubject.ADMISSION, style: VotingStyle.ONE_PERSON_ONE_VOTE, ts: now(), ref, voter: drepId('erin'), choice: 'YES', rh: rhash('Welcome.') } },
    { who: 'frank', e: { v: 1, t: 'result', subject: GovSubject.ADMISSION, style: VotingStyle.ONE_PERSON_ONE_VOTE, ts: now(), ref, outcome: 'ADMITTED', yes: 3, no: 0, threshold: 3 } },
  ];
  const hashes = [];
  for (const { who, e } of events) {
    const h = await submitGovEvent(who, e, pp);
    console.log(`  → ${who.padEnd(8)} ${e.t.padEnd(11)} ${h}`);
    hashes.push(h);
    await sleep(1200);
  }

  console.log('\n  waiting for Koios to index the metadata…');
  let rows = [];
  for (let i = 0; i < 30; i++) {
    await sleep(10000);
    rows = await koiosPost('/tx_metadata', { _tx_hashes: hashes });
    const withMeta = rows.filter((r) => r.metadata && r.metadata[String(GOVERNANCE_METADATA_LABEL)]);
    process.stdout.write(`  [${(i + 1) * 10}s] ${withMeta.length}/${hashes.length} indexed\r`);
    if (withMeta.length === hashes.length) { rows = withMeta; break; }
  }
  console.log('');
  ok('all 5 events indexed on-chain with our label', rows.length === 5);

  console.log('\n=== Part C — read back from chain + re-tally independently ===');
  const decodedEvents = rows.map((r) => decodeGovEvent(r.metadata[String(GOVERNANCE_METADATA_LABEL)]));
  const votes = decodedEvents.filter((e) => e.t === 'vote');
  const result = decodedEvents.find((e) => e.t === 'result');
  const application = decodedEvents.find((e) => e.t === 'application');
  ok('application anchored', !!application && application.ref === ref);
  ok('3 vote events read from chain', votes.length === 3, `${votes.length} votes`);
  ok('all votes tagged 1P1V style', votes.every((v) => v.style === VotingStyle.ONE_PERSON_ONE_VOTE));
  const retally = tallyOnePersonOneVote(votes, 3);
  ok('independent re-tally → ADMITTED (3/3)', retally.passed && retally.yes === 3, `yes=${retally.yes}/${retally.no}`);
  ok('on-chain result matches re-tally', !!result && result.outcome === 'ADMITTED' && result.yes === retally.yes);

  console.log('\n  verify any vote yourself: https://preprod.cardanoscan.io/transaction/' + hashes[1] + '  (Metadata tab, label ' + GOVERNANCE_METADATA_LABEL + ')');
  console.log(`\n${fail === 0 ? '✅ PoC PASSED — on-chain governance voting works end to end' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
