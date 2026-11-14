import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

for (const readiness of [403, 204]) {
 const scenario = readiness === 403 ? 'disabled readiness creates no fixtures' : 'ambiguous cleanup retains the affected owner and freeze';
 test(scenario, () => {
  const runner = new URL('./test-all251-hosted-r2-byte-proof.mjs', import.meta.url);
  const child = spawnSync(process.execPath, ['--input-type=module', '-'], {
   encoding: 'utf8',
   timeout: 10000,
   input: `
    import assert from 'node:assert/strict';
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
    let requests = 0, created = 0, signedIn = 0, cleanupAttempts = 0;
    globalThis.fetch = async (url, {method, headers} = {}) => {
     requests++;
     const {pathname} = new URL(url);
     if (pathname === '/__all251_proof_ready') return new Response(null, {status: ${readiness}});
     if (pathname === '/auth/v1/admin/users') return Response.json({id: [a,b][created++]}, {status: 201});
     if (pathname === '/auth/v1/token') {
      const id = [a,b][signedIn++];
      return Response.json({user: {id}, access_token: id});
     }
     if (pathname.endsWith('request_deletion')) return Response.json(true);
     if (pathname.endsWith('cleanup_deletion')) {
      thawed.push(headers.authorization);
      return Response.json(true);
     }
     if (pathname.startsWith('/v1/workouts/')) {
      if (method === 'DELETE') cleanupAttempts++;
      return new Response(null, {status: 503});
     }
     if (method === 'DELETE' && pathname.startsWith('/auth/v1/admin/users/')) {
      removed.push(pathname.split('/').at(-1));
      return new Response(null, {status: 204});
     }
     throw new Error('Unexpected mock request: ' + pathname);
    };
    await import(${JSON.stringify(runner.href)});
    assert.equal(process.exitCode, 1);
    if (${readiness} === 403) {
     assert.equal(requests, 1);
     assert.equal(created, 0);
    } else {
     assert.equal(cleanupAttempts, 1);
     assert.deepEqual(thawed, ['Bearer ' + b]);
     assert.deepEqual(removed, [b]);
    }
    process.exitCode = 0;
   `,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, readiness === 403
   ? /proof not explicitly activated; no test users created/
   : /FAIL r2-cleanup-not-confirmed:A\//);
 });
}
