import test from 'node:test';
import assert from 'node:assert/strict';
import {createGooglePlayDeveloperTransport} from './googlePlayDeveloperTransport.mjs';
const packageName='com.allin365.app';
const token='token_abcdefghi12345';
const purchase={kind:'androidpublisher#subscriptionPurchaseV2',subscriptionState:'SUBSCRIPTION_STATE_ACTIVE'};
const setup=overrides=>{
 const calls=[];
 const api=createGooglePlayDeveloperTransport({
  expectedPackageName:packageName,
  getAccessToken:async scope=>{calls.push({scope});return 'test_oauth_access_token';},
  request:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>purchase};},
  ...overrides,
 });
 return {api,calls};
};
test('Play API uses exact package, subscriptionsv2 endpoint and scoped bearer',async()=>{
 const {api,calls}=setup();
 assert.equal(await api.fetchSubscription({packageName,purchaseToken:token}),purchase);
 assert.equal(calls[0].scope,'https://www.googleapis.com/auth/androidpublisher');
 assert.equal(calls[1].url,'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+
   packageName+'/purchases/subscriptionsv2/tokens/'+token);
 assert.equal(calls[1].init.method,'GET');
 assert.equal(calls[1].init.headers.authorization,'Bearer test_oauth_access_token');
});
test('package mismatch and malformed purchase token never access provider',async()=>{
 const {api,calls}=setup();
 for(const input of [{packageName:'com.other.app',purchaseToken:token},
 {packageName,purchaseToken:'bad'}, {packageName,purchaseToken:token+'/../../'}]){
  await assert.rejects(()=>api.fetchSubscription(input));
 }
 assert.equal(calls.length,0);
});
test('OAuth, HTTP, and response failures do not fake verified subscription',async()=>{
 const variants=[
  {getAccessToken:async()=>{throw Error('oauth')}},
  {request:async()=>{throw Error('offline')}},
  {request:async()=>({ok:false})},
  {request:async()=>({ok:true,json:async()=>({kind:'other'})})},
 ];
 for(const options of variants){
  const {api}=setup(options);
  await assert.rejects(()=>api.fetchSubscription({packageName,purchaseToken:token}));
 }
});

test('Google acknowledgement uses scoped POST and no customer metadata',async()=>{
 const {api,calls}=setup();
 assert.equal(await api.acknowledgeSubscription({packageName,purchaseToken:token}),
  'acknowledged');
 assert.equal(calls[0].scope,'https://www.googleapis.com/auth/androidpublisher');
 assert.equal(calls[1].url,
  'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+
  packageName+'/purchases/subscriptions/tokens/'+token+':acknowledge');
 assert.equal(calls[1].init.method,'POST');
 assert.equal(calls[1].init.body,'{}');
});
test('Google acknowledgement cannot run with different app or provider outage',async()=>{
 const {api,calls}=setup();
 await assert.rejects(()=>api.acknowledgeSubscription({
  packageName:'com.attacker.app',purchaseToken:token}));
 assert.equal(calls.length,0);
 const broken=setup({request:async()=>({ok:false})});
 await assert.rejects(()=>broken.api.acknowledgeSubscription({packageName,purchaseToken:token}));
});
