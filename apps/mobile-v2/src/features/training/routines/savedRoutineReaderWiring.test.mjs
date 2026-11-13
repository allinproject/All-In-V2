import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8');
test('Routes/Routines mounts library only when owner services are injected',()=>{
 const workspace=read('../RoutesRoutinesContent.tsx');
 const train=read('../../../../app/train.tsx');
 assert.match(workspace,/savedRoutineReaderServices\?:SavedRoutineReadServices/);
 assert.match(workspace,/<SavedRoutineLibraryContent services=\{savedRoutineReaderServices\}/);
 assert.match(workspace,/expectedOwnerId=\{currentOwnerId\}/);
 assert.match(workspace,/sessionGeneration=\{sessionGeneration\}/);
 assert.match(workspace,/<RoutineBuilderContent \/>/);
 assert.doesNotMatch(train,/savedRoutineReaderServices=/);
});
test('saved reader fails closed on partial pages, stale session and missing exact version',()=>{
 const reader=read('./savedRoutineOwnerReader.ts');
 const library=read('./SavedRoutineLibraryContent.tsx');
 assert.match(reader,/page\.hasMore/);
 assert.match(reader,/page\.snapshotVersion!==snapshotVersion/);
 assert.match(reader,/openOwnedRoutineWorkoutReview\(item,expectedOwnerId,sessionGeneration\)/);
 assert.match(reader,/await services\.authenticateOwner\(expectedOwnerId,sessionGeneration\)/);
 assert.match(library,/readAuthenticatedSavedRoutineVersion/);
 assert.match(library,/This does not mean your routines were deleted/);
 for(const src of [reader,library]){
  assert.doesNotMatch(src,/allin_save_training_route|allin_training_routes|service_role/);
  assert.doesNotMatch(src,/\.from\(|\.rpc\(/);
 }
});
