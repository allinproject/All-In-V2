/**
 * ALL-251 REVIEW ONLY: paginated JSONL export inside the EXISTING account-export
 * request lifecycle. No Edge handler, live grants, public URL, bucket creation
 * or deployment. Caller supplies server-only Auth, cursor reader, KMS key and
 * private Storage adapters bound to the same approved request.
 *
 * Never turn a partial pagination run into an export receipt. The private
 * manifest is committed only after every collection reaches its terminal page.
 */
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME=/^[a-z][a-z0-9_]{0,63}$/;
const MAX_PAGE_ROWS=200;
const MAX_PAGE_BYTES=1024*1024;
const MAX_CHUNKS=20000; // bounded work; not a promise of unlimited export
const VERSION='allin-v2-account-export-pages-v1';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function validId(id){return typeof id==='string'&&UUID.test(id);}
function aad(ownerId,requestId,collection,index){
 return Buffer.from(JSON.stringify([VERSION,ownerId,requestId,collection,index]));
}
function checkedKey(key){
 if(!(key instanceof Uint8Array)||key.length!==32)throw Error('Server encryption key unavailable');
 return key;
}
function protect(plaintext,key,ownerId,requestId,collection,index){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(aad(ownerId,requestId,collection,index));
 const bytes=Buffer.concat([cipher.update(plaintext),cipher.final()]);
 return Object.freeze({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  ciphertext:bytes.toString('base64'),plaintextSha256:sha(plaintext),plaintextLength:plaintext.length});
}
function unprotect(envelope,key,ownerId,requestId,collection,index){
 if(!envelope||typeof envelope.ciphertext!=='string'
  ||!Number.isInteger(envelope.plaintextLength)||envelope.plaintextLength<1
  ||envelope.plaintextLength>MAX_PAGE_BYTES+10000
  ||! /^[a-f0-9]{64}$/.test(envelope.plaintextSha256??'')) throw Error('Invalid private page envelope');
 const iv=Buffer.from(envelope.iv??'','base64'),tag=Buffer.from(envelope.tag??'','base64');
 if(iv.length!==12||tag.length!==16)throw Error('Invalid page IV/tag');
 const cipher=createDecipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(aad(ownerId,requestId,collection,index));cipher.setAuthTag(tag);
 const plain=Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]);
 if(plain.length!==envelope.plaintextLength||sha(plain)!==envelope.plaintextSha256)
   throw Error('Private page checksum mismatch');
 return plain;
}
function checkedServices(services){
 for(const name of ['authorizeExport','readPage','resolveEncryptionKey','writePrivatePage',
  'commitPrivateManifest','readPrivateManifest','readPrivatePage','purgePrivateRequest']){
  if(typeof services?.[name]!=='function')throw Error('Incomplete trusted export dependencies: '+name);
 }
 return services;
}
async function ownerGate(services,requestId,owner){
 const auth=await services.authorizeExport(requestId);
 if(!validId(auth?.ownerId)||auth.activeSession!==true||auth.exportPermitted!==true
   ||(owner!==null&&auth.ownerId!==owner)) throw Error('Export session or request revoked');
 return auth.ownerId;
}
function checkedCollections(collections){
 if(!Array.isArray(collections)||collections.length===0||collections.length>64
  ||new Set(collections).size!==collections.length||collections.some(x=>!NAME.test(x)))
   throw Error('Invalid reviewed export inventory');
 return collections;
}
function checkedManifest(m,ownerId,requestId,collections){
 if(!m||m.version!==VERSION||m.ownerId!==ownerId||m.requestId!==requestId
  ||m.completeUserExport!==true||m.private!==true||m.encrypted!==true
  ||!Array.isArray(m.pages)||m.pages.length>MAX_CHUNKS
  ||JSON.stringify(m.collections)!==JSON.stringify(collections)) throw Error('Unverified complete account export');
 const seen=new Set();let total=0;
 for(const p of m.pages){
  const key=p?.collection+'/'+p?.index;
  if(!NAME.test(p?.collection??'')||!collections.includes(p.collection)
    ||!Number.isInteger(p.index)||p.index<0||seen.has(key)
    ||!Number.isInteger(p.rows)||p.rows<1||p.rows>MAX_PAGE_ROWS
    ||! /^[a-f0-9]{64}$/.test(p.sha256??''))throw Error('Invalid account export manifest');
  seen.add(key);total+=p.rows;
 }
 if(total!==m.rowCount)throw Error('Incomplete account export manifest');
 // Page indices must be contiguous, and all approved collections represented.
 for(const name of collections){
  const indices=m.pages.filter(x=>x.collection===name).map(x=>x.index).sort((a,b)=>a-b);
  if(indices.some((n,i)=>n!==i))throw Error('Missing account export page');
 }
 return m;
}
/** Trusted server-only, stage first; never return ciphertext, plaintext or key. */
export async function stageLargeAccountExport({requestId,collections,services}){
 if(!validId(requestId))throw Error('Exact export request required');
 checkedCollections(collections);checkedServices(services);
 const ownerId=await ownerGate(services,requestId,null);
 const key=checkedKey(await services.resolveEncryptionKey({ownerId,requestId}));
 const pages=[];let rowCount=0;
 try{
  for(const collection of collections){
   let cursor=null,index=0;const cursors=new Set();
   while(true){
    if(pages.length>=MAX_CHUNKS)throw Error('Account export page limit exceeded');
    await ownerGate(services,requestId,ownerId);
    const page=await services.readPage({ownerId,requestId,collection,cursor,limit:MAX_PAGE_ROWS});
    if(!page||page.ownerId!==ownerId||page.collection!==collection
      ||!Array.isArray(page.rows)||page.rows.length>MAX_PAGE_ROWS
      ||page.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row))
      ||typeof page.done!=='boolean')throw Error('Invalid canonical account export page');
    if(!page.done && (page.rows.length===0||typeof page.nextCursor!=='string'
      ||page.nextCursor.length===0||page.nextCursor.length>512
      ||cursors.has(page.nextCursor)||page.nextCursor===cursor))
      throw Error('Unstable account export cursor');
    if(page.done && page.nextCursor!=null)throw Error('Terminal page has a cursor');
    if(page.rows.length>0){
     const raw=Buffer.from(page.rows.map(row=>JSON.stringify({collection,record:row})+'\n').join(''));
     if(raw.length>MAX_PAGE_BYTES)throw Error('Oversized account export page');
     const sealed=protect(raw,key,ownerId,requestId,collection,index);
     const stored=await services.writePrivatePage({ownerId,requestId,collection,index,sealed});
     if(stored?.stored!==true||stored.ownerId!==ownerId||stored.requestId!==requestId
       ||stored.collection!==collection||stored.index!==index)throw Error('Private page write unconfirmed');
     pages.push({collection,index,rows:page.rows.length,sha256:sealed.plaintextSha256});
     rowCount+=page.rows.length;index++;
    }
    if(page.done)break;
    cursors.add(page.nextCursor);cursor=page.nextCursor;
   }
  }
  await ownerGate(services,requestId,ownerId);
  const manifest=Object.freeze({version:VERSION,ownerId,requestId,collections:[...collections],
   completeUserExport:true,private:true,encrypted:true,rowCount,pages});
  const saved=await services.commitPrivateManifest({ownerId,requestId,manifest});
  if(saved?.committed!==true||saved.ownerId!==ownerId||saved.requestId!==requestId)
    throw Error('Complete private manifest was not durably committed');
  await ownerGate(services,requestId,ownerId);
  return {ownerId,requestId,staged:true,recordCount:rowCount,pageCount:pages.length,
   encrypted:true,private:true,completeUserExport:true,downloadAuthorized:false};
 }catch(err){
  try{if(await services.purgePrivateRequest({ownerId,requestId})!==true)throw Error('unconfirmed');}
  catch{throw Error('Account export archive uncertain; manual purge required',{cause:err});}
  throw err;
 }
}
/** Trusted authenticated server stream; no signed URL or key ever returned. */
export async function* streamLargeAccountExport({requestId,collections,services}){
 if(!validId(requestId))throw Error('Exact export request required');
 checkedCollections(collections);checkedServices(services);
 const ownerId=await ownerGate(services,requestId,null);
 const m=checkedManifest(await services.readPrivateManifest({ownerId,requestId}),ownerId,requestId,collections);
 const key=checkedKey(await services.resolveEncryptionKey({ownerId,requestId}));
 yield Buffer.from(JSON.stringify({format:VERSION,export_owner:ownerId,collections,records:m.rowCount})+'\n');
 for(const p of m.pages){
  await ownerGate(services,requestId,ownerId);
  const sealed=await services.readPrivatePage({ownerId,requestId,collection:p.collection,index:p.index});
  const plain=unprotect(sealed,key,ownerId,requestId,p.collection,p.index);
  if(sha(plain)!==p.sha256)throw Error('Account export page differs from manifest');
  const lines=plain.toString('utf8').trimEnd().split('\n');
  if(lines.length!==p.rows)throw Error('Account export row count mismatch');
  for(const line of lines){
   const value=JSON.parse(line);
   if(value.collection!==p.collection||!value.record||typeof value.record!=='object')
    throw Error('Account export page content invalid');
  }
  yield plain; // reauthorize before each encrypted page is opened
 }
}

