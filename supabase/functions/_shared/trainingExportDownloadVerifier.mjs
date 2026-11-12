/**
 * ALL-251 REVIEW ONLY — independently verify the account-export attachment
 * before any client marks a download complete. Keep the same canonical format;
 * this is a safety check, NOT a second export implementation.
 *
 * Reads bounded lines incrementally. Never treats HTTP 200, connection close,
 * or a partial file as evidence of successful export.
 */
import {createHash} from 'node:crypto';

const VERSION='allin-v2-account-export-pages-v1';
const MAX_LINE=1024*1024+16384;
const MAX_RECORDS=4_000_000;

export async function verifyAccountExportDownload({stream,expectedOwnerId,expectedCollections}){
 if(!stream || typeof stream.getReader!=='function'
  ||typeof expectedOwnerId!=='string'||!expectedOwnerId
  ||!Array.isArray(expectedCollections)||expectedCollections.length===0
  ||new Set(expectedCollections).size!==expectedCollections.length) {
  throw Error('Missing trusted export download constraints');
 }
 const reader=stream.getReader(),digest=createHash('sha256');
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let carry=new Uint8Array(0),lineNo=0,recordCount=0,header=null,footer=null;
 let seenFooter=false;
 const approved=new Set(expectedCollections);
 function parseLine(bytes){
  if(bytes.length===0||bytes.length>MAX_LINE)throw Error('Invalid account export line size');
  let value;
  try{value=JSON.parse(decoder.decode(bytes));}catch{throw Error('Malformed account export record');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid account export record');
  if(lineNo++===0){
   if(value.format!==VERSION||value.export_owner!==expectedOwnerId
    ||JSON.stringify(value.collections)!==JSON.stringify(expectedCollections)
    ||!Number.isSafeInteger(value.records)||value.records<0||value.records>MAX_RECORDS)
    throw Error('Untrusted account export header');
   header=value;
  }else if(value.export_complete===true){
   if(seenFooter||!Number.isSafeInteger(value.records)
    ||value.records!==recordCount||value.records!==header.records
    ||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))
    throw Error('Incomplete account export completion receipt');
   footer=value;seenFooter=true;
  }else{
   if(seenFooter||recordCount>=header.records
    ||!approved.has(value.collection)||!value.record
    ||typeof value.record!=='object'||Array.isArray(value.record)
    ||(Object.hasOwn(value.record,'user_id')&&value.record.user_id!==expectedOwnerId))
    throw Error('Invalid account export data or ownership');
   digest.update(bytes);digest.update('\n');
   recordCount++;
  }
 }
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array))throw Error('Invalid account export byte stream');
   const merged=new Uint8Array(carry.length+value.length);
   merged.set(carry);merged.set(value,carry.length);
   let offset=0;
   for(let i=0;i<merged.length;i++){
    if(merged[i]===10){
     parseLine(merged.subarray(offset,i));
     offset=i+1;
    }
   }
   carry=merged.slice(offset);
   if(carry.length>MAX_LINE)throw Error('Oversized account export line');
  }
  if(carry.length!==0||!seenFooter||!header||!footer)
   throw Error('Account export truncated or lacks completion receipt');
  if(digest.digest('hex')!==footer.sha256)
   throw Error('Account export terminal checksum mismatch');
  return Object.freeze({verified:true,ownerId:expectedOwnerId,
   recordCount,collections:[...expectedCollections],format:VERSION});
 }finally{
  reader.releaseLock();
 }
}
