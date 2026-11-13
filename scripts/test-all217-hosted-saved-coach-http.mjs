#!/usr/bin/env node
/**
 * ALL-210 / ALL-217: staging-only TWO-STAGE canonical Coach persistence acceptance.
 * Stage A: create REAL GoTrue users; signed-in client A opens a canonical thread.
 * Print NON-SECRET fixture UUIDs, then pause. The authorized staging operator
 * uses the existing canonical claim -> append -> finish RPCs in a short database
 * transaction to commit the specified fixed message pair. NEVER enable Coach paid
 * sends or create a public/privileged test-writing endpoint.
 * Stage B: after explicit Enter, verify HTTP readback under genuine A JWT,
 * fresh independently signed-in A JWT, and B denied; cleanup in finally.
 *
 * CLI environment: ALL217_STAGING_ANON_KEY (publishable),
 * ALL217_STAGING_SERVICE_ROLE_KEY (secret). No secrets/tokens printed.
 * This is NOT a physical installed-app/device test.
 */
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {createInterface} from "node:readline/promises";
import {stdin,stdout} from "node:process";

const project="fbtgknlxjyeqrxemskbl";
const base="https://"+project+".supabase.co";
const pub=process.env.ALL217_STAGING_ANON_KEY;
const secret=process.env.ALL217_STAGING_SERVICE_ROLE_KEY;
const valid=x=>typeof x==="string"&&x.length>=20&&x.trim()===x;
const userText="ALL217 nonempty hosted message: owner user";
const assistantText="ALL217 provider-free canonical assistant fixture";
if(!valid(pub)||!valid(secret)||pub===secret||
 (process.env.ALL217_STAGING_PROJECT_ID&&process.env.ALL217_STAGING_PROJECT_ID!==project)){
 console.error("BLOCKED: supply distinct, local-only keys from exact temporary staging project.");
 process.exitCode=2;
}else{
 const created=[];const pass=[];let failed=false;
 async function http(path,{method="POST",body,token,admin=false}={}){
  const key=admin?secret:pub;
  const response=await fetch(base+path,{
   method,signal:AbortSignal.timeout(20000),
   headers:{apikey:key,...(token?{authorization:"Bearer "+token}:{}),
    "content-type":"application/json","cache-control":"no-store"},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let data=null;try{data=await response.json()}catch{}
  return {status:response.status,data};
 }
 const check=(name,ok)=>{
  assert.ok(ok,name);pass.push(name);console.log("PASS "+name);
 };
 async function user(label){
  const email="all217-saved-"+label+"-"+randomUUID()+"@example.invalid";
  const password=randomBytes(36).toString("base64url")+"!2Qq";
  const create=await http("/auth/v1/admin/users",{admin:true,
   body:{email,password,email_confirm:true,app_metadata:{all217_temporary_staging:true}}});
  assert.equal(create.status,200,"GoTrue create user "+label+": HTTP "+create.status);
  assert.ok(create.data?.id,"GoTrue owner ID missing");
  created.push(create.data.id);
  const login=await http("/auth/v1/token?grant_type=password",{body:{email,password}});
  assert.equal(login.status,200,"GoTrue sign-in "+label+": HTTP "+login.status);
  assert.equal(login.data?.user?.id,create.data.id,"login identity mismatch");
  assert.ok(login.data?.access_token,"real access JWT missing");
  return {id:create.data.id,email,password,token:login.data.access_token};
 }
 const coach=(token,body)=>http("/functions/v1/v2-coach",{token,body});
 const exact=(token,fields)=>http("/rest/v1/rpc/v2_coach_read_exchange",{
  token,body:fields
 });
 let rl;
 try{
  const a=await user("a"),b=await user("b");
  check("two real independent GoTrue login sessions",a.id!==b.id);
  const opened=await coach(a.token,{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("owner A opens hosted canonical thread",
   opened.status===200&&opened.data?.status==="ok"&&typeof opened.data.threadId==="string");
  const thread=opened.data.threadId;
  const ids={request:randomUUID(),userMessage:randomUUID(),assistantMessage:randomUUID()};
  const bOpen=await coach(b.token,{
   action:"open",ownerId:b.id,candidateThreadId:randomUUID()
  });
  check("owner B opens distinct thread",
   bOpen.status===200&&bOpen.data?.threadId!==thread);
  const empty=await coach(a.token,{action:"history",ownerId:a.id,threadId:thread,limit:40});
  check("A history initially empty",empty.status===200&&empty.data?.messages?.length===0);

  console.log("");
  console.log("FIXTURE NON-SECRET UUIDS — share these five values with the staging operator:");
  console.log("OWNER_A_ID="+a.id);
  console.log("THREAD_A_ID="+thread);
  console.log("CLIENT_REQUEST_ID="+ids.request);
  console.log("USER_MESSAGE_ID="+ids.userMessage);
  console.log("ASSISTANT_MESSAGE_ID="+ids.assistantMessage);
  console.log("FIXED_USER_TEXT="+userText);
  console.log("FIXED_ASSISTANT_TEXT="+assistantText);
  console.log("The operator must commit the fixed pair via canonical staging DB RPCs.");
  console.log("Pressing Enter before the commit is safe; the test checks actual saved data and stays paused.");
  rl=createInterface({input:stdin,output:stdout});
  process.once("SIGINT",()=>{console.error("Interrupted: attempting disposable account cleanup");rl?.close()});
  const fields={p_expected_user_id:a.id,p_thread_id:thread,
   p_client_request_id:ids.request,p_user_message_id:ids.userMessage,
   p_assistant_message_id:ids.assistantMessage};
  // Never advance just because Enter was pressed. Check the actual saved pair.
  // A premature Enter does not destroy fixtures or abort the test.
  while(true){
   await rl.question("Press Enter to CHECK committed pair (early Enter is safe): ");
   const proof=await exact(a.token,fields);
   const validPair=proof.status===200&&Array.isArray(proof.data)&&
    proof.data.length===2&&
    proof.data.some(m=>m.message_id===ids.userMessage&&
     m.role==="user"&&m.content===userText)&&
    proof.data.some(m=>m.message_id===ids.assistantMessage&&
     m.role==="assistant"&&m.content===assistantText);
   if(validPair){console.log("PASS canonical pair independently confirmed by real owner JWT");break;}
   console.log("NOT READY: no matching committed pair yet. Leave this PowerShell running.");
   console.log("Send the five UUIDs in chat; do not continue until the staging write is confirmed.");
  }

  const hist=await coach(a.token,{action:"history",ownerId:a.id,threadId:thread,limit:40});
  check("real owner JWT HTTP reads committed two-message history",
   hist.status===200&&hist.data?.status==="ok"&&
   Array.isArray(hist.data.messages)&&hist.data.messages.length===2);
  const rows=hist.data.messages;
  check("HTTP history matches exact source IDs/roles/content",
   rows.some(m=>m.id===ids.userMessage&&m.role==="user"&&m.content===userText)&&
   rows.some(m=>m.id===ids.assistantMessage&&m.role==="assistant"&&m.content===assistantText));
  const matched=await exact(a.token,fields);
  check("real JWT exact canonical exchange RPC returns saved pair",
   matched.status===200&&Array.isArray(matched.data)&&matched.data.length===2&&
   matched.data.some(m=>m.message_id===ids.userMessage&&m.role==="user"&&m.content===userText)&&
   matched.data.some(m=>m.message_id===ids.assistantMessage&&m.role==="assistant"&&m.content===assistantText));
  const bRead=await coach(b.token,{action:"history",ownerId:b.id,threadId:thread,limit:40});
  check("owner B denied access to nonempty A history",
   bRead.status===401||bRead.status===403||bRead.status===503);
  const bExact=await exact(b.token,{...fields,p_expected_user_id:b.id});
  check("owner B denied exact canonical exchange read",
   bExact.status===401||bExact.status===403||bExact.status===404);
  const separate=await http("/auth/v1/token?grant_type=password",{
   body:{email:a.email,password:a.password}
  });
  check("fresh independent client login as A",
   separate.status===200&&separate.data?.user?.id===a.id&&!!separate.data.access_token);
  const reopened=await coach(separate.data.access_token,{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("independent login recovers same thread without cached thread ID",
   reopened.status===200&&reopened.data?.threadId===thread);
  const recovered=await coach(separate.data.access_token,{
   action:"history",ownerId:a.id,threadId:thread,limit:40
  });
  check("independent login recovers exact nonempty saved messages",
   recovered.status===200&&Array.isArray(recovered.data?.messages)&&
   recovered.data.messages.length===2&&
   recovered.data.messages.some(m=>m.id===ids.userMessage&&m.content===userText)&&
   recovered.data.messages.some(m=>m.id===ids.assistantMessage&&m.content===assistantText));
  const denied=await coach(separate.data.access_token,{
   action:"send",ownerId:a.id,threadId:thread,
   clientRequestId:randomUUID(),userMessageId:randomUUID(),
   assistantMessageId:randomUUID(),message:"must never charge a model"
  });
  check("paid Coach send remains blocked",denied.status===503);
  console.log("PASS provider-free real-JWT saved Coach HTTP acceptance: "+pass.length+" checks");
 }catch(error){
  failed=true;
  console.error("FAIL: "+(error?.message??"unknown hosted acceptance failure"));
 }finally{
  rl?.close();
  for(const id of created.reverse()){
   try{
    const out=await http("/auth/v1/admin/users/"+encodeURIComponent(id),{
     admin:true,method:"DELETE"
    });
    if(![200,204].includes(out.status)){
     failed=true;console.error("CLEANUP FAILED: Auth Admin HTTP "+out.status);
    }else console.log("PASS temporary staging user deleted");
   }catch{
    failed=true;console.error("CLEANUP FAILED: Auth Admin request");
   }
  }
  if(failed)process.exitCode=1;
 }
}
