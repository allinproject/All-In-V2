import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDANCE_OPTIONS, DETAIL_OPTIONS, PLAN_CHANGE_OPTIONS, TONE_OPTIONS,
  EMPTY_COACH_PREFERENCES, parseCoachPreferences, coachPreferencesPatch, mayAutoApplyTrainingPlanChange,
} from './coachPreferences.ts';

test('guidance style preserves existing V2 onboarding choices',()=>{
  assert.deepEqual(GUIDANCE_OPTIONS.map(x=>x.value),['only_when_asked','balanced','proactive']);
});
test('all approved controls have distinct allowed values',()=>{
  for(const group of [GUIDANCE_OPTIONS,DETAIL_OPTIONS,PLAN_CHANGE_OPTIONS,TONE_OPTIONS]){
    assert.equal(new Set(group.map(x=>x.value)).size,group.length);
  }
});
test('absent choices remain unset rather than invented defaults',()=>{
  assert.deepEqual(parseCoachPreferences(null),EMPTY_COACH_PREFERENCES);
  assert.deepEqual(parseCoachPreferences({guidance_style:'balanced'}),{
    ...EMPTY_COACH_PREFERENCES,guidance_style:'balanced',
  });
});
test('coach saves only canonical coach_preferences fields, never learning or notifications',()=>{
  const next={guidance_style:'proactive' as const,explanation_detail:'adaptive' as const,
    plan_change_mode:'ask_first' as const,coaching_tone:'direct' as const};
  assert.deepEqual(coachPreferencesPatch(next),next);
  assert.deepEqual(Object.keys(coachPreferencesPatch(next)),[
    'guidance_style','explanation_detail','plan_change_mode','coaching_tone',
  ]);
  assert.throws(()=>coachPreferencesPatch({...next,coaching_tone:'custom' as any}),/Unsupported/);
});
test('all coaching settings preserve explicit review of accepted training plan changes',()=>{
  for(const mode of PLAN_CHANGE_OPTIONS){
    for(const guidance of GUIDANCE_OPTIONS){
      assert.equal(mayAutoApplyTrainingPlanChange({
        ...EMPTY_COACH_PREFERENCES,plan_change_mode:mode.value,guidance_style:guidance.value,
      }),false);
    }
  }
});
