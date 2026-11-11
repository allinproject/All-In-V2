/**
 * ALL-252 server-only Google Play Developer API transport.
 * getAccessToken MUST get a short-lived OAuth2 access token with the
 * androidpublisher scope from an approved service-account credential.
 * No OAuth credential, purchase token or PII is persisted by this module.
 */
const validPackage=v=>typeof v==='string'&&
  /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(v)&&v.length<180;
const validToken=v=>typeof v==='string'&&v.length>=8&&v.length<=2048&&
  /^[A-Za-z0-9._:-]+$/.test(v);
export function createGooglePlayDeveloperTransport({
  expectedPackageName,getAccessToken,request,
}={}){
  if(!validPackage(expectedPackageName)||
     typeof getAccessToken!=='function'||typeof request!=='function')
    return null;
  return Object.freeze({
    async fetchSubscription({packageName,purchaseToken}={}){
      if(packageName!==expectedPackageName||!validToken(purchaseToken))
        throw Error('invalid_google_purchase');
      let accessToken;
      try{accessToken=await getAccessToken('https://www.googleapis.com/auth/androidpublisher')}
      catch{throw Error('google_auth_unavailable')}
      if(typeof accessToken!=='string'||accessToken.length<10)
        throw Error('google_auth_unavailable');
      const url='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+
        encodeURIComponent(expectedPackageName)+'/purchases/subscriptionsv2/tokens/'+
        encodeURIComponent(purchaseToken);
      let response;
      try {
        response=await request(url,{method:'GET',headers:{
          authorization:'Bearer '+accessToken,
          accept:'application/json',
        }});
      }catch{throw Error('google_provider_unavailable')}
      if(!response?.ok)throw Error('google_provider_unavailable');
      let purchase;
      try{purchase=await response.json()}
      catch{throw Error('google_invalid_response')}
      if(!purchase||typeof purchase!=='object'||
         purchase.kind!=='androidpublisher#subscriptionPurchaseV2')
        throw Error('google_invalid_response');
      return purchase;
    },
  });
}
