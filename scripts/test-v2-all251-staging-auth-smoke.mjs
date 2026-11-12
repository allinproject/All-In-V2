
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// ALL-251 only: create and remove two staging-only Auth users. Never log secrets.
const ref='fbtgknlxjyeqrxemskbl';
const base='https://'+ref+'.supabase.co';
const env=process.env;
assert.equal(env.CI,'true');
assert.equal(env.ALL251_STAGING_AUTH_ALLOW,'true');
assert.equal(env.ALL251_STAGING_REF,ref);
assert.equal(env.ALL251_STAGING_URL,base);
const key=env.ALL251_TEMP_STAGING_SECRET_KEY;
const anon=env.ALL251_TEMP_STAGING_PUBLISHABLE_KEY;
// Never mistake the new API keys for signed user JWTs. Reject legacy/mismatched
// values before making any network request.
assert(/^sb_secret_[A-Za-z0-9_-]+$/.test(key??''),'Staging-only modern secret key required');
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(anon??''),'Staging-only modern publishable key required');
assert(key!==anon,'Distinct protected staging credentials required');
const ids=[];
const password=randomUUID()+'aA!9';
async function request(path,{method='GET',body,userJwt=null,apiKey=key}={}){
  // Modern sb_secret_ and sb_publishable_ strings go ONLY in apikey.
  // Authorization is included only for an actual signed-in user's JWT.
  assert(apiKey===key||apiKey===anon,'Untrusted project API key');
  assert(userJwt===null||(typeof userJwt==='string'&&userJwt.split('.').length===3),
    'Expected real Auth session JWT');
  const res=await fetch(base+path,{method,redirect:'manual',
    signal:AbortSignal.timeout(30000),
    headers:{apikey:apiKey,
      ...(userJwt===null?{}:{authorization:'Bearer '+userJwt}),
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(res.redirected,false,'Redirect forbidden');
  return res;
}
async function user(){
 const email='all251-'+randomUUID()+'@example.invalid';
 const res=await request('/auth/v1/admin/users',{method:'POST',
   body:{email,password,email_confirm:true,user_metadata:{all251_synthetic_only:true}}});
 assert([200,201].includes(res.status),'Staging Auth user creation failed');
 const data=await res.json();assert(typeof data.id==='string','Missing Auth user id');
 ids.push(data.id);return {email,id:data.id};
}
async function login(u){
 const res=await request('/auth/v1/token?grant_type=password',
   {method:'POST',apiKey:anon,body:{email:u.email,password}});
 assert.equal(res.status,200,'Synthetic sign-in failed');
 const data=await res.json();
 assert.equal(data.user?.id,u.id,'Owner mismatch');
 assert(data.access_token,'No Auth JWT');
 return data.access_token;
}
let failed=false;
try{
 const a=await user(),b=await user();
 const aToken=await login(a),bToken=await login(b);
 assert.notEqual(aToken,bToken);
 process.stdout.write('PASS: two real isolated synthetic GoTrue sessions\\n');
 for(const token of [aToken,bToken]){
  const res=await request('/functions/v1/v2-account-export-download',{
    method:'POST',userJwt:token,apiKey:anon,body:{request_id:randomUUID()}});
  assert.equal(res.status,503,'Expected disabled staging export handler');
  const body=await res.json();
  assert.equal(body.code,'account_export_disabled');
  assert(/no-store/i.test(res.headers.get('cache-control')??''));
 }
 process.stdout.write('PASS: authenticated HTTP route rejects export while worker disabled\\n');
 const logout=await request('/auth/v1/logout',{method:'POST',userJwt:bToken,apiKey:anon});
 assert([200,204].includes(logout.status),'Auth logout failed');
 process.stdout.write('PASS: synthetic Auth session revoked\\n');
}catch{
 failed=true;process.stderr.write('FAIL: Auth/HTTP staging smoke; no tokens disclosed\\n');
}finally{
 for(const id of ids.reverse()){
  try{
   const res=await request('/auth/v1/admin/users/'+encodeURIComponent(id),{method:'DELETE'});
   assert([200,204].includes(res.status),'Cleanup rejected');
  }catch{
   failed=true;process.stderr.write('CLEANUP FAILED: staging Auth requires manual inspection\\n');
  }
 }
 if(!failed&&ids.length===2)process.stdout.write('PASS: two synthetic Auth users deleted\\n');
}
if(failed)process.exitCode=1;
