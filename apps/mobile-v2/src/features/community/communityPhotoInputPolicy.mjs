/**
 * ALL-251 review-only Community PHOTO input validation.
 * This is NOT an upload authorization, a decoder, an EXIF scrubber, or an
 * approved Storage path. Call only inside a future authenticated canonical
 * Community writer, after ownership and deletion gates have been accepted.
 * No video, GIF, SVG, HEIC, or animated WebP.
 */
export const MAX_COMMUNITY_PHOTO_BYTES=8*1024*1024;
export const MAX_COMMUNITY_PHOTO_PIXELS=20_000_000;
const allowed=Object.freeze({
 'image/jpeg':'jpg','image/png':'png','image/webp':'webp',
});
const u32=(b,p)=>((b[p]*0x1000000)+(b[p+1]<<16)+(b[p+2]<<8)+b[p+3])>>>0;
const le32=(b,p)=>(b[p]+b[p+1]*256+b[p+2]*65536+b[p+3]*16777216)>>>0;
const label=(b,p,s)=>p+s.length<=b.length&&[...s].every((v,i)=>b[p+i]===v.charCodeAt(0));
function dimensions(b,mime){
 if(mime==='image/png'){
  if(b.length<33||!label(b,1,'PNG')||b[0]!==137||b[4]!==13||b[5]!==10||
   b[6]!==26||b[7]!==10||u32(b,8)!==13||!label(b,12,'IHDR'))return null;
  return [u32(b,16),u32(b,20)];
 }
 if(mime==='image/jpeg'){
  if(b.length<4||b[0]!==255||b[1]!==216||b.at(-2)!==255||b.at(-1)!==217)return null;
  let p=2;
  while(p+4<b.length){
   if(b[p++]!==255)return null;
   while(b[p]===255)p++;
   const marker=b[p++];
   if(marker===0xda||marker===0xd9||marker===0x00)return null;
   if(marker>=0xd0&&marker<=0xd7)continue;
   if(p+2>b.length)return null;
   const len=b[p]*256+b[p+1];if(len<2||p+len>b.length)return null;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    if(len<7)return null;
    return [b[p+5]*256+b[p+6],b[p+3]*256+b[p+4]];
   }
   p+=len;
  }
  return null;
 }
 if(mime==='image/webp'){
  if(b.length<30||!label(b,0,'RIFF')||!label(b,8,'WEBP')||
   le32(b,4)+8!==b.length)return null;
  if(label(b,12,'VP8X')){
   // Animated and ICC/EXIF/XMP-bearing extended WebP requires a separate
   // metadata-stripping decoder; do not accept it as a simple static photo.
   return null;
  }
  if(label(b,12,'VP8 ')&&b.length>=30&&b[23]===0x9d&&b[24]===0x01&&b[25]===0x2a)
   return [(b[26]+b[27]*256)&0x3fff,(b[28]+b[29]*256)&0x3fff];
  if(label(b,12,'VP8L')&&b.length>=25&&b[20]===0x2f){
   const w=1+(((b[22]&0x3f)<<8)|b[21]);
   const h=1+(((b[24]&0x0f)<<10)|(b[23]<<2)|((b[22]&0xc0)>>6));
   return [w,h];
  }
  return null;
 }
 return null;
}
export function validateCommunityPhotoInput({bytes,contentType,filename}={}){
 if(!(bytes instanceof Uint8Array)||!bytes.byteLength||
  bytes.byteLength>MAX_COMMUNITY_PHOTO_BYTES)return Object.freeze({ok:false,reason:'size_or_bytes'});
 if(typeof contentType!=='string'||!(contentType in allowed))
  return Object.freeze({ok:false,reason:'unsupported_type'});
 if(typeof filename!=='string'||filename.length>160||
  !/^[a-zA-Z0-9][a-zA-Z0-9 _().-]*\.(?:jpg|jpeg|png|webp)$/i.test(filename))
  return Object.freeze({ok:false,reason:'invalid_filename'});
 const ext=filename.split('.').at(-1).toLowerCase();
 if(ext!==allowed[contentType]&&!(contentType==='image/jpeg'&&ext==='jpeg'))
  return Object.freeze({ok:false,reason:'extension_mismatch'});
 const size=dimensions(bytes,contentType);
 if(!size||size.some(n=>!Number.isSafeInteger(n)||n<1)||
  size[0]*size[1]>MAX_COMMUNITY_PHOTO_PIXELS)
  return Object.freeze({ok:false,reason:'invalid_photo_bytes'});
 return Object.freeze({ok:true,width:size[0],height:size[1],byteLength:bytes.byteLength});
}
