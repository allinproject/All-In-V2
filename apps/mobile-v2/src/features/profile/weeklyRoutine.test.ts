import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWeeklyRoutine,parseWeeklyRoutine,toggleRoutineDay,changeRoutineWindow,
 trainingRoutinePatch,nutritionRoutinePatch} from './weeklyRoutine.ts';

test('defaults are empty, no Coach-inferred recurring events or notifications',()=>{
 assert.deepEqual(emptyWeeklyRoutine().training,{days:[],window:null});
 const x=parseWeeklyRoutine(null);
 assert.deepEqual(x,emptyWeeklyRoutine());
});
test('existing training availability stays canonical, with optional window',()=>{
 const r=parseWeeklyRoutine({training_preferences:{
  available_days:['wednesday','monday','flexible','monday'],
  weekly_routine:{training:{days:['sunday'],window:'evening'}}}});
 assert.deepEqual(r.training,{days:['monday','wednesday'],window:'evening'});
 const d=toggleRoutineDay(r.training,'friday');
 assert.deepEqual(trainingRoutinePatch(d),{
  available_days:['monday','wednesday','friday'],
  weekly_routine:{training:{window:'evening'}},
 });
});
test('nutrition preferences own shopping and meal prep separately, not training',()=>{
 const r=parseWeeklyRoutine({nutrition_preferences:{weekly_routine:{
  shopping:{days:['saturday'],window:'morning'},
  meal_prep:{days:['sunday','tuesday'],window:'afternoon'},
 }}});
 assert.deepEqual(nutritionRoutinePatch(r.shopping,r.mealPrep),{
  weekly_routine:{
    shopping:{days:['saturday'],window:'morning'},
    meal_prep:{days:['tuesday','sunday'],window:'afternoon'},
  },
 });
 assert.equal('notifications' in nutritionRoutinePatch(r.shopping,r.mealPrep),false);
});
test('unknown options are not saved or invented',()=>{
 const r=parseWeeklyRoutine({nutrition_preferences:{weekly_routine:{shopping:{
  days:['saturday','random'],window:'late night',
 }}}});
 assert.deepEqual(r.shopping,{days:['saturday'],window:null});
 assert.deepEqual(changeRoutineWindow(r.shopping,'evening'),{days:['saturday'],window:'evening'});
 assert.equal(changeRoutineWindow({...r.shopping,window:'evening'},'evening').window,null);
 assert.throws(()=>toggleRoutineDay(r.shopping,'random' as never));
});
