/** ALL-251: manual-only authenticated hosted HTTP acceptance; no deployments or test-user creation.
 * Credentials must be supplied by an authorized operator through protected runner secrets.
 * This script NEVER logs tokens or response bodies, and refuses all non-temporary targets.
 */
import assert from 'node:assert/strict';
import {verifyAccountExportDownload} from '../supabase/functions/_shared/trainingExportDownloadVerifier.mjs';

const REF='fbtgknlxjyeqrxemskbl';
const ENDPOINT=`https://${REF}.supabase.co/functions/v1/v2-account-export-download`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env=process.env;
function required(name){
  const value=env[name];
  if(!value)throw Error('Missing protected staging input: '+name);
  return value;
}
assert.equal(env.CI,'true','Run only in a protected CI environment');
assert.equal(env.ALL251_HTTP_ALLOW,'true','Explicit staging-only opt-in required');
assert.equal(required('ALL251_HTTP_PROJECT_REF'),REF,'Wrong project');
const configured=required('ALL251_HTTP_ENDPOINT');
assert.equal(configured,ENDPOINT,'Only the exact approved staging function is allowed');
const ownerId=required('ALL251_OWNER_A_ID'),requestId=required('ALL251_OWNER_A_REQUEST_ID');
assert(UUID.test(ownerId)&&UUID.test(requestId),'Invalid synthetic owner/request ID');
const ownerToken=required('ALL251_OWNER_A_TOKEN');
const otherToken=required('ALL251_OWNER_B_TOKEN');
const revokedToken=required('ALL251_REVOKED_TOKEN');
assert(new Set([ownerToken,otherToken,revokedToken]).size===3,'Distinct test sessions required');
const collections=JSON.parse(required('ALL251_EXPECTED_COLLECTIONS_JSON'));
assert(Array.isArray(collections)&&collections.length>0&&collections.length<=64
  &&collections.every(x=>typeof x==='string'&&/^[a-z][a-z0-9_.]{0,63}$/.test(x))
  &&new Set(collections).size===collections.length,'Invalid trusted collection inventory');
async function invoke(token,request=requestId,extra={}){
  const headers={'Content-Type':'application/json',authorization:'Bearer '+token};
  const response=await fetch(ENDPOINT,{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(120000),
    headers,body:JSON.stringify({request_id:request,...extra}),
  });
  assert.equal(response.redirected,false,'Redirect denied');
  assert.equal(response.headers.get('access-control-allow-origin'),null,'CORS exposure denied');
  assert(/no-store/i.test(response.headers.get('cache-control')??''),'Missing no-store');
  return response;
}
async function denied(label,token,request=requestId,extra={}){
  const res=await invoke(token,request,extra);
  assert([400,401,403,405,413].includes(res.status),
    label+': an unauthorized request was not denied');
  const size=(await res.arrayBuffer()).byteLength;
  assert(size<=1024,label+': error response too large');
  process.stdout.write('PASS '+label+'\n');
}
try{
  await denied('cross-account request denied',otherToken);
  await denied('revoked session denied',revokedToken);
  await denied('caller-supplied owner rejected',ownerToken,requestId,{owner_id:ownerId});
  const res=await invoke(ownerToken);
  assert.equal(res.status,200,'Approved owner session did not receive HTTP 200');
  assert(/application\/x-ndjson/i.test(res.headers.get('content-type')??''),
    'Unexpected download content type');
  assert(res.body,'Missing download stream');
  const result=await verifyAccountExportDownload({
    stream:res.body,expectedOwnerId:ownerId,expectedCollections:collections,
  });
  assert.equal(result.verified,true,'Full stream integrity verification failed');
  assert(result.recordCount>0,'Expected representative populated synthetic owner history');
  process.stdout.write('PASS authenticated owner HTTP download, complete receipt, SHA-256 and scoped ownership\n');
  process.stdout.write('PASS records='+result.recordCount+'\n');
}catch{
  // Do not print raw network errors which may echo request headers or credentials.
  process.stderr.write('FAIL ALL-251 hosted HTTP acceptance: check controlled CI diagnostics (no credentials printed)\n');
  process.exitCode=1;
}
