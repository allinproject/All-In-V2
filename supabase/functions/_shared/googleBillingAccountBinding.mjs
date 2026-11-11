/**
 * ALL-252: privacy-preserving, server-authored Play Billing account binding.
 * Stable for same user/product environment. The secret is a trusted SERVER
 * pepper (never shipped to the mobile app), not a client-provided claim.
 * Google purchase must return matching obfuscatedExternalAccountId in
 * verified SubscriptionPurchaseV2 before first account binding.
 */
const uuid=v=>typeof v==='string'&&
 /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export async function obfuscatedGoogleBillingAccountId({
  ownerId,environment,serverPepper,
}={}){
  if(!uuid(ownerId)||!['sandbox','production'].includes(environment)||
    typeof serverPepper!=='string'||serverPepper.length<32)
    return null;
  const input=new TextEncoder().encode('allin365-google-billing:'+environment+':'+
   ownerId.toLowerCase()+':'+serverPepper);
  const hashed=new Uint8Array(await crypto.subtle.digest('SHA-256',input));
  return Array.from(hashed,x=>x.toString(16).padStart(2,'0')).join('');
}
