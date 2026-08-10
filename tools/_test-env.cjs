/**
 * MUST be `require()`-d as the very first line of every test-*.cjs file.
 *
 * Redirects DATABASE_URL to a dedicated `drepdao_test` database so test suites
 * never touch the dev DB. Each test file's own `.env` loader only sets values
 * that aren't already on `process.env`, so the override sticks.
 *
 * If you want to run a single test against the dev DB on purpose, set
 * DREPDAO_TEST_KEEP_DEV_DB=1 in the shell.
 */
if (!process.env.DREPDAO_TEST_KEEP_DEV_DB) {
  process.env.DATABASE_URL =
    process.env.DREPDAO_TEST_DATABASE_URL ||
    'postgresql://drep:drep@localhost:5432/drepdao_test?schema=public';
  process.env.DREPDAO_TEST = '1';
}
