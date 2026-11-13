import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('staging bridge matches canonical M1/M2 except documented global-ACL preservation',()=>{
 const bridge=readFileSync('docs/architecture/sql/V2-SHARED-STAGING-PROFILE-FOUNDATION-BRIDGE-REVIEW.sql','utf8');
 const paths=[
  'supabase/migrations/20261110021548_v2_auth_profile_legal_foundation.sql',
  'supabase/migrations/20261110022457_v2_tighten_profile_privileges_and_legal_versions.sql'
 ];
 for(const path of paths){
  const orig=readFileSync(path,'utf8');
  const hash=createHash('sha1').update('blob '+Buffer.byteLength(orig)+'\0').update(orig).digest('hex');
  const start='-- BEGIN CANONICAL SOURCE '+path+' [Git blob '+hash+']\n';
  const end='\n-- END CANONICAL SOURCE '+path+'\n';
  assert.ok(bridge.includes(start),'source marker or exact blob hash mismatch: '+path);
  const from=bridge.indexOf(start)+start.length;
  const to=bridge.indexOf(end,from);
  assert.ok(to>from,'missing closing source marker '+path);
  const replacement=`-- SHARED-STAGING EXCEPTION: preserve pre-existing database-default and
-- allin_private schema ACLs, including ALL-228 reviewer/operator access.
-- The canonical source M1 global default privilege changes are deliberately
-- NOT replayed into the existing shared staging project. Newly created
-- profile tables/functions retain their explicit canonical per-object RLS,
-- policy and GRANT/REVOKE rules from the unchanged remainder of M1/M2.
-- No service_role USAGE is added to the existing private schema here.

`;
  const sourceStart='-- Fail closed for future objects created by the postgres migration role.';
  const sourceEnd='create table if not exists public.v2_profiles (';
  const expected=path.includes('20261110021548_')
   ? orig.slice(0,orig.indexOf(sourceStart))+replacement+orig.slice(orig.indexOf(sourceEnd))
   : orig;
  assert.equal(bridge.slice(from,to),expected,
    'bridge source diverged from canonical outside the explicit shared-staging privilege exception '+path);
 }
 assert.ok(bridge.includes('Existing shared staging object changed:'),
  'bridge must guard existing Coach/Nutrition/account lifecycle');
 assert.ok(bridge.includes('Canonical profile foundation already present'),
  'bridge must reject duplicate foundation');
});
