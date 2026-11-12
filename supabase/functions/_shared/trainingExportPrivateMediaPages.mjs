/**
 * ALL-251 REVIEW ONLY: source-byte pages for the EXISTING encrypted account
 * archive. The canonical source registry must explicitly approve
 * "private_media"; an unapproved Storage bucket never becomes exportable.
 * Caller owns one pinned read-only PostgreSQL snapshot and the existing
 * owner/request-checked private evidence downloader. No signed URLs.
 */
import {createHash} from 'node:crypto';
import {auditOwnerPrivateMediaCoverage} from './trainingExportSupabaseStorage.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const CHUNK_BYTES=128*1024;
const MAX_FILES=128;
const MAX_FILE_BYTES=16*1024*1024;
const MAX_RECORDS=MAX_FILES*Math.ceil(MAX_FILE_BYTES/CHUNK_BYTES);

export async function createApprovedPrivateMediaPageReader({
 ownerId,requestId,snapshotId,scoped,downloadPrivateObject,
}) {
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??'')
  ||!UUID.test(snapshotId??'')
  ||typeof scoped?.listCanonicalMediaReferences!=='function'
  ||typeof scoped?.listBucketCatalog!=='function'
  ||typeof scoped?.listOwnerStorageObjects!=='function'
  ||typeof downloadPrivateObject!=='function')
  throw Error('Pinned approved media export dependencies required');
 const refs=await scoped.listCanonicalMediaReferences({ownerId,requestId});
 // The audit checks exhaustive private object coverage, every canonical
 // reference, and all source bytes before any complete manifest can commit.
 const coverage=await auditOwnerPrivateMediaCoverage({
  ownerId,requestId,
  listCanonicalMediaReferences:async()=>refs,
  listBucketCatalog:scoped.listBucketCatalog,
  listOwnerStorageObjects:scoped.listOwnerStorageObjects,
  downloadPrivateObject,
 });
 if(!coverage.referencesReconciled||!coverage.bytesVerified)
  throw Error('Incomplete source media coverage');
 const files=[
  ...(refs.series??[]).map(r=>({...r,kind:'series'})),
  ...(refs.routes??[]).map(r=>({...r,kind:'route'})),
 ].sort((a,b)=>a.object_path.localeCompare(b.object_path));
 if(files.length>MAX_FILES)throw Error('Private media source count exceeds bound');
 const counts=files.map(file=>{
  if(file.user_id!==ownerId||!SHA.test(file.checksum_sha256??'')
   ||typeof file.object_path!=='string')throw Error('Invalid media source');
  // The actual downloader applies the lower bytes bound. A manifest must
  // never trust a client-claimed or metadata-claimed file size.
  return file;
 });
 // Obtain immutable verified source bytes once per file to avoid mixing
 // revisions across paginated reads in the same DB snapshot. Staging is
 // bounded to 128 x 16MiB and the worker snapshot lifetime (5 minutes).
 const frozen=[];
 for(const file of counts){
  const bytes=await downloadPrivateObject({
   ownerId,requestId,path:file.object_path,kind:file.kind,
  });
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1
    ||bytes.byteLength>MAX_FILE_BYTES
    ||createHash('sha256').update(bytes).digest('hex')!==file.checksum_sha256)
    throw Error('Private media changed or checksum mismatch during snapshot');
  frozen.push({...file,bytes:Buffer.from(bytes),
   parts:Math.ceil(bytes.byteLength/CHUNK_BYTES)});
 }
 const total=frozen.reduce((n,f)=>n+f.parts,0);
 if(total>MAX_RECORDS)throw Error('Private media chunk count exceeds bound');
 return Object.freeze({
  sourceFileCount:frozen.length,
  totalChunkCount:total,
  async readPage({ownerId:o,requestId:r,collection,cursor,limit}){
   if(o!==ownerId||r!==requestId||collection!=='private_media'
    ||!(cursor===null||/^(0|[1-9][0-9]{0,5})$/.test(cursor))
    ||!Number.isInteger(limit)||limit<1)
    throw Error('Unapproved private media page');
   const start=cursor===null?0:Number(cursor);
   if(start>total)throw Error('Private media cursor out of bounds');
   const end=Math.min(total,start,0); // overwritten by exact bounded page below
   void end;
   const stop=Math.min(total,start+Math.min(limit,4));
   const rows=[];let ordinal=0;
   for(const file of frozen){
    for(let part=0;part<file.parts;part++){
     if(ordinal>=start&&ordinal<stop){
      const payload=file.bytes.subarray(part*CHUNK_BYTES,(part+1)*CHUNK_BYTES);
      rows.push({
       bucket:'v2-private-workout-objects',path:file.object_path,
       kind:file.kind,user_id:ownerId,part,parts:file.parts,
       fileSha256:file.checksum_sha256,fileLength:file.bytes.length,
       chunkSha256:createHash('sha256').update(payload).digest('hex'),
       dataBase64:payload.toString('base64'),
      });
     }
     ordinal++;
     if(ordinal>=stop)break;
    }
    if(ordinal>=stop)break;
   }
   return {ownerId,requestId,collection,snapshotId,ownerVerified:true,
    rows,done:stop===total,nextCursor:stop===total?null:String(stop)};
  },
 });
}
