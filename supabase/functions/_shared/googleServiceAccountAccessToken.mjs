/**
 * ALL-252 — server-only Google service-account OAuth transport.
 * Exchanges a short-lived, RS256-signed JWT for the androidpublisher scope.
 * Does not send account keys or access tokens to clients or persist them.
 * The caller must supply an authorized service-account email and private key
 * from trusted server secrets (never client JSON / EXPO_PUBLIC).
 */
const enc=new TextEncoder();
const validEmail=s=>typeof s==='string'&&
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.iam\.gserviceaccount\.com$/.test(s);
const base64url=bytes=>{
  const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  let binary='';for(const x of a)binary+=String.fromCharCode(x);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const keyBytes=pem=>{
  if(typeof pem!=='string')return null;
  const match=pem.match(/^-----BEGIN PRIVATE KEY-----\s*([a-zA-Z0-9+\/=\s]+)\s*-----END PRIVATE KEY-----\s*$/);
  if(!match)return null;
  try{
    const binary=atob(match[1].replace(/\s/g,''));
    return Uint8Array.from(binary,c=>c.charCodeAt(0));
  }catch{return null}
};
export function createGoogleServiceAccountAccessToken({
  serviceAccountEmail,privateKeyPem,request,clockSeconds,tokenEndpoint,
}={}){
  const bytes=keyBytes(privateKeyPem);
  if(!validEmail(serviceAccountEmail)||!bytes||bytes.length<300||
     typeof request!=='function'||typeof clockSeconds!=='function'||
     tokenEndpoint!=null&&tokenEndpoint!=='https://oauth2.googleapis.com/token')
    return null;
  return async function getAccessToken(scope){
    if(scope!=='https://www.googleapis.com/auth/androidpublisher')
      throw Error('google_scope_unapproved');
    const now=clockSeconds();
    if(!Number.isSafeInteger(now)||now<0)
      throw Error('google_clock_unavailable');
    let jwt;
    try{
      const key=await crypto.subtle.importKey('pkcs8',bytes,
        {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      const header=base64url(enc.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
      const payload=base64url(enc.encode(JSON.stringify({
        iss:serviceAccountEmail,scope,aud:'https://oauth2.googleapis.com/token',
        iat:now,exp:now+3600,
      })));
      const raw=header+'.'+payload;
      const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(raw));
      jwt=raw+'.'+base64url(signature);
    }catch{throw Error('google_credentials_invalid')}
    let response;
    try{
      response=await request('https://oauth2.googleapis.com/token',{
        method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({
          grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion:jwt,
        }).toString(),
      });
    }catch{throw Error('google_oauth_unavailable')}
    if(!response?.ok)throw Error('google_oauth_unavailable');
    let json;
    try{json=await response.json()}catch{throw Error('google_oauth_unavailable')}
    if(!json||json.token_type!=='Bearer'||
       typeof json.access_token!=='string'||json.access_token.length<10||
       !Number.isSafeInteger(json.expires_in)||json.expires_in<=0)
      throw Error('google_oauth_unavailable');
    return json.access_token;
  };
}
