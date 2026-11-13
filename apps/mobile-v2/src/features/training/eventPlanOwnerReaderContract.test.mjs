import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=relative=>readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');

test('private canonical Event reader candidate carries named Event evidence and provenance',()=>{
  const sql=source('../../../../../docs/architecture/sql/V2-EVENTHUB-OWNER-EVENT-PLAN-READER-CANDIDATE.sql');
  assert.match(sql,/'eventId',e\.id/);
  assert.match(sql,/'name',e\.name/);
  assert.match(sql,/'eventKind',e\.event_kind/);
  assert.match(sql,/'sourceRevision',e\.source_revision/);
  assert.match(sql,/'verification',e\.source_verification/);
  assert.match(sql,/'participation',p\.state/);
  assert.match(sql,/'participationVersion',p\.version/);
  assert.match(sql,/p\.state\|\|':'\|\|/);
  assert.match(sql,/e\.cancelled::text/);
});
test('candidate cannot derive registration from EventHub membership or grant public reads',()=>{
  const sql=source('../../../../../docs/architecture/sql/V2-EVENTHUB-OWNER-EVENT-PLAN-READER-CANDIDATE.sql');
  assert.match(sql,/FROM public\.v2_event_participations p/);
  assert.doesNotMatch(sql,/FROM public\.v2_event_group_memberships|JOIN public\.v2_event_group_memberships/);
  assert.match(sql,/REVOKE ALL ON FUNCTION/);
  assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/p_expected_user_id IS DISTINCT FROM v_owner/);
  assert.match(sql,/auth\.sessions/);
});
test('candidate is not falsely treated as a complete mounted Event Plan owner reader',()=>{
  const sql=source('../../../../../docs/architecture/sql/V2-EVENTHUB-OWNER-EVENT-PLAN-READER-CANDIDATE.sql');
  const train=source('../../../app/train.tsx');
  const model=source('./eventPlanOwnerPresentation.ts');
  assert.match(sql,/Edition and\s*\n-- Goal binding are NOT certified/);
  assert.doesNotMatch(sql,/'editionId'/);
  assert.doesNotMatch(sql,/'priority'/);
  assert.match(train,/snapshot:null/);
  assert.match(model,/editionId:event\.editionId/);
});
