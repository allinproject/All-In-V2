import test from 'node:test';
import assert from 'node:assert/strict';
import {signAll251S3} from './all251-s3-sigv4.mjs';

const base={
 method:'PUT',
 host:'fbtgknlxjyeqrxemskbl.storage.supabase.co',
 region:'us-east-1',
 accessKeyId:'TESTONLYKEY',
 secretAccessKey:'TESTONLYSECRET',
 bucket:'v2-private-workout-objects',
 objectPath:'synthetic-owner/fixture.bin',
 bytes:Buffer.from('disposable-test-payload'),
 now:new Date('2026-11-13T12:15:00.000Z'),
};

test('SigV4 is deterministic and emits only the approved direct endpoint',()=>{
 const a=signAll251S3(base),b=signAll251S3(base);
 assert.deepEqual(a,b);
 assert.match(a.url,/^https:\/\/fbtgknlxjyeqrxemskbl\.storage\.supabase\.co\/storage\/v1\/s3\//);
 assert.match(a.headers.authorization,/^AWS4-HMAC-SHA256 Credential=TESTONLYKEY\/20261113\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
 assert(!a.url.includes('TESTONLYSECRET'));
 assert(!a.headers.authorization.includes('TESTONLYSECRET'));
});

test('Canonical query order is stable for multipart operations',()=>{
 const x=signAll251S3({...base,method:'POST',query:{uploadId:'fake+id/=',partNumber:'1'}});
 const y=signAll251S3({...base,method:'POST',query:{partNumber:'1',uploadId:'fake+id/='}});
 assert.deepEqual(x,y);
 assert(x.url.endsWith('?partNumber=1&uploadId=fake%2Bid%2F%3D'));
});

test('Every byte changes the signed payload digest and signature',()=>{
 const x=signAll251S3(base),y=signAll251S3({...base,bytes:Buffer.from('different')});
 assert.notEqual(x.headers['x-amz-content-sha256'],y.headers['x-amz-content-sha256']);
 assert.notEqual(x.headers.authorization,y.headers.authorization);
});

test('Region is required and contributes to the credential scope',()=>{
 assert.throws(()=>signAll251S3({...base,region:''}),/region/);
 const x=signAll251S3({...base,region:'us-west-2'});
 assert.match(x.headers.authorization,/\/us-west-2\/s3\/aws4_request/);
});

test('Signer rejects untrusted hosts, unsafe keys, absent credentials, and methods',()=>{
 assert.throws(()=>signAll251S3({...base,host:'evil.example.com'}),/host/);
 assert.throws(()=>signAll251S3({...base,objectPath:'../foreign.bin'}),/Unsafe/);
 assert.throws(()=>signAll251S3({...base,secretAccessKey:''}),/Missing/);
 assert.throws(()=>signAll251S3({...base,method:'PATCH'}),/method/);
});
