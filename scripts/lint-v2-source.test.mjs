import test from 'node:test';
import assert from 'node:assert/strict';
import {lintSource} from './lint-v2-source.mjs';

test('safe V2 public config and inert comments do not trigger security lint',()=>{
 assert.deepEqual(lintSource('// debugger; eval("x");\nconst url=process.env.EXPO_PUBLIC_SUPABASE_URL;'),[]);
 assert.deepEqual(lintSource('const key=process.env["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];'),[]);
});
test('real debugger statements are rejected, not harmless comment text',()=>{
 assert.match(lintSource('function launch(){ debugger; }')[0],/debugger statement/);
});
test('direct dynamic code execution is rejected',()=>{
 for(const sample of ['eval("1")','new Function("return 1")','Function("return 1")'])
  assert.match(lintSource(sample)[0],/dynamic code evaluation/,sample);
});
test('privileged EXPO_PUBLIC_ environment variables fail closed',()=>{
 for(const sample of [
  'process.env.EXPO_PUBLIC_SERVICE_ROLE_KEY',
  'process.env["EXPO_PUBLIC_STRIPE_SECRET_KEY"]',
  'process.env.EXPO_PUBLIC_CLIENT_SECRET',
  'process.env.EXPO_PUBLIC_ACCESS_TOKEN',
 ]){
  assert.match(lintSource(sample)[0],/privileged key/,sample);
 }
});
test('TSX and TypeScript syntax parse correctly, with usable line numbers',()=>{
 const issues=lintSource('export const App=()=> <View />;\n debugger;', 'app/example.tsx');
 assert.equal(issues.length,1);
 assert.match(issues[0],/^app\/example\.tsx:2:2 debugger/);
});
