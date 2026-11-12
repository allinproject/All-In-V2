import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import path from 'node:path';
import {pairVerifiedAppleWatch,revokeVerifiedAppleWatch}
 from '../apps/mobile-v2/src/features/training/appleWatchPairingHandoff.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const owner='11111111-1111-4111-8111-111111111111';
const session='11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const challengeId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const deviceId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ref='watch-key:'+'a'.repeat(64);
const spki='X'.repeat(125);
const watchSignature='X'.repeat(86);
const phoneAssertion='X'.repeat(200);

test('canonical native sources are wired to both targets and watch is embedded',()=>{
 const script=read('scripts/integrate-apple-watch-target.rb');
 for(const required of [
  'project.new_target(:watch2_app','ALLIN365WatchApp.swift',
  'WatchPairingChallengeSigner.swift','IPhoneWatchPairingCoordinator.swift',
  'IPhoneAppAttestEnrollment.swift','ALLINWatchPairingModule.swift',
  'ALLINWatchPairingModule.m','Embed Watch Content',
  'iphone.add_dependency(watch)','watch.bundle',
 ]) {
  if(required==='watch.bundle')continue;
  assert.ok(script.includes(required),required);
 }
 assert.ok(read('apps/mobile-v2/native/apple-watch/ALLIN365WatchApp.swift').includes('@main'));
 assert.ok(read('apps/mobile-v2/native/apple-watch/ALLIN365WatchApp.swift')
  .includes('approvePendingChallenge'));
 assert.ok(read('apps/mobile-v2/native/apple-watch/WatchPairingChallengeSigner.swift')
  .includes('pendingReplyHandler'));
 assert.ok(read('apps/mobile-v2/native/apple-watch/ALLINWatchPairingModule.m')
  .includes('RCT_EXTERN_MODULE'));
 assert.ok(read('apps/mobile-v2/package.json').includes('eas-build-post-install'));
 const ruby=spawnSync('ruby',['-c',path.join(root,'scripts/integrate-apple-watch-target.rb')],
  {encoding:'utf8'});
 assert.equal(ruby.status,0,ruby.stderr);
});
test('build hook never attaches watch without verified bundle ID, macOS and explicit opt-in',()=>{
 const {main}=requireBuildHook();
 assert.equal(main({},'darwin',()=>{throw Error('should not spawn')}),0);
 assert.equal(main({ALLIN_V2_WATCH_NATIVE_ENABLED:'true',
  EAS_BUILD_PLATFORM:'ios',ALLIN_V2_IOS_BUNDLE_ID:'com.valid.v2'},'linux',
  ()=>{throw Error('should not spawn')}),1);
 assert.equal(main({ALLIN_V2_WATCH_NATIVE_ENABLED:'true',
  EAS_BUILD_PLATFORM:'ios'},'darwin',()=>{throw Error('should not spawn')}),1);
 let calls=0;
 assert.equal(main({ALLIN_V2_WATCH_NATIVE_ENABLED:'true',
  EAS_BUILD_PLATFORM:'ios',ALLIN_V2_IOS_BUNDLE_ID:'com.valid.v2'},
  'darwin',(_binary,_args)=>{calls++;return {status:0}}),0);
 assert.equal(calls,1);
});
function requireBuildHook(){
 // Import CommonJS deterministically without depending on package setup.
 return require(path.join(root,'scripts/integrate-apple-watch-build.cjs'));
}
function fixture(){
 const sent=[];
 const native={
  fetchWatchKey:async()=>({deviceRef:ref,watchPublicKeySpkiB64url:spki}),
  signChallenge:async (ch,_owner,_session,_ref,_spki,key)=>({
   challengeId:ch,watchPublicKeySpkiB64url:spki,
   watchSignatureB64url:watchSignature,phoneAppAttestKeyId:key,
   phoneAssertionCborB64url:phoneAssertion,
  }),
 };
 const server={request:async input=>{
  sent.push(input.action);
  if(input.action==='challenge')return {challengeId,expiresAtMs:Date.now()+300000};
  if(input.action==='appleWatchProof')return {proof:{
   ownerId:owner,sessionId:session,provider:'apple_watch',
   deviceRef:ref,challengeId,signatureHex:'f'.repeat(64),
  }};
  if(input.action==='pair')return {status:'paired',deviceId};
  if(input.action==='revoke')return {status:'revoked'};
  throw Error('Unexpected action');
 }};
 return {native,server,sent};
}
const athlete={ownerId:owner,sessionId:session,
 attestedPhoneKeyId:'previously-enrolled-apple-key'};
test('phone-to-watch confirmation requires server challenge, verified proof and canonical pair writer',async()=>{
 const {native,server,sent}=fixture();
 assert.deepEqual(await pairVerifiedAppleWatch(native,server,athlete),
  {status:'paired',deviceId});
 assert.deepEqual(sent,['challenge','appleWatchProof','pair']);
 assert.equal(await revokeVerifiedAppleWatch(server,deviceId),'revoked');
});
test('no native confirmation, wrong proof or missing enrollment never reaches pair writer',async()=>{
 for(const scenario of ['no-key','decline','forged-server']){
  const {native,server,sent}=fixture();
  const identity={...athlete};
  if(scenario==='no-key')identity.attestedPhoneKeyId='';
  if(scenario==='decline')native.signChallenge=async()=>{throw Error('Watch declined');};
  if(scenario==='forged-server')server.request=async input=>{
   sent.push(input.action);
   if(input.action==='challenge')return {challengeId,expiresAtMs:Date.now()+300000};
   return {proof:{ownerId:'foreign-owner'}};
  };
  await assert.rejects(pairVerifiedAppleWatch(native,server,identity));
  assert.ok(!sent.includes('pair'));
 }
});
