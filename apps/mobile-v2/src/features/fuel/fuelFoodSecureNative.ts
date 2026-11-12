import {randomUUID} from 'expo-crypto';
import {foodActionIdFromNative} from './fuelFoodDetail.ts';

/** Expo SDK 58 native randomUUID uses OS cryptographic entropy.
 * Do not fall back to non-secure JavaScript randomness on failure.
 * Keep this native module separate from pure Node-tested Food models.
 */
export function newNativeFoodActionId():string|null{
 return foodActionIdFromNative(randomUUID);
}
