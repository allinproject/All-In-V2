/**
 * ALL-251 REVIEW ONLY — verify Community photo recovery from the EXISTING
 * account-export JSONL stream. This is a strict post-download verification,
 * not another archive format, a Storage restore worker, or release approval.
 * Caller provides a verified canonical, pinned owner/photo inventory and the
 * download bytes from the existing encrypted archive flow. Never trust a
 * downloaded photo's self-claimed checksum as its only authority.
 */
import {createHash} from 'node:crypto';
import {verifyAccountExportDownload} from './trainingExportDownloadVerifier.mjs';
import {REVIEW_COMMUNITY_PHOTO_BUCKET} from './communityPhotoPrivacyCoverageReview.mjs';

const COLLECTION='community.private_photos';
const MAX_FILES=128,MAX_FILE_BYTES=8*1024*1024,MAX_TOTAL_BYTES=64*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const deny=()=>{throw Error('Community photo archive recovery evidence incomplete');};

function canonicalPhotos(ownerId,rows){
 if(!Array.isArray(rows)||rows.length>MAX_FILES)deny();
 const found=new Map();
 let total=0;
 for(const row of rows){
  if(!row||row.owner_id!==ownerId||row.post_owner_id!==ownerId||
   !UUID.test(row.id??'')||!UUID.test(row.post_id??'')||
   row.lifecycle!=='verified'||!row.verified_at||
   row.bucket_id!==REVIEW_COMMUNITY_PHOTO_BUCKET||
   row.content_type!=='image/png'||!SHA.test(row.sha256??'')||
   !Number.isSafeInteger(row.byte_length)||row.byte_length<1||
   row.byte_length>MAX_FILE_BYTES||
   row.object_path!==ownerId+'/posts/'+row.post_id+'/'+row.id+'.png'||
   found.has(row.object_path))deny();
  total+=row.byte_length;
  if(total>MAX_TOTAL_BYTES)deny();
  found.set(row.object_path,row);
 }
 return found;
}
function exactBase64(s) {
 if(typeof s!=='string'||!s||s.length>180000||
  s.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))deny();
 const bytes=Buffer.from(s,'base64');
 if(bytes.toString('base64')!==s)deny();
 return bytes;
}

/**
 * Existing download verifier must succeed before any reconstruction.
 * Stream is supplied as a Response so clone() can inspect the same bytes.
 * The resulting verified files are for disposable recovery rehearsal only.
 */
export async function verifyCommunityPhotoRecoveryReview({
 response,ownerId,requestId,collections,canonicalSnapshot,
}={}){
 if(!(response instanceof Response)||!response.body||
  !UUID.test(ownerId??'')||!UUID.test(requestId??'')||
  !Array.isArray(collections)||!collections.includes(COLLECTION)||
  new Set(collections).size!==collections.length||
  canonicalSnapshot?.ownerId!==ownerId||
  canonicalSnapshot.complete!==true)deny();
 const canonical=canonicalPhotos(ownerId,canonicalSnapshot.rows);
 // The existing verifier checks stream footer, owner, collection membership
 // and every record checksum, not per-file completeness.
 const proof=await verifyAccountExportDownload({
  stream:response.clone().body,expectedOwnerId:ownerId,
  expectedCollections:collections,
 });
 if(proof.verified!==true)deny();
 // Bounded byte stream: the archive is already line/page capped upstream.
 // This isolated acceptance parser does not run in a mobile or Edge handler.
 const text=await response.text();
 if(Buffer.byteLength(text)>MAX_TOTAL_BYTES*2+4*1024*1024)deny();
 let lines;
 try{lines=text.trimEnd().split('\n').map(s=>JSON.parse(s));}
 catch{deny();}
 const header=lines.shift(),footer=lines.pop();
 if(!header||!footer||footer.export_complete!==true||
  header.export_owner!==ownerId||
  JSON.stringify(header.collections)!==JSON.stringify(collections))deny();
 const parts=new Map();
 for(const item of lines){
  if(item.collection!==COLLECTION)continue;
  const row=item.record,canonicalRow=canonical.get(row?.path);
  if(!canonicalRow||row.user_id!==ownerId||
   row.bucket!==REVIEW_COMMUNITY_PHOTO_BUCKET||
   row.kind!=='community_photo'||row.contentType!=='image/png'||
   row.photoId!==canonicalRow.id||row.postId!==canonicalRow.post_id||
   row.postVersion!==canonicalRow.post_version||
   row.width!==canonicalRow.width||row.height!==canonicalRow.height||
   row.fileSha256!==canonicalRow.sha256||
   row.fileLength!==canonicalRow.byte_length||
   !Number.isSafeInteger(row.part)||!Number.isSafeInteger(row.parts)||
   row.parts<1||row.parts>64||row.part<0||row.part>=row.parts||
   !SHA.test(row.chunkSha256??''))deny();
  const chunk=exactBase64(row.dataBase64);
  if(!chunk.length||chunk.length>128*1024||digest(chunk)!==row.chunkSha256)deny();
  let state=parts.get(row.path);
  if(!state){
   state={count:row.parts,fragments:new Map()};
   parts.set(row.path,state);
  }
  if(state.count!==row.parts||state.fragments.has(row.part))deny();
  state.fragments.set(row.part,chunk);
 }
 if(parts.size!==canonical.size)deny();
 const restored=new Map();
 for(const [path,row] of canonical){
  const state=parts.get(path);
  if(!state||state.fragments.size!==state.count)deny();
  const chunks=[];
  for(let i=0;i<state.count;i++){
   const chunk=state.fragments.get(i);
   if(!chunk)deny();
   chunks.push(chunk);
  }
  const bytes=Buffer.concat(chunks);
  if(bytes.length!==row.byte_length||digest(bytes)!==row.sha256)deny();
  restored.set(path,new Uint8Array(bytes));
 }
 return Object.freeze({
  ownerId,requestId,verifiedPhotoCount:restored.size,
  fileByteRecoveryVerified:true,accountDeletionReady:false,
  completeUserExport:false,reviewOnly:true,
  // Only a separate trusted, isolated recovery harness may consume these.
  restored,
 });
}
