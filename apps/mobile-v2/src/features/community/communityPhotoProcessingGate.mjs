/**
 * Review-only Community photo processing boundary (ALL-251).
 * No active upload or Storage route calls this module.
 *
 * NEVER store the original user-supplied bytes. A future approved trusted
 * server processor must decode pixels and freshly encode a metadata-free PNG.
 * The output parser below is a *postcondition*, not a substitute for decoding
 * the compressed image. Until a trusted decoder/re-encoder is installed this
 * function always fails closed.
 */
import {validateCommunityPhotoInput,MAX_COMMUNITY_PHOTO_BYTES,MAX_COMMUNITY_PHOTO_PIXELS} from './communityPhotoInputPolicy.mjs';

const PNG_SIGNATURE=[137,80,78,71,13,10,26,10];
const u32=(b,p)=>((b[p]*0x1000000)+(b[p+1]<<16)+(b[p+2]<<8)+b[p+3])>>>0;
const chunkName=(b,p)=>String.fromCharCode(...b.subarray(p,p+4));
const STATIC_CHUNKS=new Set(['IHDR','PLTE','IDAT','IEND','tRNS']);
const reject=(reason)=>Object.freeze({ok:false,reason});
function cleanPngStructure(bytes) {
 if(!(bytes instanceof Uint8Array)||bytes.length<57||bytes.length>MAX_COMMUNITY_PHOTO_BYTES||
  !PNG_SIGNATURE.every((v,i)=>bytes[i]===v))return null;
 let pos=8,seenHeader=false,seenData=false,endedData=false,seenEnd=false;
 let width=0,height=0;
 while(pos+12<=bytes.length){
  const length=u32(bytes,pos);
  if(length>bytes.length-pos-12)return null;
  const type=chunkName(bytes,pos+4);
  const payload=pos+8;
  if(!STATIC_CHUNKS.has(type))return null; // reject EXIF, text, ICC, animation, unknown chunks
  if(!seenHeader&&type!=='IHDR')return null;
  if(type==='IHDR'){
   if(seenHeader||pos!==8||length!==13)return null;
   width=u32(bytes,payload);height=u32(bytes,payload+4);
   if(!width||!height||width*height>MAX_COMMUNITY_PHOTO_PIXELS||
    bytes[payload+8]!==8||![0,2,6].includes(bytes[payload+9])||
    bytes[payload+10]!==0||bytes[payload+11]!==0||bytes[payload+12]!==0)return null;
   seenHeader=true;
  }else if(type==='PLTE'){
   if(seenData||endedData||length===0||length>768||length%3!==0)return null;
  }else if(type==='tRNS'){
   if(seenData||endedData||![2,6].includes(bytes[25]))return null;
   // Reject tRNS in this conservative output profile; decoder must emit RGBA instead.
   return null;
  }else if(type==='IDAT'){
   if(endedData||length===0)return null;
   seenData=true;
  }else if(type==='IEND'){
   if(!seenData||length!==0||payload+length+4!==bytes.length)return null;
   seenEnd=true;
  }
  // A freshly encoded image must have correct chunk CRCs. This verifies the
  // PNG envelope, but never establishes that compressed pixels can decode.
  const expected=u32(bytes,payload+length);
  let crc=0xffffffff;
  for(let i=pos+4;i<payload+length;i++){
   crc^=bytes[i];
   for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  if(((crc^0xffffffff)>>>0)!==expected)return null;
  pos=payload+length+4;
  if(type==='IEND')break;
  if(seenData&&type!=='IDAT')endedData=true;
 }
 if(!seenHeader||!seenData||!seenEnd||pos!==bytes.length)return null;
 return {width,height};
}
function sameBytes(a,b){
 if(a.length!==b.length)return false;
 let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];
 return different===0;
}
export async function processCommunityPhotoForReview(input,{decodeAndReencode}={}){
 const preflight=validateCommunityPhotoInput(input);
 if(!preflight.ok)return reject('input_rejected');
 if(typeof decodeAndReencode!=='function')return reject('trusted_processor_unavailable');
 let converted;
 try{
  // The injected implementation must be a reviewed trusted server library
  // performing real image decode, size limits, orientation normalization and
  // re-encoding WITHOUT copying EXIF, GPS, ICC, text or other metadata.
  converted=await decodeAndReencode({
   bytes:new Uint8Array(input.bytes),
   contentType:input.contentType,
   maxPixels:MAX_COMMUNITY_PHOTO_PIXELS,
   outputContentType:'image/png',
  });
 }catch{return reject('processing_failed');}
 if(!converted||converted.contentType!=='image/png'||
  !(converted.bytes instanceof Uint8Array)||converted.bytes===input.bytes||
  sameBytes(converted.bytes,input.bytes))return reject('invalid_processor_output');
 const structure=cleanPngStructure(converted.bytes);
 if(!structure||structure.width!==preflight.width||
  structure.height!==preflight.height)return reject('unverified_sanitized_image');
 return Object.freeze({
  ok:true,contentType:'image/png',bytes:new Uint8Array(converted.bytes),
  width:structure.width,height:structure.height,
 });
}
