/** ALL-243 iOS runtime adapter for the native WatchConnectivity module.
 * Available only in a signed iOS build where the optional watch target is
 * compiled and embedded. Expo Go, Android and simulator-only JS are denied.
 * Session and verified App Attest key still come from authenticated server
 * state; this module never signs its own provider evidence.
 */
import {NativeModules,Platform} from 'react-native';
import type {WatchPairingNative} from './appleWatchPairingHandoff';

type NativeBridge={
 fetchWatchKey():Promise<{
  deviceRef:string;watchPublicKeySpkiB64url:string;
 }>;
 signChallenge(
  challengeId:string,ownerId:string,sessionId:string,deviceRef:string,
  watchPublicKeySpkiB64url:string,appAttestKeyId:string,
 ):Promise<{
  challengeId:string;watchPublicKeySpkiB64url:string;
  watchSignatureB64url:string;phoneAppAttestKeyId:string;
  phoneAssertionCborB64url:string;
 }>;
};
export function getNativeAppleWatchPairing():WatchPairingNative{
 if(Platform.OS!=='ios')
  throw Error('Apple Watch pairing requires an iPhone');
 const bridge=NativeModules.ALLINWatchPairingModule as NativeBridge|undefined;
 if(!bridge||typeof bridge.fetchWatchKey!=='function'||
   typeof bridge.signChallenge!=='function')
  throw Error('WatchConnectivity native module not installed; signed V2 build required');
 return {
  fetchWatchKey:()=>bridge.fetchWatchKey(),
  signChallenge:(challengeId,ownerId,sessionId,deviceRef,
   watchPublicKeySpkiB64url,appAttestKeyId)=>
    bridge.signChallenge(challengeId,ownerId,sessionId,deviceRef,
      watchPublicKeySpkiB64url,appAttestKeyId),
 };
}
