import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {auditAppliedMigrations,appliedFoundation} from './check-v2-applied-migration-integrity.mjs';
import {attestBillingCandidate} from './attest-v2-billing-release-sources.mjs';

const root=resolve(import.meta.dirname,'..');
const read=relative=>readFileSync(resolve(root,relative),'utf8');
const proposal=[
 ['docs/architecture/sql/V2-SUBSCRIPTION-VERIFIED-LEDGER-CANDIDATE.sql',
  'supabase/migrations/20261112100000_v2_billing_verified_subscription_ledger.sql'],
 ['docs/architecture/sql/V2-SUBSCRIPTION-SERVICE-GRANTS-CANDIDATE.sql',
  'supabase/migrations/20261112100001_v2_billing_service_role_grants.sql'],
];
function body(text){
 const first=text.indexOf('\n\n');
 assert.ok(first>=0,'SQL must have an isolated first comment paragraph');
 return text.slice(first+2);
}

test('review branch versions exact existing SQL bodies without replacing security or grants',()=>{
 for(const [source,versioned] of proposal){
  const reviewed=read(source),migration=read(versioned);
  assert.match(migration,/PROPOSED VERSIONED/);
  assert.match(migration,/ISOLATED REVIEW ONLY/);
  assert.equal(body(migration),body(reviewed),versioned+' drifted from canonical candidate');
 }
});
test('version numbers preserve 18 immutable live baseline migrations and order grants after ledger',()=>{
 const names=appliedFoundation.map(x=>x[0]);
 const future=proposal.map(p=>p[1].split('/').at(-1));
 const audit=auditAppliedMigrations([...names,...future],
  name=>read('supabase/migrations/'+name));
 assert.deepEqual(audit.problems,[]);
 assert.equal(audit.appliedCount,18);
 assert.ok(future[0]<future[1]);
 assert.ok(future.every(name=>name>names.at(-1)));
});
test('exact source grant attest still fails closed',()=>{
 const report=attestBillingCandidate(read(proposal[0][0]),read(proposal[1][0]));
 assert.equal(report.ok,true,report.problems.join('; '));
 assert.equal(report.grantCount,25);
});
