import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const source=relative=>readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');
test('Routines now mounts a real strength and endurance editor without secondary storage',()=>{
 const workspace=source('../RoutesRoutinesContent.tsx');
 const screen=source('./RoutineBuilderContent.tsx');
 assert.match(workspace,/<RoutineBuilderContent key=\{builderRevision\}/);
 assert.match(workspace,/selected !== 'routines' && styles.hidden/);
 assert.match(workspace,/savedRoutineMutationServices&&currentOwnerId&&sessionGeneration!==undefined/);
 assert.match(screen,/draft\.blocks\.map/);
 for(const action of ['addRoutineBlock','updateRoutineBlock','moveRoutineBlock',
  'duplicateRoutineBlock','deleteRoutineBlock','changeRoutineSport',
  'inspectRoutineDraft']) assert.match(screen,new RegExp(action));
 // Saving is only offered with an injected canonical owner writer.
 // Starting a workout is still explicitly unconnected, not silently enabled.
 assert.match(screen,/\{onSave\?<View style=\{styles\.review\}>/);
 assert.match(screen,/disabled=\{!review\.ready\|\|saving\}/);
 assert.match(screen,/Start Workout remains unconnected/);
 assert.doesNotMatch(screen,/\.from\(|\.rpc\(|saveRoutine\(/);
});
test('routine draft cannot be mistaken for completion, saved version, or Coach acceptance',()=>{
 const logic=source('./routineDraftEditor.ts');
 assert.match(logic,/sourceCompletionId:null/);
 assert.match(logic,/id:null/);
 assert.match(logic,/status:'unsaved_draft'/);
 assert.match(logic,/if\(draft\.blocks\.length>=60\)/);
 assert.doesNotMatch(logic,/allin_training_routes|allin_save_training_route|v2_training_plan/);
});
