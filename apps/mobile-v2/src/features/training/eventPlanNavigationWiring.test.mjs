import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=relative=>readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');

test('Train keeps compact approved tabs and mounts Event Plan under Plans only',()=>{
  const train=source('../../../app/train.tsx');
  assert.match(train,/'calendar', 'Calendar'/);
  assert.match(train,/'plans', 'Plans'/);
  assert.match(train,/'routes_routines', 'Routes\/Routines'/);
  assert.match(train,/'training', 'Training Plan'/);
  assert.match(train,/'event', 'Event Plan'/);
  assert.match(train,/<EventPlanListContent ownerId=\{user\.id\} sessionGeneration=\{sessionGeneration\}/);
  assert.match(train,/projection=\{projectEventPlanOwnerSnapshot\(/);
  assert.doesNotMatch(train,/Training Preparation<\/Text>/);
});
test('Event Plan must not fake a ready owner snapshot or enable unsupported writes',()=>{
  const train=source('../../../app/train.tsx');
  const list=source('./EventPlanListContent.tsx');
  assert.match(train,/snapshot:null/);
  assert.match(train,/sessionGeneration,/);
  assert.match(train,/accessGateReady:gate\.status==='ready'/);
  assert.match(list,/projection\.status!=='ready'/);
  assert.match(list,/Existing events have not been checked and are not being reported as empty/);
  assert.match(list,/<EventPlanDetailContent/);
  assert.doesNotMatch(list,/supabase\.from\(|supabase\.rpc\(|insert\(|upsert\(|delete\(/);
});
test('Event Plan detail stays version and owner scoped, with training preparations excluded',()=>{
 const detail=source('./EventPlanDetailContent.tsx');
 const policy=source('./eventPlanDetailSections.ts');
 assert.match(detail,/certifyEventPlanDetailIdentity\(props\.event,props\.expected\)/);
 assert.match(detail,/certifiedEventPlanSectionText\(event,props\.sectionEvidence\)/);
 assert.doesNotMatch(policy,/id:'training'/);
 assert.match(policy,/event\.eventVersion!==context\.eventVersion/);
});

test('the displayed Event Plan list rejects a previous athlete or session',()=>{
 const list=source('./EventPlanListContent.tsx');
 const owner=source('./eventPlanOwnerPresentation.ts');
 assert.match(list,/projection\.ownerId===ownerId/);
 assert.match(list,/projection\.authSessionGeneration===sessionGeneration/);
 assert.match(list,/projection\.events\.every\(e=>e\.ownerId===ownerId\)/);
 assert.match(owner,/ownerId:s\.ownerId,authSessionGeneration:s\.authSessionGeneration/);
});
