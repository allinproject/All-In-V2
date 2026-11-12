/** Node/web test entropy only. React Native resolves the .native.ts sibling. */
export function secureFoodEntropy():Pick<Crypto,'getRandomValues'>|null{
 return globalThis.crypto?.getRandomValues?globalThis.crypto:null;
}
