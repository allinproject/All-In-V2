/**
 * Restricted ALL-251 staging SigV4 signer. No SDK, credentials, URLs, body,
 * Authorization headers or tokens are ever printed. Not for app runtime.
 * Caller must use a pre-approved disposable project's direct Storage host.
 */
import {createHash,createHmac} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const enc=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>
 '%'+c.charCodeAt(0).toString(16).toUpperCase());
const isoDate=now=>now.toISOString().replace(/[:-]|\.\d{3}/g,'');
export function signAll251S3({
 method,host,region,accessKeyId,secretAccessKey,bucket,objectPath='',
 query={},bytes=Buffer.alloc(0),now=new Date(),
}){
 if(!['GET','HEAD','PUT','POST','DELETE'].includes(method))
  throw Error('Unsupported staging S3 method');
 if(!/^[-a-z0-9.]+\.storage\.supabase\.co$/.test(host))
  throw Error('Unapproved S3 host');
 if(!/^[a-z0-9-]{3,40}$/.test(region))
  throw Error('S3 region must be explicit');
 if(!accessKeyId||!secretAccessKey||!bucket||!Buffer.isBuffer(bytes))
  throw Error('Missing protected S3 signing input');
 if(objectPath.includes('..')||objectPath.startsWith('/'))
  throw Error('Unsafe staging S3 key');
 const path='/storage/v1/s3/'+enc(bucket)+
  (objectPath?'/'+objectPath.split('/').map(enc).join('/'):'');
 const canonicalQuery=Object.entries(query).map(([k,v])=>[enc(k),enc(String(v))])
  .sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv))
  .map(([k,v])=>k+'='+v).join('&');
 const timestamp=isoDate(now),date=timestamp.slice(0,8),payloadHash=hash(bytes);
 const signedHeaders='host;x-amz-content-sha256;x-amz-date';
 const canonicalHeaders='host:'+host+'\n'+'x-amz-content-sha256:'+payloadHash+
  '\n'+'x-amz-date:'+timestamp+'\n';
 const canonical=[method,path,canonicalQuery,canonicalHeaders,
  signedHeaders,payloadHash].join('\n');
 const scope=[date,region,'s3','aws4_request'].join('/');
 const toSign=['AWS4-HMAC-SHA256',timestamp,scope,hash(canonical)].join('\n');
 let signingKey=hmac('AWS4'+secretAccessKey,date);
 for(const part of [region,'s3','aws4_request'])signingKey=hmac(signingKey,part);
 const signature=createHmac('sha256',signingKey).update(toSign).digest('hex');
 signingKey.fill(0);
 const authorization='AWS4-HMAC-SHA256 Credential='+accessKeyId+'/'+scope+
  ', SignedHeaders='+signedHeaders+', Signature='+signature;
 return {
  url:'https://'+host+path+(canonicalQuery?'?'+canonicalQuery:''),
  headers:{host,'x-amz-content-sha256':payloadHash,'x-amz-date':timestamp,
   authorization},
 };
}
