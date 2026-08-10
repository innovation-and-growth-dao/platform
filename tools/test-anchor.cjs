/**
 * §C model: signed votes (CIP-30) + one on-chain anchor per decision, on the
 * DRep admission flow. Verifies (A) anchor-on-decision submits a real Preprod tx
 * readable on Koios, (B) a bogus signature is rejected, (C) a valid CIP-8
 * signature is accepted, stored, and re-verifies. Cleans up Heidi at the end.
 *
 *   node tools/test-anchor.cjs    (needs ANCHOR_MNEMONIC in .env + funded wallet)
 */
require('./_test-env.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const bip39 = require('bip39');
const CSL = require('@emurgo/cardano-serialization-lib-nodejs');
const MS = require('@emurgo/cardano-message-signing-nodejs');
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { DrepService } = require(root + '/apps/api/dist/drep/drep.service.js');
const { verifyCip30Signature } = require(root + '/apps/api/dist/auth/cip30.js');
const { admissionVoteMessage, GOVERNANCE_METADATA_LABEL } = require(root + '/packages/cardano/dist/index.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
const harden = (n) => n + 0x80000000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

// Stake key + reward-address bytes for a persona (the signData identity).
function stakeIdentity(mnemonic) {
  const root = CSL.Bip32PrivateKey.from_bip39_entropy(Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'), Buffer.from(''));
  const stakeKey = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0)).derive(2).derive(0);
  const cred = CSL.Credential.from_keyhash(stakeKey.to_public().to_raw_key().hash());
  const rewardAddr = CSL.RewardAddress.new(0, cred).to_address();
  return { prv: stakeKey.to_raw_key(), pub: stakeKey.to_public().to_raw_key(), addrBytes: rewardAddr.to_bytes() };
}

// Produce a CIP-30/CIP-8 signData result {signature, key} a wallet would return.
function signCip8(id, messageUtf8) {
  const prot = MS.HeaderMap.new();
  prot.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
  prot.set_header(MS.Label.new_text('address'), MS.CBORValue.new_bytes(id.addrBytes));
  const headers = MS.Headers.new(MS.ProtectedHeaderMap.new(prot), MS.HeaderMap.new());
  const builder = MS.COSESign1Builder.new(headers, Buffer.from(messageUtf8, 'utf8'), false);
  const sig = id.prv.sign(builder.make_data_to_sign().to_bytes()).to_bytes();
  const signature = Buffer.from(builder.build(sig).to_bytes()).toString('hex');

  const coseKey = MS.COSEKey.new(MS.Label.from_key_type(MS.KeyType.OKP));
  coseKey.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
  coseKey.set_header(MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('1'))), MS.CBORValue.new_int(MS.Int.new_i32(6))); // crv=Ed25519
  coseKey.set_header(MS.Label.new_int(MS.Int.new_negative(MS.BigNum.from_str('2'))), MS.CBORValue.new_bytes(id.pub.as_bytes())); // x=pubkey
  const key = Buffer.from(coseKey.to_bytes()).toString('hex');
  return { signature, key };
}

