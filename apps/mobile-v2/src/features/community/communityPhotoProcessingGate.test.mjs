import test from 'node:test';
import assert from 'node:assert/strict';
import {processCommunityPhotoForReview} from './communityPhotoProcessingGate.mjs';
const original=new Uint8Array(33);
original.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
new DataView(original.buffer).setUint32(16,2);
new DataView(original.buffer).setUint32(20,2);
original[24]=8;original[25]=2;
const input={bytes:original,contentType:'image/png',filename:'run.png'};
function chunk(name,body){
 const data=Buffer.concat([Buffer.from(name),Buffer.from(body)]);
 const out=Buffer.alloc(12+body.length);
 out.writeUInt32BE(body.length,0);data.copy(out,4);
 let crc=0xffffffff;
 for(const byte of data){
  crc^=byte;
  for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 out.writeUInt32BE((crc^0xffffffff)>>>0,8+body.length);
 return out;
}
function png({extra=[],badCrc=false,w=2}={}){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(2,4);
 ihdr[8]=8;ihdr[9]=2;
 const idat=chunk('IDAT',[0x78,0x9c,1,0,0]); // envelope-only fixture; not trusted decoded pixels
 const out=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR',ihdr),...extra,idat,chunk('IEND',[])]);
 if(badCrc)out[30]^=1;
 return new Uint8Array(out);
}
const result=(bytes)=>processCommunityPhotoForReview(input,{decodeAndReencode:async()=>({
 contentType:'image/png',bytes,
})});
test('cannot process or authorize photo without an installed trusted decoder/re-encoder',async()=>{
 assert.deepEqual(await processCommunityPhotoForReview(input),{ok:false,reason:'trusted_processor_unavailable'});
 assert.deepEqual(await processCommunityPhotoForReview(input,{decodeAndReencode:async()=>{throw Error('bad')}}),
  {ok:false,reason:'processing_failed'});
});
test('accepts only externally re-encoded, structurally clean PNG output with dimensions',async()=>{
 const r=await result(png());
 assert.equal(r.ok,true);
 assert.equal(r.contentType,'image/png');
 assert.equal(r.width,2);assert.equal(r.height,2);
 assert.notStrictEqual(r.bytes,input.bytes);
});
test('rejects returned originals, wrong output type, missing or corrupt chunks',async()=>{
 assert.equal((await result(original)).ok,false);
 assert.equal((await result(png({badCrc:true}))).ok,false);
 assert.equal((await result(png({w:3}))).ok,false);
 assert.equal((await processCommunityPhotoForReview(input,{decodeAndReencode:async()=>({
  bytes:png(),contentType:'image/jpeg',
 })})).ok,false);
});
test('rejects metadata chunks (EXIF, GPS, text, ICC), unknown chunks and trailing bytes',async()=>{
 for(const name of ['eXIf','tEXt','iTXt','iCCP','acTL','zzZZ']){
  const r=await result(png({extra:[chunk(name,[1,2,3])]}));
  assert.equal(r.ok,false,name);
 }
 const trailing=Buffer.concat([Buffer.from(png()),Buffer.from([1])]);
 assert.equal((await result(new Uint8Array(trailing))).ok,false);
});
test('rejects video input before calling processor and does not expose upload authority',async()=>{
 let called=false;
 const r=await processCommunityPhotoForReview({...input,contentType:'video/mp4'},{
  decodeAndReencode:async()=>{called=true;return {bytes:png(),contentType:'image/png'};},
 });
 assert.equal(called,false);assert.equal(r.ok,false);
 assert.equal(Object.hasOwn(r,'storagePath'),false);
 assert.equal(Object.hasOwn(r,'authorized'),false);
});
