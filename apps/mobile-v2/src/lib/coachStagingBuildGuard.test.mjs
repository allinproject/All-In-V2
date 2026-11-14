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

test('Fuel read and write flags cannot target canonical or unrelated Supabase',()=>{
 const ordinary={EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE:'false',
  EXPO_PUBLIC_SUPABASE_URL:'https://xarhuczrtzuiljmtdaeu.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_testonly_not_a_real_key'};
 for(const flag of ['EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED','EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED']){
  assert.throws(()=>assertCoachStagingBuildEnvironment({...ordinary,[flag]:'true'}),
   /Fuel staging owner RPCs require the approved temporary/);
  assert.throws(()=>assertCoachStagingBuildEnvironment({...ordinary,
   EXPO_PUBLIC_SUPABASE_URL:'https://unapproved.supabase.co',[flag]:'true'}),
   /approved temporary/);
 }
});

test('Fuel staging-only read and write require the exact approved project and a key',()=>{
 const fuel={EXPO_PUBLIC_V2_COACH_STAGING_ACCEPTANCE:'false',
  EXPO_PUBLIC_SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_testonly_not_a_real_key',
  EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED:'true',
  EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED:'true'};
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment(fuel));
 assert.throws(()=>assertCoachStagingBuildEnvironment({
  ...fuel,EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''
 }),/Fuel staging owner RPCs require the staging publishable key/);
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment({
  ...fuel,EXPO_PUBLIC_V2_FUEL_DAY_READ_ENABLED:'false',
  EXPO_PUBLIC_V2_FUEL_MANUAL_WRITE_ENABLED:'false',
  EXPO_PUBLIC_SUPABASE_URL:'https://xarhuczrtzuiljmtdaeu.supabase.co'
 }));
});

test('Routine acceptance is default-off and refuses ALL hosted Supabase targets',()=>{
 const local={EXPO_PUBLIC_V2_ROUTINE_LOCAL_AUTH_ACCEPTANCE:'true',
  EXPO_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'local-test-only'};
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment(local));
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment({...local,EXPO_PUBLIC_SUPABASE_URL:'http://localhost:54321'}));
 for(const url of ['https://xarhuczrtzuiljmtdaeu.supabase.co',
  'https://fbtgknlxjyeqrxemskbl.supabase.co','https://other.supabase.co',
  'http://192.168.1.10:54321','http://127.0.0.1:54322','']){
  assert.throws(()=>assertCoachStagingBuildEnvironment({...local,EXPO_PUBLIC_SUPABASE_URL:url}),/ONLY target disposable local Supabase/);
 }
 assert.throws(()=>assertCoachStagingBuildEnvironment({...local,EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''}),/ephemeral local publishable key/);
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment({
  EXPO_PUBLIC_V2_ROUTINE_LOCAL_AUTH_ACCEPTANCE:'false',
  EXPO_PUBLIC_SUPABASE_URL:'https://xarhuczrtzuiljmtdaeu.supabase.co',
 }));
});

test('Routine hosted acceptance cannot target production, other staging or local while default stays off',()=>{
 const hosted={
  EXPO_PUBLIC_V2_ROUTINE_TEMP_STAGING_ACCEPTANCE:'true',
  EXPO_PUBLIC_SUPABASE_URL:'https://fbtgknlxjyeqrxemskbl.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_only_for_test',
 };
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment(hosted));
 for(const url of [
  'https://xarhuczrtzuiljmtdaeu.supabase.co',
  'https://impulecgsgaruvniuttc.supabase.co',
  'https://unapproved.supabase.co',
  'http://127.0.0.1:54321',
  '',
 ])assert.throws(()=>assertCoachStagingBuildEnvironment({
  ...hosted,EXPO_PUBLIC_SUPABASE_URL:url,
 }),/exact temporary staging project/);
 assert.throws(()=>assertCoachStagingBuildEnvironment({
  ...hosted,EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'',
 }),/staging publishable key/);
 assert.throws(()=>assertCoachStagingBuildEnvironment({
  ...hosted,EXPO_PUBLIC_V2_ROUTINE_LOCAL_AUTH_ACCEPTANCE:'true',
 }),/cannot be combined/);
 assert.doesNotThrow(()=>assertCoachStagingBuildEnvironment({
  EXPO_PUBLIC_V2_ROUTINE_TEMP_STAGING_ACCEPTANCE:'false',
  EXPO_PUBLIC_SUPABASE_URL:'https://xarhuczrtzuiljmtdaeu.supabase.co',
 }));
});
