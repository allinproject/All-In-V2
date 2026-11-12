import * as ExpoCrypto from 'expo-crypto';

/** Native secure randomness from Expo SDK 58, never Math.random.
 * React Native's Metro resolver prefers this .native module.
 */
export function secureFoodEntropy():Pick<Crypto,'getRandomValues'>|null{
 try{
  if(typeof ExpoCrypto.getRandomValues!=='function')return null;
  return {getRandomValues: ExpoCrypto.getRandomValues as Crypto['getRandomValues']};
 }catch{return null;}
}
