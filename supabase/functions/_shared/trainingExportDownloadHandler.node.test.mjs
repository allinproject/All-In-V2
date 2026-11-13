import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountExportDownload} from './trainingExportDownloadHandler.mjs';
const requestId='81111111-8111-4111-8111-811111111111';
const bearer='abc.defghijklmnopqrstuvwxyz0123456789.signature';
function req(data={request_id:requestId},options={}){
 return new Request('http://localhost/functions/v1/v2-account-export-download',{
  method:options.method??'POST',
  headers:{authorization:'Bearer '+bearer,...options.headers},
  body:(options.method??'POST')==='POST'?JSON.stringify(data):undefined,
 });
}
test('disabled by default before worker or credential access',async()=>{
 let used=false;
 const res=await handleAccountExportDownload(req(),{
  createAuthorizedWorker:()=>{used=true;throw Error('must not run');},
 });
 assert.equal(res.status,503);
 assert.equal(used,false);
 assert.equal(res.headers.get('cache-control'),'no-store');
});
test('authenticated owner request opens reviewed worker attachment without public URL',async()=>{
 let seenToken=null,seenId=null;
 const res=await handleAccountExportDownload(req(),{
  enabled:true,createAuthorizedWorker:async token=>{
   seenToken=token;
   return {openApprovedLargeHistoryDownload:async id=>{
    seenId=id;return new Response('sealed-or-verified-stream',{
     headers:{'Content-Type':'application/x-ndjson','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},
   });}};
  },
 });
 assert.equal(res.status,200);
 assert.equal(seenToken,bearer);
 assert.equal(seenId,requestId);
 assert.equal(res.headers.get('access-control-allow-origin'),null);
});
test('missing token, body-supplied owner and invalid ID are denied before worker',async()=>{
 let accessed=0;
 const opts={enabled:true,createAuthorizedWorker:()=>{
  accessed++;throw Error('must not run');
 }};
 const cases=[
  new Request('http://localhost',{method:'POST',body:JSON.stringify({request_id:requestId})}),
  req({request_id:requestId,owner_id:'someone'}),
  req({request_id:'non-uuid'}),
  req({}, {headers:{origin:'https://attacker.example'}}),
 ];
 for(const request of cases){
  const res=await handleAccountExportDownload(request,opts);
  assert(res.status>=400);
  assert.equal(res.headers.get('cache-control'),'no-store');
 }
 assert.equal(accessed,0);
});
test('revoked Auth/service errors are non-cacheable and omit private details',async()=>{
 const response=await handleAccountExportDownload(req(),{
  enabled:true,createAuthorizedWorker:async()=>({
   openApprovedLargeHistoryDownload:async()=>{throw Error('private owner 123: request revoked');},
  }),
 });
 assert.equal(response.status,403);
 const json=await response.text();
 assert.equal(json.includes('123'),false);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('non-200 result from worker is not treated as a downloaded export',async()=>{
 const response=await handleAccountExportDownload(req(),{
  enabled:true,createAuthorizedWorker:async()=>({
   openApprovedLargeHistoryDownload:async()=>new Response('partial',{status:206}),
  }),
 });
 assert.equal(response.status,503);
});

test('never release a worker 200 with unsafe download headers or no body',async()=>{
 for(const headers of [
  {'Content-Type':'text/plain','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},
  {'Content-Type':'application/x-ndjson','Cache-Control':'public, max-age=120','X-Content-Type-Options':'nosniff'},
  {'Content-Type':'application/x-ndjson','Cache-Control':'private, no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'},
  {'Content-Type':'application/x-ndjson','Cache-Control':'private, no-store'},
 ]) {
  const result=await handleAccountExportDownload(req(),{
   enabled:true,createAuthorizedWorker:async()=>({
    openApprovedLargeHistoryDownload:async()=>new Response('unsafe', {status:200,headers}),
   }),
  });
  assert.equal(result.status,503);
  assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'),null);
 }
 const empty=await handleAccountExportDownload(req(),{
  enabled:true,createAuthorizedWorker:async()=>({
   openApprovedLargeHistoryDownload:async()=>new Response(null,{
    status:200,headers:{'Content-Type':'application/x-ndjson',
     'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},
   }),
  }),
 });
 assert.equal(empty.status,503,'Missing archive stream was released');
});
