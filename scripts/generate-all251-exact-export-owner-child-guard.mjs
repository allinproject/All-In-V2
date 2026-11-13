// ALL-251 isolated SQL fixture: execute the EXACT join-only exclusion
// predicate extracted from the existing canonical paginated owner inventory.
// This is never packaged or deployed as an application function.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const src=readFileSync('docs/architecture/sql/V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql','utf8');
const head=' -- Join-only owner-derived tables can have no user_id/owner_id column;';
const tail=' -- This ID is bound to the exact PostgreSQL snapshot and export request.';
const start=src.indexOf(head),end=src.indexOf(tail,start+head.length);
assert.ok(start>=0 && end>start,'Canonical owner-child export gate moved');
const block=src.slice(start,end);
assert.ok(block.includes('Unclassified join-only owner child requires account export projection or private exclusion'));
assert.equal((block.match(/IF EXISTS \(/g)||[]).length,1,'Expected one source owner-child guard');
const sql=`CREATE OR REPLACE FUNCTION allin_private.v2_test_exact_export_join_only_guard()
 RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
 AS $all251$
 BEGIN
${block}
 END $all251$;
`;
writeFileSync('/tmp/all251-exact-export-owner-child-guard.psql',sql);
console.log('Prepared exact-source account export join-only guard for disposable SQL replay');