(async () => {
  const __bio100 = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' '); // §14.3 — bio needs ≥100 words
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma);
  const users = new UsersService(prisma, cardano);
  const drep = new DrepService(prisma, cardano, anchor);
  const login = async (k) => {
    const p = personas[k];
    const u = await users.upsertByStakeKey({ stakeKeyHash: stakeKeyHashFromBech32(p.stakeAddress), stakeAddress: p.stakeAddress, drepKeyHash: p.drepKeyHash });
    await users.getProfile(u.id);
    return u.id;
  };

  const alice = await login('regular');
  const dave = await login('dave');
  const erin = await login('erin');

  // Fresh Heidi
  const hu = await prisma.appUser.findUnique({ where: { stakeKeyHash: stakeKeyHashFromBech32(personas.heidi.stakeAddress) } });
  if (hu) { const d = await prisma.drep.findUnique({ where: { userId: hu.id } }); if (d) { await prisma.admissionVote.deleteMany({ where: { drepId: d.id } }); await prisma.drep.delete({ where: { id: d.id } }); } }
  const heidi = await login('heidi');
  const app = await drep.apply(heidi, { displayName: 'Heidi', bio: __bio100, country: 'Testland' });
  const heidiDrepId = personas.heidi.drepKeyHash; // unused; ref is drepIdOnchain
  const applicantDrepIdOnchain = app.drepIdOnchain;

  console.log('\n=== B — bogus signature is rejected ===');
  try {
    await drep.voteOnApplication(alice, app.id, { choice: 'YES', feedback: 'x', signature: 'deadbeef', signingKey: 'deadbeef', ts: new Date().toISOString() });
    ok('bogus signature rejected', false, 'accepted');
  } catch (e) { ok('bogus signature rejected', /signature verification failed/i.test(e.message), e.message); }

  console.log('\n=== C — valid CIP-8 signature accepted, stored, re-verifies ===');
  const ts = new Date().toISOString();
  const feedback = 'Strong governance track record.';
  const msg = admissionVoteMessage({ applicantDrepId: applicantDrepIdOnchain, voterStakeAddress: personas.regular.stakeAddress, choice: 'YES', rationale: feedback, ts });
  const id = stakeIdentity(personas.regular.mnemonic);
  const signed = signCip8(id, msg);
  ok('self-check: signature verifies (cardano-verify-datasignature)', verifyCip30Signature(signed.signature, signed.key, msg, personas.regular.stakeAddress) === true);
  await drep.voteOnApplication(alice, app.id, { choice: 'YES', feedback, signature: signed.signature, signingKey: signed.key, ts });
  const stored = await prisma.admissionVote.findFirst({ where: { drepId: app.id } });
  ok('signature stored on the vote', !!stored.signature && !!stored.signingKey);
  ok('stored signature re-verifies from DB', verifyCip30Signature(stored.signature, stored.signingKey, msg, personas.regular.stakeAddress) === true);

  console.log('\n=== A — 3rd YES → ADMITTED → anchored on-chain ===');
  await drep.voteOnApplication(dave, app.id, { choice: 'YES', feedback: 'Agree.' });
  const res = await drep.voteOnApplication(erin, app.id, { choice: 'YES', feedback: 'Welcome.' });
  ok('decision ADMITTED', res.status === 'ADMITTED', `yes=${res.yes}/${res.threshold}`);
  ok('anchor tx submitted', !!res.anchorTxHash, res.anchorTxHash || 'no txHash (ANCHOR_MNEMONIC set + funded?)');

  if (res.anchorTxHash) {
    console.log('  waiting for Koios to index the anchor…');
    let row;
    for (let i = 0; i < 24; i++) {
      await sleep(10000);
      const rows = await (await fetch('https://preprod.koios.rest/api/v1/tx_metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _tx_hashes: [res.anchorTxHash] }) })).json();
      row = rows.find((r) => r.metadata && r.metadata[String(GOVERNANCE_METADATA_LABEL)]);
      process.stdout.write(`  [${(i + 1) * 10}s] ${row ? 'indexed' : 'pending'}\r`);
      if (row) break;
    }
    console.log('');
    const meta = row && row.metadata[String(GOVERNANCE_METADATA_LABEL)];
    ok('readable metadata (title + ADMITTED)', meta && meta.title === 'Admission of new DAO member' && meta.outcome === 'ADMITTED');
    ok('lists all voters + their vote', meta && Array.isArray(meta.votes) && meta.votes.length === 3 && meta.votes.every((v) => v.drep && (v.vote === 'YES' || v.vote === 'NO')));
    ok('tally + commitment hash present', meta && meta.tally && meta.tally.yes === 3 && typeof meta.proofHash === 'string');
    console.log('   on-chain JSON:', JSON.stringify(meta).slice(0, 220));
    console.log('  on-chain anchor: https://preprod.cardanoscan.io/transaction/' + res.anchorTxHash);
  }

  console.log('\n=== Cleanup ===');
  await prisma.admissionVote.deleteMany({ where: { drepId: app.id } });
  await prisma.drep.delete({ where: { id: app.id } });
  ok('Heidi reset', (await prisma.drep.findUnique({ where: { userId: heidi } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED — signed votes + on-chain anchor work' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
