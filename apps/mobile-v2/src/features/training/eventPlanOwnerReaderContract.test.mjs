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
  assert.match(sql,/'editionId',e\\.edition_id/);
  assert.match(sql,/Goal owns priority and accepted revision binding/);
  assert.doesNotMatch(sql,/'priority'/);
  assert.match(train,/snapshot:null/);
  assert.match(model,/editionId:event\.editionId/);
});

test('canonical Event edition and Goal revision references remain stable and private',()=>{
 const event=source('../../../../../docs/architecture/sql/V2-EVENTHUB-IDENTITY-MEMBERSHIP-PARTICIPATION-CANDIDATE.sql');
 const guard=source('../../../../../docs/architecture/sql/V2-EVENTHUB-EVENT-VERSION-GUARD-CANDIDATE.sql');
 const binding=source('../../../../../docs/architecture/sql/V2-GOALS-ACCEPTED-EVENT-EDITION-BINDING-CANDIDATE.sql');
 assert.match(event,/edition_id uuid NOT NULL UNIQUE/);
 assert.match(event,/UNIQUE\\(id,edition_id\\)/);
 assert.match(guard,/NEW\\.edition_id IS DISTINCT FROM OLD\\.edition_id/);
 assert.match(binding,/FOREIGN KEY\\(goal_revision_id,goal_id,user_id\\)/);
 assert.match(binding,/REFERENCES public\\.v2_goal_revisions\\(id,goal_id,user_id\\)/);
 assert.match(binding,/FOREIGN KEY\\(event_id,edition_id\\)/);
 assert.match(binding,/REFERENCES public\\.v2_events\\(id,edition_id\\)/);
 assert.match(binding,/ALTER TABLE public\\.v2_goal_event_edition_links ENABLE ROW LEVEL SECURITY/);
 assert.match(binding,/FROM PUBLIC,anon,authenticated,service_role/);
 assert.doesNotMatch(binding,/CREATE POLICY.*USING.*true/);
});

test('Goal owner snapshot exposes only an explicitly accepted, revision-bound Event link',()=>{
 const sql=source('../../../../../docs/architecture/sql/V2-GOALS-OWNER-SNAPSHOT-READER-CANDIDATE.sql');
 assert.match(sql,/'eventId',l\.event_id/);
 assert.match(sql,/'editionId',l\.edition_id/);
 assert.match(sql,/'boundEventVersion',l\.event_version/);
 assert.match(sql,/l\.goal_revision_id=r\.id AND l\.goal_id=g\.id AND l\.user_id=g\.user_id/);
 assert.match(sql,/r\.id=g\.active_revision_id/);
 assert.match(sql,/r\.status='accepted'/);
 assert.match(sql,/coalesce\(l\.edition_id::text,'none'\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION/);
});
