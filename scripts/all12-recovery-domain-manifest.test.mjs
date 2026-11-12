import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRecoveryCoverage,recoveryDomains} from './all12-recovery-domain-manifest.mjs';
test('missing domains fail closed',()=>{
 const x=assessRecoveryCoverage();
 assert.equal(x.complete,false);
 assert.equal(x.domains.find(d=>d.name==='coach').status,'absent');
});
test('database-only restore cannot claim media or Auth config',()=>{
 const tables=recoveryDomains.flatMap(d=>d.tables);
 const x=assessRecoveryCoverage({presentTables:tables,verifiedTables:tables});
 assert.equal(x.complete,false);
 assert.equal(x.domains.find(d=>d.name==='private_media').status,'unverified');
 assert.equal(x.domains.find(d=>d.name==='auth_configuration').status,'unverified');
});
test('partial Training or Completed Activity coverage fails closed',()=>{
 const tables=recoveryDomains.flatMap(d=>d.tables);
 const x=assessRecoveryCoverage({presentTables:tables,verifiedTables:tables.filter(t=>t!=='public.v2_activity_sources'),verifiedExternal:['private_media','auth_configuration']});
 assert.equal(x.complete,false);
 assert.deepEqual(x.domains.find(d=>d.name==='completed_activity').unverified,['public.v2_activity_sources']);
});
test('all explicitly verified requirements are necessary',()=>{
 const tables=recoveryDomains.flatMap(d=>d.tables);
 assert.equal(assessRecoveryCoverage({presentTables:tables,verifiedTables:tables,verifiedExternal:['private_media','auth_configuration']}).complete,true);
});
