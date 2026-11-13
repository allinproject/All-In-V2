// ALL-222/243/246: hosted read-only Auth + owner reader acceptance.
// Requires two disposable, independently authenticated staging users and
// their separately populated canonical Training/Completed Activity fixtures.
// Never provisions users, writes data or logs passwords/JWTs.
// Hard bound to the explicitly approved temporary V2 staging project.
import assert from 'node:assert/strict';

const PROJECT='fbtgknlxjyeqrxemskbl';
const endpoint=`https://${PROJECT}.supabase.co`;
const key=process.env.V2_STAGING_PUBLISHABLE_KEY;
const a={email:process.env.V2_STAGING_A_EMAIL,password:process.env.V2_STAGING_A_PASSWORD,
 owner:process.env.V2_STAGING_A_OWNER_ID,activity:process.env.V2_STAGING_A_ACTIVITY_ID};
const b={email:process.env.V2_STAGING_B_EMAIL,password:process.env.V2_STAGING_B_PASSWORD,
 owner:process.env.V2_STAGING_B_OWNER_ID,activity:process.env.V2_STAGING_B_ACTIVITY_ID};
const date=process.env.V2_STAGING_TEST_LOCAL_DATE;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!key || !a.email || !a.password || !b.email || !b.password ||
 !uuid.test(a.owner||'') || !uuid.test(b.owner||'') ||
 !uuid.test(a.activity||'') || !uuid.test(b.activity||'') ||
 a.owner===b.owner || !/^\d{4}-\d{2}-\d{2}$/.test(date||'')) {
 throw new Error('Staging test fixture credentials/IDs/date missing or invalid; no HTTP sent');
}
function http(path,accessToken,body){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15000);
 return fetch(endpoint+path,{
  method:'POST',headers:{'apikey':key,
    ...(accessToken?{'Authorization':`Bearer ${accessToken}`}:{}),
    'Content-Type':'application/json'},
  body:JSON.stringify(body),signal:controller.signal,
 }).then(async res=>{
  const raw=await res.text();
  let value;try{value=JSON.parse(raw)}catch{value=null}
  return {status:res.status,value};
 }).finally(()=>clearTimeout(timeout));
}
async function login(identity){
 const response=await http('/auth/v1/token?grant_type=password',null,{
  email:identity.email,password:identity.password,
 });
 assert.equal(response.status,200,'Disposable staging Auth sign-in must succeed');
 assert.ok(response.value?.access_token,'Missing real Auth access token');
 assert.equal(response.value?.user?.id,identity.owner,'Auth account does not match approved fixture');
 return response.value.access_token;
}
function deny(response,what){
 assert.ok(response.status===401||response.status===403||response.status===404,
  `${what}: expected denied owner access; got HTTP ${response.status}`);
}
async function rpc(token,name,params){
 return http(`/rest/v1/rpc/${name}`,token,params);
}
async function verifyOwner(user,other,token){
 const training=await rpc(token,'v2_training_day_read_candidate',
   {p_expected_user_id:user.owner,p_athlete_date:date});
 assert.equal(training.status,200,'Canonical Training day reader HTTP status');
 assert.equal(training.value?.ownerId,user.owner,'Wrong Training owner');
 assert.equal(training.value?.localDate,date,'Wrong athlete-local date');
 assert.ok(Array.isArray(training.value?.plannedWorkouts),'Training list missing');
 assert.ok(training.value.plannedWorkouts.length>0,'Test fixture must include a planned session');
 const detail=await rpc(token,'v2_completed_activity_detail_candidate',
   {p_expected_user_id:user.owner,p_activity_id:user.activity});
 assert.equal(detail.status,200,'Completed Activity reader HTTP status');
 assert.equal(detail.value?.ownerId,user.owner,'Wrong completed owner');
 assert.equal(detail.value?.activityId,user.activity,'Wrong completed activity');
 const crossTraining=await rpc(token,'v2_training_day_read_candidate',
   {p_expected_user_id:other.owner,p_athlete_date:date});
 deny(crossTraining,'Cross-owner Training read');
 const crossActivity=await rpc(token,'v2_completed_activity_detail_candidate',
   {p_expected_user_id:user.owner,p_activity_id:other.activity});
 deny(crossActivity,'Cross-owner Completed Activity read');
}
const tokenA=await login(a);
const tokenB=await login(b);
await verifyOwner(a,b,tokenA);
await verifyOwner(b,a,tokenB);
// apikey alone must never qualify as authenticated Auth session.
const anon=await rpc(null,'v2_training_day_read_candidate',
 {p_expected_user_id:a.owner,p_athlete_date:date});
deny(anon,'Anonymous Training read');
const anonDetail=await rpc(null,'v2_completed_activity_detail_candidate',
 {p_expected_user_id:a.owner,p_activity_id:a.activity});
deny(anonDetail,'Anonymous Activity read');
console.log('PASS isolated hosted staging Auth sign-in, two-owner canonical RPC readers, cross-owner and anonymous denial');
console.log('NOTE session revocation/commit race requires separately controlled Auth session removal and retest');
