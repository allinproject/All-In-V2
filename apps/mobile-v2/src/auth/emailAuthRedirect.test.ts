import test from 'node:test';
import assert from 'node:assert/strict';
import { v2EmailAuthRedirectUrl } from './emailAuthRedirect.ts';

const native = 'allin365v2://auth/callback';
const expo = 'exp://192.168.1.8:8082/';

test('installed app keeps its permanent callback; recovery remains separate', () => {
  assert.equal(v2EmailAuthRedirectUrl({expoGo:false,expoGoEnabled:false,expoGoLinkingUri:null,nativeCallbackUrl:native}),native);
  assert.equal(v2EmailAuthRedirectUrl({expoGo:false,expoGoEnabled:false,expoGoLinkingUri:null,nativeCallbackUrl:native,recovery:true}),native+'?type=recovery');
});

test('Expo Go callback is scoped to current running server and Expo Router auth path', () => {
  assert.equal(v2EmailAuthRedirectUrl({expoGo:true,expoGoEnabled:true,expoGoLinkingUri:expo,nativeCallbackUrl:native}), 'exp://192.168.1.8:8082/--/auth/callback');
  assert.equal(v2EmailAuthRedirectUrl({expoGo:true,expoGoEnabled:true,expoGoLinkingUri:expo,nativeCallbackUrl:native,recovery:true}), 'exp://192.168.1.8:8082/--/auth/callback?type=recovery');
  assert.equal(v2EmailAuthRedirectUrl({expoGo:true,expoGoEnabled:true,expoGoLinkingUri:'exps://secure.dev:443/',nativeCallbackUrl:native}), 'exps://secure.dev:443/--/auth/callback');
  assert.equal(v2EmailAuthRedirectUrl({expoGo:true,expoGoEnabled:true,expoGoLinkingUri:'exp://192.168.1.8:8082/--/',nativeCallbackUrl:native}), 'exp://192.168.1.8:8082/--/auth/callback');
});

test('Expo Go links fail closed without explicit exact-session approval', () => {
  for (const candidate of [null, '', 'allin365v2://auth/callback', 'https://wrong.example/', 'exp://192.168.1.8:8082/--/evil', 'exp://192.168.1.8:8082/?code=secret']) {
    assert.throws(() => v2EmailAuthRedirectUrl({expoGo:true,expoGoEnabled:true,expoGoLinkingUri:candidate,nativeCallbackUrl:native}));
  }
  assert.throws(() => v2EmailAuthRedirectUrl({expoGo:true,expoGoEnabled:false,expoGoLinkingUri:expo,nativeCallbackUrl:native}));
  assert.throws(() => v2EmailAuthRedirectUrl({expoGo:false,expoGoEnabled:false,expoGoLinkingUri:null,nativeCallbackUrl:'https://bad.example'}));
});
