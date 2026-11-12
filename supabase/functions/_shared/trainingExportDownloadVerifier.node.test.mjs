import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyAccountExportDownload} from './trainingExportDownloadVerifier.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const collections=['coach_messages','completed_activities'];
function archive({count=5,ownerId=owner,footer=true,alterFooter=false,wrongRecord=false,extra=false}={}){
 const header={format:'allin-v2-account-export-pages-v1',export_owner:ownerId,collections,records:count};
 const rows=Array.from({length:count},(_,i)=>JSON.stringify({collection:i%2?collections[1]:collections[0],
   record:{id:i,user_id:wrongRecord&&i===1?other:owner,content:'X'.repeat(300)}})+'\n');
 const digest=createHash('sha256').update(rows.join('')).digest('hex');
 const lines=[JSON.stringify(header)+'\n',...rows];
 if(footer)lines.push(JSON.stringify({export_complete:true,records:count,
   sha256:alterFooter?'f'.repeat(64):digest})+'\n');
 if(extra)lines.push(JSON.stringify({collection:'coach_messages',record:{id:'unexpected'}})+'\n');
 return Buffer.from(lines.join(''));
}
function stream(bytes,{chunk=29,truncate=0}={}){
 const value=bytes.subarray(0,bytes.length-truncate);
 return new ReadableStream({start(controller){
  for(let i=0;i<value.length;i+=chunk)controller.enqueue(value.subarray(i,i+chunk));
  controller.close();
 }});
}
async function verify(input,opts){
 return verifyAccountExportDownload({stream:stream(input,opts),expectedOwnerId:owner,expectedCollections:collections});
}
test('verifies a large 6+MB archive with small arbitrarily split network chunks',async()=>{
 const bytes=archive({count:18000});
 assert(bytes.length>5*1024*1024);
 const result=await verify(bytes,{chunk:4093});
 assert.equal(result.verified,true);
 assert.equal(result.recordCount,18000);
 assert.equal(result.ownerId,owner);
});
test('no footer is never a complete download',async()=>{
 await assert.rejects(verify(archive({footer:false})),/truncated|completion/i);
});
test('mid-record truncation and missing final newline both fail',async()=>{
 const bytes=archive();
 await assert.rejects(verify(bytes,{truncate:8}),/truncated|completion/i);
 await assert.rejects(verify(bytes,{truncate:1}),/truncated|completion/i);
});
test('tampered record body fails digest even when valid JSON and record count match',async()=>{
 const bytes=archive();
 const tampered=Buffer.from(bytes.toString('utf8').replace('XXXXX','YYYYY'));
 await assert.rejects(verify(tampered),/checksum mismatch/);
});
test('wrong owner in header or individual record is not releasable',async()=>{
 await assert.rejects(verify(archive({ownerId:other})),/Untrusted/);
 await assert.rejects(verify(archive({wrongRecord:true})),/ownership/);
});
test('wrong terminal hash, extra data after footer and forged record count fail',async()=>{
 await assert.rejects(verify(archive({alterFooter:true})),/checksum mismatch/);
 await assert.rejects(verify(archive({extra:true})),/ownership|Invalid account export data/);
 const invalid=Buffer.from(archive().toString('utf8').replace('"records":5','"records":7'));
 await assert.rejects(verify(invalid),/completion|Invalid account export data/);
});
test('unknown collection and malformed JSON fail before acceptance',async()=>{
 const a=archive();
 const unexpected=Buffer.from(a.toString('utf8').replace('"coach_messages"','"unknown_data"'));
 await assert.rejects(verify(unexpected),/Untrusted/);
 const broken=Buffer.from(a.toString('utf8').replace('"content":"','"content":!'));
 await assert.rejects(verify(broken),/Malformed/);
});
