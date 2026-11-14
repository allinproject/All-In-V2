// WARNING: Hosted Supabase Edge secrets are PROJECT-WIDE, not function-scoped.
// A signer stored in Supabase Edge Secrets can also be read by other Edge
// functions in the same project. It improves accidental caller separation,
// but is NOT independent cryptographic custody or writer-only enforcement.
// Never set ALLIN_PRIVATE_WRITER_ACCEPTED=true on that basis alone.
// ALL-251 STAGED CANDIDATE ONLY. Do not deploy until approved hosted race
// tests, privileged credential isolation and writer inventory are complete.
// Clients authenticate with their JWT; only server uses service-role Storage.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {createPrivilegedStorageWriter,MAX_PRIVILEGED_STORAGE_BYTES} from '../_shared/trainingPrivilegedStorageWriter.mjs';
import {createAttestedPrivilegedStorageLeaseAuthority} from '../_shared/trainingPrivilegedStorageWriterAttestor.mjs';

const headers={'content-type':'application/json','cache-control':'no-store'};
function reply(status:number,code:string){return new Response(JSON.stringify({code}),
 {status,headers});}
Deno.serve(async(req:Request)=>{
 // This endpoint accepts one complete, bounded object body only. It is NOT
 // a resumable/TUS gateway. Do not allow session creation or chunk metadata
 // without per-request Auth/ownership, lease, deletion and offset checks.
 if(req.method!=='POST')return reply(405,'method_not_allowed');
 if(req.headers.has('tus-resumable')||req.headers.has('upload-offset')||
    req.headers.has('upload-length')||req.headers.has('upload-metadata')||
    req.headers.has('upload-defer-length')||
    /^application\/offset\+octet-stream(?:\s*;|$)/i.test(
      req.headers.get('content-type')??''))
   return reply(403,'resumable_upload_disabled');
 // Hard default OFF even if this review function is deployed accidentally.
 if(Deno.env.get('ALLIN_PRIVATE_WRITER_ACCEPTED')!=='true')
  return reply(503,'private_writer_not_accepted');
 const endpoint=(Deno.env.get('SUPABASE_URL')??'').trim();
 const key=(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'').trim();
 if(!endpoint||!key)return reply(503,'writer_not_configured');
 const bearer=req.headers.get('authorization')??'';
 if(!/^Bearer\s+[^\s]+$/i.test(bearer))return reply(401,'auth_required');
 const length=Number(req.headers.get('content-length')??0);
 if(!Number.isFinite(length)||length>MAX_PRIVILEGED_STORAGE_BYTES)
  return reply(413,'body_too_large');
 const bucketId=req.headers.get('x-allin-bucket')??'';
 // Ordinary mobile users cannot write account export archives.
 if(bucketId!=='v2-private-workout-objects')return reply(403,'bucket_not_approved');
 const path=req.headers.get('x-allin-path')??'';
 const operation=req.headers.get('x-allin-operation')??'';
 const contentType=req.headers.get('content-type')??'';
 // Deliberate fail-closed second credential: ordinary service-role holders
 // MUST NOT be able to issue writer leases. Provision independently and
 // only to this trusted writer, never in mobile or shared workflow env.
 const signerEncoded=Deno.env.get('ALLIN_WRITER_ATTESTATION_SECRET_B64')??'';
 let signerBytes:Uint8Array;
 try{
  const decoded=atob(signerEncoded);
  signerBytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  if(signerBytes.length!==32)return reply(503,'writer_signer_not_configured');
 }catch{return reply(503,'writer_signer_not_configured');}
 const client=createClient(endpoint,key,{auth:{
  persistSession:false,autoRefreshToken:false,
 }});
 const identity=await client.auth.getUser(bearer.replace(/^Bearer\s+/i,''));
 if(identity.error||!identity.data?.user?.id)return reply(401,'invalid_session');
 let payload:Uint8Array;
 try{
  payload=new Uint8Array(await req.arrayBuffer());
  if(payload.byteLength===0||payload.byteLength>MAX_PRIVILEGED_STORAGE_BYTES)
   return reply(413,'body_too_large');
 }catch{return reply(400,'invalid_body');}
 try{
  const leaseAuthority=createAttestedPrivilegedStorageLeaseAuthority({
   supabase:client,signingKey:signerBytes,
  });
  const result=await createPrivilegedStorageWriter({
   supabase:client,leaseAuthority,requireAttestedLease:true,
  }).write({
   verifiedOwnerId:identity.data.user.id,bucketId,path,
   operation,contentType,bytes:payload,
  });
  return new Response(JSON.stringify({status:'stored',path:result.path}),
   {status:201,headers});
 }catch{
  // An ambiguous upload can have a durable open lease requiring operator
  // investigation. Never expose lease IDs, Storage errors or service tokens.
  return reply(409,'write_not_verified');
 }
});
