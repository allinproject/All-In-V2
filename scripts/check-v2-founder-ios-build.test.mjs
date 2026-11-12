import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyFounderIosBuild} from './check-v2-founder-ios-build.mjs';

const config=JSON.parse(readFileSync(new URL('../apps/mobile-v2/eas.json',import.meta.url),'utf8'));
const appConfig=readFileSync(new URL('../apps/mobile-v2/app.config.ts',import.meta.url),'utf8');
const env={
 ALLIN_V2_IOS_BUNDLE_ID:'com.example.allin365v2',
 ALLIN_V2_EAS_PROJECT_ID:'11111111-1111-4111-8111-111111111111',
 EXPO_PUBLIC_SUPABASE_URL:'https://xarhuczrtzuiljmtdaeu.supabase.co',
 EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_real_example_placeholder_for_test'.replace('placeholder','nonsecret'),
};
const check=(changes={})=>verifyFounderIosBuild({config,appConfig,env:{...env,...changes}});
test('checked-in profiles are non-submitting, signed iPhone and TestFlight variants',()=>{
 assert.deepEqual(verifyFounderIosBuild({config,appConfig,configOnly:true}),[]);
 assert.deepEqual(check(),[]);
});
test('no guessed bundle ID, unlinked Expo project or wrong database target',()=>{
 for(const change of [
  {ALLIN_V2_IOS_BUNDLE_ID:'guess'},
  {ALLIN_V2_IOS_BUNDLE_ID:''},
  {ALLIN_V2_EAS_PROJECT_ID:'not-a-uuid'},
  {EXPO_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},
  {EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'YOUR_V2_PUBLISHABLE_KEY'},
  {EXPO_PUBLIC_SERVICE_ROLE_KEY:'secret'},
 ])assert.ok(check(change).length>0,JSON.stringify(change));
});
test('device and TestFlight profiles cannot silently submit or become unsigned simulator builds',()=>{
 for(const change of [
  {distribution:'store'},
  {ios:{simulator:true}},
  {credentialsSource:'local'},
  {autoSubmit:true},
 ]){
  const modified=structuredClone(config);
  Object.assign(modified.build['founder-ios-device'],change);
  assert.ok(verifyFounderIosBuild({config:modified,appConfig,configOnly:true}).length>0);
 }
});
test('not configuring a real native build project is detected even if source bundles',()=>{
 assert.ok(check({ALLIN_V2_EAS_PROJECT_ID:undefined}).length>0);
 assert.ok(check({ALLIN_V2_IOS_BUNDLE_ID:undefined}).length>0);
});
