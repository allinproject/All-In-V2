import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,generateKeyPairSync,createPublicKey,verify as verifySignature} from 'node:crypto';
import {createGoogleServiceAccountAccessToken} from './googleServiceAccountAccessToken.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const keys=generateKeyPairSync('rsa',{modulusLength:2048,
  publicKeyEncoding:{type:'spki',format:'pem'},
  privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const email='allin-test@fake-test-project.iam.gserviceaccount.com';
const now=1794410000;
const decode=x=>JSON.parse(Buffer.from(x,'base64url').toString('utf8'));
const setup=(request)=>createGoogleServiceAccountAccessToken({
  serviceAccountEmail:email,privateKeyPem:keys.privateKey,clockSeconds:()=>now,
  request,
});
test('signed RS256 OAuth assertion has exact androidpublisher scope and bounded lifetime',async()=>{
  let called=0;
  const getAccessToken=setup(async(url,init)=>{
    called++;
    assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(init.method,'POST');
    const body=new URLSearchParams(init.body),signed=body.get('assertion');
    assert.equal(body.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const parts=signed.split('.');
    assert.equal(parts.length,3);
    assert.deepEqual(decode(parts[0]),{alg:'RS256',typ:'JWT'});
    const claims=decode(parts[1]);
    assert.equal(claims.iss,email);
    assert.equal(claims.aud,url);
    assert.equal(claims.scope,'https://www.googleapis.com/auth/androidpublisher');
    assert.equal(claims.iat,now);
    assert.equal(claims.exp-now,3600);
    assert.ok(verifySignature('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),
      createPublicKey(keys.publicKey),Buffer.from(parts[2],'base64url')));
    return {ok:true,json:async()=>({access_token:'mock-oauth-token-valid',
      expires_in:3599,token_type:'Bearer'})};
  });
  assert.equal(await getAccessToken('https://www.googleapis.com/auth/androidpublisher'),
    'mock-oauth-token-valid');
  assert.equal(called,1);
});
test('wrong scope, invalid key and bad service account identity fail closed',async()=>{
  assert.equal(createGoogleServiceAccountAccessToken({
    serviceAccountEmail:'user@example.com',privateKeyPem:keys.privateKey,
    request:async()=>{},clockSeconds:()=>now}),null);
  assert.equal(createGoogleServiceAccountAccessToken({
    serviceAccountEmail:email,privateKeyPem:'private-key-claim',
    request:async()=>{},clockSeconds:()=>now}),null);
  let calls=0;
  const get=setup(async()=>{calls++;return {ok:true}});
  await assert.rejects(()=>get('https://evil.example/scope'),/scope_unapproved/);
  assert.equal(calls,0);
});
test('provider outages, invalid bearer responses and bad clock fail without returning tokens',async()=>{
  for(const request of [
    async()=>{throw Error('offline')},
    async()=>({ok:false,json:async()=>({})}),
    async()=>({ok:true,json:async()=>({token_type:'Bearer',
      access_token:'short',expires_in:3600})}),
    async()=>({ok:true,json:async()=>({token_type:'unknown',
      access_token:'mock-oauth-token-valid',expires_in:3600})}),
  ])await assert.rejects(()=>setup(request)('https://www.googleapis.com/auth/androidpublisher'));
  const get=createGoogleServiceAccountAccessToken({serviceAccountEmail:email,
    privateKeyPem:keys.privateKey,request:async()=>{throw Error('should not call')},
    clockSeconds:()=>NaN});
  await assert.rejects(()=>get('https://www.googleapis.com/auth/androidpublisher'));
});
