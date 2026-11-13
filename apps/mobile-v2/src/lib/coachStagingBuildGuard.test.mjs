import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCoachStagingBuildEnvironment} from './coachStagingBuildGuard.mjs';
const base={
 EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE:'true',
 EXPO_PUBLIC_SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
 EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_testonly_not_a_real_key',
 EXPO_PUBLIC_V2_COACH_READ_ENABLED:'true',
 EXPO_PUBLIC_V2_COACH_SEND_ENABLED:'false'
};
test('staging Coach acceptance allows only intended read-only project',()=>{
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment(base));
});
test('rejects production URL and arbitrary Supabase endpoint',()=>{
 for(const url of ['https://xarhuczrtzuiljmtdaeu.supabase.co','https://other.supabase.co','']){
  assert.throws(()=>assertCoachStagingBuildEnvironment({
   ...base,EXPO_PUBLIC_SUPABASE_URL:url
  }),/approved temporary/);
 }
});
test('missing staging publishable key or disabled reads fail closed',()=>{
 assert.throws(()=>assertCoachStagingBuildEnvironment({
  ...base,EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''
 }),/publishable key/);
 assert.throws(()=>assertCoachStagingBuildEnvironment({
  ...base,EXPO_PUBLIC_V2_COACH_READ_ENABLED:'false'
 }),/authenticated read enabled/);
});
test('sending cannot be enabled or left ambiguous in staging acceptance',()=>{
 for(const value of ['true',undefined,'']){
  assert.throws(()=>assertCoachStagingBuildEnvironment({
   ...base,EXPO_PUBLIC_V2_COACH_SEND_ENABLED:value
  }),/explicitly disabled/);
 }
});
test('ordinary app builds retain their established configuration behavior',()=>{
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment({
  EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE:'false',
  EXPO_PUBLIC_SUPABASE_URL:'https://xarhuczrtzuiljmtdaeu.supabase.co'
 }));
});
