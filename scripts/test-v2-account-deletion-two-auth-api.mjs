// ALL-251: REAL local Supabase HTTP Auth + PostgREST integration, two independent sessions.
// Never run against a hosted target or persist fixture credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

assert.equal(process.env.CI, '1', 'CI-only test');
const output = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
const config = Object.fromEntries(output.split(/\r?\n/).map(line => {
  const match = line.match(/^(?:export )?([A-Z_]+)=(.*)$/);
  return match ? [match[1], match[2].replace(/^["']|["']$/g, '')] : [];
}).filter(x => x.length === 2));
const base = config.API_URL;
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base ?? ''), 'local loopback API only');
assert.ok(config.ANON_KEY && config.SERVICE_ROLE_KEY, 'local CLI keys required');
const nonce = randomBytes(12).toString('hex');
const accounts = [
  { email: `all251-local-a-${nonce}@invalid.example`, password: `A!secure-${randomBytes(24).toString('hex')}` },
  { email: `all251-local-b-${nonce}@invalid.example`, password: `B!secure-${randomBytes(24).toString('hex')}` },
];
const created = [];
async function call(path, { method = 'POST', token, key = config.ANON_KEY, data } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  return { status: response.status, body };
}
function ok(result, label) {
  assert.equal(result.status, 200, `${label}: HTTP ${result.status}; ${result.body?.code ?? 'unknown'}`);
  return result.body;
}
function denied(result, label) {
  assert.ok([401, 403].includes(result.status), `${label}: expected access denied, HTTP ${result.status}`);
}
async function rpc(name, token, data) {
  return call(`/rest/v1/rpc/${name}`, { token, data });
}
try {
  // Local-only admin creates test users; user operations ALWAYS use separate anon-key sessions.
  for (const account of accounts) {
    const createdUser = await call('/auth/v1/admin/users', {
      key: config.SERVICE_ROLE_KEY,
      method: 'POST',
      data: { email: account.email, password: account.password, email_confirm: true },
    });
    assert.ok([200, 201].includes(createdUser.status), 'local test Auth user creation');
    assert.ok(createdUser.body?.id, 'local fixture Auth user ID missing');
    account.id = createdUser.body.id;
    created.push(account.id);
    const signedIn = await call('/auth/v1/token?grant_type=password', {
      data: { email: account.email, password: account.password },
    });
    assert.equal(signedIn.status, 200, 'password login must succeed');
    account.token = signedIn.body?.access_token;
    assert.ok(account.token && signedIn.body?.refresh_token, 'independent password session required');
    const identity = await call('/auth/v1/user', { method: 'GET', token: account.token });
    assert.equal(identity.status, 200, 'Auth getUser must succeed');
    assert.equal(identity.body?.id, account.id, 'JWT must belong to signed-in owner');
  }
  const [a,b] = accounts;
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.token, b.token);
  const status = user => rpc('v2_my_account_deletion_request', user.token, { p_expected_user_id: user.id });
  const request = (user, owner = user.id, confirmation = 'DELETE MY ACCOUNT') =>
    rpc('v2_request_account_deletion', user.token, { p_expected_user_id: owner, p_confirm: confirmation });
  const cancel = (user, owner, requestId) =>
    rpc('v2_cancel_account_deletion_request', user.token, { p_expected_user_id: owner, p_expected_request_id: requestId });

  assert.equal(ok(await status(a), 'A initially empty').status, 'none');
  assert.equal(ok(await status(b), 'B initially empty').status, 'none');
  denied(await rpc('v2_my_account_deletion_request', config.ANON_KEY, { p_expected_user_id: a.id }), 'anonymous status');
  denied(await rpc('v2_request_account_deletion', config.ANON_KEY, { p_expected_user_id: a.id, p_confirm: 'DELETE MY ACCOUNT' }), 'anonymous request');
  denied(await rpc('v2_claim_account_deletion_for_processing', a.token, {
    p_expected_user_id: a.id, p_expected_request_id: '00000000-0000-4000-8000-000000000000'
  }), 'client service-only claim');
  denied(await request(a, a.id, 'no'), 'wrong confirmation');
  denied(await status.call(null, { ...a, id: b.id }), 'A reads B');
  denied(await request(a, b.id), 'A requests B');
  denied(await cancel(a, b.id, '00000000-0000-4000-8000-000000000000'), 'A cancels B');

  const aFirst = ok(await request(a), 'A own deletion request');
  assert.equal(aFirst.status, 'requested');
  assert.ok(aFirst.request_id);
  assert.equal(ok(await request(a), 'A repeated request').request_id, aFirst.request_id, 'idempotent duplicate');
  assert.equal(ok(await status(a), 'A own status').request_id, aFirst.request_id);
  assert.equal(ok(await status(b), 'B unaffected').status, 'none');
  const bFirst = ok(await request(b), 'B own deletion request');
  assert.equal(bFirst.status, 'requested');
  assert.notEqual(bFirst.request_id, aFirst.request_id);
  denied(await cancel(a, b.id, bFirst.request_id), 'A cancels actual B request');
  denied(await cancel(b, a.id, aFirst.request_id), 'B cancels actual A request');
  assert.equal(ok(await cancel(a, a.id, aFirst.request_id), 'A own cancel').status, 'cancelled');
  const aSecond = ok(await request(a), 'A re-request');
  assert.equal(aSecond.status, 'requested');
  assert.notEqual(aSecond.request_id, aFirst.request_id, 'new request must rotate ID');
  denied(await cancel(a, a.id, aFirst.request_id), 'stale cancellation');
  assert.equal(ok(await status(b), 'B independent').request_id, bFirst.request_id);
  assert.equal(ok(await cancel(b, b.id, bFirst.request_id), 'B own cancel').status, 'cancelled');
  assert.equal(ok(await cancel(a, a.id, aSecond.request_id), 'A second own cancel').status, 'cancelled');
  console.log('PASS ALL-251: two independent local Auth sessions and PostgREST owner isolation, request/cancel/idempotency');
} finally {
  for (const id of created.reverse()) {
    const res = await call(`/auth/v1/admin/users/${id}`, {
      method: 'DELETE', key: config.SERVICE_ROLE_KEY,
    }).catch(() => null);
    assert.ok(res && [200, 204].includes(res.status), 'local fixture cleanup failed');
  }
}
