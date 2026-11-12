import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {createAwsKmsExportKeyProvider} from './trainingExportAwsKms.mjs';
import {createAccountExportKeyLease} from './trainingExportKeyLease.mjs';
const arn='arn:aws:kms:us-east-1:111122223333:key/12345678-1234-4234-8234-123456789abc';
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const request='33333333-3333-4333-8333-333333333333';
const other='44444444-4444-4444-8444-444444444444';
const purpose='account-export-v2';
const keyVersion=1;
class GenerateDataKeyCommand {constructor(input){this.input=input}}
class DecryptCommand {constructor(input){this.input=input}}
function fakeKms(){
 const master=randomBytes(32),calls=[];
 let failedDecrypt=false,rotate=false;
 const client={async send(command){
  const {input}=command;
  calls.push({type:command.constructor.name,input});
  assert.equal(input.KeyId,arn);
  if(command instanceof GenerateDataKeyCommand){
   assert.equal(input.KeySpec,'AES_256');
   const plain=randomBytes(32),iv=randomBytes(12);
   const c=createCipheriv('aes-256-gcm',master,iv);
   c.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
   const sealed=Buffer.concat([iv,c.update(plain),c.final(),c.getAuthTag()]);
   return {KeyId:rotate?'arn:aws:kms:us-east-1:111122223333:key/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':arn,
    CiphertextBlob:sealed,Plaintext:plain};
  }
  if(command instanceof DecryptCommand){
   if(failedDecrypt)throw Error('KMS unavailable');
   const raw=Buffer.from(input.CiphertextBlob);
   const d=createDecipheriv('aes-256-gcm',master,raw.subarray(0,12));
   d.setAAD(Buffer.from(JSON.stringify(input.EncryptionContext)));
   d.setAuthTag(raw.subarray(raw.length-16));
   const value=Buffer.concat([d.update(raw.subarray(12,-16)),d.final()]);
   return {KeyId:rotate?'incorrect':arn,Plaintext:value};
  }
  throw Error('Unknown AWS KMS operation');
 }};
 return {client,calls,setUnavailable:v=>failedDecrypt=v,setRotation:v=>rotate=v};
}
function configured(f){return createAwsKmsExportKeyProvider({
 client:f.client,GenerateDataKeyCommand,DecryptCommand,keyArn:arn,
})}
test('generates AES-256 key via AWS SDK-shaped KMS and unwraps using identical owner/request context',async()=>{
 const f=fakeKms(),provider=configured(f);
 const generated=await provider.generateDataKey({ownerId:a,requestId:request});
 assert.equal(generated.encryptionKey.byteLength,32);
 assert.equal(generated.kmsKeyId,arn);
 assert.equal(generated.keyPurpose,purpose);
 assert(!JSON.stringify({...generated,encryptionKey:undefined}).includes(generated.encryptionKey.toString('hex')));
 assert.deepEqual(f.calls[0].input.EncryptionContext,{
  purpose,ownerId:a,requestId:request,keyVersion:'1',
 });
 const clear=await provider.unwrapDataKey({
  kmsKeyId:arn,wrappedDataKey:generated.wrappedDataKey,
  keyVersion,purpose,context:{ownerId:a,requestId:request},
 });
 assert.deepEqual(clear,generated.encryptionKey);
 assert.notEqual(clear,generated.encryptionKey);
});
test('request or owner substitution fails cryptographically; wrong KMS key and version fail before decrypt',async()=>{
 const f=fakeKms(),provider=configured(f);
 const key=await provider.generateDataKey({ownerId:a,requestId:request});
 const args={kmsKeyId:arn,wrappedDataKey:key.wrappedDataKey,keyVersion,purpose,
  context:{ownerId:a,requestId:request}};
 await assert.rejects(provider.unwrapDataKey({...args,context:{ownerId:b,requestId:request}}));
 await assert.rejects(provider.unwrapDataKey({...args,context:{ownerId:a,requestId:other}}));
 const count=f.calls.length;
 await assert.rejects(provider.unwrapDataKey({...args,kmsKeyId:'arn:aws:kms:us-east-1:111122223333:key/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),/Unapproved KMS key/);
 await assert.rejects(provider.unwrapDataKey({...args,keyVersion:2}),/Unapproved export/);
 await assert.rejects(provider.unwrapDataKey({...args,purpose:'other'}),/Unapproved export/);
 await assert.rejects(provider.unwrapDataKey({...args,wrappedDataKey:'AAAA'}),/Invalid KMS ciphertext/);
 assert.equal(f.calls.length,count);
});
test('KMS outage, key mismatch and missing credentials never fall back to an application secret',async()=>{
 const f=fakeKms(),p=configured(f);
 const k=await p.generateDataKey({ownerId:a,requestId:request});
 const a1={kmsKeyId:arn,wrappedDataKey:k.wrappedDataKey,keyVersion,purpose,context:{ownerId:a,requestId:request}};
 f.setUnavailable(true);
 await assert.rejects(p.unwrapDataKey(a1),/KMS unavailable/);
 f.setUnavailable(false);f.setRotation(true);
 await assert.rejects(p.unwrapDataKey(a1),/unexpected key/);
 await assert.rejects(p.generateDataKey({ownerId:a,requestId:request}),/key identity/);
 assert.throws(()=>createAwsKmsExportKeyProvider(),/Trusted AWS KMS/);
});
test('same canonical lease rechecks approval after KMS unwrap; revocation or key rotation denies',async()=>{
 const f=fakeKms(),provider=configured(f);
 const k=await provider.generateDataKey({ownerId:a,requestId:request});
 let read=0,status='approved',version=1;
 const lease=()=>{
  read++;
  return {ownerId:a,requestId:request,status,cancelled:false,activeSession:true,
   kmsKeyId:arn,wrappedDataKey:k.wrappedDataKey,
   keyPurpose:purpose,keyVersion:version,
   expiresAt:new Date(Date.now()+60_000).toISOString()};
 };
 const gate=createAccountExportKeyLease({
  readApprovedRequestKeyLease:async()=>lease(),
  unwrapDataKey:async opts=>provider.unwrapDataKey(opts),
 });
 assert.deepEqual(await gate.resolveEncryptionKey({ownerId:a,requestId:request}),k.encryptionKey);
 assert.equal(read,2);
 const bad=createAccountExportKeyLease({
  readApprovedRequestKeyLease:async()=>{const l=lease();if(read>=4)return {...l,status:'cancelled',cancelled:true};return l;},
  unwrapDataKey:async opts=>provider.unwrapDataKey(opts),
 });
 await assert.rejects(bad.resolveEncryptionKey({ownerId:a,requestId:request}),/changed during unwrap/);
 status='approved';version=2;
 await assert.rejects(gate.resolveEncryptionKey({ownerId:a,requestId:request}),/denied/);
});
