/**
 * Bootstraps the `drepdao_test` database used by every test-*.cjs suite.
 *
 *   - Creates `drepdao_test` inside the existing drepdao-postgres container if
 *     it doesn't already exist (idempotent).
 *   - Runs `prisma migrate deploy` against it so the schema matches the dev DB.
 *   - Optionally truncates every table (--reset) so a new run starts clean.
 *
 *   node tools/setup-test-db.cjs            # create + migrate (idempotent)
 *   node tools/setup-test-db.cjs --reset    # also TRUNCATE every table
 *
 * Called automatically by `tools/test-all.cjs` so individual contributors don't
 * need to remember it. Safe to re-run.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adminUrl = 'postgresql://drep:drep@localhost:5432/postgres?schema=public';
const testUrl = 'postgresql://drep:drep@localhost:5432/drepdao_test?schema=public';
const reset = process.argv.includes('--reset');

function run(label, cmd, args, env = {}) {
  process.stdout.write(`  · ${label}... `);
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.log('FAILED');
    console.error(r.stdout);
    console.error(r.stderr);
    process.exit(r.status ?? 1);
  }
  console.log('ok');
  return r.stdout;
}

(async () => {
  console.log('Setting up drepdao_test database:');

  // Step 1 — ensure the database exists. `psql` ignores the existing-db error.
  const out = run(
    'CREATE DATABASE drepdao_test (idempotent)',
    'docker',
    [
      'exec', '-i', 'drepdao-postgres',
      'psql', '-U', 'drep', '-d', 'postgres', '-tAc',
      "SELECT 1 FROM pg_database WHERE datname='drepdao_test'",
    ]
  );
  if (out.trim() !== '1') {
    run(
      'CREATE DATABASE',
      'docker',
      [
        'exec', '-i', 'drepdao-postgres',
        'psql', '-U', 'drep', '-d', 'postgres', '-c',
        'CREATE DATABASE drepdao_test OWNER drep',
      ]
    );
  }

  // Step 2 — apply migrations against the test DB.
  run(
    'prisma migrate deploy',
    'pnpm',
    ['--filter', '@drep-dao/db', 'exec', 'prisma', 'migrate', 'deploy'],
    { DATABASE_URL: testUrl }
  );

  // Step 3 — optional clean-out.
  if (reset) {
    run(
      'TRUNCATE all tables',
      'docker',
      [
        'exec', '-i', 'drepdao-postgres',
        'psql', '-U', 'drep', '-d', 'drepdao_test', '-c',
        `DO $$ DECLARE r RECORD; BEGIN
           FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations') LOOP
             EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
           END LOOP;
         END $$;`,
      ]
    );
  }

  // Step 3b — seed the singleton platform_state row (id=1). The app creates it
  // lazily on first genesis access; the in-process test harness calls update()
  // before that, so seed it here (all other columns have defaults). Idempotent.
  run(
    'seed platform_state id=1',
    'docker',
    ['exec', '-i', 'drepdao-postgres', 'psql', '-U', 'drep', '-d', 'drepdao_test', '-c',
      'INSERT INTO platform_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING'],
  );

  // Step 4 — ensure a platform admin exists. test-genesis seeds the board, which
  // is admin-gated; without an admin every suite cascades to "0 board dreps".
  // Idempotent: only creates one when admin_user is empty (e.g. after --reset).
  const adminCount = run(
    'check admin_user',
    'docker',
    ['exec', '-i', 'drepdao-postgres', 'psql', '-U', 'drep', '-d', 'drepdao_test', '-tAc', 'SELECT count(*) FROM admin_user'],
  );
  if (adminCount.trim() === '0') {
    run(
      'create test admin',
      'pnpm',
      ['admin:create', '--', '--username=test', '--email=test@drep.test', '--password=test1234'],
      { DATABASE_URL: testUrl },
    );
  }

  console.log('Test DB ready at', testUrl);
})();
