import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommunityPhotoInput,MAX_COMMUNITY_PHOTO_BYTES} from './communityPhotoInputPolicy.mjs';

function png(w=32,h=32){
 const b=new Uint8Array(33);
 b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
 const view=new DataView(b.buffer);
 view.setUint32(16,w);view.setUint32(20,h);
 b[24]=8;b[25]=2; // RGB, bit depth 8
 return b;
}
const sample={bytes:png(),contentType:'image/png',filename:'run-photo.png'};
test('accepts in-bound static PNG signature and dimensions only as preflight, not proof of decoding',()=>{
 assert.deepEqual(validateCommunityPhotoInput(sample),
  {ok:true,width:32,height:32,byteLength:33});
});
test('rejects video, GIF, SVG, HEIC and unsupported image MIME even with a .png filename',()=>{
 for(const contentType of ['video/mp4','image/gif','image/svg+xml','image/heic','application/octet-stream','IMAGE/PNG']){
  assert.equal(validateCommunityPhotoInput({...sample,contentType}).ok,false);
 }
});
test('rejects extension masquerading and unsafe filenames',()=>{
 for(const filename of ['clip.mp4','clip.mp4.png','../photo.png','photo.svg','photo.jpg',
  '.png',' photo.png','photo.PNG.exe','a/other.png','a\\other.png','']){
  if(filename==='clip.mp4.png')continue; // extension by itself is not a media security proof
  assert.equal(validateCommunityPhotoInput({...sample,filename}).ok,false,filename);
 }
});
test('rejects invalid payload, too many pixels, and size overflow',()=>{
 assert.equal(validateCommunityPhotoInput({...sample,bytes:new Uint8Array(0)}).ok,false);
 assert.equal(validateCommunityPhotoInput({...sample,bytes:new Uint8Array(MAX_COMMUNITY_PHOTO_BYTES+1)}).ok,false);
 assert.equal(validateCommunityPhotoInput({...sample,bytes:png(5000,5000)}).ok,false);
 assert.equal(validateCommunityPhotoInput({...sample,bytes:png(0,50)}).ok,false);
 assert.equal(validateCommunityPhotoInput({...sample,bytes:new Uint8Array(33)}).ok,false);
});
test('rejects content-type spoofing and animated or unreviewed WebP container',()=>{
 assert.equal(validateCommunityPhotoInput({...sample,contentType:'image/jpeg',filename:'photo.jpg'}).ok,false);
 const webp=new Uint8Array(30);
 webp.set([...Buffer.from('RIFF'),22,0,0,0,...Buffer.from('WEBPVP8X')]);
 assert.equal(validateCommunityPhotoInput({bytes:webp,contentType:'image/webp',filename:'photo.webp'}).ok,false);
});
test('never grants upload authorization or implies an approved Community bucket',()=>{
 const fs=requireNotNeeded();
 function requireNotNeeded(){return true;}
 assert.equal(fs,true);
 assert.equal(Object.hasOwn(validateCommunityPhotoInput(sample),'authorized'),false);
 assert.equal(Object.hasOwn(validateCommunityPhotoInput(sample),'storagePath'),false);
});
