import candidate from './worker-r2-proof-candidate.mjs';

const ownerId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const staging = 'https://fbtgknlxjyeqrxemskbl.supabase.co';

export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  const bearer = request.headers.get('authorization');
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/race' ||
      request.method !== 'POST' || env.ALL251_LOCAL_RACE !== 'enabled' ||
      env.SUPABASE_URL !== staging || !ownerId.test(env.ALL251_LOCAL_RACE_OWNER ?? '') ||
      !/^Bearer [A-Za-z0-9._~-]{20,4096}$/.test(bearer ?? '')) return new Response(null, {status: 403});

  const id = crypto.randomUUID();
  const objectUrl = new URL('/v1/workouts/' + id, url);
  const headers = {authorization: bearer};
  const rpcHeaders = {...headers, apikey: env.SUPABASE_PUBLISHABLE_KEY};
  const fixtureEnv = {...env, ALL251_ENABLE_SYNTHETIC_PROOF: 'synthetic-proof-reviewed'};
  const bucket = env.PRIVATE_STORAGE;
  let owner;
  let path;
  let entered = false;
  let freezeAttempted = false;
  try {
   const auth = await fetch(staging + '/auth/v1/user', {
    headers: rpcHeaders, redirect: 'error', signal: AbortSignal.timeout(5000),
   });
   if (!auth.ok) throw Error('Auth lookup failed');
   const profile = await auth.json();
   if (profile.id !== env.ALL251_LOCAL_RACE_OWNER || profile.app_metadata?.all251_httpmatrix !== true ||
       !/^all251-http-[a-z0-9-]+@example\.invalid$/i.test(profile.email ?? '')) {
    return new Response(null, {status: 403});
   }
   owner = profile.id;
   path = owner + '/' + id + '.bin';
   const put = async (key, ...args) => {
    if (entered || key !== path) throw Error('Unexpected R2 write');
    entered = true;
    freezeAttempted = true;
    const freeze = await fetch(staging + '/rest/v1/rpc/v2_all251_http_matrix_request_deletion', {
     method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
     headers: {...rpcHeaders, 'content-type': 'application/json'},
     body: JSON.stringify({p_expected_user_id: owner, p_confirmation: 'DELETE MY ACCOUNT'}),
    });
    if (!freeze.ok || await freeze.json() !== true) throw Error('Freeze failed');
    const denied = await candidate.fetch(new Request(objectUrl, {method: 'DELETE', headers}), fixtureEnv);
    if (denied.status !== 403 || (await denied.json()).code !== 'CLEANUP_DENIED') {
     throw Error('Expected unsettled lease to deny cleanup');
    }
    return bucket.put(key, ...args);
   };
   const written = await candidate.fetch(new Request(objectUrl, {
    method: 'POST', headers: {...headers, 'content-type': 'application/octet-stream'},
    body: new Uint8Array([65, 76, 76, 50, 53, 49]),
   }), {...fixtureEnv, PRIVATE_STORAGE: {
    put, get: bucket.get.bind(bucket), head: bucket.head.bind(bucket),
   }});
   if (!entered || written.status !== 201) throw Error('Write did not settle');
   const deleted = await candidate.fetch(new Request(objectUrl, {method: 'DELETE', headers}), fixtureEnv);
   if (deleted.status !== 204 || await bucket.head(path) !== null) throw Error('Cleanup unverified');
   return Response.json({code: 'RACE_PASSED', owner, object: id});
  } catch {
   return Response.json({code: 'RACE_UNVERIFIED', owner, object: id, freezeAttempted}, {status: 503});
  }
 },
};
