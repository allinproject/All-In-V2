import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for (const {scenario, readiness, ambiguous} of [
 {scenario: 'disabled readiness creates no fixtures', readiness: 403},
 {scenario: 'ambiguous cleanup retains the affected owner and freeze', readiness: 204, ambiguous: true},
 {scenario: 'successful A/B bytes, freeze and cleanup', readiness: 204, ambiguous: false},
]) {
 test(scenario, () => {
  const runner = new URL('./test-all251-hosted-r2-byte-proof.mjs', import.meta.url);
  const child = spawnSync(process.execPath, ['--input-type=module', '-'], {
   encoding: 'utf8',
   timeout: 10000,
   input: `
    import assert from 'node:assert/strict';
    import {createHash} from 'node:crypto';
    Object.assign(process.env, {
     CI: 'true', ALL251_R2_HOSTED_OPERATOR_APPROVED: 'true',
     ALL251_STAGING_REF: 'fbtgknlxjyeqrxemskbl',
     ALL251_STAGING_URL: 'https://fbtgknlxjyeqrxemskbl.supabase.co',
     ALL251_R2_WORKER_URL: 'https://allin365-storage-staging.durbenventures.workers.dev',
     ALL251_TEMP_STAGING_SECRET_KEY: 'sb_secret_fixture',
     ALL251_TEMP_STAGING_PUBLISHABLE_KEY: 'sb_publishable_fixture',
    });
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const thawed = [], removed = [];
    const frozen = new Set(), objects = new Map();
    let requests = 0, created = 0, signedIn = 0, cleanupAttempts = 0;
    globalThis.fetch = async (url, {method, headers, body} = {}) => {
     requests++;
     const {pathname} = new URL(url);
     if (pathname === '/__all251_proof_ready') return new Response(null, {status: ${readiness}});
     if (pathname === '/auth/v1/admin/users') return Response.json({id: [a,b][created++]}, {status: 201});
     if (pathname === '/auth/v1/token') {
      const id = [a,b][signedIn++];
      return Response.json({user: {id}, access_token: id});
     }
     const owner = headers?.authorization?.slice(7);
     if (pathname.endsWith('request_deletion')) {
      frozen.add(owner);
      return Response.json(true);
     }
     if (pathname.endsWith('cleanup_deletion')) {
      thawed.push(headers.authorization);
      return Response.json(true);
     }
     if (pathname.startsWith('/v1/workouts/')) {
      if (${Boolean(ambiguous)}) {
       if (method === 'DELETE') cleanupAttempts++;
       return new Response(null, {status: 503});
      }
      const key = owner + '/' + pathname.split('/')[3];
      if (method === 'DELETE') {
       if (!frozen.has(owner)) return new Response(null, {status: 403});
       objects.delete(key);
       return new Response(null, {status: 204});
      }
      if (method === 'POST') {
       if (frozen.has(owner)) return new Response(null, {status: 401});
       objects.set(key, Buffer.from(body));
       return Response.json({code: 'CREATED'}, {status: 201});
      }
      const bytes = objects.get(key);
      if (frozen.has(owner) || !bytes) return new Response(null, {status: 403});
      return Response.json({sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length});
     }
     if (method === 'DELETE' && pathname.startsWith('/auth/v1/admin/users/')) {
      removed.push(pathname.split('/').at(-1));
      return new Response(null, {status: 204});
     }
     throw new Error('Unexpected mock request: ' + pathname);
    };
    await import(${JSON.stringify(runner.href)});
    assert.equal(process.exitCode, ${readiness === 403 || ambiguous ? 1 : 'undefined'});
    if (${readiness} === 403) {
     assert.equal(requests, 1);
     assert.equal(created, 0);
    } else if (${Boolean(ambiguous)}) {
     assert.equal(cleanupAttempts, 1);
     assert.deepEqual(thawed, ['Bearer ' + b]);
     assert.deepEqual(removed, [b]);
    } else {
     assert.equal(objects.size, 0);
     assert.deepEqual(thawed, ['Bearer ' + b, 'Bearer ' + a]);
     assert.deepEqual(removed, [b, a]);
    }
    process.exitCode = 0;
   `,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  if (readiness === 403) assert.match(child.stderr, /proof not explicitly activated; no test users created/);
  else if (ambiguous) assert.match(child.stderr, /FAIL r2-cleanup-not-confirmed:A\//);
  else assert.match(child.stdout, /PASS synthetic DELETE receipts and Auth cleanup/);
 });
}
