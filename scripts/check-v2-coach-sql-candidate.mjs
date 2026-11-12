import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

// Static gate only. Real PostgreSQL/RLS/owner tests run in disposable Supabase CI.
const root = 'docs/architecture/sql/';
const names = ['V2-COACH-PERSISTENCE-CANDIDATE.sql',
  'V2-COACH-PERSISTENCE-SECURITY-CHECKS.sql',
  'V2-COACH-PERSISTENCE-TWO-OWNER-LOCAL.psql'];

function checkDollarQuotes(source, name) {
  const stripped = source.split('\n').map(line => /^\s*--/.test(line) ? '' : line).join('\n');
  const tokens = stripped.match(/\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$/g) ?? [];
  let open = null;
  for (const token of tokens) {
    if (open === null) open = token;
    else if (open === token) open = null;
  }
  assert.equal(open, null, `${name}: unclosed PostgreSQL dollar literal`);
}

function validate(files) {
  const [ddl, security, replay] = files;
  for (let i = 0; i < files.length; i++) {
    checkDollarQuotes(files[i], names[i]);
    assert(!/\bEND\s+\$;/.test(files[i]), `${names[i]}: invalid END $; delimiter`);
  }
  assert(ddl.includes('BEGIN;') && ddl.includes('COMMIT;'), 'non-atomic DDL candidate');
  for (const name of ['v2_coach_threads','v2_coach_messages','v2_coach_message_actions']) {
    const schema = name === 'v2_coach_message_actions' ? 'allin_private' : 'public';
    assert(ddl.includes(`CREATE TABLE ${schema}.${name}`), `table missing: ${name}`);
    assert(ddl.includes(`ALTER TABLE ${schema}.${name} ENABLE ROW LEVEL SECURITY`), `RLS missing: ${name}`);
    assert(security.includes(name), `security check missing: ${name}`);
  }
  for (const operation of ['v2_coach_get_or_create_thread','v2_coach_append_user_message',
    'v2_coach_read_messages','v2_coach_record_assistant_reply']) {
    assert(ddl.includes(`FUNCTION public.${operation}`), `writer/reader missing: ${operation}`);
    assert(security.includes(operation), `security check missing: ${operation}`);
  }
  assert(/GRANT EXECUTE ON FUNCTION public\.v2_coach_record_assistant_reply\([^)]+\) TO service_role;/.test(ddl),
    'assistant writer must be granted to service_role');
  assert(!/GRANT EXECUTE ON FUNCTION public\.v2_coach_record_assistant_reply\([^)]+\) TO authenticated;/.test(ddl),
    'assistant writer must not be granted to authenticated');
  for (const token of ['ROLLBACK;', 'SET LOCAL ROLE authenticated;', 'SET LOCAL ROLE service_role;',
    'SET LOCAL ROLE anon;', 'Coach equal-timestamp pagination', 'deleted account retained Coach data']) {
    assert(replay.includes(token), `local replay missing: ${token}`);
  }
  assert(replay.includes('\\set ON_ERROR_STOP on'), 'replay must fail on SQL errors');
}
if (process.argv.includes('--self-test')) {
  assert.throws(() => checkDollarQuotes('DO $$ BEGIN; END $;', 'bad'), /unclosed/);
  assert.throws(() => validate(['BEGIN; COMMIT;', 'x', 'ROLLBACK;']), /missing/);
  console.log('PASS: Coach SQL static guard negative self-tests');
} else {
  validate(names.map(name => readFileSync(root + name, 'utf8')));
  console.log('PASS: Coach SQL source checks (not PostgreSQL execution)');
}
