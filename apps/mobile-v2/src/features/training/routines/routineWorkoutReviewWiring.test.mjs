import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8');
test('Saved Routine review is owner/version gated, default routine editor still mounted',()=>{
 const workspace=read('../RoutesRoutinesContent.tsx');
 assert.match(workspace,/savedRoutineSnapshot.identity==='canonical_saved_routine'/);
 assert.match(workspace,/savedRoutineSnapshot.complete===true/);
 assert.match(workspace,/savedRoutineSnapshot.ownerId===currentOwnerId/);
 assert.match(workspace,/savedRoutineSnapshot.sessionGeneration===sessionGeneration/);
 assert.match(workspace,/<RoutineWorkoutReviewContent/);
 assert.match(workspace,/<RoutineBuilderContent \/>/);
});
test('Coach preview offers explicit keep or apply and no forced mutation',()=>{
 const screen=read('./RoutineWorkoutReviewContent.tsx');
 assert.match(screen,/Optional Coach suggestion/);
 assert.match(screen,/Keep Original/);
 assert.match(screen,/Apply Change/);
 assert.match(screen,/keepOriginalRoutineWorkout/);
 assert.match(screen,/applyCoachChangeForSession/);
 assert.match(screen,/disabled=\{!onStartWorkout\|\|!ready\}/);
 assert.doesNotMatch(screen,/\.from\(|\.rpc\(|v2_training_plan/);
});
