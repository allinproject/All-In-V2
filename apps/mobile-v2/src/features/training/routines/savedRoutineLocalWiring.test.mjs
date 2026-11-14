import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const src=p=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8');

test('Train never mounts owner RPCs without an explicit local-only flag',()=>{
 const train=src('../../../../app/train.tsx');
 const guard=src('../../../lib/coachStagingBuildGuard.mjs');
 const library=src('../RoutesRoutinesContent.tsx');
 assert.match(train,/EXPO_PUBLIC_V2_ROUTINE_LOCAL_AUTH_ACCEPTANCE!=='true'/);
 assert.match(train,/localRoutine\?\.reader/);
 assert.match(train,/localRoutine\?\.writer/);
 assert.match(train,/routineOwnerRef\.current\.ownerId===ownerId/);
 assert.match(guard,/http:\/\/127\.0\.0\.1:54321/);
 assert.match(guard,/http:\/\/localhost:54321/);
 assert.match(guard,/ONLY target disposable local Supabase/);
 assert.match(library,/savedRoutineMutationServices\.saveFromUserAction/);
 assert.match(library,/setLibraryRevision/);
 assert.doesNotMatch(train,/EXPO_PUBLIC_V2_ROUTINE_HOSTED_ENABLED/);
});
test('Routine create stays explicit, idempotent and cannot silently start workout',()=>{
 const editor=src('./RoutineBuilderContent.tsx');
 const writer=src('./savedRoutineRpcWriter.ts');
 const review=src('./RoutineWorkoutReviewContent.tsx');
 assert.match(editor,/Crypto\.randomUUID/);
 assert.match(editor,/pendingSave\.current\?\.version===draft\.version/);
 assert.match(editor,/accessibilityLabel="Save Routine"/);
 assert.match(editor,/disabled=\{!review\.ready\|\|saving\}/);
 assert.match(writer,/saveFromUserAction/);
 assert.match(writer,/archiveFromUserAction/);
 assert.match(writer,/p_expected_version:req\.expectedVersion/);
 assert.match(review,/onStartWorkout/);
 assert.doesNotMatch(editor,/onStartWorkout\?\./);
});