/**
 * ALL-251 REVIEW ONLY: transport shell for the SAME trusted, owner-validated
 * request. No anonymous route, no static signed URL, no service key in client.
 * The caller must verify the bearer token and current Auth session in
 * services.authorizeExport; release uses the same request ID as archive staging.
 *
 * A mid-download authorization error terminates the stream, never serves a
 * cached plaintext file. Clients must treat an incomplete stream as failure.
 */
export async function createLargeAccountDownloadResponse({requestId,collections,services}){
 if(!validId(requestId))throw Error('Exact export request required');
 checkedCollections(collections);checkedServices(services);
 // Start the generator before returning HTTP 200 so invalid owner/manifest
 // cannot be turned into a successful empty download.
 const iterator=streamLargeAccountExport({requestId,collections,services})[Symbol.asyncIterator]();
 const first=await iterator.next();
 if(first.done||!(first.value instanceof Uint8Array))
   throw Error('Missing verified account export stream header');
 let header=first.value;
 const body=new ReadableStream({
  async pull(controller){
   try {
    if(header!==null){controller.enqueue(header);header=null;return;}
    const next=await iterator.next();
    if(next.done){controller.close();return;}
    controller.enqueue(next.value);
   }catch(error){controller.error(error);}
  },
  async cancel(){await iterator.return?.();}
 });
 return new Response(body,{
  status:200,headers:{
   'Content-Type':'application/x-ndjson; charset=utf-8',
   'Content-Disposition':'attachment; filename="all-in-365-account-export.ndjson"',
   'Cache-Control':'private, no-store, max-age=0',
   'Pragma':'no-cache',
   'X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer',
   'Cross-Origin-Resource-Policy':'same-origin',
  }
 });
}
